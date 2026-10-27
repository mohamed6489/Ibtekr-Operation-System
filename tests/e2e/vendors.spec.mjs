import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, XSS_NAME, IBAN, CONTRACT_PATH, CONTRACT_BYTES, CONTRACT_EXPIRES, SUPABASE_URL } from './supabase-mock.mjs';

// the page reads the real clock (IBVendors.today, local date); the browser runs on this machine
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const TODAY = ymd(new Date());
const dmy = (iso) => iso.split('-').reverse().join('/'); // D.formatDateNumeric
// The vendors page (block 28) on the sync's vendors table (phase 3 Task B): the list and the drawer from IBVendors, every edit
// written through its write-through store (a refused write puts the old value back and says why), the rates and the bank behind
// their sensitive keys, the contract in the private bucket, the maker's shares (decision 4) and his balance in this phase
// (decision 5), the activity_log with the vendor as entity. Mock only: the cases assert the mock's seed (three vendors, three
// orders of the last days) and the writes it recorded (mock.vendorWrites / uploads / signs / activity); E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local'; const VIEWER = 'viewer.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003'; // Art Craft, Antikiano, Bian eg (inactive)
const EVIL = '"><img src=x onerror="window.__xss=1">'; // breaks out of an attribute or a tag when not escaped
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
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
const rows = (page) => page.locator('#vendors table tbody tr[data-id]'); // the desktop table (Desktop Chrome)
const row = (page, id) => page.locator(`#vendors tr[data-id="${id}"]`);
// signed in, on #makers through the sidebar «المبتكرين»; the active makers listed (n of them)
async function openVendors(page, email = ADMIN, n = 2) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="vendors"]').click();
  await expect(page.locator('#vendors')).toBeVisible();
  await expect(page).toHaveURL(/#makers$/);
  await expect(rows(page)).toHaveCount(n);
}
const drawer = (page) => page.locator('.drawer[aria-label^="ملف المبتكر"]');
async function openDrawer(page, id) { await row(page, id).click(); await expect(drawer(page)).toBeVisible(); await expect(page).toHaveURL(new RegExp('#makers/' + id + '$')); return drawer(page); }
// a makers drawer straight from its hash (an inactive maker is not in the default list)
async function openByHash(page, id) { await page.evaluate((h) => { location.hash = h; }, 'makers/' + id); await expect(drawer(page)).toBeVisible(); return drawer(page); }
const section = (page, title) => drawer(page).locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: title }) });
const info = (scope, page, label) => scope.locator('.info-row').filter({ has: page.locator('.lab', { hasText: label }) }).locator('.val');
const modal = (page) => page.locator('.modal[role=dialog]');
const note = (page) => page.locator('#vendors .note');
const pushes = () => mock.vendorPushes.map(({ by, ...p }) => p); // phase 3.5: push_vendor calls
const tile = (page, label) => drawer(page).locator(`.kpi[aria-label="${label}"]`);
const kindTile = (page, kind) => drawer(page).locator(`.kpi[data-kind="${kind}"]`); // the orders tab's tiles (their aria-label says «عرض …»)
const tab = (page, label) => drawer(page).getByRole('tab', { name: label });
// sign out from the page: the app reloads itself on SIGNED_OUT, so wait for that load before touching the page again
async function signOut(page) {
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => { window.IBAuth.signOut(); })]);
  await expect(page.locator('#login')).toBeVisible();
}
// the writes the vendors tables took, without the mock's updated_at
const writes = () => mock.vendorWrites.map((w) => { const { updated_at, ...x } = w; return x; });
const acts = (action) => mock.activity.filter((a) => a.action === action).map((a) => ({ action: a.action, entity: a.entity, entity_id: a.entity_id, new_value: a.new_value }));
// nothing a vendor string carried ran or became an element
const inert = async (page) => {
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
};
// the status filter of the page («فلتر» → الحالة)
async function statusFilter(page, label) {
  await page.locator('#vendors [data-vfilter]').click();
  await page.locator('.vfilter-pop [role=radiogroup][aria-label="الحالة"] [role=radio]', { hasText: label }).click();
  await page.locator('.vfilter-pop [data-vapply]').dispatchEvent('click'); // the popover's foot sits below the viewport
}

