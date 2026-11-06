/* «التسويق» — phase 9.5.1 (docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md): the v5's marketing page (artifact «نظام إبتكر»,
   the prototype's block 19) on our data — IBMarketing (app/js/adapter/marketing.js) and its domain IbtekrCampWiz
   (app/js/pages/marketing-domain.js). Not a block: loaded before block 28 so boot() gives it its <main>.
   9.5.1 (decisions 5, 8–18): «إنشاء» — the campaign card and «آخر الشغل» —, the campaign in four steps (the images with Magnific's
   credits through ai-images, the texts with Claude through ai-content, the review with pins on the image, the schedule and the ZIP
   download), «سجل النشر», «الخطة الإعلانية» and «قوالب التصميم». «نظرة عامة», «مساعدين الذكاء الاصطناعي» and «التقارير» are
   «قريبًا» (the ads numbers of 9.5.3 and later), and so is the video.
   9.5.2 (decisions 29–39): publishing to Facebook and Instagram through mkt-publish — the connection card with the master switch
   (the admin's), «انشر / داونلود» per piece and «انشر المحدد» (the JPEG copies made at «تأكيد النشر»), «انشر دلوقتي» and «احذف
   البوست» in the post's popup, the numbers (views, engagement, likes / comments / shares / saves), and the platform's own posts in
   the log and the plan («من المنصة مباشرة», the source filter). A post can still be published by hand and marked «اتنشر». */
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
    return Card('الربط بالمنصات', 'فيسبوك وانستجرام من ربط الصفحة في «خدمة العملاء › القنوات» · تيك توك قريب', [
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
  const pubOf = (p, pl, cn) => W.publishable(W.postKind(p), W.pieceImages(p), pl, cn, pieceText(p));

  // ---------- the page's state ----------
  const TABS = [['overview', 'نظرة عامة', true], ['create', 'إنشاء'], ['publog', 'سجل النشر'], ['calendar', 'الخطة الإعلانية'], ['templates', 'قوالب التصميم'], ['ai', 'مساعدين الذكاء الاصطناعي', true], ['reports', 'التقارير', true]];
  const SOON = { // decision 5: the tabs that wait for the ads numbers (9.5.3) and the assistants
    overview: ['قريبًا — مع أرقام الإعلانات', 'الصرف الإعلاني ومبيعات ووكومرس اللي جاية من الإعلانات (UTM) والعائد الحقيقي لكل منصة هيظهروا هنا لما نربط Meta Ads.'],
    ai: ['قريبًا — بعد ربط الإعلانات', 'الميديا باير (اقتراحات بموافقتك على أرقامك الحقيقية) والديزاينر والمبرمج هيشتغلوا هنا بعد ربط أرقام الإعلانات.'],
    reports: ['قريبًا — مع النشر التلقائي وأرقام الإعلانات', 'تقارير الحملات والأعمال الفنية بالمشاهدات والتفاعل والعائد هتظهر هنا مع النشر على فيسبوك وإنستجرام وأرقام Meta Ads.'] };
  const CSTEPS = ['تفاصيل الكامبين', 'البناء', 'المراجعة', 'النشر والتحميل'];
  const st = { tab: 'create', view: 'hub', step: 1 };
  const blankCamp = () => ({ id: null, w: W.defaults(), pieces: [], sched: {}, rtab: 'post', tried1: false, pubSel: new Set(), busy: {} });
  const camp = blankCamp();
  const M = { plq: '', tplk: 'all', tplq: '' }; // the tabs' filters

  function route(hs) {
    let m;
    if ((m = /^marketing(?:-(overview|create|publog|calendar|templates|ai|reports))?$/.exec(hs))) { st.tab = m[1] || 'create'; st.view = 'hub'; return true; }
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
    return [h('div', { class: 'tools-grid c1' }, tool),
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
    const counts = h('div', { class: 'cw-row' }, num('cw-n-' + t, 'العدد', m.count, W.MAX.count, (v) => { m.count = v; }),
      U.Select({ id: 'cw-sz-' + t, label: 'المقاس', value: m.size, onChange: (v) => { m.size = v; persist(); R(); }, options: SZ() }),
      t === 'carousel' ? num('cw-slides', 'صور في كل كاروسيل', m.slides, W.MAX.slides, (v) => { m.slides = v; }, 2) : null);
    const tabItems = W.MEDIA.map(([id, l]) => ({ id, label: id === 'video' && W.VIDEO_SOON ? [l, ' ', soonTag()] : l, count: id === 'video' && W.VIDEO_SOON ? null : Mx[id].count }));
    const media = Card('الميديا', 'اختار نوع الميديا وظبط كل نوع لوحده.', [K.SubTabs({ label: 'نوع الميديا', active: t, onChange: (id) => { if (id === 'video' && W.VIDEO_SOON) { K.toast('الفيديو بالـ AI قريبًا — بعد المرحلة دي'); return; } c.mediaTab = id; persist(); R(); }, items: tabItems }),
      h('div', { class: 'cw-media', 'data-cw-media': t }, counts, modelSel('cw-md-' + t, m.model, (v) => { m.model = v; }),
        h('hr', { class: 'cw-hr' }), Files('cw-use-' + t, 'فايلز أو لينكات للاستخدام', m.use, 'صور المنتج، اللوجو، لقطات من الورشة — أو لينك منتج من الموقع'), Files('cw-ref-' + t, 'فايلز أو لينكات أمثلة للمطابقة', m.ref, 'الـ AI بيقلّد الستايل والترتيب', t === 'carousel' ? 'carousel' : 'post'),
        aiField(U.Textarea({ id: 'cw-notes-' + t, label: 'تعليمات', rows: 2, value: m.notes, placeholder: 'مثلًا: ألوان دافية، من غير ناس، الكلام قليل', onInput: (v) => { m.notes = v; persist(); } }), 'notes', { campaignId: null }))]);
    const X = c.extra;
    const extra = Card('ملفات إضافية', 'صور زيادة للستوري أو الموقع بنفس الستايل.', [h('div', { class: 'cw-row' }, num('cw-n-extra', 'العدد', X.count, W.MAX.count, (v) => { X.count = v; })),
      X.count ? [modelSel('cw-md-extra', X.model, (v) => { X.model = v; }), h('hr', { class: 'cw-hr' }), Files('cw-use-extra', 'فايلز أو لينكات للاستخدام', X.use), Files('cw-ref-extra', 'فايلز أو لينكات أمثلة للمطابقة', X.ref, null, 'post'),
        aiField(U.Textarea({ id: 'cw-notes-extra', label: 'تعليمات', rows: 2, value: X.notes, onInput: (v) => { X.notes = v; persist(); } }), 'notes', { campaignId: null })] : null]);
    const est = W.estimate(c, IMGM()); const w = wallet();
    const sum = U.InlineNote({ kind: w.balance != null && est > w.balance ? 'warning' : 'info', children: h('span', { 'data-cw-est': String(est) }, 'التكلفة المتوقعة لصور الكامبين كلها تقريبًا ' + K.n0(est) + ' كريديت · ' + (w.balance != null ? 'رصيدك ' + K.n0(w.balance) + ' كريديت' : 'اتصرف الشهر ده ' + K.n0(w.used) + ' كريديت') + '. التكلفة الفعلية بتظهر قبل كل توليد، والكتابة بالـ AI مابتصرفش كريدت.') });
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
    const r = await MK().generate(camp.id, { piece: p.id, slide, model: p.model, size: p.size });
    delete camp.busy[key];
    if (!r.ok) { K.toast(r.message, 'error'); R(); return false; }
    const t = slide == null || slide < 0 ? p : p.slides[slide];
    t.img = r.path; t.gen = (t.gen || 0) + 1; t.approved = false; t.v = t.gen > 1 ? t.gen : t.v; if (t !== p) p.approved = false;
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
  function pieceHead(p) {
    const cost = p.kind === 'كاروسيل' ? W.cost('carousel', p, IMGM()) : W.cost('image', p, IMGM());
    return h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, 'المقاس: ', szName(p.size)), h('span', null, 'الموديل: ', mdlName(p.model)), h('span', null, 'هيصرف: ', K.Num(K.n0(cost) + ' كريديت'))),
      W.built(p) ? Tag('success', 'اتولد') : Tag('neutral', 'لسه'), h('span', { class: 'grow' }), aiBtn('املأ بالـ AI', async () => { if (await aiFill(p)) K.toast('اتملت الحقول الفاضية — راجعها', 'success'); }, { 'data-cw-fill': p.id }));
  }
  function buildCard(p) {
    const anchor = { id: 'cw-' + p.id, 'data-cw-piece': p.id, tabindex: '-1' };
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
  // «ولّد الكل بالـ AI» (owner 2 Nov 00:25): every piece still missing — the empty texts first (no credit), then the images
  function genAllPlan() {
    const ps = camp.pieces || []; let cost = 0; const jobs = [];
    ps.forEach((p) => { if (W.built(p)) return;
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
      Foot(2, 4, cback, 'متابعة للمراجعة', () => { camp.rtab = ps.some((p) => p.kind === 'بوست' || p.kind === 'ملف إضافي') ? 'post' : 'carousel'; go('marketing-campaign-3'); }, !W.canBuildNext(ps))];
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
  function w3() {
    ensurePieces(); const ps = camp.pieces;
    const G = { post: ps.filter((p) => p.kind === 'بوست' || p.kind === 'ملف إضافي'), carousel: ps.filter((p) => p.kind === 'كاروسيل') };
    const tabs = [['post', 'مراجعة البوستات'], ['carousel', 'مراجعة الكاروسيلز']].filter(([id]) => G[id].length);
    if (!tabs.some(([id]) => id === camp.rtab)) camp.rtab = tabs.length ? tabs[0][0] : 'post';
    const pr = W.progress(ps, W.approved); const ready = ps.filter((p) => W.approvable(p) && !W.approved(p)).length;
    const list = G[camp.rtab] || [];
    return [h('div', { class: 'cw-bar card' }, h('span', { 'data-cw-approved': pr.done + '/' + pr.total }, 'اتوافق على ', K.Num(pr.done + ' من ' + pr.total)), h('span', { class: 'grow' }),
      Button({ type: 'primary', size: 'sm', icon: 'check', label: 'وافق على كل الجاهز' + (ready ? ' (' + ready + ')' : ''), disabled: !ready, attrs: { 'data-cw-okall': '' }, onClick: () => { const n = W.approveAll(ps); persist(0); K.logEvent('mkt.campaign.approve_all', String(n)); K.toast('اتوافق على ' + n + ' قطع', 'success'); R(); } })),
      K.SubTabs({ label: 'المراجعة', active: camp.rtab, onChange: (id) => { camp.rtab = id; persist(); R(); }, items: tabs.map(([id, l]) => ({ id, label: l, count: G[id].filter(W.approved).length + '/' + G[id].length })) }),
      ...list.map((p) => (p.kind === 'كاروسيل' ? reviewCarousel(p) : reviewPost(p))),
      pr.done < pr.total ? U.InlineNote({ children: 'لازم توافق على كل القطع عشان تكمّل للنشر.' }) : null,
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
  const zipItem = (p) => ({ label: pieceLabel(p), images: W.pieceImages(p), caption: p.caption || camp.w.idea, tags: p.tags || W.TAGS });
  function c5() {
    ensurePieces(); const cn = needConn();
    const sch = (p, i) => (camp.sched[p.id] = camp.sched[p.id] || Object.assign(W.suggest(i, TODAY()), { pl: ['انستجرام', 'فيسبوك'], how: ['انشر'] }));
    const canPub = (p, s) => (s.pl || []).some((pl) => pubOf(p, pl, cn).ok);
    const sel = camp.pubSel; const all = camp.pieces.length && camp.pieces.every((p) => sel.has(p.id));
    const rows = camp.pieces.map((p, i) => { const s = sch(p, i);
      const pub = canPub(p, s); const on = pub && Array.isArray(s.how) && s.how.includes('انشر');
      const why = pub ? null : ((s.pl || []).map((pl) => pubOf(p, pl, cn).why).find(Boolean) || 'اختار منصة الأول');
      const auto = (s.pl || []).filter((pl) => pubOf(p, pl, cn).ok);
      return [cbx('حدد ' + pieceLabel(p), sel.has(p.id), (v) => { v ? sel.add(p.id) : sel.delete(p.id); R(); }), h('span', { class: 'prod' }, Img(p.img), h('span', null, h('b', null, pieceLabel(p)), h('small', null, W.hookOf(p)))),
        U.DateField({ id: 'sd-' + p.id, label: '', value: s.date, today: TODAY(), onChange: (v) => { s.date = v; persist(); R(); } }),
        U.Select({ id: 'st-' + p.id, label: '', options: W.timeOpts(s.time).map((x) => ({ value: x, label: x })), value: s.time, onChange: (v) => { s.time = v; persist(); R(); } }),
        h('div', { class: 'chips', 'data-cw-pl': p.id }, W.PLATFORMS.map((pl) => chip(pl, s.pl.includes(pl), () => { s.pl = s.pl.includes(pl) ? s.pl.filter((x) => x !== pl) : s.pl.concat(pl); persist(); R(); }))),
        h('div', { class: 'cw-how' }, h('div', { class: 'chips', 'data-cw-how': p.id },
          chip('انشر', on, () => { if (!pub) { K.toast(why, 'error'); return; } s.how = on ? ['داونلود'] : ['انشر']; persist(); R(); }, Object.assign({ 'data-cw-pub': p.id }, pub ? {} : { 'aria-disabled': 'true', title: why })),
          chip('داونلود', true, () => {}, { 'aria-disabled': 'true' })),
          on ? h('small', { class: 't-small help', 'data-cw-auto': p.id }, 'تلقائي: ' + auto.join(' · ')) : null),
        K.RowMenu([{ label: 'نزّل فولدر (الصور + التكست)', icon: 'download', run: () => downloadZip([zipItem(p)], pieceLabel(p)) },
          { label: 'انسخ الكابشن', icon: 'copy', run: () => { try { navigator.clipboard.writeText((p.caption || camp.w.idea) + '\n' + W.TAGS); } catch (e) { /* the clipboard is the browser's */ } K.toast('اتنسخ الكابشن'); } },
          { label: 'افتح القطعة', icon: 'edit', run: () => { camp.rtab = p.kind === 'كاروسيل' ? 'carousel' : 'post'; go('marketing-campaign-3'); } }])]; });
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

  // ---------- the page ----------
  const soonPanel = (tab) => { const [t, s] = SOON[tab]; const e = U.EmptyState(t, s); e.setAttribute('data-mk-soon', tab); return [h('div', { class: 'mk-soon-panel' }, e)]; };
  function headActs() {
    const tab = TABS.find(([id]) => id === st.tab) || [];
    return tab[2] ? [] : [K.PanelButton('marketing:' + st.tab, 'التسويق — ' + tab[1], () => document.querySelector('#pg-marketing .panel'), R)];
  }
  function view() {
    if (!MK() || !can().view) return [K.PageHead('التسويق', null, []), K.Empty('مفيش صلاحية', 'صفحة التسويق محتاجة صلاحية «التسويق — عرض».')];
    if (MK().state() === 'idle') { MK().ensure().then(() => { if (window.IBPages.current === 'marketing') R(); }); }
    if (st.view === 'campaign' && st.step > 1 && !camp.id) { st.view = 'hub'; st.tab = 'create'; }
    if (st.view === 'campaign') return campaign();
    const tabs = K.MainTabs({ items: TABS.map(([id, label, soon]) => ({ id, label: soon ? [label, ' ', soonTag()] : label })), active: st.tab, onChange: (id) => go('marketing-' + id), label: 'أقسام التسويق' });
    const soon = !!(TABS.find(([id]) => id === st.tab) || [])[2];
    const loading = MK().state() !== 'ready';
    const body = soon ? soonPanel(st.tab) : loading ? [K.Empty('بيحمّل…', 'لحظة واحدة')] : ({ create: hub, publog: publogTab, calendar: calendarTab, templates: templatesTab })[st.tab]();
    const panel = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...body);
    if (!soon && !loading) setTimeout(() => K.applyPanelPrefs('marketing:' + st.tab, panel), 0);
    return [K.PageHead('التسويق', null, headActs()), tabs, panel];
  }
  // a change from elsewhere (the live line) redraws the tabs — never the open wizard or an open popup
  document.addEventListener('ib:marketing', () => { if (window.IBPages.current !== 'marketing' || st.view !== 'hub') return; if (document.querySelector('.scrim')) return; R(); });

  window.IBPages.register('marketing', { title: 'التسويق', hash: (hs) => route(hs), defaultHash, view, api: { st, camp, go, openCampaign } });
})();
