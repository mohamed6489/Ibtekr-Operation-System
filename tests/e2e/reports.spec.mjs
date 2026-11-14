import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';

// The reports page on real data (phase 9, docs/superpowers/plans/2026-11-05-phase-9-reports.md): the v2's nine tabs in block 28 —
// a tab shows with reports.view ≠ N and its page's view permission (decision 4), «الحملات الإعلانية» opened with the ads numbers (phase 9.5.3
// decision 47: marketing.view — marketing-ads.spec; «الموظفين» opened with HR — phase 10 T8, hr-reports.spec), the makers' tab reads our orders + the accounts + Dokan's balances (decision 3: money for
// accounts.view ≠ N, the commission for sensitive.commission = F), CSV / «الإجراءات» need reports.export = F, the customization is
// saved per member in user_prefs (decision 8) and «آخر تحديث» is the last orders load (decision 9). Mock only.
const ADMIN = 'admin.dev@ibtekr.local'; const VF = 'vf.dev@ibtekr.local';
const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const V1 = 'a0000000-0000-4000-8000-000000000001'; const V2 = 'a0000000-0000-4000-8000-000000000002';
const L1 = 'b7000000-0000-4000-8000-000000000001'; const L2 = 'b7000000-0000-4000-8000-000000000002';
const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
const SEED = {
  // Dokan's balances (0019): Art Craft 2,500 — Antikiano 300
  dokanBalances: [{ vendor_id: V1, woo_vendor_id: 2376, balance: 2500, earning: 9000, sales: 11000, orders: 12, synced_at: at(1) }, { vendor_id: V2, woo_vendor_id: 44, balance: 300, earning: 900, sales: 1500, orders: 2, synced_at: at(1) }],
  // the hub (0044): a lot for sale (3 in, 1 out → 2 pieces at 260) and one waiting for its photos (1 at 300); the moves are of today
  invLots: [{ id: L1, reason: 'متاح للبيع', status: 'متاح', sku: 'IBT-AR-0999', name: 'سلة كروشيه', vendor_id: V1, loc: 'A', cost: 260, mode: 'أمانة' },
    { id: L2, reason: 'تصوير', status: 'مستني تصوير', sku: 'IBT-AR-1000', name: 'فازة سيراميك', vendor_id: V1, loc: 'P', cost: 300 }],
  invMoves: [{ lot_id: L1, type: 'in', qty: 3, label: 'دخول — للبيع', reason: 'متاح للبيع', at: at(3) }, { lot_id: L1, type: 'out', qty: 1, label: 'خروج', reason: 'متاح للبيع', at: at(2) },
    { lot_id: L2, type: 'in', qty: 1, label: 'دخول — تصوير', reason: 'تصوير', at: at(1) }],
  // team tickets (0045): an urgent open one for «الحسابات», one in progress for the logistics, one resolved
  tickets: [
    { id: 1, type: 'customer', title: 'العميلة مستنية الأوردر', description: 'اتصلت مرتين', priority: 'urgent', assignee_role: 'الحسابات', created_by: ADMIN_ID, created_at: at(5), last_update: at(5) },
    { id: 2, type: 'internal', title: 'الكرتون خلص', description: 'محتاجين كرتون شحن', priority: 'normal', assignee_role: 'اللوجستيك والشحن', status: 'in_progress', created_at: at(4), last_update: at(3) },
    { id: 3, type: 'vendor', title: 'المبتكر مابيردش', description: 'بقاله 3 أيام', priority: 'low', assignee_role: 'متابعة المبتكرين', vendor_id: V1, vendor: 'Art Craft', status: 'resolved',
      resolution_outcome: 'اتحلت المشكلة', resolution_note: 'رد', resolved_by_name: 'صفوت كمال', resolved_at: at(1), created_at: at(6), last_update: at(1) }],
};
let mock = null; let pageErrors = []; let rpcCalls = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  rpcCalls = []; page.on('request', (r) => { const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.url()); if (m) rpcCalls.push(m[1]); });
  mock = await installSupabaseMock(page, SEED);
  // a completed order in the range: Art Craft's line 1,002 at his rate 35% → 350.70 for Ibtekr
  Object.assign(mock.orders.find((o) => o.id === 180686), { status: 'مكتمل', woo_status: 'completed' });
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
async function openReports(page, email = ADMIN) {
  await signIn(page, email);
  await page.locator('.sidebar .nav-item[data-page="reports"]').click();
  await expect(page.locator('#reports')).toBeVisible();
}
const R = (page) => page.locator('#reports');
const tab = (page, id) => page.locator('#reports #tab-' + id);
const kpi = (page, label) => page.locator('#rpanel .kpi[aria-label="' + label + '"]');
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });

