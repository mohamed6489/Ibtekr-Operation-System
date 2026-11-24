import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The order edit in tabs + «حالة المنتج» and «ملغي» + «+ إضافة منتج» (docs/superpowers/plans/2026-11-14-order-edit-tabs.md, the owner
// 14 Nov). Mock only: the cases assert the writes the mock recorded (subStatuses / lineAdds / patches) and its copy of 0094's
// cancel cascade (an order cancelled, a sub-order «cancelled» on the site → their products «ملغي»).
const ADMIN = 'admin.dev@ibtekr.local';
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'the mocked Supabase only');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

const cards = (page) => page.locator('#orders #list .card');
const card = (page, id) => page.locator(`#orders .card[data-o="${id}"]`);
const sr = (page, sel) => page.locator('#orders ' + sel);
const toast = (page) => page.locator('#orders #toast');
async function openOrders(page) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(cards(page)).toHaveCount(3);
  for (let i = 0; i < 2; i++) { const b = cards(page).nth(i).locator('[data-tg]').first(); if ((await b.getAttribute('aria-label')) === 'فتح') await b.click(); }
}
const openMenu = async (page, key) => { await sr(page, `[data-more="${key}"]`).first().click(); await expect(sr(page, '#mpop')).toBeVisible(); };
const editOrder = async (page, id) => { await openMenu(page, 'o:' + id); await sr(page, '#mpop [data-ma="edit"]').click(); };

test('decisions 3 and 4: ⋮ of a product — «تعديل الحالة على الموقع», no «مسح الأوردر الفرعي» / «تعديل الكمية»; its «تعديل» has no customer data, «حالة المنتج», and «الحالة على الموقع» (several makers only) — «ملغي» there cancels its products', async ({ page }) => {
  Object.assign(mock.orders.find((o) => o.id === 181668), { confirm: 'مؤكد بدون عربون', confirm_at: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) }); // confirmed 30 days ago: late (the owner 15 Nov — from the confirmation)
  await openOrders(page);
  const badge = card(page, '181668').locator('select[data-ss="5001"]').locator('xpath=ancestor::div[contains(@class,"row")][1]').locator('.badge');
  await expect(badge).toHaveText('متأخر');
  await openMenu(page, 's:5001');
  const menu = sr(page, '#mpop');
  await expect(menu.locator('[data-ma="sitest"]')).toHaveText('تعديل الحالة على الموقع');
  await expect(menu.locator('[data-ma="linedel"]')).toHaveText('مسح المنتج');
  await expect(menu.locator('[data-ma="subdel"]')).toHaveCount(0);
  await expect(menu.locator('[data-ma="qty"]')).toHaveCount(0);
  await menu.locator('[data-ma="edit"]').click();
  const dlg = sr(page, '#cdlg');
  await expect(dlg.locator('#edt')).toHaveText('تعديل المنتج — الأوردر الفرعي #181669');
  await expect(dlg).not.toContainText('معلومات العميل');
  await expect(dlg.locator('[data-f="name"], [data-f="phone"]')).toHaveCount(0);
  await expect(dlg.locator('label[for="ess"]')).toHaveText('حالة المنتج');
  await expect(dlg.locator('#ess option')).toContainText(['ملغي']);
  await expect(dlg.locator('#esite')).toHaveValue('processing');
  await expect(dlg.locator('[data-sub-many]')).toContainText('الحالة على الموقع بتتغيّر للقطع كلها مع بعض');
  await dlg.locator('#esite').selectOption('cancelled');
  await dlg.locator('[data-eok]').click();
  await expect(dlg).toHaveCount(0);
  await expect(toast(page)).toHaveText('الأوردر الفرعي #181669 بقى «ملغي» على الموقع');
  expect(mock.subStatuses).toEqual([{ order_id: 181668, sub_id: 181669, status: 'cancelled', by: ADMIN }]);
  // 0094: the sub-order «cancelled» → its product «ملغي» (the server's trigger; no write of the line from the page)
  await expect(card(page, '181668').locator('select[data-ss="5001"]')).toHaveValue('ملغي');
  expect(mock.orderItems.find((i) => i.id === 5001).status).toBe('ملغي');
  expect(mock.orderItems.find((i) => i.id === 5002).status).toBe('مؤكد'); // the other maker's
  expect(mock.patches.filter((p) => p.table === 'order_items')).toEqual([]);
  // a cancelled product has no delay counter on its line — «مقفول» (the owner 15 Nov: not «غير متأخر»)
  await expect(badge).toHaveText('مقفول');
  // an order of one maker: no «الحالة على الموقع» (its status = the order's)
  await openMenu(page, 's:5003');
  await expect(sr(page, '#mpop [data-ma="sitest"]')).toHaveCount(0);
  await sr(page, '#mpop [data-ma="edit"]').click();
  await expect(dlg.locator('#edt')).toHaveText('تعديل المنتج — IB-180686');
  await expect(dlg.locator('#esite')).toHaveCount(0);
  await dlg.locator('.cf [data-cc]').click();
});

