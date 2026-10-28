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
  await expect(page.locator('#pg-products')).toBeVisible();
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
}
const rowOf = (page, name) => page.locator('#pg-products .pr-table tbody tr').filter({ has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });

test('records: the English rows with their Arabic name, brand, maker, category path, stock and status; the trash and the translation are not records', async ({ page }) => {
  await openProducts(page);
  await expect(page).toHaveURL(/#products-records$/);
  const rows = page.locator('#pg-products .pr-table tbody tr');
  await expect(rows).toHaveCount(4);
  const cushion = rowOf(page, 'Cushion');
  await expect(cushion).toContainText('كيس مخدة');
  await expect(cushion).toContainText('Art Craft');
  await expect(cushion).toContainText('ديكور › إضاءة');
  await expect(cushion).toContainText('منشور');
  await expect(rowOf(page, 'Macrame Curtain')).toContainText('حسب الطلب');
  await expect(rowOf(page, 'Macrame Curtain')).toContainText('Variable');
  await expect(rowOf(page, 'Boho mirror')).toContainText('قيد المراجعة');
  await expect(rowOf(page, 'Macrame Feathers')).toContainText('ناقص');
  await expect(page.locator('[data-pstatus="trash"]')).toHaveText('المهملات 1');
  await expect(page.locator('[data-pstatus="pending"]')).toHaveText('قيد المراجعة 1');
});

test('filters and sort: status chips, brand, «ناقصها بيانات», search by SKU, sort by sales', async ({ page }) => {
  await openProducts(page);
  const rows = page.locator('#pg-products .pr-table tbody tr');
  await page.locator('[data-pstatus="draft"]').click();
  await expect(rows).toHaveCount(1);
  await page.locator('[data-pstatus="all"]').click();
  await page.locator('#pf-brand').click(); await page.getByRole('option', { name: 'البراند: Antikiano' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'مسح الفلاتر' }).click();
  await page.locator('[data-missing]').click();
  await expect(rows).toHaveCount(3); // every product but Cushion lacks its Arabic name (no translation in the seed)
  await expect(rowOf(page, 'Cushion')).toHaveCount(0);
  await page.locator('[data-missing]').click();
  await page.fill('#pg-products input[type=search]', 'ibtk20035');
  await expect(rows).toHaveCount(1);
  await page.fill('#pg-products input[type=search]', '');
  await page.locator('[data-sort-sales]').click();
  await expect(rows.first()).toContainText('Cushion');
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
  await page.locator('.modal #brand').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await page.locator('.modal').getByRole('button', { name: 'انقل المنتجات' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(mock.productWrites.at(-1).update).toEqual([{ id: 9001, brands: [4] }, { id: 9004, brands: [4] }]);
  await expect(rowOf(page, 'Cushion')).toContainText('Antikiano');
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
  await expect(rowOf(page, 'Boho mirror')).toContainText('قيد المراجعة');
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
