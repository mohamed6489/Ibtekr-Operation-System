import { test, expect } from '@playwright/test';
import { loadUmd } from '../helpers/load-umd.mjs';
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
// the studio's pure rules in Node: the sheet writer (a maker's sheet with pictures in its cells) and the pictures' signatures
const PDn = loadUmd(new URL('../../app/js/pages/products-domain.js', import.meta.url)); globalThis.IbtekrProducts = PDn;
const F = loadUmd(new URL('../../app/js/pages/flow-domain.js', import.meta.url));
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
// comments decision 41: «التالي» waits for a photo on every product — the tests that are about a later step upload one each
const photosFor = async (page, n) => { await pick(page, '[data-flow-photos]', Array.from({ length: n }, (_, i) => png((i + 1) + '.png'))); await expect(page.locator('#pg-products [data-fl-gaps]')).toHaveAttribute('data-fl-gaps', 'ok'); };
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
  // the owner 15 Nov: his rate alone — no sale-price formula, no store — and beside it his categories with their own rate (Art Craft
  // is «category_based»: ديكور 30%). Comments decision 35: the brand is back under the maker — his brands only, his own picked already
  await expect(page.locator('#fl-brand')).toContainText('Art Craft');
  await expect(page.locator('[data-fl-rate]')).toContainText('%');
  const info = page.locator('[data-fl-maker-info]');
  for (const gone of ['سعر البيع', 'المتجر على الموقع', 'البراند']) await expect(info).not.toContainText(gone);
  await expect(info.locator('[data-fl-cat-rates] [data-cat="15"]')).toHaveText('ديكور30%');
  await expect(page.locator('#fl-code')).toHaveValue('ART'); // glasstora → GLS: the first letter + the consonants after it
}
// the add-maker popup is a wizard (the owner 15 Nov, 2026-11-15-comments.md decision 9): toStep = the step whose fields the next
// lines touch («التالي» forward — a refused step fails here — or a done step's own button back); addMaker = «التالي» to the last
// step, then «إضافة المبتكر», stopping at the first step that shows a mistake
async function toStep(page, id) {
  const m = page.locator('.modal.mk-modal');
  for (let k = 0; k < 6; k++) {
    if (await m.locator('[data-mk-body="' + id + '"]').count()) return;
    const back = m.locator('.mk-steps li.done[data-mk-step="' + id + '"] button');
    if (await back.count()) { await back.click(); continue; }
    const before = await m.locator('[data-mk-body]').getAttribute('data-mk-body');
    await m.locator('[data-mk-next="next"]').click();
    await expect(m.locator('[data-mk-body]')).not.toHaveAttribute('data-mk-body', before);
  }
}
async function addMaker(page) {
  const m = page.locator('.modal.mk-modal');
  for (let k = 0; k < 6; k++) {
    if (!(await m.count())) return;
    const btn = m.locator('[data-mk-next]'); const kind = await btn.getAttribute('data-mk-next'); const before = await m.locator('[data-mk-body]').getAttribute('data-mk-body');
    await btn.click();
    if (kind === 'add') return;
    if (!(await m.count()) || (await m.locator('[data-mk-body]').getAttribute('data-mk-body')) === before) return;
  }
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
  // comments decision 45: the sale price is computed, never typed — the maker's price is what moves it (875 ÷ 0.7 = 1,250)
  await expect(page.locator('#pg-products [data-fl="sale"]').nth(1)).toHaveAttribute('readonly', '');
  await page.locator('#pg-products [data-fl="vendorPrice"]').nth(1).fill('875'); await page.locator('#pg-products [data-fl="vendorPrice"]').nth(1).press('Tab');
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
// a second batch in the same test: the mock numbers it after the first
async function choose2(page, kase, type) {
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal'); await m.getByRole('radio', { name: new RegExp(kase) }).click(); await m.getByRole('radio', { name: new RegExp('^' + type) }).click(); await m.locator('[data-flow-start]').click();
  await expect(page).toHaveURL(/#products-flow-[0-9a-f-]+-1$/);
}
test('the maker step is the same new one in the three cases (sheet · WhatsApp · photos for a sheet)', async ({ page }) => {
  await signIn(page, ADMIN);
  const cases = [['شيت جاهز', 'Simple', async () => pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price\n1,,Lamp,أباجورة,500\n') }).then(() => photosFor(page, 1))],
    ['داتا على الواتساب', 'Simple', async () => { await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]); /* the chat has two products (decision 41: a photo each) */ await pick(page, '[data-flow-screens]', [png('chat.png')]); await expect(page.locator('#pg-products')).toContainText('اتقرا'); }],
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
  await toStep(page, 'login'); await m.locator('#v-login-email').fill('wood.dev@ibtekr.local');
  await m.locator('[data-genpw]').click();
  await addMaker(page);
  await expect(m).toHaveCount(0);
  expect(page.url()).toBe(url); // still the studio's step 2 — no makers page, no drawer
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('#fl-maker')).toContainText('Wood & Rope');
  await expect.poll(() => (batch().state || {}).vendorName).toBe('Wood & Rope');
  await expect.poll(() => (batch().state || {}).brandName).toBe('Wood & Rope');
});

// comments decision 35 (the owner 15 Nov — «ضيف هنا البراند تحت المبتكر — و يجيب بس البراندات اللي تحت المبتكر اللي اختاره مع امكانية اضافة براند من هنا»)
test('comment 35 — the brand under the maker: his brands only, his own picked; another of his is picked from the list; «براند جديد» adds one to him and takes it for the batch; a member without vendors.edit has no «براند جديد»', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Simple');
  await next(page); // the maker's step
  await expect(page.locator('#fl-brand')).toHaveCount(0); // no maker yet, no brand list
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  // his brands only: Art Craft's own — not Antikiano's, not Bian eg's
  await expect(page.locator('#fl-brand')).toContainText('Art Craft');
  await page.locator('#fl-brand').click();
  await expect(page.locator('[role="listbox"]:visible [role="option"]')).toHaveText(['Art Craft']);
  await page.keyboard.press('Escape');
  await expect.poll(() => [(batch().state || {}).brandName, batch().brand_id]).toEqual(['Art Craft', mock.brands[0].id]);
  // «براند جديد»: a taken name is refused here; a new one is written on him and picked
  await page.locator('[data-fl-new-brand]').click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'براند جديد — Art Craft' });
  await m.locator('#name').fill('Antikiano');
  await m.getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(m).toContainText('فيه براند بنفس الاسم');
  await m.locator('#name').fill('Glasstora'); await m.locator('#code').fill('gls');
  await m.getByRole('button', { name: 'إضافة البراند' }).click();
  await expect(m).toHaveCount(0);
  const made = () => mock.brands.find((b) => b.name === 'Glasstora');
  await expect.poll(() => !!made()).toBe(true);
  expect(mock.brandOwners.find((o) => o.brand_id === made().id)).toMatchObject({ vendor_id: mock.vendors.find((v) => v.name === 'Art Craft').id });
  await expect(page.locator('#fl-brand')).toContainText('Glasstora');
  await expect(page.locator('#fl-code')).toHaveValue('GLS');
  await expect.poll(() => [(batch().state || {}).brandName, batch().brand_id, (batch().state || {}).code]).toEqual(['Glasstora', made().id, 'GLS']);
  // both are his now; picking the first again brings its name and code back
  await page.locator('#fl-brand').click();
  await expect(page.locator('[role="listbox"]:visible [role="option"]')).toHaveText(['Art Craft', 'Glasstora']);
  await page.locator('[role="listbox"]:visible [role="option"]', { hasText: 'Art Craft' }).click();
  await expect(page.locator('#fl-code')).toHaveValue('ART');
  await expect.poll(() => (batch().state || {}).brandName).toBe('Art Craft');
  // another maker: his own brands, never the first maker's
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await page.locator('#fl-brand').click();
  await expect(page.locator('[role="listbox"]:visible [role="option"]')).toHaveText(['Antikiano']);
  await page.keyboard.press('Escape');
  // ops adds products but not brands (vendors.edit is partial): the list, no «براند جديد»
  await page.evaluate(() => window.IBAuth.signOut()); await expect(page.locator('#login')).toBeVisible();
  await signIn(page, 'ops.dev@ibtekr.local');
  await choose2(page, 'صور وعايز شيت', 'Simple'); await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await expect(page.locator('#fl-brand')).toContainText('Art Craft');
  await expect(page.locator('[data-fl-new-brand]')).toHaveCount(0);
});

