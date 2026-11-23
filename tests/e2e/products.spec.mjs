import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The products page (phase 5, docs/superpowers/plans/2026-10-28-phase-5-products.md): the records from the mirror (English rows +
// Arabic names, pending / draft / trash), the filters, the bulk bar (written through woo-sync products_batch), the trash and back,
// the edit page read live (product_get) and saved (product_save), the permissions (products.edit / products.trash), the push gate.
// Mock only: the cases assert the mock's seed and the writes it recorded (mock.productWrites).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
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

async function openProducts(page, email = ADMIN) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'سجل المنتجات' }).click(); // decision 62: the page opens on «نظرة عامة»
  await expect(page.locator('#pg-products')).toBeVisible();
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
}
const rowOf = (page, name) => page.locator('#pg-products .pr-table tbody tr').filter({ has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });

test('records: the English rows with their Arabic name, brand, maker, category path, stock and status; the trash and the translation are not records', async ({ page }) => {
  await openProducts(page);
  await expect(page).toHaveURL(/#products-records$/);
  const rows = page.locator('#pg-products .pr-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Boho mirror'); // newest first by default (the owner, 1 Nov): the highest site id (9004) on top
  await expect(rows.last()).toContainText('Cushion');
  const cushion = rowOf(page, 'Cushion');
  await expect(cushion).not.toContainText('كيس مخدة'); // the English name alone in the row (the owner, 28 Oct); search still finds the Arabic
  await expect(cushion).toContainText('Art Craft');
  await expect(cushion).toContainText('ديكور › إضاءة');
  await expect(cushion).toContainText('منشور');
  await expect(rowOf(page, 'Macrame Curtain')).toContainText('حسب الطلب');
  await expect(rowOf(page, 'Macrame Curtain')).toContainText('Variable');
  await expect(rowOf(page, 'Boho mirror')).toContainText('في انتظار المراجعة');
  await expect(rowOf(page, 'Macrame Feathers')).not.toContainText('ناقص'); // no «ناقص: …» under the name (the owner, 28 Oct)
  await expect(page.locator('[data-pstatus="trash"]')).toHaveText('المهملات 1');
  await expect(page.locator('[data-pstatus="pending"]')).toHaveText('في انتظار المراجعة 1');
});

// B3 (the owner, 11 Nov): a multi-select per filter with the values alone (no «البراند:» before them), «اعرض N منتج» applies;
// the categories main then sub with «-» / «--»; no «نفد» tab, no «ناقصها بيانات» chip, no closed «فلتر» on the records card
test('filters and sort: status chips, brand / category multi-selects, search by SKU, sort by sales', async ({ page }) => {
  await openProducts(page);
  const rows = page.locator('#pg-products .pr-table tbody tr');
  await expect(page.locator('[data-pstatus]')).toHaveText([/^الكل/, /^منشور/, /^مسودة/, /^في انتظار المراجعة/, /^المهملات/]); // no «نفد»
  await expect(page.locator('#pg-products [data-missing]')).toHaveCount(0);
  await expect(page.locator('#pg-products .acts:has([data-sm-btn="products"]) [data-fm-btn="products"]')).toHaveCount(1); // the owner 12 Nov: «فلتر» next to the sort
  // the owner 12 Nov (a try on the products first): the search sits in the records card's header, right before «فلتر», and the header's
  // buttons are centred on the title block
  expect(await page.locator('#pg-products .pr-rec > .sec-h .acts').evaluate((a) => [...a.children].slice(0, 2).map((x) => x.matches('[data-tq-btn]') ? 'search' : x.querySelector('[data-fm-btn]') ? 'filter' : '?'))).toEqual(['search', 'filter']); // the owner 12 Nov: «بحث» then «فلتر»
  await expect(page.locator('#pg-products .pr-rec > .sec-h')).toHaveCSS('align-items', 'center');
  await page.locator('[data-pstatus="draft"]').click();
  await expect(rows).toHaveCount(1);
  await page.locator('[data-pstatus="all"]').click();
  const fbtn = page.locator('#pg-products [data-fm-btn="products"]'); const fm = page.locator('[data-fm-menu="products"]');
  await expect(fbtn.locator('.val')).toHaveText('فلتر');
  await fbtn.click();
  await expect(fm.locator('[data-fm-tab]')).toHaveText(['الحالة', 'البراند', 'المبتكر', 'القسم', 'المخزون', 'النوع', 'السعر', 'مرات الشراء']); // the owner 12 Nov: tabs in a strip · «الحالة»: comments decision 61
  await fm.locator('[data-fm-tab="brand"]').click();
  await expect(fm.locator('[data-fm-key="brand"] [role=menuitemcheckbox]').first()).not.toContainText(':'); // the values alone
  await fm.locator('[data-fm="brand:Antikiano"]').click();
  await expect(fm.locator('[data-fm-apply]')).toHaveText('اعرض 2 منتج');
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  await expect(rows).toHaveCount(2);
  await expect(fbtn.locator('.val')).toHaveText('فلتر (1)');
  await expect(page.locator('#pg-products .af-chip .af-t')).toHaveText(['البراند: Antikiano']);
  await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
  await expect(rows).toHaveCount(4);
  // the categories (the owner 16 Nov — «فلتر الشجرة»): a tree — the main ones, each branch with + to open it, the levels indented without
  // dashes; the search shows what matches with the branch above it; a main one takes what is under it, two picks are either
  await fbtn.click();
  await fm.locator('[data-fm-tab="category"]').click();
  const cm = fm.locator('[data-fm-key="category"]');
  const shown = () => cm.locator('[data-fm-row]:visible [role=menuitemcheckbox]');
  await expect(shown()).toHaveText(['ديكور', 'هدايا']);
  await cm.locator('[data-fm-row]', { hasText: 'ديكور' }).first().locator('[data-fm-tog]').click();
  await expect(shown()).toHaveText(['ديكور', 'إضاءة', 'هدايا']);
  await expect(cm.locator('[data-fm-row][data-depth="1"]').first()).toHaveCSS('padding-inline-start', '18px');
  await cm.locator('[data-fm-q]').fill('أباج');
  await expect(shown()).toHaveText(['ديكور', 'إضاءة', 'أباجورات']);
  await cm.locator('[data-fm-q]').fill('');
  await expect(shown()).toHaveText(['ديكور', 'إضاءة', 'هدايا']);
  await cm.locator('[role=menuitemcheckbox]', { hasText: 'إضاءة' }).click();
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  const lit = await rows.count();
  await fbtn.click();
  await expect(fm.locator('[data-fm-tab="category"]')).toHaveAttribute('aria-selected', 'true'); // the filter opens on the tab last used
  await cm.locator('[role=menuitemcheckbox]', { hasText: 'هدايا' }).click();
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  expect(await rows.count()).toBeGreaterThanOrEqual(lit);
  await expect(fbtn.locator('.val')).toHaveText('فلتر (2)');
  await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
  await page.locator('#pg-products [data-tq-btn]').click(); // the owner 12 Nov: «بحث» opens the search row under the header
  await page.fill('#pg-products input[type=search]', 'ibtk20035');
  await expect(rows).toHaveCount(1);
  await page.fill('#pg-products input[type=search]', '');
  await page.locator('[data-sort-sales]').click();
  await expect(rows.first()).toContainText('Cushion');
});

test('selection: Shift + click ticks the range from the last ticked row to the clicked one (the owner, 1 Nov); Shift + click on a ticked row unticks the range; a plain click is one row', async ({ page }) => {
  await openProducts(page);
  const box = (name) => rowOf(page, name).locator('[role=checkbox]');
  await box('Boho mirror').click(); // the newest, on top
  await box('Cushion').click({ modifiers: ['Shift'] }); // the oldest, at the bottom → all four
  await expect(page.locator('.bulk-bar')).toContainText('محدد 4');
  await box('Macrame Curtain').click({ modifiers: ['Shift'] }); // Cushion … Macrame Curtain unticked (the clicked one was ticked → the range unticks)
  await expect(page.locator('.bulk-bar')).toContainText('محدد 2');
  await expect(box('Boho mirror')).toHaveAttribute('aria-checked', 'true'); await expect(box('Macrame Feathers')).toHaveAttribute('aria-checked', 'true');
  await expect(box('Cushion')).toHaveAttribute('aria-checked', 'false'); await expect(box('Macrame Curtain')).toHaveAttribute('aria-checked', 'false');
  await box('Cushion').click(); // plain: one row
  await expect(page.locator('.bulk-bar')).toContainText('محدد 3');
});

test('bulk (the owner, 1 Nov): «نقل لمبتكر تاني» moves the products\' maker on the site (products_vendor — Dokan\'s post_author) and the rows follow; «تغيير القسم» picks from the site\'s tree with a search, several categories at once, added to the current ones', async ({ page }) => {
  await openProducts(page);
  const box = (name) => rowOf(page, name).locator('[role=checkbox]');
  await box('Boho mirror').click(); await box('Macrame Feathers').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'نقل لمبتكر تاني' }).click();
  await expect(page.locator('.modal')).toContainText('نقل 2 منتجات لمبتكر تاني');
  await page.locator('#vendor').click(); await page.getByRole('option', { name: 'Antikiano' }).click(); // Bian eg has no store → not offered? (inactive but has a store: offered); the makers with a store only
  await page.locator('.modal').getByRole('button', { name: 'انقل المنتجات' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتنقلوا لـ Antikiano');
  const antikiano = mock.vendors.find((v) => v.name === 'Antikiano');
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'products_vendor', ids: [9004, 9003], vendor_id: antikiano.id });
  await expect(rowOf(page, 'Boho mirror')).toContainText('Antikiano');
  await expect(rowOf(page, 'Macrame Feathers')).toContainText('Antikiano');
  // the category tree: the search narrows to «إضاءة» and its branch; ticking «أباجورات» ticks «إضاءة» and «ديكور» above it
  await box('Boho mirror').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تغيير القسم' }).click();
  await page.locator('[data-cc-pick]').click();
  await expect(page.locator('.modal').last().getByRole('button', { name: '+ قسم جديد' })).toHaveCount(0); // B4: picked from what is there
  await page.locator('.modal input[type=search]').last().fill('أباجور');
  await expect(page.locator('[data-cat-pick]')).toHaveCount(3); // ديكور › إضاءة › أباجورات shown, هدايا hidden
  await page.locator('[data-cat-pick="152"]').click();
  await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await expect(page.locator('[data-cc-chosen]')).toContainText('ديكور › إضاءة › أباجورات');
  await page.locator('.modal').getByRole('button', { name: 'غيّر القسم' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتغير القسم');
  const w = mock.productWrites.at(-1);
  expect([w.action, w.id, [...w.fields.categories].sort((a, b) => a - b)]).toEqual(['product_save', 9004, [15, 151, 152]]); // the mirror's إضاءة kept, the branch (ديكور above, أباجورات below) added
});

test('bulk: publish the pending product (one product → product_save) and move two to another brand (products_batch), the rows follow', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'نشر' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انشر' }).click();
  await expect(rowOf(page, 'Boho mirror')).toContainText('منشور');
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', id: 9004, fields: { status: 'publish' } }); // one product: product_save
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'نقل لبراند تاني' }).click();
  await expect(page.locator('.modal')).toContainText('المتجر على Dokan');
  // the brand in both places (the owner 15 Nov — comments plan decision 81): the popup says where the brand is written
  await expect(page.locator('.modal')).toContainText('في المكانين: براند المنتج (WooCommerce Brands) وخاصية Brand');
  await page.locator('.modal #brand').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انقل المنتجات' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(mock.productWrites.at(-1).update).toEqual([{ id: 9001, brands: [4] }, { id: 9004, brands: [4] }]);
  await expect(rowOf(page, 'Cushion')).toContainText('Antikiano');
  await expect(page.locator('.toast.show')).toContainText('اتنقلوا لـ Antikiano');
  await expect(page.locator('.toast.show')).not.toContainText('خاصية Brand');
});

