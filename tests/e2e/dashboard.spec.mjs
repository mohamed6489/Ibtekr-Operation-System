import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { installSupabaseMock, installLiveConfig, LIVE, LIVE_MISSING, DEV_PW } from './supabase-mock.mjs';
// The dashboard on the signed-in member (phase 1): role frame, customization saved per user on the server, «آخر نشاط» from
// the server log, server alerts in the bell («النظام») and in «محتاج منك دلوقتي» with a per-user read state, sign-out wipes
// the page's memory. Dev users of tools/seed-dev-users.sql; mocked by default,
// E2E_SUPABASE_LIVE=1 runs the unmarked tests against the staging project in E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY.
const env = process.env;
const ADMIN = LIVE ? { id: env.E2E_ADMIN_EMAIL, pw: env.E2E_ADMIN_PW } : { id: 'admin.dev@ibtekr.local', pw: DEV_PW };
const OPS = { id: 'ops.dev@ibtekr.local', pw: LIVE ? env.E2E_OPS_PW : DEV_PW };
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; // M01 «صفوت كمال»
const OPS_ID = '00000000-0000-4000-8000-000000000002'; // M02 «سارة أحمد»
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  if (LIVE) {
    test.skip(!!LIVE_MISSING, LIVE_MISSING);
    test.skip(!ADMIN.id || !ADMIN.pw || !OPS.pw, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PW/E2E_OPS_PW not set');
    await installLiveConfig(page);
  } else mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  if (!LIVE) expect(mock.unhandled).toEqual([]);
});
const mockOnly = () => test.skip(LIVE, 'asserts on the mocked Supabase');

async function signIn(page, id, pw, { remember = true } = {}) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id);
  await page.fill('#lg-pw', pw);
  if (!remember) await page.getByRole('checkbox', { name: 'افتكرني على الجهاز ده' }).click();
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const card = (page, id) => page.locator(`[data-card="${id}"]`);
// an activity_log row as the server keeps it (seeded into mock.activityRows before sign-in); `daysBack` days ago at hh:mm local time
const at = (daysBack, hh, mm) => { const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(hh, mm, 0, 0); return d; };
const row = (id, when, actor, action, value) => ({ id, at: when.toISOString(), actor, action, new_value: value });
const customizeButton = (page) => page.getByRole('button', { name: 'تخصيص اللوحة', exact: true });
// the dialog's switch for a card: <button role="switch" aria-label="…"> (K.Switch); the ↑/↓ buttons only contain the label
const cardSwitch = (page, label) => page.getByRole('dialog').getByRole('switch', { name: label, exact: true });
// read while the page may be reloading: a destroyed context answers null and expect.poll asks again
const settled = (page, fn) => page.evaluate(fn).catch(() => null);
const hasDevMembers = (page) => settled(page, () => window.IBKit.store.members.some((m) => /\.dev@ibtekr\.local$/.test(m.email)));
// set on the signed-in page; a reload starts a fresh window without it
const markPage = (page) => page.evaluate(() => { window.__signedInPage = true; });
const reloaded = (page) => settled(page, () => window.__signedInPage === undefined && !!window.IBKit);
// the bell (block 28 NotificationsMenu): its dialog, a section of its nav, an item of the open section
const bell = (page) => page.getByRole('dialog', { name: 'الإشعارات' });
const bellSection = (page, label) => bell(page).locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: new RegExp('^' + label + '$') }) });
const bellItem = (page, title) => bell(page).locator('.ntf-item', { hasText: title });
// the bell's total: the prototype's sample sections (customers, suppliers, …) still count for every member and the badge caps
// at «99+», so it is read uncapped from the button's aria-label «الإشعارات — N تنبيه» («الإشعارات» at 0)
const bellCount = async (page) => Number((/(\d+)/.exec(await page.locator('.notif-btn').getAttribute('aria-label')) || [0, 0])[1]);
// IBAlerts.load() answered (the «النظام» section exists); an open bell is not redrawn when it arrives, so wait before opening it
const alertsLoaded = (page) => settled(page, () => !!(window.IBAlerts && window.IBAlerts.section()));

