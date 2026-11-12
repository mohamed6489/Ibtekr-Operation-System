
/* Shared pieces for the new modules (HR, inventory, settings, profile, login). Built on IBUI; one function per Figma component.
   Also holds the in-memory ops store shared between modules (team, attendance, requests, overtime queue, stock ledger, tasks). */
(function () {
  'use strict';
  const U = window.IBUI, D = window.IbtekrDomain, O = window.IbtekrOps;
  const { h, Icon, Button, IconButton } = U;
  const TODAY = '2026-10-21';
  const cairoDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
    const card = h('section', { class: 'card sec' + (opts.cls ? ' ' + opts.cls : '') }, title || actions ? h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, title), opts.sub ? h('div', { class: 't-small sub' }, opts.sub) : null), h('div', { class: 'acts' }, actions || null)) : null, h('div', { class: 'sec-b' }, body));
    return opts.cols === false ? card : withColumns(card, title ? 'sec:' + title : '', title, opts.rerender);
  }
  // الجدول القياسي (owner 28 Oct — phase 6 brought it from the v2 kit): كارت فيه تايتل + sub وأزرار، وتحتيهم الجدول بترويسة خضرا فل-بليد (tbl-v2)
  function TableSection({ title, sub, actions, body, cls, rerender }) {
    return Section(title, body, actions, { sub, cls: 'tbl-v2' + (cls ? ' ' + cls : ''), rerender });
  }
  function Switch({ id, label, checked, onChange, help, disabled }) {
    const b = h('button', { type: 'button', role: 'switch', id, class: 'sw', 'aria-checked': String(!!checked), 'aria-label': label, disabled, onClick: () => onChange(!checked) }, h('i'));
    return h('div', { class: 'sw-row' }, h('div', { class: 'sw-txt' }, h('label', { for: id, class: 't-label' }, label), help ? h('div', { class: 't-small help' }, help) : null), b);
  }
  function Checkbox({ label, checked, onChange, disabled, small }) {
    return h('button', { type: 'button', role: 'checkbox', class: 'cb' + (small ? ' sm' : ''), 'aria-checked': String(!!checked), disabled, onClick: () => onChange(!checked) }, h('i', null, checked ? Icon('check', 'sm') : null), label ? h('span', null, label) : null);
  }
  // phase 6 (from the v2 kit): error / required / option hints — the message under the group was missing here
  function Radios({ label, options, value, onChange, name, error, required }) {
    const g = h('div', { class: 'radios' + (error ? ' err' : ''), role: 'radiogroup', 'aria-label': label || name, 'aria-invalid': error ? 'true' : false });
    options.forEach((o) => g.append(h('button', { type: 'button', role: 'radio', class: 'radio', 'aria-checked': String(o.value === value), onClick: () => onChange(o.value) }, h('i'), h('span', null, o.label), o.hint ? h('small', { class: 't-small help' }, o.hint) : null)));
    const err = error ? h('p', { class: 'ferr t-small', role: 'alert' }, error) : null;
    const out = label ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, label + (required ? ' *' : '')), g) : g; if (err) out.append(err);
    return out;
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
  // ---------- «بيحصل إيه دلوقتي» (the owner, 11 Nov — «اي اكشن بيتعمله تحميل او بيقولي استني … يظهرلي popup notification يعرفني
  // اي اللي بيحصل … تحت خالص ف النص»): a pill per running action at the bottom centre, just above the toast — a spinner and what
  // is happening. done(text, kind) turns it into the result for a moment (✓ / !), close() takes it away; several stack. A pill
  // shown is kept at least MIN_SHOWN so a quick answer never flashes; a running one closes itself after 6 minutes without news
  // (set() is news — a long batch keeps it). The stack is aria-live (polite) without a status role, so the toast keeps the page's
  // own [role=status].
  let busyEl = null, busyOpen = 0;
  const BUSY_MIN_SHOWN = 700, BUSY_MAX = 360000;
  function busy(text) {
    if (!busyEl || !busyEl.isConnected) { busyEl = h('div', { class: 'busy-stack', 'aria-live': 'polite' }); document.body.append(busyEl); }
    const txt = h('span', { class: 'busy-txt' }, String(text || 'جاري التنفيذ…'));
    const el = h('div', { class: 'busy-pill run', 'data-busy': 'run' }, h('span', { class: 'busy-ico', 'aria-hidden': 'true' }), txt);
    busyEl.append(el); busyOpen += 1;
    const shownAt = Date.now(); let t = 0, closed = false, ended = false;
    requestAnimationFrame(() => { if (!closed) el.classList.add('show'); });
    const close = () => {
      if (closed) return; closed = true; clearTimeout(t); if (!ended) busyOpen = Math.max(0, busyOpen - 1);
      const wait = Math.max(0, BUSY_MIN_SHOWN - (Date.now() - shownAt));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, wait);
    };
    const end = (msg, kind) => {
      if (closed) return; if (!ended) { ended = true; busyOpen = Math.max(0, busyOpen - 1); }
      const k = kind === 'error' ? 'err' : kind === 'warning' ? 'warn' : 'ok';
      el.className = 'busy-pill show ' + k; el.dataset.busy = k; if (msg) txt.textContent = String(msg);
      clearTimeout(t); t = setTimeout(close, k === 'ok' ? 4000 : 7000);
    };
    t = setTimeout(close, BUSY_MAX);
    const set = (m) => { if (closed || ended) return; txt.textContent = String(m); clearTimeout(t); t = setTimeout(close, BUSY_MAX); };
    return { set, done: (m, kind) => end(m, kind || 'success'), fail: (m) => end(m, 'error'), close };
  }
  const busyCount = () => busyOpen; // running pills (the adapters' automatic pill waits while a page shows its own)

  // ---------- form modal: keeps values on error, validates inline, focuses first error ----------
  function form({ title, values, fields, validate, submit, submitLabel = 'حفظ', submitType = 'primary', cancelLabel = 'إلغاء', wide, extraFooter, note, onClose }) {
    const f = Object.assign({}, values || {}); let errs = {}; let m = null;
    const set = (k, v, redraw) => { f[k] = v; if (errs[k]) { delete errs[k]; redraw = true; } if (redraw) draw(); };
    function draw() {
      m.setBody(...[note ? (typeof note === 'function' ? note(f) : note) : null].concat([].concat(fields(f, errs, set, draw))).filter(Boolean));
      m.setFooter(...[extraFooter ? extraFooter(f, m) : null, Button({ label: cancelLabel, onClick: () => m.close() }), Button({ type: submitType, label: typeof submitLabel === 'function' ? submitLabel(f) : submitLabel, onClick: go })].filter(Boolean));
    }
    function go() {
      if (m._busy) return; // phase 13 decision 13: a second click (or Enter) while the page's busy() awaits the first submit is ignored
      errs = validate ? (validate(f) || {}) : {};
      if (Object.keys(errs).length) { draw(); const first = m.el.querySelector('[aria-invalid=true],.err'); if (first && first.focus) first.focus(); return; }
      const r = submit(f, m); if (r !== false) m.close();
    }
    m = U.Modal({ title, body: [], footer: [], onClose }); if (wide) m.el.classList.add(wide === true ? 'wide' : wide); draw();
    // phase 10 decision 18 (b): the first field a tick after the form opens — unless a field inside it already has the focus (on a busy page
    // the tick came late and took the focus mid-typing, so the text landed in the first field)
    setTimeout(() => { const b = m.el.querySelector('.modal-b'); const a = document.activeElement; if (b && a && a !== b && b.contains(a)) return; const i = m.el.querySelector('.modal-b input,.modal-b textarea,.modal-b button'); if (i) i.focus(); });
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
    // the owner 11 Nov: «اليوم الحالي» and the calendar's today mark are the real day in Cairo, not the prototype's fixed TODAY
    date: (id, label, f, errs, set, o = {}) => U.DateField(Object.assign({ id, label, value: f[id], error: errs[id], today: cairoDay(), onChange: (v) => set(id, v, true) }, o)),
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
    tasks: [], // «ملفي › مهامي» is on the server (IBHR.data.tasks — hr_tasks, phase 10 decision 25); the demo rows are gone
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
      stdTables(main); // the standard table right away (no beige header for a frame); the columns sweep stays after the render
      setTimeout(() => sweepColumns(main), 0);
    },
  };

  // ---------- أعمدة أي جدول: إظهار/إخفاء + ترتيب (owner 27 Oct — «في كل الجداول اللي في السيستم»; phase 4.1) ----------
  // بتشتغل على أي <table> فيه thead من غير ما نلمس الكود اللي بيبنيه: بنقرا عناوين الأعمدة ونرتّب الخلايا بيها.
  // phase 4.1 (plan decision 7): the choice is per member in user_prefs ('table.cols' = { [tableKey]: { order, hidden } },
  // IBPrefs); before IBPrefs has loaded (or signed out) the kit's store keeps it for this device.
  const COLS_PREF = 'table.cols';
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 64) : []);
  function colAll() {
    const saved = window.IBPrefs && window.IBPrefs.get(COLS_PREF);
    const all = (store.colPrefs = store.colPrefs || {});
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) all[ME] = saved;
    return (all[ME] = all[ME] || {});
  }
  const colPrefs = (key) => { const p = colAll()[key]; return p && typeof p === 'object' ? { order: strList(p.order), hidden: strList(p.hidden) } : { order: [], hidden: [] }; };
  const colWrite = (key, v) => { const next = Object.assign({}, colAll()); if (v) next[key] = v; else delete next[key]; (store.colPrefs = store.colPrefs || {})[ME] = next; if (window.IBPrefs) window.IBPrefs.set(COLS_PREF, next); };
  const colHeads = (t) => [...t.querySelectorAll(':scope > thead > tr > th')].map((th) => (th.textContent || '').trim());
  const autoState = (key) => { const all = (store.autoF = store.autoF || {}); return (all[key] = all[key] || { f: {}, sort: '' }); };
  const cellTxt = (td) => (td ? (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const numOf = (x) => { const v = x.replace(/ج\.م|%|,|\+|\s/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); return /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : null; };
  const dateOf = (x) => { let m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); m = x.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };
  // moving a node blurs it (a field being typed in loses the text — the variations' prices on CI, 6 Nov): a table's own helpers move
  // cells / rows only when their order really changes, and give the focus (and the caret) back to the field that had it
  function keepFocus(root, fn) {
    const a = document.activeElement; const inside = !!(a && a !== document.body && root && root.contains(a)); let s = null, e = null;
    if (inside) { try { s = a.selectionStart; e = a.selectionEnd; } catch (x) { s = null; } }
    fn();
    if (inside && a.isConnected && document.activeElement !== a) { try { a.focus({ preventScroll: true }); if (s != null) a.setSelectionRange(s, e); } catch (x) { /* not a text field */ } }
  }
  function applyColumnPrefs(key, table) {
    if (!table) return; const p = colPrefs(key); const heads = colHeads(table); if (!heads.length) return;
    const rank = (lb, i) => { const k = p.order.indexOf(lb); return k < 0 ? 1000 + i : k; };
    const order = heads.map((lb, i) => ({ lb, i, r: i === 0 ? -1 : rank(lb, i) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const moved = order.some((o, k) => o.i !== k);
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
    keepFocus(table, () => {
      for (const tr of rows) {
        const cells = [...tr.children];
        if (cells.length !== heads.length) continue; // صف مدموج (زي صف إجمالي بخلية واحدة) — سيبه زي ما هو
        if (moved) order.forEach((o) => tr.append(cells[o.i]));
        order.forEach((o) => { cells[o.i].hidden = o.i !== 0 && p.hidden.includes(o.lb); });
      }
    });
  }
  function customizeColumns(key, label, table, done) {
    if (!table) { toast('مفيش جدول هنا'); return; }
    const p = colPrefs(key); const heads = colHeads(table);
    const rank = (lb, i) => { const k = p.order.indexOf(lb); return k < 0 ? 1000 + i : k; };
    const list = heads.map((lb, i) => ({ id: lb, label: lb || '—', hidden: i !== 0 && p.hidden.includes(lb), fixed: i === 0 && !!lb, r: i === 0 ? -1 : rank(lb, i), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i);
    form({ title: 'أعمدة الجدول — ' + label, wide: true, values: { list },
      note: U.InlineNote({ children: 'اختار الأعمدة اللي تظهر ورتّبها بالسحب من المسكة اللي جنب الاسم. التخصيص بيتحفظ ليك انت بس ولكل جدول لوحده. العمود الأول ثابت: مينفعش يتخفي ولا يتحرك من أوله.' }),
      // phase 13 decision 50 (owner 10 Nov): the order by dragging the six-dot grip (like «تخصيص اللوحة»), no up / down arrows; the first
      // column stays fixed (no grip, it never moves); the grip's arrow keys still move a row for the keyboard
      fields: (f, e, set) => { const wrap = h('div', { class: 'dash-cust cols-cust', role: 'list' }, f.list.map((c, i) => h('div', { class: 'dc-row', role: 'listitem', 'data-col-item': c.id, 'data-fixed': c.fixed ? '1' : null },
        c.fixed ? h('span', { class: 'dc-grip-sp', 'aria-hidden': 'true' }) : Grip(c.label),
        h('span', { class: 'dc-l' }, h('b', null, c.label), c.fixed ? h('small', { class: 't-small help' }, 'ثابت') : null),
        Switch({ id: 'colc-' + i, label: c.label, checked: !c.hidden, disabled: c.fixed, onChange: (v) => { c.hidden = !v; set('list', f.list.slice(), true); } }))));
        sortableRows(wrap, 'data-col-item', (ids) => set('list', ids.map((id) => f.list.find((x) => x.id === id)).filter(Boolean), true));
        return [wrap, e.list ? U.InlineNote({ kind: 'error', children: e.list }) : null]; },
      validate: (f) => (f.list.some((c) => !c.hidden) ? {} : { list: 'سيب عمود واحد على الأقل ظاهر' }),
      extraFooter: (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'text', label: 'رجوع للافتراضي', attrs: { 'data-col-reset': '' }, onClick: () => { colWrite(key, null); toast('رجعت الأعمدة للافتراضي'); m.close(); if (done) done(); } })),
      submitLabel: 'حفظ', submit: (f) => { colWrite(key, { order: f.list.map((c) => c.id), hidden: f.list.filter((c) => c.hidden).map((c) => c.id) });
        logEvent('table.columns', label + ' · ' + f.list.filter((c) => !c.hidden).length + ' عمود'); toast('اتحفظت الأعمدة', 'success'); if (done) done(); } });
  }
  // بتمشي على كل كروت الصفحة وتضيف زرار «الأعمدة» لأي جدول من 4 أعمدة فأكتر (owner 27 Oct)
  // الشكل القياسي لكل جداول السيستم (prototype 28 Oct — صاحب المشروع وافق 5 نوفمبر، المرحلة 5.5 قرار 12): ترويسة خضرا + صفوف متبادلة
  // على كارت أي جدول من 3 أعمدة فأكتر برّه البوب أب والدرج — نفس قاعدة الـ prototype في sweepColumns
  function stdCard(t) {
    if (t.closest('.modal, .drawer, [role=dialog]') || colHeads(t).length < 3) return null;
    const card = t.closest('.card, .table-card, .sec, .tbl-card');
    if (card && (card.classList.contains('table-card') || card.classList.contains('sec') || card.classList.contains('card'))) card.classList.add('tbl-v2');
    return card;
  }
  // a table card that shows its empty state (the search left no rows) still holds the page's search in its row
  const emptyCards = (root) => root.querySelectorAll('.table-card, .tbl-v2, .own-filter').forEach((c) => { if (!c.querySelector('table') && !c.closest('.modal, .drawer, [role=dialog]')) tableSearch(c, null); });
  function stdTables(root) { if (root && root.querySelectorAll) { root.querySelectorAll('table').forEach((t) => { const c = stdCard(t); if (c) tableSearch(c, t); }); emptyCards(root); } }
  // the owner 12 Nov — first («خانة بحث صغيرة جمب تايتل الجدول») a small box next to the title; then the standard look for every table
  // (his mockup, «ده شكل مبدئي لكل الجداول في السيستم»): the card header holds «بحث» next to «فلتر» / «ترتيب» / the columns icon; «بحث»
  // opens a full-width search row under the header with «إغلاق» next to it (the button green while it is open, like its neighbours when
  // closed); the filter chips sit under the search, and the search looks only through the rows the filters left. A page's own search (it
  // reads the whole list, every page of it — the products, the makers, the tickets, the customers…) moves into that row as it is;
  // a page search farther away keeps the table without one; data-no-tq on a card or above it opts out.
  const tqMem = {}; // key → { q, open } for this session
  const tqOk = (x) => x && !x.closest('.menu, .modal, .drawer, [role=dialog], [data-tq-row]');
  function ownSearch(card) {
    const inCard = [...card.querySelectorAll('input[type=search]')].find(tqOk); if (inCard) return inCard;
    let s = card.previousElementSibling;
    for (let k = 0; s && k < 3; k++, s = s.previousElementSibling) { if (s.querySelector('table')) break; const x = s.matches('input[type=search]') ? s : [...s.querySelectorAll('input[type=search]')].find(tqOk); if (x) return x; }
    return null;
  }
  function tableSearch(card, t) {
    if (!card || card.querySelector('[data-tq-btn]') || card.closest('[data-no-tq]')) return;
    const head = card.querySelector(':scope>.table-title, :scope>.sec-h, :scope>.cons-h'); if (!head) return;
    const title = head.querySelector('h2, h3'); if (!title) return;
    const own = ownSearch(card);
    if (!own && (!t || !t.tBodies.length)) return; // a table card showing its empty state (no rows for the search) keeps its own search in place
    const near = card.parentElement; if (!own && near && [...near.querySelectorAll('input[type=search]')].some((x) => tqOk(x) && !card.contains(x))) return;
    const name = (title.textContent || '').trim();
    const key = own ? 'own:' + (own.getAttribute('aria-label') || own.getAttribute('placeholder') || name) : name.replace(/[\d٠-٩,.]+/g, '#') + '|' + colHeads(t).slice(0, 3).join('|');
    const mem = (tqMem[key] = tqMem[key] || { q: '', open: false });
    let inp;
    if (own) {
      // the page's own search moves in as it is (its listeners and its id stay; a focused box keeps the focus and the caret)
      inp = own; const had = document.activeElement === own; const a = own.selectionStart, b = own.selectionEnd;
      const wrap = own.closest('label.search-field, .search-field, label.search, label.tq'); const bar = (wrap || own).parentElement;
      own.classList.remove('input'); own.style.width = ''; own.style.maxWidth = '';
      own.remove(); if (wrap && !wrap.querySelector('input, select, button, textarea')) wrap.remove();
      if (bar && bar !== head && !bar.contains(t) && bar.classList.contains('toolbar') && !bar.children.length) bar.hidden = true;
      inp._tqHad = had ? [a, b] : null;
      if (own.value) mem.open = true;
    } else {
      inp = h('input', { type: 'search', autocomplete: 'off', value: mem.q });
    }
    inp.setAttribute('placeholder', own ? (own.getAttribute('placeholder') || 'ابحث عن…') : 'ابحث عن…');
    if (!inp.getAttribute('aria-label')) inp.setAttribute('aria-label', 'بحث في ' + (name || 'الجدول'));
    inp.setAttribute('data-tq', key);
    const run = () => { if (own) return; mem.q = inp.value; const q = foldAr(inp.value); const tb = card.querySelector('table'); if (!tb) return; let n = 0;
      [...tb.tBodies].forEach((bd) => [...bd.rows].forEach((r) => { if (r.classList.contains('tq-none')) return; const hit = !q || foldAr(r.textContent).includes(q); r.classList.toggle('tq-hide', !hit); if (hit && !r.classList.contains('af-hide')) n++; }));
      let none = tb.querySelector('tr.tq-none'); const msg = 'مفيش صفوف فيها «' + inp.value + '»';
      if (q && !n) { if (!none) { none = h('tr', { class: 'tq-none' }, h('td', { colspan: String(colHeads(tb).length || 1), class: 't-small help' }, msg)); tb.tBodies[0].append(none); } else none.querySelector('td').textContent = msg; } else if (none) none.remove(); };
    if (!own) inp.addEventListener('input', run);
    const btn = h('button', { type: 'button', class: 'tq-btn', 'aria-expanded': String(mem.open), 'aria-label': 'بحث في ' + (name || 'الجدول'), 'data-tq-btn': key }, Icon('search', 'sm'), h('span', null, 'بحث'));
    const row = h('div', { class: 'tq-row', 'data-tq-row': key });
    const setOpen = (v, focus) => { mem.open = v; row.hidden = !v; btn.setAttribute('aria-expanded', String(v));
      if (v) { if (focus) inp.focus(); return; }
      if (!inp.value) return; inp.value = ''; if (!own) { run(); return; }
      inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    btn.addEventListener('click', () => setOpen(!mem.open, true));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus(); } });
    row.append(h('label', { class: 'input tq-field' }, Icon('search', 'sm'), inp), Button({ type: 'text', size: 'sm', label: 'إغلاق', attrs: { 'data-tq-close': '' }, onClick: () => { setOpen(false); btn.focus(); } }));
    row.hidden = !mem.open;
    // «بحث» first among the table's controls: before the filter / the sort / the columns icon (they come after it), else at the end
    let acts = head.querySelector('.acts, .acts-inline'); if (!acts) { acts = h('div', { class: 'acts' }); head.append(acts); }
    const ctlOf = (sel) => { const x = acts.querySelector(sel); return x ? (x.closest('.pop-anchor') && acts.contains(x.closest('.pop-anchor')) ? x.closest('.pop-anchor') : x) : null; };
    const first = ctlOf('[data-fm-btn]') || ctlOf('[data-sm-btn]') || ctlOf('[data-cols]');
    if (first && first.parentElement) first.before(btn); else acts.append(btn);
    head.after(row);
    if (inp._tqHad) { const [a, b] = inp._tqHad; inp._tqHad = null; inp.focus(); try { inp.setSelectionRange(a, b); } catch (e) { /* a search box without a caret */ } }
    if (!own && inp.value) run();
  }
  function sweepColumns(root) {
    if (!root || !root.querySelectorAll) return;
    emptyCards(root);
    root.querySelectorAll('table').forEach((t) => {
      if (t.closest('.modal, .drawer, [role=dialog]')) return;
      tableSearch(stdCard(t), t);
      if (colHeads(t).length < 4) return;
      t.classList.add('sticky-col1'); // أول عمود بيفضل ثابت وانت بتسكرول عرضي (owner 27 Oct)
      const card = t.closest('.card, .table-card, .sec, .tbl-card') || t.parentElement;
      if (!card || card.querySelector('[data-cols]') || card.closest('[data-no-cols]')) return; // data-no-cols: a card that asked for no «أعمدة الجدول» (the makers log; the products overview's top-10 lists — B3), on the table's box or any card above it
      withColumns(card, '', '');
    });
  }
  // بيضيف زرار «الأعمدة» لكارت الجدول (4 أعمدة فأكتر) وبيطبّق التفضيلات بعد الرسم
  function sortableRows(wrap, attr, onEnd) {
    const rows = () => [...wrap.querySelectorAll('[' + attr + ']')];
    const ids = () => rows().map((r) => r.getAttribute(attr));
    const movable = (r) => r.dataset.fixed !== '1';
    const commit = () => { if (onEnd) onEnd(ids()); };
    wrap.querySelectorAll('[data-grip]').forEach((g) => {
      const row = g.closest('[' + attr + ']'); if (!row || !movable(row)) return;
      let dragging = false;
      g.addEventListener('pointerdown', (e) => {
        if (e.button) return;
        dragging = true; g.setPointerCapture(e.pointerId); e.preventDefault();
        row.classList.add('dragging'); wrap.classList.add('sorting');
      });
      g.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // بنحرّك الصفوف التانية حوالين الصف المسحوب — لو حرّكنا الصف نفسه الـ pointer capture بيضيع
        const others = rows().filter((r) => r !== row && movable(r));
        for (const o of others) {
          const b = o.getBoundingClientRect();
          const mid = b.top + b.height / 2;
          const below = !!(row.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (!below && e.clientY < mid) { row.parentNode.insertBefore(o, row.nextSibling); break; }
          if (below && e.clientY > mid) { row.parentNode.insertBefore(o, row); break; }
        }
      });
      const end = (e) => { if (!dragging) return; dragging = false; try { g.releasePointerCapture(e.pointerId); } catch (x) {} row.classList.remove('dragging'); wrap.classList.remove('sorting'); commit(); };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
      g.addEventListener('keydown', (e) => {
        const list = rows(); const i = list.indexOf(row); const id = row.getAttribute(attr);
        let moved = false;
        if (e.key === 'ArrowUp' && i > 0 && movable(list[i - 1])) { row.parentNode.insertBefore(row, list[i - 1]); moved = true; }
        else if (e.key === 'ArrowDown' && i < list.length - 1) { row.parentNode.insertBefore(list[i + 1], row); moved = true; }
        if (!moved) return;
        e.preventDefault(); commit();
        // الفورم بيعيد الرسم بعد الحفظ، فبنرجّع الفوكس لنفس المسكة عشان تقدر تكمّل بالكيبورد
        setTimeout(() => { const again = document.querySelector('[' + attr + '="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] [data-grip]'); if (again) again.focus(); }, 0);
      });
    });
  }
  const Grip = (label) => h('button', { type: 'button', class: 'dc-grip', 'data-grip': '', 'aria-label': 'اسحب لترتيب ' + label + ' (أو استعمل فوق وتحت)', title: 'اسحب للترتيب' }, Icon('grip', 'sm'));
  // ---------- «تخصيص اللوحة» في أي صفحة (prototype v5 — صاحب المشروع 5 نوفمبر: «دلوقتي لكل الصفحات»; phase 10 decision 22) ----------
  // بيقرا بلوكات الصفحة/التاب من الـ DOM (كروت الأرقام · الرسومات · الجداول · الأقسام)، ويرتّبها ويخفي اللي العضو مش عايزه.
  // per member in user_prefs ('panel.prefs' = { [pageKey]: { order, hidden } }, IBPrefs) like the table columns; before IBPrefs has
  // loaded (or signed out) the kit's store keeps it for this device. Nothing is removed from the page: a hidden block is `hidden`.
  const PANEL_PREF = 'panel.prefs';
  function panelAll() {
    const saved = window.IBPrefs && window.IBPrefs.get(PANEL_PREF);
    const all = (store.panelPrefs = store.panelPrefs || {});
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) all[ME] = saved;
    return (all[ME] = all[ME] || {});
  }
  const panelPrefs = (key) => { const p = panelAll()[key]; return p && typeof p === 'object' ? { order: strList(p.order), hidden: strList(p.hidden) } : { order: [], hidden: [] }; };
  const panelWrite = (key, v) => { const next = Object.assign({}, panelAll()); if (v) next[key] = v; else delete next[key]; (store.panelPrefs = store.panelPrefs || {})[ME] = next; if (window.IBPrefs) window.IBPrefs.set(PANEL_PREF, next); };
  // the block's id is its title without a trailing period « — 1 نوفمبر …», with each month name and number in it as a placeholder
  // («طلبات مستنية (3)» = «طلبات مستنية (#)», «كشف نوفمبر 2026» = «كشف ‹شهر› #»), so a choice outlives the counts and the months
  const PANEL_MONTHS = /يناير|فبراير|مارس|أبريل|إبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر/g;
  const panelId = (l) => l.replace(/\s+—\s+[^—]*[\d٠-٩][^—]*$/, '').replace(PANEL_MONTHS, '‹شهر›').replace(/[\d٠-٩]+(?:[.,][\d٠-٩]+)*/g, '#').replace(/\s+/g, ' ').trim();
  const PANEL_SKIP = ['source', 'src-note', 'pn-allhidden'];
  function panelItems(root) {
    const out = []; if (!root) return out; const seen = {};
    const add = (l, kind, el, blk) => { const label = l.replace(/\s+/g, ' ').trim(); let id = panelId(label); if (!id) return; seen[id] = (seen[id] || 0) + 1; if (seen[id] > 1) id += ' #' + seen[id]; out.push({ id, label, kind, el, blk }); };
    [...root.children].forEach((blk) => {
      if (PANEL_SKIP.some((c) => blk.classList.contains(c))) return;
      if (blk.classList.contains('cards') || blk.classList.contains('charts')) {
        [...blk.children].forEach((c) => { const l = (c.querySelector('.kpi-label, .chart-head h2, .cat-top .t-h5, .table-title h2, [data-details]') || {}).textContent;
          if (l) add(l, c.classList.contains('kpi') ? 'رقم' : c.classList.contains('chart-card') ? 'رسم' : 'كارت', c, blk); });
      } else {
        const l = (blk.querySelector(':scope > .table-title h2, :scope > .chart-head h2, :scope > .sec-h h2, :scope > .sec-head h2, :scope > .sec-t, :scope > h2, :scope > .cat-top .t-h5, :scope > div > .t-h5') || {}).textContent;
        if (l) add(l, blk.classList.contains('table-card') ? 'جدول' : blk.classList.contains('sum-card') ? 'ملخص' : 'قسم', blk, blk);
      }
    });
    return out;
  }
  function applyPanelPrefs(key, root) {
    if (!root) return; const p = panelPrefs(key); const items = panelItems(root);
    // a page with one block or none (like the products log alone) has nothing to customize: the button hides itself
    const btn = document.querySelector('[data-pn-custom="' + key + '"]'); if (btn) btn.hidden = items.length < 2;
    if (!items.length) return;
    const idx = (id) => { const i = p.order.indexOf(id); return i < 0 ? 1000 + items.findIndex((x) => x.id === id) : i; };
    // with no saved order no block moves (some blocks are not read here, like the notes and the toolbars)
    if (p.order.length) {
      const blocks = [...new Set(items.map((x) => x.blk))];
      blocks.forEach((b) => { items.filter((x) => x.blk === b && x.el !== b).sort((a, c) => idx(a.id) - idx(c.id)).forEach((x) => b.append(x.el)); });
      const minIdx = (b) => Math.min(...items.filter((x) => x.blk === b).map((x) => idx(x.id)));
      const tail = [...root.children].filter((c) => c.classList.contains('source') || c.classList.contains('src-note'));
      blocks.sort((a, b) => minIdx(a) - minIdx(b)).forEach((b) => root.append(b)); tail.forEach((t) => root.append(t));
    }
    // only what this hid comes back: a block the page itself rendered `hidden` stays hidden (data-pn-hidden marks ours)
    const hide = (el, on) => { if (on) { el.hidden = true; el.dataset.pnHidden = '1'; } else if (el.dataset.pnHidden) { el.hidden = false; delete el.dataset.pnHidden; } };
    const blocks = [...new Set(items.map((x) => x.blk))];
    items.forEach((x) => hide(x.el, p.hidden.includes(x.id)));
    blocks.forEach((b) => { const kids = items.filter((x) => x.blk === b && x.el !== b); if (kids.length) hide(b, kids.every((x) => x.el.hidden)); });
    const old = root.querySelector(':scope > .pn-allhidden'); if (old) old.remove();
    if (!items.some((x) => !x.el.hidden)) { const e = Empty('كل بلوكات اللوحة مخفية', 'افتح «تخصيص اللوحة» واختار اللي يظهر.'); e.classList.add('pn-allhidden'); root.prepend(e); }
  }
  function customizePanel(key, label, root, done) {
    if (!root) { toast('مفيش لوحة في الصفحة دي'); return; }
    const p = panelPrefs(key); const all = panelItems(root);
    if (!all.length) { toast('مفيش بلوكات تتخصص في الصفحة دي'); return; }
    const idx = (id) => { const i = p.order.indexOf(id); return i < 0 ? 1000 + all.findIndex((x) => x.id === id) : i; };
    const list = all.slice().sort((a, b) => idx(a.id) - idx(b.id)).map((x) => ({ id: x.id, label: x.label, kind: x.kind, hidden: p.hidden.includes(x.id) }));
    form({ title: 'تخصيص اللوحة — ' + label, wide: true, values: { list },
      note: U.InlineNote({ children: 'اختار اللي يظهر في «' + label + '» ورتّبه بالسحب من المسكة اللي جنب الاسم. التخصيص بيتحفظ ليك انت بس، ولكل صفحة/تاب لوحده.' }),
      fields: (f, e, set) => { const wrap = h('div', { class: 'dash-cust', role: 'list' }, f.list.map((c, i) => h('div', { class: 'dc-row', role: 'listitem', 'data-pn-item': c.id },
        Grip(c.label),
        h('span', { class: 'dc-l' }, h('b', null, c.label), h('small', { class: 't-small help' }, c.kind)),
        Switch({ id: 'pnc-' + i, label: c.label, checked: !c.hidden, onChange: (v) => { c.hidden = !v; set('list', f.list.slice(), true); } }))));
        // the grips listen right away (not a tick later): a key pressed just after a redraw still moves the row
        sortableRows(wrap, 'data-pn-item', (ids) => set('list', ids.map((id) => f.list.find((x) => x.id === id)).filter(Boolean), true));
        return [wrap, e.list ? U.InlineNote({ kind: 'error', children: e.list }) : null]; },
      validate: (f) => (f.list.some((c) => !c.hidden) ? {} : { list: 'سيب بلوك واحد على الأقل ظاهر' }),
      extraFooter: (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'text', label: 'رجوع للافتراضي', attrs: { 'data-pn-reset': '' }, onClick: () => { panelWrite(key, null); toast('رجعت اللوحة للافتراضي'); m.close(); if (done) done(); } })),
      submitLabel: 'حفظ', submit: (f) => { panelWrite(key, { order: f.list.map((c) => c.id), hidden: f.list.filter((c) => c.hidden).map((c) => c.id) });
        logEvent('panel.customize', label + ' · ' + f.list.filter((c) => !c.hidden).length + ' بلوك'); toast('اتحفظ تخصيص اللوحة', 'success'); if (done) done(); } });
  }
  // the button itself — getRoot() returns the container that holds the page's blocks; the page calls applyPanelPrefs after each render
  function PanelButton(key, label, getRoot, done) {
    return Button({ label: 'تخصيص اللوحة', icon: 'sliders', attrs: { 'data-pn-custom': key }, onClick: () => customizePanel(key, label, getRoot(), done) });
  }
  // ---------- تصدير Excel سريع (owner 27 Oct: «مشاركة ك اكسيل») ----------
  // aoa = مصفوفة صفوف (أول صف العناوين). المكتبة (app/js/vendor/xlsx.full.min.js) بتتحمّل وقت الطلب؛ لو ماتحمّلتش بينزّل CSV.
  const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.appendChild(sc); }));
  function downloadText(filename, text, type) { const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: filename }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0); }
  // save a generated file on the viewer's device (owner 26 Oct «حفظ على الجهاز» — phase 6 from the v2 kit): a plain browser download
  function saveFile(filename, data, type) {
    try { const blob = data instanceof Blob ? data : new Blob([data], type ? { type } : undefined); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return Promise.resolve('saved'); } catch (e) { return Promise.resolve('unavailable'); }
  }
  function xlsxExport(filename, sheetName, aoa) {
    window.__lastExport = { filename, sheetName, rows: aoa.length }; // the e2e reads what was exported
    // a cell that starts like a formula (= + - @ tab CR) gets a leading apostrophe so a spreadsheet never runs it (CSV injection)
    const csv = () => { const esc = (c) => { let v = c == null ? '' : String(c); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      downloadText(filename.replace(/\.xlsx$/, '.csv'), '﻿' + aoa.map((r) => r.map(esc).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); toast('اتنزل CSV — Excel مش متاح دلوقتي'); };
    return loadXLSX().then((XL) => { const wb = XL.utils.book_new(); const ws = XL.utils.aoa_to_sheet(aoa); ws['!views'] = [{ RTL: true }];
      XL.utils.book_append_sheet(wb, ws, String(sheetName || 'Sheet1').slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')); XL.writeFile(wb, filename); toast('اتنزل ملف Excel', 'success'); }).catch(csv);
  }
  // ---------- فلتر + ترتيب تلقائي لأي جدول تفاصيل (owner 1 Nov) ----------
  // جنب زرار الأعمدة: «فلتر» من الأعمدة اللي ليها قيم محدودة (حالة، نوع، قناة…) والأعمدة الرقمية بالإشارة، و«ترتيب» بالتاريخ أو الرقم أو النص.
  // النتيجة: شيبس (اختيار لوحده + عدده في دايرة + ✕) تحت التايتل قبل راس الجدول. الجداول اللي ليها فلتر خاص بيها (`own-filter` أو فلتر في راسها) مابتتلمسش.
  function autoFilter(card, key, t) {
    if (!card || !t || card.classList.contains('own-filter') || card.querySelector('[data-fm-btn]:not([data-fm-btn^="auto"]), [data-fm-row]:not([data-fm-row^="auto"]), [data-af]:not([data-af="auto"])')) return;
    if (t.closest('.modal, .drawer, [role=dialog]')) return;
    const hd0 = card.querySelector(':scope>.table-title, :scope>.sec-h, :scope>.cons-h');
    if (hd0 && hd0.querySelector('select, .select:not([data-fm-btn^=auto]):not([data-sm-btn^=auto])')) return; // الكارت عنده فلتر خاص في راسه
    const tb = t.tBodies[0]; if (!tb) return;
    const heads = colHeads(t);
    const rows = [...tb.rows].filter((r) => r.cells.length === heads.length);
    rows.forEach((r, i) => { if (r.dataset.afi == null) r.dataset.afi = String(i); });
    if (rows.length < 2) return;
    const cols = heads.map((lb, i) => {
      if (!lb) return null; const vals = rows.map((r) => cellTxt(r.cells[i])); const ne = vals.filter((v) => v && v !== '—' && v !== '-');
      if (!ne.length) return null;
      const nums = ne.map(numOf), dates = ne.map(dateOf);
      const type = nums.every((x) => x !== null) ? 'num' : dates.every(Boolean) ? 'date' : ne.every((v) => /^\d{1,2}:\d{2}/.test(v)) ? 'time' : 'text';
      const distinct = [...new Set(ne)];
      // B5: a column whose values repeat (the dropdown has a search box past 6 values, so up to 40 of them)
      const cat = type === 'text' && distinct.length >= 2 && distinct.length <= 40 && distinct.every((v) => v.length <= 60) && !(distinct.length === rows.length && rows.length > 5);
      return { lb, i, type, cat, distinct };
    }).filter(Boolean);
    // فلتر لكل جدول (owner 1 Nov): أعمدة القيم المحدودة + الأعمدة الرقمية بالإشارة (فيه قيمة / صفر / سالب) — عشان جداول الأرقام بس يبقى ليها فلتر برضه
    const SIGN = [['pos', 'أكبر من صفر'], ['zero', 'صفر / فاضي'], ['neg', 'سالب']];
    const signOf = (x) => { const n = numOf(x); return n == null || n === 0 ? 'zero' : n > 0 ? 'pos' : 'neg'; };
    const numGroups = cols.filter((c) => c.type === 'num').map((c) => { const present = new Set(rows.map((r) => signOf(cellTxt(r.cells[c.i])))); return present.size >= 2 ? { key: c.lb, label: c.lb, num: true, options: SIGN.filter(([k]) => present.has(k)) } : null; }).filter(Boolean);
    const groups = cols.filter((c) => c.cat).slice(0, 4).map((c) => ({ key: c.lb, label: c.lb, options: c.distinct.map((v) => [v, v]) })).concat(numGroups).slice(0, 6);
    // جدول أرقام موجبة بس (زي «الأكثر مبيعًا»): فلتر بالمتوسط
    const AVG = {}; if (!groups.length) cols.filter((c) => c.type === 'num').slice(0, 2).forEach((c) => { const v = rows.map((r) => numOf(cellTxt(r.cells[c.i])) || 0); AVG[c.lb] = v.reduce((a, b) => a + b, 0) / v.length; groups.push({ key: c.lb, label: c.lb, avg: true, options: [['hi', 'أعلى من المتوسط'], ['lo', 'المتوسط أو أقل']] }); });
    const SORTS = [['', 'الترتيب الافتراضي']];
    cols.filter((c) => c.type === 'date').slice(0, 2).forEach((c) => SORTS.push(['d-desc:' + c.lb, c.lb + ': الأحدث للأقدم'], ['d-asc:' + c.lb, c.lb + ': الأقدم للأحدث']));
    cols.filter((c) => c.type === 'time').slice(0, 2).forEach((c) => SORTS.push(['m-asc:' + c.lb, c.lb + ': الأبكر الأول'], ['m-desc:' + c.lb, c.lb + ': الأتأخر الأول']));
    cols.filter((c) => c.type === 'num').slice(0, 4).forEach((c) => SORTS.push(['n-desc:' + c.lb, c.lb + ': الأعلى للأقل'], ['n-asc:' + c.lb, c.lb + ': الأقل للأعلى']));
    const txt = cols.find((c) => c.type === 'text' && !c.cat) || cols.find((c) => c.type === 'text'); if (txt) SORTS.push(['t-asc:' + txt.lb, txt.lb + ': أ ← ي']);
    if (!groups.length && SORTS.length < 2) return;
    const S = autoState(key + '|' + heads.join('|'));
    Object.keys(S.f).forEach((k) => { if (!groups.some((g) => g.key === k)) delete S.f[k]; });
    if (S.sort && !SORTS.some((x) => x[0] === S.sort)) S.sort = '';
    const idx = (lb) => colHeads(t).indexOf(lb);
    const gOf = (k) => groups.find((g) => g.key === k) || {};
    const cellKey = (r, k) => { const x = cellTxt(r.cells[idx(k)]); const g = gOf(k); return g.num ? signOf(x) : g.avg ? ((numOf(x) || 0) > AVG[k] ? 'hi' : 'lo') : x; };
    const match = (r, f) => Object.keys(f).every((k) => !f[k] || !f[k].length || f[k].includes(cellKey(r, k)));
    const head = card.querySelector(':scope>.table-title, :scope>.sec-h, :scope>.cons-h');
    const colsBtn = card.querySelector('[data-cols]');
    const anchor = t.closest('.xwrap') || t.closest('.scroll-x') || t;
    function apply() {
      // ترتيب
      const all = [...tb.rows].filter((r) => r.dataset.afi != null);
      const [mode, lb] = S.sort ? [S.sort.slice(0, S.sort.indexOf(':')), S.sort.slice(S.sort.indexOf(':') + 1)] : ['', ''];
      const ci = lb ? idx(lb) : -1;
      const kv = (r) => { const x = cellTxt(r.cells[ci]); return mode[0] === 'n' ? numOf(x) : mode[0] === 'd' ? dateOf(x) : mode[0] === 'm' ? ((x.match(/^(\d{1,2}):(\d{2})/) || [, '', '']).slice(1).map((y) => y.padStart(2, '0')).join(':') || null) : x; };
      const sorted = all.slice().sort((a, b) => {
        if (!mode || ci < 0) return a.dataset.afi - b.dataset.afi;
        const A = kv(a), B = kv(b); if (A == null || A === '') return 1; if (B == null || B === '') return -1;
        const c = mode[0] === 't' ? String(A).localeCompare(String(B), 'ar') : A < B ? -1 : A > B ? 1 : 0;
        return (mode.endsWith('desc') ? -c : c) || a.dataset.afi - b.dataset.afi; });
      const rest = [...tb.rows].filter((r) => r.dataset.afi == null);
      const want = sorted.concat(rest); const cur = [...tb.rows];
      if (want.some((r, k) => cur[k] !== r)) keepFocus(t, () => want.forEach((r) => tb.append(r))); // the rows move only when the order changes
      // فلتر
      let shown = 0; all.forEach((r) => { const ok = match(r, S.f); r.classList.toggle('af-hide', !ok); if (ok) shown++; });
      // صف الإجمالي: لو هو مجموع الصفوف بنحسبه للمعروض بس (وبنرجّعه لما الفلتر يتشال)
      const active = Object.keys(S.f).some((k) => (S.f[k] || []).length);
      [...(t.tFoot ? t.tFoot.rows : [])].filter((r) => r.cells.length === heads.length).forEach((fr) => {
        [...fr.cells].forEach((td) => { if (td.dataset.aft == null) td.dataset.aft = td.textContent; });
        cols.filter((c) => c.type === 'num').forEach((c) => { const td = fr.cells[idx(c.lb)]; if (!td) return; const o = td.dataset.aft.trim();
          if (!/^-?[\d,]+(\.\d+)?$/.test(o)) return; const ov = numOf(o); const sumOf = (l) => l.reduce((n, r) => n + (numOf(cellTxt(r.cells[idx(c.lb)])) || 0), 0);
          if (Math.abs(sumOf(all) - ov) > 0.6) return; const dec = (o.split('.')[1] || '').length;
          td.textContent = active ? sumOf(all.filter((r) => !r.classList.contains('af-hide'))).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : td.dataset.aft; });
        const first = fr.cells[0]; if (first && first.dataset.aft != null && cols.some((c) => c.type === 'num')) first.textContent = active ? first.dataset.aft.trim() + ' (المعروض)' : first.dataset.aft;
      });
      // the owner 12 Nov («دخل الفلتر اللي بره جوه زرار الفلتر وحطوا جمب الترتيب»): «فلتر» and the sort next to the columns button
      card.querySelectorAll('[data-auto-ctl]').forEach((x) => x.remove());
      const ctl = [];
      if (groups.length) ctl.push(FilterMenu({ id: 'auto:' + key, label: 'فلتر ' + (card.querySelector('h2') || {}).textContent, groups, value: S.f, noun: 'صف', count: (d) => all.filter((r) => match(r, d)).length, onApply: (d) => { S.f = d; apply(); } }));
      if (SORTS.length > 1) ctl.push(SortMenu({ id: 'auto:' + key, label: 'ترتيب ' + (card.querySelector('h2') || {}).textContent, options: SORTS, value: S.sort, onChange: (v) => { S.sort = v; apply(); } }));
      ctl.forEach((c) => c.setAttribute('data-auto-ctl', ''));
      if (colsBtn && colsBtn.parentElement) ctl.forEach((c) => colsBtn.before(c)); else if (head) { const a = head.querySelector('.acts, .acts-inline') || head; ctl.forEach((c) => a.append(c)); }
      // النتيجة
      const chips = []; groups.forEach((g) => (S.f[g.key] || []).forEach((v) => chips.push({ key: g.key + ':' + v, label: g.label + ': ' + (g.num || g.avg ? (g.options.find((x) => x[0] === v) || [, v])[1] : v), count: all.filter((r) => cellKey(r, g.key) === v).length,
        remove: () => { S.f[g.key] = S.f[g.key].filter((x) => x !== v); apply(); } })));
      const row = ActiveFilters({ id: 'auto', chips, total: shown, noun: 'صف', onClear: () => { S.f = {}; apply(); } });
      if (row) { row.setAttribute('data-auto-row', ''); anchor.before(row); }
      if (!shown && all.length) anchor.after(h('p', { class: 't-small help af-empty', 'data-auto-row': '' }, 'مفيش صفوف بالفلتر ده — شيل اختيار أو اضغط «مسح الكل».'));
    }
    card.querySelectorAll('[data-auto-row]').forEach((x) => x.remove());
    const _apply = apply; apply = function () { card.querySelectorAll('[data-auto-row]').forEach((x) => x.remove()); _apply(); }; // eslint-disable-line no-func-assign
    apply();
  }
  function withColumns(card, key0, label0, done) {
    if (!card || !card.querySelector) return card;
    setTimeout(() => {
      const t = card.querySelector('table'); if (!t || card.closest('[data-no-cols]')) return; // a card that asked for no «أعمدة الجدول» (B3)
      const heads = colHeads(t); if (heads.length < 4) return;
      // من غير عنوان بنولّد مفتاح ثابت من أسماء الأعمدة
      const key = key0 && !/:$/.test(key0) ? key0 : 'cols:' + heads.filter(Boolean).slice(0, 4).join('|');
      const label = label0 || heads.filter(Boolean).slice(0, 2).join(' · ');
      applyColumnPrefs(key, t);
      if (card.querySelector('[data-cols]')) { autoFilter(card, key, t); return; }
      const btn = IconButton({ icon: 'sliders', label: 'أعمدة الجدول — ' + label, attrs: { 'data-cols': key },
        onClick: () => customizeColumns(key, label, card.querySelector('table'), done || (() => { applyColumnPrefs(key, card.querySelector('table')); })) });
      let head = card.querySelector(':scope>.table-title, :scope>.sec-h, :scope>.cons-h');
      if (!head) { head = h('div', { class: 'sec-h cols-only' }, h('div', { class: 'acts' })); card.prepend(head); }
      const acts = head.querySelector('.acts, .acts-inline'); (acts || head).append(btn);
      autoFilter(card, key, t);
    }, 0);
    return card;
  }

  // Bulk({ key, ids, noun, actions:[{label, icon, danger, run(ids, done)}], render }) → { head(), box(id, name), bar(), sel, has(id) }
  // نفس الشكل في كل السيستم: عمود checkbox أول الجدول + checkbox «حدد الكل» في العنوان (mixed لو جزء) + شريط فوق الجدول «محدد N …» وأزراره و«إلغاء التحديد».
  const bulkSel = {};
  function Bulk({ key, ids, noun, actions, render }) {
    const S = (bulkSel[key] = bulkSel[key] || new Set()); const idset = new Set(ids.map(String)); [...S].forEach((i) => { if (!idset.has(i)) S.delete(i); });
    const all = ids.length > 0 && ids.every((i) => S.has(String(i))); const some = !all && ids.some((i) => S.has(String(i)));
    const stop = (el) => { el.addEventListener('click', (e) => e.stopPropagation()); el.addEventListener('keydown', (e) => e.stopPropagation()); return el; };
    const head = () => { const c = Checkbox({ label: '', checked: all, onChange: (v) => { ids.forEach((i) => (v ? S.add(String(i)) : S.delete(String(i)))); render(); } }); c.setAttribute('aria-label', 'حدد الكل'); c.setAttribute('data-bulk-all', key); if (some) c.setAttribute('aria-checked', 'mixed'); return stop(c); };
    const box = (id, name) => { const c = Checkbox({ label: '', checked: S.has(String(id)), onChange: (v) => { if (v) S.add(String(id)); else S.delete(String(id)); render(); } }); c.setAttribute('aria-label', 'حدد ' + (name || id)); c.setAttribute('data-bulk-box', String(id)); return stop(c); };
    const bar = () => { if (!S.size) return null; const sel = [...S]; const done = (msg) => { S.clear(); if (msg) toast(msg, 'success'); render(); };
      return h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد', 'data-bulk': key }, h('b', null, 'محدد ' + S.size + (noun ? ' ' + noun : '')), h('span', { class: 'grow' }),
        ...(actions || []).filter(Boolean).map((a) => Button({ size: 'sm', icon: a.icon, type: a.danger ? 'danger' : undefined, label: a.label, attrs: { 'data-bulk-act': a.id || a.label }, onClick: () => a.run(sel, done) })),
        Button({ type: 'text', size: 'sm', label: 'إلغاء التحديد', attrs: { 'data-bulk-clear': '' }, onClick: () => { S.clear(); render(); } })); };
    return { head, box, bar, sel: S, has: (id) => S.has(String(id)), clear: () => S.clear() };
  }

  // ---------- فلتر الجداول — مكوّن واحد لأي جدول (owner 1 Nov) ----------
  // groups: [{ key, label, options:[[value, label, depth?]] }] · value: { key:[...] } · count(draft) → عدد النتايج · onApply(newValue)
  // B5 (11 نوفمبر) كان صف دروب داونز؛ صاحب المشروع 12 نوفمبر رجّعه زرار «فلتر» جنب الترتيب، وجواه المجموعات تابات في شريط بيتسحب
  // (data-fm-btn = id، القايمة data-fm-menu، التاب data-fm-tab، تحته data-fm-key بالبحث data-fm-q والاختيارات data-fm = «مفتاح:قيمة»،
  // data-fm-apply / data-fm-clear).
  const fmTab = {}; // the group last opened in each filter (this session)
  function FilterMenu({ id, groups, value, count, noun, onApply, label }) {
    // the owner 12 Nov — one «فلتر» button next to the sort; inside it (the owner, the same day: «الأقسام في تابس جوه كاروسيل ولما أدوس
    // على أي واحدة يفتح تحتيها الاختيارات بتاعتها وخانة بحث») the groups are tabs in a strip that scrolls sideways (the count picked on
    // each), and under the tab picked its search box and its ticks; «مسح» and one «اعرض N <noun>» for all the groups
    const v0 = value || {}; const n0 = groups.reduce((n, g) => n + (v0[g.key] || []).length, 0);
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'select sm' + (n0 ? ' has-val' : ''), 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': (label || 'فلتر') + (n0 ? ' — ' + n0 + ' مختار' : ''), 'data-fm-btn': id }, Icon('chevD', 'sm'), h('span', { class: 'val' }, Icon('filter', 'sm'), ' فلتر' + (n0 ? ' (' + n0 + ')' : '')));
    const pop = U.popover(wrap, btn, (close) => {
      const d = {}; groups.forEach((g) => { d[g.key] = [...(v0[g.key] || [])]; });
      const has = (k, v) => d[k].some((x) => String(x) === String(v));
      const cnt = h('span', null); const upd = () => { cnt.textContent = count ? 'اعرض ' + count(d) + (noun ? ' ' + noun : '') : 'تطبيق'; };
      const items = []; const tabs = {}; const secs = {};
      let cur = groups.some((g) => String(g.key) === fmTab[id]) ? fmTab[id] : String((groups[0] || {}).key);
      // the tab = the kit's chip (the label + the count picked in its badge); the one open is green with beige text (Ibtekr's rules)
      const tabText = (g) => [h('span', { class: 'fm-tl' }, g.label), ...(d[g.key].length ? [h('span', { class: 'cnt', 'data-fm-n': '' }, String(d[g.key].length))] : [])];
      const mark = (b) => { const on = has(b._k, b._v); b.setAttribute('aria-checked', String(on)); b.querySelector('.mchk').replaceChildren(...(on ? [Icon('check', 'sm')] : [])); };
      const opt = (g, o) => { const [v, l, depth] = o; const on = has(g.key, v);
        const b = h('button', { type: 'button', class: 'opt multi' + (depth ? ' mp-sub' : ''), role: 'menuitemcheckbox', 'aria-checked': String(on), 'data-fm': g.key + ':' + v },
          h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), h('span', { class: 'mp-l', dir: 'auto' }, (depth ? '-'.repeat(depth) + ' ' : '') + l));
        b._k = g.key; b._v = v; items.push(b);
        b.addEventListener('click', (e) => { e.stopPropagation(); const a = d[g.key]; const i = a.findIndex((x) => String(x) === String(v)); if (i > -1) a.splice(i, 1); else a.push(v); mark(b); tabs[String(g.key)].replaceChildren(...tabText(g)); upd(); });
        return b; };
      const show = (k, focus) => { cur = String(k); fmTab[id] = cur;
        Object.keys(tabs).forEach((x) => { tabs[x].setAttribute('aria-selected', String(x === cur)); tabs[x].tabIndex = x === cur ? 0 : -1; });
        Object.keys(secs).forEach((x) => { secs[x].hidden = x !== cur; });
        const t = tabs[cur]; if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const q = secs[cur] && secs[cur].querySelector('[data-fm-q]'); if (focus && q) setTimeout(() => q.focus()); };
      const strip = h('div', { class: 'fm-tabs', role: 'tablist', 'aria-label': (label || 'فلتر') + ' — الأقسام' }, groups.map((g) => {
        const t = h('button', { type: 'button', role: 'tab', class: 'chip fm-tab', 'data-fm-tab': String(g.key), 'aria-selected': String(String(g.key) === cur) }, ...tabText(g));
        t.addEventListener('click', (e) => { e.stopPropagation(); show(g.key, true); }); tabs[String(g.key)] = t; return t; }));
      strip.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const keys = groups.map((g) => String(g.key)); const i = keys.indexOf(cur);
        const n = keys[(i + (e.key === 'ArrowLeft' ? 1 : -1) + keys.length) % keys.length]; show(n); tabs[n].focus(); });
      groups.forEach((g) => {
        const list = h('div', { class: 'fm-list', role: 'group', 'aria-label': g.label }, g.options.map((o) => opt(g, o)));
        const q = h('input', { type: 'search', placeholder: 'دوّر في ' + g.label + '…', 'aria-label': 'دوّر في ' + g.label, 'data-fm-q': String(g.key), autocomplete: 'off' });
        const none = h('p', { class: 't-small help fm-none', hidden: '' }, 'مفيش نتايج');
        q.addEventListener('input', () => { const k = foldAr(q.value); let n = 0; [...list.children].forEach((b) => { b.hidden = !!k && !foldAr(b.textContent).includes(k); if (!b.hidden) n++; }); none.hidden = n > 0; });
        q.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { const f = [...list.children].find((b) => !b.hidden); if (f) { e.preventDefault(); f.focus(); } } });
        secs[String(g.key)] = h('div', { class: 'fm-sec', role: 'tabpanel', 'data-fm-key': String(g.key), hidden: String(g.key) === cur ? false : '' }, h('label', { class: 'input fm-q' }, Icon('search', 'sm'), q), list, none);
      });
      const m = h('div', { class: 'menu view-menu fm-menu', role: 'menu', 'aria-label': label || 'فلتر', 'data-fm-menu': id, 'data-focus': 'no' }, strip, groups.map((g) => secs[String(g.key)]),
        h('div', { class: 'view-foot' }, Button({ size: 'sm', type: 'text', label: 'مسح', attrs: { 'data-fm-clear': '' }, onClick: () => { groups.forEach((g) => { d[g.key] = []; tabs[String(g.key)].replaceChildren(...tabText(g)); }); items.forEach(mark); upd(); } }),
          Button({ size: 'sm', type: 'primary', label: cnt, attrs: { 'data-fm-apply': '' }, onClick: () => { close(); onApply(d); } })));
      m.addEventListener('keydown', (e) => { if (e.target && e.target.matches && e.target.matches('input, [role=tab]')) return; const vis = items.filter((x) => !x.hidden && !x.closest('.fm-sec').hidden); const i = vis.indexOf(document.activeElement); if (!vis.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); vis[(i + 1) % vis.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); vis[(i - 1 + vis.length) % vis.length].focus(); } });
      upd(); setTimeout(() => { if (!m.contains(document.activeElement) && tabs[cur]) tabs[cur].focus(); const t = tabs[cur]; if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }); return m; });
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function SortMenu({ id, options, value, onChange, label }) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const cur = options.find((x) => x[0] === value) || options[0];
    const btn = h('button', { type: 'button', class: 'select sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label || 'ترتيب', 'data-sm-btn': id }, Icon('chevD', 'sm'), h('span', { class: 'val' }, h('span', null, 'ترتيب'), h('span', { class: 'sm-v' }, ': ' + cur[1])));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: options.map(([v, l]) => ({ value: v, label: l })), value: cur[0], onSelect: (v) => { close(); onChange(v); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  // chips: [{ key, label, count, remove }] — كل اختيار شيبس لوحده + عدده في دايرة + ✕ · total/noun للعدد · onClear «مسح الكل»
  function ActiveFilters({ id, chips, total, noun, onClear }) {
    if (!chips.length) return null;
    return h('div', { class: 'af-row', 'data-af': id },
      chips.map((c) => h('button', { type: 'button', class: 'af-chip', 'data-af-chip': c.key, 'aria-label': 'شيل الفلتر: ' + c.label + ' — ' + c.count + ' ' + noun, onClick: c.remove }, h('span', { class: 'af-t' }, c.label), h('span', { class: 'af-c', 'aria-hidden': 'true' }, String(c.count)), h('span', { class: 'af-x', 'aria-hidden': 'true' }, Icon('close', 'sm')))),
      h('span', { class: 'af-n', 'data-af-count': String(total) }, total + ' ' + noun),
      h('button', { type: 'button', class: 'af-clr', 'data-af-clear': '', onClick: onClear }, h('span', null, 'مسح الكل')));
  }

  // ---------- اختيار متعدد ببحث (owner 11 Nov — «الفئة الأساسية» في «إضافة مبتكر»، وبعدها فلاتر المنتجات والجداول) ----------
  // options: [{ value, label, depth }] أو [[value, label, depth]] · value: [...] · onChange(values) مع كل علامة
  // field: true → خانة فورم (العنوان فوق، الأسامي المختارة في الزرار، الخطأ تحت) · وإلا زرار فلتر صغير «<label> (N)»
  // depth: الفرعي بـ «-» و«--» و«---» قبل اسمه · البحث بيظهر لو الاختيارات أكتر من 6 (أو search: true)
  const foldAr = (s) => String(s == null ? '' : s).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  // onApply(values) (+ count(values), noun): a filter — the ticks wait in the menu, «اعرض N <noun>» applies them (closing otherwise drops them)
  function MultiPick({ id, label, options, value, onChange, onApply, count, noun, field, required, error, help, placeholder, search }) {
    const opts = (options || []).map((o) => (Array.isArray(o) ? { value: String(o[0]), label: String(o[1]), depth: Number(o[2]) || 0 } : { value: String(o.value), label: String(o.label), depth: Number(o.depth) || 0 }));
    const known = new Set(opts.map((o) => o.value)); let sel = (value || []).map(String).filter((v) => known.has(v));
    const nameOf = (v) => (opts.find((o) => o.value === v) || {}).label || v;
    const txt = () => (field ? (sel.length ? sel.map(nameOf).join('، ') : placeholder || 'اختار') : label + (sel.length ? ' (' + sel.length + ')' : ''));
    const val = h('span', { class: 'val' + (field && !sel.length ? ' ph' : '') }, txt());
    const btn = h('button', { type: 'button', id, class: 'select' + (field ? '' : ' sm') + (!field && sel.length ? ' has-val' : '') + (error ? ' err' : ''), 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-mp-btn': id, 'aria-invalid': error ? 'true' : false, 'aria-describedby': error ? id + '-err' : false }, Icon('chevD', 'sm'), val);
    const named = () => { if (!field) btn.setAttribute('aria-label', label + (sel.length ? ' — ' + sel.map(nameOf).join('، ') : '')); }; named();
    const sync = () => { val.textContent = txt(); val.classList.toggle('ph', !!field && !sel.length); if (!field) btn.classList.toggle('has-val', sel.length > 0); named(); };
    const wrap = h('div', { class: 'pop-anchor mp', 'data-popover-root': '', 'data-mp': id, style: field ? 'display:block' : null });
    const pop = U.popover(wrap, btn, (close) => {
      const draft = typeof onApply === 'function'; const cur = draft ? sel.slice() : sel; let q = ''; const items = [];
      const cnt = h('span', null); const upd = () => { cnt.textContent = count ? 'اعرض ' + count(cur.slice()) + (noun ? ' ' + noun : '') : 'تطبيق'; };
      const tick = () => { if (draft) upd(); else { sync(); if (onChange) onChange(cur.slice()); } };
      const list = h('div', { class: 'mp-list', role: 'group', 'aria-label': label });
      const mark = (b, on) => { b.setAttribute('aria-checked', String(on)); b.querySelector('.mchk').replaceChildren(...(on ? [Icon('check', 'sm')] : [])); };
      const draw = () => { const nq = foldAr(q); items.length = 0; const shown = opts.filter((o) => !nq || foldAr(o.label).includes(nq));
        list.replaceChildren(...(shown.length ? shown.map((o) => { const on = cur.includes(o.value);
          const b = h('button', { type: 'button', class: 'opt multi' + (o.depth ? ' mp-sub' : ''), role: 'menuitemcheckbox', 'aria-checked': String(on), 'data-mp-opt': o.value },
            h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), h('span', { class: 'mp-l', dir: 'auto' }, (o.depth ? '-'.repeat(o.depth) + ' ' : '') + o.label));
          b.addEventListener('click', (e) => { e.stopPropagation(); const i = cur.indexOf(o.value); if (i > -1) cur.splice(i, 1); else cur.push(o.value); mark(b, cur.includes(o.value)); tick(); });
          items.push(b); return b; }) : [h('p', { class: 't-small mp-empty' }, 'مفيش نتايج')])); };
      const s = search === true || (search !== false && opts.length > 6) ? h('input', { type: 'search', class: 'input mp-q', placeholder: 'دوّر…', 'aria-label': 'دوّر في ' + label, 'data-mp-q': id, autocomplete: 'off' }) : null;
      if (s) { s.addEventListener('input', () => { q = s.value; draw(); }); s.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && items[0]) { e.preventDefault(); items[0].focus(); } }); }
      draw();
      const m = h('div', { class: 'menu view-menu mp-menu', role: 'menu', 'aria-label': label, 'data-mp-menu': id, 'data-focus': 'no' }, s ? h('div', { class: 'mp-qw' }, s) : null, list,
        h('div', { class: 'view-foot' }, Button({ size: 'sm', type: 'text', label: 'مسح', attrs: { 'data-mp-clear': '' }, onClick: () => { cur.splice(0, cur.length); draw(); tick(); } }),
          draft ? Button({ size: 'sm', type: 'primary', label: cnt, attrs: { 'data-mp-apply': '' }, onClick: () => { sel = cur.slice(); sync(); close(); onApply(sel.slice()); } })
            : Button({ size: 'sm', type: 'primary', label: 'تم', attrs: { 'data-mp-done': '' }, onClick: () => close() })));
      if (draft) upd();
      m.addEventListener('keydown', (e) => { const i = items.indexOf(document.activeElement); if (i < 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (i === 0 && s) s.focus(); else items[(i - 1 + items.length) % items.length].focus(); } });
      setTimeout(() => { const f = s || items[0]; if (f) f.focus(); }, 0);
      return m; });
    btn.addEventListener('click', pop.toggle); wrap.append(btn);
    if (!field) return wrap;
    return h('div', { class: 'field mp-field' }, h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), wrap,
      help && !error ? h('div', { class: 'help' }, help) : null, error ? h('div', { class: 'err-msg', id: id + '-err', role: 'alert' }, error) : null);
  }

  // ---------- StarPicker: نجوم 1–5 (radiogroup — WAI-ARIA APG radio: الأسهم بتغيّر، Home/End، رقم 1–5) ----------
  function StarPicker({ id, label, value, onChange, error, required, help }) {
    const v = Number(value) || 0; const words = ['', 'وحش جداً', 'وحش', 'مقبول', 'كويس', 'ممتاز'];
    const g = h('div', { class: 'star-pick', role: 'radiogroup', id, 'aria-labelledby': id + '-l', 'aria-invalid': error ? 'true' : 'false', 'aria-describedby': error ? id + '-err' : null });
    const pick = (n) => { onChange(n); };
    for (let n = 1; n <= 5; n++) {
      const b = h('button', { type: 'button', role: 'radio', class: 'sp' + (n <= v ? ' on' : ''), 'aria-checked': String(n === v), 'aria-label': n + ' من 5 — ' + words[n], tabindex: (v ? n === v : n === 1) ? '0' : '-1', 'data-star': String(n), onClick: () => pick(n) }, U.Icon('star'));
      b.addEventListener('keydown', (e) => { const k = e.key; let nx = null; if (k === 'ArrowLeft' || k === 'ArrowUp') nx = Math.min(5, (v || 0) + 1); if (k === 'ArrowRight' || k === 'ArrowDown') nx = Math.max(1, (v || 2) - 1); if (k === 'Home') nx = 1; if (k === 'End') nx = 5; if (/^[1-5]$/.test(k)) nx = Number(k); if (nx) { e.preventDefault(); pick(nx); setTimeout(() => { const t = document.getElementById(id); const x = t && t.querySelector('[data-star="' + nx + '"]'); if (x) x.focus(); }, 0); } });
      g.append(b);
    }
    return h('div', { class: 'field star-field' }, h('span', { class: 'flabel', id: id + '-l' }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      h('div', { class: 'sp-row' }, g, h('span', { class: 't-small help sp-word', 'aria-live': 'polite' }, v ? v + ' من 5 · ' + words[v] : 'اختار من 1 لـ 5')),
      error ? h('div', { class: 'err-msg', role: 'alert', id: id + '-err' }, error) : help ? h('p', { class: 't-small help', style: 'margin:0' }, help) : null);
  }
  // the customer-service channels a member works on (the v6 prototype's helpers; the settings page reads them — phase 11)
  const chanAll = (m) => !!m && (m.id === 'M01' || m.role === 'أدمن');
  const chanList = (m) => (m && Array.isArray(m.chans) ? m.chans : []);
  const canChan = (m, id) => chanAll(m) || chanList(m).indexOf(id) > -1;
  const chanMembers = (id) => store.members.filter((m) => m.status !== 'invited' && canChan(m, id) && !chanAll(m));
  window.IBKit = { chanAll, chanList, canChan, chanMembers, Bulk, FilterMenu, SortMenu, ActiveFilters, MultiPick, foldAr, autoFilter, xlsxExport, saveFile, sortableRows, Grip, sweepColumns, applyColumnPrefs, customizeColumns, withColumns, PanelButton, applyPanelPrefs, customizePanel, panelItems, StarPicker, TODAY, NOW_MIN, ME, setMe, money, n0, dlabel, dshort, dayName, hm, hrs, daysBetween, AR_MON, Tag, PageHead, SubTabs, MainTabs, Section, TableSection, Switch, Checkbox, Radios, Accordion, RowMenu, Kv, Stat, Empty, Num, toast, busy, busyCount, form, confirm, field, two, req, store, member, team, stockNow, logEvent, notify, clockNow };
})();

