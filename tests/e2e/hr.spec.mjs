import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday, hrAt } from './hr-mock.mjs';

// «الموارد البشرية» on real data (phase 10 T5, docs/superpowers/plans/2026-11-05-phase-10-hr.md): the v5 page (block 15) on IBHR (0046) —
// the team and today from the server's rows (Cairo days), the attendance log with the fix of a missing end, the requests and the
// overtime decided through the RPCs (a refusal opens the one-to-one meeting with its date), the monthly sheet through its steps to
// «مدفوع» (the «المرتبات» expenses + one withdrawal from the account picked), «إضافة عضو» with the temporary password shown once,
// the KPIs rated by hand, the settings row; ops (hr.view P) sees herself only and no money. Mock only; the dates follow today.
const ADMIN = 'admin.dev@ibtekr.local'; const OPS = 'ops.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002'; const M03 = '00000000-0000-4000-8000-000000000003';
const ACC_ID = '00000000-0000-4000-8000-000000000004'; const VF_ID = '00000000-0000-4000-8000-000000000005';
const T = hrToday(); const MK = T.slice(0, 7) + '-01';
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
const workday = (from, step) => { let d = addDays(from, step); while (dow(d) === 5 || dow(d) === 6) d = addDays(d, step); return d; };
const W1 = workday(T, -1); const NEXT = workday(addDays(T, 6), 1);
const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monLabel = (iso) => AR[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const cairoMin = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return Number(p.hour) * 60 + Number(p.minute); };
const SEED = {
  hrMembers: [{ member_id: OPS_ID, hire_date: '2024-05-12' }, { member_id: M03 }, { member_id: ACC_ID }, { member_id: VF_ID, shift_start: '10:00', shift_end: '18:00' }],
  hrPay: [{ member_id: OPS_ID, salary: 12000, holdback: 1500, allowances: 500 }, { member_id: ACC_ID, salary: 9600, holdback: 1000, allowances: 0 }],
  hrAttendance: [{ member_id: ACC_ID, day: W1, in_at: hrAt(W1, '09:00'), out_at: null, source: 'clock' }],
  hrOvertime: [{ member_id: VF_ID, day: W1, start_at: hrAt(W1, '18:00'), end_at: hrAt(W1, '19:30'), minutes: 90, note: 'شحن الأوردرات المتأخرة', created_at: new Date(Date.now() - 2 * 3600000).toISOString() }],
  hrRequests: [{ member_id: ACC_ID, type: 'إجازة سنوية', from_day: NEXT, to_day: NEXT, note: 'ظرف عائلي' }],
  hrKpis: [{ member_id: ACC_ID, name: 'تقفيل اليومية في ميعادها', weight: 60, target: 100 }, { member_id: ACC_ID, name: 'أخطاء القيود', weight: 40, target: 2, inverse: true }],
  hrPayroll: [{ month: MK, status: 'مسودة' }],
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase (its seed and the writes it recorded)');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
});
test.afterEach(() => {
  if (LIVE) return;
  expect(pageErrors).toEqual([]);
  expect(mock.unhandled).toEqual([]);
});
async function openHr(page, email = ADMIN, hash = 'hr') {
  await page.goto('/');
  await page.fill('#lg-id', email); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
  await expect(page.locator('#pg-hr')).toBeVisible();
}
const P = (page) => page.locator('#pg-hr');
const modal = (page, text) => page.locator('.modal[role=dialog]', { hasText: text });
async function pick(page, scope, id, label) { await scope.locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }
async function date(scope, id, iso) { await scope.locator('#' + id).fill(dmy(iso)); await scope.locator('#' + id).press('Tab'); }
const calls = (fn) => mock.hr.calls.filter((c) => c.fn === fn);