test('dashboard greets the signed-in admin with the admin frame', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('لوحة التحكم');
  await expect(page.locator('.dash-hi')).toContainText('يا صفوت');
  await expect(page.locator('.dash-kpis .kpi')).toHaveCount(5);
  await expect(card(page, 'money')).toHaveCount(1);
  await expect(page.locator('#dash-viewas')).toHaveCount(1);
});

test('ops gets the ops frame: no money, no view-as', async ({ page }) => {
  await signIn(page, OPS.id, OPS.pw);
  await expect(page.locator('.dash-kpis')).toContainText('جاهز / قيد الشحن');
  await expect(card(page, 'money')).toHaveCount(0);
  await expect(page.locator('#dash-viewas')).toHaveCount(0);
});

test('customization is saved to the server and survives a reload', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'team')).toHaveCount(1);
  await customizeButton(page).click();
  await cardSwitch(page, 'الفريق دلوقتي').click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(card(page, 'team')).toHaveCount(0);
  await expect.poll(() => mock.prefs.map((p) => ({ user_id: p.user_id, key: p.key, hidden: p.data.hidden, cards: p.data.order.length })))
    .toEqual([{ user_id: ADMIN_ID, key: 'dashboard', hidden: ['team'], cards: 10 }]);
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect(card(page, 'activity')).toBeVisible(); // the dashboard is drawn
  await expect(card(page, 'team')).toHaveCount(0);
  await customizeButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'رجوع للافتراضي', exact: true }).click();
  await expect(card(page, 'team')).toHaveCount(1);
  await expect.poll(() => mock.prefs).toEqual([]);
  expect(mock.activity.map((a) => a.action)).toContain('dashboard.customize');
});

test('«عرض كـ» another member shows their role frame in its default order, not my customization, and only their actions', async ({ page }) => {
  mockOnly();
  mock.activityRows.push(row(921, at(1, 9, 5), OPS_ID, 'auth.signin', 'سارة أحمد'));
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سارة أحمد · أمس 09:05'); // the admin sees everyone's rows
  await customizeButton(page).click();
  await cardSwitch(page, 'الفريق دلوقتي').click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(card(page, 'team')).toHaveCount(0);
  await page.locator('#dash-viewas').click();
  await page.getByRole('option', { name: 'سارة أحمد — عمليات' }).click();
  await expect(page.locator('.dash-viewing')).toContainText('سارة أحمد');
  // the ops frame (24-dash-domain.js BY_ROLE) in its default order, «الفريق دلوقتي» included: her preferences are hers (RLS), never mine
  await expect.poll(() => page.locator('.dash-grid [data-card]').evaluateAll((els) => els.map((e) => e.dataset.card)))
    .toEqual(['daily', 'need', 'weeks', 'health', 'stockToday', 'vendors', 'team', 'activity']);
  // «آخر نشاط» as she sees it: her own rows only (the admin's sign-in and customization are left out)
  const act = card(page, 'activity');
  await expect(act).toContainText('آخر 5 حاجات عملتها');
  await expect(act.locator('.da-row')).toHaveCount(1);
  await expect(act).toContainText('سارة أحمد · أمس 09:05');
  await expect(act).not.toContainText('صفوت كمال');
});

test('a customization the server refused applies to this page only and says so', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  mock.prefsDown = true;
  await customizeButton(page).click();
  await cardSwitch(page, 'الفريق دلوقتي').click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(card(page, 'team')).toHaveCount(0);
  await expect(page.locator('.toast[role=status]')).toHaveText('اتطبّق دلوقتي بس — معرفناش نحفظه على السيرفر، جرّب تاني');
  await expect(page.locator('.toast[role=status]')).toHaveClass(/error/);
  expect(mock.prefs).toEqual([]);
});

test('the activity card shows server rows with Arabic labels', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
  await expect(card(page, 'activity')).toContainText('صفوت كمال');
});

