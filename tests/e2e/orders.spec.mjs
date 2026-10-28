import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW, XSS_NAME, IMG, SITE } from './supabase-mock.mjs';
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
// A viewport change makes the block redraw the list once its mode changes (desktop / tablet <= 1023 / mobile <= 767) — on the
// resize event, after setViewportSize resolves — so a locator read right after can hit a card about to be replaced (CI run 146:
// every computed style empty = a detached element). Wait for a card of the new mode before reading anything in it.
const atWidth = async (page, width, height = 900) => {
  await page.setViewportSize({ width, height });
  const want = width <= 767 ? 'm' : width <= 1023 ? 't' : 'd';
  await expect(async () => {
    expect(await card(page, '181668').evaluate((e) => (e.classList.contains('m') ? 'm' : e.classList.contains('t') ? 't' : 'd'))).toBe(want);
  }).toPass({ timeout: 5000 });
};
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
  await expect(card(page, '181668').locator('.note.web')).toContainText('اتصلوا قبل التوصيل'); // orders.customer_note
  await expect(card(page, '180686').locator('.note.web')).toContainText('مفيش ملاحظة من العميل');
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
    Object.assign(o, { name: evil, phone: evil, pay: evil, note: evil, cnote: evil, state: evil, stateName: evil, city: evil, addr: evil, st: evil, cf: evil });
    Object.assign(o.subs[0], { prod: evil, sku: evil, vendor: evil, cm: evil, ss: evil, exp: evil, link: 'https://x.test/' + evil });
    o.subs[1].link = 'javascript:alert(1)';
    d.vendors = d.vendors.concat(evil); d.images = Object.assign({}, d.images, { [evil]: 'javascript:alert(1)' });
    window.OrdersApp.hydrate(d);
  }, EVIL);
  await expect(card(page, '181668')).toContainText(EVIL);
  await expect(page.locator('#orders #fv option', { hasText: EVIL })).toHaveCount(1);
  await expect(card(page, '181668').locator('a.plink')).toHaveCount(2); // the first line only: javascript: is no link
  for (const a of await card(page, '181668').locator('a.plink').all()) await expect(a).toHaveAttribute('href', 'https://x.test/' + EVIL);
  await inert(page);
  for (const width of [800, 375]) { // tablet, mobile templates
    await atWidth(page, width);
    await expect(card(page, '181668')).toContainText(EVIL);
    await inert(page);
  }
  await atWidth(page, 1280, 720);
  await page.evaluate(() => window.OrdersApp.edit('181668'));
  await expect(page.locator('#orders #cdlg [data-f="name"]')).toHaveValue(EVIL);
  await expect(page.locator('#orders #cdlg')).toContainText(EVIL); // the customer's note
  await expect(page.locator('#orders #cdlg .fd', { hasText: 'المحافظة' }).locator('.ro')).toHaveText(EVIL); // the governorate
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

test('«فشل» replaces «تم RTC»: a chip and an option styled like «ملغي», saved here but never pushed to the site (from_woo)', async ({ page }) => {
  await openOrders(page);
  await expect(page.locator('#orders [data-sc="فشل"]')).toHaveCount(1);
  await expect(page.locator('#orders [data-sc="تم RTC"]')).toHaveCount(0);
  await expect(page.locator('#orders .oroot')).not.toContainText('RTC');
  const sel = page.locator('#orders select[data-st="181668"]');
  expect(await sel.locator('option').allTextContents()).toEqual(['معلّق', 'قيد الانتظار', 'جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن', 'مكتمل', 'استرجاع', 'ملغي', 'فشل']);
  await sel.selectOption('فشل');
  await expect.poll(() => mock.pushes.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, status: 'فشل' }]);
  expect(mock.pushes[0]).toEqual({ action: 'push_status', order_id: 181668, status: 'فشل', result: 'skipped', reason: 'no_woo_status' });
  expect(mock.orders.find((o) => o.id === 181668).woo_status).toBe('processing'); // the site never learns «فشل» from us
  const dd = card(page, '181668').locator('label.sdd', { has: page.locator('select[data-st="181668"]') });
  await expect(dd).toHaveClass(/\bs-err\b/); // the tone and the icon of «ملغي»
  await expect(dd.locator('.l svg path[d="m9 9 6 6m0-6-6 6"]')).toHaveCount(1);
  await expect(page.locator('#orders [data-sc="فشل"] i')).toHaveText('1');
});

test('a status whose map row has no outgoing slug (a from_system row without a slug, 0007\'s old «تم RTC» shape; none today) is saved but not pushed', async ({ page }) => {
  mock.statusMap.find((r) => r.system_status === 'مكتمل').direction = 'from_system'; mock.statusMap.find((r) => r.system_status === 'مكتمل').woo_status = null;
  await openOrders(page);
  await page.locator('#orders select[data-st="181668"]').selectOption('مكتمل');
  const rate = page.getByRole('dialog', { name: /قيّم العميل — IB-181668/ }); // «مكتمل» asks for the rating first (phase 3.6)
  await rate.locator('#rt-sat [data-star="4"]').click(); await rate.locator('#rt-manners [data-star="4"]').click();
  await rate.getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect.poll(() => mock.pushes.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, status: 'مكتمل' }]);
  expect(mock.pushes[0]).toEqual({ action: 'push_status', order_id: 181668, status: 'مكتمل', result: 'skipped', reason: 'no_woo_status' });
  expect(mock.orders.find((o) => o.id === 181668).woo_status).toBe('processing');
  await expect(toast(page)).toBeHidden(); // skipped: nothing to tell
});

