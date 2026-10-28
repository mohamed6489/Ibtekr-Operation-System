import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The accounts page on real data (phase 4, docs/superpowers/plans/2026-10-27-phase-4-accounts.md): the ledgers written through
// IBAccounts (acc_* of 0019 — «حذف» is a void), the makers' Dokan balances and withdraw requests read-only, the sales from our
// own orders (accounts_sales), the maker's Dokan statement on demand, the moves log, the subscriptions, the columns per member.
// Mock only: the cases assert the mock's seed and the writes it recorded (mock.accWrites / activity / prefs / statements).
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local'; const ACCOUNTS = 'accounts.dev@ibtekr.local';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002'; // Art Craft (store 2376), Antikiano (44)
const cairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, {
    dokanBalances: [{ vendor_id: V1, woo_vendor_id: 2376, balance: 2500, earning: 9000, sales: 11000, orders: 12, synced_at: '2026-10-27T10:00:00Z' }],
    dokanWithdrawals: [{ id: 501, woo_vendor_id: 2376, vendor_id: V1, amount: 1200, charge: 0, receivable: 1200, status: 'pending', method: 'bank', requested_at: '2026-10-25 12:00:00', synced_at: '2026-10-27T10:00:00Z' },
      { id: 400, woo_vendor_id: 44, vendor_id: V2, amount: 300, charge: 0, receivable: 300, status: 'cancelled', method: 'bank', requested_at: '2026-10-01 12:00:00', synced_at: '2026-10-27T10:00:00Z' }],
    statementRows: [{ date: '2026-10-01', type: 'opening_balance', title: 'Opening Balance', debit: 0, credit: 0, balance: 300 }, { date: '2026-10-05 10:00:00', type: 'dokan_orders', title: 'Order #55', debit: 500, credit: 0, balance: 800 }],
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
async function openAccounts(page, email = ADMIN) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  await expect(page.locator('#main')).toBeVisible();
}
const main = (page) => page.locator('#main');
const tab = (page, label) => main(page).getByRole('tab', { name: label });
const modal = (page) => page.locator('.modal[role=dialog]');
async function pick(page, id, label) { await modal(page).locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }
async function add(page, menu, dir) { await main(page).getByRole('button', { name: menu }).click(); await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: dir }).first().click(); await expect(modal(page)).toBeVisible(); }

test('the page is open with its five tabs, no September seed: the numbers start at zero and the range is this month', async ({ page }) => {
  await openAccounts(page);
  await expect(main(page).getByRole('tab')).toHaveText(['المصروفات', 'المبيعات', 'حسابات المبتكرين', 'الحساب الفعلي', 'سجل الحركات']);
  await expect(main(page)).not.toContainText('سبتمبر 2026');
  await expect(main(page)).not.toContainText('Monthly Performance');
  await expect(main(page).locator('.empty')).toContainText('لسه مفيش مصروفات');
  await tab(page, 'الحساب الفعلي').click();
  await expect(main(page)).not.toContainText('132,800'); // the seed's bank balance is gone: opening balances are 0 until the import
});