test('a non-admin sees only their own actions in «آخر نشاط»', async ({ page }) => {
  mockOnly();
  // settings.view P: the server returns every row to ops; the card keeps hers
  mock.activityRows.push(row(911, at(2, 18, 30), OPS_ID, 'auth.signout', 'يدوي'), row(912, at(1, 9, 0), ADMIN_ID, 'auth.signin', 'صفوت كمال'),
    row(913, at(1, 9, 10), ADMIN_ID, 'dashboard.customize', '9 كارت'));
  await signIn(page, OPS.id, OPS.pw);
  const act = card(page, 'activity');
  await expect(act.locator('.da-row')).toHaveCount(2); // her sign-in now + her sign-out two days ago
  await expect(act.locator('.da-row').first()).toContainText('سجّل دخول — سارة أحمد');
  await expect(act).toContainText('سارة أحمد');
  await expect(act).not.toContainText('صفوت كمال');
  await expect(act).toContainText('آخر 5 حاجات عملتها');
});

test('the activity card finds her rows behind newer rows of others (newest 25 read)', async ({ page }) => {
  mockOnly();
  // settings.view P: ops reads every row; 6 admin rows newer than her 2 would fill a 5-row read on their own
  mock.activityRows.push(row(931, at(3, 10, 0), OPS_ID, 'auth.signout', 'يدوي'), row(932, at(3, 11, 0), OPS_ID, 'auth.password.set', 'reset'),
    ...[0, 1, 2, 3, 4, 5].map((i) => row(940 + i, at(1, 9, i), ADMIN_ID, 'dashboard.customize', (9 - i) + ' كارت')));
  await signIn(page, OPS.id, OPS.pw);
  const act = card(page, 'activity');
  await expect(act.locator('.da-row')).toHaveCount(3); // her sign-in now + her 2 seeded rows
  await expect(act.locator('.da-row').nth(1)).toContainText('سارة أحمد');
  await expect(act.locator('.da-row').nth(1)).toContainText('غيّر كلمة المرور — reset');
  await expect(act.locator('.da-row').nth(2)).toContainText('سارة أحمد');
  await expect(act.locator('.da-row').nth(2)).toContainText('سجّل خروج — يدوي');
  await expect(act).not.toContainText('صفوت كمال');
});

test('a server-log update does not redraw the dashboard under an open menu', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
  await page.getByRole('button', { name: '+ إجراء سريع', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const tag = () => card(page, 'activity').evaluate((el) => { el.dataset.probe = '1'; }); // a redraw replaces the element: the tag goes
  await tag();
  await page.evaluate(() => document.dispatchEvent(new Event('ib:activity'))); // as IBActivity.refresh() does (listeners run synchronously)
  await expect(menu).toBeVisible();
  await expect(card(page, 'activity')).toHaveAttribute('data-probe', '1'); // not redrawn
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await tag();
  await page.evaluate(() => document.dispatchEvent(new Event('ib:activity'))); // no overlay: the dashboard redraws
  await expect(card(page, 'activity')).not.toHaveAttribute('data-probe', '1');
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
});

test('the activity card lists the newest 5 server rows: today, yesterday, then DD/MM', async ({ page }) => {
  mockOnly();
  const yesterday = at(1, 9, 5);
  mock.activityRows.push(row(901, new Date(2026, 0, 1, 10, 0), OPS_ID, 'auth.signout', 'يدوي'), row(902, new Date(2026, 0, 2, 10, 0), OPS_ID, 'auth.signout', 'يدوي'),
    row(903, new Date(2026, 0, 3, 10, 0), OPS_ID, 'auth.signoutAll', 'سارة أحمد'), row(904, new Date(2026, 0, 4, 10, 0), OPS_ID, 'auth.signin', 'سارة أحمد'),
    row(905, new Date(2026, 0, 5, 8, 7), OPS_ID, 'auth.password.set', 'reset'), row(906, yesterday, ADMIN_ID, 'auth.2fa', null));
  await signIn(page, ADMIN.id, ADMIN.pw);
  const rows = card(page, 'activity').locator('.da-row');
  await expect(rows.first()).toContainText(/^صفوت كمال · اليوم \d\d:\d\d/);
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('سجّل دخول — صفوت كمال');
  await expect(rows.nth(1)).toHaveText('صفوت كمال · أمس 09:05تحقق بخطوتين');
  await expect(rows.nth(2)).toHaveText('سارة أحمد · 05/01 08:07غيّر كلمة المرور — reset');
  await expect(rows.nth(3)).toHaveText('سارة أحمد · 04/01 10:00سجّل دخول — سارة أحمد');
  await expect(rows.nth(4)).toHaveText('سارة أحمد · 03/01 10:00خروج من كل الأجهزة — سارة أحمد');
  await expect(card(page, 'activity')).toContainText('آخر 5 حركات في السيستم');
});

test('a role alert from the server reaches the bell and the need card', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'need')).toContainText('فشل مزامنة WooCommerce'); // unread, error tone: ranked first (redrawn on ib:notify)
  const total = await bellCount(page);
  await page.locator('.notif-btn').click();
  await expect(bell(page).locator('.ntf-nav-item').first()).toContainText('النظام'); // the server section comes first
  await expect(bellSection(page, 'النظام').locator('.cnt')).toHaveText('1');
  await bellSection(page, 'النظام').click();
  await bellItem(page, 'فشل مزامنة WooCommerce').click();
  await expect.poll(() => mock.alertReads).toEqual([{ alert_id: 1, user_id: ADMIN_ID }]);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard'); // «الإعدادات» is closed (soon, phase 3.6): the dashboard
  await expect.poll(() => bellCount(page)).toBe(total - 1); // the badge no longer counts it
  await page.goto('/#dashboard');
  await expect(card(page, 'need')).toBeVisible();
  await expect(card(page, 'need')).not.toContainText('فشل مزامنة WooCommerce'); // read: muted, so topNeed skips it
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => alertsLoaded(page)).toBe(true);
  expect(await bellCount(page)).toBe(total - 1);
  await page.locator('.notif-btn').click();
  await expect(bellSection(page, 'النظام').locator('.cnt')).toHaveText('0'); // the read state came back from the server
  await bellSection(page, 'النظام').click();
  await expect(bellItem(page, 'فشل مزامنة WooCommerce')).toHaveClass(/muted/);
  await expect(card(page, 'need')).not.toContainText('فشل مزامنة WooCommerce');
});

