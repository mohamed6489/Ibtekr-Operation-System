import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The inventory hub «المخزن» on real data (phase 7, docs/superpowers/plans/2026-11-04-phase-7-inventory.md): the v2 page (block 16)
// on IBInventory (0044) — the quantities from the moves, receiving writes a lot + its first move, a status change patches the lot,
// a count's lines carry the server's quantity and its approval writes the adjustments, and the buttons follow inventory.edit /
// inventory.approve. Mock only: the cases assert the mock's seed and the writes it recorded (mock.invWrites / activity).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; // Art Craft
const L1 = 'b7000000-0000-4000-8000-000000000001'; const L2 = 'b7000000-0000-4000-8000-000000000002';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {
    invLots: [{ id: L1, reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-AR-0999', name: 'سلة كروشيه', vendor_id: V1, loc: 'A', cost: 260, mode: 'أمانة' },
      { id: L2, reason: 'تصوير', status: 'مستني تصوير', sku: 'IBT-AR-1000', name: 'فازة سيراميك', vendor_id: V1, loc: 'P', cost: 300 }],
    invMoves: [{ lot_id: L1, type: 'in', qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع' }, { lot_id: L1, type: 'out', qty: 1, label: 'خروج', reason: 'متاح للبيع' },
      { lot_id: L2, type: 'in', qty: 1, label: 'دخول — تصوير', reason: 'تصوير' }],
  });
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});

async function signIn(page, email) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
async function openInventory(page, email = ADMIN) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="inventory"]').click();
  await expect(page.locator('#pg-inventory')).toBeVisible();
  await expect(page.locator('#pg-inventory')).toContainText('سلة كروشيه');
}
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
const rowOf = (page, name) => page.locator('#pg-inventory tr', { hasText: name });

test('«المخزون» is open: the lots from inv_lots, the quantity from the moves (3 in − 1 out = 2), the maker by its id', async ({ page }) => {
  await openInventory(page);
  await expect(page.locator('nav.sidebar .nav-item[data-page="inventory"]')).not.toHaveAttribute('data-soon', /.*/);
  const r = rowOf(page, 'سلة كروشيه');
  await expect(r).toContainText('Art Craft');
  await expect(r).toContainText('متاح للبيع');
  await expect(r.locator('td').nth(7)).toHaveText('2');
  await expect(rowOf(page, 'فازة سيراميك')).toContainText('مستني تصوير');
});

