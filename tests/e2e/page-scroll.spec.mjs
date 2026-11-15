import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The page's scroll (the owner 15 Nov — docs/superpowers/plans/2026-11-15-page-scroll.md: «عايز اضيف زرار دائري داخله سهم stickey اقدر ادوس
// عليه يطلعني لبداية الصفحة يبقي علي الشمال تحت و عايز كمان ال scroll bar للسيستم يتنقل لشمال»). A browser keeps the window's scroll bar
// on the right even in a right-to-left page and puts it on the left only for a scrolling element inside the page — so on a desktop
// <body> is the scroller, and window.scrollTo / scrollY (what the pages use) keep meaning «the page». A phone keeps the window's scroll.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function signIn(page, hash) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page.locator('#pg-settings')).toBeVisible();
  // a page far taller than any window, whatever the stand-in's data
  await page.evaluate(() => { const s = document.createElement('div'); s.id = 'tall'; s.style.height = '3000px'; document.querySelector('#pg-settings').appendChild(s); });
}
const state = (page) => page.evaluate(() => ({ html: getComputedStyle(document.documentElement).overflowY, body: getComputedStyle(document.body).overflowY, dir: getComputedStyle(document.body).direction,
  inner: window.IBPageScroll.bodyScrolls(), bodyTop: document.body.scrollTop, docTop: document.documentElement.scrollTop, y: window.scrollY, off: window.pageYOffset }));

test('desktop: <body> scrolls (the scroll bar on the left of the right-to-left page); window.scrollTo / scrollY / scrollBy still mean the page; the sticky bars stay', async ({ page }) => {
  await signIn(page, 'settings');
  expect(await state(page)).toEqual({ html: 'hidden', body: 'auto', dir: 'rtl', inner: true, bodyTop: 0, docTop: 0, y: 0, off: 0 });
  await page.evaluate(() => window.scrollTo(0, 700));
  expect(await state(page)).toMatchObject({ bodyTop: 700, docTop: 0, y: 700, off: 700 });
  await page.evaluate(() => window.scrollBy(0, 50)); expect((await state(page)).y).toBe(750);
  await page.evaluate(() => window.scrollTo({ top: 300 })); expect((await state(page)).bodyTop).toBe(300);
  // the top bar and the side menu keep their place while the page moves under them
  expect(await page.evaluate(() => [Math.round(document.querySelector('.topbar').getBoundingClientRect().top), Math.round(document.querySelector('.sidebar').getBoundingClientRect().top)])).toEqual([0, 0]);
  // the wheel moves the same scroller
  await page.mouse.move(500, 400); await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await state(page)).y).toBe(700);
});

test('«اطلع لأول الصفحة»: a round button at the bottom left, shown once the page is scrolled down; a click takes the page back to its top', async ({ page }) => {
  await signIn(page, 'settings');
  const btn = page.locator('[data-to-top]');
  await expect(btn).toBeHidden(); await expect(btn).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => window.scrollTo(0, 200)); await expect(btn).toBeHidden(); // not for a small move
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(btn).toBeVisible(); await expect(btn).toHaveAttribute('aria-label', 'اطلع لأول الصفحة');
  const box = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { left: Math.round(r.left), fromBottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderTopLeftRadius, pos: cs.position, bg: cs.backgroundColor, arrow: !!el.querySelector('svg path') }; });
  expect(box).toEqual({ left: 20, fromBottom: 20, w: 44, h: 44, radius: '50%', pos: 'fixed', bg: 'rgb(0, 86, 66)', arrow: true }); // bottom left, round, the brand green, an arrow inside
  await btn.click();
  await expect.poll(async () => (await state(page)).y).toBe(0);
  await expect(btn).toBeHidden();
});

test('phone: the window scrolls as before (no inner scroller) and the button sits above the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await signIn(page, 'settings');
  expect(await state(page)).toMatchObject({ html: 'visible', inner: false, y: 0 });
  await page.evaluate(() => window.scrollTo(0, 900));
  expect(await state(page)).toMatchObject({ bodyTop: 0, docTop: 900, y: 900 });
  const btn = page.locator('[data-to-top]');
  await expect(btn).toBeVisible();
  const gap = await page.evaluate(() => { const b = document.querySelector('[data-to-top]').getBoundingClientRect(); const n = document.querySelector('.bottom-nav').getBoundingClientRect(); return { left: Math.round(b.left), above: Math.round(n.top - b.bottom) }; });
  expect(gap.left).toBe(12); expect(gap.above).toBeGreaterThanOrEqual(8);
  await btn.click();
  await expect.poll(async () => (await state(page)).y).toBe(0);
});
