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
  await page.locator('#ig-model').click(); await page.getByRole('option', { name: /Seedream 5 Lite/ }).click();
  await expect(page.locator('[data-igcost]')).toContainText('100 كريدت');
  await page.locator('[data-igrun]').click();
  await expect(page.locator('.ig-it')).toHaveCount(2);
  expect(mock.imgCalls).toEqual([{ action: 'create', by: OPS, source: 'text', shape: 'home', prompt: 'a macrame bag on a rattan chair', count: 2, model: 'seedream-5-lite', size: '700x800' }]);
  expect([...mock.imgObjects.keys()].every((k) => k.startsWith(OPS_ID + '/'))).toBe(true);
  // decision 7: the browser re-encoded both PNG results as WebP and handed them back (action webp, with the run) — the originals are gone
  expect(mock.webpCalls.map((c) => [c.by, c.bucket, /\.png$/.test(c.path), c.bytes > 12, c.run_id])).toEqual([[OPS, 'ai-images', true, true, 1], [OPS, 'ai-images', true, true, 1]]);
  expect([...mock.imgObjects.keys()].map((k) => k.slice(-5))).toEqual(['.webp', '.webp']);
  expect(mock.aiRuns[0].output.paths).toEqual([...mock.imgObjects.keys()]);
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
  await page.locator('[data-img-probe]').click();
  await expect(page.locator('[data-img-probe-out]')).toContainText('متصل ✓'); // the provider's account shape, keys only
  await expect(page.locator('[data-img-probe-out]')).toContainText('"credits":"number"');
  await page.locator('.modal #img-def-model').click(); await page.getByRole('option', { name: /Gemini 2.5 Flash/ }).click();
  await page.fill('.modal #img-cap', '5000');
  await page.locator('[data-img-save]').click();
  await expect(page.locator('.modal')).toBeHidden();
  expect(mock.settings.find((s) => s.section === 'ai').data).toEqual({ image_model: 'gemini-2-5-flash', image_monthly_credits: 5000 });
  await expect(page.locator('#ig-model')).toContainText('Gemini 2.5 Flash'); // the tool's model follows
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.ai.image.settings').map((x) => x.new_value)).toEqual(['gemini-2-5-flash · 5000 credits']);
});

test('not_configured told apart: the secret missing on the server names the secret; the provider refusing the key names the HTTP status (the studio slot and the tool)', async ({ page }) => {
  await openProducts(page, ADMIN);
  await openTool(page);
  await page.getByRole('tab', { name: 'نص لصورة' }).click();
  await page.fill('#ig-prompt', 'a mug');
  mock.imgFail = 'not_configured';
  await page.locator('[data-igrun]').click();
  await expect(page.locator('#pg-products')).toContainText('السر MAGNIFIC_API_KEY مش موجود في أسرار السيرفر');
  mock.imgFail = 'key_refused';
  await page.locator('[data-igrun]').click();
  await expect(page.locator('#pg-products')).toContainText('Magnific رفض المفتاح (HTTP 401)');
  await page.locator('[data-img-settings]').click();
  await page.locator('[data-img-probe]').click();
  await expect(page.locator('[data-img-probe-out]')).toContainText('Magnific رفض المفتاح (HTTP 401)');
  mock.imgFail = null;
});

