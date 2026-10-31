import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The images tool (phase 5.4 T8, docs/superpowers/plans/2026-10-31-phase-5-4-images.md): the «الصور» card and the product page's
// «ولّد صور بالذكاء الاصطناعي» open it; words → images, a product's photo → images, an edit of a product's photo; the credits
// before the call; «احفظ على المنتج» through product_images_add after a confirmation; «سجل الصور»; the admin's image settings; the
// permissions. Mock only: the cases assert what the mock recorded (imgCalls, aiRuns, productWrites, imgObjects).
const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local'; const ADMIN = 'admin.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002';
const SKU = 'IBTA4040PAHC000013'; // the mirror's Cushion (9001)
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  mock.products.find((p) => p.id === 9001).image_url = 'https://ibtekr.stage.test/wp-content/uploads/cushion.jpg'; // an https photo the server may fetch
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function openProducts(page, email = OPS) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await expect(page.locator('#pg-products .pr-table')).toBeVisible();
}
const openTool = async (page) => { await page.getByRole('tab', { name: 'إضافة' }).click(); await page.locator('[data-tool="images"]').click(); await expect(page).toHaveURL(/#products-tool-images$/); };

test('words → images: the card opens the tool; the shape, the count and the model → one create call with the credits shown first; the results under the member; «احفظ على المنتج» by SKU after a confirmation → product_images_add; the history', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('#pg-products')).toContainText('لسه مفيش صور');
  await page.getByRole('tab', { name: 'نص لصورة' }).click();
  await page.locator('[data-igrun]').click();
  await expect(page.locator('[data-igprob]')).toHaveText('اكتب وصف الصورة'); // nothing sent without words
  expect(mock.imgCalls).toEqual([]);
  await page.fill('#ig-prompt', 'a macrame bag on a rattan chair');
  await page.locator('[data-igshape="home"]').click(); await page.locator('[data-igcount="2"]').click();
  await expect(page.locator('[data-igcost]')).toContainText('150 كريدت');
  await page.locator('#ig-model').click(); await page.getByRole('option', { name: /Nano Banana 2.1/ }).click();
  await expect(page.locator('[data-igcost]')).toContainText('100 كريدت');
  await page.locator('[data-igrun]').click();
  await expect(page.locator('.ig-it')).toHaveCount(2);
  expect(mock.imgCalls).toEqual([{ action: 'create', by: OPS, source: 'text', shape: 'home', prompt: 'a macrame bag on a rattan chair', count: 2, model: 'imagen-nano-banana-2-1', size: '700x800' }]);
  expect([...mock.imgObjects.keys()].every((k) => k.startsWith(OPS_ID + '/'))).toBe(true);
  await expect(page.locator('#pg-products')).toContainText('100 كريدت');
  await expect(page.locator('.ig-it img').first()).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/ai-images\//); // the signed URL landed
  // save on a product: the SKU names it, the confirmation, then one product_images_add with the two paths
  await page.locator('[data-igsave]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('اكتب SKU');
  await page.fill('#ig-sku', SKU);
  await expect(page.locator('#pg-products')).toContainText('Cushion');
  await page.locator('[data-igsave]').click();
  await expect(page.locator('.modal')).toContainText('تحفظ 2 صورة على «Cushion»');
  await page.locator('.modal [role=checkbox]').click(); // «خليها في الأول»
  await page.locator('[data-igsave-ok]').click();
  await expect.poll(() => (mock.productWrites || []).map((w) => [w.action, w.by, w.id, w.paths.length, w.first])).toEqual([['product_images_add', OPS, 9001, 2, true]]);
  expect(mock.productWrites[0].paths).toEqual([...mock.imgObjects.keys()]);
  expect(mock.products.find((p) => p.id === 9001).image_count).toBe(5);
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.images.add').map((x) => x.new_value)).toEqual(['#9001 · 2 images first']);
  // «سجل الصور»: the run with its credits; «افتح» brings the images back
  await page.locator('[data-ihistory]').click();
  await expect(page.locator('.modal')).toContainText('a macrame bag');
  await expect(page.locator('.modal')).toContainText('100');
  await page.locator('.modal [data-ihopen="1"]').click();
  await expect(page.locator('.ig-it')).toHaveCount(2);
});

test('a product\'s photo → images (source image + product_id), an edit of the product\'s photo (upscale → one image), a refusal shown, the product page button opens the tool on the product', async ({ page }) => {
  await openProducts(page);
  await openTool(page);
  await page.fill('#ig-sku', SKU);
  await page.locator('[data-igshape="detail"]').click();
  await page.locator('[data-igrun]').click();
  await expect(page.locator('.ig-it')).toHaveCount(1);
  expect(mock.imgCalls.at(-1)).toEqual({ action: 'create', by: OPS, source: 'image', shape: 'detail', count: 1, model: 'seedream-5-pro', size: '700x800', product_id: 9001 });
  await expect(page.locator('#pg-products')).toContainText('لـ «Cushion»');
  // the edit tab on the same product
  await page.getByRole('tab', { name: 'تعديل الصورة' }).click();
  await page.locator('[data-igop="upscale"]').click();
  await expect(page.locator('[data-igcost]')).toContainText('75 كريدت');
  await page.locator('[data-igrun]').click();
  await expect(page.locator('.ig-it')).toHaveCount(1);
  expect(mock.imgCalls.at(-1)).toEqual({ action: 'edit', by: OPS, op: 'upscale', model: 'seedream-5-pro', options: { scale: 2 }, product_id: 9001 });
  expect(mock.aiRuns.map((r) => [r.action, r.source, r.product_id, r.status, r.credits])).toEqual([['image', 'tool', 9001, 'ok', 75], ['image', 'edit', 9001, 'ok', 75]]);
  // the AI refusing → the message, nothing stored
  mock.imgFail = 'refused';
  await page.locator('[data-igrun]').click();
  await expect(page.locator('#pg-products')).toContainText('الـ AI رفض الطلب ده');
  expect(mock.imgObjects.size).toBe(2);
  mock.imgFail = null;
  // from the product page: «ولّد صور بالذكاء الاصطناعي» in the images tab opens the tool on that product
  await page.evaluate(() => { location.hash = 'products-edit-9001-images'; });
  await expect(page).toHaveURL(/#products-edit-9001-images$/);
  await expect(page.locator('[data-pimg]')).toBeVisible();
  await page.locator('[data-pimg]').click();
  await expect(page).toHaveURL(/#products-tool-images-9001$/);
  await expect(page.locator('#ig-sku')).toHaveValue(SKU);
  await expect(page.locator('#pg-products')).toContainText('Cushion');
});

test('permissions and settings: accounts sees «محتاج صلاحية» and an empty tool; the admin\'s «إعدادات الصور» shows the month\'s credits and saves the default model and the credit cap into the row «ai»', async ({ page }) => {
  await openProducts(page, ACCOUNTS);
  await page.getByRole('tab', { name: 'إضافة' }).click();
  await expect(page.locator('[data-tool="images"]')).toContainText('محتاج صلاحية');
  await page.goto('/#products-tool-images');
  await expect(page.locator('#pg-products')).toContainText('مش مسموحلك تستخدم أداة الصور');
  await page.evaluate(() => window.IBAuth && window.IBAuth.signOut ? window.IBAuth.signOut() : null).catch(() => {});
  await openProducts(page, ADMIN);
  await openTool(page);
  await page.locator('[data-img-settings]').click();
  await expect(page.locator('.modal [data-img-spend]')).toContainText('كريدت الشهر ده');
  await page.locator('.modal #img-def-model').click(); await page.getByRole('option', { name: /Nano Banana 2 Lite/ }).click();
  await page.fill('.modal #img-cap', '5000');
  await page.locator('[data-img-save]').click();
  await expect(page.locator('.modal')).toBeHidden();
  expect(mock.settings.find((s) => s.section === 'ai').data).toEqual({ image_model: 'imagen-nano-banana-2-lite', image_monthly_credits: 5000 });
  await expect(page.locator('#ig-model')).toContainText('Nano Banana 2 Lite'); // the tool's model follows
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.ai.image.settings').map((x) => x.new_value)).toEqual(['imagen-nano-banana-2-lite · 5000 credits']);
});
