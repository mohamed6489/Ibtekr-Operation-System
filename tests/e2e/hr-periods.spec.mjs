import { test, expect } from '@playwright/test';
import { installSupabaseMock, LIVE, DEV_PW } from './supabase-mock.mjs';
import { hrToday, hrAt } from './hr-mock.mjs';

// comments 15 Nov decisions 75–77 (docs/superpowers/plans/2026-11-15-comments.md) — the owner on «الموارد البشرية»:
//   75 «عايز ابدل الفلتر ده يبقي الفلتر الكبير بتاع التاريخ اللي في اغلب السيستم» — the attendance log's month list is the system's period picker;
//   76 «ف تقويم الفريق نظبطلها view بالمدة» — the team calendar shows the days of a picked period;
//   77 «المرتبات و التقيمات تبقي الشهر لوحده و السنة لوحدها اقدر اختار شهر و سنة — و كمان اقدر اعمل مقارنة» — a month list and a year list, and a
//      comparison with another month (quarter) on the system's comparison card.
// Mock only; the dates follow today.
const ADMIN = 'admin.dev@ibtekr.local';
const OPS_ID = '00000000-0000-4000-8000-000000000002'; const M03 = '00000000-0000-4000-8000-000000000003';
const ACC_ID = '00000000-0000-4000-8000-000000000004'; const VF_ID = '00000000-0000-4000-8000-000000000005';
const T = hrToday(); const MK = T.slice(0, 7);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (mk, n) => { const d = new Date(mk + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
const workday = (from, step) => { let d = addDays(from, step); while (dow(d) === 5 || dow(d) === 6) d = addDays(d, step); return d; };
const AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monLabel = (mk) => AR[Number(mk.slice(5, 7)) - 1] + ' ' + mk.slice(0, 4);
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const PREV = addMonths(MK, -1); const W1 = workday(T, -1);
const SEED = {
  hrMembers: [{ member_id: OPS_ID, hire_date: '2024-05-12' }, { member_id: M03 }, { member_id: ACC_ID }, { member_id: VF_ID }],
  hrPay: [{ member_id: OPS_ID, salary: 12000, holdback: 1500, allowances: 500 }, { member_id: ACC_ID, salary: 9600, holdback: 1000, allowances: 0 }],
  hrAttendance: [{ member_id: ACC_ID, day: W1, in_at: hrAt(W1, '09:00'), out_at: hrAt(W1, '17:00'), source: 'clock' }],
  hrPayroll: [{ month: MK + '-01', status: 'مسودة' }],
  // this month: منى 5 / 4 and سارة 4 / 4 · last month: منى 2 / 2 only
  hrEvaluations: [{ member_id: ACC_ID, month: MK + '-01', performance: 5, communication: 4 }, { member_id: OPS_ID, month: MK + '-01', performance: 4, communication: 4 }, { member_id: ACC_ID, month: PREV + '-01', performance: 2, communication: 2 }],
};
let mock = null; let pageErrors = [];
test.beforeEach(async ({ page }) => {
  test.skip(LIVE, 'asserts on the mocked Supabase');
  pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  mock = await installSupabaseMock(page, SEED);
});
test.afterEach(() => { if (LIVE) return; expect(pageErrors).toEqual([]); expect(mock.unhandled).toEqual([]); });
async function openHr(page, hash) {
  await page.goto('/');
  await page.fill('#lg-id', ADMIN); await page.fill('#lg-pw', DEV_PW);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('#root')).toBeVisible();
  await page.evaluate((x) => { location.hash = x; }, hash);
  await expect(page.locator('#pg-hr')).toBeVisible();
}
const P = (page) => page.locator('#pg-hr');
async function pickIn(page, scope, id, label) { await scope.locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }
async function pick(page, id, label) { await P(page).locator('#' + id).click(); await page.locator('[role=listbox] [role=option]', { hasText: label }).first().click(); }
// the system's period picker: its own dates typed, then «تحديث»
async function period(page, field, from, to) {
  await field.locator('.date-field').click();
  const dp = page.locator('.dp.range'); await expect(dp).toBeVisible();
  await dp.getByLabel('من تاريخ').fill(dmy(from)); await dp.getByLabel('من تاريخ').press('Tab');
  await dp.getByLabel('إلى تاريخ').fill(dmy(to)); await dp.getByLabel('إلى تاريخ').press('Tab');
  await dp.getByRole('button', { name: 'تحديث' }).click(); await expect(dp).toBeHidden();
}

test('comment 75 — «سجل الحضور»: the month list is the system\'s period picker — this month by default (it still reads as a month), any period after a pick: its days only, the cards and the title on the period', async ({ page }) => {
  await openHr(page, 'hr-team');
  await P(page).getByRole('tab', { name: 'سجل الحضور' }).click();
  await pick(page, 'log-m', 'العضو: منى حسن');
  const field = P(page).locator('[data-hr-att-period]');
  await expect(P(page).locator('#log-mo')).toHaveCount(0);
  await expect(field.locator('.date-field')).toBeVisible();
  expect((await field.getAttribute('data-hr-att-period')).split('|')[0]).toBe(MK + '-01'); // this month until the member picks
  await expect(P(page).locator('.cards.five')).toContainText('ساعات الشهر');
  // the picker is the big one: the ready periods and the two calendars
  await field.locator('.date-field').click();
  await expect(page.locator('.dp.range .presets [role=radio]', { hasText: /^هذا الشهر$/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.dp.range .cals .cal-grid')).toHaveCount(2);
  await page.locator('.dp.range').getByRole('button', { name: 'إلغاء' }).click();
  // a week of its own (it may cross into last month): seven rows, the period in the title and on the cards
  const from = addDays(T, -9); const to = addDays(T, -3);
  await period(page, field, from, to);
  await expect(field).toHaveAttribute('data-hr-att-period', from + '|' + to);
  const sec = P(page).locator('section.card', { hasText: 'سجل الحضور — منى حسن' });
  await expect(sec.locator('tbody tr:not(.dt-total)')).toHaveCount(7);
  await expect(P(page).locator('.cards.five')).toContainText('ساعات الفترة');
  await expect(P(page).locator('.cards.five')).not.toContainText('ساعات الشهر');
  await expect(sec.locator('tbody tr.dt-total, tfoot tr').first()).toContainText('الفترة');
  // the day she attended is inside or outside the period by its date — a period on that day alone has it
  await period(page, field, W1, W1);
  await expect(sec.locator('tbody tr:not(.dt-total)')).toHaveCount(1);
  await expect(sec.locator('tbody tr').first()).toContainText('9:00 ص');
  await expect(P(page).locator('.cards.five')).toContainText('8:00'); // the session's eight hours
});

test('comment 76 — «تقويم الفريق» by a period: two weeks from the week\'s start until a pick, «التالي» / «السابق» move it a week, a picked period draws its own days (the month under the first day), «النهارده» brings the default back', async ({ page }) => {
  await openHr(page, 'hr-team');
  await P(page).getByRole('tab', { name: 'تقويم الفريق' }).click();
  const field = P(page).locator('[data-hr-cal-period]'); const days = P(page).locator('.tcal2 .tc-head [data-hr-cal-day]');
  // the meeting of 23 Nov [#4]: the calendar opens on this month (was two weeks from the week's start)
  const mEnd = (() => { const y = +T.slice(0, 4), m = +T.slice(5, 7); return T.slice(0, 8) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0'); })();
  const N = Number(mEnd.slice(8, 10));
  await expect(days).toHaveCount(N);
  await expect(P(page).locator('[data-hr-cal-days]')).toHaveAttribute('data-hr-cal-days', String(N));
  const [a0, b0] = (await field.getAttribute('data-hr-cal-period')).split('|');
  expect([a0, b0]).toEqual([T.slice(0, 8) + '01', mEnd]);
  await expect(field.locator('.date-field')).toBeVisible(); // the same picker as the rest of the system
  await P(page).locator('[data-hr-cal-next]').click();
  await expect(field).toHaveAttribute('data-hr-cal-period', addDays(a0, 7) + '|' + addDays(b0, 7));
  await P(page).locator('[data-hr-cal-prev]').click(); await P(page).locator('[data-hr-cal-prev]').click();
  await expect(field).toHaveAttribute('data-hr-cal-period', addDays(a0, -7) + '|' + addDays(b0, -7));
  // a period of its own: five days ahead — five columns, each row on the same grid, the month named under the first
  const from = addDays(T, 3); const to = addDays(T, 7);
  await period(page, field, from, to);
  await expect(days).toHaveCount(5);
  expect(await days.evaluateAll((els) => els.map((e) => e.getAttribute('data-hr-cal-day')))).toEqual([0, 1, 2, 3, 4].map((n) => addDays(from, n)));
  await expect(days.first().locator('.tc-mon')).toHaveText(AR[Number(from.slice(5, 7)) - 1]);
  const tracks = await P(page).locator('.tcal2 .tc-row').evaluateAll((rows) => rows.map((r) => getComputedStyle(r).gridTemplateColumns.split(' ').length));
  expect(new Set(tracks)).toEqual(new Set([6])); // the member's column + the five days, on every row
  await expect(P(page).locator('.tcal2 .tc-row')).toHaveCount(5); // the head + the 4 members
  // a long period is cut at 62 days and says so
  await period(page, field, addDays(T, -40), addDays(T, 40));
  await expect(days).toHaveCount(62);
  await expect(P(page).locator('[data-hr-cal-days]')).toContainText('أول 62 يوم من 81');
  await P(page).locator('[data-hr-cal-today]').click();
  await expect(field).toHaveAttribute('data-hr-cal-period', a0 + '|' + b0);
  await expect(days).toHaveCount(N);
});

test('comment 77 — «المرتبات»: «الشهر» and «السنة» are two lists (no month after this one); «مقارنة» opens a second pair and the comparison card of the two months', async ({ page }) => {
  await openHr(page, 'hr-payroll');
  const bar = P(page).locator('.hr-mpick');
  await expect(bar.locator('#sh-m')).toContainText('الشهر: ' + AR[Number(MK.slice(5, 7)) - 1]);
  await expect(bar.locator('#sh-y')).toContainText('السنة: ' + MK.slice(0, 4));
  // chat ش9 (16 Nov): every month of this year (a bonus / deduction on a month to come) and next year in the years; last year too
  await bar.locator('#sh-m').click();
  await expect(page.locator('[role=listbox] [role=option]')).toHaveCount(12);
  await page.keyboard.press('Escape');
  await bar.locator('#sh-y').click();
  await expect(page.locator('[role=listbox] [role=option]').first()).toHaveText('السنة: ' + (Number(MK.slice(0, 4)) + 1));
  await expect(page.locator('[role=listbox] [role=option]').nth(1)).toHaveText('السنة: ' + MK.slice(0, 4));
  await expect(page.locator('[role=listbox] [role=option]', { hasText: String(Number(MK.slice(0, 4)) - 1) })).toHaveCount(1);
  await page.locator('[role=listbox] [role=option]', { hasText: String(Number(MK.slice(0, 4)) - 1) }).click();
  // last year: all twelve months, the same month picked there
  await expect(bar).toHaveAttribute('data-hr-month-pick', (Number(MK.slice(0, 4)) - 1) + MK.slice(4));
  await bar.locator('#sh-m').click(); await expect(page.locator('[role=listbox] [role=option]')).toHaveCount(12); await page.keyboard.press('Escape');
  await pick(page, 'sh-y', 'السنة: ' + MK.slice(0, 4));
  await expect(bar).toHaveAttribute('data-hr-month-pick', MK);
  await expect(P(page).locator('table.hr-pay tbody tr:not(.dt-total)').filter({ hasNotText: 'مالوش مرتب' })).toHaveCount(2); // ش31: the rest of the team as «مالوش مرتب»
  await expect(P(page).locator('[data-hr-ahead]')).toHaveCount(0);
  // a month to come (next year's same month): the note, no transfer; «مكافأة / خصم» stays
  await pick(page, 'sh-y', 'السنة: ' + (Number(MK.slice(0, 4)) + 1));
  await expect(bar).toHaveAttribute('data-hr-month-pick', (Number(MK.slice(0, 4)) + 1) + MK.slice(4));
  await expect(P(page).locator('[data-hr-ahead]')).toContainText('لسه مابدأش — تقدر تضيف مكافأة أو خصم');
  await expect(P(page).locator('[data-hr-transfer]')).toBeDisabled();
  await expect(P(page).locator('[data-hr-adjust]')).toBeEnabled();
  await pick(page, 'sh-y', 'السنة: ' + MK.slice(0, 4));
  await expect(bar).toHaveAttribute('data-hr-month-pick', MK);
  // «مقارنة»: off by default; on = the month before, its own two lists, and the card
  await expect(P(page).locator('[data-cmp="hr-pay"]')).toHaveCount(0);
  await expect(bar.locator('#sh-c-m')).toHaveCount(0);
  await bar.locator('[data-hr-cmp="pay"] input').check();
  const card = P(page).locator('[data-cmp="hr-pay"]');
  await expect(card).toBeVisible();
  await expect(bar.locator('#sh-c-m')).toContainText('الشهر: ' + AR[Number(PREV.slice(5, 7)) - 1]);
  await expect(bar.locator('#sh-c-y')).toContainText('السنة: ' + PREV.slice(0, 4));
  await expect(card.locator('[data-cmp-per="cur"]')).toContainText(monLabel(MK));
  await expect(card.locator('[data-cmp-per="was"]')).toContainText(monLabel(PREV));
  await expect(card.locator('[data-cmp-per="was"]')).toHaveAttribute('data-range', new RegExp('^' + PREV + '-01\\|' + PREV + '-(28|29|30|31)$'));
  // this month's sheet: 11,000 + 8,600 (12000 − 1500 + 500 and 9600 − 1000)
  const net = card.locator('[data-cmp-row="الصافي"]');
  await expect(net.locator('.pcmp-v.cur')).toContainText('19,600');
  await expect(card.locator('[data-cmp-row="المرتبات"] .pcmp-v.cur')).toContainText('19,100');
  await expect(card.locator('[data-cmp-row="أعضاء بمرتب"] .pcmp-v.cur')).toContainText('2');
  await expect(card.locator('[data-cmp-row]')).toHaveCount(7);
  // another month to compare with: two months back, when it is in the same year's list
  const TWO = addMonths(MK, -2);
  if (TWO.slice(0, 4) === PREV.slice(0, 4)) {
    await pick(page, 'sh-c-m', 'الشهر: ' + AR[Number(TWO.slice(5, 7)) - 1]);
    await expect(card.locator('[data-cmp-per="was"]')).toContainText(monLabel(TWO));
  }
  await bar.locator('[data-hr-cmp="pay"] input').uncheck();
  await expect(P(page).locator('[data-cmp="hr-pay"]')).toHaveCount(0);
});

test('comment 77 — «التقييمات»: the month by «الشهر» + «السنة», the quarter by «الربع» + «السنة»; «مقارنة» compares the team\'s averages of the two', async ({ page }) => {
  await openHr(page, 'hr-evals');
  const bar = P(page).locator('.hr-mpick');
  await expect(bar.locator('#ev-m')).toContainText('الشهر: ' + AR[Number(MK.slice(5, 7)) - 1]);
  await expect(bar.locator('#ev-y')).toContainText('السنة: ' + MK.slice(0, 4));
  await expect(P(page).locator('table.hr-evals tbody tr', { hasText: 'منى حسن' })).toContainText('5 / 5');
  await bar.locator('[data-hr-cmp="eval"] input').check();
  const card = P(page).locator('[data-cmp="hr-eval"]');
  await expect(card.locator('[data-cmp-per="cur"]')).toContainText(monLabel(MK));
  await expect(card.locator('[data-cmp-per="was"]')).toContainText(monLabel(PREV));
  await expect(card.locator('[data-cmp-row="اتقيّموا"] .pcmp-v.cur')).toContainText('2');
  await expect(card.locator('[data-cmp-row="اتقيّموا"] .pcmp-v.was')).toContainText('1');
  await expect(card.locator('[data-cmp-row="اتقيّموا"] [data-cmp-tone]')).toHaveAttribute('data-cmp-tone', 'positive'); // more rated = the good way
  await expect(card.locator('[data-cmp-row="متوسط الأداء"] .pcmp-v.cur')).toContainText('4.5'); // (5 + 4) ÷ 2
  await expect(card.locator('[data-cmp-row="متوسط الأداء"] .pcmp-v.was')).toContainText('2');
  await expect(card.locator('[data-cmp-row="متوسط التواصل"] .pcmp-v.cur')).toContainText('4');
  // the month before on the main picker (when it is in this year): the table follows it
  if (PREV.slice(0, 4) === MK.slice(0, 4)) {
    await pick(page, 'ev-m', 'الشهر: ' + AR[Number(PREV.slice(5, 7)) - 1]);
    await expect(bar).toHaveAttribute('data-hr-month-pick', PREV);
    await expect(P(page).locator('section.card', { hasText: 'التقييم الشهري — ' + monLabel(PREV) })).toBeVisible();
    await expect(card.locator('[data-cmp-per="cur"]')).toContainText(monLabel(PREV));
  }
  // the quarter: «الربع» and «السنة», the comparison with the quarter before
  await P(page).getByRole('tab', { name: 'التقييم الربع سنوي' }).click();
  const qn = Math.floor((Number(MK.slice(5, 7)) - 1) / 3) + 1; const QN = ['الأول', 'التاني', 'التالت', 'الرابع'];
  const qbar = P(page).locator('.hr-mpick');
  await expect(qbar.locator('#evq-q')).toContainText('الربع: ' + QN[qn - 1]);
  await expect(qbar.locator('#evq-y')).toContainText('السنة: ' + MK.slice(0, 4));
  await expect(qbar).toHaveAttribute('data-hr-quarter-pick', MK.slice(0, 4) + '-Q' + qn);
  await qbar.locator('#evq-q').click(); await expect(page.locator('[role=listbox] [role=option]')).toHaveCount(qn); await page.keyboard.press('Escape');
  const qcard = P(page).locator('[data-cmp="hr-eval"]');
  await expect(qcard.locator('[data-cmp-per="cur"]')).toContainText('الربع ' + QN[qn - 1] + ' ' + MK.slice(0, 4));
  await expect(qcard.locator('[data-cmp-per="was"]')).toContainText(qn > 1 ? 'الربع ' + QN[qn - 2] + ' ' + MK.slice(0, 4) : 'الربع الرابع ' + (Number(MK.slice(0, 4)) - 1));
  await expect(qcard.locator('[data-cmp-row]')).toHaveCount(6);
});

// comments decision 78 (0110 — the owner 15 Nov: «المرتبات لما اعمل مكافأة لعضو اتحوله المرتب يطلعلي ايرور و يقولي انه اتحوله مرتبه بالفعل ف مفيش
// خصم و يقولي نضيفه للشهر اللي جاى»): the popup names the member already paid as an error and its button puts the line on the month after
test('comment 78 — «مكافأة / خصم» for a member already paid: the error in the popup, «ضيفه على ‹الشهر الجاي›» writes it on the next month; the server refuses the paid month by itself', async ({ page }) => {
  const NEXT = addMonths(MK, 1);
  mock.hr.payroll_paid.push({ month: MK + '-01', member_id: ACC_ID, amount: 8600, account: 'حساب البنك', early_reason: null, paid_by: null, paid_at: new Date().toISOString() });
  await openHr(page, 'hr-payroll');
  const sheet = P(page).locator('table.hr-pay');
  await expect(sheet.locator('tbody tr', { hasText: 'منى حسن' })).toContainText('اتحوّل');
  // from the toolbar: a member not paid yet is the ordinary popup
  await P(page).locator('[data-hr-adjust]').click();
  const f = page.locator('.modal[role=dialog]', { hasText: 'مكافأة / خصم' });
  await pickIn(page, f, 'member', 'سارة أحمد');
  await expect(f.locator('[data-hr-adj-paid]')).toHaveCount(0);
  await expect(f.getByRole('button', { name: 'إضافة', exact: true })).toBeVisible();
  // the paid member: the error names her and the month, the button offers the month after
  await pickIn(page, f, 'member', 'منى حسن');
  await expect(f.locator('.note.error, .inline-note.error, [role=alert]').filter({ hasText: 'اتحوّله مرتب' }).first()).toBeVisible();
  await expect(f.locator('[data-hr-adj-paid]')).toHaveAttribute('data-hr-adj-paid', NEXT);
  await expect(f.locator('[data-hr-adj-paid]')).toContainText('«منى حسن» اتحوّله مرتب ' + monLabel(MK) + ' بالفعل');
  await expect(f.locator('[data-hr-adj-paid]')).toContainText('نضيف البند على مرتب ' + monLabel(NEXT));
  await expect(f.getByRole('button', { name: 'إضافة', exact: true })).toHaveCount(0);
  await f.locator('#label').fill('مكافأة مبيعات'); await f.locator('#amount').fill('500');
  await f.getByRole('button', { name: 'ضيفه على ' + monLabel(NEXT) }).click();
  await expect(f).toBeHidden();
  await expect(page.locator('.toast.show')).toContainText('اتضاف البند على مرتب ' + monLabel(NEXT));
  const adj = mock.hr.adjustments.filter((a) => a.member_id === ACC_ID);
  expect(adj.map((a) => [a.month.slice(0, 7), a.amount, a.label])).toEqual([[NEXT, 500, 'مكافأة مبيعات']]);
  // the row's ⋮ of the paid member opens the same popup with the error up front
  await sheet.locator('tbody tr', { hasText: 'منى حسن' }).getByRole('button', { name: /إجراءات/ }).click();
  await page.getByRole('menuitem', { name: 'مكافأة / خصم' }).click();
  const g = page.locator('.modal[role=dialog]', { hasText: 'مكافأة / خصم' });
  await expect(g.locator('[data-hr-adj-paid]')).toContainText('اتحوّله مرتب');
  await g.getByRole('button', { name: 'إلغاء' }).click();
  // the server's own refusal (the pay landed from another device after the popup opened): in words, nothing written
  const before = mock.hr.adjustments.length;
  const r = await page.evaluate((x) => window.IBHR.addAdjustment({ member: x.code, month: x.mk, label: 'خصم', amount: -50 }), { code: await page.evaluate((id) => (window.IBHR.data.team.find((m) => m.uid === id) || window.IBHR.everyone().find((m) => m.uid === id) || {}).id, ACC_ID), mk: MK });
  expect(r.ok).toBe(false); expect(r.reason).toBe('paid'); expect(r.message).toContain('اتحوّله مرتب الشهر ده بالفعل');
  expect(mock.hr.adjustments.length).toBe(before);
});

// comments decision 79 (the owner on «تقييم ‹عضو› — ‹شهر›»: «غيرلي ال ui لشكل احترافي و منظم»): the member in a head box, the three parts of
// the month as three boxes, the month's tasks in a box, the score as a strip that follows the stars
test('comment 79 — the evaluation popup: who and which month in the head, the attendance / the performance / the communication as three boxes, the tasks box, the score strip follows the stars and says which side of the bonus bar', async ({ page }) => {
  await openHr(page, 'hr-evals');
  await P(page).locator('table.hr-evals tbody tr', { hasText: 'هدى سمير' }).locator('[data-hr-rate]').click(); // not rated yet
  const f = page.locator('.modal.ev-modal[role=dialog]');
  await expect(f).toBeVisible();
  await expect(f.locator('.ev-who')).toContainText('هدى سمير');
  await expect(f.locator('.ev-who')).toContainText(monLabel(MK));
  await expect(f.locator('.ev-who')).toContainText('لسه ماتقيّمش');
  await expect(f.locator('.ev-grid > .ev-box')).toHaveCount(3);
  await expect(f.locator('.ev-grid > .ev-att')).toContainText('الحضور (تلقائي)');
  await expect(f.locator('.ev-grid > .ev-att .ev-bar')).toBeVisible();
  await expect(f.locator('.ev-grid #ev-perf [data-star]')).toHaveCount(5);
  await expect(f.locator('.ev-grid #ev-comm [data-star]')).toHaveCount(5);
  // the three boxes sit side by side on a desktop
  const tops = await f.locator('.ev-grid > .ev-box').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(f.locator('[data-hr-rate-tasks]')).toContainText('مهام خلصت');
  await expect(f.locator('[data-hr-rate-tasks]')).toContainText('مهام لسه مفتوحة');
  // the strip: nothing until both are picked, then the month's score and the bar's side
  const strip = f.locator('[data-hr-rate-total]');
  await expect(strip).toHaveAttribute('data-hr-rate-total', '');
  await expect(strip).toContainText('اختار الأداء والتواصل');
  await f.locator('#ev-perf [data-star="1"]').click();
  await expect(strip).toHaveAttribute('data-hr-rate-total', '');
  await f.locator('#ev-comm [data-star="1"]').click();
  await expect(strip).toHaveClass(/under/);
  await expect(strip).toContainText('تحت حد البونص (3)');
  await f.locator('#ev-perf [data-star="5"]').click(); await f.locator('#ev-comm [data-star="5"]').click();
  await expect(strip).toHaveClass(/over/);
  await expect(strip).toContainText('على حد البونص (3) أو فوقه');
  const shown = Number(await strip.getAttribute('data-hr-rate-total'));
  expect(shown).toBeGreaterThanOrEqual(3);
  // an already rated member opens with his stars and his score in the head
  await f.getByRole('button', { name: 'إلغاء' }).click();
  await P(page).locator('table.hr-evals tbody tr', { hasText: 'منى حسن' }).locator('[data-hr-rate]').click();
  const g = page.locator('.modal.ev-modal[role=dialog]');
  await expect(g.locator('.ev-who')).toContainText('متقيّم');
  await expect(g.locator('#ev-perf [data-star="5"]')).toHaveAttribute('aria-checked', 'true');
  await expect(g.locator('#ev-comm [data-star="4"]')).toHaveAttribute('aria-checked', 'true');
  // on a phone the boxes stack and nothing leaves the popup
  await page.setViewportSize({ width: 390, height: 800 });
  const box = await g.evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right, over: el.querySelector('.modal-b').scrollWidth - el.querySelector('.modal-b').clientWidth }; });
  expect(box.l).toBeGreaterThanOrEqual(0); expect(box.r).toBeGreaterThanOrEqual(0); expect(box.over).toBeLessThanOrEqual(1);
  const stacked = await g.locator('.ev-grid > .ev-box').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(stacked).size).toBe(3);
});
