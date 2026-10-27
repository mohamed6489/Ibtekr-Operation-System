import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, TEST_PW } from './supabase-mock.mjs';

// «إضافة مبتكر» of phase 3.1 (the owner's prototype of 26 Oct, decisions 9–11) on the mocked Supabase: the three sections of the popup
// (the basics, «بيانات الدخول», «الحساب البنكي»), the create sequence vendors → vendor_rates → vendor_logins → (rpc) → vendor_bank with a
// refused step leaving the maker and named as missing, the temporary password that reaches the RPC and nothing else, the username
// suggestion and its refusals (local, then 23505), a known name refused, the drawer's «بيانات الدخول» section (reveal — logged by the
// server on every call —, copy, disable / enable, edit, a new temporary password), «ناقص» in the drawer header, the permissions
// (vendors.edit = F or the admin), html as text. Mock only; E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local'; const VF = 'vf.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'; const VF_ID = '00000000-0000-4000-8000-000000000005';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003'; // Art Craft (no login), Antikiano (a temporary password), Bian eg (inactive, invited by link)
const NEW1 = 'b0000000-0000-4000-8000-000000000001'; // the first maker the mock creates
const EVIL = '"><img src=x onerror="window.__xss=1">';
const PW_RE = /^[a-hj-km-np-zA-HJ-NP-Z2-9]{10}$/; // the generator's alphabet
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed, its vault and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page, email) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const rows = (page) => page.locator('#vendors table tbody tr[data-id]');
const row = (page, id) => page.locator(`#vendors tr[data-id="${id}"]`);
async function openVendors(page, email = ADMIN, n = 2) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="vendors"]').click();
  await expect(page.locator('#vendors')).toBeVisible();
  await expect(rows(page)).toHaveCount(n);
}
async function signOut(page) {
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => { window.IBAuth.signOut(); })]);
  await expect(page.locator('#login')).toBeVisible();
}
const drawer = (page) => page.locator('.drawer[aria-label^="ملف المبتكر"]');
async function openDrawer(page, id) { await row(page, id).click(); await expect(drawer(page)).toBeVisible(); return drawer(page); }
async function openByHash(page, id) { await page.evaluate((h) => { location.hash = h; }, 'makers/' + id); await expect(drawer(page)).toBeVisible(); return drawer(page); }
const section = (page, title) => drawer(page).locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: title }) });
const loginSec = (page) => section(page, 'بيانات الدخول');
const info = (scope, page, label) => scope.locator('.info-row').filter({ has: page.locator('.lab', { hasText: label }) }).locator('.val');
const modal = (page) => page.locator('.modal[role=dialog]');
const note = (page) => page.locator('#vendors .note');
const writes = () => mock.vendorWrites.map((w) => { const { updated_at, ...x } = w; return x; });
const acts = (action) => mock.activity.filter((a) => a.action === action).map((a) => ({ action: a.action, entity: a.entity, entity_id: a.entity_id, new_value: a.new_value })); // the client's log_activity calls
const serverActs = (action) => mock.activityRows.filter((r) => r.action === action).map((r) => ({ action: r.action, actor: r.actor, entity: r.entity, entity_id: r.entity_id, new_value: r.new_value })); // rows the server wrote itself
const inert = async (page) => {
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
};
async function pickOption(page, selectId, label) { await modal(page).locator('#' + selectId).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).click(); }
async function openAdd(page) { await page.getByRole('button', { name: 'إضافة مبتكر' }).click(); await expect(modal(page)).toBeVisible(); return modal(page); }
// what the page copies (the clipboard is not readable in the test browser)
async function captureClipboard(page) { await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); }; }); }

