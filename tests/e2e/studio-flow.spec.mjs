import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The studio's three flows (docs/superpowers/plans/2026-11-14-studio-flows.md): the chooser, then
// 1) «شيت جاهز» — the maker's sheet + photos by row → maker and brand → the template's data (the SKU generated, the AI fill)
//    → the prices from the maker's rate → the shots → «رفع مباشر» of the photos (their sheet names) then of the sheet (drafts);
// 2) «داتا على الواتساب» — the screenshots read by the AI into rows, a Variable grouped with a color's own shot;
// 3) «صور وعايز شيت» — photos → the empty template with the reference picture in its cell, downloaded or shared.
// Mock only: the cases assert what the mock recorded (studioMedia, studioUploads, extractCalls, serialTakes).
const ADMIN = 'admin.dev@ibtekr.local';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
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
  await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
}
const pick = async (page, sel, files) => { const fc = page.waitForEvent('filechooser'); await page.locator(sel).first().click(); (await fc).setFiles(files); };
const next = (page) => page.locator('.wiz-foot [data-flow-next]').click();
async function choose(page, kase, type) {
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal'); await expect(m).toContainText('دفعة منتجات جديدة');
  await m.getByRole('radio', { name: new RegExp(kase) }).click();
  await m.getByRole('radio', { name: new RegExp('^' + type) }).click();
  await m.locator('[data-flow-start]').click();
  await expect(page).toHaveURL(/#products-flow-0b6f2f5e-1d2c-4a8b-9e3f-000000000001-1$/);
}
async function makerArtCraft(page) {
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  // the owner 15 Nov: the maker alone — no brand list; his own brand is taken, his rate shown with his details
  await expect(page.locator('#fl-brand')).toHaveCount(0);
  await expect(page.locator('[data-fl-brand]')).toContainText('Art Craft');
  await expect(page.locator('[data-fl-rate]')).toContainText('%');
  await expect(page.locator('#fl-code')).toHaveValue('ART'); // glasstora → GLS: the first letter + the consonants after it
}
const batch = () => mock.studioBatches[0];

test('flow 1 «شيت جاهز» Simple: the sheet + photos by row → maker/brand → SKU generated + AI fill → prices from the rate → shots → photos then sheet to the site as drafts', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'art craft.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n2,,Stripe Pillow,مخدة مخططة,Purple,بنفسجي,,800,ديكور\n') });
  await expect(page.locator('#pg-products')).toContainText('2 صف');
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png'), png('2-2.png')]);
  await expect(page.locator('#pg-products')).toContainText('3 صورة');
  await next(page);
  await makerArtCraft(page);
  await expect(page.locator('[data-fl-rate]')).toHaveText('35%'); // the maker's rate, read only (the owner 15 Nov: with his details)
  await next(page);
  // the data: the SKU of every product (one serial each, the new color added with a suggested code), the category matched
  await expect(page.locator('#pg-products [data-fl="sku"]').first()).toHaveValue('IBTART0999-BE');
  await expect(page.locator('#pg-products [data-fl="sku"]').nth(1)).toHaveValue('IBTART1000-PU');
  expect(mock.serialTakes).toEqual([2]);
  expect(mock.skuColors.some((c) => c.code === 'PU' && c.name_en === 'Purple')).toBe(true);
  // the owner 15 Nov: the AI fills what is missing by itself when the step opens (the descriptions, the material and the style)
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveValue('A warm bamboo desk lamp.');
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveClass(/is-ai/);
  expect(mock.aiCalls.filter((c) => c.action === 'studio').map((c) => c.want)).toEqual([['desc', 'attrs'], ['desc', 'attrs']]);
  await page.locator('[data-flow-ai]').click(); // nothing missing any more → no other call
  await expect(page.locator('.toast[role=status]')).toContainText('مفيش بيانات ناقصة');
  expect(mock.aiCalls.filter((c) => c.action === 'studio').length).toBe(2);
  await next(page);
  // the prices: (maker + fee) ÷ (1 − 35%) up to the next 10; «قبل الخصم» above it
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('1540');
  await expect(page.locator('#pg-products [data-fl="sale"]').nth(1)).toHaveValue('1240');
  expect(Number(await page.locator('#pg-products [data-fl="regular"]').first().inputValue())).toBeGreaterThan(1540);
  await page.locator('#pg-products [data-fl="sale"]').nth(1).fill('1250'); await page.locator('#pg-products [data-fl="sale"]').nth(1).press('Tab');
  await expect(page.locator('#pg-products [data-fl="sale"]').nth(1)).toHaveValue('1250');
  // the owner 15 Nov («صلح شكل الجدول و إظهر بيانات المنتج العربي بس»): a grid (no <table>), the product's Arabic data only
  await expect(page.locator('#pg-products [data-fl-prices] table')).toHaveCount(0);
  const first = page.locator('#pg-products [data-fl-prices] [data-row]').first();
  await expect(first).toContainText('مخدة بوهيمي'); await expect(first).toContainText('بيج · 40 × 40 سم'); await expect(first).not.toContainText('Boho Cushion');
  await next(page);
  // the shots: one features image for the batch; the 4 shots + the size drawing of the first product, 4 shots of the second
  await pick(page, '[data-flow-features]', png('features.png'));
  await page.locator('[data-flow-genall]').click();
  await expect(page.locator('#pg-products .fl-slot.is-empty')).toHaveCount(0);
  await expect(page.locator('#pg-products .fl-unit').nth(1)).toContainText('من غير مقاس'); // the second has no size: no drawing
  const gens = mock.imgCalls.filter((c) => c.action === 'generate');
  expect(gens.map((c) => [c.index, c.slot]).sort()).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [1, 3]]);
  expect(batch().state.items[0].refs).toEqual([]); expect(batch().state.items[1].refs.length).toBe(1); // the second photo of a row = a reference
  await next(page);
  // the sheet before the photos → «ارفع الصور الأول», nothing sent
  await page.locator('[data-up="sheet"]').click();
  await expect(page.locator('.toast[role=status]')).toContainText('ارفع الصور الأول');
  expect(mock.studioUploads).toEqual([]);
  // the owner 15 Nov («خلي بوباب معاينة الصور اكبر شوية … و الشيت نفس الكلام»): both previews wide, the pictures five in a row
  await page.locator('[data-box="images"]').getByRole('button', { name: 'معاينة' }).click();
  await expect(page.locator('.modal.fl-big .fl-pv-unit')).toHaveCount(2);
  await expect(page.locator('.modal.fl-big .fl-pv-unit').first().locator('.fl-pv-shot')).toHaveCount(5);
  await expect(page.locator('.modal.fl-big')).not.toContainText('null');
  expect((await page.locator('.modal.fl-big').boundingBox()).width).toBeGreaterThan(900);
  await page.keyboard.press('Escape');
  await page.locator('[data-box="sheet"]').getByRole('button', { name: 'معاينة' }).click();
  await expect(page.locator('.modal.fl-big .fl-preview tbody tr')).toHaveCount(2);
  await expect(page.locator('.modal.fl-big')).not.toContainText('null');
  await page.keyboard.press('Escape');
  await page.locator('[data-up="images"]').click();
  await expect(page.locator('.toast[role=status]')).toContainText('اترفعت الصور على الموقع');
  const names = mock.studioMedia.map((x) => x.name);
  expect(names.length).toBe(10);
  expect(names.filter((n) => /^Boho-Cushion-IBTART0999-BE-0[1-4]\.(webp|png)$/.test(n)).length).toBe(4);
  expect(names.some((n) => /^Boho-Cushion-IBTART0999-BE-05\.(webp|png)$/.test(n))).toBe(true); // the size drawing
  expect(names.filter((n) => /^Stripe-Pillow-IBTART1000-PU-0[1-4]\./.test(n)).length).toBe(4);
  expect(names.some((n) => /^Art-Craft-Features-\d{8}\.(webp|png)$/.test(n))).toBe(true);
  await page.locator('[data-up="sheet"]').click();
  await expect(page.locator('#pg-products .fl-res-row')).toHaveCount(2);
  await expect(page.locator('#pg-products .fl-res-row').first()).toContainText('مسودة #');
  expect(mock.studioUploads.map((x) => [x.sku, x.product.status, x.product.type, x.product.sale_price, x.product.categories, x.images.length, x.ar.name])).toEqual([
    ['IBTART0999-BE', 'draft', 'simple', '1540', [{ id: 15 }], 6, 'مخدة بوهيمي'], ['IBTART1000-PU', 'draft', 'simple', '1250', [{ id: 15 }], 5, 'مخدة مخططة']]);
  expect(mock.studioUploads[0].product.attributes.find((a) => a.id === 3)).toEqual({ id: 3, visible: true, variation: false, options: ['40 × 40 cm'] }); // the size as typed
  // the sheet on the device: the template's file name (the maker + the day)
  const dl = page.waitForEvent('download');
  await page.locator('[data-box="sheet"]').getByRole('button', { name: 'تحميل على الجهاز' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^Art Craft - \d{4}-\d{2}-\d{2}\.xlsx$/);
});

