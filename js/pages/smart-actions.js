/* «إجراءات ذكية» — the assistant chat's actions menu (Safwat 28 Nov — «عايز اعمل بدل طلبات و تقارير دروب داون اسمها إجراءات ذكية
   … بناء علي كل مساعد ذكي اكتر ٥ طلبات و تقارير بتطلب منوا … و فيه تحتيهم زرار " إضافة طلب ذكي ، و طلب بشري"»;
   docs/superpowers/plans/2026-11-28-smart-actions.md). Not a block.
   The chat header's button opens: the five requests and reports this member asks this assistant the most (counted in his own
   user_prefs «ai.smart» — a pick of the popups below, a request or report typed in the chat), the assistant's own five filling the
   rest («التشغيل الذكي»: إضافة منتج · إضافة مبتكر · مبتكرين متأخرين …); then «إضافة طلب ذكي» — one popup: «طلب» (إضافة · تعديل ·
   حذف × the element — IBRequestAsk) or «تقرير» (the elements, the data type and the states, several elements — IBReportAsk) — and
   «طلب بشري» (the team's «طلب جديد» popup, to any role). An item runs at once in the chat, the same way as typed; nothing is written
   from here, and only what the member may do is shown (`may`).
     IBSmartActions.DEFAULTS / defaultsOf(agent, sees) → pure: the assistant's own five
     IBSmartActions.keyOf(item) / labelOf(item) / iconOf(item) → pure: an item's key, its short name and its icon
     IBSmartActions.top(agent, used, { may, sees }) → pure: the five shown
     IBSmartActions.record(used, agent, item, at) → pure: one more use (the 20 most used per assistant kept)
     IBSmartActions.fromFlow(flowId)          → pure: the request a chat flow is («ضيف مصروف» → إضافة مصروف)
     IBSmartActions.menu(agent, { items, run, add, human }) / open({ may, onRequest, onReport }) → the browser's part */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBSmartActions = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => String(v == null ? '' : v);
  const RQ = () => w.IBRequestAsk; const RA = () => w.IBReportAsk; const C = () => w.IBNotifCatalog;

  // an item = { kind: 'request', verb, element, sub } | { kind: 'report', parts: [{ element, type, states, items }] }
  const rq = (verb, element, sub) => ({ kind: 'request', verb, element, sub: sub || '' });
  const rp = (element, type, state) => ({ kind: 'report', parts: [{ element, type, states: [state], items: [] }] });
  /** Each assistant's own five, by its work — the member's own most used come before them. */
  const DEFAULTS = {
    manager: [rp('orders', 'delay', 'late'), rp('makers', 'making', 'late'), rq('add', 'product'), rq('add', 'maker'), rp('tickets', 'type', 'late')],
    stock: [rq('add', 'product'), rq('add', 'maker'), rp('makers', 'making', 'late'), rp('orders', 'delay', 'late'), rp('products', 'returns', 'wait')],
    cs: [rp('messages', 'customers', 'waiting'), rp('messages', 'customers', 'late'), rq('add', 'customer'), rq('edit', 'order'), rp('orders', 'delay', 'late')],
    makers: [rp('makers', 'making', 'late'), rp('makers', 'making', 'risk'), rq('add', 'maker'), rq('edit', 'maker'), rp('makers', 'accounts', 'withdraw_wait')],
    accountant: [rq('add', 'money', 'expense'), rq('add', 'money', 'makerMove'), rp('makers', 'accounts', 'withdraw_wait'), rp('accounts', 'subs', 'due'), rq('edit', 'money')],
    hr: [rq('add', 'member'), rp('team', 'update', 'req_leave'), rp('team', 'update', 'req_advance'), rp('team', 'update', 'req_ot'), rq('edit', 'member')],
    designer: [rq('add', 'design'), rq('edit', 'design'), rp('tickets', 'type', 'new')],
    dev: [rp('tickets', 'type', 'new'), rp('tickets', 'type', 'late')],
    buyer: [rq('add', 'design'), rq('edit', 'design')],
    content: [rq('add', 'design'), rq('add', 'product'), rq('edit', 'product')],
  };
  // an assistant the admin added: its five from the data it reads (ai_agents.sees)
  const BY_SEES = { orders: rp('orders', 'delay', 'late'), vendors: rp('makers', 'making', 'late'), customers: rp('messages', 'customers', 'waiting'), tickets: rp('tickets', 'type', 'late'),
    inventory: rp('products', 'returns', 'wait'), expenses: rp('accounts', 'subs', 'due'), hr: rp('team', 'update', 'req_leave') };
  const defaultsOf = (agent, sees) => (DEFAULTS[agent] || arr(sees).map((k) => BY_SEES[k]).filter(Boolean)).slice(0, 5);
  // a chat flow said in words is that request («ضيف مصروف» = إضافة مصروف)
  const FLOW_ITEM = { expense: rq('add', 'money', 'expense'), makerMove: rq('add', 'money', 'makerMove'), post: rq('add', 'design'), maker: rq('add', 'maker'),
    makerEdit: rq('edit', 'maker'), productEdit: rq('edit', 'product'), trash: rq('delete', 'product'), order: rq('edit', 'order') };
  const fromFlow = (id) => FLOW_ITEM[id] || null;

  /** The item as it is kept: known fields only, the states and the items sorted (one report = one key). */
  function canon(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.kind === 'report') {
      const parts = arr(item.parts).map((p) => ({ element: str(p && p.element), type: str(p && p.type), states: arr(p && p.states).map(str).filter(Boolean).sort(), items: arr(p && p.items).map(str).filter(Boolean).sort() }))
        .filter((p) => p.element && p.type && p.states.length).slice(0, 6);
      return parts.length ? { kind: 'report', parts } : null;
    }
    if (item.kind !== 'request') return null;
    const R = RQ(); const verb = str(item.verb); const element = str(item.element);
    if (R && (!R.VERBS.some(([v]) => v === verb) || !R.ELEMENTS.some(([e]) => e === element))) return null;
    if (!verb || !element) return null;
    const subs = R && R.SUBS ? R.SUBS[element] : null; const sub = verb === 'add' && subs && subs.some(([v]) => v === str(item.sub)) ? str(item.sub) : '';
    return { kind: 'request', verb, element, sub };
  }
  function keyOf(item) {
    const c = canon(item); if (!c) return '';
    if (c.kind === 'request') return 'rq:' + c.verb + '.' + c.element + (c.sub ? '.' + c.sub : '');
    return 'rp:' + c.parts.map((p) => p.element + '.' + p.type + '.' + p.states.join('|') + (p.items.length ? '[' + p.items.join('|') + ']' : '')).join('+');
  }

  // a report's short name: the common ones by name, the rest «‹العنصر› — ‹الوضع›»
  const REPORT_NAMES = { 'orders.delay.late': 'أوردرات متأخرة', 'orders.delay.risk': 'أوردرات قابلة للتأخير', 'orders.delay.ok': 'أوردرات مفتوحة مش متأخرة', 'subs.delay.late': 'أوردرات فرعية متأخرة',
    'makers.making.late': 'مبتكرين متأخرين', 'makers.making.risk': 'مبتكرين قابلين للتأخير', 'makers.accounts.withdraw_wait': 'طلبات سحب مستنية',
    'products.returns.wait': 'مرتجعات مستنية الفحص', 'products.stock.out': 'منتجات نفدت', 'products.stock.left1': 'منتجات باقي منها 1', 'products.stock.left3': 'منتجات باقي منها 3 أو أقل',
    'tickets.type.new': 'طلبات الفريق الجديدة', 'tickets.type.late': 'طلبات الفريق المتأخرة', 'messages.customers.waiting': 'رسايل عملاء مستنية رد', 'messages.customers.late': 'رسايل عملاء متأخرة',
    'accounts.subs.due': 'اشتراكات قرب ميعادها', 'team.update.req_leave': 'طلبات إجازة مستنية', 'team.update.req_advance': 'طلبات سلفة مستنية', 'team.update.req_rest': 'طلبات راحة مستنية', 'team.update.req_ot': 'وقت إضافي مستني' };
  const lists = () => { const S = w.IBSettings; try { return S && S.notifLists ? S.notifLists() : {}; } catch (e) { return {}; } };
  function partName(p) {
    const one = p.states.length === 1 ? REPORT_NAMES[p.element + '.' + p.type + '.' + p.states[0]] : '';
    const c = C(); const L = lists();
    const st = (s) => { const x = c && c.stateOf ? c.stateOf(p.element, p.type, s, L) : null; return (x && x.label) || s; };
    let name = one;
    if (!name && p.element === 'orders' && (p.type === 'confirm' || p.type === 'status')) name = 'أوردرات ' + p.states.map(st).join(' / ');
    if (!name) { const e = c && c.el ? c.el(p.element) : null; name = ((e && e.label) || p.element) + ' — ' + p.states.map(st).join('، '); }
    return p.items.length ? name + ' — ' + p.items.slice(0, 2).join('، ') + (p.items.length > 2 ? '…' : '') : name;
  }
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
  /** «إضافة منتج» · «إضافة مصروف» · «مبتكرين متأخرين» · «أوردرات متأخرة + طلبات سحب مستنية». */
  function labelOf(item) {
    const c = canon(item); if (!c) return '';
    if (c.kind === 'request') { const R = RQ(); return R && R.label ? R.label(c) : c.verb + ' ' + c.element; }
    return cut(c.parts.map(partName).join(' + '), 48);
  }
  const iconOf = (item) => { const c = canon(item); return !c ? 'sparkle' : c.kind === 'report' ? 'chart' : c.verb === 'add' ? 'plus' : c.verb === 'edit' ? 'edit' : 'trash'; };

  const later = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
  /** The five shown: the member's most used with this assistant (the count, then the latest), then its own five — what he may only. */
  function top(agent, used, o) {
    const opt = o || {}; const may = typeof opt.may === 'function' ? opt.may : () => true; const n = opt.n || 5;
    const mine = Object.values((used && typeof used === 'object' && used[agent]) || {}).filter((x) => x && Number(x.n) > 0 && x.item)
      .sort((a, b) => (Number(b.n) - Number(a.n)) || later(str(a.at), str(b.at))).map((x) => x.item);
    const out = []; const seen = new Set();
    for (const x of mine.concat(defaultsOf(agent, opt.sees))) {
      const c = canon(x); const k = keyOf(c); if (!c || !k || seen.has(k)) continue; seen.add(k);
      let ok = false; try { ok = !!may(c); } catch (e) { ok = false; }
      if (ok) out.push(c); if (out.length >= n) break;
    }
    return out;
  }
  /** One more use of the item with this assistant; the 20 most used are kept per assistant. A new object — `used` is not changed. */
  function record(used, agent, item, at) {
    const c = canon(item); const k = keyOf(c); const u = Object.assign({}, used && typeof used === 'object' ? used : {}); if (!c || !k || !agent) return u;
    const mine = Object.assign({}, u[agent] || {}); const x = mine[k] || {};
    mine[k] = { n: (Number(x.n) || 0) + 1, at: str(at || new Date().toISOString()), item: c };
    u[agent] = Object.fromEntries(Object.entries(mine).filter(([, v]) => v && v.item).sort((a, b) => (Number(b[1].n) - Number(a[1].n)) || later(str(a[1].at), str(b[1].at))).slice(0, 20));
    return u;
  }

  // ---- the browser
  const U = () => w.IBUI;
  /** The header's button and its menu — the five (`items()` when it opens), «إضافة طلب ذكي», «طلب بشري» (when `human`). */
  function menu(agentId, o) {
    const u = U(); if (!u || !u.popover) return null; const { h, Icon } = u; const opt = o || {};
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = u.Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: 'إجراءات ذكية', attrs: { 'data-smart-btn': agentId, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    const build = (close) => {
      const run = (fn) => () => { close(); fn(); };
      let list = []; try { list = typeof opt.items === 'function' ? opt.items() : []; } catch (e) { list = []; }
      return h('div', { class: 'menu end smart-menu', role: 'menu', 'data-popover-root': '', 'data-smart-menu': agentId },
        h('div', { class: 'opt-group t-small' }, 'الأكتر طلبًا'),
        ...(list.length ? list.map((it) => h('button', { type: 'button', class: 'opt', role: 'menuitem', 'data-smart-item': keyOf(it), onClick: run(() => opt.run(it)) }, Icon(iconOf(it), 'sm'), h('span', { class: 'smart-l' }, labelOf(it))))
          : [h('p', { class: 't-small help smart-empty' }, 'اللي بتطلبه أكتر هيظهر هنا.')]),
        h('div', { class: 'smart-sep', role: 'separator' }),
        h('button', { type: 'button', class: 'opt opt-general', role: 'menuitem', 'data-smart-add': agentId, onClick: run(() => opt.add()) }, Icon('sparkle', 'sm'), 'إضافة طلب ذكي'),
        typeof opt.human === 'function' ? h('button', { type: 'button', class: 'opt opt-general', role: 'menuitem', 'data-smart-human': agentId, onClick: run(() => opt.human()) }, Icon('users', 'sm'), 'طلب بشري') : null);
    };
    const pop = u.popover(wrap, btn, build); btn.addEventListener('click', pop.toggle); wrap.append(btn);
    return wrap;
  }
  const KINDS = [['request', 'طلب', 'إضافة · تعديل · حذف'], ['report', 'تقرير', 'بيانات من السيستم في جدول']];
  /** «إضافة طلب ذكي»: «طلب» or «تقرير», then that popup's own part; «ابدأ» / «ابعت» hands the pick or the report to the chat. */
  function open(o) {
    const u = U(); const R = RQ(); const A = RA(); if (!u || !u.Modal || !R || !R.fields) return null; const { h, Button } = u; const opt = o || {};
    const reports = !!(A && A.ready && A.ready());
    const st = { kind: opt.kind === 'report' && reports ? 'report' : opt.kind === 'request' ? 'request' : '' };
    const rf = R.formState(opt.request); const af = reports ? A.formState(opt.report) : null;
    let err = ''; let m = null; const box = h('div', { 'data-smart-form': '' });
    const missing = () => (!st.kind ? 'اختار طلب ولا تقرير' : st.kind === 'request' ? R.check(rf) : A.check(af));
    const draw = () => {
      err = err ? missing() : '';
      box.replaceChildren(...[h('p', { class: 'rqq-step' }, 'عايز إيه؟'),
        h('div', { class: 'rqq-subs smart-kinds', role: 'radiogroup', 'aria-label': 'نوع الإجراء', 'data-smart-kinds': '' }, KINDS.filter(([v]) => v === 'request' || reports).map(([v, l, d]) =>
          h('button', { type: 'button', class: 'rqq-sub' + (st.kind === v ? ' on' : ''), role: 'radio', 'aria-checked': String(st.kind === v), 'data-smart-kind': v, onClick: () => { st.kind = v; err = ''; draw(); } },
            h('span', { class: 'rqq-ic' }, u.Icon(v === 'report' ? 'chart' : 'send', 'sm')), h('span', { class: 'rqq-st' }, h('b', null, l), h('small', null, d))))),
        st.kind ? h('div', { class: 'rqq-sep' }) : null,
        st.kind === 'request' ? R.fields(rf, draw, { may: opt.may }) : null,
        st.kind === 'report' ? A.fields(af, draw) : null,
        err ? u.InlineNote({ kind: 'error', children: err }) : null].filter(Boolean));
      if (m) m.setFooter(...foot());
    };
    const go = () => {
      err = missing(); if (err) { draw(); return; }
      m.close();
      if (st.kind === 'request') { if (typeof opt.onRequest === 'function') opt.onRequest({ verb: rf.verb, element: rf.element, sub: rf.sub }); }
      else if (typeof opt.onReport === 'function') opt.onReport(A.specOf(af));
    };
    const foot = () => [Button({ type: 'primary', icon: 'send', label: st.kind === 'report' ? 'ابعت' : 'ابدأ', attrs: { 'data-smart-go': '' }, onClick: go }), Button({ label: 'إلغاء', onClick: () => m.close() })];
    draw();
    m = u.Modal({ title: 'إضافة طلب ذكي', body: [box], footer: foot() });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-smart', ''); }
    return m;
  }
  return Object.freeze({ DEFAULTS, defaultsOf, fromFlow, canon, keyOf, labelOf, iconOf, top, record, menu, open });
});
