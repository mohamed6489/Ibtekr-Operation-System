import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «دودة اللوجو» (the owner 15 Nov — docs/superpowers/plans/2026-11-15-preloader.md): «عايزك تعملي preloader لاي loading يحصل في السيستم و
// اي اكشن يف السيستم يتعمله loading و عايز احول اللوجو … لدودة راسها النقطة الخضراء المنفصلة تلف كانيميشن حول اللوجو». Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'holds requests of the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1280, height: 800 });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
// a gate on some requests: they wait until it is opened (the answer is the mock's own)
function gate(page, pattern, method) {
  let open; const opened = new Promise((r) => { open = r; });
  return page.route(pattern, async (route) => { if (!method || route.request().method() === method) await opened; await route.fallback(); }).then(() => open);
}
const slow = (page, pattern, method, ms) => page.route(pattern, async (route) => { if (!method || route.request().method() === method) await new Promise((r) => setTimeout(r, ms)); await route.fallback(); });
const pill = (page, text) => page.locator('.busy-stack .busy-pill', { hasText: text });
async function signIn(page) {
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}

test('the first-paint cover: the logo\'s worm while the app boots, off when the sign-in screen shows; a signed-in tab reloaded keeps it until the app is drawn', async ({ page }) => {
  // the last script held back: the page is painted, the app has not booted
  const boot = await gate(page, '**/js/blocks/28-app.js');
  await page.goto('/', { waitUntil: 'commit' });
  const cover = page.locator('#ib-boot');
  await expect(cover).toBeVisible();
  await expect(cover).toHaveAttribute('role', 'status');
  // the worm: the green head and the gold body on the logo's track, moving
  await expect(cover.locator('svg.ib-worm .w-head')).toHaveCSS('stroke', 'rgb(1, 86, 66)');
  await expect(cover.locator('svg.ib-worm .w-body')).toHaveCSS('stroke', 'rgb(201, 162, 89)');
  await expect(cover.locator('svg.ib-worm .w-head')).toHaveCSS('animation-name', 'ib-worm-head');
  await expect(cover.locator('svg.ib-worm .w-body')).toHaveCSS('animation-name', 'ib-worm-body');
  const moved = await cover.locator('svg.ib-worm .w-head').evaluate(async (p) => { const a = getComputedStyle(p).strokeDashoffset; await new Promise((r) => setTimeout(r, 500)); return [a, getComputedStyle(p).strokeDashoffset]; });
  expect(moved[0]).not.toBe(moved[1]);
  await expect(page.locator('#login')).toHaveCount(0);
  boot();
  await expect(page.locator('#login')).toBeVisible();
  await expect(cover).toHaveCount(0); // gone, and never over the form
  await signIn(page);
  // a reload of the signed-in tab: the cover stays while the member's rows load, then the app
  const rows = await gate(page, '**/rest/v1/profiles*');
  await page.reload({ waitUntil: 'commit' });
  await expect(cover).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  rows();
  await expect(page.locator('#root')).toBeVisible();
  await expect(cover).toHaveCount(0);
  await expect(page.locator('#login')).toBeHidden();
});

test('any action: a slow sign-in, a slow save and a slow read the member started each show the running pill with the worm; a quick one and a background read show nothing', async ({ page }) => {
  await slow(page, '**/auth/v1/token*', 'POST', 900);
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(pill(page, 'بندخّلك…')).toBeVisible();
  await expect(pill(page, 'بندخّلك…').locator('.busy-ico.worm svg.ib-worm .w-head')).toHaveCSS('animation-name', 'ib-worm-head'); // the worm, not the ring
  await expect(page.locator('#root')).toBeVisible();
  await expect(pill(page, 'بندخّلك…')).toHaveCount(0, { timeout: 8000 });

  // a save: the deposit of an order, held for a second
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  await expect(page.locator('.busy-stack .busy-pill')).toHaveCount(0, { timeout: 8000 });
  await slow(page, '**/rest/v1/orders?*', 'PATCH', 1100);
  const dep = page.locator('#orders input[data-dep="181668"]');
  await dep.fill('500'); await dep.press('Tab');
  await expect(pill(page, 'بنحفظ…')).toBeVisible();
  await expect(pill(page, 'بنحفظ…').locator('svg.ib-worm')).toBeVisible();
  await expect.poll(() => mock.orders.find((o) => o.id === 181668).deposit).toBe(500);
  await expect(pill(page, 'بنحفظ…')).toHaveCount(0, { timeout: 8000 });
  // a quick save (the same field, not held this time): no pill at all
  await page.unroute('**/rest/v1/orders?*');
  const shown = () => page.evaluate(() => document.querySelectorAll('.busy-stack .busy-pill').length);
  await dep.fill('250'); await dep.press('Tab');
  await expect.poll(() => mock.orders.find((o) => o.id === 181668).deposit).toBe(250);
  await page.waitForTimeout(700); expect(await shown()).toBe(0);

  // a read: the products page loads its mirror when it is first opened — held, so its own «بنحمّل…» note and the pill both carry the worm
  const products = await gate(page, '**/rest/v1/products?*', 'GET');
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await expect(pill(page, 'بنحمّل…')).toBeVisible();
  const loading = page.locator('#pg-products .note.is-loading');
  await expect(loading).toContainText('بنحمّل المنتجات…');
  await expect(loading.locator('svg.ib-worm')).toHaveCount(1); // dressed once, however often the page is drawn
  products();
  await expect(loading).toHaveCount(0);
  await expect(pill(page, 'بنحمّل…')).toHaveCount(0, { timeout: 8000 });

  // a background read (nobody pressed anything for a while): the request goes, no pill
  await page.waitForTimeout(3200);
  await slow(page, '**/rest/v1/acc_expenses*', 'GET', 1000);
  await page.evaluate(() => { window.IBAccounts.load({ quiet: true }); });
  await page.waitForTimeout(800); expect(await shown()).toBe(0);
});
