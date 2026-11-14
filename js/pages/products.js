/* «المنتجات» (phase 5, plan docs/superpowers/plans/2026-10-28-phase-5-products.md) — built from the prototype's block 18 (artifact
   1793131460: Figma 626:10792 «السجل» 660:611, trash 661:850, edit 669:3477…) on the site's real products. The list is the sync's
   mirror (IBProducts); the edit page reads the product live from WooCommerce (product_get) and every change goes back through
   woo-sync (IBProducts.save / batch / trashIds / restore — the server checks products.edit / products.trash and WOO_PUSH_ENABLED).
   Out of this stage (decisions 2 / 7 / 10): duplicating and deleting for good; the studio (new products as drafts, phase 5.2) is
   products-studio.js, the content tool (Claude, phase 5.3) products-content.js; the images tool waits for phase 5.4. The reports tab (decision 20) reads products_report and the reports page's range (IBReportBlocks, block 28). The
   prototype's IBCrumbs / IBQuick / PanelButton do not exist here: «رجوع للسجل». */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, PD = window.IbtekrProducts;
  const { h, Icon, Button } = U;
  const PR = () => window.IBProducts;
  const R = () => window.IBPages.render('products');
  const setHash = (hs) => { try { history.replaceState(null, '', '#' + hs); } catch (e) { /* sandbox */ } };
  const go = (hs) => { setHash(hs); route(hs); R(); window.scrollTo(0, 0); };
  const Tag = K.Tag; const money = (n) => (n == null ? '—' : K.n0(n) + ' ج.م');
  const chipBtn = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  const safeSrc = (s) => (typeof s === 'string' && s.startsWith('https://') ? s : '');
  const Thumb = (src, cls) => (safeSrc(src) ? h('span', { class: 'thumb ' + (cls || '') }, h('img', { src: safeSrc(src), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : h('span', { class: 'thumb ' + (cls || ''), role: 'img', 'aria-label': 'مفيش صورة' }, Icon('image', 'sm')));
  const PAGE = 50;

  // ---------------- messages ----------------
  const MSG = { forbidden: 'مش مسموحلك تعمل ده', invalid: 'في قيمة مش مقبولة', no_translation: 'المنتج ده ملوش ترجمة عربي على الموقع', no_store: 'المبتكر ده ملوش متجر على الموقع', woo_down: 'الموقع مش بيرد دلوقتي — جرّب كمان شوية',
    network: 'في مشكلة في الاتصال — جرّب تاني', push_disabled: 'الكتابة على الموقع مقفولة دلوقتي — مافيش حاجة اتغيرت', busy: 'استنى العملية اللي قبلها تخلص' };
  const FIELD = { name: 'الاسم', sku: 'SKU', status: 'الحالة', regular_price: 'السعر قبل الخصم', sale_price: 'سعر البيع', stock_quantity: 'المخزون', low_stock_amount: 'التنبيه', weight: 'الوزن',
    short_description: 'الوصف القصير', description: 'الوصف', categories: 'الأقسام', brands: 'البراند', images: 'الصور' };
  const fail = (r) => {
    if (r.reason === 'invalid' && r.field) { const f = String(r.field).replace(/^(ar|variations)\./, ''); return MSG.invalid + ': ' + (FIELD[f] || f) + (r.error === 'sale_above_regular' ? ' (سعر البيع أكبر من السعر قبل الخصم)' : ''); }
    return MSG[r.reason] || MSG.network;
  };

  // ---------------- state ----------------
  const st = { tab: 'records', view: 'records', status: 'all', q: '', f: { vendor: [], brand: [], category: [], stock: [], type: [] }, sort: '', sel: new Set(), pageN: 0,
    editId: null, etab: 'data', live: null, draft: null, liveFor: null, loadingLive: false, liveErr: '', saving: false, imgSel: null, busy: false };
  const can = () => (PR() ? PR().can() : { view: false, edit: false, trash: false, commission: false });
  // the owner (1 Nov): Shift + click selects a range — the first ticked row to the one clicked (in the order shown), ticking or
  // unticking them all like the clicked one. Shift is read on the mousedown that starts the click (K.Checkbox passes no event).
  document.addEventListener('mousedown', (e) => { st.shift = !!e.shiftKey; }, true);
  function pickRange(order, id, v) {
    const i = order.indexOf(id), j = st.lastPick != null ? order.indexOf(st.lastPick) : -1;
    const ids = st.shift && i >= 0 && j >= 0 ? order.slice(Math.min(i, j), Math.max(i, j) + 1) : [id];
    ids.forEach((x) => (v ? st.sel.add(x) : st.sel.delete(x))); st.lastPick = id; R();
  }

  // ---------------- routing ----------------
  const ETABS = [['data', 'البيانات'], ['price', 'السعر والمخزون'], ['images', 'الصور'], ['variants', 'المتغيرات'], ['cats', 'الأقسام'], ['desc', 'الأوصاف'], ['seo', 'SEO']];
  function route(hs) {
    let m;
    if (hs === 'products-reports') { st.view = 'reports'; st.tab = 'reports'; return true; }
    if (hs === 'products-cats') { st.view = 'cats'; st.tab = 'cats'; return true; } // phase 13 decision 56
    if (hs === 'products' || hs === 'products-overview') { st.view = 'overview'; st.tab = 'overview'; return true; } // phase 13 decision 62: the page opens on «نظرة عامة»
    if (hs === 'products-log') { st.view = 'log'; st.tab = 'log'; return true; }
    // phase 5.2: the studio (products-studio.js) — #products-studio-<new|batch id>[-<step 1–8 | report>]
    if ((m = /^products-studio-(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-([1-8]|report))?$/.exec(hs)) && window.IBStudioView) { st.view = 'studio'; st.tab = 'add'; window.IBStudioView.route(m[1], m[2] || '1'); return true; }
    // phase 5.3: the content tool (products-content.js) — #products-tool-content[-<product id>]
    if ((m = /^products-tool-content(?:-(\d+))?$/.exec(hs)) && window.IBContentView) { st.view = 'tool-content'; st.tab = 'add'; window.IBContentView.route(m[1] ? Number(m[1]) : null); return true; }
    // phase 5.4: the images tool (products-images.js) — #products-tool-images[-<product id>]
    if ((m = /^products-tool-images(?:-(\d+))?$/.exec(hs)) && window.IBImagesView) { st.view = 'tool-images'; st.tab = 'add'; window.IBImagesView.route(m[1] ? Number(m[1]) : null); return true; }
    if ((m = /^products(?:-(add|records|trash))?$/.exec(hs))) { st.view = m[1] === 'trash' ? 'trash' : m[1] === 'add' ? 'add' : 'records'; st.tab = st.view === 'add' ? 'add' : 'records'; if (st.view === 'trash') st.status = 'trash'; else if (st.status === 'trash') st.status = 'all'; return true; }
    if ((m = /^products-edit-(\d+)(?:-(data|price|images|variants|cats|desc|seo))?$/.exec(hs))) { st.view = 'edit'; st.tab = 'records'; const id = Number(m[1]); if (id !== st.editId) { st.editId = id; st.live = null; st.draft = null; st.liveFor = null; st.imgSel = null; } st.etab = m[2] || 'data'; return true; }
    return false;
  }
  const studioHash = () => { const S = window.IBStudioView ? window.IBStudioView.state : null; return 'products-studio-' + ((S && S.id) || 'new') + '-' + (S && S.report ? 'report' : (S && S.step) || 1); };
  const defaultHash = () => ({ overview: 'products-overview', log: 'products-log', add: 'products-add', records: 'products-records', cats: 'products-cats', reports: 'products-reports', trash: 'products-trash', edit: 'products-edit-' + st.editId + '-' + st.etab }[st.view] || (st.view === 'studio' ? studioHash() : st.view === 'tool-content' && window.IBContentView ? window.IBContentView.hash() : st.view === 'tool-images' && window.IBImagesView ? window.IBImagesView.hash() : 'products-records'));

  // ---------------- shared pieces ----------------
  // th: a big table's head (2026-11-13-table-head.md) — { noun, when, total, count } for the kit's line «‹إمتى› · N من M ‹اسم› · ‹إجمالي›»
  function Card(title, sub, body, acts, cls, th) { return K.Section(title, [].concat(body).filter(Boolean), acts, Object.assign({ sub, cls }, th)); }
  const STOCK_TONE = { 'متاح': 'success', 'قليل': 'orange', 'نفد': 'error', 'حسب الطلب': 'info' };
  const STATUS_TONE = { 'منشور': 'success', 'مسودة': 'orange', 'قيد المراجعة': 'info', 'خاص': 'neutral', 'المهملات': 'error' };
  const stockStateOf = (p) => (p.onDemand ? 'حسب الطلب' : p.manageStock ? PD.stockState(p.stock == null ? 0 : p.stock, false, p.alert == null ? 3 : p.alert) : p.stockStatus === 'outofstock' ? 'نفد' : 'متاح');
  const realCats = (p) => p.cats.filter((c) => !/^uncategori[sz]ed$/i.test(c.split(' › ').pop()));
  const complete = (p) => PD.completeness({ nameEn: p.nameEn, nameAr: p.nameAr, sku: p.sku, price: p.sale, images: p.imageCount, category: realCats(p).length ? 1 : 0, weight: p.weight, sizeImage: true, desc: p.shortDescFilled || p.descFilled });
  const brandOf = (p) => p.brands.join('، ') || '—';
  const nameOf = (p) => p.nameEn || p.nameAr || ('#' + p.id);
  const all = () => (PR() ? PR().list() : []);
  const trashRows = () => (PR() ? PR().trash() : []);
  const byId = (id) => (PR() ? PR().get(id) : null);

  // ---------------- «إضافة» (phase 5.2: the studio, products.add; phase 5.3: the content tool; the images tool in 5.4) ----------------
  const canAdd = () => !!(window.IBStudio && window.IBStudio.can());
  const startStudio = () => { if (!canAdd()) { K.toast('مش مسموحلك تضيف منتجات — اطلب صلاحية «إضافة منتجات»', 'error'); return; } window.IBStudioView.start(); };
  function addView() {
    const studioCard = h('button', { type: 'button', class: 'card tool-card', 'aria-label': 'استوديو المنتجات — ابدأ دفعة', onClick: startStudio }, h('span', { class: 'tool-ic' }, Icon('package')), h('span', { class: 't-h5 tc-t' }, 'استوديو المنتجات'),
      h('span', { class: 't-small tc-b' }, 'من الشيت والصور لحد ما المنتج يترفع على الموقع مسودة: SKU، متغيرات، سعر، صور، أقسام، أوصاف.'), canAdd() ? Tag('success', 'متاح') : Tag('neutral', 'محتاج صلاحية'), h('span', { class: 'tc-cta' }, 'ابدأ دفعة', Icon('chevL', 'sm')));
    const canWrite = !!(window.IBAI && window.IBAI.can().write);
    const contentCard = h('button', { type: 'button', class: 'card tool-card', 'aria-label': 'المحتوى — افتح الأداة', 'data-tool': 'content', onClick: () => (canWrite ? go('products-tool-content') : K.toast('محتاج صلاحية «إضافة منتجات» أو «تعديل المنتجات»', 'error')) },
      h('span', { class: 'tool-ic' }, Icon('file')), h('span', { class: 't-h5 tc-t' }, 'المحتوى'), h('span', { class: 't-small tc-b' }, 'اسم ووصف وكلمات مفتاحية ونقاط بالعربي والإنجليزي بأسلوب إبتكر.'),
      canWrite ? Tag('gold', 'ذكاء اصطناعي') : Tag('neutral', 'محتاج صلاحية'), h('span', { class: 'tc-cta' }, 'افتح', Icon('chevL', 'sm')));
    // phase 5.4: the images tool (Magnific) — products.add or products.edit = F
    const canImg = !!(window.IBImages && window.IBImages.can().tool);
    const imagesCard = h('button', { type: 'button', class: 'card tool-card', 'aria-label': 'الصور — افتح الأداة', 'data-tool': 'images', onClick: () => (canImg ? go('products-tool-images') : K.toast('محتاج صلاحية «إضافة منتجات» أو «تعديل المنتجات»', 'error')) }, h('span', { class: 'tool-ic' }, Icon('image')), h('span', { class: 't-h5 tc-t' }, 'الصور'),
      h('span', { class: 't-small tc-b' }, 'صورة احترافية من صورة أو من وصف، إزالة خلفية، تحسين وتكبير — وتتحفظ على المنتج.'), canImg ? Tag('gold', 'ذكاء اصطناعي') : Tag('neutral', 'محتاج صلاحية'), h('span', { class: 'tc-cta' }, 'افتح', Icon('chevL', 'sm')));
    return [h('div', { class: 'tools-grid c3' }, studioCard, imagesCard, contentCard),
      window.IBStudioView ? window.IBStudioView.savedWork() : null,
      U.InlineNote({ children: 'المنتجات الجديدة بتترفع مسودة من الاستوديو، والمنتجات اللي على الموقع بتتعدل من «السجل». أداة المحتوى بتكتب بالـ AI (Claude) وأداة الصور بتعمل الصور بالـ AI (Magnific) — راجع اللي بيطلع قبل ما تستخدمه.' })];
  }

  // ---------------- «السجل» ----------------
  const catHit = (c) => st.f.category.some((f) => c === f || c.startsWith(f + ' › '));
  function filtered() {
    const q = st.q.trim().toLowerCase();
    return all().filter((p) => {
      if (st.status === 'published' && p.wooStatus !== 'publish') return false;
      if (st.status === 'draft' && p.wooStatus !== 'draft') return false;
      if (st.status === 'pending' && p.wooStatus !== 'pending') return false;
      if (st.status === 'out' && stockStateOf(p) !== 'نفد') return false;
      if (q && !(p.nameEn.toLowerCase().includes(q) || p.nameAr.includes(q) || p.sku.toLowerCase().includes(q))) return false;
      // B3 (the owner, 11 Nov): several picks per filter — a product passes on any of them (a category = itself or anything under it)
      if (st.f.vendor.length && !st.f.vendor.includes(p.vendor)) return false;
      if (st.f.brand.length && !p.brands.some((b) => st.f.brand.includes(b))) return false;
      if (st.f.category.length && !p.cats.some((c) => catHit(c))) return false;
      if (st.f.stock.length && !st.f.stock.includes(stockStateOf(p))) return false;
      if (st.f.type.length && !st.f.type.includes(p.type)) return false;
      return true;
    });
  }
  function counts() {
    const L = all();
    return { all: L.length, published: L.filter((p) => p.wooStatus === 'publish').length, draft: L.filter((p) => p.wooStatus === 'draft').length, pending: L.filter((p) => p.wooStatus === 'pending').length,
      out: L.filter((p) => stockStateOf(p) === 'نفد').length, trash: trashRows().length };
  }
  function statusChips() {
    const c = counts(); const it = [['all', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة'], ['pending', 'قيد المراجعة'], ['trash', 'المهملات']]; // B3: no «نفد» tab (the «المخزون» filter has it)
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'الحالة' }, it.map(([id, l]) => chipBtn(l + ' ' + K.n0(c[id]), st.status === id, () => { st.status = id; st.sel.clear(); st.pageN = 0; go(id === 'trash' ? 'products-trash' : 'products-records'); }, { 'data-pstatus': id })));
  }
  // the owner 12 Nov («دخل الفلتر … جوه زرار الفلتر وحطوا جمب الترتيب … في كل الجداول»): the five filters live in one «فلتر» button next
  // to the sort — each group with its ticks (a search box past six values; the categories main, then their subs with «-»)
  const countAll = (d) => { const was = st.f; st.f = Object.assign({ vendor: [], brand: [], category: [], stock: [], type: [] }, d); const n = filtered().length; st.f = was; return n; };
  const prFilterMenu = (groups) => K.FilterMenu({ id: 'products', label: 'فلتر المنتجات', noun: 'منتج', value: st.f, groups, count: countAll,
    onApply: (d) => { st.f = Object.assign({ vendor: [], brand: [], category: [], stock: [], type: [] }, d); st.sel.clear(); st.pageN = 0; R(); } });
  function searchBox() {
    const q = h('input', { type: 'search', placeholder: 'دوّر بالاسم أو الـ SKU', 'aria-label': 'بحث في المنتجات', value: st.q });
    q.addEventListener('input', () => { st.q = q.value; st.pageN = 0; const p = q.selectionStart; R(); const n = document.querySelector('#pg-products input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    return h('label', { class: 'search-field' }, Icon('search', 'sm'), q);
  }
  const clearFilters = () => { st.f = { vendor: [], brand: [], category: [], stock: [], type: [] }; st.q = ''; st.pageN = 0; };
  // phase 5.5 decision 5 (owner 1 Nov): the kit's closed filter + sort + chips in the records card header, next to the columns button — the same look as every table
  const PR_SORTS = [['new', 'الإضافة: الأحدث للأقدم'], ['old', 'الإضافة: الأقدم للأحدث'], ['sales-desc', 'مرات البيع: الأكتر للأقل'], ['sales-asc', 'مرات البيع: الأقل للأكتر'], ['price-desc', 'السعر: الأعلى للأقل'], ['price-asc', 'السعر: الأقل للأعلى'], ['stock-asc', 'المخزون: الأقل الأول (للتزويد)'], ['stock-desc', 'المخزون: الأكتر الأول'], ['missing', 'ناقصها بيانات الأول'], ['name', 'الاسم: A → Z']];
  const sellPrice = (p) => Number(p.type === 'Variable' ? p.price : p.sale) || 0;
  function sortProducts(l) {
    const k = st.sort || 'new'; const by = { new: (x, y) => Number(y.id) - Number(x.id), old: (x, y) => Number(x.id) - Number(y.id), 'sales-desc': (x, y) => y.sales - x.sales, 'sales-asc': (x, y) => x.sales - y.sales, 'price-desc': (x, y) => sellPrice(y) - sellPrice(x), 'price-asc': (x, y) => sellPrice(x) - sellPrice(y),
      'stock-asc': (x, y) => (x.onDemand || x.stock == null ? 1e9 : x.stock) - (y.onDemand || y.stock == null ? 1e9 : y.stock), 'stock-desc': (x, y) => (y.onDemand || y.stock == null ? -1 : y.stock) - (x.onDemand || x.stock == null ? -1 : x.stock), missing: (x, y) => complete(y).missing.length - complete(x).missing.length, name: (x, y) => nameOf(x).localeCompare(nameOf(y)) }[k];
    return by ? l.sort(by) : l;
  }
  const FLBL = { brand: 'البراند', vendor: 'المبتكر', category: 'القسم', stock: 'المخزون', type: 'النوع' };
  function prSortMenu() { return K.SortMenu({ id: 'products', label: 'ترتيب المنتجات', options: PR_SORTS, value: st.sort && PR_SORTS.some((x) => x[0] === st.sort) ? st.sort : 'new', onChange: (v) => { st.sort = v; st.pageN = 0; R(); } }); }
  // the picks as chips with their counts (each on its own), before the table
  function prChips(list) {
    const chips = []; const STL = { published: 'منشور', draft: 'مسودة', pending: 'قيد المراجعة', out: 'نفد' };
    const cnt = (patch) => { const sv = { status: st.status, f: st.f, q: st.q }; st.status = patch.status || 'all'; st.f = Object.assign({ vendor: [], brand: [], category: [], stock: [], type: [] }, patch.f || {}); st.q = patch.q || ''; const n = filtered().length; Object.assign(st, sv); return n; };
    const ch = (key, label, patch, reset) => chips.push({ key, label, count: cnt(patch), remove: () => { reset(); st.sel.clear(); st.pageN = 0; R(); } });
    if (st.q) ch('q', 'بحث: ' + st.q, { q: st.q }, () => { st.q = ''; });
    if (STL[st.status]) ch('status', 'الحالة: ' + STL[st.status], { status: st.status }, () => { st.status = 'all'; });
    Object.keys(FLBL).forEach((k) => st.f[k].forEach((v) => ch(k + ':' + v, FLBL[k] + ': ' + v, { f: { [k]: [v] } }, () => { st.f[k] = st.f[k].filter((x) => x !== v); }))); // B3: a chip per pick
    return K.ActiveFilters({ id: 'products', chips, total: list.length, noun: 'منتج', onClear: () => { clearFilters(); st.status = 'all'; st.sel.clear(); R(); } });
  }
  function recordsView() {
    // the owner (1 Nov): the records newest first by default (the site's ids grow with creation — the mirror has no creation date)
    const list = sortProducts(filtered().slice());
    const any = Object.values(st.f).some((a) => a.length) || st.q; const C = can();
    const L = all(); const vendors = [...new Set(L.map((p) => p.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const brandNames = (PR() ? PR().brands() : []).map((b) => b.name).sort((a, b) => a.localeCompare(b));
    const catOpts = PD.catOptions(PR() ? PR().categories() : []); // B3: main, then its subs with «-» / «--» / «---»
    // B3 (the owner, 11 Nov): no «ناقصها بيانات» chip; each filter a multi-select with the values alone
    const prFilter = prFilterMenu([{ key: 'brand', label: 'البراند', options: brandNames.map((x) => [x, x]) }, { key: 'vendor', label: 'المبتكر', options: vendors.map((x) => [x, x]) },
      { key: 'category', label: 'القسم', options: catOpts }, { key: 'stock', label: 'المخزون', options: ['متاح', 'قليل', 'نفد', 'حسب الطلب'].map((x) => [x, x]) },
      { key: 'type', label: 'النوع', options: [['Simple', 'Simple'], ['Variable', 'Variable']] }]);
    // the owner 12 Nov («إنقل خانة البحث جمب ايقونة الفلتر وخلي الزراير سنتر … مع التايتل … طبقوا بس على المنتجات»): the search sits in the
    // records card's header next to «فلتر», the header's buttons centred on the title block
    const filters = any ? h('div', { class: 'toolbar pr-filters' }, Button({ type: 'text', size: 'sm', label: 'مسح الفلاتر', onClick: () => { clearFilters(); R(); } })) : null;
    const sel = [...st.sel].map(byId).filter(Boolean);
    const bulk = sel.length && (C.bulk || C.trash) ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد' }, h('b', null, 'محدد ' + K.n0(sel.length)), h('span', { class: 'grow' }),
      C.bulk ? Button({ size: 'sm', label: 'تعديل السعر', onClick: () => bulkPrice(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'تعديل المخزون', onClick: () => bulkStock(sel) }) : null,
      C.bulk ? Button({ size: 'sm', label: 'نقل لبراند تاني', onClick: () => moveBrand(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'نقل لمبتكر تاني', onClick: () => moveVendor(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'تغيير القسم', onClick: () => changeCat(sel) }) : null,
      C.bulk ? Button({ size: 'sm', label: 'تحويل لمسودة', onClick: () => toDraft(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'نشر', onClick: () => publish(sel) }) : null,
      C.trash ? Button({ type: 'danger', size: 'sm', label: 'مسح', onClick: () => toTrash(sel) }) : null, Button({ size: 'sm', label: 'إلغاء التحديد', onClick: () => { st.sel.clear(); R(); } })) : null;
    const pages = Math.max(1, Math.ceil(list.length / PAGE)); if (st.pageN >= pages) st.pageN = pages - 1;
    const shown = list.slice(st.pageN * PAGE, st.pageN * PAGE + PAGE);
    const allSel = shown.length && shown.every((p) => st.sel.has(p.id));
    const rows = shown.map((p) => { const ss = stockStateOf(p);
      return [K.Checkbox({ label: '', checked: st.sel.has(p.id), onChange: (v) => pickRange(shown.map((x) => x.id), p.id, v) }),
        h('button', { type: 'button', class: 'prod link', 'data-pedit': String(p.id), onClick: () => go('products-edit-' + p.id) }, Thumb(p.img), h('span', null, h('b', null, nameOf(p)))), // the owner, 28 Oct: the English name alone (no Arabic name, no «ناقص: …» under it; the «ناقصها بيانات» filter stays)
        h('span', { dir: 'ltr', class: 't-small' }, p.sku || '—'), h('span', { class: 'brand-cell' }, h('span', null, brandOf(p)), h('small', { class: 't-small help' }, p.vendor || '—')),
        h('span', { class: 'cat-list t-small' }, p.cats.length ? p.cats.map((c) => h('span', { class: catHit(c) ? 'cat-hit' : null }, c)) : '—'), h('span', { class: 't-small' }, p.type),
        p.type === 'Variable' && p.price != null ? h('span', null, 'من ', money(p.price)) : money(p.type === 'Variable' ? null : p.sale),
        h('span', { class: 'stk' }, ss === 'حسب الطلب' || p.stock == null ? null : K.Num(String(p.stock)), ss !== 'متاح' ? Tag(STOCK_TONE[ss], ss) : null),
        h('span', { class: 'sales-cell', 'data-sales': String(p.sales), title: 'اتباع ' + p.sales + ' مرة' }, p.sales ? K.Num(K.n0(p.sales)) : h('span', { class: 'help' }, '—')),
        Tag(STATUS_TONE[p.status] || 'neutral', p.status),
        K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => go('products-edit-' + p.id) }, p.permalink ? { label: 'افتح على الموقع', icon: 'link', run: () => openSite(p.permalink) } : null,
          { label: 'تكرار كمنتج جديد', icon: 'copy', run: () => duplicate(p) },
          C.edit ? { label: 'نقل لبراند تاني', icon: 'tag', run: () => moveBrand([p]) } : null,
          C.bulk ? { label: 'نقل لمبتكر تاني', icon: 'users', run: () => moveVendor([p]) } : null,
          C.edit ? (p.wooStatus === 'publish' ? { label: 'تحويل لمسودة', icon: 'eyeoff', run: () => toDraft([p]) } : { label: 'نشر', icon: 'eye', run: () => publish([p]) }) : null,
          C.trash ? { label: 'مسح', icon: 'trash', danger: true, run: () => toTrash([p]) } : null], 'إجراءات ' + nameOf(p))]; });
    const salesHead = () => h('button', { type: 'button', class: 'th-sort', 'data-sort-sales': '', 'aria-sort': st.sort === 'sales-desc' ? 'descending' : st.sort === 'sales-asc' ? 'ascending' : 'none', title: 'رتّب بمرات الشراء', onClick: () => { st.sort = st.sort === 'sales-desc' ? 'sales-asc' : st.sort === 'sales-asc' ? '' : 'sales-desc'; R(); } }, 'مرات الشراء', h('span', { 'aria-hidden': 'true', class: 'sort-ic' }, st.sort === 'sales-desc' ? ' ↓' : st.sort === 'sales-asc' ? ' ↑' : ' ↕'));
    const table = list.length ? U.Table({ cls: 'dt pr-table', headers: [K.Checkbox({ label: '', checked: allSel, onChange: (v) => { shown.forEach((p) => (v ? st.sel.add(p.id) : st.sel.delete(p.id))); R(); } }), 'المنتج', 'SKU', 'البراند · المبتكر', 'القسم', 'النوع', 'السعر', 'المخزون', salesHead(), 'الحالة', ''], rows })
      : K.Empty('مفيش منتجات بالفلاتر دي', 'امسح الفلاتر أو جرّب اسم أو SKU تاني.', Button({ size: 'sm', label: 'مسح الفلاتر', onClick: () => { clearFilters(); st.status = 'all'; R(); } }));
    // the kit labels each cell (data-l, the phone card) with its header: an element header gets its text instead
    if (list.length) table.querySelectorAll('td[data-l^="[object"]').forEach((td) => { const th = table.querySelectorAll('thead th')[td.cellIndex]; td.dataset.l = th ? th.textContent.replace(/[↓↑↕]/g, '').trim() : ''; });
    const pager = list.length ? h('div', { class: 'pager t-small' }, h('span', { 'data-pager': '' }, K.n0(st.pageN * PAGE + 1) + '–' + K.n0(st.pageN * PAGE + shown.length) + ' من ' + K.n0(list.length)),
      h('span', { class: 'acts-inline' }, Button({ size: 'sm', label: 'السابق', disabled: st.pageN === 0, onClick: () => { st.pageN--; R(); window.scrollTo(0, 0); } }), Button({ size: 'sm', label: 'التالي', disabled: st.pageN >= pages - 1, onClick: () => { st.pageN++; R(); window.scrollTo(0, 0); } }))) : null;
    // the kit's line under the title: «اليوم … · N من M منتج» (2026-11-13-table-head.md)
    return [statusChips(), filters, bulk, h('section', { class: 'card sec own-filter pr-rec', 'data-th-noun': 'منتج|المنتجات', 'data-th-count': list.length + '/' + all().length }, h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, 'سجل المنتجات')), h('div', { class: 'acts' }, searchBox(), prFilter, prSortMenu())), h('div', { class: 'sec-b' }, prChips(list), table, pager))];
  }
  /* phase 13 decision 56 (owner 11 Nov — «تاب للأقسام جوه المنتجات يبان فيها كل قسم والأقسام الفرعية اللي تحتيه مع إمكانية إضافة قسم جديد أو
     أقسام فرعية»), its look by B4 (the owner, 11 Nov): the site's tree (the mirror woo_categories) — a main category is a green card
     (its name, its sub-categories' count, the products in it and under it on a button that opens them, an arrow that opens / closes
     it, ⋮), its sub-categories beige rows under it with «-» / «--» / «---» by depth, each with its own arrow and ⋮ (افتح في السجل ·
     تعديل · إضافة قسم فرعي · حذف). A search opens the branches it hits. products.add / the admin: «قسم رئيسي جديد» / «قسم فرعي
     جديد» (EN + AR, a square image) through woo-sync category_create, «تعديل» reads the category live (category_get) and writes what
     changed (category_update), «حذف» — for good: WooCommerce has no trash for a category — refused while products or sub-categories
     use it (category_delete checks again on the server). The count opens the category's products with a bulk bar. */
  st.catOpen = st.catOpen || new Set(); st.catQ = st.catQ || ''; st.catSel = st.catSel || new Set();
  const catName = (s) => String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–');
  function catModel() {
    const L = PR().categories(); const byId = new Map(L.map((c) => [c.id, c]));
    const kids = new Map(); L.forEach((c) => { const k = c.parentId && byId.has(c.parentId) ? c.parentId : 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); });
    kids.forEach((l) => l.sort((a, b) => a.name.localeCompare(b.name)));
    const own = new Map(); all().forEach((p) => (p.categoryIds || []).forEach((id) => { if (!own.has(id)) own.set(id, new Set()); own.get(id).add(p.id); }));
    const under = new Map();
    const sum = (id, seen = new Set()) => { if (under.has(id)) return under.get(id); if (seen.has(id)) return new Set(); seen.add(id); const set = new Set(own.get(id) || []); (kids.get(id) || []).forEach((k) => sum(k.id, seen).forEach((x) => set.add(x))); under.set(id, set); return set; };
    const subtree = (id, seen = new Set()) => { if (seen.has(id)) return []; seen.add(id); return [id].concat(...(kids.get(id) || []).map((k) => subtree(k.id, seen))); };
    return { L, byId, kids, sum, subtree };
  }
  const subsLabel = (n) => K.n0(n) + (n > 2 && n < 11 ? ' أقسام فرعية' : ' قسم فرعي');
  function catsView() {
    const C = can(); const M = catModel(); const { L, byId, kids } = M;
    const q = st.catQ.trim().toLowerCase(); const hit = (c) => !q || c.name.toLowerCase().includes(q);
    const shown = new Set(); if (q) L.forEach((c) => { if (hit(c)) { let x = c; const seen = new Set(); while (x && !seen.has(x.id)) { seen.add(x.id); shown.add(x.id); x = x.parentId ? byId.get(x.parentId) : null; } } });
    const openRec = (c) => { clearFilters(); st.f.category = [c.path]; st.status = 'all'; go('products-records'); };
    const menuOf = (c) => { const items = [M.sum(c.id).size ? { label: 'افتح في السجل', icon: 'eye', run: () => openRec(c) } : null,
      C.add ? { label: 'تعديل', icon: 'edit', run: () => editCat(c) } : null, C.add ? { label: 'إضافة قسم فرعي', icon: 'plus', run: () => newCat(c.id) } : null,
      C.add ? { label: 'حذف', icon: 'trash', danger: true, run: () => delCat(c) } : null].filter(Boolean);
      return items.length ? h('span', { class: 'cat-menu', 'data-cat-menu': String(c.id) }, K.RowMenu(items, 'إجراءات القسم ' + c.name)) : null; };
    const tog = (c, open) => h('button', { type: 'button', class: 'cat-tog', 'aria-expanded': String(open), 'aria-label': (open ? 'اقفل ' : 'افتح ') + c.name, 'data-cat-tog': String(c.id),
      onClick: () => { if (st.catOpen.has(c.id)) st.catOpen.delete(c.id); else st.catOpen.add(c.id); R(); } }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'));
    const count = (c) => { const n = M.sum(c.id).size;
      return h('button', { type: 'button', class: 'cat-count', 'data-cat-prods': String(c.id), disabled: n ? null : '', 'aria-label': K.n0(n) + ' منتج في ' + c.name + (n ? ' — اعرضهم' : ''), onClick: () => catProducts(c) }, K.n0(n) + ' منتج'); };
    const name = (c, cls) => h('b', { class: cls + (q && hit(c) ? ' cat-hit' : '') }, c.name);
    // owner batch 14 Nov decision 9: a checkbox for the bulk bar, the category's small image and its slug
    const pick = (c) => (C.add ? h('span', { class: 'cat-cb', 'data-cat-cb': String(c.id) }, K.Checkbox({ label: '', checked: st.catSel.has(c.id), onChange: (v) => { if (v) st.catSel.add(c.id); else st.catSel.delete(c.id); R(); } })) : null);
    const thumb = (c) => (c.image ? h('img', { class: 'cat-thumb', src: safeSrc(c.image), alt: '', loading: 'lazy', 'data-cat-thumb': String(c.id) }) : h('span', { class: 'cat-thumb none', 'aria-hidden': 'true' }, Icon('box', 'sm')));
    const slug = (c) => (c.slug ? h('code', { class: 'cat-slug', dir: 'ltr', 'data-cat-slug': String(c.id) }, c.slug) : null);
    const subRows = (list, depth) => list.flatMap((c) => {
      if (q && !shown.has(c.id)) return [];
      const ch = kids.get(c.id) || []; const open = q ? true : st.catOpen.has(c.id);
      const row = h('div', { class: 'cat-sub lvl-' + Math.min(depth, 3), 'data-cat': String(c.id), 'data-cat-lvl': String(Math.min(depth, 3)), role: 'listitem', style: '--d:' + Math.min(depth, 4) },
        pick(c), h('span', { class: 'cat-dash', 'aria-hidden': 'true' }, '-'.repeat(Math.min(depth, 3))),
        ch.length ? tog(c, open) : h('span', { class: 'cat-tog sp', 'aria-hidden': 'true' }), thumb(c), name(c, 'cat-name'), slug(c),
        ch.length ? h('span', { class: 't-small help cat-n' }, subsLabel(ch.length)) : null, h('span', { class: 'grow' }), count(c), menuOf(c));
      return [row].concat(open && ch.length ? subRows(ch, depth + 1) : []);
    });
    const mains = (kids.get(0) || []).filter((c) => !q || shown.has(c.id)).map((c) => {
      const ch = kids.get(c.id) || []; const open = q ? true : st.catOpen.has(c.id);
      return h('section', { class: 'cat-main' + (open && ch.length ? ' open' : ''), 'data-cat': String(c.id) },
        h('div', { class: 'cat-main-h' }, pick(c), ch.length ? tog(c, open) : h('span', { class: 'cat-tog sp', 'aria-hidden': 'true' }), thumb(c), name(c, 'cat-name'), slug(c),
          ch.length ? h('span', { class: 'cat-n' }, subsLabel(ch.length)) : null, h('span', { class: 'grow' }), count(c), menuOf(c)),
        open && ch.length ? h('div', { class: 'cat-subs', role: 'list', 'aria-label': 'الأقسام الفرعية في ' + c.name }, subRows(ch, 1)) : null);
    });
    const search = h('input', { type: 'search', class: 'input', placeholder: 'دوّر على قسم…', 'aria-label': 'دوّر على قسم', value: st.catQ, onInput: (e) => { st.catQ = e.target.value; R(); setTimeout(() => { const i = document.querySelector('[data-cat-q]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 'data-cat-q': '' });
    const tops = (kids.get(0) || []).length;
    return [
      h('div', { class: 'cat-bar' }, search, h('span', { class: 'grow' }),
        Button({ type: 'text', size: 'sm', label: 'افتح الكل', onClick: () => { L.forEach((c) => { if ((kids.get(c.id) || []).length) st.catOpen.add(c.id); }); R(); } }),
        Button({ type: 'text', size: 'sm', label: 'اقفل الكل', onClick: () => { st.catOpen.clear(); R(); } }),
        C.add ? Button({ type: 'primary', size: 'sm', icon: 'plus', label: 'قسم رئيسي جديد', attrs: { 'data-cat-new': '' }, onClick: () => newCat(null) }) : null),
      h('p', { class: 't-small help cat-sum' }, 'أقسام الموقع · ' + K.n0(L.length) + ' — ' + K.n0(tops) + ' قسم رئيسي'),
      catBulkBar(M),
      mains.length ? h('div', { class: 'cat-mains' }, mains) : K.Empty(q ? 'مفيش قسم بالاسم ده' : 'مفيش أقسام لسه', q ? 'جرّب كلمة تانية.' : 'الأقسام بتيجي من الموقع مع المزامنة.'),
      C.add ? null : h('p', { class: 't-small help' }, 'إضافة الأقسام وتعديلها لصلاحية «إضافة منتجات».')];
  }
  // owner batch 14 Nov decision 9: the categories' bulk bar — «تغيير القسم الأب» (category_update parent, one by one) and «حذف» (the
  // ones nothing uses, the deepest first, through category_delete — the server checks again)
  function catBulkBar(M) {
    const ids = [...st.catSel].filter((id) => M.byId.has(id)); if (ids.length !== st.catSel.size) st.catSel = new Set(ids);
    if (!ids.length) return null;
    return h('div', { class: 'bulk-bar cat-bulk', role: 'region', 'aria-label': 'إجراءات على الأقسام المحددة', 'data-cat-bulk-bar': '' }, h('b', null, 'محدد ' + K.n0(ids.length)), h('span', { class: 'grow' }),
      Button({ size: 'sm', label: 'تغيير القسم الأب', attrs: { 'data-cat-bulk-parent': '' }, onClick: () => catBulkParent(ids) }),
      Button({ size: 'sm', type: 'danger', label: 'حذف', attrs: { 'data-cat-bulk-del': '' }, onClick: () => catBulkDelete(ids) }),
      Button({ size: 'sm', type: 'text', label: 'إلغاء التحديد', onClick: () => { st.catSel.clear(); R(); } }));
  }
  function catBulkParent(ids) {
    const M = catModel(); const S0 = window.IBStudio; if (!S0 || !S0.categoryUpdate) { K.toast(MSG.network, 'error'); return; }
    const off = new Set(ids.flatMap((id) => M.subtree(id))); // never under itself or one of its own
    const opts = [{ value: '0', label: '— قسم رئيسي (من غير أب) —' }].concat(M.L.filter((c) => !off.has(c.id)).map((c) => ({ value: String(c.id), label: c.path })));
    K.form({ title: 'تغيير القسم الأب — ' + K.n0(ids.length) + (ids.length === 1 ? ' قسم' : ' أقسام'), values: { p: '0' }, submitLabel: 'انقل',
      note: U.InlineNote({ kind: 'warning', children: 'النقل بيتكتب على ووكومرس نفسه — القسم وترجمته العربي (تحت ترجمة القسم الأب الجديد).' }),
      fields: (f, e, set) => [U.Select({ id: 'cat-new-parent', label: 'القسم الأب الجديد', options: opts, value: f.p, onChange: (v) => set('p', v, true) })],
      submit: (f, m) => { m._busy = true; const parent = Number(f.p) || 0;
        (async () => { let ok = 0; const bad = [];
          for (const id of ids) { const c = M.byId.get(id); if (!c || (c.parentId || 0) === parent) { ok += 1; continue; } const r = await S0.categoryUpdate({ id, parent }); if (r.ok) ok += 1; else bad.push(c.name); }
          m._busy = false; m.close(); st.catSel.clear(); if (parent) st.catOpen.add(parent);
          K.toast(bad.length ? 'اتنقل ' + K.n0(ok) + ' — ماتنقلش: ' + bad.join('، ') : 'اتنقلت الأقسام', bad.length ? 'error' : 'success'); R(); })();
        return false; } });
  }
  function catBulkDelete(ids) {
    const M = catModel(); const S0 = window.IBStudio; if (!S0 || !S0.categoryDelete) { K.toast(MSG.network, 'error'); return; }
    const sel = new Set(ids); const depth = (id) => { let n = 0; let x = M.byId.get(id); const seen = new Set(); while (x && x.parentId && !seen.has(x.id)) { seen.add(x.id); n += 1; x = M.byId.get(x.parentId); } return n; };
    // a category goes when it has no product (in it or under it) and every sub-category under it goes too
    const blocked = ids.filter((id) => M.sum(id).size || (M.kids.get(id) || []).some((k) => !sel.has(k.id)));
    const go = ids.filter((id) => !blocked.includes(id)).sort((a, b) => depth(b) - depth(a));
    if (!go.length) { catBlocked('الأقسام المحددة ماتتحذفش', 'فيها منتجات أو تحتها أقسام فرعية مش محددة — انقل المنتجات واحذف الفرعي الأول.'); return; }
    K.confirm({ title: 'حذف ' + K.n0(go.length) + (go.length === 1 ? ' قسم' : ' أقسام') + ' نهائي؟', text: 'هيتحذفوا من الموقع هما وترجماتهم العربي — ووكومرس مالوش سلة للأقسام.' + (blocked.length ? ' ومش هيتحذف (فيه منتجات أو أقسام تحته): ' + blocked.map((id) => M.byId.get(id).name).join('، ') + '.' : ''), okLabel: 'احذف', okType: 'danger',
      onOk: async () => { let ok = 0; const bad = [];
        for (const id of go) { const c = M.byId.get(id); const r = await S0.categoryDelete(id, c.name); if (r.ok) { ok += 1; st.catSel.delete(id); st.catOpen.delete(id); } else bad.push(c.name); }
        K.toast(bad.length ? 'اتحذف ' + K.n0(ok) + ' — ماتحذفش: ' + bad.join('، ') : 'اتحذفت الأقسام', bad.length ? 'error' : 'success'); R(); } });
  }
  // the slug field of «قسم جديد» / «تعديل» — small English letters, digits and «-»; empty = the site makes one from the name
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const slugErr = (v) => { const t = String(v || '').trim(); return !t ? null : t.length > 80 ? 'لحد 80 حرف' : SLUG_RE.test(t) ? null : 'حروف إنجليزي صغيرة وأرقام و«-» بس (من غير مسافات)'; };
  const slugField = (f, e, set) => K.field.text('slug', 'الـ Slug (الرابط)', f, e, set, { dir: 'ltr', placeholder: 'desk-lamps', help: 'فاضي = الموقع بيعمله من الاسم الإنجليزي' });
  // B4: a category's image — cut square from the middle, at most 800 px a side, WebP (JPEG where the browser cannot write WebP); the
  // Blob goes to woo-sync (base64, IBStudio), the blob: URL is the popup's preview
  const CAT_IMG_SIDE = 800;
  function squareImage(file) {
    return new Promise((resolve) => {
      if (!file || !/^image\/(png|jpe?g|webp)$/i.test(file.type || '') || file.size > 15 * 1048576) { resolve(null); return; }
      let url = null; try { url = URL.createObjectURL(file); } catch (e) { resolve(null); return; }
      const im = new Image();
      im.onload = () => {
        try {
          const w = im.naturalWidth || im.width, ht = im.naturalHeight || im.height; const s = Math.min(w, ht);
          URL.revokeObjectURL(url); if (!s) { resolve(null); return; }
          const side = Math.min(CAT_IMG_SIDE, s); const cv = document.createElement('canvas'); cv.width = side; cv.height = side;
          const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          cx.drawImage(im, Math.round((w - s) / 2), Math.round((ht - s) / 2), s, s, 0, 0, side, side);
          const out = (b) => resolve(b ? { blob: b, url: URL.createObjectURL(b) } : null);
          cv.toBlob((b) => (b && b.type === 'image/webp' ? out(b) : cv.toBlob((j) => out(j), 'image/jpeg', 0.88)), 'image/webp', 0.86);
        } catch (e) { resolve(null); }
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  // the popup's image: the current one on the site (تعديل) or the square crop picked here; img() / setImg(v) keep the pick
  function catImageField(img, setImg, cur) {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', 'data-cat-img': '',
      onChange: async (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
        const sq = await squareImage(file); if (!sq) { K.toast('الصورة لازم تكون PNG أو JPG أو WebP (لحد 15 ميجا)', 'error'); return; }
        const old = img(); if (old) URL.revokeObjectURL(old.url); setImg(sq); } });
    const now = img(); const src = now ? now.url : safeSrc(cur || '');
    return U.FieldShell({ id: 'cat-img', label: 'صورة القسم (مربعة)', help: 'بتتقص مربعة من النص وبتتحط على القسم في الموقع وعلى ترجمته العربي.' },
      h('div', { class: 'cat-img' }, src ? h('img', { src, alt: '', class: 'cat-img-prev', 'data-cat-img-prev': now ? 'new' : 'site' }) : h('span', { class: 'cat-img-none' }, 'من غير صورة'),
        input, Button({ size: 'sm', label: src ? 'غيّر الصورة' : 'اختار صورة', attrs: { 'data-cat-img-pick': '' }, onClick: () => input.click() }),
        now ? Button({ type: 'text', size: 'sm', label: 'شيل الصورة الجديدة', onClick: () => { URL.revokeObjectURL(now.url); setImg(null); } }) : null));
  }
  const catNameErr = (v, need) => (!String(v || '').trim() ? (need ? 'اكتب الاسم' : null) : /[<>%]/.test(v) ? 'من غير < > %' : String(v).trim().length > 80 ? 'لحد 80 حرف' : null);
  const catFail = (r) => (r.reason === 'push_disabled' ? 'الكتابة على الموقع متقفلة' : r.reason === 'forbidden' ? 'الصلاحية دي مش عندك' : r.reason === 'media_refused' ? 'الموقع مارضيش ياخد الصورة' : r.reason === 'missing' ? 'القسم ده مش موجود على الموقع' : MSG.network);
  function newCat(parentId) {
    const L = PR().categories(); const parent = parentId ? L.find((c) => c.id === Number(parentId)) || null : null;
    let img = null;
    K.form({ title: parent ? 'قسم فرعي جديد' : 'قسم رئيسي جديد', submitLabel: 'اعمل القسم', values: { en: '', ar: '', slug: '' },
      onClose: () => { if (img) URL.revokeObjectURL(img.url); },
      note: U.InlineNote({ kind: 'warning', children: 'القسم بيتعمل على ووكومرس نفسه بالإنجليزي وترجمته العربي' + (parent ? ' تحت ترجمة القسم الأب' : '') + '.' }),
      fields: (f, e, set, draw) => [parent ? h('p', { class: 't-small cat-parent', 'data-cat-parent': '' }, 'تحت: ', h('b', null, parent.path)) : null,
        K.two(K.field.text('en', 'اسم القسم بالإنجليزي', f, e, set, { required: true }), K.field.text('ar', 'اسم القسم بالعربي', f, e, set, { required: true })),
        slugField(f, e, set), catImageField(() => img, (v) => { img = v; draw(); }, null)],
      validate: (f) => { const e = {}; const en = catNameErr(f.en, true); const ar = catNameErr(f.ar, true); if (en) e.en = en; if (ar) e.ar = ar; const sl = slugErr(f.slug); if (sl) e.slug = sl;
        else if (f.slug && L.some((c) => c.slug === String(f.slug).trim())) e.slug = 'الـ Slug ده مستخدم في قسم تاني';
        const dup = L.find((c) => String(c.parentId || '') === String(parentId || '') && c.name.trim().toLowerCase() === String(f.en).trim().toLowerCase()); if (!e.en && dup) e.en = 'في قسم بنفس الاسم هنا'; return e; },
      submit: (f, m) => { const S0 = window.IBStudio; if (!S0 || !S0.createCategory) { K.toast(MSG.network, 'error'); return false; }
        m._busy = true;
        S0.createCategory({ name_en: f.en.trim(), name_ar: f.ar.trim(), parent: parentId ? Number(parentId) : 0, slug: String(f.slug || '').trim() || null, image: img ? img.blob : null }).then((r) => { m._busy = false;
          if (r.ok) { m.close(); if (parentId) st.catOpen.add(Number(parentId)); K.toast('اتعمل القسم «' + f.en.trim() + '» على الموقع' + (r.arId ? '' : ' — من غير الترجمة العربي (ضيفها من «تعديل»)'), r.arId ? 'success' : 'error'); R(); }
          else K.toast('القسم ماتعملش — ' + catFail(r), 'error'); });
        return false; } });
  }
  async function editCat(c) {
    const S0 = window.IBStudio; if (!S0 || !S0.categoryGet) { K.toast(MSG.network, 'error'); return; }
    if (st.busy) { K.toast(MSG.busy, 'error'); return; }
    st.busy = true; let r; try { r = await S0.categoryGet(c.id); } finally { st.busy = false; }
    if (!r.ok) { K.toast(r.reason === 'missing' ? 'القسم ده مش موجود على الموقع — هيتشال مع المزامنة الجاية' : 'ماقدرناش نجيب القسم — ' + catFail(r), 'error'); return; }
    const cur = r.category || {}; const ar = r.ar || null; const en0 = catName(cur.name || c.name); const ar0 = ar ? catName(ar.name) : '';
    const siblings = PR().categories().filter((x) => x.id !== c.id && String(x.parentId || '') === String(c.parentId || ''));
    let img = null;
    const slug0 = c.slug || '';
    K.form({ title: 'تعديل القسم «' + c.name + '»', submitLabel: 'احفظ على الموقع', values: { en: en0, ar: ar0, slug: slug0 },
      onClose: () => { if (img) URL.revokeObjectURL(img.url); },
      note: U.InlineNote({ kind: 'warning', children: 'التعديل بيتكتب على ووكومرس نفسه — القسم وترجمته العربي.' + (ar ? '' : ' القسم ده مالوش ترجمة عربي لسه: اكتب الاسم العربي وهتتعمل.') }),
      fields: (f, e, set, draw) => [K.two(K.field.text('en', 'اسم القسم بالإنجليزي', f, e, set, { required: true }), K.field.text('ar', 'اسم القسم بالعربي', f, e, set, { required: !!ar })),
        slugField(f, e, set), catImageField(() => img, (v) => { img = v; draw(); }, cur.image || null),
        cur.count != null ? h('p', { class: 't-small help', style: 'margin:0' }, 'على الموقع: ' + K.n0(cur.count) + ' منتج منشور في القسم ده.') : null],
      validate: (f) => { const e = {}; const en = catNameErr(f.en, true); const a = catNameErr(f.ar, !!ar); if (en) e.en = en; if (a) e.ar = a; const sl = slugErr(f.slug); if (sl) e.slug = sl;
        else if (f.slug && String(f.slug).trim() !== slug0 && PR().categories().some((x) => x.id !== c.id && x.slug === String(f.slug).trim())) e.slug = 'الـ Slug ده مستخدم في قسم تاني';
        if (!e.en && siblings.some((x) => x.name.trim().toLowerCase() === String(f.en).trim().toLowerCase())) e.en = 'في قسم بنفس الاسم هنا'; return e; },
      submit: (f, m) => {
        const nameEn = f.en.trim() !== en0 ? f.en.trim() : null; const nameAr = f.ar.trim() && f.ar.trim() !== ar0 ? f.ar.trim() : null; const slugNew = String(f.slug || '').trim() && String(f.slug).trim() !== slug0 ? String(f.slug).trim() : null;
        if (!nameEn && !nameAr && !img && !slugNew) { K.toast('مفيش حاجة اتغيرت', ''); return true; }
        m._busy = true;
        S0.categoryUpdate({ id: c.id, name_en: nameEn, name_ar: nameAr, slug: slugNew, image: img ? img.blob : null }).then((u) => { m._busy = false;
          if (!u.ok) { K.toast('القسم ماتعدّلش — ' + catFail(u), 'error'); return; }
          m.close();
          const arWhy = { not_linked: 'مش مربوطة بالقسم ده على الموقع', mismatch: 'الموقع رد بالقسم الإنجليزي — رجّعنا اسمه زي ما كان', none: 'مالوش ترجمة' };
          const arNote = (nameAr || img) && u.ar !== 'ok' && u.ar !== 'made' ? ' — الترجمة العربي ماتعدّلتش (' + (arWhy[u.ar] || u.ar) + ')' : '';
          K.toast('اتعدّل القسم على الموقع' + arNote, arNote ? 'error' : 'success'); R(); });
        return false; } });
  }
  function catBlocked(title, text, action) {
    const m = U.Modal({ title, body: [h('p', { class: 't-body', style: 'margin:0' }, text)], footer: [action ? Button({ label: action.label, onClick: () => { m.close(); action.run(); } }) : null, Button({ type: 'primary', label: 'تمام', onClick: () => m.close() })].filter(Boolean) });
    m.el.setAttribute('data-cat-blocked', ''); return m;
  }
  function delCat(c) {
    const M = catModel(); const n = M.sum(c.id).size; const ch = (M.kids.get(c.id) || []).length;
    if (n) { catBlocked('القسم «' + c.name + '» مايتحذفش دلوقتي', 'فيه ' + K.n0(n) + ' منتج (فيه أو في الأقسام اللي تحته) — انقلهم لقسم تاني الأول، وبعدين احذفه.', { label: 'اعرض المنتجات', run: () => catProducts(c) }); return; }
    if (ch) { catBlocked('القسم «' + c.name + '» مايتحذفش دلوقتي', 'تحته ' + subsLabel(ch) + ' — احذفهم الأول، وبعدين احذفه.'); return; }
    K.confirm({ title: 'حذف القسم «' + c.name + '» نهائي؟', text: 'القسم هيتحذف من الموقع هو وترجمته العربي. ووكومرس مالوش سلة للأقسام — مش هيرجع.', okLabel: 'احذف القسم', okType: 'danger',
      onOk: async () => {
        const S0 = window.IBStudio; if (!S0 || !S0.categoryDelete) { K.toast(MSG.network, 'error'); return; }
        if (st.busy) { K.toast(MSG.busy, 'error'); return; }
        st.busy = true; let r; try { r = await S0.categoryDelete(c.id, c.name); } finally { st.busy = false; }
        if (r.ok) { st.catOpen.delete(c.id); K.toast('اتحذف القسم «' + c.name + '» من الموقع', 'success'); R(); return; }
        if (r.reason === 'conflict') {
          const k = r.count != null ? K.n0(r.count) + ' ' : '';
          catBlocked('القسم «' + c.name + '» ماتحذفش', r.error === 'has_children' ? 'تحته ' + k + 'قسم فرعي على الموقع — احذفهم الأول.' : r.error === 'has_makers' ? 'القسم ده «فئة أساسية» لـ ' + k + 'مبتكر — شيله من بياناتهم الأول.' : 'فيه ' + k + 'منتج على الموقع (ممكن مسودات أو في المهملات) — انقلهم لقسم تاني الأول.');
          return;
        }
        K.toast('القسم ماتحذفش — ' + catFail(r), 'error');
      } });
  }
  // the category's products (in it and under it) with a bulk bar: نقل لقسم تاني (this category's branch swapped for the picked ones) ·
  // إضافة لقسم · إزالة من القسم (its branch taken off; a product left with no category is refused) · مسودة · نشر — products.bulk
  function catProducts(c) {
    const M = catModel(); const ids = M.sum(c.id); const branch = new Set(M.subtree(c.id));
    const list = all().filter((p) => ids.has(p.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (!list.length) { K.toast('مفيش منتجات في القسم ده', ''); return; }
    const C = can(); const sel = new Set(); let pq = '';
    const m = U.Modal({ title: 'منتجات «' + c.name + '» · ' + K.n0(list.length), body: [], footer: [] }); m.el.classList.add('wide'); m.el.setAttribute('data-cat-prods-pop', String(c.id));
    const inBranch = (p) => (p.categoryIds || []).filter((x) => branch.has(x)).map((x) => (M.byId.get(x) || {}).name).filter(Boolean);
    // owner batch 14 Nov decision 9: a search by the name or the SKU over the category's products
    const pqIn = h('input', { type: 'search', class: 'input cat-prods-q', placeholder: 'دوّر بالاسم أو الـ SKU…', 'aria-label': 'دوّر في منتجات القسم', 'data-cat-prods-q': '', onInput: (e) => { pq = e.target.value.trim().toLowerCase(); draw(); setTimeout(() => { pqIn.focus(); }, 0); } });
    const draw = () => {
      const shown = pq ? list.filter((p) => nameOf(p).toLowerCase().includes(pq) || String(p.sku || '').toLowerCase().includes(pq)) : list;
      const chosen = list.filter((p) => sel.has(p.id)); const allOn = shown.length > 0 && shown.every((p) => sel.has(p.id));
      const bar = chosen.length ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد', 'data-cat-bulk': '' }, h('b', null, 'محدد ' + K.n0(chosen.length)), h('span', { class: 'grow' }),
        Button({ size: 'sm', label: 'نقل لقسم تاني', onClick: () => catBulk(chosen, c, branch, 'move', m) }), Button({ size: 'sm', label: 'إضافة لقسم', onClick: () => catBulk(chosen, c, branch, 'add', m) }),
        Button({ size: 'sm', label: 'إزالة من القسم', onClick: () => catBulk(chosen, c, branch, 'remove', m) }),
        Button({ size: 'sm', label: 'تحويل لمسودة', onClick: () => { m.close(); toDraft(chosen); } }), Button({ size: 'sm', label: 'نشر', onClick: () => { m.close(); publish(chosen); } }),
        Button({ size: 'sm', label: 'إلغاء التحديد', onClick: () => { sel.clear(); draw(); } })) : null;
      const rows = shown.map((p) => [C.bulk ? K.Checkbox({ label: '', checked: sel.has(p.id), onChange: (v) => { if (v) sel.add(p.id); else sel.delete(p.id); draw(); } }) : '',
        h('span', { class: 'prod' }, Thumb(p.img), h('b', null, nameOf(p))), h('span', { dir: 'ltr', class: 't-small' }, p.sku || '—'), h('span', { class: 't-small' }, inBranch(p).join('، ') || '—'), Tag(STATUS_TONE[p.status] || 'neutral', p.status)]);
      const head = C.bulk ? K.Checkbox({ label: '', checked: allOn, onChange: (v) => { shown.forEach((p) => (v ? sel.add(p.id) : sel.delete(p.id))); draw(); } }) : '';
      m.setBody(...[pqIn, bar, !shown.length ? h('p', { class: 't-small help', 'data-cat-prods-none': '' }, 'مفيش منتج بالاسم أو الـ SKU ده') : null, C.bulk ? null : h('p', { class: 't-small help', style: 'margin:0 0 8px' }, 'التعديل الجماعي محتاج صلاحية «تعديل جماعي».'), U.Table({ cls: 'dt cat-prods', headers: [head, 'المنتج', 'SKU', 'القسم', 'الحالة'], rows })].filter(Boolean));
    };
    m.setFooter(Button({ type: 'text', label: 'افتح في السجل', onClick: () => { m.close(); clearFilters(); st.f.category = [c.path]; st.status = 'all'; go('products-records'); } }), Button({ label: 'قفل', onClick: () => m.close() }));
    draw();
  }
  function catBulk(l, c, branch, mode, m) {
    const plan = (p, targets) => { const cur = p.categoryIds || []; const kept = mode === 'add' ? cur : cur.filter((x) => !branch.has(x)); return mode === 'remove' ? kept : [...new Set(kept.concat(targets))]; };
    const run = (targets) => {
      const empty = l.filter((p) => !plan(p, targets).length);
      if (empty.length) { K.toast(names(empty) + ' ' + (empty.length === 1 ? 'مالوش' : 'مالهمش') + ' قسم غيره — استخدم «نقل لقسم تاني»', 'error'); return; }
      m.close();
      write((pg) => batch(l, (p) => { const nx = plan(p, targets); return nx.join() !== (p.categoryIds || []).join() ? { categories: nx } : {}; }, pg),
        mode === 'move' ? 'اتنقلوا للقسم الجديد' : mode === 'add' ? 'اتضافوا للقسم' : 'اتشالوا من «' + c.name + '»', null, l.length);
    };
    if (mode === 'remove') { K.confirm({ title: 'إزالة ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات') + ' من «' + c.name + '»؟', text: names(l) + ' مش هيظهروا في القسم ده ولا في الأقسام اللي تحته على الموقع.', okLabel: 'شيلهم من القسم', onOk: () => run([]) }); return; }
    const PK = window.IBCatsPicker; if (!PK) { K.toast(MSG.network, 'error'); return; }
    PK(mode === 'move' ? 'نقل ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات') + ' لقسم تاني' : 'إضافة ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات') + ' لقسم', [], (picked) => { const t = picked.map(Number).filter((x) => !(mode === 'move' && branch.has(x))); if (!t.length) { K.toast('اختار قسم على الأقل' + (mode === 'move' ? ' برّه «' + c.name + '»' : ''), 'error'); return; } run(t); }, { noNew: true });
  }
  function trashView() {
    const C = can(); const T = trashRows();
    const sel = [...st.sel].map((id) => T.find((t) => t.id === id)).filter(Boolean);
    const rows = T.map((t) => { const left = PD.trashDaysLeft(String(t.trashedAt || K.TODAY).slice(0, 10), K.TODAY);
      return [C.trash ? K.Checkbox({ label: '', checked: st.sel.has(t.id), onChange: (v) => pickRange(T.map((x) => x.id), t.id, v) }) : '', h('span', { class: 'prod' }, Thumb(t.img), h('span', null, h('b', null, nameOf(t)))), h('span', { dir: 'ltr', class: 't-small' }, t.sku || '—'), t.vendor || '—', t.trashedAt ? K.dshort(String(t.trashedAt).slice(0, 10)) : '—',
        h('span', { class: 'stk' }, K.Num(left + ' يوم'), PD.trashSoon(left) ? Tag('error', 'قرب يتمسح') : null), C.trash ? h('span', { class: 'acts-inline' }, Button({ size: 'sm', label: 'رجّعه', attrs: { 'data-restore': String(t.id) }, onClick: () => restore([t]) })) : '']; });
    return [statusChips(), U.InlineNote({ kind: 'warning', children: 'المنتجات هنا مش ظاهرة على الموقع، وووردبريس بيمسحها نهائي لوحده بعد ' + PD.TRASH_DAYS + ' يوم من نقلها للمهملات. المسح النهائي مش من السيستم.' }),
      sel.length ? h('div', { class: 'bulk-bar' }, h('b', null, 'محدد ' + K.n0(sel.length)), h('span', { class: 'grow' }), Button({ size: 'sm', label: 'رجّع كمسودة', onClick: () => restore(sel) }), Button({ size: 'sm', label: 'إلغاء التحديد', onClick: () => { st.sel.clear(); R(); } })) : null,
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, T.length ? U.Table({ cls: 'dt', headers: ['', 'المنتج', 'SKU', 'المبتكر', 'اتنقل للمهملات', 'باقي على المسح', ''], rows }) : K.Empty('المهملات فاضية', 'المنتجات اللي بتتمسح بتفضل هنا 30 يوم وتقدر ترجعها.'))),
      h('p', { class: 't-small help' }, '«رجّعه» بيرجّع المنتج كمسودة، وتنشره بعد ما تراجعه من «تعديل».')];
  }
  function openSite(url) { const u = safeSrc(url); if (!u) return; const w = window.open(u, '_blank', 'noopener,noreferrer'); if (w) w.opener = null; }

  // ---------------- actions / popups ----------------
  const names = (l) => l.slice(0, 5).map((p) => '«' + nameOf(p) + '»').join(' و') + (l.length > 5 ? ' و' + (l.length - 5) + ' كمان' : '');
  // one write at a time; the popup stays open until the site answers (a refusal keeps it open with the reason)
  // more than 25 products: a progress popup «اتعدل X من Y…» while the requests go one after the other (the owner, 28 Oct)
  async function write(run, okMsg, m, total) {
    if (st.busy) { K.toast(MSG.busy, 'error'); return false; }
    st.busy = true; let pm = null;
    const prog = (done, all) => { if (!pm) return; pm.setBody(U.ProgressBar('brand', all ? done / all : 0), h('p', { class: 't-small', style: 'margin:8px 0 0', 'data-progress': '' }, 'اتعدل ' + K.n0(done) + ' من ' + K.n0(all) + '…')); };
    if (total > 25) { if (m) m.close(); m = null; pm = U.Modal({ title: 'بنعدّل على الموقع…', body: [], footer: [] }); prog(0, total); }
    try {
      const r = await run(prog);
      if (!r.ok) { K.toast(fail(r), 'error'); return false; }
      if (r.result === 'skipped') { K.toast(MSG[r.reason] || MSG.push_disabled, 'error'); if (m) m.close(); return false; }
      const failed = r.failedIds || [];
      K.toast(failed.length ? okMsg + ' — ماتحفظش في ' + failed.length + ' منتج' : okMsg, failed.length ? 'error' : 'success');
      st.sel.clear(); if (m) m.close(); R(); return true;
    } finally { st.busy = false; if (pm) pm.close(); }
  }
  // several products → products_batch (products.bulk); one product (its row menu / its page) → product_save (products.edit)
  const batch = (l, fields, onProgress) => {
    const ups = l.map((p) => Object.assign({ id: p.id }, typeof fields === 'function' ? fields(p) : fields)).filter((u) => Object.keys(u).length > 1);
    if (ups.length === 1 && l.length === 1) { const { id, ...f } = ups[0]; return PR().save(id, { fields: f }).then((r) => Object.assign({ failedIds: [] }, r)); }
    return PR().batch(ups, onProgress);
  };
  function toDraft(l) { K.confirm({ title: 'تحويل ' + (l.length === 1 ? 'المنتج' : l.length + ' منتجات') + ' لمسودة؟', text: names(l) + ' هيختفوا من الموقع لحد ما تنشرهم تاني. الأوردرات القديمة مش هتتأثر.', okLabel: 'حوّل لمسودة', onOk: () => write((pg) => batch(l, { status: 'draft' }, pg), 'اتحولوا لمسودة على الموقع', null, l.length) }); }
  function publish(l) { K.confirm({ title: 'نشر ' + (l.length === 1 ? 'المنتج' : l.length + ' منتجات') + ' على الموقع؟', text: names(l) + ' هيظهروا للعملاء على الموقع.' + (l.some((p) => p.wooStatus === 'pending') ? ' المنتجات «قيد المراجعة» بتتوافق عليها بالنشر.' : ''), okLabel: 'انشر', onOk: () => write((pg) => batch(l, { status: 'publish' }, pg), 'اتنشر على الموقع', null, l.length) }); }
  function toTrash(l) {
    K.confirm({ title: 'مسح ' + (l.length === 1 ? 'المنتج' : l.length + ' منتجات') + '؟', text: 'هيتنقلوا لسلة المهملات في ووكومرس ويختفوا من الموقع. تقدر ترجعهم خلال ' + PD.TRASH_DAYS + ' يوم.', body: h('p', { class: 't-small help', style: 'margin:0' }, names(l)), okLabel: 'انقل للمهملات', okType: 'danger',
      onOk: () => write((pg) => PR().trashIds(l.map((p) => p.id), pg), 'اتنقلوا للمهملات', null, l.length) });
  }
  function restore(l) { write((pg) => PR().restore(l.map((p) => p.id), pg), 'رجعوا كمسودة', null, l.length); }
  // phase 12 T2 (decision 2): «تكرار كمنتج جديد» — a draft copy on the site (woo-sync product_duplicate, products.add) under a new studio SKU, then its edit page
  function duplicate(p) {
    if (!can().add) { K.toast('مش مسموحلك تضيف منتجات — اطلب صلاحية «إضافة منتجات»', 'error'); return; }
    K.confirm({ title: 'تكرار «' + nameOf(p) + '» كمنتج جديد؟', text: 'هتتعمل نسخة مسودة على الموقع بنفس البيانات والصور والأقسام والتركيبات والترجمة العربي، بـ SKU جديد من مسلسل الاستوديو، وعلى نفس المبتكر. الاسم هيبقى «' + nameOf(p) + ' (نسخة)» لحد ما تغيّره.', okLabel: 'اعمل النسخة',
      onOk: async () => {
        let made = null;
        const ok = await write(async () => { const r = await PR().duplicate(p.id); if (r.ok && r.result === 'ok') made = r; return Object.assign({ failedIds: [] }, r); }, 'اتعملت النسخة كمسودة', null, 1);
        if (ok && made && made.id) { if (made.arCode) K.toast('الترجمة العربي ماتعملتش للنسخة (' + made.arCode + ') — ضيفها من صفحة المنتج.', 'error'); go('products-edit-' + made.id); }
      } });
  }
  function moveBrand(l) {
    const brands = PR().brands().slice().sort((a, b) => a.name.localeCompare(b.name));
    K.form({ title: 'نقل ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات') + ' لبراند تاني', values: { brand: '' }, submitLabel: 'انقل المنتجات',
      note: h('p', { class: 't-small help', style: 'margin:0' }, names(l)),
      fields: (f, e, set) => [K.field.select('brand', 'البراند الجديد', brands.map((b) => ({ value: String(b.id), label: b.name })), f, e, set, { required: true, help: 'البراند اللي ظاهر على المنتج في الموقع (WooCommerce Brands).' }),
        U.InlineNote({ children: 'المتجر على Dokan (المبتكر اللي بيتحاسب على المنتج) مش بيتغير من هنا — بيفضل زي ما هو. والـ SKU والسعر كمان.' })],
      validate: (f) => K.req(f, ['brand'], { brand: 'اختار البراند' }),
      submit: (f, m) => { write((pg) => batch(l, { brands: [Number(f.brand)] }, pg), 'اتنقلوا لـ ' + ((brands.find((b) => String(b.id) === f.brand) || {}).name || 'البراند'), m, l.length); return false; } });
  }
  // bulk price (Figma 703:4632): زيادة/نقص · نسبة/قيمة · على سعر المبتكر أو نسبة إبتكر (sensitive.commission) أو الخصم الوهمي.
  // Variable products are priced per variation (their page); a product without a sale price or a visible rate is left out.
  function bulkPrice(l) {
    const C = can(); const simple = l.filter((p) => p.type !== 'Variable' && p.sale);
    if (!simple.length) { K.toast('المنتجات دي Variable أو من غير سعر — السعر بيتعدل من صفحة كل منتج', 'error'); return; }
    // decision 12: the vendor price = the sale price − Dokan's commission on it (the product's own, else the store's / category's)
    // decision 16: «سعر المبتكر» / «نسبة إبتكر» give the new maker price / rate → the sale price by priceFromVendor (the fee before the
    // division, up to the next 10) and the regular = sale + a random 15–30% (one per product, the same in the preview and the save)
    const withRate = (p) => { const c = PR().commissionParams(p); return Object.assign({}, p, { rate: c ? c.rate || 0 : null, fee: c ? c.fee : 0, vendorPrice: c ? PR().vendorPriceOf(p) : null, markup: PD.randomMarkup(), disc: p.regular && p.regular > p.sale ? Math.round((1 - p.sale / p.regular) * 100) : 0 }); };
    const items = simple.map(withRate);
    const TG = (C.commission ? [['vendor', 'سعر المبتكر'], ['rate', 'نسبة إبتكر']] : []).concat([['discount', 'الخصم الوهمي']]);
    const next = (p, o) => {
      if (o.target === 'discount') { const d = Math.min(90, Math.max(0, o.mode === 'pct' ? +(p.disc * (1 + (o.dir * o.amount) / 100)).toFixed(1) : p.disc + o.dir * o.amount)); return { sale: p.sale, regular: Math.round(p.sale / (1 - d / 100)), disc: d }; }
      if (p.rate == null || p.vendorPrice == null) return null;
      const r = PD.bulkPrice(p, o); const pr = PD.priceFromVendor(r.vendorPrice, { rate: r.rate, fee: p.fee, markup: p.markup });
      return pr ? { sale: pr.sale, regular: pr.regular, rate: r.rate, vendorPrice: r.vendorPrice } : null;
    };
    K.form({ title: 'تعديل سعر ' + (simple.length === 1 ? 'منتج' : simple.length + ' منتجات'), values: { target: TG[0][0], dir: '1', mode: 'pct', amount: '10' }, submitLabel: 'طبّق السعر',
      fields: (f, e, set, draw) => { const opt = { target: f.target, mode: f.mode, dir: Number(f.dir), amount: Number(f.amount) }; const ok = Number(f.amount) > 0;
        const rows = ok ? items.slice(0, 5).map((p) => { const r = next(p, opt); return [nameOf(p), !r ? 'مالوش نسبة ظاهرة' : f.target === 'vendor' ? K.n0(p.vendorPrice) + ' ← ' + K.n0(r.vendorPrice) : f.target === 'rate' ? p.rate + '% ← ' + r.rate + '%' : p.disc + '% ← ' + r.disc + '%', r ? K.n0(p.sale) + ' ← ' + K.n0(r.sale) : '—']; }) : [];
        const seg = (key, opts) => h('div', { class: 'chips', role: 'radiogroup' }, opts.map(([v, lab]) => chipBtn(lab, f[key] === v, () => { f[key] = v; draw(); }, { role: 'radio', 'aria-checked': String(f[key] === v) })));
        return [U.FieldShell({ id: 'bp-t', label: 'تعدّل إيه؟', required: true, help: (C.commission ? 'سعر المبتكر أو النسبة بيحسبوا سعر البيع (لفوق لأقرب 10) وقبل الخصم (+15–30% عشوائي) · النسبة والخصم بالنقط (%)' : 'الخصم الوهمي بيغيّر السعر قبل الخصم بس — سعر البيع زي ما هو') }, seg('target', TG)),
          K.two(U.FieldShell({ id: 'bp-d', label: 'زيادة ولا نقص' }, seg('dir', [['1', 'زيادة'], ['-1', 'نقص']])), U.FieldShell({ id: 'bp-m', label: 'بنسبة ولا بقيمة' }, seg('mode', [['pct', 'نسبة %'], ['value', f.target === 'vendor' ? 'قيمة (ج.م)' : 'قيمة (نقط)']]))),
          K.field.text('amount', 'المقدار', f, e, (k, v) => { set(k, v); draw(); }, { required: true, inputmode: 'numeric', help: 'مثال: 10' + (f.mode === 'pct' ? '%' : '') + ' ' + (f.dir === '1' ? 'زيادة' : 'نقص') + ' على ' + TG.find((x) => x[0] === f.target)[1] }),
          rows.length ? U.FieldShell({ id: 'bp-p', label: 'قبل ← بعد' }, U.Table({ cls: 'dt', headers: ['المنتج', TG.find((x) => x[0] === f.target)[1], 'سعر البيع'], rows })) : null,
          U.InlineNote({ children: 'هيتطبق على ' + simple.length + ' منتجات وبيتحدث على ووكومرس بعد التأكيد.' + (simple.length < l.length ? ' (' + (l.length - simple.length) + ' Variable أو من غير سعر برّه التعديل ده.)' : '') })]; },
      validate: (f) => (Number(f.amount) > 0 ? {} : { amount: 'اكتب رقم أكبر من صفر' }),
      submit: (f, m) => { const o = { target: f.target, mode: f.mode, dir: Number(f.dir), amount: Number(f.amount) };
        write((pg) => batch(items, (p) => { const r = next(p, o); return r ? { sale_price: String(r.sale), regular_price: String(r.regular) } : {}; }, pg), 'اتعدل السعر على الموقع', m, items.length); return false; } });
  }
  // bulk stock (Figma 703:4703): الكمية / زوّد-قلّل / حسب الطلب، والتنبيه 0–5 (decision 8)
  function bulkStock(l) {
    const simple = l.filter((p) => p.type !== 'Variable');
    if (!simple.length) { K.toast('مخزون المنتجات الـ Variable بيتعدل لكل تركيبة من صفحة المنتج', 'error'); return; }
    K.form({ title: 'تعديل مخزون ' + (simple.length === 1 ? 'منتج' : simple.length + ' منتجات'), values: { mode: 'set', qty: '10', alert: '3' }, submitLabel: 'احفظ المخزون',
      fields: (f, e, set, draw) => [K.Radios({ value: f.mode, onChange: (v) => { f.mode = v; draw(); }, options: [{ value: 'set', label: 'حدد الكمية' }, { value: 'add', label: 'زوّد / قلّل' }, { value: 'demand', label: 'حسب الطلب (بيتصنع بعد الأوردر)', hint: 'المنتج يفضل متاح للشراء ومدة التصنيع بتظهر للعميل.' }] }),
        f.mode !== 'demand' ? K.field.text('qty', f.mode === 'add' ? 'الزيادة (سالب للنقص)' : 'الكمية', f, e, set, { required: true, inputmode: 'numeric' }) : null,
        K.field.select('alert', 'التنبيه: نبّهني لما الكمية توصل لـ', ['0', '1', '2', '3', '4', '5'].map((x) => ({ value: x, label: x === '0' ? '0 — من غير تنبيه' : x + (x === '1' ? ' قطعة' : ' قطع') })), f, e, set, { help: 'من 0 لـ 5' }),
        simple.length < l.length ? U.InlineNote({ children: (l.length - simple.length) + ' منتج Variable برّه التعديل ده — مخزونهم لكل تركيبة.' }) : null],
      validate: (f) => (f.mode === 'demand' ? {} : !/^-?\d+$/.test(String(f.qty).trim()) || (f.mode === 'set' && Number(f.qty) < 0) ? { qty: 'اكتب رقم صحيح' } : {}),
      submit: (f, m) => { const alert = Number(f.alert);
        write((pg) => batch(simple, (p) => (f.mode === 'demand' ? { manage_stock: false, stock_status: 'onbackorder', low_stock_amount: alert }
          : { manage_stock: true, stock_quantity: Math.max(0, f.mode === 'add' ? (p.stock || 0) + Number(f.qty) : Number(f.qty)), backorders: 'no', low_stock_amount: alert }), pg), 'اتحفظ المخزون على ووكومرس', m, simple.length); return false; } });
  }
  // the owner (1 Nov): the products' maker on the site — Dokan's post_author, the studio's own way (products.bulk, like the
  // other bulk writes); the brand shown on the product, the price and the SKU stay
  function moveVendor(l, opts = {}) {
    const skip = new Set((opts.exclude || []).map(String));
    const V = window.IBVendors; const vendors = (V && V.store && V.store.all ? V.store.all() : []).filter((v) => v.wooVendorId && !skip.has(String(v.id))).sort((a, b) => a.name.localeCompare(b.name));
    if (!vendors.length) { K.toast('مفيش مبتكرين بمتجر على الموقع لسه', 'error'); return; }
    K.form({ title: 'نقل ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات') + ' لمبتكر تاني', values: { vendor: '' }, submitLabel: 'انقل المنتجات',
      note: h('p', { class: 't-small help', style: 'margin:0' }, names(l)),
      fields: (f, e, set) => [K.field.select('vendor', 'المبتكر الجديد', vendors.map((v) => ({ value: String(v.id), label: v.name })), f, e, set, { required: true, help: 'المبتكر اللي بيتحاسب على المنتج (متجره على Dokan) — المنتج وترجمته العربي بيتنقلوا.' }),
        U.InlineNote({ kind: 'warning', children: 'البراند الظاهر على المنتج والسعر والـ SKU مش بيتغيروا — المتجر بس.' })],
      validate: (f) => K.req(f, ['vendor'], { vendor: 'اختار المبتكر' }),
      submit: (f, m) => { write(() => PR().moveVendor(l.map((p) => p.id), f.vendor), 'اتنقلوا لـ ' + ((vendors.find((v) => String(v.id) === f.vendor) || {}).name || 'المبتكر'), m, l.length).then((ok) => { if (ok && opts.after) opts.after(); }); return false; } });
  }
  // phase 5.5 (the owner's prototype v2, 31 Oct): the makers page and the maker's drawer act on his products with this page's own popups
  const makerItems = (ids) => { const S = new Set((ids || []).map(String)); return PR() && PR().state() === 'ready' ? PR().list().filter((p) => p.vendorId && S.has(String(p.vendorId))) : []; };
  function copyLinks(l) {
    const text = l.map((p) => p.permalink).filter(Boolean).join('\n'); if (!text) { K.toast('المنتجات دي ملهاش رابط على الموقع لسه', 'error'); return; }
    window.__lastCopy = text; const ok = () => K.toast(l.length === 1 ? 'اتنسخ رابط المنتج' : 'اتنسخت ' + l.length + ' روابط', 'success');
    try { navigator.clipboard.writeText(text).then(ok, ok); } catch (e) { ok(); }
  }
  // the records filtered on one maker (his name, as the «المبتكر» select filters)
  function openRecords(filter) {
    if (PR()) PR().ensure();
    st.status = 'all'; st.q = ''; st.sel.clear(); st.f = { vendor: filter && filter.vendor ? [filter.vendor] : [], brand: [], category: [], stock: [], type: [] };
    go('products-records');
  }
  const makerMove = (ids, after) => { const l = makerItems(ids); if (!l.length) { K.toast((ids.length === 1 ? 'المبتكر ده ملوش' : 'المبتكرين دول ملهمش') + ' منتجات على الموقع', 'error'); return; } moveVendor(l, { exclude: ids, after }); };
  const makerPrice = (ids) => { const l = makerItems(ids); if (!l.length) { K.toast((ids.length === 1 ? 'المبتكر ده ملوش' : 'المبتكرين دول ملهمش') + ' منتجات على الموقع', 'error'); return; } bulkPrice(l); };
  // the owner (2 Nov): the maker on the product page itself — a select of the makers with a store; a change moves the product
  // (and its Arabic translation) on the site at once through products_vendor (products.bulk), after a confirmation; it is not
  // part of «احفظ على الموقع» (another permission, another write), so unsaved edits are saved first
  // phase 13 decision 52 (owner 10 Nov — «Maker + product override»): the product's own making days for the sub-order delay; empty =
  // the maker's «مدة التجهيز». Saved on its own when the field is left (IBProducts.setLeadDays), not with «احفظ على الموقع» — the
  // site does not hold it.
  const leadSt = { id: null, v: undefined, busy: false };
  function leadField(id, rec, C) {
    const V = window.IBVendors; const mk = rec && rec.vendorId && V && V.store && V.store.get ? V.store.get(rec.vendorId) : null; const makerDays = mk && mk.leadDays ? mk.leadDays : 7;
    if (leadSt.id !== String(id)) { leadSt.id = String(id); leadSt.v = undefined; PR().leadDays(id).then((v) => { if (leadSt.id === String(id)) { leadSt.v = v; R(); } }); }
    let typed = leadSt.v == null ? '' : String(leadSt.v);
    const el = U.TextInput({ id: 'e-lead', label: 'مدة التصنيع (يوم)', value: typed, inputmode: 'numeric', placeholder: 'مدة المبتكر: ' + makerDays, disabled: !C.edit || leadSt.busy || leadSt.v === undefined,
      help: C.edit ? 'للتأخير في الأوردرات: لو فاضية بتتحسب مدة المبتكر (' + makerDays + ' يوم). بتتحفظ لوحدها أول ما تسيب الخانة' : 'تعديلها محتاج صلاحية تعديل المنتجات', onInput: (v) => { typed = v; } });
    const input = el.querySelector('input');
    if (input) input.addEventListener('change', async () => {
      const raw = String(typed).trim(); const next = raw === '' ? null : Number(raw.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
      if ((next === null && leadSt.v == null) || next === leadSt.v) return;
      leadSt.busy = true; const r = await PR().setLeadDays(id, next); leadSt.busy = false;
      if (r.ok) { leadSt.v = r.days; K.toast(r.days == null ? 'رجعت لمدة المبتكر (' + makerDays + ' يوم)' : 'اتحفظت مدة التصنيع: ' + r.days + ' يوم', 'success'); }
      else K.toast(r.message || (r.reason === 'forbidden' ? 'مفيش صلاحية' : 'ماتحفظتش — جرّب تاني'), 'error');
      R();
    });
    return el;
  }
  function makerField(id, p, rec, C) {
    const V = window.IBVendors; const makers = (V && V.store && V.store.all ? V.store.all() : []).filter((v) => v.wooVendorId).sort((a, b) => a.name.localeCompare(b.name));
    const byStore = p.store && p.store.id != null ? makers.find((v) => Number(v.wooVendorId) === Number(p.store.id)) : null;
    const cur = rec && rec.vendorId && makers.some((v) => String(v.id) === String(rec.vendorId)) ? String(rec.vendorId) : byStore ? String(byStore.id) : '';
    const curName = (rec && rec.vendor) || (p.store && p.store.shop_name) || '';
    const opts = (cur ? [] : [{ value: '', label: curName || '—' }]).concat(makers.map((v) => ({ value: String(v.id), label: v.name })));
    const move = (v) => {
      const to = makers.find((m) => String(m.id) === v); if (!to) { R(); return; }
      if (dirtyCount()) { K.toast('احفظ تعديلاتك الأول وبعدين غيّر المبتكر', 'error'); R(); return; }
      K.confirm({ title: 'نقل المنتج لـ «' + to.name + '»؟', text: 'المنتج وترجمته العربي هيتنقلوا لمتجر المبتكر ده على Dokan دلوقتي. البراند الظاهر على المنتج والسعر والـ SKU مش بيتغيروا.', okLabel: 'انقل المنتج',
        onOk: async () => { const ok = await write(() => PR().moveVendor([id], v), 'اتنقل لـ ' + to.name, null, 1); if (ok) { st.live = null; st.liveFor = null; fetchLive(id); } R(); } });
      R(); // the select shows the current maker until the move is confirmed and done
    };
    return U.Select({ id: 'e-maker', label: 'المبتكر (متجر Dokan)', options: opts, value: cur, disabled: !C.bulk || st.saving || !makers.length,
      help: C.bulk ? 'تغييره بينقل المنتج على الموقع فورًا' : 'نقل المنتج لمبتكر تاني محتاج صلاحية التعديل الجماعي', onChange: (v) => { if (v && v !== cur) move(v); } });
  }
  // the owner (1 Nov): the categories picked on the site's tree (the studio's picker — a search box, the branches with +/−, a
  // child ticks its parents), several at once; add / replace / remove
  function changeCat(l) {
    const cats = PR().categories(); const pathOf = (id) => ((cats.find((c) => c.id === Number(id)) || {}).path || String(id));
    let chosen = [];
    K.form({ title: 'تغيير قسم ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات'), values: { mode: 'add' }, submitLabel: 'غيّر القسم', wide: true,
      fields: (f, e, set, draw) => [U.FieldShell({ id: 'cc-cats', label: 'الأقسام', required: true, error: e.cats, help: 'اكتب اسم القسم في البحث وهيظهر مع شجرته — علّم اللي عايزه، والفرعي بيعلّم اللي فوقه لوحده.' },
          h('div', { class: 'chips', 'data-cc-chosen': '' }, chosen.map((id) => h('span', { class: 'chip', title: pathOf(id) }, pathOf(id))),
            Button({ size: 'sm', label: chosen.length ? 'عدّل الأقسام' : 'اختار الأقسام من الشجرة', attrs: { 'data-cc-pick': '' }, onClick: () => { const PK = window.IBCatsPicker; if (!PK) { K.toast(MSG.network, 'error'); return; } PK('أقسام ' + (l.length === 1 ? nameOf(l[0]) : l.length + ' منتجات'), chosen, (ids) => { chosen = ids.map(Number); delete e.cats; draw(); }, { noNew: true }); } }))), // B4: no «+ قسم جديد» here
        K.Radios({ value: f.mode, onChange: (v) => { f.mode = v; draw(); }, options: [{ value: 'add', label: 'ضيفها جنب الأقسام الحالية', hint: 'المنتج هيظهر في كلهم' }, { value: 'replace', label: 'بدّل الأقسام الحالية بيها' }, { value: 'remove', label: 'شيلها من المنتجات' }] })],
      validate: () => (chosen.length ? {} : { cats: 'اختار قسم على الأقل' }),
      submit: (f, m) => { const ids = chosen.slice();
        write((pg) => batch(l, (p) => { const cur = p.categoryIds; const nx = f.mode === 'replace' ? ids : f.mode === 'remove' ? cur.filter((x) => !ids.includes(x)) : [...new Set(cur.concat(ids))]; return nx.length && nx.join() !== cur.join() ? { categories: nx } : {}; }, pg), 'اتغير القسم', m, l.length); return false; } });
  }

  // ---------------- edit (the product live from the site) ----------------
  function fetchLive(id) {
    if (st.loadingLive) return;
    st.loadingLive = true; st.liveErr = '';
    PR().fetchLive(id).then((r) => {
      st.loadingLive = false;
      if (st.editId !== id) return;
      if (!r.ok) { st.liveErr = fail(r); } else { st.live = r; st.liveFor = id; st.draft = toDraft_(r); resetCalc(); }
      if (window.IBPages.current === 'products' && st.view === 'edit') R();
    });
  }
  const s = (v) => (v == null ? '' : String(v));
  function toDraft_(r) {
    const p = r.product; const ar = r.ar || {};
    return { name: p.name, sku: p.sku, status: p.status, featured: p.featured, weight: p.weight, regular: p.regular_price, sale: p.sale_price, manage: p.manage_stock, qty: s(p.stock_quantity),
      onDemand: p.stock_status === 'onbackorder' || (p.manage_stock && p.backorders && p.backorders !== 'no'), alert: s(p.low_stock_amount), cats: p.categories.map((c) => c.id), brands: p.brands.map((b) => b.id),
      images: p.images.map((i) => i.id), short: p.short_description, desc: p.description, arName: s(ar.name), arShort: s(ar.short_description), arDesc: s(ar.description),
      seoTitle: s(p.seo_title), seoDesc: s(p.seo_description), arSeoTitle: s(ar.seo_title), arSeoDesc: s(ar.seo_description),
      vars: r.variations.map((v) => ({ id: v.id, regular: v.regular_price, sale: v.sale_price, qty: s(v.stock_quantity), onDemand: v.stock_status === 'onbackorder' || (v.manage_stock && v.backorders && v.backorders !== 'no') })) };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // the changes of the draft against the product as it was read → { fields, ar, variations } (only what changed)
  function changes() {
    const d = st.draft, o = toDraft_(st.live); const fields = {}; const ar = {}; const variations = [];
    if (d.name !== o.name) fields.name = d.name.trim();
    if (d.sku !== o.sku) fields.sku = d.sku.trim();
    if (d.status !== o.status) fields.status = d.status;
    if (d.featured !== o.featured) fields.featured = d.featured;
    if (d.weight !== o.weight) fields.weight = d.weight.trim();
    if (d.regular !== o.regular) fields.regular_price = d.regular.trim();
    if (d.sale !== o.sale) fields.sale_price = d.sale.trim();
    if (d.onDemand !== o.onDemand || (!d.onDemand && (d.qty !== o.qty || d.manage !== o.manage))) {
      if (d.onDemand) Object.assign(fields, { manage_stock: false, stock_status: 'onbackorder' });
      else if (d.manage) Object.assign(fields, { manage_stock: true, stock_quantity: Number(d.qty) || 0, backorders: 'no' });
      else Object.assign(fields, { manage_stock: false, stock_status: 'instock' });
    }
    if (d.alert !== o.alert) fields.low_stock_amount = d.alert === '' ? null : Number(d.alert);
    if (!same(d.cats, o.cats)) fields.categories = d.cats.slice();
    if (!same(d.brands, o.brands)) fields.brands = d.brands.slice();
    if (!same(d.images, o.images)) fields.images = d.images.slice();
    if (d.short !== o.short) fields.short_description = d.short;
    if (d.desc !== o.desc) fields.description = d.desc;
    if (d.arName !== o.arName) ar.name = d.arName.trim();
    if (d.arShort !== o.arShort) ar.short_description = d.arShort;
    if (d.arDesc !== o.arDesc) ar.description = d.arDesc;
    if (d.seoTitle !== o.seoTitle) fields.seo_title = d.seoTitle.trim();
    if (d.seoDesc !== o.seoDesc) fields.seo_description = d.seoDesc.trim();
    if (d.arSeoTitle !== o.arSeoTitle) ar.seo_title = d.arSeoTitle.trim();
    if (d.arSeoDesc !== o.arSeoDesc) ar.seo_description = d.arSeoDesc.trim();
    d.vars.forEach((v, i) => { const w = o.vars[i]; if (!w || same(v, w)) return; const x = { id: v.id };
      if (v.regular !== w.regular) x.regular_price = v.regular.trim(); if (v.sale !== w.sale) x.sale_price = v.sale.trim();
      if (v.onDemand !== w.onDemand || v.qty !== w.qty) Object.assign(x, v.onDemand ? { manage_stock: false, stock_status: 'onbackorder' } : { manage_stock: true, stock_quantity: Number(v.qty) || 0, backorders: 'no' });
      variations.push(x); });
    return { fields, ar, variations };
  }
  const dirtyCount = () => { if (!st.draft || !st.live) return 0; const c = changes(); return Object.keys(c.fields).length + Object.keys(c.ar).length + c.variations.length; };
  const NUM = /^\s*\d+(\.\d{1,2})?\s*$/;
  function checkDraft() {
    const d = st.draft; const e = {};
    if (!d.name.trim()) e.name = 'الاسم مطلوب';
    if (/[<>]/.test(d.name) || /[<>]/.test(d.arName)) e.name = 'الاسم مايكونش فيه < أو >';
    if (d.regular.trim() && !NUM.test(d.regular)) e.regular = 'اكتب رقم';
    if (d.sale.trim() && !NUM.test(d.sale)) e.sale = 'اكتب رقم';
    if (!e.regular && !e.sale && d.sale.trim() && d.regular.trim() && Number(d.sale) > Number(d.regular)) e.sale = 'سعر البيع أكبر من السعر قبل الخصم';
    if (!d.onDemand && d.manage && !/^\s*\d+\s*$/.test(d.qty)) e.qty = 'اكتب رقم صحيح';
    if (d.weight.trim() && !/^\s*\d{1,5}(\.\d{1,3})?\s*$/.test(d.weight)) e.weight = 'اكتب الوزن بالكيلو (رقم)';
    // phase 5.1: SEO is plain text (the server refuses < >), at most 200 / 500 characters, and only the Rank Math
    // variables of SEO_VARS in _shared/woo-products.js: with those taken out, a `%` must be followed by a space or end the text
    const SEO_VARS = ['title', 'sep', 'sitename', 'sitedesc', 'excerpt', 'primary_category', 'category', 'wc_price', 'wc_sku', 'wc_brand', 'currentyear', 'currentmonth'];
    const varRe = new RegExp('%(?:' + SEO_VARS.join('|') + ')%', 'g');
    for (const [k, max] of [['seoTitle', 200], ['seoDesc', 500], ['arSeoTitle', 200], ['arSeoDesc', 500]]) {
      const bad = /%\S+/.exec(d[k].replace(varRe, ' '));
      if (/[<>]/.test(d[k])) e[k] = 'من غير < أو >'; else if (d[k].trim().length > max) e[k] = 'أطول من ' + max + ' حرف';
      else if (bad) e[k] = '«' + bad[0] + '» مش مسموح: بعد % لازم مسافة، والمتغيرات المسموحة بس ' + SEO_VARS.map((v) => '%' + v + '%').join(' ');
    }
    return e;
  }
  async function save() {
    const errs = checkDraft(); st.errs = errs;
    if (Object.keys(errs).length) { K.toast('صحّح الحقول اللي عليها علامة', 'error'); R(); return; }
    const c = changes(); if (!Object.keys(c.fields).length && !Object.keys(c.ar).length && !c.variations.length) { K.toast('مافيش تعديلات'); return; }
    if (st.saving) return; st.saving = true; R();
    const r = await PR().save(st.editId, c);
    st.saving = false;
    if (!r.ok) { K.toast(fail(r), 'error'); R(); return; }
    if (r.result === 'skipped') { K.toast(MSG[r.reason] || MSG.push_disabled, 'error'); R(); return; }
    K.toast(r.counts && r.counts.variations_failed ? 'اتحفظ — بس ' + r.counts.variations_failed + ' تركيبة ماتحفظتش' : 'اتحفظ على الموقع', r.counts && r.counts.variations_failed ? 'error' : 'success');
    st.live = null; st.draft = null; st.liveFor = null; st.errs = {}; fetchLive(st.editId); R();
  }
  const discard = () => { st.draft = toDraft_(st.live); st.errs = {}; resetCalc(); R(); };
  // the Arabic translation on another status than the product (a translation added after the product was published, as the
  // live 182053 / 182057 on 31 Oct): a note and one button that writes the product's status to both (the save writes the
  // shared fields on the translation too; the product itself does not change)
  function arStatusNote(p, dis) {
    const ar = st.live.ar; if (!ar || !ar.status || ar.status === p.status) return null;
    const label = (s) => window.IBProducts.STATUS[s] || s;
    const align = async () => {
      if (st.saving) return; st.saving = true; R();
      const r = await PR().save(st.editId, { fields: { status: p.status } });
      st.saving = false;
      if (!r.ok) { K.toast(fail(r), 'error'); R(); return; }
      if (r.result === 'skipped') { K.toast(MSG[r.reason] || MSG.push_disabled, 'error'); R(); return; }
      K.toast('النسخة العربي بقت «' + label(p.status) + '»', 'success');
      st.live = null; st.draft = null; st.liveFor = null; fetchLive(st.editId); R();
    };
    return U.InlineNote({ kind: 'warning', children: [h('span', null, 'النسخة العربي «' + label(ar.status) + '» والإنجليزي «' + label(p.status) + '». '),
      dis ? null : Button({ type: 'text', size: 'sm', label: st.saving ? 'بنحفظ…' : 'خلّي العربي «' + label(p.status) + '» كمان', disabled: st.saving, attrs: { 'data-par-status': '' }, onClick: align })] });
  }
  // decision 16 (the owner, 28 Oct): the maker's price is typed for the calculation only (never stored) → the sale price =
  // (maker + fee) ÷ (1 − rate) up to the next 10, the regular («قبل الخصم», shown crossed) = sale + 15–30% at random up to the
  // next 10. One random markup per product / variation while the page is open, so pressing «احسب» again gives the same prices.
  function resetCalc() { st.vin = ''; st.vinErr = ''; st.vvin = {}; st.marks = {}; }
  const digits = (v) => String(v == null ? '' : v).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٬,]/g, '').trim();
  function fromVendor(params, val, key) {
    const t = digits(val); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    st.marks = st.marks || {}; if (st.marks[key] == null) st.marks[key] = PD.randomMarkup();
    return PD.priceFromVendor(Number(t), { rate: params.rate || 0, fee: params.fee || 0, markup: st.marks[key] });
  }
  const paramsLabel = (c) => (c.source === 'product' ? 'عمولة المنتج' : c.source === 'category' ? 'نسبة القسم' : 'نسبة المتجر') + (c.rate != null ? ' ' + c.rate + '%' : '') + (c.fee ? ' + ' + K.n0(c.fee) + ' ج.م' : '');
  const calcHelp = (c) => 'سعر البيع = (سعر المبتكر' + (c.fee ? ' + ' + K.n0(c.fee) : '') + ') ÷ ' + (c.rate ? (1 - c.rate / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : '1') + ' لفوق لأقرب 10 · قبل الخصم = سعر البيع + 15–30% · ' + paramsLabel(c);
  function editView() {
    const id = st.editId; const C = can(); const rec = byId(id);
    const back = Button({ type: 'text', size: 'sm', label: '→ رجوع للسجل', onClick: () => leaveGuard(() => go('products-records')) });
    if (!st.live || st.liveFor !== id) {
      if (!st.loadingLive && !st.liveErr) fetchLive(id);
      return [back, st.liveErr ? K.Empty('مقدرناش نفتح المنتج', st.liveErr, Button({ size: 'sm', label: 'جرّب تاني', onClick: () => { st.liveErr = ''; R(); } })) : U.InlineNote({ children: 'بنجيب المنتج من الموقع…' })];
    }
    const p = st.live.product; const d = st.draft; const errs = st.errs || {}; const dis = !C.edit;
    const mark = (redraw) => { const n = dirtyCount(); const b = document.querySelector('#pg-products .unsaved b'); if (b && !redraw) b.textContent = 'عندك ' + n + ' تعديلات مش محفوظة'; else R(); };
    const inp = (idk, label, key, o = {}) => U.TextInput(Object.assign({ id: 'e-' + idk, label, value: d[key], error: errs[key], disabled: dis, onInput: (v) => { const was = dirtyCount(); d[key] = v; mark(!was !== !dirtyCount()); } }, o));
    const area = (idk, label, key, rows) => U.Textarea({ id: 'e-' + idk, label, value: d[key], rows, help: 'تاجات تنسيق بس (p، strong، ul/li…) ولينكات https — أي حاجة تانية بتترفض.', onInput: (v) => { if (dis) return; const was = dirtyCount(); d[key] = v; mark(!was !== !dirtyCount()); } });
    const status = rec ? rec.status : (window.IBProducts.STATUS[p.status] || p.status);
    const meta = h('div', { class: 'meta' }, h('span', { dir: 'ltr', class: 't-small' }, p.sku || '—'), h('span', { class: 't-small help' }, '· ' + ((rec && rec.vendor) || (p.store && p.store.shop_name) || '—')), Tag(STATUS_TONE[status] || 'neutral', status),
      p.modified ? h('span', { class: 't-small help' }, 'آخر تعديل على الموقع ' + K.dshort(p.modified.slice(0, 10))) : null);
    const acts = [p.permalink ? Button({ label: 'افتح على الموقع', icon: 'link', onClick: () => openSite(p.permalink) }) : null,
      rec ? K.RowMenu([{ label: 'تكرار كمنتج جديد', icon: 'copy', run: () => duplicate(rec) }, C.edit ? { label: 'نقل لبراند تاني', icon: 'tag', run: () => moveBrand([rec]) } : null,
        C.edit ? (p.status === 'publish' ? { label: 'تحويل لمسودة', icon: 'eyeoff', run: () => toDraft([rec]) } : { label: 'نشر', icon: 'eye', run: () => publish([rec]) }) : null,
        C.trash ? { label: 'مسح', icon: 'trash', danger: true, run: () => toTrash([rec]) } : null], 'إجراءات المنتج') : null,
      C.edit ? Button({ type: 'primary', label: st.saving ? 'بنحفظ…' : 'احفظ على الموقع', disabled: st.saving, attrs: { 'data-psave': '' }, onClick: save }) : null];
    const firstImg = (p.images[0] || {}).src;
    const head = h('div', { class: 'page-head row edit-head' }, h('div', { class: 'eh-l' }, Thumb(firstImg, 'lg2'), h('div', null, back, h('h1', { class: 't-h3' }, [p.name, d.arName].filter(Boolean).join(' · ')), meta)), h('div', { class: 'actions' }, acts));
    const tabs = K.MainTabs({ items: ETABS.filter(([k]) => k !== 'variants' || p.type === 'variable').map(([k, label]) => ({ id: k, label })), active: st.etab, onChange: (k) => { st.etab = k; setHash('products-edit-' + id + '-' + k); R(); }, label: 'أقسام المنتج' });
    let body;
    if (st.etab === 'data') body = h('div', { class: 'side-layout' }, Card('البيانات الأساسية', null, [K.two(inp('en', 'الاسم (EN)', 'name', { required: true }), st.live.ar ? inp('ar', 'الاسم (AR)', 'arName') : U.InlineNote({ children: 'المنتج ده ملوش ترجمة عربي على الموقع.' })),
      K.two(inp('sku', 'SKU', 'sku', { help: 'تغيير الـ SKU بيغيّر الباركود واللينكات القديمة.' }), inp('w', 'الوزن (كجم)', 'weight', { inputmode: 'decimal' })),
      K.two(U.Select({ id: 'e-brand', label: 'البراند', options: [{ value: '', label: '—' }].concat(PR().brands().map((b) => ({ value: String(b.id), label: b.name }))), value: d.brands[0] != null ? String(d.brands[0]) : '', disabled: dis, help: 'براند WooCommerce الظاهر على المنتج', onChange: (v) => { d.brands = v ? [Number(v)] : []; R(); } }),
        makerField(id, p, rec, C)),
      K.two(U.TextInput({ id: 'e-type', label: 'النوع', value: p.type === 'variable' ? 'Variable' : p.type === 'simple' ? 'Simple' : p.type, disabled: true, onInput: () => {}, help: 'النوع بيتغير من الاستوديو بس' }), leadField(id, rec, C))], null, 'grow'),
      h('div', { class: 'stack side-card' }, Card('الحالة والظهور', null, [U.Select({ id: 'e-status', label: 'الحالة', options: [{ value: 'publish', label: 'منشور' }, { value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'قيد المراجعة' }].concat(['publish', 'draft', 'pending'].includes(p.status) ? [] : [{ value: p.status, label: status }]), value: d.status, disabled: dis, onChange: (v) => { d.status = v; R(); } }),
        K.Switch({ id: 'e-feat', label: 'منتج مميز', checked: d.featured, disabled: dis, onChange: (v) => { d.featured = v; R(); } }),
        arStatusNote(p, dis)]), priceCard(p, inp, dis, rec)));
    else if (st.etab === 'price') body = priceCard(p, inp, dis, rec);
    else if (st.etab === 'images') body = imagesCard(p, dis);
    else if (st.etab === 'variants') body = variantsCard(dis, rec);
    else if (st.etab === 'cats') body = catsCard(dis);
    else if (st.etab === 'desc') body = h('div', { class: 'stack' }, Card('الأوصاف (EN)', null, [area('short', 'وصف قصير', 'short', 4), area('desc', 'الوصف', 'desc', 8)]), st.live.ar ? Card('الأوصاف (AR)', null, [area('ars', 'وصف قصير (AR)', 'arShort', 4), area('ard', 'الوصف (AR)', 'arDesc', 8)]) : null,
      window.IBAI && window.IBAI.can().write ? h('div', null, Button({ size: 'sm', icon: 'sparkle', label: 'اكتب بالذكاء الاصطناعي', attrs: { 'data-pai': '' }, onClick: () => leaveGuard(() => go('products-tool-content-' + id)) })) : null);
    else body = seoCard(p, dis);
    const n = dirtyCount();
    return [head, tabs, body, n && C.edit ? h('div', { class: 'unsaved', role: 'status' }, h('b', null, 'عندك ' + n + ' تعديلات مش محفوظة'), Button({ type: 'text', size: 'sm', label: 'تجاهل', onClick: discard }), Button({ type: 'primary', size: 'sm', label: 'احفظ على الموقع', disabled: st.saving, onClick: save })) : null];
  }
  // phase 5.1 (prototype 1793199492, the «SEO» tab): Rank Math's page title / description for each language — empty = Rank
  // Math's default template; a counter against the lengths Google shows (about 60 / 160) and a search-result preview
  function seoCard(p, dis) {
    const d = st.draft; const errs = st.errs || {};
    const count = (v, ideal) => { const n = v.trim().length; return n + ' / ' + ideal + ' حرف' + (n > ideal ? ' — جوجل هيقص الباقي' : '') + ' · فاضي = قالب Rank Math الافتراضي'; };
    const field = (idk, label, key, ideal, area) => {
      const o = { id: 'e-' + idk, label, value: d[key], error: errs[key], disabled: dis, help: count(d[key], ideal),
        onInput: (v) => { if (dis) return; const was = dirtyCount(); d[key] = v; const el = document.getElementById('e-' + idk); const hp = el && el.closest('.field').querySelector('.help'); if (hp) hp.textContent = count(v, ideal); const pv = document.querySelector('[data-seo-prev="' + key + '"]'); if (pv) pv.textContent = v.trim() || pv.dataset.fallback; if (!was !== !dirtyCount()) R(); else { const b = document.querySelector('#pg-products .unsaved b'); if (b) b.textContent = 'عندك ' + dirtyCount() + ' تعديلات مش محفوظة'; } } };
      return area ? U.Textarea(Object.assign(o, { rows: 3 })) : U.TextInput(o);
    };
    const preview = (titleKey, descKey, name, url) => h('div', { class: 'seo-prev', 'aria-label': 'شكلها في جوجل' },
      h('small', { dir: 'ltr', class: 't-small help' }, url || ''), h('b', { 'data-seo-prev': titleKey, 'data-fallback': name }, d[titleKey].trim() || name),
      h('span', { class: 't-small', 'data-seo-prev': descKey, 'data-fallback': '—' }, d[descKey].trim() || '—'));
    return h('div', { class: 'stack' },
      Card('SEO (EN)', 'عنوان ووصف صفحة المنتج في نتايج البحث (Rank Math).', [field('seo-t', 'عنوان الصفحة', 'seoTitle', 60), field('seo-d', 'وصف الصفحة', 'seoDesc', 160, true), preview('seoTitle', 'seoDesc', p.name, p.permalink)]),
      st.live.ar ? Card('SEO (AR)', null, [field('seo-at', 'عنوان الصفحة (AR)', 'arSeoTitle', 60), field('seo-ad', 'وصف الصفحة (AR)', 'arSeoDesc', 160, true), preview('arSeoTitle', 'arSeoDesc', d.arName || p.name, '')]) : U.InlineNote({ children: 'المنتج ده ملوش ترجمة عربي على الموقع.' }));
  }
  function priceCard(p, inp, dis, rec) {
    const d = st.draft; const C = can();
    if (p.type === 'variable') return Card('السعر والمخزون', null, [U.InlineNote({ children: 'السعر والمخزون بيتعدلوا لكل تركيبة من تاب «المتغيرات».' })]);
    // decision 12: Dokan's commission on this sale price (the product's own, else the store's / category's) — the vendor price is what is left
    const sale = Number(d.sale || d.regular) || 0; const cm = rec && sale ? PR().commissionOf(Object.assign({}, rec, { sale })) : null; const vp = cm ? Math.round((sale - cm.amount) * 100) / 100 : null;
    const src = cm ? (cm.source === 'product' ? 'عمولة المنتج' : cm.source === 'category' ? 'نسبة القسم' : 'نسبة المتجر') + (cm.rate != null ? ' ' + cm.rate + '%' : '') + (cm.fee ? ' + ' + K.n0(cm.fee) : '') : '';
    const stockState = d.onDemand ? 'حسب الطلب' : d.manage ? PD.stockState(Number(d.qty) || 0, false, d.alert === '' ? 3 : Number(d.alert)) : 'متاح';
    const params = C.commission && rec && !dis ? PR().commissionParams(rec) : null;
    const calc = params ? h('div', { class: 'vcalc', 'data-vcalc': '' }, K.two(U.TextInput({ id: 'e-vin', label: 'سعر المبتكر (للحساب)', value: st.vin || '', inputmode: 'decimal', error: st.vinErr, help: calcHelp(params), onInput: (v) => { st.vin = v; } }),
      h('div', { class: 'field' }, h('span', { class: 'flabel' }, ' '), Button({ label: 'احسب السعرين', attrs: { 'data-vapply': '' }, onClick: () => {
        const r = fromVendor(params, st.vin, 'p'); if (!r) { st.vinErr = 'اكتب سعر المبتكر رقم أكبر من صفر'; R(); return; }
        st.vinErr = ''; d.sale = String(r.sale); d.regular = String(r.regular); R(); } })))) : null;
    return Card('السعر والمخزون', null, [K.two(inp('sale', 'سعر البيع', 'sale', { inputmode: 'numeric' }), inp('reg', 'قبل الخصم', 'regular', { inputmode: 'numeric' })), calc,
      C.commission && vp != null ? K.two(h('div', { class: 'field', 'data-vprice': '' }, h('span', { class: 'flabel' }, 'سعر المبتكر'), h('b', null, K.Num(K.n0(vp) + ' ج.م'))), h('div', { class: 'field', 'data-commission': '' }, h('span', { class: 'flabel' }, 'عمولة إبتكر (' + src + ')'), h('b', { class: 'brand-t' }, K.Num(K.n0(cm.amount) + ' ج.م')))) : null,
      K.Switch({ id: 'e-dem', label: 'حسب الطلب (بيتصنع بعد الأوردر)', checked: d.onDemand, disabled: dis, onChange: (v) => { d.onDemand = v; R(); } }),
      d.onDemand ? null : K.Switch({ id: 'e-man', label: 'تتبع الكمية', checked: d.manage, disabled: dis, onChange: (v) => { d.manage = v; R(); } }),
      !d.onDemand && d.manage ? K.two(inp('stk', 'المخزون', 'qty', { inputmode: 'numeric' }), U.Select({ id: 'e-al', label: 'نبّهني تحت', options: [{ value: '', label: 'افتراضي الموقع' }].concat(['0', '1', '2', '3', '4', '5'].map((x) => ({ value: x, label: x }))), value: d.alert, disabled: dis, onChange: (v) => { d.alert = v; R(); } })) : null,
      h('div', { class: 'stk' }, h('span', { class: 't-small help' }, 'حالة المخزون:'), Tag(STOCK_TONE[stockState], stockState))]);
  }
  function imagesCard(p, dis) {
    const d = st.draft; const imgs = d.images.map((iid) => p.images.find((i) => i.id === iid)).filter(Boolean);
    const sel = st.imgSel != null && st.imgSel < imgs.length ? st.imgSel : null;
    const ai = !dis && window.IBImages && window.IBImages.can().tool ? Button({ size: 'sm', icon: 'sparkle', label: 'ولّد صور بالذكاء الاصطناعي', attrs: { 'data-pimg': '' }, onClick: () => leaveGuard(() => go('products-tool-images-' + p.id)) }) : null;
    return Card('صور المنتج', 'أول صورة هي الرئيسية. الترتيب والشيل بيتحفظوا على الموقع؛ صور جديدة من أداة الصور (بالـ AI) أو مع الاستوديو.', [ai ? h('div', null, ai) : null, h('div', { class: 'img-grid' }, imgs.map((im, i) => h('button', { type: 'button', class: 'img-it' + (sel === i ? ' on' : ''), 'aria-pressed': String(sel === i), onClick: () => { st.imgSel = sel === i ? null : i; R(); } }, Thumb(im.src, 'xl'), i === 0 ? Tag('brand', 'رئيسية') : null, h('figcaption', { dir: 'ltr' }, im.name || ('#' + im.id))))),
      !imgs.length ? K.Empty('مفيش صور', 'اعمل صور بأداة الصور (بالـ AI) أو ارفعها مع استوديو المنتجات.') : null,
      sel != null && !dis ? h('div', { class: 'sel-acts' }, h('b', null, 'الصورة ' + (sel + 1) + ' محددة:'), sel ? Button({ size: 'sm', label: 'خليها الرئيسية', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.unshift(x); st.imgSel = 0; R(); } }) : null,
        sel ? Button({ size: 'sm', label: '→ قدّم', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.splice(sel - 1, 0, x); st.imgSel = sel - 1; R(); } }) : null,
        sel < imgs.length - 1 ? Button({ size: 'sm', label: 'أخّر ←', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.splice(sel + 1, 0, x); st.imgSel = sel + 1; R(); } }) : null,
        Button({ type: 'danger', size: 'sm', label: 'شيلها', onClick: () => { d.images.splice(sel, 1); st.imgSel = null; R(); } })) : null]);
  }
  function variantsCard(dis, rec) {
    const d = st.draft; const vs = st.live.variations;
    if (!vs.length) return Card('التركيبات', null, [K.Empty('مفيش تركيبات', 'إضافة تركيبات مع الاستوديو.')]);
    // decision 16: a maker price per variation (for the calculation only) → its sale and regular prices; the placeholder is the
    // maker price the variation's sale price gives now (read-only, decision 12)
    const params = can().commission && rec && !dis ? PR().commissionParams(rec) : null; st.vvin = st.vvin || {};
    const nowVp = (v) => { const sale = Number(v.sale || v.regular); return params && sale ? K.n0(Math.round((sale - (sale * (params.rate || 0) / 100 + params.fee)) * 100) / 100) : ''; };
    const applyAll = () => { let n = 0, bad = 0; d.vars.forEach((v) => { const raw = st.vvin[v.id]; if (!raw || !String(raw).trim()) return; const r = fromVendor(params, raw, 'v' + v.id); if (!r) { bad++; return; } v.sale = String(r.sale); v.regular = String(r.regular); n++; });
      if (bad) K.toast(bad + ' تركيبة سعر المبتكر بتاعها مش رقم صحيح', 'error'); else if (!n) K.toast('اكتب سعر المبتكر قدام التركيبات الأول', 'error'); R(); };
    const rows = d.vars.map((v, i) => { const lv = vs[i]; const ss = v.onDemand ? 'حسب الطلب' : PD.stockState(Number(v.qty) || 0, false, 3);
      const upd = (k) => (x) => { const was = dirtyCount(); v[k] = x; if (!was !== !dirtyCount()) R(); else { const b = document.querySelector('#pg-products .unsaved b'); if (b) b.textContent = 'عندك ' + dirtyCount() + ' تعديلات مش محفوظة'; } };
      const vin = params ? [U.TextInput({ id: 'vv-v' + i, label: '', value: st.vvin[v.id] || '', placeholder: nowVp(v), inputmode: 'decimal', onInput: (x) => { st.vvin[v.id] = x; } })] : [];
      return [lv.attributes.map((a) => a.option).join(' · ') || '—', h('span', { dir: 'ltr', class: 't-small' }, lv.sku || '—')].concat(vin, [U.TextInput({ id: 'vv-r' + i, label: '', value: v.regular, inputmode: 'numeric', disabled: dis, onInput: upd('regular') }), U.TextInput({ id: 'vv-s' + i, label: '', value: v.sale, inputmode: 'numeric', disabled: dis, onInput: upd('sale') }),
        v.onDemand ? '—' : U.TextInput({ id: 'vv-q' + i, label: '', value: v.qty, inputmode: 'numeric', disabled: dis, onInput: upd('qty') }), K.Switch({ id: 'vv-d' + i, label: 'حسب الطلب', checked: v.onDemand, disabled: dis, onChange: (x) => { v.onDemand = x; R(); } }), Tag(STOCK_TONE[ss], ss)]); });
    const headers = ['التركيبة', 'SKU'].concat(params ? ['سعر المبتكر'] : [], ['قبل الخصم', 'سعر البيع', 'المخزون', 'حسب الطلب', 'الحالة']);
    return h('div', { class: 'stack' }, Card('التركيبات (' + vs.length + ')', 'السعر والمخزون بيتحدثوا على ووكومرس أول ما تحفظ. إضافة أو شيل تركيبة مع الاستوديو.', [
      params ? h('div', { class: 'vcalc', 'data-vcalc': '' }, h('p', { class: 't-small help', style: 'margin:0' }, 'اكتب سعر المبتكر قدام التركيبة (الرقم الرمادي = سعره دلوقتي) ودوس «احسب». ' + calcHelp(params)), Button({ size: 'sm', label: 'احسب الأسعار من سعر المبتكر', attrs: { 'data-vapply': '' }, onClick: applyAll })) : null,
      U.Table({ cls: 'dt', headers, rows })]));
  }
  function catsCard(dis) {
    const d = st.draft; const cats = PR().categories(); const on = new Set(d.cats);
    const chosen = cats.filter((c) => on.has(c.id));
    return Card('الأقسام', 'تقدر تختار أكتر من قسم — المنتج بيظهر في كلهم.', [h('div', { class: 'chips', role: 'group', 'aria-label': 'الأقسام المختارة' }, chosen.length ? chosen.map((c) => chipBtn(c.path + (dis ? '' : ' ×'), true, () => { if (dis) return; d.cats = d.cats.filter((x) => x !== c.id); R(); })) : h('span', { class: 'help' }, 'مفيش أقسام')),
      dis ? null : U.Select({ id: 'e-addcat', label: 'ضيف قسم', options: cats.filter((c) => !on.has(c.id)).map((c) => ({ value: String(c.id), label: c.path })), value: '', placeholder: 'اختار قسم…', onChange: (v) => { if (v) { d.cats = d.cats.concat(Number(v)); R(); } } })]);
  }
  // leaving an edit with unsaved changes asks first (the prototype's guard)
  function leaveGuard(proceed) {
    if (st.view !== 'edit' || !dirtyCount() || !document.querySelector('#pg-products:not([hidden])')) { proceed(); return; }
    const m = U.Modal({ title: 'عندك ' + dirtyCount() + ' تعديلات مش محفوظة', body: [h('p', { style: 'margin:0' }, 'لو خرجت دلوقتي التعديلات دي هتضيع. تحب تعمل إيه؟')],
      footer: [Button({ type: 'primary', label: 'ارجع للتعديل', onClick: () => m.close() }), Button({ type: 'danger', label: 'اخرج من غير حفظ', attrs: { 'data-leave': '' }, onClick: () => { m.close(); discard(); proceed(); } })] });
  }

  // ---------------- view ----------------
  const fresh = () => { const P = PR(); return U.FreshnessNote(P && P.state() === 'loading' ? 'بنحمّل المنتجات…' : 'متزامن مع ووكومرس — التعديل بيتكتب على الموقع مباشرة'); };
  // ---------------- «التقارير» (decision 20: the prototype's products reports on real data) ----------------
  // The best sellers and the categories come from our orders in the range (products_report, 0022 — not «ملغي» / «استرجاع» / «فشل»);
  // out of stock from the mirror (product level: the variations are not mirrored). The range is the reports page's (block 28).
  // phase 5.5 decision 5 (owner 1 Nov): «تخصيص التقارير» — the member picks up to 8 cards from the list; shown on two rows (4 + 4); saved per member (user_prefs products.kpis)
  const KPI_MAX = 8, KPI_DEF = ['sold', 'distinct', 'out', 'topcat'], KPI_PREF = 'products.kpis';
  const kpiPicked = () => { const p = window.IBPrefs && window.IBPrefs.get(KPI_PREF); return Array.isArray(p) && p.length ? p.filter((x) => KPIS.some((k) => k.id === x)) : KPI_DEF.slice(); };
  const sumBy = (l, key, val) => { const m = {}; l.forEach((x) => { m[x[key]] = (m[x[key]] || 0) + (Number(x[val]) || 0); }); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
  const KPIS = [
    { id: 'sold', group: 'المبيعات في الفترة', label: 'قطع اتباعت', hint: 'عدد القطع في الفترة (من غير الملغي والمسترجع)', calc: (c) => ({ value: K.n0(c.rep.qty), unit: 'قطعة', note: 'من ' + K.n0(c.rep.orders) + ' أوردر في الفترة · من غير الملغي والمسترجع', details: c.rep.top.length ? () => ({ title: 'قطع اتباعت — ' + K.n0(c.rep.qty), sub: 'أعلى 20 منتج في الفترة', headers: c.topH, rows: c.topRowsTxt }) : null }) },
    { id: 'distinct', group: 'المبيعات في الفترة', label: 'منتجات اتباعت', hint: 'كام منتج مختلف اتباع', calc: (c) => ({ value: K.n0(c.rep.distinct), unit: 'منتج', note: 'إيراد ' + money(c.rep.revenue) }) },
    { id: 'revenue', group: 'المبيعات في الفترة', label: 'إيراد المنتجات', hint: 'إجمالي قيمة القطع اللي اتباعت', calc: (c) => ({ value: K.n0(c.rep.revenue), unit: 'ج.م', note: 'من ' + K.n0(c.rep.qty) + ' قطعة' }) },
    { id: 'avg', group: 'المبيعات في الفترة', label: 'متوسط سعر القطعة', hint: 'الإيراد ÷ القطع', calc: (c) => ({ value: c.rep.qty ? K.n0(c.rep.revenue / c.rep.qty) : '—', unit: 'ج.م', note: 'في الفترة' }) },
    { id: 'topprod', group: 'المبيعات في الفترة', label: 'أكتر منتج مبيعًا', hint: 'المنتج رقم 1 بعدد القطع', calc: (c) => { const t = c.rep.top[0]; return { value: t ? t.name : '—', note: t ? K.n0(t.qty) + ' قطعة · ' + money(t.revenue) : 'مفيش مبيعات' }; } },
    { id: 'topvendor', group: 'المبيعات في الفترة', label: 'أكتر مبتكر مبيعًا', hint: 'المبتكر بأعلى إيراد في الفترة (من أعلى 20 منتج)', calc: (c) => { const v = sumBy(c.rep.top, 'vendor', 'revenue'); return { value: v[0] ? v[0][0] || '—' : '—', note: v[0] ? money(v[0][1]) + ' من أعلى 20 منتج' : 'مفيش مبيعات' }; } },
    { id: 'topcat', group: 'المبيعات في الفترة', label: 'أكتر قسم مبيعًا', hint: 'من أوردراتنا في الفترة', calc: (c) => ({ value: c.cats[0] ? c.cats[0].name : '—', note: c.cats[0] ? [K.n0(c.cats[0].sold) + ' قطعة · ', h('span', { class: 'num' }, c.pct(c.cats[0].share)), ' من القطع'] : 'مفيش مبيعات في الفترة' }) },
    { id: 'out', group: 'المخزون', label: 'منتجات نفد مخزونها', hint: 'المنتج كله خلص («حسب الطلب» مش محسوب)', calc: (c) => ({ value: K.n0(c.out.length), unit: 'منتج', note: '«حسب الطلب» مش محسوب', details: c.out.length ? () => ({ title: 'منتجات نفد مخزونها', sub: 'من كتالوج ووكومرس', headers: c.outH, rows: c.outRowsTxt }) : null }) },
    { id: 'low', group: 'المخزون', label: 'مخزون قليل', hint: 'لسه متاح بس 3 قطع أو أقل', calc: (c) => { const l = c.prods.filter((p) => !p.onDemand && p.stock != null && p.stock > 0 && p.stock <= 3); return { value: K.n0(l.length), unit: 'منتج', note: '3 قطع أو أقل · محتاج تعيد الطلب', details: l.length ? () => ({ title: 'مخزون قليل — ' + l.length, sub: 'من كتالوج ووكومرس', headers: ['المنتج', 'SKU', 'المبتكر', 'المخزون', 'مرات الشراء'], rows: l.map((p) => [nameOf(p), p.sku, p.vendor || '—', String(p.stock), String(p.sales)]) }) : null }; } },
    { id: 'ondemand', group: 'المخزون', label: 'حسب الطلب', hint: 'منتجات بتتصنع بعد الأوردر', calc: (c) => { const l = c.prods.filter((p) => p.onDemand); return { value: K.n0(l.length), unit: 'منتج', note: 'من ' + K.n0(c.prods.length) + ' منتج' }; } },
    { id: 'published', group: 'الكتالوج', label: 'منتجات منشورة', hint: 'ظاهرة على الموقع دلوقتي', calc: (c) => ({ value: K.n0(c.prods.filter((p) => p.wooStatus === 'publish').length), unit: 'منتج', note: 'من ' + K.n0(c.prods.length) + ' في الكتالوج' }) },
    { id: 'drafts', group: 'الكتالوج', label: 'مسودات', hint: 'مش منشورة لسه', calc: (c) => { const l = c.prods.filter((p) => p.wooStatus === 'draft'); return { value: K.n0(l.length), unit: 'منتج', note: 'محتاجة مراجعة ونشر', details: l.length ? () => ({ title: 'مسودات — ' + l.length, sub: 'من كتالوج ووكومرس', headers: ['المنتج', 'SKU', 'المبتكر'], rows: l.map((p) => [nameOf(p), p.sku, p.vendor || '—']) }) : null }; } },
    { id: 'never', group: 'الكتالوج', label: 'ما اتباعتش ولا مرة', hint: 'منتجات مرات شرائها صفر', calc: (c) => { const l = c.prods.filter((p) => !p.sales); return { value: K.n0(l.length), unit: 'منتج', note: 'فرصة للتسويق أو المراجعة', details: l.length ? () => ({ title: 'ما اتباعتش ولا مرة — ' + l.length, sub: 'من كتالوج ووكومرس', headers: ['المنتج', 'SKU', 'المبتكر', 'الحالة'], rows: l.map((p) => [nameOf(p), p.sku, p.vendor || '—', p.status || '—']) }) : null }; } },
    { id: 'bestever', group: 'الكتالوج', label: 'الأكثر مبيعًا على الإطلاق', hint: 'بعدد مرات الشراء من البداية', calc: (c) => { const l = c.prods.slice().sort((x, y) => y.sales - x.sales); return { value: l[0] ? nameOf(l[0]) : '—', note: l[0] ? K.n0(l[0].sales) + ' مرة شراء' : '' }; } },
  ];
  function kpiPicker(ctx, done) {
    const cur = kpiPicked(); const sel = cur.slice(); const pv = {}; KPIS.forEach((k) => { try { const v = k.calc(ctx); pv[k.id] = (typeof v.value === 'string' ? v.value : String(v.value)) + (v.unit ? ' ' + v.unit : ''); } catch (e) { /* no preview */ } });
    let m = null;
    const draw = () => { const full = sel.length >= KPI_MAX; const groups = [...new Set(KPIS.map((k) => k.group))];
      m.setBody(h('div', { class: 'kpi-pick', 'data-kpi-pick': '' },
        h('p', { class: 't-small help', style: 'margin:0' }, 'اختار لحد ' + KPI_MAX + ' كروت — بتتعرض على سطرين بالترتيب اللي بتختاره. ', h('b', { 'data-kpi-count': String(sel.length) }, 'مختار ' + sel.length + ' من ' + KPI_MAX)),
        groups.map((g) => h('fieldset', { class: 'blk' }, h('legend', null, g), h('div', { class: 'kpi-pick-grid' }, KPIS.filter((k) => k.group === g).map((k) => { const on = sel.includes(k.id); const dis = !on && full;
          return h('button', { type: 'button', role: 'checkbox', class: 'kpi-opt' + (on ? ' on' : ''), 'aria-checked': String(on), 'data-kpi': k.id, disabled: dis || null, onClick: () => { const i = sel.indexOf(k.id); if (i > -1) sel.splice(i, 1); else if (sel.length < KPI_MAX) sel.push(k.id); draw(); } },
            h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), h('span', { class: 'kpi-opt-t' }, h('b', null, k.label, on ? h('small', { class: 'kpi-ord' }, ' #' + (sel.indexOf(k.id) + 1)) : null), h('span', { class: 't-small help' }, k.hint)), h('span', { class: 'kpi-opt-v' }, pv[k.id] || '')); }))))));
    };
    m = U.Modal({ title: 'تخصيص تقارير المنتجات', body: [], footer: [] }); m.el.classList.add('wide');
    m.setFooter(Button({ type: 'text', label: 'رجوع للافتراضي', attrs: { 'data-kpi-reset': '' }, onClick: () => { sel.splice(0, sel.length, ...KPI_DEF); draw(); } }), h('span', { class: 'grow' }), Button({ label: 'إلغاء', onClick: () => m.close() }),
      Button({ type: 'primary', label: 'احفظ', attrs: { 'data-kpi-save': '' }, onClick: () => { if (!sel.length) { K.toast('اختار كارت واحد على الأقل', 'error'); return; } if (window.IBPrefs) window.IBPrefs.set(KPI_PREF, sel.slice()); m.close(); K.toast('اتحفظ — ' + sel.length + ' كروت', 'success'); done(); } }));
    draw();
  }
  // phase 9 (docs/superpowers/plans/2026-11-05-phase-9-reports.md, decision 7): the reports page's «تقارير المنتجات» tab draws these same
  // blocks — one source. reportBody(redraw) → { blocks, ctx (the KPI picker's, once the report is in), exp (the CSV of the best sellers) };
  // redraw = what «جرّب تاني» redraws (this page's R, or the reports page)
  function reportBody(redraw) {
    const P = PR(); const RB = window.IBReportBlocks;
    const rg = RB ? RB.get() : null; const from = rg ? rg.from : null; const to = rg ? rg.to : null;
    const rep = from ? P.report(from, to) : null;
    if (!rep) {
      const failed = from && P.reportFailed(from, to);
      return { blocks: [failed ? K.Empty('مقدرناش نحسب التقارير', 'في مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', onClick: () => { P.reportRetry(from, to); (redraw || R)(); } })) : U.InlineNote({ children: 'بنحسب التقارير…' })], ctx: null, exp: null };
    }
    const out = PD.outOfStock(all()); const cats = PD.categoriesRank(rep.cats); const catTop = cats.slice(0, 15);
    const per = 'الفترة: ' + K.dlabel(from) + ' – ' + K.dlabel(to); // the period on the big tables' line (2026-11-13-table-head.md)
    const openRec = (id, label) => (id ? h('button', { type: 'button', class: 'link-btn', onClick: () => go('products-edit-' + id + '-data') }, label) : label);
    const sku = (x, n) => h('span', { dir: 'ltr', class: 't-small' }, x + (n > 1 ? ' +' + (n - 1) : ''));
    const topH = ['#', 'المنتج', 'SKU', 'المبتكر', 'القطع', 'الأوردرات', 'الإيراد'];
    const topRows = rep.top.map((x, i) => [K.n0(i + 1), openRec(x.id, x.name), sku(x.sku, x.skuCount), x.vendor, K.n0(x.qty), K.n0(x.orders), money(x.revenue)]);
    const outH = ['المنتج', 'SKU', 'المبتكر', 'الحالة', 'مرات الشراء'];
    const outRows = out.map((p) => [openRec(p.id, nameOf(p)), sku(p.sku || '—', 1), p.vendor || '—', Tag(STATUS_TONE[p.status] || 'neutral', p.status), K.n0(p.sales)]);
    const catH = ['#', 'القسم', 'القطع المباعة', 'النسبة', 'الإيراد', 'الأوردرات', 'المنتجات'];
    const pct = (v) => Math.round(v * 1000) / 10 + '%';
    const catRows = catTop.map((c) => [K.n0(c.rank), c.name, K.n0(c.sold), pct(c.share), money(c.revenue), K.n0(c.orders), K.n0(c.products)]);
    const byStatus = [...out.reduce((m, p) => m.set(p.status, (m.get(p.status) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
    const maxC = catTop.length ? catTop[0].sold || 1 : 1;
    const kpiCtx = { rep, out, cats, pct, prods: all(), topH, outH, topRowsTxt: rep.top.map((x, i) => [K.n0(i + 1), x.name, x.sku, x.vendor, K.n0(x.qty), K.n0(x.orders), money(x.revenue)]), outRowsTxt: out.map((p) => [nameOf(p), p.sku || '—', p.vendor || '—', p.status, K.n0(p.sales)]) };
    const picked = kpiPicked();
    const exp = { label: 'المنتجات الأكثر مبيعًا', headers: topH, rows: rep.top.map((x, i) => [i + 1, x.name, x.sku, x.vendor, x.qty, x.orders, x.revenue]) };
    return { ctx: kpiCtx, exp, blocks: [
      h('div', { class: 'cards', 'data-rgroup': 'kpis', 'data-prod-kpis': String(picked.length) }, picked.map((id) => { const k = KPIS.find((x) => x.id === id); let v; try { v = k.calc(kpiCtx); } catch (e) { v = { value: '—' }; }
        return U.KpiTile({ label: k.label, value: typeof v.value === 'string' ? v.value : String(v.value), unit: v.unit, compare: 'off', note: v.note, details: v.details || null }); })),
      Card('المنتجات الأكثر مبيعًا — أعلى 20', '', rep.top.length ? U.Table({ cls: 'dt rp-top', headers: topH, rows: topRows }) : K.Empty('مفيش مبيعات في الفترة دي', 'غيّر الفترة من فوق.'), null, null, { when: per, noun: ['منتج', 'المنتجات'] }),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        U.ChartCard({ title: 'الأقسام الأكثر مبيعًا', subtitle: 'القطع المباعة · أعلى 10', footnote: 'المنتج اللي في أكتر من قسم بيتحسب في كل قسم · الأقسام اللي ليها نفس الاسم اتجمعت', body: catTop.length ? h('div', { class: 'bars' }, catTop.slice(0, 10).map((c, i) => U.BarRow({ tone: i === 0 ? 'brand' : i < 3 ? 'gold' : 'neutral', label: c.name, value: K.n0(c.sold), pct: c.sold / maxC }))) : K.Empty('مفيش مبيعات', 'غيّر الفترة من فوق.') }),
        U.ChartCard({ title: 'المخزون اللي خلص', subtitle: K.n0(out.length) + ' منتج حسب الحالة', footnote: '«حسب الطلب» مش بيتحسب نفد · التركيبات لوحدها مش ظاهرة هنا (المنتج بيظهر لما كل تركيباته تخلص)', body: out.length ? h('div', { class: 'bars' }, byStatus.map(([k, n], i) => U.BarRow({ tone: i === 0 ? 'brand' : 'gold', label: k, value: K.n0(n), pct: n / out.length }))) : K.Empty('كله متاح', 'مفيش منتج نفد مخزونه.') })),
      Card('منتجات نفد مخزونها', '', out.length ? U.Table({ cls: 'dt rp-out', headers: outH, rows: outRows }) : K.Empty('كله متاح', 'مفيش منتج نفد مخزونه دلوقتي.'), null, null, { noun: ['منتج', 'المنتجات'] }),
      Card('الأقسام الأكثر مبيعًا', '', catTop.length ? U.Table({ cls: 'dt rp-cats', headers: catH, rows: catRows }) : K.Empty('مفيش مبيعات في الفترة دي', 'غيّر الفترة من فوق.'), null, null, { when: per, noun: ['قسم', 'الأقسام'], count: [catTop.length, cats.length] }),
      h('p', { class: 'source t-small help' }, 'المصدر: أوردراتنا (الأوردر بتاريخه بتوقيت القاهرة، والسطر على الترجمة العربية بيتحسب على المنتج الإنجليزي) · كتالوج ووكومرس للمخزون.')] };
  }
  // decision 62: «نظرة عامة» — the catalog now (products, published, drafts / pending, out of stock and still published) and, in the
  // reports period, the best sellers and the best categories (the reports tab's own numbers: products_report)
  function overviewView() {
    const P = PR(); const L = all(); const RB = window.IBReportBlocks; const rg = RB ? RB.get() : null;
    const AR = { publish: 'منشور', draft: 'مسودة', pending: 'قيد المراجعة' }; const by = (k) => L.filter((p) => p.status === AR[k]).length;
    const rep = rg && rg.from ? P.report(rg.from, rg.to) : null;
    const failed = rg && rg.from && !rep && P.reportFailed(rg.from, rg.to);
    const openRec = (id, label) => (id ? h('button', { type: 'button', class: 'link-btn', onClick: () => go('products-edit-' + id + '-data') }, label) : label);
    const wait = () => (failed ? K.Empty('مقدرناش نحسب المبيعات', 'في مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', onClick: () => { P.reportRetry(rg.from, rg.to); R(); } })) : U.InlineNote({ children: 'بنحسب المبيعات…' })); // one per card
    const cats = rep ? PD.categoriesRank(rep.cats).slice(0, 10) : [];
    // a top-10 list: no automatic filter / sort / columns button in its header (the kit leaves an own-filter / data-no-cols card alone)
    const small = (el) => { el.classList.add('own-filter'); el.setAttribute('data-no-cols', ''); return el; };
    return [
      h('div', { class: 'toolbar pr-rep-bar' }, RB ? RB.range() : null, h('span', { class: 't-small help' }, 'الفترة للأكثر مبيعًا — زي صفحة التقارير')),
      h('div', { class: 'cards', 'data-prod-ov': '' },
        U.KpiTile({ label: 'المنتجات', value: K.n0(L.length), unit: 'منتج', compare: 'off', note: 'في السجل (من غير المهملات)' }),
        U.KpiTile({ label: 'منشور', value: K.n0(by('publish')), unit: 'منتج', compare: 'off', note: 'ظاهر على الموقع' }),
        U.KpiTile({ label: 'مسودة / قيد المراجعة', value: K.n0(by('draft') + by('pending')), unit: 'منتج', compare: 'off', note: 'مش ظاهر لسه' }),
        null), // B3 (the owner, 11 Nov — «… ستوكه … ملوش لازمة»): no out-of-stock tile or table here
      // B3 (the owner, 11 Nov — «صغر ال width … جدولين جمب بعض»): the two tables side by side on a wide screen, narrower (no SKU)
      h('div', { class: 'pr-ov-two', 'data-ov-two': '' },
        small(Card('المنتجات الأكثر مبيعًا — أعلى 10', rep ? K.n0(Math.min(10, rep.top.length)) + ' منتج' : '', !rep ? wait() : rep.top.length ? U.Table({ cls: 'dt ov-top', headers: ['#', 'المنتج', 'المبتكر', 'القطع', 'الإيراد'], rows: rep.top.slice(0, 10).map((x, i) => [K.n0(i + 1), openRec(x.id, x.name), x.vendor, K.n0(x.qty), money(x.revenue)]) }) : K.Empty('مفيش مبيعات في الفترة دي', 'غيّر الفترة من فوق.'))),
        small(Card('الأقسام الأكثر مبيعًا — أعلى 10', rep ? K.n0(cats.length) + ' قسم' : '', !rep ? wait() : cats.length ? U.Table({ cls: 'dt ov-cats', headers: ['#', 'القسم', 'القطع المباعة', 'الإيراد', 'الأوردرات'], rows: cats.map((c) => [K.n0(c.rank), c.name, K.n0(c.sold), money(c.revenue), K.n0(c.orders)]) }) : K.Empty('مفيش مبيعات في الفترة دي', 'غيّر الفترة من فوق.')))),
      h('p', { class: 'source t-small help' }, 'المصدر: مرآة كتالوج ووكومرس للحالة · أوردراتنا في الفترة للأكثر مبيعًا.')];
  }
  // decision 62: «سجل الحركة» — who changed which product: edits, bulk edits, trash / restore, duplicates, new products from the studio,
  // images, making days, new categories (IBProducts.loadLog — activity_log under its RLS)
  const LOG_LABEL = { 'product.save': 'تعديل منتج', 'product.bulk': 'تعديل جماعي', 'product.trash': 'نقل للمهملات', 'product.restore': 'رجوع من المهملات', 'product.duplicate': 'تكرار كمنتج جديد', 'product.create': 'منتج جديد (الاستوديو)', 'product.images.add': 'إضافة صور', 'product.lead': 'مدة التصنيع', 'product.category.create': 'قسم جديد', 'product.category.update': 'تعديل قسم', 'product.category.delete': 'حذف قسم' };
  // B3 (the owner, 11 Nov — «سجل الحركة … ال ui مش مظبوط»): the card like the other tables — its title and count, a dropdown per filter
  // (the move · by whom, several picks each, «اعرض N حركة») and «تحديث» in its header, the table under it
  let logAsked = false; st.logF = st.logF || { kind: [], by: [] };
  function logView() {
    const P = PR();
    if (!logAsked && P.loadLog) { logAsked = true; P.loadLog().then(() => { if (window.IBPages.current === 'products' && st.view === 'log') R(); }); }
    const raw = P.log ? P.log() : null; const all0 = raw || [];
    const who = (e) => e.actor || '—';
    const pass = (f) => (e) => (!f.kind.length || f.kind.includes(e.action)) && (!f.by.length || f.by.includes(who(e)));
    const rows = all0.filter(pass(st.logF));
    const kinds = Object.keys(LOG_LABEL).filter((k) => all0.some((e) => e.action === k)).map((k) => [k, LOG_LABEL[k]]);
    const people = [...new Set(all0.map(who))].sort((a, b) => a.localeCompare(b, 'ar')).map((x) => [x, x]);
    const logFilter = K.FilterMenu({ id: 'plog', label: 'فلتر سجل الحركة', noun: 'حركة', value: st.logF, groups: [{ key: 'kind', label: 'الحركة', options: kinds }, { key: 'by', label: 'بواسطة', options: people }],
      count: (d) => all0.filter(pass(Object.assign({ kind: [], by: [] }, d))).length, onApply: (d) => { st.logF = Object.assign({ kind: [], by: [] }, d); R(); } }); // the owner 12 Nov: one «فلتر»
    const when = (iso) => { try { return new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso || '').slice(0, 16); } };
    const body = raw == null ? U.InlineNote({ children: 'بنحمّل سجل الحركة…' }) : rows.length ? U.Table({ cls: 'dt plog', headers: ['الوقت', 'الحركة', 'المنتجات / التفاصيل', 'بواسطة'], rows: rows.map((e) => [when(e.at), h('span', { 'data-plog-row': e.action }, LOG_LABEL[e.action] || e.action), e.productId ? h('button', { type: 'button', class: 'link-btn', onClick: () => go('products-edit-' + e.productId + '-data') }, e.text || '#' + e.productId) : e.text || '—', who(e)]) })
      : K.Empty(all0.length ? 'مفيش حركات بالفلاتر دي' : 'لسه مفيش حركات', all0.length ? 'غيّر الفلاتر من فوق.' : 'التعديل والمهملات والتكرار والصور ومدة التصنيع بيتسجلوا هنا.');
    const actions = h('span', { class: 'acts-inline' }, logFilter,
      Button({ type: 'text', size: 'sm', icon: 'refresh', label: 'تحديث', attrs: { 'data-plog-refresh': '' }, onClick: () => { logAsked = false; R(); } }));
    return [K.TableSection({ title: 'سجل الحركة', sub: raw == null ? '' : K.n0(rows.length) + ' من ' + K.n0(all0.length) + ' حركة', actions, body, cls: 'own-filter plog-card' }),
      h('p', { class: 'source t-small help' }, 'المصدر: سجل النشاط — أرقام المنتجات وأسماء الحقول بس · آخر 200 حركة (الأدمن بيشوف الكل، والباقي حركاتهم).')];
  }
  function reportsView() {
    const RB = window.IBReportBlocks; const rg = RB ? RB.get() : null;
    const body = reportBody(R);
    const bar = h('div', { class: 'toolbar pr-rep-bar' }, RB ? RB.range() : null, Button({ size: 'sm', icon: 'sliders', label: 'تخصيص التقارير', attrs: { 'data-prod-kpi-custom': '' }, disabled: !(rg && rg.from), onClick: () => { if (body.ctx) kpiPicker(body.ctx, R); else K.toast('استنى التقارير تتحسب الأول', 'error'); } }), h('span', { class: 't-small help grow' }, 'الأكثر مبيعًا والأقسام من أوردراتنا في الفترة (من غير الملغي والمسترجع والفاشل) · المخزون من كتالوج ووكومرس دلوقتي.'));
    return [bar].concat(body.blocks);
  }
  // the reports page's tab (phase 9): the same blocks once the mirror is in; the picker is this page's (user_prefs products.kpis)
  function reportBlocks(redraw) {
    const P = PR(); if (!P || !can().view) return { blocks: [K.Empty('مش مسموحلك تشوف المنتجات', 'اطلب صلاحية «المنتجات» من الأدمن.')], ctx: null, exp: null };
    P.ensure();
    if (P.state() === 'error') return { blocks: [K.Empty('مقدرناش نحمّل المنتجات', 'في مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', onClick: () => { P.load(); if (redraw) redraw(); } }))], ctx: null, exp: null };
    if (P.state() !== 'ready') return { blocks: [U.InlineNote({ children: 'بنحمّل المنتجات…' })], ctx: null, exp: null };
    return reportBody(redraw);
  }
  // phase 13 decision 62 (owner 11 Nov — «نظرة عامة وسجل الحركة وسجل المنتجات بدل السجل ٤،١٥٢، وإضافة بعد نظرة عامة وسجل الحركة قبل التقارير»)
  const TAB_HASH = { overview: 'products-overview', add: 'products-add', records: 'products-records', cats: 'products-cats', log: 'products-log', reports: 'products-reports' };
  const mainTabs = () => K.MainTabs({ items: [{ id: 'overview', label: 'نظرة عامة' }, { id: 'add', label: 'إضافة' }, { id: 'records', label: 'سجل المنتجات' }, { id: 'cats', label: 'الأقسام · ' + K.n0(PR() ? PR().categories().length : 0) }, { id: 'log', label: 'سجل الحركة' }, { id: 'reports', label: 'التقارير' }], active: st.tab, onChange: (id) => go(TAB_HASH[id] || 'products-records'), label: 'أقسام المنتجات' });
  function view() {
    const P = PR(); const C = can();
    // decision 3: the page needs products.view (orders.view reads the mirror for the orders screen only)
    if (!P || !C.view) return [K.PageHead('المنتجات', null, null), K.Empty('مش مسموحلك تشوف المنتجات', 'اطلب صلاحية «المنتجات» من الأدمن.')];
    P.ensure();
    if (st.view === 'edit') return editView();
    if (st.view === 'studio' && window.IBStudioView) return window.IBStudioView.view(K.PageHead('المنتجات', null, null));
    if (st.view === 'tool-content' && window.IBContentView) return window.IBContentView.view();
    if (st.view === 'tool-images' && window.IBImagesView) return window.IBImagesView.view();
    // «تخصيص اللوحة» (phase 10 decision 22, as in the v5 prototype): the log, the additions and the trash; the reports tab has its own
    const custom = st.view !== 'reports'; const pkey = 'products:' + st.view;
    const head = K.PageHead('المنتجات', 'عدّل المنتجات اللي على الموقع. البيانات والصور متخزنة على ووكومرس.', [custom && K.PanelButton ? K.PanelButton(pkey, 'المنتجات — ' + (st.view === 'add' ? 'الإضافة' : st.view === 'cats' ? 'الأقسام' : st.view === 'overview' ? 'نظرة عامة' : st.view === 'log' ? 'سجل الحركة' : st.view === 'trash' ? 'المحذوفات' : 'السجل'), () => document.querySelector('#pg-products .panel'), R) : null, Button({ type: 'brand', label: '+ دفعة منتجات جديدة', onClick: startStudio })]);
    head.firstChild.append(fresh());
    let body;
    if (P.state() === 'error') body = [K.Empty('مقدرناش نحمّل المنتجات', 'في مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', onClick: () => P.load() }))];
    else if (P.state() !== 'ready' && st.view !== 'add') body = [U.InlineNote({ children: 'بنحمّل المنتجات…' })];
    else body = st.view === 'add' ? addView() : st.view === 'trash' ? trashView() : st.view === 'reports' ? reportsView() : st.view === 'cats' ? catsView() : st.view === 'overview' ? overviewView() : st.view === 'log' ? logView() : recordsView();
    const panel = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...body.filter(Boolean));
    if (custom && K.applyPanelPrefs) setTimeout(() => K.applyPanelPrefs(pkey, panel), 0);
    return [head, mainTabs(), panel];
  }
  document.addEventListener('ib:products', () => { if (window.IBPages.current === 'products' && st.view !== 'edit') R(); });
  // a deep link opened before the sign-in finished: draw again once the permissions are known
  document.addEventListener('ib:directory', () => { if (window.IBPages.current === 'products') R(); });

  window.IBPages.register('products', { title: 'المنتجات', hash: (hs) => route(hs), defaultHash, view, canLeave: (proceed) => leaveGuard(proceed), api: { st, go, ensure: () => { if (PR()) PR().ensure(); }, ready: () => !!PR() && PR().state() === 'ready', makerItems, openRecords, openEdit: (id) => go('products-edit-' + id), copyLinks, reportBlocks, kpiPicker, bulkPrice, makerPrice, makerMove, toDraft, publish, toTrash, moveBrand, moveVendor, thumb: (p) => Thumb(p.img) } });
})();
