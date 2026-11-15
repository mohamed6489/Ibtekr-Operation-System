import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
// The owner's comments on «نسخة التعليقات» — batch 2 (docs/superpowers/plans/2026-11-15-comments.md): one case a comment (or a small
// group on the same screen), named by the comment's number there. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function signIn(page, email = ADMIN) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const go = async (page, hash) => { await page.evaluate((x) => { location.hash = x; }, hash); };
const box = async (loc) => loc.first().boundingBox();

test('comment 4 — makers › «حسابات المبتكرين»: «تحديث من Dokan» sits with the head\'s buttons at the end of the card, right before «بحث»', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'makers');
  await page.locator('#vendors [role=tablist][aria-label="أقسام المبتكرين"] [role=tab]', { hasText: 'حسابات المبتكرين' }).click();
  const head = page.locator('#vpanel section.card .table-title').first();
  const refresh = await box(head.locator('[data-dokan-refresh]')); const search = await box(head.locator('[data-tq-btn]')); const title = await box(head.locator('h2'));
  // RTL: the title at the right; the page's button directly at the right of «بحث», no gap of free space between them
  expect(refresh.x).toBeGreaterThan(search.x + search.width - 1);
  expect(refresh.x - (search.x + search.width)).toBeLessThan(24);
  expect(title.x).toBeGreaterThan(refresh.x + refresh.width + 80);
  // the accounts page's own tab is the same card
  await go(page, 'accounts-vendors');
  const head2 = page.locator('#rpanel section.card .table-title, main:not([hidden]) section.card .table-title').filter({ has: page.locator('[data-dokan-refresh]') }).first();
  const r2 = await box(head2.locator('[data-dokan-refresh]')); const s2 = await box(head2.locator('[data-tq-btn]'));
  expect(r2.x - (s2.x + s2.width)).toBeLessThan(24);
});

test('comment 5 — orders: a confirmation date typed on a confirmed order goes to «تاريخ تبليغ المبتكر» of its lines at once (0103)', async ({ page }) => {
  await signIn(page);
  await go(page, 'orders');
  await expect(page.locator('#orders')).toBeVisible();
  await page.evaluate(() => window.OrdersApp.toggle && window.OrdersApp.toggle('181668'));
  const o = mock.orders.find((x) => x.id === 181668); o.confirm = 'مؤكد بدون عربون';
  await page.evaluate(() => window.IBOrders.refetch('181668'));
  const cd = page.locator('#orders input[data-fi="cd:181668"]');
  await cd.fill('01/11/2026'); await cd.press('Enter');
  await expect.poll(() => mock.patches.some((p) => p.table === 'orders' && p.id === 181668 && p.confirm_at === '2026-11-01')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.OrdersApp.get('181668').subs.map((s) => s.exp))).toEqual(['2026-11-01', '2026-11-01']);
  // a date moved — typed straight into the field that kept the focus (the picker shut after the first save): it is saved all the
  // same; the lines still on the old confirmation date follow, one set by hand to another day stays
  mock.orderItems.find((i) => i.id === 5002).expected_at = '2026-11-03';
  await page.evaluate(() => window.IBOrders.refetch('181668'));
  await page.locator('#orders input[data-fi="cd:181668"]').fill('05/11/2026'); await page.locator('#orders input[data-fi="cd:181668"]').press('Enter');
  await expect.poll(() => page.evaluate(() => window.OrdersApp.get('181668').subs.map((s) => s.exp).sort())).toEqual(['2026-11-03', '2026-11-05']);
});