test('the brand in both places (comments plan decision 81): the product page says the brand is written to WooCommerce Brands and the Brand attribute; a save whose attribute did not follow says so, the brand still saved', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-brand')).toBeVisible();
  await expect(page.locator('#pg-products')).toContainText('بيتحفظ على الموقع في المكانين: براند المنتج (WooCommerce Brands) وخاصية Brand');
  mock.brandAttr = 'failed';
  await page.locator('#e-brand').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await page.getByRole('button', { name: 'احفظ على الموقع' }).first().click();
  await expect(page.locator('.toast.show')).toContainText('البراند اتحفظ، بس خاصية Brand على المنتج ماتحدّثتش');
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', id: 9001, fields: { brands: [4] } });
  expect(mock.products.find((p) => p.id === 9001).brand_ids).toEqual([4]);
  // a site without the attribute
  mock.brandAttr = 'no_attribute';
  await expect(page.locator('#e-brand')).toContainText('Antikiano');
  await page.locator('#e-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).first().click();
  await page.getByRole('button', { name: 'احفظ على الموقع' }).first().click();
  await expect(page.locator('.toast.show')).toContainText('الموقع مافيهوش خاصية Brand');
  mock.brandAttr = null;
});

test('bulk stock and price: a quantity for the simple products only; the fake discount moves the regular price, the sale stays', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await rowOf(page, 'Macrame Curtain').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل المخزون' }).click();
  await expect(page.locator('.modal')).toContainText('1 منتج Variable برّه التعديل ده');
  await page.fill('.modal #qty', '25');
  await page.locator('.modal').getByRole('button', { name: 'احفظ المخزون' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  // one simple product left (the Variable one is out) → product_save
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', id: 9001, fields: { manage_stock: true, stock_quantity: 25, backorders: 'no', low_stock_amount: 3 } });
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  await page.locator('.modal').getByRole('radio', { name: 'الخصم الوهمي' }).click();
  await page.fill('.modal #amount', '5');
  await page.locator('.modal').getByRole('button', { name: 'طبّق السعر' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  const w = mock.productWrites.at(-1); const u = w.fields;
  expect([w.id, u.sale_price]).toEqual([9001, '1200']);
  expect(Number(u.regular_price)).toBeGreaterThan(1500);
});

test('decision 16 in bulk: «سعر المبتكر» +10% → the sale price from the new maker price up to the next 10, the regular = sale + 15–30%', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  await page.locator('.modal').getByRole('radio', { name: 'سعر المبتكر' }).click();
  await page.fill('.modal #amount', '10');
  await expect(page.locator('.modal')).toContainText('قبل ← بعد');
  await expect(page.locator('.modal')).not.toContainText('[object'); // owner 16 Nov: «قبل ← بعد[object HTMLSpanElement]»
  await page.locator('.modal').getByRole('button', { name: 'طبّق السعر' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  const w = mock.productWrites.at(-1); const sale = Number(w.fields.sale_price); const reg = Number(w.fields.regular_price);
  expect(w.id).toBe(9001);
  expect(sale % 10).toBe(0); expect(sale).toBeGreaterThan(1200);
  expect(reg % 10).toBe(0); expect(reg).toBeGreaterThanOrEqual(Math.ceil(sale * 1.15 / 10) * 10); expect(reg).toBeLessThanOrEqual(Math.ceil(sale * 1.3 / 10) * 10);
});

test('trash and back: products_trash moves the product (and its translation) to the trash, «رجّعه» brings it back as a draft', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Cushion').getByRole('button', { name: 'إجراءات Cushion' }).click();
  await page.getByRole('menuitem', { name: 'مسح' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انقل للمهملات' }).click();
  await expect(rowOf(page, 'Cushion')).toHaveCount(0);
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'products_trash', ids: [9001] });
  await page.locator('[data-pstatus="trash"]').click();
  await expect(page).toHaveURL(/#products-trash$/);
  await page.locator('[data-restore="9001"]').click();
  await expect(page.locator('[data-restore="9001"]')).toHaveCount(0);
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'products_restore', ids: [9001] });
  await page.locator('[data-pstatus="all"]').click();
  await expect(rowOf(page, 'Cushion')).toContainText('مسودة');
});

test('edit: read live, change the price and the Arabic name, «احفظ على الموقع» sends the changed fields only; leaving with changes asks first', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page).toHaveURL(/#products-edit-9001$/);
  await expect(page.locator('#e-en')).toHaveValue('Cushion');
  await expect(page.locator('#e-ar')).toHaveValue('كيس مخدة');
  await page.fill('#e-ar', 'كيس مخدة جديد');
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await page.fill('#e-sale', '1100');
  await expect(page.locator('.unsaved')).toContainText('عندك 2 تعديلات');
  await page.fill('#e-sale', '1700');
  await page.locator('[data-psave]').click();
  await expect(page.locator('#pg-products')).toContainText('سعر البيع أكبر من السعر قبل الخصم'); // on the field, nothing sent
  await page.fill('#e-sale', '1100');
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  expect(mock.productWrites.at(-1)).toEqual({ action: 'product_save', by: ADMIN, id: 9001, fields: { sale_price: '1100' }, ar: { name: 'كيس مخدة جديد' } });
  await page.fill('#e-reg', '1600');
  await page.locator('.sidebar .nav-item[data-page="orders"]').click();
  await expect(page.locator('.modal')).toContainText('تعديلات مش محفوظة');
  await page.getByRole('button', { name: 'ارجع للتعديل' }).click();
  await expect(page.locator('#e-reg')).toHaveValue('1600');
});

test('edit (the owner, 2 Nov): «المبتكر (متجر Dokan)» on the page — a select of the makers with a store; a change asks, then moves the product on the site (products_vendor) and the page shows the new maker; unsaved edits block it', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-maker')).toContainText('Art Craft');
  await expect(page.locator('#e-brand')).toBeVisible();
  // with an unsaved edit the move waits
  await page.fill('#e-ar', 'كيس مخدة جديد');
  await page.locator('#e-maker').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await expect(page.locator('.toast.show')).toContainText('احفظ تعديلاتك الأول');
  await expect(page.locator('#e-maker')).toContainText('Art Craft');
  expect((mock.productWrites || []).filter((w) => w.action === 'products_vendor')).toEqual([]);
  await page.getByRole('button', { name: 'تجاهل' }).click();
  // the move: a confirmation, the request, the page re-read
  await page.locator('#e-maker').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await expect(page.locator('.modal')).toContainText('نقل المنتج لـ «Antikiano»؟');
  await expect(page.locator('#e-maker')).toContainText('Art Craft'); // still the current one until it is done
  await page.locator('.modal').getByRole('button', { name: 'انقل المنتج' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتنقل لـ Antikiano');
  const antikiano = mock.vendors.find((v) => v.name === 'Antikiano');
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'products_vendor', ids: [9001], vendor_id: antikiano.id });
  await expect(page.locator('#e-maker')).toContainText('Antikiano');
  await expect(page.locator('.edit-head .meta')).toContainText('Antikiano');
});

test('edit: the Arabic translation on another status than the product → a note and one button that writes the product\'s status to both', async ({ page }) => {
  await openProducts(page);
  mock.products.find((x) => x.id === 9101).status = 'draft'; // the translation stayed a draft (added after the product was published)
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#pg-products')).toContainText('النسخة العربي «مسودة» والإنجليزي «منشور»');
  await page.locator('[data-par-status]').click();
  await expect(page.locator('.toast.show')).toContainText('النسخة العربي بقت «منشور»');
  expect(mock.productWrites.at(-1)).toEqual({ action: 'product_save', by: ADMIN, id: 9001, fields: { status: 'publish' } });
  expect(mock.products.find((x) => x.id === 9101).status).toBe('publish');
  await expect(page.locator('[data-par-status]')).toHaveCount(0); // read again: the two agree
  await expect(page.locator('#e-ar')).toHaveValue('كيس مخدة');
});

test('edit a variable product: the variations table, the sale price of one variation sent alone', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9002"]').click();
  await page.getByRole('tab', { name: 'المتغيرات' }).click();
  await expect(page.locator('#pg-products table')).toContainText('Red');
  await page.fill('#vv-s0', '850');
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', id: 9002, fields: {}, variations: [{ id: 9901, sale_price: '850' }] });
});

test('permissions: accounts (products.edit N) sees no bulk bar, disabled fields and no save', async ({ page }) => {
  await openProducts(page, ACCOUNTS);
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await expect(page.locator('.bulk-bar')).toHaveCount(0);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-en')).toBeDisabled();
  await expect(page.locator('[data-psave]')).toHaveCount(0);
});

