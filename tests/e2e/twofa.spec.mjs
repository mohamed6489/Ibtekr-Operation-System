import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, TOTP_CODE, TOTP_SECRET } from './supabase-mock.mjs';
// Two-step verification from «ملفي» › الحساب والأمان (phase 2 Task 7): the Authenticator app is the only live channel (WhatsApp /
// email wait for the WhatsApp bridge); enrolment = Supabase MFA enroll → QR + key → 6-digit code → mark_twofa_enrolled
// (profiles.twofa from the server, aal2 only); the next sign-in asks for the code; «إيقاف» needs an aal2 session.
// Mock only: the cases assert what the mock recorded (factors, profiles.twofa, the RPC calls); E2E_SUPABASE_LIVE=1 skips them.
const OPS = 'ops.dev@ibtekr.local'; const TWOFA = 'twofa.dev@ibtekr.local'; // M02 (no 2FA yet) and M03 (a verified TOTP factor)
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its factors and profiles)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
  // nothing secret ever reaches the activity log: no code, no key
  expect(JSON.stringify(mock.activity)).not.toContain(TOTP_CODE);
  expect(JSON.stringify(mock.activity)).not.toContain(TOTP_SECRET);
});

const profile = (code) => mock.profiles.find((p) => p.member_code === code);
const title = (page) => page.locator('#lg-title');
const dialog = (page) => page.getByRole('dialog', { name: 'تفعيل التحقق بخطوتين' });
const heading = (page) => page.getByRole('heading', { name: 'التحقق بخطوتين', exact: true });
const section = (page) => page.locator('section.sec', { has: heading(page) }); // the «التحقق بخطوتين» card of the security tab
async function password(page, email, { open = true } = {}) {
  if (open) await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
}
async function signIn(page, email) {
  await password(page, email);
  await expect(page.locator('#root')).toBeVisible();
}
// the sign-in's second step: the code screen, then the app
async function code(page) {
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  await expect(page.locator('#root')).toBeHidden();
  await page.fill('#lg-code', TOTP_CODE);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function security(page) {
  await page.evaluate(() => { location.hash = 'profile-security'; });
  await expect(heading(page)).toBeVisible();
}
// «تسجيل الخروج» shows the login view, signs out, then reloads the page: wait for that load before typing again
async function signOut(page) {
  await page.locator('.user-btn').click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('menuitem', { name: 'تسجيل الخروج' }).click()]);
  await expect(page.locator('#login')).toBeVisible();
  expect(mock.logoutScopes).toEqual(['local']);
}
// «تفعيل» → step 1 (the channel) → «كمّل» → step 2 (QR + key)
async function startEnrol(page) {
  await section(page).getByRole('button', { name: 'تفعيل', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'كمّل', exact: true }).click();
  await expect(dialog(page).getByRole('img', { name: 'كود QR لتطبيق Authenticator' })).toBeVisible();
}