test('comment 6 — the customer\'s file: every section in a box of its own with a clear green edit button, like the maker\'s drawer; the other tabs boxed too', async ({ page }) => {
  await signIn(page);
  await go(page, 'cs-customers');
  await expect(page.locator('#pg-cs')).toBeVisible();
  await page.evaluate(() => { const S = window.IBCS.data; const cu = S.customers.find((c) => c.orders > 0) || S.customers[0]; window.IBPages.all().cs.api.peekCustomer(cu.id); });
  const d = page.locator('.drawer[aria-label^="ملف العميل"]');
  await expect(d).toBeVisible();
  const boxes = d.locator('[data-cu-boxes] > .pn-s');
  await expect(boxes.filter({ hasText: 'أرقام الشراء' })).toHaveCount(1);
  expect(await boxes.count()).toBeGreaterThanOrEqual(5);
  for (const title of ['أرقام الشراء', 'التقييم والحالة', 'بيانات التواصل والعناوين', 'الموافقات', 'ملاحظات الفريق']) {
    const b = boxes.filter({ has: page.locator('.pn-h h3', { hasText: title }) });
    await expect(b).toHaveCount(1);
    const st = await b.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopWidth, c.borderTopStyle, parseFloat(c.borderTopLeftRadius) > 0, parseFloat(c.paddingTop) >= 8]; });
    expect(st).toEqual(['1px', 'solid', true, true]);
  }
  // the edit of a box: a filled green button in its head (not a bare text link)
  const edit = boxes.filter({ hasText: 'بيانات التواصل والعناوين' }).locator('.pn-h > button', { hasText: 'تعديل' });
  const look = await edit.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
  expect(look[0]).toBe('rgb(0, 86, 66)');
  expect(look[1]).not.toBe('rgb(0, 86, 66)');
  // six numbers as tiles, three a row
  const tiles = boxes.filter({ hasText: 'أرقام الشراء' }).locator('.kvc');
  await expect(tiles).toHaveCount(6);
  const [a, b3, c4] = [await box(tiles.nth(0)), await box(tiles.nth(2)), await box(tiles.nth(3))];
  expect(Math.abs(a.y - b3.y)).toBeLessThan(2); expect(c4.y).toBeGreaterThan(a.y + a.height - 1);
  // the other tabs: one box each
  await d.getByRole('tab', { name: /الأوردرات/ }).click();
  await expect(d.locator('[data-cu-boxes] > .pn-s')).toHaveCount(1);
  await expect(d.locator('[data-cu-boxes] > .pn-s .pn-h h3')).toHaveText('أوردرات العميل');
  await d.getByRole('tab', { name: 'السجل' }).click();
  await expect(d.locator('[data-cu-boxes] > .pn-s .pn-h h3')).toHaveText('سجل العميل');
});