test('the push gate: WOO_PUSH_ENABLED off → «الكتابة على الموقع مقفولة» and the row stays', async ({ page }) => {
  mock.pushEnabled = false;
  await openProducts(page, OPS);
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'نشر' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انشر' }).click();
  await expect(page.locator('.toast.show')).toContainText('الكتابة على الموقع مقفولة');
  await expect(rowOf(page, 'Boho mirror')).toContainText('في انتظار المراجعة');
  await expect(page.locator('.bulk-bar').getByRole('button', { name: 'مسح' })).toHaveCount(0); // ops: products.trash N
});

test('vendor price = sale price − Dokan\'s commission: the product\'s own commission when set (20% + 10 on 1,200 → 950)', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9003"]').click();
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await expect(page.locator('[data-commission]')).toContainText('عمولة المنتج 20% + 10');
  await expect(page.locator('[data-commission]')).toContainText('250');
  await expect(page.locator('[data-vprice]')).toContainText('950');
});

test('decision 16: the maker price (for the calculation only) → sale = (maker + fee) ÷ (1 − rate) up to the next 10, regular = sale + 15–30% up to the next 10; saved as the two prices', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9003"]').click(); // its own commission 20% + 10
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await expect(page.locator('[data-vcalc]')).toContainText('عمولة المنتج 20% + 10');
  // comments decision 54: the field opens on what the price leaves the maker now, and typing it writes the two prices by itself
  await expect(page.locator('#e-vin')).toHaveValue('950');
  await expect(page.locator('[data-vapply]')).toHaveCount(0);
  await page.fill('#e-vin', 'abc');
  await expect(page.locator('#pg-products')).toContainText('اكتب سعر المبتكر رقم أكبر من صفر');
  await expect(page.locator('#e-sale')).toHaveValue('1200'); // nothing computed from a wrong price
  await page.fill('#e-vin', '1000');
  await expect(page.locator('#e-sale')).toHaveValue('1270'); // 1010 ÷ 0.8 = 1262.5 → 1270
  const regular = Number(await page.locator('#e-reg').inputValue());
  expect(regular % 10).toBe(0);
  expect(regular).toBeGreaterThanOrEqual(1470); // 1270 × 1.15 = 1460.5 → 1470
  expect(regular).toBeLessThanOrEqual(1660); // 1270 × 1.30 = 1651 → 1660
  await expect(page.locator('[data-vprice]')).toContainText('1,006'); // read only: 1270 − (254 + 10)
  await page.fill('#e-vin', '500'); await page.fill('#e-vin', '1000'); // the same markup while the page is open
  await expect(page.locator('#e-reg')).toHaveValue(String(regular));
  await expect(page.locator('#e-vin')).toHaveValue('1000'); // what was typed stays in the field; the box says what the rounded price leaves
  const n0 = (mock.productWrites || []).length;
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect.poll(() => (mock.productWrites || []).length).toBeGreaterThan(n0); // the write lands after the page settles (CI, 5 Nov)
  // the random markup can land on the seeded regular price (1500, one draw in 20): an unchanged price is not sent
  expect(mock.productWrites.at(-1)).toEqual({ action: 'product_save', by: ADMIN, id: 9003, fields: regular === 1500 ? { sale_price: '1270' } : { sale_price: '1270', regular_price: String(regular) } });
});

test('decision 16 on a variable product: a maker price per variation → its two prices; the empty rows stay', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9002"]').click();
  await page.getByRole('tab', { name: 'المتغيرات' }).click();
  await expect(page.locator('[data-vapply]')).toHaveCount(0); // comments decision 54: no button — the prices follow the typing
  await page.fill('#vv-v0', '600');
  const sale = Number(await page.locator('#vv-s0').inputValue()); const reg = Number(await page.locator('#vv-r0').inputValue());
  expect(sale % 10).toBe(0); expect(reg % 10).toBe(0); expect(reg).toBeGreaterThan(sale);
  const n0 = (mock.productWrites || []).length;
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect.poll(() => (mock.productWrites || []).length).toBeGreaterThan(n0); // the write lands after the page settles (CI, 5 Nov)
  const w = mock.productWrites.at(-1);
  expect(w.variations).toEqual([{ id: 9901, sale_price: String(sale), regular_price: String(reg) }]);
});

test('comments 59–61 — «تحويل لفي انتظار المراجعة» on the selection; the bulk stock popup drops the alert with «حسب الطلب»; «الحالة» is a group of the products\' filter (several at once) beside the status tabs', async ({ page }) => {
  await openProducts(page);
  // 59: two products picked, one already waiting — only the other is written, as «pending»
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar [data-pbulk-pending]').click();
  await expect(page.locator('.modal')).toContainText('تحويل المنتج لـ «في انتظار المراجعة»؟');
  await expect(page.locator('.modal')).toContainText('هيختفي من الموقع');
  await page.locator('.modal').getByRole('button', { name: 'حوّل لفي انتظار المراجعة' }).click();
  await expect(page.locator('.toast.show').filter({ hasText: 'اتحوّلوا لـ «في انتظار المراجعة»' })).toBeVisible();
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', id: 9001, fields: { status: 'pending' } });
  await expect(rowOf(page, 'Cushion')).toContainText('في انتظار المراجعة');
  await expect(page.locator('[data-pstatus="pending"]')).toHaveText('في انتظار المراجعة 2');
  // both waiting now: nothing to do, said
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  const n0 = mock.productWrites.length;
  await page.locator('.bulk-bar [data-pbulk-pending]').click();
  await expect(page.locator('.toast.show').filter({ hasText: '«في انتظار المراجعة» أصلًا' })).toBeVisible();
  expect(mock.productWrites.length).toBe(n0);
  // 60: «حسب الطلب» in the bulk stock popup — no quantity and no alert field, and no alert sent
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل المخزون' }).click();
  const m = page.locator('.modal');
  await expect(m.locator('#alert')).toBeVisible();
  await m.getByRole('radio', { name: /حسب الطلب/ }).click();
  await expect(m.locator('#alert')).toHaveCount(0); await expect(m.locator('#qty')).toHaveCount(0);
  await expect(m).not.toContainText('التنبيه');
  await m.getByRole('radio', { name: 'حدد الكمية' }).click();
  await expect(m.locator('#alert')).toBeVisible(); // back with a quantity
  await m.getByRole('radio', { name: /حسب الطلب/ }).click();
  await m.getByRole('button', { name: 'احفظ المخزون' }).click();
  await expect(m).toHaveCount(0);
  const w = mock.productWrites.at(-1);
  expect(w.action).toBe('products_batch');
  expect(w.update.map((u) => [u.manage_stock, u.stock_status, 'low_stock_amount' in u])).toEqual([[false, 'onbackorder', false], [false, 'onbackorder', false]]);
  // 61: «الحالة» in «فلتر» — two statuses at once; the picks are chips; a status tab clears them
  await page.locator('#pg-products [data-fm-btn="products"]').click();
  const menu = page.locator('[data-fm-menu="products"]');
  await expect(menu.locator('[data-fm-tab]').first()).toHaveAttribute('data-fm-tab', 'status');
  await menu.locator('[data-fm-tab="status"]').click();
  await expect(menu.locator('[data-fm^="status:"]')).toHaveText(['منشور', 'مسودة', 'في انتظار المراجعة']);
  await menu.locator('[data-fm="status:في انتظار المراجعة"]').click();
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 2 منتج');
  await menu.locator('[data-fm="status:منشور"]').click();
  await expect(menu.locator('[data-fm-apply]')).toHaveText('اعرض 3 منتج'); // + the one still published (the fourth is a draft)
  await menu.locator('[data-fm="status:منشور"]').click();
  await menu.locator('[data-fm-apply]').dispatchEvent('click');
  await expect(page.locator('#pg-products .pr-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#pg-products [data-af-chip="status:في انتظار المراجعة"]')).toContainText('الحالة: في انتظار المراجعة');
  await page.locator('[data-pstatus="published"]').click(); // the tab takes over
  await expect(page.locator('#pg-products [data-af-chip^="status:في"]')).toHaveCount(0);
  await expect(page.locator('#pg-products .pr-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#pg-products .pr-table tbody tr').first()).toContainText('منشور');
});

test('comment 58 — the records table: «البراند» and «المبتكر» are two columns (they were one cell)', async ({ page }) => {
  await openProducts(page);
  const heads = (await page.locator('#pg-products .pr-table thead th').allTextContents()).map((x) => x.trim());
  expect(heads.slice(1, 6)).toEqual(['المنتج', 'SKU', 'البراند', 'المبتكر', 'القسم']);
  const r = rowOf(page, 'Cushion');
  await expect(r.locator('[data-pbrand]')).toHaveText('Art Craft');
  await expect(r.locator('[data-pmaker]')).toHaveText('Art Craft');
  expect(await r.locator('[data-pbrand]').evaluate((x) => x.closest('td') !== x.closest('tr').querySelector('[data-pmaker]').closest('td'))).toBe(true);
  await expect(page.locator('#pg-products .brand-cell')).toHaveCount(0);
});

// drag a category's six-dot grip onto another category's row (comments decision 56): the pointer goes down on the grip, moves in
// steps past the middle of the target and is released there
async function dragCat(page, from, to, after) {
  const g = page.locator(`#pg-products [data-cat-grip="${from}"]`); await g.scrollIntoViewIfNeeded();
  const a = await g.boundingBox(); const t = await page.locator(`#pg-products [data-cat-item="${to}"]`).boundingBox();
  const y = after ? t.y + t.height - 3 : t.y + 3;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, (a.y + y) / 2, { steps: 4 }); await page.mouse.move(a.x + a.width / 2, y, { steps: 6 });
  await page.mouse.up();
}

