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
  await page.locator('#main [role=tab]', { hasText: 'المصروفات' }).first().click(); // decision 61: the page opens on «نظرة عامة»
}
const main = (page) => page.locator('#main');
const tab = (page, label) => main(page).getByRole('tab', { name: label });
const modal = (page) => page.locator('.modal[role=dialog]');
async function pick(page, id, label) { await modal(page).locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }
// 0143: every expense / maker withdraw names its account; an account going below zero asks «احفظ برضه» once
async function saveForm(page, account = 'حساب البنك') {
  const acc = modal(page).locator('#f-macc');
  if (await acc.count() && /اختار الحساب/.test(await acc.innerText())) await pick(page, 'f-macc', account);
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  const again = modal(page).getByRole('button', { name: 'احفظ برضه' });
  if (await again.waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) await again.click();
}
async function add(page, menu, dir) { await main(page).getByRole('button', { name: menu, exact: true }).click(); await page.locator('[role=menu] [role=menuitem], [role=menu] .opt', { hasText: dir }).first().click(); await expect(modal(page)).toBeVisible(); }

test('the page is open with its six tabs, no September seed: the numbers start at zero and the range is this month', async ({ page }) => {
  await openAccounts(page);
  await expect(main(page).getByRole('tab')).toHaveText(['نظرة عامة', 'المصروفات', 'الاشتراكات', 'المبيعات', 'حسابات المبتكرين', 'الحساب الفعلي', 'سجل الحركات', 'مفقودات', 'التقارير']); // the meeting 23 Nov #39: «مفقودات» · phase 5.5: «الاشتراكات» of its own; decision 61: «نظرة عامة» / «التقارير»
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
  await saveForm(page);
  await expect(modal(page)).toContainText('اكتب تفاصيل المصروف'); // phase 4.1: a general expense needs its details
  expect(mock.accWrites).toEqual([]);
  await modal(page).locator('#f-details').fill('ورق طباعة وكراتين');
  await saveForm(page);
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
  await saveForm(page);
  await expect(modal(page)).toContainText('اختار الاشتراك');
  expect(mock.accWrites).toEqual([]);
  await pick(page, 'f-subname', 'Canva');
  const ends = new Date(Date.now() + 5 * 864e5); const d = [String(ends.getDate()).padStart(2, '0'), String(ends.getMonth() + 1).padStart(2, '0'), ends.getFullYear()].join('/');
  await modal(page).locator('#f-subends').fill(d); await modal(page).locator('#f-subends').press('Tab');
  await saveForm(page);
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_expenses', category: 'الاشتراكات', sub_name: 'Canva', sub_is_other: false, sub_alerts: ['month', 'week', 'day'] });
  await expect(main(page).locator('[data-subs-summary]')).toContainText('اشتراكات نشطة'); // phase 5.5: a summary in «المصروفات», the table in its own tab
  // the owner 13 Nov: the link's words at the right and its arrow after them at the left
  await expect(main(page).locator('[data-go-subs]')).toBeVisible(); // 0143: the ledgers are read again after the save (the linked account move)
  await expect.poll(() => main(page).locator('[data-go-subs]').evaluate((b) => { const t = Array.from(b.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(t); return r.getBoundingClientRect().left > b.querySelector('svg').getBoundingClientRect().right; })).toBe(true);
  await main(page).locator('[data-go-subs]').click();
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
  await expect(art.locator('[data-wd]')).toHaveText('طلب جديد'); await expect(art.locator('[data-wd-amt]')).toHaveText('1,200.00'); // the pending Dokan request (0078: its status and amount)
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('تم الرفض'); // the meeting of 23 Nov [#19]: the latest request shows even when Dokan cancelled it (its rejection)
  // 0078: an «عربون» of 700 paid to Art Craft is a «سحب» from his net («إضافة مبلغ»)
  await add(page, 'إضافة مبلغ', 'سحب');
  await pick(page, 'f-vendor', 'Art Craft');
  await modal(page).locator('#f-amount').fill('700');
  await pick(page, 'f-type', 'عربون');
  await saveForm(page);
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_vendor_moves', vendor_id: V1, direction: 'withdraw', kind: 'عربون', kind_name: null, amount: 700 });
  await expect(art).toContainText('1,800.00'); // 2,500 − 700
  // the brief: no internal request, no payout here; the statement fetched on demand (the approval: its own case)
  await art.locator('[data-wd]').click();
  await expect(modal(page)).toContainText('تقرير مختصر — Art Craft');
  await expect(modal(page)).toContainText('وبعدين وافق أو ارفض — الاتنين بيتكتبوا على Dokan نفسه');
  await expect(modal(page).getByRole('button', { name: /طلب سحب داخلي|تسجيل التحويل/ })).toHaveCount(0);
  // comments decision 10: «كشف حساب Dokan» and «نسخ CSV» left the popup — three buttons: «مشاركة» · «التقرير الكامل» · «إغلاق»; the statement is in the row's ⋮
  await expect(modal(page).locator('.modal-f button')).toHaveText(['مشاركة', 'التقرير الكامل', 'إغلاق']);
  await page.keyboard.press('Escape');
  await art.getByRole('button', { name: /إجراءات/ }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'كشف حساب Dokan' }).first().click();
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
  await saveForm(page);
  await expect(main(page).locator('table.vendors-table thead th', { hasText: 'رصيد Dokan' })).toBeHidden();
  await expect.poll(() => { const p = mock.prefs.find((x) => x.key === 'table.cols'); return p ? Object.entries(p.data).map(([k, v]) => [k, v.hidden]) : null; }).toEqual([['tbl:حسابات المبتكرين', ['رصيد Dokan']]]);
  // decision 50: the order by the six-dot grip (drag) — no arrows; the first column has no grip
  await main(page).locator('[data-cols^="tbl:حسابات المبتكرين"]').click();
  await expect(modal(page).getByRole('button', { name: /^لفوق|^لتحت/ })).toHaveCount(0);
  await expect(modal(page).locator('[data-col-item="المبتكر"] [data-grip]')).toHaveCount(0);
  const ids = () => modal(page).locator('[data-col-item]').evaluateAll((rs) => rs.map((r) => r.dataset.colItem));
  const before = await ids();
  const moving = before[3]; const target = before[1];
  const g = await modal(page).locator(`[data-col-item="${moving}"] [data-grip]`).boundingBox();
  const t = await modal(page).locator(`[data-col-item="${target}"]`).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, t.y + 4, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await ids()).indexOf(moving)).toBe(1);
  expect((await ids())[0]).toBe('المبتكر');
  await saveForm(page);
  await expect.poll(() => { const p = mock.prefs.find((x) => x.key === 'table.cols'); return p ? p.data['tbl:حسابات المبتكرين'].order.indexOf(moving) : -1; }).toBe(1);
  // another tab's table has its own button
  await tab(page, 'المبيعات').click();
  await expect(main(page).locator('[data-cols="tbl:تفاصيل المبيعات حسب حالة الأوردر"]')).toBeVisible();
});