test('decision 8 — «وارد من Magnific»: a set queued from the site (image_imports) shows on the tool; «استورد» fetches its links into the member\'s folder (0 credits, a run row of source import), the bad link stays out (partial), the results become WebP, «احفظ على المنتج» takes them; an imported set answers done', async ({ page }) => {
  mock.imageImports.push({ id: 1, created_at: '2026-11-01T06:00:00.000Z', created_by: OPS_ID, source: 'magnific', folder: 'ابتكر', label: 'Cushion set', product_id: 9001,
    urls: ['https://pikaso.cdnpk.net/private/production/1/a.jpg?token=exp=1~hmac=x', 'https://pikaso.cdnpk.net/private/production/1/b.png?token=t', 'https://evil.test/c.jpg'], refs: ['A', 'B', 'C'], status: 'pending', paths: null, error: null, run_id: null, done_at: null });
  mock.imageImports.push({ id: 3, created_at: '2026-10-31T06:20:00.000Z', created_by: OPS_ID, source: 'magnific', folder: 'ابتكر', label: 'Failed set', product_id: null, urls: ['https://pikaso.cdnpk.net/private/production/1/q.jpg'], refs: ['Q'], status: 'error', paths: [null], error: 'import_failed', run_id: null, done_at: null });
  mock.imageImports.push({ id: 2, created_at: '2026-11-01T06:10:00.000Z', created_by: '00000000-0000-4000-8000-000000000003', source: 'magnific', folder: 'ابتكر', label: 'Someone else\'s', product_id: null, urls: ['https://pikaso.cdnpk.net/private/production/1/z.jpg'], refs: ['Z'], status: 'pending', paths: null, error: null, run_id: null, done_at: null });
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('#pg-products')).toContainText('وارد من Magnific');
  await expect(page.locator('#pg-products')).toContainText('Cushion set');
  await expect(page.locator('#pg-products')).not.toContainText('Someone else'); // another member's row is not read
  await page.locator('[data-igimport="1"]').click();
  await expect(page.locator('.ig-it')).toHaveCount(2);
  expect(mock.importCalls).toEqual([{ by: OPS, id: 1, target: 'tool' }]);
  expect(mock.imgCalls).toEqual([]); // no provider call, no credits
  await expect(page.locator('#pg-products')).toContainText('وارد من موقع Magnific');
  await expect(page.locator('#pg-products')).toContainText('لـ «Cushion»');
  expect([mock.imageImports[0].status, mock.imageImports[0].paths.length, mock.imageImports[0].paths[2]]).toEqual(['partial', 3, null]);
  expect(mock.aiRuns.map((r) => [r.source, r.credits, r.status, r.output.import_id, r.output.failed])).toEqual([['import', 0, 'ok', 1, 1]]);
  // decision 7 on imports too: the two PNGs became WebP under the member, the run row and the queue row follow
  await expect.poll(() => mock.webpCalls.length).toBe(2);
  expect([...mock.imgObjects.keys()].every((k) => k.startsWith(OPS_ID + '/imp-') && k.endsWith('.webp'))).toBe(true);
  expect(mock.aiRuns[0].output.paths).toEqual([...mock.imgObjects.keys()]);
  // the set stays listed as ناقصة (the bad link); «احفظ على المنتج» works like any result
  await expect(page.locator('#pg-products')).toContainText('ناقصة');
  await page.locator('[data-igsave]').click();
  await expect(page.locator('.modal')).toContainText('تحفظ 2 صورة على «Cushion»');
  await page.locator('[data-igsave-ok]').click();
  await expect.poll(() => (mock.productWrites || []).map((w) => [w.action, w.id, w.paths.length])).toEqual([['product_images_add', 9001, 2]]);
  expect(mock.productWrites[0].paths).toEqual([...mock.imgObjects.keys()]);
  // «سجل الصور» names the source
  await page.locator('[data-ihistory]').click();
  await expect(page.locator('.modal')).toContainText('وارد من Magnific');
  await page.locator('.modal').getByRole('button', { name: 'قفل' }).click();
  // a failed set offers «جرّب تاني» (listed again after the import); one imported in full meanwhile answers done
  await expect(page.locator('[data-igimport="3"]')).toHaveText('جرّب تاني');
  mock.imageImports[1].status = 'ok';
  await page.locator('[data-igimport="3"]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('اتستوردت قبل كده');
});

test('decision 9 — a Magnific set queued for the studio (its items read from the images\' names): «استورد للاستوديو» makes a studio batch with the brand, the items and their photos (no credits, no WebP for the studio\'s references); «افتح الدفعة» lands on step 2 with the products; a partial set is listed as ناقصة', async ({ page }) => {
  const brand = mock.brands[0];
  mock.imageImports.push({ id: 4, created_at: '2026-11-01T07:00:00.000Z', created_by: OPS_ID, source: 'magnific', folder: 'ابتكر', label: 'دفعة أرت كرافت', product_id: null,
    urls: ['https://pikaso.cdnpk.net/private/production/1/a.jpg?token=t', 'https://pikaso.cdnpk.net/private/production/1/b.png?token=t', 'https://evil.test/c.jpg'], refs: ['A', 'B', 'C'], status: 'pending', paths: null, error: null, run_id: null, done_at: null,
    target: 'studio', items: [{ nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 350, colors: ['Beige'], sizes: ['45×45'], material: 'Cotton', images: [0, 1] }, { nameEn: 'Stripe Pillow', nameAr: 'مخدة مخططة', vendorPrice: 280, colors: ['Black'], sizes: [], images: [2] }], brand_id: brand.id, vendor_id: null, batch_type: 'Simple', batch_id: null });
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('#pg-products')).toContainText('الاستوديو — 2 منتج · Simple');
  await page.locator('[data-igimport="4"]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('اتعملت دفعة في الاستوديو بـ 2 منتج و2 صورة — 1 صورة ماتنزّلتش');
  expect(mock.importCalls).toEqual([{ by: OPS, id: 4, target: 'studio' }]);
  expect(mock.webpCalls).toEqual([]); // the studio's photos stay as they came (the provider's references are JPG / PNG)
  const batch = mock.studioBatches[0];
  expect([batch.type, batch.brand_id, batch.step, batch.status, batch.created_by, batch.state.brandName, batch.state.items.length]).toEqual(['Simple', brand.id, 2, 'draft', OPS_ID, brand.name, 2]);
  expect(batch.state.items.map((it) => [it.nameEn, it.nameAr, it.vendorPrice, it.colors, it.sizes, !!it.main, it.refs.length])).toEqual([['Boho Cushion', 'مخدة بوهيمي', 350, ['BE'], ['45×45'], true, 1], ['Stripe Pillow', 'مخدة مخططة', 280, ['BK'], [], false, 0]]);
  expect([...mock.studioObjects.keys()].filter((k) => k.startsWith(batch.id + '/')).map((k) => k.replace(/-[a-z0-9]+\.png$/, ''))).toEqual([batch.id + '/row1-main', batch.id + '/row2-ref']);
  expect(mock.aiRuns.map((r) => [r.source, r.credits, r.batch_id, r.output.items, r.output.failed])).toEqual([['import', 0, batch.id, 2, 1]]);
  expect([mock.imageImports[0].status, mock.imageImports[0].batch_id]).toEqual(['partial', batch.id]);
  // the note with the batch, the row still listed as ناقصة; «افتح الدفعة» → the studio's intake step with the products and their photos
  await expect(page.locator('#pg-products')).toContainText('ناقصة');
  await page.locator('[data-igbatch]').click();
  await expect(page).toHaveURL(new RegExp('#products-studio-' + batch.id + '-2$'));
  await expect(page.locator('#pg-products')).toContainText('Boho Cushion');
  await expect(page.locator('#pg-products')).toContainText('Stripe Pillow');
  await expect(page.locator('#pg-products')).toContainText('متطابق ✓'); // Boho Cushion with its photo
  await expect(page.locator('#pg-products')).toContainText('ناقص صورة'); // Stripe Pillow: its link failed
});

