import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «تخصيص اللوحة» on every page (phase 10 decision 22 — the v5 prototype's PanelButton, the owner's «دلوقتي لكل الصفحات»): the
// blocks of a page or tab (number cards, sections, tables) are read from the page, hidden or reordered by the grip (mouse or
// keyboard) and saved for the member in user_prefs ('panel.prefs' = { [pageKey]: { order, hidden } }); «رجوع للافتراضي» drops the
// key; a page with fewer than two blocks hides the button; the reports tabs, the inbox and the moves log have no button. Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function open(page, email, hash) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const go = (page, hash) => page.evaluate((x) => { location.hash = x; }, hash);
const modal = (page) => page.locator('.modal[role=dialog]', { hasText: 'تخصيص اللوحة' });
const row = (page, id) => modal(page).locator('[data-pn-item="' + id + '"]');
const panelPref = () => { const p = mock.prefs.find((x) => x.key === 'panel.prefs'); return p ? p.data : null; };
const kpi = (scope, label) => scope.locator('.kpi[aria-label="' + label + '"]');

test('HR «الفريق والحضور»: hide a card and move «الفريق» to the top by the keyboard — saved for me in user_prefs, kept across tabs, «رجوع للافتراضي» drops it', async ({ page }) => {
  await open(page, ADMIN, 'hr-team');
  const P = page.locator('#pg-hr .panel');
  await expect(kpi(P, 'أنهوا الدوام')).toBeVisible();
  await page.locator('[data-pn-custom="hr:team"]').click();
  await expect(modal(page)).toContainText('تخصيص اللوحة — الموارد البشرية — الفريق والحضور');
  await expect(modal(page).locator('[data-pn-item]')).toHaveText([/حاضرين دلوقتي/, /أنهوا الدوام/, /إجازة \/ غياب/, /طلبات مستنية/, /الفريق/]);
  await row(page, 'أنهوا الدوام').getByRole('switch').click();
  for (let i = 0; i < 4; i += 1) {
    await row(page, 'الفريق').locator('[data-grip]').focus();
    await page.keyboard.press('ArrowUp');
    await expect(modal(page).locator('[data-pn-item]').nth(3 - i)).toHaveAttribute('data-pn-item', 'الفريق');
  }
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(kpi(P, 'أنهوا الدوام')).toBeHidden();
  await expect(kpi(P, 'حاضرين دلوقتي')).toBeVisible();
  // «الفريق»'s section comes before the number cards (the blocks as the kit reads them)
  const firstIsTeam = () => page.evaluate(() => { const root = document.querySelector('#pg-hr .panel'); const items = window.IBKit.panelItems(root); const kids = [...root.children];
    const at = (id) => kids.indexOf((items.find((x) => x.id === id) || {}).blk); return at('الفريق') >= 0 && at('الفريق') < at('حاضرين دلوقتي'); });
  await expect.poll(firstIsTeam).toBe(true);
  await expect.poll(() => mock.prefs.filter((x) => x.key === 'panel.prefs').map((x) => x.user_id)).toEqual([ADMIN_ID]);
  expect(panelPref()).toEqual({ 'hr:team': { order: ['الفريق', 'حاضرين دلوقتي', 'أنهوا الدوام', 'إجازة / غياب', 'طلبات مستنية'], hidden: ['أنهوا الدوام'] } });
  // another tab has its own choice; coming back keeps mine
  await go(page, 'hr-settings');
  await expect(page.locator('[data-pn-custom="hr:settings"]')).toBeVisible();
  await go(page, 'hr-team');
  await expect(kpi(P, 'أنهوا الدوام')).toBeHidden();
  await expect.poll(firstIsTeam).toBe(true);
  // «رجوع للافتراضي»: everything back where it was, the key gone
  await page.locator('[data-pn-custom="hr:team"]').click();
  await modal(page).locator('[data-pn-reset]').click();
  await expect(kpi(P, 'أنهوا الدوام')).toBeVisible();
  await expect.poll(firstIsTeam).toBe(false);
  await expect.poll(panelPref).toEqual({});
});