test('«الموارد البشرية» is open: the team from the server (the admin without pay left out), today\'s state, the requests count on the tab', async ({ page }) => {
  await openHr(page);
  const table = P(page).locator('.hr-table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  for (const n of ['سارة أحمد', 'محمد علي', 'منى حسن', 'هدى سمير']) await expect(table).toContainText(n);
  await expect(table).not.toContainText('صفوت كمال');
  const offToday = dow(T) === 5 || dow(T) === 6; const after17 = cairoMin() > 17 * 60; // no day of hers today: absent once her shift is over
  await expect(table.locator('tbody tr', { hasText: 'منى حسن' })).toContainText(offToday ? 'راحة أسبوعية' : after17 ? 'غائب' : 'انصراف ناقص أمس');
  await expect(table.locator('tbody tr', { hasText: 'هدى سمير' })).toContainText('10:00–18:00');
  await expect(page.getByRole('tab', { name: /الطلبات \(2\)/ })).toBeVisible(); // the leave + the overtime
  await expect(P(page).locator('.cards')).toContainText('طلبات مستنية');
});

test('the attendance log: the month day by day, a missing end fixed by hand (hr_attendance_set) and the day closed', async ({ page }) => {
  await openHr(page);
  await P(page).getByRole('tab', { name: 'سجل الحضور' }).click();
  await pick(page, P(page), 'log-m', 'العضو: منى حسن');
  if (W1.slice(0, 7) !== T.slice(0, 7)) await pick(page, P(page), 'log-mo', 'الشهر: ' + monLabel(W1));
  const row = P(page).locator('tbody tr', { hasText: 'انصراف ناقص' }).first();
  await expect(row).toContainText('09:00');
  await row.getByRole('button', { name: 'تصحيح' }).click();
  const f = modal(page, 'تصحيح انصراف ناقص');
  await f.locator('#out').fill('17:30'); await f.locator('#reason').fill('نسيت أسجل');
  await expect(f.locator('#out')).toHaveValue('17:30'); await expect(f.locator('#reason')).toHaveValue('نسيت أسجل');
  await f.getByRole('button', { name: 'حفظ التصحيح' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_attendance_set').map((c) => [c.p_member, c.p_day, c.p_in, c.p_out, c.p_note])).toEqual([[ACC_ID, W1, '09:00', '17:30', 'نسيت أسجل']]);
  await expect(P(page).locator('tbody tr', { hasText: 'تصحيح' }).first()).toContainText('17:30');
});

test('the kit (decision 18 b): a form\'s first-field focus a tick later leaves a field already focused inside it — the text stays where it is typed', async ({ page }) => {
  await openHr(page);
  const focused = await page.evaluate(async () => {
    const K = window.IBKit; let a = '';
    K.form({ title: 'تجربة التركيز', values: {}, fields: (f, e, set) => [K.field.text('first', 'الأولى', f, e, set), K.field.text('second', 'التانية', f, e, set)], submit: () => true });
    document.getElementById('second').focus(); // focused before the tick (a busy page made it late)
    await new Promise((r) => setTimeout(r, 30)); a = document.activeElement && document.activeElement.id; return a;
  });
  expect(focused).toBe('second');
  await modal(page, 'تجربة التركيز').getByRole('button', { name: 'إلغاء' }).click();
  const first = await page.evaluate(async () => { // nothing focused inside: the first field, as before
    const K = window.IBKit; K.form({ title: 'تجربة التركيز 2', values: {}, fields: (f, e, set) => [K.field.text('first2', 'الأولى', f, e, set), K.field.text('second2', 'التانية', f, e, set)], submit: () => true });
    await new Promise((r) => setTimeout(r, 30)); return document.activeElement && document.activeElement.id;
  });
  expect(first).toBe('first2');
});

test('requests: approve the leave, «ضيفه» part of the overtime; «متضيفهوش» opens the one-to-one meeting with its date', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-requests');
  const list = P(page).locator('table').first();
  const leave = list.locator('tbody tr', { hasText: 'إجازة سنوية' });
  await leave.getByRole('button', { name: 'موافقة' }).click();
  await expect.poll(() => calls('hr_request_decide').map((c) => c.p_decision)).toEqual(['موافق']);
  await expect(list.locator('tbody tr', { hasText: 'إجازة سنوية' })).toContainText('موافق');
  // the overtime: «ضيفه» 45 of the 90 minutes
  await list.locator('tbody tr', { hasText: 'تأكيد وقت إضافي' }).getByRole('button', { name: 'ضيفه', exact: true }).click();
  const f = modal(page, 'ضيف الوقت الإضافي');
  await f.getByRole('radio', { name: 'جزء منه' }).click();
  await f.locator('#minutes').fill('45');
  await f.getByRole('button', { name: 'ضيفه', exact: true }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_overtime_decide').map((c) => [c.p_decision, c.p_minutes])).toEqual([['add', 45]]);
  expect(mock.hr.overtime[0]).toMatchObject({ status: 'اتضاف', paid_minutes: 45, pay_month: W1.slice(0, 7) + '-01' });
});

test('«متضيفهوش»: the refusal with its reason, the meeting the server opened gets its date (اتحدد ميعاد)', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-requests');
  await P(page).locator('tbody tr', { hasText: 'تأكيد وقت إضافي' }).getByRole('button', { name: 'متضيفهوش' }).click();
  const f = modal(page, 'متضيفهوش');
  await f.locator('#why').fill('مش متفق عليه قبلها');
  await date(f, 'date', NEXT);
  await f.getByRole('button', { name: 'متضيفهوش وحدد الميتنج' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_overtime_decide').map((c) => [c.p_decision, c.p_reason])).toEqual([['reject', 'مش متفق عليه قبلها']]);
  await expect.poll(() => mock.hr.meetings.map((x) => [x.ref, x.status, x.day, x.time_text])).toEqual([['OT-1', 'اتحدد ميعاد', NEXT, '10:00']]);
  await P(page).getByRole('tab', { name: 'المرتبات والمكافآت' }).click();
  await P(page).getByRole('tab', { name: 'الميتنجات وخطط التحسين' }).click();
  await expect(P(page).locator('table')).toContainText('هدى سمير');
  await expect(P(page).locator('table')).toContainText('اتحدد ميعاد');
});

test('the monthly sheet: the server\'s lines, مسودة → مراجعة → معتمد → مدفوع from «حساب البنك» = an «المرتبات» expense per member + one withdrawal', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-payroll');
  const sheet = P(page).locator('table').first();
  await expect(sheet.locator('tbody tr')).toHaveCount(2);
  await expect(sheet.locator('tbody tr', { hasText: 'سارة أحمد' })).toContainText('11,000'); // 12000 − 1500 + 500
  await expect(sheet.locator('tbody tr', { hasText: 'منى حسن' })).toContainText('8,600');
  await P(page).getByRole('button', { name: 'إرسال للمراجعة' }).click();
  await expect(P(page).getByRole('button', { name: 'اعتماد الكشف' })).toBeVisible();
  await P(page).getByRole('button', { name: 'اعتماد الكشف' }).click();
  await modal(page, 'اعتماد الكشف').getByRole('button', { name: 'اعتماد الكشف' }).click();
  await expect(P(page).getByRole('button', { name: 'تعليم مدفوع' })).toBeVisible();
  expect(mock.hr.payroll_lines.map((l) => [l.name, l.net])).toEqual([['سارة أحمد', 11000], ['منى حسن', 8600]]);
  await P(page).getByRole('button', { name: 'تعليم مدفوع' }).click();
  const f = modal(page, 'تعليم الكشف مدفوع');
  await pick(page, f, 'account', 'حساب البنك');
  await f.getByRole('button', { name: 'اتدفع', exact: true }).click();
  await expect(f).toBeHidden();
  await expect(P(page).getByRole('button', { name: 'اتدفع', exact: true })).toBeDisabled();
  expect(mock.acc.acc_expenses.map((e) => [e.category, e.beneficiary, e.amount])).toEqual([['المرتبات', 'سارة أحمد', 11000], ['المرتبات', 'منى حسن', 8600]]);
  expect(mock.acc.acc_account_moves.map((m) => [m.account, m.direction, m.amount])).toEqual([['حساب البنك', 'withdraw', 19600]]);
  expect(calls('hr_payroll_step').map((c) => c.p_step)).toEqual(['مراجعة', 'معتمد']);
});

test('«إضافة عضو»: team-admin makes the login, the pay is written, the temporary password shows once (not in any log)', async ({ page }) => {
  await openHr(page);
  await P(page).getByRole('button', { name: 'إضافة عضو' }).click();
  const f = modal(page, 'إضافة عضو');
  await f.locator('#name').fill('كريم سامي'); await f.locator('#title').fill('مصوّر منتجات');
  await f.locator('#email').fill('karim.dev@ibtekr.local'); await f.locator('#phone').fill('01012345678');
  await date(f, 'hire', T);
  await f.locator('#salary').fill('9000'); await f.locator('#holdback').fill('1000');
  await f.getByRole('button', { name: 'إضافة وعمل الحساب' }).dblclick(); // phase 13 decision 13: the second click of a double click is ignored (one request)
  const pw = modal(page, 'الباسورد المؤقت');
  await expect(pw).toContainText('بيظهر مرة واحدة بس');
  await expect(pw.locator('[data-temp-password]')).toHaveText('mock-temp-1');
  expect(calls('team-admin').map((c) => c.action)).toEqual(['member_create']);
  expect(mock.hr.writes.filter((w) => w.table === 'hr_pay').map((w) => [w.salary, w.holdback])).toEqual([[9000, 1000]]);
  expect(JSON.stringify(mock.activityRows)).not.toContain('mock-temp-1');
  await pw.getByRole('button', { name: 'تمام' }).click();
  await expect(P(page).locator('.hr-table')).toContainText('كريم سامي');
});

test('the KPIs by hand: «قيّم الشهر» with the actuals → hr_rate_month, the score on the quarter table', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-payroll');
  await P(page).getByRole('tab', { name: 'الأداء والـ KPI' }).click();
  await P(page).locator('tbody tr', { hasText: 'منى حسن' }).getByRole('button', { name: 'المؤشرات' }).click();
  await expect(P(page)).toContainText('تقفيل اليومية في ميعادها');
  await P(page).getByRole('button', { name: 'قيّم الشهر' }).click();
  const f = modal(page, 'تقييم الشهر');
  const ins = f.locator('input[inputmode=decimal]');
  await ins.nth(0).fill('90'); await ins.nth(1).fill('1');
  await expect(f.locator('.score-box')).toContainText('102.0%'); // 90% × 60 + min(200, 120)% × 40
  await f.getByRole('button', { name: 'حفظ التقييم' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_rate_month').map((c) => [c.p_member, c.p_month, c.p_actuals])).toEqual([[ACC_ID, MK, { 1: 90, 2: 1 }]]);
  await expect(P(page).locator('tbody tr', { hasText: 'منى حسن' }).first()).toContainText('102%');
});

test('the settings row «hr» (the admin): the late grace saved; a holiday added', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-settings');
  await pick(page, P(page), 'hs-grace', '30 دقيقة');
  await expect.poll(() => ((mock.settings.find((s) => s.section === 'hr') || {}).data || {}).lateGrace).toBe(30);
  await P(page).getByRole('button', { name: '+ عطلة' }).click();
  const f = modal(page, 'إضافة عطلة');
  await f.locator('#name').fill('عيد تجريبي'); await date(f, 'date', NEXT);
  await f.getByRole('button', { name: 'إضافة' }).click();
  await expect(f).toBeHidden();
  expect(mock.hr.holidays.map((x) => [x.name, x.day, x.status])).toEqual([['عيد تجريبي', NEXT, 'متوقع']]);
  await expect(P(page)).toContainText('عيد تجريبي');
});

test('ops (hr.view P, no team of her own): herself only, no money and no admin buttons; her own leave request', async ({ page }) => {
  await openHr(page, OPS);
  await expect(P(page).locator('.hr-table tbody tr')).toHaveCount(1);
  await expect(P(page).locator('.hr-table')).toContainText('سارة أحمد');
  await expect(P(page).getByRole('button', { name: 'إضافة عضو' })).toHaveCount(0);
  await expect(P(page).getByRole('button', { name: 'تسجيل حضور يدوي' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'المرتبات والمكافآت' }).click();
  await expect(P(page).getByRole('tab', { name: 'الكشف الشهري' })).toHaveCount(0);
  await page.getByRole('tab', { name: /الطلبات/ }).click();
  await P(page).getByRole('button', { name: 'طلب إجازة' }).click();
  const f = modal(page, 'طلب إجازة');
  await date(f, 'from', NEXT); await date(f, 'to', NEXT);
  await f.getByRole('button', { name: 'تقديم الطلب' }).click();
  await expect(f).toBeHidden();
  const made = calls('hr_request_create').map((c) => c.p_input);
  expect(made.length).toBe(1); expect(made[0]).toMatchObject({ type: 'إجازة سنوية', from: NEXT, to: NEXT }); expect(made[0].member).toBeUndefined();
  await expect(P(page).locator('tbody tr', { hasText: 'إجازة سنوية' })).toContainText('إلغاء الطلب');
});

test('every tab and sub-tab draws without a page error (the calendar, the quarter, the meetings, the settings, the staff reports)', async ({ page }) => {
  await openHr(page);
  const tab = (name) => page.getByRole('tab', { name });
  for (const sub of ['سجل الحضور', 'تقويم الفريق', 'الفريق']) { await P(page).getByRole('tab', { name: sub, exact: true }).click(); await expect(P(page).locator('.panel')).toBeVisible(); }
  await expect(P(page)).toContainText('هدى سمير');
  await P(page).getByRole('tab', { name: 'تقويم الفريق' }).click();
  await P(page).getByRole('button', { name: 'التالي ›' }).click(); await P(page).getByRole('button', { name: 'النهارده' }).click();
  await expect(P(page).locator('.tcal2 .tc-row')).toHaveCount(5); // the head + the 4 members
  await tab(/الطلبات/).click();
  for (const sub of ['محتاجة قرار', 'وقت إضافي للتأكيد', 'كل الطلبات']) await P(page).getByRole('tab', { name: new RegExp('^' + sub) }).click();
  await tab('المرتبات والمكافآت').click();
  for (const sub of ['الأداء والـ KPI', 'صرف الربع والمكافآت', 'الميتنجات وخطط التحسين', 'الكشف الشهري']) { await P(page).getByRole('tab', { name: sub }).click(); await expect(P(page).locator('.panel')).toBeVisible(); }
  await P(page).getByRole('tab', { name: 'صرف الربع والمكافآت' }).click();
  await expect(P(page)).toContainText('قواعد المكافآت الإضافية');
  await tab('التقارير').click(); await expect(P(page).locator('[data-staff="absence"], [data-staff="rating"]').first()).toBeVisible(); // the reports page's «تقارير الموظفين» (T8)
  await tab('إعدادات الموارد البشرية').click(); await expect(P(page)).toContainText('العطلات الرسمية');
  await expect(P(page)).toContainText('مكافأة تفوق');
});
