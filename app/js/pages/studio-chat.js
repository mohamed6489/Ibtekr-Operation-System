/* رفع المنتجات من شات «المخزن الذكي» — سؤال وجواب (docs/superpowers/plans/2026-11-17-agents-brain.md decision 20; the owner 18 Nov:
   «عايز ارفع منتج يقولي حدد النوع الرفع صور و عايز شيت او داتا علي الواتس او شيت جاهز من مبتكر … حدد نوع المنتجات سمبل و لا فاريابل و
   بعدين يبتدي يشتغل … يطلع المعلومات جوه بوباب زي اللي بيحصل في السيستم قبل الرفع عشان لو عايز اعدل حاجة و بعديها يسالني علي الرفع او
   التحميل» و«يسالني و ما يولدش الا لما اوافق»).
   The questions are fixed here — the case, the type (and a Variable's colors / sizes for the photos and WhatsApp cases), the maker, the
   files — then the studio's own steps run on a new batch (IBFlowView.chat.run), the studio's own screens open in a popup to edit
   (chat.review), and the chat asks what next: to the site (asking first whether to generate the AI pictures — nothing is generated unless
   the member says so), the sheet to download, or to share. Nothing goes to the site without the member's button.
   IBStudioChat.create(pre) → the wizard's state; IBStudioChat.card(state, { redraw, cancel, link }) → its card in the chat.
   Safwat 25 Nov («زرار ستوب اوقف الطلب مانيوال» · «عمرك ما تخرج من صفحة المساعد»): a step stopped from the chat's «إيقاف» (the studio's
   chat.stop) says where it stopped and goes back to a place to go on from; a wizard the chat cancelled (state.cancelled) never opens a
   popup or writes a line again; «إلغاء» on the card (o.cancel) while no step runs; «افتح في الاستوديو» opens o.link's popup with the
   studio's link — the chat stays until the member presses it. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit;
  const { h, Icon, Button } = U;
  const FV = () => window.IBFlowView && window.IBFlowView.chat;
  const CASES = [['photos', 'صور وعايز شيت', 'المبتكر عنده صور بس — بنعمله الشيت بالصور جواه'], ['whatsapp', 'داتا على الواتساب', 'سكرين شوتس بالبيانات + صور المنتجات'], ['sheet', 'شيت جاهز من المبتكر', 'شيت فيه البيانات + صور المنتجات']];
  const caseName = (k) => (CASES.find((x) => x[0] === k) || [k, k])[1];
  const isImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name || '');
  const isSheet = (f) => /\.(xlsx|csv)$/i.test(f.name || '');
  const MAX_PHOTOS = 60;

  function create(pre) {
    const p = pre || {};
    const files = Array.isArray(p.files) ? p.files : []; const scr = new Set((p.screens || []).map(String));
    const st = { kase: ['photos', 'whatsapp', 'sheet'].includes(p.kase) ? p.kase : '', type: p.type === 'Variable' || p.type === 'Simple' ? p.type : '', kinds: null,
      maker: p.maker && p.maker.id ? { id: p.maker.id, name: p.maker.name } : null, sheet: null, photos: [], screens: [], phase: 'ask', log: [], err: '', res: null, next: '', up: null };
    files.forEach((f) => { if (isSheet(f) && !st.sheet) st.sheet = f; else if (isImage(f)) (scr.has(f.name) ? st.screens : st.photos).push(f); });
    return st;
  }
  // the question in front of the member now (the answered ones are lines above it)
  function current(s) {
    if (!s.kase) return 'kase';
    if (!s.type) return 'type';
    if (s.type === 'Variable' && s.kase !== 'sheet' && !s.kinds) return 'kinds';
    if (!s.maker) return 'maker';
    if (s.phase === 'ask') return 'files';
    return s.phase;
  }
  const ready = (s) => (s.kase === 'sheet' ? !!s.sheet : s.kase === 'whatsapp' ? s.screens.length > 0 : s.photos.length > 0);
  const pick = (accept, multiple, onFiles) => { const inp = h('input', { type: 'file', accept, multiple: !!multiple, hidden: true }); inp.addEventListener('change', () => { const f = [...inp.files]; inp.remove(); if (f.length) onFiles(f); }); document.body.appendChild(inp); inp.click(); };
  const Q = (text) => h('p', { class: 'sc-q' }, text);
  const done = (q, a, back) => h('div', { class: 'sc-done' }, Icon('check', 'sm'), h('span', null, q + ': '), h('b', null, a), back ? h('button', { type: 'button', class: 'sc-edit', 'aria-label': 'غيّر ' + q, onClick: back }, 'غيّر') : null);
  const opts = (list, onPick) => h('div', { class: 'sc-opts' }, list.map(([v, l, hint]) => h('button', { type: 'button', class: 'sc-opt', 'data-sc-opt': v, onClick: () => onPick(v) }, h('b', null, l), hint ? h('small', null, hint) : null)));

  const isBusy = (s) => s.phase === 'run' || s.phase === 'images' || s.phase === 'upload';
  function card(s, o) {
    const redraw = (o && o.redraw) || (() => {}); const busy = isBusy(s); s.link = (o && o.link) || null;
    const back = (f) => (busy || s.phase === 'end' ? null : () => { f(); s.phase = 'ask'; s.res = null; s.next = ''; redraw(); });
    const log = (t) => { if (s.cancelled) return; s.log.push(t); redraw(); };
    const q = current(s); const out = [];
    if (s.kase) out.push(done('الطريقة', caseName(s.kase), back(() => { s.kase = ''; s.kinds = null; })));
    if (s.type) out.push(done('النوع', s.type, back(() => { s.type = ''; s.kinds = null; })));
    if (s.kinds) out.push(done('الشكل', s.kinds.colors + ' لون × ' + s.kinds.sizes + ' مقاس لكل منتج', back(() => { s.kinds = null; })));
    if (s.maker) out.push(done('المبتكر', s.maker.name, back(() => { s.maker = null; })));
    if (q === 'kase') out.push(Q('عايز ترفع المنتجات إزاي؟'), opts(CASES, (v) => { s.kase = v; redraw(); }));
    else if (q === 'type') out.push(Q('المنتجات نوعها إيه؟'), opts([['Simple', 'Simple', 'كل منتج صف واحد بسعره وصوره'], ['Variable', 'Variable', 'منتجات بألوان و/أو مقاسات']], (v) => { s.type = v; redraw(); }));
    else if (q === 'kinds') out.push(kindsAsk(s, redraw));
    else if (q === 'maker') out.push(makerAsk(s, redraw));
    else if (q === 'files') out.push(filesAsk(s, redraw, log));
    if (s.phase !== 'ask') out.push(runView(s, redraw, log));
    const cancel = o && o.cancel && !busy && s.phase !== 'end' ? h('button', { type: 'button', class: 'sc-edit sc-cancel', 'data-sc-cancel': '', onClick: () => o.cancel() }, 'إلغاء') : null;
    return h('div', { class: 'mk-msg-req sc-card', 'data-sc': q, 'data-sc-case': s.kase || '' }, h('div', { class: 'sc-head' }, Icon('plus', 'sm'), h('b', null, 'رفع منتجات'), cancel), out);
  }
  // a Variable from photos or WhatsApp: the sheet's shape (the studio's «الشيت هيبقى عامل إزاي»)
  function kindsAsk(s, redraw) {
    const k = s.kindsDraft || (s.kindsDraft = { colors: 2, sizes: 0 });
    const row = (key, label) => h('div', { class: 'sc-kind' }, h('span', null, label), h('div', { class: 'sc-opts sm' }, [0, 1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: 'sc-opt sm' + (k[key] === n ? ' on' : ''), 'aria-pressed': String(k[key] === n), 'data-sc-kind': key + ':' + n, onClick: () => { k[key] = n; redraw(); } }, String(n)))));
    return h('div', null, Q('كل منتج فيه كام لون وكام مقاس؟'), row('colors', 'الألوان'), row('sizes', 'المقاسات'),
      Button({ size: 'sm', type: 'primary', label: 'تمام', disabled: !(k.colors || k.sizes), attrs: { 'data-sc-kinds-ok': '' }, onClick: () => { s.kinds = { colors: k.colors, sizes: k.sizes }; redraw(); } }));
  }
  function makerAsk(s, redraw) {
    const Vs = window.IBVendors; if (Vs && Vs.state && Vs.state() === 'idle') Vs.load();
    const list = Vs && Vs.store && Vs.store.all ? Vs.store.all().slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')) : [];
    const needStore = s.kase !== 'photos';
    return h('div', null, Q('المنتجات دي لأنهي مبتكر؟'),
      h('div', { class: 'sc-maker' }, U.Select({ id: 'sc-maker', label: '', placeholder: list.length ? 'اختار المبتكر — اكتب أول حروف اسمه' : 'بنحمّل المبتكرين…', value: '',
        options: list.map((x) => ({ value: x.id, label: x.name + (needStore && x.wooVendorId == null ? ' (مالوش متجر على الموقع)' : '') })),
        onChange: (v) => { const m = list.find((x) => String(x.id) === String(v)); if (!m) return; if (needStore && m.wooVendorId == null) { K.toast('المبتكر ده مالوش متجر على الموقع — اعمله متجر من ملفه الأول', 'error'); return; } s.maker = { id: m.id, name: m.name }; redraw(); } }),
      window.IBMakerAdd ? Button({ size: 'sm', icon: 'plus', label: 'مبتكر جديد', onClick: () => window.IBMakerAdd((v) => { if (v) { s.maker = { id: v.id, name: v.name }; redraw(); } }) }) : null));
  }
  function filesAsk(s, redraw, log) {
    const add = (k) => (fs) => { const good = fs.filter(k === 'sheet' ? isSheet : isImage); if (good.length < fs.length) K.toast((fs.length - good.length) + ' ملف مش ' + (k === 'sheet' ? 'شيت (xlsx أو csv)' : 'صورة') + ' — اتساب', 'warning');
      if (k === 'sheet') { if (good[0]) s.sheet = good[0]; } else s[k] = s[k].concat(good).slice(0, k === 'screens' ? 8 : MAX_PHOTOS); redraw(); };
    const box = (k, label, hint, accept, many) => { const n = k === 'sheet' ? (s.sheet ? 1 : 0) : s[k].length;
      return h('div', { class: 'sc-file' + (n ? ' on' : ''), 'data-sc-file': k }, h('span', { class: 'sc-file-t' }, h('b', null, label), h('small', { class: 'help' }, n ? (k === 'sheet' ? s.sheet.name : n + (k === 'screens' ? ' سكرين' : ' صورة')) : hint)),
        Button({ size: 'sm', icon: 'upload', label: n ? 'غيّر / زوّد' : 'اختار', attrs: { 'data-sc-pick': k }, onClick: () => pick(accept, many, add(k)) }),
        n ? h('button', { type: 'button', class: 'sc-edit', 'aria-label': 'شيل ' + label, onClick: () => { if (k === 'sheet') s.sheet = null; else s[k] = []; redraw(); } }, 'شيل') : null); };
    const boxes = s.kase === 'sheet' ? [box('sheet', 'الشيت', 'xlsx أو csv', '.xlsx,.csv', false), box('photos', 'صور المنتجات', 'رقم الصف في اسم الصورة (اختياري)', 'image/*', true)]
      : s.kase === 'whatsapp' ? [box('screens', 'السكرين شوتس', 'لحد 8 — بالترتيب', 'image/*', true), box('photos', 'صور المنتجات', 'رقم المنتج في اسم الصورة (اختياري)', 'image/*', true)]
        : [box('photos', 'صور المنتجات', 'صورة لكل منتج بالترتيب — «1-1» و«1-2» لصور نفس المنتج', 'image/*', true)];
    const el = h('div', { class: 'sc-files' }, Q('ابعتلي الملفات:'), boxes,
      Button({ type: 'primary', icon: 'sparkle', label: 'ابدأ', disabled: !ready(s), attrs: { 'data-sc-start': '' }, onClick: () => start(s, redraw, log) }));
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', (e) => { e.preventDefault(); const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])]; if (!fs.length) return;
      const sh = fs.filter(isSheet); const im = fs.filter(isImage); if (sh.length && s.kase === 'sheet') s.sheet = sh[0]; if (im.length) s.photos = s.photos.concat(im).slice(0, MAX_PHOTOS); redraw(); });
    return el;
  }
  async function start(s, redraw, log) {
    const C = FV(); if (!C) { K.toast('الاستوديو مش متاح', 'error'); return; }
    s.phase = 'run'; s.log = []; s.err = ''; redraw();
    const files = (s.sheet ? [s.sheet] : []).concat(s.photos, s.screens);
    const r = await C.run({ kase: s.kase, type: s.type, kinds: s.kinds, vendor: s.maker, files, screens: s.screens.map((f) => f.name) }, log);
    if (s.cancelled) return; s.halting = false;
    if (!r.ok && r.stopped) { s.phase = 'ask'; s.err = ''; log(r.message); return; } // the chat's «إيقاف»: the files stay, «ابدأ» again when ready
    if (!r.ok) { s.phase = 'ask'; s.err = r.message || 'حصلت مشكلة'; K.toast(s.err, 'error'); redraw(); return; }
    s.res = r; s.phase = 'review'; log('خلصت — ' + r.count + ' منتج. راجعهم في البوب أب وعدّل اللي محتاجه.'); review(s, redraw);
  }
  function review(s, redraw) { const C = FV(); if (C && !s.cancelled) C.review(() => { if (s.cancelled) return; s.phase = 'next'; s.next = ''; redraw(); }); }
  // after the review: to the site (photos and WhatsApp/sheet cases with data), the sheet down, or shared — the member picks
  function runView(s, redraw, log) {
    const C = FV(); const photosOnly = s.kase === 'photos'; const worm = () => (window.IBLoader && window.IBLoader.mark ? window.IBLoader.mark(16) : null);
    const out = [h('div', { class: 'sc-log', 'aria-live': 'polite' }, s.log.map((t, i) => h('small', { class: 'help sc-line' }, (i === s.log.length - 1 && (s.phase === 'run' || s.phase === 'images' || s.phase === 'upload')) ? worm() : Icon('check', 'sm'), h('span', null, t))),
      s.halting && isBusy(s) ? h('small', { class: 'help sc-line sc-halting', 'data-sc-halting': '' }, h('span', null, 'بوقّف — بعد الحاجة اللي في إيدي دلوقتي…')) : null)];
    if (s.phase === 'review' || s.phase === 'next' || s.phase === 'end') out.push(Button({ size: 'sm', icon: 'edit', label: 'راجع البيانات', attrs: { 'data-sc-review': '' }, onClick: () => review(s, redraw) }));
    if (s.phase === 'next') {
      if (s.next === 'site') {
        out.push(Q('أولّد صور المنتجات بالذكاء الاصطناعي الأول؟ (بيصرف كريدت صور)'), opts([['gen', 'ولّد الصور', 'الخمس لقطات لكل منتج وبعدها أسألك على الرفع'], ['own', 'ارفع بالصور اللي معاك', 'صور المبتكر زي ما هي'], ['back', 'رجوع', '']], async (v) => {
          if (v === 'back') { s.next = ''; redraw(); return; }
          if (v === 'gen') { s.phase = 'images'; log('بولّد الصور…'); const r = await C.images(); if (s.cancelled) return; s.halting = false; s.phase = 'next'; s.next = 'after-gen'; log((r.stopped ? 'وقفت التوليد — ' : '') + 'اتولّد ' + r.shots + ' صورة — شوفها في المعاينة'); if (!r.stopped) C.previewImages(); return; }
          await upload(s, redraw, log); }));
      } else if (s.next === 'after-gen') {
        out.push(Q('أرفعهم على الموقع دلوقتي؟'), opts([['up', 'ارفع على الموقع', 'مسودة على متجر المبتكر'], ['see', 'معاينة الصور', ''], ['later', 'بعدين', 'الدفعة محفوظة في «الشغل المحفوظ»']], async (v) => {
          if (v === 'see') { C.previewImages(); return; } if (v === 'later') { s.phase = 'end'; log('الدفعة محفوظة — تكمّلها من «المنتجات › إضافة › الشغل المحفوظ»'); return; }
          await upload(s, redraw, log); }));
      } else {
        out.push(Q('تحب تعمل إيه دلوقتي؟'), opts((photosOnly ? [] : [['site', 'ارفع على الموقع', 'المنتجات مسودة على متجر المبتكر']]).concat([['dl', 'تحميل الشيت', 'نسخة المبتكر أو نسخة السيستم'], ['share', 'مشاركة', 'واتساب أو إيميل أو تحميل'], ['open', 'افتح في الاستوديو', 'تكمّل الصور والرفع هناك']]), (v) => {
          if (v === 'site') { s.next = 'site'; redraw(); } else if (v === 'dl') C.download(); else if (v === 'share') C.share();
          else if (s.link) s.link({ title: 'افتح الدفعة في الاستوديو', text: 'الاستوديو صفحة تانية — بتكمّل فيه الصور والرفع، والشات هنا بيفضل زي ما هو وترجعله من «الذكاء الاصطناعي».', label: 'افتح الاستوديو', go: () => C.open() });
          else C.open(); }));
      }
    }
    if (s.up && s.up.failed && s.up.failed.length) out.push(h('div', { class: 'sc-fail' }, s.up.failed.slice(0, 5).map((x) => h('small', { class: 'err-msg' }, x))));
    return h('div', { class: 'sc-run' }, out);
  }
  async function upload(s, redraw, log) {
    const C = FV(); s.phase = 'upload'; redraw();
    const r = await C.upload(log); if (s.cancelled) return; s.halting = false; s.up = r;
    if (!r.ok && r.stopped) { s.phase = 'next'; s.next = 'after-gen'; log(r.message); return; } // the chat's «إيقاف»: what went up stays a draft
    if (!r.ok && r.gaps && r.gaps.length) { s.phase = 'next'; s.next = ''; log(r.message + ': ' + r.gaps.slice(0, 4).join('، ') + ' — كمّلهم في «راجع البيانات»'); K.toast(r.message, 'error'); return; }
    s.phase = r.ok ? 'end' : 'next'; s.next = r.ok ? '' : 'after-gen'; log(r.message); K.toast(r.message, r.ok ? 'success' : 'error');
  }

  // the chat's «إيقاف» on the step that runs (it stops after the item in hand); true when a step was running
  function stop(s) { const C = FV(); if (!isBusy(s) || !C || !C.stop || !C.stop()) return false; s.halting = true; return true; }
  window.IBStudioChat = { create, card, current, ready, busy: isBusy, stop };
})();