test('comment 8 — HR › «الفريق»: a member\'s name opens their data in a drawer (boxes like the maker\'s drawer) with «افتح ملف العضو»; the page stays where it is until that button', async ({ page }) => {
  await signIn(page);
  await go(page, 'hr');
  await page.locator('#pg-hr [role=tab]', { hasText: 'الفريق والحضور' }).click();
  const link = page.locator('#pg-hr table a[data-member-link="M02"]');
  await expect(link).toBeVisible();
  await link.click();
  const d = page.locator('.drawer[data-member-drawer="M02"]');
  await expect(d).toBeVisible();
  await expect(page).not.toHaveURL(/#member-M02/); // still on the HR page
  const name = await page.evaluate(() => window.IBHR.member('M02').name);
  await expect(d.locator('h2')).toHaveText(name);
  for (const title of ['البيانات الأساسية', 'التواصل', 'النهارده', 'الشهر ده', 'مستني قرار', 'العقد']) await expect(d.locator('.vsection .head h3', { hasText: title })).toHaveCount(1);
  await expect(d.locator('.vsection').first()).toContainText('M02');
  // a box's action is the page's own (the manual attendance popup)
  await d.locator('[data-md-att], [data-md-end]').first().click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await link.click();
  await page.locator('.drawer [data-member-open="M02"]').click();
  await expect(page).toHaveURL(/#member-M02$/);
  await expect(page.locator('.drawer[data-member-drawer]')).toHaveCount(0);
  // ctrl-click keeps the plain link (a new tab) — the drawer is not opened
  expect(await page.evaluate(() => { location.hash = 'hr'; return true; })).toBe(true);
});

test('comment 9 — «إضافة مبتكر» in steps: بيانات المبتكر · بيانات الدخول · بيانات المتجر · الحساب البنكي والعقد — «التالي» checks its own step, a done step is a click back, «إضافة المبتكر» on the last step only; editing a maker stays one form', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await go(page, 'makers/new');
  const m = page.locator('.modal.mk-modal');
  await expect(m).toBeVisible();
  const steps = m.locator('.mk-steps li');
  await expect(steps).toHaveText([/بيانات المبتكر/, /بيانات الدخول/, /بيانات المتجر/, /الحساب البنكي والعقد/]);
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  // the first step: «التالي» only (no «السابق», no «إضافة المبتكر»), and only its own fields
  await expect(m.locator('[data-mk-next]')).toHaveText('التالي');
  await expect(m.locator('[data-mk-prev]')).toHaveCount(0);
  await expect(m.getByRole('button', { name: 'إضافة المبتكر' })).toHaveCount(0);
  await expect(m.locator('#v-name')).toBeVisible();
  await expect(m.locator('#v-login-email')).toHaveCount(0); await expect(m.locator('#v-bank-method')).toHaveCount(0);
  for (const i of [1, 2, 3]) await expect(steps.nth(i).locator('button')).toBeDisabled(); // a step not reached yet is not a way round the checks
  // «التالي» with the step empty: it stays, with its own mistakes
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(m.locator('#v-name-err')).toBeVisible();
  await m.locator('#v-name').fill('Step Maker');
  await m.locator('#v-cat').click(); await page.locator('[data-mp-menu] [role=menuitemcheckbox]', { hasText: 'ديكور' }).click(); await page.locator('[data-mp-menu] [data-mp-done]').click();
  await m.locator('#v-phone').fill('01000000055');
  await m.locator('[data-mk-next]').click();
  // step 2: the login — the username from the name; an empty e-mail stops «التالي» here
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'login');
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(m.locator('#v-login-user')).toHaveValue('step.maker');
  await expect(m.locator('#v-name')).toHaveCount(0);
  await expect(m.locator('[data-mk-prev]')).toHaveText('السابق');
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'login');
  await expect(m.locator('#v-login-email-err')).toBeVisible();
  await m.locator('#v-login-email').fill('step.dev@ibtekr.local'); await m.locator('[data-genpw]').click();
  // «السابق» goes back with everything kept; the done step's own button too
  await m.locator('[data-mk-prev]').click();
  await expect(m.locator('#v-name')).toHaveValue('Step Maker');
  await m.locator('[data-mk-next]').click();
  await expect(m.locator('#v-login-email')).toHaveValue('step.dev@ibtekr.local');
  await m.locator('[data-mk-next]').click();
  // step 3: the store
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'store');
  await expect(m.getByRole('switch', { name: 'اعمل له متجر على الموقع' })).toBeVisible();
  await steps.nth(0).locator('button').click(); // a done step is one click away
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'maker');
  await expect(steps.nth(2).locator('button')).toBeDisabled(); // forward is «التالي» only — every step is checked on the way
  await m.locator('[data-mk-next]').click(); await m.locator('[data-mk-next]').click();
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'store');
  await m.locator('[data-mk-next]').click();
  // step 4: the bank and the contract — the only step with «إضافة المبتكر»
  await expect(m.locator('[data-mk-body]')).toHaveAttribute('data-mk-body', 'bank');
  await expect(m.locator('#v-bank-method')).toBeVisible(); await expect(m.locator('[data-v-contract]')).toHaveCount(1);
  await expect(m.locator('[data-mk-next]')).toHaveText('إضافة المبتكر');
  await expect(m.locator('[data-mk-next]')).toHaveAttribute('data-mk-next', 'add');
  await m.locator('[data-mk-next]').click();
  await expect(page.locator('.drawer .drawer-h h2')).toHaveText('Step Maker');
  // the popup fits a phone: the steps in one row, nothing wider than the screen
  await page.locator('.drawer').getByRole('button', { name: 'إغلاق' }).first().click();
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, 'makers/new');
  await expect(m).toBeVisible();
  const mb = await box(m); expect(mb.x).toBeGreaterThanOrEqual(0); expect(mb.x + mb.width).toBeLessThanOrEqual(390);
  const sb = await box(m.locator('.mk-steps')); expect(sb.x).toBeGreaterThanOrEqual(mb.x - 1); expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + mb.width + 1);
});