test('an expense is written to acc_expenses and logged (kind, amount, date only); «حذف» voids it, «تراجع» records it again', async ({ page }) => {
  await openAccounts(page);
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('1250');
  await pick(page, 'f-cat', 'المصروفات');
  await pick(page, 'f-ben', 'آخر');
  await modal(page).locator('#f-other').fill('مطبعة النيل');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('اكتب تفاصيل المصروف'); // phase 4.1: a general expense needs its details
  expect(mock.accWrites).toEqual([]);
  await modal(page).locator('#f-details').fill('ورق طباعة وكراتين');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_expenses', op: 'insert', on_date: cairo(), direction: 'withdraw', category: 'المصروفات', beneficiary: 'مطبعة النيل', beneficiary_other: true, amount: 1250, sub_alerts: [], details: 'ورق طباعة وكراتين', reason: null });
  await expect(main(page).locator('table').filter({ hasText: 'ورق طباعة وكراتين' })).toBeVisible(); // «البيان»
  await expect(main(page).locator('table').filter({ hasText: 'مطبعة النيل' })).toBeVisible();
  await expect.poll(() => mock.activity.map((a) => a.action)).toContain('accounts.expense');
  const logged = mock.activity.find((a) => a.action === 'accounts.expense');
  expect(logged.new_value).toBe('المصروفات · سحب · 1250 · ' + cairo());
  // void
  const row = main(page).locator('tr', { hasText: 'مطبعة النيل' });
  await row.getByRole('button', { name: 'إجراءات الصف' }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'حذف' }).first().click();
  await expect.poll(() => mock.accWrites.filter((w) => w.op === 'update').length).toBe(1);
  expect(mock.acc.acc_expenses[0].voided_at).toBeTruthy();
  await expect(main(page).locator('tr', { hasText: 'مطبعة النيل' })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'تراجع' }).click();
  await expect.poll(() => mock.accWrites.filter((w) => w.op === 'insert').length).toBe(2);
  await expect(main(page).locator('tr', { hasText: 'مطبعة النيل' })).toHaveCount(1);
});

test('a subscription needs its name, end date and alerts; it is stored with them and listed with the days left', async ({ page }) => {
  await openAccounts(page);
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('450');
  await pick(page, 'f-cat', 'الاشتراكات');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('اختار الاشتراك');
  expect(mock.accWrites).toEqual([]);
  await pick(page, 'f-subname', 'Canva');
  const ends = new Date(Date.now() + 5 * 864e5); const d = [String(ends.getDate()).padStart(2, '0'), String(ends.getMonth() + 1).padStart(2, '0'), ends.getFullYear()].join('/');
  await modal(page).locator('#f-subends').fill(d); await modal(page).locator('#f-subends').press('Tab');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_expenses', category: 'الاشتراكات', sub_name: 'Canva', sub_is_other: false, sub_alerts: ['month', 'week', 'day'] });
  await expect(main(page).locator('.subs-tbl')).toContainText('Canva');
  await expect(main(page).locator('.subs-tbl')).toContainText(/باقي [45] يوم/);
});

test('makers: Dokan balance, the open Dokan request, a deposit recorded here lowers the net; the brief and the Dokan statement read-only', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const table = main(page).locator('table.vendors-table');
  await expect(table.locator('thead th')).toContainText(['رصيد Dokan', 'الصافي']);
  const art = table.locator('tbody tr', { hasText: 'Art Craft' });
  await expect(art).toContainText('2,500.00');
  await expect(art.locator('[data-wd]')).toHaveText('يوجد'); // the pending Dokan request
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('لا يوجد'); // a cancelled one is not open
  // a deposit (عربون) of 700 for Art Craft
  await add(page, 'إضافة مبلغ', 'إيداع');
  await pick(page, 'f-vendor', 'Art Craft');
  await modal(page).locator('#f-amount').fill('700');
  await pick(page, 'f-type', 'عربون');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_vendor_moves', vendor_id: V1, direction: 'deposit', kind: 'عربون', kind_name: null, amount: 700 });
  await expect(art).toContainText('1,800.00'); // 2,500 − 700
  // the brief: no internal request, no payout here; the statement fetched on demand (the approval: its own case)
  await art.locator('[data-wd]').click();
  await expect(modal(page)).toContainText('تقرير مختصر — Art Craft');
  await expect(modal(page)).toContainText('الموافقة بتتكتب على Dokan نفسه');
  await expect(modal(page).getByRole('button', { name: /طلب سحب داخلي|تسجيل التحويل/ })).toHaveCount(0);
  await modal(page).getByRole('button', { name: 'كشف حساب Dokan' }).click();
  await expect(page.locator('.modal[role=dialog]', { hasText: 'كشف حساب Dokan — Art Craft' })).toBeVisible();
  await expect(page.locator('.modal[role=dialog]', { hasText: 'كشف حساب Dokan' })).toContainText('Order #55');
  expect(mock.statements).toEqual([expect.objectContaining({ vendor_id: V1 })]);
});

