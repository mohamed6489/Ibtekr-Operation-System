import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Phase 13 decision 17 (the owner, 10 Nov: «لما ادوس علي اي صفحة يجيبلي الصفحة الرئيسية ليها»): a click on a menu item — the sidebar,
// the mobile bottom nav and its «المزيد» sheet — always opens the page's main view, whatever the page remembered (a tab, a product
// being edited, a campaign step, the settings section), even when it is the current page. Direct links keep opening their exact spot,
// and the unsaved-changes guard of the product editor still asks first. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const at = (page, hash) => page.evaluate((x) => { location.hash = x; }, hash);
const menu = (page, id) => page.locator('.sidebar .nav-item[data-page="' + id + '"]');
const url = (page, hash) => expect(page).toHaveURL(new RegExp('#' + hash + '$'));

// The meeting of 23 Nov — phase 1 (docs/superpowers/plans/2026-11-23-meeting.md): the filter follows the table's columns [#1], the
// periods open on «هذا الشهر» with their dates [#4, #5], no filter on by default [#6] and the team requests' tabs on the one tabs component.

test('[#1, Q2] the orders filter builder lists the fields a member filters on: a number = five choices, a date = a period, the makers = فردي / جماعي', async ({ page }) => {
  await signIn(page);
  await at(page, 'orders'); await expect(page.locator('#orders')).toBeVisible();
  await page.locator('#orders #fbtn').click();
  await page.locator('#fbpop [data-fbadd="r"]').click();
  const fld = page.locator('#fbpop select.fld').last();
  const names = await fld.locator('option').allTextContents();
  for (const gone of ['رقم الأوردر', 'اسم العميل', 'الهاتف', 'تعليق خدمة العملاء', 'رقم تتبع بوسطة', 'متأكد؟', 'عمر الأوردر (يوم)']) expect(names).not.toContain(gone);
  expect(names).toEqual(expect.arrayContaining(['حالة الأوردر', 'المبتكر', 'إجمالي القيمة', 'العربون', 'تاريخ الأوردر', 'عدد المبتكرين']));
  await fld.selectOption('tot');
  await expect(page.locator('#fbpop select.opr').last().locator('option')).toHaveText(['يوجد', 'لا يوجد', 'أعلى من صفر', 'أقل من صفر', 'يساوي صفر']);
  await expect(page.locator('#fbpop input[data-fbv]')).toHaveCount(0); // no number typed
  await page.locator('#fbpop select.fld').last().selectOption('date');
  await expect(page.locator('#fbpop [data-fbrange] input[type=date]')).toHaveCount(2);
  await page.locator('#fbpop select.fld').last().selectOption('mk');
  await expect(page.locator('#fbpop select.val').last().locator('option')).toHaveText(['— اختار —', 'فردي (مبتكر واحد)', 'جماعي (أكتر من مبتكر)']);
  // a quick filter still works on its inner fields, and shows its own condition
  await page.locator('#fbpop [data-qf="one"]').click();
  await page.locator('#orders #fbtn').click();
  await expect(page.locator('#fbpop select.fld option[value="live"]')).toHaveCount(1);
});

test('[#1, #6] the makers filter = the table\'s columns and nothing is on by default', async ({ page }) => {
  await signIn(page);
  await menu(page, 'vendors').click();
  await page.locator('#vendors [role=tab]', { hasText: 'سجل المبتكرين' }).click();
  await expect(page.locator('#vendors .af-row .af-chip:visible')).toHaveCount(0);
  await page.locator('#vendors [data-fm-btn="vendors"]').click();
  await expect(page.locator('[data-fm-menu="vendors"] [data-fm-tab] .fm-tl')).toHaveText(['الحالة', 'البراندات', 'النسبة', 'أوردرات مفتوحة', 'قابلة للتأخير', 'مستحقاته', 'آخر أوردر']);
  await page.locator('[data-fm-menu="vendors"] [data-fm-tab="last"]').click();
  await expect(page.locator('[data-fm-menu="vendors"] input[data-fm-range^="last:"]')).toHaveCount(2);
});

test('[#4, #5] a period opens on «هذا الشهر» and its button names the dates — a log too, «كل الفترات» is a choice', async ({ page }) => {
  await signIn(page);
  await at(page, 'reports'); await expect(page.locator('.date-field').first()).toBeVisible();
  const lbl = await page.locator('.date-field .range-label').first().textContent();
  expect(lbl).toMatch(/^الفترة: 1 /); expect(lbl).not.toContain('كل الفترات');
  await at(page, 'products-log');
  const log = page.locator('[data-log-period="products"]');
  await expect(log.locator('.range-label')).toContainText('الفترة: 1 ');
  await log.locator('[data-log-all="products"]').click();
  await expect(log.locator('.range-label')).toHaveText('كل الفترات');
});

test('the team requests: no «مفتوحة» on by default, the tabs are the pages\' tabs', async ({ page }) => {
  await signIn(page);
  await menu(page, 'tickets').click();
  const tabs = page.getByRole('tablist', { name: 'أقسام الطلبات' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: /السجل/ }).click();
  await expect(page.locator('#tickets .af-row .af-chip:visible')).toHaveCount(0);
});

test('[#2] the total row sums the rows the search leaves, «إجمالي النتايج» while it is on, and comes back after', async ({ page }) => {
  await signIn(page);
  await at(page, 'sales');
  const card = page.locator('.card', { hasText: 'تفاصيل المبيعات حسب حالة الأوردر' }).first();
  const foot = card.locator('tfoot tr').first();
  await expect(foot.locator('td').first()).toHaveText('الإجمالي');
  const row = card.locator('tbody tr', { hasText: 'مكتملة' });
  const n = (await row.locator('td').nth(1).textContent()).trim();
  await card.locator('[data-tq-btn]').click();
  await card.locator('[data-tq-row] input').fill('مكتملة');
  await expect(foot.locator('td').first()).toHaveText('إجمالي النتايج');
  await expect(foot.locator('td').nth(1)).toHaveText(n);
  await card.locator('[data-tq-row] input').fill('');
  await expect(foot.locator('td').first()).toHaveText('الإجمالي');
});

test('[#32] desktop: the checkbox column and the name after it stay fixed while the makers table scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await signIn(page);
  await menu(page, 'vendors').click();
  await page.locator('#vendors [role=tab]', { hasText: 'سجل المبتكرين' }).click();
  const t = page.locator('#vendors table.sticky-sel').first();
  await expect(t).toBeVisible();
  const pos = await t.evaluate((x) => { const r = x.querySelector('tbody tr'); const c = (i) => getComputedStyle(r.children[i]); return [c(0).position, c(1).position, c(2).position, parseInt(c(1).insetInlineStart || c(1).right, 10) > 0]; });
  expect(pos).toEqual(['sticky', 'sticky', 'static', true]);
});
