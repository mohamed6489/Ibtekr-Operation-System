import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, XSS_NAME, IMG } from './supabase-mock.mjs';
// The orders page (block 29) on the orders of the last 12 months (phase 2 Task 6): hydrated from IBOrders, every edit written
// through IBOrdersStore (a refused write puts the old value back), site strings rendered as text, no prototype seed left.
// Mock only: the cases assert the mock's seed (3 orders of the last days + one older than 12 months) and the writes it
// recorded (mock.patches / mock.pushes / mock.syncs); E2E_SUPABASE_LIVE=1 skips them.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local'; // accounts: orders.status N, sensitive.customer_phone N
const EVIL = '"><img src=x onerror="window.__xss=1">'; // breaks out of an attribute or a tag when not escaped
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

// the sign-in waits for the orders load (IBDirectory.load): `timeout` when that load is made to fail
async function signIn(page, email, { timeout } = {}) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', email);
  await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible({ timeout });
}
// signed in, on #orders, the three mock orders drawn
async function openOrders(page, email = ADMIN) {
  await signIn(page, email);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders')).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
}
const cards = (page) => page.locator('#orders #list .card');
const card = (page, id) => page.locator(`#orders .card[data-o="${id}"]`);
const toast = (page) => page.locator('#orders #toast');
// nothing a site string carried ran or became an element (the shadow root and the light DOM)
const inert = async (page) => {
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length + document.getElementById('orders').shadowRoot.querySelectorAll('img[src="x"]').length)).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
};

test('the orders page lists real orders and no seed', async ({ page }) => {
  await openOrders(page);
  await expect(page.locator('#orders #cn')).toHaveText('3');
  await expect(card(page, '181668')).toContainText('سلوى زيتوني'); // the newest two open, as before
  await expect(card(page, '181668').locator('.band')).toContainText('0120 000 7052');
  await expect(card(page, '181668').locator('.band a.wa')).toHaveAttribute('href', 'https://wa.me/201200007052');
  await expect(card(page, '181668').locator('.band')).toContainText('الدفع عند الاستلام'); // the site's payment title
  await expect(page.locator('#orders .oroot')).not.toContainText('Customer 48');
  await expect(page.locator('#orders .oroot')).not.toContainText('IB-150001'); // older than 12 months: never asked
  await expect(page.locator('#orders .ph')).not.toContainText('Airtable');
  expect(await page.evaluate(() => [window.OrdersApp.get('180492'), window.OrdersApp.query({}, 10).total, window.OrdersApp.vendors()])).toEqual([null, 3, ['Antikiano', 'Art Craft']]);
  // the removed line of 180686 is not shown: one sub-order, 2 × Cushion
  await expect(card(page, '180686').locator('.so .row:not(.h)')).toHaveCount(1);
  await expect(card(page, '180686')).not.toContainText('Cushion Cover');
});

test('an html customer name renders inert', async ({ page }) => {
  await openOrders(page);
  await card(page, '180656').locator('[data-tg="180656"]').click();
  await expect(card(page, '180656').locator('.band')).toContainText(XSS_NAME);
  await page.locator('#orders #oq').fill('<img');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('#orders #oq')).toHaveValue('<img');
  await page.evaluate(() => window.OrdersApp.details('180656'));
  await expect(page.locator('#orders #ddt')).toContainText(XSS_NAME);
  await inert(page);
});

test('every site string renders as text: cards (desktop, tablet, mobile), filters and dialogs', async ({ page }) => {
  await openOrders(page);
  await page.evaluate((evil) => {
    const d = window.IBOrders.data(); const o = d.orders.find((x) => x.id === '181668');
    Object.assign(o, { name: evil, phone: evil, pay: evil, note: evil, city: evil, addr: evil, st: evil, cf: evil });
    Object.assign(o.subs[0], { prod: evil, sku: evil, vendor: evil, cm: evil, ss: evil, exp: evil });
    d.vendors = d.vendors.concat(evil); d.images = Object.assign({}, d.images, { [evil]: 'javascript:alert(1)' });
    window.OrdersApp.hydrate(d);
  }, EVIL);
  await expect(card(page, '181668')).toContainText(EVIL);
  await expect(page.locator('#orders #fv option', { hasText: EVIL })).toHaveCount(1);
  await inert(page);
  for (const width of [800, 375]) { // tablet, mobile templates
    await page.setViewportSize({ width, height: 900 });
    await expect(card(page, '181668')).toContainText(EVIL);
    await inert(page);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.OrdersApp.edit('181668'));
  await expect(page.locator('#orders #cdlg [data-f="name"]')).toHaveValue(EVIL);
  await inert(page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.OrdersApp.editSub(5001));
  await expect(page.locator('#orders #cdlg [data-f="cm"]')).toHaveValue(EVIL);
  await inert(page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.OrdersApp.details('181668', 'subs'));
  await expect(page.locator('#orders #ddt')).toContainText(EVIL);
  await inert(page);
});