// the owner 15 Nov («التعديلات اللي طلبتها في صفحة المبتكر والبراند تطبق على صفحات إضافة المنتجات التلاتة»): the three cases share one
// maker step — the maker alone (no brand list, no «+ براند جديد»), his rate with his details, the brand code under it
test('the maker step is the same new one in the three cases (sheet · WhatsApp · photos for a sheet)', async ({ page }) => {
  await signIn(page, ADMIN);
  const cases = [['شيت جاهز', 'Simple', async () => pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price\n1,,Lamp,أباجورة,500\n') })],
    ['داتا على الواتساب', 'Simple', async () => { await pick(page, '[data-flow-photos]', [png('1.png')]); await pick(page, '[data-flow-screens]', [png('chat.png')]); await expect(page.locator('#pg-products')).toContainText('اتقرا'); }],
    ['صور وعايز شيت', 'Simple', async () => {}]];
  for (const [kase, type, fill] of cases) {
    await page.locator('.sidebar .nav-item[data-page="products"]').click();
    await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
    await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
    const m = page.locator('.modal'); await m.getByRole('radio', { name: new RegExp(kase) }).click(); await m.getByRole('radio', { name: new RegExp('^' + type) }).click(); await m.locator('[data-flow-start]').click();
    await fill();
    await next(page);
    await expect(page.locator('#pg-products')).not.toContainText('المبتكر والبراند');
    await expect(page.locator('#pg-products')).not.toContainText('براند جديد');
    await makerArtCraft(page); // no brand list, his brand and rate shown, the code ART
    await expect(page.locator('[data-fl-sku-ex]')).toContainText('IBTART1020-OW');
  }
});

// the owner 15 Nov («في مرحلة البيانات يفضل نقسمها لجزئين إنجليزي و عربي و بيملا البيانات اوتوماتيك بال ايه اي … لو غير اي حاجة في العربي
// تتغير اوتوماتيك في الانجليزي … الصورة علي اليمين و جمبهم البيانات»): a card per product, the Arabic and English columns side by side
test('the data step: a card per product with Arabic and English side by side — the AI fills by itself, an Arabic name is translated, a pick sets both columns, a color moves the SKU', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'art craft.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n') });
  await pick(page, '[data-flow-photos]', [png('1.png')]);
  await next(page);
  await makerArtCraft(page);
  await next(page);
  const card = page.locator('#pg-products [data-fl-data] .fl-dcard');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.fl-dbody > .fl-dpic .thumb img')).toHaveCount(1); // the photo beside the data
  await expect(card.locator('.fl-dcol[lang=ar] [data-fl="nameAr"]')).toHaveValue('مخدة بوهيمي');
  await expect(card.locator('.fl-dcol[lang=en] [data-fl="nameEn"]')).toHaveValue('Boho Cushion');
  await expect(card.locator('[data-fl="sku"]')).toHaveValue('IBTART0999-BE');
  // the AI by itself: the descriptions, the material and the style in both columns (marked «AI — راجع» / «· AI»)
  await expect(card.locator('[data-fl-pick="materialAr"]')).toContainText('راتان');
  await expect(card.locator('[data-fl-pick="materialEn"]')).toContainText('Rattan');
  await expect(card.locator('[data-fl-pick="styleEn"]')).toContainText('Boho');
  await expect(card.locator('[data-fl="shortAr"]')).toHaveClass(/is-ai/);
  await expect(card.locator('[data-fl="sizeAr"]')).toHaveValue('40 × 40 سم'); // the English-only size in Arabic
  // an Arabic name typed → the English written from it
  await card.locator('[data-fl="nameAr"]').fill('مخدة بوهيمي كبيرة'); await card.locator('[data-fl="nameAr"]').press('Tab');
  await expect(card.locator('[data-fl="nameEn"]')).toHaveValue('Translated Product Name');
  await expect(card.locator('[data-fl="nameEn"]')).toHaveClass(/is-ai/);
  expect(mock.aiCalls.filter((c) => c.action === 'studio').pop().want).toEqual(['translate']);
  // an Arabic size typed → the English one from it
  await card.locator('[data-fl="sizeAr"]').fill('عرض ٥٠ × طول ٧٠ سم'); await card.locator('[data-fl="sizeAr"]').press('Tab');
  await expect(card.locator('[data-fl="size"]')).toHaveValue('W 50 × L 70 cm');
  // a style picked in the Arabic column → the English one too
  // a long list opens with a search box (9 options or more): type the name, then pick it
  const choosePick = async (k, name) => { const b = card.locator('[data-fl-pick="' + k + '"] button.select'); await b.evaluate((e) => e.scrollIntoView({ block: 'center' })); await b.click();
    const q = page.locator('.menu [data-select-search]'); if (await q.count()) await q.fill(name); await page.getByRole('option', { name, exact: true }).click(); };
  await choosePick('styleAr', 'مودرن');
  await expect(card.locator('[data-fl-pick="styleEn"]')).toContainText('Modern');
  // a color picked → both columns and the SKU's color part; back to beige → back
  await choosePick('colorAr', 'أسود');
  await expect(card.locator('[data-fl-pick="colorEn"]')).toContainText('Black');
  await expect(card.locator('[data-fl="sku"]')).toHaveValue('IBTART0999-BK');
  await choosePick('colorEn', 'Beige');
  await expect(card.locator('[data-fl-pick="colorAr"]')).toContainText('بيج');
  await expect(card.locator('[data-fl="sku"]')).toHaveValue('IBTART0999-BE');
  await expect.poll(() => { const r = batch().state.rows[0]; return [r.nameAr, r.nameEn, r.styleEn, r.styleAr, r.size, r.colorEn, r.sku]; })
    .toEqual(['مخدة بوهيمي كبيرة', 'Translated Product Name', 'Modern', 'مودرن', 'W 50 × L 70 cm', 'Beige', 'IBTART0999-BE']);
});

