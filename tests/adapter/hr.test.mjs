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
  hr_members: ok([{ member_id: B, shift_start: '09:00:00', shift_end: '17:00:00', hire_date: '2025-05-12', leave_days: 21 }, { member_id: C, shift_start: '10:00:00', shift_end: '18:00:00', hire_date: null, leave_days: 21 }]),
  'rpc:hr_member_notes': ok([{ member_id: C, notes: 'ملاحظة' }]), // the notes column is closed: hr.edit F reads them here
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
  eq(H.data.today.M02, { in: 542, out: null, mins: 0, openIn: 542, sessions: 1, remote: false, missingYesterday: false });
  eq(H.data.today.M03, { missingYesterday: true }, 'no row today, 4 Nov has no end, the shift (10–18) is not over');
  eq(H.data.today.M01, undefined, 'the admin has no row and the shift (09–17) not over yet at 14:00');
  const st = Object.fromEntries(H.data.attendance.map((a) => [a.id, [a.status, a.type, a.late, a.ot]]));
  eq(st[1], ['حاضر', 'يوم عمل', 0, 0]);
  eq(st[2], ['منتظم', 'يوم عمل', 0, 0], 'decision 24: flexible hours — a 09:40 start is not late');
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
  eq(H.myShift(), { id: 1, day: '2026-11-05', in_at: cairo('2026-11-05', '09:02'), out_at: null, remote: false, done: 0, sessions: 1, ot_from: null, ot_ticket: null });
  const done = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P' }, responses: { hr_attendance: ok([{ id: 9, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '08:00'), out_at: cairo('2026-11-05', '13:00'), remote: true, source: 'clock', note: null, by_id: B }]) } });
  await done.H.load(); eq(done.H.myShift().out_at, cairo('2026-11-05', '13:00'));
  const none = load({ meId: A }); await none.H.load(); eq(none.H.myShift(), null);
});

test('the clock: hr_clock_in / hr_clock_out (the note only when there is one) and the reload; «ended» comes back in Arabic', async () => {
  const { H, stub, logs } = load({ responses: { 'rpc:hr_clock_in': ok({ id: 9, day: '2026-11-05', in_at: '2026-11-05T07:00:00Z', out_at: null, remote: true }), 'rpc:hr_clock_out': ok({ worked: 540, overtime_id: 77, overtime: 60 }) } });
  eq((await H.clockIn(true)).shift.id, 9); // a stray argument never reaches the server: «عن بُعد» is the server's (an approved «شغل عن بُعد»)
  eq(rpcs(stub).find((x) => x[0] === 'hr_clock_in'), ['hr_clock_in', {}]);
  eq(logs[0].slice(0, 2), ['hr.shift.start', 'عن بُعد']); // the detail from the server's answer
  const r = await H.clockOut('  جهزت   الشحن ');
  eq([r.ok, r.result.overtime], [true, 60]);
  eq(rpcs(stub).find((x) => x[0] === 'hr_clock_out'), ['hr_clock_out', { p_ot_note: 'جهزت الشحن', p_at: null }]);
  eq(logs.map((l) => l[0]), ['hr.shift.start', 'hr.shift.end']);
  assert(!JSON.stringify(logs).includes('جهزت'), 'the note never in the log');
  const bad = load({ responses: { 'rpc:hr_clock_out': { data: null, error: { code: '22023', message: 'invalid: at' } } } });
  eq(await bad.H.clockOut(null, Date.now()), { ok: false, reason: 'invalid', field: 'at', message: 'راجع وقت الانصراف' });
});

