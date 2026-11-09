import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, TEST_PW } from './supabase-mock.mjs';

// Phase 13 T4 (decision 10): the maker portal — its own page portal.html on the Edge Function portal (the mock's portal-mock.mjs on the
// mock's rows). Antikiano (VND 2) has a temporary password (TEST_PW) and must change it on the first sign-in; Bian eg (VND 3) has a
// login row without a password; the drawer of the team app shows the portal link and, once the maker set their own password, says so.
const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003';
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, { dokanBalances: [{ vendor_id: V2, woo_vendor_id: 2377, balance: 3200, earning: 9000, sales: 11000, orders: 4, synced_at: '2026-11-08T10:00:00Z' }] });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

const card = (page) => page.locator('#portal .login-card');
async function portalLogin(page, user, pw) {
  await page.fill('#pt-user', user); await page.fill('#pt-pw', pw);
  await page.locator('[data-pt-login]').click();
}

test('the sign-in: a wrong password and an unknown user read the same, an inactive maker is shut out; the first sign-in forces a new password (the rules live), then the maker sees his own view — KPIs, his lines with the delay rule, his account, his data with the bank masked; the bank request opens one ticket for the accounts; logout', async ({ page }) => {
  await page.goto('/portal.html');
  await expect(card(page)).toContainText('دخول المبتكر');
  await portalLogin(page, 'antikiano', 'Wrong1234');
  await expect(card(page).locator('.note.error')).toHaveText('اسم المستخدم أو الباسورد غلط'); // no tries-left: an unknown user reads the same
  await portalLogin(page, 'nobody', 'Whatever1');
  await expect(card(page).locator('.note.error')).toHaveText('اسم المستخدم أو الباسورد غلط');
  await portalLogin(page, 'bian.eg', 'Whatever1'); // Bian eg is inactive in the seed: the login is shut whatever the password
  await expect(card(page).locator('.note.error')).toContainText('حساب الدخول ده موقوف');
  await portalLogin(page, 'Antikiano', TEST_PW);
  await expect(card(page)).toContainText('اعمل الباسورد بتاعك');
  await expect(page).toHaveURL(/#portal-first$/);
  // the rules follow the typing; a mismatch is refused before any request
  await page.fill('#pt-p1', 'short'); await expect(page.locator('#pt-rules li.ok')).toHaveCount(2);
  await page.fill('#pt-p1', 'MyOwn2026'); await expect(page.locator('#pt-rules li.ok')).toHaveCount(4);
  await page.fill('#pt-p2', 'MyOwn2027'); await page.locator('[data-pt-save]').click();
  await expect(card(page).locator('.note.error')).toContainText('الباسوردين مش زي بعض');
  const setCalls = () => mock.portal.calls.filter((c) => c.action === 'set_password').length;
  expect(setCalls()).toBe(0);
  await page.fill('#pt-p2', 'MyOwn2026'); await page.locator('[data-pt-save]').click();
  await expect(page.locator('.toast.show')).toContainText('اتحفظ الباسورد');
  await expect(page.locator('#portal .pt-main h1')).toHaveText('أهلاً Antikiano');
  expect(setCalls()).toBe(1);
  const login = mock.vendorLogins.find((l) => l.vendor_id === V2);
  expect([login.own_password, login.must_change, login.status]).toEqual([true, false, 'active']);
  expect(mock.vault.get(login.secret_id)).toBe('MyOwn2026');
  // the home: Antikiano's two open lines — order 181668 (6 days, not late) and order 180656 (10 days → at risk); his balance from Dokan
  const kpis = page.locator('#portal .pt-kpi');
  await expect(kpis.nth(0)).toContainText('قطع مفتوحة'); await expect(kpis.nth(0).locator('b')).toHaveText('2');
  await expect(kpis.nth(1).locator('b')).toHaveText('0'); await expect(kpis.nth(2).locator('b')).toHaveText('1');
  await expect(kpis.nth(3)).toContainText('3,200'); await expect(kpis.nth(3)).toContainText('ليك');
  await expect(page.locator('#portal .sec-h')).toContainText('محتاجين يخلصوا الأول');
  await expect(page.locator('#portal table tbody tr')).toHaveCount(1); await expect(page.locator('#portal table tbody tr')).toContainText('Macrame Feathers'); await expect(page.locator('#portal table tbody tr')).toContainText('قابل للتأخير');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined(); // the order of the html-named customer: no customer field reaches the portal
  // orders: his two lines only (the other maker's Cushion lines are not his)
  await page.locator('#portal [role=tab]', { hasText: 'أوردراتي' }).click();
  await expect(page).toHaveURL(/#portal-orders$/);
  const rows = page.locator('#portal table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Macrame Curtain'); await expect(rows.first()).toContainText('#181668-181670'); await expect(rows.first()).toContainText('غير متأخر');
  expect(await page.locator('#portal').textContent()).not.toContain('Cushion');
  expect(await page.locator('#portal').textContent()).not.toContain('سلوى'); // no customer name anywhere
  await page.locator('#portal .chip', { hasText: 'متأخرة وقابلة للتأخير' }).click(); await expect(rows).toHaveCount(1);
  await page.locator('#portal .chip', { hasText: 'الكل' }).click(); await expect(rows).toHaveCount(2);
  // account: Dokan's balance, no moves, no withdrawals
  await page.locator('#portal [role=tab]', { hasText: 'حسابي' }).click();
  await expect(page.locator('#portal .pt-row.total')).toContainText('ليك'); await expect(page.locator('#portal .pt-row.total')).toContainText('3,200');
  await expect(page.locator('#portal')).toContainText('مفيش طلبات سحب');
  // profile: the data, the bank missing → the request opens a ticket for the accounts; a second ask gets the same one
  await page.locator('#portal [role=tab]', { hasText: 'بياناتي' }).click();
  await expect(page.locator('#portal')).toContainText('antikiano'); await expect(page.locator('#portal')).toContainText('Antikiano');
  await expect(page.locator('#portal .note.warning')).toContainText('لسه مفيش حساب بنكي');
  await page.locator('[data-pt-bank]').click();
  await expect(page.locator('.toast.show')).toContainText('اتبعت الطلب');
  const t = mock.tickets.find((x) => x.created_by_role === 'بوابة المبتكر');
  expect([t.assignee_role, t.vendor_id, t.vendor, t.status, t.title]).toEqual(['الحسابات', V2, 'Antikiano', 'open', 'طلب تعديل الحساب البنكي — Antikiano']);
  await page.locator('[data-pt-bank]').click();
  await expect(page.locator('.toast.show')).toContainText('طلبك لسه مفتوح');
  expect(mock.tickets.filter((x) => x.created_by_role === 'بوابة المبتكر')).toHaveLength(1);
  // change the password: the current one checked first
  await page.fill('#pt-old', 'nope'); await page.fill('#pt-new', 'Newer2027'); await page.locator('[data-pt-chpw]').click();
  await expect(page.locator('.toast.show')).toContainText('الباسورد الحالي غلط');
  await page.fill('#pt-old', 'MyOwn2026'); await page.locator('[data-pt-chpw]').click();
  await expect(page.locator('.toast.show')).toContainText('اتغيّر الباسورد');
  expect(mock.vault.get(login.secret_id)).toBe('Newer2027');
  // a reload keeps the session (sessionStorage); logout drops it
  await page.reload();
  await expect(page.locator('#portal .pt-main h1')).toHaveText('أهلاً Antikiano');
  await page.locator('[data-pt-out]').click();
  await expect(card(page)).toContainText('دخول المبتكر');
  expect(await page.evaluate(() => sessionStorage.getItem('ib.portal.token'))).toBeNull();
  expect(mock.portal.calls.some((c) => c.action === 'login' && c.user === 'antikiano' && c.result === 'ok')).toBe(true);
  expect(JSON.stringify(mock.portal.calls)).not.toContain('MyOwn2026');
});

test('the lock: the fifth wrong try locks the login 15 minutes, a right password while locked is refused too', async ({ page }) => {
  await page.goto('/portal.html');
  for (let i = 0; i < 4; i++) { await portalLogin(page, 'antikiano', 'Wrong1234'); await expect(card(page).locator('.note.error')).toHaveText('اسم المستخدم أو الباسورد غلط'); await expect.poll(() => mock.vendorLogins.find((l) => l.vendor_id === V2).fails).toBe(i + 1); }
  await portalLogin(page, 'antikiano', 'Wrong1234');
  await expect(card(page).locator('.note.error')).toContainText('الحساب اتقفل 15 دقيقة');
  await portalLogin(page, 'antikiano', TEST_PW);
  await expect(card(page).locator('.note.error')).toContainText('الحساب اتقفل 15 دقيقة');
  expect(mock.vendorLogins.find((l) => l.vendor_id === V2).locked_until).toBeTruthy();
});

test('«نسيت الباسورد»: the same answer whatever the user; the mail carries a link with the token in the hash; the link opens the new-password screen, sets it and signs the maker in; a spent link is refused; without Resend the screen says to call the team', async ({ page }) => {
  await page.goto('/portal.html');
  await card(page).getByRole('button', { name: 'نسيت الباسورد؟' }).click();
  await expect(page).toHaveURL(/#portal-forgot$/);
  await page.fill('#pt-fuser', 'nobody@x.test'); await page.locator('[data-pt-forgot]').click();
  await expect(card(page)).toContainText('لو الحساب موجود هيوصلك لينك');
  expect(mock.portal.mails).toEqual([]);
  await card(page).getByRole('button', { name: 'رجوع لتسجيل الدخول' }).click();
  await card(page).getByRole('button', { name: 'نسيت الباسورد؟' }).click();
  await page.fill('#pt-fuser', 'ANTIKIANO.dev@ibtekr.local'); await page.locator('[data-pt-forgot]').click();
  await expect(card(page)).toContainText('لو الحساب موجود هيوصلك لينك');
  expect(mock.portal.mails).toHaveLength(1); expect(mock.portal.mails[0].to).toBe('antikiano.dev@ibtekr.local');
  const link = mock.portal.mails[0].link;
  await page.goto(link);
  await expect(card(page)).toContainText('باسورد جديد');
  await expect(page).toHaveURL(/#portal-reset$/); // the token leaves the address bar
  await page.fill('#pt-p1', 'Fresh5678'); await page.fill('#pt-p2', 'Fresh5678'); await page.locator('[data-pt-save]').click();
  await expect(page.locator('#portal .pt-main h1')).toHaveText('أهلاً Antikiano');
  expect(mock.vault.get(mock.vendorLogins.find((l) => l.vendor_id === V2).secret_id)).toBe('Fresh5678');
  await page.locator('[data-pt-out]').click();
  await page.goto(link);
  await page.fill('#pt-p1', 'Fresh5678'); await page.fill('#pt-p2', 'Fresh5678'); await page.locator('[data-pt-save]').click();
  await expect(card(page).locator('.note.error')).toContainText('اللينك ده مش صالح أو انتهى');
  // without Resend on the server
  mock.portal.resend = false;
  await card(page).getByRole('button', { name: 'رجوع لتسجيل الدخول' }).click();
  await card(page).getByRole('button', { name: 'نسيت الباسورد؟' }).click();
  await page.fill('#pt-fuser', 'antikiano'); await page.locator('[data-pt-forgot]').click();
  await expect(card(page).locator('.note.warning')).toContainText('كلّم فريق إبتكر');
  // a hash that needs a session without one goes back to the sign-in
  await page.goto('/portal.html#portal-orders');
  await expect(card(page)).toContainText('دخول المبتكر'); await expect(card(page).locator('.note.error')).toContainText('سجّل دخول الأول');
});

test('the team app: the drawer\'s «بيانات الدخول» shows the portal link (copied with the login data); once the maker set their own password the team sees so and has no «إظهار»', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((h) => { location.hash = h; }, 'makers/' + V2);
  const drawer = page.locator('.drawer[aria-label^="ملف المبتكر"]'); await expect(drawer).toBeVisible();
  const ls = drawer.locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: 'بيانات الدخول' }) });
  await expect(ls.locator('[data-portal-link]')).toHaveText('http://localhost:4173/portal.html');
  await expect(ls.locator('[data-pw-reveal]')).toHaveCount(1);
  // the maker set their own password meanwhile: the drawer re-reads the row
  Object.assign(mock.vendorLogins.find((l) => l.vendor_id === V2), { own_password: true, must_change: false, status: 'active', last_login_at: '2026-11-09T09:00:00Z' });
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((h) => { location.hash = h; }, 'makers/' + V2);
  await expect(drawer).toBeVisible();
  const ls2 = drawer.locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: 'بيانات الدخول' }) });
  await expect(ls2.locator('[data-own-password]')).toContainText('المبتكر عامل باسورده بنفسه');
  await expect(ls2.locator('[data-pw-reveal]')).toHaveCount(0);
  await expect(ls2.locator('[data-login-status]')).toHaveText('مفعّل');
  await expect(ls2).toContainText('آخر دخول');
  await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); }; });
  await ls2.locator('[data-copy-login]').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(['بوابة مبتكرين إبتكر: http://localhost:4173/portal.html\nاسم المستخدم: antikiano\nالإيميل: antikiano.dev@ibtekr.local\nالباسورد: انت عامله بنفسك — لو نسيته دوس «نسيت الباسورد؟»']);
  expect(mock.rpcs.filter((r) => r.fn === 'vendor_login_reveal')).toEqual([]); // nothing asked of the server for a maker's own password
  // Bian eg (no password yet): the link is there too
  await page.evaluate((h) => { location.hash = h; }, 'makers/' + V3);
  await expect(drawer.locator('[data-portal-link]')).toHaveText('http://localhost:4173/portal.html');
});