// the owner 15 Nov («شيل سعر البيع والمتجر على الموقع والبراند وخلّي بس نسبته تبان، ويبقى فيه إمكانية لتعديلها: النسبة العامة أو نسبة
// لقسم معيّن — بختار القسم ونسبته»): «تعديل النسبة» writes the maker's commission like his «الاتفاق التجاري» (vendor_commission_set + the
// push to his Dokan store), and the prices take the rate Dokan takes on each product (its category's when it has one)
test('the maker step: «تعديل النسبة» — the general rate, then one category\'s; the prices follow each product\'s own rate', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Vendor Price,Product Category\n1,,Lamp,أباجورة,700,ديكور\n2,,Mug,مج,700,هدايا\n') });
  await photosFor(page, 2);
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
  // the card shows where the files land — entered again if the page was drawn again meanwhile (the upload before this one landing
  // under load redraws the cards: a local full run lost the mark between the two lines)
  await expect(async () => { await target.dispatchEvent('dragenter', { dataTransfer: dt }); await expect(target).toHaveClass(/is-drop/, { timeout: 1000 }); }).toPass({ timeout: 8000 });
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
  expect(mock.extractCalls).toEqual([{ by: ADMIN, shots: 2, type: 'Variable', photos: 2, kinds: { colors: 0, sizes: 0 } }]); // no shape chosen: as the chat says
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
  const rw = card.locator('[data-fl-rewrite="nameAr"]'); const look = () => rw.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color]; });
  expect(await look()).toEqual(['rgba(0, 0, 0, 0)', 'rgb(0, 86, 66)']); // the owner 15 Nov: no background, green
  await rw.hover(); await expect.poll(look).toEqual(['rgb(0, 86, 66)', 'rgb(255, 247, 239)']); // hover: green round, beige icon
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
  await photosFor(page, 2);
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
  expect(mock.extractCalls).toEqual([{ by: ADMIN, shots: 2, type: 'Variable', photos: 2, kinds: { colors: 0, sizes: 0 } }]); // no shape chosen: as the chat says
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
test('comment 42 — «الشيت هيبقى عامل إزاي» in the WhatsApp flow: the sizes / colours chosen go to the AI as a hint, every product takes that many rows — the chat\'s rows as read, the rest empty — and a smaller shape drops the empty ones', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'داتا على الواتساب', 'Variable');
  const shape = page.locator('#pg-products [data-fl-shape]');
  await expect(shape).toContainText('الشيت هيبقى عامل إزاي');
  await expect(shape).toContainText('من غير عدد = الصفوف زي ما الشات بيقول');
  // two colours × two sizes = four rows a product
  await page.locator('#fl-k-colors').click(); await page.getByRole('option', { name: '2 ألوان' }).click();
  await page.locator('#fl-k-sizes').click(); await page.getByRole('option', { name: '2 مقاسات' }).click();
  await expect(shape).toContainText('كل منتج هياخد 4 صف');
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]);
  await pick(page, '[data-flow-screens]', [png('chat-1.png')]);
  await expect(page.locator('.toast.show').filter({ hasText: 'صف فاضي على شكل الشيت' })).toBeVisible();
  expect(mock.extractCalls).toEqual([{ by: ADMIN, shots: 1, type: 'Variable', photos: 2, kinds: { colors: 2, sizes: 2 } }]);
  // the chat gave 1 row of product 1 and 2 of product 2 → 3 + 2 empty ones; the empty rows carry the product's names, no colour, no price
  await expect.poll(() => ((batch().state || {}).rows || []).map((r) => [r.product, r.nameEn, r.colorEn, r.vendorPrice, !!r.added])).toEqual([
    [1, 'Rattan Wall Basket', 'Beige', 520, false], [1, 'Rattan Wall Basket', '', null, true], [1, 'Rattan Wall Basket', '', null, true], [1, 'Rattan Wall Basket', '', null, true],
    [2, 'Clay Table Vase', 'Black', 300, false], [2, 'Clay Table Vase', 'Beige', 300, false], [2, 'Clay Table Vase', '', null, true], [2, 'Clay Table Vase', '', null, true]]);
  await expect(page.locator('#pg-products [data-fl-gaps]')).toHaveAttribute('data-fl-gaps', 'ok'); // a photo a product — the variations share it
  // a smaller shape: the empty rows that are no longer needed go, what the chat gave stays
  await page.locator('#fl-k-sizes').click(); await page.getByRole('option', { name: 'من غير' }).click();
  await expect.poll(() => batch().state.rows.map((r) => [r.product, r.colorEn, !!r.added])).toEqual([[1, 'Beige', false], [1, '', true], [2, 'Black', false], [2, 'Beige', false]]);
  // the data step shows them as the product's variations
  await next(page); await makerArtCraft(page); await next(page);
  await expect(page.locator('#pg-products [data-fl="sku"]')).toHaveCount(4);
});

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