test('a status saved while WooCommerce is unreachable says so and stays', async ({ page }) => {
  await openOrders(page);
  mock.wooDown = true; // woo-sync answers 502: the adapter resolves { ok: true, push: 'error' }
  await page.locator('#orders select[data-st="180656"]').selectOption('جاري التنفيذ');
  await expect(toast(page)).toHaveText('اتحفظت هنا، بس ماوصلتش لـ WooCommerce — المزامنة هتحاول تاني');
  expect(mock.patches).toEqual([{ table: 'orders', id: 180656, status: 'جاري التنفيذ' }]);
  expect(mock.pushes).toEqual([]);
  await expect(page.locator('#orders select[data-st="180656"]')).toHaveValue('جاري التنفيذ');
  expect(await page.evaluate(() => window.OrdersApp.get('180656').st)).toBe('جاري التنفيذ');
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
  // only https and data:image URLs are used (CSP img-src: https / data)
  for (const bad of ['javascript:alert(1)', 'http://example.com/a.jpg']) {
    await page.evaluate((u) => { const d = window.IBOrders.data(); d.images = Object.assign({}, d.images, { IBTA4040PAHC000013: u }); window.OrdersApp.hydrate(d); }, bad);
    await expect(row(5001).locator('.th img')).toHaveCount(0);
    expect(await page.evaluate(() => window.OrdersApp.thumb('IBTA4040PAHC000013'))).toBe('');
  }
});

// the address row and the band / customer data above it, by their boxes: the row starts at or below their bottom
const below = async (upper, lower) => { const a = await upper.boundingBox(); const b = await lower.boundingBox(); expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1); };
test('the address has its own row under the customer data: governorate · city · address, the code without a name, «—» without any (desktop, tablet, mobile)', async ({ page }) => {
  await openOrders(page);
  await card(page, '180656').locator('[data-tg="180656"]').click();
  const row = (id) => card(page, id).locator('.arow');
  await expect(card(page, '181668').locator('.band')).not.toContainText('العنوان'); // out of the band
  await expect(row('181668').locator('small')).toHaveText('العنوان:');
  await expect(row('181668').locator('b')).toHaveText('القاهرة · مدينة نصر · شارع عباس العقاد'); // EG-01 → its name in woo_states
  await expect(row('180656').locator('b')).toHaveText('EG-14 · ش التحرير'); // a code the website's list has no name for: the code
  await expect(row('180686').locator('b')).toHaveText('—'); // no governorate, city or address
  await expect(row('181668').locator('input, textarea, select, button, a')).toHaveCount(0); // read-only
  expect(await card(page, '181668').locator('.band').evaluate((b) => b.nextElementSibling && b.nextElementSibling.className)).toBe('arow');
  await below(card(page, '181668').locator('.band'), row('181668'));
  expect(await row('181668').evaluate((e) => getComputedStyle(e.querySelector('b')).overflowWrap)).toBe('anywhere');
  await page.evaluate(() => { const d = window.IBOrders.data(); Object.assign(d.orders.find((x) => x.id === '181668'), { city: 'القاهرة' }); Object.assign(d.orders.find((x) => x.id === '180686'), { city: ' ', addr: 'الدقي' }); window.OrdersApp.hydrate(d); });
  await expect(row('181668').locator('b')).toHaveText('القاهرة · شارع عباس العقاد'); // a part that repeats the governorate shows once
  await expect(row('180686').locator('b')).toHaveText('الدقي'); // an empty part is skipped
  for (const width of [800, 375]) { // tablet, mobile: a row of its own under the customer section's fields
    await atWidth(page, width);
    const sec = card(page, '181668').locator('.sec.cust');
    await expect(sec.locator('.crow')).not.toContainText('العنوان');
    await expect(sec.locator('.inf2.adr small')).toHaveText('العنوان');
    await expect(sec.locator('.inf2.adr b')).toHaveText('القاهرة · شارع عباس العقاد');
    await expect(card(page, '180686').locator('.sec.cust .inf2.adr b')).toHaveText('الدقي');
    await expect(card(page, '180656').locator('.sec.cust .inf2.adr b')).toHaveText('EG-14 · ش التحرير');
    expect(await sec.locator('.crow').evaluate((c) => c.nextElementSibling && c.nextElementSibling.className)).toBe('inf2 adr');
    await below(sec.locator('.crow'), sec.locator('.inf2.adr'));
  }
  await page.evaluate(() => { const d = window.IBOrders.data(); Object.assign(d.orders.find((x) => x.id === '180686'), { addr: '' }); window.OrdersApp.hydrate(d); });
  await expect(card(page, '180686').locator('.sec.cust .inf2.adr b')).toHaveText('—');
});