test('the admin adds a complete maker (basics + login with its temporary password + bank): no link option, the password required, the inserts in order and the RPC after the login insert, the drawer opens with the login and no «ناقص»; nothing says anything was sent', async ({ page }) => {
  await openVendors(page);
  const m = await openAdd(page);
  await expect(m).toContainText('بيانات الدخول'); await expect(m).toContainText('الحساب البنكي');
  await m.locator('#v-name').fill('Wood & Rope');
  await expect(m.locator('#v-login-user')).toHaveValue('wood.rope'); // suggested from the name
  await pickOption(page, 'v-cat', 'ديكور منزلي');
  await m.locator('#v-phone').fill('01000000009');
  await m.locator('#v-login-email').fill('wood.dev@ibtekr.local');
  await expect(m.locator('[data-pwmode]')).toHaveCount(0); // no «ابعتله لينك يعمل الباسورد بنفسه» (owner, 26 Oct): the temporary password is the only way
  await expect(m).not.toContainText('لينك');
  await expect(m.locator('#v-login-pw')).toHaveAttribute('type', 'password');
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click(); // the password and the bank are required
  await expect(m.locator('#v-login-pw-err')).toContainText('الباسورد لازم');
  await expect(m).toContainText('اختار طريقة التحويل');
  expect(writes()).toEqual([]); expect(mock.rpcs).toEqual([]);
  await m.locator('[data-genpw]').click();
  const pw = await m.locator('#v-login-pw').inputValue(); expect(pw).toMatch(PW_RE);
  await pickOption(page, 'v-bank-method', 'تحويل بنكي');
  await m.locator('#v-bank-holder').fill('Wood & Rope'); await m.locator('#v-bank-bank').fill('بنك مصر'); await m.locator('#v-bank-iban').fill('eg38 0003 0001 0000 0000 0000 0482 1');
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText('Wood & Rope');
  await expect(drawer(page).locator('[data-missing]')).toHaveCount(0);
  const ins = writes().filter((w) => w.op === 'insert');
  expect(ins.map((w) => w.table)).toEqual(['vendors', 'vendor_rates', 'vendor_logins', 'vendor_bank']);
  expect(ins[0]).toEqual({ table: 'vendors', op: 'insert', name: 'Wood & Rope', category: 'ديكور منزلي', phone: '01000000009', email: 'wood.dev@ibtekr.local', status: 'active', lead_days: 7, aliases: [], joined_at: ins[0].joined_at });
  expect(ins[2]).toEqual({ table: 'vendor_logins', op: 'insert', vendor_id: NEW1, username: 'wood.rope', email: 'wood.dev@ibtekr.local', pw_mode: 'temp', created_by: 'صفوت كمال' }); // created_by: the member's name, like set_by / updated_by
  expect(ins[3]).toEqual({ table: 'vendor_bank', op: 'insert', vendor_id: NEW1, method: 'bank', bank_name: 'بنك مصر', holder: 'Wood & Rope', iban: 'EG380003000100000000000004821', wallet: null, account_number: null, account_type: null, bank_address: null, routing_number: null, swift: null, updated_by: 'صفوت كمال' }); // the IBAN upper-cased, no spaces
  expect(mock.rpcs).toEqual([{ fn: 'vendor_login_set_password', vendor_id: NEW1, by: ADMIN, result: 'ok' }]); // right after the login insert
  expect(JSON.stringify([mock.vendorWrites, mock.activity, mock.activityRows])).not.toContain(pw);
  await expect.poll(() => acts('vendor.login')).toEqual([{ action: 'vendor.login', entity: 'vendor', entity_id: NEW1, new_value: 'username, email' }]);
  await expect.poll(() => acts('vendor.bank')).toEqual([{ action: 'vendor.bank', entity: 'vendor', entity_id: NEW1, new_value: 'bank' }]);
  await expect(note(page)).toContainText('اتضاف المبتكر Wood & Rope');
  await expect(note(page)).toContainText('الباسورد المؤقت جاهز تبعته له');
  await expect(note(page)).not.toContainText('اتبعت');
  await expect(note(page)).not.toContainText('لينك');
  const ls = loginSec(page);
  await expect(info(ls, page, 'اسم المستخدم')).toHaveText('wood.rope');
  await expect(info(ls, page, 'الإيميل')).toHaveText('wood.dev@ibtekr.local');
  await expect(ls.locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await expect(info(ls, page, 'الباسورد')).toContainText('••••••••');
  await expect(ls.getByRole('button', { name: 'إظهار' })).toHaveCount(1);
  await expect(ls).not.toContainText('لينك');
  await expect(page.locator('body')).not.toContainText(pw);
  expect(mock.vendorLogins.find((l) => l.vendor_id === NEW1)).toMatchObject({ status: 'invited', must_change: true, invite_sent_at: null, pw_mode: 'temp' });
  expect(mock.vendorLogins.find((l) => l.vendor_id === NEW1).password_set_at).not.toBeNull();
});

test('a temporary password from the generator passes the rules and reaches the RPC alone: in no write, no client log, nowhere on the page after; the server logs vendor.login.password; the note says it is ready to send', async ({ page }) => {
  await openVendors(page);
  const m = await openAdd(page);
  await m.locator('#v-name').fill('Zaan'); await pickOption(page, 'v-cat', 'هدايا'); await m.locator('#v-phone').fill('01000000008'); await m.locator('#v-login-email').fill('zaan.dev@ibtekr.local');
  await expect(m.locator('#v-login-pw')).toHaveAttribute('type', 'password'); // there from the start: the only mode
  await m.locator('#v-login-pw').fill('short');
  await expect(m.locator('.pw-rules li.ok')).toHaveCount(2); // a letter, no spaces; not 8 chars, no digit
  await m.locator('[data-genpw]').click();
  const pw = await m.locator('#v-login-pw').inputValue();
  expect(pw).toMatch(PW_RE);
  await expect(m.locator('#v-login-pw')).toHaveAttribute('type', 'text'); // shown after the generator
  await expect(m.locator('.pw-rules li.ok')).toHaveCount(4);
  await m.getByRole('button', { name: 'إخفاء الباسورد' }).click();
  await expect(m.locator('#v-login-pw')).toHaveAttribute('type', 'password');
  await expect(m).toContainText('بيتحفظ مشفّر عشان الدعم');
  await pickOption(page, 'v-bank-method', 'نقدي عند التسليم');
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(drawer(page)).toBeVisible();
  expect(mock.rpcs).toEqual([{ fn: 'vendor_login_set_password', vendor_id: NEW1, by: ADMIN, result: 'ok' }]);
  expect(JSON.stringify([mock.vendorWrites, mock.activity, mock.activityRows])).not.toContain(pw);
  expect(mock.vault.get(mock.vendorLogins.find((l) => l.vendor_id === NEW1).secret_id)).toBe(pw); // the server's vault alone holds it
  expect(mock.vendorLogins.find((l) => l.vendor_id === NEW1)).toMatchObject({ pw_mode: 'temp', must_change: true, status: 'invited' });
  expect(serverActs('vendor.login.password')).toEqual([{ action: 'vendor.login.password', actor: ADMIN_ID, entity: 'vendor', entity_id: NEW1, new_value: null }]);
  expect(acts('vendor.login.password')).toEqual([]); // the server's row, not the client's
  const ins = writes().filter((w) => w.op === 'insert');
  expect(ins.map((w) => w.table)).toEqual(['vendors', 'vendor_rates', 'vendor_logins', 'vendor_bank']);
  expect(ins[2].pw_mode).toBe('temp');
  expect(ins[3]).toEqual({ table: 'vendor_bank', op: 'insert', vendor_id: NEW1, method: 'cash', bank_name: null, holder: null, iban: null, wallet: null, account_number: null, account_type: null, bank_address: null, routing_number: null, swift: null, updated_by: 'صفوت كمال' });
  await expect(note(page)).toContainText('الباسورد المؤقت جاهز تبعته له');
  await expect(note(page)).not.toContainText('اتبعت');
  await expect(info(loginSec(page), page, 'الباسورد')).toContainText('••••••••');
  await expect(page.locator('body')).not.toContainText(pw);
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال عمل باسورد مؤقت للمبتكر');
});

test('the username: suggested from the name until typed, a taken one refused locally with a suggestion; taken on the server meanwhile (23505) → the maker is added, the login is what is missing', async ({ page }) => {
  await openVendors(page);
  const m = await openAdd(page);
  await m.locator('#v-name').fill('Antik'); await expect(m.locator('#v-login-user')).toHaveValue('antik');
  await m.locator('#v-login-user').fill('Antikiano');
  await m.locator('#v-name').fill('Antik Store'); await expect(m.locator('#v-login-user')).toHaveValue('Antikiano'); // typed once: the name no longer drives it
  await pickOption(page, 'v-cat', 'هدايا'); await m.locator('#v-phone').fill('01000000008'); await m.locator('#v-login-email').fill('antik.dev@ibtekr.local');
  await pickOption(page, 'v-bank-method', 'نقدي عند التسليم'); await m.locator('[data-genpw]').click();
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(m.locator('#v-login-user-err')).toHaveText('اسم المستخدم ده مستخدم قبل كده — جرّب antikiano2'); // lower-cased: Antikiano's
  expect(writes()).toEqual([]);
  await m.locator('#v-login-user').fill('antik.store');
  mock.vendorLogins.push({ vendor_id: V1, username: 'antik.store', email: 'other.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, invite_sent_at: null, password_set_at: null, secret_id: null, created_by: 'سارة أحمد', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }); // another member took it
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(note(page)).toContainText('اتضاف المبتكر Antik Store — ناقص: بيانات الدخول (اسم المستخدم ده مستخدم قبل كده). كمّله من ملفه.');
  await expect(drawer(page).locator('[data-missing]')).toHaveText('ناقص: بيانات الدخول');
  expect(writes().filter((w) => w.op === 'insert').map((w) => w.table)).toEqual(['vendors', 'vendor_rates', 'vendor_bank']); // the login insert was refused, the rest stands
  expect(mock.rpcs).toEqual([]); // no password without a login row
  expect(mock.rpcs).toEqual([]);
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('مفيش حساب دخول');
  await expect(loginSec(page).getByRole('button', { name: 'إضافة بيانات الدخول' })).toBeVisible();
});

test('a maker already in the registry (by name or alias, normalised) is refused — «افتح ملفه» opens his file; nothing is written', async ({ page }) => {
  await openVendors(page);
  const m = await openAdd(page);
  await m.locator('#v-name').fill('antikiano  store'); // Antikiano's alias «Antikiano store»
  await pickOption(page, 'v-cat', 'هدايا'); await m.locator('#v-phone').fill('01000000008'); await m.locator('#v-login-email').fill('x.dev@ibtekr.local');
  await pickOption(page, 'v-bank-method', 'نقدي عند التسليم');
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(m.locator('#v-name-err')).toContainText('المبتكر ده موجود (');
  expect(writes()).toEqual([]);
  await m.locator('[data-open-dup]').click();
  await expect(modal(page)).toHaveCount(0);
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText('Antikiano');
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  const m2 = await openAdd(page);
  await m2.locator('#v-name').fill('ART-CRAFT'); await m2.locator('#v-aliases').fill('Bian'); // the name of one, the alias of another: refused on the name first
  await pickOption(page, 'v-cat', 'هدايا'); await m2.locator('#v-phone').fill('01000000008'); await m2.locator('#v-login-email').fill('x.dev@ibtekr.local');
  await pickOption(page, 'v-bank-method', 'نقدي عند التسليم');
  await m2.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(m2.locator('#v-name-err')).toContainText('المبتكر ده موجود (');
  expect(writes()).toEqual([]);
});

test('ops (vendors.edit = P) and accounts: the login writes and the RPCs refused before any request, the server refuses a tampered page; the drawer shows the login read-only; accounts has no add button', async ({ page }) => {
  await openVendors(page, OPS);
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeEnabled(); // vendors.edit = P edits contacts; the create itself is refused before any request (vendors.spec)
  const out = await page.evaluate(async (id) => {
    const S = window.IBVendors.store; const r = []; const tryS = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.message; } };
    r.push(tryS(() => S.setLogin(id, { username: 'antikiano', email: 'a.dev@ibtekr.local' }, S.actor())));
    r.push(tryS(() => S.setLoginStatus(id, 'disabled', S.actor())));
    r.push(await S.setLoginPassword(id, 'Test1234', S.actor()).then(() => 'ok', (e) => e.message));
    r.push(await S.revealPassword(id, S.actor()).then(() => 'ok', (e) => e.message));
    r.push(S.canLogin());
    return r;
  }, V2);
  expect(out).toEqual(['مش من صلاحياتك', 'مش من صلاحياتك', 'مش من صلاحياتك', 'مش من صلاحياتك', false]);
  expect(mock.rpcs).toEqual([]); expect(writes()).toEqual([]);
  await openDrawer(page, V2);
  const ls = loginSec(page);
  await expect(info(ls, page, 'اسم المستخدم')).toHaveText('antikiano');
  await expect(ls.locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await expect(info(ls, page, 'الباسورد')).toContainText('••••••••');
  await expect(ls.getByRole('button', { name: 'إظهار' })).toHaveCount(0);
  await expect(ls.getByRole('button', { name: /بيانات الدخول$/ })).toHaveCount(0);
  await expect(ls.locator('[data-login-toggle]')).toHaveCount(0);
  await expect(ls).toContainText('بيديرها الأدمن ومتابعة المبتكرين');
  await expect(drawer(page).locator('[data-missing]')).toHaveCount(0); // no sensitive.vendor_bank: the bank is not judged; the login is there
  // ops copies the login of a temp-mode maker without the key: no password and no promise of a link (review B, I1)
  await captureClipboard(page);
  await ls.locator('[data-copy-login]').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(['اسم المستخدم: antikiano\nالإيميل: antikiano.dev@ibtekr.local\nالباسورد المؤقت: اطلبه من الأدمن أو متابعة المبتكرين']);
  expect(mock.rpcs).toEqual([]); // nothing asked of the server
  // straight at the server (what a tampered page could send): the two RPCs, an insert and secret_id are refused
  const codes = await page.evaluate(async (id) => {
    const c = window.IBSupabase.client;
    const a = await c.rpc('vendor_login_reveal', { p_vendor: id });
    const b = await c.rpc('vendor_login_set_password', { p_vendor: id, p_password: 'Test1234' });
    const d = await c.from('vendor_logins').insert({ vendor_id: 'a0000000-0000-4000-8000-000000000001', username: 'x.y.z', email: 'x.dev@ibtekr.local', pw_mode: 'temp' });
    const e = await c.from('vendor_logins').select('vendor_id, secret_id');
    const f = await c.from('vendor_logins').select('*');
    return [a.error && a.error.code, b.error && b.error.code, d.error && d.error.code, e.error && e.error.code, f.error && f.error.code];
  }, V2);
  expect(codes).toEqual(['42501', '42501', '42501', '42501', '42501']);
  expect(mock.rpcs.map((r) => r.result)).toEqual(['42501', '42501']);
  expect(mock.vault.size).toBe(1); expect(mock.vendorLogins).toHaveLength(2); // nothing changed
  expect(serverActs('vendor.login.reveal')).toEqual([]);
  await signOut(page);
  await openVendors(page, ACCOUNTS);
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeDisabled();
  await openDrawer(page, V2);
  await expect(loginSec(page).getByRole('button', { name: /بيانات الدخول$/ })).toHaveCount(0);
  await expect(loginSec(page).getByRole('button', { name: 'إظهار' })).toHaveCount(0);
  await expect(drawer(page).locator('[data-missing]')).toHaveText('ناقص: الحساب البنكي'); // accounts sees bank rows: Antikiano has none
});

test('«متابعة الموردين» (vendors.edit = F): reveals the temporary password (the server logs every call, never the value), copies the login data, disables and re-enables the account, edits the e-mail and makes a new temporary password from the drawer', async ({ page }) => {
  await openVendors(page, VF);
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeEnabled();
  await openDrawer(page, V2);
  const ls = loginSec(page);
  await expect(ls.locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await ls.getByRole('button', { name: 'إظهار' }).click();
  await expect(info(ls, page, 'الباسورد')).toContainText(TEST_PW);
  expect(mock.rpcs).toEqual([{ fn: 'vendor_login_reveal', vendor_id: V2, by: VF, result: 'ok' }]);
  expect(serverActs('vendor.login.reveal')).toEqual([{ action: 'vendor.login.reveal', actor: VF_ID, entity: 'vendor', entity_id: V2, new_value: null }]);
  expect(acts('vendor.login.reveal')).toEqual([]); // the client logs nothing: the server's row
  await expect(section(page, 'سجل النشاط')).toContainText('هدى سمير أظهر باسورد الدخول (دعم)');
  await ls.getByRole('button', { name: 'إخفاء' }).click();
  await expect(info(ls, page, 'الباسورد')).not.toContainText(TEST_PW);
  await expect(info(ls, page, 'الباسورد')).toContainText('••••••••');
  await ls.getByRole('button', { name: 'إظهار' }).click(); // every reveal is a row
  await expect(info(ls, page, 'الباسورد')).toContainText(TEST_PW);
  await expect.poll(() => serverActs('vendor.login.reveal').length).toBe(2);
  expect(JSON.stringify([mock.activityRows, mock.activity, mock.vendorWrites])).not.toContain(TEST_PW);
  // «انسخ بيانات الدخول للمبتكر»: the password fetched at copy time (a third reveal); nothing says it was sent
  await captureClipboard(page);
  await ls.locator('[data-copy-login]').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(['اسم المستخدم: antikiano\nالإيميل: antikiano.dev@ibtekr.local\nالباسورد المؤقت: ' + TEST_PW]);
  await expect.poll(() => serverActs('vendor.login.reveal').length).toBe(3);
  await expect(note(page)).toContainText('اتنسخ بيانات الدخول');
  // disable / enable: one PATCH each, logged by the client as vendor.login.status
  await loginSec(page).locator('[data-login-toggle]').click();
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('موقوف');
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_logins')).toEqual([{ table: 'vendor_logins', op: 'update', vendor_id: V2, status: 'disabled' }]);
  await expect.poll(() => acts('vendor.login.status')).toEqual([{ action: 'vendor.login.status', entity: 'vendor', entity_id: V2, new_value: 'disabled' }]);
  await expect(section(page, 'سجل النشاط')).toContainText('هدى سمير غيّر حالة حساب الدخول (disabled)');
  await loginSec(page).locator('[data-login-toggle]').click();
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_logins').length).toBe(2);
  expect(mock.vendorLogins.find((l) => l.vendor_id === V2).status).toBe('invited');
  // «تعديل»: the e-mail changes → one PATCH of email, logged as vendor.login (email); no RPC
  await loginSec(page).getByRole('button', { name: 'تعديل بيانات الدخول' }).click();
  const m = modal(page);
  await expect(m.locator('#l-login-user')).toHaveValue('antikiano');
  await expect(m.locator('#l-login-pw')).toHaveCount(0);
  await m.locator('#l-login-email').fill('antikiano.new.dev@ibtekr.local');
  await m.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_logins' && w.email)).toEqual([{ table: 'vendor_logins', op: 'update', vendor_id: V2, email: 'antikiano.new.dev@ibtekr.local' }]);
  await expect(info(loginSec(page), page, 'الإيميل')).toHaveText('antikiano.new.dev@ibtekr.local');
  await expect.poll(() => acts('vendor.login')).toEqual([{ action: 'vendor.login', entity: 'vendor', entity_id: V2, new_value: 'email' }]);
  expect(mock.rpcs.filter((r) => r.fn === 'vendor_login_set_password')).toEqual([]);
  // «اعمل باسورد مؤقت جديد» from the drawer: the RPC with the generated password and no other write; the note says it is ready to send
  await loginSec(page).getByRole('button', { name: 'تعديل بيانات الدخول' }).click();
  await modal(page).locator('[data-newpw]').click();
  const pw2 = await modal(page).locator('#l-login-pw').inputValue(); expect(pw2).toMatch(PW_RE);
  await expect(modal(page).locator('.pw-rules li.ok')).toHaveCount(4);
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.rpcs.filter((r) => r.fn === 'vendor_login_set_password')).toEqual([{ fn: 'vendor_login_set_password', vendor_id: V2, by: VF, result: 'ok' }]);
  expect(mock.vault.get(mock.vendorLogins.find((l) => l.vendor_id === V2).secret_id)).toBe(pw2);
  expect(JSON.stringify([mock.vendorWrites, mock.activity, mock.activityRows])).not.toContain(pw2);
  expect(writes().filter((w) => w.table === 'vendor_logins')).toHaveLength(3); // disable, enable, e-mail — the password is no table write
  await expect(note(page)).toContainText('الباسورد المؤقت جاهز تبعته له');
  await expect(note(page)).not.toContainText('اتبعت');
  await expect.poll(() => serverActs('vendor.login.password')).toEqual([{ action: 'vendor.login.password', actor: VF_ID, entity: 'vendor', entity_id: V2, new_value: null }]);
  await expect(section(page, 'سجل النشاط')).toContainText('هدى سمير عمل باسورد مؤقت للمبتكر');
  await expect(page.locator('body')).not.toContainText(pw2); // the modal went with it; the drawer shows the mask
  await expect(info(loginSec(page), page, 'الباسورد')).toContainText('••••••••');
});

test('«ناقص» in the drawer header (the admin sees the three pieces); the login added from the drawer comes with its temporary password (the insert, then the RPC) and shrinks it; a weak password is refused on the page; a server without Vault keeps the row and names the password as missing', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  await expect(drawer(page).locator('[data-missing]')).toHaveText('ناقص: بيانات الدخول / الإيميل / الحساب البنكي');
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('مفيش حساب دخول');
  await expect(info(loginSec(page), page, 'الباسورد')).toHaveText('—');
  await expect(loginSec(page).locator('[data-copy-login]')).toHaveCount(0);
  await loginSec(page).getByRole('button', { name: 'إضافة بيانات الدخول' }).click();
  await expect(modal(page).locator('#l-login-user')).toHaveValue('art.craft');
  await expect(modal(page).locator('[data-newpw]')).toHaveCount(0); // the password field is already there: a new login carries its password
  await expect(modal(page).locator('#l-login-pw')).toHaveAttribute('type', 'password');
  await expect(modal(page).locator('[data-pwmode]')).toHaveCount(0); await expect(modal(page)).not.toContainText('لينك');
  await modal(page).locator('#l-login-user').fill('antikiano');
  await modal(page).locator('#l-login-email').fill('art.dev@ibtekr.local');
  await modal(page).locator('#l-login-pw').fill('weak');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page).locator('#l-login-user-err')).toHaveText('اسم المستخدم ده مستخدم قبل كده — جرّب antikiano2');
  await expect(modal(page).locator('#l-login-pw-err')).toContainText('الباسورد لازم');
  expect(writes()).toEqual([]); expect(mock.rpcs).toEqual([]);
  await modal(page).locator('#l-login-user').fill('art.craft');
  await modal(page).locator('#l-login-pw').fill('Test1234');
  // a server without Vault: the row is inserted, the password step refused → the note names it, the drawer shows the row without a password
  mock.vaultDown = true;
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('اتحفظت بيانات الدخول — ناقص: الباسورد المؤقت (');
  await expect(note(page)).toContainText('Vault مش شغّال');
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_logins')).toEqual([{ table: 'vendor_logins', op: 'insert', vendor_id: V1, username: 'art.craft', email: 'art.dev@ibtekr.local', pw_mode: 'temp', created_by: 'صفوت كمال' }]);
  expect(mock.rpcs).toEqual([{ fn: 'vendor_login_set_password', vendor_id: V1, by: ADMIN, result: '0A000' }]);
  expect(mock.vault.size).toBe(1);
  await expect(drawer(page).locator('[data-missing]')).toHaveText('ناقص: الحساب البنكي');
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await expect(info(loginSec(page), page, 'الباسورد')).toContainText('باسورد مؤقت — لسه ماتعملش');
  await expect(loginSec(page)).not.toContainText('لينك');
  await expect.poll(() => acts('vendor.login')).toEqual([{ action: 'vendor.login', entity: 'vendor', entity_id: V1, new_value: 'username, email' }]);
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال عدّل بيانات الدخول (username, email)');
  // «تعديل» on the row: username + e-mail, the password behind «اعمل باسورد مؤقت جديد» — with Vault back the RPC alone
  mock.vaultDown = false;
  await loginSec(page).getByRole('button', { name: 'تعديل بيانات الدخول' }).click();
  await expect(modal(page).locator('#l-login-pw')).toHaveCount(0);
  await modal(page).locator('[data-newpw]').click();
  await modal(page).locator('#l-login-pw').fill('Test1234');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('الباسورد المؤقت جاهز تبعته له');
  expect(mock.rpcs.map((r) => r.result)).toEqual(['0A000', 'ok']);
  expect(writes().filter((w) => w.table === 'vendor_logins')).toHaveLength(1); // the password is no table write
  await expect(info(loginSec(page), page, 'الباسورد')).toContainText('••••••••');
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await openDrawer(page, V2);
  await expect(drawer(page).locator('[data-missing]')).toHaveText('ناقص: الحساب البنكي');
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await openByHash(page, V3);
  await expect(drawer(page).locator('[data-missing]')).toHaveCount(0);
  await expect(loginSec(page).locator('[data-login-status]')).toHaveText('مستني التفعيل');
  await expect(info(loginSec(page), page, 'الباسورد')).toContainText('باسورد مؤقت — لسه ماتعملش'); // a row whose password step was refused
  // Task A's contract, straight at the server with the admin's token: an upsert on vendor_logins (no update grant on vendor_id /
  // created_by), a PATCH of a server column and of created_by are refused (42501); a missing e-mail is 23502; the RPCs on a maker
  // without a login row raise P0002 (nothing logged); a password past 128 characters is 22023
  const direct = await page.evaluate(async ([v1, v2]) => {
    const c = window.IBSupabase.client; const code = (r) => (r.error ? r.error.code : 'ok');
    const up = await c.from('vendor_logins').upsert({ vendor_id: v2, username: 'antikiano', email: 'a.dev@ibtekr.local', pw_mode: 'temp' }, { onConflict: 'vendor_id' });
    const srv = await c.from('vendor_logins').update({ must_change: false }).eq('vendor_id', v2);
    const cb = await c.from('vendor_logins').update({ created_by: 'سارة أحمد' }).eq('vendor_id', v2);
    const act = await c.from('vendor_logins').update({ status: 'active' }).eq('vendor_id', v2);
    const noMail = await c.from('vendor_logins').insert({ vendor_id: 'b0000000-0000-4000-8000-000000000009', username: 'no.mail', pw_mode: 'temp' });
    const rv = await c.rpc('vendor_login_reveal', { p_vendor: 'b0000000-0000-4000-8000-000000000009' });
    const sp = await c.rpc('vendor_login_set_password', { p_vendor: 'b0000000-0000-4000-8000-000000000009', p_password: 'Test1234' });
    const long = await c.rpc('vendor_login_set_password', { p_vendor: v2, p_password: 'Test1234' + 'x'.repeat(121) });
    return [code(up), code(srv), code(cb), code(act), code(noMail), code(rv), code(sp), code(long)];
  }, [V1, V2]);
  expect(direct).toEqual(['42501', '42501', '42501', '42501', '23502', 'ok', 'P0002', '22023']); // reveal without a row: null, logged (0012)
  expect(mock.rpcs.slice(-3).map((r) => r.result)).toEqual(['ok', 'P0002', '22023']);
  expect(serverActs('vendor.login.reveal').map((r) => r.entity_id)).toEqual(['b0000000-0000-4000-8000-000000000009']);
  expect(mock.vendorLogins.find((l) => l.vendor_id === V2)).toMatchObject({ must_change: true, status: 'invited', created_by: 'صفوت كمال' });
});