test('requests: hr_request_create (another member by uid, mine without), decide / cancel by number; the refusals in Arabic; no note in the log', async () => {
  const { H, stub, logs, store } = load({ responses: { 'rpc:hr_request_create': ok(57), 'rpc:hr_request_decide': (a) => (a.p_decision === 'مرفوض' && !a.p_reason ? { data: null, error: { code: '22023', message: 'invalid: reason' } } : ok(a.p_decision)) } });
  await H.load();
  eq(await H.request({ type: 'إجازة سنوية', from: '2026-12-06', to: '2026-12-07', note: 'فرح أخويا سر' }), { ok: true, id: 'HR-0057', ticket: null }); // decision 33: the request's ticket (the fake list has none)
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
  eq(live.lines[0], { member: 'M03', memberUid: C, name: 'محمد علي', salary: 9600, holdback: 1000, paid: 8600, otMin: 45, otPay: 37.5, rest: 1, restPay: 800, unpaidDays: 0, unpaidCut: 0, allow: 200, ded: 150, advance: 0, quarterBonus: 0, net: 9487.5, missingScores: 0, leaveDays: 0, leavePay: 0, transfer: null });
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

test('«ملفي › مرتبي» (T7): my payslips through hr_my_slips with the sheet\'s status; another member\'s from the lines with the statuses I read', async () => {
  const LINE = { name: 'محمد علي', salary: 9600, holdback: 1000, paid: 8600, ot_minutes: 0, ot_pay: 0, rest_days: 0, rest_pay: 0, unpaid_days: 0, unpaid_cut: 0, allowances: 200, deductions: 0, advance: 0, quarter_bonus: 0, net: 8800 };
  const mine = load({ meId: C, meCode: 'M03', role: 'ops', perms: { 'hr.view': 'N' }, responses: { 'rpc:hr_my_slips': ok([{ ...LINE, month: '2026-10-01', status: 'مدفوع', paid_at: '2026-11-01T10:00:00Z' }]) } });
  await mine.H.load();
  const r = await mine.H.slips('M03');
  eq([r.ok, r.list.length, r.list[0].month, r.list[0].status, r.list[0].paidAt, r.list[0].net, r.list[0].member], [true, 1, '2026-10', 'مدفوع', '2026-11-01T10:00:00Z', 8800, 'M03']);
  eq(rpcs(mine.stub).find((x) => x[0] === 'hr_my_slips'), ['hr_my_slips', {}]);
  assert(!opsOf(mine.stub.calls, 'hr_payroll_lines').length, 'mine never reads the lines table (no status there)');
  const adm = load({ responses: { hr_payroll_lines: ok([{ ...LINE, member_id: C, month: '2026-10-01' }]) } });
  await adm.H.load();
  const o = await adm.H.slips('M03');
  eq([o.ok, o.list[0].month, o.list[0].status, o.list[0].net], [true, '2026-10', 'مدفوع', 8800]);
  assert(opsOf(adm.stub.calls, 'hr_payroll_lines').some((c) => c.op === 'eq' && c.args[0] === 'member_id' && c.args[1] === C), 'the member\'s lines by uid');
  eq((await adm.H.slips('M77')).ok, false);
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
  eq((await H.saveSettings({ escalate: 12, nope: 1 })).ok, true);
  eq(opsOf(stub.calls, 'settings').find((c) => c.op === 'upsert').args[0].data.escalate, 12);
  eq(opsOf(stub.calls, 'settings').find((c) => c.op === 'upsert').args[0].data.nope, undefined);
  eq((await H.addDepartment('العمليات')).reason, 'exists');
  const mem = load({ role: 'ops', perms: { 'hr.view': 'P' } }); await mem.H.load();
  eq((await mem.H.saveSettings({ escalate: 5 })).reason, 'forbidden');
});

test('«إضافة عضو»: team-admin (the login, the code, the password once) then the pay; a taken email in Arabic; a member is refused; no password in the log', async () => {
  const fn = (o) => (o.body.email === 'taken@ibtekr.club' ? { data: null, error: { context: { status: 409, json: async () => ({ error: 'exists', field: 'email' }) } } } : ok({ ok: true, id: 'a0000000-0000-4000-8000-000000000004', member_code: 'M04', password: 'Xy7kP2mQ9wRt' }));
  const { H, stub, logs, store } = load({ responses: { 'fn:team-admin': fn } });
  await H.load();
  const r = await H.memberCreate({ name: 'كريم', email: 'karim@ibtekr.club', phone: '01012345678', role: 'cs', manager: 'M02', shiftStart: '10:00', shiftEnd: '18:00', hire: '2026-11-01', salary: 8000, holdback: 1000, allow: 300 });
  eq([r.ok, r.code, r.password, r.payOk, r.mailed], [true, 'M04', 'Xy7kP2mQ9wRt', true, false]);
  const inv = stub.calls.find((c) => c.op === 'invoke'); eq(inv.args[0], 'team-admin');
  eq(inv.args[1].body, { action: 'member_create', name: 'كريم', email: 'karim@ibtekr.club', phone: '01012345678', role: 'cs', title: '', dept: '', manager_id: B, shift_start: '10:00', shift_end: '18:00', hire_date: '2026-11-01' });
  eq(opsOf(stub.calls, 'hr_pay').find((c) => c.op === 'upsert').args[0], { member_id: 'a0000000-0000-4000-8000-000000000004', salary: 8000, holdback: 1000, allowances: 300 });
  assert(store.members.some((m) => m.id === 'M04'), 'the directory refreshed');
  assert(!JSON.stringify(logs).includes('Xy7kP2mQ9wRt'), 'the password never logged');
  eq(await H.memberCreate({ name: 'x', email: 'taken@ibtekr.club', role: 'cs' }), { ok: false, reason: 'exists', field: 'email', code: 'exists', status: 409, raw: { error: 'exists', field: 'email' }, message: 'الإيميل ده مستخدم' });
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

test('the attendance by hand (hr.edit F): the day in Cairo times; «إنهاء الدوام» for another member closes their open session at now', async () => {
  const { H, stub } = load({ responses: { 'rpc:hr_attendance_set': ok(1), 'rpc:hr_attendance_close': ok(1) } });
  await H.load();
  await H.setAttendance('M03', '2026-11-04', '10:00', '18:15', { note: 'نسي' });
  eq(rpcs(stub).find((x) => x[0] === 'hr_attendance_set'), ['hr_attendance_set', { p_member: C, p_day: '2026-11-04', p_in: '10:00', p_out: '18:15', p_remote: false, p_note: 'نسي' }]);
  await H.endShiftFor('M02');
  eq(rpcs(stub).find((x) => x[0] === 'hr_attendance_close'), ['hr_attendance_close', { p_id: 1, p_out: null, p_note: 'إنهاء الدوام — صفوت كمال' }], 'decision 24: that session only, not the whole day');
  eq((await H.endShiftFor('M01')).field, 'shift', 'no open day');
});

test('live: the private channel «hr» → one load; clear() forgets the rows and unsubscribes', async () => {
  const { H, stub, store } = load({ realtime: true });
  await H.load();
  const ch = stub.calls.find((c) => c.op === 'channel'); eq(ch.args, ['hr', { config: { private: true } }]);
  const before = opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length;
  await stub.emitBroadcast('changed', { at: 'x' }); await new Promise((r) => setTimeout(r, 300));
  eq(opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length, before * 2, 'one more load (two reads of hr_members a load: the rows and the leave carried — 0083)');
  H.clear();
  eq([H.data.requests, H.data.attendance, H.data.today, H.data.kpis, H.data.sheet.status, H.state()], [[], [], {}, {}, 'مسودة', 'idle']);
  assert(stub.calls.some((c) => c.op === 'removeChannel'));
});

test('the internal notes (security review 5 Nov): read through hr_member_notes for hr.edit F only, written through hr_member_note_set — never the hr_members column', async () => {
  const { H, stub } = load({ responses: { 'rpc:hr_member_notes': ok([{ member_id: C, notes: 'ممتازة في الشحن' }]) } }); await H.load();
  eq(H.data.team.find((m) => m.id === 'M03').hrNotes, 'ممتازة في الشحن');
  eq(H.data.team.find((m) => m.id === 'M02').hrNotes, '');
  const sels = opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').map((c) => String(c.args[0]));
  eq(sels.length > 0 && sels.every((x) => !/notes|\*/.test(x)), true, 'the column is never asked for');
  eq((await H.memberUpdate('M03', { notes: '  ملاحظة   جديدة ' })).ok, true);
  eq(rpcs(stub).find((x) => x[0] === 'hr_member_note_set'), ['hr_member_note_set', { p_member: C, p_notes: 'ملاحظة جديدة' }]);
  eq(opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'upsert').length, 0, 'a note alone writes no hr_members row');
  await H.memberUpdate('M03', { notes: '' });
  eq(rpcs(stub).filter((x) => x[0] === 'hr_member_note_set').pop(), ['hr_member_note_set', { p_member: C, p_notes: null }]);
  await H.memberUpdate('M03', { shift: ['10:00', '18:00'] });
  eq(opsOf(stub.calls, 'hr_members').find((c) => c.op === 'upsert').args[0], { member_id: C, shift_start: '10:00', shift_end: '18:00' });
  // the server's refusal comes back in Arabic
  const refused = load({ responses: { 'rpc:hr_member_note_set': { data: null, error: { code: '42501', message: 'not allowed' } } } }); await refused.H.load();
  eq((await refused.H.memberUpdate('M03', { notes: 'x' })).reason, 'forbidden');
  // a member without hr.edit never asks for the notes
  const member = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P', 'hr.edit': 'N', 'hr.approve': 'N', 'sensitive.salaries': 'N' } }); await member.H.load();
  eq(rpcs(member.stub).some((x) => x[0] === 'hr_member_notes'), false);
});

// ---------- «ملفي › مهامي» (decision 25, 0048) ----------
const TASK = (x) => ({ id: 1, member_id: C, title: 'مهمة', status: 'لسه', day: '2026-11-05', reason: null, reviewer_id: null, until: null, review_note: null, done_at: null, created_by: C, created_at: '2026-11-05T08:00:00Z', ...x });
const PEOPLE = () => ok([{ id: A, member_code: 'M01', name: 'صفوت كمال' }, { id: B, member_code: 'M02', name: 'سارة أحمد' }, { id: C, member_code: 'M03', name: 'محمد علي' },
  { id: 'a0000000-0000-4000-8000-000000000009', member_code: 'M09', name: 'زميل برّه الفريق' }]);
const TASKS = (open, done = []) => ({ hr_tasks: (q) => ok(q.some((c) => c.op === 'neq') ? open : q.some((c) => c.op === 'eq' && c.args[1] === 'خلصت') ? done : []), 'rpc:hr_task_people': PEOPLE() });

test('tasks: the open ones and the ones done in the last 90 days, the names from hr_task_people (a reviewer outside my team too), the day a task was done in Cairo', async () => {
  const { H, stub } = load({ responses: TASKS([TASK({ id: 3, status: 'جاهزة للمراجعة', reviewer_id: 'a0000000-0000-4000-8000-000000000009', created_by: B }), TASK({ id: 2, status: 'متوقفة', reason: 'مستني رد' })],
    [TASK({ id: 4, status: 'خلصت', done_at: '2026-11-04T22:30:00Z' })]) });
  eq((await H.load()).ok, true);
  eq(H.data.tasks.map((t) => [t.id, t.member, t.memberName, t.status]), [[2, 'M03', 'محمد علي', 'متوقفة'], [3, 'M03', 'محمد علي', 'جاهزة للمراجعة'], [4, 'M03', 'محمد علي', 'خلصت']]);
  const t3 = H.data.tasks.find((t) => t.id === 3); eq([t3.reviewer, t3.reviewerUid, t3.by, t3.byUid], ['زميل برّه الفريق', 'a0000000-0000-4000-8000-000000000009', 'سارة أحمد', B]);
  eq(H.data.tasks.find((t) => t.id === 4).doneDay, '2026-11-05', '22:30 UTC = 00:30 Cairo the next day');
  eq(H.data.tasks.find((t) => t.id === 2).reason, 'مستني رد');
  eq(H.people().map((p) => p.code), ['M01', 'M02', 'M03', 'M09']);
  const q = opsOf(stub.calls, 'hr_tasks'); const sels = q.filter((c) => c.op === 'select').map((c) => c.args[0]);
  eq(sels.length, 2); eq(sels.every((x) => !/\*/.test(x) && !/deleted/.test(x)), true, 'named columns, never the delete marks');
  eq(q.find((c) => c.op === 'neq').args, ['status', 'خلصت']); eq(q.find((c) => c.op === 'gte').args, ['done_at', '2026-08-07'], 'the last 90 days');
  eq(H.tasksOf('M03').length, 3); eq(H.reviewsFor('a0000000-0000-4000-8000-000000000009').map((t) => t.id), [3]);
});

test('tasks: before 0048 is applied the table is missing — HR still loads with no tasks', async () => {
  const { H } = load({ responses: { hr_tasks: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }, 'rpc:hr_task_people': { data: null, error: { code: 'PGRST202', message: 'no function' } } } });
  eq((await H.load()).ok, true); eq([H.data.tasks, H.people()], [[], []]); eq(H.member('M02').salary, 12000);
  const down = load({ responses: { hr_tasks: { data: null, error: { code: '08006', message: 'connection' } } } });
  eq((await down.H.load()).ok, false, 'any other failure is a failed load (the rows on screen stay)');
});

test('tasks: «ضيف مهمة» shows at once, then the server\'s row; the RPC gets the member and the cleaned title; the log has the member\'s code, never the title', async () => {
  let rows = [];
  const { H, stub, logs } = load({ meId: C, meCode: 'M03', role: 'cs', perms: { 'hr.view': 'N' }, responses: { hr_tasks: (q) => ok(q.some((c) => c.op === 'neq') ? rows : []), 'rpc:hr_task_people': PEOPLE(),
    'rpc:hr_task_add': (a) => { rows = [TASK({ id: 77, title: a.p_title })]; return ok(77); } } });
  await H.load();
  const p = H.taskAdd('M03', '  مكالمة\u0007 شركة   الشحن <b>  ');
  eq(H.data.tasks.map((t) => [t.id < 0, t.title, t.status, t.day, t.pending]), [[true, 'مكالمة شركة الشحن b', 'لسه', '2026-11-05', true]], 'the row shows before the server answers');
  eq((await p), { ok: true, id: 77 });
  eq(rpcs(stub).find((x) => x[0] === 'hr_task_add'), ['hr_task_add', { p_member: C, p_title: 'مكالمة شركة الشحن b' }]);
  eq(H.data.tasks.map((t) => [t.id, t.title]), [[77, 'مكالمة شركة الشحن b']]);
  eq(logs.find((l) => l[0] === 'hr.task.add'), ['hr.task.add', 'M03', { entity: 'hr', entity_id: '77' }]);
  eq(JSON.stringify(logs).includes('مكالمة'), false);
  eq((await H.taskAdd('M03', '   ')).field, 'title');
  // a refusal takes the row back, in Arabic
  const ref = load({ meId: C, meCode: 'M03', role: 'cs', perms: { 'hr.view': 'N' }, responses: { ...TASKS([]), 'rpc:hr_task_add': { data: null, error: { code: '22023', message: 'invalid: count' } } } }); await ref.H.load();
  const r = await ref.H.taskAdd(null, 'زيادة'); eq([r.ok, r.field, r.message], [false, 'count', 'فيه 300 مهمة مفتوحة — خلّص أو امسح شوية الأول']); eq(ref.H.data.tasks, []);
});

test('tasks: a status with its fields — the reason, the reviewer by name → uid, a day or «لأجل غير مسمى»; the row changes at once and goes back on a refusal', async () => {
  const { H, stub, logs } = load({ responses: { ...TASKS([TASK({ id: 5, day: '2026-11-02' })]), 'rpc:hr_task_set': (a) => (a.p_status === 'جاري' ? { data: null, error: { code: '42501', message: 'not allowed' } } : ok(a.p_status)) } });
  await H.load();
  const p = H.taskSet(5, 'متوقفة', { reason: '  مستني  المحامي ' });
  eq((await p).ok, true);
  eq(rpcs(stub).find((x) => x[0] === 'hr_task_set'), ['hr_task_set', { p_id: 5, p_status: 'متوقفة', p_args: { reason: 'مستني المحامي' } }]);
  await H.taskSet(5, 'جاهزة للمراجعة', { reviewer: 'زميل برّه الفريق' });
  eq(rpcs(stub).filter((x) => x[0] === 'hr_task_set').pop()[1].p_args, { reviewer: 'a0000000-0000-4000-8000-000000000009' });
  await H.taskSet(5, 'اتأجلت', { until: '2026-11-09' }); eq(rpcs(stub).filter((x) => x[0] === 'hr_task_set').pop()[1].p_args, { until: '2026-11-09' });
  await H.taskSet(5, 'اتأجلت', { indefinite: true }); eq(rpcs(stub).filter((x) => x[0] === 'hr_task_set').pop()[1].p_args, { indefinite: true });
  eq([(await H.taskSet(5, 'متوقفة', {})).field, (await H.taskSet(5, 'جاهزة للمراجعة', { reviewer: 'مش موجود' })).field, (await H.taskSet(5, 'اتأجلت', {})).field, (await H.taskSet(5, 'مش حالة')).field],
    ['reason', 'reviewer', 'until', 'status'], 'checked before any call');
  eq(logs.filter((l) => l[0] === 'hr.task.status').map((l) => l[1]), ['متوقفة', 'جاهزة للمراجعة', 'اتأجلت', 'اتأجلت'], 'the status only');
  // optimistic: the row is today's and «جاري» right away; the refusal puts it back
  const t = H.data.tasks.find((x) => x.id === 5); const was = t.status;
  const q = H.taskSet(5, 'جاري'); eq([H.data.tasks.find((x) => x.id === 5).status, H.data.tasks.find((x) => x.id === 5).day], ['جاري', '2026-11-05']);
  const r = await q; eq([r.ok, r.reason, r.message], [false, 'forbidden', 'مفيش صلاحية للإجراء ده']); eq(H.data.tasks.find((x) => x.id === 5).status, was);
});

test('tasks: a click on a task added a moment ago waits for its real id; «حذف» and the review go through their RPCs', async () => {
  let rows = [TASK({ id: 9, created_by: A, member_id: C })]; let release;
  const gate = new Promise((r) => { release = r; });
  const { H, stub, logs } = load({ responses: { hr_tasks: (q) => ok(q.some((c) => c.op === 'neq') ? rows : []), 'rpc:hr_task_people': PEOPLE(),
    'rpc:hr_task_add': async () => { await gate; rows = rows.concat([TASK({ id: 10, title: 'جديدة', member_id: A, created_by: A })]); return ok(10); },
    'rpc:hr_task_set': (a) => ok(a.p_status), 'rpc:hr_task_delete': ok(null), 'rpc:hr_task_review': (a) => ok(a.p_ok ? 'خلصت' : 'جاري') } });
  await H.load();
  const add = H.taskAdd('M01', 'جديدة'); const tmp = H.data.tasks.find((t) => t.pending).id;
  const set = H.taskSet(tmp, 'خلصت'); release(); await add; eq((await set).ok, true);
  eq(rpcs(stub).find((x) => x[0] === 'hr_task_set')[1].p_id, 10, 'the real id');
  eq((await H.taskDelete(9)).ok, true); eq(rpcs(stub).find((x) => x[0] === 'hr_task_delete'), ['hr_task_delete', { p_id: 9 }]);
  eq((await H.taskReview(9, false, '  ')).field, 'note', '«رجّعها» needs a note');
  eq((await H.taskReview(9, false, 'ناقص صورة')).ok, true); eq(rpcs(stub).find((x) => x[0] === 'hr_task_review'), ['hr_task_review', { p_id: 9, p_ok: false, p_note: 'ناقص صورة' }]);
  await H.taskReview(9, true); eq(rpcs(stub).filter((x) => x[0] === 'hr_task_review').pop(), ['hr_task_review', { p_id: 9, p_ok: true, p_note: null }]);
  eq(logs.filter((l) => /^hr\.task\.(delete|review)$/.test(l[0])).map((l) => [l[0], l[1]]), [['hr.task.delete', ''], ['hr.task.review', 'back'], ['hr.task.review', 'ok']]);
});

test('tasks: who writes them (the member, the direct manager, hr.edit F) and who removes one (not the member, when someone else put it)', async () => {
  const rows = [TASK({ id: 1, member_id: C, created_by: C }), TASK({ id: 2, member_id: C, created_by: B })];
  const mgr = load({ meId: A, meCode: 'M01', role: 'ops', perms: { 'hr.view': 'P', 'hr.edit': 'N' }, responses: TASKS(rows) }); await mgr.H.load();
  eq([mgr.H.canTask('M01'), mgr.H.canTask('M03'), mgr.H.canTask('M05')], [true, true, false], 'M03 reports to M01; M05 (hr_team) reports to M02');
  const own = load({ meId: C, meCode: 'M03', role: 'cs', perms: { 'hr.view': 'N' }, responses: TASKS(rows) }); await own.H.load();
  eq([own.H.canTask('M03'), own.H.canTask('M02')], [true, false]);
  eq([own.H.canDeleteTask(own.H.data.tasks[0]), own.H.canDeleteTask(own.H.data.tasks[1])], [true, false], 'the one the manager put stays');
  const adm = load({ responses: TASKS(rows) }); await adm.H.load();
  eq([adm.H.canTask('M02'), adm.H.canTask('M05'), adm.H.canDeleteTask(adm.H.data.tasks[1])], [true, true, true], 'hr.edit F on the members they see');
});

test('tasks: the live line «hr» / «tasks» reloads the tasks alone — not the whole HR load', async () => {
  const { H, stub } = load({ realtime: true, responses: TASKS([TASK({})]) }); await H.load();
  const before = opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length; const tb = opsOf(stub.calls, 'hr_tasks').filter((c) => c.op === 'select').length;
  await stub.emitBroadcast('tasks', { at: 'x' }); await new Promise((r) => setTimeout(r, 500));
  eq(opsOf(stub.calls, 'hr_members').filter((c) => c.op === 'select').length, before);
  eq(opsOf(stub.calls, 'hr_tasks').filter((c) => c.op === 'select').length, tb + 2);
  H.clear(); eq([H.data.tasks, H.people()], [[], []]);
});

// phase 13 decision 24 (0068): several sessions a day — the day is their sum, no lateness; my session carries the day's other closed minutes;
// «تصحيح انصراف ناقص» sets the end of the open session only (after the request, if any, was approved)
test('flexible hours: a day of several sessions is one day (first in, last out, the minutes summed); myShift adds the closed ones; fixOut on the open session', async () => {
  const day = [
    { id: 21, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '07:00'), out_at: cairo('2026-11-05', '09:30'), remote: false, source: 'clock', note: null, by_id: B },
    { id: 22, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '11:00'), out_at: cairo('2026-11-05', '12:30'), remote: false, source: 'clock', note: null, by_id: B },
    { id: 23, member_id: B, day: '2026-11-05', in_at: cairo('2026-11-05', '13:00'), out_at: null, remote: false, source: 'clock', note: null, by_id: B },
    { id: 31, member_id: C, day: '2026-11-04', in_at: cairo('2026-11-04', '12:00'), out_at: cairo('2026-11-04', '14:00'), remote: false, source: 'clock', note: null, by_id: C },
    { id: 32, member_id: C, day: '2026-11-04', in_at: cairo('2026-11-04', '16:00'), out_at: null, remote: false, source: 'clock', note: null, by_id: C },
  ];
  const { H, stub } = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'F', 'hr.edit': 'F' }, responses: { hr_attendance: ok(day), 'rpc:hr_attendance_close': ok(32) } });
  await H.load();
  const b = H.data.attendance.find((a) => a.member === 'M02');
  eq([b.in, b.out, b.mins, b.openId, b.openIn, b.sessions.length, b.status, b.late], [420, null, 240, 23, 780, 3, 'حاضر', 0]);
  eq(H.data.attendance.filter((a) => a.member === 'M02').length, 1, 'one day, not three');
  eq(H.data.today.M02, { in: 420, out: null, mins: 240, openIn: 780, sessions: 3, remote: false, missingYesterday: false });
  eq(H.myShift(), { id: 23, day: '2026-11-05', in_at: cairo('2026-11-05', '13:00'), out_at: null, remote: false, done: 240, sessions: 3, ot_from: null, ot_ticket: null });
  const c = H.data.attendance.find((a) => a.member === 'M03');
  eq([c.status, c.mins, c.openId], ['انصراف ناقص', 120, 32]);
  eq((await H.fixOut(c, '18:00', 'نسي')).ok, true);
  eq(rpcs(stub).find((x) => x[0] === 'hr_attendance_close'), ['hr_attendance_close', { p_id: 32, p_out: '18:00', p_note: 'نسي' }]);
  eq(rpcs(stub).filter((x) => x[0] === 'hr_attendance_set').length, 0, 'the other session of that day stays');
  // all closed: the last end, the sum
  const closed = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'F' }, responses: { hr_attendance: ok(day.slice(0, 2)) } }); await closed.H.load();
  const d = closed.H.data.attendance.find((a) => a.member === 'M02');
  eq([d.in, d.out, d.mins, d.openId, d.status], [420, 750, 240, null, 'منتظم']);
  eq(closed.H.myShift(), { id: 22, day: '2026-11-05', in_at: cairo('2026-11-05', '11:00'), out_at: cairo('2026-11-05', '12:30'), remote: false, done: 150, sessions: 2, ot_from: null, ot_ticket: null });
});

