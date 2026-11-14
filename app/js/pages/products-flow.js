/* استوديو المنتجات — التلات حالات (docs/superpowers/plans/2026-11-14-studio-flows.md): «شيت جاهز» · «داتا على الواتساب» · «صور وعايز شيت».
   The owner's template (his BIAN / Glastora sheets, flow-domain.js) end to end: the maker's sheet or chat screenshots + photos numbered
   by row → the maker and brand → the data on the template (SKU and missing fields) → the prices → the images (4 shots, the size
   drawing, one features image for the batch) → the upload (the photos to the site under the sheet's names, the sheet as draft
   products, or both as files). Case 3 builds the empty sheet for a maker with only photos (the reference picture inside its cell).
   A batch is a studio_batches row with state.flow = 2; state.items is rebuilt from the rows (one per product) for the server
   (ai-content studio, ai-images generate, woo-sync studio_upload). The products page routes #products-flow-<new|id>[-<step>] here. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, PD = window.IbtekrProducts, FD = window.IbtekrFlow;
  const { h, Icon, Button } = U;
  const Tag = K.Tag;
  const ST = () => window.IBStudio, PR = () => window.IBProducts, AI = () => window.IBAI, IM = () => window.IBImages, V = () => window.IBVendors;
  const R = () => window.IBPages.render('products');
  // a render that keeps the field being typed in (the tables re-render on every change)
  const RF = () => {
    const a = document.activeElement; const tr = a && a.closest ? a.closest('[data-row]') : null; const key = tr ? tr.getAttribute('data-row') : null; const fl = a && a.getAttribute ? a.getAttribute('data-fl') : null;
    R(); if (!key || !fl) return;
    const n = document.querySelector('[data-row="' + key + '"] [data-fl="' + fl + '"]'); if (n && n.focus) n.focus();
  };
  const go = (hs) => { const p = window.IBPages.all && window.IBPages.all().products; if (p && p.api && p.api.go) p.api.go(hs); else { location.hash = hs; } };
  const money = (n) => (n == null || !Number.isFinite(Number(n)) || n === '' ? '—' : K.n0(n) + ' ج.م');
  const safeSrc = (s) => (typeof s === 'string' && s.startsWith('https://') ? s : '');
  const Thumb = (path, cls) => { const u = path ? safeSrc(ST().imageUrl(path)) : ''; return u ? h('span', { class: 'thumb ' + (cls || '') }, h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : h('span', { class: 'thumb empty-img ' + (cls || ''), role: 'img', 'aria-label': 'من غير صورة' }, Icon('image', 'sm')); };
  const filePick = (accept, multiple, onFiles) => { const inp = h('input', { type: 'file', accept, multiple: !!multiple, style: 'display:none' }); inp.addEventListener('change', () => { const f = [...inp.files]; inp.value = ''; if (f.length) onFiles(f); }); document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000); };
  const Card = (title, sub, body, acts) => h('section', { class: 'card sec fl-card', 'data-no-tq': '', 'data-no-cols': '', 'data-no-th': '' },
    h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, title), sub ? h('div', { class: 't-small sub' }, sub) : null), acts ? h('div', { class: 'acts-inline' }, acts) : null), [].concat(body).filter(Boolean));
  const CASES = { sheet: 'شيت جاهز من المبتكر', whatsapp: 'داتا على الواتساب', photos: 'صور وعايز شيت' };
  const STEPS = { data: ['البداية', 'المبتكر والبراند', 'البيانات', 'الأسعار', 'الصور', 'الرفع'], photos: ['البداية', 'المبتكر والبراند', 'الصور', 'الشيت'] };
  const SHOT_L = ['صورة 1 · في النص', 'صورة 2 · البيئة', 'صورة 3 · البيئة', 'صورة 4 · التفاصيل'];
  const REASON = { push_disabled: 'الكتابة على الموقع متقفلة (WOO_PUSH_ENABLED)', forbidden: 'مش مسموحلك', network: 'مشكلة في الاتصال — جرّب تاني', invalid: 'البيانات ناقصة أو مش صحيحة', missing: 'مش لاقيين الدفعة',
    images_first: 'ارفع الصور الأول — الشيت لينكاته من الصور', product_invalid_sku: 'الـ SKU ده موجود على الموقع', product_refused: 'الموقع رفض المنتج', author_failed: 'المبتكر ماتحطش على المنتج — جرّب تاني',
    not_configured: 'الـ AI لسه مش متوصّل', ai_cap: 'وصلنا لحد الـ AI الشهري', busy: 'الـ AI مشغول — جرّب كمان شوية', ai_error: 'الـ AI ماردش — جرّب تاني', not_image: 'الملف ده مش صورة' };
  const why = (code, field) => (REASON[code] || 'حصلت مشكلة (' + code + ')') + (field ? ' — ' + field : '');

  // ---------------- state ----------------
  const S = { id: null, row: null, step: 1, loading: false, err: '', timer: null, sel: new Set(), busy: '', prog: { img: null, sheet: null }, results: null };
  const st = () => S.row && S.row.state;
  const blank = (kase, type) => ({ flow: 2, case: kase, type, vendorId: null, vendorName: '', brandId: null, brandName: '', code: '', rate: null, fee: null, rows: [], kinds: { sizes: 0, colors: 0 }, products: [], shots: {}, sizeShot: {}, features: null, sheetName: '', items: [], screens: 0 });
  const steps = () => (st() && st().case === 'photos' ? STEPS.photos : STEPS.data);
  const isVar = () => st() && st().type === 'Variable';
  const hashFor = (n) => 'products-flow-' + (S.id || 'new') + '-' + n;

  function route(id, step) {
    const n = Math.max(1, Math.min(6, Number(step) || 1));
    if (id === 'new') { start(); return; }
    S.step = n;
    if (id !== S.id) { S.id = id; S.row = null; S.err = ''; S.sel.clear(); S.results = null; openBatch(id); }
  }
  async function openBatch(id) {
    S.loading = true; R();
    const row = await ST().open(id);
    if (S.id !== id) return;
    S.loading = false;
    if (!row || !row.state || row.state.flow !== 2) { S.err = 'الدفعة دي مش موجودة أو مش من فلو الاستوديو الجديد.'; R(); return; }
    row.state = Object.assign(blank(row.state.case, row.state.type), row.state);
    S.row = row; R();
  }
  // auto-save: the state (the items rebuilt from the rows) and the furthest step, a moment after the last change
  function touch(now) {
    if (!S.id || !st()) return null;
    clearTimeout(S.timer);
    const run = async () => { const s = st(); s.items = buildItems(); const r = await ST().save(S.id, { state: s, step: Math.max(S.step, S.row.step || 1), type: s.type, brand_id: s.brandId, vendor_id: s.vendorId, title: titleOf() }); if (r.ok && r.row) S.row = Object.assign({}, S.row, r.row, { state: s }); return r; };
    if (now) return run();
    S.timer = setTimeout(run, 700);
    return null;
  }
  const titleOf = () => (st().brandName || st().vendorName || 'دفعة') + ' — ' + CASES[st().case] + ' · ' + st().type + ' · ' + new Date().toISOString().slice(0, 10);
  async function goStep(n) { await touch(true); S.sel.clear(); go(hashFor(n)); }

  // ---------------- the chooser (decision 1) ----------------
  function start() {
    if (!ST() || !ST().can()) { K.toast('مش مسموحلك تضيف منتجات — اطلب صلاحية «إضافة منتجات»', 'error'); return; }
    let kase = 'sheet'; let type = 'Simple'; let m = null;
    const opt = (title, desc, on, onClick) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(!!on), class: 'opt-card', onClick }, h('i', { class: 'rd' }), h('span', null, h('b', null, title), h('small', null, desc)));
    const body = () => [h('div', { class: 'opt-grid', role: 'radiogroup', 'aria-label': 'الحالة' },
      opt(CASES.sheet, 'المبتكر بعت شيت فيه البيانات + صور المنتجات.', kase === 'sheet', () => { kase = 'sheet'; draw(); }),
      opt(CASES.whatsapp, 'سكرين شوتس من الواتساب بالبيانات + صور المنتجات — الـ AI بيقرا الداتا.', kase === 'whatsapp', () => { kase = 'whatsapp'; draw(); }),
      opt(CASES.photos, 'المبتكر عنده صور بس وعايز شيت يملاه — بنعمله الشيت بالصور جواه.', kase === 'photos', () => { kase = 'photos'; draw(); })),
    h('h3', { class: 't-h5 sub-h' }, 'نوع المنتجات'),
    h('div', { class: 'opt-grid', role: 'radiogroup', 'aria-label': 'نوع المنتجات' },
      opt('Simple', 'كل منتج صف واحد بسعره وصوره.', type === 'Simple', () => { type = 'Simple'; draw(); }),
      opt('Variable', 'منتجات بألوان و/أو مقاسات — كل تركيبة صف.', type === 'Variable', () => { type = 'Variable'; draw(); }))];
    const draw = () => m.setBody(...body());
    m = U.Modal({ title: 'دفعة منتجات جديدة', body: body(), footer: [Button({ type: 'text', label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'ابدأ', attrs: { 'data-flow-start': '' }, onClick: async () => {
      const s = blank(kase, type);
      const r = await ST().create({ title: CASES[kase] + ' — ' + type + ' · ' + new Date().toISOString().slice(0, 10), type, state: s, step: 1 });
      if (!r.ok) { K.toast('مقدرناش نعمل الدفعة — ' + why(r.reason), 'error'); return; }
      m.close(); S.id = r.id; S.row = { id: r.id, step: 1, status: 'draft', state: s }; S.step = 1; S.sel.clear(); S.results = null; go(hashFor(1));
    } })] });
  }

  // ---------------- rows, groups, units ----------------
  const rows = () => (st() ? st().rows : []);
  const newKey = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const groups = () => FD.groupRows(rows(), st().type);
  const colors = () => (ST() ? ST().colors() : []);
  const colorOf = (r) => { const n = String(r.colorEn || '').trim().toLowerCase(); const a = String(r.colorAr || '').trim(); return colors().find((c) => (n && c.name_en.toLowerCase() === n) || (a && String(c.name_ar).trim() === a)) || null; };
  const codeOfRow = (r) => { const c = colorOf(r); if (c) return c.code; const m = /-([A-Z]{2})(?:-[A-Z0-9]+)?$/.exec(String(r.sku || '')); return m && colors().some((x) => x.code === m[1]) ? m[1] : null; };
  // the photos' units: a Simple = its row; a Variable = one unit per color (the sizes of a color share their photos)
  // a unit's key is its first row's (stable while the SKU and the color are typed and generated)
  function units() {
    const out = [];
    groups().forEach((g, gi) => {
      const seen = new Map();
      g.rows.forEach((ri) => {
        const r = rows()[ri]; const k = g.type === 'Variable' ? (codeOfRow(r) || FD.norm(r.colorEn) || FD.norm(r.colorAr) || '-') : 'r' + ri;
        if (!seen.has(k)) { seen.set(k, { key: 'u:' + r.key, gi, rows: [], color: g.type === 'Variable' ? codeOfRow(r) : null }); out.push(seen.get(k)); }
        seen.get(k).rows.push(ri);
      });
    });
    return out;
  }
  const unitRow = (u) => rows()[u.rows[0]];
  const shotsOf = (u) => { const s = st(); if (!Array.isArray(s.shots[u.key])) s.shots[u.key] = [null, null, null, null]; return s.shots[u.key]; };
  const groupKey = (gi) => { const g = groups()[gi]; return g ? 'p:' + rows()[g.rows[0]].key : 'p:' + gi; };

  // ---------------- categories (the template's «LIGHTING > CHANDELIERS» ↔ the site's tree) ----------------
  const catKey = (p) => String(p || '').split(/[›>]/).map((x) => FD.norm(x)).filter(Boolean).join('>');
  const cats = () => (PR() && PR().categories ? PR().categories() : []);
  function catIdOf(path) {
    const k = catKey(path); if (!k) return null;
    const all = cats(); const hit = all.find((c) => catKey(c.path) === k); if (hit) return hit.id;
    const last = k.split('>').pop(); const byName = all.filter((c) => FD.norm(c.name) === last);
    return byName.length === 1 ? byName[0].id : null;
  }
  const pathOfId = (id) => { const c = cats().find((x) => x.id === Number(id)); return c ? c.path.replace(/\s*›\s*/g, ' > ') : ''; };

  // ---------------- the items the server reads (one per product, flow 2) ----------------
  const rateNow = () => { const s = st(); if (s.rate != null) return Number(s.rate); return PR() && s.vendorId ? PR().rateOf(s.vendorId) : null; };
  const feeNow = () => { const s = st(); if (s.fee != null) return Number(s.fee); const v = V() && V().store && s.vendorId ? V().store.get(s.vendorId) : null; return v && v.rateFlat ? Number(v.rateFlat) : 0; };
  function imagesOfUnit(u) { const sh = shotsOf(u).filter(Boolean); return sh; }
  function buildItems() {
    const s = st(); if (!s || s.case === 'photos') return productItems();
    const us = units();
    return groups().map((g, gi) => {
      const R0 = rows()[g.rows[0]]; const mine = us.filter((u) => u.gi === gi);
      const extra = [s.sizeShot[groupKey(gi)], s.features].filter(Boolean);
      const base = { flow: 2, key: g.key, type: g.type, nameEn: FD.baseName(R0.nameEn), nameAr: FD.baseName(R0.nameAr) || R0.nameAr, material: R0.materialEn || '', materialAr: R0.materialAr || '', style: R0.styleEn || '', styleAr: R0.styleAr || '',
        weight: Number(R0.weight) > 0 ? Number(R0.weight) : undefined, shortDesc: R0.shortEn || '', shortDescAr: R0.shortAr || '', categories: [catIdOf(R0.catEn)].filter((x) => x != null), main: R0.ref || null, refs: (R0.photos || []).slice(1, 4),
        colorRefs: Object.fromEntries(mine.filter((u) => u.color).map((u) => [u.color, unitRow(u).ref || R0.ref || null])) };
      if (g.type === 'Simple') {
        const code = codeOfRow(R0);
        return Object.assign(base, { sku: R0.sku, colors: code ? [code] : [], sizes: R0.size ? [R0.size] : [], sizesAr: R0.size ? [R0.sizeAr || ''] : [], sale: R0.sale, regular: R0.regular, images: mine.length ? imagesOfUnit(mine[0]).concat(extra) : extra });
      }
      const rs = g.rows.map((ri) => rows()[ri]);
      const cs = [...new Set(rs.map(codeOfRow).filter(Boolean))];
      const sizes = [...new Set(rs.map((r) => r.size).filter(Boolean))];
      const sizesAr = sizes.map((z) => (rs.find((r) => r.size === z) || {}).sizeAr || '');
      const unitOf = (ri) => mine.find((u) => u.rows.includes(ri));
      return Object.assign(base, { sku: FD.skuBase(R0.sku), colors: cs, sizes, sizesAr, images: (mine.length ? imagesOfUnit(mine[0]) : []).concat(extra),
        variations: g.rows.map((ri) => { const r = rows()[ri]; const ush = unitOf(ri) ? imagesOfUnit(unitOf(ri)) : []; return { color: cs.length ? codeOfRow(r) : null, size: sizes.length ? r.size || null : null, sku: r.sku, sale: r.sale, regular: r.regular, weight: r.weight, image: ush[0] || null, gallery: ush.slice(1) }; }) });
    });
  }
  // case 3: one item per product (its photo as the reference) — for the AI fill
  function productItems() { const s = st(); return (s.products || []).map((p, i) => ({ flow: 2, key: 'p' + i, type: 'Simple', nameEn: p.nameEn || '', nameAr: p.nameAr || '', main: p.ref || null, colors: [], sizes: [], images: [] })); }

  // ---------------- 1 البداية ----------------
  async function takeSheet(file) {
    let cells;
    try {
      if (/\.csv$/i.test(file.name)) cells = PD.parseCsv(await file.text());
      else cells = await PD.parseXlsx(new Uint8Array(await file.arrayBuffer()));
    } catch (e) { K.toast('مقدرناش نقرا الشيت — ارفعه xlsx أو csv', 'error'); return; }
    const r = FD.readSheet(cells);
    if (!r.rows.length) { K.toast('الشيت مافيهوش صفوف بأسماء أو أسعار', 'error'); return; }
    const s = st(); s.rows = r.rows.map((x, i) => Object.assign(x, { key: newKey(), src: i + 1, ref: null, photos: [] }));
    s.sheetName = file.name.slice(0, 120); s.unknown = r.unknown; s.mapped = Object.keys(r.map).length;
    attachPhotos(); touch(); R();
  }
  // the photos by row number (decision 3): the sheet's row (case 1) or the product's number in the chat (case 2)
  function attachPhotos() {
    const s = st(); const byN = s.photoRows || {};
    // the maker's photos are references only (the owner, 1 Nov: «الأساسية = أول صورة اتعملها generate») — the shots start empty
    s.rows.forEach((r) => { const n = s.case === 'whatsapp' ? r.product : r.src; const ps = byN[n] || []; r.ref = ps[0] || null; r.photos = ps.slice(); });
  }
  async function takePhotos(files) {
    const s = st(); const named = files.map((f) => ({ f, at: FD.photoIndex(f.name) }));
    const bad = named.filter((x) => !x.at);
    if (bad.length) K.toast(bad.length + ' صورة اسمها مش بالترتيب (1، 2، 1-2…) — اتسابت', 'warning');
    const ok = named.filter((x) => x.at).sort((a, b) => a.at.row - b.at.row || a.at.order - b.at.order);
    S.busy = 'photos'; R();
    s.photoRows = s.photoRows || {}; let n = 0;
    for (const x of ok) {
      const r = await ST().uploadImage(S.id, x.f, 'p' + x.at.row + '-' + (x.at.order || 0), { webp: true });
      if (r.ok) { (s.photoRows[x.at.row] = s.photoRows[x.at.row] || []).push(r.path); n += 1; }
    }
    if (s.case === 'photos') s.products = Object.keys(s.photoRows).map(Number).sort((a, b) => a - b).map((k) => ({ n: k, ref: s.photoRows[k][0], photos: s.photoRows[k] }));
    else attachPhotos();
    S.busy = ''; touch(); R(); K.toast('اترفعت ' + n + ' صورة', 'success');
  }
  async function takeScreens(files) {
    const s = st();
    if (files.length > 8) K.toast('أول 8 سكرين شوتس بس', 'warning');
    S.busy = 'extract'; R();
    const r = await AI().extract(files.slice(0, 8), s.type, Object.keys(s.photoRows || {}).length);
    S.busy = '';
    if (!r.ok) { K.toast(why(r.reason, r.field), 'error'); R(); return; }
    if (r.result === 'refused' || !r.rows.length) { K.toast('الـ AI مالقاش منتجات في السكرين شوتس', 'warning'); R(); return; }
    s.rows = r.rows.map((x) => Object.assign(FD.blankRow(), x, { key: newKey(), src: x.product, ai: { extract: true } }));
    s.screens = files.length; attachPhotos(); touch(); R();
    K.toast('الـ AI طلّع ' + r.rows.length + ' صف — راجعهم', 'success');
  }
  function step1() {
    const s = st();
    const photosN = Object.values(s.photoRows || {}).reduce((t, l) => t + l.length, 0);
    const photosBtn = Button({ label: photosN ? 'بدّل / زوّد الصور (' + photosN + ')' : 'ارفع الصور', icon: 'upload', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) });
    const nameHelp = U.InlineNote({ children: 'سمّي الصور بترتيب الصفوف: «1»، «2»، «3»… ولو أكتر من صورة لنفس المنتج «1-1»، «1-2». أول صورة هي المرجعية.' });
    if (s.case === 'photos') {
      const kind = (k, label) => U.Select({ id: 'fl-k-' + k, label, value: String(s.kinds[k] || 0), options: [0, 1, 2, 3, 4, 5].map((x) => ({ value: String(x), label: x ? x + ' ' + label : 'من غير' })), onChange: (v) => { s.kinds[k] = Number(v); touch(); R(); } });
      const ok = s.type === 'Simple' || s.kinds.sizes > 0 || s.kinds.colors > 0;
      return [Card('الشيت هيبقى عامل إزاي', 'النوع ' + s.type + (s.type === 'Variable' ? ' — المتغيرات لحد 5 من كل نوع، وكل واحد بسعره.' : ''), [
        s.type === 'Variable' ? h('div', { class: 'grid2' }, kind('sizes', 'مقاسات'), kind('colors', 'ألوان')) : U.InlineNote({ children: 'كل منتج صف واحد.' }),
        s.type === 'Variable' && !ok ? U.InlineNote({ kind: 'warning', children: 'اختار مقاسات أو ألوان (أو الاتنين).' }) : null]),
      Foot(ok, 'اختار المتغيرات')];
    }
    const src = s.case === 'whatsapp'
      ? Card('سكرين شوتس الواتساب', 'لحد 8 سكرين شوتس — الـ AI بيقرا الأسماء والأسعار والألوان والمقاسات بالترتيب.', [
        h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'extract' ? 'بيقرا…' : s.rows.length ? 'اقرا سكرين شوتس تانية' : 'ارفع السكرين شوتس واقرا الداتا', disabled: S.busy === 'extract', attrs: { 'data-flow-screens': '' }, onClick: () => filePick('image/*', true, takeScreens) })),
        s.rows.length ? U.InlineNote({ kind: 'success', children: 'اتقرا ' + s.rows.length + ' صف من ' + (s.screens || 0) + ' سكرين — هتراجعهم في «البيانات».' }) : null,
        U.InlineNote({ children: 'ارفع صور المنتجات الأول عشان الـ AI يعرف عددها، وسمّيها بنفس ترتيب المنتجات في الشات.' })])
      : Card('الشيت', 'xlsx أو csv بالقالب بتاعنا أو بأي عناوين — بنطابق الأعمدة لوحدنا.', [
        h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: s.rows.length ? 'بدّل الشيت' : 'ارفع الشيت', attrs: { 'data-flow-sheet': '' }, onClick: () => filePick('.xlsx,.csv', false, (f) => takeSheet(f[0])) }), s.sheetName ? h('span', { class: 't-small help' }, s.sheetName) : null),
        s.rows.length ? U.InlineNote({ kind: 'success', children: s.rows.length + ' صف · ' + (s.mapped || 0) + ' عمود اتطابق' + (s.unknown && s.unknown.length ? ' · أعمدة مش في القالب: ' + s.unknown.join('، ') : '') }) : null]);
    const noRef = s.rows.filter((r) => !r.ref).length;
    const pics = Card('الصور', photosN ? photosN + ' صورة' + (s.rows.length ? ' · ' + (s.rows.length - noRef) + ' صف ليه صورة' : '') : 'صور المنتجات بجودة عالية', [h('div', { class: 'acts-inline' }, photosBtn, S.busy === 'photos' ? h('span', { class: 't-small help' }, 'بنرفع…') : null), nameHelp,
      s.rows.length && noRef ? U.InlineNote({ kind: 'warning', children: noRef + ' صف من غير صورة مرجعية — الصور بتتولّد من المرجعية، فارفعها أو كمّل من غيرها.' }) : null]);
    return [h('div', { class: 'cols2-wide' }, src, pics), Foot(s.rows.length > 0, s.case === 'whatsapp' ? 'اقرا السكرين شوتس الأول' : 'ارفع الشيت الأول')];
  }

  // ---------------- 2 المبتكر والبراند (decision 4) ----------------
  function step2() {
    const s = st(); const Vs = V(); const vd = Vs && Vs.data ? Vs.data() : null;
    if (Vs && Vs.state && Vs.state() === 'idle') Vs.load();
    const makers = Vs && Vs.store && Vs.store.all ? Vs.store.all().slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')) : [];
    const mk = makers.find((x) => x.id === s.vendorId) || null;
    const brands = (vd ? vd.brands : []).filter((b) => mk && String(b.owner) === String(mk.id));
    if (mk && !s.brandId && brands.length === 1) { setBrand(brands[0]); }
    const r = rateNow();
    const body = [
      h('div', { class: 'grid2' },
        U.Select({ id: 'fl-maker', label: 'المبتكر', required: true, value: s.vendorId || '', placeholder: vd ? 'اختار المبتكر' : 'بنحمّل المبتكرين…',
          options: makers.map((x) => ({ value: x.id, label: x.name + (x.wooVendorId == null ? ' (مالوش متجر على الموقع)' : '') })),
          onChange: (v) => { const m = makers.find((x) => x.id === v); s.vendorId = m ? m.id : null; s.vendorName = m ? m.name : ''; s.brandId = null; s.brandName = ''; s.code = ''; s.rate = null; s.fee = null; touch(); R(); },
          error: mk && mk.wooVendorId == null && s.case !== 'photos' ? 'المبتكر ده مالوش متجر على الموقع — اعمله متجر من ملفه الأول' : null }),
        h('div', { class: 'fl-new' }, Button({ size: 'sm', icon: 'plus', label: 'مبتكر جديد', onClick: () => { touch(true); go('makers/new'); } }))),
      mk ? h('div', { class: 'grid2' },
        U.Select({ id: 'fl-brand', label: 'البراند', required: true, value: s.brandId || '', placeholder: brands.length ? 'اختار البراند' : 'المبتكر مالوش براندات', options: brands.map((b) => ({ value: b.id, label: b.name })),
          onChange: (v) => { const b = brands.find((x) => x.id === v); if (b) setBrand(b); touch(); R(); } }),
        h('div', { class: 'fl-new' }, Button({ size: 'sm', icon: 'plus', label: 'براند جديد', onClick: () => newBrand(mk) }))) : null,
      s.brandId ? h('div', { class: 'grid2' }, U.FieldShell({ id: 'fl-code', label: 'كود البراند في الـ SKU (2–4 حروف)', help: 'مثال: glasstora → GLS — IBTGLS1020-OW' }, h('div', { class: 'input' }, h('input', { id: 'fl-code', dir: 'ltr', maxlength: 4, value: s.code || '', 'data-flow-code': '',
          onChange: (ev) => { s.code = String(ev.target.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); touch(); R(); } }))),
        h('div', { class: 'rate-field' }, h('span', { class: 't-small help' }, 'نسبة إبتكر (من حساب المبتكر)'), h('b', null, r == null ? '—' : U.num(r + '%')), h('small', { class: 'help' }, ' + ' + K.n0(feeNow()) + ' ج.م رسوم'))) : null,
      s.brandId && !FD.validCode(s.code) ? U.InlineNote({ kind: 'warning', children: 'كود البراند لازم 2–4 حروف إنجليزي.' }) : null];
    const ok = !!mk && !!s.brandId && FD.validCode(s.code) && (s.case === 'photos' || mk.wooVendorId != null);
    return [Card('المبتكر والبراند', 'المنتجات بتترفع على متجر المبتكر، والبراند بيتكتب في الشيت وكوده في الـ SKU.', body), Foot(ok, !mk ? 'اختار المبتكر' : !s.brandId ? 'اختار البراند' : 'كود البراند')];
  }
  function setBrand(b) { const s = st(); s.brandId = b.id; s.brandName = b.name; const c = String(b.code || '').toUpperCase(); s.code = FD.validCode(c) && c.length >= 3 ? c : FD.brandCode3(b.name); s.rows.forEach((r) => { if (!r.brand) r.brand = b.name; }); }
  function newBrand(mk) {
    K.form({ title: 'براند جديد لـ ' + mk.name, values: { name: '' }, submitLabel: 'ضيف البراند',
      fields: (f, e, set) => [K.field.text('name', 'اسم البراند (إنجليزي)', f, e, set, { required: true })],
      validate: (f) => (String(f.name || '').trim().length >= 2 && /[A-Za-z]{2}/.test(f.name) ? {} : { name: 'اكتب اسم البراند بالإنجليزي' }),
      submit: async (f) => {
        try { const r = await V().store.addBrand(mk.id, { name: String(f.name).trim(), code: FD.brandCode3(f.name) }, V().store.actor ? V().store.actor() : null); if (r && r.brand) { setBrand(r.brand); touch(); } R(); K.toast('اتضاف البراند', 'success'); }
        catch (e) { K.toast(e && e.message ? e.message : 'مقدرناش نضيف البراند', 'error'); }
      } });
  }

  // ---------------- 3 البيانات (decision 6) ----------------
  const ISSUE_FIELDS = (r) => FD.rowIssues(r).filter((x) => x !== 'سعر المبتكر' && x !== 'سعر البيع');
  // the SKU of every product that has none (decision 5): one serial per product from sku_serial_take; the colors not in the table added with a suggested code
  async function genSkus(silent) {
    const s = st(); if (!FD.validCode(s.code)) { if (!silent) K.toast('حدد كود البراند الأول', 'error'); return; }
    const need = groups().filter((g) => g.rows.some((ri) => !FD.validSku(rows()[ri].sku)));
    if (!need.length) { if (!silent) K.toast('كل المنتجات ليها SKU', 'success'); return; }
    const missingColors = [...new Map(need.flatMap((g) => g.rows.map((ri) => rows()[ri])).filter((r) => r.colorEn && !colorOf(r)).map((r) => [r.colorEn.toLowerCase(), r])).values()];
    for (const r of missingColors) {
      const code = PD.suggestColorCode(r.colorEn, colors().map((c) => c.code));
      const x = code ? await ST().addColor({ name_en: r.colorEn.trim().slice(0, 40), name_ar: (r.colorAr || r.colorEn).trim().slice(0, 40), code }) : { ok: false };
      if (!x.ok && !colorOf(r)) { K.toast('اللون «' + r.colorEn + '» مش في جدول الألوان ومقدرناش نضيفه', 'error'); return; }
    }
    const t = await ST().takeSerials(need.length);
    if (!t.ok) { K.toast('مقدرناش نحجز المسلسل — ' + why(t.reason), 'error'); return; }
    need.forEach((g, k) => {
      const serial = t.first + k; const rs = g.rows.map((ri) => rows()[ri]); const manySizes = new Set(rs.map((r) => r.size).filter(Boolean)).size > 1;
      rs.forEach((r) => { if (FD.validSku(r.sku)) return; r.sku = FD.skuOf({ code: s.code, serial, color: codeOfRow(r) || '', size: g.type === 'Variable' && manySizes ? r.size : '' }) || ''; });
    });
    touch(); R(); if (!silent) K.toast('اتعمل SKU لـ ' + need.length + ' منتج', 'success');
  }
  // «املأ بالـ AI» (decision 6): the names, the descriptions and the category the rows lack, product by product (IBAI.studio on the saved items)
  async function aiFill(only) {
    const gs = groups().map((g, gi) => ({ g, gi })).filter((x) => !only || x.g.rows.some((ri) => only.has(rows()[ri].key)));
    const todo = gs.filter(({ g }) => g.rows.some((ri) => { const r = rows()[ri]; return !r.nameEn || !r.nameAr || !r.shortEn || !r.shortAr || !catIdOf(r.catEn); }));
    if (!todo.length) { K.toast('مفيش بيانات ناقصة', 'success'); return; }
    await touch(true); S.busy = 'ai'; R(); let done = 0; let stop = '';
    for (const { g, gi } of todo) {
      const R0 = rows()[g.rows[0]];
      const want = [!R0.nameEn && 'nameEn', !R0.nameAr && 'nameAr', (!R0.shortEn || !R0.shortAr) && 'desc', !catIdOf(R0.catEn) && 'category'].filter(Boolean);
      const r = await AI().studio(S.id, gi, want);
      if (!r.ok) { stop = why(r.reason); break; }
      const f = r.fields || {};
      g.rows.forEach((ri) => { const x = rows()[ri]; x.ai = Object.assign({}, x.ai);
        if (f.nameEn && !x.nameEn) { x.nameEn = f.nameEn; x.ai.nameEn = true; } if (f.nameAr && !x.nameAr) { x.nameAr = f.nameAr; x.ai.nameAr = true; }
        if (f.shortDesc && !x.shortEn) { x.shortEn = f.shortDesc; x.ai.shortEn = true; } if (f.shortDescAr && !x.shortAr) { x.shortAr = f.shortDescAr; x.ai.shortAr = true; }
        if (Array.isArray(f.categories) && f.categories.length && !catIdOf(x.catEn)) { x.catEn = pathOfId(f.categories[0]); x.ai.catEn = true; } });
      done += 1; touch(); R();
    }
    S.busy = ''; R();
    K.toast(stop ? 'وقف بعد ' + done + ' منتج — ' + stop : 'اتملا ' + done + ' منتج بالـ AI — راجعهم', stop ? 'error' : 'success');
  }
  const DATA_COLS = ['sku', 'nameEn', 'nameAr', 'colorEn', 'colorAr', 'size', 'sizeAr', 'styleEn', 'styleAr', 'materialEn', 'materialAr', 'weight', 'brand', 'catEn', 'catAr', 'shortEn', 'shortAr'];
  const cell = (r, k) => {
    const wide = k.startsWith('short') ? ' w-wide' : k.startsWith('cat') || k.startsWith('name') ? ' w-mid' : '';
    const inp = h(k.startsWith('short') ? 'textarea' : 'input', { class: 'input fl-in' + wide + (r.ai && r.ai[k] ? ' is-ai' : ''), 'aria-label': FD.LABELS[k] + ' — ' + (r.nameEn || r.nameAr || r.sku || ''), 'data-fl': k, value: r[k] == null ? '' : String(r[k]), list: k === 'catEn' ? 'fl-cats' : undefined, dir: k.endsWith('Ar') ? 'rtl' : k === 'sku' ? 'ltr' : 'auto', rows: k.startsWith('short') ? 2 : undefined,
      onChange: (ev) => { const v = ev.target.value; r[k] = k === 'weight' ? (v === '' ? null : Number(v)) : v; if (r.ai) delete r.ai[k]; touch(); RF(); } });
    if (k.startsWith('short')) inp.value = r[k] || '';
    return h('td', null, inp);
  };
  const Cb = (label, checked, onChange) => h('button', { type: 'button', role: 'checkbox', class: 'cb', 'aria-checked': String(!!checked), 'aria-label': label, onClick: () => onChange(!checked) }, h('i', null, checked ? Icon('check', 'sm') : null));
  const selBox = (key, label) => Cb('حدد ' + (label || ''), S.sel.has(key), (v) => { if (v) S.sel.add(key); else S.sel.delete(key); R(); });
  const allBox = (keys) => Cb('حدد الكل', keys.length > 0 && keys.every((k) => S.sel.has(k)), (v) => { keys.forEach((k) => (v ? S.sel.add(k) : S.sel.delete(k))); R(); });
  function rowMenu(r, extra) {
    return K.RowMenu([{ label: 'تعديل', icon: 'edit', run: () => editRow(r) }].concat(extra || [], [{ label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => K.confirm({ title: 'تشيل «' + (r.nameEn || r.nameAr || r.sku || 'الصف') + '» من الدفعة؟', text: 'بيتشال من الدفعة دي بس.', okLabel: 'شيل', okType: 'danger', onOk: () => { const s = st(); s.rows = s.rows.filter((x) => x !== r); S.sel.delete(r.key); touch(); R(); } }) }]), 'إجراءات ' + (r.nameEn || r.sku || ''));
  }
  function editRow(r) {
    K.form({ title: 'تعديل — ' + (r.nameEn || r.nameAr || r.sku || 'الصف'), values: Object.fromEntries(DATA_COLS.map((k) => [k, r[k] == null ? '' : String(r[k])])), submitLabel: 'احفظ',
      fields: (f, e, set) => DATA_COLS.map((k) => K.field.text(k, FD.LABELS[k], f, e, set, k === 'sku' ? { help: 'فاضي = بيتولّد' } : {})),
      submit: (f) => { DATA_COLS.forEach((k) => { r[k] = k === 'weight' ? (f[k] === '' ? null : Number(f[k])) : String(f[k] || '').trim(); if (r.ai) delete r.ai[k]; }); touch(); R(); } });
  }
  function bulkEdit() {
    const keys = ['catEn', 'catAr', 'brand', 'styleEn', 'styleAr', 'materialEn', 'materialAr', 'nameEn', 'nameAr'];
    K.form({ title: 'تعديل مشترك لـ ' + S.sel.size + ' صف', values: Object.fromEntries(keys.map((k) => [k, ''])), submitLabel: 'طبّق على المحدد', note: U.InlineNote({ children: 'الخانة الفاضية مابتتغيّرش.' }),
      fields: (f, e, set) => keys.map((k) => K.field.text(k, FD.LABELS[k], f, e, set, {})),
      submit: (f) => { rows().filter((r) => S.sel.has(r.key)).forEach((r) => keys.forEach((k) => { const v = String(f[k] || '').trim(); if (v) { r[k] = v; if (r.ai) delete r.ai[k]; } })); touch(); R(); } });
  }
  const BulkBar = (btns) => (S.sel.size ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد' }, h('b', null, 'محدد ' + S.sel.size), h('span', { class: 'grow' }), ...btns, Button({ type: 'text', size: 'sm', label: 'إلغاء التحديد', onClick: () => { S.sel.clear(); R(); } })) : null);
  function step3() {
    const s = st(); const L = rows();
    if (S.autoSku !== S.id && FD.validCode(s.code) && L.some((r) => !FD.validSku(r.sku))) { S.autoSku = S.id; setTimeout(() => genSkus(true), 0); } // once per batch opened
    const miss = L.filter((r) => ISSUE_FIELDS(r).length).length;
    const dl = h('datalist', { id: 'fl-cats' }, cats().map((c) => h('option', { value: c.path.replace(/\s*›\s*/g, ' > ') })));
    const table = h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table' }, h('thead', null, h('tr', null, h('th', { class: 'stk c-cb' }, allBox(L.map((r) => r.key))), h('th', { class: 'stk c-ref' }, 'الصورة'), DATA_COLS.map((k) => h('th', null, FD.LABELS[k])), h('th', null, ''))),
      h('tbody', null, L.map((r) => h('tr', { class: ISSUE_FIELDS(r).length ? 'row-err' : null, 'data-row': r.key }, h('td', { class: 'stk c-cb' }, selBox(r.key, r.nameEn || r.sku)), h('td', { class: 'stk c-ref' }, Thumb(r.ref, 'st-big')), DATA_COLS.map((k) => cell(r, k)), h('td', null, rowMenu(r)))))));
    const head = Card('البيانات على القالب', L.length + ' صف · ' + groups().length + ' منتج' + (miss ? ' · ' + miss + ' ناقصهم بيانات' : ' · كاملين'), [dl,
      BulkBar([Button({ size: 'sm', icon: 'edit', label: 'تعديل مشترك', onClick: bulkEdit }), Button({ size: 'sm', icon: 'sparkle', label: 'املأ بالـ AI', disabled: !!S.busy, onClick: () => aiFill(new Set(S.sel)) }),
        Button({ size: 'sm', type: 'danger', icon: 'trash', label: 'احذف', onClick: () => K.confirm({ title: 'تحذف ' + S.sel.size + ' صف من الدفعة؟', okLabel: 'احذف', okType: 'danger', onOk: () => { s.rows = s.rows.filter((r) => !S.sel.has(r.key)); S.sel.clear(); touch(); R(); } }) })]),
      table, U.InlineNote({ children: 'الـ SKU بيتولّد لوحده للصف اللي مالوش (المسلسل من الموقع)، والخانات اللي اتملت بالـ AI عليها علامة لحد ما تتعدّل.' })],
      [Button({ size: 'sm', label: 'ولّد الـ SKU للناقص', attrs: { 'data-flow-sku': '' }, onClick: () => genSkus(false) }), Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: S.busy === 'ai' ? 'بيكتب…' : 'املأ الناقص بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-ai': '' }, onClick: () => aiFill(null) })]);
    return [head, Foot(L.length > 0 && L.every((r) => FD.validSku(r.sku)), 'كل الصفوف محتاجة SKU')];
  }

  // ---------------- 4 الأسعار (decision 7) ----------------
  // the rate hidden (no sensitive.commission) → no price is worked out: the member types the sale price
  function reprice(r, force) { if (rateNow() == null) return; const p = FD.pricesOf(r.vendorPrice, { rate: rateNow(), fee: feeNow(), markup: r.markup == null ? undefined : r.markup }); if (!p) return; if (r.markup == null) r.markup = p.markup; if (force || !r.priceHand) { r.sale = p.sale; r.regular = p.regular; } }
  function step4() {
    const L = rows(); const rate = rateNow();
    L.forEach((r) => { if (r.vendorPrice != null && r.sale == null) reprice(r); });
    const num = (r, k, onSet) => h('input', { class: 'input fl-num', inputmode: 'decimal', 'data-fl': k, 'aria-label': FD.LABELS[k] + ' — ' + (r.sku || ''), value: r[k] == null ? '' : String(r[k]), onChange: (ev) => { const v = ev.target.value.trim(); r[k] = v === '' ? null : Number(v); onSet(); touch(); RF(); } });
    const bulk = () => K.form({ title: 'سعر المبتكر لـ ' + S.sel.size + ' صف', values: { v: '' }, submitLabel: 'طبّق',
      fields: (f, e, set) => [K.field.text('v', 'سعر المبتكر (ج.م)', f, e, set, { required: true, inputmode: 'decimal' })], validate: (f) => (Number(f.v) > 0 ? {} : { v: 'رقم أكبر من صفر' }),
      submit: (f) => { L.filter((r) => S.sel.has(r.key)).forEach((r) => { r.vendorPrice = Number(f.v); r.priceHand = false; reprice(r, true); }); touch(); R(); } });
    const table = h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table fl-prices' }, h('thead', null, h('tr', null, h('th', { class: 'stk c-cb' }, allBox(L.map((r) => r.key))), h('th', { class: 'stk c-ref' }, 'الصورة'), h('th', null, 'المنتج'), h('th', null, 'سعر المبتكر'), h('th', null, 'نسبة إبتكر'), h('th', null, 'سعر البيع'), h('th', null, 'قبل الخصم'), h('th', null, ''))),
      h('tbody', null, L.map((r) => h('tr', { class: !(Number(r.sale) > 0) ? 'row-err' : null, 'data-row': r.key }, h('td', { class: 'stk c-cb' }, selBox(r.key, r.nameEn || r.sku)), h('td', { class: 'stk c-ref' }, Thumb(r.ref, 'st-big')),
        h('td', null, h('div', { class: 'fl-info' }, h('b', null, r.nameAr || '—'), h('span', null, r.nameEn || '—'), h('small', { dir: 'ltr' }, r.sku || ''), r.colorEn || r.size ? h('small', null, [r.colorEn, r.size].filter(Boolean).join(' · ')) : null)),
        h('td', null, num(r, 'vendorPrice', () => { r.priceHand = false; reprice(r, true); })), h('td', null, h('span', { class: 'help' }, rate == null ? '—' : U.num(rate + '%'))),
        h('td', null, num(r, 'sale', () => { r.priceHand = true; })), h('td', null, num(r, 'regular', () => { r.priceHand = true; })),
        h('td', null, K.RowMenu([{ label: 'احسب السعر تاني', icon: 'undo', run: () => { r.priceHand = false; r.markup = null; reprice(r, true); touch(); R(); } }, { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => { st().rows = st().rows.filter((x) => x !== r); touch(); R(); } }], 'إجراءات ' + (r.sku || '')))))))) ;
    const ok = L.length > 0 && L.every((r) => Number(r.sale) > 0);
    return [Card('الأسعار', 'سعر البيع = (سعر المبتكر + الرسوم) ÷ (1 − نسبة إبتكر) لأقرب 10، وقبل الخصم أعلى بـ 15–30%. نسبة إبتكر من حساب المبتكر.', [
      rate == null ? U.InlineNote({ kind: 'warning', children: 'نسبة المبتكر مش ظاهرة لك — السعر مش هيتحسب لوحده، اكتب سعر البيع بإيدك.' }) : null,
      BulkBar([Button({ size: 'sm', icon: 'edit', label: 'سعر المبتكر للمحدد', onClick: bulk })]), table]), Foot(ok, 'كل الصفوف محتاجة سعر بيع')];
  }

  // ---------------- 5 الصور (decision 8) ----------------
  const busyKey = (u, k) => 'img:' + u.key + ':' + k;
  async function genShot(u, k) {
    if (S.busy === busyKey(u, k)) return;
    await touch(true); S.busy = busyKey(u, k); R();
    const r = await IM().generate(S.id, u.gi, k, { color: u.color || undefined });
    S.busy = '';
    if (!r.ok || r.result !== 'ok' || !r.path) { K.toast(r.ok ? 'الموديل رفض الصورة' : (IM().why ? IM().why(r) : why(r.reason)), 'error'); R(); return false; }
    if (k === 4) st().sizeShot[groupKey(u.gi)] = r.path; else shotsOf(u)[k] = r.path;
    touch(); R(); return true;
  }
  async function genMissing(list) {
    const jobs = []; list.forEach((u) => { shotsOf(u).forEach((p, k) => { if (!p) jobs.push([u, k]); }); if (!st().sizeShot[groupKey(u.gi)] && unitRow(u).size) jobs.push([u, 4]); });
    if (!jobs.length) { K.toast('مفيش صور ناقصة', 'success'); return; }
    let ok = 0; for (const [u, k] of jobs) { if (await genShot(u, k)) ok += 1; }
    K.toast('اتولّدت ' + ok + ' من ' + jobs.length + ' صورة', ok === jobs.length ? 'success' : 'warning');
  }
  function shotModal(u, k) {
    const sh = shotsOf(u); const path = k === 4 ? st().sizeShot[groupKey(u.gi)] : sh[k]; let words = '';
    const m = U.Modal({ title: (k === 4 ? 'صورة المقاس' : SHOT_L[k]) + ' — ' + (unitRow(u).nameEn || unitRow(u).sku || ''), body: [Thumb(path, 'st-xl'), U.Textarea({ id: 'fl-edit', label: 'عدّل بالـ AI', rows: 2, placeholder: 'مثال: خلفية أفتح وظل أخف، من غير ما المنتج يتغيّر', onInput: (v) => { words = v; } })],
      footer: [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() }), Button({ label: 'بدّل بصورة من عندي', icon: 'upload', onClick: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'u' + u.gi + '-' + k, { webp: true }); if (r.ok) { if (k === 4) st().sizeShot[groupKey(u.gi)] = r.path; else sh[k] = r.path; touch(); m.close(); R(); } }) }),
        Button({ type: 'primary', icon: 'sparkle', label: 'عدّل', onClick: async () => { if (!words.trim() || !path) return; await touch(true); m.close(); S.busy = busyKey(u, k); R(); const r = await IM().edit({ batchId: S.id, index: u.gi, path }, 'instruction', { prompt: words.trim() }); S.busy = ''; if (r.ok && r.path) { if (k === 4) st().sizeShot[groupKey(u.gi)] = r.path; else sh[k] = r.path; touch(); } else K.toast(why(r.reason), 'error'); R(); } })] });
  }
  function slot(u, k) {
    const sh = shotsOf(u); const path = k === 4 ? st().sizeShot[groupKey(u.gi)] : sh[k]; const gen = S.busy === busyKey(u, k);
    const el = h('div', { class: 'fl-slot' + (path ? '' : ' empty'), draggable: path && k < 4 ? 'true' : 'false', 'data-slot': u.key + ':' + k },
      h('small', { class: 'help' }, k === 4 ? 'صورة المقاس' : SHOT_L[k]), gen ? h('span', { class: 'thumb st-big gen' }, 'بيتولّد…') : Thumb(path, 'st-big'),
      h('div', { class: 'acts-inline' }, path ? Button({ size: 'sm', label: 'تعديل', onClick: () => shotModal(u, k) }) : null,
        path ? U.IconButton({ icon: 'trash', label: 'حذف', onClick: () => { if (k === 4) delete st().sizeShot[groupKey(u.gi)]; else sh[k] = null; touch(); R(); } }) : null,
        !path ? Button({ size: 'sm', icon: 'sparkle', label: 'ولّد بالـ AI', disabled: !!S.busy, attrs: { 'data-gen': u.key + ':' + k }, onClick: () => genShot(u, k) }) : null));
    if (k < 4) {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', u.key + ':' + k); });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => { e.preventDefault(); const [key, from] = String(e.dataTransfer.getData('text/plain')).split(/:(?=\d$)/); if (key !== u.key) return; const a = Number(from); const t = sh[a]; sh[a] = sh[k]; sh[k] = t; touch(); R(); });
    }
    return el;
  }
  function step5() {
    const s = st(); const us = units(); const rate = rateNow();
    const features = Card('صورة المميزات', 'صورة واحدة للدفعة كلها — بتتحط في آخر صور كل المنتجات.', [h('div', { class: 'fl-feat' }, Thumb(s.features, 'st-big'),
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', icon: 'upload', label: s.features ? 'بدّل' : 'ارفع صورة المميزات', attrs: { 'data-flow-features': '' }, onClick: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'features', { webp: true }); if (r.ok) { s.features = r.path; touch(); R(); } }) }),
        s.features ? U.IconButton({ icon: 'trash', label: 'حذف صورة المميزات', onClick: () => { s.features = null; touch(); R(); } }) : null))]);
    const list = us.map((u) => { const r = unitRow(u);
      return h('div', { class: 'fl-unit', 'data-unit': u.key }, h('div', { class: 'fl-ucb' }, selBox(u.key, r.nameEn || r.sku)),
        h('div', { class: 'fl-uref' }, Thumb(r.ref, 'st-big'), h('div', { class: 'fl-info' }, h('b', null, r.nameAr || r.nameEn || '—'), h('span', null, r.nameEn || ''), h('small', { dir: 'ltr' }, FD.imageSku(r.sku, r.size) || ''),
          h('span', null, h('b', { class: 'brand-t' }, money(r.sale)), ' ', h('s', { class: 'help' }, money(r.regular))), h('small', { class: 'help' }, 'نسبة إبتكر ' + (rate == null ? '—' : rate + '%')))),
        h('div', { class: 'fl-slots' }, [0, 1, 2, 3].map((k) => slot(u, k))), h('div', { class: 'fl-slots fl-extra' }, slot(u, 4)),
        h('div', null, K.RowMenu([{ label: 'ولّد الناقص للمنتج ده', icon: 'sparkle', run: () => genMissing([u]) }, { label: 'امسح صوره', icon: 'trash', danger: true, run: () => { s.shots[u.key] = [null, null, null, null]; touch(); R(); } }], 'إجراءات ' + (r.sku || ''))));
    });
    const sel = us.filter((u) => S.sel.has(u.key));
    return [features, Card('صور المنتجات', us.length + ' ' + (isVar() ? 'لون' : 'منتج') + ' · 1 في النص · 2 و3 البيئة · 4 التفاصيل (4 أجزاء) · المقاس رسم بالـ AI. اسحب الصورة على خانة تانية تبدّلهم.', [BulkBar([Button({ size: 'sm', icon: 'sparkle', label: 'ولّد الناقص للمحدد', disabled: !!S.busy, onClick: () => genMissing(sel) })]), h('div', { class: 'fl-units' }, list)],
      [Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: 'ولّد الناقص بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-genall': '' }, onClick: () => genMissing(us) })]), Foot(true)];
  }

  // ---------------- 6 الرفع (decision 10) ----------------
  // every photo the site gets, with its name: the 4 shots (01–04) of each unit, the size drawing (05) of each product, the features image (06) once
  function mediaList() {
    const s = st(); const out = []; const seen = new Set();
    const add = (path, name) => { if (path && !seen.has(path)) { seen.add(path); out.push({ path, name: name.replace(/\.webp$/, '.' + (/\.(png|jpe?g)$/i.exec(path) ? /\.(png|jpe?g)$/i.exec(path)[1].toLowerCase().replace('jpeg', 'jpg') : 'webp')) }); } };
    units().forEach((u) => { const r = unitRow(u); shotsOf(u).forEach((p, k) => add(p, FD.fileName(r.nameEn || r.sku, FD.imageSku(r.sku, r.size), k + 1))); });
    // the size drawing: 05 of the product (a Simple's SKU as its photos carry it; a Variable's base SKU)
    groups().forEach((g, gi) => { const r = rows()[g.rows[0]]; add(s.sizeShot[groupKey(gi)], FD.fileName(r.nameEn || r.sku, g.type === 'Variable' ? FD.skuBase(r.sku) : FD.imageSku(r.sku, r.size), 5)); });
    if (s.features) add(s.features, FD.slugName((s.brandName || 'Ibtekr') + ' Features') + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.webp');
    return out;
  }
  const resultOf = () => (S.row && S.row.result) || {};
  const urlOf = (m) => (resultOf().urls && resultOf().urls[m.path]) || FD.siteUrl(m.name);
  // the sheet's rows with their links (the uploaded file's link, else the one it will have)
  function sheetRows() {
    const s = st(); const ml = new Map(mediaList().map((m) => [m.path, m]));
    const link = (p) => (p && ml.get(p) ? urlOf(ml.get(p)) : '');
    return rows().map((r) => { const u = units().find((x) => x.rows.includes(rows().indexOf(r))); const gi = u ? u.gi : 0;
      const imgs = (u ? shotsOf(u) : []).map(link); while (imgs.length < 4) imgs.push(''); imgs.push(link(s.sizeShot[groupKey(gi)]), link(s.features));
      return Object.assign({}, r, { images: imgs }); });
  }
  async function refreshRow() { const row = await ST().open(S.id); if (row) S.row = Object.assign({}, S.row, { result: row.result, status: row.status }); }
  async function uploadImages() {
    await refreshRow(); const all = mediaList(); const have = resultOf().media || {};
    const todo = all.filter((m) => !have[m.path]);
    if (!todo.length) { K.toast('كل الصور مرفوعة على الموقع', 'success'); return; }
    S.prog.img = { done: all.length - todo.length, total: all.length, on: true }; R(); let fail = '';
    for (const m of todo) {
      const r = await ST().media(S.id, m.path, m.name);
      if (!r.ok) { fail = why(r.reason); break; }
      if (r.result === 'skipped') { fail = why(r.reason); break; }
      S.prog.img.done += 1; R();
    }
    S.prog.img.on = false; await refreshRow(); R();
    K.toast(fail ? 'وقف الرفع — ' + fail : 'اترفعت الصور على الموقع', fail ? 'error' : 'success');
  }
  async function zipImages() {
    const all = mediaList(); if (!all.length) { K.toast('مفيش صور', 'warning'); return; }
    S.prog.img = { done: 0, total: all.length, on: true }; R(); const files = [];
    for (const m of all) { const b = await ST().bytesOf(m.path); if (b) files.push({ name: m.name, data: b }); S.prog.img.done += 1; R(); }
    S.prog.img.on = false; R();
    K.saveFile((st().vendorName || 'Products').replace(/[\\/:*?"<>|]+/g, '-') + ' - images.zip', new Blob([PD.zip(files)], { type: 'application/zip' }));
  }
  // the reference picture of a row, small, for its cell (105 × 120 like the owner's sheet)
  async function thumbBytes(path) {
    const b = path ? await ST().bytesOf(path) : null; if (!b) return null;
    try {
      const bmp = await createImageBitmap(new Blob([b])); const cv = document.createElement('canvas'); cv.width = 210; cv.height = 240;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 210, 240); const k = Math.min(210 / bmp.width, 240 / bmp.height); const w = bmp.width * k; const hh = bmp.height * k; ctx.drawImage(bmp, (210 - w) / 2, (240 - hh) / 2, w, hh);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8)); return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch (e) { return null; }
  }
  async function sheetFile(rowsOut, type, prog) {
    const sh = FD.sheetOf({ type, rows: rowsOut }); const images = [];
    for (let i = 0; i < rowsOut.length; i++) { const bytes = await thumbBytes(rowsOut[i].ref); if (bytes) images.push({ row: i, col: sh.refCol, bytes, ext: 'jpeg', w: 105, h: 120 }); if (prog) { prog.done = i + 1; R(); } }
    return new Blob([FD.xlsx(Object.assign(sh, { images, freeze: 'C2' }))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function downloadSheet() {
    const L = sheetRows(); S.prog.sheet = { done: 0, total: L.length, on: true }; R();
    const blob = await sheetFile(L, st().type, S.prog.sheet); S.prog.sheet.on = false; R();
    K.saveFile(FD.sheetFileName(st().vendorName || st().brandName), blob);
  }
  function previewSheet(L, type) {
    const sh = FD.sheetOf({ type, rows: L });
    U.Modal({ title: 'معاينة الشيت — ' + L.length + ' صف', body: [h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table fl-preview' }, h('thead', null, h('tr', null, sh.head.map((x) => h('th', null, x)))),
      h('tbody', null, sh.rows.slice(0, 200).map((r, i) => h('tr', null, r.map((c, k) => h('td', null, k === sh.refCol ? Thumb(L[i].ref, 'st-sm') : typeof c === 'object' && c ? '=' + c.f : String(c == null ? '' : c)))))))),
    L.length > 200 ? U.InlineNote({ children: 'أول 200 صف بس في المعاينة.' }) : null] });
  }
  function previewImages() {
    U.Modal({ title: 'معاينة الصور', body: [h('div', { class: 'fl-units' }, units().map((u) => { const r = unitRow(u); return h('div', { class: 'fl-unit ro' }, h('div', { class: 'fl-uref' }, Thumb(r.ref, 'st-big'), h('div', { class: 'fl-info' }, h('b', null, r.nameAr || r.nameEn || ''), h('small', { dir: 'ltr' }, FD.imageSku(r.sku, r.size)))),
      h('div', { class: 'fl-slots' }, shotsOf(u).map((p) => Thumb(p, 'st-big')).concat([Thumb(st().sizeShot[groupKey(u.gi)], 'st-big')]))); }))] });
  }
  async function uploadSheet() {
    await refreshRow(); const all = mediaList(); const have = resultOf().media || {};
    if (all.some((m) => !have[m.path])) { K.toast('ارفع الصور الأول — الشيت لينكاته من الصور، ومن غيرها الرفع هيدّي خطأ', 'error'); return; }
    const items = buildItems(); st().items = items; await touch(true);
    S.prog.sheet = { done: 0, total: items.length, on: true }; S.results = []; R();
    for (let i = 0; i < items.length; i++) {
      const r = await ST().upload(S.id, i);
      S.results[i] = r.ok ? (r.result === 'skipped' ? { error: 'push_disabled' } : r.item) : { error: r.reason, field: r.field };
      S.prog.sheet.done = i + 1; R();
      if (r.ok && r.result === 'skipped') break;
    }
    S.prog.sheet.on = false; await refreshRow(); R();
    const bad = S.results.filter((x) => x && x.error).length;
    K.toast(bad ? bad + ' منتج ماترفعش — شوف السبب تحت' : 'اترفعت المنتجات مسودة على الموقع', bad ? 'error' : 'success');
  }
  const Prog = (p) => (p ? h('div', { class: 'fl-prog' }, h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round((p.done / Math.max(1, p.total)) * 100) + '%' })), h('b', null, Math.round((p.done / Math.max(1, p.total)) * 100) + '%')) : null);
  function step6() {
    const all = mediaList(); const have = resultOf().media || {}; const up = all.filter((m) => have[m.path]).length;
    const gs = groups(); const vars = gs.filter((g) => g.type === 'Variable').reduce((t, g) => t + g.rows.length, 0);
    const busy = (S.prog.img && S.prog.img.on) || (S.prog.sheet && S.prog.sheet.on);
    const imgBox = h('section', { class: 'card fl-box', 'data-box': 'images' }, h('div', { class: 'fl-box-h' }, h('div', null, h('h2', { class: 't-h4' }, 'الصور'), h('div', { class: 't-small help' }, gs.length + ' منتج · ' + all.length + ' صورة' + (up ? ' · اترفع ' + up : ''))),
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', label: 'معاينة', onClick: previewImages }), Button({ size: 'sm', type: 'primary', label: 'رفع مباشر', disabled: busy || !all.length, attrs: { 'data-up': 'images' }, onClick: uploadImages }), Button({ size: 'sm', label: 'تحميل على الجهاز', disabled: busy || !all.length, onClick: zipImages }))), Prog(S.prog.img),
      h('small', { class: 't-small help' }, 'الأسامي: <اسم المنتج>-<SKU>-01.webp … والمقاس 05 والمميزات 06 — نفس اللي في لينكات الشيت.'));
    const sheetBox = h('section', { class: 'card fl-box', 'data-box': 'sheet' }, h('div', { class: 'fl-box-h' }, h('div', null, h('h2', { class: 't-h4' }, 'الشيت'), h('div', { class: 't-small help' }, gs.length + ' منتج' + (vars ? ' · ' + vars + ' متغير' : ''))),
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', label: 'معاينة', onClick: () => previewSheet(sheetRows(), st().type) }), Button({ size: 'sm', type: 'primary', label: 'رفع مباشر', disabled: busy, attrs: { 'data-up': 'sheet' }, onClick: uploadSheet }), Button({ size: 'sm', label: 'تحميل على الجهاز', disabled: busy, onClick: downloadSheet }))), Prog(S.prog.sheet),
      h('small', { class: 't-small help' }, 'الرفع المباشر بيعمل المنتجات مسودة على الموقع على متجر المبتكر بالـ SKU والصور المرفوعة.'));
    const res = S.results ? Card('نتيجة الرفع', null, [h('div', { class: 'fl-res' }, S.results.map((x, i) => { const g = gs[i]; const r = g ? rows()[g.rows[0]] : {};
      return h('div', { class: 'fl-res-row' + (x && x.error ? ' bad' : '') }, h('b', { dir: 'ltr' }, (x && x.sku) || r.sku || '#' + (i + 1)), h('span', null, r.nameAr || r.nameEn || ''), x && x.error ? Tag('error', why(x.error, x.field)) : Tag('success', 'مسودة #' + (x && x.productId))); }))]) : null;
    return [h('div', { class: 'fl-boxes' }, imgBox, sheetBox), res, U.InlineNote({ children: 'ارفع الصور الأول وبعدها الشيت، أو نزّلهم على الجهاز.' })];
  }

  // ---------------- case 3: 3 الصور · 4 الشيت (decision 12) ----------------
  function stepPhotos() {
    const s = st(); const n = (s.products || []).length;
    return [Card('صور المنتجات', n ? n + ' منتج' : 'صورة لكل منتج بالترتيب', [h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: n ? 'بدّل / زوّد الصور' : 'ارفع الصور', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) })),
      U.InlineNote({ children: 'سمّي الصور «1»، «2»، «3»… ولو أكتر من صورة لنفس المنتج «1-1»، «1-2». أول صورة للمنتج هي اللي بتتحط في الشيت.' }),
      n ? h('div', { class: 'fl-grid' }, s.products.map((p) => h('div', { class: 'fl-pcard' }, Thumb(p.ref, 'st-big'), h('b', null, 'منتج ' + p.n), h('small', { class: 'help' }, p.photos.length + ' صورة')))) : null]), Foot(n > 0, 'ارفع الصور')];
  }
  function blankRowsOf() {
    const s = st(); const L = FD.blankSheetRows({ type: s.type, products: (s.products || []).length, kinds: s.kinds });
    return L.map((r) => { const p = s.products[r.product]; const k = r.variant ? (p.n + '-' + r.variant) : String(p.n); const x = (s.fill && s.fill[r.product]) || {};
      return Object.assign(r, { n: k, ref: p.ref, brand: s.brandName, nameEn: x.nameEn || '', nameAr: x.nameAr || '', catEn: x.catEn || '', shortEn: x.shortEn || '', shortAr: x.shortAr || '', colorEn: r.colorSlot > 1 ? '' : x.colorEn || '', colorAr: r.colorSlot > 1 ? '' : x.colorAr || '', images: [] }); });
  }
  async function aiFillProducts() {
    const s = st(); await touch(true); S.busy = 'ai'; R(); s.fill = s.fill || {}; let stop = '';
    for (let i = 0; i < s.products.length; i++) {
      if (s.fill[i] && s.fill[i].nameEn) continue;
      const r = await AI().studio(S.id, i, ['nameEn', 'nameAr', 'desc', 'category', 'variations']);
      if (!r.ok) { stop = why(r.reason); break; }
      const f = r.fields || {}; const c = (f.colors || [])[0] ? colors().find((x) => x.code === f.colors[0]) : null;
      s.fill[i] = { nameEn: f.nameEn || '', nameAr: f.nameAr || '', shortEn: f.shortDesc || '', shortAr: f.shortDescAr || '', catEn: (f.categories || [])[0] ? pathOfId(f.categories[0]) : '', colorEn: c ? c.name_en : '', colorAr: c ? c.name_ar : '' };
      touch(); R();
    }
    S.busy = ''; R(); K.toast(stop || 'الـ AI ملا الأسماء والأقسام والألوان — سعر المبتكر والمقاس للمبتكر', stop ? 'error' : 'success');
  }
  async function shareSheet(how) {
    const blob = await sheetFile(blankRowsOf(), st().type, null); const name = FD.sheetFileName(st().vendorName || st().brandName);
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    K.saveFile(name, blob);
    const text = 'شيت المنتجات من إبتكر — املا سعر المبتكر والمقاس وابعته تاني.';
    const url = how === 'mail' ? 'mailto:?subject=' + encodeURIComponent('شيت المنتجات — ' + name) + '&body=' + encodeURIComponent(text + '\n(الملف اتنزل على جهازك — ارفقه)') : 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
    K.toast('الملف اتنزل — ارفقه في ' + (how === 'mail' ? 'الإيميل' : 'الواتساب'), 'success');
  }
  function stepSheet() {
    const L = blankRowsOf(); const s = st();
    const shareBtn = (() => { const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const btn = Button({ size: 'sm', icon: 'share', label: 'مشاركة', attrs: { 'data-flow-share': '', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ role: 'menu', end: true, options: [{ value: 'wa', label: 'واتساب', icon: 'whatsapp' }, { value: 'mail', label: 'إيميل', icon: 'mail' }], onSelect: (v) => { close(); shareSheet(v); } }));
      btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap; })();
    return [Card('الشيت', L.length + ' صف · ' + s.products.length + ' منتج — عمود «refrance image» فيه صورة كل منتج، والباقي القالب كامل.', [
      h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'ai' ? 'بيكتب…' : 'املأ بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-ai': '' }, onClick: aiFillProducts }),
        Button({ size: 'sm', label: 'معاينة', onClick: () => previewSheet(L, s.type) }), Button({ size: 'sm', icon: 'download', label: 'تحميل على الجهاز', attrs: { 'data-flow-download': '' }, onClick: async () => { const blob = await sheetFile(L, s.type, null); K.saveFile(FD.sheetFileName(s.vendorName || s.brandName), blob); } }), shareBtn),
      U.InlineNote({ children: 'سعر المبتكر والمقاس فاضيين — المبتكر بيملاهم. لما يرجّعه، ابدأ دفعة «شيت جاهز» بيه.' }),
      h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table fl-preview' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'الصورة'), h('th', null, 'الاسم EN'), h('th', null, 'الاسم AR'), h('th', null, 'اللون'), h('th', null, 'المقاس'), h('th', null, 'سعر المبتكر'), h('th', null, 'القسم'))),
        h('tbody', null, L.map((r) => h('tr', null, h('td', null, r.n), h('td', null, Thumb(r.ref, 'st-sm')), h('td', null, r.nameEn || '—'), h('td', null, r.nameAr || '—'), h('td', null, r.colorEn || (r.colorSlot ? 'لون ' + r.colorSlot : '—')), h('td', null, r.sizeSlot ? 'مقاس ' + r.sizeSlot : '—'), h('td', null, '—'), h('td', null, r.catEn || '—'))))))])];
  }

  // ---------------- the wizard ----------------
  function Foot(ok, whyNot) {
    const n = steps().length; const back = S.step > 1 ? S.step - 1 : null; const next = S.step < n ? S.step + 1 : null;
    return h('div', { class: 'wiz-foot card' }, h('span', { class: 't-small help' }, ok === false && whyNot ? whyNot : 'الخطوة ' + S.step + ' من ' + n + ' · بتتحفظ لوحدها'), h('span', { class: 'grow' }),
      back ? Button({ label: 'رجوع', onClick: () => goStep(back) }) : null,
      next ? Button({ type: 'primary', label: 'التالي: ' + steps()[next - 1], disabled: ok === false, attrs: { 'data-flow-next': '' }, onClick: () => goStep(next) }) : null);
  }
  function Stepper() {
    const L = steps(); const reach = Math.max((S.row && S.row.step) || 1, S.step);
    return h('ol', { class: 'wstepper card', 'aria-label': 'خطوات الدفعة' }, L.map((t, i) => { const n = i + 1; const stt = n < S.step ? 'done' : n === S.step ? 'cur' : 'up';
      return h('li', { class: 'stp stp-' + stt, 'aria-current': stt === 'cur' ? 'step' : false }, h('button', { type: 'button', class: 'stp-b', disabled: n > reach || n === S.step, onClick: () => goStep(n), 'aria-label': 'الخطوة ' + n + ': ' + t },
        h('span', { class: 'stp-n' }, stt === 'done' ? Icon('check', 'sm') : K.Num(String(n))), h('span', { class: 'stp-l' }, t))); }));
  }
  function view(head) {
    if (!ST() || !ST().can()) return [head, K.Empty('مش مسموحلك تضيف منتجات', 'اطلب صلاحية «إضافة منتجات» من الأدمن.')];
    ST().ensure();
    if (S.err) return [head, K.Empty('الدفعة مش متاحة', S.err, Button({ size: 'sm', label: 'رجوع لإضافة', onClick: () => go('products-add') }))];
    if (S.loading || !st()) return [head, U.InlineNote({ children: 'بنفتح الدفعة…' })];
    const s = st(); const photos = s.case === 'photos';
    const body = S.step === 1 ? step1() : S.step === 2 ? step2() : photos ? (S.step === 3 ? stepPhotos() : stepSheet()) : S.step === 3 ? step3() : S.step === 4 ? step4() : S.step === 5 ? step5() : step6();
    const title = (s.brandName || s.vendorName || 'دفعة جديدة') + ' — ' + CASES[s.case] + ' · ' + s.type;
    const top = h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('small', { class: 't-small help' }, 'المنتجات › إضافة › استوديو المنتجات'), h('h1', { class: 't-h3' }, title)),
      h('div', { class: 'actions' }, Button({ type: 'text', label: 'اخرج', onClick: () => { touch(true); go('products-add'); } })));
    return [h('div', { class: 'wiz-col wiz-studio fl', 'data-wiz-col': 'flow', 'data-flow-case': s.case }, top, Stepper(), ...body.filter(Boolean))];
  }

  window.IBFlowView = { route, view, start, state: S, CASES };
})();
