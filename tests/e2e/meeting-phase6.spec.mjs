import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The meeting of 23 Nov — phase 6, the inventory and the products (docs/superpowers/plans/2026-11-23-meeting.md): the SKU fills the
// product and its maker in «استلام في المخزن» (the count's «+ قطعة» too) and another maker asks first [#38]; «فقد» — a lost return on the
// orders page or in the hub's inspection, the maker's «مفقودات» tab and column, the decision («مفقود محسوب» on his account or «مفقود غير
// محسوب») and the accounts' «مفقودات»
// [#39, Safwat 24 Nov]; one button «افتح الكل» / «اقفل الكل» on the categories [#8 — products.spec]. Mock only.
const ADMIN = 'admin.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; // Art Craft, Antikiano
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
async function openReceive(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.locator('.sidebar .nav-item[data-page="inventory"]').click();
  await expect(page.locator('#pg-inventory')).toBeVisible();
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  await modal(page, 'استلام في المخزن').getByRole('button', { name: 'استلام يدوي (من غير أوردر)' }).click();
  return modal(page, 'استلام في المخزن');
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });

test('[#38] the SKU fills the product and its maker from the site; both stay editable; another maker asks «متأكد؟» and «إلغاء» keeps the form', async ({ page }) => {
  const m = await openReceive(page);
  await m.locator('#sku').fill('IBTA4040PAHC000013');
  await expect(m.locator('#name')).toHaveValue('Cushion');
  await expect(m.locator('#vendor')).toHaveText('Art Craft');
  await expect(m).toContainText('المنتج ده على الموقع بتاع «Art Craft»');
  // a name typed by hand stays
  await m.locator('#name').fill('مخدة 40×40');
  await m.locator('#vendor').click(); await page.getByRole('option', { name: 'Antikiano' }).click();
  await m.locator('#qty').fill('2');
  await m.getByRole('radio', { name: /^متاح للبيع/ }).click();
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  const ask = modal(page, 'المبتكر مختلف');
  await expect(ask).toContainText('المنتج ده بتاع «Art Craft» — متأكد إنك عايز تسجّله على «Antikiano»؟');
  await ask.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(m.locator('#name')).toHaveValue('مخدة 40×40'); // the form is still there, nothing written
  expect(mock.invWrites.filter((w) => w.table === 'inv_lots')).toHaveLength(0);
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await modal(page, 'المبتكر مختلف').getByRole('button', { name: 'أيوه، سجّله على «Antikiano»' }).click();
  await expect.poll(() => mock.invWrites.filter((w) => w.table === 'inv_lots').length).toBe(1);
  expect(mock.invWrites.find((w) => w.table === 'inv_lots')).toMatchObject({ sku: 'IBTA4040PAHC000013', name: 'مخدة 40×40', vendor_id: V2 });
});

test('[#38] the owner\'s maker goes through with no question; an SKU the site does not know fills nothing', async ({ page }) => {
  const m = await openReceive(page);
  await m.locator('#sku').fill('IBT-NOT-ON-SITE');
  await page.waitForTimeout(700);
  await expect(m.locator('#name')).toHaveValue('');
  await m.locator('#sku').fill('IBTA4040PAHC000013');
  await expect(m.locator('#name')).toHaveValue('Cushion');
  await m.getByRole('radio', { name: /^متاح للبيع/ }).click();
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect(modal(page, 'المبتكر مختلف')).toHaveCount(0);
  await expect.poll(() => mock.invWrites.filter((w) => w.table === 'inv_lots').length).toBe(1);
  expect(mock.invWrites.find((w) => w.table === 'inv_lots')).toMatchObject({ sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V1 });
});

const LOST = 'b7000000-0000-4000-8000-000000000154'; const RET = 'b7000000-0000-4000-8000-000000000155';
async function signIn(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}

