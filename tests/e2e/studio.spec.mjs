import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The product studio (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md): a batch from the sheet and the images to
// drafts on the site — the brand, the batch rate, the CSV with its columns matched by name, the images named by row, a new color,
// the price (decision 16), the slots, the categories, the serials reserved at the upload, one studio_upload a product, the report,
// the saved work. Mock only: the cases assert what the mock recorded (studioUploads, serialTakes, studioWrites).
const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page, email) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
}
const pick = async (page, label, files) => { const fc = page.waitForEvent('filechooser'); await page.getByRole('button', { name: label }).click(); (await fc).setFiles(files); };
const next = (page, label) => page.locator('.wiz-foot').getByRole('button', { name: label }).click();

test('studio Simple: brand + batch rate → CSV (columns by name) + images by row → a new color → prices (decision 16) → slots → categories → serials reserved, one studio_upload a product as drafts → the report and the saved work', async ({ page }) => {
  await signIn(page, OPS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  await expect(page).toHaveURL(/#products-studio-new-1$/);
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await expect(page.locator('#pg-products')).toContainText('حرفين الـ SKU: AR');
  await expect(page.locator('#w-vendor')).toContainText('Art Craft'); // the brand's owner by default
  await expect(page.locator('#pg-products')).toContainText('صاحب البراند — تقدر تختار مبتكر تاني');
  await page.locator('#w-vendor').click(); await page.getByRole('option', { name: 'Antikiano' }).click(); // the owner, 28 Oct: another maker
  await expect(page.locator('#w-vendor')).toContainText('Antikiano');
  await expect(page.locator('#pg-products')).toContainText('نسبة المبتكر مش ظاهرة لك'); // ops: sensitive.commission N
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click();
  await page.fill('#r', '30'); await page.fill('#f', '0'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await expect(page).toHaveURL(/#products-studio-0b6f2f5e-1d2c-4a8b-9e3f-000000000001-2$/);
  expect([mock.studioBatches[0].state.brandName, mock.studioBatches[0].vendor_id, mock.studioBatches[0].state.vendorName]).toEqual(['Art Craft', 'a0000000-0000-4000-8000-000000000002', 'Antikiano']);
  await pick(page, /اختار الشيت/, { name: 'art craft.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Name EN,الاسم بالعربي,Vendor Price,Color\nBoho Cushion,مخدة بوهيمي,1000,Beige\nStripe Pillow,مخدة مخططة,800,Purple\n') });
  await expect(page.locator('#pg-products .st-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#pg-products .st-table tbody tr').nth(1)).toContainText('لون مش في الجدول: Purple');
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }, { name: '2-1.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('#pg-products')).toContainText('2 من 2');
  expect([...mock.studioObjects.keys()].every((k) => k.startsWith('0b6f2f5e-1d2c-4a8b-9e3f-000000000001/') && k.endsWith('.jpg'))).toBe(true); // JPEG since phase 5.4 (the provider's references)
  await next(page, 'التالي: البيانات و SKU');
  await page.getByRole('button', { name: '+ لون جديد' }).first().click();
  await page.fill('#en', 'Purple'); await page.fill('#ar', 'بنفسجي');
  await expect(page.locator('#code')).toHaveValue('PU');
  await page.getByRole('button', { name: 'ضيف اللون' }).click();
  await expect(page.locator('#pg-products .st-table tbody tr').nth(1)).toContainText('IBTARPU1000');
  await expect(page.locator('#pg-products .st-table tbody tr').nth(0)).toContainText('IBTARBE0999');
  await next(page, 'التالي: السعر'); // Simple: no variations step
  await expect(page.locator('#pg-products .st-table tbody tr').nth(0)).toContainText('1,430'); // 1000 ÷ 0.7 → up to the next 10
  await next(page, 'التالي: الصور');
  await expect(page.locator('#pg-products .islot.done')).toHaveCount(2); // the main image went to slot 1
  await next(page, 'التالي: الأقسام والأوصاف');
  await page.locator('#pg-products .st-table thead [role=checkbox]').click();
  await page.getByRole('button', { name: 'طبّق قسم على المحدد' }).click();
  await page.locator('.modal').getByText('ديكور', { exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('2 من 2');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 2 من 2 منتج مسودة');
  expect(mock.serialTakes).toEqual([2]);
  expect(mock.studioUploads.map((x) => [x.index, x.sku, x.product.status, x.product.sale_price, x.product.categories, x.images.length, x.ar && x.ar.name])).toEqual([
    [0, 'IBTARBE0999', 'draft', '1430', [{ id: 15 }], 1, 'مخدة بوهيمي'], [1, 'IBTARPU1000', 'draft', '1150', [{ id: 15 }], 1, 'مخدة مخططة']]);
  expect(mock.studioUploads[0].product.attributes[0]).toEqual({ id: 12, visible: true, variation: false, options: ['Beige'] });
  expect(mock.studioUploads.map((x) => x.product.brands)).toEqual([[{ id: 3 }], [{ id: 3 }]]); // decision 5: the site's WooCommerce brand named like the batch's
  expect(mock.products.filter((p) => /^IBTAR(BE0999|PU1000)$/.test(p.sku)).map((p) => p.vendor_id)).toEqual(['a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002']); // the chosen maker, not the brand's owner
  expect(mock.activity.some((a) => a.action === 'product.create')).toBe(true);
  await page.getByRole('button', { name: 'روح للسجل' }).click();
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفعت');
});

test('studio: the type changes after the sheet was read → the colors and sizes come from the sheet again (all of them for Variable, the first for Simple)', async ({ page }) => {
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام'); // Simple: the sheet keeps the first color and the first size of each row
  await pick(page, /اختار الشيت/, { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Name AR,Vendor Price,Colors,Sizes\nKilim Pouf,بوف كليم,2000,"Beige, Black",50×50 / 40×40\n') });
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('BE'); // the colors by code in «الاستلام»
  await expect(page.locator('#pg-products .st-table tbody tr').first()).not.toContainText('BK');
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('#pg-products')).toContainText('1 من 1');
  await page.locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await page.getByRole('radio', { name: /^Variable/ }).click();
  await page.getByRole('button', { name: 'المقاس' }).click();
  await next(page, 'التالي: الاستلام');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('BK');
  await next(page, 'التالي: البيانات و SKU');
  await next(page, 'التالي: المتغيرات');
  await expect(page.locator('#pg-products .row-sub')).toHaveCount(4); // 2 colors × 2 sizes
  await page.locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await page.locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await page.locator('.wiz-foot').getByRole('button', { name: 'رجوع' }).click();
  await page.getByRole('radio', { name: /^Simple/ }).click(); // back to Simple: the first of each again
  await next(page, 'التالي: الاستلام');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('BE');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).not.toContainText('BK');
});

test('studio Variable from the owner\'s sheet shape (decision 16): rows sharing a unique id = one product, the first row the parent and the next ones its variations with their own price and stock; a lone row keeps colors × sizes', async ({ page }) => {
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.getByRole('radio', { name: /^Variable/ }).click();
  await page.getByRole('button', { name: 'المقاس' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  // the owner's shape: every row of a group is a variation (the first too) and repeats the product data; the category as a path
  await pick(page, /اختار الشيت/, { name: 'grouped.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Name EN,Product Name AR,Vendor Price,Product Colors,size,Stock,Parent SKU,Product Category,Short Description AR\nKilim Pouf,بوف كليم,2000,Beige,50×50,3,P1,Home > هدايا,بوف يدوي\nKilim Pouf,بوف كليم,2200,Black,40×40,,P1,Home > هدايا,بوف يدوي\nTote,شنطة قماش,500,White,,2,P2,,\n') });
  await expect(page.locator('#pg-products .st-table tbody tr')).toHaveCount(2); // two products, not three rows
  await expect(page.locator('#map-group')).toContainText('Parent SKU'); // the id column matched by name
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }, { name: '2-1.png', mimeType: 'image/png', buffer: PNG }]);
  await next(page, 'التالي: البيانات و SKU');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('2 تركيبة من الشيت');
  await next(page, 'التالي: المتغيرات');
  await expect(page.locator('#pg-products .row-sub')).toHaveCount(3); // Beige·50×50 + Black·40×40 (listed, not 2 × 2) + Tote's White
  await expect(page.locator('#pg-products')).toContainText('IBTARBK0999-4040');
  await expect(page.locator('#pg-products')).toContainText('3,150'); // Black at its own maker price: 2200 ÷ 0.7 → 3,150
  await next(page, 'التالي: السعر');
  await next(page, 'التالي: الصور');
  await next(page, 'التالي: الأقسام والأوصاف');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('هدايا'); // the category came from the sheet's path
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('بوف يدوي'); // and the Arabic short description
  await page.locator('#pg-products .st-table tbody tr').nth(1).getByRole('button', { name: '+ قسم' }).click(); // Tote had no category in the sheet
  await page.locator('.modal').getByText('هدايا', { exact: true }).click(); await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  await next(page, 'ارفع على الموقع (مسودة)');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 2 من 2');
  const v = mock.studioUploads[0];
  expect(v.variations.map((x) => [x.sku, x.sale_price, x.stock_quantity ?? null])).toEqual([['IBTARBE0999-5050', '2860', 3], ['IBTARBK0999-4040', '3150', null]]);
  expect(v.product.categories.map((c) => c.id)).toContain(mock.wooCategories.find((c) => c.name === 'هدايا').id);
  expect(mock.studioUploads[1].variations.map((x) => x.sku)).toEqual(['IBTARWH1000']);
});

test('studio Variable: colors and sizes become variations with their own SKU and price; a refused product is reported with its reason, a maker that did not stick and a brand missing from the site\'s brands are noted, and «جرّب تاني» uploads only those', async ({ page }) => {
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.getByRole('radio', { name: /^Variable/ }).click();
  await page.getByRole('button', { name: 'المقاس' }).click(); // vary by color and size
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Name AR,Vendor Price,Colors,Sizes\nKilim Pouf,بوف كليم,2000,"Beige, Black",50×50 / 40×40\nTote,شنطة قماش,500,White,\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }, { name: '2-1.png', mimeType: 'image/png', buffer: PNG }]);
  await next(page, 'التالي: البيانات و SKU');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('IBTAR0999'); // the parent has no color
  await next(page, 'التالي: المتغيرات');
  await expect(page.locator('#pg-products .row-sub')).toHaveCount(5); // 2 colors × 2 sizes + White
  await expect(page.locator('#pg-products')).toContainText('IBTARBK0999-4040');
  await next(page, 'التالي: السعر');
  await next(page, 'التالي: الصور');
  await next(page, 'التالي: الأقسام والأوصاف');
  await page.locator('#pg-products .st-table thead [role=checkbox]').click();
  await page.getByRole('button', { name: 'طبّق قسم على المحدد' }).click();
  await page.locator('.modal').getByText('هدايا', { exact: true }).click(); await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  mock.studioFail = { 1: 'product_invalid_sku' }; mock.studioAuthorFail = { 0: true }; mock.studioArFail = { 0: true };
  mock.wooBrands = mock.wooBrands.filter((b) => b.name !== 'Art Craft'); // decision 5: no site brand named like the batch's
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('الـ SKU ده موجود على الموقع');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 2');
  const v = mock.studioUploads[0];
  expect([v.sku, v.product.type, v.variations.map((x) => x.sku)]).toEqual(['IBTAR0999', 'variable', ['IBTARBE0999-5050', 'IBTARBE0999-4040', 'IBTARBK0999-5050', 'IBTARBK0999-4040']]);
  expect(v.variations[0].sale_price).toBe('2860'); // 2000 ÷ 0.7 = 2857.1 → 2860
  await expect(page.locator('#pg-products')).toContainText('المبتكر ماتحطش');
  await expect(page.locator('#pg-products')).toContainText('الترجمة العربية ماتعملتش — الموقع قال: Language ar is not active.'); // the site's answer, and «جرّب تاني» on that row
  await expect(page.locator('#pg-products .st-table tbody tr').first().getByRole('button', { name: 'جرّب تاني' })).toBeVisible();
  await expect(page.locator('#pg-products')).toContainText('البراند مش موجود في براندات الموقع');
  expect('brands' in v.product).toBe(false); // the pa_brand attribute only
  mock.studioFail = {}; mock.studioAuthorFail = {}; mock.studioArFail = {};
  await page.getByRole('button', { name: 'جرّب تاني' }).first().click();
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 2 من 2');
  await expect(page.locator('#pg-products')).not.toContainText('المبتكر ماتحطش');
  await expect(page.locator('#pg-products')).not.toContainText('الترجمة العربية ماتعملتش');
  expect(mock.studioUploads.map((x) => x.index)).toEqual([0, 1, 0, 1]); // the first asked again for its maker only (the server repeats nothing)
  expect(mock.products.filter((p) => p.sku === 'IBTAR0999')).toHaveLength(1);
  expect(mock.serialTakes).toEqual([2]); // the serials stay with their products
});