test('the vendors page lists the sync\'s makers with the team columns and no seed; the reads name their columns', async ({ page }) => {
  await openVendors(page);
  await expect(row(page, V1)).toContainText('Art Craft');
  await expect(row(page, V2)).toContainText('Antikiano');
  await expect(row(page, V1).locator('td').nth(2)).toHaveText('35%'); // the rate effective today (sensitive.commission = F)
  await expect(row(page, V2).locator('td').nth(2)).toHaveText('45%'); // raised in October
  await expect(row(page, V1).locator('td').nth(3)).toHaveText('2'); // open orders
  for (const i of [5, 6, 9]) await expect(row(page, V1).locator('td').nth(i)).toHaveText('—'); // العربون / المواصلات / تذاكر: later phases
  await expect(page.locator('#vendors thead')).toContainText('مستحقاته (من 1 أكتوبر)');
  await expect(page.locator('#vendors')).not.toContainText('Medo .crafts'); // the prototype's seed is gone
  await expect(page.locator('#vendors')).not.toContainText('Balances_Payouts');
  await expect(page.locator('#vendors')).not.toContainText('Bian eg'); // inactive: not in the default list
  await statusFilter(page, 'الكل');
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, V3).locator('td').nth(2)).toHaveText('—'); // no rate yet
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/vendors').length).toBeGreaterThanOrEqual(1);
  expect(mock.requests).toContain('GET /rest/v1/vendor_rates');
  expect(mock.requests).toContain('GET /rest/v1/vendor_bank');
  expect(await page.evaluate(() => [window.IBVendors.state(), window.IBVendors.data().ratesVisible, window.IBVendors.store.all().length])).toEqual(['ready', true, 3]);
  // «إضافة مبتكر» for a member who may edit
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeEnabled();
});

test('search finds a maker by an alias', async ({ page }) => {
  await openVendors(page);
  const search = page.locator('#vendors input[type=search]');
  await search.fill('artcraft');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Art Craft');
  await search.fill('antikiano store');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Antikiano');
  await search.fill('nobody');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#vendors')).toContainText('مفيش مبتكر بالاسم ده');
});

test('the drawer: identity, contact, agreement, contract and the activity log from the server; the hash carries the uuid', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V2);
  const d = drawer(page);
  await expect(d.locator('.drawer-h h2')).toHaveText('Antikiano');
  await expect(d.locator('.drawer-h')).toContainText('نسبة إبتكر 45%');
  await expect(d.locator('.drawer-h')).toContainText('متجر #44');
  await expect(info(section(page, 'الهوية'), page, 'الاسم المعروض')).toHaveText('Antikiano');
  await expect(info(section(page, 'الهوية'), page, 'الأسماء البديلة')).toHaveText('Antikiano store');
  await expect(info(section(page, 'الهوية'), page, 'الفئة الأساسية')).toHaveText('إكسسوارات ومجوهرات');
  await expect(info(section(page, 'التواصل'), page, 'الهاتف (واتساب)')).toContainText('01000000001');
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'نسبة إبتكر')).toContainText('45%');
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'سجل النسبة')).toContainText('40% من 01/03/2026');
  await expect(section(page, 'العقد')).toContainText('العقد بينتهي خلال 30 يوم'); // the mock's contract expires 20 days from the clock
  await expect(section(page, 'العقد')).toContainText('ساري حتى ' + await page.evaluate((iso) => window.IbtekrDomain.formatDateLong(iso), CONTRACT_EXPIRES));
  await expect(section(page, 'العقد')).toContainText('PDF');
  await expect(section(page, 'العقد')).toContainText('رفعه منى حسن');
  await expect(section(page, 'سجل النشاط')).toContainText('لسه مفيش نشاط');
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/activity_log').length).toBeGreaterThanOrEqual(1);
  await d.getByRole('button', { name: 'إغلاق' }).first().click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#makers$/);
});

test('ops (vendors.edit = P) changes a phone: written, logged with the vendor as entity, shown in the timeline; a name change is refused by the server and comes back', async ({ page }) => {
  await openVendors(page, OPS);
  await openDrawer(page, V1);
  await section(page, 'التواصل').getByRole('button', { name: 'تعديل بيانات الاتصال' }).click();
  await modal(page).locator('#g-phone').fill('01000000009');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(info(section(page, 'التواصل'), page, 'الهاتف (واتساب)')).toContainText('01000000009');
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, phone: '01000000009' }]); // the changed column only
  await expect.poll(() => acts('vendor.update')).toEqual([{ action: 'vendor.update', entity: 'vendor', entity_id: V1, new_value: 'phone' }]);
  await expect(section(page, 'سجل النشاط')).toContainText('سارة أحمد عدّل بيانات المبتكر (phone)');
  await expect(info(section(page, 'التواصل'), page, 'الهاتف (واتساب)')).toContainText('01000000009'); // after the reload: the server's row
  await expect.poll(() => page.evaluate((id) => window.IBVendors.store.get(id).lastUpdate, V1)).not.toBe('2026-10-22T00:00:00Z'); // vendors.updated_at: bumped by the server on every write
  // the name: vendors.edit = F on the server → 42501 → the old name back, the reason on the page
  await section(page, 'الهوية').getByRole('button', { name: 'تعديل بيانات الهوية' }).click();
  await modal(page).locator('#g-name').fill('Art Craft Studio');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText('Art Craft');
  await expect(note(page)).toContainText('مش من صلاحياتك');
  await expect(row(page, V1)).toContainText('Art Craft');
  expect(writes().filter((w) => w.name)).toEqual([]);
  expect(acts('vendor.update')).toHaveLength(1);
  // no status toggle, no rate change in «المزيد»; the agreement hides the rate
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['نسخ رابط الملف', 'إنشاء تذكرة على المبتكر']);
  await page.keyboard.press('Escape');
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'نسبة إبتكر')).toHaveText('—');
  await expect(drawer(page).locator('.drawer-h')).toContainText('نسبة إبتكر —');
  await expect(row(page, V1).locator('td').nth(2)).toHaveText('—');
});

