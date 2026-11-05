import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// hr.js (phase 10, 0046) against a stub IBSupabase with a fixed clock (Thursday 5 Nov 2026, 14:00 Cairo): the HR rows → IBKit.store
// in the prototype's shapes (the members in place, today, the attendance statuses, the requests / overtime / meetings ids and labels,
// the scores by month, the achievements — in IBHR.data, IBKit.store untouched); the writes through the RPCs and the tables, the server's refusals in Arabic, team-admin
// («إضافة عضو» + the pay; the password never logged), the KPIs' weights, the files in the member's folder and the live line.
const src = readFileSync(new URL('../../app/js/adapter/hr.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const ok = (data) => ({ data, error: null });
const NOW = Date.parse('2026-11-05T12:00:00Z'); // 14:00 Cairo (UTC+2 in November)
const clock = (t) => class extends Date { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } };
const A = 'a0000000-0000-4000-8000-000000000001'; const B = 'a0000000-0000-4000-8000-000000000002'; const C = 'a0000000-0000-4000-8000-000000000003';
const cairo = (day, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(Date.parse(day + 'T00:00:00Z') + ((h - 2) * 60 + m) * 60000).toISOString(); };
const MEMBERS = () => [
  { id: 'M01', uid: A, name: 'صفوت كمال', dept: 'الإدارة', title: 'المؤسس', role: 'أدمن', manager: '', status: 'active', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'] },
  { id: 'M02', uid: B, name: 'سارة أحمد', dept: 'العمليات', title: 'مديرة العمليات', role: 'عمليات', manager: 'M01', status: 'active', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'] },
  { id: 'M03', uid: C, name: 'محمد علي', dept: 'العمليات', title: 'تغليف', role: 'خدمة العملاء', manager: 'M01', status: 'active', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'] },
];
const RESPONSES = () => ({
  hr_members: ok([{ member_id: B, shift_start: '09:00:00', shift_end: '17:00:00', hire_date: '2025-05-12', leave_days: 21, notes: null }, { member_id: C, shift_start: '10:00:00', shift_end: '18:00:00', hire_date: null, leave_days: 21, notes: 'ملاحظة' }]),
  hr_pay: ok([{ member_id: B, salary: 12000, holdback: 1500, allowances: 500 }]),
  hr_attendance: ok([
    { id: 1, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '09:02'), out_at: null, remote: false, source: 'clock', note: null, by_id: B },
    { id: 2, member_id: B, day: '2026-11-04', in_at: cairo('2026-11-04', '09:40'), out_at: cairo('2026-11-04', '17:40'), remote: false, source: 'clock', note: null, by_id: B },
    { id: 3, member_id: B, day: '2026-11-03', in_at: cairo('2026-11-03', '09:00'), out_at: cairo('2026-11-03', '18:30'), remote: false, source: 'manual', note: 'نسيت', by_id: A },
    { id: 4, member_id: C, day: '2026-11-04', in_at: cairo('2026-11-04', '10:00'), out_at: null, remote: true, source: 'clock', note: null, by_id: C },
    { id: 5, member_id: C, day: '2026-10-31', in_at: cairo('2026-10-31', '11:00'), out_at: cairo('2026-10-31', '15:00'), remote: false, source: 'manual', note: null, by_id: A },
  ]),
  hr_overtime: ok([
    { id: 12, member_id: B, day: '2026-11-03', start_at: cairo('2026-11-03', '17:00'), end_at: cairo('2026-11-03', '18:30'), minutes: 90, kind: 'hours', note: 'كتالوج', status: 'اتضاف', paid_minutes: 60, decided_by: A, decided_at: '2026-11-04T08:00:00Z', reason: null, created_at: '2026-11-03T16:31:00Z' },
    { id: 13, member_id: C, day: '2026-11-04', start_at: cairo('2026-11-04', '18:00'), end_at: cairo('2026-11-04', '19:00'), minutes: 60, kind: 'hours', note: 'شحن', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: '2026-11-04T09:00:00Z' },
    { id: 14, member_id: C, day: '2026-10-31', start_at: cairo('2026-10-31', '11:00'), end_at: cairo('2026-10-31', '15:00'), minutes: 240, kind: 'rest_day', note: 'جرد', status: 'اتضاف', paid_minutes: 240, decided_by: B, decided_at: '2026-11-01T08:00:00Z', reason: null, created_at: '2026-10-31T13:00:00Z' },
    { id: 15, member_id: B, day: '2026-11-02', start_at: cairo('2026-11-02', '17:00'), end_at: cairo('2026-11-02', '18:00'), minutes: 60, kind: 'hours', note: 'مش متفق', status: 'اترفض', paid_minutes: 0, decided_by: A, decided_at: '2026-11-03T08:00:00Z', reason: 'مش متفق عليه', created_at: '2026-11-02T16:00:00Z' },
  ]),
  hr_requests_v: ok([
    { id: 7, member_id: B, type: 'إجازة سنوية', from_day: '2026-10-20', to_day: '2026-10-22', at_time: null, hours: null, amount: null, months: null, note: 'سر', status: 'موافق', decided_by: A, decided_at: '2026-10-15T08:00:00Z', reason: null, created_by: B, created_at: '2026-10-14T08:00:00Z', doc_path: null },
    { id: 8, member_id: C, type: 'سُلفة', from_day: '2026-11-05', to_day: '2026-11-05', at_time: null, hours: null, amount: null, months: 3, note: null, status: 'موافق', decided_by: A, decided_at: '2026-11-05T09:00:00Z', reason: null, created_by: C, created_at: '2026-11-05T08:10:00Z', doc_path: null },
    { id: 9, member_id: C, type: 'تصحيح انصراف', from_day: '2026-11-04', to_day: '2026-11-04', at_time: '18:15:00', hours: null, amount: null, months: null, note: null, status: 'جديد', decided_by: null, decided_at: null, reason: null, created_by: C, created_at: '2026-11-04T19:30:00Z', doc_path: null },
  ]),
  hr_holidays: ok([{ id: 1, name: 'عيد', day: '2026-11-10', days: 2, kind: 'هجري', status: 'متوقع' }]),
  hr_leave_types: ok([{ name: 'إجازة عارضة', days: '6 أيام', paid: 'نعم', doc: '—', carry: '—', approval: 'المدير المباشر', deducts: true, unpaid: false, sort: 2 },
    { name: 'إجازة سنوية', days: '21 يوم', paid: 'نعم', doc: '—', carry: 'لحد 5 أيام', approval: 'المدير المباشر', deducts: true, unpaid: false, sort: 1 },
    { name: 'إجازة مرضية', days: 'حسب التقرير', paid: 'نعم', doc: 'تقرير طبي إلزامي', carry: '—', approval: 'الأدمن', deducts: false, unpaid: false, sort: 3 }]),
  hr_bonus_rules: ok([{ id: 1, name: 'مكافأة تفوق', cond: 'سكور الربع ≥ 110%', amount: 500, active: true }]),
  hr_ot_periods: ok([]),
  hr_kpis: ok([{ id: 21, member_id: C, name: 'أوردرات', src: 'يدوي', weight: 60, target: 100, inverse: false, sort: 0, active: true }, { id: 22, member_id: C, name: 'أخطاء', src: 'يدوي', weight: 40, target: 2, inverse: true, sort: 1, active: true },
    { id: 23, member_id: C, name: 'قديم', src: 'يدوي', weight: 10, target: 1, inverse: false, sort: 2, active: false }]),
  hr_scores: ok([{ member_id: C, month: '2026-10-01', score: 102, actuals: { 21: 90, 22: 1 }, note: 'كويس', rated_by: A, rated_at: '2026-11-01T08:00:00Z' }]),
  hr_extras: ok([{ id: 31, member_id: B, quarter: '2026-Q4', rule: 'مكافأة تفوق', amount: 500, status: 'مقترحة' }, { id: 32, member_id: C, quarter: '2026-Q4', rule: 'قديمة', amount: 100, status: 'مرفوضة' }]),
  hr_meetings: ok([{ id: 3, member_id: B, reason: 'وقت إضافي اترفض', status: 'اتقفلت', day: '2026-11-04', time_text: '10:00', place: 'المكتب', outcome: 'اتضاف الوقت', plan: null, goals: [], support: null, review_on: null, progress: null, notes: null, ref: 'OT-15', created_at: '2026-11-03T08:00:00Z' },
    { id: 4, member_id: C, reason: 'ربع سيئ', status: 'خطة شغالة', day: '2026-11-01', time_text: '11:00', place: null, outcome: null, plan: '2 أهداف', goals: [{ t: 'هدف', s: 'جاري', how: 'يدوي' }], support: '', review_on: '2026-12-01', progress: 0, notes: '', ref: '2026-Q3', created_at: '2026-11-01T08:00:00Z' }]),
  hr_adjustments: ok([{ id: 41, member_id: B, month: '2026-11-01', amount: -250, label: 'غياب', note: null, kind: 'adjust', voided_at: null }, { id: 42, member_id: C, month: '2026-11-01', amount: 750, label: 'تصوير 120 منتج', note: null, kind: 'achievement', voided_at: null },
    { id: 43, member_id: C, month: '2026-11-01', amount: 99, label: 'اتلغى', note: null, kind: 'adjust', voided_at: '2026-11-02T00:00:00Z' }]),
  hr_payroll: ok([{ month: '2026-10-01', status: 'مدفوع', total: 30000, paid_account: 'حساب البنك' }, { month: '2026-11-01', status: 'مراجعة', total: null, paid_account: null }]),
  hr_documents: ok([{ id: 51, member_id: B, kind: 'عقد عمل', path: B + '/c.pdf', name: 'عقد.pdf', start_on: '2026-01-01', end_on: '2026-11-20', created_at: '2026-01-01T00:00:00Z' }]),
  'rpc:hr_settings': ok({ lateGrace: 30, departments: ['العمليات', 'الإدارة', 'الميديا'] }),
  'rpc:hr_team': ok([{ id: 'a0000000-0000-4000-8000-000000000005', member_code: 'M05', name: 'كريم سامي', title: 'مصوّر', dept: 'الميديا', manager_id: B, status: 'active', role_id: 'cs' }]),
});
function load({ now = NOW, meId = A, meCode = 'M01', responses = {}, perms = { 'hr.view': 'F', 'hr.edit': 'F', 'hr.approve': 'F', 'sensitive.salaries': 'F' }, role = 'admin', realtime = false, accounts = null } = {}) {
  const stub = stubClient({ responses: { ...RESPONSES(), ...responses } });
  const events = []; const logs = []; const store = { members: MEMBERS() };
  const window = { IBSupabase: { client: stub.client }, IB_CONFIG: { realtime }, IBKit: { store },
    IBDirectory: { perm: (k) => perms[k] || 'N', me: () => ({ id: meId, member_code: meCode, name: 'صفوت كمال', role_id: role, status: 'active' }), refresh: async () => { store.members.push({ id: 'M04', uid: 'a0000000-0000-4000-8000-000000000004', name: 'كريم', status: 'active', shift: ['09:00', '17:00'] }); } },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } }, IBAccounts: accounts || undefined,
    crypto: { randomUUID: () => 'abcdef12-0000-4000-8000-000000000000' } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); }, visibilityState: 'visible' }, CustomEvent: class { constructor(t) { this.type = t; } },
    Promise, Date: clock(now), Number, String, Array, Object, JSON, Map, Set, Math, Error, RegExp, Intl, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} });
  return { H: window.IBHR, stub, events, logs, store, window };
}
const rpcs = (stub) => stub.calls.filter((c) => c.op === 'rpc').map((c) => c.args);