test('studio: the maker changed after an upload — a note in «البداية», «ارفع على الموقع» sends again the products on another maker, a Variable whose variations were made is refused with its reason and stays on its maker, and the maker back makes it whole', async ({ page }) => {
  const rate = async () => { await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click(); };
  const maker = async (name) => { await page.getByRole('button', { name: 'الخطوة 1: البداية' }).click(); await page.locator('#w-vendor').click(); await page.getByRole('option', { name }).click(); };
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.getByRole('radio', { name: /^Variable/ }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await rate();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Name AR,Vendor Price,Colors\nKilim Pouf,بوف كليم,2000,"Beige, Black"\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }]);
  for (const s of ['البيانات و SKU', 'المتغيرات', 'السعر', 'الصور', 'الأقسام والأوصاف']) await next(page, 'التالي: ' + s);
  await page.locator('#pg-products .st-table thead [role=checkbox]').click();
  await page.getByRole('button', { name: 'طبّق قسم على المحدد' }).click();
  await page.locator('.modal').getByText('هدايا', { exact: true }).click(); await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  await next(page, 'ارفع على الموقع (مسودة)');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 1');
  await page.getByRole('button', { name: 'رجوع للمراجعة' }).click();
  await maker('Antikiano');
  await expect(page.locator('#pg-products')).toContainText('في منتجات اترفعت على مبتكر تاني');
  await rate(); // ops: the maker's rate is not shown, the batch rate again
  await page.getByRole('button', { name: 'الخطوة 8: المراجعة والرفع' }).click();
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('المبتكر اتغيّر بعد ما التركيبات اتعملت');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 0 من 1');
  await expect(page.locator('#pg-products')).toContainText('المنتج فاضل على المبتكر القديم');
  expect(mock.products.filter((p) => p.sku === 'IBTAR0999').map((p) => p.vendor_id)).toEqual(['a0000000-0000-4000-8000-000000000001']); // still Art Craft's
  await page.getByRole('button', { name: 'رجوع للمراجعة' }).click();
  await maker('Art Craft');
  await expect(page.locator('#pg-products')).not.toContainText('في منتجات اترفعت على مبتكر تاني');
  await rate();
  await page.getByRole('button', { name: 'الخطوة 8: المراجعة والرفع' }).click();
  await next(page, 'ارفع على الموقع (مسودة)');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 1');
  expect(mock.studioUploads.map((x) => [x.index, x.maker])).toEqual([[0, 'a0000000-0000-4000-8000-000000000001'], [0, 'a0000000-0000-4000-8000-000000000002'], [0, 'a0000000-0000-4000-8000-000000000001']]);
});

