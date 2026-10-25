import { test, expect } from '@playwright/test';
import { installSupabaseMock, installLiveConfig, LIVE, LIVE_MISSING, DEV_PW } from './supabase-mock.mjs';
// The dashboard on the signed-in member (phase 1): role frame, customization saved per user on the server, «آخر نشاط» from
// the server log, sign-out wipes the page's memory. Dev users of tools/seed-dev-users.sql; mocked by default,
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

async function signIn(page, id, pw) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id);
  await page.fill('#lg-pw', pw);
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

test('a customization the server refused stays on this device and says so', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  mock.prefsDown = true;
  await customizeButton(page).click();
  await cardSwitch(page, 'الفريق دلوقتي').click();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(card(page, 'team')).toHaveCount(0);
  await expect(page.locator('.toast[role=status]')).toHaveText('اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر');
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

test('a server-log update does not redraw the dashboard under an open menu', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(card(page, 'activity')).toContainText('سجّل دخول');
  await page.getByRole('button', { name: '+ إجراء سريع', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('ib:activity'))); // as IBActivity.refresh() does
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('ib:activity'))); // no overlay: the card redraws as before
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

test.describe('sign-out leaves no member data in memory and keeps the expired message', () => {
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
