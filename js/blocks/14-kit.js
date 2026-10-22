
/* Shared pieces for the new modules (HR, inventory, settings, profile, login). Built on IBUI; one function per Figma component.
   Also holds the in-memory ops store shared between modules (team, attendance, requests, overtime queue, stock ledger, tasks). */
(function () {
  'use strict';
  const U = window.IBUI, D = window.IbtekrDomain, O = window.IbtekrOps;
  const { h, Icon, Button, IconButton } = U;
  const TODAY = '2026-10-21';
  const NOW_MIN = 14 * 60 + 14; // fixed demo clock for other members' live status (14:14 — Figma 363:42343)
  let ME = 'M01'; // signed-in member (صفوت كمال, admin); IBDirectory.load() sets the real one via setMe
  const setMe = (code) => { ME = code; window.IBKit.ME = code; };
  const money = (n) => D.formatMoney(n);
  const n0 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const AR_MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const AR_DAY = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
  function dlabel(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return d + ' ' + AR_MON[m - 1] + ' ' + y; }
  function dshort(iso) { if (!iso) return '—'; const [, m, d] = iso.split('-').map(Number); return d + ' ' + AR_MON[m - 1]; }
  const dayName = (iso) => AR_DAY[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const hm = (min) => { const m = Math.max(0, Math.round(min)); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
  const hrs = (min) => { const m = Math.round(min); const hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + ' س' : '') + (hh && mm ? ' ' : '') + (mm || !hh ? mm + ' د' : ''); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

  // ---------- components ----------
  // Tag/Tone (Figma 360:2518): Success, Brand, Gold, Orange, Error, Neutral, Info
  const Tag = (tone, label, icon) => h('span', { class: 'tg tg-' + tone }, icon ? Icon(icon, 'sm') : null, label);
  function PageHead(title, sub, actions) {
    return h('div', { class: 'page-head row' }, h('div', null, h('h1', { class: 't-h3' }, title), sub ? h('p', { class: 't-small' }, sub) : null), actions ? h('div', { class: 'actions' }, actions) : null);
  }
  // Sub tabs: segmented (Figma Tab / Size=Sm)
  function SubTabs({ items, active, onChange, label }) {
    const list = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': label || 'أقسام' });
    items.forEach((t) => list.append(h('button', { type: 'button', role: 'tab', class: 'subtab', 'aria-selected': String(t.id === active), tabindex: t.id === active ? '0' : '-1', onClick: () => onChange(t.id) }, t.label, t.count != null ? h('span', { class: 'cnt' }, String(t.count)) : null)));
    list.addEventListener('keydown', (e) => { const i = items.findIndex((t) => t.id === active); let n = null; if (e.key === 'ArrowLeft') n = (i + 1) % items.length; if (e.key === 'ArrowRight') n = (i - 1 + items.length) % items.length; if (n != null) { e.preventDefault(); onChange(items[n].id); setTimeout(() => { const b = document.querySelector('.subtab[aria-selected=true]'); if (b) b.focus(); }); } });
    return list;
  }
  function MainTabs({ items, active, onChange, label }) {
    const t = U.Tabs({ items, active, onChange: (id, kb) => { onChange(id); if (kb) setTimeout(() => { const b = document.getElementById('tab-' + id); if (b) b.focus(); }); } });
    t.setAttribute('aria-label', label || 'أقسام الصفحة');
    return t;
  }
  function Section(title, body, actions, opts = {}) {
    return h('section', { class: 'card sec' + (opts.cls ? ' ' + opts.cls : '') }, title || actions ? h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, title), opts.sub ? h('div', { class: 't-small sub' }, opts.sub) : null), actions ? h('div', { class: 'acts' }, actions) : null) : null, h('div', { class: 'sec-b' }, body));
  }
  function Switch({ id, label, checked, onChange, help, disabled }) {
    const b = h('button', { type: 'button', role: 'switch', id, class: 'sw', 'aria-checked': String(!!checked), 'aria-label': label, disabled, onClick: () => onChange(!checked) }, h('i'));
    return h('div', { class: 'sw-row' }, h('div', { class: 'sw-txt' }, h('label', { for: id, class: 't-label' }, label), help ? h('div', { class: 't-small help' }, help) : null), b);
  }
  function Checkbox({ label, checked, onChange, disabled, small }) {
    return h('button', { type: 'button', role: 'checkbox', class: 'cb' + (small ? ' sm' : ''), 'aria-checked': String(!!checked), disabled, onClick: () => onChange(!checked) }, h('i', null, checked ? Icon('check', 'sm') : null), label ? h('span', null, label) : null);
  }
  function Radios({ label, options, value, onChange, name }) {
    const g = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': label || name });
    options.forEach((o) => g.append(h('button', { type: 'button', role: 'radio', class: 'radio', 'aria-checked': String(o.value === value), onClick: () => onChange(o.value) }, h('i'), h('span', null, o.label), o.hint ? h('small', { class: 't-small help' }, o.hint) : null)));
    return label ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, label), g) : g;
  }
  // Accordion (owner 22 Oct): small title + small description under it, and a bordered up/down arrow button like the orders cards.
  function Accordion({ title, desc, meta, open, onToggle, body, id }) {
    const pid = 'acc-' + (id || Math.random().toString(36).slice(2, 7));
    const tog = IconButton({ icon: open ? 'chevU' : 'chevD', label: (open ? 'طي ' : 'فتح ') + title, onClick: onToggle, attrs: { 'aria-expanded': String(!!open), 'aria-controls': pid, class: 'icon-btn acc-tog' } });
    return h('div', { class: 'acc' + (open ? ' open' : '') },
      h('div', { class: 'acc-h' }, h('button', { type: 'button', class: 'acc-t', 'aria-expanded': String(!!open), 'aria-controls': pid, onClick: onToggle }, h('span', { class: 't-label' }, title), desc ? h('span', { class: 't-small acc-d' }, desc) : null),
        meta ? h('span', { class: 't-small meta' }, meta) : null, tog),
      open ? h('div', { class: 'acc-b', id: pid }, body) : null);
  }
  // Row ⋮ menu (Figma Icon button more + Dropdown menu)
  function RowMenu(items, label = 'إجراءات') {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = IconButton({ icon: 'more', label, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ role: 'menu', end: true, options: items.filter(Boolean).map((it, i) => ({ value: i, label: it.label, icon: it.icon, danger: it.danger })), onSelect: (i) => { close(); items.filter(Boolean)[i].run(); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  const Kv = (rows) => h('dl', { class: 'kv' }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v == null || v === '' ? '—' : v)]));
  const Stat = (label, value, unit, note, compare, details) => U.KpiTile({ label, value: String(value), unit, note, compare, details });
  function Empty(title, text, action) { const e = U.EmptyState(title, text); if (action) e.append(action); return e; }
  const Num = (v) => (/[\u0600-\u06FF]/.test(String(v)) ? h('span', null, String(v)) : U.num(v)); // LTR isolate only for pure numbers

  // ---------- toast ----------
  let toastEl = null, toastT = 0;
  function toast(msg, kind) {
    if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
    toastEl.className = 'toast show ' + (kind || ''); toastEl.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
  }

  // ---------- form modal: keeps values on error, validates inline, focuses first error ----------
  function form({ title, values, fields, validate, submit, submitLabel = 'حفظ', submitType = 'primary', cancelLabel = 'إلغاء', wide, extraFooter, note }) {
    const f = Object.assign({}, values || {}); let errs = {}; let m = null;
    const set = (k, v, redraw) => { f[k] = v; if (errs[k]) { delete errs[k]; redraw = true; } if (redraw) draw(); };
    function draw() {
      m.setBody(...[note ? (typeof note === 'function' ? note(f) : note) : null].concat([].concat(fields(f, errs, set, draw))).filter(Boolean));
      m.setFooter(...[extraFooter ? extraFooter(f, m) : null, Button({ label: cancelLabel, onClick: () => m.close() }), Button({ type: submitType, label: typeof submitLabel === 'function' ? submitLabel(f) : submitLabel, onClick: go })].filter(Boolean));
    }
    function go() {
      errs = validate ? (validate(f) || {}) : {};
      if (Object.keys(errs).length) { draw(); const first = m.el.querySelector('[aria-invalid=true],.err'); if (first && first.focus) first.focus(); return; }
      const r = submit(f, m); if (r !== false) m.close();
    }
    m = U.Modal({ title, body: [], footer: [] }); if (wide) m.el.classList.add(wide === true ? 'wide' : wide); draw();
    setTimeout(() => { const i = m.el.querySelector('.modal-b input,.modal-b textarea,.modal-b button'); if (i) i.focus(); });
    return m;
  }
  function confirm({ title, text, okLabel = 'تأكيد', okType = 'primary', cancelLabel = 'إلغاء', onOk, body }) {
    const m = U.Modal({ title, body: [text ? h('p', { class: 't-body', style: 'margin:0' }, text) : null, body || null].filter(Boolean), footer: [Button({ label: cancelLabel, onClick: () => m.close() }), Button({ type: okType, label: okLabel, onClick: () => { m.close(); onOk && onOk(); } })] });
    return m;
  }
  const field = {
    text: (id, label, f, errs, set, o = {}) => U.TextInput(Object.assign({ id, label, value: f[id], error: errs[id], onInput: (v) => set(id, v) }, o)),
    area: (id, label, f, errs, set, o = {}) => U.Textarea(Object.assign({ id, label, value: f[id], error: errs[id], onInput: (v) => set(id, v) }, o)),
    select: (id, label, opts, f, errs, set, o = {}) => U.Select(Object.assign({ id, label, options: opts.map((x) => (typeof x === 'string' ? { value: x, label: x } : x)), value: f[id], error: errs[id], onChange: (v) => set(id, v, true) }, o)),
    date: (id, label, f, errs, set, o = {}) => U.DateField(Object.assign({ id, label, value: f[id], error: errs[id], today: TODAY, onChange: (v) => set(id, v, true) }, o)),
    file: (id, label, f, errs, set, o = {}) => {
      const inp = h('input', { type: 'file', id, class: 'sr-file', accept: o.accept || '.pdf,.jpg,.png', onChange: () => set(id, inp.files[0] ? inp.files[0].name : '', true) });
      return U.FieldShell({ id, label, required: o.required, error: errs[id], help: o.help || 'PDF أو صورة — حد أقصى 10 ميجا' }, h('label', { class: 'upload' + (errs[id] ? ' err' : ''), for: id }, Icon('attach', 'sm'), h('span', null, f[id] || 'اختار ملف أو اسحبه هنا'), inp));
    },
  };
  const two = (a, b) => h('div', { class: 'row cols2' }, a, b);
  const req = (f, keys, msgs = {}) => keys.reduce((e, k) => { if (f[k] == null || String(f[k]).trim() === '') e[k] = msgs[k] || 'الحقل ده مطلوب'; return e; }, {});

  // ---------- ops store (in-memory adapter; every mutation writes to the event log) ----------
  const logEvent = (action, detail) => { if (window.IbtekrApp && window.IbtekrApp.logEvent) window.IbtekrApp.logEvent({ action, newValue: detail }); store.activity.unshift({ at: TODAY + ' ' + clockNow(), actor: member(ME).name, action, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); return window.IBActivity ? window.IBActivity.log(action, detail).catch(() => {}) : Promise.resolve(); };
  const clockNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const store = {
    members: [
      { id: 'M01', name: 'صفوت كمال', role: 'أدمن', title: 'المؤسس والمدير العام', dept: 'الإدارة', manager: null, salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'], leave: 21, used: 3, hire: '2024-03-01', phone: '01001234567', email: 'safwat@ibtekr.club', lastLogin: 'اليوم 13:40', status: 'active', twofa: true, contract: 'uploaded', monthMin: 0, otMonth: 0 },
      { id: 'M02', name: 'سارة أحمد', role: 'عمليات', title: 'مديرة العمليات', dept: 'العمليات', manager: 'M01', salary: 12000, holdback: 1500, allow: 500, shift: ['09:00', '17:00'], leave: 21, used: 7, hire: '2024-05-12', phone: '01012345678', email: 'sara@ibtekr.club', lastLogin: 'اليوم 11:05', override: 1, status: 'active', twofa: true, contract: 'uploaded', monthMin: 7710, otMonth: 360 },
      { id: 'M03', name: 'محمد علي', role: 'خدمة العملاء', title: 'خدمة العملاء', dept: 'خدمة العملاء', manager: 'M02', salary: 8000, holdback: 1000, allow: 300, shift: ['09:00', '17:00'], leave: 21, used: 3, hire: '2025-01-05', phone: '01098765432', email: 'mohamed@ibtekr.club', lastLogin: 'أمس 18:20', status: 'active', twofa: false, contract: 'uploaded', monthMin: 7920, otMonth: 15 },
      { id: 'M04', name: 'منى حسن', role: 'متابعة الموردين', title: 'متابعة الموردين', dept: 'المبتكرين', manager: 'M02', salary: 7000, holdback: 1000, allow: 300, shift: ['09:00', '17:00'], leave: 21, used: 10, hire: '2025-03-20', phone: '01122334455', email: 'mona@ibtekr.club', status: 'active', twofa: false, contract: 'uploaded', monthMin: 6240, otMonth: 0 },
      { id: 'M05', name: 'كريم سامي', role: 'مشاهد', title: 'مصوّر منتجات', dept: 'الميديا', manager: 'M02', salary: 9000, holdback: 1000, allow: 500, shift: ['10:00', '18:00'], leave: 21, used: 5, hire: '2025-06-01', phone: '01234567890', email: 'karim@ibtekr.club', status: 'active', twofa: false, contract: 'missing', monthMin: 7090, otMonth: 150 },
      { id: 'M06', name: 'نورا عادل', role: 'حسابات', title: 'محاسبة', dept: 'الحسابات', manager: 'M01', salary: 10000, holdback: 1000, allow: 0, shift: ['09:00', '17:00'], leave: 21, used: 0, hire: '2024-09-15', phone: '01555666777', email: 'noura@ibtekr.club', status: 'active', twofa: true, contract: 'uploaded', monthMin: 7560, otMonth: 0 },
      { id: 'M07', name: 'يوسف طارق', role: 'عمليات', title: 'تغليف وشحن', dept: 'العمليات', manager: 'M02', salary: 6000, holdback: 500, allow: 300, shift: ['09:00', '17:00'], leave: 21, used: 16, hire: '2025-08-10', phone: '01066778899', email: 'youssef@ibtekr.club', status: 'active', twofa: false, contract: 'expiring', monthMin: 5800, otMonth: 0 },
      { id: 'M08', name: 'هبة محمود', role: 'عمليات', title: 'كتالوج ومحتوى', dept: 'المحتوى', manager: 'M02', salary: 8000, holdback: 1000, allow: 300, shift: ['09:00', '17:00'], leave: 21, used: 12, hire: '2025-02-01', phone: '01011122233', email: 'heba@ibtekr.club', status: 'active', twofa: false, contract: 'uploaded', monthMin: 7300, otMonth: 270, restDays: 1 },
      { id: 'M09', name: 'هدى سمير', role: 'حسابات', title: 'محاسبة (دعوة)', dept: 'الحسابات', manager: 'M01', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'], leave: 21, used: 0, hire: '2026-10-20', phone: '', email: 'hoda@ibtekr.club', status: 'invited', twofa: false, contract: 'missing', monthMin: 0, otMonth: 0, lastLogin: '—', invitedAt: 'أمس 16:05' },
      { id: 'M10', name: 'كريم مصطفى', role: 'متابعة الموردين', title: 'متابعة الموردين', dept: 'المبتكرين', manager: 'M02', salary: 0, holdback: 0, allow: 0, shift: ['09:00', '17:00'], leave: 21, used: 0, hire: '2025-04-01', phone: '', email: 'karim.m@ibtekr.club', status: 'suspended', twofa: false, contract: 'uploaded', monthMin: 0, otMonth: 0, lastLogin: 'منذ 12 يوم' },
    ],
    // today (Figma 363:42343): minutes since 00:00; kind overrides the computed status
    today: { M02: { in: 542, out: null }, M03: { in: 535, out: 1030 }, M04: { kind: 'leave' }, M05: { in: 620, out: null }, M06: { in: 540, out: null, remote: true }, M07: { kind: 'absent' }, M08: { in: 550, out: null, missingYesterday: true } },
    attendance: [], // filled below
    departments: ['العمليات', 'خدمة العملاء', 'المبتكرين', 'الميديا', 'الحسابات', 'المحتوى'],
    holidays: [{ date: '2027-01-01', name: 'رأس السنة الميلادية', days: 1, kind: 'ميلادي · سنوي', status: 'مؤكد' }, { date: '2027-03-09', name: 'عيد الفطر', days: 3, kind: 'هجري', status: 'متوقع' }, { date: '2027-05-15', name: 'وقفة عرفات وعيد الأضحى', days: 4, kind: 'هجري', status: 'متوقع' }, { date: '2027-06-06', name: 'رأس السنة الهجرية', days: 1, kind: 'هجري', status: 'متوقع' }, { date: '2027-08-14', name: 'المولد النبوي', days: 1, kind: 'هجري', status: 'متوقع' }],
    leaveTypes: [{ name: 'إجازة سنوية', days: '21 يوم', paid: 'نعم', doc: '—', carry: 'لحد 5 أيام', approval: 'المدير المباشر' }, { name: 'إجازة عارضة', days: '6 أيام (من السنوية)', paid: 'نعم', doc: '—', carry: '—', approval: 'المدير المباشر' }, { name: 'إجازة مرضية', days: 'حسب التقرير', paid: 'نعم', doc: 'تقرير طبي إلزامي', carry: '—', approval: 'الأدمن' }, { name: 'إجازة بدون أجر', days: '—', paid: 'لا (يوم = ÷ 24)', doc: '—', carry: '—', approval: 'المالك' }],
    // requests (Figma 366:45002). pending = جديد / قيد المراجعة
    requests: [
      { id: 'HR-0156', type: 'إجازة سنوية', member: 'M04', from: '2026-10-26', to: '2026-10-28', note: '', status: 'جديد', at: 'اليوم 10:12' },
      { id: 'HR-0154', type: 'تصحيح انصراف', member: 'M08', from: '2026-10-20', to: '2026-10-20', time: '17:15', note: 'نسيت أنهي الدوام', status: 'جديد', at: 'أمس 09:30' },
      { id: 'HR-0153', type: 'شغل عن بُعد', member: 'M06', from: '2026-10-22', to: '2026-10-22', note: '', status: 'قيد المراجعة', at: '19 أكتوبر' },
      { id: 'HR-0152', type: 'إجازة عارضة', member: 'M07', from: '2026-10-21', to: '2026-10-21', note: '', status: 'قيد المراجعة', at: 'اليوم 08:10' },
      { id: 'HR-0150', type: 'سُلفة', member: 'M03', amount: 1500, months: 3, note: '', status: 'موافق', at: '15 أكتوبر', by: 'صفوت كمال', startMonth: 11 },
      { id: 'HR-0149', type: 'إجازة مرضية', member: 'M02', from: '2026-10-12', to: '2026-10-13', note: 'بتقرير طبي', status: 'موافق', at: '12 أكتوبر', by: 'صفوت كمال' },
      { id: 'HR-0147', type: 'إذن انصراف مبكر', member: 'M05', from: '2026-10-08', to: '2026-10-08', time: '15:00', hours: 2, note: '', status: 'مرفوض', at: '7 أكتوبر', by: 'سارة أحمد', reason: 'تسليم صور W&R في نفس اليوم' },
      { id: 'HR-0145', type: 'إجازة سنوية', member: 'M04', from: '2026-10-21', to: '2026-10-22', note: '', status: 'موافق', at: '12 أكتوبر', by: 'سارة أحمد' },
      { id: 'HR-0143', type: 'إجازة سنوية', member: 'M03', from: '2026-10-27', to: '2026-10-27', note: '', status: 'موافق', at: '13 أكتوبر', by: 'سارة أحمد' },
      { id: 'HR-0142', type: 'شغل عن بُعد', member: 'M06', from: '2026-10-21', to: '2026-10-21', note: '', status: 'موافق', at: '14 أكتوبر', by: 'صفوت كمال' },
      { id: 'HR-0141', type: 'إجازة سنوية', member: 'M08', from: '2026-10-14', to: '2026-10-14', note: '', status: 'موافق', at: '9 أكتوبر', by: 'سارة أحمد' },
    ],
    overtime: [ // recorded automatically after 8h; waiting for confirmation (Figma OT-0021)
      { id: 'OT-0021', member: 'M05', date: '2026-10-19', start: '18:00', end: '20:30', minutes: 150, note: 'تصوير منتجات W&R الجديدة (12 منتج)', status: 'مستني', waitedHours: 15 },
      { id: 'OT-0018', member: 'M03', date: '2026-10-14', start: '17:00', end: '20:00', minutes: 180, note: 'متابعة تذاكر متأخرة', status: 'وقت إضافي اترفض', paid: 0 },
      { id: 'OT-0016', member: 'M08', date: '2026-10-19', start: '17:00', end: '18:30', minutes: 90, note: 'كتالوج زان', status: 'اتضاف', paid: 90, by: 'سارة أحمد' },
      { id: 'OT-0012', member: 'M08', date: '2026-10-13', start: '17:00', end: '20:00', minutes: 180, note: 'تسجيل يدوي — سارة أحمد', status: 'اتضاف', paid: 180, by: 'سارة أحمد' },
      { id: 'OT-0011', member: 'M05', date: '2026-10-12', start: '18:00', end: '20:30', minutes: 150, note: 'تصوير حملة الخريف', status: 'اتضاف', paid: 150, by: 'سارة أحمد' },
      { id: 'OT-0009', member: 'M02', date: '2026-10-08', start: '17:00', end: '23:00', minutes: 360, note: 'تجهيز أوردرات الحملة', status: 'اتضاف', paid: 360, by: 'صفوت كمال' },
      { id: 'OT-0007', member: 'M03', date: '2026-10-06', start: '17:00', end: '17:15', minutes: 15, note: 'إغلاق تذكرة عاجلة', status: 'اتضاف', paid: 15, by: 'سارة أحمد' },
    ],
    restWork: [{ member: 'M05', date: '2026-10-10', note: 'تصوير منتجات — بموافقة الأدمن' }, { member: 'M08', date: '2026-10-17', note: 'جرد مخزن — بموافقة الأدمن' }],
    adjustments: [{ member: 'M07', label: 'غياب', amount: -250 }, { member: 'M08', label: 'قسط سُلفة', amount: -500 }],
    scores: { // monthly KPI score % — Q3 (Figma 370:3772)
      M02: { 7: 104, 8: 98, 9: 101 }, M03: { 7: 92, 8: 88, 9: 95 }, M04: { 7: 78, 8: 81, 9: 86 }, M05: { 7: 110, 8: 105, 9: 112 },
      M06: { 7: 96, 8: 100, 9: 97 }, M07: { 7: 72, 8: 65, 9: 61 }, M08: { 7: 100, 8: 94, 9: 99 },
    },
    // KPI detail (Figma: يوسف طارق — سبتمبر 2026)
    kpis: [{ name: 'أوردرات اتغلّفت في نفس يوم التأكيد', src: 'من الأوردرات', weight: 40, target: '95%', actual: '70%', ach: 73.7 }, { name: 'أخطاء تغليف / مرتجعات بسبب التغليف', src: 'من خدمة العملاء', weight: 30, target: '≤ 2', actual: '4', ach: 50 }, { name: 'الالتزام بالحضور', src: 'من الحضور', weight: 15, target: '100%', actual: '70%', ach: 70 }, { name: 'تقييم المدير', src: 'يدوي', weight: 15, target: '5 / 5', actual: '2 / 5', ach: 40 }],
    extras: [{ member: 'M02', rule: 'ربع بدون أوردر متأخر', amount: 300, status: 'جاهز للاعتماد' }, { member: 'M05', rule: 'تفوق ≥ 110%؟', amount: 500, status: 'مكافأة محتاجة قرار' }],
    achievements: [{ member: 'M05', title: 'تصوير 120 منتج في أسبوع', amount: 750, date: '2026-10-08', status: 'اتصرفت' }, { member: 'M02', title: 'صفر تأخير في أوردرات سبتمبر', amount: 300, date: '2026-10-02', status: 'اتصرفت' }],
    meetings: [
      { id: 'MT-07', member: 'M07', reason: 'ربع سيئ 66% + إنذارين (أغسطس، سبتمبر)', status: 'مطلوب', date: null, time: null, plan: '—', review: '—' },
      { id: 'MT-06', member: 'M03', reason: 'وقت إضافي متضافش — 14 أكتوبر 17:00 ← 20:00 (3:00)', status: 'اتحدد ميعاد', date: '2026-10-22', time: '10:00', place: 'المكتب', plan: '— (بعد الميتنج)', review: '—' },
      { id: 'MT-05', member: 'M04', reason: 'محتاج تحسين 3 شهور متتالية (طلب يدوي)', status: 'اتعمل — خطة شغالة', date: '2026-10-05', time: '11:00', place: 'المكتب', plan: '3 أهداف · 1 من 3 اتحقق', review: '31 أكتوبر', progress: 33,
        goals: [{ t: 'متابعة كل أوردر فرعي متأخر خلال 24 ساعة', s: 'جاري', how: 'تلقائي من التأخير · الحالي 78% من 95%' }, { t: 'تقليل الأوردرات المتأخرة عند مبتكرينها من 9 لـ 4', s: 'جاري', how: 'تلقائي · الحالي 6' }, { t: 'تقرير أسبوعي للمدير عن المبتكرين المتأخرين', s: 'اتحقق', how: 'يدوي · 3 تقارير اتسلمت' }],
        support: 'سارة أحمد تراجع معاها قايمة المتأخرات كل أحد', notes: 'الضغط من 3 مبتكرين بيتأخروا دايمًا (زان، W&R، روفيدة).' },
      { id: 'MT-03', member: 'M05', reason: 'إنذار يونيو (تأخير تسليم صور)', status: 'اتقفلت — اتحسّن', date: '2026-07-03', time: '—', place: 'أونلاين', plan: '2 من 2 اتحققوا', review: '14 أغسطس ✓' },
    ],
    sheet: { month: '2026-10', status: 'مسودة' },
    otPeriods: [{ range: '1 – 31 أكتوبر 2026', scope: 'كل الفريق', count: true, by: 'صفوت كمال · 1 أكتوبر' }, { range: '1 – 15 نوفمبر 2026', scope: 'كل الفريق', count: false, by: 'صفوت كمال · 18 أكتوبر' }, { range: '1 – 30 سبتمبر 2026', scope: 'كريم سامي بس', count: true, by: 'سارة أحمد · 1 سبتمبر' }],
    bonusRules: [{ name: 'مكافأة تفوق', cond: 'سكور الربع ≥ 110%', amount: 500, on: true }, { name: 'مكافأة تفوق عالي', cond: 'سكور الربع ≥ 120%', amount: 1000, on: true }, { name: 'ربع بدون أوردر متأخر', cond: '0 متأخرات في مسؤوليته', amount: 300, on: true }, { name: 'أعلى تقييم خدمة عملاء', cond: 'أعلى CSAT في الربع ≥ 4.8', amount: 300, on: true }],
    hrSettings: { shiftEnd: true, presence: true, presenceEvery: 120, confirmBy: 'المدير المباشر', escalate: 24, countOT: true, lateGrace: 15, lateDeduct: false, autoMissing: true, probation: 3, salaryViewers: 'المالك + المحاسب', hideAmounts: true, holdbackDefault: 1000, bonusFloor: 70 },
    activity: [],
    tasks: [
      { id: 1, title: 'تأكيد 3 أوردرات غير مؤكدة', auto: true, member: 'M01', link: '#orders', day: '2026-10-21' },
      { id: 2, title: 'الرد على تذكرة TKT-2043 (عاجل)', auto: true, member: 'M01', link: '#tickets/TKT-2043', day: '2026-10-21' },
      { id: 3, title: 'مراجعة طلب إجازة منى حسن', auto: true, member: 'M01', link: '#profile-requests', day: '2026-10-21' },
      { id: 11, title: 'تجهيز عرض الموردين الجدد', status: 'جاري', day: '2026-10-20', member: 'M01' },
      { id: 12, title: 'مكالمة مع شركة الشحن بخصوص الأسعار', status: 'لسه', day: '2026-10-21', member: 'M01' },
      { id: 13, title: 'مراجعة صور منتجات W&R', status: 'جاهزة للمراجعة', reviewer: 'سارة أحمد', day: '2026-10-21', member: 'M01' },
      { id: 14, title: 'تحديث سياسة المرتجعات على الموقع', status: 'متوقفة', reason: 'مستني رد المحامي', day: '2026-10-21', member: 'M01' },
      { id: 15, title: 'خطة محتوى نوفمبر', status: 'اتأجلت', until: null, day: '2026-10-18', member: 'M01' },
      { id: 16, title: 'إرسال فواتير سبتمبر للموردين', status: 'خلصت', day: '2026-10-21', member: 'M01' },
      { id: 17, title: 'اجتماع فريق المخزن', status: 'اتأجلت', until: '2026-10-21', day: '2026-10-19', member: 'M01' },
      { id: 4, title: 'الرد على 5 تذاكر مفتوحة', auto: true, member: 'M03', link: '#tickets', day: '2026-10-21' },
      { id: 21, title: 'متابعة عملاء الأوردرات غير المؤكدة', status: 'جاري', day: '2026-10-20', member: 'M03' },
      { id: 22, title: 'تحديث ردود الواتساب الجاهزة', status: 'لسه', day: '2026-10-21', member: 'M03' },
      { id: 23, title: 'تقرير شكاوى سبتمبر', status: 'خلصت', day: '2026-10-21', member: 'M03' },
    ],
    // inventory hub (Figma 314:3387). Every lot: reason / status / next step / age. Quantities come from the ledger (key = lot).
    stock: [
      { key: 'L-PD-549', sku: 'IBTB0CJR7XWC9', name: 'Photo Display', vendor: 'Rufaida', reason: 'مرتجع', status: 'بانتظار الفحص', ref: '#180549', since: '2026-10-20', loc: 'R-01', cost: 450, mode: 'أمانة' },
      { key: 'L-CB-10', sku: 'IBTB0CH77ZQ1', name: 'Crochet Basket', vendor: 'HANDS', reason: 'تصوير', status: 'مستني تصوير', ref: null, since: '2026-10-10', loc: 'P-02', cost: 260 },
      { key: 'L-ML-05', sku: 'IBTH3080BHLML000038', name: 'Macrame Lantern Set', vendor: 'W&R', reason: 'تصوير', status: 'اتصور', ref: null, since: '2026-10-05', loc: 'P-01', cost: 540 },
      { key: 'L-WH-SALE', sku: 'IBTKSC3535DSWW000018', name: 'Wall hanging', vendor: 'zaan', reason: 'متاح للبيع', status: 'محجوز لأوردر', ref: 'IB-180655', since: '2026-09-02', loc: 'C-02', cost: 310, mode: 'أمانة' },
      { key: 'L-MF-A01', sku: 'IBTB0CTBMCWLM', name: 'Macrame Feathers', vendor: 'Antikiano', reason: 'متاح للبيع', status: 'متاح', ref: null, since: '2026-08-01', loc: 'A-01', cost: 380, mode: 'ملك' },
      { key: 'L-WH-602', sku: 'IBTKSC3535DSWW000018', name: 'Wall hanging', vendor: 'zaan', reason: 'مرتجع', status: 'بانتظار الفحص', ref: '#180602', since: '2026-10-20', loc: 'R-01', cost: 310, mode: 'أمانة' },
      { key: 'L-MWD-470', sku: 'IBTAMWDM120X100078', name: 'Macrame Wall Decor', vendor: 'Antikiano', reason: 'متاح للبيع', status: 'متاح', ref: null, since: '2026-10-12', loc: 'A-03', cost: 420, mode: 'أمانة' },
    ],
    // returns log (Figma 384:50221)
    returns: [
      { name: 'Photo Display', vendor: 'Rufaida', mode: 'أمانة', sub: '#180549', type: 'مرتجع للمخزن', reason: 'العميل رفض الاستلام', at: 'أمس 12:10', status: 'بانتظار الفحص', effect: '+ 1 بعد الفحص', key: 'L-PD-549' },
      { name: 'Wall hanging', vendor: 'zaan', mode: 'أمانة', sub: '#180602', type: 'مرتجع للمخزن', reason: 'مقاس غلط', at: '20 أكتوبر', status: 'بانتظار الفحص', effect: '+ 1 بعد الفحص', key: 'L-WH-602' },
      { name: 'Macrame Feathers', vendor: 'Antikiano', mode: 'ملك ابتكر', sub: '#180498', type: 'مرتجع للمخزن', reason: 'فيه عيب', at: '17 أكتوبر', status: 'اتفحص — تالف', effect: '− تالف 380.00 ج', value: 380 },
      { name: '5Pcs Plant Hangers', vendor: 'HANDS', mode: 'ملك ابتكر', sub: '#180501', type: 'مرتجع للمورد', reason: 'عيب خياطة', at: '18 أكتوبر', status: 'اتسلم للمورد', effect: 'نصيب HANDS اتلغى' },
      { name: 'Macrame Wall Decor', vendor: 'Antikiano', mode: 'أمانة', sub: '#180470', type: 'مرتجع للمخزن', reason: 'العميل غيّر رأيه', at: '12 أكتوبر', status: 'اتفحص — سليم', effect: '+ 1 متاح', key: 'L-MWD-470' },
    ],
    ledger: [ // newest first (Figma 384:49812); system rows from orders are added at load
      { at: '2026-10-21 13:05', key: 'L-WH-SALE', type: 'reserve', qty: 2, label: 'حجز لأوردر', reason: 'متاح للبيع', ref: 'IB-180655', by: 'السيستم (تلقائي)', note: 'سحب تلقائي' },
      { at: '2026-10-20 12:10', key: 'L-PD-549', type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#180549', by: 'هبة محمود', note: 'بانتظار الفحص' },
      { at: '2026-10-20 11:30', key: 'L-WH-602', type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#180602', by: 'هبة محمود', note: 'بانتظار الفحص' },
      { at: '2026-10-18 10:00', key: 'L-PH-501', type: 'out', qty: 2, label: 'رجوع للمبتكر', reason: 'مرتجع', ref: '#180501', by: 'سارة أحمد', note: 'عيب خياطة', name: '5Pcs Plant Hangers', sku: 'IBTB0CLJXDYT5' },
      { at: '2026-10-17 15:00', key: 'L-MF-498', type: 'out', qty: 1, label: 'تالف', reason: 'مرتجع', ref: 'فحص #180498', by: 'هبة محمود', note: 'مكسورة في الشحن', name: 'Macrame Feathers', sku: 'IBTB0CTBMCWLM' },
      { at: '2026-10-14 12:00', key: 'L-ML-05', type: 'move', qty: 0, label: 'تحويل للبيع', reason: 'قرار بعد التصوير', ref: 'تصوير ← للبيع', by: 'صفوت كمال', note: 'أمانة من W&R' },
      { at: '2026-10-12 13:00', key: 'L-MWD-470', type: 'in', qty: 1, label: 'دخول — مرتجع', reason: 'مرتجع', ref: '#180470', by: 'هبة محمود', note: 'اتفحص — سليم ← متاح' },
      { at: '2026-10-10 11:00', key: 'L-CB-10', type: 'in', qty: 3, label: 'دخول — تصوير', reason: 'تصوير', ref: '—', by: 'سارة أحمد', note: 'من HANDS للتصوير' },
      { at: '2026-10-05 10:00', key: 'L-ML-05', type: 'in', qty: 1, label: 'دخول — تصوير', reason: 'تصوير', ref: '—', by: 'سارة أحمد', note: 'من W&R للتصوير' },
      { at: '2026-09-02 10:00', key: 'L-WH-SALE', type: 'in', qty: 2, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: '—', by: 'سارة أحمد', note: 'أمانة من zaan' },
      { at: '2026-08-01 10:00', key: 'L-MF-A01', type: 'in', qty: 2, label: 'دخول — للبيع', reason: 'متاح للبيع', ref: '—', by: 'صفوت كمال', note: 'ملك ابتكر' },
    ],
    consolidations: [ // linked to real orders at load (orders opsLink)
      { order: '180662', customer: '', subs: [], since: '2026-10-18', zone: 'T-01', by: 'سارة أحمد' },
      { order: '', customer: '', subs: [], since: '2026-10-17', zone: 'T-02', by: 'سارة أحمد' },
      { order: '', customer: '', subs: [], since: '2026-10-14', zone: 'T-03', by: 'صفوت كمال' },
    ],
    // active stock count (Figma 384:50691) + history
    count: { id: 'CNT-08', zone: 'رف B', started: '2026-10-21 09:30', total: 48, base: 28, lines: [
      { sku: 'IBTB0CJR7XWC9', name: 'Photo Display', loc: 'B-04', system: 5, counted: '4', cost: 450, note: 'مش لاقيين واحدة' },
      { sku: 'IBTB0CLJXDYT5', name: '5Pcs Plant Hangers', loc: 'B-01', system: 0, counted: '0', cost: 300, note: '' },
      { sku: 'IBTB0D2KQ8M3', name: 'Beaded Coasters Set', loc: 'B-02', system: 6, counted: '7', cost: 220, note: 'لقينا واحدة في كرتونة المرتجعات' },
      { sku: 'IBTB0C9XX41P', name: 'Resin Tray', loc: 'B-03', system: 3, counted: '3', cost: 280, note: '' },
      { sku: 'IBTB0CH77ZQ1', name: 'Crochet Basket', loc: 'B-05', system: 4, counted: '', cost: 260, note: '' }] },
    counts: [{ id: 'CNT-07', date: '2026-10-01', zone: 'كل المخزن', by: 'يوسف طارق', items: 2, value: -330, status: 'اتعتمد' }],
    racks: [{ code: 'رف A', desc: 'ديكور حائط ومكرميه', products: 14, pieces: 96 }, { code: 'رف B', desc: 'إكسسوارات وهدايا صغيرة', products: 18, pieces: 121 }, { code: 'رف C', desc: 'مفروشات ومنسوجات', products: 9, pieces: 58 }, { code: 'رف D', desc: 'أطقم وقطع كبيرة', products: 7, pieces: 37 }],
    invSettings: { firstWarehouse: true, reserveAt: 'إنشاء الأوردر', deductAt: 'شحن الأوردر الفرعي', autoRelease: true, pullAlert: true, zone: 'T — منطقة التجميع', consolidationAlert: 5, partial: true, photoMax: 14, photoDefault: 'يرجع للمبتكر', minQty: 2, lowAlert: true, stale: 90, inspect: true, returnOwner: 'بنفس ملكية الأوردر الأصلي', vendorReturn: 'يتلغي (من غير خصم إضافي)', wooSync: true, onDemand: 'مش متتبعة' },
    notices: [],
    // owner 22 Oct: accounts alerts settings + custom task reports (digests)
    // owner 22 Oct: alerts by role — matrix overrides (defaults live in notifroles.js), per-member overrides, personal prefs, role digests
    alertRoles: {}, alertOverrides: {}, notifPrefs: {}, roleDigests: {},
    accAlerts: { payDay: 1, lead: 14, anchor: '2026-09-05', cycle: 'monthDays', days: [16, 'last'] },
    vendorWeekly: { weekday: 'الأحد', at: '10:00 ص' }, // owner 22 Oct: weekly vendor report
    delivery: { company: 'بوسطة', owner: 'M07', whName: 'مخزن إبتكر', whAddress: 'القاهرة، مصر', whPhone: '01000000000' }, // owner 22 Oct: Bosta waybills
    digests: [
      { id: 'DG-01', name: 'مهام خدمة العملاء اليومية', keys: ['customers.late', 'customers.unconf', 'customers.waiting', 'customers.follow', 'messages.waiting'], to: ['خدمة العملاء'], every: 'يوميًا', at: '12:00 ص', ch: 'داخل السيستم + واتساب', on: true },
      { id: 'DG-02', name: 'متابعة الموردين اليومية', keys: ['vendors.late', 'vendors.risk', 'accounts.vendors'], to: ['متابعة الموردين'], every: 'يوميًا', at: '12:00 ص', ch: 'داخل السيستم', on: true },
      { id: 'DG-03', name: 'ملخص الأدمن الأسبوعي', keys: ['accounts.payroll', 'accounts.vendors', 'tasks.urgent', 'tasks.high', 'team.req', 'stock.cons'], to: ['أدمن'], every: 'أسبوعيًا (السبت)', at: '12:00 ص', ch: 'داخل السيستم + إيميل', on: true }],
  };
  // attendance history: هبة محمود exactly as Figma 365:1134; others generated (8h days, a few late)
  (function () {
    const H = (d, type, i, o, st, note, ot) => ({ member: 'M08', date: d, type, in: i, out: o, ot: ot || 0, late: st && st.startsWith('متأخر') ? 25 : 0, status: st, src: note });
    store.attendance.push(H('2026-10-21', 'يوم عمل', 550, null, 'حاضر', 'تسجيل من السيستم'), H('2026-10-20', 'يوم عمل', 545, null, 'انصراف ناقص', 'طلب تصحيح HR-0154 قيد المراجعة'), H('2026-10-19', 'يوم عمل', 538, 1108, 'وقت إضافي اتضاف', 'كتالوج زان · أكّدته سارة', 90),
      H('2026-10-18', 'يوم عمل', 565, 1050, 'متأخر 25 د', '—'), H('2026-10-17', 'راحة أسبوعية', 660, 900, 'شغل يوم راحة', 'جرد مخزن — بموافقة الأدمن'), H('2026-10-16', 'راحة أسبوعية', null, null, 'راحة', '—'), H('2026-10-15', 'يوم عمل', 540, 1020, 'منتظم', '—'),
      H('2026-10-14', 'إجازة سنوية', null, null, 'إجازة', 'طلب HR-0141 موافق'), H('2026-10-13', 'يوم عمل', 540, 1200, 'منتظم', 'تسجيل يدوي — سارة أحمد', 180));
    const days = []; let d = '2026-10-20'; while (days.length < 10) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w !== 5 && w !== 6) days.push(d); d = O.addDays(d, -1); }
    let k = 0;
    store.members.filter((m) => m.id !== 'M08').forEach((m) => days.forEach((day) => {
      k++; const start = m.shift[0] === '10:00' ? 600 : 540; const late = k % 9 === 0 ? 20 : 0;
      store.attendance.push({ member: m.id, date: day, type: 'يوم عمل', in: start + late, out: start + late + 480, ot: 0, late, status: late ? 'متأخر ' + late + ' د' : 'منتظم', src: k % 7 === 0 ? 'تسجيل يدوي — سارة أحمد' : 'تسجيل من السيستم' });
    }));
  })();
  const member = (id) => store.members.find((m) => m.id === id) || { name: '—' };
  const team = () => store.members.filter((m) => m.id !== 'M01' && m.status === 'active');
  function stockNow() { const s = O.stockFromLedger(store.ledger.map((m) => ({ sku: m.key, type: m.type === 'move' ? 'none' : m.type, qty: m.qty }))); return store.stock.map((x) => Object.assign({}, x, s[x.key] || { onHand: 0, reserved: 0, available: 0 })); }
  function notify(n) { store.notices.unshift(Object.assign({ at: clockNow() }, n)); document.dispatchEvent(new CustomEvent('ib:notify')); }

  // ---------- page registry: app.js routes hashes to these and gives each a <main id="pg-ID"> ----------
  const pages = {};
  window.IBPages = {
    current: null, all: () => pages,
    register(id, def) { pages[id] = def; },
    match(hs) { for (const id of Object.keys(pages)) if (pages[id].hash(hs)) return id; return null; },
    render(id, keepScroll = true) {
      const def = pages[id]; const main = document.getElementById('pg-' + id); if (!def || !main) return;
      U.closePopover(); const sc = window.scrollY; main.replaceChildren(...def.view().filter(Boolean)); if (keepScroll) window.scrollTo(0, sc);
    },
  };

  window.IBKit = { TODAY, NOW_MIN, ME, setMe, money, n0, dlabel, dshort, dayName, hm, hrs, daysBetween, AR_MON, Tag, PageHead, SubTabs, MainTabs, Section, Switch, Checkbox, Radios, Accordion, RowMenu, Kv, Stat, Empty, Num, toast, form, confirm, field, two, req, store, member, team, stockNow, logEvent, notify, clockNow };
})();