test('decision 10 (c) — the site\'s results back into the batch they were made for: «استورد للدفعة» puts them in the products\' empty image slots (no credits, no WebP), «افتح الدفعة» lands on the images step with them', async ({ page }) => {
  const SB = '0b6f2f5e-1d2c-4a8b-9e3f-000000000077';
  mock.studioObjects.set(SB + '/row1-main-x.jpg', { type: 'image/jpeg', size: 10 }); mock.studioObjects.set(SB + '/row2-main-x.jpg', { type: 'image/jpeg', size: 10 });
  mock.studioBatches.unshift({ id: SB, title: 'Art Craft — Simple · 2026-11-01', brand_id: mock.brands[0].id, vendor_id: null, type: 'Simple', step: 6, status: 'draft', result: null, created_by: OPS_ID, updated_at: '2026-11-01T07:00:00.000Z', archived_at: null,
    state: { v: 1, type: 'Simple', vary: ['color'], mode: 'photos', brandId: mock.brands[0].id, brandName: 'Art Craft', vendorId: null, vendorName: '', rate: 30, fee: null, sheet: null, imgCount: 4,
      items: [{ key: 'k1', nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 350, colors: ['BE'], unknownColors: [], sizes: [], material: 'Cotton', style: '', weight: '', stock: null, onDemand: false, shortDesc: '', shortDescAr: '', categories: [], main: SB + '/row1-main-x.jpg', refs: [], slots: [SB + '/row1-main-x.jpg'], colorImages: {}, variations: [], sheetVariations: null },
        { key: 'k2', nameEn: 'Stripe Pillow', nameAr: 'مخدة مخططة', vendorPrice: 280, colors: ['BK'], unknownColors: [], sizes: [], material: '', style: '', weight: '', stock: null, onDemand: false, shortDesc: '', shortDescAr: '', categories: [], main: SB + '/row2-main-x.jpg', refs: [], slots: [], colorImages: {}, variations: [], sheetVariations: null }] } });
  mock.imageImports.push({ id: 5, created_at: '2026-11-01T08:00:00.000Z', created_by: OPS_ID, source: 'magnific', folder: 'ابتكر', label: 'نتائج Magnific — Art Craft', product_id: null,
    urls: ['https://pikaso.cdnpk.net/private/production/1/r1.jpg?token=t', 'https://pikaso.cdnpk.net/private/production/1/r2.jpg?token=t', 'https://pikaso.cdnpk.net/private/production/1/r3.jpg?token=t'], refs: ['R1', 'R2', 'R3'], status: 'pending', paths: null, error: null, run_id: null, done_at: null,
    target: 'batch', items: [{ index: 0, images: [0, 1] }, { index: 1, images: [2] }], brand_id: null, vendor_id: null, batch_type: 'Simple', batch_id: SB });
  await openProducts(page);
  await openTool(page);
  await expect(page.locator('#pg-products')).toContainText('دفعة موجودة — 2 منتج');
  await page.locator('[data-igimport="5"]').click();
  await expect(page.locator('.toast, [role=status]').last()).toContainText('اتحطت 3 صورة في خانات منتجات الدفعة');
  expect(mock.importCalls).toEqual([{ by: OPS, id: 5, target: 'batch' }]);
  expect(mock.webpCalls.map((c) => [c.bucket, /\.png$/.test(c.path)])).toEqual([['studio', true], ['studio', true], ['studio', true]]); // decision 14: the results end 700×800 WebP
  const batch = mock.studioBatches.find((b) => b.id === SB);
  expect(batch.state.items[0].slots.length).toBe(3); expect(batch.state.items[0].slots[0]).toBe(SB + '/row1-main-x.jpg');
  expect(batch.state.items[0].slots.slice(1).map((k) => k.replace(/-[a-z0-9]+-(\d)\.webp$/, '-$1'))).toEqual([SB + '/gen-0-imp-1', SB + '/gen-0-imp-2']);
  expect(batch.state.items[1].slots.map((k) => k.replace(/-[a-z0-9]+-(\d)\.webp$/, '-$1'))).toEqual([SB + '/gen-1-imp-3']);
  expect([mock.imageImports.at(-1).status, mock.aiRuns.at(-1).source, mock.aiRuns.at(-1).output.placed]).toEqual(['ok', 'import', 3]);
  // «افتح الدفعة» → the images step, the slots filled
  await page.locator('[data-igbatch]').click();
  await expect(page).toHaveURL(new RegExp('#products-studio-' + SB + '-6$'));
  await expect(page.locator('#pg-products .tot-bar')).toContainText('3 من 8'); // the intake photo left slot 1 (the owner, 1 Nov): the three results only
});