test('sales come from our orders by status group; the moves log lists Dokan requests', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'المبيعات').click();
  // the mock's open orders are 6 and 8 days old: in the month's first days they fall in the month before, so the range is the last 30 days
  await main(page).getByRole('button', { name: 'اختيار الفترة' }).click();
  await page.getByRole('radio', { name: 'آخر 30 يومًا' }).click();
  await page.getByRole('button', { name: 'تحديث', exact: true }).click();
  const sales = main(page).locator('table').first();
  for (const g of ['مكتملة', 'تحت التنفيذ', 'مرتجع / ملغي']) await expect(sales).toContainText(g);
  await expect(sales.locator('tr', { hasText: 'تحت التنفيذ' })).toContainText('4,543.00'); // the mock's open orders of the last 30 days
  await tab(page, 'سجل الحركات').click();
  await main(page).getByRole('tab', { name: 'حسابات المبتكرين' }).last().click();
  await main(page).locator('.mlog-bar [aria-label="اختيار الفترة"]').click(); await page.getByRole('radio', { name: 'أقصى فترة' }).click(); await page.getByRole('button', { name: 'تحديث', exact: true }).click(); // the meeting of 23 Nov [#4]: the log opens on this month — the request of 25 Oct is older
  await expect(main(page).locator('.mlog-table')).toContainText('#501');
  await expect(main(page).locator('.mlog-table')).toContainText('طلب جديد');
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

// the owner 18 Nov: «ضفلي امكانية رفض طلب السحب و يسمع علي dokan بالرفض»
test('owner 18 Nov: reject a pending Dokan request from ⋮ — a reason is required, woo-sync withdraw_reject cancels it, logged without the reason', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const art = main(page).locator('table.vendors-table tbody tr', { hasText: 'Art Craft' });
  await art.getByRole('button', { name: /إجراءات Art Craft/ }).click();
  await page.locator('[role=menu]').getByText('رفض طلب السحب').click();
  const brief = page.locator('.modal.vb-modal');
  await expect(brief).toContainText('رفض طلب السحب #501 بمبلغ 1,200.00 ج.م؟');
  await brief.locator('[data-vb-reject-go]').click();
  await expect(brief.locator('[data-vb-res]')).toContainText('اكتب سبب الرفض الأول');
  expect(mock.rejects).toEqual([]);
  await brief.locator('[data-vb-reject-note]').fill('الحساب البنكي غلط');
  await brief.locator('[data-vb-reject-go]').click();
  await expect(brief.locator('[data-vb-res]')).toContainText('اترفض طلب السحب #501');
  expect(mock.rejects).toEqual([{ id: 501, by: ADMIN, note: 'الحساب البنكي غلط', result: 'ok' }]);
  expect(mock.acc.dokan_withdrawals.find((w) => w.id === 501).status).toBe('cancelled');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'accounts.withdraw.reject').map((a) => a.new_value)).toEqual(['#501 · 1200']);
  expect(JSON.stringify(mock.activity)).not.toContain('الحساب البنكي غلط');
  await expect(brief.getByRole('button', { name: 'رفض الطلب' })).toHaveCount(0);
});

test('owner 18 Nov: the reject button sits next to the approve one in the brief; a member without accounts.approve sees neither', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  await main(page).locator('table.vendors-table tbody tr', { hasText: 'Art Craft' }).locator('[data-vreport]').click();
  const brief = page.locator('.modal.vb-modal');
  await expect(brief.locator('[data-vb-reject]')).toBeVisible();
  await brief.locator('[data-vb-reject]').click();
  await expect(brief.locator('[data-vb-reject-note]')).toBeVisible();
  await brief.locator('[data-vb-later]').click();
  await expect(brief.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'pending');
  expect(mock.rejects).toEqual([]);
});

