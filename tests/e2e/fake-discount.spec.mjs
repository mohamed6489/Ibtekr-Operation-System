import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// «الخصم الوهمي» بالشرايح (the owner 15 Nov — docs/superpowers/plans/2026-11-15-fake-discount.md): «نحط ف الاعدادات حاجة لحساب الخصم
// الوهمي الافتراضي و اعدل رينج النسبة او الرقم … و اقدر اضيف ارقام زي منا ما عايز و اختار كلمة فيما فوق ف اخر واحدة … كمان اقدر
// اعدلها من خطوة … الاسعار». Mock only.
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});
async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', 'admin.dev@ibtekr.local'); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
// the default tiers as the settings row «makers» holds them (before the sign-in reads it)
const seed = (rule) => { const r = mock.settings.find((x) => x.section === 'makers'); if (r) r.data = Object.assign({}, r.data, { fake: rule }); else mock.settings.push({ section: 'makers', data: { fake: rule } }); };
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); };
const modal = (page) => page.locator('.modal[role=dialog]');
const row = (s) => (mock.settings.find((x) => x.section === s) || {}).data || {};
// the owner's own example: 0–1000 → +500 · 1001–2000 → +1000 · 2001 فيما فوق → +1500
const OWNER = { tiers: [{ to: 1000, type: 'amount', value: 500 }, { to: 2000, type: 'amount', value: 1000 }, { to: null, type: 'amount', value: 1500 }] };

test('settings › إعدادات المبتكرين: the default tiers — the owner\'s three, «فيما فوق» on the last, a percent, the checks, and back to the old way', async ({ page }) => {
  await signIn(page);
  await go(page, 'settings-makers');
  const st = page.locator('#pg-settings');
  const card = st.locator('.card.sec', { hasText: 'الخصم الوهمي الافتراضي' });
  await expect(card).toContainText('مفيش شرايح');
  expect(await page.evaluate(() => window.IBFakeDiscount.rule())).toBe(null);
  await card.locator('[data-fake-edit]').click();
  const f = modal(page).filter({ hasText: 'الخصم الوهمي الافتراضي' });
  // it opens with one tier, «فيما فوق»
  await expect(f.locator('[data-fk-row]')).toHaveCount(1);
  await expect(f.locator('[data-fk="open"]')).toBeChecked();
  await f.locator('[data-fk="val:1"]').fill('500');
  await f.locator('[data-fk-add]').click(); // «فيما فوق» moves to the new last tier
  await expect(f.locator('[data-fk-row]')).toHaveCount(2);
  await f.locator('[data-fk="to:1"]').fill('1000');
  await expect(f.locator('[data-fk-from="2"]')).toHaveText('1,001');
  await f.locator('[data-fk="val:2"]').fill('1000');
  await f.locator('[data-fk-add]').click();
  await f.locator('[data-fk="val:3"]').fill('1500');
  // the checks: the second tier has no end yet; an end not above the one before it
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f.locator('[data-fk-err="to:2"]')).toHaveText('اكتب آخر سعر في الشريحة');
  await f.locator('[data-fk="to:2"]').pressSequentially('900'); // the field is drawn again on the first key — the typing goes on
  await expect(f.locator('[data-fk="to:2"]')).toHaveValue('900');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f.locator('[data-fk-err="to:2"]')).toHaveText('لازم يبقى أكبر من 1,000');
  await f.locator('[data-fk="to:2"]').fill('2000');
  await expect(f.locator('[data-fk-from="3"]')).toHaveText('2,001');
  await expect(f.locator('[data-fk-open-text]')).toHaveText('فيما فوق');
  // «جرّب بسعر بيع»
  await f.locator('[data-fk="sample"]').fill('1200');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 1,200 ← قبل الخصم 2,200 ج.م');
  await f.locator('[data-fk="sample"]').fill('5000');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 5,000 ← قبل الخصم 6,500 ج.م');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(f).toBeHidden();
  await expect.poll(() => row('makers').fake).toEqual(OWNER);
  await expect(card.locator('[data-fake-range]')).toHaveText(['من 0 لـ 1,000', 'من 1,001 لـ 2,000', 'من 2,001 فيما فوق']);
  await expect(card.locator('[data-fake-add]')).toHaveText(['+ 500 ج.م', '+ 1,000 ج.م', '+ 1,500 ج.م']);
  expect(await page.evaluate(() => window.IBFakeDiscount.rule())).toEqual(OWNER);
  // every price worked out from the maker's price takes it: 700 at 30% → sale 1,000 → 1,500
  expect(await page.evaluate(() => window.IbtekrProducts.priceFromVendor(700, { rate: 30, fee: 0, markup: 20, fake: window.IBFakeDiscount.rule() }))).toMatchObject({ sale: 1000, regular: 1500 });
  // the delay rules beside it were not touched by the save
  expect(row('makers').delay == null || typeof row('makers').delay === 'object').toBe(true);

  // a percent on the middle tier; «فيما فوق» off = prices above the last tier go the old way
  await card.locator('[data-fake-edit]').click();
  await expect(f.locator('[data-fk-row]')).toHaveCount(3);
  await f.locator('[data-fk="type:2:percent"]').click();
  await expect(f.locator('[data-fk="type:2:percent"]')).toHaveAttribute('aria-pressed', 'true');
  await f.locator('[data-fk="val:2"]').fill('50');
  await f.locator('[data-fk="open"]').uncheck();
  await f.locator('[data-fk="to:3"]').fill('3000');
  await f.locator('[data-fk="sample"]').fill('1210');
  await expect(f.locator('[data-fk-sample]')).toHaveText('سعر البيع 1,210 ← قبل الخصم 1,820 ج.م'); // 1,815 up to the next 10
  await f.locator('[data-fk="sample"]').fill('4000');
  await expect(f.locator('[data-fk-sample]')).toContainText('أعلى من آخر شريحة');
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => (row('makers').fake || {}).tiers).toEqual([{ to: 1000, type: 'amount', value: 500 }, { to: 2000, type: 'percent', value: 50 }, { to: 3000, type: 'amount', value: 1500 }]);
  await expect(card.locator('[data-fake-add]')).toHaveText(['+ 500 ج.م', '+ 50%', '+ 1,500 ج.م']);

  // every tier removed = the old way (sale + 15–30%)
  await card.locator('[data-fake-edit]').click();
  for (let i = 0; i < 3; i += 1) await f.locator('[data-fk-del="1"]').click();
  await expect(f.locator('[data-fk-empty]')).toBeVisible();
  await f.getByRole('button', { name: 'حفظ' }).click();
  await expect(card).toContainText('مفيش شرايح');
  await expect.poll(() => row('makers').fake == null).toBe(true);
  // the activity log names the count only
  const logged = mock.activity.filter((a) => a.action === 'settings.change').map((a) => JSON.stringify(a));
  expect(logged.some((t) => /الخصم الوهمي = 3 شريحة/.test(t))).toBe(true);
});