/* Quick actions (owner 27 Oct; phase 11 decision 23, from the v6 block 14): «إجراءات سريعة» = a named link to any page of the system,
   optionally with its filters (#page?key=value&…). Pure helpers (IbtekrQuick) — tested in tests/domain/quick-domain.test.mjs. The list lives
   in the settings row «quick» (the admin writes it, every member reads it with the sign-in — block 28 fills K.store.quickActions). */
(function (root) {
  'use strict';
  const PAGES = ['dashboard', 'orders', 'makers', 'vendors', 'accounts', 'inventory', 'products', 'cs', 'tickets', 'reports', 'marketing', 'hr', 'settings', 'profile', 'notifications'];
  // accepts a full URL, "#hash" or "hash" → { base, query } or null
  function parseLink(link) {
    let s = String(link || '').trim(); if (!s) return null;
    const i = s.indexOf('#'); if (i >= 0) s = s.slice(i + 1); else if (/^https?:\/\//i.test(s)) return null;
    s = s.replace(/^\/+/, ''); if (!s) return null;
    const qi = s.indexOf('?'); const base = qi >= 0 ? s.slice(0, qi) : s; const qs = qi >= 0 ? s.slice(qi + 1) : '';
    const page = base.split(/[-/]/)[0];
    if (!PAGES.includes(page)) return null;
    const query = {}; qs.split('&').filter(Boolean).forEach((kv) => { const [k, v = ''] = kv.split('='); if (k) query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); });
    return { base, page, query };
  }
  function buildLink(base, query) {
    const q = Object.entries(query || {}).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v === true ? '1' : String(v))).join('&');
    return '#' + base + (q ? '?' + q : '');
  }
  function validate(item, others) {
    const e = {}; const n = String(item.name || '').trim();
    if (!n) e.name = 'اكتب اسم الإجراء'; else if ((others || []).some((x) => String(x.name).trim().toLowerCase() === n.toLowerCase())) e.name = 'فيه إجراء بنفس الاسم';
    if (!String(item.link || '').trim()) e.link = 'حط لينك الصفحة'; else if (!parseLink(item.link)) e.link = 'اللينك ده مش لصفحة في السيستم — انسخ اللينك من شريط العنوان وانت فاتح الصفحة';
    return e;
  }
  const DEFAULTS = [
    { id: 'qa-prod', name: 'إضافة منتجات', link: '#products-add', icon: 'package' },
    { id: 'qa-maker', name: 'إضافة مبتكر', link: '#makers/new', icon: 'users' },
    { id: 'qa-late', name: 'تقرير الفيندورز المتأخرين', link: '#reports-vendors?details=' + 'مبتكرين عندهم أوردرات قابلة للتأخير', icon: 'truck' },
    { id: 'qa-follow', name: 'عملاء تحتاج للمتابعة', link: '#cs-segments?seg=G2', icon: 'headset' },
  ];
  const api = { PAGES, parseLink, buildLink, validate, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrQuick = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* «إجراءات سريعة» (owner 27 Oct): dropdown in the top bar with named links to any page + its filters.
   Default: إضافة منتجات · إضافة مبتكر · تقرير الفيندورز المتأخرين · عملاء تحتاج للمتابعة. Managed in «الإعدادات › الإجراءات السريعة».
   Links look like #page?key=value — the query is taken off the URL before routing and handed to the page that registered for it. */
(function () {
  'use strict';
  const Q = window.IbtekrQuick; const U = window.IBUI, K = window.IBKit; const { h, Button, Icon } = U;
  const list = () => (K.store.quickActions = K.store.quickActions || Q.DEFAULTS.map((x) => Object.assign({}, x)));
  const handlers = []; let pending = null;
  // the admin's edits go to the settings row «quick» (IBSettings); other members only read the list
  function persistQuick() {
    const S0 = window.IBSettings; const me = window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null;
    if (!S0 || !me || me.role_id !== 'admin') return;
    S0.save('quick', { list: list().map((x) => ({ id: String(x.id), name: String(x.name), link: String(x.link), icon: x.icon || 'link' })) }, { merge: true }).then((r) => { if (!r.ok) K.toast(r.message || 'تعذّر حفظ الإجراءات السريعة', 'error'); });
  }
  function handle(prefix, get, set) { handlers.push({ prefix, get, set }); handlers.sort((a, b) => b.prefix.length - a.prefix.length); }
  const handlerFor = (base) => handlers.find((x) => base === x.prefix || base.startsWith(x.prefix + '-') || base.startsWith(x.prefix + '/') || base.startsWith(x.prefix));
  const curBase = () => location.hash.slice(1).split('?')[0];
  function applyPending() {
    if (!pending) return; const { base, query } = pending; if (curBase() !== base) return; pending = null;
    const hd = handlerFor(base); const rest = Object.assign({}, query); const details = rest.details; delete rest.details;
    if (hd && Object.keys(rest).length) { try { hd.set(rest); } catch (e) { /* page not ready */ } }
    if (details) setTimeout(() => { const b = [...document.querySelectorAll('[data-details]')].find((x) => x.offsetParent && x.dataset.details === details); if (b) b.click(); }, 120);
  }
  // take the query off the hash before the app routes it (this listener is registered before app.js)
  function strip() { const raw = location.hash.slice(1); const qi = raw.indexOf('?'); if (qi < 0) return; const p = Q.parseLink('#' + raw); pending = p ? { base: p.base, query: p.query } : null; try { history.replaceState(null, '', '#' + raw.slice(0, qi)); } catch (e) { /* sandbox */ } }
  window.addEventListener('hashchange', () => { strip(); setTimeout(applyPending, 80); });
  strip(); window.addEventListener('load', () => setTimeout(applyPending, 400));
  function run(link) {
    const p = Q.parseLink(link); if (!p) { K.toast('اللينك ده مش لصفحة في السيستم', 'error'); return; }
    pending = { base: p.base, query: p.query };
    if (curBase() === p.base) { applyPending(); window.dispatchEvent(new HashChangeEvent('hashchange')); setTimeout(applyPending, 80); } else location.hash = '#' + p.base;
    K.logEvent('quick.run', link);
  }
  function currentLink() { const base = curBase(); const hd = handlerFor(base); let q = {}; try { q = hd ? hd.get() || {} : {}; } catch (e) { q = {}; } return Q.buildLink(base, q); }
  function edit(item, onDone) {
    const L = list(); const isNew = !item || !L.includes(item); const v = { name: item ? item.name : '', link: item ? item.link : '' };
    K.form({ title: isNew ? 'إجراء سريع جديد' : 'تعديل «' + item.name + '»', values: v,
      note: U.InlineNote({ children: 'افتح أي صفحة في السيستم بالفلاتر أو التقارير اللي انت عايزها، وانسخ اللينك من شريط العنوان، أو استخدم «ضيف الصفحة دي» من قايمة «إجراءات سريعة» وهي بتحفظ الفلاتر لوحدها.' }),
      fields: (f, e, set) => [K.field.text('name', 'اسم الإجراء', f, e, set, { required: true, placeholder: 'مثلاً: أوردرات مكتملة النهارده' }), K.field.text('link', 'لينك الصفحة', f, e, set, { required: true, dir: 'ltr', placeholder: '#orders?st=مكتمل', help: 'بيتقبل اللينك كامل أو الجزء اللي بعد # · الفلاتر بتيجي بعد ?' })],
      validate: (f) => Q.validate(f, L.filter((x) => x !== item)),
      submitLabel: isNew ? 'ضيف' : 'احفظ',
      submit: (f) => { const p = Q.parseLink(f.link); const rec = { name: f.name.trim(), link: Q.buildLink(p.base, p.query) }; if (isNew) L.push(Object.assign({ id: 'qa-' + Date.now().toString(36), icon: 'link' }, rec)); else Object.assign(item, rec); K.logEvent('quick.save', rec.name + ' · ' + rec.link); persistQuick(); K.toast(isNew ? 'اتضاف «' + rec.name + '» للإجراءات السريعة' : 'اتحفظ', 'success'); if (onDone) onDone(); } });
  }
  function Menu() {
    const wrap = h('div', { class: 'pop-anchor qa-anchor', 'data-popover-root': '' });
    const trig = Button({ label: h('span', { class: 'qa-lbl' }, 'إجراءات سريعة'), icon: 'zap', iconEnd: 'chevD', attrs: { 'aria-haspopup': 'menu', 'data-quick': '', 'aria-label': 'إجراءات سريعة', title: 'إجراءات سريعة' } });
    const pop = U.popover(wrap, trig, (close) => { const L = list();
      const opts = L.map((x) => ({ value: x.id, label: x.name, icon: x.icon || 'link' })).concat([{ value: '__add', label: '+ ضيف الصفحة دي', icon: 'plus' }, { value: '__manage', label: 'إدارة الإجراءات السريعة', icon: 'gear' }]);
      const menu = U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (v) => { close(); setTimeout(() => { if (v === '__add') edit({ name: (document.title || '').split(' — ')[0], link: currentLink() }); else if (v === '__manage') location.hash = '#settings-quick'; else { const it = L.find((x) => x.id === v); if (it) run(it.link); } }); } });
      // phase 13 decision 49 (owner 10 Nov): the two general actions («+ ضيف الصفحة دي» / «إدارة الإجراءات السريعة») in green
      [...menu.querySelectorAll('.opt')].slice(-2).forEach((b) => b.classList.add('opt-general'));
      return menu; });
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  // «الإعدادات › الإجراءات السريعة»
  function manage(rerender) {
    const L = list(); const R = rerender;
    const rows = L.map((x, i) => [K.Grip(x.name),
      h('span', { class: 'qa-name' }, Icon(x.icon || 'link', 'sm'), h('b', null, x.name)), h('code', { class: 'qa-link', dir: 'ltr' }, decodeURIComponent(x.link)),
      h('span', { class: 'qa-acts' }, Button({ size: 'sm', type: 'text', label: 'جرّب', onClick: () => run(x.link) }), Button({ size: 'sm', type: 'text', label: 'تعديل', attrs: { 'data-qa-edit': x.id }, onClick: () => edit(x, R) }), Button({ size: 'sm', type: 'text', label: 'امسح', attrs: { 'data-qa-del': x.id }, onClick: () => K.confirm({ title: 'تمسح «' + x.name + '»؟', text: 'هيتشال من قايمة «إجراءات سريعة» بس — الصفحة نفسها مش هتتأثر.', okLabel: 'امسح', okType: 'danger', onOk: () => { L.splice(L.indexOf(x), 1); persistQuick(); R(); } }) }))]);
    const tbl = L.length ? U.Table({ cls: 'dt qa-table', headers: ['الترتيب', 'الاسم', 'اللينك', ''], rows }) : null;
    if (tbl) setTimeout(() => {
      const trs = [...tbl.querySelectorAll('tbody tr')];
      trs.forEach((tr, i) => tr.setAttribute('data-qa-item', L[i] ? L[i].id : String(i)));
      const body = tbl.querySelector('tbody');
      K.sortableRows(body, 'data-qa-item', (ids) => { const next = ids.map((id) => L.find((y) => String(y.id) === id)).filter(Boolean); if (next.length === L.length) { L.length = 0; next.forEach((y) => L.push(y)); K.logEvent('quick.reorder', next.map((y) => y.name).join(' · ')); persistQuick(); R(); } });
    }, 0);
    return K.Section('الإجراءات السريعة', [tbl || K.Empty('مفيش إجراءات سريعة', 'ضيف أول إجراء — أي صفحة بفلاترها.'),
      U.InlineNote({ children: 'أي صفحة في السيستم ينفع تبقى إجراء سريع بفلاترها أو تقاريرها: افتح الصفحة واختار اللي عايزه، وبعدين من «إجراءات سريعة» فوق اختار «ضيف الصفحة دي» — أو الصق اللينك هنا وسمّيه اللي انت عايزه.' })],
    [Button({ type: 'text', label: 'رجوع للافتراضي', onClick: () => K.confirm({ title: 'ترجّع الإجراءات السريعة للافتراضي؟', text: 'الإجراءات اللي ضفتها هتتشال.', okLabel: 'رجّع', onOk: () => { K.store.quickActions = Q.DEFAULTS.map((y) => Object.assign({}, y)); persistQuick(); R(); } }) }), Button({ type: 'primary', icon: 'plus', label: 'إجراء جديد', attrs: { 'data-qa-new': '' }, onClick: () => edit(null, R) })],
    { sub: 'بتظهر في قايمة «إجراءات سريعة» فوق في كل الصفحات — بالترتيب ده. اسحب من المسكة عشان ترتّب.' });
  }
  // orders filters live inside the orders shadow app
  handle('orders', () => (window.OrdersApp && window.OrdersApp.getFilters ? window.OrdersApp.getFilters() : {}), (q) => { if (window.OrdersApp && window.OrdersApp.setFilters) window.OrdersApp.setFilters(q); });
  window.IBQuick = { Menu, manage, handle, run, edit, list, currentLink, persist: persistQuick };
})();

