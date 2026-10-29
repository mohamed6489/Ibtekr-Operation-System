/* «أداة المحتوى» (phase 5.3, plan docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md) — the prototype's contentTool
   (artifact 1793230184, block 18) on Claude through IBAI (the ai-content Edge Function). The source: the product's data, a photo
   (shrunk in the browser), or a product on the site by its SKU (the server reads the mirror; the current texts come from
   product_get). The answer shows per language and is edited in place; «احفظ على المنتج» writes the name, the descriptions and
   SEO through IBProducts.save (product_save: products.edit, WOO_PUSH_ENABLED) after a confirmation — keywords and bullets are for
   copying. «سجل المحتوى» = the last texts (ai_runs). Left out of the prototype's tool head: «احفظ وكمّل بعدين» (the history keeps
   every text). The products page routes #products-tool-content[-<product id>] here: IBContentView.route / view. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, PD = window.IbtekrProducts;
  const { h, Icon, Button } = U;
  const AI = () => window.IBAI, PR = () => window.IBProducts;
  const R = () => window.IBPages.render('products');
  const go = (hs) => { const p = window.IBPages.all && window.IBPages.all().products; if (p && p.api && p.api.go) p.api.go(hs); else { location.hash = hs; } };
  const chipBtn = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  const Card = (title, sub, body, acts) => K.Section(title, [].concat(body).filter(Boolean), acts, { sub });
  const NBSP = String.fromCharCode(160);

  const OUTS = [['name', 'الاسم'], ['short', 'وصف قصير'], ['long', 'وصف طويل'], ['keywords', 'كلمات مفتاحية'], ['bullets', '5 نقاط'], ['seo', 'SEO (عنوان + وصف)']];
  const LANGS = [['ar', 'عربي'], ['en', 'English']];
  const TONES = [['warm', 'دافي وبسيط'], ['luxury', 'فخم'], ['brief', 'مختصر جدًا']];
  const KEYS_OF = { name: ['name'], short: ['short'], long: ['long'], keywords: ['keywords'], bullets: ['bullets'], seo: ['seo_title', 'seo_description'] };
  const FIELD_L = { name: 'الاسم', short: 'وصف قصير', long: 'وصف طويل', keywords: 'كلمات مفتاحية', bullets: '5 نقاط', seo_title: 'SEO — العنوان', seo_description: 'SEO — الوصف' };
  const SAVE_L = { name: 'الاسم', short_description: 'الوصف القصير', description: 'الوصف', seo_title: 'عنوان SEO', seo_description: 'وصف SEO' };
  const SOURCE_L = { data: 'من بيانات', image: 'من صورة', product: 'من منتج على الموقع' };
  const MSG = { forbidden: 'مش مسموحلك تستخدم أداة المحتوى', invalid: 'في بيانات مش مقبولة', missing: 'المنتج مش موجود في الكتالوج',
    not_configured: 'الـ AI لسه مش متوصّل — مفتاح Claude بيتحط في إعدادات السيرفر', ai_cap: 'وصلنا لحد الـ AI الشهري — كلّم الأدمن', busy: 'الـ AI مشغول دلوقتي — جرّب كمان دقيقة',
    ai_error: 'الـ AI مارجّعش نتيجة سليمة — جرّب تاني', network: 'في مشكلة في الاتصال — جرّب تاني', refused: 'Claude رفض يكتب للبيانات دي — غيّر البيانات وجرّب تاني' };
  const FIELD_MSG = { 'data.name': 'اسم المنتج', 'data.brand': 'البراند', 'data.details': 'التفاصيل', image: 'الصورة', product_id: 'المنتج' };
  const errText = (r) => (r.reason === 'invalid' && r.field ? MSG.invalid + ': ' + (FIELD_MSG[r.field] || r.field) : MSG[r.reason] || MSG.network);

  // ---------------- state ----------------
  const blankData = () => ({ name: '', brand: '', material: '', style: '', color: '', details: '' });
  const S = { tab: 'data', fromProduct: null, data: blankData(), photo: null, photoName: '', sku: '', out: ['name', 'short', 'keywords'], langs: ['ar', 'en'], tone: 'warm',
    show: 'ar', running: false, err: '', result: null, shown: null, live: null, liveFor: null, saving: false };
  const reset = () => Object.assign(S, { tab: 'data', fromProduct: null, data: blankData(), photo: null, photoName: '', sku: '', running: false, err: '', result: null, shown: null, live: null, liveFor: null });

  function route(id) {
    if (id) { if (S.fromProduct !== id) { reset(); S.fromProduct = id; S.tab = 'site'; } }
    else if (S.fromProduct) reset();
  }
  const hash = () => 'products-tool-content' + (S.fromProduct ? '-' + S.fromProduct : '');
  const exit = () => go(S.fromProduct ? 'products-edit-' + S.fromProduct + '-desc' : 'products-add');

  // the product of the «من منتج على الموقع» tab: the one opened from its page, else the SKU typed
  function product() {
    const P = PR(); if (!P) return null;
    if (S.fromProduct && !S.sku) { const r = P.get(S.fromProduct); if (r) S.sku = r.sku || ''; if (r && !r.sku) return r; }
    const k = S.sku.trim().toLowerCase(); if (!k) return null;
    return P.list().find((p) => (p.sku || '').toLowerCase() === k) || null;
  }
  // its current texts (product_get), read once per product for the request and the Arabic translation check
  async function liveOf(id) {
    if (S.liveFor === id && S.live) return S.live;
    const r = await PR().fetchLive(id);
    if (!r.ok) return null;
    S.live = r; S.liveFor = id; return r;
  }
  const currentOf = (live) => { const p = live.product || {}; const a = live.ar || {}; const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const c = { nameEn: t(p.name, 200), nameAr: t(a.name, 200), shortEn: t(p.short_description, 3000), shortAr: t(a.short_description, 3000), longEn: t(p.description, 8000), longAr: t(a.description, 8000) };
    Object.keys(c).forEach((k) => { if (!c[k]) delete c[k]; }); return c; };

  // ---------------- writing ----------------
  function problem() {
    if (!S.out.length || !S.langs.length) return 'اختار اللي يطلع واللغة';
    if (S.tab === 'data' && !S.data.name.trim()) return 'اكتب اسم المنتج';
    if (S.tab === 'data' && !S.data.brand && PR() && PR().brands().length) return 'اختار البراند';
    if (S.tab === 'image' && !S.photo) return 'ارفع صورة المنتج';
    if (S.tab === 'site' && !product()) return 'اكتب SKU منتج موجود على الموقع';
    return '';
  }
  async function run() {
    const A = AI(); if (!A || S.running) return;
    const bad = problem(); if (bad) { K.toast(bad, 'error'); return; }
    const source = S.tab === 'site' ? 'product' : S.tab === 'image' ? 'image' : 'data';
    const req = { source, outputs: S.out.slice(), langs: S.langs.slice(), tone: S.tone };
    const d = {}; Object.keys(S.data).forEach((k) => { const v = String(S.data[k] || '').trim(); if (v) d[k] = v; });
    if (source !== 'product' && Object.keys(d).length) req.data = d;
    if (source === 'image') req.image = S.photo;
    S.running = true; S.err = ''; R();
    if (source === 'product') { const p = product(); req.productId = p.id; const live = await liveOf(p.id); if (live) req.current = currentOf(live); }
    const r = await A.write(req);
    S.running = false;
    if (!r.ok) { S.err = errText(r); K.toast(S.err, 'error'); R(); return; }
    if (r.result === 'refused') { S.err = MSG.refused; K.toast(S.err, 'error'); R(); return; }
    S.result = { out: r.out, missing: r.missing, model: r.model, cost: r.cost, source, productId: req.productId || null, langs: req.langs, outputs: req.outputs };
    S.shown = PD.aiDisplay(r.out); if (!req.langs.includes(S.show)) S.show = req.langs[0];
    K.toast('اتكتب المحتوى — راجعه قبل ما تستخدمه', 'success'); R();
  }

  // ---------------- «احفظ على المنتج» ----------------
  async function saveToProduct() {
    const res = S.result; const P = PR(); if (!res || !res.productId || !P || S.saving) return;
    const live = await liveOf(res.productId);
    if (!live) { K.toast('مقدرناش نقرا المنتج من الموقع — جرّب تاني', 'error'); return; }
    const change = PD.aiSaveChange(S.shown, !!live.ar);
    const labels = Object.keys(change.fields).map((k) => SAVE_L[k] + ' (EN)').concat(Object.keys(change.ar).map((k) => SAVE_L[k] + ' (AR)'));
    if (!labels.length) { K.toast('مافيش حاجة تتحفظ — الكلمات المفتاحية والنقاط للنسخ بس', 'error'); return; }
    const name = (live.product && live.product.name) || ('#' + res.productId);
    K.confirm({ title: 'تحفظ المحتوى على «' + name + '»؟', text: 'هيتكتب على الموقع مكان اللي موجود: ' + labels.join('، ') + '.' + (live.ar ? '' : ' المنتج ملوش ترجمة عربي، فالعربي مش هيتحفظ.'),
      okLabel: 'أيوه، احفظ على المنتج', onOk: async () => {
        S.saving = true; R();
        const r = await P.save(res.productId, { fields: change.fields, ar: change.ar });
        S.saving = false; S.live = null; S.liveFor = null;
        if (!r.ok) K.toast(r.reason === 'forbidden' ? 'مش مسموحلك تعدّل المنتجات' : r.reason === 'invalid' ? 'الموقع رفض قيمة' + (r.field ? ': ' + r.field : '') : 'مقدرناش نحفظ — جرّب تاني', 'error');
        else if (r.result === 'skipped') K.toast('الكتابة على الموقع مقفولة دلوقتي — مافيش حاجة اتغيرت', 'error');
        else K.toast('اتحفظ على المنتج في ووكومرس', 'success');
        R();
      } });
  }

  // ---------------- «سجل المحتوى» ----------------
  const outputsIn = (out) => OUTS.map(([k]) => k).filter((k) => LANGS.some(([l]) => out[l] && KEYS_OF[k].some((x) => out[l][x] != null)));
  async function openHistory() {
    const r = await AI().history(20);
    if (!r.ok) { K.toast(MSG.network, 'error'); return; }
    const open = (x) => { m.close(); S.result = { out: x.out, missing: [], model: x.model, cost: x.cost, source: x.source, productId: x.source === 'product' ? x.productId : null, langs: LANGS.map(([l]) => l).filter((l) => x.out[l]), outputs: outputsIn(x.out) };
      S.shown = PD.aiDisplay(x.out); if (!S.result.langs.includes(S.show)) S.show = S.result.langs[0] || 'ar'; R(); };
    const rows = r.rows.map((x) => [h('span', { class: 't-small', dir: 'ltr' }, String(x.at || '').slice(0, 16).replace('T', ' ')), x.label || '—', SOURCE_L[x.source] || x.source,
      LANGS.filter(([l]) => x.out[l]).map(([, n]) => n).join(' · ') || '—', Button({ size: 'sm', label: 'افتح', attrs: { 'data-hopen': String(x.id) }, onClick: () => open(x) })]);
    const m = U.Modal({ title: 'سجل المحتوى', body: [h('p', { class: 't-small help', style: 'margin:0' }, 'آخر 20 محتوى اتكتب بالـ AI.'), rows.length ? U.Table({ cls: 'dt', headers: ['الوقت', 'المنتج', 'المصدر', 'اللغة', ''], rows }) : K.Empty('مفيش محتوى لسه', 'أول ما تكتب محتوى هيظهر هنا.')],
      footer: [Button({ label: 'قفل', onClick: () => m.close() })] });
  }

  // ---------------- view ----------------
  function Drop(title, sub, onFile) {
    const inp = h('input', { type: 'file', class: 'sr-file', id: 'ct-photo', accept: 'image/jpeg,image/png,image/webp', onChange: () => { const f = inp.files && inp.files[0]; if (f) onFile(f); } });
    return h('label', { class: 'drop', for: 'ct-photo', tabindex: '0', role: 'button', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, Icon('upload'), h('b', null, title), sub ? h('small', null, sub) : null, inp);
  }
  async function takePhoto(f) {
    const p = await AI().photoOf(f);
    if (!p) { K.toast('الصورة دي مش مقروءة — جرّب JPG أو PNG', 'error'); return; }
    S.photo = p; S.photoName = f.name || 'صورة'; R();
  }
  const txt = (id, label, key, o) => U.TextInput(Object.assign({ id: 'c-' + id, label, value: S.data[key], onInput: (v) => { S.data[key] = v; hints(); } }, o || {}));
  const brandSel = (required) => { const B = (PR() ? PR().brands() : []).map((b) => b.name).sort((a, b) => a.localeCompare(b));
    return U.Select({ id: 'c-b', label: 'البراند', required: required && B.length > 0, options: [{ value: '', label: '—' }].concat(B.map((n) => ({ value: n, label: n }))), value: S.data.brand, help: 'بيفضل بالإنجليزي في الكلام', onChange: (v) => { S.data.brand = v; R(); } }); };
  function sourceFields() {
    if (S.tab === 'data') return [K.two(txt('n', 'اسم المنتج', 'name', { required: true }), brandSel(true)),
      h('div', { class: 'row cols3' }, txt('m', 'الخامة', 'material'), txt('s', 'الستايل', 'style'), txt('c', 'اللون', 'color')),
      U.Textarea({ id: 'c-x', label: 'تفاصيل زيادة', value: S.data.details, rows: 3, placeholder: 'المقاس، الاستخدام، أي حاجة مميزة…', onInput: (v) => { S.data.details = v; } })];
    if (S.tab === 'image') return [S.photo ? h('div', { class: 'ct-photo' }, h('img', { src: S.photo.preview, alt: S.photoName }), h('div', null, h('b', null, S.photoName), h('small', { class: 'help' }, 'Claude بيشوف الصورة ويكتب منها'), Button({ size: 'sm', type: 'text', label: 'شيلها', onClick: () => { S.photo = null; S.photoName = ''; R(); } })))
      : Drop('ارفع صورة المنتج', 'المساعد بيطلّع الخامة واللون والستايل من الصورة', takePhoto),
      K.two(txt('n', 'اسم المنتج (اختياري)', 'name'), brandSel(false))];
    return [U.TextInput({ id: 'c-sku', label: 'SKU المنتج', required: true, value: S.sku, dir: 'ltr', help: skuHelp(), onInput: (v) => { S.sku = v; hints(); } })];
  }
  const skuHelp = () => { const p = product(); return p ? [p.nameEn || p.nameAr, p.vendor || p.brands.join('، ') || '—', 'بيقرا بياناته من ووكومرس'].join(' · ') : S.sku.trim() ? 'مفيش منتج بالـ SKU ده' : 'اكتب الـ SKU'; };
  // typing does not redraw the page (the caret stays): the SKU's match and the missing-input note change in place
  function hints() {
    const sku = document.getElementById('c-sku'); const hp = sku && sku.closest('.field') && sku.closest('.field').querySelector('.help'); if (hp) hp.textContent = skuHelp();
    const note = document.querySelector('[data-cprob]'); if (note) note.textContent = problem();
  }
  function inputCard() {
    const A = AI(); const bad = problem();
    return Card('بيانات المنتج', 'كل ما تزود تفاصيل، الوصف يطلع أدق.', [...sourceFields(),
      U.FieldShell({ id: 'c-out', label: 'اللي يطلع' }, h('div', { class: 'chips' }, OUTS.map(([k, l]) => chipBtn(l, S.out.includes(k), () => { S.out = S.out.includes(k) ? S.out.filter((x) => x !== k) : OUTS.map(([x]) => x).filter((x) => x === k || S.out.includes(x)); R(); }, { 'data-cout': k })))),
      U.FieldShell({ id: 'c-l', label: 'اللغة' }, h('div', { class: 'chips' }, LANGS.map(([k, l]) => chipBtn(l, S.langs.includes(k), () => { S.langs = S.langs.includes(k) ? S.langs.filter((x) => x !== k) : LANGS.map(([x]) => x).filter((x) => x === k || S.langs.includes(x)); R(); }, { 'data-clang': k })))),
      U.FieldShell({ id: 'c-t', label: 'الأسلوب' }, h('div', { class: 'chips' }, TONES.map(([k, l]) => chipBtn(l, S.tone === k, () => { S.tone = k; R(); }, { 'data-ctone': k })))),
      Button({ type: 'primary', label: S.running ? 'بيكتب…' : 'اكتب المحتوى', icon: 'sparkle', disabled: S.running || !S.out.length || !S.langs.length || !A, attrs: { class: 'btn btn-primary block', 'data-cwrite': '' }, onClick: run }),
      S.running ? null : h('p', { class: 't-small help', style: 'margin:0', 'data-cprob': '' }, bad)]);
  }
  function editBox(lang, k) {
    const el = h('div', { contenteditable: 'true', dir: lang === 'en' ? 'ltr' : 'rtl', role: 'textbox', 'aria-multiline': 'true', 'aria-label': FIELD_L[k] + (lang === 'en' ? ' (EN)' : ' (AR)') });
    el.textContent = S.shown[lang][k];
    el.addEventListener('input', () => { S.shown[lang][k] = el.innerText.split(NBSP).join(' '); });
    return el;
  }
  function outCard() {
    if (S.running) return Card('الناتج', null, [U.InlineNote({ children: 'Claude بيكتب المحتوى… ممكن ياخد لحد دقيقة.' })]);
    if (!S.result) return Card('الناتج', null, [S.err ? K.Empty('مقدرناش نكتب المحتوى', S.err, Button({ size: 'sm', label: 'جرّب تاني', onClick: run })) : K.Empty('لسه مفيش محتوى', 'املا البيانات ودوس «اكتب المحتوى».')]);
    const res = S.result; const lang = S.show; const shown = (S.shown && S.shown[lang]) || {};
    const keys = res.outputs.flatMap((o) => KEYS_OF[o]);
    const blocks = keys.map((k) => h('div', { class: 'out-b', 'data-out': lang + '.' + k }, h('small', null, FIELD_L[k]), shown[k] != null ? editBox(lang, k) : h('div', { class: 'out-miss t-small help' }, 'مااتكتبش — دوس «اكتب تاني»')));
    const copy = () => { const t = keys.filter((k) => shown[k]).map((k) => FIELD_L[k] + ':\n' + shown[k]).join('\n\n'); try { navigator.clipboard.writeText(t); K.toast('اتنسخ'); } catch (e) { K.toast('مقدرناش ننسخ — حدّد النص وانسخه', 'error'); } };
    const canSave = res.source === 'product' && res.productId && AI() && AI().can().save;
    return Card('الناتج', null, [h('div', { class: 'chips', role: 'group', 'aria-label': 'لغة الناتج' }, LANGS.filter(([l]) => res.langs.includes(l)).map(([l, n]) => chipBtn(n, S.show === l, () => { S.show = l; R(); }, { 'data-cshow': l }))),
      ...blocks,
      res.missing.length ? U.InlineNote({ kind: 'warn', children: 'مااتكتبش كويس: ' + res.missing.map((x) => { const [l, k] = x.split('.'); return FIELD_L[k] + (l === 'en' ? ' (EN)' : ' (AR)'); }).join('، ') }) : null,
      U.InlineNote({ children: 'اسم البراند بيفضل بالإنجليزي · من غير وعود مش حقيقية · تقدر تعدّل النص مباشرة.' }),
      res.model ? h('p', { class: 't-small help', style: 'margin:0' }, 'اتكتب بـ ', h('span', { dir: 'ltr' }, res.model), res.cost ? ' · التكلفة ≈ ' : null, res.cost ? h('span', { dir: 'ltr' }, '$' + res.cost.toFixed(3)) : null) : null],
      [Button({ size: 'sm', label: 'اكتب تاني', disabled: S.running, onClick: run }), Button({ size: 'sm', label: 'نسخ', icon: 'copy', onClick: copy }),
        canSave ? Button({ type: 'primary', size: 'sm', label: S.saving ? 'بنحفظ…' : 'احفظ على المنتج', disabled: S.saving, attrs: { 'data-csave': '' }, onClick: saveToProduct }) : null]);
  }
  function view() {
    const A = AI();
    const top = h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('small', { class: 't-small help' }, 'المنتجات › إضافة › أداة المحتوى'), h('h1', { class: 't-h3' }, 'المحتوى'),
      h('p', { class: 't-small help', style: 'margin:0' }, 'اسم ووصف وكلمات مفتاحية بالعربي والإنجليزي، بأسلوب إبتكر.')),
      h('div', { class: 'actions' }, Button({ type: 'text', label: 'اخرج', onClick: exit }), A && A.can().write ? Button({ label: 'سجل المحتوى', attrs: { 'data-chistory': '' }, onClick: openHistory }) : null));
    if (!A || !A.can().write) return [top, K.Empty('مش مسموحلك تستخدم أداة المحتوى', 'محتاج صلاحية «إضافة منتجات» أو «تعديل المنتجات».')];
    const tabs = K.MainTabs({ items: [{ id: 'data', label: 'من بيانات' }, { id: 'image', label: 'من صورة' }, { id: 'site', label: 'من منتج على الموقع' }], active: S.tab, onChange: (id) => { S.tab = id; R(); }, label: 'مصدر المحتوى' });
    return [top, tabs, h('div', { class: 'cols2-wide' }, inputCard(), outCard())];
  }

  window.IBContentView = { route, view, hash, state: S };
})();