test('decisions 1 and 2: the order cancelled → its products «ملغي» (a returned one stays); «ملغي» is a product status by hand too', async ({ page }) => {
  mock.orderItems.find((i) => i.id === 5002).status = 'مرتجع للمبتكر';
  await openOrders(page);
  await card(page, '181668').locator('select[data-st="181668"]').selectOption('ملغي');
  const kd = page.locator('.modal[role=dialog]', { hasText: 'إلغاء — IB-181668' });
  await expect(kd).toBeVisible();
  await kd.locator('#reason').click();
  await page.locator('[role=listbox] [role=option]').first().click();
  await kd.getByRole('button', { name: 'تأكيد' }).click();
  await expect(kd).toHaveCount(0);
  await expect(card(page, '181668').locator('select[data-ss="5001"]')).toHaveValue('ملغي');
  await expect(card(page, '181668').locator('select[data-ss="5002"]')).toHaveValue('مرتجع للمبتكر');
  expect(mock.orderItems.find((i) => i.id === 5001).status).toBe('ملغي');
  expect(mock.orderItems.find((i) => i.id === 5002).status).toBe('مرتجع للمبتكر');
  // by hand on another order's product
  await card(page, '180686').locator('select[data-ss="5003"]').selectOption('ملغي');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'order_items').map((p) => [p.id, p.status])).toEqual([[5003, 'ملغي']]);
});

