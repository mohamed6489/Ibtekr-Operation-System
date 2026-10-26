import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, BRAND, NEW_BRAND, TRANSFER_SINCE, TRANSFER_RETURN } from './supabase-mock.mjs';

// The brands of phase 3.2 (decisions 3–7) on the mocked Supabase: the drawer's «البراندات» section for each role, adding / editing a
// brand (the writes in order, the events, the table and the list's grey line), the special rate (accounts-only column, the share
// in the orders tab), a temporary transfer and the return (the two makers' events, the attribution of the store's orders before /
// after the date, «كان عنده» and «مؤقت لحد»), the local refusals before any request, the delete guard, html as text, the search by a
// brand's name or alias. Mock only; E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local'; const VF = 'vf.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003'; // Art Craft, Antikiano, Bian eg (inactive)
const B1 = BRAND(1), B2 = BRAND(2); // the automatic brands of Art Craft and Antikiano
const EVIL = '"><img src=x onerror="window.__xss=1">';
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const TODAY = ymd(new Date()); const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));
const dmy = (iso) => iso.split('-').reverse().join('/'); // D.formatDateNumeric
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message)); mock = null;
});
test.afterEach(() => {
  if (LIVE || !mock) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
const setup = async (page, opts) => { mock = await installSupabaseMock(page, opts); return mock; };

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
const drawer = (page) => page.locator('.drawer[aria-label^="ملف المبتكر"]');
async function openDrawer(page, id) { await row(page, id).click(); await expect(drawer(page)).toBeVisible(); return drawer(page); }
async function openByHash(page, id) { await page.evaluate((h) => { location.hash = h; }, 'makers/' + id); await expect(drawer(page)).toBeVisible(); await expect(page).toHaveURL(new RegExp('#makers/' + id + '$')); return drawer(page); }
const section = (page, title) => drawer(page).locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: title }) });
const brands = (page) => section(page, 'البراندات');
const brandRow = (page, id) => brands(page).locator(`tr[data-brand="${id}"]`);
const modal = (page) => page.locator('.modal[role=dialog]');
const note = (page) => page.locator('#vendors .note');
const tile = (page, label) => drawer(page).locator(`.kpi[aria-label="${label}"]`);
const kindTile = (page, kind) => drawer(page).locator(`.kpi[data-kind="${kind}"]`);
const tab = (page, label) => drawer(page).getByRole('tab', { name: label });
async function signOut(page) {
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => { window.IBAuth.signOut(); })]);
  await expect(page.locator('#login')).toBeVisible();
}
const writes = () => mock.brandWrites;
const acts = (action) => mock.activity.filter((a) => a.action === action).map((a) => ({ entity: a.entity, entity_id: a.entity_id, new_value: a.new_value }));
const byMaker = (list) => list.slice().sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1)); // the two rows of a transfer go out together
const posts = (t) => mock.requests.filter((r) => r === 'POST /rest/v1/' + t).length;
const inert = async (page) => {
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
};
async function openBrandMenu(page, id, label) { await brandRow(page, id).locator('[data-brand-menu]').click(); await page.locator('[role=menu] [role=menuitem]', { hasText: label }).click(); }
async function pickOption(page, selectId, label) { await modal(page).locator('#' + selectId).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).click(); }
// a DateField typed like a user: the value, then Tab (the native change on blur; a dispatched change would leave the input dirty and fire again when the redraw removes it)
async function typeDate(page, inputId, iso) { const el = modal(page).locator('#' + inputId); await el.fill(dmy(iso)); await el.press('Tab'); }
const cancel = (page) => modal(page).getByRole('button', { name: 'إلغاء' }).click(); // Escape would close the drawer under the modal too
async function statusFilter(page, label) {
  await page.locator('#vendors [data-vfilter]').click();
  await page.locator('.vfilter-pop [role=radiogroup][aria-label="الحالة"] [role=radio]', { hasText: label }).click();
  await page.locator('.vfilter-pop [data-vapply]').dispatchEvent('click');
}
// a hand-added brand of Art Craft in the seed (no store), for the search and the grey line
const seedWoodRope = (m, name = 'Wood & Rope') => { m.brands.push({ id: 'd0000000-0000-4000-8000-000000000009', name, code: 'W', aliases: ['W&R'], store_vendor_id: null, origin_vendor_id: V1, created_by: 'صفوت كمال', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }); m.brandOwners.push({ id: 99, brand_id: 'd0000000-0000-4000-8000-000000000009', vendor_id: V1, since: '2026-09-01', return_on: null, reason: null, set_by: 'صفوت كمال', created_at: '2026-10-22T00:00:00Z' }); };

