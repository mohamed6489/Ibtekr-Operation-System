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
  // the owner 15 Nov: the maker alone — no brand list (his own brand is taken); then his rate alone — no sale-price formula, no store,
  // no brand — and beside it his categories with their own rate (Art Craft is «category_based»: ديكور 30%)
  await expect(page.locator('#fl-brand')).toHaveCount(0);
  await expect(page.locator('[data-fl-rate]')).toContainText('%');
  const info = page.locator('[data-fl-maker-info]');
  for (const gone of ['سعر البيع', 'المتجر على الموقع', 'البراند']) await expect(info).not.toContainText(gone);
  await expect(info.locator('[data-fl-cat-rates] [data-cat="15"]')).toHaveText('ديكور30%');
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
  await expect(page.locator('[data-fl-rate]')).toHaveText('35%'); // the maker's general rate
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
  // the owner 15 Nov: «املأ الناقص أو أعد الكتابة بالـ AI» asks first — fill or rewrite, with instructions; «إغلاق» asks nothing
  await page.locator('[data-flow-ai]').click();
  await expect(page.locator('[data-ai-ask]')).toContainText('املأ الناقص بس'); await expect(page.locator('[data-ai-ask]')).toContainText('أعد كتابة الاسم والوصف كمان');
  await page.locator('[data-ai-close]').click(); await expect(page.locator('[data-ai-ask]')).toHaveCount(0);
  await page.locator('[data-flow-ai]').click(); await page.locator('[data-ai-go]').click(); // fill: nothing missing any more → no other call
  await expect(page.locator('.toast[role=status]')).toContainText('مفيش بيانات ناقصة');
  expect(mock.aiCalls.filter((c) => c.action === 'studio').length).toBe(2);
  await next(page);
  // the prices: (maker + fee) ÷ (1 − the rate) up to the next 10; «قبل الخصم» above it — the rate Dokan takes on the product: both are in
  // «ديكور», where Art Craft has his own 30% (not his general 35%)
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('1430');
  await expect(page.locator('#pg-products [data-fl="sale"]').nth(1)).toHaveValue('1150');
  await expect(page.locator('#pg-products [data-fl-prices] [data-row]').first().locator('.c-rate')).toContainText('30% · القسم');
  expect(Number(await page.locator('#pg-products [data-fl="regular"]').first().inputValue())).toBeGreaterThan(1430);
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
  // the owner 15 Nov: a filled shot has «إعادة توليد» (the instructions popup first, the note sent with the shot) and «تعديل» — the image
  // large, a click puts a numbered point with what to change there, plus a general change → an edit of this very image with the pins
  const u0 = page.locator('#pg-products .fl-unit').first(); const slot0 = u0.locator('.fl-slot').first();
  const before = await slot0.locator('img').getAttribute('src');
  await slot0.locator('[data-shot-regen]').click();
  await expect(page.locator('[data-ai-ask]')).toContainText('إعادة توليد'); await page.fill('#ai-ask-notes', 'خلفية أفتح'); await page.locator('[data-ai-go]').click();
  await expect.poll(() => mock.imgCalls.filter((c) => c.action === 'generate').pop().note).toBe('خلفية أفتح');
  await expect.poll(() => slot0.locator('img').getAttribute('src')).not.toBe(before);
  await slot0.locator('[data-shot-edit]').click();
  const ed = page.locator('[data-fl-pin-edit]'); await expect(ed).toBeVisible();
  const stage = ed.locator('[data-pin-stage]'); const box = await stage.boundingBox();
  await stage.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  await expect(ed.locator('.fl-pin[data-pin="1"]')).toBeVisible();
  await ed.locator('#fl-pin-t-0').fill('شيل الظل ده'); await ed.locator('#fl-edit').fill('إضاءة أدفى');
  await ed.locator('[data-fl-pin-go]').click();
  await expect.poll(() => mock.imgCalls.filter((c) => c.action === 'edit').length).toBe(1);
  const e1 = mock.imgCalls.filter((c) => c.action === 'edit').pop();
  expect(e1).toMatchObject({ op: 'instruction', prompt: 'إضاءة أدفى' }); expect(e1.pins).toHaveLength(1); expect(e1.pins[0].text).toBe('شيل الظل ده');
  expect(Math.abs(e1.pins[0].x - 25)).toBeLessThan(4); expect(Math.abs(e1.pins[0].y - 75)).toBeLessThan(4);
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
    ['IBTART0999-BE', 'draft', 'simple', '1430', [{ id: 15 }], 6, 'مخدة بوهيمي'], ['IBTART1000-PU', 'draft', 'simple', '1250', [{ id: 15 }], 5, 'مخدة مخططة']]);
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

