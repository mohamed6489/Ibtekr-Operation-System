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
  // the size in Arabic for a display (the owner 15 Nov: the product's Arabic data): the Arabic one, else the English with its unit in Arabic
  const arSize = (r) => r.sizeAr || String(r.size || '').replace(/\bcm\b/gi, 'سم').replace(/\bmm\b/gi, 'مم').replace(/\bkg\b/gi, 'كجم');
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
  // the owner 15 Nov («بجرب ارفع الصور … مبتترفعش»): a maker's photos rarely carry the row number, and every one of them was dropped —
  // a photo without a number now takes the next free row (FD.placePhotos), and a photo that does not go up says why
  async function takePhotos(files) {
    const s = st(); s.photoRows = s.photoRows || {};
    const placed = FD.placePhotos(files.map((f) => f.name), Object.keys(s.photoRows));
    S.busy = 'photos'; R();
    let n = 0, loose = 0; const fail = { not_image: 0, network: 0 };
    for (const x of placed) {
      const r = await ST().uploadImage(S.id, files[x.i], 'p' + x.row + '-' + (x.order || 0), { webp: true });
      if (r.ok) { (s.photoRows[x.row] = s.photoRows[x.row] || []).push(r.path); n += 1; if (x.auto) loose += 1; }
      else fail[r.reason === 'not_image' ? 'not_image' : 'network'] += 1;
    }
    if (s.case === 'photos') s.products = Object.keys(s.photoRows).map(Number).sort((a, b) => a - b).map((k) => ({ n: k, ref: s.photoRows[k][0], photos: s.photoRows[k] }));
    else attachPhotos();
    S.busy = ''; touch(); R();
    if (n) K.toast('اترفعت ' + n + ' صورة' + (loose ? ' — ' + loose + ' من غير رقم في اسمها اتحطت بالترتيب (صورة لكل منتج)، راجعها' : ''), 'success');
    if (fail.not_image) K.toast(fail.not_image + ' صورة ماترفعتش: الصيغة مش مدعومة في المتصفح (زي HEIC من الآيفون) — حوّلها JPG أو PNG وارفعها تاني', 'error');
    if (fail.network) K.toast(fail.network + ' صورة ماترفعتش: النت أو السيرفر — جرّب تاني', 'error');
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
    const r = await AI().extract(blobs, s.type, Object.keys(s.photoRows || {}).length);
    S.busy = '';
    if (!r.ok) { K.toast(why(r.reason, r.field), 'error'); R(); return; }
    if (r.result === 'refused' || !r.rows.length) { K.toast('الـ AI مالقاش منتجات في السكرين شوتس', 'warning'); R(); return; }
    s.rows = r.rows.map((x) => Object.assign(FD.blankRow(), x, { key: newKey(), src: x.product, ai: { extract: true } }));
    s.screens = blobs.length; s.screensDirty = false; attachPhotos(); touch(); R();
    K.toast('الـ AI طلّع ' + r.rows.length + ' صف — راجعهم', 'success');
  }
  // a list in the order it is in, each row with the six dots (K.Grip / K.sortableRows) — the same row height on both sides, so a photo
  // sits beside its screenshot
  function sortList(attr, items, body, onOrder) {
    const wrap = h('div', { class: 'fl-sort', ['data-' + attr]: '' }, items.map((x, i) => h('div', { class: 'fl-sort-row', ['data-' + attr + '-row']: x.id }, K.Grip(x.label), h('b', { class: 'fl-sort-n num' }, String(i + 1)), body(x))));
    K.sortableRows(wrap, 'data-' + attr + '-row', onOrder);
    return wrap;
  }
  function photosList() {
    const s = st(); const byN = s.photoRows || {}; const keys = Object.keys(byN).map(Number).filter((k) => (byN[k] || []).length).sort((a, b) => a - b);
    if (!keys.length) return null;
    const nameOf = (k) => { const r = (s.rows || []).find((x) => (s.case === 'whatsapp' ? x.product : x.src) === k); return r ? (r.nameAr || r.nameEn || '') : ''; };
    return sortList('fl-photos', keys.map((k) => ({ id: String(k), label: 'صور المنتج ' + k, paths: byN[k] })), (x) => h('div', { class: 'fl-sort-body' },
      h('span', { class: 'fl-sort-thumbs' }, x.paths.slice(0, 3).map((p) => Thumb(p, 'st-sm')), x.paths.length > 3 ? h('span', { class: 't-small help' }, '+' + (x.paths.length - 3)) : null),
      h('span', { class: 't-small help fl-sort-name' }, nameOf(Number(x.id)))),
      (ids) => { const vals = ids.map((id) => byN[id]); const next = {}; keys.forEach((k, i) => { next[k] = vals[i]; }); s.photoRows = next; attachPhotos(); touch(); R(); });
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
    const photosBtn = Button({ label: photosN ? 'بدّل / زوّد الصور (' + photosN + ')' : 'ارفع الصور', icon: 'upload', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) });
    const nameHelp = U.InlineNote({ children: 'الصور بتتحط على الصفوف بالترتيب، صورة لكل صف. ولو عايز تحدد: سمّيها برقم الصف «1»، «2»… وأكتر من صورة لنفس المنتج «1-1»، «1-2». أول صورة هي المرجعية.' });
    if (s.case === 'photos') {
      const kind = (k, label) => U.Select({ id: 'fl-k-' + k, label, value: String(s.kinds[k] || 0), options: [0, 1, 2, 3, 4, 5].map((x) => ({ value: String(x), label: x ? x + ' ' + label : 'من غير' })), onChange: (v) => { s.kinds[k] = Number(v); touch(); R(); } });
      const ok = s.type === 'Simple' || s.kinds.sizes > 0 || s.kinds.colors > 0;
      return [Card('الشيت هيبقى عامل إزاي', 'النوع ' + s.type + (s.type === 'Variable' ? ' — المتغيرات لحد 5 من كل نوع، وكل واحد بسعره.' : ''), [
        s.type === 'Variable' ? h('div', { class: 'grid2' }, kind('sizes', 'مقاسات'), kind('colors', 'ألوان')) : U.InlineNote({ children: 'كل منتج صف واحد.' }),
        s.type === 'Variable' && !ok ? U.InlineNote({ kind: 'warning', children: 'اختار مقاسات أو ألوان (أو الاتنين).' }) : null]),
      Foot(ok, 'اختار المتغيرات')];
    }
    // the owner 15 Nov («خلي الصور والسكرين شوتس قد بعض … الصور بتتحط جوا نفس السكشن … تحت بعض … وأقدر أغيّر الترتيب بحيث كل صورة
    // أجيبها قدام الصورة بتاعتها»): each list inside its own card, the two cards side by side on one grid (title · buttons · list ·
    // notes as shared rows), so a photo sits in front of its screenshot (or of its sheet row); empty, the two lists are the same box
    const empty = (text) => h('div', { class: 'fl-list-empty' }, Icon('image', 'sm'), h('span', null, text));
    const noRef = s.rows.filter((r) => !r.ref).length;
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
    const pics = Card('الصور', photosN ? photosN + ' صورة' + (s.rows.length ? ' · ' + (s.rows.length - noRef) + ' صف ليه صورة' : '') : 'صور المنتجات بجودة عالية', [
      h('div', { class: 'fl-pair-acts' }, h('div', { class: 'acts-inline' }, photosBtn, S.busy === 'photos' ? h('span', { class: 't-small help' }, 'بنرفع…') : null),
        s.rows.length && noRef ? U.InlineNote({ kind: 'warning', children: noRef + ' صف من غير صورة مرجعية — الصور بتتولّد من المرجعية، فارفعها أو كمّل من غيرها.' }) : null),
      h('div', { class: 'fl-pair-list', 'data-fl-list': 'photos' }, photosList() || empty('اسحب الصور وسيبها هنا — وهتظهر بالترتيب')),
      h('div', { class: 'fl-pair-notes' }, nameHelp)]);
    if (s.case === 'whatsapp') dropZone(src, isImage, takeScreens, () => S.busy === 'extract' || (s.screenList || []).length >= 8, 'اسحب صور (السكرين شوتس) بس');
    else dropZone(src, isSheet, (f) => takeSheet(f[0]), () => false, 'الشيت لازم يكون xlsx أو csv');
    dropZone(pics, isImage, takePhotos, () => S.busy === 'photos', 'اسحب صور بس (JPG أو PNG أو WebP)');
    return [h('div', { class: 'fl-pair', 'data-fl-match': '' }, src, pics), Foot(s.rows.length > 0, s.case === 'whatsapp' ? 'اقرا السكرين شوتس الأول' : 'ارفع الشيت الأول')];
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
      mk ? h('div', { class: 'fl-maker-info', 'data-fl-maker-info': '' },
        h('div', { class: 'fl-mk-rate' }, h('span', { class: 't-small help' }, catRates.length ? 'نسبة إبتكر العامة' : 'نسبة إبتكر'), h('b', { class: 'num', 'data-fl-rate': '' }, r == null ? '—' : U.num(r + '%')),
          h('small', { class: 'help' }, feeNow() ? '+ ' + K.n0(feeNow()) + ' ج.م رسوم ثابتة' : 'من غير رسوم ثابتة')),
        h('div', { class: 'fl-mk-cats', 'data-fl-cat-rates': '' },
          h('span', { class: 't-small help' }, catRates.length ? 'أقسام ليها نسبة لوحدها' : r == null ? 'نسبة المبتكر مش ظاهرة لك' : 'نفس النسبة على كل الأقسام'),
          catRates.length ? h('div', { class: 'fl-mk-chips' }, catRates.slice(0, 8).map((c) => h('span', { class: 'fl-mk-chip', 'data-cat': c.wooCategoryId }, h('span', null, c.name), h('b', { class: 'num' }, U.num(c.rate + '%')))),
            catRates.length > 8 ? h('span', { class: 't-small help' }, '+' + U.num(catRates.length - 8)) : null) : null),
        canRate() ? h('div', { class: 'fl-mk-act' }, Button({ size: 'sm', icon: 'edit', label: 'تعديل النسبة', attrs: { 'data-fl-rate-edit': '' }, onClick: () => rateModal(mk) })) : null) : null,
      mk ? h('div', { class: 'grid2' }, U.FieldShell({ id: 'fl-code', label: 'كود البراند في الـ SKU (2–4 حروف)', help: 'مثال: glasstora → GLS — IBTGLS1020-OW' }, h('div', { class: 'input' }, h('input', { id: 'fl-code', dir: 'ltr', maxlength: 4, value: s.code || '', 'data-flow-code': '',
          onChange: (ev) => { s.code = String(ev.target.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); touch(); R(); } }))),
        h('div', { class: 'fl-sku-ex t-small help', 'data-fl-sku-ex': '' }, FD.validCode(s.code) ? 'الـ SKU هيبقى: ' : '', FD.validCode(s.code) ? h('b', { dir: 'ltr' }, 'IBT' + s.code + '1020-OW') : null)) : null,
      mk && !FD.validCode(s.code) ? U.InlineNote({ kind: 'warning', children: 'كود البراند لازم 2–4 حروف إنجليزي.' }) : null];
    const ok = !!mk && FD.validCode(s.code) && (s.case === 'photos' || mk.wooVendorId != null);
    return [Card('المبتكر', 'المنتجات بتترفع على متجر المبتكر، وبراندُه بيتكتب في الشيت وكوده في الـ SKU.', body), Foot(ok, !mk ? 'اختار المبتكر' : 'كود البراند')];
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
        if (f.kind === 'cat') out.push(K.field.select('flRateCat', 'القسم', sorted, f, e, (k, val, rd) => { f.flRate = effOf(val); set(k, val, rd); }, { required: true, placeholder: 'اختار القسم — اكتب أول حروف اسمه' }));
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
  function setBrand(b) { const s = st(); s.brandId = b.id; s.brandName = b.name; const c = String(b.code || '').toUpperCase(); s.code = FD.validCode(c) && c.length >= 3 ? c : FD.brandCode3(b.name); s.rows.forEach((r) => { if (!r.brand) r.brand = b.name; }); }


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
      const r = await AI().studio(S.id, gi, want, notes);
      if (!r.ok) { stop = why(r.reason); break; }
      const f = r.fields || {};
      const mat = FD.pairOf(FD.MATERIALS, f.material, f.materialAr); const sty = FD.pairOf(FD.STYLES, f.style, f.styleAr);
      g.rows.forEach((ri) => { const x = rows()[ri]; x.ai = Object.assign({}, x.ai);
        const fill = (k, v) => { if (v && !x[k]) { x[k] = v; x.ai[k] = true; } };
        const put = (k, v) => { if (v) { x[k] = v; x.ai[k] = true; } };
        if (rewrite) { put('nameEn', f.nameEn); put('nameAr', f.nameAr); put('shortEn', f.shortDesc); put('shortAr', f.shortDescAr); }
        fill('nameEn', f.nameEn); fill('nameAr', f.nameAr); fill('shortEn', f.shortDesc); fill('shortAr', f.shortDescAr);
        if (Array.isArray(f.categories) && f.categories.length && !catIdOf(x.catEn)) { x.catEn = pathOfId(f.categories[0]); x.ai.catEn = true; }
        fill('materialEn', mat ? mat[0] : f.material); fill('materialAr', mat ? mat[1] : f.materialAr);
        fill('styleEn', sty ? sty[0] : f.style); fill('styleAr', sty ? sty[1] : f.styleAr);
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
        catOpts.length > 1 ? K.field.select('cat', 'القسم', catOpts, f, e, set, { placeholder: 'اختار القسم — اكتب أول حروف اسمه' }) : null,
        brands.length > 1 ? K.field.select('brand', 'البراند', [keep].concat(brands.map((b) => ({ value: b, label: b }))), f, e, set) : null,
        K.two(K.field.select('color', 'اللون', pairs(colorList()), f, e, set), K.field.select('material', 'الخامة', pairs(FD.MATERIALS), f, e, set)),
        K.field.select('style', 'الستايل', pairs(FD.STYLES), f, e, set),
        K.two(K.field.text('nameAr', 'الاسم بالعربي', f, e, set, {}), K.field.text('nameEn', 'الاسم بالإنجليزي', f, e, set, { dir: 'ltr' }))],
      submit: async (f) => {
        const sel = rows().filter((r) => S.sel.has(r.key)); const pick = (list, v) => list.find(([en]) => en === v) || null;
        const col = f.color ? pick(colorList(), f.color) : null; const mat = f.material ? pick(FD.MATERIALS, f.material) : null; const sty = f.style ? pick(FD.STYLES, f.style) : null;
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
  function pairField(rs, kEn, kAr, list, lang, label, onPick) {
    const r = rs[0]; const k = lang === 'ar' ? kAr : kEn; const id = 'fl-' + k + '-' + r.key;
    const hit = FD.pairOf(list, r[kEn], r[kAr]); const cur = (lang === 'ar' ? r[kAr] || r[kEn] : r[kEn] || r[kAr]) || '';
    const options = [{ value: '', label: '—' }].concat(list.map(([en, ar]) => ({ value: en, label: lang === 'ar' ? ar : en })), !hit && cur ? [{ value: '__cur', label: cur }] : [],
      [{ value: '__new', label: lang === 'ar' ? '+ جديد…' : '+ New…' }]);
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
      h('div', { class: 'fl-2' }, pairField(rs, 'materialEn', 'materialAr', FD.MATERIALS, 'ar', 'الخامة', pickBoth('materialEn', 'materialAr')), pairField(rs, 'styleEn', 'styleAr', FD.STYLES, 'ar', 'الستايل', pickBoth('styleEn', 'styleAr'))));
    const en = h('div', { class: 'fl-dcol', lang: 'en', dir: 'ltr' }, h('div', { class: 'fl-dcol-h' }, 'English', tr ? h('span', { class: 'fl-trans', role: 'status' }, 'بيترجم…') : null),
      textField(rs, 'nameEn', 'Product name', { dir: 'ltr', rw: { key: g.key, what: 'name', lang: 'en' } }), textField(rs, 'shortEn', 'Description', { dir: 'ltr', rw: { key: g.key, what: 'desc', lang: 'en' } }),
      vari ? null : h('div', { class: 'fl-2' }, pairField(rs, 'colorEn', 'colorAr', colorList(), 'en', 'Colour', pickColor), textField(rs, 'size', 'Size', { dir: 'ltr' })),
      h('div', { class: 'fl-2' }, pairField(rs, 'materialEn', 'materialAr', FD.MATERIALS, 'en', 'Material', pickBoth('materialEn', 'materialAr')), pairField(rs, 'styleEn', 'styleAr', FD.STYLES, 'en', 'Style', pickBoth('styleEn', 'styleAr'))));
    const photos = (R0.photos || []).length;
    const pic = h('div', { class: 'fl-dpic' }, Thumb(R0.ref, 'fl-dimg'), photos > 1 ? h('small', { class: 'help' }, photos + ' صور') : null);
    const vars = vari ? h('div', { class: 'fl-vars' }, h('div', { class: 'fl-vars-h' }, 'التركيبات'), rs.map((x) => h('div', { class: 'fl-var' + (ISSUE_FIELDS(x).length ? ' row-err' : ''), 'data-row': x.key },
      Thumb(x.ref || R0.ref, 'fl-pthumb'), textField([x], 'sku', 'SKU', { cls: 'fl-sku' }),
      pairField([x], 'colorEn', 'colorAr', colorList(), 'ar', 'اللون', pickColor), pairField([x], 'colorEn', 'colorAr', colorList(), 'en', 'Colour', pickColor),
      textField([x], 'sizeAr', 'المقاس', { after: sizeAfter([x]) }), textField([x], 'size', 'Size', { dir: 'ltr' }), textField([x], 'weight', 'الوزن', { cls: 'fl-w' }),
      U.IconButton({ icon: 'trash', label: 'شيل التركيبة ' + (x.sku || ''), onClick: () => { const s2 = st(); s2.rows = s2.rows.filter((y) => y !== x); S.sel.delete(x.key); touch(); R(); } })))) : null;
    return h('section', { class: 'fl-dcard' + (issues.length ? ' has-miss' : ''), 'data-row': R0.key, 'data-group': g.key }, head, h('div', { class: 'fl-dbody' }, pic, ar, en), vars);
  }
  function step3() {
    const s = st(); const L = rows(); const G = groups();
    // a size the sheet gave in English only → its Arabic written from it («40 × 40 cm» → «40 × 40 سم»), so the Arabic column is whole
    let sized = false; L.forEach((r) => { if (r.size && !r.sizeAr) { r.sizeAr = arSize(r); sized = true; } }); if (sized) touch();
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
  function reprice(r, force) { const c = commOf(r); if (!c) return; const p = FD.pricesOf(r.vendorPrice, { rate: c.rate, fee: c.fee, markup: r.markup == null ? undefined : r.markup }); if (!p) return; if (r.markup == null) r.markup = p.markup; if (force || !r.priceHand) { r.sale = p.sale; r.regular = p.regular; r.rateAt = commKey(c); } }
  function step4() {
    const L = rows(); const rate = rateNow();
    L.forEach((r) => { if (r.vendorPrice == null) return; if (r.sale == null || (!r.priceHand && r.rateAt !== commKey(commOf(r)))) reprice(r); });
    const num = (r, k, onSet) => h('input', { class: 'input fl-num', inputmode: 'decimal', 'data-fl': k, 'aria-label': FD.LABELS[k] + ' — ' + (r.sku || ''), value: r[k] == null ? '' : String(r[k]), onChange: (ev) => { const v = ev.target.value.trim(); r[k] = v === '' ? null : Number(v); onSet(); touch(); RF(); } });
    const bulk = () => K.form({ title: 'سعر المبتكر لـ ' + S.sel.size + ' صف', values: { v: '' }, submitLabel: 'طبّق',
      fields: (f, e, set) => [K.field.text('v', 'سعر المبتكر (ج.م)', f, e, set, { required: true, inputmode: 'decimal' })], validate: (f) => (Number(f.v) > 0 ? {} : { v: 'رقم أكبر من صفر' }),
      submit: (f) => { L.filter((r) => S.sel.has(r.key)).forEach((r) => { r.vendorPrice = Number(f.v); r.priceHand = false; reprice(r, true); }); touch(); R(); } });
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
        pcell(null, 'سعر المبتكر', num(r, 'vendorPrice', () => { r.priceHand = false; reprice(r, true); })),
        pcell('c-rate', null, h('span', { class: 'help' }, rateEl(r))),
        pcell(null, 'سعر البيع', num(r, 'sale', () => { r.priceHand = true; })),
        pcell(null, 'قبل الخصم', num(r, 'regular', () => { r.priceHand = true; })),
        pcell('c-menu', null, K.RowMenu([{ label: 'احسب السعر تاني', icon: 'undo', run: () => { r.priceHand = false; r.markup = null; reprice(r, true); touch(); R(); } }, { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => { st().rows = st().rows.filter((x) => x !== r); touch(); R(); } }], 'إجراءات ' + (r.sku || ''))));
    };
    const hcell = (label, cls) => h('div', { class: 'fl-pc' + (cls ? ' ' + cls : ''), role: 'columnheader' }, label);
    const table = h('div', { class: 'fl-plist', role: 'table', 'aria-label': 'الأسعار', 'data-fl-prices': '' },
      h('div', { class: 'fl-prow head', role: 'row' }, hcell(allBox(L.map((r) => r.key)), 'c-cb'), hcell('المنتج', 'c-prod'), hcell('سعر المبتكر'), hcell('نسبة إبتكر', 'c-rate'), hcell('سعر البيع'), hcell('قبل الخصم'), hcell('', 'c-menu')),
      L.map(prow));
    const ok = L.length > 0 && L.every((r) => Number(r.sale) > 0);
    return [Card('الأسعار', 'سعر البيع = (سعر المبتكر + الرسوم) ÷ (1 − نسبة إبتكر) لأقرب 10، وقبل الخصم أعلى بـ 15–30%. نسبة إبتكر من حساب المبتكر — ولو القسم ليه نسبة لوحده بتتحسب بيها.', [
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
  // the size drawing is the product's (one per group, its first unit), and only for a product with a size
  const hasSize = (gi) => { const g = groups()[gi]; return !!g && g.rows.some((ri) => String(rows()[ri].size || '').trim()); };
  const sizeUnit = (u) => { const first = units().find((x) => x.gi === u.gi); return !!first && first.key === u.key; };
  async function genMissing(list) {
    const jobs = []; const sized = new Set();
    list.forEach((u) => { shotsOf(u).forEach((p, k) => { if (!p) jobs.push([u, k]); }); if (!sized.has(u.gi) && !st().sizeShot[groupKey(u.gi)] && hasSize(u.gi)) { sized.add(u.gi); jobs.push([u, 4]); } });
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
    const sh = shotsOf(u); const path = k === 4 ? st().sizeShot[groupKey(u.gi)] : sh[k]; const gen = S.busy === busyKey(u, k); const label = k === 4 ? 'صورة المقاس' : SHOT_L[k];
    const el = h('div', { class: 'fl-slot' + (path ? '' : ' is-empty'), draggable: path && k < 4 ? 'true' : 'false', 'data-slot': u.key + ':' + k },
      h('small', { class: 'fl-slab', title: label }, label), gen ? h('span', { class: 'thumb fl-shot gen' }, 'بيتولّد…') : Thumb(path, 'fl-shot'),
      h('div', { class: 'fl-sacts' }, path ? Button({ size: 'sm', label: 'تعديل', onClick: () => shotModal(u, k) }) : null,
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
    const card = Card('صور المنتجات', n ? n + ' منتج' : 'صورة لكل منتج بالترتيب', [h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: n ? 'بدّل / زوّد الصور' : 'ارفع الصور', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) })),
      U.InlineNote({ children: 'كل صورة بتبقى منتج بالترتيب. ولو أكتر من صورة لنفس المنتج سمّيها «1-1»، «1-2» (و«2-1»، «2-2»…). أول صورة للمنتج هي اللي بتتحط في الشيت.' }),
      n ? h('div', { class: 'fl-grid fl-pair-list' }, s.products.map((p) => h('div', { class: 'fl-pcard' }, Thumb(p.ref, 'st-big'), h('b', null, 'منتج ' + p.n), h('small', { class: 'help' }, p.photos.length + ' صورة'))))
        : h('div', { class: 'fl-pair-list' }, h('div', { class: 'fl-list-empty' }, Icon('image', 'sm'), h('span', null, 'اسحب الصور وسيبها هنا — كل صورة منتج بالترتيب')))]);
    dropZone(card, isImage, takePhotos, () => S.busy === 'photos', 'اسحب صور بس (JPG أو PNG أو WebP)');
    return [card, Foot(n > 0, 'ارفع الصور')];
  }
  function blankRowsOf() {
    const s = st(); const L = FD.blankSheetRows({ type: s.type, products: (s.products || []).length, kinds: s.kinds });
    return L.map((r) => { const p = s.products[r.product]; const k = r.variant ? (p.n + '-' + r.variant) : String(p.n); const x = (s.fill && s.fill[r.product]) || {};
      return Object.assign(r, { n: k, ref: p.ref, brand: s.brandName, nameEn: x.nameEn || '', nameAr: x.nameAr || '', catEn: x.catEn || '', shortEn: x.shortEn || '', shortAr: x.shortAr || '', colorEn: r.colorSlot > 1 ? '' : x.colorEn || '', colorAr: r.colorSlot > 1 ? '' : x.colorAr || '', images: [] }); });
  }
  async function aiFillProducts(notes) {
    const s = st(); await touch(true); S.busy = 'ai'; R(); s.fill = s.fill || {}; let stop = '';
    for (let i = 0; i < s.products.length; i++) {
      if (s.fill[i] && s.fill[i].nameEn) continue;
      const r = await AI().studio(S.id, i, ['nameEn', 'nameAr', 'desc', 'category', 'variations'], notes);
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
      h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'ai' ? 'بيكتب…' : 'املأ بالـ AI', disabled: !!S.busy, attrs: { 'data-flow-ai': '' }, onClick: async () => { const a = await window.IBAIAsk({ title: 'املأ الشيت بالـ AI — ' + (st().products || []).length + ' منتج', intro: 'الأسماء والوصف والقسم واللون من الصور.' }); if (a) aiFillProducts(a.notes); } }),
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