test('receiving by hand (no order) writes the lot and its first move (the maker\'s id, the place\'s code, the quantity) and the page reloads it', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  await modal(page, 'استلام في المخزن').getByRole('button', { name: 'استلام يدوي (من غير أوردر)' }).click(); // decision 8: «من أوردر» is the default
  const m = modal(page, 'استلام في المخزن');
  await m.locator('#name').fill('شنطة جلد');
  await m.locator('#sku').fill('IBT-AR-1001');
  await m.locator('#vendor').click(); await page.getByRole('option', { name: 'Art Craft' }).click();
  await m.locator('#qty').fill('4');
  await m.getByRole('radio', { name: /^متاح للبيع/ }).click();
  await m.locator('#loc').fill('B-03');
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect(rowOf(page, 'شنطة جلد')).toBeVisible();
  await expect.poll(() => mock.invWrites.filter((w) => w.table === 'inv_moves').length).toBe(1);
  const lot = mock.invWrites.find((w) => w.table === 'inv_lots');
  expect(lot).toMatchObject({ op: 'insert', reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-AR-1001', name: 'شنطة جلد', vendor_id: V1, loc: 'B', mode: 'أمانة' });
  expect(mock.invWrites.find((w) => w.table === 'inv_moves')).toMatchObject({ lot_id: lot.id, type: 'in', qty: 4, by: '00000000-0000-4000-8000-000000000001' });
  await expect(rowOf(page, 'شنطة جلد').locator('td').nth(7)).toHaveText('4');
});

test('a status change patches the lot (علّم إنه اتصور)', async ({ page }) => {
  await openInventory(page);
  await rowOf(page, 'فازة سيراميك').getByRole('button', { name: 'إجراءات فازة سيراميك' }).click();
  await page.getByRole('menuitem', { name: 'علّم إنه اتصور' }).click();
  await expect.poll(() => mock.invWrites.find((w) => w.table === 'inv_lots' && w.op === 'update')).toMatchObject({ status: 'اتصور', id: L2 });
  await expect(rowOf(page, 'فازة سيراميك')).toContainText('اتصور');
});

test('a manual adjustment needs inventory.approve: ops does not get «تسوية كمية»; the admin\'s writes an adjust move', async ({ page }) => {
  await openInventory(page, OPS);
  await rowOf(page, 'سلة كروشيه').getByRole('button', { name: 'إجراءات سلة كروشيه' }).click();
  await expect(page.getByRole('menuitem', { name: 'تفاصيل المنتج' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'تسوية كمية' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'استلام في المخزن' })).toBeVisible();
});

test('the admin\'s adjustment: the difference as an adjust move', async ({ page }) => {
  await openInventory(page);
  await rowOf(page, 'سلة كروشيه').getByRole('button', { name: 'إجراءات سلة كروشيه' }).click();
  await page.getByRole('menuitem', { name: 'تسوية كمية' }).click();
  const m = modal(page, 'تسوية كمية — سلة كروشيه');
  await m.locator('#qty').fill('1');
  await m.locator('#why').click(); await page.getByRole('option', { name: 'ضايع' }).click();
  await m.getByRole('button', { name: 'حفظ التسوية' }).click();
  await expect.poll(() => mock.invWrites.find((w) => w.table === 'inv_moves')).toMatchObject({ lot_id: L1, type: 'adjust', qty: -1, reason: 'ضايع' });
});

test('view only (accounts): no receiving, no count, no actions but the details', async ({ page }) => {
  await openInventory(page, ACCOUNTS);
  await expect(page.getByRole('button', { name: 'استلام في المخزن' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'جرد جديد' })).toHaveCount(0);
  await rowOf(page, 'فازة سيراميك').getByRole('button', { name: 'إجراءات فازة سيراميك' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  expect(mock.invWrites).toEqual([]);
});

test('a count: its lines carry the server\'s quantity, a counted figure is saved, the approval writes the adjustment', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'جرد جديد' }).click();
  const m = modal(page, 'جرد جديد');
  await m.getByRole('button', { name: /ابدأ/ }).click();
  await expect.poll(() => mock.inv.inv_count_lines.length).toBe(2);
  expect(mock.inv.inv_count_lines.find((l) => l.lot_id === L1).system).toBe(2);
  await expect(page.locator('#pg-inventory')).toContainText('اعتماد الجرد');
  const input = page.locator('#pg-inventory tr', { hasText: 'سلة كروشيه' }).locator('input').first();
  await input.fill('5'); await input.press('Tab');
  await expect.poll(() => (mock.inv.inv_count_lines.find((l) => l.lot_id === L1) || {}).counted).toBe(5);
  await page.getByRole('button', { name: 'اعتماد الجرد' }).click();
  await modal(page, 'اعتماد الجرد').getByRole('button', { name: 'اعتماد الجرد' }).click();
  await expect.poll(() => mock.inv.inv_moves.find((x) => x.type === 'adjust')).toMatchObject({ lot_id: L1, qty: 3, ref: 'CNT-1' });
  expect(mock.inv.inv_counts[0].status).toBe('approved');
});

test('the reports tab (decision 6): the pieces and the value now from the lots × their quantity', async ({ page }) => {
  await openInventory(page);
  await page.evaluate(() => { location.hash = 'inventory-reports'; });
  const kpi = (label) => page.locator('#pg-inventory .kpi', { hasText: label });
  await expect(kpi('قطع في المخزن الآن')).toContainText('3'); // 2 + 1
  await expect(kpi('قيمة المخزن')).toContainText('820'); // 260 × 2 + 300 × 1
  await expect(page.locator('#pg-inventory')).toContainText('أعلى 20 قطعة بالتكلفة');
});

// ---------- T5: the orders page writes the hub (plan decision 3) ----------
async function openOrders(page) {
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders .card[data-o="181668"]')).toBeVisible();
}
test('«تجميع في المخزن» from the orders page writes the consolidation of the picked lines (order_items ids)', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders .card[data-o="181668"] [data-more="o:181668"]').click();
  await page.locator('#orders #mpop [data-ma="cons"]').click();
  await modal(page, 'تجميع في المخزن — IB-181668').getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id).sort()).toEqual([5001, 5002]);
  expect(mock.inv.inv_consolidations).toHaveLength(1);
  expect(mock.inv.inv_consolidations[0]).toMatchObject({ order_id: 181668, zone: 'T', status: 'open' });
  await expect(page.locator('#orders .card[data-o="181668"] .consbar')).toContainText('0 من 2 وصلوا');
});

