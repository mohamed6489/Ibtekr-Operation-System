
/* Inventory = temporary hub «المخزن» — Figma page 314:3387 (388:2197, 389:2335, 384:50221, 384:49812, 384:50691, 384:51266).
   Every lot has السبب / الحالة / الخطوة الجاية / بقاله. Quantities come from the movement ledger. Auto-pull only from «متاح للبيع». */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U; const S = K.store;
  const TABS = [{ id: 'now', label: 'المخزن الآن' }, { id: 'consolidate', label: 'تجميع أوردرات' }, { id: 'returns', label: 'المرتجعات' }, { id: 'moves', label: 'حركات المخزن' }, { id: 'count', label: 'الجرد' }, { id: 'settings', label: 'إعدادات المخزن' }];
  const st = { tab: 'now', f: { reason: '', status: '', vendor: '', loc: '' }, q: '', mq: '', mtype: '' };
  const R = () => window.IBPages.render('inventory');
  const rerender = () => { if (window.IBPages.current === 'inventory') R(); else window.OrdersSetSub && window.OrdersSetSub('__redraw__', null); document.dispatchEvent(new CustomEvent('ib:notify')); };
  const REASON_TONE = { 'تجميع أوردر': 'info', 'مرتجع': 'orange', 'تصوير': 'gold', 'متاح للبيع': 'success' };
  const STATUS_TONE = { 'وصل المخزن': 'info', 'جاهز يطلع كامل': 'success', 'بانتظار الفحص': 'orange', 'مستني تصوير': 'gold', 'اتصور': 'brand', 'متاح': 'success', 'محجوز لأوردر': 'orange', 'راجع للمبتكر': 'neutral', 'تالف': 'error' };
  const STATUSES = ['وصل المخزن', 'جاهز يطلع كامل', 'بانتظار الفحص', 'مستني تصوير', 'اتصور', 'متاح', 'محجوز لأوردر', 'راجع للمبتكر', 'تالف'];
  const age = (s) => K.daysBetween(s.since, K.TODAY);
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
  const consRow = (c) => { const p = O.consolidation(c.subs.map((x) => x[2])); const d = K.daysBetween(c.since, K.TODAY); const late = !p.ready && O.consolidationLate(d) && c.subs.some((x) => x[2] === 'قيد التنفيذ');
    return ['IB-' + c.order, c.customer, String(c.subs.length), p.arrived + ' من ' + p.total, p.ready ? 'جاهز يطلع كامل' : late ? 'فيه تأخير' : 'بيتجمع', K.dshort(c.since), ageTxt(d)]; };
  const CONS_H = ['الأوردر', 'العميل', 'فرعيات', 'وصل', 'الحالة', 'من يوم', 'بقاله'];
  const goCons = () => { st.tab = 'consolidate'; try { history.replaceState(null, '', '#inventory-consolidate'); } catch (e) { /* */ } R(); };
  const subRows = (l) => l.map(({ c, x }) => ['#' + x[0], 'IB-' + c.order, x[1], x[3] || '—', x[2], K.dshort(c.since), ageTxt(K.daysBetween(c.since, K.TODAY))]);
  const SUB_H = ['الأوردر الفرعي', 'الأوردر', 'المبتكر', 'المنتج', 'الحالة', 'بدأ التجميع', 'بقاله'];
  const retRows = (l) => l.map((r) => [r.name, r.vendor, '#' + r.sub, r.type, r.reason, r.at, r.status, r.value ? K.money(r.value) : '—']);
  const RET_H = ['المنتج', 'المبتكر', 'الأوردر الفرعي', 'النوع', 'السبب', 'التاريخ', 'الحالة', 'القيمة'];
  const mvRows = (l) => { const lot = (key) => S.stock.find((x) => x.key === key) || {}; return l.map((m) => [m.at.slice(0, 16), m.label, lot(m.key).name || m.name || '—', String(m.qty), m.reason || '—', m.ref || '—', m.by, m.note || '']); };
  const MV_H = ['التاريخ', 'الحركة', 'المنتج', 'الكمية', 'السبب', 'المرجع', 'بواسطة', 'ملاحظة'];

  function view() {
    return [K.PageHead('المخزن', 'مخزن ابتكر المؤقت: تجميع أوردرات · مرتجعات · تصوير · متاح للبيع', [Button({ label: 'جرد جديد', onClick: () => newCount() }), window.IBDataActions ? window.IBDataActions.Menu(window.IBDataActions.PAGES.inventory) : null, Button({ type: 'brand', label: 'استلام في المخزن', icon: 'plus', onClick: () => receive() })]),
      K.MainTabs({ items: TABS, active: st.tab, onChange: (id) => { st.tab = id; try { history.replaceState(null, '', '#inventory-' + id); } catch (e) { /* */ } R(); }, label: 'أقسام المخزن' }),
      h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...(st.tab === 'now' ? nowTab() : st.tab === 'consolidate' ? consTab() : st.tab === 'returns' ? returnsTab() : st.tab === 'moves' ? movesTab() : st.tab === 'count' ? countTab() : settingsTab()))];
  }
  const sel = (id, label, key, opts) => U.Select({ id, label: '', options: [{ value: '', label: label + ': الكل' }].concat(opts.map((o) => ({ value: o, label: label + ': ' + o }))), value: st.f[key], onChange: (v) => { st.f[key] = v; R(); } });
  const search = (ph, key, label) => { const q = h('input', { type: 'search', placeholder: ph, 'aria-label': label, value: st[key] }); q.addEventListener('input', () => { st[key] = q.value; const p = q.selectionStart; R(); const n = document.querySelector('#pg-inventory input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }); return h('label', { class: 'search-field' }, Icon('search', 'sm'), q); };
  // product photo by SKU (window.IB_PRODUCT_IMG, same source as the orders page); no photo → box icon
  const imgOf = (sku) => { const m = window.IB_PRODUCT_IMG || {}; const k = String(sku || '').trim(); return k && m[k] ? 'data:image/jpeg;base64,' + m[k] : null; };
  const skuOfName = (name) => { const x = S.stock.find((s) => s.name === name && imgOf(s.sku)); return x ? x.sku : null; };
  const Thumb = (sku, name, big) => { const src = imgOf(sku) || imgOf(skuOfName(name)); return src ? h('span', { class: 'thumb' }, h('img', { src, alt: name || '', loading: 'lazy' })) : h('span', { class: 'thumb', role: 'img', 'aria-label': 'مفيش صورة' }, Icon('box', big ? undefined : 'sm')); };
  const prodCell = (s) => h('div', { class: 'prod' }, Thumb(s.sku, s.name), h('span', null, h('b', null, s.name), h('small', { dir: 'ltr' }, s.sku)));

  // ---------- المخزن الآن ----------
  function nowTab() {
    const all = K.stockNow().filter((s) => s.onHand > 0 || s.reserved > 0);
    const by = (r) => all.filter((s) => s.reason === r);
    const ready = S.consolidations.filter((c) => O.consolidation(c.subs.map((x) => x[2])).ready).length;
    const retW = by('مرتجع').filter((s) => s.status === 'بانتظار الفحص'); const ph = by('تصوير'); const sale = by('متاح للبيع'); const tl = all.filter(tooLong); const sumQ = (l, k) => l.reduce((x, y) => x + (y[k] || 0), 0);
    const kpis = h('div', { class: 'cards five' },
      K.Stat('بتتجمع', S.consolidations.length, 'أوردرات', ready + ' جاهز يطلع كامل', undefined, () => ({ title: 'أوردرات بتتجمع في المخزن — ' + S.consolidations.length, sub: ready + ' جاهز يطلع كامل · اضغط على أي أوردر يفتح تاب التجميع', summary: [{ label: 'أوردرات', value: String(S.consolidations.length) }, { label: 'جاهز', value: String(ready) }, { label: 'فرعيات', value: String(S.consolidations.reduce((x, c) => x + c.subs.length, 0)) }], headers: CONS_H, rows: S.consolidations.map(consRow), onRow: goCons, source: SRC })),
      K.Stat('مرتجعات', retW.length, 'بانتظار الفحص', 'أقدم واحد من ' + sinceTxt(by('مرتجع').map((s) => s.since).sort()[0] || K.TODAY), undefined, () => ({ title: 'مرتجعات بانتظار الفحص — ' + retW.length, sub: 'المرتجع ما بيزوّدش المتاح غير بعد الفحص · اضغط على أي صف يفتح تفاصيل المنتج', summary: [{ label: 'قطع', value: String(retW.length) }, { label: 'كل المرتجعات في المخزن', value: String(by('مرتجع').length) }], headers: STOCK_H, rows: stockRows(retW), onRow: openLot(retW), source: SRC })),
      K.Stat('تصوير', ph.length, 'منتجات', ph.filter((s) => s.status === 'اتصور').length + ' اتصور ومستني قرار', undefined, () => ({ title: 'منتجات التصوير — ' + ph.length, sub: 'أقصى مدة للتصوير ' + S.invSettings.photoMax + ' يوم', summary: [{ label: 'مستني تصوير', value: String(ph.filter((s) => s.status === 'مستني تصوير').length) }, { label: 'اتصور ومستني قرار', value: String(ph.filter((s) => s.status === 'اتصور').length) }, { label: 'متأخر', value: String(ph.filter(tooLong).length) }], headers: STOCK_H.concat(['الخطوة الجاية']), rows: ph.map((x, i) => stockRows([x])[0].concat([nextStep(x)])), onRow: openLot(ph), source: SRC })),
      K.Stat('متاح للبيع', sumQ(sale, 'onHand'), 'قطعة', sumQ(sale, 'reserved') + ' محجوزة لأوردرات', undefined, () => ({ title: 'متاح للبيع — ' + sumQ(sale, 'onHand') + ' قطعة', sub: 'السحب التلقائي للأوردرات الجديدة بيشتغل على «متاح للبيع» بس', summary: [{ label: 'في المخزن', value: String(sumQ(sale, 'onHand')) }, { label: 'محجوز', value: String(sumQ(sale, 'reserved')) }, { label: 'متاح فعلًا', value: String(sumQ(sale, 'available')) }, { label: 'منتجات', value: String(sale.length) }], headers: ['المنتج', 'SKU', 'المبتكر', 'المكان', 'في المخزن', 'محجوز', 'متاح'], rows: sale.map((x) => [x.name, x.sku, x.vendor, x.loc, String(x.onHand), String(x.reserved || 0), String(x.available != null ? x.available : x.onHand - (x.reserved || 0))]), onRow: openLot(sale), source: SRC })),
      K.Stat('قاعدة أكتر من اللازم', sumQ(tl, 'onHand'), 'قطع', 'تصوير > ' + S.invSettings.photoMax + ' يوم · تجميع > ' + S.invSettings.consolidationAlert + ' أيام', undefined, () => ({ title: 'قطع قاعدة أكتر من اللازم — ' + sumQ(tl, 'onHand'), sub: 'تصوير أكتر من ' + S.invSettings.photoMax + ' يوم · تجميع أكتر من ' + S.invSettings.consolidationAlert + ' أيام', summary: [{ label: 'قطع', value: String(sumQ(tl, 'onHand')) }, { label: 'منتجات', value: String(tl.length) }], headers: STOCK_H.concat(['الخطوة الجاية']), rows: tl.map((x) => stockRows([x])[0].concat([nextStep(x)])), onRow: openLot(tl), note: 'خد قرار: يرجع للمبتكر، يتحوّل للبيع، أو اشحن الموجود.', source: SRC })));
    const f = st.f; const q = st.q.toLowerCase();
    const list = all.filter((s) => (!f.reason || s.reason === f.reason) && (!f.status || s.status === f.status) && (!f.vendor || s.vendor === f.vendor) && (!f.loc || s.loc.startsWith(f.loc)) && (!q || (s.name + s.sku + (s.ref || '')).toLowerCase().includes(q)));
    const rows = list.map((s) => [prodCell(s), s.vendor, K.Tag(REASON_TONE[s.reason], s.reason), K.Tag(STATUS_TONE[s.status] || 'neutral', s.status), s.ref ? h('a', { href: '#orders', class: 'num' }, s.ref) : '—', K.Num(s.loc), h('span', null, K.Num(String(s.onHand))), sinceTxt(s.since), h('span', { class: tooLong(s) ? 'late' : '' }, ageTxt(age(s)), tooLong(s) ? ' ⚠' : ''), h('span', { class: 't-small wrap' }, nextStep(s)), K.RowMenu(actionsFor(s), 'إجراءات ' + s.name)]);
    return [kpis, K.Section('', [h('div', { class: 'toolbar' }, search('ابحث بالمنتج أو الأوردر أو الـ SKU', 'q', 'بحث في المخزن'), sel('f-r', 'السبب', 'reason', O.REASONS), sel('f-s', 'الحالة', 'status', STATUSES), sel('f-v', 'المبتكر', 'vendor', [...new Set(all.map((s) => s.vendor))].sort()), sel('f-l', 'المكان', 'loc', ['T', 'R', 'P', 'A', 'B', 'C', 'D'])),
      list.length ? U.Table({ cls: 'inv-table', headers: ['المنتج', 'المبتكر', 'السبب', 'الحالة', 'المرجع', 'المكان', 'الكمية', 'دخل المخزن', 'بقاله', 'الخطوة الجاية', ''], rows }) : K.Empty('مفيش قطع بالفلتر ده', 'غيّر الفلتر أو البحث، أو سجّل استلام جديد.', Button({ type: 'primary', label: 'استلام في المخزن', onClick: () => receive() })),
      h('p', { class: 't-small help', style: 'margin:0' }, 'كل قطعة في المخزن ليها «سبب» و«حالة» و«خطوة جاية». السبب: تجميع أوردر · مرتجع · تصوير · متاح للبيع. منتجات التصوير ممكن بعد التصوير ترجع للمبتكر أو تتحوّل «متاح للبيع». السحب التلقائي للأوردرات الجديدة بيشتغل على «متاح للبيع» بس. الكمية بتتحسب من الحركات.'),
      h('div', { class: 'legend t-small' }, h('b', null, 'الحالات:'), STATUSES.map((x) => K.Tag(STATUS_TONE[x], x)))])];
  }
  function actionsFor(s) {
    return [{ label: 'تفاصيل المنتج', icon: 'box', run: () => details(s) },
      s.status === 'مستني تصوير' ? { label: 'علّم إنه اتصور', icon: 'check', run: () => setStatus(s, 'اتصور', 'اتصور — مستني قرار') } : null,
      s.status === 'اتصور' ? { label: 'قرار بعد التصوير', icon: 'check', run: () => photoDecision(s) } : null,
      s.status === 'بانتظار الفحص' ? { label: 'فحص مرتجع', icon: 'check', run: () => inspect(s) } : null,
      s.reason === 'تجميع أوردر' ? { label: 'فتح التجميع', icon: 'truck', run: () => { st.tab = 'consolidate'; R(); } } : null,
      { label: 'تسوية كمية', icon: 'sliders', run: () => adjust(s) }].filter(Boolean);
  }
  function setStatus(s, status, msg) { const it = S.stock.find((x) => x.key === s.key); it.status = status; K.logEvent('stock.status', s.name + ' → ' + status); K.toast(msg || 'اتغيرت الحالة', 'success'); rerender(); }
  const move = (m) => S.ledger.unshift(Object.assign({ at: K.TODAY + ' ' + K.clockNow(), by: K.member(K.ME).name, note: '' }, m));

  // ---------- تجميع أوردرات ----------
  function consTab() {
    const subsAll = S.consolidations.flatMap((c) => c.subs.map((x) => ({ c, x })));
    const ready = S.consolidations.filter((c) => O.consolidation(c.subs.map((x) => x[2])).ready);
    const lateSubs = subsAll.filter(({ c, x }) => x[2] !== 'وصل المخزن' && O.consolidationLate(K.daysBetween(c.since, K.TODAY)));
    const onWay = subsAll.filter(({ x }) => x[2] === 'تم الشحن للمخزن');
    const kpis = h('div', { class: 'cards' },
      K.Stat('أوردرات بتتجمع', S.consolidations.length, 'أوردر', subsAll.length + ' أوردرات فرعية', undefined, () => ({ title: 'أوردرات بتتجمع — ' + S.consolidations.length, sub: subsAll.length + ' أوردر فرعي', summary: [{ label: 'أوردرات', value: String(S.consolidations.length) }, { label: 'فرعيات', value: String(subsAll.length) }, { label: 'وصلت المخزن', value: String(subsAll.filter(({ x }) => x[2] === 'وصل المخزن').length) }], headers: CONS_H, rows: S.consolidations.map(consRow), note: 'تفاصيل كل أوردر فرعي في الكروت تحت.', source: SRC })),
      K.Stat('جاهزة تطلع كاملة', ready.length, 'أوردر', ready.map((c) => 'IB-' + c.order).join('، ') || '—', undefined, () => ({ title: 'أوردرات جاهزة تطلع كاملة — ' + ready.length, sub: 'كل الفرعيات وصلت المخزن — اشحنها في شحنة واحدة', summary: [{ label: 'أوردرات', value: String(ready.length) }], headers: CONS_H, rows: ready.map(consRow), source: SRC })),
      K.Stat('في الطريق للمخزن', onWay.length, 'أوردر فرعي', 'اتشحنت من المبتكر', undefined, () => ({ title: 'فرعيات في الطريق للمخزن — ' + onWay.length, sub: 'اتشحنت من المبتكر ومتوقعة النهارده', headers: SUB_H, rows: subRows(onWay), source: SRC })),
      K.Stat('متأخر عن التجميع', lateSubs.length, 'أوردر فرعي', 'لسه عند المبتكر', undefined, () => ({ title: 'فرعيات متأخرة عن التجميع — ' + lateSubs.length, sub: 'التجميع أكتر من ' + S.invSettings.consolidationAlert + ' أيام والفرعي لسه عند المبتكر', summary: [{ label: 'فرعيات', value: String(lateSubs.length) }, { label: 'مبتكرين', value: String(new Set(lateSubs.map(({ x }) => x[1])).size) }], headers: SUB_H, rows: subRows(lateSubs), note: 'تقدر تشحن الموجود والباقي يتشحن لوحده، أو تلغي التجميع.', source: SRC })));
    if (!S.consolidations.length) return [kpis, K.Section('', K.Empty('مفيش أوردرات بتتجمع', 'من صفحة الأوردرات: ⋮ › تجميع في المخزن.'))];
    return [kpis, ...S.consolidations.map((c) => { const p = O.consolidation(c.subs.map((x) => x[2])); const d = K.daysBetween(c.since, K.TODAY); const late = !p.ready && O.consolidationLate(d) && c.subs.some((x) => x[2] === 'قيد التنفيذ');
        const vendors = new Set(c.subs.map((x) => x[1])).size;
        return h('section', { class: 'card cons' + (late ? ' is-late' : '') },
          h('div', { class: 'cons-h' }, h('div', null, h('a', { href: '#orders', class: 'oid', onClick: (e) => { e.preventDefault(); location.hash = 'orders'; setTimeout(() => window.OrdersApp && window.OrdersApp.setQuery(String(c.order)), 50); } }, 'IB-' + c.order), h('span', { class: 't-label' }, ' · ' + c.customer), h('div', { class: 't-small help' }, vendors + ' مبتكرين · ' + (p.ready ? 'جاهز' : late ? 'فيه تأخير' : 'قرار التجميع: ' + (c.by || '—') + ' ' + K.dshort(c.since)))),
            h('div', { class: 'acts-inline' }, p.ready ? K.Tag('success', p.arrived + ' من ' + p.total + ' وصلوا — جاهز يطلع كامل', 'check') : K.Tag(late ? 'error' : 'info', p.arrived + ' من ' + p.total + (late ? ' — أوردر فرعي متأخر' : ' وصلوا')),
              late && !p.arrived ? Button({ size: 'sm', label: 'إلغاء التجميع', onClick: () => cancelCons(c) }) : Button({ type: 'primary', size: 'sm', label: 'شحن كامل', disabled: !p.ready, onClick: () => shipAll(c) }), !p.ready && p.arrived && S.invSettings.partial ? Button({ size: 'sm', label: 'اشحن الموجود والباقي بعدين', onClick: () => shipPartial(c, p) }) : null,
              K.RowMenu([{ label: 'إلغاء التجميع', icon: 'close', danger: true, run: () => cancelCons(c) }]))),
          U.ProgressBar(p.ready ? 'brand' : late ? 'neutral' : 'gold', p.arrived / p.total),
          U.Table({ cls: 'mini-table', headers: ['الأوردر الفرعي', 'المنتج', 'المبتكر', 'الحالة', 'وصل / متوقع', 'المكان', ''], rows: c.subs.map((x) => { const lot = S.stock.find((s) => s.reason === 'تجميع أوردر' && String(s.sub) === String(x[0]));
            const o = window.OrdersApp && window.OrdersApp.get ? window.OrdersApp.get(String(c.order)) : null; const so = o && o.subs ? o.subs.find((q) => String(q.sid) === String(x[0])) : null; const pn = lot ? lot.name : (so ? so.prod : (x[3] || '—'));
            return [K.Num('#' + x[0]), h('span', { class: 'prod' }, Thumb(lot ? lot.sku : so && so.sku, pn), h('span', null, pn)), x[1], K.Tag(x[2] === 'وصل المخزن' ? 'success' : x[2] === 'تم الشحن للمخزن' ? 'info' : 'neutral', x[2]), x[2] === 'وصل المخزن' ? 'وصل ' + (lot ? K.dshort(lot.since) : '') : x[2] === 'تم الشحن للمخزن' ? 'متوقع النهارده' : 'متوقع ' + K.dshort(O.addDays(K.TODAY, 3)), x[2] === 'وصل المخزن' ? K.Num(c.zone) : '—',
              x[2] !== 'وصل المخزن' ? Button({ type: 'text', size: 'sm', label: 'علّم وصل', onClick: () => markArrived(c, x) }) : '']; }) })); }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الفريق بيقرر التجميع لكل أوردر من صفحة الأوردرات (⋮ › تجميع في المخزن). الأوردرات الفرعية اللي في التجميع بتتشحن من المبتكر للمخزن («اتشحن للمخزن» ← «وصل المخزن»). لما الكل يوصل الأوردر بيبقى «جاهز يطلع كامل». لو حد اتأخر، تقدر تشحن الموجود والباقي يتشحن لوحده بعدين.')];
  }
  function markArrived(c, x) {
    const o = window.OrdersApp && window.OrdersApp.get ? window.OrdersApp.get(String(c.order)) : null; const sub = o && o.subs ? o.subs.find((s) => String(s.sid) === String(x[0])) : null;
    x[2] = 'وصل المخزن'; const key = 'L-' + c.order + '-' + x[0] + '-' + Date.now();
    S.stock.unshift({ key, sku: sub ? sub.sku : 'SUB-' + x[0], name: sub ? sub.prod : 'فرعي #' + x[0], vendor: x[1], reason: 'تجميع أوردر', status: 'وصل المخزن', ref: 'IB-' + c.order, sub: x[0], order: c.order, since: K.TODAY, loc: c.zone, cost: sub ? sub.tot : 0 });
    move({ key, type: 'in', qty: sub ? sub.qty || 1 : 1, label: 'دخول — تجميع', reason: 'تجميع أوردر', ref: 'IB-' + c.order + ' · #' + x[0], note: 'وصل من ' + x[1] });
    if (O.consolidation(c.subs.map((y) => y[2])).ready) S.stock.forEach((s) => { if (String(s.order) === String(c.order) && s.reason === 'تجميع أوردر') s.status = 'جاهز يطلع كامل'; });
    window.OrdersSetSub && window.OrdersSetSub(x[0], 'وصل المخزن'); K.logEvent('stock.consolidation.arrive', '#' + x[0]); rerender();
  }
  function shipAll(c) {
    K.form({ title: 'شحن كامل من المخزن — IB-' + c.order, values: { carrier: 'Bosta' }, note: U.InlineNote({ kind: 'success', children: 'كل الفرعيات (' + c.subs.length + ') وصلت. هيطلع الأوردر في شحنة واحدة للعميل ' + c.customer + '.' }),
      fields: (f, e, set) => [K.field.select('carrier', 'شركة الشحن', ['Bosta', 'Aramex', 'مندوب ابتكر'], f, e, set, { required: true }), K.field.text('awb', 'رقم البوليصة', f, e, set, { required: true })],
      validate: (f) => K.req(f, ['carrier', 'awb']), submitLabel: 'شحن', submit: (f) => { const lots = K.stockNow().filter((s) => String(s.order) === String(c.order) && s.reason === 'تجميع أوردر');
        lots.forEach((s) => move({ key: s.key, type: 'out', qty: s.onHand, label: 'خروج — شحن مجمّع', reason: 'تجميع', ref: 'IB-' + c.order, note: 'شحنة واحدة ' + f.carrier + ' ' + f.awb }));
        S.consolidations = S.consolidations.filter((x) => x !== c); c.subs.forEach((x) => window.OrdersSetSub && window.OrdersSetSub(x[0], 'تم الشحن للعميل')); K.logEvent('stock.consolidation.ship', c.order); K.toast('اتشحن IB-' + c.order + ' كامل', 'success'); rerender(); } });
  }
  function shipPartial(c, p) {
    K.confirm({ title: 'اشحن الموجود والباقي بعدين', text: 'هيطلع ' + p.arrived + ' من ' + p.total + ' دلوقتي والباقي هيتشحن لوحده من المبتكر للعميل لما يخلص.', okLabel: 'اشحن الموجود', onOk: () => {
      K.stockNow().filter((s) => String(s.order) === String(c.order) && s.reason === 'تجميع أوردر').forEach((s) => move({ key: s.key, type: 'out', qty: s.onHand, label: 'خروج — شحن جزئي', reason: 'تجميع', ref: 'IB-' + c.order }));
      c.subs.filter((x) => x[2] === 'وصل المخزن').forEach((x) => window.OrdersSetSub && window.OrdersSetSub(x[0], 'تم الشحن للعميل')); S.consolidations = S.consolidations.filter((x) => x !== c); K.logEvent('stock.consolidation.partial', c.order); K.toast('اتشحن الموجود من IB-' + c.order); rerender(); } });
  }
  function cancelCons(c) { K.confirm({ title: 'إلغاء التجميع', text: 'كل أوردر فرعي هيتشحن لوحده من المبتكر للعميل. القطع اللي وصلت المخزن هتطلع لوحدها.', okType: 'danger', okLabel: 'إلغاء التجميع', onOk: () => { S.consolidations = S.consolidations.filter((x) => x !== c); K.logEvent('stock.consolidation.cancel', c.order); K.toast('اتلغى التجميع'); rerender(); } }); }

  // ---------- المرتجعات ----------
  function returnsTab() {
    const rs = S.returns; const inStock = rs.filter((r) => r.type === 'مرتجع للمخزن'); const toVendor = rs.filter((r) => r.type === 'مرتجع للمورد');
    const damaged = rs.filter((r) => r.status === 'اتفحص — تالف').reduce((s, r) => s + (r.value || 0), 0);
    const tone = (s) => (s === 'بانتظار الفحص' ? 'orange' : s.includes('تالف') ? 'error' : s.includes('سليم') ? 'success' : 'neutral');
    const waitR = rs.filter((r) => r.status === 'بانتظار الفحص'); const dmg = rs.filter((r) => r.status === 'اتفحص — تالف');
    return [h('div', { class: 'cards' },
      K.Stat('بانتظار الفحص', waitR.length, 'قطعة', 'أقدم واحدة من أمس', undefined, () => ({ title: 'مرتجعات بانتظار الفحص — ' + waitR.length, sub: 'سليم = يرجع متاح · تالف = حركة تالف', headers: RET_H, rows: retRows(waitR), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('رجعت للمخزن (أكتوبر)', inStock.length, 'قطعة', inStock.filter((r) => r.status.includes('سليم') || r.status === 'بانتظار الفحص').length + ' سليمة · ' + inStock.filter((r) => r.status.includes('تالف')).length + ' تالفة', undefined, () => ({ title: 'مرتجعات رجعت للمخزن (أكتوبر) — ' + inStock.length, summary: [{ label: 'سليمة / بانتظار الفحص', value: String(inStock.filter((r) => r.status.includes('سليم') || r.status === 'بانتظار الفحص').length) }, { label: 'تالفة', value: String(inStock.filter((r) => r.status.includes('تالف')).length) }], headers: RET_H, rows: retRows(inStock), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('رجعت للمورد (أكتوبر)', toVendor.length, 'قطعة', 'نصيب المبتكر اتلغى', undefined, () => ({ title: 'مرتجعات رجعت للمورد (أكتوبر) — ' + toVendor.length, sub: 'نصيب المبتكر اتلغى من الأوردر', headers: RET_H, rows: retRows(toVendor), source: 'المرتجعات من الأوردرات الفرعية' })),
      K.Stat('قيمة التالف (أكتوبر)', K.money(damaged), 'ج.م', 'على ابتكر', undefined, () => ({ title: 'قيمة التالف (أكتوبر) — ' + K.money(damaged) + ' ج.م', sub: 'القطع اللي اتفحصت واتعلّمت تالفة — التكلفة على ابتكر', summary: [{ label: 'الإجمالي', value: K.money(damaged) + ' ج.م' }, { label: 'قطع', value: String(dmg.length) }], headers: RET_H, rows: retRows(dmg), source: 'المرتجعات من الأوردرات الفرعية' }))),
      K.Section('', U.Table({ headers: ['المنتج', 'الأوردر الفرعي', 'نوع المرتجع', 'السبب', 'التاريخ', 'الحالة', 'الأثر', 'الإجراء'], rows: rs.map((r) => [h('span', { class: 'prod' }, Thumb(r.sku, r.name), h('span', null, h('b', null, r.name), h('small', null, r.vendor + ' · ' + r.mode))), K.Num(r.sub), K.Tag(r.type === 'مرتجع للمخزن' ? 'orange' : 'error', r.type), r.reason, r.at, K.Tag(tone(r.status), r.status), r.effect,
        r.status === 'بانتظار الفحص' ? Button({ type: 'primary', size: 'sm', label: 'فحص', onClick: () => { const s = K.stockNow().find((x) => x.key === r.key); if (s) inspect(s, r); } }) : Button({ type: 'text', size: 'sm', label: 'عرض', onClick: () => U.Modal({ title: r.name + ' — ' + r.sub, share: true, body: [K.Kv([['المبتكر', r.vendor + ' · ' + r.mode], r.condition ? ['حالة المنتج عند الاستلام', (O.RETURN_CONDITIONS.find((c) => c.value === r.condition) || {}).label + (r.conditionNote ? ' — ' + r.conditionNote : '')] : null, ['النوع', r.type], ['السبب', r.reason], ['التاريخ', r.at], ['الحالة', r.status], ['الأثر', r.effect]])] }) })]) })),
      h('p', { class: 't-small help', style: 'margin:0' }, 'المرتجعات بتتعمل من الأوردرات › الأوردر الفرعي بتغيير الحالة لـ «مرتجع للمخزن» أو «مرتجع للمورد». المرتجع للمخزن مش بيزوّد المتاح غير بعد الفحص: سليم = + متاح · تالف = حركة تالف · ممكن يتحوّل «إرجاع للمورد».')];
  }
  // ---------- حركات المخزن ----------
  function movesTab() {
    const month = S.ledger.filter((m) => m.at.startsWith('2026-10')); const lot = (key) => S.stock.find((s) => s.key === key) || {};
    const ins = month.filter((m) => m.type === 'in'), outs = month.filter((m) => m.type === 'out' || m.type === 'ship'); const sum = (a) => a.reduce((s, m) => s + m.qty, 0);
    const byR = (a, r) => sum(a.filter((m) => m.reason === r)); const reserved = K.stockNow().reduce((s, x) => s + x.reserved, 0); const manual = month.filter((m) => m.type === 'adjust' || m.type === 'move').length;
    const sign = (m) => (m.type === 'in' ? '+ ' : m.type === 'out' || m.type === 'ship' ? '− ' : m.type === 'reserve' ? '− ' : m.type === 'adjust' ? (m.qty >= 0 ? '+ ' : '− ') : '');
    const q = st.mq.toLowerCase(); const list = S.ledger.filter((m) => (!st.mtype || m.label.startsWith(st.mtype)) && (!q || ((lot(m.key).name || m.name || '') + m.ref).toLowerCase().includes(q)));
    const resL = K.stockNow().filter((x) => x.reserved > 0); const manL = month.filter((m) => m.type === 'adjust' || m.type === 'move');
    return [h('div', { class: 'cards' },
      K.Stat('داخل الشهر', '+ ' + sum(ins), 'قطعة', 'تجميع ' + byR(ins, 'تجميع أوردر') + ' · مرتجعات ' + byR(ins, 'مرتجع') + ' · تصوير ' + byR(ins, 'تصوير') + ' · للبيع ' + byR(ins, 'متاح للبيع'), undefined, () => ({ title: 'حركات الدخول (أكتوبر) — ' + sum(ins) + ' قطعة', summary: [{ label: 'تجميع', value: String(byR(ins, 'تجميع أوردر')) }, { label: 'مرتجعات', value: String(byR(ins, 'مرتجع')) }, { label: 'تصوير', value: String(byR(ins, 'تصوير')) }, { label: 'للبيع', value: String(byR(ins, 'متاح للبيع')) }], headers: MV_H, rows: mvRows(ins), source: 'سجل حركات المخزن' })),
      K.Stat('خارج الشهر', '− ' + sum(outs), 'قطعة', outs.map((m) => m.label.replace('خروج — ', '')).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || '—', undefined, () => ({ title: 'حركات الخروج (أكتوبر) — ' + sum(outs) + ' قطعة', summary: [{ label: 'قطع', value: String(sum(outs)) }, { label: 'حركات', value: String(outs.length) }], headers: MV_H, rows: mvRows(outs), source: 'سجل حركات المخزن' })),
      K.Stat('حجوزات مفتوحة', reserved, 'قطعة', 'لأوردرات لسه متشحنتش', undefined, () => ({ title: 'حجوزات مفتوحة — ' + reserved + ' قطعة', sub: 'قطع محجوزة لأوردرات لسه متشحنتش', headers: ['المنتج', 'SKU', 'المبتكر', 'المرجع', 'محجوز', 'في المخزن', 'المكان'], rows: resL.map((x) => [x.name, x.sku, x.vendor, x.ref || '—', String(x.reserved), String(x.onHand), x.loc]), onRow: openLot(resL), source: 'سجل حركات المخزن' })),
      K.Stat('حركات يدوية', manual, 'حركة', 'تسويات + نقل أماكن', undefined, () => ({ title: 'حركات يدوية (أكتوبر) — ' + manual, sub: 'تسويات ونقل أماكن عملها الفريق بسبب', headers: MV_H, rows: mvRows(manL), source: 'سجل حركات المخزن' }))),
      K.Section('', [h('div', { class: 'toolbar' }, (() => { const i = h('input', { type: 'search', placeholder: 'ابحث بالمنتج أو رقم الأوردر', 'aria-label': 'بحث في الحركات', value: st.mq }); i.addEventListener('input', () => { st.mq = i.value; const p = i.selectionStart; R(); const n = document.querySelector('#pg-inventory input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }); return h('label', { class: 'search-field' }, Icon('search', 'sm'), i); })(), U.Select({ id: 'mv-t', label: '', options: [{ value: '', label: 'نوع الحركة: الكل' }].concat(['دخول', 'خروج', 'حجز', 'تالف', 'رجوع للمبتكر', 'تحويل للبيع', 'تسوية'].map((x) => ({ value: x, label: 'نوع الحركة: ' + x }))), value: st.mtype, onChange: (v) => { st.mtype = v; R(); } }), U.Select({ id: 'mv-p', label: '', options: [{ value: '10', label: 'الفترة: أكتوبر 2026' }], value: '10', onChange: () => {} })),
        U.Table({ headers: ['التاريخ', 'الحركة', 'المنتج', 'الكمية', 'السبب', 'المرجع', 'بواسطة', 'ملاحظة'], rows: list.map((m) => { const l = lot(m.key); const d = m.at.slice(0, 10);
          return [h('span', null, d === K.TODAY ? 'اليوم' : d === O.addDays(K.TODAY, -1) ? 'أمس' : K.dshort(d), ' ', K.Num(m.at.slice(11, 16))), K.Tag(m.type === 'in' ? 'success' : m.type === 'reserve' ? 'orange' : m.label === 'تالف' ? 'error' : m.type === 'move' ? 'brand' : 'neutral', m.label), h('span', { class: 'prod' }, h('span', null, h('b', null, l.name || m.name || '—'), h('small', { dir: 'ltr' }, l.sku || m.sku || ''))), K.Num(sign(m) + m.qty + (m.type === 'reserve' ? ' متاح' : '')), m.reason, K.Num(m.ref), m.by, h('span', { class: 't-small' }, m.note)]; }) }),
        h('p', { class: 't-small help', style: 'margin:0' }, 'الحجز والشحن وفك الحجز بيعملهم السيستم لوحده من الأوردرات. الاستلام والتسوية والتالف والإرجاع للمورد بيعملهم الفريق بسبب. أي غلطة بتتصلح بحركة عكسية — مفيش مسح.')])];
  }
  // ---------- الجرد ----------
  function countTab() {
    const c = S.count;
    if (!c) return [K.Section('الجرد', K.Empty('مفيش جرد شغال', 'ابدأ جرد جديد لرف أو للمخزن كله.', Button({ type: 'primary', label: 'جرد جديد', onClick: () => newCount() }))), history()];
    const diffs = c.lines.filter((l) => l.counted !== '' && Number(l.counted) !== l.system);
    const done = (c.base || 0) + c.lines.filter((l) => l.counted !== '').length;
    return [K.Section(c.id + ' — ' + c.zone, [h('div', { class: 'count-prog' }, h('b', null, 'التقدّم'), h('span', null, done + ' من ' + c.total + ' منتج اتعدّوا · ' + diffs.length + ' فروق لحد دلوقتي'), U.ProgressBar('brand', done / c.total)),
      h('div', { class: 'toolbar' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الـ SKU', 'aria-label': 'بحث في الجرد' })), U.Select({ id: 'cn-l', label: '', options: [{ value: 'B', label: 'المكان: رف B' }], value: 'B', onChange: () => {} }), U.Select({ id: 'cn-v', label: '', options: [{ value: '', label: 'العرض: الكل' }], value: '', onChange: () => {} }), h('span', { class: 't-small help' }, 'العدّ بيتحفظ تلقائي')),
      U.Table({ headers: ['المنتج', 'المكان', 'في السيستم', 'العدد الفعلي', 'الفرق', 'القيمة', 'ملاحظة'], rows: c.lines.map((l) => { const inp = h('input', { class: 'cnt-in', inputmode: 'numeric', value: l.counted, 'aria-label': 'العدد الفعلي — ' + l.name }); inp.addEventListener('change', () => { l.counted = O.toLatin(inp.value); K.toast('اتحفظ العدّ'); R(); });
        const d = l.counted === '' ? null : Number(l.counted) - l.system;
        return [prodCell(l), K.Num(l.loc), String(l.system), inp, d == null ? K.Tag('neutral', 'لسه') : d === 0 ? K.Tag('success', 'مطابق') : h('b', { class: d < 0 ? 'neg' : 'pos' }, K.Num((d > 0 ? '+ ' : '− ') + Math.abs(d))), d ? K.Num((d > 0 ? '+ ' : '− ') + K.money(Math.abs(d) * l.cost)) : '—', l.note || '—']; }) }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'أثناء الجرد «في السيستم» بيتثبت على لحظة بداية الجرد، والحجوزات الجديدة بتتحسب لوحدها. «اعتماد الجرد» بيعمل حركة «تسوية جرد» لكل فرق بالسبب. المنتجات اللي متعدتش بتفضل زي ما هي.')],
      [Button({ type: 'primary', label: 'اعتماد الجرد', onClick: () => approveCount() })], { sub: 'بدأ ' + c.started.slice(11) + ' النهارده' }), history()];
  }
  const history = () => K.Section('جرد سابق', U.Table({ cls: 'mini-table', headers: ['رقم الجرد', 'التاريخ', 'النطاق', 'بواسطة', 'أصناف فيها فرق', 'صافي الفرق', 'الحالة'], rows: S.counts.map((c) => [K.Num(c.id), K.dshort(c.date), c.zone, c.by, String(c.items), K.Num(K.money(c.value) + ' ج'), K.Tag('success', c.status)]) }));
  // ---------- إعدادات ----------
  function settingsTab() {
    const c = S.invSettings; const save = (k, v) => { c[k] = v; K.logEvent('stock.settings', k + ' = ' + v); K.toast('اتحفظ'); R(); };
    const sw = (k, t, d) => K.Switch({ id: 'is-' + k, label: t, help: d, checked: c[k], onChange: (v) => save(k, v) });
    const pick = (k, label, help, opts) => h('div', null, U.Select({ id: 'is-' + k, label, options: opts.map((x) => ({ value: String(x), label: String(x) })), value: String(c[k]), onChange: (v) => save(k, isNaN(v) ? v : Number(v)) }), help ? h('div', { class: 't-small help' }, help) : null);
    return [K.Section('السحب التلقائي من المخزون', [sw('firstWarehouse', 'المخزن الأول', 'لو المنتج «متاح للبيع» في المخزن، الأوردر الفرعي بيتنفذ من «مخزن ابتكر» — القطع اللي في تجميع أو تصوير أو مرتجع مش بتتسحب'), K.two(pick('reserveAt', 'وقت الحجز', 'القطعة بتتحجز (متاح ← محجوز) عند', ['إنشاء الأوردر', 'تأكيد الأوردر']), pick('deductAt', 'وقت الخصم', 'القطعة بتتخصم من الإجمالي عند', ['شحن الأوردر الفرعي', 'تأكيد الأوردر'])), sw('autoRelease', 'فك الحجز تلقائي', 'لو الأوردر اتلغى أو الأوردر الفرعي اتحوّل لمبتكر'), sw('pullAlert', 'تنبيه السحب', '«اتحجزت قطعة من المخزن» للأدمن ومسؤول الأوردرات')], null, { sub: 'لما يجي أوردر فيه منتج موجود في المخزن' }),
      K.Section('التجميع', [pick('zone', 'منطقة التجميع الافتراضية', 'الأوردرات الفرعية اللي بتوصل للتجميع بتتحط في', ['T — منطقة التجميع']), pick('consolidationAlert', 'تنبيه تأخير التجميع (أيام من قرار التجميع)', 'لو أوردر فرعي في التجميع موصلش المخزن بعد', [3, 5, 7]), sw('partial', 'السماح بالشحن الجزئي', '«اشحن الموجود والباقي بعدين»')], null, { sub: 'الفريق بيقرر التجميع لكل أوردر من صفحة الأوردرات' }),
      K.Section('التصوير', [pick('photoMax', 'أقصى مدة في المخزن (يوم)', 'بعدها تنبيه «قاعدة أكتر من اللازم»', [7, 14, 21]), pick('photoDefault', 'القرار الافتراضي بعد التصوير', 'بيتعرض كاختيار أول في بوب أب «بعد التصوير»', ['يرجع للمبتكر', 'متاح للبيع — أمانة'])], null, { sub: 'منتجات بيبعتها المبتكر للتصوير (خدمة الميديا)' }),
      K.Section('المستويات والتنبيهات', [K.two(pick('minQty', 'الحد الأدنى الافتراضي (قطعة)', 'بيتغيّر لكل منتج من تفاصيله', [1, 2, 3, 5]), pick('stale', 'مدة الركود (يوم)', 'منتج من غير بيع المدة دي بيتعلّم «راكد»', [60, 90, 120])), sw('lowAlert', 'تنبيه «قرب يخلص»', 'لما المتاح يوصل للحد الأدنى')]),
      K.Section('المرتجعات', [sw('inspect', 'فحص إلزامي للمرتجع', 'المرتجع للمخزن مش بيزوّد المتاح غير بعد «فحص»'), K.two(pick('returnOwner', 'ملكية المرتجع للمخزن', 'القطعة اللي بترجع من عميل بتتسجل', ['بنفس ملكية الأوردر الأصلي', 'ملك ابتكر']), pick('vendorReturn', 'أثر المرتجع للمورد على حساب المورد', 'نصيب المورد من الأوردر الفرعي', ['يتلغي (من غير خصم إضافي)', 'يتلغي + خصم مصاريف الشحن']))]),
      K.Section('الربط مع الموقع (WooCommerce)', [sw('wooSync', 'تحديث كمية الموقع', 'كمية المنتج على ibtekr.club = «متاح» في المخزن'), h('div', { class: 'set-row' }, h('div', null, h('b', null, 'المنتجات حسب الطلب'), h('div', { class: 't-small help' }, 'الكمية -1 في الداتا القديمة = حسب الطلب عند المبتكر ومش بتدخل المخزن')), K.Tag('neutral', c.onDemand))]),
      K.Section('أماكن التخزين', [U.Table({ headers: ['المكان', 'الوصف', 'منتجات', 'قطع'], rows: S.racks.map((r) => [h('b', null, r.code), r.desc, String(r.products), String(r.pieces)]) }), h('p', { class: 't-small help', style: 'margin:0' }, 'الأكواد: T-xx تجميع · R-xx مرتجعات · P-xx تصوير · A–D رفوف «متاح للبيع».')], [Button({ label: '+ مكان', onClick: () => addRack() })])];
  }

  // ---------- popups ----------
  const REASON_HINT = () => ({ 'تجميع أوردر': 'بيتجمع مع باقي الأوردر ← «وصل المخزن»', 'مرتجع': '«بانتظار الفحص» — مش بيزوّد المتاح غير بعد الفحص', 'تصوير': '«مستني تصوير» — أقصى ' + S.invSettings.photoMax + ' يوم', 'متاح للبيع': '«متاح» — يتسحب تلقائي لأي أوردر' });
  // «وصل المخزن» chosen on a sub-order in the orders page (owner 22 Oct): the storage reason comes from the warehouse reasons
  function arrival(info, ok) {
    const hints = REASON_HINT();
    K.form({ title: 'وصل المخزن — فرعي #' + info.sid, wide: true, values: { reason: O.arrivalReason(info.inConsolidation), loc: '', mode: 'أمانة', date: K.TODAY },
      note: h('div', { class: 'prod arrival-prod' }, Thumb(info.sku, info.prod), h('span', null, h('b', null, info.prod + ' × ' + (info.qty || 1)), h('small', { dir: 'ltr' }, (info.sku || '—')), h('small', null, info.vendor + ' · IB-' + info.order + ' · ' + K.money(info.tot || 0) + ' ج.م'))),
      fields: (f, e, set) => [
        K.Radios({ label: 'سبب التخزين *', value: f.reason, onChange: (v) => set('reason', v, true), options: O.REASONS.map((r) => ({ value: r, label: r, hint: hints[r] })) }), e.reason ? h('div', { class: 'err-msg', role: 'alert' }, e.reason) : null,
        info.inConsolidation && f.reason && f.reason !== 'تجميع أوردر' ? U.InlineNote({ kind: 'warning', children: 'الأوردر ده بيتجمع في المخزن — لو السبب مش «تجميع أوردر» القطعة مش هتتحسب في التجميع.' }) : null,
        f.reason === 'مرتجع' ? K.Radios({ label: 'حالة المنتج *', value: f.condition, onChange: (v) => set('condition', v, true), options: O.RETURN_CONDITIONS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) }) : null,
        f.reason === 'مرتجع' && e.condition ? h('div', { class: 'err-msg', role: 'alert' }, e.condition) : null,
        f.reason === 'مرتجع' && f.condition ? K.field.area('conditionNote', 'وصف الحالة', f, e, set, { required: ['عيب بسيط', 'ناقص', 'تالف'].includes(f.condition), placeholder: f.condition === 'ناقص' ? 'إيه اللي ناقص؟' : f.condition === 'سليم' ? 'اختياري' : 'وصف العيب أو التلف' }) : null,
        f.reason === 'مرتجع' && (f.condition === 'تالف' || f.condition === 'عيب بسيط') ? K.field.file('conditionPhoto', 'صورة الحالة', f, e, set) : null,
        f.reason === 'متاح للبيع' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة (فلوس المبتكر بعد البيع)' }, { value: 'ملك', label: 'ملك ابتكر' }] }) : null,
        K.two(K.field.text('loc', 'المكان', f, e, set, { placeholder: f.reason ? O.arrivalStock({ reason: f.reason, order: info.order, sid: info.sid }).zone + '-01' : 'T-01' }), K.field.date('date', 'تاريخ الوصول', f, e, set, { required: true })),
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري' })],
      validate: (f) => { const e = O.validateReceive({ sku: info.sku || 'SUB-' + info.sid, qty: info.qty || 1, reason: f.reason, condition: f.condition, conditionNote: f.conditionNote }); if (e.reason) e.reason = 'اختار سبب التخزين'; if (!f.date) e.date = 'اختار التاريخ'; return e; },
      submitLabel: 'تأكيد', cancelLabel: 'ليس الآن', submit: (f) => {
        const a = O.arrivalStock({ reason: f.reason, order: info.order, sid: info.sid }); const key = 'L-' + info.order + '-' + info.sid + '-' + Date.now(); const qty = info.qty || 1;
        S.stock.unshift({ key, sku: info.sku || 'SUB-' + info.sid, name: info.prod, vendor: info.vendor, reason: f.reason, status: a.status, ref: a.ref, order: f.reason === 'تجميع أوردر' ? info.order : null, sub: info.sid, since: f.date, loc: f.loc || a.zone + '-01', cost: 0, mode: f.reason === 'متاح للبيع' ? f.mode : undefined, condition: f.reason === 'مرتجع' ? f.condition : undefined, conditionNote: f.reason === 'مرتجع' ? (f.conditionNote || '') : undefined });
        move({ key, type: 'in', qty, label: a.label, reason: f.reason, ref: a.ref + ' · #' + info.sid, note: 'من الأوردرات — ' + info.vendor + (f.note ? ' · ' + f.note : '') });
        if (f.reason === 'مرتجع') S.returns.unshift({ name: info.prod, vendor: info.vendor, mode: 'أمانة', sub: '#' + info.sid, sku: info.sku, type: 'مرتجع للمخزن', reason: 'وصل المخزن من الأوردرات · ' + (O.RETURN_CONDITIONS.find((c) => c.value === f.condition) || {}).label, condition: f.condition, conditionNote: f.conditionNote || '', at: K.dshort(f.date), status: 'بانتظار الفحص', effect: '+ ' + qty + ' بعد الفحص', key });
        K.logEvent('stock.arrival', '#' + info.sid + ' · ' + f.reason); K.toast('اتسجل وصول #' + info.sid + ' للمخزن — ' + f.reason, 'success');
        ok({ reason: f.reason, date: f.date, loc: f.loc || a.zone + '-01', condition: f.condition || '' }); rerender(); } });
  }
  function receive() {
    K.form({ title: 'استلام في المخزن', wide: true, values: { qty: '1', loc: '', mode: 'أمانة' }, note: U.InlineNote({ children: 'السبب مطلوب — هو اللي بيحدد الحالة والخطوة الجاية.' }),
      fields: (f, e, set) => [K.two(K.field.text('name', 'المنتج', f, e, set, { required: true }), K.field.text('sku', 'SKU', f, e, set, { required: true })), K.two(K.field.select('vendor', 'المبتكر', ['Antikiano', 'zaan', 'W&R', 'HANDS', 'Rufaida', 'Ibtekr'], f, e, set, { required: true }), K.field.text('qty', 'الكمية', f, e, set, { required: true, inputmode: 'numeric' })),
        K.Radios({ label: 'سبب الاستلام *', value: f.reason, onChange: (v) => set('reason', v, true), options: O.REASONS.map((r) => ({ value: r, label: r, hint: REASON_HINT()[r] })) }), e.reason ? h('div', { class: 'err-msg', role: 'alert' }, e.reason) : null,
        f.reason === 'تجميع أوردر' || f.reason === 'مرتجع' ? K.field.text('order', f.reason === 'مرتجع' ? 'الأوردر الفرعي' : 'رقم الأوردر', f, e, set, { required: true, placeholder: f.reason === 'مرتجع' ? '180549' : '180662' }) : null,
        f.reason === 'مرتجع' ? K.Radios({ label: 'حالة المنتج *', value: f.condition, onChange: (v) => set('condition', v, true), options: O.RETURN_CONDITIONS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })) }) : null,
        f.reason === 'مرتجع' && e.condition ? h('div', { class: 'err-msg', role: 'alert' }, e.condition) : null,
        f.reason === 'مرتجع' && f.condition ? K.field.area('conditionNote', 'وصف الحالة', f, e, set, { required: ['عيب بسيط', 'ناقص', 'تالف'].includes(f.condition), placeholder: f.condition === 'ناقص' ? 'إيه اللي ناقص؟' : f.condition === 'سليم' ? 'اختياري' : 'وصف العيب أو التلف' }) : null,
        f.reason === 'مرتجع' && (f.condition === 'تالف' || f.condition === 'عيب بسيط') ? K.field.file('conditionPhoto', 'صورة الحالة', f, e, set) : null,
        f.reason === 'متاح للبيع' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة (فلوس المبتكر بعد البيع)' }, { value: 'ملك', label: 'ملك ابتكر' }] }) : null,
        K.field.text('loc', 'المكان', f, e, set, { placeholder: f.reason === 'تجميع أوردر' ? 'T-04' : f.reason === 'مرتجع' ? 'R-02' : f.reason === 'تصوير' ? 'P-03' : 'A-02' })],
      validate: (f) => { const e = O.validateReceive({ sku: f.sku, qty: f.qty, reason: f.reason, condition: f.condition, conditionNote: f.conditionNote }); Object.assign(e, K.req(f, ['name', 'vendor'])); if ((f.reason === 'تجميع أوردر' || f.reason === 'مرتجع') && !f.order) e.order = 'اكتب الرقم'; if (e.sku) e.sku = 'اكتب الـ SKU'; return e; },
      submitLabel: 'استلام', submit: (f) => { const status = O.STATUS_BY_REASON[f.reason][0]; const key = 'L-' + Date.now(); const ref = f.order ? (f.reason === 'مرتجع' ? '#' : 'IB-') + O.toLatin(f.order) : null;
        S.stock.unshift({ key, sku: f.sku.trim(), name: f.name.trim(), vendor: f.vendor, reason: f.reason, status, ref, order: f.reason === 'تجميع أوردر' ? O.toLatin(f.order) : null, since: K.TODAY, loc: f.loc || '—', cost: 0, mode: f.reason === 'متاح للبيع' ? f.mode : undefined, condition: f.reason === 'مرتجع' ? f.condition : undefined, conditionNote: f.reason === 'مرتجع' ? (f.conditionNote || '') : undefined });
        move({ key, type: 'in', qty: Number(f.qty), label: 'دخول — ' + (f.reason === 'متاح للبيع' ? 'للبيع' : f.reason === 'تجميع أوردر' ? 'تجميع' : f.reason), reason: f.reason, ref: ref || '—' });
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
      footer: [Button({ label: 'تسوية كمية', onClick: () => { md.close(); adjust(s); } }), Button({ type: 'primary', label: 'إغلاق', onClick: () => md.close() })] });
  }
  function photoDecision(s) {
    K.form({ title: 'قرار بعد التصوير — ' + s.name, values: { decision: S.invSettings.photoDefault === 'يرجع للمبتكر' ? 'back' : 'sell', mode: 'أمانة' }, note: U.InlineNote({ children: s.vendor + ' · في المخزن من ' + K.dlabel(s.since) + ' (' + ageTxt(age(s)) + ')' }),
      fields: (f, e, set) => [K.Radios({ label: 'القرار', value: f.decision, onChange: (v) => set('decision', v, true), options: [{ value: 'back', label: 'يرجع للمبتكر' }, { value: 'sell', label: 'يتحوّل «متاح للبيع» من المخزن' }] }),
        f.decision === 'sell' ? K.Radios({ label: 'الملكية', value: f.mode, onChange: (v) => set('mode', v, true), options: [{ value: 'أمانة', label: 'أمانة' }, { value: 'ملك', label: 'ملك ابتكر (اتشترى)' }] }) : null, f.decision === 'sell' ? K.field.text('loc', 'المكان على الرف', f, e, set, { required: true, placeholder: 'A-02' }) : null],
      validate: (f) => (f.decision === 'sell' ? K.req(f, ['loc']) : {}), submitLabel: 'حفظ القرار',
      submit: (f) => { const it = S.stock.find((x) => x.key === s.key);
        if (f.decision === 'back') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'رجوع للمبتكر', reason: 'تصوير', ref: '—', note: 'بعد التصوير' }); it.status = 'راجع للمبتكر'; }
        else { it.reason = 'متاح للبيع'; it.status = 'متاح'; it.mode = f.mode; it.loc = f.loc; move({ key: s.key, type: 'move', qty: 0, label: 'تحويل للبيع', reason: 'قرار بعد التصوير', ref: 'تصوير ← للبيع', note: f.mode + ' من ' + s.vendor }); }
        K.logEvent('stock.photo.decision', s.name + ' ' + f.decision); K.toast(f.decision === 'back' ? 'هيرجع للمبتكر' : 'بقى متاح للبيع (' + f.mode + ')', 'success'); rerender(); } });
  }
  function inspect(s, ret) {
    const r = ret || S.returns.find((x) => x.key === s.key);
    const cond = (r && r.condition) || s.condition; const condNote = (r && r.conditionNote) || s.conditionNote;
    K.form({ title: 'فحص مرتجع — ' + s.name, values: { next: 'متاح للبيع', result: O.inspectDefault(cond) }, note: U.InlineNote({ children: (s.ref || '') + ' · ' + s.vendor + ' · وصل ' + K.dlabel(s.since) + (r ? ' · السبب: ' + r.reason : '') + (cond ? ' · حالته عند الاستلام: ' + (O.RETURN_CONDITIONS.find((c) => c.value === cond) || {}).label + (condNote ? ' (' + condNote + ')' : '') : '') }),
      fields: (f, e, set) => [K.Radios({ label: 'النتيجة *', value: f.result, onChange: (v) => set('result', v, true), options: [{ value: 'سليم', label: 'سليم' }, { value: 'تالف', label: 'تالف' }] }), e.result ? h('div', { class: 'err-msg', role: 'alert' }, e.result) : null,
        f.result === 'سليم' ? K.Radios({ label: 'هيروح فين', value: f.next, onChange: (v) => set('next', v, true), options: [{ value: 'متاح للبيع', label: '+ متاح للبيع من المخزن' }, { value: 'رجوع للمبتكر', label: 'إرجاع للمبتكر' }] }) : null,
        K.field.area('note', 'ملاحظات الفحص', f, e, set, { required: f.result === 'تالف', placeholder: f.result === 'تالف' ? 'وصف التلف' : '' }), f.result === 'تالف' ? K.field.file('photo', 'صورة التلف', f, e, set) : null],
      validate: (f) => { const e = {}; if (!f.result) e.result = 'اختار نتيجة الفحص'; if (f.result === 'تالف' && !String(f.note || '').trim()) e.note = 'اكتب وصف التلف'; return e; }, submitLabel: 'حفظ الفحص',
      submit: (f) => { const it = S.stock.find((x) => x.key === s.key);
        if (f.result === 'تالف') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'تالف', reason: 'مرتجع', ref: 'فحص ' + (s.ref || ''), note: f.note }); it.status = 'تالف'; if (r) { r.status = 'اتفحص — تالف'; r.effect = '− تالف ' + K.money(s.cost) + ' ج'; r.value = s.cost; } }
        else if (f.next === 'رجوع للمبتكر') { move({ key: s.key, type: 'out', qty: s.onHand, label: 'رجوع للمبتكر', reason: 'مرتجع', ref: s.ref || '—', note: f.note || '' }); it.status = 'راجع للمبتكر'; if (r) { r.status = 'اتفحص — رجع للمبتكر'; r.effect = 'رجع لـ ' + s.vendor; } }
        else { it.reason = 'متاح للبيع'; it.status = 'متاح'; it.loc = 'A-02'; if (r) { r.status = 'اتفحص — سليم'; r.effect = '+ 1 متاح'; } }
        K.logEvent('stock.return.inspect', s.name + ' ' + f.result); K.toast('اتسجل الفحص: ' + f.result, 'success'); rerender(); } });
  }
  function newCount() {
    if (S.count) { st.tab = 'count'; R(); return K.toast('فيه جرد شغال (' + S.count.id + ') — كمّله أو اعتمده الأول'); }
    K.form({ title: 'جرد جديد', values: { zone: 'رف A' }, fields: (f, e, set) => [K.field.select('zone', 'النطاق', ['كل المخزن', 'رف A', 'رف B', 'رف C', 'رف D', 'منطقة التجميع T', 'المرتجعات R', 'التصوير P'], f, e, set, { required: true }), h('p', { class: 't-small help', style: 'margin:0' }, '«في السيستم» هيتثبت على لحظة البداية. العدّ بيتحفظ تلقائي.')], submitLabel: 'ابدأ الجرد',
      submit: (f) => { const items = K.stockNow().filter((s) => s.onHand > 0); S.count = { id: 'CNT-' + String(8 + S.counts.length).padStart(2, '0'), zone: f.zone, started: K.TODAY + ' ' + K.clockNow(), total: items.length, base: 0, lines: items.map((s) => ({ key: s.key, sku: s.sku, name: s.name, loc: s.loc, system: s.onHand, counted: '', cost: s.cost, note: '' })) }; st.tab = 'count'; K.logEvent('stock.count.start', f.zone); R(); } });
  }
  function approveCount() {
    const c = S.count; const d = O.countDiff(c.lines.filter((l) => l.counted !== '').map((l) => ({ system: l.system, counted: Number(l.counted), cost: l.cost })));
    const left = c.lines.filter((l) => l.counted === '').length;
    K.confirm({ title: 'اعتماد الجرد ' + c.id, text: d.items + ' أصناف فيها فرق · صافي ' + (d.units > 0 ? '+' : '') + d.units + ' قطعة · ' + K.money(d.value) + ' ج. هيتعمل حركة «تسوية جرد» لكل فرق.' + (left ? ' ' + left + ' منتج لسه متعدّش وهيفضل زي ما هو.' : ''), okLabel: 'اعتماد الجرد', onOk: () => {
      c.lines.filter((l) => l.counted !== '' && Number(l.counted) !== l.system).forEach((l) => move({ key: l.key || l.sku, type: 'adjust', qty: Number(l.counted) - l.system, label: 'تسوية جرد', reason: 'جرد ' + c.id, ref: c.id, note: l.note || '', name: l.name, sku: l.sku }));
      S.counts.unshift({ id: c.id, date: K.TODAY, zone: c.zone, by: K.member(K.ME).name, items: d.items, value: d.value, status: 'اتعتمد' }); S.count = null; K.logEvent('stock.count.approve', c.id); K.toast('اتعتمد ' + c.id, 'success'); R(); } });
  }
  function addRack() { K.form({ title: 'مكان تخزين جديد', values: {}, fields: (f, e, set) => [K.two(K.field.text('code', 'الكود', f, e, set, { required: true, placeholder: 'رف E' }), K.field.text('desc', 'الوصف', f, e, set, { required: true }))], validate: (f) => K.req(f, ['code', 'desc']), submitLabel: 'إضافة', submit: (f) => { S.racks.push({ code: f.code, desc: f.desc, products: 0, pieces: 0 }); R(); } }); }
  // auto-pull from «متاح للبيع» — called when a new order contains a stocked SKU
  function autoPull(sku, qty, order) {
    const it = K.stockNow().find((s) => s.sku === sku && s.reason === 'متاح للبيع'); if (!it || !O.canAutoPull(it, qty) || !S.invSettings.firstWarehouse) return false;
    move({ key: it.key, type: 'reserve', qty, label: 'حجز لأوردر', reason: 'متاح للبيع', ref: 'IB-' + order, by: 'السيستم (تلقائي)', note: 'سحب تلقائي' }); S.stock.find((s) => s.key === it.key).status = 'محجوز لأوردر';
    if (S.invSettings.pullAlert) K.notify({ title: 'اتحجزت قطعة من المخزن: ' + it.name + ' لأوردر IB-' + order, link: '#inventory-now' }); K.logEvent('stock.autopull', sku + ' → IB-' + order); return true;
  }

  window.IBPages.register('inventory', { title: 'المخزن', hash: (hs) => { const m = /^inventory(?:-(now|consolidate|returns|moves|count|settings))?$/.exec(hs); if (!m) return false; st.tab = m[1] || 'now'; return true; }, defaultHash: () => 'inventory-' + st.tab, view, api: { autoPull, receive, arrival, shipAll, cancelCons } });
})();