// ---------------------------------------------------------------- phase 4.1 (docs/superpowers/plans/2026-10-28-phase-4-1-accounts-prototype.md)

test('approve a pending Dokan request from the brief (admin): confirm → woo-sync withdraw_approve, logged; with the push gate off nothing is approved', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const art = main(page).locator('table.vendors-table tbody tr', { hasText: 'Art Craft' });
  mock.pushEnabled = false;
  await art.locator('[data-vreport]').click(); // the name opens the brief (no «تقرير» button)
  // comments decision 11: the approval is asked and answered inside the same popup — no second popup, the brief stays open
  const brief = page.locator('.modal.vb-modal');
  await brief.getByRole('button', { name: /موافقة على طلب السحب/ }).click();
  await expect(brief.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'ask');
  await expect(brief).toContainText('طلب السحب #501 بمبلغ 1,200.00 ج.م على Dokan — توافق عليه دلوقتي؟');
  await expect(page.locator('.modal[role=dialog]')).toHaveCount(1);
  await brief.locator('[data-vb-approve]').click(); // 0143: no account picked → asked, nothing sent
  await expect(brief.locator('[data-vb-res]')).toHaveText('اختار الحساب اللي هيتحوّل منه للمبتكر الأول.');
  expect(mock.approvals).toEqual([]);
  await brief.locator('[data-vb-acc]').selectOption('حساب البنك');
  await brief.locator('[data-vb-approve]').click();
  await expect(brief.locator('[data-vb-res]')).toHaveText('الكتابة على Dokan مقفولة دلوقتي — الطلب ما اتوافقش عليه.');
  await expect(main(page)).toContainText('الكتابة على Dokan مقفولة دلوقتي');
  expect(mock.approvals).toEqual([{ id: 501, by: ADMIN, result: 'skipped', reason: 'push_disabled' }]);
  mock.pushEnabled = true;
  await brief.getByRole('button', { name: /موافقة على طلب السحب/ }).click(); // the same popup, again
  await brief.locator('[data-vb-later]').click(); // «بعدين»: nothing is sent, the request stays pending
  await expect(brief.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'pending');
  expect(mock.approvals).toHaveLength(1);
  await brief.getByRole('button', { name: /موافقة على طلب السحب/ }).click();
  await expect(brief.locator('[data-vb-acc]')).toHaveValue('حساب البنك'); // the account picked before is kept
  await brief.locator('[data-vb-approve]').click();
  await expect(brief.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'approved'); // the popup follows Dokan's mirror
  await expect(brief.locator('[data-vb-res]')).toContainText('اتوافق على طلب السحب #501');
  await page.keyboard.press('Escape');
  await expect(main(page)).toContainText('اتوافق على طلب السحب #501');
  expect(mock.approvals.at(-1)).toEqual({ id: 501, by: ADMIN, result: 'ok', account: 'حساب البنك' });
  // 0143: the cash transferred leaves the account picked, the maker its beneficiary
  expect(mock.acc.acc_account_moves.filter((m) => m.withdraw_id === 501).map((m) => [m.account, m.direction, m.amount, m.beneficiary])).toEqual([['حساب البنك', 'withdraw', 1200, 'Art Craft']]);
  expect(mock.acc.dokan_withdrawals.find((w) => w.id === 501).status).toBe('approved');
  await expect.poll(() => mock.activity.filter((a) => a.action === 'accounts.withdraw.approve').map((a) => a.new_value)).toEqual(['#501 · 1200']);
  expect(mock.accWrites.filter((w) => w.table === 'acc_vendor_moves')).toEqual([]); // no payout move: Dokan lowers the balance itself
  await art.locator('[data-vreport]').click();
  await expect(modal(page).getByRole('button', { name: /موافقة على طلب السحب/ })).toHaveCount(0);
  await expect(modal(page)).toContainText('تم الدفع على Dokan');
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
  await saveForm(page);
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ category: 'الاشتراكات', direction: 'deposit', beneficiary: 'Canva', reason: 'إلغاء اشتراك', sub_name: null, sub_alerts: [] });
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('900');
  await pick(page, 'f-cat', 'المرتبات');
  await pick(page, 'f-ben', 'حد من بره الفريق');
  await modal(page).locator('#f-other').fill('سامح فريلانسر');
  await modal(page).getByText('فريلانس — شغل مرة واحدة وخلص').click();
  await saveForm(page);
  await expect.poll(() => mock.accWrites.length).toBe(2);
  expect(mock.accWrites[1]).toMatchObject({ category: 'المرتبات', beneficiary: 'سامح فريلانسر', beneficiary_other: true, staff_kind: 'freelance' });
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('500');
  await pick(page, 'f-cat', 'الإعلانات');
  await pick(page, 'f-plat', '+ إضافة منصة جديدة');
  await page.locator('.modal[role=dialog]', { hasText: 'إضافة منصة إعلانات' }).locator('input').first().fill('سناب شات');
  await page.locator('.modal[role=dialog]', { hasText: 'إضافة منصة إعلانات' }).getByRole('button', { name: 'إضافة' }).click();
  await expect.poll(() => mock.accWrites.filter((w) => w.table === 'acc_list_items')).toEqual([expect.objectContaining({ list: 'ads', name: 'سناب شات' })]);
  await saveForm(page);
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
  await saveForm(page);
  await expect(modal(page)).toBeHidden();
  await tab(page, 'الاشتراكات').click();
  await expect(main(page).locator('.subs-tbl')).toContainText('Canva');
  await main(page).locator('[data-renew="Canva"]').click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator('#f-subends')).toHaveValue([String(ends.getDate()).padStart(2, '0'), String(ends.getMonth() + 1).padStart(2, '0'), ends.getFullYear() + 1].join('/'));
  await modal(page).getByRole('button', { name: 'إلغاء' }).click();
  await tab(page, 'المبيعات').click();
  await expect(main(page).locator('table thead').first()).toContainText('حصة المبتكرين (ج.م)');
  await expect(main(page).locator('table thead').first()).not.toContainText('نسبة حصة إبتكر');
});