test('flow 2 «داتا على الواتساب» Variable: the screenshots read into rows → a product of two colors grouped by its serial → a color\'s own shot → its variation', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'داتا على الواتساب', 'Variable');
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]);
  await pick(page, '[data-flow-screens]', [png('chat-1.png'), png('chat-2.png')]);
  await expect(page.locator('#pg-products')).toContainText('اتقرا 3 صف');
  expect(mock.extractCalls).toEqual([{ by: ADMIN, shots: 2, type: 'Variable', photos: 2 }]);
  await next(page);
  await makerArtCraft(page);
  await next(page);
  await expect(page.locator('#pg-products [data-fl="sku"]')).toHaveCount(3);
  for (const [i, sku] of ['IBTART0999-BE', 'IBTART1000-BK', 'IBTART1000-BE'].entries()) await expect(page.locator('#pg-products [data-fl="sku"]').nth(i)).toHaveValue(sku);
  await next(page);
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('800'); // 520 ÷ 0.65
  await next(page);
  await expect(page.locator('#pg-products .fl-unit')).toHaveCount(3); // the basket + the vase's two colors
  await page.locator('#pg-products .fl-unit').nth(1).getByRole('button', { name: 'ولّد بالـ AI' }).first().click();
  await expect(page.locator('#pg-products .fl-unit').nth(1).locator('.fl-slot:not(.is-empty)')).toHaveCount(1);
  const g = mock.imgCalls.filter((c) => c.action === 'generate');
  expect(g.map((c) => [c.index, c.slot, c.color])).toEqual([[1, 0, 'BK']]); // the shot of one color: slot + color
  expect(batch().state.items[1].colorRefs).toEqual({ BK: expect.stringMatching(/\/p2-/), BE: expect.stringMatching(/\/p2-/) });
  await next(page);
  await page.locator('[data-up="images"]').click();
  await expect(page.locator('.toast[role=status]')).toContainText('اترفعت الصور على الموقع');
  await page.locator('[data-up="sheet"]').click();
  await expect(page.locator('#pg-products .fl-res-row')).toHaveCount(2);
  const v = mock.studioUploads[1];
  expect([v.sku, v.product.type, v.variations.map((x) => [x.sku, x.sale_price])]).toEqual(['IBTART1000', 'variable', [['IBTART1000-BK', '470'], ['IBTART1000-BE', '470']]]);
  expect(mock.studioUploads[0].product.type).toBe('simple'); // a product alone = Simple
});

