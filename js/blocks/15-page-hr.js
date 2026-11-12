
/* HR page «الموارد البشرية» — the prototype of 2 Nov 18:12 (v5 block 15) on IBHR (phase 10 T5, docs/superpowers/plans/2026-11-05-phase-10-hr.md).
   Tabs: الفريق والحضور · الطلبات · المرتبات والمكافآت · التقارير · إعدادات الموارد البشرية. Rules in IbtekrOps (block 12) and on the server
   (0046); every write goes through IBHR (app/js/adapter/hr.js) and the page draws again on «ib:hr». The demo's fixed dates became today's
   (Cairo), this month and the quarter picked; the money columns need sensitive.salaries, the actions hr.edit / hr.approve (the server decides). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U;
  const H = () => window.IBHR;
  const S = (window.IBHR && window.IBHR.data) || K.store; // IBHR.data is one object for the session; its rows change with each load
  // the owner 12 Nov — «نضيف تاب نظرة عامة ونضيف تاب سجل الحركات»: «نظرة عامة» first (the day's cards, the month, who is in, what waits,
  // the leaves coming) and «سجل الحركات» (the HR rows of the activity log) before the reports — the log for hr.view F
  const TABS_ALL = [{ id: 'overview', label: 'نظرة عامة' }, { id: 'team', label: 'الفريق والحضور' }, { id: 'requests', label: 'الطلبات' }, { id: 'payroll', label: 'المرتبات والمكافآت' }, { id: 'log', label: 'سجل الحركات' }, { id: 'reports', label: 'التقارير' }, { id: 'settings', label: 'إعدادات الموارد البشرية' }];
  const tabs = () => TABS_ALL.filter((t) => t.id !== 'log' || can().view === 'F' || can().admin);
  const TABS = TABS_ALL;
  const st = { tab: 'overview', teamSub: 'team', paySub: 'sheet', reqSub: 'all', q: '', dept: '', logMember: '', logMonth: '', kpiMember: '', calStart: '', quarter: '', sheetMonth: '', lines: {} };
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
  const tone = (r) => O.RATING_TONE[r];
  const short = (r) => (r === 'محتاج تحسين' ? 'تحسين' : r);
  const pendingCount = () => S.requests.filter(isPending).length + S.overtime.filter((o) => o.status === 'مستني').length;
  const mcell = (id) => { const m = M(id); return h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), h('small', null, m.title))); };
  const note = (t) => h('p', { class: 't-small help', style: 'margin:0' }, t);
  const toMember = (list) => (i) => { const x = list[i]; if (x) location.hash = 'member-' + (x.member || x.id); };
  const money = (n) => (can().salaries ? K.money(n) : '••••');
  const monLabel = (key) => K.AR_MON[Number(String(key).slice(5, 7)) - 1] + ' ' + String(key).slice(0, 4);
  const monShort = (key) => K.AR_MON[Number(String(key).slice(5, 7)) - 1];
  const addMonths = (key, n) => { const d = new Date(key + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  const isoDay = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const offDay = (d) => isoDay(d) === 5 || isoDay(d) === 6;
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
  const qMonths = (q) => { const y = q.slice(0, 4); const n = Number(q.slice(-1)); return [1, 2, 3].map((i) => y + '-' + String((n - 1) * 3 + i).padStart(2, '0')); };
  const QN = ['الأول', 'التاني', 'التالت', 'الرابع'];
  const qLabel = (q) => 'الربع ' + QN[Number(q.slice(-1)) - 1] + ' ' + q.slice(0, 4);
  const curQ = () => st.quarter || qOf(thisMonth());
  const scoreAt = (id, k) => (S.scores[id] || {})[k];
  const scoresOf = (id, q) => qMonths(q).map((k) => scoreAt(id, k)).filter((x) => x != null);
  const qScore = (id, q = curQ()) => { const l = scoresOf(id, q); return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length * 10) / 10 : null; };
  const qRating = (id, q = curQ()) => { const l = scoresOf(id, q); if (!l.length) return 'لسه'; return O.quarterBad(l) ? 'سيئ — ميتنج' : O.rating(qScore(id, q)); };
  const pct = (v) => (v == null ? '—' : v + '%');

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
    if (nowMin() - t.in >= 480) return ['وقت إضافي', 'orange'];
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
    return [K.PageHead('الموارد البشرية', 'الفريق · الحضور والانصراف · الطلبات · المرتبات والمكافآت', [st.tab === 'reports' ? null : K.PanelButton('hr:' + st.tab, 'الموارد البشرية — ' + (TABS.find((t) => t.id === st.tab) || {}).label, () => document.querySelector('#pg-hr .panel'), R), c.edit ? Button({ label: 'تسجيل حضور يدوي', icon: 'clock', onClick: () => manualAtt() }) : null, c.admin ? Button({ type: 'brand', label: 'إضافة عضو', icon: 'plus', onClick: () => addMember() }) : null]),
      H().state() === 'error' ? U.InlineNote({ kind: 'error', children: 'تعذّر تحميل بيانات الموارد البشرية — جرّب تاني بعد شوية.' }) : null,
      K.MainTabs({ items: tabs().map((t) => (t.id === 'requests' ? Object.assign({}, t, { label: t.label + ' (' + pendingCount() + ')' }) : t)), active: st.tab, onChange: (id) => { st.tab = id; try { history.replaceState(null, '', '#hr-' + id); } catch (e) { /* */ } R(); }, label: 'أقسام الموارد البشرية' }),
      pnl(...(st.tab === 'overview' ? overviewTab() : st.tab === 'team' ? teamTab() : st.tab === 'requests' ? requestsTab() : st.tab === 'payroll' ? payrollTab() : st.tab === 'log' ? logTab() : st.tab === 'reports' ? reportsTab() : settingsTab()))];
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
    const dPending = () => { const rq = S.requests.filter(isPending), ot = S.overtime.filter((o) => o.status === 'مستني'); return { title: 'طلبات مستنية — ' + (rq.length + ot.length), sub: 'محتاجة موافقة أو تأكيد من المسؤول', summary: [{ label: 'طلبات', value: String(rq.length) }, { label: 'وقت إضافي للتأكيد', value: String(ot.length) }], headers: ['الرقم', 'العضو', 'النوع', 'الفترة / التفاصيل', 'الحالة'], rows: rq.map((r) => [r.id, M(r.member).name, r.type, reqPeriod(r), r.status]).concat(ot.map((o) => [o.id, M(o.member).name, o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي', K.dshort(o.date) + ' · ' + o.start + '–' + o.end + ' (' + K.hm(o.minutes) + ')', o.status + ' · ' + o.waitedHours + ' ساعة'])), onRow: (i) => { if (i < rq.length) reqDetails(rq[i]); else { st.tab = 'requests'; try { history.replaceState(null, '', '#hr-requests'); } catch (e) { /* */ } R(); } }, source: 'الطلبات + الوقت الإضافي' }; };
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
    const tm = team(); const t0 = today(); const mk = thisMonth(); const in14 = H().addDays(t0, 14); const goTab = (id) => { st.tab = id; try { history.replaceState(null, '', '#hr-' + id); } catch (e) { /* */ } R(); };
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
    const waitCard = K.Section('مستني قرار (' + (S.requests.filter(isPending).length + S.overtime.filter((o) => o.status === 'مستني').length) + ')', (pend.length || otp.length) ? clickRows(U.Table({ headers: ['الرقم', 'العضو', 'النوع', 'التفاصيل', 'الحالة'], rows: pend.map((r) => [r.id, M(r.member).name, r.type, reqPeriod(r), K.Tag('orange', r.status)]).concat(otp.map((o) => [o.id, M(o.member).name, o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي', K.dshort(o.date) + ' · ' + K.hm(o.minutes), K.Tag('orange', o.status)])) }), (i) => { if (i < pend.length) reqDetails(pend[i]); else goTab('requests'); }) : K.Empty('مفيش حاجة مستنية', 'الطلبات والوقت الإضافي اللي محتاجين موافقة بيظهروا هنا.'), [Button({ size: 'sm', label: 'كل الطلبات', onClick: () => goTab('requests') })]);
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
    return [K.Section('سجل الحركات', [body, note('الحضور والانصراف، الطلبات وقراراتها، الوقت الإضافي، الأعضاء، المرتبات، التقييم، المهام والإعدادات — آخر 300 حركة. التفاصيل أكواد وشهور وأرقام بس (من غير مبالغ ولا نصوص).')], [Button({ size: 'sm', label: LG.busy ? 'بيحدّث…' : 'تحديث', icon: 'refresh', disabled: LG.busy, attrs: { 'data-hr-log-refresh': '' }, onClick: () => logLoad(true) })], { sub: L ? K.n0(L.length) + ' حركة' : '' })];
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
      note('ساعات اليوم = الانصراف − الحضور. بعد 8 ساعات بيظهر للعضو «إنهاء الدوام / لسه — وقت إضافي». الوقت الإضافي بيتضاف بنفس سعر الساعة (المرتب ÷ 24 ÷ 8) بعد تأكيد المسؤول. شغل الجمعة أو السبت أو عطلة رسمية = اليوم بيومين.'),
      h('div', { class: 'legend t-small' }, h('b', null, 'حالات اليوم:'), K.Tag('success', 'حاضر'), K.Tag('neutral', 'أنهى الدوام'), K.Tag('info', 'عن بُعد'), K.Tag('orange', 'انصراف ناقص'), K.Tag('gold', 'إجازة'), K.Tag('info', 'عطلة رسمية'), K.Tag('error', 'غائب'))], null, { sub: 'اليوم ' + K.dlabel(today()) + ' · ' + list.length + ' عضو' });
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
    const need = workDays * 480;
    const statusTone = (s) => (s === 'حاضر' || s === 'منتظم' ? 'success' : s === 'انصراف ناقص' ? 'orange' : s === 'إجازة' ? 'gold' : s === 'غياب' ? 'error' : s === 'شغل يوم راحة' || s.startsWith('وقت إضافي') ? 'brand' : 'neutral');
    const otPay = O.overtimePay(m.salary || 0, { hours: ot / 60 }), restPay = O.overtimePay(m.salary || 0, { offDays: rest });
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
        totalRow: ['الإجمالي', monShort(mk), workDays + ' يوم عمل', '—', '—', K.Num(K.hm(total)), K.hm(ot) + (rest ? ' + ' + rest + ' يوم' : ''), '—', can().salaries ? K.money(otPay) + (rest ? ' + ' + K.money(restPay) : '') + ' ج' : '—', ''] }) : K.Empty('مفيش أيام الشهر ده لسه', '')),
      note('الدوام مرن: العضو بيبدأ وينهي أكتر من مرة في اليوم والساعات = مجموع الجلسات، ومفيش تأخير. يوم العمل 8 ساعات؛ لما يخلصوا العضو بيختار «إنهاء الدوام» أو «لسه — وقت إضافي». الوقت الإضافي بيتضاف بنفس سعر الساعة بعد تأكيد المسؤول، والمرفوض بيفضل متسجل «وقت إضافي اترفض» + ميتنج. شغل الجمعة/السبت أو العطلة = اليوم بيومين بعد التأكيد.')];
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

  // ================= الطلبات =================
  function requestsTab() {
    const otPend = S.overtime.filter((o) => o.status === 'مستني');
    const subs = [{ id: 'all', label: 'كل الطلبات', count: S.requests.length + otPend.length }, { id: 'pending', label: 'محتاجة قرار', count: S.requests.filter(isPending).length + otPend.length }, { id: 'ot', label: 'وقت إضافي للتأكيد', count: otPend.length }];
    const out = [h('div', { class: 'toolbar' }, K.SubTabs({ items: subs, active: st.reqSub, onChange: (id) => { st.reqSub = id; R(); }, label: 'الطلبات' }), h('span', { class: 'grow' }), Button({ label: 'طلب سُلفة', onClick: () => advanceRequest() }), Button({ type: 'primary', label: 'طلب إجازة', icon: 'plus', onClick: () => leaveRequest() }))];
    if (st.reqSub === 'ot') out.push(otTable(otPend.concat(S.overtime.filter((o) => o.status !== 'مستني'))));
    else out.push(reqTable(st.reqSub === 'pending' ? S.requests.filter(isPending) : S.requests, otPend));
    out.push(note('الوقت الإضافي مش طلب: بيتسجل تلقائي لما العضو يختار «لسه — وقت إضافي» بعد ما الـ 8 ساعات تخلص، وبيوصل للمسؤول يأكده (ضيفه / متضيفهوش + ميتنج). الموافقة على إجازة بتخصم من الرصيد وبتعلّم الأيام في الحضور والتقويم. الرفض لازم له سبب.'));
    return out;
  }
  const reqTone = (s) => (s === 'جديد' ? 'orange' : s === 'قيد المراجعة' ? 'info' : s === 'موافق' ? 'success' : s === 'مرفوض' ? 'error' : 'neutral');
  function reqPeriod(r) {
    if (r.type === 'سُلفة') return (r.amount == null ? 'مبلغ مخفي' : K.money(r.amount) + ' ج') + ' · ' + r.months + ' أقساط';
    if (r.type === 'تصحيح انصراف') return K.dshort(r.from) + ' · انصراف ' + r.time;
    if (r.type === 'إذن انصراف مبكر') return K.dshort(r.from) + ' · ' + r.time;
    return r.to !== r.from ? K.dshort(r.from).split(' ')[0] + ' – ' + K.dshort(r.to) : K.dshort(r.from) + (r.type === 'شغل عن بُعد' ? ' (' + K.dayName(r.from) + ')' : '');
  }
  function reqDur(r) { if (r.type === 'سُلفة') return r.months + ' شهور'; if (r.type === 'إذن انصراف مبكر') return (r.hours || 2) === 2 ? 'ساعتين' : r.hours + ' ساعات'; if (r.type === 'تصحيح انصراف') return '—'; const n = r.type === 'شغل عن بُعد' ? 1 : daysOf(r); return n === 1 ? 'يوم' : n === 2 ? 'يومين' : n + ' أيام'; }
  function reqEffect(r) { const m = M(r.member); if (r.type === 'سُلفة') return r.amount == null ? '—' : '− ' + K.n0(r.amount / r.months) + ' ج/شهر'; if (r.type === 'تصحيح انصراف') return 'يقفل يوم ناقص'; if (r.type === 'إجازة مرضية') return 'بتقرير طبي'; const lt = S.leaveTypes.find((t) => t.name === r.type); if (lt && lt.unpaid) return 'بدون أجر — ' + daysOf(r) + ' يوم من المرتب'; if (isLeave(r) && isPending(r) && lt && lt.deducts) return 'الرصيد ' + leaveLeft(m) + ' ← ' + (leaveLeft(m) - daysOf(r)); return '—'; }
  async function decide(r, s, reason) { const res = await after(H().decide(r.id, s, reason), s === 'موافق' ? 'اتوافق على ' + r.id : s === 'مرفوض' ? 'اترفض ' + r.id : 'اتحوّل للمراجعة'); return res; }
  function reqTable(list, ot) {
    if (!list.length && !ot.length) return K.Section('', K.Empty('مفيش طلبات مستنية قرار', 'أول ما حد يقدّم طلب إجازة أو سُلفة هيظهر هنا.'));
    const RB = K.Bulk({ key: 'hr-req', ids: list.filter(isPending).map((r) => r.id), noun: 'طلب', render: R, actions: [
      { id: 'approve', label: 'موافقة على المحدد', icon: 'check', run: (ids, done) => { const l = list.filter((r) => ids.includes(r.id) && isPending(r)); K.confirm({ title: 'موافقة على ' + l.length + ' طلب؟', text: l.map((r) => r.id + ' · ' + M(r.member).name + ' · ' + r.type).join(' — '), okLabel: 'وافق على ' + l.length, onOk: async () => { for (const r of l) await decide(r, 'موافق'); done(); } }); } },
      { id: 'reject', label: 'رفض المحدد', icon: 'close', danger: true, run: (ids, done) => { const l = list.filter((r) => ids.includes(r.id) && isPending(r)); K.form({ title: 'رفض ' + l.length + ' طلب', values: {}, fields: (f, e, set) => [K.field.select('reason', 'سبب الرفض (لكل الطلبات)', ['ضغط شغل في الفترة دي', 'الرصيد مش كفاية', 'فريق القسم هيبقى ناقص', 'في سُلفة لسه شغالة'], f, e, set, { required: true })], validate: (f) => K.req(f, ['reason'], { reason: 'اختار سبب الرفض' }), submitType: 'danger', submitLabel: 'رفض ' + l.length, submit: (f) => { (async () => { for (const r of l) await decide(r, 'مرفوض', f.reason); done(); })(); } }); } }] });
    const mine = (window.IBDirectory.me() || {}).member_code;
    const row = (r) => [isPending(r) && r.member !== mine ? RB.box(r.id, r.id) : '', K.Num(r.id), mcell(r.member), r.type, reqPeriod(r), reqDur(r), reqEffect(r), r.at, K.Tag(reqTone(r.status), r.status),
      isPending(r) && r.member !== mine ? h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'موافقة', onClick: () => decide(r, 'موافق') }), Button({ size: 'sm', label: 'رفض', onClick: () => rejectReq(r) }), K.RowMenu([{ label: 'التفاصيل', icon: 'external', run: () => reqDetails(r) }])) : isPending(r) && r.member === mine ? h('div', { class: 'acts-inline' }, Button({ type: 'text', size: 'sm', label: 'التفاصيل', onClick: () => reqDetails(r) }), Button({ type: 'text', size: 'sm', label: 'إلغاء الطلب', onClick: () => cancelReq(r) })) : Button({ type: 'text', size: 'sm', label: 'التفاصيل', onClick: () => reqDetails(r) })];
    const otRow = (o) => ['', K.Num(o.id), mcell(o.member), o.kind === 'rest_day' ? 'شغل يوم راحة' : 'تأكيد وقت إضافي', K.dshort(o.date) + ' · ' + o.start + '–' + o.end, o.kind === 'rest_day' ? 'يوم × 2' : K.hm(o.minutes) + ' ساعة', can().salaries ? '+ ' + K.money(otValue(o)) + ' ج' : '—', 'تلقائي ' + o.end, K.Tag('orange', 'بانتظار التأكيد'),
      o.member !== mine && (!H() || H().decidesOt(o)) ? h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'ضيفه', onClick: () => otAdd(o) }), Button({ size: 'sm', label: 'متضيفهوش', onClick: () => otReject(o) })) : o.kind === 'rest_day' && o.member !== mine ? K.Tag('neutral', 'للأدمن') : ''];
    const pend = list.filter(isPending), done = list.filter((r) => !isPending(r));
    const rows = pend.slice(0, 1).map(row).concat(ot.map(otRow), pend.slice(1).map(row), done.map(row));
    return K.Section('الطلبات', [RB.bar(), U.Table({ headers: [pend.length ? RB.head() : '', 'رقم الطلب', 'العضو', 'النوع', 'الفترة / التفاصيل', 'المدة', 'التأثير', 'قُدّم', 'الحالة', 'الإجراء'], rows })], null, { sub: pend.length + ' مستني قرار · ' + done.length + ' اتقفل' });
  }
  const otValue = (o, minutes) => (o.kind === 'rest_day' ? O.overtimePay(M(o.member).salary || 0, { offDays: 1 }) : O.reviewOvertime({ minutes: o.minutes, salary: M(o.member).salary || 0 }, { decision: 'add', minutes: minutes == null ? o.minutes : minutes }).pay);
  const escalate = () => Number(S.hrSettings.escalate) || 24;
  function otTable(list) {
    const mine = (window.IBDirectory.me() || {}).member_code;
    return K.Section('وقت إضافي للتأكيد', list.length ? U.Table({ headers: ['العضو', 'اليوم', 'من – لحد', 'المدة', 'اشتغل على إيه', 'مين يأكد', 'الحالة', ''], rows: list.map((o) => [M(o.member).name, K.dshort(o.date), K.Num(o.start + ' – ' + o.end), o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(o.minutes), h('span', { class: 'wrap' }, o.note), o.status === 'مستني' ? K.Tag(o.waitedHours >= escalate() ? 'error' : 'neutral', (o.waitedHours >= escalate() ? 'الأدمن' : 'المدير المباشر') + (o.waitedHours >= escalate() ? ' (اتصعّد)' : '')) : (o.by || '—'),
      K.Tag(o.status === 'مستني' ? 'orange' : o.status === 'اتضاف' ? 'success' : 'error', o.status === 'اتضاف' ? 'اتضاف ' + (o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(o.paid)) : o.status === 'مستني' ? 'بانتظار التأكيد' : o.status),
      o.status === 'مستني' && o.member !== mine && (!H() || H().decidesOt(o)) ? h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'ضيفه', onClick: () => otAdd(o) }), Button({ size: 'sm', label: 'متضيفهوش', onClick: () => otReject(o) })) : o.status === 'مستني' && o.kind === 'rest_day' && o.member !== mine ? K.Tag('neutral', 'للأدمن') : '']) }) : K.Empty('مفيش وقت إضافي', 'بيتسجل لوحده لما حد يختار «لسه — وقت إضافي» بعد 8 ساعات.'), null, { sub: 'بيتسجل لوحده بعد 8 ساعات ولازم يتأكد قبل ما يدخل الكشف · المدير المباشر ← الأدمن بعد ' + escalate() + ' ساعة' });
  }

  // ================= المرتبات والمكافآت =================
  function payrollTab() {
    const c = can();
    const subs = (c.salaries ? [{ id: 'sheet', label: 'الكشف الشهري' }] : []).concat([{ id: 'perf', label: 'الأداء والـ KPI' }], c.salaries ? [{ id: 'quarter', label: 'صرف الربع والمكافآت' }] : [], [{ id: 'meet', label: 'الميتنجات وخطط التحسين' }]);
    if (!subs.some((x) => x.id === st.paySub)) st.paySub = subs[0].id;
    return [K.SubTabs({ items: subs, active: st.paySub, onChange: (id) => { st.paySub = id; R(); }, label: 'المرتبات والمكافآت' })].concat(st.paySub === 'sheet' ? sheet() : st.paySub === 'perf' ? perf() : st.paySub === 'quarter' ? quarter() : meetings());
  }
  // the month's lines (the server's: live before «اعتماد الكشف», the snapshot after) — fetched once per month and status
  function linesOf(mk) {
    const sh = S.sheets[mk]; const key = mk + '|' + (sh ? sh.status : '-') + '|' + (H().state() === 'ready' ? S.requests.length + ':' + S.overtime.length + ':' + S.adjustments.length : '');
    const c = st.lines[mk];
    if (c && c.key === key) return c;
    st.lines[mk] = { key, status: 'loading', lines: c ? c.lines : [] };
    H().sheetLines(mk).then((r) => { st.lines[mk] = { key, status: r.ok ? 'ok' : 'error', lines: r.ok ? r.lines : [] }; if (window.IBPages.current === 'hr') R(); });
    return st.lines[mk];
  }
  const STEPS = [['مسودة', 'اتولّد تلقائي أول الشهر'], ['مراجعة', 'المحاسب يراجع'], ['معتمد', 'المالك — بيقفل الكشف'], ['مدفوع', 'المصروفات + السحب من الحساب']];
  const slipFor = (lines, m) => lines.find((l) => l.member === m.id) || null;
  function sheet() {
    const mk = st.sheetMonth || thisMonth(); const sh = S.sheets[mk]; const stt = sh ? sh.status : null;
    const months = [...new Set([thisMonth()].concat(Object.keys(S.sheets)))].sort().reverse();
    const pick = U.Select({ id: 'sh-m', label: '', options: months.map((k) => ({ value: k, label: 'الكشف: ' + monLabel(k) })), value: mk, onChange: (v) => { st.sheetMonth = v; R(); } });
    if (!sh) return [h('div', { class: 'toolbar' }, pick), K.Section('كشف ' + monLabel(mk), [K.Empty('الكشف لسه ما اتفتحش', 'بيتفتح لوحده أول الشهر — أو افتحه دلوقتي.'), Button({ type: 'primary', label: 'افتح كشف ' + monLabel(mk), onClick: () => after(H().payrollOpen(mk), 'اتفتح الكشف') })])];
    const L = linesOf(mk); const lines = L.lines; const tot = (k) => lines.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    const si = STEPS.findIndex((x) => x[0] === stt); const locked = si >= 2;
    const dedOf = (p) => p.ded + p.advance + p.unpaidCut;
    const prev = S.sheets[addMonths(mk, -1)]; const trend = prev && prev.total ? Math.round((tot('net') - prev.total) / prev.total * 1000) / 10 : null;
    const PB = K.Bulk({ key: 'hr-pay', ids: lines.map((p) => p.member), noun: 'قسيمة', render: R, actions: [
      { id: 'export', label: 'تصدير القسائم', icon: 'download', run: (ids, done) => { K.xlsxExport('ibtekr-payslips-' + mk + '.xlsx', 'القسائم', [['العضو', 'المرتب', 'المصروف شهريًا', 'أوفر تايم', 'أيام راحة', 'البدلات', 'الخصومات', 'السُلف', 'حافز الربع', 'الصافي']].concat(lines.filter((p) => ids.includes(p.member)).map((p) => [p.name, p.salary, p.paid, p.otPay, p.restPay, p.allow, p.ded + p.unpaidCut, p.advance, p.quarterBonus, p.net]))); done(); } },
      { id: 'adj', label: 'إضافة بند للمحدد', icon: 'plus', run: (ids, done) => { if (locked) { K.toast('الكشف اتقفل — مينفعش تضيف بنود', 'error'); return; } addAdjustment(mk, ids[0]); done(); } }] });
    const steps = h('ol', { class: 'stepper', 'aria-label': 'حالة الكشف' }, STEPS.map(([t, d], i) => h('li', { class: i < si ? 'done' : i === si ? 'on' : '', 'aria-current': i === si ? 'step' : false }, h('i', null, i < si ? Icon('check', 'sm') : String(i + 1)), h('span', null, h('b', null, t), h('small', null, d)))));
    const mLabel = monLabel(mk);
    const cards = h('div', { class: 'cards' }, K.Stat('إجمالي الصافي', K.money(tot('net')), 'ج.م', lines.length + ' أعضاء' + (trend == null ? '' : ' · ' + (trend >= 0 ? '+' : '') + trend + '% عن ' + monShort(addMonths(mk, -1))), undefined, () => ({ title: 'إجمالي الصافي — ' + mLabel, sub: lines.length + ' أعضاء · حالة الكشف: ' + stt + ' · اضغط على العضو يفتح القسيمة', summary: [{ label: 'الصافي', value: K.money(tot('net')) + ' ج.م' }, { label: 'المرتبات', value: K.money(tot('salary')) + ' ج.م' }, { label: 'الخصومات', value: K.money(lines.reduce((s, p) => s + dedOf(p), 0)) + ' ج.م' }], headers: ['العضو', 'المرتب', 'المصروف شهريًا', 'أوفر تايم + راحة', 'البدلات', 'الخصومات', 'الصافي'], rows: lines.map((p) => [p.name, K.money(p.salary), K.money(p.paid), K.money(p.otPay + p.restPay), K.money(p.allow), K.money(dedOf(p)), K.money(p.net)]), onRow: (i) => payslipModal(lines[i], mk), note: 'الصافي = المصروف شهريًا + الوقت الإضافي المتأكد + أيام الراحة ×2 + البدلات − الخصومات والسُلف + حافز الربع (في الشهر التالت).', source: 'كشف المرتبات' })),
      K.Stat('أوفر تايم + أيام راحة', K.money(tot('otPay') + tot('restPay')), 'ج.م', K.money(tot('otPay')) + ' ساعات · ' + K.money(tot('restPay')) + ' أيام ×2', undefined, () => { const l = lines.filter((p) => p.otPay || p.restPay); return { title: 'أوفر تايم + أيام راحة — ' + K.money(tot('otPay') + tot('restPay')) + ' ج.م', sub: 'الوقت الإضافي المتأكد بس · يوم الراحة/العطلة بيومين', summary: [{ label: 'أوفر تايم', value: K.money(tot('otPay')) + ' ج.م' }, { label: 'أيام راحة', value: K.money(tot('restPay')) + ' ج.م' }, { label: 'أعضاء', value: String(l.length) }], headers: ['العضو', 'ساعات أوفر تايم', 'قيمتها', 'أيام راحة', 'قيمتها', 'الإجمالي'], rows: l.map((p) => [p.name, p.otMin ? K.hm(p.otMin) : '—', K.money(p.otPay), p.rest ? String(p.rest) : '—', K.money(p.restPay), K.money(p.otPay + p.restPay)]), onRow: (i) => payslipModal(l[i], mk), source: 'الوقت الإضافي + سجل الحضور' }; }),
      K.Stat('الحافز المحجوز الشهر ده', K.money(tot('holdback')), 'ج.م', 'بيتحدد بتقييم ' + monShort(mk) + ' · يتصرف مع الشهر التالت من الربع', undefined, () => ({ title: 'الحافز المحجوز — ' + mLabel, sub: 'بيتحدد بتقييم الشهر ويتصرف مع مرتب الشهر التالت من الربع', summary: [{ label: 'الإجمالي', value: K.money(tot('holdback')) + ' ج.م' }, { label: 'أعضاء', value: String(lines.length) }], headers: ['العضو', 'المرتب', 'الحافز المحجوز', 'سكور ' + monShort(mk)], rows: lines.map((p) => [p.name, K.money(p.salary), K.money(p.holdback), pct(scoreAt(p.member, mk))]), source: 'كشف المرتبات' })),
      K.Stat('الخصومات', K.money(lines.reduce((s, p) => s + dedOf(p), 0)), 'ج.م', S.adjustments.filter((a) => a.month === mk && a.amount < 0).map((a) => a.label + ' ' + K.n0(-a.amount)).join(' · ') || '—', undefined, () => { const l = S.adjustments.filter((a) => a.month === mk && a.amount < 0); return { title: 'الخصومات — ' + mLabel, sub: l.length + ' بند الشهر ده · والسُلف والإجازات بدون أجر من الطلبات', summary: [{ label: 'البنود', value: K.money(-l.reduce((s, a) => s + a.amount, 0)) + ' ج.م' }, { label: 'السُلف', value: K.money(tot('advance')) + ' ج.م' }, { label: 'بدون أجر', value: K.money(tot('unpaidCut')) + ' ج.م' }], headers: ['العضو', 'البند', 'المبلغ'], rows: l.map((a) => [M(a.member).name, a.label, K.money(-a.amount)]), onRow: toMember(l), empty: 'مفيش خصومات الشهر ده.', source: 'بنود/تسويات الكشف' }; }));
    const nextLabel = si === 0 ? 'إرسال للمراجعة' : si === 1 ? 'اعتماد الكشف' : si === 2 ? 'تعليم مدفوع' : 'اتدفع';
    const back = si === 1 ? Button({ type: 'text', label: 'رجوع للمسودة', onClick: () => after(H().payrollStep(mk, 'مسودة'), 'رجع الكشف مسودة') }) : si === 2 ? Button({ type: 'text', label: 'رجوع للمراجعة', onClick: () => K.confirm({ title: 'فك اعتماد الكشف؟', text: 'الأرقام هترجع تتحسب من الداتا لحد ما يتعتمد تاني.', okLabel: 'رجوع للمراجعة', onOk: () => after(H().payrollStep(mk, 'مراجعة'), 'رجع الكشف للمراجعة') }) }) : null;
    return [h('div', { class: 'toolbar' }, pick, L.status === 'loading' ? h('span', { class: 't-small help', 'data-sheet-loading': '' }, 'بيتحسب الكشف…') : null), steps, cards,
      K.Section('كشف المرتبات — ' + mLabel, [h('div', { class: 'toolbar' }, h('span', { class: 't-small help' }, 'الحساب: المرتب ÷ 24 يوم ÷ 8 ساعات' + (stt === 'مدفوع' && sh.paidAccount ? ' · اتدفع من ' + sh.paidAccount : '')), h('span', { class: 'grow' }), back, Button({ label: 'إضافة بند/تسوية', icon: 'plus', disabled: locked, onClick: () => addAdjustment(mk) }), Button({ type: 'primary', label: nextLabel, disabled: si === 3 || L.status === 'loading', onClick: () => advanceSheet(mk, si, tot('net')) })),
        L.status === 'error' ? U.InlineNote({ kind: 'error', children: 'تعذّر حساب الكشف — جرّب تاني.' }) : null,
        PB.bar(), lines.length ? U.Table({ headers: [PB.head(), 'العضو', 'المرتب', 'المصروف شهريًا', 'الحافز المحجوز', 'أوفر تايم', 'أيام راحة ×2', 'البدلات', 'الخصومات', 'حافز الربع', 'الصافي', ''], rows: lines.map((p) => [PB.box(p.member, p.name), mcell(p.member), K.Num(K.money(p.salary)), K.Num(K.money(p.paid)), K.Num(K.money(p.holdback)), p.otMin ? K.Num(K.hm(p.otMin) + ' · ' + K.money(p.otPay)) : '—', p.rest ? K.Num(p.rest + ' · ' + K.money(p.restPay)) : '—', p.allow ? K.Num(K.money(p.allow)) : '—', dedOf(p) ? K.Num(K.money(dedOf(p))) : '—', p.quarterBonus ? K.Num(K.money(p.quarterBonus)) : '—', h('b', null, K.Num(K.money(p.net))), Button({ type: 'text', size: 'sm', label: 'القسيمة', onClick: () => payslipModal(p, mk) })]),
          totalRow: ['', 'الإجمالي', K.Num(K.money(tot('salary'))), K.Num(K.money(tot('paid'))), K.Num(K.money(tot('holdback'))), K.Num(K.money(tot('otPay'))), K.Num(K.money(tot('restPay'))), K.Num(K.money(tot('allow'))), K.Num(K.money(lines.reduce((s, p) => s + dedOf(p), 0))), K.Num(K.money(tot('quarterBonus'))), h('b', null, K.Num(K.money(tot('net')))), ''] }) : L.status === 'loading' ? null : K.Empty('مفيش أعضاء بمرتب', 'المرتب بيتسجل من «إضافة عضو» أو ملف العضو.'),
        note('الصافي = المصروف شهريًا + الوقت الإضافي المتأكد + أيام الراحة/العطلات ×2 + البدلات − الخصومات والسُلف وأيام الإجازة بدون أجر + حافز الربع (في الشهر التالت بس). الوقت الإضافي اللي لسه بانتظار التأكيد أو «متضيفهوش» مش بيدخل، واللي اتأكد بعد اعتماد كشف شهره بيدخل أول كشف مفتوح. بعد «اعتماد الكشف» الأرقام بتتقفل، و«تعليم مدفوع» بيسجل مصروف «المرتبات» لكل عضو وسحب بالإجمالي من الحساب اللي تختاره.')])];
  }
  function advanceSheet(mk, si, net) {
    if (si === 0) return after(H().payrollStep(mk, 'مراجعة'), 'الكشف اتبعت للمراجعة');
    if (si === 1) return K.confirm({ title: 'اعتماد الكشف', text: 'هيتقفل كشف ' + monLabel(mk) + ' بصافي ' + K.money(net) + ' ج ومش هينفع تضيف بنود بعده. القسايم هتظهر لكل عضو في «ملفي».', okLabel: 'اعتماد الكشف', onOk: () => after(H().payrollStep(mk, 'معتمد'), 'اتعتمد الكشف') });
    if (si === 2) return K.form({ title: 'تعليم الكشف مدفوع — ' + monLabel(mk), values: { account: H().ACCOUNTS[0] }, note: U.InlineNote({ children: 'هيتسجل مصروف «المرتبات» لكل عضو بصافيه في الحسابات، وسحب واحد بالإجمالي (' + K.money(net) + ' ج) من الحساب اللي تختاره.' }),
      fields: (f, e, set) => [K.field.select('account', 'اتدفع من حساب', H().ACCOUNTS, f, e, set, { required: true })], validate: (f) => K.req(f, ['account']), submitLabel: 'اتدفع',
      submit: (f, m) => busy(m, H().payrollPay(mk, f.account), (r) => K.toast('اتسجل الدفع: ' + K.money(r.total) + ' ج من ' + f.account, 'success')) });
    return null;
  }
  function addAdjustment(mk, member) {
    K.form({ title: 'إضافة بند/تسوية — ' + monLabel(mk), values: { kind: 'بدل', member: member || '' }, fields: (f, e, set) => [K.field.select('member', 'العضو', members(), f, e, set, { required: true }), K.Radios({ label: 'النوع', value: f.kind, onChange: (v) => set('kind', v, true), options: [{ value: 'بدل', label: 'بدل / إضافة' }, { value: 'خصم', label: 'خصم' }] }), K.two(K.field.text('label', 'البند', f, e, set, { required: true, placeholder: f.kind === 'خصم' ? 'مثلاً: غياب' : 'مثلاً: بدل انتقالات' }), K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }))],
      validate: (f) => { const e = K.req(f, ['member', 'label', 'amount']); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ أكبر من صفر'; return e; }, submitLabel: 'إضافة',
      submit: (f, m) => busy(m, H().addAdjustment({ member: f.member, month: mk, label: f.label, amount: (f.kind === 'خصم' ? -1 : 1) * Number(f.amount) }), () => K.toast('اتضاف البند', 'success')) });
  }
  function payslipModal(p, mk, status) { // status: «ملفي» passes the sheet's (a member does not read the sheets)
    const m = M(p.member); const r = O.rates(p.salary); const adj = S.adjustments.filter((a) => a.member === p.member && a.month === mk); const sh = status ? { status } : S.sheets[mk] || {};
    const own = p.member === (window.IBDirectory.me() || {}).member_code;
    const line = (k, v, neg) => h('div', { class: 'slip-row' }, h('span', null, k), h('b', { class: 'num' + (neg ? ' neg' : '') }, (neg && v ? '−' : '') + K.money(v)));
    const md = U.Modal({ title: 'قسيمة مرتب ' + monLabel(mk), share: true, body: [h('div', { class: 'slip' }, h('div', { class: 'slip-h' }, window.IBLogo.Logo({ tone: 'color', width: 120 }), h('div', null, h('b', null, p.name), h('div', { class: 't-small' }, (m.title || '') + (m.dept ? ' · ' + m.dept : '')))),
      line('المرتب', p.salary), line('الحافز المحجوز (بيتصرف آخر الربع)', p.holdback, true), p.otPay ? line('أوفر تايم ' + K.hm(p.otMin), p.otPay) : null, p.restPay ? line('أيام راحة ×2 (' + p.rest + ')', p.restPay) : null,
      p.allow - adj.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0) > 0 ? line('البدلات', p.allow - adj.filter((a) => a.amount > 0).reduce((s, a) => s + a.amount, 0)) : null, ...adj.filter((a) => a.amount > 0).map((a) => line(a.label, a.amount)),
      ...adj.filter((a) => a.amount < 0).map((a) => line(a.label, -a.amount, true)), p.advance ? line('قسط سُلفة', p.advance, true) : null, p.unpaidCut ? line('إجازة بدون أجر (' + p.unpaidDays + ' يوم)', p.unpaidCut, true) : null, p.quarterBonus ? line('حافز الربع', p.quarterBonus) : null,
      h('div', { class: 'slip-row total' }, h('span', null, 'الصافي'), h('b', { class: 'num' }, K.money(p.net) + ' ج.م')), h('div', { class: 't-small help' }, 'سعر اليوم ' + K.money(r.daily) + ' · سعر الساعة ' + K.money(r.hourly) + ' · حالة الكشف: ' + (sh.status || 'مسودة')))],
      footer: [Button({ label: 'إغلاق', onClick: () => md.close() }), own ? null : Button({ type: 'primary', label: 'إرسال للعضو', icon: 'send', disabled: sh.status !== 'معتمد' && sh.status !== 'مدفوع', onClick: () => { md.close(); K.toast('القسيمة ظاهرة لـ ' + p.name + ' في «ملفي › مرتبي»', 'success'); } })].filter(Boolean) });
  }
  // the KPIs of a member and the month shown (the latest rated in the quarter)
  const kpisOf = (id) => S.kpis[id] || [];
  const achOf = (k, actual) => (actual == null || actual === '' ? null : k.inverse ? (Number(actual) === 0 ? 120 : k.target / Number(actual) * 100) : Number(actual) / k.target * 100);
  function perf() {
    const tm = team(); if (!tm.length) return [K.Empty('لسه مفيش أعضاء', '')];
    const q = curQ(); const QM = qMonths(q); const c = can();
    const rated = tm.filter((m) => qScore(m.id, q) != null); const qs = rated.map((m) => qScore(m.id, q)); const avg = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : null;
    const by = (f) => tm.filter((m) => f(qRating(m.id, q))); const names = (arr) => arr.map((m) => m.name.split(' ')[0]).join(' · ');
    const exc = by((r) => r === 'ممتاز'), imp = by((r) => r === 'محتاج تحسين'), bad = by((r) => r.startsWith('سيئ'));
    const km = M(st.kpiMember && tm.some((x) => x.id === st.kpiMember) ? st.kpiMember : tm[0].id);
    const kMonth = QM.filter((k) => scoreAt(km.id, k) != null).pop() || (QM.includes(thisMonth()) ? thisMonth() : QM[2]);
    const ks = scoreAt(km.id, kMonth); const kr = ks == null ? null : O.rating(ks); const krow = (S.scoreRows[km.id] || {})[kMonth] || null;
    const scoreRows = (l) => l.map((m) => [m.name, ...QM.map((k) => pct(scoreAt(m.id, k))), pct(qScore(m.id, q)), qRating(m.id, q), c.salaries ? K.n0(O.quarterBonus(m.holdback, scoresOf(m.id, q))) + ' ج' : '—']);
    const SH = ['العضو'].concat(QM.map(monShort), ['سكور الربع', 'التقييم', 'حافز الربع']);
    const dRate = (label, l, sub) => () => ({ title: label + ' — ' + l.length + ' عضو', sub, summary: [{ label: 'أعضاء', value: String(l.length) }, { label: 'متوسط سكورهم', value: l.length ? (l.reduce((x, m) => x + (qScore(m.id, q) || 0), 0) / l.length).toFixed(1) + '%' : '—' }], headers: SH, rows: scoreRows(l), onRow: toMember(l), empty: 'محدش في التقييم ده الربع ده.', source: 'تقييمات ' + qLabel(q) });
    const quarters = [0, 1, 2, 3].map((i) => qOf(addMonths(thisMonth(), -3 * i)));
    const month = (m, k) => { const v = scoreAt(m.id, k); return v == null ? h('span', { class: 't-small help' }, '—') : h('div', { class: 'mcell' }, h('span', null, K.Num(v + '%'), ' ', K.Tag(tone(O.rating(v)), short(O.rating(v)))), c.salaries ? h('small', { class: 't-small help' }, 'حافز ' + K.n0(O.monthBonus(m.holdback, v)) + ' ج') : null); };
    const kp = kpisOf(km.id);
    return [h('div', { class: 'toolbar' }, U.Select({ id: 'perf-q', label: '', options: quarters.map((x) => ({ value: x, label: qLabel(x) })), value: q, onChange: (v) => { st.quarter = v; R(); } })),
      h('div', { class: 'cards' }, K.Stat('متوسط سكور الفريق', avg == null ? '—' : avg.toFixed(1), avg == null ? '' : '%', qLabel(q) + ' · ' + rated.length + ' من ' + tm.length + ' اتقيّموا', undefined, () => ({ title: 'متوسط سكور الفريق — ' + (avg == null ? '—' : avg.toFixed(1) + '%'), sub: qLabel(q) + ' · مرتبين من الأعلى', summary: [{ label: 'المتوسط', value: avg == null ? '—' : avg.toFixed(1) + '%' }, { label: 'ممتاز', value: String(exc.length) }, { label: 'محتاج تحسين', value: String(imp.length) }, { label: 'سيئ', value: String(bad.length) }], headers: SH, rows: scoreRows(tm.slice().sort((a, b) => (qScore(b.id, q) || 0) - (qScore(a.id, q) || 0))), onRow: toMember(tm.slice().sort((a, b) => (qScore(b.id, q) || 0) - (qScore(a.id, q) || 0))), note: 'ممتاز ≥ 100% · جيد 85–99% · محتاج تحسين 70–84% · أقل من 70% إنذار وحافز الشهر = 0.', source: 'تقييمات ' + qLabel(q) })), K.Stat('ممتاز', exc.length, 'عضو', names(exc) || '—', undefined, dRate('ممتاز', exc, 'سكور الربع ≥ 100%')), K.Stat('محتاج تحسين', imp.length, 'عضو', imp.map((m) => m.name).join(' · ') || '—', undefined, dRate('محتاج تحسين', imp, 'سكور الربع 70–84%')), K.Stat('سيئ — ميتنج فردي', bad.length, 'عضو', bad.map((m) => m.name + ' (' + Math.round(qScore(m.id, q)) + '%)').join(' · ') || '—', undefined, dRate('سيئ — ميتنج فردي', bad, 'سكور الربع < 70% أو إنذارين في نفس الربع ← ميتنج فردي تلقائي'))),
      h('div', { class: 'legend t-small' }, h('b', null, 'حدود التقييم:'), K.Tag('success', 'ممتاز ≥ 100%'), K.Tag('brand', 'جيد 85–99%'), K.Tag('orange', 'محتاج تحسين 70–84%'), K.Tag('error', 'إنذار < 70% (حافز الشهر = 0)'), h('span', null, 'حافز الشهر = الحافز المحجوز × السكور (أقصاه 100%)')),
      K.Section('تقييم ' + qLabel(q), U.Table({ headers: ['العضو'].concat(QM.map(monShort), ['سكور الربع', 'تقييم الربع', 'حافز الربع', '']), rows: tm.map((m) => { const qr = qRating(m.id, q); const earned = O.quarterBonus(m.holdback, scoresOf(m.id, q));
        return [h('span', { class: 'mlink' }, U.Avatar(m.name), h('span', null, h('b', null, m.name), c.salaries ? h('small', null, 'حافز ' + K.n0(m.holdback) + '/شهر') : h('small', null, m.title))), ...QM.map((k) => month(m, k)), K.Num(pct(qScore(m.id, q))), K.Tag(qr.startsWith('سيئ') ? 'error' : qr === 'لسه' ? 'neutral' : tone(qr), qr), c.salaries ? h('span', null, K.Num(K.n0(earned)), ' من ', K.Num(K.n0(m.holdback * 3))) : '—', Button({ type: 'text', size: 'sm', label: 'المؤشرات', onClick: () => { st.kpiMember = m.id; R(); } })]; }) })),
      K.Section('تفاصيل مؤشرات ' + km.name + ' — ' + monLabel(kMonth), [ks != null ? U.InlineNote({ kind: kr === 'إنذار' ? 'error' : '', children: 'سكور ' + ks + '% · ' + kr + (c.salaries ? ' · حافز الشهر = ' + K.n0(O.monthBonus(km.holdback, ks)) : '') + (krow && krow.note ? ' · «' + krow.note + '»' : '') + (kr === 'إنذار' && O.quarterBad(scoresOf(km.id, q)) ? ' · الربع سيئ ← اتعمل ميتنج فردي تلقائي' : '') }) : null,
        kp.length ? U.Table({ headers: ['المؤشر', 'المصدر', 'الوزن', 'الهدف', 'الفعلي', 'الإنجاز', 'المساهمة'], rows: kp.map((k) => { const act = krow ? krow.actuals[k.id] : null; const a = achOf(k, act); return [h('span', { class: 'wrap' }, k.name + (k.inverse ? ' (عكسي)' : '')), k.src, k.weight + '%', K.n0(k.target), act == null ? '—' : String(act), a == null ? '—' : Math.round(Math.min(a, 120) * 10) / 10 + '%', a == null ? '—' : (Math.min(a, 120) * k.weight / 100).toFixed(1)]; }), totalRow: ['السكور', '—', kp.reduce((s, k) => s + k.weight, 0) + '%', '—', '—', '—', pct(ks)] })
          : K.Empty('لسه مفيش مؤشرات لـ ' + km.name, c.edit ? 'عرّف مؤشراته (الاسم، الوزن، الهدف) من «تعديل المؤشرات».' : 'الأدمن بيعرّف المؤشرات.'),
        note('الإنجاز = الفعلي ÷ الهدف (أقصاه 120% للمؤشر). المؤشرات العكسية (زي الأخطاء) = الهدف ÷ الفعلي. السكور = مجموع (الإنجاز × الوزن). المؤشرات بتتدخل بالإيد الأول — «قيّم الشهر» كل شهر — والتلقائي من الأوردرات وخدمة العملاء والحضور بعدين.')],
      c.edit ? [Button({ label: 'تعديل المؤشرات', icon: 'sliders', onClick: () => kpiDefs(km) }), kp.length ? Button({ label: 'قيّم الشهر', onClick: () => rateMonth(km, QM) }) : null, S.meetings.some((x) => x.member === km.id && x.dbStatus !== 'اتقفلت') ? Button({ type: 'primary', label: 'فتح الميتنج', onClick: () => { st.paySub = 'meet'; R(); } }) : null] : null)];
  }
  function quarter() {
    const tm = team(); const q = curQ(); const QM = qMonths(q); const last = QM[2];
    const rows = tm.map((m) => { const sc = QM.map((k) => scoreAt(m.id, k)); const got = sc.filter((x) => x != null); const earned = O.quarterBonus(m.holdback, got); const ex = S.extras.filter((e) => e.member === m.id && e.quarter === q); const bad = got.length && O.quarterBad(got);
      return { m, sc, earned, ex, bad, max: m.holdback * 3, total: earned + ex.filter((e) => e.status === 'جاهز للاعتماد').reduce((s, e) => s + e.amount, 0), status: bad ? 'ميتنج فردي مطلوب' : ex.some((e) => e.status === 'مكافأة محتاجة قرار') ? 'مكافأة محتاجة قرار' : got.length < 3 ? 'مستني التقييم' : 'جاهز للاعتماد' }; });
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0); const extras = S.extras.filter((e) => e.quarter === q && e.status === 'جاهز للاعتماد').reduce((s, e) => s + e.amount, 0);
    const mo = (i) => rows.reduce((s, r) => s + (r.sc[i] == null ? 0 : O.monthBonus(r.m.holdback, r.sc[i])), 0);
    const QH = ['العضو', 'المحجوز (3 شهور)'].concat(QM.map(monShort), ['المستحق', 'مكافآت إضافية', 'الإجمالي']);
    const qRow = (r) => [r.m.name, K.money(r.max), ...r.sc.map((x) => (x == null ? '—' : K.n0(O.monthBonus(r.m.holdback, x)))), K.money(r.earned), K.money(r.ex.reduce((x, e) => x + e.amount, 0)), K.money(r.total)];
    const qSpec = (title, sub, summary) => () => ({ title, sub, summary, headers: QH, rows: rows.map(qRow), onRow: (i) => { location.hash = 'member-' + rows[i].m.id; }, note: 'حافز الشهر = المحجوز × سكور الشهر (أقصاه 100%) · أقل من 70% = صفر · بيتصرف مرة واحدة مع مرتب الشهر التالت (' + monLabel(last) + ').', source: 'تقييمات الربع + قواعد المكافآت' });
    const pctOf = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const eligible = (b) => { const m = /سكور الربع\s*≥\s*(\d+)/.exec(b.cond); if (!m) return []; const n = Number(m[1]); return tm.filter((x) => scoresOf(x.id, q).length === 3 && qScore(x.id, q) >= n); };
    return [h('div', { class: 'toolbar' }, U.Select({ id: 'qt-q', label: '', options: [0, 1, 2, 3].map((i) => qOf(addMonths(thisMonth(), -3 * i))).map((x) => ({ value: x, label: qLabel(x) })), value: q, onChange: (v) => { st.quarter = v; R(); } })),
      h('div', { class: 'cards' }, K.Stat('الحافز المحجوز في الربع', K.money(sum('max')), 'ج.م', tm.length + ' أعضاء × 3 شهور', undefined, qSpec('الحافز المحجوز في الربع — ' + K.money(sum('max')) + ' ج.م', tm.length + ' أعضاء × 3 شهور', [{ label: 'المحجوز', value: K.money(sum('max')) + ' ج.م' }, { label: 'المستحق', value: K.money(sum('earned')) + ' ج.م' }, { label: 'بيرجع للشركة', value: K.money(sum('max') - sum('earned')) + ' ج.م' }])), K.Stat('المستحق بالتقييم', K.money(sum('earned')), 'ج.م', pctOf(sum('earned'), sum('max')) + '% من المحجوز', undefined, qSpec('المستحق بالتقييم — ' + K.money(sum('earned')) + ' ج.م', pctOf(sum('earned'), sum('max')) + '% من المحجوز', [{ label: 'المستحق', value: K.money(sum('earned')) + ' ج.م' }].concat(QM.map((k, i) => ({ label: monShort(k), value: K.n0(mo(i)) }))))), K.Stat('المكافآت الإضافية', K.money(extras), 'ج.م', S.extras.filter((e) => e.quarter === q).length + ' مكافأة', undefined, () => ({ title: 'المكافآت الإضافية — ' + K.money(extras) + ' ج.م', sub: 'السيستم بيقترح والمالك بيعتمد', summary: [{ label: 'المعتمد', value: K.money(extras) + ' ج.م' }, { label: 'محتاجة قرار', value: String(S.extras.filter((e) => e.quarter === q && e.status === 'مكافأة محتاجة قرار').length) }], headers: ['العضو', 'القاعدة', 'المبلغ', 'الحالة'], rows: S.extras.filter((e) => e.quarter === q).map((e) => [M(e.member).name, e.rule, K.money(e.amount), e.status]), onRow: toMember(S.extras.filter((e) => e.quarter === q)), source: 'قواعد المكافآت الإضافية' })), K.Stat('إجمالي الصرف مع ' + monShort(last), K.money(sum('earned') + extras), 'ج.م', 'الباقي ' + K.n0(sum('max') - sum('earned')) + ' بيرجع للشركة', undefined, qSpec('إجمالي الصرف مع مرتب ' + monLabel(last) + ' — ' + K.money(sum('earned') + extras) + ' ج.م', 'المستحق بالتقييم + المكافآت الإضافية المعتمدة', [{ label: 'المستحق', value: K.money(sum('earned')) + ' ج.م' }, { label: 'مكافآت', value: K.money(extras) + ' ج.م' }, { label: 'الإجمالي', value: K.money(sum('earned') + extras) + ' ج.م' }]))),
      K.Section('حوافز ' + qLabel(q), U.Table({ headers: ['العضو', 'المحجوز (3 شهور)'].concat(QM.map(monShort), ['مكافآت إضافية', 'الإجمالي', 'الحالة', '']), rows: rows.map((r) => { const qr = qRating(r.m.id, q);
        return [h('span', { class: 'mlink' }, U.Avatar(r.m.name), h('span', null, h('b', null, r.m.name), h('small', null, (qr.startsWith('سيئ') ? 'سيئ' : qr) + ' ' + pct(qScore(r.m.id, q))))), K.Num(K.money(r.max)), ...r.sc.map((s) => (s == null ? '—' : K.Num(K.n0(O.monthBonus(r.m.holdback, s))))), r.ex.length ? r.ex.map((e) => '+ ' + e.amount + ' ' + e.rule + (e.status === 'مكافأة محتاجة قرار' ? ' (مقترحة)' : '')).join('، ') : '—', h('b', null, K.Num(K.money(r.total))), K.Tag(r.status === 'جاهز للاعتماد' ? 'success' : r.status.startsWith('ميتنج') ? 'error' : r.status === 'مستني التقييم' ? 'neutral' : 'orange', r.status),
          r.status === 'مكافأة محتاجة قرار' ? Button({ size: 'sm', label: 'قرار', onClick: () => extraDecision(r.m, q) }) : r.bad ? Button({ type: 'text', size: 'sm', label: 'الميتنج', onClick: () => { st.paySub = 'meet'; R(); } }) : '']; }),
        totalRow: ['الإجمالي', K.Num(K.money(sum('max')))].concat(QM.map((k, i) => K.Num(K.n0(mo(i)))), [K.Num(K.money(extras)), h('b', null, K.Num(K.money(sum('earned') + extras))), '—', '—']) }), [Button({ type: 'primary', label: 'اعتماد صرف الربع', onClick: () => approveQuarter(q, sum('earned') + extras, rows) })]),
      K.Section('قواعد المكافآت الإضافية', U.Table({ headers: ['القاعدة', 'الشرط', 'المبلغ', 'مستحقين الربع ده'], rows: S.bonusRules.filter((b) => b.on).map((b) => { const el = eligible(b).filter((x) => !S.extras.some((e) => e.member === x.id && e.quarter === q && e.rule === b.name));
        return [b.name, b.cond, K.Num(K.money(b.amount) + ' ج'), el.length ? h('div', { class: 'acts-inline' }, ...el.map((x) => Button({ size: 'sm', label: 'اقترح لـ ' + x.name.split(' ')[0], onClick: () => after(H().addExtra({ member: x.id, quarter: q, rule: b.name, amount: b.amount }), 'اتقترحت مكافأة لـ ' + x.name) }))) : '—']; }).concat([['إنجاز يدوي', 'بيحدده المالك بسبب مكتوب', 'حسب القرار', '—']]) }), [Button({ label: 'إدارة القواعد', onClick: () => { st.tab = 'settings'; R(); } }), Button({ label: 'مكافأة إنجاز', icon: 'plus', onClick: () => achievement() })], { sub: 'بتتعرّف من إعدادات الموارد البشرية · السيستم بيقترح (القواعد بشرط «سكور الربع ≥») والمالك بيعتمد' }),
      note('حافز كل شهر = المحجوز × سكور الشهر (أقصاه 100%)، وأقل من 70% = صفر. المستحق بيتجمع ويتصرف مرة واحدة مع مرتب الشهر التالت من الربع (بيدخل كشف ' + monLabel(last) + ' لوحده) ومعاه المكافآت الإضافية المعتمدة. الفرق بين المحجوز والمستحق بيرجع للشركة ومش بيترحّل.')];
  }
  function meetings() {
    const req = S.meetings.filter((x) => x.dbStatus === 'مطلوب' || x.dbStatus === 'اتحدد ميعاد'); const active = S.meetings.filter((x) => x.dbStatus === 'خطة شغالة'); const closed = S.meetings.filter((x) => x.dbStatus === 'اتقفلت');
    const plan = active.find((x) => x.goals) || null; const c = can();
    const stTone = (x) => (x.dbStatus === 'مطلوب' ? 'error' : x.dbStatus === 'اتحدد ميعاد' ? 'orange' : x.dbStatus === 'خطة شغالة' ? 'info' : 'success');
    const MH = ['العضو', 'السبب', 'الحالة', 'الميعاد', 'خطة التحسين', 'المراجعة'];
    const when = (x) => (x.date ? K.dshort(x.date) + (x.time ? ' · ' + x.time : '') : 'لسه متحددش');
    const mRow = (x) => [M(x.member).name, x.reason, x.status, when(x), x.plan, x.review === '—' ? '—' : K.dshort(x.review)];
    const mSpec = (title, sub, l) => () => ({ title: title + ' — ' + l.length, sub, summary: [{ label: 'العدد', value: String(l.length) }], headers: MH, rows: l.map(mRow), onRow: toMember(l), source: 'الميتنجات الفردية' });
    const year = today().slice(0, 4); const closedYear = closed.filter((x) => String(x.date || '').startsWith(year));
    return [h('div', { class: 'cards' }, K.Stat('ميتنجات مطلوبة', req.length, 'ميتنج', req.map((x) => M(x.member).name.split(' ')[0] + ' (' + (String(x.ref || '').startsWith('OT-') ? 'وقت إضافي' : 'أداء') + ')').join(' · ') || '—', undefined, mSpec('ميتنجات مطلوبة', 'لسه محتاجة ميعاد أو نتيجة', req)), K.Stat('خطط تحسين شغالة', active.length, 'خطة', active.map((x) => M(x.member).name + (x.review !== '—' ? ' — مراجعة ' + K.dshort(x.review) : '')).join(' · ') || '—', undefined, mSpec('خطط تحسين شغالة', 'بعد الميتنج · بتتراجع في ميعاد المراجعة', active)), K.Stat('اتقفلت (' + year + ')', closedYear.length, 'ميتنج', '', undefined, mSpec('ميتنجات اتقفلت (' + year + ')', 'بنتيجتها', closedYear))),
      K.Section('الميتنجات الفردية', S.meetings.length ? U.Table({ headers: ['العضو', 'السبب', 'الحالة', 'الميعاد', 'خطة التحسين', 'المراجعة', ''], rows: S.meetings.map((x) => { const m = M(x.member);
        return [mcell(m.id), h('span', { class: 'wrap' }, x.reason), K.Tag(stTone(x), x.status), x.date ? when(x) + (x.place ? ' · ' + x.place : '') : '— لسه متحددش', h('span', null, x.plan, x.progress != null ? h('small', { class: 't-small help' }, ' · تقدّم ' + x.progress + '%') : null), x.review === '—' ? '—' : K.dshort(x.review),
          !c.edit ? '' : x.dbStatus === 'مطلوب' ? Button({ type: 'primary', size: 'sm', label: 'تحديد ميعاد', onClick: () => scheduleMeeting(m, x) }) : x.dbStatus === 'اتحدد ميعاد' ? Button({ size: 'sm', label: 'سجّل النتيجة', onClick: () => meetingResult(x) }) : '']; }) }) : K.Empty('مفيش ميتنجات', 'بتتعمل لوحدها مع ربع سيئ أو «متضيفهوش» — أو حدد واحد بنفسك.'), c.edit ? [Button({ label: 'ميتنج جديد', icon: 'plus', onClick: () => scheduleMeeting(null, null) })] : null),
      plan ? K.Section('خطة تحسين — ' + M(plan.member).name, [h('div', { class: 't-small help' }, (plan.date ? 'اتعملت بعد ميتنج ' + K.dshort(plan.date) : 'خطة شغالة') + (plan.review !== '—' ? ' · المراجعة ' + K.dlabel(plan.review) : '')), ...plan.goals.map((g) => h('div', { class: 'goal' }, h('div', null, h('b', null, g.t), h('div', { class: 't-small help' }, g.how)), K.Tag(g.s === 'اتحقق' ? 'success' : g.s === 'متأخر' ? 'error' : 'orange', g.s))), plan.support || plan.notes ? U.InlineNote({ children: (plan.support ? 'الدعم المتفق عليه: ' + plan.support : '') + (plan.support && plan.notes ? ' · ' : '') + (plan.notes ? 'ملاحظات الميتنج: ' + plan.notes : '') }) : null], c.edit ? [Button({ label: 'تحديث التقدّم', onClick: () => progressUpdate(plan) })] : null) : null,
      note('الميتنج الفردي بيتعمل في حالتين: (1) سكور الربع < 70% أو إنذارين في نفس الربع — تلقائي مع «قيّم الشهر». (2) المسؤول اختار «متضيفهوش» لوقت إضافي — نعرف العضو كان بيعمل إيه. بعد الميتنج ممكن يتضاف الوقت أو يتعمل خطة تحسين أو إنذار.')];
  }

  // ================= إعدادات الموارد البشرية =================
  function settingsTab() {
    const c = S.hrSettings; const admin = can().admin; const edit = can().edit;
    const save = (k, v) => { if (!admin) { K.toast('الإعدادات للأدمن بس', 'error'); return; } after(H().saveSettings({ [k]: v }), 'اتحفظ'); };
    const row = (t, d, ctl) => h('div', { class: 'set-row' }, h('div', null, h('b', null, t), d ? h('div', { class: 't-small help' }, d) : null), ctl);
    const sw = (k, t, d) => K.Switch({ id: 'hs-' + k, label: t, help: d, checked: !!c[k], onChange: (v) => save(k, v) });
    return [K.Section('ساعات العمل', [row('أيام العمل', 'الجمعة والسبت راحة أسبوعية — الشغل فيهم اليوم بيومين', h('div', { class: 'chips' }, ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d, i) => h('span', { class: 'chip', 'aria-pressed': String(i < 5) }, d)))),
      row('ساعات اليوم', 'أي وقت بعدها = أوفر تايم', h('b', null, '8 ساعات')), row('أيام الحساب الشهري', 'سعر اليوم = المرتب ÷ الرقم ده · سعر الساعة = سعر اليوم ÷ ساعات اليوم', h('b', null, '24 يوم')),
      U.Table({ cls: 'mini-table', headers: ['مثال: مرتب 8,000', 'سعر اليوم', 'سعر الساعة', 'يوم جمعة/سبت/عطلة'], rows: [['÷ 24 ÷ 8', K.money(O.rates(8000).daily) + ' ج', K.money(O.rates(8000).hourly) + ' ج', K.money(O.overtimePay(8000, { offDays: 1 })) + ' ج']] }),
      row('مواعيد الدوام', 'مرنة — العضو بيبدأ وينهي أكتر من مرة في اليوم والساعات بتتجمع، ومفيش تأخير', h('b', null, 'مرن')),
      sw('autoMissing', 'انصراف ناقص تلقائي', 'يتعلّم «انصراف ناقص» لو العضو منساش ينهي الدوام لحد 23:59')], null, { sub: 'الأساس اللي بيتحسب عليه الحضور والأوفر تايم وسعر اليوم والساعة' + (admin ? '' : ' · التعديل للأدمن') }),
    K.Section('الأوفر تايم', [sw('countOT', 'احتساب الأوفر تايم (عام)', 'لما يتقفل، الساعات بتتسجل بس ومش بتدخل الكشف'), sw('shiftEnd', 'تنبيه نهاية الدوام', 'بعد 8 ساعات بيظهر للعضو: «إنهاء الدوام» أو «لسه — وقت إضافي»'),
      sw('presence', 'تأكيد التواجد في الوقت الإضافي', 'سؤال «لسه شغال؟» — لو مفيش رد خلال دقيقة الدوام بيتقفل تلقائي على وقت السؤال'), c.presence ? U.Select({ id: 'hs-every', label: 'كل قد إيه', options: [60, 120, 180, 240].map((x) => ({ value: String(x), label: x === 60 ? 'كل ساعة' : x === 120 ? 'كل ساعتين' : 'كل ' + x / 60 + ' ساعات' })), value: String(c.presenceEvery), onChange: (v) => save('presenceEvery', Number(v)) }) : null,
      U.Select({ id: 'hs-who', label: 'مين بيأكد الوقت الإضافي', options: [{ value: 'المدير المباشر', label: 'المدير المباشر ← الأدمن بعد 24 ساعة' }, { value: 'الأدمن', label: 'الأدمن على طول' }], value: c.confirmBy, onChange: (v) => save('confirmBy', v) }), note('«ضيفه» = يدخل الكشف · «متضيفهوش» = ميتنج فردي إلزامي'),
      S.otPeriods.length ? U.Table({ cls: 'mini-table', headers: ['الفترة', 'النطاق', 'الاحتساب', 'أضافها', ''], rows: S.otPeriods.map((p) => [p.range, p.scope, K.Tag(p.count ? 'success' : 'neutral', p.count ? 'بيتحسب' : 'مش بيتحسب'), p.by, edit ? K.RowMenu([{ label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف الفترة', text: p.range, okType: 'danger', okLabel: 'حذف', onOk: () => after(H().otPeriodDelete(p.dbId), 'اتحذفت الفترة') }) }]) : '']) }) : null], edit ? [Button({ label: '+ فترة', onClick: () => otPeriod() })] : null, { sub: 'بيتسجل تلقائي بعد الـ 8 ساعات · بيتضاف بنفس سعر الساعة بعد تأكيد المسؤول · يوم الراحة أو العطلة = اليوم بيومين' }),
    K.Section('العطلات الرسمية', [S.holidays.length ? U.Table({ headers: ['العطلة', 'التاريخ', 'الأيام', 'النوع', 'الحالة', ''], rows: S.holidays.map((x) => [x.name, K.dlabel(x.date) + (x.days > 1 ? ' (' + x.days + ' أيام)' : ''), String(x.days), x.kind, K.Tag(x.status === 'مؤكد' ? 'success' : 'orange', x.status === 'مؤكد' ? 'مؤكد' : 'متوقع — أكّده'), !edit ? '' : x.status !== 'مؤكد' ? Button({ type: 'text', size: 'sm', label: 'أكّده', onClick: () => after(H().holidayConfirm(x.dbId), 'اتأكدت العطلة') }) : K.RowMenu([{ label: 'حذف', icon: 'close', danger: true, run: () => K.confirm({ title: 'حذف العطلة', text: 'هتتشال «' + x.name + '» من التقويم وحساب الإجازات.', okType: 'danger', okLabel: 'حذف', onOk: () => after(H().holidayDelete(x.dbId), 'اتحذفت العطلة') }) }])]) }) : K.Empty('مفيش عطلات متسجلة', 'ضيف العطلات الرسمية للسنة.'), note('العطلة المؤكدة بتتشال من أيام الحضور المطلوبة، واللي يشتغل فيها اليوم بيتحسبله بيومين. لو العطلة جت يوم جمعة أو سبت مفيش يوم بديل.')], edit ? [Button({ label: '+ عطلة', onClick: () => addHoliday() })] : null, { sub: 'الإسلامية + رأس السنة الميلادية · التواريخ الهجرية متوقعة لحد ما تأكدها' }),
    K.Section('أنواع الإجازات والأرصدة', U.Table({ headers: ['النوع', 'الرصيد السنوي', 'بأجر', 'مرفق', 'ترحيل', 'الموافقة'], rows: S.leaveTypes.map((x) => [x.name, x.days, x.paid, x.doc, x.carry, x.approval]) }), edit ? [Button({ label: '+ نوع إجازة', onClick: () => leaveType() })] : null, { sub: 'الرصيد بيتجدد 1 يناير · رصيد كل عضو من ملفه' }),
    K.Section('التقييم والحافز', [row('حدود التقييم الشهري', 'بتتعدّل لكل الفريق مرة واحدة', h('div', { class: 'chips' }, K.Tag('success', 'ممتاز ≥ 100%'), K.Tag('brand', 'جيد ≥ 85%'), K.Tag('orange', 'محتاج تحسين ≥ 70%'), K.Tag('error', 'إنذار < 70%'))), row('حافز الشهر', 'المحجوز × سكور الشهر (أقصاه 100%) · أقل من 70% = صفر', h('b', null, 'نسبي حسب السكور')), row('موعد صرف الحافز', 'الحافز المستحق بيتجمع ويتصرف مع', h('b', null, 'مرتب الشهر التالت من الربع')), row('ربع «سيئ»', 'سكور الربع أقل من الحد أو عدد إنذارات', h('b', null, '< 70% أو 2 إنذار')), row('ميتنج فردي تلقائي', 'بيتعمل للعضو لما الربع يطلع سيئ', K.Tag('success', 'مفعّل')), row('فترة الاختبار', 'مفيش حافز ربع سنوي للعضو في فترة الاختبار', h('b', null, c.probation + ' شهور'))], null, { sub: 'حدود التقييم الشهري وقاعدة الحافز المحجوز' }),
    K.Section('قواعد المكافآت الإضافية', U.Table({ headers: ['القاعدة', 'الشرط', 'المبلغ', 'مفعّلة'], rows: S.bonusRules.map((b) => [b.name, b.cond, K.Num(K.money(b.amount) + ' ج'), h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(b.on), 'aria-label': b.name, disabled: !edit, onClick: () => after(H().bonusRuleToggle(b.dbId, !b.on), (b.on ? 'اتقفلت: ' : 'اتفعّلت: ') + b.name) }, h('i'))]) }), edit ? [Button({ label: '+ قاعدة', onClick: () => bonusRule() })] : null, { sub: 'السيستم بيقترح والمالك بيعتمد' }),
    K.Section('الأقسام والخصوصية', [row('الأقسام', 'بتظهر في فلاتر الفريق والتقارير', h('div', { class: 'chips' }, S.departments.map((d) => h('span', { class: 'list-chip' }, d)), admin ? Button({ type: 'text', size: 'sm', label: '+ قسم', onClick: () => addDept() }) : null)), row('مين يشوف المرتبات', 'صلاحية «المرتبات» (sensitive.salaries) — الأدمن بس دلوقتي، وبتتغيّر من صفحة الإعدادات', h('b', null, 'المالك بس')), sw('hideAmounts', 'إخفاء المبالغ افتراضيًا', 'لازم «إظهار» في «ملفي › مرتبي»')])];
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
        K.two(K.field.text('allow', 'البدلات الشهرية', f, e, set, { inputmode: 'decimal', suffix: 'ج.م' }), K.field.select('shiftStart', 'بداية الدوام', ['08:00', '09:00', '10:00', '11:00'], f, e, set, { help: 'النهاية بعد 8 ساعات' })),
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
    K.form({ title: 'طلب سُلفة', values: Object.assign({ member: (m && who.some((x) => x.value === m.id) ? m.id : null) || me || (who[0] || {}).value, months: '3' }, preOf(pre, ['amount', 'months', 'note'])), fields: (f, e, set) => [who.length > 1 ? K.field.select('member', 'العضو', who, f, e, set, { required: true }) : null, K.two(K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), K.field.select('months', 'عدد الأقساط', ['1', '2', '3', '6'].map((x) => ({ value: x, label: x + ' شهور' })), f, e, set)),
      Number(f.amount) > 0 ? U.InlineNote({ children: 'هيتخصم ' + K.money(Number(f.amount) / Number(f.months)) + ' ج كل شهر من الشهر اللي بعد الموافقة' }) : null, K.field.area('note', 'السبب', f, e, set)],
      validate: (f) => { const e = K.req(f, ['member', 'amount']); const m = M(f.member); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ صحيح'; else if (m.salary && Number(f.amount) > m.salary) e.amount = 'السُلفة متزيدش عن مرتب شهر (' + K.money(m.salary) + ')'; return e; },
      submitLabel: 'تقديم الطلب', submit: (f, md) => busy(md, H().request({ member: f.member, type: 'سُلفة', amount: Number(f.amount), months: Number(f.months), note: f.note || '' }), (r) => K.toast(filedMsg(r), 'success')) });
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
  function rateMonth(m, QM) {
    const kp = kpisOf(m.id); const open = QM.filter((k) => k <= thisMonth());
    const first = open.slice().reverse().find((k) => scoreAt(m.id, k) == null) || open[open.length - 1];
    const prevRow = (S.scoreRows[m.id] || {})[first] || null;
    const vals = { month: first, comment: prevRow ? prevRow.note : '' }; kp.forEach((k) => { vals['k' + k.id] = prevRow && prevRow.actuals[k.id] != null ? String(prevRow.actuals[k.id]) : ''; });
    K.form({ title: 'تقييم الشهر — ' + m.name, values: vals, fields: (f, e, set, draw) => { const score = kp.reduce((s, k) => { const a = achOf(k, f['k' + k.id]); return s + (a == null ? 0 : Math.min(a, 120) * k.weight / 100); }, 0); const r = O.rating(score);
      return [K.field.select('month', 'الشهر', open.map((k) => ({ value: k, label: monLabel(k) })), f, e, (kk, v) => { set(kk, v); const pr = (S.scoreRows[m.id] || {})[v]; kp.forEach((k) => { f['k' + k.id] = pr && pr.actuals[k.id] != null ? String(pr.actuals[k.id]) : ''; }); draw(); }), ...kp.map((k) => K.field.text('k' + k.id, k.name + ' (وزن ' + k.weight + '% · الهدف ' + K.n0(k.target) + (k.inverse ? ' · عكسي' : '') + ')', f, e, (kk, v) => { set(kk, v); draw(); }, { inputmode: 'decimal', suffix: 'الفعلي' })),
        h('div', { class: 'score-box' }, h('span', null, 'السكور: '), h('b', { class: 'num' }, score.toFixed(1) + '%'), K.Tag(tone(r), r), can().salaries ? h('span', { class: 't-small help' }, 'حافز الشهر: ' + K.money(O.monthBonus(m.holdback, score)) + ' من ' + K.money(m.holdback)) : null), K.field.area('comment', 'تعليق للعضو', f, e, set)]; },
      validate: (f) => kp.reduce((e, k) => { const v = f['k' + k.id]; if (v === '' || !(Number(v) >= 0)) e['k' + k.id] = 'اكتب الفعلي (رقم)'; return e; }, {}),
      submitLabel: 'حفظ التقييم', submit: (f, md) => busy(md, H().rateMonth(m.id, f.month, Object.fromEntries(kp.map((k) => [k.id, Number(f['k' + k.id])])), f.comment), (r) => K.toast('اتحفظ تقييم ' + m.name + ': ' + r.score + '%', 'success')) });
  }
  function kpiDefs(m) {
    const rows = kpisOf(m.id).map((k) => Object.assign({}, k));
    const md = U.Modal({ title: 'مؤشرات ' + m.name, body: [] }); md.el.classList.add('wide');
    const draw = (err) => { md.setBody(note('مجموع الأوزان لازم يبقى 100%. الهدف رقم (مثلاً 95 للنسبة، 2 للأخطاء)؛ المؤشر العكسي = الأقل أحسن.'), ...rows.map((k, i) => h('div', { class: 'row cols3' }, U.TextInput({ id: 'kn' + i, label: 'المؤشر', value: k.name, onInput: (v) => { k.name = v; } }), U.TextInput({ id: 'kw' + i, label: 'الوزن', value: String(k.weight || ''), suffix: '%', inputmode: 'numeric', onInput: (v) => { k.weight = Number(v) || 0; } }), U.TextInput({ id: 'kt' + i, label: 'الهدف', value: k.target ? String(k.target) : '', inputmode: 'decimal', onInput: (v) => { k.target = Number(v) || 0; } }), K.Switch({ id: 'ki' + i, label: 'عكسي', checked: !!k.inverse, onChange: (v) => { k.inverse = v; } }), Button({ type: 'text', size: 'sm', label: 'شيل', onClick: () => { rows.splice(i, 1); draw(); } }))),
      Button({ type: 'text', label: 'إضافة مؤشر', icon: 'plus', onClick: () => { rows.push({ name: '', src: 'يدوي', weight: 0, target: 0, inverse: false }); draw(); } }), err ? U.InlineNote({ kind: 'error', children: err }) : null);
      md.setFooter(Button({ label: 'إلغاء', onClick: () => md.close() }), Button({ type: 'primary', label: 'حفظ', onClick: () => { const sum = rows.reduce((s, k) => s + k.weight, 0); if (!rows.length) return draw('ضيف مؤشر واحد على الأقل'); if (Math.abs(sum - 100) > 0.01) return draw('المجموع دلوقتي ' + sum + '% — لازم 100%'); if (rows.some((k) => !String(k.name).trim())) return draw('في مؤشر من غير اسم'); if (rows.some((k) => !(k.target > 0))) return draw('الهدف لازم رقم أكبر من صفر'); busy(md, H().saveKpis(m.id, rows), () => K.toast('اتحفظت المؤشرات', 'success')); return null; } })); };
    draw();
  }
  function extraDecision(m, q) {
    const ex = S.extras.find((e) => e.member === m.id && e.quarter === q && e.status === 'مكافأة محتاجة قرار'); if (!ex) return;
    K.form({ title: 'قرار مكافأة — ' + m.name, values: { d: 'yes' }, note: U.InlineNote({ children: 'سكور الربع ' + pct(qScore(m.id, q)) + ' — «' + ex.rule + '» بـ ' + K.money(ex.amount) + ' ج. القرار للمالك.' }), fields: (f, e, set) => [K.Radios({ label: 'القرار', value: f.d, onChange: (v) => set('d', v, true), options: [{ value: 'yes', label: 'صرف ' + K.money(ex.amount) + ' ج' }, { value: 'no', label: 'مفيش مكافأة الربع ده' }] })],
      submitLabel: 'حفظ القرار', submit: (f, md) => busy(md, H().decideExtra(ex.id, f.d === 'yes'), () => K.toast(f.d === 'yes' ? 'اتعتمدت المكافأة' : 'اترفضت المكافأة', 'success')) });
  }
  function approveQuarter(q, total, rows) {
    const bad = rows.filter((r) => r.bad); const undecided = rows.filter((r) => r.status === 'مكافأة محتاجة قرار'); const waiting = rows.filter((r) => r.status === 'مستني التقييم');
    if (undecided.length) return K.toast('فيه مكافأة محتاجة قرار الأول (' + undecided.map((r) => r.m.name).join('، ') + ')', 'error');
    const last = qMonths(q)[2];
    K.confirm({ title: 'اعتماد صرف ' + qLabel(q), text: 'حافز الربع (' + K.money(total) + ' ج) بيدخل كشف ' + monLabel(last) + ' لوحده مع المكافآت المعتمدة.' + (waiting.length ? ' لسه ' + waiting.length + ' عضو مستني تقييم الربع.' : '') + (bad.length ? ' ' + bad.length + ' عضو ربعه سيئ وليه ميتنج فردي.' : ''), okLabel: 'تمام', onOk: () => { if (window.IBActivity) window.IBActivity.log('hr.quarter.approve', q + ' · ' + rows.length + ' عضو', { entity: 'hr', entity_id: q }); K.toast('حافز ' + qLabel(q) + ' هيتصرف مع كشف ' + monLabel(last), 'success'); } });
  }
  function achievement() {
    K.form({ title: 'مكافأة إنجاز', values: {}, fields: (f, e, set) => [K.field.select('member', 'العضو', members(), f, e, set, { required: true }), K.field.text('title', 'الإنجاز', f, e, set, { required: true }), K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), note('بتتصرف مع مرتب ' + monLabel(thisMonth()) + ' كبند في الكشف.')],
      validate: (f) => { const e = K.req(f, ['member', 'title', 'amount']); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'اكتب مبلغ صحيح'; return e; }, submitLabel: 'إضافة المكافأة', submit: (f, md) => busy(md, H().addAdjustment({ member: f.member, month: thisMonth(), label: f.title, amount: Number(f.amount), kind: 'achievement' }), () => K.toast('اتضافت المكافأة', 'success')) });
  }
  function scheduleMeeting(m, existing) {
    K.form({ title: 'تحديد ميتنج', values: { member: m ? m.id : '', date: H().addDays(today(), 2), time: '12:00', place: 'المكتب', reason: '' }, note: existing ? U.InlineNote({ children: existing.reason }) : null,
      fields: (f, e, set) => [existing ? null : K.field.select('member', 'العضو', members(), f, e, set, { required: true }), K.two(K.field.date('date', 'اليوم', f, e, set, { required: true }), K.field.select('time', 'الساعة', ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'], f, e, set, { required: true })), K.field.select('place', 'المكان', ['المكتب', 'أونلاين'], f, e, set), existing ? null : K.field.select('reason', 'السبب', ['ربع سيئ', 'إنذار في الشهر', 'متابعة خطة تحسين', 'أخرى'], f, e, set, { required: true })],
      validate: (f) => K.req(f, ['date', 'time'].concat(existing ? [] : ['member', 'reason'])), submitLabel: 'تحديد الميتنج',
      submit: (f, md) => busy(md, existing ? H().meetingUpdate(existing.id, { status: 'اتحدد ميعاد', date: f.date, time: f.time, place: f.place }) : H().meetingCreate({ member: f.member, reason: f.reason, status: 'اتحدد ميعاد', date: f.date, time: f.time, place: f.place }), () => K.toast('اتحدد الميتنج', 'success')) });
  }
  function meetingResult(x) {
    const isOT = String(x.ref || '').startsWith('OT-');
    K.form({ title: 'نتيجة الميتنج وخطة التحسين', values: { outcome: isOT ? 'add' : 'plan', review: H().addDays(today(), 30) }, note: U.InlineNote({ children: M(x.member).name + ' · ' + x.reason }),
      fields: (f, e, set) => [K.field.area('summary', 'اتكلمنا في إيه', f, e, set, { required: true }), K.Radios({ label: 'النتيجة', value: f.outcome, onChange: (v) => set('outcome', v, true), options: (isOT ? [{ value: 'add', label: 'الوقت يتضاف (بعد التوضيح)' }] : []).concat([{ value: 'plan', label: 'خطة تحسين' }, { value: 'warn', label: 'إنذار' }, { value: 'none', label: 'مفيش إجراء' }]) }),
        f.outcome === 'plan' ? K.field.area('plan', 'أهداف الخطة (هدف في كل سطر)', f, e, set, { required: true, placeholder: 'هدف واضح + إزاي هنقيسه' }) : null, f.outcome === 'plan' ? K.field.date('review', 'ميعاد المراجعة', f, e, set, { required: true }) : null],
      validate: (f) => K.req(f, ['summary'].concat(f.outcome === 'plan' ? ['plan', 'review'] : [])), submitLabel: 'حفظ النتيجة',
      submit: (f, md) => {
        let p;
        if (f.outcome === 'add') p = H().overtimeDecide(x.ref, 'add').then((r) => (r.ok ? H().meetingUpdate(x.id, { notes: f.summary }) : r)); // the server closes the meeting «اتضاف الوقت»
        else if (f.outcome === 'plan') { const goals = f.plan.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ t, s: 'جاري', how: 'يدوي' })); p = H().meetingUpdate(x.id, { status: 'خطة شغالة', goals, plan: goals.length + ' أهداف · 0 من ' + goals.length + ' اتحقق', review: f.review, progress: 0, notes: f.summary }); }
        else p = H().meetingUpdate(x.id, { status: 'اتقفلت', outcome: f.outcome === 'warn' ? 'إنذار' : 'مفيش إجراء', notes: f.summary });
        return busy(md, p, () => K.toast('اتحفظت النتيجة', 'success')); } });
  }
  function progressUpdate(plan) {
    K.form({ title: 'تحديث التقدّم — ' + M(plan.member).name, values: plan.goals.reduce((o, g, i) => (o['g' + i] = g.s, o), {}), fields: (f, e, set) => plan.goals.map((g, i) => K.field.select('g' + i, g.t, ['جاري', 'اتحقق', 'متأخر'], f, e, set)), submitLabel: 'حفظ',
      submit: (f, md) => { const goals = plan.goals.map((g, i) => Object.assign({}, g, { s: f['g' + i] })); const done = goals.filter((g) => g.s === 'اتحقق').length; const all = done === goals.length;
        return busy(md, H().meetingUpdate(plan.id, Object.assign({ goals, progress: Math.round(done / goals.length * 100), plan: goals.length + ' أهداف · ' + done + ' من ' + goals.length + ' اتحقق' }, all ? { status: 'اتقفلت', outcome: 'اتحسّن' } : {})), () => K.toast(all ? 'الخطة خلصت — الميتنج اتقفل «اتحسّن»' : 'اتحفظ التقدّم', 'success')); } });
  }
  function addHoliday() { K.form({ title: 'إضافة عطلة', values: { days: '1', kind: 'هجري' }, fields: (f, e, set) => [K.field.text('name', 'اسم العطلة', f, e, set, { required: true }), K.two(K.field.date('date', 'أول يوم', f, e, set, { required: true }), K.field.select('days', 'عدد الأيام', ['1', '2', '3', '4', '5'], f, e, set)), K.field.select('kind', 'النوع', ['هجري', 'ميلادي · سنوي', 'استثنائية'], f, e, set)], validate: (f) => K.req(f, ['name', 'date']), submitLabel: 'إضافة', submit: (f, md) => busy(md, H().holidayAdd({ name: f.name, date: f.date, days: Number(f.days), kind: f.kind, status: f.kind === 'هجري' ? 'متوقع' : 'مؤكد' }), () => K.toast('اتضافت العطلة', 'success')) }); }
  function otPeriod() { K.form({ title: 'فترة الأوفر تايم', values: { count: 'yes', scope: 'كل الفريق' }, fields: (f, e, set) => [K.two(K.field.date('from', 'من', f, e, set, { required: true }), K.field.date('to', 'لحد', f, e, set, { required: true })), K.field.select('scope', 'النطاق', ['كل الفريق'].concat(team().map((m) => m.name + ' بس')), f, e, set), K.Radios({ label: 'الوقت الإضافي في الفترة دي', value: f.count, onChange: (v) => set('count', v, true), options: [{ value: 'yes', label: 'بيتحسب' }, { value: 'no', label: 'مش بيتحسب (بيتسجل بس)' }] })], validate: (f) => { const e = K.req(f, ['from', 'to']); if (f.from && f.to && f.to < f.from) e.to = 'النهاية بعد البداية'; return e; }, submitLabel: 'حفظ', submit: (f, md) => busy(md, H().otPeriodAdd({ range: K.dshort(f.from) + ' – ' + K.dlabel(f.to), scope: f.scope, count: f.count === 'yes' }), () => K.toast('اتحفظت الفترة', 'success')) }); }
  function bonusRule() { K.form({ title: 'قاعدة مكافأة', values: {}, fields: (f, e, set) => [K.field.text('name', 'اسم القاعدة', f, e, set, { required: true }), K.field.text('cond', 'الشرط', f, e, set, { required: true, placeholder: 'مثلاً: سكور الربع ≥ 115%' }), K.field.text('amount', 'المبلغ', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' })], validate: (f) => { const e = K.req(f, ['name', 'cond', 'amount']); if (f.amount && !(Number(f.amount) > 0)) e.amount = 'مبلغ صحيح'; return e; }, submitLabel: 'إضافة', submit: (f, md) => busy(md, H().bonusRuleAdd({ name: f.name, cond: f.cond, amount: Number(f.amount) }), () => K.toast('اتضافت القاعدة', 'success')) }); }
  function leaveType() { K.form({ title: 'نوع إجازة', values: { paid: 'نعم', approval: 'المدير المباشر', carry: '—', deducts: 'no' }, fields: (f, e, set) => [K.two(K.field.text('name', 'الاسم', f, e, set, { required: true }), K.field.text('days', 'الرصيد السنوي', f, e, set, { required: true, placeholder: 'مثلاً: 3 أيام' })), K.Radios({ label: 'بأجر؟', value: f.paid, onChange: (v) => set('paid', v, true), options: [{ value: 'نعم', label: 'نعم' }, { value: 'لا', label: 'لا (اليوم ÷ 24 من المرتب)' }] }), K.Radios({ label: 'بتتخصم من الرصيد السنوي؟', value: f.deducts, onChange: (v) => set('deducts', v, true), options: [{ value: 'yes', label: 'أيوه' }, { value: 'no', label: 'لأ' }] }), K.two(K.field.select('approval', 'الموافقة', ['المدير المباشر', 'الأدمن', 'المالك'], f, e, set), K.field.select('carry', 'ترحيل', ['—', 'لحد 5 أيام', 'كله'], f, e, set)), K.field.text('doc', 'مرفق مطلوب', f, e, set, { placeholder: '—' })], validate: (f) => K.req(f, ['name', 'days']), submitLabel: 'إضافة', submit: (f, md) => busy(md, H().leaveTypeAdd({ name: f.name, days: f.days, paid: f.paid === 'لا' ? 'لا (يوم = ÷ 24)' : 'نعم', unpaid: f.paid === 'لا', deducts: f.deducts === 'yes', doc: f.doc || '—', carry: f.carry, approval: f.approval }), () => K.toast('اتضاف نوع الإجازة', 'success')) }); }
  function addDept() { K.form({ title: 'قسم جديد', values: {}, fields: (f, e, set) => [K.field.text('name', 'اسم القسم', f, e, set, { required: true })], validate: (f) => { const e = K.req(f, ['name']); if (S.departments.includes(String(f.name).trim())) e.name = 'موجود بالفعل'; return e; }, submitLabel: 'إضافة', submit: (f, md) => busy(md, H().addDepartment(f.name), () => K.toast('اتضاف القسم', 'success')) }); }

  // the HR rows changed (a write, the live line, a reload): draw again when the page is open
  document.addEventListener('ib:hr', () => { if (window.IBPages.current === 'hr') R(); });
  // the old prototype's api for the blocks not on IBHR yet (the profile — T7; the bell / dashboard read these helpers)
  const slipOf = (m) => { const L = st.lines[thisMonth()]; const p = L && L.lines ? slipFor(L.lines, m) : null; return p || O.payslip({ salary: m.salary || 0, holdback: m.holdback || 0, bonus: m.allow || 0 }); };
  window.IBPages.register('hr', { title: 'الموارد البشرية', hash: (hs) => { const m = /^hr(?:-(overview|team|requests|payroll|log|reports|settings))?$/.exec(hs); if (!m) return false; st.tab = m[1] || 'overview'; return true; }, defaultHash: () => 'hr-' + st.tab, view,
    api: { addMember, decide: (r, s, reason) => decide(r, s, reason), rejectReq, reqDetails, otAdd, otReject, leaveRequest, advanceRequest, remoteRequest, newPassword, slipModal: (p, mk, status) => payslipModal(p, mk, status), payslipModal: (m) => { const L = linesOf(thisMonth()); const p = slipFor(L.lines, m); if (p) payslipModal(p, thisMonth()); else K.toast('القسيمة لسه بتتحسب — جرّب كمان شوية'); }, slipOf, manualAtt, uploadContract, scheduleMeeting, status, pendingCount, isPending, reqPeriod, qScore: (id) => qScore(id), cancelReq, present } });
})();