// the website note's text block (.wn) of a card or the popup: its text as is, its box and how it scrolls
const noteBox = (loc) => loc.evaluate((e) => { const c = getComputedStyle(e); return { text: e.textContent, ws: c.whiteSpace, wrap: c.overflowWrap, oy: c.overflowY, ob: c.overscrollBehaviorY, max: c.maxHeight, lh: c.lineHeight, h: e.clientHeight, sh: e.scrollHeight }; });
const NOTE3 = 'اتصلوا قبل التوصيل\nالدور التالت\nالشقة 12'; // the mock's 181668
const NOTE5 = 'من فضلكم اتصلوا قبل التوصيل بساعة\nالعمارة اللي جنب الصيدلية\nالدور التالت\nالشقة 12 على الشمال\nماتسيبوش الطرد مع البواب';
test('the website note reads in full: its own lines, 3 shown, a longer one scrolls inside (desktop, tablet, mobile, popup)', async ({ page }) => {
  await openOrders(page);
  const wn = (id) => card(page, id).locator('.note.web .wn');
  const css = { ws: 'pre-wrap', wrap: 'anywhere', oy: 'auto', ob: 'auto', max: '64px', lh: '20px' }; // max-height = 3 lines of 20px + 4px for the last line's descenders; ob: a wheel or a swipe past the note's end goes on to the page (no overscroll-behavior:contain)
  let b = await noteBox(wn('181668'));
  expect(b).toMatchObject({ text: NOTE3, ...css }); // the lines as written, no « · »
  expect(b.sh).toBeLessThanOrEqual(b.h); // 3 lines: all shown, nothing to scroll
  expect(b.h).toBe(64);
  await expect(card(page, '181668').locator('.note.web .nh b')).toHaveText('ملاحظة العميل من الموقع');
  await expect(card(page, '181668').locator('.note.web').locator('input, textarea, select, button')).toHaveCount(0); // read-only
  await page.evaluate(() => window.OrdersApp.details('181668'));
  b = await noteBox(page.locator('#orders #cdlg .wn'));
  expect(b).toMatchObject({ text: NOTE3, ...css });
  expect(b.sh).toBeLessThanOrEqual(b.h); // the popup too: 3 lines, no scroll
  await page.keyboard.press('Escape');
  await page.evaluate(([n5]) => { const d = window.IBOrders.data(); d.orders.find((x) => x.id === '181668').cnote = n5; d.orders.find((x) => x.id === '180686').cnote = 'سطر واحد طويل من غير سطور جديدة '.repeat(20); window.OrdersApp.hydrate(d); }, [NOTE5]);
  for (const width of [1400, 800, 375]) {
    await atWidth(page, width);
    for (const id of ['181668', '180686']) { // five lines; one long line that wraps
      b = await noteBox(wn(id));
      expect(b).toMatchObject(css);
      expect(b.h).toBe(64); // 3 lines shown
      expect(b.sh).toBeGreaterThan(b.h); // the rest scrolls
    }
    expect((await noteBox(wn('181668'))).text).toBe(NOTE5);
    const end = await wn('181668').evaluate((e) => { e.scrollTop = e.scrollHeight; return e.scrollTop; });
    expect(end).toBeGreaterThan(0);
  }
  // mobile: the note is shown, not an accordion line cut with «…»
  await expect(card(page, '181668').locator('summary', { hasText: 'ملاحظة العميل من الموقع' })).toHaveCount(0);
  await expect(wn('181668')).toBeVisible();
  await expect(card(page, '181668').locator('summary', { hasText: 'تعليق خدمة العملاء' })).toHaveCount(1); // the team's comment keeps its accordion
  await atWidth(page, 1280);
  await page.evaluate(() => window.OrdersApp.details('181668'));
  b = await noteBox(page.locator('#orders #cdlg .wn'));
  expect(b).toMatchObject({ text: NOTE5, ...css });
  expect(b.sh).toBeGreaterThan(b.h);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.OrdersApp.details('180686'));
  await expect(page.locator('#orders #cdlg .wn')).toHaveText(/^سطر واحد طويل/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const d = window.IBOrders.data(); d.orders.find((x) => x.id === '180686').cnote = '  \n '; window.OrdersApp.hydrate(d); });
  await expect(wn('180686')).toHaveText('مفيش ملاحظة من العميل'); // blank: no note
});

test('the details popup shows the governorate read-only next to the city: its name, else its code, else «—»', async ({ page }) => {
  await openOrders(page);
  const dlg = page.locator('#orders #cdlg');
  const fd = (label) => dlg.locator('.fd', { has: page.locator('label', { hasText: new RegExp('^' + label + '$') }) });
  for (const [id, state, city] of [['181668', 'القاهرة', 'مدينة نصر'], ['180656', 'EG-14', '—'], ['180686', '—', '—']]) {
    await page.evaluate((x) => window.OrdersApp.details(x), id);
    await expect(fd('المحافظة').locator('.ro')).toHaveText(state);
    await expect(fd('المدينة').locator('.ro')).toHaveText(city);
    await expect(fd('المحافظة').locator('input, select, textarea')).toHaveCount(0); // no edit: the code comes from the website's list
    expect(await fd('المحافظة').evaluate((e) => e.nextElementSibling && e.nextElementSibling.textContent)).toContain('المدينة'); // side by side
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  }
  await page.evaluate(() => window.OrdersApp.edit('181668')); // the edit popup has the same section
  await expect(fd('المحافظة').locator('.ro')).toHaveText('القاهرة');
  await page.keyboard.press('Escape');
  expect(mock.patches).toEqual([]);
});