// phase 13 decision 25 (0069): «ابدأ وقت إضافي» → hr_overtime_begin (no arguments — the server picks my open session), the ticket number back;
// the overtime rows carry their request ticket
test('overtime by ticket: overtimeBegin calls hr_overtime_begin with nothing, returns the ticket as TKT-…; an overtime row shows its ticket', async () => {
  const { H, stub, logs } = load({ meId: B, meCode: 'M02', role: 'ops', perms: { 'hr.view': 'P' }, responses: { 'rpc:hr_overtime_begin': ok({ ticket: 12, ot_from: '2026-11-05T12:00:00Z' }),
    hr_overtime: ok([{ id: 41, member_id: B, day: '2026-11-04', start_at: cairo('2026-11-04', '18:00'), end_at: cairo('2026-11-04', '19:00'), minutes: 60, kind: 'hours', note: 'شحن', status: 'مستني', paid_minutes: 0, pay_month: null, decided_by: null, decided_at: null, reason: null, created_at: '2026-11-04T17:00:00Z', ticket_id: 12 }]) } });
  await H.load();
  const r = await H.overtimeBegin();
  eq([r.ok, r.ticket, r.otFrom], [true, 'TKT-0012', '2026-11-05T12:00:00Z']);
  eq(rpcs(stub).find((x) => x[0] === 'hr_overtime_begin'), ['hr_overtime_begin', {}]);
  eq(logs.find((l) => l[0] === 'hr.overtime.begin').slice(0, 2), ['hr.overtime.begin', 'TKT-0012']);
  eq(H.data.overtime.find((o) => o.dbId === 41).ticket, 'TKT-0012');
  const bad = load({ responses: { 'rpc:hr_overtime_begin': { data: null, error: { code: '22023', message: 'invalid: shift' } } } });
  eq((await bad.H.overtimeBegin()).message, 'مفيش دوام مفتوح');
});