test('[#39] the orders page: a product set «مرتجع للمخزن» and «فقد» is a return lot «مفقود» with its value — no move, nothing in the hub', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  const card = page.locator('#orders .card[data-o="181668"]'); await expect(card).toBeVisible();
  const tg = card.locator('[data-tg]').first(); if ((await tg.getAttribute('aria-label')) === 'فتح') await tg.click();
  await expect(page.locator('#orders select[data-ss="5002"]')).toBeVisible();
  await page.locator('#orders select[data-ss="5002"]').selectOption('مرتجع للمخزن');
  const m = modal(page, 'مرتجع للمخزن — فرعي #181670');
  await m.locator('#reason').click(); await page.getByRole('option').first().click();
  await m.getByRole('radio', { name: /^فقد/ }).click();
  await expect(m.locator('#value')).not.toHaveValue('');
  await m.locator('#value').fill('');
  await m.getByRole('button', { name: 'تسجيل مرتجع للمخزن' }).click();
  await expect(m).toContainText('اكتب القيمة');
  await m.locator('#value').fill('420');
  await m.getByRole('button', { name: 'تسجيل مرتجع للمخزن' }).click();
  const lot = () => mock.inv.inv_lots.find((l) => l.item_id === 5002);
  await expect.poll(lot).toMatchObject({ reason: 'مرتجع', status: 'مفقود', cost: 420, order_id: 181668, ref: '#181670' });
  expect(mock.inv.inv_moves.filter((x) => x.lot_id === lot().id)).toHaveLength(0);
  await expect.poll(() => mock.patches.find((p) => p.id === 5002)).toMatchObject({ table: 'order_items', status: 'مرتجع للمخزن' });
});