test('the admin toggles the status and sets the rate (no date — decision 12: from today; a second change the same day replaces it); the history shows both rates', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'تحويل لغير نشط' }).click();
  await expect(drawer(page).locator('.drawer-h .vstatus')).toHaveText('غير نشط');
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, status: 'inactive' }]);
  await expect.poll(() => acts('vendor.status')).toEqual([{ action: 'vendor.status', entity: 'vendor', entity_id: V1, new_value: 'inactive' }]);
  await expect(rows(page)).toHaveCount(1); // the list shows the active ones
  await section(page, 'الاتفاق التجاري').getByRole('button', { name: 'تعديل بيانات الاتفاق التجاري' }).click();
  await expect(modal(page).locator('#g-rate')).toHaveValue('35');
  await expect(modal(page).locator('#g-since')).toHaveCount(0); // no date field (decision 12)
  await modal(page).locator('#g-rate').fill('40');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  // Art Craft is on category_based (the fixture): the type kept, the default 40, no category changed — one vendor_commission_set (plan 3.4)
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_commission')).toEqual([{ table: 'vendor_commission', vendor_id: V1, type: 'category_based', rate: 40, flat: null, categories: [], since: TODAY, set_by: 'صفوت كمال' }]);
  await expect.poll(() => acts('vendor.rate')).toEqual([{ action: 'vendor.rate', entity: 'vendor', entity_id: V1, new_value: 'حسب الفئة — الأساسية 40%' }]);
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'سجل النسبة')).toContainText('35% من 01/03/2026 ← 40% من ' + dmy(TODAY));
  await expect(drawer(page).locator('.drawer-h')).toContainText('نسبة إبتكر 40%');
  await expect(section(page, 'سجل النشاط')).toContainText('غيّر نسبة إبتكر (حسب الفئة — الأساسية 40%)');
  expect(mock.vendors.find((v) => v.id === V1).commission_pct).toBe(40); // the trigger
  // a second change the same day replaces the day's row (owner, 27 Oct: the rate changes like on Dokan)
  await section(page, 'الاتفاق التجاري').getByRole('button', { name: 'تعديل بيانات الاتفاق التجاري' }).click();
  await expect(modal(page).locator('#g-rate')).toHaveValue('40');
  await modal(page).locator('#g-rate').fill('42');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_commission').slice(1)).toEqual([{ table: 'vendor_commission', vendor_id: V1, type: 'category_based', rate: 42, flat: null, categories: [], since: TODAY, set_by: 'صفوت كمال' }]);
  await expect(drawer(page).locator('.drawer-h')).toContainText('نسبة إبتكر 42%');
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'سجل النسبة')).toContainText('35% من 01/03/2026 ← 42% من ' + dmy(TODAY));
  expect(mock.vendorRates.filter((r) => r.vendor_id === V1)).toHaveLength(2);
  expect(mock.vendors.find((v) => v.id === V1).commission_pct).toBe(42);
});

