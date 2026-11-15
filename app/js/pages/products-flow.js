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
  function screensList() {
    const s = st(); const list = Array.isArray(s.screenList) ? s.screenList : [];
    if (!list.length) return null;
    return sortList('fl-screens', list.map((p, i) => ({ id: p, label: 'السكرين ' + (i + 1) })), (x) => h('div', { class: 'fl-sort-body' }, Thumb(x.id, 'st-sm'),
      U.IconButton({ icon: 'trash', label: 'امسح السكرين ده', onClick: () => { s.screenList = list.filter((p) => p !== x.id); ST().removeImage(x.id); s.screensDirty = !!(s.rows || []).length; touch(); R(); } })),
      (ids) => { if (ids.join('|') === list.join('|')) return; s.screenList = ids.slice(); s.screensDirty = !!(s.rows || []).length; touch(); R(); });
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
    const src = s.case === 'whatsapp'
      ? Card('سكرين شوتس الواتساب', 'لحد 8 سكرين شوتس — الـ AI بيقرا الأسماء والأسعار والألوان والمقاسات بالترتيب.', [
        h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'sparkle', label: S.busy === 'extract' ? 'بيقرا…' : (s.screenList || []).length ? 'زوّد سكرين شوتس' : 'ارفع السكرين شوتس واقرا الداتا', disabled: S.busy === 'extract' || (s.screenList || []).length >= 8, attrs: { 'data-flow-screens': '' }, onClick: () => filePick('image/*', true, takeScreens) }),
          (s.screenList || []).length && (s.screensDirty || !s.rows.length) ? Button({ icon: 'sparkle', label: 'اقرا تاني بالترتيب ده', disabled: S.busy === 'extract', attrs: { 'data-flow-read': '' }, onClick: () => readScreens() }) : null),
        s.screensDirty ? U.InlineNote({ kind: 'warning', children: 'غيّرت ترتيب السكرين شوتس أو مسحت واحدة — اضغط «اقرا تاني بالترتيب ده» عشان الصفوف تمشي معاها.' }) : null,
        s.rows.length ? U.InlineNote({ kind: 'success', children: 'اتقرا ' + s.rows.length + ' صف من ' + (s.screens || 0) + ' سكرين — هتراجعهم في «البيانات».' }) : null,
        U.InlineNote({ children: 'ارفع صور المنتجات الأول عشان الـ AI يعرف عددها، وبنفس ترتيب المنتجات في الشات (صورة لكل منتج، أو سمّيها «1»، «2»، «1-2»…).' })])
      : Card('الشيت', 'xlsx أو csv بالقالب بتاعنا أو بأي عناوين — بنطابق الأعمدة لوحدنا.', [
        h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: s.rows.length ? 'بدّل الشيت' : 'ارفع الشيت', attrs: { 'data-flow-sheet': '' }, onClick: () => filePick('.xlsx,.csv', false, (f) => takeSheet(f[0])) }), s.sheetName ? h('span', { class: 't-small help' }, s.sheetName) : null),
        s.rows.length ? U.InlineNote({ kind: 'success', children: s.rows.length + ' صف · ' + (s.mapped || 0) + ' عمود اتطابق' + (s.unknown && s.unknown.length ? ' · أعمدة مش في القالب: ' + s.unknown.join('، ') : '') }) : null]);
    const noRef = s.rows.filter((r) => !r.ref).length;
    const pics = Card('الصور', photosN ? photosN + ' صورة' + (s.rows.length ? ' · ' + (s.rows.length - noRef) + ' صف ليه صورة' : '') : 'صور المنتجات بجودة عالية', [h('div', { class: 'acts-inline' }, photosBtn, S.busy === 'photos' ? h('span', { class: 't-small help' }, 'بنرفع…') : null), nameHelp,
      s.rows.length && noRef ? U.InlineNote({ kind: 'warning', children: noRef + ' صف من غير صورة مرجعية — الصور بتتولّد من المرجعية، فارفعها أو كمّل من غيرها.' }) : null]);
    const sl = s.case === 'whatsapp' ? screensList() : null; const pl = photosList();
    const match = sl || pl ? Card(s.case === 'whatsapp' ? 'الصور قدام السكرين شوتس' : 'الصور على صفوف الشيت', 'اسحب من الست نقط عشان ترتّب — ' + (s.case === 'whatsapp' ? 'كل صورة قدام السكرين شوت بتاعها، والترتيب ده هو ترتيب المنتجات.' : 'كل صف بصوره، واسم المنتج من الشيت جنبه.'),
      h('div', { class: 'fl-match' + (sl ? ' two' : ''), 'data-fl-match': '' },
        sl ? h('div', { class: 'fl-match-col' }, h('b', { class: 't-label-s' }, 'السكرين شوتس'), sl) : null,
        h('div', { class: 'fl-match-col' }, h('b', { class: 't-label-s' }, 'صور المنتجات'), pl || h('span', { class: 't-small help' }, 'ارفع الصور')))) : null;
    return [h('div', { class: 'cols2-wide' }, src, pics), match, Foot(s.rows.length > 0, s.case === 'whatsapp' ? 'اقرا السكرين شوتس الأول' : 'ارفع الشيت الأول')];
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
    const info = (label, value, attrs) => h('div', Object.assign({ class: 'fl-mk-item' }, attrs || {}), h('span', { class: 't-small help' }, label), h('b', null, value));
    const body = [
      h('div', { class: 'grid2' },
        U.Select({ id: 'fl-maker', label: 'المبتكر', required: true, value: s.vendorId || '', placeholder: vd ? 'اختار المبتكر — اكتب أول حروف اسمه' : 'بنحمّل المبتكرين…',
          options: makers.map((x) => ({ value: x.id, label: x.name + (x.wooVendorId == null ? ' (مالوش متجر على الموقع)' : '') })),
          onChange: (v) => { const m = makers.find((x) => x.id === v); s.vendorId = m ? m.id : null; s.vendorName = m ? m.name : ''; s.brandId = null; s.brandName = ''; s.code = ''; s.rate = null; s.fee = null; touch(); R(); },
          error: noStore ? 'المبتكر ده مالوش متجر على الموقع — اعمله متجر من ملفه الأول' : null }),
        h('div', { class: 'fl-new' }, Button({ size: 'sm', icon: 'plus', label: 'مبتكر جديد', onClick: () => { touch(true); go('makers/new'); } }))),
      mk ? h('div', { class: 'fl-maker-info', 'data-fl-maker-info': '' },
        h('div', { class: 'fl-mk-rate' }, h('span', { class: 't-small help' }, 'نسبة إبتكر'), h('b', { class: 'num', 'data-fl-rate': '' }, r == null ? '—' : U.num(r + '%')),
          h('small', { class: 'help' }, (feeNow() ? '+ ' + K.n0(feeNow()) + ' ج.م رسوم ثابتة' : 'من غير رسوم ثابتة') + (mk.commissionType === 'category_based' ? ' · بتختلف حسب القسم' : ''))),
        h('div', { class: 'fl-mk-grid' },
          info('المبتكر', mk.name),
          info('المتجر على الموقع', mk.wooVendorId == null ? 'مالوش متجر' : 'موجود'),
          info('البراند', s.brandName || mk.name, { 'data-fl-brand': '' }),
          info('سعر البيع', '(سعر المبتكر + الرسوم) ÷ (1 − النسبة)'))) : null,
      mk ? h('div', { class: 'grid2' }, U.FieldShell({ id: 'fl-code', label: 'كود البراند في الـ SKU (2–4 حروف)', help: 'مثال: glasstora → GLS — IBTGLS1020-OW' }, h('div', { class: 'input' }, h('input', { id: 'fl-code', dir: 'ltr', maxlength: 4, value: s.code || '', 'data-flow-code': '',
          onChange: (ev) => { s.code = String(ev.target.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); touch(); R(); } }))),
        h('div', { class: 'fl-sku-ex t-small help', 'data-fl-sku-ex': '' }, FD.validCode(s.code) ? 'الـ SKU هيبقى: ' : '', FD.validCode(s.code) ? h('b', { dir: 'ltr' }, 'IBT' + s.code + '1020-OW') : null)) : null,
      mk && !FD.validCode(s.code) ? U.InlineNote({ kind: 'warning', children: 'كود البراند لازم 2–4 حروف إنجليزي.' }) : null];
    const ok = !!mk && FD.validCode(s.code) && (s.case === 'photos' || mk.wooVendorId != null);
    return [Card('المبتكر', 'المنتجات بتترفع على متجر المبتكر، وبراندُه بيتكتب في الشيت وكوده في الـ SKU.', body), Foot(ok, !mk ? 'اختار المبتكر' : 'كود البراند')];
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
    if (S.autoSku !== S.id && FD.validCode(s.code) && L.some((r) => !FD.validSku(r.sku) || (r.colorEn && !colorOf(r)))) { S.autoSku = S.id; setTimeout(() => genSkus(true), 0); } // once per batch opened
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
    // the owner 15 Nov («صلح شكل الجدول و إظهر بيانات المنتج العربي بس»): a grid, not a <table> (the system's table sweeps — the sticky
    // first column, the person cell — broke its columns), the photo inside the product cell, the product's Arabic data only (its
    // Arabic name, the SKU, the Arabic color and size; the English one only while the Arabic is missing); on a phone a card each
    const rateEl = () => (rate == null ? '—' : U.num(rate + '%'));
    const pcell = (cls, label, child) => h('div', { class: 'fl-pc' + (cls ? ' ' + cls : ''), role: 'cell' }, label ? h('span', { class: 'fl-plbl', 'aria-hidden': 'true' }, label) : null, child);
    const prow = (r) => {
      const meta = [r.colorAr || r.colorEn, arSize(r)].filter(Boolean).join(' · ');
      return h('div', { class: 'fl-prow' + (!(Number(r.sale) > 0) ? ' row-err' : ''), role: 'row', 'data-row': r.key },
        pcell('c-cb', null, selBox(r.key, r.nameAr || r.nameEn || r.sku)),
        pcell('c-prod', null, h('div', { class: 'fl-pprod' }, Thumb(r.ref, 'fl-pthumb'), h('div', { class: 'fl-info' }, h('b', { dir: 'rtl', 'data-fl-name': '' }, r.nameAr || r.nameEn || '—'),
          h('small', { class: 'num' }, h('bdi', { dir: 'ltr' }, r.sku || '—')), meta ? h('small', null, meta) : null, h('small', { class: 'fl-prate-m' }, 'نسبة إبتكر ', rateEl())))),
        pcell(null, 'سعر المبتكر', num(r, 'vendorPrice', () => { r.priceHand = false; reprice(r, true); })),
        pcell('c-rate', null, h('span', { class: 'help' }, rateEl())),
        pcell(null, 'سعر البيع', num(r, 'sale', () => { r.priceHand = true; })),
        pcell(null, 'قبل الخصم', num(r, 'regular', () => { r.priceHand = true; })),
        pcell('c-menu', null, K.RowMenu([{ label: 'احسب السعر تاني', icon: 'undo', run: () => { r.priceHand = false; r.markup = null; reprice(r, true); touch(); R(); } }, { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => { st().rows = st().rows.filter((x) => x !== r); touch(); R(); } }], 'إجراءات ' + (r.sku || ''))));
    };
    const hcell = (label, cls) => h('div', { class: 'fl-pc' + (cls ? ' ' + cls : ''), role: 'columnheader' }, label);
    const table = h('div', { class: 'fl-plist', role: 'table', 'aria-label': 'الأسعار', 'data-fl-prices': '' },
      h('div', { class: 'fl-prow head', role: 'row' }, hcell(allBox(L.map((r) => r.key)), 'c-cb'), hcell('المنتج', 'c-prod'), hcell('سعر المبتكر'), hcell('نسبة إبتكر', 'c-rate'), hcell('سعر البيع'), hcell('قبل الخصم'), hcell('', 'c-menu')),
      L.map(prow));
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
    const s = st(); const us = units(); const rate = rateNow();
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
          h('div', { class: 'fl-uprice' }, h('b', { class: 'brand-t' }, money(r.sale)), r.regular ? h('s', { class: 'help' }, money(r.regular)) : null, h('small', { class: 'help' }, 'نسبة إبتكر ', rate == null ? '—' : U.num(rate + '%'))),
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
    return [Card('صور المنتجات', n ? n + ' منتج' : 'صورة لكل منتج بالترتيب', [h('div', { class: 'acts-inline' }, Button({ type: 'primary', icon: 'upload', label: n ? 'بدّل / زوّد الصور' : 'ارفع الصور', disabled: S.busy === 'photos', attrs: { 'data-flow-photos': '' }, onClick: () => filePick('image/*', true, takePhotos) })),
      U.InlineNote({ children: 'كل صورة بتبقى منتج بالترتيب. ولو أكتر من صورة لنفس المنتج سمّيها «1-1»، «1-2» (و«2-1»، «2-2»…). أول صورة للمنتج هي اللي بتتحط في الشيت.' }),
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