test('decision 11 — the admin links the system\'s Magnific account from «إعدادات الصور»: the sign-in link leaves the app, Magnific comes back to magnific-callback.html, the code becomes the link; then the settings show the account and unlink', async ({ page }) => {
  await openProducts(page, ADMIN);
  await openTool(page);
  await page.locator('[data-img-settings]').click();
  await expect(page.locator('.modal [data-img-bridge]')).toContainText('مش مربوط');
  // Magnific's sign-in (mocked) sends the browser straight back with a code
  await page.route('https://auth.mock/**', (route) => { const u = new URL(route.request().url()); route.fulfill({ status: 302, headers: { location: 'http://localhost:4173/magnific-callback.html?code=code-mock-1234&state=' + u.searchParams.get('state') } }); });
  await page.locator('[data-img-link]').click();
  await expect(page).toHaveURL(/magnific-callback\.html$/);
  await expect(page.locator('#cb-title')).toHaveText('اتربط حساب Magnific ✓');
  await expect(page.locator('#cb-text')).toContainText('owner@ibtekr.club');
  expect(mock.oauthStates.map((s) => s.used)).toEqual([true]);
  expect(mock.magnific.linked).toBe(true);
  expect(mock.bridgeCalls.map((c) => c.action)).toEqual(['bridge_status', 'bridge_link', 'bridge_callback']);
  await page.locator('#cb-back').click();
  await expect(page).toHaveURL(/#products-tool-images$/); // the link opens the images tool itself
  await expect(page.locator('[data-img-settings]')).toBeVisible();
  await page.locator('[data-img-settings]').click();
  await expect(page.locator('.modal [data-img-bridge]')).toContainText('مربوط بحساب');
  await expect(page.locator('.modal [data-img-bridge]')).toContainText('owner@ibtekr.club');
  // decision 12: the category prompts read from the owner's template (the mock adds a category and refreshes a prompt)
  await page.locator('[data-img-prompts-sync]').click();
  await expect(page.locator('[data-img-prompts-out]')).toHaveText('اتقرت 3 فئة · 7 برومبت');
  expect(mock.shotPrompts.find((x) => x.category === 'كرسي' && x.shot === 1).prompt).toBe('CHAIR FOCUS PROMPT v2');
  expect(mock.bridgeCalls.at(-1).action).toBe('bridge_prompts_sync');
  await expect.poll(() => mock.activityRows.filter((x) => x.action === 'product.ai.bridge.prompts').map((x) => x.new_value)).toEqual(['3 categories · 7 prompts']);
  await page.locator('[data-img-unlink]').click();
  await page.getByRole('button', { name: 'فكّ الربط', exact: true }).last().click();
  await expect(page.locator('.modal [data-img-bridge]')).toContainText('مش مربوط');
  expect(mock.magnific.linked).toBe(false);
  // a spent or wrong state on the callback page says so
  await page.goto('/magnific-callback.html?code=code-mock-1234&state=' + mock.oauthStates[0].state);
  await expect(page.locator('#cb-text')).toContainText('انتهت صلاحية الربط');
});
