
/* HR page «الموارد البشرية» — the prototype of 2 Nov 18:12 (v5 block 15) on IBHR (phase 10 T5, docs/superpowers/plans/2026-11-05-phase-10-hr.md).
   The HR rebuild (the owner 12 Nov, docs/superpowers/plans/2026-11-12-hr-rebuild.md, 0083): نظرة عامة · الفريق والحضور · المرتبات · التقييمات ·
   التقارير · سجل الحركات — the requests live in «طلبات الفريق», the settings in «الإعدادات › الموارد البشرية». Rules in IbtekrOps (block 12) and on the server
   (0046); every write goes through IBHR (app/js/adapter/hr.js) and the page draws again on «ib:hr». The demo's fixed dates became today's
   (Cairo), this month and the quarter picked; the money columns need sensitive.salaries, the actions hr.edit / hr.approve (the server decides). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U;
  const H = () => window.IBHR;
  // owner batch 14 Nov decision 7 (0087): a member's day (own time → department → official hours) and the day rate's divisor from the settings
  const dayMin = (m) => (H() && H().dayMinutes ? H().dayMinutes(m && m.uid) : 480);
  const rateOf = (m) => ({ divisor: H() && H().dayDivisor ? H().dayDivisor() : 24, dayHours: dayMin(m) / 60 });
  const S = (window.IBHR && window.IBHR.data) || K.store; // IBHR.data is one object for the session; its rows change with each load
  // the owner 12 Nov — «نضيف تاب نظرة عامة ونضيف تاب سجل الحركات»: «نظرة عامة» first (the day's cards, the month, who is in, what waits,
  // the leaves coming) and «سجل الحركات» (the HR rows of the activity log) before the reports — the log for hr.view F
  // the rebuild (decision 1): «المرتبات» for sensitive.salaries, «سجل الحركات» for hr.view F
  const TABS_ALL = [{ id: 'overview', label: 'نظرة عامة' }, { id: 'team', label: 'الفريق والحضور' }, { id: 'payroll', label: 'المرتبات' }, { id: 'evals', label: 'التقييمات' }, { id: 'reports', label: 'التقارير' }, { id: 'log', label: 'سجل الحركات' }];
  const tabs = () => TABS_ALL.filter((t) => (t.id !== 'log' || can().view === 'F' || can().admin) && (t.id !== 'payroll' || can().salaries));
  const TABS = TABS_ALL;
  const st = { tab: 'overview', teamSub: 'team', q: '', dept: '', logMember: '', logMonth: '', calStart: '', sheetMonth: '', lines: {}, evalSub: 'month', evalMonth: '', evalQuarter: '' };
  const R = () => window.IBPages.render('hr');
  const can = () => (H() ? H().can() : { view: 'N', edit: false, approve: false, salaries: false, admin: false });
  const today = () => H().today(); const nowMin = () => H().nowMin(); const thisMonth = () => H().monthKey(today());
  const team = () => (H() ? H().team() : []);
  const M = (id) => (H() && H().member(id)) || K.member(id);
  const PENDING = ['جديد', 'قيد المراجعة'];
  const isPending = (r) => PENDING.includes(r.status);
  const isLeave = (r) => (H() ? H().isLeave(r.type) : String(r.type).startsWith('إجازة'));
  const hhmm = (m) => (m == null ? '—' : String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  const toMin = (s) => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
  const holidayDates = () => H().holidayDates();
  const leaveLeft = (m) => (Number(m.leave) || 0) - (Number(m.used) || 0);
  const daysOf = (r) => H().leaveDays(r.from, r.to, holidayDates());
  const pendingCount = () => S.requests.filter(isPending).length + S.overtime.filter((o) => o.status === 'مستني').length;
  const mcell = (id) => { const m = M(id); return h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', null, m.title))); };
  const note = (t) => h('p', { class: 't-small help', style: 'margin:0' }, t);
  const toMember = (list) => (i) => { const x = list[i]; if (x) location.hash = 'member-' + (x.member || x.id); };
  const money = (n) => (can().salaries ? K.money(n) : '••••');
  const monLabel = (key) => K.AR_MON[Number(String(key).slice(5, 7)) - 1] + ' ' + String(key).slice(0, 4);
  const monShort = (key) => K.AR_MON[Number(String(key).slice(5, 7)) - 1];
  const addMonths = (key, n) => { const d = new Date(key + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  const isoDay = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const offDay = (d) => (H() && H().isWorkDay ? !H().isWorkDay(d) : isoDay(d) === 5 || isoDay(d) === 6); // 0087: the settings' work days
  // a write: the modal stays open (and refuses a second click) until the server answers; the error comes back as a toast
  function busy(m, promise, ok) { // phase 13 decision 13: `promise` may be a function — it runs only once the guard passed, so a second click never sends a second request
    if (m && m._busy) return false; if (m) m._busy = true;
    Promise.resolve(typeof promise === 'function' ? promise() : promise).then((r) => { if (m) m._busy = false; if (r && r.ok) { if (m) m.close(); if (ok) ok(r); } else K.toast((r && r.message) || 'حصلت مشكلة — جرّب تاني', 'error'); });
    return false;
  }
  const after = (promise, okText) => Promise.resolve(promise).then((r) => { if (r && r.ok) { if (okText) K.toast(okText, 'success'); } else K.toast((r && r.message) || 'حصلت مشكلة — جرّب تاني', 'error'); return r; });
  // a file input that keeps the File (the kit's file field keeps its name only)
  const picked = {};
  function fileField(id, label, f, errs, set, o = {}) {
    const inp = h('input', { type: 'file', id, class: 'sr-file', accept: '.pdf,.jpg,.jpeg,.png,.webp', onChange: () => { picked[id] = inp.files[0] || null; set(id, picked[id] ? picked[id].name : '', true); } });
    return U.FieldShell({ id, label, required: o.required, error: errs[id], help: o.help || 'PDF أو صورة — حد أقصى 10 ميجا' }, h('label', { class: 'upload' + (errs[id] ? ' err' : ''), for: id }, Icon('attach', 'sm'), h('span', null, f[id] || 'اختار ملف أو اسحبه هنا'), inp));
  }

  // the quarter: the current one by default, or one picked
  const qOf = (key) => H().quarterOf(key);
  const QN = ['الأول', 'التاني', 'التالت', 'الرابع'];
  const qLabel = (q) => 'الربع ' + QN[Number(q.slice(-1)) - 1] + ' ' + q.slice(0, 4);
  // the quarter's evaluation out of 5 (decision 2): the average of its rated months — null before any
  const qScore = (id, q = qOf(thisMonth())) => { const x = H().quarterEval(id, q); return x ? x.total : null; };

  // today status: حاضر · أنهى الدوام · عن بُعد · انصراف ناقص (decision 24: no «متأخر» — flexible hours) · إجازة · عطلة رسمية · راحة · غائب
  function status(m) {
    if (m.status === 'suspended') return ['موقوف', 'danger']; // decision 15: the roster shows the suspended too
    const t = S.today[m.id];
    if (!t) return ['مسجلش حضور', 'neutral'];
    if (t.kind === 'leave') return [t.leaveType || 'إجازة', 'gold'];
    if (t.kind === 'holiday') return ['عطلة رسمية', 'info'];
    if (t.kind === 'off') return ['راحة أسبوعية', 'neutral'];
    if (t.kind === 'absent') return ['غائب', 'error'];
    if (t.in == null) return t.missingYesterday ? ['انصراف ناقص أمس', 'orange'] : ['مسجلش حضور', 'neutral'];
    if (t.out != null) return ['أنهى الدوام', 'neutral'];
    if (t.remote) return ['عن بُعد', 'info'];
    if (t.missingYesterday) return ['انصراف ناقص أمس', 'orange'];
    if (nowMin() - t.in >= dayMin(m)) return ['وقت إضافي', 'orange'];
    return ['حاضر', 'success'];
  }
  const present = (m) => { const t = S.today[m.id]; return !!t && t.in != null && t.out == null; };
  // decision 24: the day's sessions summed (+ the open one so far)
  const todayMin = (m) => { const t = S.today[m.id]; if (!t || t.in == null) return null; return (Number(t.mins) || 0) + (t.out == null && t.openIn != null ? Math.max(0, nowMin() - t.openIn) : 0); };

  // «تخصيص اللوحة» (decision 22): the tab's blocks follow the member's choice after each render; the reports tab has its own
  const pnl = (...kids) => { const el = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...kids); if (st.tab !== 'reports') setTimeout(() => K.applyPanelPrefs('hr:' + st.tab, el), 0); return el; };
  function view() {
    if (!H()) return [K.Empty('الموارد البشرية مش متاحة', 'جرّب تفتح الصفحة تاني.')];
    const c = can(); if (!tabs().some((t) => t.id === st.tab)) st.tab = 'overview';
    return [K.PageHead('الموارد البشرية', 'الفريق · الحضور والانصراف · المرتبات · التقييمات', [st.tab === 'reports' ? null : K.PanelButton('hr:' + st.tab, 'الموارد البشرية — ' + (TABS.find((t) => t.id === st.tab) || {}).label, () => document.querySelector('#pg-hr .panel'), R), c.edit ? Button({ label: 'تسجيل حضور يدوي', icon: 'clock', onClick: () => manualAtt() }) : null, c.admin ? Button({ type: 'brand', label: 'إضافة عضو', icon: 'plus', onClick: () => addMember() }) : null]),
      H().state() === 'error' ? U.InlineNote({ kind: 'error', children: 'تعذّر تحميل بيانات الموارد البشرية — جرّب تاني بعد شوية.' }) : null,
      K.MainTabs({ items: tabs(), active: st.tab, onChange: (id) => { st.tab = id; try { history.replaceState(null, '', '#hr-' + id); } catch (e) { /* */ } R(); }, label: 'أقسام الموارد البشرية' }),
      pnl(...(st.tab === 'overview' ? overviewTab() : st.tab === 'team' ? teamTab() : st.tab === 'payroll' ? payrollTab() : st.tab === 'evals' ? evalsTab() : st.tab === 'log' ? logTab() : reportsTab()))];
  }
  // تاب «التقارير»: تقارير الموظفين بتتفتح مع تاب «الموظفين» في صفحة التقارير (T8)
  // «التقارير» (T8, decision 20): the reports page's «تقارير الموظفين» (IBReportBlocks.staff — one source) with its range
  const reportsTab = () => { const RB = window.IBReportBlocks; if (!RB || !RB.staff) return [K.Section('تقارير الموظفين', K.Empty('التقارير مش متاحة', 'افتح «التقارير › تقارير الموظفين» من القائمة.'))]; return [RB.range ? h('div', { class: 'toolbar pr-rep-bar' }, RB.range()) : null].concat(RB.staff()); };

  // ================= الفريق والحضور =================
  // the day's four cards (owner 12 Nov: on «نظرة عامة» — the team tab keeps its table, its log and its calendar)
  function todayCards() {
    const tm = team(); const counts = (f) => tm.filter((m) => f(status(m)[0])).length;
    const who = (f) => tm.filter((m) => f(status(m)[0]));
    const day = K.dayName(today()) + ' ' + K.dshort(today());
    const dPresent = () => { const l = tm.filter(present); return { title: 'حاضرين دلوقتي — ' + l.length + ' من ' + tm.length, sub: 'النهارده ' + day + ' · اضغط على أي عضو يفتح ملفه', summary: [{ label: 'حاضرين', value: String(l.length) }, { label: 'عن بُعد', value: String(l.filter((m) => (S.today[m.id] || {}).remote).length) }, { label: 'مش حاضرين', value: String(tm.length - l.length) }], headers: ['العضو', 'القسم', 'الدوام', 'الحضور', 'ساعات اليوم', 'الحالة'], rows: l.map((m) => { const t = S.today[m.id] || {}; const tmn = todayMin(m); return [m.name, m.dept, m.shift.join('–'), hhmm(t.in), tmn == null ? '—' : K.hm(tmn), status(m)[0]]; }), onRow: toMember(l), source: 'تسجيل الحضور النهارده' }; };
    // decision 24: flexible hours — no lateness; the card shows who ended their sessions for now (they can start again)
    const dEnded = () => { const l = who((s) => s === 'أنهى الدوام'); return { title: 'أنهوا الدوام لحد دلوقتي — ' + l.length, sub: 'الدوام مرن: ممكن يبدأوا تاني النهارده والساعات بتتجمع', summary: [{ label: 'أعضاء', value: String(l.length) }, { label: 'ساعاتهم', value: K.hm(l.reduce((x, m) => x + (todayMin(m) || 0), 0)) }], headers: ['العضو', 'أول حضور', 'آخر انصراف', 'الجلسات', 'ساعات اليوم'], rows: l.map((m) => { const t = S.today[m.id] || {}; return [m.name, hhmm(t.in), hhmm(t.out), String(t.sessions || 1), K.hm(todayMin(m) || 0)]; }), onRow: toMember(l), empty: 'محدش أنهى الدوام لسه.', source: 'تسجيل الحضور النهارده' }; };
    const dAway = () => { const l = who((s) => s.startsWith('إجازة') || s === 'غائب'); return { title: 'إجازة / غياب النهارده — ' + l.length, sub: day, summary: [{ label: 'إجازة', value: String(l.filter((m) => status(m)[0].startsWith('إجازة')).length) }, { label: 'غياب من غير تسجيل', value: String(l.filter((m) => status(m)[0] === 'غائب').length) }], headers: ['العضو', 'القسم', 'الحالة', 'الطلب', 'رصيد الإجازات'], rows: l.map((m) => { const r = S.requests.find((x) => x.member === m.id && isLeave(x) && x.from <= today() && x.to >= today() && x.status !== 'مرفوض' && x.status !== 'اتلغى'); return [m.name, m.dept, status(m)[0], r ? r.id + ' · ' + r.type + ' (' + r.status + ')' : 'مفيش طلب', leaveLeft(m) + ' يوم']; }), onRow: toMember(l), note: 'الغياب من غير طلب بيتسجل يوم غياب، ولو اتقدّم طلب «إجازة بدون أجر» واتوافق عليه اليوم بيتخصم من المرتب.', source: 'الحضور + طلبات الإجازات' }; };
    const dPending = () => { const rq = S.requests.filter(isPending), ot = S.overtime.filter((o) => o.status === 'مستني'); return { title: 'طلبات مستنية — ' + (rq.length + ot.length), sub: 'محتاجة موافقة أو تأكيد من المسؤول', summary: [{ label: 'طلبات', value: String(rq.length) }, { label: 'وقت إضافي للتأكيد', value: String(ot.length) }], headers: ['الرقم', 'العضو', 'النوع', 'الفترة / التفاصيل', 'الحالة'], rows: rq.map((r) => [r.id, M(r.member).name, r.type, reqPeriod(r), r.status]).concat(ot.map((o) => [o.id, M(o.member).name, o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي', K.dshort(o.date) + ' · ' + o.start + '–' + o.end + ' (' + K.hm(o.minutes) + ')', o.status + ' · ' + o.waitedHours + ' ساعة'])), onRow: (i) => { if (i < rq.length) reqDetails(rq[i]); else otDetails(ot[i - rq.length]); }, source: 'الطلبات + الوقت الإضافي' }; };
    return h('div', { class: 'cards', 'data-hr-today': '' }, K.Stat('حاضرين دلوقتي', tm.filter(present).length, 'من ' + tm.length, tm.filter((m) => present(m) && (S.today[m.id] || {}).remote).length + ' عن بُعد', undefined, dPresent), K.Stat('أنهوا الدوام', counts((s) => s === 'أنهى الدوام'), 'عضو', 'الدوام مرن — مفيش تأخير', undefined, dEnded), K.Stat('إجازة / غياب', counts((s) => s.startsWith('إجازة') || s === 'غائب'), 'عضو', counts((s) => s === 'غائب') + ' غياب من غير تسجيل', undefined, dAway), K.Stat('طلبات مستنية', pendingCount(), 'طلب', S.overtime.filter((o) => o.status === 'مستني').length + ' وقت إضافي للتأكيد', undefined, dPending));
  }
  function teamTab() {
    const subs = [{ id: 'team', label: 'الفريق' }, { id: 'log', label: 'سجل الحضور' }, { id: 'cal', label: 'تقويم الفريق' }];
    const out = [K.SubTabs({ items: subs, active: st.teamSub, onChange: (id) => { st.teamSub = id; R(); }, label: 'الفريق والحضور' })];
    if (st.teamSub === 'team') out.push(teamTable(team()));
    else if (st.teamSub === 'log') out.push(...attLog()); else out.push(...teamCal());
    return out;
  }

  // ================= نظرة عامة (owner 12 Nov) =================
  // a table whose rows open something (U.Table has no row handler; the details popup does)
  const clickRows = (tbl, fn) => { tbl.querySelectorAll('tbody tr').forEach((tr, i) => { tr.classList.add('dt-click'); tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.addEventListener('click', () => fn(i)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(i); }); }); return tbl; };
  function overviewTab() {
    const tm = team(); const t0 = today(); const mk = thisMonth(); const in14 = H().addDays(t0, 14);
    const hours = tm.reduce((x, m) => x + (Number(m.monthMin) || 0), 0); const ot = tm.reduce((x, m) => x + (Number(m.otMonth) || 0), 0);
    const monthReq = S.requests.filter((r) => String(r.atIso || '').slice(0, 7) === mk);
    const leavesNext = S.requests.filter((r) => isLeave(r) && r.status === 'موافق' && r.to >= t0 && r.from <= in14).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const leaveDaysMonth = S.requests.filter((r) => isLeave(r) && r.status === 'موافق' && String(r.from).slice(0, 7) <= mk && String(r.to).slice(0, 7) >= mk).reduce((x, r) => x + daysOf({ from: r.from < mk + '-01' ? mk + '-01' : r.from, to: r.to.slice(0, 7) > mk ? addMonths(mk, 1) + '-01' : r.to }), 0);
    const dHours = () => ({ title: 'ساعات الشهر — ' + monLabel(mk), sub: 'مجموع ساعات الفريق من أول الشهر لحد النهارده', summary: [{ label: 'الساعات', value: K.hm(hours) }, { label: 'الوقت الإضافي', value: K.hm(ot) }], headers: ['العضو', 'القسم', 'ساعات الشهر', 'وقت إضافي'], rows: tm.slice().sort((a, b) => (b.monthMin || 0) - (a.monthMin || 0)).map((m) => [m.name, m.dept, K.hm(m.monthMin || 0), m.otMonth ? K.hm(m.otMonth) : '—']), onRow: (i) => { const l = tm.slice().sort((a, b) => (b.monthMin || 0) - (a.monthMin || 0)); toMember(l)(i); }, source: 'الحضور والوقت الإضافي المتوافق عليه' });
    const dReq = () => ({ title: 'طلبات الشهر — ' + monthReq.length, sub: monLabel(mk), summary: [{ label: 'اتوافق', value: String(monthReq.filter((r) => r.status === 'موافق').length) }, { label: 'مستنية', value: String(monthReq.filter(isPending).length) }, { label: 'اترفض', value: String(monthReq.filter((r) => r.status === 'مرفوض').length) }], headers: ['الرقم', 'العضو', 'النوع', 'الفترة', 'الحالة'], rows: monthReq.map((r) => [r.id, M(r.member).name, r.type, reqPeriod(r), r.status]), onRow: (i) => reqDetails(monthReq[i]), source: 'طلبات الموارد البشرية' });
    const kpis = h('div', { class: 'cards', 'data-hr-month': '' }, K.Stat('ساعات الشهر', K.hm(hours), 'للفريق', monLabel(mk), undefined, dHours), K.Stat('وقت إضافي الشهر', K.hm(ot), 'متوافق عليه', S.overtime.filter((o) => o.status === 'مستني').length + ' مستني تأكيد', undefined, dHours),
      K.Stat('طلبات الشهر', monthReq.length, 'طلب', monthReq.filter(isPending).length + ' مستنية', undefined, dReq), K.Stat('أيام إجازة الشهر', leaveDaysMonth, 'يوم', leavesNext.length + ' إجازة في الأسبوعين الجايين', undefined));
    // who is in now
    const inNow = tm.filter(present);
    const inCard = K.Section('مين في الدوام دلوقتي (' + inNow.length + ')', inNow.length ? h('div', { class: 'hr-in-list', 'data-hr-in': String(inNow.length) }, inNow.map((m) => { const t = S.today[m.id] || {}; return h('a', { class: 'mlink hr-in', href: '#member-' + m.id }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', null, (m.title || m.dept || '') + ' · من ' + hhmm(t.openIn != null ? t.openIn : t.in) + (t.remote ? ' · عن بُعد' : ''))), K.Tag(status(m)[1], status(m)[0])); })) : K.Empty('محدش في الدوام دلوقتي', 'أول ما حد يبدأ الدوام هيظهر هنا.'), null, { sub: K.dayName(t0) + ' ' + K.dshort(t0) });
    // what waits for a decision
    const pend = S.requests.filter(isPending).slice(0, 6); const otp = S.overtime.filter((o) => o.status === 'مستني').slice(0, 6);
    const waitCard = K.Section('مستني قرار (' + (S.requests.filter(isPending).length + S.overtime.filter((o) => o.status === 'مستني').length) + ')', (pend.length || otp.length) ? clickRows(U.Table({ headers: ['الرقم', 'العضو', 'النوع', 'التفاصيل', 'الحالة'], rows: pend.map((r) => [r.id, M(r.member).name, r.type, reqPeriod(r), K.Tag('orange', r.status)]).concat(otp.map((o) => [o.id, M(o.member).name, o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي', K.dshort(o.date) + ' · ' + K.hm(o.minutes), K.Tag('orange', o.status)])) }), (i) => { if (i < pend.length) reqDetails(pend[i]); else otDetails(otp[i - pend.length]); }) : K.Empty('مفيش حاجة مستنية', 'الطلبات والوقت الإضافي اللي محتاجين موافقة بيظهروا هنا.'), [Button({ size: 'sm', label: 'كل الطلبات', attrs: { 'data-hr-all-requests': '' }, onClick: () => { location.hash = 'tickets'; } })]);
    // the leaves coming (14 days)
    const leaveCard = K.Section('الإجازات الجاية (' + leavesNext.length + ')', leavesNext.length ? clickRows(U.Table({ headers: ['العضو', 'النوع', 'من', 'لحد', 'الأيام'], rows: leavesNext.map((r) => [M(r.member).name, r.type, K.Num(K.dshort(r.from)), K.Num(K.dshort(r.to)), K.Num(String(daysOf(r)))]) }), (i) => reqDetails(leavesNext[i])) : K.Empty('مفيش إجازات في الأسبوعين الجايين', ''), null, { sub: 'المتوافق عليها من النهارده لحد ' + K.dshort(in14) });
    return [todayCards(), kpis, inCard, waitCard, leaveCard]; // each block on its own (the panel customizes them one by one)
  }

  // ================= سجل الحركات (owner 12 Nov) =================
  // the HR rows of the activity log (IBHR.loadLog — RLS: hr.view F reads the team's, everyone else their own), newest first
  const LG = { rows: null, busy: false, at: 0 };
  function logLoad(force) {
    if (LG.busy || (!force && LG.rows && Date.now() - LG.at < 60000)) return; LG.busy = true;
    H().loadLog(force).then((r) => { LG.busy = false; if (r && r.ok) { LG.rows = r.items; LG.at = Date.now(); } else if (!LG.rows) LG.rows = []; if (window.IBPages.current === 'hr' && st.tab === 'log' && !document.querySelector('.scrim')) R(); });
  }
  function logTab() {
    logLoad(false);
    const L = LG.rows; const stamp = (iso) => { const d = new Date(iso); if (isNaN(d)) return '—'; const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return K.dshort(day) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }); }; // Cairo's day and time
    const body = L == null ? K.Empty('بيحمّل…', 'لحظة واحدة') : !L.length ? K.Empty('لسه مفيش حركات', 'أي حضور أو طلب أو قرار أو تعديل في الموارد البشرية بيتسجل هنا.')
      : U.Table({ cls: 'hr-log', headers: ['الوقت', 'الحركة', 'النوع', 'على', 'بواسطة', 'التفاصيل'], rows: L.map((x) => [K.Num(stamp(x.at)), x.label, x.group, x.on || '—', x.by, x.detail ? K.Num(x.detail) : '—']) });
    return [K.Section('سجل الحركات', [body, note('الحضور والانصراف، الطلبات وقراراتها، الوقت الإضافي، الأعضاء، المرتبات، التقييم، المهام والإعدادات — آخر 300 حركة. التفاصيل أكواد وشهور وأرقام بس (من غير مبالغ ولا نصوص).')], [Button({ size: 'sm', label: LG.busy ? 'بيحدّث…' : 'تحديث', icon: 'refresh', disabled: LG.busy, attrs: { 'data-hr-log-refresh': '' }, onClick: () => logLoad(true) })], { noun: ['حركة', 'الحركات'] })];
  }
  function teamTable(tm) {
    const everyone = H() && H().everyone ? H().everyone() : tm; // decision 15: the table lists everyone I may see (the suspended and the salary-less admins too); the tiles stay on the staff
    const list = everyone.filter((m) => (!st.q || m.name.includes(st.q) || (m.title || '').includes(st.q)) && (!st.dept || m.dept === st.dept));
    const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم', 'aria-label': 'بحث في الفريق', value: st.q });
    q.addEventListener('input', () => { st.q = q.value; const p = q.selectionStart; R(); const n = document.querySelector('#pg-hr input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    const c = can();
    const TB = K.Bulk({ key: 'hr-team', ids: list.map((m) => m.id), noun: 'عضو', render: R, actions: [
      c.edit ? { id: 'end', label: 'إنهاء الدوام للمحدد', icon: 'check', run: (ids, done) => { const l = list.filter((m) => ids.includes(m.id) && present(m)); if (!l.length) { K.toast('مفيش حد من المحددين لسه في الدوام', 'error'); return; } K.confirm({ title: 'إنهاء دوام ' + l.length + ' أعضاء؟', text: l.map((m) => m.name).join('، ') + ' — الانصراف هيتسجل دلوقتي (' + hhmm(nowMin()) + ').', okLabel: 'إنهاء الدوام', onOk: async () => { let n = 0; for (const m of l) { const r = await H().endShiftFor(m.id); if (r.ok) n += 1; } done(n === l.length ? 'اتقفل دوام ' + n : 'اتقفل دوام ' + n + ' من ' + l.length); } }); } } : null,
      { id: 'export', label: 'تصدير', icon: 'download', run: (ids, done) => { K.xlsxExport('ibtekr-team-' + today() + '.xlsx', 'الفريق', [['العضو', 'القسم', 'الدوام', 'ساعات الشهر', 'أوفر تايم', 'رصيد الإجازات']].concat(list.filter((m) => ids.includes(m.id)).map((m) => [m.name, m.dept, m.shift.join('–'), K.hm(m.monthMin || 0), K.hm(m.otMonth || 0), leaveLeft(m)]))); done(); } }].filter(Boolean) });
    const rows = list.map((m) => { const [sl, stone] = status(m); const t = S.today[m.id] || {}; const tmn = todayMin(m);
      return [TB.box(m.id, m.name), h('a', { class: 'mlink', href: '#member-' + m.id }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', null, m.title))), m.dept, K.Num(m.shift.join('–')), K.Num(hhmm(t.in)), K.Num(hhmm(t.out)), tmn == null ? '—' : K.Num(K.hm(tmn)), K.Num(K.hm(m.monthMin || 0)), m.otMonth ? K.Num(K.hm(m.otMonth)) : '—', leaveLeft(m) + (leaveLeft(m) >= 3 && leaveLeft(m) <= 10 ? ' أيام' : ' يوم'), K.Tag(stone, sl),
        K.RowMenu([{ label: 'فتح الملف', icon: 'users', run: () => { location.hash = 'member-' + m.id; } }, c.edit ? { label: 'تسجيل حضور يدوي', icon: 'clock', run: () => manualAtt(m) } : null, c.edit && present(m) ? { label: 'إنهاء الدوام', icon: 'check', run: () => endShiftFor(m) } : null, { label: 'سجل الحضور', icon: 'activity', run: () => { st.logMember = m.id; st.teamSub = 'log'; R(); } }, c.edit ? { label: 'رفع عقد', icon: 'attach', run: () => uploadContract(m) } : null, c.admin && m.uid !== (window.IBDirectory.me() || {}).id && m.status === 'active' ? { label: 'ابعت إيميل الباسورد تاني', icon: 'send', run: () => resendInvite(m) } : null, c.admin && m.uid !== (window.IBDirectory.me() || {}).id ? { label: 'باسورد مؤقت جديد', icon: 'lock', run: () => newPassword(m) } : null, c.admin && m.uid !== (window.IBDirectory.me() || {}).id && m.id !== 'M01' ? { label: 'حذف العضو نهائي', icon: 'trash', danger: true, run: () => deleteMember(m) } : null].filter(Boolean), 'إجراءات ' + m.name)]; });
    return K.Section('الفريق', [h('div', { class: 'toolbar' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), q), U.Select({ id: 'hr-dept', label: '', options: [{ value: '', label: 'القسم: الكل' }].concat(S.departments.map((d) => ({ value: d, label: 'القسم: ' + d }))), value: st.dept, onChange: (v) => { st.dept = v; R(); } })),
      TB.bar(), list.length ? U.Table({ cls: 'hr-table', headers: [TB.head(), 'العضو', 'القسم', 'الدوام', 'حضور', 'انصراف', 'ساعات اليوم', 'ساعات الشهر', 'أوفر تايم', 'رصيد الإجازات', 'الحالة اليوم', ''], rows }) : K.Empty(tm.length ? 'مفيش أعضاء بالفلتر ده' : 'لسه مفيش أعضاء في الفريق', tm.length ? 'غيّر البحث أو القسم.' : 'ضيف أول عضو من «إضافة عضو».'),
      note('ساعات اليوم = الانصراف − الحضور. بعد ساعات يوم العضو (وقته المخصص أو قسمه أو ساعات العمل الرسمية — من الإعدادات › الموارد البشرية) بيظهر له «إنهاء الدوام / لسه — وقت إضافي». الوقت الإضافي بيتضاف بسعر الساعة (المرتب ÷ ' + (H() && H().dayDivisor ? H().dayDivisor() : 24) + ' ÷ ساعات يومه) بعد تأكيد المسؤول. الشغل في يوم راحة أو عطلة رسمية = اليوم بيومين.'),
      h('div', { class: 'legend t-small' }, h('b', null, 'حالات اليوم:'), K.Tag('success', 'حاضر'), K.Tag('neutral', 'أنهى الدوام'), K.Tag('info', 'عن بُعد'), K.Tag('orange', 'انصراف ناقص'), K.Tag('gold', 'إجازة'), K.Tag('info', 'عطلة رسمية'), K.Tag('error', 'غائب'))], null, { noun: ['عضو', 'الأعضاء'], count: [list.length, everyone.length] });
  }
  // the member's month, day by day up to today: the attendance rows + the approved leaves, holidays, rest days and absences
  function monthDays(m, mk) {
    const end = mk === thisMonth() ? today() : addMonths(mk, 1) + '-01'; const hol = holidayDates(); const out = [];
    const att = new Map(S.attendance.filter((a) => a.member === m.id && a.date.startsWith(mk)).map((a) => [a.date, a]));
    for (let d = mk + '-01'; d <= end && d.startsWith(mk); d = H().addDays(d, 1)) {
      const a = att.get(d); if (a) { out.push(a); continue; }
      if (d === today()) continue;
      const lv = S.requests.find((r) => r.member === m.id && isLeave(r) && r.status === 'موافق' && r.from <= d && r.to >= d);
      if (hol.includes(d)) out.push({ member: m.id, date: d, type: 'عطلة رسمية', in: null, out: null, ot: 0, late: 0, status: 'عطلة', src: (S.holidays.find((x) => d >= x.date && d <= H().addDays(x.date, x.days - 1)) || {}).name || '—' });
      else if (offDay(d)) out.push({ member: m.id, date: d, type: 'راحة أسبوعية', in: null, out: null, ot: 0, late: 0, status: 'راحة', src: '—' });
      else if (lv) out.push({ member: m.id, date: d, type: lv.type, in: null, out: null, ot: 0, late: 0, status: 'إجازة', src: 'طلب ' + lv.id + ' موافق' });
      else out.push({ member: m.id, date: d, type: 'يوم عمل', in: null, out: null, ot: 0, late: 0, status: 'غياب', src: 'من غير إذن' });
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  function attLog() {
    const tm = team(); if (!tm.length) return [K.Empty('لسه مفيش أعضاء', '')];
    const m = M(st.logMember && tm.some((x) => x.id === st.logMember) ? st.logMember : tm[0].id); const mk = st.logMonth || thisMonth();
    const rows = monthDays(m, mk); const work = rows.filter((a) => a.in != null);
    const hrsOf = (a) => (a.in == null ? null : (Number(a.mins) || 0) + (a.out == null && a.date === today() && a.openIn != null ? Math.max(0, nowMin() - a.openIn) : 0)); // decision 24: the sessions summed
    const total = work.reduce((s, a) => s + (hrsOf(a) || 0), 0);
    const okOt = S.overtime.filter((o) => o.member === m.id && o.kind === 'hours' && o.status === 'اتضاف' && o.date.startsWith(mk)); const ot = okOt.reduce((s, o) => s + o.paid, 0);
    const rest = S.restWork.filter((r) => r.member === m.id && r.date.startsWith(mk)).length; const nSess = work.reduce((n, a) => n + ((a.sessions && a.sessions.length) || 1), 0);
    const workDays = rows.filter((a) => a.type === 'يوم عمل' || (a.in == null && a.status === 'إجازة')).length + (S.attendance.some((a) => a.member === m.id && a.date === today()) || offDay(today()) || mk !== thisMonth() ? 0 : 1);
    const need = workDays * dayMin(m);
    const statusTone = (s) => (s === 'حاضر' || s === 'منتظم' ? 'success' : s === 'انصراف ناقص' ? 'orange' : s === 'إجازة' ? 'gold' : s === 'غياب' ? 'error' : s === 'شغل يوم راحة' || s.startsWith('وقت إضافي') ? 'brand' : 'neutral');
    const otPay = O.overtimePay(m.salary || 0, { hours: ot / 60 }, rateOf(m)), restPay = O.overtimePay(m.salary || 0, { offDays: rest }, rateOf(m));
    const dayRow = (a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), a.type, hhmm(a.in), hhmm(a.out), hrsOf(a) == null ? '—' : K.hm(hrsOf(a)) + (a.date === today() && a.out == null ? ' (جاري)' : ''), a.status];
    const dDays = () => { const l = work.filter((a) => a.type === 'يوم عمل'); return { title: 'أيام الحضور — ' + m.name + ' · ' + monLabel(mk), sub: l.length + ' يوم من ' + workDays + ' يوم عمل · اضغط على اليوم للتفاصيل', summary: [{ label: 'أيام الحضور', value: String(l.length) }, { label: 'منتظم', value: String(l.filter((a) => a.status !== 'انصراف ناقص').length) }, { label: 'جلسات', value: String(l.reduce((n, a) => n + ((a.sessions && a.sessions.length) || 1), 0)) }], headers: ['اليوم', 'نوع اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الحالة'], rows: l.map(dayRow), onRow: (i) => dayDetails(l[i]), source: 'سجل الحضور' }; };
    const dHours = () => ({ title: 'ساعات الشهر — ' + m.name + ' · ' + K.hm(total), sub: 'الساعات = مجموع جلسات اليوم (الدوام مرن) · المطلوب ' + K.hm(need) + ' (8 ساعات × ' + workDays + ' يوم)', summary: [{ label: 'الإجمالي', value: K.hm(total) }, { label: 'المطلوب', value: K.hm(need) }, { label: 'الفرق', value: (total >= need ? '+' : '−') + K.hm(Math.abs(total - need)) }], headers: ['اليوم', 'نوع اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الحالة'], rows: work.map(dayRow), onRow: (i) => dayDetails(work[i]), source: 'سجل الحضور' });
    const otList = S.overtime.filter((o) => o.member === m.id && o.date.startsWith(mk));
    const dOt = () => ({ title: 'أوفر تايم — ' + m.name + ' · ' + K.hm(ot), sub: 'الوقت اللي اتأكد من المسؤول بس بيدخل المرتب · بنفس سعر الساعة', summary: [{ label: 'اتضاف', value: K.hm(ot) }, { label: 'القيمة', value: money(otPay) + ' ج.م' }, { label: 'مستني / اترفض', value: String(otList.filter((o) => o.status !== 'اتضاف').length) }], headers: ['الرقم', 'اليوم', 'من – لحد', 'المدة', 'السبب', 'أكّده'], rows: okOt.map((o) => [o.id, K.dayName(o.date) + ' ' + K.dshort(o.date), o.start + ' – ' + o.end, K.hm(o.paid), o.note, o.by || '—']), empty: 'مفيش وقت إضافي اتضاف الشهر ده.', source: 'الوقت الإضافي' });
    const dRest = () => { const l = S.restWork.filter((r) => r.member === m.id && r.date.startsWith(mk)); return { title: 'أيام راحة/عطلة اشتغلها — ' + m.name, sub: 'اليوم بيتحسب بيومين بعد تأكيد المسؤول', summary: [{ label: 'أيام', value: String(l.length) }, { label: 'القيمة', value: money(restPay) + ' ج.م' }], headers: ['اليوم', 'السبب'], rows: l.map((r) => [K.dayName(r.date) + ' ' + K.dshort(r.date), r.note]), empty: 'مشتغلش أيام راحة الشهر ده.', source: 'سجل الحضور' }; };
    const dSessions = () => { const l = work.filter((a) => a.sessions && a.sessions.length); const list = l.flatMap((a) => a.sessions.map((x, i) => [a, x, i])); return { title: 'جلسات الدوام — ' + m.name + ' · ' + monLabel(mk), sub: nSess + ' جلسة في ' + l.length + ' يوم · الدوام مرن: تبدأ وتنهي أكتر من مرة والساعات بتتجمع', summary: [{ label: 'جلسات', value: String(nSess) }, { label: 'أيام', value: String(l.length) }], headers: ['اليوم', 'الجلسة', 'من', 'لحد', 'المدة'], rows: list.map(([a, x, i]) => [K.dayName(a.date) + ' ' + K.dshort(a.date), String(i + 1), hhmm(x.in), x.out != null ? hhmm(x.out) : a.date === today() ? 'لسه شغال' : 'ناقص', x.out != null ? K.hm(Math.max(0, x.out - x.in)) : '—']), onRow: (i) => dayDetails(list[i][0]), empty: 'مفيش جلسات الشهر ده.', source: 'سجل الحضور' }; };
    const months = [0, 1, 2, 3].map((i) => addMonths(thisMonth(), -i));
    return [h('div', { class: 'toolbar' }, U.Select({ id: 'log-m', label: '', options: tm.map((x) => ({ value: x.id, label: 'العضو: ' + x.name })), value: m.id, onChange: (v) => { st.logMember = v; R(); } }), U.Select({ id: 'log-mo', label: '', options: months.map((k) => ({ value: k, label: 'الشهر: ' + monLabel(k) })), value: mk, onChange: (v) => { st.logMonth = v; R(); } }), h('span', { class: 'grow' }), K.Tag(S.hrSettings.countOT ? 'success' : 'neutral', 'احتساب الأوفر تايم: ' + (S.hrSettings.countOT ? 'مفعّل' : 'مقفول'))),
      h('div', { class: 'cards five' }, K.Stat('أيام الحضور', work.filter((a) => a.type === 'يوم عمل').length, 'من ' + workDays + ' يوم عمل', mk === thisMonth() ? 'لحد النهارده' : monLabel(mk), undefined, dDays), K.Stat('ساعات الشهر', K.hm(total), 'ساعة', 'المطلوب ' + K.hm(need), undefined, dHours), K.Stat('أوفر تايم', K.hm(ot), 'ساعة', can().salaries ? '= ' + K.money(otPay) + ' ج · كله اتأكد من المسؤول' : 'كله اتأكد من المسؤول', undefined, dOt), K.Stat('أيام راحة/عطلة اشتغلها', rest, 'يوم', rest && can().salaries ? '= ' + K.money(restPay) + ' ج (اليوم بيومين)' : rest ? 'اليوم بيومين' : '—', undefined, dRest), K.Stat('جلسات الدوام', nSess, 'جلسة', 'الدوام مرن — مفيش تأخير', undefined, dSessions)),
      K.Section('سجل الحضور — ' + m.name, rows.length ? U.Table({ headers: ['اليوم', 'التاريخ', 'نوع اليوم', 'الحضور', 'الانصراف', 'الساعات', 'أوفر تايم', 'الحالة', 'ملاحظة', ''], rows: rows.map((a) => { const hrs = hrsOf(a);
        return [K.dayName(a.date), K.dshort(a.date), a.type, K.Num(hhmm(a.in)), K.Num(hhmm(a.out)), hrs == null ? '—' : h('span', null, K.Num(K.hm(hrs)), a.date === today() && a.out == null ? ' (جاري)' : ''), (a.type === 'راحة أسبوعية' || a.type === 'عطلة رسمية') && a.in != null ? 'يوم × 2' : a.ot ? K.Num(K.hm(a.ot)) : '—', K.Tag(statusTone(a.status), a.status), h('span', { class: 't-small wrap' }, a.src),
          a.status === 'انصراف ناقص' && can().edit ? Button({ type: 'primary', size: 'sm', label: 'تصحيح', onClick: () => fixMissingOut(a) }) : a.in != null ? Button({ type: 'text', size: 'sm', label: 'تفاصيل', onClick: () => dayDetails(a) }) : '']; }),
        totalRow: ['الإجمالي', monShort(mk), workDays + ' يوم عمل', '—', '—', K.Num(K.hm(total)), K.hm(ot) + (rest ? ' + ' + rest + ' يوم' : ''), '—', can().salaries ? K.money(otPay) + (rest ? ' + ' + K.money(restPay) : '') + ' ج' : '—', ''] }) : K.Empty('مفيش أيام الشهر ده لسه', ''), null, { when: monLabel(mk) }),
      note('الدوام مرن: العضو بيبدأ وينهي أكتر من مرة في اليوم والساعات = مجموع الجلسات، ومفيش تأخير. يوم العمل = ساعات يوم العضو من الإعدادات؛ لما يخلصوا العضو بيختار «إنهاء الدوام» أو «لسه — وقت إضافي». الوقت الإضافي بيتضاف بنفس سعر الساعة بعد تأكيد المسؤول، والمرفوض بيفضل متسجل «وقت إضافي اترفض» + ميتنج. شغل الجمعة/السبت أو العطلة = اليوم بيومين بعد التأكيد.')];
  }
  const weekStart = () => H().addDays(today(), -isoDay(today()));
  function teamCal() {
    const start = st.calStart || weekStart(); const days = Array.from({ length: 14 }, (_, i) => H().addDays(start, i)); const hol = holidayDates();
    const DN = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
    const cell = (m, d) => { const off = offDay(d);
      const r = S.requests.find((x) => x.member === m.id && x.from <= d && x.to >= d && x.status !== 'مرفوض' && x.status !== 'اتلغى' && (isLeave(x) || x.type === 'شغل عن بُعد'));
      const att = S.attendance.find((a) => a.member === m.id && a.date === d);
      let tag = null;
      if (hol.includes(d)) tag = K.Tag('info', 'عطلة');
      else if (r) tag = isPending(r) ? K.Tag('neutral', 'معلّق') : r.type === 'شغل عن بُعد' ? K.Tag('info', 'عن بُعد') : K.Tag('gold', 'إجازة');
      else if (d === today() && S.today[m.id] && S.today[m.id].kind === 'absent') tag = K.Tag('error', 'غائب');
      else if (att && att.status === 'انصراف ناقص') tag = K.Tag('orange', 'ناقص');
      return h('div', { class: 'tc-cell' + (off ? ' off' : '') + (d === today() ? ' today' : ''), role: 'gridcell' }, tag); };
    const conflicts = S.requests.filter((r) => isPending(r) && isLeave(r)).map((r) => { const m = M(r.member); const same = team().filter((x) => x.dept === m.dept && x.id !== m.id);
      const absent = r.from === today() && S.today[m.id] && S.today[m.id].kind === 'absent';
      return K.dshort(r.from) + (r.to !== r.from ? ' – ' + K.dshort(r.to) : '') + ': ' + m.name + (absent ? ' غايب من غير تسجيل — عنده طلب ' + r.type + ' ' + r.status + '؛ لو اترفض اليوم بيتحسب غياب.' : ' — طلب ' + r.type + ' (معلّق)' + (same.length <= 1 ? ' — فريق ' + (m.dept || 'القسم') + ' هيبقى بعضو واحد بس. اعرف ده قبل الموافقة من صفحة الطلبات.' : '')); });
    const nav = (n) => { st.calStart = H().addDays(start, n * 7); R(); };
    return [h('div', { class: 'toolbar' }, U.Select({ id: 'cal-d', label: '', options: [{ value: '', label: 'القسم: الكل' }].concat(S.departments.map((d) => ({ value: d, label: 'القسم: ' + d }))), value: st.dept, onChange: (v) => { st.dept = v; R(); } }), h('span', { class: 't-small help' }, 'العرض: أسبوعين · الجمعة والسبت راحة أسبوعية'), h('span', { class: 'grow' }), Button({ size: 'sm', label: '‹ السابق', onClick: () => nav(-1) }), Button({ size: 'sm', label: 'النهارده', onClick: () => { st.calStart = ''; R(); } }), Button({ size: 'sm', label: 'التالي ›', onClick: () => nav(1) })),
      K.Section('تقويم الفريق', h('div', { class: 'scroll-x' }, h('div', { class: 'tcal2', role: 'grid', 'aria-label': 'تقويم الفريق — أسبوعين' }, h('div', { class: 'tc-row tc-head', role: 'row' }, h('span', null, 'العضو'), days.map((d) => h('span', { class: d === today() ? 'today' : '' }, h('small', null, d === today() ? 'النهارده' : DN[isoDay(d)]), h('b', { class: 'num' }, String(Number(d.slice(8))))))),
        team().filter((m) => !st.dept || m.dept === st.dept).map((m) => h('div', { class: 'tc-row', role: 'row' }, h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', null, m.dept))), days.map((d) => cell(m, d))))))),
      h('div', { class: 'legend t-small' }, h('b', null, 'المفتاح:'), K.Tag('gold', 'إجازة موافق عليها'), K.Tag('neutral', 'طلب معلّق'), K.Tag('info', 'عن بُعد'), K.Tag('info', 'عطلة رسمية'), K.Tag('orange', 'انصراف ناقص'), K.Tag('error', 'غائب'), h('span', null, '· الخلايا الرمادي = جمعة/سبت · العمود المحدد = النهارده')),
      K.Section('تعارضات محتملة', conflicts.length ? conflicts.map((c) => U.InlineNote({ kind: 'warning', children: c })) : K.Empty('مفيش تعارضات', ''), null, { sub: 'بتتحسب تلقائي لما حد يقدّم إجازة' })];
  }

  // ================= الطلبات (decision 1: the tab is gone — the requests live in «طلبات الفريق»; these helpers draw them) =================
  const reqTone = (s) => (s === 'جديد' ? 'orange' : s === 'قيد المراجعة' ? 'info' : s === 'موافق' ? 'success' : s === 'مرفوض' ? 'error' : 'neutral');
  function reqPeriod(r) {
    if (r.type === 'سُلفة') return (r.amount == null ? 'مبلغ مخفي' : K.money(r.amount) + ' ج') + (r.months > 1 ? ' · ' + r.months + ' أقساط' : ' · من مرتب الشهر');
    if (r.type === 'تصحيح انصراف') return K.dshort(r.from) + ' · انصراف ' + r.time;
    if (r.type === 'إذن انصراف مبكر') return K.dshort(r.from) + ' · ' + r.time;
    return r.to !== r.from ? K.dshort(r.from).split(' ')[0] + ' – ' + K.dshort(r.to) : K.dshort(r.from) + (r.type === 'شغل عن بُعد' ? ' (' + K.dayName(r.from) + ')' : '');
  }
  function reqDur(r) { if (r.type === 'سُلفة') return r.months > 1 ? r.months + ' شهور' : 'مرة واحدة'; if (r.type === 'إذن انصراف مبكر') return (r.hours || 2) === 2 ? 'ساعتين' : r.hours + ' ساعات'; if (r.type === 'تصحيح انصراف') return '—'; const n = r.type === 'شغل عن بُعد' ? 1 : daysOf(r); return n === 1 ? 'يوم' : n === 2 ? 'يومين' : n + ' أيام'; }
  function reqEffect(r) { const m = M(r.member); if (r.type === 'سُلفة') return r.amount == null ? '—' : r.months > 1 ? '− ' + K.n0(r.amount / r.months) + ' ج/شهر' : '− ' + K.n0(r.amount) + ' ج من مرتب الشهر'; if (r.type === 'تصحيح انصراف') return 'يقفل يوم ناقص'; if (r.type === 'إجازة مرضية') return 'بتقرير طبي'; const lt = S.leaveTypes.find((t) => t.name === r.type); if (lt && lt.unpaid) return 'بدون أجر — ' + daysOf(r) + ' يوم من المرتب'; if (isLeave(r) && isPending(r) && lt && lt.deducts) return 'الرصيد ' + leaveLeft(m) + ' ← ' + (leaveLeft(m) - daysOf(r)); return '—'; }
  async function decide(r, s, reason) { const res = await after(H().decide(r.id, s, reason), s === 'موافق' ? 'اتوافق على ' + r.id : s === 'مرفوض' ? 'اترفض ' + r.id : 'اتحوّل للمراجعة'); return res; }
  const otValue = (o, minutes) => (o.kind === 'rest_day' ? O.overtimePay(M(o.member).salary || 0, { offDays: 1 }, rateOf(M(o.member))) : O.reviewOvertime({ minutes: o.minutes, salary: M(o.member).salary || 0 }, { decision: 'add', minutes: minutes == null ? o.minutes : minutes }).pay);
  // ================= المرتبات (the HR rebuild, 0083 — decisions 7 and 8) =================
  // the month in one table: each member's monthly salary, the bonus (the quarter's last month), the overtime, the extras, the cuts and
  // advances, the net; «تحويل المرتبات» pays everyone not paid yet in one step; ⋮ per member: the salary alone (early = a reason), an
  // advance (all of it off this month), the overtime fixed, a bonus / a cut, the payslip. The money is sensitive.salaries' (the admin).
  const cutsOf = (p) => p.ded + p.advance + p.unpaidCut; const otOf = (p) => p.otPay + p.restPay; const extraOf = (p) => p.allow + p.leavePay;
  function payrollTab() {
    if (!can().salaries) return [K.Section('المرتبات', K.Empty('المرتبات للأدمن بس', 'كل عضو بيشوف قسيمته في «ملفي».'))];
    const mk = st.sheetMonth || thisMonth(); const sh = S.sheets[mk] || null; const done = !!sh && sh.status === 'مدفوع';
    const months = [...new Set([0, 1, 2].map((i) => addMonths(thisMonth(), -i)).concat(Object.keys(S.sheets)))].filter((k) => k <= thisMonth()).sort().reverse();
    const pick = U.Select({ id: 'sh-m', label: '', options: months.map((k) => ({ value: k, label: 'الشهر: ' + monLabel(k) })), value: mk, onChange: (v) => { st.sheetMonth = v; R(); } });
    const L = linesOf(mk); const lines = L.lines; const T = H().sheetTotals(lines); const payDay = H().payDayOf(mk);
    const status = (p) => (p.transfer ? K.Tag('success', 'اتحوّل' + (p.transfer.early ? ' (مبكر)' : '')) : done ? K.Tag('success', 'اتحوّل') : K.Tag('neutral', 'لسه'));
    const menu = (p) => { const open = !p.transfer && !done; return K.RowMenu([open ? { label: 'تحويل المرتب', icon: 'send', run: () => payOne(p, mk) } : null, { label: 'تحويل سلفة', icon: 'briefcase', run: () => giveAdvance(M(p.member)) },
      open ? { label: 'تصحيح الأوفر تايم', icon: 'clock', run: () => fixOt(p, mk) } : null, open ? { label: 'مكافأة / خصم', icon: 'plus', run: () => addAdjustment(mk, p.member) } : null,
      { label: 'القسيمة', icon: 'file', run: () => payslipModal(p, mk) }].filter(Boolean), 'إجراءات ' + p.name); };
    const cards = h('div', { class: 'cards', 'data-hr-pay-cards': '' }, K.Stat(done ? 'اتحوّل' : 'هيتحوّل', K.money(done ? T.net : T.toTransfer), 'ج.م', done ? 'من ' + ((sh && sh.paidAccount) || '—') : T.left + ' من ' + T.members + ' عضو لسه'),
      K.Stat('المرتبات', K.money(T.salaries), 'ج.م', 'المصروف كل شهر'), K.Stat('الأوفر تايم', K.money(T.overtime), 'ج.م', 'المتأكد + أيام الراحة ×2'), K.Stat('الخصومات والسُلف', K.money(T.cuts), 'ج.م', 'بتتخصم من الصافي'));
    const transferBtn = Button({ type: 'primary', label: done ? 'المرتبات اتحوّلت' : 'تحويل المرتبات', icon: 'send', disabled: done || L.status !== 'ok' || !T.left, attrs: { 'data-hr-transfer': '' }, onClick: () => transferAll(mk, lines) });
    const table = lines.length ? U.Table({ cls: 'hr-pay', headers: ['العضو', 'المرتب', 'البونص', 'الأوفر تايم', 'إضافات', 'خصومات وسُلف', 'الصافي', 'التحويل', ''],
      rows: lines.map((p) => [mcell(p.member), K.Num(K.money(p.paid)), p.quarterBonus ? K.Num(K.money(p.quarterBonus)) : '—', otOf(p) ? K.Num(K.money(otOf(p))) : '—', extraOf(p) ? K.Num(K.money(extraOf(p))) : '—',
        cutsOf(p) ? K.Num('− ' + K.money(cutsOf(p))) : '—', h('b', null, K.Num(K.money(p.net))), status(p), menu(p)]),
      totalRow: ['الإجمالي', K.Num(K.money(T.salaries)), K.Num(K.money(T.bonus)), K.Num(K.money(T.overtime)), K.Num(K.money(T.extras)), K.Num('− ' + K.money(T.cuts)), h('b', null, K.Num(K.money(T.net))), '', ''] })
      : L.status === 'loading' ? K.Empty('بيتحسب…', 'لحظة واحدة') : K.Empty('مفيش أعضاء بمرتب', 'المرتب بيتسجل من «إضافة عضو» أو ملف العضو.');
    return [h('div', { class: 'toolbar' }, pick, h('span', { class: 't-small help' }, 'يوم الصرف ' + K.dshort(payDay)), h('span', { class: 'grow' }), Button({ label: 'مكافأة / خصم', icon: 'plus', disabled: done, onClick: () => addAdjustment(mk) }), transferBtn),
      cards, K.Section('مرتبات ' + monLabel(mk), [L.status === 'error' ? U.InlineNote({ kind: 'error', children: 'تعذّر حساب المرتبات — جرّب تاني.' }) : null, table,
        note('الصافي = المرتب الشهري (من غير البونص المحجوز) + الأوفر تايم المتأكد + أيام الراحة ×2 + الإضافات − الخصومات والسُلف وأيام الإجازة بدون أجر. البونص بيتصرف مع آخر شهر في الربع: محجوز كل شهر تقييمه ' + (S.hrSettings.bonusMin || 3) + ' من 5 أو أكتر كامل، والشهر اللي تقييمه أقل أو ماتقيّمش = صفر. السُلفة بتتخصم كلها من مرتب الشهر. ' + (mk.slice(5) === '12' && S.hrSettings.leaveYearEnd !== 'carry' ? 'ديسمبر: رصيد الإجازات الباقي بيتصرف مع المرتب (في «إضافات»).' : ''))], null, { when: monLabel(mk), noun: ['عضو', 'الأعضاء'], total: done ? 'اتحوّلت' : T.paidAlready ? 'اتحوّل لـ ' + (T.members - T.left) + ' بدري' : '' })];
  }
  // the month's lines (live from the server until paid; a member paid already keeps the line they were paid on) — fetched once per state
  function linesOf(mk) {
    const sh = S.sheets[mk]; const paid = S.paid[mk] || {};
    const key = mk + '|' + (sh ? sh.status : '-') + '|' + Object.keys(paid).sort().join(',') + '|' + (H().state() === 'ready' ? S.requests.length + ':' + S.overtime.length + ':' + S.adjustments.length + ':' + S.otAdjust.length + ':' + Object.keys(S.evals).length : '');
    const c = st.lines[mk];
    if (c && c.key === key) return c;
    st.lines[mk] = { key, status: 'loading', lines: c ? c.lines : [] };
    H().sheetLines(mk).then((r) => { st.lines[mk] = { key, status: r.ok ? 'ok' : 'error', lines: r.ok ? r.lines : [] }; if (window.IBPages.current === 'hr') R(); });
    return st.lines[mk];
  }
  const slipFor = (lines, m) => lines.find((l) => l.member === m.id) || null;
  const accountField = (f, e, set) => K.field.select('account', 'هيتحوّل من حساب', H().ACCOUNTS, f, e, set, { required: true });
  // «تحويل المرتبات»: the table of who is paid now, the totals under it and the account — the popup is the confirmation
  function transferAll(mk, lines) {
    const left = lines.filter((p) => !p.transfer); const T = H().sheetTotals(lines); const early = today() < H().payDayOf(mk);
    const sum = (label, v, strong) => h('div', { class: 'slip-row' + (strong ? ' total' : '') }, h('span', null, label), h('b', { class: 'num' }, v));
    K.form({ title: 'تحويل المرتبات — ' + monLabel(mk), values: { account: H().ACCOUNTS[0] }, wide: true,
      note: early ? U.InlineNote({ kind: 'warning', children: 'النهارده قبل يوم الصرف (' + K.dshort(H().payDayOf(mk)) + ').' }) : null,
      fields: (f, e, set) => [U.Table({ cls: 'hr-transfer', headers: ['العضو', 'المرتب', 'البونص', 'الأوفر تايم', 'إضافات', 'خصومات وسُلف', 'الصافي'],
        rows: left.map((p) => [p.name, K.Num(K.money(p.paid)), p.quarterBonus ? K.Num(K.money(p.quarterBonus)) : '—', otOf(p) ? K.Num(K.money(otOf(p))) : '—', extraOf(p) ? K.Num(K.money(extraOf(p))) : '—', cutsOf(p) ? K.Num('− ' + K.money(cutsOf(p))) : '—', h('b', null, K.Num(K.money(Math.max(0, p.net))))]) }),
        h('div', { class: 'slip hr-transfer-sum', 'data-hr-transfer-sum': '' }, sum('إجمالي المرتبات', K.money(left.reduce((n, p) => n + p.paid, 0))), sum('إجمالي البونص', K.money(left.reduce((n, p) => n + p.quarterBonus, 0))),
          sum('إجمالي الأوفر تايم', K.money(left.reduce((n, p) => n + otOf(p), 0))), sum('إجمالي الإضافات', K.money(left.reduce((n, p) => n + extraOf(p), 0))), sum('إجمالي الخصومات والسُلف', '− ' + K.money(left.reduce((n, p) => n + cutsOf(p), 0))),
          T.paidAlready ? sum('اتحوّل قبل كده (' + (T.members - T.left) + ')', K.money(T.paidAlready)) : null, sum('الإجمالي اللي هيتحوّل', K.money(T.toTransfer) + ' ج.م', true)),
        accountField(f, e, set), note('هيتسجل مصروف «المرتبات» لكل عضو بصافيه في الحسابات، وسحب واحد بالإجمالي من الحساب ده. وبعدها المرتبات بتتقفل والقسايم بتظهر في «ملفي».')],
      validate: (f) => K.req(f, ['account']), submitLabel: 'حوّل ' + K.money(T.toTransfer) + ' ج.م',
      submit: (f, md) => busy(md, () => H().transfer(mk, f.account), (r) => K.toast('اتحوّلت المرتبات: ' + K.money(r.total) + ' ج من ' + f.account, 'success')) });
  }
  // «تحويل المرتب» for one member: before the pay day it is early — its reason is a must
  function payOne(p, mk) {
    const early = today() < H().payDayOf(mk);
    K.form({ title: 'تحويل مرتب ' + p.name + ' — ' + monLabel(mk), values: { account: H().ACCOUNTS[0] }, note: U.InlineNote({ children: 'الصافي ' + K.money(Math.max(0, p.net)) + ' ج.م' + (early ? ' — قبل يوم الصرف (' + K.dshort(H().payDayOf(mk)) + ')' : '') }),
      fields: (f, e, set) => [early ? K.field.area('reason', 'سبب التحويل المبكر', f, e, set, { required: true }) : null, accountField(f, e, set)],
      validate: (f) => K.req(f, ['account'].concat(early ? ['reason'] : []), { reason: 'اكتب سبب التحويل المبكر' }), submitLabel: 'حوّل المرتب',
      submit: (f, md) => busy(md, () => H().payMember(mk, p.member, f.account, f.reason || ''), (r) => K.toast('اتحوّل مرتب ' + p.name + ': ' + K.money(r.net) + ' ج', 'success')) });
  }
  // «تحويل سلفة»: the money out now, all of it off this month's salary
  function giveAdvance(m) {
    K.form({ title: 'تحويل سلفة — ' + m.name, values: { account: H().ACCOUNTS[0] }, note: U.InlineNote({ children: 'السلفة بتتخصم كلها من مرتب الشهر ده' + (m.salary ? ' (المرتب ' + K.money(m.salary) + ' ج)' : '') + '.' }),
      fields: (f, e, set) => [K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), K.field.area('reason', 'سبب السلفة', f, e, set, { required: true }), accountField(f, e, set)],
      validate: (f) => { const e = K.req(f, ['amount', 'reason', 'account']); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ صحيح'; else if (m.salary && Number(f.amount) > m.salary) e.amount = 'السلفة متزيدش عن مرتب شهر (' + K.money(m.salary) + ')'; return e; },
      submitLabel: 'حوّل السلفة', submit: (f, md) => busy(md, () => H().advanceGive(m.id, Number(f.amount), f.reason, f.account), (r) => K.toast('اتحوّلت السلفة ' + r.id, 'success')) });
  }
  // «تصحيح الأوفر تايم»: minutes more (recorded short) or less (recorded by mistake), with the reason — it counts in the month's line
  function fixOt(p, mk) {
    K.form({ title: 'تصحيح الأوفر تايم — ' + p.name, values: { dir: 'add', hours: '', minutes: '' }, note: U.InlineNote({ children: 'الأوفر تايم المحسوب في ' + monLabel(mk) + ': ' + K.hm(p.otMin) + (p.otPay ? ' = ' + K.money(p.otPay) + ' ج' : '') }),
      fields: (f, e, set) => [K.Radios({ label: 'التصحيح', value: f.dir, onChange: (v) => set('dir', v, true), options: [{ value: 'add', label: 'زوّد (اتسجل ناقص)' }, { value: 'sub', label: 'قلّل (اتسجل غلط)' }] }),
        K.two(K.field.text('hours', 'ساعات', f, e, set, { inputmode: 'numeric', suffix: 'ساعة' }), K.field.text('minutes', 'دقايق', f, e, set, { inputmode: 'numeric', suffix: 'دقيقة' })), K.field.area('reason', 'السبب', f, e, set, { required: true })],
      validate: (f) => { const e = K.req(f, ['reason']); const n = (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0); if (!(n > 0) || n > 6000) e.minutes = 'اكتب المدة (لحد 100 ساعة)'; else if (f.dir === 'sub' && n > p.otMin) e.minutes = 'أكتر من الأوفر تايم المحسوب (' + K.hm(p.otMin) + ')'; return e; },
      submitLabel: 'سجّل التصحيح', submit: (f, md) => busy(md, () => H().otAdjust(p.member, mk, (f.dir === 'sub' ? -1 : 1) * ((Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0)), f.reason), () => K.toast('اتسجل التصحيح', 'success')) });
  }
  function addAdjustment(mk, member, preset) { // preset (decision 13): «أضف مكافأة» from the evaluation ⋮ comes with its line's label
    K.form({ title: 'مكافأة / خصم — ' + monLabel(mk), values: { kind: 'بدل', member: member || '', label: (preset && preset.label) || '' }, fields: (f, e, set) => [member ? null : K.field.select('member', 'العضو', members(), f, e, set, { required: true }), K.Radios({ label: 'النوع', value: f.kind, onChange: (v) => set('kind', v, true), options: [{ value: 'بدل', label: 'مكافأة / إضافة' }, { value: 'خصم', label: 'خصم' }] }), K.two(K.field.text('label', 'البند', f, e, set, { required: true, placeholder: f.kind === 'خصم' ? 'مثلاً: غياب' : 'مثلاً: بدل انتقالات' }), K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }))],
      validate: (f) => { const e = K.req(f, ['member', 'label', 'amount']); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ أكبر من صفر'; return e; }, submitLabel: 'إضافة',
      submit: (f, m) => busy(m, H().addAdjustment({ member: f.member, month: mk, label: f.label, amount: (f.kind === 'خصم' ? -1 : 1) * Number(f.amount) }), () => K.toast('اتضاف البند', 'success')) });
  }
  function payslipModal(p, mk, status) { // status: «ملفي» passes it (a member does not read the months' states)
    const m = M(p.member); const r = O.rates(p.salary); const adj = S.adjustments.filter((a) => a.member === p.member && a.month === mk);
    const st0 = status ? 'حالة الكشف: ' + status : p.transfer || (S.sheets[mk] || {}).status === 'مدفوع' ? 'اتحوّل' : 'لسه ما اتحوّلش';
    const line = (k, v, neg) => h('div', { class: 'slip-row' }, h('span', null, k), h('b', { class: 'num' + (neg ? ' neg' : '') }, (neg && v ? '−' : '') + K.money(v)));
    const plus = adj.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0);
    const md = U.Modal({ title: 'قسيمة مرتب ' + monLabel(mk), share: true, body: [h('div', { class: 'slip' }, h('div', { class: 'slip-h' }, window.IBLogo.Logo({ tone: 'color', width: 120 }), h('div', null, h('b', null, p.name), h('div', { class: 't-small' }, (m.title || '') + (m.dept ? ' · ' + m.dept : '')))),
      line('المرتب', p.salary), p.holdback ? line('البونص المحجوز (بيتصرف آخر الربع)', p.holdback, true) : null, p.otPay ? line('أوفر تايم ' + K.hm(p.otMin), p.otPay) : null, p.restPay ? line('أيام راحة ×2 (' + p.rest + ')', p.restPay) : null,
      p.allow - plus > 0 ? line('البدلات', p.allow - plus) : null, ...adj.filter((a) => a.amount > 0).map((a) => line(a.label, a.amount)), p.leavePay ? line('رصيد الإجازات (' + p.leaveDays + ' يوم)', p.leavePay) : null,
      ...adj.filter((a) => a.amount < 0).map((a) => line(a.label, -a.amount, true)), p.advance ? line('سُلفة', p.advance, true) : null, p.unpaidCut ? line('إجازة بدون أجر (' + p.unpaidDays + ' يوم)', p.unpaidCut, true) : null, p.quarterBonus ? line('البونص (الربع)', p.quarterBonus) : null,
      h('div', { class: 'slip-row total' }, h('span', null, 'الصافي'), h('b', { class: 'num' }, K.money(p.net) + ' ج.م')), h('div', { class: 't-small help' }, 'سعر اليوم ' + K.money(r.daily) + ' · سعر الساعة ' + K.money(r.hourly) + ' · ' + st0))],
      footer: [Button({ label: 'إغلاق', onClick: () => md.close() })] });
  }

  // ================= التقييمات (decision 2: out of 5 — the attendance automatic, the performance and the communication by the manager) =================
  const evalTone = (v) => (v == null ? 'neutral' : v >= 4 ? 'success' : v >= 3 ? 'info' : 'error');
  const score = (v) => (v == null ? '—' : K.Num(String(v).replace(/\.0$/, '') + ' / 5'));
  const scoreTag = (v) => (v == null ? K.Tag('neutral', 'لسه') : K.Tag(evalTone(v), String(v).replace(/\.0$/, '') + ' / 5'));
  const mineCode = () => (window.IBDirectory.me() || {}).member_code;
  // who rates: the admin, hr.edit F, or the member's direct manager — never their own month (the server decides again)
  const canRate = (m) => can().admin || (m.id !== mineCode() && (can().edit || m.manager === mineCode()));
  function evalsTab() {
    const sub = st.evalSub === 'quarter' ? 'quarter' : 'month'; const tm = team(); const bar = Number(S.hrSettings.bonusMin) || 3;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth(), -i));
    const quarters = [...new Set(months.map(qOf))];
    const mk = st.evalMonth && months.includes(st.evalMonth) ? st.evalMonth : thisMonth(); const q = st.evalQuarter && quarters.includes(st.evalQuarter) ? st.evalQuarter : qOf(thisMonth());
    const tabs0 = K.SubTabs({ items: [{ id: 'month', label: 'التقييم الشهري' }, { id: 'quarter', label: 'التقييم الربع سنوي' }], active: sub, onChange: (id) => { st.evalSub = id; R(); }, label: 'التقييمات' });
    const pick = sub === 'month' ? U.Select({ id: 'ev-m', label: '', options: months.map((k) => ({ value: k, label: 'الشهر: ' + monLabel(k) })), value: mk, onChange: (v) => { st.evalMonth = v; R(); } })
      : U.Select({ id: 'ev-q', label: '', options: quarters.map((x) => ({ value: x, label: qLabel(x) })), value: q, onChange: (v) => { st.evalQuarter = v; R(); } });
    if (!tm.length) return [h('div', { class: 'toolbar' }, tabs0), K.Empty('لسه مفيش أعضاء', '')];
    if (sub === 'month') {
      const ev = (m) => (S.evals[m.id] || {})[mk] || {};
      const rated = tm.filter((m) => ev(m).total != null);
      const rows = tm.map((m) => { const x = ev(m); return [mcell(m.id), score(x.att), score(x.perf), score(x.comm), scoreTag(x.total), can().salaries ? (x.total == null ? '—' : x.total >= bar ? K.Tag('success', 'هيتصرف') : K.Tag('error', 'مش هيتصرف')) : null, x.by ? h('span', { class: 't-small' }, x.by) : '—',
        h('span', { class: 'row-acts' }, canRate(m) ? Button({ size: 'sm', type: x.total == null ? 'primary' : 'text', label: x.total == null ? 'قيّم' : 'عدّل', attrs: { 'data-hr-rate': m.id }, onClick: () => rateMember(m, mk) }) : null, evalMenu(m, mk, x.total, monLabel(mk)))].filter((c) => c !== null); });
      return [h('div', { class: 'toolbar' }, tabs0, pick),
        h('div', { class: 'cards', 'data-hr-eval-cards': '' }, K.Stat('اتقيّموا', rated.length, 'من ' + tm.length, monLabel(mk)), K.Stat('متوسط الفريق', rated.length ? String(Math.round(rated.reduce((n, m) => n + ev(m).total, 0) / rated.length * 10) / 10) : '—', 'من 5', 'تقييم الشهر'), K.Stat('فوق حد البونص', rated.filter((m) => ev(m).total >= bar).length, 'عضو', 'التقييم ' + bar + ' من 5 أو أكتر')),
        K.Section('التقييم الشهري — ' + monLabel(mk), [U.Table({ cls: 'hr-evals', headers: ['العضو', 'الحضور', 'الأداء', 'التواصل', 'تقييم الشهر'].concat(can().salaries ? ['البونص'] : [], ['قيّمه', '']), rows }),
          note('الحضور تلقائي من أيام الحضور على أيام الشغل (من غير الإجازات المتوافق عليها والعطلات). الأداء من المدير المباشر حسب المهام اللي خلصت واللي لأ، والتواصل حسب تعامله مع الفريق والعملاء والمبتكرين. تقييم الشهر = متوسط التلاتة.')], null, { when: monLabel(mk) })];
    }
    const rows = tm.map((m) => { const x = H().quarterEval(m.id, q) || {}; return [mcell(m.id), score(x.att), score(x.perf), score(x.comm), scoreTag(x.total), K.Num((x.rated || 0) + ' / 3'), evalMenu(m, q, x.total, qLabel(q))]; });
    return [h('div', { class: 'toolbar' }, tabs0, pick),
      K.Section('التقييم الربع سنوي — ' + qLabel(q), [U.Table({ cls: 'hr-evals-q', headers: ['العضو', 'الحضور', 'الأداء', 'التواصل', 'التقييم الربع سنوي', 'شهور اتقيّمت', ''], rows }),
        note('التقييم الربع سنوي تلقائي = متوسط تقييمات شهوره اللي اتقيّمت.')], null, { when: qLabel(q) })];
  }
  // owner batch 14 Nov decision 13 (0089): ⋮ on a month / quarter row — under the bonus bar: «حدد ميتنج» (a team request to the member
  // with the time + the bell) · «ابعت إنذار» · «خطة تحسين»; 4 or more: «ابعت شكر» · «أضف مكافأة» (the payroll popup, sensitive.salaries);
  // «الملاحظات» lists what was sent for that period. Who: canRate (the server decides again — hr_member_note_add).
  const NOTE_TITLE = { meeting: 'حدد ميتنج', warning: 'ابعت إنذار', plan: 'خطة تحسين', thanks: 'ابعت شكر' };
  const NOTE_TONE = { meeting: 'info', warning: 'error', plan: 'orange', thanks: 'success' };
  const HALF = Array.from({ length: 31 }, (_, i) => String(7 + Math.floor(i / 2)).padStart(2, '0') + (i % 2 ? ':30' : ':00')); // 07:00 … 22:00
  function evalMenu(m, period, total, label) {
    const bar = Number(S.hrSettings.bonusMin) || 3; const rate = canRate(m) && total != null;
    const items = [];
    if (rate && total < bar) items.push({ label: 'حدد ميتنج', icon: 'calendar', run: () => noteForm(m, 'meeting', period, label) }, { label: 'ابعت إنذار', icon: 'alert', run: () => noteForm(m, 'warning', period, label) }, { label: 'خطة تحسين', icon: 'checkCircle', run: () => noteForm(m, 'plan', period, label) });
    if (rate && total >= 4) items.push({ label: 'ابعت شكر', icon: 'star', run: () => noteForm(m, 'thanks', period, label) }, can().salaries ? { label: 'أضف مكافأة', icon: 'plus', run: () => addAdjustment(thisMonth(), m.id, { label: 'مكافأة تقييم ' + label }) } : null);
    const n = H().notesOf ? H().notesOf(m.id, period).length : 0; if (n) items.push({ label: 'اللي اتبعت (' + n + ')', icon: 'activity', run: () => notesView(m, period, label) });
    const list = items.filter(Boolean); return list.length ? K.RowMenu(list, 'إجراءات تقييم ' + m.name) : '';
  }
  function noteForm(m, kind, period, label) {
    const t = today(); // the server keeps a meeting within 90 days
    K.form({ title: NOTE_TITLE[kind] + ' — ' + m.name, values: { day: kind === 'meeting' ? t : '', time: '11:00', body: kind === 'thanks' ? 'شكرًا على شغلك في ' + label + ' — تقييمك عالي، كمّل كده 👏' : '' },
      note: h('p', { class: 't-small help', style: 'margin:0' }, 'عن تقييم ' + label + '. ' + (kind === 'meeting' ? 'هيوصله طلب في «طلبات الفريق» بالميعاد بس (من غير التقييم) وتنبيه في الجرس؛ النقاط اللي هتتكلموا فيها بتفضل في الموارد البشرية.' : 'هيوصله تنبيه في الجرس وهيلاقيه في «ملفي › أدائي».')),
      fields: (f, e, set) => [kind === 'meeting' ? K.two(K.field.date('day', 'اليوم', f, e, set, { required: true }), U.Select({ id: 'time', label: 'الساعة', value: f.time, options: HALF.map((x) => ({ value: x, label: x })), onChange: (v) => set('time', v, true) })) : null,
        kind === 'plan' ? K.field.date('day', 'ميعاد المراجعة', f, e, set, { help: 'اختياري — إمتى تراجعوا الخطة' }) : null,
        K.field.area('body', kind === 'meeting' ? 'هتتكلموا في إيه' : kind === 'warning' ? 'سبب الإنذار' : kind === 'plan' ? 'أهداف الخطة' : 'رسالة الشكر', f, e, set,
          { required: kind === 'warning' || kind === 'plan', placeholder: kind === 'plan' ? 'مثلاً: الرد على كل الرسايل في نفس اليوم · ولا أوردر متأخر الشهر الجاي' : kind === 'meeting' ? 'اختياري' : '' })],
      validate: (f) => { const e = {}; if (kind === 'meeting' && (!f.day || f.day < t)) e.day = 'اختار يوم من النهارده أو بعده'; if (kind === 'plan' && f.day && f.day < t) e.day = 'اختار يوم من النهارده أو بعده';
        if ((kind === 'warning' || kind === 'plan') && !String(f.body || '').trim()) e.body = kind === 'warning' ? 'اكتب سبب الإنذار' : 'اكتب أهداف الخطة'; if (String(f.body || '').length > 1000) e.body = 'لحد 1000 حرف'; return e; },
      submitLabel: kind === 'meeting' ? 'حدد الميتنج' : kind === 'warning' ? 'ابعت الإنذار' : kind === 'plan' ? 'احفظ الخطة' : 'ابعت الشكر',
      submit: (f, md) => busy(md, () => H().noteAdd(m.id, kind, period, f.body, (kind === 'meeting' || kind === 'plan') && f.day ? { day: f.day, time: kind === 'meeting' ? f.time : '10:00' } : null),
        (r) => K.toast(kind === 'meeting' ? 'اتحدد الميتنج' + (r.ticket ? ' — TKT-' + String(r.ticket).padStart(4, '0') : '') : kind === 'warning' ? 'اتبعت الإنذار' : kind === 'plan' ? 'اتحفظت خطة التحسين' : 'اتبعت الشكر', 'success')) });
  }
  function notesView(m, period, label) {
    const list = H().notesOf(m.id, period);
    const when = (x) => { if (!x) return '—'; try { return K.dshort(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x))); } catch (e) { return String(x).slice(0, 10); } };
    const md = U.Modal({ title: 'اللي اتبعت لـ ' + m.name + ' — ' + label,
      body: h('div', { class: 'stack', 'data-hr-notes': '' }, list.map((x) => h('div', { class: 'note-row' }, h('div', { class: 'row-acts' }, K.Tag(NOTE_TONE[x.kind] || 'neutral', (H().NOTE_KINDS || {})[x.kind] || x.kind), h('span', { class: 't-small help' }, when(x.at) + (x.by ? ' · ' + x.by : '') + (x.due ? ' · ' + (x.kind === 'meeting' ? 'الميعاد ' : 'المراجعة ') + when(x.due) : ''))),
        x.body ? h('p', { class: 't-small wrap', style: 'margin:4px 0 0' }, x.body) : null))),
      footer: [Button({ label: 'إغلاق', onClick: () => md.close() })] });
  }
  // «قيّم»: the attendance (automatic), the month's tasks for the evaluator, then the performance and the communication out of 5
  function rateMember(m, mk) {
    const x = (S.evals[m.id] || {})[mk] || {}; const tasks = H().monthTasks(m.id, mk);
    const list = (title, l) => h('div', { class: 'ev-tasks' }, h('b', { class: 't-small' }, title + ' (' + l.length + ')'), l.length ? h('ul', { class: 't-small' }, l.slice(0, 6).map((t) => h('li', null, t.title))) : h('span', { class: 't-small help' }, '—'));
    K.form({ title: 'تقييم ' + m.name + ' — ' + monLabel(mk), values: { perf: x.perf || 0, comm: x.comm || 0, note: x.note || '' },
      note: h('div', { class: 'ev-head' }, K.Kv([['الحضور (تلقائي)', x.att == null ? 'مفيش أيام شغل الشهر ده' : x.att + ' من 5']]), h('div', { class: 'ev-task-cols', 'data-hr-rate-tasks': '' }, list('مهام خلصت', tasks.done), list('مهام لسه مفتوحة', tasks.open))),
      fields: (f, e, set) => [K.StarPicker({ id: 'ev-perf', label: 'الأداء — حسب المهام', value: f.perf, onChange: (v) => set('perf', v, true), error: e.perf, required: true }),
        K.StarPicker({ id: 'ev-comm', label: 'التواصل — مع الفريق والعملاء والمبتكرين', value: f.comm, onChange: (v) => set('comm', v, true), error: e.comm, required: true }),
        f.perf && f.comm ? U.InlineNote({ kind: 'success', children: 'تقييم الشهر: ' + H().evalTotal(x.att == null ? null : x.att, f.perf, f.comm) + ' من 5' }) : null, K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const e = {}; if (!(f.perf >= 1)) e.perf = 'اختار تقييم الأداء'; if (!(f.comm >= 1)) e.comm = 'اختار تقييم التواصل'; return e; }, submitLabel: 'حفظ التقييم',
      submit: (f, md) => busy(md, () => H().evaluate(m.id, mk, f.perf, f.comm, f.note), (r) => K.toast('اتحفظ التقييم: ' + r.total + ' من 5', 'success')) });
  }

  // ================= popups =================
  const members = () => team().map((m) => ({ value: m.id, label: m.name }));
  const ROLES = [['عمليات', 'ops'], ['خدمة العملاء', 'cs'], ['حسابات', 'accounts'], ['متابعة المبتكرين', 'vendors_followup'], ['مشاهد', 'viewer'], ['مدير النظام (أدمن)', 'admin']]; // decision 15: an admin is added here too
  const plus8 = (t) => String(Math.min(23, Number(String(t).slice(0, 2)) + 8)).padStart(2, '0') + String(t).slice(2, 5);
  function addMember(prefill) { // prefill: the values of a submit the server refused — the form comes back filled (decision 13)
    const mgrs = [{ value: '', label: 'من غير' }].concat(H().data.team.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.name })));
    K.form({ title: 'إضافة عضو', wide: true, values: Object.assign({ shiftStart: '09:00', holdback: String(S.hrSettings.holdbackDefault || 0), role: 'خدمة العملاء', manager: (window.IBDirectory.me() || {}).member_code || '', dept: S.departments[0] || '', allow: '0', leave: '21' }, prefill || {}),
      fields: (f, e, set) => [K.two(K.field.text('name', 'الاسم بالكامل', f, e, set, { required: true }), K.field.text('title', 'الوظيفة', f, e, set, { required: true })),
        K.two(K.field.text('email', 'الإيميل', f, e, set, { required: true, placeholder: 'name@ibtekr.club' }), K.field.text('phone', 'الموبايل', f, e, set, { inputmode: 'tel', placeholder: '01xxxxxxxxx' })),
        K.two(K.field.select('dept', 'القسم', S.departments.length ? S.departments : ['العمليات'], f, e, set, { required: true }), K.field.select('role', 'الدور (الصلاحيات)', ROLES.map((r) => r[0]), f, e, set, { required: true })),
        K.two(K.field.select('manager', 'المدير المباشر', mgrs, f, e, set), K.field.date('hire', 'تاريخ التعيين', f, e, set, { required: true, help: 'أول ' + S.hrSettings.probation + ' شهور فترة اختبار (من غير حافز ربع)' })),
        K.two(K.field.text('salary', 'المرتب الشهري', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), K.field.text('holdback', 'الحافز المحجوز شهريًا', f, e, set, { inputmode: 'decimal', suffix: 'ج.م', help: 'بيتصرف مع الشهر التالت حسب الـ KPI' })),
        K.field.text('allow', 'البدلات الشهرية', f, e, set, { inputmode: 'decimal', suffix: 'ج.م', help: 'وقت العمل = ساعات العمل الرسمية أو وقت قسمه — وقت مخصص له من «الإعدادات › الموارد البشرية › أوقات عمل مخصصة»' }),
        K.field.text('leave', 'رصيد الإجازات السنوي', f, e, set, { inputmode: 'numeric', suffix: 'يوم' }),
        f.salary && Number(f.salary) > 0 ? U.InlineNote({ children: 'سعر اليوم ' + K.money(O.rates(Number(f.salary)).daily) + ' ج · سعر الساعة ' + K.money(O.rates(Number(f.salary)).hourly) + ' ج · المصروف شهريًا ' + K.money(O.monthlyPaid(Number(f.salary), Number(f.holdback) || 0)) + ' ج' }) : null,
        note('هيتعمل له حساب دخول بالإيميل، وهيوصله إيميل بلينك يعمل منه الباسورد بتاعه (لو Resend متظبط في الإعدادات › الربط والمفاتيح). لو الإيميل مش متظبط هيظهر لك باسورد مؤقت مرة واحدة تبعته له بنفسك.')],
      validate: (f) => { const e = K.req(f, ['name', 'title', 'email', 'salary', 'hire']); if (f.email && O.identifierKind(f.email) !== 'email') e.email = 'اكتب إيميل صحيح'; else if (H().data.team.some((m) => (m.email || '').toLowerCase() === String(f.email).trim().toLowerCase())) e.email = 'الإيميل ده موجود بالفعل'; if (f.phone && O.identifierKind(f.phone) !== 'phone') e.phone = 'اكتب رقم موبايل مصري صحيح (11 رقم)'; if (f.salary && !(Number(f.salary) > 0)) e.salary = 'اكتب مبلغ أكبر من صفر'; else if (Number(f.holdback) >= Number(f.salary)) e.holdback = 'الحافز المحجوز لازم أقل من المرتب'; if (f.leave !== '' && !(Number(f.leave) >= 0 && Number(f.leave) <= 365)) e.leave = 'من 0 لـ 365'; return e; },
      // phase 13 decision 13 (the owner): the popup closes the moment «إضافة وعمل الحساب» is pressed; the password modal follows when the
      // server answers, and a refusal brings the form back filled with the same values + the reason
      submitLabel: 'إضافة وعمل الحساب', submit: (f, m) => { m.close(); K.toast('بيتعمل الحساب…');
        H().memberCreate({ name: f.name.trim(), title: f.title, email: f.email.trim(), phone: f.phone ? O.toLatin(f.phone) : '', dept: f.dept, role: (ROLES.find((r) => r[0] === f.role) || ROLES[1])[1], manager: f.manager, hire: f.hire, shiftStart: f.shiftStart, shiftEnd: plus8(f.shiftStart), salary: Number(f.salary), holdback: Number(f.holdback) || 0, allow: Number(f.allow) || 0, leave: f.leave })
          .then((r) => { if (r && r.ok) { const warn = r.payOk === false ? 'الحساب اتعمل بس المرتب ماتسجلش — سجّله من ملف العضو.' : ''; if (r.mailed) showMailed(f.name.trim(), r.code, r.email || f.email.trim(), warn); else showPassword(f.name.trim(), r.code, r.password, warn); } else { K.toast((r && r.message) || 'حصلت مشكلة — جرّب تاني', 'error'); addMember(f); } });
        return false; } });
  }
  // the temporary password, once (decision 6): never stored, never logged — the modal is its only place
  function showPassword(name, code, password, warn) {
    const md = U.Modal({ title: 'الباسورد المؤقت — ' + name, body: [U.InlineNote({ kind: 'warning', children: 'الباسورد ده بيظهر مرة واحدة بس ومش متخزن في أي مكان. ابعته لـ ' + name + ' بنفسك، وهو هيغيّره من «ملفي › بيانات الحساب».' }), warn ? U.InlineNote({ kind: 'error', children: warn }) : null,
      K.Kv([['العضو', name + (code ? ' (' + code + ')' : '')], ['الباسورد المؤقت', h('code', { class: 'num', 'data-temp-password': '', dir: 'ltr' }, password)]])],
      footer: [Button({ label: 'نسخ الباسورد', icon: 'copy', onClick: () => { try { navigator.clipboard.writeText(password).then(() => K.toast('اتنسخ', 'success'), () => K.toast('انسخه بالإيد', 'error')); } catch (e) { K.toast('انسخه بالإيد', 'error'); } } }), Button({ type: 'primary', label: 'تمام', onClick: () => md.close() })] });
  }
  // decision 14: the set-your-password mail went — nothing to copy; the link is single use and times out, «ابعت الإيميل تاني» from the row menu
  function showMailed(name, code, email, warn) {
    const md = U.Modal({ title: 'اتبعت الإيميل — ' + name, body: [U.InlineNote({ kind: 'success', children: 'وصله إيميل على ' + email + ' فيه لينك يعمل منه الباسورد بتاعه، وبعدها بيدخل بإيميله. اللينك بيشتغل مرة واحدة ولمدة محدودة — لو خلص أو الإيميل ماوصلش، من قايمة العضو «ابعت إيميل الباسورد تاني» أو «باسورد مؤقت جديد».' }), warn ? U.InlineNote({ kind: 'error', children: warn }) : null,
      K.Kv([['العضو', name + (code ? ' (' + code + ')' : '')], ['الإيميل', h('span', { dir: 'ltr', 'data-mailed-to': '' }, email)]])],
      footer: [Button({ type: 'primary', label: 'تمام', onClick: () => md.close() })] });
  }
  function resendInvite(m) {
    K.confirm({ title: 'ابعت إيميل الباسورد تاني — ' + m.name, text: 'هيوصله إيميل جديد بلينك يعمل منه الباسورد (اللينك القديم بيبطل).', okLabel: 'ابعت', onOk: () => H().memberInvite(m.id).then((r) => { if (r.ok) K.toast('اتبعت الإيميل لـ ' + m.name, 'success'); else K.toast(r.message || 'حصلت مشكلة', 'error'); }) });
  }
  // decision 15: for good — only a member who left no trace (never signed in, wrote nothing); the server refuses the rest with the table
  function deleteMember(m) {
    K.confirm({ title: 'حذف ' + m.name + ' نهائي؟', text: 'الحساب والملف وبياناته في الموارد البشرية هيتمسحوا خالص ومافيش رجوع. بينفع بس لعضو ماعملش أي حاجة في السيستم (ماسجّلش دخول، ماكتبش حاجة، ماعندوش حضور ولا طلبات ولا مستندات) — غير كده السيستم هيرفض وتقدر توقفه بدل ما تمسحه.', okLabel: 'احذف نهائي', okType: 'danger',
      onOk: () => H().memberDelete(m.id).then((r) => { if (r.ok) { K.toast('اتحذف ' + m.name + ' نهائي', 'success'); R(); } else K.toast(r.message || 'حصلت مشكلة', 'error'); }) });
  }
  function newPassword(m) {
    K.confirm({ title: 'باسورد مؤقت جديد — ' + m.name, text: 'الباسورد القديم هيبطل، والجديد هيظهر لك مرة واحدة بس.', okLabel: 'اعمل باسورد جديد', onOk: () => H().memberPassword(m.id).then((r) => { if (r.ok) showPassword(m.name, m.id, r.password); else K.toast(r.message || 'حصلت مشكلة', 'error'); }) });
  }
  function manualAtt(m) {
    K.form({ title: 'تسجيل حضور يدوي', values: { member: m ? m.id : '', date: today(), in: m ? m.shift[0] : '09:00', out: '' },
      fields: (f, e, set) => [K.field.select('member', 'العضو', members(), f, e, set, { required: true }), K.field.date('date', 'اليوم', f, e, set, { required: true }), K.two(K.field.text('in', 'وقت الحضور', f, e, set, { required: true, placeholder: '09:00' }), K.field.text('out', 'وقت الانصراف', f, e, set, { placeholder: 'سيبه فاضي لو لسه على الدوام' })), K.field.area('reason', 'السبب', f, e, set, { required: true, placeholder: 'مثلاً: نسي يسجل من الموبايل' })],
      validate: (f) => { const e = K.req(f, ['member', 'date', 'in', 'reason']); const re = /^\d{1,2}:\d{2}$/; if (f.in && !re.test(f.in)) e.in = 'اكتب الوقت كده 09:00'; if (f.out && !re.test(f.out)) e.out = 'اكتب الوقت كده 17:00'; if (f.date && f.date > today()) e.date = 'مينفعش يوم لسه مجاش'; return e; },
      submitLabel: 'تسجيل', submit: (f, md) => busy(md, H().setAttendance(f.member, f.date, f.in.padStart(5, '0'), f.out ? f.out.padStart(5, '0') : null, { note: f.reason }), () => K.toast('اتسجل الحضور' + (offDay(f.date) || holidayDates().includes(f.date) ? ' — يوم راحة: مستني تأكيد المسؤول عشان يتحسب بيومين' : ''), 'success')) });
  }
  function endShiftFor(m) {
    const worked = todayMin(m) || 0; // decision 24: the day so far; only the open session ends
    K.confirm({ title: 'إنهاء الدوام', text: 'هينتهي دوام ' + m.name + ' دلوقتي (' + hhmm(nowMin()) + ') — اشتغل ' + K.hrs(Math.max(0, worked)) + '.', okLabel: 'إنهاء الدوام', onOk: () => after(H().endShiftFor(m.id), 'انتهى دوام ' + m.name) });
  }
  function fixMissingOut(a) {
    const m = M(a.member); const req = S.requests.find((x) => x.type === 'تصحيح انصراف' && x.member === a.member && x.from === a.date && isPending(x));
    K.form({ title: 'تصحيح انصراف ناقص', values: { out: req ? req.time : '17:00' }, note: U.InlineNote({ kind: 'warning', children: m.name + ' سجّل حضور ' + hhmm(a.openIn != null ? a.openIn : a.in) + ' يوم ' + K.dshort(a.date) + ' ومسجلش انصراف.' + (req ? ' فيه طلب تصحيح ' + req.id + ' بانصراف ' + req.time + ' — هيتوافق عليه.' : '') }),
      fields: (f, e, set) => [K.field.text('out', 'وقت الانصراف الفعلي', f, e, set, { required: true }), K.field.area('reason', 'السبب', f, e, set, { required: true })],
      validate: (f) => { const e = K.req(f, ['out', 'reason']); if (f.out && !/^\d{1,2}:\d{2}$/.test(f.out)) e.out = 'اكتب الوقت كده 17:15'; return e; },
      submitLabel: 'حفظ التصحيح', submit: (f, md) => busy(md, H().fixOut(a, f.out.padStart(5, '0'), f.reason, req ? req.dbId : null), () => K.toast('اتصحح الانصراف', 'success')) });
  }
  function dayDetails(a) {
    const m = M(a.member); const rest = a.type === 'راحة أسبوعية' || a.type === 'عطلة رسمية';
    U.Modal({ title: 'تفاصيل يوم — ' + m.name, share: true, body: [K.Kv([['اليوم', K.dayName(a.date) + ' ' + K.dlabel(a.date) + ' · ' + a.type], ['الدوام', m.shift.join(' – ')], ['الحضور', hhmm(a.in)], ['الانصراف', hhmm(a.out)], ['الساعات', a.in != null ? K.hm(Number(a.mins) || 0) + (a.out == null ? ' (لحد آخر جلسة مقفولة)' : '') : '—'],
      ['الجلسات', a.sessions && a.sessions.length ? a.sessions.map((x) => hhmm(x.in) + '–' + (x.out != null ? hhmm(x.out) : '…')).join(' · ') : '—'], ['وقت إضافي', rest && a.in != null ? 'يوم × 2' + (can().salaries ? ' = ' + K.money(O.overtimePay(m.salary || 0, { offDays: 1 })) + ' ج' : '') + ' بعد التأكيد' : a.ot ? K.hrs(a.ot) + (can().salaries ? ' = ' + K.money(O.overtimePay(m.salary || 0, { hours: a.ot / 60 })) + ' ج' : '') : '—'], ['الحالة', a.status], ['ملاحظة', a.src]])] });
  }
  function uploadContract(m) {
    K.form({ title: 'رفع مستند — ' + m.name, values: { type: 'عقد عمل' }, fields: (f, e, set) => [K.field.select('type', 'نوع المستند', H().DOC_KINDS, f, e, set, { required: true }), fileField('hrfile', 'الملف', f, e, set, { required: true }), K.two(K.field.date('start', 'بداية العقد', f, e, set), K.field.date('end', 'نهاية العقد', f, e, set, { help: 'هيبان «بيخلص قريب» قبلها بـ 30 يوم' }))],
      validate: (f) => { const e = K.req(f, ['type', 'hrfile'], { hrfile: 'اختار الملف' }); const bad = picked.hrfile ? H().checkFile(picked.hrfile) : null; if (bad === 'type') e.hrfile = 'صورة (PNG / JPG / WebP) أو PDF بس'; if (bad === 'size') e.hrfile = 'الملف أكبر من 10 ميجا'; if (f.start && f.end && f.end < f.start) e.end = 'النهاية بعد البداية'; return e; },
      submitLabel: 'رفع', submit: (f, md) => busy(md, H().upload(picked.hrfile, m.id).then((u) => (u.ok ? H().addDocument(m.id, { kind: f.type, path: u.path, name: u.name, start: f.start, end: f.end }) : u)), () => K.toast('اترفع ' + f.type, 'success')) });
  }
  // phase 13 decision 36: pre = the AI assistant's values (the member reviews and submits the form — it is the confirmation)
  const preOf = (pre, keys) => { const o = {}; if (pre && typeof pre === 'object') keys.forEach((k) => { if (pre[k] != null && String(pre[k]).trim()) o[k] = String(pre[k]).trim().slice(0, 300); }); return o; };
  function leaveRequest(m, pre) {
    const me = (window.IBDirectory.me() || {}).member_code;
    const others = can().edit; const who = others ? members() : members().filter((x) => x.value === me);
    const p = preOf(pre, ['kind', 'from', 'to', 'note']); if (p.kind && !S.leaveTypes.some((x) => x.name === p.kind)) delete p.kind;
    K.form({ title: 'طلب إجازة', values: Object.assign({ member: m ? m.id : me || (who[0] || {}).value, kind: (S.leaveTypes[0] || {}).name || 'إجازة سنوية' }, p),
      fields: (f, e, set) => { const mm = M(f.member); const days = f.from && f.to && f.to >= f.from ? H().leaveDays(f.from, f.to, holidayDates()) : null; const lt = S.leaveTypes.find((x) => x.name === f.kind) || {}; const needDoc = !!lt.doc && !['', '—', '-'].includes(String(lt.doc).trim());
        return [who.length > 1 ? K.field.select('member', 'العضو', who, f, e, set, { required: true }) : null, K.field.select('kind', 'نوع الإجازة', S.leaveTypes.map((x) => x.name), f, e, set, { required: true }), K.two(K.field.date('from', 'من', f, e, set, { required: true }), K.field.date('to', 'لحد', f, e, set, { required: true })),
          days != null ? U.InlineNote({ kind: days > leaveLeft(mm) && lt.deducts ? 'warning' : '', children: 'عدد الأيام: ' + days + ' يوم شغل (من غير الجمعة والسبت والعطلات)' + (lt.deducts ? ' · الرصيد ' + leaveLeft(mm) + ' ← ' + (leaveLeft(mm) - days) : lt.unpaid ? ' · بدون أجر: اليوم بيتخصم من المرتب (÷ 24)' : '') }) : null,
          K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' }), needDoc ? fileField('leavedoc', lt.doc, f, e, set, { required: true }) : null]; },
      validate: (f) => { const e = K.req(f, ['member', 'kind', 'from', 'to']); const lt = S.leaveTypes.find((x) => x.name === f.kind) || {}; const needDoc = !!lt.doc && !['', '—', '-'].includes(String(lt.doc).trim());
        if (f.from && f.to && f.to < f.from) e.to = 'تاريخ النهاية لازم بعد البداية'; if (needDoc && !f.leavedoc) e.leavedoc = 'ارفع ' + lt.doc; if (needDoc && picked.leavedoc && H().checkFile(picked.leavedoc)) e.leavedoc = 'صورة أو PDF لحد 10 ميجا'; if (!Object.keys(e).length && H().leaveDays(f.from, f.to, holidayDates()) === 0) e.to = 'الفترة دي كلها إجازات أصلاً'; return e; },
      submitLabel: 'تقديم الطلب', submit: (f, md) => { const lt = S.leaveTypes.find((x) => x.name === f.kind) || {}; const needDoc = !!lt.doc && !['', '—', '-'].includes(String(lt.doc).trim());
        const send = (doc) => H().request({ member: f.member, type: f.kind, from: f.from, to: f.to, note: f.note || '', doc });
        return busy(md, needDoc ? H().upload(picked.leavedoc, f.member).then((u) => (u.ok ? send(u.path) : u)) : send(null), (r) => K.toast(filedMsg(r), 'success')); } });
  }
  function advanceRequest(m, pre) { // m: «ملفي» of another member (hr.edit F files for them)
    const me = (window.IBDirectory.me() || {}).member_code; const who = can().edit ? members() : members().filter((x) => x.value === me);
    // decision 4 (0083): the advance comes off the salary of the month it is approved in — all of it, no installments
    K.form({ title: 'طلب سُلفة', values: Object.assign({ member: (m && who.some((x) => x.value === m.id) ? m.id : null) || me || (who[0] || {}).value }, preOf(pre, ['amount', 'note'])), fields: (f, e, set) => [who.length > 1 ? K.field.select('member', 'العضو', who, f, e, set, { required: true }) : null, K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }),
      Number(f.amount) > 0 ? U.InlineNote({ children: 'لو اتوافق عليها بتتخصم كلها (' + K.money(Number(f.amount)) + ' ج) من مرتب الشهر' }) : null, K.field.area('note', 'السبب', f, e, set)],
      validate: (f) => { const e = K.req(f, ['member', 'amount']); const m = M(f.member); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ صحيح'; else if (m.salary && Number(f.amount) > m.salary) e.amount = 'السُلفة متزيدش عن مرتب شهر (' + K.money(m.salary) + ')'; return e; },
      submitLabel: 'تقديم الطلب', submit: (f, md) => busy(md, H().request({ member: f.member, type: 'سُلفة', amount: Number(f.amount), months: 1, note: f.note || '' }), (r) => K.toast(filedMsg(r), 'success')) });
  }
  // phase 13 decision 33 (0071): every request opens its team ticket — the toast says which
  const filedMsg = (r) => 'اتقدم الطلب ' + r.id + (r.ticket ? ' — في «تذاكر الفريق» ' + r.ticket : '');
  function remoteRequest(m, pre) { // «شغل عن بُعد» (from the tickets page, decision 33)
    const me = (window.IBDirectory.me() || {}).member_code; const who = can().edit ? members() : members().filter((x) => x.value === me);
    K.form({ title: 'طلب شغل عن بُعد', values: Object.assign({ member: (m && who.some((x) => x.value === m.id) ? m.id : null) || me || (who[0] || {}).value, from: today(), to: today() }, preOf(pre, ['from', 'to', 'note'])),
      fields: (f, e, set) => [who.length > 1 ? K.field.select('member', 'العضو', who, f, e, set, { required: true }) : null, K.two(K.field.date('from', 'من', f, e, set, { required: true }), K.field.date('to', 'لحد', f, e, set, { required: true })), K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const e = K.req(f, ['member', 'from', 'to']); if (f.from && f.to && f.to < f.from) e.to = 'تاريخ النهاية لازم بعد البداية'; return e; },
      submitLabel: 'تقديم الطلب', submit: (f, md) => busy(md, H().request({ member: f.member, type: 'شغل عن بُعد', from: f.from, to: f.to, note: f.note || '' }), (r) => K.toast(filedMsg(r), 'success')) });
  }
  function cancelReq(r) { K.confirm({ title: 'إلغاء الطلب ' + r.id + '؟', text: r.type + ' — ' + reqPeriod(r), okType: 'danger', okLabel: 'إلغاء الطلب', onOk: () => after(H().cancel(r.id), 'اتلغى الطلب') }); }
  function rejectReq(r) {
    K.form({ title: 'رفض طلب ' + r.id, values: {}, fields: (f, e, set) => [K.field.select('reason', 'سبب الرفض', ['ضغط شغل في الفترة دي', 'الرصيد مش كفاية', 'فريق القسم هيبقى ناقص', 'في سُلفة لسه شغالة', 'أخرى'], f, e, set, { required: true }), f.reason === 'أخرى' ? K.field.area('other', 'اكتب السبب', f, e, set, { required: true }) : null, isLeave(r) && r.from === today() ? U.InlineNote({ kind: 'warning', children: 'لو اترفض، النهارده بيتحسب غياب.' }) : null, note('العضو بيشوف السبب في «ملفي › طلباتي».')],
      validate: (f) => { const e = K.req(f, ['reason'], { reason: 'اختار سبب الرفض' }); if (f.reason === 'أخرى' && !String(f.other || '').trim()) e.other = 'اكتب السبب'; return e; }, submitType: 'danger', submitLabel: 'رفض الطلب', submit: (f, md) => busy(md, H().decide(r.id, 'مرفوض', f.reason === 'أخرى' ? f.other : f.reason), () => K.toast('اترفض ' + r.id)) });
  }
  function reqDetails(r) {
    const m = M(r.member);
    const overlap = isLeave(r) ? S.requests.filter((x) => x !== r && isLeave(x) && x.status !== 'مرفوض' && x.status !== 'اتلغى' && x.from <= r.to && x.to >= r.from).map((x) => M(x.member).name) : [];
    const mine = r.member === (window.IBDirectory.me() || {}).member_code;
    const docBtn = r.doc ? Button({ type: 'text', size: 'sm', label: 'افتح المرفق', icon: 'external', onClick: () => H().fileUrl(r.doc).then((u) => { if (u) window.open(u, '_blank', 'noopener'); else K.toast('تعذّر فتح المرفق', 'error'); }) }) : null;
    const m2 = U.Modal({ title: 'تفاصيل طلب ' + r.id, share: true, body: [K.Kv([['العضو', m.name + (m.title ? ' — ' + m.title : '')], ['النوع', r.type], ['الفترة / التفاصيل', reqPeriod(r)], ['المدة', reqDur(r)], ['التأثير', reqEffect(r)], ['ملاحظة العضو', r.note || '—'], ['قُدّم', r.at], ['الحالة', K.Tag(reqTone(r.status), r.status)], r.by ? ['بواسطة', r.by] : null, r.reason ? ['السبب', r.reason] : null, r.doc ? ['المرفق', docBtn] : null].filter(Boolean)),
      isLeave(r) ? U.InlineNote({ children: 'في نفس الفترة: ' + (overlap.join('، ') || 'محدش في إجازة') }) : null],
      footer: isPending(r) && !mine ? [Button({ label: 'رفض', onClick: () => { m2.close(); rejectReq(r); } }), Button({ type: 'primary', label: 'موافقة', onClick: () => { m2.close(); decide(r, 'موافق'); } })] : [Button({ label: 'إغلاق', onClick: () => m2.close() })] });
  }
  // an overtime waiting (from «نظرة عامة»): the details and «ضيفه» / «متضيفهوش» for who decides it (the request ticket has the same card)
  function otDetails(o) {
    const m = M(o.member); const mine = o.member === mineCode(); const decides = !mine && o.status === 'مستني' && (!H() || H().decidesOt(o));
    const md = U.Modal({ title: (o.kind === 'rest_day' ? 'شغل يوم راحة — ' : 'وقت إضافي — ') + m.name, body: [K.Kv([['الرقم', o.id], ['اليوم', K.dlabel(o.date)], ['من – لحد', o.start + ' – ' + o.end], ['المدة', o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(o.minutes)], ['اشتغل على إيه', o.note || '—'], ['الحالة', K.Tag(o.status === 'مستني' ? 'orange' : o.status === 'اتضاف' ? 'success' : 'error', o.status)], o.ticket ? ['الطلب', o.ticket] : null].filter(Boolean)),
      !decides && o.status === 'مستني' && o.kind === 'rest_day' && !mine ? U.InlineNote({ children: 'يوم الراحة/العطلة بيوافق عليه الأدمن.' }) : null],
      footer: decides ? [Button({ label: 'متضيفهوش', onClick: () => { md.close(); otReject(o); } }), Button({ type: 'primary', label: 'ضيفه', onClick: () => { md.close(); otAdd(o); } })] : [Button({ label: 'إغلاق', onClick: () => md.close() })] });
  }
  function otAdd(o) {
    const m = M(o.member); const rest = o.kind === 'rest_day';
    K.form({ title: (rest ? 'ضيف يوم الراحة — ' : 'ضيف الوقت الإضافي — ') + m.name, values: { how: 'all', minutes: String(o.minutes) }, note: U.InlineNote({ children: K.dlabel(o.date) + ' · ' + o.start + ' – ' + o.end + ' (' + K.hrs(o.minutes) + ') — «' + o.note + '»' }),
      fields: (f, e, set) => [rest ? U.InlineNote({ children: 'شغل يوم راحة/عطلة بيتحسب يوم كامل × 2.' }) : K.Radios({ label: 'هتضيف قد إيه', value: f.how, onChange: (v) => set('how', v, true), options: [{ value: 'all', label: 'كله (' + K.hrs(o.minutes) + ')' }, { value: 'part', label: 'جزء منه' }] }), !rest && f.how === 'part' ? K.field.text('minutes', 'عدد الدقايق', f, e, set, { required: true, inputmode: 'numeric', suffix: 'دقيقة' }) : null,
        can().salaries ? U.InlineNote({ kind: 'success', children: 'هيدخل الكشف: ' + K.money(otValue(o, f.how === 'all' ? o.minutes : Math.min(o.minutes, Number(f.minutes) || 0))) + ' ج' + (rest ? '' : ' (بنفس سعر الساعة ' + K.money(O.rates(m.salary || 0).hourly) + ' ج)') }) : null],
      validate: (f) => { if (!rest && f.how === 'part') { const n = Number(f.minutes); if (!(n > 0) || n > o.minutes) return { minutes: 'من 1 لحد ' + o.minutes + ' دقيقة' }; } return {}; },
      submitLabel: 'ضيفه', submit: (f, md) => busy(md, H().overtimeDecide(o.id, 'add', rest || f.how === 'all' ? null : Number(f.minutes)), () => K.toast('اتضاف للكشف', 'success')) });
  }
  function otReject(o) {
    const m = M(o.member);
    K.form({ title: 'متضيفهوش — ' + m.name, values: { date: H().addDays(today(), 1), time: '10:00', place: 'المكتب' }, note: U.InlineNote({ kind: 'warning', children: 'الوقت هيفضل متسجل «وقت إضافي اترفض» ومش هيدخل الكشف، ولازم ميتنج فردي نعرف كان بيشتغل على إيه.' }),
      fields: (f, e, set) => [K.field.area('why', 'ليه مش هيتضاف', f, e, set, { required: true }), can().edit ? K.two(K.field.date('date', 'ميعاد الميتنج', f, e, set, { required: true }), K.field.select('time', 'الساعة', ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'], f, e, set, { required: true })) : null, can().edit ? K.field.select('place', 'المكان', ['المكتب', 'أونلاين'], f, e, set) : null],
      validate: (f) => K.req(f, ['why'].concat(can().edit ? ['date', 'time'] : [])), submitType: 'danger', submitLabel: can().edit ? 'متضيفهوش وحدد الميتنج' : 'متضيفهوش',
      submit: (f, md) => busy(md, H().overtimeDecide(o.id, 'reject', null, f.why).then((r) => { if (!r.ok || !can().edit) return r; const mt = S.meetings.find((x) => x.ref === 'OT-' + o.dbId && x.dbStatus === 'مطلوب'); /* the server's ref: OT-<id>, not padded */ return mt ? H().meetingUpdate(mt.id, { status: 'اتحدد ميعاد', date: f.date, time: f.time, place: f.place }).then(() => r) : r; }), () => K.toast('اترفض واتعمل ميتنج فردي')) });
  }
  // the old KPI / extras / meetings popups and the settings lists went with the rebuild (0083 — decision 1)

  // the HR rows changed (a write, the live line, a reload): draw again when the page is open
  document.addEventListener('ib:hr', () => { if (window.IBPages.current === 'hr') R(); });
  // the old prototype's api for the blocks not on IBHR yet (the profile — T7; the bell / dashboard read these helpers)
  const slipOf = (m) => { const L = st.lines[thisMonth()]; const p = L && L.lines ? slipFor(L.lines, m) : null; return p || O.payslip({ salary: m.salary || 0, holdback: m.holdback || 0, bonus: m.allow || 0 }); };
  window.IBPages.register('hr', { title: 'الموارد البشرية', hash: (hs) => { const m = /^hr(?:-(overview|team|requests|payroll|evals|log|reports|settings))?$/.exec(hs); if (!m) return false; if (m[1] === 'settings') { setTimeout(() => { location.hash = 'settings-hr'; }, 0); return true; } st.tab = !m[1] || m[1] === 'requests' ? 'overview' : m[1]; return true; }, defaultHash: () => 'hr-' + st.tab, view,
    api: { addMember, decide: (r, s, reason) => decide(r, s, reason), rejectReq, reqDetails, otAdd, otReject, leaveRequest, advanceRequest, remoteRequest, newPassword, slipModal: (p, mk, status) => payslipModal(p, mk, status), payslipModal: (m) => { const L = linesOf(thisMonth()); const p = slipFor(L.lines, m); if (p) payslipModal(p, thisMonth()); else K.toast('القسيمة لسه بتتحسب — جرّب كمان شوية'); }, slipOf, manualAtt, uploadContract, status, pendingCount, isPending, reqPeriod, qScore: (id) => qScore(id), cancelReq, present } });
})();