test('[#39] the maker\'s «مفقودات» tab and column: «فقد» → «حوّلها لحساب المبتكر» (his «إيداع» — مفقود محسوب) · «حوّلها مفقودات» with «أخرى» (مفقود غير محسوب); the accounts\' «مفقودات» lists both, out of the expenses', async ({ page }) => {
  mock.inv.inv_lots.push({ id: LOST, reason: 'مرتجع', status: 'مفقود', sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V1, order_id: 181668, item_id: 5001, ref: '#181669', loc: null, mode: 'أمانة', cost: 300, condition: null, condition_note: null, note: 'العميل رجّعه', since: new Date().toISOString().slice(0, 10), closed_at: null, created_by: null, created_at: new Date().toISOString(), product_id: null },
    { id: RET, reason: 'مرتجع', status: 'مفقود', sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', vendor_id: V1, order_id: 180686, item_id: 5003, ref: '#180686', loc: null, mode: 'أمانة', cost: 150, condition: null, condition_note: null, note: null, since: new Date().toISOString().slice(0, 10), closed_at: null, created_by: null, created_at: new Date().toISOString(), product_id: null });
  await signIn(page);
  // the makers' accounts: «مفقودات» = 450, shown only — out of the net
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await page.locator('#main').getByRole('tab', { name: 'حسابات المبتكرين' }).click();
  const art = page.locator('#main table.vendors-table tbody tr', { hasText: 'Art Craft' });
  await expect(art.locator('[data-vlost]')).toHaveText('450.00');
  // it opens his «مفقودات» tab
  await art.locator('[data-vlost]').click();
  const tab = page.locator('.drawer [data-lost-tab]');
  await expect(tab.locator('[data-lost-total]')).toHaveText('2 قطعة · 450.00 ج.م');
  // «فقد» on Cushion → on his account, 300 (مفقود محسوب)
  await tab.locator(`[data-lost-decide="${LOST}"]`).click();
  let d = modal(page, 'فقد — Cushion');
  await d.getByRole('button', { name: 'سجّل' }).click();
  await expect(d).toContainText('اختار تحوّلها فين');
  await d.getByRole('radio', { name: /^حوّلها لحساب المبتكر/ }).click();
  await d.getByRole('button', { name: 'سجّل' }).click();
  await expect.poll(() => mock.badDebts.length).toBe(1);
  expect(mock.badDebts[0]).toMatchObject({ lot_id: LOST, kind: 'deposit', amount: 300, reason: 'فقد المنتج' });
  expect(mock.acc.acc_vendor_moves.find((x) => x.id === mock.badDebts[0].vendor_move_id)).toMatchObject({ vendor_id: V1, direction: 'deposit', amount: 300 });
  await expect(tab.locator(`[data-lost="${LOST}"] [data-lost-decision="deposit"]`)).toHaveText('مفقود محسوب · 300.00');
  // «فقد» on the curtain → «حوّلها مفقودات» (مفقود غير محسوب), «أخرى» needs its text
  await tab.locator(`[data-lost-decide="${RET}"]`).click();
  d = modal(page, 'فقد — Macrame Curtain');
  await d.getByRole('radio', { name: /^حوّلها مفقودات/ }).click();
  await d.locator('#amount').fill('120');
  await d.getByRole('radio', { name: 'أخرى', exact: true }).click();
  await d.getByRole('button', { name: 'سجّل' }).click();
  await expect(d).toContainText('اكتب السبب');
  await d.locator('#note').fill('اتسرق من العربية');
  await d.getByRole('button', { name: 'سجّل' }).click();
  await expect.poll(() => mock.badDebts.length).toBe(2);
  expect(mock.badDebts[1]).toMatchObject({ lot_id: RET, kind: 'writeoff', amount: 120, reason: 'أخرى', note: 'اتسرق من العربية', vendor_move_id: null });
  await page.keyboard.press('Escape');
  // the accounts' «مفقودات»: both, with the totals; not an expense
  await page.locator('#main').getByRole('tab', { name: 'مفقودات' }).click();
  const cards = page.locator('#main [data-bad-cards] .kpi');
  await expect(cards.nth(0)).toContainText('420.00'); await expect(cards.nth(1)).toContainText('300.00'); await expect(cards.nth(2)).toContainText('120.00');
  await expect(page.locator('#main table.bad-debts-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#main table.bad-debts-table')).toContainText('أخرى: اتسرق من العربية');
  await expect(page.locator('#main table.bad-debts-table')).toContainText('مفقود غير محسوب');
  await expect(page.locator('#main table.bad-debts-table')).toContainText('مفقود محسوب');
  expect(mock.acc.acc_expenses).toHaveLength(0);
});

test('[#39] the hub\'s «فحص مرتجع»: «فقد» takes the piece out of the hub (an «out» move «فقد») and the lot is «مفقود» at the value written', async ({ page }) => {
  mock.inv.inv_lots.push({ id: RET, reason: 'مرتجع', status: 'بانتظار الفحص', sku: 'IBTA4040PAHC000013', name: 'Cushion', vendor_id: V1, order_id: 181668, item_id: 5001, ref: '#181669', loc: 'R', mode: 'أمانة', cost: 335, condition: null, condition_note: null, note: 'مرتجع', since: new Date().toISOString().slice(0, 10), closed_at: null, created_by: null, created_at: new Date().toISOString(), product_id: null });
  mock.inv.inv_moves.push({ id: 9154, lot_id: RET, type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: null, note: null, by: null, at: new Date().toISOString() });
  await signIn(page);
  await page.evaluate(() => { location.hash = 'inventory-now'; });
  const row = page.locator('#pg-inventory table tbody tr', { hasText: 'Cushion' }).first();
  await row.getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'فحص مرتجع' }).click();
  const f = modal(page, 'فحص مرتجع — Cushion');
  await f.getByRole('radio', { name: /^فقد/ }).click();
  await expect(f.locator('#value')).toHaveValue('335');
  await f.getByRole('button', { name: 'حفظ الفحص' }).click();
  await expect.poll(() => mock.inv.inv_lots.find((x) => x.id === RET)).toMatchObject({ status: 'مفقود', cost: 335 });
  await expect.poll(() => mock.inv.inv_moves.filter((x) => x.lot_id === RET && x.type === 'out')).toEqual([expect.objectContaining({ qty: 1, label: 'فقد' })]);
});