test('at least one block stays visible: hiding them all is refused and nothing is saved', async ({ page }) => {
  await open(page, ADMIN, 'inventory-consolidate');
  await page.locator('[data-pn-custom="inventory:consolidate"]').click();
  const rows = modal(page).locator('[data-pn-item]');
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i += 1) await rows.nth(i).getByRole('switch').click();
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('سيب بلوك واحد على الأقل ظاهر');
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await expect(kpi(page.locator('#pg-inventory .panel'), 'أوردرات بتتجمع')).toBeVisible();
  expect(panelPref()).toBe(null);
});

test('my saved choice from the server applies on sign-in, per page and tab: makers, customer service, accounts', async ({ page }) => {
  mock.prefs.push({ user_id: ADMIN_ID, key: 'panel.prefs', data: { makers: { order: ['المبتكرين'], hidden: ['مواصلات المبتكرين'] }, 'cs:customers': { order: [], hidden: ['عملاء متكررين'] }, 'accounts:expenses': { order: [], hidden: ['الإعلانات'] } } });
  await open(page, ADMIN, 'makers');
  const V = page.locator('#vendors');
  await expect(kpi(V, 'مواصلات المبتكرين')).toBeHidden();
  await expect(kpi(V, 'مبتكرين نشطين')).toBeVisible();
  // the table first: its card comes before the number cards
  expect(await page.evaluate(() => { const kids = [...document.getElementById('vendors').children]; return kids.findIndex((c) => c.classList.contains('table-card')) < kids.findIndex((c) => c.classList.contains('cards')); })).toBe(true);
  await page.locator('[data-pn-custom="makers"]').click();
  await expect(row(page, 'مواصلات المبتكرين').getByRole('switch')).not.toBeChecked();
  await expect(modal(page).locator('[data-pn-item]').first()).toHaveAttribute('data-pn-item', 'المبتكرين');
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await go(page, 'cs-customers');
  await expect(kpi(page.locator('#pg-cs .cs-body'), 'عملاء متكررين')).toBeHidden();
  await expect(kpi(page.locator('#pg-cs .cs-body'), 'إجمالي العملاء')).toBeVisible();
  await go(page, 'expenses');
  const card = (t) => page.locator('#panel .cards > *', { hasText: t }).first();
  await expect(card('الإعلانات')).toBeHidden();
  await expect(card('المرتبات')).toBeVisible();
  // the sales tab is its own key: nothing hidden there
  await go(page, 'sales');
  await expect(page.locator('[data-pn-custom="accounts:sales"]')).toBeVisible();
  await expect(page.locator('#panel .cards > [hidden]')).toHaveCount(0);
});

test('the choice is mine: another member signs in to the default page', async ({ page }) => {
  mock.prefs.push({ user_id: ADMIN_ID, key: 'panel.prefs', data: { makers: { order: [], hidden: ['مبتكرين نشطين'] } } });
  await open(page, OPS, 'makers');
  await expect(kpi(page.locator('#vendors'), 'مبتكرين نشطين')).toBeVisible();
  await expect(page.locator('[data-pn-custom="makers"]')).toBeVisible();
});

test('a page with one block hides the button; the reports tabs, the inbox and the moves log have none', async ({ page }) => {
  await open(page, ADMIN, 'products-records');
  await expect(page.locator('#pg-products .panel')).toBeVisible();
  await expect(page.locator('[data-pn-custom="products:records"]')).toBeHidden();
  await go(page, 'tickets');
  await expect(page.locator('#tickets .table-card')).toBeVisible();
  await expect(page.locator('[data-pn-custom="tickets"]')).toBeHidden();
  await go(page, 'hr-reports');
  await expect(page.locator('#pg-hr #tab-reports')).toHaveAttribute('aria-selected', 'true'); // (the report's own blocks depend on the hour)
  await expect(page.locator('#pg-hr .panel')).toBeVisible();
  await expect(page.locator('[data-pn-custom^="hr:"]')).toHaveCount(0);
  await go(page, 'cs-inbox');
  await expect(page.locator('#pg-cs .cs-body')).toBeVisible();
  await expect(page.locator('[data-pn-custom^="cs:"]')).toHaveCount(0);
  await go(page, 'moves-log');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('[data-pn-custom^="accounts:"]')).toHaveCount(0);
  await go(page, 'inventory-reports');
  await expect(page.locator('#pg-inventory .panel')).toBeVisible();
  await expect(page.locator('[data-pn-custom^="inventory:"]')).toHaveCount(0);
});