// decision 3: «كمان اقدر اعدلها من خطوة … الاسعار» — the sheet flow's prices step
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pick = async (page, sel, files) => { const fc = page.waitForEvent('filechooser'); await page.locator(sel).first().click(); (await fc).setFiles(files); };
const next = (page) => page.locator('.wiz-foot [data-flow-next]').click();
const batch = () => mock.studioBatches[0];
async function toPrices(page) {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'إضافة' }).click();
  await page.getByRole('button', { name: 'استوديو المنتجات — ابدأ دفعة' }).click();
  const m = page.locator('.modal');
  await m.getByRole('radio', { name: /شيت جاهز/ }).click(); await m.getByRole('radio', { name: /^Simple/ }).click();
  await m.locator('[data-flow-start]').click();
  await pick(page, '[data-flow-sheet]', { name: 'art craft.csv', mimeType: 'text/csv', buffer: Buffer.from('#,SKU,Product Name EN,Product Name AR,Product Colors,Product Colors AR,Size,Vendor Price,Product Category\n1,,Boho Cushion,مخدة بوهيمي,Beige,بيج,40 × 40 cm,1000,ديكور\n2,,Stripe Pillow,مخدة مخططة,Purple,بنفسجي,,800,ديكور\n') });
  await expect(page.locator('#pg-products')).toContainText('2 صف');
  await pick(page, '[data-flow-photos]', [{ name: '1.png', mimeType: 'image/png', buffer: PNG }, { name: '2.png', mimeType: 'image/png', buffer: PNG }]);
  await next(page);
  await page.locator('#fl-maker').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await expect(page.locator('[data-fl-rate]')).toHaveText('35%');
  await next(page);
  await expect(page.locator('#pg-products [data-fl="sku"]').first()).toHaveValue('IBTART0999-BE');
  await expect(page.locator('#pg-products [data-fl="shortEn"]').first()).toHaveValue('A warm bamboo desk lamp.'); // the AI fill is done
  await next(page);
  await expect(page.locator('#pg-products [data-fl="sale"]').first()).toHaveValue('1430'); // 1000 ÷ 0.7 (ديكور 30%) up to the next 10
}
const sale = (page, i) => page.locator('#pg-products [data-fl="sale"]').nth(i);
const reg = (page, i) => page.locator('#pg-products [data-fl="regular"]').nth(i);