test('the admin: the automatic brand in «البراندات» (code, aliases, «متجر على الموقع», the maker\'s rate, since), «إضافة براند» and the ⋮ menu; the three tables read at sign-in; the search finds a maker by a brand\'s name or alias and the list shows the brand line', async ({ page }) => {
  await setup(page); seedWoodRope(mock);
  await openVendors(page);
  for (const t of ['brands', 'brand_owners', 'brand_rates']) expect(mock.requests).toContain('GET /rest/v1/' + t);
  await openDrawer(page, V2);
  const r = brandRow(page, B2);
  await expect(r).toContainText('Antikiano');
  await expect(r).toContainText('الكود A');
  await expect(r).toContainText('Antikiano store');
  await expect(r).toContainText('متجر على الموقع');
  await expect(r.locator('[data-brand-rate]')).toHaveText('نسبة المبتكر');
  await expect(r).toContainText('01/03/2026'); // joined_at
  await expect(r).not.toContainText('مؤقت');
  await expect(brands(page)).not.toContainText('كان عنده');
  await expect(brands(page).getByRole('button', { name: 'إضافة براند' })).toBeVisible();
  await r.locator('[data-brand-menu]').click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['تعديل', 'النسبة الخاصة', 'نقل لمبتكر تاني']); // with its origin: no «رجوع لصاحبه»
  await page.keyboard.press('Escape');
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  // the search: the hand-added brand of Art Craft by its name and by its alias; the grey line under his name
  await expect(row(page, V1).locator('[data-brands]')).toHaveText('Wood & Rope');
  await expect(row(page, V2).locator('[data-brands]')).toHaveCount(0); // the automatic brand carries his own name
  const search = page.locator('#vendors input[type=search]');
  await search.fill('wood');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Art Craft');
  await search.fill('w&r');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Art Craft');
  await search.fill('antikiano store');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Antikiano');
  await search.fill('nobody');
  await expect(rows(page)).toHaveCount(0);
  expect(writes()).toEqual([]);
});

test('ops (vendors.edit = P) and accounts read the section only: no button, no menu, no rate column; a store call is refused before any request; vendors follow-up (edit = F) may add but sees no rate', async ({ page }) => {
  await setup(page);
  await openVendors(page, OPS);
  await openDrawer(page, V2);
  await expect(brandRow(page, B2)).toContainText('Antikiano');
  await expect(brands(page).getByRole('button', { name: 'إضافة براند' })).toHaveCount(0);
  await expect(brands(page).locator('[data-brand-menu]')).toHaveCount(0);
  await expect(brands(page).locator('[data-brand-rate]')).toHaveCount(0);
  await expect(brands(page).locator('thead')).not.toContainText('النسبة');
  const refused = await page.evaluate(async ([b2, v1]) => { const S = window.IBVendors.store; const out = [];
    try { await S.addBrand(v1, { name: 'Zaan' }, S.actor()); out.push('added'); } catch (e) { out.push(e.message); }
    try { S.updateBrand(b2, { name: 'Zaan' }, S.actor()); out.push('updated'); } catch (e) { out.push(e.message); }
    try { S.transferBrand(b2, v1, { since: '2026-10-25' }, S.actor()); out.push('moved'); } catch (e) { out.push(e.message); }
    try { S.setBrandRate(b2, 30, '2026-10-25', S.actor()); out.push('rated'); } catch (e) { out.push(e.message); }
    return out; }, [B2, V1]);
  expect(refused).toEqual(['مش من صلاحياتك', 'مش من صلاحياتك', 'مش من صلاحياتك', 'مش من صلاحياتك']);
  expect([posts('brands'), posts('brand_owners'), posts('brand_rates'), writes()]).toEqual([0, 0, 0, []]);
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/brand_rates')).toEqual([]); // no sensitive.commission: never asked
  await signOut(page);
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V2);
  await expect(brandRow(page, B2)).toContainText('Antikiano');
  await expect(brands(page).getByRole('button', { name: 'إضافة براند' })).toHaveCount(0);
  await expect(brands(page).locator('[data-brand-menu]')).toHaveCount(0);
  await expect(brands(page).locator('[data-brand-rate]')).toHaveCount(0);
  await signOut(page);
  await openVendors(page, VF);
  await openDrawer(page, V2);
  await expect(brands(page).getByRole('button', { name: 'إضافة براند' })).toBeVisible();
  await expect(brands(page).locator('[data-brand-rate]')).toHaveCount(0);
  await brandRow(page, B2).locator('[data-brand-menu]').click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['تعديل', 'نقل لمبتكر تاني']);
  await page.keyboard.press('Escape');
  await brands(page).getByRole('button', { name: 'إضافة براند' }).click();
  await expect(modal(page).locator('#br-rate')).toHaveCount(0); // no special rate without sensitive.commission
  await cancel(page);
});