test('accounts sees the bank row and reveals the IBAN (logged, never with the number); ops sees «مخفي» and no error', async ({ page }) => {
  await openVendors(page, ACCOUNTS);
  await openByHash(page, V3);
  await tab(page, 'الحسابات').click();
  const bank = section(page, 'الحساب البنكي');
  const ibanField = bank.locator('.secure').filter({ hasText: 'IBAN' }); // phase 3.5: the account number has its own field
  await expect(ibanField).toContainText('•••• •••• •••• 0482');
  await expect(bank).not.toContainText(IBAN);
  await ibanField.getByRole('button', { name: 'إظهار' }).click();
  await expect(ibanField).toContainText(IBAN);
  await expect.poll(() => acts('vendor.reveal')).toEqual([{ action: 'vendor.reveal', entity: 'vendor', entity_id: V3, new_value: 'IBAN' }]);
  await ibanField.getByRole('button', { name: 'إخفاء' }).click();
  await ibanField.getByRole('button', { name: 'إظهار' }).click();
  await expect(ibanField).toContainText(IBAN);
  expect(acts('vendor.reveal')).toHaveLength(1); // once per drawer open
  expect(JSON.stringify(mock.activity)).not.toContain('0482');
  await expect(info(bank, page, 'طريقة الدفع المفضلة')).toHaveText('تحويل بنكي');
  await expect(bank.getByRole('button', { name: 'تعديل بيانات الحساب البنكي' })).toBeVisible();
  // accounts (vendors.edit = N): no «تعديل» on the data groups, the add button disabled
  await expect(drawer(page).getByRole('button', { name: /^تعديل بيانات/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeDisabled();
});

test('ops opens a maker with a bank row: the section says hidden, the server returned nothing, no page error', async ({ page }) => {
  await openVendors(page, OPS);
  await openByHash(page, V3);
  await tab(page, 'الحسابات').click();
  const bank = section(page, 'الحساب البنكي');
  await expect(bank).toContainText('مخفي — متاح للأدمن ودور الحسابات فقط');
  await expect(bank).not.toContainText('0482');
  await expect(bank.getByRole('button', { name: 'إظهار' })).toHaveCount(0);
  expect(mock.requests).toContain('GET /rest/v1/vendor_bank'); // asked; the policy answered []
  expect(await page.evaluate(() => window.IBVendors.store.get('a0000000-0000-4000-8000-000000000003').bank)).toBeNull();
  await expect(tile(page, 'العربون')).toContainText('من مرحلة الحسابات');
});

test('accounts writes a bank row (phase 3.5): every Dokan field, refused before any request when incomplete, a confirmation of its own («رجوع للتعديل» keeps what was typed), then the row and the push of `bank`; an update the same way; the event names the method only', async ({ page }) => {
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V1);
  await tab(page, 'الحسابات').click();
  await section(page, 'الحساب البنكي').getByRole('button', { name: 'إضافة بيانات الحساب البنكي' }).click();
  await modal(page).locator('#b-holder').fill('Art Craft');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('اكتب اسم البنك');
  await expect(modal(page)).toContainText('اكتب رقم الحساب أو الـ IBAN');
  await modal(page).locator('#b-bank').fill('بنك مصر');
  await modal(page).locator('#b-acno').fill('0000 1111 2222 3333');
  await modal(page).locator('#b-swift').fill('nbegegcx');
  await modal(page).locator('#b-baddr').fill('عنوان تجريبي');
  await modal(page).locator('#b-actype').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'شخصي (Personal)' }).click();
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  // the confirmation: nothing written yet
  await expect(modal(page).locator('h2')).toHaveText('تأكيد تغيير الحساب البنكي — Art Craft');
  await expect(modal(page).locator('tr[data-bank-change]')).toHaveCount(7); // method, holder, bank, account number, type, SWIFT, address
  await expect(modal(page).locator('tr[data-bank-change="accountNumber"]')).toContainText('0000 1111 2222 3333');
  await expect(modal(page)).toContainText('بتتبعت لمتجره على الموقع');
  expect(writes().filter((w) => w.table === 'vendor_bank')).toEqual([]);
  await modal(page).getByRole('button', { name: 'رجوع للتعديل' }).click();
  await expect(modal(page).locator('#b-acno')).toHaveValue('0000 1111 2222 3333'); // as typed
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await modal(page).locator('[data-bank-confirm]').click();
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_bank')).toEqual([{ table: 'vendor_bank', op: 'insert', vendor_id: V1, method: 'bank', bank_name: 'بنك مصر', holder: 'Art Craft', iban: null, wallet: null,
    account_number: '0000111122223333', account_type: 'personal', bank_address: 'عنوان تجريبي', routing_number: null, swift: 'NBEGEGCX', updated_by: 'منى حسن' }]);
  await expect.poll(() => pushes()).toEqual([{ vendor_id: V1, fields: ['bank'], result: 'ok' }]);
  const bank = section(page, 'الحساب البنكي');
  await expect(info(bank, page, 'اسم صاحب الحساب')).toHaveText('Art Craft');
  await expect(info(bank, page, 'نوع الحساب')).toHaveText('شخصي (Personal)');
  await expect(info(bank, page, 'SWIFT')).toHaveText('NBEGEGCX');
  await expect(bank.locator('.secure').filter({ hasText: 'رقم الحساب' })).toContainText('3333');
  await expect(bank).not.toContainText('0000111122223333'); // masked until «إظهار»
  // an update: only the changed field in the confirmation
  await bank.getByRole('button', { name: 'تعديل بيانات الحساب البنكي' }).click();
  await modal(page).locator('#b-bank').fill('البنك الأهلي المصري');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page).locator('tr[data-bank-change]')).toHaveCount(1);
  await modal(page).locator('[data-bank-confirm]').click();
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_bank' && w.op === 'update').map((w) => [w.bank_name, w.account_number])).toEqual([['البنك الأهلي المصري', '0000111122223333']]);
  await expect.poll(() => pushes().length).toBe(2);
  // nothing changed: no confirmation, nothing written
  await bank.getByRole('button', { name: 'تعديل بيانات الحساب البنكي' }).click();
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('مفيش تغيير في الحساب البنكي');
  await expect.poll(() => acts('vendor.bank')).toEqual([{ action: 'vendor.bank', entity: 'vendor', entity_id: V1, new_value: 'bank' }, { action: 'vendor.bank', entity: 'vendor', entity_id: V1, new_value: 'bank' }]);
  expect(JSON.stringify(mock.activity)).not.toContain('3333');
  expect(writes().filter((w) => w.table === 'vendor_bank')).toHaveLength(2);
});

