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
  const ORDER_HEAD = ['رقم الأوردر', 'العميل', 'الحالة', 'التأكيد', 'عمره (يوم)', 'الإجمالي'];
  const orderRows = (L) => L.slice().sort((a, b) => (Number(b.ageDays) || 0) - (Number(a.ageDays) || 0)).map((o) => ['#' + o.id, o.customer || '', o.status || '', o.confirm || '', n0(o.ageDays), n0(o.total)]);
  const openOrders = (s) => arr(s.orders).filter((o) => !CLOSED.includes(o.status));
  // a metric's list of the details popup (phase 2) under the report's own title
  const viaMetric = (key, title) => (s) => { const D = DT(); const r = D && D.rowsOf ? D.rowsOf(key, s) : null; return r ? { title: title || r.title, headers: r.headers, rows: r.rows } : null; };
  const PROD_HEAD = ['المنتج', 'SKU', 'القسم', 'الكمية'];
  const prodRows = (s, title, ok) => ({ title, headers: PROD_HEAD, rows: arr(s.products).filter(ok).map((p) => [p.name || '', p.sku || '', arr(p.cats).join('، '), p.stock == null ? '—' : n0(p.stock)]) });
  const HR_WAIT = ['جديد', 'قيد المراجعة'];
  const hrRows = (s, title, re) => ({ title, headers: ['الموظف', 'النوع', 'من', 'إلى'], rows: arr(s.hrRequests).filter((r) => HR_WAIT.includes(r.status) && re.test(String(r.type || ''))).map((r) => [(s.memberName && s.memberName(r.member)) || r.member || '', r.type || '', r.from || '', r.to || '']) });
  const LATE_MIN = 60; // «رسايل متأخرة» = waiting an hour or more (the SLA's default — settings.cs.sla_late_min)

  /** element.type.state (or element.type.* for the lists the statuses come from) → the rows behind it on the member's pages. */
  const READERS = {
    'orders.delay.late': viaMetric('orders_late'),
    'orders.delay.risk': viaMetric('orders_risk'),
    'orders.delay.ok': (s) => ({ title: 'الأوردرات المفتوحة غير المتأخرة', headers: ORDER_HEAD, rows: orderRows(openOrders(s).filter((o) => o.delivery !== 'late' && o.delivery !== 'risk')) }),
    'orders.confirm.*': (s, st) => ({ title: 'أوردرات مفتوحة — ' + st, headers: ORDER_HEAD, rows: orderRows(openOrders(s).filter((o) => (st === 'غير مؤكد' ? !confirmed(o.confirm) : String(o.confirm || '') === st))) }),
    'orders.status.*': (s, st) => ({ title: 'أوردرات «' + st + '»', headers: ORDER_HEAD, rows: orderRows(arr(s.orders).filter((o) => o.status === st)) }),
    'subs.delay.late': viaMetric('makers_late'),
    'makers.making.late': viaMetric('makers_late'),
    'makers.making.risk': viaMetric('orders_risk', 'أوردرات قابلة للتأخير'),
    'makers.accounts.withdraw_wait': viaMetric('withdraw_pending'),
    'products.returns.wait': viaMetric('returns_waiting'),
    'tickets.type.late': viaMetric('tickets_overdue'),
    'messages.customers.waiting': viaMetric('cs_waiting'),
    'messages.customers.late': (s) => { const r = viaMetric('cs_waiting')(s); return r ? { title: 'رسايل عملاء متأخرة (ساعة أو أكتر)', headers: r.headers, rows: r.rows.filter((x) => Number(x[2]) >= LATE_MIN) } : null; },
    'accounts.subs.due': viaMetric('sub_days_left'),
    // the ask popups (docs/superpowers/plans/2026-11-28-ask-popups.md, phase A): the products' stock from the mirror with their categories,
    // the team's waiting HR requests by kind and its waiting overtime, and the team requests still new
    'products.stock.out': (s) => prodRows(s, 'المنتجات اللي كميتها نفدت', (p) => p.out),
    'products.stock.left1': (s) => prodRows(s, 'منتجات باقي منها 1', (p) => p.stock === 1),
    'products.stock.left3': (s) => prodRows(s, 'منتجات باقي منها 3 أو أقل', (p) => p.stock != null && p.stock > 0 && p.stock <= 3),
    'team.update.req_leave': (s) => hrRows(s, 'طلبات إجازة مستنية قرار', /اجاز|إجاز/),
    'team.update.req_advance': (s) => hrRows(s, 'طلبات سلفة مستنية قرار', /سلف/),
    'team.update.req_rest': (s) => hrRows(s, 'طلبات فترة راحة مستنية قرار', /راح/),
    'team.update.req_ot': viaMetric('overtime_pending'),
    'tickets.type.new': (s) => ({ title: 'طلبات الفريق الجديدة', headers: ['الرقم', 'العنوان', 'المسؤول', 'فتحه'], rows: arr(s.tickets).filter((t) => t.status === 'open').map((t) => [String(t.id), t.title || '', t.assigneeMemberName || t.assigneeRole || '', (t.createdBy && t.createdBy.name) || '']) }),
  };
  const readerOf = (p) => { if (!p) return null; const k = p.element + '.' + p.type; return READERS[k + '.' + p.state] || READERS[k + '.*'] || null; };
  const reportable = (element, type, state) => !!readerOf({ element, type, state });
  function rowsOfPart(part, src) { const f = readerOf(part); if (!f) return null; const r = f(src || {}, part.state); return r ? { title: r.title, headers: r.headers, rows: r.rows } : null; }

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