test('a status change writes the order and pushes it to the site', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-st="180656"]').selectOption('جاري التنفيذ');
  await expect.poll(() => mock.pushes.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 180656, status: 'جاري التنفيذ' }]);
  expect(mock.pushes).toEqual([{ action: 'push_status', order_id: 180656, status: 'جاري التنفيذ', result: 'ok' }]);
  expect(mock.orders.find((o) => o.id === 180656).woo_status).toBe('processing');
  await expect(card(page, '180656').locator('.sdd')).toContainText('جاري التنفيذ');
});

test('a status with no Woo slug is saved but not pushed', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-st="181668"]').selectOption('تم RTC');
  await expect.poll(() => mock.pushes.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, status: 'تم RTC' }]);
  expect(mock.pushes[0]).toEqual({ action: 'push_status', order_id: 181668, status: 'تم RTC', result: 'skipped', reason: 'no_woo_status' });
  expect(mock.orders.find((o) => o.id === 181668).woo_status).toBe('processing');
});

test('a forbidden status change reverts', async ({ page }) => {
  await openOrders(page, ACCOUNTS);
  const sel = page.locator('#orders select[data-st="180656"]');
  await sel.selectOption('جاري التنفيذ');
  await expect(toast(page)).toHaveText('مش من صلاحياتك');
  await expect(sel).toHaveValue('معلّق');
  await expect(card(page, '180656').locator('.sdd')).toContainText('معلّق');
  expect(await page.evaluate(() => window.OrdersApp.get('180656').st)).toBe('معلّق');
  expect(mock.patches).toEqual([]);
  expect(mock.pushes).toEqual([]);
});

test('masked phone for a role without sensitive.customer_phone', async ({ page }) => {
  await openOrders(page, ACCOUNTS);
  const band = card(page, '181668').locator('.band');
  await expect(band).toContainText('012••••7052');
  await expect(band).not.toContainText('01200007052');
  await expect(band.locator('a.wa')).toHaveCount(0); // no WhatsApp link to a masked number
});

test('a sub-order status is written to its line only, never pushed', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-ss="5001"]').selectOption('مؤكد');
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'order_items', id: 5001, status: 'مؤكد' }]);
  expect(mock.pushes).toEqual([]);
  expect(mock.requests.filter((r) => r.includes('/functions/'))).toEqual([]);
  await expect(card(page, '181668').locator('.row', { has: page.locator('[data-ss="5001"]') }).locator('.sdd')).toContainText('مؤكد');
});

test('the product image comes from products', async ({ page }) => {
  await openOrders(page);
  const row = (n) => page.locator('#orders .row', { has: page.locator(`[data-ss="${n}"]`) });
  await expect(row(5001).locator('.th img')).toHaveAttribute('src', IMG.cushion);
  await expect(row(5002).locator('.th img')).toHaveAttribute('src', IMG.curtain);
  await card(page, '180656').locator('[data-tg="180656"]').click();
  await expect(row(5005).locator('.th img')).toHaveCount(0); // Macrame Feathers: no image_url → the box icon
  await expect(row(5005).locator('.th svg')).toHaveCount(1);
  expect(await page.evaluate(() => [window.OrdersApp.thumb('IBTA4040PAHC000013'), window.OrdersApp.thumb('IBTB0CSW6RFTM')])).toEqual([IMG.cushion, '']);
  // only http(s) and data:image URLs are used
  await page.evaluate(() => { const d = window.IBOrders.data(); d.images = Object.assign({}, d.images, { IBTA4040PAHC000013: 'javascript:alert(1)' }); window.OrdersApp.hydrate(d); });
  await expect(row(5001).locator('.th img')).toHaveCount(0);
  expect(await page.evaluate(() => window.OrdersApp.thumb('IBTA4040PAHC000013'))).toBe('');
});