// the owner 15 Nov: «لما ارفع الصور توريني الصور بحجم صغير … ونفس الكلام في السكرين شوتس، وجنب كل واحدة الست نقط … بحيث أحط كل صورة
// جنبها الناحية التانية السكرين شوت»
test('flow 2: the screenshots and the photos show small side by side, each row with the six dots — a photo moved takes the other row; screenshots moved are read again in their new order', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'داتا على الواتساب', 'Simple');
  // empty (the owner 15 Nov «خلي الصور والسكرين شوتس قد بعض و هما فاضيين»): the two cards the same size, each list an empty box in its card
  const m = page.locator('#pg-products [data-fl-match]');
  const cards = m.locator(':scope > .fl-card');
  await expect(cards).toHaveCount(2);
  const [c1, c2] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.abs(c1.height - c2.height)).toBeLessThan(2); expect(Math.abs(c1.y - c2.y)).toBeLessThan(2);
  await expect(m.locator('[data-fl-list="screens"] .fl-list-empty')).toHaveCount(1);
  await expect(m.locator('[data-fl-list="photos"] .fl-list-empty')).toHaveCount(1);
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]);
  await pick(page, '[data-flow-screens]', [png('chat-1.png'), png('chat-2.png')]);
  await expect(page.locator('#pg-products')).toContainText('اتقرا');
  // the screenshots inside the screenshots card, the photos inside the photos card, row facing row
  await expect(m.locator('[data-fl-list="screens"] [data-fl-screens-row]')).toHaveCount(2);
  await expect(m.locator('[data-fl-list="photos"] [data-fl-photos-row]')).toHaveCount(2);
  for (const i of [0, 1]) {
    const [a, b] = [await m.locator('[data-fl-screens-row]').nth(i).boundingBox(), await m.locator('[data-fl-photos-row]').nth(i).boundingBox()];
    expect(Math.abs(a.y - b.y)).toBeLessThan(2); expect(Math.abs(a.height - b.height)).toBeLessThan(2);
  }
  await expect(m.locator('[data-fl-screens-row]')).toHaveCount(2);
  await expect(m.locator('[data-fl-photos-row]')).toHaveCount(2);
  await expect(m.locator('[data-fl-screens-row] .thumb')).toHaveCount(2);
  await expect(m.locator('[data-fl-photos-row] [data-grip]')).toHaveCount(2);
  await expect.poll(() => ((batch().state || {}).screenList || []).length).toBe(2); // the screenshots are kept with the batch
  await expect.poll(() => Object.keys((batch().state || {}).photoRows || {}).length).toBe(2);
  // the first photo row one down (the six dots by keyboard: ArrowDown) → row 1 has the second photo, row 2 the first
  const was = JSON.parse(JSON.stringify(batch().state.photoRows));
  await m.locator('[data-fl-photos-row] [data-grip]').first().focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(() => [batch().state.photoRows['1'][0], batch().state.photoRows['2'][0]]).toEqual([was['2'][0], was['1'][0]]);
  // a screenshot moved → «اقرا تاني بالترتيب ده» → the AI reads them again in the new order
  const shots = batch().state.screenList.slice();
  await m.locator('[data-fl-screens-row] [data-grip]').first().focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(() => batch().state.screenList).toEqual([shots[1], shots[0]]);
  await expect(page.locator('#pg-products')).toContainText('اضغط «اقرا تاني بالترتيب ده»');
  await page.locator('[data-flow-read]').click();
  await expect.poll(() => (mock.extractCalls || []).length).toBe(2);
  await expect(page.locator('[data-flow-read]')).toHaveCount(0);
});

