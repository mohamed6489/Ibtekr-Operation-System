import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Errors on the screen (the owner 17 Nov — «… بيجيب صفحة فاضية … عايز لو ده حصل يطلع زرار اعمل رفريش» and «لو حصل ايرور في اي حاجة
// يطلعلي بوباب بالغلط عشان ابعتهولك»): any uncaught error shows a card with its text, «نسخ الخطأ», «اعمل رفريش» and «إغلاق»; a page gone
// blank shows the card in the middle; each error is logged as `app.crash` with its kind and file:line only. A normal page shows nothing.
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null;
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  mock = await installSupabaseMock(page);
});
async function signIn(page) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

test('a working page never shows the guard; the sign-in screen neither', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.waitForTimeout(3600);
  await expect(page.locator('[data-crash]')).toHaveCount(0);
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.waitForTimeout(3600);
  await expect(page.locator('[data-crash]')).toHaveCount(0);
});

test('any uncaught error: a popup with its text, «نسخ الخطأ» copies a report, «إغلاق» closes; the same error twice shows once; the log has no text', async ({ page, context }) => {
  page.on('pageerror', () => {}); // the errors below are the point of the test
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await page.evaluate(() => { for (let i = 0; i < 2; i++) setTimeout(() => { throw new TypeError('x is undefined 01012345678'); }); });
  const card = page.locator('[data-crash]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('حصل خطأ في السيستم');
  await expect(card.locator('[data-crash-text]')).toContainText('TypeError: x is undefined');
  await expect.poll(() => card.locator('[data-crash-text]').innerText()).not.toMatch(/x is undefined[\s\S]*x is undefined/); // once
  await expect(page.locator('.sidebar')).toBeVisible(); // the page goes on under it
  await card.getByRole('button', { name: 'نسخ الخطأ' }).click();
  await expect(card.getByRole('button', { name: 'اتنسخ ✓' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('نظام إبتكر — خطأ'); expect(copied).toContain('TypeError: x is undefined');
  const row = mock.activity.find((a) => a.action === 'app.crash');
  expect(row.new_value.kind).toBe('TypeError');
  expect(JSON.stringify(row)).not.toContain('undefined'); expect(JSON.stringify(row)).not.toContain('0101');
  await card.getByRole('button', { name: 'إغلاق' }).click();
  await expect(card).toHaveCount(0);
  // noise the browser makes on its own is no error of ours
  await page.evaluate(() => { setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }); Promise.reject(new DOMException('The user aborted a request.', 'AbortError')); });
  await page.waitForTimeout(800);
  await expect(page.locator('[data-crash]')).toHaveCount(0);
});

test('the app gone blank after an error: «اعمل رفريش» shows, the error is logged by kind and place only, and the button reloads', async ({ page }) => {
  page.on('pageerror', () => {}); // the error below is the point of the test
  await signIn(page);
  await page.evaluate(() => { document.getElementById('root').replaceChildren(); setTimeout(() => { throw new TypeError('secret text 01012345678'); }); });
  const card = page.locator('[data-crash]');
  await expect(card).toContainText('الصفحة وقفت', { timeout: 8000 });
  await expect(card).toHaveClass(/blank/);
  await expect(card.locator('[data-crash-text]')).toContainText('TypeError: secret text');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'app.crash').length).toBe(1);
  const row = mock.activity.find((a) => a.action === 'app.crash');
  expect(row.new_value.kind).toBe('TypeError');
  expect(JSON.stringify(row)).not.toContain('secret'); // the text is on the member's screen only
  expect(JSON.stringify(row)).not.toContain('0101');
  const reloaded = page.waitForEvent('load');
  await card.getByRole('button', { name: 'اعمل رفريش' }).click();
  await reloaded;
  await expect(page.locator('[data-crash]')).toHaveCount(0);
});

test('a page scrolled past its end with nothing on the screen counts as blank too', async ({ page }) => {
  await signIn(page);
  // nothing painted anywhere on the screen: every part of the app hidden (as when a page is left far past its end)
  await page.addStyleTag({ content: '#root, #root * { visibility: hidden !important; }' });
  await expect(page.locator('[data-crash]')).toContainText('الصفحة وقفت', { timeout: 8000 });
  await expect(page.locator('[data-crash] [data-crash-text]')).toContainText('مفيش خطأ ظاهر');
});
