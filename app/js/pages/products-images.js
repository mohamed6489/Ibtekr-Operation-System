/* «أداة الصور» (phase 5.4, plan docs/superpowers/plans/2026-10-31-phase-5-4-images.md, decision 5) — the prototype's images
   tool (artifact «نظام إبتكر», block 18) on Magnific through IBImages (the ai-images Edge Function). Tabs: صورة لصورة (a photo
   shrunk in the browser, or a product on the site by its SKU — the server fetches its photo), نص لصورة (words alone), تعديل
   الصورة (remove the background / upscale on a site product's photo); «صورة المقاس» stays soon (phase 5.5, canvas). The shared
   fields: the shape, the count (1–4), the size (IMG_SIZES or custom), the model, with the credits before the call. The results
   land in bucket ai-images under the member: a preview (signed URL), a download, and «احفظ على المنتج» through IBProducts.addImages
   (woo-sync product_images_add: products.edit, WOO_PUSH_ENABLED) after a confirmation. «سجل الصور» = the member's image runs.
   «إعدادات الصور» (the admin): this month's credits, the default model and the monthly credit cap (decision 3). The products page
   routes #products-tool-images[-<product id>] here: IBImagesView.route / view. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit;
  const { h, Icon, Button } = U;
  const IM = () => window.IBImages, PR = () => window.IBProducts;
  const R = () => window.IBPages.render('products');
  const go = (hs) => { const p = window.IBPages.all && window.IBPages.all().products; if (p && p.api && p.api.go) p.api.go(hs); else { location.hash = hs; } };
  const chipBtn = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  const Card = (title, sub, body, acts) => K.Section(title, [].concat(body).filter(Boolean), acts, { sub });
  const Tag = K.Tag;
  const safeSrc = (s) => (typeof s === 'string' && s.startsWith('https://') ? s : '');
  // a result's thumbnail: the bucket's signed URL (IBImages caches it and announces ib:images when it lands)
  const Thumb = (bucket, path) => { const u = path ? safeSrc(IM().imageUrl(bucket, path)) : ''; return u ? h('span', { class: 'thumb' }, h('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : h('span', { class: 'thumb', role: 'img', 'aria-label': path ? 'بتحمّل الصورة' : 'مفيش صورة' }, Icon('image')); };

  const TABS = [['i2i', 'صورة لصورة'], ['t2i', 'نص لصورة'], ['edit', 'تعديل الصورة'], ['size', 'صورة المقاس']];
  const EDITS = [['remove_bg', 'شيل الخلفية'], ['upscale', 'حسّن وكبّر']];
  const BGS = [['transparent', 'شفافة'], ['white', 'بيضا'], ['#f3ead9', 'كريمي']];
  const MSG = { forbidden: 'مش مسموحلك تستخدم أداة الصور', invalid: 'في بيانات مش مقبولة', missing: 'المنتج مش موجود في الكتالوج',
    not_configured: 'الـ AI للصور لسه مش متوصّل — مفتاح Magnific بيتحط في إعدادات السيرفر', ai_cap: 'وصلنا لحد كريدت الصور الشهري — كلّم الأدمن', busy: 'الـ AI للصور مشغول دلوقتي — جرّب كمان دقيقة',
    ai_error: 'الـ AI مارجّعش صورة سليمة — جرّب تاني', network: 'في مشكلة في الاتصال — جرّب تاني', refused: 'الـ AI رفض الطلب ده — غيّر الوصف أو الصورة وجرّب تاني' };
  const FIELD_MSG = { prompt: 'الوصف', image: 'الصورة', product_id: 'المنتج', size: 'المقاس', count: 'العدد', model: 'الموديل', shape: 'الشكل', paths: 'الصور' };
  const errText = (r) => (r.reason === 'invalid' && r.field ? MSG.invalid + ': ' + (FIELD_MSG[r.field] || r.field) : MSG[r.reason] || MSG.network);

  // ---------------- state ----------------
  const S = { tab: 'i2i', fromProduct: null, photo: null, photoName: '', sku: '', prompt: '', shape: 'studio', size: '700x800', width: '', height: '', count: 1, model: '', op: 'remove_bg', bg: 'transparent', scale: 2,
    running: false, err: '', result: null, sel: new Set(), saving: false, settingsRead: false };
  const reset = () => Object.assign(S, { tab: 'i2i', fromProduct: null, photo: null, photoName: '', sku: '', prompt: '', shape: 'studio', running: false, err: '', result: null, sel: new Set() });

  function route(id) {
    if (id) { if (S.fromProduct !== id) { reset(); S.fromProduct = id; } }
    else if (S.fromProduct) reset();
  }
  const hash = () => 'products-tool-images' + (S.fromProduct ? '-' + S.fromProduct : '');
  const exit = () => go(S.fromProduct ? 'products-edit-' + S.fromProduct + '-images' : 'products-add');
  const model = () => { const I = IM(); return I && I.modelOf(S.model) ? S.model : I ? I.estModel() : 'seedream-5-pro'; };
  // the default model from the settings row (the admin's choice), read once
  const readSettings = () => { const I = IM(); if (!I || S.settingsRead) return; S.settingsRead = true; I.settings().then((cfg) => { if (cfg.ok && !S.model) { S.model = cfg.model; R(); } }); };

  // the product of a SKU (or the one the tool was opened from)
  function product() {
    const P = PR(); if (!P) return null;
    if (S.fromProduct && !S.sku) { const r = P.get(S.fromProduct); if (r) S.sku = r.sku || ''; if (r && !r.sku) return r; }
    const k = S.sku.trim().toLowerCase(); if (!k) return null;
    return P.list().find((p) => (p.sku || '').toLowerCase() === k) || null;
  }
  const usesProduct = () => S.tab === 'edit' || (S.tab === 'i2i' && !S.photo);
  function problem() {
    if (S.tab === 'size') return 'صورة المقاس لسه — soon';
    if (S.tab === 't2i' && !S.prompt.trim()) return 'اكتب وصف الصورة';
    if (S.tab !== 't2i' && S.tab !== 'edit' && S.shape === 'custom' && !S.prompt.trim()) return 'الشكل المخصص محتاج وصف';
    if (usesProduct() && !product()) return S.tab === 'i2i' ? 'ارفع صورة أو اكتب SKU منتج على الموقع' : 'اكتب SKU منتج موجود على الموقع';
    if (S.size === 'custom') { const w = Number(S.width), h2 = Number(S.height); if (!(Number.isInteger(w) && Number.isInteger(h2) && w >= 256 && h2 >= 256 && w <= 4096 && h2 <= 4096 && Math.max(w, h2) / Math.min(w, h2) <= 4)) return 'المقاس المخصص 256–4096 لكل ضلع وبنسبة لحد 4:1'; }
    return '';
  }
  const credits = () => { const I = IM(); return I ? I.credits(model(), S.tab === 'edit' ? 1 : S.count) : 0; };

  // ---------------- the call ----------------
  async function run() {
    const I = IM(); if (!I || S.running) return;
    const bad = problem(); if (bad) { K.toast(bad, 'error'); return; }
    const p = usesProduct() ? product() : null;
    S.running = true; S.err = ''; S.sel = new Set(); R();
    let r;
    if (S.tab === 'edit') r = await I.edit({ productId: p.id }, S.op, { model: model(), options: S.op === 'remove_bg' ? { bg: S.bg } : { scale: S.scale } });
    else r = await I.create({ source: S.tab === 't2i' ? 'text' : 'image', prompt: S.prompt.trim(), shape: S.shape, size: S.size, width: S.width, height: S.height, count: S.count, model: model(), image: S.tab === 'i2i' && S.photo ? S.photo : null, productId: p ? p.id : null });
    S.running = false;
    if (!r.ok) { S.err = errText(r); S.result = null; K.toast(S.err, 'error'); R(); return; }
    if (r.result === 'refused') { S.err = MSG.refused; S.result = null; K.toast(S.err, 'error'); R(); return; }
    S.result = { bucket: r.bucket || 'ai-images', paths: r.paths, credits: r.credits, model: r.model, productId: p ? p.id : null, productName: p ? p.nameEn || p.nameAr : '', tab: S.tab, at: new Date().toISOString() };
    S.sel = new Set(r.paths);
    K.toast('اتعملت ' + r.paths.length + ' صورة — راجعها قبل ما تحفظها', 'success'); R();
  }

  // ---------------- a download, «احفظ على المنتج», «سجل الصور» ----------------
  async function download(path) {
    const I = IM(); const d = await I.download(S.result.bucket, path);
    if (!d.ok) { K.toast(d.reason === 'missing' ? 'الصورة دي مش موجودة' : MSG.network, 'error'); return; }
    try { const u = URL.createObjectURL(d.blob); const a = h('a', { href: u, download: path.split('/').pop() }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000); } catch (e) { K.toast('المتصفح ما سمحش بالتحميل', 'error'); }
  }
  async function saveToProduct() {
    const res = S.result; const P = PR(); const I = IM(); if (!res || !P || !I || S.saving) return;
    const paths = res.paths.filter((p) => S.sel.has(p));
    if (!paths.length) { K.toast('حدّد الصور اللي تتحفظ', 'error'); return; }
    if (!I.can().edit) { K.toast('حفظ الصور على المنتج محتاج صلاحية «تعديل المنتجات»', 'error'); return; }
    const target = res.productId ? P.get(res.productId) : product();
    if (!target) { K.toast('اكتب SKU المنتج اللي الصور تتحفظ عليه', 'error'); return; }
    const name = target.nameEn || target.nameAr || ('#' + target.id);
    let first = false;
    const m = U.Modal({ title: 'تحفظ ' + paths.length + ' صورة على «' + name + '»؟', body: [h('p', { class: 't-small', style: 'margin:0' }, 'الصور هتترفع على مكتبة وسائط الموقع وتتضاف لمعرض المنتج' + (target.imageCount ? ' (عنده ' + target.imageCount + ' صورة دلوقتي)' : '') + '.'),
      K.Checkbox({ id: 'ig-first', label: 'خليها في الأول (الأولى تبقى الصورة الرئيسية)', checked: first, onChange: (v) => { first = v; } })],
      footer: [Button({ type: 'text', label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'أيوه، احفظ على المنتج', attrs: { 'data-igsave-ok': '' }, onClick: async () => {
        m.close(); S.saving = true; R();
        const r = await P.addImages(target.id, paths, first);
        S.saving = false;
        if (!r.ok) K.toast(r.reason === 'forbidden' ? 'مش مسموحلك تعدّل المنتجات' : r.reason === 'invalid' ? MSG.invalid : r.reason === 'woo_down' ? 'الموقع مش بيرد دلوقتي — جرّب كمان شوية' : MSG.network, 'error');
        else if (r.result === 'skipped') K.toast('الكتابة على الموقع مقفولة دلوقتي — مافيش حاجة اتغيرت', 'error');
        else K.toast('اتحفظت ' + r.count + ' صورة على المنتج في ووكومرس', 'success');
        R();
      } })] });
  }
  async function openHistory() {
    const I = IM(); const r = await I.history(30);
    if (!r.ok) { K.toast(MSG.network, 'error'); return; }
    const SRC = { tool: 'أداة الصور', studio: 'الاستوديو', edit: 'تعديل' };
    const open = (x) => { m.close(); S.result = { bucket: x.bucket, paths: x.paths, credits: x.credits, model: x.model, productId: x.productId, productName: x.label, tab: S.tab, at: x.at }; S.sel = new Set(x.paths); R(); };
    const rows = r.rows.map((x) => [h('span', { class: 't-small', dir: 'ltr' }, String(x.at || '').slice(0, 16).replace('T', ' ')), x.label || '—', SRC[x.source] || x.source, h('span', { class: 'thumbs-sm' }, x.paths.slice(0, 3).map((p) => Thumb(x.bucket, p))), String(x.credits),
      x.paths.length && x.bucket === 'ai-images' ? Button({ size: 'sm', label: 'افتح', attrs: { 'data-ihopen': String(x.id) }, onClick: () => open(x) }) : h('span', { class: 'help t-small' }, x.bucket === 'studio' ? 'في الدفعة' : '—')]);
    const m = U.Modal({ title: 'سجل الصور', body: [h('p', { class: 't-small help', style: 'margin:0' }, 'آخر 30 صورة اتعملت بالـ AI (بتاعتك؛ الأدمن بيشوف الكل).'), rows.length ? U.Table({ cls: 'dt', headers: ['الوقت', 'المنتج / الوصف', 'المصدر', 'الصور', 'كريدت', ''], rows }) : K.Empty('مفيش صور لسه', 'أول ما تعمل صورة هتظهر هنا.')],
      footer: [Button({ label: 'قفل', onClick: () => m.close() })] });
  }
  // «إعدادات الصور» (decision 3, the admin): this month's credits, the default model, the monthly credit cap
  async function openSettings() {
    const I = IM(); if (!I || !I.can().settings) return;
    const [cfg, month] = await Promise.all([I.settings(), I.monthCredits()]);
    if (!cfg.ok) { K.toast(MSG.network, 'error'); return; }
    const f = { model: cfg.model, cap: cfg.monthlyCredits == null ? '' : String(cfg.monthlyCredits) }; const probe = { busy: false, out: '' };
    const spendBox = month.ok
      ? h('div', { class: 'out-b', 'data-img-spend': '' }, h('small', null, 'كريدت الشهر ده (بتوقيت القاهرة)'),
        h('p', { style: 'margin:0' }, h('b', null, String(month.total)), cfg.monthlyCredits != null ? [' من أصل ', String(cfg.monthlyCredits)] : null, ' · ', month.runs, ' صورة · ≈ $', month.usd.toFixed(2)),
        h('p', { class: 't-small help', style: 'margin:0' }, 'الاستوديو ', month.studio.credits, ' · أداة الصور ', month.tool.credits, ' · التعديلات ', month.edit.credits))
      : U.InlineNote({ kind: 'warn', children: 'مقدرناش نقرا الصرف دلوقتي.' });
    const body = () => [spendBox,
      U.Select({ id: 'img-def-model', label: 'الموديل الافتراضي', options: I.MODELS.map((x) => ({ value: x.id, label: x.name + ' — ' + x.credits + ' كريدت' })), value: f.model, help: (I.modelOf(f.model) || {}).note || '', onChange: (v) => { f.model = v; m.setBody(...body()); } }),
      U.TextInput({ id: 'img-cap', label: 'سقف الشهر بالكريدت', value: f.cap, dir: 'ltr', inputmode: 'numeric', placeholder: 'من غير سقف', help: 'لما الكريدت توصله الصور بتقف لحد أول الشهر الجاي. فاضي = من غير سقف. (1 كريدت ≈ $' + I.CREDIT_USD + ')', onInput: (v) => { f.cap = v; } }),
      U.InlineNote({ children: 'التغيير بيمشي على الصور الجاية على طول، لكل الفريق؛ موديل دفعة في الاستوديو بيتغيّر من جواها.' }),
      // T2: the connection test — the provider's account answer as keys and types only (no values), or the error with its HTTP status
      h('div', { class: 'acts-inline' }, Button({ size: 'sm', label: probe.busy ? 'بيتصل…' : 'اختبار الاتصال بـ Magnific', disabled: probe.busy, attrs: { 'data-img-probe': '' }, onClick: async () => { probe.busy = true; m.setBody(...body()); const r = await I.probe(); probe.busy = false; probe.out = r.ok ? 'متصل ✓ — شكل رد الحساب: ' + JSON.stringify(r.shape) : (MSG[r.reason] || MSG.network) + (r.status ? ' (HTTP ' + r.status + ')' : ''); m.setBody(...body()); } })),
      probe.out ? h('pre', { class: 't-small', dir: 'ltr', style: 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere', 'data-img-probe-out': '' }, probe.out) : null];
    const save = async () => {
      const r = await I.saveSettings({ model: f.model, monthlyCredits: f.cap.trim() === '' ? null : f.cap.trim() });
      if (!r.ok) { K.toast(r.reason === 'invalid' && r.field === 'monthlyCredits' ? 'السقف لازم يكون عدد كريدت صحيح أكبر من صفر' : r.reason === 'forbidden' ? 'الأدمن بس يقدر يغيّر إعدادات الصور' : MSG.network, 'error'); return; }
      S.model = f.model; m.close(); K.toast('اتحفظت إعدادات الصور', 'success'); R();
    };
    const m = U.Modal({ title: 'إعدادات الصور', body: body(), footer: [Button({ type: 'text', label: 'قفل', onClick: () => m.close() }), Button({ type: 'primary', label: 'احفظ', attrs: { 'data-img-save': '' }, onClick: save })] });
  }

  // ---------------- view ----------------
  function Drop(title, sub, onFile) {
    const inp = h('input', { type: 'file', class: 'sr-file', id: 'ig-photo', accept: 'image/jpeg,image/png,image/webp', onChange: () => { const f = inp.files && inp.files[0]; if (f) onFile(f); } });
    return h('label', { class: 'drop', for: 'ig-photo', tabindex: '0', role: 'button', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, Icon('upload'), h('b', null, title), sub ? h('small', null, sub) : null, inp);
  }
  async function takePhoto(f) {
    const p = await IM().photoOf(f);
    if (!p) { K.toast('الصورة دي مش مقروءة — جرّب JPG أو PNG', 'error'); return; }
    S.photo = p; S.photoName = f.name || 'صورة'; R();
  }
  const skuHelp = () => { const p = product(); return p ? [p.nameEn || p.nameAr, p.vendor || p.brands.join('، ') || '—', p.imageCount ? p.imageCount + ' صورة على الموقع' : 'من غير صور'].join(' · ') : S.sku.trim() ? 'مفيش منتج بالـ SKU ده' : 'اكتب الـ SKU'; };
  function hints() {
    const sku = document.getElementById('ig-sku'); const hp = sku && sku.closest('.field') && sku.closest('.field').querySelector('.help'); if (hp) hp.textContent = skuHelp();
    const note = document.querySelector('[data-igprob]'); if (note) note.textContent = problem();
    const cost = document.querySelector('[data-igcost]'); if (cost) cost.textContent = costText();
  }
  const costText = () => { const I = IM(); const n = credits(); return 'التكلفة ≈ ' + n + ' كريدت Magnific (≈ $' + I.usd(n).toFixed(2) + ') بموديل ' + ((I.modelOf(model()) || {}).name || model()); };
  const skuField = () => U.TextInput({ id: 'ig-sku', label: 'SKU المنتج على الموقع', required: S.tab === 'edit', value: S.sku, dir: 'ltr', help: skuHelp(), onInput: (v) => { S.sku = v; hints(); } });
  function sourceFields() {
    const I = IM();
    if (S.tab === 'i2i') return [S.photo ? h('div', { class: 'ig-src' }, h('img', { src: S.photo.preview, alt: S.photoName }), h('div', null, h('b', null, S.photoName), h('small', { class: 'help' }, 'الـ AI بياخد المنتج من الصورة دي ويحطه في الشكل اللي تختاره'), Button({ size: 'sm', type: 'text', label: 'شيلها', onClick: () => { S.photo = null; S.photoName = ''; R(); } })))
      : Drop('ارفع صورة المنتج', 'JPG أو PNG أو WebP — أو اكتب SKU منتج على الموقع تحت', takePhoto),
      S.photo ? null : skuField(),
      U.FieldShell({ id: 'ig-shape', label: 'الشكل' }, h('div', { class: 'chips' }, I.SHAPES.map((x) => chipBtn(x.label, S.shape === x.id, () => { S.shape = x.id; R(); }, { 'data-igshape': x.id })))),
      U.Textarea({ id: 'ig-prompt', label: S.shape === 'custom' ? 'وصف الصورة (إجباري)' : 'تفاصيل زيادة (اختياري)', value: S.prompt, rows: 2, placeholder: 'مثال: على ترابيزة خشب جنب الشباك، إضاءة دافية', onInput: (v) => { S.prompt = v; hints(); } })];
    if (S.tab === 't2i') return [U.Textarea({ id: 'ig-prompt', label: 'وصف الصورة', required: true, value: S.prompt, rows: 3, placeholder: 'مثال: شنطة مكرمية بيج على كرسي خوص في بلكونة مصرية، نور عصاري', onInput: (v) => { S.prompt = v; hints(); } }),
      U.FieldShell({ id: 'ig-shape', label: 'الشكل' }, h('div', { class: 'chips' }, I.SHAPES.map((x) => chipBtn(x.label, S.shape === x.id, () => { S.shape = x.id; R(); }, { 'data-igshape': x.id })))),
      skuField()];
    if (S.tab === 'edit') return [skuField(),
      U.FieldShell({ id: 'ig-op', label: 'التعديل' }, h('div', { class: 'chips' }, EDITS.map(([k, l]) => chipBtn(l, S.op === k, () => { S.op = k; R(); }, { 'data-igop': k })))),
      S.op === 'remove_bg' ? U.FieldShell({ id: 'ig-bg', label: 'الخلفية الجديدة' }, h('div', { class: 'chips' }, BGS.map(([k, l]) => chipBtn(l, S.bg === k, () => { S.bg = k; R(); }, { 'data-igbg': k }))))
        : U.FieldShell({ id: 'ig-scale', label: 'التكبير' }, h('div', { class: 'chips' }, [2, 4].map((n) => chipBtn(n + '×', S.scale === n, () => { S.scale = n; R(); }))))];
    return [U.InlineNote({ children: 'صورة المقاس بالأبعاد على صورة المنتج — لسه (المرحلة 5.5، من غير AI). «شيل النصوص» و«كومنتات على أجزاء الصورة» برّه دلوقتي كمان.' })];
  }
  function genFields() {
    const I = IM(); const edit = S.tab === 'edit';
    return [edit ? null : U.FieldShell({ id: 'ig-count', label: 'العدد' }, h('div', { class: 'chips' }, [1, 2, 3, 4].map((n) => chipBtn(String(n), S.count === n, () => { S.count = n; R(); }, { 'data-igcount': String(n) })))),
      h('div', { class: 'ig-row' }, edit ? null : U.Select({ id: 'ig-size', label: 'المقاس', options: I.SIZES.map((x) => ({ value: x.id, label: x.label })), value: S.size, onChange: (v) => { S.size = v; R(); } }),
        U.Select({ id: 'ig-model', label: 'الموديل', options: I.MODELS.map((x) => ({ value: x.id, label: x.name + ' — ' + x.credits + ' كريدت' })), value: model(), help: (I.modelOf(model()) || {}).note || '', onChange: (v) => { S.model = v; R(); } })),
      !edit && S.size === 'custom' ? h('div', { class: 'ig-custom' }, U.TextInput({ id: 'ig-w', label: 'العرض (px)', value: S.width, dir: 'ltr', inputmode: 'numeric', onInput: (v) => { S.width = v; hints(); } }), U.TextInput({ id: 'ig-h', label: 'الارتفاع (px)', value: S.height, dir: 'ltr', inputmode: 'numeric', onInput: (v) => { S.height = v; hints(); } })) : null,
      h('div', { class: 'ig-cost', 'data-igcost': '' }, costText())];
  }
  function inputCard() {
    const bad = problem();
    return Card(S.tab === 'edit' ? 'الصورة والتعديل' : 'المصدر والشكل', S.tab === 'i2i' ? 'المنتج بيفضل زي ما هو في صورتك، والـ AI بيغيّر المكان والإضاءة.' : S.tab === 't2i' ? 'من غير صورة مرجعية — للبوستات والتصميمات.' : S.tab === 'edit' ? 'التعديل بيتعمل على الصورة الرئيسية بتاعة المنتج على الموقع.' : null,
      [h('div', { class: 'ig-fields' }, ...sourceFields(), ...(S.tab === 'size' ? [] : genFields())),
        S.tab === 'size' ? null : Button({ type: 'primary', label: S.running ? 'بيتعمل…' : S.tab === 'edit' ? 'عدّل الصورة' : 'اعمل الصور', icon: 'sparkle', disabled: S.running || !IM(), attrs: { class: 'btn btn-primary block', 'data-igrun': '' }, onClick: run }),
        S.running || S.tab === 'size' ? null : h('p', { class: 't-small help', style: 'margin:0', 'data-igprob': '' }, bad)]);
  }
  function outCard() {
    const I = IM();
    if (S.running) return Card('الناتج', null, [U.InlineNote({ children: 'Magnific بيعمل الصور… ممكن ياخد لحد دقيقتين.' })]);
    if (!S.result) return Card('الناتج', null, [S.err ? K.Empty('مقدرناش نعمل الصور', S.err, Button({ size: 'sm', label: 'جرّب تاني', onClick: run })) : K.Empty('لسه مفيش صور', 'املا المصدر والشكل ودوس «اعمل الصور».')]);
    const res = S.result; const canSave = I.can().edit;
    const items = res.paths.map((p, i) => h('figure', { class: 'ig-it', 'data-igres': String(i) }, Thumb(res.bucket, p),
      canSave ? h('span', { class: 'ig-chk' }, K.Checkbox({ label: '', checked: S.sel.has(p), onChange: (v) => { v ? S.sel.add(p) : S.sel.delete(p); R(); } })) : null,
      h('figcaption', { class: 'ig-acts' }, Button({ size: 'sm', icon: 'download', label: 'تحميل', onClick: () => download(p) }), h('small', { class: 'help', dir: 'ltr' }, p.split('/').pop()))));
    const target = res.productId && PR() ? PR().get(res.productId) : null;
    return Card('الناتج', res.productName ? 'لـ «' + res.productName + '»' : null, [h('div', { class: 'ig-grid' }, ...items),
      h('p', { class: 't-small help', style: 'margin:0' }, 'اتعملت بـ ', h('span', { dir: 'ltr' }, res.model), ' · ', res.credits, ' كريدت (≈ $', I.usd(res.credits).toFixed(2), ')'),
      canSave ? U.InlineNote({ children: target ? 'الصور المحددة هتتحفظ على «' + (target.nameEn || target.nameAr) + '».' : 'عشان تحفظ على منتج: اكتب الـ SKU بتاعه في الخانة على الشمال.' }) : U.InlineNote({ children: 'حفظ الصور على منتج محتاج صلاحية «تعديل المنتجات» — حمّلها واستخدمها.' })],
      [Button({ size: 'sm', label: S.tab === 'edit' ? 'عدّل تاني' : 'اعمل تاني', disabled: S.running, onClick: run }),
        canSave ? Button({ type: 'primary', size: 'sm', label: S.saving ? 'بنحفظ…' : 'احفظ على المنتج (' + S.sel.size + ')', disabled: S.saving || !S.sel.size, attrs: { 'data-igsave': '' }, onClick: saveToProduct }) : null]);
  }
  function view() {
    const I = IM();
    const top = h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('small', { class: 't-small help' }, 'المنتجات › إضافة › أداة الصور'), h('h1', { class: 't-h3' }, 'الصور'),
      h('p', { class: 't-small help', style: 'margin:0' }, 'صور منتجات احترافية بالـ AI (Magnific) — من صورة أو من وصف، وتعديلات على صور الموقع.')),
      h('div', { class: 'actions' }, Button({ type: 'text', label: 'اخرج', onClick: exit }), I && I.can().tool ? Button({ label: 'سجل الصور', attrs: { 'data-ihistory': '' }, onClick: openHistory }) : null,
        I && I.can().settings ? Button({ label: 'إعدادات الصور', icon: 'gear', attrs: { 'data-img-settings': '' }, onClick: openSettings }) : null));
    if (!I || !I.can().tool) return [top, K.Empty('مش مسموحلك تستخدم أداة الصور', 'محتاج صلاحية «إضافة منتجات» أو «تعديل المنتجات».')];
    readSettings();
    const tabs = K.MainTabs({ items: TABS.map(([id, label]) => ({ id, label: id === 'size' ? label + ' — soon' : label })), active: S.tab, onChange: (id) => { S.tab = id; S.result = null; S.err = ''; R(); }, label: 'نوع الصورة' });
    return [top, tabs, h('div', { class: 'cols2-wide' }, inputCard(), outCard())];
  }
  document.addEventListener('ib:images', () => { if (window.IBPages && window.IBPages.current === 'products') R(); });

  window.IBImagesView = { route, view, hash, state: S };
})();