// the owner 15 Nov («لما أدوس على إضافة مبتكر يفتحلي بوب أب إضافة المبتكر»): «+ مبتكر جديد» opens the add-maker popup over the studio,
// and the new maker is picked for the batch — the studio stays where it is
test('the maker step: «+ مبتكر جديد» opens the add-maker popup over the studio and picks the new maker', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Simple');
  await next(page);
  await expect(page).toHaveURL(/-2$/);
  const url = page.url();
  await page.locator('[data-fl-new-maker]').click();
  const m = page.locator('.modal'); await expect(m).toContainText('إضافة مبتكر');
  await m.locator('#v-name').fill('Wood & Rope');
  await m.locator('#v-cat').click(); await page.locator('[data-mp-menu] [role=menuitemcheckbox]', { hasText: 'ديكور' }).click(); await page.locator('[data-mp-menu] [data-mp-done]').click();
  await m.locator('#v-phone').fill('01000000009');
  await m.locator('#v-login-email').fill('wood.dev@ibtekr.local');
  await m.locator('[data-genpw]').click();
  await m.getByRole('button', { name: 'إضافة المبتكر' }).click();
  await expect(m).toHaveCount(0);
  expect(page.url()).toBe(url); // still the studio's step 2 — no makers page, no drawer
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('#fl-maker')).toContainText('Wood & Rope');
  await expect.poll(() => (batch().state || {}).vendorName).toBe('Wood & Rope');
  await expect.poll(() => (batch().state || {}).brandName).toBe('Wood & Rope');
});

// the owner 15 Nov («شيل سعر البيع والمتجر على الموقع والبراند وخلّي بس نسبته تبان، ويبقى فيه إمكانية لتعديلها: النسبة العامة أو نسبة
// لقسم معيّن — بختار القسم ونسبته»): «تعديل النسبة» writes the maker's commission like his «الاتفاق التجاري» (vendor_commission_set + the
// push to his Dokan store), and the prices take the rate Dokan takes on each product (its category's when it has one)
test('the maker step: «تعديل النسبة» — the general rate, then one category\'s; the prices follow each product\'s own rate', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price,Product Category\n1,,Lamp,أباجورة,700,ديكور\n2,,Mug,مج,700,هدايا\n') });
  await next(page);
  await makerArtCraft(page);
  const writes = () => mock.vendorWrites.filter((x) => x.table === 'vendor_commission');
  // the general rate: 35 → 40 (Art Craft stays «category_based», his ديكور keeps its 30)
  await page.locator('[data-fl-rate-edit]').click();
  const m = page.locator('.modal'); await expect(m).toContainText('تعديل نسبة إبتكر — Art Craft');
  await expect(m.locator('#flRate')).toHaveValue('35');
  await m.locator('#flRate').fill('66'); await m.getByRole('button', { name: 'احفظ النسبة' }).click();
  await expect(m).toContainText('رقم من 0 لـ 65'); expect(writes()).toEqual([]);
  await m.locator('#flRate').fill('40'); await m.getByRole('button', { name: 'احفظ النسبة' }).click();
  await expect(page.locator('[data-fl-rate]')).toHaveText('40%');
  await expect(page.locator('.toast[role=status]').last()).toContainText('اتحفظت النسبة العامة');
  expect(writes().at(-1)).toMatchObject({ type: 'category_based', rate: 40, flat: null, categories: [] });
  await expect.poll(() => mock.vendorPushes.length).toBeGreaterThan(0);
  expect(mock.vendorPushes.at(-1).fields).toEqual(expect.arrayContaining(['rate', 'category_rates']));
  // one category: «ديكور» (the batch's own first, its rate today in the box) 30 → 25
  await page.locator('[data-fl-rate-edit]').click();
  await m.getByRole('radio', { name: /نسبة قسم معيّن/ }).click();
  await expect(m.locator('#flRateCat')).toContainText('ديكور');
  await expect(m.locator('#flRate')).toHaveValue('30');
  await expect(m).not.toContainText('هتبقى «حسب القسم»'); // already by category
  await m.locator('#flRate').fill('25'); await m.getByRole('button', { name: 'احفظ النسبة' }).click();
  await expect(page.locator('[data-fl-cat-rates] [data-cat="15"]')).toHaveText('ديكور25%');
  await expect(page.locator('.toast[role=status]').last()).toContainText('اتحفظت نسبة القسم');
  expect(writes().at(-1)).toMatchObject({ type: 'category_based', rate: 40, categories: [{ id: 15, rate: 25, flat: null }] });
  await expect(page.locator('[data-fl-rate]')).toHaveText('40%'); // the general rate stays
  // the prices: the lamp in «ديكور» at its 25% (700 ÷ 0.75 → 940), the mug in «هدايا» (no rate of its own) at the general 40% (→ 1170)
  await next(page); await next(page);
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('940');
  await expect(page.locator('#pg-products [data-fl="sale"]').nth(1)).toHaveValue('1170');
  await expect(page.locator('#pg-products [data-fl-prices] [data-row]').nth(1).locator('.c-rate')).toHaveText('40%');
});