test('the add popup\'s dropdowns float above the modal and are not clipped; Esc closes the dropdown first, then the modal', async ({ page }) => {
  await openVendors(page);
  const m = await openAdd(page);
  await pickOption(page, 'v-bank-method', 'تحويل بنكي'); // the last select of a long form
  await m.locator('#v-bank-method').click();
  const menu = page.locator('[role=listbox]');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox(); const vp = page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(await menu.evaluate((el) => [getComputedStyle(el).position, el.classList.contains('floating')])).toEqual(['fixed', true]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
});

test('a username and an e-mail with html (seeded past the checks) render as text in the drawer, the edit popup and the copied text', async ({ page }) => {
  const l = mock.vendorLogins.find((x) => x.vendor_id === V2); l.username = EVIL; l.email = EVIL + '@x.y';
  await openVendors(page);
  await openDrawer(page, V2);
  const ls = loginSec(page);
  await expect(info(ls, page, 'اسم المستخدم')).toHaveText(EVIL);
  await expect(info(ls, page, 'الإيميل')).toHaveText(EVIL + '@x.y');
  await captureClipboard(page);
  await ls.locator('[data-copy-login]').click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual(['اسم المستخدم: ' + EVIL + '\nالإيميل: ' + EVIL + '@x.y\nالباسورد المؤقت: ' + TEST_PW]);
  await ls.getByRole('button', { name: 'تعديل بيانات الدخول' }).click();
  await expect(modal(page).locator('#l-login-user')).toHaveValue(EVIL);
  await expect(modal(page).locator('#l-login-email')).toHaveValue(EVIL + '@x.y');
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await inert(page);
});