test('confirmation, deposit and note are written through; a network failure puts the old value back', async ({ page }) => {
  await openOrders(page);
  const today = await page.evaluate(() => window.IBOrders.today());
  await page.locator('#orders select[data-cf="181668"]').selectOption('مؤكد بعربون');
  // the order (stamped with today's real date: its confirmation date was empty) and its unconfirmed line (auto-confirmed)
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches).toContainEqual({ table: 'orders', id: 181668, confirm: 'مؤكد بعربون', confirm_at: today });
  expect(mock.patches).toContainEqual({ table: 'order_items', id: 5001, status: 'مؤكد' });
  const dep = page.locator('#orders input[data-dep="181668"]');
  await dep.fill('500'); await dep.press('Tab');
  await expect.poll(() => mock.patches.length).toBe(3);
  expect(mock.patches[2]).toEqual({ table: 'orders', id: 181668, deposit: 500 });
  await page.locator('#orders input[data-dep="181668"]').fill(''); await page.locator('#orders input[data-dep="181668"]').press('Tab'); // cleared → 0
  await expect.poll(() => mock.patches.length).toBe(4);
  expect(mock.patches[3]).toEqual({ table: 'orders', id: 181668, deposit: 0 });
  const note = page.locator('#orders textarea[data-ne="181668"]');
  await note.fill('اتصلوا بعد الضهر');
  await page.locator('#orders [data-ns="181668"]').click();
  await expect.poll(() => mock.patches.length).toBe(5);
  expect(mock.patches[4]).toEqual({ table: 'orders', id: 181668, note: 'اتصلوا بعد الضهر' });
  mock.ordersDown = true;
  await page.locator('#orders textarea[data-ne="181668"]').fill('ملاحظة مش هتتحفظ');
  await page.locator('#orders [data-ns="181668"]').click();
  await expect(toast(page)).toHaveText('معرفناش نحفظ — جرّب تاني');
  await expect(page.locator('#orders textarea[data-ne="181668"]')).toHaveValue('اتصلوا بعد الضهر');
  expect(mock.patches).toHaveLength(5);
});

test('a sub-order comment, delivery date and waybill are written to the line', async ({ page }) => {
  await openOrders(page);
  const cm = page.locator('#orders textarea[data-ce="5002"]');
  await cm.fill('المورد هيسلّم الخميس');
  await page.locator('#orders [data-cs="5002"]').click();
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches[0]).toEqual({ table: 'order_items', id: 5002, comment: 'المورد هيسلّم الخميس' });
  await page.locator('#orders input[data-fi="ex:5001"]').fill('20/10/2026');
  await page.locator('#orders input[data-fi="ex:5001"]').press('Enter');
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches[1]).toEqual({ table: 'order_items', id: 5001, expected_at: '2026-10-20' });
  const w = { no: 'BST-1', company: 'بوسطة', at: '2026-10-25', by: 'M01' };
  await page.evaluate((x) => window.OrdersApp.waybill('181668', '181669', x), w);
  await expect.poll(() => mock.patches.length).toBe(3);
  expect(mock.patches[2]).toEqual({ table: 'order_items', id: 5001, waybill: w });
  expect(mock.pushes).toEqual([]);
});

test('«مزامنة» runs woo-sync and says what came in', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders #sync').click();
  await expect(toast(page)).toHaveText('تمت المزامنة · 4 أوردر · 4 منتج · 3 مبتكر');
  expect(mock.syncs).toEqual([{ action: 'all' }]);
});

test('«مزامنة» by a member who may not run it says so', async ({ page }) => {
  await openOrders(page, OPS); // woo-sync 'all' is admin only
  await page.locator('#orders #sync').click();
  await expect(toast(page)).toHaveText('مش من صلاحياتك');
  expect(mock.syncs).toEqual([]);
});

test('before the orders load: a loading state, then an error with a retry', async ({ page }) => {
  await page.goto('/'); // signed out: IBOrders idle, data() null — the page is mounted and says it is loading
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => [window.IBOrders.data(), window.IBOrders.state(), window.OrdersApp.query({}, 5).total, window.OrdersApp.alerts().lateOrders])).toEqual([null, 'idle', 0, []]);
  await expect(page.locator('#orders #list')).toHaveText('بيحمّل الأوردرات…');
  await expect(page.locator('#orders #cn')).toHaveText('0');
  mock.ordersDown = true; // the load fails (supabase-js retries a GET answered 503 three times: 1 + 2 + 4 s)
  await signIn(page, ADMIN, { timeout: 20000 });
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list')).toContainText('معرفناش نحمّل الأوردرات — جرّب تاني');
  await expect(cards(page)).toHaveCount(0);
  mock.ordersDown = false;
  await page.locator('#orders [data-oretry]').click();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('#orders #cn')).toHaveText('3');
});

test('an empty 12-month window says so', async ({ page }) => {
  mock.orders = mock.orders.filter((o) => o.id === 150001); // only the order older than 12 months
  await signIn(page, ADMIN);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list')).toHaveText('مافيش أوردرات في آخر 12 شهر');
  await expect(page.locator('#orders #cn')).toHaveText('0');
  expect(await page.evaluate(() => window.IBOrders.state())).toBe('ready');
});

test('IBOrders.clear() (sign-out) leaves no order on the page', async ({ page }) => {
  await openOrders(page);
  await page.evaluate(() => window.IBOrders.clear());
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#orders #list')).toHaveText('بيحمّل الأوردرات…');
  expect(await page.evaluate(() => [window.OrdersApp.get('181668'), window.OrdersApp.query({}, 5).total, window.OrdersApp.vendors(), window.OrdersApp.thumb('IBTA4040PAHC000013')])).toEqual([null, 0, [], '']);
  await expect(page.locator('#orders .oroot')).not.toContainText('سلوى زيتوني');
});