// a category rate on a maker on «fixed»: he becomes «category_based» with his general rate (and flat fee) as the default of every other
// category — nothing else changes on the site — and the category keeps the flat fee it had (inherited); ops (no sensitive.commission)
// sees no rate and no edit
test('the maker step: a category rate on a «fixed» maker keeps his general rate and fee for the rest; no edit without sensitive.commission', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Simple');
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await expect(page.locator('[data-fl-rate]')).toHaveText('45%');
  await expect(page.locator('[data-fl-maker-info]')).toContainText('+ 10 ج.م رسوم ثابتة');
  await expect(page.locator('[data-fl-cat-rates]')).toContainText('نفس النسبة على كل الأقسام');
  await page.locator('[data-fl-rate-edit]').click();
  const m = page.locator('.modal');
  await m.getByRole('radio', { name: /نسبة قسم معيّن/ }).click();
  await expect(m).toContainText('هتبقى «حسب القسم» على الموقع'); await expect(m).toContainText('(45%)');
  await m.getByRole('button', { name: 'احفظ النسبة' }).click();
  await expect(m).toContainText('اختار القسم'); // no category picked (the batch has none)
  await m.locator('#flRateCat').click(); await page.getByRole('option', { name: 'هدايا' }).click();
  await expect(m.locator('#flRate')).toHaveValue('45'); // what it takes today: the general rate
  await m.locator('#flRate').fill('30'); await m.getByRole('button', { name: 'احفظ النسبة' }).click();
  await expect(page.locator('[data-fl-cat-rates] [data-cat="22"]')).toHaveText('هدايا30%');
  expect(mock.vendorWrites.filter((x) => x.table === 'vendor_commission').at(-1)).toMatchObject({ type: 'category_based', rate: 45, flat: 10, categories: [{ id: 22, rate: 30, flat: 10 }] });
  await expect(page.locator('[data-fl-rate]')).toHaveText('45%');
});
test('the maker step for ops (products.add without sensitive.commission): the rate hidden, no «تعديل النسبة»', async ({ page }) => {
  await signIn(page, 'ops.dev@ibtekr.local');
  await choose(page, 'صور وعايز شيت', 'Simple');
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await expect(page.locator('[data-fl-rate]')).toHaveText('—');
  await expect(page.locator('[data-fl-cat-rates]')).toContainText('نسبة المبتكر مش ظاهرة لك');
  await expect(page.locator('[data-fl-rate-edit]')).toHaveCount(0);
});