test('the columns (phase 4.1, every table): hiding one is saved for the member in user_prefs (table.cols); the first column stays', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  await expect(main(page).locator('table.vendors-table')).toHaveClass(/sticky-col1/);
  await main(page).locator('[data-cols^="tbl:حسابات المبتكرين"]').click();
  await expect(modal(page).locator('[data-col-item="المبتكر"] [role=switch], [data-col-item="المبتكر"] input').first()).toBeDisabled();
  await modal(page).locator('[data-col-item="رصيد Dokan"] [role=switch], [data-col-item="رصيد Dokan"] input').first().click();
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(main(page).locator('table.vendors-table thead th', { hasText: 'رصيد Dokan' })).toBeHidden();
  await expect.poll(() => { const p = mock.prefs.find((x) => x.key === 'table.cols'); return p ? Object.entries(p.data).map(([k, v]) => [k, v.hidden]) : null; }).toEqual([['tbl:حسابات المبتكرين', ['رصيد Dokan']]]);
  // another tab's table has its own button
  await tab(page, 'المصروفات').click();
  await expect(main(page).locator('[data-cols="tbl:تفاصيل المصروفات"]')).toBeVisible();
});

test('sales come from our orders by status group; the moves log lists Dokan requests', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'المبيعات').click();
  const sales = main(page).locator('table').first();
  for (const g of ['مكتملة', 'تحت التنفيذ', 'مرتجع / ملغي']) await expect(sales).toContainText(g);
  await expect(sales.locator('tr', { hasText: 'تحت التنفيذ' })).toContainText('4,543.00'); // the mock's open orders of this month
  await tab(page, 'سجل الحركات').click();
  await main(page).getByRole('tab', { name: 'حسابات المبتكرين' }).last().click();
  await expect(main(page).locator('.mlog-table')).toContainText('#501');
  await expect(main(page).locator('.mlog-table')).toContainText('مستني الموافقة');
});

test('ops (accounts.view = P, add N): no «المرتبات» rows, no add button; the server refuses a forced insert', async ({ page }) => {
  mock.acc.acc_expenses.push({ id: 90, on_date: cairo(), direction: 'withdraw', category: 'المرتبات', beneficiary: 'رواتب أكتوبر', beneficiary_other: true, amount: 9000, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, created_by: '00000000-0000-4000-8000-000000000001', created_at: '2026-10-27T08:00:00Z', voided_at: null },
    { id: 91, on_date: cairo(), direction: 'withdraw', category: 'الإعلانات', beneficiary: 'ميتا', beneficiary_other: true, amount: 3000, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, created_by: '00000000-0000-4000-8000-000000000001', created_at: '2026-10-27T08:00:00Z', voided_at: null });
  await openAccounts(page, OPS);
  await expect(main(page).locator('tr', { hasText: 'ميتا' })).toHaveCount(1);
  await expect(main(page).locator('tr', { hasText: 'رواتب أكتوبر' })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'إضافة مصروفات' })).toHaveCount(0);
  const r = await page.evaluate(() => window.IBAccounts.add('accountMoves', { account: 'حساب البنك', date: '2026-10-27', direction: 'deposit', amount: 5 }));
  expect(r).toEqual({ ok: false, reason: 'forbidden' });
  expect(mock.accWrites).toEqual([]);
});

test('accounts (approve P) edits its own move but only views the admin\'s', async ({ page }) => {
  mock.acc.acc_account_moves.push({ id: 70, account: 'حساب البنك', on_date: cairo(), direction: 'deposit', amount: 5000, note: null, created_by: '00000000-0000-4000-8000-000000000001', created_at: '2026-10-27T08:00:00Z', voided_at: null });
  await openAccounts(page, ACCOUNTS);
  await tab(page, 'الحساب الفعلي').click();
  const row = main(page).locator('tr', { hasText: '5,000.00' }).last();
  await row.getByRole('button', { name: 'إجراءات الصف' }).click();
  await expect(page.locator('[role=menu]')).toContainText('عرض');
  await expect(page.locator('[role=menu]')).not.toContainText('حذف');
});

// ---------------------------------------------------------------- phase 4.1 (docs/superpowers/plans/2026-10-28-phase-4-1-accounts-prototype.md)