test('the product image and name open the product on the website: its permalink, else <origin>/?p=<product_id>, else no link', async ({ page }) => {
  // two lines the products table does not know: one with a WooCommerce product id, one with neither (a custom piece)
  const extra = (o) => ({ sub_order_id: null, qty: 1, total: 0, vendor_id: 'a0000000-0000-4000-8000-000000000002', status: '', removed: false, pulled: false, ...o });
  mock.orderItems.push(extra({ id: 5007, order_id: 180656, product_id: 9100, sku: 'IBT-GONE-1', name: 'Gone Lamp' }), extra({ id: 5008, order_id: 180656, product_id: null, sku: null, name: 'Custom piece' }));
  const opened = []; // the website, never reached: each product page opened answers here
  await page.context().route((url) => url.origin === SITE, (route) => { opened.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>product</title>' }); });
  await openOrders(page);
  await card(page, '180656').locator('[data-tg="180656"]').click();
  const row = (n) => page.locator('#orders .row', { has: page.locator(`[data-ss="${n}"]`) });
  const links = (n) => row(n).locator('a.plink');
  const hrefs = async (n) => { const l = await links(n).all(); return Promise.all(l.map((a) => a.getAttribute('href'))); };
  expect(await hrefs(5001)).toEqual([SITE + '/product/cushion/', SITE + '/product/cushion/']); // the thumbnail, then the name
  expect(await hrefs(5005)).toEqual([SITE + '/product/macrame-feathers/', SITE + '/product/macrame-feathers/']);
  expect(await hrefs(5007)).toEqual([SITE + '/?p=9100', SITE + '/?p=9100']); // no products row: the site's ?p=
  expect(await hrefs(5008)).toEqual([]); // neither: the markup as before
  await expect(row(5008).locator('.prod > .th')).toHaveCount(1);
  await expect(row(5008).locator('.pt b')).toHaveText('Custom piece × 1');
  for (const a of await links(5001).all()) { await expect(a).toHaveAttribute('target', '_blank'); await expect(a).toHaveAttribute('rel', 'noopener noreferrer'); }
  await expect(links(5001).first().locator('.th img')).toHaveAttribute('src', IMG.cushion);
  await expect(links(5001).first()).toHaveAttribute('tabindex', '-1'); // the name's link is the one the keyboard gets
  await expect(links(5001).nth(1)).toHaveText('Cushion');
  // a click opens the product in a new tab and is no card control: the card stays open, nothing written
  const [tab] = await Promise.all([page.context().waitForEvent('page'), links(5007).nth(1).click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(SITE + '/?p=9100');
  await tab.close();
  const [tab2] = await Promise.all([page.context().waitForEvent('page'), links(5001).first().click()]);
  await tab2.waitForLoadState();
  await tab2.close();
  expect(opened).toEqual([SITE + '/?p=9100', SITE + '/product/cushion/']);
  await expect(page.locator('#orders [data-tg="180656"]')).toHaveAttribute('aria-label', 'طي');
  expect(mock.patches).toEqual([]);
  await card(page, '180656').locator('[data-tg="180656"]').click(); // the fold still works
  await expect(row(5007)).toHaveCount(0);
  // the details popup shows the same links; Shift+Tab from one moves back, not to the dialog's end
  await page.evaluate(() => window.OrdersApp.details('180656', 'subs'));
  const name = page.locator('#orders #cdlg .row', { has: page.locator('[data-ss="5005"]') }).locator('a.plink').nth(1);
  await expect(name).toHaveAttribute('href', SITE + '/product/macrame-feathers/');
  await name.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#orders #cdlg [data-dtab="subs"]')).toBeFocused();
});

test('confirmation, deposit and note are written through; a network failure puts the old value back', async ({ page }) => {
  await openOrders(page);
  const today = await page.evaluate(() => window.IBOrders.today());
  await page.locator('#orders select[data-cf="181668"]').selectOption('مؤكد بعربون');
  // the order (stamped with today's real date: its confirmation date was empty) and its unconfirmed line (auto-confirmed)
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches).toContainEqual({ table: 'orders', id: 181668, confirm: 'مؤكد بعربون', confirm_at: today });
  expect(mock.patches).toContainEqual({ table: 'order_items', id: 5001, status: 'مؤكد' });
  expect(await page.evaluate(() => window.OrdersApp.get('181668').cdate)).toBe(today); // «تاريخ التأكيد» shows at once
  await expect(page.locator('#orders input[data-fi="cd:181668"]')).not.toHaveValue('');
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
  await expect(toast(page)).toHaveText('تمت المزامنة · 4 أوردر · 6 منتج · 3 مبتكر');
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
  await expect(page.locator('#orders #list')).toHaveText('مفيش أوردرات في آخر 12 شهر');
  await expect(page.locator('#orders #cn')).toHaveText('0');
  expect(await page.evaluate(() => window.IBOrders.state())).toBe('ready');
});

test('IBOrders.clear() (sign-out) leaves no order, search or filter on the page', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders #fc').selectOption('غير مؤكد');
  await page.locator('#orders #oq').fill('01200007052');
  await expect(cards(page)).toHaveCount(1);
  await page.evaluate(() => window.IBOrders.clear());
  await expect(page.locator('#orders #oq')).toHaveValue('');
  await expect(page.locator('#orders #fc')).toHaveValue('');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#orders #list')).toHaveText('بيحمّل الأوردرات…');
  expect(await page.evaluate(() => [window.OrdersApp.get('181668'), window.OrdersApp.query({}, 5).total, window.OrdersApp.vendors(), window.OrdersApp.thumb('IBTA4040PAHC000013')])).toEqual([null, 0, [], '']);
  await expect(page.locator('#orders .oroot')).not.toContainText('سلوى زيتوني');
});

test('the details popup: a tab switch keeps the typed info without writing it; «ليس الآن» drops it, «حفظ التعديلات» writes it', async ({ page }) => {
  await openOrders(page);
  const dlg = page.locator('#orders #cdlg');
  await page.evaluate(() => window.OrdersApp.details('181668'));
  await dlg.locator('[data-f="note"]').fill('ملاحظة مش هتتحفظ');
  await dlg.locator('[data-dtab="subs"]').click();
  await dlg.locator('[data-dtab="info"]').click();
  await expect(dlg.locator('[data-f="note"]')).toHaveValue('ملاحظة مش هتتحفظ'); // stashed, not applied
  expect(await page.evaluate(() => window.OrdersApp.get('181668').note)).toBe('');
  await dlg.locator('[data-dtab="subs"]').click();
  await dlg.locator('[data-cc]').first().click();
  await page.locator('#orders #udlg [data-ud]').click(); // «ليس الآن»
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('#orders textarea[data-ne="181668"]')).toHaveValue('');
  expect(await page.evaluate(() => window.OrdersApp.get('181668').note)).toBe('');
  await page.locator('#orders select[data-ss="5002"]').selectOption('قيد التنفيذ'); // a write that does go out: nothing went before it
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'order_items', id: 5002, status: 'قيد التنفيذ' }]);
  await page.evaluate(() => window.OrdersApp.details('181668'));
  await dlg.locator('[data-f="note"]').fill('اتصلوا الصبح');
  await dlg.locator('[data-dtab="subs"]').click();
  await dlg.locator('[data-eok]').click(); // saved from the lines tab: the stashed form is written
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches[1]).toEqual({ table: 'orders', id: 181668, note: 'اتصلوا الصبح' });
});

