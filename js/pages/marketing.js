/* «التسويق» — phase 9.5.1 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md): the v5's marketing page (artifact «نظام إبتكر»,
   the prototype's block 19) on our data — IBMarketing (app/js/adapter/marketing.js) and its domain IbtekrCampWiz
   (app/js/pages/marketing-domain.js). Not a block: loaded before block 28 so boot() gives it its <main>.
   9.5.1 (decisions 5, 8–18): «إنشاء» — the campaign card and «آخر الشغل» —, the campaign in four steps (the images with Magnific's
   credits through ai-images, the texts with Claude through ai-content, the review with pins on the image, the schedule and the ZIP
   download), «سجل النشر», «الخطة الإعلانية» and «قوالب التصميم». «نظرة عامة», «مساعدين الذكاء الاصطناعي» and «التقارير» are
   «قريبًا» at first (opened in 9.5.3 / 9.5.4), and so was the video (9.5.5).
   9.5.2 (decisions 29–39): publishing to Facebook and Instagram through mkt-publish — the connection card with the master switch
   (the admin's), «انشر / داونلود» per piece and «انشر المحدد» (the JPEG copies made at «تأكيد النشر»), «انشر دلوقتي» and «احذف
   البوست» in the post's popup, the numbers (views, engagement, likes / comments / shares / saves), and the platform's own posts in
   the log and the plan («من المنصة مباشرة», the source filter). A post can still be published by hand and marked «اتنشر».
   9.5.3 (decisions 42–48): «نظرة عامة» and «التقارير» on Meta Ads' own numbers (mkt-ads, read-only) next to WooCommerce's orders
   from the ads (the order's UTM), in the reports page's period — the KPIs, the media buyer's alerts (rules, no action), the real
   return of 5 weeks, the campaigns day by day and the creatives; the reports page's «الحملات الإعلانية» draws the same blocks. */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, PD = window.IbtekrProducts, W = window.IbtekrCampWiz;
  if (!U || !K || !W || !window.IBPages) return;
  const { h, Icon, Button } = U;
  const MK = () => window.IBMarketing;
  const can = () => (MK() ? MK().can() : { view: false, create: false, publish: false });
  const R = () => window.IBPages.render('marketing');
  const IMGM = () => (window.IBImages && Array.isArray(window.IBImages.MODELS) ? window.IBImages.MODELS : []);
  const Tag = K.Tag;
  const chip = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  const Card = (title, sub, body, acts, cls) => K.Section(title, [].concat(body).filter(Boolean), acts, { sub, cls });
  const soonTag = () => h('span', { class: 'soon', 'data-soon': '' }, 'قريبًا');
  // Cairo's day and hour (the schedule's clock — the kit's TODAY is the prototype's date)
  const fmtC = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const cairo = () => { const p = Object.fromEntries(fmtC.formatToParts(new Date()).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
  const TODAY = () => cairo().day; const NOW = () => cairo().hm;
  // an image of the bucket «marketing» by its path (a signed link, cached by the adapter)
  function Img(path, cls, alt) {
    if (!path) return h('span', { class: 'thumb ' + (cls || ''), role: 'img', 'aria-label': 'مفيش صورة' }, Icon('image', 'sm'));
    const im = h('img', { alt: alt || '', loading: 'lazy', 'data-mk-path': path });
    const u = MK() && MK().cachedUrl(path); if (u) im.src = u; else if (MK()) MK().url(path).then((x) => { if (x) im.src = x; });
    return h('span', { class: 'thumb ' + (cls || '') }, im);
  }
  const mdlName = (id) => (IMGM().find((x) => x.id === id) || { name: id }).name;
  const szName = (id) => ((PD.IMG_SIZES.find((x) => x.id === id) || {}).label || id);
  const SZ = () => PD.IMG_SIZES.map((x) => ({ value: x.id, label: x.label }));
  const szCls = (id) => (/1080x1080/.test(id) ? ' sq' : /1920/.test(id) ? ' story' : /1500/.test(id) ? ' pin' : /630|627|624|900|720/.test(id) ? ' wide' : '');
  const D2 = W.D2;
  const isAdmin = () => { const D = window.IBDirectory; const m = D && D.me && D.me(); return !!m && m.role_id === 'admin'; };

  // ---------- the connection (9.5.2, decisions 30–31): mkt-publish's status, loaded once and redrawn when it comes ----------
  const conn = () => (MK() && MK().connNow ? MK().connNow() : null);
  let connAsk = 0;
  function needConn() {
    const cn = conn(); if (cn || !MK() || !MK().connection) return cn;
    if (Date.now() - connAsk > 15000) { connAsk = Date.now(); MK().connection().then((r) => { if (r && r.ok && window.IBPages.current === 'marketing' && !document.querySelector('.scrim')) R(); }); }
    return null;
  }
  const PL_TAG = (pl, cn) => {
    if (!W.PUBLISHABLE.includes(pl)) return Tag('neutral', 'مش مربوط — داونلود بس');
    if (!cn) return Tag('neutral', 'بيتحمّل…');
    const c2 = cn[W.PL_KEY[pl]];
    if (!c2 || !c2.linked) return Tag('neutral', 'مش مربوط — داونلود بس');
    if (!c2.publish) return Tag('orange', 'مربوط — محتاج صلاحية النشر');
    return Tag('success', 'مربوط للنشر' + (c2.name ? ' · ' + c2.name : ''));
  };
  function toggleAuto(on) {
    K.confirm({ title: on ? 'تشغّل النشر التلقائي؟' : 'توقّف النشر التلقائي؟',
      text: on ? 'البوستات المجدولة اللي عليها «انشر» هتتنشر على صفحة الفيسبوك وحساب الانستجرام في مواعيدها، و«انشر دلوقتي» هيشتغل.' : 'مفيش بوست هيتنشر من السيستم لحد ما تشغّله تاني — المجدول بيفضل مستني في السجل.',
      okLabel: on ? 'شغّل النشر' : 'وقّف النشر', okType: on ? 'primary' : 'danger',
      onOk: async () => { const r = await MK().setAutopublish(on); K.toast(r.ok ? (on ? 'النشر التلقائي اشتغل' : 'النشر التلقائي وقف') : r.message, r.ok ? 'success' : 'error'); R(); } });
  }
  // «الربط بالمنصات» (the v5's card): each platform's state, the switch (the admin turns it), a link that misses the publishing permission
  function connCard(acts) {
    const cn = needConn();
    const needs = cn && W.PUBLISHABLE.some((pl) => { const c2 = cn[W.PL_KEY[pl]]; return c2 && c2.linked && !c2.publish; });
    return Card('الربط بالمنصات', 'فيسبوك وانستجرام من ربط الصفحة في «خدمة العملاء › القنوات» · تيك توك مالوش API نشر — داونلود بس (أرقام إعلاناته من «نظرة عامة › حالة الربط»)', [
      h('div', { class: 'conn-row', 'data-mk-conn': '' }, W.PLATFORMS.map((n) => h('div', { class: 'conn', 'data-conn-pl': n }, h('b', null, n), PL_TAG(n, cn)))),
      cn ? h('div', { class: 'mk-auto', 'data-mk-auto': cn.autopublish ? 'on' : 'off' }, Tag(cn.autopublish ? 'success' : 'neutral', cn.autopublish ? 'النشر التلقائي شغّال' : 'النشر التلقائي متوقف'),
        h('span', { class: 't-small help' }, cn.autopublish ? 'البوستات اللي عليها «انشر» بتتنشر لوحدها في ميعادها' : 'وهو متوقف مفيش بوست بيتنشر من السيستم — داونلود بس'),
        isAdmin() ? Button({ size: 'sm', type: cn.autopublish ? 'default' : 'primary', label: cn.autopublish ? 'وقّف النشر التلقائي' : 'شغّل النشر التلقائي', attrs: { 'data-mk-auto-toggle': '' }, onClick: () => toggleAuto(!cn.autopublish) }) : null) : null,
      needs ? U.InlineNote({ kind: 'warning', children: 'الربط محتاج صلاحية النشر والأرقام — الأدمن يربط نفس الصفحة تاني مرة واحدة ويوافق على الصلاحيات الجديدة (الرسايل في خدمة العملاء مابتقفش).',
        action: isAdmin() ? Button({ type: 'text', size: 'sm', label: 'اربط تاني', attrs: { 'data-mk-relink': '' }, onClick: relink }) : null }) : null], acts);
  }
  // the same page linked again (cs-channel connect_start — the dialog asks for the publishing permissions too); the messages never stop meanwhile
  async function relink() {
    const r = window.IBCS ? await window.IBCS.connectStart('messenger') : { ok: false, reason: 'network' };
    if (r.ok) { location.assign(r.url); return; }
    K.toast(r.reason === 'not_configured' ? 'تطبيق Meta لسه مش متظبط على السيرفر (الأسرار ناقصة)' : r.reason === 'forbidden' ? 'الأدمن بس يقدر يربط الصفحة' : 'حصلت مشكلة في الاتصال — جرّب تاني', 'error');
  }
  const pieceText = (p) => ({ caption: p.caption || camp.w.idea, tags: p.tags || W.TAGS });
  const pubOf = (p, pl, cn) => W.publishable(W.postKind(p), W.pubImages(p), pl, cn, pieceText(p));

  // ---------- the page's state ----------
  // 9.5.3: «نظرة عامة» and «التقارير» are on the ads numbers; 9.5.4: the assistants (the media buyer, the designer, the developer) are open
  const TABS = [['overview', 'نظرة عامة'], ['create', 'إنشاء'], ['publog', 'سجل النشر'], ['calendar', 'الخطة الإعلانية'], ['templates', 'قوالب التصميم'], ['ai', 'مساعدين الذكاء الاصطناعي'], ['reports', 'التقارير']];
  const CSTEPS = ['تفاصيل الكامبين', 'البناء', 'المراجعة', 'النشر والتحميل'];
  const st = { tab: 'overview', view: 'hub', step: 1 }; // the v6 prototype (owner 11 Nov): the page opens on «نظرة عامة»
  const blankCamp = () => ({ id: null, w: W.defaults(), pieces: [], sched: {}, rtab: 'post', tried1: false, pubSel: new Set(), busy: {}, vjobs: {}, vurl: {} });
  const camp = blankCamp();
  const M = { plq: '', tplk: 'all', tplq: '', plat: 'all' }; // the tabs' filters; plat = the header's ad platform (the v6 prototype)

  function route(hs) {
    let m;
    if ((m = /^marketing(?:-(overview|create|publog|calendar|templates|ai|reports))?$/.exec(hs))) { st.tab = m[1] || 'overview'; st.view = 'hub'; return true; }
    if ((m = /^marketing-campaign-([1-4])$/.exec(hs))) { st.tab = 'create'; st.view = 'campaign'; st.step = Number(m[1]); return true; }
    return false;
  }
  const defaultHash = () => (st.view === 'campaign' ? 'marketing-campaign-' + st.step : 'marketing-' + st.tab);
  const go = (hs) => {
    const was = st.view === 'campaign' ? st.step : null;
    try { history.replaceState(null, '', '#' + hs); } catch (e) { /* sandboxed */ }
    route(hs);
    if (st.view === 'campaign' && camp.id && was !== st.step) persist(0);
    if (st.view !== 'campaign' && camp.id && MK()) MK().flush(camp.id);
    R(); window.scrollTo(0, 0);
  };

  // ---------- the campaign row (decision 7): created on the first need, autosaved while it is edited ----------
  const snapshot = () => ({ w: camp.w, pieces: camp.pieces, sched: camp.sched, rtab: camp.rtab });
  const fields = () => ({ name: W.campaignName(camp.w.idea), goal: camp.w.goal, step: st.step, state: snapshot() });
  const persist = (ms) => { if (camp.id && can().create && MK()) MK().saveSoon(camp.id, fields, ms == null ? 1200 : ms); };
  async function ensureCampaign() {
    if (camp.id) return true;
    if (!can().create) { K.toast('مفيش صلاحية إنشاء كامبين', 'error'); return false; }
    const r = await MK().create(fields());
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    camp.id = r.id; return true;
  }
  function startCampaign() { Object.assign(camp, blankCamp()); go('marketing-campaign-1'); }
  // 9.5.5 decision 62: the video tool is a campaign with one video and nothing else
  function startVideo() { Object.assign(camp, blankCamp()); camp.w.mediaTab = 'video'; camp.w.media.video.count = 1; camp.w.media.post.count = 0; camp.w.media.carousel.count = 0; go('marketing-campaign-1'); }
  async function openCampaign(id) {
    const r = await MK().open(id); if (!r.ok) { K.toast(r.message, 'error'); return; }
    const s = r.campaign.state || {};
    Object.assign(camp, blankCamp(), { id, w: Object.assign(W.defaults(), s.w || {}), pieces: Array.isArray(s.pieces) ? s.pieces : [], sched: s.sched || {}, rtab: s.rtab || 'post' });
    go('marketing-campaign-' + Math.max(1, Math.min(4, r.campaign.step || 1)));
  }

  // ---------- the wallet and the cost before every generation (decision 11) ----------
  const wallet = () => (MK() && MK().wallet()) || { cap: null, used: 0, balance: null };
  const Wallet = () => { const w = wallet(); return h('span', { class: 'cw-wallet', 'data-cw-balance': w.balance == null ? 'none' : String(w.balance), title: 'كريدت الصور للشهر ده (Magnific API)' }, Icon('sparkle', 'sm'),
    h('span', null, w.balance == null ? 'اتصرف الشهر ده: ' : 'رصيدك: '), K.Num(K.n0(w.balance == null ? w.used : w.balance) + ' كريديت')); };
  const kvc = (l, v) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, l), h('b', null, K.Num(v)));
  function pay(what, n, run) {
    const w = wallet();
    if (w.balance != null && n > w.balance) { K.toast('رصيدك ' + K.n0(w.balance) + ' كريديت — مش كفاية لـ ' + what + ' (' + K.n0(n) + ' كريديت)', 'error'); return; }
    K.confirm({ title: what, okLabel: 'ولّد‏ · ' + K.n0(n) + ' كريديت',
      body: h('div', { class: 'cw-cost', 'data-cw-cost': String(n) }, h('div', { class: 'kvg' }, kvc('التكلفة', K.n0(n) + ' كريديت'),
        w.balance != null ? kvc('رصيدك دلوقتي', K.n0(w.balance) + ' كريديت') : kvc('اتصرف الشهر ده', K.n0(w.used) + ' كريديت'),
        w.balance != null ? kvc('هيفضل بعد التوليد', K.n0(w.balance - n) + ' كريديت') : null),
        h('p', { class: 't-small help', style: 'margin:8px 0 0' }, 'من كريدت Magnific API — السيرفر بيوقف لو سقف الشهر خلص.')),
      onOk: () => { run(); } });
  }
  const costBtn = (label, n, run, attrs, type, disabled) => Button({ type: type || 'primary', size: 'sm', icon: 'sparkle', label: label + '‏ · ' + K.n0(n) + ' كريديت', attrs, disabled: !!disabled || !can().create, onClick: () => pay(label, n, run) });
  // the AI writing costs no credit (decision 10): a plain button, busy while it runs
  function aiBtn(label, run, attrs) {
    const b = Button({ size: 'sm', icon: 'sparkle', label, attrs, disabled: !can().create, onClick: async () => { b.disabled = true; b.classList.add('busy'); try { await run(); } finally { b.disabled = false; b.classList.remove('busy'); R(); } } });
    return b;
  }

  // ---------- the wizard's frame (v5) ----------
  function Stepper(steps, cur, base) {
    return h('ol', { class: 'wstepper card', 'aria-label': 'الخطوات' }, steps.map((s, i) => { const n = i + 1; const state = n < cur ? 'done' : n === cur ? 'cur' : 'up';
      return h('li', { class: 'stp stp-' + state, 'aria-current': state === 'cur' ? 'step' : false }, h('button', { type: 'button', class: 'stp-b', disabled: n > cur, onClick: () => go(base + n), 'aria-label': 'الخطوة ' + n + ': ' + s }, h('span', { class: 'stp-n' }, state === 'done' ? Icon('check', 'sm') : K.Num(String(n))), h('span', { class: 'stp-l' }, s))); }));
  }
  const Foot = (cur, total, back, nextLabel, next, disabled) => h('div', { class: 'wiz-foot card' }, h('span', { class: 't-small help' }, 'الخطوة ' + cur + ' من ' + total), h('span', { class: 'grow' }), cur > 1 ? Button({ label: 'رجوع', onClick: back }) : null, Button({ type: 'primary', label: nextLabel, disabled, onClick: next, attrs: { class: 'btn btn-primary cp-next' } }));
  const cback = () => go('marketing-campaign-' + Math.max(1, st.step - 1));

  // ---------- files and links (decision 13) — the same control everywhere ----------
  const fileIcon = (f) => (f.t === 'product' ? 'package' : f.t === 'tpl' ? 'copy' : 'file');
  function Files(id, label, arr, help, tplKind) {
    const li = h('input', { type: 'text', class: 'input grow', dir: 'auto', placeholder: 'لينك منتج من الموقع أو الـ SKU', 'aria-label': label + ' — لينك', id: id + '-l' });
    const add = async () => { const v = li.value.trim(); if (!v) return; const r = await MK().product(v); if (!r.ok) { K.toast(r.message, 'error'); return; }
      if (!arr.some((f) => f.t === 'product' && f.id === r.product.id)) arr.push({ t: 'product', id: r.product.id, name: r.product.name }); li.value = ''; persist(); R(); };
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const up = h('input', { type: 'file', class: 'sr-file', id: id + '-f', multiple: true, accept: 'image/png,image/jpeg,image/webp', onChange: async () => {
      const list = [...up.files]; up.value = ''; if (!list.length || !(await ensureCampaign())) return;
      for (const f of list) { const r = await MK().upload(camp.id, f); if (!r.ok) { K.toast(r.message, 'error'); continue; } arr.push({ t: 'file', name: r.name, path: r.path }); }
      persist(); R(); } });
    const off = !can().create;
    return U.FieldShell({ id: id + '-l', label, help }, h('div', { class: 'cw-files', 'data-cw-files': id },
      off ? null : h('div', { class: 'cw-add' }, h('label', { class: 'btn btn-default sm', for: id + '-f', tabindex: '0', role: 'button', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); up.click(); } } }, Icon('upload', 'sm'), h('span', null, 'ارفع')), up, li, Button({ size: 'sm', label: 'ضيف', onClick: add }),
        tplKind ? Button({ size: 'sm', type: 'text', label: 'من قوالب التصميم', attrs: { 'data-tpl-from': id }, onClick: () => pickTpl(tplKind, arr) }) : null),
      arr.length ? h('div', { class: 'cw-chips' }, arr.map((f, i) => h('span', { class: 'cw-f' }, Icon(fileIcon(f), 'sm'), h('span', { class: 'cw-fn', dir: 'auto' }, f.name), off ? null : U.IconButton({ icon: 'close', label: 'شيل ' + f.name, onClick: () => { arr.splice(i, 1); persist(); R(); } })))) : null));
  }
  const num = (id, label, val, max, set, min, disabled) => { const inp = h('input', { type: 'text', inputmode: 'numeric', id, class: 'cnt-in', value: String(val), 'aria-label': label, disabled: disabled || null });
    inp.addEventListener('change', () => { set(W.clamp(String(inp.value).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))), min || 0, max)); persist(); R(); });
    const b = (s, d) => Button({ size: 'sm', label: s, attrs: { 'aria-label': (d > 0 ? 'زوّد ' : 'قلّل ') + label, 'data-num': id + (d > 0 ? '+' : '-') }, disabled: disabled || (d > 0 ? val >= max : val <= (min || 0)), onClick: () => { set(W.clamp(val + d, min || 0, max)); persist(); R(); } });
    return h('div', { class: 'counter' }, h('label', { class: 't-label', for: id }, label), h('div', { class: 'cnt-ctl' }, b('+', 1), inp, b('−', -1))); };
  const modelSel = (id, val, set) => U.Select({ id, label: 'الموديل', value: val, onChange: (v) => { set(v); persist(); R(); },
    options: IMGM().map((x) => ({ value: x.id, label: x.name + ' · ' + K.n0(x.credits) + ' كريديت/صورة' })), help: (IMGM().find((x) => x.id === val) || {}).note || '' });
  // 9.5.5: the video models of the catalog (on the linked Magnific account — the seconds an estimate, not the image wallet)
  const vmodelSel = (id, val, set) => U.Select({ id, label: 'الموديل', value: val, onChange: (v) => { set(v); persist(); R(); },
    options: PD.VIDEO_MODELS.map((x) => ({ value: x.id, label: x.name + ' · ≈ ' + K.n0(W.videoRate(x.id)) + ' كريديت/ثانية (تقدير)' })), help: ((PD.VIDEO_MODELS.find((x) => x.id === val) || {}).note || '') + ' الكريدت تقدير تقريبي — الصرف الفعلي على حساب Magnific المربوط.' });
  const VCAMS = ['ثابتة', 'زوم بطيء', 'تحريك يمين', 'تحريك شمال', 'ماكرو', 'من فوق', 'دوران'];
  const vmdlName = (id) => ((PD.VIDEO_MODELS.find((x) => x.id === id) || { name: id }).name);

  // ---------- «إعادة كتابة بالـ AI» in a field (decision 10: Claude, no credit) + «تراجع» ----------
  const KINDS = ['general', 'idea', 'caption', 'title', 'sub', 'badge', 'notes', 'desc'];
  function aiField(el, kind, ctx) {
    const inp = el && (el.matches && el.matches('textarea,input') ? el : el.querySelector && el.querySelector('textarea, input'));
    if (!inp || !KINDS.includes(kind) || !can().create) return el;
    const box = h('div', { class: 'ai-fld' + (inp.tagName === 'INPUT' ? ' one' : '') }); inp.replaceWith(box); box.append(inp);
    let prev = null, tm = null, busy = false; const c = ctx || {};
    const undo = h('button', { type: 'button', class: 'ai-undo', hidden: true, 'aria-label': 'تراجع — رجّع الكلام اللي كان', title: 'تراجع', 'data-ai-undo': inp.id || kind, onClick: () => { if (prev == null) return; inp.value = prev; inp.dispatchEvent(new Event('input', { bubbles: true })); prev = null; undo.hidden = true; inp.focus(); } }, Icon('undo', 'sm'));
    const btn = h('button', { type: 'button', class: 'ai-rw', 'aria-label': 'إعادة كتابة بالـ AI', title: 'إعادة كتابة بالـ AI — من رصيد الـ AI الشهري', 'data-ai-rw': inp.id || kind, onClick: async () => {
      if (busy) return; busy = true; btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
      const r = await MK().write(c.campaignId !== undefined ? c.campaignId : camp.id, { task: 'rewrite', kind, piece: c.piece, slide: c.slide, text: inp.value });
      busy = false; btn.classList.remove('busy'); btn.removeAttribute('aria-busy');
      if (!r.ok || !r.text) { K.toast(r.message || 'الـ AI ماردش — جرّب تاني', 'error'); return; }
      prev = inp.value; let v = r.text; const ml = Number(inp.getAttribute('maxlength')) || 0; if (ml && v.length > ml) v = v.slice(0, ml);
      inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
      undo.hidden = false; clearTimeout(tm); tm = setTimeout(() => { undo.hidden = true; }, 10000); K.toast('اتكتبت بالـ AI — تقدر ترجع بـ «تراجع»'); } }, Icon('sparkle', 'sm'));
    box.append(h('div', { class: 'ai-acts' }, undo, btn));
    return el;
  }
  const kindOf = (label) => (/فكرة/.test(label) ? 'idea' : /الكابشن/.test(label) ? 'caption' : /عنوان رئيسي/.test(label) ? 'title' : /عنوان فرعي/.test(label) ? 'sub' : /بادج/.test(label) ? 'badge' : null);
  const txt = (id, label, val, set, area, ctx) => aiField(area ? U.Textarea({ id, label, rows: 2, value: val, onInput: (v) => { set(v); persist(); } }) : U.TextInput({ id, label, value: val, onInput: (v) => { set(v); persist(); } }), kindOf(label), ctx);

  // ---------- the hub (v5: the campaign card only — owner 1 Nov 22:54) + «آخر الشغل» (decision 18) ----------
  function hub() {
    const C = can();
    const tool = h('button', { type: 'button', class: 'card tool-card featured', 'data-mk-start': '', disabled: !C.create || null, onClick: startCampaign, 'aria-label': 'كامبين — ابدأ كامبين' }, h('span', { class: 'tool-ic' }, Icon('megaphone')), h('span', { class: 't-h5 tc-t' }, 'كامبين'),
      h('span', { class: 't-small tc-b' }, 'من الفكرة لحد النشر: البوستات والكاروسيل، المراجعة، والمواعيد على كل منصة.'), h('span', { class: 'tc-cta' }, 'ابدأ كامبين', Icon('chevL', 'sm')));
    const posts = MK().posts(); const list = MK().campaigns();
    const rows = list.map((c) => { const [label, tone] = W.campaignStatus(c, posts);
      return [h('span', { class: 'prod' }, h('span', null, h('b', null, c.name), h('small', null, c.goal || 'كامبين'))), K.Num(D2(String(c.updatedAt || '').slice(0, 10))), Tag(tone, label),
        h('div', { class: 'acts-inline' }, C.create ? Button({ size: 'sm', label: 'افتح', attrs: { 'data-mk-open': c.id }, onClick: () => openCampaign(c.id) }) : null,
          C.create ? K.RowMenu([{ label: 'احذف الكامبين', icon: 'trash', danger: true, run: () => K.confirm({ title: 'تحذف «' + c.name + '»؟', text: 'الكامبين هتختفي من «آخر الشغل». البوستات اللي اتجدولت منها بتفضل في سجل النشر.', okLabel: 'احذف', okType: 'danger', onOk: async () => { const r = await MK().archive(c.id); K.toast(r.ok ? 'اتحذفت الكامبين' : r.message, r.ok ? 'success' : 'error'); if (r.ok && camp.id === c.id) Object.assign(camp, blankCamp()); R(); } }) }]) : null)]; });
    const vtool = h('button', { type: 'button', class: 'card tool-card', 'data-mk-video': '', disabled: !C.create || null, onClick: startVideo, 'aria-label': 'فيديو — اعمل فيديو' }, h('span', { class: 'tool-ic' }, Icon('video')), h('span', { class: 't-h5 tc-t' }, 'فيديو'),
      h('span', { class: 't-small tc-b' }, 'ريل من المشاهد: الصور بالـ AI، المقاطع والصوت والموسيقى على Magnific، والنشر.'), h('span', { class: 'tc-cta' }, 'اعمل فيديو', Icon('chevL', 'sm')));
    return [h('div', { class: 'tools-grid c2' }, tool, vtool),
      Card('آخر الشغل', 'الكامبينات اللي اتعملت — بتتحفظ أول بأول وتقدر تكمّلها من مكان ما وقفت.', list.length ? U.Table({ cls: 'dt', headers: ['الكامبين', 'آخر تعديل', 'الحالة', ''], rows })
        : K.Empty('لسه مفيش كامبينات', 'ابدأ كامبين من الكارت اللي فوق.'))];
  }

  // ---------- the campaign (v5 v3, owner 1 Nov 20:21): تفاصيل الكامبين → البناء → المراجعة → النشر ----------
  function campaign() {
    const body = ({ 1: w1, 2: w2, 3: w3, 4: c5 })[st.step]();
    const ph = K.PageHead('كامبين جديدة', null, [Wallet(), GenAll(), Button({ type: 'text', label: 'اخرج', onClick: () => go('marketing-create') }),
      Button({ label: 'احفظ كمسودة', attrs: { 'data-mk-draft': '' }, disabled: !can().create, onClick: async () => { if (!(await ensureCampaign())) return; persist(0); await MK().flush(camp.id); K.toast('اتحفظت كمسودة', 'success'); go('marketing-create'); } })]);
    return [ph, Stepper(CSTEPS, st.step, 'marketing-campaign-'), h('div', { class: 'cw cw-s' + st.step }, ...body)];
  }

  // ===== ١. تفاصيل الكامبين =====
  function w1() {
    const c = camp.w; const err = camp.tried1 ? W.validateDetails(c) : {};
    const goal = Card('هدف الكامبين', null, h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'هدف الكامبين', 'data-cw-goal': '' }, W.GOALS.map((g) => chip(g, c.goal === g, () => { c.goal = g; persist(); R(); }, { role: 'radio', 'aria-checked': String(c.goal === g) }))));
    const idea = Card('الفكرة العامة', 'كل ما تحكي أكتر، الكونتنت يطلع أقرب لإبتكر — كل القطع ماشية عليها.', [aiField(U.Textarea({ id: 'cw-idea', label: 'الفكرة', required: true, rows: 3, value: c.idea, error: err.idea, onInput: (v) => { c.idea = v; persist(); } }), 'general', { campaignId: null })]);
    if (W.VIDEO_SOON && c.mediaTab === 'video') c.mediaTab = 'post';
    const Mx = c.media; const t = c.mediaTab; const m = Mx[t];
    const vm = t === 'video' ? (PD.VIDEO_MODELS.find((x) => x.id === m.model) || PD.VIDEO_MODELS[0]) : null;
    const counts = h('div', { class: 'cw-row' }, num('cw-n-' + t, 'العدد', m.count, W.MAX.count, (v) => { m.count = v; }),
      U.Select({ id: 'cw-sz-' + t, label: 'المقاس', value: m.size, onChange: (v) => { m.size = v; persist(); R(); }, options: t === 'video' ? W.VSIZES.map(([v, l]) => ({ value: v, label: l })) : SZ() }),
      t === 'carousel' ? num('cw-slides', 'صور في كل كاروسيل', m.slides, W.MAX.slides, (v) => { m.slides = v; }, 2) : null,
      t === 'video' ? U.Select({ id: 'cw-dur', label: 'المدة', value: String(vm.durations.includes(m.dur) ? m.dur : vm.durations[0]), onChange: (v) => { m.dur = Number(v); persist(); R(); }, options: vm.durations.map((d) => ({ value: String(d), label: d + ' ثانية' })) }) : null);
    const tabItems = W.MEDIA.map(([id, l]) => ({ id, label: id === 'video' && W.VIDEO_SOON ? [l, ' ', soonTag()] : l, count: id === 'video' && W.VIDEO_SOON ? null : Mx[id].count }));
    const media = Card('الميديا', 'اختار نوع الميديا وظبط كل نوع لوحده.', [K.SubTabs({ label: 'نوع الميديا', active: t, onChange: (id) => { if (id === 'video' && W.VIDEO_SOON) { K.toast('الفيديو بالـ AI قريبًا — بعد المرحلة دي'); return; } c.mediaTab = id; persist(); R(); }, items: tabItems }),
      h('div', { class: 'cw-media', 'data-cw-media': t }, counts, t === 'video' ? vmodelSel('cw-md-video', m.model, (v) => { m.model = v; const mm = PD.VIDEO_MODELS.find((x) => x.id === v); if (mm && !mm.durations.includes(m.dur)) m.dur = mm.durations[0]; }) : modelSel('cw-md-' + t, m.model, (v) => { m.model = v; }),
        h('hr', { class: 'cw-hr' }), Files('cw-use-' + t, 'فايلز أو لينكات للاستخدام', m.use, 'صور المنتج، اللوجو، لقطات من الورشة — أو لينك منتج من الموقع'), Files('cw-ref-' + t, 'فايلز أو لينكات أمثلة للمطابقة', m.ref, 'الـ AI بيقلّد الستايل والترتيب', t === 'carousel' ? 'carousel' : 'post'),
        aiField(U.Textarea({ id: 'cw-notes-' + t, label: 'تعليمات', rows: 2, value: m.notes, placeholder: 'مثلًا: ألوان دافية، من غير ناس، الكلام قليل', onInput: (v) => { m.notes = v; persist(); } }), 'notes', { campaignId: null }))]);
    const X = c.extra;
    const extra = Card('ملفات إضافية', 'صور زيادة للستوري أو الموقع بنفس الستايل.', [h('div', { class: 'cw-row' }, num('cw-n-extra', 'العدد', X.count, W.MAX.count, (v) => { X.count = v; })),
      X.count ? [modelSel('cw-md-extra', X.model, (v) => { X.model = v; }), h('hr', { class: 'cw-hr' }), Files('cw-use-extra', 'فايلز أو لينكات للاستخدام', X.use), Files('cw-ref-extra', 'فايلز أو لينكات أمثلة للمطابقة', X.ref, null, 'post'),
        aiField(U.Textarea({ id: 'cw-notes-extra', label: 'تعليمات', rows: 2, value: X.notes, onInput: (v) => { X.notes = v; persist(); } }), 'notes', { campaignId: null })] : null]);
    const est = W.estimate(c, IMGM()); const w = wallet(); const estV = W.estimateVideo(c);
    const sum = U.InlineNote({ kind: w.balance != null && est > w.balance ? 'warning' : 'info', children: h('span', { 'data-cw-est': String(est) }, 'التكلفة المتوقعة لصور الكامبين كلها تقريبًا ' + K.n0(est) + ' كريديت' + (estV ? ' · والفيديو ≈ ' + K.n0(estV) + ' كريديت على حساب Magnific المربوط (مش من رصيد الصور)' : '') + ' · ' + (w.balance != null ? 'رصيدك ' + K.n0(w.balance) + ' كريديت' : 'اتصرف الشهر ده ' + K.n0(w.used) + ' كريديت') + '. التكلفة الفعلية بتظهر قبل كل توليد، والكتابة بالـ AI مابتصرفش كريدت.') });
    return [goal, idea, media, extra, err.media ? U.InlineNote({ kind: 'error', children: err.media }) : null, sum,
      Foot(1, 4, cback, 'متابعة للبناء', async () => { camp.tried1 = true; if (Object.keys(W.validateDetails(c)).length) { R(); K.toast('كمّل البيانات الناقصة', 'error'); return; }
        camp.pieces = W.buildPieces(c, camp.pieces); if (!(await ensureCampaign())) return; go('marketing-campaign-2'); }, !can().create)];
  }
  function ensurePieces() { if (!camp.pieces.length) camp.pieces = W.buildPieces(camp.w, []); }

  // ===== ٢. البناء =====
  const busyKey = (p, slide) => p.id + (slide == null ? '' : ':' + slide);
  const pv = (src, cls, label, busy) => h('div', { class: 'cw-pv' + (cls ? ' ' + cls : ''), role: src ? null : 'img', 'aria-label': src ? null : 'لسه ما اتولدتش', 'aria-busy': busy ? 'true' : null },
    src ? Img(src, 'fill') : h('span', { class: 'cw-pv-e' }, Icon('image'), h('small', null, label || 'المعاينة هنا')), busy ? h('span', { class: 'cw-pv-busy', 'data-cw-busy': '' }, 'بيتولد…') : null);
  const vcls = (p) => szCls(p.size).trim();
  // one image of a piece (slide null = a post / an extra file, -1 = a carousel's cover, k = its slide) → the path into the piece
  async function genImage(p, slide) {
    const key = busyKey(p, slide); if (camp.busy[key]) return false;
    if (!(await ensureCampaign())) return false;
    camp.busy[key] = true; persist(0); R();
    const vid = p.kind === 'فيديو';
    const r = await MK().generate(camp.id, { piece: p.id, slide, model: vid ? W.DEFAULT_MODEL : p.model, size: vid ? W.videoImgSize(p.size) : p.size });
    delete camp.busy[key];
    if (!r.ok) { K.toast(r.message, 'error'); R(); return false; }
    const t = slide == null || slide < 0 ? p : vid ? p.scenes[slide] : p.slides[slide];
    t.img = r.path; t.gen = (t.gen || 0) + 1; t.approved = false; t.v = t.gen > 1 ? t.gen : t.v; if (t !== p) p.approved = false;
    if (vid) { p.assembled = false; p.video = null; } // a new key frame: the clips and the cut are stale
    persist(0); R(); return true;
  }
  async function genCarousel(p) { if (!(await genImage(p, -1))) return false; for (let k = 0; k < p.slides.length; k++) if (!(await genImage(p, k))) return false; return true; }
  // «املأ بالـ AI»: the empty fields of the piece (and its slides) from its campaign — the filled ones stay
  async function aiFill(p) {
    if (!(await ensureCampaign())) return false; persist(0);
    const r = await MK().write(camp.id, { task: 'fill', piece: p.id });
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    const f = r.fields || {};
    ['idea', 'caption', 'title', 'sub', 'badge'].forEach((k) => { if (f[k] && !p[k]) p[k] = f[k]; });
    if (Array.isArray(f.slides) && Array.isArray(p.slides)) p.slides.forEach((s, i) => { const x = f.slides[i] || {}; ['idea', 'title', 'sub'].forEach((k) => { if (x[k] && !s[k]) s[k] = x[k]; }); });
    persist(0); return true;
  }
  function fieldsFor(p, pre, o) {
    o = o || {}; const id = pre + p.id + (o.k != null ? '-' + o.k : ''); const t = o.target || p; const ctx = { piece: p.id, slide: o.k != null ? o.k : null };
    return [txt(id + '-idea', o.ideaLabel || 'فكرة الصورة', t.idea, (v) => { t.idea = v; }, true, ctx),
      o.caption === false ? null : txt(id + '-cap', 'الكابشن المقترح', t.caption, (v) => { t.caption = v; }, true, ctx),
      K.two(txt(id + '-t', 'عنوان رئيسي', t.title, (v) => { t.title = v; }, false, ctx), txt(id + '-s', 'عنوان فرعي', t.sub, (v) => { t.sub = v; }, false, ctx)),
      txt(id + '-b', 'بادج مخصص', t.badge, (v) => { t.badge = v; }, false, ctx),
      Files(id + '-ref', 'مثال للمطابقة', t.ref, null, p.kind === 'كاروسيل' ? 'carousel' : 'post'), Files(id + '-use', 'صور أو لينكات للاستخدام', t.use)];
  }
  // the video scenes by Claude (decision 59): the ideas, the on-screen text, the camera, the voice-over — the images stay where the count did not change
  async function planScenes(p) {
    if (!(await ensureCampaign())) return false; persist(0);
    const r = await MK().videoScenes(camp.id, p.id, p.voice && p.voice.mode === 'ai');
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    const old = p.scenes || [];
    p.scenes = r.scenes.map((s, k) => Object.assign({ n: k + 1, d: s.d, idea: s.idea, text: s.text, cam: s.cam, ref: [], use: [] }, old.length === r.scenes.length && old[k] && old[k].img ? { img: old[k].img, gen: old[k].gen } : {}));
    if (p.voice && !p.voice.text && r.voice) p.voice.text = r.voice;
    p.assembled = false; p.video = null; p.approved = false; persist(0); return true;
  }
  const sceneCostAll = (p) => W.cost('scenes-img', Object.assign({}, p, { scenes: (p.scenes || []).length ? p.scenes.filter((x) => !x.img) : W.splitScenes(p.dur, p.sceneCount) }), IMGM());
  function pieceHead(p) {
    const cost = p.kind === 'كاروسيل' ? W.cost('carousel', p, IMGM()) : p.kind === 'فيديو' ? sceneCostAll(p) : W.cost('image', p, IMGM());
    return h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, 'المقاس: ', szName(p.size)), h('span', null, 'الموديل: ', mdlName(p.model)), h('span', null, 'هيصرف: ', K.Num(K.n0(cost) + ' كريديت'))),
      W.built(p) ? Tag('success', 'اتولد') : Tag('neutral', 'لسه'), h('span', { class: 'grow' }), aiBtn('املأ بالـ AI', async () => { if (await aiFill(p)) K.toast('اتملت الحقول الفاضية — راجعها', 'success'); }, { 'data-cw-fill': p.id }));
  }
  function buildCard(p) {
    const anchor = { id: 'cw-' + p.id, 'data-cw-piece': p.id, tabindex: '-1' };
    if (p.kind === 'فيديو') return buildVideo(p, anchor);
    if (p.kind === 'كاروسيل') {
      const n = W.cost('carousel', p, IMGM()); const any = Object.keys(camp.busy).some((k) => k.startsWith(p.id + ':'));
      return h('section', Object.assign({ class: 'card cw-piece' }, anchor), pieceHead(p),
        h('div', { class: 'cw-grid' }, pv(p.img, vcls(p), 'الغلاف', camp.busy[busyKey(p, -1)]), h('div', { class: 'cw-fields' }, h('h3', { class: 't-h6' }, 'الغلاف'), ...fieldsFor(p, 'b-', { ideaLabel: 'فكرة الغلاف' }))),
        h('h3', { class: 't-h6 cw-sub' }, 'صور الكاروسيل (' + p.slides.length + ')'),
        h('div', { class: 'cw-slides' }, p.slides.map((s, k) => h('div', { class: 'cw-slide' }, h('div', { class: 'cw-grid' }, pv(s.img, vcls(p), 'صورة ' + (k + 1), camp.busy[busyKey(p, k)]), h('div', { class: 'cw-fields' }, h('b', null, 'صورة ' + (k + 1)), ...fieldsFor(p, 'b-', { k, target: s, caption: false, ideaLabel: 'فكرة الصورة' })))))),
        h('div', { class: 'acts-inline start' }, costBtn(p.img ? 'ولّد الكاروسيل تاني' : 'توليد الكاروسيل', n, async () => { if (await genCarousel(p)) K.toast('اتولد الغلاف و' + p.slides.length + ' صور', 'success'); }, { 'data-cw-gen': p.id }, null, any)));
    }
    const n = W.cost('image', p, IMGM()); const busy = camp.busy[busyKey(p, null)];
    return h('section', Object.assign({ class: 'card cw-piece' }, anchor), pieceHead(p), h('div', { class: 'cw-grid' }, pv(p.img, vcls(p), null, busy), h('div', { class: 'cw-fields' }, ...fieldsFor(p, 'b-', { caption: p.kind === 'بوست' }),
      h('div', { class: 'acts-inline start' }, costBtn(p.img ? 'ولّد تاني' : 'توليد الصورة', n, async () => { if (await genImage(p, null)) K.toast('اتولدت الصورة', 'success'); }, { 'data-cw-gen': p.id }, null, busy)))));
  }
  // the video piece in the build step (the v6): the idea and the caption, the scenes count, «توليد المشاهد» by Claude, a key frame a scene
  function buildVideo(p, anchor) {
    const ctx = { piece: p.id, slide: null }; const sc = p.scenes || [];
    const scene = (s, k) => h('div', { class: 'cw-scene', 'data-cw-scene': p.id + '-' + k }, h('div', { class: 'cw-grid' }, pv(s.img, vcls(p), 'المشهد ' + (k + 1), camp.busy[busyKey(p, k)]), h('div', { class: 'cw-fields' }, h('b', null, 'المشهد ' + (k + 1) + ' (المدة ' + K.n0(s.d) + ' ثواني)'),
      txt('b-' + p.id + '-sc' + k, 'فكرة المشهد', s.idea, (v) => { s.idea = v; }, true, { piece: p.id, slide: k }),
      K.two(U.Select({ id: 'b-' + p.id + '-cam' + k, label: 'الكاميرا', value: VCAMS.includes(s.cam) ? s.cam : 'ثابتة', options: VCAMS.map((x) => ({ value: x, label: x })), onChange: (v) => { s.cam = v; persist(); } }),
        U.TextInput({ id: 'b-' + p.id + '-tx' + k, label: 'كلام على الشاشة', value: s.text || '', maxlength: 60, placeholder: '—', onInput: (v) => { s.text = v; persist(); } })),
      h('div', { class: 'acts-inline start' }, costBtn(s.img ? 'ولّد صورة المشهد تاني' : 'توليد صورة المشهد', W.cost('scene', p, IMGM()), async () => { if (await genImage(p, k)) K.toast('اتولدت صورة المشهد ' + (k + 1), 'success'); }, { 'data-cw-scene-gen': p.id + '-' + k }, null, camp.busy[busyKey(p, k)])))));
    const allN = sc.length ? W.cost('scenes-img', Object.assign({}, p, { scenes: sc.filter((x) => !x.img) }), IMGM()) : 0;
    return h('section', Object.assign({ class: 'card cw-piece cw-vid' }, anchor), pieceHead(p),
      h('div', { class: 'cw-grid' }, pv(sc[0] && sc[0].img, vcls(p), 'فيديو ' + K.n0(p.dur) + ' ث'), h('div', { class: 'cw-fields' }, txt('b-' + p.id + '-idea', 'فكرة الفيديو', p.idea, (v) => { p.idea = v; }, true, ctx), txt('b-' + p.id + '-cap', 'الكابشن المقترح', p.caption, (v) => { p.caption = v; }, true, ctx),
        Files('b-' + p.id + '-ref', 'مثال للمطابقة', p.ref, null, 'video'), Files('b-' + p.id + '-use', 'صور أو لينكات للاستخدام', p.use),
        h('div', { class: 'cw-row' }, num('b-' + p.id + '-n', 'عدد المشاهد', p.sceneCount, W.MAX.scenes, (v) => { p.sceneCount = v; }, 1)),
        h('div', { class: 'acts-inline start' }, aiBtn(sc.length ? 'وزّع المشاهد تاني' : 'توليد المشاهد', async () => { if (await planScenes(p)) K.toast('اتقسم الفيديو ' + K.n0(p.scenes.length) + ' مشاهد — ولّد صورة كل مشهد', 'success'); }, { 'data-cw-plan': p.id })))),
      sc.length ? [h('div', { class: 'grp-h cw-sub' }, h('h3', { class: 't-h6' }, 'المشاهد (' + K.n0(sc.length) + ')'), h('span', { class: 'grow' }), allN ? costBtn('ولّد صور كل المشاهد', allN, async () => { for (let k = 0; k < sc.length; k++) { if (!sc[k].img && !(await genImage(p, k))) return; } K.toast('اتولدت صور المشاهد', 'success'); }, { 'data-cw-scenes-all': p.id }) : null), h('div', { class: 'cw-scenes' }, sc.map(scene))] : null);
  }
  // «ولّد الكل بالـ AI» (owner 2 Nov 00:25): every piece still missing — the empty texts first (no credit), then the images
  function genAllPlan() {
    const ps = camp.pieces || []; let cost = 0; const jobs = [];
    ps.forEach((p) => { if (W.built(p)) return;
      if (p.kind === 'فيديو') { const sc = (p.scenes || []).length ? p.scenes : W.splitScenes(p.dur, p.sceneCount); if (!(p.scenes || []).length) jobs.push(() => planScenes(p)); sc.forEach((x, k) => { if (!x.img) { cost += W.cost('scene', p, IMGM()); jobs.push(() => genImage(p, k)); } }); return; }
      if (!p.idea) jobs.push(() => aiFill(p));
      if (p.kind === 'كاروسيل') { const miss = [p.img ? null : -1].concat(p.slides.map((s, k) => (s.img ? null : k))).filter((x) => x != null); cost += W.imgRate(IMGM(), p.model) * miss.length; miss.forEach((k) => jobs.push(() => genImage(p, k))); }
      else { cost += W.cost('image', p, IMGM()); jobs.push(() => genImage(p, null)); } });
    return { cost, jobs };
  }
  function GenAll() {
    if (st.step !== 2) return null; ensurePieces(); const g = genAllPlan();
    if (!g.jobs.length) return Button({ size: 'sm', icon: 'check', label: 'كله اتولد', disabled: true, attrs: { 'data-cw-genall': 'done' } });
    return Button({ type: 'brand', size: 'sm', icon: 'sparkle', label: 'ولّد الكل بالـ AI‏ · ' + K.n0(g.cost) + ' كريديت', disabled: !can().create, attrs: { 'data-cw-genall': String(g.cost), title: 'ولّد كل القطع في ضغطة واحدة' },
      onClick: () => pay('ولّد كل القطع بالـ AI', g.cost, async () => { for (const j of g.jobs) { if (!(await j())) return; } K.logEvent('mkt.campaign.generate_all', 'step 2 · ' + g.cost); K.toast('اتولدت كل القطع — راجعها', 'success'); }) });
  }
  function w2() {
    ensurePieces(); const ps = camp.pieces; const pr = W.progress(ps, W.built);
    const jump = h('nav', { class: 'cw-jump', 'aria-label': 'القطع' }, ps.map((p) => h('a', { href: '#cw-' + p.id, class: 'chip' + (W.built(p) ? ' on' : ''), onClick: (e) => { e.preventDefault(); const el = document.getElementById('cw-' + p.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.focus({ preventScroll: true }); } } }, W.built(p) ? Icon('check', 'sm') : null, p.kind + ' ' + p.n)));
    return [h('div', { class: 'cw-bar card' }, h('span', { 'data-cw-built': pr.done + '/' + pr.total }, 'اتولد ', K.Num(pr.done + ' من ' + pr.total)), h('span', { class: 'grow' }), jump), ...ps.map(buildCard),
      pr.done < pr.total ? U.InlineNote({ children: 'ولّد كل القطع عشان تكمّل للمراجعة.' }) : null,
      Foot(2, 4, cback, 'متابعة للمراجعة', () => { camp.rtab = ps.some((p) => p.kind === 'بوست' || p.kind === 'ملف إضافي') ? 'post' : ps.some((p) => p.kind === 'كاروسيل') ? 'carousel' : 'video'; go('marketing-campaign-3'); }, !W.canBuildNext(ps))];
  }

  // ===== ٣. المراجعة =====
  // تعديل بالكومنتس (owner 1 Nov 22:19): دوس على الصورة تحط نقطة مترقمة واكتب عندها التعديل → «ولّد بالتعديل» (decision 9)
  function editRegen(p, slide, label) {
    const t = slide == null || slide < 0 ? p : p.slides[slide]; let note = '';
    const pins = (t.pins || []).map((x) => Object.assign({}, x)); let adding = true;
    const before = { title: t.title || '', sub: t.sub || '', badge: t.badge || '' };
    const m = U.Modal({ title: 'تعديل ' + label, body: [], footer: [] }); m.el.classList.add('wide');
    const n = W.imgRate(IMGM(), p.model);
    const draw = () => {
      const stage = h('div', { class: 'cw-pin-stage' + (adding ? ' adding' : ''), 'data-pin-stage': '', role: 'application', 'aria-label': 'الصورة — دوس في أي مكان تحط تعليق' }, pv(t.img, vcls(p)),
        pins.map((x, i) => h('button', { type: 'button', class: 'cw-pin', style: 'inset-inline-start:' + (100 - x.x) + '%;top:' + x.y + '%', 'aria-label': 'تعليق ' + (i + 1) + (x.text ? ': ' + x.text : ''), 'data-pin': String(i + 1), onClick: (e) => { e.stopPropagation(); const f = document.getElementById('pin-t-' + i); if (f) f.focus(); } }, String(i + 1))));
      stage.addEventListener('click', (e) => { if (!adding) return; const r = stage.getBoundingClientRect(); const x = Math.round((e.clientX - r.left) / r.width * 100), y = Math.round((e.clientY - r.top) / r.height * 100); if (pins.length >= 10) { K.toast('10 تعليقات بالكتير'); return; } pins.push({ x: Math.max(3, Math.min(97, x)), y: Math.max(3, Math.min(97, y)), text: '' }); draw(); setTimeout(() => { const f = document.getElementById('pin-t-' + (pins.length - 1)); if (f) f.focus(); }, 0); });
      const list = h('div', { class: 'cw-pins', 'data-pins': String(pins.length) }, pins.length ? pins.map((x, i) => h('div', { class: 'cw-pin-row' }, h('span', { class: 'cw-pin sm', 'aria-hidden': 'true' }, String(i + 1)),
        (() => { const inp = h('input', { type: 'text', class: 'input grow', id: 'pin-t-' + i, value: x.text, maxlength: 200, placeholder: 'عايز إيه يتعدل هنا؟', 'aria-label': 'تعليق ' + (i + 1) }); inp.addEventListener('input', () => { x.text = inp.value; }); return inp; })(),
        U.IconButton({ icon: 'trash', label: 'شيل تعليق ' + (i + 1), onClick: () => { pins.splice(i, 1); draw(); } }))) : h('p', { class: 't-small help', style: 'margin:0' }, 'دوس على أي حتة في الصورة تحط نقطة واكتب عندها التعديل.'));
      const ctx = { piece: p.id, slide: slide == null ? null : slide };
      m.setBody(h('div', { class: 'cw-grid cw-edit-grid' }, h('div', { class: 'cw-pin-col' }, stage, h('div', { class: 'acts-inline start' }, Button({ size: 'sm', icon: 'plus', type: adding ? 'brand' : 'default', label: adding ? 'بتحط تعليقات — دوس على الصورة' : 'حط تعليق على الصورة', attrs: { 'aria-pressed': String(adding), 'data-pin-mode': '' }, onClick: () => { adding = !adding; draw(); } }))),
        h('div', { class: 'cw-fields' }, h('div', { class: 't-label' }, 'التعليقات على الصورة' + (pins.length ? ' (' + pins.length + ')' : '')), list,
          U.Textarea({ id: 'cw-edit', label: 'تعديل عام (اختياري)', rows: 2, value: note, placeholder: 'مثلًا: خلي الإضاءة أدفى', onInput: (v) => { note = v; } }),
          txt('cw-e-t', 'عنوان رئيسي', t.title, (v) => { t.title = v; }, false, ctx), txt('cw-e-s', 'عنوان فرعي', t.sub, (v) => { t.sub = v; }, false, ctx), txt('cw-e-b', 'بادج مخصص', t.badge, (v) => { t.badge = v; }, false, ctx))));
    };
    draw();
    const keep = () => { t.pins = pins.filter((x) => String(x.text || '').trim()); persist(0); };
    // a changed headline / subheadline / badge goes into the instruction (the text is in the image)
    const textNote = () => [['العنوان الرئيسي', 'title'], ['العنوان الفرعي', 'sub'], ['البادج', 'badge']].filter(([, k]) => (t[k] || '') !== before[k]).map(([l, k]) => (t[k] ? l + ' بقى «' + t[k] + '»' : 'شيل ' + l)).join('، ');
    m.setFooter(Button({ label: 'إلغاء', onClick: () => m.close() }), h('span', { class: 'grow' }), Button({ label: 'احفظ بس', onClick: () => { keep(); m.close(); R(); } }),
      Button({ type: 'primary', icon: 'sparkle', label: 'ولّد بالتعديل‏ · ' + K.n0(n) + ' كريديت', attrs: { 'data-cw-regen': '' }, disabled: !can().create, onClick: () => {
        keep(); const extra = textNote(); const all = [note.trim(), extra].filter(Boolean).join(' — ');
        if (!all && !t.pins.length) { K.toast('حط تعليق على الصورة أو اكتب التعديل الأول', 'error'); return; }
        m.close();
        pay('تعديل ' + label, n, async () => {
          const key = busyKey(p, slide); camp.busy[key] = true; R();
          const r = await MK().edit(camp.id, { piece: p.id, slide, model: p.model, note: all, pins: t.pins });
          delete camp.busy[key];
          if (!r.ok) { K.toast(r.message, 'error'); R(); return; }
          t.img = r.path; t.v = (t.v || 1) + 1; t.pins = []; t.approved = false; if (t !== p) p.approved = false;
          persist(0); K.toast('اتعملت نسخة ' + t.v + ' بالتعديل — راجعها', 'success'); R();
        });
      } }));
  }
  const okBtns = (p, slide, label) => { const t = slide == null || slide < 0 ? p : p.slides[slide]; const ok = !!t.approved;
    return h('div', { class: 'acts-inline start' }, ok ? Tag('success', 'اتوافق') : null,
      ok ? Button({ size: 'sm', label: 'رجّع للتعديل', onClick: () => { t.approved = false; if (t !== p) p.approved = false; persist(0); R(); } })
        : Button({ type: 'primary', size: 'sm', icon: 'check', label: 'موافقة', disabled: !t.img, attrs: { 'data-cw-ok': label }, onClick: () => { t.approved = true; persist(0); R(); } }),
      Button({ size: 'sm', icon: 'edit', label: 'تعديل', disabled: !t.img || !can().create, attrs: { 'data-cw-edit': label }, onClick: () => editRegen(p, slide, label) })); };
  function reviewPost(p) {
    const ctx = { piece: p.id, slide: null }; const busy = camp.busy[busyKey(p, null)];
    return h('section', { class: 'card cw-piece cw-rev' + (p.approved ? ' ok' : ''), 'data-cw-rev': p.id }, h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, szName(p.size)), h('span', null, mdlName(p.model))), p.v > 1 ? Tag('gold', 'نسخة ' + p.v) : null),
      h('div', { class: 'cw-grid' }, h('div', { class: 'cw-pv-w' }, pv(p.img, vcls(p), null, busy)), h('div', { class: 'cw-fields' }, p.kind === 'بوست' ? txt('r-' + p.id + '-cap', 'الكابشن', p.caption, (v) => { p.caption = v; }, true, ctx) : null,
        (p.pins || []).length ? U.InlineNote({ children: (p.pins || []).length + ' تعليق محفوظ على الصورة — «تعديل» عشان تولّد بيهم' }) : null, okBtns(p, null, p.kind + ' ' + p.n))));
  }
  function reviewCarousel(p) {
    const done = W.approved(p);
    const sub = (k) => { const t = k < 0 ? p : p.slides[k]; const label = k < 0 ? 'الغلاف — كاروسيل ' + p.n : 'صورة ' + (k + 1) + ' — كاروسيل ' + p.n;
      return h('div', { class: 'cw-slide' + (t.approved ? ' ok' : ''), 'data-cw-rev': p.id + '-' + k }, h('div', { class: 'cw-grid' }, pv(t.img, vcls(p), null, camp.busy[busyKey(p, k)]), h('div', { class: 'cw-fields' }, h('b', null, k < 0 ? 'الغلاف' : 'صورة الكاروسيل رقم ' + (k + 1)), t.v > 1 ? Tag('gold', 'نسخة ' + t.v) : null, okBtns(p, k, label)))); };
    return h('section', { class: 'card cw-piece cw-rev' + (done ? ' ok' : ''), 'data-cw-rev': p.id }, h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, (p.slides.length + 1) + ' صور'), h('span', null, mdlName(p.model))),
      done ? Tag('success', 'اتوافق على الكل') : Tag('orange', W.progress([{ approved: p.approved }].concat(p.slides), (x) => x.approved).done + ' من ' + (p.slides.length + 1))),
      txt('r-' + p.id + '-cap', 'الكابشن', p.caption, (v) => { p.caption = v; }, true, { piece: p.id, slide: null }), sub(-1), h('div', { class: 'cw-slides' }, p.slides.map((_, k) => sub(k))));
  }
  // ----- the video in the review (9.5.5, decisions 58–61): the timeline, the tracks, the clips, the cut and the mixes, the player -----
  const vjobsOf = (p) => camp.vjobs[p.id] || null;
  const clipDone = (p, k) => { const J = vjobsOf(p); return !!J && J.jobs.some((j) => j.kind === 'clip' && j.status === 'done' && (p.method === 'chained' ? j.scene == null : j.scene === k)); };
  const clipsReady = (p) => (p.method === 'chained' ? clipDone(p, null) : (p.scenes || []).length > 0 && p.scenes.every((_, k) => clipDone(p, k)));
  // the poll (decision 58): every 15 s while the piece has open jobs and the review is on screen; the final video into the piece
  const VPOLL_MS = 15000;
  async function vpoll(p, force) {
    if (!camp.id || !MK()) return; const key = 'poll:' + p.id; if (camp.busy[key] && !force) return; camp.busy[key] = true;
    try {
      const r = await MK().videoPoll(camp.id, p.id);
      if (!r.ok) { camp.vjobs[p.id] = { jobs: [], open: 0, final: null, error: r.message, at: Date.now() }; return; }
      camp.vjobs[p.id] = { jobs: r.jobs || [], open: r.open, final: r.final, at: Date.now() };
      if (r.final && r.final.path && p.video !== r.final.path) { p.video = r.final.path; p.assembled = true; p.approved = false; persist(0); }
      if (!r.final && p.assembled) { p.assembled = false; p.video = null; persist(0); }
    } finally { delete camp.busy[key]; }
    if (window.IBPages.current === 'marketing' && st.view === 'campaign' && st.step === 3) { R(); const J = camp.vjobs[p.id]; if (J && J.open) setTimeout(() => { if (st.view === 'campaign' && st.step === 3 && camp.pieces.includes(p)) vpoll(p); }, VPOLL_MS); }
  }
  const JOB_L = { clip: 'مقطع', voice: 'الفويس أوفر', music: 'الموسيقى', upload: 'ملف', assemble: 'التجميع', mix: 'المزج' };
  const JOB_ST = { queued: ['في الطابور', 'neutral'], running: ['بيتعمل…', 'orange'], done: ['خلص', 'success'], failed: ['فشل', 'error'] };
  async function vrun(p, fn, okMsg) { if (!(await ensureCampaign())) return; const r = await fn(); if (!r.ok) { K.toast(r.message, 'error'); return; } if (okMsg) K.toast(okMsg, 'success'); p.assembled = false; p.video = null; p.approved = false; persist(0); await vpoll(p, true); }
  function videoPlayer(p) {
    const box = h('div', { class: 'vid-big ' + (p.size === '9:16' ? 'tall' : p.size === '16:9' ? 'wide' : 'sq'), 'data-cw-player': p.id });
    const m = U.Modal({ title: 'الفيديو المجمّع — فيديو ' + p.n, body: [box, h('p', { class: 't-small help', style: 'margin:0' }, K.n0(p.dur) + ' ث · ' + p.size + ' · ' + vmdlName(p.model))], footer: [Button({ label: 'اقفل', onClick: () => m.close() })].concat(!p.approved ? [Button({ type: 'primary', icon: 'check', label: 'موافقة على الفيديو', attrs: { 'data-vp-ok': '' }, onClick: () => { p.approved = true; persist(0); m.close(); K.toast('اتوافق على فيديو ' + p.n, 'success'); R(); } })] : []) });
    MK().url(p.video).then((u) => { if (u) box.replaceChildren(h('video', { src: u, controls: true, playsinline: true, style: 'width:100%;height:100%;object-fit:contain;background:#000' })); else box.replaceChildren(h('p', { class: 't-small help' }, 'تعذّر فتح الفيديو')); });
  }
  function reviewVideo(p) {
    const J = vjobsOf(p); if (!J && camp.id && !camp.busy['poll:' + p.id]) vpoll(p);
    const sc = p.scenes || []; const total = sc.reduce((x, s) => x + (s.d || 0), 0) || p.dur; const ready = clipsReady(p); const mu = p.music; const v = p.voice;
    const dirty = () => { p.assembled = false; p.video = null; p.approved = false; persist(0); };
    const col = (s, k) => { const ta = h('textarea', { class: 'input cw-tl-tx', id: 'tl-' + p.id + '-' + k, rows: 2, maxlength: 60, placeholder: 'النص اللي يظهر على المشهد', 'aria-label': 'النص على الشاشة — المشهد ' + (k + 1) }, s.text || ''); ta.addEventListener('input', () => { s.text = ta.value; persist(); const o = ta.closest('.cw-tl-s').querySelector('.cw-tl-cap'); if (o) o.textContent = ta.value; });
      const done = clipDone(p, k);
      return h('div', { class: 'cw-tl-s', 'data-cw-tl': k, role: 'listitem', style: 'flex:' + (s.d || 1) + ' 1 0' },
        h('div', { class: 'cw-tl-th' }, s.img ? Img(s.img, 'fill') : null, h('span', { class: 'cw-tl-n' }, String(k + 1)), h('span', { class: 'cw-dur' }, K.n0(s.d) + ' ث'), h('span', { class: 'cw-tl-cap' }, s.text || ''),
          h('span', { class: 'cw-play' + (done ? ' on' : ''), 'aria-label': done ? 'المشهد ' + (k + 1) + ' اتولد' : 'المشهد ' + (k + 1) + ' لسه', title: done ? 'اتولد' : 'لسه ما اتولدش', 'data-cw-clip': p.id + '-' + k + ':' + (done ? 'done' : 'none') }, Icon(done ? 'check' : 'play'))),
        h('div', { class: 'cw-tl-txw' }, ta), h('div', { class: 'cw-tl-f' }, h('b', null, 'المشهد ' + (k + 1)), h('span', { class: 'grow' }))); };
    const tStep = total > 20 ? 5 : total > 10 ? 3 : 1; const ticks = []; for (let x = 0; x < total; x += tStep) ticks.push(x); if (ticks.length > 1 && total - ticks[ticks.length - 1] < tStep / 2) ticks.pop(); ticks.push(total);
    const timeline = h('div', { class: 'cw-tl2', role: 'group', 'aria-label': 'تايملاين الفيديو ' + p.n },
      h('div', { class: 'cw-ruler', 'aria-hidden': 'true' }, ticks.map((x) => h('span', { style: 'inset-inline-start:' + (x / total * 100) + '%' }, K.n0(x) + 'ث'))),
      h('div', { class: 'cw-track', role: 'list', 'aria-label': 'مشاهد الفيديو ' + p.n }, sc.map(col)),
      h('div', { class: 'cw-atrack mu' + (mu.src === 'none' ? ' off' : '') }, Icon('music', 'sm'), h('span', null, mu.src === 'none' ? 'من غير موسيقى' : mu.src === 'upload' ? (mu.file || 'ارفع التراك') : 'موسيقى ' + (mu.type || ''))),
      h('div', { class: 'cw-atrack vo' + (v.mode === 'none' ? ' off' : '') }, Icon('mic', 'sm'), h('span', null, v.mode === 'none' ? 'من غير فويس أوفر' : v.mode === 'upload' ? (v.file || 'ارفع الصوت') : 'فويس أوفر بالـ AI')));
    const audioInput = (role) => { const inp = h('input', { type: 'file', class: 'sr-file', id: 'cw-au-' + role + '-' + p.id, accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav', onChange: async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; await vrun(p, () => MK().videoUpload(camp.id, p.id, f, role), 'اترفع الملف'); if (role === 'voice') v.file = f.name; else mu.file = f.name; persist(0); R(); } });
      return h('div', { class: 'cw-add' }, h('label', { class: 'btn btn-default sm', for: inp.id, tabindex: '0', role: 'button' }, Icon('upload', 'sm'), ' ارفع ملف (MP3 / M4A / WAV)'), inp); };
    const last = (kind) => (J ? J.jobs.filter((j) => j.kind === kind || (j.kind === 'upload' && j.data && j.data.role === kind)).pop() : null);
    const jobTag = (j) => (j ? Tag(JOB_ST[j.status] ? JOB_ST[j.status][1] : 'neutral', JOB_ST[j.status] ? JOB_ST[j.status][0] : j.status) : null);
    const av = h('div', { class: 'cw-av' },
      h('div', { class: 'cw-av-r', 'data-cw-music': p.id }, h('b', null, Icon('music', 'sm'), ' الموسيقى ', jobTag(last('music'))), h('div', { class: 'chips', role: 'radiogroup' }, [['library', 'بالنوع (AI)'], ['upload', 'ارفع'], ['none', 'من غير']].map(([id, l]) => chip(l, mu.src === id, () => { mu.src = id; dirty(); R(); }))),
        mu.src === 'library' ? [U.Select({ id: 'mu-' + p.id, label: 'نوع الموسيقى', value: mu.type || 'دافية هادية', options: ['دافية هادية', 'شرقي حديث', 'مبهجة', 'سينمائي'].map((x) => ({ value: x, label: x })), onChange: (x) => { mu.type = x; dirty(); R(); } }),
          h('div', { class: 'acts-inline start' }, Button({ size: 'sm', icon: 'sparkle', label: last('music') && last('music').status !== 'failed' ? 'ولّد الموسيقى تاني' : 'ولّد الموسيقى', disabled: !can().create, attrs: { 'data-cw-music-gen': p.id }, onClick: () => vrun(p, () => MK().videoMusic(camp.id, p.id, mu.type || 'دافية هادية'), 'الموسيقى بتتعمل على Magnific') }))]
          : mu.src === 'upload' ? audioInput('music') : null),
      h('div', { class: 'cw-av-r', 'data-cw-voice': p.id }, h('b', null, Icon('mic', 'sm'), ' الفويس أوفر ', jobTag(last('voice'))), h('div', { class: 'chips', role: 'radiogroup' }, [['ai', 'اكتب وولّد بالـ AI'], ['upload', 'ارفع'], ['none', 'من غير']].map(([id, l]) => chip(l, v.mode === id, () => { v.mode = id; dirty(); R(); }))),
        v.mode === 'ai' ? [U.Textarea({ id: 'vo-' + p.id, label: 'نص الفويس أوفر', rows: 2, value: v.text, onInput: (x) => { v.text = x; persist(); } }),
          U.Select({ id: 'vc-' + p.id, label: 'الصوت', value: v.voice || 'm-eg-1', options: [['m-eg-1', 'راجل — مصري (Bilal)'], ['m-eg-2', 'راجل — مصري (Karim)'], ['m-eg-3', 'راجل — مصري (Yusuf)'], ['f-ar-1', 'ست — عربي (Amina)'], ['f-ar-2', 'ست — عربي (Hiba)']].map(([a, b]) => ({ value: a, label: b })), onChange: (x) => { v.voice = x; persist(); } }),
          h('div', { class: 'acts-inline start' }, Button({ size: 'sm', icon: 'sparkle', label: last('voice') && last('voice').status !== 'failed' ? 'ولّد الصوت تاني' : 'ولّد الصوت', disabled: !can().create, attrs: { 'data-cw-voice-gen': p.id }, onClick: () => { if (!String(v.text || '').trim()) { K.toast('اكتب نص الفويس أوفر الأول', 'error'); return; } vrun(p, () => MK().videoVoice(camp.id, p.id, { voice: v.voice || 'm-eg-1', text: v.text }), 'الصوت بيتعمل على Magnific'); } }))]
          : v.mode === 'upload' ? audioInput('voice') : null));
    const jobsList = J && J.jobs.length ? h('div', { class: 'cw-jobs t-small', 'data-cw-jobs': String(J.jobs.length) }, J.jobs.slice(-8).map((j) => h('span', { class: 'cw-job', 'data-cw-job': j.kind + ':' + j.status }, (JOB_L[j.kind] || j.kind) + (j.scene != null ? ' ' + (j.scene + 1) : ''), ' ', jobTag(j), j.error ? h('small', { class: 'help' }, ' · ' + j.error) : null))) : null;
    const final = J && J.final; const step = p.video ? 3 : ready ? 2 : 1; const busy = !!(J && J.open);
    const genClips = () => vrun(p, async () => { if (p.method === 'chained') return MK().videoClip(camp.id, p.id, null); for (let k = 0; k < sc.length; k++) { if (clipDone(p, k)) continue; const r = await MK().videoClip(camp.id, p.id, k); if (!r.ok) return r; } return { ok: true }; }, 'المشاهد بتتعمل على Magnific — استنى شوية');
    const chainedOk = p.model !== 'kling-2.5';
    return h('section', { class: 'card cw-piece cw-rev cw-vid' + (p.approved ? ' ok' : ''), 'data-cw-rev': p.id },
      h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, 'الفيديو رقم ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, 'المدة: ', K.Num(K.n0(p.dur) + ' ث')), h('span', null, 'المقاس: ', p.size), h('span', null, 'الموديل: ', vmdlName(p.model)), h('span', null, 'التكلفة: ', K.Num('≈ ' + K.n0(W.cost('clips', p, IMGM())) + ' كريديت على Magnific'))),
        p.approved ? Tag('success', 'اتوافق') : p.video ? Tag('orange', 'مستني موافقتك') : null, Button({ type: 'brand', size: 'sm', icon: 'play', label: 'شاهد الفيديو المجمّع', disabled: !p.video, attrs: { 'data-cw-watch': p.id, title: p.video ? '' : 'جمّع المشاهد الأول' }, onClick: () => videoPlayer(p) }), h('span', { class: 'grow' }),
        h('div', { class: 'cw-method', role: 'radiogroup', 'aria-label': 'طريقة التوليد', 'data-cw-method': p.id }, h('span', { class: 't-small help' }, 'طريقة التوليد:'), W.METHODS.map(([id, l]) => { const on = (p.method || 'separate') === id; const n = W.cost('clips', Object.assign({}, p, { method: id }), IMGM()); return h('button', { type: 'button', role: 'radio', class: 'radio cw-rd', 'aria-checked': String(on), 'data-method': id, disabled: id === 'chained' && !chainedOk ? true : null, onClick: () => { if (on) return; p.method = id; dirty(); K.toast(l + ' — ≈ ' + K.n0(n) + ' كريديت'); R(); } }, h('i'), h('span', null, l, h('small', { class: 'help' }, ' · ≈ ' + K.n0(n)))); }))),
      h('p', { class: 't-small help', style: 'margin:0' }, p.method === 'chained' ? 'نداء واحد بكل المشاهد (Seedance) — حركة متصلة من صورة أول مشهد.' : 'كل مشهد بيتولد لوحده من صورته، وبعدين بيتجمعوا.' + (chainedOk ? '' : ' Kling بيشتغل مشاهد منفصلة بس.')),
      timeline, av, jobsList, J && J.error ? U.InlineNote({ kind: 'warning', children: J.error }) : null,
      h('div', { class: 'cw-gen' }, h('div', { class: 'cw-prog', role: 'progressbar', 'aria-label': 'تقدّم الفيديو ' + p.n, 'aria-valuemin': '0', 'aria-valuemax': '3', 'aria-valuenow': String(step - 1) }, h('i', { style: 'width:' + Math.round((step - 1) / 2 * 100) + '%' })), h('span', { class: 't-small help', 'data-cw-vstep': String(step) }, busy ? 'شغّال على Magnific… (' + K.n0(J.open) + ')' : ['المشاهد لسه ما اتولدتش فيديو', 'المشاهد جاهزة — جمّعها', 'الفيديو جاهز'][step - 1]),
        busy ? Button({ size: 'sm', label: 'حدّث', attrs: { 'data-cw-vpoll': p.id }, onClick: () => vpoll(p, true) })
          : step === 1 ? Button({ type: 'primary', size: 'sm', icon: 'sparkle', label: 'توليد المشاهد', disabled: !can().create || !W.built(p), attrs: { 'data-cw-clips': p.id }, onClick: genClips })
          : step === 2 ? Button({ type: 'primary', size: 'sm', label: 'تجميع المشاهد', disabled: !can().create, attrs: { 'data-cw-assemble': p.id }, onClick: () => vrun(p, () => MK().videoAssemble(camp.id, p.id), 'بيتجمّع بالموسيقى والصوت على Magnific') })
          : h('div', { class: 'acts-inline' }, p.approved ? Button({ size: 'sm', label: 'رجّع للتعديل', onClick: () => { p.approved = false; persist(0); R(); } }) : Button({ type: 'primary', size: 'sm', icon: 'check', label: 'موافقة', attrs: { 'data-cw-ok': 'فيديو ' + p.n }, onClick: () => { p.approved = true; persist(0); R(); } }),
            Button({ size: 'sm', label: 'ولّد المشاهد تاني', attrs: { 'data-cw-clips-again': p.id }, onClick: () => { p.assembled = false; p.video = null; p.approved = false; camp.vjobs[p.id] = null; persist(0); genClips(); } }), final && final.bytes == null ? h('small', { class: 'help' }, 'الفيديو كبير — موجود على Magnific بس') : null)));
  }
  function w3() {
    ensurePieces(); const ps = camp.pieces;
    const G = { post: ps.filter((p) => p.kind === 'بوست' || p.kind === 'ملف إضافي'), carousel: ps.filter((p) => p.kind === 'كاروسيل'), video: ps.filter((p) => p.kind === 'فيديو') };
    const tabs = [['post', 'مراجعة البوستات'], ['carousel', 'مراجعة الكاروسيلز'], ['video', 'توليد الفيديوهات']].filter(([id]) => G[id].length);
    if (!tabs.some(([id]) => id === camp.rtab)) camp.rtab = tabs.length ? tabs[0][0] : 'post';
    const pr = W.progress(ps, W.approved); const ready = ps.filter((p) => W.approvable(p) && !W.approved(p)).length;
    const list = G[camp.rtab] || [];
    return [h('div', { class: 'cw-bar card' }, h('span', { 'data-cw-approved': pr.done + '/' + pr.total }, 'اتوافق على ', K.Num(pr.done + ' من ' + pr.total)), h('span', { class: 'grow' }),
      Button({ type: 'primary', size: 'sm', icon: 'check', label: 'وافق على كل الجاهز' + (ready ? ' (' + ready + ')' : ''), disabled: !ready, attrs: { 'data-cw-okall': '' }, onClick: () => { const n = W.approveAll(ps); persist(0); K.logEvent('mkt.campaign.approve_all', String(n)); K.toast('اتوافق على ' + n + ' قطع', 'success'); R(); } })),
      K.SubTabs({ label: 'المراجعة', active: camp.rtab, onChange: (id) => { camp.rtab = id; persist(); R(); }, items: tabs.map(([id, l]) => ({ id, label: l, count: G[id].filter(W.approved).length + '/' + G[id].length })) }),
      ...list.map((p) => (p.kind === 'كاروسيل' ? reviewCarousel(p) : p.kind === 'فيديو' ? reviewVideo(p) : reviewPost(p))),
      pr.done < pr.total ? U.InlineNote({ children: 'لازم توافق على كل القطع عشان تكمّل للنشر' + (G.video.some((p) => !p.video) ? ' — الفيديو بيتوافق عليه بعد تجميع المشاهد.' : '.') }) : null,
      Foot(3, 4, cback, 'متابعة للنشر', () => go('marketing-campaign-4'), !W.canReviewNext(ps))];
  }

  // ===== ٤. النشر والتحميل (decision 14: a download in 9.5.1) =====
  const cbx = (lab, on, fn) => { const c = K.Checkbox({ label: '', checked: on, onChange: fn }); c.setAttribute('aria-label', lab); return c; };
  const pieceLabel = (p) => p.kind + ' ' + p.n;
  // the ZIP (decision 14): a folder per piece — its images in order and caption.txt
  async function downloadZip(items, name) {
    if (!PD || !PD.zip) { K.toast('التنزيل مش متاح', 'error'); return; }
    K.toast('بيتجهز الفولدر…');
    const files = []; let missing = 0;
    for (const d of W.zipPlan(items)) {
      for (const f of d.files) { const r = await MK().blob(f.path); if (r.ok) files.push({ name: f.name, data: new Uint8Array(await r.blob.arrayBuffer()) }); else missing += 1; }
      files.push(d.caption);
    }
    K.saveFile(W.safeName(name) + '.zip', new Blob([PD.zip(files)], { type: 'application/zip' }));
    K.logEvent('mkt.download', items.length + ' items' + (missing ? ' · ' + missing + ' missing' : ''));
    K.toast(missing ? 'اتنزل الفولدر — ' + missing + ' صورة مااتنزلتش' : 'اتنزل فولدر «' + name + '»', missing ? 'error' : 'success');
  }
  const zipItem = (p) => ({ label: pieceLabel(p), images: p.kind === 'فيديو' && p.video ? [p.video] : W.pieceImages(p), caption: p.caption || camp.w.idea, tags: p.tags || W.TAGS });
  const pieceImg = (p) => (p.img || (p.kind === 'فيديو' ? W.pieceImages(p)[0] : null));
  function c5() {
    ensurePieces(); const cn = needConn();
    const sch = (p, i) => (camp.sched[p.id] = camp.sched[p.id] || Object.assign(W.suggest(i, TODAY()), { pl: ['انستجرام', 'فيسبوك'], how: ['انشر'] }));
    const canPub = (p, s) => (s.pl || []).some((pl) => pubOf(p, pl, cn).ok);
    const sel = camp.pubSel; const all = camp.pieces.length && camp.pieces.every((p) => sel.has(p.id));
    const rows = camp.pieces.map((p, i) => { const s = sch(p, i);
      const pub = canPub(p, s); const on = pub && Array.isArray(s.how) && s.how.includes('انشر');
      const why = pub ? null : ((s.pl || []).map((pl) => pubOf(p, pl, cn).why).find(Boolean) || 'اختار منصة الأول');
      const auto = (s.pl || []).filter((pl) => pubOf(p, pl, cn).ok);
      return [cbx('حدد ' + pieceLabel(p), sel.has(p.id), (v) => { v ? sel.add(p.id) : sel.delete(p.id); R(); }), h('span', { class: 'prod' }, Img(pieceImg(p)), h('span', null, h('b', null, pieceLabel(p)), h('small', null, W.hookOf(p)))),
        U.DateField({ id: 'sd-' + p.id, label: '', value: s.date, today: TODAY(), onChange: (v) => { s.date = v; persist(); R(); } }),
        U.Select({ id: 'st-' + p.id, label: '', options: W.timeOpts(s.time).map((x) => ({ value: x, label: x })), value: s.time, onChange: (v) => { s.time = v; persist(); R(); } }),
        h('div', { class: 'chips', 'data-cw-pl': p.id }, W.PLATFORMS.map((pl) => chip(pl, s.pl.includes(pl), () => { s.pl = s.pl.includes(pl) ? s.pl.filter((x) => x !== pl) : s.pl.concat(pl); persist(); R(); }))),
        h('div', { class: 'cw-how' }, h('div', { class: 'chips', 'data-cw-how': p.id },
          chip('انشر', on, () => { if (!pub) { K.toast(why, 'error'); return; } s.how = on ? ['داونلود'] : ['انشر']; persist(); R(); }, Object.assign({ 'data-cw-pub': p.id }, pub ? {} : { 'aria-disabled': 'true', title: why })),
          chip('داونلود', true, () => {}, { 'aria-disabled': 'true' })),
          on ? h('small', { class: 't-small help', 'data-cw-auto': p.id }, 'تلقائي: ' + auto.join(' · ')) : null),
        K.RowMenu([{ label: 'نزّل فولدر (الصور + التكست)', icon: 'download', run: () => downloadZip([zipItem(p)], pieceLabel(p)) },
          { label: 'انسخ الكابشن', icon: 'copy', run: () => { try { navigator.clipboard.writeText((p.caption || camp.w.idea) + '\n' + W.TAGS); } catch (e) { /* the clipboard is the browser's */ } K.toast('اتنسخ الكابشن'); } },
          { label: 'افتح القطعة', icon: 'edit', run: () => { camp.rtab = p.kind === 'كاروسيل' ? 'carousel' : p.kind === 'فيديو' ? 'video' : 'post'; go('marketing-campaign-3'); } }])]; });
    const sp = [...sel].map((id) => camp.pieces.find((p) => p.id === id)).filter(Boolean);
    const conn5 = connCard(Button({ label: 'نزّل الكل كفولدر (ZIP)', icon: 'download', attrs: { 'data-cw-zip': 'all' }, onClick: () => downloadZip(camp.pieces.map(zipItem), W.campaignName(camp.w.idea)) }));
    const pubSel = () => { let n = 0; sp.forEach((p) => { const s = camp.sched[p.id]; if (s && canPub(p, s)) { s.how = ['انشر']; n += 1; } }); persist(); R(); K.toast(n ? 'اتعلّم «انشر» على ' + n + ' قطعة' : 'المحدد مايتنشرش من السيستم دلوقتي — داونلود بس', n ? 'success' : 'error'); };
    const confirm = async () => {
      if (camp.busy.pub) return;
      const today = TODAY(), now = NOW();
      for (const p of camp.pieces) { const s = camp.sched[p.id]; if (!s || !s.pl.length) { K.toast('اختار منصة واحدة على الأقل لـ ' + pieceLabel(p), 'error'); return; }
        const e = W.moveCheck(null, s.date, s.time, today, now); if (e) { K.toast(pieceLabel(p) + ': ' + (e.day || e.time), 'error'); return; } }
      if (!(await ensureCampaign())) return;
      camp.busy.pub = true;
      try {
        persist(0); // the suggested times shown are the campaign's too (schedule() flushes it first)
        let items = W.scheduleItems(camp.pieces, camp.sched, camp.w.idea, conn());
        const pub = items.filter((x) => x.how === 'publish').length;
        if (pub) { // decision 33: Instagram takes JPEG only — the copies are made here, in the browser
          K.toast('بيجهّز الصور للنشر…');
          const prep = await MK().preparePublish(camp.id, items);
          if (!prep.ok) { K.toast(prep.message, 'error'); return; }
          items = prep.items;
        }
        const r = await MK().schedule(camp.id, items);
        if (!r.ok) { K.toast(r.message, 'error'); return; }
        K.toast(pub ? 'اتجدول ' + items.length + ' بوست — ' + pub + ' هيتنشروا لوحدهم في مواعيدهم' : 'اتجدول ' + items.length + ' بوست — نزّلهم وانشرهم في مواعيدهم، وعلّمهم «اتنشر» من سجل النشر', 'success'); go('marketing-publog');
      } finally { camp.busy.pub = false; }
    };
    const anyPub = camp.pieces.some((p) => { const s = camp.sched[p.id]; return s && Array.isArray(s.how) && s.how.includes('انشر') && canPub(p, s); });
    return [conn5,
      sp.length ? h('div', { class: 'bulk-bar' }, h('b', null, 'محدد ' + sp.length), h('span', { class: 'grow' }), Button({ type: 'primary', size: 'sm', icon: 'send', label: 'انشر المحدد', attrs: { 'data-cw-pub-sel': '' }, onClick: pubSel }), Button({ size: 'sm', icon: 'download', label: 'نزّل المحدد', onClick: () => downloadZip(sp.map(zipItem), W.campaignName(camp.w.idea)) }), Button({ size: 'sm', type: 'text', label: 'إلغاء التحديد', onClick: () => { sel.clear(); R(); } })) : null,
      h('section', { class: 'card sec cw-pub' }, h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, 'تفاصيل نشر الكامبين'), h('div', { class: 't-small sub' }, camp.pieces.length + ' عمل فني · اختار التاريخ والوقت والمنصات لكل واحد')), h('div', { class: 'acts' })),
        h('div', { class: 'sec-b' }, U.Table({ cls: 'dt', headers: [cbx('حدد الكل', !!all, (v) => { camp.pieces.forEach((p) => (v ? sel.add(p.id) : sel.delete(p.id))); R(); }), 'العمل الفني', 'التاريخ', 'الوقت', 'المنصات', 'الطريقة', ''], rows }))),
      U.InlineNote({ children: anyPub ? 'اللي عليه «انشر» بيتنشر لوحده في ميعاده على فيسبوك وانستجرام (الصور بتتجهز JPEG مع التأكيد)، والباقي بيتنزل كفولدر وتنشره بإيدك وتعلّمه «اتنشر» من سجل النشر. المواعيد مقترحة على أوقات النشاط الأعلى.'
        : 'النشر هنا داونلود: نزّل الفولدر وانشره بإيدك في ميعاده، وبعدها علّمه «اتنشر» من سجل النشر. المواعيد مقترحة على أوقات النشاط الأعلى.' }),
      can().publish ? null : U.InlineNote({ kind: 'warning', children: 'تأكيد النشر محتاج صلاحية «التسويق — النشر».' }),
      Foot(4, 4, cback, 'تأكيد النشر', confirm, !can().publish)];
  }

  // ---------- سجل النشر (decisions 15, 35–38): the system's posts and the platform's own, with their numbers ----------
  const srcTag = (x) => (x.src === 'platform' ? Tag('neutral', W.SRC_LABEL.platform) : Tag('brand', W.SRC_LABEL.system));
  const stTag = (x) => (x.busy && W.canMove(x) ? Tag('info', 'بيتنشر…') : Tag(x.status === 'اتنشر' ? 'success' : x.status === 'مجدول' ? 'gold' : x.status === 'اتحذف' ? 'neutral' : 'error', x.status));
  const PP_RATIO = { 'بوست': 'p45', 'كاروسيل': 'p11', 'ريل': 'p916', 'ستوري': 'p916' };
  const n0 = (v) => (v == null ? '—' : K.n0(v));
  // a log row's picture: the campaign's (the bucket) or the platform's own (https)
  const PostImg = (x, cls, alt) => (x.src === 'platform'
    ? (x.thumb ? h('span', { class: 'thumb ' + (cls || '') }, h('img', { src: x.thumb, alt: alt || '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : Img(null, cls))
    : Img(x.img, cls, alt));
  function postPreview(x) {
    const many = x.kind === 'كاروسيل' && x.images.length > 1;
    return h('figure', { class: 'pp ' + (PP_RATIO[x.kind] || 'p45'), 'data-post-preview': x.kind },
      h('div', { class: 'pp-h' }, h('span', { class: 'pp-av', 'aria-hidden': 'true' }, window.IBLogo ? window.IBLogo.Logo({ tone: 'reversed', width: 16, mark: true }) : 'إ'), h('span', { class: 'pp-who' }, h('b', null, 'ibtekr.club'), h('small', null, x.pl + ' · ' + x.kind))),
      h('div', { class: 'pp-img' }, x.img || x.thumb ? PostImg(x, 'fill', 'شكل ' + x.kind + ': ' + x.name) : h('span', { class: 'pp-none', role: 'img', 'aria-label': 'مفيش صورة' }, Icon('image')),
        many ? h('span', { class: 'pp-n' }, K.Num('1/' + x.images.length)) : null, x.kind === 'ستوري' ? h('span', { class: 'pp-bar', 'aria-hidden': 'true' }) : null),
      many ? h('div', { class: 'pp-dots', 'aria-hidden': 'true' }, x.images.slice(0, 10).map((_, k) => h('i', { class: k ? null : 'on' }))) : null,
      h('figcaption', { class: 'pp-cap' }, h('b', null, 'ibtekr.club '), h('span', { 'data-pp-cap': '' }, x.caption)));
  }
  // can the system publish this waiting post now: its platform ready (linked, permission, the switch), its images fit (Instagram: JPEG)
  function canPublishNow(x) {
    if (x.src !== 'system' || !W.canMove(x) || x.busy) return false;
    if (!W.publishable(x.kind, x.images, x.pl, conn(), { caption: x.caption, tags: x.tags }).ok) return false;
    return x.pl !== 'انستجرام' || x.images.every(W.isJpeg);
  }
  // the caption of a waiting post: saved as it is typed (≤ 2200), «إعادة كتابة بالـ AI», «رجّع الكابشن الأصلي»
  // its campaign as the AI's context while the campaign is open (an archived one: the caption alone)
  const ctxOf = (x) => (x.campaignId && MK().campaigns().some((c) => c.id === x.campaignId) ? { campaignId: x.campaignId, piece: x.piece, slide: null } : { campaignId: null });
  function captionBox(x, root) {
    const orig = x.capOrig; let tm = 0;
    const state = h('span', { class: 't-small help', 'aria-live': 'polite', 'data-cap-state': '' });
    const count = h('span', { class: 't-small help', dir: 'ltr', 'data-cap-count': '' });
    const reset = Button({ type: 'text', size: 'sm', icon: 'undo', label: 'رجّع الكابشن الأصلي', attrs: { 'data-cap-reset': '' }, onClick: () => { const t = root().querySelector('#pp-cap'); t.value = orig; t.dispatchEvent(new Event('input', { bubbles: true })); } });
    const upd = (v, saved) => { count.textContent = v.length + ' / ' + W.CAP_MAX; reset.hidden = v === orig; state.textContent = saved === true ? 'اتحفظ ✓' : saved === false ? 'بيتحفظ…' : '';
      const pv2 = root() && root().querySelector('[data-pp-cap]'); if (pv2) pv2.textContent = v; };
    const fld = aiField(U.Textarea({ id: 'pp-cap', label: '', rows: 4, value: x.caption, maxlength: W.CAP_MAX, help: 'بيتحفظ أول بأول — ده الكلام اللي هيتنشر', onInput: (v) => {
      upd(v, false); clearTimeout(tm); tm = setTimeout(async () => { const r = await MK().caption(x.id, v); upd(v, r.ok ? true : null); if (!r.ok) K.toast(r.message, 'error'); }, 800); } }), 'caption', ctxOf(x));
    const box = h('div', { class: 'pp-capbox', 'data-cap-box': '' }, h('div', { class: 'pp-caph' }, h('label', { for: 'pp-cap', class: 't-label' }, 'الكابشن')), fld, h('div', { class: 'pp-capf' }, count, state, h('span', { class: 'grow' }), reset));
    upd(x.caption, undefined); return box;
  }
  const dayLabel = W.dayLabel;
  function markPublished(x) {
    K.form({ title: 'اتنشر على ' + x.pl + '؟', values: { url: '' }, submitLabel: 'علّمه اتنشر',
      fields: (f, e, set) => [h('p', { class: 't-small help', style: 'margin:0' }, '«' + x.name + '» — علّمه بعد ما تنشره بإيدك على ' + x.pl + '.'), K.field.text('url', 'لينك البوست (اختياري)', f, e, set, { placeholder: 'https://…', dir: 'ltr' })],
      validate: (f) => (f.url && !/^https:\/\/[^\s<>"]+$/.test(f.url.trim()) ? { url: 'اللينك لازم يبدأ بـ https://' } : {}),
      submit: (f, m) => { if (m.busy) return false; m.busy = true; MK().published(x.id, f.url).then((r) => { m.busy = false; if (!r.ok) { K.toast(r.message, 'error'); return; } m.close(); K.toast('اتعلّم «اتنشر» على ' + x.pl, 'success'); R(); }); return false; } });
  }
  // «انشر دلوقتي» (decision 35): the same publishing, now
  let publishing = 0;
  async function publishNow(x, m) {
    if (publishing) return; publishing = x.id;
    if (m) m.close(); K.toast('بيتنشر على ' + x.pl + '…');
    try {
      const r = await MK().publishNow(x.id);
      if (!r.ok) { K.toast(r.message, 'error'); return; }
      K.toast(r.pending ? 'انستجرام بيجهّز البوست — هيتنشر لوحده خلال دقيقة' : 'اتنشر على ' + x.pl + ' ✓', 'success');
    } finally { publishing = 0; R(); }
  }
  function askDelete(x, m) {
    m.close(); const live = x.status === 'اتنشر'; const onPlatform = live && !!x.externalId && W.PUBLISHABLE.includes(x.pl);
    const p = (t) => h('p', { class: 't-body', style: 'margin:0' }, t); const small = (t) => h('p', { class: 't-small help', style: 'margin:0' }, t);
    const c = U.Modal({ title: onPlatform ? 'تحذف البوست من ' + x.pl + '؟' : live ? 'تشيل البوست من السجل؟' : 'تحذف البوست المجدول؟',
      body: onPlatform ? [p('«' + x.name + '» هيتشال من ' + x.pl + ' ومش هيرجع تاني.'), small('أرقامه لحد دلوقتي (المشاهدات والتفاعل) هتفضل في سجل النشر.')]
        : live ? [p('«' + x.name + '» هيتعلّم «اتحذف» في السجل.'), small('البوست ده اتعلّم «اتنشر» بالإيد — لو لسه على ' + x.pl + ' احذفه من التطبيق.')]
        : [p('«' + x.name + '» مش هيتنشر على ' + x.pl + ' يوم ' + dayLabel(x.day) + ' ' + x.time + '.'), small('لو عايز تنشره في يوم تاني استخدم «أجّل» بدل الحذف.')],
      footer: [Button({ label: 'ارجع', attrs: { 'data-post-del-cancel': '' }, onClick: () => { c.close(); pubDetail(x); } }), Button({ type: 'danger', icon: 'trash', label: onPlatform ? 'احذف البوست' : live ? 'شيله من السجل' : 'احذف من الجدول', attrs: { 'data-post-del-ok': '' }, onClick: async () => {
        c.close(); const r = onPlatform ? await MK().deleteLive(x.id) : await MK().remove(x.id);
        K.toast(r.ok ? (onPlatform ? 'اتحذف من ' + x.pl : live ? 'اتعلّم «اتحذف» في السجل' : 'اتشال من الجدول — مش هيتنشر') : r.message, r.ok ? 'success' : 'error'); R(); } })] });
  }
  async function reschedule(x, day, time) {
    const from = dayLabel(x.day) + ' ' + x.time; const later = day + time > x.day + x.time;
    const r = await MK().move(x.id, day, time);
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    K.toast((later ? 'اتأجّل' : 'اتقدّم') + ' من ' + from + ' لـ ' + dayLabel(day) + ' ' + time); return true;
  }
  function pubDetail(x0, mode, draft) {
    const x = MK().getPost(x0.id) || x0;
    const live = x.status === 'اتنشر', gone = x.status === 'اتحذف', wait = !live && !gone, had = W.seenSt(x); let m = null;
    const sys = x.src === 'system'; const P = can().publish; const cn = conn();
    const moving = wait && mode === 'move' && P && sys && !x.busy;
    const sub = h('p', { class: 't-small help', style: 'margin:0' }, K.Num(x.kind + ' · ' + (wait || (gone && !x.wasLive) ? 'ميعاده ' : 'اتنشر ') + D2(x.day) + ' ' + x.time), x.camp !== '—' ? ' · كامبين: ' + x.camp : '');
    const eng = W.engOf(x); const counted = x.statsAt || x.eng != null;
    const chips = had ? [['المشاهدات', n0(x.views)], ['التفاعل', counted ? K.n0(eng) : '—'], ['نسبة التفاعل', x.views ? W.pct(eng, x.views) : '—']]
      : x.status === 'فشل' ? [['كان ميعاده', dayLabel(x.day) + ' ' + x.time], ['اللي حصل', W.pubError(x.error)]]
      : gone ? [['كان ميعاده', dayLabel(x.day) + ' ' + x.time]] : [['الميعاد', dayLabel(x.day) + ' ' + x.time], ['فاضل', W.relDay(x.day, TODAY())]];
    const sum = h('div', { class: 'dt-sum' }, chips.map(([l, v]) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, l), h('b', null, K.Num(v)))));
    const table = had && counted ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'vlo-table dt-table', 'data-post-stats': '' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'المقياس'), h('th', { scope: 'col' }, 'العدد'))),
      h('tbody', null, [['لايك', x.likes], ['كومنت', x.comments], ['شير', x.shares], ['سيف', x.saves]].map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'nw' }, K.Num(n0(b)))))))) : null;
    const auto = wait && sys && x.how === 'publish';
    const noteText = gone ? (x.wasLive ? 'اتحذف من ' + x.pl + ' يوم ' + D2(x.delAt || TODAY()) + ' — الأرقام دي آخر قراية قبل الحذف.' : 'اتشال من الجدول يوم ' + D2(x.delAt || TODAY()) + ' قبل ما يتنشر.')
      : live ? (counted ? null : 'المشاهدات والتفاعل بتتحدث من المنصة كل نص ساعة.')
      : x.busy ? 'البوست بيتنشر دلوقتي على ' + x.pl + '…'
      : x.status === 'فشل' && !moving ? 'النشر فشل (' + W.pubError(x.error) + ') — «انشر دلوقتي» بيجرّب تاني على ' + x.pl + '، أو «أجّل» لميعاد جديد.'
      : auto ? 'هيتنشر لوحده على ' + x.pl + ' ' + dayLabel(x.day) + ' الساعة ' + x.time + '.' + (cn && !cn.autopublish ? ' النشر التلقائي متوقف دلوقتي — الأدمن يشغّله من كارت «الربط بالمنصات».' : '')
      : 'النشر بالإيد: نزّل الفولدر وانشره على ' + x.pl + ' في ميعاده، وبعدها «علّمه اتنشر».';
    const note = noteText ? U.InlineNote({ kind: x.status === 'فشل' ? 'error' : '', children: noteText }) : null;
    const dr = draft || { day: x.day < TODAY() ? TODAY() : x.day, time: x.time, err: {} };
    const dayBox = h('div'), timeBox = h('div');
    const drawDay = () => dayBox.replaceChildren(U.DateField({ id: 'pp-day', label: 'اليوم', required: true, value: dr.day, today: TODAY(), error: dr.err.day, onChange: (v, err) => { dr.day = v; dr.err = { day: err || '' }; drawDay(); drawTime(); } }));
    const drawTime = () => timeBox.replaceChildren(U.Select({ id: 'pp-time', label: 'الساعة', required: true, options: W.timeOpts(dr.time).map((t) => ({ value: t, label: t })), value: dr.time, error: dr.err.time, onChange: (v) => { dr.time = v; dr.err = {}; drawDay(); drawTime(); } }));
    if (moving) { drawDay(); drawTime(); }
    const moveBox = moving ? h('div', { class: 'pp-move', 'data-post-move-form': '' }, h('b', null, 'الميعاد الجديد'), h('p', { class: 't-small help', style: 'margin:0' }, 'الحالي: ' + dayLabel(x.day) + ' ' + x.time), h('div', { class: 'pp-move-row' }, dayBox, timeBox)) : null;
    const body = h('div', { class: 'pp-wrap' }, postPreview(x), h('div', { class: 'pp-info' }, h('div', { class: 'pp-st' }, stTag(x), srcTag(x)), sub, sum, table, wait && !moving && P && sys && !x.busy ? captionBox(x, () => m && m.el) : null, moveBox, note));
    const close = Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() });
    const dl = sys ? Button({ icon: 'download', label: 'نزّل', attrs: { 'data-post-dl': '' }, onClick: () => downloadZip([{ label: x.name, images: x.images, caption: x.caption, tags: x.tags }], x.name) }) : null;
    const open = x.url && (live || (gone && x.wasLive)) ? h('a', { class: 'btn btn-default', href: x.url, target: '_blank', rel: 'noopener noreferrer', 'data-post-open': '' }, 'افتح على ' + x.pl + ' ↗') : null;
    const del = (wait || live) && P && !x.busy ? Button({ type: 'danger', icon: 'trash', label: wait ? 'احذف' : x.externalId && W.PUBLISHABLE.includes(x.pl) ? 'احذف البوست' : 'شيله من السجل', attrs: { 'data-post-del': '' }, onClick: () => askDelete(x, m) }) : null;
    if (del) del.classList.add('pp-del');
    const nowBtn = wait && P && canPublishNow(x) ? Button({ type: 'primary', icon: 'send', label: 'انشر دلوقتي', attrs: { 'data-post-publish': '' }, onClick: () => publishNow(x, m) }) : null;
    const markBtn = wait && P && sys && !x.busy ? Button({ type: nowBtn ? 'text' : 'primary', icon: nowBtn ? undefined : 'check', label: 'علّمه اتنشر', attrs: { 'data-post-published': '' }, onClick: () => { m.close(); markPublished(x); } }) : null;
    const foot = moving ? [Button({ type: 'primary', icon: 'check', label: 'احفظ الميعاد', attrs: { 'data-post-move-save': '' }, onClick: async () => { const e = W.moveCheck(x, dr.day, dr.time, TODAY(), NOW()); if (e) { dr.err = e; drawDay(); drawTime(); return; } m.close(); if (await reschedule(x, dr.day, dr.time)) { R(); pubDetail(x); } } }),
        Button({ label: 'ارجع', attrs: { 'data-post-move-cancel': '' }, onClick: () => { m.close(); pubDetail(x); } })]
      : wait && P && sys && !x.busy ? [nowBtn, markBtn, Button({ icon: 'calendar', label: 'أجّل', attrs: { 'data-post-move': '' }, onClick: () => { m.close(); pubDetail(x, 'move'); } }), dl, close, del].filter(Boolean)
      : [open, dl, close, del].filter(Boolean);
    m = U.Modal({ title: x.name + ' — ' + x.pl, body, footer: foot });
    m.el.classList.add('mid'); m.el.dataset.post = String(x.id);
    if (moving) setTimeout(() => { const f = document.getElementById('pp-day'); if (f) f.focus(); }, 0);
    return m;
  }
  function publogTab() {
    needConn();
    const q = (M.plq || '').trim(); const all = MK().posts();
    const list = all.filter((x) => !q || (x.name + x.camp + x.pl + x.kind).includes(q)).slice().sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
    const cnt = (s) => list.filter((x) => x.status === s).length; const T = W.postTotals(list);
    const sb = h('input', { type: 'search', id: 'pl-q', placeholder: 'دوّر باسم البوست أو الكامبين', 'aria-label': 'بحث في سجل النشر', value: M.plq || '' });
    sb.addEventListener('input', () => { M.plq = sb.value; R(); setTimeout(() => { const s = document.getElementById('pl-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    const seen = (x) => W.seenSt(x) && (x.statsAt || x.eng != null);
    const rows = list.map((x) => [h('button', { type: 'button', class: 'prod link-btn', onClick: () => pubDetail(x), 'aria-label': 'تفاصيل ' + x.name, 'data-post-row': String(x.id) }, PostImg(x), h('span', null, h('b', null, x.name), h('small', null, x.kind))),
      x.pl, K.Num(D2(x.day) + ' ' + x.time), srcTag(x), x.camp, stTag(x),
      K.Num(W.seenSt(x) ? n0(x.views) : '—'), K.Num(seen(x) ? K.n0(W.engOf(x)) : '—'), K.Num(seen(x) && x.views ? W.pct(W.engOf(x), x.views) : '—'),
      K.RowMenu([{ label: 'التفاصيل', icon: 'eye', run: () => pubDetail(x) },
        x.src === 'system' ? { label: 'نزّل الفولدر', icon: 'download', run: () => downloadZip([{ label: x.name, images: x.images, caption: x.caption, tags: x.tags }], x.name) } : null,
        x.url ? { label: 'افتح على ' + x.pl, icon: 'link', run: () => { try { window.open(x.url, '_blank', 'noopener'); } catch (e) { /* a blocked popup */ } } } : null,
        { label: 'انسخ الكابشن', icon: 'copy', run: () => { try { navigator.clipboard.writeText(x.caption + (x.tags ? '\n' + x.tags : '')); } catch (e) { /* the clipboard is the browser's */ } K.toast('اتنسخ الكابشن'); } }].filter(Boolean))]);
    return [h('div', { class: 'cards four', 'data-publog-kpis': '' },
      U.KpiTile({ label: 'اتنشر', value: String(cnt('اتنشر')), unit: 'بوست', compare: 'off', note: cnt('مجدول') + ' مجدول · ' + cnt('فشل') + ' فشل' + (cnt('اتحذف') ? ' · ' + cnt('اتحذف') + ' اتحذف' : '') }),
      U.KpiTile({ label: 'المشاهدات', value: K.n0(T.views), compare: 'off', note: 'كل المنصات' }),
      U.KpiTile({ label: 'التفاعل', value: K.n0(T.eng), compare: 'off', note: 'لايك + كومنت + شير + سيف' }),
      U.KpiTile({ label: 'نسبة التفاعل', value: W.pct(T.eng, T.views), compare: 'off', note: 'التفاعل ÷ المشاهدات' })),
      // decision 41: the link and the switch here too — no campaign needed to re-link the page or turn the publishing on
      connCard(null),
      h('div', { class: 'toolbar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), sb), Button({ label: 'افتح الخطة الإعلانية', icon: 'calendar', onClick: () => go('marketing-calendar') })),
      Card('سجل النشر', 'كل اللي اترفع على السوشيال — من السيستم أو من المنصة مباشرة · المشاهدات والتفاعل بتتحدث من المنصة كل نص ساعة',
        list.length ? U.Table({ cls: 'dt pub-tbl', headers: ['العمل الفني', 'المنصة', 'اتنشر / هيتنشر', 'المصدر', 'الكامبين', 'الحالة', 'المشاهدات', 'التفاعل', 'نسبة التفاعل', ''], rows }) : K.Empty(all.length ? 'مفيش بوست بالاسم ده' : 'لسه مفيش بوستات', all.length ? 'جرّب كلمة تانية.' : 'جدول كامبين من «إنشاء» وهتلاقي بوستاتها هنا.'))];
  }

  // ---------- الخطة الإعلانية (decision 16): the weeks of the period, drag a waiting post to another day ----------
  let dragAt = 0;
  const RB = () => window.IBReportBlocks || {};
  const planRange = () => (RB().rangeOf ? RB().rangeOf('plan') : W.planDefault(TODAY()));
  function calDrag(e, x) {
    if (!W.canMove(x) || x.src !== 'system' || x.busy || !can().publish || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget; const sx = e.clientX, sy = e.clientY, id = e.pointerId, touch = e.pointerType === 'touch';
    const g = { on: false, over: null, ghost: null, timer: 0 };
    const mark = (d) => { document.querySelectorAll('.cal-day.drop-ok, .cal-day.drop-no').forEach((n) => n.classList.remove('drop-ok', 'drop-no')); if (d && d.dataset.calDay !== x.day) d.classList.add(d.hasAttribute('data-cal-drop') ? 'drop-ok' : 'drop-no'); };
    const at = (cx, cy) => { if (g.ghost) g.ghost.style.visibility = 'hidden'; const t = document.elementFromPoint(cx, cy); if (g.ghost) g.ghost.style.visibility = ''; return t && t.closest('[data-cal-day]'); };
    const place = (cx, cy) => { if (g.ghost) g.ghost.style.transform = 'translate(' + Math.round(cx - g.w / 2) + 'px,' + Math.round(cy - 16) + 'px)'; };
    const begin = () => { g.on = true; g.w = el.offsetWidth; el.classList.add('dragging'); document.body.classList.add('cal-dragging');
      g.ghost = el.cloneNode(true); g.ghost.classList.add('cal-ghost'); g.ghost.removeAttribute('data-cal-it'); g.ghost.setAttribute('aria-hidden', 'true'); g.ghost.style.width = g.w + 'px'; document.body.append(g.ghost); place(sx, sy);
      try { if (touch && navigator.vibrate) navigator.vibrate(10); } catch (er) { /* ignore */ } };
    const end = () => { clearTimeout(g.timer); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true); el.removeEventListener('touchmove', hold);
      if (g.ghost) g.ghost.remove(); el.classList.remove('dragging'); document.body.classList.remove('cal-dragging'); mark(null); };
    const move = (ev) => { if (ev.pointerId !== id) return;
      if (!g.on) { const far = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6; if (touch) { if (far) end(); return; } if (!far) return; begin(); }
      ev.preventDefault(); place(ev.clientX, ev.clientY); const d = at(ev.clientX, ev.clientY); if (d !== g.over) { g.over = d; mark(d); }
      const edge = 72; if (ev.clientY < edge) window.scrollBy(0, -16); else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 16); };
    const up = (ev) => { if (ev.pointerId !== id) return; const was = g.on; const d = was ? at(ev.clientX, ev.clientY) : null; end(); if (!was) return; dragAt = Date.now();
      if (!d || d.dataset.calDay === x.day) return;
      if (!d.hasAttribute('data-cal-drop')) { K.toast(d.dataset.calDay < TODAY() ? 'مينفعش تنقل بوست ليوم فات' : 'اليوم ده برّه الفترة'); return; }
      askMove(x, d.dataset.calDay); };
    const cancel = (ev) => { if (ev.pointerId === id) end(); };
    const hold = (ev) => { if (g.on && ev.cancelable) ev.preventDefault(); };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
    if (touch) { el.addEventListener('touchmove', hold, { passive: false }); g.timer = setTimeout(begin, 350); }
  }
  function askMove(x, day) {
    const from = { day: x.day, time: x.time }; const later = day > from.day; const dr = { time: from.time };
    let m = null; const err = h('p', { class: 'err-msg', role: 'alert', 'data-move-err': '' });
    const timeBox = h('div'); const drawTime = () => timeBox.replaceChildren(U.Select({ id: 'mv-time', label: 'الساعة', options: W.timeOpts(dr.time).map((t) => ({ value: t, label: t })), value: dr.time, onChange: (v) => { dr.time = v; err.textContent = ''; drawTime(); } })); drawTime();
    const short = W.DAYS[W.dayIdx(day)] + ' ' + D2(day).slice(0, 5);
    m = U.Modal({ title: (later ? 'تأجّل' : 'تقدّم') + ' ميعاد النشر لـ ' + dayLabel(day) + '؟',
      body: [h('div', { class: 'mv-sum' }, Img(x.img), h('span', null, h('b', null, x.name + ' — ' + x.pl), h('small', { class: 'help' }, K.Num('من ' + dayLabel(from.day) + ' ' + from.time + ' لـ ' + dayLabel(day))))), timeBox, err],
      footer: [Button({ type: 'primary', icon: 'calendar', label: (later ? 'أجّل لـ ' : 'قدّم لـ ') + short, attrs: { 'data-move-ok': '' }, onClick: async () => {
        const e = W.moveCheck(x, day, dr.time, TODAY(), NOW()); if (e) { err.textContent = e.time || e.day; return; }
        m.close(); if (await reschedule(x, day, dr.time)) R(); } }),
        Button({ label: 'ليس الآن', attrs: { 'data-move-no': '' }, onClick: () => m.close() })] });
    m.el.dataset.move = String(x.id);
  }
  function calendarTab() {
    const r = planRange(); const from = r.from, to = r.to; const srcF = M.calsrc || 'all'; const posts = MK().posts().filter((x) => srcF === 'all' || x.src === srcF);
    const movable = (x) => W.canMove(x) && x.src === 'system' && !x.busy;
    const items = (d) => posts.filter((x) => x.day === d).sort((a, b) => a.time.localeCompare(b.time));
    const weeks = W.weeksOf(from, to); const inR = (d) => d >= from && d <= to; const today = TODAY();
    const total = weeks.flatMap((w) => Array.from({ length: 7 }, (_, i) => W.addD(w, i))).filter(inR).reduce((n, d) => n + items(d).length, 0);
    const item = (x) => h('button', { type: 'button', class: 'cal-it ' + (x.src === 'platform' ? 'platform' : 'system') + (x.status === 'فشل' ? ' fail' : x.status === 'مجدول' ? ' sched' : x.status === 'اتحذف' ? ' del' : '') + (movable(x) ? ' mv' : ''), 'data-cal-it': String(x.id), 'data-cal-src': x.src, 'data-cal-move': movable(x) ? '' : null,
      onClick: () => { if (Date.now() - dragAt < 400) return; pubDetail(x); }, onPointerdown: (e) => calDrag(e, x), onContextmenu: (e) => { if (movable(x)) e.preventDefault(); },
      'aria-label': x.time + ' ' + x.name + ' — ' + x.pl + ' — ' + x.status + ' — ' + W.SRC_LABEL[x.src] + (movable(x) ? ' — افتحه ودوس «أجّل» أو اسحبه ليوم تاني' : '') },
      h('span', { class: 'cal-t' }, K.Num(x.time), h('span', { class: 'cal-pl' }, x.pl)), h('b', null, x.name), h('span', { class: 'cal-m' }, x.kind, ' · ', x.status));
    const cell = (d, i) => { const on = inR(d); const L = on ? items(d) : [];
      return h('div', { class: 'cal-day' + (on ? '' : ' off') + (d === today ? ' today' : '') + (on && d < today ? ' past' : ''), role: 'listitem', 'data-cal-day': d, 'aria-disabled': on ? null : 'true', 'data-cal-drop': on && d >= today ? '' : null, 'aria-label': W.DAYS[i] + ' ' + D2(d) + (on ? ' — ' + L.length + ' نشر' : ' — برّه الفترة') },
        h('div', { class: 'cal-dh' }, h('b', { class: 'cal-dn' }, W.DAYS[i]), h('span', null, K.Num(D2(d).slice(0, 5))), d === today ? Tag('brand', 'النهارده') : null),
        on ? h('div', { class: 'cal-list' }, L.length ? L.map(item) : h('span', { class: 'cal-empty t-small help' }, 'مفيش نشر')) : null); };
    const rows = weeks.map((w, k) => { const days = Array.from({ length: 7 }, (_, i) => W.addD(w, i)); const n = days.filter(inR).reduce((c, d) => c + items(d).length, 0);
      return h('section', { class: 'cal-row', 'data-cal-week': w, 'aria-label': 'الأسبوع ' + (k + 1) }, h('div', { class: 'cal-rh' }, h('b', null, 'الأسبوع ' + (k + 1)), h('span', { class: 't-small help' }, K.Num(D2(w) + ' – ' + D2(W.addD(w, 6)))), h('span', { class: 'grow' }), Tag(n ? 'brand' : 'neutral', n + ' نشر')),
        h('div', { class: 'cal-wk', role: 'list' }, days.map(cell))); });
    const bar = h('div', { class: 'toolbar cal-bar' }, RB().rangeField ? RB().rangeField('plan') : null,
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'المصدر', 'data-cal-src-filter': '' }, [['all', 'الكل'], ['system', W.SRC_LABEL.system], ['platform', W.SRC_LABEL.platform]].map(([v, l]) => chip(l, srcF === v, () => { M.calsrc = v; R(); }, { role: 'radio', 'aria-checked': String(srcF === v), 'data-src': v }))),
      h('span', { class: 't-small help', 'data-cal-count': String(total) }, K.Num(weeks.length + ' أسابيع · ' + total + ' نشر في الفترة')));
    return [bar, h('div', { class: 'cal-legend t-small help' }, h('span', null, h('i', { class: 'lg system' }), W.SRC_LABEL.system), h('span', null, h('i', { class: 'lg platform' }), W.SRC_LABEL.platform), h('span', null, h('i', { class: 'lg sched' }), 'مجدول'), h('span', null, h('i', { class: 'lg off' }), 'برّه الفترة'),
      h('span', { class: 'cal-tip', 'data-cal-tip': '' }, can().publish ? 'اسحب البوست المجدول ليوم تاني عشان تغيّر ميعاده' : '')),
      h('div', { class: 'cal-head', 'aria-hidden': 'true' }, W.DAYS.map((d) => h('span', null, d))), h('div', { class: 'cal-rows' }, rows)];
  }

  // ---------- قوالب التصميم (decision 17) ----------
  const TPL_KINDS = [['post', 'بوست'], ['carousel', 'كاروسيل'], ['video', 'فيديو']];
  const kindL = (k) => (TPL_KINDS.find((x) => x[0] === k) || [, k])[1];
  const tplImg = (x) => Img(x.img, 'fill', '');
  function editTpl(x, o) {
    const isNew = !x; o = o || {}; let file = null; let previewUrl = null;
    K.form({ title: isNew ? 'قالب تصميم جديد' : 'تعديل «' + x.name + '»', wide: true, submitLabel: isNew ? 'احفظ القالب' : 'احفظ',
      values: x ? { name: x.name, kind: x.kind, img: x.img, desc: x.desc } : { name: '', kind: o.kind || 'post', img: '', desc: '' },
      fields: (f, e, set) => {
        const inp = h('input', { type: 'file', class: 'sr-file', id: 'tpl-up', accept: 'image/png,image/jpeg,image/webp', onChange: () => { const fl = inp.files[0]; if (!fl) return; if (!/^image\/(png|jpeg|webp)$/.test(fl.type)) { K.toast('ارفع صورة (PNG / JPG / WebP)', 'error'); return; } file = fl; try { previewUrl = URL.createObjectURL(fl); } catch (er) { previewUrl = null; } set('img', 'local:' + fl.name, true); if (!f.name) set('name', fl.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), true); } });
        const pvEl = f.img ? (file && previewUrl ? h('img', { src: previewUrl, alt: 'الصورة المرجعية', class: 'tpl-img' }) : Img(f.img, 'fill', 'الصورة المرجعية')) : null;
        return [h('div', { class: 'tpl-edit' }, h('div', { class: 'tpl-up' }, pvEl ? h('div', { class: 'tpl-pv' }, pvEl) : null,
            h('label', { class: (pvEl ? 'btn btn-default sm' : 'drop') + (e.img ? ' err' : ''), for: 'tpl-up', tabindex: '0', role: 'button', 'data-tpl-drop': '', onKeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); inp.click(); } } }, Icon('upload', pvEl ? 'sm' : undefined), h(pvEl ? 'span' : 'b', null, pvEl ? 'غيّر الصورة' : 'ارفع الصورة المرجعية'), pvEl ? null : h('small', null, 'بوست أو كاروسيل عاجبك')), inp, e.img ? h('p', { class: 'err-msg', role: 'alert' }, e.img) : null),
          h('div', { class: 'stack' }, K.field.text('name', 'اسم القالب', f, e, set, { required: true, maxlength: 80 }),
            U.FieldShell({ id: 'tpl-kind', label: 'قالب لـ', required: true }, h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'نوع القالب', 'data-tpl-kind': '' }, TPL_KINDS.map(([v, l]) => chip(l, f.kind === v, () => set('kind', v, true), { role: 'radio', 'aria-checked': String(f.kind === v), 'data-kind': v })))),
            aiField(K.field.area('desc', 'الشرح', f, e, set, { rows: 4, required: true, maxlength: 1000, help: 'الـ AI بيستخدم الشرح ده عشان يطلّع نفس الستايل — عدّله براحتك' }), 'desc', { campaignId: null }),
            h('div', { class: 'acts-inline start' }, Button({ size: 'sm', icon: 'sparkle', label: f.desc ? 'اشرحها تاني بالـ AI' : 'اشرحها بالـ AI', disabled: !f.img || !can().create, attrs: { 'data-tpl-ai': '' }, onClick: async () => {
              const blob = file || (f.img && !/^local:/.test(f.img) ? (await MK().blob(f.img)).blob : null);
              const photo = blob && window.IBAI && window.IBAI.photoOf ? await window.IBAI.photoOf(blob) : null;
              if (!photo) { K.toast('مقدرتش أقرا الصورة', 'error'); return; }
              const r = await MK().write(null, { task: 'describe', kind: 'desc', image: { media_type: photo.media_type, data: photo.data } });
              if (!r.ok || !r.text) { K.toast(r.message || 'الـ AI ماردش — جرّب تاني', 'error'); return; }
              set('desc', r.text, true); K.toast('اتكتب الشرح — راجعه', 'success'); } }), f.img ? null : h('span', { class: 't-small help' }, 'ارفع الصورة الأول'))))];
      },
      validate: (f) => Object.assign(K.req(f, ['name', 'desc']), f.img ? {} : { img: 'ارفع الصورة المرجعية' }),
      // K.form closes on a non-false answer: the upload and the save run here, and the popup closes when they succeed
      submit: (f, m) => {
        if (m.busy) return false; m.busy = true;
        (async () => {
          let img = f.img;
          if (file) { const up = await MK().uploadTemplate(file); if (!up.ok) { m.busy = false; K.toast(up.message, 'error'); return; } img = up.path; file = null; f.img = img; }
          const v = { name: f.name.trim(), kind: f.kind, img, desc: f.desc.trim() };
          const r = isNew ? await MK().addTemplate(v) : await MK().editTemplate(x.id, v);
          m.busy = false; if (!r.ok) { K.toast(r.message, 'error'); return; }
          m.close(); K.toast(isNew ? 'اتحفظ القالب' : 'اتحفظ', 'success'); R(); if (o.onSaved) setTimeout(() => o.onSaved(r.template), 0);
        })();
        return false;
      } });
  }
  function templatesTab() {
    const k = M.tplk || 'all'; const q = (M.tplq || '').trim(); const TPLS = MK().templates(); const C = can();
    const list = TPLS.filter((x) => (k === 'all' || x.kind === k) && (!q || (x.name + x.desc).includes(q)));
    const sb = h('input', { type: 'search', id: 'tpl-q', placeholder: 'دوّر في القوالب', 'aria-label': 'بحث في قوالب التصميم', value: M.tplq || '' });
    sb.addEventListener('input', () => { M.tplq = sb.value; R(); setTimeout(() => { const s = document.getElementById('tpl-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    const card = (x) => h('section', { class: 'card tpl-card', 'data-tpl': x.id }, h('div', { class: 'tpl-pv' }, tplImg(x), h('span', { class: 'tpl-kind' }, Tag('brand', kindL(x.kind)))),
      h('div', { class: 'tpl-b' }, h('h3', { class: 't-h6' }, x.name), h('p', { class: 't-small help tpl-d' }, x.desc), h('span', { class: 't-small help' }, 'اتستخدم ' + x.used + ' مرة · ' + D2(x.at))),
      C.create ? h('div', { class: 'acts-inline start tpl-acts' }, Button({ size: 'sm', icon: 'edit', label: 'تعديل', attrs: { 'data-tpl-edit': x.id }, onClick: () => editTpl(x) }),
        Button({ size: 'sm', type: 'text', label: 'حذف', attrs: { 'data-tpl-del': x.id }, onClick: () => K.confirm({ title: 'تحذف قالب «' + x.name + '»؟', text: 'الكامبينات اللي استخدمته مش هتتأثر.', okLabel: 'احذف', okType: 'danger', onOk: async () => { const r = await MK().removeTemplate(x.id); K.toast(r.ok ? 'اتحذف القالب' : r.message, r.ok ? 'success' : 'error'); R(); } }) })) : null);
    return [h('div', { class: 'toolbar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), sb),
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'النوع' }, [['all', 'الكل']].concat(TPL_KINDS).map(([v, l]) => chip(l + ' (' + (v === 'all' ? TPLS.length : TPLS.filter((x) => x.kind === v).length) + ')', k === v, () => { M.tplk = v; R(); }, { role: 'radio', 'aria-checked': String(k === v) }))),
      h('span', { class: 'grow' }), C.create ? Button({ type: 'brand', icon: 'plus', label: 'قالب جديد', attrs: { 'data-tpl-add': '' }, onClick: () => editTpl(null) }) : null),
      list.length ? h('div', { class: 'tpl-grid' }, list.map(card)) : K.Empty(TPLS.length ? 'مفيش قالب بالاسم ده' : 'لسه مفيش قوالب', TPLS.length ? 'جرّب كلمة تانية أو نوع تاني.' : 'ارفع صورة عاجباك واشرحها بالـ AI — هتلاقيها بعد كده في «أمثلة للمطابقة» في الكامبين.')];
  }
  // اختيار قالب من «أمثلة للمطابقة» في الكامبين (owner 2 Nov 00:03): صفوف بالعرض + «قالب جديد» من البوب أب
  function pickTpl(kind, arr, fresh) {
    const L = MK().templates().filter((x) => x.kind === kind);
    const row = (x) => h('button', { type: 'button', class: 'tpl-opt' + (x.id === fresh ? ' fresh' : ''), 'data-tpl-pick': x.id, onClick: async () => {
      if (!arr.some((f) => f.t === 'tpl' && f.tpl === x.id)) arr.push({ t: 'tpl', name: 'قالب: ' + x.name, tpl: x.id });
      m.close(); MK().templateUsed(x.id); persist(); K.toast('اتحط «' + x.name + '» في أمثلة للمطابقة', 'success'); R(); } },
      h('div', { class: 'tpl-pv' }, tplImg(x)), h('div', { class: 'tpl-opt-b' }, h('span', { class: 'tpl-opt-h' }, h('b', null, x.name), x.id === fresh ? Tag('success', 'جديد') : null), h('small', { class: 'help' }, x.desc), h('span', { class: 't-small help tpl-opt-m' }, 'اتستخدم ' + x.used + ' مرة · ' + D2(x.at))));
    const add = () => { m.close(); editTpl(null, { kind, onSaved: (t) => pickTpl(kind, arr, t && t.kind === kind ? t.id : null) }); };
    const m = U.Modal({ title: 'اختار قالب تصميم — ' + kindL(kind), body: [L.length ? h('div', { class: 'tpl-pick', role: 'list' }, L.map(row)) : K.Empty('مفيش قوالب ' + kindL(kind) + ' لسه', 'ارفع صورة عاجباك واعملها قالب من هنا.')],
      footer: [Button({ label: 'اقفل', onClick: () => m.close() }), h('span', { class: 'grow' }), Button({ type: 'text', label: 'روح لقوالب التصميم', onClick: () => { m.close(); go('marketing-templates'); } }), Button({ type: 'brand', icon: 'plus', label: 'قالب جديد', attrs: { 'data-tpl-pick-add': '' }, onClick: add })] });
    if (fresh) setTimeout(() => { const el = document.querySelector('.modal [data-tpl-pick="' + fresh + '"]'); if (el) { el.scrollIntoView({ block: 'nearest' }); el.focus(); } }, 0);
  }

  // ---------- 9.5.3 (decisions 44–47): «نظرة عامة» and «التقارير» — Meta Ads' own numbers (mkt-ads: read-only, every hour) next to
  // WooCommerce's orders of the same campaign (utm_campaign = Meta's campaign id), in the reports page's period. No action on money:
  // the media buyer's alerts say what the rules see, the change is made in Meta's Ads Manager. The reports page's «الحملات الإعلانية»
  // draws the same blocks (reportBlocks — one source) ----------
  const perm = (k) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(k) : 'N');
  const moneyOk = () => isAdmin() || perm('accounts.view') !== 'N';
  const n2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const adRange = () => { const r = RB().rangeOf ? RB().rangeOf('reports') : null; return r && r.from && r.to ? r : { from: W.addD(TODAY(), -29), to: TODAY() }; };
  const perLabel = (rg) => 'من ' + D2(rg.from) + ' لحد ' + D2(rg.to);
  // the v6 header (owner 11 Nov): a quick period on the reports' period (today / this week from Saturday / this month) compared with the
  // period before it of the same length, and the ad platform (all / Meta / TikTok / Google) — the overview and the reports
  const PERIODS = [['today', 'اليوم · مقارنة بأمس', 'today', 'أمس'], ['week', 'الأسبوع ده · مقارنة باللي فات', 'thisWeek', 'نفس الأيام من الأسبوع اللي فات'], ['month', 'الشهر ده · مقارنة باللي فات', 'thisMonth', 'نفس الأيام من الشهر اللي فات']];
  const periodRange = (k, t) => (k === 'today' ? { from: t, to: t } : k === 'week' ? { from: W.wkStart(t), to: t } : { from: t.slice(0, 8) + '01', to: t });
  const periodOf = (rg) => { const t = TODAY(); const p = PERIODS.find(([k]) => { const r = periodRange(k, t); return r.from === rg.from && r.to === rg.to; }); return p ? p[0] : 'custom'; };
  const spanOf = (rg) => Math.round((Date.parse(rg.to + 'T00:00:00Z') - Date.parse(rg.from + 'T00:00:00Z')) / 864e5) + 1;
  const prevOf = (rg) => { const n = spanOf(rg); return { from: W.addD(rg.from, -n), to: W.addD(rg.from, -1) }; };
  const COMPARE_MAX = 92; // a period up to 3 months is compared with the one before it (its days load with it)
  const loadRange = (rg) => (spanOf(rg) <= COMPARE_MAX ? { from: prevOf(rg).from, to: rg.to } : rg);
  function setPeriod(k) {
    const cur = RB().rangeOf ? RB().rangeOf('reports') : null; const p = PERIODS.find((x) => x[0] === k); if (!cur || !p) return;
    Object.assign(cur, periodRange(k, TODAY()), { preset: p[2] }); // the reports page's own period object — its picker shows the same preset
    R();
  }
  const PLATS = [['all', 'الكل'], ['meta', 'ميتا'], ['tiktok', 'تيك توك'], ['google', 'جوجل']];
  // the rows of the chosen platform only (the stats, the ads and campaigns, the Woo ad orders)
  function byPlat(r, k) {
    if (!r || k === 'all') return r;
    const on = (x) => (x && (x.platform || 'meta')) === k;
    return Object.assign({}, r, { stats: (r.stats || []).filter(on), objects: (r.objects || []).filter(on), orders: (r.orders || []).filter((o) => o && o.platform === k) });
  }
  const AD = { key: null, r: null, at: 0, busy: false, gen: 0, syncing: false };
  let adsAsk = 0;
  // the period's numbers, loaded once per period and fresh for 5 minutes; a new period drops the old numbers, a reload keeps them meanwhile
  function adsLoad(rg, redraw, force) {
    const key = rg.from + '|' + rg.to;
    if (AD.key === key && AD.busy) return;
    if (!force && AD.key === key && AD.r && Date.now() - AD.at < 300000) return;
    if (AD.key !== key) AD.r = null;
    AD.key = key; AD.busy = true; const g = ++AD.gen;
    Promise.resolve().then(() => MK().adsData(rg)).catch(() => ({ ok: false, reason: 'network', message: 'حصلت مشكلة في الاتصال — جرّب تاني' }))
      .then((r) => { if (g !== AD.gen) return; AD.busy = false; AD.r = r; if (r && r.ok) r.rg = rg; AD.at = Date.now(); if (redraw) redraw(); });
  }
  // the link's state (mkt-ads status, cached by the adapter): its answer emits ib:marketing, which redraws this page; `redraw` is the reports page's
  function adsState(redraw) {
    if (Date.now() - adsAsk > 60000) { adsAsk = Date.now(); MK().adsStatus().then((r) => { if (r && r.ok && redraw) redraw(); }); }
    return MK().adsNow();
  }
  function redrawAds(tries) {
    if (window.IBPages.current !== 'marketing' || st.view !== 'hub' || (st.tab !== 'overview' && st.tab !== 'reports')) return;
    if (document.querySelector('.scrim')) { if ((tries || 0) < 30) setTimeout(() => redrawAds((tries || 0) + 1), 1000); return; }
    R();
  }
  const atLabel = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return null; const p = Object.fromEntries(fmtC.formatToParts(new Date(t)).map((x) => [x.type, x.value])); const d = p.year + '-' + p.month + '-' + p.day; return (d === TODAY() ? 'النهارده' : D2(d).slice(0, 5)) + ' ' + p.hour + ':' + p.minute; };
  const syncLine = (s) => (!s ? 'آخر مزامنة: بيتحمّل…' : !s.configured ? 'مفيش منصة إعلانات مربوطة · ووكومرس لايف'
    : 'آخر مزامنة: ' + AD_KEYS.filter((k) => s.platforms[k].configured).map((k) => AD_NAME[k] + ' ' + (atLabel(s.platforms[k].syncedAt) || 'لسه')).join(' · ') + ' · ووكومرس لايف');
  // Meta's statuses in words — a campaign (feminine) or an ad (masculine)
  const AD_ST = { ACTIVE: ['شغالة', 'شغال', 'success'], PAUSED: ['متوقفة', 'متوقف', 'neutral'], CAMPAIGN_PAUSED: ['متوقفة', 'متوقف', 'neutral'], ADSET_PAUSED: ['متوقفة', 'متوقف', 'neutral'],
    ARCHIVED: ['مقفولة', 'مقفول', 'neutral'], DELETED: ['اتمسحت', 'اتمسح', 'neutral'], IN_PROCESS: ['بتتجهز', 'بيتجهز', 'info'], PENDING_REVIEW: ['بتتراجع', 'بيتراجع', 'info'], PREAPPROVED: ['بتتراجع', 'بيتراجع', 'info'],
    DISAPPROVED: ['اترفضت', 'اترفض', 'error'], WITH_ISSUES: ['فيها مشكلة', 'فيه مشكلة', 'orange'], PENDING_BILLING_INFO: ['مستنية الدفع', 'مستني الدفع', 'orange'] };
  const stOf = (s, ad) => { const x = AD_ST[s]; return x ? [x[ad ? 1 : 0], x[2]] : [s || '—', 'neutral']; };
  const SRC_NAME = { fb: 'فيسبوك', facebook: 'فيسبوك', ig: 'انستجرام', instagram: 'انستجرام', an: 'Audience Network', msg: 'ماسنجر', messenger: 'ماسنجر', th: 'ثريدز', threads: 'ثريدز', google: 'جوجل', tiktok: 'تيك توك' };
  const srcText = (m) => Object.entries(m || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => (SRC_NAME[k] || k || 'من غير مصدر') + ' ' + K.n0(n)).join(' · ');
  // 9.5.6: the linked platforms (the status) decide whose spend counts; before the status lands, the platforms with numbers
  const linkedOf = (s) => (s && Array.isArray(s.linked) && s.linked.length ? s.linked : undefined);
  function adCalc(r0, rg, s, plat) {
    const pl = plat || M.plat; const today = TODAY(); const end = rg.to < today ? rg.to : today; const r = byPlat(r0, pl);
    const linked = pl === 'all' ? linkedOf(s) : (linkedOf(s) || []).filter((k) => k === pl);
    const show = (t) => (pl === 'all' ? t : Object.assign(t, { platforms: t.platforms.filter((p) => p.key === pl) }));
    const t = show(W.adTotals(r.stats, r.orders, rg, moneyOk(), linked)); const camps = W.adCampaignRows(r.objects, r.stats, r.orders, rg);
    // the period before, of the same length — only when its days were loaded with this one (loadRange)
    const pv = prevOf(rg); const lr = r0.rg || null; const prev = lr && lr.from <= pv.from && lr.to >= rg.to ? show(W.adTotals(r.stats, r.orders, pv, moneyOk(), linked)) : null;
    return { rg, t, prev, pv, camps, alerts: W.adAlerts(r.objects, r.stats, r.orders, rg, end), weeks: W.merWeeks(r.stats, r.orders, rg.to, 5, linked), creatives: W.adCreatives(r.objects, r.stats, rg),
      loose: Math.max(0, t.metaOrders - camps.reduce((n, x) => n + x.orders, 0)) };
  }
  const AD_NAME = W.AD_PLATFORM; const AD_KEYS = ['meta', 'tiktok', 'google'];
  const linkedNames = (t) => t.platforms.filter((p) => p.linked).map((p) => p.label).join(' · ');
  function adsGate(rg, redraw) {
    if (!AD.r) return [U.InlineNote({ children: 'بنحمّل أرقام الإعلانات…' })];
    if (!AD.r.ok) return [K.Empty('مقدرناش نحمّل أرقام الإعلانات', AD.r.message || 'حصلت مشكلة في الاتصال.', Button({ size: 'sm', label: 'جرّب تاني', attrs: { 'data-ads-retry': '' }, onClick: () => { AD.r = null; AD.at = 0; adsLoad(rg, redraw, true); if (redraw) redraw(); } }))];
    return null;
  }
  const adsNote = (s) => (s && !s.configured ? U.InlineNote({ kind: 'warning', children: 'مفيش منصة إعلانات مربوطة لسه — الصرف وأرقام المنصات هيظهروا لما الأدمن يربط الحسابات من «حالة الربط» تحت (ميتا · تيك توك · جوجل). أوردرات ووكومرس اللي جاية من إعلانات ظاهرة من دلوقتي.' })
    : s && s.anyError ? U.InlineNote({ kind: 'warning', children: AD_KEYS.filter((k) => s.platforms[k].configured && s.platforms[k].error).map((k) => { const p = s.platforms[k]; return p.why + (p.syncedAt ? ' — أرقام ' + AD_NAME[k] + ' من آخر مزامنة نجحت (' + atLabel(p.syncedAt) + ').' : ''); }).join(' · ') }) : null);
  const adsSource = () => h('p', { class: 'source t-small help mk-src' }, 'المصادر: Meta Ads · TikTok Ads · Google Ads (قراية بس — المربوط منهم بيتحدث كل ساعة) + ووكومرس (مصدر الأوردر / UTM: utm_campaign = رقم الحملة على المنصة) · المبيعات من غير الملغي والمرتجع والفاشل' + (moneyOk() ? ' · نصيب إبتكر بنفس حساب «الحسابات»' : '') + '.');
  async function adsSyncNow(redraw) {
    if (AD.syncing) return; AD.syncing = true; if (redraw) redraw();
    const r = await MK().adsSync();
    AD.syncing = false;
    K.toast(r.ok ? 'اتزامنت أرقام الإعلانات — ' + K.n0(r.campaigns) + ' حملة · ' + K.n0(r.ads) + ' إعلان' : r.message, r.ok ? 'success' : 'error');
    AD.at = 0; adsLoad(loadRange(adRange()), redraw, true); if (redraw) redraw();
  }
  function adsBar(s, redraw) {
    return h('div', { class: 'toolbar ads-bar' }, RB().rangeField ? RB().rangeField('reports') : null, U.FreshnessNote(syncLine(s)), h('span', { class: 'grow' }),
      isAdmin() ? Button({ size: 'sm', label: AD.syncing ? 'بيزامن…' : 'مزامنة دلوقتي', disabled: AD.syncing || !!(s && !s.configured), attrs: { 'data-ads-sync': '' }, onClick: () => adsSyncNow(redraw) }) : null);
  }
  function adKpis(c) {
    const t = c.t; const det = (title, headers, rows, total) => () => ({ title: title + ' — ' + perLabel(c.rg), headers, rows, total });
    // the comparison with the period before (the v6 header): the change in %, its tone by what is good (sales up, the order's cost down)
    const cap = (PERIODS.find((x) => x[0] === periodOf(c.rg)) || [, , , 'الفترة اللي قبلها (' + perLabel(c.pv) + ')'])[3];
    const cmp = (now, was, goodUp) => { if (!c.prev || now == null || was == null || !(was > 0)) return { compare: 'off' };
      const d = Math.round((now - was) / was * 100); return { compare: d === 0 || goodUp == null ? 'neutral' : (d > 0) === goodUp ? 'positive' : 'negative', delta: { text: (d > 0 ? '+' : '') + d + '%', caption: 'عن ' + cap } }; };
    const P = c.prev || {};
    const tiles = [
      U.KpiTile(Object.assign({ label: 'الصرف الإعلاني', value: n2(t.spend), unit: 'ج.م', compare: 'off', note: linkedNames(t) ? linkedNames(t) + (t.platforms.some((p) => !p.linked) ? ' · الباقي مش مربوط' : '') : 'مفيش منصة مربوطة', details: det('الصرف الإعلاني', ['المنصة', 'الصرف (ج.م)'], t.platforms.map((p) => [p.label, p.linked ? n2(p.spend) : 'مش مربوطة']), ['الإجمالي', n2(t.spend)]) }, cmp(t.spend, P.spend, null))),
      U.KpiTile(Object.assign({ label: 'مبيعات ووكومرس من الإعلانات', value: n2(t.sales), unit: 'ج.م', compare: 'off', note: U.num(K.n0(t.orders) + ' أوردر مصدرها إعلان (UTM)' + (t.cancelled ? ' · ' + K.n0(t.cancelled) + ' اتلغى' : '')),
        details: det('مبيعات ووكومرس من الإعلانات', ['المنصة', 'الأوردرات', 'المبيعات (ج.م)', 'المصدر'], t.platforms.map((p) => [p.label, K.n0(p.orders), n2(p.sales), srcText(p.sources) || '—']), ['الإجمالي', K.n0(t.orders), n2(t.sales), '']) }, cmp(t.sales, P.sales, true))),
      U.KpiTile(Object.assign({ label: 'العائد الحقيقي (MER)', value: t.mer == null ? '—' : t.mer.toFixed(2), unit: t.mer == null ? undefined : '×', compare: 'off', note: U.num('مبيعات حملات المنصات المربوطة ÷ صرفها · المنصات بتقول ' + W.xr(t.roas)) }, cmp(t.mer, P.mer, true))),
      U.KpiTile(Object.assign({ label: 'تكلفة الأوردر الحقيقية', value: t.cpa == null ? '—' : n2(t.cpa), unit: t.cpa == null ? undefined : 'ج.م', compare: 'off', note: U.num('المنصات بتقول ' + (t.platformCpa == null ? '—' : K.n0(t.platformCpa)) + ' · الحد المقبول ' + K.n0(W.ADS_RULES.maxCpa)) }, cmp(t.cpa, P.cpa, false))),
      t.profit == null ? null : U.KpiTile({ label: 'الربح بعد الإعلانات', value: n2(t.profit), unit: 'ج.م', compare: 'off', note: 'نصيب إبتكر من أوردرات الإعلانات − الصرف',
        details: det('الربح بعد الإعلانات', ['البند', 'ج.م'], [['نصيب إبتكر من أوردرات الإعلانات (المنصات المربوطة)', n2(t.metaShare)], ['الصرف الإعلاني', '− ' + n2(t.spend)]], ['الربح', n2(t.profit)]) })].filter(Boolean);
    return h('div', { class: 'cards ' + (tiles.length === 5 ? 'five' : 'four'), 'data-rgroup': 'kpis', 'data-ads-kpis': String(tiles.length) }, tiles);
  }
  // 9.5.6 (decisions 67 / 71): each platform's real state; the admin links / edits / unlinks from here — the fields go to Vault through the server
  function platformRow(s, k) {
    const n = AD_NAME[k]; const p = s && s.platforms ? s.platforms[k] : null;
    if (!s) return [n + ' — بيتحمّل…', 'حالة الربط بتتقري', 'neutral', 'clock'];
    if (!p || !p.configured) return [n + ' — مش مربوطة', (p && p.oauth ? 'بيانات التطبيق محفوظة — كمّل بزرار الربط' : 'أوردراتها من ووكومرس (UTM) بتتحسب · الأدمن بيربط الحساب من هنا'), 'neutral', 'clock'];
    if (p.error) return [n + ' — آخر مزامنة ' + (atLabel(p.syncedAt) || 'لسه'), p.why, 'orange', 'alert'];
    return [n + ' — متصلة', (p.account && p.account.name ? 'حساب ' + p.account.name + ' · ' : p.account && p.account.id ? 'حساب ' + p.account.id + ' · ' : '') + 'آخر مزامنة ' + (atLabel(p.syncedAt) || 'لسه') + ' · كل ساعة', p.account && p.account.status && p.account.status !== 'ACTIVE' ? 'orange' : 'success', 'users'];
  }
  function adsConnCard(s, c) {
    const rows = AD_KEYS.map((k) => [k].concat(platformRow(s, k))).concat([[null, 'ووكومرس — لايف', 'مصدر الأوردر (UTM) شغال · ' + K.n0(c.t.orders) + ' أوردر من إعلانات في الفترة', 'success', 'users']]);
    const acct = s ? AD_KEYS.filter((k) => s.platforms[k].configured && s.platforms[k].account && s.platforms[k].account.status && s.platforms[k].account.status !== 'ACTIVE').map((k) => U.InlineNote({ kind: 'warning', children: 'حساب الإعلانات على ' + AD_NAME[k] + ' حالته: ' + s.platforms[k].account.status })) : null;
    const state = !s ? 'loading' : !s.configured ? 'off' : s.anyError ? 'error' : 'ok';
    const acts = (k) => { if (!isAdmin() || !s || k == null) return null; const p = s.platforms[k];
      return h('span', { class: 'acts-inline mk-acts' }, Button({ size: 'sm', type: p.configured ? 'default' : 'primary', label: p.configured ? 'عدّل البيانات' : 'اربط', attrs: { 'data-ads-link': k }, onClick: () => linkPopup(k) }),
        p.configured || Object.keys(p.fields || {}).length ? Button({ size: 'sm', type: 'text', label: 'فصل', attrs: { 'data-ads-unlink': k }, onClick: () => unlinkAsk(k) }) : null); };
    return Card('حالة الربط', 'الإعلانات قراية بس — مفيش أي تغيير على المنصات من هنا · بيانات الربط بتتحفظ مشفّرة على السيرفر (Vault) ومابتظهرش تاني',
      [h('div', { class: 'mk-list', 'data-ads-conn': state }, rows.map(([k, t, sub, tone, ic]) => h('div', { class: 'mk-item', 'data-ads-platform': k || 'woo' }, h('span', { class: 'mk-ic tone-' + tone }, Icon(ic, 'sm')), h('span', { class: 'mk-txt' }, h('b', null, t), h('small', null, sub)), acts(k))))].concat(acct || []));
  }
  // the admin's popup of a platform: its fields (a stored secret shows its tail and stays unless typed over), «احفظ», the OAuth button, «فصل»
  function linkPopup(k) {
    const s = adsState(null); const p = s && s.platforms ? s.platforms[k] : null; const stored = (p && p.fields) || {}; const vals = {}; let busy = false;
    const fields = W.AD_LINK_FIELDS[k] || [];
    const inputs = fields.map((f) => U.TextInput({ id: 'ads-' + k + '-' + f.key, label: f.label, type: f.secret ? 'password' : 'text', value: !f.secret && stored[f.key] ? stored[f.key] : '', placeholder: f.secret && stored[f.key] ? 'محفوظ ' + stored[f.key] + ' — سيبه فاضي عشان يفضل' : f.placeholder || '', help: f.help || null, autocomplete: 'off', dir: 'ltr', onInput: (v) => { vals[f.key] = v; } }));
    const redirect = s && s.redirect ? s.redirect : 'https://operation-system.ibtekr.club/ads-callback.html';
    const notes = [k === 'meta' ? 'مفتاح System User من Business Portfolio بصلاحية ads_read (وads_management لو عايز الميديا باير ينفّذ) — بيعلو على سر السيرفر.' : 'سجّل رابط الرجوع ده في التطبيق: ' + redirect, k === 'google' ? 'الـ developer token لازم يكون Basic access على الأقل عشان يقرا حساب حقيقي (من Google Ads API Center).' : null].filter(Boolean);
    const save = async (thenOauth) => {
      if (busy) return; busy = true;
      const body = W.linkFieldsBody(k, vals, stored);
      const r = await MK().adsLinkSet(k, body);
      if (!r.ok) { busy = false; K.toast(r.message, 'error'); return; }
      if (thenOauth) { const o = await MK().adsLinkStart(k); busy = false; if (!o.ok) { K.toast(o.message, 'error'); return; } m.close(); location.assign(o.url); return; }
      busy = false; m.close(); K.toast(r.platform.configured ? 'اتحفظ الربط — المزامنة الجاية هتسحب أرقام ' + AD_NAME[k] : 'اتحفظت البيانات — كمّل الربط عشان الأرقام تتسحب', 'success'); R();
    };
    const cand = p && p.candidates && p.candidates.length ? U.InlineNote({ kind: 'warning', children: 'المنصة عرضت أكتر من حساب — اختار واحد:', action: h('span', { class: 'acts-inline' }, p.candidates.map((cnd) => Button({ size: 'sm', label: (cnd.name ? cnd.name + ' · ' : '') + cnd.id, attrs: { 'data-ads-pick': cnd.id }, onClick: async () => { const r = await MK().adsLinkPick(k, cnd.id); K.toast(r.ok ? 'اتربط حساب ' + cnd.id : r.message, r.ok ? 'success' : 'error'); if (r.ok) { m.close(); R(); } } }))) }) : null;
    const m = U.Modal({ title: 'ربط ' + AD_NAME[k] + ' إعلانات', body: [h('div', { class: 'stack', 'data-ads-link-form': k }, inputs)].concat(notes.map((t) => U.InlineNote({ children: t }))).concat(cand ? [cand] : []),
      footer: [Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'احفظ', attrs: { 'data-ads-save': k }, onClick: () => save(false) }), W.AD_OAUTH[k] ? Button({ type: 'brand', label: W.AD_OAUTH[k], attrs: { 'data-ads-oauth': k }, onClick: () => save(true) }) : null] });
  }
  function unlinkAsk(k) {
    K.confirm({ title: 'تفصل ' + AD_NAME[k] + '؟', text: 'بيانات الربط هتتمسح من السيرفر والأرقام القديمة هتفضل في السجل؛ تقدر تربط تاني في أي وقت.', okLabel: 'افصل', okType: 'danger',
      onOk: async () => { const r = await MK().adsUnlink(k); K.toast(r.ok ? 'اتفصلت ' + AD_NAME[k] : r.message, r.ok ? 'success' : 'error'); R(); } });
  }
  function merChart(c) {
    const w = c.weeks; const max = Math.max(0, ...w.map((x) => x.mer || 0)); const lab = (x) => D2(x.from).slice(0, 5) + '–' + D2(x.to).slice(0, 5);
    return U.ChartCard({ title: 'العائد الحقيقي (MER) آخر 5 أسابيع', subtitle: 'مبيعات ووكومرس من حملات ميتا ÷ صرفها · لحد ' + D2(c.rg.to), footnote: 'الأحدث على اليسار · أعلى أسبوع باللون الأخضر · «—» = مفيش صرف في الأسبوع',
      body: h('div', { class: 'cols', role: 'img', 'data-ads-mer': String(w.length), 'aria-label': w.map((x) => lab(x) + ': ' + W.xr(x.mer)).join('، ') }, w.map((x) => h('div', { class: 'col' + (max > 0 && x.mer === max ? ' hi' : '') },
        h('span', { class: 't-label' }, U.num(W.xr(x.mer))), h('i', { style: 'height:' + (max > 0 && x.mer ? Math.max(4, Math.round(x.mer / max * 140)) : 4) + 'px' }), h('span', { class: 't-small' }, U.num(lab(x)))))) });
  }
  function spendChart(c) {
    const t = c.t;
    return U.ChartCard({ title: 'الصرف حسب المنصة', subtitle: 'المبيعات من كل منصة: ' + t.platforms.map((p) => p.label + ' ' + K.n0(p.sales)).join(' · ') + ' ج.م', footnote: t.platforms.some((p) => !p.linked) ? 'المنصة اللي مش مربوطة: أوردراتها من ووكومرس (UTM) بتتحسب، والصرف لما الأدمن يربط حسابها من «حالة الربط»' : 'الصرف من المنصات التلاتة · أوردراتها من ووكومرس (UTM)',
      body: h('div', { class: 'bars', 'data-ads-spend': '' }, t.platforms.map((p, i) => U.BarRow({ tone: p.linked ? ['brand', 'gold', 'goldlight'][i] : 'neutral', label: p.label, value: p.linked ? n2(p.spend) + ' ج.م' : 'مش مربوطة', pct: p.linked && t.spend ? p.spend / t.spend : 0 }))) });
  }
  // the suggested decision of a platform (the v6 prototype): its media buyer's open suggestions, the weightiest first; a press opens it
  const SG_RANK = { stop: 0, budget_down: 1, tracking: 2, creative: 3, budget_up: 4 };
  const sgSort = (L) => L.slice().sort((a, b) => (SG_RANK[a.kind] ?? 9) - (SG_RANK[b.kind] ?? 9));
  const sgBtn = (L, attr) => { if (!L.length) return '—'; const x = L[0];
    return h('button', Object.assign({ type: 'button', class: 'tg tg-' + (SG_UI[x.kind] || SG_UI.tracking)[1] + ' tg-btn', onClick: () => openSugg(x) }, attr), U.num(sgShort(x)), L.length > 1 ? [' ', U.num('+' + (L.length - 1))] : null); };
  function vsCard(c) {
    byLoad(false); const pend = byPending();
    const t = c.t; const diff = (p) => (p.linked && p.purchases ? Math.round((p.orders - p.purchases) / p.purchases * 100) + '%' : '—');
    const rows = t.platforms.map((p) => [p.label, p.linked ? K.Num(n2(p.spend)) : h('span', { class: 't-small help' }, 'مش مربوطة'), K.Num(p.linked ? K.n0(p.purchases) : '—'), K.Num(K.n0(p.orders)), K.Num(diff(p)), K.Num(W.xr(p.roas)), K.Num(W.xr(p.mer)),
      sgBtn(sgSort(pend.filter((x) => (x.platform || 'meta') === p.key)), { 'data-ads-vs-sugg': p.key })]);
    return Card('المنصة بتقول × ووكومرس', 'المشتريات اللي المنصة بتحسبها قصاد الأوردرات الحقيقية من نفس المصدر (UTM) · ' + perLabel(c.rg), [
      U.Table({ cls: 'dt ads-vs', headers: ['المنصة', 'الصرف (ج.م)', 'مشتريات المنصة', 'أوردرات ووكومرس', 'الفرق', 'عائد المنصة', 'العائد الحقيقي', 'القرار المقترح'], rows,
        totalRow: ['الإجمالي', K.Num(n2(t.spend)), K.Num(K.n0(t.purchases)), K.Num(K.n0(t.orders)), '', K.Num(W.xr(t.roas)), K.Num(W.xr(t.mer)), ''] }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الفرق = (أوردرات ووكومرس − مشتريات المنصة) ÷ مشتريات المنصة · العائد الحقيقي = مبيعات ووكومرس من المنصة ÷ صرفها · القرار المقترح = أهم اقتراح مستني موافقتك من الميديا باير على المنصة')]);
  }
  function asstCards() {
    byLoad(false); const pend = byPending(); const r = BY.rules; const reqs = BY.reqs || [];
    const kinds = (L) => { const c = {}; L.forEach((x) => { c[x.kind] = (c[x.kind] || 0) + 1; }); return Object.entries(c).map(([k, n]) => K.n0(n) + ' ' + (SG_UI[k] || SG_UI.tracking)[2]).join(' · ') || 'مفيش حاجة مستنية'; };
    const reqRows = (kind) => { const L = reqs.filter((q) => q.kind === kind && q.status !== 'خلص'); return L.length ? L.slice(0, 3).map((q) => [q.title, q.status + (q.project ? ' · ' + q.project : ''), 'طلب', REQ_ST[q.status] || 'neutral']) : [['مفيش طلبات مفتوحة', kind === 'designer' ? 'اطلب بوست أو فيديو' : 'اطلب صفحة أو تعديل', 'طلب', 'neutral']]; };
    const asst = (title, sub, items, label, onClick) => Card(title, sub, [h('div', { class: 'mk-list' }, items.map(([t, x, tag, tone]) => h('div', { class: 'mk-item' }, h('span', { class: 'mk-ic tone-' + tone }, Icon(tone === 'success' ? 'users' : 'clock', 'sm')), h('span', { class: 'mk-txt' }, h('b', null, t), h('small', null, U.num(x))), h('span', { class: 't-small help mk-tag' }, tag))))], Button({ type: 'text', size: 'sm', label, onClick }));
    return h('div', { class: 'grid3', 'data-ads-assistants': BY.sugg ? 'live' : 'loading' },
      asst('الميديا باير', 'تقرير يومي · اقتراحات بموافقتك · حدود صرف', [[K.n0(pend.length) + ' اقتراح مستني موافقتك', kinds(pend), 'اقتراحات', pend.length ? 'orange' : 'success'], ['حد الصرف اليومي: ' + (r ? K.n0(r.dailyCap) + ' ج.م' : '…'), 'أي زيادة فوقه بتترفض', 'قاعدة', 'success'],
        ['التنفيذ على ميتا: ' + (r ? (r.live ? 'شغّال' : 'متوقف') : '…'), r && r.live ? 'الموافقة بتتنفّذ فورًا' : 'الموافقة بتتسجل من غير تغيير', 'مفتاح', r && r.live ? 'success' : 'neutral']], 'افتح الميديا باير', () => { BY.aiTab = 'buyer'; go('marketing-ai'); }),
      asst('الديزاينر', 'بوستات وفيديوهات بالبراند · Magnific', reqRows('designer'), can().create ? '+ طلب للديزاينر' : 'افتح الديزاينر', () => { if (can().create) reqForm('designer'); else { BY.aiTab = 'designer'; go('marketing-ai'); } }),
      asst('المبرمج', 'صفحات الموقع وتطوير مشاريع إبتكر · Staging الأول', reqRows('dev'), can().create ? '+ طلب للمبرمج' : 'افتح المبرمج', () => { if (can().create) reqForm('dev'); else { BY.aiTab = 'dev'; go('marketing-ai'); } }));
  }
  function campDetail(x) {
    U.DetailsModal({ title: x.name + ' — ' + x.platform, sub: 'الحالة: ' + stOf(x.status)[0] + ' · ' + K.n0(x.days.length) + ' يوم فيه صرف أو أوردرات' + (srcText(x.sources) ? ' · الأوردرات: ' + srcText(x.sources) : ''),
      summary: [{ label: 'الصرف', value: n2(x.spend) }, { label: 'مشتريات المنصة', value: K.n0(x.purchases) }, { label: 'أوردرات ووكومرس', value: K.n0(x.orders) }, { label: 'العائد الحقيقي', value: W.xr(x.mer) }],
      headers: ['اليوم', 'الصرف (ج.م)', 'مشتريات المنصة', 'أوردرات ووكومرس'], rows: x.days.slice().reverse().map((d) => [W.DAYS[W.dayIdx(d.day)] + ' ' + D2(d.day).slice(0, 5), n2(d.spend), K.n0(d.purchases), K.n0(d.orders)]),
      total: ['الإجمالي', n2(x.spend), K.n0(x.purchases), K.n0(x.orders)], source: x.platform + ' (رقم الحملة ' + x.id + ') + أوردرات ووكومرس اللي الـ utm_campaign بتاعها نفس الرقم' });
  }
  const CAMP_H = ['الحملة', 'المنصة', 'الحالة', 'الصرف (ج.م)', 'مشتريات المنصة', 'أوردرات ووكومرس', 'العائد الحقيقي', 'تكلفة الأوردر', 'القرار المقترح'];
  function campTable(c, list) {
    byLoad(false); const sg = {}; byPending().forEach((x) => { (sg[x.campaign_id] = sg[x.campaign_id] || []).push(x); });
    const tot = list.reduce((a, x) => ({ spend: a.spend + x.spend, purchases: a.purchases + x.purchases, orders: a.orders + x.orders, sales: a.sales + x.sales }), { spend: 0, purchases: 0, orders: 0, sales: 0 });
    const rows = list.map((x) => { const [sl, tone] = stOf(x.status); const S = sg[x.id] || [];
      return [h('button', { type: 'button', class: 'link-btn', 'data-ads-camp': x.id, onClick: () => campDetail(x) }, x.name), x.platform, Tag(tone, sl), K.Num(n2(x.spend)), K.Num(K.n0(x.purchases)), U.num(K.n0(x.orders) + (x.cancelled ? ' (+' + K.n0(x.cancelled) + ' اتلغى)' : '')),
        K.Num(W.xr(x.mer)), K.Num(x.cpa == null ? '—' : K.n0(x.cpa)), S.length ? sgBtn(S, { 'data-mk-camp-sugg': String(S[0].id) }) : '—']; });
    return Card('الحملات — ' + K.n0(list.length), 'أرقام المنصات جنب أوردرات ووكومرس الحقيقية من نفس الحملة (utm_campaign) · ' + perLabel(c.rg), [
      list.length ? U.Table({ cls: 'dt ads-camps', headers: CAMP_H, rows, totalRow: ['الإجمالي', '', '', K.Num(n2(tot.spend)), K.Num(K.n0(tot.purchases)), K.Num(K.n0(tot.orders)), K.Num(W.xr(tot.spend ? tot.sales / tot.spend : null)), K.Num(tot.orders ? K.n0(tot.spend / tot.orders) : '—'), ''] })
        : K.Empty(c.camps.length ? 'مفيش حملات بالفلاتر دي' : 'مفيش حملات في الفترة دي', c.camps.length ? 'غيّر الفلاتر أو امسحها.' : 'مفيش صرف ولا أوردرات من حملات الإعلانات ' + perLabel(c.rg) + ' — غيّر الفترة من فوق.'),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الضغط على حملة بيفتح أيامها (الصرف · مشتريات المنصة · الأوردرات الحقيقية) · القرار المقترح من الميديا باير (بيتجدد مع كل مزامنة) ومحتاج موافقة الأدمن — التنفيذ على ميتا بس' + (c.loose ? ' · ' + K.n0(c.loose) + ' أوردر من إعلانات من غير رقم حملة في الـ UTM (محسوبين في «نظرة عامة» بس)' : ''))]);
  }
  function crDetail(x, c) {
    const fq = x.frequency == null ? '—' : x.frequency.toFixed(2);
    U.DetailsModal({ title: x.name, sub: 'حملة ' + x.campaign + ' · ' + perLabel(c.rg), summary: [{ label: 'الصرف', value: n2(x.spend) }, { label: 'الظهور', value: K.n0(x.impressions) }, { label: 'النقرات (CTR)', value: x.ctr == null ? '—' : (x.ctr * 100).toFixed(2) + '%' }, { label: 'عائد ميتا', value: W.xr(x.roas) }],
      headers: ['المقياس', 'القيمة'], rows: [['النقرات على اللينك', K.n0(x.clicks)], ['التكرار', fq], ['مشتريات ميتا', K.n0(x.purchases)], ['قيمة مشتريات ميتا (ج.م)', n2(x.value)], ['الحالة', x.tired ? 'الناس زهقت منه' : stOf(x.status, true)[0]]],
      note: x.tired ? 'التكرار ' + fq + ' — الناس شافوا الإعلان ده كتير؛ جرّب نسخة جديدة من «إنشاء».' : null, source: 'Meta Ads (رقم الإعلان ' + x.id + ')' });
  }
  const crTip = () => U.InlineNote({ children: 'العائد الحقيقي لكل إعلان (من ووكومرس) محتاج utm_content={{ad.id}} في لينكات الإعلانات على ميتا — لحد كده العائد هنا بتاع ميتا، والعائد الحقيقي في «الحملات».' }); // inside the card: a loose note floats to the top of the reports page
  function crTable(c) {
    const L = c.creatives; const tot = L.reduce((a, x) => ({ spend: a.spend + x.spend, imp: a.imp + x.impressions, clicks: a.clicks + x.clicks, purchases: a.purchases + x.purchases }), { spend: 0, imp: 0, clicks: 0, purchases: 0 });
    const th = (x) => h('span', { class: 'cr-th' }, x.thumb ? h('span', { class: 'thumb fill' }, h('img', { src: x.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : Img(null, 'fill'));
    const rows = L.map((x) => { const [sl, tone] = x.tired ? ['الناس زهقت منه', 'orange'] : stOf(x.status, true);
      return [h('button', { type: 'button', class: 'cr-cell link-btn', 'data-ads-ad': x.id, 'aria-label': 'تفاصيل ' + x.name, onClick: () => crDetail(x, c) }, th(x), h('span', { class: 'cr-tx' }, h('b', null, x.name), h('small', { class: 'help' }, x.campaign))),
        Tag(tone, sl), K.Num(n2(x.spend)), K.Num(K.n0(x.impressions)), K.Num(x.ctr == null ? '—' : (x.ctr * 100).toFixed(2) + '%'), K.Num(x.frequency == null ? '—' : x.frequency.toFixed(2)), K.Num(K.n0(x.purchases)), K.Num(W.xr(x.roas)),
        K.RowMenu([{ label: 'التفاصيل', icon: 'eye', run: () => crDetail(x, c) }])]; });
    return Card('تفاصيل الأعمال الفنية', K.n0(L.length) + ' إعلان فيه صرف · ' + K.n0(tot.imp) + ' ظهور · ' + n2(tot.spend) + ' ج.م صرف · ' + perLabel(c.rg),
      [crTip(), L.length ? U.Table({ cls: 'dt cr-tbl ads-cr', headers: ['الإعلان', 'الحالة', 'الصرف (ج.م)', 'الظهور', 'النقرات (CTR)', 'التكرار', 'مشتريات ميتا', 'عائد ميتا', ''], rows }) : K.Empty('مفيش إعلانات فيها صرف في الفترة دي', 'غيّر الفترة من فوق.')]);
  }
  function overviewTab() {
    const rg = adRange(); const s = adsState(null); adsLoad(loadRange(rg), redrawAds);
    const gate = adsGate(loadRange(rg), redrawAds); if (gate) return [adsBar(s, redrawAds)].concat(gate);
    const c = adCalc(AD.r, rg, s);
    return [adsBar(s, redrawAds), adsNote(s), adKpis(c), h('div', { class: 'mk-row' }, suggCard(), adsConnCard(s, c)), h('div', { class: 'charts', 'data-rgroup': 'charts' }, merChart(c), spendChart(c)), vsCard(c), asstCards(), adsSource()].filter(Boolean);
  }
  function reportsTab() {
    const rg = adRange(); const s = adsState(null); adsLoad(loadRange(rg), redrawAds);
    const sub = M.rsub || 'campaigns'; const c = AD.r && AD.r.ok ? adCalc(AD.r, rg, s) : null;
    const tabs = K.SubTabs({ label: 'تقارير التسويق', active: sub, onChange: (id) => { M.rsub = id; R(); }, items: [{ id: 'campaigns', label: 'الحملات', count: c ? c.camps.length : null }, { id: 'creative', label: 'الأعمال الفنية', count: c ? c.creatives.length : null }] });
    const gate = adsGate(loadRange(rg), redrawAds); if (gate) return [adsBar(s, redrawAds), tabs].concat(gate);
    if (sub === 'creative') return [adsBar(s, redrawAds), tabs, adsNote(s), crTable(c), adsSource()].filter(Boolean);
    const f = M.cf = M.cf || { status: '', q: '', decision: '' }; const q = (f.q || '').trim().toLowerCase();
    const sts = [...new Set(c.camps.map((x) => stOf(x.status)[0]))];
    // «القرار» (the v6 prototype): the kind of the campaign's open suggestions, or none
    byLoad(false); const dec = {}; byPending().forEach((x) => { (dec[x.campaign_id] = dec[x.campaign_id] || new Set()).add((SG_UI[x.kind] || SG_UI.tracking)[2]); });
    const DEC = [...new Set(Object.values(SG_UI).map((u) => u[2]))].concat(['من غير قرار']);
    const decOk = (x) => !f.decision || (f.decision === 'من غير قرار' ? !dec[x.id] : !!dec[x.id] && dec[x.id].has(f.decision));
    const list = c.camps.filter((x) => (!f.status || stOf(x.status)[0] === f.status) && decOk(x) && (!q || x.name.toLowerCase().includes(q) || x.id.includes(q)));
    const sb = h('input', { type: 'search', id: 'ads-q', placeholder: 'ابحث باسم الحملة أو رقمها', 'aria-label': 'ابحث في الحملات', value: f.q || '' });
    sb.addEventListener('input', () => { f.q = sb.value; R(); setTimeout(() => { const x = document.getElementById('ads-q'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 0); });
    const filt = h('div', { class: 'toolbar', 'data-ads-filters': '' }, U.Select({ id: 'ads-st', label: '', options: [{ value: '', label: 'الحالة: الكل' }].concat(sts.map((x) => ({ value: x, label: 'الحالة: ' + x }))), value: f.status, onChange: (v) => { f.status = v; R(); } }),
      U.Select({ id: 'ads-dec', label: '', options: [{ value: '', label: 'القرار: الكل' }].concat(DEC.map((x) => ({ value: x, label: 'القرار: ' + x }))), value: f.decision || '', onChange: (v) => { f.decision = v; R(); } }),
      h('span', { class: 'grow' }), h('label', { class: 'search search-field' }, Icon('search', 'sm'), sb));
    return [adsBar(s, redrawAds), tabs, adsNote(s), filt, campTable(c, list), adsSource()].filter(Boolean);
  }
  // the reports page's «الحملات الإعلانية» (decision 47): the same numbers and blocks, its redraw; CSV = the campaigns
  function reportBlocks(redraw) {
    if (!MK() || !can().view) return { blocks: [K.Empty('مش مسموحلك تشوف التسويق', 'اطلب صلاحية «التسويق» من الأدمن.')], exp: null };
    const rg = adRange(); const s = adsState(redraw); adsLoad(loadRange(rg), redraw);
    const gate = adsGate(loadRange(rg), redraw); if (gate) return { blocks: gate, exp: null };
    const c = adCalc(AD.r, rg, s, 'all'); // the reports page has no platform filter
    const exp = { label: 'الحملات الإعلانية', headers: ['الحملة', 'رقم الحملة', 'المنصة', 'الحالة', 'الصرف', 'مشتريات ميتا', 'أوردرات ووكومرس', 'مبيعات ووكومرس', 'العائد الحقيقي', 'تكلفة الأوردر'],
      rows: c.camps.map((x) => [x.name, x.id, x.platform, stOf(x.status)[0], x.spend, x.purchases, x.orders, Math.round(x.sales * 100) / 100, x.mer == null ? '' : Math.round(x.mer * 100) / 100, x.cpa == null ? '' : Math.round(x.cpa)]) };
    return { exp, blocks: [adsNote(s), adKpis(c), h('div', { class: 'charts', 'data-rgroup': 'charts' }, merChart(c), spendChart(c)), vsCard(c), campTable(c, c.camps), crTable(c), adsSource()].filter(Boolean) };
  }

  // ---------- 9.5.4: the assistants — the media buyer with approved execution, the designer's and the developer's requests ----------
  // the server writes the suggestions after each sync; the admin decides here (the switch off = the decision is recorded only);
  // the chat is text only — nothing runs from it
  const BY = { at: 0, busy: false, sugg: null, rules: null, reqs: null, chat: [], asking: false, aiTab: 'buyer' };
  const BY_MS = 60000;
  function byLoad(force) {
    if (!MK() || !can().view || BY.busy || (!force && BY.at && Date.now() - BY.at < BY_MS)) return;
    BY.busy = true;
    Promise.all([MK().suggestions(force), MK().rules(force), MK().requests(force)]).then(([a, b, c]) => {
      if (a.ok) BY.sugg = a.items; else if (!BY.sugg) BY.sugg = [];
      if (b.ok) BY.rules = b.rules;
      if (c.ok) BY.reqs = c.items; else if (!BY.reqs) BY.reqs = [];
      BY.at = Date.now(); BY.busy = false;
      if (window.IBPages.current === 'marketing' && st.view === 'hub' && !document.querySelector('.scrim')) R();
    }).catch(() => { BY.busy = false; });
  }
  const byPending = () => (BY.sugg || []).filter((x) => x.status === 'pending');
  const hm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const meName = () => { const D = window.IBDirectory; const m = D && D.me && D.me(); return (m && m.name) || 'أنا'; };
  const SG_UI = { stop: ['alert', 'error', 'وقّف'], budget_down: ['clock', 'orange', 'قلّل'], budget_up: ['users', 'success', 'زوّد'], creative: ['clock', 'orange', 'نسخة جديدة'], tracking: ['clock', 'gold', 'راجع التتبع'] };
  const SG_ST = { pending: ['مستني موافقتك', 'orange'], approved: ['اتوافق — من غير تنفيذ', 'gold'], edited: ['اتوافق بتعديل — من غير تنفيذ', 'gold'], rejected: ['اترفض', 'neutral'], done: ['اتنفّذ', 'success'], failed: ['فشل', 'error'], expired: ['مابقاش قائم', 'neutral'] };
  const DECIDE_WHY = { step: 'الخطوة أكبر من 30%', cap: 'كان هيعدّي السقف اليومي', no_daily_budget: 'الحملة مالهاش ميزانية يومية', failed: 'ميتا ماردتش' };
  const sgShort = (x) => { const u = SG_UI[x.kind] || SG_UI.tracking; return x.kind === 'budget_down' || x.kind === 'budget_up' ? u[2] + ' ' + Math.abs(x.pct || 0) + '%' : u[2]; };
  const sgItem = (x, onClick) => { const u = SG_UI[x.kind] || SG_UI.tracking;
    return h('button', { type: 'button', class: 'mk-item', 'data-mk-sugg': String(x.id), onClick }, h('span', { class: 'mk-ic tone-' + u[1] }, Icon(u[0], 'sm')), h('span', { class: 'mk-txt' }, h('b', null, x.title), h('small', null, U.num(x.sub || x.impact || ''))), h('span', { class: 't-small help mk-tag' }, W.AD_PLATFORM[x.platform] || 'ميتا')); };
  const decidedLine = (x) => { const why = x.error ? (DECIDE_WHY[x.error] || (MK() && MK().adsWhy(x.error)) || x.error) : '';
    return [x.decidedAt ? D2(String(x.decidedAt).slice(0, 10)) : '', x.value != null ? 'بنسبة ' + Math.abs(x.value) + '%' : '', x.note || '', why, x.result && x.result.after != null ? 'الميزانية بقت ' + K.n0(x.result.after) + ' ج.م/يوم' : '', x.result && x.result.request ? 'اتبعت للديزاينر' : ''].filter(Boolean).join(' · '); };
  function openSugg(x) {
    const live = !!(BY.rules && BY.rules.live); const money = x.kind === 'stop' || x.kind === 'budget_down' || x.kind === 'budget_up'; const budget = x.kind === 'budget_down' || x.kind === 'budget_up';
    const [sl, tone] = SG_ST[x.status] || SG_ST.pending;
    const rows = [['المنصة', W.AD_PLATFORM[x.platform] || 'ميتا'], ['الحملة', x.campaign_name || '#' + x.campaign_id], x.ad_id ? ['الإعلان', '#' + x.ad_id] : null, ['الأرقام', U.num(x.sub || '—')], ['السبب', U.num(x.why || '—')], ['الأثر المتوقع', U.num(x.impact || '—')],
      ['الحالة', Tag(tone, sl)], x.status !== 'pending' ? ['القرار', U.num(decidedLine(x) || '—')] : null];
    const note = x.status !== 'pending' ? null : !isAdmin() ? U.InlineNote({ children: 'القرار للأدمن — هو اللي بيوافق أو يرفض، وكل قرار بيتسجل في سجل النشاط.' })
      : money && !live ? U.InlineNote({ kind: 'warning', children: 'مفتاح التنفيذ على ميتا مقفول: الموافقة بتتسجل من غير أي تغيير على الحملة. بتفتحه من «القواعد والحدود».' })
      : U.InlineNote({ children: money ? (x.kind === 'stop' ? 'الموافقة بتوقف الحملة على ميتا فورًا' : 'الموافقة بتغيّر الميزانية اليومية على ميتا فورًا (الخطوة لحد 30% وجوه السقف اليومي)') + ' وبتتسجل في سجل النشاط.' : x.kind === 'creative' ? 'الموافقة بتفتح طلب للديزاينر بنسخة جديدة من الإعلان — مفيش تغيير على ميتا.' : 'الموافقة = اتراجع التتبع؛ مفيش تغيير على ميتا.' });
    const m = U.Modal({ title: x.title, body: [K.Kv(rows), note], footer: [] }); m.el.dataset.mkSugg = String(x.id);
    const run = async (decision, extra) => { const r = await MK().decide(x.id, decision, extra); K.toast(r.ok ? r.message : r.message || 'تعذّر — جرّب تاني', r.ok ? 'success' : 'error'); byLoad(true); R(); };
    const foot = [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })];
    if (x.status === 'pending' && isAdmin()) {
      foot.unshift(Button({ label: 'ارفض', attrs: { 'data-mk-reject': '' }, onClick: () => { m.close(); K.form({ title: 'رفض: ' + x.title, values: { note: '' }, fields: (f, e, set) => [K.field.area('note', 'السبب (اختياري)', f, e, set, { placeholder: 'مثال: الحملة لسه جديدة' })], submitLabel: 'ارفض الاقتراح', submitType: 'danger', submit: (f) => { run('reject', { note: f.note }); } }); } }));
      if (budget) { const up = (x.pct || 0) > 0;
        foot.unshift(Button({ label: 'عدّل', attrs: { 'data-mk-edit': '' }, onClick: () => { m.close(); K.form({ title: 'تعديل: ' + x.title, values: { v: String(Math.abs(x.pct || 0)), note: '' },
          fields: (f, e, set) => [K.field.text('v', (up ? 'نسبة الزيادة' : 'نسبة التقليل') + ' % — لحد 30', f, e, set, { required: true, placeholder: 'مثال: 15' }), K.field.area('note', 'ملاحظة (اختياري)', f, e, set)],
          validate: (f) => { const n = Number(f.v); return Number.isInteger(n) && n > 0 && n <= 30 ? {} : { v: 'رقم صحيح من 1 لـ 30' }; }, submitLabel: live ? 'وافق بالتعديل ونفّذ' : 'وافق بالتعديل', submit: (f) => { run('edit', { value: (up ? 1 : -1) * Number(f.v), note: f.note }); } }); } })); }
      foot.unshift(Button({ type: 'primary', label: money ? (live ? 'وافق ونفّذ' : 'وافق') : x.kind === 'creative' ? 'وافق واطلب من الديزاينر' : 'اتراجع', attrs: { 'data-mk-approve': '' }, onClick: () => { m.close();
        if (money && live) K.confirm({ title: 'تنفّذ على ميتا؟', text: U.num(x.title + ' — ' + (x.kind === 'stop' ? 'الحملة هتتوقف على ميتا دلوقتي.' : 'الميزانية اليومية هتتغيّر على ميتا دلوقتي بنسبة ' + Math.abs(x.pct || 0) + '%.')), okLabel: 'أيوه، نفّذ', okType: x.kind === 'stop' ? 'danger' : 'primary', onOk: () => run('approve') });
        else run('approve'); } }));
    }
    m.setFooter(...foot); return m;
  }
  // the rules and limits (the v5 card): the admin edits a rule by pressing it; the execution switch beside them
  function rulesCard() {
    const r = BY.rules; if (!r) return Card('القواعد والحدود', 'بتتحمّل…', [K.Empty('لحظة واحدة', '')]);
    const rows = [['حد الصرف اليومي', K.n0(r.dailyCap) + ' ج.م لكل الحساب · أي زيادة فوقه بتترفض', 'حد', 'dailyCap', 'success'], ['الحد المقبول لتكلفة الأوردر', K.n0(r.maxCpa) + ' ج.م (حقيقي من ووكومرس)', 'هدف', 'maxCpa', 'success'],
      ['وقف تلقائي', 'حملة صرفت ' + K.n0(r.autoStop) + ' ج.م في 5 أيام من غير أوردر ← ' + (r.autoStopMode === 'auto' ? 'تتوقف لوحدها ويبلّغك' : 'اقتراح بموافقتك'), 'قاعدة', 'autoStop', 'orange'], ['تقرير يومي', 'الساعة ' + String(r.reportHour).padStart(2, '0') + ':00 بتوقيت القاهرة على الجرس', 'تقرير', 'reportHour', 'success']];
    const items = rows.map(([t, sub, tag, key, tone]) => h(isAdmin() ? 'button' : 'div', Object.assign({ class: 'mk-item', 'data-mk-rule': key }, isAdmin() ? { type: 'button', onClick: () => editRule(key) } : {}),
      h('span', { class: 'mk-ic tone-' + tone }, Icon(tone === 'orange' ? 'clock' : 'users', 'sm')), h('span', { class: 'mk-txt' }, h('b', null, t), h('small', null, U.num(sub))), h('span', { class: 't-small help mk-tag' }, tag)));
    const sw = h('div', { class: 'mk-auto', 'data-mk-live': r.live ? 'on' : 'off' }, Tag(r.live ? 'success' : 'neutral', r.live ? 'التنفيذ على ميتا شغّال' : 'التنفيذ على ميتا متوقف'),
      h('span', { class: 't-small help' }, r.live ? 'الموافقة على اقتراح بتتنفّذ على حساب الإعلانات فورًا — بموافقتك بس' : 'وهو متوقف الموافقة بتتسجل من غير أي تغيير على ميتا'),
      isAdmin() ? Button({ size: 'sm', type: r.live ? 'default' : 'primary', label: r.live ? 'وقّف التنفيذ' : 'شغّل التنفيذ', attrs: { 'data-mk-live-toggle': '' }, onClick: () => toggleLive(!r.live) }) : null);
    return Card('القواعد والحدود', 'الميديا باير مايعملش حاجة لوحده برّه القواعد دي' + (isAdmin() ? ' · اضغط على قاعدة تعدّلها' : ''), [h('div', { class: 'mk-list' }, items), sw]);
  }
  function toggleLive(on) {
    K.confirm({ title: on ? 'تشغّل التنفيذ على ميتا؟' : 'توقّف التنفيذ على ميتا؟', okLabel: on ? 'شغّل التنفيذ' : 'وقّف التنفيذ', okType: on ? 'primary' : 'danger',
      text: on ? 'لما توافق على اقتراح (وقف حملة أو تغيير ميزانية) هيتنفّذ على حساب الإعلانات فورًا. مفيش حاجة بتتنفّذ من غير موافقتك، والخطوة لحد 30% والسقف اليومي محفوظ.' : 'الموافقات هتتسجل من غير تنفيذ لحد ما تشغّله تاني.',
      onOk: async () => { const r = await MK().setLive(on); K.toast(r.ok ? (on ? 'التنفيذ على ميتا اشتغل' : 'التنفيذ على ميتا وقف') : r.message, r.ok ? 'success' : 'error'); if (r.ok) BY.rules = r.rules; R(); } });
  }
  function editRule(key) {
    const r = BY.rules; const min = key === 'maxCpa' ? 1 : 100;
    const L = { dailyCap: ['حد الصرف اليومي (ج.م)', 'مجموع الميزانيات اليومية الشغالة في الحساب بعد أي زيادة مايعدّيش الرقم ده'], maxCpa: ['الحد المقبول لتكلفة الأوردر (ج.م)', 'أعلى منه = اقتراح بتقليل الميزانية 30%'], autoStop: ['وقف تلقائي بعد صرف (ج.م)', 'في 5 أيام من غير ولا أوردر في ووكومرس'], reportHour: ['ساعة التقرير اليومي', 'من 0 لـ 23 بتوقيت القاهرة'] }[key];
    K.form({ title: 'تعديل: ' + L[0], values: { v: String(r[key]), mode: r.autoStopMode }, submitLabel: 'احفظ القاعدة',
      fields: (f, e, set) => [K.field.text('v', L[0], f, e, set, { required: true, help: L[1] }), key === 'autoStop' ? K.field.select('mode', 'لما القاعدة تتحقق', [{ value: 'suggest', label: 'اقتراح بموافقتي' }, { value: 'auto', label: 'توقف لوحدها وتبلّغني (لما التنفيذ شغّال)' }], f, e, set) : null].filter(Boolean),
      validate: (f) => { const n = Number(f.v); const ok = key === 'reportHour' ? Number.isInteger(n) && n >= 0 && n <= 23 : Number.isFinite(n) && n >= min; return ok ? {} : { v: key === 'reportHour' ? 'ساعة من 0 لـ 23' : 'رقم مش أقل من ' + min }; },
      submit: (f) => { const patch = { [key]: Number(f.v) }; if (key === 'autoStop') patch.autoStopMode = f.mode; MK().rulesSet(patch).then((x) => { K.toast(x.ok ? 'اتحفظت القاعدة' : x.message, x.ok ? 'success' : 'error'); if (x.ok) BY.rules = x.rules; R(); }); } });
  }
  // the chat (session memory only): the question + the last 6 turns go to the server; nothing is executed from here
  function buyerChat() {
    const msgs = h('div', { class: 'mk-chat', 'data-mk-chat': String(BY.chat.length), 'aria-live': 'polite' },
      BY.chat.length ? BY.chat.map((m) => h('div', { class: 'mk-msg ' + m.who }, h('p', null, m.text), h('small', { class: 'help' }, m.who === 'user' ? meName() + ' · ' + m.at : m.at)))
        : h('div', { class: 'mk-msg ai' }, h('p', null, 'أنا الميديا باير. بقرا أرقام ميتا بتاعة آخر 7 أيام جنب أوردرات ووكومرس الحقيقية وبقترح — والتنفيذ بموافقتك من «مستني موافقتك». اسألني عن حملة أو العائد أو تكلفة الأوردر.'), h('small', { class: 'help' }, 'الأرقام من آخر مزامنة')),
      BY.asking ? h('div', { class: 'mk-msg ai', 'data-mk-thinking': '' }, h('p', null, 'بيفكر…')) : null);
    const send = async (txt) => { const q = String(txt || '').trim(); if (!q || BY.asking) return;
      const hist = BY.chat.slice(-6).map((m) => ({ role: m.who === 'user' ? 'user' : 'assistant', text: m.text }));
      BY.chat.push({ who: 'user', text: q, at: hm() }); BY.asking = true; R();
      const r = await MK().buyerChat(q, hist); BY.asking = false;
      if (r.ok) BY.chat.push({ who: 'ai', text: r.text, at: hm() }); else { BY.chat.pop(); K.toast(r.message, 'error'); }
      if (window.IBPages.current === 'marketing') R(); };
    const inp = h('input', { type: 'text', class: 'input grow', id: 'mk-ask', placeholder: 'اسأل الميديا باير عن أرقامك…', 'aria-label': 'رسالة للميديا باير', maxlength: '1000', onKeydown: (e) => { if (e.key === 'Enter') send(inp.value); } });
    return Card('الميديا باير', 'بيقرا أرقام ميتا + أوردرات ووكومرس · بيقترح وانت توافق — مابينفّذش حاجة من الشات', [msgs,
      h('div', { class: 'mk-ask' }, inp, Button({ type: 'primary', label: 'اسأل', attrs: { 'data-mk-ask': '' }, disabled: BY.asking, onClick: () => send(inp.value) })),
      h('div', { class: 'chips' }, h('span', { class: 't-small help' }, 'اقتراحات سريعة:'), ['حلل آخر 7 أيام', 'إيه أحسن حملة؟', 'قارن ميتا بووكومرس', 'اعمل حملة لمنتج'].map((x) => h('button', { type: 'button', class: 'chip', onClick: () => (x === 'اعمل حملة لمنتج' ? go('marketing-campaign-1') : send(x)) }, x)))], null, 'mk-wide');
  }
  // the designer's and the developer's requests
  const REQ_ST = { 'جديد': 'orange', 'بيتعمل': 'gold', 'جاهز للمراجعة': 'success', 'خلص': 'neutral' };
  const reqItem = (q) => h('button', { type: 'button', class: 'mk-item', 'data-mk-req': String(q.id), onClick: () => openReq(q) }, h('span', { class: 'mk-ic tone-' + (REQ_ST[q.status] || 'neutral') }, Icon(q.status === 'جاهز للمراجعة' ? 'users' : 'clock', 'sm')),
    h('span', { class: 'mk-txt' }, h('b', null, q.title), h('small', null, U.num([q.project, q.by, q.createdAt ? D2(String(q.createdAt).slice(0, 10)) : ''].filter(Boolean).join(' · ')))), Tag(REQ_ST[q.status] || 'neutral', q.status));
  function openReq(q) {
    const canEdit = isAdmin() || (q.mine && q.status === 'جديد' && can().create);
    const m = U.Modal({ title: q.title, body: [K.Kv([['النوع', q.kind === 'dev' ? 'المبرمج' : 'الديزاينر'], ['المشروع', q.project || '—'], ['التفاصيل', q.details ? h('span', { style: 'white-space:pre-wrap' }, q.details) : '—'], ['الحالة', Tag(REQ_ST[q.status] || 'neutral', q.status)],
      ['طلبها', (q.by || '—') + (q.createdAt ? ' · ' + D2(String(q.createdAt).slice(0, 10)) : '')], q.doneAt ? ['خلصت', D2(String(q.doneAt).slice(0, 10))] : null])], footer: [] }); m.el.dataset.mkReq = String(q.id);
    const foot = [Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })];
    if (isAdmin()) foot.unshift(U.Select({ id: 'mk-req-st', label: '', options: Object.keys(REQ_ST).map((x) => ({ value: x, label: 'الحالة: ' + x })), value: q.status, onChange: async (v) => { if (v === q.status) return; const r = await MK().setRequestStatus(q.id, v); K.toast(r.ok ? 'اتغيّرت الحالة' : r.message, r.ok ? 'success' : 'error'); m.close(); byLoad(true); R(); } }));
    if (canEdit) foot.unshift(Button({ label: 'عدّل', attrs: { 'data-mk-req-edit': '' }, onClick: () => { m.close(); reqForm(q.kind, q); } }));
    m.setFooter(...foot); return m;
  }
  function reqForm(kind, q) {
    const isD = kind === 'designer';
    K.form({ title: q ? 'تعديل: ' + q.title : isD ? 'طلب للديزاينر' : 'طلب للمبرمج', values: { t: q ? q.title : '', p: q ? q.project : (isD ? '' : 'موقع'), d: q ? q.details : '' }, validate: (f) => K.req(f, ['t']), submitLabel: q ? 'احفظ' : 'ابعت الطلب',
      fields: (f, e, set) => [K.field.text('t', 'الطلب', f, e, set, { required: true, placeholder: isD ? 'مثال: 3 بوستات لعروض الشتا 1080×1350' : 'مثال: صفحة هبوط لعروض الشتا' }),
        isD ? K.field.text('p', 'الكامبين / المشروع', f, e, set, { placeholder: 'اختياري' }) : K.field.select('p', 'المشروع', ['موقع', 'إبتكر سيستم'], f, e, set),
        K.field.area('d', 'التفاصيل', f, e, set, { placeholder: isD ? 'المقاس · المدة · المنتجات · الستايل' : 'إيه المطلوب بالظبط' })],
      submit: (f) => { (q ? MK().editRequest(q.id, { title: f.t, project: f.p, details: f.d }) : MK().addRequest({ kind, title: f.t, project: f.p, details: f.d })).then((r) => { K.toast(r.ok ? (q ? 'اتحفظ' : isD ? 'الطلب اتبعت للديزاينر' : 'الطلب اتبعت للمبرمج') : r.message, r.ok ? 'success' : 'error'); byLoad(true); R(); }); } });
  }
  function asstList(kind) {
    const isD = kind === 'designer'; const L = (BY.reqs || []).filter((q) => q.kind === kind); const open = L.filter((q) => q.status !== 'خلص'); const done = L.filter((q) => q.status === 'خلص').slice(0, 10);
    return [Card(isD ? 'الديزاينر' : 'المبرمج', isD ? 'بوستات وفيديوهات بالبراند عن طريق Magnific · الطلبات هنا والشغل من «إنشاء»' : 'صفحات الموقع وتطوير مشاريع إبتكر · بيشتغل على Staging الأول وانت توافق',
      [BY.reqs ? (open.length ? h('div', { class: 'mk-list', 'data-mk-reqs': kind }, open.map(reqItem)) : K.Empty('مفيش طلبات مفتوحة', isD ? 'اطلب بوست أو فيديو أو نسخة جديدة لإعلان.' : 'اطلب صفحة أو تعديل على الموقع أو السيستم.')) : K.Empty('بيحمّل…', ''),
        done.length ? h('details', { class: 'mk-done' }, h('summary', { class: 't-small help' }, 'اللي خلص (' + K.n0(done.length) + ')'), h('div', { class: 'mk-list' }, done.map(reqItem))) : null,
        U.InlineNote({ children: isD ? 'اقتراح «نسخة جديدة» من الميديا باير لما يتوافق بيتحط هنا طلب لوحده.' : 'المبرمج مايقدرش ينشر على الموقع اللايف من غير موافقتك.' })],
      can().create ? Button({ type: 'primary', size: 'sm', label: isD ? '+ طلب للديزاينر' : '+ طلب للمبرمج', attrs: { 'data-mk-req-add': kind }, onClick: () => reqForm(kind) }) : null)];
  }
  function aiTab() {
    byLoad(false);
    const cnt = (kind) => (BY.reqs || []).filter((q) => q.kind === kind && q.status !== 'خلص').length || null;
    const sub = K.SubTabs({ items: [{ id: 'buyer', label: 'الميديا باير', count: byPending().length || null }, { id: 'designer', label: 'الديزاينر', count: cnt('designer') }, { id: 'dev', label: 'المبرمج', count: cnt('dev') }], active: BY.aiTab, onChange: (id) => { BY.aiTab = id; R(); }, label: 'المساعدين' });
    if (BY.aiTab !== 'buyer') return [sub].concat(asstList(BY.aiTab));
    const pend = byPending(); const past = (BY.sugg || []).filter((x) => x.status !== 'pending').slice(0, 8);
    const side = h('div', { class: 'stack' },
      Card('مستني موافقتك (' + K.n0(pend.length) + ')', 'وافق أو ارفض · كل إجراء بيتسجل في سجل النشاط', [BY.sugg ? (pend.length ? h('div', { class: 'mk-list', 'data-mk-pending': String(pend.length) }, pend.map((x) => sgItem(x, () => openSugg(x)))) : K.Empty('مفيش حاجة مستنية', 'الاقتراحات بتتجدد مع كل مزامنة لأرقام ميتا.')) : K.Empty('بيحمّل…', ''),
        h('p', { class: 't-small help', style: 'margin:0' }, 'الضغط على اقتراح بيفتحه: الأرقام · السبب · «وافق» / «ارفض» / «عدّل»')]),
      past.length ? Card('آخر القرارات', 'آخر 30 يوم', [h('div', { class: 'mk-list', 'data-mk-past': String(past.length) }, past.map((x) => h('button', { type: 'button', class: 'mk-item', 'data-mk-sugg': String(x.id), onClick: () => openSugg(x) }, h('span', { class: 'mk-txt' }, h('b', null, x.title), h('small', null, U.num(decidedLine(x)))), Tag((SG_ST[x.status] || SG_ST.pending)[1], (SG_ST[x.status] || SG_ST.pending)[0]))))]) : null,
      rulesCard());
    return [sub, h('div', { class: 'mk-row' }, buyerChat(), side)];
  }
  // the overview's card (the v5): the open suggestions, the whole list from the assistants' tab
  function suggCard() {
    byLoad(false); const pend = byPending(); const r = BY.rules;
    return Card('اقتراحات الميديا باير', 'مستنية موافقتك · من قواعد ثابتة على أرقامك الحقيقية بعد كل مزامنة', [BY.sugg ? (pend.length ? h('div', { class: 'mk-list', 'data-mk-pending': String(pend.length) }, pend.slice(0, 5).map((x) => sgItem(x, () => openSugg(x)))) : K.Empty('مفيش اقتراحات مستنية', 'الميديا باير بيبعت اقتراحاته مع كل مزامنة، وتقرير يومي الساعة ' + (r ? String(r.reportHour).padStart(2, '0') + ':00' : '9:00') + ' على الجرس.')) : K.Empty('بيحمّل…', ''),
      Button({ type: 'text', size: 'sm', label: 'عرض كل الاقتراحات (' + K.n0(pend.length) + ') · القواعد والحدود من «مساعدين الذكاء الاصطناعي»', attrs: { 'data-mk-all-sugg': '' }, onClick: () => { BY.aiTab = 'buyer'; go('marketing-ai'); } })], null, 'mk-wide');
  }

  // ---------- the page ----------
  function headActs() {
    const tab = TABS.find(([id]) => id === st.tab) || [];
    const ads = st.tab === 'overview' || st.tab === 'reports';
    const per = st.tab === 'overview' ? U.Select({ id: 'mk-period', label: '', value: periodOf(adRange()),
      options: PERIODS.map(([k, l]) => ({ value: k, label: 'الفترة: ' + l })).concat(periodOf(adRange()) === 'custom' ? [{ value: 'custom', label: 'الفترة: ' + perLabel(adRange()) }] : []), onChange: (v) => { if (v !== 'custom') setPeriod(v); } }) : null;
    const plat = ads ? U.Select({ id: 'mk-plat', label: '', value: M.plat, options: PLATS.map(([k, l]) => ({ value: k, label: 'المنصة: ' + l })), onChange: (v) => { M.plat = v; R(); } }) : null;
    return [st.tab === 'reports' ? null : K.PanelButton('marketing:' + st.tab, 'التسويق — ' + tab[1], () => document.querySelector('#pg-marketing .panel'), R), per, plat].filter(Boolean);
  }
  function view() {
    if (!MK() || !can().view) return [K.PageHead('التسويق', null, []), K.Empty('مفيش صلاحية', 'صفحة التسويق محتاجة صلاحية «التسويق — عرض».')];
    if (MK().state() === 'idle') { MK().ensure().then(() => { if (window.IBPages.current === 'marketing') R(); }); }
    if (st.view === 'campaign' && st.step > 1 && !camp.id) { st.view = 'hub'; st.tab = 'create'; }
    if (st.view === 'campaign') return campaign();
    const tabs = K.MainTabs({ items: TABS.map(([id, label]) => ({ id, label })), active: st.tab, onChange: (id) => go('marketing-' + id), label: 'أقسام التسويق' });
    const loading = MK().state() !== 'ready';
    const body = loading ? [K.Empty('بيحمّل…', 'لحظة واحدة')] : ({ overview: overviewTab, create: hub, publog: publogTab, calendar: calendarTab, templates: templatesTab, ai: aiTab, reports: reportsTab })[st.tab]();
    const panel = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...body);
    if (!loading) setTimeout(() => K.applyPanelPrefs('marketing:' + st.tab, panel), 0);
    return [K.PageHead('التسويق', null, headActs()), tabs, panel];
  }
  // a change from elsewhere (the live line) redraws the tabs — never the open wizard or an open popup
  document.addEventListener('ib:marketing', () => { if (window.IBPages.current !== 'marketing' || st.view !== 'hub') return; if (document.querySelector('.scrim')) return; R(); });

  window.IBPages.register('marketing', { title: 'التسويق', hash: (hs) => route(hs), defaultHash, view, api: { st, camp, go, openCampaign, reportBlocks } });
})();
