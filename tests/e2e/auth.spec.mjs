import { test, expect } from '@playwright/test';
import { installSupabaseMock, installLiveConfig, LIVE, LIVE_MISSING, DEV_PW, SUPABASE_URL, TOTP_CODE } from './supabase-mock.mjs';
// Dev users from tools/seed-dev-users.sql. Mocked by default; E2E_SUPABASE_LIVE=1 runs against the staging project in E2E_SUPABASE_URL/E2E_SUPABASE_ANON_KEY.
const env = process.env;
const ADMIN = LIVE ? { id: env.E2E_ADMIN_EMAIL, pw: env.E2E_ADMIN_PW } : { id: 'admin.dev@ibtekr.local', pw: DEV_PW };
const OPS_PW = LIVE ? env.E2E_OPS_PW : DEV_PW;
const VIEWER_PW = LIVE ? env.E2E_VIEWER_PW : DEV_PW;
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  if (LIVE) {
    test.skip(!!LIVE_MISSING, LIVE_MISSING);
    test.skip(!ADMIN.id || !ADMIN.pw || !OPS_PW || !VIEWER_PW, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PW/E2E_OPS_PW/E2E_VIEWER_PW not set');
    await installLiveConfig(page);
  } else mock = await installSupabaseMock(page);
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
  if (!LIVE) expect(mock.lookups).toEqual([]); // an email goes straight to GoTrue: no lookup RPC
});

test('arabic-digit phone identifier works', async ({ page }) => {
  await signIn(page, '٠١٠٠٠٠٠٠٠٠٢', OPS_PW);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('.topbar .user-btn')).toContainText('سارة أحمد'); // header follows the signed-in member (M02)
  if (!LIVE) expect(mock.lookups).toEqual(['01000000002']); // a phone still goes through the lookup
});

test('session survives a reload', async ({ page }) => {
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('nav.sidebar .nav-item')).toHaveCount(10);
  await expect(page.locator('#login')).toHaveCount(0);
});

const sbKeys = (page) => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('sb-')));

test('suspended account is refused (phone: no password sent, no session stored)', async ({ page }) => {
  await signIn(page, '01000000099', VIEWER_PW);
  await expect(page.locator('#lg-title')).toHaveText('الحساب موقوف');
  await expect(page.locator('#root')).toBeHidden();
  if (!LIVE) expect(mock.requests.filter((r) => r === 'POST /auth/v1/token')).toEqual([]);
  expect(await sbKeys(page)).toEqual([]);
});

test('suspended account is refused (email: signed in by GoTrue, then signed out by the profile check)', async ({ page }) => {
  await signIn(page, 'viewer.dev@ibtekr.local', VIEWER_PW);
  await expect(page.locator('#lg-title')).toHaveText('الحساب موقوف');
  await expect(page.locator('#root')).toBeHidden();
  if (!LIVE) expect(mock.lookups).toEqual([]);
  if (!LIVE) expect(mock.logoutScopes).toEqual(['local']);
  expect(await sbKeys(page)).toEqual([]);
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
  if (!LIVE) await expect.poll(() => mock.logoutScopes).toEqual(['local']); // this device only
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
  await expect.poll(() => mock.logoutScopes).toEqual(['local']);
  await page.clock.runFor('02:00'); // timers keep running: nothing reaches Supabase after the logout
  expect(mock.afterLogout).toBe(0);
});

test('idle counts activity in any tab: an active second tab keeps the first one signed in', async ({ page, context }) => {
  mockOnly();
  await page.clock.install(); // the context's clock: both tabs share it
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  const tabB = await context.newPage();
  await mock.attach(tabB);
  await tabB.goto('/');
  await expect(tabB.locator('#root')).toBeVisible();
  await page.clock.setSystemTime(Date.now() + 9 * 3600 * 1000); // tab A's in-memory lastAct is now 9 h back; no timer fired
  await tabB.evaluate(() => localStorage.setItem('ib.lastAct', String(Date.now()))); // tab B in use
  await page.clock.runFor('01:00'); // tab A's idle check runs (every 15 s)
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  expect(mock.logouts).toBe(0);
});

