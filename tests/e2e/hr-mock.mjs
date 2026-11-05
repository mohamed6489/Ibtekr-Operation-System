// Phase 10 (0046): the HR tables, RPCs, the Edge Function team-admin and the bucket «hr-docs», emulated for supabase-mock.mjs (not a
// test file itself). hrState(opts) seeds the rows as the database holds them (opts.hrMembers / hrPay / hrAttendance / hrOvertime /
// hrRequests / hrHolidays / hrKpis / hrScores / hrExtras / hrMeetings / hrAdjustments / hrPayroll / hrDocuments — the ids, dates and
// the uuids of USERS); hrRoute(c) answers a request of those paths (or returns null): RLS as 0046 reads it (hr_can_see: me, hr.view F
// everyone, P the members I manage; the pay / the money for sensitive.salaries F or one's own; the documents for hr.edit F or one's
// own), the RPCs with the same rules (the server's clock, the overtime past 8 hours, the payroll lines, «مدفوع» into the accounts'
// ledgers), team-admin (the admin; the temporary password answered once). Every RPC / function call lands in hr.calls, every write
// the client sent in hr.writes ({ table, op, ...columns }).
const MOCK_TEMP = 'mock-temp-1'; // what team-admin answers in the mock (the real one is random, 12 characters)
const ACCOUNTS = ['حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية'];
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const cairo = (d = new Date()) => { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) }; };
export const hrToday = () => cairo().day;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthOf = (iso) => String(iso).slice(0, 7) + '-01';
const nextMonth = (m, n = 1) => { const d = new Date(m + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
// a Cairo local HH:MM on a day → ISO (Cairo is UTC+2 / +3 in summer: the offset of that day at noon)
export function hrAt(day, time) {
  const [h, m] = String(time).split(':').map(Number); const noon = new Date(day + 'T12:00:00Z'); const off = (cairo(noon).min - 12 * 60) / 60;
  return new Date(Date.parse(day + 'T00:00:00Z') + ((h - off) * 60 + m) * 60000).toISOString();
}
const restDay = (st, d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 5 || w === 6 || st.holidays.some((h) => h.status === 'مؤكد' && d >= h.day && d <= addDays(h.day, (h.days || 1) - 1)); };
const COLS = {
  hr_members: ['member_id', 'shift_start', 'shift_end', 'hire_date', 'leave_days', 'notes', 'updated_by', 'updated_at'],
  hr_pay: ['member_id', 'salary', 'holdback', 'allowances', 'updated_by', 'updated_at'],
  hr_attendance: ['id', 'member_id', 'day', 'in_at', 'out_at', 'remote', 'source', 'note', 'by_id', 'updated_at'],
  hr_overtime: ['id', 'member_id', 'day', 'start_at', 'end_at', 'minutes', 'kind', 'note', 'status', 'paid_minutes', 'pay_month', 'decided_by', 'decided_at', 'reason', 'created_at'],
  hr_requests_v: ['id', 'code', 'member_id', 'type', 'from_day', 'to_day', 'at_time', 'hours', 'amount', 'months', 'note', 'status', 'decided_by', 'decided_at', 'reason', 'created_by', 'created_at', 'doc_path'],
  hr_holidays: ['id', 'name', 'day', 'days', 'kind', 'status', 'created_by', 'created_at'],
  hr_leave_types: ['name', 'days', 'paid', 'doc', 'carry', 'approval', 'deducts', 'unpaid', 'sort', 'created_at'],
  hr_bonus_rules: ['id', 'name', 'cond', 'amount', 'active', 'created_at'],
  hr_ot_periods: ['id', 'range_text', 'scope', 'counts', 'created_by', 'created_at'],
  hr_kpis: ['id', 'member_id', 'name', 'src', 'weight', 'target', 'inverse', 'sort', 'active', 'created_at'],
  hr_scores: ['member_id', 'month', 'score', 'actuals', 'note', 'rated_by', 'rated_at'],
  hr_extras: ['id', 'member_id', 'quarter', 'rule', 'amount', 'status', 'decided_by', 'decided_at', 'created_by', 'created_at'],
  hr_meetings: ['id', 'member_id', 'reason', 'status', 'day', 'time_text', 'place', 'outcome', 'plan', 'goals', 'support', 'review_on', 'progress', 'notes', 'ref', 'created_by', 'created_at', 'updated_at'],
  hr_adjustments: ['id', 'member_id', 'month', 'amount', 'label', 'note', 'kind', 'created_by', 'created_at', 'voided_by', 'voided_at'],
  hr_payroll: ['month', 'status', 'opened_at', 'reviewed_by', 'reviewed_at', 'approved_by', 'approved_at', 'paid_by', 'paid_at', 'paid_account', 'total'],
  hr_payroll_lines: ['month', 'member_id', 'name', 'salary', 'holdback', 'paid', 'ot_minutes', 'ot_pay', 'rest_days', 'rest_pay', 'unpaid_days', 'unpaid_cut', 'allowances', 'deductions', 'advance', 'quarter_bonus', 'net'],
  hr_documents: ['id', 'member_id', 'kind', 'path', 'name', 'start_on', 'end_on', 'created_by', 'created_at', 'voided_by', 'voided_at'],
};
const KEY = { hr_attendance: 'attendance', hr_overtime: 'overtime', hr_requests_v: 'requests', hr_holidays: 'holidays', hr_leave_types: 'leave_types', hr_bonus_rules: 'bonus_rules', hr_ot_periods: 'ot_periods',
  hr_kpis: 'kpis', hr_scores: 'scores', hr_extras: 'extras', hr_meetings: 'meetings', hr_adjustments: 'adjustments', hr_payroll: 'payroll', hr_payroll_lines: 'payroll_lines', hr_documents: 'documents', hr_members: 'members', hr_pay: 'pay' };

export function hrState(opts = {}) {
  const T = '2026-11-01T08:00:00Z'; const copy = (l) => (l || []).map((x) => JSON.parse(JSON.stringify(x)));
  return {
    members: copy(opts.hrMembers).map((x) => ({ shift_start: '09:00', shift_end: '17:00', hire_date: null, leave_days: 21, notes: null, ...x })),
    pay: copy(opts.hrPay).map((x) => ({ holdback: 0, allowances: 0, ...x })),
    attendance: copy(opts.hrAttendance).map((x, i) => ({ id: i + 1, out_at: null, remote: false, source: 'clock', note: null, by_id: x.member_id, ...x })),
    overtime: copy(opts.hrOvertime).map((x, i) => ({ id: i + 1, kind: 'hours', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: T, ...x }))
      .map((x) => ({ ...x, pay_month: x.pay_month !== undefined ? x.pay_month : x.status === 'اتضاف' ? monthOf(x.day) : null })),
    requests: copy(opts.hrRequests).map((x, i) => ({ id: i + 1, at_time: null, hours: null, amount: null, months: null, note: null, status: 'جديد', decided_by: null, decided_at: null, reason: null, created_by: x.member_id, created_at: T, doc_path: null, ...x })),
    holidays: copy(opts.hrHolidays).map((x, i) => ({ id: i + 1, days: 1, kind: 'رسمية', status: 'مؤكد', created_by: null, created_at: T, ...x })),
    leave_types: [['إجازة سنوية', '21 يوم', 'نعم', '—', 'لحد 5 أيام', 'المدير المباشر', true, false, 1], ['إجازة عارضة', '6 أيام (من السنوية)', 'نعم', '—', '—', 'المدير المباشر', true, false, 2],
      ['إجازة مرضية', 'حسب التقرير', 'نعم', 'تقرير طبي إلزامي', '—', 'الأدمن', false, false, 3], ['إجازة بدون أجر', '—', 'لا (يوم = ÷ 24)', '—', '—', 'المالك', false, true, 4]]
      .map(([name, days, paid, doc, carry, approval, deducts, unpaid, sort]) => ({ name, days, paid, doc, carry, approval, deducts, unpaid, sort, created_at: T })),
    bonus_rules: [['مكافأة تفوق', 'سكور الربع ≥ 110%', 500], ['مكافأة تفوق عالي', 'سكور الربع ≥ 120%', 1000], ['ربع بدون أوردر متأخر', '0 متأخرات في مسؤوليته', 300], ['أعلى تقييم خدمة عملاء', 'أعلى CSAT في الربع ≥ 4.8', 300]]
      .map(([name, cond, amount], i) => ({ id: i + 1, name, cond, amount, active: true, created_at: T })),
    ot_periods: [], kpis: copy(opts.hrKpis).map((x, i) => ({ id: i + 1, src: 'يدوي', inverse: false, sort: i, active: true, created_at: T, ...x })),
    scores: copy(opts.hrScores).map((x) => ({ actuals: {}, note: null, rated_by: null, rated_at: T, ...x })),
    extras: copy(opts.hrExtras).map((x, i) => ({ id: i + 1, status: 'مقترحة', decided_by: null, decided_at: null, created_by: null, created_at: T, ...x })),
    meetings: copy(opts.hrMeetings).map((x, i) => ({ id: i + 1, status: 'مطلوب', day: null, time_text: null, place: null, outcome: null, plan: null, goals: [], support: null, review_on: null, progress: null, notes: null, ref: null, created_by: null, created_at: T, updated_at: T, ...x })),
    adjustments: copy(opts.hrAdjustments).map((x, i) => ({ id: i + 1, note: null, kind: 'adjust', created_by: null, created_at: T, voided_by: null, voided_at: null, ...x })),
    payroll: copy(opts.hrPayroll).map((x) => ({ status: 'مسودة', opened_at: T, reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null, paid_by: null, paid_at: null, paid_account: null, total: null, ...x })),
    payroll_lines: [], documents: copy(opts.hrDocuments).map((x, i) => ({ id: i + 1, start_on: null, end_on: null, created_by: null, created_at: T, voided_by: null, voided_at: null, ...x })),
    objects: new Map(Object.entries(opts.hrObjects || {})), calls: [], writes: [], seq: 1000, down: false,
  };
}

// c: { method, path, url, hd, body(), u (the caller or null), hasPerm, isAdmin, json, mock, route }
export function hrRoute(c) {
  const { method, path, url, hd, u, hasPerm, isAdmin, json, mock } = c; const H = mock.hr; if (!H) return null;
  const rest = /^\/rest\/v1\/(hr_[a-z_]+)$/.exec(path); const rpc = /^\/rest\/v1\/rpc\/(hr_[a-z_]+)$/.exec(path);
  const fn = method === 'POST' && path === '/functions/v1/team-admin'; const sto = /^\/storage\/v1\/object\/(sign\/)?hr-docs\/(.+)$/.exec(path);
  if (!(rest && COLS[rest[1]]) && !rpc && !fn && !sto) return null;
  const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
  const now = new Date().toISOString(); const today = hrToday();
  // a signed URL opened with no key (a new tab): its token opens the object
  if (sto && method === 'GET') { const obj = H.objects.get(decodeURIComponent(sto[2])); return obj ? c.route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': obj.type || 'application/pdf' }, body: Buffer.from('%PDF-1.4 mock') }) : json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' }); }
  if (!u) return fn ? json(401, { error: 'unauthorized' }) : refuse(401, '42501', 'permission denied');
  const active = u.status === 'active';
  const prof = (id) => mock.profiles.find((p) => p.id === id) || null;
  const manages = (id) => active && (prof(id) || {}).manager_id === u.id;
  const sees = (id) => active && (id === u.id || hasPerm(u, 'hr.view') === 'F' || (hasPerm(u, 'hr.view') === 'P' && manages(id)));
  const decides = (id) => active && (isAdmin(u) || (id !== u.id && (hasPerm(u, 'hr.approve') === 'F' || manages(id))));
  const salaries = active && hasPerm(u, 'sensitive.salaries') === 'F'; const editor = active && hasPerm(u, 'hr.edit') === 'F';
  const own = (r) => r.member_id === u.id && active;
  const nextId = () => { H.seq += 1; return H.seq; };
  const minutes = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 60000);

  // ---------- the Edge Function team-admin (decisions 5 / 6 / 13) ----------
  if (fn) {
    const b = c.body(); H.calls.push({ fn: 'team-admin', action: b.action, by: u.id });
    if (!isAdmin(u)) return json(401, { error: 'unauthorized' });
    if (b.action === 'member_create') {
      const email = String(b.email || '').trim().toLowerCase(); const phone = String(b.phone || '').replace(/[\s-]/g, '');
      if (String(b.name || '').trim().length < 2) return json(400, { error: 'invalid', field: 'name' });
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json(400, { error: 'invalid', field: 'email' });
      if (phone && !/^01[0125][0-9]{8}$/.test(phone)) return json(400, { error: 'invalid', field: 'phone' });
      if (!['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'viewer'].includes(b.role)) return json(400, { error: 'invalid', field: 'role' });
      if (mock.profiles.some((p) => p.email === email)) return json(409, { error: 'exists', field: 'email' });
      if (phone && mock.profiles.some((p) => p.phone === phone)) return json(409, { error: 'exists', field: 'phone' });
      const max = mock.profiles.map((p) => /^M(\d+)$/.exec(p.member_code || '')).filter(Boolean).reduce((n, m) => Math.max(n, Number(m[1])), 0);
      const code = 'M' + String(max + 1).padStart(2, '0'); const id = '00000000-0000-4000-8000-0000000010' + String(max + 1).padStart(2, '0');
      mock.profiles.push({ id, member_code: code, name: String(b.name).trim().replace(/\s+/g, ' '), email, phone: phone || null, role_id: b.role, title: b.title || null, dept: b.dept || null,
        manager_id: b.manager_id || null, status: 'active', twofa: false, custom_perms: {}, created_at: now });
      H.members.push({ member_id: id, shift_start: b.shift_start || '09:00', shift_end: b.shift_end || '17:00', hire_date: b.hire_date || null, leave_days: 21, notes: null });
      return json(200, { ok: true, id, member_code: code, password: MOCK_TEMP });
    }
    if (b.action === 'member_password') {
      if (!prof(b.member_id)) return json(404, { error: 'not_found' }); if (b.member_id === u.id) return json(400, { error: 'invalid', field: 'member_id' });
      return json(200, { ok: true, id: b.member_id, password: MOCK_TEMP });
    }
    return json(400, { error: 'unknown_action' });
  }

  // ---------- the bucket «hr-docs» ----------
  if (sto) {
    const key = decodeURIComponent(sto[2]); const folder = key.split('/')[0];
    if (sto[1]) {
      const visible = folder === u.id || editor || H.requests.some((r) => r.doc_path === key && decides(r.member_id));
      if (!active || !visible || !H.objects.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
      return json(200, { signedURL: '/object/sign/hr-docs/' + key + '?token=hr-' + nextId() });
    }
    if (!active || !(editor || folder === u.id)) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (H.objects.has(key)) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    H.objects.set(key, { type: 'application/pdf', by: u.id }); return json(200, { Key: 'hr-docs/' + key, Id: 'obj-hr-' + H.objects.size });
  }

  // ---------- the RPCs ----------
  if (rpc) {
    const f = rpc[1]; const b = c.body(); H.calls.push({ fn: f, ...JSON.parse(JSON.stringify(b)), by: u.id });
    if (H.down) return json(503, { message: 'mock: hr down' });
    const bad = (field) => refuse(400, '22023', 'invalid: ' + field); const no = () => refuse(403, '42501', 'not allowed'); const nf = () => refuse(404, 'P0002', 'not found');
    // hr_shift_now: the open one first (within 20 hours), else today's
    const shift = () => { const l = H.attendance.filter((x) => x.member_id === u.id && ((x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000) || x.day === today));
      l.sort((x, y) => ((y.out_at == null) - (x.out_at == null)) || (x.in_at < y.in_at ? 1 : -1)); const a = l[0];
      return a ? { id: a.id, day: a.day, in_at: a.in_at, out_at: a.out_at, remote: a.remote } : null; };
    if (f === 'hr_settings') return json(200, active ? ((mock.settings.find((s) => s.section === 'hr') || {}).data || {}) : null);
    if (f === 'hr_team') return json(200, mock.profiles.filter((p) => sees(p.id)).map((p) => ({ id: p.id, member_code: p.member_code, name: p.name, title: p.title || null, dept: p.dept || null, manager_id: p.manager_id || null, status: p.status, role_id: p.role_id })));
    if (f === 'hr_shift_now') return json(200, active ? shift() : null);
    if (f === 'hr_clock_in') {
      if (!active) return no();
      const open = H.attendance.find((x) => x.member_id === u.id && x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000); if (open) return json(200, shift());
      if (H.attendance.some((x) => x.member_id === u.id && x.day === today)) return bad('ended');
      const remote = H.requests.some((x) => x.member_id === u.id && x.type === 'شغل عن بُعد' && x.status === 'موافق' && x.from_day <= today && x.to_day >= today); // 0046: the server's, never the caller's
      if ('p_remote' in b) return json(404, { code: 'PGRST202', message: 'Could not find the function public.hr_clock_in(p_remote) in the schema cache' });
      H.attendance.push({ id: nextId(), member_id: u.id, day: today, in_at: now, out_at: null, remote, source: 'clock', note: null, by_id: u.id, updated_at: now });
      return json(200, shift());
    }
    if (f === 'hr_clock_out') {
      if (!active) return no();
      const a = H.attendance.filter((x) => x.member_id === u.id && x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000).sort((x, y) => (x.in_at < y.in_at ? 1 : -1))[0];
      if (!a) return bad('no open shift');
      const out = b.p_at && Date.parse(b.p_at) < Date.now() ? new Date(Date.parse(b.p_at)).toISOString() : now; a.out_at = out; a.updated_at = now;
      const worked = minutes(a.in_at, out); const note = String(b.p_ot_note || '').trim();
      if (restDay(H, a.day)) {
        let otId = null; if (worked > 0 && !H.overtime.some((o) => o.member_id === u.id && o.day === a.day && o.kind === 'rest_day')) { otId = nextId(); H.overtime.push({ id: otId, member_id: u.id, day: a.day, start_at: a.in_at, end_at: out, minutes: Math.min(worked, 1440), kind: 'rest_day', note: note || 'شغل يوم راحة / عطلة', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now }); }
        return json(200, { worked, overtime_id: otId, overtime: 0, rest_day: true });
      }
      let otId = null; if (note && worked > 480) { otId = nextId(); H.overtime.push({ id: otId, member_id: u.id, day: a.day, start_at: new Date(Date.parse(a.in_at) + 480 * 60000).toISOString(), end_at: out, minutes: worked - 480, kind: 'hours', note, status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now }); }
      return json(200, { worked, overtime_id: otId, overtime: otId ? worked - 480 : 0 });
    }
    if (f === 'hr_attendance_set') {
      if (!editor) return no(); if (!b.p_member || !b.p_day || !b.p_in || b.p_day > today) return bad('day'); if (!prof(b.p_member)) return nf();
      const inAt = hrAt(b.p_day, b.p_in); const outAt = b.p_out ? hrAt(b.p_out < b.p_in ? addDays(b.p_day, 1) : b.p_day, b.p_out) : null;
      let a = H.attendance.find((x) => x.member_id === b.p_member && x.day === b.p_day);
      if (a) Object.assign(a, { in_at: inAt, out_at: outAt, remote: !!b.p_remote, source: a.source === 'clock' && a.out_at == null ? 'fix' : 'manual', note: b.p_note || null, by_id: u.id, updated_at: now });
      else { a = { id: nextId(), member_id: b.p_member, day: b.p_day, in_at: inAt, out_at: outAt, remote: !!b.p_remote, source: 'manual', note: b.p_note || null, by_id: u.id, updated_at: now }; H.attendance.push(a); }
      if (outAt && restDay(H, b.p_day) && !H.overtime.some((o) => o.member_id === b.p_member && o.day === b.p_day && o.kind === 'rest_day'))
        H.overtime.push({ id: nextId(), member_id: b.p_member, day: b.p_day, start_at: inAt, end_at: outAt, minutes: Math.min(minutes(inAt, outAt), 1440), kind: 'rest_day', note: 'شغل يوم راحة / عطلة (يدوي)', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now });
      return json(200, a.id);
    }
    if (f === 'hr_request_create') {
      const i = b.p_input || {}; const member = i.member || u.id; const type = String(i.type || '').trim();
      if (!active || (member !== u.id && !editor)) return no(); if (!prof(member)) return nf();
      const types = H.leave_types.map((t) => t.name).concat(['شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف', 'سُلفة']); if (!types.includes(type)) return bad('type');
      let from = i.from || today; let to = i.to || from; let at = i.time || null; let hours = i.hours == null ? null : Number(i.hours); let amount = i.amount == null ? null : Number(i.amount); let months = i.months == null ? null : Number(i.months);
      if (to < from) return bad('to');
      if (type === 'سُلفة') { if (!(amount > 0) || !(months >= 1 && months <= 24)) return bad('amount'); from = today; to = today; at = null; hours = null; }
      else if (type === 'إذن انصراف مبكر' || type === 'تصحيح انصراف') { if (!at) return bad('time'); to = from; amount = null; months = null;
        if (type === 'تصحيح انصراف' && (from > today || !H.attendance.some((x) => x.member_id === member && x.day === from))) return bad('day'); if (type === 'إذن انصراف مبكر' && !(hours > 0 && hours <= 12)) hours = 2; }
      else { at = null; hours = null; amount = null; months = null; }
      const lt = H.leave_types.find((t) => t.name === type); let doc = lt ? (i.doc || null) : null;
      if (doc && !String(doc).startsWith(member + '/')) return bad('doc'); if (lt && !doc && !['', '—', '-'].includes(String(lt.doc).trim())) return bad('doc');
      const id = nextId(); H.requests.push({ id, member_id: member, type, from_day: from, to_day: to, at_time: at, hours, amount, months, note: i.note || null, status: 'جديد', decided_by: null, decided_at: null, reason: null, created_by: u.id, created_at: now, doc_path: doc });
      return json(200, id);
    }
    if (f === 'hr_request_decide') {
      const r = H.requests.find((x) => x.id === Number(b.p_id)); if (!r || !sees(r.member_id)) return nf(); if (!decides(r.member_id)) return no();
      if (!['جديد', 'قيد المراجعة'].includes(r.status)) return bad('status'); if (!['موافق', 'مرفوض', 'قيد المراجعة'].includes(b.p_decision)) return bad('decision');
      const reason = String(b.p_reason || '').trim() || null; if (b.p_decision === 'مرفوض' && !reason) return bad('reason');
      Object.assign(r, { status: b.p_decision, reason, decided_by: b.p_decision === 'قيد المراجعة' ? null : u.id, decided_at: b.p_decision === 'قيد المراجعة' ? null : now });
      if (b.p_decision === 'موافق' && r.type === 'تصحيح انصراف') { const a = H.attendance.find((x) => x.member_id === r.member_id && x.day === r.from_day); if (a) Object.assign(a, { out_at: hrAt(r.from_day, r.at_time), source: 'fix', updated_at: now }); }
      return json(200, b.p_decision);
    }
    if (f === 'hr_request_cancel') { const r = H.requests.find((x) => x.id === Number(b.p_id) && x.member_id === u.id && ['جديد', 'قيد المراجعة'].includes(x.status)); if (!active) return no(); if (!r) return nf(); r.status = 'اتلغى'; return json(200, 'اتلغى'); }
    if (f === 'hr_overtime_decide') {
      const o = H.overtime.find((x) => x.id === Number(b.p_id)); if (!o || !sees(o.member_id)) return nf(); if (!decides(o.member_id)) return no();
      if (!(o.status === 'مستني' || (o.status === 'اترفض' && b.p_decision === 'add'))) return bad('status'); const reason = String(b.p_reason || '').trim() || null;
      if (o.status === 'اترفض') { if (!editor) return no(); const mt = H.meetings.find((x) => x.member_id === o.member_id && x.ref === 'OT-' + o.id && x.status !== 'اتقفلت'); if (!mt) return bad('meeting');
        Object.assign(mt, { status: 'اتقفلت', outcome: 'اتضاف الوقت', updated_at: now }); } // the meeting's result (the security review)
      if (b.p_decision === 'add') { const m = o.kind === 'rest_day' ? o.minutes : b.p_minutes == null ? o.minutes : Number(b.p_minutes); if (!(m > 0) || m > o.minutes) return bad('minutes');
        let pm = monthOf(o.day); while (H.payroll.some((p) => p.month === pm && ['معتمد', 'مدفوع'].includes(p.status))) pm = nextMonth(pm); // a late approval rides the next open sheet
        Object.assign(o, { status: 'اتضاف', paid_minutes: m, pay_month: pm, decided_by: u.id, decided_at: now, reason }); return json(200, 'اتضاف'); }
      if (b.p_decision === 'reject') { if (!reason) return bad('reason'); Object.assign(o, { status: 'اترفض', paid_minutes: 0, pay_month: null, decided_by: u.id, decided_at: now, reason });
        H.meetings.push({ id: nextId(), member_id: o.member_id, reason: 'وقت إضافي اترفض — نعرف كان بيعمل إيه', status: 'مطلوب', day: null, time_text: null, place: null, outcome: null, plan: null, goals: [], support: null, review_on: null, progress: null, notes: null, ref: 'OT-' + o.id, created_by: u.id, created_at: now, updated_at: now });
        return json(200, 'اترفض'); }
      return bad('decision');
    }
    if (f === 'hr_rate_month') {
      if (!editor) return no(); if (!prof(b.p_member)) return nf(); const month = monthOf(b.p_month); if (month > monthOf(today)) return bad('month');
      const ks = H.kpis.filter((k) => k.member_id === b.p_member && k.active); if (Math.abs(ks.reduce((n, k) => n + Number(k.weight), 0) - 100) > 0.01) return bad('weights');
      let score = 0; for (const k of ks) { const act = Number((b.p_actuals || {})[String(k.id)]); if (!Number.isFinite(act) || act < 0) return bad('actual');
        const ach = k.inverse ? (act === 0 ? 120 : Number(k.target) / act * 100) : act / Number(k.target) * 100; score += Math.min(ach, 120) * Number(k.weight) / 100; }
      score = Math.round(score * 10) / 10; const ex = H.scores.find((s) => s.member_id === b.p_member && s.month === month);
      const row = { member_id: b.p_member, month, score, actuals: b.p_actuals || {}, note: b.p_note || null, rated_by: u.id, rated_at: now }; if (ex) Object.assign(ex, row); else H.scores.push(row);
      return json(200, score);
    }
    if (f === 'hr_payroll_calc') { if (!salaries) return no(); return json(200, calc(H, mock, monthOf(b.p_month))); }
    if (f === 'hr_payroll_open') { if (!salaries) return no(); const m = monthOf(b.p_month || today); if (!H.payroll.some((p) => p.month === m)) H.payroll.push({ month: m, status: 'مسودة', opened_at: now, reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null, paid_by: null, paid_at: null, paid_account: null, total: null }); return json(200, m); }
    if (f === 'hr_payroll_step') {
      if (!salaries) return no(); const m = monthOf(b.p_month); const p = H.payroll.find((x) => x.month === m); if (!p) return nf(); const s = b.p_step;
      if (!((p.status === 'مسودة' && s === 'مراجعة') || (p.status === 'مراجعة' && ['مسودة', 'معتمد'].includes(s)) || (p.status === 'معتمد' && s === 'مراجعة'))) return bad('step');
      H.payroll_lines = H.payroll_lines.filter((l) => l.month !== m);
      if (s === 'معتمد') { calc(H, mock, m).forEach(({ missing_scores, ...l }) => H.payroll_lines.push({ month: m, ...l })); Object.assign(p, { status: 'معتمد', approved_by: u.id, approved_at: now, total: H.payroll_lines.filter((l) => l.month === m).reduce((n, l) => n + l.net, 0) }); }
      else if (s === 'مراجعة') Object.assign(p, { status: 'مراجعة', reviewed_by: u.id, reviewed_at: now, approved_by: null, approved_at: null, total: null });
      else Object.assign(p, { status: 'مسودة', reviewed_by: null, reviewed_at: null });
      return json(200, s);
    }
    if (f === 'hr_payroll_pay') {
      if (!salaries) return no(); if (!ACCOUNTS.includes(b.p_account)) return bad('account'); const m = monthOf(b.p_month); const p = H.payroll.find((x) => x.month === m); if (!p) return nf(); if (p.status !== 'معتمد') return bad('status');
      const lines = H.payroll_lines.filter((l) => l.month === m && l.net > 0); const total = lines.reduce((n, l) => n + l.net, 0); const label = m.slice(0, 7);
      lines.forEach((l) => { mock.acc.acc_expenses.push({ id: nextId(), on_date: today, direction: 'withdraw', category: 'المرتبات', beneficiary: l.name.slice(0, 80), beneficiary_other: false, amount: l.net, note: 'مرتب ' + label, created_by: u.id, created_at: now, updated_by: null, updated_at: null, voided_by: null, voided_at: null }); });
      if (total > 0) mock.acc.acc_account_moves.push({ id: nextId(), account: b.p_account, on_date: today, direction: 'withdraw', amount: total, note: 'مرتبات ' + label, created_by: u.id, created_at: now, updated_by: null, updated_at: null, voided_by: null, voided_at: null });
      Object.assign(p, { status: 'مدفوع', paid_by: u.id, paid_at: now, paid_account: b.p_account, total }); return json(200, total);
    }
    return null;
  }

  // ---------- the tables ----------
  const t = rest[1]; const key = KEY[t];
  const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
  const params = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k));
  const test = ([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v.startsWith('gte.') ? (r) => r[k] != null && String(r[k]) >= v.slice(4) : v === 'is.null' ? (r) => r[k] == null
    : /^in\.\(.*\)$/.test(v) ? ((set) => (r) => set.includes(String(r[k])))(v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1'))) : null);
  const fns = params.map(test); if (fns.some((x) => !x)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + t + ': ' + params.map((p) => p.join('=')).join('&'));
  const match = (r) => fns.every((x) => x(r));
  if (method === 'GET') {
    const sel = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim()); const miss = sel.find((x) => x !== '*' && !COLS[t].includes(x));
    if (miss) return refuse(400, '42703', 'column ' + t + '.' + miss + ' does not exist');
    if (!active) return json(200, []);
    const visible = t === 'hr_pay' || t === 'hr_extras' || t === 'hr_payroll_lines' ? (r) => salaries || own(r) : t === 'hr_adjustments' ? (r) => salaries || (own(r) && !r.voided_at)
      : t === 'hr_payroll' ? () => salaries : t === 'hr_documents' ? (r) => editor || own(r) : ['hr_holidays', 'hr_leave_types', 'hr_bonus_rules', 'hr_ot_periods'].includes(t) ? () => true : (r) => sees(r.member_id);
    let list = H[key].map((r) => (t === 'hr_requests_v' ? { ...r, code: 'HR-' + String(r.id).padStart(4, '0'), amount: salaries || r.member_id === u.id ? r.amount : null } : r)).filter(visible).filter(match);
    const ord = url.searchParams.get('order'); if (ord) { const [col, dir] = ord.split('.'); list = list.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const lim = Number(url.searchParams.get('limit')); if (lim > 0) list = list.slice(0, lim);
    const pick = (r) => (sel.includes('*') ? { ...r } : Object.fromEntries(sel.map((x) => [x, r[x] === undefined ? null : r[x]])));
    return single ? (list.length ? json(200, pick(list[0])) : refuse(406, 'PGRST116', 'no rows')) : json(200, list.map(pick));
  }
  if (H.down) return json(503, { message: 'mock: hr down' });
  const rls = () => refuse(403, '42501', 'new row violates row-level security policy for table "' + t + '"');
  const writable = { hr_members: editor, hr_pay: salaries, hr_kpis: editor, hr_meetings: editor, hr_holidays: editor, hr_leave_types: editor, hr_bonus_rules: editor, hr_ot_periods: editor, hr_extras: salaries, hr_adjustments: salaries, hr_documents: editor };
  if (!(t in writable)) return refuse(403, '42501', 'permission denied for table ' + t);
  const b = c.body(); const list = [].concat(b);
  if (method === 'POST') {
    if (!writable[t]) return rls();
    const upsert = /resolution=merge-duplicates/.test(hd.prefer || ''); const made = [];
    for (const r of list) {
      if (t === 'hr_adjustments') { if ((r.kind || 'adjust') === 'achievement' && !(Number(r.amount) > 0)) return refuse(400, '23514', 'hr_adjustments_check');
        if (H.payroll.some((p) => p.month === r.month && ['معتمد', 'مدفوع'].includes(p.status))) return refuse(400, '22023', 'sheet locked'); }
      if (t === 'hr_documents' && !String(r.path || '').startsWith(r.member_id + '/')) return refuse(400, '23514', 'hr_documents_check');
      if (t === 'hr_pay' && Number(r.holdback || 0) > Number(r.salary || 0)) return refuse(400, '23514', 'hr_pay_check');
      const pk = t === 'hr_members' || t === 'hr_pay' ? 'member_id' : t === 'hr_leave_types' ? 'name' : null;
      const ex = pk ? H[key].find((x) => x[pk] === r[pk]) : null;
      if (ex && !upsert) return refuse(409, '23505', t + '_pkey');
      if (ex) { Object.assign(ex, r, { updated_by: u.id, updated_at: now }); made.push(ex); }
      else { const rec = { ...(pk ? {} : { id: nextId() }), created_by: u.id, created_at: now, ...(t === 'hr_meetings' ? { goals: [], updated_at: now } : {}), ...(t === 'hr_adjustments' ? { kind: 'adjust', voided_at: null } : {}), ...(t === 'hr_extras' ? { status: 'مقترحة' } : {}), ...(t === 'hr_kpis' ? { active: true, src: 'يدوي', inverse: false } : {}), ...r };
        if (t === 'hr_members' || t === 'hr_pay') Object.assign(rec, { updated_by: u.id, updated_at: now }); H[key].push(rec); made.push(rec); }
      H.writes.push({ table: t, op: ex ? 'upsert' : 'insert', ...r });
    }
    return json(201, made.map((x) => ({ ...x })));
  }
  if (method === 'PATCH') {
    if (!writable[t]) return json(200, []);
    const rows = H[key].filter(match);
    for (const r of rows) {
      if ((t === 'hr_adjustments' || t === 'hr_documents') && (Object.keys(b).some((k) => k !== 'voided_at') || r.voided_at)) return refuse(403, '42501', 'only the void');
      if (t === 'hr_adjustments' && H.payroll.some((p) => p.month === r.month && ['معتمد', 'مدفوع'].includes(p.status))) return refuse(400, '22023', 'sheet locked');
      Object.assign(r, b, t === 'hr_meetings' ? { updated_at: now } : {}, (t === 'hr_adjustments' || t === 'hr_documents') && b.voided_at ? { voided_at: now, voided_by: u.id } : {});
      H.writes.push({ table: t, op: 'update', id: r.id || r.member_id || r.name, ...b });
    }
    return json(200, rows.map((x) => ({ ...x })));
  }
  if (method === 'DELETE') {
    if (!['hr_holidays', 'hr_ot_periods'].includes(t) || !editor) return refuse(403, '42501', 'permission denied for table ' + t);
    const gone = H[key].filter(match); H[key] = H[key].filter((r) => !match(r)); gone.forEach((r) => H.writes.push({ table: t, op: 'delete', id: r.id }));
    return json(200, gone.map((x) => ({ ...x })));
  }
  return refuse(405, '42501', 'method not allowed');
}

// hr_payroll_calc (0046): the month's lines from the live rows
function calc(H, mock, m0) {
  const m1 = nextMonth(m0); const mo = Number(m0.slice(5, 7)); const qEnd = mo % 3 === 0; const q0 = m0.slice(0, 5) + String(mo - ((mo - 1) % 3)).padStart(2, '0') + '-01';
  const qRef = m0.slice(0, 4) + '-Q' + Math.ceil(mo / 3); const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const hol = H.holidays.filter((h) => h.status === 'مؤكد').flatMap((h) => Array.from({ length: h.days || 1 }, (_, i) => addDays(h.day, i)));
  return H.pay.filter((p) => Number(p.salary) > 0).map((p) => ({ p, prof: mock.profiles.find((x) => x.id === p.member_id) })).filter(({ prof }) => prof && prof.status === 'active').map(({ p, prof }) => {
    const s = Number(p.salary); const hb = Number(p.holdback) || 0; const al = Number(p.allowances) || 0; const id = p.member_id;
    const otm = H.overtime.filter((o) => o.member_id === id && o.kind === 'hours' && o.status === 'اتضاف' && o.pay_month === m0).reduce((n, o) => n + o.paid_minutes, 0);
    const rd = H.overtime.filter((o) => o.member_id === id && o.kind === 'rest_day' && o.status === 'اتضاف' && o.pay_month === m0).length;
    let ud = 0; H.requests.filter((r) => r.member_id === id && r.status === 'موافق' && (H.leave_types.find((t) => t.name === r.type) || {}).unpaid).forEach((r) => {
      for (let d = r.from_day > m0 ? r.from_day : m0; d <= r.to_day && d < m1; d = addDays(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w !== 5 && w !== 6 && !hol.includes(d)) ud += 1; } });
    const adj = H.adjustments.filter((j) => j.member_id === id && j.month === m0 && !j.voided_at);
    const plus = adj.reduce((n, j) => n + Math.max(Number(j.amount), 0), 0); const minus = adj.reduce((n, j) => n + Math.max(-Number(j.amount), 0), 0);
    const adv = H.requests.filter((r) => r.member_id === id && r.type === 'سُلفة' && r.status === 'موافق' && r.decided_at).filter((r) => { const dm = monthOf(new Date(r.decided_at).toISOString().slice(0, 10)); return m0 >= nextMonth(dm) && m0 < nextMonth(dm, 1 + r.months); })
      .reduce((n, r) => n + r2(Number(r.amount) / r.months), 0);
    const sc = H.scores.filter((x) => x.member_id === id && x.month >= q0 && x.month < nextMonth(q0, 3)).map((x) => Number(x.score));
    const ex = H.extras.filter((e) => e.member_id === id && e.quarter === qRef && e.status === 'معتمدة').reduce((n, e) => n + Number(e.amount), 0);
    const qb = qEnd ? r2(sc.reduce((n, x) => n + (x < 70 ? 0 : hb * Math.min(x, 100) / 100), 0) + ex) : 0;
    const paid = r2(s - hb); const otp = r2(s / 24 / 8 * otm / 60); const rp = r2(s / 24 * 2 * rd); const uc = r2(s / 24 * ud); const al2 = r2(al + plus); const ded = r2(minus);
    return { member_id: id, name: prof.name, salary: s, holdback: hb, paid, ot_minutes: otm, ot_pay: otp, rest_days: rd, rest_pay: rp, unpaid_days: ud, unpaid_cut: uc, allowances: al2, deductions: ded, advance: r2(adv),
      quarter_bonus: qb, net: r2(paid + otp + rp + al2 - ded - adv - uc + qb), missing_scores: qEnd ? 3 - sc.length : 0 };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));
}