test('ops sees only alerts addressed to them', async ({ page }) => {
  mockOnly();
  await signIn(page, OPS.id, OPS.pw);
  await expect(card(page, 'need')).toContainText('تجميع متأخر IB-1042'); // the alerts arrived (the need card redraws on ib:notify)
  await page.locator('.notif-btn').click();
  await expect(bellSection(page, 'النظام').locator('.cnt')).toHaveText('1');
  await bellSection(page, 'النظام').click();
  await expect(bellItem(page, 'تجميع متأخر IB-1042')).toHaveCount(1);
  await expect(bellItem(page, 'فشل مزامنة WooCommerce')).toHaveCount(0);
  await expect(card(page, 'need')).not.toContainText('فشل مزامنة WooCommerce');
});

test('a mark the server refuses fails; one it already has (23505) counts as done; an alert read here is not sent again', async ({ page }) => {
  mockOnly();
  await signIn(page, OPS.id, OPS.pw);
  await expect(card(page, 'need')).toContainText('تجميع متأخر IB-1042');
  const posts = () => mock.requests.filter((r) => r === 'POST /rest/v1/alert_reads').length;
  expect(await page.evaluate(() => window.IBAlerts.markRead(1))).toEqual({ ok: false }); // the admin role's alert: RLS 42501
  mock.alertReads.push({ alert_id: 2, user_id: OPS_ID }); // read on another device after this page loaded
  expect(await page.evaluate(() => window.IBAlerts.markRead(2))).toEqual({ ok: true }); // 409 23505
  expect(posts()).toBe(2);
  expect(await page.evaluate(() => window.IBAlerts.markRead(2))).toEqual({ ok: true }); // already read in this page: no request
  expect(posts()).toBe(2);
  expect(mock.alertReads).toEqual([{ alert_id: 2, user_id: OPS_ID }]);
});

