// Phase 10 (0046): the HR tables, RPCs, the Edge Function team-admin and the bucket «hr-docs», emulated for supabase-mock.mjs (not a
// test file itself). hrState(opts) seeds the rows as the database holds them (opts.hrMembers / hrPay / hrAttendance / hrOvertime /
// hrRequests / hrHolidays / hrKpis / hrScores / hrExtras / hrMeetings / hrAdjustments / hrPayroll / hrPayrollLines / hrDocuments / hrTasks (0048) — the ids, dates and
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
// the column grants of 0046 (security review 5 Nov): no member reads or writes hr_members.notes — hr_member_notes / hr_member_note_set
const CLOSED = { hr_members: ['notes'] };
const COLS = {
  hr_members: ['member_id', 'shift_start', 'shift_end', 'hire_date', 'leave_days', 'notes', 'updated_by', 'updated_at'],
  hr_pay: ['member_id', 'salary', 'holdback', 'allowances', 'updated_by', 'updated_at'],
  hr_attendance: ['id', 'member_id', 'day', 'in_at', 'out_at', 'remote', 'source', 'note', 'by_id', 'updated_at', 'ot_from', 'ot_ticket'],
  hr_overtime: ['id', 'member_id', 'day', 'start_at', 'end_at', 'minutes', 'kind', 'note', 'status', 'paid_minutes', 'pay_month', 'decided_by', 'decided_at', 'reason', 'created_at', 'ticket_id'],
  hr_requests_v: ['id', 'code', 'member_id', 'type', 'from_day', 'to_day', 'at_time', 'hours', 'amount', 'months', 'note', 'status', 'decided_by', 'decided_at', 'reason', 'created_by', 'created_at', 'doc_path', 'ticket_id'],
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
  hr_tasks: ['id', 'member_id', 'title', 'status', 'day', 'reason', 'reviewer_id', 'until', 'review_note', 'done_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by'],
};
const KEY = { hr_attendance: 'attendance', hr_overtime: 'overtime', hr_requests_v: 'requests', hr_holidays: 'holidays', hr_leave_types: 'leave_types', hr_bonus_rules: 'bonus_rules', hr_ot_periods: 'ot_periods',
  hr_kpis: 'kpis', hr_scores: 'scores', hr_extras: 'extras', hr_meetings: 'meetings', hr_adjustments: 'adjustments', hr_payroll: 'payroll', hr_payroll_lines: 'payroll_lines', hr_documents: 'documents', hr_members: 'members', hr_pay: 'pay', hr_tasks: 'tasks' };