test('the sheet flow › الأسعار: «قبل الخصم» by the default tiers; a sale typed by hand follows its tier; «تعديل» = this batch only; «رجّع الافتراضي»; the admin saves it as the default too', async ({ page }) => {
  seed(OWNER);
  await toPrices(page);
  const bar = page.locator('#pg-products [data-fl-fake]');
  await expect(bar).toHaveAttribute('data-fl-fake', 'default');
  await expect(bar).toContainText('الخصم الوهمي (الافتراضي)');
  await expect(bar.locator('[data-fl-fake-text]')).toHaveText('من 0 لـ 1,000: + 500 ج.م · من 1,001 لـ 2,000: + 1,000 ج.م · من 2,001 فيما فوق: + 1,500 ج.م');
  await expect(bar.locator('[data-fl-fake-reset]')).toHaveCount(0);
  // 1,430 and 1,150 are both in the second tier: + 1,000
  await expect(reg(page, 0)).toHaveValue('2430'); await expect(sale(page, 1)).toHaveValue('1150'); await expect(reg(page, 1)).toHaveValue('2150');
  // a sale price typed by hand: its «قبل الخصم» is its tier's (900 → the first tier, + 500)
  await sale(page, 1).fill('900'); await sale(page, 1).press('Tab');
  await expect(reg(page, 1)).toHaveValue('1400');

  // «تعديل» — the same popup, for this batch: the second tier + 300 instead of + 1,000
  await bar.locator('[data-fl-fake-edit]').click();
  const f = modal(page).filter({ hasText: 'الخصم الوهمي للدفعة دي' });
  await expect(f.locator('[data-fk-row]')).toHaveCount(3);
  await expect(f).toContainText('التعديل هنا للدفعة دي بس');
  await f.locator('[data-fk="val:2"]').fill('300');
  await f.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await expect(f).toBeHidden();
  await expect(bar).toHaveAttribute('data-fl-fake', 'batch'); await expect(bar).toContainText('الخصم الوهمي (للدفعة دي)');
  await expect(reg(page, 0)).toHaveValue('1730'); // priced again at once
  await expect(sale(page, 1)).toHaveValue('900'); await expect(reg(page, 1)).toHaveValue('1400'); // the hand-typed sale stays, its tier did not change
  await expect.poll(() => ((batch().state.fake || {}).tiers || []).map((t) => t.value)).toEqual([500, 300, 1500]);
  expect(row('makers').fake).toEqual(OWNER); // the default was not touched

  // «قبل الخصم» typed by hand stays through a change of the tiers; «رجّع الافتراضي» drops the batch's own
  await reg(page, 0).fill('1999'); await reg(page, 0).press('Tab');
  await bar.locator('[data-fl-fake-reset]').click();
  await expect(bar).toHaveAttribute('data-fl-fake', 'default');
  await expect(reg(page, 0)).toHaveValue('1999');
  await expect.poll(() => batch().state.fake === undefined).toBe(true);
  // «احسب السعر تاني» on the row: back to the rule
  await page.locator('#pg-products [data-fl-prices] [data-row]').first().locator('.c-menu button').click();
  await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'احسب السعر تاني' }).first().click();
  await expect(reg(page, 0)).toHaveValue('2430');

  // the admin: «احفظها كافتراضي في الإعدادات كمان» — the default changes and the batch follows it (no own tiers kept)
  await bar.locator('[data-fl-fake-edit]').click();
  await f.locator('[data-fk="val:2"]').fill('700');
  await f.locator('[data-fk="asDefault"]').check();
  await f.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await expect.poll(() => ((row('makers').fake || {}).tiers || []).map((t) => t.value)).toEqual([500, 700, 1500]);
  await expect(bar).toHaveAttribute('data-fl-fake', 'default');
  await expect(reg(page, 0)).toHaveValue('2130');
  await expect.poll(() => batch().state.fake === undefined).toBe(true);
  expect(await page.evaluate(() => window.IBFakeDiscount.rule().tiers[1].value)).toBe(700);
});