test('comment 56 — the categories are ordered by their six-dot grip, main and sub: the new order goes to the site (category_order) and the tree follows it; the arrow keys too; a search hides the grips; a refusal puts the order back', async ({ page }) => {
  mock.wooCategories.push({ id: 153, name: 'شموع', slug: 'candles', parent_id: 15, updated_at: '2026-10-20T08:00:00Z' }, { id: 154, name: 'مرايات', slug: 'mirrors', parent_id: 15, updated_at: '2026-10-20T08:00:00Z' });
  await openProducts(page);
  await page.locator('#pg-products [role=tab]', { hasText: 'الأقسام' }).click();
  const pg = page.locator('#pg-products');
  const mains = () => pg.locator('.cat-mains > .cat-main').evaluateAll((l) => l.map((x) => Number(x.dataset.cat)));
  const subs = (parent) => pg.locator(`[data-cat-kids="${parent}"] > .cat-item`).evaluateAll((l) => l.map((x) => Number(x.dataset.catItem)));
  await expect(pg.locator('.cat-sum')).toContainText('اسحب القسم من النقط');
  expect(await mains()).toEqual([15, 22]); // never ordered on the site: by name
  // the main categories: «هدايا» dragged above «ديكور»
  await dragCat(page, 22, 15, false);
  await expect(page.locator('.toast.show').filter({ hasText: 'اتحفظ ترتيب الأقسام على الموقع' })).toBeVisible();
  expect(mock.categoryWrites.at(-1)).toEqual({ action: 'category_order', parent: 0, ids: [22, 15], by: ADMIN });
  expect(await mains()).toEqual([22, 15]);
  // the sub-categories of «ديكور»: three siblings, the last one dragged to the top
  await pg.locator('[data-cat-tog="15"]').click();
  const before = await subs(15); expect(before.length).toBe(3);
  await dragCat(page, before[2], before[0], false);
  await expect.poll(() => mock.categoryWrites.at(-1).parent).toBe(15);
  expect(mock.categoryWrites.at(-1).ids).toEqual([before[2], before[0], before[1]]);
  await expect.poll(() => subs(15)).toEqual([before[2], before[0], before[1]]);
  expect(mock.wooCategories.filter((c) => c.parent_id === 15).sort((a, b) => a.menu_order - b.menu_order).map((c) => c.id)).toEqual([before[2], before[0], before[1]]);
  // a category with no sibling has no grip (the one sub-category of «إضاءة»)
  await pg.locator('[data-cat-tog="151"]').click();
  await expect(pg.locator('[data-cat-grip="152"]')).toHaveCount(0);
  // the keyboard: the focused grip's item goes down with the arrow — several presses, one write
  const n0 = mock.categoryWrites.length;
  await pg.locator(`[data-cat-grip="${before[2]}"]`).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await expect.poll(() => mock.categoryWrites.length).toBe(n0 + 1);
  expect(mock.categoryWrites.at(-1).ids).toEqual([before[0], before[1], before[2]]);
  // the site refuses: said, and the tree goes back to the order the mirror has
  mock.catOrderFail = 'woocommerce_rest_cannot_edit';
  await expect.poll(() => subs(15)).toEqual([before[0], before[1], before[2]]);
  await dragCat(page, before[0], before[2], true);
  await expect(page.locator('.toast.show').filter({ hasText: 'الترتيب ماتحفظش على الموقع' })).toBeVisible();
  await expect.poll(() => subs(15)).toEqual([before[0], before[1], before[2]]);
  mock.catOrderFail = null;
  // a search narrows the tree: nothing to drag there
  await pg.locator('[data-cat-q]').fill('شم');
  await expect(pg.locator('[data-cat-grip]')).toHaveCount(0);
  expect(mock.activity.some((r) => r.action === 'product.category.order' && /3 categories/.test(String(r.new_value)))).toBe(true);
});

test('comment 56 — before 0108 is applied the mirror has no order: the tab loads as before, by name, without the grips; a member who cannot write categories has none either', async ({ page }) => {
  mock.noCatOrder = true;
  await openProducts(page);
  await page.locator('#pg-products [role=tab]', { hasText: 'الأقسام' }).click();
  await expect(page.locator('#pg-products .cat-main')).toHaveCount(2);
  await expect(page.locator('#pg-products [data-cat-grip]')).toHaveCount(0);
  await expect(page.locator('#pg-products .cat-sum')).not.toContainText('اسحب');
});

// a small real picture drawn in the page (the upload draws every file again in the browser, so it has to be one the browser reads)
const pngBytes = (page, w, h, color) => page.evaluate(async ([w, h, color]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
  const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; }, [w, h, color]);