test('mark all read from the section header', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'need')).toContainText('فشل مزامنة WooCommerce');
  const total = await bellCount(page);
  await page.locator('.notif-btn').click();
  await bellSection(page, 'النظام').click();
  await bell(page).getByRole('button', { name: 'تعليم الكل كمقروء', exact: true }).click();
  await expect.poll(() => mock.alertReads.length).toBe(1);
  expect(mock.alertReads).toEqual([{ alert_id: 1, user_id: ADMIN_ID }]);
  expect(mock.requests.filter((r) => r === 'POST /rest/v1/alert_reads')).toHaveLength(1); // one request for the whole section
  await expect.poll(() => bellCount(page)).toBe(total - 1);
  await expect(card(page, 'need')).not.toContainText('فشل مزامنة WooCommerce'); // the bell closed: the dashboard redrew
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect.poll(() => alertsLoaded(page)).toBe(true);
  await page.locator('.notif-btn').click();
  await expect(bellSection(page, 'النظام').locator('.cnt')).toHaveText('0'); // persisted on the server
  expect(await bellCount(page)).toBe(total - 1);
});

test('an alert that arrives later redraws «محتاج منك دلوقتي», not under an open menu', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'need')).toContainText('فشل مزامنة WooCommerce');
  await expect(card(page, 'activity')).toContainText('سجّل دخول'); // the sign-in's own redraws are done
  mock.alerts.push({ id: 3, at: new Date().toISOString(), kind: 'orders.sync.failed', title: 'فشل سحب الأوردرات', body: null, role_id: 'admin', user_id: null, entity: 'orders', entity_id: null });
  await page.getByRole('button', { name: '+ إجراء سريع', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.IBAlerts.load()); // dispatches ib:notify, as a Realtime insert does
  await expect(menu).toBeVisible();
  await expect(card(page, 'need')).not.toContainText('فشل سحب الأوردرات'); // not redrawn under the menu
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => window.IBAlerts.load());
  await expect(card(page, 'need')).toContainText('فشل سحب الأوردرات'); // ib:notify alone redrew the card
});

// «النهارده» of the dashboard is the real date the orders' ages count to (IBOrders.today), never the prototype's K.TODAY: the
// greeting, the default range, the report's order dates (today − ageDays) and the 30-day confirmation window. The browser
// clock is fixed at the moment the mock dated its orders, in UTC like the mock's 10:00Z placed_at (no midnight in between).
test.describe('the dashboard on the real clock', () => {
  test.use({ timezoneId: 'UTC' });
  test('greeting, default range, report dates and the 30-day confirmation window count from today', async ({ page }) => {
    mockOnly();
    const now = Date.now();
    await page.clock.setFixedTime(now);
    const ago = (d) => { const t = new Date(now - d * 864e5); t.setUTCHours(10, 0, 0, 0); return t.toISOString(); };
    const order = (id) => mock.orders.find((o) => o.id === id);
    order(180686).placed_at = ago(31); // «مؤكد بدون عربون»: out of the last 30 days
    order(180656).placed_at = ago(29); // «في انتظار الرد»: the window's first day (K.TODAY would put it on 2026-10-20 − 29: out)
    await signIn(page, ADMIN.id, ADMIN.pw);
    const today = new Date(now).toISOString().slice(0, 10);
    expect(await page.evaluate(() => window.IBOrders.today())).toBe(today);
    const label = await page.evaluate((t) => window.IBKit.dayName(t) + ' ' + window.IBKit.dlabel(t), today);
    await expect(page.locator('.dash-hi')).toContainText(label);
    expect(await page.evaluate(() => [window.IBDashData.today(), window.IBDashData.TODAY, JSON.parse(JSON.stringify(window.IBDashData.range()))]))
      .toEqual([today, today, { from: today, to: today, preset: 'today' }]);
    // each order lands on its own placed date (today − its real age)
    const on = (id) => page.evaluate((id) => { const d = window.OrdersApp.get(id).date; return [d, window.IBDashData.report({ from: d, to: d }).rows.map((r) => r.id)]; }, id);
    expect(await on('181668')).toEqual([ago(6).slice(0, 10), ['181668']]);
    expect(await on('180656')).toEqual([ago(29).slice(0, 10), ['180656']]);
    // the confirmation card's window (the last render's snapshot): 181668 (6 days) and 180656 (29 days), not 180686 (31 days)
    await expect.poll(() => settled(page, () => { const c = window.IBPages.all().dashboard.api.state.last.conf; return { count: c.count, by: c.byConfirm }; }))
      .toEqual({ count: 2, by: [['غير مؤكد', 1], ['في انتظار الرد', 1]] });
  });
});