test('the sheet flow › الأسعار with no default tiers: the old sale + 15–30%; tiers for this batch alone; every tier removed = the old way for it', async ({ page }) => {
  await toPrices(page);
  const bar = page.locator('#pg-products [data-fl-fake]');
  await expect(bar.locator('[data-fl-fake-text]')).toHaveText('سعر البيع + 15–30% عشوائي لأقرب 10');
  const old = Number(await reg(page, 0).inputValue());
  expect(old).toBeGreaterThanOrEqual(1650); expect(old).toBeLessThanOrEqual(1860); // 1,430 × 1.15 … 1.30 up to the next 10
  await bar.locator('[data-fl-fake-edit]').click();
  const f = modal(page).filter({ hasText: 'الخصم الوهمي للدفعة دي' });
  await f.locator('[data-fk="type:1:percent"]').click(); await f.locator('[data-fk="val:1"]').fill('50'); // one tier, «فيما فوق»: + 50%
  await f.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await expect(bar).toHaveAttribute('data-fl-fake', 'batch');
  await expect(reg(page, 0)).toHaveValue('2150'); // 1,430 × 1.5 = 2,145 up to the next 10
  await expect(reg(page, 1)).toHaveValue('1730'); // 1,150 × 1.5 = 1,725
  expect(row('makers').fake == null).toBe(true);
  // every tier removed for the batch = the old way for it (and it stays the batch's own choice)
  await bar.locator('[data-fl-fake-edit]').click();
  await f.locator('[data-fk-del="1"]').click();
  await f.getByRole('button', { name: 'طبّق على الدفعة' }).click();
  await expect(bar).toHaveAttribute('data-fl-fake', 'batch');
  await expect(bar.locator('[data-fl-fake-text]')).toHaveText('سعر البيع + 15–30% عشوائي لأقرب 10');
  expect(Number(await reg(page, 0).inputValue())).toBe(old); // the row's own markup, kept
  await expect.poll(() => JSON.stringify(batch().state.fake)).toBe('{"tiers":[]}');
});

// decision 4: every other place a price is worked out from the maker's price reads the default
test('the product page and the bulk price: «قبل الخصم» from the default tiers', async ({ page }) => {
  seed(OWNER);
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="products"]').click();
  await page.locator('#pg-products [role=tab]', { hasText: 'سجل المنتجات' }).click();
  await page.locator('[data-pedit="9003"]').click(); // its own commission 20% + 10
  await page.getByRole('tab', { name: 'السعر والمخزون' }).click();
  await expect(page.locator('[data-vcalc]')).toContainText('قبل الخصم = سعر البيع + زيادة شريحته من «الخصم الوهمي»');
  await page.fill('#e-vin', '1000');
  await page.locator('[data-vapply]').click();
  await expect(page.locator('#e-sale')).toHaveValue('1270'); // 1010 ÷ 0.8 = 1262.5 → 1270
  await expect(page.locator('#e-reg')).toHaveValue('2270'); // the second tier: + 1,000
  await page.fill('#e-vin', '2000');
  await page.locator('[data-vapply]').click();
  await expect(page.locator('#e-sale')).toHaveValue('2520'); // 2010 ÷ 0.8 = 2512.5 → 2520
  await expect(page.locator('#e-reg')).toHaveValue('4020'); // «فيما فوق»: + 1,500
  // the bulk price: «سعر المبتكر» +10% on one product → its new sale price + its tier's addition, exactly
  await page.evaluate(() => { location.hash = 'products-records'; });
  await page.locator('#pg-products .pr-table tbody tr').filter({ has: page.locator('b', { hasText: /^Cushion$/ }) }).locator('[role=checkbox]').click();
  await page.locator('.bulk-bar').getByRole('button', { name: 'تعديل السعر' }).click();
  await expect(page.locator('.modal')).toContainText('بشرايح «الخصم الوهمي»');
  await page.locator('.modal').getByRole('radio', { name: 'سعر المبتكر' }).click();
  await page.fill('.modal #amount', '10');
  await page.locator('.modal').getByRole('button', { name: 'طبّق السعر' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  const w = mock.productWrites.at(-1); const sale = Number(w.fields.sale_price); const regular = Number(w.fields.regular_price);
  expect(w.id).toBe(9001); expect(sale).toBeGreaterThan(1200);
  expect(regular - sale).toBe(sale <= 1000 ? 500 : sale <= 2000 ? 1000 : 1500);
});
