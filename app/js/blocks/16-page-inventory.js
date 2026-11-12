/* Inventory = temporary hub «المخزن» — Figma page 314:3387 (388:2197, 389:2335, 384:50221, 384:49812, 384:50691, 384:51266).
   Every lot has السبب / الحالة / الخطوة الجاية / بقاله. Quantities come from the movement ledger. Auto-pull only from «متاح للبيع».
   Phase 7 (docs/superpowers/plans/2026-11-04-phase-7-inventory.md, decision 2): the v2 prototype's page as it is, on real data —
   IBInventory (app/js/adapter/inventory.js, 0044) loads the hub into K.store in these shapes, and every change the page makes
   (a lot, a move, a status / reason / place, a consolidation's close, a count, a place, a setting) is written through it; a
   refused write says why and reloads the hub. TODAY is Cairo's real date (TODAY is the prototype's). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U; const S = K.store;
  const A = () => window.IBInventory || null;
  const live = () => !!(A() && window.IBSupabase && window.IBSupabase.client);
  const TODAY = (A() && A().today()) || K.TODAY;
  const canEdit = () => !live() || A().can().edit;
  const canApprove = () => !live() || A().can().approve;
  const reload = () => (live() ? A().load().then(() => rerender()) : Promise.resolve());
  // a write through IBInventory: kept on the page at once; a refusal says why and reloads the hub from the server
  const saved = (p, okMsg) => Promise.resolve(p).then((r) => { if (r && r.ok) { if (okMsg) K.toast(okMsg, 'success'); return r; } K.toast(r && r.reason === 'forbidden' ? 'مش مسموح — الصلاحية دي مش عندك' : 'ماتحفظش — جرّب تاني', 'error'); reload(); return r || { ok: false }; });
  const newKey = () => (live() ? A().newKey() : 'L-' + Date.now());
  const patchLot = (key, patch, action) => { if (live()) saved(A().updateLot(key, patch, action)); };
  // phase 13 decision 58 (owner 11 Nov — «المخزن الآن لقسمين: نظرة عامة وسجل المخزون وبعدهم باقي الأقسام»)
  const TABS = [{ id: 'overview', label: 'نظرة عامة' }, { id: 'now', label: 'سجل المخزون' }, { id: 'consolidate', label: 'تجميع أوردرات' }, { id: 'returns', label: 'المرتجعات' }, { id: 'moves', label: 'حركات المخزن' }, { id: 'count', label: 'الجرد' }, { id: 'reports', label: 'التقارير' }]; // B6: the settings moved to «الإعدادات › المخزن"
  const st = { tab: 'overview', f: { reason: [], status: [], vendor: [], loc: [], late: false }, sort: 'new', q: '', mq: '', mtype: '' };
  const R = () => window.IBPages.render('inventory');
  const rerender = () => { if (window.IBPages.current === 'inventory') R(); else window.OrdersSetSub && window.OrdersSetSub('__redraw__', null); document.dispatchEvent(new CustomEvent('ib:notify')); };
  const REASON_TONE = { 'تجميع أوردر': 'info', 'مرتجع': 'orange', 'تصوير': 'gold', 'متاح للبيع': 'success' };
  const STATUS_TONE = { 'وصل المخزن': 'info', 'جاهز يطلع كامل': 'success', 'بانتظار الفحص': 'orange', 'مستني تصوير': 'gold', 'اتصور': 'brand', 'متاح': 'success', 'محجوز لأوردر': 'orange', 'راجع للمبتكر': 'neutral', 'تالف': 'error' };
  const STATUSES = ['وصل المخزن', 'جاهز يطلع كامل', 'بانتظار الفحص', 'مستني تصوير', 'اتصور', 'متاح', 'محجوز لأوردر', 'راجع للمبتكر', 'تالف'];
  const age = (s) => K.daysBetween(s.since, TODAY);
  const ageTxt = (d) => (d === 0 ? 'النهارده' : d === 1 ? 'يوم' : d === 2 ? 'يومين' : d <= 10 ? d + ' أيام' : d + ' يوم');
  const sinceTxt = (iso) => { const d = age({ since: iso }); return d === 0 ? 'النهارده' : d === 1 ? 'أمس' : K.dshort(iso); };
  const cons = (orderId) => S.consolidations.find((c) => String(c.order) === String(orderId));
  function nextStep(s) {
    if (s.reason === 'تجميع أوردر') { const c = cons(s.order); if (!c) return '—'; const wait = c.subs.filter((x) => x[2] !== 'وصل المخزن').map((x) => x[1]); return wait.length ? 'مستني ' + wait.join('، ') : 'شحن كامل'; }
    if (s.status === 'بانتظار الفحص') return 'فحص';
    if (s.status === 'مستني تصوير') return 'تصوير قبل ' + K.dshort(O.addDays(s.since, S.invSettings.photoMax));
    if (s.status === 'اتصور') return 'يرجع أو يتحوّل للبيع';
    if (s.status === 'محجوز لأوردر') return 'يتشحن مع الأوردر';
    return '—';
  }
  const tooLong = (s) => (s.reason === 'تجميع أوردر' && O.consolidationLate(age(s)) && s.status !== 'جاهز يطلع كامل') || (s.reason === 'تصوير' && O.photoOverdue(age(s)));

  // «التفاصيل» on every KPI (owner, 22 Oct): data behind the number → U.DetailsModal (shareable).
  const SRC = 'المخزن المؤقت — الكميات محسوبة من سجل الحركات';
  const stockRows = (l) => l.map((x) => [x.name, x.sku, x.vendor, x.reason, x.status, x.loc, String(x.onHand), ageTxt(age(x))]);
  const STOCK_H = ['المنتج', 'SKU', 'المبتكر', 'السبب', 'الحالة', 'المكان', 'الكمية', 'بقاله'];
  const openLot = (l) => (i) => details(l[i]);
  const consRow = (c) => { const p = O.consolidation(c.subs.map((x) => x[2])); const d = K.daysBetween(c.since, TODAY); const late = !p.ready && O.consolidationLate(d) && c.subs.some((x) => x[2] === 'قيد التنفيذ');
    return ['IB-' + c.order, c.customer, String(c.subs.length), p.arrived + ' من ' + p.total, p.ready ? 'جاهز يطلع كامل' : late ? 'فيه تأخير' : 'بيتجمع', K.dshort(c.since), ageTxt(d)]; };
  const CONS_H = ['الأوردر', 'العميل', 'فرعيات', 'وصل', 'الحالة', 'من يوم', 'بقاله'];
  const goCons = () => { st.tab = 'consolidate'; try { history.replaceState(null, '', '#inventory-consolidate'); } catch (e) { /* */ } R(); };
  const subRows = (l) => l.map(({ c, x }) => ['#' + x[0], 'IB-' + c.order, x[1], x[3] || '—', x[2], K.dshort(c.since), ageTxt(K.daysBetween(c.since, TODAY))]);
  const SUB_H = ['الأوردر الفرعي', 'الأوردر', 'المبتكر', 'المنتج', 'الحالة', 'بدأ التجميع', 'بقاله'];
  const retRows = (l) => l.map((r) => [r.name, r.vendor, '#' + r.sub, r.type, r.reason, r.at, r.status, r.value ? K.money(r.value) : '—']);
  const RET_H = ['المنتج', 'المبتكر', 'الأوردر الفرعي', 'النوع', 'السبب', 'التاريخ', 'الحالة', 'القيمة'];
  const mvRows = (l) => { const lot = (key) => S.stock.find((x) => x.key === key) || {}; return l.map((m) => [m.at.slice(0, 16), m.label, lot(m.key).name || m.name || '—', String(m.qty), m.reason || '—', m.ref || '—', m.by, m.note || '']); };
  const MV_H = ['التاريخ', 'الحركة', 'المنتج', 'الكمية', 'السبب', 'المرجع', 'بواسطة', 'ملاحظة'];

  const pnl = (...kids) => { const el = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...kids); if (K.applyPanelPrefs) setTimeout(() => K.applyPanelPrefs('inventory:' + st.tab, el), 0); return el; };
  function view() {
    return [K.PageHead('المخزن', 'مخزن ابتكر المؤقت: تجميع أوردرات · مرتجعات · تصوير · متاح للبيع', [st.tab === 'reports' || !K.PanelButton ? null : K.PanelButton('inventory:' + st.tab, 'المخزن — ' + (TABS.find((t) => t.id === st.tab) || {}).label, () => document.querySelector('#pg-inventory .panel'), R), canEdit() ? Button({ label: 'جرد جديد', onClick: () => newCount() }) : null, window.IBDataActions ? window.IBDataActions.Menu(window.IBDataActions.PAGES.inventory) : null, canEdit() ? Button({ type: 'brand', label: 'استلام في المخزن', icon: 'plus', onClick: () => receive() }) : null]),
      K.MainTabs({ items: TABS, active: st.tab, onChange: (id) => { st.tab = id; try { history.replaceState(null, '', '#inventory-' + id); } catch (e) { /* */ } R(); }, label: 'أقسام المخزن' }),
      pnl(...(st.tab === 'overview' ? nowTab('overview') : st.tab === 'now' ? nowTab() : st.tab === 'consolidate' ? consTab() : st.tab === 'returns' ? returnsTab() : st.tab === 'moves' ? movesTab() : st.tab === 'count' ? countTab() : st.tab === 'reports' ? reportTab() : nowTab('overview')))];
  }
  const sel = (id, label, key, opts) => U.Select({ id, label: '', options: [{ value: '', label: label + ': الكل' }].concat(opts.map((o) => ({ value: o, label: label + ': ' + o }))), value: st.f[key], onChange: (v) => { st.f[key] = v; R(); } });
  const search = (ph, key, label) => { const q = h('input', { type: 'search', placeholder: ph, 'aria-label': label, value: st[key] }); q.addEventListener('input', () => { st[key] = q.value; const p = q.selectionStart; R(); const n = document.querySelector('#pg-inventory input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }); return h('label', { class: 'search-field' }, Icon('search', 'sm'), q); };
  // product photo by SKU (window.IB_PRODUCT_IMG, same source as the orders page); no photo → box icon
  const imgOf = (sku) => { const m = window.IB_PRODUCT_IMG || {}; const k = String(sku || '').trim(); return k && m[k] ? 'data:image/jpeg;base64,' + m[k] : null; };
  const skuOfName = (name) => { const x = S.stock.find((s) => s.name === name && imgOf(s.sku)); return x ? x.sku : null; };
  const Thumb = (sku, name, big) => { const src = imgOf(sku) || imgOf(skuOfName(name)); return src ? h('span', { class: 'thumb' }, h('img', { src, alt: name || '', loading: 'lazy' })) : h('span', { class: 'thumb', role: 'img', 'aria-label': 'مفيش صورة' }, Icon('box', big ? undefined : 'sm')); };
  const prodCell = (s) => h('div', { class: 'prod' }, Thumb(s.sku, s.name), h('span', null, h('b', null, s.name), h('small', { dir: 'ltr' }, s.sku)));

  // ---------- فلتر مقفول + ترتيب + الاختيارات كشيبس (owner 1 Nov — نفس طريقة الأوردرات) ----------
  // B6 (the owner, 11 Nov): three fixed places — no shelves, no «+ مكان»; the place is optional on receive (by default the reason's)
  const LOCS = [['T', 'T — تجميع'], ['R', 'R — مرتجعات'], ['P', 'P — تصوير']];
  const placeOf = (reason) => (reason === 'تجميع أوردر' ? 'T' : reason === 'مرتجع' ? 'R' : reason === 'تصوير' ? 'P' : '');
  // the place select: «—» or one of the three; it follows the reason until the member picks one
  const LOC_OPTS = () => [{ value: '', label: '— من غير مكان —' }].concat(LOCS.map(([v, l]) => ({ value: v, label: l })));
  const locName = (c) => (LOCS.find((x) => x[0] === c) || [c, c])[1];
  const placeField = (f, e, set) => { if (!f._locSet) f.loc = placeOf(f.reason);
    return K.field.select('loc', 'المكان (اختياري)', LOC_OPTS(), f, e, (k, v, r) => { f._locSet = true; set(k, v, r); }); };
  const STOCK_SORTS = [['new', 'دخل المخزن: الأحدث للأقدم'], ['old', 'دخل المخزن: الأقدم للأحدث'], ['cost-desc', 'السعر: الأعلى للأقل'], ['cost-asc', 'السعر: الأقل للأعلى'], ['qty-desc', 'الكمية: الأكتر للأقل'], ['qty-asc', 'الكمية: الأقل للأكتر'], ['late', 'القاعدة أكتر من اللازم الأول'], ['name', 'الاسم: A → Z']];
  function matchStock(s, f, q) { const A = (k) => f[k] || []; return (!A('reason').length || A('reason').includes(s.reason)) && (!A('status').length || A('status').includes(s.status)) && (!A('vendor').length || A('vendor').includes(s.vendor)) && (!A('loc').length || A('loc').some((l) => String(s.loc).startsWith(l))) && (!f.late || tooLong(s)) && (!q || (s.name + s.sku + (s.ref || '')).toLowerCase().includes(q)); }
  function sortStock(l) { const by = { new: (a, b) => String(b.since).localeCompare(String(a.since)), old: (a, b) => String(a.since).localeCompare(String(b.since)), 'cost-desc': (a, b) => (b.cost || 0) - (a.cost || 0), 'cost-asc': (a, b) => (a.cost || 0) - (b.cost || 0), 'qty-desc': (a, b) => b.onHand - a.onHand, 'qty-asc': (a, b) => a.onHand - b.onHand, late: (a, b) => (tooLong(b) - tooLong(a)) || (age(b) - age(a)), name: (a, b) => String(a.name).localeCompare(String(b.name)) }[st.sort || 'new']; return by ? l.slice().sort(by) : l; }
  const fCount = () => ['reason', 'status', 'vendor', 'loc'].reduce((n, k) => n + (st.f[k] || []).length, 0) + (st.f.late ? 1 : 0);
  function stockSortMenu() {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const cur = STOCK_SORTS.find((x) => x[0] === (st.sort || 'new'));
    const btn = h('button', { type: 'button', class: 'select sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'ترتيب المخزن', 'data-inv-sort': st.sort || 'new' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, 'ترتيب: ' + cur[1]));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: STOCK_SORTS.map(([v, l]) => ({ value: v, label: l })), value: st.sort || 'new', onSelect: (v) => { close(); st.sort = v; R(); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  // the kit's «فلتر» button (the owner 12 Nov — back from B5's row): السبب · الحالة · المبتكر · المكان · أخرى («قاعدة أكتر من اللازم»)
  function stockFilterMenu(all) {
    const toF = (d) => ({ reason: d.reason.slice(), status: d.status.slice(), vendor: d.vendor.slice(), loc: d.loc.slice(), late: d.late.includes('late') });
    return K.FilterMenu({ id: 'inv', label: 'فلتر المخزن', noun: 'صنف', value: { reason: st.f.reason, status: st.f.status, vendor: st.f.vendor, loc: st.f.loc, late: st.f.late ? ['late'] : [] },
      groups: [{ key: 'reason', label: 'السبب', options: O.REASONS.map((r) => [r, r]) }, { key: 'status', label: 'الحالة', options: STATUSES.map((x) => [x, x]) },
        { key: 'vendor', label: 'المبتكر', options: [...new Set(all.map((x) => x.vendor))].sort().map((v) => [v, v]) }, { key: 'loc', label: 'المكان', options: LOCS.map(([v, l]) => [v, l]) },
        { key: 'late', label: 'أخرى', options: [['late', 'قاعدة أكتر من اللازم']] }],
      count: (d) => all.filter((x) => matchStock(x, toF(d), st.q.toLowerCase())).length, onApply: (d) => { st.f = toF(d); R(); } });
  }
  // صف النتايج: شيبس الاختيارات (✕ في الركن) + عدد الأصناف + «مسح الكل»
  function activeRow(all, list) {
    const ch = []; const lab = { reason: 'السبب', status: 'الحالة', vendor: 'المبتكر', loc: 'المكان' };
    ['reason', 'status', 'vendor', 'loc'].forEach((k) => (st.f[k] || []).forEach((v) => ch.push([k, v, lab[k] + ': ' + (k === 'loc' ? (LOCS.find((x) => x[0] === v) || [v, v])[1] : v)])));
    if (st.f.late) ch.push(['late', true, 'قاعدة أكتر من اللازم']);
    const rm = (k, v) => { if (k === 'late') st.f.late = false; else st.f[k] = st.f[k].filter((x) => x !== v); R(); setTimeout(() => { const n = document.querySelector('#pg-inventory [data-inv-chip]') || document.querySelector('[data-inv-filter-btn]'); if (n) n.focus(); }); };
    return h('div', { class: 'af-row', 'data-inv-active': '' },
      ch.map(([k, v, t]) => { const n = all.filter((s) => (k === 'late' ? tooLong(s) : k === 'loc' ? matchStock(s, { loc: [v] }, '') : s[k] === v)).length; return h('button', { type: 'button', class: 'af-chip', 'data-inv-chip': k + ':' + v, 'aria-label': 'شيل الفلتر: ' + t + ' — ' + n + ' صنف', onClick: () => rm(k, v) }, h('span', { class: 'af-t' }, t), h('span', { class: 'af-c', 'aria-hidden': 'true' }, String(n)), h('span', { class: 'af-x', 'aria-hidden': 'true' }, Icon('close', 'sm'))); }),
      h('span', { class: 'af-n', 'data-inv-count': String(list.length) }, ch.length ? list.length + ' صنف' : 'كل الأصناف · ' + all.length + ' صنف'),
      ch.length ? h('button', { type: 'button', class: 'af-clr', 'data-inv-clear': '', onClick: () => { st.f = { reason: [], status: [], vendor: [], loc: [], late: false }; R(); } }, h('span', null, 'مسح الكل')) : null);
  }
  // ---------- المخزن الآن ----------
  function nowTab(part) {
    const all = K.stockNow().filter((s) => s.onHand > 0 || s.reserved > 0);
    const by = (r) => all.filter((s) => s.reason === r);
    const ready = S.consolidations.filter((c) => O.consolidation(c.subs.map((x) => x[2])).ready).length;
    const retW = by('مرتجع').filter((s) => s.status === 'بانتظار الفحص'); const ph = by('تصوير'); const sale = by('متاح للبيع'); const tl = all.filter(tooLong); const sumQ = (l, k) => l.reduce((x, y) => x + (y[k] || 0), 0);
    const kpis = h('div', { class: 'cards five' },
      K.Stat('بتتجمع', S.consolidations.length, 'أوردرات', ready + ' جاهز يطلع كامل', undefined, () => ({ title: 'أوردرات بتتجمع في المخزن — ' + S.consolidations.length, sub: ready + ' جاهز يطلع كامل · اضغط على أي أوردر يفتح تاب التجميع', summary: [{ label: 'أوردرات', value: String(S.consolidations.length) }, { label: 'جاهز', value: String(ready) }, { label: 'فرعيات', value: String(S.consolidations.reduce((x, c) => x + c.subs.length, 0)) }], headers: CONS_H, rows: S.consolidations.map(consRow), onRow: goCons, source: SRC })),
      K.Stat('مرتجعات', retW.length, 'بانتظار الفحص', 'أقدم واحد من ' + sinceTxt(by('مرتجع').map((s) => s.since).sort()[0] || TODAY), undefined, () => ({ title: 'مرتجعات بانتظار الفحص — ' + retW.length, sub: 'المرتجع ما بيزوّدش المتاح غير بعد الفحص · اضغط على أي صف يفتح تفاصيل المنتج', summary: [{ label: 'قطع', value: String(retW.length) }, { label: 'كل المرتجعات في المخزن', value: String(by('مرتجع').length) }], headers: STOCK_H, rows: stockRows(retW), onRow: openLot(retW), source: SRC })),
      K.Stat('تصوير', ph.length, 'منتجات', ph.filter((s) => s.status === 'اتصور').length + ' اتصور ومستني قرار', undefined, () => ({ title: 'منتجات التصوير — ' + ph.length, sub: 'أقصى مدة للتصوير ' + S.invSettings.photoMax + ' يوم', summary: [{ label: 'مستني تصوير', value: String(ph.filter((s) => s.status === 'مستني تصوير').length) }, { label: 'اتصور ومستني قرار', value: String(ph.filter((s) => s.status === 'اتصور').length) }, { label: 'متأخر', value: String(ph.filter(tooLong).length) }], headers: STOCK_H.concat(['الخطوة الجاية']), rows: ph.map((x, i) => stockRows([x])[0].concat([nextStep(x)])), onRow: openLot(ph), source: SRC })),
      K.Stat('متاح للبيع', sumQ(sale, 'onHand'), 'قطعة', sumQ(sale, 'reserved') + ' محجوزة لأوردرات', undefined, () => ({ title: 'متاح للبيع — ' + sumQ(sale, 'onHand') + ' قطعة', sub: 'السحب التلقائي للأوردرات الجديدة بيشتغل على «متاح للبيع» بس', summary: [{ label: 'في المخزن', value: String(sumQ(sale, 'onHand')) }, { label: 'محجوز', value: String(sumQ(sale, 'reserved')) }, { label: 'متاح فعلًا', value: String(sumQ(sale, 'available')) }, { label: 'منتجات', value: String(sale.length) }], headers: ['المنتج', 'SKU', 'المبتكر', 'المكان', 'في المخزن', 'محجوز', 'متاح'], rows: sale.map((x) => [x.name, x.sku, x.vendor, x.loc, String(x.onHand), String(x.reserved || 0), String(x.available != null ? x.available : x.onHand - (x.reserved || 0))]), onRow: openLot(sale), source: SRC })),
      K.Stat('قاعدة أكتر من اللازم', sumQ(tl, 'onHand'), 'قطع', 'تصوير > ' + S.invSettings.photoMax + ' يوم · تجميع > ' + S.invSettings.consolidationAlert + ' أيام', undefined, () => ({ title: 'قطع قاعدة أكتر من اللازم — ' + sumQ(tl, 'onHand'), sub: 'تصوير أكتر من ' + S.invSettings.photoMax + ' يوم · تجميع أكتر من ' + S.invSettings.consolidationAlert + ' أيام', summary: [{ label: 'قطع', value: String(sumQ(tl, 'onHand')) }, { label: 'منتجات', value: String(tl.length) }], headers: STOCK_H.concat(['الخطوة الجاية']), rows: tl.map((x) => stockRows([x])[0].concat([nextStep(x)])), onRow: openLot(tl), note: 'خد قرار: يرجع للمبتكر، يتحوّل للبيع، أو اشحن الموجود.', source: SRC })));
    if (part === 'overview') { // decision 58: the five cards on their own tab, the register on «سجل المخزون»
      const byR = ['تجميع أوردر', 'مرتجع', 'تصوير', 'متاح للبيع'].map((r) => [r, by(r).length, sumQ(by(r), 'onHand')]);
      return [kpis, K.Section('المخزن حسب السبب', U.Table({ headers: ['السبب', 'الأصناف', 'القطع'], rows: byR.map(([r, n, q]) => [K.Tag(REASON_TONE[r], r), K.Num(String(n)), K.Num(String(q))]) }), Button({ type: 'text', size: 'sm', label: 'افتح سجل المخزون', attrs: { 'data-inv-open-now': '' }, onClick: () => { st.tab = 'now'; try { history.replaceState(null, '', '#inventory-now'); } catch (e) { /* */ } R(); } }), { sub: 'اليوم ' + K.dlabel(TODAY) + ' · ' + all.length + ' صنف · ' + sumQ(all, 'onHand') + ' قطعة' })];
    }
    const f = st.f; const q = st.q.toLowerCase();
    const list = sortStock(all.filter((s) => matchStock(s, f, q)));
    // تحديد جماعي (owner 31 Oct): علّم إنه اتصور · نقل لمكان · تصدير
    const IB = K.Bulk({ key: 'inv-now', ids: list.map((x) => x.key), noun: 'منتج', render: R, actions: [
      { id: 'photo', label: 'علّم إنه اتصور', icon: 'check', run: (ids, done) => { const l = list.filter((x) => ids.includes(String(x.key)) && x.status === 'مستني تصوير'); if (!l.length) { K.toast('مفيش منتجات «مستني تصوير» في المحدد', 'error'); return; } l.forEach((x) => { const it = S.stock.find((y) => y.key === x.key); it.status = 'اتصور'; K.logEvent('stock.status', x.name + ' → اتصور'); }); done(l.length + ' اتصوروا — مستنيين قرار'); } },
      // B6: one of the three fixed places (or none), saved on each lot
      { id: 'loc', label: 'نقل لمكان', icon: 'box', run: (ids, done) => K.form({ title: 'نقل ' + ids.length + ' منتجات لمكان تاني', values: { loc: '' }, submitLabel: 'انقل', fields: (f, e, set) => [K.field.select('loc', 'المكان الجديد', LOC_OPTS(), f, e, set)], submit: (f) => { list.filter((x) => ids.includes(String(x.key))).forEach((x) => { const it = S.stock.find((y) => y.key === x.key); if (it) it.loc = f.loc || '—'; patchLot(x.key, { loc: f.loc }, 'inventory.place'); K.logEvent('stock.move', x.name + ' → ' + (f.loc || '—')); }); done(f.loc ? 'اتنقلوا لـ ' + locName(f.loc) : 'اتشال مكانهم'); } }) },
      { id: 'export', label: 'تصدير', icon: 'download', run: (ids, done) => { K.xlsxExport('ibtekr-stock-' + TODAY + '.xlsx', 'المخزن', [['المنتج', 'SKU', 'المبتكر', 'السبب', 'الحالة', 'المكان', 'الكمية']].concat(list.filter((x) => ids.includes(String(x.key))).map((x) => [x.name, x.sku, x.vendor, x.reason, x.status, x.loc, x.onHand]))); done(); } }] });
    const rows = list.map((s) => [IB.box(s.key, s.name), prodCell(s), s.vendor, K.Tag(REASON_TONE[s.reason], s.reason), K.Tag(STATUS_TONE[s.status] || 'neutral', s.status), s.ref ? h('a', { href: '#orders', class: 'num' }, s.ref) : '—', K.Num(s.loc), h('span', null, K.Num(String(s.onHand))), sinceTxt(s.since), h('span', { class: tooLong(s) ? 'late' : '' }, ageTxt(age(s)), tooLong(s) ? ' ⚠' : ''), h('span', { class: 't-small wrap' }, nextStep(s)), K.RowMenu(actionsFor(s), 'إجراءات ' + s.name)]);
    return [K.Section('فلاتر المخزن', [h('div', { class: 'toolbar', 'data-inv-toolbar': '' }, search('ابحث بالمنتج أو الأوردر أو الـ SKU', 'q', 'بحث في المخزن'), stockFilterMenu(all), stockSortMenu())], null, { cls: 'inv-filters', cols: false, sub: 'النتيجة: ' + list.length + ' صنف من ' + all.length + ' في المخزن' }),
      K.Section('سجل المخزون', [activeRow(all, list), IB.bar(), list.length ? U.Table({ cls: 'inv-table', headers: [IB.head(), 'المنتج', 'المبتكر', 'السبب', 'الحالة', 'المرجع', 'المكان', 'الكمية', 'دخل المخزن', 'بقاله', 'الخطوة الجاية', ''], rows }) : K.Empty('مفيش قطع بالفلتر ده', 'غيّر الفلتر أو البحث، أو سجّل استلام جديد.', Button({ type: 'primary', label: 'استلام في المخزن', onClick: () => receive() })),
      h('p', { class: 't-small help', style: 'margin:0' }, 'كل قطعة في المخزن ليها «سبب» و«حالة» و«خطوة جاية». السبب: تجميع أوردر · مرتجع · تصوير · متاح للبيع. منتجات التصوير ممكن بعد التصوير ترجع للمبتكر أو تتحوّل «متاح للبيع». السحب من المخزن بيبقى من الأوردر («اسحب من المخزن») على «متاح للبيع» بس، وتلقائي لو «السحب التلقائي» شغّال من الإعدادات. الكمية بتتحسب من الحركات.'),
      h('div', { class: 'legend t-small' }, h('b', null, 'الحالات:'), STATUSES.map((x) => K.Tag(STATUS_TONE[x], x)))], null, { cls: 'own-filter', sub: 'اليوم ' + K.dlabel(TODAY) + ' · ' + list.length + ' من ' + all.length + ' صنف · ' + sumQ(list, 'onHand') + ' قطعة في المخزن' })];
  }
  function actionsFor(s) {
    return [{ label: 'تفاصيل المنتج', icon: 'box', run: () => details(s) },
      !canEdit() ? null : s.status === 'مستني تصوير' ? { label: 'علّم إنه اتصور', icon: 'check', run: () => setStatus(s, 'اتصور', 'اتصور — مستني قرار') } : null,
      canEdit() && s.status === 'اتصور' ? { label: 'قرار بعد التصوير', icon: 'check', run: () => photoDecision(s) } : null,
      canEdit() && s.status === 'بانتظار الفحص' ? { label: 'فحص مرتجع', icon: 'check', run: () => inspect(s) } : null,
      s.reason === 'تجميع أوردر' ? { label: 'فتح التجميع', icon: 'truck', run: () => { st.tab = 'consolidate'; R(); } } : null,
      canApprove() ? { label: 'تسوية كمية', icon: 'sliders', run: () => adjust(s) } : null].filter(Boolean);
  }
  function setStatus(s, status, msg) { const it = S.stock.find((x) => x.key === s.key); it.status = status; patchLot(s.key, { status }, 'inventory.status'); K.logEvent('stock.status', s.name + ' → ' + status); K.toast(msg || 'اتغيرت الحالة', 'success'); rerender(); }
  const move = (m) => { const row = Object.assign({ at: TODAY + ' ' + K.clockNow(), by: K.member(K.ME).name, note: '' }, m); S.ledger.unshift(row); if (live()) saved(A().addMove(row)); return row; };
  // a new lot and its first move in one write (the lot first: a move needs it)
  const newLot = (lot, m) => { S.stock.unshift(lot); const row = Object.assign({ at: TODAY + ' ' + K.clockNow(), by: K.member(K.ME).name, note: '' }, m, { key: lot.key }); S.ledger.unshift(row); if (live()) saved(A().addLot(lot, row)).then((r) => { if (r.ok) reload(); }); return lot; };

  // ---------- تجميع أوردرات ----------
  function consTab() {
    const subsAll = S.consolidations.flatMap((c) => c.subs.map((x) => ({ c, x })));
    const ready = S.consolidations.filter((c) => O.consolidation(c.subs.map((x) => x[2])).ready);
    const lateSubs = subsAll.filter(({ c, x }) => x[2] !== 'وصل المخزن' && O.consolidationLate(K.daysBetween(c.since, TODAY)));
    const onWay = subsAll.filter(({ x }) => x[2] === 'تم الشحن للمخزن');
    const kpis = h('div', { class: 'cards' },
      K.Stat('أوردرات بتتجمع', S.consolidations.length, 'أوردر', subsAll.length + ' أوردرات فرعية', undefined, () => ({ title: 'أوردرات بتتجمع — ' + S.consolidations.length, sub: subsAll.length + ' أوردر فرعي', summary: [{ label: 'أوردرات', value: String(S.consolidations.length) }, { label: 'فرعيات', value: String(subsAll.length) }, { label: 'وصلت المخزن', value: String(subsAll.filter(({ x }) => x[2] === 'وصل المخزن').length) }], headers: CONS_H, rows: S.consolidations.map(consRow), note: 'تفاصيل كل أوردر فرعي في الكروت تحت.', source: SRC })),
      K.Stat('جاهزة تطلع كاملة', ready.length, 'أوردر', ready.map((c) => 'IB-' + c.order).join('، ') || '—', undefined, () => ({ title: 'أوردرات جاهزة تطلع كاملة — ' + ready.length, sub: 'كل الفرعيات وصلت المخزن — اشحنها في شحنة واحدة', summary: [{ label: 'أوردرات', value: String(ready.length) }], headers: CONS_H, rows: ready.map(consRow), source: SRC })),
      K.Stat('في الطريق للمخزن', onWay.length, 'أوردر فرعي', 'اتشحنت من المبتكر', undefined, () => ({ title: 'فرعيات في الطريق للمخزن — ' + onWay.length, sub: 'اتشحنت من المبتكر ومتوقعة النهارده', headers: SUB_H, rows: subRows(onWay), source: SRC })),
      K.Stat('متأخر عن التجميع', lateSubs.length, 'أوردر فرعي', 'لسه عند المبتكر', undefined, () => ({ title: 'فرعيات متأخرة عن التجميع — ' + lateSubs.length, sub: 'التجميع أكتر من ' + S.invSettings.consolidationAlert + ' أيام والفرعي لسه عند المبتكر', summary: [{ label: 'فرعيات', value: String(lateSubs.length) }, { label: 'مبتكرين', value: String(new Set(lateSubs.map(({ x }) => x[1])).size) }], headers: SUB_H, rows: subRows(lateSubs), note: 'تقدر تشحن الموجود والباقي يتشحن لوحده، أو تلغي التجميع.', source: SRC })));
    if (!S.consolidations.length) return [kpis, K.Section('', K.Empty('مفيش أوردرات بتتجمع', 'من صفحة الأوردرات: ⋮ › تجميع في المخزن.'))];
    return [kpis, ...S.consolidations.map((c) => { const p = O.consolidation(c.subs.map((x) => x[2])); const d = K.daysBetween(c.since, TODAY); const late = !p.ready && O.consolidationLate(d) && c.subs.some((x) => x[2] === 'قيد التنفيذ');
        const vendors = new Set(c.subs.map((x) => x[1])).size;
        return h('section', { class: 'card cons' + (late ? ' is-late' : '') },
          h('div', { class: 'cons-h' }, h('div', null, h('a', { href: '#orders', class: 'oid', onClick: (e) => { e.preventDefault(); location.hash = 'orders'; setTimeout(() => window.OrdersApp && window.OrdersApp.setQuery(String(c.order)), 50); } }, 'IB-' + c.order), h('span', { class: 't-label' }, ' · ' + c.customer), h('div', { class: 't-small help' }, vendors + ' مبتكرين · ' + (p.ready ? 'جاهز' : late ? 'فيه تأخير' : 'قرار التجميع: ' + (c.by || '—') + ' ' + K.dshort(c.since)))),
            h('div', { class: 'acts-inline' }, p.ready ? K.Tag('success', p.arrived + ' من ' + p.total + ' وصلوا — جاهز يطلع كامل', 'check') : K.Tag(late ? 'error' : 'info', p.arrived + ' من ' + p.total + (late ? ' — أوردر فرعي متأخر' : ' وصلوا')),
              late && !p.arrived ? Button({ size: 'sm', label: 'إلغاء التجميع', onClick: () => cancelCons(c) }) : Button({ type: 'primary', size: 'sm', label: 'شحن كامل', disabled: !p.ready, onClick: () => shipAll(c) }), !p.ready && p.arrived ? Button({ size: 'sm', label: 'اشحن الموجود والباقي بعدين', onClick: () => shipPartial(c, p) }) : null,
              K.RowMenu([{ label: 'إلغاء التجميع', icon: 'close', danger: true, run: () => cancelCons(c) }]))),
          U.ProgressBar(p.ready ? 'brand' : late ? 'neutral' : 'gold', p.arrived / p.total),
          U.Table({ cls: 'mini-table', headers: ['الأوردر الفرعي', 'المنتج', 'المبتكر', 'الحالة', 'وصل / متوقع', 'المكان', ''], rows: c.subs.map((x) => { const lot = S.stock.find((s) => s.reason === 'تجميع أوردر' && (x[4] && s.itemId ? String(s.itemId) === String(x[4]) : String(s.sub) === String(x[0])));
            const o = window.OrdersApp && window.OrdersApp.get ? window.OrdersApp.get(String(c.order)) : null; const so = o && o.subs ? o.subs.find((q) => String(q.sid) === String(x[0])) : null; const pn = lot ? lot.name : (so ? so.prod : (x[3] || '—'));
            return [K.Num('#' + x[0]), h('span', { class: 'prod' }, Thumb(lot ? lot.sku : so && so.sku, pn), h('span', null, pn)), x[1], K.Tag(x[2] === 'وصل المخزن' ? 'success' : x[2] === 'تم الشحن للمخزن' ? 'info' : 'neutral', x[2]), x[2] === 'وصل المخزن' ? 'وصل ' + (lot ? K.dshort(lot.since) : '') : x[2] === 'تم الشحن للمخزن' ? 'متوقع النهارده' : 'متوقع ' + K.dshort(O.addDays(TODAY, 3)), x[2] === 'وصل المخزن' ? K.Num(c.zone) : '—',
              x[2] !== 'وصل المخزن' ? Button({ type: 'text', size: 'sm', label: 'علّم وصل', onClick: () => markArrived(c, x) }) : '']; }) })); }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الفريق بيقرر التجميع لكل أوردر من صفحة الأوردرات (⋮ › تجميع في المخزن). الأوردرات الفرعية اللي في التجميع بتتشحن من المبتكر للمخزن («اتشحن للمخزن» ← «وصل المخزن»). لما الكل يوصل الأوردر بيبقى «جاهز يطلع كامل». لو حد اتأخر، تقدر تشحن الموجود والباقي يتشحن لوحده بعدين.')];
  }
  function markArrived(c, x) {
    const o = window.OrdersApp && window.OrdersApp.get ? window.OrdersApp.get(String(c.order)) : null; const sub = o && o.subs ? o.subs.find((s) => String(s.sid) === String(x[0])) : null;
    x[2] = 'وصل المخزن'; const key = newKey(); const ready = O.consolidation(c.subs.map((y) => y[2])).ready;
    newLot({ key, sku: sub ? sub.sku : 'SUB-' + x[0], name: sub ? sub.prod : (x[3] || 'فرعي #' + x[0]), vendor: x[1], reason: 'تجميع أوردر', status: ready ? 'جاهز يطلع كامل' : 'وصل المخزن', ref: 'IB-' + c.order, sub: x[0], itemId: x[4], order: c.order, since: TODAY, loc: c.zone, cost: lineCost(x[4], sub ? sub.tot : 0) },
      { type: 'in', qty: sub ? sub.qty || 1 : 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-' + c.order + ' · #' + x[0], note: 'وصل من ' + x[1] });
    if (ready) S.stock.forEach((s) => { if (String(s.order) === String(c.order) && s.reason === 'تجميع أوردر' && s.key !== key && s.status !== 'جاهز يطلع كامل') { s.status = 'جاهز يطلع كامل'; patchLot(s.key, { status: 'جاهز يطلع كامل' }, 'inventory.status'); } });
    window.OrdersSetSub && window.OrdersSetSub(x[0], 'وصل المخزن'); K.logEvent('stock.consolidation.arrive', '#' + x[0]); rerender();
  }
  function shipAll(c) {
    K.form({ title: 'شحن كامل من المخزن — IB-' + c.order, values: { carrier: 'Bosta' }, note: U.InlineNote({ kind: 'success', children: 'كل الفرعيات (' + c.subs.length + ') وصلت. هيطلع الأوردر في شحنة واحدة للعميل ' + c.customer + '.' }),
      fields: (f, e, set) => [K.field.select('carrier', 'شركة الشحن', ['Bosta', 'Aramex', 'مندوب ابتكر'], f, e, set, { required: true }), K.field.text('awb', 'رقم البوليصة', f, e, set, { required: true })],
      validate: (f) => K.req(f, ['carrier', 'awb']), submitLabel: 'شحن', submit: (f) => { const lots = K.stockNow().filter((s) => String(s.order) === String(c.order) && s.reason === 'تجميع أوردر');
        lots.forEach((s) => move({ key: s.key, type: 'out', qty: s.onHand, label: 'خروج — شحن مجمّع', reason: 'تجميع', ref: 'IB-' + c.order, note: 'شحنة واحدة ' + f.carrier + ' ' + f.awb }));
        S.consolidations = S.consolidations.filter((x) => x !== c); if (live() && c.id) saved(A().closeConsolidation(c.id, 'shipped', f.carrier + ' ' + f.awb)); c.subs.forEach((x) => window.OrdersSetSub && window.OrdersSetSub(x[0], 'تم الشحن للعميل')); K.logEvent('stock.consolidation.ship', c.order); K.toast('اتشحن IB-' + c.order + ' كامل', 'success'); rerender(); } });
  }
  // phase 7 decision 9 (owner, 4 Nov — «لو جمعت أوردر عندي في المخزن ولو حولته قيد الشحن ينقص من المخزن لأني بكده أبقى خرّجته»):
  // the order's status saved as «قيد الشحن» / «مكتمل» → every «تجميع أوردر» piece of it still in the hub leaves (an out move), the lines
  // that arrived are «تم الشحن للعميل», and its consolidation is closed (shipped, or partial when not every line had arrived)
  function shipOut(orderId, status) {
    const lots = K.stockNow().filter((s) => String(s.order) === String(orderId) && s.reason === 'تجميع أوردر' && !s.closed && s.onHand > 0);
    const c = S.consolidations.find((x) => String(x.order) === String(orderId)) || null;
    if (!lots.length && !c) return 0;
    if (!canEdit()) { K.toast('القطع لسه في المخزن — خروجها محتاج صلاحية المخزن', 'error'); return 0; }
    lots.forEach((s) => move({ key: s.key, type: 'out', qty: s.onHand, label: 'خروج — الأوردر اتشحن', reason: 'تجميع', ref: 'IB-' + orderId, note: 'الأوردر بقى «' + (status || 'قيد الشحن') + '»' }));
    const close = (x) => { const ready = O.consolidation(x.subs.map((y) => y[2])).ready;
      x.subs.filter((y) => y[2] === 'وصل المخزن').forEach((y) => window.OrdersSetSub && window.OrdersSetSub(y[0], 'تم الشحن للعميل'));
      S.consolidations = S.consolidations.filter((y) => y !== x); return x.id ? saved(A().closeConsolidation(x.id, ready ? 'shipped' : 'partial')) : null; };
    if (c && (c.id || !live())) close(c);
    // a consolidation opened a moment ago may not be on the page yet, or not carry its id (the hub not reloaded): read the hub, then close it
    else if (live()) A().load().then(() => { const c2 = S.consolidations.find((x) => String(x.order) === String(orderId)); if (c2) Promise.resolve(close(c2)).then(() => rerender()); });
    const pieces = lots.reduce((n, s) => n + s.onHand, 0);
    K.logEvent('stock.order.shipped', 'IB-' + orderId + ' · ' + pieces);
    if (pieces) K.toast('خرجت ' + pieces + ' قطعة من المخزن — IB-' + orderId, 'success');
    rerender(); return pieces;
  }
  function shipPartial(c, p) {
    K.confirm({ title: 'اشحن الموجود والباقي بعدين', text: 'هيطلع ' + p.arrived + ' من ' + p.total + ' دلوقتي والباقي هيتشحن لوحده من المبتكر للعميل لما يخلص.', okLabel: 'اشحن الموجود', onOk: () => {
      K.stockNow().filter((s) => String(s.order) === String(c.order) && s.reason === 'تجميع أوردر').forEach((s) => move({ key: s.key, type: 'out', qty: s.onHand, label: 'خروج — شحن جزئي', reason: 'تجميع', ref: 'IB-' + c.order }));
      c.subs.filter((x) => x[2] === 'وصل المخزن').forEach((x) => window.OrdersSetSub && window.OrdersSetSub(x[0], 'تم الشحن للعميل')); S.consolidations = S.consolidations.filter((x) => x !== c); if (live() && c.id) saved(A().closeConsolidation(c.id, 'partial')); K.logEvent('stock.consolidation.partial', c.order); K.toast('اتشحن الموجود من IB-' + c.order); rerender(); } });
  }
  function cancelCons(c) { K.confirm({ title: 'إلغاء التجميع', text: 'كل أوردر فرعي هيتشحن لوحده من المبتكر للعميل. القطع اللي وصلت المخزن هتطلع لوحدها.', okType: 'danger', okLabel: 'إلغاء التجميع', onOk: () => { S.consolidations = S.consolidations.filter((x) => x !== c); if (live() && c.id) saved(A().closeConsolidation(c.id, 'cancelled')); K.logEvent('stock.consolidation.cancel', c.order); K.toast('اتلغى التجميع'); rerender(); } }); }

  // ---------- المرتجعات ----------
  function returnsTab() {
    const rs = S.returns; const inStock = rs.filter((r) => r.type === 'مرتجع للمخزن'); const toVendor = rs.filter((r) => r.type === 'مرتجع للمبتكر');
    const damaged = rs.filter((r) => r.status === 'اتفحص — تالف').reduce((s, r) => s + (r.value || 0), 0);
    const tone = (s) => (s === 'بانتظار الفحص' ? 'orange' : s.includes('تالف') ? 'error' : s.includes('سليم') ? 'success' : 'neutral');
    const RB = K.Bulk({ key: 'inv-ret', ids: rs.map((r) => r.key + ':' + r.sub), noun: 'مرتجع', render: R, actions: [{ id: 'export', label: 'تصدير', icon: 'download', run: (ids, done) => { K.xlsxExport('ibtekr-returns-' + TODAY + '.xlsx', 'المرتجعات', [['المنتج', 'المبتكر', 'الأوردر الفرعي', 'نوع المرتجع', 'السبب', 'التاريخ', 'الحالة']].concat(rs.filter((r) => ids.includes(String(r.key + ':' + r.sub))).map((r) => [r.name, r.vendor, r.sub, r.type, r.reason, r.at, r.status]))); done(); } }] });;
    const waitR = rs.filter((r) => r.status === 'بانتظار الفحص'); const dmg = rs.filter((r) => r.status === 'اتفحص — تالف');
    // B6: the alert «المرتجع مستني كتير» — waiting for the inspection past the settings' days
    const rw = S.invSettings.returnWait || 7; const lateR = waitR.filter((r) => { const x = K.stockNow().find((y) => y.key === r.key); return x && age(x) >= rw; });
    return [h('div', { class: 'cards' },
      K.Stat('بانتظار الفحص', waitR.length, 'قطعة', lateR.length ? lateR.length + ' مستني أكتر من ' + rw + ' يوم' : 'مفيش مرتجع مستني أكتر من ' + rw + ' يوم', undefined, () => ({ title: 'مرتجعات بانتظار الفحص — ' + waitR.length, sub: 'سليم = يرجع متاح · تالف = حركة تالف', headers: RET_H, rows: retRows(waitR), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('رجعت للمخزن (أكتوبر)', inStock.length, 'قطعة', inStock.filter((r) => r.status.includes('سليم') || r.status === 'بانتظار الفحص').length + ' سليمة · ' + inStock.filter((r) => r.status.includes('تالف')).length + ' تالفة', undefined, () => ({ title: 'مرتجعات رجعت للمخزن (أكتوبر) — ' + inStock.length, summary: [{ label: 'سليمة / بانتظار الفحص', value: String(inStock.filter((r) => r.status.includes('سليم') || r.status === 'بانتظار الفحص').length) }, { label: 'تالفة', value: String(inStock.filter((r) => r.status.includes('تالف')).length) }], headers: RET_H, rows: retRows(inStock), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('رجعت للمبتكر (أكتوبر)', toVendor.length, 'قطعة', 'نصيب المبتكر اتلغى', undefined, () => ({ title: 'مرتجعات رجعت للمبتكر (أكتوبر) — ' + toVendor.length, sub: 'نصيب المبتكر اتلغى من الأوردر', headers: RET_H, rows: retRows(toVendor), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('قيمة التالف (أكتوبر)', K.money(damaged), 'ج.م', 'على ابتكر', undefined, () => ({ title: 'قيمة التالف (أكتوبر) — ' + K.money(damaged) + ' ج.م', sub: 'القطع اللي اتفحصت واتعلّمت تالفة — التكلفة على ابتكر', summary: [{ label: 'الإجمالي', value: K.money(damaged) + ' ج.م' }, { label: 'قطع', value: String(dmg.length) }], headers: RET_H, rows: retRows(dmg), source: 'المرتجعات من الأوردرات الفرعية' }))),
      K.Section('سجل المرتجعات', [RB.bar(), U.Table({ headers: [RB.head(), 'المنتج', 'الأوردر الفرعي', 'نوع المرتجع', 'السبب', 'التاريخ', 'الحالة', 'الأثر', 'الإجراء'], rows: rs.map((r) => [RB.box(r.key + ':' + r.sub, r.name), h('span', { class: 'prod' }, Thumb(r.sku, r.name), h('span', null, h('b', null, r.name), h('small', null, r.vendor + ' · ' + r.mode))), K.Num(r.sub), K.Tag(r.type === 'مرتجع للمخزن' ? 'orange' : 'error', r.type), r.reason, r.at, K.Tag(tone(r.status), r.status), r.effect,
        r.status === 'بانتظار الفحص' ? Button({ type: 'primary', size: 'sm', label: 'فحص', onClick: () => { const s = K.stockNow().find((x) => x.key === r.key); if (s) inspect(s, r); } }) : Button({ type: 'text', size: 'sm', label: 'عرض', onClick: () => U.Modal({ title: r.name + ' — ' + r.sub, share: true, body: [K.Kv([['المبتكر', r.vendor + ' · ' + r.mode], r.condition ? ['حالة المنتج عند الاستلام', (O.RETURN_CONDITIONS.find((c) => c.value === r.condition) || {}).label + (r.conditionNote ? ' — ' + r.conditionNote : '')] : null, ['النوع', r.type], ['السبب', r.reason], ['التاريخ', r.at], ['الحالة', r.status], ['الأثر', r.effect]])] }) })]) })], null, { sub: rs.length + ' مرتجع · بانتظار الفحص ' + rs.filter((r) => r.status === 'بانتظار الفحص').length }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'المرتجعات بتتعمل من الأوردرات › الأوردر الفرعي بتغيير الحالة لـ «مرتجع للمخزن» أو «مرتجع للمبتكر». المرتجع للمخزن مش بيزوّد المتاح غير بعد الفحص: سليم = + متاح · تالف = حركة تالف · ممكن يتحوّل «إرجاع للمبتكر».')];
  }
  // ---------- حركات المخزن ----------
  function movesTab() {
    const month = S.ledger.filter((m) => m.at.startsWith('2026-10')); const lot = (key) => S.stock.find((s) => s.key === key) || {};
    const ins = month.filter((m) => m.type === 'in'), outs = month.filter((m) => m.type === 'out' || m.type === 'ship'); const sum = (a) => a.reduce((s, m) => s + m.qty, 0);
    const byR = (a, r) => sum(a.filter((m) => m.reason === r)); const reserved = K.stockNow().reduce((s, x) => s + x.reserved, 0); const manual = month.filter((m) => m.type === 'adjust' || m.type === 'move').length;
    const sign = (m) => (m.type === 'in' ? '+ ' : m.type === 'out' || m.type === 'ship' ? '− ' : m.type === 'reserve' ? '− ' : m.type === 'adjust' ? (m.qty >= 0 ? '+ ' : '− ') : '');
    let MB = null; const q = st.mq.toLowerCase(); const list = S.ledger.filter((m) => (!st.mtype || m.label.startsWith(st.mtype)) && (!q || ((lot(m.key).name || m.name || '') + m.ref).toLowerCase().includes(q)));
    const resL = K.stockNow().filter((x) => x.reserved > 0); const manL = month.filter((m) => m.type === 'adjust' || m.type === 'move');
    return [h('div', { class: 'cards' },
      K.Stat('داخل الشهر', '+ ' + sum(ins), 'قطعة', 'تجميع ' + byR(ins, 'تجميع أوردر') + ' · مرتجعات ' + byR(ins, 'مرتجع') + ' · تصوير ' + byR(ins, 'تصوير') + ' · للبيع ' + byR(ins, 'متاح للبيع'), undefined, () => ({ title: 'حركات الدخول (أكتوبر) — ' + sum(ins) + ' قطعة', summary: [{ label: 'تجميع', value: String(byR(ins, 'تجميع أوردر')) }, { label: 'مرتجعات', value: String(byR(ins, 'مرتجع')) }, { label: 'تصوير', value: String(byR(ins, 'تصوير')) }, { label: 'للبيع', value: String(byR(ins, 'متاح للبيع')) }], headers: MV_H, rows: mvRows(ins), source: 'سجل حركات المخزن' })),
      K.Stat('خارج الشهر', '− ' + sum(outs), 'قطعة', outs.map((m) => m.label.replace('خروج — ', '')).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || '—', undefined, () => ({ title: 'حركات الخروج (أكتوبر) — ' + sum(outs) + ' قطعة', summary: [{ label: 'قطع', value: String(sum(outs)) }, { label: 'حركات', value: String(outs.length) }], headers: MV_H, rows: mvRows(outs), source: 'سجل حركات المخزن' })),
      K.Stat('حجوزات مفتوحة', reserved, 'قطعة', 'لأوردرات لسه متشحنتش', undefined, () => ({ title: 'حجوزات مفتوحة — ' + reserved + ' قطعة', sub: 'قطع محجوزة لأوردرات لسه متشحنتش', headers: ['المنتج', 'SKU', 'المبتكر', 'المرجع', 'محجوز', 'في المخزن', 'المكان'], rows: resL.map((x) => [x.name, x.sku, x.vendor, x.ref || '—', String(x.reserved), String(x.onHand), x.loc]), onRow: openLot(resL), source: 'سجل حركات المخزن' })),
      K.Stat('حركات يدوية', manual, 'حركة', 'تسويات + نقل أماكن', undefined, () => ({ title: 'حركات يدوية (أكتوبر) — ' + manual, sub: 'تسويات ونقل أماكن عملها الفريق بسبب', headers: MV_H, rows: mvRows(manL), source: 'سجل حركات المخزن' }))),
      K.Section('حركات المخزن', [h('div', { class: 'toolbar' }, (() => { const i = h('input', { type: 'search', placeholder: 'ابحث بالمنتج أو رقم الأوردر', 'aria-label': 'بحث في الحركات', value: st.mq }); i.addEventListener('input', () => { st.mq = i.value; const p = i.selectionStart; R(); const n = document.querySelector('#pg-inventory input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }); return h('label', { class: 'search-field' }, Icon('search', 'sm'), i); })(), U.Select({ id: 'mv-p', label: '', options: [{ value: '10', label: 'الفترة: أكتوبر 2026' }], value: '10', onChange: () => {} })),
        (MB = K.Bulk({ key: 'inv-moves', ids: list.map((m, i) => m.id || (m.at + ':' + i)), noun: 'حركة', render: R, actions: [{ id: 'export', label: 'تصدير', icon: 'download', run: (ids, done) => { K.xlsxExport('ibtekr-stock-moves-' + TODAY + '.xlsx', 'حركات المخزن', [MV_H].concat(list.filter((m, i) => ids.includes(String(m.id || (m.at + ':' + i)))).map((m) => [m.at, m.label, lot(m.key).name || m.name || '', m.qty, m.reason || '', m.ref || '', m.by || '', m.note || '']))); done(); } }] })).bar(),
        U.Table({ headers: [MB.head(), 'التاريخ', 'الحركة', 'المنتج', 'الكمية', 'السبب', 'المرجع', 'بواسطة', 'ملاحظة'], rows: list.map((m, mi) => { const l = lot(m.key); const d = m.at.slice(0, 10);
          return [MB.box(m.id || (m.at + ':' + mi), m.label), h('span', null, d === TODAY ? 'اليوم' : d === O.addDays(TODAY, -1) ? 'أمس' : K.dshort(d), ' ', K.Num(m.at.slice(11, 16))), K.Tag(m.type === 'in' ? 'success' : m.type === 'reserve' ? 'orange' : m.label === 'تالف' ? 'error' : m.type === 'move' ? 'brand' : 'neutral', m.label), h('span', { class: 'prod' }, h('span', null, h('b', null, l.name || m.name || '—'), h('small', { dir: 'ltr' }, l.sku || m.sku || ''))), K.Num(sign(m) + m.qty + (m.type === 'reserve' ? ' متاح' : '')), m.reason, K.Num(m.ref), m.by, h('span', { class: 't-small' }, m.note)]; }) }),
        h('p', { class: 't-small help', style: 'margin:0' }, 'الحجز والشحن وفك الحجز بيعملهم السيستم لوحده من الأوردرات. الاستلام والتسوية والتالف والإرجاع للمبتكر بيعملهم الفريق بسبب. أي غلطة بتتصلح بحركة عكسية — مفيش مسح.')], null, { sub: list.length + ' حركة · أكتوبر: دخول ' + sum(ins) + ' · خروج ' + sum(outs) })];
  }
  // ---------- الجرد ----------
  function countTab() {
    const c = S.count;
    if (!c) return [K.Section('الجرد', K.Empty('مفيش جرد شغال', 'ابدأ جرد جديد لرف أو للمخزن كله.', Button({ type: 'primary', label: 'جرد جديد', onClick: () => newCount() }))), history()];
    const diffs = c.lines.filter((l) => l.counted !== '' && Number(l.counted) !== l.system);
    const done = (c.base || 0) + c.lines.filter((l) => l.counted !== '').length;
    return [K.Section(c.id + ' — ' + c.zone, [h('div', { class: 'count-prog' }, h('b', null, 'التقدّم'), h('span', null, done + ' من ' + c.total + ' منتج اتعدّوا · ' + diffs.length + ' فروق لحد دلوقتي'), U.ProgressBar('brand', done / c.total)),
      h('div', { class: 'toolbar' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الـ SKU', 'aria-label': 'بحث في الجرد' })), U.Select({ id: 'cn-l', label: '', options: [{ value: 'B', label: 'المكان: رف B' }], value: 'B', onChange: () => {} }), U.Select({ id: 'cn-v', label: '', options: [{ value: '', label: 'العرض: الكل' }], value: '', onChange: () => {} }), h('span', { class: 't-small help' }, 'العدّ بيتحفظ تلقائي')),
      U.Table({ headers: ['المنتج', 'المكان', 'في السيستم', 'العدد الفعلي', 'الفرق', 'القيمة', 'ملاحظة'], rows: c.lines.map((l) => { const inp = h('input', { class: 'cnt-in', inputmode: 'numeric', value: l.counted, 'aria-label': 'العدد الفعلي — ' + l.name }); inp.addEventListener('change', () => { l.counted = O.toLatin(inp.value); if (live() && c.dbId) saved(A().countLine(c.dbId, l.key, l.counted, l.note)); K.toast('اتحفظ العدّ'); R(); });
        const d = l.counted === '' ? null : Number(l.counted) - l.system;
        return [prodCell(l), K.Num(l.loc), String(l.system), inp, d == null ? K.Tag('neutral', 'لسه') : d === 0 ? K.Tag('success', 'مطابق') : h('b', { class: d < 0 ? 'neg' : 'pos' }, K.Num((d > 0 ? '+ ' : '− ') + Math.abs(d))), d ? K.Num((d > 0 ? '+ ' : '− ') + K.money(Math.abs(d) * l.cost)) : '—', l.note || '—']; }) }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'أثناء الجرد «في السيستم» بيتثبت على لحظة بداية الجرد، والحجوزات الجديدة بتتحسب لوحدها. «اعتماد الجرد» بيعمل حركة «تسوية جرد» لكل فرق بالسبب. المنتجات اللي متعدتش بتفضل زي ما هي.')],
      [canApprove() ? Button({ type: 'primary', label: 'اعتماد الجرد', onClick: () => approveCount() }) : null], { sub: 'بدأ ' + c.started.slice(11) + ' النهارده' }), history()];
  }
  const history = () => K.Section('جرد سابق', U.Table({ cls: 'mini-table', headers: ['رقم الجرد', 'التاريخ', 'النطاق', 'بواسطة', 'أصناف فيها فرق', 'صافي الفرق', 'الحالة'], rows: S.counts.map((c) => [K.Num(c.id), K.dshort(c.date), c.zone, c.by, String(c.items), K.Num(K.money(c.value) + ' ج'), K.Tag('success', c.status)]) }));
  // ---------- إعدادات ----------


  // ---------- التقارير (decision 6) ----------
  // the v2 reports page's inventory view (its InventoryReportView + IbtekrReports.inventoryReport) here, on the hub's real data:
  // the pieces / value / returns now, the moves in the reports period (IBReportBlocks.range — the reports page's «المخزن» tab shows the same blocks since phase 9)
  function inventoryReport(stock, returns, ledger) {
    const S2 = stock || []; const byReason = {}; const byStatus = {};
    S2.forEach((x) => { byReason[x.reason || '—'] = (byReason[x.reason || '—'] || 0) + 1; byStatus[x.status || '—'] = (byStatus[x.status || '—'] || 0) + 1; });
    const value = Math.round(S2.reduce((n, x) => n + (Number(x.cost) || 0) * (Number(x.onHand) || 0), 0) * 100) / 100;
    const dist = (o) => Object.entries(o).map(([k, v]) => ({ label: k, count: v })).sort((a, b) => b.count - a.count);
    const rows = S2.slice().sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0)).slice(0, 20).map((x) => ({ name: x.name, vendor: x.vendor || '—', reason: x.reason || '—', status: x.status || '—', onHand: Number(x.onHand) || 0, available: Number(x.available) || 0, cost: Number(x.cost) || 0, since: x.since || '—' }));
    return { pieces: S2.reduce((n, x) => n + (Number(x.onHand) || 0), 0), value, waiting: (returns || []).filter((x) => /بانتظار/.test(x.status || '')).length, returns: (returns || []).length, moves: (ledger || []).length, byReason: dist(byReason), byStatus: dist(byStatus), rows };
  }
  function reportTab() {
    const RB = window.IBReportBlocks; const rr = (RB && RB.get && RB.get()) || { from: TODAY.slice(0, 8) + '01', to: TODAY };
    const now = K.stockNow().filter((x) => x.onHand > 0);
    const rep = inventoryReport(now, S.returns, S.ledger.filter((m) => { const d = String(m.at || '').slice(0, 10); return d >= rr.from && d <= rr.to; }));
    const rowsH = ['القطعة', 'المبتكر', 'سبب الدخول', 'الحالة', 'في المخزن', 'المتاح', 'التكلفة', 'من إمتى'];
    const rows = rep.rows.map((x) => [x.name, x.vendor, x.reason, K.Tag(STATUS_TONE[x.status] || 'neutral', x.status), K.Num(String(x.onHand)), K.Num(String(x.available)), K.Num(K.money(x.cost)), K.dshort(x.since)]);
    const maxR = Math.max(1, ...rep.byReason.map((x) => x.count)); const maxS = Math.max(1, ...rep.byStatus.map((x) => x.count));
    const bars = (list, max) => (list.length ? h('div', { class: 'bars' }, list.map((x, i) => U.BarRow({ tone: i === 0 ? 'brand' : i === 1 ? 'gold' : 'neutral', label: x.label, value: String(x.count), pct: x.count / max }))) : U.EmptyState('المخزن فاضي', 'مفيش قطع مسجلة.'));
    return [RB && RB.range ? h('div', { class: 'toolbar pr-rep-bar' }, RB.range()) : null,
      h('div', { class: 'cards four', 'data-rgroup': 'kpis' },
        U.KpiTile({ label: 'قطع في المخزن الآن', value: String(rep.pieces), unit: 'قطعة', compare: 'off', note: 'رصيد اللحظة الحالية — مش متأثر بالفترة' }),
        U.KpiTile({ label: 'قيمة المخزن', value: K.money(rep.value), unit: 'ج.م', compare: 'off', note: 'تكلفة المبتكر × الكمية' }),
        U.KpiTile({ label: 'مرتجعات مستنية الفحص', value: String(rep.waiting), unit: 'مرتجع', compare: 'off', note: 'من ' + rep.returns + ' مرتجع في السجل' }),
        U.KpiTile({ label: 'حركات المخزن في الفترة', value: String(rep.moves), unit: 'حركة', compare: 'off', note: K.dshort(rr.from) + ' – ' + K.dshort(rr.to) + ' · دخول · خروج · نقل' })),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        U.ChartCard({ title: 'سبب دخول القطع', subtitle: 'عدد الأصناف', footnote: 'نفس أرقام «المخزن الآن»', body: bars(rep.byReason, maxR) }),
        U.ChartCard({ title: 'حالة القطع', subtitle: 'عدد الأصناف', footnote: 'الحالة بتتغير من «المخزن الآن» و«المرتجعات»', body: bars(rep.byStatus, maxS) })),
      K.Section('أعلى 20 قطعة بالتكلفة', rep.rows.length ? U.Table({ cls: 'rp-inv', headers: rowsH, rows }) : U.EmptyState('المخزن فاضي', 'أول ما قطعة تدخل المخزن هتظهر هنا.'), null, { sub: rep.rows.length + ' صف' }),
      h('p', { class: 'source' }, 'المصدر: مخزن إبتكر (حركات الدخول والخروج) + سجل المرتجعات · التكلفة هي تكلفة المبتكر المسجلة على القطعة.')];
  }

  // ---------- popups ----------
  const REASON_HINT = () => ({ 'تجميع أوردر': 'بيتجمع مع باقي الأوردر ← «وصل المخزن»', 'مرتجع': '«بانتظار الفحص» — مش بيزوّد المتاح غير بعد الفحص', 'تصوير': '«مستني تصوير» — أقصى ' + S.invSettings.photoMax + ' يوم', 'متاح للبيع': '«متاح» — بيتسحب لأوردر من «اسحب من المخزن»' + (S.invSettings.firstWarehouse ? ' أو تلقائي (السحب التلقائي شغّال)' : '') });
  // «وصل المخزن» chosen on a sub-order in the orders page (owner 22 Oct): the storage reason comes from the warehouse reasons
  function arrival(info, ok) {
    const hints = REASON_HINT();
    K.form({ title: 'وصل المخزن — فرعي #' + info.sid, wide: true, values: { reason: O.arrivalReason(info.inConsolidation), loc: '', mode: 'أمانة', date: TODAY },
      note: h('div', { class: 'prod arrival-prod' }, Thumb(info.sku, info.prod), h('span', null, h('b', null, info.prod + ' × ' + (info.qty || 1)), h('small', { dir: 'ltr' }, (info.sku || '—')), h('small', null, info.vendor + ' · IB-' + info.order + ' · ' + K.money(info.tot || 0) + ' ج.م'))),
      fields: (f, e, set) => [
        K.Radios({ label: 'سبب التخزين *', value: f.reason, onChange: (v) => set('reason', v, true), options: O.REASONS.map((r) => ({ value: r, label: r, hint: hints[r] })) }), e.reason ? h('div', { class: 'err-msg', role: 'alert' }, e.reason) : null,
        info.inConsolidation && f.reason && f.reason !== 'تجميع أوردر' ? U.InlineNote({ kind: 'warning', children: 'الأوردر ده بيتجمع في المخزن — لو السبب مش «تجميع أوردر» القطعة مش هتتحسب في التجميع.' }) : null,
        f.reason === 'مرتجع' ? K.Radios({ label: 'حالة المنتج *', value: f.condition, onChange: (v) => set('condition', v, true), options: O.RETURN_CONDITIONS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) }) : null,
        f.reason === 'مرتجع' && e.condition ? h('div', { class: 'err-msg', role: 'alert' }, e.condition) : null,
        f.reason === 'مرتجع' && f.condition ? K.field.area('conditionNote', 'وصف الحالة', f, e, set, { required: ['عيب بسيط', 'ناقص', 'تالف'].includes(f.condition), placeholder: f.condition === 'ناقص' ? 'إيه اللي ناقص؟' : f.condition === 'سليم' ? 'اختياري' : 'وصف العيب أو التلف' }) : null,
        f.reason === 'مرتجع' && (f.condition === 'تالف' || f.condition === 'عيب بسيط') ? K.field.file('conditionPhoto', 'صورة الحالة', f, e, set) : null,
        f.reason === 'متاح للبيع' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة (فلوس المبتكر بعد البيع)' }, { value: 'ملك', label: 'ملك ابتكر' }] }) : null,
        K.two(placeField(f, e, set), K.field.date('date', 'تاريخ الوصول', f, e, set, { required: true })),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const e = O.validateReceive({ sku: info.sku || 'SUB-' + info.sid, qty: info.qty || 1, reason: f.reason, condition: f.condition, conditionNote: f.conditionNote }); if (e.reason) e.reason = 'اختار سبب التخزين'; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitLabel: 'تأكيد', cancelLabel: 'ليس الآن', submit: (f) => {
        const a = O.arrivalStock({ reason: f.reason, order: info.order, sid: info.sid }); const key = newKey(); const qty = info.qty || 1;
        newLot({ key, sku: info.sku || 'SUB-' + info.sid, name: info.prod, vendor: info.vendor, reason: f.reason, status: a.status, ref: a.ref, order: f.reason === 'تجميع أوردر' ? info.order : null, sub: info.sid, itemId: info.itemId, since: f.date, loc: f.loc || null, cost: lineCost(info.itemId, info.tot), mode: f.reason === 'متاح للبيع' ? f.mode : undefined, condition: f.reason === 'مرتجع' ? f.condition : undefined, conditionNote: f.reason === 'مرتجع' ? (f.conditionNote || '') : undefined, note: f.reason === 'مرتجع' ? (info.retReason || '') : (f.note || '') },
          { type: 'in', qty, label: a.label, reason: f.reason, ref: a.ref + ' · #' + info.sid, note: 'من الأوردرات — ' + info.vendor + (f.note ? ' · ' + f.note : '') });
        if (f.reason === 'مرتجع') S.returns.unshift({ name: info.prod, vendor: info.vendor, mode: 'أمانة', sub: '#' + info.sid, sku: info.sku, type: 'مرتجع للمخزن', reason: 'وصل المخزن من الأوردرات · ' + (O.RETURN_CONDITIONS.find((c) => c.value === f.condition) || {}).label, condition: f.condition, conditionNote: f.conditionNote || '', at: K.dshort(f.date), status: 'بانتظار الفحص', effect: '+ ' + qty + ' بعد الفحص', key });
        K.logEvent('stock.arrival', '#' + info.sid + ' · ' + f.reason); K.toast('اتسجل وصول #' + info.sid + ' للمخزن — ' + f.reason, 'success');
        ok({ reason: f.reason, date: f.date, loc: f.loc || '', condition: f.condition || '' }); rerender(); } });
  }
  // the makers of the system (IBVendors), else the prototype's list
  const makerNames = () => { const V = window.IBVendors && window.IBVendors.store; const l = V && V.all ? (V.all() || []).map((v) => v.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')) : []; return l.length ? l : ['Antikiano', 'zaan', 'W&R', 'HANDS', 'Rufaida', 'Ibtekr']; };
  // «استلام في المخزن» (owner, 4 Nov — plan decision 8): «من أوردر» by default — a searchable list of the orders (number or
  // customer), then the order's lines with a box each; every line ticked is a lot of its own tied to its order line (item_id),
  // with the line's product, SKU, maker, quantity and value. «يدوي» = the v2 form for a piece without an order.
  const orderList = () => { const D = window.IBOrders && window.IBOrders.data ? window.IBOrders.data() : null; return D && Array.isArray(D.orders) ? D.orders : []; };
  const inHub = (itemId) => S.stock.some((x) => !x.closed && x.itemId && String(x.itemId) === String(itemId));
  // decision 10 (owner, 4 Nov): a piece's value in the hub = the maker's price — the line's total less Ibtekr's commission on the line
  // (order_items.commission_rate / commission_fee), else the maker's current rate when visible, else the line's total
  const lineOf = (itemId) => { for (const o of orderList()) { const x = o.subs.find((y) => String(y.itemId) === String(itemId)); if (x) return x; } return null; };
  function makerCost(x) {
    if (!x) return 0; const tot = Number(x.tot) || 0; let rate = x.rate; let fee = Number(x.fee) || 0;
    if (rate == null) { const V = window.IBVendors && window.IBVendors.store; const v = x.vendorId && V && V.get ? V.get(x.vendorId) : null; if (v && v.rate != null) { rate = v.rate; fee = 0; } }
    if (rate == null || !Number.isFinite(Number(rate))) return tot;
    return Math.max(0, Math.round((tot - tot * Number(rate) / 100 - fee) * 100) / 100);
  }
  const lineCost = (itemId, tot) => { const x = itemId ? lineOf(itemId) : null; return x ? makerCost(x) : Number(tot) || 0; };
  function receive() { if (!orderList().length) return receiveManual(); receiveOrder(); }
  function receiveOrder() {
    const orders = orderList().slice().sort((a, b) => (String(b.date) > String(a.date) ? 1 : String(b.date) < String(a.date) ? -1 : Number(b.id) - Number(a.id)));
    const byId = (id) => orders.find((o) => String(o.id) === String(id)) || null;
    const picker = (f, e, set) => {
      const list = h('div', { class: 'rc-orders', role: 'listbox', 'aria-label': 'الأوردرات', style: 'max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:8px' });
      const paint = (q) => {
        const t = O.toLatin(String(q || '')).trim().toLowerCase().replace(/^ib-?/, '');
        const hits = orders.filter((o) => !t || String(o.id).includes(t) || String(o.name || '').toLowerCase().includes(t)).slice(0, 20);
        list.replaceChildren(...(hits.length ? hits.map((o) => Button({ type: 'text', size: 'sm', attrs: { role: 'option', 'data-rc-order': String(o.id), style: 'justify-content:flex-start;text-align:start' },
          label: 'IB-' + o.id + ' · ' + (o.name || '—') + ' · ' + o.subs.length + ' منتج · ' + (o.st || ''), onClick: () => { f.pick = {}; set('order', String(o.id), true); } }))
          : [h('div', { class: 't-small help' }, 'مفيش أوردر بالرقم أو الاسم ده')]));
      };
      const inp = h('input', { id: 'rc-q', type: 'search', placeholder: 'اكتب رقم الأوردر أو اسم العميل', autocomplete: 'off', value: f.oq || '' });
      inp.addEventListener('input', () => { f.oq = inp.value; paint(inp.value); });
      paint(f.oq);
      setTimeout(() => { try { inp.focus(); } catch (x) { /* */ } }, 0);
      return U.FieldShell({ id: 'rc-q', label: 'الأوردر', required: true, error: e.order }, h('div', null, h('div', { class: 'input' + (e.order ? ' err' : '') }, inp), list));
    };
    const linesOf = (o, f, e, set) => {
      const rows = o.subs.map((x) => { const done = inHub(x.itemId); const key = String(x.itemId);
        return K.Checkbox({ label: x.prod + ' × ' + (x.qty || 1) + ' — ' + (x.vendor || '—') + ' · #' + x.sid + (x.ss ? ' (' + x.ss + ')' : '') + (done ? ' · في المخزن' : ''), checked: !!f.pick[key], disabled: done,
          onChange: (v) => { f.pick[key] = v; set('pick', Object.assign({}, f.pick), true); } }); });
      const free = o.subs.filter((x) => !inHub(x.itemId));
      return h('div', { class: 'field', 'data-rc-lines': '' }, h('span', { class: 'flabel' }, 'المنتجات اللي هتستلمها *'),
        free.length > 1 ? Button({ type: 'text', size: 'sm', label: free.every((x) => f.pick[String(x.itemId)]) ? 'شيل الكل' : 'اختار الكل', onClick: () => { const all = free.every((x) => f.pick[String(x.itemId)]); free.forEach((x) => { f.pick[String(x.itemId)] = !all; }); set('pick', Object.assign({}, f.pick), true); } }) : null,
        ...rows, e.pick ? h('div', { class: 'err-msg', role: 'alert' }, e.pick) : null);
    };
    let md = null;
    md = K.form({ title: 'استلام في المخزن', wide: true, values: { order: '', oq: '', pick: {}, loc: '', mode: 'أمانة' },
      note: U.InlineNote({ children: 'اختار الأوردر، وعلّم على المنتجات اللي وصلت — كل منتج بيتسجل لوحده ومربوط بسطره في الأوردر. القطعة اللي مالهاش أوردر من «استلام يدوي».' }),
      fields: (f, e, set) => { const o = f.order ? byId(f.order) : null;
        return [o ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'الأوردر'), h('div', { class: 'row', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('b', { dir: 'ltr' }, 'IB-' + o.id), h('span', null, (o.name || '—') + ' · ' + K.money(o.tot || 0) + ' ج.م · ' + (o.st || '')),
            Button({ type: 'text', size: 'sm', label: 'غيّر الأوردر', onClick: () => { f.pick = {}; set('order', '', true); } }))) : picker(f, e, set),
          o ? linesOf(o, f, e, set) : null,
          o ? K.Radios({ label: 'سبب الاستلام *', value: f.reason, onChange: (v) => set('reason', v, true), options: O.REASONS.map((r) => ({ value: r, label: r, hint: REASON_HINT()[r] })) }) : null,
          o && e.reason ? h('div', { class: 'err-msg', role: 'alert' }, e.reason) : null,
          o && f.reason === 'مرتجع' ? K.Radios({ label: 'حالة المنتج *', value: f.condition, onChange: (v) => set('condition', v, true), options: O.RETURN_CONDITIONS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) }) : null,
          o && f.reason === 'مرتجع' && e.condition ? h('div', { class: 'err-msg', role: 'alert' }, e.condition) : null,
          o && f.reason === 'مرتجع' && f.condition ? K.field.area('conditionNote', 'وصف الحالة', f, e, set, { required: ['عيب بسيط', 'ناقص', 'تالف'].includes(f.condition), placeholder: f.condition === 'ناقص' ? 'إيه اللي ناقص؟' : f.condition === 'سليم' ? 'اختياري' : 'وصف العيب أو التلف' }) : null,
          o && f.reason === 'متاح للبيع' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة (فلوس المبتكر بعد البيع)' }, { value: 'ملك', label: 'ملك ابتكر' }] }) : null,
          o ? placeField(f, e, set) : null,
          h('div', null, Button({ type: 'text', size: 'sm', label: 'استلام يدوي (من غير أوردر)', attrs: { 'data-rc-manual': '' }, onClick: () => { if (md) md.close(); receiveManual(); } }))]; },
      validate: (f) => { const e = {}; const o = f.order ? byId(f.order) : null; if (!o) { e.order = 'اختار الأوردر'; return e; }
        const picked = o.subs.filter((x) => f.pick[String(x.itemId)] && !inHub(x.itemId)); if (!picked.length) e.pick = 'علّم على منتج واحد على الأقل';
        const v = O.validateReceive({ sku: (picked[0] && picked[0].sku) || 'SUB', qty: 1, reason: f.reason, condition: f.condition, conditionNote: f.conditionNote }); if (v.reason) e.reason = 'اختار سبب الاستلام'; if (v.condition) e.condition = v.condition; if (v.conditionNote) e.conditionNote = v.conditionNote; return e; },
      submitLabel: 'استلام', submit: (f) => { const o = byId(f.order);
        const picked = o.subs.filter((x) => f.pick[String(x.itemId)] && !inHub(x.itemId));
        // «تجميع أوردر»: when these are the last lines of the order not in the hub yet, the order is «جاهز يطلع كامل» (its earlier lots too)
        const ready = f.reason === 'تجميع أوردر' && o.subs.filter((x) => !x.pulled && x.ss !== 'تم الشحن للعميل').every((x) => inHub(x.itemId) || picked.includes(x));
        const status = ready ? 'جاهز يطلع كامل' : O.STATUS_BY_REASON[f.reason][0];
        if (ready) S.stock.forEach((x) => { if (String(x.order) === String(o.id) && x.reason === 'تجميع أوردر' && !x.closed && x.status !== 'جاهز يطلع كامل') { x.status = 'جاهز يطلع كامل'; patchLot(x.key, { status: 'جاهز يطلع كامل' }, 'inventory.status'); } });
        const label = 'دخول — ' + (f.reason === 'متاح للبيع' ? 'للبيع' : f.reason === 'تجميع أوردر' ? 'تجميع' : f.reason);
        picked.forEach((x) => { const ref = f.reason === 'مرتجع' ? '#' + x.sid : 'IB-' + o.id;
          newLot({ key: newKey(), sku: x.sku || 'SUB-' + x.sid, name: x.prod, vendor: x.vendor, vendorId: x.vendorId || null, reason: f.reason, status, ref, order: o.id, sub: x.sid, itemId: x.itemId, since: TODAY, loc: f.loc || '—', cost: makerCost(x),
            mode: f.reason === 'متاح للبيع' ? f.mode : undefined, condition: f.reason === 'مرتجع' ? f.condition : undefined, conditionNote: f.reason === 'مرتجع' ? (f.conditionNote || '') : undefined, note: f.reason === 'مرتجع' ? 'استلام من الأوردر IB-' + o.id : '' },
            { type: 'in', qty: x.qty || 1, label, reason: f.reason, ref: ref + ' · #' + x.sid }); });
        // «تجميع أوردر» (owner, 4 Nov — the cards stayed 0): the order is being gathered — its open consolidation gets the ticked lines,
        // or one is opened with every line of the order not shipped yet (the progress counts the lots received)
        if (f.reason === 'تجميع أوردر' && live()) { const c = S.consolidations.find((x) => String(x.order) === String(o.id));
          const open = o.subs.filter((x) => !x.pulled && x.ss !== 'تم الشحن للعميل' && x.itemId).map((x) => x.itemId);
          if (c && c.id) { const have = new Set(c.subs.map((y) => String(y[4]))); const add = picked.map((x) => x.itemId).filter((x) => x && !have.has(String(x))); if (add.length) saved(A().addToConsolidation(c.id, add)).then((r) => { if (r.ok) reload(); }); }
          else if (!c && open.length) saved(A().consolidate(o.id, [...new Set(open.concat(picked.map((x) => x.itemId)))], 'T')).then((r) => { if (r.ok) reload(); }); }
        // «تجميع أوردر»: a sub-order whose lines all arrived is «وصل المخزن» on the orders page too (the same write as the orders page)
        if (f.reason === 'تجميع أوردر' && window.OrdersSetSub) [...new Set(picked.map((x) => x.sid))].forEach((sid) => { if (o.subs.filter((x) => x.sid === sid).every((x) => f.pick[String(x.itemId)] || inHub(x.itemId))) window.OrdersSetSub(sid, 'وصل المخزن'); });
        K.logEvent('stock.receive', 'IB-' + o.id + ' · ' + picked.length + ' (' + f.reason + ')'); K.toast('اتسجل استلام ' + picked.length + ' منتج من IB-' + o.id, 'success'); rerender(); } });
  }
  function receiveManual() {
    K.form({ title: 'استلام في المخزن', wide: true, values: { qty: '1', loc: '', mode: 'أمانة' }, note: U.InlineNote({ children: 'السبب مطلوب — هو اللي بيحدد الحالة والخطوة الجاية.' }),
      fields: (f, e, set) => [K.two(K.field.text('name', 'المنتج', f, e, set, { required: true }), K.field.text('sku', 'SKU', f, e, set, { required: true })), K.two(K.field.select('vendor', 'المبتكر', makerNames(), f, e, set, { required: true }), K.field.text('qty', 'الكمية', f, e, set, { required: true, inputmode: 'numeric' })),
        K.Radios({ label: 'سبب الاستلام *', value: f.reason, onChange: (v) => set('reason', v, true), options: O.REASONS.map((r) => ({ value: r, label: r, hint: REASON_HINT()[r] })) }), e.reason ? h('div', { class: 'err-msg', role: 'alert' }, e.reason) : null,
        f.reason === 'تجميع أوردر' || f.reason === 'مرتجع' ? K.field.text('order', f.reason === 'مرتجع' ? 'الأوردر الفرعي' : 'رقم الأوردر', f, e, set, { required: true, placeholder: f.reason === 'مرتجع' ? '180549' : '180662' }) : null,
        f.reason === 'مرتجع' ? K.Radios({ label: 'حالة المنتج *', value: f.condition, onChange: (v) => set('condition', v, true), options: O.RETURN_CONDITIONS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) }) : null,
        f.reason === 'مرتجع' && e.condition ? h('div', { class: 'err-msg', role: 'alert' }, e.condition) : null,
        f.reason === 'مرتجع' && f.condition ? K.field.area('conditionNote', 'وصف الحالة', f, e, set, { required: ['عيب بسيط', 'ناقص', 'تالف'].includes(f.condition), placeholder: f.condition === 'ناقص' ? 'إيه اللي ناقص؟' : f.condition === 'سليم' ? 'اختياري' : 'وصف العيب أو التلف' }) : null,
        f.reason === 'مرتجع' && (f.condition === 'تالف' || f.condition === 'عيب بسيط') ? K.field.file('conditionPhoto', 'صورة الحالة', f, e, set) : null,
        f.reason === 'متاح للبيع' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة (فلوس المبتكر بعد البيع)' }, { value: 'ملك', label: 'ملك ابتكر' }] }) : null,
        placeField(f, e, set)],
      validate: (f) => { const e = O.validateReceive({ sku: f.sku, qty: f.qty, reason: f.reason, condition: f.condition, conditionNote: f.conditionNote }); Object.assign(e, K.req(f, ['name', 'vendor'])); if ((f.reason === 'تجميع أوردر' || f.reason === 'مرتجع') && !f.order) e.order = 'اكتب الرقم'; if (e.sku) e.sku = 'اكتب الـ SKU'; return e; },
      submitLabel: 'استلام', submit: (f) => { const status = O.STATUS_BY_REASON[f.reason][0]; const key = newKey(); const ref = f.order ? (f.reason === 'مرتجع' ? '#' : 'IB-') + O.toLatin(f.order) : null;
        newLot({ key, sku: f.sku.trim(), name: f.name.trim(), vendor: f.vendor, reason: f.reason, status, ref, order: f.reason === 'تجميع أوردر' ? O.toLatin(f.order) : null, since: TODAY, loc: f.loc || null, cost: 0, mode: f.reason === 'متاح للبيع' ? f.mode : undefined, condition: f.reason === 'مرتجع' ? f.condition : undefined, conditionNote: f.reason === 'مرتجع' ? (f.conditionNote || '') : undefined, note: f.reason === 'مرتجع' ? 'استلام يدوي' : '' },
          { type: 'in', qty: Number(O.toLatin(f.qty)), label: 'دخول — ' + (f.reason === 'متاح للبيع' ? 'للبيع' : f.reason === 'تجميع أوردر' ? 'تجميع' : f.reason), reason: f.reason, ref: ref || '—' });
        if (f.reason === 'مرتجع') S.returns.unshift({ name: f.name.trim(), vendor: f.vendor, mode: 'أمانة', sub: ref, type: 'مرتجع للمخزن', reason: 'استلام يدوي · ' + (O.RETURN_CONDITIONS.find((c) => c.value === f.condition) || {}).label, condition: f.condition, conditionNote: f.conditionNote || '', at: 'النهارده', status: 'بانتظار الفحص', effect: '+ ' + f.qty + ' بعد الفحص', key });
        K.logEvent('stock.receive', f.sku + ' × ' + f.qty + ' (' + f.reason + ')'); K.toast('اتسجل الاستلام', 'success'); rerender(); } });
  }
  function adjust(s) {
    K.form({ title: 'تسوية كمية — ' + s.name, values: { qty: String(s.onHand) }, note: U.InlineNote({ children: 'الكمية في السيستم دلوقتي: ' + s.onHand + ' (محجوز ' + s.reserved + ')' }),
      fields: (f, e, set) => [K.field.text('qty', 'الكمية الفعلية', f, e, set, { required: true, inputmode: 'numeric' }), K.field.select('why', 'السبب', ['جرد', 'تالف', 'ضايع', 'خطأ تسجيل', 'نقل مكان'], f, e, set, { required: true }), K.field.area('note', 'ملاحظة', f, e, set)],
      validate: (f) => { const e = K.req(f, ['qty', 'why']); if (f.qty !== '' && !(Number(O.toLatin(f.qty)) >= 0)) e.qty = 'رقم 0 أو أكتر'; else if (Number(O.toLatin(f.qty)) < s.reserved) e.qty = 'مينفعش أقل من المحجوز (' + s.reserved + ')'; return e; },
      submitLabel: 'حفظ التسوية', submit: (f) => { const d = Number(O.toLatin(f.qty)) - s.onHand; if (d) move({ key: s.key, type: 'adjust', qty: d, label: f.why === 'تالف' ? 'تالف' : 'تسوية', reason: f.why, ref: '—', note: f.note || '' }); K.logEvent('stock.adjust', s.name + ' ' + d); K.toast(d ? 'اتسجلت تسوية ' + (d > 0 ? '+' : '') + d : 'مفيش فرق'); rerender(); } });
  }
  function details(s) {
    const mv = S.ledger.filter((m) => m.key === s.key);
    const md = U.Modal({ title: 'تفاصيل المنتج', share: true, body: [h('div', { class: 'prod lg' }, Thumb(s.sku, s.name, true), h('span', null, h('b', null, s.name), h('small', { dir: 'ltr' }, s.sku))),
      K.Kv([['المبتكر', s.vendor + (s.mode ? ' · ' + s.mode : '')], ['السبب', K.Tag(REASON_TONE[s.reason], s.reason)], ['الحالة', K.Tag(STATUS_TONE[s.status] || 'neutral', s.status)], ['الخطوة الجاية', nextStep(s)], ['بقاله', ageTxt(age(s)) + ' (من ' + K.dlabel(s.since) + ')'], ['الكمية', s.onHand + ' · متاح ' + s.available + ' · محجوز ' + s.reserved], ['المكان', s.loc], s.ref ? ['المرجع', s.ref] : null, s.condition ? ['حالة المنتج عند الاستلام', (O.RETURN_CONDITIONS.find((c) => c.value === s.condition) || {}).label + (s.conditionNote ? ' — ' + s.conditionNote : '')] : null]),
      h('h3', { class: 't-label' }, 'الحركات'), U.Table({ cls: 'mini-table', headers: ['التاريخ', 'الحركة', 'الكمية', 'بواسطة'], rows: mv.map((m) => [K.dshort(m.at.slice(0, 10)), m.label, String(m.qty), m.by]) })],
      footer: [canApprove() ? Button({ label: 'تسوية كمية', onClick: () => { md.close(); adjust(s); } }) : null, Button({ type: 'primary', label: 'إغلاق', onClick: () => md.close() })] });
  }
  function photoDecision(s) {
    K.form({ title: 'قرار بعد التصوير — ' + s.name, values: { decision: 'back', mode: 'أمانة', loc: s.loc && s.loc !== '—' ? s.loc : '' }, note: U.InlineNote({ children: s.vendor + ' · في المخزن من ' + K.dlabel(s.since) + ' (' + ageTxt(age(s)) + ')' }),
      fields: (f, e, set) => [K.Radios({ label: 'القرار', value: f.decision, onChange: (v) => set('decision', v, true), options: [{ value: 'back', label: 'يرجع للمبتكر' }, { value: 'sell', label: 'يتحوّل «متاح للبيع» من المخزن' }] }),
        f.decision === 'sell' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة' }, { value: 'ملك', label: 'ملك ابتكر (اتشترى)' }] }) : null, f.decision === 'sell' ? K.field.select('loc', 'المكان (اختياري)', LOC_OPTS(), f, e, set) : null],
      submitLabel: 'حفظ القرار',
      submit: (f) => { const it = S.stock.find((x) => x.key === s.key);
        if (f.decision === 'back') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'رجوع للمبتكر', reason: 'تصوير', ref: '—', note: 'بعد التصوير' }); it.status = 'راجع للمبتكر'; patchLot(s.key, { status: 'راجع للمبتكر' }, 'inventory.photo'); }
        else { it.reason = 'متاح للبيع'; it.status = 'متاح'; it.mode = f.mode; it.loc = f.loc || '—'; patchLot(s.key, { reason: 'متاح للبيع', status: 'متاح', mode: f.mode, loc: f.loc || '' }, 'inventory.photo'); move({ key: s.key, type: 'move', qty: 0, label: 'تحويل للبيع', reason: 'قرار بعد التصوير', ref: 'تصوير ← للبيع', note: f.mode + ' من ' + s.vendor }); }
        K.logEvent('stock.photo.decision', s.name + ' ' + f.decision); K.toast(f.decision === 'back' ? 'هيرجع للمبتكر' : 'بقى متاح للبيع (' + f.mode + ')', 'success'); rerender(); } });
  }
  function inspect(s, ret) {
    const r = ret || S.returns.find((x) => x.key === s.key);
    const cond = (r && r.condition) || s.condition; const condNote = (r && r.conditionNote) || s.conditionNote;
    K.form({ title: 'فحص مرتجع — ' + s.name, values: { next: S.invSettings.returnDefault === 'يرجع للمبتكر' ? 'رجوع للمبتكر' : 'متاح للبيع', result: O.inspectDefault(cond) }, note: U.InlineNote({ children: (s.ref || '') + ' · ' + s.vendor + ' · وصل ' + K.dlabel(s.since) + (r ? ' · السبب: ' + r.reason : '') + (cond ? ' · حالته عند الاستلام: ' + (O.RETURN_CONDITIONS.find((c) => c.value === cond) || {}).label + (condNote ? ' (' + condNote + ')' : '') : '') }),
      fields: (f, e, set) => [K.Radios({ label: 'النتيجة *', value: f.result, onChange: (v) => set('result', v, true), options: [{ value: 'سليم', label: 'سليم' }, { value: 'تالف', label: 'تالف' }] }), e.result ? h('div', { class: 'err-msg', role: 'alert' }, e.result) : null,
        f.result === 'سليم' ? K.Radios({ label: 'هيروح فين', value: f.next, onChange: (v) => set('next', v, true), options: [{ value: 'متاح للبيع', label: '+ متاح للبيع من المخزن' }, { value: 'رجوع للمبتكر', label: 'إرجاع للمبتكر' }] }) : null,
        K.field.area('note', 'ملاحظات الفحص', f, e, set, { required: f.result === 'تالف', placeholder: f.result === 'تالف' ? 'وصف التلف' : '' }), f.result === 'تالف' ? K.field.file('photo', 'صورة التلف', f, e, set) : null],
      validate: (f) => { const e = {}; if (!f.result) e.result = 'اختار نتيجة الفحص'; if (f.result === 'تالف' && !String(f.note || '').trim()) e.note = 'اكتب وصف التلف'; return e; }, submitLabel: 'حفظ الفحص',
      submit: (f) => { const it = S.stock.find((x) => x.key === s.key);
        if (f.result === 'تالف') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'تالف', reason: 'مرتجع', ref: 'فحص ' + (s.ref || ''), note: f.note }); it.status = 'تالف'; patchLot(s.key, { status: 'تالف' }, 'inventory.inspect'); if (r) { r.status = 'اتفحص — تالف'; r.effect = '− تالف ' + K.money(s.cost) + ' ج'; r.value = s.cost; } }
        else if (f.next === 'رجوع للمبتكر') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'رجوع للمبتكر', reason: 'مرتجع', ref: s.ref || '—', note: f.note || '' }); it.status = 'راجع للمبتكر'; patchLot(s.key, { status: 'راجع للمبتكر' }, 'inventory.inspect'); if (r) { r.status = 'اتفحص — رجع للمبتكر'; r.effect = 'رجع لـ ' + s.vendor; } }
        else { it.reason = 'متاح للبيع'; it.status = 'متاح'; patchLot(s.key, { reason: 'متاح للبيع', status: 'متاح' }, 'inventory.inspect'); if (r) { r.status = 'اتفحص — سليم'; r.effect = '+ 1 متاح'; } }
        K.logEvent('stock.return.inspect', s.name + ' ' + f.result); K.toast('اتسجل الفحص: ' + f.result, 'success'); rerender(); } });
  }
  function newCount() {
    if (S.count) { st.tab = 'count'; R(); return K.toast('فيه جرد شغال (' + S.count.id + ') — كمّله أو اعتمده الأول'); }
    K.form({ title: 'جرد جديد', values: { zone: 'كل المخزن' }, fields: (f, e, set) => [K.field.select('zone', 'النطاق', ['كل المخزن', 'منطقة التجميع T', 'المرتجعات R', 'التصوير P'], f, e, set, { required: true }), h('p', { class: 't-small help', style: 'margin:0' }, '«في السيستم» هيتثبت على لحظة البداية. العدّ بيتحفظ تلقائي.')], submitLabel: 'ابدأ الجرد',
      submit: (f) => { const items = K.stockNow().filter((s) => s.onHand > 0); if (live()) { saved(A().startCount(f.zone, items.map((s) => s.key)), 'بدأ الجرد').then((r) => { if (r.ok) { st.tab = 'count'; reload(); } }); return; } S.count = { id: 'CNT-' + String(8 + S.counts.length).padStart(2, '0'), zone: f.zone, started: TODAY + ' ' + K.clockNow(), total: items.length, base: 0, lines: items.map((s) => ({ key: s.key, sku: s.sku, name: s.name, loc: s.loc, system: s.onHand, counted: '', cost: s.cost, note: '' })) }; st.tab = 'count'; K.logEvent('stock.count.start', f.zone); R(); } });
  }
  function approveCount() {
    const c = S.count; const d = O.countDiff(c.lines.filter((l) => l.counted !== '').map((l) => ({ system: l.system, counted: Number(l.counted), cost: l.cost })));
    const left = c.lines.filter((l) => l.counted === '').length;
    K.confirm({ title: 'اعتماد الجرد ' + c.id, text: d.items + ' أصناف فيها فرق · صافي ' + (d.units > 0 ? '+' : '') + d.units + ' قطعة · ' + K.money(d.value) + ' ج. هيتعمل حركة «تسوية جرد» لكل فرق.' + (left ? ' ' + left + ' منتج لسه متعدّش وهيفضل زي ما هو.' : ''), okLabel: 'اعتماد الجرد', onOk: () => {
      if (live() && c.dbId) { saved(A().approveCount(c.dbId), 'اتعتمد ' + c.id).then((r) => { if (r.ok) reload(); }); return; }
      c.lines.filter((l) => l.counted !== '' && Number(l.counted) !== l.system).forEach((l) => move({ key: l.key || l.sku, type: 'adjust', qty: Number(l.counted) - l.system, label: 'تسوية جرد', reason: 'جرد ' + c.id, ref: c.id, note: l.note || '', name: l.name, sku: l.sku }));
      S.counts.unshift({ id: c.id, date: TODAY, zone: c.zone, by: K.member(K.ME).name, items: d.items, value: d.value, status: 'اتعتمد' }); S.count = null; K.logEvent('stock.count.approve', c.id); K.toast('اتعتمد ' + c.id, 'success'); R(); } });
  }
  // phase 7 decision 10 (d) (owner, 4 Nov — «أيوه، بس بتأكيد»): the orders page shows «في المخزن» on a line whose SKU is held
  // «متاح للبيع» with enough available, and its menu offers «اسحب من المخزن»: the team confirms → a reserve move on the lot for the
  // order and the line is «مخزن ابتكر» (pulled — no maker notice). Never automatic.
  const hubLot = (sku, qty) => { const k = String(sku || '').trim(); if (!k) return null; return K.stockNow().find((s) => s.sku === k && s.reason === 'متاح للبيع' && !s.closed && s.available >= (Number(qty) || 1)) || null; };
  function pullPopup(info, ok) {
    const it = hubLot(info.sku, info.qty); if (!it) { K.toast('مفيش قطعة متاحة من المنتج ده في المخزن دلوقتي', 'error'); return; }
    if (!canEdit()) { K.toast('السحب من المخزن محتاج صلاحية المخزن', 'error'); return; }
    const qty = Number(info.qty) || 1;
    K.confirm({ title: 'اسحب من المخزن — IB-' + info.order, okLabel: 'اسحب من المخزن',
      text: info.prod + ' × ' + qty + ' — متاح ' + it.available + ' في ' + (it.loc || 'المخزن') + (it.mode ? ' (' + it.mode + ')' : '') + '. القطعة هتتحجز للأوردر، والأوردر الفرعي #' + info.sid + ' هيتنفذ من مخزن ابتكر بدل ' + (info.vendor || 'المبتكر') + '.',
      onOk: () => { move({ key: it.key, type: 'reserve', qty, label: 'حجز لأوردر', reason: 'متاح للبيع', ref: 'IB-' + info.order, note: 'سحب من المخزن · #' + info.sid });
        const lot = S.stock.find((s) => s.key === it.key); if (lot && it.available - qty <= 0) { lot.status = 'محجوز لأوردر'; patchLot(it.key, { status: 'محجوز لأوردر' }, 'inventory.pull'); }
        K.logEvent('stock.pull', info.sku + ' → IB-' + info.order); K.toast('اتسحب من المخزن لـ IB-' + info.order, 'success'); if (ok) ok(); rerender(); } });
  }
  // auto-pull from «متاح للبيع» — called when a new order contains a stocked SKU
  function autoPull(sku, qty, order) {
    const it = K.stockNow().find((s) => s.sku === sku && s.reason === 'متاح للبيع'); if (!it || !O.canAutoPull(it, qty) || !S.invSettings.firstWarehouse) return false;
    move({ key: it.key, type: 'reserve', qty, label: 'حجز لأوردر', reason: 'متاح للبيع', ref: 'IB-' + order, by: 'السيستم (تلقائي)', note: 'سحب تلقائي' }); S.stock.find((s) => s.key === it.key).status = 'محجوز لأوردر'; patchLot(it.key, { status: 'محجوز لأوردر' }, 'inventory.autopull');
    K.notify({ title: 'اتحجزت قطعة من المخزن: ' + it.name + ' لأوردر IB-' + order, link: '#inventory-now' }); K.logEvent('stock.autopull', sku + ' → IB-' + order); return true;
  }

  window.IBPages.register('inventory', { title: 'المخزن', hash: (hs) => { const m = /^inventory(?:-(overview|now|consolidate|returns|moves|count|reports|settings))?$/.exec(hs); if (!m) return false; if (m[1] === 'settings') { st.tab = 'overview'; setTimeout(() => { try { location.hash = 'settings-inventory'; } catch (e) { /* */ } }, 0); return true; } st.tab = m[1] || 'overview'; return true; }, defaultHash: () => 'inventory-' + st.tab, view, api: { autoPull, receive, arrival, shipAll, cancelCons, shipOut, lineCost, hubLot, pullPopup } });
})();