test('add a brand: the code suggested from the name until typed, a special rate; brands → brand_owners (since = joining) → brand_rates in order, with .select(id) on the brand only; the events; the table, the log and the list\'s grey line; a taken name refused before any request', async ({ page }) => {
  await setup(page);
  await openVendors(page);
  await openDrawer(page, V1);
  await brands(page).getByRole('button', { name: 'إضافة براند' }).click();
  await expect(modal(page).locator('h2')).toHaveText('إضافة براند — Art Craft');
  await modal(page).locator('#br-name').fill('wood & rope');
  await expect(modal(page).locator('#br-code')).toHaveValue('W'); // suggested
  await modal(page).locator('#br-aliases').fill('W&R، Wood Rope');
  await modal(page).locator('#br-rate').fill('30');
  await modal(page).getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(note(page)).toContainText('اتضاف البراند wood & rope');
  const nb = NEW_BRAND(1);
  await expect(brandRow(page, nb)).toContainText('wood & rope');
  await expect(brandRow(page, nb)).toContainText('الكود W');
  await expect(brandRow(page, nb)).toContainText('W&R، Wood Rope');
  await expect(brandRow(page, nb)).not.toContainText('متجر على الموقع'); // a hand-added brand: no store
  await expect(brandRow(page, nb).locator('[data-brand-rate]')).toHaveText('خاصة 30%');
  await expect(brandRow(page, nb)).toContainText('01/03/2026'); // since = Art Craft's joined_at
  expect(writes()).toEqual([{ table: 'brands', op: 'insert', name: 'wood & rope', code: 'W', aliases: ['W&R', 'Wood Rope'], origin_vendor_id: V1, created_by: 'صفوت كمال' },
    { table: 'brand_owners', op: 'insert', brand_id: nb, vendor_id: V1, since: '2026-03-01', set_by: 'صفوت كمال' }, { table: 'brand_rates', op: 'insert', brand_id: nb, rate: 30, since: '2026-03-01', set_by: 'صفوت كمال' }]);
  expect(mock.brands.find((b) => b.id === nb)).toMatchObject({ store_vendor_id: null, origin_vendor_id: V1 });
  await expect.poll(() => acts('vendor.brand')).toEqual([{ entity: 'vendor', entity_id: V1, new_value: 'add: wood & rope' }]);
  await expect.poll(() => acts('vendor.brand.rate')).toEqual([{ entity: 'vendor', entity_id: V1, new_value: 'wood & rope: 30% من 2026-03-01' }]);
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال أضاف البراند wood & rope');
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال حدّد النسبة الخاصة للبراند (wood & rope: 30% من 2026-03-01)');
  await expect(row(page, V1).locator('[data-brands]')).toHaveText('wood & rope');
  // a taken name (the automatic brand of Antikiano, by its alias too): refused in the popup, nothing sent
  await brands(page).getByRole('button', { name: 'إضافة براند' }).click();
  await modal(page).locator('#br-name').fill(' ANTIKIANO ');
  await modal(page).getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(modal(page).locator('.note.error')).toContainText('راجع الحقول');
  await expect(modal(page)).toContainText('فيه براند بنفس الاسم (Antikiano)');
  await modal(page).locator('#br-name').fill('antikiano store');
  await modal(page).getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(modal(page)).toContainText('فيه براند بنفس الاسم (Antikiano)');
  await modal(page).locator('#br-name').fill('Zaan');
  await modal(page).locator('#br-code').fill('Z-1');
  await modal(page).getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(modal(page)).toContainText('الكود من 1 لـ 3');
  expect(writes()).toHaveLength(3);
  // the server's 23505 (a name taken meanwhile) reads the same
  mock.brands.push({ id: 'd0000000-0000-4000-8000-000000000008', name: 'zaan', code: 'Z', aliases: [], store_vendor_id: null, origin_vendor_id: V2, created_by: 'x', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' });
  await modal(page).locator('#br-code').fill('Z');
  await modal(page).getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(modal(page).locator('.note.error')).toContainText('فيه براند بنفس الاسم');
  expect(posts('brands')).toBe(2);
  expect(writes()).toHaveLength(3);
  await cancel(page);
});

test('edit a brand: the changed columns only (a PATCH, no returning row), logged; the drawer and the list follow; html in a brand\'s name is text in the table, the list, the popup and the log', async ({ page }) => {
  await setup(page);
  await openVendors(page);
  await openDrawer(page, V1);
  await openBrandMenu(page, B1, 'تعديل');
  await expect(modal(page).locator('h2')).toHaveText('تعديل البراند — Art Craft');
  await expect(modal(page).locator('#br-code')).toHaveValue('A');
  await expect(modal(page).locator('#br-rate')).toHaveCount(0); // the rate has its own popup
  await modal(page).locator('#br-name').fill('Art Craft Studio');
  await expect(modal(page).locator('#br-code')).toHaveValue('A'); // an existing brand keeps its code unless typed
  await modal(page).locator('#br-code').fill('ac');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(brandRow(page, B1)).toContainText('Art Craft Studio');
  await expect(brandRow(page, B1)).toContainText('الكود AC');
  await expect.poll(() => writes()).toEqual([{ table: 'brands', op: 'update', id: B1, name: 'Art Craft Studio', code: 'AC' }]);
  expect(mock.requests.filter((r) => r.startsWith('PATCH /rest/v1/brands'))).toHaveLength(1);
  await expect.poll(() => acts('vendor.brand')).toEqual([{ entity: 'vendor', entity_id: V1, new_value: 'update: Art Craft Studio (name, code)' }]);
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال عدّل البراند Art Craft Studio (name, code)');
  await expect(row(page, V1).locator('[data-brands]')).toHaveText('Art Craft Studio'); // the brand's name is not his any more
  // html in the name: text everywhere
  await openBrandMenu(page, B1, 'تعديل');
  await modal(page).locator('#br-name').fill(EVIL);
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(brandRow(page, B1).locator('b').first()).toHaveText(EVIL);
  await expect(row(page, V1).locator('[data-brands]')).toHaveText(EVIL);
  await expect(section(page, 'سجل النشاط')).toContainText('عدّل البراند ' + EVIL);
  await openBrandMenu(page, B1, 'تعديل');
  await expect(modal(page).locator('h2')).toHaveText('تعديل البراند — ' + EVIL);
  await expect(modal(page).locator('#br-name')).toHaveValue(EVIL);
  await cancel(page);
  await openBrandMenu(page, B1, 'نقل لمبتكر تاني');
  await expect(modal(page).locator('h2')).toHaveText('نقل البراند — ' + EVIL);
  await cancel(page);
  await inert(page);
  expect(mock.brands.find((b) => b.id === B1).name).toBe(EVIL);
});

test('the special rate (sensitive.commission): a dated row, logged; it beats the maker\'s rate on a line without a website rate (the orders tab), while a line with one keeps it; blank = none again; hidden from ops', async ({ page }) => {
  await setup(page);
  await openVendors(page);
  await openDrawer(page, V2);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('2,007.85'); // both open: 181668 at the line's 40 / 10 (1,513.40) + 180656 at Antikiano's 45% (494.45)
  await tab(page, 'معلومات المورد').click();
  await openBrandMenu(page, B2, 'النسبة الخاصة');
  await expect(modal(page).locator('h2')).toHaveText('النسبة الخاصة — Antikiano');
  await modal(page).locator('#br-rate').fill('70');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('النسبة الخاصة من 0% إلى 65%');
  await modal(page).locator('#br-rate').fill('30');
  await typeDate(page, 'br-since', daysAgo(15));
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('اتحفظت النسبة الخاصة للبراند Antikiano');
  await expect(brandRow(page, B2).locator('[data-brand-rate]')).toHaveText('خاصة 30%');
  await expect.poll(() => writes()).toEqual([{ table: 'brand_rates', op: 'insert', brand_id: B2, rate: 30, since: daysAgo(15), set_by: 'صفوت كمال' }]);
  await expect.poll(() => acts('vendor.brand.rate')).toEqual([{ entity: 'vendor', entity_id: V2, new_value: 'Antikiano: 30% من ' + daysAgo(15) }]);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('2,142.70'); // 1,513.40 (the line keeps the website's 40 / 10) + 899 at the brand's 30% (629.30)
  await expect(tile(page, 'حقه من المكتملة').locator('.t-h3')).toHaveText('0.00'); // nothing completed
  await tab(page, 'معلومات المورد').click();
  // the same date again is refused before any write; a blank rate from today = the maker's rate again (the open order is older)
  await openBrandMenu(page, B2, 'النسبة الخاصة');
  await expect(modal(page).locator('#br-rate')).toHaveValue('30');
  await typeDate(page, 'br-since', daysAgo(15));
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('فيه نسبة متسجلة بنفس تاريخ السريان');
  expect(writes()).toHaveLength(1);
  await openBrandMenu(page, B2, 'النسبة الخاصة');
  await modal(page).locator('#br-rate').fill('');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes().length).toBe(2);
  expect(writes()[1]).toEqual({ table: 'brand_rates', op: 'insert', brand_id: B2, rate: null, since: TODAY, set_by: 'صفوت كمال' });
  await expect(brandRow(page, B2).locator('[data-brand-rate]')).toHaveText('نسبة المبتكر');
  await expect.poll(() => acts('vendor.brand.rate').length).toBe(2);
  expect(acts('vendor.brand.rate')[1].new_value).toBe('Antikiano: — من ' + TODAY);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('2,142.70'); // 180656 is dated before today's row: still 30%
  // ops: no rate column, no brand_rates request, the shares without the special rate
  await signOut(page);
  const before = mock.requests.filter((r) => r === 'GET /rest/v1/brand_rates').length;
  await openVendors(page, OPS);
  await openDrawer(page, V2);
  await expect(brands(page).locator('[data-brand-rate]')).toHaveCount(0);
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/brand_rates')).toHaveLength(before);
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('2,412.40'); // the rates hidden: 1,513.40 + the line without a website rate in full (899)
});

test('transfer Antikiano\'s brand to Bian eg from 8 days ago, temporarily: one owner row, two events; Antikiano\'s drawer shows «كان عنده» and his store\'s earlier order only, Bian eg\'s «مؤقت لحد» and the later order; then the return', async ({ page }) => {
  await setup(page);
  await openVendors(page);
  await openDrawer(page, V2);
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('2');
  await tab(page, 'معلومات المورد').click();
  await openBrandMenu(page, B2, 'نقل لمبتكر تاني');
  await expect(modal(page).locator('h2')).toHaveText('نقل البراند — Antikiano');
  await modal(page).locator('#br-to').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveText(['Art Craft', 'Bian eg (غير نشط)']); // not the holder himself
  await page.locator('[role=listbox] [role=option]', { hasText: 'Bian eg' }).click();
  await expect(modal(page).locator('#br-since')).toHaveValue(dmy(TODAY));
  await typeDate(page, 'br-since', TRANSFER_SINCE);
  await modal(page).getByRole('checkbox', { name: 'نقل مؤقت؟' }).click();
  await typeDate(page, 'br-return', TRANSFER_SINCE); // not after the start: refused before any request
  await modal(page).getByRole('button', { name: 'نقل البراند' }).click();
  await expect(modal(page)).toContainText('تاريخ الرجوع لازم يكون بعد تاريخ البداية');
  expect([posts('brand_owners'), writes()]).toEqual([0, []]);
  await typeDate(page, 'br-return', TRANSFER_RETURN);
  await modal(page).locator('#br-reason').fill(' إجازة الصيف ');
  await modal(page).getByRole('button', { name: 'نقل البراند' }).click();
  await expect(note(page)).toContainText('اتنقل البراند Antikiano لـ Bian eg من ' + dmy(TRANSFER_SINCE) + ' (مؤقت لحد ' + dmy(TRANSFER_RETURN) + ')');
  await expect.poll(() => writes()).toEqual([{ table: 'brand_owners', op: 'insert', brand_id: B2, vendor_id: V3, since: TRANSFER_SINCE, return_on: TRANSFER_RETURN, reason: 'إجازة الصيف', set_by: 'صفوت كمال' }]);
  const txt = 'Antikiano → Bian eg من ' + TRANSFER_SINCE + ' لحد ' + TRANSFER_RETURN;
  await expect.poll(() => byMaker(acts('vendor.brand.transfer'))).toEqual([{ entity: 'vendor', entity_id: V2, new_value: txt }, { entity: 'vendor', entity_id: V3, new_value: txt }]);
  await expect(brands(page)).toContainText('مفيش براندات على المبتكر ده دلوقتي');
  await expect(brands(page).locator('.brand-ever')).toHaveText('كان عنده: Antikiano لحد ' + dmy(TRANSFER_SINCE) + ' → دلوقتي مع Bian eg');
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال نقل البراند (' + txt + ')');
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('1'); // 180656 (10 days ago) stays his; 181668 (6 days ago) is Bian eg's
  await expect(section(page, 'أوردرات المبتكر')).toContainText('180656');
  await expect(section(page, 'أوردرات المبتكر')).not.toContainText('181668');
  // Bian eg (inactive: by hash): the brand with «مؤقت لحد», the later order, «رجوع لصاحبه» in the menu, the list's grey line
  await openByHash(page, V3);
  await tab(page, 'معلومات المورد').click(); // the drawer opens on the last tab used
  await expect(brandRow(page, B2)).toContainText('Antikiano');
  await expect(brandRow(page, B2)).toContainText(dmy(TRANSFER_SINCE));
  await expect(brandRow(page, B2)).toContainText('مؤقت لحد ' + dmy(TRANSFER_RETURN));
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال نقل البراند (' + txt + ')');
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('1');
  await expect(section(page, 'أوردرات المبتكر')).toContainText('181668');
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('1,513.40'); // 2539 − (1015.60 + 10): the website's rate on the line
  await tab(page, 'معلومات المورد').click();
  await drawer(page).getByRole('button', { name: 'إغلاق' }).first().click();
  await statusFilter(page, 'الكل');
  await expect(row(page, V3).locator('[data-brands]')).toHaveText('Antikiano');
  await openDrawer(page, V3);
  // a transfer dated before the last one and to the same maker are refused before any request
  await openBrandMenu(page, B2, 'نقل لمبتكر تاني');
  await pickOption(page, 'br-to', 'Art Craft');
  await typeDate(page, 'br-since', daysAgo(20));
  await modal(page).getByRole('button', { name: 'نقل البراند' }).click();
  await expect(modal(page)).toContainText('التاريخ ده قبل آخر نقل للبراند (' + TRANSFER_SINCE + ')');
  await cancel(page);
  expect(await page.evaluate(([b2, v3]) => { try { window.IBVendors.store.transferBrand(b2, v3, { since: '2027-01-01' }, window.IBVendors.store.actor()); return 'moved'; } catch (e) { return e.message; } }, [B2, V3])).toBe('البراند أصلًا عند المبتكر ده');
  expect(writes()).toHaveLength(1);
  // the return (today): back to Antikiano, one row with the reason, two events; the delete guard while he held it
  expect(await page.evaluate((v3) => { try { window.IBVendors.store.remove(v3, window.IBVendors.store.actor()); return 'removed'; } catch (e) { return e.message; } }, V3)).toBe('removed');
  await expect(note(page)).toContainText('عليه براندات'); // 23503 of vendors_brands_guard_delete → has_brands, the row back
  await expect(row(page, V3)).toBeVisible();
  await openDrawer(page, V3);
  await openBrandMenu(page, B2, 'رجوع لصاحبه');
  await expect(modal(page).locator('h2')).toHaveText('رجوع البراند لصاحبه — Antikiano');
  await expect(modal(page)).toContainText('هيرجع لـ');
  await expect(modal(page)).toContainText('Antikiano');
  await typeDate(page, 'br-since', daysAgo(20));
  await modal(page).getByRole('button', { name: 'رجوع' }).click();
  await expect(modal(page)).toContainText('قبل آخر نقل');
  await typeDate(page, 'br-since', TODAY);
  await modal(page).getByRole('button', { name: 'رجوع' }).click();
  await expect(note(page)).toContainText('رجع البراند Antikiano لـ Antikiano');
  await expect.poll(() => writes().length).toBe(2);
  expect(writes()[1]).toEqual({ table: 'brand_owners', op: 'insert', brand_id: B2, vendor_id: V2, since: TODAY, return_on: null, reason: 'رجوع لصاحبه', set_by: 'صفوت كمال' });
  const back = 'Antikiano → Antikiano من ' + TODAY;
  await expect.poll(() => byMaker(acts('vendor.brand.return'))).toEqual([{ entity: 'vendor', entity_id: V2, new_value: back }, { entity: 'vendor', entity_id: V3, new_value: back }]);
  await expect(brands(page).locator('.brand-ever')).toHaveText('كان عنده: Antikiano لحد ' + dmy(TODAY) + ' → دلوقتي مع Antikiano');
  await expect(section(page, 'سجل النشاط')).toContainText('صفوت كمال رجّع البراند لصاحبه (' + back + ')');
  await openByHash(page, V2);
  await tab(page, 'معلومات المورد').click();
  await expect(brandRow(page, B2)).toContainText(dmy(TODAY));
  await expect(brandRow(page, B2)).not.toContainText('مؤقت');
  await brandRow(page, B2).locator('[data-brand-menu]').click();
  await expect(page.locator('[role=menu] [role=menuitem]')).toHaveText(['تعديل', 'النسبة الخاصة', 'نقل لمبتكر تاني']);
  await page.keyboard.press('Escape');
});

test('the seeded transfer ({ transfer: true }): at sign-in Bian eg holds Antikiano\'s brand — the later order is his, the earlier stays Antikiano\'s; the server\'s guard refusals read on the page', async ({ page }) => {
  await setup(page, { transfer: true });
  await openVendors(page);
  await openDrawer(page, V2);
  await expect(brands(page).locator('.brand-ever')).toHaveText('كان عنده: Antikiano لحد ' + dmy(TRANSFER_SINCE) + ' → دلوقتي مع Bian eg');
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('1');
  await expect(section(page, 'أوردرات المبتكر')).toContainText('180656');
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('494.45'); // 899 at Antikiano's own 45%: before the transfer
  await openByHash(page, V3);
  await tab(page, 'معلومات المورد').click();
  await expect(brandRow(page, B2)).toContainText('مؤقت لحد ' + dmy(TRANSFER_RETURN));
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('1');
  await expect(section(page, 'أوردرات المبتكر')).toContainText('181668');
  await tab(page, 'الحسابات').click();
  await expect(tile(page, 'هيستحق بعد التنفيذ').locator('.t-h3')).toHaveText('1,513.40');
  await expect(tile(page, 'رصيده عندنا').locator('.t-h3')).toHaveText('0.00'); // nothing completed yet
  // Art Craft untouched
  await openByHash(page, V1);
  await tab(page, 'الأوردرات').click();
  await expect(kindTile(page, 'all').locator('.t-h3')).toHaveText('2');
  // the server's 22023 (a row written meanwhile) comes back as the same message and the history goes back
  mock.brandOwners.push({ id: 50, brand_id: B2, vendor_id: V1, since: daysAgo(2), return_on: null, reason: null, set_by: 'x', created_at: '2026-10-22T00:00:00Z' });
  const out = await page.evaluate(([b2, v1, since]) => { window.IBVendors.store.transferBrand(b2, v1, { since }, window.IBVendors.store.actor()); return window.IBVendors.store.brand(b2).owner; }, [B2, V1, daysAgo(5)]);
  expect(out).toBe(V1); // locally at once
  await expect(note(page)).toContainText('التاريخ ده قبل آخر نقل للبراند');
  await expect.poll(() => page.evaluate((b2) => window.IBVendors.store.brand(b2).owner, B2)).toBe(V3); // the history back as it was (a refusal reloads nothing)
  expect(writes()).toEqual([]);
});