test('load: the members in place (the pay, the shift, the leave used this year, the month\'s minutes and overtime, the contract)', async () => {
  const { H, store, events } = load();
  eq((await H.load()).ok, true);
  const s = H.member('M02');
  eq([s.salary, s.holdback, s.allow, s.payKnown, s.shift, s.leave, s.hire], [12000, 1500, 500, true, ['09:00', '17:00'], 21, '2025-05-12']);
  eq(s.used, 3, 'the approved annual leave 20–22 Oct (Tue–Thu)');
  // 5 Nov 09:02 → 14:00 (open) = 298 · 4 Nov 09:40–17:40 = 480 · 3 Nov 09:00–18:30 = 570
  eq(s.monthMin, 298 + 480 + 570); eq(s.otMonth, 60, 'the approved minutes only');
  eq([s.contract, s.contractEnd], ['expiring', '2026-11-20'], 'ends within 30 days');
  const m3 = H.member('M03');
  eq([m3.salary, m3.payKnown, m3.shift, m3.restDays, m3.contract, m3.hrNotes], [0, false, ['10:00', '18:00'], 0, 'missing', 'ملاحظة'], 'the rest day of 31 Oct is last month');
  assert(events.includes('ib:hr'));
  eq(H.state(), 'ready');
  eq([store.members[1].salary, store.members[1].shift], [0, ['09:00', '17:00']], 'IBKit.store.members stays the directory\'s until the blocks move to IBHR');
});