test('«التقارير» is open: the nine v2 tabs (none «قريبًا» — staff opened with HR, campaigns with the ads numbers), the orders tab on our orders, the real «آخر تحديث»', async ({ page }) => {
  await openReports(page);
  await expect(page.locator('.sidebar .nav-item[data-page="reports"]')).not.toHaveAttribute('data-soon', '');
  await expect(R(page).locator('[role=tab]')).toHaveText([/^تقارير الأوردرات$/, /^تقارير المبتكرين$/, /^تقارير الحسابات$/, /^تقارير المنتجات$/, /^تقارير الموظفين$/, /^الحملات الإعلانية$/, /^تقارير المخزن$/, /^تقارير خدمة العملاء$/, /^تقارير التذاكر$/]);
  await expect(R(page).locator('[role=tab] [data-soon]')).toHaveCount(0);
  await expect(tab(page, 'orders')).toHaveAttribute('aria-selected', 'true');
  await expect(kpi(page, 'إجمالي الأوردرات')).toContainText('3'); // the three seeded orders of the last 30 days (the 400-day-old one out)
  await expect(kpi(page, 'نسبة الإكمال')).toContainText('33%');
  const fresh = R(page).locator('.page-head');
  await expect(fresh).toContainText('آخر تحميل للأوردرات');
  await expect(fresh).not.toContainText('09:30');
  await expect(R(page).locator('#rpanel')).not.toContainText('Airtable');
  await expect(page).toHaveURL(/#reports-orders$/);
  // the admin: «الملفات», the customization; the owner 13 Nov — no «نسخ CSV» (it is under «الملفات») and no «مقارنة بالفترة السابقة» button:
  // the comparison is the calendar's «مقارنة بفترة سابقة», and it works — the KPIs carry their delta against the period before
  await expect(R(page).locator('[data-rp-csv]')).toHaveCount(0);
  await expect(R(page).locator('[data-actions]')).toHaveCount(1);
  await expect(R(page).locator('[data-actions]')).toHaveText('الملفات'); // the owner 12 Nov: «الملفات» instead of «الإجراءات»
  await expect(R(page).getByRole('button', { name: 'مقارنة بالفترة السابقة' })).toHaveCount(0);
  await expect(kpi(page, 'إجمالي الأوردرات').locator('.kpi-delta')).toHaveCount(0);
  await R(page).locator('.page-head .date-field').click();
  const cmp = page.locator('.dp [data-rp-compare="reports"] input[type=checkbox]');
  await expect(cmp).not.toBeChecked();
  await cmp.check();
  await page.locator('.dp').getByRole('button', { name: 'تحديث' }).click();
  await expect(kpi(page, 'إجمالي الأوردرات').locator('.kpi-delta')).toBeVisible();
  await R(page).locator('.page-head .date-field').click();
  await expect(page.locator('.dp [data-rp-compare="reports"] input[type=checkbox]')).toBeChecked(); // kept with the period
  await page.locator('.dp [data-rp-compare="reports"] input[type=checkbox]').uncheck();
  await page.locator('.dp').getByRole('button', { name: 'تحديث' }).click();
  await expect(kpi(page, 'إجمالي الأوردرات').locator('.kpi-delta')).toHaveCount(0);
  // «الحملات الإعلانية» (phase 9.5.3 decision 47): the marketing page's blocks with the range, CSV and the customization (marketing-ads.spec has the numbers)
  await tab(page, 'campaigns').click();
  await expect(R(page).locator('#rpanel [data-ads-kpis]')).toBeVisible();
  await expect(R(page).locator('.date-field')).toHaveCount(1);
  await expect(R(page).locator('[data-rp-custom]')).toHaveCount(1);
  await expect(page).toHaveURL(/#reports-campaigns$/);
});

test('«تقارير المبتكرين» on real data: orders and delays from our orders, the range\'s completed share, Dokan\'s balance, the average commission', async ({ page }) => {
  await openReports(page);
  await tab(page, 'vendors').click();
  await expect(kpi(page, 'مبتكرين نشطين')).toContainText('2'); // Art Craft (three orders) and Antikiano (two)
  await expect(kpi(page, 'متوسط عمولة إبتكر')).toContainText('40%'); // 35% and 45% (Bian eg has none)
  await expect(kpi(page, 'إجمالي مستحقات المبتكرين — الآن')).toBeVisible();
  const table = R(page).locator('table.vendors-table');
  await expect(table.locator('thead th')).toHaveText(['المبتكر', 'الأوردرات', 'قابلة للتأخير', 'العمولة', 'حصة إبتكر (مكتمل)', 'العرابين', 'المواصلات', 'الرصيد الحالي']);
  const art = table.locator('tbody tr', { hasText: 'Art Craft' });
  await expect(art).toContainText('35.0%');
  await expect(art).toContainText('350.70'); // 1,002 × 35% in «مكتمل» in the range
  await expect(art).toContainText('2,500.00'); // Dokan's balance (no deposit / transport)
  await expect(R(page).locator('#rpanel .source')).toContainText('رصيد Dokan');
  // a row of «التفاصيل» opens the maker's drawer where we are
  await kpi(page, 'مبتكرين نشطين').locator('.kpi-details').click();
  await modal(page, 'المبتكرين النشطين في الفترة').locator('tbody tr', { hasText: 'Art Craft' }).click();
  await expect(page.locator('.drawer')).toContainText('Art Craft');
  await expect(page).toHaveURL(/#reports-vendors$/);
});

test('each tab by its page\'s permission: no «الحسابات» without accounts.view, no money or commission on the makers\' tab, no CSV / «الإجراءات» without reports.export', async ({ page }) => {
  await openReports(page, VF); // vendors_followup: reports P / export N, accounts N, sensitive.commission N
  await expect(R(page).locator('[role=tab]')).toHaveCount(7);
  await expect(tab(page, 'accounts')).toHaveCount(0);
  await expect(tab(page, 'campaigns')).toHaveCount(0); // marketing.view N (phase 9.5.3 decision 47)
  await expect(R(page).locator('[data-rp-csv]')).toHaveCount(0);
  await expect(R(page).locator('[data-actions]')).toHaveCount(0);
  await tab(page, 'vendors').click();
  await expect(R(page).locator('table.vendors-table thead th')).toHaveText(['المبتكر', 'الأوردرات', 'قابلة للتأخير']);
  await expect(kpi(page, 'متوسط عمولة إبتكر')).toHaveCount(0);
  await expect(kpi(page, 'عرابين مدفوعة للمبتكرين')).toHaveCount(0);
  await expect(R(page).locator('#rpanel')).not.toContainText('2,500');
  expect(rpcCalls.filter((f) => f === 'accounts_sales')).toEqual([]); // the accounts are not even asked
  // a typed hash on a tab the member has not → the first one they have
  await page.evaluate(() => { location.hash = 'reports-accounts'; });
  await expect(tab(page, 'orders')).toHaveAttribute('aria-selected', 'true');
});

test('reports.view = N: no «التقارير» in the menu, and a link to it lands on the dashboard (owner batch 14 Nov decision 15)', async ({ page }) => {
  mock.profiles.find((x) => x.email === VF).custom_perms = { 'reports.view': 'N' };
  await signIn(page, VF);
  await expect(page.locator('.sidebar .nav-item[data-page="reports"]')).toBeHidden();
  await page.evaluate(() => { location.hash = 'reports-orders'; });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#dashboard');
  await expect(R(page).locator('[role=tab]')).toHaveCount(0);
});

test('the stock, customer-service and tickets tabs: the hub\'s pieces, the open conversations (a snapshot), the tickets of the range', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/#reports-inventory'); // a deep link
  await expect(tab(page, 'inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(kpi(page, 'قطع في المخزن الآن')).toContainText('3'); // 2 + 1
  await expect(kpi(page, 'قيمة المخزن')).toContainText('820'); // 2 × 260 + 1 × 300
  await expect(kpi(page, 'حركات المخزن في الفترة')).toContainText('3');
  await expect(R(page).locator('table.rp-inv tbody tr')).toHaveCount(2);
  await tab(page, 'cs').click();
  await expect(R(page).locator('[data-snapshot]')).toContainText('من غير فلتر تاريخ');
  await expect(R(page).locator('.date-field')).toHaveCount(0);
  await expect(kpi(page, 'محادثات عملاء مفتوحة')).toContainText('4'); // the makers' and the resolved ones left out
  await expect(kpi(page, 'مستنية ردنا')).toContainText('3');
  await expect(kpi(page, 'عدّت هدف الرد')).toContainText('3'); // 18 / 30 / 20 minutes against 15
  await tab(page, 'tickets').click();
  await expect(kpi(page, 'تذاكر مفتوحة')).toContainText('2');
  await expect(kpi(page, 'تذاكر عاجلة')).toContainText('1');
  await expect(kpi(page, 'تذاكر الفترة')).toContainText('3');
  await expect(R(page).locator('table.rp-tk tbody tr')).toHaveCount(2);
  await expect(R(page).locator('table.rp-tk')).toContainText('عاجل');
  // the v2's order: cards, charts, then the table — though the table's title is also a card's («تذاكر مفتوحة»)
  expect(await R(page).locator('#rpanel > *:not([hidden])').evaluateAll((l) => l.map((e) => (e.classList.contains('cards') ? 'cards' : e.classList.contains('charts') ? 'charts' : e.classList.contains('source') ? 'source' : 'table')))).toEqual(['cards', 'charts', 'table', 'source']);
});

test('«تقارير المنتجات» = the products page\'s own reports (products_report + the mirror), one source', async ({ page }) => {
  await openReports(page);
  await tab(page, 'products').click();
  await expect(kpi(page, 'قطع اتباعت')).toBeVisible();
  await expect(R(page).locator('#rpanel')).toContainText('المنتجات الأكثر مبيعًا — أعلى 20');
  await expect(R(page).locator('#rpanel')).toContainText('منتجات نفد مخزونها');
  // a card and a table sharing a title keep their places: the best sellers before the out-of-stock table
  expect(await R(page).locator('#rpanel .sec-h h2').allTextContents()).toEqual(['المنتجات الأكثر مبيعًا — أعلى 20', 'منتجات نفد مخزونها', 'الأقسام الأكثر مبيعًا']);
  expect(rpcCalls).toContain('products_report');
  await expect(R(page).locator('[data-kpi-custom="products"]')).toBeVisible();
});

test('«تخصيص التقارير» per member (user_prefs reports.prefs): a hidden report stays hidden after a reload; «رجوع للافتراضي»; the tickets cards (tickets.kpis)', async ({ page }) => {
  await openReports(page);
  await expect(kpi(page, 'متوسط قيمة الأوردر')).toBeVisible();
  await R(page).locator('[data-rp-custom]').click();
  const m = modal(page, 'تخصيص التقارير — تقارير الأوردرات');
  await m.locator('[data-rp-item="رقم · متوسط قيمة الأوردر"] [role=switch]').click();
  await m.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(kpi(page, 'متوسط قيمة الأوردر')).toBeHidden();
  await expect.poll(() => (mock.prefs.find((p) => p.user_id === ADMIN_ID && p.key === 'reports.prefs') || {}).data).toMatchObject({ orders: { hidden: ['رقم · متوسط قيمة الأوردر'] } });
  await page.reload(); await expect(page.locator('#root')).toBeVisible();
  await expect(tab(page, 'orders')).toHaveAttribute('aria-selected', 'true');
  await expect(kpi(page, 'إجمالي الأوردرات')).toBeVisible();
  await expect(kpi(page, 'متوسط قيمة الأوردر')).toBeHidden();
  await R(page).locator('[data-rp-custom]').click();
  await modal(page, 'تخصيص التقارير').locator('[data-rp-reset]').click();
  await expect(kpi(page, 'متوسط قيمة الأوردر')).toBeVisible();
  await expect.poll(() => (mock.prefs.find((p) => p.key === 'reports.prefs') || {}).data).toEqual({});
  // the tickets cards: pick «بانتظار الرد» on top of the eight → full; drop one first
  await tab(page, 'tickets').click();
  await expect(R(page).locator('#rpanel [data-tk-kpis="8"] .kpi')).toHaveCount(8);
  await R(page).locator('[data-kpi-custom="tickets"]').click();
  const pick = modal(page, 'تخصيص تقارير التذاكر');
  await expect(pick.locator('[data-kpi="waiting"]')).toBeDisabled(); // 8 of 8
  await pick.locator('[data-kpi="toprole"]').click();
  await pick.locator('[data-kpi="waiting"]').click();
  await pick.locator('[data-kpi-save]').click();
  await expect(kpi(page, 'بانتظار الرد')).toBeVisible();
  await expect(kpi(page, 'أكتر دور عليه تذاكر')).toHaveCount(0);
  await expect.poll(() => (mock.prefs.find((p) => p.key === 'tickets.kpis') || {}).data).toEqual(['open', 'urgent', 'overdue', 'avg', 'total', 'resolved', 'reopened', 'waiting']);
});