test('«تحديث من Dokan» brings a new request now; the withdraw filter shows only the makers with one', async ({ page }) => {
  await openAccounts(page, ACCOUNTS);
  await tab(page, 'حسابات المبتكرين').click();
  const table = main(page).locator('table.vendors-table');
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('تم الرفض'); // [#19]: its cancelled request
  mock.dokanNewRequests = [{ id: 601, woo_vendor_id: 44, vendor_id: V2, amount: 450, charge: 0, receivable: 450, status: 'pending', method: 'bank', requested_at: '2026-10-28 09:00:00', synced_at: '2026-10-28T09:00:00Z' }];
  // the owner (11 Nov): any call the member starts shows the busy pill with what is happening (busy.js; the mock answers at once,
  // so the pill's delay is 0 here)
  await page.evaluate(() => window.IBBusy.setDelay(0));
  await main(page).locator('[data-dokan-refresh]').click();
  await expect(page.locator('.busy-stack .busy-pill', { hasText: 'بنحدّث الأرصدة وطلبات السحب من Dokan…' })).toBeVisible();
  await expect(main(page)).toContainText('اتحدّثت أرصدة المبتكرين وطلبات السحب من Dokan — 2 طلب مستني الموافقة.');
  expect(mock.refreshes).toBe(1);
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-wd]')).toHaveText('طلب جديد');
  // the filter: makers with a request only
  await main(page).locator('[data-wd-filter]').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'طلب جديد بس' }).first().click();
  await expect(table.locator('tbody tr')).toHaveCount(2); // Art Craft (#501) + Antikiano (#601)
  await expect(table.locator('tbody tr', { hasText: 'Art Craft' })).toHaveCount(1);
  await expect(main(page).locator('.table-title [data-th-sub]')).toContainText('طلب جديد بس'); // the head's count line (2026-11-13-table-head.md)
  await main(page).locator('[data-wd-filter]').click();
  await page.locator('[role=listbox] [role=option]', { hasText: 'طلبات السحب: الكل' }).first().click();
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' })).toHaveCount(1);
  await expect(table.locator('tbody tr', { hasText: 'Bian eg' })).toHaveCount(0); // the meeting of 23 Nov [#17]: stopped, nothing on his account
});

test('the refresh needs accounts.view; ops (view P) may refresh, Dokan down → an error note', async ({ page }) => {
  await openAccounts(page, OPS);
  await tab(page, 'حسابات المبتكرين').click();
  mock.wooDown = true;
  await main(page).locator('[data-dokan-refresh]').click();
  await expect(main(page)).toContainText('Dokan مش بيرد دلوقتي');
});


// ---- phase 5.5 (the owner's prototype v2, plan decision 4): the accounts additions ----
test('5.5: the moves log has its own period (wide by default) and a bulk export; the owner 13 Nov: the expenses details card has no buttons in its head', async ({ page }) => {
  await openAccounts(page);
  // expenses details (the owner 13 Nov — «شيل الزراير من تفاصيل المصروفات»): the four categories with their total, no «بحث» / «فلتر» / «ترتيب» / columns
  const details = main(page).locator('.table-card', { hasText: 'تفاصيل المصروفات' });
  await expect(details.locator('tbody tr')).toHaveCount(4);
  await expect(details.locator('table')).toContainText('إجمالي الأربع فئات');
  await expect(details.locator('[data-tq-btn], [data-fm-btn], [data-sm-btn], [data-cols], .af-row')).toHaveCount(0);
  // the moves log: the Dokan request of 25 Oct is in the wide default period; its own range field; the bulk bar exports the ticked rows
  await tab(page, 'سجل الحركات').click();
  await main(page).getByRole('tab', { name: 'حسابات المبتكرين' }).last().click();
  await main(page).locator('.mlog-bar [aria-label="اختيار الفترة"]').click(); await page.getByRole('radio', { name: 'أقصى فترة' }).click(); await page.getByRole('button', { name: 'تحديث', exact: true }).click(); // the meeting of 23 Nov [#4]: the log opens on this month — the request of 25 Oct is older
  await expect(main(page).locator('.mlog-table')).toContainText('#501');
  await expect(main(page).locator('.mlog-bar [aria-label="اختيار الفترة"]')).toBeVisible();
  await main(page).locator('.mlog-table [data-bulk-box]').first().click();
  await expect(main(page).locator('[data-bulk^="mlog-"] b')).toHaveText('محدد 1 حركة');
  await main(page).locator('[data-bulk-act="xlsx"]').click();
  await expect.poll(() => page.evaluate(() => window.__lastExport && window.__lastExport.rows)).toBe(2); // the header + one row
  await expect(main(page).locator('[data-bulk^="mlog-"]')).toHaveCount(0);
});