test('decision 5: the order\'s «تعديل» in two tabs — the customer and the details side by side (saved as before), the sub-orders: a card per sub-order with its site status and its products; actions run at once', async ({ page }) => {
  await openOrders(page);
  await editOrder(page, '181668');
  const dlg = sr(page, '#cdlg');
  // Safwat 24 Nov — «جنب بعض في التعديل كمان»: the customer's and the order's cards side by side, as in the details popup
  await expect(dlg.locator('[role=tab]')).toHaveText(['بيانات الأوردر', 'الأوردرات الفرعية (2)']);
  await expect(dlg.locator('[data-etab="info"]')).toHaveAttribute('aria-selected', 'true');
  const info = dlg.locator('[data-epanel="info"]');
  await expect(info).toBeVisible();
  await expect(info.locator('.dgrid > .sec')).toHaveCount(2);
  await expect(info.locator('[data-det-sec]')).toBeVisible();
  const [a, b] = [await info.locator('.dgrid > .sec').nth(0).boundingBox(), await info.locator('.dgrid > .sec').nth(1).boundingBox()];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); // one row
  await expect(dlg.locator('[data-f="name"]')).toHaveValue('سلوى زيتوني');
  // the details: «حفظ التعديلات» as before
  await dlg.locator('[data-f="note"]').fill('اتكلمنا معاها');
  // the sub-orders tab: two cards, the site status of each, the products
  await dlg.locator('[data-etab="subs"]').click();
  const subs = dlg.locator('[data-epanel="subs"] .esub');
  await expect(subs).toHaveCount(2);
  await expect(subs.nth(0).locator('.est > b')).toHaveText('الأوردر الفرعي #181669');
  await expect(subs.nth(0).locator('[data-site-now]')).toHaveText('جاري التنفيذ');
  await expect(subs.nth(1).locator('[data-site-now]')).toHaveText('معلّق');
  await expect(subs.nth(0).locator('.eline')).toHaveCount(1);
  await expect(subs.nth(0).locator('.eline')).toContainText('Cushion');
  await expect(subs.nth(0).locator('.elq b')).toHaveText('2');
  await expect(subs.nth(0).locator('.elv b')).toHaveText('1,002 ج.م');
  await expect(subs.nth(0).locator('label[for="ess5001"]')).toHaveText('حالة المنتج');
  // «حالة المنتج» runs at once and leaves the details form as it is (not counted as unsaved)
  await subs.nth(0).locator('select[data-ss="5001"]').selectOption('قيد التنفيذ');
  await expect.poll(() => mock.patches.filter((p) => p.table === 'order_items').map((p) => [p.id, p.status])).toEqual([[5001, 'قيد التنفيذ']]);
  await expect(dlg.locator('[data-epanel="subs"] select[data-ss="5001"]')).toHaveValue('قيد التنفيذ');
  // «تعديل الحالة على الموقع» from the card — its popup over this one
  await subs.nth(1).locator('[data-esite]').click();
  const top = page.locator('#orders #cscrim').last().locator('#cdlg');
  await expect(top.locator('#cdt')).toHaveText('تعديل الحالة على الموقع — الأوردر الفرعي #181670');
  await top.locator('#cwst').selectOption('processing');
  await top.locator('[data-cok]').click();
  await expect(page.locator('#orders #cscrim')).toHaveCount(1);
  expect(mock.subStatuses).toEqual([{ order_id: 181668, sub_id: 181670, status: 'processing', by: ADMIN }]);
  await expect(dlg.locator('[data-epanel="subs"] .esub').nth(1).locator('[data-site-now]')).toHaveText('جاري التنفيذ');
  // the details are still to save
  await dlg.locator('[data-eok]').click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => mock.patches.filter((p) => p.table === 'orders')).toEqual([{ table: 'orders', id: 181668, note: 'اتكلمنا معاها' }]);
  // an order of one maker: one card for the order, no site status
  await editOrder(page, '180686');
  await dlg.locator('[data-etab="subs"]').click();
  await expect(dlg.locator('[data-epanel="subs"] .esub')).toHaveCount(1);
  await expect(dlg.locator('.esub .est > b')).toHaveText('الأوردر IB-180686');
  await expect(dlg.locator('.esub [data-site-now], .esub [data-esite]')).toHaveCount(0);
  await expect(dlg.locator('.esub [data-eadd]')).toHaveText('+ إضافة منتج');
  // «مسح المنتج» from the tab: the order's only product → the order's own «مسح»
  await dlg.locator('.esub [data-edel="5003"]').click();
  await expect(toast(page)).toHaveText('ده المنتج الوحيد في الأوردر — هيتمسح الأوردر كله');
  await expect(page.locator('#orders #cscrim').last().locator('#cdt')).toHaveText('مسح الأوردر IB-180686؟');
});