test('the owner 12 Nov — loadLog: the HR rows of the activity log (action like hr.%, newest 300) with the label and the kind, who did it and on whom by the roster; cached a minute; cleared on sign-out', async () => {
  const LOG = [
    { id: 2, at: '2026-11-05T10:00:00Z', actor: A, action: 'hr.attendance.manual', entity: 'hr', entity_id: B, new_value: 'M02 2026-11-05' },
    { id: 1, at: '2026-11-05T09:00:00Z', actor: B, action: 'hr.task.review', entity: 'hr', entity_id: '7', new_value: 'back' },
    { id: 0, at: '2026-11-05T08:00:00Z', actor: B, action: 'hr.something.new', entity: 'hr', entity_id: null, new_value: null },
  ];
  const { H, stub } = load({ responses: { activity_log: ok(LOG) } });
  await H.load();
  const r = await H.loadLog();
  eq(r.items.map((x) => [x.label, x.group, x.by, x.on, x.detail]), [['تسجيل حضور يدوي', 'الحضور', 'صفوت كمال', H.member('M02').name, 'M02 2026-11-05'], ['راجع مهمة', 'المهام', H.member('M02').name, '7', 'رجعت'], ['something.new', 'أخرى', H.member('M02').name, '', '']]);
  const q = stub.calls.filter((c) => c.table === 'activity_log');
  assert(q.some((c) => c.op === 'like' && c.args[0] === 'action' && c.args[1] === 'hr.%'));
  assert(q.some((c) => c.op === 'limit' && c.args[0] === 300));
  await H.loadLog(); eq(stub.calls.filter((c) => c.table === 'activity_log' && c.op === 'from').length, 1, 'cached a minute');
  await H.loadLog(true); eq(stub.calls.filter((c) => c.table === 'activity_log' && c.op === 'from').length, 2, 'forced');
  H.clear(); eq(H.logNow(), null);
});