test('comments 53–55 — the edit page: one rail on every tab (the status + the product\'s summary) and no price form on «البيانات»; a field keeps the focus while it is typed in; the maker\'s price is a field that writes the two prices by itself and follows a sale price typed by hand; pictures are added from the device', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-en')).toHaveValue('Cushion');
  // 53: the rail — the status card and the summary as the product is now; the price is edited in its own tab only
  const sum = page.locator('#pg-products [data-pe-summary]');
  for (const [k, text] of [['sale', '1,200'], ['regular', '1,500'], ['maker', '840'], ['fee', '360'], ['stock', 'متاح'], ['images', '3 صور']]) await expect(sum.locator('[data-pe-sum="' + k + '"]')).toContainText(text);
  await expect(page.locator('#pg-products #e-status')).toBeVisible();
  await expect(page.locator('#pg-products #e-sale')).toHaveCount(0);
  for (const t of ['البيانات الأساسية', 'الاسم', 'التعريف', 'البراند والمبتكر', 'الحالة والظهور', 'ملخص المنتج']) await expect(page.locator('#pg-products .pe-layout')).toContainText(t);
  // the field being typed in keeps the focus and the caret (it lost them at the first letter)
  await page.locator('#e-en').click(); await page.keyboard.press('End'); await page.keyboard.type(' Deluxe', { delay: 15 });
  await expect(page.locator('#e-en')).toHaveValue('Cushion Deluxe');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('e-en');
  await expect(page.locator('.unsaved')).toContainText('عندك 1 تعديلات');
  // «عدّل السعر والمخزون» in the summary opens the price tab; the rail is there too
  await sum.locator('xpath=..').getByRole('button', { name: 'عدّل السعر والمخزون' }).click();
  await expect(page).toHaveURL(/#products-edit-9001-price$/);
  await expect(page.locator('#pg-products #e-status')).toBeVisible();
  for (const t of ['السعر', 'المخزون']) await expect(page.locator('#pg-products .pe-main .card-h, #pg-products .pe-main h2').filter({ hasText: new RegExp('^' + t) }).first()).toBeVisible();
  // 54: the maker's price opens on what the price leaves him (1,200 − 30%) and writes the two prices as it is typed
  await expect(page.locator('#e-vin')).toHaveValue('840');
  await page.locator('#e-vin').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('1000', { delay: 15 });
  await expect(page.locator('#e-sale')).toHaveValue('1430'); // 1000 ÷ 0.7 = 1428.6 → 1430
  expect(Number(await page.locator('#e-reg').inputValue())).toBeGreaterThan(1430);
  expect(await page.evaluate(() => document.activeElement.id)).toBe('e-vin');
  await expect(page.locator('#e-vin')).toHaveValue('1000');
  await expect(page.locator('[data-vprice]')).toContainText('1,001'); // what the rounded price leaves him
  await expect(page.locator('[data-commission]')).toContainText('429');
  await expect(sum.locator('[data-pe-sum="sale"]')).toContainText('1,430'); await expect(sum.locator('[data-pe-sum="maker"]')).toContainText('1,001');
  // a sale price typed by hand: the maker's price follows it
  await page.fill('#e-sale', '1300');
  await expect(page.locator('#e-vin')).toHaveValue('910');
  await page.fill('#e-reg', '1600');
  await expect(page.locator('[data-poff]')).toContainText('19%');
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  expect(mock.productWrites.at(-1)).toEqual({ action: 'product_save', by: ADMIN, id: 9001, fields: { name: 'Cushion Deluxe', sale_price: '1300', regular_price: '1600' } }); // the maker's price is never sent
  // 55: pictures from the device — after the unsaved edits are saved; drawn again in the browser, sent to the product at once
  await page.getByRole('tab', { name: 'الصور' }).click();
  await expect(page.locator('#pg-products .img-it')).toHaveCount(3);
  await page.locator('#pg-products .img-it').nth(1).click(); await page.getByRole('button', { name: 'خليها الرئيسية' }).click();
  await page.locator('[data-pup]').click();
  await expect(page.locator('.toast.show')).toContainText('احفظ تعديلاتك الأول');
  await page.getByRole('button', { name: 'تجاهل' }).click();
  const [a, b] = [await pngBytes(page, 900, 600, '#c8a05a'), await pngBytes(page, 300, 2400, '#1f4d3a')];
  let fc = page.waitForEvent('filechooser'); await page.locator('[data-pup]').click();
  await (await fc).setFiles([{ name: 'front.png', mimeType: 'image/png', buffer: Buffer.from(a) }, { name: 'side.png', mimeType: 'image/png', buffer: Buffer.from(b) }]);
  await expect(page.locator('.toast.show').filter({ hasText: 'اترفعت 2 صور على المنتج' })).toBeVisible();
  const up = mock.productWrites.at(-1);
  expect([up.action, up.id, up.paths, up.first, up.images]).toEqual(['product_images_add', 9001, undefined, false, ['webp', 'webp']]); // real WebP files, not the PNGs
  expect(up.bytes.every((n) => n > 0 && n < 3 * 1048576)).toBe(true);
  await expect(page.locator('#pg-products .img-it')).toHaveCount(5);
  await expect(page.locator('#pg-products [data-pe-sum="images"]')).toContainText('5 صور');
  expect(mock.activity.some((r) => r.action === 'product.images.add' && /2 images uploaded/.test(String(r.new_value)))).toBe(true);
  // a file that is not a picture: nothing sent
  const n0 = mock.productWrites.length;
  fc = page.waitForEvent('filechooser'); await page.locator('[data-pup]').click();
  await (await fc).setFiles([{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') }]);
  await expect(page.locator('.toast.show').filter({ hasText: 'مش صورة مقروءة' })).toBeVisible();
  expect(mock.productWrites.length).toBe(n0);
  // the switch off on the server: said, nothing changed
  mock.pushEnabled = false;
  fc = page.waitForEvent('filechooser'); await page.locator('[data-pup]').click();
  await (await fc).setFiles([{ name: 'front.png', mimeType: 'image/png', buffer: Buffer.from(a) }]);
  await expect(page.locator('.toast.show').filter({ hasText: 'الكتابة على الموقع مقفولة' })).toBeVisible();
  await expect(page.locator('#pg-products .img-it')).toHaveCount(5);
});

test('comments 53–55 — a member who cannot edit products sees the same page read-only: no upload, no maker\'s price field', async ({ page }) => {
  await openProducts(page, ACCOUNTS);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#pg-products [data-pe-summary]')).toBeVisible();
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await expect(page.locator('#e-sale')).toBeDisabled();
  await expect(page.locator('#e-vin')).toHaveCount(0);
  await page.getByRole('tab', { name: 'الصور' }).click();
  await expect(page.locator('[data-pup]')).toHaveCount(0);
});

test('reports tab (decision 20): best sellers and categories from our orders in the range (products_report), out of stock from the mirror; names open the edit page', async ({ page }) => {
  await openProducts(page, OPS);
  await page.getByRole('tab', { name: 'التقارير' }).click();
  await expect(page).toHaveURL(/#products-reports$/);
  const pr = page.locator('#pg-products');
  await expect(pr.locator('.rp-top tbody tr')).toHaveCount(3); // Cushion (2 orders), Macrame Curtain, Macrame Feathers — the removed line and the 400-day-old order left out
  await expect(pr.locator('.rp-top tbody tr').first()).toContainText('Cushion');
  await expect(pr.locator('.rp-top tbody tr').first()).toContainText('2,004');
  await expect(pr.locator('.kpi').filter({ hasText: 'قطع اتباعت' })).toContainText('6');
  await expect(pr.locator('.kpi').filter({ hasText: 'منتجات اتباعت' })).toContainText('3');
  await expect(pr.locator('.kpi').filter({ hasText: 'أكتر قسم مبيعًا' })).toContainText('إضاءة');
  await expect(pr.locator('.rp-cats tbody tr').first()).toContainText('83.3%'); // إضاءة 5 of 6 pieces
  await expect(pr.locator('.rp-out tbody tr')).toHaveCount(1); // Macrame Feathers (stock 0); the curtain is «حسب الطلب»
  await expect(pr.locator('.rp-out tbody tr')).toContainText('Macrame Feathers');
  expect(mock.reportCalls.length).toBeGreaterThan(0);
  const { from, to } = mock.reportCalls.at(-1); expect(from < to).toBe(true); // the reports page's range (last 30 days)
  await pr.locator('.rp-out .link-btn', { hasText: 'Macrame Feathers' }).click();
  await expect(page).toHaveURL(/#products-edit-9003-data$/);
});

test('reports tab: a failed products_report shows «جرّب تاني» and retries', async ({ page }) => {
  mock.reportFail = true;
  await openProducts(page);
  await page.getByRole('tab', { name: 'التقارير' }).click();
  await expect(page.locator('#pg-products')).toContainText('مقدرناش نحسب التقارير');
  mock.reportFail = false;
  await page.locator('#pg-products').getByRole('button', { name: 'جرّب تاني' }).click();
  await expect(page.locator('#pg-products .rp-top tbody tr')).toHaveCount(3);
});

test('SEO tab (phase 5.1): Rank Math title / description per language with a counter and a preview; tags and Rank Math variables outside SEO_VARS refused before any request; saved as seo_* fields', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await page.getByRole('tab', { name: 'SEO' }).click();
  await expect(page.locator('#e-seo-t')).toHaveValue('');
  await expect(page.locator('.seo-prev').first()).toContainText('Cushion'); // empty = the product name in the preview
  await page.fill('#e-seo-t', 'Boho Cushion Cover | Ibtekr');
  await expect(page.locator('.seo-prev').first()).toContainText('Boho Cushion Cover | Ibtekr');
  await expect(page.locator('#e-seo-t').locator('xpath=ancestor::div[contains(@class,"field")]')).toContainText('27 / 60 حرف');
  await page.fill('#e-seo-d', 'Cushion %customfield( _wc_cog_cost)%'); // Rank Math would print the cost meta on the page
  await page.locator('[data-psave]').click();
  await expect(page.locator('#pg-products')).toContainText('«%customfield(» مش مسموح');
  await page.fill('#e-seo-d', '');
  await page.fill('#e-seo-ad', 'كيس <b>مخدة</b>');
  await page.locator('[data-psave]').click();
  await expect(page.locator('#pg-products')).toContainText('من غير < أو >');
  const before = mock.productWrites ? mock.productWrites.length : 0;
  await page.fill('#e-seo-ad', 'كيس مخدة بوهيمي مشغول يدوي');
  await page.locator('[data-psave]').click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  expect(mock.productWrites.length).toBe(before + 1);
  expect(mock.productWrites.at(-1)).toEqual({ action: 'product_save', by: ADMIN, id: 9001, fields: { seo_title: 'Boho Cushion Cover | Ibtekr' }, ar: { seo_description: 'كيس مخدة بوهيمي مشغول يدوي' } });
  await expect(page.locator('#e-seo-t')).toHaveValue('Boho Cushion Cover | Ibtekr'); // read back from the site
});

test('products.bulk: a member with products.edit but not products.bulk sees no bulk bar, yet publishes one product from its menu', async ({ page }) => {
  mock.profiles.find((x) => x.email === OPS).custom_perms = { 'products.bulk': 'N' }; // ops with products.edit F, without the bulk bar
  await openProducts(page, OPS);
  await rowOf(page, 'Boho mirror').locator('[role=checkbox]').click();
  await expect(page.locator('.bulk-bar')).toHaveCount(0);
  await rowOf(page, 'Boho mirror').getByRole('button', { name: 'إجراءات Boho mirror' }).click();
  await page.getByRole('menuitem', { name: 'نشر' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انشر' }).click();
  await expect(rowOf(page, 'Boho mirror')).toContainText('منشور');
  expect(mock.productWrites.at(-1)).toMatchObject({ action: 'product_save', by: OPS, id: 9004 });
});

// ---- phase 5.5 (the owner's prototype v2, plan decision 5) ----
test('5.5 / B3: the type is a group of the «فلتر» next to the sort (the picks show as chips); «تخصيص التقارير» picks up to 8 cards saved per member', async ({ page }) => {
  await openProducts(page);
  const rows = page.locator('#pg-products .pr-table tbody tr');
  await page.locator('#pg-products [data-fm-btn="products"]').click(); // the owner 12 Nov: the groups inside one «فلتر»
  await page.locator('[data-fm-menu="products"] [data-fm-tab="type"]').click();
  await page.locator('[data-fm-menu="products"] [data-fm="type:Variable"]').click();
  await expect(page.locator('[data-fm-menu="products"] [data-fm-apply]')).toHaveText('اعرض 1 منتج');
  await page.locator('[data-fm-menu="products"] [data-fm-apply]').dispatchEvent('click');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#pg-products .af-row .af-chip')).toHaveCount(1);
  await expect(page.locator('#pg-products .af-chip .af-t')).toHaveText('النوع: Variable');
  await expect(page.locator('#pg-products [data-fm-btn="products"] .val')).toHaveText('فلتر (1)');
  await page.locator('#pg-products [data-af-chip="type:Variable"]').click();
  await expect(rows).toHaveCount(4);
  await page.locator('#pg-products [data-sm-btn="products"]').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'الاسم: A → Z' }).click();
  await expect(rows.first()).toContainText('Boho mirror');
  // the reports tab: four default cards, the picker adds one and saves the choice for the member
  await page.getByRole('tab', { name: 'التقارير' }).click();
  await expect(page.locator('#pg-products [data-prod-kpis] .kpi')).toHaveCount(4);
  await page.locator('[data-prod-kpi-custom]').click();
  await expect(page.locator('[data-kpi-pick] [data-kpi-count]')).toHaveText('مختار 4 من 8');
  await page.locator('[data-kpi="drafts"]').click();
  await page.locator('[data-kpi-save]').click();
  await expect(page.locator('#pg-products [data-prod-kpis] .kpi')).toHaveCount(5);
  await expect(page.locator('#pg-products .kpi').filter({ hasText: 'مسودات' })).toContainText('1'); // Macrame Feathers
  await expect.poll(() => mock.requests.filter((r) => /user_prefs/.test(r) && /POST/.test(r)).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------- phase 12 T2: «تكرار كمنتج جديد»

test('duplicate (phase 12): the row menu → a confirm → one product_duplicate call; the copy (a draft, «(نسخة)», a new SKU) lands in the records and its edit page opens; ops (no products.add) is told', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Cushion').getByRole('button', { name: 'إجراءات Cushion' }).click();
  await page.getByRole('menuitem', { name: 'تكرار كمنتج جديد' }).click();
  await expect(page.locator('.modal')).toContainText('بـ SKU جديد من مسلسل الاستوديو');
  await page.locator('.modal').getByRole('button', { name: 'اعمل النسخة' }).click();
  await expect.poll(() => mock.products.some((p) => p.name === 'Cushion (نسخة)')).toBe(true);
  const copy = mock.products.find((p) => p.name === 'Cushion (نسخة)'); // a new id after every mirror row (the Arabic rows included)
  await expect(page).toHaveURL(new RegExp('#products-edit-' + copy.id + '$'));
  expect(mock.productWrites.filter((w) => w.action === 'product_duplicate')).toEqual([expect.objectContaining({ id: 9001, by: ADMIN })]);
  expect(mock.serialTakes).toEqual([1]);
  expect([copy.status, copy.sku, copy.translation_ids]).toEqual(['draft', 'IBTA4040PAHC000013-0999', { en: copy.id, ar: copy.id + 1 }]);
  await expect(page.locator('#pg-products')).toContainText('Cushion (نسخة)');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'product.duplicate').map((a) => a.new_value)).toEqual(['#9001 #' + copy.id + ' · IBTA4040PAHC000013-0999']);
  // back to the records: the copy is a draft row
  await page.evaluate(() => { location.hash = '#products-records'; });
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
  await expect(rowOf(page, 'Cushion \\(نسخة\\)')).toContainText('مسودة');
});

test('duplicate (phase 12): a member without products.add (accounts) is told and nothing is sent', async ({ page }) => {
  await openProducts(page, ACCOUNTS);
  await rowOf(page, 'Cushion').getByRole('button', { name: 'إجراءات Cushion' }).click();
  await page.getByRole('menuitem', { name: 'تكرار كمنتج جديد' }).click();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'إضافة منتجات' }).first()).toBeVisible();
  expect((mock.productWrites || []).filter((w) => w.action === 'product_duplicate')).toEqual([]);
});

// phase 13 decision 52: the product's own making days — empty = the maker's; saved on its own when the field is left; the orders follow
test('decision 52: «مدة التصنيع (يوم)» on the product page writes product_lead_days (empty = back to the maker\'s days)', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-lead')).toBeEnabled();
  await expect(page.locator('#e-lead')).toHaveAttribute('placeholder', /مدة المبتكر: 7/);
  await page.fill('#e-lead', '10'); await page.locator('#e-lead').blur();
  await expect.poll(() => mock.leadWrites.at(-1)).toMatchObject({ op: 'upsert', product_id: '9001', days: 10 });
  await expect(page.locator('.toast.show')).toContainText('اتحفظت مدة التصنيع: 10 يوم');
  expect((mock.productWrites || []).filter((w) => w.action === 'product_save')).toEqual([]); // not a site write
  await page.fill('#e-lead', '200'); await page.locator('#e-lead').blur();
  await expect(page.locator('.toast.show')).toContainText('من 1 لـ 90');
  await page.fill('#e-lead', ''); await page.locator('#e-lead').blur();
  await expect.poll(() => mock.leadWrites.at(-1)).toMatchObject({ op: 'delete', product_id: '9001' });
  await expect.poll(() => mock.activity.filter((a) => a.action === 'product.lead').length).toBe(2);
});

