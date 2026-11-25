/* «افتح التفاصيل» under a number in an assistant's chat (Safwat 25 Nov — «في حالة طلب اي بيانات يقول بالرقم في الشات و يجيبلي لينك
   لبوب اب افتح فيه البيانات و اعملها مشاركة»; docs/superpowers/plans/2026-11-25-agent-chat-flows.md, phase 2). Not a block.
   The chat says the number the server counted (IBAgentBrain on ai_agent_facts); this file lists the rows behind it from what the
   member's own pages hold — read under his own rights, never a row more — in a popup with «مشاركة» (IBShare) and the page's link.
   No model behind it, and no number of its own.
     IBAgentDetails.has(key)            → a list exists for the metric (else the answer has the page's link only)
     IBAgentDetails.go(key)             → { hash, label } the page the metric lives on, or null
     IBAgentDetails.rowsOf(key, src)    → pure: { title, headers, rows } | null — src (all optional):
         { orders: [{ id, customer, status, confirm, ageDays, total, delivery }]  (OrdersApp.query rows)
           lateVendors: [{ vendor, count }], tickets: [{ id, title, priority, status, followUp, assigneeRole, assigneeMemberName }],
           returns: [{ name, vendor, sub, sku, at, status }], convs: [{ seg, status, handle, platform, waiting, assignee }],
           withdrawals: [{ id, vendorId, amount, status, at }], vendorName(id), expenses: [{ category, subName, subEnds, voided }],
           hrRequests: [{ member, type, from, to, status }], overtime: [{ member, date, minutes, status }], memberName(code),
           priorityName(code), today (YYYY-MM-DD) }
     IBAgentDetails.open(key, label)    → the popup (browser only) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBAgentDetails = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
  const TICKET_OPEN = ['open', 'in_progress', 'waiting', 'reopened'];
  const HR_WAITING = ['جديد', 'قيد المراجعة'];
  const n0 = (v) => Math.round(Number(v) || 0);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const confirmed = (cf) => /^مؤكد/.test(String(cf == null ? '' : cf)); // = _shared/delay.js isConfirmed (the server's count)
  const ORDER_HEAD = ['رقم الأوردر', 'العميل', 'الحالة', 'التأكيد', 'عمره (يوم)', 'الإجمالي'];
  const orderRows = (L) => L.slice().sort((a, b) => (Number(b.ageDays) || 0) - (Number(a.ageDays) || 0)).map((o) => ['#' + o.id, o.customer || '', o.status || '', o.confirm || '', n0(o.ageDays), n0(o.total)]);
  const openOrders = (s) => arr(s.orders).filter((o) => !CLOSED.includes(o.status));
  const openTickets = (s) => arr(s.tickets).filter((t) => TICKET_OPEN.includes(t.status));
  const TICKET_HEAD = ['الرقم', 'العنوان', 'الأولوية', 'المسؤول', 'المتابعة'];
  const ticketRows = (L, s) => L.map((t) => [String(t.id), t.title || '', s.priorityName ? s.priorityName(t.priority) : t.priority || '', t.assigneeMemberName || t.assigneeRole || '', t.followUp ? String(t.followUp).slice(0, 10) : '—']);
  const member = (s, code) => (s.memberName ? s.memberName(code) : '') || code || '';
  const D = 86400000;

  /** The rows behind a metric (agent-rules.js METRICS) — the same rule the server counts by, on the rows the member's pages hold. */
  const READ = {
    orders_unconfirmed: (s) => ({ title: 'أوردرات مفتوحة مستنية تأكيد', headers: ORDER_HEAD, rows: orderRows(openOrders(s).filter((o) => !confirmed(o.confirm))) }),
    orders_late: (s) => ({ title: 'الأوردرات المتأخرة', headers: ORDER_HEAD, rows: orderRows(openOrders(s).filter((o) => o.delivery === 'late')) }),
    orders_risk: (s) => ({ title: 'الأوردرات القابلة للتأخير', headers: ORDER_HEAD, rows: orderRows(openOrders(s).filter((o) => o.delivery === 'risk')) }),
    makers_late: (s) => ({ title: 'المبتكرين اللي عندهم منتجات متأخرة', headers: ['المبتكر', 'أوردرات فرعية متأخرة'], rows: arr(s.lateVendors).map((v) => [v.vendor, n0(v.count)]) }),
    tickets_urgent: (s) => ({ title: 'الطلبات العاجلة المفتوحة', headers: TICKET_HEAD, rows: ticketRows(openTickets(s).filter((t) => t.priority === 'urgent'), s) }),
    tickets_overdue: (s) => ({ title: 'طلبات عدّى ميعاد متابعتها', headers: TICKET_HEAD, rows: ticketRows(openTickets(s).filter((t) => t.followUp && String(t.followUp).slice(0, 10) < String(s.today || '')), s) }),
    returns_waiting: (s) => ({ title: 'مرتجعات مستنية الفحص', headers: ['المنتج', 'المبتكر', 'SKU', 'الأوردر الفرعي', 'رجع يوم'], rows: arr(s.returns).filter((r) => r.status === 'بانتظار الفحص').map((r) => [r.name || '', r.vendor || '', r.sku || '', r.sub || '', r.at || '']) }),
    cs_waiting: (s) => ({ title: 'محادثات مستنية ردنا', headers: ['العميل', 'القناة', 'مستنية من (دقيقة)', 'المسؤول'], rows: arr(s.convs).filter((c) => c.seg === 'customers' && c.status === 'مستنية ردنا').sort((a, b) => (Number(b.waiting) || 0) - (Number(a.waiting) || 0)).map((c) => [c.handle || '', c.platform || '', n0(c.waiting), c.assignee || '']) }),
    withdraw_pending: (s) => ({ title: 'طلبات سحب مستنية الموافقة', headers: ['الرقم', 'المبتكر', 'المبلغ', 'التاريخ'], rows: arr(s.withdrawals).filter((w) => w.status === 'pending').map((w) => ['#' + w.id, (s.vendorName && s.vendorName(w.vendorId)) || '', n0(w.amount), String(w.at || '').slice(0, 10)]) }),
    sub_days_left: (s) => { const t = String(s.today || ''); const t0 = Date.parse(t + 'T00:00:00Z');
      return { title: 'الاشتراكات اللي لسه شغّالة', headers: ['الاشتراك', 'بيخلص يوم', 'فاضل (يوم)'],
        rows: arr(s.expenses).filter((e) => !e.voided && e.subEnds && String(e.subEnds).slice(0, 10) >= t).sort((a, b) => (a.subEnds < b.subEnds ? -1 : 1))
          .map((e) => [e.subName || e.category || '', String(e.subEnds).slice(0, 10), Math.round((Date.parse(String(e.subEnds).slice(0, 10) + 'T00:00:00Z') - t0) / D)]) }; },
    hr_requests_pending: (s) => ({ title: 'طلبات موارد بشرية مستنية قرار', headers: ['الموظف', 'النوع', 'من', 'إلى', 'الحالة'], rows: arr(s.hrRequests).filter((r) => HR_WAITING.includes(r.status)).map((r) => [member(s, r.member), r.type || '', r.from || '', r.to || '', r.status]) }),
    overtime_pending: (s) => ({ title: 'وقت إضافي مستني موافقة', headers: ['الموظف', 'اليوم', 'المدة (دقيقة)'], rows: arr(s.overtime).filter((o) => o.status === 'مستني').map((o) => [member(s, o.member), o.date || '', n0(o.minutes)]) }),
  };
  READ.cs_waiting_minutes = READ.cs_waiting;
  /** The page each metric lives on (the hash the app routes) — «افتح الصفحة» in the popup, or the answer's only link. */
  const GO = {
    orders_unconfirmed: ['orders', 'الأوردرات'], orders_late: ['orders', 'الأوردرات'], orders_risk: ['orders', 'الأوردرات'], makers_late: ['makers', 'المبتكرين'],
    tickets_urgent: ['tickets', 'طلبات الفريق'], tickets_overdue: ['tickets', 'طلبات الفريق'], design_requests: ['tickets', 'طلبات الفريق'],
    returns_waiting: ['inventory-returns', 'المرتجعات'], cs_waiting: ['cs', 'خدمة العملاء'], cs_waiting_minutes: ['cs', 'خدمة العملاء'],
    makers_no_bank: ['makers', 'المبتكرين'], withdraw_pending: ['makers', 'حسابات المبتكرين'], sub_days_left: ['accounts', 'الحسابات'],
    hr_requests_pending: ['hr', 'الموارد البشرية'], overtime_pending: ['hr', 'الموارد البشرية'],
    ads_suggestions: ['marketing', 'التسويق'], ads_spend_week: ['marketing', 'التسويق'], posts_failed: ['marketing', 'التسويق'],
  };
  const has = (key) => Object.prototype.hasOwnProperty.call(READ, key);
  const go = (key) => (GO[key] ? { hash: GO[key][0], label: GO[key][1] } : null);
  function rowsOf(key, src) { if (!has(key)) return null; const r = READ[key](src || {}); return r ? { title: r.title, headers: r.headers, rows: r.rows } : null; }

  // ---- the browser: the member's own pages' rows (each adapter read under his rights — a page he cannot see holds nothing)
  function today() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function gather() {
    const w = root || {}; const s = { today: today() };
    try { const O = w.OrdersApp; if (O) { s.orders = O.query({}, 100000).rows; s.lateVendors = O.alerts().lateVendors; } } catch (e) { /* the orders page is not loaded */ }
    try { if (w.IBTickets && w.IBTickets.all) s.tickets = w.IBTickets.all(); } catch (e) { /* not loaded */ }
    const K = w.IBKit; s.returns = K && K.store && Array.isArray(K.store.returns) ? K.store.returns : [];
    s.convs = w.IBCS && w.IBCS.data && Array.isArray(w.IBCS.data.convs) ? w.IBCS.data.convs : [];
    const A = w.IBAccounts; if (A && A.withdrawals) { s.withdrawals = A.withdrawals(); s.expenses = A.rows ? A.rows('expenses').map((e) => ({ category: e.category, subName: e.subName, subEnds: e.subEnds, voided: !!e.voided })) : []; }
    const V = w.IBVendors && w.IBVendors.store; s.vendorName = (id) => { const v = V && V.get ? V.get(id) : null; return v ? v.name : ''; };
    const H = w.IBHR; if (H && H.data) { s.hrRequests = H.data.requests || []; s.overtime = H.data.overtime || []; }
    s.memberName = (code) => { const m = H && H.everyone ? H.everyone().find((x) => x.id === code) : null; return m ? m.name : ''; };
    s.priorityName = (k) => { const P = w.IbtekrTickets && w.IbtekrTickets.PRIORITIES; const p = P && P.find((x) => x[0] === k); return p ? p[1] : k || ''; };
    return s;
  }
  function open(key, label) {
    const w = root || {}; const U = w.IBUI; const K = w.IBKit; if (!U || !U.Modal) return false;
    const r = rowsOf(key, gather()); const g = go(key); if (!r) return false;
    const { h, Button } = U; const title = r.title || label || 'التفاصيل';
    const sub = r.rows.length ? r.rows.length + (r.rows.length === 1 ? ' صف' : ' صفوف') : '';
    const table = r.rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl-v2 ag-det-tbl', 'data-ag-det-tbl': '' },
      h('thead', null, h('tr', null, r.headers.map((x) => h('th', null, x)))),
      h('tbody', null, r.rows.map((row) => h('tr', null, row.map((c) => h('td', null, typeof c === 'number' && K && K.n0 ? K.n0(c) : String(c))))))))
      : h('p', { class: 't-small help', 'data-ag-det-empty': '' }, 'مفيش صفوف تقدر تشوفها هنا دلوقتي — الرقم اتعدّ على السيرفر، وممكن الصفحة لسه بتتحمّل أو مش من صلاحياتك.');
    const share = () => { if (!w.IBShare) return; w.IBShare.open({ title, sub: sub, name: title, headers: r.headers, rows: r.rows }); };
    let m = null;
    const foot = [Button({ label: 'اقفل', onClick: () => m.close() })]
      .concat(g ? [Button({ label: 'افتح ' + g.label, attrs: { 'data-ag-det-go': g.hash }, onClick: () => { m.close(); w.location.hash = g.hash; } })] : [])
      .concat(r.rows.length && w.IBShare ? [Button({ type: 'primary', icon: 'share', label: 'مشاركة', attrs: { 'data-ag-det-share': '' }, onClick: share })] : []);
    m = U.Modal({ title, body: [sub ? h('p', { class: 't-small help', style: 'margin:0 0 8px' }, sub) : null, table].filter(Boolean), footer: foot });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-ag-det', key); }
    return true;
  }
  return Object.freeze({ has, go, rowsOf, open, gather, _test: { READ, GO } });
});