test('approve a pending Dokan request from the brief (admin): confirm → woo-sync withdraw_approve, logged; with the push gate off nothing is approved', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const art = main(page).locator('table.vendors-table tbody tr', { hasText: 'Art Craft' });
  mock.pushEnabled = false;
  await art.locator('[data-vreport]').click(); // the name opens the brief (no «تقرير» button)
  await modal(page).getByRole('button', { name: /موافقة على طلب السحب/ }).click();
  await page.locator('.modal[role=dialog]', { hasText: 'موافقة على طلب السحب #501' }).getByRole('button', { name: 'وافق على Dokan' }).click();
  await expect(main(page)).toContainText('الكتابة على Dokan مقفولة دلوقتي');
  expect(mock.approvals).toEqual([{ id: 501, by: ADMIN, result: 'skipped', reason: 'push_disabled' }]);
  mock.pushEnabled = true;
  await art.locator('[data-vreport]').click();
  await modal(page).getByRole('button', { name: /موافقة على طلب السحب/ }).click();
  await page.locator('.modal[role=dialog]', { hasText: 'موافقة على طلب السحب #501' }).getByRole('button', { name: 'وافق على Dokan' }).click();
  await expect(main(page)).toContainText('اتوافق على طلب السحب #501');
  expect(mock.approvals.at(-1)).toEqual({ id: 501, by: ADMIN, result: 'ok' });
  expect(mock.acc.dokan_withdrawals.find((w) => w.id === 501).status).toBe('approved');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'accounts.withdraw.approve').map((a) => a.new_value)).toEqual(['#501 · 1200']);
  expect(mock.accWrites.filter((w) => w.table === 'acc_vendor_moves')).toEqual([]); // no payout move: Dokan lowers the balance itself
  await art.locator('[data-vreport]').click();
  await expect(modal(page).getByRole('button', { name: /موافقة على طلب السحب/ })).toHaveCount(0);
  await expect(modal(page)).toContainText('اتوافق عليه على Dokan');
});

test('the approve button needs accounts.approve = F; the maker\'s file opens in place', async ({ page }) => {
  await openAccounts(page, ACCOUNTS);
  await tab(page, 'حسابات المبتكرين').click();
  const art = main(page).locator('table.vendors-table tbody tr', { hasText: 'Art Craft' });
  await art.locator('[data-vreport]').click();
  await expect(modal(page)).toContainText('تقرير مختصر — Art Craft');
  await expect(modal(page).getByRole('button', { name: /موافقة على طلب السحب/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
  await art.getByRole('button', { name: /إجراءات/ }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'افتح ملف المبتكر' }).first().click();
  await expect(page.locator('.drawer')).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('makers');
  await expect(main(page).getByRole('tab', { name: 'حسابات المبتكرين' })).toBeVisible(); // still on the accounts page
});

test('fields per type: a deposit takes its source and reason; a payroll to someone outside the team is staff / freelance; ads take the platform', async ({ page }) => {
  await openAccounts(page);
  await add(page, 'إضافة مصروفات', 'إيداع');
  await modal(page).locator('#f-amount').fill('300');
  await pick(page, 'f-cat', 'الاشتراكات');
  await expect(modal(page).locator('#f-subname')).toHaveCount(0); // a deposit is money coming back: no subscription fields
  await modal(page).locator('#f-src').fill('Canva');
  await pick(page, 'f-reason', 'إلغاء اشتراك');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ category: 'الاشتراكات', direction: 'deposit', beneficiary: 'Canva', reason: 'إلغاء اشتراك', sub_name: null, sub_alerts: [] });
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('900');
  await pick(page, 'f-cat', 'المرتبات');
  await pick(page, 'f-ben', 'حد من بره الفريق');
  await modal(page).locator('#f-other').fill('سامح فريلانسر');
  await modal(page).getByText('فريلانس — شغل مرة واحدة وخلص').click();
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.accWrites.length).toBe(2);
  expect(mock.accWrites[1]).toMatchObject({ category: 'المرتبات', beneficiary: 'سامح فريلانسر', beneficiary_other: true, staff_kind: 'freelance' });
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('500');
  await pick(page, 'f-cat', 'الإعلانات');
  await pick(page, 'f-plat', '+ إضافة منصة جديدة');
  await page.locator('.modal[role=dialog]', { hasText: 'إضافة منصة إعلانات' }).locator('input').first().fill('سناب شات');
  await page.locator('.modal[role=dialog]', { hasText: 'إضافة منصة إعلانات' }).getByRole('button', { name: 'إضافة' }).click();
  await expect.poll(() => mock.accWrites.filter((w) => w.table === 'acc_list_items')).toEqual([expect.objectContaining({ list: 'ads', name: 'سناب شات' })]);
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => mock.accWrites.filter((w) => w.table === 'acc_expenses').length).toBe(3);
  expect(mock.accWrites.filter((w) => w.table === 'acc_expenses')[2]).toMatchObject({ category: 'الإعلانات', beneficiary: 'سناب شات' });
});