test('«وصل المخزن» on a line inside a consolidation: the lot of that line (item_id, order) + its in-move of the line\'s quantity', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders .card[data-o="181668"] [data-more="o:181668"]').click();
  await page.locator('#orders #mpop [data-ma="cons"]').click();
  await modal(page, 'تجميع في المخزن — IB-181668').getByRole('button', { name: 'ابدأ التجميع' }).click();
  await expect.poll(() => mock.inv.inv_consolidation_items.length).toBe(2);
  await page.locator('#orders select[data-ss="5001"]').selectOption('وصل المخزن');
  const m = modal(page, 'وصل المخزن — فرعي #181669');
  await expect(m.getByRole('radio', { name: /^تجميع أوردر/ })).toHaveAttribute('aria-checked', 'true');
  await m.getByRole('button', { name: 'تأكيد' }).click();
  await expect(m).toContainText('اختار المكان'); // decision 10: the place is required
  await m.locator('#loc').fill('T-01');
  await m.getByRole('button', { name: 'تأكيد' }).click();
  const lotOf = (item) => mock.inv.inv_lots.find((l) => l.item_id === item);
  await expect.poll(() => lotOf(5001)).toMatchObject({ reason: 'تجميع أوردر', status: 'وصل المخزن', order_id: 181668, name: 'Cushion', loc: 'T' });
  await expect.poll(() => mock.inv.inv_moves.filter((x) => x.lot_id === lotOf(5001).id)).toEqual([expect.objectContaining({ type: 'in', qty: 2 })]);
  await expect.poll(() => mock.patches.find((p) => p.id === 5001)).toMatchObject({ table: 'order_items', status: 'وصل المخزن' });
});

test('«مرتجع للمخزن» on a line: a «مرتجع — بانتظار الفحص» lot with the line and the reason, in the returns place', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-ss="5002"]').selectOption('مرتجع للمخزن');
  const m = modal(page, 'مرتجع للمخزن — فرعي #181670');
  await m.locator('#reason').click(); await page.getByRole('option').first().click();
  await m.getByRole('button', { name: 'تسجيل مرتجع للمخزن' }).click();
  const lot = () => mock.inv.inv_lots.find((l) => l.item_id === 5002);
  await expect.poll(lot).toMatchObject({ reason: 'مرتجع', status: 'بانتظار الفحص', order_id: 181668, loc: 'R', ref: '#181670' });
  expect(lot().note).toBeTruthy();
  await expect.poll(() => mock.inv.inv_moves.filter((x) => x.lot_id === lot().id)).toEqual([expect.objectContaining({ type: 'in', qty: 1, reason: 'مرتجع' })]);
  await page.evaluate(() => { location.hash = 'inventory-returns'; });
  await expect(page.locator('#pg-inventory')).toContainText('Macrame Curtain');
});

// ---------- T6: places and settings ----------
test('the settings tab: the admin\'s change is saved in the settings row «inventory» (auto-pull and the site quantity off by default); the places with their pieces; a new place', async ({ page }) => {
  await openInventory(page);
  await page.evaluate(() => { location.hash = 'inventory-settings'; });
  const first = page.getByRole('switch', { name: 'المخزن الأول' });
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'تحديث كمية الموقع' })).toHaveAttribute('aria-checked', 'false');
  await first.click();
  await expect.poll(() => (mock.settings.find((x) => x.section === 'inventory') || {}).data).toMatchObject({ firstWarehouse: true, wooSync: false, photoMax: 14 });
  const rack = page.locator('#pg-inventory tr', { hasText: 'رف A' });
  await expect(rack.locator('td').nth(2)).toHaveText('1'); await expect(rack.locator('td').nth(3)).toHaveText('2');
  await page.getByRole('button', { name: '+ مكان' }).click();
  const m = modal(page, 'مكان تخزين جديد');
  await m.locator('#code').fill('رف E'); await m.locator('#desc').fill('رف الشنط');
  await m.getByRole('button', { name: 'إضافة' }).click();
  await expect.poll(() => mock.inv.inv_locations.find((x) => x.code === 'E')).toMatchObject({ label: 'رف الشنط', kind: 'rack' });
  await expect(page.locator('#pg-inventory tr', { hasText: 'رف الشنط' })).toBeVisible();
});

