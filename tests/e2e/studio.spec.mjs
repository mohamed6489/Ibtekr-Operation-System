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
  expect([...mock.studioObjects.keys()].every((k) => k.startsWith('0b6f2f5e-1d2c-4a8b-9e3f-000000000001/') && k.endsWith('.webp'))).toBe(true);
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

test('studio Variable: colors and sizes become variations with their own SKU and price; a refused product is reported with its reason, a maker that did not stick and a brand missing from the site\'s brands are noted, and «جرّب تاني» uploads only those', async ({ page }) => {
  await signIn(page, OPS);
  await page.locator('#pg-products').getByRole('button', { name: '+ دفعة منتجات جديدة' }).click();
  await page.getByRole('radio', { name: /^Variable/ }).click();
  await page.getByRole('button', { name: 'المقاس' }).click(); // vary by color and size
  await page.locator('#w-brand').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click(); await page.fill('#r', '30'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await pick(page, /اختار الشيت/, { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Colors,Sizes\nKilim Pouf,2000,"Beige, Black",50×50 / 40×40\nTote,500,White,\n') });
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
  mock.studioFail = { 1: 'product_invalid_sku' }; mock.studioAuthorFail = { 0: true };
  mock.wooBrands = mock.wooBrands.filter((b) => b.name !== 'Art Craft'); // decision 5: no site brand named like the batch's
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('الـ SKU ده موجود على الموقع');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 2');
  const v = mock.studioUploads[0];
  expect([v.sku, v.product.type, v.variations.map((x) => x.sku)]).toEqual(['IBTAR0999', 'variable', ['IBTARBE0999-5050', 'IBTARBE0999-4040', 'IBTARBK0999-5050', 'IBTARBK0999-4040']]);
  expect(v.variations[0].sale_price).toBe('2860'); // 2000 ÷ 0.7 = 2857.1 → 2860
  await expect(page.locator('#pg-products')).toContainText('المبتكر ماتحطش');
  await expect(page.locator('#pg-products')).toContainText('البراند مش موجود في براندات الموقع');
  expect('brands' in v.product).toBe(false); // the pa_brand attribute only
  mock.studioFail = {}; mock.studioAuthorFail = {};
  await page.getByRole('button', { name: 'جرّب تاني' }).first().click();
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 2 من 2');
  await expect(page.locator('#pg-products')).not.toContainText('المبتكر ماتحطش');
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
  await pick(page, /اختار الشيت/, { name: 'v.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Colors\nKilim Pouf,2000,"Beige, Black"\n') });
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
  await pick(page, /اختار الشيت/, { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Color\nDesk Lamp,900,Beige\n') });
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
  await pick(page, /اختار الشيت/, { name: 'one.csv', mimeType: 'text/csv', buffer: Buffer.from('Name EN,Vendor Price,Color\nDesk Lamp,900,Beige\n') });
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
