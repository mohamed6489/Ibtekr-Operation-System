import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, SUPABASE_URL, TOTP_CODE } from './supabase-mock.mjs';
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

async function signIn(page, id, pw, { remember = true } = {}) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', id);
  await page.fill('#lg-pw', pw);
  if (!remember) await page.getByRole('checkbox', { name: 'افتكرني على الجهاز ده' }).click();
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

// ---- fix round 1: aal2 at the gate, password recovery, idle clock and remember-me across loads ----
const TWOFA = 'twofa.dev@ibtekr.local'; // mock-only user with a verified TOTP factor
const title = (page) => page.locator('#lg-title');

test('2FA: wrong code is refused, the right one opens the app', async ({ page }) => {
  mockOnly();
  await signIn(page, TWOFA, DEV_PW);
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  expect(mock.requests.filter((r) => r.includes('/rest/v1/profiles'))).toEqual([]); // nothing loaded before aal2
  await page.fill('#lg-code', '000000');
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(loginError(page)).toContainText('الكود غلط أو انتهى');
  await expect(page.locator('#root')).toBeHidden();
  await page.fill('#lg-code', TOTP_CODE);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('.topbar .user-btn')).toContainText('محمد علي');
});

test('2FA: reloading on the code screen does not skip it', async ({ page }) => {
  mockOnly();
  await signIn(page, TWOFA, DEV_PW);
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  await page.reload();
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  await expect(page.locator('#root')).toBeHidden();
  expect(mock.requests.filter((r) => r.includes('/rest/v1/profiles'))).toEqual([]);
});

test('password recovery link shows the reset form, then the login view', async ({ page }) => {
  mockOnly();
  await page.goto('/#' + mock.recoveryFragment('admin.dev@ibtekr.local'));
  await expect(title(page)).toHaveText('كلمة مرور جديدة');
  await expect(page.locator('#root')).toBeHidden();
  await page.fill('#lg-p1', 'NewPass2026');
  await page.fill('#lg-p2', 'NewPass2026');
  await page.getByRole('button', { name: 'حفظ ودخول', exact: true }).click();
  await expect(title(page)).toHaveText('تسجيل الدخول');
  expect(mock.userUpdates).toEqual([expect.objectContaining({ email: 'admin.dev@ibtekr.local', password: 'NewPass2026' })]);
  await expect.poll(() => mock.logouts).toBe(1);
  await expect(page.locator('#root')).toBeHidden();
});

test('idle for 8h+ across a reload ends the session', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('ib.lastAct', String(Date.now() - 9 * 3600 * 1000)));
  await page.reload();
  await expect(title(page)).toHaveText('الجلسة خلصت');
  await expect(page.locator('#root')).toBeHidden();
  await expect.poll(() => mock.logouts).toBe(1);
});

test('remember-me off keeps the session in sessionStorage only', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw, { remember: false });
  await expect(page.locator('#root')).toBeVisible();
  const keys = await page.evaluate(() => ({ local: Object.keys(localStorage).filter((k) => k.startsWith('sb-')), session: Object.keys(sessionStorage).filter((k) => k.startsWith('sb-')) }));
  expect(keys.local).toEqual([]);
  expect(keys.session.length).toBeGreaterThan(0);
  await page.reload(); // same tab: still signed in
  await expect(page.locator('#root')).toBeVisible();
});

test('remember-me on keeps the session in localStorage', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  const keys = await page.evaluate(() => ({ local: Object.keys(localStorage).filter((k) => k.startsWith('sb-')), session: Object.keys(sessionStorage).filter((k) => k.startsWith('sb-')) }));
  expect(keys.local.length).toBeGreaterThan(0);
  expect(keys.session).toEqual([]);
});