test('the owner 13 Nov: the moves log\'s calendar «مقارنة بفترة سابقة» puts each card against the same length before; «نسخ CSV» never hands a spreadsheet a formula (a name starting with =)', async ({ page }) => {
  const day = (n) => { const d = new Date(Date.now() + 2 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const exp = (id, on, amount, who) => ({ id, on_date: on, direction: 'withdraw', category: 'المصروفات', beneficiary: who || 'مكتب', beneficiary_other: true, amount, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, created_by: '00000000-0000-4000-8000-000000000001', created_at: on + 'T08:00:00Z', voided_at: null });
  mock.acc.acc_expenses.push(exp(95, day(-1), 500, '=HYPERLINK("http://x.example","اضغط")'), exp(96, day(-10), 200, null));
  await openAccounts(page);
  await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve(); }; });
  await tab(page, 'سجل الحركات').click();
  await main(page).getByRole('tab', { name: 'المصروفات' }).last().click();
  const out = main(page).locator('.kpi[aria-label="خارج"]');
  await expect(out.locator('.kpi-delta')).toHaveCount(0);
  // a 7-day period with the comparison: the period before holds the 200 one
  await main(page).locator('.mlog-bar .date-field').click();
  await page.locator('.dp .presets [role=radio]', { hasText: 'آخر 7 أيام' }).click();
  await page.locator('.dp [data-rp-compare="mlog"] input[type=checkbox]').check();
  await page.locator('.dp').getByRole('button', { name: 'تحديث' }).click();
  await expect(out).toContainText('500.00');
  await expect(out.locator('.kpi-delta')).toContainText('عن الفترة اللي قبلها (200.00)');
  await expect(out.locator('.kpi-delta .pill')).toHaveText('+150%');
  await main(page).locator('[data-mlog-csv]').click();
  await expect.poll(() => page.evaluate(() => (window.__copied || []).length)).toBe(1);
  const csv = await page.evaluate(() => window.__copied[0]);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
});

test('5.5: the makers\' table shows the latest Dokan request per maker; the actual balance shows Ibtekr\'s balance after the makers\' Dokan balances', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const table = main(page).locator('table.vendors-table');
  await expect(table.locator('thead th')).toContainText(['آخر طلب سحب']);
  await expect(table.locator('tbody tr', { hasText: 'Art Craft' }).locator('[data-last]')).toHaveAttribute('data-last', '2026-10-25');
  await expect(table.locator('tbody tr', { hasText: 'Art Craft' }).locator('[data-last]')).toContainText('25/10/2026');
  await expect(table.locator('tbody tr', { hasText: 'Antikiano' }).locator('[data-last]')).toHaveText('—'); // a cancelled request does not count
  await tab(page, 'الحساب الفعلي').click();
  const owed = main(page).locator('[data-owed]');
  await expect(owed).toContainText('رصيد إبتكر بعد حساب المبتكرين');
  await expect(owed).toContainText('2,500'); // Art Craft's Dokan balance
  await expect(owed.locator('[data-owed-wd]')).toContainText('1 مبتكر · منه 1,200.00 في 1 طلب سحب');
});

// the accounts report by period (decision 4): tests/e2e/reports.spec.mjs (phase 9 opened the reports page)

test('the meeting of 23 Nov [#27]: «كشف بالفترة» left the makers\' accounts — the balance now, no sub-tab and no period', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  await expect(main(page).locator('table.vendors-table')).toBeVisible();
  await expect(main(page).getByRole('tab', { name: 'كشف بالفترة' })).toHaveCount(0);
  await expect(main(page).locator('.toolbar .date-field')).toHaveCount(0);
  expect(mock.statements.length).toBe(0); // no statement asked from Dokan
});

// phase 13 decision 61: «نظرة عامة» first and «التقارير» last in the accounts page
test('decision 61: the accounts tabs start with «نظرة عامة» (the period at a glance, each tile opens its tab) and end with «التقارير»', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.locator('.sidebar .nav-item[data-page="accounts"]').click();
  const tabs = main(page).locator('[role=tablist]').first().locator('[role=tab]');
  await expect(tabs).toHaveText(['نظرة عامة', 'المصروفات', 'الاشتراكات', 'المبيعات', 'حسابات المبتكرين', 'الحساب الفعلي', 'سجل الحركات', 'مفقودات', 'التقارير']);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#acc-overview$/);
  await expect(main(page).locator('[data-acc-ov]')).toHaveCount(6);
  await expect(main(page).locator('.kpi[aria-label="إجمالي المصروفات"]')).toBeVisible();
  await expect(main(page)).toContainText('المصروفات حسب النوع');
  await main(page).locator('[data-acc-ov="expenses"] button').click();
  await expect(tab(page, 'المصروفات')).toHaveAttribute('aria-selected', 'true');
  await tabs.last().click();
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(main(page).locator('[data-accrep-page]')).toHaveCount(0); // comments decision 12: no «افتح في صفحة التقارير» on a reports tab
  await expect(main(page)).not.toContainText('افتح في صفحة التقارير');
});