test('a Realtime order redraws its own card only, never over a field in use; counts follow', async ({ page }) => {
  await openOrders(page);
  // the adapter's Realtime path: a rebuilt order handed to applyOrder (the mock runs without a Realtime socket)
  const realtime = (id, st, vendor) => page.evaluate(([id, st, vendor]) => {
    const o = window.IBOrders.data().orders.find((x) => x.id === id);
    window.OrdersApp.applyOrder(Object.assign({}, o, { st, subs: o.subs.map((s, i) => (i || !vendor ? s : Object.assign({}, s, { vendor }))) }));
  }, [id, st, vendor]);
  const other = page.locator('#orders textarea[data-ne="180686"]');
  await other.fill('بكتب دلوقتي'); // typing in another card
  await realtime('181668', 'قيد الشحن', 'Medo .crafts');
  await expect(page.locator('#orders select[data-st="181668"]')).toHaveValue('قيد الشحن');
  await expect(other).toHaveValue('بكتب دلوقتي');
  await expect(other).toBeFocused();
  await expect(page.locator('#orders [data-sc="قيد الشحن"] i')).toHaveText('1');
  await expect(page.locator('#orders [data-sc="جاري التنفيذ"] i')).toHaveText('1');
  await expect(page.locator('#orders #cn')).toHaveText('3');
  await expect(page.locator('#orders #fv option', { hasText: 'Medo .crafts' })).toHaveCount(1);
  // the card being edited: focused → drawn on blur
  const mine = page.locator('#orders textarea[data-ne="181668"]');
  await mine.focus();
  await realtime('181668', 'جاهز للشحن');
  await expect(page.locator('#orders select[data-st="181668"]')).toHaveValue('قيد الشحن');
  await page.locator('#orders #oq').focus();
  await expect(page.locator('#orders select[data-st="181668"]')).toHaveValue('جاهز للشحن');
  // a comment typed and left unsaved: still not drawn over after the blur; the save draws it
  await page.locator('#orders textarea[data-ne="181668"]').fill('لسه بكتب');
  await realtime('181668', 'مكتمل');
  await page.locator('#orders #oq').focus();
  await expect(page.locator('#orders select[data-st="181668"]')).toHaveValue('جاهز للشحن');
  await expect(page.locator('#orders textarea[data-ne="181668"]')).toHaveValue('لسه بكتب');
  await expect(other).toHaveValue('بكتب دلوقتي'); // three Realtime updates later, the other card's typing is still there
  await page.locator('#orders [data-ns="181668"]').click();
  await expect(page.locator('#orders select[data-st="181668"]')).toHaveValue('مكتمل');
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, note: 'لسه بكتب' }]); // the Realtime orders are not written back
});

