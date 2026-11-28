/* «املا التفاصيل من اللينك ده» — a report asked of any assistant (Safwat 28 Nov; docs/superpowers/plans/2026-11-28-ask-popups.md, phase A).
   Not a block. A message that asks for a report («تقرير» / «تقارير» — not the sales / expenses read-outs the system already says) gets a
   link; its popup picks, per element, the data type, one state or more and the items under it (the makers, the categories, the members,
   the expense kinds — none picked = all of them), «+ عنصر» for another; «ابعت» = the member's message and the assistant's «البيانات
   جاهزة في اللينك ده», whose popup lists the rows behind each element from the member's own pages under his own rights
   (IBAgentDetails.gather → IBAgentReady.rowsOfPart) with «مشاركة / تحميل» (IBShare). No model behind it, and nothing is kept.
     IBReportAsk.detect(text)          → a report is asked
     IBReportAsk.preOf(text)           → { parts } the element / state said in the words, or { parts: [] }
     IBReportAsk.summary(spec)         → the member's message line
     IBReportAsk.narrow(src, el, items)→ pure: the sources an element's picked items keep
     IBReportAsk.rowsOf(spec, src)     → pure: [{ label, r: { title, headers, rows } | null }]
     IBReportAsk.formState(pre) / check(f) / specOf(f) / fields(f, redraw) → the popup's part (the «إضافة طلب ذكي» popup uses it too)
     IBReportAsk.open({ pre, onSend }) / result(spec) → the popups (browser only) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBReportAsk = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[؟?!.,،:;()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const AR = () => w.IBAgentReady; const C = () => w.IBNotifCatalog;

  // the list under each element (his answer 2): none = the element has no list (the customers, the messages)
  const LIST_OF = { orders: 'makers', subs: 'makers', makers: 'makers', products: 'cats', team: 'members', tickets: 'members', accounts: 'kinds' };
  const LIST_NAME = { makers: 'المبتكرين', cats: 'الأقسام', members: 'أعضاء الفريق', kinds: 'أنواع المصروفات' };
  const ASK = /(^|\s)(ال)?(تقرير|تقارير|report|reports)(\s|$)/;
  const MONEY = /(مبيعات|مصروفات|مصاريف|sales|expenses|revenue)/; // the period's money read-outs stay the system's own (decision 1)
  const detect = (text) => { const t = norm(text); return !!t && ASK.test(t) && !MONEY.test(t); };

  const PRE_EL = [['subs', /(اوردر|اوردرات) فرعي|فرعيه|sub ?orders?/], ['orders', /اوردر|order/], ['makers', /مبتكر|maker|vendor/], ['products', /منتج|مخزون|ستوك|product|stock/],
    ['tickets', /طلبات الفريق|طلب/], ['team', /موظف|فريق|اجاز|سلف|team/], ['messages', /رسايل|رسائل|محادث|message/], ['accounts', /اشتراك|حساب/]];
  function preOf(text) {
    const t = norm(text); const e = (PRE_EL.find(([, re]) => re.test(t)) || [])[0]; if (!e) return { parts: [] };
    const st = /متاخر|late/.test(t) ? 'late' : /قابل/.test(t) ? 'risk' : '';
    const type = { orders: 'delay', subs: 'delay', makers: 'making' }[e] || '';
    const ok = st && type && AR() && AR().reportable(e, type, st);
    return { parts: [{ element: e, type: ok ? type : '', states: ok ? [st] : [], items: [] }] };
  }

  /** The sources an element's picked items keep — none picked = all of them. */
  function narrow(src, element, items) {
    const pick = arr(items).map(String); if (!pick.length || !LIST_OF[element]) return src;
    const has = new Set(pick); const s = Object.assign({}, src); const kind = LIST_OF[element];
    if (kind === 'makers') {
      s.orders = arr(src.orders).filter((o) => arr(o.vendors).some((v) => has.has(String(v))));
      s.lateVendors = arr(src.lateVendors).filter((v) => has.has(String(v.vendor)));
      s.returns = arr(src.returns).filter((r) => has.has(String(r.vendor)));
      s.withdrawals = arr(src.withdrawals).filter((x) => has.has(String((src.vendorName && src.vendorName(x.vendorId)) || '')));
    } else if (kind === 'members') {
      const nm = (code) => String((src.memberName && src.memberName(code)) || code || '');
      s.tickets = arr(src.tickets).filter((t) => has.has(String(t.assigneeMemberName || '')) || has.has(String((t.createdBy && t.createdBy.name) || '')));
      s.hrRequests = arr(src.hrRequests).filter((r) => has.has(nm(r.member)));
      s.overtime = arr(src.overtime).filter((o) => has.has(nm(o.member)));
    } else if (kind === 'cats') {
      s.products = arr(src.products).filter((p) => arr(p.cats).some((c) => pick.some((x) => c === x || c.indexOf(x + ' › ') === 0)));
    } else if (kind === 'kinds') {
      s.expenses = arr(src.expenses).filter((e) => has.has(String(e.category || '')));
    }
    return s;
  }

  const stateName = (p, st) => { const c = C(); const L = lists(); const x = c && c.stateOf ? c.stateOf(p.element, p.type, st, L) : null; return (x && x.label) || st; };
  const partLabel = (p) => { const c = C(); const e = c && c.el ? c.el(p.element) : null; const t = c && c.typeOf ? c.typeOf(p.element, p.type) : null;
    return [(e && e.label) || p.element, (t && t.label) || p.type, arr(p.states).map((x) => stateName(p, x)).join('، ')].join(' › '); };
  function lists() { const S = w.IBSettings; try { return S && S.notifLists ? S.notifLists() : {}; } catch (e) { return {}; } }

  /** Each element's rows: its states' rows together (one row once), from the sources its items keep. */
  function rowsOf(spec, src) {
    const A = AR(); if (!A) return [];
    return arr(spec && spec.parts).map((p) => {
      const s2 = narrow(src || {}, p.element, p.items); let r = null; const seen = new Set(); const titles = [];
      for (const st of arr(p.states)) {
        const x = A.rowsOfPart({ element: p.element, type: p.type, state: st }, s2); if (!x) continue;
        if (!r) r = { title: '', headers: x.headers, rows: [] }; titles.push(x.title);
        for (const row of x.rows) { const k = JSON.stringify(row); if (!seen.has(k)) { seen.add(k); r.rows.push(row); } }
      }
      if (r) r.title = titles.join(' + ');
      return { label: partLabel(p), items: arr(p.items), r };
    });
  }
  const summary = (spec) => 'تقرير: ' + arr(spec && spec.parts).map((p) => partLabel(p) + (arr(p.items).length ? ' — ' + p.items.join('، ') : '')).join(' + ');

  // ---- the browser
  const U = () => w.IBUI; const K = () => w.IBKit;
  const permOf = (k) => (!k ? 'F' : w.IBDirectory && w.IBDirectory.perm ? w.IBDirectory.perm(k) : 'F');
  function itemsOf(kind) {
    try {
      if (kind === 'makers') { const V = w.IBVendors; if (V && V.state && V.state() === 'idle' && V.load) V.load(); return V && V.store && V.store.all ? V.store.all().map((v) => v.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')) : []; }
      if (kind === 'cats') { const P = w.IBProducts; if (P && P.ensure && P.state && P.state() !== 'ready') P.ensure(); return P && P.categories ? P.categories().map((c) => c.path).filter(Boolean) : []; }
      if (kind === 'members') { const H = w.IBHR; return H && H.everyone ? H.everyone().map((m) => m.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')) : []; }
      if (kind === 'kinds') { const D = w.IbtekrDomain; const S = w.IBSettings; return (D && D.CATEGORIES ? D.CATEGORIES : []).map((k) => (S && S.statusLabel ? S.statusLabel('expense', k) || k : k)); }
    } catch (e) { /* the page's list is not there */ }
    return [];
  }
  // the popup's part — its own popup and the «إضافة طلب ذكي» popup draw it (2026-11-28-smart-actions.md)
  const blank = () => ({ element: '', type: '', states: [], items: [] });
  function formState(pre) {
    const c = C(); const A = AR(); const L = lists();
    const okEl = (e) => !!e && permOf(e.perm) !== 'N' && A && e.types.some((t) => c.statesOf(e.id, t.id, L).some((s) => A.reportable(e.id, t.id, s.id)));
    const parts = arr(pre && pre.parts).filter((p) => p.element && c && okEl(c.el(p.element)));
    return { parts: parts.length ? parts.map((p) => ({ element: p.element, type: p.type || '', states: arr(p.states).slice(), items: arr(p.items).slice() })) : [blank()] };
  }
  const check = (f) => (arr(f && f.parts).some((p) => !p.element || !p.type || !arr(p.states).length) ? 'اختار العنصر ونوع البيانات ووضع واحد على الأقل في كل صف' : '');
  const specOf = (f) => ({ parts: arr(f && f.parts).map((p) => ({ element: p.element, type: p.type, states: arr(p.states).slice(), items: arr(p.items).slice() })) });
  function fields(f, redraw) {
    const u = U(); const c = C(); const A = AR(); const k = K(); const { h, Button } = u; const L = lists();
    const okEl = (e) => permOf(e.perm) !== 'N' && e.types.some((t) => c.statesOf(e.id, t.id, L).some((s) => A.reportable(e.id, t.id, s.id)));
    const typesOf = (eid) => { const e = c.el(eid); return e ? e.types.filter((t) => c.statesOf(eid, t.id, L).some((s) => A.reportable(eid, t.id, s.id))) : []; };
    const statesOf = (eid, tid) => (eid && tid ? c.statesOf(eid, tid, L).filter((s) => A.reportable(eid, tid, s.id)) : []);
    const sel = (id, label, options, value, on) => u.Select({ id, label, options, value: value || '', placeholder: 'اختار', onChange: on });
    const row = (p, i) => {
      const kind = LIST_OF[p.element]; const items = kind ? itemsOf(kind) : [];
      return h('div', { class: 'rq-part', 'data-rq-part': String(i) },
        h('div', { class: 'row cols3' },
          sel('rq-el-' + i, f.parts.length > 1 ? 'العنصر ' + (i + 1) : 'العنصر', c.ELEMENTS.filter(okEl).map((e) => ({ value: e.id, label: e.label })), p.element, (v) => { p.element = v; p.type = ''; p.states = []; p.items = []; redraw(); }),
          sel('rq-ty-' + i, 'نوع البيانات', typesOf(p.element).map((t) => ({ value: t.id, label: t.label })), p.type, (v) => { p.type = v; p.states = []; redraw(); }),
          k.MultiPick({ id: 'rq-st-' + i, label: 'الوضع', field: true, placeholder: p.type ? 'اختار وضع أو أكتر' : 'اختار نوع البيانات الأول', options: statesOf(p.element, p.type).map((s) => [s.id, s.label]), value: p.states, onChange: (v) => { p.states = v; } })),
        kind ? h('div', { class: 'rq-items' }, k.MultiPick({ id: 'rq-it-' + i, label: LIST_NAME[kind], field: true, search: true, placeholder: 'كل ' + LIST_NAME[kind] + (items.length ? ' (' + items.length + ')' : ''), options: items.map((x) => [x, x]), value: p.items,
          help: 'من غير اختيار = كلهم — دوس عشان تختار أسامي معيّنة', onChange: (v) => { p.items = v; } })) : null,
        f.parts.length > 1 ? h('button', { type: 'button', class: 'sc-edit rq-x', 'data-rq-x': String(i), 'aria-label': 'شيل العنصر ' + (i + 1), onClick: () => { f.parts.splice(i, 1); redraw(); } }, 'شيل العنصر ده') : null);
    };
    return h('div', { 'data-rq-form': '' }, ...[h('p', { class: 't-small help', style: 'margin:0 0 10px' }, 'اختار العنصر ونوع البيانات والوضع (ممكن أكتر من وضع)، وتحتهم اللي عايزه منهم — والمساعد هيجهّزلك التقرير.'),
      h('div', { class: 'rq-parts' }, f.parts.map(row)),
      f.parts.length < 6 ? Button({ size: 'sm', icon: 'plus', label: 'عنصر تاني', attrs: { 'data-rq-more': '' }, onClick: () => { f.parts.push(blank()); redraw(); } }) : null].filter(Boolean));
  }
  const ready = () => { const u = U(); const k = K(); return !!(u && u.Modal && C() && AR() && k && k.MultiPick); };
  function open(o) {
    if (!ready()) return null; const u = U(); const { h, Button } = u; const opt = o || {};
    const f = formState(opt.pre); let err = ''; let m = null; const box = h('div', { 'data-rq-box': '' });
    const draw = () => { box.replaceChildren(fields(f, draw), ...(err ? [u.InlineNote({ kind: 'error', children: err })] : [])); };
    const send = () => {
      err = check(f); if (err) { draw(); return; }
      m.close(); if (typeof opt.onSend === 'function') opt.onSend(specOf(f));
    };
    draw();
    m = u.Modal({ title: 'تفاصيل التقرير', body: [box], footer: [Button({ type: 'primary', icon: 'send', label: 'ابعت', attrs: { 'data-rq-send': '' }, onClick: send }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-rq', ''); }
    return m;
  }
  function result(spec) {
    const u = U(); const D = w.IBAgentDetails; if (!u || !u.Modal) return null; const { h, Button } = u; const k = K();
    const parts = rowsOf(spec, D && D.gather ? D.gather() : {}); const st = { at: 0 }; const box = h('div', { 'data-rq-result': '' }); let m = null;
    const cur = () => parts[st.at] || null;
    const draw = () => {
      const x = cur(); const r = x && x.r;
      box.replaceChildren(...[
        parts.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'العنصر', style: 'margin:0 0 10px' }, parts.map((p, i) =>
          h('button', { type: 'button', class: 'chip' + (i === st.at ? ' on' : ''), 'aria-pressed': String(i === st.at), 'data-rq-tab': String(i), onClick: () => { st.at = i; draw(); } }, p.label + (p.r ? ' (' + p.r.rows.length + ')' : '')))) : null,
        h('p', { class: 't-small help', style: 'margin:0 0 8px' }, x ? x.label + (x.items.length ? ' — ' + x.items.join('، ') : '') + (r ? ' · ' + r.rows.length + (r.rows.length === 1 ? ' صف' : ' صفوف') : '') : ''),
        r && r.rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl-v2 ag-det-tbl', 'data-rq-tbl': '' },
          h('thead', null, h('tr', null, r.headers.map((c) => h('th', null, c)))),
          h('tbody', null, r.rows.map((row) => h('tr', null, row.map((c) => h('td', null, typeof c === 'number' && k && k.n0 ? k.n0(c) : String(c))))))))
          : h('p', { class: 't-small help', 'data-rq-empty': '' }, 'مفيش صفوف تقدر تشوفها هنا دلوقتي — ممكن الصفحة لسه بتتحمّل أو مش من صلاحياتك.')].filter(Boolean));
      if (m) m.setFooter(foot());
    };
    const share = () => { const x = cur(); if (!x || !x.r || !w.IBShare) return; w.IBShare.open({ title: 'تقرير', sub: x.label, name: 'تقرير — ' + x.label.split(' › ')[0], headers: x.r.headers, rows: x.r.rows }); };
    const foot = () => { const x = cur(); return [Button({ label: 'اقفل', onClick: () => m.close() })]
      .concat(x && x.r && x.r.rows.length && w.IBShare ? [Button({ type: 'primary', icon: 'share', label: 'مشاركة / تحميل', attrs: { 'data-rq-share': '' }, onClick: share })] : []); };
    draw();
    m = u.Modal({ title: 'التقرير', body: [box], footer: foot() });
    if (m && m.el) { m.el.classList.add('wide'); m.el.setAttribute('data-rq-report', ''); }
    return m;
  }
  return Object.freeze({ detect, preOf, summary, narrow, rowsOf, formState, check, specOf, fields, ready, open, result, LIST_OF });
});