// ---------------------------------------------------------------- 0078 (the owner, 11 Nov): the makers' settlement
const mvRow = (id, vendor_id, on_date, direction, kind, amount, extra = {}) => ({ id, vendor_id, on_date, direction, kind, kind_name: null, amount, note: null, created_by: null, created_at: on_date + 'T09:00:00Z', voided_at: null, settled_by: null, settled_at: null, ...extra });

test('0078: «الرصيد دلوقتي» is now (no period) and chains to the net; «إجراء» = «سحب» (عربون · مواصلات · أخرى) or «إيداع» (a correction with its title and description)', async ({ page }) => {
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  await expect(main(page).locator('.toolbar [aria-label="اختيار الفترة"]')).toHaveCount(0); // the balance now: no period picker
  await expect(main(page).locator('.table-title h2', { hasText: 'حسابات المبتكرين — الرصيد دلوقتي' })).toBeVisible();
  await main(page).getByRole('button', { name: 'إضافة مبلغ', exact: true }).click();
  await expect(page.locator('[role=menu]')).toContainText('سحب — عربون · مواصلات · أخرى');
  await expect(page.locator('[role=menu]')).toContainText('إيداع خارجي');
  await page.keyboard.press('Escape');
  // «إيداع» = a correction: no kind, a title (required) and a description
  await add(page, 'إضافة مبلغ', 'إيداع');
  await expect(modal(page)).toContainText('إيداع خارجي للمبتكر');
  await expect(modal(page).locator('#f-type')).toHaveCount(0);
  await pick(page, 'f-vendor', 'Art Craft');
  await modal(page).locator('#f-amount').fill('300');
  await saveForm(page);
  await expect(modal(page).locator('#f-other')).toHaveAttribute('aria-invalid', 'true');
  await modal(page).locator('#f-other').fill('فرق مقاس مخصص');
  await modal(page).locator('#f-note').fill('العميل طلب مقاس أكبر');
  await saveForm(page);
  await expect.poll(() => mock.accWrites.length).toBe(1);
  expect(mock.accWrites[0]).toMatchObject({ table: 'acc_vendor_moves', vendor_id: V1, direction: 'deposit', kind: 'أخرى', kind_name: 'فرق مقاس مخصص', note: 'العميل طلب مقاس أكبر', amount: 300 });
  // «سحب»: مواصلات 150 + أخرى «خامات» 200
  await add(page, 'إضافة مبلغ', 'سحب');
  await pick(page, 'f-vendor', 'Art Craft'); await modal(page).locator('#f-amount').fill('150'); await pick(page, 'f-type', 'مواصلات');
  await saveForm(page); await expect(modal(page)).toBeHidden();
  await add(page, 'إضافة مبلغ', 'سحب');
  await pick(page, 'f-vendor', 'Art Craft'); await modal(page).locator('#f-amount').fill('200'); await pick(page, 'f-type', 'أخرى');
  await modal(page).locator('#f-other').fill('خامات اتشرت له');
  await saveForm(page); await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.accWrites.length).toBe(3);
  const table = main(page).locator('table.vendors-table');
  await expect(table.locator('thead th')).toContainText(['رصيد Dokan', 'العرابين', 'المواصلات', 'ديون أخرى', 'إيداع خارجي', 'الصافي', 'طلب السحب', 'آخر طلب سحب']);
  await expect(table.locator('thead th', { hasText: 'مكتمل — عدد' })).toHaveCount(0); // the orders by period live in «كشف بالفترة»
  // 2,500 − 150 − 200 + 300 = 2,450
  await expect(table.locator('[data-vbal="Art Craft"]')).toHaveText('2,450.00');
});