// block 24's DONE (phase 2.1): «فشل» (Woo failed) is done like «ملغي», never an open order; «تم RTC» is no status any more
test('a failed order («فشل») is not an open order on the dashboard', async ({ page }) => {
  mockOnly();
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: 'فشل', woo_status: 'failed' });
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect.poll(() => settled(page, () => { const S = window.IBPages.all().dashboard.api.state.last; return S && S.rows.length ? [S.rows.length, S.health.open] : null; })).toEqual([3, 2]);
  const open = page.getByRole('group', { name: 'أوردرات مفتوحة' });
  await expect(open.locator('.kpi-val .t-h3')).toHaveText('2');
  await open.locator('.kpi-details').click();
  const details = page.locator('[role=dialog][data-details]');
  await expect(details).toContainText('IB-180686');
  await expect(details).toContainText('IB-180656');
  await expect(details).not.toContainText('IB-181668');
});

test('the dashboard redraws itself every 5 minutes while nothing is open', async ({ page }) => {
  mockOnly();
  await page.clock.install();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
  await card(page, 'need').evaluate((el) => { el.dataset.probe = '1'; }); // a redraw replaces the element: the tag goes
  await page.clock.runFor('04:30'); // the interval started with the page, a moment before the tag
  await expect(card(page, 'need')).toHaveAttribute('data-probe', '1');
  await page.clock.runFor('00:45');
  await expect(card(page, 'need')).not.toHaveAttribute('data-probe', '1'); // the closed AI panel (hidden dialog) no longer blocks it
});

test('the 5-minute refresh re-reads «آخر نشاط» from the server log; a failed read keeps what the card shows', async ({ page }) => {
  mockOnly();
  await page.clock.install();
  await signIn(page, ADMIN.id, ADMIN.pw);
  const act = card(page, 'activity');
  await expect(act).toContainText('سجّل دخول');
  // a row the page has not read yet (another member's sign-in on another device): nothing on the page asks for it
  mock.activityRows.push(row(941, new Date(Date.now() - 60 * 1000), OPS_ID, 'auth.signin', 'تابلت المخزن'));
  await page.clock.runFor('04:30');
  await expect(act).not.toContainText('تابلت المخزن');
  await page.clock.runFor('00:45'); // the tick: IBActivity.refresh(), then the redraw when its ib:activity lands
  await expect(act).toContainText('سارة أحمد');
  await expect(act).toContainText('سجّل دخول — تابلت المخزن');
  // the next read fails (503, supabase-js retries it): the tick still redraws, the finished refresh keeps the card's rows and
  // nothing throws (afterEach: no page error)
  let failed = 0;
  await page.route('**/rest/v1/activity_log?*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    failed += 1;
    // Retry-After: 0 (exposed to the page) → postgrest-js retries at once instead of backing off
    return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after', 'retry-after': '0', 'content-type': 'application/json' }, body: '{"message":"unavailable"}' });
  });
  await page.evaluate(() => { window.__activityEvents = 0; document.addEventListener('ib:activity', () => { window.__activityEvents += 1; }); });
  await card(page, 'need').evaluate((el) => { el.dataset.probe = '1'; });
  await page.clock.runFor('05:00');
  await expect(card(page, 'need')).not.toHaveAttribute('data-probe', '1');
  await expect.poll(() => page.evaluate(() => window.__activityEvents)).toBe(1); // refresh() gave up and said so
  expect(failed).toBeGreaterThan(0);
  await expect(act).toContainText('سجّل دخول — تابلت المخزن');
});