test('«خروج من كل الأجهزة» ends the other sessions only', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'profile-security'; });
  await page.getByRole('button', { name: 'خروج من كل الأجهزة', exact: true }).click();
  await page.getByRole('button', { name: 'خروج من الكل', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toHaveText('اتعمل خروج من الأجهزة التانية');
  expect(mock.logoutScopes).toEqual(['others']);
  await expect(page.locator('#root')).toBeVisible();
});

test('a stalled activity log does not hold the screen: login shows at once, the logout follows', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  mock.activityDelayMs = 10000;
  await page.locator('.user-btn').click();
  await page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click();
  await expect(page.locator('#login')).toBeVisible({ timeout: 1000 });
  await expect(page.locator('#root')).toBeHidden({ timeout: 1000 });
  await expect.poll(() => mock.logoutScopes, { timeout: 6000 }).toEqual(['local']); // after the 3 s cap on the log
});

test('«ابعت تاني» on the sent view sends the reset link again; no demo link button', async ({ page }) => {
  mockOnly();
  await page.goto('/');
  await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click();
  await page.fill('#lg-fid', 'admin.dev@ibtekr.local');
  await page.getByRole('button', { name: 'ابعت اللينك', exact: true }).click();
  await expect(title(page)).toHaveText('اللينك اتبعت');
  await expect(page.getByRole('button', { name: 'فتح اللينك (تجربة)' })).toHaveCount(0);
  expect(mock.recovers).toEqual(['admin.dev@ibtekr.local']);
  await page.getByRole('button', { name: 'ابعت تاني', exact: true }).click();
  await expect.poll(() => mock.recovers).toEqual(['admin.dev@ibtekr.local', 'admin.dev@ibtekr.local']);
  await expect(page.locator('.toast[role=status]')).toHaveText('اتبعت تاني');
});

test('rate-limited lookup asks to wait a minute', async ({ page }) => {
  mockOnly();
  mock.rateLimited = true;
  await signIn(page, '01000000001', ADMIN.pw); // only phone sign-in uses the (rate-limited) lookup
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
  await expect.poll(() => mock.logoutScopes).toEqual(['global']); // a reset ends every session of the user
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

// ---- fix round 2: a typed #type=recovery is not a recovery; the assurance check fails closed ----
const typedRecovery = async (page) => { await page.evaluate(() => { location.hash = 'type=recovery'; }); await page.reload(); };

test('typed #type=recovery on a stale stored session → session ended, no reset form', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('ib.lastAct', String(Date.now() - 9 * 3600 * 1000)));
  await typedRecovery(page);
  await expect(title(page)).toHaveText('الجلسة خلصت');
  await expect(page.locator('#root')).toBeHidden();
  await expect.poll(() => mock.logouts).toBe(1);
  expect(mock.userUpdates).toEqual([]);
});

test('typed #type=recovery on an active stored session → the app, never the reset form', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await typedRecovery(page);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#login')).toHaveCount(0);
  expect(mock.userUpdates).toEqual([]);
});

test('typed #type=recovery on an aal1 2FA session → still the 2FA view', async ({ page }) => {
  mockOnly();
  await signIn(page, TWOFA, DEV_PW);
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  await typedRecovery(page);
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  await expect(page.locator('#root')).toBeHidden();
});

test('#login-reset on an everyday session cannot change the password', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'login-reset'; });
  await expect(title(page)).toHaveText('كلمة مرور جديدة');
  await page.fill('#lg-p1', 'NewPass2026');
  await page.fill('#lg-p2', 'NewPass2026');
  await page.getByRole('button', { name: 'حفظ ودخول', exact: true }).click();
  await expect(loginError(page)).toContainText('معرفناش نحفظ كلمة المرور');
  expect(mock.userUpdates).toEqual([]);
});

test('unreadable assurance level fails closed (login, #root hidden)', async ({ page }) => {
  mockOnly();
  await signIn(page, ADMIN.id, ADMIN.pw);
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('sb-')); const s = JSON.parse(localStorage.getItem(k)); s.access_token = 'x.y.z'; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload();
  await expect(title(page)).toHaveText('تسجيل الدخول');
  await expect(page.locator('#root')).toBeHidden();
  expect(mock.requests.filter((r) => r.includes('/rest/v1/profiles'))).toHaveLength(1); // only the first sign-in's load
});