test('the HR rebuild (0083): «تحويل المرتبات» / one member\'s pay (early = a reason) / an advance / the overtime fix — the RPCs, the accounts reloaded, nothing logged from here', async () => {
  let reloaded = 0;
  const LINE = { member_id: C, name: 'محمد علي', salary: 9600, holdback: 1000, paid: 8600, ot_minutes: 0, ot_pay: 0, rest_days: 0, rest_pay: 0, unpaid_days: 0, unpaid_cut: 0, allowances: 0, deductions: 0, advance: 0, quarter_bonus: 0, net: 8600, missing_scores: 0, leave_days_paid: 0, leave_pay: 0 };
  const LINE_B = { ...LINE, member_id: B, name: 'سارة أحمد', salary: 12000, holdback: 1500, paid: 10500, net: 10500, advance: 500 };
  const { H, stub, logs } = load({ responses: {
    'rpc:hr_payroll_calc': ok([LINE, LINE_B]), hr_payroll_lines: ok([{ ...LINE, month: '2026-11-01', net: 8000 }]), hr_payroll_paid: ok([{ month: '2026-11-01', member_id: C, amount: 8000, account: 'حساب البنك', early_reason: 'ظرف', paid_at: '2026-11-04T10:00:00Z' }]),
    'rpc:hr_payroll_transfer': ok(10500), 'rpc:hr_pay_member': ok(10500), 'rpc:hr_advance_give': ok(77), 'rpc:hr_ot_adjust_add': ok(5) }, accounts: { load: () => { reloaded += 1; return Promise.resolve(); } } });
  await H.load();
  eq(H.data.paid['2026-11'].M03, { amount: 8000, account: 'حساب البنك', early: 'ظرف', at: '2026-11-04T10:00:00Z' });
  // the member paid early keeps the line they were paid on; the other is live
  const r = await H.sheetLines('2026-11');
  eq(r.lines.map((l) => [l.member, l.net, !!l.transfer]), [['M03', 8000, true], ['M02', 10500, false]]);
  eq(H.sheetTotals(r.lines), { members: 2, salaries: 19100, bonus: 0, overtime: 0, extras: 0, cuts: 500, net: 18500, paidAlready: 8000, toTransfer: 10500, left: 1 });
  // the pay day 28 (the default): the 5th is early → a reason is a must, checked before any call
  eq(H.payDayOf('2026-11'), '2026-11-28'); eq(H.payDayOf('2026-02'), '2026-02-28');
  eq(await H.payMember('2026-11', 'M02', 'حساب البنك', '  '), { ok: false, reason: 'invalid', field: 'reason', message: 'اكتب السبب' });
  eq(await H.payMember('2026-11', 'M02', 'خزنة', 'ظرف'), { ok: false, reason: 'invalid', field: 'account', message: 'اختار الحساب' });
  eq(await H.payMember('2026-11', 'M02', 'حساب البنك', 'ظرف <b>طارئ</b>'), { ok: true, net: 10500 });
  eq(rpcs(stub).find((x) => x[0] === 'hr_pay_member'), ['hr_pay_member', { p_month: '2026-11-01', p_member: B, p_account: 'حساب البنك', p_reason: 'ظرف b طارئ /b' }]);
  eq(await H.transfer('2026-11', 'حساب البنك'), { ok: true, total: 10500 });
  eq(rpcs(stub).find((x) => x[0] === 'hr_payroll_transfer'), ['hr_payroll_transfer', { p_month: '2026-11-01', p_account: 'حساب البنك' }]);
  eq(await H.advanceGive('M03', 0, 'x', 'حساب البنك'), { ok: false, reason: 'invalid', field: 'amount', message: 'اكتب المبلغ' });
  eq(await H.advanceGive('M03', 1500, '', 'حساب البنك'), { ok: false, reason: 'invalid', field: 'reason', message: 'اكتب السبب' });
  eq(await H.advanceGive('M03', 1500, 'مصاريف علاج', 'حساب بوسطة'), { ok: true, id: 'HR-0077' });
  eq(rpcs(stub).find((x) => x[0] === 'hr_advance_give'), ['hr_advance_give', { p_member: C, p_amount: 1500, p_reason: 'مصاريف علاج', p_account: 'حساب بوسطة' }]);
  eq(await H.otAdjust('M03', '2026-11', 0, 'x'), { ok: false, reason: 'invalid', field: 'minutes', message: 'راجع عدد الدقايق' });
  eq(await H.otAdjust('M03', '2026-11', -30, 'اتسجل غلط'), { ok: true });
  eq(rpcs(stub).find((x) => x[0] === 'hr_ot_adjust_add'), ['hr_ot_adjust_add', { p_member: C, p_month: '2026-11-01', p_minutes: -30, p_reason: 'اتسجل غلط' }]);
  eq(reloaded, 3, 'the money ones reload the accounts (the expenses and the withdrawals are theirs)');
  eq(logs.length, 0, 'the server logs these (months and codes only)');
  // the server's refusal in Arabic
  const paid = load({ responses: { 'rpc:hr_pay_member': { data: null, error: { code: '22023', message: 'invalid: paid' } } } });
  await paid.H.load();
  eq(await paid.H.payMember('2026-10', 'M02', 'حساب البنك', 'x'), { ok: false, reason: 'invalid', field: 'paid', message: 'المرتب ده اتحوّل قبل كده' });
});

