import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
// The owner 16 Nov («ال dropdowns بتبعد لما بدوس علي 3 نقط وانا عامل scroll لتحت … المفروض دايما تبقي تحت ال3نقط بالظبط و نفس الكلام
// يبقي علي اي حاجة بفتجها 3 نقط»): on every page, with the page scrolled, a menu opened by «⋮» (or «فلتر») sits right under its button —
// or right above it when there is no room under it — and stays on it while the page scrolls. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
/** the last button on the screen (under the sticky bars, above the bottom) of a selector */
async function onScreen(page, sel) {
  const vh = page.viewportSize().height; const all = page.locator(sel);
  await expect(all.first()).toBeAttached();
  for (let i = (await all.count()) - 1; i >= 0; i--) {
    const b = await all.nth(i).boundingBox();
    if (b && b.width && b.y > 130 && b.y + b.height < vh - 8) return all.nth(i);
  }
  throw new Error('no button on the screen: ' + sel);
}
/** the menu is glued to its button: its top right under it, or its bottom right above it */
async function glued(btn, menu, what) {
  await expect.poll(async () => {
    const b = await btn.boundingBox(); const m = await menu.boundingBox();
    if (!b || !m) return 'missing';
    const under = Math.abs(m.y - (b.y + b.height)) <= 8; const over = Math.abs(m.y + m.height - b.y) <= 8;
    return under || over ? 'glued' : `${what}: button ${Math.round(b.y)}–${Math.round(b.y + b.height)}, menu ${Math.round(m.y)}–${Math.round(m.y + m.height)}`;
  }, { timeout: 3000 }).toBe('glued');
}
async function check(page, btnSel, menuSel, what) {
  // the last such button brought to the middle of the screen — the page is scrolled down to it
  await expect(page.locator(btnSel).first()).toBeAttached();
  await page.locator(btnSel).last().evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY), what + ': the page scrolled').toBeGreaterThan(0);
  const btn = await onScreen(page, btnSel);
  await btn.click();
  const menu = page.locator(menuSel).last();
  await expect(menu).toBeVisible();
  await glued(btn, menu, what);
  // the page scrolls while it is open → it follows the button
  await page.evaluate(() => window.scrollBy(0, -50)); await page.waitForTimeout(100);
  await glued(btn, menu, what + ' (scrolled)');
  await page.keyboard.press('Escape');
}

test('«⋮» and «فلتر» in the orders page stay under their button on a scrolled page', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 420 });
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await check(page, '[data-more]', '#mpop', 'orders ⋮');
  await page.evaluate(() => window.scrollTo(0, 99999));
  const fb = page.locator('#fbtn');
  await fb.click();
  await glued(fb, page.locator('#fbpop'), 'orders فلتر');
  await page.evaluate(() => window.scrollBy(0, -40)); await page.waitForTimeout(100);
  await glued(fb, page.locator('#fbpop'), 'orders فلتر (scrolled)');
});

for (const [hash, tab, label] of [['makers', 'سجل المبتكرين', 'makers'], ['inventory', 'سجل المخزون', 'inventory'], ['settings-team', null, 'settings › team'], ['products', 'سجل المنتجات', 'products']]) {
  test(`«⋮» in ${label} stays under its button on a scrolled page`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 340 });
    await signIn(page);
    await page.evaluate((x) => { location.hash = x; }, hash);
    if (tab) await page.locator('main:not([hidden]) [role=tab]', { hasText: tab }).first().click();
    await expect(page.locator('main:not([hidden]) button[aria-haspopup=menu]').first()).toBeAttached();
    await page.waitForLoadState('networkidle');
    // the mock's short pages: room above the content, so the page has to scroll down to the button
    await page.evaluate(() => { document.querySelector('main:not([hidden])').style.paddingTop = '700px'; });
    await check(page, 'main:not([hidden]) button[aria-haspopup=menu]', '[role=menu]', label + ' ⋮');
  });
}