test('enrol with the authenticator app, then the next sign-in asks for the code', async ({ page }) => {
  await signIn(page, OPS);
  await security(page);
  await expect(section(page)).toContainText('مش مفعّل');
  await startEnrol(page);
  // the QR is the data: URI from Supabase and it decodes (the raw SVG's '#' survived); the key is shown as text
  const qr = dialog(page).getByRole('img', { name: 'كود QR لتطبيق Authenticator' });
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  await expect.poll(() => qr.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog(page).locator('code')).toHaveText(TOTP_SECRET);
  expect(mock.enrolls).toEqual([{ id: expect.stringMatching(/^f-new-/), friendly_name: 'Authenticator', aal: 'aal1' }]);
  await dialog(page).getByRole('button', { name: 'كمّل', exact: true }).click();
  await dialog(page).locator('#tfa-code').fill(TOTP_CODE);
  await dialog(page).getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(dialog(page)).toContainText('اتفعّل');
  await expect(dialog(page)).toContainText('لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية');
  await expect(dialog(page)).not.toContainText('أكواد احتياطية في مكان آمن');
  expect(profile('M02').twofa).toBe(true);
  expect(mock.twofaCalls).toEqual([{ fn: 'mark_twofa_enrolled', aal: 'aal2', result: 'ok' }]);
  expect(mock.factors.filter((f) => f.user_id === profile('M02').id).map((f) => f.status)).toEqual(['verified']);
  await dialog(page).getByRole('button', { name: 'خلصت', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(section(page)).toContainText('مفعّل — تطبيق Authenticator'); // from the directory (the server's twofa)
  await expect(section(page).getByRole('button', { name: 'إيقاف', exact: true })).toBeVisible();
  await expect.poll(() => mock.activity.filter((a) => a.action === 'profile.2fa.enable').map((a) => [a.new_value, a.aal])).toEqual([['Authenticator', 'aal2']]);

  // out and back in: the password alone is not enough any more
  await signOut(page);
  const before = mock.requests.filter((r) => r.includes('/rest/v1/profiles')).length;
  await password(page, OPS, { open: false });
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  expect(mock.requests.filter((r) => r.includes('/rest/v1/profiles'))).toHaveLength(before); // nothing loaded before aal2
  await code(page);
  await expect(page.locator('nav.sidebar .nav-item')).toHaveCount(10);
  await expect(page.locator('.topbar .user-btn')).toContainText('سارة أحمد');
});

test('whatsapp / email options are disabled', async ({ page }) => {
  await signIn(page, OPS);
  await security(page);
  await section(page).getByRole('button', { name: 'تفعيل', exact: true }).click();
  const radios = dialog(page).getByRole('radio');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toContainText('واتساب');
  await expect(radios.nth(1)).toContainText('إيميل');
  for (const i of [0, 1]) {
    await expect(radios.nth(i)).toBeDisabled();
    await expect(radios.nth(i)).toContainText('بعد تشغيل جسر واتساب');
    await expect(radios.nth(i)).toHaveAttribute('aria-checked', 'false');
  }
  await expect(radios.nth(2)).toContainText('تطبيق Authenticator');
  await expect(radios.nth(2)).toBeEnabled();
  await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  expect(mock.enrolls).toEqual([]); // nothing enrolled before «كمّل»
  await dialog(page).getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  expect(profile('M02').twofa).toBe(false);
});

test('wrong code keeps the dialog', async ({ page }) => {
  await signIn(page, OPS);
  await security(page);
  await startEnrol(page);
  await dialog(page).getByRole('button', { name: 'كمّل', exact: true }).click();
  await dialog(page).locator('#tfa-code').fill('000000');
  await dialog(page).getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(dialog(page)).toContainText('الكود غلط — جرّب تاني');
  await expect(dialog(page).locator('#tfa-code')).toBeVisible();
  expect(profile('M02').twofa).toBe(false);
  expect(mock.twofaCalls).toEqual([]); // the server flag is never asked for on a wrong code
  expect(mock.factors.filter((f) => f.user_id === profile('M02').id).map((f) => f.status)).toEqual(['unverified']);
  // the right code still works in the same dialog
  await dialog(page).locator('#tfa-code').fill(TOTP_CODE);
  await dialog(page).getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(dialog(page)).toContainText('اتفعّل');
  expect(profile('M02').twofa).toBe(true);
});

test('the server refuses the flag: the new factor is removed again and the dialog starts over', async ({ page }) => {
  mock.twofaRefused = true; // mark_twofa_enrolled answers 42501 aal2_required
  await signIn(page, OPS);
  await security(page);
  await startEnrol(page);
  await dialog(page).getByRole('button', { name: 'كمّل', exact: true }).click();
  await dialog(page).locator('#tfa-code').fill(TOTP_CODE);
  await dialog(page).getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(dialog(page)).toContainText('السيرفر ماأكدش التفعيل — ابدأ من الأول');
  await expect(dialog(page).getByRole('radio')).toHaveCount(3); // back on step 1
  expect(mock.twofaCalls).toEqual([{ fn: 'mark_twofa_enrolled', aal: 'aal2', result: 'aal2_required' }]);
  expect(mock.unenrolls).toEqual([{ id: mock.enrolls[0].id, aal: 'aal2' }]); // verified a moment ago: removed on the aal2 session
  expect(mock.factors.filter((f) => f.user_id === profile('M02').id)).toEqual([]);
  expect(profile('M02').twofa).toBe(false);
  await dialog(page).getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(section(page)).toContainText('مش مفعّل');
  expect(mock.activity.map((a) => a.action)).not.toContain('profile.2fa.enable');
});

test('an unfinished enrolment is replaced on the next try', async ({ page }) => {
  await signIn(page, OPS);
  await security(page);
  await startEnrol(page);
  await dialog(page).getByRole('button', { name: 'إلغاء', exact: true }).click();
  await startEnrol(page); // GoTrue refuses a second «Authenticator»: the unverified one goes first
  expect(mock.enrolls).toHaveLength(2);
  expect(mock.unenrolls).toEqual([{ id: mock.enrolls[0].id, aal: 'aal1' }]);
  expect(mock.factors.filter((f) => f.user_id === profile('M02').id).map((f) => f.id)).toEqual([mock.enrolls[1].id]);
});

test('the code screen: the recovery text, no resend / backup code / 30-day device; «رجوع لتسجيل الدخول» signs the aal1 session out', async ({ page }) => {
  await password(page, TWOFA);
  await expect(title(page)).toHaveText('التحقق بخطوتين');
  const screen = page.locator('#login .login-card');
  await expect(screen).toContainText('لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية');
  // nothing sends a code again, there are no backup codes and no trusted device: those controls are gone
  await expect(screen.getByRole('button', { name: 'ابعت الكود تاني' })).toHaveCount(0);
  await expect(screen.getByRole('button', { name: 'استخدم كود احتياطي' })).toHaveCount(0);
  await expect(screen.getByRole('checkbox')).toHaveCount(0);
  await expect(screen).not.toContainText('افتكر الجهاز');
  expect(mock.logoutScopes).toEqual([]);
  await screen.getByRole('button', { name: 'رجوع لتسجيل الدخول', exact: true }).click();
  await expect(title(page)).toHaveText('تسجيل الدخول');
  expect(mock.logoutScopes).toEqual(['local']); // this browser's aal1 session ended before the login view
  await expect(page.locator('#root')).toBeHidden();
  // the remembered session is gone: a reload shows the login view, not the code screen again
  await page.reload();
  await expect(title(page)).toHaveText('تسجيل الدخول');
  await expect(page.locator('#root')).toBeHidden();
  // and the next sign-in asks for the code again
  await password(page, TWOFA, { open: false });
  await code(page);
  await expect(page.locator('.topbar .user-btn')).toContainText('محمد علي');
});

test('disable needs aal2', async ({ page }) => {
  // M03's profile says twofa but its factor is gone (an admin removed it in the dashboard): the sign-in stays aal1, so
  // has_perm gives nothing and «إيقاف» is refused before any server call
  mock.factors.length = 0;
  await signIn(page, TWOFA);
  await security(page);
  await expect(section(page)).toContainText('مفعّل');
  await section(page).getByRole('button', { name: 'إيقاف', exact: true }).click();
  await page.getByRole('dialog', { name: 'إيقاف التحقق بخطوتين' }).getByRole('button', { name: 'إيقاف', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toHaveText('سجّل دخول بالكود الأول');
  expect(profile('M03').twofa).toBe(true);
  expect(mock.twofaCalls).toEqual([]);
  expect(mock.unenrolls).toEqual([]);
  await expect(section(page)).toContainText('مفعّل — تطبيق Authenticator');
});

test('disable at aal2 clears twofa and removes the factor', async ({ page }) => {
  await password(page, TWOFA);
  await code(page);
  await security(page);
  await section(page).getByRole('button', { name: 'إيقاف', exact: true }).click();
  await page.getByRole('dialog', { name: 'إيقاف التحقق بخطوتين' }).getByRole('button', { name: 'إيقاف', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toHaveText('اتوقف التحقق بخطوتين');
  expect(profile('M03').twofa).toBe(false);
  expect(mock.twofaCalls).toEqual([{ fn: 'mark_twofa_disabled', aal: 'aal2', result: 'ok' }]);
  expect(mock.unenrolls).toEqual([{ id: 'f-M03', aal: 'aal2' }]);
  await expect(section(page)).toContainText('مش مفعّل');
  await expect(section(page).getByRole('button', { name: 'تفعيل', exact: true })).toBeVisible();
  await expect.poll(() => mock.activity.filter((a) => a.action === 'profile.2fa.disable').map((a) => [a.new_value, a.aal])).toEqual([['Authenticator', 'aal2']]);
});

test('an admin on a member\'s security tab sees the state, not the buttons (they act on the signed-in account)', async ({ page }) => {
  await signIn(page, 'admin.dev@ibtekr.local');
  await page.evaluate(() => { location.hash = 'member-M03'; });
  await page.getByRole('tab', { name: 'الحساب والأمان' }).click();
  await expect(heading(page)).toBeVisible();
  await expect(section(page)).toContainText('مفعّل — تطبيق Authenticator');
  await expect(section(page).getByRole('button', { name: 'إيقاف', exact: true })).toHaveCount(0);
  await expect(section(page).getByRole('button', { name: 'تفعيل', exact: true })).toHaveCount(0);
});
