import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, ART_PARTS, ART_ADDRESS, ART_SOCIAL, ART_LOGO, IMG } from './supabase-mock.mjs';

// Phase 3.3 (decisions 5 / 6): the store data synced with Dokan on the makers page — the drawer shows the synced fields (the site's
// logo, the owner's name, the address from its parts, the social links, the last sync, the fields waiting for the site, «موقوف على
// الموقع»), the contact popup writes the three synced columns with the derived address / instagram and then pushes them through
// woo-sync push_vendor (the field names only; ok / 502 / push_disabled read on the page), a rate change and a status change push
// too, the per-category commission (sensitive.commission) with its popup, the server's sync rows in «سجل النشاط», a member who may
// not push, and html / javascript: values from the site rendered as text and never as links. Mock only (E2E_SUPABASE_LIVE=1 skips).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; const V3 = 'a0000000-0000-4000-8000-000000000003'; // Art Craft (synced data), Antikiano (a pending phone), Bian eg (inactive, a store)
const T0 = '2026-10-22T00:00:00Z';
const EVIL = '"><img src=x onerror="window.__xss=1">';
const PNG = Buffer.from(IMG.curtain.split(',')[1], 'base64'); // a 1×1 PNG for the logo route
const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const TODAY = ymd(new Date());
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes / pushes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.route(ART_LOGO, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG })); // the site's logo, never the real host
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
const drawer = (page) => page.locator('.drawer[aria-label^="ملف المبتكر"]');
async function openDrawer(page, id) { await row(page, id).click(); await expect(drawer(page)).toBeVisible(); return drawer(page); }
async function openByHash(page, id) { await page.evaluate((h) => { location.hash = h; }, 'makers/' + id); await expect(drawer(page)).toBeVisible(); return drawer(page); }
const section = (page, title) => drawer(page).locator('section.vsection').filter({ has: page.locator('.head h3', { hasText: title }) });
const info = (scope, page, label) => scope.locator('.info-row').filter({ has: page.locator('.lab', { hasText: label }) }).locator('.val');
const modal = (page) => page.locator('.modal[role=dialog]');
const note = (page) => page.locator('#vendors .note');
const contact = (page) => section(page, 'التواصل'); const agreement = (page) => section(page, 'الاتفاق التجاري'); const activity = (page) => section(page, 'سجل النشاط');
const writes = () => mock.vendorWrites.map((w) => { const { updated_at, ...x } = w; return x; });
const pushes = () => mock.vendorPushes.map(({ by, ...p }) => p);
const acts = (action) => mock.activity.filter((a) => a.action === action).map((a) => ({ action: a.action, entity: a.entity, entity_id: a.entity_id, new_value: a.new_value }));
async function pickOption(page, selectId, label) { await modal(page).locator('#' + selectId).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).click(); }
const inert = async (page) => {
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
};
// the synced fields of Art Craft's contact popup
async function openContact(page) { await contact(page).getByRole('button', { name: 'تعديل بيانات الاتصال' }).click(); await expect(modal(page)).toBeVisible(); }