test('the HR rebuild (0083): the evaluations by month from hr_evaluations_list, «قيّم» through hr_evaluate (1–5), the quarter from its rated months, the month\'s tasks', async () => {
  const EV = [
    { member_id: C, month: '2026-07-01', attendance: 5, performance: 4, communication: 5, total: 4.7, note: 'كويس', rated_by: A, rated_at: '2026-08-01T08:00:00Z' },
    { member_id: C, month: '2026-08-01', attendance: 3.5, performance: 2, communication: 3, total: 2.8, note: null, rated_by: A, rated_at: '2026-09-01T08:00:00Z' },
    { member_id: C, month: '2026-09-01', attendance: 4, performance: null, communication: null, total: null, note: null, rated_by: null, rated_at: null },
    { member_id: C, month: '2026-11-01', attendance: null, performance: null, communication: null, total: null, note: null, rated_by: null, rated_at: null },
  ];
  const { H, stub } = load({ responses: { 'rpc:hr_evaluations_list': ok(EV), 'rpc:hr_evaluate': ok(4.3) } });
  await H.load();
  eq(rpcs(stub).find((x) => x[0] === 'hr_evaluations_list'), ['hr_evaluations_list', { p_from: '2025-01-01', p_to: '2026-11-05' }]);
  eq(H.data.evals.M03['2026-07'], { att: 5, perf: 4, comm: 5, total: 4.7, note: 'كويس', by: 'صفوت كمال', at: '2026-08-01T08:00:00Z' });
  eq(H.data.evals.M03['2026-09'].total, null);
  eq(H.quarterEval('M03', '2026-Q3'), { quarter: '2026-Q3', months: ['2026-07', '2026-08', '2026-09'], att: 4.2, perf: 3, comm: 4, total: 3.8, rated: 2, missing: 1 });
  eq(H.quarterEval('M03', 'x'), null);
  eq([H.evalTotal(4, 4, 5), H.evalTotal(null, 4, 5), H.evalTotal(3, null, 5)], [4.3, 4.5, null]);
  eq(await H.evaluate('M03', '2026-11', 0, 4), { ok: false, reason: 'invalid', field: 'performance', message: 'اختار تقييم الأداء (من 1 لـ 5)' });
  eq(await H.evaluate('M03', '2026-11', 4, 6), { ok: false, reason: 'invalid', field: 'communication', message: 'اختار تقييم التواصل (من 1 لـ 5)' });
  eq(await H.evaluate('M03', '2026-11', 4, 5, 'سلس مع الفريق'), { ok: true, total: 4.3 });
  eq(rpcs(stub).find((x) => x[0] === 'hr_evaluate'), ['hr_evaluate', { p_member: C, p_month: '2026-11-01', p_perf: 4, p_comm: 5, p_note: 'سلس مع الفريق' }]);
  // the tasks the evaluator sees: done in the month / still open
  H.data.tasks = [{ id: 1, member: 'M03', title: 'تصوير', status: 'خلصت', day: '2026-11-02', doneDay: '2026-11-03' }, { id: 2, member: 'M03', title: 'جرد', status: 'جاري', day: '2026-11-04' },
    { id: 3, member: 'M03', title: 'قديمة', status: 'خلصت', day: '2026-10-02', doneDay: '2026-10-05' }, { id: 4, member: 'M02', title: 'غيره', status: 'لسه', day: '2026-11-01' }];
  const t = H.monthTasks('M03', '2026-11');
  eq([t.done.map((x) => x.id), t.open.map((x) => x.id)], [[1], [2]]);
});