test('the settings are the admin\'s: ops sees them read-only and can still add a place', async ({ page }) => {
  await openInventory(page, OPS);
  await page.evaluate(() => { location.hash = 'inventory-settings'; });
  await expect(page.getByRole('switch', { name: 'المخزن الأول' })).toBeDisabled();
  await expect(page.locator('#pg-inventory')).toContainText('إعدادات المخزن بيغيّرها الأدمن بس');
  await expect(page.getByRole('button', { name: '+ مكان' })).toBeVisible();
  expect(mock.settings.find((x) => x.section === 'inventory')).toBeUndefined();
});

// ---------- T7: auto-pull (decision 1 b) — built, off ----------
test('auto-pull from «متاح للبيع» is off by default; with «المخزن الأول» on it reserves the piece for the order (a reserve move) and the lot is «محجوز لأوردر»', async ({ page }) => {
  await openInventory(page);
  const pull = () => page.evaluate(() => window.IBPages.all().inventory.api.autoPull('IBT-AR-0999', 1, '181668'));
  expect(await pull()).toBe(false);
  expect(mock.invWrites).toEqual([]);
  await page.evaluate(() => { location.hash = 'inventory-settings'; });
  await page.getByRole('switch', { name: 'المخزن الأول' }).click();
  await expect.poll(() => (mock.settings.find((x) => x.section === 'inventory') || {}).data).toMatchObject({ firstWarehouse: true });
  expect(await pull()).toBe(true);
  await expect.poll(() => mock.inv.inv_moves.find((x) => x.type === 'reserve')).toMatchObject({ lot_id: L1, qty: 1, ref: 'IB-181668' });
  await expect.poll(() => mock.inv.inv_lots.find((x) => x.id === L1).status).toBe('محجوز لأوردر');
});

// ---------- decision 8 (owner, 4 Nov): receiving from an order ----------
test('«استلام في المخزن» from an order: search the order, its lines with a box each, the ticked lines become lots tied to their order line', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m = modal(page, 'استلام في المخزن');
  await m.locator('#rc-q').fill('181668');
  await expect(m.locator('[data-rc-order]')).toHaveCount(1);
  await m.locator('[data-rc-order="181668"]').click();
  const lines = m.locator('[data-rc-lines] [role=checkbox]');
  await expect(lines).toHaveCount(2);
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect(m).toContainText('علّم على منتج واحد على الأقل');
  await lines.filter({ hasText: 'Cushion' }).click();
  await m.getByRole('radio', { name: /^متاح للبيع/ }).click();
  await m.getByRole('radio', { name: /^ملك ابتكر/ }).click();
  await m.locator('#loc').fill('A-02');
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  const lot = () => mock.inv.inv_lots.find((l) => l.item_id === 5001);
  await expect.poll(lot).toMatchObject({ reason: 'متاح للبيع', status: 'متاح', order_id: 181668, name: 'Cushion', sku: 'IBTA4040PAHC000013', mode: 'ملك ابتكر', loc: 'A', cost: 651.3 }); // decision 10: the maker's price — 1002 less the line's 35%
  expect(mock.inv.inv_lots.find((l) => l.item_id === 5002)).toBeUndefined();
  await expect.poll(() => mock.inv.inv_moves.filter((x) => x.lot_id === lot().id)).toEqual([expect.objectContaining({ type: 'in', qty: 2 })]);
  // the line already in the hub is not offered again
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m2 = modal(page, 'استلام في المخزن');
  await m2.locator('#rc-q').fill('IB-181668');
  await m2.locator('[data-rc-order="181668"]').click();
  await expect(m2.locator('[data-rc-lines] [role=checkbox]', { hasText: 'Cushion' })).toBeDisabled();
  await expect(m2.locator('[data-rc-lines] [role=checkbox]', { hasText: 'Macrame Curtain' })).toBeEnabled();
});

test('the order search matches the customer\'s name too; a word with no order says so', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m = modal(page, 'استلام في المخزن');
  const name = await page.evaluate(() => window.IBOrders.data().orders.find((o) => o.id === '181668').name);
  await m.locator('#rc-q').fill(name.slice(0, 3));
  await expect(m.locator('[data-rc-order="181668"]')).toBeVisible();
  await m.locator('#rc-q').fill('zzzz-مفيش');
  await expect(m).toContainText('مفيش أوردر بالرقم أو الاسم ده');
});