test('load: today (minutes since 00:00 Cairo, the missing end of yesterday, absent after the shift) and the attendance statuses', async () => {
  const { H, store } = load(); await H.load();
  eq(H.data.today.M02, { in: 542, out: null, remote: false, missingYesterday: false });
  eq(H.data.today.M03, { missingYesterday: true }, 'no row today, 4 Nov has no end, the shift (10–18) is not over');
  eq(H.data.today.M01, undefined, 'the admin has no row and the shift (09–17) not over yet at 14:00');
  const st = Object.fromEntries(H.data.attendance.map((a) => [a.id, [a.status, a.type, a.late, a.ot]]));
  eq(st[1], ['حاضر', 'يوم عمل', 0, 0]);
  eq(st[2], ['متأخر 40 د', 'يوم عمل', 40, 0], 'past the 30 minutes of grace in the settings row');
  eq(st[3], ['وقت إضافي اتضاف', 'يوم عمل', 0, 60]);
  eq(st[4], ['انصراف ناقص', 'يوم عمل', 0, 0]);
  eq(st[5], ['شغل يوم راحة', 'راحة أسبوعية', 0, 0], 'a Saturday');
  eq(H.data.attendance.find((a) => a.id === 3).src, 'تسجيل يدوي — صفوت كمال · نسيت');
  eq(H.data.attendance.find((a) => a.id === 4).src, 'تسجيل من السيستم · عن بُعد');
});

