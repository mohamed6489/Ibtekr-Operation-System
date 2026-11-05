import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday, hrAt } from './hr-mock.mjs';

// «تقارير الموظفين» on IBHR (phase 10 T8, decision 20): the reports page's staff tab (hr.view) and the HR page's own «التقارير» — the
// absences of the range from the attendance (a work day from the hire date with no attendance and no approved leave), the first reply
// from the customer service conversations, the KPI scores; «المهام» say «قريبًا»; and the bell's payroll reminder from the real sheet,
// for sensitive.salaries only. Mock only; the dates follow today.
const ADMIN = 'admin.dev@ibtekr.local'; const ACC = 'accounts.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002'; const M03 = '00000000-0000-4000-8000-000000000003';
const ACC_ID = '00000000-0000-4000-8000-000000000004'; const VF_ID = '00000000-0000-4000-8000-000000000005';
const T = hrToday(); const MK = T.slice(0, 7) + '-01';
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const prevMonth = (mk) => { const d = new Date(mk + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
const work = (iso) => { const w = new Date(iso + 'T00:00:00Z').getUTCDay(); return w !== 5 && w !== 6; };
// محمد علي joined five days ago and only came today: every work day between is an absence
const HIRE3 = addDays(T, -5); let ABSENT = 0; for (let d = HIRE3; d < T; d = addDays(d, 1)) if (work(d)) ABSENT += 1;
const SEED = {
  hrMembers: [{ member_id: OPS_ID, hire_date: T }, { member_id: M03, hire_date: HIRE3 }, { member_id: ACC_ID, hire_date: T }, { member_id: VF_ID, hire_date: T }],
  hrPay: [{ member_id: OPS_ID, salary: 12000, holdback: 1500, allowances: 500 }, { member_id: M03, salary: 9000, holdback: 900, allowances: 0 }],
  hrAttendance: [OPS_ID, M03, ACC_ID, VF_ID].map((id) => ({ member_id: id, day: T, in_at: hrAt(T, '09:00'), out_at: hrAt(T, '17:00'), source: 'clock' })),
  hrScores: [{ member_id: OPS_ID, month: MK, score: 104 }, { member_id: ACC_ID, month: prevMonth(MK), score: 92 }],
  hrPayroll: [{ month: MK, status: 'مراجعة' }],
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the calls it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
  // سارة أحمد answered a customer 12 minutes after the message (the conversations of the range)
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  mock.cs.conversations.push({ id: 'd1000000-0000-4000-8000-000000000099', seg: 'customers', platform: 'messenger', channel: 'messenger', customer_id: null, vendor_id: null, handle: 'عميل تجربة', external_id: '901', status: 'مستنية العميل', assignee: OPS_ID, outcome: null, tags: [], last_in_at: at(100), last_out_at: at(88), waiting_since: null, unread: 0, snoozed_until: null, closed_at: null, closed_by: null, created_at: at(100), updated_at: at(88) });
  mock.cs.messages.push({ id: 'd1000000-0000-4000-8000-000000000098', conversation_id: 'd1000000-0000-4000-8000-000000000099', kind: 'in', text: 'متاح؟', author: null, external_id: 'm.90', delivery: null, meta: {}, created_at: at(100) },
    { id: 'd1000000-0000-4000-8000-000000000097', conversation_id: 'd1000000-0000-4000-8000-000000000099', kind: 'out', text: 'أيوه متاح', author: OPS_ID, external_id: 'm.91', delivery: 'read', meta: {}, created_at: at(88) });
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function open(page, email, hash) {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const kpi = (page, label) => page.locator('#rpanel .kpi[aria-label="' + label + '"]');
const top = (scope, key) => scope.locator('[data-staff="' + key + '"]');

test('«تقارير الموظفين» is open on real data: the absences of the range, the first reply, the KPI scores; «المهام» say «قريبًا»', async ({ page }) => {
  await open(page, ADMIN, 'reports-staff');
  await expect(page.locator('#reports #tab-staff')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#reports [role=tab] [data-soon]')).toHaveCount(1); // only «الحملات الإعلانية»
  await expect(kpi(page, 'أيام غياب')).toContainText(String(ABSENT));
  await expect(top(page.locator('#rpanel'), 'absence').locator('.st-row').first()).toContainText('محمد علي');
  await expect(top(page.locator('#rpanel'), 'absence').locator('.st-row').first()).toContainText(String(ABSENT));
  await expect(kpi(page, 'أسرع رد')).toContainText('12');
  await expect(top(page.locator('#rpanel'), 'fastest')).toContainText('سارة أحمد');
  const rating = top(page.locator('#rpanel'), 'rating').locator('.st-row');
  await expect(rating).toHaveCount(2);
  await expect(rating.nth(0)).toContainText('سارة أحمد'); await expect(rating.nth(0)).toContainText('104%');
  await expect(rating.nth(1)).toContainText('منى حسن'); await expect(rating.nth(1)).toContainText('92%');
  await expect(kpi(page, 'مهام مفتوحة')).toContainText('قريبًا');
  await expect(page.locator('#rpanel')).toContainText('قريبًا — مع مهام الفريق');
});

test('the HR page\'s own «التقارير» shows the same staff report with the reports range', async ({ page }) => {
  await open(page, ADMIN, 'hr-reports');
  const P = page.locator('#pg-hr');
  await expect(top(P, 'absence')).toContainText('محمد علي');
  await expect(top(P, 'rating')).toContainText('سارة أحمد');
  await expect(P.locator('.date-field')).toHaveCount(1);
});

test('a member without hr.view does not get the staff tab', async ({ page }) => {
  mock.profiles.find((p) => p.email === ACC).custom_perms = { 'hr.view': 'N' }; // a custom permission (accounts has hr.view P)
  await open(page, ACC, 'reports');
  await expect(page.locator('#reports #tab-orders')).toBeVisible();
  await expect(page.locator('#reports #tab-staff')).toHaveCount(0);
});

test('the bell\'s payroll reminder reads the real sheet (status and lines) for sensitive.salaries only', async ({ page }) => {
  await open(page, ADMIN, 'dashboard');
  await page.evaluate(() => { window.IBKit.store.accAlerts = Object.assign({}, window.IBKit.store.accAlerts, { payDay: 1, lead: 40 }); });
  await page.getByRole('button', { name: /الإشعارات/ }).first().click();
  const bell = page.getByRole('dialog', { name: 'الإشعارات' });
  await bell.locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: /^الحسابات$/ }) }).click();
  const item = bell.locator('.ntf-item', { hasText: 'مرتبات الموظفين' });
  await expect(item).toContainText('الكشف «مراجعة»');
  await item.click();
  const m = page.locator('.modal[role=dialog]', { hasText: 'مرتبات الموظفين — يوم الصرف' });
  await expect(m).toContainText('سارة أحمد'); await expect(m).toContainText('مراجعة');
  expect(mock.hr.calls.some((c) => c.fn === 'hr_payroll_calc')).toBe(true);
});

test('accounts (no sensitive.salaries) gets no payroll reminder and never asks for the sheet', async ({ page }) => {
  await open(page, ACC, 'dashboard');
  await page.evaluate(() => { window.IBKit.store.accAlerts = Object.assign({}, window.IBKit.store.accAlerts, { payDay: 1, lead: 40 }); });
  await page.getByRole('button', { name: /الإشعارات/ }).first().click();
  const bell = page.getByRole('dialog', { name: 'الإشعارات' });
  const sec = bell.locator('.ntf-nav-item', { has: page.locator('.lbl', { hasText: /^الحسابات$/ }) });
  if (await sec.count()) await sec.click();
  await expect(bell.locator('.ntf-item', { hasText: 'مرتبات الموظفين' })).toHaveCount(0);
  expect(mock.hr.calls.some((c) => c.fn === 'hr_payroll_calc')).toBe(false);
});