test('receiving an order\'s line as «تجميع أوردر» opens the order\'s consolidation (its lines not shipped), the line counts as arrived, «بتتجمع» shows it', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m = modal(page, 'استلام في المخزن');
  await m.locator('#rc-q').fill('181668');
  await m.locator('[data-rc-order="181668"]').click();
  await m.locator('[data-rc-lines] [role=checkbox]', { hasText: 'Cushion' }).click();
  await m.getByRole('radio', { name: /^تجميع أوردر/ }).click();
  await m.locator('#loc').fill('T-01');
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect.poll(() => mock.inv.inv_consolidation_items.map((x) => x.item_id).sort()).toEqual([5001, 5002]);
  expect(mock.inv.inv_consolidations).toEqual([expect.objectContaining({ order_id: 181668, zone: 'T', status: 'open' })]);
  await expect(page.locator('#pg-inventory .kpi, #pg-inventory [data-details]', { hasText: 'بتتجمع' }).first()).toContainText('1');
  await page.evaluate(() => { location.hash = 'inventory-consolidate'; });
  await expect(page.locator('#pg-inventory')).toContainText('1 من 2');
  // the second line received later joins the same consolidation (no second one)
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m2 = modal(page, 'استلام في المخزن');
  await m2.locator('#rc-q').fill('181668');
  await m2.locator('[data-rc-order="181668"]').click();
  await m2.locator('[data-rc-lines] [role=checkbox]', { hasText: 'Macrame Curtain' }).click();
  await m2.getByRole('radio', { name: /^تجميع أوردر/ }).click();
  await m2.locator('#loc').fill('T-01');
  await m2.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect.poll(() => mock.inv.inv_lots.filter((l) => l.order_id === 181668).length).toBe(2);
  expect(mock.inv.inv_consolidations).toHaveLength(1);
  await expect(page.locator('#pg-inventory')).toContainText('2 من 2');
  await expect.poll(() => mock.inv.inv_lots.filter((l) => l.order_id === 181668).map((l) => l.status)).toEqual(['جاهز يطلع كامل', 'جاهز يطلع كامل']); // the last line made the order ready
});

// ---------- decision 9 (owner, 4 Nov): the gathered order goes «قيد الشحن» → its pieces leave the hub ----------
test('a gathered order saved as «قيد الشحن» on the orders page: its pieces leave the hub (out moves), the consolidation closes, the lines are «تم الشحن للعميل»', async ({ page }) => {
  await openInventory(page);
  await page.getByRole('button', { name: 'استلام في المخزن' }).click();
  const m = modal(page, 'استلام في المخزن');
  await m.locator('#rc-q').fill('181668');
  await m.locator('[data-rc-order="181668"]').click();
  await m.getByRole('button', { name: 'اختار الكل' }).click();
  await m.getByRole('radio', { name: /^تجميع أوردر/ }).click();
  await m.locator('#loc').fill('T-01');
  await m.getByRole('button', { name: 'استلام', exact: true }).click();
  await expect.poll(() => mock.inv.inv_consolidations.length).toBe(1);
  await expect.poll(() => mock.inv.inv_moves.filter((x) => x.type === 'in' && mock.inv.inv_lots.some((l) => l.id === x.lot_id && l.order_id === 181668)).length).toBe(2);
  await page.evaluate(() => { location.hash = 'orders'; });
  await page.locator('#orders select[data-st="181668"]').selectOption('قيد الشحن');
  const outs = () => mock.inv.inv_moves.filter((x) => x.type === 'out' && x.ref === 'IB-181668');
  await expect.poll(() => outs().map((x) => x.qty).sort()).toEqual([1, 2]); // Cushion × 2, Macrame Curtain × 1
  await expect.poll(() => mock.inv.inv_consolidations[0].status).toBe('shipped');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'order_items' && p.status === 'تم الشحن للعميل').map((p) => p.id).sort()).toEqual([5001, 5002]);
  await page.evaluate(() => { location.hash = 'inventory-consolidate'; });
  await expect(page.locator('#pg-inventory')).not.toContainText('IB-181668');
});

test('an order not gathered in the hub going «قيد الشحن» writes nothing to the hub', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'orders'; });
  await page.locator('#orders select[data-st="181668"]').selectOption('قيد الشحن');
  await expect.poll(() => mock.patches.find((p) => p.table === 'orders')).toBeTruthy();
  expect(mock.invWrites).toEqual([]);
});