test('load: absent after the shift ends; an approved leave wins', async () => {
  const leave = [{ id: 1, member_id: C, type: 'إجازة سنوية', from_day: '2026-11-05', to_day: '2026-11-06', at_time: null, status: 'موافق', created_at: '2026-11-01T08:00:00Z', decided_by: A, decided_at: '2026-11-02T08:00:00Z' }];
  const { H, store } = load({ now: Date.parse('2026-11-05T16:30:00Z'), responses: { hr_attendance: ok([]), hr_requests_v: ok(leave) } }); // 18:30 Cairo
  await H.load();
  eq(H.data.today.M02, { kind: 'absent', missingYesterday: false });
  eq(H.data.today.M03, { kind: 'leave', leaveType: 'إجازة سنوية', missingYesterday: false }, 'the shift (10–18) is over too, the leave wins');
  const fri = load({ now: Date.parse('2026-11-06T16:30:00Z'), responses: { hr_attendance: ok([]), hr_requests_v: ok([]) } }); await fri.H.load();
  eq(fri.H.data.today.M02, { kind: 'off', missingYesterday: false }, 'a Friday');
});

test('load: the requests, overtime and meetings with the prototype\'s ids and labels; restWork; the scores by month; the money', async () => {
  const { H, store } = load(); await H.load();
  const r = H.data.requests.find((x) => x.id === 'HR-0008');
  eq([r.dbId, r.member, r.type, r.status, r.by, r.at, r.startMonth, r.months], [8, 'M03', 'سُلفة', 'موافق', 'صفوت كمال', 'اليوم 10:10', 12, 3], 'decided in November → the installments from December');
  eq(H.data.requests.find((x) => x.id === 'HR-0009').time, '18:15');
  eq(H.data.requests.find((x) => x.id === 'HR-0007').at, '14 أكتوبر');
  const o = H.data.overtime.find((x) => x.id === 'OT-0013');
  eq([o.member, o.date, o.start, o.end, o.minutes, o.status, o.waitedHours], ['M03', '2026-11-04', '18:00', '19:00', 60, 'مستني', 27]);
  eq(H.data.overtime.find((x) => x.id === 'OT-0014').payMonth, null, 'a row without pay_month');
  eq(H.data.overtime.find((x) => x.id === 'OT-0015').status, 'وقت إضافي اترفض', 'the prototype\'s label for a refused one');
  eq(H.data.restWork, [{ member: 'M03', date: '2026-10-31', note: 'جرد', dbId: 14 }]);
  eq(H.data.meetings.map((x) => [x.id, x.member, x.status, x.review]), [['MT-03', 'M02', 'اتقفلت — اتضاف الوقت', '—'], ['MT-04', 'M03', 'اتعمل — خطة شغالة', '2026-12-01']]);
  eq(H.data.scores.M03, { '2026-10': 102 }); eq(H.data.scores.M02, {});
  eq(H.data.scoreRows.M03['2026-10'].actuals, { 21: 90, 22: 1 });
  eq(H.data.kpis.M03.map((k) => [k.id, k.weight, k.target, k.inverse]), [[21, 60, 100, false], [22, 40, 2, true]], 'the active ones');
  eq(H.data.adjustments.map((a) => [a.id, a.member, a.amount, a.kind]), [[41, 'M02', -250, 'adjust'], [42, 'M03', 750, 'achievement']], 'the voided one dropped');
  eq(H.data.achievements, [{ id: 42, member: 'M03', title: 'تصوير 120 منتج', amount: 750, month: '2026-11', date: '2026-11-01', status: 'هتتصرف مع المرتب' }]);
  eq(H.data.extras.map((e) => [e.id, e.status]), [[31, 'مكافأة محتاجة قرار']], 'a refused extra drops out');
  eq(H.data.sheet, { month: '2026-11', status: 'مراجعة', exists: true }); eq(H.data.sheets['2026-10'].status, 'مدفوع');
  eq(H.data.leaveTypes.map((t) => t.name), ['إجازة سنوية', 'إجازة عارضة', 'إجازة مرضية'], 'sorted');
  eq([H.data.hrSettings.lateGrace, H.data.hrSettings.presenceEvery], [30, 120], 'the row over the defaults');
  eq(H.data.departments, ['العمليات', 'الإدارة', 'الميديا']);
  eq(H.data.holidays[0], { dbId: 1, date: '2026-11-10', name: 'عيد', days: 2, kind: 'هجري', status: 'متوقع' });
  eq([H.quarterOf('2026-11'), H.quarterMonths('2026-11')], ['2026-Q4', ['2026-10', '2026-11', '2026-12']]);
});