// app/.htaccess's Content-Security-Policy header, put on the page here: npm run serve (http-server) does not read .htaccess
const CSP = /Header always set Content-Security-Policy "([^"]+)"/.exec(readFileSync(new URL('../../app/.htaccess', import.meta.url), 'utf8'))[1];
test('under the production CSP the dashboard loads with nothing refused, a shared popup becomes an image, and both export libraries load from js/vendor', async ({ page }) => {
  mockOnly(); // its connect-src names the production project; the live run talks to the staging one
  const refused = []; page.on('console', (m) => { if (/Refused to|Content Security Policy/i.test(m.text())) refused.push(m.text()); });
  await page.route((url) => url.port === '4173' && /^\/(index\.html)?$/.test(url.pathname), async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
  });
  page.on('popup', (p) => p.close().catch(() => {})); // the mailto: tab shareVia opens
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
  // share a KPI's details by email (block 10: DetailsModal → ShareButton → shareVia): html2canvas comes from its lazy loader
  // (js/vendor, script-src 'self'); the browser refuses the clipboard, so the image is shown as <img src="blob:…"> (img-src blob:)
  await page.evaluate(() => { navigator.clipboard.write = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  expect(await page.evaluate(() => typeof window.html2canvas)).toBe('undefined');
  await page.locator('.dash-kpis .kpi-details').first().click();
  const details = page.locator('[role=dialog][data-details]');
  await details.locator('[data-share]').click();
  await page.getByRole('menuitem', { name: /^إيميل/ }).click();
  const img = page.locator('img.share-img');
  await expect(img).toHaveAttribute('src', /^blob:http:\/\/localhost:4173\//);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.toast[role=status]')).toContainText('الصورة جاهزة في النافذة');
  expect(await page.evaluate(() => [typeof window.html2canvas, document.querySelectorAll('script[src="js/vendor/html2canvas.min.js"]').length])).toEqual(['function', 1]);
  // block 17's SheetJS: the same <script src="js/vendor/…"> as its loadXLSX
  expect(await page.evaluate(() => new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX.version); sc.onerror = () => rej(new Error(sc.src)); document.head.appendChild(sc);
  }))).toBe('0.20.3');
  expect(refused).toEqual([]);
  // the policy is in force: the old CDN build is refused by script-src
  expect(await page.evaluate(() => new Promise((res) => {
    document.addEventListener('securitypolicyviolation', (e) => res(e.effectiveDirective + ' ' + e.blockedURI), { once: true });
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; document.head.appendChild(sc);
  }))).toBe('script-src-elem https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  await expect.poll(() => refused.length).toBe(1);
});

test('«عرض كـ» another member leaves my server alerts out', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'need')).toContainText('فشل مزامنة WooCommerce');
  await page.locator('#dash-viewas').click();
  await page.getByRole('option', { name: 'سارة أحمد — عمليات' }).click();
  await expect(page.locator('.dash-viewing')).toContainText('سارة أحمد');
  await expect(card(page, 'need')).toBeVisible();
  await expect(card(page, 'need')).not.toContainText('فشل مزامنة WooCommerce'); // the server answered my alerts, not hers
  await expect(card(page, 'need')).not.toContainText('تجميع متأخر IB-1042');
  await page.locator('.notif-btn').click();
  await expect(bellSection(page, 'النظام')).toHaveCount(0);
  await expect(bell(page).locator('.ntf-nav-item').first()).toBeVisible();
});