test('a new Realtime order (or one that leaves the filters) redraws the list, never over a field in use; unsaved comments survive', async ({ page }) => {
  await openOrders(page);
  // a brand-new order as the adapter hands it to applyOrder: placed today, so the newest (first in «الأحدث أولًا»)
  const arrive = (id) => page.evaluate((id) => {
    const o = window.IBOrders.data().orders.find((x) => x.id === '181668');
    const s = Object.assign({}, o.subs[0], { n: Number(id), itemId: id, oid: id, sid: id, cm: '' });
    window.OrdersApp.applyOrder(Object.assign({}, o, { id, name: 'عميل جديد ' + id, date: window.IBOrders.today(), age: 0, note: '', cnote: '', subs: [s] }));
  }, id);
  const cn = page.locator('#orders #cn');
  await arrive('182001');
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182001');
  await expect(card(page, '182001')).toContainText('IB-182001'); // folded: a new order is not opened
  await expect(cn).toHaveText('4');
  await expect(page.locator('#orders [data-sc="الكل"] i')).toHaveText('4');
  // a field in use in another card: counted at once, drawn when the list is left
  const other = page.locator('#orders textarea[data-ne="180686"]');
  await other.focus();
  await arrive('182002');
  await expect(cn).toHaveText('5');
  await expect(page.locator('#orders [data-sc="الكل"] i')).toHaveText('5');
  await expect(card(page, '182002')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(4);
  await expect(other).toBeFocused();
  await page.locator('#orders #oq').focus();
  await expect(card(page, '182002')).toHaveCount(1);
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182002');
  // a comment typed and not saved survives every full redraw: a new order, a sort change, a card folded, a status chip
  const mine = page.locator('#orders textarea[data-ne="181668"]');
  await mine.fill('لسه ماتحفظش');
  await page.locator('#orders #oq').focus();
  await arrive('182003');
  await expect(cards(page)).toHaveCount(6);
  await expect(mine).toHaveValue('لسه ماتحفظش');
  await expect(page.locator('#orders [data-ns="181668"]')).toBeVisible();
  await page.locator('#orders #so').selectOption('old');
  await expect(cards(page).first()).toHaveAttribute('data-o', '180656');
  await expect(mine).toHaveValue('لسه ماتحفظش');
  await page.locator('#orders [data-tg="180686"]').click();
  await expect(page.locator('#orders textarea[data-ne="180686"]')).toHaveCount(0); // folded
  await expect(mine).toHaveValue('لسه ماتحفظش');
  await page.locator('#orders [data-sc="جاري التنفيذ"]').click();
  await expect(cards(page)).toHaveCount(5); // 180656 is «معلّق»
  await expect(mine).toHaveValue('لسه ماتحفظش');
  // an order that leaves the filters is taken out of the list (and out of the counts)
  await page.evaluate(() => { const o = window.IBOrders.data().orders.find((x) => x.id === '180686'); window.OrdersApp.applyOrder(Object.assign({}, o, { st: 'مكتمل' })); });
  await expect(card(page, '180686')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(4);
  await expect(cn).toHaveText('4');
  await expect(page.locator('#orders [data-sc="مكتمل"] i')).toHaveText('1');
  // the save writes the comment typed four redraws ago; nothing Realtime brought is written back
  await page.locator('#orders [data-ns="181668"]').click();
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, note: 'لسه ماتحفظش' }]);
});

// a brand-new order as the adapter's Realtime path hands it to applyOrder: placed today, so first in «الأحدث أولًا»
const arrive = (page, id) => page.evaluate((id) => {
  const o = window.IBOrders.data().orders.find((x) => x.id === '181668');
  const s = Object.assign({}, o.subs[0], { n: Number(id), itemId: id, oid: id, sid: id, cm: '' });
  window.OrdersApp.applyOrder(Object.assign({}, o, { id, name: 'عميل جديد ' + id, date: window.IBOrders.today(), age: 0, note: '', cnote: '', subs: [s] }));
}, id);

