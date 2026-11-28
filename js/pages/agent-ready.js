/* The rows behind a report's element › type › state (0171 — Safwat 25 Nov; docs/superpowers/plans/2026-11-25-agent-chat-flows.md,
   phase 3). Not a block. The chat header's ready requests / reports menu it drew is now «إجراءات ذكية» (IBSmartActions —
   2026-11-28-smart-actions.md); what stays here is the reading: a report = element › data type › state rows from the notifications'
   catalog (IBNotifCatalog), each read from the member's own pages under his own rights (IBAgentDetails.gather) — no model behind it.
   Only the states with a list behind them can be in a report (READERS).
     IBAgentReady.reportable(element, type, state) → a list exists
     IBAgentReady.rowsOfPart(part, src)            → pure: { title, headers, rows } | null
     IBAgentReady.partLabel(part, lists)           → «الأوردرات › حالة التأخير › متأخر»
     IBAgentReady.requestPre(item, lists)          → { title, details } for the request popup */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBAgentReady = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const C = () => w.IBNotifCatalog; const DT = () => w.IBAgentDetails;
  const CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
  const arr = (v) => (Array.isArray(v) ? v : []);
  const n0 = (v) => Math.round(Number(v) || 0);
  const confirmed = (cf) => /^مؤكد/.test(String(cf == null ? '' : cf));
  const openOrders = (s) => arr(s.orders).filter((o) => !CLOSED.includes(o.status));
  // a metric's list of the details popup (phase 2) under the report's own title
  const viaMetric = (key, title) => (s) => { const D = DT(); const r = D && D.rowsOf ? D.rowsOf(key, s) : null; return r ? { title: title || r.title, headers: r.headers, rows: r.rows } : null; };
  const PROD_HEAD = ['المنتج', 'SKU', 'القسم', 'الكمية', 'المبتكر'];
  const prodRows = (s, title, ok) => ({ title, headers: PROD_HEAD, rows: arr(s.products).filter(ok).map((p) => [p.name || '', p.sku || '', arr(p.cats).join('، '), p.stock == null ? '—' : n0(p.stock), (s.vendorName && p.vendorId != null && s.vendorName(p.vendorId)) || '—']) });
  const HR_WAIT = ['جديد', 'قيد المراجعة'];
  const hrRows = (s, title, re) => { const L = arr(s.hrRequests).filter((r) => HR_WAIT.includes(r.status) && re.test(String(r.type || '')));
    return { title, headers: ['الموظف', 'النوع', 'من', 'إلى', 'الحالة'], dates: L.map((r) => String(r.from || '').slice(0, 10)), rows: L.map((r) => [(s.memberName && s.memberName(r.member)) || r.member || '', r.type || '', r.from || '', r.to || '', r.status || '']) }; };
  const LATE_MIN = 60; // «رسايل متأخرة» = waiting an hour or more (the SLA's default — settings.cs.sla_late_min)
  // the report popup (Safwat 28 Nov — «يطلع بكل البيانات اللي ليها علاقة بالعناصر و نوع البيانات و الوضع … و اختيار الفترة»): every column
  // the element's rows have on the member's pages (no phone and no address — the report goes out by «مشاركة»), each row's day in
  // `dates` (the period filters by it; none = a «now» list with no period) and the money columns in `sum` (their total under the table)
  const day = (v) => String(v == null ? '' : v).slice(0, 10);
  const fmt = (v) => { const d = day(v); const D = w.IbtekrDomain; return !d ? '—' : D && D.formatDateNumeric ? D.formatDateNumeric(d) : d; };
  const DELAY_NAME = { late: 'متأخر', risk: 'قابل للتأخير', ok: 'في الميعاد' };
  const infoOf = (s, id) => (s.orderOf ? s.orderOf(id) : null) || {};
  const ORDER_FULL = ['رقم الأوردر', 'العميل', 'المحافظة', 'الحالة', 'التأكيد', 'تاريخ الأوردر', 'تاريخ التأكيد', 'عمره (يوم)', 'المبتكرين', 'أوردرات فرعية', 'القطع', 'التأخير', 'العربون', 'الإجمالي'];
  function ordersFull(s, L, title) {
    const list = L.slice().sort((a, b) => (Number(b.ageDays) || 0) - (Number(a.ageDays) || 0));
    return { title, headers: ORDER_FULL, sum: [12, 13], dates: list.map((o) => day(infoOf(s, o.id).date)),
      rows: list.map((o) => { const d = infoOf(s, o.id); const subs = arr(d.subs);
        const groups = new Set(subs.map((x) => (x.sid && String(x.sid) !== String(o.id) ? 's' + x.sid : 'v' + (x.vendor || ''))));
        return ['#' + o.id, o.customer || '', d.stateName || d.city || '—', o.status || '', o.confirm || '', fmt(d.date), fmt(d.confAt), n0(o.ageDays), arr(o.vendors).join('، ') || '—',
          subs.length ? groups.size : arr(o.vendors).length, subs.length ? subs.reduce((t, x) => t + (Number(x.qty) || 1), 0) : arr(o.lines).length, DELAY_NAME[o.delivery] || '—', n0(d.dep), n0(o.total)]; }) };
  }
  // a maker's late / at-risk products: a row per product line (its order, sub-order, product and status) — the picked makers' lines only
  const LINE_FULL = ['المبتكر', 'رقم الأوردر', 'الأوردر الفرعي', 'المنتج', 'SKU', 'الكمية', 'حالة المنتج', 'العميل', 'تاريخ الأوردر', 'عمره (يوم)'];
  function linesFull(s, want, title) {
    const rows = []; const dates = [];
    for (const o of openOrders(s)) {
      const d = infoOf(s, o.id); const subs = arr(d.subs);
      arr(o.lines).forEach((ln, i) => {
        if (!ln || ln.delivery !== want) return; const x = subs[i] || {};
        if (s.makersPicked && !s.makersPicked.has(String(x.vendor || ''))) return;
        rows.push([x.vendor || '—', '#' + o.id, x.sid && String(x.sid) !== String(o.id) ? '#' + x.sid : '—', x.prod || '—', x.sku || '—', n0(x.qty || 1), x.ss || '—', o.customer || '', fmt(d.date), n0(o.ageDays)]);
        dates.push(day(d.date));
      });
    }
    return { title, headers: LINE_FULL, rows, dates };
  }
  const TT = () => w.IbtekrTickets;
  const tkName = (list, v) => { const l = (TT() && TT()[list]) || []; return ((l.find((x) => x[0] === v) || [])[1]) || v || '—'; };
  const TK_FULL = ['الرقم', 'العنوان', 'النوع', 'الأولوية', 'الحالة', 'المسؤول', 'فتحه', 'اتفتح يوم', 'المتابعة'];
  const TK_OPEN = ['open', 'in_progress', 'waiting', 'reopened'];
  const ticketsFull = (s, L, title) => ({ title, headers: TK_FULL, dates: L.map((t) => day(t.createdAt)),
    rows: L.map((t) => [String(t.id), t.title || '', tkName('TYPES', t.type), s.priorityName ? s.priorityName(t.priority) : t.priority || '', tkName('STATUSES', t.status),
      t.assigneeMemberName || t.assigneeRole || '', (t.createdBy && t.createdBy.name) || '', fmt(t.createdAt), t.followUp ? fmt(t.followUp) : '—']) });
  const RET_WAIT = 'بانتظار الفحص';
  const returnsFull = (s) => { const L = arr(s.returns).filter((r) => r.status === RET_WAIT);
    return { title: 'مرتجعات مستنية الفحص', headers: ['المنتج', 'المبتكر', 'SKU', 'الأوردر الفرعي', 'النوع', 'السبب', 'الملكية', 'رجع يوم'], dates: L.map((r) => day(r.at)),
      rows: L.map((r) => [r.name || '', r.vendor || '', r.sku || '', r.sub || '—', r.type || '—', r.reason || '—', r.mode || '—', fmt(r.at)]) }; };
  const WD_NAME = { pending: 'مستني الموافقة', approved: 'اتوافق عليه', cancelled: 'اترفض' };
  const withdrawFull = (s) => { const L = arr(s.withdrawals).filter((x) => x.status === 'pending');
    return { title: 'طلبات سحب مستنية الموافقة', headers: ['الرقم', 'المبتكر', 'المبلغ', 'الحالة', 'التاريخ'], sum: [2], dates: L.map((x) => day(x.at)),
      rows: L.map((x) => ['#' + x.id, (s.vendorName && s.vendorName(x.vendorId)) || '', n0(x.amount), WD_NAME[x.status] || x.status || '', fmt(x.at)]) }; };
  const subsFull = (s) => { const t = day(s.today); const t0 = Date.parse(t + 'T00:00:00Z');
    const L = arr(s.expenses).filter((e) => !e.voided && e.subEnds && day(e.subEnds) >= t).sort((a, b) => (day(a.subEnds) < day(b.subEnds) ? -1 : 1));
    return { title: 'الاشتراكات اللي لسه شغّالة', headers: ['الاشتراك', 'النوع', 'بيخلص يوم', 'فاضل (يوم)'], dates: L.map((e) => day(e.subEnds)),
      rows: L.map((e) => [e.subName || e.category || '', e.category || '—', fmt(e.subEnds), Math.round((Date.parse(day(e.subEnds) + 'T00:00:00Z') - t0) / 86400000)]) }; };
  const OT_NAME = { 'مستني': 'مستني موافقة' };
  const overtimeFull = (s) => { const L = arr(s.overtime).filter((o) => o.status === 'مستني');
    return { title: 'وقت إضافي مستني موافقة', headers: ['الموظف', 'اليوم', 'المدة (دقيقة)', 'الحالة'], dates: L.map((o) => day(o.date)),
      rows: L.map((o) => [(s.memberName && s.memberName(o.member)) || o.member || '', fmt(o.date), n0(o.minutes), OT_NAME[o.status] || o.status || '']) }; };

  /** element.type.state (or element.type.* for the lists the statuses come from) → the rows behind it on the member's pages. */
  const READERS = {
    'orders.delay.late': (s) => ordersFull(s, openOrders(s).filter((o) => o.delivery === 'late'), 'الأوردرات المتأخرة'),
    'orders.delay.risk': (s) => ordersFull(s, openOrders(s).filter((o) => o.delivery === 'risk'), 'الأوردرات القابلة للتأخير'),
    'orders.delay.ok': (s) => ordersFull(s, openOrders(s).filter((o) => o.delivery !== 'late' && o.delivery !== 'risk'), 'الأوردرات المفتوحة غير المتأخرة'),
    'orders.confirm.*': (s, st) => ordersFull(s, openOrders(s).filter((o) => (st === 'غير مؤكد' ? !confirmed(o.confirm) : String(o.confirm || '') === st)), 'أوردرات مفتوحة — ' + st),
    'orders.status.*': (s, st) => ordersFull(s, arr(s.orders).filter((o) => o.status === st), 'أوردرات «' + st + '»'),
    'subs.delay.late': (s) => linesFull(s, 'late', 'منتجات متأخرة في الأوردرات الفرعية'),
    'makers.making.late': (s) => linesFull(s, 'late', 'المبتكرين المتأخرين — منتجاتهم المتأخرة'),
    'makers.making.risk': (s) => linesFull(s, 'risk', 'المبتكرين القابلين للتأخير — منتجاتهم'),
    'makers.accounts.withdraw_wait': withdrawFull,
    'products.returns.wait': returnsFull,
    'tickets.type.late': (s) => ticketsFull(s, arr(s.tickets).filter((t) => TK_OPEN.includes(t.status) && t.followUp && day(t.followUp) < day(s.today)), 'طلبات عدّى ميعاد متابعتها'),
    'messages.customers.waiting': viaMetric('cs_waiting'),
    'messages.customers.late': (s) => { const r = viaMetric('cs_waiting')(s); return r ? { title: 'رسايل عملاء متأخرة (ساعة أو أكتر)', headers: r.headers, rows: r.rows.filter((x) => Number(x[2]) >= LATE_MIN) } : null; },
    'accounts.subs.due': subsFull,
    // the ask popups (docs/superpowers/plans/2026-11-28-ask-popups.md, phase A): the products' stock from the mirror with their categories,
    // the team's waiting HR requests by kind and its waiting overtime, and the team requests still new
    'products.stock.out': (s) => prodRows(s, 'المنتجات اللي كميتها نفدت', (p) => p.out),
    'products.stock.left1': (s) => prodRows(s, 'منتجات باقي منها 1', (p) => p.stock === 1),
    'products.stock.left3': (s) => prodRows(s, 'منتجات باقي منها 3 أو أقل', (p) => p.stock != null && p.stock > 0 && p.stock <= 3),
    'team.update.req_leave': (s) => hrRows(s, 'طلبات إجازة مستنية قرار', /اجاز|إجاز/),
    'team.update.req_advance': (s) => hrRows(s, 'طلبات سلفة مستنية قرار', /سلف/),
    'team.update.req_rest': (s) => hrRows(s, 'طلبات فترة راحة مستنية قرار', /راح/),
    'team.update.req_ot': overtimeFull,
    'tickets.type.new': (s) => ticketsFull(s, arr(s.tickets).filter((t) => t.status === 'open'), 'طلبات الفريق الجديدة'),
  };
  const readerOf = (p) => { if (!p) return null; const k = p.element + '.' + p.type; return READERS[k + '.' + p.state] || READERS[k + '.*'] || null; };
  const reportable = (element, type, state) => !!readerOf({ element, type, state });
  function rowsOfPart(part, src) {
    const f = readerOf(part); if (!f) return null; const r = f(src || {}, part.state); if (!r) return null;
    const out = { title: r.title, headers: r.headers, rows: r.rows };
    if (Array.isArray(r.dates) && r.dates.length === r.rows.length) out.dates = r.dates; if (Array.isArray(r.sum)) out.sum = r.sum;
    return out;
  }

  const lists = () => { const S = w.IBSettings; try { return S && S.notifLists ? S.notifLists() : {}; } catch (e) { return {}; } };
  /** «الأوردرات › حالة التأخير › متأخر» — the catalog's own names, the stored ids if it does not know them. */
  function partLabel(p, L) {
    const c = C(); if (!c) return [p.element, p.type, p.state].join(' › ');
    const e = c.el(p.element); const t = c.typeOf(p.element, p.type); const s = c.stateOf(p.element, p.type, p.state, L || lists());
    return [(e && e.label) || p.element, (t && t.label) || p.type, (s && s.label) || p.state].join(' › ');
  }
  function requestPre(item, L) {
    const parts = arr(item && item.parts);
    return { title: String((item && item.name) || '').slice(0, 80), details: parts.length ? 'العناصر:\n' + parts.map((p) => '• ' + partLabel(p, L)).join('\n') : '' };
  }

  return Object.freeze({ reportable, rowsOfPart, partLabel, requestPre, _test: { READERS } });
});
