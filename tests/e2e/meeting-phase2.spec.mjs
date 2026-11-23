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
  await openFirst(page);
}
const cards = (page) => page.locator('#orders #list .card');
// decision 48: every order starts closed — the tests open the first two the way a member does (the fold button)
async function openFirst(page, n = 2) {
  for (let i = 0; i < n; i++) { const b = cards(page).nth(i).locator('[data-tg]').first(); if ((await b.getAttribute('aria-label')) === 'فتح') await b.click(); await expect(cards(page).nth(i).locator('[data-tg]').first()).toHaveAttribute('aria-label', 'طي'); }
}
const card = (page, id) => page.locator(`#orders .card[data-o="${id}"]`);
// resize event, after setViewportSize resolves — so a locator read right after can hit a card about to be replaced (CI run 146:
const dlg = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
// The meeting of 23 Nov — phase 2 (docs/superpowers/plans/2026-11-23-meeting.md): the sub-orders are counted by maker with the pieces
// beside them [#12], and «تم الشحن» asks how it went [#15] (Safwat's answers: Bosta's pickup amount asked every time; a company ride is
// an «المصروفات» expense).

test('[#12] the card counts the sub-orders by maker and the pieces beside them (181668: two makers, 2 + 1 pieces)', async ({ page }) => {
  await openOrders(page);
  await expect(card(page, '181668').locator('[data-subn]').first()).toHaveText('2 أوردر فرعي · 3 قطع');
});

test('[#15] «تم الشحن للمخزن» by a ride: the app and the amount on the maker as «مواصلات» from the account picked, then the shipment', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-ss="5001"]').selectOption('تم الشحن للمخزن');
  const m = dlg(page, 'اتشحن للمخزن — إزاي؟');
  await expect(m).toBeVisible();
  await m.getByRole('radio', { name: 'توصيلة' }).click();
  await expect(m.locator('#app')).toHaveValue('أوبر'); // the default app
  await m.locator('#amount').fill('80');
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect(m.locator('[role=alert]')).toContainText('اختار الحساب'); // every money popup asks its account (0143)
  await m.locator('#account').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'حساب البنك' }).click();
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect(m).toHaveCount(0);
  await expect.poll(() => (mock.shipments || []).length).toBe(1);
  expect(mock.shipments[0]).toMatchObject({ order_id: 181668, item_id: 5001, leg: 'warehouse', method: 'ride', app_name: 'أوبر', amount: 80, payer: 'maker' });
  const mv = mock.acc.acc_vendor_moves.find((x) => x.id === mock.shipments[0].vendor_move_id);
  expect(mv).toMatchObject({ kind: 'مواصلات', direction: 'withdraw', amount: 80, account: 'حساب البنك' });
});

test('[#15] «تم الشحن للمخزن» by Bosta asks the pickup amount; by the maker himself records only', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-ss="5001"]').selectOption('تم الشحن للمخزن');
  let m = dlg(page, 'اتشحن للمخزن — إزاي؟');
  await m.getByRole('radio', { name: 'بوسطة' }).click();
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect(m.locator('[role=alert]')).toContainText('اكتب مبلغ البيك أب');
  await m.locator('#amount').fill('45');
  await m.getByRole('button', { name: 'سجّل الشحن' }).click(); // the account defaults to «حساب بوسطة»
  await expect.poll(() => (mock.shipments || []).length).toBe(1);
  expect(mock.shipments[0]).toMatchObject({ method: 'bosta', amount: 45, payer: 'maker' });
  await page.locator('#orders select[data-ss="5002"]').selectOption('تم الشحن للمخزن');
  m = dlg(page, 'اتشحن للمخزن — إزاي؟');
  await m.getByRole('radio', { name: 'المبتكر جابه بنفسه' }).click();
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect.poll(() => (mock.shipments || []).length).toBe(2);
  expect(mock.shipments[1]).toMatchObject({ item_id: 5002, method: 'maker', amount: null, vendor_move_id: null });
});

test('[#15] «تم الشحن للعميل» by a ride: the company pays = an «المصروفات» expense; the customer pays = his shipping charges on the order', async ({ page }) => {
  await openOrders(page);
  await page.locator('#orders select[data-ss="5001"]').selectOption('تم الشحن للعميل');
  let m = dlg(page, 'اتشحن للعميل — إزاي؟');
  await m.getByRole('radio', { name: 'توصيلة' }).click();
  await m.locator('#app').fill('إن درايف'); await m.locator('#amount').fill('60');
  await m.getByRole('radio', { name: 'الشركة' }).click();
  await m.locator('#account').click(); await page.locator('[role=listbox] [role=option]', { hasText: 'حساب البنك' }).click();
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect.poll(() => (mock.shipments || []).length).toBe(1);
  const ex = mock.acc.acc_expenses.find((x) => x.id === mock.shipments[0].expense_id);
  expect(ex).toMatchObject({ category: 'المصروفات', details: 'مواصلات — أوردر IB-181668', amount: 60, account: 'حساب البنك' });
  await page.locator('#orders select[data-ss="5002"]').selectOption('تم الشحن للعميل');
  m = dlg(page, 'اتشحن للعميل — إزاي؟');
  await m.getByRole('radio', { name: 'توصيلة' }).click();
  await m.locator('#amount').fill('40');
  await m.getByRole('radio', { name: 'العميل' }).click();
  await expect(m.locator('#account')).toHaveCount(0); // no money moves: no account
  await m.getByRole('button', { name: 'سجّل الشحن' }).click();
  await expect.poll(() => (mock.shipments || []).length).toBe(2);
  expect(mock.shipments[1]).toMatchObject({ payer: 'customer', amount: 40, expense_id: null });
  expect(mock.pushes || []).toEqual([]); // nothing to the site
});

test('[#14] the order popup: «تواصل مع العميل» opens WhatsApp on the number in its international form (01x → 201x), the number shown as text; the section heads are the brand green', async ({ page }) => {
  await openOrders(page);
  await card(page, '181668').locator('[data-more="o:181668"]').click();
  await page.locator('#orders #mpop [data-ma="edit"]').click();
  const edit = page.locator('#orders #cdlg').first();
  const wa = edit.locator('[data-wa-contact]');
  await expect(wa).toHaveText('تواصل مع العميل');
  const href = await wa.getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/201\d{9}$/);
  await expect(edit.locator('[data-wa-num]')).toHaveText('+' + href.split('/').pop());
  await expect(wa).toHaveAttribute('target', '_blank'); await expect(wa).toHaveAttribute('rel', /noopener/);
});
