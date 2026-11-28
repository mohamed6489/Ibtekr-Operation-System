/* «طلبات جاهزة» و«تقارير جاهزة» in an assistant's chat (Safwat 25 Nov — «القايمتين حطهم بدل تقديم طلب يبقا فيه طلبات جاهزة و تقارير
   جاهزة»; docs/superpowers/plans/2026-11-25-agent-chat-flows.md, phase 3 — 0171). Not a block.
   The chat header's «تقديم طلب» is a menu: the old «تقديم طلب» first, then the ready requests and the ready reports of this assistant
   the member's role sees, and for the admin «+ طلب جاهز» / «+ تقرير جاهز» (and ✎ / 🗑 on each). An item = a name and element › data
   type › state rows from the notifications' catalog (IBNotifCatalog) — no time, repeat, visibility, channels or level.
     a ready request → the «طلب جديد» popup filled (its name, and its elements as the details); the member presses «ابعت»
     a ready report  → a table popup of the member's own rows — read from his own pages under his own rights (IBAgentDetails.gather),
                       a chip per element when there are several, «مشاركة» (IBShare) — no model behind it and no row more
   Only the states with a list behind them can be in a report (READERS); a request takes any.
     IBAgentReady.reportable(element, type, state) → a list exists
     IBAgentReady.rowsOfPart(part, src)            → pure: { title, headers, rows } | null
     IBAgentReady.requestPre(item, lists)          → { title, details } for the request popup
     IBAgentReady.menu(agentId, { ask, request, canAsk, admin, redraw }) → the header's button and its menu
     IBAgentReady.openReport(item) / form(agentId, kind, item, done) */
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

  // ---- the browser
  const U = () => w.IBUI; const K = () => w.IBKit; const MK = () => w.IBMarketing;
  const toast = (t, k) => { const k0 = K(); if (k0 && k0.toast) k0.toast(t, k); };
  function openReport(item) {
    const u = U(); if (!u || !u.Modal) return null; const { h, Button } = u;
    const D = DT(); const src = D && D.gather ? D.gather() : {};
    const parts = arr(item.parts).map((p, i) => ({ i, label: partLabel(p), r: rowsOfPart(p, src) }));
    const st = { at: 0 }; const box = h('div', { 'data-ag-ready-body': '' }); let m = null;
    const cur = () => parts[st.at] || null;
    const draw = () => {
      const x = cur(); const r = x && x.r;
      box.replaceChildren(...[ // a null child is the text «null» (28 Nov)
        parts.length > 1 ? h('div', { class: 'chips ar-parts', role: 'group', 'aria-label': 'العنصر', style: 'margin:0 0 10px' }, parts.map((p) =>
          h('button', { type: 'button', class: 'chip' + (p.i === st.at ? ' on' : ''), 'aria-pressed': String(p.i === st.at), 'data-ag-ready-part': String(p.i), onClick: () => { st.at = p.i; draw(); } },
            p.label + (p.r ? ' (' + p.r.rows.length + ')' : '')))) : null,
        h('p', { class: 't-small help', style: 'margin:0 0 8px' }, x ? x.label + (r ? ' · ' + r.rows.length + (r.rows.length === 1 ? ' صف' : ' صفوف') : '') : ''),
        !r ? h('p', { class: 't-small help', 'data-ag-ready-empty': '' }, 'مفيش جدول للوضع ده — بيتاخد في الطلبات الجاهزة بس.')
          : r.rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl-v2 ag-det-tbl', 'data-ag-ready-tbl': '' },
            h('thead', null, h('tr', null, r.headers.map((c) => h('th', null, c)))),
            h('tbody', null, r.rows.map((row) => h('tr', null, row.map((c) => h('td', null, typeof c === 'number' && K() && K().n0 ? K().n0(c) : String(c))))))))
            : h('p', { class: 't-small help', 'data-ag-ready-empty': '' }, 'مفيش صفوف تقدر تشوفها هنا دلوقتي — ممكن الصفحة لسه بتتحمّل أو مش من صلاحياتك.')].filter(Boolean));
      if (m) m.setFooter(foot());
    };
    const share = () => { const x = cur(); if (!x || !x.r || !w.IBShare) return; w.IBShare.open({ title: item.name, sub: x.label, name: item.name, headers: x.r.headers, rows: x.r.rows }); };
    const foot = () => { const x = cur(); return [Button({ label: 'اقفل', onClick: () => m.close() })]
      .concat(x && x.r && x.r.rows.length && w.IBShare ? [Button({ type: 'primary', icon: 'share', label: 'مشاركة', attrs: { 'data-ag-ready-share': '' }, onClick: share })] : []); };
    draw();
    m = u.Modal({ title: item.name, body: [box], footer: foot(), share: false });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-ag-ready-report', item.id || ''); }
    return m;
  }

  // the admin's popup: the name, who sees it, and element › type › state rows (a report: the ones with a list only)
  function form(agentId, kind, item, done) {
    const u = U(); const c = C(); if (!u || !u.Modal || !c) return null; const { h, Button } = u;
    const L = lists(); const report = kind === 'report';
    const okState = (e, t, s) => !report || reportable(e, t, s);
    const elements = () => c.ELEMENTS.filter((e) => e.types.some((t) => c.statesOf(e.id, t.id, L).some((s) => okState(e.id, t.id, s.id))));
    const typesOf = (eid) => { const e = c.el(eid); return e ? e.types.filter((t) => c.statesOf(eid, t.id, L).some((s) => okState(eid, t.id, s.id))) : []; };
    const statesOf = (eid, tid) => (eid && tid ? c.statesOf(eid, tid, L).filter((s) => okState(eid, tid, s.id)) : []);
    const roles = ((w.IBDirectory && w.IBDirectory.roles ? w.IBDirectory.roles() : []) || []).filter((r) => r && r.id && r.id !== 'admin' && !r.hidden);
    const f = { name: (item && item.name) || '', role: (item && item.role) || '', parts: item && item.parts && item.parts.length ? item.parts.map((p) => Object.assign({}, p)) : [{ element: '', type: '', state: '' }] };
    let err = ''; let saving = false; let m = null; const box = h('div', { 'data-ag-ready-form': kind });
    const sel = (id, label, options, value, on) => u.Select({ id, label, options, value: value || '', placeholder: 'اختار', onChange: on });
    const draw = () => {
      box.replaceChildren(...[ // a null child is the text «null» (28 Nov)
        h('div', { class: 'row cols2' }, u.TextInput({ id: 'ag-rd-name', label: report ? 'اسم التقرير' : 'اسم الطلب', required: true, value: f.name, maxlength: 60, placeholder: report ? 'مثال: الأوردرات المتأخرة' : 'مثال: متابعة أوردر متأخر', onInput: (v) => { f.name = v; } }),
          sel('ag-rd-role', 'يظهر لـ', [{ value: '', label: 'كل اللي بيفتح المساعد' }].concat(roles.map((r) => ({ value: r.id, label: r.name || r.id }))), f.role, (v) => { f.role = v; draw(); })),
        h('div', { class: 'ag-rd-parts' }, f.parts.map((p, i) => h('div', { class: 'row cols3 ag-rd-part', 'data-ag-rd-part': String(i) },
          sel('ag-rd-el-' + i, i ? 'العنصر ' + (i + 1) : 'العنصر', elements().map((e) => ({ value: e.id, label: e.label })), p.element, (v) => { p.element = v; p.type = ''; p.state = ''; draw(); }),
          sel('ag-rd-ty-' + i, 'نوع البيانات', typesOf(p.element).map((t) => ({ value: t.id, label: t.label })), p.type, (v) => { p.type = v; p.state = ''; draw(); }),
          h('div', { class: 'ag-rd-st' }, sel('ag-rd-st-' + i, 'الوضع', statesOf(p.element, p.type).map((s) => ({ value: s.id, label: s.label })), p.state, (v) => { p.state = v; draw(); }),
            f.parts.length > 1 ? h('button', { type: 'button', class: 'chip-x ag-rd-x', 'aria-label': 'شيل العنصر ' + (i + 1), 'data-ag-rd-x': String(i), onClick: () => { f.parts.splice(i, 1); draw(); } }, '×') : null)))),
        f.parts.length < 6 ? Button({ size: 'sm', icon: 'plus', label: 'عنصر تاني', attrs: { 'data-ag-rd-more': '' }, onClick: () => { f.parts.push({ element: '', type: '', state: '' }); draw(); } }) : null,
        err ? u.InlineNote({ kind: 'error', children: err }) : u.InlineNote({ children: report ? 'التقرير بيعرض لكل عضو الصفوف اللي صفحاته بتوريهاله بس، وفيه «مشاركة».' : 'الطلب الجاهز بيفتح «طلب جديد» متملّي بالاسم والعناصر — والعضو هو اللي بيبعت.' })].filter(Boolean));
    };
    const save = async () => {
      if (saving) return; err = '';
      if (!String(f.name).trim()) err = 'اكتب الاسم'; else if (f.parts.some((p) => !p.element || !p.type || !p.state)) err = 'اختار العنصر ونوع البيانات والوضع في كل صف';
      if (err) { draw(); return; }
      saving = true; m.setFooter(foot());
      const r = await MK().readySave({ id: item && item.id, agent: agentId, kind, name: f.name, role: f.role || null, parts: f.parts }).catch(() => ({ ok: false, message: 'مافيش اتصال — جرّب تاني' }));
      saving = false;
      if (!r.ok) { err = r.message || 'تعذّر الحفظ'; draw(); m.setFooter(foot()); return; }
      m.close(); toast(item ? 'اتحفظ التعديل' : (report ? 'اتضاف التقرير الجاهز' : 'اتضاف الطلب الجاهز'), 'success'); if (typeof done === 'function') done();
    };
    const foot = () => [Button({ type: 'primary', label: saving ? 'بيتحفظ…' : 'حفظ', disabled: saving, attrs: { 'data-ag-rd-save': '' }, onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })];
    draw();
    m = u.Modal({ title: (item ? 'تعديل ' : '') + (report ? 'تقرير جاهز' : 'طلب جاهز'), body: [box], footer: foot() });
    if (m && m.el) m.el.classList.add('wide');
    return m;
  }

  // the header's button: «طلبات وتقارير» (the old «تقديم طلب» when there is nothing else to show)
  function menu(agentId, o) {
    const u = U(); if (!u) return null; const { h, Icon } = u; const opt = o || {};
    // a ready request opens the request popup: shown to who may open requests only
    const items = ((MK() && MK().readyNow ? MK().readyNow(agentId) : null) || []).filter((x) => x.kind === 'report' || opt.canAsk);
    if (!items.length && !opt.admin) return opt.canAsk ? u.Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'تقديم طلب', attrs: { 'data-mk-req-add': agentId }, onClick: () => opt.ask() }) : null;
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = u.Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'طلبات وتقارير', attrs: { 'data-ag-ready-btn': agentId, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    const reload = () => MK().readyList(agentId, true).then(() => { if (typeof opt.redraw === 'function') opt.redraw(); });
    const build = (close) => {
      const run = (fn) => () => { close(); fn(); };
      const row = (it) => h('div', { class: 'ag-rd-row' },
        h('button', { type: 'button', class: 'opt', role: 'menuitem', 'data-ag-ready': it.id, onClick: run(() => (it.kind === 'report' ? openReport(it) : opt.request(requestPre(it)))) }, Icon(it.kind === 'report' ? 'chart' : 'send', 'sm'), it.name),
        opt.admin ? h('span', { class: 'ag-rd-acts' },
          h('button', { type: 'button', class: 'ag-rd-ic', 'aria-label': 'تعديل ' + it.name, 'data-ag-ready-edit': it.id, onClick: run(() => form(agentId, it.kind, it, reload)) }, Icon('edit', 'sm')),
          h('button', { type: 'button', class: 'ag-rd-ic', 'aria-label': 'امسح ' + it.name, 'data-ag-ready-del': it.id, onClick: run(async () => { if (!w.confirm || w.confirm('تمسح «' + it.name + '»؟')) { const r = await MK().readyDelete(it.id, agentId); if (!r.ok) toast(r.message || 'تعذّر المسح', 'error'); else { toast('اتمسح', 'success'); if (typeof opt.redraw === 'function') opt.redraw(); } } }) }, Icon('trash', 'sm'))) : null);
      const reqs = items.filter((x) => x.kind === 'request'); const reps = items.filter((x) => x.kind === 'report');
      const el = h('div', { class: 'menu end ag-rd-menu', role: 'menu', 'data-popover-root': '', 'data-ag-ready-menu': agentId },
        opt.canAsk ? h('button', { type: 'button', class: 'opt opt-general', role: 'menuitem', 'data-mk-req-add': agentId, onClick: run(() => opt.ask()) }, Icon('plus', 'sm'), 'تقديم طلب') : null,
        reqs.length || opt.admin ? h('div', { class: 'opt-group t-small' }, 'طلبات جاهزة') : null, ...reqs.map(row),
        opt.admin ? h('button', { type: 'button', class: 'opt opt-general', role: 'menuitem', 'data-ag-ready-add': 'request', onClick: run(() => form(agentId, 'request', null, reload)) }, Icon('plus', 'sm'), 'طلب جاهز') : null,
        reps.length || opt.admin ? h('div', { class: 'opt-group t-small' }, 'تقارير جاهزة') : null, ...reps.map(row),
        opt.admin ? h('button', { type: 'button', class: 'opt opt-general', role: 'menuitem', 'data-ag-ready-add': 'report', onClick: run(() => form(agentId, 'report', null, reload)) }, Icon('plus', 'sm'), 'تقرير جاهز') : null);
      return el;
    };
    const pop = u.popover(wrap, btn, build); btn.addEventListener('click', pop.toggle); wrap.append(btn);
    return wrap;
  }
  return Object.freeze({ reportable, rowsOfPart, partLabel, requestPre, openReport, form, menu, _test: { READERS } });
});