test('the roster: a member only hr_team() shows (a manager\'s team the profiles hide) joins without contact details; team() follows hr.view', async () => {
  const { H } = load(); await H.load();
  const k = H.member('M05'); eq([k.name, k.dept, k.manager, k.email, k.phone, k.role], ['كريم سامي', 'الميديا', 'M02', '', '', 'خدمة العملاء']);
  eq(H.team().map((m) => m.id), ['M02', 'M03', 'M05'], 'F: everyone active but the admin without pay');
  const mgr = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P' } }); await mgr.H.load();
  eq(mgr.H.team().map((m) => m.id), ['M02', 'M05'], 'P: me + the members I manage');
  const solo = load({ meId: C, meCode: 'M03', role: 'viewer', perms: {} }); await solo.H.load();
  eq(solo.H.team().map((m) => m.id), ['M03'], 'N: me');
});

test('myShift: my open shift within 20 hours, else today\'s, else null (the clock after a refresh or on another device)', async () => {
  const { H } = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P' } }); await H.load();
  eq(H.myShift(), { id: 1, day: '2026-11-05', in_at: cairo('2026-11-05', '09:02'), out_at: null, remote: false });
  const done = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P' }, responses: { hr_attendance: ok([{ id: 9, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '08:00'), out_at: cairo('2026-11-05', '13:00'), remote: true, source: 'clock', note: null, by_id: B }]) } });
  await done.H.load(); eq(done.H.myShift().out_at, cairo('2026-11-05', '13:00'));
  const none = load({ meId: A }); await none.H.load(); eq(none.H.myShift(), null);
});

test('the clock: hr_clock_in / hr_clock_out (the note only when there is one) and the reload; «ended» comes back in Arabic', async () => {
  const { H, stub, logs } = load({ responses: { 'rpc:hr_clock_in': ok({ id: 9, day: '2026-11-05', in_at: '2026-11-05T07:00:00Z', out_at: null, remote: true }), 'rpc:hr_clock_out': ok({ worked: 540, overtime_id: 77, overtime: 60 }) } });
  eq((await H.clockIn(true)).shift.id, 9);
  eq(rpcs(stub).find((x) => x[0] === 'hr_clock_in'), ['hr_clock_in', { p_remote: true }]);
  const r = await H.clockOut('  جهزت   الشحن ');
  eq([r.ok, r.result.overtime], [true, 60]);
  eq(rpcs(stub).find((x) => x[0] === 'hr_clock_out'), ['hr_clock_out', { p_ot_note: 'جهزت الشحن', p_at: null }]);
  eq(logs.map((l) => l[0]), ['hr.shift.start', 'hr.shift.end']);
  assert(!JSON.stringify(logs).includes('جهزت'), 'the note never in the log');
  const ended = load({ responses: { 'rpc:hr_clock_in': { data: null, error: { code: '22023', message: 'invalid: ended' } } } });
  eq(await ended.H.clockIn(false), { ok: false, reason: 'invalid', field: 'ended', message: 'الدوام النهارده اتقفل — التصحيح بيبقى بطلب «تصحيح انصراف»' });
});

test('requests: hr_request_create (another member by uid, mine without), decide / cancel by number; the refusals in Arabic; no note in the log', async () => {
  const { H, stub, logs, store } = load({ responses: { 'rpc:hr_request_create': ok(57), 'rpc:hr_request_decide': (a) => (a.p_decision === 'مرفوض' && !a.p_reason ? { data: null, error: { code: '22023', message: 'invalid: reason' } } : ok(a.p_decision)) } });
  await H.load();
  eq(await H.request({ type: 'إجازة سنوية', from: '2026-12-06', to: '2026-12-07', note: 'فرح أخويا سر' }), { ok: true, id: 'HR-0057' });
  eq(rpcs(stub).find((x) => x[0] === 'hr_request_create')[1].p_input, { type: 'إجازة سنوية', from: '2026-12-06', to: '2026-12-07', time: null, hours: null, amount: null, months: null, note: 'فرح أخويا سر', doc: null });
  await H.request({ member: 'M03', type: 'سُلفة', amount: 1500, months: 3 });
  eq(rpcs(stub).filter((x) => x[0] === 'hr_request_create')[1][1].p_input.member, C);
  eq((await H.decide('HR-0009', 'موافق')).ok, true);
  eq(rpcs(stub).find((x) => x[0] === 'hr_request_decide'), ['hr_request_decide', { p_id: 9, p_decision: 'موافق', p_reason: null }]);
  eq(await H.decide('HR-0009', 'مرفوض'), { ok: false, reason: 'invalid', field: 'reason', message: 'اكتب السبب' });
  assert(!JSON.stringify(logs).includes('فرح') && !JSON.stringify(logs).includes('إجازة سنوية'), 'no note, no type in the log');
  eq(logs.filter((l) => l[0] === 'hr.request.approve').map((l) => l[1]), ['HR-0009']);
  void store;
});

