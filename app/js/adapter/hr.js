// Human resources «الموارد البشرية» (phase 10, 0046, docs/superpowers/plans/2026-11-05-phase-10-hr.md). load() reads what the member
// sees (RLS: hr.view F = everyone, P = me + the members I manage, N = me only; the pay / the sheet / the extras for
// sensitive.salaries F or one's own) into IBHR.data in the prototype's shapes — IBKit.store keeps the demo rows of the blocks not on
// IBHR yet (the HR page = T5, the clock = T6, «ملفي» = T7 move one by one; the CS pattern: IBCS.data) — with the same names:
//   team / member(code) / team() (the page's list): copies of IBDirectory's members (+ hr_team(): the names of a manager's team the
//     profiles' RLS hides) with salary · holdback · allow (hr_pay) · shift [start, end] · leave (a
//     year) · used (the approved leave days this year that deduct) · hire · contract ('uploaded' | 'missing' | 'expiring') ·
//     contractEnd · docs · monthMin / otMonth / restDays (this month) · hrNotes · payKnown
//   today { code: { in, out, remote, kind?, missingYesterday } } — minutes since 00:00 Cairo; kind 'leave' | 'absent' | 'off' | 'holiday'
//   attendance [{ id, member, date, type, in, out, ot, late, status, src, remote, source }]
//   requests [{ id 'HR-0001', dbId, type, member, from, to, time, hours, amount, months, note, status, at, atIso, by, reason, startMonth, doc }]
//   overtime [{ id 'OT-0001', dbId, kind, member, date, start, end, minutes, note, status, paid, payMonth (the sheet that pays it), by, waitedHours, reason }]
//   restWork [{ member, date, note, dbId }] — rest days / holidays worked and approved (×2)
//   holidays · leaveTypes · bonusRules · otPeriods (the lists, with their dbId) · departments · hrSettings (the row «hr» over defaults)
//   kpis { code: [{ id, name, src, weight, target, inverse }] } · scores { code: { 'YYYY-MM': score } } · scoreRows { code: { 'YYYY-MM': { actuals, note, by, at } } }
//   extras [{ id, member, quarter, rule, amount, status }] · achievements [{ id, member, title, amount, date, month, status }]
//   adjustments [{ id, member, month, label, amount, kind, note }] · meetings [{ id 'MT-01', dbId, member, reason, status, … }]
//   sheet { month 'YYYY-MM', status } (this month's) · sheets { 'YYYY-MM': { status, total, paidAccount } }
//   tasks [{ id, member, memberUid, memberName, title, status, day, reason, reviewer (a name), reviewerUid, until, reviewNote, doneAt,
//     doneDay, by (who put it), byUid }] — «ملفي › مهامي» (decision 25, 0048): the open ones + the ones done in the last 90 days that
//     the member sees (mine · my team with hr.view P · all with F · the ones waiting for my review); people [{ uid, code, name }] —
//     the active team's names (hr_task_people) for «مين هيراجع»
// Every write goes through the RPCs / the tables RLS lets the member write and returns a Promise of { ok, reason?, field?,
// message? } that never throws (reason 'forbidden' 42501, 'invalid' 22xxx / 23xxx, 'notfound' P0002, 'exists', 'network'); each
// one the server took is logged hr.<x> through IBActivity (codes, months and counts — never an amount, a score, a label, a request's
// type, a meeting's outcome, a password or a note: the log's HR rows are their actor's and hr.view F's only, 0046;
// «hr.» joins IBActivity.LOGGED_PREFIXES with the page on IBHR — T5 — so the old demo page's events never reach the server).
// «إضافة عضو» = the Edge Function team-admin (the admin; the temporary password comes back once and is never kept). Files: the
// private bucket «hr-docs» under the member's folder. Live: the private broadcast «hr» / «changed» → one load(), plus a check
// every 60 s.
(function () {
  'use strict';
  const BUCKET = 'hr-docs'; const MAX_BYTES = 10 * 1024 * 1024; const MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  const DAYS_BACK = 120; const REQ_DAYS = 400; const POLL_MS = 60000; const TASK_DONE_DAYS = 90;
  const TASK_STATUSES = ['لسه', 'جاري', 'متوقفة', 'جاهزة للمراجعة', 'خلصت', 'اتأجلت'];
  const TASK_COLS = 'id, member_id, title, status, day, reason, reviewer_id, until, review_note, done_at, created_by, created_at';
  const ACCOUNTS = ['حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية'];
  const DOC_KINDS = ['عقد عمل', 'ملحق عقد', 'بطاقة رقم قومي', 'شهادة تخرج', 'أخرى'];
  const DEFAULTS = { shiftEnd: true, presence: true, presenceEvery: 120, confirmBy: 'المدير المباشر', escalate: 24, countOT: true,
    autoMissing: true, probation: 3, salaryViewers: 'المالك بس', hideAmounts: true, holdbackDefault: 1000, bonusFloor: 70,
    // the HR rebuild (0083, the owner 12 Nov): the pay day (an earlier transfer asks why), the bonus bar (a month's evaluation ≥ it = its
    // held-back part whole), the annual leave left at the year's end ('pay' with December's salary · 'carry' to the next year)
    payDay: 28, bonusMin: 3, leaveYearEnd: 'pay',
    // owner batch 14 Nov decision 7 (0087): the work days (isodow — 1 Monday … 7 Sunday), the official hours, the day rate's divisor and a
    // custom time for a department or a member ({ dept: { name: { from, to } }, member: { uid: { from, to } } }) — the server reads the same
    workDays: [7, 1, 2, 3, 4], workFrom: '09:00', workTo: '17:00', dayDivisor: 24, schedules: { dept: {}, member: {} } };
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const K = () => window.IBKit;
  const S = () => (K() && K().store) || null; // the directory's members only (IBKit.store.members)
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const myUid = () => { const m = me(); return (m && m.id) || null; };
  const can = () => ({ view: perm('hr.view'), edit: perm('hr.edit') === 'F', approve: perm('hr.approve') === 'F', salaries: perm('sensitive.salaries') === 'F', admin: !!(me() && me().role_id === 'admin') });
  // phase 13 decision 32 (0070): a rest day / holiday worked is the admins' decision; an ordinary overtime the direct manager's (the server judges)
  const decidesOt = (o) => !!o && (o.kind !== 'rest_day' || can().admin);
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' ? 'notfound' : code === '23505' ? 'exists' : /^2[23]/.test(code) ? 'invalid' : 'network'; };
  const fieldOf = (err) => { const m = /invalid: (\w+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };
  const MESSAGES = { forbidden: 'مفيش صلاحية للإجراء ده', notfound: 'مش موجود أو مش متاح ليك', network: 'تعذّر الاتصال — جرّب تاني', invalid: 'راجع البيانات', exists: 'موجود بالفعل' };
  const FIELD_MESSAGES = { at: 'راجع وقت الانصراف', shift: 'مفيش دوام مفتوح', day: 'اليوم ده مش متاح', time: 'اكتب الوقت',
    amount: 'اكتب المبلغ', to: 'راجع التاريخ', type: 'النوع ده مش موجود', reason: 'اكتب السبب', minutes: 'راجع عدد الدقايق', weights: 'مجموع الأوزان لازم 100%',
    actual: 'اكتب الفعلي لكل مؤشر', month: 'الشهر ده لسه مجاش', status: 'الحالة دي مش متاحة', step: 'الخطوة دي مش متاحة للكشف دلوقتي', account: 'اختار الحساب',
    doc: 'ارفع المرفق المطلوب', note: 'الملاحظة طويلة', decision: 'القرار مش صحيح', email: 'الإيميل ده مستخدم', phone: 'رقم الموبايل ده مستخدم',
    meeting: 'الوقت الإضافي اللي اترفض بيرجع بنتيجة الميتنج بتاعه بس', title: 'اكتب المهمة (لحد 200 حرف)', reviewer: 'اختار مين هيراجع (غير صاحب المهمة)',
    until: 'اختار يوم من النهارده أو بعده', count: 'فيه 300 مهمة مفتوحة — خلّص أو امسح شوية الأول',
    paid: 'المرتب ده اتحوّل قبل كده', performance: 'اختار تقييم الأداء (من 1 لـ 5)', communication: 'اختار تقييم التواصل (من 1 لـ 5)', range: 'الفترة طويلة',
    kind: 'النوع ده مش موجود', period: 'الفترة دي لسه مجتش', body: 'اكتب التفاصيل (لحد 1000 حرف)', due: 'اختار ميعاد جاي (في خلال 90 يوم)',
    bank: 'اكتب اسم البنك', holder: 'اكتب اسم صاحب الحساب', number: 'رقم الحساب أرقام بس (من 6 لـ 30 رقم)', iban: 'الـ IBAN مش صحيح (زي EG38…)' };
  const fail = (err) => { const reason = reasonOf(err); const field = reason === 'invalid' ? fieldOf(err) : null; return { ok: false, reason, field, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] }; };
  const no = (reason, field) => ({ ok: false, reason, field: field || null, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] });
  const log = (action, detail, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log(action, detail, { entity: 'hr', entity_id: id || null })); };
  const emit = () => quiet(() => document.dispatchEvent(new CustomEvent('ib:hr')));
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const num = (v) => (v == null || v === '' ? 0 : Number(v));

  // ---------- Cairo time ----------
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (iso) => { const d = iso ? new Date(iso) : new Date(); if (!Number.isFinite(d.getTime())) return null; const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { day: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) }; };
  const today = () => parts().day;
  const nowMin = () => parts().min;
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  // minutes since 00:00 of the attendance day (a shift past midnight goes over 1440)
  const minOf = (iso, day) => { const p = parts(iso); return p ? p.min + 1440 * dayDiff(day, p.day) : null; };
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hhmm = (m) => (m == null ? '' : String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  const monthKey = (iso) => String(iso || '').slice(0, 7);
  const monthStart = (key) => key + '-01';
  const isoDay = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const AR_MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  // «قُدّم»: اليوم 10:12 · أمس 09:30 · 19 أكتوبر
  function atLabel(iso) {
    const p = parts(iso); if (!p) return '—'; const t = today();
    if (p.day === t) return 'اليوم ' + hhmm(p.min);
    if (p.day === addDays(t, -1)) return 'أمس ' + hhmm(p.min);
    return Number(p.day.slice(8)) + ' ' + AR_MON[Number(p.day.slice(5, 7)) - 1] + (p.day.slice(0, 4) !== t.slice(0, 4) ? ' ' + p.day.slice(0, 4) : '');
  }
  const quarterOf = (key) => { const y = key.slice(0, 4); const q = Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1; return y + '-Q' + q; };
  const quarterMonths = (key) => { const y = key.slice(0, 4); const q0 = Math.floor((Number(key.slice(5, 7)) - 1) / 3) * 3; return [1, 2, 3].map((i) => y + '-' + String(q0 + i).padStart(2, '0')); };

  // ---------- names ----------
  // the roster: the directory's members (settings.view decides) + the members only HR shows me (hr_team(): a manager's team —
  // names, title, department, manager, status; never contact details), rebuilt with each load
  let roster = [];
  const ROLE_NAME = { admin: 'أدمن', ops: 'عمليات', cs: 'خدمة العملاء', accounts: 'حسابات', vendors_followup: 'متابعة المبتكرين', viewer: 'مشاهد' };
  function buildRoster(team) {
    const dir = (S() && S().members) || []; const known = new Set(dir.map((m) => m.uid)); const code = Object.fromEntries((team || []).map((t) => [t.id, t.member_code]).concat(dir.map((m) => [m.uid, m.id])));
    roster = dir.concat((team || []).filter((t) => !known.has(t.id)).map((t) => ({ id: t.member_code, uid: t.id, name: t.name, title: t.title || '', dept: t.dept || '', manager: code[t.manager_id] || '',
      status: t.status, role: ROLE_NAME[t.role_id] || '', phone: '', email: '', twofa: false, fromHr: true })));
  }
  const members = () => (roster.length ? roster : (S() && S().members) || []);
  const byUid = (uid) => members().find((m) => m.uid === uid) || null;
  const byCode = (code) => members().find((m) => m.id === code) || null;
  const codeOf = (uid) => { const m = byUid(uid); return m ? m.id : null; };
  const nameOf = (uid) => { if (!uid) return '—'; const m = byUid(uid); return m ? m.name : '—'; };
  const uidOf = (codeOrUid) => { const s = String(codeOrUid || ''); if (/^[0-9a-f-]{36}$/i.test(s)) return s.toLowerCase(); const m = byCode(s); return m ? m.uid : null; };

  // ---------- the loaded rows ----------
  let st = 'idle'; let gen = 0;
  const raw = { team: [], members: [], pay: [], att: [], ot: [], req: [], hol: [], lt: [], br: [], otp: [], kpis: [], scores: [], extras: [], meet: [], adj: [], payroll: [], docs: [], settings: {}, tasks: [], people: [],
    paidRows: [], otAdj: [], evals: [], carry: [] }; // 0083: the members paid per month, the overtime fixes, the evaluations, the leave carried
  const ids = { req: 'HR-', ot: 'OT-', meet: 'MT-' };
  const pad = (n, w) => String(n).padStart(w, '0');
  const reqId = (n) => ids.req + pad(n, 4); const otId = (n) => ids.ot + pad(n, 4); const mtId = (n) => ids.meet + pad(n, 2);
  const dbOf = (id, prefix) => { const s = String(id == null ? '' : id); if (/^\d+$/.test(s)) return Number(s); const m = new RegExp('^' + prefix + '(\\d+)$').exec(s); return m ? Number(m[1]) : null; };
  async function rows(q) { const { data: d, error } = await q; if (error) throw error; return Array.isArray(d) ? d : []; }
  async function maybe(q) { try { return await rows(q); } catch (e) { return []; } } // a table RLS hides from the member reads as empty

  const holidayDates = () => raw.hol.filter((x) => x.status === 'مؤكد').flatMap((x) => Array.from({ length: x.days || 1 }, (_, i) => addDays(x.day, i)));
  const offDay = (d, hol) => !workDays().includes(isoDay(d) || 7) || hol.includes(d); // 0087: the settings' work days (getUTCDay 0 = Sunday = isodow 7)
  const leaveDays = (from, to, hol) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (!offDay(d, hol)) n += 1; return n; };
  const leaveType = (name) => raw.lt.find((t) => t.name === name) || null;
  const isLeave = (type) => !!leaveType(type) || String(type || '').startsWith('إجازة');

  const data = {};
  function shape() {
    const s = data;
    const t = today(); const nm = nowMin(); const mk = monthKey(t); const hol = holidayDates(); const set = settings();
    const hm = new Map(raw.members.map((r) => [r.member_id, r])); const pay = new Map(raw.pay.map((r) => [r.member_id, r]));
    const notesOf = new Map((raw.notes || []).map((r) => [r.member_id, r.notes]));
    const carryOf = new Map((raw.carry || []).map((r) => [r.member_id, Number(r.leave_carry_year) === Number(t.slice(0, 4)) ? Number(r.leave_carry) || 0 : 0]));
    const docsOf = new Map(); raw.docs.forEach((d) => { if (!docsOf.has(d.member_id)) docsOf.set(d.member_id, []); docsOf.get(d.member_id).push({ id: Number(d.id), kind: d.kind, path: d.path, name: d.name, start: d.start_on, end: d.end_on, at: d.created_at }); });
    // the requests
    s.requests = raw.req.map((r) => ({ id: reqId(r.id), dbId: Number(r.id), type: r.type, member: codeOf(r.member_id), memberUid: r.member_id, from: r.from_day, to: r.to_day,
      time: r.at_time ? String(r.at_time).slice(0, 5) : null, hours: r.hours == null ? null : Number(r.hours), amount: r.amount == null ? null : Number(r.amount), months: r.months == null ? null : Number(r.months),
      note: r.note || '', status: r.status, at: atLabel(r.created_at), atIso: r.created_at, by: r.decided_by ? nameOf(r.decided_by) : null, reason: r.reason || null, doc: r.doc_path || null, ticket: r.ticket_id ? 'TKT-' + String(r.ticket_id).padStart(4, '0') : null, // decision 33: the request's team ticket
      startMonth: r.type === 'سُلفة' && r.decided_at && r.status === 'موافق' ? (Number(monthKey(parts(r.decided_at).day).slice(5)) % 12) + 1 : null })).filter((r) => r.member);
    // overtime + the rest days worked
    const otRows = raw.ot.map((o) => { const p0 = parts(o.start_at); const p1 = parts(o.end_at);
      return { id: otId(o.id), dbId: Number(o.id), kind: o.kind, member: codeOf(o.member_id), memberUid: o.member_id, date: o.day, start: p0 ? hhmm(p0.min) : '', end: p1 ? hhmm(p1.min) : '', minutes: Number(o.minutes),
        note: o.note, status: o.status === 'اترفض' ? 'وقت إضافي اترفض' : o.status, paid: Number(o.paid_minutes) || 0, payMonth: o.pay_month ? monthKey(o.pay_month) : null, by: o.decided_by ? nameOf(o.decided_by) : null, reason: o.reason || null,
        waitedHours: o.status === 'مستني' ? Math.max(0, Math.floor((Date.now() - Date.parse(o.created_at)) / 3600000)) : 0,
        ticket: o.ticket_id ? 'TKT-' + String(o.ticket_id).padStart(4, '0') : null }; }).filter((o) => o.member); // decision 25: the request ticket
    s.overtime = otRows;
    s.restWork = otRows.filter((o) => o.kind === 'rest_day' && o.status === 'اتضاف').map((o) => ({ member: o.member, date: o.date, note: o.note, dbId: o.dbId }));
    // attendance (the real days; the log adds leave / absence / rest days by itself). Decision 24 (0068): a row is a session — the day is
    // its sessions together: «in» the first start, «out» the last end (none while one is open), «mins» the closed sessions summed, «openId» /
    // «openIn» the open one; no lateness (flexible hours)
    const okOt = new Map(); otRows.filter((o) => o.kind === 'hours' && o.status === 'اتضاف').forEach((o) => { const k = o.member + '|' + o.date; okOt.set(k, (okOt.get(k) || 0) + o.paid); });
    const byDay = new Map(); raw.att.forEach((a) => { const k = a.member_id + '|' + a.day; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(a); });
    const srcOf = (a) => (a.source === 'clock' ? (a.remote ? 'تسجيل من السيستم · عن بُعد' : 'تسجيل من السيستم') : (a.source === 'fix' ? 'تصحيح' : 'تسجيل يدوي') + ' — ' + nameOf(a.by_id) + (a.note ? ' · ' + a.note : ''));
    s.attendance = [...byDay.values()].map((l) => {
      l.sort((x, y) => (x.in_at < y.in_at ? -1 : x.in_at > y.in_at ? 1 : 0));
      const a = l[0]; const code = codeOf(a.member_id); const off = offDay(a.day, hol);
      const open = l.filter((x) => !x.out_at).pop() || null; const last = l[l.length - 1];
      const sessions = l.map((x) => ({ id: Number(x.id), in: minOf(x.in_at, x.day), out: x.out_at ? minOf(x.out_at, x.day) : null, source: x.source, remote: !!x.remote }));
      const i = sessions[0].in; const o = open ? null : Math.max(...sessions.map((x) => x.out));
      const mins = sessions.reduce((n, x) => n + (x.out != null ? Math.max(0, x.out - x.in) : 0), 0); const ot = okOt.get(code + '|' + a.day) || 0;
      const status = o == null ? (a.day === t ? 'حاضر' : 'انصراف ناقص') : off ? 'شغل يوم راحة' : ot ? 'وقت إضافي اتضاف' : 'منتظم';
      const src = [...new Set(l.map(srcOf))].join(' · ') + (l.length > 1 ? ' · ' + l.length + ' جلسات' : '');
      return { id: Number((open || last).id), member: code, memberUid: a.member_id, date: a.day, type: hol.includes(a.day) ? 'عطلة رسمية' : off ? 'راحة أسبوعية' : 'يوم عمل', in: i, out: o, mins,
        openId: open ? Number(open.id) : null, openIn: open ? minOf(open.in_at, open.day) : null, sessions, ot, late: 0, status, src, remote: l.some((x) => !!x.remote), source: (open || last).source };
    }).filter((a) => a.member);
    // today
    const tdy = {};
    members().forEach((m) => {
      const mine = s.attendance.filter((a) => a.member === m.id).sort((x, y) => (x.date < y.date ? 1 : -1));
      const row = mine.find((a) => a.date === t); const before = mine.find((a) => a.date < t);
      const missing = !!before && before.out == null;
      const r = hm.get(m.uid); const end = toMin(r ? r.shift_end : '17:00') || 1020;
      if (row) { tdy[m.id] = { in: row.in, out: row.out, mins: row.mins, openIn: row.openIn, sessions: row.sessions.length, remote: row.remote, missingYesterday: missing }; return; }
      const leave = s.requests.find((q) => q.member === m.id && isLeave(q.type) && q.status === 'موافق' && q.from <= t && q.to >= t);
      if (hol.includes(t)) tdy[m.id] = { kind: 'holiday', missingYesterday: missing };
      else if (offDay(t, hol)) tdy[m.id] = { kind: 'off', missingYesterday: missing };
      else if (leave) tdy[m.id] = { kind: 'leave', leaveType: leave.type, missingYesterday: missing };
      else if (nm > end && m.status === 'active') tdy[m.id] = { kind: 'absent', missingYesterday: missing };
      else if (missing) tdy[m.id] = { missingYesterday: true };
    });
    s.today = tdy;
    // the members: copies of the directory's with their HR numbers (IBKit.store.members stays the directory's)
    const year = t.slice(0, 4);
    s.team = members().map((d) => {
      const m = Object.assign({}, d); const r = hm.get(m.uid) || {}; const p = pay.get(m.uid); const docs = docsOf.get(m.uid) || [];
      if (p) { m.salary = Number(p.salary) || 0; m.holdback = Number(p.holdback) || 0; m.allow = Number(p.allowances) || 0; } else { m.salary = 0; m.holdback = 0; m.allow = 0; }
      m.payKnown = !!p;
      m.shift = [String(r.shift_start || '09:00').slice(0, 5), String(r.shift_end || '17:00').slice(0, 5)];
      m.leave = r.leave_days == null ? 21 : Number(r.leave_days); m.hire = r.hire_date || m.hire || ''; m.hrNotes = notesOf.get(m.uid) || '';
      m.carry = carryOf.get(m.uid) || 0; // 0083: last year's balance left when the setting carries it («يترحّل»)
      m.used = s.requests.filter((q) => q.member === m.id && q.status === 'موافق' && (leaveType(q.type) || {}).deducts && q.from.slice(0, 4) === year)
        .reduce((n, q) => n + leaveDays(q.from < year + '-01-01' ? year + '-01-01' : q.from, q.to > year + '-12-31' ? year + '-12-31' : q.to, hol), 0);
      const work = s.attendance.filter((a) => a.member === m.id && a.date.startsWith(mk) && a.in != null);
      m.monthMin = work.reduce((n, a) => n + Math.max(0, (a.out == null ? (a.date === t ? nm : a.in) : a.out) - a.in), 0);
      m.otMonth = otRows.filter((o) => o.member === m.id && o.kind === 'hours' && o.status === 'اتضاف' && o.date.startsWith(mk)).reduce((n, o) => n + o.paid, 0);
      m.restDays = s.restWork.filter((x) => x.member === m.id && x.date.startsWith(mk)).length;
      m.leaveLeft = Math.max(0, m.leave + m.carry - m.used); // the annual balance left this year (an approved leave that deducts comes off it)
      m.docs = docs;
      const contract = docs.filter((d) => d.kind === 'عقد عمل').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      m.contract = !contract ? 'missing' : contract.end && contract.end < addDays(t, 30) ? 'expiring' : 'uploaded';
      m.contractEnd = contract ? contract.end || null : null;
      return m;
    });
    // the lists
    s.holidays = raw.hol.map((x) => ({ dbId: Number(x.id), date: x.day, name: x.name, days: Number(x.days) || 1, kind: x.kind, status: x.status })).sort((a, b) => (a.date < b.date ? -1 : 1));
    s.leaveTypes = raw.lt.slice().sort((a, b) => a.sort - b.sort || (a.name < b.name ? -1 : 1)).map((x) => ({ name: x.name, days: x.days, paid: x.paid, doc: x.doc, carry: x.carry, approval: x.approval, deducts: !!x.deducts, unpaid: !!x.unpaid }));
    s.bonusRules = raw.br.map((b) => ({ dbId: Number(b.id), name: b.name, cond: b.cond, amount: Number(b.amount), on: !!b.active }));
    s.otPeriods = raw.otp.map((p) => ({ dbId: Number(p.id), range: p.range_text, scope: p.scope, count: !!p.counts, by: nameOf(p.created_by) + ' · ' + atLabel(p.created_at) }));
    s.departments = Array.isArray(set.departments) && set.departments.length ? set.departments.slice() : [...new Set(members().map((m) => m.dept).filter(Boolean))];
    s.hrSettings = set;
    // performance
    const kp = {}; const sc = {}; const sr = {};
    members().forEach((m) => { kp[m.id] = []; sc[m.id] = {}; sr[m.id] = {}; });
    raw.kpis.filter((k) => k.active).sort((a, b) => a.sort - b.sort || a.id - b.id).forEach((k) => { const code = codeOf(k.member_id); if (code && kp[code]) kp[code].push({ id: Number(k.id), name: k.name, src: k.src, weight: Number(k.weight), target: Number(k.target), inverse: !!k.inverse }); });
    raw.scores.forEach((x) => { const code = codeOf(x.member_id); if (!code || !sc[code]) return; const key = monthKey(x.month); sc[code][key] = Number(x.score); sr[code][key] = { actuals: x.actuals || {}, note: x.note || '', by: nameOf(x.rated_by), at: x.rated_at }; });
    s.kpis = kp; s.scores = sc; s.scoreRows = sr;
    // the money (what RLS lets the member read)
    const sheets = {}; raw.payroll.forEach((p) => { sheets[monthKey(p.month)] = { status: p.status, total: p.total == null ? null : Number(p.total), paidAccount: p.paid_account || null }; });
    s.sheets = sheets; s.sheet = { month: mk, status: (sheets[mk] || {}).status || 'مسودة', exists: !!sheets[mk] };
    // 0083: who was paid for a month (one by one or with «تحويل المرتبات») — { 'YYYY-MM': { code: { amount, account, early, at } } }
    const paid = {}; (raw.paidRows || []).forEach((x) => { const code = codeOf(x.member_id); if (!code) return; const k = monthKey(x.month); (paid[k] = paid[k] || {})[code] = { amount: Number(x.amount) || 0, account: x.account, early: x.early_reason || null, at: x.paid_at }; });
    s.paid = paid;
    s.otAdjust = (raw.otAdj || []).map((x) => ({ id: Number(x.id), member: codeOf(x.member_id), month: monthKey(x.month), minutes: Number(x.minutes), reason: x.reason, by: nameOf(x.by_id), at: x.at })).filter((x) => x.member);
    // the evaluations (decision 2): { code: { 'YYYY-MM': { att, perf, comm, total, note, by, at } } } — att is the server's (the days attended)
    const ev = {}; (raw.evals || []).forEach((x) => { const code = codeOf(x.member_id); if (!code) return; const n = (v) => (v == null ? null : Number(v));
      (ev[code] = ev[code] || {})[monthKey(x.month)] = { att: n(x.attendance), perf: n(x.performance), comm: n(x.communication), total: n(x.total), note: x.note || '', by: x.rated_by ? nameOf(x.rated_by) : null, at: x.rated_at || null }; });
    s.evals = ev;
    // 0089: the evaluation notes — [{ id, member, kind meeting|warning|plan|thanks, period YYYY-MM|YYYY-Qn, body, due, ticket, by, at }]
    s.noteLog = (raw.noteLog || []).map((x) => ({ id: Number(x.id), member: codeOf(x.member_id), kind: x.kind, period: x.period, body: x.body || '', due: x.due_at || null,
      ticket: x.ticket_id ? Number(x.ticket_id) : null, by: x.by_id ? nameOf(x.by_id) : null, at: x.at })).filter((x) => x.member);
    s.adjustments = raw.adj.filter((a) => !a.voided_at).map((a) => ({ id: Number(a.id), member: codeOf(a.member_id), month: monthKey(a.month), label: a.label, amount: Number(a.amount), kind: a.kind, note: a.note || '' })).filter((a) => a.member);
    s.achievements = s.adjustments.filter((a) => a.kind === 'achievement').map((a) => ({ id: a.id, member: a.member, title: a.label, amount: a.amount, month: a.month, date: a.month + '-01',
      status: (sheets[a.month] || {}).status === 'مدفوع' ? 'اتصرفت' : 'هتتصرف مع المرتب' }));
    s.extras = raw.extras.map((e) => ({ id: Number(e.id), member: codeOf(e.member_id), quarter: e.quarter, rule: e.rule, amount: Number(e.amount), status: e.status === 'معتمدة' ? 'جاهز للاعتماد' : e.status === 'مقترحة' ? 'مكافأة محتاجة قرار' : 'اترفضت', dbStatus: e.status }))
      .filter((e) => e.member && e.dbStatus !== 'مرفوضة');
    s.meetings = raw.meet.map((x) => ({ id: mtId(x.id), dbId: Number(x.id), member: codeOf(x.member_id), reason: x.reason, status: meetingLabel(x), dbStatus: x.status, outcome: x.outcome || null,
      date: x.day || null, time: x.time_text || null, place: x.place || null, plan: x.plan || '—', goals: Array.isArray(x.goals) && x.goals.length ? x.goals : null, support: x.support || '', notes: x.notes || '',
      review: x.review_on ? x.review_on : '—', progress: x.progress == null ? null : Number(x.progress), ref: x.ref || null })).filter((x) => x.member);
  }
  const meetingLabel = (x) => (x.status === 'خطة شغالة' ? 'اتعمل — خطة شغالة' : x.status === 'اتقفلت' && x.outcome === 'إنذار' ? 'اتعمل — إنذار' : x.status === 'اتقفلت' && x.outcome ? 'اتقفلت — ' + x.outcome : x.status);
  const settings = () => Object.assign({}, DEFAULTS, raw.settings && typeof raw.settings === 'object' ? raw.settings : {});
  // ---------- the hours (0087 — the same rules as hr_hm / hr_span / hr_schedule / hr_day_minutes / hr_work_dows) ----------
  const hm = (t) => (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(t || '')) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
  const span = (from, to) => { const a = hm(from), b = hm(to); if (a == null || b == null) return null; const d = (b - a + 1440) % 1440; return d >= 60 && d <= 960 ? d : null; };
  const workDays = () => { const v = settings().workDays; const ok = Array.isArray(v) ? [...new Set(v.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))] : []; return ok.length ? ok.sort() : [1, 2, 3, 4, 7]; };
  const isWorkDay = (d) => { const x = d instanceof Date ? d : new Date(String(d).slice(0, 10) + 'T12:00:00'); const iso = x.getDay() === 0 ? 7 : x.getDay(); return workDays().includes(iso); };
  const dayDivisor = () => { const n = Number(settings().dayDivisor); return Number.isInteger(n) && n >= 20 && n <= 31 ? n : 24; };
  function scheduleOf(uid) {
    const st0 = settings(); const sc = st0.schedules && typeof st0.schedules === 'object' ? st0.schedules : {};
    const m = uid && sc.member && sc.member[uid]; if (m && span(m.from, m.to) != null) return { from: m.from, to: m.to, kind: 'member' };
    const who = uid ? members().find((x) => x.uid === uid) : null; const g = who && who.dept && sc.dept && sc.dept[who.dept];
    if (g && span(g.from, g.to) != null) return { from: g.from, to: g.to, kind: 'dept' };
    if (span(st0.workFrom, st0.workTo) != null) return { from: st0.workFrom, to: st0.workTo, kind: 'general' };
    return { from: '09:00', to: '17:00', kind: 'general' };
  }
  const dayMinutes = (uid) => { const s0 = scheduleOf(uid === undefined ? myUid() : uid); return span(s0.from, s0.to) || 480; };

  async function load() {
    const cl = c(); const uid = myUid(); if (!cl || !uid) return { ok: false, reason: 'network' };
    const g = ++gen; st = 'loading';
    try {
      const t = today(); const since = addDays(t, -DAYS_BACK); const reqSince = addDays(t, -REQ_DAYS); const scoreSince = addDays(t.slice(0, 8) + '01', -730);
      const evFrom = String(Number(t.slice(0, 4)) - 1) + '-01-01'; // the evaluations: last year and this one (the quarters of both)
      const [team, hm, pay, att, ot, req, hol, lt, br, otp, kpis, scores, extras, meet, adj, payroll, docs, set, notes, tasks, paidRows, otAdj, evals, carry, noteLog] = await Promise.all([
        cl.rpc('hr_team').then((r) => (r && !r.error && Array.isArray(r.data) ? r.data : []), () => []),
        rows(cl.from('hr_members').select('member_id, shift_start, shift_end, hire_date, leave_days')), // the notes column is closed (hr_member_notes)
        maybe(cl.from('hr_pay').select('member_id, salary, holdback, allowances')),
        rows(cl.from('hr_attendance').select('id, member_id, day, in_at, out_at, remote, source, note, by_id, ot_from, ot_ticket').gte('day', since).order('day', { ascending: false }).limit(5000)),
        rows(cl.from('hr_overtime').select('id, member_id, day, start_at, end_at, minutes, kind, note, status, paid_minutes, pay_month, decided_by, decided_at, reason, created_at, ticket_id').gte('day', since).order('created_at', { ascending: false }).limit(3000)),
        rows(cl.from('hr_requests_v').select('id, member_id, type, from_day, to_day, at_time, hours, amount, months, note, status, decided_by, decided_at, reason, created_by, created_at, doc_path, ticket_id').gte('created_at', reqSince).order('created_at', { ascending: false }).limit(3000)),
        rows(cl.from('hr_holidays').select('id, name, day, days, kind, status')),
        rows(cl.from('hr_leave_types').select('name, days, paid, doc, carry, approval, deducts, unpaid, sort')),
        rows(cl.from('hr_bonus_rules').select('id, name, cond, amount, active').order('id')),
        rows(cl.from('hr_ot_periods').select('id, range_text, scope, counts, created_by, created_at').order('created_at', { ascending: false })),
        rows(cl.from('hr_kpis').select('id, member_id, name, src, weight, target, inverse, sort, active')),
        rows(cl.from('hr_scores').select('member_id, month, score, actuals, note, rated_by, rated_at').gte('month', scoreSince)),
        maybe(cl.from('hr_extras').select('id, member_id, quarter, rule, amount, status').order('created_at', { ascending: false }).limit(500)),
        rows(cl.from('hr_meetings').select('id, member_id, reason, status, day, time_text, place, outcome, plan, goals, support, review_on, progress, notes, ref, created_at').order('created_at', { ascending: false }).limit(500)),
        maybe(cl.from('hr_adjustments').select('id, member_id, month, amount, label, note, kind, voided_at').gte('month', addDays(t.slice(0, 8) + '01', -400))),
        maybe(cl.from('hr_payroll').select('month, status, total, paid_account').order('month', { ascending: false }).limit(36)),
        maybe(cl.from('hr_documents').select('id, member_id, kind, path, name, start_on, end_on, created_at').is('voided_at', null)),
        cl.rpc('hr_settings').then((r) => (r && !r.error && r.data && typeof r.data === 'object' ? r.data : {}), () => ({})),
        // the internal notes (security review 5 Nov): hr.edit F only, never my own — the server decides again
        can().edit ? cl.rpc('hr_member_notes').then((r) => (r && !r.error && Array.isArray(r.data) ? r.data : []), () => []) : Promise.resolve([]),
        taskRows(cl, t), // decision 25 (0048) — empty before the migration, the rest of HR still loads
        // the HR rebuild (0083) — each one empty before the migration (the rest still loads): the members paid per month (sensitive.salaries
        // or my own), the overtime fixes, the monthly evaluations of the members I see, the leave carried into this year
        maybe(cl.from('hr_payroll_paid').select('month, member_id, amount, account, early_reason, paid_at').gte('month', addDays(t.slice(0, 8) + '01', -400))),
        maybe(cl.from('hr_ot_adjust').select('id, member_id, month, minutes, reason, by_id, at').gte('month', addDays(t.slice(0, 8) + '01', -400)).order('at', { ascending: false })),
        cl.rpc('hr_evaluations_list', { p_from: evFrom, p_to: t }).then((r) => (r && !r.error && Array.isArray(r.data) ? r.data : []), () => []),
        maybe(cl.from('hr_members').select('member_id, leave_carry, leave_carry_year')),
        // owner batch 14 Nov decision 13 (0089): the evaluation notes of the members I see (empty before the migration)
        maybe(cl.from('hr_notes_log').select('id, member_id, kind, period, body, due_at, ticket_id, by_id, at').order('at', { ascending: false }).limit(1000)),
      ]);
      if (g !== gen) return { ok: false, reason: 'stale' };
      Object.assign(raw, { team, members: hm, pay, att, ot, req, hol, lt, br, otp, kpis, scores, extras, meet, adj, payroll, docs, settings: set, notes, tasks: tasks.rows, people: tasks.people, paidRows, otAdj, evals, carry, noteLog });
      tgen += 1; buildRoster(team); shape(); shapeTasks(); st = 'ready'; emit(); subscribe(); return { ok: true };
    } catch (e) { if (g === gen) st = 'error'; emit(); return fail(e); }
  }
  function empty() {
    ['team', 'attendance', 'requests', 'overtime', 'restWork', 'adjustments', 'achievements', 'extras', 'meetings', 'otPeriods', 'bonusRules', 'holidays', 'leaveTypes', 'departments', 'tasks', 'people', 'otAdjust', 'noteLog'].forEach((k) => { data[k] = []; });
    Object.assign(data, { today: {}, kpis: {}, scores: {}, scoreRows: {}, sheets: {}, paid: {}, evals: {}, sheet: { month: monthKey(today()), status: 'مسودة', exists: false }, hrSettings: Object.assign({}, DEFAULTS) });
  }
  empty();
  function clear() { gen += 1; tgen += 1; unsubscribe(); Object.keys(raw).forEach((k) => { raw[k] = k === 'settings' ? {} : []; }); roster = []; pendingAdds.clear(); logRows = null; logAt = 0; logGen += 1; st = 'idle'; empty(); }
  const member = (code) => data.team.find((m) => m.id === code) || null;
  // the team the HR page lists: active, the ones hr.view lets me see (F all · P me + the members I manage · N me), without an admin
  // who has no pay row (the owner is not on the sheet)
  const visible = (m, p, mine) => p === 'F' || m.id === mine || (p === 'P' && m.manager === mine);
  function team() { // the staff: active, and an admin only with a salary (the prototype's rule — the sheets and the attendance tiles)
    const p = perm('hr.view'); const mine = me() ? me().member_code : null;
    return data.team.filter((m) => m.status === 'active' && visible(m, p, mine) && !(m.role === 'أدمن' && !(m.salary > 0)));
  }
  // decision 15 (the owner, 10 Nov: «مش ظاهر غير عضو واحد»): the team table lists everyone I may see — the suspended and the
  // salary-less admins too (tagged) — so they can be managed (file, password mail, suspend, delete)
  function everyone() { const p = perm('hr.view'); const mine = me() ? me().member_code : null; return data.team.filter((m) => visible(m, p, mine)); }
  const after = async (action, detail, id) => { log(action, detail, id); await load(); return { ok: true }; };
  async function rpc(name, args) { const cl = c(); if (!cl) return { error: { code: 'net' } }; try { return await cl.rpc(name, args); } catch (e) { return { error: { code: 'net' } }; } }
  async function write(q) { try { const r = await q; return r && r.error ? r : { data: r ? r.data : null }; } catch (e) { return { error: { code: 'net' } }; } }

  // ---------- the clock (decision 10; block 21) ----------
  // my session as the server has it (hr_shift_now's rule on the loaded rows): the open one within 20 hours, else today's latest — or null;
  // `done` = the minutes of that day's other closed sessions (decision 24: the day's hours are its sessions summed)
  function myShift() {
    const uid = myUid(); if (!uid) return null; const t = today(); const since = Date.now() - 20 * 3600000;
    const mine = raw.att.filter((a) => a.member_id === uid).sort((a, b) => (a.in_at < b.in_at ? 1 : -1));
    const row = mine.find((a) => !a.out_at && Date.parse(a.in_at) > since) || mine.find((a) => a.day === t) || null;
    if (!row) return null;
    const same = mine.filter((a) => a.day === row.day);
    const done = same.filter((a) => a.out_at && a.id !== row.id).reduce((n, a) => n + Math.max(0, Math.floor((Date.parse(a.out_at) - Date.parse(a.in_at)) / 60000)), 0);
    return { id: Number(row.id), day: row.day, in_at: row.in_at, out_at: row.out_at || null, remote: !!row.remote, done, sessions: same.length, ot_from: row.ot_from || null, ot_ticket: row.ot_ticket == null ? null : Number(row.ot_ticket) };
  }
  async function shiftNow() { const { data, error } = await rpc('hr_shift_now', {}); if (error) return fail(error); return { ok: true, shift: data || null }; }
  async function clockIn() { const { data, error } = await rpc('hr_clock_in', {}); if (error) return fail(error); log('hr.shift.start', data && data.remote ? 'عن بُعد' : ''); await load(); return { ok: true, shift: data }; } /* «عن بُعد» is the server's: an approved «شغل عن بُعد» covering today */
  // decision 25 (0069): overtime starts now (before 8 hours too) — the request ticket for the direct manager and the bell to the admins
  // decision 44 (0073): «طلب وقت إضافي» from the account menu — a day in the last 31, Cairo times, what was worked on; a «مستني» row with
  // its request ticket (the approvers decide it like the clock's)
  const OT_REQ_MSG = { day: 'اختار يوم من آخر 31 يوم لحد النهارده', from: 'اكتب وقت البداية', to: 'وقت النهاية لازم يكون عدّى', minutes: 'المدة من ربع ساعة لـ 12 ساعة',
    note: 'اكتب اشتغلت على إيه (لحد 300 حرف)', overlap: 'فيه طلب وقت إضافي تاني على نفس الوقت ده', open_shift: 'إنت لسه على الدوام — اقفل الدوام الأول وبعدين ابعت الطلب (وقت الدوام المفتوح بيتحسب لوحده)' };
  async function overtimeRequest({ day, from, to, note } = {}) {
    const { data, error } = await rpc('hr_overtime_request', { p_day: day || null, p_from: String(from || ''), p_to: String(to || ''), p_note: clean(note, 300) });
    if (error) { const r = fail(error); if (r.field && OT_REQ_MSG[r.field]) r.message = OT_REQ_MSG[r.field]; return r; }
    const t = data && data.ticket ? 'TKT-' + String(data.ticket).padStart(4, '0') : null; log('hr.overtime.request', (data && data.minutes) + ' دقيقة', t); await load();
    if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load());
    return { ok: true, ticket: t, minutes: (data && data.minutes) || 0, restDay: !!(data && data.rest_day) };
  }
  async function overtimeBegin() {
    const { data, error } = await rpc('hr_overtime_begin', {}); if (error) return fail(error);
    const t = data && data.ticket ? 'TKT-' + String(data.ticket).padStart(4, '0') : null; log('hr.overtime.begin', t || '', t); await load();
    if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load());
    return { ok: true, ticket: t, otFrom: (data && data.ot_from) || null };
  }
  async function clockOut(note, at) {
    const args = { p_ot_note: note ? clean(note, 300) : null, p_at: at ? new Date(at).toISOString() : null };
    const { data, error } = await rpc('hr_clock_out', args); if (error) return fail(error);
    log('hr.shift.end', (data && data.overtime ? 'وقت إضافي ' + data.overtime + ' د' : '') + (data && data.rest_day ? 'يوم راحة' : '')); await load(); return { ok: true, result: data };
  }
  // hr.edit F: a member's day by hand («تسجيل حضور يدوي» / «تصحيح»); in / out 'HH:MM' Cairo
  async function setAttendance(member, day, inT, outT, opts) {
    const uid = uidOf(member); if (!uid) return no('invalid', 'day');
    const { error } = await rpc('hr_attendance_set', { p_member: uid, p_day: day, p_in: inT, p_out: outT || null, p_remote: !!(opts && opts.remote), p_note: opts && opts.note ? clean(opts.note, 300) : null });
    if (error) return fail(error); return after('hr.attendance.manual', (byUid(uid) || {}).id + ' ' + day, uid);
  }
  // one session's end (hr.edit F; 0068 hr_attendance_close): 'HH:MM' Cairo on its day, or null = now (an open session only)
  async function closeSession(id, outT, note, member) {
    const { error } = await rpc('hr_attendance_close', { p_id: id, p_out: outT || null, p_note: note ? clean(note, 300) : null });
    if (error) return fail(error); return after('hr.attendance.close', (byUid(member) || {}).id || '', member || null);
  }
  // «إنهاء الدوام» for another member (hr.edit F): their open session closed at now — the day's other sessions stay
  async function endShiftFor(member) {
    const uid = uidOf(member); const a = data.attendance.find((x) => x.memberUid === uid && x.openId && x.date >= addDays(today(), -1));
    if (!a) return no('invalid', 'shift');
    return closeSession(a.openId, null, 'إنهاء الدوام — ' + nameOf(myUid()), uid);
  }
  // «تصحيح انصراف ناقص»: the request (if any) approved first (it closes the open session at its time), then the time typed on that session
  async function fixOut(a, outT, reason, reqDbId) {
    if (reqDbId) { const r = await decide(reqDbId, 'موافق'); if (!r.ok) return r; }
    if (a.openId) return closeSession(a.openId, outT, reason, a.memberUid || uidOf(a.member));
    return setAttendance(a.memberUid || a.member, a.date, hhmm(a.in), outT, { remote: a.remote, note: reason });
  }

  // ---------- requests ----------
  async function request(f) {
    const input = { type: f.type, from: f.from || null, to: f.to || null, time: f.time || null, hours: f.hours == null ? null : String(f.hours), amount: f.amount == null ? null : String(f.amount),
      months: f.months == null ? null : String(f.months), note: f.note ? clean(f.note, 500) : null, doc: f.doc || null };
    const uid = f.member ? uidOf(f.member) : null; if (uid && uid !== myUid()) input.member = uid;
    const { data, error } = await rpc('hr_request_create', { p_input: input }); if (error) return fail(error);
    const id = reqId(data); log('hr.request.create', id, id); /* no type: a sick leave is health information */ await load();
    if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load()); // decision 33: the request opened its team ticket
    const row = (window.IBHR.data.requests || []).find((x) => x.id === id); return { ok: true, id, ticket: row ? row.ticket : null }; // (data here is the RPC's answer)
  }
  async function decide(id, decision, reason) {
    const k = dbOf(id, ids.req); if (k == null) return no('invalid');
    const { error } = await rpc('hr_request_decide', { p_id: k, p_decision: decision, p_reason: reason ? clean(reason, 300) : null }); if (error) return fail(error);
    if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load()); // decision 33: the ticket closed with the decision
    return after(decision === 'موافق' ? 'hr.request.approve' : decision === 'مرفوض' ? 'hr.request.reject' : 'hr.request.review', reqId(k), reqId(k));
  }
  async function cancel(id) { const k = dbOf(id, ids.req); if (k == null) return no('invalid'); const { error } = await rpc('hr_request_cancel', { p_id: k }); if (error) return fail(error); if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load()); return after('hr.request.cancel', reqId(k), reqId(k)); }

  // ---------- overtime (decision 9) ----------
  async function overtimeDecide(id, decision, minutes, reason) {
    const k = dbOf(id, ids.ot); if (k == null) return no('invalid');
    const { error } = await rpc('hr_overtime_decide', { p_id: k, p_decision: decision, p_minutes: minutes == null ? null : Math.round(Number(minutes)), p_reason: reason ? clean(reason, 300) : null });
    if (error) return fail(error);
    const r = await after(decision === 'add' ? 'hr.overtime.add' : 'hr.overtime.reject', otId(k) + (decision === 'add' && minutes ? ' ' + Math.round(Number(minutes)) + 'د' : ''), otId(k));
    if (window.IBTickets && window.IBTickets.load) quiet(() => window.IBTickets.load()); // decision 25: the request ticket closed with the decision
    return r;
  }

  // ---------- performance (decision 4: by hand) ----------
  async function rateMonth(member, month, actuals, note) {
    const uid = uidOf(member); if (!uid) return no('invalid');
    const a = {}; Object.keys(actuals || {}).forEach((k) => { a[String(k)] = Number(actuals[k]); });
    const { data, error } = await rpc('hr_rate_month', { p_member: uid, p_month: monthStart(monthKey(month)), p_actuals: a, p_note: note ? clean(note, 500) : null });
    if (error) return fail(error); log('hr.kpi.rate', (byUid(uid) || {}).id + ' ' + monthKey(month), uid); /* no score */ await load(); return { ok: true, score: Number(data) };
  }
  // the member's KPIs: the rows given (weights adding to 100) replace the active ones; a row not given is deactivated
  async function saveKpis(member, list) {
    const cl = c(); const uid = uidOf(member); if (!cl || !uid) return no('network');
    if (!can().edit) return no('forbidden');
    const items = (list || []).map((k, i) => ({ id: k.id || null, name: clean(k.name, 120), src: clean(k.src || 'يدوي', 60) || 'يدوي', weight: Number(k.weight), target: Number(k.target), inverse: !!k.inverse, sort: i }));
    if (!items.length || items.some((k) => !k.name || !(k.weight > 0) || !(k.target > 0))) return no('invalid', 'actual');
    if (Math.abs(items.reduce((n, k) => n + k.weight, 0) - 100) > 0.01) return no('invalid', 'weights');
    const keep = new Set(items.filter((k) => k.id).map((k) => Number(k.id)));
    for (const k of raw.kpis.filter((x) => x.member_id === uid && x.active && !keep.has(Number(x.id)))) { const r = await write(cl.from('hr_kpis').update({ active: false }).eq('id', k.id)); if (r.error) return fail(r.error); }
    for (const k of items) {
      const row = { name: k.name, src: k.src, weight: k.weight, target: k.target, inverse: k.inverse, sort: k.sort, active: true };
      const r = k.id ? await write(cl.from('hr_kpis').update(row).eq('id', k.id)) : await write(cl.from('hr_kpis').insert(Object.assign({ member_id: uid }, row)));
      if (r.error) return fail(r.error);
    }
    return after('hr.kpi.define', (byUid(uid) || {}).id + ' · ' + items.length + ' مؤشر', uid);
  }

  // ---------- the payroll (decisions 3 / 8 / 14) ----------
  const monthArg = (m) => monthStart(monthKey(m || today()));
  async function payrollCalc(month) {
    const { data, error } = await rpc('hr_payroll_calc', { p_month: monthArg(month) }); if (error) return fail(error);
    return { ok: true, lines: (data || []).map(line) };
  }
  const LINE_COLS = 'month, member_id, name, salary, holdback, paid, ot_minutes, ot_pay, rest_days, rest_pay, unpaid_days, unpaid_cut, allowances, deductions, advance, quarter_bonus, net, leave_days_paid, leave_pay';
  async function payrollLines(month) {
    const cl = c(); if (!cl) return no('network');
    try { const list = await rows(cl.from('hr_payroll_lines').select(LINE_COLS).eq('month', monthArg(month)));
      return { ok: true, lines: list.map(line) }; } catch (e) { return fail(e); }
  }
  // the month's lines as the sheet reads them: snapshotted once paid (or approved — 0046's steps), live from hr_payroll_calc before; 0083:
  // a member paid already this month (early or one by one) keeps the line they were paid on, with `transfer` { amount, account, early, at }
  async function sheetLines(month) {
    const k = monthKey(month || today()); const sh = data.sheets[k]; const paidNow = data.paid[k] || {};
    const mark = (l) => Object.assign(l, { transfer: paidNow[l.member] || null });
    if (sh && (sh.status === 'معتمد' || sh.status === 'مدفوع')) { const r = await payrollLines(k); if (r.ok) r.lines.forEach(mark); return r; }
    const live = await payrollCalc(k); if (!live.ok || !Object.keys(paidNow).length) { if (live.ok) live.lines.forEach(mark); return live; }
    const snap = await payrollLines(k); const kept = new Map(((snap.ok && snap.lines) || []).filter((l) => paidNow[l.member]).map((l) => [l.member, l]));
    return { ok: true, lines: live.lines.map((l) => mark(kept.get(l.member) || l)) };
  }
  // the totals of the lines «تحويل المرتبات» shows under its table — what is left to transfer counts the members not paid yet only
  function sheetTotals(lines) {
    const sum = (f, l) => Math.round(l.reduce((n, x) => n + (Number(f(x)) || 0), 0) * 100) / 100;
    const all = lines || []; const left = all.filter((l) => !l.transfer);
    return { members: all.length, salaries: sum((x) => x.paid, all), bonus: sum((x) => x.quarterBonus, all), overtime: sum((x) => x.otPay + x.restPay, all),
      extras: sum((x) => x.allow + x.leavePay, all), cuts: sum((x) => x.ded + x.advance + x.unpaidCut, all), net: sum((x) => Math.max(0, x.net), all),
      paidAlready: sum((x) => (x.transfer ? x.transfer.amount : 0), all), toTransfer: sum((x) => Math.max(0, x.net), left), left: left.length };
  }
  const line = (r) => ({ member: codeOf(r.member_id) || r.member_id, memberUid: r.member_id, name: r.name, salary: Number(r.salary), holdback: Number(r.holdback), paid: Number(r.paid), otMin: Number(r.ot_minutes) || 0,
    otPay: Number(r.ot_pay) || 0, rest: Number(r.rest_days) || 0, restPay: Number(r.rest_pay) || 0, unpaidDays: Number(r.unpaid_days) || 0, unpaidCut: Number(r.unpaid_cut) || 0, allow: Number(r.allowances) || 0,
    ded: Number(r.deductions) || 0, advance: Number(r.advance) || 0, quarterBonus: Number(r.quarter_bonus) || 0, net: Number(r.net) || 0, missingScores: r.missing_scores == null ? 0 : Number(r.missing_scores),
    leaveDays: Number(r.leave_days_paid) || 0, leavePay: Number(r.leave_pay) || 0 });
  // «ملفي › مرتبي» (T7): a member's payslips — mine through hr_my_slips (the approved / paid months with the sheet's status, never
  // its total); another member's (sensitive.salaries) from hr_payroll_lines with the statuses of the sheets I read
  async function slips(member) {
    const cl = c(); const uid = uidOf(member); if (!cl || !uid) return no('network');
    if (uid === myUid()) {
      const { data: d, error } = await rpc('hr_my_slips', {}); if (error) return fail(error);
      return { ok: true, list: (Array.isArray(d) ? d : []).map((r) => Object.assign(line(Object.assign({}, r, { member_id: uid })), { month: monthKey(r.month), status: r.status, paidAt: r.paid_at || null })) };
    }
    try {
      const list = await rows(cl.from('hr_payroll_lines').select(LINE_COLS).eq('member_id', uid).order('month', { ascending: false }).limit(36));
      const code = codeOf(uid);
      return { ok: true, list: list.map((r) => { const k = monthKey(r.month); const x = (data.paid[k] || {})[code];
        return Object.assign(line(r), { month: k, status: x ? 'مدفوع' : (data.sheets[k] || {}).status || 'معتمد', paidAt: x ? x.at : null }); }) };
    } catch (e) { return fail(e); }
  }
  // «ملفي › بيانات الحساب» (phase 13 decision 39, 0072): the bank account — the member types their own; it comes back masked
  // («•••• 1234»); the full number only through bankReveal (mine, or an admin / sensitive.salaries — the server logs every reveal)
  // security review (0072): enrolled in 2FA (or 2FA forced) = an aal2 session only — the server says 'aal2_required'
  const bankFail = (e) => (/aal2_required/.test(String((e && e.message) || '')) ? { ok: false, reason: 'aal1', field: null, message: 'ادخل بالتحقق بخطوتين الأول — اخرج وادخل تاني بالكود' } : fail(e));
  const bankShape = (d) => (d ? { bankName: d.bank_name || '', holder: d.holder || '', account: d.account || '', iban: d.iban || '', at: d.updated_at || null } : null);
  async function bank(member) {
    const uid = member ? uidOf(member) : myUid(); if (!uid) return no('network');
    const { data: d, error } = await rpc('hr_bank_get', { p_member: uid }); if (error) return bankFail(error); return { ok: true, bank: bankShape(d) };
  }
  async function bankSet(input) {
    const v = input || {};
    const { data: d, error } = await rpc('hr_bank_set', { p_input: { bank_name: String(v.bankName || '').trim(), holder: String(v.holder || '').trim(), account_number: String(v.number || '').trim(), iban: String(v.iban || '').trim() } });
    if (error) return bankFail(error); return { ok: true, bank: bankShape(d) };
  }
  async function bankReveal(member) {
    const uid = member ? uidOf(member) : myUid(); if (!uid) return no('network');
    const { data: d, error } = await rpc('hr_bank_reveal', { p_member: uid }); if (error) return bankFail(error);
    return { ok: true, bank: { bankName: d.bank_name || '', holder: d.holder || '', number: d.account_number || '', iban: d.iban || '' } };
  }
  // ---------- the HR rebuild (0083): «تحويل المرتبات», one member's pay, an advance, the overtime fix, the evaluation ----------
  // the server logs each one (hr.payroll.paid / hr.payroll.member / hr.advance.give / hr.overtime.adjust / hr.evaluate — months and codes only)
  const accountsChanged = () => { const A = window.IBAccounts; if (A && A.load) quiet(() => A.load()); }; // the expenses and the withdrawals are the accounts' rows
  const payDayOf = (month) => { const k = monthKey(month || today()); const last = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).getUTCDate();
    const d = Math.min(Math.max(1, Math.round(Number(settings().payDay) || 28)), last); return k + '-' + String(d).padStart(2, '0'); };
  const early = (month) => today() < payDayOf(month); // before the month's pay day = an early transfer (its reason is a must)
  async function transfer(month, account) {
    if (!ACCOUNTS.includes(account)) return no('invalid', 'account');
    const { data: d, error } = await rpc('hr_payroll_transfer', { p_month: monthArg(month), p_account: account }); if (error) return fail(error);
    accountsChanged(); await load(); return { ok: true, total: Number(d) || 0 };
  }
  async function payMember(month, member, account, reason) {
    const uid = uidOf(member); if (!uid) return no('invalid'); if (!ACCOUNTS.includes(account)) return no('invalid', 'account');
    const why = clean(reason, 300); if (early(month) && !why) return no('invalid', 'reason');
    const { data: d, error } = await rpc('hr_pay_member', { p_month: monthArg(month), p_member: uid, p_account: account, p_reason: why || null }); if (error) return fail(error);
    accountsChanged(); await load(); return { ok: true, net: Number(d) || 0 };
  }
  async function advanceGive(member, amount, reason, account) {
    const uid = uidOf(member); if (!uid) return no('invalid'); const a = Math.round(Number(amount) * 100) / 100;
    if (!(a > 0) || a > 1000000) return no('invalid', 'amount'); const why = clean(reason, 300); if (!why) return no('invalid', 'reason'); if (!ACCOUNTS.includes(account)) return no('invalid', 'account');
    const { data: d, error } = await rpc('hr_advance_give', { p_member: uid, p_amount: a, p_reason: why, p_account: account }); if (error) return fail(error);
    accountsChanged(); await load(); return { ok: true, id: reqId(d) };
  }
  async function otAdjust(member, month, minutes, reason) {
    const uid = uidOf(member); if (!uid) return no('invalid'); const m = Math.round(Number(minutes));
    if (!m || Math.abs(m) > 6000) return no('invalid', 'minutes'); const why = clean(reason, 300); if (!why) return no('invalid', 'reason');
    const { error } = await rpc('hr_ot_adjust_add', { p_member: uid, p_month: monthArg(month), p_minutes: m, p_reason: why }); if (error) return fail(error);
    await load(); return { ok: true };
  }
  // the month's total out of 5 (the server's hr_eval_total): the average of the three, of the two when no working day was asked
  const evalTotal = (att, perf, comm) => (perf == null || comm == null ? null : Math.round((att == null ? (perf + comm) / 2 : (att + perf + comm) / 3) * 10) / 10);
  async function evaluate(member, month, perf, comm, note) {
    const uid = uidOf(member); if (!uid) return no('invalid'); const p = Math.round(Number(perf)); const q = Math.round(Number(comm));
    if (!(p >= 1 && p <= 5)) return no('invalid', 'performance'); if (!(q >= 1 && q <= 5)) return no('invalid', 'communication');
    const { data: d, error } = await rpc('hr_evaluate', { p_member: uid, p_month: monthArg(month), p_perf: p, p_comm: q, p_note: note ? clean(note, 500) : null }); if (error) return fail(error);
    await load(); return { ok: true, total: d == null ? null : Number(d) };
  }
  // ---------- owner batch 14 Nov decision 13 (0089): a note on a member's evaluation — «حدد ميتنج» · «ابعت إنذار» · «خطة تحسين» · «ابعت شكر» ----------
  // the server checks who (the admin, hr.edit F, the direct manager — never oneself), opens the meeting's team request, rings the member's
  // bell and logs hr.note.add with the kind and the period only
  const NOTE_KINDS = { meeting: 'ميتنج فردي', warning: 'إنذار', plan: 'خطة تحسين', thanks: 'شكر' };
  const cleanText = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
  // a Cairo day + HH:MM → an ISO instant (Cairo is UTC+2, UTC+3 in its summer time)
  function cairoIso(day, hhmm) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hhmm || ''))) return null;
    const want = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    for (const off of [2, 3]) { const t = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 0, want) - off * 3600000); const p0 = parts(t.toISOString()); if (p0 && p0.day === day && p0.min === want) return t.toISOString(); }
    return null;
  }
  async function noteAdd(member, kind, period, body, due) {
    const uid = uidOf(member); if (!uid) return no('invalid'); if (!NOTE_KINDS[kind]) return no('invalid', 'kind');
    if (!/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/.test(String(period || ''))) return no('invalid', 'period');
    const text = cleanText(body, 1001); if (text.length > 1000) return no('invalid', 'body'); if ((kind === 'warning' || kind === 'plan') && !text) return no('invalid', 'body');
    let at = null; if (due && (kind === 'meeting' || kind === 'plan')) { at = due.day ? cairoIso(due.day, due.time || '10:00') : null; if (!at) return no('invalid', 'due'); }
    if (kind === 'meeting' && (!at || new Date(at).getTime() < Date.now() - 600000)) return no('invalid', 'due');
    const { data: d, error } = await rpc('hr_member_note_add', { p_member: uid, p_kind: kind, p_period: period, p_body: text || null, p_due: at }); if (error) return fail(error);
    await load(); return { ok: true, id: d && d.id != null ? Number(d.id) : null, ticket: d && d.ticket != null ? Number(d.ticket) : null };
  }
  const notesOf = (code, period) => data.noteLog.filter((x) => x.member === code && (!period || x.period === period));
  // a quarter (YYYY-Q1…4) from its months: each part the average of the months that have it, the total the average of the rated months'
  function quarterEval(code, q) {
    const m = /^(\d{4})-Q([1-4])$/.exec(String(q || '')); if (!m) return null;
    const months = [1, 2, 3].map((i) => m[1] + '-' + String((Number(m[2]) - 1) * 3 + i).padStart(2, '0')); const ev = data.evals[code] || {};
    const avg = (l) => (l.length ? Math.round(l.reduce((n, x) => n + x, 0) / l.length * 10) / 10 : null);
    const rows = months.map((k) => ev[k]).filter(Boolean); const rated = rows.filter((x) => x.total != null);
    return { quarter: q, months, att: avg(rows.map((x) => x.att).filter((x) => x != null)), perf: avg(rated.map((x) => x.perf)), comm: avg(rated.map((x) => x.comm)),
      total: avg(rated.map((x) => x.total)), rated: rated.length, missing: months.filter((k) => k <= monthKey(today()) && !(ev[k] && ev[k].total != null)).length };
  }
  // the member's tasks of a month for the evaluator (decision 2): the ones done in it and the ones still open
  function monthTasks(code, month) {
    const k = monthKey(month || today()); const end = k + '-31'; const mine = (data.tasks || []).filter((x) => x.member === code);
    return { done: mine.filter((x) => x.status === 'خلصت' && String(x.doneDay || x.day || '').startsWith(k)), open: mine.filter((x) => x.status !== 'خلصت' && String(x.day || '') <= end) };
  }
  async function payrollOpen(month) { const { error } = await rpc('hr_payroll_open', { p_month: monthArg(month) }); if (error) return fail(error); await load(); return { ok: true }; }
  async function payrollStep(month, step) { const { error } = await rpc('hr_payroll_step', { p_month: monthArg(month), p_step: step }); if (error) return fail(error); return after(step === 'معتمد' ? 'hr.payroll.approve' : 'hr.payroll.review', monthKey(month) + ' → ' + step); }
  async function payrollPay(month, account) {
    if (!ACCOUNTS.includes(account)) return no('invalid', 'account');
    const { data, error } = await rpc('hr_payroll_pay', { p_month: monthArg(month), p_account: account }); if (error) return fail(error);
    const A = window.IBAccounts; if (A && A.load) quiet(() => A.load()); // the expenses and the withdrawal are the accounts' rows
    log('hr.payroll.paid', monthKey(month) + ' · ' + account); await load(); return { ok: true, total: Number(data) };
  }
  async function addAdjustment(f) {
    const cl = c(); const uid = uidOf(f.member); if (!cl || !uid) return no('network');
    const amount = Number(f.amount); const kind = f.kind === 'achievement' ? 'achievement' : 'adjust';
    if (!(Math.abs(amount) > 0) || (kind === 'achievement' && amount < 0)) return no('invalid', 'amount');
    const r = await write(cl.from('hr_adjustments').insert({ member_id: uid, month: monthArg(f.month), amount, label: clean(f.label, 80), note: f.note ? clean(f.note, 300) : null, kind }));
    if (r.error) return fail(r.error); return after(kind === 'achievement' ? 'hr.achievement' : 'hr.payroll.adjust', (byUid(uid) || {}).id + ' · ' + monthKey(f.month || today()), uid); // no label, no amount
  }
  async function voidAdjustment(id) { const cl = c(); if (!cl) return no('network'); const r = await write(cl.from('hr_adjustments').update({ voided_at: new Date().toISOString() }).eq('id', id)); if (r.error) return fail(r.error); return after('hr.payroll.adjust.void', String(id)); }
  async function addExtra(f) {
    const cl = c(); const uid = uidOf(f.member); if (!cl || !uid) return no('network');
    const r = await write(cl.from('hr_extras').insert({ member_id: uid, quarter: f.quarter || quarterOf(monthKey(today())), rule: clean(f.rule, 80), amount: Number(f.amount) }));
    if (r.error) return fail(r.error); return after('hr.extra.create', (byUid(uid) || {}).id + ' · ' + (f.quarter || quarterOf(monthKey(today()))), uid);
  }
  async function decideExtra(id, approve) {
    const cl = c(); if (!cl) return no('network');
    const r = await write(cl.from('hr_extras').update({ status: approve ? 'معتمدة' : 'مرفوضة', decided_by: myUid(), decided_at: new Date().toISOString() }).eq('id', id));
    if (r.error) return fail(r.error); return after('hr.extra.decision', id + ' ' + (approve ? 'yes' : 'no'));
  }

  // ---------- meetings ----------
  const MEET_STATUS = ['مطلوب', 'اتحدد ميعاد', 'خطة شغالة', 'اتقفلت'];
  function meetingRow(f) {
    const out = {};
    if (f.reason !== undefined) out.reason = clean(f.reason, 200);
    if (f.status !== undefined) { if (!MEET_STATUS.includes(f.status)) return null; out.status = f.status; }
    if (f.date !== undefined) out.day = f.date || null;
    if (f.time !== undefined) out.time_text = f.time ? clean(f.time, 20) : null;
    if (f.place !== undefined) out.place = f.place ? clean(f.place, 80) : null;
    if (f.outcome !== undefined) out.outcome = f.outcome ? clean(f.outcome, 80) : null;
    if (f.plan !== undefined) out.plan = f.plan ? clean(f.plan, 200) : null;
    if (f.goals !== undefined) out.goals = (Array.isArray(f.goals) ? f.goals : []).slice(0, 12).map((g) => ({ t: clean(g.t, 200), s: ['جاري', 'اتحقق', 'متأخر'].includes(g.s) ? g.s : 'جاري', how: clean(g.how || 'يدوي', 120) }));
    if (f.support !== undefined) out.support = f.support ? clean(f.support, 300) : null;
    if (f.review !== undefined) out.review_on = f.review || null;
    if (f.progress !== undefined) out.progress = f.progress == null ? null : Math.max(0, Math.min(100, Math.round(Number(f.progress))));
    if (f.notes !== undefined) out.notes = f.notes ? clean(f.notes, 1000) : null;
    return out;
  }
  async function meetingCreate(f) {
    const cl = c(); const uid = uidOf(f.member); if (!cl || !uid) return no('network');
    const row = meetingRow(Object.assign({ status: 'مطلوب' }, f)); if (!row || !row.reason) return no('invalid', 'reason');
    const r = await write(cl.from('hr_meetings').insert(Object.assign({ member_id: uid }, row))); if (r.error) return fail(r.error);
    return after('hr.meeting.create', (byUid(uid) || {}).id, uid);
  }
  async function meetingUpdate(id, f) {
    const cl = c(); const k = dbOf(id, ids.meet); if (!cl || k == null) return no('invalid');
    const row = meetingRow(f); if (!row) return no('invalid', 'status');
    const r = await write(cl.from('hr_meetings').update(row).eq('id', k)); if (r.error) return fail(r.error);
    return after('hr.meeting.update', mtId(k), mtId(k)); // no outcome (a warning is HR information)
  }

  // ---------- the lists + the settings (hr.edit F / the admin) ----------
  async function table(name, op, row, match, action, detail) {
    const cl = c(); if (!cl) return no('network');
    let q = cl.from(name); q = op === 'insert' ? q.insert(row) : op === 'update' ? q.update(row) : q.delete();
    if (match) Object.keys(match).forEach((k) => { q = q.eq(k, match[k]); });
    const r = await write(q); if (r.error) return fail(r.error); return after(action, detail);
  }
  const holidayAdd = (f) => table('hr_holidays', 'insert', { name: clean(f.name, 80), day: f.date, days: Math.max(1, Math.min(14, Number(f.days) || 1)), kind: clean(f.kind || 'رسمية', 40), status: f.status === 'متوقع' ? 'متوقع' : 'مؤكد' }, null, 'hr.holiday.create', clean(f.name, 80));
  const holidayConfirm = (dbId) => table('hr_holidays', 'update', { status: 'مؤكد' }, { id: dbId }, 'hr.holiday.confirm', String(dbId));
  const holidayDelete = (dbId) => table('hr_holidays', 'delete', null, { id: dbId }, 'hr.holiday.delete', String(dbId));
  const leaveTypeAdd = (f) => table('hr_leave_types', 'insert', { name: clean(f.name, 40), days: clean(f.days, 40) || '—', paid: clean(f.paid || 'نعم', 40), doc: clean(f.doc || '—', 60) || '—', carry: clean(f.carry || '—', 40),
    approval: clean(f.approval || 'المدير المباشر', 40), deducts: !!f.deducts, unpaid: f.paid === 'لا' || !!f.unpaid, sort: 100 }, null, 'hr.leaveType.create', clean(f.name, 40));
  const bonusRuleAdd = (f) => table('hr_bonus_rules', 'insert', { name: clean(f.name, 80), cond: clean(f.cond, 200), amount: Number(f.amount), active: true }, null, 'hr.bonusRule.create', clean(f.name, 80));
  const bonusRuleToggle = (dbId, on) => table('hr_bonus_rules', 'update', { active: !!on }, { id: dbId }, 'hr.bonusRule.toggle', dbId + ' ' + (on ? 'on' : 'off'));
  const otPeriodAdd = (f) => table('hr_ot_periods', 'insert', { range_text: clean(f.range, 80), scope: clean(f.scope || 'كل الفريق', 80), counts: !!f.count }, null, 'hr.otPeriod', clean(f.range, 80));
  const otPeriodDelete = (dbId) => table('hr_ot_periods', 'delete', null, { id: dbId }, 'hr.otPeriod.delete', String(dbId));
  // the settings row «hr» (the admin — 0002): merged over what is there (departments kept)
  async function saveSettings(patch) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden');
    const next = Object.assign({}, raw.settings || {}); Object.keys(patch || {}).forEach((k) => { if (k in DEFAULTS || k === 'departments') next[k] = patch[k]; });
    const r = await write(cl.from('settings').upsert({ section: 'hr', data: next }, { onConflict: 'section' })); if (r.error) return fail(r.error);
    raw.settings = next; // the clock and the pages follow at once (0087's hours), before the reload
    return after('hr.settings', Object.keys(patch || {}).join(', '));
  }
  const addDepartment = (name) => { const n = clean(name, 40); const list = data.departments || []; if (!n) return Promise.resolve(no('invalid')); if (list.includes(n)) return Promise.resolve(no('exists'));
    return saveSettings({ departments: list.concat([n]) }); };

  // ---------- the members (decisions 5 / 6 / 13) ----------
  async function invoke(body) {
    const cl = c(); if (!cl) return no('network');
    try {
      const { data: out, error } = await cl.functions.invoke('team-admin', { body });
      if (error || !out) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const code = b && typeof b.error === 'string' ? b.error : ''; const field = b && b.field ? String(b.field) : null;
        const reason = code === 'exists' || s === 409 ? 'exists' : s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 404 ? 'notfound' : 'network';
        return { ok: false, reason, field, code, status: s, raw: b, message: (field && reason === 'exists' && FIELD_MESSAGES[field]) || (field === 'role' ? 'الدور مش موجود' : field === 'manager_id' ? 'المدير مش موجود' : null) || MESSAGES[reason] };
      }
      return { ok: true, body: out };
    } catch (e) { return no('network'); }
  }
  // «إضافة عضو»: the login + the profile + the HR row (team-admin), then the pay (hr_pay); the password is returned once, never kept
  async function memberCreate(f) {
    if (!can().admin) return no('forbidden');
    const r = await invoke({ action: 'member_create', name: f.name, email: f.email, phone: f.phone || '', role: f.role, title: f.title || '', dept: f.dept || '', manager_id: uidOf(f.manager) || '',
      shift_start: f.shiftStart || '09:00', shift_end: f.shiftEnd || '17:00', hire_date: f.hire || '' });
    if (!r.ok) return r;
    // decision 14: mailed = the set-your-password link went to the member (no password in the answer); else the temporary password as before
    const id = r.body.id; const out = { ok: true, uid: id, code: r.body.member_code, mailed: r.body.mailed === true, email: r.body.email || null, password: r.body.password || null, payOk: true };
    const cl = c();
    if (cl && (Number(f.salary) > 0 || Number(f.allow) > 0)) {
      const p = await write(cl.from('hr_pay').upsert({ member_id: id, salary: Number(f.salary) || 0, holdback: Number(f.holdback) || 0, allowances: Number(f.allow) || 0 }, { onConflict: 'member_id' }));
      if (p.error) out.payOk = false;
    }
    if (cl && f.leave != null && f.leave !== '') await write(cl.from('hr_members').update({ leave_days: Number(f.leave) }).eq('member_id', id));
    const D = window.IBDirectory; if (D && D.refresh) { try { await D.refresh(); } catch (e) { /* the next sign-in picks it up */ } }
    await load(); // team-admin wrote hr.member.create itself (the id and the name)
    return out;
  }
  // decision 14: the set-your-password mail again (the admin; an active member who is not me)
  async function memberInvite(member) { if (!can().admin) return no('forbidden'); const uid = uidOf(member); if (!uid) return no('invalid'); const r = await invoke({ action: 'member_invite', member_id: uid });
    if (r.ok) return { ok: true, mailed: true };
    const code = r.code || ''; return code === 'not_configured' || r.status === 503 ? { ok: false, reason: 'invalid', message: 'الإيميل مش متظبط — اربط Resend من الإعدادات › الربط والمفاتيح، أو اعمل باسورد مؤقت' } : code === 'inactive' ? { ok: false, reason: 'invalid', message: 'العضو موقوف — فعّله الأول' } : code === 'mail_failed' ? { ok: false, reason: 'network', message: 'الإيميل ماتبعتش — جرّب تاني أو اعمل باسورد مؤقت' } : r; }
  // decision 15: a member deleted for good (the admin; not me) — team-admin → member_delete (0066): a trace anywhere refuses it
  const TABLE_AR = { activity_log: 'سجل النشاط', profiles: 'الفريق (بيدير أعضاء)', orders: 'الأوردرات', order_events: 'الأوردرات', tickets: 'التذاكر', ticket_events: 'التذاكر', cs_messages: 'خدمة العملاء', cs_conversations: 'خدمة العملاء', hr_attendance: 'الحضور', hr_overtime: 'الوقت الإضافي', hr_requests: 'طلبات الموارد البشرية', hr_adjustments: 'تسويات المرتب', hr_extras: 'المكافآت', hr_scores: 'التقييمات', hr_meetings: 'الميتنجات', hr_documents: 'المستندات', hr_tasks: 'المهام', hr_payroll_lines: 'كشوف المرتبات' };
  async function memberDelete(member) { if (!can().admin) return no('forbidden'); const uid = uidOf(member); if (!uid) return no('invalid'); const r = await invoke({ action: 'member_delete', member_id: uid });
    if (r.ok) { const D = window.IBDirectory; if (D && D.refresh) { try { await D.refresh(); } catch (e) { /* the next load */ } } await load(); return { ok: true, name: r.body.name || '' }; }
    const code = r.code || '';
    if (code === 'has_records') { const table = (r.raw && r.raw.table) || ''; return { ok: false, reason: 'exists', message: 'العضو له سجل' + (table ? ' في «' + (TABLE_AR[table] || table) + '»' : '') + ' — اوقفه بدل ما تمسحه' }; }
    if (code === 'last_admin') return { ok: false, reason: 'invalid', message: 'ده آخر أدمن نشط — اعمل أدمن تاني الأول' };
    if (code === 'owner') return { ok: false, reason: 'forbidden', message: 'حساب صاحب السيستم مابيتمسحش' };
    if (r.reason === 'notfound') return { ok: false, reason: 'notfound', message: 'العضو مش موجود (اتمسح قبل كده؟)' };
    return r; }
  async function memberPassword(member) { if (!can().admin) return no('forbidden'); const uid = uidOf(member); if (!uid) return no('invalid'); const r = await invoke({ action: 'member_password', member_id: uid }); return r.ok ? { ok: true, password: r.body.password } : r; }
  // the member's HR data (hr.edit F) and pay (sensitive.salaries F)
  async function memberUpdate(member, f) {
    const cl = c(); const uid = uidOf(member); if (!cl || !uid) return no('network');
    const row = { member_id: uid };
    if (f.shift) { row.shift_start = f.shift[0]; row.shift_end = f.shift[1]; }
    if (f.hire !== undefined) row.hire_date = f.hire || null;
    if (f.leave !== undefined) row.leave_days = Number(f.leave);
    // the internal notes go through hr_member_note_set (hr.edit F, not my own row — the column is closed to members)
    if (f.notes !== undefined) { const n = await write(cl.rpc('hr_member_note_set', { p_member: uid, p_notes: f.notes ? clean(f.notes, 500) : null })); if (n.error) return fail(n.error); }
    if (Object.keys(row).length > 1) { const r = await write(cl.from('hr_members').upsert(row, { onConflict: 'member_id' })); if (r.error) return fail(r.error); }
    return after('hr.member.update', (byUid(uid) || {}).id + ' · ' + Object.keys(f).join(', '), uid);
  }
  async function payUpdate(member, f) {
    const cl = c(); const uid = uidOf(member); if (!cl || !uid) return no('network');
    const salary = Number(f.salary) || 0; const holdback = Number(f.holdback) || 0; const allow = Number(f.allow) || 0;
    if (salary < 0 || holdback < 0 || holdback > salary || allow < 0) return no('invalid', 'amount');
    const r = await write(cl.from('hr_pay').upsert({ member_id: uid, salary, holdback, allowances: allow }, { onConflict: 'member_id' })); if (r.error) return fail(r.error);
    return after('hr.pay.update', (byUid(uid) || {}).id, uid);
  }

  // ---------- «ملفي › مهامي» (decision 25, 0048): hr_tasks under RLS, written through hr_task_add / set / delete / review ----------
  // Each write shows at once (the row changes here first) and the server's rows come back right after; a failed write puts the row
  // back. A task added a moment ago has a temporary negative id until the server answers — a click on it waits for the real one.
  let tgen = 0; let tmpSeq = 0; const pendingAdds = new Map();
  const absent = (e) => /^(42P01|42883|PGRST20[25])$/.test(String((e && e.code) || '')); // the migration not applied yet
  async function soft(q) { const { data: d, error } = await q; if (error) { if (absent(error)) return []; throw error; } return Array.isArray(d) ? d : []; }
  async function taskRows(cl, t) {
    const [open, done, people] = await Promise.all([
      soft(cl.from('hr_tasks').select(TASK_COLS).neq('status', 'خلصت').order('id').limit(3000)),
      soft(cl.from('hr_tasks').select(TASK_COLS).eq('status', 'خلصت').gte('done_at', addDays(t, -TASK_DONE_DAYS)).order('done_at', { ascending: false }).limit(2000)),
      soft(cl.rpc('hr_task_people')),
    ]);
    return { rows: open.concat(done), people };
  }
  const personOf = (x) => { const s = String(x == null ? '' : x); if (!s) return null; return data.people.find((p) => p.uid === s || p.code === s || p.name === s) || null; };
  function shapeTasks() {
    const P = new Map((raw.people || []).map((p) => [p.id, p]));
    const nm = (uid) => (!uid ? null : (P.get(uid) || {}).name || (byUid(uid) || {}).name || '—');
    const cd = (uid) => (!uid ? null : (P.get(uid) || {}).member_code || codeOf(uid));
    data.people = (raw.people || []).map((p) => ({ uid: p.id, code: p.member_code, name: p.name }));
    data.tasks = (raw.tasks || []).map((r) => ({ id: Number(r.id), member: cd(r.member_id), memberUid: r.member_id, memberName: nm(r.member_id), title: r.title, status: r.status, day: r.day,
      reason: r.reason || null, reviewer: r.reviewer_id ? nm(r.reviewer_id) : null, reviewerUid: r.reviewer_id || null, until: r.until || null, reviewNote: r.review_note || null,
      doneAt: r.done_at || null, doneDay: r.done_at ? ((parts(r.done_at) || {}).day || null) : null, by: r.created_by ? nm(r.created_by) : null, byUid: r.created_by || null }))
      .sort((a, b) => a.id - b.id);
  }
  async function loadTasks() {
    const cl = c(); if (!cl || !myUid() || st !== 'ready') return { ok: false, reason: 'network' };
    const g = ++tgen;
    try { const r = await taskRows(cl, today()); if (g !== tgen) return { ok: false, reason: 'stale' }; raw.tasks = r.rows; raw.people = r.people; shapeTasks(); emit(); return { ok: true }; } catch (e) { return fail(e); }
  }
  // who writes a member's tasks (the server decides again): the member, their direct manager, hr.edit F on the members they see
  function canTask(code) {
    const mine = me() ? me().member_code : null; if (!code || !mine) return false; if (code === mine) return true;
    const m = member(code); if (!m || m.status !== 'active') return false;
    return m.manager === mine || can().edit;
  }
  // «حذف»: a member does not remove a task someone else put on them (the admin does)
  const canDeleteTask = (t) => !!t && canTask(t.member) && !(t.memberUid === myUid() && t.byUid && t.byUid !== myUid() && !can().admin);
  const tasksOf = (code) => data.tasks.filter((t) => t.member === code);
  const reviewsFor = (uid) => data.tasks.filter((t) => t.status === 'جاهزة للمراجعة' && t.reviewerUid && t.reviewerUid === (uid || myUid()));
  // the change shows before the call (no await first); a temporary id waits for the server's one
  const later = (id, fn) => Promise.resolve(pendingAdds.has(id) ? pendingAdds.get(id) : null).then((k) => (k > 0 ? fn(k) : no('invalid')));
  function taskAdd(code, title) {
    const cl = c(); const uid = uidOf(code) || (personOf(code) || {}).uid || myUid(); const ti = clean(title, 200);
    if (!cl || !uid) return Promise.resolve(no('network')); if (!ti) return Promise.resolve(no('invalid', 'title'));
    const tmp = -(++tmpSeq); const mm = me(); const p = personOf(uid);
    data.tasks.push({ id: tmp, member: codeOf(uid) || (p && p.code) || code, memberUid: uid, memberName: (p && p.name) || nameOf(uid), title: ti, status: 'لسه', day: today(), reason: null, reviewer: null, reviewerUid: null,
      until: null, reviewNote: null, doneAt: null, doneDay: null, by: mm ? mm.name : null, byUid: myUid(), pending: true });
    emit();
    const run = rpc('hr_task_add', { p_member: uid, p_title: ti }).then(async ({ data: id, error }) => {
      if (error) { data.tasks = data.tasks.filter((x) => x.id !== tmp); emit(); return { r: fail(error), id: null }; }
      log('hr.task.add', (p && p.code) || codeOf(uid) || '', String(id)); await loadTasks(); return { r: { ok: true, id: Number(id) }, id: Number(id) };
    });
    pendingAdds.set(tmp, run.then((x) => x.id));
    return run.then((x) => x.r);
  }
  // a status: { reason } for متوقفة, { reviewer: uid | code | name } for جاهزة للمراجعة, { until } or { indefinite: true } for اتأجلت
  function taskSet(id, status, f) {
    const k = Number(id); if (!(k > 0)) return k < 0 ? later(k, (r) => taskSet(r, status, f)) : Promise.resolve(no('invalid'));
    if (!TASK_STATUSES.includes(status)) return Promise.resolve(no('invalid', 'status'));
    const o = f || {}; const args = {}; const rv = status === 'جاهزة للمراجعة' ? personOf(o.reviewer) : null;
    if (status === 'متوقفة') { args.reason = clean(o.reason, 300); if (!args.reason) return Promise.resolve(no('invalid', 'reason')); }
    if (status === 'جاهزة للمراجعة') { if (!rv) return Promise.resolve(no('invalid', 'reviewer')); args.reviewer = rv.uid; }
    if (status === 'اتأجلت') { if (o.indefinite) args.indefinite = true; else { if (!o.until) return Promise.resolve(no('invalid', 'until')); args.until = o.until; } }
    const t = data.tasks.find((x) => x.id === k) || null; const before = t ? Object.assign({}, t) : null; const d = today();
    if (t) { Object.assign(t, { status, day: t.day < d ? d : t.day, reason: args.reason || null, reviewerUid: rv ? rv.uid : null, reviewer: rv ? rv.name : null, until: args.until || null, reviewNote: null,
      doneAt: status === 'خلصت' ? (t.doneAt || new Date().toISOString()) : null, doneDay: status === 'خلصت' ? (t.doneDay || d) : null }); emit(); }
    return rpc('hr_task_set', { p_id: k, p_status: status, p_args: args }).then(async ({ error }) => {
      if (error) { if (t && before) { Object.assign(t, before); emit(); } return fail(error); }
      log('hr.task.status', status, String(k)); await loadTasks(); return { ok: true };
    });
  }
  function taskDelete(id) {
    const k = Number(id); if (!(k > 0)) return k < 0 ? later(k, taskDelete) : Promise.resolve(no('invalid'));
    const t = data.tasks.find((x) => x.id === k) || null; const at = t ? data.tasks.indexOf(t) : -1; if (t) { data.tasks = data.tasks.filter((x) => x !== t); emit(); }
    return rpc('hr_task_delete', { p_id: k }).then(async ({ error }) => {
      if (error) { if (t && !data.tasks.some((x) => x.id === k)) { data.tasks.splice(Math.max(0, at), 0, t); emit(); } return fail(error); }
      log('hr.task.delete', '', String(k)); await loadTasks(); return { ok: true };
    });
  }
  // the reviewer: «تمام — خلصت» (ok) or «رجّعها» with a note
  async function taskReview(id, ok, note) {
    const k = Number(id); if (!(k > 0)) return no('invalid');
    const n = clean(note, 300); if (!ok && !n) return no('invalid', 'note');
    const { error } = await rpc('hr_task_review', { p_id: k, p_ok: !!ok, p_note: n || null });
    if (error) return fail(error);
    log('hr.task.review', ok ? 'ok' : 'back', String(k)); await loadTasks(); return { ok: true };
  }

  // ---------- documents + a leave's report (the bucket «hr-docs») ----------
  const safeName = (n) => { const base = String(n || 'file').replace(/^.*[\\/]/, ''); const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(base) || [])[1] || '';
    const stem = base.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'file'; return ext ? stem + '.' + ext.toLowerCase() : stem; };
  const rand = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10));
  const checkFile = (file) => (!file || typeof file.size !== 'number' ? 'invalid' : !MIME.includes(file.type) ? 'type' : file.size > MAX_BYTES ? 'size' : null);
  async function upload(file, member) {
    const cl = c(); const uid = uidOf(member) || myUid(); if (!cl || !uid) return no('network');
    const bad = checkFile(file); if (bad) return { ok: false, reason: 'invalid', field: bad, message: bad === 'size' ? 'الملف أكبر من 10 ميجا' : 'الملف صورة (PNG / JPG / WebP) أو PDF بس' };
    const path = uid + '/' + rand() + '-' + safeName(file.name);
    try { const { error } = await cl.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (error) return no('network');
      return { ok: true, path, name: clean(file.name, 120) || path.replace(/^.*\//, '') }; } catch (e) { return no('network'); }
  }
  async function addDocument(member, f) {
    const cl = c(); const uid = uidOf(member); if (!cl || !uid) return no('network');
    if (!DOC_KINDS.includes(f.kind)) return no('invalid');
    const r = await write(cl.from('hr_documents').insert({ member_id: uid, kind: f.kind, path: f.path, name: clean(f.name, 120) || 'file', start_on: f.start || null, end_on: f.end || null }));
    if (r.error) return fail(r.error); return after('hr.contract.upload', (byUid(uid) || {}).id, uid);
  }
  async function voidDocument(id) { const cl = c(); if (!cl) return no('network'); const r = await write(cl.from('hr_documents').update({ voided_at: new Date().toISOString() }).eq('id', id)); if (r.error) return fail(r.error); return after('hr.contract.void', String(id)); }
  const urls = new Map();
  async function fileUrl(path) {
    const cl = c(); if (!cl || !path) return null; const hit = urls.get(path); if (hit && hit.until > Date.now()) return hit.url;
    try { const { data: d, error } = await cl.storage.from(BUCKET).createSignedUrl(path, 600); if (error || !d || !d.signedUrl) return null; urls.set(path, { url: d.signedUrl, until: Date.now() + 540000 }); return d.signedUrl; } catch (e) { return null; }
  }

  // ---------- live ----------
  let live = null; let poll = null; let timer = null; let lastLive = 0;
  function subscribe() {
    const cl = c(); const cfg = window.IB_CONFIG || {}; if (!cl || !myUid() || cfg.realtime === false) return;
    if (!live) {
      try {
        live = cl.channel('hr', { config: { private: true } }).on('broadcast', { event: 'changed' }, onLive) // 0046: active members receive, nobody sends
          .on('broadcast', { event: 'tasks' }, onTasks) // 0048: a task changed — the tasks alone
          .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { const dead = live; live = null; if (dead) quiet(() => Promise.resolve(cl.removeChannel(dead)).catch(() => {})); } });
      } catch (e) { live = null; }
    }
    if (!poll && typeof setInterval === 'function') poll = setInterval(() => { check(); }, POLL_MS);
  }
  function onLive() { if (timer) clearTimeout(timer); const wait = Math.max(250, lastLive + 1500 - Date.now()); timer = setTimeout(() => { timer = null; if (st === 'ready') { lastLive = Date.now(); load(); } }, wait); }
  let ttimer = null; function onTasks() { if (ttimer) clearTimeout(ttimer); ttimer = setTimeout(() => { ttimer = null; if (st === 'ready') loadTasks(); }, 400); }
  // the safety net (and the day turning over): reload when the page is visible
  async function check() {
    if (st !== 'ready' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false;
    if (!live) subscribe(); await load(); return true;
  }
  function unsubscribe() {
    const lv = live; live = null; if (timer) { clearTimeout(timer); timer = null; } if (ttimer) { clearTimeout(ttimer); ttimer = null; } if (poll) { clearInterval(poll); poll = null; }
    if (lv && c()) { try { Promise.resolve(c().removeChannel(lv)).catch(() => {}); } catch (e) { /* already closed */ } }
  }

  // ---------- «سجل الحركات» (the owner 12 Nov — «نضيف تاب سجل الحركات» in the HR page) ----------
  // the activity_log rows of HR (hr.*: the attendance, the requests, the overtime, the members, the payroll, the tasks, the
  // settings…), newest 300 — RLS decides (0046: the HR rows are their actor's and hr.view F's); each as { id, at, action, label,
  // group, by, on, detail } with no text the row does not already carry (codes, months, minutes — never a name of a request's type)
  const LOG_LABELS = {
    'hr.shift.start': ['بدأ الدوام', 'الحضور'], 'hr.shift.end': ['أنهى الدوام', 'الحضور'], 'hr.attendance.manual': ['تسجيل حضور يدوي', 'الحضور'], 'hr.attendance.close': ['إنهاء دوام عضو / تصحيح انصراف', 'الحضور'],
    'hr.overtime.begin': ['بدأ وقت إضافي', 'الوقت الإضافي'], 'hr.overtime.request': ['طلب وقت إضافي', 'الوقت الإضافي'], 'hr.overtime.add': ['وافق على وقت إضافي', 'الوقت الإضافي'], 'hr.overtime.reject': ['رفض وقت إضافي', 'الوقت الإضافي'],
    'hr.request.create': ['قدّم طلب', 'الطلبات'], 'hr.request.approve': ['وافق على طلب', 'الطلبات'], 'hr.request.reject': ['رفض طلب', 'الطلبات'], 'hr.request.review': ['راجع طلب', 'الطلبات'], 'hr.request.cancel': ['لغى طلب', 'الطلبات'],
    'hr.member.create': ['ضاف عضو', 'الأعضاء'], 'hr.member.update': ['عدّل بيانات عضو', 'الأعضاء'], 'hr.member.delete': ['حذف عضو', 'الأعضاء'], 'hr.member.invite': ['بعت إيميل الباسورد', 'الأعضاء'], 'hr.member.password': ['باسورد مؤقت جديد', 'الأعضاء'],
    'hr.contract.upload': ['رفع عقد / مستند', 'الأعضاء'], 'hr.contract.void': ['شال مستند', 'الأعضاء'], 'hr.bank.set': ['عدّل الحساب البنكي', 'الأعضاء'], 'hr.bank.reveal': ['كشف رقم الحساب البنكي', 'الأعضاء'],
    'hr.payroll.review': ['راجع كشف المرتبات', 'المرتبات'], 'hr.payroll.approve': ['اعتمد كشف المرتبات', 'المرتبات'], 'hr.payroll.paid': ['حوّل المرتبات', 'المرتبات'], 'hr.payroll.member': ['حوّل مرتب عضو', 'المرتبات'], 'hr.advance.give': ['حوّل سلفة', 'المرتبات'], 'hr.overtime.adjust': ['صحّح الأوفر تايم', 'المرتبات'], 'hr.payroll.adjust': ['تسوية على الكشف', 'المرتبات'], 'hr.payroll.adjust.void': ['لغى تسوية', 'المرتبات'], 'hr.pay.update': ['عدّل المرتب', 'المرتبات'],
    'hr.extra.create': ['مكافأة / خصم', 'المرتبات'], 'hr.extra.decision': ['قرار مكافأة / خصم', 'المرتبات'],
    'hr.evaluate': ['قيّم الشهر', 'التقييم'], 'hr.note.add': ['ملاحظة على التقييم (ميتنج / إنذار / خطة / شكر)', 'التقييم'], 'hr.kpi.rate': ['قيّم الشهر (المؤشرات القديمة)', 'التقييم'], 'hr.kpi.define': ['عدّل مؤشرات الأداء', 'التقييم'], 'hr.meeting.create': ['حدد ميتنج', 'التقييم'], 'hr.meeting.update': ['عدّل ميتنج', 'التقييم'], 'hr.achievement': ['إنجاز', 'التقييم'],
    'hr.task.add': ['ضاف مهمة', 'المهام'], 'hr.task.status': ['غيّر حالة مهمة', 'المهام'], 'hr.task.delete': ['حذف مهمة', 'المهام'], 'hr.task.review': ['راجع مهمة', 'المهام'],
    'hr.holiday.create': ['ضاف عطلة رسمية', 'الإعدادات'], 'hr.holiday.confirm': ['أكّد عطلة رسمية', 'الإعدادات'], 'hr.holiday.delete': ['شال عطلة رسمية', 'الإعدادات'], 'hr.settings': ['عدّل إعدادات الموارد البشرية', 'الإعدادات'] };
  const logLabel = (action) => LOG_LABELS[action] || [String(action || '').replace(/^hr\./, ''), 'أخرى'];
  const TASK_WORD = { ok: 'اتقبلت', back: 'رجعت' }; // a review's word (the status itself is already Arabic)
  let logRows = null; let logAt = 0; let logGen = 0;
  async function loadLog(force) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!force && logRows && Date.now() - logAt < 60000) return { ok: true, items: logRows };
    const g = ++logGen;
    try {
      const { data: d, error } = await cl.from('activity_log').select('id, at, actor, action, entity, entity_id, new_value').like('action', 'hr.%').order('at', { ascending: false }).limit(300);
      if (error) return fail(error);
      if (g !== logGen) return { ok: false, reason: 'stale' };
      logRows = (Array.isArray(d) ? d : []).map((x) => { const [label, group] = logLabel(x.action); const on = x.entity_id && byUid(String(x.entity_id)) ? nameOf(String(x.entity_id)) : (x.entity_id ? String(x.entity_id) : '');
        const v = typeof x.new_value === 'string' ? x.new_value : x.new_value == null ? '' : JSON.stringify(x.new_value);
        return { id: Number(x.id), at: x.at, action: x.action, label, group, by: nameOf(x.actor), byUid: x.actor || null, on, detail: x.action === 'hr.task.review' ? (TASK_WORD[v] || v) : v }; });
      logAt = Date.now(); return { ok: true, items: logRows };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const logNow = () => logRows;

  window.IBHR = { load, clear, subscribe, unsubscribe, check, state: () => st, data, member, team, everyone, can, decidesOt, settings, hm, span, workDays, isWorkDay, dayDivisor, scheduleOf, dayMinutes, today, nowMin, addDays, quarterOf, quarterMonths, monthKey, holidayDates, leaveDays, isLeave,
    shiftNow, myShift, clockIn, clockOut, overtimeBegin, overtimeRequest, setAttendance, endShiftFor, fixOut, request, decide, cancel, overtimeDecide, rateMonth, saveKpis,
    payrollCalc, payrollLines, sheetLines, sheetTotals, slips, transfer, payMember, advanceGive, otAdjust, payDayOf, evaluate, evalTotal, quarterEval, monthTasks, noteAdd, notesOf, NOTE_KINDS, cairoIso, bank, bankSet, bankReveal, payrollOpen, payrollStep, payrollPay, addAdjustment, voidAdjustment, addExtra, decideExtra, meetingCreate, meetingUpdate,
    holidayAdd, holidayConfirm, holidayDelete, leaveTypeAdd, bonusRuleAdd, bonusRuleToggle, otPeriodAdd, otPeriodDelete, saveSettings, addDepartment,
    memberCreate, memberPassword, memberInvite, memberDelete, memberUpdate, payUpdate, upload, addDocument, voidDocument, fileUrl, checkFile, ACCOUNTS, DOC_KINDS, DEFAULTS, MIME, MAX_BYTES,
    tasksOf, reviewsFor, canTask, canDeleteTask, taskAdd, taskSet, taskDelete, taskReview, loadTasks, people: () => data.people.slice(), TASK_STATUSES, loadLog, logNow, logLabel,
    _test: { parts, minOf, atLabel, meetingLabel, shape, shapeTasks, raw, safeName, fail, uidOf } };
})();