test('flow 3 «صور وعايز شيت» Variable: two colors × two products → the empty template with the reference picture in its cell → «حفظ كمسودة», the two copies to download, the share popup (comments 36–38)', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Variable');
  await page.locator('#fl-k-colors').click(); await page.getByRole('option', { name: '2 ألوان' }).click();
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await next(page);
  await pick(page, '[data-flow-photos]', [png('1.png'), png('2.png')]);
  await expect(page.locator('#pg-products .fl-pcard')).toHaveCount(2);
  await next(page);
  const sheet = page.locator('#pg-products [data-flow-sheet]');
  await expect(sheet.locator('tbody tr')).toHaveCount(4);
  await expect(sheet.locator('tbody tr td:first-child')).toHaveText(['1-1', '1-2', '2-1', '2-2']); // waits for the sheet (CI run 1045 read it before it was drawn)
  // the owner 15 Nov: every cell edited in place — a size, a price and a color typed / picked before the AI; the AI fills the rest only
  await sheet.locator('[data-sh="size:1-1"]').fill('٤٠×٦٠ سم'); await sheet.locator('[data-sh="size:1-1"]').press('Tab');
  await sheet.locator('[data-sh="price:1-2"]').fill('850'); await sheet.locator('[data-sh="price:1-2"]').press('Tab');
  await sheet.locator('[data-sh="color:1-2"] button.select').click();
  await page.getByRole('option', { name: /Black/ }).first().click();
  await page.locator('[data-flow-ai]').click(); await page.locator('[data-ai-go]').click();
  await expect(sheet.locator('[data-sh="nameAr:1-1"]')).toHaveValue('أباجورة مكتب بامبو');
  await expect(sheet.locator('[data-sh="size:1-1"]')).toHaveValue('٤٠×٦٠ سم'); // kept through the AI
  await expect(sheet.locator('[data-sh="color:1-2"]')).toContainText('Black');
  // the category picked, the Arabic name typed over the AI's, then «حفظ» → the batch keeps them
  await sheet.locator('[data-sh="nameAr:2-1"]').fill('أباجورة أرضية'); await sheet.locator('[data-sh="nameAr:2-1"]').press('Tab');
  // comment 38: the button says what it does — «حفظ كمسودة»
  await expect(page.locator('[data-flow-save]')).toHaveText(/حفظ كمسودة/);
  await page.locator('[data-flow-save]').click();
  await expect(page.locator('.toast.show')).toContainText('اتحفظت كمسودة');
  await expect.poll(() => { const f = (batch().state || {}).fill || {}; return [f[0] && f[0].sizes && f[0].sizes[0], f[0] && f[0].prices && f[0].prices[2], f[0] && f[0].colors && f[0].colors[2] && f[0].colors[2][0], f[1] && f[1].nameAr]; })
    .toEqual(['٤٠×٦٠ سم', 850, 'Black', 'أباجورة أرضية']);
  // comment 36: «تحميل على الجهاز» opens a popup split in two — the maker's copy and the system's
  await page.locator('[data-flow-download]').click();
  const pop = page.locator('.modal[data-fl-download]');
  await expect(pop.locator('[data-fl-copy]')).toHaveCount(2);
  await expect(pop.locator('[data-fl-copy="maker"]')).toContainText('نسخة المبتكر');
  await expect(pop.locator('[data-fl-copy="maker"] li')).toHaveText(['الصورة المرجعية', 'الاسم بالإنجليزي والعربي', 'اللون', 'المقاس', 'سعر المبتكر']);
  await expect(pop.locator('[data-fl-copy="system"]')).toContainText('نسخة السيستم');
  const [a, b] = [await pop.locator('[data-fl-copy="maker"]').boundingBox(), await pop.locator('[data-fl-copy="system"]').boundingBox()];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); expect(Math.abs(a.height - b.height)).toBeLessThan(2); // side by side, the same size
  // the system's copy: the whole template, as before
  const dl = page.waitForEvent('download');
  await pop.locator('[data-fl-copy-go="system"]').click();
  const file = await dl;
  expect(await page.evaluate(() => window.__lastSheet)).toMatchObject({ copy: 'system', name: expect.stringMatching(/^Art Craft - نسخة السيستم - \d{4}-\d{2}-\d{2}\.xlsx$/) });
  await expect(pop).toHaveCount(0);
  const bytes = readFileSync(await file.path()).toString('latin1');
  expect(bytes).toContain('xl/drawings/drawing1.xml'); expect(bytes).toContain('xl/media/image4.jpeg'); // a picture for each row
  expect(bytes).toMatch(/<v>850<\/v>/); expect(bytes).toMatch(/>40 .{1,2} 60 cm</); /* the ×, read as latin1 */ // what was typed in the step is in the file (stored zip, plain XML)
  expect(bytes).toContain('Product Name EN'); expect(bytes).toContain('Image for review'); // the Variable template's own head
  // the maker's copy: seven columns only, read from the right, a picture for each row; no SKU, no category, no description
  await page.locator('[data-flow-download]').click();
  const dlm = page.waitForEvent('download');
  await page.locator('.modal[data-fl-download] [data-fl-copy-go="maker"]').click();
  const mfile = await dlm;
  expect(await page.evaluate(() => window.__lastSheet)).toMatchObject({ copy: 'maker', name: expect.stringMatching(/^Art Craft - نسخة المبتكر - \d{4}-\d{2}-\d{2}\.xlsx$/) });
  const mk = readFileSync(await mfile.path());
  const mtext = mk.toString('utf8'); const mlatin = mk.toString('latin1');
  for (const head of ['الصورة المرجعية', 'الاسم بالإنجليزي', 'الاسم بالعربي', 'اللون', 'المقاس', 'سعر المبتكر']) expect(mtext).toContain('>' + head + '<');
  expect(mtext).toContain('rightToLeft="1"'); expect(mlatin).toContain('xl/media/image4.jpeg'); expect(mtext).toMatch(/<v>850<\/v>/);
  expect(mtext).toContain('أباجورة أرضية'); expect(mtext).toContain('٤٠×٦٠ سم');
  const mhead = (mtext.match(/<row r="1"[^>]*>(.*?)<\/row>/) || ['', ''])[1];
  expect(mhead.match(/<c /g).length).toBe(7); expect(mhead).not.toContain('SKU'); expect(mhead).not.toContain('Product'); expect(mhead).not.toContain('القسم');
  // comment 37: «مشاركة» is the system's one share popup — the kind of file and the way — and what goes out is the maker's copy
  await page.evaluate(() => { navigator.canShare = () => false; });
  await page.locator('[data-flow-share]').click();
  const sh = page.locator('.modal[data-share-modal]');
  await expect(sh.locator('[data-sh-type]')).toHaveCount(2); // Excel / PDF
  await expect(sh.locator('[data-sh-via]')).toHaveCount(3);  // WhatsApp / e-mail / download
  await sh.locator('[data-sh-type="excel"]').click(); await sh.locator('[data-sh-via="download"]').click();
  const [xl] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  const last = await page.evaluate(() => window.__lastShare);
  expect(last).toMatchObject({ type: 'excel', via: 'download', ok: true }); expect(last.name).toMatch(/^Art Craft - نسخة المبتكر - \d{4}-\d{2}-\d{2}\.xlsx$/);
  const xtext = readFileSync(await xl.path()).toString('utf8');
  expect(xtext).toContain('>سعر المبتكر<'); expect(xtext).not.toContain('Product Name EN'); // the same file «نسخة المبتكر» downloads
  // the PDF by WhatsApp: the file comes down and the chat opens with the message (a computer)
  await page.locator('[data-flow-share]').click();
  await sh.locator('[data-sh-type="pdf"]').click(); await sh.locator('[data-sh-via="whatsapp"]').click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), sh.locator('[data-sh-go]').click()]);
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const last2 = await page.evaluate(() => window.__lastShare);
  expect(last2).toMatchObject({ type: 'pdf', via: 'whatsapp', ok: true }); expect(last2.photos).toBeGreaterThan(0); expect(last2.href).toMatch(/^https:\/\/wa\.me\//);
  expect(decodeURIComponent(last2.href)).toContain('املا سعر المبتكر');
});