test('overtime: «ضيفه» with fewer minutes / «متضيفهوش» with a reason by number; a stranger gets «مش موجود»', async () => {
  const { H, stub, logs } = load({ responses: { 'rpc:hr_overtime_decide': (a) => (a.p_id === 99 ? { data: null, error: { code: 'P0002', message: 'not found' } } : ok(a.p_decision === 'add' ? 'اتضاف' : 'اترفض')) } });
  await H.load();
  eq((await H.overtimeDecide('OT-0013', 'add', 45)).ok, true);
  eq((await H.overtimeDecide('OT-0013', 'reject', null, 'مش متفق')).ok, true);
  eq(rpcs(stub).filter((x) => x[0] === 'hr_overtime_decide').map((x) => x[1]), [{ p_id: 13, p_decision: 'add', p_minutes: 45, p_reason: null }, { p_id: 13, p_decision: 'reject', p_minutes: null, p_reason: 'مش متفق' }]);
  eq(logs.map((l) => l[1]), ['OT-0013 45د', 'OT-0013']);
  eq((await H.overtimeDecide('OT-0099', 'add')).message, 'مش موجود أو مش متاح ليك');
});

test('the KPIs: weights must add to 100; a row left out is deactivated, a new one inserted; «قيّم الشهر» → hr_rate_month with the actuals by id', async () => {
  const { H, stub, logs } = load({ responses: { 'rpc:hr_rate_month': ok(102) } });
  await H.load();
  eq((await H.saveKpis('M03', [{ id: 21, name: 'أوردرات', weight: 50, target: 100 }])).field, 'weights');
  eq((await H.saveKpis('M03', [{ id: 21, name: 'أوردرات', weight: 70, target: 100 }, { name: 'تقييم المدير', weight: 30, target: 5 }])).ok, true);
  const kq = opsOf(stub.calls, 'hr_kpis');
  assert(kq.some((c) => c.op === 'update' && c.args[0].active === false), 'the row left out (22) deactivated');
  assert(kq.some((c) => c.op === 'insert' && c.args[0].member_id === C && c.args[0].name === 'تقييم المدير' && c.args[0].weight === 30 && c.args[0].active === true));
  const r = await H.rateMonth('M03', '2026-10', { 21: '90', 22: 1 }, 'كويس');
  eq([r.ok, r.score], [true, 102]);
  eq(rpcs(stub).find((x) => x[0] === 'hr_rate_month'), ['hr_rate_month', { p_member: C, p_month: '2026-10-01', p_actuals: { 21: 90, 22: 1 }, p_note: 'كويس' }]);
  eq(logs.map((l) => l[0]), ['hr.kpi.define', 'hr.kpi.rate']);
  assert(!JSON.stringify(logs).includes('102'), 'no score in the log');
  const noEdit = load({ perms: { 'hr.view': 'P' } }); await noEdit.H.load();
  eq((await noEdit.H.saveKpis('M03', [{ name: 'x', weight: 100, target: 1 }])).reason, 'forbidden');
});

test('the payroll: the lines (live / snapshotted), the steps, «مدفوع» from an account of the four (the accounts reloaded)', async () => {
  let reloaded = 0;
  const LINE = { member_id: C, name: 'محمد علي', salary: 9600, holdback: 1000, paid: 8600, ot_minutes: 45, ot_pay: 37.5, rest_days: 1, rest_pay: 800, unpaid_days: 0, unpaid_cut: 0, allowances: 200, deductions: 150, advance: 0, quarter_bonus: 0, net: 9487.5, missing_scores: 0 };
  const { H, stub, logs } = load({ responses: { 'rpc:hr_payroll_calc': ok([LINE]), hr_payroll_lines: ok([{ ...LINE, month: '2026-10-01' }]), 'rpc:hr_payroll_step': ok('معتمد'), 'rpc:hr_payroll_pay': ok(9487.5) }, accounts: { load: () => { reloaded += 1; return Promise.resolve(); } } });
  await H.load();
  const live = await H.sheetLines('2026-11');
  eq(live.lines[0], { member: 'M03', memberUid: C, name: 'محمد علي', salary: 9600, holdback: 1000, paid: 8600, otMin: 45, otPay: 37.5, rest: 1, restPay: 800, unpaidDays: 0, unpaidCut: 0, allow: 200, ded: 150, advance: 0, quarterBonus: 0, net: 9487.5, missingScores: 0 });
  assert(rpcs(stub).some((x) => x[0] === 'hr_payroll_calc' && x[1].p_month === '2026-11-01'), 'a sheet under review is live');
  await H.sheetLines('2026-10');
  assert(opsOf(stub.calls, 'hr_payroll_lines').some((c) => c.op === 'eq' && c.args[1] === '2026-10-01'), 'a paid sheet reads its snapshot');
  eq((await H.payrollStep('2026-11', 'معتمد')).ok, true);
  eq(await H.payrollPay('2026-11', 'خزنة'), { ok: false, reason: 'invalid', field: 'account', message: 'اختار الحساب' });
  eq(await H.payrollPay('2026-11', 'حساب البنك'), { ok: true, total: 9487.5 });
  eq(rpcs(stub).find((x) => x[0] === 'hr_payroll_pay'), ['hr_payroll_pay', { p_month: '2026-11-01', p_account: 'حساب البنك' }]);
  eq(reloaded, 1);
  eq(logs.map((l) => l[0]), ['hr.payroll.approve', 'hr.payroll.paid']);
  assert(!JSON.stringify(logs).includes('9487'), 'no amount in the log');
});

