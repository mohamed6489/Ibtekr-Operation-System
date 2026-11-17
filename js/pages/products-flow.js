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
  const STEPS = { data: ['البداية', 'المبتكر', 'البيانات', 'الأسعار', 'الصور', 'الرفع'], photos: ['البداية', 'المبتكر', 'الصور', 'الشيت'] };
  const SHOT_L = ['صورة 1 · في النص', 'صورة 2 · البيئة', 'صورة 3 · البيئة', 'صورة 4 · التفاصيل'];
  const REASON = { push_disabled: 'الكتابة على الموقع متقفلة (WOO_PUSH_ENABLED)', forbidden: 'مش مسموحلك', network: 'مشكلة في الاتصال — جرّب تاني', invalid: 'البيانات ناقصة أو مش صحيحة', missing: 'مش لاقيين الدفعة',
    images_first: 'ارفع الصور الأول — الشيت لينكاته من الصور', product_invalid_sku: 'الـ SKU ده موجود على الموقع', product_refused: 'الموقع رفض المنتج', author_failed: 'المبتكر ماتحطش على المنتج — جرّب تاني',
    not_configured: 'الـ AI لسه مش متوصّل', ai_cap: 'وصلنا لحد الـ AI الشهري', busy: 'الـ AI مشغول — جرّب كمان شوية', ai_error: 'الـ AI ماردش — جرّب تاني', not_image: 'الملف ده مش صورة' };
  const why = (code, field) => (REASON[code] || 'حصلت مشكلة (' + code + ')') + (field ? ' — ' + field : '');

  // ---------------- state ----------------
  const S = { id: null, row: null, step: 1, loading: false, err: '', timer: null, sel: new Set(), busy: '', tr: new Set(), prog: { img: null, sheet: null }, results: null };
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
    S.row = row; if (dropOldSheetPics()) touch(); R();
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
  async function goStep(n) {
    // comments decision 41: the first step is not left forward while a product has no photo or a photo has no row (the stepper too)
    if (n > 1 && S.step === 1) { const g = photoGapsNow(); if (g.missing.length || g.extra.length) { K.toast(g.missing.length ? g.missing.length + ' منتج من غير صورة — ارفع صورته الأول' : 'فيه صور زيادة مالهاش صف — امسحها أو حطها قدام صفها', 'error'); return; } }
    await touch(true); S.sel.clear(); go(hashFor(n));
  }

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
  // the size in Arabic for a display (the owner 15 Nov: the product's Arabic data): the Arabic one, else the English with its unit in Arabic
  const arSize = (r) => r.sizeAr || String(r.size || '').replace(/\bcm\b/gi, 'سم').replace(/\bmm\b/gi, 'مم').replace(/\bkg\b/gi, 'كجم');
  const newKey = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const groups = () => FD.groupRows(rows(), st().type);
  const colors = () => (ST() ? ST().colors() : []);
  // comments decision 51 («الاستايل ييجي من الاستايلات اللي علي الويبسايت بس»): the styles are the shop's own — the terms of the site's
  // «Product Style» attribute (IBStudio.siteStyles), each with its Arabic name (the site's, else this page's, else the English one).
  // While they are not read yet, or the site has none, the page's own list stands in.
  const shopStyles = () => !!(ST() && ST().siteStyles && ST().siteStyles().length);
  // one entry per style even if the site repeats one (owner 16 Nov: «بوهيمي» twice) — same English or same Arabic name = once
  const styleList = () => { const L = ST() && ST().siteStyles ? ST().siteStyles() : []; if (!L.length) return FD.STYLES;
    const seen = new Set(); const key = (v) => String(v || '').trim().toLowerCase();
    return L.map((x) => [x.en, x.ar || (FD.pairOf(FD.STYLES, x.en, '') || [])[1] || x.en]).filter(([en, ar]) => { const e = key(en); const a = key(ar);
      if (seen.has(e) || seen.has(a)) return false; seen.add(e); seen.add(a); return true; }); };
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
  // a row's group head (a Variable's variations share its category)
  const headOf = (r) => { const i = rows().indexOf(r); const g = groups().find((x) => x.rows.includes(i)); return g ? rows()[g.rows[0]] : r; };
  // the rate a product is priced with (the owner 15 Nov — a category can have its own rate): the batch's own when set, else what Dokan
  // takes on it — a «category_based» maker's rate on the product's category or its nearest parent with one, else his general rate
  // (IBProducts.commissionParams, the same reading as the products' «Commission»). → { rate, fee, byCat } or null (not visible)
  function commOf(r) {
    const s = st(); if (s.rate != null) return { rate: Number(s.rate), fee: feeNow(), byCat: false };
    const cid = catIdOf((r && r.catEn) || headOf(r).catEn);
    const c = s.vendorId && PR() && PR().commissionParams ? PR().commissionParams({ vendorId: s.vendorId, categoryIds: cid == null ? [] : [cid] }) : null;
    if (c && c.rate != null) return { rate: Number(c.rate), fee: Number(c.fee) || 0, byCat: c.source === 'category' };
    const rt = rateNow(); return rt == null ? null : { rate: rt, fee: feeNow(), byCat: false };
  }
  const commKey = (c) => (c ? c.rate + '|' + c.fee : '');
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
  // case 3: one item per product (its photo as the reference) — for the AI fill — then one item per color slot that has a photo of its
  // own (the product's n-th photo, or the one swapped in the sheet), so the AI reads each color from its own picture (the owner 15 Nov)
  function productItems() {
    const s = st(); const out = (s.products || []).map((p, i) => ({ flow: 2, key: 'p' + i, type: 'Simple', nameEn: p.nameEn || '', nameAr: p.nameAr || '', main: p.ref || null, colors: [], sizes: [], images: [] }));
    colorUnits().forEach((cu) => { out.push({ flow: 2, key: 'p' + cu.product + 'c' + cu.slot, type: 'Simple', nameEn: '', nameAr: '', main: cu.photo, colors: [], sizes: [], images: [] }); });
    return out;
  }
  // the picture of a sheet row: the one swapped in for it, else its color slot's photo (the product's n-th photo), else the product's first
  const rowPhotoKey = (r) => String(r.variant || 0);
  function slotPhoto(i, slot) { const p = (st().products || [])[i]; if (!p) return null; return (slot >= 1 && Array.isArray(p.photos) && p.photos[slot - 1]) || p.ref || null; }
  function rowRef(r) { const x = (st().fill || {})[r.product] || {}; const own = (x.rowPhotos || {})[rowPhotoKey(r)]; return own || slotPhoto(r.product, r.colorSlot || 0); }
  // the color slots read from a picture of their own: a slot whose first row's picture is not the product's first photo
  function colorUnits() {
    const s = st(); if (s.type !== 'Variable' || !(s.kinds && s.kinds.colors > 0)) return [];
    const L = FD.blankSheetRows({ type: s.type, products: (s.products || []).length, kinds: s.kinds }); const seen = new Set(); const out = []; const base = (s.products || []).length;
    L.forEach((r) => { const k = r.product + ':' + r.colorSlot; if (seen.has(k)) return; seen.add(k); const p = s.products[r.product]; const photo = rowRef(r);
      if (photo && photo !== p.ref) out.push({ product: r.product, slot: r.colorSlot, photo, index: base + out.length }); });
    return out;
  }

  // ---------------- 1 البداية ----------------
  async function takeSheet(file) {
    let cells; let pics = [];
    try {
      if (/\.csv$/i.test(file.name)) cells = PD.parseCsv(await file.text());
      else { const bytes = new Uint8Array(await file.arrayBuffer()); cells = await PD.parseXlsx(bytes); try { pics = await PD.xlsxPhotos(bytes); } catch (e) { pics = []; } }
    } catch (e) { K.toast('مقدرناش نقرا الشيت — ارفعه xlsx أو csv', 'error'); return; }
    const r = FD.readSheet(cells);
    if (!r.rows.length) { K.toast('الشيت مافيهوش صفوف بأسماء أو أسعار', 'error'); return; }
    const s = st(); s.rows = r.rows.map((x, i) => Object.assign(x, { key: newKey(), src: i + 1, ref: null, photos: [] }));
    s.sheetName = file.name.slice(0, 120); s.unknown = r.unknown; s.mapped = Object.keys(r.map).length;
    try { await takeSheetPics(pics); } catch (e) { /* the sheet is read all the same — its pictures are an extra */ } finally { if (S.busy === 'photos') S.busy = ''; }
    attachPhotos(); touch(); R();
  }
  // ---- the pictures inside the sheet (comments decision 40 — «يعمل ماتشينج للصور ف الترتيب لوحده بناءا علي الصور اللي جوة الشيت») ----
  // a picture's signature (FD.photoSig): the picture drawn into a 64 × 64 square on white, its pixels handed to the rule
  async function sigOf(blob) {
    try {
      const bmp = await createImageBitmap(blob); const n = 64; const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n); ctx.drawImage(bmp, 0, 0, n, n);
      const ratio = bmp.width / bmp.height; if (bmp.close) bmp.close();
      return FD.photoSig(ctx.getImageData(0, 0, n, n).data, n, n, ratio);
    } catch (e) { return ''; }
  }
  const isSheetPic = (p) => !!(st().sheetPhotos && st().sheetPhotos[p]);
  const memberPhotos = (n) => ((st().photoRows || {})[n] || []).filter((p) => !isSheetPic(p));
  // a photo leaves the batch: its file, its signature and its «من الشيت» mark
  function dropPhoto(path) { const s = st(); ST().removeImage(path); if (s.sheetPhotos) delete s.sheetPhotos[path]; if (s.photoSigs) delete s.photoSigs[path]; }
  // a member's photo landed on a row: the sheet's own small picture of that row was only standing in for it
  function dropSheetPics(n) { const s = st(); const L = (s.photoRows || {})[n] || []; const keep = L.filter((p) => !isSheetPic(p)); if (keep.length && keep.length !== L.length) { L.filter(isSheetPic).forEach(dropPhoto); s.photoRows[n] = keep; } }
  // The sheet just read: its pictures' signatures by row (s.sheetSigs — what the uploads are matched to); the photos uploaded before
  // it move to the rows they look like. The sheet's pictures themselves never stand on a row (16 Nov — low quality).
  async function takeSheetPics(pics) {
    const s = st(); s.photoRows = s.photoRows || {};
    Object.keys(s.sheetPhotos || {}).forEach((p) => { Object.keys(s.photoRows).forEach((k) => { s.photoRows[k] = (s.photoRows[k] || []).filter((x) => x !== p); if (!s.photoRows[k].length) delete s.photoRows[k]; }); ST().removeImage(p); }); // the sheet before this one
    s.sheetPhotos = {}; s.sheetSigs = {};
    const byLine = new Map(); s.rows.forEach((r) => { if (r.line != null && !byLine.has(Number(r.line))) byLine.set(Number(r.line), r.src); });
    const first = new Map(); (pics || []).forEach((p) => { const src = byLine.get(p.line); if (src && !first.has(src)) first.set(src, p); }); // a row's first picture is its picture
    if (!first.size) return;
    S.busy = 'photos'; R();
    for (const [src, p] of first) { const sig = await sigOf(new Blob([p.bytes], { type: 'image/' + p.ext })); if (sig) s.sheetSigs[src] = sig; }
    // the member's photos that were there before the sheet: each row's group goes to the row its first photo looks like
    const keys = Object.keys(s.photoRows).map(Number).filter((k) => (s.photoRows[k] || []).length).sort((a, b) => a - b);
    if (keys.length && Object.keys(s.sheetSigs).length) {
      const groups = keys.map((k) => s.photoRows[k]);
      const m = FD.matchPhotos(sheetRefs(), groups.map((g, i) => ({ i, sig: (s.photoSigs || {})[g[0]] || '' })));
      if (m.pairs.length) {
        const next = {}; m.pairs.forEach((x) => { next[x.row] = groups[x.i]; });
        m.loose.forEach((i) => { let k = keys[i]; while (next[k]) k += 1; next[k] = groups[i]; }); // the rest keep their row, or the next free one
        s.photoRows = next; s.matched = (s.matched || 0) + m.pairs.length;
      }
    }
    // the owner 16 Nov («الغي انه ياخد الصور من الشيت … عشان بياخده low quality بس سيب المطابقة»): the sheet's own pictures are
    // never put on the rows any more — they stay signatures only, for matching the member's uploads to their rows
    S.busy = '';
  }
  // a batch saved before 16 Nov: the sheet's small pictures that stood on its rows go (the signatures stay for the matching)
  function dropOldSheetPics() {
    const s = st(); const old = Object.keys((s && s.sheetPhotos) || {}); if (!old.length) return false;
    s.photoRows = s.photoRows || {};
    old.forEach((p) => { Object.keys(s.photoRows).forEach((k) => { s.photoRows[k] = (s.photoRows[k] || []).filter((x) => x !== p); if (!s.photoRows[k].length) delete s.photoRows[k]; }); dropPhoto(p); });
    s.sheetPhotos = {}; return true;
  }
  const sheetRefs = () => Object.keys(st().sheetSigs || {}).map((k) => ({ row: Number(k), sig: st().sheetSigs[k] }));
  // the photos by row number (decision 3): the sheet's row (case 1) or the product's number in the chat (case 2)
  function attachPhotos() {
    const s = st(); const byN = s.photoRows || {};
    // the maker's photos are references only (the owner, 1 Nov: «الأساسية = أول صورة اتعملها generate») — the shots start empty
    s.rows.forEach((r) => { const n = s.case === 'whatsapp' ? r.product : r.src; const ps = byN[n] || []; r.ref = ps[0] || null; r.photos = ps.slice(); });
  }
  // the owner 15 Nov («بجرب ارفع الصور … مبتترفعش»): a maker's photos rarely carry the row number, and every one of them was dropped —
  // a photo without a number now takes the next free row (FD.placePhotos), and a photo that does not go up says why
  async function takePhotos(files) {
    const s = st(); s.photoRows = s.photoRows || {}; s.photoSigs = s.photoSigs || {};
    S.busy = 'photos'; R();
    // comments decision 40: a photo that looks like the picture the sheet has on a row goes to that row, whatever its name; the
    // rest go by their names (a number = that row), else to the free rows in order. A row that holds only the sheet's own picture
    // is free.
    const sigs = []; for (const f of files) sigs.push(s.case === 'sheet' ? await sigOf(f) : '');
    const refs = s.case === 'sheet' ? sheetRefs().filter((x) => !memberPhotos(x.row).length) : [];
    const m = refs.length ? FD.matchPhotos(refs, sigs.map((sig, i) => ({ i, sig }))) : { pairs: [], loose: files.map((_, i) => i) };
    const taken = Object.keys(s.photoRows).map(Number).filter((k) => memberPhotos(k).length).concat(m.pairs.map((x) => x.row));
    const rest = FD.placePhotos(m.loose.map((i) => files[i].name), taken).map((x) => Object.assign(x, { i: m.loose[x.i] }));
    const placed = m.pairs.map((x) => ({ i: x.i, row: x.row, order: 0, auto: false, matched: true })).concat(rest).sort((a, b) => a.row - b.row || a.order - b.order || a.i - b.i);
    let n = 0, loose = 0, hit = 0; const fail = { not_image: 0, network: 0 };
    for (const x of placed) {
      const r = await ST().uploadImage(S.id, files[x.i], 'p' + x.row + '-' + (x.order || 0), { webp: true });
      if (r.ok) { (s.photoRows[x.row] = s.photoRows[x.row] || []).push(r.path); if (sigs[x.i]) s.photoSigs[r.path] = sigs[x.i]; dropSheetPics(x.row); n += 1; if (x.auto) loose += 1; if (x.matched) hit += 1; }
      else fail[r.reason === 'not_image' ? 'not_image' : 'network'] += 1;
    }
    if (s.case === 'photos') s.products = Object.keys(s.photoRows).map(Number).sort((a, b) => a - b).map((k) => ({ n: k, ref: s.photoRows[k][0], photos: s.photoRows[k] }));
    else attachPhotos();
    S.busy = ''; touch(); R();
    if (n) K.toast('اترفعت ' + n + ' صورة' + (hit ? ' — ' + hit + ' اتحطت على صفها لوحدها من صور الشيت' : '') + (loose ? ' — ' + loose + ' من غير رقم في اسمها اتحطت بالترتيب (صورة لكل منتج)، راجعها' : ''), 'success');
    if (fail.not_image) K.toast(fail.not_image + ' صورة ماترفعتش: الصيغة مش مدعومة في المتصفح (زي HEIC من الآيفون) — حوّلها JPG أو PNG وارفعها تاني', 'error');
    if (fail.network) K.toast(fail.network + ' صورة ماترفعتش: النت أو السيرفر — جرّب تاني', 'error');
  }
  // comments decision 39: a row's ⋮ — «تبديل الصورة» puts one new photo in the row's place, «مسح» empties the row; «مسح الكل» empties them all
  function afterPhotos() { const s = st(); if (s.case === 'photos') s.products = Object.keys(s.photoRows).map(Number).sort((a, b) => a - b).map((k) => ({ n: k, ref: s.photoRows[k][0], photos: s.photoRows[k] })); else attachPhotos(); touch(); R(); }
  async function swapPhoto(n, file) {
    const s = st(); if (!file || S.busy) return;
    S.busy = 'photos'; R();
    const sig = await sigOf(file); const r = await ST().uploadImage(S.id, file, 'p' + n + '-0', { webp: true });
    S.busy = '';
    if (!r.ok) { R(); K.toast(r.reason === 'not_image' ? 'الصورة ماترفعتش: الصيغة مش مدعومة — حوّلها JPG أو PNG' : 'الصورة ماترفعتش — جرّب تاني', 'error'); return; }
    ((s.photoRows || {})[n] || []).forEach(dropPhoto); s.photoRows[n] = [r.path]; s.photoSigs = s.photoSigs || {}; if (sig) s.photoSigs[r.path] = sig;
    afterPhotos(); K.toast('الصورة اتبدّلت', 'success');
  }
  function clearPhotoRow(n) { const s = st(); ((s.photoRows || {})[n] || []).forEach(dropPhoto); delete s.photoRows[n]; afterPhotos(); }
  function clearPhotos() {
    const s = st(); const all = Object.values(s.photoRows || {}).reduce((t, l) => t + l.length, 0); if (!all) return;
    K.confirm({ title: 'تمسح كل الصور؟', text: all + ' صورة هتتشال من الدفعة — الشيت والبيانات زي ما هي.', okLabel: 'امسح الكل', okType: 'danger', onOk: () => { Object.values(s.photoRows || {}).forEach((l) => l.forEach(dropPhoto)); s.photoRows = {}; s.sheetPhotos = {}; s.photoSigs = {}; afterPhotos(); K.toast('كل الصور اتمسحت', 'success'); } });
  }
  // the owner 15 Nov («لما ارفع الصور توريني الصور بحجم صغير … ونفس الكلام في السكرين شوتس، وجنب كل واحدة الست نقط اللي بغيّر بيها
  // الترتيب، بحيث أحط كل صورة جنبها الناحية التانية السكرين شوت»): the screenshots go up into the batch (s.screenList, studio/<batch>/
  // shot-…), shown small beside the photos and read by the AI in the order they are in; moving or removing one asks to read again
  async function takeScreens(files) {
    const s = st(); s.screenList = Array.isArray(s.screenList) ? s.screenList : [];
    const room = 8 - s.screenList.length;
    if (room <= 0) { K.toast('لحد 8 سكرين شوتس — امسح واحدة الأول', 'warning'); return; }
    if (files.length > room) K.toast('أول ' + room + ' سكرين بس (لحد 8)', 'warning');
    S.busy = 'extract'; R();
    let bad = 0;
    // the owner 15 Nov («لو متسميين صح يترتبوا بحسب التسمية»): picked screenshots go in by their names (numbers counted as numbers)
    files = files.slice().sort((a, b) => FD.nameOrder(a.name, b.name));
    for (const f of files.slice(0, room)) { const r = await ST().uploadImage(S.id, f, 'shot-' + (s.screenList.length + 1), { webp: true }); if (r.ok) s.screenList.push(r.path); else bad += 1; }
    if (bad) K.toast(bad + ' سكرين ماترفعتش — جرّب تاني', 'error');
    touch(); await readScreens();
  }
  async function readScreens() {
    const s = st(); const list = Array.isArray(s.screenList) ? s.screenList : [];
    if (!list.length) { S.busy = ''; R(); return; }
    S.busy = 'extract'; R();
    const blobs = [];
    for (const p of list) { const b = await ST().bytesOf(p); if (b) blobs.push(new Blob([b], { type: /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg' })); }
    if (!blobs.length) { S.busy = ''; K.toast('مقدرناش نقرا السكرين شوتس — ارفعها تاني', 'error'); R(); return; }
    const r = await AI().extract(blobs, s.type, Object.keys(s.photoRows || {}).length, s.kinds);
    S.busy = '';
    if (!r.ok) { K.toast(why(r.reason, r.field), 'error'); R(); return; }
    if (r.result === 'refused' || !r.rows.length) { K.toast('الـ AI مالقاش منتجات في السكرين شوتس', 'warning'); R(); return; }
    s.rows = r.rows.map((x) => Object.assign(FD.blankRow(), x, { key: newKey(), src: x.product, ai: { extract: true } }));
    const added = fitShape(); // comments decision 42: the sheet's shape the member chose
    s.screens = blobs.length; s.screensDirty = false; attachPhotos(); touch(); R();
    K.toast('الـ AI طلّع ' + r.rows.length + ' صف' + (added ? ' — و' + added + ' صف فاضي على شكل الشيت اللي اخترته، تملاهم في «البيانات»' : ' — راجعهم'), 'success');
  }
  // a list in the order it is in, each row with the six dots (K.Grip / K.sortableRows) — the same row height on both sides, so a photo
  // sits beside its screenshot
  function sortList(attr, items, body, onOrder) {
    const wrap = h('div', { class: 'fl-sort', ['data-' + attr]: '' }, items.map((x, i) => h('div', { class: 'fl-sort-row', ['data-' + attr + '-row']: x.id }, K.Grip(x.label), h('b', { class: 'fl-sort-n num' }, String(x.num != null ? x.num : i + 1)), body(x))));
    K.sortableRows(wrap, 'data-' + attr + '-row', onOrder);
    return wrap;
  }
  // A slot for every row once the rows are known (comments decisions 39–41): the row's photos, or an empty slot that says so — so
  // each photo faces its row, a missing one is seen where it is missing, and a photo is dragged onto the empty slot. Photos on a
  // number the sheet does not have come after the rows, marked «زيادة».
  function photosList() {
    const s = st(); const byN = s.photoRows || {}; const withPhotos = Object.keys(byN).map(Number).filter((k) => (byN[k] || []).length);
    const rowKeys = [...new Set((s.rows || []).map((x) => Number(s.case === 'whatsapp' ? x.product : x.src)).filter((n) => n >= 1))];
    const keys = [...new Set(rowKeys.concat(withPhotos))].sort((a, b) => a - b);
    if (!withPhotos.length && !rowKeys.length) return null;
    if (!withPhotos.length) return null; // nothing uploaded yet: the empty box invites the first upload
    const known = new Set(rowKeys); const gaps = photoGapsNow(); const missing = new Set(gaps.missing);
    const nameOf = (k) => { const r = (s.rows || []).find((x) => (s.case === 'whatsapp' ? x.product : x.src) === k); return r ? (r.nameAr || r.nameEn || '') : ''; };
    const menu = (k, has) => h('span', { class: 'fl-sort-menu', 'data-fl-photo-menu': String(k) }, K.RowMenu([
      { label: has ? 'تبديل الصورة' : 'ارفع صورة', icon: 'upload', run: () => filePick('image/*', false, (fs) => swapPhoto(k, fs[0])) },
      has ? { label: 'مسح', icon: 'trash', danger: true, run: () => clearPhotoRow(k) } : null].filter(Boolean), 'إجراءات صور المنتج ' + k));
    return sortList('fl-photos', keys.map((k) => ({ id: String(k), num: k, label: 'صور المنتج ' + k, paths: byN[k] || [] })), (x) => { const k = Number(x.id); const extra = rowKeys.length > 0 && !known.has(k);
      return h('div', { class: 'fl-sort-body' + (extra ? ' is-extra' : '') + (!x.paths.length ? ' is-empty' : '') + (missing.has(k) ? ' is-missing' : ''), 'data-fl-slot': x.paths.length ? 'photo' : 'empty' },
        x.paths.length ? h('span', { class: 'fl-sort-thumbs' }, x.paths.slice(0, 3).map((p) => Thumb(p, 'st-sm')), x.paths.length > 3 ? h('span', { class: 't-small help' }, '+' + (x.paths.length - 3)) : null)
          : h('span', { class: 'fl-sort-none' }, Icon('image', 'sm'), h('span', { class: 't-small' }, missing.has(k) ? 'ناقص — من غير صورة' : 'من غير صورة')),
        h('span', { class: 't-small help fl-sort-name' }, nameOf(k)),
        x.paths.length && x.paths.every(isSheetPic) ? h('span', { class: 'fl-sort-tag', 'data-fl-from-sheet': '', title: 'الصورة دي من جوه الشيت — ارفع الأصلية وهتتحط مكانها' }, Tag('info', 'من الشيت')) : null,
        extra ? h('span', { class: 'fl-sort-tag', 'data-fl-extra': '' }, Tag('error', 'زيادة')) : null,
        menu(k, x.paths.length > 0)); },
      (ids) => { const vals = ids.map((id) => byN[id] || []); const next = {}; keys.forEach((k, i) => { if (vals[i].length) next[k] = vals[i]; }); s.photoRows = next; attachPhotos(); touch(); R(); });
  }
  // case 1: the sheet's rows as they were read (number + name), the same row height as the photos list so each row faces its photos
  function rowsList() {
    const s = st(); const L = (s.rows || []).filter((r, i, all) => all.findIndex((x) => x.src === r.src) === i);
    if (!L.length) return null;
    return h('div', { class: 'fl-sort' }, L.map((r) => h('div', { class: 'fl-sort-row ro', 'data-fl-rows-row': String(r.src) }, h('b', { class: 'fl-sort-n num' }, String(r.src)),
      h('div', { class: 'fl-sort-body' }, h('span', { class: 'fl-sort-name' }, r.nameAr || r.nameEn || '—'), r.sku ? h('small', { class: 'help num' }, h('bdi', { dir: 'ltr' }, r.sku)) : null))));
  }
  function screensList() {
    const s = st(); const list = Array.isArray(s.screenList) ? s.screenList : [];
    if (!list.length) return null;
    return sortList('fl-screens', list.map((p, i) => ({ id: p, label: 'السكرين ' + (i + 1) })), (x) => h('div', { class: 'fl-sort-body' }, Thumb(x.id, 'st-sm'),
      U.IconButton({ icon: 'trash', label: 'امسح السكرين ده', onClick: () => { s.screenList = list.filter((p) => p !== x.id); ST().removeImage(x.id); s.screensDirty = !!(s.rows || []).length; touch(); R(); } })),
      (ids) => { if (ids.join('|') === list.join('|')) return; s.screenList = ids.slice(); s.screensDirty = !!(s.rows || []).length; touch(); R(); });
  }
  // the owner 15 Nov («خلّي فيه إمكانية إني أعمل drag and drop للصور»): files dropped on a card go up like its button's — the photos and the
  // screenshots take images, the sheet card one xlsx / csv. A drag of the page's own rows (the six dots — pointer events) or of a shot is
  // no file drag and passes by; a file dropped elsewhere on the studio never opens in the tab (the batch would be left)
  const hasFiles = (e) => !!(e && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
  const isImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name || '');
  const isSheet = (f) => /\.(xlsx|csv)$/i.test(f.name || '');
  function dropZone(el, accept, take, busy, wrong) {
    let depth = 0;
    const off = () => { depth = 0; el.classList.remove('is-drop'); };
    el.setAttribute('data-fl-drop', '');
    el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; el.classList.add('is-drop'); });
    el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth -= 1; if (depth <= 0) off(); });
    el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return; e.preventDefault(); off();
      if (busy()) { K.toast('استنى لما الرفع اللي شغّال يخلص', 'warning'); return; }
      const files = [...(e.dataTransfer.files || [])].filter(accept);
      if (!files.length) { K.toast(wrong, 'error'); return; }
      take(files);
    });
    return el;
  }
  if (!window.__ibFlowDropGuard) {
    window.__ibFlowDropGuard = true;
    const inFlow = (e) => hasFiles(e) && e.target && e.target.closest && e.target.closest('.fl');
    document.addEventListener('dragover', (e) => { if (inFlow(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (inFlow(e)) e.preventDefault(); });
  }
  function step1() {
    const s = st();
    const photosN = Object.values(s.photoRows || {}).reduce((t, l) => t + l.length, 0);
    // comments decision 39: the button only adds («زوّد صور»); a row is replaced or emptied from its ⋮, and «مسح الكل» empties them all
    const photosBtn = Button({ label: photosN ? 'زوّد صور' : 'ارفع الصور', icon: 'upload', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) });
    const clearBtn = photosN ? Button({ type: 'text', icon: 'trash', label: 'مسح الكل', disabled: S.busy === 'photos', attrs: { 'data-flow-photos-clear': '' }, onClick: () => clearPhotos() }) : null;
    const nameHelp = U.InlineNote({ children: 'الصور بتتحط على الصفوف بالترتيب، صورة لكل صف. ولو عايز تحدد: سمّيها برقم الصف «1»، «2»… وأكتر من صورة لنفس المنتج «1-1»، «1-2». أول صورة هي المرجعية.' });
    s.kinds = s.kinds || { sizes: 0, colors: 0 };
    // «الشيت هيبقى عامل إزاي»: the photos flow's first step, and (comments decision 42 — «محتاجها تبقي موجودة ف فلو … الواتساب») the
    // WhatsApp flow's first card — there the shape is a choice (0 = as the chat says) and the rows read from the chat are fitted to it
    const kind = (k, label) => U.Select({ id: 'fl-k-' + k, label, value: String(s.kinds[k] || 0), options: [0, 1, 2, 3, 4, 5].map((x) => ({ value: String(x), label: x ? x + ' ' + label : 'من غير' })), onChange: (v) => { s.kinds[k] = Number(v); if (s.case === 'whatsapp' && s.rows.length) { fitShape(); attachPhotos(); } touch(); R(); } });
    if (s.case === 'photos') {
      const ok = s.type === 'Simple' || s.kinds.sizes > 0 || s.kinds.colors > 0;
      return [Card('الشيت هيبقى عامل إزاي', 'النوع ' + s.type + (s.type === 'Variable' ? ' — المتغيرات لحد 5 من كل نوع، وكل واحد بسعره.' : ''), [
        s.type === 'Variable' ? h('div', { class: 'grid2' }, kind('sizes', 'مقاسات'), kind('colors', 'ألوان')) : U.InlineNote({ children: 'كل منتج صف واحد.' }),
        s.type === 'Variable' && !ok ? U.InlineNote({ kind: 'warning', children: 'اختار مقاسات أو ألوان (أو الاتنين).' }) : null]),
      Foot(ok, 'اختار المتغيرات')];
    }
    const per = Math.max(1, s.kinds.colors || 0) * Math.max(1, s.kinds.sizes || 0);
    const shape = s.case === 'whatsapp' ? h('div', { 'data-fl-shape': '' }, Card('الشيت هيبقى عامل إزاي', 'النوع ' + s.type + (s.type === 'Variable' ? ' — المتغيرات لحد 5 من كل نوع، وكل واحد بسعره.' : ''), [
      s.type === 'Variable' ? h('div', { class: 'grid2' }, kind('sizes', 'مقاسات'), kind('colors', 'ألوان')) : U.InlineNote({ children: 'كل منتج صف واحد.' }),
      s.type === 'Variable' ? U.InlineNote({ children: s.kinds.sizes || s.kinds.colors ? 'كل منتج هياخد ' + per + ' صف (ألوان × مقاسات): الـ AI بيملا اللي مكتوب في الشات، والباقي بينزل فاضي تملاه في «البيانات».' : 'من غير عدد = الصفوف زي ما الشات بيقول. اختار عدد المقاسات أو الألوان لو عايز كل منتج ينزل بالشكل ده.' }) : null])) : null;
    // the owner 15 Nov («خلي الصور والسكرين شوتس قد بعض … الصور بتتحط جوا نفس السكشن … تحت بعض … وأقدر أغيّر الترتيب بحيث كل صورة
    // أجيبها قدام الصورة بتاعتها»): each list inside its own card, the two cards side by side on one grid (title · buttons · list ·
    // notes as shared rows), so a photo sits in front of its screenshot (or of its sheet row); empty, the two lists are the same box
    const empty = (text) => h('div', { class: 'fl-list-empty' }, Icon('image', 'sm'), h('span', null, text));
    // comments decision 41 («لو لقي حاجة زيادة ميكملش للتالي او حاجة ناقصة — يديني ايرور و يقولي ملحوظة»): a product without a photo, or
    // photos on a row the sheet does not have, stop «التالي» with a note that names the rows
    const gaps = photoGapsNow(); const list = (L) => L.slice(0, 12).join('، ') + (L.length > 12 ? ' …' : '');
    const gapNotes = s.rows.length ? [
      gaps.missing.length ? U.InlineNote({ kind: 'error', children: 'ناقص: ' + gaps.missing.length + ' منتج من غير صورة — صف ' + list(gaps.missing) + '. ارفع صورته («زوّد صور») أو سمّي الصورة برقم الصف.' }) : null,
      gaps.extra.length ? U.InlineNote({ kind: 'error', children: 'زيادة: صور على صف مش في الشيت — ' + list(gaps.extra) + '. امسحها من ⋮ أو اسحبها قدام صفها.' }) : null].filter(Boolean) : [];
    const gapWhy = gaps.missing.length && gaps.extra.length ? 'فيه صور ناقصة وصور زيادة — راجع كارت «الصور»' : gaps.missing.length ? gaps.missing.length + ' منتج من غير صورة — ارفع صورته الأول' : gaps.extra.length ? 'فيه صور زيادة مالهاش صف — امسحها أو حطها قدام صفها' : '';
    const src = s.case === 'whatsapp'
      ? Card('سكرين شوتس الواتساب', 'لحد 8 سكرين شوتس — الـ AI بيقرا الأسماء والأسعار والألوان والمقاسات بالترتيب.', [
        h('div', { class: 'fl-pair-acts' }, h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'extract' ? 'بيقرا…' : (s.screenList || []).length ? 'زوّد سكرين شوتس' : 'ارفع السكرين شوتس واقرا الداتا', disabled: S.busy === 'extract' || (s.screenList || []).length >= 8, attrs: { 'data-flow-screens': '' }, onClick: () => filePick('image/*', true, takeScreens) }),
          (s.screenList || []).length && (s.screensDirty || !s.rows.length) ? Button({ icon: 'sparkle', label: 'اقرا تاني بالترتيب ده', disabled: S.busy === 'extract', attrs: { 'data-flow-read': '' }, onClick: () => readScreens() }) : null),
          s.screensDirty ? U.InlineNote({ kind: 'warning', children: 'غيّرت ترتيب السكرين شوتس أو مسحت واحدة — اضغط «اقرا تاني بالترتيب ده» عشان الصفوف تمشي معاها.' })
            : s.rows.length ? U.InlineNote({ kind: 'success', children: 'اتقرا ' + s.rows.length + ' صف من ' + (s.screens || 0) + ' سكرين — هتراجعهم في «البيانات».' }) : null),
        h('div', { class: 'fl-pair-list', 'data-fl-list': 'screens' }, screensList() || empty('اسحب السكرين شوتس وسيبها هنا — وهتظهر بالترتيب')),
        h('div', { class: 'fl-pair-notes' }, U.InlineNote({ children: 'ارفع صور المنتجات الأول عشان الـ AI يعرف عددها، وبنفس ترتيب المنتجات في الشات (صورة لكل منتج، أو سمّيها «1»، «2»، «1-2»…). اسحب من الست نقط عشان كل سكرين تبقى قدام صورتها.' }))])
      : Card('الشيت', 'xlsx أو csv بالقالب بتاعنا أو بأي عناوين — بنطابق الأعمدة لوحدنا.', [
        h('div', { class: 'fl-pair-acts' }, h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: s.rows.length ? 'بدّل الشيت' : 'ارفع الشيت', attrs: { 'data-flow-sheet': '' }, onClick: () => filePick('.xlsx,.csv', false, (f) => takeSheet(f[0])) }), s.sheetName ? h('span', { class: 't-small help' }, s.sheetName) : null),
          s.rows.length ? U.InlineNote({ kind: 'success', children: s.rows.length + ' صف · ' + (s.mapped || 0) + ' عمود اتطابق' + (s.unknown && s.unknown.length ? ' · أعمدة مش في القالب: ' + s.unknown.join('، ') : '') }) : null),
        h('div', { class: 'fl-pair-list', 'data-fl-list': 'rows' }, rowsList() || empty('اسحب الشيت وسيبه هنا — وصفوفه هتظهر بالترتيب')),
        h('div', { class: 'fl-pair-notes' }, U.InlineNote({ children: 'كل صف قدامه صوره في كارت «الصور» — اسحب الصور من الست نقط لو صورة جت على صف غلط.' }))]);
    const withRef = s.rows.filter((r) => r.ref).length;
    const pics = Card('الصور', photosN ? photosN + ' صورة' + (s.rows.length ? ' · ' + withRef + ' صف ليه صورة' : '') : 'صور المنتجات بجودة عالية', [
      h('div', { class: 'fl-pair-acts', 'data-fl-gaps': gaps.missing.length || gaps.extra.length ? 'bad' : 'ok' }, h('div', { class: 'acts-inline' }, photosBtn, clearBtn, S.busy === 'photos' ? h('span', { class: 't-small help' }, 'بنرفع…') : null),
        gapNotes,
        s.case === 'sheet' && Object.keys(s.sheetSigs || {}).length ? U.InlineNote({ children: 'الشيت فيه صور — أي صورة ترفعها بتتحط على صفها لوحدها لو شبه صورة الصف في الشيت، من غير ما تسمّيها.' }) : null),
      h('div', { class: 'fl-pair-list', 'data-fl-list': 'photos' }, photosList() || empty('اسحب الصور وسيبها هنا — وهتظهر بالترتيب')),
      h('div', { class: 'fl-pair-notes' }, nameHelp)]);
    if (s.case === 'whatsapp') dropZone(src, isImage, takeScreens, () => S.busy === 'extract' || (s.screenList || []).length >= 8, 'اسحب صور (السكرين شوتس) بس');
    else dropZone(src, isSheet, (f) => takeSheet(f[0]), () => false, 'الشيت لازم يكون xlsx أو csv');
    dropZone(pics, isImage, takePhotos, () => S.busy === 'photos', 'اسحب صور بس (JPG أو PNG أو WebP)');
    return [shape, h('div', { class: 'fl-pair', 'data-fl-match': '' }, src, pics), Foot(s.rows.length > 0 && !gapWhy && S.busy !== 'photos', !s.rows.length ? (s.case === 'whatsapp' ? 'اقرا السكرين شوتس الأول' : 'ارفع الشيت الأول') : gapWhy || 'استنى لما الصور تترفع')];
  }
  // the chat's rows on the shape chosen in «الشيت هيبقى عامل إزاي» (FD.fitKinds) → how many empty variation rows were added
  function fitShape() {
    const s = st(); if (!s || s.case !== 'whatsapp') return 0;
    const before = s.rows.filter((r) => r.added).length;
    s.rows = FD.fitKinds(s.rows, s.type, s.kinds).map((r) => (r.key ? r : Object.assign(r, { key: newKey(), src: r.product, ref: null, photos: [] })));
    return Math.max(0, s.rows.filter((r) => r.added).length - before);
  }
  // the first step's rows against the photos (FD.photoGaps): a Variable product's rows share its photos
  function photoGapsNow() {
    const s = st(); if (!s || s.case === 'photos' || !(s.rows || []).length) return { missing: [], extra: [] };
    const G = groups(); const groupOf = new Map(); G.forEach((g, gi) => g.rows.forEach((ri) => groupOf.set(ri, gi)));
    return FD.photoGaps(rows().map((r, ri) => ({ src: s.case === 'whatsapp' ? r.product : r.src, group: s.case === 'whatsapp' ? 'p' + r.product : groupOf.get(ri) })), s.photoRows || {});
  }

  // ---------------- 2 المبتكر والبراند (decision 4) ----------------
  function step2() {
    const s = st(); const Vs = V(); const vd = Vs && Vs.data ? Vs.data() : null;
    if (Vs && Vs.state && Vs.state() === 'idle') Vs.load();
    const makers = Vs && Vs.store && Vs.store.all ? Vs.store.all().slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')) : [];
    const mk = makers.find((x) => x.id === s.vendorId) || null;
    const brands = (vd ? vd.brands : []).filter((b) => mk && String(b.owner) === String(mk.id));
    // the owner 15 Nov («محتاجين بس نختار اسم المبتكر ويكون في بحث في الدروب داون، وشيل البراند، وأظهر نسبة المبتكر بشكل يليق مع
    // المعلومات وتحتها كود البراند في الـ SKU»): the maker alone is picked (his list opens with a search box — U.Select, 9 names or more);
    // the brand is his own — the one of his store, else the one named like him, else his first; with none, his name
    if (mk) autoBrand(mk, brands);
    const r = rateNow(); const noStore = mk && mk.wooVendorId == null && s.case !== 'photos';
    // the owner 15 Nov («شيل سعر البيع والمتجر على الموقع والبراند وخلّي بس نسبته تبان، ويبقى فيه إمكانية لتعديلها: النسبة العامة أو
    // نسبة لقسم معيّن»): the rate alone, the categories with their own rate beside it, and «تعديل النسبة» for sensitive.commission = F
    const catRates = mk && mk.commissionType === 'category_based' ? (mk.categoryRates || []) : [];
    const body = [
      h('div', { class: 'grid2' },
        U.Select({ id: 'fl-maker', label: 'المبتكر', required: true, value: s.vendorId || '', placeholder: vd ? 'اختار المبتكر — اكتب أول حروف اسمه' : 'بنحمّل المبتكرين…',
          options: makers.map((x) => ({ value: x.id, label: x.name + (x.wooVendorId == null ? ' (مالوش متجر على الموقع)' : '') })),
          onChange: (v) => { const m = makers.find((x) => x.id === v); s.vendorId = m ? m.id : null; s.vendorName = m ? m.name : ''; s.brandId = null; s.brandName = ''; s.code = ''; s.rate = null; s.fee = null; touch(); R(); },
          error: noStore ? 'المبتكر ده مالوش متجر على الموقع — اعمله متجر من ملفه الأول' : null }),
        h('div', { class: 'fl-new' }, Button({ size: 'sm', icon: 'plus', label: 'مبتكر جديد', attrs: { 'data-fl-new-maker': '' }, onClick: newMaker }))),
      // comments decision 35 (the owner 15 Nov — «ضيف هنا البراند تحت المبتكر — و يجيب بس البراندات اللي تحت المبتكر اللي اختاره مع
      // امكانية اضافة براند من هنا»): the brand under the maker — his brands only (the one taken for him is picked already), and
      // «براند جديد» adds one to him (vendors.edit, like his file's «إضافة براند»)
      mk ? h('div', { class: 'grid2', 'data-fl-brand-row': '' },
        U.Select({ id: 'fl-brand', label: 'البراند', required: true, value: s.brandId || '', placeholder: brands.length ? 'اختار البراند' : 'مفيش براند على المبتكر ده لسه',
          options: brands.map((b) => ({ value: b.id, label: b.name })), help: brands.length ? 'براندات ' + mk.name + ' بس — اسمه بيتكتب في الشيت وكوده في الـ SKU' : 'المنتجات هتتكتب باسم المبتكر لحد ما تضيف براند',
          onChange: (v) => { const b = brands.find((x) => String(x.id) === String(v)); if (!b) return; setBrand(b); touch(); R(); } }),
        canBrand() ? h('div', { class: 'fl-new' }, Button({ size: 'sm', icon: 'plus', label: 'براند جديد', attrs: { 'data-fl-new-brand': '' }, onClick: () => newBrand(mk) })) : null) : null,
      mk ? h('div', { class: 'fl-maker-info', 'data-fl-maker-info': '' },
        h('div', { class: 'fl-mk-rate' }, h('span', { class: 't-small help' }, catRates.length ? 'نسبة إبتكر العامة' : 'نسبة إبتكر'), h('b', { class: 'num', 'data-fl-rate': '' }, r == null ? '—' : U.num(r + '%')),
          h('small', { class: 'help' }, feeNow() ? '+ ' + K.n0(feeNow()) + ' ج.م رسوم ثابتة' : 'من غير رسوم ثابتة')),
        h('div', { class: 'fl-mk-cats', 'data-fl-cat-rates': '' },
          h('span', { class: 't-small help' }, catRates.length ? 'أقسام ليها نسبة لوحدها' : r == null ? 'نسبة المبتكر مش ظاهرة لك' : 'نفس النسبة على كل الأقسام'),
          catRates.length ? h('div', { class: 'fl-mk-chips' }, catRates.slice(0, 8).map((c) => h('span', { class: 'fl-mk-chip', 'data-cat': c.wooCategoryId }, h('span', null, c.name), h('b', { class: 'num' }, U.num(c.rate + '%')))),
            catRates.length > 8 ? h('span', { class: 't-small help' }, U.num('+' + (catRates.length - 8))) : null) : null),
        canRate() ? h('div', { class: 'fl-mk-act' }, Button({ size: 'sm', icon: 'edit', label: 'تعديل النسبة', attrs: { 'data-fl-rate-edit': '' }, onClick: () => rateModal(mk) })) : null) : null,
      mk ? h('div', { class: 'grid2' }, U.FieldShell({ id: 'fl-code', label: 'كود البراند في الـ SKU (2–4 حروف)', help: 'مثال: glasstora → GLS — IBTGLS1020-OW' }, h('div', { class: 'input' }, h('input', { id: 'fl-code', dir: 'ltr', maxlength: 4, value: s.code || '', 'data-flow-code': '',
          onChange: (ev) => { s.code = String(ev.target.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); touch(); R(); } }))),
        h('div', { class: 'fl-sku-ex t-small help', 'data-fl-sku-ex': '' }, FD.validCode(s.code) ? 'الـ SKU هيبقى: ' : '', FD.validCode(s.code) ? h('b', { dir: 'ltr' }, 'IBT' + s.code + '1020-OW') : null)) : null,
      mk && !FD.validCode(s.code) ? U.InlineNote({ kind: 'warning', children: 'كود البراند لازم 2–4 حروف إنجليزي.' }) : null];
    const ok = !!mk && FD.validCode(s.code) && (s.case === 'photos' || mk.wooVendorId != null);
    return [Card('المبتكر', 'المنتجات بتترفع على متجر المبتكر، وبراندُه بيتكتب في الشيت وكوده في الـ SKU.', body), Foot(ok, !mk ? 'اختار المبتكر' : 'كود البراند')];
  }
  // «براند جديد» (comments decision 35): a brand added to the batch's maker from here — the name (not one taken already) and its
  // code; written like his file's «إضافة براند» (IBVendors.store.addBrand: the brand, then his ownership from his joining date) and
  // picked for the batch at once
  const canBrand = () => { const Vs = V(); return !!(Vs && Vs.store && Vs.store.canBrands && Vs.store.canBrands()); };
  function newBrand(mk) {
    const Vs = V(); if (!canBrand()) { K.toast('إضافة البراندات لأدمن أو اللي عنده صلاحية تعديل المبتكرين', 'error'); return; }
    touch(true);
    K.form({ title: 'براند جديد — ' + mk.name, values: { name: '', code: '' }, submitLabel: 'إضافة البراند',
      note: U.InlineNote({ children: 'البراند هيتضاف على ' + mk.name + ' ويتختار للدفعة دي.' }),
      fields: (f, e, set) => [K.field.text('name', 'اسم البراند', f, e, set, { required: true, maxlength: 80, help: 'الاسم اللي المنتجات بتتباع بيه' }),
        K.field.text('code', 'كود البراند في الـ SKU (2–4 حروف)', f, e, set, { maxlength: 4, placeholder: f.name ? FD.brandCode3(f.name) : 'GLS', help: 'لو سبته فاضي هيتاخد من الاسم' })],
      validate: (f) => { const e = {}; const name = String(f.name || '').trim(); const code = String(f.code || '').trim().toUpperCase();
        if (!name) e.name = 'اكتب اسم البراند'; else if (name.length > 80) e.name = 'اسم البراند لحد 80 حرف';
        else { const dup = Vs.store.brandByName ? Vs.store.brandByName(name) : null; if (dup) e.name = 'فيه براند بنفس الاسم (' + dup.name + ') — اختار اسم تاني'; }
        if (code && !FD.validCode(code)) e.code = 'الكود من 2 لـ 4 حروف إنجليزي';
        return e; },
      submit: (f, m) => { const name = String(f.name).trim(); const code = String(f.code || '').trim().toUpperCase(); m._busy = true;
        // the brand's own code is 1–3 characters (the makers' rule); the batch keeps the 2–4 letters typed here for the SKU
        Promise.resolve().then(() => Vs.store.addBrand(mk.id, { name, code: code.slice(0, 3), aliases: '' }, Vs.store.actor ? Vs.store.actor() : null)).then((res) => {
          m.close(); const s = st(); if (!s || String(s.vendorId) !== String(mk.id)) return;
          setBrand(res.brand); if (FD.validCode(code)) s.code = code;
          touch(true); R(); K.toast('اتضاف البراند ' + res.brand.name + ' واتختار للدفعة', 'success');
        }, (err) => { m._busy = false; K.toast((err && err.message) || 'البراند ما اتضافش — جرّب تاني', 'error'); });
        return false; } });
  }
  // the owner 15 Nov («لما أدوس على إضافة مبتكر يفتحلي بوباب إضافة المبتكر»): the add-maker popup itself over the studio (IBMakerAdd,
  // block 28) — the new maker is picked for the batch right after the save; the batch stays where it is
  function newMaker() {
    touch(true);
    const ok = window.IBMakerAdd && window.IBMakerAdd((v) => {
      const s = st(); if (!s || !v) return;
      s.vendorId = v.id; s.vendorName = v.name; s.brandId = null; s.brandName = ''; s.code = ''; s.rate = null; s.fee = null; touch(); R();
    });
    if (ok === false) K.toast('إضافة المبتكرين لأدمن أو اللي عنده صلاحية تعديل المبتكرين', 'error');
    else if (!window.IBMakerAdd) { touch(true); go('makers/new'); }
  }
  // the rate popup (the owner 15 Nov): «النسبة العامة» (his rate on every category without its own) or «نسبة قسم معيّن» (a category
  // and its rate). Written like the maker's «الاتفاق التجاري» — IBVendors.store.setCommission (vendor_commission_set, today in Cairo,
  // then push_vendor ['rate', 'category_rates'] to his Dokan store). A category rate on a maker on «fixed» makes him «category_based»
  // with his general rate as the default of every other category, so nothing else changes on the site; the category's own flat fee is
  // kept (the one it has today, set or inherited). sensitive.commission = F only (the adapter and the RPC check it too).
  const canRate = () => { const Vs = V(); return !!(Vs && Vs.store && Vs.store.canRate && Vs.store.canRate()); };
  const latin = (x) => String(x == null ? '' : x).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[٫,]/g, '.').trim();
  const rateOk = (x) => { const t = latin(x); const n = Number(t); return t !== '' && Number.isFinite(n) && n >= 0 && n <= 65; };
  const catComm = (vid, cid) => (PR() && PR().commissionParams && cid != null ? PR().commissionParams({ vendorId: vid, categoryIds: [Number(cid)] }) : null);
  function rateModal(mk) {
    const Vs = V(); if (!canRate() || !Vs.store.get) return;
    const v = Vs.store.get(mk.id) || mk;
    const opts = cats().map((c) => ({ value: String(c.id), label: c.path || c.name }));
    const own = new Set(rows().map((x) => catIdOf(x.catEn)).filter((x) => x != null)); // the batch's categories first in the list
    const sorted = opts.filter((o) => own.has(Number(o.value))).concat(opts.filter((o) => !own.has(Number(o.value))));
    const effOf = (cid) => { const c = catComm(v.id, cid); return c && c.rate != null ? String(c.rate) : v.rate == null ? '' : String(v.rate); };
    const first = own.size ? String([...own][0]) : '';
    K.form({ title: 'تعديل نسبة إبتكر — ' + v.name, values: { kind: 'all', flRateCat: first, flRate: v.rate == null ? '' : String(v.rate) }, submitLabel: 'احفظ النسبة',
      fields: (f, e, set) => {
        const out = [K.Radios({ label: 'هتعدّل إيه؟', name: 'fl-rate-kind', value: f.kind, options: [
          { value: 'all', label: 'النسبة العامة', hint: 'على كل الأقسام اللي مالهاش نسبة لوحدها' },
          { value: 'cat', label: 'نسبة قسم معيّن', hint: 'القسم ده بس (وأقسامه الفرعية اللي مالهاش نسبة)' }],
        onChange: (k) => { if (k === f.kind) return; f.flRate = k === 'cat' ? (f.flRateCat ? effOf(f.flRateCat) : '') : v.rate == null ? '' : String(v.rate); set('kind', k, true); } })];
        if (f.kind === 'cat') out.push(window.IBCatField ? window.IBCatField({ id: 'flRateCat', label: 'القسم', required: true, error: e.flRateCat, single: true, ids: f.flRateCat ? [Number(f.flRateCat)] : [], onPick: (ids) => { const val = ids.length ? String(ids[0]) : ''; f.flRate = val ? effOf(val) : f.flRate; set('flRateCat', val, true); } })
          : K.field.select('flRateCat', 'القسم', sorted, f, e, (k, val, rd) => { f.flRate = effOf(val); set(k, val, rd); }, { required: true, placeholder: 'اختار القسم — اكتب أول حروف اسمه' }));
        const cur = f.kind === 'cat' && f.flRateCat ? catComm(v.id, f.flRateCat) : null;
        out.push(K.field.text('flRate', f.kind === 'cat' ? 'نسبة القسم (%)' : 'النسبة العامة (%)', f, e, set, { required: true, inputmode: 'decimal',
          help: f.kind === 'cat' ? (cur ? 'دلوقتي ' + cur.rate + '%' + (cur.source === 'category' ? ' (نسبة القسم)' : ' (النسبة العامة)') : 'من 0 لـ 65') : 'من 0 لـ 65 — النسبة بتتطبق على الأوردرات الجديدة من النهارده' }));
        if (f.kind === 'cat' && v.commissionType !== 'category_based') out.push(U.InlineNote({ children: 'عمولة المبتكر هتبقى «حسب القسم» على الموقع: القسم ده بنسبته، وباقي الأقسام على النسبة العامة' + (v.rate == null ? '' : ' (' + v.rate + '%)') + ' زي ما هي.' }));
        return out;
      },
      validate: (f) => { const e = {}; if (!rateOk(f.flRate)) e.flRate = 'رقم من 0 لـ 65'; if (f.kind === 'cat' && !f.flRateCat) e.flRateCat = 'اختار القسم'; if (f.kind === 'cat' && v.rate == null) e.flRate = 'حط النسبة العامة الأول'; return e; },
      submit: (f) => { saveRate(v, f); } });
  }
  function saveRate(v, f) {
    const Vs = V(); const id = String(v.id); const n = Number(latin(f.flRate)); const flat = v.rateFlat == null ? null : Number(v.rateFlat);
    let input;
    if (f.kind === 'cat') { const c = catComm(v.id, f.flRateCat); const fee = c && Number(c.fee) > 0 ? Number(c.fee) : null; input = { type: 'category_based', rate: Number(v.rate), flat, categories: [{ id: Number(f.flRateCat), rate: n, flat: fee }] }; }
    else input = { type: v.commissionType === 'category_based' ? 'category_based' : 'fixed', rate: n, flat, categories: [] };
    // the write's outcome comes back as ib:vendors { id, reason } (refused — the adapter put the old rate back) or { id, written, push }
    const done = new Promise((resolve) => {
      const t = setTimeout(() => { document.removeEventListener('ib:vendors', on); resolve({ timeout: true }); }, 30000);
      function on(e) { const d = (e && e.detail) || {}; if (String(d.id) !== id || !(d.reason || d.written)) return; clearTimeout(t); document.removeEventListener('ib:vendors', on); resolve(d); }
      document.addEventListener('ib:vendors', on);
    });
    try { Vs.store.setCommission(id, input, Vs.store.actor ? Vs.store.actor() : null); } catch (err) { K.toast('النسبة ما اتحفظتش — ' + (err && err.message === 'rate out of range' ? 'رقم من 0 لـ 65' : 'ماعندكش صلاحية تعديل العمولة'), 'error'); return; }
    const s = st(); if (s) { s.rate = null; s.fee = null; touch(); }
    R();
    done.then((d) => {
      const M = Vs.MESSAGES || {};
      if (d.reason) K.toast(M[d.reason] || 'النسبة ما اتحفظتش.', 'error');
      else if (d.timeout) K.toast('النسبة لسه بتتحفظ — افتح ملف المبتكر بعد شوية واتأكد.', 'warning');
      else if (d.push && d.push.result === 'error') K.toast(d.push.reason === 'woo_refused' ? M.push_refused : d.push.pending === false ? M.push_lost : M.push_failed, 'warning');
      else if (d.push && d.push.result === 'skipped' && d.push.reason === 'no_permission') K.toast(M.push_forbidden || 'اتحفظت عندنا، والموقع محتاج حد عنده صلاحية تعديل المبتكرين.', 'warning');
      else K.toast(f.kind === 'cat' ? 'اتحفظت نسبة القسم' : 'اتحفظت النسبة العامة', 'success');
      if (S.row && st() && st().vendorId === v.id) R();
    });
  }
  // the maker's own brand (see step2); a batch that already has one of his brands keeps it
  function autoBrand(mk, brands) {
    const s = st(); if (s.brandId && brands.some((b) => b.id === s.brandId)) return;
    const norm = (x) => String(x || '').trim().toLowerCase();
    const pick = brands.find((b) => String(b.store) === String(mk.id)) || brands.find((b) => norm(b.name) === norm(mk.name)) || brands[0] || null;
    if (pick) { setBrand(pick); return; }
    if (s.brandName !== mk.name || !s.code) { s.brandId = null; s.brandName = mk.name; if (!FD.validCode(s.code)) s.code = FD.brandCode3(mk.name); s.rows.forEach((r) => { if (!r.brand) r.brand = mk.name; }); }
  }
  function setBrand(b) { const s = st(); const was = s.brandName; s.brandId = b.id; s.brandName = b.name; const c = String(b.code || '').toUpperCase(); s.code = FD.validCode(c) && c.length >= 3 ? c : FD.brandCode3(b.name); s.rows.forEach((r) => { if (!r.brand || (was && r.brand === was)) r.brand = b.name; }); }


  // ---------------- 3 البيانات (decision 6) ----------------
  const ISSUE_FIELDS = (r) => FD.rowIssues(r).filter((x) => x !== 'سعر المبتكر' && x !== 'سعر البيع');
  // the SKU of every product that has none (decision 5): one serial per product from sku_serial_take; the colors not in the table added with a suggested code
  async function genSkus(silent) {
    const s = st(); if (!FD.validCode(s.code)) { if (!silent) K.toast('حدد كود البراند الأول', 'error'); return; }
    // every row's color in the table first (a maker's own SKU too — a variation's color must be one of ours on the site)
    const missingColors = [...new Map(rows().filter((r) => r.colorEn && !colorOf(r)).map((r) => [r.colorEn.trim().toLowerCase(), r])).values()];
    for (const r of missingColors) {
      const code = PD.suggestColorCode(r.colorEn, colors().map((c) => c.code));
      const x = code ? await ST().addColor({ name_en: r.colorEn.trim().slice(0, 40), name_ar: (r.colorAr || r.colorEn).trim().slice(0, 40), code }) : { ok: false };
      if (!x.ok && !colorOf(r)) { K.toast('اللون «' + r.colorEn + '» مش في جدول الألوان ومقدرناش نضيفه', 'error'); return; }
    }
    const need = groups().filter((g) => g.rows.some((ri) => !FD.validSku(rows()[ri].sku)));
    if (!need.length) { if (missingColors.length) { touch(); R(); } if (!silent) K.toast('كل المنتجات ليها SKU', 'success'); return; }
    const t = await ST().takeSerials(need.length);
    if (!t.ok) { K.toast('مقدرناش نحجز المسلسل — ' + why(t.reason), 'error'); return; }
    need.forEach((g, k) => {
      const serial = t.first + k; const rs = g.rows.map((ri) => rows()[ri]); const manySizes = new Set(rs.map((r) => r.size).filter(Boolean)).size > 1;
      rs.forEach((r) => { if (FD.validSku(r.sku)) return; r.sku = FD.skuOf({ code: s.code, serial, color: codeOfRow(r) || '', size: g.type === 'Variable' && manySizes ? r.size : '' }) || ''; });
    });
    touch(); R(); if (!silent) K.toast('اتعمل SKU لـ ' + need.length + ' منتج', 'success');
  }
  // «املأ بالـ AI» (decision 6; the owner 15 Nov: by itself when the step opens): the names, the descriptions, the category, the material
  // and the style (both languages), and a Simple product's color from its photo — product by product (IBAI.studio on the saved items)
  const needOf = (g) => { const R0 = rows()[g.rows[0]];
    return [!R0.nameEn && 'nameEn', !R0.nameAr && 'nameAr', (!R0.shortEn || !R0.shortAr) && 'desc', !catIdOf(R0.catEn) && 'category',
      (!R0.materialEn || !R0.materialAr || !R0.styleEn || !R0.styleAr) && 'attrs', g.type === 'Simple' && !R0.colorEn && !R0.colorAr && 'variations'].filter(Boolean); };
  // notes = the member's instructions from the popup (IBAIAsk); rewrite = new names and descriptions too, in both languages
  async function aiFill(only, auto, notes, rewrite) {
    const want0 = (g) => (rewrite ? [...new Set(needOf(g).filter((w) => !['nameEn', 'nameAr', 'desc'].includes(w)).concat(['rewriteName', 'rewriteDesc']))] : needOf(g));
    const todo = groups().map((g, gi) => ({ g, gi, want: want0(g) })).filter((x) => x.want.length && (!only || x.g.rows.some((ri) => only.has(rows()[ri].key))));
    if (!todo.length) { if (!auto) K.toast('مفيش بيانات ناقصة', 'success'); return; }
    await touch(true); S.busy = 'ai'; R(); let done = 0; let stop = '';
    for (const { g, gi, want } of todo) {
      const r = await AI().studio(S.id, gi, want, notes, styleList().map(([en, ar]) => ({ en, ar })));
      if (!r.ok) { stop = why(r.reason); break; }
      const f = r.fields || {};
      const mat = FD.pairOf(FD.MATERIALS, f.material, f.materialAr); const sty = FD.pairOf(styleList(), f.style, f.styleAr);
      g.rows.forEach((ri) => { const x = rows()[ri]; x.ai = Object.assign({}, x.ai);
        const fill = (k, v) => { if (v && !x[k]) { x[k] = v; x.ai[k] = true; } };
        const put = (k, v) => { if (v) { x[k] = v; x.ai[k] = true; } };
        if (rewrite) { put('nameEn', f.nameEn); put('nameAr', f.nameAr); put('shortEn', f.shortDesc); put('shortAr', f.shortDescAr); }
        fill('nameEn', f.nameEn); fill('nameAr', f.nameAr); fill('shortEn', f.shortDesc); fill('shortAr', f.shortDescAr);
        if (Array.isArray(f.categories) && f.categories.length && !catIdOf(x.catEn)) { x.catEn = pathOfId(f.categories[0]); x.ai.catEn = true; }
        fill('materialEn', mat ? mat[0] : f.material); fill('materialAr', mat ? mat[1] : f.materialAr);
        if (sty || !shopStyles()) { fill('styleEn', sty ? sty[0] : f.style); fill('styleAr', sty ? sty[1] : f.styleAr); } // the shop's styles only
        const c = g.type === 'Simple' && !x.colorEn && !x.colorAr && Array.isArray(f.colors) && f.colors.length ? colors().find((y) => y.code === f.colors[0]) : null;
        if (c) { const old = codeOfRow(x); fill('colorEn', c.name_en); fill('colorAr', c.name_ar); recolorSku(x, old, c.code); } });
      done += 1; touch(); RF();
    }
    S.busy = ''; RF();
    K.toast(stop ? 'وقف بعد ' + done + ' منتج — ' + stop : (rewrite ? 'اتكتب ' : 'اتملا ') + done + ' منتج بالـ AI — راجعهم', stop ? 'error' : 'success');
  }
  // the owner 15 Nov («خلّي املأ الناقص بالـ AI أو أعد الكتابة بالـ AI، ولما أدوس عليه يفتح بوب أب أكتب فيه تعليمات، وفيه زرار ابدأ التوليد
  // أو إغلاق»): the header button, the selection bar and a product's menu ask first — fill the missing fields or rewrite the names and
  // descriptions too — then run with the instructions
  async function askFill(only) {
    const n = only ? groups().filter((g) => g.rows.some((ri) => only.has(rows()[ri].key))).length : groups().length;
    const a = await window.IBAIAsk({ title: 'املأ الناقص أو أعد الكتابة بالـ AI — ' + n + ' منتج', modes: [
      { value: 'fill', label: 'املأ الناقص بس', hint: 'الخانات الفاضية بس — اللي مكتوب يفضل زي ما هو' },
      { value: 'rewrite', label: 'أعد كتابة الاسم والوصف كمان', hint: 'نسخة جديدة باللغتين لكل منتج، والناقص يتملا' }] });
    if (!a) return;
    await aiFill(only, false, a.notes, a.mode === 'rewrite');
  }
  // a field's sparkle → the instructions popup → the rewrite (the Arabic column rewrites both languages, the English one the English)
  async function askRewrite(rw, label) {
    const a = await window.IBAIAsk({ title: 'إعادة كتابة ' + label + ' بالـ AI', intro: rw.lang === 'ar' ? 'نسخة جديدة بنفس المعلومات — والإنجليزي بيتكتب معاها.' : 'A new version with the same facts — the English only.' });
    if (a) rewriteGroup(rw.key, rw.what, rw.lang, a.notes);
  }
  // the owner 15 Nov: a color picked (or read by the AI) after the SKU was made → the SKU's color part follows it (our own SKU only — a
  // maker's SKU stays as it is): «IBTART0999-BE» → «IBTART0999-PU»; a SKU with no color part takes it after the serial
  function recolorSku(r, oldCode, newCode) {
    const s = st(); const sku = String(r.sku || ''); if (!newCode || oldCode === newCode || !FD.validSku(sku) || !FD.validCode(s.code) || !sku.startsWith('IBT' + s.code)) return;
    const base = FD.skuBase(sku); let rest = sku.slice(base.length);
    if (oldCode) { if (rest === '-' + oldCode || rest.startsWith('-' + oldCode + '-')) rest = rest.slice(oldCode.length + 1); else return; }
    r.sku = base + '-' + newCode + rest;
  }
  // a color by its names → its code in the colors table (a new one added with a suggested code, like the SKU step does)
  async function codeForColor(en, ar) {
    const hit = colors().find((c) => (en && c.name_en.toLowerCase() === en.trim().toLowerCase()) || (ar && String(c.name_ar).trim() === ar.trim())); if (hit) return hit.code;
    const code = en ? PD.suggestColorCode(en, colors().map((c) => c.code)) : null; if (!code) return null;
    const x = await ST().addColor({ name_en: en.trim().slice(0, 40), name_ar: (ar || en).trim().slice(0, 40), code });
    return x.ok ? code : null;
  }
  // the owner 15 Nov («لو غير اي حاجة في العربي تتغير اوتوماتيك في الانجليزي … لو كتب كلام بالعربي في الاسم او الوصف يترجم لوحده»): an
  // Arabic name or description typed → the English one written from it by the AI (want «translate»), marked «AI — راجع» until edited
  async function translateGroup(key, what) {
    if (S.tr.has(key)) return;
    S.tr.add(key); RF(); await touch(true);
    const gi = groups().findIndex((x) => x.key === key);
    const r = gi < 0 ? { ok: false, reason: 'not_found' } : await AI().studio(S.id, gi, ['translate']);
    S.tr.delete(key);
    if (!r.ok) { K.toast('مقدرناش نترجم للإنجليزي — ' + why(r.reason), 'error'); RF(); return; }
    const f = r.fields || {}; const g = groups().find((x) => x.key === key);
    (g ? g.rows : []).forEach((ri) => { const x = rows()[ri]; x.ai = Object.assign({}, x.ai);
      if (what.name && f.nameEn) { x.nameEn = f.nameEn; x.ai.nameEn = true; }
      if (what.desc && f.shortDesc) { x.shortEn = f.shortDesc; x.ai.shortEn = true; } });
    touch(); RF();
  }
  const Cb = (label, checked, onChange) => h('button', { type: 'button', role: 'checkbox', class: 'cb', 'aria-checked': String(!!checked), 'aria-label': label, onClick: () => onChange(!checked) }, h('i', null, checked ? Icon('check', 'sm') : null));
  const selBox = (key, label) => Cb('حدد ' + (label || ''), S.sel.has(key), (v) => { if (v) S.sel.add(key); else S.sel.delete(key); R(); });
  const allBox = (keys) => Cb('حدد الكل', keys.length > 0 && keys.every((k) => S.sel.has(k)), (v) => { keys.forEach((k) => (v ? S.sel.add(k) : S.sel.delete(k))); R(); });
  // the owner 15 Nov («شيل كلمة القسم AR وخلّي البيانات بدروب داون، وخلّي دروب داون الأقسام فيه خانة بحث»): the shared edit of the
  // selected rows = the same lists as the cards — the site's categories (the list opens with a search box), the colors / materials /
  // styles as Arabic–English pairs (one pick sets both languages, so no «… AR» fields), the maker's brands; the names stay typed
  function bulkEdit() {
    const keep = { value: '', label: 'من غير تغيير' };
    const pairs = (list) => [keep].concat(list.map(([en, ar]) => ({ value: en, label: ar && ar !== en ? ar + ' — ' + en : en })));
    const catOpts = [keep].concat(cats().map((c) => ({ value: String(c.id), label: c.path })));
    const s = st(); const vd = V() && V().data ? V().data() : null;
    const brands = vd ? vd.brands.filter((b) => s.vendorId && String(b.owner) === String(s.vendorId)).map((b) => b.name) : [];
    K.form({ title: 'تعديل مشترك لـ ' + S.sel.size + ' صف', values: { cat: '', brand: '', color: '', material: '', style: '', nameAr: '', nameEn: '' }, submitLabel: 'طبّق على المحدد',
      note: U.InlineNote({ children: 'اللي مسيبه «من غير تغيير» أو فاضي مابيتغيّرش. اللون والخامة والستايل بيتحطوا بالعربي والإنجليزي مع بعض.' }),
      fields: (f, e, set) => [
        catOpts.length > 1 ? (window.IBCatField ? window.IBCatField({ id: 'cat', label: 'القسم', single: true, ids: f.cat ? [Number(f.cat)] : [], placeholder: 'من غير تغيير — اختار من الشجرة', onPick: (ids) => set('cat', ids.length ? String(ids[0]) : '', true), onClear: () => set('cat', '', true) }) : K.field.select('cat', 'القسم', catOpts, f, e, set, { placeholder: 'اختار القسم — اكتب أول حروف اسمه' })) : null,
        brands.length > 1 ? K.field.select('brand', 'البراند', [keep].concat(brands.map((b) => ({ value: b, label: b }))), f, e, set) : null,
        K.two(K.field.select('color', 'اللون', pairs(colorList()), f, e, set), K.field.select('material', 'الخامة', pairs(FD.MATERIALS), f, e, set)),
        K.field.select('style', 'الستايل', pairs(styleList()), f, e, set),
        K.two(K.field.text('nameAr', 'الاسم بالعربي', f, e, set, {}), K.field.text('nameEn', 'الاسم بالإنجليزي', f, e, set, { dir: 'ltr' }))],
      submit: async (f) => {
        const sel = rows().filter((r) => S.sel.has(r.key)); const pick = (list, v) => list.find(([en]) => en === v) || null;
        const col = f.color ? pick(colorList(), f.color) : null; const mat = f.material ? pick(FD.MATERIALS, f.material) : null; const sty = f.style ? pick(styleList(), f.style) : null;
        const code = col ? await codeForColor(col[0], col[1]) : null;
        sel.forEach((r) => {
          const put = (k, v) => { if (v) { r[k] = v; if (r.ai) delete r.ai[k]; } };
          if (f.cat) put('catEn', pathOfId(f.cat));
          put('brand', f.brand);
          if (col) { const old = codeOfRow(r); put('colorEn', col[0]); put('colorAr', col[1]); if (code) recolorSku(r, old, code); }
          if (mat) { put('materialEn', mat[0]); put('materialAr', mat[1]); }
          if (sty) { put('styleEn', sty[0]); put('styleAr', sty[1]); }
          put('nameAr', String(f.nameAr || '').trim()); put('nameEn', String(f.nameEn || '').trim());
        });
        touch(); R();
      } });
  }
  const BulkBar = (btns) => (S.sel.size ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد' }, h('b', null, 'محدد ' + S.sel.size), h('span', { class: 'grow' }), ...btns, Button({ type: 'text', size: 'sm', label: 'إلغاء التحديد', onClick: () => { S.sel.clear(); R(); } })) : null);
  // the owner 15 Nov («خلي الاسم و الوصف فيهم امكانية اعادة الكتابة بال ايه اي»): a new, better version of the name or the description by
  // the AI (want rewriteName / rewriteDesc — the same facts) — from the Arabic column both languages change (the Arabic leads, like the
  // translation), from the English column the English only; marked «AI — راجع» until edited
  const rwKey = (key, what, lang) => 'rw:' + key + ':' + what + ':' + lang;
  async function rewriteGroup(key, what, lang, notes) {
    const tk = rwKey(key, what, lang); if (S.tr.has(tk)) return;
    S.tr.add(tk); RF(); await touch(true);
    const gi = groups().findIndex((x) => x.key === key);
    const r = gi < 0 ? { ok: false, reason: 'not_found' } : await AI().studio(S.id, gi, [what === 'name' ? 'rewriteName' : 'rewriteDesc'], notes);
    S.tr.delete(tk);
    if (!r.ok) { K.toast('مقدرناش نعيد الكتابة — ' + why(r.reason), 'error'); RF(); return; }
    const f = r.fields || {}; const g = groups().find((x) => x.key === key);
    const sets = what === 'name' ? (lang === 'ar' ? [['nameAr', f.nameAr], ['nameEn', f.nameEn]] : [['nameEn', f.nameEn]])
      : (lang === 'ar' ? [['shortAr', f.shortDescAr], ['shortEn', f.shortDesc]] : [['shortEn', f.shortDesc]]);
    let n = 0;
    (g ? g.rows : []).forEach((ri) => { const x = rows()[ri]; x.ai = Object.assign({}, x.ai); sets.forEach(([k, v]) => { if (v) { x[k] = v; x.ai[k] = true; n += 1; } }); });
    if (!n) K.toast('الـ AI مارجّعش نسخة جديدة — جرّب تاني', 'warning');
    touch(); RF();
  }
  // ---------------- the data step's cards (the owner 15 Nov: «نقسمها لجزئين إنجليزي و عربي … الصورة علي اليمين و جمبهم البيانات») ----------------
  // a product = one card: the head (its number, the brand, the SKU, the category, the weight), then the photo on the right, the Arabic
  // column and the English column side by side; a Variable's colors and sizes per variation under them. The fields a product shares
  // (the names, the descriptions, the category, the material, the style) write every row of a Variable.
  const setAll = (rs, k, v) => rs.forEach((x) => { x[k] = v; if (x.ai) delete x.ai[k]; });
  function textField(rs, k, label, o) {
    const r = rs[0]; const opt = o || {}; const id = 'fl-' + k + '-' + r.key; const area = k.startsWith('short'); const ai = !!(r.ai && r.ai[k]);
    const inp = h(area ? 'textarea' : 'input', { id, class: 'input fl-in' + (ai ? ' is-ai' : ''), 'data-fl': k, dir: opt.dir || (k.endsWith('Ar') ? 'rtl' : k === 'sku' ? 'ltr' : 'auto'), rows: area ? 4 : undefined,
      inputmode: k === 'weight' ? 'decimal' : undefined, value: r[k] == null ? '' : String(r[k]),
      onChange: (ev) => { const v = String(ev.target.value).trim(); const was = r[k] == null ? '' : String(r[k]); setAll(rs, k, k === 'weight' ? (v === '' ? null : Number(v)) : v); if (opt.after && v !== was) opt.after(v); touch(); RF(); } });
    if (area) inp.value = r[k] || '';
    // the owner 15 Nov («خلّي بس علامة الـ AI جوه الخانات ولما أقف عليها بالماوس تقولي إعادة كتابة عشان نقلل الزحمة»): the rewrite is a
    // small sparkle inside the field (its end), «إعادة كتابة» on hover; it asks for instructions first (askRewrite)
    const rw = opt.rw; const working = rw && S.tr.has(rwKey(rw.key, rw.what, rw.lang));
    const rwBtn = rw ? h('button', { type: 'button', class: 'fl-rw-in' + (working ? ' is-busy' : ''), 'data-fl-rewrite': k, 'data-tip': working ? 'بيكتب…' : 'إعادة كتابة', disabled: working || !!S.busy,
      'aria-label': 'إعادة كتابة ' + label + ' بالـ AI', 'aria-busy': working ? 'true' : 'false', onClick: () => askRewrite(rw, label) }, Icon('sparkle', 'sm')) : null;
    const lab = h('label', { for: id }, label, ai ? h('span', { class: 'fl-aitag' }, 'AI — راجع') : null);
    return h('div', { class: 'fl-f' + (opt.cls ? ' ' + opt.cls : '') }, lab, rwBtn ? h('div', { class: 'fl-inwrap' + (area ? ' is-area' : '') }, inp, rwBtn) : inp);
  }
  function newPair(title, done) {
    K.form({ title, values: { ar: '', en: '' }, submitLabel: 'ضيف',
      fields: (f, e, set) => [K.field.text('ar', 'بالعربي', f, e, set, {}), K.field.text('en', 'بالإنجليزي', f, e, set, {})],
      validate: (f) => { const e = {}; if (!String(f.ar || '').trim()) e.ar = 'اكتبه بالعربي'; if (!String(f.en || '').trim() || /[\u0600-\u06FF]/.test(f.en)) e.en = 'اكتبه بالإنجليزي'; return e; },
      submit: (f) => done(String(f.en).trim().slice(0, 40), String(f.ar).trim().slice(0, 40)) });
  }
  // a dropdown of [English, Arabic] pairs: the Arabic column shows the Arabic names, the English the English; a pick sets both
  // fixed: the list is all there is (the shop's own styles — comments decision 51): no «+ جديد…»
  function pairField(rs, kEn, kAr, list, lang, label, onPick, fixed) {
    const r = rs[0]; const k = lang === 'ar' ? kAr : kEn; const id = 'fl-' + k + '-' + r.key;
    const hit = FD.pairOf(list, r[kEn], r[kAr]); const cur = (lang === 'ar' ? r[kAr] || r[kEn] : r[kEn] || r[kAr]) || '';
    const options = [{ value: '', label: '—' }].concat(list.map(([en, ar]) => ({ value: en, label: lang === 'ar' ? ar : en })), !hit && cur ? [{ value: '__cur', label: fixed ? cur + (lang === 'ar' ? ' (مش على الموقع)' : ' (not on the site)') : cur }] : [],
      fixed ? [] : [{ value: '__new', label: lang === 'ar' ? '+ جديد…' : '+ New…' }]);
    const ai = !!(r.ai && (r.ai[kEn] || r.ai[kAr]));
    return h('div', { class: 'fl-f fl-pick' + (ai ? ' is-ai' : ''), 'data-fl-pick': k, dir: lang === 'ar' ? 'rtl' : 'ltr' },
      U.Select({ id, label: ai ? label + ' · AI' : label, options, value: hit ? hit[0] : cur ? '__cur' : '', onChange: (v) => {
        if (v === '__cur') return;
        if (v === '__new') { newPair('إضافة ' + label, (en, ar) => onPick(rs, en, ar)); return; }
        const p = list.find(([en]) => en === v); onPick(rs, p ? p[0] : '', p ? p[1] : ''); } }));
  }
  const pickBoth = (kEn, kAr) => (rs, en, ar) => { setAll(rs, kEn, en); setAll(rs, kAr, ar); touch(); R(); };
  const pickColor = async (rs, en, ar) => { const x = rs[0]; const old = codeOfRow(x); setAll(rs, 'colorEn', en); setAll(rs, 'colorAr', ar); R();
    const code = en ? await codeForColor(en, ar) : null; if (code) recolorSku(x, old, code); touch(); R(); };
  const colorList = () => colors().map((c) => [c.name_en, c.name_ar]);
  // the Arabic size typed → the English size from it (digits, units, the dimension words)
  const sizeAfter = (rs) => (v) => { const en = FD.sizeEnOf(v); if (en) setAll(rs, 'size', en); };
  function catField(rs) {
    const r = rs[0]; const id = 'fl-cat-' + r.key; const list = cats(); const now = catIdOf(r.catEn); const ai = !!(r.ai && r.ai.catEn);
    if (!list.length) return textField(rs, 'catEn', 'القسم', { dir: 'ltr' });
    const options = list.map((c) => ({ value: String(c.id), label: c.path })).concat(now == null && r.catEn ? [{ value: '__cur', label: r.catEn + ' (مش على الموقع)' }] : []);
    // the owner 16 Nov («فلتر الشجرة»): one category from the site's tree
    if (window.IBCatField) return h('div', { class: 'fl-f fl-pick fl-cat' + (ai ? ' is-ai' : ''), 'data-fl-pick': 'catEn' },
      window.IBCatField({ id, label: ai ? 'القسم · AI' : 'القسم', single: true, ids: now != null ? [now] : [], title: 'قسم «' + (r.nameAr || r.nameEn || 'المنتج') + '»', placeholder: now == null && r.catEn ? r.catEn + ' (مش على الموقع)' : 'اختار القسم من الشجرة',
        onPick: (ids) => { if (!ids.length) return; setAll(rs, 'catEn', pathOfId(String(ids[0]))); touch(); R(); } }));
    return h('div', { class: 'fl-f fl-pick fl-cat' + (ai ? ' is-ai' : ''), 'data-fl-pick': 'catEn' },
      U.Select({ id, label: ai ? 'القسم · AI' : 'القسم', options, value: now != null ? String(now) : r.catEn ? '__cur' : '', placeholder: 'اختار القسم', onChange: (v) => { if (v === '__cur') return; setAll(rs, 'catEn', pathOfId(v)); touch(); R(); } }));
  }
  function groupMenu(g, rs) {
    const keys = rs.map((x) => x.key);
    return K.RowMenu([{ label: 'املأ الناقص أو أعد الكتابة بالـ AI', icon: 'sparkle', run: () => askFill(new Set(keys)) },
      { label: 'ترجم الإنجليزي من العربي', icon: 'sparkle', run: () => translateGroup(g.key, { name: true, desc: true }) },
      { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => K.confirm({ title: 'تشيل «' + (rs[0].nameAr || rs[0].nameEn || rs[0].sku || 'المنتج') + '» من الدفعة؟', text: 'بيتشال من الدفعة دي بس' + (rs.length > 1 ? ' (' + rs.length + ' تركيبات).' : '.'), okLabel: 'شيل', okType: 'danger',
        onOk: () => { const s = st(); s.rows = s.rows.filter((x) => !keys.includes(x.key)); keys.forEach((k) => S.sel.delete(k)); touch(); R(); } }) }], 'إجراءات ' + (rs[0].sku || rs[0].nameAr || ''));
  }
  // comments decision 43 («اقدر ادوس علي الصورة و اعدلها او اغيرها … ف بوب اب يفتحلي الصورة و اختار تبديل او انشاء صورة بالذكاء الاصطناعي»):
  // the picture's popup — the maker's photo large with «تبديل الصورة» (another photo in its place: the row's reference), and the AI's
  // picture of the product («صورة 1 · في النص», the first shot of the photos step) made from it by «ولّد صورة بالذكاء الاصطناعي» after
  // the instructions popup; once made it shows there with «تعديل» (the points on the picture) and «إعادة توليد»
  function photoPopup(x) {
    const s = st(); const key = x.key; let m = null; let busy = '';
    const rowNow = () => rows().find((r) => r.key === key) || null;
    const unitNow = () => { const ri = rows().findIndex((r) => r.key === key); return ri < 0 ? null : units().find((u) => u.rows.includes(ri)) || null; };
    const srcOf = (r) => Number(s.case === 'whatsapp' ? r.product : r.src);
    const swap = () => filePick('image/*', false, async (fs) => { const r = rowNow(); if (!r || busy) return; busy = 'swap'; draw(); await swapPhoto(srcOf(r), fs[0]); busy = ''; draw(); });
    const gen = async (again) => {
      const u = unitNow(); const r = rowNow(); if (!u || !r || busy) return;
      if (!(r.ref || unitRow(u).ref)) { K.toast('ارفع صورة للمنتج الأول — الـ AI بيولّد منها', 'error'); return; }
      const a = await window.IBAIAsk({ title: (again ? 'إعادة توليد' : 'توليد') + ' صورة «' + (r.nameAr || r.nameEn || r.sku || 'المنتج') + '» بالذكاء الاصطناعي', intro: 'صورة للمنتج نفسه في نص الكادر على خلفية نضيفة («صورة 1 · في النص») — بتتولّد من صورة المبتكر وبتظهر في خطوة «الصور».', go: 'ابدأ التوليد' });
      if (!a) return;
      busy = 'gen'; draw(); const ok = await genShot(u, 0, a.notes); busy = ''; draw();
      if (ok) K.toast('اتولّدت الصورة — راجعها', 'success');
    };
    function draw() {
      const r = rowNow(); const u = unitNow(); if (!r || !u) { if (m) m.close(); return; }
      const ref = r.ref || unitRow(u).ref || null; const shot = shotsOf(u)[0] || null; const own = !!r.ref;
      const box = (attr, title, sub, img, acts) => h('div', { class: 'fl-pp-box', ['data-pp-' + attr]: '' }, h('div', { class: 'fl-pp-h' }, h('b', null, title), h('small', { class: 'help' }, sub)), img, h('div', { class: 'acts-inline fl-pp-acts' }, acts));
      const body = h('div', { class: 'fl-pp' },
        box('ref', 'صورة المبتكر', own ? 'الصورة المرجعية للمنتج — الصور بتتولّد منها' : ref ? 'صورة المنتج (التركيبة دي مالهاش صورة لوحدها)' : 'مفيش صورة لسه',
          busy === 'swap' ? h('span', { class: 'thumb fl-pp-img gen' }, 'بنرفع…') : Thumb(ref, 'fl-pp-img'),
          [Button({ icon: 'upload', label: ref && own ? 'تبديل الصورة' : 'ارفع صورة', disabled: !!busy, attrs: { 'data-pp-swap': '' }, onClick: swap })]),
        box('ai', 'صورة الذكاء الاصطناعي', 'صورة 1 · في النص' + (shot ? '' : ' — لسه ما اتولّدتش'),
          busy === 'gen' ? h('span', { class: 'thumb fl-pp-img gen' }, 'بيتولّد…') : shot ? Thumb(shot, 'fl-pp-img') : h('span', { class: 'thumb fl-pp-img na' }, Icon('sparkle', 'md'), h('span', null, 'ولّد صورة للمنتج من صورة المبتكر')),
          shot ? [Button({ icon: 'edit', label: 'تعديل', disabled: !!busy, attrs: { 'data-pp-edit': '' }, onClick: () => { m.close(); shotModal(u, 0); } }), Button({ icon: 'sparkle', label: 'إعادة توليد', disabled: !!busy, attrs: { 'data-pp-gen': '' }, onClick: () => gen(true) })]
            : [Button({ type: 'primary', icon: 'sparkle', label: 'ولّد صورة بالذكاء الاصطناعي', disabled: !!busy || !ref, attrs: { 'data-pp-gen': '' }, onClick: () => gen(false) })]));
      if (!m) { m = U.Modal({ title: 'صورة المنتج — ' + (r.nameAr || r.nameEn || r.sku || ''), body, footer: [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })] }); m.el.classList.add('wide'); m.el.setAttribute('data-fl-photo-pop', ''); }
      else m.setBody(body);
    }
    draw();
  }
  function dataCard(g, n) {
    const rs = g.rows.map((ri) => rows()[ri]); const R0 = rs[0]; const vari = g.type === 'Variable'; const keys = rs.map((x) => x.key); const s = st();
    const issues = [...new Set(rs.flatMap(ISSUE_FIELDS))]; const tr = S.tr.has(g.key);
    const head = h('div', { class: 'fl-dhead' },
      Cb('حدد ' + (R0.nameAr || R0.nameEn || R0.sku || ''), keys.every((k) => S.sel.has(k)), (v) => { keys.forEach((k) => (v ? S.sel.add(k) : S.sel.delete(k))); R(); }),
      h('b', { class: 'fl-dnum num' }, '#' + n), Tag(vari ? 'info' : 'neutral', vari ? 'Variable · ' + rs.length + ' تركيبات' : 'Simple'),
      h('div', { class: 'fl-dbrand' }, h('small', null, 'البراند'), h('b', null, s.brandName || R0.brand || '—')),
      vari ? h('div', { class: 'fl-dbrand' }, h('small', null, 'SKU الأساسي'), h('b', { class: 'num' }, h('bdi', { dir: 'ltr' }, FD.skuBase(R0.sku) || '—'))) : textField(rs, 'sku', 'SKU', { cls: 'fl-sku' }),
      catField(rs), vari ? null : textField(rs, 'weight', 'الوزن (كجم)', { cls: 'fl-w' }),
      h('span', { class: 'grow' }),
      issues.length ? h('span', { class: 'fl-dmiss', title: issues.join('، ') }, 'ناقص: ' + issues.join('، ')) : h('span', { class: 'fl-dok' }, Icon('check', 'sm'), 'كامل'),
      groupMenu(g, rs));
    const nameAfter = () => translateGroup(g.key, { name: true }); const descAfter = () => translateGroup(g.key, { desc: true });
    const ar = h('div', { class: 'fl-dcol', lang: 'ar', dir: 'rtl' }, h('div', { class: 'fl-dcol-h' }, 'عربي'),
      textField(rs, 'nameAr', 'الاسم', { after: nameAfter, rw: { key: g.key, what: 'name', lang: 'ar' } }), textField(rs, 'shortAr', 'الوصف', { after: descAfter, rw: { key: g.key, what: 'desc', lang: 'ar' } }),
      vari ? null : h('div', { class: 'fl-2' }, pairField(rs, 'colorEn', 'colorAr', colorList(), 'ar', 'اللون', pickColor), textField(rs, 'sizeAr', 'المقاس', { after: sizeAfter(rs) })),
      h('div', { class: 'fl-2' }, pairField(rs, 'materialEn', 'materialAr', FD.MATERIALS, 'ar', 'الخامة', pickBoth('materialEn', 'materialAr')), pairField(rs, 'styleEn', 'styleAr', styleList(), 'ar', 'الستايل', pickBoth('styleEn', 'styleAr'), shopStyles())));
    const en = h('div', { class: 'fl-dcol', lang: 'en', dir: 'ltr' }, h('div', { class: 'fl-dcol-h' }, 'English', tr ? h('span', { class: 'fl-trans', role: 'status' }, 'بيترجم…') : null),
      textField(rs, 'nameEn', 'Product name', { dir: 'ltr', rw: { key: g.key, what: 'name', lang: 'en' } }), textField(rs, 'shortEn', 'Description', { dir: 'ltr', rw: { key: g.key, what: 'desc', lang: 'en' } }),
      vari ? null : h('div', { class: 'fl-2' }, pairField(rs, 'colorEn', 'colorAr', colorList(), 'en', 'Colour', pickColor), textField(rs, 'size', 'Size', { dir: 'ltr' })),
      h('div', { class: 'fl-2' }, pairField(rs, 'materialEn', 'materialAr', FD.MATERIALS, 'en', 'Material', pickBoth('materialEn', 'materialAr')), pairField(rs, 'styleEn', 'styleAr', styleList(), 'en', 'Style', pickBoth('styleEn', 'styleAr'), shopStyles())));
    const photos = (R0.photos || []).length;
    // comments decision 43: the picture — the card's or a variation's — is a button: it opens the picture's popup
    const picBtn = (x, cls) => h('button', { type: 'button', class: 'fl-pic-btn', 'data-fl-photo': x.key, title: 'افتح الصورة — بدّلها أو ولّد صورة بالذكاء الاصطناعي', 'aria-label': 'صورة ' + (x.nameAr || x.nameEn || x.sku || 'المنتج') + ' — افتحها', onClick: () => photoPopup(x) },
      Thumb(x.ref || R0.ref, cls), h('span', { class: 'fl-pic-i', 'aria-hidden': 'true' }, Icon('edit', 'sm')));
    const pic = h('div', { class: 'fl-dpic' }, picBtn(R0, 'fl-dimg'), photos > 1 ? h('small', { class: 'help' }, photos + ' صور') : null);
    const vars = vari ? h('div', { class: 'fl-vars' }, h('div', { class: 'fl-vars-h' }, 'التركيبات'), rs.map((x) => h('div', { class: 'fl-var' + (ISSUE_FIELDS(x).length ? ' row-err' : ''), 'data-row': x.key },
      picBtn(x, 'fl-pthumb'), textField([x], 'sku', 'SKU', { cls: 'fl-sku' }),
      pairField([x], 'colorEn', 'colorAr', colorList(), 'ar', 'اللون', pickColor), pairField([x], 'colorEn', 'colorAr', colorList(), 'en', 'Colour', pickColor),
      textField([x], 'sizeAr', 'المقاس', { after: sizeAfter([x]) }), textField([x], 'size', 'Size', { dir: 'ltr' }), textField([x], 'weight', 'الوزن', { cls: 'fl-w' }),
      U.IconButton({ icon: 'trash', label: 'شيل التركيبة ' + (x.sku || ''), onClick: () => { const s2 = st(); s2.rows = s2.rows.filter((y) => y !== x); S.sel.delete(x.key); touch(); R(); } })))) : null;
    return h('section', { class: 'fl-dcard' + (issues.length ? ' has-miss' : ''), 'data-row': R0.key, 'data-group': g.key }, head, h('div', { class: 'fl-dbody' }, pic, ar, en), vars);
  }
  function step3() {
    const s = st(); const L = rows(); const G = groups();
    // a size the sheet gave in English only → its Arabic written from it («40 × 40 cm» → «40 × 40 سم»), so the Arabic column is whole
    let sized = false; L.forEach((r) => { if (r.size && !r.sizeAr) { r.sizeAr = arSize(r); sized = true; } });
    // the maker's copy comes back with one colour and one size column (comments decision 36), read as the Arabic ones: the English
    // size written from it, and the colour matched to the colours table by either name
    L.forEach((r) => {
      if (r.sizeAr && !r.size) { const e = FD.sizeEnOf(r.sizeAr); if (e) { r.size = e; sized = true; } }
      if (r.colorAr && !r.colorEn) { const a = String(r.colorAr).trim().toLowerCase(); const c = colors().find((y) => String(y.name_ar).trim() === String(r.colorAr).trim() || String(y.name_en).toLowerCase() === a); if (c) { r.colorEn = c.name_en; r.colorAr = c.name_ar; sized = true; } }
    });
    if (sized) touch();
    if (S.autoSku !== S.id && FD.validCode(s.code) && L.some((r) => !FD.validSku(r.sku) || (r.colorEn && !colorOf(r)))) { S.autoSku = S.id; setTimeout(() => genSkus(true), 0); } // once per batch opened
    // the owner 15 Nov: the AI fills what is missing by itself when the step opens (once per batch opened; the button stays for later)
    if (S.autoAi !== S.id && !S.busy && G.some((g) => needOf(g).length)) { S.autoAi = S.id; setTimeout(() => aiFill(null, true), 0); }
    const miss = G.filter((g) => g.rows.some((ri) => ISSUE_FIELDS(rows()[ri]).length)).length;
    const keys = L.map((r) => r.key);
    const head = Card('البيانات', G.length + ' منتج' + (L.length !== G.length ? ' · ' + L.length + ' صف' : '') + (miss ? ' · ' + miss + ' ناقصهم بيانات' : ' · كاملين'), [
      BulkBar([Button({ size: 'sm', icon: 'edit', label: 'تعديل مشترك', onClick: bulkEdit }), Button({ size: 'sm', icon: 'sparkle', label: 'املأ أو أعد الكتابة بالـ AI', disabled: !!S.busy, onClick: () => askFill(new Set(S.sel)) }),
        Button({ size: 'sm', type: 'danger', icon: 'trash', label: 'احذف', onClick: () => K.confirm({ title: 'تحذف ' + S.sel.size + ' صف من الدفعة؟', okLabel: 'احذف', okType: 'danger', onOk: () => { s.rows = s.rows.filter((r) => !S.sel.has(r.key)); S.sel.clear(); touch(); R(); } }) })]),
      h('div', { class: 'fl-dtools' }, allBox(keys), h('span', null, 'حدد الكل'), S.busy === 'ai' ? h('span', { class: 'fl-trans', role: 'status' }, 'الـ AI بيملا البيانات…') : null),
      h('div', { class: 'fl-dlist', 'data-fl-data': '' }, G.map((g, i) => dataCard(g, i + 1))),
      U.InlineNote({ children: 'الـ AI بيملا الناقص لوحده (الاسم والوصف والقسم والخامة والستايل واللون من الصورة)، والخانة اللي اتملت بالـ AI عليها علامة لحد ما تتعدّل. أي تعديل في الاسم أو الوصف بالعربي بيتترجم للإنجليزي لوحده، واللون والخامة والستايل بيتغيّروا في العمودين مع بعض. الـ SKU بيتولّد لوحده (المسلسل من الموقع).' })],
      [Button({ size: 'sm', label: 'ولّد الـ SKU للناقص', attrs: { 'data-flow-sku': '' }, onClick: () => genSkus(false) }), Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: S.busy === 'ai' ? 'بيكتب…' : 'املأ الناقص أو أعد الكتابة بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-ai': '' }, onClick: () => askFill(null) })]);
    return [head, Foot(L.length > 0 && L.every((r) => FD.validSku(r.sku)), 'كل الصفوف محتاجة SKU')];
  }

  // ---------------- 4 الأسعار (decision 7) ----------------
  // the rate hidden (no sensitive.commission) → no price is worked out: the member types the sale price
  // r.rateAt = the rate | fee the computed price used: a rate changed since (the maker step, another category) prices it again
  // the owner 15 Nov (docs/superpowers/plans/2026-11-15-fake-discount.md decision 3): «قبل الخصم» by the tiers of the sale price —
  // this batch's own (state.fake, set from this step; { tiers: [] } = the old way for it) or the settings' default. r.fakeAt = the
  // tiers the computed price used (a rule changed since prices it again, like r.rateAt); r.regHand = «قبل الخصم» typed by hand.
  const FK = () => window.IBFakeDiscount;
  const fakeOwn = () => { const b = st() && st().fake; return !!(b && Array.isArray(b.tiers)); };
  const fakeNow = () => (fakeOwn() ? window.IbtekrProducts.fakeRule(st().fake) : (FK() ? FK().rule() : null));
  const fakeKey = () => { const f = fakeNow(); return f ? JSON.stringify(f.tiers) : ''; };
  function reprice(r, force) { const c = commOf(r); if (!c) return; const fake = fakeNow(); const p = FD.pricesOf(r.vendorPrice, { rate: c.rate, fee: c.fee, markup: r.markup == null ? undefined : r.markup, fake }); if (!p) return; if (r.markup == null) r.markup = p.markup; if (force || !r.priceHand) { r.sale = p.sale; r.regular = p.regular; r.rateAt = commKey(c); r.fakeAt = fake ? JSON.stringify(fake.tiers) : ''; } }
  // a sale price typed by hand: its «قبل الخصم» follows its tier (unless that one was typed by hand too)
  function refake(r) { if (r.regHand || !(Number(r.sale) > 0)) return; const g = window.IbtekrProducts.fakeRegular(Number(r.sale), fakeNow()); if (g != null) r.regular = g; }
  // the tiers changed in this step: every row not priced by hand again, and the hand-priced sale's «قبل الخصم» by its tier
  function refakeAll() { rows().forEach((r) => { if (r.vendorPrice != null && !r.priceHand) reprice(r, true); else if (r.priceHand) refake(r); }); }
  function step4() {
    const L = rows(); const rate = rateNow();
    const fkey = fakeKey();
    L.forEach((r) => { if (r.vendorPrice == null) return; if (r.sale == null || (!r.priceHand && (r.rateAt !== commKey(commOf(r)) || (r.fakeAt || '') !== fkey))) reprice(r); });
    const num = (r, k, onSet) => moneyBox(h('input', { class: 'input fl-num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-fl': k, 'aria-label': FD.LABELS[k] + ' — ' + (r.sku || ''), value: r[k] == null ? '' : String(r[k]), onChange: (ev) => { r[k] = FD.money(ev.target.value); onSet(); touch(); RF(); } }));
    const bulk = () => K.form({ title: 'سعر المبتكر لـ ' + S.sel.size + ' صف', values: { v: '' }, submitLabel: 'طبّق',
      fields: (f, e, set) => [K.field.text('v', 'سعر المبتكر (ج.م)', f, e, set, { required: true, inputmode: 'decimal' })], validate: (f) => (FD.money(f.v) > 0 ? {} : { v: 'رقم أكبر من صفر' }),
      submit: (f) => { L.filter((r) => S.sel.has(r.key)).forEach((r) => { r.vendorPrice = FD.money(f.v); r.priceHand = false; r.regHand = false; reprice(r, true); }); touch(); R(); } });
    // the owner 15 Nov («صلح شكل الجدول و إظهر بيانات المنتج العربي بس»): a grid, not a <table> (the system's table sweeps — the sticky
    // first column, the person cell — broke its columns), the photo inside the product cell, the product's Arabic data only (its
    // Arabic name, the SKU, the Arabic color and size; the English one only while the Arabic is missing); on a phone a card each
    // the product's own rate (its category's when the maker has one there — «نسبة القسم»)
    const rateEl = (r) => { const c = commOf(r); return c == null ? '—' : h('span', { 'data-fl-row-rate': '', title: c.byCat ? 'نسبة القسم' : 'النسبة العامة' }, U.num(c.rate + '%'), c.byCat ? h('small', { class: 'help' }, ' · القسم') : null); };
    const pcell = (cls, label, child) => h('div', { class: 'fl-pc' + (cls ? ' ' + cls : ''), role: 'cell' }, label ? h('span', { class: 'fl-plbl', 'aria-hidden': 'true' }, label) : null, child);
    const prow = (r) => {
      const meta = [r.colorAr || r.colorEn, arSize(r)].filter(Boolean).join(' · ');
      return h('div', { class: 'fl-prow' + (!(Number(r.sale) > 0) ? ' row-err' : ''), role: 'row', 'data-row': r.key },
        pcell('c-cb', null, selBox(r.key, r.nameAr || r.nameEn || r.sku)),
        pcell('c-prod', null, h('div', { class: 'fl-pprod' }, Thumb(r.ref, 'fl-pthumb'), h('div', { class: 'fl-info' }, h('b', { dir: 'rtl', 'data-fl-name': '' }, r.nameAr || r.nameEn || '—'),
          h('small', { class: 'num' }, h('bdi', { dir: 'ltr' }, r.sku || '—')), meta ? h('small', null, meta) : null, h('small', { class: 'fl-prate-m' }, 'نسبة إبتكر ', rateEl(r))))),
        pcell(null, 'سعر المبتكر', num(r, 'vendorPrice', () => { r.priceHand = false; r.regHand = false; reprice(r, true); })),
        pcell('c-rate', null, h('span', { class: 'help' }, rateEl(r))),
        // comments decision 45 («سعر البيع … غير قابل للتعديل … بيتحسب تلقائي … من سعر المبتكر»): shown, never typed. The one exception is a
        // member the maker's rate is hidden from — nothing can be computed for him, so he still types it
        pcell(null, 'سعر البيع', commOf(r) == null ? num(r, 'sale', () => { r.priceHand = true; refake(r); })
          : h('input', { class: 'input fl-num is-ro', readonly: '', 'data-fl': 'sale', 'data-fl-auto': '', title: 'بيتحسب لوحده من سعر المبتكر ونسبة إبتكر', 'aria-label': FD.LABELS.sale + ' — ' + (r.sku || '') + ' (بيتحسب لوحده)', value: r.sale == null ? '' : String(r.sale) })),
        pcell(null, 'قبل الخصم', num(r, 'regular', () => { r.priceHand = true; r.regHand = true; })),
        pcell('c-menu', null, K.RowMenu([{ label: 'احسب السعر تاني', icon: 'undo', run: () => { r.priceHand = false; r.regHand = false; r.markup = null; reprice(r, true); touch(); R(); } }, { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => { st().rows = st().rows.filter((x) => x !== r); touch(); R(); } }], 'إجراءات ' + (r.sku || ''))));
    };
    const hcell = (label, cls) => h('div', { class: 'fl-pc' + (cls ? ' ' + cls : ''), role: 'columnheader' }, label);
    const table = h('div', { class: 'fl-plist', role: 'table', 'aria-label': 'الأسعار', 'data-fl-prices': '' },
      h('div', { class: 'fl-prow head', role: 'row' }, hcell(allBox(L.map((r) => r.key)), 'c-cb'), hcell('المنتج', 'c-prod'), hcell('سعر المبتكر'), hcell('نسبة إبتكر', 'c-rate'), hcell('سعر البيع'), hcell('قبل الخصم'), hcell('', 'c-menu')),
      L.map(prow));
    const ok = L.length > 0 && L.every((r) => Number(r.sale) > 0);
    // «الخصم الوهمي»: the tiers this batch is priced with, «تعديل» (the settings' own popup, for this batch) and «رجّع الافتراضي»
    const fakeBar = () => {
      const F = FK(); if (!F) return null; const rule = fakeNow(); const own = fakeOwn(); const admin = !!(window.IBSettings && window.IBSettings.can && window.IBSettings.can().admin);
      const edit = () => F.editor({ title: 'الخصم الوهمي للدفعة دي', rule, asDefault: admin, submitLabel: 'طبّق على الدفعة', note: 'التعديل هنا للدفعة دي بس — الافتراضي لكل الدفعات من «الإعدادات › إعدادات المبتكرين».',
        onSave: async (r, o) => {
          st().fake = r || { tiers: [] }; refakeAll(); touch(); R();
          if (!o || !o.asDefault) { K.toast('اتطبّقت على الدفعة', 'success'); return; }
          const res = await window.IBSettings.saveFake(r);
          if (res && res.ok) { delete st().fake; refakeAll(); touch(); R(); K.toast('اتحفظت كافتراضي واتطبّقت على الدفعة', 'success'); } else K.toast('اتطبّقت على الدفعة — بس الافتراضي ماتحفظش', 'warning');
        } });
      return h('div', { class: 'fl-fake', 'data-fl-fake': own ? 'batch' : 'default' },
        h('span', { class: 'fl-fake-text' }, h('b', null, 'الخصم الوهمي ' + (own ? '(للدفعة دي)' : '(الافتراضي)') + ': '), h('span', { 'data-fl-fake-text': '' }, F.text(rule))),
        Button({ size: 'sm', icon: 'sliders', label: 'تعديل', attrs: { 'data-fl-fake-edit': '' }, onClick: edit }),
        own ? Button({ size: 'sm', type: 'text', icon: 'undo', label: 'رجّع الافتراضي', attrs: { 'data-fl-fake-reset': '' }, onClick: () => { delete st().fake; refakeAll(); touch(); R(); K.toast('رجعت للافتراضي', 'success'); } }) : null);
    };
    return [Card('الأسعار', 'سعر البيع = (سعر المبتكر + الرسوم) ÷ (1 − نسبة إبتكر) لأقرب 10، وقبل الخصم = سعر البيع + زيادة شريحته من «الخصم الوهمي» (ومن غير شريحة: أعلى بـ 15–30%). نسبة إبتكر من حساب المبتكر — ولو القسم ليه نسبة لوحده بتتحسب بيها.', [
      rate == null ? U.InlineNote({ kind: 'warning', children: 'نسبة المبتكر مش ظاهرة لك — السعر مش هيتحسب لوحده، اكتب سعر البيع بإيدك.' }) : null,
      fakeBar(),
      BulkBar([Button({ size: 'sm', icon: 'edit', label: 'سعر المبتكر للمحدد', onClick: bulk })]), table]), Foot(ok, 'كل الصفوف محتاجة سعر بيع')];
  }

  // ---------------- 5 الصور (decision 8) ----------------
  const busyKey = (u, k) => 'img:' + u.key + ':' + k;
  const upKey = (u, k) => 'up:' + u.key + ':' + k;
  async function genShot(u, k, note, quiet) {
    if (S.busy === busyKey(u, k)) return;
    await touch(true); S.busy = busyKey(u, k); R();
    const r = await IM().generate(S.id, u.gi, k, { color: u.color || undefined, note: note || undefined });
    S.busy = '';
    S.lastGen = r;
    if (!r.ok || r.result !== 'ok' || !r.path) { if (!quiet) K.toast(genWhy(r), 'error'); R(); return false; }
    if (k === 4) st().sizeShot[groupKey(u.gi)] = r.path; else shotsOf(u)[k] = r.path;
    touch(); R(); return true;
  }
  const genWhy = (r) => (r.ok ? 'الموديل رفض الصورة' : ((IM().why ? IM().why(r) : '') || why(r.reason)));
  // comments decision 47 («لو مفيش كريدت من اول صورة يقولي و يوقف اللي بيعمله»): a failure every next picture would meet too — the
  // credit gone (ours for the month, or the provider's), the AI not set up, no permission — stops a bulk run where it is
  const genStops = (r) => !!r && !r.ok && (r.reason === 'ai_cap' || (r.reason === 'ai_error' && r.status === 402) || r.reason === 'not_configured' || r.reason === 'not_linked' || r.reason === 'forbidden');
  // the size drawing is the product's (one per group, its first unit), and only for a product with a size
  const hasSize = (gi) => { const g = groups()[gi]; return !!g && g.rows.some((ri) => String(rows()[ri].size || '').trim()); };
  const sizeUnit = (u) => { const first = units().find((x) => x.gi === u.gi); return !!first && first.key === u.key; };
  async function genMissing(list) {
    const jobs = []; const sized = new Set();
    list.forEach((u) => { shotsOf(u).forEach((p, k) => { if (!p) jobs.push([u, k]); }); if (!sized.has(u.gi) && !st().sizeShot[groupKey(u.gi)] && hasSize(u.gi)) { sized.add(u.gi); jobs.push([u, 4]); } });
    if (!jobs.length) { K.toast('مفيش صور ناقصة', 'success'); return; }
    let ok = 0; let tried = 0;
    for (const [u, k] of jobs) {
      tried += 1;
      if (await genShot(u, k, undefined, true)) { ok += 1; continue; }
      if (genStops(S.lastGen)) { // one message, and nothing more is asked for
        K.toast(genWhy(S.lastGen) + ' — وقفنا التوليد' + (ok ? ' بعد ' + ok + ' صورة' : ' من أول صورة') + ' (كان فاضل ' + (jobs.length - tried + 1) + ').', 'error'); return;
      }
    }
    K.toast('اتولّدت ' + ok + ' من ' + jobs.length + ' صورة', ok === jobs.length ? 'success' : 'warning');
  }
  // the owner 15 Nov («تحت الصور زرار إعادة توليد ويفتح بوب أب أقدر أحط فيه تعليمات قبل إعادة التوليد»): a filled slot → the
  // instructions popup (IBAIAsk) → the same shot generated again with them; the new one takes the slot
  async function regenShot(u, k) {
    const a = await window.IBAIAsk({ title: 'إعادة توليد ' + (k === 4 ? 'صورة المقاس' : SHOT_L[k]), intro: 'صورة جديدة لنفس اللقطة بنفس المنتج — والقديمة بتتبدل بيها.', go: 'ابدأ التوليد' });
    if (a) genShot(u, k, a.notes);
  }
  // «وكمان أداة تعديل على الصورة الموجودة بحيث أقدر أحط كومنت على جزء معين مع كتابة التعليمات»: the image large — a click on it puts a
  // numbered point there with what to change at it (up to 10, like the campaign review) — plus a general change; «عدّل» edits this
  // very image (ai-images edit with pins), and «بدّل بصورة من عندي» stays
  function shotModal(u, k) {
    const sh = shotsOf(u); const path = k === 4 ? st().sizeShot[groupKey(u.gi)] : sh[k]; if (!path) return;
    const pins = []; let note = '';
    const m = U.Modal({ title: 'تعديل ' + (k === 4 ? 'صورة المقاس' : SHOT_L[k]) + ' — ' + (unitRow(u).nameAr || unitRow(u).nameEn || unitRow(u).sku || ''), body: [], footer: [] });
    m.el.classList.add('wide', 'fl-big'); m.el.setAttribute('data-fl-pin-edit', '');
    const put = (p) => { if (k === 4) st().sizeShot[groupKey(u.gi)] = p; else sh[k] = p; touch(); };
    const draw = () => {
      const stage = h('div', { class: 'fl-pin-stage', 'data-pin-stage': '', role: 'application', 'aria-label': 'الصورة — دوس في أي مكان تحط تعليق' }, Thumb(path, 'fl-pin-img'),
        pins.map((x, i) => h('button', { type: 'button', class: 'fl-pin', style: 'left:' + x.x + '%;top:' + x.y + '%', 'data-pin': String(i + 1), 'aria-label': 'تعليق ' + (i + 1) + (x.text ? ': ' + x.text : ''),
          onClick: (e) => { e.stopPropagation(); const f = document.getElementById('fl-pin-t-' + i); if (f) f.focus(); } }, String(i + 1))));
      stage.addEventListener('click', (e) => {
        const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
        if (pins.length >= 10) { K.toast('10 تعليقات بالكتير', 'warning'); return; }
        const x = Math.round((e.clientX - r.left) / r.width * 100), y = Math.round((e.clientY - r.top) / r.height * 100);
        pins.push({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)), text: '' }); draw();
        setTimeout(() => { const f = document.getElementById('fl-pin-t-' + (pins.length - 1)); if (f) f.focus(); }, 0);
      });
      const list = pins.length ? h('div', { class: 'fl-pins', 'data-pins': String(pins.length) }, pins.map((x, i) => h('div', { class: 'fl-pin-row' }, h('span', { class: 'fl-pin sm', 'aria-hidden': 'true' }, String(i + 1)),
        (() => { const inp = h('input', { type: 'text', class: 'input', id: 'fl-pin-t-' + i, value: x.text, maxlength: 200, placeholder: 'عايز إيه يتعدل هنا؟', 'aria-label': 'تعليق ' + (i + 1) }); inp.addEventListener('input', () => { x.text = inp.value; }); return inp; })(),
        U.IconButton({ icon: 'trash', label: 'شيل تعليق ' + (i + 1), onClick: () => { pins.splice(i, 1); draw(); } }))))
        : h('p', { class: 't-small help', style: 'margin:0' }, 'دوس على أي حتة في الصورة تحط نقطة واكتب عندها التعديل.');
      m.setBody(h('div', { class: 'fl-pin-grid' }, stage, h('div', { class: 'fl-pin-side' }, h('div', { class: 't-label' }, 'التعليقات على الصورة' + (pins.length ? ' (' + pins.length + ')' : '')), list,
        U.Textarea({ id: 'fl-edit', label: 'تعديل عام (اختياري)', rows: 3, maxlength: 500, value: note, placeholder: 'مثال: خلفية أفتح وظل أخف، من غير ما المنتج يتغيّر', onInput: (v) => { note = v; } }))));
    };
    m.setFooter(Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() }),
      Button({ label: 'بدّل بصورة من عندي', icon: 'upload', onClick: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'u' + u.gi + '-' + k, { webp: true }); if (r.ok) { put(r.path); m.close(); R(); } }) }),
      Button({ type: 'primary', icon: 'sparkle', label: 'عدّل الصورة', attrs: { 'data-fl-pin-go': '' }, onClick: async () => {
        const ps = pins.filter((x) => String(x.text || '').trim()); const all = note.trim();
        if (!ps.length && !all) { K.toast('حط تعليق على الصورة أو اكتب التعديل الأول', 'error'); return; }
        await touch(true); m.close(); S.busy = busyKey(u, k); R();
        const r = await IM().edit({ batchId: S.id, index: u.gi, path }, 'instruction', { prompt: all || undefined, pins: ps });
        S.busy = '';
        if (r.ok && r.path) { put(r.path); K.toast('اتعدّلت الصورة — راجعها', 'success'); } else K.toast(r.ok ? 'الموديل رفض التعديل' : (IM().why ? IM().why(r) : why(r.reason)), 'error');
        R(); } }));
    draw();
  }
  async function upShot(u, k, file) {
    if (!file || S.busy) return;
    S.busy = upKey(u, k); R();
    const r = await ST().uploadImage(S.id, file, 'u' + u.gi + '-' + k, { webp: true });
    S.busy = '';
    if (!r.ok) { R(); K.toast(r.reason === 'not_image' ? 'الصورة ماترفعتش: الصيغة مش مدعومة — حوّلها JPG أو PNG' : 'الصورة ماترفعتش — جرّب تاني', 'error'); return; }
    if (k === 4) st().sizeShot[groupKey(u.gi)] = r.path; else shotsOf(u)[k] = r.path;
    touch(); R();
  }
  function slot(u, k) {
    const sh = shotsOf(u); const path = k === 4 ? st().sizeShot[groupKey(u.gi)] : sh[k]; const gen = S.busy === busyKey(u, k); const label = k === 4 ? 'صورة المقاس' : SHOT_L[k];
    const el = h('div', { class: 'fl-slot' + (path ? '' : ' is-empty'), draggable: path && k < 4 ? 'true' : 'false', 'data-slot': u.key + ':' + k },
      h('small', { class: 'fl-slab', title: label }, label), gen ? h('span', { class: 'thumb fl-shot gen' }, 'بيتولّد…') : S.busy === upKey(u, k) ? h('span', { class: 'thumb fl-shot gen' }, 'بنرفع…') : Thumb(path, 'fl-shot'),
      h('div', { class: 'fl-sacts' }, path ? Button({ size: 'sm', icon: 'edit', label: 'تعديل', disabled: !!S.busy, attrs: { 'data-shot-edit': u.key + ':' + k }, onClick: () => shotModal(u, k) }) : null,
        path ? Button({ size: 'sm', icon: 'sparkle', label: 'إعادة توليد', disabled: !!S.busy, attrs: { 'data-shot-regen': u.key + ':' + k }, onClick: () => regenShot(u, k) }) : null,
        path ? U.IconButton({ icon: 'trash', label: 'حذف', onClick: () => { if (k === 4) delete st().sizeShot[groupKey(u.gi)]; else sh[k] = null; touch(); R(); } }) : null,
        !path ? Button({ size: 'sm', icon: 'sparkle', label: 'ولّد بالـ AI', disabled: !!S.busy, attrs: { 'data-gen': u.key + ':' + k }, onClick: () => genShot(u, k) }) : null,
        // comments decision 48 («جمب زر التوليد يبقي فيه رفع»): a photo of the member's own goes straight into the empty slot
        !path ? Button({ size: 'sm', icon: 'upload', label: 'رفع', disabled: !!S.busy, attrs: { 'data-shot-up': u.key + ':' + k, title: 'ارفع صورة من عندك للخانة دي' }, onClick: () => filePick('image/*', false, (f) => upShot(u, k, f[0])) }) : null));
    if (k < 4) {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', u.key + ':' + k); });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => { e.preventDefault(); const [key, from] = String(e.dataTransfer.getData('text/plain')).split(/:(?=\d$)/); if (key !== u.key) return; const a = Number(from); const t = sh[a]; sh[a] = sh[k]; sh[k] = t; touch(); R(); });
    }
    return el;
  }
  // ---------------- Magnific in the photos step (comments decision 49) ----------------
  // «هنزود زر ابعت ل magnific — بالفلو بتاعه اللي كنا عاملينه»: the old wizard's bridge in the three flows too. The products' photos go to the
  // «ابتكر» project on Magnific (the account linked in the settings — without one they wait in the queue), «جهّز فلو» builds the batch's
  // flow on the studio's Space from the category's prompts (run there, on the owner's plan — no API credit), and «هات النتائج» brings
  // what it made back into the slots: the flow's three shots are «في النص», «البيئة» and «التفاصيل» (slots 1, 2 and 4), its size
  // drawing the fifth. The copy of the flow for this page is state.mflow (state.flow = 2 stays this batch's own marker).
  const MG = { of: null, shares: undefined, cats: undefined, busy: '' };
  const mgShares = () => { const I = IM(); if (!I || !S.id || (MG.of === S.id && MG.shares !== undefined)) return; MG.of = S.id; MG.shares = null; I.shares(S.id).then((r) => { if (MG.of !== S.id) return; MG.shares = r.ok ? r : null; R(); }); };
  const mgCats = () => { const I = IM(); if (!I || MG.cats !== undefined) return; MG.cats = null; I.shotCategories().then((r) => { MG.cats = r.ok ? r.rows : []; R(); }); };
  const mgWhy = (r) => (r.reason === 'not_linked' ? ((IM().why && IM().why(r)) || 'حساب Magnific مش مربوط بالسيستم') : r.reason === 'forbidden' ? 'مش مسموحلك' : r.reason === 'missing' ? 'الدفعة مش موجودة' : r.reason === 'busy' ? 'Magnific مشغول دلوقتي — جرّب كمان دقيقة'
    : r.reason === 'nothing_sent' ? 'ابعت الصور لـ Magnific الأول — الفلو بياخد الصور اللي اتبعتت' : r.reason === 'ai_error' ? 'النتائج موجودة بس ماقدرناش ننزّلها — جرّب تاني' : 'في مشكلة في الاتصال — جرّب تاني');
  async function mgSend() {
    const I = IM(); if (!I || !S.id || MG.busy) return;
    await touch(true); MG.busy = 'send'; R();
    let r = await I.bridgeUpload(S.id); let queued = false;
    if (!r.ok && (r.reason === 'not_linked' || r.reason === 'not_configured')) { r = await I.share(S.id); queued = true; }
    MG.busy = '';
    if (!r.ok) { K.toast(mgWhy(r), 'error'); R(); return; }
    const n = queued ? r.shared : r.uploaded;
    K.toast(queued ? (n ? 'اتحضّرت ' + n + ' صورة — حساب Magnific مش مربوط، فهتستنى لحد ما الأدمن يربطه من «الإعدادات › الربط بالمنصات»' : 'مفيش صور جديدة تتبعت — كل الصور اتبعتت قبل كده أو المنتج من غير صورة')
      : n ? 'اترفعت ' + n + ' صورة على مشروع «ابتكر» في Magnific' + (r.failed ? ' · ' + r.failed + ' فشلت' : '') : r.failed ? 'مفيش صورة اترفعت — ' + r.failed + ' فشلت، جرّب تاني' : 'مفيش صور جديدة تتبعت — كل الصور اتبعتت قبل كده أو المنتج من غير صورة', n ? 'success' : r.failed ? 'error' : 'warning');
    MG.of = null; MG.shares = undefined; R();
  }
  function mgNewCat() {
    K.form({ title: 'فئة منتجات جديدة', submitLabel: 'اختار الفئة', values: { catName: '' },
      fields: (f, e, set) => [K.field.text('catName', 'اسم الفئة', f, e, set, { required: true, placeholder: 'مثال: مزهرية', help: 'لو مالهاش برومبتات في المكتبة، الـ AI بيكتب برومبتات لقطاتها وقت «جهّز فلو» وبيحفظهم للدفعات الجاية.' })],
      validate: (f) => { const e = {}; const v = String(f.catName || '').trim(); if (v.length < 2 || v.length > 80 || /[<>%]/.test(v)) e.catName = 'اكتب اسم الفئة (من حرفين لـ 80، من غير < > %)'; return e; },
      submit: (f) => { st().mcat = String(f.catName).trim(); touch(); R(); } });
  }
  async function mgFlow() {
    const I = IM(); const s = st(); if (!I || !S.id || MG.busy) return;
    const category = String(s.mcat || '').trim();
    if (!category) { K.toast('اختار فئة المنتجات الأول — برومبتات الفلو بتيجي منها', 'warning'); return; }
    await touch(true);
    if (!(MG.cats || []).some((x) => x.category === category)) { // no prompts for it yet: the AI writes them into the library first
      const A = AI(); MG.busy = 'prompts'; R();
      const p = A && A.shotPrompts ? await A.shotPrompts(category) : { ok: false, reason: 'forbidden' };
      if ((!p.ok && p.reason !== 'exists') || (p.ok && (p.result !== 'ok' || p.rows < 3))) { MG.busy = ''; K.toast(p.ok ? 'الـ AI ماكتبش برومبتات الفئة دي — جرّب تاني أو غيّر الاسم' : p.reason === 'invalid' ? 'اسم الفئة مش صالح' : why(p.reason), 'error'); R(); return; }
      MG.cats = undefined;
    }
    MG.busy = 'flow'; R();
    const r = await I.bridgeFlow(S.id, category);
    MG.busy = '';
    if (!r.ok) { K.toast(mgWhy(r), 'error'); R(); return; }
    const row = await ST().open(S.id); const mf = row && row.state && row.state.mflow;
    st().mflow = mf && typeof mf === 'object' ? mf : { url: r.url || null, category: r.category, order: [] };
    touch(); R();
    K.toast('اتعمل فلو «' + r.category + '» بـ ' + r.photos + ' صورة' + (r.prompts ? ' وبرومبتات الفئة' : ' بالبرومبتات العامة') + ' — افتح الـ Space ودوس Run', 'success');
  }
  // the results the server put on the products (items[i].slots — the old wizard's slots) into this flow's shots
  function mgPlace(items) {
    const s = st(); const us = units(); const to = [0, 1, 3]; let n = 0;
    const has = new Set(Object.values(s.shots || {}).flat().concat(Object.values(s.sizeShot || {})).filter(Boolean));
    (Array.isArray(items) ? items : []).forEach((it, gi) => {
      const u = us.find((x) => x.gi === gi); if (!u || !it || !Array.isArray(it.slots)) return;
      const sh = shotsOf(u);
      it.slots.forEach((p, k) => {
        if (typeof p !== 'string' || !p || has.has(p)) return;
        if (k === 3) { if (!s.sizeShot[groupKey(gi)]) { s.sizeShot[groupKey(gi)] = p; has.add(p); n += 1; } return; }
        let t = k < 3 ? to[k] : -1; if (t < 0 || sh[t]) t = [0, 1, 2, 3].find((x) => !sh[x]);
        if (t != null && t >= 0 && !sh[t]) { sh[t] = p; has.add(p); n += 1; }
      });
    });
    return n;
  }
  async function mgFetch() {
    const I = IM(); if (!I || !S.id || MG.busy) return;
    await touch(true); MG.busy = 'fetch'; R();
    const r = await I.bridgeFetch(S.id);
    MG.busy = '';
    if (!r.ok) { K.toast(mgWhy(r), 'error'); R(); return; }
    let put = 0;
    if (r.placed) { const row = await ST().open(S.id); if (row && row.state) { put = mgPlace(row.state.items); if (put) touch(); } }
    K.toast(put ? 'نزلت ' + put + ' صورة من Magnific في خانات المنتجات' + (r.unmatched ? ' · ' + r.unmatched + ' مش معروف منتجها' : '') + (r.failed ? ' · ' + r.failed + ' فشلت' : '')
      : r.found ? 'لقينا ' + r.found + ' صورة بس خاناتها مليانة أو مش معروف منتجها' : 'مفيش نتائج جديدة على Magnific لسه — شغّل الفلو (Run) على الـ Space الأول', put ? 'success' : 'warning');
    R();
  }
  const mgOn = (tool) => !window.IBSettings || !window.IBSettings.magnificOn || window.IBSettings.magnificOn(tool); // 0123: the bridge's buttons only while Magnific is the image provider
  function magnificBar() {
    const I = IM(); const s = st(); if (!I || !S.id || !s || s.case === 'photos' || !mgOn('studio')) return null;
    mgShares(); const sh = MG.shares; const sent = sh ? sh.sent : 0; const mf = s.mflow && typeof s.mflow === 'object' ? s.mflow : null;
    const state = sh && sh.rows.length ? sh.sent + ' صورة مبعوتة' + (sh.pending ? ' · ' + sh.pending + ' مستنية الربط' : '') + (sh.failed ? ' · ' + sh.failed + ' فشلت' : '') : '';
    const send = Button({ size: 'sm', icon: 'upload', label: MG.busy === 'send' ? 'بنبعت…' : 'ابعت لـ Magnific', disabled: !!MG.busy || !rows().some((r) => r.ref), attrs: { 'data-mg-send': '' }, onClick: mgSend });
    const head = h('div', { class: 'fl-mg-h' }, Icon('sparkle', 'sm'), h('b', null, 'Magnific'), h('small', { class: 'help' }, 'ولّد على موقع Magnific بباقتك — من غير كريدت الـ API: ابعت صور المنتجات، جهّز الفلو وشغّله هناك، وهات النتائج في الخانات.'));
    if (!sent) return h('div', { class: 'fl-mg', 'data-fl-magnific': 'new' }, head, h('div', { class: 'acts-inline start' }, send, state ? h('span', { class: 't-small help', 'data-mg-state': '' }, state) : null));
    mgCats(); const cats = MG.cats || [];
    const opts = cats.map((x) => ({ value: x.category, label: x.category + (x.shots < 3 ? ' (' + x.shots + ' لقطات)' : '') }));
    if (s.mcat && !cats.some((x) => x.category === s.mcat)) opts.unshift({ value: s.mcat, label: s.mcat + ' (جديدة — البرومبتات بالـ AI)' });
    opts.push({ value: '__new__', label: '+ فئة جديدة…' });
    return h('div', { class: 'fl-mg', 'data-fl-magnific': mf ? 'flow' : 'sent' }, head, h('div', { class: 'acts-inline start' }, send,
      U.Select({ id: 'fl-mg-cat', label: null, placeholder: 'فئة المنتجات', options: opts, value: s.mcat || '', onChange: (v) => { if (v === '__new__') { mgNewCat(); return; } s.mcat = v; touch(); R(); } }),
      Button({ size: 'sm', icon: 'sparkle', label: MG.busy === 'prompts' ? 'بنكتب البرومبتات…' : MG.busy === 'flow' ? 'بنجهّز…' : mf ? 'جهّز فلو جديد' : 'جهّز فلو على Magnific', disabled: !!MG.busy, attrs: { 'data-mg-flow': '' }, onClick: mgFlow }),
      mf && typeof mf.url === 'string' && /^https:\/\//.test(mf.url) ? h('a', { class: 'btn btn-default sm', href: mf.url, target: '_blank', rel: 'noopener', 'data-mg-open': '' }, 'افتح الـ Space ↗') : null,
      Button({ size: 'sm', icon: 'download', label: MG.busy === 'fetch' ? 'بنجيب…' : 'هات النتائج من Magnific', disabled: !!MG.busy, attrs: { 'data-mg-fetch': '' }, onClick: mgFetch }),
      h('span', { class: 't-small help', 'data-mg-state': '' }, state + (mf ? ' · فلو «' + (mf.category || '') + '»' : ''))));
  }
  function step5() {
    const s = st(); const us = units();
    const features = Card('صورة المميزات', 'صورة واحدة للدفعة كلها — بتتحط في آخر صور كل المنتجات.', [h('div', { class: 'fl-feat' }, Thumb(s.features, 'st-big'),
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', icon: 'upload', label: s.features ? 'بدّل' : 'ارفع صورة المميزات', attrs: { 'data-flow-features': '' }, onClick: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'features', { webp: true }); if (r.ok) { s.features = r.path; touch(); R(); } }) }),
        s.features ? U.IconButton({ icon: 'trash', label: 'حذف صورة المميزات', onClick: () => { s.features = null; touch(); R(); } }) : null))]);
    // the owner 15 Nov («الصور تبقا اليند جمب بعض و يبقا كارت المنتج شكلو منظم»): a head with the product (its photo, the Arabic name,
    // the SKU, the price) and under it the four shots + the size drawing side by side, all the same size, the labels on one line
    const list = us.map((u) => { const r = unitRow(u); const meta = [r.colorAr || r.colorEn, arSize(r)].filter(Boolean).join(' · ');
      const sizeCell = sizeUnit(u) && hasSize(u.gi) ? slot(u, 4) : h('div', { class: 'fl-sna' }, h('small', { class: 'fl-slab' }, 'صورة المقاس'),
        h('span', { class: 'thumb fl-shot na fl-nosize' }, sizeUnit(u) ? 'من غير مقاس' : 'رسم المقاس مع أول لون'));
      return h('div', { class: 'fl-unit fl-ucard', 'data-unit': u.key },
        h('div', { class: 'fl-uhead' }, h('div', { class: 'fl-ucb' }, selBox(u.key, r.nameAr || r.nameEn || r.sku)), Thumb(r.ref, 'fl-pthumb'),
          h('div', { class: 'fl-info' }, h('b', null, r.nameAr || r.nameEn || '—'), h('small', { class: 'num' }, h('bdi', { dir: 'ltr' }, FD.imageSku(r.sku, r.size) || r.sku || '')), meta ? h('small', null, meta) : null),
          h('div', { class: 'fl-uprice' }, h('b', { class: 'brand-t' }, money(r.sale)), r.regular ? h('s', { class: 'help' }, money(r.regular)) : null, h('small', { class: 'help' }, 'نسبة إبتكر ', (() => { const c = commOf(r); return c == null ? '—' : U.num(c.rate + '%'); })())),
          h('div', { class: 'fl-umenu' }, K.RowMenu([{ label: 'ولّد الناقص للمنتج ده', icon: 'sparkle', run: () => genMissing([u]) }, { label: 'امسح صوره', icon: 'trash', danger: true, run: () => { s.shots[u.key] = [null, null, null, null]; touch(); R(); } }], 'إجراءات ' + (r.sku || '')))),
        h('div', { class: 'fl-shots' }, [0, 1, 2, 3].map((k) => slot(u, k)), sizeCell));
    });
    const sel = us.filter((u) => S.sel.has(u.key));
    return [features, Card('صور المنتجات', us.length + ' ' + (isVar() ? 'لون' : 'منتج') + ' · 1 في النص · 2 و3 البيئة · 4 التفاصيل (4 أجزاء) · المقاس رسم بالـ AI. اسحب الصورة على خانة تانية تبدّلهم.', [magnificBar(), BulkBar([Button({ size: 'sm', icon: 'sparkle', label: 'ولّد الناقص للمحدد', disabled: !!S.busy, onClick: () => genMissing(sel) })]), h('div', { class: 'fl-units' }, list)],
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
  // copy: 'maker' = the maker's short copy (comments decision 36), else the system's whole template
  async function sheetFile(rowsOut, type, prog, copy) {
    const sh = copy === 'maker' ? FD.makerSheetOf({ rows: rowsOut }) : FD.sheetOf({ type, rows: rowsOut }); const images = [];
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
    const m = U.Modal({ title: 'معاينة الشيت — ' + L.length + ' صف', body: [h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table fl-preview' }, h('thead', null, h('tr', null, sh.head.map((x) => h('th', null, x)))),
      h('tbody', null, sh.rows.slice(0, 200).map((r, i) => h('tr', null, r.map((c, k) => h('td', null, k === sh.refCol ? Thumb(L[i].ref, 'fl-pthumb') : typeof c === 'object' && c ? '=' + c.f : String(c == null ? '' : c)))))))),
    L.length > 200 ? U.InlineNote({ children: 'أول 200 صف بس في المعاينة.' }) : null].filter(Boolean) }); // a null child would print «null»
    m.el.classList.add('wide', 'fl-big'); // the owner 15 Nov: the previews bigger

  }
  // the owner 15 Nov («خلي بوباب معاينة الصور اكبر شوية عشان يبين الصور بوضوح»): a wide popup, each product with its five pictures in a row
  function previewImages() {
    const s = st(); const us = units();
    const m = U.Modal({ title: 'معاينة الصور — ' + us.length + ' ' + (isVar() ? 'لون' : 'منتج'), body: [
      s.features ? h('div', { class: 'fl-pv-feat' }, h('small', { class: 'fl-slab' }, 'صورة المميزات — في آخر صور كل منتج'), Thumb(s.features, 'fl-shot')) : null,
      h('div', { class: 'fl-pv' }, us.map((u) => { const r = unitRow(u);
        const pics = shotsOf(u).map((p, k) => [SHOT_L[k], p]).concat(sizeUnit(u) && hasSize(u.gi) ? [['صورة المقاس', s.sizeShot[groupKey(u.gi)]]] : []);
        return h('div', { class: 'fl-pv-unit', 'data-pv-unit': u.key }, h('div', { class: 'fl-pv-head' }, Thumb(r.ref, 'fl-pthumb'),
          h('div', { class: 'fl-info' }, h('b', null, r.nameAr || r.nameEn || '—'), h('small', { class: 'num' }, h('bdi', { dir: 'ltr' }, FD.imageSku(r.sku, r.size) || r.sku || '')))),
          h('div', { class: 'fl-pv-shots' }, pics.map(([label, p]) => h('figure', { class: 'fl-pv-shot' }, Thumb(p, 'fl-shot'), h('figcaption', { class: 'fl-slab' }, label))))); }))].filter(Boolean) });
    m.el.classList.add('wide', 'fl-big');
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
    const card = Card('صور المنتجات', n ? n + ' منتج' : 'صورة لكل منتج بالترتيب', [h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: n ? 'زوّد صور' : 'ارفع الصور', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) }),
        n ? Button({ type: 'text', icon: 'trash', label: 'مسح الكل', disabled: S.busy === 'photos', attrs: { 'data-flow-photos-clear': '' }, onClick: () => clearPhotos() }) : null),
      U.InlineNote({ children: 'كل صورة بتبقى منتج بالترتيب. ولو أكتر من صورة لنفس المنتج سمّيها «1-1»، «1-2» (و«2-1»، «2-2»…). أول صورة للمنتج هي اللي بتتحط في الشيت.' }),
      n ? h('div', { class: 'fl-grid fl-pair-list' }, s.products.map((p) => h('div', { class: 'fl-pcard' }, Thumb(p.ref, 'st-big'), h('b', null, 'منتج ' + p.n), h('small', { class: 'help' }, p.photos.length + ' صورة'))))
        : h('div', { class: 'fl-pair-list' }, h('div', { class: 'fl-list-empty' }, Icon('image', 'sm'), h('span', null, 'اسحب الصور وسيبها هنا — كل صورة منتج بالترتيب')))]);
    dropZone(card, isImage, takePhotos, () => S.busy === 'photos', 'اسحب صور بس (JPG أو PNG أو WebP)');
    return [card, Foot(n > 0, 'ارفع الصور')];
  }
  // the template's rows with what was filled: the names / description / category of the product (s.fill[product], the AI's or typed),
  // its color by color slot (slot 1 = the AI's color unless picked), its size by size slot and the maker's price by row (the owner
  // 15 Nov: «خلي في امكانية للمستخدم بتعديل البيانات … المقاس … اللون … القسم و السعر و الحفظ قبل التنزيل») — empty = for the maker
  const fillOf = (i) => { const s = st(); s.fill = s.fill || {}; return (s.fill[i] = s.fill[i] || {}); };
  const colorOfSlot = (x, slot) => { const c = (x.colors || {})[slot]; return c ? c : slot > 1 ? ['', ''] : [x.colorEn || '', x.colorAr || '']; };
  const sizePair = (t) => { const v = String(t || '').trim(); if (!v) return ['', '']; const ar = /[\u0600-\u06FF]/.test(v); return [FD.sizeEnOf(v) || (ar ? '' : v), ar ? v : arSize({ size: v })]; };
  function blankRowsOf() {
    const s = st(); const L = FD.blankSheetRows({ type: s.type, products: (s.products || []).length, kinds: s.kinds });
    return L.map((r) => { const p = s.products[r.product]; const k = r.variant ? (p.n + '-' + r.variant) : String(p.n); const x = (s.fill && s.fill[r.product]) || {};
      const [colorEn, colorAr] = colorOfSlot(x, r.colorSlot || 0); const [size, sizeAr] = sizePair((x.sizes || {})[r.sizeSlot || 0]);
      const pr = Number((x.prices || {})[r.variant || 0]);
      return Object.assign(r, { n: k, ref: rowRef(r), brand: s.brandName, nameEn: x.nameEn || '', nameAr: x.nameAr || '', catEn: x.catEn || '', shortEn: x.shortEn || '', shortAr: x.shortAr || '', colorEn, colorAr, size, sizeAr,
        vendorPrice: Number.isFinite(pr) && pr > 0 ? pr : null, images: [] }); });
  }
  // the owner 15 Nov («في حالة إضافة شيت لما اعمل ملأ بالذكاء الاصطناعي ياريت في المقاسات يكتب مقاس ١ مقاس ٢ و في الالوان يختار بناء علي
  // الصورة المرفوعة»): the names / description / category / first color from each product's photo; then every color slot with a photo of
  // its own (its n-th photo or one swapped in) read from that picture; the size slots labelled «مقاس 1», «مقاس 2» … — the empty only
  const colorPair = (code) => { const c = code ? colors().find((x) => x.code === code) : null; return c ? [c.name_en, c.name_ar || ''] : null; };
  function setSlotColor(x, slot, pair, ai) { if (slot > 1) x.colors = Object.assign({}, x.colors, { [slot]: pair }); else { x.colorEn = pair[0]; x.colorAr = pair[1]; } x.aiColors = Object.assign({}, x.aiColors, { [slot || 0]: !!ai }); }
  async function aiFillProducts(notes) {
    const s = st(); await touch(true); S.busy = 'ai'; R(); s.fill = s.fill || {}; let stop = '';
    for (let i = 0; i < s.products.length && !stop; i++) {
      if (s.fill[i] && s.fill[i].nameEn) continue;
      const r = await AI().studio(S.id, i, ['nameEn', 'nameAr', 'desc', 'category', 'variations'], notes);
      if (!r.ok) { stop = why(r.reason); break; }
      const f = r.fields || {}; const c = (f.colors || [])[0] ? colors().find((x) => x.code === f.colors[0]) : null;
      const slot1Own = colorUnits().some((cu) => cu.product === i && cu.slot === 1);
      // the AI fills what is empty only — a size, a price, a color or a category the member set stays
      const add = { nameEn: f.nameEn || '', nameAr: f.nameAr || '', shortEn: f.shortDesc || '', shortAr: f.shortDescAr || '', catEn: (f.categories || [])[0] ? pathOfId(f.categories[0]) : '', colorEn: c ? c.name_en : '', colorAr: c ? c.name_ar : '' };
      if (slot1Own) { delete add.colorEn; delete add.colorAr; } // slot 1 has its own picture — read below
      const cur = s.fill[i] || {}; const hadColor = !!cur.colorEn; Object.keys(add).forEach((k) => { if (!cur[k] && add[k]) cur[k] = add[k]; }); s.fill[i] = cur;
      if (!hadColor && cur.colorEn && add.colorEn) cur.aiColors = Object.assign({}, cur.aiColors, { [s.type === 'Variable' && s.kinds && s.kinds.colors > 0 ? 1 : 0]: true });
      touch(); R();
    }
    for (const cu of stop ? [] : colorUnits()) {
      const x = fillOf(cu.product); if (colorOfSlot(x, cu.slot)[0]) continue;
      const r = await AI().studio(S.id, cu.index, ['variations'], notes);
      if (!r.ok) { stop = why(r.reason); break; }
      const pair = colorPair(((r.fields || {}).colors || [])[0]); if (pair) { setSlotColor(x, cu.slot, pair, true); touch(); R(); }
    }
    const sizes = s.type === 'Variable' && s.kinds ? Number(s.kinds.sizes) || 0 : 0;
    if (!stop && sizes) (s.products || []).forEach((_, i) => { const x = fillOf(i); for (let k = 1; k <= sizes; k++) if (!(x.sizes || {})[k]) x.sizes = Object.assign({}, x.sizes, { [k]: 'مقاس ' + k }); });
    touch(); S.busy = ''; R();
    K.toast(stop || 'الـ AI ملا الأسماء والأقسام والألوان من الصور' + (sizes ? ' والمقاسات «مقاس 1» … — المبتكر بيكتب المقاس الفعلي' : '') + '، وسعر المبتكر للمبتكر', stop ? 'error' : 'success');
  }
  // the owner 15 Nov («خلي فيه إمكانية اني ابدل الصور جوة الشيت»): a row's picture swapped for another — into the batch, kept for that row;
  // its color slot's color, when the AI had picked it, is cleared so the next «املأ بالـ AI» reads it from the new picture
  async function swapRowPhoto(r, file) {
    if (!file) return; S.busy = 'photo:' + r.n; R();
    const up = await ST().uploadImage(S.id, file, 'r' + r.product + '-' + (r.variant || 0), { webp: true });
    S.busy = '';
    if (!up.ok) { R(); K.toast(up.reason === 'not_image' ? 'الصيغة مش مدعومة في المتصفح — حوّلها JPG أو PNG' : 'ماترفعتش — جرّب تاني', 'error'); return; }
    const x = fillOf(r.product); x.rowPhotos = Object.assign({}, x.rowPhotos, { [rowPhotoKey(r)]: up.path });
    const slot = r.colorSlot || 0; if ((x.aiColors || {})[slot]) { setSlotColor(x, slot, ['', ''], false); }
    await touch(true); R(); K.toast('اتبدلت صورة ' + r.n, 'success');
  }
  // the two copies of the sheet (comments decision 36 — «بوب اب تتقسم اتنين»)
  const COPIES = { maker: 'نسخة المبتكر', system: 'نسخة السيستم' };
  const copyName = (copy) => FD.sheetFileName(st().vendorName || st().brandName, null, COPIES[copy] || '');
  // «تحميل على الجهاز»: the maker's copy — the reference photo, the two names, the colour, the size and his price — or the
  // system's — the whole template. The step's edits are saved first, then the chosen file comes down.
  function downloadPopup() {
    let m = null; let busy = '';
    const take = async (copy) => {
      if (busy) return; busy = copy; draw();
      try {
        await saveSheet(true); const s = st(); const blob = await sheetFile(blankRowsOf(), s.type, null, copy); const name = copyName(copy);
        await K.saveFile(name, blob); window.__lastSheet = { copy, name, size: blob.size };
        K.toast('الملف اتنزل على جهازك: ' + name, 'success'); m.close();
      } catch (e) { busy = ''; draw(); K.toast('الملف ما اتجهّزش — جرّب تاني', 'error'); }
    };
    const card = (copy, icon, sub, items, primary) => h('div', { class: 'fl-copy', 'data-fl-copy': copy },
      h('div', { class: 'fl-copy-h' }, Icon(icon, 'md'), h('b', null, COPIES[copy])),
      h('p', { class: 't-small' }, sub),
      h('ul', { class: 'fl-copy-list' }, items.map((x) => h('li', null, x))),
      Button({ type: primary ? 'primary' : 'default', icon: 'download', label: busy === copy ? 'بنجهّز الملف…' : 'تحميل ' + COPIES[copy], disabled: !!busy, attrs: { 'data-fl-copy-go': copy }, onClick: () => take(copy) }));
    function draw() {
      const body = h('div', { class: 'fl-copies' },
        card('maker', 'users', 'شيت بسيط تبعته للمبتكر يملاه ويرجّعه.', ['الصورة المرجعية', 'الاسم بالإنجليزي والعربي', 'اللون', 'المقاس', 'سعر المبتكر'], true),
        card('system', 'sheet', 'القالب كامل بكل خاناته — نسخة الشغل بتاعة إبتكر.', ['كل خانات نسخة المبتكر', 'الـ SKU والبراند والقسم', 'الوصف والخامة والستايل والوزن', 'الأسعار ولينكات الصور']));
      if (!m) { m = U.Modal({ title: 'تحميل الشيت على الجهاز', body, footer: [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })] }); m.el.classList.add('wide'); m.el.dataset.flDownload = ''; }
      else m.setBody(body);
    }
    draw();
  }
  // a row's reference photo as a data: URL for the share popup's file (the studio's photos are not the site's — IBShare takes them ready)
  const refData = new Map();
  async function refDataUrl(path) {
    if (!path) return ''; if (refData.has(path)) return refData.get(path);
    const b = await thumbBytes(path); let u = '';
    if (b) { let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); u = 'data:image/jpeg;base64,' + btoa(bin); }
    refData.set(path, u); return u;
  }
  // «مشاركة» (comments decision 37 — «نفس الفكرة … في كل حتة»): the system's one share popup — the file's kind (Excel / PDF) and
  // the way (WhatsApp / e-mail / download). What goes out is the maker's copy: the Excel is the same file «نسخة المبتكر» downloads.
  async function shareSheet() {
    if (!window.IBShare) { downloadPopup(); return; }
    await saveSheet(true); const s = st(); const L = blankRowsOf(); const mk = V() && V().store && V().store.get && s.vendorId ? V().store.get(s.vendorId) : null;
    const sh = FD.makerSheetOf({ rows: L }); const photos = [];
    for (let i = 0; i < L.length; i++) photos.push(await refDataUrl(L[i].ref));
    const who = s.vendorName || s.brandName || '';
    window.IBShare.open({ title: 'شيت المنتجات' + (who ? ' — ' + who : ''), sub: L.length + ' صف · ' + s.products.length + ' منتج', name: copyName('maker').replace(/\.xlsx$/, ''),
      phone: mk && mk.phone ? mk.phone : '', email: mk && mk.email ? mk.email : '', text: 'شيت المنتجات من إبتكر — املا سعر المبتكر والمقاس وابعته تاني.',
      headers: sh.head.filter((_, k) => k !== sh.refCol), rows: sh.rows.map((r, i) => r.filter((_, k) => k !== sh.refCol).map((c, k) => (k === 0 ? { text: String(c), img: photos[i] } : c))),
      note: 'اللي فاضي املاه وابعت الشيت تاني.', excel: () => sheetFile(L, s.type, null, 'maker') });
  }
  // ش38 (the owner 17 Nov — «خلي كتابة سعر المبتكر سهلة و دايما الحساب الجنية المصري و شيل الاسهم»): a price is typed as text — no
  // browser arrows — with «ج.م» written beside it; Arabic / Persian digits, the Arabic decimal mark, thousands commas and a «ج.م» typed in
  // are all read as the one number (FD.money)
  const moneyBox = (el) => h('span', { class: 'fl-money' }, el, h('span', { class: 'fl-cur', 'aria-hidden': 'true' }, 'ج.م'));
  // one cell's control: a text / number box (kept as typed; the rows sharing it redraw when it is left) or a dropdown
  function sheetInput(r, key, val, set, o) {
    const x = o || {};
    const el = h('input', { class: 'input sm', type: 'text', inputmode: x.num ? 'decimal' : false, dir: x.dir || 'auto', value: val == null ? '' : String(val), placeholder: x.ph || '',
      'aria-label': x.label + ' — ' + r.n, 'data-sh': key + ':' + r.n, autocomplete: 'off' });
    el.addEventListener('input', () => { set(el.value); touch(); });
    el.addEventListener('change', () => R());
    return x.num ? moneyBox(el) : el;
  }
  function sheetColor(r) {
    const x = fillOf(r.product); const slot = r.colorSlot || 0; const cur = colorOfSlot(x, slot)[0];
    const list = colors(); const known = list.some((c) => c.name_en === cur);
    const options = [{ value: '', label: '— من غير —' }].concat(list.map((c) => ({ value: c.name_en, label: (c.name_ar || c.name_en) + ' — ' + c.name_en })), cur && !known ? [{ value: cur, label: cur }] : []);
    return named('اللون — ' + r.n, h('div', { class: 'fl-sh-sel', 'data-sh': 'color:' + r.n }, U.Select({ id: 'fl-sh-color-' + r.n, label: '', options, value: cur, placeholder: 'اختار اللون',
      onChange: (v) => { const c = list.find((y) => y.name_en === v); const pair = v ? [v, c ? c.name_ar || '' : ''] : ['', ''];
        setSlotColor(x, slot, pair, false); if (slot <= 1 && x.colors) delete x.colors[slot];
        touch(); R(); } })));
  }
  const named = (label, el) => { const b = el.querySelector('button.select'); if (b) b.setAttribute('aria-label', label); return el; };
  function sheetCat(r) {
    const x = fillOf(r.product); const list = cats(); const now = catIdOf(x.catEn);
    if (!list.length) return sheetInput(r, 'cat', x.catEn, (v) => { x.catEn = v.trim(); }, { label: 'القسم', dir: 'ltr' });
    const options = [{ value: '', label: '— من غير —' }].concat(list.map((c) => ({ value: String(c.id), label: c.path }))).concat(now == null && x.catEn ? [{ value: '__cur', label: x.catEn + ' (مش على الموقع)' }] : []);
    if (window.IBCatField) return h('div', { class: 'fl-sh-sel fl-sh-cat', 'data-sh': 'cat:' + r.n }, window.IBCatField({ id: 'fl-sh-cat-' + r.n, single: true, compact: true, ids: now != null ? [now] : [], title: 'القسم — ' + r.n,
      placeholder: now == null && x.catEn ? x.catEn + ' (مش على الموقع)' : 'اختار القسم', onPick: (ids) => { x.catEn = ids.length ? pathOfId(String(ids[0])) : ''; touch(); R(); }, onClear: x.catEn ? () => { x.catEn = ''; touch(); R(); } : null }));
    return named('القسم — ' + r.n, h('div', { class: 'fl-sh-sel fl-sh-cat', 'data-sh': 'cat:' + r.n }, U.Select({ id: 'fl-sh-cat-' + r.n, label: '', options, value: now != null ? String(now) : x.catEn ? '__cur' : '', placeholder: 'اختار القسم',
      onChange: (v) => { if (v === '__cur') return; x.catEn = v ? pathOfId(v) : ''; touch(); R(); } })));
  }
  async function saveSheet(quiet) { const r = await touch(true); if (!quiet) K.toast(r && r.ok === false ? (r.message || 'ماتحفظش — جرّب تاني') : 'اتحفظت كمسودة — تكمّلها في أي وقت من «الشغل المحفوظ»', r && r.ok === false ? 'error' : 'success'); return !(r && r.ok === false); }
  function stepSheet() {
    const L = blankRowsOf(); const s = st();
    const shareBtn = Button({ size: 'sm', icon: 'share', label: 'مشاركة', attrs: { 'data-flow-share': '' }, onClick: () => shareSheet() });
    return [Card('الشيت', L.length + ' صف · ' + s.products.length + ' منتج — «تحميل على الجهاز» فيه نسخة بسيطة للمبتكر ونسخة السيستم الكاملة، وصورة كل منتج جوه خليتها.', [
      h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'ai' ? 'بيكتب…' : 'املأ بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-ai': '' }, onClick: async () => { const a = await window.IBAIAsk({ title: 'املأ الشيت بالـ AI — ' + (st().products || []).length + ' منتج', intro: 'الأسماء والوصف والقسم واللون من الصور.' }); if (a) aiFillProducts(a.notes); } }),
        Button({ size: 'sm', icon: 'check', label: 'حفظ كمسودة', attrs: { 'data-flow-save': '' }, onClick: () => saveSheet(false) }),
        Button({ size: 'sm', label: 'معاينة', onClick: async () => { await saveSheet(true); previewSheet(blankRowsOf(), s.type); } }),
        Button({ size: 'sm', icon: 'download', label: 'تحميل على الجهاز', attrs: { 'data-flow-download': '', 'aria-haspopup': 'dialog' }, onClick: () => downloadPopup() }), shareBtn),
      U.InlineNote({ children: 'تقدر تعدّل أي خانة هنا — الاسم واللون والمقاس وسعر المبتكر والقسم — وبتتحفظ مع الدفعة («حفظ كمسودة») وتنزل في الشيت. اللي يفضل فاضي المبتكر بيملاه في «نسخة المبتكر»، ولما يرجّعها ابدأ دفعة «شيت جاهز» بيها.' }),
      h('div', { class: 'fl-scroll' }, h('table', { class: 'fl-table fl-sheet-ed', 'data-flow-sheet': '' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'الصورة'), h('th', null, 'الاسم EN'), h('th', null, 'الاسم AR'), h('th', null, 'اللون'), h('th', null, 'المقاس'), h('th', null, 'سعر المبتكر'), h('th', null, 'القسم'))),
        h('tbody', null, L.map((r) => { const x = fillOf(r.product);
          const busyPhoto = S.busy === 'photo:' + r.n;
          return h('tr', { 'data-sh-row': r.n }, h('td', { class: 'num' }, r.n),
            h('td', null, h('button', { type: 'button', class: 'fl-sh-photo' + (busyPhoto ? ' is-busy' : ''), 'data-sh-photo': r.n, disabled: !!S.busy, title: 'بدّل الصورة', 'aria-label': 'بدّل صورة ' + r.n,
              onClick: () => filePick('image/*', false, (fs) => swapRowPhoto(r, fs[0])) }, Thumb(r.ref, 'st-sm'), h('span', { class: 'fl-sh-photo-i', 'aria-hidden': 'true' }, Icon(busyPhoto ? 'refresh' : 'upload', 'sm')))),
            h('td', null, sheetInput(r, 'nameEn', x.nameEn, (v) => { x.nameEn = v.trim(); }, { label: 'الاسم EN', dir: 'ltr' })),
            h('td', null, sheetInput(r, 'nameAr', x.nameAr, (v) => { x.nameAr = v.trim(); }, { label: 'الاسم AR', dir: 'rtl' })),
            h('td', null, sheetColor(r)),
            h('td', null, sheetInput(r, 'size', (x.sizes || {})[r.sizeSlot || 0], (v) => { x.sizes = Object.assign({}, x.sizes, { [r.sizeSlot || 0]: v.trim() }); }, { label: 'المقاس', ph: r.sizeSlot ? 'مقاس ' + r.sizeSlot + ' — مثلًا 40×60 سم' : 'مثلًا 40×60 سم' })),
            h('td', null, sheetInput(r, 'price', (x.prices || {})[r.variant || 0], (v) => { const n = FD.money(v); x.prices = Object.assign({}, x.prices, { [r.variant || 0]: n != null && n > 0 ? n : null }); }, { label: 'سعر المبتكر', num: true, dir: 'ltr', ph: '0' })),
            h('td', null, sheetCat(r))); }))))])];
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
    ST().ensure(); if (ST().loadStyles) ST().loadStyles(); // the shop's own styles (comments decision 51)
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