test('0078: «تسوية دلوقتي» files a request on Dokan for the whole Dokan balance (pending); the approval settles the open moves and transfers the rest', async ({ page }) => {
  mock.acc.dokan_balances.push({ vendor_id: V2, woo_vendor_id: 44, balance: 25000, earning: 30000, sales: 40000, orders: 20, synced_at: '2026-11-11T10:00:00Z' });
  const d = cairo();
  mock.acc.acc_vendor_moves.push(mvRow(81, V2, d, 'withdraw', 'عربون', 4000), mvRow(82, V2, d, 'withdraw', 'مواصلات', 1000));
  await openAccounts(page);
  await tab(page, 'حسابات المبتكرين').click();
  const table = main(page).locator('table.vendors-table');
  const anti = table.locator('tbody tr', { hasText: 'Antikiano' });
  await expect(anti.locator('[data-vbal="Antikiano"]')).toHaveText('20,000.00'); // the owner's example: 25,000 − 4,000 − 1,000
  // the push gate off: nothing is filed
  mock.pushEnabled = false;
  await anti.getByRole('button', { name: /إجراءات/ }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'تسوية دلوقتي (تقفيل الحساب)' }).first().click();
  // comments decision 11: «تقفيل الحساب» is the short report's own popup, opened on the request's box with the open moves listed
  const settle = page.locator('.modal.vb-modal', { hasText: 'تقفيل حساب — Antikiano' });
  await expect(settle).toHaveAttribute('data-vb-modal', 'settle');
  await expect(settle.locator('[data-vb-tile]')).toHaveText([/رصيد Dokan\s*25,000\.00 ج\.م/, /العرابين\s*4,000\.00 ج\.م/, /المواصلات\s*1,000\.00 ج\.م/, /إيداع خارجي\s*0\.00 ج\.م/, /صافي الرصيد\s*20,000\.00 ج\.م/]);
  await expect(settle.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'settle');
  await expect(settle).toContainText('رصيده على Dokan 25,000.00 ج.م');
  // the owner 22 Nov: the amount is typed (up to the Dokan balance) and what the maker gets is said as it is typed
  await settle.locator('[data-vb-amount]').fill('25000');
  await expect(settle.locator('[data-vb-amt-msg]')).toContainText('الخصومات المفتوحة (5,000.00 ج.م) بتتصفّى منه — المبتكر يتحوّله 20,000.00 ج.م');
  await expect(settle.locator('[data-vb-moves]')).toHaveAttribute('open', '');
  await expect(settle.locator('[data-vb-moves] tbody tr')).toHaveCount(2);
  await settle.getByRole('button', { name: /اعمل طلب سحب على Dokan/ }).click();
  await expect(settle.locator('[data-vb-res]')).toHaveText('الكتابة على Dokan مقفولة دلوقتي — الطلب ما اتعملش.'); // the answer in the same popup
  await expect(main(page)).toContainText('الكتابة على Dokan مقفولة دلوقتي — الطلب ما اتعملش.');
  expect(mock.withdrawCreates).toEqual([{ vendor_id: V2, by: ADMIN, result: 'skipped', reason: 'push_disabled' }]);
  // the gate on: a pending request of 25,000 on Dokan, mirrored at once — and the same popup asks «وافق دلوقتي» / «بعدين»
  mock.pushEnabled = true;
  await settle.getByRole('button', { name: /اعمل طلب سحب على Dokan/ }).click();
  await expect(settle.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'ask');
  await expect(settle).toContainText('بمبلغ 25,000.00 ج.م على Dokan — توافق عليه دلوقتي؟');
  await expect(settle).toContainText('الخصومات المفتوحة (5,000.00 ج.م) بتتصفّى منه، واللي بيتحوّل للمبتكر 20,000.00 ج.م');
  await expect(page.locator('.modal[role=dialog]')).toHaveCount(1); // no second popup
  await expect(main(page)).toContainText('بمبلغ 25,000.00 ج.م على Dokan — مستني موافقتك.');
  // the owner (11 Nov — «خلي يبقي زي popup notification»): the call ran under the busy pill at the bottom centre, which ends with the result
  await expect(page.locator('.busy-stack .busy-pill[data-busy="ok"]')).toContainText('بمبلغ 25,000.00 ج.م على Dokan — مستني موافقتك.');
  expect(mock.withdrawCreates.at(-1)).toMatchObject({ vendor_id: V2, by: ADMIN, result: 'ok', amount: 25000, status: 'pending' });
  await expect.poll(() => mock.activity.filter((a) => a.action === 'accounts.withdraw.create').length).toBe(1);
  await settle.locator('[data-vb-later]').click(); // «بعدين»: the request waits
  await expect(settle.locator('[data-vb-req]')).toHaveAttribute('data-vb-req', 'pending');
  expect(mock.approvals || []).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(anti.locator('[data-wd]')).toHaveText('طلب جديد'); await expect(anti.locator('[data-wd-amt]')).toHaveText('25,000.00');
  await anti.getByRole('button', { name: /إجراءات/ }).click();
  await expect(page.locator('[role=menu]')).not.toContainText('تسوية دلوقتي'); // never with a pending request
  await page.keyboard.press('Escape');
  // the approval: the request covers the 5,000 of moves, 20,000 is transferred; Dokan's balance and the net follow
  await anti.locator('[data-vreport]').click();
  await expect(modal(page)).toContainText('واللي بيتحوّل للمبتكر 20,000.00 ج.م');
  await modal(page).getByRole('button', { name: /موافقة على طلب السحب/ }).click();
  const conf = page.locator('.modal.vb-modal');
  await expect(conf).toContainText('الخصومات المفتوحة (5,000.00 ج.م) بتتصفّى منه، واللي بيتحوّل للمبتكر 20,000.00 ج.م.');
  await conf.locator('[data-vb-acc]').selectOption('حساب البنك');
  await conf.locator('[data-vb-approve]').click();
  await expect(conf.locator('[data-vb-res]')).toContainText('واتصفّى منه 5,000.00 ج.م خصومات (2 حركة) — حوّل للمبتكر 20,000.00 ج.م.');
  await page.keyboard.press('Escape');
  await expect(main(page)).toContainText('واتصفّى منه 5,000.00 ج.م خصومات (2 حركة) — حوّل للمبتكر 20,000.00 ج.م.');
  expect(mock.acc.acc_vendor_settlements.at(-1)).toMatchObject({ vendor_id: V2, amount: 25000, consumed: 5000, carry_out: 0, cash: 20000, moves: 2 });
  await expect(anti.locator('[data-vbal="Antikiano"]')).toHaveText('0.00'); // Dokan 0 − nothing open
  await expect(anti.locator('[data-wd]')).toHaveText('تم الدفع'); await expect(anti.locator('[data-wd-amt]')).toHaveText('20,000.00');
  // a settled move is final: no «تعديل» / «حذف» in the moves log
  await tab(page, 'سجل الحركات').click();
  await main(page).getByRole('tab', { name: 'حسابات المبتكرين' }).last().click();
  const settled = main(page).locator('.mlog-table tbody tr', { hasText: 'Antikiano' }).filter({ hasText: 'عربون' }).first();
  await expect(settled).toContainText('اتصفّت مع طلب السحب #');
});