test('a 2 MB PDF contract uploads to <uuid>/<ms>-<safe name> and lands in vendors.contract; the card shows it', async ({ page }) => {
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V1);
  await expect(section(page, 'العقد')).toContainText('العقد غير مرفوع');
  await section(page, 'العقد').getByRole('button', { name: 'ارفع العقد الآن' }).click();
  await modal(page).locator('input[type=file]').setInputFiles({ name: 'عقد Art Craft 2026.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2 * 1048576, 0x20) });
  await modal(page).getByRole('button', { name: 'رفع العقد' }).click();
  await expect.poll(() => mock.uploads.length).toBe(1);
  const up = mock.uploads[0];
  expect(up.path).toMatch(new RegExp('^' + V1 + '/\\d{13}-____Art_Craft_2026\\.pdf$'));
  expect([up.type, up.size, up.upsert, up.by, up.ok]).toEqual(['application/pdf', 2097152, 'false', ACCOUNTS, 'ok']);
  await expect.poll(() => writes().filter((w) => w.contract)).toHaveLength(1);
  const w = writes().find((x) => x.contract);
  expect(w.contract).toEqual({ path: up.path, file_name: 'عقد Art Craft 2026.pdf', size: 2097152, expires: null, uploaded_by: 'منى حسن', uploaded_at: w.contract.uploaded_at });
  await expect(section(page, 'العقد')).toContainText('عقد التعاون');
  await expect(section(page, 'العقد')).toContainText('PDF 2.0 ميجا');
  await expect(section(page, 'العقد')).toContainText('رفعه منى حسن');
  await expect.poll(() => acts('vendor.contract')).toEqual([{ action: 'vendor.contract', entity: 'vendor', entity_id: V1, new_value: 'PDF · 2.0 ميجا' }]);
  await expect(section(page, 'العقد').getByRole('button', { name: 'استبدال' })).toBeVisible();
  // decision 8 (amended): accounts (vendors.edit = N) may change the contract and nothing else — the guard refuses every other column
  const refused = await page.evaluate(async (id) => {
    const c = window.IBSupabase.client; const out = [];
    for (const patch of [{ phone: '01000000008' }, { name: 'x' }, { status: 'inactive' }]) { const { error } = await c.from('vendors').update(patch).eq('id', id); out.push(error ? error.code + ' ' + error.message : 'ok'); }
    return out;
  }, V1);
  expect(refused).toEqual(['42501 vendors.edit (F or P) is required to change a vendor contact or notes', '42501 vendors.edit = F is required to change a vendor name, category, aliases or terms', '42501 vendors.toggle = F is required to change a vendor status']);
  expect(writes().filter((x) => x.table === 'vendors')).toHaveLength(1); // the contract write alone
});

test('the server refuses a wrong type, an oversized file, a key outside the layout and a member without the key; the page checks the type first', async ({ page }) => {
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V1);
  await section(page, 'العقد').getByRole('button', { name: 'ارفع العقد الآن' }).click();
  await modal(page).locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.alloc(100) });
  await modal(page).getByRole('button', { name: 'رفع العقد' }).click();
  await expect(note(page)).toContainText('PDF أو صورة');
  expect(mock.uploads).toEqual([]); // never sent
  // straight at the Storage API (what a tampered page could send): the server's own answers
  const codes = await page.evaluate(async ([v1]) => {
    const s = window.IBSupabase.client.storage.from('vendor-contracts'); const ms = Date.now();
    const r = await Promise.all([
      s.upload(v1 + '/' + ms + '-virus.exe', new ArrayBuffer(16), { contentType: 'application/x-msdownload', upsert: false }),
      s.upload(v1 + '/' + ms + '-big.pdf', new ArrayBuffer(10 * 1048576 + 1), { contentType: 'application/pdf', upsert: false }),
      s.upload('elsewhere/' + ms + '-x.pdf', new ArrayBuffer(16), { contentType: 'application/pdf', upsert: false }),
    ]);
    return r.map((x) => (x.error ? x.error.statusCode : 'ok'));
  }, [V1]);
  expect(codes).toEqual(['415', '413', '400']);
  expect(mock.uploads.map((u) => u.ok)).toEqual(['invalid_mime_type', 'Payload too large', 'InvalidKey']);
  expect(mock.objects.size).toBe(1); // nothing stored
});