// the owner 15 Nov («خلّي فيه إمكانية إني أعمل drag and drop للصور»): files dropped on a card go up like its button's
async function dropFiles(page, target, files) {
  const dt = await page.evaluateHandle((fs) => { const d = new DataTransfer(); fs.forEach((f) => d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))); return d; },
    files.map((f) => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') })));
  await target.dispatchEvent('dragenter', { dataTransfer: dt });
  await expect(target).toHaveClass(/is-drop/); // the card shows where the files land
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
  await expect(target).not.toHaveClass(/is-drop/);
}
test('step 1: drag & drop — photos and screenshots dropped on their cards go up and are read; a sheet dropped on the sheet card is read; a wrong file says so', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'داتا على الواتساب', 'Variable');
  const photos = page.locator('[data-fl-drop]', { has: page.locator('[data-fl-list="photos"]') });
  const screens = page.locator('[data-fl-drop]', { has: page.locator('[data-fl-list="screens"]') });
  await expect(photos).toContainText('اسحب الصور وسيبها هنا');
  await dropFiles(page, photos, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
  await expect(page.locator('.toast[role=status]').last()).toContainText('اسحب صور بس');
  await dropFiles(page, photos, [png('1.png'), png('2.png')]);
  await expect(page.locator('#pg-products [data-fl-list="photos"] [data-fl-photos-row]')).toHaveCount(2);
  await dropFiles(page, screens, [png('chat-1.png'), png('chat-2.png')]);
  await expect(page.locator('#pg-products')).toContainText('اتقرا 3 صف');
  expect(mock.extractCalls).toEqual([{ by: ADMIN, shots: 2, type: 'Variable', photos: 2 }]);
  // a file let go anywhere else on the studio does not open in the tab (the batch would be left)
  expect(await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    return !document.querySelector('.fl .wiz-foot').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })).toBe(true);
  // the sheet case: a csv dropped on the sheet card
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal'); await m.getByRole('radio', { name: /شيت جاهز/ }).click(); await m.getByRole('radio', { name: /^Simple/ }).click(); await m.locator('[data-flow-start]').click();
  const sheet = page.locator('[data-fl-drop]', { has: page.locator('[data-fl-list="rows"]') });
  await dropFiles(page, sheet, [{ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price\n1,,Lamp,أباجورة,500\n2,,Mug,مج,300\n') }]);
  await expect(page.locator('#pg-products [data-fl-list="rows"] [data-fl-rows-row]')).toHaveCount(2);
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
  // the owner 15 Nov («خلي الاسم و الوصف فيهم امكانية اعادة الكتابة بال ايه اي»): from the Arabic column both languages change,
  // from the English column the English only
  // the owner 15 Nov: the rewrite is a sparkle inside the field («إعادة كتابة» on hover) and asks for instructions first
  await expect(card.locator('[data-fl-rewrite="nameAr"]')).toHaveAttribute('data-tip', 'إعادة كتابة');
  await expect(card.locator('.fl-inwrap [data-fl="nameAr"] + [data-fl-rewrite="nameAr"]')).toHaveCount(1); // inside the field's box
  await card.locator('[data-fl-rewrite="nameAr"]').click(); await page.fill('#ai-ask-notes', 'اسم أقصر'); await page.locator('[data-ai-go]').click();
  await expect(card.locator('[data-fl="nameAr"]')).toHaveValue('اسم منتج متكتب من جديد');
  await expect(card.locator('[data-fl="nameEn"]')).toHaveValue('Rewritten Product Name');
  expect(mock.aiCalls.filter((c) => c.action === 'studio').pop()).toMatchObject({ want: ['rewriteName'], notes: 'اسم أقصر' });
  const arDesc = await card.locator('[data-fl="shortAr"]').inputValue();
  await card.locator('[data-fl-rewrite="shortEn"]').click(); await page.locator('[data-ai-go]').click();
  await expect(card.locator('[data-fl="shortEn"]')).toHaveValue('A rewritten short description.');
  await expect(card.locator('[data-fl="shortEn"]')).toHaveClass(/is-ai/);
  await expect(card.locator('[data-fl="shortAr"]')).toHaveValue(arDesc); // the English column's rewrite leaves the Arabic
  expect(mock.aiCalls.filter((c) => c.action === 'studio').pop().want).toEqual(['rewriteDesc']);
});

// the owner 15 Nov («شيل كلمة القسم AR وخلّي البيانات بدروب داون، وخلّي دروب داون الأقسام فيه خانة بحث»; «املأ الناقص أو أعد الكتابة بالـ AI
// … يفتح بوب أب أكتب فيه تعليمات»): the shared edit sets both languages from one pick; the header's rewrite mode sends new names and
// descriptions with the member's instructions
test('the data step: «تعديل مشترك» with dropdowns (one pick = both languages, no «AR» fields); «أعد كتابة الاسم والوصف كمان» with instructions', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price,Product Category\n1,,Lamp,أباجورة,700,ديكور\n2,,Mug,مج,300,ديكور\n') });
  await next(page); await makerArtCraft(page); await next(page);
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveValue(/./); // the fill on open is done
  await page.getByRole('checkbox', { name: 'حدد الكل' }).click();
  await page.getByRole('button', { name: 'تعديل مشترك' }).click();
  const m = page.locator('.modal').filter({ hasText: 'تعديل مشترك' });
  await expect(m).not.toContainText(' AR'); await expect(m.locator('#catAr, #styleAr, #materialAr')).toHaveCount(0);
  const sel = async (id, q, name) => { const b = m.locator('#' + id); await b.evaluate((e) => e.scrollIntoView({ block: 'center' })); await b.click(); const box = page.locator('.menu [data-select-search]'); if (await box.count()) await box.fill(q); await page.getByRole('option', { name, exact: true }).dispatchEvent('click'); }; // the menu follows the modal's scroll — a direct click
  await sel('style', 'مودرن', 'مودرن — Modern'); await page.screenshot({ path: process.env.SHOT ? process.env.SHOT + '/bulk.png' : 'test-results/bulk.png' }); await sel('material', 'راتان', 'راتان — Rattan'); await sel('cat', 'هدايا', 'هدايا');
  await m.getByRole('button', { name: 'طبّق على المحدد' }).click();
  await expect.poll(() => batch().state.rows.map((r) => [r.styleEn, r.styleAr, r.materialEn, r.materialAr, r.catEn])).toEqual([['Modern', 'مودرن', 'Rattan', 'راتان', 'هدايا'], ['Modern', 'مودرن', 'Rattan', 'راتان', 'هدايا']]);
  // the header: rewrite the names and descriptions too, with instructions
  const n0 = mock.aiCalls.length;
  await page.locator('[data-flow-ai]').click();
  await page.locator('[data-ai-ask]').getByRole('radio', { name: /أعد كتابة الاسم والوصف كمان/ }).click();
  await page.fill('#ai-ask-notes', 'أسماء قصيرة'); await page.locator('[data-ai-go]').click();
  await expect(page.locator('#pg-products [data-fl="nameEn"]').first()).toHaveValue('Rewritten Product Name');
  await expect(page.locator('#pg-products [data-fl="nameAr"]').nth(1)).toHaveValue('اسم منتج متكتب من جديد');
  const calls = mock.aiCalls.slice(n0).filter((c) => c.action === 'studio');
  expect(calls.length).toBe(2); calls.forEach((c) => { expect(c.want).toEqual(expect.arrayContaining(['rewriteName', 'rewriteDesc'])); expect(c.notes).toBe('أسماء قصيرة'); });
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
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('750'); // 520 ÷ 0.70 — «ديكور», Art Craft's own 30% there
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
  expect([v.sku, v.product.type, v.variations.map((x) => [x.sku, x.sale_price])]).toEqual(['IBTART1000', 'variable', [['IBTART1000-BK', '430'], ['IBTART1000-BE', '430']]]);
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
  await page.locator('[data-flow-ai]').click(); await page.locator('[data-ai-go]').click();
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