test('0078: «تسوية دلوقتي» needs accounts.approve = F', async ({ page }) => {
  mock.acc.dokan_balances.push({ vendor_id: V2, woo_vendor_id: 44, balance: 900, earning: 900, sales: 1200, orders: 2, synced_at: '2026-11-11T10:00:00Z' });
  await openAccounts(page, ACCOUNTS);
  await tab(page, 'حسابات المبتكرين').click();
  const anti = main(page).locator('table.vendors-table tbody tr', { hasText: 'Antikiano' });
  await anti.getByRole('button', { name: /إجراءات/ }).click();
  await expect(page.locator('[role=menu]')).toContainText('تقرير المبتكر');
  await expect(page.locator('[role=menu]')).not.toContainText('تسوية دلوقتي');
});


// 0143 (the owner 19 Nov — «اي سحب او ايداع … يجبلي الحساب … و دايما يبقي فيه مستفيد و كله يبقي مربوط ببعضه»)
test('0143: an expense names its account and makes one linked account move; a maker withdraw from «الحساب الفعلي» lands on his balance; a transfer makes its other side', async ({ page }) => {
  await openAccounts(page);
  // an expense without its account is refused; with it, the account move follows (beneficiary = the payee), after the overdraft warning
  await add(page, 'إضافة مصروفات', 'سحب');
  await modal(page).locator('#f-amount').fill('300');
  await pick(page, 'f-cat', 'المصروفات');
  await pick(page, 'f-ben', 'آخر');
  await modal(page).locator('#f-other').fill('مكتبة سمير');
  await modal(page).locator('#f-details').fill('ورق');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page)).toContainText('اختار الحساب');
  expect(mock.accWrites).toEqual([]);
  await pick(page, 'f-macc', 'أوبريشن');
  await modal(page).getByRole('button', { name: 'حفظ' }).click();
  await expect(modal(page).locator('[data-acc-overdraft]')).toContainText('رصيد «أوبريشن» هيبقى -300.00 ج.م');
  expect(mock.accWrites).toEqual([]);
  await modal(page).getByRole('button', { name: 'احفظ برضه' }).click();
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.acc.acc_account_moves.map((m) => [m.account, m.direction, m.amount, m.beneficiary, !!m.expense_id])).toEqual([['أوبريشن', 'withdraw', 300, 'مكتبة سمير', true]]);
  await tab(page, 'الحساب الفعلي').click();
  const linked = main(page).locator('tr', { hasText: 'مكتبة سمير' });
  await expect(linked).toBeVisible();
  // «حذف» from the account tab voids the expense itself (and its move with it)
  await linked.getByRole('button', { name: 'إجراءات الصف' }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'حذف' }).first().click();
  await expect.poll(() => mock.acc.acc_expenses[0].voided_at).toBeTruthy();
  await expect.poll(() => mock.acc.acc_account_moves.filter((m) => !m.voided_at).length).toBe(0);
  // a withdraw for a maker from the account tab = a maker move with that account
  await add(page, 'إضافة مبلغ', 'سحب');
  await pick(page, 'f-account', 'حساب البنك');
  await pick(page, 'f-benkind', 'مبتكر');
  await pick(page, 'f-benname', 'Art Craft');
  await pick(page, 'f-type', 'عربون');
  await modal(page).locator('#f-amount').fill('500');
  await saveForm(page);
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.acc.acc_vendor_moves.map((m) => [m.kind, m.amount, m.account])).toEqual([['عربون', 500, 'حساب البنك']]);
  await expect.poll(() => mock.acc.acc_account_moves.filter((m) => !m.voided_at && m.vendor_move_id).map((m) => [m.account, m.amount, m.beneficiary])).toEqual([['حساب البنك', 500, 'Art Craft']]);
  // a transfer bank → أوبريشن: the deposit on the other side, both shown
  await add(page, 'إضافة مبلغ', 'سحب');
  await pick(page, 'f-account', 'حساب البنك');
  await pick(page, 'f-benkind', 'حساب تاني');
  await pick(page, 'f-toacc', 'أوبريشن');
  await modal(page).locator('#f-amount').fill('2000');
  await saveForm(page);
  await expect(modal(page)).toBeHidden();
  await expect.poll(() => mock.acc.acc_account_moves.filter((m) => !m.voided_at && m.beneficiary_kind === 'account').map((m) => [m.account, m.direction, m.amount]).sort()).toEqual([['أوبريشن', 'deposit', 2000], ['حساب البنك', 'withdraw', 2000]]);
  await expect(main(page).locator('tr', { hasText: 'تحويل إلى أوبريشن' })).toBeVisible();
  await expect(main(page).locator('tr', { hasText: 'تحويل من حساب البنك' })).toBeVisible();
});