test('a held full redraw never replaces the control being pressed: «حفظ» and the fold button work with a human press, mouse or keyboard', async ({ page }) => {
  await openOrders(page);
  const cn = page.locator('#orders #cn');
  // a comment typed (its field still focused) when a new order comes in: held; a 50 ms press on «حفظ» saves it, then the list is drawn
  const mine = page.locator('#orders textarea[data-ne="181668"]');
  await mine.fill('اتكتب قبل الضغطة');
  await arrive(page, '182001');
  await expect(cn).toHaveText('4');
  await expect(cards(page)).toHaveCount(3);
  await page.locator('#orders [data-ns="181668"]').click({ delay: 50 });
  await expect(toast(page)).toHaveText('تم حفظ التعليق');
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, note: 'اتكتب قبل الضغطة' }]);
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182001');
  await expect(page.locator('#orders [data-ns="181668"]')).toBeHidden();
  // the fold button in a browser that does not focus a pressed button (Safari, Firefox on macOS): on mousedown the field
  // loses focus to nothing, so only the press itself holds the redraw
  await page.locator('#orders textarea[data-ne="180686"]').focus();
  await arrive(page, '182002');
  await expect(cards(page)).toHaveCount(4);
  await page.evaluate(() => {
    const R = document.getElementById('orders').shadowRoot;
    R.addEventListener('mousedown', function once(e) { R.removeEventListener('mousedown', once, true); e.preventDefault(); R.activeElement.blur(); }, true);
  });
  await expect(page.locator('#orders [data-tg="180656"]')).toHaveAttribute('aria-label', 'فتح');
  await page.locator('#orders [data-tg="180656"]').click({ delay: 50 });
  await expect(page.locator('#orders [data-tg="180656"]')).toHaveAttribute('aria-label', 'طي');
  await expect(page.locator('#orders textarea[data-ne="180656"]')).toHaveCount(1);
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182002');
  // the keyboard: Tab from the comment to its «حفظ» (a control of the list: still held), Enter saves, then the list is drawn
  const kb = page.locator('#orders textarea[data-ne="180686"]');
  await kb.fill('من الكيبورد');
  await arrive(page, '182003');
  await expect(cards(page)).toHaveCount(5);
  await kb.press('Tab');
  await expect(page.locator('#orders [data-ns="180686"]')).toBeFocused();
  await expect(cards(page)).toHaveCount(5);
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches[1]).toEqual({ table: 'orders', id: 180686, note: 'من الكيبورد' });
  await expect(cards(page)).toHaveCount(6);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182003');
  await expect(cn).toHaveText('6');
});

test('the date picker and the «more» menu hold a full redraw; closing them draws the list', async ({ page }) => {
  await openOrders(page);
  const cn = page.locator('#orders #cn'); const dp = page.locator('#orders #dpop'); const menu = page.locator('#orders #mpop');
  // the date picker: a click inside it keeps it open (still held); a click outside closes it and draws what came in
  await page.locator('#orders [data-fi="cd:181668"]').click();
  await expect(dp).toHaveCount(1);
  await arrive(page, '182001');
  await expect(cn).toHaveText('4');
  await expect(cards(page)).toHaveCount(3);
  await dp.locator('[data-act="nm"]').click();
  await expect(dp).toHaveCount(1);
  await expect(cards(page)).toHaveCount(3);
  await page.locator('#orders h1').click();
  await expect(dp).toHaveCount(0);
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182001');
  // the «more» menu: what comes in while it is open waits (the menu never ends up beside another card); closing it draws
  await card(page, '181668').locator('[data-more="o:181668"]').click();
  await expect(menu).toBeVisible();
  await arrive(page, '182002');
  await expect(cn).toHaveText('5');
  await expect(cards(page)).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).first()).toHaveAttribute('data-o', '182002');
  expect(mock.patches).toEqual([]);
});

test('Escape on a sub-order comment drops what was typed (a redraw keeps only unsaved comments)', async ({ page }) => {
  await openOrders(page);
  const cm = page.locator('#orders textarea[data-ce="5002"]');
  await cm.fill('مش هتتحفظ');
  await cm.press('Escape');
  await expect(page.locator('#orders textarea[data-ce="5002"]')).toHaveValue('تم تبليغ المورد');
  await expect(page.locator('#orders [data-cs="5002"]')).toBeHidden();
  expect(mock.patches).toEqual([]);
});

test('WooCommerce owns name, phone, payment, maker, quantity and total: read-only; nothing is deleted', async ({ page }) => {
  await openOrders(page);
  const menu = page.locator('#orders #mpop'); const dlg = page.locator('#orders #cdlg');
  await card(page, '181668').locator('[data-more="o:181668"]').click();
  await expect(menu.locator('[data-ma="edit"]')).toHaveCount(1);
  await expect(menu.locator('[data-ma="del"]')).toHaveCount(0);
  await expect(menu).not.toContainText('مسح');
  await menu.locator('[data-ma="edit"]').click();
  for (const f of ['name', 'phone', 'pay']) await expect(dlg.locator(`[data-f="${f}"]`)).toBeDisabled();
  await expect(dlg.locator('[data-f="pay"]')).toHaveValue('الدفع عند الاستلام');
  await expect(dlg).toContainText('بيتعدّل من WooCommerce');
  await expect(dlg).toContainText('اتصلوا قبل التوصيل'); // the customer's note from the site
  await dlg.locator('[data-f="note"]').fill('ملاحظة من التعديل');
  await dlg.locator('[data-eok]').click();
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches).toEqual([{ table: 'orders', id: 181668, note: 'ملاحظة من التعديل' }]);
  await card(page, '181668').locator('[data-more="s:5001"]').click();
  await expect(menu.locator('[data-ma="del"]')).toHaveCount(0);
  await menu.locator('[data-ma="edit"]').click();
  for (const f of ['vendor', 'qty', 'tot']) await expect(dlg.locator(`[data-f="${f}"]`)).toBeDisabled();
  await expect(dlg.locator('[data-f="vendor"]')).toHaveValue('Art Craft');
  await expect(dlg).toContainText('بيتعدّل من WooCommerce');
  await dlg.locator('[data-f="cm"]').fill('تعليق من التعديل');
  await dlg.locator('[data-eok]').click();
  await expect.poll(() => mock.patches.length).toBe(2);
  expect(mock.patches[1]).toEqual({ table: 'order_items', id: 5001, comment: 'تعليق من التعديل' });
  expect(mock.patches.some((x) => ['customer_name', 'customer_phone', 'payment_title', 'qty', 'total', 'vendor_id'].some((k) => k in x))).toBe(false);
});