test('the drawer shows the synced store data: the site\'s logo, the owner\'s name, the address from its parts, the social links (https, new tab), the last sync; the flat fee with the rate; a pending field on Antikiano; «موقوف على الموقع» on Bian eg; the sync rows in the log', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  const d = drawer(page);
  const img = d.locator('.drawer-h .vlogo img');
  await expect(img).toHaveAttribute('src', ART_LOGO);
  await expect(img).toHaveAttribute('alt', 'لوجو Art Craft');
  await expect(d.locator('.drawer-h h2')).toHaveText('Art Craft');
  await expect(d.locator('[data-site-off]')).toHaveCount(0);
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('منى عادل');
  await expect(info(contact(page), page, 'العنوان (الاستلام)')).toHaveText(ART_ADDRESS);
  await expect(info(contact(page), page, 'الرمز البريدي / الدولة')).toHaveText('11511 · EG');
  const links = info(contact(page), page, 'سوشيال').locator('a.social-a');
  await expect(links).toHaveText(['فيسبوك', 'إنستجرام']); // the two filled keys only
  await expect(links.nth(0)).toHaveAttribute('href', ART_SOCIAL.fb);
  await expect(links.nth(1)).toHaveAttribute('href', ART_SOCIAL.instagram);
  for (const i of [0, 1]) { await expect(links.nth(i)).toHaveAttribute('target', '_blank'); await expect(links.nth(i)).toHaveAttribute('rel', /noopener/); }
  await expect(info(contact(page), page, 'آخر مزامنة مع الموقع').locator('[data-synced-at]')).toHaveAttribute('data-synced-at', T0);
  await expect(contact(page).locator('[data-push-pending]')).toHaveCount(0);
  await expect(info(contact(page), page, 'إنستجرام')).toHaveCount(0); // instagram is a social link now
  // the agreement: the rate, the category commission in force (the site's row), the note that the rate goes to the site
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toContainText('35%');
  await expect(agreement(page).locator('tr[data-cat-rate="15"]')).toContainText('ديكور');
  await expect(agreement(page).locator('tr[data-cat-rate="15"]')).toContainText('30%');
  await expect(agreement(page).locator('tr[data-cat-rate="15"]')).toContainText('01/03/2026');
  await expect(agreement(page)).toContainText('النسبة بتتبعت للموقع');
  // the server's rows read in the site's voice with the Arabic labels (the admin sees every row)
  await expect(activity(page)).toContainText('اتعدل من الموقع: التليفون، العنوان');
  await expect(activity(page)).toContainText('تعارض — الموقع كسب في: الاسم');
  await expect(activity(page)).not.toContainText('vendor.sync');
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/vendor_category_rates').length).toBeGreaterThanOrEqual(1);
  expect(mock.requests.filter((r) => r === 'GET /rest/v1/woo_categories').length).toBeGreaterThanOrEqual(1);
  // Antikiano: a letter logo (no picture on the site), the flat fee next to the rate, a phone waiting for the site
  await openByHash(page, V2);
  await expect(drawer(page).locator('.drawer-h .vlogo img')).toHaveCount(0);
  await expect(drawer(page).locator('.drawer-h .vlogo')).toHaveText('A');
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toContainText('45%');
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toContainText('رسوم ثابتة');
  await expect(info(contact(page), page, 'في انتظار الإرسال').locator('[data-push-pending]')).toHaveAttribute('data-push-pending', 'phone');
  await expect(info(contact(page), page, 'في انتظار الإرسال')).toHaveText('التليفون');
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('—');
  await expect(info(contact(page), page, 'سوشيال')).toHaveText('—');
  await expect(agreement(page).locator('[data-no-cat-rates]')).toBeVisible();
  // Bian eg: inactive here with a store on the site → the tag
  await openByHash(page, V3);
  await expect(drawer(page).locator('[data-site-off]')).toHaveText('موقوف على الموقع');
  await inert(page);
});

