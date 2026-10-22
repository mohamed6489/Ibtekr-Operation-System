import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, SUPABASE_URL } from './supabase-mock.mjs';
// Dev users from tools/seed-dev-users.sql. Mocked by default; E2E_SUPABASE_LIVE=1 runs against the real project.
const env = process.env;
const ADMIN = LIVE ? { id: env.E2E_ADMIN_EMAIL, pw: env.E2E_ADMIN_PW } : { id: 'admin.dev@ibtekr.local', pw: DEV_PW };
const OPS_PW = LIVE ? env.E2E_OPS_PW : DEV_PW;
const VIEWER_PW = LIVE ? env.E2E_VIEWER_PW : DEV_PW;
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  if (LIVE) test.skip(!ADMIN.id || !ADMIN.pw || !OPS_PW || !VIEWER_PW, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PW/E2E_OPS_PW/E2E_VIEWER_PW not set');
  else mock = await installSupabaseMock(page);
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
}
const loginError = (page) => page.locator('#login .login-card');

test('signs in and lands on dashboard', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('nav.sidebar .nav-item')).toHaveCount(10);
  await expect(page).not.toHaveTitle('تسجيل الدخول — نظام إبتكر');
  if (!LIVE) await expect.poll(() => mock.activity.map((a) => a.action)).toContain('auth.signin');
});

test('arabic-digit phone identifier works', async ({ page }) => {
  await signIn(page, '٠١٠٠٠٠٠٠٠٠٢', OPS_PW);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('.topbar .user-btn')).toContainText('سارة أحمد'); // header follows the signed-in member (M02)
});

test('session survives a reload', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('nav.sidebar .nav-item')).toHaveCount(10);
  await expect(page.locator('#login')).toHaveCount(0);
});

test('suspended account is refused', async ({ page }) => {
  await signIn(page, 'viewer.dev@ibtekr.local', VIEWER_PW);
  await expect(page.locator('#lg-title')).toHaveText('الحساب موقوف');
  await expect(page.locator('#root')).toBeHidden();
});

test('wrong password shows remaining attempts', async ({ page }) => {
  await signIn(page, ADMIN.id, 'not-the-password-1');
  await expect(loginError(page)).toContainText('فاضل 4 محاولات');
  await expect(page.locator('#root')).toBeHidden();
});

test('logout returns to login', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.user-btn').click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  if (!LIVE) await expect.poll(() => mock.logouts).toBe(1);
  if (!LIVE) expect(mock.activity.map((a) => a.action)).toContain('auth.signout');
});

test('8h idle signs out of Supabase and shows the expired view', async ({ page }) => {
  mockOnly();
  await page.clock.install();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.clock.fastForward('08:00:30');
  await expect(page.locator('#lg-title')).toHaveText('الجلسة خلصت');
  await expect(page.locator('#root')).toBeHidden();
  await expect.poll(() => mock.logouts).toBe(1);
});

test('rate-limited lookup asks to wait a minute', async ({ page }) => {
  mockOnly();
  mock.rateLimited = true;
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(loginError(page)).toContainText('محاولات كتير — استنى دقيقة وجرّب تاني');
  await expect(page.locator('#root')).toBeHidden();
});

test('missing anon key says the system is not connected', async ({ page }) => {
  await page.addInitScript((url) => { window.IB_CONFIG = { supabaseUrl: url, supabaseAnonKey: '' }; }, SUPABASE_URL);
  await signIn(page, ADMIN.id || 'admin.dev@ibtekr.local', ADMIN.pw || 'x');
  await expect(loginError(page)).toContainText('النظام مش متوصّل بقاعدة البيانات — راجع config.js');
  await expect(page.locator('#root')).toBeHidden();
});