test('comment 36 — the maker\'s copy returned starts a «شيت جاهز» batch as it is: its Arabic headers are read, the English size is written from the Arabic one and the colour matched by its Arabic name', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  // the maker's copy as it comes back: the seven columns, the price filled by the maker
  await pick(page, '[data-flow-sheet]', { name: 'Art Craft - نسخة المبتكر.csv', mimeType: 'text/csv',
    buffer: Buffer.from('#,الصورة المرجعية,الاسم بالإنجليزي,الاسم بالعربي,اللون,المقاس,سعر المبتكر\n1,,Bamboo Lamp,أباجورة بامبو,بيج,٤٠ × ٦٠ سم,700\n2,,Wool Rug,سجادة صوف,Black,M,1500\n', 'utf8') });
  await expect(page.locator('#pg-products')).toContainText('2 صف');
  // (the batch is saved a moment after the sheet is read)
  await expect.poll(() => ((batch().state || {}).rows || []).map((r) => [r.nameEn, r.nameAr, r.colorAr, r.sizeAr, r.vendorPrice])).toEqual([['Bamboo Lamp', 'أباجورة بامبو', 'بيج', '٤٠ × ٦٠ سم', 700], ['Wool Rug', 'سجادة صوف', 'Black', 'M', 1500]]);
  expect(batch().state.unknown || []).toEqual([]); // the photo column and # are not data, nothing is left unread
  await photosFor(page, 2);
  await next(page);
  await makerArtCraft(page);
  await next(page);
  // the data step: the English size from the Arabic one; «بيج» is Beige of the colours table, and «Black» typed in the one column is Black
  await expect.poll(() => batch().state.rows.map((r) => [r.size, r.colorEn, r.colorAr])).toEqual([['40 × 60 cm', 'Beige', mock.skuColors.find((c) => c.code === 'BE').name_ar], ['M', 'Black', mock.skuColors.find((c) => c.code === 'BK').name_ar]]);
  await expect(page.locator('#pg-products [data-fl="sku"]').first()).toHaveValue(/^IBTART\d{4}-BE$/);
  await expect(page.locator('#pg-products [data-fl="sku"]').nth(1)).toHaveValue(/^IBTART\d{4}-BK$/);
});

// three different pictures, each drawn twice in the page: the photo a maker has (600 px, the product on white) and the small copy his
// sheet carries in its cell (210 × 240, between white bars)
const drawPics = (page) => page.evaluate(() => {
  const draw = (k, w, h, box) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.save(); c.translate(box.x, box.y); c.scale(box.s / 100, box.s / 100);
    if (k === 0) { c.fillStyle = '#c0392b'; c.beginPath(); c.arc(50, 50, 40, 0, 7); c.fill(); c.fillStyle = '#2c3e50'; c.fillRect(40, 10, 20, 34); }
    if (k === 1) { c.fillStyle = '#1f6f8b'; c.fillRect(6, 28, 88, 44); c.fillStyle = '#f1c40f'; c.fillRect(6, 28, 24, 44); }
    if (k === 2) { c.fillStyle = '#27ae60'; c.beginPath(); c.moveTo(50, 6); c.lineTo(94, 94); c.lineTo(6, 94); c.closePath(); c.fill(); c.fillStyle = '#8e44ad'; c.fillRect(42, 58, 16, 36); }
    if (k === 3) { c.fillStyle = '#e67e22'; for (let i = 0; i < 4; i++) c.fillRect(8 + i * 22, 8, 12, 84); } // a fourth picture the sheet does not have
    c.restore(); return cv;
  };
  const b64 = (cv, type) => cv.toDataURL(type, 0.8).split(',')[1];
  return [0, 1, 2, 3].map((k) => ({ big: b64(draw(k, 600, 600, { x: 60, y: 60, s: 480 }), 'image/png'), thumb: b64(draw(k, 210, 240, { x: 21, y: 36, s: 168 }), 'image/jpeg') }));
});
const bigPng = (name, pic) => ({ name, mimeType: 'image/png', buffer: Buffer.from(pic.big, 'base64') });