test('adjustments / achievements / extras / meetings through the tables RLS lets the admin write', async () => {
  const { H, stub } = load(); await H.load();
  eq((await H.addAdjustment({ member: 'M03', month: '2026-11', label: 'مكافأة', amount: -5, kind: 'achievement' })).field, 'amount', 'an achievement is an addition');
  eq((await H.addAdjustment({ member: 'M03', month: '2026-11', label: 'تصوير 120 منتج', amount: 750, kind: 'achievement' })).ok, true);
  eq(opsOf(stub.calls, 'hr_adjustments').find((c) => c.op === 'insert').args[0], { member_id: C, month: '2026-11-01', amount: 750, label: 'تصوير 120 منتج', note: null, kind: 'achievement' });
  await H.decideExtra(31, true);
  eq(opsOf(stub.calls, 'hr_extras').find((c) => c.op === 'update').args[0].status, 'معتمدة');
  eq((await H.meetingUpdate('MT-04', { status: 'غلط' })).field, 'status');
  await H.meetingUpdate('MT-04', { status: 'اتقفلت', outcome: 'اتحسّن', goals: [{ t: 'هدف', s: 'اتحقق' }], progress: 100 });
  const up = opsOf(stub.calls, 'hr_meetings').find((c) => c.op === 'update');
  eq(up.args[0], { status: 'اتقفلت', outcome: 'اتحسّن', goals: [{ t: 'هدف', s: 'اتحقق', how: 'يدوي' }], progress: 100 });
  await H.meetingCreate({ member: 'M02', reason: 'متابعة', status: 'اتحدد ميعاد', date: '2026-11-08', time: '10:00', place: 'المكتب' });
  eq(opsOf(stub.calls, 'hr_meetings').find((c) => c.op === 'insert').args[0], { member_id: B, status: 'اتحدد ميعاد', reason: 'متابعة', day: '2026-11-08', time_text: '10:00', place: 'المكتب' });
});

test('the settings row «hr» (the admin): merged over what is there; a member is refused; a department added once', async () => {
  const { H, stub } = load(); await H.load();
  eq((await H.saveSettings({ lateGrace: 10, nope: 1 })).ok, true);
  eq(opsOf(stub.calls, 'settings').find((c) => c.op === 'upsert').args[0], { section: 'hr', data: { lateGrace: 10, departments: ['العمليات', 'الإدارة', 'الميديا'] } });
  eq((await H.addDepartment('العمليات')).reason, 'exists');
  const mem = load({ role: 'ops', perms: { 'hr.view': 'P' } }); await mem.H.load();
  eq((await mem.H.saveSettings({ lateGrace: 5 })).reason, 'forbidden');
});

