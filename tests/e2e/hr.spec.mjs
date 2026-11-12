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
async function openHr(page, email = ADMIN, hash = 'hr-team') { // the owner 12 Nov: «#hr» opens «نظرة عامة»; most cases start on the team
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

test('«الموارد البشرية» is open: the team from the server (the table lists everyone the admin sees — the salary-less admin too; the tiles count the staff), today\'s state, no requests tab', async ({ page }) => {
  await openHr(page);
  const table = P(page).locator('.hr-table');
  await expect(table.locator('tbody tr')).toHaveCount(6); // decision 15: everyone the admin sees — the salary-less admin and the suspended viewer too; the tiles stay on the staff (4)
  for (const n of ['سارة أحمد', 'محمد علي', 'منى حسن', 'هدى سمير', 'صفوت كمال', 'مشاهد تجريبي']) await expect(table).toContainText(n);
  await expect(table.locator('tbody tr', { hasText: 'مشاهد تجريبي' })).toContainText('موقوف');
  const offToday = dow(T) === 5 || dow(T) === 6; const after17 = cairoMin() > 17 * 60; // no day of hers today: absent once her shift is over
  await expect(table.locator('tbody tr', { hasText: 'منى حسن' })).toContainText(offToday ? 'راحة أسبوعية' : after17 ? 'غائب' : 'انصراف ناقص أمس');
  await expect(table.locator('tbody tr', { hasText: 'هدى سمير' })).toContainText('10:00–18:00');
  // the owner 12 Nov (every table): the picture at the right with the name next to it, aligned to the start; a long name cut with «…»
  await expect(table.locator('thead th.c-person')).toHaveCount(1);
  expect(await table.locator('tbody tr td:has(> .mlink)').first().evaluate((td) => getComputedStyle(td).textAlign)).toBe('start');
  const cut = await table.locator('tbody tr .mlink b').first().evaluate((b) => { b.textContent = 'عبد القادر علي عبد القادر محمد الشرقاوي الكبير المصري'; return [getComputedStyle(b).textOverflow, b.scrollWidth > b.clientWidth]; });
  expect(cut).toEqual(['ellipsis', true]);
  await expect(table.locator('tbody tr .mlink b').nth(1)).toHaveAttribute('title', /\S/);
  await expect(P(page).locator('[role=tab]', { hasText: 'الطلبات' })).toHaveCount(0); // the rebuild: the requests live in «طلبات الفريق»
  // the owner 12 Nov: the day's cards moved to «نظرة عامة» (the team tab keeps its table)
  await expect(P(page).locator('[data-hr-today]')).toHaveCount(0);
  await P(page).getByRole('tab', { name: 'نظرة عامة' }).click();
  await expect(P(page).locator('[data-hr-today]')).toContainText('من 4');
  await expect(P(page).locator('[data-hr-today]')).toContainText('طلبات مستنية');
});

test('the owner 12 Nov — «نظرة عامة» first: the day\'s cards, the month (hours, overtime, requests, leave days), who is in, what waits for a decision, the leaves coming; «سجل الحركات» lists the HR rows of the activity log with who did them (hr.view F; ops never has the tab)', async ({ page }) => {
  await openHr(page, ADMIN, 'hr');
  await expect(page).toHaveURL(/#hr$|#hr-overview$/);
  await expect(P(page).locator('[role=tab][aria-selected=true]')).toContainText('نظرة عامة');
  const names = await P(page).locator('[role=tab]').allInnerTexts();
  expect(names.map((x) => x.trim()).slice(0, 6)).toEqual(['نظرة عامة', 'الفريق والحضور', 'المرتبات', 'التقييمات', 'التقارير', 'سجل الحركات']); // the rebuild (12 Nov)
  await expect(P(page).locator('[data-hr-today]')).toContainText('حاضرين دلوقتي');
  await expect(P(page).locator('[data-hr-month]')).toContainText('ساعات الشهر');
  await expect(P(page).locator('[data-hr-month]')).toContainText('أيام إجازة الشهر');
  await expect(P(page)).toContainText('مين في الدوام دلوقتي');
  const wait = P(page).locator('.card', { hasText: 'مستني قرار' });
  await expect(wait).toContainText('إجازة سنوية'); await expect(wait).toContainText('وقت إضافي');
  await expect(P(page)).toContainText('الإجازات الجاية');
  // a decision from the overview: the leave opens its details
  await wait.locator('tbody tr', { hasText: 'إجازة سنوية' }).click();
  await expect(modal(page, 'إجازة سنوية')).toBeVisible();
  await page.keyboard.press('Escape');
  // «سجل الحركات»: the HR rows (a manual attendance and a request) with the label, the kind and who did them; not the others
  mock.activityRows.push({ id: 9001, at: new Date(Date.now() - 3600e3).toISOString(), actor: ACC_ID, action: 'hr.request.create', entity: 'hr', entity_id: 'HR-0001', old_value: null, new_value: 'HR-0001' },
    { id: 9002, at: new Date().toISOString(), actor: '00000000-0000-4000-8000-000000000001', action: 'hr.attendance.manual', entity: 'hr', entity_id: OPS_ID, old_value: null, new_value: 'M02 ' + T },
    { id: 9003, at: new Date().toISOString(), actor: '00000000-0000-4000-8000-000000000001', action: 'vendor.create', entity: 'vendor', entity_id: 'x', old_value: null, new_value: 'مبتكر' });
  await P(page).getByRole('tab', { name: 'سجل الحركات' }).click();
  await expect(page).toHaveURL(/#hr-log$/);
  const log = P(page).locator('table.hr-log');
  await expect(log.locator('tbody tr')).toHaveCount(2);
  await expect(log.locator('tbody tr').first()).toContainText('تسجيل حضور يدوي');
  await expect(log.locator('tbody tr').first()).toContainText('الحضور');
  await expect(log.locator('tbody tr').first()).toContainText('سارة أحمد'); // «على» = the member
  await expect(log.locator('tbody tr').nth(1)).toContainText('قدّم طلب');
  await expect(log.locator('tbody tr').nth(1)).toContainText('منى حسن'); // «بواسطة»
  await expect(log).not.toContainText('مبتكر');
});

test('the owner 12 Nov — ops (hr.view P) has no «سجل الحركات» tab and «#hr-log» falls back to «نظرة عامة»', async ({ page }) => {
  await openHr(page, OPS, 'hr-log');
  await expect(P(page).locator('[role=tab]', { hasText: 'سجل الحركات' })).toHaveCount(0);
  await expect(P(page).locator('[role=tab][aria-selected=true]')).toContainText('نظرة عامة');
});

test('the attendance log: the month day by day, a missing end fixed by hand on that session (hr_attendance_close — decision 24) and the day closed', async ({ page }) => {
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
  const open = mock.hr.attendance.find((a) => a.member_id === ACC_ID && a.day === W1);
  expect(calls('hr_attendance_close').map((c) => [c.p_id, c.p_out, c.p_note])).toEqual([[open.id, '17:30', 'نسيت أسجل']]);
  expect(calls('hr_attendance_set')).toEqual([]); // the day's other sessions stay
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

test('the rebuild: the requests are decided from «نظرة عامة › مستني قرار» — approve the leave in its popup, «ضيفه» part of the overtime from its own popup; «#hr-requests» lands on «نظرة عامة»', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-requests');
  await expect(P(page).locator('[role=tab][aria-selected=true]')).toContainText('نظرة عامة');
  const wait = P(page).locator('.card', { hasText: 'مستني قرار' });
  await wait.locator('tbody tr', { hasText: 'إجازة سنوية' }).click();
  await modal(page, 'تفاصيل طلب').getByRole('button', { name: 'موافقة' }).click();
  await expect.poll(() => calls('hr_request_decide').map((c) => c.p_decision)).toEqual(['موافق']);
  await expect(wait.locator('tbody tr', { hasText: 'إجازة سنوية' })).toHaveCount(0);
  // the overtime: its popup → «ضيفه» 45 of the 90 minutes
  await wait.locator('tbody tr', { hasText: 'وقت إضافي' }).click();
  const d = modal(page, 'وقت إضافي — هدى سمير');
  await expect(d).toContainText('شحن الأوردرات المتأخرة');
  await d.getByRole('button', { name: 'ضيفه', exact: true }).click();
  const f = modal(page, 'ضيف الوقت الإضافي');
  await f.getByRole('radio', { name: 'جزء منه' }).click();
  await f.locator('#minutes').fill('45');
  await f.getByRole('button', { name: 'ضيفه', exact: true }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_overtime_decide').map((c) => [c.p_decision, c.p_minutes])).toEqual([['add', 45]]);
  expect(mock.hr.overtime[0]).toMatchObject({ status: 'اتضاف', paid_minutes: 45, pay_month: W1.slice(0, 7) + '-01' });
  // «كل الطلبات» → «طلبات الفريق»
  await wait.locator('[data-hr-all-requests]').click();
  await expect(page).toHaveURL(/#tickets/);
});

test('«متضيفهوش» from the overtime\'s popup: the refusal with its reason, the meeting the server opened gets its date (اتحدد ميعاد)', async ({ page }) => {
  await openHr(page, ADMIN, 'hr');
  await P(page).locator('.card', { hasText: 'مستني قرار' }).locator('tbody tr', { hasText: 'وقت إضافي' }).click();
  await modal(page, 'وقت إضافي — هدى سمير').getByRole('button', { name: 'متضيفهوش' }).click();
  const f = modal(page, 'متضيفهوش');
  await f.locator('#why').fill('مش متفق عليه قبلها');
  await date(f, 'date', NEXT);
  await f.getByRole('button', { name: 'متضيفهوش وحدد الميتنج' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_overtime_decide').map((c) => [c.p_decision, c.p_reason])).toEqual([['reject', 'مش متفق عليه قبلها']]);
  await expect.poll(() => mock.hr.meetings.map((x) => [x.ref, x.status, x.day, x.time_text])).toEqual([['OT-1', 'اتحدد ميعاد', NEXT, '10:00']]);
});

test('the rebuild — «المرتبات»: the month\'s lines; ⋮ «تحويل المرتب» for one (early = its reason); «تحويل المرتبات» shows the rest with the totals and pays them = an «المرتبات» expense each + one withdrawal; then locked', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-payroll');
  const sheet = P(page).locator('table.hr-pay');
  await expect(sheet.locator('tbody tr')).toHaveCount(2);
  await expect(sheet.locator('tbody tr', { hasText: 'سارة أحمد' })).toContainText('11,000'); // 12000 − 1500 + 500
  await expect(sheet.locator('tbody tr', { hasText: 'منى حسن' })).toContainText('8,600');
  // one member first: before the pay day (28) the reason is a must
  const early = Number(T.slice(8, 10)) < 28;
  await sheet.locator('tbody tr', { hasText: 'منى حسن' }).getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تحويل المرتب' }).click();
  const one = modal(page, 'تحويل مرتب منى حسن');
  if (early) { await one.getByRole('button', { name: 'حوّل المرتب' }).click(); await expect(one).toContainText('اكتب سبب التحويل المبكر'); await one.locator('#reason').fill('ظرف عائلي'); }
  await one.getByRole('button', { name: 'حوّل المرتب' }).click();
  await expect(one).toBeHidden();
  expect(calls('hr_pay_member').map((c) => [c.p_member, c.p_account, c.p_reason])).toEqual([[ACC_ID, 'حساب البنك', early ? 'ظرف عائلي' : null]]);
  await expect(sheet.locator('tbody tr', { hasText: 'منى حسن' })).toContainText('اتحوّل');
  // the rest in one step: the popup lists who is left, the totals and the grand total
  await P(page).locator('[data-hr-transfer]').click();
  const f = modal(page, 'تحويل المرتبات');
  await expect(f.locator('table tbody tr')).toHaveCount(1);
  await expect(f.locator('[data-hr-transfer-sum]')).toContainText('إجمالي المرتبات');
  await expect(f.locator('[data-hr-transfer-sum]')).toContainText('الإجمالي اللي هيتحوّل');
  await expect(f.locator('[data-hr-transfer-sum]')).toContainText('11,000');
  await f.getByRole('button', { name: /^حوّل 11,000/ }).click();
  await expect(f).toBeHidden();
  await expect(P(page).locator('[data-hr-transfer]')).toBeDisabled();
  expect(mock.acc.acc_expenses.map((e) => [e.category, e.beneficiary, e.amount])).toEqual([['المرتبات', 'منى حسن', 8600], ['المرتبات', 'سارة أحمد', 11000]]);
  expect(mock.acc.acc_account_moves.map((m) => [m.account, m.direction, m.amount])).toEqual([['حساب البنك', 'withdraw', 8600], ['حساب البنك', 'withdraw', 11000]]);
  expect(calls('hr_payroll_transfer').map((c) => c.p_account)).toEqual(['حساب البنك']);
  expect((mock.hr.payroll.find((x) => x.month === MK) || {}).status).toBe('مدفوع');
});

test('the rebuild — ⋮ «تحويل سلفة» (all of it off this month: an approved advance + the money out) and «تصحيح الأوفر تايم» (minutes less, its reason) — the month\'s line follows', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-payroll');
  const row = () => P(page).locator('table.hr-pay tbody tr', { hasText: 'سارة أحمد' });
  await expect(row()).toContainText('11,000');
  await row().getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تحويل سلفة' }).click();
  const f = modal(page, 'تحويل سلفة');
  await f.locator('#amount').fill('2000'); await f.locator('#reason').fill('مصاريف علاج');
  await f.getByRole('button', { name: 'حوّل السلفة' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_advance_give').map((c) => [c.p_member, c.p_amount, c.p_account])).toEqual([[OPS_ID, 2000, 'حساب البنك']]);
  expect(mock.hr.requests.filter((r) => r.type === 'سُلفة').map((r) => [r.status, r.pay_from])).toEqual([['موافق', MK]]);
  await expect(row()).toContainText('9,000'); // 11,000 − 2,000 this month
  expect(mock.acc.acc_account_moves.map((m) => [m.amount, m.note])).toEqual([[2000, expect.stringMatching(/^سلفة HR-/)]]);
  // the overtime fix: 1:30 more (it was recorded short)
  await row().getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'تصحيح الأوفر تايم' }).click();
  const o = modal(page, 'تصحيح الأوفر تايم');
  await o.locator('#hours').fill('1'); await o.locator('#minutes').fill('30'); await o.locator('#reason').fill('اتسجل ناقص يوم الجرد');
  await o.getByRole('button', { name: 'سجّل التصحيح' }).click();
  await expect(o).toBeHidden();
  expect(calls('hr_ot_adjust_add').map((c) => [c.p_member, c.p_month, c.p_minutes])).toEqual([[OPS_ID, MK, 90]]);
  await expect(row()).toContainText('9,093.75'); // + 90 minutes at 12000/24/8 = 62.5/h → 93.75
});

test('the rebuild — «التقييمات»: the month (the attendance automatic; «قيّم» with the month\'s tasks in front of the manager, the performance and the communication out of 5 → hr_evaluate), and the quarter from its months', async ({ page }) => {
  await openHr(page, ADMIN, 'hr-evals');
  const t = P(page).locator('table.hr-evals');
  await expect(t.locator('tbody tr')).toHaveCount(4);
  await t.locator('tbody tr', { hasText: 'منى حسن' }).locator('[data-hr-rate]').click();
  const f = modal(page, 'تقييم منى حسن');
  await expect(f).toContainText('الحضور (تلقائي)');
  await expect(f.locator('[data-hr-rate-tasks]')).toContainText('مهام خلصت');
  await f.getByRole('button', { name: 'حفظ التقييم' }).click();
  await expect(f).toContainText('اختار تقييم الأداء');
  await f.locator('#ev-perf [data-star="4"]').click(); await f.locator('#ev-comm [data-star="5"]').click();
  await f.getByRole('button', { name: 'حفظ التقييم' }).click();
  await expect(f).toBeHidden();
  expect(calls('hr_evaluate').map((c) => [c.p_member, c.p_month, c.p_perf, c.p_comm])).toEqual([[ACC_ID, MK, 4, 5]]);
  const r = t.locator('tbody tr', { hasText: 'منى حسن' });
  await expect(r).toContainText('4 / 5'); await expect(r).toContainText('5 / 5');
  await P(page).getByRole('tab', { name: 'التقييم الربع سنوي' }).click();
  await expect(P(page).locator('table.hr-evals-q tbody tr', { hasText: 'منى حسن' })).toContainText('1 / 3');
});

test('«إضافة عضو» (decision 14): team-admin makes the login and mails the set-your-password link — the modal says so, no password anywhere; «ابعت إيميل الباسورد تاني» from the row menu', async ({ page }) => {
  await openHr(page);
  await P(page).getByRole('button', { name: 'إضافة عضو' }).click();
  const f = modal(page, 'إضافة عضو');
  await expect(f).toContainText('هيوصله إيميل بلينك يعمل منه الباسورد');
  await f.locator('#name').fill('كريم سامي'); await f.locator('#title').fill('مصوّر منتجات');
  await f.locator('#email').fill('karim.dev@ibtekr.local'); await f.locator('#phone').fill('01012345678');
  await date(f, 'hire', T);
  await f.locator('#salary').fill('9000'); await f.locator('#holdback').fill('1000');
  await f.getByRole('button', { name: 'إضافة وعمل الحساب' }).click();
  await expect(f).toBeHidden();
  const ok = modal(page, 'اتبعت الإيميل');
  await expect(ok).toContainText('لينك يعمل منه الباسورد'); await expect(ok.locator('[data-mailed-to]')).toHaveText('karim.dev@ibtekr.local');
  await expect(ok.locator('[data-temp-password]')).toHaveCount(0);
  expect(mock.hr.mails).toEqual([{ to: 'karim.dev@ibtekr.local', kind: 'invite' }]);
  expect(calls('team-admin').map((c) => c.action)).toEqual(['member_create']);
  expect(mock.hr.writes.filter((w) => w.table === 'hr_pay').map((w) => [w.salary, w.holdback])).toEqual([[9000, 1000]]);
  await ok.getByRole('button', { name: 'تمام' }).click();
  await expect(P(page).locator('.hr-table')).toContainText('كريم سامي');
  // the mail again from the row menu (an active member who is not me)
  await P(page).locator('.hr-table tbody tr', { hasText: 'كريم سامي' }).getByRole('button', { name: 'إجراءات كريم سامي' }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'ابعت إيميل الباسورد تاني' }).first().click();
  await modal(page, 'ابعت إيميل الباسورد تاني').getByRole('button', { name: 'ابعت' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتبعت الإيميل لـ كريم سامي');
  expect(mock.hr.mails.length).toBe(2); expect(calls('team-admin').map((c) => c.action)).toEqual(['member_create', 'member_invite']);
  // decision 15: «حذف العضو نهائي» — the new member left no trace, so the row goes; a member with a trace is refused with the table
  await P(page).locator('.hr-table tbody tr', { hasText: 'كريم سامي' }).getByRole('button', { name: 'إجراءات كريم سامي' }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'حذف العضو نهائي' }).first().click();
  const del = modal(page, 'حذف كريم سامي نهائي؟'); await expect(del).toContainText('مافيش رجوع');
  await del.getByRole('button', { name: 'احذف نهائي' }).click();
  await expect(page.locator('.toast.show')).toContainText('اتحذف كريم سامي نهائي');
  await expect(P(page).locator('.hr-table')).not.toContainText('كريم سامي');
  expect(mock.profiles.some((p) => p.email === 'karim.dev@ibtekr.local')).toBe(false);
  expect(mock.activityRows.filter((r) => r.action === 'hr.member.delete').map((r) => r.new_value)).toEqual(['كريم سامي']);
  mock.activityRows.push({ id: 900, at: new Date().toISOString(), actor: OPS_ID, action: 'auth.login', entity: 'profile', entity_id: OPS_ID, new_value: null });
  await P(page).locator('.hr-table tbody tr', { hasText: 'سارة أحمد' }).getByRole('button', { name: 'إجراءات سارة أحمد' }).click();
  await page.locator('[role=menu] .opt, [role=menu] [role=menuitem]', { hasText: 'حذف العضو نهائي' }).first().click();
  await modal(page, 'حذف سارة أحمد نهائي؟').getByRole('button', { name: 'احذف نهائي' }).click();
  await expect(page.locator('.toast.show')).toContainText('العضو له سجل في «سجل النشاط» — اوقفه بدل ما تمسحه');
  await expect(P(page).locator('.hr-table')).toContainText('سارة أحمد');
});

test('«إضافة عضو» without Resend: the temporary password shows once (not in any log)', async ({ page }) => {
  mock = await installSupabaseMock(page, { ...SEED, hrResend: false });
  await openHr(page);
  await P(page).getByRole('button', { name: 'إضافة عضو' }).click();
  const f = modal(page, 'إضافة عضو');
  await f.locator('#name').fill('كريم سامي'); await f.locator('#title').fill('مصوّر منتجات');
  await f.locator('#email').fill('karim.dev@ibtekr.local'); await f.locator('#phone').fill('01012345678');
  await date(f, 'hire', T);
  await f.locator('#salary').fill('9000'); await f.locator('#holdback').fill('1000');
  await f.getByRole('button', { name: 'إضافة وعمل الحساب' }).click();
  await expect(f).toBeHidden(); // phase 13 decision 13 (the owner): the popup closes on the click; the password modal follows the answer
  const pw = modal(page, 'الباسورد المؤقت');
  await expect(pw).toContainText('بيظهر مرة واحدة بس');
  await expect(pw.locator('[data-temp-password]')).toHaveText('mock-temp-1');
  expect(calls('team-admin').map((c) => c.action)).toEqual(['member_create']);
  expect(mock.hr.writes.filter((w) => w.table === 'hr_pay').map((w) => [w.salary, w.holdback])).toEqual([[9000, 1000]]);
  expect(JSON.stringify(mock.activityRows)).not.toContain('mock-temp-1');
  await pw.getByRole('button', { name: 'تمام' }).click();
  await expect(P(page).locator('.hr-table')).toContainText('كريم سامي');
});

test('the rebuild — the HR settings live in «الإعدادات › الموارد البشرية» (#hr-settings lands there): the pay day, the bonus bar and the year\'s end saved with «حفظ»; a holiday added at once', async ({ page }) => {
  await openHr(page, ADMIN, 'hr');
  await page.evaluate(() => { location.hash = 'hr-settings'; });
  await expect(page).toHaveURL(/#settings-hr$/);
  const S = page.locator('[data-hr-settings]');
  await expect(S).toContainText('الأحد – الخميس');
  await S.locator('#hs-payday').fill('25');
  await pick(page, S, 'hs-bonus', '3.5 من 5 أو أكتر');
  await S.getByRole('radio', { name: /يترحّل/ }).click();
  await page.locator('[data-set-save]').first().click();
  await expect.poll(() => ((mock.settings.find((x) => x.section === 'hr') || {}).data || {})).toMatchObject({ payDay: 25, bonusMin: 3.5, leaveYearEnd: 'carry' });
  await S.locator('[data-hs-holiday]').click();
  const f = modal(page, 'إضافة عطلة');
  await f.locator('#name').fill('عيد تجريبي'); await date(f, 'date', NEXT);
  await f.getByRole('button', { name: 'إضافة' }).click();
  await expect(f).toBeHidden();
  expect(mock.hr.holidays.map((x) => [x.name, x.day, x.status])).toEqual([['عيد تجريبي', NEXT, 'متوقع']]);
  await expect(S).toContainText('عيد تجريبي');
  // the card on the settings hub
  await page.locator('[data-set-back]').click();
  await expect(page.locator('[data-set-card="hr"]')).toContainText('يوم الصرف 25');
});
test('ops (hr.view P, no team of her own, no salaries): herself only, no «المرتبات» tab and no admin buttons; «التقييمات» lists her without «قيّم» (never her own month)', async ({ page }) => {
  await openHr(page, OPS);
  await expect(P(page).locator('.hr-table tbody tr')).toHaveCount(1);
  await expect(P(page).locator('.hr-table')).toContainText('سارة أحمد');
  await expect(P(page).getByRole('button', { name: 'إضافة عضو' })).toHaveCount(0);
  await expect(P(page).getByRole('button', { name: 'تسجيل حضور يدوي' })).toHaveCount(0);
  await expect(P(page).locator('[role=tab]', { hasText: 'المرتبات' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'التقييمات' }).click();
  await expect(P(page).locator('table.hr-evals tbody tr')).toHaveCount(1);
  await expect(P(page).locator('table.hr-evals [data-hr-rate]')).toHaveCount(0);
  await expect(P(page).locator('table.hr-evals')).not.toContainText('البونص');
});
test('every tab and sub-tab draws without a page error (the calendar, the payroll, the evaluations, the staff reports, the log)', async ({ page }) => {
  await openHr(page);
  const tab = (name) => page.getByRole('tab', { name });
  for (const sub of ['سجل الحضور', 'تقويم الفريق', 'الفريق']) { await P(page).getByRole('tab', { name: sub, exact: true }).click(); await expect(P(page).locator('.panel')).toBeVisible(); }
  await expect(P(page)).toContainText('هدى سمير');
  await P(page).getByRole('tab', { name: 'تقويم الفريق' }).click();
  await P(page).getByRole('button', { name: 'التالي ›' }).click(); await P(page).getByRole('button', { name: 'النهارده' }).click();
  await expect(P(page).locator('.tcal2 .tc-row')).toHaveCount(5); // the head + the 4 members
  await tab('المرتبات').click(); await expect(P(page).locator('[data-hr-pay-cards]')).toBeVisible();
  await tab('التقييمات').click(); await expect(P(page).locator('[data-hr-eval-cards]')).toBeVisible();
  await P(page).getByRole('tab', { name: 'التقييم الربع سنوي' }).click(); await expect(P(page).locator('table.hr-evals-q')).toBeVisible();
  await tab('التقارير').click(); await expect(P(page).locator('[data-staff="absence"], [data-staff="rating"]').first()).toBeVisible(); // the reports page's «تقارير الموظفين» (T8)
  await tab('سجل الحركات').click(); await expect(P(page).locator('.panel')).toBeVisible();
});