test('comments 43–48 and 50 — the data step\'s picture opens a popup (replace it, or an AI picture after the instructions); «القسم» under its label; the sale price computed and not typed, the SKU under the name; an empty slot takes an upload beside «ولّد بالـ AI», the slots in the middle, and a bulk run stops at the first «no credit»', async ({ page }) => {
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n2,,Clay Vase,فازة فخار,Black,أسود,25 cm,450,ديكور\n') });
  await photosFor(page, 2);
  await next(page); await makerArtCraft(page); await next(page);
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveValue(/./); // the fill on open is done
  const box = async (l) => l.boundingBox();
  // 44: «القسم» is as wide as its field and starts where its label starts; the head's labels are on one line
  const head = page.locator('#pg-products .fl-dhead').first();
  await expect(head.locator('.fl-cat button.select')).toBeVisible();
  const [lab, sel, brand] = [await box(head.locator('.fl-cat label')), await box(head.locator('.fl-cat button.select')), await box(head.locator('.fl-dbrand small').first())];
  expect(Math.abs((lab.x + lab.width) - (sel.x + sel.width))).toBeLessThan(2); expect(Math.abs(lab.width - sel.width)).toBeLessThan(2);
  expect(Math.abs(lab.y - brand.y)).toBeLessThan(2);
  // 43: the picture is a button → its popup: the maker's photo and the AI's side by side
  const was = batch().state.photoRows[1][0];
  await page.locator('#pg-products [data-fl-photo]').first().click();
  const pop = page.locator('.modal[data-fl-photo-pop]');
  await expect(pop.locator('[data-pp-ref]')).toContainText('صورة المبتكر'); await expect(pop.locator('[data-pp-ai]')).toContainText('لسه ما اتولّدتش');
  { const fc = page.waitForEvent('filechooser'); await pop.locator('[data-pp-swap]').click(); (await fc).setFiles([png('other.png')]); }
  await expect(page.locator('.toast.show').filter({ hasText: 'الصورة اتبدّلت' })).toBeVisible();
  await expect.poll(() => { const l = batch().state.photoRows[1]; return l.length === 1 && l[0] !== was; }).toBe(true);
  await expect(pop).toBeVisible(); // the popup stays for the next choice
  // «ولّد صورة بالذكاء الاصطناعي» asks for instructions first, then makes the product's first shot from the photo
  const calls = mock.imgCalls.length;
  await pop.locator('[data-pp-gen]').click();
  await page.locator('[data-ai-ask] textarea').fill('خلفية بيج فاتح');
  await page.locator('[data-ai-go]').click();
  await expect(pop.locator('[data-pp-edit]')).toBeVisible(); await expect(pop.locator('[data-pp-gen]')).toHaveText(/إعادة توليد/);
  expect(mock.imgCalls.slice(calls).map((c) => [c.action, c.index, c.slot, c.note])).toEqual([['generate', 0, 0, 'خلفية بيج فاتح']]);
  await expect.poll(() => Object.values(batch().state.shots || {}).some((l) => !!l[0])).toBe(true);
  await pop.getByRole('button', { name: 'إغلاق' }).last().click();
  await next(page);
  // 45: the sale price is shown, not typed; 46: the SKU sits under the name, on the right
  const row = page.locator('#pg-products [data-fl-prices] [data-row]').first();
  await expect(row.locator('[data-fl="sale"]')).toHaveAttribute('readonly', ''); await expect(row.locator('[data-fl="sale"]')).toHaveValue('1430');
  await row.locator('[data-fl="sale"]').click(); await page.keyboard.type('9'); await expect(row.locator('[data-fl="sale"]')).toHaveValue('1430');
  await row.locator('[data-fl="vendorPrice"]').fill('2000'); await row.locator('[data-fl="vendorPrice"]').press('Tab');
  await expect(page.locator('#pg-products [data-fl-prices] [data-row]').first().locator('[data-fl="sale"]')).toHaveValue('2860'); // 2,000 ÷ 0.7 up to the next 10
  const info = page.locator('#pg-products [data-fl-prices] [data-row]').first().locator('.fl-info');
  const [nm, sku] = [await box(info.locator('b').first()), await box(info.locator('small.num').first())];
  expect(Math.abs((nm.x + nm.width) - (sku.x + sku.width))).toBeLessThan(2);
  await next(page);
  // 50: the five slots in the middle of the card
  const card = page.locator('#pg-products .fl-ucard').nth(1); const shots = card.locator('.fl-shots');
  await expect(async () => { // the step draws again once the Magnific bar's state loads (comment 49) — measure the settled card
    const [wrap, first, last] = [await box(shots), await box(shots.locator(':scope > *').first()), await box(shots.locator(':scope > *').last())];
    expect(Math.abs(((wrap.x + wrap.width) - (first.x + first.width)) - (last.x - wrap.x))).toBeLessThan(3);
  }).toPass({ timeout: 5000 });
  // the first product's first slot holds the picture made in the data step
  await expect(page.locator('#pg-products .fl-ucard').first().locator('.fl-slot:not(.is-empty)')).toHaveCount(1);
  // 48: «رفع» beside «ولّد بالـ AI» in an empty slot → the member's own photo fills it
  const empty = card.locator('.fl-slot.is-empty').first();
  await expect(empty.locator('[data-gen]')).toBeVisible();
  { const fc = page.waitForEvent('filechooser'); await empty.locator('[data-shot-up]').click(); (await fc).setFiles([png('mine.png')]); }
  await expect(card.locator('.fl-slot:not(.is-empty)')).toHaveCount(1);
  // 47: the credit is gone → a bulk run asks for one picture, says so and stops
  mock.imgFail = 'ai_cap';
  const before = mock.imgCalls.filter((c) => c.action === 'generate').length;
  await page.locator('[data-flow-genall]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'وقفنا التوليد من أول صورة' })).toBeVisible();
  await expect(page.locator('.toast.show').filter({ hasText: 'وقفنا التوليد' })).toHaveCount(1);
  expect(mock.imgCalls.filter((c) => c.action === 'generate').length).toBe(before + 1);
  mock.imgFail = null;
});

test('comment 49 — «ابعت لـ Magnific» in the flows\' photos step: the products\' photos go to the project, «جهّز فلو» builds the category\'s flow (the batch stays a flow batch), and «هات النتائج» puts what it made in the slots — «في النص», «البيئة», «التفاصيل» and the size drawing', async ({ page }) => {
  mock.magnific.linked = true;
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Oak Chair,كرسي بلوط,Beige,بيج,40×90,1000,ديكور\n2,,Rattan Chair,كرسي راتان,Black,أسود,,450,ديكور\n') });
  await photosFor(page, 2);
  await next(page); await makerArtCraft(page); await next(page);
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveValue(/./);
  await next(page); await next(page);
  const bar = page.locator('#pg-products [data-fl-magnific]');
  await expect(bar).toHaveAttribute('data-fl-magnific', 'new'); // nothing sent yet: the one button
  await expect(bar.locator('[data-mg-flow]')).toHaveCount(0);
  await bar.locator('[data-mg-send]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'اترفعت 2 صورة على مشروع «ابتكر»' })).toBeVisible();
  await expect(bar).toHaveAttribute('data-fl-magnific', 'sent'); await expect(bar.locator('[data-mg-state]')).toContainText('2 صورة مبعوتة');
  // the flow needs a category
  await bar.locator('[data-mg-flow]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'اختار فئة المنتجات الأول' })).toBeVisible();
  await page.locator('#fl-mg-cat').click(); await page.getByRole('option', { name: 'كرسي' }).click();
  await bar.locator('[data-mg-flow]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'اتعمل فلو «كرسي» بـ 2 صورة وبرومبتات الفئة' })).toBeVisible();
  await expect(bar.locator('[data-mg-open]')).toHaveAttribute('href', 'https://www.magnific.com/app/spaces/a3000000-0000-4000-8000-000000000001');
  const id = batch().id;
  expect(mock.magnific.flows.map((f) => [f.batch_id, f.category, f.order])).toEqual([[id, 'كرسي', [0, 1]]]);
  // the batch is still one of the three flows (its marker untouched), the Magnific flow's copy beside it
  await expect.poll(() => [batch().state.flow, (batch().state.mflow || {}).category, batch().state.mcat]).toEqual([2, 'كرسي', 'كرسي']);
  expect(mock.magnific.flows[0].gens.filter((g) => g.shot === 4).map((g) => g.index)).toEqual([0]); // the oak chair has a size → its drawing
  // the owner ran the flow on the site: the three shots of both chairs and the oak chair's size drawing
  mock.magnific.flowResults[id] = { 1: ['F11', 'F12'], 2: ['F21', 'F22'], 3: ['F31', 'F32'], 4: { 0: ['F41'] } };
  await bar.locator('[data-mg-fetch]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'نزلت 7 صورة من Magnific في خانات المنتجات' })).toBeVisible();
  const cards = page.locator('#pg-products .fl-ucard');
  // chair 1: slots 1, 2 and 4 + the size drawing (its second «البيئة» slot stays for the AI or an upload); chair 2: slots 1, 2 and 4
  const filled = async (card) => card.locator('.fl-shots > *').evaluateAll((els) => els.map((e) => e.classList.contains('fl-slot') && !e.classList.contains('is-empty')));
  expect(await filled(cards.nth(0))).toEqual([true, true, false, true, true]);
  expect(await filled(cards.nth(1))).toEqual([true, true, false, true, false]);
  await expect.poll(() => { const st = batch().state; return [Object.values(st.shots).map((l) => l.filter(Boolean).length).sort(), Object.values(st.sizeShot || {}).filter(Boolean).length]; }).toEqual([[3, 3], 1]);
  // nothing new the second time
  await bar.locator('[data-mg-fetch]').click();
  await expect(page.locator('.toast.show').filter({ hasText: 'مفيش نتائج جديدة على Magnific لسه' })).toBeVisible();
  expect(batch().state.flow).toBe(2); // still one of the three flows after the fetch
});

test('comment 51 — the style comes from the shop\'s own styles only: the list is the site\'s (its Arabic names), the AI is handed that list and its pick is written as the shop writes it, and there is no «+ جديد…»', async ({ page }) => {
  mock.siteStyles = [{ id: 71, en: 'Boho', ar: 'بوهو' }, { id: 72, en: 'Wabi Sabi', ar: '' }, { id: 73, en: 'Mid-Century', ar: 'ميد سنشري' }];
  await signIn(page, ADMIN);
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n') });
  await photosFor(page, 1);
  await next(page); await makerArtCraft(page); await next(page);
  const card = page.locator('#pg-products .fl-dcard').first();
  // the AI filled the style: «Boho» is the shop's, with the shop's own Arabic name (not the page's «بوهيمي»)
  await expect(card.locator('[data-fl-pick="styleEn"] button.select')).toContainText('Boho');
  await expect(card.locator('[data-fl-pick="styleAr"] button.select')).toContainText('بوهو');
  await expect.poll(() => { const r = (batch().state.rows || [])[0] || {}; return [r.styleEn, r.styleAr]; }).toEqual(['Boho', 'بوهو']);
  // the ask carried the shop's list (a style with no Arabic on the site goes with its English name)
  const call = mock.aiCalls.filter((c) => c.action === 'studio' && (c.want || []).includes('attrs')).at(-1);
  expect(call.styles).toEqual([{ en: 'Boho', ar: 'بوهو' }, { en: 'Wabi Sabi', ar: 'Wabi Sabi' }, { en: 'Mid-Century', ar: 'ميد سنشري' }]);
  expect(mock.styleReads).toBe(1); // read once a session
  // the list a member picks from: the shop's three, nothing else, no «+ جديد…»
  await card.locator('[data-fl-pick="styleAr"] button.select').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await card.locator('[data-fl-pick="styleAr"] button.select').click();
  await expect(page.getByRole('option')).toHaveText(['—', 'بوهو', 'Wabi Sabi', 'ميد سنشري']);
  await page.getByRole('option', { name: 'ميد سنشري' }).click();
  await expect.poll(() => { const r = batch().state.rows[0]; return [r.styleEn, r.styleAr]; }).toEqual(['Mid-Century', 'ميد سنشري']);
  // the material keeps «+ جديد…» — only the style is the shop's list
  await card.locator('[data-fl-pick="materialAr"] button.select').click();
  await expect(page.getByRole('option', { name: '+ جديد…' })).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('comments 39–41 — a ready sheet\'s photos: the sheet\'s own pictures are signatures only (16 Nov — never put on the rows), the uploads go to the row they look like whatever their names; each row\'s ⋮ replaces or empties it, «زوّد صور» only adds, «مسح الكل» empties all; a product without a photo or a photo without a row stops «التالي» with a note', async ({ page }) => {
  await signIn(page, ADMIN);
  const pics = await drawPics(page);
  // the maker's sheet: three rows, each with its picture in the cell (the same writer as «نسخة المبتكر»)
  const sh = F.makerSheetOf({ rows: [{ n: 1, nameEn: 'Red Vase', nameAr: 'فازة حمرا', vendorPrice: 500 }, { n: 2, nameEn: 'Blue Tray', nameAr: 'صينية زرقا', vendorPrice: 300 }, { n: 3, nameEn: 'Green Tree', nameAr: 'شجرة خضرا', vendorPrice: 700 }] });
  const xlsx = F.xlsx({ ...sh, freeze: 'C2', images: [0, 1, 2].map((i) => ({ row: i, col: sh.refCol, bytes: Uint8Array.from(Buffer.from(pics[i].thumb, 'base64')), ext: 'jpeg', w: 105, h: 120 })) });
  await choose(page, 'شيت جاهز', 'Simple');
  await pick(page, '[data-flow-sheet]', { name: 'maker.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsx) });
  const card = page.locator('#pg-products [data-fl-list="photos"]'); const gaps = page.locator('#pg-products [data-fl-gaps]'); const nextBtn = page.locator('.wiz-foot [data-flow-next]');
  // the owner 16 Nov: the sheet's pictures are NOT put on the rows (low quality) — they are signatures only, for the matching; the
  // rows wait for the real photos and «التالي» stops
  await expect.poll(() => Object.keys((batch().state || {}).sheetSigs || {}).length).toBe(3);
  await expect(card.locator('[data-fl-from-sheet]')).toHaveCount(0);
  expect(Object.keys(batch().state.sheetPhotos || {})).toEqual([]);
  expect(Object.keys(batch().state.photoRows || {})).toEqual([]);
  await expect(gaps).not.toHaveAttribute('data-fl-gaps', 'ok');
  // the maker's real photos, named in an order that is NOT the rows' (a = the third product, b = the first, c = the second)
  await expect(page.locator('[data-flow-photos]')).toHaveText(/ارفع الصور/); // no photo on any row yet (the sheet's pictures are not taken)
  await pick(page, '[data-flow-photos]', [bigPng('a.png', pics[2]), bigPng('b.png', pics[0]), bigPng('c.png', pics[1])]);
  await expect(page.locator('.toast.show').filter({ hasText: 'اتحطت على صفها لوحدها' })).toBeVisible();
  await expect(card.locator('[data-fl-from-sheet]')).toHaveCount(0);
  // (the batch is saved a moment later: wait for the save that carries the uploads)
  await expect.poll(() => { const st = batch().state || {}; return [Object.keys(st.photoSigs || {}).length, Object.keys(st.sheetPhotos || {}).length].concat([1, 2, 3].map((k) => ((st.photoRows || {})[k] || []).length)); }).toEqual([3, 0, 1, 1, 1]);
  { // each row holds the photo that looks like its picture in the sheet — and not like another row's
    const st = batch().state; const d = (row, k) => F.sigDistance(st.sheetSigs[row], st.photoSigs[st.photoRows[k][0]]);
    for (const k of [1, 2, 3]) { expect(d(k, k)).toBeLessThan(F.SIG_MAX); for (const o of [1, 2, 3].filter((x) => x !== k)) expect(d(o, k)).toBeGreaterThan(F.SIG_MAX); }
    expect(Object.keys(st.sheetPhotos || {})).toEqual([]);
  }
  await expect(gaps).toHaveAttribute('data-fl-gaps', 'ok');
  // 39: a row's ⋮ — «مسح» empties the row: its slot stays in its place and says what is missing; 41: «التالي» stops with a note
  const menu = (k, name) => card.locator('[data-fl-photo-menu="' + k + '"] button').first().click().then(() => page.getByRole('menuitem', { name }).click());
  await menu(2, 'مسح');
  await expect(card.locator('[data-fl-photos-row]')).toHaveCount(3);
  await expect(card.locator('[data-fl-photos-row="2"] [data-fl-slot]')).toHaveAttribute('data-fl-slot', 'empty');
  await expect(card.locator('[data-fl-photos-row="2"]')).toContainText('ناقص');
  await expect(gaps).toHaveAttribute('data-fl-gaps', 'bad');
  await expect(gaps).toContainText('ناقص: 1 منتج من غير صورة — صف 2');
  await expect(nextBtn).toBeDisabled(); await expect(page.locator('.wiz-foot')).toContainText('1 منتج من غير صورة');
  // the empty row's ⋮ takes a photo for that row («ارفع صورة»); a filled row's replaces it («تبديل الصورة»)
  { const fc = page.waitForEvent('filechooser'); await menu(2, 'ارفع صورة'); (await fc).setFiles([bigPng('whatever.png', pics[1])]); }
  await expect(card.locator('[data-fl-photos-row="2"] [data-fl-slot]')).toHaveAttribute('data-fl-slot', 'photo');
  await expect(gaps).toHaveAttribute('data-fl-gaps', 'ok'); await expect(nextBtn).toBeEnabled();
  const before = batch().state.photoRows[1][0];
  { const fc = page.waitForEvent('filechooser'); await menu(1, 'تبديل الصورة'); (await fc).setFiles([bigPng('new.png', pics[0])]); }
  await expect(page.locator('.toast.show').filter({ hasText: 'الصورة اتبدّلت' })).toBeVisible();
  await expect.poll(() => { const l = batch().state.photoRows[1]; return l.length === 1 && l[0] !== before; }).toBe(true);
  // 41: a photo that looks like no row and carries a number the sheet does not have is «زيادة» — the note names its row and «التالي» stops
  await pick(page, '[data-flow-photos]', [bigPng('9.png', pics[3])]);
  await expect(card.locator('[data-fl-photos-row]')).toHaveCount(4);
  await expect(card.locator('[data-fl-photos-row="9"] [data-fl-extra]')).toHaveCount(1);
  await expect(gaps).toContainText('زيادة: صور على صف مش في الشيت — 9');
  await expect(nextBtn).toBeDisabled();
  await menu(9, 'مسح');
  await expect(card.locator('[data-fl-photos-row]')).toHaveCount(3); await expect(nextBtn).toBeEnabled();
  // 39: «مسح الكل» asks, then empties every row
  await page.locator('[data-flow-photos-clear]').click();
  await page.getByRole('button', { name: 'امسح الكل' }).click();
  await expect(card.locator('[data-fl-photos-row]')).toHaveCount(0);
  await expect(page.locator('[data-flow-photos]')).toHaveText(/ارفع الصور/); await expect(page.locator('[data-flow-photos-clear]')).toHaveCount(0);
  await expect(gaps).toContainText('ناقص: 3 منتج من غير صورة — صف 1، 2، 3'); await expect(nextBtn).toBeDisabled();
  await expect.poll(() => Object.keys(batch().state.photoRows || {}).length).toBe(0);
  // the photos uploaded again without numbers in the names still land on their rows (the sheet's pictures are remembered)
  await pick(page, '[data-flow-photos]', [bigPng('x.png', pics[1]), bigPng('y.png', pics[2]), bigPng('z.png', pics[0])]);
  await expect.poll(() => { const st = batch().state; return [1, 2, 3].every((k) => (st.photoRows[k] || []).length === 1 && F.sigDistance(st.sheetSigs[k], st.photoSigs[st.photoRows[k][0]]) < F.SIG_MAX); }).toBe(true);
  await expect(nextBtn).toBeEnabled();  // the owner 16 Nov: a batch saved before, with the sheet's small pictures standing on rows — opened again, they go (the real photos
  // and the signatures stay)
  const real = batch().state.photoRows[1][0];
  batch().state.photoRows[1] = ['studio/old-sheet-1.webp']; batch().state.photoRows[4] = ['studio/old-sheet-4.webp'];
  batch().state.sheetPhotos = { 'studio/old-sheet-1.webp': 1, 'studio/old-sheet-4.webp': 1 };
  await page.reload();
  await expect.poll(() => { const st = batch().state; return [Object.keys(st.sheetPhotos || {}).length, (st.photoRows[1] || []).length, (st.photoRows[4] || []).length, Object.keys(st.sheetSigs || {}).length]; }).toEqual([0, 0, 0, 3]);
  expect(real).toBeTruthy();
});

test('the owner 15 Nov: «صور وعايز شيت» — «املأ بالـ AI» labels the sizes «مقاس 1 / 2», reads each color from its own photo (a product\'s second photo = its second color), and a row\'s photo is swapped in the sheet (its AI color read again)', async ({ page }) => {
  // the AI's color: Black for the second photo or a swapped one, else Beige (the photo decides)
  mock.studioColor = (item) => (/\/(p1-2|r0-3)-/.test(String(item.main || '')) ? 'BK' : 'BE');
  await signIn(page, ADMIN);
  await choose(page, 'صور وعايز شيت', 'Variable');
  await page.locator('#fl-k-colors').click(); await page.getByRole('option', { name: '2 ألوان' }).click();
  await page.locator('#fl-k-sizes').click(); await page.getByRole('option', { name: '2 مقاسات' }).click();
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await next(page);
  await pick(page, '[data-flow-photos]', [png('1-1.png'), png('1-2.png')]);
  await expect(page.locator('#pg-products .fl-pcard')).toHaveCount(1);
  await next(page);
  const sheet = page.locator('#pg-products [data-flow-sheet]');
  await expect(sheet.locator('tbody tr td:first-child')).toHaveText(['1-1', '1-2', '1-3', '1-4']); // waits for the sheet (CI run 1045 read it before it was drawn)
  await page.locator('[data-flow-ai]').click(); await page.locator('[data-ai-go]').click();
  await expect(sheet.locator('[data-sh="nameAr:1-1"]')).toHaveValue('أباجورة مكتب بامبو');
  // the sizes labelled per slot, the colors per photo: slot 1 (the first photo) Beige, slot 2 (the second photo) Black
  await expect(sheet.locator('[data-sh="size:1-1"]')).toHaveValue('مقاس 1'); await expect(sheet.locator('[data-sh="size:1-2"]')).toHaveValue('مقاس 2');
  await expect(sheet.locator('[data-sh="size:1-3"]')).toHaveValue('مقاس 1'); await expect(sheet.locator('[data-sh="size:1-4"]')).toHaveValue('مقاس 2');
  await expect(sheet.locator('[data-sh="color:1-1"]')).toContainText('Beige'); await expect(sheet.locator('[data-sh="color:1-3"]')).toContainText('Black');
  const studioCalls = () => mock.aiRuns.filter((r) => r.action === 'studio' && r.source === 'studio').map((r) => r.item_index);
  expect(studioCalls()).toEqual([0, 1]); // the product, then its second color's photo (item 1)
  // the second color's photo swapped (row 1-3) → its AI color is cleared; «املأ بالـ AI» reads it from the new picture
  const fc = page.waitForEvent('filechooser'); await sheet.locator('[data-sh-photo="1-3"]').click(); (await fc).setFiles([png('new-white.png')]);
  await expect(page.locator('.toast.show')).toContainText('اتبدلت صورة 1-3');
  await expect(sheet.locator('[data-sh="color:1-3"]')).not.toContainText('Black');
  await expect.poll(() => Object.values((((batch().state || {}).fill || {})[0] || {}).rowPhotos || {}).length).toBe(1);
  mock.studioColor = (item) => (/\/r0-3-/.test(String(item.main || '')) ? 'WH' : 'BE');
  await page.locator('[data-flow-ai]').click(); await page.locator('[data-ai-go]').click();
  await expect(sheet.locator('[data-sh="color:1-3"]')).toContainText('White');
  await expect(sheet.locator('[data-sh="color:1-1"]')).toContainText('Beige'); // the names and slot 1 stay — not asked again
  expect(studioCalls()).toEqual([0, 1, 1]);
  mock.studioColor = null;
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
  await expect(page.locator('#pg-products .fl-pcard b')).toHaveText(['منتج 1', 'منتج 2', 'منتج 3']);
  await expect.poll(() => Object.keys((batch().state || {}).photoRows || {}).sort()).toEqual(['1', '2', '3']);
});