test('a block keeps its choice when its count or month changes: the id has # for a number and ‹شهر› for a month', async ({ page }) => {
  await open(page, ADMIN, 'dashboard');
  const ids = await page.evaluate(() => {
    const el = (tag, cls, text, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; kids.forEach((k) => e.append(k)); return e; };
    const root = el('div', null, null,
      el('div', 'cards', null, el('div', 'kpi', null, el('div', 'kpi-label', 'طلبات مستنية (3)')), el('div', 'kpi', null, el('div', 'kpi-label', 'رجعت للمخزن (أكتوبر)'))),
      el('section', 'card table-card', null, el('div', 'table-title', null, el('h2', null, 'المصروفات — 1 نوفمبر – 5 نوفمبر'))),
      el('section', 'card', null, el('div', 'sec-h', null, el('h2', null, 'كشف نوفمبر 2026'))),
      el('section', 'card', null, el('div', 'sec-h', null, el('h2', null, 'كشف نوفمبر 2026'))),
      el('p', 'source', 'المصدر: …'));
    return window.IBKit.panelItems(root).map((x) => x.kind + ':' + x.id + ':' + x.label);
  });
  expect(ids).toEqual(['رقم:طلبات مستنية (#):طلبات مستنية (3)', 'رقم:رجعت للمخزن (‹شهر›):رجعت للمخزن (أكتوبر)', 'جدول:المصروفات:المصروفات — 1 نوفمبر – 5 نوفمبر', 'قسم:كشف ‹شهر› #:كشف نوفمبر 2026', 'قسم:كشف ‹شهر› # #2:كشف نوفمبر 2026']);
});

test('a block the page itself renders hidden stays hidden: only what the customization hid comes back', async ({ page }) => {
  await open(page, ADMIN, 'dashboard');
  const r = await page.evaluate(() => {
    const K = window.IBKit;
    const el = (tag, cls, text, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; kids.forEach((k) => e.append(k)); return e; };
    const tile = (t, hide) => { const e = el('div', 'kpi', null, el('div', 'kpi-label', t)); if (hide) e.hidden = true; return e; };
    const build = () => el('div', null, null, el('div', 'cards', null, tile('أ'), tile('ب'), tile('ج', true)), el('section', 'card', null, el('div', 'sec-h', null, el('h2', null, 'قسم'))));
    const root = build(); document.body.append(root);
    const vis = () => [...root.querySelectorAll('.kpi')].map((x) => (x.hidden ? 0 : 1)).join('');
    K.applyPanelPrefs('probe:x', root); const plain = vis(); // nothing saved: ج stays as the page drew it
    K.store.panelPrefs = { [K.ME]: { 'probe:x': { order: [], hidden: ['ب'] } } };
    K.applyPanelPrefs('probe:x', root); const hidB = vis();
    K.store.panelPrefs = { [K.ME]: {} };
    K.applyPanelPrefs('probe:x', root); const back = vis(); // ب comes back, ج does not
    root.remove(); return { plain, hidB, back };
  });
  expect(r).toEqual({ plain: '110', hidB: '100', back: '110' });
});

test('customer service: the campaigns list has the button; the campaign wizard has none', async ({ page }) => {
  await open(page, ADMIN, 'cs-campaigns');
  const P = page.locator('#pg-cs');
  await expect(page.locator('[data-pn-custom="cs:campaigns"]')).toBeVisible();
  await P.getByRole('button', { name: 'حملة جديدة' }).click();
  await expect(P.locator('#wz-name')).toBeVisible();
  await expect(page.locator('[data-pn-custom^="cs:"]')).toHaveCount(0);
});
