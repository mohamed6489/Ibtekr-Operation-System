/* «المنتجات» (phase 5, plan docs/superpowers/plans/2026-10-28-phase-5-products.md) — built from the prototype's block 18 (artifact
   1793131460: Figma 626:10792 «السجل» 660:611, trash 661:850, edit 669:3477…) on the site's real products. The list is the sync's
   mirror (IBProducts); the edit page reads the product live from WooCommerce (product_get) and every change goes back through
   woo-sync (IBProducts.save / batch / trashIds / restore — the server checks products.edit / products.trash and WOO_PUSH_ENABLED).
   Out of this stage (decisions 2 / 7 / 10): the studio, the AI tools, the reports tab, duplicating, new products, uploading images
   and deleting for good. The prototype's IBCrumbs / IBQuick / PanelButton / IBReportBlocks do not exist here: «رجوع للسجل». */
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
  const MSG = { forbidden: 'مش مسموحلك تعمل ده', invalid: 'في قيمة مش مقبولة', no_translation: 'المنتج ده ملوش ترجمة عربي على الموقع', woo_down: 'الموقع مش بيرد دلوقتي — جرّب كمان شوية',
    network: 'في مشكلة في الاتصال — جرّب تاني', push_disabled: 'الكتابة على الموقع مقفولة دلوقتي — مافيش حاجة اتغيرت', busy: 'استنى العملية اللي قبلها تخلص' };
  const FIELD = { name: 'الاسم', sku: 'SKU', status: 'الحالة', regular_price: 'السعر قبل الخصم', sale_price: 'سعر البيع', stock_quantity: 'المخزون', low_stock_amount: 'التنبيه', weight: 'الوزن',
    short_description: 'الوصف القصير', description: 'الوصف', categories: 'الأقسام', brands: 'البراند', images: 'الصور' };
  const fail = (r) => {
    if (r.reason === 'invalid' && r.field) { const f = String(r.field).replace(/^(ar|variations)\./, ''); return MSG.invalid + ': ' + (FIELD[f] || f) + (r.error === 'sale_above_regular' ? ' (سعر البيع أكبر من السعر قبل الخصم)' : ''); }
    return MSG[r.reason] || MSG.network;
  };

  // ---------------- state ----------------
  const st = { tab: 'records', view: 'records', status: 'all', q: '', f: { vendor: '', brand: '', category: '', stock: '', type: '' }, missingOnly: false, sort: '', sel: new Set(), pageN: 0,
    editId: null, etab: 'data', live: null, draft: null, liveFor: null, loadingLive: false, liveErr: '', saving: false, imgSel: null, busy: false };
  const can = () => (PR() ? PR().can() : { view: false, edit: false, trash: false, commission: false });

  // ---------------- routing ----------------
  const ETABS = [['data', 'البيانات'], ['price', 'السعر والمخزون'], ['images', 'الصور'], ['variants', 'المتغيرات'], ['cats', 'الأقسام'], ['desc', 'الأوصاف'], ['seo', 'SEO']];
  function route(hs) {
    let m;
    if (hs === 'products-reports') { st.view = 'reports'; st.tab = 'reports'; return true; }
    if ((m = /^products(?:-(add|records|trash))?$/.exec(hs))) { st.view = m[1] === 'trash' ? 'trash' : m[1] === 'add' ? 'add' : 'records'; st.tab = st.view === 'add' ? 'add' : 'records'; if (st.view === 'trash') st.status = 'trash'; else if (st.status === 'trash') st.status = 'all'; return true; }
    if ((m = /^products-edit-(\d+)(?:-(data|price|images|variants|cats|desc|seo))?$/.exec(hs))) { st.view = 'edit'; st.tab = 'records'; const id = Number(m[1]); if (id !== st.editId) { st.editId = id; st.live = null; st.draft = null; st.liveFor = null; st.imgSel = null; } st.etab = m[2] || 'data'; return true; }
    return false;
  }
  const defaultHash = () => ({ add: 'products-add', records: 'products-records', reports: 'products-reports', trash: 'products-trash', edit: 'products-edit-' + st.editId + '-' + st.etab }[st.view] || 'products-records');

  // ---------------- shared pieces ----------------
  function Card(title, sub, body, acts, cls) { return K.Section(title, [].concat(body).filter(Boolean), acts, { sub, cls }); }
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

  // ---------------- «إضافة» (decision 2: the studio and the AI tools come later) ----------------
  function addView() {
    const tools = [['package', 'استوديو المنتجات', 'من الشيت والصور لحد ما المنتج يترفع على الموقع: SKU، متغيرات، سعر، صور، أقسام، أوصاف.', Tag('brand', 'المرحلة الجاية')],
      ['image', 'الصور', 'صورة احترافية، إزالة خلفية ونصوص، تحسين، وصورة المقاس بالأبعاد.', Tag('gold', 'ذكاء اصطناعي — قريبًا')],
      ['file', 'المحتوى', 'اسم ووصف وكلمات مفتاحية ونقاط بالعربي والإنجليزي بأسلوب إبتكر.', Tag('gold', 'ذكاء اصطناعي — قريبًا')]];
    return [h('div', { class: 'tools-grid c3' }, tools.map(([ic, t, b, tg]) => h('button', { type: 'button', class: 'card tool-card', 'aria-label': t + ' — قريبًا', onClick: () => K.toast('«' + t + '» لسه — soon') }, h('span', { class: 'tool-ic' }, Icon(ic)), h('span', { class: 't-h5 tc-t' }, t), h('span', { class: 't-small tc-b' }, b), tg, h('span', { class: 'tc-cta' }, 'قريبًا')))),
      U.InlineNote({ children: 'دلوقتي تقدر تعدّل المنتجات اللي على الموقع من «السجل». إضافة منتجات جديدة من الاستوديو في المرحلة الجاية.' })];
  }

  // ---------------- «السجل» ----------------
  function filtered() {
    const q = st.q.trim().toLowerCase();
    return all().filter((p) => {
      if (st.status === 'published' && p.wooStatus !== 'publish') return false;
      if (st.status === 'draft' && p.wooStatus !== 'draft') return false;
      if (st.status === 'pending' && p.wooStatus !== 'pending') return false;
      if (st.status === 'out' && stockStateOf(p) !== 'نفد') return false;
      if (q && !(p.nameEn.toLowerCase().includes(q) || p.nameAr.includes(q) || p.sku.toLowerCase().includes(q))) return false;
      if (st.f.vendor && p.vendor !== st.f.vendor) return false;
      if (st.f.brand && !p.brands.includes(st.f.brand)) return false;
      if (st.f.category && !p.cats.some((c) => c === st.f.category || c.startsWith(st.f.category + ' › '))) return false;
      if (st.f.stock && stockStateOf(p) !== st.f.stock) return false;
      if (st.f.type && p.type !== st.f.type) return false;
      if (st.missingOnly && !complete(p).missing.length) return false;
      return true;
    });
  }
  function counts() {
    const L = all();
    return { all: L.length, published: L.filter((p) => p.wooStatus === 'publish').length, draft: L.filter((p) => p.wooStatus === 'draft').length, pending: L.filter((p) => p.wooStatus === 'pending').length,
      out: L.filter((p) => stockStateOf(p) === 'نفد').length, trash: trashRows().length };
  }
  function statusChips() {
    const c = counts(); const it = [['all', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة'], ['pending', 'قيد المراجعة'], ['out', 'نفد'], ['trash', 'المهملات']];
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'الحالة' }, it.map(([id, l]) => chipBtn(l + ' ' + K.n0(c[id]), st.status === id, () => { st.status = id; st.sel.clear(); st.pageN = 0; go(id === 'trash' ? 'products-trash' : 'products-records'); }, { 'data-pstatus': id })));
  }
  const fsel = (key, label, opts) => U.Select({ id: 'pf-' + key, label: '', options: [{ value: '', label: label + ': الكل' }].concat(opts.map((o) => ({ value: o, label: label + ': ' + o }))), value: st.f[key], onChange: (v) => { st.f[key] = v; st.pageN = 0; R(); } });
  function searchBox() {
    const q = h('input', { type: 'search', placeholder: 'دوّر بالاسم أو الـ SKU', 'aria-label': 'بحث في المنتجات', value: st.q });
    q.addEventListener('input', () => { st.q = q.value; st.pageN = 0; const p = q.selectionStart; R(); const n = document.querySelector('#pg-products input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    return h('label', { class: 'search-field' }, Icon('search', 'sm'), q);
  }
  const clearFilters = () => { st.f = { vendor: '', brand: '', category: '', stock: '', type: '' }; st.q = ''; st.missingOnly = false; st.pageN = 0; };
  function recordsView() {
    const list = filtered().slice(); if (st.sort) list.sort((a, b) => (st.sort === 'sales-desc' ? b.sales - a.sales : a.sales - b.sales));
    const any = Object.values(st.f).some(Boolean) || st.q || st.missingOnly; const C = can();
    const L = all(); const vendors = [...new Set(L.map((p) => p.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const brandNames = (PR() ? PR().brands() : []).map((b) => b.name).sort((a, b) => a.localeCompare(b));
    const catPaths = (PR() ? PR().categories() : []).map((c) => c.path);
    const filters = h('div', { class: 'toolbar pr-filters' }, searchBox(), fsel('brand', 'البراند', brandNames), fsel('vendor', 'المبتكر', vendors), fsel('category', 'القسم', catPaths), fsel('stock', 'المخزون', ['متاح', 'قليل', 'نفد', 'حسب الطلب']), fsel('type', 'النوع', ['Simple', 'Variable']),
      chipBtn('ناقصها بيانات (' + K.n0(L.filter((p) => complete(p).missing.length).length) + ')', st.missingOnly, () => { st.missingOnly = !st.missingOnly; st.pageN = 0; R(); }, { 'data-missing': '' }), any ? Button({ type: 'text', size: 'sm', label: 'مسح الفلاتر', onClick: () => { clearFilters(); R(); } }) : null);
    const sel = [...st.sel].map(byId).filter(Boolean);
    const bulk = sel.length && (C.bulk || C.trash) ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد' }, h('b', null, 'محدد ' + K.n0(sel.length)), h('span', { class: 'grow' }),
      C.bulk ? Button({ size: 'sm', label: 'تعديل السعر', onClick: () => bulkPrice(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'تعديل المخزون', onClick: () => bulkStock(sel) }) : null,
      C.bulk ? Button({ size: 'sm', label: 'نقل لبراند تاني', onClick: () => moveBrand(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'تغيير القسم', onClick: () => changeCat(sel) }) : null,
      C.bulk ? Button({ size: 'sm', label: 'تحويل لمسودة', onClick: () => toDraft(sel) }) : null, C.bulk ? Button({ size: 'sm', label: 'نشر', onClick: () => publish(sel) }) : null,
      C.trash ? Button({ type: 'danger', size: 'sm', label: 'مسح', onClick: () => toTrash(sel) }) : null, Button({ size: 'sm', label: 'إلغاء التحديد', onClick: () => { st.sel.clear(); R(); } })) : null;
    const pages = Math.max(1, Math.ceil(list.length / PAGE)); if (st.pageN >= pages) st.pageN = pages - 1;
    const shown = list.slice(st.pageN * PAGE, st.pageN * PAGE + PAGE);
    const allSel = shown.length && shown.every((p) => st.sel.has(p.id));
    const rows = shown.map((p) => { const ss = stockStateOf(p); const miss = complete(p).missing;
      return [K.Checkbox({ label: '', checked: st.sel.has(p.id), onChange: (v) => { v ? st.sel.add(p.id) : st.sel.delete(p.id); R(); } }),
        h('button', { type: 'button', class: 'prod link', 'data-pedit': String(p.id), onClick: () => go('products-edit-' + p.id) }, Thumb(p.img), h('span', null, h('b', null, nameOf(p)), miss.length ? Tag('orange', 'ناقص: ' + miss[0]) : h('small', null, p.nameAr))),
        h('span', { dir: 'ltr', class: 't-small' }, p.sku || '—'), h('span', { class: 'brand-cell' }, h('span', null, brandOf(p)), h('small', { class: 't-small help' }, p.vendor || '—')),
        h('span', { class: 'cat-list t-small' }, p.cats.length ? p.cats.map((c) => h('span', { class: st.f.category && c.startsWith(st.f.category) ? 'cat-hit' : null }, c)) : '—'), h('span', { class: 't-small' }, p.type),
        p.type === 'Variable' && p.price != null ? h('span', null, 'من ', money(p.price)) : money(p.type === 'Variable' ? null : p.sale),
        h('span', { class: 'stk' }, ss === 'حسب الطلب' || p.stock == null ? null : K.Num(String(p.stock)), ss !== 'متاح' ? Tag(STOCK_TONE[ss], ss) : null),
        h('span', { class: 'sales-cell', 'data-sales': String(p.sales), title: 'اتباع ' + p.sales + ' مرة' }, p.sales ? K.Num(K.n0(p.sales)) : h('span', { class: 'help' }, '—')),
        Tag(STATUS_TONE[p.status] || 'neutral', p.status),
        K.RowMenu([{ label: 'تعديل', icon: 'sliders', run: () => go('products-edit-' + p.id) }, p.permalink ? { label: 'افتح على الموقع', icon: 'link', run: () => openSite(p.permalink) } : null,
          { label: 'تكرار كمنتج جديد', icon: 'copy', run: () => K.toast('التكرار مع استوديو المنتجات — soon') },
          C.edit ? { label: 'نقل لبراند تاني', icon: 'tag', run: () => moveBrand([p]) } : null,
          C.edit ? (p.wooStatus === 'publish' ? { label: 'تحويل لمسودة', icon: 'eyeoff', run: () => toDraft([p]) } : { label: 'نشر', icon: 'eye', run: () => publish([p]) }) : null,
          C.trash ? { label: 'مسح', icon: 'trash', danger: true, run: () => toTrash([p]) } : null], 'إجراءات ' + nameOf(p))]; });
    const salesHead = () => h('button', { type: 'button', class: 'th-sort', 'data-sort-sales': '', 'aria-sort': st.sort === 'sales-desc' ? 'descending' : st.sort === 'sales-asc' ? 'ascending' : 'none', title: 'رتّب بمرات الشراء', onClick: () => { st.sort = st.sort === 'sales-desc' ? 'sales-asc' : st.sort === 'sales-asc' ? '' : 'sales-desc'; R(); } }, 'مرات الشراء', h('span', { 'aria-hidden': 'true', class: 'sort-ic' }, st.sort === 'sales-desc' ? ' ↓' : st.sort === 'sales-asc' ? ' ↑' : ' ↕'));
    const table = list.length ? U.Table({ cls: 'dt pr-table', headers: [K.Checkbox({ label: '', checked: allSel, onChange: (v) => { shown.forEach((p) => (v ? st.sel.add(p.id) : st.sel.delete(p.id))); R(); } }), 'المنتج', 'SKU', 'البراند · المبتكر', 'القسم', 'النوع', 'السعر', 'المخزون', salesHead(), 'الحالة', ''], rows })
      : K.Empty('مفيش منتجات بالفلاتر دي', 'امسح الفلاتر أو جرّب اسم أو SKU تاني.', Button({ size: 'sm', label: 'مسح الفلاتر', onClick: () => { clearFilters(); st.status = 'all'; R(); } }));
    // the kit labels each cell (data-l, the phone card) with its header: an element header gets its text instead
    if (list.length) table.querySelectorAll('td[data-l^="[object"]').forEach((td) => { const th = table.querySelectorAll('thead th')[td.cellIndex]; td.dataset.l = th ? th.textContent.replace(/[↓↑↕]/g, '').trim() : ''; });
    const pager = list.length ? h('div', { class: 'pager t-small' }, h('span', { 'data-pager': '' }, K.n0(st.pageN * PAGE + 1) + '–' + K.n0(st.pageN * PAGE + shown.length) + ' من ' + K.n0(list.length)),
      h('span', { class: 'acts-inline' }, Button({ size: 'sm', label: 'السابق', disabled: st.pageN === 0, onClick: () => { st.pageN--; R(); window.scrollTo(0, 0); } }), Button({ size: 'sm', label: 'التالي', disabled: st.pageN >= pages - 1, onClick: () => { st.pageN++; R(); window.scrollTo(0, 0); } }))) : null;
    return [statusChips(), filters, bulk, h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, table, pager))];
  }
  function trashView() {
    const C = can(); const T = trashRows();
    const sel = [...st.sel].map((id) => T.find((t) => t.id === id)).filter(Boolean);
    const rows = T.map((t) => { const left = PD.trashDaysLeft(String(t.trashedAt || K.TODAY).slice(0, 10), K.TODAY);
      return [C.trash ? K.Checkbox({ label: '', checked: st.sel.has(t.id), onChange: (v) => { v ? st.sel.add(t.id) : st.sel.delete(t.id); R(); } }) : '', h('span', { class: 'prod' }, Thumb(t.img), h('span', null, h('b', null, nameOf(t)), h('small', null, t.nameAr))), h('span', { dir: 'ltr', class: 't-small' }, t.sku || '—'), t.vendor || '—', t.trashedAt ? K.dshort(String(t.trashedAt).slice(0, 10)) : '—',
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
    const withRate = (p) => { const c = PR().commissionOf(p); const rate = c ? Math.round((c.amount / p.sale) * 1000) / 10 : null; return Object.assign({}, p, { rate, vendorPrice: c ? PR().vendorPriceOf(p) : null, disc: p.regular && p.regular > p.sale ? Math.round((1 - p.sale / p.regular) * 100) : 0 }); };
    const items = simple.map(withRate);
    const TG = (C.commission ? [['vendor', 'سعر المبتكر'], ['rate', 'نسبة إبتكر']] : []).concat([['discount', 'الخصم الوهمي']]);
    const next = (p, o) => {
      if (o.target === 'discount') { const d = Math.min(90, Math.max(0, o.mode === 'pct' ? +(p.disc * (1 + (o.dir * o.amount) / 100)).toFixed(1) : p.disc + o.dir * o.amount)); return { sale: p.sale, regular: Math.round(p.sale / (1 - d / 100)), disc: d }; }
      if (p.rate == null) return null;
      const r = PD.bulkPrice(p, o); return { sale: r.sale, regular: r.regular, rate: r.rate, vendorPrice: r.vendorPrice };
    };
    K.form({ title: 'تعديل سعر ' + (simple.length === 1 ? 'منتج' : simple.length + ' منتجات'), values: { target: TG[0][0], dir: '1', mode: 'pct', amount: '10' }, submitLabel: 'طبّق السعر',
      fields: (f, e, set, draw) => { const opt = { target: f.target, mode: f.mode, dir: Number(f.dir), amount: Number(f.amount) }; const ok = Number(f.amount) > 0;
        const rows = ok ? items.slice(0, 5).map((p) => { const r = next(p, opt); return [nameOf(p), !r ? 'مالوش نسبة ظاهرة' : f.target === 'vendor' ? K.n0(p.vendorPrice) + ' ← ' + K.n0(r.vendorPrice) : f.target === 'rate' ? p.rate + '% ← ' + r.rate + '%' : p.disc + '% ← ' + r.disc + '%', r ? K.n0(p.sale) + ' ← ' + K.n0(r.sale) : '—']; }) : [];
        const seg = (key, opts) => h('div', { class: 'chips', role: 'radiogroup' }, opts.map(([v, lab]) => chipBtn(lab, f[key] === v, () => { f[key] = v; draw(); }, { role: 'radio', 'aria-checked': String(f[key] === v) })));
        return [U.FieldShell({ id: 'bp-t', label: 'تعدّل إيه؟', required: true, help: (C.commission ? 'سعر المبتكر بيحسب سعر البيع تاني بالمعادلة · النسبة والخصم بالنقط (%)' : 'الخصم الوهمي بيغيّر السعر قبل الخصم بس — سعر البيع زي ما هو') }, seg('target', TG)),
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
  function changeCat(l) {
    const cats = PR().categories();
    K.form({ title: 'تغيير قسم ' + (l.length === 1 ? 'منتج' : l.length + ' منتجات'), values: { cat: '', mode: 'add' }, submitLabel: 'غيّر القسم',
      fields: (f, e, set, draw) => [K.field.select('cat', 'القسم', cats.map((c) => ({ value: String(c.id), label: c.path })), f, e, set, { required: true }), K.Radios({ value: f.mode, onChange: (v) => { f.mode = v; draw(); }, options: [{ value: 'add', label: 'ضيفه جنب الأقسام الحالية', hint: 'المنتج هيظهر في الاتنين' }, { value: 'replace', label: 'بدّل الأقسام الحالية' }, { value: 'remove', label: 'شيله من القسم ده' }] })],
      validate: (f) => K.req(f, ['cat'], { cat: 'اختار القسم' }),
      submit: (f, m) => { const id = Number(f.cat);
        write((pg) => batch(l, (p) => { const cur = p.categoryIds; const nx = f.mode === 'replace' ? [id] : f.mode === 'remove' ? cur.filter((x) => x !== id) : cur.filter((x) => x !== id).concat(id); return nx.length ? { categories: nx } : {}; }, pg), 'اتغير القسم', m, l.length); return false; } });
  }

  // ---------------- edit (the product live from the site) ----------------
  function fetchLive(id) {
    if (st.loadingLive) return;
    st.loadingLive = true; st.liveErr = '';
    PR().fetchLive(id).then((r) => {
      st.loadingLive = false;
      if (st.editId !== id) return;
      if (!r.ok) { st.liveErr = fail(r); } else { st.live = r; st.liveFor = id; st.draft = toDraft_(r); }
      if (window.IBPages.current === 'products' && st.view === 'edit') R();
    });
  }
  const s = (v) => (v == null ? '' : String(v));
  function toDraft_(r) {
    const p = r.product; const ar = r.ar || {};
    return { name: p.name, sku: p.sku, status: p.status, featured: p.featured, weight: p.weight, regular: p.regular_price, sale: p.sale_price, manage: p.manage_stock, qty: s(p.stock_quantity),
      onDemand: p.stock_status === 'onbackorder' || (p.manage_stock && p.backorders && p.backorders !== 'no'), alert: s(p.low_stock_amount), cats: p.categories.map((c) => c.id), brands: p.brands.map((b) => b.id),
      images: p.images.map((i) => i.id), short: p.short_description, desc: p.description, arName: s(ar.name), arShort: s(ar.short_description), arDesc: s(ar.description),
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
  const discard = () => { st.draft = toDraft_(st.live); st.errs = {}; R(); };
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
      rec ? K.RowMenu([{ label: 'تكرار كمنتج جديد', icon: 'copy', run: () => K.toast('التكرار مع استوديو المنتجات — soon') }, C.edit ? { label: 'نقل لبراند تاني', icon: 'tag', run: () => moveBrand([rec]) } : null,
        C.edit ? (p.status === 'publish' ? { label: 'تحويل لمسودة', icon: 'eyeoff', run: () => toDraft([rec]) } : { label: 'نشر', icon: 'eye', run: () => publish([rec]) }) : null,
        C.trash ? { label: 'مسح', icon: 'trash', danger: true, run: () => toTrash([rec]) } : null], 'إجراءات المنتج') : null,
      C.edit ? Button({ type: 'primary', label: st.saving ? 'بنحفظ…' : 'احفظ على الموقع', disabled: st.saving, attrs: { 'data-psave': '' }, onClick: save }) : null];
    const firstImg = (p.images[0] || {}).src;
    const head = h('div', { class: 'page-head row edit-head' }, h('div', { class: 'eh-l' }, Thumb(firstImg, 'lg2'), h('div', null, back, h('h1', { class: 't-h3' }, [p.name, d.arName].filter(Boolean).join(' · ')), meta)), h('div', { class: 'actions' }, acts));
    const tabs = K.MainTabs({ items: ETABS.filter(([k]) => k !== 'variants' || p.type === 'variable').map(([k, label]) => ({ id: k, label })), active: st.etab, onChange: (k) => { st.etab = k; setHash('products-edit-' + id + '-' + k); R(); }, label: 'أقسام المنتج' });
    let body;
    if (st.etab === 'data') body = h('div', { class: 'side-layout' }, Card('البيانات الأساسية', null, [K.two(inp('en', 'الاسم (EN)', 'name', { required: true }), st.live.ar ? inp('ar', 'الاسم (AR)', 'arName') : U.InlineNote({ children: 'المنتج ده ملوش ترجمة عربي على الموقع.' })),
      K.two(inp('sku', 'SKU', 'sku', { help: 'تغيير الـ SKU بيغيّر الباركود واللينكات القديمة.' }), inp('w', 'الوزن (كجم)', 'weight', { inputmode: 'decimal' })),
      K.two(U.Select({ id: 'e-brand', label: 'البراند', options: [{ value: '', label: '—' }].concat(PR().brands().map((b) => ({ value: String(b.id), label: b.name }))), value: d.brands[0] != null ? String(d.brands[0]) : '', disabled: dis, help: 'المبتكر (متجر Dokan): ' + ((rec && rec.vendor) || (p.store && p.store.shop_name) || '—'), onChange: (v) => { d.brands = v ? [Number(v)] : []; R(); } }),
        U.TextInput({ id: 'e-type', label: 'النوع', value: p.type === 'variable' ? 'Variable' : p.type === 'simple' ? 'Simple' : p.type, disabled: true, onInput: () => {}, help: 'النوع بيتغير من الاستوديو بس' }))], null, 'grow'),
      h('div', { class: 'stack side-card' }, Card('الحالة والظهور', null, [U.Select({ id: 'e-status', label: 'الحالة', options: [{ value: 'publish', label: 'منشور' }, { value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'قيد المراجعة' }].concat(['publish', 'draft', 'pending'].includes(p.status) ? [] : [{ value: p.status, label: status }]), value: d.status, disabled: dis, onChange: (v) => { d.status = v; R(); } }),
        K.Switch({ id: 'e-feat', label: 'منتج مميز', checked: d.featured, disabled: dis, onChange: (v) => { d.featured = v; R(); } })]), priceCard(p, inp, dis, rec)));
    else if (st.etab === 'price') body = priceCard(p, inp, dis, rec);
    else if (st.etab === 'images') body = imagesCard(p, dis);
    else if (st.etab === 'variants') body = variantsCard(dis);
    else if (st.etab === 'cats') body = catsCard(dis);
    else if (st.etab === 'desc') body = h('div', { class: 'stack' }, Card('الأوصاف (EN)', null, [area('short', 'وصف قصير', 'short', 4), area('desc', 'الوصف', 'desc', 8)]), st.live.ar ? Card('الأوصاف (AR)', null, [area('ars', 'وصف قصير (AR)', 'arShort', 4), area('ard', 'الوصف (AR)', 'arDesc', 8)]) : null,
      h('p', { class: 't-small help' }, 'الكتابة بالذكاء الاصطناعي في مرحلة الأدوات — soon.'));
    else body = Card('SEO', null, [K.Empty('قريبًا', 'عنوان ووصف الصفحة (Rank Math) في مرحلة جاية.')]);
    const n = dirtyCount();
    return [head, tabs, body, n && C.edit ? h('div', { class: 'unsaved', role: 'status' }, h('b', null, 'عندك ' + n + ' تعديلات مش محفوظة'), Button({ type: 'text', size: 'sm', label: 'تجاهل', onClick: discard }), Button({ type: 'primary', size: 'sm', label: 'احفظ على الموقع', disabled: st.saving, onClick: save })) : null];
  }
  function priceCard(p, inp, dis, rec) {
    const d = st.draft; const C = can();
    if (p.type === 'variable') return Card('السعر والمخزون', null, [U.InlineNote({ children: 'السعر والمخزون بيتعدلوا لكل تركيبة من تاب «المتغيرات».' })]);
    // decision 12: Dokan's commission on this sale price (the product's own, else the store's / category's) — the vendor price is what is left
    const sale = Number(d.sale || d.regular) || 0; const cm = rec && sale ? PR().commissionOf(Object.assign({}, rec, { sale })) : null; const vp = cm ? Math.round((sale - cm.amount) * 100) / 100 : null;
    const src = cm ? (cm.source === 'product' ? 'عمولة المنتج' : cm.source === 'category' ? 'نسبة القسم' : 'نسبة المتجر') + (cm.rate != null ? ' ' + cm.rate + '%' : '') + (cm.fee ? ' + ' + K.n0(cm.fee) : '') : '';
    const stockState = d.onDemand ? 'حسب الطلب' : d.manage ? PD.stockState(Number(d.qty) || 0, false, d.alert === '' ? 3 : Number(d.alert)) : 'متاح';
    return Card('السعر والمخزون', null, [K.two(inp('sale', 'سعر البيع', 'sale', { inputmode: 'numeric' }), inp('reg', 'قبل الخصم', 'regular', { inputmode: 'numeric' })),
      C.commission && vp != null ? K.two(h('div', { class: 'field', 'data-vprice': '' }, h('span', { class: 'flabel' }, 'سعر المبتكر'), h('b', null, K.Num(K.n0(vp) + ' ج.م'))), h('div', { class: 'field', 'data-commission': '' }, h('span', { class: 'flabel' }, 'عمولة إبتكر (' + src + ')'), h('b', { class: 'brand-t' }, K.Num(K.n0(cm.amount) + ' ج.م')))) : null,
      K.Switch({ id: 'e-dem', label: 'حسب الطلب (بيتصنع بعد الأوردر)', checked: d.onDemand, disabled: dis, onChange: (v) => { d.onDemand = v; R(); } }),
      d.onDemand ? null : K.Switch({ id: 'e-man', label: 'تتبع الكمية', checked: d.manage, disabled: dis, onChange: (v) => { d.manage = v; R(); } }),
      !d.onDemand && d.manage ? K.two(inp('stk', 'المخزون', 'qty', { inputmode: 'numeric' }), U.Select({ id: 'e-al', label: 'نبّهني تحت', options: [{ value: '', label: 'افتراضي الموقع' }].concat(['0', '1', '2', '3', '4', '5'].map((x) => ({ value: x, label: x }))), value: d.alert, disabled: dis, onChange: (v) => { d.alert = v; R(); } })) : null,
      h('div', { class: 'stk' }, h('span', { class: 't-small help' }, 'حالة المخزون:'), Tag(STOCK_TONE[stockState], stockState))]);
  }
  function imagesCard(p, dis) {
    const d = st.draft; const imgs = d.images.map((iid) => p.images.find((i) => i.id === iid)).filter(Boolean);
    const sel = st.imgSel != null && st.imgSel < imgs.length ? st.imgSel : null;
    return Card('صور المنتج', 'أول صورة هي الرئيسية. الترتيب والشيل بيتحفظوا على الموقع؛ رفع صور جديدة مع الاستوديو.', [h('div', { class: 'img-grid' }, imgs.map((im, i) => h('button', { type: 'button', class: 'img-it' + (sel === i ? ' on' : ''), 'aria-pressed': String(sel === i), onClick: () => { st.imgSel = sel === i ? null : i; R(); } }, Thumb(im.src, 'xl'), i === 0 ? Tag('brand', 'رئيسية') : null, h('figcaption', { dir: 'ltr' }, im.name || ('#' + im.id))))),
      !imgs.length ? K.Empty('مفيش صور', 'الصور بتترفع مع استوديو المنتجات.') : null,
      sel != null && !dis ? h('div', { class: 'sel-acts' }, h('b', null, 'الصورة ' + (sel + 1) + ' محددة:'), sel ? Button({ size: 'sm', label: 'خليها الرئيسية', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.unshift(x); st.imgSel = 0; R(); } }) : null,
        sel ? Button({ size: 'sm', label: '→ قدّم', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.splice(sel - 1, 0, x); st.imgSel = sel - 1; R(); } }) : null,
        sel < imgs.length - 1 ? Button({ size: 'sm', label: 'أخّر ←', onClick: () => { const x = d.images.splice(sel, 1)[0]; d.images.splice(sel + 1, 0, x); st.imgSel = sel + 1; R(); } }) : null,
        Button({ type: 'danger', size: 'sm', label: 'شيلها', onClick: () => { d.images.splice(sel, 1); st.imgSel = null; R(); } })) : null]);
  }
  function variantsCard(dis) {
    const d = st.draft; const vs = st.live.variations;
    if (!vs.length) return Card('التركيبات', null, [K.Empty('مفيش تركيبات', 'إضافة تركيبات مع الاستوديو.')]);
    const rows = d.vars.map((v, i) => { const lv = vs[i]; const ss = v.onDemand ? 'حسب الطلب' : PD.stockState(Number(v.qty) || 0, false, 3);
      const upd = (k) => (x) => { const was = dirtyCount(); v[k] = x; if (!was !== !dirtyCount()) R(); else { const b = document.querySelector('#pg-products .unsaved b'); if (b) b.textContent = 'عندك ' + dirtyCount() + ' تعديلات مش محفوظة'; } };
      return [lv.attributes.map((a) => a.option).join(' · ') || '—', h('span', { dir: 'ltr', class: 't-small' }, lv.sku || '—'), U.TextInput({ id: 'vv-r' + i, label: '', value: v.regular, inputmode: 'numeric', disabled: dis, onInput: upd('regular') }), U.TextInput({ id: 'vv-s' + i, label: '', value: v.sale, inputmode: 'numeric', disabled: dis, onInput: upd('sale') }),
        v.onDemand ? '—' : U.TextInput({ id: 'vv-q' + i, label: '', value: v.qty, inputmode: 'numeric', disabled: dis, onInput: upd('qty') }), K.Switch({ id: 'vv-d' + i, label: 'حسب الطلب', checked: v.onDemand, disabled: dis, onChange: (x) => { v.onDemand = x; R(); } }), Tag(STOCK_TONE[ss], ss)]; });
    return h('div', { class: 'stack' }, Card('التركيبات (' + vs.length + ')', 'السعر والمخزون بيتحدثوا على ووكومرس أول ما تحفظ. إضافة أو شيل تركيبة مع الاستوديو.', U.Table({ cls: 'dt', headers: ['التركيبة', 'SKU', 'قبل الخصم', 'سعر البيع', 'المخزون', 'حسب الطلب', 'الحالة'], rows })));
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
  const mainTabs = () => K.MainTabs({ items: [{ id: 'add', label: 'إضافة' }, { id: 'records', label: 'السجل · ' + K.n0(all().length) }, { id: 'reports', label: 'التقارير' }], active: st.tab, onChange: (id) => go(id === 'add' ? 'products-add' : id === 'reports' ? 'products-reports' : 'products-records'), label: 'أقسام المنتجات' });
  function view() {
    const P = PR(); const C = can();
    // decision 3: the page needs products.view (orders.view reads the mirror for the orders screen only)
    if (!P || !C.view) return [K.PageHead('المنتجات', null, null), K.Empty('مش مسموحلك تشوف المنتجات', 'اطلب صلاحية «المنتجات» من الأدمن.')];
    P.ensure();
    if (st.view === 'edit') return editView();
    const head = K.PageHead('المنتجات', 'عدّل المنتجات اللي على الموقع. البيانات والصور متخزنة على ووكومرس.', [Button({ type: 'brand', label: '+ دفعة منتجات جديدة', onClick: () => K.toast('الاستوديو في المرحلة الجاية — soon') })]);
    head.firstChild.append(fresh());
    let body;
    if (P.state() === 'error') body = [K.Empty('مقدرناش نحمّل المنتجات', 'في مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', onClick: () => P.load() }))];
    else if (P.state() !== 'ready' && st.view !== 'add' && st.view !== 'reports') body = [U.InlineNote({ children: 'بنحمّل المنتجات…' })];
    else body = st.view === 'add' ? addView() : st.view === 'trash' ? trashView() : st.view === 'reports' ? [K.Empty('قريبًا', 'تقارير المنتجات مع صفحة التقارير.')] : recordsView();
    return [head, mainTabs(), h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...body.filter(Boolean))];
  }
  document.addEventListener('ib:products', () => { if (window.IBPages.current === 'products' && st.view !== 'edit') R(); });
  // a deep link opened before the sign-in finished: draw again once the permissions are known
  document.addEventListener('ib:directory', () => { if (window.IBPages.current === 'products') R(); });

  window.IBPages.register('products', { title: 'المنتجات', hash: (hs) => route(hs), defaultHash, view, canLeave: (proceed) => leaveGuard(proceed), api: { st, go } });
})();