test('the contact popup (admin): the six address parts and the social links; one PATCH of the changed columns with the derived address + instagram, the event, then push_vendor with those fields only — ok: the last sync line moves to now', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  await openContact(page);
  const m = modal(page);
  await expect(m.locator('#g-contact')).toHaveValue('منى عادل');
  await expect(m.locator('#g-street1')).toHaveValue(ART_PARTS.street_1);
  await expect(m.locator('#g-city')).toHaveValue('القاهرة');
  await expect(m.locator('#g-zip')).toHaveValue('11511');
  await expect(m.locator('#g-country')).toHaveValue('EG');
  await expect(m.locator('#g-fb')).toHaveValue(ART_SOCIAL.fb);
  await expect(m.locator('#g-instagram')).toHaveValue(ART_SOCIAL.instagram);
  await expect(m.locator('#g-threads')).toHaveValue('');
  await expect(m.locator('#g-ig')).toHaveCount(0); // the old handle field is gone
  await expect(m).toContainText('بيتبعتوا لمتجره على الموقع مع الحفظ');
  await m.locator('#g-contact').fill('منى عادل حسن');
  await m.locator('#g-street2').fill('الدور 3');
  await m.locator('#g-threads').fill('https://www.threads.net/@artcraft.dev');
  await m.getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('منى عادل حسن');
  await expect(info(contact(page), page, 'العنوان (الاستلام)')).toHaveText('12 شارع المعز، الدور 3، القاهرة، الجمالية');
  await expect(info(contact(page), page, 'سوشيال').locator('a.social-a')).toHaveText(['فيسبوك', 'إنستجرام', 'ثريدز']);
  const parts = { ...ART_PARTS, street_2: 'الدور 3' }; const social = { ...ART_SOCIAL, threads: 'https://www.threads.net/@artcraft.dev' };
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, contact_name: 'منى عادل حسن', address_parts: parts, social, address: '12 شارع المعز، الدور 3، القاهرة، الجمالية', instagram: ART_SOCIAL.instagram }]);
  await expect.poll(() => pushes()).toEqual([{ vendor_id: V1, fields: ['contact_name', 'address_parts', 'social'], result: 'ok' }]);
  expect(mock.requests.indexOf('POST /functions/v1/woo-sync')).toBeGreaterThan(mock.requests.indexOf('PATCH /rest/v1/vendors')); // the row first, then the push
  await expect.poll(() => acts('vendor.update')).toEqual([{ action: 'vendor.update', entity: 'vendor', entity_id: V1, new_value: 'contactName, addressParts, social' }]);
  await expect(info(contact(page), page, 'آخر مزامنة مع الموقع').locator('[data-synced-at]')).not.toHaveAttribute('data-synced-at', T0); // the reload after the push
  await expect(contact(page).locator('[data-push-pending]')).toHaveCount(0);
  await expect(note(page)).toHaveCount(0); // the save's own note went with the redraw after the push; an ok push adds none
  expect(mock.vendors.find((v) => v.id === V1).woo_snapshot.contact_name).toBe('منى عادل حسن');
  // a link that is not https:// is refused on the page before any write
  await openContact(page);
  await modal(page).locator('#g-youtube').fill('http://youtube.com/@artcraft');
  await modal(page).locator('#g-country').fill('E1'); // the input takes two characters (maxlength): a non-letter pair
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('الرابط لازم يبدأ بـ https://');
  await expect(modal(page)).toContainText('كود الدولة حرفين إنجليزي');
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  expect(writes()).toHaveLength(1);
  expect(pushes()).toHaveLength(1);
});

test('the push fails (502): saved here, the message, the fields wait in «في انتظار الإرسال»; the push gate closed (push_disabled): saved, no error, the fields wait; a status toggle and a rate change push too', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  mock.wooDown = true;
  await openContact(page);
  await modal(page).locator('#g-contact').fill('منى عادل حسن');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('اتحفظ في السيستم، ومابعتش للموقع — هيتبعت مع المزامنة الجاية');
  await expect.poll(() => pushes()).toEqual([{ vendor_id: V1, fields: ['contact_name'], result: 'error' }]);
  await expect(info(contact(page), page, 'في انتظار الإرسال')).toHaveText('اسم صاحب المتجر');
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('منى عادل حسن'); // the row was taken
  expect(writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, contact_name: 'منى عادل حسن' }]);
  mock.wooDown = false; mock.pushEnabled = false;
  await openContact(page);
  await modal(page).locator('#g-city').fill('الجيزة');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => pushes().slice(1)).toEqual([{ vendor_id: V1, fields: ['address_parts'], result: 'skipped', reason: 'push_disabled' }]);
  await expect(info(contact(page), page, 'في انتظار الإرسال')).toHaveText('اسم صاحب المتجر، العنوان');
  await expect(note(page)).toHaveCount(0); // skipped: nothing beyond the save's own note (gone with the redraw)
  mock.pushEnabled = true;
  // «المزيد» → a status change pushes status; the terms popup → a new rate pushes rate; after the ok the pending fields it sent are gone
  await drawer(page).getByRole('button', { name: 'المزيد' }).click();
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'تحويل لـ «في إجازة»' }).click();
  await expect.poll(() => pushes().slice(2)).toEqual([{ vendor_id: V1, fields: ['status'], result: 'ok' }]);
  await agreement(page).getByRole('button', { name: 'تعديل بيانات الاتفاق التجاري' }).click();
  await expect(modal(page).locator('#g-rate')).toHaveValue('35');
  await expect(modal(page).locator('#g-flat')).toHaveValue('');
  await expect(modal(page)).toContainText('والنسبة بتتبعت للموقع');
  await modal(page).locator('#g-rate').fill('40');
  await modal(page).locator('#g-flat').fill('٥');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes().filter((w) => w.table === 'vendor_rates')).toEqual([{ table: 'vendor_rates', op: 'insert', vendor_id: V1, rate: 40, since: TODAY, set_by: 'صفوت كمال', flat: 5 }]);
  await expect.poll(() => pushes().slice(3)).toEqual([{ vendor_id: V1, fields: ['rate'], result: 'ok' }]);
  await expect.poll(() => acts('vendor.rate')).toEqual([{ action: 'vendor.rate', entity: 'vendor', entity_id: V1, new_value: '40% من ' + TODAY + ' + 5 ج.م' }]);
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toContainText('40%');
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toContainText('رسوم ثابتة');
  await expect(info(contact(page), page, 'في انتظار الإرسال')).toHaveText('اسم صاحب المتجر، العنوان'); // still waiting: a push names its own fields only
});

