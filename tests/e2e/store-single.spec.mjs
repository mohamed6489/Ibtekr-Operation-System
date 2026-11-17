import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Single-seller mode (docs/superpowers/plans/2026-11-17-stores-single.md T2 — the owner 17 Nov: «زرار اسموا تفعيل البيع الفردي بيلغي
// المبتكرين و الاوردرات الفرعية»): the switch in «الإعدادات › عام» writes the row «store»; then the makers' page leaves the menu, the
// accounts and reports lose their makers' tabs, the orders page calls the lines «المنتجات» without a sub-order number or a maker, and
// «خدمة المبتكرين الذكية» leaves «الذكاء الاصطناعي». Off again = everything back. Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1500, height: 900 });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const storeRow = () => ((mock.settings || []).find((r) => r.section === 'store') || {}).data || null;
const setStore = (data) => { mock.settings = (mock.settings || []).filter((r) => r.section !== 'store').concat([{ section: 'store', data, updated_at: '2026-11-17T10:00:00Z', updated_by: null }]); };

test('the switch in «عام» writes the row «store» after a confirm — off by default, the makers page in the menu', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('.sidebar .nav-item[data-page="vendors"]')).toBeVisible();
  await page.evaluate(() => { location.hash = 'settings-general'; });
  const sw = page.locator('[data-store-single]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-store-sec]')).toContainText('WooCommerce');
  await page.evaluate(() => { window.__noReload = true; location.reload = () => { window.__reloaded = true; }; });
  await sw.click();
  await expect(page.locator('.modal[role=dialog]')).toContainText('مفيش داتا هتتمسح');
  await page.locator('.modal[role=dialog]').getByRole('button', { name: 'فعّل البيع الفردي' }).click();
  await expect.poll(() => storeRow()).toEqual({ mode: 'single' });
});

test('single mode: no makers page, no makers tabs in accounts and reports, the order lines are «المنتجات» without a maker', async ({ page }) => {
  setStore({ mode: 'single' });
  await signIn(page);
  await expect(page.locator('.sidebar .nav-item[data-page="vendors"]')).toBeHidden();
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await expect(page.locator('#main [role=tab]:visible', { hasText: 'المصروفات' }).first()).toBeVisible();
  await expect(page.locator('#main [role=tab]:visible', { hasText: 'حسابات المبتكرين' })).toHaveCount(0);
  await page.locator('.sidebar .nav-item[data-page="reports"]').click();
  await expect(page.locator('#reports [role=tab]', { hasText: 'تقارير الأوردرات' }).first()).toBeVisible();
  await expect(page.locator('#reports [role=tab]', { hasText: 'تقارير المبتكرين' })).toHaveCount(0);
  await page.locator('.sidebar .nav-item[data-page="orders"]').click();
  await page.waitForTimeout(800);
  const txt = await page.evaluate(() => { const el = document.getElementById('orders'); const r = el && el.shadowRoot; if (!r) return ''; const tg = r.querySelector('[data-tg]'); if (tg) tg.click(); return new Promise((res) => setTimeout(() => res(r.textContent), 400)); });
  expect(txt).toContain('المنتجات (');
  expect(txt).not.toContain('الأوردرات الفرعية (');
  await page.evaluate(() => { location.hash = 'settings-general'; });
  await expect(page.locator('[data-store-single]')).toHaveAttribute('aria-checked', 'true');
});

test('a store without Dokan (Shopify) is single and the switch is locked', async ({ page }) => {
  setStore({ platform: 'shopify' });
  await signIn(page);
  await expect(page.locator('.sidebar .nav-item[data-page="vendors"]')).toBeHidden();
  await page.evaluate(() => { location.hash = 'settings-general'; });
  await expect(page.locator('[data-store-sec]')).toContainText('شغّال دايمًا مع Shopify');
  await expect(page.locator('[data-store-single]')).toHaveCount(0);
});

test('single mode: a column headed «المبتكر» leaves every table (the products records), and stays out through the columns prefs', async ({ page }) => {
  setStore({ mode: 'single' });
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'سجل المنتجات' }).click();
  const table = page.locator('#pg-products table.pr-table').first();
  await expect(table).toBeVisible();
  await expect(table.locator('thead th:visible', { hasText: 'SKU' })).toHaveCount(1);
  await expect(table.locator('thead th:visible', { hasText: /^المبتكر$/ })).toHaveCount(0);
});

test('marketplace (default): the products records keep «المبتكر»', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'سجل المنتجات' }).click();
  await expect(page.locator('#pg-products table.pr-table thead th:visible', { hasText: /^المبتكر$/ }).first()).toBeVisible();
});

test('single mode: the dashboard has no makers\' tiles or cards', async ({ page }) => {
  setStore({ mode: 'single' });
  await signIn(page);
  await page.evaluate(() => { location.hash = 'dashboard'; });
  await expect(page.locator('.dash-kpis .kpi').first()).toBeVisible();
  await expect(page.locator('.dash-kpis', { hasText: 'رصيد المبتكرين' })).toHaveCount(0);
  await expect(page.locator('.dash-kpis', { hasText: 'مبتكرين متأخرين' })).toHaveCount(0);
  await expect(page.locator('.dash-grid', { hasText: 'المبتكرين المحتاجين متابعة' })).toHaveCount(0);
});