test('the HR rebuild (0083): the leave carried into this year counts in the balance left; the new settings have their defaults', async () => {
  const { H } = load({ responses: { hr_members: ok([{ member_id: B, shift_start: '09:00:00', shift_end: '17:00:00', hire_date: '2025-05-12', leave_days: 21, leave_carry: 4, leave_carry_year: 2026 },
    { member_id: C, shift_start: '10:00:00', shift_end: '18:00:00', hire_date: null, leave_days: 21, leave_carry: 3, leave_carry_year: 2025 }]) } });
  await H.load();
  const b = H.member('M02'); const c = H.member('M03');
  eq([b.leave, b.carry, b.used, b.leaveLeft], [21, 4, 3, 22], 'this year\'s carry counts (21 + 4 − 3 used)');
  eq([c.carry, c.leaveLeft], [0, 21], 'last year\'s carry does not');
  eq([H.settings().payDay, H.settings().bonusMin, H.settings().leaveYearEnd], [28, 3, 'pay']);
});

test('owner batch 14 Nov decision 13 (0089): the evaluation notes — hr_notes_log read in the members\' codes; noteAdd checks before the server (a warning / a plan needs its text, a meeting a coming time in Cairo) and nothing is logged here', async () => {
  const { H, stub, logs } = load({ responses: {
    hr_notes_log: ok([{ id: 5, member_id: C, kind: 'warning', period: '2026-10', body: 'سبب', due_at: null, ticket_id: null, by_id: B, at: '2026-11-01T08:00:00Z' },
      { id: 6, member_id: C, kind: 'meeting', period: '2026-Q4', body: null, due_at: '2026-11-07T09:00:00Z', ticket_id: 12, by_id: A, at: '2026-11-02T08:00:00Z' }]),
    'rpc:hr_member_note_add': ok({ id: 9, ticket: 14 }) } });
  await H.load();
  eq(H.notesOf('M03').map((x) => [x.id, x.kind, x.period, x.by, x.ticket]), [[5, 'warning', '2026-10', 'سارة أحمد', null], [6, 'meeting', '2026-Q4', 'صفوت كمال', 12]]);
  eq(H.notesOf('M03', '2026-Q4').length, 1);
  // Cairo is UTC+2 in November: 11:00 there = 09:00Z
  eq(H.cairoIso('2026-11-07', '11:00'), '2026-11-07T09:00:00.000Z'); eq(H.cairoIso('2026-11-07', '25:00'), null);
  eq((await H.noteAdd('M03', 'warning', '2026-11', '   ')).field, 'body');
  eq((await H.noteAdd('M03', 'plan', '2026-11', '')).field, 'body');
  eq((await H.noteAdd('M03', 'meeting', '2026-11', '', null)).field, 'due');
  eq((await H.noteAdd('M03', 'meeting', '2026-11', '', { day: '2026-11-01', time: '11:00' })).field, 'due'); // passed
  eq((await H.noteAdd('M03', 'bonus', '2026-11')).field, 'kind');
  eq((await H.noteAdd('M03', 'thanks', '2026-13')).field, 'period');
  eq(rpcs(stub).filter((x) => x[0] === 'hr_member_note_add').length, 0);
  const r = await H.noteAdd('M03', 'meeting', '2026-11', ' نراجع  <b>الأوردرات</b> ', { day: '2026-11-08', time: '10:30' });
  eq([r.ok, r.id, r.ticket], [true, 9, 14]);
  eq(rpcs(stub).find((x) => x[0] === 'hr_member_note_add'), ['hr_member_note_add', { p_member: C, p_kind: 'meeting', p_period: '2026-11', p_body: 'نراجع b الأوردرات /b', p_due: '2026-11-08T08:30:00.000Z' }]);
  eq(logs.filter((l) => /note/.test(l[0])).length, 0); // the server logs hr.note.add (the kind and the period only)
  const bad = load({ responses: { 'rpc:hr_member_note_add': { data: null, error: { code: '42501', message: 'not allowed' } } } });
  eq((await bad.H.noteAdd('M03', 'thanks', '2026-11')).reason, 'forbidden');
});
