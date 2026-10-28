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
  await expect(page.locator('#pg-products')).toContainText('نسبة المبتكر مش ظاهرة لك'); // ops: sensitive.commission N
  await page.locator('#rate-box').getByRole('button', { name: 'تغيير' }).click();
  await page.fill('#r', '30'); await page.fill('#f', '0'); await page.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await next(page, 'التالي: الاستلام');
  await expect(page).toHaveURL(/#products-studio-0b6f2f5e-1d2c-4a8b-9e3f-000000000001-2$/);
  expect(mock.studioBatches[0].state.brandName).toBe('Art Craft');
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
  expect(mock.activity.some((a) => a.action === 'product.create')).toBe(true);
  await page.getByRole('button', { name: 'روح للسجل' }).click();
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفعت');
});

test('studio Variable: colors and sizes become variations with their own SKU and price; a refused product is reported with its reason and «جرّب تاني» uploads only it', async ({ page }) => {
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
  mock.studioFail = { 1: 'product_invalid_sku' };
  await next(page, 'ارفع على الموقع (مسودة)');
  await expect(page.locator('.modal')).toContainText('الـ SKU ده موجود على الموقع');
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 1 من 2');
  const v = mock.studioUploads[0];
  expect([v.sku, v.product.type, v.variations.map((x) => x.sku)]).toEqual(['IBTAR0999', 'variable', ['IBTARBE0999-5050', 'IBTARBE0999-4040', 'IBTARBK0999-5050', 'IBTARBK0999-4040']]);
  expect(v.variations[0].sale_price).toBe('2860'); // 2000 ÷ 0.7 = 2857.1 → 2860
  mock.studioFail = {};
  await page.getByRole('button', { name: 'جرّب تاني' }).click();
  await page.locator('.modal').getByRole('button', { name: 'شوف التقرير' }).click();
  await expect(page.locator('#pg-products')).toContainText('اترفع 2 من 2');
  expect(mock.studioUploads.map((x) => x.index)).toEqual([0, 1, 1]); // the first product was not uploaded again
  expect(mock.serialTakes).toEqual([2]); // the serials stay with their products
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