test('studio: a product on the site keeps the SKU it was made with (decision 2) — «البداية» locks the brand with the reason; the brand renamed elsewhere to other letters, or a Simple\'s color edited, makes «ارفع على الموقع» refused with its reason and nothing written, the page showing the site\'s SKU; back as it was → it goes on', async ({ page }) => {
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Name AR,Vendor Price,Color\nDesk Lamp,أباجورة مكتب,900,Beige\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }]);
  for (const s of ['البيانات و SKU', 'السعر', 'الصور', 'الأقسام والأوصاف']) await next(page, 'التالي: ' + s);
  await page.locator('#pg-products .st-table thead [role=checkbox]').click();
  await page.getByRole('button', { name: 'طبّق قسم على المحدد' }).click();
  await page.locator('.modal').getByText('هدايا', { exact: true }).click(); await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  mock.studioAuthorFail = { 0: true }; // the maker does not stick: «ارفع على الموقع» sends it again
  const upload = async (why) => { await next(page, 'ارفع على الموقع (مسودة)'); if (why) await expect(page.locator('.modal')).toContainText(why); await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click(); await page.getByRole('button', { name: 'رجوع للمراجعة' }).click(); };
  const color = async (name) => { await page.getByRole('button', { name: 'الخطوة 3: البيانات و SKU' }).click(); await page.locator('#pg-products .st-table tbody').getByRole('button', { name: 'عدّل' }).click();
    await page.locator('.modal').getByRole('button', { name }).click(); await page.locator('.modal').getByRole('button', { name: 'احفظ' }).click(); };
  await upload(null);
  mock.studioAuthorFail = {};
  await page.getByRole('button', { name: 'الخطوة 1: البداية' }).click();
  await expect(page.locator('#w-brand')).toBeDisabled();
  await expect(page.locator('#pg-products')).toContainText('اتقفل: في منتجات من الدفعة اترفعت على الموقع');
  await expect(page.locator('#w-vendor')).toBeEnabled(); // the maker can still change (decision 9)
  const brand = mock.brands.find((x) => x.name === 'Art Craft');
  brand.name = 'Crafty Art'; // renamed on the vendors page: CR
  await page.getByRole('button', { name: 'الخطوة 7: المراجعة والرفع' }).click();
  await upload('البراند اتغيّر بعد ما المنتج اترفع');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('IBTARBE0999');
  brand.name = 'Art Craft';
  await color('Black · BK');
  const row = page.locator('#pg-products .st-table tbody tr').first();
  await expect(row).toContainText('IBTARBE0999'); // the SKU on the site, not the batch's IBTARBK0999
  await expect(row).not.toContainText('IBTARBK0999');
  await page.getByRole('button', { name: 'الخطوة 7: المراجعة والرفع' }).click();
  await upload('بيانات المنتج اتغيّرت بعد ما اترفع');
  await color('Beige · BE');
  await page.getByRole('button', { name: 'الخطوة 7: المراجعة والرفع' }).click();
  await next(page, 'ارفع على الموقع (مسودة)');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 1');
  await expect(page.locator('#pg-products')).not.toContainText('المبتكر ماتحطش');
  expect(mock.studioUploads.map((x) => [x.sku, x.result])).toEqual([['IBTARBE0999', 'ok'], ['IBTCRBE0999', 'brand_changed'], ['IBTARBK0999', 'sku_changed'], ['IBTARBE0999', 'ok']]);
  expect([mock.studioBatches[0].result.items[0].sku, mock.products.filter((p) => /^IBT[A-Z]{4}0999$/.test(p.sku)).map((p) => p.sku)]).toEqual(['IBTARBE0999', ['IBTARBE0999']]);
});