// phase 13 decision 56: «الأقسام» — the site's category tree, the products under each, a new category / sub-category on the site
// B4 (the owner, 11 Nov): the categories tab — a main category a green card, its subs beige rows with «-» / «--» by depth, ⋮ per
// category (افتح في السجل · تعديل · إضافة قسم فرعي · حذف), a square image in the popups, the count opens the category's products
const PNG_4X2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4ISf3HxkzoAsAAA81EBmbqAf0AAAAAElFTkSuQmCC', 'base64');
test('B4: «الأقسام» — green main cards, beige sub rows with «-» / «--», the arrow, the search, a sub-category and a main one on the site with a square image', async ({ page }) => {
  await openProducts(page);
  const pg = page.locator('#pg-products');
  await page.getByRole('tab', { name: 'الأقسام', exact: true }).click(); // without the categories' count (the owner 15 Nov, 2026-11-15-comments.md decision 1)
  await expect(page).toHaveURL(/#products-cats$/);
  const main = (id) => pg.locator(`.cat-main[data-cat="${id}"]`); const sub = (id) => pg.locator(`.cat-sub[data-cat="${id}"]`);
  await expect(pg.locator('.cat-main')).toHaveCount(2); // the two main categories, closed
  await expect(pg.locator('.cat-sub')).toHaveCount(0);
  await expect(main(15).locator('.cat-main-h')).toContainText('ديكور'); await expect(main(15).locator('.cat-main-h')).toContainText('1 قسم فرعي');
  await expect(main(15).locator('[data-cat-prods="15"]')).toHaveText('3 منتج');
  await expect(main(22).locator('[data-cat-prods="22"]')).toHaveText('1 منتج');
  expect(await main(15).locator('.cat-main-h').evaluate((x) => { const c = getComputedStyle(x); return [c.backgroundColor, c.color]; })).toEqual(['rgb(0, 86, 66)', 'rgb(255, 247, 239)']);
  await main(15).locator('[data-cat-tog="15"]').click();
  await expect(sub(151)).toBeVisible();
  await expect(sub(151).locator('.cat-dash')).toHaveText('-');
  await expect(sub(151).locator('[data-cat-prods="151"]')).toHaveText('3 منتج');
  expect(await sub(151).evaluate((x) => getComputedStyle(x).backgroundColor)).toBe('rgb(239, 226, 201)'); // owner batch 14 Nov decision 9: «-» the first beige level (--lvl-1); deeper is lighter
  await sub(151).locator('[data-cat-tog="151"]').click();
  await expect(sub(152).locator('.cat-dash')).toHaveText('--');
  await expect(sub(152).locator('[data-cat-prods="152"]')).toBeDisabled(); // nothing in it
  // the search opens the branches it hits
  await pg.getByRole('button', { name: 'اقفل الكل' }).click();
  await expect(pg.locator('.cat-sub')).toHaveCount(0);
  await pg.locator('[data-cat-q]').fill('أباج');
  await expect(pg.locator('.cat-main')).toHaveCount(1);
  await expect(sub(152).locator('.cat-hit')).toHaveText('أباجورات');
  await pg.locator('[data-cat-q]').fill('');
  // ⋮ on «إضاءة» → «إضافة قسم فرعي»: the parent said, both names required, a square image from a 4×2 picture
  await pg.getByRole('button', { name: 'افتح الكل' }).click();
  await sub(151).getByRole('button', { name: 'إجراءات القسم إضاءة' }).click();
  await page.getByRole('menuitem', { name: 'إضافة قسم فرعي' }).click();
  const dlg = page.getByRole('dialog', { name: 'قسم فرعي جديد' });
  await expect(dlg.locator('[data-cat-parent]')).toContainText('ديكور › إضاءة');
  await expect(dlg.locator('select, #p')).toHaveCount(0); // no «القسم الأب» field
  await dlg.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(dlg.getByText('اكتب الاسم')).toHaveCount(2);
  await dlg.locator('#en').fill('Desk lamps'); await dlg.locator('#ar').fill('أباجورات مكتب');
  await dlg.locator('[data-cat-img]').setInputFiles({ name: 'lamp.png', mimeType: 'image/png', buffer: PNG_4X2 });
  const prev = dlg.locator('[data-cat-img-prev="new"]');
  await expect(prev).toBeVisible();
  await expect.poll(() => prev.evaluate((i) => [i.naturalWidth, i.naturalHeight])).toEqual([2, 2]); // cut square from the middle
  await dlg.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.toast.show')).toContainText('اتعمل القسم «Desk lamps» على الموقع');
  expect(mock.categoriesCreated).toEqual([{ action: 'category_create', name_en: 'Desk lamps', name_ar: 'أباجورات مكتب', parent: 151, image: true, by: ADMIN }]);
  await expect(pg.locator('.cat-sub').filter({ hasText: 'Desk lamps' }).locator('.cat-dash')).toHaveText('--');
  // «قسم رئيسي جديد»: no parent field; a name already there → refused before any call
  await pg.locator('[data-cat-new]').click();
  const top = page.getByRole('dialog', { name: 'قسم رئيسي جديد' });
  await expect(top.locator('[data-cat-parent]')).toHaveCount(0);
  await top.locator('#en').fill('هدايا'); await top.locator('#ar').fill('هدايا');
  await top.getByRole('button', { name: 'اعمل القسم' }).click();
  await expect(top.getByText('في قسم بنفس الاسم هنا')).toBeVisible();
  expect(mock.categoriesCreated).toHaveLength(1);
  await top.getByRole('button', { name: 'إلغاء' }).click();
  // ⋮ «افتح في السجل»: the records filtered on that category
  await sub(151).getByRole('button', { name: 'إجراءات القسم إضاءة' }).click();
  await page.getByRole('menuitem', { name: 'افتح في السجل' }).click();
  await expect(page).toHaveURL(/#products-records$/);
  await expect(pg.locator('.pr-table tbody tr')).toHaveCount(3);
});

test('B4: «تعديل» reads the category live and writes what changed; «حذف» is refused while products or sub-categories use it, else confirmed and gone; the count opens the products and moves them to another category', async ({ page }) => {
  await openProducts(page);
  const pg = page.locator('#pg-products');
  await page.getByRole('tab', { name: /^الأقسام/ }).click();
  const main = (id) => pg.locator(`.cat-main[data-cat="${id}"]`); const sub = (id) => pg.locator(`.cat-sub[data-cat="${id}"]`);
  // تعديل: the names from the site (the Arabic one too), a new English name only → only it is sent
  await main(22).getByRole('button', { name: 'إجراءات القسم هدايا' }).click();
  await page.getByRole('menuitem', { name: 'تعديل' }).click();
  const ed = page.getByRole('dialog', { name: 'تعديل القسم «هدايا»' });
  await expect(ed.locator('#en')).toHaveValue('هدايا'); await expect(ed.locator('#ar')).toHaveValue('هدايا AR');
  await ed.locator('#en').fill('Gifts');
  await ed.getByRole('button', { name: 'احفظ على الموقع' }).click();
  await expect(ed).toHaveCount(0);
  await expect(page.locator('.toast.show')).toContainText('اتعدّل القسم على الموقع');
  expect(mock.categoryWrites).toEqual([{ action: 'category_update', id: 22, name_en: 'Gifts', name_ar: null, image: false, by: ADMIN }]);
  await expect(main(22).locator('.cat-main-h')).toContainText('Gifts');
  // حذف: «إضاءة» has products → refused here with a way to them, nothing sent
  await main(15).locator('[data-cat-tog="15"]').click(); await sub(151).locator('[data-cat-tog="151"]').click();
  await sub(151).getByRole('button', { name: 'إجراءات القسم إضاءة' }).click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  const blocked = page.locator('[data-cat-blocked]');
  await expect(blocked).toContainText('فيه 3 منتج');
  await blocked.getByRole('button', { name: 'تمام' }).click();
  // «أباجورات» is empty → confirmed, deleted for good on the site, gone from the tab
  await sub(152).getByRole('button', { name: 'إجراءات القسم أباجورات' }).click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  const conf = page.getByRole('dialog', { name: 'حذف القسم «أباجورات» نهائي؟' });
  await expect(conf).toContainText('مالوش سلة للأقسام');
  await conf.getByRole('button', { name: 'احذف القسم' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتحذف القسم «أباجورات» من الموقع');
  expect(mock.categoryWrites.at(-1)).toEqual({ action: 'category_delete', id: 152, by: ADMIN });
  await expect(sub(152)).toHaveCount(0);
  // the count → the category's products; two of them moved to «Gifts»: this branch swapped for the pick (products_batch)
  await sub(151).locator('[data-cat-prods="151"]').click();
  const pop = page.locator('[data-cat-prods-pop="151"]');
  await expect(pop.locator('tbody tr')).toHaveCount(3);
  await expect(pop).not.toContainText('null'); // no empty node shows as text
  await pop.locator('tbody tr').filter({ hasText: 'Cushion' }).locator('[role=checkbox]').click();
  await pop.locator('tbody tr').filter({ hasText: 'Boho mirror' }).locator('[role=checkbox]').click();
  await pop.locator('[data-cat-bulk]').getByRole('button', { name: 'نقل لقسم تاني' }).click();
  const pick = page.getByRole('dialog', { name: 'نقل 2 منتجات لقسم تاني' });
  await expect(pick.getByRole('button', { name: '+ قسم جديد' })).toHaveCount(0); // B4: no new category from here
  await expect(pick).not.toContainText('null');
  await expect(pick.locator('.cat-row.cat-pk-main')).toHaveCount(2);
  await pick.locator('[data-cat-pick="22"]').click();
  await pick.getByRole('button', { name: 'تمام' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتنقلوا للقسم الجديد');
  const w = mock.productWrites.at(-1);
  expect([w.action, w.update.map((u) => [u.id, u.categories])]).toEqual(['products_batch', [[9004, [22]], [9001, [22]]]]); // in the popup's order (by name)
});

// phase 13 decision 62: the products tabs and «نظرة عامة» / «سجل الحركة»
test('decision 62: the tabs are نظرة عامة · إضافة · سجل المنتجات · الأقسام · سجل الحركة · التقارير; the overview shows the catalog and the best sellers and categories side by side (B3: no out-of-stock tile or table); the log card has its count and its dropdowns', async ({ page }) => {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  const pg = page.locator('#pg-products');
  const tabs = pg.locator('[role=tab]');
  await expect(tabs).toHaveText(['نظرة عامة', 'إضافة', 'سجل المنتجات', 'الأقسام', 'سجل الحركة', 'التقارير']); // «الأقسام» without its count (2026-11-15-comments.md decision 1)
  await expect(page).toHaveURL(/#products-overview$/);
  await expect(pg.locator('.kpi[aria-label="المنتجات"]')).toContainText('4');
  await expect(pg.locator('.kpi[aria-label="خلص ستوكه ولسه منشور"]')).toHaveCount(0); // B3: the stock tile and table are gone
  await expect(pg.locator('section', { hasText: 'خلص ستوكه ولسه منشور' })).toHaveCount(0);
  await expect(pg.locator('[data-ov-two] > section')).toHaveCount(2); // the two tables side by side
  await expect(pg.locator('[data-ov-two] [data-cols], [data-ov-two] [data-fm-btn], [data-ov-two] [data-fm-row], [data-ov-two] [data-sm-btn]')).toHaveCount(0); // top-10 lists: no columns / filter / sort buttons
  await expect(pg.locator('[data-ov-two]')).toContainText('المنتجات الأكثر مبيعًا — أعلى 10');
  await expect(pg.locator('[data-ov-two]')).toContainText('الأقسام الأكثر مبيعًا — أعلى 10');
  // a product action, then the log
  mock.activityRows.push({ id: 7001, at: new Date().toISOString(), actor: mock.profiles.find((p) => p.email === ADMIN).id, action: 'product.trash', entity: 'products', entity_id: '9004', old_value: null, new_value: '#9004' });
  await tabs.nth(4).click();
  await expect(page).toHaveURL(/#products-log$/);
  await pg.locator('[data-log-all="products"]').click(); // the meeting of 23 Nov [#4]: the log opens on «هذا الشهر» — the seeded move is older
  await expect(pg.locator('[data-plog-row="product.trash"]')).toHaveText('نقل للمهملات');
  // the log card like the other tables — its count, one «فلتر» (the move · by whom — the owner 12 Nov) and «تحديث» in the header
  const card = pg.locator('.plog-card');
  await expect(card.locator('.sec-h')).toContainText('1 من 1 حركة');
  await expect(card.locator('[data-plog-kind]')).toHaveCount(0);
  await card.locator('[data-fm-btn="plog"]').click();
  await page.locator('[data-fm-menu="plog"] [data-fm-tab="kind"]').click();
  await expect(page.locator('[data-fm-menu="plog"] [data-fm-key="kind"] [role=menuitemcheckbox]')).toHaveText(['نقل للمهملات']);
  await page.locator('[data-fm-menu="plog"] [data-fm-tab="by"]').click();
  await expect(page.locator('[data-fm-menu="plog"] [data-fm-key="by"] [role=menuitemcheckbox]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(card.locator('[data-plog-refresh]')).toBeVisible();
});

// comments decision 82 (the owner 15 Nov on «تعديل سعر منتج» — «لما اعدل نسبة ابتكر … يظهرلي تحتيها ال vendors … و المقدار اللي هزوده يزيد علي
// الفيندور كله لو انا محدد كل منتجات الفيندور ده … و في حالة تحديد قسم معين … يظهرلي الاقسام … مرتبط بالنسبة بتاعة المبتكرين» · «و سع عرض الpopup ده»):
// «نسبة إبتكر» is the maker's commission — the popup lists whose and what moves, and «طبّق» writes it before the prices
test('comment 82 + owner 17 Nov — «تعديل سعر» for one maker at a time: a mix is refused; «نسبة إبتكر» shows what moves for him (all his products = his general rate and his category rates; all his products of a category = that category; a maker without a rate = the price only), then writes the commission (vendor_commission_set) and the prices', async ({ page }) => {
  await openProducts(page);
  const idOf = (name) => mock.vendors.find((v) => v.name === name).id;
  const VA = idOf('Art Craft'); const VB = idOf('Antikiano'); const VC = idOf('Bian eg');
  const bar = () => page.locator('.bulk-bar');
  const m = page.locator('.modal.bp-modal');
  const pick = async (names) => { for (const n of names) await rowOf(page, n).locator('[role=checkbox]').click(); };
  // the owner 17 Nov («تعديل السعر بال bulk يبقي لمنتجات مبتكر واحد بس»): products of three makers → refused, no popup
  await pick(['Cushion', 'Macrame Feathers', 'Boho mirror']);
  await bar().getByRole('button', { name: 'تعديل السعر' }).click();
  await expect(page.locator('body')).toContainText('حدد منتجات مبتكر واحد بس');
  await expect(m).toHaveCount(0);
  await pick(['Cushion', 'Macrame Feathers', 'Boho mirror']); // untick
  // Art Craft alone — Cushion is all of his products: his general rate and his category's move together
  await pick(['Cushion']);
  await bar().getByRole('button', { name: 'تعديل السعر' }).click();
  await expect(m).toBeVisible();
  expect(await m.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(820); // wider than the system's 800 popup
  await expect(m.locator('[data-bp-makers]')).toHaveCount(0); // the makers box shows with «نسبة إبتكر» only
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await expect(m.getByRole('radio', { name: 'نسبة %' })).toHaveCount(0); // the owner 16 Nov: the rate moves by points — no unit choice
  await m.locator('#amount').fill('2');
  const box = m.locator('[data-bp-makers]');
  await expect(box).toHaveAttribute('data-bp-makers', '1');
  // the owner 17 Nov: the «قبل ← بعد» table has the SKU and the maker in their own columns
  const prev = m.locator('.bp-preview table');
  await expect(prev.locator('thead th')).toHaveText(['المنتج', 'SKU', 'المبتكر', 'نسبة إبتكر', 'سعر البيع']);
  await expect(prev.locator('.bp-maker').first()).toHaveText('Art Craft');
  await expect(prev.locator('.bp-sku').first()).not.toHaveText('');
  const a = box.locator('[data-bp-maker="' + VA + '"]');
  await expect(a).toHaveAttribute('data-bp-scope', 'whole');
  await expect(a).toContainText('Art Craft'); await expect(a).toContainText('البراندات:'); await expect(a).toContainText('كل منتجاته (1)');
  await expect(a.locator('.bp-scope')).toHaveText('النسبة كلها');
  await expect(a.locator('[data-bp-line="general"]')).toContainText('35% ← 37%');
  await expect(a.locator('[data-bp-line="15"]')).toContainText('ديكور'); await expect(a.locator('[data-bp-line="15"]')).toContainText('30% ← 32%');
  // past 65 the popup refuses before any write
  await m.locator('#amount').fill('40');
  await m.getByRole('button', { name: 'طبّق السعر والنسبة' }).click();
  await expect(m).toContainText('هتعدّي 65%');
  const ratesA = mock.vendorRates.filter((r) => r.vendor_id === VA).length; const ratesB = mock.vendorRates.filter((r) => r.vendor_id === VB).length;
  await m.locator('#amount').fill('2');
  let before = (mock.productWrites || []).length;
  await m.getByRole('button', { name: 'طبّق السعر والنسبة' }).click();
  // the owner 17 Nov: the busy pill said «[object HTMLSpanElement]» — words only
  await expect(page.locator('.busy-pill .busy-txt').first()).toContainText('نسبة');
  expect((await page.locator('.busy-pill .busy-txt').allTextContents()).join(' ')).not.toContain('[object');
  await expect(m).toBeHidden({ timeout: 15000 });
  const last = (list, f) => list.filter(f).at(-1);
  await expect.poll(() => mock.vendorRates.filter((r) => r.vendor_id === VA).length).toBe(ratesA + 1);
  expect([last(mock.vendorRates, (r) => r.vendor_id === VA).rate, last(mock.vendorRates, (r) => r.vendor_id === VA).commission_type]).toEqual([37, 'category_based']);
  expect(Number(last(mock.vendorCategoryRates, (r) => r.vendor_id === VA && Number(r.woo_category_id) === 15).rate)).toBe(32);
  await expect.poll(() => (mock.productWrites || []).length).toBeGreaterThan(before);
  let ups = mock.productWrites.slice(before).flatMap((w) => (Array.isArray(w.update) ? w.update : w.id != null ? [{ id: w.id, ...(w.fields || {}) }] : []));
  // Cushion (1200 at 35%, no fee): the maker keeps 780 → at 37% the sale price is 780 ÷ 0.63 up to the next 10
  expect(Number(ups.find((u) => Number(u.id) === 9001).sale_price)).toBe(1240);
  expect(mock.vendorRates.filter((r) => r.vendor_id === VB).length).toBe(ratesB); // nobody else's commission moved
  // Antikiano alone — Macrame Feathers is his only product of «إضاءة» (of his two): that category alone, his commission turns «حسب القسم»
  await expect(bar()).toHaveCount(0);
  await pick(['Macrame Feathers']);
  await bar().getByRole('button', { name: 'تعديل السعر' }).click();
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await m.locator('#amount').fill('2');
  const b = m.locator('[data-bp-maker="' + VB + '"]');
  await expect(b).toHaveAttribute('data-bp-scope', 'cats');
  await expect(b.locator('.bp-mk-what')).toContainText('نسبة القسم'); await expect(b.locator('.bp-cat')).toHaveText(['إضاءة']);
  await expect(b.locator('.bp-scope')).toHaveText('أقسام بعينها');
  await expect(b.locator('[data-bp-line]')).toHaveCount(1);
  await expect(b.locator('[data-bp-line="151"]')).toContainText('45% ← 47%');
  await expect(b).toContainText('حسب القسم');
  before = (mock.productWrites || []).length;
  await m.getByRole('button', { name: 'طبّق السعر والنسبة' }).click();
  await expect(m).toBeHidden({ timeout: 15000 });
  await expect.poll(() => mock.vendorRates.filter((r) => r.vendor_id === VB).length).toBe(ratesB + 1);
  const rb = last(mock.vendorRates, (r) => r.vendor_id === VB);
  expect([Number(rb.rate), rb.commission_type, Number(rb.flat)]).toEqual([45, 'category_based', 10]); // his general rate and flat fee stay
  expect(Number(last(mock.vendorCategoryRates, (r) => r.vendor_id === VB && Number(r.woo_category_id) === 151).rate)).toBe(47);
  await expect.poll(() => (mock.productWrites || []).length).toBeGreaterThan(before);
  ups = mock.productWrites.slice(before).flatMap((w) => (Array.isArray(w.update) ? w.update : w.id != null ? [{ id: w.id, ...(w.fields || {}) }] : []));
  expect(ups.map((u) => Number(u.id))).toEqual([9003]);
  // Bian eg alone — no general rate: the price only, and his commission is never written
  await expect(bar()).toHaveCount(0);
  await pick(['Boho mirror']);
  await bar().getByRole('button', { name: 'تعديل السعر' }).click();
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await m.locator('#amount').fill('2');
  const c = m.locator('[data-bp-maker="' + VC + '"]');
  await expect(c).toHaveAttribute('data-bp-scope', 'price');
  await expect(c.locator('.bp-scope')).toHaveText('السعر بس');
  // «الخصم الوهمي» keeps the plain button and no makers box
  await m.getByRole('radio', { name: 'الخصم الوهمي' }).click();
  await expect(m.locator('[data-bp-makers]')).toHaveCount(0);
  await expect(m.getByRole('button', { name: 'طبّق السعر', exact: true })).toBeVisible();
  expect(mock.vendorRates.filter((r) => r.vendor_id === VC).length).toBe(0);
});

// the owner 17 Nov («انا مفلتر علي categorey معينة لمبتكر … اعدل النسبة في ال categorey دي عند المبتكر», then his four answers): the records
// filtered on a maker and a category — «نسبة إبتكر» on one of his products there moves that category's rate, and his other product in it
// (not picked) gets its price from the new rate too; with all his products picked it is his whole commission, a filter or not
test('owner 17 Nov — «نسبة إبتكر» on a category filter: the filtered category\'s rate moves on one picked product, the unpicked one in it follows; all his products = the whole maker', async ({ page }) => {
  const twin = JSON.parse(JSON.stringify(mock.products.find((p) => Number(p.id) === 9003)));
  Object.assign(twin, { id: 9005, sku: 'IBTB0CSW6RFTL', name: 'Macrame Lamp', status: 'publish', sale_price: 1200, regular_price: 1500, permalink: twin.permalink.replace('macrame-feathers', 'macrame-lamp'), raw: { id: 9005 }, translation_ids: { en: 9005 } });
  mock.products.push(twin);
  await openProducts(page);
  const VB = mock.vendors.find((v) => v.name === 'Antikiano').id; const VA = mock.vendors.find((v) => v.name === 'Art Craft').id;
  const fbtn = page.locator('#pg-products [data-fm-btn="products"]'); const fm = page.locator('[data-fm-menu="products"]');
  await fbtn.click();
  await fm.locator('[data-fm-tab="vendor"]').click(); await fm.locator('[data-fm="vendor:Antikiano"]').click();
  await fm.locator('[data-fm-tab="category"]').click();
  const cm = fm.locator('[data-fm-key="category"]');
  await cm.locator('[data-fm-row]', { hasText: 'ديكور' }).first().locator('[data-fm-tog]').click();
  await cm.locator('[role=menuitemcheckbox]', { hasText: 'إضاءة' }).click();
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  await rowOf(page, 'Macrame Feathers').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  const m = page.locator('.modal.bp-modal');
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await m.locator('#amount').fill('2');
  const b = m.locator('[data-bp-maker="' + VB + '"]');
  await expect(b).toHaveAttribute('data-bp-scope', 'cats');
  await expect(b.locator('.bp-cat')).toHaveText(['إضاءة']);
  await expect(b.locator('[data-bp-line="general"]')).toHaveCount(0);
  await expect(m.locator('[data-bp-extra]')).toHaveAttribute('data-bp-extra', '1');
  await expect(m.locator('.bp-preview')).toContainText('Macrame Lamp');
  const before = (mock.productWrites || []).length; const nB = mock.vendorRates.filter((r) => r.vendor_id === VB).length;
  await m.getByRole('button', { name: 'طبّق السعر والنسبة' }).click();
  await expect(m).toBeHidden({ timeout: 15000 });
  await expect.poll(() => Number((mock.vendorCategoryRates.filter((r) => r.vendor_id === VB && Number(r.woo_category_id) === 151).at(-1) || {}).rate)).toBe(47);
  expect(mock.vendorRates.filter((r) => r.vendor_id === VB).length).toBe(nB + 1);
  expect(Number(mock.vendorRates.filter((r) => r.vendor_id === VB).at(-1).rate)).toBe(45); // the general rate stays
  await expect.poll(() => (mock.productWrites || []).length).toBeGreaterThan(before);
  const ups = mock.productWrites.slice(before).flatMap((w) => (Array.isArray(w.update) ? w.update : w.id != null ? [{ id: w.id, ...(w.fields || {}) }] : []));
  expect(ups.map((u) => Number(u.id)).sort()).toEqual([9003, 9005]); // the unpicked one in the category too
  // Art Craft filtered on «ديكور»: Cushion is all he has → his whole commission (the owner: «نسبته العامة»)
  await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
  await fbtn.click();
  await fm.locator('[data-fm-tab="vendor"]').click(); await fm.locator('[data-fm="vendor:Art Craft"]').click();
  await fm.locator('[data-fm-tab="category"]').click(); await cm.locator('[role=menuitemcheckbox]', { hasText: 'ديكور' }).first().click();
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await m.locator('#amount').fill('2');
  await expect(m.locator('[data-bp-maker="' + VA + '"]')).toHaveAttribute('data-bp-scope', 'whole');
});

test('owner 16 Nov — «تعديل السعر»: the amount takes several digits in a row (the redraw keeps the focus), and «نسبة إبتكر» +10 moves 40% to 50% (points), the maker price keeps «نسبة % / قيمة»', async ({ page }) => {
  await openProducts(page);
  await rowOf(page, 'Cushion').locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  const m = page.locator('.modal.bp-modal');
  await expect(m.getByRole('radio', { name: 'نسبة %' })).toHaveCount(1); // «سعر المبتكر»
  await m.getByRole('radio', { name: 'نسبة إبتكر' }).click();
  await expect(m.getByRole('radio', { name: 'نسبة %' })).toHaveCount(0);
  const amt = m.locator('#amount');
  await amt.click(); await amt.press('Control+a'); await amt.press('Backspace');
  await page.keyboard.type('12'); // two keys, one after the other, no click between
  await expect(amt).toHaveValue('12');
  await expect(amt).toBeFocused();
  await amt.press('Backspace'); await page.keyboard.type('0');
  await expect(amt).toHaveValue('10');
  const mk = m.locator('[data-bp-maker]').first();
  const line = mk.locator('[data-bp-line="general"]');
  const [from, to] = (await line.locator('.bp-fromto').innerText()).split('←').map((x) => parseFloat(x));
  expect(to).toBe(from + 10);
});

test('owner 16 Nov — «فلتر الشجرة»: the product page\'s categories come from the site\'s tree (search, + / −, a sub ticks its parents), not a list of paths; «احفظ على الموقع» sends them', async ({ page }) => {
  await openProducts(page);
  await page.locator('[data-pedit="9001"]').click();
  await expect(page.locator('#e-en')).toHaveValue('Cushion');
  await page.getByRole('tab', { name: 'الأقسام' }).click();
  const f = page.locator('#pg-products #e-addcat');
  await expect(f).toHaveAttribute('data-cat-field', '');
  await f.click();
  const tree = page.locator('.cat-pick');
  await expect(tree.getByRole('checkbox', { name: 'هدايا' })).toBeVisible();
  await page.locator('.modal input[type=search]').fill('أباج');
  await tree.getByRole('checkbox', { name: 'أباجورات' }).click(); // the sub ticks إضاءة and ديكور above it
  await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await expect(f).toContainText('أباجورات');
  await page.getByRole('button', { name: 'احفظ على الموقع' }).first().click();
  await expect.poll(() => { const w = mock.productWrites.at(-1); return w && w.fields && w.fields.categories ? [...w.fields.categories].sort((a, b) => a - b) : null; }).toEqual(expect.arrayContaining([151, 152]));
});

test('owner 16 Nov — the bulk actions follow the filter: nothing ticked → every product the filter shows («كل المتفلتر — N منتج»), ticked ones → those alone; no filter and nothing ticked → no bar', async ({ page }) => {
  await openProducts(page);
  await expect(page.locator('#pg-products .bulk-bar')).toHaveCount(0); // the whole catalog, nothing ticked
  const fbtn = page.locator('#pg-products [data-fm-btn="products"]'); const fm = page.locator('[data-fm-menu="products"]');
  await fbtn.click(); await fm.locator('[data-fm-tab="brand"]').click(); await fm.locator('[data-fm="brand:Antikiano"]').click();
  await fm.locator('[data-fm-apply]').dispatchEvent('click');
  const bar = page.locator('#pg-products .bulk-bar');
  await expect(bar).toHaveAttribute('data-pbulk', 'filtered');
  await expect(bar.locator('[data-pbulk-scope]')).toContainText('كل المتفلتر — 2 منتج');
  await expect(bar.getByRole('button', { name: 'إلغاء التحديد' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'تعديل السعر' }).click();
  await expect(page.locator('.modal.bp-modal')).toContainText(/تعديل سعر (2 منتجات|منتج)/);
  await page.locator('.modal.bp-modal').getByRole('button', { name: 'إلغاء' }).click();
  // one ticked → that one alone
  await page.locator('#pg-products table tbody tr').first().locator('[role=checkbox]').click();
  await expect(bar).toHaveAttribute('data-pbulk', 'picked');
  await expect(bar.locator('[data-pbulk-scope]')).toHaveText('محدد 1');
  await expect(bar.getByRole('button', { name: 'إلغاء التحديد' })).toBeVisible();
  await bar.getByRole('button', { name: 'إلغاء التحديد' }).click();
  await expect(bar).toHaveAttribute('data-pbulk', 'filtered');
});