test('a member without sensitive.vendor_bank can neither upload nor sign a URL; «عرض» opens a 60 s signed URL that serves the file', async ({ page }) => {
  await openVendors(page, OPS);
  const ops = await page.evaluate(async ([v2, path]) => {
    const s = window.IBSupabase.client.storage.from('vendor-contracts');
    const up = await s.upload(v2 + '/' + Date.now() + '-x.pdf', new ArrayBuffer(16), { contentType: 'application/pdf', upsert: false });
    const sign = await s.createSignedUrl(path, 60);
    const url = await window.IBVendors.contractUrl(v2);
    return [up.error && up.error.statusCode, sign.error && sign.error.statusCode, url.ok];
  }, [V2, CONTRACT_PATH]);
  expect(ops).toEqual(['403', '400', false]);
  await openDrawer(page, V2);
  await expect(section(page, 'العقد').getByRole('button', { name: 'استبدال' })).toHaveCount(0); // canManage = canBank
  await page.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; });
  await section(page, 'العقد').getByRole('button', { name: 'عرض' }).click();
  await expect(note(page)).toContainText('مش من صلاحياتك'); // refused before any request: the Storage policies need the key
  expect(mock.signs.filter((s) => s.by === OPS)).toHaveLength(1); // the direct client call above only: «عرض» sent nothing
  expect(await page.evaluate(() => window.__opened)).toEqual([]);
  // accounts: the signed URL opens in a new tab and serves the file with its type
  await signOut(page);
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V2);
  await page.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; });
  await section(page, 'العقد').getByRole('button', { name: 'عرض' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  const [url, target, features] = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith(SUPABASE_URL + '/storage/v1/object/sign/vendor-contracts/' + CONTRACT_PATH + '?token=')).toBe(true);
  expect([target, features]).toEqual(['_blank', 'noopener']);
  expect(mock.signs.filter((s) => s.by === ACCOUNTS)).toEqual([{ path: CONTRACT_PATH, expiresIn: 60, by: ACCOUNTS }]);
  const served = await page.evaluate(async (u) => { const r = await fetch(u); return [r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; }, url);
  expect(served).toEqual([200, 'application/pdf', CONTRACT_BYTES.length]);
  const bad = await page.evaluate(async (u) => (await fetch(u.replace(/token=.*/, 'token=forged'))).status, url);
  expect(bad).toBe(400);
});

test('the shares (decision 4): a completed order counts in «حقه من المكتملة», an open one in «هيستحق بعد التنفيذ»; a line without a rate uses ours when visible, else counts in full and is marked', async ({ page }) => {
  const o = mock.orders.find((x) => x.id === 181668); o.status = 'مكتمل'; o.woo_status = 'completed'; // 1002 @ 35/0 for Art Craft, 2539 @ 40/10 for Antikiano
  await openVendors(page);
  await openDrawer(page, V1);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'حقه من المكتملة').locator('.t-h3')).toHaveText('651.30'); // 1002 − 350.70
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('651.30'); // 180686: no rate on the line → ours (35%) on its date
  await expect(tile(page, 'رصيده عندنا').locator('.t-h3')).toHaveText('651.30'); // opening 0 + earned
  await expect(tile(page, 'حصة إبتكر من المكتملة').locator('.t-h3')).toHaveText('350.70');
  await expect(tile(page, 'العربون').locator('.t-h3')).toHaveText('—');
  await expect(tile(page, 'المواصلات')).toContainText('من مرحلة الحسابات');
  await expect(drawer(page)).not.toContainText('بدون نسبة');
  const byStatus = section(page, 'حسب حالة الأوردر');
  await expect(byStatus.locator('tbody tr').nth(0)).toContainText('مكتمل');
  await expect(byStatus.locator('tbody tr').nth(0).locator('td').nth(1)).toHaveText('1');
  await expect(byStatus.locator('tbody tr').nth(0).locator('td').nth(3)).toHaveText('651.30');
  await expect(byStatus.locator('tbody tr').nth(1).locator('td').nth(3)).toHaveText('651.30'); // قيد التنفيذ
  await expect(section(page, 'الحركات المالية')).toContainText('بتتسجل من مرحلة الحسابات');
  await expect(info(section(page, 'ملخص حسابه معانا'), page, 'مستحقاته (من 1 أكتوبر)')).toContainText('651.30 (له)');
  await expect(row(page, V1).locator('td').nth(7)).toHaveText('651.30');
  // Antikiano: 2539 − (1015.60 + 10) on the completed order; the on-hold order is open (its line has no rate: 45% since October)
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await openDrawer(page, V2);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'حقه من المكتملة').locator('.t-h3')).toHaveText('1,513.40');
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('494.45');
  // ops: the rates are hidden → the open line counts in full and is marked; no Ibtekr share anywhere
  await signOut(page);
  await openVendors(page, OPS);
  await openDrawer(page, V1);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'حقه من المكتملة').locator('.t-h3')).toHaveText('651.30'); // the website's rate on the line: readable with orders.view
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('1,002.00');
  await expect(drawer(page)).toContainText('1 سطر بدون نسبة');
  await expect(tile(page, 'حصة إبتكر من المكتملة')).toHaveCount(0);
  await expect(section(page, 'حسب حالة الأوردر').locator('thead')).not.toContainText('حصة إبتكر');
});

test('a rename reloads the orders (their makers carry vendors.name) and the drawer still finds its orders', async ({ page }) => {
  await openVendors(page);
  expect(await page.evaluate(() => window.OrdersApp.vendors())).toEqual(['Antikiano', 'Art Craft']);
  await openDrawer(page, V1);
  await section(page, 'الهوية').getByRole('button', { name: 'تعديل بيانات الهوية' }).click();
  await modal(page).locator('#g-name').fill('Art Craft Studio');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, name: 'Art Craft Studio' }]);
  await expect.poll(() => page.evaluate(() => window.OrdersApp.vendors())).toEqual(['Antikiano', 'Art Craft Studio']);
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText('Art Craft Studio');
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('2');
  await expect(row(page, V1).locator('td').nth(3)).toHaveText('2');
});