export function hrState(opts = {}) {
  const T = '2026-11-01T08:00:00Z'; const copy = (l) => (l || []).map((x) => JSON.parse(JSON.stringify(x)));
  return {
    resend: opts.hrResend !== undefined ? opts.hrResend : true, mails: [], // decision 14: team-admin mails the set-your-password link when Resend is set (the default here); hrResend: false = the password
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
    payroll_lines: copy(opts.hrPayrollLines), documents: copy(opts.hrDocuments).map((x, i) => ({ id: i + 1, start_on: null, end_on: null, created_by: null, created_at: T, voided_by: null, voided_at: null, ...x })),
    // «ملفي › مهامي» (decision 25, 0048): no direct write — hr_task_add / set / delete / review below
    tasks: copy(opts.hrTasks).map((x, i) => ({ id: i + 1, status: 'لسه', day: hrToday(), reason: null, reviewer_id: null, until: null, review_note: null, done_at: null, created_by: x.member_id, created_at: T, updated_by: null, updated_at: T, deleted_at: null, deleted_by: null, ...x })),
    bank: copy(opts.hrBank), // decision 39 (0072): closed — hr_bank_get / set / reveal below
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
  // 0069 (phase 13 decision 25): the overtime request ticket — internal, to the direct manager's role, opened in the member's name, with the
  // bell to the admins and the manager; an event per session / decision; the decision closes it
  const ROLE_LABEL = { admin: 'مدير النظام', cs: 'خدمة العملاء', vendors_followup: 'متابعة المبتكرين', accounts: 'الحسابات', ops: 'اللوجستيك والشحن' };
  const tkNum = (id) => 'TKT-' + String(id).padStart(4, '0');
  const otEvent = (tid, text) => { if (!tid) return; const who = mock.profiles.find((p) => p.id === u.id) || {}; mock.ticketEvents.push({ id: mock.ticketEvents.length + 1, ticket_id: tid, kind: 'event', at: now, actor: u.id, actor_name: who.name || 'السيستم', actor_role: ROLE_LABEL[who.role_id] || 'عضو', text, old_value: null, new_value: null, attachments: [] });
    const t = mock.tickets.find((x) => x.id === tid); if (t) t.last_update = now; };
  const otTicket = (member, day, rest) => {
    const p = mock.profiles.find((x) => x.id === member) || {}; const mgr = p.manager_id ? mock.profiles.find((x) => x.id === p.manager_id && x.status === 'active') : null;
    const id = mock.tickets.reduce((m, t) => Math.max(m, t.id), 0) + 1; const name = String(p.name || 'عضو').slice(0, 60); const when = day.slice(8, 10) + '/' + day.slice(5, 7);
    mock.tickets.push({ id, type: 'internal', title: ((rest ? 'يوم راحة/عطلة — ' : 'وقت إضافي — ') + name + ' · ' + when).slice(0, 80), description: 'طلب إضافة وقت إضافي لـ ' + name, priority: 'normal',
      assignee_role: rest ? 'مدير النظام' : (mgr && ROLE_LABEL[mgr.role_id]) || 'مدير النظام', // 0070: a rest day is the admins' order_number: null, order_id: null, customer: null, cs_customer_id: null, cs_conversation_id: null, vendor_id: null, vendor: null, reason: null, follow_up: null,
      attachments: [], status: 'open', created_by: member, created_by_name: p.name || 'عضو', created_by_role: ROLE_LABEL[p.role_id] || 'عضو', created_at: now, last_update: now, reopen_count: 0,
      resolution_outcome: null, resolution_note: null, resolved_by: null, resolved_by_name: null, resolved_at: null, closed_by: null, closed_by_name: null, closed_at: null });
    otEvent(id, 'فتح التذكرة');
    const title = name + (rest ? ' بيشتغل يوم راحة/عطلة' : ' بدأ وقت إضافي');
    mock.alerts.push({ id: 9000 + id, at: now, kind: 'hr.overtime', title, body: rest ? 'مستني موافقة الأدمن' : 'مستني موافقة المدير المباشر', role_id: 'admin', user_id: null, entity: 'tickets/' + tkNum(id), entity_id: 'ot:' + id, read_at: null });
    if (!rest && mgr && mgr.role_id !== 'admin') mock.alerts.push({ id: 9500 + id, at: now, kind: 'hr.overtime', title, body: 'محتاج موافقتك', role_id: null, user_id: mgr.id, entity: 'tickets/' + tkNum(id), entity_id: 'ot:' + id, read_at: null });
    return id;
  };
  // 0071 (decision 33): a request's team ticket — the family only, to the direct manager's role, the bell to the admins and the manager
  const reqFamily = (type) => (H.leave_types.some((t) => t.name === type) ? 'طلب إجازة' : ['شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف'].includes(type) ? 'طلب ' + type : 'طلب موارد بشرية');
  const reqTicket = (r) => {
    const p = mock.profiles.find((x) => x.id === r.member_id) || {}; const mgr = p.manager_id ? mock.profiles.find((x) => x.id === p.manager_id && x.status === 'active') : null;
    const id = mock.tickets.reduce((m, t) => Math.max(m, t.id), 0) + 1; const name = String(p.name || 'عضو').slice(0, 60); const fam = reqFamily(r.type); const when = now.slice(8, 10) + '/' + now.slice(5, 7);
    mock.tickets.push({ id, type: 'internal', title: (fam + ' — ' + name + ' · ' + when).slice(0, 80), description: fam + ' من ' + name + ' (HR-' + String(r.id).padStart(4, '0') + ').', priority: 'normal',
      assignee_role: (mgr && ROLE_LABEL[mgr.role_id]) || 'مدير النظام', order_number: null, order_id: null, customer: null, cs_customer_id: null, cs_conversation_id: null, vendor_id: null, vendor: null, reason: null, follow_up: null,
      attachments: [], status: 'open', created_by: r.member_id, created_by_name: p.name || 'عضو', created_by_role: ROLE_LABEL[p.role_id] || 'عضو', created_at: now, last_update: now, reopen_count: 0,
      resolution_outcome: null, resolution_note: null, resolved_by: null, resolved_by_name: null, resolved_at: null, closed_by: null, closed_by_name: null, closed_at: null });
    otEvent(id, 'فتح التذكرة'); r.ticket_id = id;
    mock.alerts.push({ id: 7000 + id, at: now, kind: 'hr.request', title: fam + ' — ' + name, body: 'مستني قرار المدير المباشر', role_id: 'admin', user_id: null, entity: 'tickets/' + tkNum(id), entity_id: 'rq:' + id, read_at: null });
    if (mgr && mgr.role_id !== 'admin') mock.alerts.push({ id: 7500 + id, at: now, kind: 'hr.request', title: fam + ' — ' + name, body: 'محتاج قرارك', role_id: null, user_id: mgr.id, entity: 'tickets/' + tkNum(id), entity_id: 'rq:' + id, read_at: null });
  };
  const otClose = (tid, outcome, note) => { const t = mock.tickets.find((x) => x.id === tid); if (!t || t.status === 'closed') return; const who = mock.profiles.find((p) => p.id === u.id) || {};
    Object.assign(t, { status: 'closed', resolution_outcome: outcome, resolution_note: note, resolved_by: u.id, resolved_by_name: who.name, resolved_at: now, closed_by: u.id, closed_by_name: who.name, closed_at: now, last_update: now }); };
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
      if (H.resend !== false) { H.mails.push({ to: email, kind: 'invite' }); return json(200, { ok: true, id, member_code: code, mailed: true, email }); } // decision 14: Resend set → the set-your-password mail, no password
      return json(200, { ok: true, id, member_code: code, mailed: false, password: MOCK_TEMP });
    }
    if (b.action === 'member_delete') { // decision 15: a trace (an activity_log row as actor, or staff managed) refuses; else the rows go
      const p = prof(b.member_id); if (!p) return json(404, { error: 'not_found' }); if (b.member_id === u.id) return json(400, { error: 'invalid', field: 'member_id' });
      if (p.member_code === 'M01') return json(409, { error: 'owner' }); // 0067
      if ((mock.activityRows || []).some((r) => r.actor === p.id)) return json(409, { error: 'has_records', table: 'activity_log' });
      const hist = ['attendance', 'overtime', 'requests'].find((k) => (H[k] || []).some((x) => x.member_id === p.id)); if (hist) return json(409, { error: 'has_records', table: 'hr_' + hist }); // 0067: HR history is a trace
      if (mock.profiles.some((x) => x.manager_id === p.id)) return json(409, { error: 'has_records', table: 'profiles' });
      if (p.role_id === 'admin' && !mock.profiles.some((x) => x.id !== p.id && x.role_id === 'admin' && x.status === 'active')) return json(409, { error: 'last_admin' });
      mock.profiles.splice(mock.profiles.indexOf(p), 1); H.members = H.members.filter((x) => x.member_id !== p.id); H.pay = H.pay.filter((x) => x.member_id !== p.id);
      mock.activityRows.push({ id: mock.activityRows.length + 1, at: now, actor: null, action: 'hr.member.delete', entity: 'profile', entity_id: p.id, new_value: p.name });
      return json(200, { ok: true, id: p.id, name: p.name });
    }
    if (b.action === 'member_invite') { // decision 14
      const p = prof(b.member_id); if (!p) return json(404, { error: 'not_found' }); if (b.member_id === u.id) return json(400, { error: 'invalid', field: 'member_id' });
      if (p.status !== 'active') return json(409, { error: 'inactive' }); if (H.resend === false) return json(503, { error: 'not_configured' });
      H.mails.push({ to: p.email, kind: 'invite' }); return json(200, { ok: true, id: p.id, mailed: true });
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
    // hr_shift_now: the open one first (within 20 hours), else today's latest; 0068 (decision 24): + the day's other closed minutes and its sessions
    const dayDone = (member, day, except) => H.attendance.filter((x) => x.member_id === member && x.day === day && x.out_at && x.id !== except).reduce((n, x) => n + minutes(x.in_at, x.out_at), 0);
    const shift = () => { const l = H.attendance.filter((x) => x.member_id === u.id && ((x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000) || x.day === today));
      l.sort((x, y) => ((y.out_at == null) - (x.out_at == null)) || (x.in_at < y.in_at ? 1 : -1)); const a = l[0];
      return a ? { id: a.id, day: a.day, in_at: a.in_at, out_at: a.out_at, remote: a.remote, done: dayDone(u.id, a.day, a.id), sessions: H.attendance.filter((x) => x.member_id === u.id && x.day === a.day).length, ot_from: a.ot_from || null, ot_ticket: a.ot_ticket || null } : null; };
    if (f === 'hr_settings') return json(200, active ? ((mock.settings.find((s) => s.section === 'hr') || {}).data || {}) : null);
    // the internal notes (security review 5 Nov): hr.edit F, on the members they see, never their own row
    if (f === 'hr_member_notes') return json(200, editor ? H.members.filter((r) => r.notes != null && r.member_id !== u.id && sees(r.member_id)).map((r) => ({ member_id: r.member_id, notes: r.notes })) : []);
    if (f === 'hr_member_note_set') {
      if (!editor || !b.p_member || b.p_member === u.id || !sees(b.p_member)) return no();
      const v = String(b.p_notes == null ? '' : b.p_notes).trim() || null; if (v && v.length > 500) return bad('notes'); if (!prof(b.p_member)) return nf();
      const ex = H.members.find((r) => r.member_id === b.p_member);
      if (ex) Object.assign(ex, { notes: v, updated_by: u.id, updated_at: now }); else H.members.push({ member_id: b.p_member, shift_start: '09:00', shift_end: '17:00', hire_date: null, leave_days: 21, notes: v, updated_by: u.id, updated_at: now });
      H.writes.push({ table: 'hr_members', op: 'note', member_id: b.p_member }); return json(200, null);
    }
    if (f === 'hr_team') return json(200, mock.profiles.filter((p) => sees(p.id)).map((p) => ({ id: p.id, member_code: p.member_code, name: p.name, title: p.title || null, dept: p.dept || null, manager_id: p.manager_id || null, status: p.status, role_id: p.role_id })));
    if (f === 'hr_shift_now') return json(200, active ? shift() : null);
    if (f === 'hr_clock_in') {
      if (!active) return no();
      const open = H.attendance.find((x) => x.member_id === u.id && x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000); if (open) return json(200, shift());
      // 0068 (decision 24): another session the same day is fine — no «ended»
      const remote = H.requests.some((x) => x.member_id === u.id && x.type === 'شغل عن بُعد' && x.status === 'موافق' && x.from_day <= today && x.to_day >= today); // 0046: the server's, never the caller's
      if ('p_remote' in b) return json(404, { code: 'PGRST202', message: 'Could not find the function public.hr_clock_in(p_remote) in the schema cache' });
      H.attendance.push({ id: nextId(), member_id: u.id, day: today, in_at: now, out_at: null, remote, source: 'clock', note: null, by_id: u.id, updated_at: now });
      return json(200, shift());
    }
    if (f === 'hr_overtime_begin') {
      if (!active) return no();
      const a = H.attendance.filter((x) => x.member_id === u.id && x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000).sort((x, y) => (x.in_at < y.in_at ? 1 : -1))[0];
      if (!a) return bad('shift');
      if (!a.ot_ticket) a.ot_ticket = otTicket(u.id, a.day, restDay(H, a.day)); if (!a.ot_from) a.ot_from = now;
      return json(200, { ticket: a.ot_ticket, ot_from: a.ot_from });
    }
    if (f === 'hr_clock_out') {
      if (!active) return no();
      const a = H.attendance.filter((x) => x.member_id === u.id && x.out_at == null && Date.parse(x.in_at) > Date.now() - 20 * 3600000).sort((x, y) => (x.in_at < y.in_at ? 1 : -1))[0];
      if (!a) return bad('no open shift');
      const out = b.p_at && Date.parse(b.p_at) < Date.now() ? new Date(Date.parse(b.p_at)).toISOString() : now; a.out_at = out; a.updated_at = now;
      const worked = minutes(a.in_at, out); const note = String(b.p_ot_note || '').trim(); const total = dayDone(u.id, a.day, a.id) + worked; // 0068: the DAY past 8 hours
      if (restDay(H, a.day)) {
        let otId = null; const ex = H.overtime.find((o) => o.member_id === u.id && o.day === a.day && o.kind === 'rest_day'); let tid = null;
        if (worked > 0 && !ex) { otId = nextId(); tid = a.ot_ticket || otTicket(u.id, a.day, true); H.overtime.push({ id: otId, member_id: u.id, day: a.day, start_at: a.in_at, end_at: out, minutes: Math.min(worked, 1440), kind: 'rest_day', note: note || 'شغل يوم راحة / عطلة', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now, ticket_id: tid }); }
        else if (worked > 0 && ex.status === 'مستني') { ex.minutes = Math.min(ex.minutes + worked, 1440); ex.end_at = out; otId = ex.id; tid = ex.ticket_id || null; }
        if (tid) otEvent(tid, 'جلسة يوم راحة/عطلة (' + worked + ' دقيقة)');
        return json(200, { worked, day_total: total, overtime_id: otId, overtime: 0, rest_day: true, ticket: tid });
      }
      const since = a.ot_from ? Math.max(0, minutes(Date.parse(a.ot_from) > Date.parse(a.in_at) ? a.ot_from : a.in_at, out)) : 0;
      const part = Math.min(worked, Math.max(total - 480, 0, since)); let tid = null;
      let otId = null; if (note && part > 0) { otId = nextId(); tid = a.ot_ticket || otTicket(u.id, a.day, false); H.overtime.push({ id: otId, member_id: u.id, day: a.day, start_at: new Date(Date.parse(out) - part * 60000).toISOString(), end_at: out, minutes: part, kind: 'hours', note, status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now, ticket_id: tid });
        otEvent(tid, 'الوقت الإضافي: ' + part + ' دقيقة — مستني موافقة المدير المباشر (التفاصيل في «الموارد البشرية › الطلبات»)'); }
      else if (a.ot_ticket) { otEvent(a.ot_ticket, 'الدوام خلص من غير وقت إضافي يتسجل'); otClose(a.ot_ticket, 'مش مشكلة', 'مافيش وقت إضافي اتسجل'); }
      return json(200, { worked, day_total: total, overtime_id: otId, overtime: otId ? part : 0, ticket: tid });
    }
    if (f === 'hr_attendance_set') {
      if (!editor) return no(); if (!b.p_member || !b.p_day || !b.p_in || b.p_day > today) return bad('day'); if (!prof(b.p_member)) return nf();
      const inAt = hrAt(b.p_day, b.p_in); const outAt = b.p_out ? hrAt(b.p_out < b.p_in ? addDays(b.p_day, 1) : b.p_day, b.p_out) : null;
      const same = H.attendance.filter((x) => x.member_id === b.p_member && x.day === b.p_day).sort((x, y) => (x.in_at < y.in_at ? -1 : 1));
      let a = same[0]; if (a) H.attendance = H.attendance.filter((x) => !(x.member_id === b.p_member && x.day === b.p_day) || x === a); // 0068: the hand entry replaces the day
      if (a) Object.assign(a, { in_at: inAt, out_at: outAt, remote: !!b.p_remote, source: a.source === 'clock' && a.out_at == null ? 'fix' : 'manual', note: b.p_note || null, by_id: u.id, updated_at: now });
      else { a = { id: nextId(), member_id: b.p_member, day: b.p_day, in_at: inAt, out_at: outAt, remote: !!b.p_remote, source: 'manual', note: b.p_note || null, by_id: u.id, updated_at: now }; H.attendance.push(a); }
      if (outAt && restDay(H, b.p_day) && !H.overtime.some((o) => o.member_id === b.p_member && o.day === b.p_day && o.kind === 'rest_day'))
        H.overtime.push({ id: nextId(), member_id: b.p_member, day: b.p_day, start_at: inAt, end_at: outAt, minutes: Math.min(minutes(inAt, outAt), 1440), kind: 'rest_day', note: 'شغل يوم راحة / عطلة (يدوي)', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now });
      return json(200, a.id);
    }
    // 0068 (decision 24): one session's end — hr.edit F; empty = now (an open session only); past midnight = the next day
    if (f === 'hr_attendance_close') {
      if (!editor) return no(); const a = H.attendance.find((x) => x.id === Number(b.p_id)); if (!a || !sees(a.member_id)) return nf();
      if (a.out_at && !b.p_out) return bad('at');
      let out = b.p_out ? hrAt(a.day, b.p_out) : now; if (Date.parse(out) < Date.parse(a.in_at)) out = hrAt(addDays(a.day, 1), b.p_out);
      if (Date.parse(out) < Date.parse(a.in_at) || Date.parse(out) > Date.now() + 60000) return bad('at');
      const wasOpen = !a.out_at; Object.assign(a, { out_at: out, source: 'fix', note: b.p_note || a.note, by_id: u.id, updated_at: now });
      if (wasOpen && restDay(H, a.day)) { const ex = H.overtime.find((o) => o.member_id === a.member_id && o.day === a.day && o.kind === 'rest_day'); const w = minutes(a.in_at, out);
        if (!ex) H.overtime.push({ id: nextId(), member_id: a.member_id, day: a.day, start_at: a.in_at, end_at: out, minutes: Math.min(w, 1440), kind: 'rest_day', note: 'شغل يوم راحة / عطلة (يدوي)', status: 'مستني', paid_minutes: 0, decided_by: null, decided_at: null, reason: null, created_at: now });
        else if (ex.status === 'مستني') ex.minutes = Math.min(ex.minutes + w, 1440); }
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
      const id = nextId(); H.requests.push({ id, member_id: member, type, from_day: from, to_day: to, at_time: at, hours, amount, months, note: i.note || null, status: 'جديد', decided_by: null, decided_at: null, reason: null, created_by: u.id, created_at: now, doc_path: doc, ticket_id: null });
      reqTicket(H.requests[H.requests.length - 1]); // 0071
      return json(200, id);
    }
    if (f === 'hr_request_decide') {
      const r = H.requests.find((x) => x.id === Number(b.p_id)); if (!r || !sees(r.member_id)) return nf(); if (!decides(r.member_id)) return no();
      if (!['جديد', 'قيد المراجعة'].includes(r.status)) return bad('status'); if (!['موافق', 'مرفوض', 'قيد المراجعة'].includes(b.p_decision)) return bad('decision');
      const reason = String(b.p_reason || '').trim() || null; if (b.p_decision === 'مرفوض' && !reason) return bad('reason');
      Object.assign(r, { status: b.p_decision, reason, decided_by: b.p_decision === 'قيد المراجعة' ? null : u.id, decided_at: b.p_decision === 'قيد المراجعة' ? null : now });
      if (r.ticket_id) { if (b.p_decision === 'قيد المراجعة') otEvent(r.ticket_id, 'الطلب قيد المراجعة'); else { otEvent(r.ticket_id, b.p_decision === 'موافق' ? 'اتوافق على الطلب' : 'اترفض الطلب (السبب في «الموارد البشرية › الطلبات»)'); otClose(r.ticket_id, b.p_decision === 'موافق' ? 'اتحلت المشكلة' : 'مش مشكلة', b.p_decision === 'موافق' ? 'اتوافق' : 'اترفض'); } } // 0071
      if (b.p_decision === 'موافق' && r.type === 'تصحيح انصراف') { const a = H.attendance.filter((x) => x.member_id === r.member_id && x.day === r.from_day).sort((x, y) => ((y.out_at == null) - (x.out_at == null)) || (x.in_at < y.in_at ? 1 : -1))[0]; if (a) /* 0068: the open session, else the latest */ Object.assign(a, { out_at: hrAt(r.from_day, r.at_time), source: 'fix', updated_at: now }); }
      return json(200, b.p_decision);
    }
    if (f === 'hr_request_cancel') { const r = H.requests.find((x) => x.id === Number(b.p_id) && x.member_id === u.id && ['جديد', 'قيد المراجعة'].includes(x.status)); if (!active) return no(); if (!r) return nf(); r.status = 'اتلغى'; if (r.ticket_id) { otEvent(r.ticket_id, 'صاحب الطلب لغاه'); otClose(r.ticket_id, 'مش مشكلة', 'اتلغى من صاحبه'); } return json(200, 'اتلغى'); }
    if (f === 'hr_overtime_decide') {
      const o = H.overtime.find((x) => x.id === Number(b.p_id)); if (!o || !sees(o.member_id)) return nf(); if (!decides(o.member_id)) return no(); if (o.kind === 'rest_day' && !isAdmin(u)) return no(); // 0070
      if (!(o.status === 'مستني' || (o.status === 'اترفض' && b.p_decision === 'add'))) return bad('status'); const reason = String(b.p_reason || '').trim() || null;
      if (o.status === 'اترفض') { if (!editor) return no(); const mt = H.meetings.find((x) => x.member_id === o.member_id && x.ref === 'OT-' + o.id && x.status !== 'اتقفلت'); if (!mt) return bad('meeting');
        Object.assign(mt, { status: 'اتقفلت', outcome: 'اتضاف الوقت', updated_at: now }); } // the meeting's result (the security review)
      if (b.p_decision === 'add') { const m = o.kind === 'rest_day' ? o.minutes : b.p_minutes == null ? o.minutes : Number(b.p_minutes); if (!(m > 0) || m > o.minutes) return bad('minutes');
        let pm = monthOf(o.day); while (H.payroll.some((p) => p.month === pm && ['معتمد', 'مدفوع'].includes(p.status))) pm = nextMonth(pm); // a late approval rides the next open sheet
        Object.assign(o, { status: 'اتضاف', paid_minutes: m, pay_month: pm, decided_by: u.id, decided_at: now, reason });
        if (o.ticket_id) { otEvent(o.ticket_id, o.kind === 'rest_day' ? 'اتوافق على يوم الراحة/العطلة (اليوم بيومين)' : 'اتضاف الوقت الإضافي: ' + m + ' دقيقة'); otClose(o.ticket_id, 'اتحلت المشكلة', o.kind === 'rest_day' ? 'اتوافق — اليوم بيومين' : 'اتضاف ' + m + ' دقيقة'); }
        return json(200, 'اتضاف'); }
      if (b.p_decision === 'reject') { if (!reason) return bad('reason'); Object.assign(o, { status: 'اترفض', paid_minutes: 0, pay_month: null, decided_by: u.id, decided_at: now, reason });
        H.meetings.push({ id: nextId(), member_id: o.member_id, reason: 'وقت إضافي اترفض — نعرف كان بيعمل إيه', status: 'مطلوب', day: null, time_text: null, place: null, outcome: null, plan: null, goals: [], support: null, review_on: null, progress: null, notes: null, ref: 'OT-' + o.id, created_by: u.id, created_at: now, updated_at: now });
        if (o.ticket_id) { otEvent(o.ticket_id, 'اترفض الوقت الإضافي (السبب في «الموارد البشرية › الطلبات»)'); otClose(o.ticket_id, 'مش مشكلة', 'اترفض'); }
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
    // «ملفي › بيانات الحساب» (decision 39, 0072): my bank account, masked; an admin / sensitive.salaries reads anyone's; every reveal logged (no number)
    if (/^hr_bank_(get|set|reveal)$/.test(f)) {
      if (!active) return no();
      const mask = (r) => (r ? { bank_name: r.bank_name, holder: r.holder, account: '•••• ' + r.account_number.slice(-4), iban: r.iban ? r.iban.slice(0, 2) + ' •••• ' + r.iban.slice(-4) : null, updated_at: r.updated_at } : null);
      const of = (m) => H.bank.find((x) => x.member_id === m);
      if (f === 'hr_bank_set') {
        const p = b.p_input || {}; const bank = String(p.bank_name || '').trim(); const holder = String(p.holder || '').trim();
        const num = String(p.account_number || '').replace(/[\s-]/g, ''); const iban = String(p.iban || '').replace(/[\s-]/g, '').toUpperCase() || null;
        if (!bank || bank.length > 80) return bad('bank'); if (!holder || holder.length > 120) return bad('holder');
        if (!/^[0-9]{6,30}$/.test(num)) return bad('number'); if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return bad('iban');
        const row = { member_id: u.id, bank_name: bank, holder, account_number: num, iban, updated_at: now }; const ex = of(u.id);
        if (ex) Object.assign(ex, row); else H.bank.push(row);
        mock.activity.push({ action: 'hr.bank.set', entity: 'hr_bank', entity_id: u.id, actor: u.id }); return json(200, mask(of(u.id)));
      }
      const m = b.p_member || u.id; if (m !== u.id && !(isAdmin(u) || salaries)) return no();
      if (f === 'hr_bank_get') return json(200, mask(of(m)));
      const r = of(m); if (!r) return nf();
      mock.activity.push({ action: 'hr.bank.reveal', entity: 'hr_bank', entity_id: m, actor: u.id });
      return json(200, { bank_name: r.bank_name, holder: r.holder, account_number: r.account_number, iban: r.iban });
    }
    if (f === 'hr_my_slips') { // «ملفي › مرتبي» (T7): my approved / paid lines with the sheet's status, never its total
      if (!active) return json(200, []);
      const st = (m) => H.payroll.find((p) => p.month === m);
      return json(200, H.payroll_lines.filter((l) => l.member_id === u.id && st(l.month) && ['معتمد', 'مدفوع'].includes(st(l.month).status)).sort((a, b) => (a.month < b.month ? 1 : -1))
        .map(({ member_id, ...l }) => ({ ...l, status: st(l.month).status, paid_at: st(l.month).paid_at })));
    }
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
    // ---------- «ملفي › مهامي» (decision 25, 0048): the same rules as the SQL ----------
    const TASK_ST = ['لسه', 'جاري', 'متوقفة', 'جاهزة للمراجعة', 'خلصت', 'اتأجلت'];
    const writer = (id) => active && !!id && (id === u.id || manages(id) || (editor && sees(id)));
    const tclean = (x) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const liveTask = (id) => H.tasks.find((r) => r.id === id && !r.deleted_at) || null;
    if (f === 'hr_task_people') return json(200, active ? mock.profiles.filter((p) => p.status === 'active').map((p) => ({ id: p.id, member_code: p.member_code, name: p.name })).sort((x, y) => (x.member_code < y.member_code ? -1 : 1)) : []);
    if (f === 'hr_task_add') {
      const mem = b.p_member || u.id; if (!writer(mem)) return no(); const ti = tclean(b.p_title); if (!ti || ti.length > 200) return bad('title');
      const pr = prof(mem); if (!pr || pr.status !== 'active') return nf();
      if (H.tasks.filter((x) => x.member_id === mem && !x.deleted_at && x.status !== 'خلصت').length >= 300) return bad('count');
      const id = nextId(); H.tasks.push({ id, member_id: mem, title: ti, status: 'لسه', day: today, reason: null, reviewer_id: null, until: null, review_note: null, done_at: null, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now, deleted_at: null, deleted_by: null });
      H.writes.push({ table: 'hr_tasks', op: 'add', id, member_id: mem }); return json(200, id);
    }
    if (f === 'hr_task_set') {
      const a = b.p_args && typeof b.p_args === 'object' && !Array.isArray(b.p_args) ? b.p_args : null; if (!a) return bad('args');
      const x = liveTask(b.p_id); if (!x || !sees(x.member_id)) return nf(); if (!writer(x.member_id)) return no();
      const s = b.p_status; if (!TASK_ST.includes(s)) return bad('status'); const reason = tclean(a.reason);
      if (s === 'متوقفة' && (!reason || reason.length > 300)) return bad('reason');
      let rv = null; if (s === 'جاهزة للمراجعة') { rv = a.reviewer || null; const rp = rv && prof(rv); if (!rp || rv === x.member_id || rp.status !== 'active') return bad('reviewer'); }
      let until = null; if (s === 'اتأجلت' && !a.indefinite) { until = a.until || null; if (!until || until < today) return bad('until'); }
      Object.assign(x, { status: s, reason: s === 'متوقفة' ? reason : null, reviewer_id: rv, until, review_note: null, done_at: s === 'خلصت' ? (x.status === 'خلصت' && x.done_at ? x.done_at : now) : null,
        day: x.day < today ? today : x.day, updated_by: u.id, updated_at: now });
      H.writes.push({ table: 'hr_tasks', op: 'status', id: x.id, status: s }); return json(200, s);
    }
    if (f === 'hr_task_delete') {
      const x = liveTask(b.p_id); if (!x || !sees(x.member_id)) return nf();
      if (!writer(x.member_id) || (x.member_id === u.id && x.created_by !== u.id && !isAdmin(u))) return no();
      Object.assign(x, { deleted_at: now, deleted_by: u.id, updated_by: u.id, updated_at: now }); H.writes.push({ table: 'hr_tasks', op: 'delete', id: x.id }); return json(200, null);
    }
    if (f === 'hr_task_review') {
      if (!active) return no(); const x = H.tasks.find((r) => r.id === b.p_id && !r.deleted_at && r.status === 'جاهزة للمراجعة' && r.reviewer_id === u.id); if (!x) return nf();
      if (typeof b.p_ok !== 'boolean') return bad('decision'); const note = tclean(b.p_note); if ((!b.p_ok && !note) || note.length > 300) return bad('note');
      Object.assign(x, { status: b.p_ok ? 'خلصت' : 'جاري', done_at: b.p_ok ? now : null, review_note: b.p_ok ? null : note, day: x.day < today ? today : x.day, updated_by: u.id, updated_at: now });
      H.writes.push({ table: 'hr_tasks', op: 'review', id: x.id, ok: b.p_ok }); return json(200, b.p_ok ? 'خلصت' : 'جاري');
    }
    return null;
  }

  // ---------- the tables ----------
  const t = rest[1]; const key = KEY[t];
  const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
  const params = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k));
  const test = ([k, v]) => (v.startsWith('eq.') ? (r) => String(r[k]) === v.slice(3) : v.startsWith('neq.') ? (r) => String(r[k]) !== v.slice(4) : v.startsWith('gte.') ? (r) => r[k] != null && String(r[k]) >= v.slice(4) : v === 'is.null' ? (r) => r[k] == null
    : /^in\.\(.*\)$/.test(v) ? ((set) => (r) => set.includes(String(r[k])))(v.slice(4, -1).split(',').map((x) => x.replace(/^"(.*)"$/, '$1'))) : null);
  const fns = params.map(test); if (fns.some((x) => !x)) return refuse(400, 'PGRST100', 'mock: unsupported filter on ' + t + ': ' + params.map((p) => p.join('=')).join('&'));
  const match = (r) => fns.every((x) => x(r));
  if (method === 'GET') {
    const sel = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim()); const miss = sel.find((x) => x !== '*' && !COLS[t].includes(x));
    if (miss) return refuse(400, '42703', 'column ' + t + '.' + miss + ' does not exist');
    if ((CLOSED[t] || []).some((x) => sel.includes(x) || sel.includes('*'))) return refuse(403, '42501', 'permission denied for table ' + t);
    if (!active) return json(200, []);
    const visible = t === 'hr_pay' || t === 'hr_extras' || t === 'hr_payroll_lines' ? (r) => salaries || own(r) : t === 'hr_adjustments' ? (r) => salaries || (own(r) && !r.voided_at)
      : t === 'hr_payroll' ? () => salaries : t === 'hr_documents' ? (r) => editor || own(r) : ['hr_holidays', 'hr_leave_types', 'hr_bonus_rules', 'hr_ot_periods'].includes(t) ? () => true
      : t === 'hr_tasks' ? (r) => !r.deleted_at && (sees(r.member_id) || (r.reviewer_id === u.id && r.status === 'جاهزة للمراجعة')) : (r) => sees(r.member_id);
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
  if (list.some((r) => r && (CLOSED[t] || []).some((x) => x in r))) return refuse(403, '42501', 'permission denied for table ' + t);
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