test('«إضافة عضو»: team-admin (the login, the code, the password once) then the pay; a taken email in Arabic; a member is refused; no password in the log', async () => {
  const fn = (o) => (o.body.email === 'taken@ibtekr.club' ? { data: null, error: { context: { status: 409, json: async () => ({ error: 'exists', field: 'email' }) } } } : ok({ ok: true, id: 'a0000000-0000-4000-8000-000000000004', member_code: 'M04', password: 'Xy7kP2mQ9wRt' }));
  const { H, stub, logs, store } = load({ responses: { 'fn:team-admin': fn } });
  await H.load();
  const r = await H.memberCreate({ name: 'كريم', email: 'karim@ibtekr.club', phone: '01012345678', role: 'cs', manager: 'M02', shiftStart: '10:00', shiftEnd: '18:00', hire: '2026-11-01', salary: 8000, holdback: 1000, allow: 300 });
  eq([r.ok, r.code, r.password, r.payOk], [true, 'M04', 'Xy7kP2mQ9wRt', true]);
  const inv = stub.calls.find((c) => c.op === 'invoke'); eq(inv.args[0], 'team-admin');
  eq(inv.args[1].body, { action: 'member_create', name: 'كريم', email: 'karim@ibtekr.club', phone: '01012345678', role: 'cs', title: '', dept: '', manager_id: B, shift_start: '10:00', shift_end: '18:00', hire_date: '2026-11-01' });
  eq(opsOf(stub.calls, 'hr_pay').find((c) => c.op === 'upsert').args[0], { member_id: 'a0000000-0000-4000-8000-000000000004', salary: 8000, holdback: 1000, allowances: 300 });
  assert(store.members.some((m) => m.id === 'M04'), 'the directory refreshed');
  assert(!JSON.stringify(logs).includes('Xy7kP2mQ9wRt'), 'the password never logged');
  eq(await H.memberCreate({ name: 'x', email: 'taken@ibtekr.club', role: 'cs' }), { ok: false, reason: 'exists', field: 'email', message: 'الإيميل ده مستخدم' });
  const mem = load({ role: 'ops', perms: { 'hr.view': 'P' } }); await mem.H.load();
  eq((await mem.H.memberCreate({ name: 'x', email: 'x@y.co', role: 'cs' })).reason, 'forbidden');
  eq(mem.stub.calls.filter((c) => c.op === 'invoke').length, 0);
});

test('files: images / PDF ≤ 10 MB into the member\'s own folder of «hr-docs»; the document row; a signed link kept 9 minutes', async () => {
  const { H, stub } = load({ responses: { 'storage:hr-docs:createSignedUrl': ok({ signedUrl: 'https://x/sign' }) } });
  await H.load();
  eq((await H.upload({ name: 'a.exe', type: 'application/x-msdownload', size: 10 }, 'M02')).field, 'type');
  eq((await H.upload({ name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }, 'M02')).field, 'size');
  const up = await H.upload({ name: 'عقد عمل.PDF', type: 'application/pdf', size: 2048 }, 'M02');
  eq(up, { ok: true, path: B + '/abcdef12-file.pdf', name: 'عقد عمل.PDF' });
  eq(stub.calls.find((c) => c.table === 'storage:hr-docs' && c.op === 'upload').args[0], B + '/abcdef12-file.pdf');
  eq((await H.addDocument('M02', { kind: 'عقد عمل', path: up.path, name: up.name, start: '2026-01-01', end: '2026-12-31' })).ok, true);
  eq(opsOf(stub.calls, 'hr_documents').find((c) => c.op === 'insert').args[0], { member_id: B, kind: 'عقد عمل', path: B + '/abcdef12-file.pdf', name: 'عقد عمل.PDF', start_on: '2026-01-01', end_on: '2026-12-31' });
  eq((await H.addDocument('M02', { kind: 'جواز سفر', path: up.path, name: 'x' })).reason, 'invalid');
  eq([await H.fileUrl(up.path), await H.fileUrl(up.path)], ['https://x/sign', 'https://x/sign']);
  eq(stub.calls.filter((c) => c.op === 'createSignedUrl').length, 1);
});

test('the attendance by hand (hr.edit F): the day in Cairo times; «إنهاء الدوام» for another member closes their open day at now', async () => {
  const { H, stub } = load({ responses: { 'rpc:hr_attendance_set': ok(1) } });
  await H.load();
  await H.setAttendance('M03', '2026-11-04', '10:00', '18:15', { note: 'نسي' });
  eq(rpcs(stub).find((x) => x[0] === 'hr_attendance_set'), ['hr_attendance_set', { p_member: C, p_day: '2026-11-04', p_in: '10:00', p_out: '18:15', p_remote: false, p_note: 'نسي' }]);
  await H.endShiftFor('M02');
  eq(rpcs(stub).filter((x) => x[0] === 'hr_attendance_set')[1][1], { p_member: B, p_day: '2026-11-05', p_in: '09:02', p_out: '14:00', p_remote: false, p_note: 'إنهاء الدوام — صفوت كمال' });
  eq((await H.endShiftFor('M01')).field, 'shift', 'no open day');
});

test('live: the private channel «hr» → one load; clear() forgets the rows and unsubscribes', async () => {
  const { H, stub, store } = load({ realtime: true });
  await H.load();
  const ch = stub.calls.find((c) => c.op === 'channel'); eq(ch.args, ['hr', { config: { private: true } }]);
  const before = opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length;
  await stub.emitBroadcast('changed', { at: 'x' }); await new Promise((r) => setTimeout(r, 300));
  eq(opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length, before + 1);
  H.clear();
  eq([H.data.requests, H.data.attendance, H.data.today, H.data.kpis, H.data.sheet.status, H.state()], [[], [], {}, {}, 'مسودة', 'idle']);
  assert(stub.calls.some((c) => c.op === 'removeChannel'));
});
