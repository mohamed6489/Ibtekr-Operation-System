import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// Live sync (the owner 15 Nov — docs/superpowers/plans/2026-11-15-live-sync.md decision 2): what a teammate saved shows on every open
// screen without a reload. The database's signal (0104) is played by hand here — the stand-in has no socket — after the stand-in's
// data was changed the way another member's save would change it: the page must show it, with no «loading» flash, and must wait
// while the member has a popup open.
const ADMIN = 'admin.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001';
const cairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'plays the change signal by hand on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {});
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });

async function signIn(page) {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
}
const main = (page) => page.locator('#main');
const modal = (page) => page.locator('.modal[role=dialog]');
const signal = (page, payload) => page.evaluate((p) => window.IBLive.signal({ payload: p }), payload);
// a teammate's expense, as the database would hold it after their «حفظ»
const expense = (id, details, amount) => ({ id, on_date: cairo(), direction: 'withdraw', category: 'المصروفات', beneficiary: 'مطبعة النيل', beneficiary_other: true, amount, note: null, details, reason: null, staff_kind: null,
  sub_name: null, sub_ends: null, sub_alerts: [], created_by: 'a0000000-0000-4000-8000-0000000000aa', created_at: new Date().toISOString(), updated_by: null, updated_at: null, voided_by: null, voided_at: null });

test('accounts: a teammate\'s expense shows without a reload — quietly, and only after my open popup is closed', async ({ page }) => {
  await signIn(page);
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await main(page).locator('[role=tab]', { hasText: 'المصروفات' }).first().click();
  await expect(main(page).locator('.empty')).toContainText('لسه مفيش مصروفات');
  // the page is watched for any «loading» state from here on
  await page.evaluate(() => { window.__states = []; document.addEventListener('ib:accounts', () => window.__states.push(window.IBAccounts.state())); });

  mock.acc.acc_expenses.push(expense(9001, 'ورق تغليف من زميل', 730));
  await signal(page, { t: 'accounts', at: new Date().toISOString() });
  await expect(main(page).locator('table').filter({ hasText: 'ورق تغليف من زميل' })).toBeVisible();
  expect(await page.evaluate(() => window.__states)).not.toContain('loading');

  // a popup is open: what is on the screen stays what is in memory until it closes
  await main(page).getByRole('button', { name: 'إضافة مصروفات', exact: true }).click();
  await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: 'سحب' }).first().click();
  await expect(modal(page)).toBeVisible();
  mock.acc.acc_expenses.push(expense(9002, 'كراتين شحن من زميل', 410));
  await signal(page, { t: 'accounts' });
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => window.IBAccounts.rows('expenses').length)).toBe(1); // still waiting
  expect(await page.evaluate(() => window.IBLive.held())).toBe(true);
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await expect(modal(page)).toBeHidden();
  await expect(main(page).locator('table').filter({ hasText: 'كراتين شحن من زميل' })).toBeVisible();
});

test('orders: the status a teammate set shows on the card without a reload; a move for a maker reaches the makers\' accounts', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  const before = await st.inputValue();
  const next = before === 'جاهز للشحن' ? 'قيد الشحن' : 'جاهز للشحن';
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: next });
  await signal(page, { t: 'orders', ids: [181668] });
  await expect(st).toHaveValue(next);
  expect(await page.evaluate(() => window.IBOrders.state())).toBe('ready');

  // a teammate's «عربون» for a maker: the accounts hold it at once (the page is not even open)
  mock.acc.acc_vendor_moves.push({ id: 9101, vendor_id: V1, on_date: cairo(), direction: 'withdraw', kind: 'عربون', kind_name: null, amount: 10, note: null, created_by: 'a0000000-0000-4000-8000-0000000000aa',
    created_at: new Date().toISOString(), updated_by: null, updated_at: null, voided_by: null, voided_at: null, settled_by: null, settled_at: null });
  await signal(page, { t: 'accounts' });
  await expect.poll(() => page.evaluate(() => window.IBAccounts.rows('vendorMoves').length)).toBe(1);
});

test('a signal for a group nobody loaded, or of an unknown group, asks the server for nothing', async ({ page }) => {
  await signIn(page);
  const seen = []; page.on('request', (r) => { if (/\/rest\/v1\//.test(r.url())) seen.push(r.url()); });
  await signal(page, { t: 'products' }); await signal(page, { t: 'studio' }); await signal(page, { t: 'something_else' });
  await page.waitForTimeout(1500);
  expect(seen.filter((u) => /\/(products|studio_batches|woo_categories)\b/.test(u))).toEqual([]);
});

// decision 3: «لسه زي ما أنا شايفه» — the owner: «غيرت حالة اوردر و عضو تاني غير حالة نفس الاوردر»
test('orders: a status changed on a card a teammate already moved is refused — nothing is written, the card shows theirs and says so; then my change goes', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  await expect(st).toHaveValue('جاري التنفيذ');
  // a teammate set «معلّق» a moment ago; my screen has not heard yet
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: 'معلّق' });
  const before = mock.patches.length;
  await st.selectOption('جاهز للشحن');
  await expect(page.locator('#orders #toast')).toContainText('حد تاني غيّر ده من شوية');
  await expect(st).toHaveValue('معلّق'); // theirs, read again
  expect(mock.orders.find((o) => o.id === 181668).status).toBe('معلّق');
  expect(mock.patches.slice(before).filter((p) => p.table === 'orders')).toEqual([]);
  expect(mock.activity.map((a) => a.action)).not.toContain('order.status');
  // now I am looking at theirs: the same change is mine to make
  await st.selectOption('جاهز للشحن');
  await expect.poll(() => mock.orders.find((o) => o.id === 181668).status).toBe('جاهز للشحن');
  await expect(st).toHaveValue('جاهز للشحن');
});

test('orders: «مكتمل» with the rating on an order a teammate completed first leaves one rating', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = 'orders'; });
  await expect(page.locator('#orders #list .card')).toHaveCount(3);
  const st = page.locator('#orders select[data-st="181668"]');
  Object.assign(mock.orders.find((o) => o.id === 181668), { status: 'مكتمل' }); mock.ratings.push({ order_id: 181668, sat: 5, manners: 5, note: null, by_user: 'a0000000-0000-4000-8000-0000000000aa' });
  await st.selectOption('مكتمل');
  const rate = page.getByRole('dialog', { name: /قيّم العميل — IB-181668/ });
  await rate.locator('#rt-sat [data-star="4"]').click(); await rate.locator('#rt-manners [data-star="4"]').click();
  await rate.getByRole('button', { name: 'احفظ التقييم وقفّل الأوردر' }).click();
  await expect(page.locator('#orders #toast')).toContainText('حد تاني غيّر ده من شوية');
  expect(mock.ratings.filter((r) => r.order_id === 181668)).toHaveLength(1);
});