test('a maker name and a note with html render as text in the list, the search and the drawer', async ({ page }) => {
  const v = mock.vendors.find((x) => x.id === V1); v.name = XSS_NAME; v.notes = EVIL; v.aliases = [EVIL];
  await openVendors(page);
  await expect(row(page, V1)).toContainText(XSS_NAME);
  await page.locator('#vendors input[type=search]').fill('<img');
  await expect(rows(page)).toHaveCount(1);
  await openDrawer(page, V1);
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText(XSS_NAME);
  await expect(info(section(page, 'الهوية'), page, 'الأسماء البديلة')).toHaveText(EVIL);
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'ملاحظات الاتفاق')).toHaveText(EVIL);
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('2'); // matched by the shown name
  await inert(page);
});

test('a write that never reaches the server comes back with the network reason', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  mock.vendorsDown = true;
  await section(page, 'التواصل').getByRole('button', { name: 'تعديل بيانات الاتصال' }).click();
  await modal(page).locator('#g-phone').fill('01000000008');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(info(section(page, 'التواصل'), page, 'الهاتف (واتساب)')).toContainText('01000000003'); // back
  await expect(note(page)).toContainText('الشبكة مش متاحة');
  expect(writes()).toEqual([]);
  expect(acts('vendor.update')).toEqual([]);
  mock.vendorsDown = false;
});

test('a viewer (vendors.view = P) reads the list and the drawer with nothing to edit', async ({ page }) => {
  mock.profiles.find((x) => x.member_code === 'M99').status = 'active';
  await openVendors(page, VIEWER);
  await expect(page.getByRole('button', { name: 'إضافة مبتكر' })).toBeDisabled();
  await openDrawer(page, V1);
  await expect(drawer(page).getByRole('button', { name: /^تعديل/ })).toHaveCount(0);
  await expect(info(section(page, 'التواصل'), page, 'الهاتف (واتساب)')).toContainText('01000000003'); // the phone is not a sensitive key (decision 9)
  await expect(info(section(page, 'الاتفاق التجاري'), page, 'نسبة إبتكر')).toHaveText('—');
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['نسخ رابط الملف', 'إنشاء تذكرة على المبتكر']);
  await page.keyboard.press('Escape');
  await tab(page, 'الحسابات').click();
  await expect(section(page, 'الحساب البنكي')).toContainText('مخفي');
  expect(writes()).toEqual([]);
});

test('delete (admin): refused while order lines point at the maker, with a clear message; a maker without orders goes', async ({ page }) => {
  await openVendors(page);
  await page.evaluate((id) => window.IBVendors.store.remove(id, window.IBVendors.store.actor()), V1);
  await expect(note(page)).toContainText('ماينفعش يتمسح — عليه أوردرات');
  await expect(row(page, V1)).toBeVisible(); // back
  expect(writes().filter((w) => w.op === 'delete')).toEqual([]);
  await page.evaluate((id) => window.IBVendors.store.remove(id, window.IBVendors.store.actor()), V3);
  await expect.poll(() => writes().filter((w) => w.op === 'delete')).toEqual([{ table: 'vendors', op: 'delete', id: V3 }]);
  await expect.poll(() => acts('vendor.remove')).toEqual([{ action: 'vendor.remove', entity: 'vendor', entity_id: V3, new_value: 'Bian eg' }]);
  expect(mock.vendorBank).toEqual([]); // cascaded
  await statusFilter(page, 'الكل');
  await expect(rows(page)).toHaveCount(2);
  // ops is refused before anything is sent
  await signOut(page);
  await openVendors(page, OPS);
  expect(await page.evaluate((id) => { try { window.IBVendors.store.remove(id, window.IBVendors.store.actor()); return 'removed'; } catch (e) { return e.message; } }, V2)).toBe('مش من صلاحياتك');
  expect(writes().filter((w) => w.op === 'delete')).toHaveLength(1);
});