test('the per-category commission (sensitive.commission): the admin adds a dated row for a site category and edits one — one insert each, logged with the category name, pushed as category_rates; the same date refused before any request; ops sees nothing and a tampered write is refused', async ({ page }) => {
  await openVendors(page);
  await openDrawer(page, V1);
  await agreement(page).getByRole('button', { name: 'إضافة عمولة فئة' }).click();
  await modal(page).locator('#cr-cat').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveText(['هدايا']); // the category with a rate already (ديكور) is edited from its row
  await page.locator('[role=listbox] [role=option]', { hasText: 'هدايا' }).click();
  await modal(page).locator('#cr-rate').fill('٢٥');
  await modal(page).locator('#cr-flat').fill('0');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(agreement(page).locator('tr[data-cat-rate="22"]')).toContainText('هدايا');
  await expect(agreement(page).locator('tr[data-cat-rate="22"]')).toContainText('25%');
  await expect.poll(() => writes()).toEqual([{ table: 'vendor_category_rates', op: 'insert', vendor_id: V1, woo_category_id: 22, rate: 25, flat: 0, since: TODAY, set_by: 'صفوت كمال' }]);
  await expect.poll(() => pushes()).toEqual([{ vendor_id: V1, fields: ['category_rates'], result: 'ok' }]);
  await expect.poll(() => acts('vendor.category_rate')).toEqual([{ action: 'vendor.category_rate', entity: 'vendor', entity_id: V1, new_value: 'هدايا: 25% + 0 ج.م من ' + TODAY }]);
  await expect(activity(page)).toContainText('صفوت كمال حدّد عمولة الفئة (هدايا: 25% + 0 ج.م من ' + TODAY + ')');
  expect(mock.requests.filter((r) => r === 'POST /rest/v1/vendor_category_rates')).toHaveLength(1);
  // edit the site's row on ديكور: blank = removed from today (the row leaves the list), a null rate in the insert
  await agreement(page).getByRole('button', { name: 'تعديل عمولة الفئة ديكور' }).click();
  await expect(modal(page).locator('#cr-cat')).toBeDisabled();
  await expect(modal(page).locator('#cr-rate')).toHaveValue('30');
  await modal(page).locator('#cr-rate').fill('');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes().slice(1)).toEqual([{ table: 'vendor_category_rates', op: 'insert', vendor_id: V1, woo_category_id: 15, rate: null, flat: 0, since: TODAY, set_by: 'صفوت كمال' }]);
  await expect(agreement(page).locator('tr[data-cat-rate="15"]')).toHaveCount(0);
  await expect(agreement(page).locator('tr[data-cat-rate="22"]')).toHaveCount(1);
  // the same category and date again: refused on the page, nothing sent
  await agreement(page).getByRole('button', { name: 'تعديل عمولة الفئة هدايا' }).click();
  await modal(page).locator('#cr-rate').fill('20');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(note(page)).toContainText('فيه عمولة للفئة دي بنفس تاريخ السريان');
  expect(writes()).toHaveLength(2);
  expect(pushes()).toHaveLength(2);
  // ops: no block, no request for the rates; a write forged past the page → 42501; a push → 401
  await page.evaluate(() => window.IBAuth.signOut());
  await expect(page.locator('#login')).toBeVisible();
  mock.requests.length = 0;
  await openVendors(page, OPS);
  await openDrawer(page, V1);
  await expect(agreement(page)).not.toContainText('عمولة حسب الفئة');
  await expect(agreement(page).getByRole('button', { name: 'إضافة عمولة فئة' })).toHaveCount(0);
  expect(mock.requests.filter((r) => r.includes('vendor_category_rates'))).toEqual([]);
  const forged = await page.evaluate(async (id) => {
    const cl = window.IBSupabase.client;
    const w = await cl.from('vendor_category_rates').insert({ vendor_id: id, woo_category_id: 22, rate: 10, since: '2026-12-01' });
    const p = await cl.functions.invoke('woo-sync', { body: { action: 'push_vendor', vendor_id: id, fields: ['phone'] } });
    return [w.error && w.error.code, p.error && p.error.context && p.error.context.status];
  }, V1);
  expect(forged).toEqual(['42501', 401]);
  expect(writes()).toHaveLength(2);
});