test('decision 6: «+ إضافة منتج» — the maker\'s products only, the site price by default and changed by hand, a variable product asks for its variation; the line comes back into the tab', async ({ page }) => {
  await openOrders(page);
  await editOrder(page, '181668');
  const dlg = sr(page, '#cdlg');
  await dlg.locator('[data-etab="subs"]').click();
  // sub-order 181670 (Antikiano): Macrame Curtain (variable) and Macrame Feathers — not Art Craft's Cushion, not a translation / the trash
  await dlg.locator('[data-epanel="subs"] [data-eadd="181670"]').click();
  const add = page.locator('#orders #cscrim').last().locator('#cdlg');
  await expect(add.locator('#cdt')).toHaveText('إضافة منتج — الأوردر الفرعي #181670');
  await expect(add.locator('[data-aplist] [role=option] b')).toHaveText(['Macrame Curtain', 'Macrame Feathers']);
  await add.locator('#aq').fill('feath');
  await expect(add.locator('[data-aplist] [role=option]')).toHaveCount(1);
  await add.locator('#aq').fill('');
  // nothing picked → the error, nothing sent
  await add.locator('[data-cok]').click();
  await expect(add.locator('#aerr')).toHaveText('اختار المنتج من القايمة');
  // the variable one: the site's price at first, then asked for its variation
  await add.locator('[data-ap="9002"]').click();
  await expect(add.locator('[data-ap="9002"]')).toHaveAttribute('aria-selected', 'true');
  await expect(add.locator('#aprice')).toHaveValue('1200');
  await add.locator('[data-q="1"]').click();
  await expect(add.locator('#cqty')).toHaveValue('2');
  await expect(add.locator('[data-qv]')).toHaveText('2,400 ج.م');
  await add.locator('[data-cok]').click();
  await expect(add.locator('#aerr')).toContainText('المنتج ده ليه تركيبات');
  await expect(add.locator('#avar option')).toHaveText(['— اختار التركيبة —', '40 سم · 300 ج.م', '60 سم · 350 ج.م']);
  expect(mock.lineAdds || []).toEqual([]);
  await add.locator('#avar').selectOption('90022');
  await expect(add.locator('#aprice')).toHaveValue('350'); // the variation's price while the price was not typed
  await add.locator('#aprice').fill('320'); // changed by hand
  await expect(add.locator('[data-qv]')).toHaveText('640 ج.م');
  await add.locator('[data-cok]').click();
  await expect(page.locator('#orders #cscrim')).toHaveCount(1);
  await expect(toast(page)).toHaveText('اتضاف «Macrame Curtain» × 2 على الأوردر الفرعي #181670 — الأوردر الأصلي على الموقع زي ما هو');
  expect(mock.lineAdds).toEqual([{ order_id: 181668, sub_id: 181670, product_id: 9002, variation_id: 90022, qty: 2, price: 320, by: ADMIN }]);
  expect(Number(mock.orders.find((o) => o.id === 181668).total)).toBe(3541); // the parent on the site untouched
  // the order read again: the new line in the tab and on the card
  await expect(dlg.locator('[data-esub="181670"] .eline')).toHaveCount(2);
  await expect(dlg.locator('[data-esub="181670"]')).toContainText('640 ج.م');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'order.line_add').map((a) => a.new_value)).toEqual(['IB-181668 · الفرعي #181670 · منتج #9002 / 90022 · × 2']);
  // the order of one maker: on the order itself, its total grows
  await dlg.locator('.cf [data-cc]').click();
  await editOrder(page, '180686');
  await dlg.locator('[data-etab="subs"]').click();
  await dlg.locator('[data-eadd]').click();
  await expect(add.locator('[data-aplist] [role=option] b')).toHaveText(['Cushion']);
  await add.locator('[data-ap="9001"]').click();
  await add.locator('[data-cok]').click();
  await expect(toast(page)).toHaveText('اتضاف «Cushion» × 1 على IB-180686');
  expect(mock.lineAdds[1]).toEqual({ order_id: 180686, sub_id: null, product_id: 9001, variation_id: null, qty: 1, price: 1200, by: ADMIN });
  // the site's writes off → said so, nothing added
  mock.pushEnabled = false;
  await dlg.locator('[data-eadd]').click();
  await add.locator('[data-ap="9001"]').click();
  await add.locator('[data-cok]').click();
  await expect(toast(page)).toHaveText('الكتابة على الموقع متقفلة — المنتج ماتضافش');
  expect(mock.lineAdds.length).toBe(2);
});

test('decision 7: settings › القوائم — «حالات المنتج» with «ملغي»', async ({ page }) => {
  await openOrders(page);
  await page.evaluate(() => { location.hash = 'settings-lists'; });
  const body = page.locator('#pg-settings');
  await body.getByRole('tab', { name: 'حالات المنتج' }).click();
  await expect(body.locator('[data-status="ملغي"]')).toHaveCount(1);
  await expect(body).toContainText('«ملغي» بتتحط تلقائي لما الأوردر الرئيسي يتلغي');
});