test('subscriptions: «جدّد» opens a new expense a year on; the sales show the makers\' share', async ({ page }) => {
  await openAccounts(page);
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('450');
  await pick(page, 'f-cat', 'الاشتراكات');
  await pick(page, 'f-subname', 'Canva');
  const ends = new Date(Date.now() + 5 * 864e5); const d = [String(ends.getDate()).padStart(2, '0'), String(ends.getMonth() + 1).padStart(2, '0'), ends.getFullYear()].join('/');
  await modal(page).locator('#f-subends').fill(d); await modal(page).locator('#f-subends').press('Tab');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toBeHidden();
  await expect(main(page).locator('.subs-tbl')).toContainText('Canva');
  await main(page).locator('[data-renew="Canva"]').click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator('#f-subends')).toHaveValue([String(ends.getDate()).padStart(2, '0'), String(ends.getMonth() + 1).padStart(2, '0'), ends.getFullYear() + 1].join('/'));
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await tab(page, 'المبيعات').click();
  await expect(main(page).locator('table thead')).toContainText('حصة المبتكرين (ج.م)');
  await expect(main(page).locator('table thead')).not.toContainText('نسبة حصة إبتكر');
});

test('«تحديث من Dokan» brings a new request now; the withdraw filter shows only the makers with one', async ({ page }) => {
  await openAccounts(page, ACCOUNTS);
  await tab(page, 'حسابات المبتكرين').click();
  const table = main(page).locator('table.vendors-table');
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('لا يوجد');
  mock.dokanNewRequests = [{ id: 601, woo_vendor_id: 44, vendor_id: V2, amount: 450, charge: 0, receivable: 450, status: 'pending', method: 'bank', requested_at: '2026-10-28 09:00:00', synced_at: '2026-10-28T09:00:00Z' }];
  await main(page).locator('[data-dokan-refresh]').click();
  await expect(main(page)).toContainText('اتحدّثت طلبات السحب من Dokan — 2 طلب مستني الموافقة.');
  expect(mock.refreshes).toBe(1);
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('يوجد');
  // the filter: makers with a request only
  await main(page).locator('[data-wd-filter]').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'مستني الموافقة بس' }).first().click();
  await expect(table.locator('tbody tr')).toHaveCount(2); // Art Craft (#501) + Antikiano (#601)
  await expect(table.locator('tbody tr', { hasText: 'Art Craft' })).toHaveCount(1);
  await expect(main(page).locator('.table-title .count')).toContainText('مستني الموافقة بس');
  await main(page).locator('[data-wd-filter]').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'طلبات السحب: الكل' }).first().click();
  await expect(table.locator('tbody tr').filter({ hasNot: page.locator('.total') })).not.toHaveCount(2);
});

test('the refresh needs accounts.view; ops (view P) may refresh, Dokan down → an error note', async ({ page }) => {
  await openAccounts(page, OPS);
  await tab(page, 'حسابات المبتكرين').click();
  mock.wooDown = true;
  await main(page).locator('[data-dokan-refresh]').click();
  await expect(main(page)).toContainText('Dokan مش بيرد دلوقتي');
});