test('ops (vendors.edit = P) saves the contact here and may not push: no request to the site, the note says so; accounts reads the synced rows with no «تعديل»', async ({ page }) => {
  await openVendors(page, OPS);
  await openDrawer(page, V1);
  await openContact(page);
  await modal(page).locator('#g-contact').fill('منى عادل حسن');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => writes()).toEqual([{ table: 'vendors', op: 'update', id: V1, contact_name: 'منى عادل حسن' }]);
  await expect(note(page)).toContainText('اتحفظ في السيستم بس');
  expect(pushes()).toEqual([]);
  expect(mock.requests.filter((r) => r === 'POST /functions/v1/woo-sync')).toEqual([]);
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('منى عادل حسن');
  await page.evaluate(() => window.IBAuth.signOut());
  await expect(page.locator('#login')).toBeVisible();
  await openVendors(page, ACCOUNTS);
  await openDrawer(page, V1);
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText('منى عادل حسن');
  await expect(info(contact(page), page, 'سوشيال').locator('a.social-a')).toHaveCount(2);
  await expect(contact(page).getByRole('button', { name: 'تعديل بيانات الاتصال' })).toHaveCount(0);
  await expect(info(agreement(page), page, 'نسبة إبتكر')).toHaveText('—');
  await expect(agreement(page)).not.toContainText('عمولة حسب الفئة');
});

test('html and javascript: values from the site render as text and never as links or images: a javascript: logo shows the letter, a javascript: link is nothing, html inside an https link is text, html in the owner\'s name / a part stays text in the drawer, the popup and the list', async ({ page }) => {
  const v = mock.vendors.find((x) => x.id === V1);
  v.logo_url = 'javascript:window.__xss=1'; v.contact_name = EVIL; v.address_parts = { ...ART_PARTS, city: EVIL };
  v.social = { ...ART_SOCIAL, fb: 'javascript:window.__xss=1', instagram: 'https://www.instagram.com/' + EVIL, twitter: 'http://x.com/artcraft' };
  await openVendors(page);
  await openDrawer(page, V1);
  await expect(drawer(page).locator('.drawer-h .vlogo img')).toHaveCount(0);
  await expect(drawer(page).locator('.drawer-h .vlogo')).toHaveText('A');
  await expect(info(contact(page), page, 'اسم صاحب المتجر')).toHaveText(EVIL);
  await expect(info(contact(page), page, 'العنوان (الاستلام)')).toHaveText('12 شارع المعز، ' + EVIL + '، الجمالية');
  const links = info(contact(page), page, 'سوشيال').locator('a.social-a');
  await expect(links).toHaveText(['إنستجرام']); // the javascript: and the http: values are nothing; the https one with html inside is a link whose text is the label
  await expect(links.first()).toHaveAttribute('href', 'https://www.instagram.com/' + EVIL);
  expect(await page.evaluate(() => [...document.querySelectorAll('a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') || '')).length)).toBe(0);
  await openContact(page);
  await expect(modal(page).locator('#g-contact')).toHaveValue(EVIL);
  await expect(modal(page).locator('#g-city')).toHaveValue(EVIL);
  await expect(modal(page).locator('#g-fb')).toHaveValue(''); // blanked: not https
  await expect(modal(page).locator('#g-instagram')).toHaveValue('https://www.instagram.com/' + EVIL);
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await inert(page);
});

test('«إضافة مبتكر» has no logo upload any more (the picture is the site\'s)', async ({ page }) => {
  await openVendors(page);
  await page.getByRole('button', { name: 'إضافة مبتكر' }).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole('button', { name: 'رفع لوجو' })).toHaveCount(0);
  await expect(modal(page)).toContainText('الصورة بتيجي من متجره على الموقع');
});