test('flow 3 «صور وعايز شيت» Variable: two colors × two products → the empty template with the reference picture in its cell → download, WhatsApp share', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Variable');
  await page.locator('#fl-k-colors').click(); await page.getByRole('option', { name: '2 ألوان' }).click();
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await next(page);
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]);
  await expect(page.locator('#pg-products .fl-pcard')).toHaveCount(2);
  await next(page);
  await expect(page.locator('#pg-products .fl-preview tbody tr')).toHaveCount(4);
  expect(await page.locator('#pg-products .fl-preview tbody tr td:first-child').allTextContents()).toEqual(['1-1', '1-2', '2-1', '2-2']);
  await page.locator('[data-flow-ai]').click();
  await expect(page.locator('#pg-products .fl-preview tbody tr').first()).toContainText('أباجورة مكتب بامبو');
  const dl = page.waitForEvent('download');
  await page.locator('[data-flow-download]').click();
  const file = await dl; expect(file.suggestedFilename()).toMatch(/^Art Craft - \d{4}-\d{2}-\d{2}\.xlsx$/);
  const bytes = readFileSync(await file.path()).toString('latin1');
  expect(bytes).toContain('xl/drawings/drawing1.xml'); expect(bytes).toContain('xl/media/image4.jpeg'); // a picture for each row
  await page.evaluate(() => { navigator.canShare = () => false; window.open = (u) => { window.__opened = u; return null; }; });
  const dl2 = page.waitForEvent('download');
  await page.locator('[data-flow-share]').click();
  await page.getByRole('menuitem', { name: 'واتساب' }).click();
  await dl2;
  expect(await page.evaluate(() => window.__opened)).toMatch(/^https:\/\/wa\.me\/\?text=/);
});

test('the owner 15 Nov («بجرب ارفع الصور … مبتترفعش»): a maker\'s photos with any name go up — each one a product in the order picked; a numbered one keeps its row', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Simple');
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await next(page);
  await pick(page, '[data-flow-photos]', [png('IMG_2041.png'), png('WhatsApp Image 2026-11-14 at 10.12.png'), png('2-2.png')]);
  await expect(page.locator('.toast[role=status]').last()).toContainText('اترفعت 3 صورة');
  await expect(page.locator('.toast[role=status]').last()).toContainText('2 من غير رقم');
  // «2-2» keeps row 2; the two without a number take rows 1 and 3 — three photos, three uploads (none dropped)
  await expect(page.locator('#pg-products .fl-pcard')).toHaveCount(3);
  expect(await page.locator('#pg-products .fl-pcard b').allTextContents()).toEqual(['منتج 1', 'منتج 2', 'منتج 3']);
  await expect.poll(() => Object.keys((batch().state || {}).photoRows || {}).sort()).toEqual(['1', '2', '3']);
});