test('«إضافة مبتكر» (phase 3.1: basics + login + bank) creates the maker on the server with its first rate, its login and its bank row, and opens its drawer; ops is refused before any request', async ({ page }) => {
  await openVendors(page);
  await page.getByRole('button', { name: 'إضافة مبتكر' }).click();
  await modal(page).locator('#v-name').fill(' zaan ');
  await modal(page).locator('#v-cat').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'هدايا' }).click();
  await modal(page).locator('#v-phone').fill('01000000009');
  await modal(page).locator('#v-aliases').fill('zana، Zaan');
  await expect(modal(page).locator('#v-login-user')).toHaveValue('zaan');
  await modal(page).locator('#v-login-email').fill('zaan.dev@ibtekr.local');
  await modal(page).locator('[data-genpw]').click(); // the temporary password — the only mode (26 Oct)
  await modal(page).locator('#v-bank-method').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'نقدي عند التسليم' }).click();
  await modal(page).getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).locator('.drawer-h h2')).toHaveText('zaan');
  await expect(drawer(page).locator('.drawer-h')).toContainText('بدون متجر على الموقع');
  await expect(page).toHaveURL(/#makers\/b0000000-0000-4000-8000-000000000001$/);
  const ins = writes().filter((w) => w.op === 'insert');
  expect(ins.map((w) => w.table)).toEqual(['vendors', 'vendor_rates', 'vendor_logins', 'vendor_bank']);
  expect(ins[0]).toEqual({ table: 'vendors', op: 'insert', name: 'zaan', category: 'هدايا', phone: '01000000009', email: 'zaan.dev@ibtekr.local', status: 'active', lead_days: 7, aliases: ['zana', 'Zaan'], joined_at: ins[0].joined_at });
  expect(ins[0].joined_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(ins[1]).toEqual({ table: 'vendor_rates', op: 'insert', vendor_id: 'b0000000-0000-4000-8000-000000000001', rate: 40, since: ins[1].since, set_by: 'صفوت كمال' });
  expect(ins[2]).toEqual({ table: 'vendor_logins', op: 'insert', vendor_id: 'b0000000-0000-4000-8000-000000000001', username: 'zaan', email: 'zaan.dev@ibtekr.local', pw_mode: 'temp', created_by: 'صفوت كمال' }); // created_by: the member's name
  await expect.poll(() => acts('vendor.create')).toEqual([{ action: 'vendor.create', entity: 'vendor', entity_id: 'b0000000-0000-4000-8000-000000000001', new_value: 'zaan' }]);
  await expect(drawer(page).locator('.drawer-h')).toContainText('نسبة إبتكر 40%');
  await expect(rows(page)).toHaveCount(3);
  await signOut(page);
  await openVendors(page, OPS, 3);
  await page.getByRole('button', { name: 'إضافة مبتكر' }).click();
  await modal(page).locator('#v-name').fill('nope');
  await modal(page).locator('#v-cat').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'هدايا' }).click();
  await modal(page).locator('#v-phone').fill('01000000007');
  await modal(page).locator('#v-login-email').fill('nope.dev@ibtekr.local'); await modal(page).locator('[data-genpw]').click();
  await expect(modal(page).locator('#v-bank-method')).toHaveCount(0); // no sensitive.vendor_bank: the bank section says accounts completes it
  await expect(modal(page)).toContainText('البيانات البنكية بيكمّلها قسم الحسابات بس');
  await modal(page).getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(modal(page)).toContainText('مش من صلاحياتك');
  expect(writes().filter((w) => w.op === 'insert')).toHaveLength(4);
});

test('«في إجازة» (phase 3.1): a status like the others — from «المزيد», in the tag, the filter, the KPI and the edit popups; the maker leaves the active list', async ({ page }) => {
  await openVendors(page);
  await expect(page.locator('#vendors .kpi[aria-label="مبتكرين نشطين"] .t-h3')).toHaveText('2');
  await openDrawer(page, V2);
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['تحويل لـ «في إجازة»', 'تحويل لغير نشط', 'تغيير النسبة (الأوردرات الجديدة فقط)', 'نسخ رابط الملف', 'إنشاء تذكرة على المبتكر']);
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'في إجازة' }).click();
  await expect(drawer(page).locator('.drawer-h .vstatus')).toHaveText('في إجازة');
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V2, status: 'leave' }]);
  await expect.poll(() => acts('vendor.status')).toEqual([{ action: 'vendor.status', entity: 'vendor', entity_id: V2, new_value: 'leave' }]);
  expect(mock.vendors.find((v) => v.id === V2).status).toBe('leave'); // the check constraint takes it (0012)
  await expect(info(section(page, 'الهوية'), page, 'الحالة')).toHaveText('في إجازة');
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await expect(page.locator('[role=menu] [role=menuitem]').first()).toHaveText('تفعيل المبتكر');
  await page.keyboard.press('Escape');
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await expect(rows(page)).toHaveCount(1); // not active any more
  await expect(page.locator('#vendors .kpi[aria-label="مبتكرين نشطين"] .t-h3')).toHaveText('1');
  expect(await page.evaluate(() => window.IbtekrVendors.summary(window.IBVendors.store.all(), {}).active)).toBe(1); // leave counts as inactive everywhere (tasks, KPI)
  await statusFilter(page, 'في إجازة');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, V2).locator('.vstatus')).toHaveText('في إجازة');
  await expect(page.locator('#vendors .fchips')).toContainText('الحالة: في إجازة');
  await openByHash(page, V2);
  await section(page, 'الهوية').getByRole('button', { name: 'تعديل بيانات الهوية' }).click();
  await expect(modal(page).locator('#g-status .val')).toHaveText('في إجازة');
  await modal(page).locator('#g-status').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveText(['نشط', 'في إجازة', 'غير نشط']);
  await page.keyboard.press('Escape');
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await page.getByRole('button', { name: 'إضافة مبتكر' }).click();
  await modal(page).locator('#v-status').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveText(['نشط', 'في إجازة', 'غير نشط']);
});

test('sign-out leaves no maker on the page', async ({ page }) => {
  await openVendors(page);
  await page.evaluate(() => window.IBAuth.signOut());
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => [window.IBVendors.state(), window.IBVendors.store.all().length, window.IBVendors.data()])).toEqual(['idle', 0, null]);
});