// Phase 3.6 (plan decision 4): «مكتمل» on a main order asks for the customer's rating first — رضا · أخلاق (stars 1–5) and an
// optional note; «ليس الآن» leaves the status; saving writes the rating and the status in one call (order_complete) and pushes.
const rateDialog = (page) => page.getByRole('dialog', { name: /قيّم العميل — IB-180656/ });
test('«مكتمل» asks for the customer rating: «ليس الآن» keeps the status, the stars are required, saving writes both and pushes', async ({ page }) => {
  await openOrders(page);
  const sel = page.locator('#orders select[data-st="180656"]');
  await sel.selectOption('مكتمل');
  await expect(rateDialog(page)).toBeVisible();
  await expect(rateDialog(page)).toContainText('الأوردر هيتقفل «مكتمل» بعد التقييم');
  await rateDialog(page).getByRole('button', { name: 'ليس الآن' }).click();
  await expect(rateDialog(page)).toHaveCount(0);
  await expect(sel).toHaveValue('معلّق');
  expect(mock.patches).toEqual([]); expect(mock.ratings).toEqual([]); expect(mock.pushes).toEqual([]);

  await sel.selectOption('مكتمل');
  await rateDialog(page).getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect(rateDialog(page)).toContainText('اختار رضا العميل من 1 لـ 5');
  await expect(rateDialog(page)).toContainText('اختار أخلاق العميل من 1 لـ 5');
  expect(mock.ratings).toEqual([]);
  await rateDialog(page).locator('#rt-sat [data-star="5"]').click();
  await rateDialog(page).locator('#rt-manners [data-star="4"]').click();
  await expect(rateDialog(page).locator('#rt-sat [aria-checked="true"]')).toHaveAttribute('data-star', '5');
  await rateDialog(page).locator('textarea').fill('ذوق جداً');
  await rateDialog(page).getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect(rateDialog(page)).toHaveCount(0);
  await expect.poll(() => mock.pushes.length).toBe(1);
  expect(mock.ratings).toEqual([{ order_id: 180656, sat: 5, manners: 4, note: 'ذوق جداً', by_user: mock.profiles.find((p) => p.email === ADMIN).id }]);
  expect(mock.patches).toEqual([{ table: 'orders', id: 180656, status: 'مكتمل' }]);
  expect(mock.pushes).toEqual([{ action: 'push_status', order_id: 180656, status: 'مكتمل', result: 'ok' }]);
  await expect(card(page, '180656').locator('.sdd')).toContainText('مكتمل');
  await expect.poll(() => mock.activity.filter((a) => JSON.stringify(a).includes('order.rating')).length).toBe(1);
  const logged = JSON.stringify(mock.activity.find((a) => JSON.stringify(a).includes('order.rating')));
  expect(logged).toContain('IB-180656 · رضا 5 · أخلاق 4');
  expect(logged).not.toContain('ذوق'); // the note stays in customer_ratings only
});

test('a rating by a member who may not change the status reverts the order to its status', async ({ page }) => {
  await openOrders(page, ACCOUNTS);
  const sel = page.locator('#orders select[data-st="180656"]');
  await sel.selectOption('مكتمل');
  await rateDialog(page).locator('#rt-sat [data-star="3"]').click();
  await rateDialog(page).locator('#rt-manners [data-star="3"]').click();
  await rateDialog(page).getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect(toast(page)).toHaveText('مش من صلاحياتك');
  await expect(sel).toHaveValue('معلّق');
  expect(mock.ratings).toEqual([]); expect(mock.patches).toEqual([]); expect(mock.pushes).toEqual([]);
});

test('the orders page says «المبتكر», never «المورد» (plan decision 2): filters, sub-order statuses, comments', async ({ page }) => {
  await openOrders(page);
  // the page's own text: without what a member typed (the comment boxes) and the stylesheets
  const text = await page.evaluate(() => { const r = document.getElementById('orders').shadowRoot; return [...r.querySelectorAll('*')].filter((e) => !e.closest('textarea, style')).map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')).join(' '); });
  expect(text).not.toMatch(/مورد/);
  expect(text).toContain('المبتكر: الكل');
  expect(text).toContain('عدد المبتكرين: الكل');
  expect(await page.locator('#orders select[data-ss="5001"] option').allTextContents()).toEqual(expect.arrayContaining(['جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المبتكر للمخزن', 'مرتجع للمبتكر']));
});