test('studio: a maker without a store on the site is refused; a Google Sheet link is read by the server (a wrong link before any request, an unpublished sheet explained), and «حدّث من اللينك» keeps the column mapping', async ({ page }) => {
  mock.vendors.push({ ...mock.vendors[0], id: 'a0000000-0000-4000-8000-000000000009', woo_vendor_id: null, name: 'Zeta Maker', aliases: [], raw: {} });
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#w-vendor').click(); await page.getByRole('option', { name: 'Zeta Maker (مالوش متجر على الموقع)' }).click();
  await expect(page.locator('#pg-products')).toContainText('المبتكر ده مالوش متجر على الموقع — اختار مبتكر ليه متجر');
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: الاستلام' })).toBeDisabled();
  await page.locator('#w-vendor').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await page.fill('#sheet-link', 'https://example.com/sheet.csv');
  await page.getByRole('button', { name: 'اقرا من اللينك' }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('ده مش لينك Google Sheet');
  expect(mock.sheetReads).toEqual([]); // refused before any request
  const LINK = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTq3x9Abc_def-GHIjkLMNopQRstuVWxyz0123456789/pubhtml';
  await page.fill('#sheet-link', LINK);
  await page.getByRole('button', { name: 'اقرا من اللينك' }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('الشيت مش منشور');
  mock.sheetLinks[LINK] = { csv: 'Name EN,Name AR,Vendor Price,Color,Notes\nStudio Test Cushion,مخدة تجربة,500,Beige,x\n' };
  await page.getByRole('button', { name: 'اقرا من اللينك' }).click();
  await expect(page.locator('#pg-products .st-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#pg-products .file-row')).toContainText('Google Sheet');
  expect(mock.sheetReads).toEqual([LINK, LINK]);
  await page.locator('#map-colors').click(); await page.getByRole('option', { name: '— مش في الشيت —' }).click(); // a hand-made mapping
  mock.sheetLinks[LINK] = { csv: 'Name EN,Name AR,Vendor Price,Color,Notes\nStudio Test Cushion,مخدة تجربة,500,Beige,x\nStudio Test Lamp,أباجورة تجربة,700,Black,y\n' };
  await page.getByRole('button', { name: 'حدّث من اللينك' }).click();
  await expect(page.locator('#pg-products .st-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#map-colors')).toContainText('— مش في الشيت —'); // the same headers: the mapping stays
  await expect.poll(() => (mock.studioBatches[0].state.sheet || {}).link).toBe(LINK);
});

test('studio permission: without products.add the studio does not open and the saved work is not shown', async ({ page }) => {
  await signIn(page, ACCOUNTS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await expect(page.locator('#pg-products')).toContainText('محتاج صلاحية');
  await expect(page.locator('#pg-products')).not.toContainText('الشغل المحفوظ');
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  await expect(page).not.toHaveURL(/products-studio/);
  await page.goto('/#products-studio-new-1');
  await expect(page.locator('#pg-products')).toContainText('مش مسموحلك تضيف منتجات');
});

test('studio categories (decision 14): the site\'s tree with + / −, a sub-category ticks the ones above it and takes them back off, the search opens the branch, the main one can go alone', async ({ page }) => {
  await signIn(page, OPS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click();
  await page.fill('#r', '30'); await page.fill('#f', '0'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Name AR,Vendor Price,Color\nDesk Lamp,أباجورة مكتب,900,Beige\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }]);
  await next(page, 'التالي: البيانات و SKU');
  await next(page, 'التالي: السعر');
  await next(page, 'التالي: الصور');
  await next(page, 'التالي: الأقسام والأوصاف');
  await page.locator('#pg-products .st-table tbody').getByRole('button', { name: '+ قسم', exact: true }).click();
  const md = page.locator('.modal');
  await expect(md.locator('[data-cat-pick]')).toHaveCount(2); // the main categories only (ديكور، هدايا)
  await md.getByRole('button', { name: 'افتح أقسام ديكور' }).click();
  await md.getByRole('button', { name: 'افتح أقسام إضاءة' }).click();
  await md.getByRole('checkbox', { name: 'أباجورات', exact: true }).click();
  await expect(md.getByRole('checkbox', { name: 'ديكور', exact: true })).toHaveAttribute('aria-checked', 'true'); // ticked by itself
  await expect(md.getByRole('checkbox', { name: 'إضاءة', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(md.locator('.cat-chosen .chip')).toHaveCount(3);
  await md.getByRole('checkbox', { name: 'أباجورات', exact: true }).click(); // the ones it ticked go with it
  await expect(md.locator('.cat-chosen .chip')).toHaveCount(0);
  await md.getByRole('button', { name: 'اقفل أقسام ديكور' }).click();
  await expect(md.locator('[data-cat-pick]')).toHaveCount(2);
  await md.getByRole('searchbox', { name: 'دوّر على قسم' }).fill('أباج');
  await expect(md.locator('[data-cat-pick]')).toHaveCount(3); // the branch down to the match, opened; هدايا hidden
  await md.getByRole('checkbox', { name: 'أباجورات', exact: true }).click();
  await md.getByRole('button', { name: 'شيل ديكور' }).click(); // the main category taken off alone; the sub-categories stay
  await expect(md.locator('.cat-chosen .chip')).toHaveCount(2);
  await md.getByRole('button', { name: 'تمام' }).click();
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('ديكور › إضاءة › أباجورات');
  await next(page, 'التالي: المراجعة والرفع');
  await expect.poll(() => [...mock.studioBatches[0].state.items[0].categories].sort((a, b) => a - b)).toEqual([151, 152]);
});

test('studio Arabic name (decision 15): a sheet without it passes «الاستلام» with a warning, «البيانات و SKU» stops until it is typed, and the upload carries the translation', async ({ page }) => {
  await signIn(page, OPS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click();
  await page.fill('#r', '30'); await page.fill('#f', '0'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'en-only.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Color\nDesk Lamp,900,Beige\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('#pg-products')).toContainText('1 منتج من غير اسم عربي — الاسم العربي إجباري');
  await next(page, 'التالي: البيانات و SKU');
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('الاسم (AR)');
  await expect(page.locator('.wiz-foot').getByRole('button', { name: 'التالي: السعر' })).toBeDisabled();
  await page.locator('#pg-products .st-table tbody').getByRole('button', { name: 'عدّل' }).click();
  await page.locator('.modal').getByRole('button', { name: 'احفظ' }).click(); // still empty: refused
  await expect(page.locator('.modal')).toContainText('اكتب الاسم بالعربي');
  await page.fill('#nameAr', 'أباجورة مكتب');
  await page.locator('.modal').getByRole('button', { name: 'احفظ' }).click();
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('كامل');
  await next(page, 'التالي: السعر');
  await next(page, 'التالي: الصور');
  await next(page, 'التالي: الأقسام والأوصاف');
  await page.locator('#pg-products .st-table thead [role=checkbox]').click();
  await page.getByRole('button', { name: 'طبّق قسم على المحدد' }).click();
  await page.locator('.modal').getByText('هدايا', { exact: true }).click(); await page.locator('.modal').getByRole('button', { name: 'تمام' }).click();
  await next(page, 'التالي: المراجعة والرفع');
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('1 من 1');
  expect(mock.studioUploads.map((x) => x.ar && x.ar.name)).toEqual(['أباجورة مكتب']);
});

test('studio images (phase 5.4): «ولّد» makes a slot\'s image with the AI from the reference (tagged AI), a failure shows on the slot, «ولّد كل الصور الناقصة» asks with the credits, the image popup edits with the AI and keeps the versions, a version goes to another slot, the batch\'s model', async ({ page }) => {
  const SB = '0b6f2f5e-1d2c-4a8b-9e3f-000000000001';
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'i.csv', mimeType: 'text/csv', buffer: Buffer.from('Product Name EN,الاسم بالعربي,Vendor Price,Color\nBoho Cushion,مخدة بوهيمي,1000,Beige\nStripe Pillow,مخدة مخططة,800,Beige\n') });
  await pick(page, /اختار صور المنتجات/, [{ name: '1-1.png', mimeType: 'image/png', buffer: PNG }, { name: '2-1.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('#pg-products')).toContainText('2 من 2');
  await next(page, 'التالي: البيانات و SKU'); await next(page, 'التالي: السعر'); await next(page, 'التالي: الصور');
  await expect(page.locator('#pg-products .islot.done')).toHaveCount(2);
  await expect(page.locator('#img-model')).toContainText('Seedream 5 Pro');
  await expect(page.locator('#pg-products .tot-bar')).toContainText('ناقصة');
  // one slot: the generate call carries the batch, the item, the slot and the batch's model; the image lands tagged AI
  await page.locator('#pg-products .islot.empty').first().getByRole('button', { name: 'ولّد', exact: true }).click();
  await expect(page.locator('#pg-products .islot.done')).toHaveCount(3);
  expect(mock.imgCalls).toEqual([{ action: 'generate', by: OPS, batch_id: SB, index: 0, slot: 1, model: 'seedream-5-pro' }]);
  await expect(page.locator('#pg-products .islot.done .tg', { hasText: 'AI' })).toHaveCount(1);
  await expect(page.locator('#pg-products .st-table tbody tr').first()).toContainText('1 بالـ AI — راجعها');
  await expect.poll(() => (mock.studioBatches[0].state.items[0].slots[1] || '')).toMatch(new RegExp('^' + SB + '/gen-0-1-'));
  expect(mock.studioObjects.has(mock.studioBatches[0].state.items[0].slots[1])).toBe(true);
  // the AI busy → the slot says فشل and offers «ولّد تاني»; the activity never carries a path
  mock.imgFail = 'busy';
  await page.locator('#pg-products .islot.empty').first().getByRole('button', { name: 'ولّد', exact: true }).click();
  await expect(page.locator('#pg-products .islot.fail')).toHaveCount(1);
  await expect(page.locator('#pg-products .islot.fail')).toContainText('فشل');
  await expect(page.locator('#pg-products .islot.fail').getByRole('button', { name: 'ولّد تاني' })).toBeVisible();
  mock.imgFail = null;
  // the batch's model, then all the missing slots at once: 2 × 4 − 3 done = 5 images, asked with the credits
  await page.locator('#img-model').click(); await page.getByRole('option', { name: /Seedream 5 Lite/ }).click();
  await page.locator('#pg-products').getByRole('button', { name: 'ولّد كل الصور الناقصة' }).click();
  await expect(page.locator('.modal')).toContainText('5 صورة · حوالي 250 كريدت');
  await page.locator('.modal').getByRole('button', { name: 'ولّد' }).click();
  await expect(page.locator('#pg-products .islot.done')).toHaveCount(8);
  await expect(page.locator('#pg-products .islot.fail')).toHaveCount(0);
  expect(mock.imgCalls.slice(2).map((c) => [c.index, c.slot, c.model])).toEqual([[0, 2, 'seedream-5-lite'], [0, 3, 'seedream-5-lite'], [1, 1, 'seedream-5-lite'], [1, 2, 'seedream-5-lite'], [1, 3, 'seedream-5-lite']]);
  expect(mock.aiRuns.filter((x) => x.action === 'image' && x.status === 'ok').length).toBe(6);
  await expect(page.locator('#pg-products .tot-bar')).toContainText('8 من 8');
  // the image popup: an AI edit makes a new version (an edit call on the slot's path), the old one is in «النسخ» and comes back
  const before = mock.studioBatches[0].state.items[0].slots[1];
  await page.locator('#pg-products .islot.done').nth(1).locator('.slot-img').click();
  await expect(page.locator('.modal')).toContainText('2 · البيئة المحيطة');
  await expect(page.locator('.modal')).toContainText('المرجعيات');
  await page.locator('.modal').getByRole('button', { name: 'خلفية أفتح' }).click();
  await expect(page.locator('.modal')).toContainText('النسخ');
  expect(mock.imgCalls.at(-1)).toEqual({ action: 'edit', by: OPS, batch_id: SB, index: 0, path: before, op: 'instruction', prompt: 'Make the background lighter and cleaner; keep the product exactly as it is', model: 'seedream-5-lite' });
  await expect.poll(() => (mock.studioBatches[0].state.items[0].slots[1] || '')).toMatch(new RegExp('^' + SB + '/edit-0-'));
  await page.locator('.modal').getByRole('button', { name: 'نسخة 1' }).click();
  await expect.poll(() => mock.studioBatches[0].state.items[0].slots[1]).toBe(before);
  // «حطها في خانة»: the image trades places with slot 3
  const third = mock.studioBatches[0].state.items[0].slots[2];
  await page.locator('.modal').getByRole('button', { name: '3 · Feature' }).click();
  await expect(page.locator('.modal')).toBeHidden();
  await expect.poll(() => mock.studioBatches[0].state.items[0].slots.slice(1, 3)).toEqual([third, before]);
  // the activity rows name the slot, the model and the credits only
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.ai.image').length).toBeGreaterThan(0);
  expect(mock.activityRows.filter((x) => x.action === 'product.ai.image')[0].new_value).toBe('studio · #1 · slot 2 · seedream-5-pro · 75 credits');
  expect(JSON.stringify(mock.activityRows)).not.toContain('/gen-');
  await next(page, 'التالي: الأقسام والأوصاف');
});
