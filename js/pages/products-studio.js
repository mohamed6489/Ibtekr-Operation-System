/* «استوديو المنتجات» (phase 5.2, plan docs/superpowers/plans/2026-10-28-phase-5-2-studio.md) — the prototype's studio (artifact
   1793199492, block 18: startBatch / step1…step8 / upload / reportView) on real data, without AI (decision 1: «صور بس» and every AI
   button wait for the AI phase, marked soon). A batch lives in studio_batches (IBStudio); its images in the private bucket until the
   upload; the upload goes through woo-sync studio_upload one product at a time (drafts). The SKU is the owner's rule (decision 2,
   PD.studioSku), the prices decision 16 (PD.priceFromVendor). The products page routes #products-studio-<new|id>[-<step|report>]
   here: IBStudioView.route / view. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, PD = window.IbtekrProducts;
  const { h, Icon, Button } = U;
  const ST = () => window.IBStudio, PR = () => window.IBProducts;
  const R = () => window.IBPages.render('products');
  const go = (hs) => { const p = window.IBPages.all && window.IBPages.all().products; if (p && p.api && p.api.go) p.api.go(hs); else { location.hash = hs; } };
  const Tag = K.Tag;
  const money = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : K.n0(n) + ' ج.م');
  const safeSrc = (s) => (typeof s === 'string' && s.startsWith('https://') ? s : '');
  const Thumb = (path, cls) => { const u = path ? safeSrc(ST().imageUrl(path)) : ''; return u ? h('span', { class: 'thumb ' + (cls || '') }, h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : h('span', { class: 'thumb empty-img ' + (cls || ''), role: 'img', 'aria-label': path ? 'بتحمّل الصورة' : 'مفيش صورة' }, Icon('image', 'sm')); };
  const chipBtn = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  const Card = (title, sub, body, acts) => K.Section(title, [].concat(body).filter(Boolean), acts, { sub });
  const soon = (label) => Button({ size: 'sm', icon: 'sparkle', label: label + ' — soon', disabled: true });

  const STEPS = ['البداية', 'الاستلام', 'البيانات و SKU', 'المتغيرات', 'السعر', 'الصور', 'الأقسام والأوصاف', 'المراجعة والرفع'];
  const SLOT_L = PD.SLOTS.concat(['إضافية 1', 'إضافية 2']);
  const FIELD_L = { nameEn: 'الاسم (EN)', nameAr: 'الاسم (AR)', vendorPrice: 'سعر المبتكر', colors: 'اللون', sizes: 'المقاس', material: 'الخامة', style: 'الستايل', weight: 'الوزن', stock: 'المخزون', shortDesc: 'الوصف القصير' };
  const REASON = { product_invalid_sku: 'الـ SKU ده موجود على الموقع', image_missing: 'صورة مش لاقيينها — ارفعها تاني', media_refused: 'الموقع رفض صورة', config: 'باسورد تطبيق WordPress مش متظبط على السيرفر',
    product_refused: 'الموقع رفض المنتج', author_failed: 'المبتكر ماتحطش على المنتج — «جرّب تاني» (التركيبات بتستناه)', maker_changed: 'المبتكر اتغيّر بعد ما التركيبات اتعملت — المنتج فاضل على المبتكر القديم (رجّعه، أو انقل المنتج من لوحة WordPress)', push_disabled: 'الكتابة على الموقع مقفولة دلوقتي', forbidden: 'مش مسموحلك ترفع منتجات', invalid: 'في بيانات مش مقبولة', network: 'في مشكلة في الاتصال — جرّب تاني', missing: 'الدفعة أو المنتج مش موجود' };
  const reasonOf = (code) => REASON[code] || (/^http_5/.test(String(code)) ? 'الموقع مش بيرد — جرّب كمان شوية' : 'الموقع رفض الطلب (' + code + ')');

  // ---------------- state ----------------
  const S = { id: null, row: null, state: null, step: 1, report: false, loading: false, err: '', timer: null, saving: false, sel: new Set(), q: '', uploading: false };
  const blank = () => ({ v: 1, type: 'Simple', vary: ['color'], brandId: null, brandName: '', vendorId: null, vendorName: '', rate: null, fee: null, sheet: null, imgCount: 4, items: [] });
  const isVar = () => S.state && S.state.type === 'Variable';
  const flow = () => (isVar() ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 5, 6, 7, 8]);
  const posOf = (n) => flow().indexOf(n) + 1;

  function route(id, step) {
    S.report = step === 'report';
    const n = S.report ? 8 : Math.min(8, Math.max(1, Number(step) || 1));
    if (id === 'new') { if (S.id !== null || !S.state) { S.id = null; S.row = null; S.state = blank(); S.sel.clear(); } S.step = 1; return; }
    S.step = n;
    if (id !== S.id) { S.id = id; S.state = null; S.row = null; S.err = ''; S.sel.clear(); openBatch(id); }
  }
  async function openBatch(id) {
    S.loading = true; R();
    const row = await ST().open(id);
    if (S.id !== id) return;
    S.loading = false;
    if (!row) { S.err = 'الدفعة دي مش موجودة أو مش مسموحلك تفتحها.'; R(); return; }
    S.row = row; S.state = Object.assign(blank(), row.state || {}); S.state.items = Array.isArray(S.state.items) ? S.state.items : [];
    if (!S.report && S.step > row.step + 1) S.step = row.step;
    if (S.step === 4 && !isVar()) S.step = 5;
    R();
  }
  const hashFor = (n) => 'products-studio-' + (S.id || 'new') + '-' + n;
  // auto-save (decision 10): the state and the furthest step, a moment after the last change
  function touch(now) {
    if (!S.id) return;
    clearTimeout(S.timer);
    const run = async () => { S.saving = true; const r = await ST().save(S.id, { state: S.state, step: Math.max(S.step, (S.row && S.row.step) || 1), type: S.state.type, brand_id: S.state.brandId, vendor_id: S.state.vendorId, title: titleOf() }); S.saving = false; if (r.ok) S.row = Object.assign({}, S.row, r.row); else K.toast('الدفعة ماتحفظتش — ' + reasonOf(r.reason), 'error'); };
    if (now) return run();
    S.timer = setTimeout(run, 700);
    return null;
  }
  const titleOf = () => (S.state.brandName || 'دفعة') + ' — ' + (isVar() ? 'Variable' : 'Simple') + ' · ' + new Date().toISOString().slice(0, 10);
  async function goStep(n) {
    if (n === 4 && !isVar()) n = 5;
    if (!S.id) {
      const r = await ST().create({ title: titleOf(), brand_id: S.state.brandId, vendor_id: S.state.vendorId, type: S.state.type, state: S.state, step: n });
      if (!r.ok) { K.toast('مقدرناش نعمل الدفعة — ' + reasonOf(r.reason), 'error'); return; }
      S.id = r.id; S.row = { id: r.id, step: n, status: 'draft' };
    } else await touch(true);
    S.sel.clear(); go(hashFor(n));
  }

  // ---------------- pricing (decision 4 = plan 5 decision 16) ----------------
  const vendorRec = () => { const V = window.IBVendors; return S.state.vendorId && V && V.store && V.store.get ? V.store.get(S.state.vendorId) : null; };
  const rateNow = () => (S.state.rate != null ? Number(S.state.rate) : PR() ? PR().rateOf(S.state.vendorId) : null);
  const feeNow = () => { if (S.state.fee != null) return Number(S.state.fee); const v = vendorRec(); return v && v.rateFlat ? Number(v.rateFlat) : 0; };
  function priceOf(vp, markup) { const r = rateNow(); if (r == null || !(Number(vp) > 0)) return null; return PD.priceFromVendor(Number(vp), { rate: r, fee: feeNow(), markup }); }
  // an uploaded item is on the batch's maker: the Dokan store its ids were set to (result authorOwner) is the chosen maker's; a
  // result without it (before woo-sync v33) or a maker not known here counts as yes
  const onMaker = (r) => { const v = vendorRec(); return r.authorOwner === undefined || !v || v.wooVendorId == null || r.authorOwner === v.wooVendorId; };
  const ensureMarkup = (x) => { if (x.markup == null) x.markup = PD.randomMarkup(); return x.markup; };

  // ---------------- colors / variations ----------------
  const colors = () => (ST() ? ST().colors() : []);
  const colorByCode = (code) => colors().find((c) => c.code === code) || null;
  const colorByName = (n) => { const k = String(n || '').trim().toLowerCase(); return colors().find((c) => c.name_en.toLowerCase() === k || String(c.name_ar).trim() === String(n || '').trim()) || null; };
  const colorLabel = (code) => { const c = colorByCode(code); return c ? c.name_en + ' · ' + c.name_ar : code; };
  function syncVariations(it) {
    if (!isVar()) { it.variations = []; return; }
    const cs = it.colors.length ? it.colors : [null]; const ss = it.sizes.length ? it.sizes : [null];
    const old = new Map((it.variations || []).map((v) => [(v.color || '') + '|' + (v.size || ''), v]));
    it.variations = [];
    for (const c of cs) for (const s of ss) { if (c === null && s === null) continue; const k = (c || '') + '|' + (s || ''); it.variations.push(old.get(k) || { color: c, size: s, vendorPrice: it.vendorPrice, stock: null, onDemand: false }); }
  }
  const skuOf = (it, extra) => PD.studioSku(Object.assign({ brand: S.state.brandName, color: !isVar() ? it.colors[0] || null : null, serial: it.serial != null ? it.serial : (ST().nextSerial() != null ? ST().nextSerial() + S.state.items.indexOf(it) : null) }, extra || {}));

  // ---------------- shared pieces ----------------
  function Stepper() {
    return h('ol', { class: 'wstepper card', 'aria-label': 'خطوات الدفعة' }, flow().map((n, i) => { const st = n < S.step ? 'done' : n === S.step ? 'cur' : 'up';
      const reach = S.id && n <= Math.max(S.step, (S.row && S.row.step) || 1);
      return h('li', { class: 'stp stp-' + st, 'aria-current': st === 'cur' ? 'step' : false }, h('button', { type: 'button', class: 'stp-b', disabled: !reach || n === S.step, onClick: () => goStep(n), 'aria-label': 'الخطوة ' + (i + 1) + ': ' + STEPS[n - 1] },
        h('span', { class: 'stp-n' }, st === 'done' ? Icon('check', 'sm') : K.Num(String(i + 1))), h('span', { class: 'stp-l' }, STEPS[n - 1]))); }));
  }
  function TotalsBar(list, extra) {
    return h('div', { class: 'tot-bar card', role: 'region', 'aria-label': 'إجمالي الدفعة' }, list.map(([l, v, tone]) => h('div', { class: 'tot' }, h('small', null, l), h('b', { class: tone ? 'tone-' + tone : '' }, U.num(String(v))))), h('span', { class: 'grow' }), extra || null);
  }
  function WizFoot(canNext, why) {
    const F = flow(); const i = F.indexOf(S.step); const next = F[i + 1]; const back = F[i - 1];
    return h('div', { class: 'wiz-foot card' }, h('span', { class: 't-small help' }, canNext === false && why ? why : 'الخطوة ' + posOf(S.step) + ' من ' + F.length + (S.saving ? ' · بيتحفظ…' : S.id ? ' · اتحفظ' : '')), h('span', { class: 'grow' }),
      back ? Button({ label: 'رجوع', onClick: () => goStep(back) }) : null,
      next ? Button({ type: 'primary', label: 'التالي: ' + STEPS[next - 1], disabled: canNext === false, onClick: () => goStep(next) }) : Button({ type: 'brand', label: 'ارفع على الموقع (مسودة)', disabled: canNext === false || S.uploading, onClick: uploadAll }));
  }
  function STable(cols, rows, label) {
    return h('div', { class: 'scroll-x' }, h('table', { class: 'dt st-table', 'aria-label': label }, h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col', style: c.w ? 'width:' + c.w + 'px' : null }, c.l)))),
      h('tbody', null, rows.filter(Boolean).map((r) => h('tr', { class: r.cls || null }, r.cells.map((c, k) => h('td', { 'data-l': typeof cols[k].l === 'string' ? cols[k].l : '' }, c)))))));
  }
  const selBox = (it) => K.Checkbox({ label: '', checked: S.sel.has(it.key), onChange: (v) => { v ? S.sel.add(it.key) : S.sel.delete(it.key); R(); } });
  const allBox = (L) => K.Checkbox({ label: '', checked: L.length > 0 && L.every((it) => S.sel.has(it.key)), onChange: (v) => { L.forEach((it) => (v ? S.sel.add(it.key) : S.sel.delete(it.key))); R(); } });
  const PCell = (it, lines) => h('span', { class: 'st-prod' }, Thumb((it.slots || [])[0] || it.main, 'lg2'), h('span', null, h('b', null, it.nameEn || h('span', { class: 'help' }, 'من غير اسم')), it.nameAr ? h('small', null, it.nameAr) : null, h('small', { dir: 'ltr' }, skuOf(it).sku), ...(lines || []).filter(Boolean).map((l) => h('small', null, l))));
  const filePick = (accept, multiple, onFiles) => { const inp = h('input', { type: 'file', accept, multiple: !!multiple, style: 'display:none' }); inp.addEventListener('change', () => { const f = [...inp.files]; inp.value = ''; if (f.length) onFiles(f); }); document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000); };
  const items = () => (S.state ? S.state.items : []);
  const sel = () => items().filter((it) => S.sel.has(it.key));
  const BulkBar = (btns) => (S.sel.size ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد' }, h('b', null, 'محدد ' + S.sel.size), h('span', { class: 'grow' }), ...btns, Button({ type: 'text', size: 'sm', label: 'إلغاء التحديد', onClick: () => { S.sel.clear(); R(); } })) : null);

  // ---------------- 1 البداية ----------------
  const opt = (title, desc, on, onClick, dis) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(!!on), class: 'opt-card', disabled: !!dis, onClick }, h('i', { class: 'rd' }), h('span', null, h('b', null, title), h('small', null, desc)));
  function step1() {
    const s = S.state; const V = window.IBVendors; const vd = V && V.data ? V.data() : null;
    if (V && V.state && V.state() === 'idle') V.load();
    const brands = vd ? vd.brands : [];
    const vary = (k, label) => chipBtn(label, s.vary.includes(k), () => { s.vary = s.vary.includes(k) ? s.vary.filter((x) => x !== k) : s.vary.concat(k); touch(); R(); });
    const L = Card('نوع المنتجات', 'كل نوع ليه فلو مختلف في المتغيرات والسعر والصور.', [
      h('div', { class: 'opt-grid', role: 'radiogroup', 'aria-label': 'نوع المنتجات' },
        opt('Simple', 'كل منتج ليه SKU وسعر وصور — من غير متغيرات (7 خطوات).', s.type === 'Simple', () => { s.type = 'Simple'; touch(); R(); }),
        opt('Variable', 'منتج بتركيبات: لون و/أو مقاس. كل تركيبة ليها SKU وسعر.', s.type === 'Variable', () => { s.type = 'Variable'; if (!s.vary.length) s.vary = ['color']; touch(); R(); })),
      s.type === 'Variable' ? U.FieldShell({ id: 'vary', label: 'هيتغير في إيه؟', required: true, error: s.vary.length ? null : 'اختار حاجة واحدة على الأقل' }, h('div', { class: 'chips' }, vary('color', 'اللون'), vary('size', 'المقاس'))) : null,
      h('h3', { class: 't-h5 sub-h' }, 'طريقة الإدخال'),
      h('div', { class: 'opt-grid', role: 'radiogroup', 'aria-label': 'طريقة الإدخال' }, opt('شيت + صور', 'الشيت الأول، وبعده صورة لكل منتج.', true, () => {}), opt('صور بس — soon', 'ترفع الصور والـ AI يكتب الداتا — مع أدوات الـ AI.', false, () => {}, true))]);
    const b = brands.find((x) => x.id === s.brandId);
    const ownerName = (vid) => { const v = V && V.store && V.store.get ? V.store.get(vid) : null; return v ? v.name : '—'; };
    // the maker (the owner, 28 Oct): the brand's owner by default, any maker on request — the products go to that maker's store
    const makers = V && V.store && V.store.all ? V.store.all().sort((x, y) => x.name.localeCompare(y.name, 'ar')) : [];
    const mk = makers.find((x) => x.id === s.vendorId) || null;
    const noStore = !!mk && mk.wooVendorId == null;
    const moved = items().some((_, i) => { const x = resultOf(i); return !!(x && x.productId) && !onMaker(x); }); // products already up on another maker
    const r = rateNow(); const ex = priceOf(1000, 20);
    const R2 = Card('بيانات الدفعة', 'البراند بيحدد حرفين الـ SKU، والمبتكر صاحب البراند إلا لو اخترت غيره. السعر بيتحسب من سعر المبتكر (قرار 16).', [
      U.Select({ id: 'w-brand', label: 'البراند', required: true, options: brands.map((x) => ({ value: x.id, label: x.name })), value: s.brandId || '', placeholder: vd ? 'اختار البراند' : 'بنحمّل البراندات…',
        onChange: (v) => { const nb = brands.find((x) => x.id === v); s.brandId = v; s.brandName = nb ? nb.name : ''; s.vendorId = nb ? nb.owner : null; s.vendorName = nb ? ownerName(nb.owner) : ''; s.rate = null; s.fee = null; touch(); R(); },
        help: b ? (PD.brandCode(b.name) ? 'حرفين الـ SKU: ' + PD.brandCode(b.name) : 'اسم البراند لازم يبدأ بحرفين إنجليزي') : 'البراند بالإنجليزي — منه أول حرفين في الـ SKU',
        error: b && !PD.brandCode(b.name) ? 'اسم البراند مافيهوش حرفين إنجليزي' : null }),
      U.Select({ id: 'w-vendor', label: 'المبتكر', required: true, value: s.vendorId || '', placeholder: vd ? 'اختار المبتكر' : 'بنحمّل المبتكرين…',
        options: makers.map((x) => ({ value: x.id, label: x.name + (x.wooVendorId == null ? ' (مالوش متجر على الموقع)' : x.status === 'inactive' ? ' (غير نشط)' : x.status === 'leave' ? ' (في إجازة)' : '') })),
        onChange: (v) => { const m = makers.find((x) => x.id === v); s.vendorId = m ? m.id : null; s.vendorName = m ? m.name : ''; s.rate = null; s.fee = null; touch(); R(); },
        help: b && s.vendorId && s.vendorId === b.owner ? 'صاحب البراند — تقدر تختار مبتكر تاني، والمنتجات بتترفع على حسابه في الموقع' : 'المنتجات بتترفع على حساب المبتكر ده في الموقع',
        error: noStore ? 'المبتكر ده مالوش متجر على الموقع — اختار مبتكر ليه متجر' : null }),
      moved ? U.InlineNote({ kind: 'warning', children: 'في منتجات اترفعت على مبتكر تاني — «ارفع على الموقع» في «المراجعة والرفع» بيحط المبتكر ده عليها، إلا الـ Variable اللي اتعملت تركيباته: بيفضل على المبتكر القديم.' }) : null,
      h('div', { class: 'rate-field', id: 'rate-box' }, h('span', { class: 't-small help' }, 'نسبة إبتكر'), h('b', null, r == null ? '—' : U.num(r + '%')), h('small', { class: 'help' }, ' + ' + K.n0(feeNow()) + ' ج.م رسوم'), h('span', { class: 'grow' }), Button({ size: 'sm', label: 'تغيير', onClick: changeRate })),
      r == null && s.vendorId ? U.InlineNote({ kind: 'warning', children: 'نسبة المبتكر مش ظاهرة لك — اكتبها بـ «تغيير» عشان الأسعار تتحسب.' }) : null,
      h('div', { class: 'formula' }, h('small', null, 'معاينة المعادلة'), ex ? h('span', null, 'سعر المبتكر 1,000 ← سعر البيع ', h('b', null, K.n0(ex.sale)), ' ← قبل الخصم ', h('b', null, K.n0(ex.regular)), ' (+15–30% عشوائي)') : h('span', null, 'اختار البراند الأول')),
      h('small', { class: 't-small help' }, 'المسلسل الجاي في الموقع: ', U.num(PD.serialText(ST().nextSerial()) || '0999'), ' — بيتحجز وقت الرفع بس')]);
    const ok = !!s.brandId && !!PD.brandCode(s.brandName) && !!mk && !noStore && (s.type === 'Simple' || s.vary.length > 0);
    return [h('div', { class: 'cols2-wide' }, L, R2), WizFoot(ok, !s.brandId ? 'اختار البراند' : !mk ? 'اختار المبتكر' : noStore ? 'اختار مبتكر ليه متجر على الموقع' : 'اختار هيتغير في إيه')];
  }
  function changeRate() {
    K.form({ title: 'نسبة إبتكر للدفعة دي', values: { r: rateNow() == null ? '' : String(rateNow()), f: String(feeNow()) }, submitLabel: 'طبّق على الدفعة',
      note: U.InlineNote({ children: 'بتتطبق على منتجات الدفعة دي بس — نسبة المبتكر في صفحة المبتكرين مابتتغيرش.' }),
      fields: (f, e, set) => [K.field.text('r', 'النسبة (%)', f, e, set, { required: true, inputmode: 'numeric' }), K.field.text('f', 'رسوم ثابتة (ج.م)', f, e, set, { inputmode: 'numeric' })],
      validate: (f) => { const e = {}; const r = Number(f.r); if (!(r >= 0 && r < 90)) e.r = 'اكتب نسبة من 0 لـ 89'; if (f.f !== '' && !(Number(f.f) >= 0)) e.f = 'رقم 0 أو أكتر'; return e; },
      submit: (f) => { S.state.rate = Number(f.r); S.state.fee = f.f === '' ? 0 : Number(f.f); touch(); R(); } });
  }

  // ---------------- 2 الاستلام ----------------
  const newKey = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // the sheet's rows (a file, or a Google Sheets link — decision 13) → the batch; reading the same link again keeps the column
  // mapping while the headers are the same
  function takeRows(rows, name, link) {
    if (!rows || rows.length < 2) { K.toast('الشيت فاضي أو مافيهوش غير العناوين', 'error'); return; }
    const prev = S.state.sheet; const headers = rows[0].map(String);
    const same = !!(prev && link && prev.link === link && JSON.stringify(prev.headers) === JSON.stringify(headers));
    S.state.sheet = { file: name, link: link || null, headers, map: same ? prev.map : PD.mapColumns(rows[0]), rows: rows.slice(0, 501) };
    applySheet(); touch(); R();
  }
  async function readSheet(file) {
    let rows;
    try { rows = /\.xlsx$/i.test(file.name) ? await PD.parseXlsx(new Uint8Array(await file.arrayBuffer())) : PD.parseCsv(await file.text()); } catch (e) { K.toast('مقدرناش نقرا الشيت — ارفعه Excel (xlsx) أو CSV', 'error'); return; }
    takeRows(rows, file.name, null);
  }
  const LINK_REASON = { bad_link: 'ده مش لينك Google Sheet — انسخه من «النشر على الويب» أو «مشاركة»', not_published: 'الشيت مش منشور — من الشيت: ملف ← مشاركة ← النشر على الويب، وبعدين انسخ اللينك',
    too_big: 'الشيت أكبر من 2 ميجا — قسّمه على كذا دفعة', unreachable: 'مقدرناش نوصل للشيت دلوقتي — جرّب تاني' };
  async function readLink(url) {
    const link = String(url || '').trim();
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(link)) { K.toast(LINK_REASON.bad_link, 'error'); return; }
    if (S.linkBusy) return; S.linkBusy = true; R();
    const r = await ST().readSheetLink(link);
    S.linkBusy = false;
    if (!r.ok) { K.toast(LINK_REASON[r.reason] || reasonOf(r.reason), 'error'); R(); return; }
    let rows = null; try { rows = PD.parseCsv(r.csv); } catch (e) { rows = null; }
    takeRows(rows, 'Google Sheet', link);
  }
  // the link field: under the file picker, and «حدّث من اللينك» once a sheet came from a link
  function linkRow() {
    const inp = h('input', { id: 'sheet-link', type: 'url', class: 'input', dir: 'ltr', inputmode: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/e/…/pubhtml', value: S.linkDraft || '', 'aria-label': 'لينك Google Sheet' });
    inp.addEventListener('input', () => { S.linkDraft = inp.value; });
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); readLink(inp.value); } });
    return h('div', { class: 'link-row' }, U.FieldShell({ id: 'sheet-link', label: 'أو لينك Google Sheet', help: 'من الشيت: ملف ← مشاركة ← النشر على الويب، وانسخ اللينك هنا' }, inp),
      Button({ label: S.linkBusy ? 'بنقرا الشيت…' : 'اقرا من اللينك', disabled: !!S.linkBusy, onClick: () => readLink(inp.value) }));
  }
  function applySheet() {
    const sh = S.state.sheet; if (!sh) return;
    const old = items();
    const fresh = PD.rowsToItems(sh.rows, sh.map).map((x, i) => {
      const prev = old[i] || {};
      const cs = x.colors.map((n) => colorByName(n));
      const it = { key: prev.key || newKey(), row: x.row, nameEn: x.nameEn, nameAr: x.nameAr, vendorPrice: x.vendorPrice, colors: cs.filter(Boolean).map((c) => c.code), unknownColors: x.colors.filter((n, k) => !cs[k]),
        sizes: x.sizes, material: x.material, style: x.style, weight: x.weight, stock: x.stock, onDemand: false, shortDesc: x.shortDesc, shortDescAr: '', categories: prev.categories || [],
        main: prev.main || null, refs: prev.refs || [], slots: prev.slots || [], colorImages: prev.colorImages || {}, markup: prev.markup, variations: [] };
      if (!isVar()) { it.colors = it.colors.slice(0, 1); it.sizes = it.sizes.slice(0, 1); }
      syncVariations(it); return it;
    });
    S.state.items = fresh; S.sel.clear();
  }
  // images named «<row>-1» (main) / «<row>-2…» (references), else in order to the items without a main image
  async function dropImages(files) {
    const L = items(); if (!L.length) { K.toast('ارفع الشيت الأول', 'error'); return; }
    let done = 0; const byRow = new Map(L.map((it, i) => [String(i + 1), it]));
    const free = L.filter((it) => !it.main);
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
      const m = /^(\d+)\s*[-_]\s*(\d+)/.exec(f.name); let it = m ? byRow.get(m[1]) : null; let main = m ? m[2] === '1' : true;
      if (!it) { it = free.shift(); main = true; }
      if (!it) continue;
      const r = await ST().uploadImage(S.id, f, 'row' + (L.indexOf(it) + 1) + (main ? '-main' : '-ref'));
      if (!r.ok) { K.toast('صورة «' + f.name + '» ماترفعتش', 'error'); continue; }
      if (main) it.main = r.path; else it.refs = (it.refs || []).concat(r.path); done++;
      R();
    }
    touch(); K.toast('اترفع ' + done + ' صورة — راجع التطابق تحت', 'success'); R();
  }
  const issuesOf = (it) => PD.itemIssues(it, S.state.type).concat((it.unknownColors || []).length ? ['لون مش في الجدول: ' + it.unknownColors.join('، ')] : []);
  const recvState = (it) => (issuesOf(it).length ? 'data' : !it.main ? 'img' : 'ok');
  function step2() {
    const L = items(); const sh = S.state.sheet;
    const fields = Object.keys(FIELD_L);
    const s1 = Card('1 · ارفع الشيت', 'Excel (xlsx) أو CSV أو لينك Google Sheet — الداتا والأسعار. الأعمدة بتتربط لوحدها بالاسم.', sh ? [
      h('div', { class: 'file-row' }, Icon('sheet', 'sm'), h('b', null, sh.file), h('span', { class: 'help t-small' }, ' · ' + L.length + ' منتج'), h('span', { class: 'grow' }),
        sh.link ? Button({ type: 'text', size: 'sm', label: S.linkBusy ? 'بنقرا الشيت…' : 'حدّث من اللينك', disabled: !!S.linkBusy, onClick: () => readLink(sh.link) }) : null,
        Button({ type: 'text', size: 'sm', label: 'بدّل الشيت', onClick: () => filePick('.xlsx,.csv', false, (f) => readSheet(f[0])) })),
      sh.link ? null : linkRow(),
      h('b', { class: 't-label' }, 'ربط الأعمدة'),
      h('div', { class: 'grid2' }, fields.map((k) => U.Select({ id: 'map-' + k, label: FIELD_L[k], options: [{ value: '', label: '— مش في الشيت —' }].concat(sh.headers.map((x, i) => ({ value: String(i), label: x || ('عمود ' + (i + 1)) }))), value: sh.map[k] == null ? '' : String(sh.map[k]),
        onChange: (v) => { if (v === '') delete sh.map[k]; else sh.map[k] = Number(v); applySheet(); touch(); R(); } })))]
      : [h('button', { type: 'button', class: 'drop', onClick: () => filePick('.xlsx,.csv', false, (f) => readSheet(f[0])) }, Icon('upload'), h('b', null, 'اختار الشيت'), h('small', null, 'Excel (xlsx) أو CSV')), linkRow()]);
    const mainN = L.filter((it) => it.main).length;
    const s2 = Card('2 · صورة لكل منتج', sh ? 'سمّي الصور برقم الصف: 1-1 الأساسية، 1-2 و1-3 مرجعية لنفس المنتج — من غير رقم بتتربط بالترتيب.' : 'بتتفتح بعد الشيت.', sh ? [
      h('button', { type: 'button', class: 'drop', onClick: () => filePick('image/*', true, dropImages) }, Icon('upload'), h('b', null, 'اختار صور المنتجات'), h('small', null, 'JPG / PNG / WebP — بتتحول WebP · ' + mainN + ' من ' + L.length)),
      U.InlineNote({ children: 'الصورة الأساسية بتتحط في خانة «الصورة الأساسية» في خطوة الصور (تقدر تبدلها). الصور المرجعية مابتترفعش على الموقع.' })] : []);
    const rows = L.map((it, i) => { const s = recvState(it);
      return { cls: s === 'ok' ? null : 'row-err', cells: [K.Num(String(i + 1)), h('span', { class: 'rv-data' }, h('b', null, it.nameEn || h('span', { class: 'help' }, 'من غير اسم')), h('small', { class: 't-small help' }, (it.vendorPrice ? money(it.vendorPrice) : 'السعر ناقص') + (it.colors.length ? ' · ' + it.colors.join(' ') : ''))),
        it.main ? h('span', { class: 'rv-main' }, Thumb(it.main, 'st-big')) : h('button', { type: 'button', class: 'thumb st-big empty-img rv-up', 'aria-label': 'ارفع صورة ' + (it.nameEn || 'المنتج'), onClick: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'row' + (i + 1) + '-main'); if (r.ok) { it.main = r.path; touch(); R(); } else K.toast('الصورة ماترفعتش', 'error'); }) }, Icon('upload', 'sm'), h('small', null, 'ارفع')),
        h('span', { class: 'rv-refs' }, (it.refs || []).slice(0, 3).map((p) => Thumb(p, 'mini')), (it.refs || []).length > 3 ? h('small', null, '+' + (it.refs.length - 3)) : null),
        s === 'ok' ? Tag('success', 'متطابق ✓') : s === 'img' ? Tag('error', 'ناقص صورة') : Tag('error', 'ناقص: ' + issuesOf(it).join('، ')),
        K.RowMenu([{ label: 'بدّل الصورة', icon: 'upload', run: () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'row' + (i + 1) + '-main'); if (r.ok) { it.main = r.path; touch(); R(); } }) },
          { label: 'شيل من الدفعة', icon: 'trash', danger: true, run: () => K.confirm({ title: 'شيل «' + (it.nameEn || 'صف ' + (i + 1)) + '» من الدفعة؟', text: 'بيتشال من الدفعة دي بس.', okLabel: 'شيل', okType: 'danger', onOk: () => { S.state.items.splice(S.state.items.indexOf(it), 1); touch(); R(); } }) }], 'إجراءات صف ' + (i + 1))] }; });
    const bad = L.filter((it) => recvState(it) !== 'ok').length;
    return [TotalsBar([['المنتجات', L.length], ['متطابقة', L.length - bad, bad ? null : 'ok'], ['ناقص صورة', L.filter((it) => recvState(it) === 'img').length, null], ['ناقص داتا', L.filter((it) => recvState(it) === 'data').length, bad ? 'err' : null]]),
      h('div', { class: 'cols2-wide' }, s1, s2),
      L.length ? Card('3 · مراجعة التطابق', 'كل صف في الشيت قصاده صورته. الألوان بتتربط بجدول الألوان بالاسم (إنجليزي أو عربي).', [STable([{ l: 'صف', w: 56 }, { l: 'داتا الشيت' }, { l: 'الصورة الأساسية', w: 120 }, { l: 'مرجعية', w: 160 }, { l: 'الحالة', w: 200 }, { l: '', w: 56 }], rows, 'مراجعة التطابق'),
        L.some((it) => (it.unknownColors || []).length) ? U.InlineNote({ kind: 'warning', children: 'في ألوان مش في جدول الألوان — ضيفها من «+ لون جديد» في الخطوة الجاية أو عدّل اسمها في الشيت.', action: Button({ size: 'sm', label: '+ لون جديد', onClick: () => newColor('') }) }) : null]) : null,
      WizFoot(L.length > 0 && !L.some((it) => recvState(it) === 'img' || PD.itemIssues(it, S.state.type).length), !L.length ? 'ارفع الشيت الأول' : 'كمّل الصور والداتا الناقصة')];
  }

  // ---------------- 3 البيانات و SKU ----------------
  function newColor(seed, cb) {
    const taken = colors().map((c) => c.code); const latin = /[a-z]/i.test(seed || '');
    K.form({ title: 'لون جديد', submitLabel: 'ضيف اللون', values: { en: latin ? seed : '', ar: latin ? '' : (seed || ''), code: latin ? PD.suggestColorCode(seed, taken) : '', hex: '#b8943f', touched: false },
      note: U.InlineNote({ children: 'اللون بيتضاف لجدول ألوان السيستم، وكوده (حرفين) بيدخل في الـ SKU — مثال: IBTAR' + 'BE' + '0999.' }),
      fields: (f, e, set) => [K.two(K.field.text('en', 'اسم اللون (EN)', f, e, (k, v) => { set(k, v); if (!f.touched) { f.code = PD.suggestColorCode(v, taken); const c = document.getElementById('code'); if (c) c.value = f.code; } }, { required: true, placeholder: 'Sage Green', help: 'زي ما هيظهر على الموقع' }), K.field.text('ar', 'اسم اللون (AR)', f, e, set, { required: true, placeholder: 'أخضر زرعي' })),
        K.two(K.field.text('code', 'الكود في الـ SKU', f, e, (k, v) => { f.touched = true; set(k, String(v).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)); }, { required: true, help: 'حرفين إنجليزي — مايتكرروش', dir: 'ltr' }),
          U.FieldShell({ id: 'f-hex', label: 'شكل اللون (للعرض بس)' }, h('input', { id: 'f-hex', type: 'color', class: 'color-in', value: f.hex, onInput: (ev) => { f.hex = ev.target.value; } })))],
      validate: (f) => { const e = {}; const en = String(f.en || '').trim(); if (!/^[A-Za-z][A-Za-z &-]{1,39}$/.test(en)) e.en = 'حروف إنجليزي (2–40)'; else if (colors().some((c) => c.name_en.toLowerCase() === en.toLowerCase())) e.en = 'اللون ده موجود'; if (!String(f.ar || '').trim()) e.ar = 'اكتب الاسم بالعربي'; if (!/^[A-Z]{2}$/.test(f.code)) e.code = 'حرفين إنجليزي'; else if (taken.includes(f.code)) e.code = 'الكود ده مستخدم'; return e; },
      submit: (f) => { ST().addColor({ name_en: f.en.trim(), name_ar: f.ar.trim(), code: f.code, hex: f.hex }).then((r) => { if (!r.ok) { K.toast(r.reason === 'taken' ? 'الاسم أو الكود مستخدم' : reasonOf(r.reason), 'error'); return; } K.toast('اتضاف اللون «' + r.color.name_en + '» بالكود ' + r.color.code, 'success');
        items().forEach((it) => { const k = (it.unknownColors || []).findIndex((n) => n.toLowerCase() === r.color.name_en.toLowerCase() || n === r.color.name_ar); if (k >= 0) { it.unknownColors.splice(k, 1); if (isVar() || !it.colors.length) it.colors.push(r.color.code); syncVariations(it); } });
        if (cb) cb(r.color.code); touch(); R(); }); } });
  }
  function colorsTable() {
    const m = U.Modal({ title: 'جدول الألوان', body: [], footer: [] }); m.el.classList.add('wide');
    m.setBody(h('p', { class: 't-small help', style: 'margin:0' }, 'الـ SKU: IBT + أول حرفين من البراند + كود اللون + المسلسل · التركيبة بالمقاس: + -المقاس'), U.Table({ cls: 'dt', headers: ['اللون', 'بالعربي', 'الكود'], rows: colors().map((c) => [h('span', { class: 'col-opt' }, h('i', { class: 'sw-dot' + (c.hex ? '' : ' sw-multi'), style: c.hex ? 'background:' + c.hex : '' }), c.name_en), c.name_ar, h('b', { dir: 'ltr' }, c.code)]) }));
    m.setFooter(Button({ label: '+ لون جديد', onClick: () => { m.close(); newColor(''); } }), Button({ type: 'primary', label: 'تم', onClick: () => m.close() }));
  }
  function editItem(it) {
    const multi = isVar();
    K.form({ title: 'بيانات المنتج — ' + (it.nameEn || 'من غير اسم'), wide: true, submitLabel: 'احفظ',
      values: { nameEn: it.nameEn || '', nameAr: it.nameAr || '', colors: it.colors.slice(), sizes: it.sizes.join('، '), material: it.material || '', style: it.style || '', weight: it.weight || '', stock: it.stock == null ? '' : String(it.stock), onDemand: !!it.onDemand, vendorPrice: it.vendorPrice == null ? '' : String(it.vendorPrice) },
      fields: (f, e, set, draw) => [K.two(K.field.text('nameEn', 'الاسم (EN)', f, e, set, { required: true }), K.field.text('nameAr', 'الاسم (AR)', f, e, set)),
        U.FieldShell({ id: 'f-colors', label: multi ? 'الألوان (التركيبات)' : 'اللون', error: e.colors }, h('div', { class: 'chips' }, colors().map((c) => chipBtn(c.name_en + ' · ' + c.code, f.colors.includes(c.code), () => { f.colors = f.colors.includes(c.code) ? f.colors.filter((x) => x !== c.code) : multi ? f.colors.concat(c.code) : [c.code]; draw(); })), Button({ size: 'sm', type: 'text', label: '+ لون جديد', onClick: () => newColor('', (code) => { f.colors = multi ? f.colors.concat(code) : [code]; draw(); }) }))),
        K.two(K.field.text('sizes', multi ? 'المقاسات (افصل بـ ،)' : 'المقاس', f, e, set, { placeholder: '50×50، 40×40' }), K.field.text('vendorPrice', 'سعر المبتكر', f, e, set, { inputmode: 'numeric', required: true })),
        K.two(K.field.text('material', 'الخامة', f, e, set), K.field.text('style', 'الستايل', f, e, set)),
        K.two(K.field.text('weight', 'الوزن (كيلو)', f, e, set, { inputmode: 'decimal' }), multi ? h('div') : K.field.text('stock', 'المخزون', f, e, set, { inputmode: 'numeric', help: 'فاضي = من غير تتبع' })),
        multi ? null : K.Switch({ id: 'f-dem', label: 'حسب الطلب (بيتصنع بعد الأوردر)', checked: f.onDemand, onChange: (v) => { f.onDemand = v; } })],
      validate: (f) => { const e = {}; if (!String(f.nameEn).trim() || /[<>%]/.test(f.nameEn)) e.nameEn = 'اكتب الاسم بالإنجليزي من غير < > %'; if (/[<>%]/.test(f.nameAr)) e.nameAr = 'من غير < > %'; if (!(Number(f.vendorPrice) > 0)) e.vendorPrice = 'اكتب سعر المبتكر';
        if (f.weight && !/^\d{1,5}(\.\d{1,3})?$/.test(String(f.weight).trim())) e.weight = 'رقم بالكيلو'; if (f.stock !== '' && !/^\d+$/.test(String(f.stock).trim())) e.stock = 'رقم صحيح'; if (multi && !f.colors.length && !String(f.sizes).trim()) e.colors = 'المنتج الـ Variable محتاج ألوان أو مقاسات'; return e; },
      submit: (f) => { Object.assign(it, { nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), colors: f.colors, sizes: String(f.sizes).split(/[,،]+/).map((x) => x.trim()).filter(Boolean), material: f.material.trim(), style: f.style.trim(), weight: String(f.weight).trim(),
        stock: f.stock === '' ? null : Number(f.stock), onDemand: !!f.onDemand, vendorPrice: Number(f.vendorPrice), unknownColors: [] }); if (!multi) it.sizes = it.sizes.slice(0, 1); syncVariations(it); touch(); R(); } });
  }
  function step3() {
    const L = items(); const miss = (it) => issuesOf(it).length > 0;
    const rows = L.map((it) => ({ cls: miss(it) ? 'row-err' : null, cells: [PCell(it, [S.state.brandName + ' · ' + (it.material || '—') + ' · ' + (it.style || '—')]),
      h('span', { class: 'chips' }, it.colors.map((c) => Tag('neutral', colorLabel(c))), (it.unknownColors || []).map((n) => Tag('error', n + ' ؟'))), it.sizes.join('، ') || '—', it.weight ? it.weight + ' كجم' : h('span', { class: 'help' }, '—'),
      isVar() ? K.Num(String(it.variations.length)) : it.onDemand ? 'حسب الطلب' : it.stock == null ? '—' : K.Num(String(it.stock)),
      miss(it) ? Tag('error', issuesOf(it)[0]) : Tag('success', 'كامل'), Button({ size: 'sm', label: 'عدّل', onClick: () => editItem(it) })] }));
    const rule = h('div', { class: 'card rule' }, h('span', { class: 't-label help' }, 'قاعدة الـ SKU:'), Tag('brand', 'IBT'), Tag('gold', 'البراند (' + (PD.brandCode(S.state.brandName) || '??') + ')'), Tag('gold', 'اللون'), Tag('gold', 'المسلسل'), isVar() ? Tag('neutral', '-المقاس للتركيبة') : null, h('span', { class: 'grow' }), Button({ size: 'sm', label: 'جدول الألوان', onClick: colorsTable }), Button({ size: 'sm', label: '+ لون جديد', onClick: () => newColor('') }));
    const bad = L.filter(miss).length;
    return [TotalsBar([['المنتجات', L.length], ['ناقص', bad, bad ? 'err' : null], ['المسلسل', (PD.serialText(ST().nextSerial()) || '0999') + ' (مبدئي)']]), rule,
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: 'المنتج' }, { l: isVar() ? 'الألوان' : 'اللون', w: 200 }, { l: 'المقاس', w: 120 }, { l: 'الوزن', w: 80 }, { l: isVar() ? 'التركيبات' : 'المخزون', w: 90 }, { l: 'الحالة', w: 160 }, { l: '', w: 80 }], rows, 'البيانات و SKU'))),
      U.InlineNote({ children: 'الـ SKU النهائي بيتحجز وقت الرفع (مسلسل واحد للموقع) — اللي ظاهر هنا مبدئي.' }), WizFoot(L.length > 0 && !bad, 'كمّل الداتا الناقصة')];
  }

  // ---------------- 4 المتغيرات ----------------
  function step4() {
    const L = items(); const rows = [];
    L.forEach((it) => {
      rows.push({ cls: 'row-open', cells: [PCell(it, ['Variable · ' + it.variations.length + ' تركيبات']), null, null, null, Button({ size: 'sm', label: 'عدّل الألوان والمقاسات', onClick: () => editItem(it) })] });
      it.variations.forEach((v) => { const p = priceOf(v.vendorPrice, ensureMarkup(v)); const vin = h('input', { class: 'input vp-in', inputmode: 'numeric', value: v.vendorPrice == null ? '' : String(v.vendorPrice), 'aria-label': 'سعر المبتكر — ' + (v.color || '') + ' ' + (v.size || '') });
        vin.addEventListener('change', () => { const n = Number(vin.value); if (!(n > 0)) { vin.value = String(v.vendorPrice || ''); K.toast('اكتب سعر صحيح', 'error'); return; } v.vendorPrice = n; touch(); R(); });
        const sin = h('input', { class: 'input vp-in', inputmode: 'numeric', value: v.stock == null ? '' : String(v.stock), placeholder: '—', 'aria-label': 'المخزون' }); sin.addEventListener('change', () => { v.stock = sin.value.trim() === '' ? null : Math.max(0, parseInt(sin.value, 10) || 0); touch(); });
        rows.push({ cls: 'row-sub', cells: [h('span', { class: 'sub-name' }, '↳ ' + [v.color ? colorLabel(v.color) : '', v.size || ''].filter(Boolean).join(' · '), h('small', { dir: 'ltr', class: 'help' }, skuOf(it, { color: v.color, size: it.sizes.length ? v.size : null }).sku)),
          h('span', { class: 'sub-edit' }, vin), p ? h('span', null, h('b', { class: 'brand-t' }, U.num(K.n0(p.sale))), h('small', { class: 'help' }, ' · قبل ', U.num(K.n0(p.regular)))) : '—', h('span', { class: 'sub-edit' }, sin, K.Checkbox({ label: 'حسب الطلب', checked: !!v.onDemand, onChange: (x) => { v.onDemand = x; touch(); R(); } })), null] }); });
    });
    const n = L.reduce((s, it) => s + it.variations.length, 0); const badP = L.some((it) => it.variations.some((v) => !(v.vendorPrice > 0)));
    return [TotalsBar([['المنتجات', L.length], ['التركيبات', n]], soon('اقترح المتغيرات بالـ AI')),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: 'المنتج / التركيبة' }, { l: 'سعر المبتكر', w: 130 }, { l: 'سعر البيع', w: 170 }, { l: 'المخزون', w: 220 }, { l: '', w: 120 }], rows, 'المتغيرات'))),
      U.InlineNote({ children: 'SKU التركيبة = IBT + البراند + كود اللون + المسلسل، و«-المقاس» لو فيه مقاسات. المنتج الأساسي من غير لون.' }), WizFoot(n > 0 && !badP, 'كل تركيبة محتاجة سعر مبتكر')];
  }

  // ---------------- 5 السعر ----------------
  function step5() {
    const L = items(); const r = rateNow();
    const rows = L.map((it) => { const p = isVar() ? null : priceOf(it.vendorPrice, ensureMarkup(it));
      const vin = h('input', { class: 'input vp-in', inputmode: 'numeric', value: it.vendorPrice == null ? '' : String(it.vendorPrice), 'aria-label': 'سعر المبتكر — ' + (it.nameEn || '') });
      vin.addEventListener('change', () => { const n = Number(vin.value); if (!(n > 0)) { vin.value = String(it.vendorPrice || ''); K.toast('اكتب سعر صحيح', 'error'); return; } it.vendorPrice = n; touch(); R(); });
      const vr = isVar() ? it.variations.map((v) => priceOf(v.vendorPrice, ensureMarkup(v))).filter(Boolean) : [];
      return { cells: [selBox(it), PCell(it), isVar() ? h('span', { class: 'help' }, 'لكل تركيبة') : vin, r == null ? '—' : K.Num(r + '%'),
        isVar() ? (vr.length ? h('span', null, U.num(K.n0(Math.min(...vr.map((x) => x.sale)))), ' – ', U.num(K.n0(Math.max(...vr.map((x) => x.sale))))) : '—') : p ? h('b', { class: 'brand-t' }, U.num(K.n0(p.sale))) : '—',
        isVar() ? '—' : p ? h('span', { class: 'help' }, U.num(K.n0(p.regular)), ' (+', p.markup, '%)') : '—', isVar() ? Button({ size: 'sm', type: 'text', label: 'التركيبات', onClick: () => goStep(4) }) : Button({ size: 'sm', type: 'text', label: 'سعر قبل الخصم تاني', onClick: () => { it.markup = PD.randomMarkup(); touch(); R(); } })] }; });
    const bulk = () => K.form({ title: 'سعر المبتكر للمحدد (' + S.sel.size + ')', values: { v: '' }, fields: (f, e, set) => [K.field.text('v', 'سعر المبتكر الجديد', f, e, set, { required: true, inputmode: 'numeric' })],
      validate: (f) => (Number(f.v) > 0 ? {} : { v: 'اكتب سعر صحيح' }), submit: (f) => { sel().forEach((it) => { it.vendorPrice = Number(f.v); it.variations.forEach((v) => { v.vendorPrice = Number(f.v); }); }); touch(); R(); } });
    return [TotalsBar([['المنتجات', L.length], ['نسبة إبتكر', r == null ? '—' : r + '%'], ['الرسوم', money(feeNow())]], Button({ size: 'sm', label: 'غيّر النسبة للدفعة', onClick: changeRate })),
      Card('المعادلة (قرار 16)', null, [h('div', { class: 'formula' }, h('span', null, 'سعر البيع = (سعر المبتكر + الرسوم) ÷ (1 − نسبة إبتكر) لفوق لأقرب 10'), h('span', null, 'السعر قبل الخصم = سعر البيع + 15–30% عشوائي لفوق لأقرب 10'))]),
      BulkBar([Button({ type: 'primary', size: 'sm', icon: 'edit', label: 'عدّل سعر المبتكر للمحدد', onClick: bulk })]),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: allBox(L), w: 48 }, { l: 'المنتج' }, { l: 'سعر المبتكر', w: 130 }, { l: 'نسبة إبتكر', w: 100 }, { l: 'سعر البيع', w: 150 }, { l: 'قبل الخصم', w: 150 }, { l: '', w: 140 }], rows, 'السعر'))),
      WizFoot(r != null && L.every((it) => (isVar() ? it.variations.every((v) => v.vendorPrice > 0) : it.vendorPrice > 0)), r == null ? 'نسبة إبتكر ناقصة — «غيّر النسبة للدفعة»' : 'في سعر ناقص')];
  }

  // ---------------- 6 الصور ----------------
  function slotView(it, k, label, get, put) {
    const p = get();
    const up = () => filePick('image/*', false, async (f) => { const r = await ST().uploadImage(S.id, f[0], 'img'); if (!r.ok) { K.toast('الصورة ماترفعتش', 'error'); return; } put(r.path); touch(); R(); });
    return h('div', { class: 'islot ' + (p ? 'done' : 'empty') }, p ? h('span', { class: 'slot-img' }, Thumb(p, 'fill')) : h('span', { class: 'slot-img', role: 'img', 'aria-label': label + ' ناقصة' }, Icon('image'), h('small', null, 'ناقصة')), h('small', { class: 'slot-l' }, label),
      h('div', { class: 'slot-a' }, Button({ size: 'sm', label: p ? 'بدّل' : 'ارفع', onClick: up }), p ? U.IconButton({ icon: 'trash', label: 'شيل ' + label, onClick: () => { put(null); touch(); R(); } }) : null));
  }
  function step6() {
    const L = items(); const n = S.state.imgCount || 4; const rows = [];
    L.forEach((it) => {
      it.slots = Array.isArray(it.slots) ? it.slots : [];
      if (!it.slots[0] && it.main && !it.mainUsed) { it.slots[0] = it.main; it.mainUsed = true; }
      const cnt = it.slots.slice(0, n).filter(Boolean).length;
      rows.push({ cls: cnt ? null : 'row-err', cells: [PCell(it, [cnt + ' من ' + n + ' صور']), h('div', { class: 'ref-cell' }, Thumb(it.main, 'st-big'), h('small', { class: 't-small help' }, 'المرجعية')),
        h('div', { class: 'slots gen-slots' }, Array.from({ length: n }, (_, k) => slotView(it, k, (k + 1) + ' · ' + SLOT_L[k], () => it.slots[k] || null, (p) => { it.slots[k] = p; })))] });
      if (isVar()) it.colors.forEach((c) => rows.push({ cls: 'row-sub', cells: [h('span', { class: 'sub-name' }, '↳ ' + colorLabel(c)), null, h('div', { class: 'slots' }, slotView(it, 'c', 'صورة اللون', () => (it.colorImages || {})[c] || null, (p) => { it.colorImages = it.colorImages || {}; it.colorImages[c] = p; }))] }));
    });
    const imgs = L.reduce((s, it) => s + it.slots.slice(0, n).filter(Boolean).length, 0);
    return [TotalsBar([['المنتجات', L.length], ['الصور', imgs + ' من ' + L.length * n]], soon('ولّد الصور بالـ AI')),
      h('div', { class: 'card img-set' }, U.Select({ id: 'img-count', label: 'عدد الصور لكل منتج', options: [4, 5, 6].map((x) => ({ value: String(x), label: x + ' صور' + (x === 4 ? ' (الأساسي)' : '') })), value: String(n), onChange: (v) => { S.state.imgCount = Number(v); touch(); R(); }, help: '4 خانات أساسية + لحد 2 إضافي' }),
        h('div', { class: 'chips slot-rules' }, h('span', { class: 't-small help' }, 'الخانات:'), PD.SLOTS.map((s, k) => Tag('neutral', (k + 1) + ' · ' + s + ': ' + PD.SLOT_HINT[k])))),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: 'المنتج', w: 220 }, { l: 'المرجعية', w: 120 }, { l: 'صور المنتج (بتترفع على الموقع بالترتيب ده)' }], rows, 'الصور'))),
      U.InlineNote({ children: 'الصورة الأساسية من الاستلام اتحطت في الخانة 1 — بدّلها لو عايز. الصور بتتحول WebP وتترفع على مكتبة وسائط ووردبريس وقت الرفع.' }), WizFoot(L.every((it) => it.slots.slice(0, n).some(Boolean)), 'كل منتج محتاج صورة واحدة على الأقل')];
  }

  // ---------------- 7 الأقسام والأوصاف ----------------
  const catsAll = () => (PR() ? PR().categories() : []);
  const catPath = (id) => { const c = catsAll().find((x) => x.id === Number(id)); return c ? c.path : '#' + id; };
  // the picker (decision 14, the owner 29 Oct): the site's tree with + / − like the commission tree (main categories first), the search
  // opening the branches it finds, the chosen ones as chips on top; ticking a sub-category ticks the ones above it (PD.catToggle)
  function catsPicker(title, cur, onDone) {
    const tree = PD.catTree(catsAll().filter((c) => !/^uncategori[sz]ed$/i.test(c.name)));
    let sel = { chosen: new Set(cur || []), auto: new Set() }; let found = null;
    const open = new Set([...sel.chosen].flatMap((id) => PD.catAncestors(tree, Number(id)))); const shut = new Set();
    const m = U.Modal({ title, body: [], footer: [] }); m.el.classList.add('wide');
    const nameOf = (id) => { const c = tree.byId.get(Number(id)); return c ? c.name : catPath(id); };
    const inp = h('input', { type: 'search', class: 'input', placeholder: 'دوّر على قسم…', 'aria-label': 'دوّر على قسم' });
    const chips = h('div', { class: 'chips cat-chosen' });
    const list = h('div', { class: 'cat-tree cat-pick', role: 'group', 'aria-label': 'أقسام الموقع' });
    const refocus = (q) => { const x = list.querySelector(q); if (x) x.focus(); };
    function drawChips() {
      const L = [...sel.chosen].sort((a, b) => catPath(a).localeCompare(catPath(b)));
      chips.replaceChildren(...(L.length ? [h('span', { class: 't-small help' }, 'اخترت:')].concat(L.map((id) => h('button', { type: 'button', class: 'chip fchip', title: catPath(id), 'aria-label': 'شيل ' + nameOf(id), onClick: () => set(id, false) }, nameOf(id), Icon('close', 'sm'))))
        : [h('span', { class: 't-small help' }, 'لسه مااخترتش قسم — القسم الفرعي بيعلّم اللي فوقه لوحده')]));
    }
    // a branch shows when the search found it or something under it; under a category the search found, everything shows
    function rows(nodes, depth, all) {
      const out = [];
      for (const c of nodes) {
        if (found && !all && !found.show.has(c.id)) continue;
        const kids = tree.kids.get(c.id) || [];
        const isOpen = !shut.has(c.id) && (open.has(c.id) || (!!found && found.open.has(c.id)));
        const tog = kids.length ? h('button', { type: 'button', class: 'cat-toggle', 'aria-expanded': String(isOpen), 'aria-label': (isOpen ? 'اقفل' : 'افتح') + ' أقسام ' + c.name, 'data-cat-toggle': c.id,
          onClick: () => { if (isOpen) { open.delete(c.id); shut.add(c.id); } else { open.add(c.id); shut.delete(c.id); } drawList(); refocus('[data-cat-toggle="' + c.id + '"]'); } }, isOpen ? '−' : '+') : h('span', { class: 'cat-toggle-sp' });
        const cb = K.Checkbox({ label: c.name, checked: sel.chosen.has(c.id), onChange: (v) => set(c.id, v) });
        cb.setAttribute('data-cat-pick', String(c.id)); if (found && found.hits.has(c.id)) cb.classList.add('cat-hit');
        out.push(h('div', { class: 'cat-row', style: '--d:' + depth }, tog, cb));
        if (isOpen) out.push(...rows(kids, depth + 1, all || (!!found && found.hits.has(c.id))));
      }
      return out;
    }
    function drawList() {
      const r = rows(tree.roots, 0, false);
      list.replaceChildren(...(r.length ? r : [h('p', { class: 't-small help cat-none' }, found ? 'مافيش قسم بالاسم ده' : 'أقسام الموقع لسه ماتزامنتش — بتتجاب كل ربع ساعة.')]));
    }
    function set(id, on) { sel = PD.catToggle(tree, sel, Number(id), on); drawChips(); drawList(); refocus('[data-cat-pick="' + Number(id) + '"]'); }
    inp.addEventListener('input', () => { found = PD.catSearch(tree, inp.value); shut.clear(); drawList(); });
    drawChips(); drawList();
    m.setBody(inp, chips, list, Button({ size: 'sm', type: 'text', label: '+ قسم جديد', onClick: () => { m.close(); newCategory(); } }));
    m.setFooter(Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'تمام', onClick: () => { m.close(); onDone([...sel.chosen]); } }));
  }
  function newCategory() {
    K.form({ title: 'قسم جديد على الموقع', submitLabel: 'اعمل القسم', values: { en: '', ar: '', p: '' },
      note: U.InlineNote({ kind: 'warning', children: 'القسم بيتعمل على ووكومرس نفسه (بالإنجليزي + ترجمته العربي).' }),
      fields: (f, e, set) => [K.two(K.field.text('en', 'اسم القسم (EN)', f, e, set, { required: true }), K.field.text('ar', 'اسم القسم (AR)', f, e, set)),
        K.field.select('p', 'تحت', [{ value: '', label: '— قسم رئيسي —' }].concat(catsAll().filter((c) => !c.parentId).map((c) => ({ value: String(c.id), label: c.name }))), f, e, set)],
      validate: (f) => { const e = {}; if (!String(f.en).trim() || /[<>%]/.test(f.en)) e.en = 'اكتب الاسم من غير < > %'; if (/[<>%]/.test(f.ar)) e.ar = 'من غير < > %'; return e; },
      submit: (f) => { ST().createCategory({ name_en: f.en.trim(), name_ar: f.ar.trim(), parent: f.p ? Number(f.p) : 0 }).then((r) => { K.toast(r.ok ? 'اتعمل القسم «' + f.en.trim() + '»' : 'القسم ماتعملش — ' + reasonOf(r.reason), r.ok ? 'success' : 'error'); R(); }); } });
  }
  function editDesc(it) {
    K.form({ title: 'الوصف القصير — ' + (it.nameEn || ''), wide: true, values: { en: it.shortDesc || '', ar: it.shortDescAr || '' },
      fields: (f, e, set) => [K.field.area('en', 'الوصف القصير (EN)', f, e, set, { rows: 4 }), K.field.area('ar', 'الوصف القصير (AR)', f, e, set, { rows: 4 }), soon('اكتب بالـ AI')],
      validate: (f) => { const e = {}; ['en', 'ar'].forEach((k) => { if (/<(?!\/?(p|br|strong|b|em|i|u|ul|ol|li)\s*\/?>)/i.test(f[k])) e[k] = 'من غير HTML غير التنسيق البسيط'; }); return e; },
      submit: (f) => { it.shortDesc = f.en.trim(); it.shortDescAr = f.ar.trim(); touch(); R(); } });
  }
  function step7() {
    const L = items();
    const rows = L.map((it) => ({ cls: it.categories.length ? null : 'row-warn', cells: [selBox(it), PCell(it), h('div', { class: 'chips' }, it.categories.map((c) => Tag('neutral', catPath(c))), Button({ size: 'sm', type: 'text', label: it.categories.length ? 'عدّل' : '+ قسم', onClick: () => catsPicker('أقسام ' + (it.nameEn || ''), it.categories, (cs) => { it.categories = cs; touch(); R(); }) })),
      h('div', { class: 'desc-cell' }, it.shortDesc ? h('p', { dir: 'ltr' }, it.shortDesc) : h('span', { class: 'help' }, 'EN —'), it.shortDescAr ? h('p', null, it.shortDescAr) : h('span', { class: 'help' }, 'AR —')), Button({ size: 'sm', label: 'الوصف', onClick: () => editDesc(it) })] }));
    const missC = L.filter((it) => !it.categories.length).length;
    return [TotalsBar([['المنتجات', L.length], ['من غير قسم', missC, missC ? 'err' : null], ['من غير وصف', L.filter((it) => !it.shortDesc).length]], soon('اكتب الأوصاف بالـ AI')),
      h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), Button({ size: 'sm', label: '+ قسم جديد', onClick: newCategory })),
      BulkBar([Button({ size: 'sm', label: 'طبّق قسم على المحدد', onClick: () => catsPicker('أقسام للمحدد (' + S.sel.size + ')', [], (cs) => { sel().forEach((it) => { it.categories = [...new Set(it.categories.concat(cs))]; }); touch(); R(); }) })]),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: allBox(L), w: 48 }, { l: 'المنتج', w: 260 }, { l: 'القسم', w: 260 }, { l: 'الوصف القصير' }, { l: '', w: 90 }], rows, 'الأقسام والأوصاف'))),
      WizFoot(!missC, 'كل منتج محتاج قسم واحد على الأقل')];
  }

  // ---------------- 8 المراجعة والرفع ----------------
  function sheetRows() {
    const head = ['الاسم (EN)', 'الاسم (AR)', 'SKU', 'النوع', 'اللون', 'المقاس', 'الخامة', 'الستايل', 'الوزن', 'سعر المبتكر', 'سعر البيع', 'قبل الخصم', 'القسم', 'الوصف (EN)', 'الوصف (AR)'];
    const out = [head];
    items().forEach((it) => { const p = isVar() ? null : priceOf(it.vendorPrice, ensureMarkup(it));
      out.push([it.nameEn, it.nameAr, skuOf(it).sku, S.state.type, it.colors.map(colorLabel).join('، '), it.sizes.join('، '), it.material, it.style, it.weight, isVar() ? '' : it.vendorPrice, p ? p.sale : '', p ? p.regular : '', it.categories.map(catPath).join(' + '), it.shortDesc, it.shortDescAr]);
      if (isVar()) it.variations.forEach((v) => { const q = priceOf(v.vendorPrice, ensureMarkup(v)); out.push(['↳ ' + it.nameEn, '', skuOf(it, { color: v.color, size: it.sizes.length ? v.size : null }).sku, 'تركيبة', v.color ? colorLabel(v.color) : '', v.size || '', '', '', '', v.vendorPrice, q ? q.sale : '', q ? q.regular : '', '', '', '']); }); });
    return out;
  }
  function exportSheet() {
    const bytes = PD.xlsx(sheetRows(), 'المنتجات'); const name = PD.safeName(titleOf()) + '.xlsx';
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: name, style: 'display:none' });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    K.logEvent && K.logEvent('product.studio.export', name);
  }
  const resultOf = (i) => { const r = S.row && S.row.result && Array.isArray(S.row.result.items) ? S.row.result.items[i] : null; return r && typeof r === 'object' ? r : null; };
  function step8() {
    const L = items(); const n = S.state.imgCount || 4;
    const rows = L.map((it, i) => { const p = isVar() ? null : priceOf(it.vendorPrice, ensureMarkup(it)); const res = resultOf(i);
      return { cells: [PCell(it), isVar() ? 'Variable · ' + it.variations.length : 'Simple', h('span', { class: 't-small' }, it.colors.map(colorLabel).join('، ') || '—'), it.categories.map(catPath).join(' + ') || '—',
        isVar() ? '—' : money(it.vendorPrice), isVar() ? '—' : p ? money(p.sale) : '—', K.Num(it.slots.slice(0, n).filter(Boolean).length + ' / ' + n),
        res && res.productId && !res.error ? Tag('success', 'اترفع مسودة ✓') : res && res.error ? Tag('error', reasonOf(res.error)) : Tag('neutral', 'جاهز')] }; });
    return [TotalsBar([['المنتجات', L.length], ['التركيبات', L.reduce((s, it) => s + it.variations.length, 0)], ['الصور', L.reduce((s, it) => s + it.slots.slice(0, n).filter(Boolean).length, 0)]]),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'كل داتا المنتجات')), h('div', { class: 'sec-b' }, STable([{ l: 'المنتج' }, { l: 'النوع', w: 120 }, { l: 'اللون', w: 140 }, { l: 'القسم', w: 200 }, { l: 'سعر المبتكر', w: 110 }, { l: 'سعر البيع', w: 110 }, { l: 'الصور', w: 80 }, { l: 'الحالة', w: 170 }], rows, 'المراجعة'))),
      h('div', { class: 'grid2' }, Card('الرفع', null, [U.InlineNote({ children: 'المنتجات بتترفع مسودة (قرار صاحب المشروع) بالإنجليزي + ترجمتها العربي (WPML)، وعلى حساب المبتكر ' + (S.state.vendorName || '') + '. تراجعها على الموقع وتنشرها من السجل.' })]),
        Card('تصدير الشيت', 'Excel بكل الداتا والأسعار.', [Button({ type: 'brand', icon: 'download', label: 'صدّر الشيت (xlsx)', onClick: exportSheet })])),
      WizFoot(L.length > 0)];
  }
  // the upload (decision 7): serials for the items without one (sku_serial_take), the state saved, then one product a request
  async function uploadAll() {
    if (S.uploading || !S.id) return;
    const L = items(); const n = S.state.imgCount || 4;
    const need = L.filter((it) => it.serial == null);
    if (need.length) {
      const r = await ST().takeSerials(need.length); if (!r.ok) { K.toast('مقدرناش نحجز المسلسل — ' + reasonOf(r.reason), 'error'); return; }
      need.forEach((it, k) => { it.serial = r.first + k; });
    }
    L.forEach((it) => { it.images = it.slots.slice(0, n).filter(Boolean);
      if (!isVar()) { const p = priceOf(it.vendorPrice, ensureMarkup(it)); it.sale = p ? p.sale : null; it.regular = p ? p.regular : null; }
      else it.variations.forEach((v) => { const p = priceOf(v.vendorPrice, ensureMarkup(v)); v.sale = p ? p.sale : null; v.regular = p ? p.regular : null; v.image = v.color ? (it.colorImages || {})[v.color] || null : null; }); });
    await touch(true);
    S.uploading = true; const list = L.map((it, i) => { const r = resultOf(i); return { name: it.nameEn, st: r && r.productId && !r.error && r.author !== 'failed' && onMaker(r) ? 'ok' : 'wait', why: '' }; }); // a maker that did not stick is asked again, and so is a product on another maker than the batch's
    const m = U.Modal({ title: 'بيرفع ' + L.length + ' منتج على الموقع', body: [], footer: [] });
    const draw = () => { const d = list.filter((x) => x.st === 'ok' || x.st === 'fail').length;
      m.setBody(h('b', { class: 'brand-t' }, d + ' من ' + L.length), U.ProgressBar('brand', d / L.length), ...list.map((x) => h('div', { class: 'up-row' }, h('span', null, x.name), x.st === 'ok' ? Tag('success', 'اترفع ✓') : x.st === 'fail' ? Tag('error', x.why || 'فشل') : x.st === 'run' ? Tag('orange', 'بيرفع…') : Tag('neutral', 'في الانتظار'))),
        U.InlineNote({ children: 'الصور بتترفع على مكتبة الوسائط والمنتجات بتتحفظ مسودة. سيب الصفحة مفتوحة لحد ما يخلص.' }));
      m.setFooter(Button({ type: 'primary', label: 'شوف التقرير', disabled: d < L.length, onClick: () => { m.close(); go(hashFor('report')); } })); };
    draw();
    for (let i = 0; i < L.length; i++) {
      if (list[i].st === 'ok') continue;
      list[i].st = 'run'; draw();
      const r = await ST().upload(S.id, i);
      if (r.ok && r.result === 'skipped') { list.slice(i).forEach((x) => { if (x.st !== 'ok') { x.st = 'fail'; x.why = reasonOf(r.reason); } }); break; }
      if (!r.ok) { list[i].st = 'fail'; list[i].why = reasonOf(r.reason); if (r.reason === 'forbidden') { list.slice(i + 1).forEach((x) => { x.st = 'fail'; x.why = reasonOf('forbidden'); }); break; } }
      else if (r.result === 'error') { list[i].st = 'fail'; list[i].why = reasonOf(r.item.error); }
      else list[i].st = 'ok';
      draw();
    }
    S.uploading = false;
    const row = await ST().open(S.id); if (row) S.row = row;
    ST().load(); // the saved work shows the batch's new status
    draw(); R();
  }
  function reportView() {
    const L = items();
    const rows = L.map((it, i) => { const res = resultOf(i); const ok = res && res.productId && !res.error; const rec = ok && PR() ? PR().get(res.productId) : null;
      const notes = ok ? [res.author === 'failed' ? 'المبتكر ماتحطش — «جرّب تاني» أو حطه من لوحة WordPress' : res.author === 'no_store' ? 'المبتكر ملوش متجر على الموقع' : null, res.arId == null && it.nameAr ? 'الترجمة العربية ماتعملتش — اعملها من WPML' : null, res.variations && res.variations.failed ? res.variations.failed + ' تركيبة ماتعملتش' : null].filter(Boolean) : [];
      return { cells: [PCell(it), ok ? Tag('orange', 'مسودة') : res ? Tag('error', 'فشل') : Tag('neutral', 'ماترفعش'), ok ? (notes.length ? h('span', { class: 't-small' }, notes.join(' · ')) : h('span', { class: 'help' }, '—')) : h('span', { class: 'err-t' }, res ? reasonOf(res.error) : '—'),
        ok ? h('span', { class: 'acts-inline' }, rec && rec.permalink ? h('a', { class: 'btn btn-default sm', href: rec.permalink, target: '_blank', rel: 'noopener noreferrer' }, 'افتح على الموقع') : null, Button({ type: 'text', size: 'sm', label: 'عدّل', onClick: () => go('products-edit-' + res.productId + '-data') }), res.author === 'failed' ? Button({ type: 'text', size: 'sm', label: 'جرّب تاني', onClick: uploadAll }) : null) : Button({ size: 'sm', label: 'جرّب تاني', onClick: uploadAll })] }; });
    const okN = L.filter((_, i) => { const r = resultOf(i); return r && r.productId && !r.error; }).length;
    return [U.InlineNote({ kind: okN === L.length ? 'success' : 'warning', children: 'اترفع ' + okN + ' من ' + L.length + ' منتج مسودة على الموقع.' + (okN < L.length ? ' صلّح اللي فشل وجرّب تاني — اللي اترفع مش هيتكرر.' : ' راجعها على الموقع وانشرها من السجل.') }),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, STable([{ l: 'المنتج' }, { l: 'الحالة', w: 110 }, { l: 'ملاحظات', w: 320 }, { l: '', w: 220 }], rows, 'تقرير الرفع'))),
      h('div', { class: 'acts-inline start' }, Button({ label: 'روح للسجل', onClick: () => go('products-records') }), Button({ label: 'صدّر الشيت', onClick: exportSheet }), Button({ type: 'text', label: 'رجوع للمراجعة', onClick: () => go(hashFor(8)) }))];
  }

  // ---------------- the page ----------------
  function view(head) {
    const s = ST();
    if (!s || !s.can()) return [head, K.Empty('مش مسموحلك تضيف منتجات', 'اطلب صلاحية «إضافة منتجات» من الأدمن.')];
    s.ensure();
    if (S.err) return [head, K.Empty('الدفعة مش متاحة', S.err, Button({ size: 'sm', label: 'رجوع لإضافة', onClick: () => go('products-add') }))];
    if (S.loading || !S.state) return [head, U.InlineNote({ children: 'بنفتح الدفعة…' })];
    const title = S.report ? 'تقرير الرفع — ' + (S.state.brandName || '') : (S.state.brandName || 'دفعة جديدة') + ' — ' + (isVar() ? 'Variable' : 'Simple');
    const top = h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('small', { class: 't-small help' }, 'المنتجات › إضافة › استوديو المنتجات'), h('h1', { class: 't-h3' }, title)),
      h('div', { class: 'actions' }, Button({ type: 'text', label: 'اخرج', onClick: () => { touch(true); go('products-add'); } })));
    if (S.report) return [top, ...reportView()];
    const body = ({ 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6, 7: step7, 8: step8 })[S.step]();
    return [top, Stepper(), ...body];
  }
  // «الشغل المحفوظ» in the add tab (decision 10)
  function savedWork() {
    const s = ST(); if (!s || !s.can()) return null; s.ensure();
    const B = s.batches();
    const label = (b) => (b.status === 'done' ? Tag('success', 'اترفعت') : b.status === 'uploading' ? Tag('orange', 'اترفع جزء') : Tag('neutral', 'الخطوة ' + b.step + ' · ' + STEPS[b.step - 1]));
    return Card('الشغل المحفوظ', 'الدفعات اللي لسه بتشتغل عليها — بتتحفظ تلقائي.', [s.state() === 'loading' ? U.InlineNote({ children: 'بنحمّل…' }) : B.length ? U.Table({ cls: 'dt', headers: ['الدفعة', 'النوع', 'الحالة', 'آخر تعديل', ''],
      rows: B.map((b) => [h('b', null, b.title), b.type, label(b), h('span', { class: 't-small help', dir: 'ltr' }, String(b.updated_at || '').slice(0, 16).replace('T', ' ')),
        h('span', { class: 'acts-inline' }, Button({ size: 'sm', label: b.status === 'done' ? 'التقرير' : 'كمّل', onClick: () => go('products-studio-' + b.id + '-' + (b.status === 'done' ? 'report' : b.step)) }),
          U.IconButton({ icon: 'trash', label: 'احذف ' + b.title, onClick: () => K.confirm({ title: 'تحذف «' + b.title + '»؟', text: 'الدفعة بتختفي من الشغل المحفوظ. المنتجات اللي اترفعت على الموقع مابتتمسحش.', okLabel: 'احذف', okType: 'danger', onOk: () => s.archive(b.id) }) }))]) }) : K.Empty('مفيش شغل محفوظ', 'ابدأ دفعة جديدة من «استوديو المنتجات».')]);
  }
  document.addEventListener('ib:studio', () => { if (window.IBPages && window.IBPages.current === 'products') R(); });

  window.IBStudioView = { route, view, savedWork, start: () => { S.id = null; S.state = null; go('products-studio-new-1'); }, state: S };
})();
