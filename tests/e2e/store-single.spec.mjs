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

test('«تفعيل البيع الفردي» says «قريبًا» until it is finished (no switch) — the makers page stays in the menu', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('.sidebar .nav-item[data-page="vendors"]')).toBeVisible();
  await page.evaluate(() => { location.hash = 'settings-general'; });
  const sec = page.locator('[data-store-sec]');
  await expect(sec).toContainText('WooCommerce');
  await expect(sec).toContainText('قريبًا');
  await expect(page.locator('[data-store-single]')).toHaveCount(0);
  expect(storeRow()).toBeNull();
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

test('single mode: the margin is saved from «عام»', async ({ page }) => {
  setStore({ mode: 'single' });
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-general'; });
  const m = page.locator('[data-store-margin]');
  await expect(m).toHaveValue('30');
  await m.fill('45'); await m.press('Tab');
  await expect.poll(() => storeRow()).toEqual({ mode: 'single', margin: 45 });
});

test('single mode: the studio\'s second step is «البراند» (its name + the SKU code) — no maker', async ({ page }) => {
  setStore({ mode: 'single' });
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal'); await expect(m).toContainText('دفعة منتجات جديدة');
  await m.getByRole('radio', { name: /شيت جاهز/ }).click();
  await m.getByRole('radio', { name: /^Simple/ }).click();
  await m.locator('[data-flow-start]').click();
  await expect(page.locator('#pg-products ol.wstepper')).toContainText('البراند');
  await expect(page.locator('#pg-products ol.wstepper').first()).not.toContainText('المبتكر');
});

test('marketplace (default): the studio\'s second step is «المبتكر»', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal');
  await m.getByRole('radio', { name: /شيت جاهز/ }).click();
  await m.getByRole('radio', { name: /^Simple/ }).click();
  await m.locator('[data-flow-start]').click();
  await expect(page.locator('#pg-products ol.wstepper').first()).toContainText('المبتكر');
});

test('Shopify and EasyOrders say «قريبًا» until the system runs on them: the platforms row in «عام» and their cards in «الربط بالمنصات» (no link button)', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'settings-general'; });
  const row = page.locator('[data-store-platforms]');
  await expect(row).toContainText('WooCommerce ✓');
  await expect(row).toContainText('Shopify · قريبًا');
  await expect(row).toContainText('EasyOrders · قريبًا');
  await page.evaluate(() => { location.hash = 'settings-integrations'; });
  await expect(page.locator('[data-integ="woo"]')).toBeVisible();
  const eo = page.locator('[data-integ="easyorders"]');
  await expect(eo).toContainText('قريبًا');
  await expect(eo.locator('[data-integ-soon]')).toBeDisabled();
  const sh = page.locator('[data-integ="shopify"]');
  if (await sh.count()) { await expect(sh).toContainText('قريبًا'); await expect(sh.locator('[data-integ-connect]')).toHaveCount(0); }
});