test.describe('sign-out leaves no member data in memory and keeps the expired message', () => {
  test('in another tab: the SIGNED_OUT it receives reloads it, the members are gone', async ({ page, context }) => {
    mockOnly();
    await signIn(page, ADMIN.id, ADMIN.pw);
    const tabB = await context.newPage();
    const errorsB = []; tabB.on('pageerror', (e) => errorsB.push(e.message));
    await mock.attach(tabB);
    await tabB.goto('/');
    await expect(tabB.locator('#root')).toBeVisible();
    expect(await hasDevMembers(tabB)).toBe(true);
    await markPage(tabB);
    await page.locator('.user-btn').click(); // tab A signs out; supabase-js tells tab B (BroadcastChannel) → SIGNED_OUT there
    await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(tabB.locator('#login')).toBeVisible();
    await expect.poll(() => reloaded(tabB)).toBe(true);
    await expect.poll(() => hasDevMembers(tabB)).toBe(false);
    await expect(tabB.locator('#lg-title')).toHaveText('تسجيل الدخول');
    await expect(tabB.locator('#root')).toBeHidden();
    expect(mock.logoutScopes).toEqual(['local']); // only tab A called the server
    expect(mock.afterLogout).toBe(0); // neither tab asked Supabase anything after the sign-out
    expect(errorsB).toEqual([]);
  });

  test('remember-me off, duplicated tab: its copy of the session goes with the SIGNED_OUT and it stays signed out', async ({ page, context }) => {
    mockOnly();
    await page.clock.install(); // the context's clock: both tabs
    await signIn(page, ADMIN.id, ADMIN.pw, { remember: false }); // the session lives in tab A's sessionStorage only
    const copy = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('sb-')));
    expect(copy.length).toBeGreaterThan(0);
    const tabB = await context.newPage();
    const errorsB = []; tabB.on('pageerror', (e) => errorsB.push(e.message));
    await mock.attach(tabB);
    await tabB.goto('/');
    await expect(tabB.locator('#login')).toBeVisible(); // a new tab starts with an empty sessionStorage
    await tabB.evaluate((entries) => { entries.forEach(([k, v]) => sessionStorage.setItem(k, v)); }, copy); // what a duplicated tab gets
    await tabB.goto('/');
    await expect(tabB.locator('#root')).toBeVisible();
    expect(await hasDevMembers(tabB)).toBe(true);
    await markPage(tabB);
    await page.locator('.user-btn').click();
    await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
    await expect(page.locator('#login')).toBeVisible();
    await expect.poll(() => reloaded(tabB)).toBe(true);
    await expect(tabB.locator('#login')).toBeVisible();
    await expect(tabB.locator('#lg-title')).toHaveText('تسجيل الدخول');
    await expect(tabB.locator('#root')).toBeHidden();
    expect(await hasDevMembers(tabB)).toBe(false);
    expect(await tabB.evaluate(() => [...Object.keys(sessionStorage), ...Object.keys(localStorage)].filter((k) => k.startsWith('sb-')))).toEqual([]);
    await tabB.clock.runFor('00:30');
    await expect(tabB.locator('#root')).toBeHidden(); // still signed out: the gate found no session after the reload
    expect(mock.afterLogout).toBe(0);
    expect(mock.logoutScopes).toEqual(['local']);
    expect(errorsB).toEqual([]);
  });

  test('from the account menu: the members are gone and the page reloaded', async ({ page }) => {
    mockOnly();
    await page.clock.install();
    await signIn(page, ADMIN.id, ADMIN.pw);
    expect(await hasDevMembers(page)).toBe(true);
    await markPage(page);
    await page.locator('.user-btn').click();
    await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
    await expect(page.locator('#login')).toBeVisible();
    await expect.poll(() => hasDevMembers(page)).toBe(false);
    await expect.poll(() => reloaded(page)).toBe(true); // the page reloaded: every in-memory store starts over
    expect(await page.evaluate(() => window.IBKit.store.activity.some((a) => a.action === 'auth.signin'))).toBe(false);
    await expect(page.locator('#lg-title')).toHaveText('تسجيل الدخول');
    await expect(page.locator('#root')).toBeHidden();
    await page.clock.runFor('00:30');
    expect(mock.afterLogout).toBe(0);
  });

  test('after 8 h idle: «الجلسة خلصت» is still up once the page reloaded', async ({ page }) => {
    mockOnly();
    await page.clock.install();
    await signIn(page, ADMIN.id, ADMIN.pw);
    await markPage(page);
    await page.clock.fastForward('08:00:30');
    await expect(page.locator('#lg-title')).toHaveText('الجلسة خلصت');
    await expect.poll(() => reloaded(page), { timeout: 10000 }).toBe(true);
    await expect(page.locator('#lg-title')).toHaveText('الجلسة خلصت');
    await expect(page.locator('#root')).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('ib.loginView'))).toBeNull(); // read once by the gate
    await page.clock.runFor('00:30'); // the idle check runs twice more: the view stays, nothing reaches Supabase
    await expect(page.locator('#lg-title')).toHaveText('الجلسة خلصت');
    expect(mock.logoutScopes).toEqual(['local']);
    expect(mock.afterLogout).toBe(0);
  });
});
