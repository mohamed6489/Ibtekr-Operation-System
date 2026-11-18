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
  // owner batch 2 decision 14: «تعليمات» = the admin's instruction templates (الإعدادات › الذكاء الاصطناعي — «الصور» for the images,
  // «الفيديو» for a video; «البوست» is applied to every post already) — one picked (15 Nov) — + the member's own words. Only the ids are kept
  // (state.w.media.<tab>.tpl) — the server reads their text from the settings (templateNotes), never from the page.
  // The owner 15 Nov: «خلي قوالب التعليمات يبقى فيها غير محدد … والتعليمات الجديدة للصور والفيديوهات تتحط فيها» — «غير محدد» first (none
  // picked), then every template of the piece's kind: the images' new ones for a post / carousel («البوست» of the images is applied to
  // every image already), and all the videos' ones for a video («البوست» included — nothing applies it to a video by itself).
  const NO_TPL = 'none';
  const aiTemplates = (tab) => { const p = window.IBSettings && window.IBSettings.public ? window.IBSettings.public() : null; const all = p && p.aiTemplates ? p.aiTemplates : {};
    const video = tab === 'video';
    return (Array.isArray(all[video ? 'vid' : 'img']) ? all[video ? 'vid' : 'img'] : []).filter((x) => x && x.id && x.id !== NO_TPL && (video || x.id !== 'post')); };
  // the owner 15 Nov («ضفت قواعد تعليمات سميتها بجرب بس مظهرتش في قوالب التعليمات … وأنا بعمل كامبين»): the public settings are read
  // with the sign-in, so a template added since stayed out — the campaign reads them again when its picker shows (at most every 30 s)
  // and draws again only if the list changed
  let tplAt = 0;
  const tplKey = () => { const P = window.IBSettings && window.IBSettings.public ? window.IBSettings.public() : null; return JSON.stringify((P && P.aiTemplates) || null); };
  function tplPick(tab, m) {
    if (window.IBSettings && window.IBSettings.loadPublic && Date.now() - tplAt > 30000) { tplAt = Date.now(); const before = tplKey();
      Promise.resolve(window.IBSettings.loadPublic()).then(() => { if (tplKey() !== before) R(); }, () => {}); }
    const L = aiTemplates(tab);
    // the owner 15 Nov («خلي اختيار قوالب التعليمات لاختيار واحد بس و شيل تم و مسح»): one template, picked like any dropdown — the
    // pick closes the list, no «تم» / «مسح»; «غير محدد» = none. Kept as a one-id list (the server reads state…tpl as a list)
    const known = new Set(L.map((x) => x.id)); const cur = (Array.isArray(m.tpl) ? m.tpl : []).find((id) => known.has(id)) || NO_TPL;
    return h('div', { 'data-cw-tpl': tab }, U.Select({ id: 'cw-tpl-' + tab, label: 'قوالب التعليمات',
      help: L.length ? 'تعليمات جاهزة من الإعدادات — اختار واحدة واكتب تحتها اللي عايزه زيادة.' : 'مفيش تعليمات ' + (tab === 'video' ? 'للفيديو' : 'للصور') + ' لسه — الأدمن بيضيفها من الإعدادات › الذكاء الاصطناعي («+ تعليمات جديدة»).',
      options: [{ value: NO_TPL, label: 'غير محدد' }].concat(L.map((x) => ({ value: x.id, label: x.name || x.id }))), value: cur,
      onChange: (v) => { m.tpl = v && v !== NO_TPL ? [v] : []; persist(); R(); } }));
  }
  if (!U || !K || !W || !window.IBPages) return;
  const { h, Icon, Button } = U;
  const MK = () => window.IBMarketing;
  const can = () => (MK() ? MK().can() : { view: false, create: false, publish: false });
  // 0120: the assistants live on their own page «الذكاء الاصطناعي» (registered below) — R draws whichever of the two is open
  const here = () => ['marketing', 'ai'].includes(window.IBPages.current);
  const R = () => window.IBPages.render(window.IBPages.current === 'ai' ? 'ai' : 'marketing');
  const IMGM = () => (window.IBImages && Array.isArray(window.IBImages.MODELS) ? window.IBImages.MODELS : []);
  const Tag = K.Tag;
  const chip = (label, on, onClick, attrs) => h('button', Object.assign({ type: 'button', class: 'chip', 'aria-pressed': String(!!on), onClick }, attrs || {}), label);
  // comments decision 66 (the owner 15 Nov — «عايز اخلي الاسماء دي تبقي ايقونات»): a platform in the publish table is its icon — the name
  // stays for the screen reader and the tooltip
  const PL_ICON = { 'انستجرام': 'instagram', 'فيسبوك': 'facebook', 'تيك توك': 'tiktok' };
  const plChip = (pl, on, onClick) => h('button', { type: 'button', class: 'chip cw-ic', 'aria-pressed': String(!!on), 'data-pl': pl, title: pl, onClick }, Icon(PL_ICON[pl] || 'send', 'sm'), h('span', { class: 'sr-only' }, pl));
  // th: a big table's head (2026-11-13-table-head.md) — { noun, when, total, count } for the kit's line «‹إمتى› · N من M ‹اسم› · ‹إجمالي›»
  const Card = (title, sub, body, acts, cls, th) => K.Section(title, [].concat(body).filter(Boolean), acts, Object.assign({ sub, cls }, th));
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
    if (Date.now() - connAsk > 15000) { connAsk = Date.now(); MK().connection().then((r) => { if (r && r.ok && here() && !document.querySelector('.scrim')) R(); }); }
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
  const TABS = [['overview', 'نظرة عامة'], ['create', 'إنشاء'], ['publog', 'سجل النشر'], ['calendar', 'الخطة الإعلانية'], ['templates', 'قوالب التصميم'], ['reports', 'التقارير']]; // 0120: «مساعدين الذكاء الاصطناعي» moved to its own page «الذكاء الاصطناعي»
  const CSTEPS = ['تفاصيل الكامبين', 'البناء', 'المراجعة', 'النشر والتحميل'];
  const st = { tab: 'overview', view: 'hub', step: 1 }; // the v6 prototype (owner 11 Nov): the page opens on «نظرة عامة»
  const blankCamp = () => ({ id: null, w: W.defaults(), pieces: [], sched: {}, rtab: 'post', tried1: false, pubSel: new Set(), busy: {}, vjobs: {}, vurl: {}, mg: null, mgBusy: null, mgLinked: null, mgAsked: false });
  const camp = blankCamp();
  const M = { plq: '', tplk: 'all', tplq: '', plat: 'all' }; // the tabs' filters; plat = the header's ad platform (the v6 prototype)

  function route(hs) {
    let m;
    if ((m = /^marketing(?:-(overview|create|publog|calendar|templates|reports))?$/.exec(hs))) { st.tab = m[1] || 'overview'; st.view = 'hub'; return true; }
    if ((m = /^marketing-campaign-([1-4])$/.exec(hs))) { st.tab = 'create'; st.view = 'campaign'; st.step = Number(m[1]); return true; }
    return false;
  }
  const defaultHash = () => (st.view === 'campaign' ? 'marketing-campaign-' + st.step : 'marketing-' + st.tab);
  const go = (hs) => {
    // from the «الذكاء الاصطناعي» page (a draft campaign, «اعمل نسخ زيه»…) the marketing page opens on that hash
    if (window.IBPages.current === 'ai' && /^marketing/.test(hs)) { try { location.hash = '#' + hs; } catch (e) { /* sandboxed */ } return; }
    const was = st.view === 'campaign' ? st.step : null;
    try { history.replaceState(null, '', '#' + hs); } catch (e) { /* sandboxed */ }
    route(hs);
    if (st.view === 'campaign' && camp.id && was !== st.step) persist(0);
    if (st.view !== 'campaign' && camp.id && MK()) MK().flush(camp.id);
    R(); window.scrollTo(0, 0);
  };

  // ---------- the campaign row (decision 7): created on the first need, autosaved while it is edited ----------
  const snapshot = () => Object.assign({ w: camp.w, pieces: camp.pieces, sched: camp.sched, rtab: camp.rtab }, camp.mg ? { mg: camp.mg } : {}); // mg: the Magnific flow's link, for the page (comments decision 52)
  const fields = () => ({ name: W.campaignName(camp.w.idea), goal: camp.w.goal, step: st.step, state: snapshot() });
  const persist = (ms) => { if (camp.id && can().create && MK()) MK().saveSoon(camp.id, fields, ms == null ? 1200 : ms); };
  // «لسه زي ما أنا شايفه» (live-sync plan decision 6): a teammate saved this campaign after I opened it — the autosave stopped
  // writing; I choose: open their copy (mine since then is dropped) or save mine over theirs
  let staleAsk = false;
  function onStale(id, by) {
    if (staleAsk || !camp.id || camp.id !== id) return; staleAsk = true;
    const D = window.IBDirectory; let list = []; try { list = (D && D.members && D.members()) || []; } catch (e) { list = []; } const who = (list.find((m) => m.id === by) || {}).name || 'عضو تاني';
    let chose = false;
    const m = U.Modal({ title: '«' + who + '» عدّل الكامبين دي من شوية',
      body: [h('p', { class: 't-body', style: 'margin:0' }, 'تعديلاتك من ساعة ما «' + who + '» حفظ مااتحفظتش لسه. تفتح نسخته (وتعديلاتك دي تروح)، ولا تحفظ نسختك فوق نسخته؟')],
      onClose: () => { staleAsk = false; if (!chose) K.toast('الحفظ التلقائي واقف لحد ما تختار — هيسألك تاني مع أول تعديل', 'warning'); },
      footer: [U.Button({ label: 'افتح نسخته', attrs: { 'data-mk-theirs': '' }, onClick: () => { chose = true; m.close(); const cid = camp.id; MK().forget(cid); openCampaign(cid); } }),
        U.Button({ type: 'primary', label: 'احفظ نسختي فوقها', attrs: { 'data-mk-mine': '' }, onClick: async () => { chose = true; m.close(); const r = await MK().save(camp.id, fields(), { force: true }); K.toast(r.ok ? 'اتحفظت نسختك' : r.message, r.ok ? 'success' : 'error'); } })] });
  }
  document.addEventListener('ib:marketing', (e) => { const d = e && e.detail; if (d && d.stale) onStale(d.stale, d.by); });
  async function ensureCampaign() {
    if (camp.id) return true;
    if (!can().create) { K.toast('مفيش صلاحية إنشاء كامبين', 'error'); return false; }
    const r = await MK().create(fields());
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    camp.id = r.id; return true;
  }
  function startCampaign() { Object.assign(camp, blankCamp()); go('marketing-campaign-1'); }
  // 9.5.5 decision 62: the video tool is a campaign with one video and nothing else
  async function openCampaign(id) {
    const r = await MK().open(id); if (!r.ok) { K.toast(r.message, 'error'); return; }
    const s = r.campaign.state || {};
    Object.assign(camp, blankCamp(), { id, w: Object.assign(W.defaults(), s.w || {}), pieces: Array.isArray(s.pieces) ? s.pieces : [], sched: s.sched || {}, rtab: s.rtab || 'post', mg: s.mg && typeof s.mg === 'object' ? s.mg : null });
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
  const fileIcon = (f) => (f.t === 'product' ? 'package' : f.t === 'tpl' ? 'copy' : /\/ref-[^/]+$/.test(String(f.path || '')) ? 'link' : 'file');
  function Files(id, label, arr, help, tplKind) {
    const li = h('input', { type: 'text', class: 'input grow', dir: 'auto', placeholder: 'أي لينك (صورة، Pinterest، منتج من الموقع) أو الـ SKU', 'aria-label': label + ' — لينك', id: id + '-l' });
    // a product of the site (its link or SKU) first; any other https link (the owner 15 Nov — «السيستم مش قابل اي لينكات») → the server
    // fetches its image (the link's, or the picture its page names) into the campaign's folder — a file like an upload
    let adding = false;
    const add = async () => { const v = li.value.trim(); if (!v || adding) return; adding = true;
      try {
        const r = await MK().product(v);
        if (r.ok) { if (!arr.some((f) => f.t === 'product' && f.id === r.product.id)) arr.push({ t: 'product', id: r.product.id, name: r.product.name }); li.value = ''; persist(); R(); return; }
        if (!/^https?:\/\//i.test(v)) { K.toast('مالقيناش منتج بالـ SKU ده — أو حط لينك يبدأ بـ https://', 'error'); return; }
        if (!(await ensureCampaign())) return;
        const l = await MK().refLink(camp.id, v); if (!l.ok) { K.toast(l.message, 'error'); return; }
        arr.push({ t: 'file', name: l.name, path: l.path }); li.value = ''; persist(); R(); K.toast('اتضافت الصورة من اللينك', 'success');
      } finally { adding = false; }
    };
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
  // the count: typed by hand (Arabic digits too, committed on Enter / leaving the box / the arrows) or the + and −; the number in the
  // middle of its box (the owner 12 Nov — «الأرقام في البوكس مرحلة يمين… خليها في النص وأقدر أكتب الرقم بإيدي أو أدوس على + و −»)
  const num = (id, label, val, max, set, min, disabled) => {
    const lo = min || 0; const digits = (v) => String(v == null ? '' : v).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
    // once per box: the redraw removes the focused box, and its blur «change» must not commit (and redraw) a second time
    let done = false;
    // `later`: the commit comes from the box losing focus — that can be a redraw taking the box away (the AI filling the pieces in the
    // background, a live update), and a redraw inside that redraw breaks it; the value is kept and the page drawn right after
    const put = (v, later) => { if (done) return; const n = W.clamp(v, lo, max); if (n !== val) { done = true; set(n); persist(); if (later) setTimeout(R, 0); else R(); } else inp.value = String(val); };
    const inp = h('input', { type: 'text', inputmode: 'numeric', id, class: 'cnt-in', dir: 'ltr', autocomplete: 'off', value: String(val), 'aria-label': label, disabled: disabled || null });
    inp.addEventListener('input', () => { const d = digits(inp.value).slice(0, 3); if (inp.value !== d) inp.value = d; });
    inp.addEventListener('change', () => { const d = digits(inp.value); put(d === '' ? val : Number(d), true); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const d = digits(inp.value); put(d === '' ? val : Number(d)); } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); put(val + (e.key === 'ArrowUp' ? 1 : -1)); } });
    const b = (s, d) => Button({ size: 'sm', type: d > 0 ? 'primary' : 'default', label: s, attrs: { 'aria-label': (d > 0 ? 'زوّد ' : 'قلّل ') + label, 'data-num': id + (d > 0 ? '+' : '-') }, disabled: disabled || (d > 0 ? val >= max : val <= lo), onClick: () => put(val + d) });
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
      if (busy) return;
      // the owner 15 Nov: every AI rewrite asks for instructions first (IBAIAsk — «ابدأ التوليد» / «إغلاق»)
      const a = await window.IBAIAsk({ title: 'إعادة كتابة بالـ AI', intro: 'نسخة جديدة أحسن من الكلام اللي في الخانة.' }); if (!a) return;
      busy = true; btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
      const r = await MK().write(c.campaignId !== undefined ? c.campaignId : camp.id, { task: 'rewrite', kind, piece: c.piece, slide: c.slide, text: inp.value, notes: a.notes });
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
    const tool = h('button', { type: 'button', class: 'card tool-card featured', 'data-mk-start': '', disabled: !C.create || null, onClick: startCampaign, 'aria-label': 'إنشاء محتوى — ابدأ كامبين' }, h('span', { class: 'tool-ic' }, Icon('megaphone')), h('span', { class: 't-h5 tc-t' }, 'إنشاء محتوى'),
      h('span', { class: 't-small tc-b' }, 'من الفكرة لحد النشر: البوستات والكاروسيل، المراجعة، والمواعيد على كل منصة.'), h('span', { class: 'tc-cta' }, 'ابدأ كامبين', Icon('chevL', 'sm')));
    const posts = MK().posts(); const list = MK().campaigns();
    const rows = list.map((c) => { const [label, tone] = W.campaignStatus(c, posts);
      return [h('span', { class: 'prod' }, h('span', null, h('b', null, c.name), h('small', null, c.goal || 'كامبين'))), K.Num(D2(String(c.updatedAt || '').slice(0, 10))), Tag(tone, label),
        h('div', { class: 'acts-inline' }, C.create ? Button({ size: 'sm', label: 'افتح', attrs: { 'data-mk-open': c.id }, onClick: () => openCampaign(c.id) }) : null,
          C.create ? K.RowMenu([{ label: 'احذف الكامبين', icon: 'trash', danger: true, run: () => K.confirm({ title: 'تحذف «' + c.name + '»؟', text: 'الكامبين هتختفي من «آخر الشغل». البوستات اللي اتجدولت منها بتفضل في سجل النشر.', okLabel: 'احذف', okType: 'danger', onOk: async () => { const r = await MK().archive(c.id); K.toast(r.ok ? 'اتحذفت الكامبين' : r.message, r.ok ? 'success' : 'error'); if (r.ok && camp.id === c.id) Object.assign(camp, blankCamp()); R(); } }) }]) : null)]; });
    // the owner 12 Nov: «شيل زر الفيديو خالص وسيب بس زر إنشاء كامبين جديدة» — the video is a piece inside the campaign
    // ش36 (the owner 17 Nov — «حول كلمة "كامبين" ل " إنشاء محتوى" و خليها بالعرض كامل نفس عرض الجدول»): the card spans the page like «آخر الشغل»
    return [h('div', { class: 'tools-grid c1' }, tool),
      Card('آخر الشغل', 'الكامبينات اللي اتعملت — بتتحفظ أول بأول وتقدر تكمّلها من مكان ما وقفت.', list.length ? U.Table({ cls: 'dt', headers: ['الكامبين', 'آخر تعديل', 'الحالة', ''], rows })
        : K.Empty('لسه مفيش كامبينات', 'ابدأ كامبين من الكارت اللي فوق.'))];
  }

  // ---------- the campaign (v5 v3, owner 1 Nov 20:21): تفاصيل الكامبين → البناء → المراجعة → النشر ----------
  function campaign() {
    const body = ({ 1: w1, 2: w2, 3: w3, 4: c5 })[st.step]();
    const ph = K.PageHead('كامبين جديدة', null, [Wallet(), GenAll(), Button({ type: 'text', label: 'اخرج', onClick: () => go('marketing-create') }),
      Button({ label: 'احفظ كمسودة', attrs: { 'data-mk-draft': '' }, disabled: !can().create, onClick: async () => { if (!(await ensureCampaign())) return; persist(0); await MK().flush(camp.id); K.toast('اتحفظت كمسودة', 'success'); go('marketing-create'); } })]);
    // the owner 12 Nov — «شكل الـ fields واسع أوي… خليه يبقى width بتاعه موزون ومنطقي» (Meta's editor): one centered column
    return [h('div', { class: 'wiz-col', 'data-wiz-col': 'campaign' }, ph, Stepper(CSTEPS, st.step, 'marketing-campaign-'), h('div', { class: 'cw cw-s' + st.step }, ...body))];
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
        tplPick(t, m),
        aiField(U.Textarea({ id: 'cw-notes-' + t, label: 'تعليمات إضافية', rows: 2, value: m.notes, placeholder: 'مثلًا: ألوان دافية، من غير ناس، الكلام قليل', onInput: (v) => { m.notes = v; persist(); } }), 'notes', { campaignId: null }))]);
    // the owner 13 Nov (decision 10 of docs/superpowers/plans/2026-11-13-owner-ui-batch.md): no «ملفات إضافية» on a new campaign (an old one's
    // extra files stay as they were)
    const est = W.estimate(c, IMGM()); const w = wallet(); const estV = W.estimateVideo(c);
    const sum = U.InlineNote({ kind: w.balance != null && est > w.balance ? 'warning' : 'info', children: h('span', { 'data-cw-est': String(est) }, 'التكلفة المتوقعة لصور الكامبين كلها تقريبًا ' + K.n0(est) + ' كريديت' + (estV ? ' · والفيديو ≈ ' + K.n0(estV) + ' كريديت على حساب Magnific المربوط (مش من رصيد الصور)' : '') + ' · ' + (w.balance != null ? 'رصيدك ' + K.n0(w.balance) + ' كريديت' : 'اتصرف الشهر ده ' + K.n0(w.used) + ' كريديت') + '. التكلفة الفعلية بتظهر قبل كل توليد، والكتابة بالـ AI مابتصرفش كريدت.') });
    return [goal, idea, media, err.media ? U.InlineNote({ kind: 'error', children: err.media }) : null, sum,
      Foot(1, 4, cback, 'متابعة للبناء', async () => { camp.tried1 = true; if (Object.keys(W.validateDetails(c)).length) { R(); K.toast('كمّل البيانات الناقصة', 'error'); return; }
        camp.pieces = W.buildPieces(c, camp.pieces); if (!(await ensureCampaign())) return; go('marketing-campaign-2'); autoFill(); }, !can().create)];
  }
  function ensurePieces() { if (!camp.pieces.length) camp.pieces = W.buildPieces(camp.w, []); }

  // ===== ٢. البناء =====
  const busyKey = (p, slide) => p.id + (slide == null ? '' : ':' + slide);
  // the owner 16 Nov («الصورة بتتغير ال ratio بتاعتها حسب اللي مختاره»): the box takes the chosen size's own ratio (1080×1350 → 4:5, 1200×628, 9:16 …)
  const arOf = (size) => { const m = /(\d+)\s*[x:×]\s*(\d+)/.exec(String(size || '')); return m && Number(m[1]) && Number(m[2]) ? m[1] + ' / ' + m[2] : null; };
  const pv = (src, cls, label, busy) => h('div', { class: 'cw-pv' + (cls && cls.cls ? ' ' + cls.cls : typeof cls === 'string' && cls ? ' ' + cls : ''), style: cls && cls.ar ? 'aspect-ratio:' + cls.ar : null, 'data-cw-ar': cls && cls.ar ? cls.ar : null,
    role: src ? null : 'img', 'aria-label': src ? null : 'لسه ما اتولدتش', 'aria-busy': busy ? 'true' : null },
    src ? Img(src, 'fill') : h('span', { class: 'cw-pv-e' }, Icon('image'), h('small', null, label || 'المعاينة هنا')), busy ? h('span', { class: 'cw-pv-busy', 'data-cw-busy': '' }, busy === 'up' ? 'بيترفع…' : 'بيتولد…') : null);
  const vcls = (p) => ({ cls: szCls(p.size).trim(), ar: arOf(p.size) });
  // the owner 16 Nov («خلي زر توليد و ارفع صورة يبقوا تحت مربع الصورة»): the image box and its buttons in one column
  const media = (box, ...acts) => h('div', { class: 'cw-media' }, box, acts.filter(Boolean).length ? h('div', { class: 'cw-media-acts', 'data-cw-media-acts': '' }, acts) : null);
  // one image of a piece (slide null = a post / an extra file, -1 = a carousel's cover, k = its slide) → the path into the piece
  async function genImage(p, slide) {
    const key = busyKey(p, slide); if (camp.busy[key]) return false;
    if (!(await ensureCampaign())) return false;
    camp.busy[key] = true; persist(0); R();
    const vid = p.kind === 'فيديو';
    const r = await MK().generate(camp.id, { piece: p.id, slide, model: vid ? W.DEFAULT_MODEL : p.model, size: vid ? W.videoImgSize(p.size) : p.size });
    delete camp.busy[key];
    if (!r.ok) { K.toast(r.message, 'error'); R(); return false; }
    setImg(p, slide, r.path);
    persist(0); R(); return true;
  }
  // an image onto its place — a post / an extra file (slide null), a carousel's cover (-1) or slide, a video scene's key frame: the
  // piece is to be reviewed again; a new key frame makes the clips and the cut stale
  function setImg(p, slide, path) {
    const vid = p.kind === 'فيديو'; const t = slide == null || slide < 0 ? (vid ? null : p) : vid ? (p.scenes || [])[slide] : (p.slides || [])[slide];
    if (!t) return false;
    t.img = path; t.gen = (t.gen || 0) + 1; t.approved = false; t.v = t.gen > 1 ? t.gen : t.v; if (t !== p) p.approved = false;
    if (vid) { p.assembled = false; p.video = null; }
    return true;
  }
  // comments decision 52 (the owner 15 Nov on the campaign — «عايز اضيف upload للصور عشان لو معايا صور»): a ready image of the member's as
  // the piece's own — it goes to the campaign's folder like a generated one (no credit), and the review / the publishing treat it the same
  function upBtn(p, slide, label) {
    if (!can().create) return null;
    const id = 'cw-up-' + p.id + (slide == null ? '' : slide < 0 ? '-cv' : '-' + slide); const key = busyKey(p, slide);
    const inp = h('input', { type: 'file', class: 'sr-file', id, accept: 'image/png,image/jpeg,image/webp', 'data-cw-up': p.id + (slide == null ? '' : ':' + slide), onChange: async () => {
      const f = inp.files[0]; inp.value = ''; if (!f || camp.busy[key]) return;
      if (!(await ensureCampaign())) return;
      const cid = camp.id; camp.busy[key] = 'up'; R();
      const r = await MK().upload(cid, f);
      // `camp` is one object a new campaign refills: the answer counts only while this campaign and this piece are still the open ones
      if (camp.id !== cid || !camp.pieces.includes(p)) return;
      delete camp.busy[key];
      if (!r.ok) { K.toast(r.message, 'error'); R(); return; }
      if (!setImg(p, slide, r.path)) { R(); return; }
      K.logEvent('mkt.campaign.image_upload', p.id + (slide == null ? '' : slide < 0 ? '·cover' : '·' + (slide + 1)));
      persist(0); R(); K.toast('اترفعت الصورة', 'success');
    } });
    return h('span', { class: 'cw-up' }, h('label', { class: 'btn btn-default sm' + (camp.busy[key] ? ' disabled' : ''), for: id, tabindex: '0', role: 'button', 'aria-disabled': camp.busy[key] ? 'true' : null, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, Icon('upload', 'sm'), h('span', null, label || 'ارفع صورة')), inp);
  }
  // comments decision 52 (the same comment — «عايز ابعت الصور لmagnific او ابعت الprompt اللي يتعملي بيه صورة زي اللي كنت عامله في صفحة المنتجات
  // … و كمان زرار استلم بيه الصور من magnific») and the campaign half of decision 49: the build step's Magnific bar, the studio's own
  // look. «ابعت لـ Magnific» puts a generator for every image of the campaign on the account's Space — its prompt (the one the
  // credits path would send) and its reference photos; the member runs them there (no credit of ours) and «هات النتائج» brings the
  // newest result of each onto its piece. The link is kept with the campaign for the page; the server trusts its own record.
  function mgStatus() { if (camp.mgLinked != null || camp.mgAsked || !MK() || !MK().magnificStatus) return; camp.mgAsked = true; MK().magnificStatus().then((r) => { camp.mgLinked = !!(r && r.linked); if (st.view === 'campaign' && st.step === 2) R(); }); }
  const mgCount = () => camp.pieces.reduce((n, p) => n + (p.kind === 'فيديو' ? (p.scenes || []).length : p.kind === 'كاروسيل' ? 1 + (p.slides || []).length : 1), 0);
  async function mgSend() {
    if (camp.mgBusy || !can().create) return;
    if (!(await ensureCampaign())) return;
    const cid = camp.id; camp.mgBusy = 'send'; R();
    const r = await MK().magnificSend(cid);
    if (camp.id !== cid) { if (r.ok) K.toast('اتبعتت قطع الكامبين لـ Magnific — افتحها من «آخر الشغل» عشان تجيب النتايج', 'success'); return; } // another campaign is open now: its own bar is untouched
    camp.mgBusy = null;
    if (!r.ok) { if (r.code === 'not_linked' || r.reason === 'not_configured') camp.mgLinked = false; K.toast(r.message, 'error'); R(); return; }
    camp.mgLinked = true; camp.mg = { url: r.url, n: r.targets, at: new Date().toISOString() }; persist(0);
    R();
    K.toast('اتبعت ' + K.n0(r.targets) + ' صورة لـ Magnific' + (r.refs ? ' بـ ' + K.n0(r.refs) + ' صورة مرجعية' : '') + (r.left ? ' — ' + K.n0(r.left) + ' صورة زيادة ما دخلتش الفلو' : '') + ' — افتح الـ Space وشغّل المولّدات', 'success');
  }
  async function mgFetch() {
    if (camp.mgBusy || !can().create || !camp.id) return;
    const cid = camp.id; camp.mgBusy = 'fetch'; R();
    const r = await MK().magnificFetch(cid);
    // another campaign is open now: the server put the results on the saved campaign itself — they are there when it is opened
    if (camp.id !== cid) { if (r.ok && r.placed.length) K.toast('نتايج Magnific اتحطت على قطع الكامبين — افتحها من «آخر الشغل»', 'success'); return; }
    camp.mgBusy = null;
    if (!r.ok) { if (r.code === 'not_linked') camp.mgLinked = false; K.toast(r.message, 'error'); R(); return; }
    let n = 0;
    r.placed.forEach((x) => { const p = camp.pieces.find((y) => y.id === x.piece); if (p && setImg(p, x.slide, x.path)) n += 1; });
    if (n) persist(0);
    R();
    const rest = (r.offhost + r.failed) ? ' · ' + K.n0(r.offhost + r.failed) + ' ما اتنزّلتش — جرّب تاني' : '';
    K.toast(n ? 'اتحطت ' + K.n0(n) + ' صورة من Magnific على قطعها — راجعها' + rest : r.found ? 'النتايج ما اتنزّلتش' + rest : 'مفيش نتايج جديدة على Magnific — شغّل المولّدات في الـ Space الأول', n ? 'success' : r.found ? 'error' : 'info');
  }
  // 0123 (the owner 17 Nov): the bridge's bar only while Magnific is the campaign's image provider in «الإعدادات»
  function magnificBar() {
    if (!can().create || !MK() || !MK().magnificSend || (window.IBSettings && window.IBSettings.magnificOn && !window.IBSettings.magnificOn('campaign'))) return null;
    mgStatus(); const mg = camp.mg; const n = mgCount(); const busy = camp.mgBusy;
    const url = mg && typeof mg.url === 'string' && /^https:\/\//.test(mg.url) ? mg.url : null;
    const head = h('div', { class: 'fl-mg-h' }, Icon('sparkle', 'sm'), h('b', null, 'Magnific'), h('small', { class: 'help' }, 'ولّد على موقع Magnific بباقتك — من غير كريدت الـ API: ابعت القطع (صورها المرجعية والبرومبت بتاع كل صورة)، شغّل المولّدات هناك، وهات النتائج على القطع.'));
    return h('div', { class: 'fl-mg cw-mg', 'data-cw-magnific': mg ? 'sent' : 'new' }, head,
      camp.mgLinked === false ? U.InlineNote({ kind: 'warning', children: h('span', { 'data-cw-mg-unlinked': '' }, 'حساب Magnific مش مربوط — الأدمن بيربطه من «الإعدادات › الربط بالمنصات».') }) : null,
      h('div', { class: 'acts-inline start' },
        Button({ size: 'sm', icon: 'upload', label: busy === 'send' ? 'بنبعت…' : mg ? 'ابعت تاني لـ Magnific' : 'ابعت لـ Magnific', disabled: !!busy || !n, attrs: { 'data-cw-mg-send': '', title: 'كل صور الكامبين (' + n + ') ببرومبتاتها وصورها المرجعية' }, onClick: mgSend }),
        url ? h('a', { class: 'btn btn-default sm', href: url, target: '_blank', rel: 'noopener', 'data-cw-mg-open': '' }, 'افتح الـ Space ↗') : null,
        mg ? Button({ size: 'sm', icon: 'download', label: busy === 'fetch' ? 'بنجيب…' : 'هات النتائج من Magnific', disabled: !!busy, attrs: { 'data-cw-mg-fetch': '' }, onClick: mgFetch }) : null,
        h('span', { class: 't-small help', 'data-cw-mg-state': mg ? String(mg.n || 0) : '0' }, U.num(mg ? 'اتبعت ' + (mg.n || 0) + ' صورة' + (mg.at ? ' · ' + dayLabel(String(mg.at).slice(0, 10)) : '') + ' — لو غيّرت الكلام ابعت تاني' : n ? n + ' صورة في الكامبين' : 'مفيش صور لسه'))));
  }
  async function genCarousel(p) { if (!(await genImage(p, -1))) return false; for (let k = 0; k < p.slides.length; k++) if (!(await genImage(p, k))) return false; return true; }
  // «املأ بالـ AI»: the empty fields of the piece (and its slides) from its campaign — the filled ones stay
  async function aiFill(p, notes) {
    if (!(await ensureCampaign())) return false; persist(0);
    const r = await MK().write(camp.id, { task: 'fill', piece: p.id, notes });
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    const f = r.fields || {};
    ['idea', 'caption', 'title', 'sub', 'badge'].forEach((k) => { if (f[k] && !p[k]) p[k] = f[k]; });
    if (Array.isArray(f.slides) && Array.isArray(p.slides)) p.slides.forEach((s, i) => { const x = f.slides[i] || {}; ['idea', 'title', 'sub'].forEach((k) => { if (x[k] && !s[k]) s[k] = x[k]; }); });
    persist(0); return true;
  }
  // comments decision 28 (the owner 15 Nov — «مجرد ما ادوس هنا عايز كل ال الكونتنت و الافكار تتكتب بال ai و مبقاش محتاج ادوس املأ بال ai»):
  // «متابعة للبناء» writes the pieces' empty texts with the AI by itself — a piece after the other, what is written stays, the
  // campaign's own instructions («تعليمات») are the guide, so no instructions popup. A video piece with no scenes gets its scenes
  // too. A piece is asked once (p.af — going back and forth never rewrites it), and a refusal stops the run: «املأ بالـ AI» on
  // each piece is still there.
  const needsText = (p) => (p.kind === 'فيديو' ? !p.idea || !p.caption : !p.idea || !p.caption || !p.title || (Array.isArray(p.slides) && p.slides.some((x) => !x.idea || !x.title)));
  const needsScenes = (p) => p.kind === 'فيديو' && !(p.scenes || []).length;
  async function autoFill() {
    const mine = camp; if (!can().create || mine.filling) return;
    const todo = mine.pieces.filter((p) => !p.af && (needsText(p) || needsScenes(p))); if (!todo.length) return;
    mine.filling = { done: 0, total: todo.length }; R();
    const say = (n) => 'بنكتب محتوى القطع بالـ AI… ' + K.n0(n) + ' من ' + K.n0(todo.length);
    const pill = K.busy ? K.busy(say(1)) : null; let ok = 0;
    for (const p of todo) {
      if (camp !== mine) break; // the member left this campaign
      if (pill && pill.set) pill.set(say(ok + 1));
      let good = !needsText(p) || await aiFill(p);
      if (good && camp === mine && needsScenes(p)) good = await planScenes(p);
      if (!good || camp !== mine) break;
      p.af = 1; ok += 1; mine.filling.done = ok; persist(0); if (st.view === 'campaign' && st.step === 2) R();
    }
    mine.filling = null;
    if (pill) { if (ok === todo.length) pill.done('اتكتب محتوى ' + K.n0(ok) + ' قطعة — راجعه'); else if (camp !== mine) pill.close(); else pill.fail(ok ? 'اتكتب ' + K.n0(ok) + ' من ' + K.n0(todo.length) + ' — كمّل الباقي من «املأ بالـ AI»' : 'المحتوى ماتكتبش — جرّب «املأ بالـ AI» على القطعة'); }
    if (camp === mine && st.view === 'campaign') R();
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
  async function planScenes(p, notes) {
    if (!(await ensureCampaign())) return false; persist(0);
    const r = await MK().videoScenes(camp.id, p.id, p.voice && p.voice.mode === 'ai', notes);
    if (!r.ok) { K.toast(r.message, 'error'); return false; }
    const old = p.scenes || [];
    // comments decision 65: the seconds a member set on a scene stay when the same number of scenes is planned again
    p.scenes = W.keepSceneDurs(r.scenes.map((s, k) => Object.assign({ n: k + 1, d: s.d, idea: s.idea, text: s.text, cam: s.cam, ref: [], use: [] }, old.length === r.scenes.length && old[k] && old[k].img ? { img: old[k].img, gen: old[k].gen } : {})), old);
    if (p.scenes.some((x) => x.dh)) p.dur = p.scenes.reduce((x, y) => x + (Number(y.d) || 0), 0);
    if (p.voice && !p.voice.text && r.voice) p.voice.text = r.voice;
    p.assembled = false; p.video = null; p.approved = false; persist(0); return true;
  }
  const sceneCostAll = (p) => W.cost('scenes-img', Object.assign({}, p, { scenes: (p.scenes || []).length ? p.scenes.filter((x) => !x.img) : W.splitScenes(p.dur, p.sceneCount) }), IMGM());
  function pieceHead(p) {
    const cost = p.kind === 'كاروسيل' ? W.cost('carousel', p, IMGM()) : p.kind === 'فيديو' ? sceneCostAll(p) : W.cost('image', p, IMGM());
    return h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, 'المقاس: ', szName(p.size)), h('span', null, 'الموديل: ', mdlName(p.model)), h('span', null, 'هيصرف: ', K.Num(K.n0(cost) + ' كريديت'))),
      W.built(p) ? Tag('success', 'اتولد') : Tag('neutral', 'لسه'), h('span', { class: 'grow' }), aiBtn('املأ بالـ AI', async () => { const a = await window.IBAIAsk({ title: 'املأ القطعة بالـ AI', intro: 'الحقول الفاضية بس — اللي مكتوب يفضل.' }); if (a && await aiFill(p, a.notes)) K.toast('اتملت الحقول الفاضية — راجعها', 'success'); }, { 'data-cw-fill': p.id }));
  }
  function buildCard(p) {
    const anchor = { id: 'cw-' + p.id, 'data-cw-piece': p.id, tabindex: '-1' };
    if (p.kind === 'فيديو') return buildVideo(p, anchor);
    if (p.kind === 'كاروسيل') {
      const n = W.cost('carousel', p, IMGM()); const any = Object.keys(camp.busy).some((k) => k.startsWith(p.id + ':'));
      return h('section', Object.assign({ class: 'card cw-piece' }, anchor), pieceHead(p),
        h('div', { class: 'cw-grid' }, media(pv(p.img, vcls(p), 'الغلاف', camp.busy[busyKey(p, -1)]), upBtn(p, -1, 'ارفع صورة الغلاف')), h('div', { class: 'cw-fields' }, h('h3', { class: 't-h6' }, 'الغلاف'), ...fieldsFor(p, 'b-', { ideaLabel: 'فكرة الغلاف' }))),
        h('h3', { class: 't-h6 cw-sub' }, 'صور الكاروسيل (' + p.slides.length + ')'),
        h('div', { class: 'cw-slides' }, p.slides.map((s, k) => h('div', { class: 'cw-slide' }, h('div', { class: 'cw-grid' }, media(pv(s.img, vcls(p), 'صورة ' + (k + 1), camp.busy[busyKey(p, k)]), upBtn(p, k, 'ارفع صورة ' + (k + 1))), h('div', { class: 'cw-fields' }, h('b', null, 'صورة ' + (k + 1)), ...fieldsFor(p, 'b-', { k, target: s, caption: false, ideaLabel: 'فكرة الصورة' })))))),
        h('div', { class: 'acts-inline start' }, costBtn(p.img ? 'ولّد الكاروسيل تاني' : 'توليد الكاروسيل', n, async () => { if (await genCarousel(p)) K.toast('اتولد الغلاف و' + p.slides.length + ' صور', 'success'); }, { 'data-cw-gen': p.id }, null, any)));
    }
    const n = W.cost('image', p, IMGM()); const busy = camp.busy[busyKey(p, null)];
    return h('section', Object.assign({ class: 'card cw-piece' }, anchor), pieceHead(p), h('div', { class: 'cw-grid' }, media(pv(p.img, vcls(p), null, busy),
      costBtn(p.img ? 'ولّد تاني' : 'توليد الصورة', n, async () => { if (await genImage(p, null)) K.toast('اتولدت الصورة', 'success'); }, { 'data-cw-gen': p.id }, null, busy), upBtn(p, null, p.img ? 'ارفع صورة تانية' : 'ارفع صورة')),
      h('div', { class: 'cw-fields' }, ...fieldsFor(p, 'b-', { caption: p.kind === 'بوست' }))));
  }
  // the video piece in the build step (the v6): the idea and the caption, the scenes count, «توليد المشاهد» by Claude, a key frame a scene
  function buildVideo(p, anchor) {
    const ctx = { piece: p.id, slide: null }; const sc = p.scenes || [];
    // comments decisions 33 and 65 (the owner 15 Nov): «مدة المشهد الواحد» beside the scenes count (every scene the same seconds —
    // the video's length follows) and each scene's own seconds on its card; the seconds a model takes and the video's 30 are the
    // domain's (W.sceneSeconds / setSceneDur / setSceneD). A changed length means the assembled video no longer matches.
    const stale = (x) => { x.assembled = false; x.video = null; x.approved = false; };
    const secs = (id, label, val, opts, set) => { const L = opts.includes(val) ? opts : opts.concat(val).sort((a, b) => a - b); const run = L.every((x, i) => i === 0 || x === L[i - 1] + 1);
      return run ? num(id, label, val, L[L.length - 1], set, L[0]) : U.Select({ id, label, value: String(val), options: L.map((x) => ({ value: String(x), label: x + ' ث' })), onChange: (v) => { set(Number(v)); persist(); R(); } }); };
    const total = W.videoSeconds(p); const pending = W.scenesPending(p); // before a plan for this count: what its scenes will add up to
    const sceneOpts = (k) => { const others = sc.reduce((x, y, i) => x + (i === k ? 0 : Number(y.d) || 0), 0); const m = W.CLIP[p.model] || W.CLIP['seedance-2.5']; const cap = W.VIDEO_MAX - others;
      if (m.fixed) return m.fixed.filter((x) => x <= cap); const out = []; for (let x = m.min; x <= Math.min(m.max, cap); x++) out.push(x); return out; };
    const scene = (s, k) => h('div', { class: 'cw-scene', 'data-cw-scene': p.id + '-' + k }, h('div', { class: 'cw-grid' }, pv(s.img, vcls(p), 'المشهد ' + (k + 1), camp.busy[busyKey(p, k)]), h('div', { class: 'cw-fields' }, h('div', { class: 'cw-scene-h' }, h('b', null, 'المشهد ' + (k + 1)), secs('b-' + p.id + '-d' + k, 'مدة المشهد (ث)', W.clipSeconds(s.d, p.model), sceneOpts(k), (v) => { const why = W.setSceneD(p, k, v); if (why) { K.toast(why, 'error'); return; } stale(p); })),
      txt('b-' + p.id + '-sc' + k, 'فكرة المشهد', s.idea, (v) => { s.idea = v; }, true, { piece: p.id, slide: k }),
      K.two(U.Select({ id: 'b-' + p.id + '-cam' + k, label: 'الكاميرا', value: VCAMS.includes(s.cam) ? s.cam : 'ثابتة', options: VCAMS.map((x) => ({ value: x, label: x })), onChange: (v) => { s.cam = v; persist(); } }),
        U.TextInput({ id: 'b-' + p.id + '-tx' + k, label: 'كلام على الشاشة', value: s.text || '', maxlength: 60, placeholder: '—', onInput: (v) => { s.text = v; persist(); } })),
      h('div', { class: 'acts-inline start' }, costBtn(s.img ? 'ولّد صورة المشهد تاني' : 'توليد صورة المشهد', W.cost('scene', p, IMGM()), async () => { if (await genImage(p, k)) K.toast('اتولدت صورة المشهد ' + (k + 1), 'success'); }, { 'data-cw-scene-gen': p.id + '-' + k }, null, camp.busy[busyKey(p, k)]), upBtn(p, k, 'ارفع صورة المشهد')))));
    const allN = sc.length ? W.cost('scenes-img', Object.assign({}, p, { scenes: sc.filter((x) => !x.img) }), IMGM()) : 0;
    return h('section', Object.assign({ class: 'card cw-piece cw-vid' }, anchor), pieceHead(p),
      h('div', { class: 'cw-grid' }, pv(sc[0] && sc[0].img, vcls(p), 'فيديو ' + K.n0(p.dur) + ' ث'), h('div', { class: 'cw-fields' }, txt('b-' + p.id + '-idea', 'فكرة الفيديو', p.idea, (v) => { p.idea = v; }, true, ctx), txt('b-' + p.id + '-cap', 'الكابشن المقترح', p.caption, (v) => { p.caption = v; }, true, ctx),
        Files('b-' + p.id + '-ref', 'مثال للمطابقة', p.ref, null, 'video'), Files('b-' + p.id + '-use', 'صور أو لينكات للاستخدام', p.use),
        h('div', { class: 'cw-row', 'data-cw-scene-set': p.id }, num('b-' + p.id + '-n', 'عدد المشاهد', p.sceneCount, W.MAX.scenes, (v) => { W.setSceneCount(p, v); }, 1),
          secs('b-' + p.id + '-sd', 'مدة المشهد الواحد (ث)', W.sceneDurOf(p), W.sceneSeconds(p.model, pending || !sc.length ? p.sceneCount : sc.length), (v) => { const why = W.setSceneDur(p, v); if (why) { K.toast(why, 'error'); return; } stale(p); }),
          h('div', { class: 'cw-total', 'data-cw-total': p.id }, h('span', { class: 't-label' }, 'مدة الفيديو'), h('b', null, K.n0(total) + ' ث'),
            pending ? h('small', { 'data-cw-replan': '' }, 'العدد اتغيّر — «وزّع المشاهد تاني»') : sc.length && !sc.every((x) => Number(x.d) === Number(sc[0].d)) ? h('small', null, 'المشاهد مددها مختلفة') : null)),
        h('div', { class: 'acts-inline start' }, aiBtn(sc.length ? 'وزّع المشاهد تاني' : 'توليد المشاهد', async () => { const a = await window.IBAIAsk({ title: sc.length ? 'وزّع المشاهد تاني بالـ AI' : 'توليد المشاهد بالـ AI', intro: 'فكرة كل مشهد والكلام اللي على الشاشة وحركة الكاميرا' + (p.voice && p.voice.mode === 'ai' ? ' ونص الفويس.' : '.') }); if (a && await planScenes(p, a.notes)) K.toast('اتقسم الفيديو ' + K.n0(p.scenes.length) + ' مشاهد — ولّد صورة كل مشهد', 'success'); }, { 'data-cw-plan': p.id })))),
      sc.length ? [h('div', { class: 'grp-h cw-sub' }, h('h3', { class: 't-h6' }, 'المشاهد (' + K.n0(sc.length) + ')'), h('span', { class: 'grow' }), allN ? costBtn('ولّد صور كل المشاهد', allN, async () => { for (let k = 0; k < sc.length; k++) { if (!sc[k].img && !(await genImage(p, k))) return; } K.toast('اتولدت صور المشاهد', 'success'); }, { 'data-cw-scenes-all': p.id }) : null), h('div', { class: 'cw-scenes' }, sc.map(scene))] : null);
  }
  // «ولّد الكل بالـ AI» (owner 2 Nov 00:25): every piece still missing — the empty texts first (no credit), then the images
  function genAllPlan(notes) {
    const ps = camp.pieces || []; let cost = 0; const jobs = []; let texts = 0;
    ps.forEach((p) => { if (W.built(p)) return;
      if (p.kind === 'فيديو') { const sc = (p.scenes || []).length ? p.scenes : W.splitScenes(p.dur, p.sceneCount); if (!(p.scenes || []).length) { texts += 1; jobs.push(() => planScenes(p, notes)); } sc.forEach((x, k) => { if (!x.img) { cost += W.cost('scene', p, IMGM()); jobs.push(() => genImage(p, k)); } }); return; }
      if (!p.idea) { texts += 1; jobs.push(() => aiFill(p, notes)); }
      if (p.kind === 'كاروسيل') { const miss = [p.img ? null : -1].concat(p.slides.map((s, k) => (s.img ? null : k))).filter((x) => x != null); cost += W.imgRate(IMGM(), p.model) * miss.length; miss.forEach((k) => jobs.push(() => genImage(p, k))); }
      else { cost += W.cost('image', p, IMGM()); jobs.push(() => genImage(p, null)); } });
    return { cost, jobs, texts };
  }
  function GenAll() {
    if (st.step !== 2) return null; ensurePieces(); const g = genAllPlan();
    if (!g.jobs.length) return Button({ size: 'sm', icon: 'check', label: 'كله اتولد', disabled: true, attrs: { 'data-cw-genall': 'done' } });
    return Button({ type: 'brand', size: 'sm', icon: 'sparkle', label: 'ولّد الكل بالـ AI‏ · ' + K.n0(g.cost) + ' كريديت', disabled: !can().create, attrs: { 'data-cw-genall': String(g.cost), title: 'ولّد كل القطع في ضغطة واحدة' },
      onClick: async () => {
        // the owner 15 Nov: the texts the AI writes on the way (empty pieces, scenes) take the member's instructions first
        let plan = g; if (g.texts) { const a = await window.IBAIAsk({ title: 'ولّد الكل بالـ AI', intro: 'الكلام الفاضي في القطع بيتكتب الأول بالتعليمات دي، وبعدها الصور (هتأكد الكريدت).' }); if (!a) return; plan = genAllPlan(a.notes); }
        pay('ولّد كل القطع بالـ AI', plan.cost, async () => { for (const j of plan.jobs) { if (!(await j())) return; } K.logEvent('mkt.campaign.generate_all', 'step 2 · ' + plan.cost); K.toast('اتولدت كل القطع — راجعها', 'success'); }); } });
  }
  function w2() {
    ensurePieces(); const ps = camp.pieces; const pr = W.progress(ps, W.built);
    const jump = h('nav', { class: 'cw-jump', 'aria-label': 'القطع' }, ps.map((p) => h('a', { href: '#cw-' + p.id, class: 'chip' + (W.built(p) ? ' on' : ''), onClick: (e) => { e.preventDefault(); const el = document.getElementById('cw-' + p.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.focus({ preventScroll: true }); } } }, W.built(p) ? Icon('check', 'sm') : null, p.kind + ' ' + p.n)));
    return [h('div', { class: 'cw-bar card' }, h('span', { 'data-cw-built': pr.done + '/' + pr.total }, 'اتولد ', K.Num(pr.done + ' من ' + pr.total)), h('span', { class: 'grow' }), jump),
      magnificBar(),
      camp.filling ? U.InlineNote({ children: h('span', { 'data-cw-autofill': camp.filling.done + '/' + camp.filling.total }, 'بنحمّل المحتوى: الـ AI بيكتب أفكار القطع وكلامها لوحده (' + K.n0(camp.filling.done) + ' من ' + K.n0(camp.filling.total) + ') — اللي مكتوب بيفضل، وتقدر تعدّل أي خانة.') }) : null,
      ...ps.map(buildCard),
      pr.done < pr.total ? U.InlineNote({ children: 'ولّد كل القطع عشان تكمّل للمراجعة.' }) : null,
      Foot(2, 4, cback, 'متابعة للمراجعة', () => { camp.rtab = ps.some((p) => p.kind === 'بوست' || p.kind === 'ملف إضافي') ? 'post' : ps.some((p) => p.kind === 'كاروسيل') ? 'carousel' : 'video'; go('marketing-campaign-3'); }, !W.canBuildNext(ps))];
  }

  // ===== ٣. المراجعة =====
  // تعديل بالكومنتس (owner 1 Nov 22:19): دوس على الصورة تحط نقطة مترقمة واكتب عندها التعديل → «ولّد بالتعديل» (decision 9)
  function editRegen(p, slide, label) {
    const t = slide == null || slide < 0 ? p : p.slides[slide]; let note = '';
    const pins = (t.pins || []).map((x) => Object.assign({}, x)); let adding = true;
    const before = { title: t.title || '', sub: t.sub || '', badge: t.badge || '' };
    const m = U.Modal({ title: 'تعديل على الصورة — ' + label, body: [], footer: [] }); m.el.classList.add('wide');
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
      Button({ size: 'sm', icon: 'edit', label: 'تعديل على الصورة', disabled: !t.img || !can().create, attrs: { 'data-cw-edit': label }, onClick: () => editRegen(p, slide, label) })); };
  function reviewPost(p) {
    const ctx = { piece: p.id, slide: null }; const busy = camp.busy[busyKey(p, null)];
    return h('section', { class: 'card cw-piece cw-rev' + (p.approved ? ' ok' : ''), 'data-cw-rev': p.id }, h('div', { class: 'cw-ph' }, h('b', { class: 't-h5' }, p.kind + ' ' + p.n), h('span', { class: 'cw-meta' }, h('span', null, szName(p.size)), h('span', null, mdlName(p.model))), p.v > 1 ? Tag('gold', 'نسخة ' + p.v) : null),
      h('div', { class: 'cw-grid' }, h('div', { class: 'cw-pv-w' }, pv(p.img, vcls(p), null, busy)), h('div', { class: 'cw-fields' }, p.kind === 'بوست' ? txt('r-' + p.id + '-cap', 'الكابشن', p.caption, (v) => { p.caption = v; }, true, ctx) : null,
        (p.pins || []).length ? U.InlineNote({ children: (p.pins || []).length + ' تعليق محفوظ على الصورة — «تعديل على الصورة» عشان تولّد بيهم' }) : null, okBtns(p, null, p.kind + ' ' + p.n))));
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
  // the owner 17 Nov («عايز الغي زرار النشر اللي في عمود الطريقة و عايز احط حاجة تخليني احدد البوستات اللي عايز اجدولها او اوقف نشر»):
  // no «الطريقة» column — a piece is published by the system where its platform can take it, else it is a download (W.scheduleItems);
  // a checkbox per row and a bar: «جدولة المحدد» · «وقف نشر المحدد» (stays in the plan «متوقف» — 0122) · «كمّل النشر» · «تحميل المحدد»;
  // «تأكيد النشر» schedules the picked pieces only — the others stay as they are (a draft stays a draft)
  const PIECE_TONE = { 'مسودة': 'neutral', 'مجدول': 'gold', 'متوقف': 'orange', 'فشل': 'error', 'اتنشر': 'success' };
  function c5() {
    ensurePieces(); const cn = needConn();
    const sch = (p, i) => (camp.sched[p.id] = camp.sched[p.id] || Object.assign(W.suggest(i, TODAY()), { pl: ['انستجرام', 'فيسبوك'] }));
    const posts = MK().posts ? MK().posts() : [];
    const stOf = (p) => W.pieceState(posts, camp.id, p.id);
    const sel = camp.pubSel; camp.pieces.forEach((p, i) => sch(p, i));
    [...sel].forEach((id) => { if (!camp.pieces.some((p) => p.id === id)) sel.delete(id); });
    const all = camp.pieces.length && camp.pieces.every((p) => sel.has(p.id));
    const sp = camp.pieces.filter((p) => sel.has(p.id));
    const pausable = (list) => list.flatMap((p) => stOf(p).posts.filter(W.canPause));
    const resumable = (list) => list.flatMap((p) => stOf(p).posts.filter(W.canResume));
    async function pauseMany(list) {
      const L = pausable(list); if (!L.length) { K.toast('مفيش بوستات مجدولة في المحدد', 'error'); return; }
      let n = 0, bad = null; for (const x of L) { const r = await MK().pause(x.id); if (r.ok) n += 1; else bad = r.message; }
      K.toast(bad && !n ? bad : 'اتوقف نشر ' + n + ' بوست — فاضلين في الخطة «متوقف» لحد «كمّل النشر»' + (bad ? ' (' + bad + ')' : ''), bad && !n ? 'error' : 'success'); R();
    }
    async function resumeMany(list) {
      const L = resumable(list); if (!L.length) { K.toast('مفيش بوستات متوقفة في المحدد', 'error'); return; }
      let n = 0, gone = 0, bad = null;
      for (const x of L) { const r = await MK().resume(x.id); if (r.ok) n += 1; else if (r.field === 'time') gone += 1; else bad = r.message; }
      const msg = (n ? 'رجع ' + n + ' بوست للجدول' : '') + (gone ? (n ? ' — ' : '') + gone + ' ميعادهم فات: غيّر التاريخ والوقت وجدولهم تاني' : '') + (bad ? (n || gone ? ' — ' : '') + bad : '');
      K.toast(msg, n && !gone && !bad ? 'success' : 'error'); R();
    }
    const rows = camp.pieces.map((p) => { const s = camp.sched[p.id]; const ps = stOf(p);
      const why = (s.pl || []).length ? (s.pl.every((pl) => !pubOf(p, pl, cn).ok) ? 'داونلود — ' + ((s.pl || []).map((pl) => pubOf(p, pl, cn).why).find(Boolean) || '') : (s.pl.some((pl) => !pubOf(p, pl, cn).ok) ? 'بيتنشر لوحده على اللي يقدر، والباقي داونلود' : 'بيتنشر لوحده في ميعاده')) : 'اختار منصة الأول';
      return [cbx('حدد ' + pieceLabel(p), sel.has(p.id), (v) => { v ? sel.add(p.id) : sel.delete(p.id); R(); }), h('span', { class: 'prod' }, Img(pieceImg(p)), h('span', null, h('b', null, pieceLabel(p)), h('small', null, W.hookOf(p)))),
        h('span', { 'data-cw-state': p.id, title: why }, Tag(PIECE_TONE[ps.status] || 'neutral', ps.status)),
        U.DateField({ id: 'sd-' + p.id, label: '', value: s.date, today: TODAY(), onChange: (v) => { s.date = v; persist(); R(); } }),
        U.Select({ id: 'st-' + p.id, label: '', options: W.timeOpts(s.time).map((x) => ({ value: x, label: x })), value: s.time, onChange: (v) => { s.time = v; persist(); R(); } }),
        h('div', { class: 'chips cw-pls', 'data-cw-pl': p.id }, W.PLATFORMS.map((pl) => plChip(pl, s.pl.includes(pl), () => { s.pl = s.pl.includes(pl) ? s.pl.filter((x) => x !== pl) : s.pl.concat(pl); persist(); R(); }))),
        K.RowMenu([{ label: 'نزّل فولدر (الصور + التكست)', icon: 'download', run: () => downloadZip([zipItem(p)], pieceLabel(p)) },
          can().publish && pausable([p]).length ? { label: 'وقف النشر', icon: 'clock', run: () => pauseMany([p]) } : null,
          can().publish && resumable([p]).length ? { label: 'كمّل النشر', icon: 'play', run: () => resumeMany([p]) } : null,
          { label: 'انسخ الكابشن', icon: 'copy', run: () => { try { navigator.clipboard.writeText((p.caption || camp.w.idea) + '\n' + W.TAGS); } catch (e) { /* the clipboard is the browser's */ } K.toast('اتنسخ الكابشن'); } },
          { label: 'افتح القطعة', icon: 'edit', run: () => { camp.rtab = p.kind === 'كاروسيل' ? 'carousel' : p.kind === 'فيديو' ? 'video' : 'post'; go('marketing-campaign-3'); } }].filter(Boolean))]; });
    const conn5 = connCard(Button({ label: 'نزّل الكل كفولدر (ZIP)', icon: 'download', attrs: { 'data-cw-zip': 'all' }, onClick: () => downloadZip(camp.pieces.map(zipItem), W.campaignName(camp.w.idea)) }));
    // «تأكيد النشر» / «جدولة المحدد»: the picked pieces only (0122 p_keep — the others' rows stay as they are)
    const confirm = async () => {
      if (camp.busy.pub) return;
      const list = camp.pieces.filter((p) => sel.has(p.id));
      if (!list.length) { K.toast('حدد البوستات اللي عايز تجدولها الأول', 'error'); return; }
      const today = TODAY(), now = NOW();
      for (const p of list) { const s = camp.sched[p.id]; if (!s || !s.pl.length) { K.toast('اختار منصة واحدة على الأقل لـ ' + pieceLabel(p), 'error'); return; }
        const e = W.moveCheck(null, s.date, s.time, today, now); if (e) { K.toast(pieceLabel(p) + ': ' + (e.day || e.time), 'error'); return; } }
      if (!(await ensureCampaign())) return;
      camp.busy.pub = true;
      try {
        persist(0); // the suggested times shown are the campaign's too (schedule() flushes it first)
        let items = W.scheduleItems(camp.pieces, camp.sched, camp.w.idea, conn(), list.map((p) => p.id));
        const pub = items.filter((x) => x.how === 'publish').length;
        if (pub) { // decision 33: Instagram takes JPEG only — the copies are made here, in the browser
          K.toast('بيجهّز الصور للنشر…');
          const prep = await MK().preparePublish(camp.id, items);
          if (!prep.ok) { K.toast(prep.message, 'error'); return; }
          items = prep.items;
        }
        const r = await MK().schedule(camp.id, items, { keep: true });
        if (!r.ok) { K.toast(r.message, 'error'); return; }
        sel.clear();
        K.toast('اتجدول ' + list.length + ' عمل فني (' + items.length + ' بوست)' + (pub ? ' — ' + pub + ' هيتنشروا لوحدهم في مواعيدهم' : ' — نزّلهم وانشرهم في مواعيدهم، وعلّمهم «اتنشر» من سجل النشر'), 'success');
        // nothing left as a draft → the log (as before); else the step stays for the rest
        const left = camp.pieces.some((p) => W.pieceState(MK().posts ? MK().posts() : [], camp.id, p.id).status === 'مسودة');
        if (left) R(); else go('marketing-publog');
      } finally { camp.busy.pub = false; }
    };
    const P = can().publish;
    const bar = sp.length ? h('div', { class: 'bulk-bar', 'data-cw-bulk': String(sp.length) }, h('b', null, 'محدد ' + sp.length), h('span', { class: 'grow' }),
      P ? Button({ type: 'primary', size: 'sm', icon: 'calendar', label: 'جدولة المحدد', attrs: { 'data-cw-sched-sel': '' }, onClick: confirm }) : null,
      P && pausable(sp).length ? Button({ size: 'sm', icon: 'clock', label: 'وقف نشر المحدد', attrs: { 'data-cw-pause-sel': '' }, onClick: () => pauseMany(sp) }) : null,
      P && resumable(sp).length ? Button({ size: 'sm', icon: 'play', label: 'كمّل النشر', attrs: { 'data-cw-resume-sel': '' }, onClick: () => resumeMany(sp) }) : null,
      Button({ size: 'sm', icon: 'download', label: 'تحميل المحدد', attrs: { 'data-cw-dl-sel': '' }, onClick: () => downloadZip(sp.map(zipItem), W.campaignName(camp.w.idea)) }),
      Button({ size: 'sm', type: 'text', label: 'إلغاء التحديد', onClick: () => { sel.clear(); R(); } })) : null;
    return [conn5, bar,
      h('section', { class: 'card sec cw-pub' }, h('div', { class: 'sec-h' }, h('div', null, h('h2', { class: 't-h5' }, 'تفاصيل نشر الكامبين'), h('div', { class: 't-small sub' }, camp.pieces.length + ' عمل فني · حدد اللي عايز تجدوله واختار التاريخ والوقت والمنصات')), h('div', { class: 'acts' })),
        h('div', { class: 'sec-b' }, U.Table({ cls: 'dt', headers: [cbx('حدد الكل', !!all, (v) => { camp.pieces.forEach((p) => (v ? sel.add(p.id) : sel.delete(p.id))); R(); }), 'العمل الفني', 'الحالة', 'التاريخ', 'الوقت', 'المنصات', ''], rows }))),
      U.InlineNote({ children: 'حدد البوستات و«تأكيد النشر» بيجدول المحدد بس — اللي مش محدد بيفضل زي ما هو. فيسبوك وانستجرام بيتنشروا لوحدهم في ميعادهم لو الربط شغّال (الصور بتتجهز JPEG مع التأكيد)، والباقي بيتنزل كفولدر وتنشره بإيدك. «وقف نشر» بيسيب البوست في الخطة «متوقف» لحد «كمّل النشر».' }),
      P ? null : U.InlineNote({ kind: 'warning', children: 'تأكيد النشر محتاج صلاحية «التسويق — النشر».' }),
      Foot(4, 4, cback, sp.length ? 'تأكيد النشر (' + sp.length + ')' : 'تأكيد النشر', confirm, !P || !sp.length)];
  }

  // ---------- سجل النشر (decisions 15, 35–38): the system's posts and the platform's own, with their numbers ----------
  const srcTag = (x) => (x.src === 'platform' ? Tag('neutral', W.SRC_LABEL.platform) : Tag('brand', W.SRC_LABEL.system));
  const stTag = (x) => (x.busy && W.canMove(x) ? Tag('info', 'بيتنشر…') : Tag(x.status === 'اتنشر' ? 'success' : x.status === 'مجدول' ? 'gold' : x.status === 'متوقف' ? 'orange' : x.status === 'اتحذف' ? 'neutral' : 'error', x.status));
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
    if (x.src !== 'system' || !W.canMove(x) || x.status === 'متوقف' || x.busy) return false;
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
    const paused = x.status === 'متوقف';
    const noteText = paused && !moving ? 'النشر متوقف — البوست فاضل في الخطة ومش هيتنشر لحد «كمّل النشر».' : gone ? (x.wasLive ? 'اتحذف من ' + x.pl + ' يوم ' + D2(x.delAt || TODAY()) + ' — الأرقام دي آخر قراية قبل الحذف.' : 'اتشال من الجدول يوم ' + D2(x.delAt || TODAY()) + ' قبل ما يتنشر.')
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
    const flip = async (fn, ok) => { m.close(); const r = await fn(x.id); K.toast(r.ok ? ok : r.field === 'time' ? 'ميعاده فات — «أجّل» لميعاد جديد الأول، وبعدين كمّل النشر' : r.message, r.ok ? 'success' : 'error'); R(); };
    const pauseBtn = P && sys && W.canPause(x) ? Button({ icon: 'clock', label: 'وقف النشر', attrs: { 'data-post-pause': '' }, onClick: () => flip(MK().pause, 'اتوقف النشر — فاضل في الخطة «متوقف»') }) : null;
    const resumeBtn = P && sys && W.canResume(x) ? Button({ type: 'primary', icon: 'play', label: 'كمّل النشر', attrs: { 'data-post-resume': '' }, onClick: () => flip(MK().resume, 'رجع للجدول — هيتنشر في ميعاده') }) : null;
    const markBtn = wait && P && sys && !x.busy && !paused ? Button({ type: nowBtn ? 'text' : 'primary', icon: nowBtn ? undefined : 'check', label: 'علّمه اتنشر', attrs: { 'data-post-published': '' }, onClick: () => { m.close(); markPublished(x); } }) : null;
    const foot = moving ? [Button({ type: 'primary', icon: 'check', label: 'احفظ الميعاد', attrs: { 'data-post-move-save': '' }, onClick: async () => { const e = W.moveCheck(x, dr.day, dr.time, TODAY(), NOW()); if (e) { dr.err = e; drawDay(); drawTime(); return; } m.close(); if (await reschedule(x, dr.day, dr.time)) { R(); pubDetail(x); } } }),
        Button({ label: 'ارجع', attrs: { 'data-post-move-cancel': '' }, onClick: () => { m.close(); pubDetail(x); } })]
      : wait && P && sys && !x.busy ? [resumeBtn, nowBtn, markBtn, pauseBtn, Button({ icon: 'calendar', label: 'أجّل', attrs: { 'data-post-move': '' }, onClick: () => { m.close(); pubDetail(x, 'move'); } }), dl, close, del].filter(Boolean)
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
      U.KpiTile({ label: 'اتنشر', value: String(cnt('اتنشر')), unit: 'بوست', compare: 'off', note: cnt('مجدول') + ' مجدول · ' + cnt('فشل') + ' فشل' + (cnt('متوقف') ? ' · ' + cnt('متوقف') + ' متوقف' : '') + (cnt('اتحذف') ? ' · ' + cnt('اتحذف') + ' اتحذف' : '') }),
      U.KpiTile({ label: 'المشاهدات', value: K.n0(T.views), compare: 'off', note: 'كل المنصات' }),
      U.KpiTile({ label: 'التفاعل', value: K.n0(T.eng), compare: 'off', note: 'لايك + كومنت + شير + سيف' }),
      U.KpiTile({ label: 'نسبة التفاعل', value: W.pct(T.eng, T.views), compare: 'off', note: 'التفاعل ÷ المشاهدات' })),
      // decision 41: the link and the switch here too — no campaign needed to re-link the page or turn the publishing on
      connCard(null),
      h('div', { class: 'toolbar' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), sb), Button({ label: 'افتح الخطة الإعلانية', icon: 'calendar', onClick: () => go('marketing-calendar') })),
      Card('سجل النشر', 'كل اللي اترفع على السوشيال — من السيستم أو من المنصة مباشرة · المشاهدات والتفاعل بتتحدث من المنصة كل نص ساعة',
        list.length ? U.Table({ cls: 'dt pub-tbl', headers: ['العمل الفني', 'المنصة', 'اتنشر / هيتنشر', 'المصدر', 'الكامبين', 'الحالة', 'المشاهدات', 'التفاعل', 'نسبة التفاعل', ''], rows }) : K.Empty(all.length ? 'مفيش بوست بالاسم ده' : 'لسه مفيش بوستات', all.length ? 'جرّب كلمة تانية.' : 'جدول كامبين من «إنشاء» وهتلاقي بوستاتها هنا.'), null, null, { noun: ['بوست', 'البوستات'], count: [list.length, all.length] })];
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
    const item = (x) => h('button', { type: 'button', class: 'cal-it ' + (x.src === 'platform' ? 'platform' : 'system') + (x.status === 'فشل' ? ' fail' : x.status === 'مجدول' ? ' sched' : x.status === 'متوقف' ? ' paused' : x.status === 'اتحذف' ? ' del' : '') + (movable(x) ? ' mv' : ''), 'data-cal-it': String(x.id), 'data-cal-src': x.src, 'data-cal-move': movable(x) ? '' : null,
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
              const a = await window.IBAIAsk({ title: 'اشرح القالب بالـ AI', intro: 'شرح للستايل من الصورة — الـ AI بيستخدمه بعدين عشان يطلّع نفس الشكل.' }); if (!a) return;
              const r = await MK().write(null, { task: 'describe', kind: 'desc', image: { media_type: photo.media_type, data: photo.data }, notes: a.notes });
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
  // the v6 header (owner 11 Nov): the reports' period (the calendar picker since 12 Nov) compared with the period before it of the same
  // length — named «أمس» / «الأسبوع اللي فات» / «الشهر اللي فات» for today / this week / this month — and the ad platform (all / Meta / TikTok / Google)
  const PERIODS = [['today', 'اليوم · مقارنة بأمس', 'today', 'أمس'], ['week', 'الأسبوع ده · مقارنة باللي فات', 'thisWeek', 'نفس الأيام من الأسبوع اللي فات'], ['month', 'الشهر ده · مقارنة باللي فات', 'thisMonth', 'نفس الأيام من الشهر اللي فات']];
  const periodRange = (k, t) => (k === 'today' ? { from: t, to: t } : k === 'week' ? { from: W.wkStart(t), to: t } : { from: t.slice(0, 8) + '01', to: t });
  const periodOf = (rg) => { const t = TODAY(); const p = PERIODS.find(([k]) => { const r = periodRange(k, t); return r.from === rg.from && r.to === rg.to; }); return p ? p[0] : 'custom'; };
  const spanOf = (rg) => Math.round((Date.parse(rg.to + 'T00:00:00Z') - Date.parse(rg.from + 'T00:00:00Z')) / 864e5) + 1;
  // comments decision 14 (the owner 15 Nov): the member's own comparison period from the calendar (rg.cfrom / rg.cto) when he typed
  // one; else the same length right before
  const ownPrev = (rg) => (rg && /^\d{4}-\d{2}-\d{2}$/.test(rg.cfrom || '') && /^\d{4}-\d{2}-\d{2}$/.test(rg.cto || '') && rg.cfrom <= rg.cto ? { from: rg.cfrom, to: rg.cto } : null);
  const prevOf = (rg) => { const own = ownPrev(rg); if (own) return own; const n = spanOf(rg); return { from: W.addD(rg.from, -n), to: W.addD(rg.from, -1) }; };
  const COMPARE_MAX = 92; // a period up to 3 months is compared with the one before it (its days load with it)
  // the days to load: the period and its comparison period together, while the two span up to twice COMPARE_MAX (as before for the
  // period right before); a comparison period further away than that is not loaded — the cards then show no comparison
  const loadRange = (rg) => { const pv = prevOf(rg); if (!ownPrev(rg)) return spanOf(rg) <= COMPARE_MAX ? { from: pv.from, to: rg.to } : { from: rg.from, to: rg.to };
    const all = { from: pv.from < rg.from ? pv.from : rg.from, to: pv.to > rg.to ? pv.to : rg.to }; return spanOf(all) <= COMPARE_MAX * 2 ? all : { from: rg.from, to: rg.to }; };
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
    const pv = prevOf(rg); const lr = r0.rg || null; const prev = lr && lr.from <= pv.from && lr.to >= rg.to && lr.to >= pv.to ? show(W.adTotals(r.stats, r.orders, pv, moneyOk(), linked)) : null;
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
    // the period picker is in the header (one date filter for the page — the owner 12 Nov)
    return h('div', { class: 'toolbar ads-bar' }, U.FreshnessNote(syncLine(s)), h('span', { class: 'grow' }),
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
    // owner batch 2 decision 12: the ad accounts link from «الإعدادات › الربط بالمنصات» only — this card shows their state
    const acts = (k) => { if (!isAdmin() || !s || k == null) return null;
      return h('span', { class: 'acts-inline mk-acts' }, Button({ size: 'sm', type: 'text', label: 'الربط من الإعدادات', attrs: { 'data-ads-settings': k }, onClick: () => toSettings('ads') })); };
    return Card('حالة الربط', 'الإعلانات قراية بس — مفيش أي تغيير على المنصات من هنا · بيانات الربط بتتحفظ مشفّرة على السيرفر (Vault) ومابتظهرش تاني',
      [h('div', { class: 'mk-list', 'data-ads-conn': state }, rows.map(([k, t, sub, tone, ic]) => h('div', { class: 'mk-item', 'data-ads-platform': k || 'woo' }, h('span', { class: 'mk-ic tone-' + tone }, Icon(ic, 'sm')), h('span', { class: 'mk-txt' }, h('b', null, t), h('small', null, sub)), acts(k))))].concat(acct || []));
  }
  // the admin's popup of a platform: its fields (a stored secret shows its tail and stays unless typed over), «احفظ», the OAuth button, «فصل»
  const toSettings = (tab) => { const sp = window.IBPages.all().settings; if (sp && sp.api && sp.api.openIntegrations) sp.api.openIntegrations(tab); else location.hash = '#settings-integrations'; };
  // the admin's popup of a platform (opened from the settings — decision 12): onDone runs after a save or an unlink
  function linkPopup(k, onDone) {
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
      busy = false; m.close(); K.toast(r.platform.configured ? 'اتحفظ الربط — المزامنة الجاية هتسحب أرقام ' + AD_NAME[k] : 'اتحفظت البيانات — كمّل الربط عشان الأرقام تتسحب', 'success'); R(); if (onDone) onDone();
    };
    const cand = p && p.candidates && p.candidates.length ? U.InlineNote({ kind: 'warning', children: 'المنصة عرضت أكتر من حساب — اختار واحد:', action: h('span', { class: 'acts-inline' }, p.candidates.map((cnd) => Button({ size: 'sm', label: (cnd.name ? cnd.name + ' · ' : '') + cnd.id, attrs: { 'data-ads-pick': cnd.id }, onClick: async () => { const r = await MK().adsLinkPick(k, cnd.id); K.toast(r.ok ? 'اتربط حساب ' + cnd.id : r.message, r.ok ? 'success' : 'error'); if (r.ok) { m.close(); R(); } } }))) }) : null;
    const m = U.Modal({ title: 'ربط ' + AD_NAME[k] + ' إعلانات', body: [h('div', { class: 'stack', 'data-ads-link-form': k }, inputs)].concat(notes.map((t) => U.InlineNote({ children: t }))).concat(cand ? [cand] : []),
      footer: [Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'احفظ', attrs: { 'data-ads-save': k }, onClick: () => save(false) }), W.AD_OAUTH[k] ? Button({ type: 'brand', label: W.AD_OAUTH[k], attrs: { 'data-ads-oauth': k }, onClick: () => save(true) }) : null] });
  }
  function unlinkAsk(k, onDone) {
    K.confirm({ title: 'تفصل ' + AD_NAME[k] + '؟', text: 'بيانات الربط هتتمسح من السيرفر والأرقام القديمة هتفضل في السجل؛ تقدر تربط تاني في أي وقت.', okLabel: 'افصل', okType: 'danger',
      onOk: async () => { const r = await MK().adsUnlink(k); K.toast(r.ok ? 'اتفصلت ' + AD_NAME[k] : r.message, r.ok ? 'success' : 'error'); R(); if (onDone) onDone(); } });
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
    return Card('المنصة بتقول × ووكومرس', 'المشتريات اللي المنصة بتحسبها قصاد الأوردرات الحقيقية من نفس المصدر (UTM)', [
      U.Table({ cls: 'dt ads-vs', headers: ['المنصة', 'الصرف (ج.م)', 'مشتريات المنصة', 'أوردرات ووكومرس', 'الفرق', 'عائد المنصة', 'العائد الحقيقي', 'القرار المقترح'], rows,
        totalRow: ['الإجمالي', K.Num(n2(t.spend)), K.Num(K.n0(t.purchases)), K.Num(K.n0(t.orders)), '', K.Num(W.xr(t.roas)), K.Num(W.xr(t.mer)), ''] }),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الفرق = (أوردرات ووكومرس − مشتريات المنصة) ÷ مشتريات المنصة · العائد الحقيقي = مبيعات ووكومرس من المنصة ÷ صرفها · القرار المقترح = أهم اقتراح مستني موافقتك من الميديا باير على المنصة')], null, null, { when: perLabel(c.rg) });
  }
  function asstCards() {
    byLoad(false); const pend = byPending(); const r = BY.rules;
    const kinds = (L) => { const c = {}; L.forEach((x) => { c[x.kind] = (c[x.kind] || 0) + 1; }); return Object.entries(c).map(([k, n]) => K.n0(n) + ' ' + (SG_UI[k] || SG_UI.tracking)[2]).join(' · ') || 'مفيش حاجة مستنية'; };
    const reqRows = (kind) => { const L = (reqsOf(kind) || []).filter((q) => q.open); return L.length ? L.slice(0, 3).map((q) => [q.title, q.statusLabel + ' · ' + (q.by || '—') + (q.project ? ' · ' + q.project : ''), 'طلب', REQ_TONE[q.status] || 'neutral']) : [['مفيش طلبات مفتوحة', kind === 'designer' ? 'اطلب بوست أو فيديو' : 'اطلب صفحة أو تعديل', 'طلب', 'neutral']]; };
    const asst = (title, sub, items, label, onClick) => Card(title, sub, [h('div', { class: 'mk-list' }, items.map(([t, x, tag, tone]) => h('div', { class: 'mk-item' }, h('span', { class: 'mk-ic tone-' + tone }, Icon(tone === 'success' ? 'users' : 'clock', 'sm')), h('span', { class: 'mk-txt' }, h('b', null, t), h('small', null, U.num(x))), h('span', { class: 't-small help mk-tag' }, tag))))], Button({ type: 'text', size: 'sm', label, onClick }));
    return h('div', { class: 'grid3', 'data-ads-assistants': BY.sugg ? 'live' : 'loading' },
      asst('الميديا باير', 'تقرير يومي · اقتراحات بموافقتك · حدود صرف', [[K.n0(pend.length) + ' اقتراح مستني موافقتك', kinds(pend), 'اقتراحات', pend.length ? 'orange' : 'success'], ['حد الصرف اليومي: ' + (r ? K.n0(r.dailyCap) + ' ج.م' : '…'), 'أي زيادة فوقه بتترفض', 'قاعدة', 'success'],
        ['التنفيذ على ميتا: ' + (r ? (r.live ? 'شغّال' : 'متوقف') : '…'), r && r.live ? 'الموافقة بتتنفّذ فورًا' : 'الموافقة بتتسجل من غير تغيير', 'مفتاح', r && r.live ? 'success' : 'neutral']], 'افتح الميديا باير', () => goAi('buyer')),
      asst('الديزاينر', 'بوستات وفيديوهات بالبراند · Magnific', reqRows('designer'), canAsk() ? 'تقديم طلب للديزاينر' : 'افتح الديزاينر', () => { if (canAsk()) reqForm('designer'); else goAi('designer'); }),
      asst('المبرمج', 'صفحات الموقع وتطوير مشاريع إبتكر · Staging الأول', reqRows('dev'), canAsk() ? 'تقديم طلب للمبرمج' : 'افتح المبرمج', () => { if (canAsk()) reqForm('dev'); else goAi('dev'); }));
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
    return Card('الحملات', 'أرقام المنصات جنب أوردرات ووكومرس الحقيقية من نفس الحملة (utm_campaign)', [
      list.length ? U.Table({ cls: 'dt ads-camps', headers: CAMP_H, rows, totalRow: ['الإجمالي', '', '', K.Num(n2(tot.spend)), K.Num(K.n0(tot.purchases)), K.Num(K.n0(tot.orders)), K.Num(W.xr(tot.spend ? tot.sales / tot.spend : null)), K.Num(tot.orders ? K.n0(tot.spend / tot.orders) : '—'), ''] })
        : K.Empty(c.camps.length ? 'مفيش حملات بالفلاتر دي' : 'مفيش حملات في الفترة دي', c.camps.length ? 'غيّر الفلاتر أو امسحها.' : 'مفيش صرف ولا أوردرات من حملات الإعلانات ' + perLabel(c.rg) + ' — غيّر الفترة من فوق.'),
      h('p', { class: 't-small help', style: 'margin:0' }, 'الضغط على حملة بيفتح أيامها (الصرف · مشتريات المنصة · الأوردرات الحقيقية) · القرار المقترح من الميديا باير (بيتجدد مع كل مزامنة) ومحتاج موافقة الأدمن — التنفيذ على ميتا بس' + (c.loose ? ' · ' + K.n0(c.loose) + ' أوردر من إعلانات من غير رقم حملة في الـ UTM (محسوبين في «نظرة عامة» بس)' : ''))], null, null, { when: perLabel(c.rg), noun: ['حملة', 'الحملات'] });
  }
  function crDetail(x, c) {
    const fq = x.frequency == null ? '—' : x.frequency.toFixed(2);
    U.DetailsModal({ title: x.name, sub: 'حملة ' + x.campaign + ' · ' + perLabel(c.rg), summary: [{ label: 'الصرف', value: n2(x.spend) }, { label: 'الظهور', value: K.n0(x.impressions) }, { label: 'النقرات (CTR)', value: x.ctr == null ? '—' : (x.ctr * 100).toFixed(2) + '%' }, { label: 'عائد ميتا', value: W.xr(x.roas) }],
      headers: ['المقياس', 'القيمة'], rows: [['النقرات على اللينك', K.n0(x.clicks)], ['التكرار', fq], ['مشتريات ميتا', K.n0(x.purchases)], ['قيمة مشتريات ميتا (ج.م)', n2(x.value)], ['الحالة', x.tired ? 'الناس زهقت منه' : stOf(x.status, true)[0]]],
      note: x.tired ? 'التكرار ' + fq + ' — الناس شافوا الإعلان ده كتير؛ جرّب نسخة جديدة من «إنشاء».' : null, source: 'Meta Ads (رقم الإعلان ' + x.id + ')' });
  }
  const crTip = () => U.InlineNote({ children: 'العائد الحقيقي لكل إعلان (من ووكومرس) محتاج utm_content={{ad.id}} في لينكات الإعلانات على ميتا — لحد كده العائد هنا بتاع ميتا، والعائد الحقيقي في «الحملات».' }); // inside the card: a loose note floats to the top of the reports page
  // the v6 prototype's «اعمل نسخ زيه» (a new campaign on the same idea) / «اطلب نسخة جديدة» (a request to the designer — the tired ones)
  function likeIt(idea) { if (!can().create) return; Object.assign(camp, blankCamp()); camp.w.idea = String(idea || '').slice(0, 500); go('marketing-campaign-1'); }
  const crActs = (name, tired) => (can().create ? [{ label: 'اعمل نسخ زيه', icon: 'sparkle', run: () => likeIt(name) }, tired && canAsk() ? { label: 'اطلب نسخة جديدة', icon: 'plus', run: () => reqForm('designer', { title: 'نسخة جديدة من «' + name + '»', details: 'الناس شافوا الإعلان كتير — نفس الفكرة بشكل جديد' }) } : null].filter(Boolean) : []);
  function crTable(c) {
    const L = c.creatives; const tot = L.reduce((a, x) => ({ spend: a.spend + x.spend, imp: a.imp + x.impressions, clicks: a.clicks + x.clicks, purchases: a.purchases + x.purchases }), { spend: 0, imp: 0, clicks: 0, purchases: 0 });
    const th = (x) => h('span', { class: 'cr-th' }, x.thumb ? h('span', { class: 'thumb fill' }, h('img', { src: x.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : Img(null, 'fill'));
    const rows = L.map((x) => { const [sl, tone] = x.tired ? ['الناس زهقت منه', 'orange'] : stOf(x.status, true);
      return [h('button', { type: 'button', class: 'cr-cell link-btn', 'data-ads-ad': x.id, 'aria-label': 'تفاصيل ' + x.name, onClick: () => crDetail(x, c) }, th(x), h('span', { class: 'cr-tx' }, h('b', null, x.name), h('small', { class: 'help' }, x.campaign))),
        Tag(tone, sl), K.Num(n2(x.spend)), K.Num(K.n0(x.impressions)), K.Num(x.ctr == null ? '—' : (x.ctr * 100).toFixed(2) + '%'), K.Num(x.frequency == null ? '—' : x.frequency.toFixed(2)), K.Num(K.n0(x.purchases)), K.Num(W.xr(x.roas)),
        K.RowMenu([{ label: 'التفاصيل', icon: 'eye', run: () => crDetail(x, c) }].concat(crActs(x.name, x.tired)))]; });
    return Card('تفاصيل الأعمال الفنية', '',
      [crTip(), L.length ? U.Table({ cls: 'dt cr-tbl ads-cr', headers: ['الإعلان', 'الحالة', 'الصرف (ج.م)', 'الظهور', 'النقرات (CTR)', 'التكرار', 'مشتريات ميتا', 'عائد ميتا', ''], rows }) : K.Empty('مفيش إعلانات فيها صرف في الفترة دي', 'غيّر الفترة من فوق.')], null, null, { when: perLabel(c.rg), noun: ['إعلان', 'الإعلانات'], total: K.n0(tot.imp) + ' ظهور · ' + n2(tot.spend) + ' ج.م صرف' });
  }
  function overviewTab() {
    const rg = adRange(); const s = adsState(null); adsLoad(loadRange(rg), redrawAds);
    const gate = adsGate(loadRange(rg), redrawAds); if (gate) return [adsBar(s, redrawAds)].concat(gate);
    const c = adCalc(AD.r, rg, s);
    return [adsBar(s, redrawAds), adsNote(s), adKpis(c), h('div', { class: 'mk-ov-row', 'data-mk-ov-row': '' }, suggCard(), adsConnCard(s, c)), h('div', { class: 'charts', 'data-rgroup': 'charts' }, merChart(c), spendChart(c)), vsCard(c), asstCards(), adsSource()].filter(Boolean);
  }
  // comments 15 Nov decision 74 (the owner — «ناخد تقارير بتاعت الحملات الاعلانية بالظبط نحطها بدل التقارير اللي في التسويق»): the tab is the
  // reports page's «الحملات الإعلانية» itself — one function draws both: the cards, the two charts, «المنصة بتقول × ووكومرس», the
  // campaigns, the creatives and the sources. Here the page's own sync line stays over it and the header's platform narrows it
  // («الكل» = the reports page's numbers). The two sub-tabs, the status / decision dropdowns over the campaigns (the table's own
  // «فلتر» has both columns) and the published posts' table (their numbers are in «سجل النشر») left with the old tab.
  function adReport(redraw, plat) {
    const rg = adRange(); const s = adsState(redraw); adsLoad(loadRange(rg), redraw);
    const gate = adsGate(loadRange(rg), redraw); if (gate) return { blocks: gate, exp: null };
    const c = adCalc(AD.r, rg, s, plat);
    const exp = { label: 'الحملات الإعلانية', headers: ['الحملة', 'رقم الحملة', 'المنصة', 'الحالة', 'الصرف', 'مشتريات ميتا', 'أوردرات ووكومرس', 'مبيعات ووكومرس', 'العائد الحقيقي', 'تكلفة الأوردر'],
      rows: c.camps.map((x) => [x.name, x.id, x.platform, stOf(x.status)[0], x.spend, x.purchases, x.orders, Math.round(x.sales * 100) / 100, x.mer == null ? '' : Math.round(x.mer * 100) / 100, x.cpa == null ? '' : Math.round(x.cpa)]) };
    return { exp, blocks: [adsNote(s), adKpis(c), h('div', { class: 'charts', 'data-rgroup': 'charts' }, merChart(c), spendChart(c)), vsCard(c), campTable(c, c.camps), crTable(c), adsSource()].filter(Boolean) };
  }
  function reportsTab() { return [adsBar(adsState(null), redrawAds)].concat(adReport(redrawAds, M.plat).blocks); }
  // the reports page's «الحملات الإعلانية» (decision 47): the same numbers and blocks, its redraw; CSV = the campaigns
  function reportBlocks(redraw) {
    if (!MK() || !can().view) return { blocks: [K.Empty('مش مسموحلك تشوف التسويق', 'اطلب صلاحية «التسويق» من الأدمن.')], exp: null };
    return adReport(redraw, 'all'); // the reports page has no platform filter
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
      if (here() && (st.view === 'hub' || window.IBPages.current === 'ai') && !document.querySelector('.scrim')) R();
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
    // the admin's written rules (the v6 prototype's «+ قاعدة جديدة»): guidance the buyer's chat reads — nothing runs from them
    const notes = (r.notes || []).map((n, i) => h(isAdmin() ? 'button' : 'div', Object.assign({ class: 'mk-item', 'data-mk-note': String(i) }, isAdmin() ? { type: 'button', onClick: () => editNote(i) } : {}),
      h('span', { class: 'mk-ic tone-gold' }, Icon('file', 'sm')), h('span', { class: 'mk-txt' }, h('b', null, n.title), h('small', null, U.num(n.details))), h('span', { class: 't-small help mk-tag' }, n.kind)));
    return Card('القواعد والحدود', 'الميديا باير مايعملش حاجة لوحده برّه القواعد دي' + (isAdmin() ? ' · اضغط على قاعدة تعدّلها' : ''), [h('div', { class: 'mk-list' }, items.concat(notes)),
      notes.length ? h('p', { class: 't-small help', style: 'margin:0' }, 'القواعد المكتوبة بيقراها الميديا باير في الشات ويمشي عليها في نصايحه — مابتنفّذش حاجة لوحدها.') : null,
      isAdmin() && (r.notes || []).length < 20 ? Button({ type: 'text', size: 'sm', label: '+ قاعدة جديدة', attrs: { 'data-mk-note-add': '' }, onClick: () => editNote(-1) }) : null, sw]);
  }
  function editNote(i) {
    const L = (BY.rules && BY.rules.notes) || []; const cur = L[i] || { title: '', details: '', kind: 'قاعدة' };
    const save = (next, msg) => MK().rulesSet({ notes: next }).then((x) => { K.toast(x.ok ? msg : x.message, x.ok ? 'success' : 'error'); if (x.ok) BY.rules = x.rules; R(); });
    K.form({ title: i < 0 ? 'قاعدة جديدة' : 'تعديل: ' + cur.title, values: { t: cur.title, s: cur.details, k: cur.kind }, submitLabel: 'احفظ القاعدة',
      fields: (f, e, set) => [K.field.text('t', 'القاعدة', f, e, set, { required: true, placeholder: 'مثال: إعلان نقراته قليلة' }), K.field.area('s', 'التفاصيل', f, e, set, { required: true, placeholder: 'مثال: إعلان CTR أقل من 0.8% ← بلّغني' }), K.field.select('k', 'النوع', ['حد', 'هدف', 'قاعدة', 'تقرير'], f, e, set)],
      validate: (f) => { const e = K.req(f, ['t', 's']); if (!e.t && f.t.trim().length > 80) e.t = 'لحد 80 حرف'; if (!e.s && f.s.trim().length > 300) e.s = 'لحد 300 حرف'; if (/[<>]/.test(f.t + f.s)) e.s = 'من غير < أو >'; return e; },
      submit: (f) => { const n = { title: f.t.trim(), details: f.s.trim(), kind: f.k }; const next = L.slice(); if (i < 0) next.push(n); else next[i] = n; save(next, 'اتحفظت القاعدة'); },
      extraFooter: i < 0 ? null : (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'text', label: 'امسح القاعدة', attrs: { 'data-mk-note-del': '' }, onClick: () => { m.close(); save(L.filter((_, j) => j !== i), 'اتمسحت القاعدة'); } })) });
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
  // ---------- 0084 (the owner 12 Nov — «سايد بار فيه history chats… شبه الـ interface بتاعة Claude… زرار الإعدادات… وزرار يكبّر الشات للصفحة
  // كلها»): each assistant's chats, the member's own — the history on the side (new, rename, delete), the turns from the server, the
  // quick suggestions inside the chat, ⚙️ the admin's settings, «تقديم طلب» and the expand button (the same icon shrinks it back);
  // nothing runs from a chat — the designer's picture is made only by «ولّد الصورة» under its answer (the image credits) ----------
  const AG = { chats: {}, active: {}, turns: {}, prompts: {}, reqs: {}, drafts: {}, acts: {}, decs: {}, asks: {}, hand: {}, forms: {}, draft: {}, asking: false, gen: null, full: false, side: false, loading: {}, cfgAsked: false, seen: {}, atBottom: {}, pos: {}, files: {}, queue: {}, reading: 0, mic: null, plans: {}, turnFiles: {} };
  const AG_INTRO = {
    buyer: 'أنا الميديا باير. بقرا أرقام ميتا بتاعة آخر 7 أيام جنب أوردرات ووكومرس الحقيقية وبقترح — والتنفيذ بموافقتك من «مستني موافقتك». اسألني عن حملة أو العائد أو تكلفة الأوردر.',
    designer: 'أنا الديزاينر. بساعدك في أفكار البوستات والكاروسيل والستوري والريلز بالبراند، ولما تطلب صورة بكتبلك وصفها وتقدر تولّدها بزرار «ولّد الصورة» (من كريدت الصور). الشغل الكبير بيروح للديزاينر البشري من «تقديم طلب».',
    dev: 'أنا المبرمج. بساعدك تخطط لصفحة على الموقع أو تعديل في السيستم وأكتبلك المطلوب بالظبط — والتنفيذ بيروح للمبرمج البشري من «تقديم طلب»، ومفيش حاجة بتوصل للموقع اللايف من غير موافقتك.' };
  const AG_SUGG = { buyer: ['حلل آخر 7 أيام', 'إيه أحسن حملة؟', 'قارن ميتا بووكومرس', 'اعمل حملة لمنتج'], designer: ['فكرة بوست لمنتج جديد', 'كاروسيل لعروض الشتا', 'ستوري لخصم', 'اعمل صورة لبوست'],
    dev: ['صفحة هبوط لعرض', 'تعديل في صفحة المنتج', 'اكتب مواصفات طلب', 'إيه أسرع طريقة؟'] };
  // 0120: the five new built-ins' words; a custom one speaks from its «about»
  Object.assign(AG_INTRO, {
    stock: 'أنا المخزن الذكي. بشوف القطع اللي في المخزن والتجميع والمرتجعات اللي مستنية فحص — اسألني إيه اللي مستني وإيه الأقدم.',
    cs: 'أنا خدمة العملاء الذكية. بشوف العملاء وأوردراتهم والطلبات المفتوحة، وبكتبلك الرد على العميل بأسلوبنا.',
    makers: 'أنا خدمة المبتكرين الذكية. بشوف المبتكرين وأوردراتهم والمتأخر منها، وبكتبلك رسالة المتابعة للمبتكر.',
    accountant: 'أنا المحاسب الذكي. بقرا المصروفات والمبيعات وحصة إبتكر بأرقامك الحقيقية — ومابسجّلش ولا بحرّك فلوس.',
    hr: 'أنا الموارد البشرية الذكية. بشوف الحضور والطلبات والمهام — من غير المرتبات — وبقولك إيه المستني قرار.' });
  Object.assign(AG_SUGG, { stock: ['إيه اللي مستني في المخزن؟', 'المرتجعات اللي مستنية فحص', 'أقدم القطع', 'التجميعات المفتوحة'],
    cs: ['مين العملاء الزعلانين؟', 'اكتب رد لعميل اتأخر أوردره', 'الأوردرات غير المؤكدة', 'الطلبات المفتوحة'],
    makers: ['مين المتأخر؟', 'اكتب رسالة متابعة لمبتكر', 'المبتكرين الجداد', 'طلبات المبتكرين المفتوحة'],
    accountant: ['مصروفات الشهر', 'أكبر مصروف', 'المبيعات وحصة إبتكر', 'قارن بالشهر اللي فات'],
    hr: ['مين ناقصه ساعات؟', 'الطلبات المستنية قرار', 'الحضور الأسبوع ده', 'المهام المفتوحة'] });
  const AG_DEF_ICON = { buyer: 'chart', designer: 'image', dev: 'code', stock: 'tag', cs: 'headset', makers: 'users', accountant: 'wallet', hr: 'briefcase' };
  const agReg = (a) => (MK() && MK().agentOf ? MK().agentOf(a) : null);
  const agName = (a) => { const r = agReg(a); return (r && r.name) || ({ buyer: 'الميديا باير الذكي', designer: 'الديزاينر الذكي', dev: 'المبرمج الذكي' })[a] || a; };
  const agIcon = (a) => { const r = agReg(a); return (r && r.icon) || AG_DEF_ICON[a] || 'sparkle'; };
  const agIntro = (a) => AG_INTRO[a] || ('أنا ' + agName(a) + '.' + ((agReg(a) || {}).about ? ' ' + agReg(a).about : ''));
  const agSugg = (a) => AG_SUGG[a] || [];
  const AG_SUB = { buyer: 'بيقرا أرقام ميتا + أوردرات ووكومرس · بيقترح وانت توافق — مابينفّذش حاجة من الشات', designer: 'أفكار وتصميمات بالبراند · بيولّد صورة لما تطلب — بكريدت الصور', dev: 'صفحات الموقع وتطوير السيستم · بيكتب المواصفات — والتنفيذ من «تقديم طلب»' };
  const agCfg = (a) => { const x = MK() && MK().agentSettingsNow && MK().agentSettingsNow(); return (x && x[a]) || null; };
  const agTime = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d); const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); return day === TODAY() ? t : D2(day) + ' · ' + t; };
  const quietSel = (x, n) => { try { x.setSelectionRange(n, n); } catch (e) { /* not a text box */ } };
  const agRefresh = () => { if (here() && !document.querySelector('.scrim')) R(); };
  function agLoad(a, force) {
    if (!MK() || !MK().agentChats || AG.loading[a] || (!force && AG.chats[a])) return;
    AG.loading[a] = true;
    MK().agentChats(a).then((r) => { AG.loading[a] = false; AG.chats[a] = r.ok ? r.items : (AG.chats[a] || []); if (!r.ok) K.toast(r.message, 'error'); agRefresh(); });
    if (!AG.cfgAsked && MK().agentSettings) { AG.cfgAsked = true; MK().agentSettings(false).then(() => agRefresh()); }
  }
  // agents-brain T3: «افتح البوب أب» / «افتح الصفحة» under an answer — the header assistant's own handlers (block 28, window.IBAiAction):
  // the system's popup opens filled and its own button is the confirmation
  const FORM_LABEL = { vendor_add: 'إضافة مبتكر', member_add: 'إضافة عضو', customer_add: 'عميل جديد', ticket_new: 'طلب جديد', hr_leave: 'طلب إجازة', hr_advance: 'طلب سلفة', hr_remote: 'شغل عن بُعد', task_add: 'طلب جديد',
    order_update: 'تحديث الأوردر', expense_add: 'مصروف', account_move: 'حركة على الحساب', vendor_move: 'حركة مبتكر',
    salary_adjust: 'مكافأة / خصم', salary_pay: 'تحويل المرتب', vendor_settle: 'تسوية المبتكر' }; // agents-brain T4
  const PAGE_LABEL = { dashboard: 'اللوحة', orders: 'الأوردرات', vendors: 'المبتكرين', accounts: 'الحسابات', inventory: 'المخزون', products: 'المنتجات', cs: 'خدمة العملاء', autoreply: 'الرد الآلي', tickets: 'طلبات الفريق', reports: 'التقارير', marketing: 'التسويق', hr: 'الموارد البشرية', settings: 'الإعدادات' };
  const runAct = (name, input) => { try { if (typeof window.IBAiAction !== 'function') throw new Error('مش جاهز'); window.IBAiAction(name, input); } catch (e) { K.toast((name === 'open_form' ? 'ما قدرتش أفتح البوب أب: ' : 'ما قدرتش أفتح الصفحة: ') + (e && e.message ? e.message : ''), 'error'); } };
  function formLinks(id) {
    const x = AG.forms[id];
    return h('div', { class: 'mk-msg-req mk-forms', 'data-mk-forms': String(id) },
      x.forms.map((f, i) => Button({ size: 'sm', type: 'primary', icon: 'edit', label: 'افتح البوب أب — ' + (FORM_LABEL[f.form] || f.form), attrs: { 'data-mk-form': f.form, 'data-mk-form-i': String(i) }, onClick: () => runAct('open_form', f) })),
      x.page ? Button({ size: 'sm', icon: 'chevL', label: 'افتح ' + (PAGE_LABEL[x.page.page] || x.page.page), attrs: { 'data-mk-page': x.page.page }, onClick: () => runAct('navigate', x.page.tab ? x.page : { page: x.page.page }) }) : null);
  }
  function agOpen(a, id) {
    AG.active[a] = id || null; AG.side = false; // decision 72: the phone's drawer closes on a pick
    if (id && !AG.turns[id] && !AG.loading['t' + id]) {
      AG.loading['t' + id] = true;
      MK().agentTurns(id).then((r) => { AG.loading['t' + id] = false; AG.turns[id] = r.ok ? r.items : []; if (!r.ok) K.toast(r.message, 'error'); agRefresh(); });
    }
    R();
  }
  // ش45 decision 3: the header's assistant hands a question to one of the three — open its tab on a new chat with the question written in
  // the box; the member presses «ابعت» (security review: a turn the model was led to by data it read never spends or writes on its own)
  function askAgent(a, q) {
    const list = (MK() && MK().agentsNow && MK().agentsNow()) || null;
    if (list ? !list.some((x) => x.id === a && !x.archived) : !(['buyer', 'designer', 'dev'].includes(a) && can().view)) return false;
    BY.aiTab = a; AG.active[a] = null; AG.draft[a] = String(q || '').slice(0, 1000); goAi(a);
    setTimeout(() => { const el = document.getElementById('mk-ask'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 80);
    return true;
  }
  // ش45 decision 4: the designer's (or the header's) filled campaign — «كامبين جديدة» on its details, nothing saved or generated
  // the owner 17 Nov («حط جمب زر صفحته — اعمل زيه و توديني علي صفحة انشاء محتوي و يملالي الداتا كلها بناءا علي الفيديو و يبقي ك مرجع»):
  // «اعمل زيه» on a trend (its video or post) and on a competitor — «كامبين جديدة» opens filled (the idea from it, a reel for a video and a
  // post for a picture) with its link under «فايلز أو لينكات أمثلة للمطابقة» (the server takes its picture — ai-images ref_link) and in
  // the notes; nothing generated — the build step writes the pieces as usual
  async function copyFrom(src) {
    if (!can().create || !src) return false;
    const video = src.kind === 'video';
    const title = String(src.title || src.name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const about = String(src.summary || src.note || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const idea = (src.from === 'competitor' ? 'محتوى بنفس روح إعلانات «' + title + '»' : 'محتوى زي «' + title + '»' + (src.platform && TR_PF[src.platform] && TR_PF[src.platform][0] ? ' على ' + TR_PF[src.platform][0] : ''))
      + (about ? ' — ' + about : '') + ' — بمنتجات إبتكر وبأسلوبنا، مش نسخة';
    const w = W.draftOf ? W.draftOf({ goal: 'منتج جديد', idea, post: video ? 0 : 1, carousel: 0, video: video ? 1 : 0, dur: 15 }) : null; if (!w) return false;
    const tab = video ? 'video' : 'post'; const link = /^https:\/\//.test(String(src.url || '')) ? String(src.url) : '';
    if (link) w.media[tab].notes = 'المرجع: ' + link;
    Object.assign(camp, blankCamp()); camp.w = w;
    go('marketing-campaign-1');
    if (!link) return true;
    // the reference: its picture fetched into the campaign's folder (a draft campaign is saved for it); a page that gives none stays a note
    const mine = camp; if (!(await ensureCampaign())) return true;
    const r = await MK().refLink(mine.id, link);
    if (camp !== mine || !camp.w || camp.w !== w) return true;
    if (r.ok) { w.media[tab].ref.push({ t: 'file', name: r.name, path: r.path }); persist(); R(); K.toast('اتفتحت الكامبين متملّية — والمرجع اتحط في «أمثلة للمطابقة»', 'success'); }
    else K.toast('اتفتحت الكامبين متملّية — ماقدرناش ناخد صورة المرجع (اللينك في الملاحظات)', 'info');
    return true;
  }
  function openDraft(d) {
    if (!can().create) return false;
    const w = W.draftOf ? W.draftOf(d) : null; if (!w) return false;
    Object.assign(camp, blankCamp()); camp.w = w;
    go('marketing-campaign-1');
    return true;
  }
  // ش45 decision 5 — the buyer's «اقفل / افتح الحملة» under its answer: a confirm card; «أيوه» runs it on Meta (mkt-ads campaign_set — the
  // admin or marketing.publish, the execution switch on), «لأ» drops it. Nothing runs from the chat itself.
  const campName = (cid) => { const d = MK().adsDataNow ? MK().adsDataNow() : null; const o = d && Array.isArray(d.objects) ? d.objects.find((x) => x.kind === 'campaign' && String(x.id) === cid) : null; return o && o.name ? o.name : '#' + cid; };
  // the owner 18 Nov («عايز المساعدين … يجيبولي الاختيارات جوا الشات يعني اوافق او ارفض»): a suggestion the buyer proposes to decide —
  // its title from the open list, «موافق» / «رفض» right here (mkt-ads decide — the admin); with the execution switch off the decision is
  // written and nothing runs on Meta (the card says so, and the admin can switch it on from here after a confirm)
  const liveOn = () => { const R0 = MK().rulesNow && MK().rulesNow(); return !!(R0 && R0.live); };
  function liveRow() {
    if (liveOn()) return null;
    return h('div', { class: 'mk-live-off', 'data-mk-live-off': '' }, h('small', { class: 'help' }, 'مفتاح التنفيذ مقفول: الموافقة بتتسجّل ومفيش حاجة بتتغيّر على ميتا.'),
      isAdmin() ? Button({ size: 'sm', type: 'text', label: 'شغّل التنفيذ', attrs: { 'data-mk-live-on': '' }, onClick: () => K.confirm({ title: 'تشغّل التنفيذ على ميتا؟', text: 'من دلوقتي أي «موافق» على قرار أو حملة هيتنفّذ على حساب الإعلانات فعلًا — في حدود الميزانية اليومية والقواعد.', okLabel: 'شغّل', onOk: async () => { const r = await MK().setLive(true); K.toast(r.ok ? 'التنفيذ اشتغل' : r.message, r.ok ? 'success' : 'error'); R(); } }) }) : null);
  }
  function decCard(tid, x) {
    if (x.done) return h('div', { class: 'mk-msg-req', 'data-mk-dec-done': x.done }, h('small', { class: 'help' }, x.doneText || ''));
    // the list is dropped after any decision (decide → sugg = null): reload it once (at most every 5 s) instead of calling the rest «gone»
    const L = (MK().suggNow && MK().suggNow()) || [];
    if (!L.length && MK().suggestions && !AG.suggBusy && Date.now() - (AG.suggAt || 0) > 5000) {
      AG.suggBusy = true; AG.suggAt = Date.now(); MK().suggestions(true).catch(() => {}).then(() => { AG.suggBusy = false; R(); });
    }
    const known = L.length > 0 || (!!AG.suggAt && !AG.suggBusy);
    const sg = L.find((s) => Number(s.id) === Number(x.id) && (!s.status || s.status === 'pending'));
    if (known && !sg) return h('div', { class: 'mk-msg-req', 'data-mk-dec-gone': x.id }, h('small', { class: 'help' }, 'الاقتراح #' + x.id + ' مابقاش مستني — اتقرر أو خلص.'));
    const key = tid + ':' + x.id; const busy = AG.acting === key;
    const run = async (decision) => { AG.acting = key; R(); const r = await MK().decide(x.id, decision); AG.acting = null;
      if (!r.ok) { K.toast(r.message, 'error'); R(); return; }
      x.done = decision; x.doneText = decision === 'reject' ? 'اترفض — مفيش حاجة اتغيّرت' : (r.message || (liveOn() ? 'اتوافق واتنفّذ' : 'اتوافق — اتسجّل (التنفيذ مقفول)')); K.toast(x.doneText, 'success'); R(); };
    return h('div', { class: 'mk-msg-req mk-camp-act', 'data-mk-dec': x.id },
      h('small', null, h('b', null, sg ? sg.title : 'اقتراح #' + x.id), sg && sg.sub ? ' — ' + sg.sub : '', ' · المساعد بيقترح: ', h('b', null, x.decision === 'reject' ? 'ترفضه' : 'توافق عليه')),
      isAdmin() ? [Button({ size: 'sm', type: 'primary', icon: 'check', label: busy ? 'بيتنفّذ…' : 'موافق', disabled: !!AG.acting, attrs: { 'data-mk-dec-yes': '' }, onClick: () => run('approve') }),
        Button({ size: 'sm', type: 'text', label: 'رفض', disabled: !!AG.acting, attrs: { 'data-mk-dec-no': '' }, onClick: () => run('reject') }), liveRow()]
        : h('small', { class: 'help' }, 'القرار للأدمن بس'));
  }
  function actCard(tid, x) {
    const pause = x.action === 'pause'; const nm = campName(x.campaignId);
    if (x.done) return h('div', { class: 'mk-msg-req', 'data-mk-camp-done': x.done }, h('small', { class: 'help' }, x.doneText || ''));
    const may = isAdmin() || can().publish;
    return h('div', { class: 'mk-msg-req mk-camp-act', 'data-mk-camp-act': x.action + ':' + x.campaignId },
      h('small', null, h('b', null, (pause ? 'اقفل' : 'افتح') + ' الحملة «' + nm + '» على ميتا؟'), ' — مفيش حاجة هتتغيّر غير لما تأكد.'),
      may ? [Button({ size: 'sm', type: pause ? 'danger' : 'primary', icon: pause ? 'x' : 'play', label: AG.acting === tid ? 'بيتنفّذ…' : 'موافق', disabled: !!AG.acting, attrs: { 'data-mk-camp-yes': '' },
          onClick: async () => { AG.acting = tid; R(); const r = await MK().campaignSet(x.campaignId, !pause); AG.acting = null;
            if (!r.ok) { K.toast(r.message, 'error'); R(); return; }
            x.done = r.same ? 'same' : 'ok'; x.doneText = r.message; K.toast(r.message, 'success'); R(); } }),
        Button({ size: 'sm', type: 'text', label: 'رفض', attrs: { 'data-mk-camp-no': '' }, onClick: () => { x.done = 'no'; x.doneText = 'اترفض — الحملة زي ما هي'; R(); } }), liveRow()]
        : h('small', { class: 'help' }, 'التنفيذ محتاج «التسويق: نشر» أو الأدمن'));
  }
  // the owner 17 Nov — the warehouse assistant's plan (product-plan.js on the server found the names): a popup with each step, its count and
  // examples; «نفّذ» runs that step alone through the page's adapters (the products page's writes and their permissions) — «دايما سالني
  // علي موافقة قبل اي خطوة»
  const PLAN_ICON = { category_create: 'plus', category_add: 'tag', category_set: 'tag', category_remove: 'tag', move_maker: 'users', brand_add: 'star', status: 'eye', trash: 'trash', studio: 'image' };
  async function planRun(plan, i) {
    const s = plan.steps[i]; const P = window.IBProducts; const ST = window.IBStudio; const V = window.IBVendors && window.IBVendors.store;
    const made = plan.made || (plan.made = {});
    const catId = (c) => (!c ? null : c.id ? c.id : made[c.name] || null);
    if (P && P.ensure) P.ensure();
    if (s.op === 'category_create') {
      if (!ST || !ST.createCategory) return { ok: false, message: 'الأقسام مش متاحة' };
      const r = await ST.createCategory({ name_en: s.newEn, name_ar: s.newAr || null, parent: catId(s.parent) || 0 });
      if (!r.ok) return { ok: false, message: r.reason === 'forbidden' ? 'إضافة الأقسام محتاجة «إضافة منتجات»' : 'الموقع رفض القسم (' + (r.reason || 'error') + ')' };
      made[s.newEn] = r.id; return { ok: true, message: 'اتعمل القسم #' + r.id };
    }
    if (s.op === 'brand_add') { if (!V || !V.addBrand || !s.maker) return { ok: false, message: 'المبتكرين مش متاحين' }; try { await V.addBrand(s.maker.id, { name: s.brand }, V.actor()); return { ok: true, message: 'اتضاف البراند' }; } catch (e) { return { ok: false, message: e && e.message ? e.message : 'ماتضافش' }; } }
    // the owner 18 Nov: the case and the type picked in the chat — the studio starts the batch by itself with the chat's files in their places
    if (s.op === 'studio') { const FV = window.IBFlowView; if (!FV || !FV.startWith) return { ok: false, message: 'الاستوديو مش متاح' };
      if (!(plan.files || []).length) return { ok: false, message: 'ابعت الملفات في الشات الأول (الشيت والصور أو السكرين شوتس)' };
      FV.startWith({ auto: true, kase: s.kase || 'photos', type: s.type || 'Simple', files: plan.files || [], screens: s.screens || [], vendor: s.maker || null, category: s.category || null });
      return { ok: true, message: 'اتفتح الاستوديو بالملفات — بيقراها وبعدها المعاينة' }; }
    if (!P || !s.ids.length) return { ok: false, message: 'مفيش منتجات' };
    const recs = s.ids.map((id) => P.get(id)).filter(Boolean);
    if (s.op.startsWith('category_')) {
      const cid = catId(s.category); if (!cid) return { ok: false, message: 'القسم لسه ماتعملش — نفّذ خطوة القسم الأول' };
      const ups = recs.map((p) => { const cur = p.categoryIds || []; const nx = s.mode === 'set' ? [cid] : s.mode === 'remove' ? cur.filter((x) => x !== cid) : [...new Set(cur.concat([cid]))]; return nx.length && nx.join() !== cur.join() ? { id: p.id, categories: nx } : null; }).filter(Boolean);
      if (!ups.length) return { ok: true, message: 'مفيش حاجة تتغيّر' };
      const r = await P.batch(ups); return r.ok ? { ok: true, message: 'اتعدّل ' + K.n0(r.updated) + ' منتج' + (r.failedIds.length ? ' · ' + K.n0(r.failedIds.length) + ' ماتعدّلش' : '') } : { ok: false, message: 'ماتعدّلش (' + (r.reason || 'error') + ')' };
    }
    if (s.op === 'status') { const r = await P.batch(recs.map((p) => ({ id: p.id, status: s.status }))); return r.ok ? { ok: true, message: 'اتغيّرت حالة ' + K.n0(r.updated) + ' منتج' } : { ok: false, message: 'ماتغيّرتش (' + (r.reason || 'error') + ')' }; }
    if (s.op === 'move_maker') { if (!s.toMaker) return { ok: false, message: 'المبتكر مش معروف' }; const r = await P.moveVendor(s.ids, s.toMaker.id); return r.ok ? { ok: true, message: r.result === 'skipped' ? 'الموقع موقف الكتابة دلوقتي' : 'اتنقل ' + K.n0(r.moved) + ' منتج' } : { ok: false, message: r.reason === 'no_store' ? 'المبتكر ده مالوش متجر على الموقع' : 'ماتنقلش (' + (r.reason || 'error') + ')' }; }
    if (s.op === 'trash') { const r = await P.trashIds(s.ids); return r && r.ok ? { ok: true, message: 'اتحطّوا في المهملات' } : { ok: false, message: 'ماتحطّوش (' + ((r && r.reason) || 'error') + ')' }; }
    return { ok: false, message: 'الخطوة دي مش معروفة' };
  }
  function planPopup(plan) {
    const st = plan.done; let m = null;
    const row = (s, i) => {
      const d = st[i];
      return h('div', { class: 'mk-plan-step' + (d && d.ok ? ' done' : ''), 'data-plan-step': String(i) },
        h('span', { class: 'mk-ic tone-' + (s.problem ? 'error' : d && d.ok ? 'success' : 'gold') }, Icon(PLAN_ICON[s.op] || 'check', 'sm')),
        h('span', { class: 'mk-txt' }, h('b', null, (i + 1) + '. ' + s.label), s.sample && s.sample.length ? h('small', null, 'زي: ' + s.sample.join('، ') + (s.count > s.sample.length ? ' و' + K.n0(s.count - s.sample.length) + ' كمان' : '')) : null,
          s.problem ? h('small', { class: 'err-msg' }, s.problem) : null, d ? h('small', { class: d.ok ? 'help' : 'err-msg', 'data-plan-result': d.ok ? 'ok' : 'fail' }, d.message) : null),
        d && d.ok ? Tag('success', 'اتنفّذت') : Button({ size: 'sm', type: 'primary', label: d && d.running ? 'بينفّذ…' : 'نفّذ', disabled: !!s.problem || !!(d && d.running), attrs: { 'data-plan-run': String(i) },
          onClick: async () => { st[i] = { running: true }; draw(); const r = await planRun(plan, i); st[i] = r; draw(); if (r.ok) K.toast(r.message, 'success'); } }));
    };
    const body = () => [h('p', { class: 't-small help', style: 'margin:0' }, 'كل خطوة بزرارها — راجع العدد والأمثلة قبل ما تدوس. الحاجة اللي اتنفّذت بتتسجل في سجل الحركة.'), h('div', { class: 'mk-list' }, plan.steps.map(row))];
    const draw = () => { if (m) m.setBody(...body()); };
    m = U.Modal({ title: 'خطة المساعد (' + K.n0(plan.steps.length) + ' خطوات)', body: body(), footer: [Button({ label: 'اقفل', onClick: () => m.close() })] });
  }
  // the owner 17 Nov — «اقدر ارفع فايل سواء كان شيت او صورة او اين كان نوع الملف فيديو او بوست» و«اقدر ابعتلهم فويس»: files read in the
  // browser (IBChatFiles — 4 at most), chips over the bar with ×, and the mic typing the words into the box (the member presses send)
  function agPickFiles(a) {
    const inp = h('input', { type: 'file', multiple: true, hidden: true, 'data-mk-file-in': '' });
    inp.addEventListener('change', () => { agAddFiles(a, inp.files); inp.remove(); }); document.body.appendChild(inp); inp.click();
  }
  async function agAddFiles(a, list) {
    const F = window.IBChatFiles; if (!F) return;
    const have = AG.files[a] || []; const room = 4 - have.length;
    const picked = [...(list || [])].slice(0, Math.max(0, room)); if ((list || []).length > room) K.toast('لحد 4 ملفات في الرسالة', 'info');
    if (!picked.length) return;
    AG.reading = (AG.reading || 0) + 1; R();
    for (const f of picked) { const r = await F.read(f); if (r.ok) AG.files[a] = (AG.files[a] || []).concat([Object.assign({ id: 'f' + Math.random().toString(36).slice(2, 8), raw: f }, r.file)]); else K.toast(r.message, 'error'); }
    AG.reading -= 1; R();
  }
  // the owner 17 Nov — «يقدر يجب الفيلز اللي اتعملت في الشات و ارفعها من عندوا او انزلها علي حسب المساعد و انواع الفيلز»: the files sent with a
  // message stay under it (this session — the chat keeps their names only): «تنزيل» each, and by the assistant: the warehouse's «اعمل
  // منها منتجات» (the studio's «صور بس» with them), the designer's «استخدمها في كامبين» (the campaign's reference images)
  function turnFiles(a, files) {
    const raw = files.map((f) => f.raw).filter(Boolean); const imgs = raw.filter((f) => /^image\//.test(f.type || ''));
    const dl = (f) => { try { const u = URL.createObjectURL(f.raw); const x = h('a', { href: u, download: f.name }); document.body.appendChild(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (e) { K.toast('ماقدرتش أنزّله', 'error'); } };
    const use = a === 'stock' && imgs.length && window.IBFlowView && window.IBFlowView.startWith ? Button({ size: 'sm', icon: 'plus', label: 'اعمل منها منتجات', attrs: { 'data-mk-files-studio': '' }, onClick: () => window.IBFlowView.startWith({ kase: 'photos', type: 'Simple', files: imgs }) })
      : a === 'designer' && imgs.length && can().create ? Button({ size: 'sm', icon: 'megaphone', label: 'استخدمها في كامبين', attrs: { 'data-mk-files-camp': '' }, onClick: async () => {
        if (!openDraft({ idea: 'كامبين من الصور اللي في الشات' })) return; if (!(await ensureCampaign())) return;
        const media = camp.w && camp.w.media ? camp.w.media : {}; const t = Object.keys(media).find((k) => media[k] && Array.isArray(media[k].use)); if (!t) return;
        for (const f of imgs) { const r = await MK().upload(camp.id, f); if (r.ok) media[t].use.push({ t: 'file', name: r.name, path: r.path }); else K.toast(r.message, 'error'); }
        persist(); R(); K.toast('الصور في «فايلز للاستخدام» — كمّل الكامبين', 'success'); } }) : null;
    return h('div', { class: 'mk-files mk-turn-files', 'data-mk-turn-files': String(files.length) }, files.map((f) => h('span', { class: 'mk-file' },
      f.thumb ? h('img', { src: f.thumb, alt: '' }) : h('span', { class: 'mk-file-ic' }, Icon(f.kind === 'pdf' ? 'file' : 'sheet', 'sm')), h('span', { class: 'mk-file-t' }, h('b', null, f.name)),
      f.raw ? h('button', { type: 'button', class: 'mk-file-x', 'aria-label': 'نزّل ' + f.name, title: 'تنزيل', 'data-mk-file-dl': f.name, onClick: () => dl(f) }, Icon('download', 'sm')) : null)), use);
  }
  function agFileChips(a) {
    const fs = AG.files[a] || []; if (!fs.length && !AG.reading) return null;
    return h('div', { class: 'mk-files', 'data-mk-files': String(fs.length) }, fs.map((f) => h('span', { class: 'mk-file', 'data-mk-file': f.name },
      f.thumb ? h('img', { src: f.thumb, alt: '' }) : h('span', { class: 'mk-file-ic' }, Icon(f.kind === 'pdf' ? 'file' : 'sheet', 'sm')),
      h('span', { class: 'mk-file-t' }, h('b', null, f.name), f.note ? h('small', null, f.note) : null),
      h('button', { type: 'button', class: 'mk-file-x', 'aria-label': 'شيل ' + f.name, onClick: () => { AG.files[a] = (AG.files[a] || []).filter((x) => x.id !== f.id); R(); } }, Icon('close', 'sm')))),
    AG.reading ? h('span', { class: 'mk-file is-loading' }, h('small', null, 'بنقرا الملف…')) : null);
  }
  function agQueueList(a) {
    const qs = AG.queue[a] || []; if (!qs.length) return null;
    return h('div', { class: 'mk-queue', 'data-mk-queue': String(qs.length) }, h('small', { class: 'help' }, 'في الطابور (' + K.n0(qs.length) + ') — هتتبعت بالترتيب بعد الرد'),
      qs.map((x, i) => h('div', { class: 'mk-queue-it', 'data-mk-queued': String(i) }, h('span', null, (x.q || 'ملفات') + (x.files.length ? ' · 📎 ' + K.n0(x.files.length) : '')),
        h('button', { type: 'button', class: 'mk-file-x', 'aria-label': 'شيلها من الطابور', onClick: () => { AG.queue[a] = (AG.queue[a] || []).filter((y) => y.id !== x.id); R(); } }, Icon('close', 'sm')))));
  }
  function agMicBtn(a, inp) {
    const F = window.IBChatFiles; const on = AG.mic && AG.mic.a === a;
    return h('button', { type: 'button', class: 'mk-ask-ic mk-ask-mic' + (on ? ' on' : ''), 'data-mk-mic': on ? 'on' : 'off', 'aria-pressed': on ? 'true' : 'false', title: on ? 'وقّف التسجيل' : 'اتكلم والكلام يتكتب', 'aria-label': on ? 'وقّف التسجيل' : 'اتكلم',
      onClick: () => {
        if (on) { AG.mic.rec.stop(); return; }
        if (!F || !F.supportsVoice()) { K.toast('المتصفح ده مابيكتبش بالصوت — جرّب Chrome أو Edge أو Safari', 'error'); return; }
        const rec = F.dictation({ onText: (t) => { AG.draft[a] = t; const x = document.getElementById('mk-ask'); if (x) { x.value = t; agGrow(x); } },
          onError: (m) => K.toast(m, 'error'), onEnd: () => { AG.mic = null; R(); } });
        AG.mic = { a, rec }; rec.start(String(inp.value || '').trim()); R();
      } }, Icon('mic', 'sm'));
  }
  // the owner 17 Nov — «عايز الشات يبقا فيه فكرة الكيو»: a message sent while the assistant is still answering waits in a queue under the
  // box (each can be dropped) and goes by itself, in order, once the answer lands; the files ride with their message
  async function agSend(a, txt) {
    const q = String(txt || '').trim(); const files = (AG.files[a] || []).slice(); if (!q && !files.length) return;
    if (AG.reading) { K.toast('استنى الملفات تخلص قراية', 'info'); return; }
    AG.draft[a] = ''; AG.files[a] = [];
    if (AG.asking) { AG.queue[a] = (AG.queue[a] || []).concat([{ id: 'q' + Date.now() + Math.random().toString(36).slice(2, 6), q, files }]); R(); return; }
    await agSendNow(a, q, files);
    while (!AG.asking && (AG.queue[a] || []).length) { const n = AG.queue[a].shift(); await agSendNow(a, n.q, n.files); }
  }
  async function agSendNow(a, q, files) {
    const id = AG.active[a] || null; const key = id || 'new-' + a;
    const fl = files.length ? '📎 ' + files.map((f) => f.name).join('، ') : '';
    AG.turns[key] = (AG.turns[key] || []).concat([{ id: 'tmp', role: 'user', text: [q, fl].filter(Boolean).join('\n'), images: [], at: new Date().toISOString() }]); AG.asking = true; R();
    const r = await MK().agentAsk(a, id, q, files); AG.asking = false;
    if (!r.ok) { AG.turns[key] = (AG.turns[key] || []).filter((t) => t.id !== 'tmp'); K.toast(r.message, 'error'); if (r.reason === 'notfound' && id) { AG.chats[a] = (AG.chats[a] || []).filter((c) => c.id !== id); AG.active[a] = null; } agRefresh(); return; }
    const chat = r.chat; const cid = chat ? chat.id : id;
    const prev = (AG.turns[key] || []).filter((t) => t.id !== 'tmp'); if (!id) delete AG.turns[key];
    AG.turns[cid] = prev.concat(r.turns);
    const ans = r.turns.find((t) => t.role === 'assistant'); if (ans && r.imagePrompt) AG.prompts[ans.id] = r.imagePrompt; if (ans && r.request) AG.reqs[ans.id] = r.request;
    if (ans && r.campaignAction) AG.acts[ans.id] = r.campaignAction; // ش45 decision 5: the buyer's confirm card
    if (ans && r.decisions && r.decisions.length) AG.decs[ans.id] = r.decisions.map((x) => Object.assign({}, x)); // the owner 18 Nov: «موافق» / «رفض» on a suggestion in the chat
    if (ans && r.ask) AG.asks[ans.id] = r.ask; // the owner 18 Nov: choices as buttons in the chat, data in a popup — every assistant the same way
    if (ans && r.handoff) AG.hand[ans.id] = r.handoff; // the owner 17 Nov: «ده مش اختصاصي — هبعتك لـ…» → «روح لـ…» under the answer
    if (ans && ((r.forms && r.forms.length) || r.page)) AG.forms[ans.id] = { forms: r.forms || [], page: r.page }; // agents-brain T3: the popups / the page under the answer
    const userTurn = r.turns.find((t) => t.role === 'user'); if (userTurn && files.length) AG.turnFiles[userTurn.id] = files; // the owner 17 Nov: the chat's files stay under the message (this session)
    // the studio step takes this message's files, else every file sent in this chat (the owner 18 Nov: the case is picked first, the files come after)
    const chatFiles = () => (AG.turns[cid] || []).flatMap((t) => (AG.turnFiles[t.id] || [])).map((f) => f.raw).filter(Boolean);
    if (ans && r.plan && r.plan.length) AG.plans[ans.id] = { steps: r.plan, files: files.length ? files.map((f) => f.raw).filter(Boolean) : chatFiles(), done: {} }; // the owner 17 Nov: the warehouse assistant's plan
    if (chat) { AG.chats[a] = [chat].concat((AG.chats[a] || []).filter((c) => c.id !== chat.id)); AG.active[a] = chat.id; }
    if (ans && r.campaign) { AG.drafts[ans.id] = r.campaign; if (a === 'designer' && openDraft(r.campaign)) { K.toast('فتحتلك الكامبين متملّية — راجعها واضغط توليد', 'success'); return; } }
    agRefresh();
  }
  async function agGen(a, turnId) {
    const cid = AG.active[a]; const prompt = AG.prompts[turnId]; if (!cid || !prompt || AG.gen) return;
    AG.gen = turnId; R();
    const r = await MK().agentImage(cid, prompt); AG.gen = null;
    if (!r.ok) { K.toast(r.message, 'error'); agRefresh(); return; }
    delete AG.prompts[turnId];
    if (r.turn) AG.turns[cid] = (AG.turns[cid] || []).concat([r.turn]);
    K.toast('اتعملت الصورة' + (r.credits ? ' · ' + K.n0(r.credits) + ' كريدت' : ''), 'success'); agRefresh();
  }
  function agRename(a, c) {
    K.form({ title: 'تغيير اسم الشات', values: { t: c.title }, submitLabel: 'احفظ الاسم', fields: (f, e, set) => [K.field.text('t', 'اسم الشات', f, e, set, { required: true, maxlength: 80 })],
      validate: (f) => (String(f.t || '').trim() ? (String(f.t).trim().length > 80 ? { t: 'لحد 80 حرف' } : {}) : { t: 'اكتب اسم للشات' }),
      submit: async (f) => { const r = await MK().agentRename(c.id, f.t); if (!r.ok) { K.toast(r.message, 'error'); return; } AG.chats[a] = (AG.chats[a] || []).map((x) => (x.id === c.id ? Object.assign({}, x, { title: r.chat.title }) : x)); K.toast('اتغيّر الاسم', 'success'); agRefresh(); } });
  }
  function agDelete(a, c) {
    K.confirm({ title: 'تمسح الشات؟', text: U.num('«' + c.title + '» هيتمسح نهائي — هو ورسايله.'), okLabel: 'امسح الشات', okType: 'danger',
      onOk: async () => { const r = await MK().agentDelete(c.id); if (!r.ok) { K.toast(r.message, 'error'); return; } AG.chats[a] = (AG.chats[a] || []).filter((x) => x.id !== c.id); delete AG.turns[c.id]; if (AG.active[a] === c.id) AG.active[a] = null; K.toast('اتمسح الشات', 'success'); agRefresh(); } });
  }
  function agSettings(a) {
    const A = AGENTS[a]; const cur = agCfg(a) || { intro: '', instructions: '', suggestions: null };
    K.form({ title: 'إعدادات ' + A.name, wide: true, submitLabel: 'احفظ الإعدادات', note: 'التعليمات بيقراها المساعد في كل رسالة ويمشي عليها — مابتخليهوش ينفّذ حاجة لوحده.',
      values: { intro: cur.intro || '', instr: cur.instructions || '', sugg: (cur.suggestions || agSugg(a)).join('\n') },
      fields: (f, e, set) => [K.field.area('intro', 'رسالة التعريف (أول الشات)', f, e, set, { placeholder: agIntro(a) }),
        K.field.area('instr', 'التعليمات والقواعد', f, e, set, { placeholder: a === 'designer' ? 'مثال: الألوان بيج وأخضر — الخط عربي واضح — من غير أسود' : a === 'dev' ? 'مثال: أي تعديل على الموقع يتجرّب على الـ staging الأول' : 'مثال: ركّز على العائد الحقيقي من ووكومرس' }),
        K.field.area('sugg', 'الاقتراحات السريعة (سطر لكل اقتراح — لحد 8)', f, e, set)],
      validate: (f) => { const e = {}; if (String(f.intro).trim().length > 600) e.intro = 'لحد 600 حرف'; if (String(f.instr).trim().length > 4000) e.instr = 'لحد 4000 حرف';
        const L = String(f.sugg).split('\n').map((x) => x.trim()).filter(Boolean); if (L.length > 8) e.sugg = 'لحد 8 اقتراحات'; else if (L.some((x) => x.length > 80)) e.sugg = 'الاقتراح لحد 80 حرف';
        if (/[<>]/.test(f.intro + f.instr + f.sugg)) e.instr = 'من غير < أو >'; return e; },
      submit: async (f) => { const r = await MK().agentSettingsSet(a, { intro: f.intro, instructions: f.instr, suggestions: String(f.sugg).split('\n').map((x) => x.trim()).filter(Boolean) });
        K.toast(r.ok ? 'اتحفظت إعدادات ' + A.name : r.message, r.ok ? 'success' : 'error'); agRefresh(); } });
  }
  // comments 15 Nov (decision 72 — «ظبط صفحة مساعدين الذكاء الاصطناعي — الui بتاع الشاتات بالذات و كل حاجة بشكل احترافي و منظم»): the
  // chat is one frame of a fixed height — the history by day on the side (a drawer on a phone: «الشاتات» in the head), the assistant's
  // mark and what it does in the head, a new chat opens on a welcome (the intro and the suggestions as cards), the turns as rows (the
  // assistant's mark beside its bubble, my words green with beige text like the header's assistant, who and when under the bubble),
  // the suggestions as one strip over the box, and the box itself grows with what is typed (Enter sends, Shift + Enter = a new line).
  // Decision 73 («غير الايقون دي لايقونة التكبير و لما اجي اصغر تبقي ايقونة التصغير»): «كبّر» carries the expand mark and «صغّر» the shrink one
  const AG_ICON = { buyer: 'chart', designer: 'image', dev: 'code' };
  const agMark = (a, cls) => h('span', { class: 'mk-av' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, Icon(agIcon(a), 'sm'));
  const agDay = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d); };
  // the history by day — today, the last week, older — in the order the server sent it (the newest first)
  function agGroups(chats) {
    const today = TODAY(); const week = W.addD(today, -7); const G = [['النهارده', []], ['آخر 7 أيام', []], ['أقدم', []]];
    chats.forEach((c) => { const d = agDay(c.updatedAt); G[d === today ? 0 : d > week ? 1 : 2][1].push(c); });
    return G.filter((g) => g[1].length);
  }
  const agGrow = (x) => { if (!x) return; x.style.height = 'auto'; x.style.height = Math.min(x.scrollHeight, 132) + 'px'; };
  function agentChat(a) {
    agLoad(a, false);
    const A = AGENTS[a]; const cfg = agCfg(a); const chats = AG.chats[a]; const cid = AG.active[a] || null; const key = cid || 'new-' + a;
    const turns = AG.turns[key] || []; const intro = (cfg && cfg.intro) || agIntro(a);
    const sugg = (cfg && cfg.suggestions && cfg.suggestions.length ? cfg.suggestions : agSugg(a));
    const chatRow = (c) => h('div', { class: 'mk-agent-row' + (c.id === cid ? ' on' : ''), 'data-mk-chat-item': c.id },
      h('button', { type: 'button', class: 'mk-agent-open', 'aria-current': c.id === cid ? 'true' : null, onClick: () => agOpen(a, c.id) }, h('b', null, c.title), h('small', { class: 'help' }, agTime(c.updatedAt))),
      K.RowMenu([{ label: 'تغيير الاسم', icon: 'edit', run: () => agRename(a, c) }, { label: 'امسح الشات', icon: 'trash', danger: true, run: () => agDelete(a, c) }], 'خيارات الشات'));
    const side = h('aside', { class: 'mk-agent-side' + (AG.side ? ' open' : ''), 'aria-label': 'شاتات ' + A.name },
      h('div', { class: 'mk-agent-side-head' }, h('b', null, 'الشاتات'), chats && chats.length ? h('span', { class: 'mk-agent-n' }, K.Num(K.n0(chats.length))) : null),
      Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'شات جديد', attrs: { 'data-mk-chat-new': a }, onClick: () => agOpen(a, null) }),
      chats ? (chats.length ? h('div', { class: 'mk-agent-list', 'data-mk-chats': String(chats.length) }, agGroups(chats).reduce((all, g) => all.concat([h('small', { class: 'mk-agent-day' }, g[0])], g[1].map(chatRow)), []))
        : h('p', { class: 't-small help mk-agent-none' }, 'لسه مفيش شاتات — ابدأ بسؤال.')) : h('p', { class: 't-small help mk-agent-none' }, 'بنحمّل الشاتات…'));
    const send = (x) => (a === 'buyer' && x === 'اعمل حملة لمنتج' ? go('marketing-campaign-1') : agSend(a, x));
    const chips = h('div', { class: 'chips mk-agent-chips' }, h('span', { class: 't-small help' }, 'اقتراحات سريعة:'), sugg.map((x) => h('button', { type: 'button', class: 'chip', onClick: () => send(x) }, x)));
    const lastAns = (turns.filter((t) => t.role === 'assistant').slice(-1)[0] || {}).id; // only the last answer's buttons still ask
    const bubbles = turns.map((t) => { const mine = t.role === 'user';
      return h('div', { class: 'mk-row ' + (mine ? 'user' : 'ai') }, mine ? null : agMark(a),
        h('div', { class: 'mk-col' },
          h('div', { class: 'mk-msg ' + (mine ? 'user' : 'ai'), 'data-mk-turn': String(t.id) },
            t.text ? h('p', null, t.text) : null,
            t.images.length ? h('div', { class: 'mk-msg-imgs' }, t.images.map((pth) => Img(pth, 'mk-agent-img', 'صورة من الديزاينر'))) : null,
            mine && AG.turnFiles[t.id] ? turnFiles(a, AG.turnFiles[t.id]) : null,
            a === 'designer' && t.role === 'assistant' && AG.prompts[t.id] ? h('div', { class: 'mk-msg-gen' }, h('small', { class: 'help' }, 'وصف الصورة: ' + AG.prompts[t.id]),
              can().create ? Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: AG.gen === t.id ? 'بتتعمل…' : 'ولّد الصورة', disabled: !!AG.gen, attrs: { 'data-mk-gen': String(t.id) }, onClick: () => agGen(a, t.id) }) : h('small', { class: 'help' }, 'التوليد محتاج «التسويق: إنشاء»')) : null,
            // owner batch 14 Nov decision 14: the job the assistant handed back — «قدّم الطلب ده» opens «تقديم طلب» filled with it
            t.role === 'assistant' && AG.reqs[t.id] && canAsk() ? h('div', { class: 'mk-msg-req' }, h('small', { class: 'help' }, 'طلب جاهز: ' + AG.reqs[t.id].title),
              Button({ size: 'sm', type: 'primary', icon: 'send', label: 'قدّم الطلب ده', attrs: { 'data-mk-req-from': String(t.id) }, onClick: () => reqForm(a, { title: AG.reqs[t.id].title, details: AG.reqs[t.id].details }) })) : null,
            t.role === 'assistant' && AG.acts[t.id] ? actCard(t.id, AG.acts[t.id]) : null,
            t.role === 'assistant' && AG.decs[t.id] ? AG.decs[t.id].map((x) => decCard(t.id, x)) : null,
            t.role === 'assistant' && AG.forms[t.id] ? formLinks(t.id) : null,
            t.role === 'assistant' && AG.asks[t.id] && window.IBChatAsk ? window.IBChatAsk.card(AG.asks[t.id], { key: a + ':' + t.id, used: t.id !== lastAns, onSend: (txt) => agSend(a, txt) }) : null,
            t.role === 'assistant' && AG.plans[t.id] ? h('div', { class: 'mk-msg-req', 'data-mk-plan': String(AG.plans[t.id].steps.length) }, h('small', { class: 'help' }, 'خطة من ' + K.n0(AG.plans[t.id].steps.length) + ' خطوات — مفيش حاجة بتتنفّذ غير لما توافق على كل خطوة'), Button({ size: 'sm', type: 'primary', icon: 'check', label: 'راجع الخطة', attrs: { 'data-mk-plan-open': String(t.id) }, onClick: () => planPopup(AG.plans[t.id]) })) : null,
            t.role === 'assistant' && AG.hand[t.id] ? h('div', { class: 'mk-msg-req mk-handoff', 'data-mk-handoff': AG.hand[t.id].agent },
              h('small', { class: 'help' }, 'هيتكتب في الشات: ' + AG.hand[t.id].question.slice(0, 140)),
              Button({ size: 'sm', type: 'primary', icon: 'send', label: 'روح ' + AGENTS[AG.hand[t.id].agent].to, attrs: { 'data-mk-handoff-go': String(t.id) },
                onClick: () => { const x = AG.hand[t.id]; if (!askAgent(x.agent, x.question)) K.toast('المساعد ده مش متاح لدورك', 'error'); } })) : null,
            t.role === 'assistant' && AG.drafts[t.id] && can().create ? h('div', { class: 'mk-msg-req' }, h('small', { class: 'help' }, 'كامبين جاهزة: ' + String(AG.drafts[t.id].idea || '').slice(0, 80)),
              Button({ size: 'sm', type: 'primary', icon: 'megaphone', label: 'افتح الكامبين', attrs: { 'data-mk-draft-from': String(t.id) }, onClick: () => openDraft(AG.drafts[t.id]) })) : null),
          h('small', { class: 'mk-meta help' }, (mine ? meName() : A.name) + ' · ' + agTime(t.at)))); });
    const waiting = !!(cid && !AG.turns[cid]); const fresh = !turns.length && !waiting && !AG.asking;
    const worm = () => (window.IBLoader && window.IBLoader.mark ? window.IBLoader.mark(18) : null);
    // owner batch 14 Nov decision 14: the chat stays on its last message — a new turn, «بيفكر…» or another chat goes to the bottom; any
    // other redraw keeps where the member scrolled (a new .mk-chat starts at the top otherwise)
    const sk = key + ':' + turns.length + ':' + (AG.asking ? 1 : 0);
    const msgs = h('div', { class: 'mk-chat' + (fresh ? ' fresh' : ''), 'data-mk-chat': String(turns.length), 'aria-live': 'polite', onScroll: (e) => { const el = e.currentTarget; AG.pos[a] = el.scrollTop; AG.atBottom[a] = el.scrollHeight - el.scrollTop - el.clientHeight < 40; } },
      fresh ? h('div', { class: 'mk-welcome' }, agMark(a, 'xl'), h('b', { class: 'mk-welcome-t' }, A.name), h('p', { class: 'mk-intro' }, intro),
        a === 'buyer' ? h('small', { class: 'help' }, 'الأرقام من آخر مزامنة') : null, chips) : null,
      waiting ? h('p', { class: 't-small help mk-chat-wait' }, worm(), h('span', null, 'بنحمّل الرسايل…')) : null,
      bubbles, AG.asking ? h('div', { class: 'mk-row ai' }, agMark(a), h('div', { class: 'mk-col' }, h('div', { class: 'mk-msg ai mk-think', 'data-mk-thinking': '' }, worm(), h('p', null, 'بيفكر…')))) : null);
    const toEnd = AG.seen[a] !== sk || AG.atBottom[a] !== false; AG.seen[a] = sk;
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-mk-agent="' + a + '"] .mk-chat'); if (!el) return;
      agGrow(document.getElementById('mk-ask'));
      if (toEnd) { el.scrollTop = el.scrollHeight; AG.atBottom[a] = true; AG.pos[a] = el.scrollTop; } else el.scrollTop = AG.pos[a] || 0; // a second redraw in the same frame lands where the first put it
      el.querySelectorAll('img').forEach((im) => { if (!im.complete) im.addEventListener('load', () => { if (AG.atBottom[a] !== false) el.scrollTop = el.scrollHeight; }, { once: true }); });
    });
    const inp = h('textarea', { class: 'mk-ask-in', id: 'mk-ask', rows: '1', placeholder: a === 'buyer' ? 'اسأل الميديا باير عن أرقامك…' : 'اكتب رسالة ' + A.to + '…', 'aria-label': 'رسالة ' + A.to, maxlength: '1000',
      onInput: () => { AG.draft[a] = inp.value; agGrow(inp); }, onPaste: (e) => { const fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); agAddFiles(a, fs); } }, onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); agSend(a, inp.value); } } });
    inp.value = AG.draft[a] || '';
    // a re-render (the chats or the turns landing) keeps what was being typed and the cursor in the box — right after the render, in
    // the same task (IBPages.render is synchronous): a frame later a key typed in between went to the removed box (CI 989 on 14 Nov:
    // the text typed while the designer's chats landed was lost)
    if (document.activeElement && document.activeElement.id === 'mk-ask') queueMicrotask(() => { const x = document.getElementById('mk-ask'); if (x && document.activeElement !== x) { x.focus(); const n = x.value.length; quietSel(x, n); } });
    const head = h('div', { class: 'mk-agent-head' }, agMark(a, 'lg'), h('div', { class: 'mk-agent-title' }, h('b', null, A.name), h('small', { class: 'help' }, AG_SUB[a] || (agReg(a) || {}).about || '')),
      h('div', { class: 'mk-agent-tools' },
        h('button', { type: 'button', class: 'btn btn-default sm mk-agent-toggle', 'data-mk-chats-toggle': AG.side ? 'on' : 'off', 'aria-expanded': AG.side ? 'true' : 'false', onClick: () => { AG.side = !AG.side; R(); } }, Icon('msg', 'sm'), 'الشاتات' + (chats && chats.length ? ' (' + K.n0(chats.length) + ')' : '')),
        isAdmin() ? Button({ size: 'sm', icon: 'gear', label: 'الإعدادات', attrs: { 'data-mk-agent-cfg': a }, onClick: () => agSettings(a) }) : null, askBtn(a),
        Button({ size: 'sm', icon: AG.full ? 'shrink' : 'expand', label: AG.full ? 'صغّر' : 'كبّر', attrs: { 'data-mk-agent-full': AG.full ? 'on' : 'off', 'aria-pressed': AG.full ? 'true' : 'false' }, onClick: () => { AG.full = !AG.full; R(); } })));
    const main = h('section', { class: 'mk-agent-main' }, head, msgs, fresh ? null : chips,
      h('div', { class: 'mk-compose', onDragover: (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); }, onDrop: (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); agAddFiles(a, e.dataTransfer.files); } } },
        agQueueList(a), agFileChips(a),
        // the owner 17 Nov («عايز بار الشات زيك بالظبط بنفس الشكل»): one rounded bar — the mic and send on one end, the box, «+» (files) on the other
        h('div', { class: 'mk-ask' }, agMicBtn(a, inp),
          h('button', { type: 'button', class: 'mk-ask-ic mk-ask-send', 'data-mk-ask': '', title: AG.asking ? 'هتتبعت بعد الرد (في الطابور)' : 'ابعت (Enter)', 'aria-label': 'ابعت', onClick: () => agSend(a, inp.value) }, Icon('send', 'sm')),
          inp,
          h('button', { type: 'button', class: 'mk-ask-ic mk-ask-plus', 'data-mk-attach': '', title: 'ارفع ملف — صورة · فيديو · PDF · شيت', 'aria-label': 'ارفع ملف', onClick: () => agPickFiles(a) }, Icon('plus', 'sm'))),
        h('small', { class: 'help mk-ask-hint' }, 'Enter بيبعت · Shift + Enter سطر جديد · + ملف · 🎙 كلام' + (a === 'buyer' ? ' · مفيش أي تنفيذ من الشات' : ''))));
    // on a phone the history is a drawer over the chat: the veil behind it closes it
    const veil = AG.side ? h('button', { type: 'button', class: 'mk-agent-veil', 'aria-label': 'اقفل الشاتات', onClick: () => { AG.side = false; R(); } }) : null;
    return h('div', { class: 'mk-agent card' + (AG.full ? ' mk-agent-full' : ''), 'data-mk-agent': a }, side, veil, main);
  }
  // 0082 (the owner 12 Nov — «زرار تقديم طلب… بوب أب فيه تقديم طلب جديد للديزاينر البشري أو للميديا باير البشري… بنفس طريقة بوب أب
  // طلبات الفريق… ولما يتعمل يتسجل هنا في صفحة الديزاينر أو المبرمج ونقول مين مقدم الطلب… ويبقى مربوط بصفحة طلبات الفريق»): a request
  // = a team request of a kind (IBTickets.createRequest → ticket_request_create) to the kind's role; listed here under its assistant
  // with who asked, worked (status, replies) in «طلبات الفريق»
  // 0120: every assistant from the registry — its name, the role a request goes to («تقديم طلب»), «لـ…»
  const AG_ROLE = { buyer: 'الإعلانات', designer: 'التصميم', dev: 'البرمجة' }; // 0128: the teams' names (the registry's role wins)
  const ADMIN_TEAM = () => (window.IbtekrTickets && window.IbtekrTickets.ADMIN_ROLE) || 'الإدارة';
  // «لـ» + the name, the article joined the Egyptian way: «للمبرمج الذكي» / «لخدمة العملاء الذكية»
  const toOf = (name) => (/^ال/.test(name) ? 'ل' + name.slice(1) : /^[\u0621-\u064a]/.test(name) ? 'ل' + name : 'لـ ' + name);
  const AGENTS = new Proxy({}, { get: (o, a) => { if (typeof a !== 'string') return undefined; const r = agReg(a); const name = agName(a); return { name, role: (r && r.role) || AG_ROLE[a] || ADMIN_TEAM(), to: toOf(name) }; } });
  const TKA = () => window.IBTickets; const TKD = () => window.IbtekrTickets;
  const canAsk = () => !!(TKA() && TKA().can().manage);
  const REQ_TONE = { open: 'orange', in_progress: 'gold', waiting: 'gold', resolved: 'success', closed: 'neutral' };
  const reqsOf = (kind) => (BY.reqs ? (MK().reqsNow() || []).filter((q) => q.kind === kind) : null);
  const reqItem = (q) => h('button', { type: 'button', class: 'mk-item', 'data-mk-req': q.id, onClick: () => openReq(q) }, h('span', { class: 'mk-ic tone-' + (REQ_TONE[q.status] || 'neutral') }, Icon(q.open ? 'clock' : 'users', 'sm')),
    h('span', { class: 'mk-txt' }, h('b', null, q.title), h('small', null, U.num([q.id, q.project, 'طلبها ' + (q.by || '—') + (q.byRole ? ' (' + q.byRole + ')' : ''), q.createdAt ? D2(String(q.createdAt).slice(0, 10)) : ''].filter(Boolean).join(' · ')))), Tag(REQ_TONE[q.status] || 'neutral', q.statusLabel));
  const openInTeam = (id) => { if (window.IbtekrApp && window.IbtekrApp.openTicket) window.IbtekrApp.openTicket(id); else location.hash = 'tickets-' + id; };
  function openReq(q) {
    const pr = ((TKD() && TKD().PRIORITIES) || []).find(([v]) => v === q.priority);
    const m = U.Modal({ title: q.title, body: [K.Kv([['الرقم', q.id], ['لـ', q.assigneeRole || '—'], ['المشروع / الكامبين', q.project || '—'], ['التفاصيل', q.details ? h('span', { style: 'white-space:pre-wrap' }, q.details) : '—'],
      ['الأولوية', pr ? pr[1] : (q.priority || '—')], ['الحالة', Tag(REQ_TONE[q.status] || 'neutral', q.statusLabel)], ['طلبها', (q.by || '—') + (q.byRole ? ' · ' + q.byRole : '') + (q.createdAt ? ' · ' + D2(String(q.createdAt).slice(0, 10)) : '')],
      q.attachments.length ? ['المرفقات', K.n0(q.attachments.length) + ' ملف — في الطلب نفسه'] : null, q.doneAt ? ['خلص', D2(String(q.doneAt).slice(0, 10))] : null]),
      U.InlineNote({ children: 'الشغل على الطلب (الحالة، الردود، المرفقات) من «طلبات الفريق» — الطلب نفسه هناك.' })], footer: [] }); m.el.dataset.mkReq = q.id;
    m.setFooter(Button({ type: 'primary', label: 'افتح في طلبات الفريق', attrs: { 'data-mk-req-open': q.id }, onClick: () => { m.close(); openInTeam(q.id); } }), Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() }));
    return m;
  }
  // the popup — «طلب جديد» of «طلبات الفريق» for this request only: the title, the campaign / project, the details, the priority, the
  // role (the kind's by default), the follow-up date and the files (the tickets bucket, the member's folder)
  function reqForm(kind, pre) {
    const T = TKA(); const D = TKD(); const A = AGENTS[kind] || AGENTS.designer;
    if (!canAsk()) { K.toast('مفيش صلاحية تفتح طلبات — محتاج «طلبات الفريق: فتح ورد»', 'error'); return; }
    const roles = (D && D.ROLES) || []; const role0 = roles.includes(A.role) ? A.role : ADMIN_TEAM();
    const f = Object.assign({ title: '', project: kind === 'dev' ? 'موقع' : '', details: '', priority: 'normal', role: role0, followUp: '', files: [] }, pre || {});
    let errs = {}; let sending = false; let msg = ''; let m = null;
    const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: ((T && T.MIME) || []).join(','), 'data-mk-req-file': '' });
    fileIn.addEventListener('change', async () => {
      const list = [...(fileIn.files || [])]; fileIn.value = ''; if (!list.length) return;
      const room = (T.MAX_FILES || 10) - f.files.length; const bad = []; msg = 'بيترفع…'; draw();
      for (const file of list.slice(0, Math.max(0, room))) { const r = await T.upload(file); if (r.ok) f.files.push(r.file); else bad.push(file.name + ': ' + r.message); }
      if (list.length > room) bad.push('أقصى عدد ' + (T.MAX_FILES || 10) + ' ملفات');
      msg = bad.join(' · '); draw();
    });
    function draw() {
      const chips = f.files.length ? h('div', { class: 'chips' }, f.files.map((x, i) => h('span', { class: 'chip', 'data-mk-req-chip': String(i) }, x.name, h('button', { type: 'button', class: 'chip-x', 'aria-label': 'شيل ' + x.name, onClick: () => { f.files.splice(i, 1); draw(); } }, '×')))) : null;
      m.setBody(
        h('div', { class: 'row cols2' }, U.TextInput({ id: 'mk-rq-title', label: 'العنوان', required: true, value: f.title, error: errs.title, maxlength: 80, placeholder: kind === 'designer' ? 'مثال: 3 بوستات لعروض الشتا 1080×1350' : kind === 'dev' ? 'مثال: صفحة هبوط لعروض الشتا' : 'مثال: حملة لمنتجات الماكرامية', onInput: (v) => { f.title = v; } }),
          U.TextInput({ id: 'mk-rq-project', label: kind === 'dev' ? 'المشروع' : 'الكامبين / المشروع', value: f.project, maxlength: 60, placeholder: 'اختياري', onInput: (v) => { f.project = v; } })),
        U.Textarea({ id: 'mk-rq-desc', label: 'التفاصيل', value: f.details, placeholder: kind === 'designer' ? 'المقاس · المدة · المنتجات · الستايل' : kind === 'dev' ? 'إيه المطلوب بالظبط' : 'الهدف · الميزانية · المنتجات · المدة', onInput: (v) => { f.details = v; } }),
        h('div', { class: 'row cols2' }, U.Select({ id: 'mk-rq-prio', label: 'الأولوية', required: true, options: ((D && D.PRIORITIES) || [['normal', 'عادي']]).map(([v, l]) => ({ value: v, label: l })), value: f.priority, onChange: (v) => { f.priority = v; draw(); } }),
          U.Select({ id: 'mk-rq-role', label: 'المسؤول (الدور)', required: true, options: roles.map((r) => ({ value: r, label: r })), value: f.role, error: errs.role, onChange: (v) => { f.role = v; draw(); } })),
        h('div', { class: 'row cols2' }, U.DateField({ id: 'mk-rq-follow', label: 'تاريخ المتابعة', value: f.followUp || null, error: errs.followUp, today: TODAY(), onChange: (iso, e) => { if (!e) f.followUp = iso || ''; errs.followUp = e || undefined; draw(); } }),
          U.FieldShell({ id: 'mk-rq-att', label: 'مرفقات (صور أو PDF — لحد 10 ملفات، 10 ميجا للملف)' }, h('div', { class: 'tk-attach' }, Button({ label: 'إضافة صورة أو ملف', icon: 'attach', disabled: f.files.length >= ((T && T.MAX_FILES) || 10), onClick: () => fileIn.click() }), fileIn, chips, h('span', { class: 't-small', 'aria-live': 'polite' }, msg)))),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'هيتسجل باسمك وتاريخ النهارده، ويظهر هنا تحت ' + A.name + ' وفي «طلبات الفريق» لدور «' + f.role + '» — والشغل عليه من هناك.' }));
      m.setFooter(Button({ type: 'primary', label: sending ? 'بيتبعت…' : 'ابعت الطلب', disabled: sending, attrs: { 'data-mk-req-send': '' }, onClick: submit }), Button({ label: 'إلغاء', onClick: () => m.close() }));
    }
    async function submit() {
      if (sending) return;
      errs = {}; if (!String(f.title).trim()) errs.title = 'اكتب عنوان الطلب'; else if (String(f.title).trim().length > 80) errs.title = 'العنوان أقصاه 80 حرف'; if (!f.role) errs.role = 'اختار الدور';
      if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; draw(); return; }
      sending = true; draw();
      const r = await MK().addRequest({ kind, title: f.title, project: f.project, details: f.details, priority: f.priority, followUp: f.followUp, attachments: f.files, assigneeRole: f.role }).catch(() => ({ ok: false, message: 'مافيش اتصال — جرّب تاني' }));
      sending = false;
      if (!r.ok) { if (r.field && ['title', 'followUp'].includes(r.field)) errs[r.field] = r.message; if (r.field === 'assigneeRole') errs.role = r.message; errs._form = r.message || 'تعذّر إرسال الطلب'; draw(); return; }
      m.close(); K.toast('اتبعت الطلب ' + r.id + ' لدور «' + f.role + '» — وموجود في «طلبات الفريق»', 'success'); byLoad(true); R();
    }
    m = U.Modal({ title: 'تقديم طلب ' + A.to, body: [], footer: [] }); m.el.dataset.mkReqForm = kind; draw();
    const first = m.el.querySelector('#mk-rq-title'); if (first) first.focus();
  }
  const askBtn = (kind) => (canAsk() ? Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'تقديم طلب', attrs: { 'data-mk-req-add': kind }, onClick: () => reqForm(kind) }) : null);
  // the requests to this assistant's human, open first — «اللي خلص» folded
  function reqsCard(kind) {
    const A = AGENTS[kind]; const L = reqsOf(kind); const open = (L || []).filter((q) => q.open); const done = (L || []).filter((q) => !q.open).slice(0, 10);
    return Card('طلبات ' + A.name + ' (' + K.n0(open.length) + ')', 'مين طلب وإمتى · الشغل والردود من «طلبات الفريق»',
      [L ? (open.length ? h('div', { class: 'mk-list', 'data-mk-reqs': kind }, open.map(reqItem)) : K.Empty('مفيش طلبات مفتوحة', kind === 'designer' ? 'اطلب بوست أو فيديو أو نسخة جديدة لإعلان.' : kind === 'dev' ? 'اطلب صفحة أو تعديل على الموقع أو السيستم.' : 'اطلب حملة أو مراجعة لحملة شغالة.')) : K.Empty('بيحمّل…', ''),
        done.length ? h('details', { class: 'mk-done' }, h('summary', { class: 't-small help' }, 'اللي خلص (' + K.n0(done.length) + ')'), h('div', { class: 'mk-list' }, done.map(reqItem))) : null,
        kind === 'designer' ? U.InlineNote({ children: 'اقتراح «نسخة جديدة» من الميديا باير لما يتوافق عليه بيتحط هنا طلب لوحده.' }) : kind === 'dev' ? U.InlineNote({ children: 'المبرمج مايقدرش ينشر على الموقع اللايف من غير موافقتك.' }) : null],
      askBtn(kind));
  }
  // ---------- «آخر التريندات» (comments decision 69 — the owner 15 Nov: «يجمعلي اخر التريندات من مواقع بتنزل التريندات تبقي في جدول
  // منظم و يبقي في عمود للموقع ال source و خانة للنوع ده صورة ولا فيديو»): the designer's section — the rows the server found on
  // the web (Claude's web search, ai-content `trends`), newest first: the trend, its kind, the site it came from (a link) and the
  // day; «حدّث التريندات» asks what the team cares about first (the instructions popup) and brings a new batch ----------
  const TR = { at: 0, busy: false, asking: false };
  const dayOf = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d); };
  function trLoad(force) {
    if (!MK() || !MK().trends || !can().view || TR.busy || (!force && TR.at && Date.now() - TR.at < 60000)) return;
    TR.busy = true;
    const again = () => { if (here() && (st.view === 'hub' || window.IBPages.current === 'ai') && !document.querySelector('.scrim')) R(); };
    MK().trends(force).then(() => { TR.at = Date.now(); TR.busy = false; again();
      // the rows that still have no picture get one now (once a session) — not only after «حدّث التريندات»
      if (MK().trendThumbsFill) MK().trendThumbsFill().then((r) => { if (r && r.changed) again(); }); });
  }
  async function trRefresh() {
    if (TR.asking) return;
    const a = await window.IBAIAsk({ title: 'حدّث التريندات', intro: 'هيدوّر على تيك توك وإنستجرام وفيسبوك على الفيديوهات والبوستات اللي ماشية دلوقتي بتاجز مجالك (من الإعدادات)، وكل واحد بصورته ولينكه. لو مهتم بحاجة معينة اكتبها (مثلًا: هدايا الشتا) — أو سيبها فاضية.' });
    if (!a) return;
    TR.asking = true; R();
    const pill = K.busy ? K.busy('بندوّر على آخر التريندات… ممكن ياخد دقيقة') : null;
    const r = await MK().trendsRefresh(a.notes || '');
    TR.asking = false; TR.at = Date.now();
    if (!r.ok) { if (pill) pill.fail(r.message); else K.toast(r.message, 'error'); R(); return; }
    // ش39: what Instagram's official hashtag search said (its feature waits for Meta's approval — the rest came from the web search)
    const igNote = r.ig && r.ig.off === 'permission' ? ' — إنستجرام الرسمي مستني موافقة ميتا على «Instagram Public Content Access»' : r.ig && r.ig.off === 'not_linked' ? ' — إنستجرام الرسمي محتاج ربط صفحة الفيسبوك بحساب الإنستجرام من الإعدادات' : r.ig && r.ig.off === 'token' ? ' — ربط إنستجرام محتاج يتعمل تاني من الإعدادات' : '';
    if (pill) pill.done('اتحدّثت التريندات — ' + K.n0(r.count) + ' جديد' + igNote); else K.toast('اتحدّثت التريندات' + igNote, 'success');
    R();
  }
  // ش39 (the owner 17 Nov — «عايز بدل الشكل ده يكون زي الصورة التانية [شبكة إنستجرام] و يبقا متقسم فيديوهات و بوستات»، و«التريندات … ليها علاقة
  // بالمجال بتاعي و اقدر اضيف تاجز»): a grid of tiles like Instagram's — «فيديوهات» / «بوستات» tabs and a chip per tag; each tile is the
  // post's picture (kept by the server — ai-images trend_thumbs) with the platform, the numbers and the title on it, opening the post
  // itself in a new tab. The tags and sites are the admin's, in «الإعدادات › تعليمات الذكاء الاصطناعي › المساعدين › المصمم الاصطناعي».
  const TR_PF = { tiktok: ['TikTok', 'tt'], instagram: ['Instagram', 'ig'], facebook: ['Facebook', 'fb'], web: ['', 'web'] };
  const TRV = { tab: 'video', f: { tag: [], pf: [] } };
  const compact = (n) => (n == null ? '' : n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : n >= 1e3 ? (Math.round(n / 100) / 10) + 'K' : String(n));
  function trTile(x) {
    const pf = TR_PF[x.platform] || TR_PF.web; const src = x.thumb ? MK().trendThumbNow(x.thumb) : null;
    const num = x.views != null ? ['eye', compact(x.views)] : x.likes != null ? ['star', compact(x.likes)] : null;
    const copy = can().create ? h('button', { type: 'button', class: 'mk-tile-copy', 'data-mk-copy-trend': String(x.id), title: 'اعمل زيه — كامبين جديدة متملّية والبوست ده مرجع', onClick: (e) => { e.preventDefault(); e.stopPropagation(); copyFrom({ from: 'trend', kind: x.kind, title: x.title, summary: x.summary, url: x.url, platform: x.platform }); } }, Icon('sparkle', 'sm'), h('span', null, 'اعمل زيه')) : null;
    // a video plays where it is on hover (or keyboard focus) — its platform's own muted player over the picture, no clicks on it (the
    // click is the tile's: the post opens in a new tab); it goes when the pointer leaves
    const embed = W.trendEmbed ? W.trendEmbed(x) : null; let tm = 0;
    const play = embed ? (e) => { const a = e.currentTarget; clearTimeout(tm); tm = setTimeout(() => { if (a.querySelector('.mk-tile-play')) return;
      a.classList.add('is-playing'); a.appendChild(h('iframe', { class: 'mk-tile-play', src: embed, title: x.title, tabindex: '-1', loading: 'lazy', allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin', 'aria-hidden': 'true' })); }, 350); } : null;
    const stop = embed ? (e) => { clearTimeout(tm); const a = e.currentTarget; a.classList.remove('is-playing'); a.querySelectorAll('.mk-tile-play').forEach((f) => f.remove()); } : null;
    return h('div', { class: 'mk-tile-box' }, h('a', { class: 'mk-tile' + (src ? '' : ' no-pic') + ' pf-' + pf[1], href: x.url, 'data-mk-embed': embed ? '' : null, onMouseenter: play, onMouseleave: stop, onFocus: play, onBlur: stop, target: '_blank', rel: 'noopener noreferrer', title: x.title + (x.summary ? ' — ' + x.summary : ''), 'data-mk-trend': String(x.id), 'data-mk-trend-kind': x.kind },
      src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'mk-tile-ph', 'aria-hidden': 'true' }, Icon(x.kind === 'video' ? 'play' : 'image')),
      x.kind === 'video' ? h('span', { class: 'mk-tile-kind', 'aria-label': 'فيديو' }, Icon('play', 'sm')) : null,
      h('span', { class: 'mk-tile-top' }, h('span', { class: 'mk-tile-pf', 'data-mk-trend-src': String(x.id) }, x.platform !== 'web' ? Icon(x.platform, 'sm') : null, pf[0] || x.source), x.tag ? h('span', { class: 'mk-tile-tag' }, '#' + x.tag) : null),
      h('span', { class: 'mk-tile-cap' }, h('b', null, x.title), h('small', null, [x.author, num ? null : x.source !== pf[0] ? x.source : null].filter(Boolean).join(' · ') || ' '), num ? h('span', { class: 'mk-tile-num' }, Icon(num[0], 'sm'), K.Num(num[1])) : null)), copy);
  }
  function trendsCard() {
    trLoad(false);
    if (MK().trendSettings && !MK().trendSettingsNow()) MK().trendSettings().then(() => { if (here() && !document.querySelector('.scrim')) R(); });
    const L = MK().trendsNow ? MK().trendsNow() : []; const ready = !MK().trendsReadyNow || MK().trendsReadyNow();
    const cfg = (MK().trendSettingsNow && MK().trendSettingsNow()) || { tags: [] };
    const all = L || [];
    // the owner 17 Nov («حط التاجز جوة زر الفلتر و حط لو فيه فلاتر تانية محتاجينها»): the kit's «فلتر» — the tag and the platform
    const pass = (f) => (x) => (!f.tag.length || f.tag.includes(x.tag || '')) && (!f.pf.length || f.pf.includes(x.platform));
    const tagged = all.filter(pass(TRV.f));
    const vids = tagged.filter((x) => x.kind === 'video'); const posts = tagged.filter((x) => x.kind !== 'video');
    const shown = TRV.tab === 'video' ? vids : posts;
    const need = shown.filter((x) => x.thumb && !MK().trendThumbNow(x.thumb)).map((x) => x.thumb);
    if (need.length) MK().trendThumbs(need).then((m) => { if (Object.keys(m).length && here() && !document.querySelector('.scrim')) R(); });
    const last = all.length ? dayOf(all[0].at) : null;
    const go = can().create && ready ? Button({ size: 'sm', type: 'primary', icon: 'sparkle', label: TR.asking ? 'بيدوّر…' : 'حدّث التريندات', disabled: TR.asking, attrs: { 'data-mk-trends-go': '' }, onClick: trRefresh }) : null;
    const tabs = h('div', { 'data-mk-trend-tabs': '' }, K.SubTabs({ label: 'نوع التريند', active: TRV.tab, onChange: (id) => { TRV.tab = id; R(); }, items: [{ id: 'video', label: 'فيديوهات', count: String(vids.length) }, { id: 'post', label: 'بوستات', count: String(posts.length) }] }));
    const tags = [...new Set(cfg.tags.concat(all.map((x) => x.tag).filter(Boolean)))];
    const pfs = Object.keys(TR_PF).filter((k) => all.some((x) => x.platform === k));
    const groups = [tags.length ? { key: 'tag', label: 'التاج', options: tags.map((t) => [t, '#' + t]) } : null,
      pfs.length ? { key: 'pf', label: 'المنصة', options: pfs.map((k) => [k, TR_PF[k][0] || 'مواقع']) } : null].filter(Boolean);
    const fbtn = groups.length && K.FilterMenu ? K.FilterMenu({ id: 'mk-trends', label: 'فلتر التريندات', noun: 'تريند', groups, value: TRV.f,
      count: (d) => all.filter(pass({ tag: d.tag || [], pf: d.pf || [] })).filter((x) => (TRV.tab === 'video') === (x.kind === 'video')).length,
      onApply: (d) => { TRV.f = { tag: (d.tag || []).slice(), pf: (d.pf || []).slice() }; R(); } }) : null;
    const chips = h('div', { class: 'mk-trend-bar', 'data-mk-trend-filter': '' }, tabs, fbtn);
    const picked = TRV.f.tag.length + TRV.f.pf.length;
    const set = window.IBDirectory && window.IBDirectory.me && (window.IBDirectory.me() || {}).role_id === 'admin'
      ? Button({ size: 'sm', type: 'text', icon: 'gear', label: 'التاجز والمصادر', attrs: { 'data-mk-trends-settings': '' }, onClick: () => { const s2 = window.IBPages.all().settings; if (s2 && s2.api && s2.api.openAgents) s2.api.openAgents('designer'); else location.hash = '#settings-ai'; } }) : null;
    const body = !L ? [K.Empty('بيحمّل…', '')] : !ready ? [U.InlineNote({ children: 'القسم ده مستني تحديث قاعدة البيانات — هيشتغل بعد التحديث الجاي.' })]
      : !all.length ? [K.Empty('لسه مفيش تريندات', can().create ? (cfg.tags.length ? 'دوس «حدّث التريندات» — بيدوّر على تيك توك وإنستجرام وفيسبوك بالتاجز بتاعتك.' : 'دوس «حدّث التريندات»' + (set ? '، وحط تاجز مجالك من «التاجز والمصادر» عشان يجيب فيديوهات وبوستات ليها علاقة بيه.' : '.')) : 'اللي معاه «التسويق: إنشاء» بيحدّثها.')]
      : [chips, shown.length ? h('div', { class: 'mk-reels' + (TRV.tab === 'video' ? ' is-video' : ''), 'data-mk-reels': TRV.tab }, shown.map(trTile))
        : K.Empty(TRV.tab === 'video' ? 'مفيش فيديوهات' + (picked ? ' بالفلتر ده' : '') + ' لسه' : 'مفيش بوستات' + (picked ? ' بالفلتر ده' : '') + ' لسه', picked ? 'غيّر الفلتر أو حدّث التريندات.' : 'حدّث التريندات.'),
        h('p', { class: 't-small help', style: 'margin:0' }, (cfg.tags.length ? 'بالتاجز: ' + cfg.tags.map((t) => '#' + t).join(' ') + ' — من تيك توك وإنستجرام وفيسبوك. ' : '') + 'كل كارت بيفتح البوست نفسه في تاب جديد — راجعه قبل ما تبني عليه. التحديث على سقف الـ AI الشهري.')];
    return Card('آخر التريندات', last ? 'آخر تحديث ' + D2(last) + (cfg.tags.length ? ' · فيديوهات وبوستات بتاجز مجالك' : ' · من مواقع بتنشر التريندات') : 'فيديوهات وبوستات من تيك توك وإنستجرام وفيسبوك',
      body, [set, go].filter(Boolean), 'mk-trends', { noun: 'تريند' });
  }
  // ---------- «إعلانات المنافسين» (comments decision 70 — the owner 15 Nov: «اعملي قسم تاني يبقي فيه اعلانات اللي المنافسين في
  // الميديا باير و يجيبها من [مكتبة إعلانات ميتا]»): the media buyer's second section — the competitors the team follows, each
  // opened in Meta's Ad Library on its running ads (the page's own list by its number, else a search by a word), and a search
  // of the library by any word. Nothing is pulled: the library's API gives commercial ads for the EU / UK only ----------
  const CP = { at: 0, busy: false, q: '', who: '', tag: '', type: '' }; // ش44: the filter bar — a competitor, a tag, video / post
  function cpLoad(force) {
    if (!MK() || !MK().competitors || !can().view || CP.busy || (!force && CP.at && Date.now() - CP.at < 60000)) return;
    CP.busy = true;
    MK().competitors(force).then(() => { CP.at = Date.now(); CP.busy = false; if (here() && (st.view === 'hub' || window.IBPages.current === 'ai') && !document.querySelector('.scrim')) R(); });
  }
  const libLink = (c, label, attrs) => h('a', Object.assign({ class: 'btn btn-default sm mk-lib', href: W.adLibraryUrl(c, 'EG', CP.type), target: '_blank', rel: 'noopener noreferrer', title: 'يفتح مكتبة إعلانات ميتا في تاب جديد' }, attrs || {}), Icon('external', 'sm'), h('span', null, label));
  window.IBCompForm = (x) => compForm(x || null); // ش44: the settings' «المنافسين» opens the same popup
  function compForm(x) {
    const isNew = !x;
    K.form({ title: isNew ? 'منافس جديد' : 'تعديل «' + x.name + '»', submitLabel: isNew ? 'ضيف المنافس' : 'احفظ',
      values: { name: x ? x.name : '', page: x ? (x.pageUrl || x.pageId) : '', keyword: x ? x.keyword : '', note: x ? x.note : '' },
      fields: (f, e, set) => [K.field.text('name', 'اسم المنافس', f, e, set, { required: true, maxlength: 80, placeholder: 'اسم البراند أو الصفحة' }),
        K.field.text('page', 'صفحته على فيسبوك أو إنستجرام', f, e, set, { placeholder: 'لينك الصفحة، أو رقمها (Page ID)', help: 'برقم الصفحة المكتبة بتفتح على إعلاناته هو بالظبط — موجود في الصفحة › About › Page transparency. من غيره بندوّر بالاسم أو كلمة البحث.' }),
        K.field.text('keyword', 'كلمة البحث في المكتبة (اختياري)', f, e, set, { maxlength: 80, placeholder: 'لو فاضية بندوّر باسمه' }),
        K.field.area('note', 'ملاحظة (اختياري)', f, e, set, { rows: 2, maxlength: 300, placeholder: 'بيبيع إيه · بيعلن على إيه' })],
      validate: (f) => { const v = W.competitorRow(f); return v.error ? { [v.error === 'text' ? 'name' : v.error]: { name: 'اكتب اسم المنافس (لحد 80 حرف)', page: 'لينك صفحة فيسبوك أو إنستجرام، أو رقم الصفحة', keyword: 'لحد 80 حرف', note: 'لحد 300 حرف', text: 'من غير < أو >' }[v.error] } : {}; },
      submit: async (f) => { const r = await MK().competitorSave(x ? x.id : null, f); K.toast(r.ok ? (isNew ? 'اتضاف المنافس' : 'اتحفظ') : r.message, r.ok ? 'success' : 'error'); CP.at = Date.now(); R(); } });
  }
  function compRemove(x) {
    K.confirm({ title: 'تشيل «' + x.name + '» من المنافسين؟', text: 'بيتشال من القايمة هنا بس.', okLabel: 'شيله', okType: 'danger',
      onOk: async () => { const r = await MK().competitorArchive(x.id); K.toast(r.ok ? 'اتشال من القايمة' : r.message, r.ok ? 'success' : 'error'); CP.at = Date.now(); R(); } });
  }
  // ش44 (the owner 17 Nov — «بدل شكل جدول اعلانات المنافسين بحاجة شبه الصفحة اللي في الصورة الاولي [مكتبة إعلانات ميتا] و تحتيها اسم المنافس و لينك
  // افتح بيه كل اعلانات المنافس علي ميتا» and the ad tags in the media buyer's settings; he chose «كروت + روابط ميتا»): a card per competitor —
  // its page's picture (Graph's public page picture by the page's number, else its first letter), the name, what the library opens on, the
  // note, and «افتح كل إعلاناته على ميتا»; under them «أقوى الإعلانات بالتاجز» — a chip per tag opening the library on it. No ad is pulled.
  const pagePic = (x) => (/^[0-9]{5,20}$/.test(String(x.pageId || '')) ? 'https://graph.facebook.com/' + x.pageId + '/picture?type=large' : null);
  function compCard(x, edit) {
    const pic = pagePic(x); const letter = h('span', { class: 'mk-cc-letter', 'aria-hidden': 'true' }, (x.name || '؟').trim().charAt(0).toUpperCase());
    const av = h('span', { class: 'mk-cc-av' }, pic ? h('img', { src: pic, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onError: (e) => { e.target.replaceWith(letter); } }) : letter);
    return h('article', { class: 'mk-cc', 'data-mk-comp': String(x.id) },
      h('div', { class: 'mk-cc-top' }, h('span', { class: 'mk-cc-live' }, Icon('check', 'sm'), 'إعلانات شغّالة في مصر'), edit ? K.RowMenu([{ label: 'تعديل', icon: 'edit', run: () => compForm(x) }, { label: 'شيله من القايمة', icon: 'trash', danger: true, run: () => compRemove(x) }], 'خيارات ' + x.name) : null),
      h('div', { class: 'mk-cc-who' }, av, h('div', null, h('b', null, x.name), h('small', null, x.pageId ? 'إعلانات الصفحة نفسها' : 'بحث بـ «' + (x.keyword || x.name) + '»'))),
      x.note ? h('p', { class: 'mk-cc-note' }, x.note) : null,
      h('div', { class: 'mk-cc-acts' }, libLink(x, 'افتح كل إعلاناته على ميتا', { 'data-mk-comp-ads': String(x.id), class: 'btn btn-default mk-lib mk-cc-go' }),
        h('div', { class: 'mk-cc-links' }, x.pageUrl ? h('a', { class: 'mk-out', href: x.pageUrl, target: '_blank', rel: 'noopener noreferrer', title: 'افتح صفحته' }, h('span', null, 'صفحته'), Icon('external', 'sm')) : null,
          can().create ? Button({ size: 'sm', type: 'text', icon: 'sparkle', label: 'اعمل زيه', attrs: { 'data-mk-copy-comp': String(x.id) }, onClick: () => copyFrom({ from: 'competitor', kind: 'post', name: x.name, note: x.note, url: x.pageUrl || '' }) }) : null)));
  }
  function competitorsCard() {
    cpLoad(false);
    if (MK().trendSettings && !MK().trendSettingsNow()) MK().trendSettings().then(() => { if (here() && !document.querySelector('.scrim')) R(); });
    const L = MK().competitorsNow ? MK().competitorsNow() : []; const ready = !MK().competitorsReadyNow || MK().competitorsReadyNow(); const edit = can().create;
    const cfg = (MK().trendSettingsNow && MK().trendSettingsNow()) || { adTags: [] }; const adTags = cfg.adTags || [];
    const inp = h('input', { type: 'text', class: 'input grow', id: 'mk-lib-q', maxlength: '80', placeholder: 'اسم منتج أو براند أو كلمة… (مثلًا: مكرمية)', 'aria-label': 'كلمة البحث في مكتبة الإعلانات', value: CP.q,
      onInput: () => { CP.q = inp.value; const p = inp.selectionStart; R(); const n = document.getElementById('mk-lib-q'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* */ } } },
      onKeydown: (e) => { if (e.key === 'Enter' && inp.value.trim()) { const a = document.querySelector('[data-mk-lib-go]'); if (a) a.click(); } } });
    const go = libLink({ keyword: CP.q }, 'دوّر في المكتبة', { 'data-mk-lib-go': '', 'aria-disabled': String(!CP.q.trim()), class: 'btn btn-default sm mk-lib' + (CP.q.trim() ? '' : ' disabled'), onClick: (e) => { if (!CP.q.trim()) e.preventDefault(); } });
    if (!CP.q.trim()) go.setAttribute('href', '#');
    // the search narrows the cards (name, word, note); the filters: one competitor, one tag, the ads' kind (the library's own media filter)
    const q = CP.q.trim().toLowerCase();
    const shown = (L || []).filter((x) => (!CP.who || String(x.id) === CP.who) && (!q || [x.name, x.keyword, x.note].some((v) => String(v || '').toLowerCase().includes(q))));
    const fsel = (id, label, value, opts, on) => U.Select({ id, label: '', options: opts.map(([v, l]) => ({ value: v, label: l })), value, onChange: (v) => { on(v); R(); } });
    const bar = h('div', { class: 'mk-comp-bar', 'data-mk-comp-filter': '' }, inp, go,
      fsel('mk-cf-who', 'المنافس', CP.who, [['', 'المنافس: الكل']].concat((L || []).map((x) => [String(x.id), x.name])), (v) => { CP.who = v; }),
      fsel('mk-cf-tag', 'التاج', CP.tag, [['', 'التاج: الكل']].concat(adTags.map((t) => [t, t])), (v) => { CP.tag = v; }),
      fsel('mk-cf-type', 'النوع', CP.type, [['', 'النوع: الكل'], ['video', 'فيديو'], ['image', 'بوست (صورة)']], (v) => { CP.type = v; }));
    const isAdmin = window.IBDirectory && window.IBDirectory.me && (window.IBDirectory.me() || {}).role_id === 'admin';
    const tagsBox = h('div', { class: 'mk-strong', 'data-mk-strong': '' }, h('div', { class: 'mk-strong-h' }, h('b', null, 'أقوى الإعلانات بالتاجز'), h('small', null, 'كل تاج بيفتح مكتبة ميتا على الإعلانات الشغّالة بالكلمة دي في مصر — الإعلان اللي شغّال من مدة طويلة غالبًا هو اللي بيجيب نتيجة.')),
      adTags.length ? h('div', { class: 'chips' }, adTags.filter((t) => !CP.tag || t === CP.tag).map((t) => libLink({ keyword: t }, t, { class: 'chip mk-strong-tag', 'data-mk-strong-tag': t }))) : h('p', { class: 't-small help', style: 'margin:0' }, isAdmin ? 'لسه مفيش تاجز — حطها من «الإعدادات › تعليمات الذكاء الاصطناعي › المساعدين › الميديا باير الاصطناعي».' : 'الأدمن بيحط التاجز من الإعدادات.'));
    const set = isAdmin ? Button({ size: 'sm', type: 'text', icon: 'gear', label: 'المنافسين والتاجز', attrs: { 'data-mk-comp-settings': '' }, onClick: () => { const s2 = window.IBPages.all().settings; if (s2 && s2.api && s2.api.openAgents) s2.api.openAgents('buyer'); else location.hash = '#settings-ai'; } }) : null;
    return Card('إعلانات المنافسين', 'من مكتبة إعلانات ميتا · الإعلانات الشغّالة دلوقتي في مصر',
      [!L ? K.Empty('بيحمّل…', '') : !ready ? U.InlineNote({ children: 'القسم ده مستني تحديث قاعدة البيانات — هيشتغل بعد التحديث الجاي.' }) : [
        bar,
        !L.length ? null : shown.length ? h('div', { class: 'mk-comp-grid', 'data-mk-comp-grid': '' }, shown.map((x) => compCard(x, edit))) : K.Empty('مفيش منافس بالبحث أو الفلتر ده', 'غيّر البحث أو الفلتر.'),
        L.length ? null
          : K.Empty('لسه مفيش منافسين', edit ? 'ضيف المنافسين اللي بتتابعهم — كل واحد بيتفتح على إعلاناته الشغّالة في مكتبة ميتا.' : 'اللي معاه «التسويق: إنشاء» بيضيفهم.'),
        tagsBox,
        U.InlineNote({ children: 'الإعلانات بتتفتح في مكتبة إعلانات ميتا نفسها (تاب جديد). ميتا مابتدّيش الإعلانات التجارية بتاعة مصر عن طريق الـ API — للاتحاد الأوروبي وبريطانيا بس — فالسيستم بيفتحلك كل منافس على إعلاناته هناك.' })]],
      [set, edit && ready ? Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'منافس', attrs: { 'data-mk-comp-add': '' }, onClick: () => compForm(null) }) : null].filter(Boolean), 'mk-comp mk-wide', { noun: 'منافس' });
  }

  // ---------- the developer's section (comments decision 71 — the owner 15 Nov: «زودلي قسم المبرمج يجيبله ابديتس للوردر بريس و
  // الاشتراكات بتاعت ورد بريس و الكريديتس»): three cards under the developer's requests — the site's updates (WordPress, the
  // theme and every plugin: installed version → the newest the site knows of; «افحص دلوقتي» = woo-sync wp_updates), the
  // subscriptions of the accounts page with what is left of each (for whoever sees the accounts), and the month's AI credits ----------
  const DV = { at: 0, busy: false, checking: false };
  function dvLoad(force) {
    if (!MK() || !MK().siteCheck || !can().view || DV.busy || (!force && DV.at && Date.now() - DV.at < 60000)) return;
    DV.busy = true;
    Promise.all([MK().siteCheck(force), MK().siteSpeed ? MK().siteSpeed(force) : null, MK().siteSubs(force), MK().aiSpend(force), MK().credits ? MK().credits(true) : null]).then(() => { DV.at = Date.now(); DV.busy = false; if (here() && (st.view === 'hub' || window.IBPages.current === 'ai') && !document.querySelector('.scrim')) R(); });
  }
  async function dvCheck() {
    if (DV.checking) return; DV.checking = true; R();
    const pill = K.busy ? K.busy('بنفحص تحديثات الموقع…') : null;
    const r = await MK().siteCheckRun();
    DV.checking = false; DV.at = Date.now();
    if (!r.ok) { if (pill) pill.fail(r.message); else K.toast(r.message, 'error'); R(); return; }
    const n = Number(r.check.data.updates) || 0;
    if (pill) pill.done(n ? K.n0(n) + ' تحديث مستني' : 'كله محدّث'); else K.toast(n ? K.n0(n) + ' تحديث مستني' : 'كله محدّث', 'success');
    R();
  }
  const verCell = (x) => (x.version ? K.Num(x.version) : '—');
  function updatesCard() {
    const ch = MK().siteCheckNow ? MK().siteCheckNow() : null; const ready = !MK().siteReadyNow || MK().siteReadyNow(); const d = ch && ch.data;
    const st2 = (x) => (x.update ? h('span', { 'data-dv-st': 'update' }, Tag('orange', 'تحديث متاح')) : x.active === false ? h('span', { 'data-dv-st': 'off' }, Tag('neutral', 'مش مفعّل')) : h('span', { 'data-dv-st': 'ok' }, Tag('success', 'محدّث')));
    const row = (kind, x) => [h('b', { 'data-dv-item': x.name }, x.name), kind, verCell(x), x.latest ? K.Num(x.latest) : '—', st2(x)];
    const rows = d ? [].concat(
      d.core && d.core.version ? [row('ووردبريس', { name: 'WordPress', version: d.core.version, latest: d.core.latest, update: d.core.update, active: true })] : [],
      d.theme ? [row('الثيم', d.theme)] : [], (d.plugins || []).map((p) => row('إضافة', p))) : [];
    const n = d ? Number(d.updates) || 0 : 0;
    const sum = d ? h('div', { class: 'mk-dv-sum', 'data-dv-updates': String(n) }, [['WordPress', d.core && d.core.version], ['WooCommerce', d.woo && d.woo.version], ['PHP', d.php]].filter(([, v]) => v).map(([l, v]) => h('span', { class: 'mk-dv-chip' }, h('small', null, l), h('b', null, K.Num(v)))),
      h('span', { class: 'mk-dv-chip ' + (n ? 'warn' : 'ok') }, h('small', null, 'مستني تحديث'), h('b', null, K.n0(n)))) : null;
    const go = can().create ? Button({ size: 'sm', type: 'primary', icon: 'refresh', label: DV.checking ? 'بيفحص…' : 'افحص دلوقتي', disabled: DV.checking, attrs: { 'data-dv-check': '' }, onClick: dvCheck }) : null;
    return Card('تحديثات ووردبريس', d ? 'من تقرير حالة الموقع — ووردبريس والثيم والإضافات' : 'ووردبريس والثيم والإضافات — النسخة اللي على الموقع وآخر نسخة',
      [ch === undefined && PX.loading ? K.Empty('بيحمّل…', '') : !d ? K.Empty('لسه مفيش فحص', can().create ? 'دوس «افحص دلوقتي» — بنقرا تقرير حالة الموقع ونقولك إيه مستني تحديث.' : 'اللي معاه «التسويق: إنشاء» بيفحص.')
        : [sum, U.Table({ cls: 'dt mk-dv-t', headers: ['الاسم', 'النوع', 'النسخة على الموقع', 'آخر نسخة', 'الحالة'], rows }),
          d.core && !d.core.known ? h('p', { class: 't-small help', style: 'margin:0' }, 'ماقدرناش نقرا آخر نسخة ووردبريس من wordpress.org المرة دي — جرّب الفحص تاني.') : null,
          h('p', { class: 't-small help', style: 'margin:0' }, 'الفحص قراية بس — التحديث نفسه بيتعمل من لوحة ووردبريس. «آخر نسخة» هي اللي الموقع نفسه عارفها.' + (ready ? '' : ' (الفحص مش بيتحفظ لحد تحديث قاعدة البيانات الجاي.)'))]],
      go, 'mk-dv mk-wide', { noun: 'عنصر', when: ch && ch.at ? 'آخر فحص ' + agTime(ch.at) : '' });
  }
  const SITE_SUB = /wordpress|ووردبريس|وورد بريس|woo|ووكومرس|plugin|بلجن|إضاف|dokan|wpml|rank ?math|elementor|theme|ثيم|hosting|استضاف|hostinger|دومين|domain|ssl|cdn|cloudflare/i;
  const subLeft = (x) => (x.expired ? 'انتهى من ' + K.n0(Math.abs(x.daysLeft)) + ' يوم' : x.daysLeft === 0 ? 'بينتهي النهاردة' : 'باقي ' + K.n0(x.daysLeft) + ' يوم');
  function subsCard() {
    const L = MK().siteSubsNow ? MK().siteSubsNow() : undefined;
    const openAcc = Button({ size: 'sm', label: 'كل الاشتراكات في الحسابات', iconEnd: 'chevL', attrs: { 'data-dv-subs-all': '' }, onClick: () => { location.hash = 'subscriptions'; } });
    if (L === null) return Card('اشتراكات الموقع', 'من «الحسابات › الاشتراكات»', [K.Empty('محتاجة صلاحية الحسابات', 'الاشتراكات ومواعيد تجديدها بتظهر للي بيشوف صفحة الحسابات.')], null, 'mk-dv-subs');
    const list = (L || []).slice().sort((a, b) => (Number(SITE_SUB.test(b.name)) - Number(SITE_SUB.test(a.name))) || (a.daysLeft - b.daysLeft));
    const due = list.filter((x) => x.due).length;
    return Card('اشتراكات الموقع' + (L ? ' (' + K.n0(list.length) + ')' : ''), due ? K.n0(due) + ' محتاج تجديد · من «الحسابات › الاشتراكات»' : 'من «الحسابات › الاشتراكات» · الموقع والإضافات الأول',
      [L === undefined ? K.Empty('بيحمّل…', '') : list.length ? h('div', { class: 'mk-list', 'data-dv-subs': String(list.length) }, list.map((x) => h('div', { class: 'mk-item', 'data-dv-sub': x.name },
        h('span', { class: 'mk-ic tone-' + (x.expired ? 'error' : x.due ? 'orange' : 'success') }, Icon(x.due ? 'clock' : 'check', 'sm')),
        h('span', { class: 'mk-txt' }, h('b', null, x.name), h('small', null, U.num('بينتهي ' + D2(x.ends) + (x.amount ? ' · آخر دفعة ' + K.n0(x.amount) + ' ج.م' : '')))),
        Tag(x.expired ? 'error' : x.due ? 'orange' : 'success', subLeft(x)))))
        : K.Empty('مفيش اشتراكات متسجلة', 'الاشتراك بيتسجل مصروف من نوع «الاشتراكات» في الحسابات بتاريخ انتهائه.')],
      L && L !== null ? openAcc : null, 'mk-dv-subs');
  }
  function creditsCard() {
    const w = wallet(); const sp = MK().aiSpendNow ? MK().aiSpendNow() : undefined;
    const bar = (used, cap) => (cap ? h('div', { class: 'mk-dv-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(cap), 'aria-valuenow': String(Math.min(used, cap)) }, h('i', { class: used / cap >= 0.9 ? 'hot' : '', style: 'width:' + Math.min(100, Math.round(used / cap * 100)) + '%' })) : null);
    const usd = (v) => '$' + (Math.round(v * 100) / 100).toFixed(2);
    const items = [h('div', { class: 'mk-dv-cr', 'data-dv-credit': 'images' }, h('div', { class: 'mk-dv-cr-h' }, h('b', null, 'كريدت الصور (Magnific API)'), h('span', { class: 't-small help' }, 'الشهر ده')),
      h('div', { class: 'mk-dv-cr-n' }, K.Num(K.n0(w.used)), h('small', null, w.cap == null ? ' كريديت اتصرف · من غير سقف' : ' من ' + K.n0(w.cap) + ' · باقي ' + K.n0(w.balance))), bar(w.used, w.cap))];
    if (sp) items.push(h('div', { class: 'mk-dv-cr', 'data-dv-credit': 'ai' }, h('div', { class: 'mk-dv-cr-h' }, h('b', null, 'الـ AI للكتابة والبحث (Claude)'), h('span', { class: 't-small help' }, 'الشهر ده · ' + K.n0(sp.runs) + ' نداء')),
      h('div', { class: 'mk-dv-cr-n' }, K.Num(usd(sp.used)), h('small', null, sp.cap == null ? ' اتصرف · من غير سقف' : ' من ' + usd(sp.cap) + ' · باقي ' + usd(Math.max(0, sp.cap - sp.used)))), bar(sp.used, sp.cap)));
    return Card('الكريدت', 'اللي اتصرف الشهر ده قصاد السقف', [h('div', { class: 'mk-dv-crs' }, items),
      h('p', { class: 't-small help', style: 'margin:0' }, sp === null && !isAdmin() ? 'صرف الـ AI بالدولار بيظهر للأدمن.' : 'السقوف بتتغيّر من الإعدادات › الذكاء الاصطناعي. فيديو وصور Magnific من الموقع نفسه (Unlimited) على حساب Magnific مش هنا.')], null, 'mk-dv-credits');
  }
  // ش45 decision 1 — «أداء الموقع»: the last Google PageSpeed run (the server's row; «افحص دلوقتي» = woo-sync site_speed, a minute or so)
  const SPEED_PAGE = { home: 'الصفحة الرئيسية', product: 'صفحة منتج', shop: 'صفحة المتجر' };
  const speedTone = (v) => (v == null ? 'neutral' : v >= 90 ? 'success' : v >= 50 ? 'orange' : 'error');
  const secs = (ms) => (ms == null ? '—' : K.Num((Math.round(ms / 100) / 10).toFixed(1) + ' ث'));
  const mb = (b) => (b == null ? '—' : K.Num((Math.round(b / 104857.6) / 10).toFixed(1) + ' ميجا'));
  async function speedCheck() {
    if (DV.speeding) return; DV.speeding = true; R();
    const pill = K.busy ? K.busy('بنفحص سرعة الموقع من جوجل… (ممكن تاخد دقيقة)') : null;
    const r = await MK().siteSpeedRun();
    DV.speeding = false;
    if (!r.ok) { if (pill) pill.fail(r.message); else K.toast(r.message, 'error'); R(); return; }
    const sc = r.check.data.score;
    if (pill) pill.done(sc == null ? 'خلص الفحص' : 'أقل درجة على الموبايل ' + K.n0(sc) + '/100'); else K.toast('خلص الفحص', 'success');
    R();
  }
  function speedCard() {
    const ch = MK().siteSpeedNow ? MK().siteSpeedNow() : undefined; const d = ch && ch.data;
    const score = (x) => (x && x.score != null ? h('span', { 'data-sp-score': String(x.score) }, Tag(speedTone(x.score), K.n0(x.score) + '/100')) : h('span', { class: 't-small help' }, x && x.error ? 'ماردش' : '—'));
    const rows = d && Array.isArray(d.pages) ? d.pages.flatMap((p) => ['mobile', 'desktop'].map((dev) => { const x = p[dev]; const lab = x && x.lab ? x.lab : {};
      return [h('b', { 'data-sp-page': p.kind + ':' + dev }, SPEED_PAGE[p.kind] || p.kind), dev === 'mobile' ? 'موبايل' : 'كمبيوتر', score(x), secs(lab.lcp), lab.tbt == null ? '—' : K.Num(K.n0(lab.tbt) + ' م.ث'), lab.cls == null ? '—' : K.Num(String(lab.cls)), mb(lab.bytes)]; })) : [];
    const home = d && Array.isArray(d.pages) ? (d.pages.find((p) => p.mobile && p.mobile.opps && p.mobile.opps.length) || {}).mobile : null;
    const fixes = home && home.opps.length ? h('div', { class: 'mk-list', 'data-sp-fixes': String(home.opps.length) }, home.opps.map((o) => h('div', { class: 'mk-item' },
      h('span', { class: 'mk-ic tone-orange' }, Icon('zap', 'sm')), h('span', { class: 'mk-txt' }, h('b', { dir: 'ltr' }, o.title), h('small', null, 'ممكن يوفّر ' + (Math.round(o.ms / 100) / 10) + ' ثانية'))))) : null;
    const field = d && Array.isArray(d.pages) ? (d.pages.find((p) => p.mobile && p.mobile.field) || {}).mobile : null;
    const real = field && field.field ? h('p', { class: 't-small', style: 'margin:0', 'data-sp-real': '' }, 'تجربة الزوار الحقيقيين (جوجل، آخر 28 يوم): ' + [field.field.lcp != null ? 'LCP ' + (Math.round(field.field.lcp / 100) / 10) + ' ث' : '', field.field.inp != null ? 'INP ' + field.field.inp + ' م.ث' : '', field.field.cls != null ? 'CLS ' + field.field.cls : ''].filter(Boolean).join(' · ')) : null;
    const go = can().create ? Button({ size: 'sm', type: 'primary', icon: 'refresh', label: DV.speeding ? 'بيفحص…' : 'افحص دلوقتي', disabled: !!DV.speeding, attrs: { 'data-sp-check': '' }, onClick: speedCheck }) : null;
    return Card('أداء الموقع', d ? 'من Google PageSpeed — الدرجة من 100 لكل صفحة على الموبايل والكمبيوتر' : 'سرعة الموقع من Google PageSpeed — الرئيسية وصفحة منتج وصفحة المتجر',
      [ch === undefined ? K.Empty('بيحمّل…', '') : !d ? K.Empty('لسه مفيش فحص', can().create ? 'دوس «افحص دلوقتي» — جوجل بيفحص الموقع ويقولك الدرجة وإيه اللي مبطّأه. والفحص بيتعمل لوحده كل يوم الصبح.' : 'الفحص بيتعمل لوحده كل يوم الصبح.')
        : [U.Table({ cls: 'dt mk-sp-t', headers: ['الصفحة', 'الجهاز', 'الدرجة', 'أكبر عنصر (LCP)', 'وقت التعليق (TBT)', 'الاهتزاز (CLS)', 'حجم الصفحة'], rows }), real,
          fixes ? h('div', null, h('b', { class: 't-small' }, 'أكبر حاجات مبطّأة الموقع (الموبايل)'), fixes) : null,
          h('p', { class: 't-small help', style: 'margin:0' }, 'الفحص قراية بس من جوجل — اسأل «المبرمج» هنا عن أي رقم أو تصليح، والتصليح نفسه بيتعمل على الـ staging الأول.')]],
      go, 'mk-sp mk-wide', { noun: 'صفحة', when: ch && ch.at ? 'آخر فحص ' + agTime(ch.at) : '' });
  }
  // the owner 17 Nov — «الميديا باير يقدر يبص علي البيكسل و لو في حاجة محتاجة تتصلح يقدر يساعدني نصلحها»: the last check (mkt-ads `pixel`
  // — read only on Meta and the site), each issue with its fix, and «ساعدني أصلحها» writes the question in the buyer's chat box (the member
  // sends it); the check also runs once a day and notes the buyer in the bell when something is broken
  const PX = { loading: false, tried: false, running: false };
  async function pixelRun() {
    if (PX.running) return; PX.running = true; R();
    const pill = K.busy ? K.busy('بنفحص البيكسل على ميتا والموقع…') : null;
    const r = await MK().pixelRun();
    PX.running = false;
    if (!r.ok) { if (pill) pill.fail(r.message); else K.toast(r.message, 'error'); R(); return; }
    const bad = (r.check.data.issues || []).filter((i) => i.level === 'bad').length;
    if (pill) pill.done(bad ? K.n0(bad) + ' مشكلة لازم تتصلح' : 'البيكسل تمام'); else K.toast('خلص الفحص', 'success');
    R();
  }
  function pixelCard() {
    if (!MK() || !MK().pixel) return null;
    const ch = MK().pixelNow();
    if (ch === undefined && !PX.loading && !PX.tried) { PX.loading = true; PX.tried = true; MK().pixel(false).then(() => { PX.loading = false; if (MK().pixelNow() !== undefined && here() && window.IBPages.current === 'ai' && !document.querySelector('.scrim')) R(); }); }
    const d = ch && ch.data; const issues = d && Array.isArray(d.issues) ? d.issues : [];
    const p = d && d.pixel;
    const evs = d && Array.isArray(d.events) ? h('div', { class: 'mk-chips', 'data-px-events': '' }, d.events.map((e) => h('span', { 'data-px-event': e.name }, Tag(e.count ? 'success' : 'error', e.name + ' · ' + K.n0(e.count))))) : null;
    const list = issues.length ? h('div', { class: 'mk-list', 'data-px-issues': String(issues.length) }, issues.map((i) => h('div', { class: 'mk-item', 'data-px-issue': i.key },
      h('span', { class: 'mk-ic tone-' + (i.level === 'bad' ? 'error' : 'orange') }, Icon(i.level === 'bad' ? 'alert' : 'zap', 'sm')),
      h('span', { class: 'mk-txt' }, h('b', null, i.title), h('small', null, i.detail), h('small', { class: 'help' }, 'الحل: ' + i.fix))))) : d ? K.Empty('البيكسل شغّال تمام', 'مفيش مشاكل في آخر فحص.') : null;
    const help = issues.length ? Button({ size: 'sm', icon: 'sparkle', label: 'ساعدني أصلحها', attrs: { 'data-px-help': '' },
      onClick: () => askAgent('buyer', 'افحص معايا مشاكل البيكسل اللي طلعت (' + issues.slice(0, 4).map((i) => i.title).join('، ') + ') وقولّي أصلحها خطوة خطوة.') }) : null;
    const go = Button({ size: 'sm', type: 'primary', icon: 'refresh', label: PX.running ? 'بيفحص…' : 'افحص البيكسل', disabled: !!PX.running, attrs: { 'data-px-check': '' }, onClick: pixelRun });
    return Card('البيكسل', p ? 'بيكسل ميتا ' + p.id + (p.name ? ' — ' + p.name : '') + ' · الأحداث آخر 7 أيام' : 'بيكسل ميتا: بيبعت؟ متركّب صح على الموقع؟ المشتريات بتتعد زي الأوردرات؟',
      [ch === undefined ? K.Empty('بيحمّل…', '') : !d ? K.Empty('لسه مفيش فحص', 'دوس «افحص البيكسل» — بقرا حساب ميتا وصفحة الموقع والأوردرات وأقولك إيه اللي محتاج يتصلح. والفحص بيتعمل لوحده كل يوم.')
        : [evs, d.purchases != null ? h('p', { class: 't-small', style: 'margin:0', 'data-px-buys': '' }, K.n0(d.purchases) + ' Purchase على ميتا قصاد ' + K.n0(d.orders) + ' أوردر على الموقع في نفس الأيام') : null, list,
          h('p', { class: 't-small help', style: 'margin:0' }, 'الفحص قراية بس — التصليح من Events Manager أو إضافة البيكسل في ووردبريس، وأنا معاك خطوة خطوة في الشات.')]],
      [help, go].filter(Boolean), 'mk-px mk-wide', { when: ch && ch.at ? 'آخر فحص ' + agTime(ch.at) : '' });
  }
  function devCards() { dvLoad(false); return [speedCard(), updatesCard(), h('div', { class: 'grid2 mk-agent-under' }, subsCard(), creditsCard())]; }
  // ---------- «الذكاء الاصطناعي» (0120 — the owner 17 Nov: «انقل مساعدين الذكاء الاصطناعي من جوه التسويق و حطها في قسم رئيسي…
  // ضيف المخزن الذكي و خدمة العملاء الذكية و خدمة المبتكرين الذكية… المحاسب الذكي و الموارد البشرية الذكية… امكانية لاضافة مساعدين
  // جدد»): a tab per assistant the member sees (the registry — IBMarketing.agents), the same chat, and under it the assistant's own cards
  // (the buyer's decisions and rules, the designer's trends, the developer's site); the admin adds and edits assistants here too ----------
  const goAi = (a) => { if (a) BY.aiTab = a; const hs = 'ai' + (BY.aiTab ? '-' + BY.aiTab : ''); if (location.hash.slice(1) === hs) R(); else location.hash = '#' + hs; };
  // 0124 (agents-brain decision 1): a note's click in the bell — the assistant's tab on the chat the server made for it (the list reloads
  // so the new chat is in the side bar)
  window.IBAiOpen = (a, chatId) => { BY.aiTab = a; AG.chats[a] = null; agLoad(a, true); agOpen(a, chatId); goAi(a); };
  // the plan 2026-11-17-stores-single.md decision 3: single-seller mode has no makers — «خدمة المبتكرين الذكية» stays out
  const singleSell = () => !!(window.IBSettings && window.IBSettings.single && window.IBSettings.single());
  const aiList = () => { const L = (MK() && MK().agentsNow && MK().agentsNow()) || null; return L ? L.filter((x) => !x.archived && !(x.id === 'makers' && singleSell())) : null; };
  let aiAsked = false;
  function agentForm(x) {
    const MKa = MK(); const P = MKa.AGENT_PERMS || []; const S2 = MKa.AGENT_SEES || []; const T = TKD(); const roles = (T && T.ROLES) || [];
    const ICONS = ['sparkle', 'bot', 'chart', 'image', 'code', 'tag', 'stock', 'truck', 'headset', 'msg', 'users', 'wallet', 'briefcase', 'package', 'box', 'megaphone', 'ticket', 'calendar', 'mail', 'star', 'zap', 'sliders', 'file', 'sheet'];
    const builtin = !!(x && x.builtin);
    K.form({ title: x ? 'تعديل «' + x.name + '»' : 'مساعد جديد', wide: true, submitLabel: x ? 'احفظ' : 'ضيف المساعد',
      note: builtin ? 'مساعد السيستم: الصفحة اللي بتفتحه والبيانات اللي بيقراها ثابتين — الاسم والأيقونة والدور والكلام بيتغيّروا.' : 'المساعد بيقرا البيانات اللي تختارها بصلاحيات اللي بيكلّمه، ومابينفّذش حاجة — الشغل الحقيقي «تقديم طلب» للدور.',
      values: { name: x ? x.name : '', icon: x ? x.icon : 'sparkle', perm: x ? x.perm : 'orders.view', sees: x ? x.sees.slice() : [], role: x && x.role ? x.role : '', about: x ? x.about : '', instructions: x ? x.instructions : '' },
      fields: (f, e, set) => [K.two(K.field.text('name', 'الاسم', f, e, set, { required: true, placeholder: 'مثلًا: مساعد المنتجات' }), K.field.select('icon', 'الأيقونة', ICONS.map((v) => ({ value: v, label: v })), f, e, set)),
        builtin ? null : K.field.select('perm', 'بيظهر للي معاه «عرض»', P.map(([v, l]) => ({ value: v, label: l })), f, e, set),
        builtin ? null : U.FieldShell({ id: 'ag-sees', label: 'البيانات اللي بيقراها (آخر 30 يوم، بصلاحيات اللي بيكلّمه)' }, h('div', { class: 'chips', 'data-ag-sees': '' }, S2.map(([v, l]) => h('button', { type: 'button', class: 'chip' + (f.sees.includes(v) ? ' on' : ''), 'aria-pressed': String(f.sees.includes(v)), 'data-ag-see': v,
          onClick: () => set('sees', f.sees.includes(v) ? f.sees.filter((k) => k !== v) : f.sees.concat(v), true) }, l)))),
        K.field.select('role', 'الطلبات بتروح لدور', [{ value: '', label: ADMIN_TEAM() }].concat(roles.map((r) => ({ value: r, label: r }))), f, e, set),
        K.field.area('about', 'بيعمل إيه (سطر بيظهر تحت اسمه)', f, e, set, { rows: 2 }),
        K.field.area('instructions', 'التعليمات', f, e, set, { rows: 4, help: 'بيقراها في كل رسالة — والقواعد والسكيلز من «الإعدادات › الذكاء الاصطناعي › المساعدين».' })].filter(Boolean),
      validate: (f) => { const n = String(f.name || '').trim(); if (n.length < 2 || n.length > 40) return { name: 'من 2 لـ 40 حرف' }; if (/[<>]/.test(n + f.about + f.instructions)) return { about: 'من غير < أو >' }; if (String(f.about || '').length > 300) return { about: 'لحد 300 حرف' }; return {}; },
      submit: async (f, md) => {
        const body = { name: f.name, icon: f.icon, role: f.role, about: f.about, instructions: f.instructions };
        if (x) body.id = x.id; if (!builtin) { body.perm = f.perm; body.sees = f.sees; }
        const r = await MKa.agentSave(body); if (!r.ok) { K.toast(r.message, 'error'); return; }
        md.close(); K.toast(x ? 'اتحفظ' : 'اتضاف «' + String(f.name).trim() + '»', 'success'); if (!x && r.id) goAi(r.id); else R(); } });
  }
  function agentArchiveAsk(x) {
    K.confirm({ title: 'تأرشف «' + x.name + '»؟', text: 'هيختفي من «الذكاء الاصطناعي» عند الكل، وشاتاته بتفضل محفوظة — وتقدر ترجّعه من الإعدادات.', okType: 'danger', okLabel: 'أرشف',
      onOk: async () => { const r = await MK().agentArchive(x.id, true); if (!r.ok) { K.toast(r.message, 'error'); return; } K.toast('اتأرشف', 'success'); BY.aiTab = null; goAi(null); } });
  }
  function aiView() {
    const MKa = MK(); if (!MKa) return [K.PageHead('الذكاء الاصطناعي', null, []), K.Empty('مش متاح دلوقتي', 'جرّب تعمل رفريش.')];
    const L = aiList();
    if (!L) { if (!aiAsked) { aiAsked = true; MKa.agents(false).then((r) => { aiAsked = false; if (!r.ok) K.toast(r.message, 'error'); if (window.IBPages.current === 'ai') R(); }); } return [K.PageHead('الذكاء الاصطناعي', null, []), K.Empty('بنحمّل…', 'لحظة واحدة')]; }
    const add = isAdmin() ? Button({ type: 'primary', icon: 'plus', label: 'مساعد جديد', attrs: { 'data-ai-add': '' }, onClick: () => agentForm(null) }) : null;
    if (!L.length) return [K.PageHead('الذكاء الاصطناعي', null, [add].filter(Boolean)), K.Empty('مفيش مساعدين متاحين لدورك', 'كل مساعد بيظهر للي معاه صلاحية «عرض» صفحته — كلّم الأدمن لو محتاج واحد.')];
    if (!BY.aiTab || !L.some((x) => x.id === BY.aiTab)) BY.aiTab = L[0].id;
    const a = BY.aiTab; const me = L.find((x) => x.id === a);
    if (a === 'buyer' || a === 'designer' || a === 'dev') byLoad(false);
    const cnt = (kind) => (reqsOf(kind) || []).filter((q) => q.open).length || null;
    const tabs = K.MainTabs({ items: L.map((x) => ({ id: x.id, label: x.name, count: x.id === 'buyer' ? (byPending().length || null) : cnt(x.id) })), active: a, onChange: (id) => goAi(id), label: 'المساعدين' });
    const edit = isAdmin() ? K.RowMenu([{ label: 'تعديل المساعد', icon: 'edit', run: () => agentForm(me) }, me.builtin ? null : { label: 'أرشف المساعد', icon: 'trash', danger: true, run: () => agentArchiveAsk(me) }].filter(Boolean), 'إجراءات ' + me.name) : null;
    const chat = agentChat(a);
    let under = [reqsCard(a)];
    if (a === 'designer') under = [reqsCard(a), trendsCard()];
    else if (a === 'dev') under = [reqsCard(a)].concat(devCards());
    else if (a === 'buyer') {
      const pend = byPending(); const past = (BY.sugg || []).filter((x) => x.status !== 'pending').slice(0, 8);
      under = [h('div', { class: 'grid2 mk-agent-under' },
        Card('مستني موافقتك (' + K.n0(pend.length) + ')', 'وافق أو ارفض · كل إجراء بيتسجل في سجل النشاط', [BY.sugg ? (pend.length ? h('div', { class: 'mk-list', 'data-mk-pending': String(pend.length) }, pend.map((x) => sgItem(x, () => openSugg(x)))) : K.Empty('مفيش حاجة مستنية', 'الاقتراحات بتتجدد مع كل مزامنة لأرقام ميتا.')) : K.Empty('بيحمّل…', ''),
          h('p', { class: 't-small help', style: 'margin:0' }, 'الضغط على اقتراح بيفتحه: الأرقام · السبب · «وافق» / «ارفض» / «عدّل»')]),
        past.length ? Card('آخر القرارات', 'آخر 30 يوم', [h('div', { class: 'mk-list', 'data-mk-past': String(past.length) }, past.map((x) => h('button', { type: 'button', class: 'mk-item', 'data-mk-sugg': String(x.id), onClick: () => openSugg(x) }, h('span', { class: 'mk-txt' }, h('b', null, x.title), h('small', null, U.num(decidedLine(x)))), Tag((SG_ST[x.status] || SG_ST.pending)[1], (SG_ST[x.status] || SG_ST.pending)[0]))))]) : null,
        reqsCard('buyer'), rulesCard()), pixelCard(), competitorsCard()].filter(Boolean);
    }
    const panel = h('div', { class: 'panel', role: 'tabpanel', 'data-ai-agent': a }, chat, ...under.filter(Boolean));
    return [K.PageHead('الذكاء الاصطناعي', me.about || null, [edit, add].filter(Boolean)), tabs, panel];
  }
  // the overview's card (the v5): the open suggestions, the whole list from the assistants' tab
  function suggCard() {
    byLoad(false); const pend = byPending(); const r = BY.rules;
    return Card('اقتراحات الميديا باير', 'مستنية موافقتك · من قواعد ثابتة على أرقامك الحقيقية بعد كل مزامنة', [BY.sugg ? (pend.length ? h('div', { class: 'mk-list', 'data-mk-pending': String(pend.length) }, pend.slice(0, 5).map((x) => sgItem(x, () => openSugg(x)))) : K.Empty('مفيش اقتراحات مستنية', 'الميديا باير بيبعت اقتراحاته مع كل مزامنة، وتقرير يومي الساعة ' + (r ? String(r.reportHour).padStart(2, '0') + ':00' : '9:00') + ' على الجرس.')) : K.Empty('بيحمّل…', ''),
      Button({ type: 'text', size: 'sm', label: 'كل الاقتراحات (' + K.n0(pend.length) + ') والقواعد', iconEnd: 'chevL', attrs: { 'data-mk-all-sugg': '' }, onClick: () => goAi('buyer') })], null, 'mk-wide');
  }

  // ---------- the page ----------
  function headActs() {
    const tab = TABS.find(([id]) => id === st.tab) || [];
    const ads = st.tab === 'overview' || st.tab === 'reports';
    // the owner 12 Nov — «خلي شكل فلتر التاريخ واحد في السيستم كله، اللي فيه الـ calendar»: the reports' period picker itself (its presets
    // today / this week / this month and the calendar), once in the header; the cards still compare with the period before it
    const per = ads && RB().rangeField ? h('span', { 'data-mk-range': '' }, RB().rangeField('reports')) : null;
    const plat = ads ? U.Select({ id: 'mk-plat', label: '', value: M.plat, options: PLATS.map(([k, l]) => ({ value: k, label: 'المنصة: ' + l })), onChange: (v) => { M.plat = v; R(); } }) : null;
    return [K.PanelButton('marketing:' + st.tab, 'التسويق — ' + tab[1], () => document.querySelector('#pg-marketing .panel'), R), per, plat].filter(Boolean); // decision 74: the reports tab is cards now — «تخصيص اللوحة» on it too
  }
  function view() {
    if (!MK() || !can().view) return [K.PageHead('التسويق', null, []), K.Empty('مفيش صلاحية', 'صفحة التسويق محتاجة صلاحية «التسويق — عرض».')];
    if (MK().state() === 'idle') { MK().ensure().then(() => { if (window.IBPages.current === 'marketing') R(); }); }
    if (st.view === 'campaign' && st.step > 1 && !camp.id) { st.view = 'hub'; st.tab = 'create'; }
    if (st.view === 'campaign') return campaign();
    const tabs = K.MainTabs({ items: TABS.map(([id, label]) => ({ id, label })), active: st.tab, onChange: (id) => go('marketing-' + id), label: 'أقسام التسويق' });
    const loading = MK().state() !== 'ready';
    const body = loading ? [K.Empty('بيحمّل…', 'لحظة واحدة')] : ({ overview: overviewTab, create: hub, publog: publogTab, calendar: calendarTab, templates: templatesTab, reports: reportsTab })[st.tab]();
    const panel = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...body);
    if (!loading) setTimeout(() => K.applyPanelPrefs('marketing:' + st.tab, panel), 0);
    return [K.PageHead('التسويق', null, headActs()), tabs, panel];
  }
  // a change from elsewhere (the live line) redraws the tabs — never the open wizard or an open popup
  document.addEventListener('ib:tickets', () => { if (window.IBPages.current !== 'marketing' || st.view !== 'hub' || !BY.reqs) return; if (document.querySelector('.scrim')) return; R(); }); // 0082: the requests are team requests
  document.addEventListener('ib:marketing', () => { if (window.IBPages.current !== 'marketing' || st.view !== 'hub') return; if (document.querySelector('.scrim')) return; R(); });

  window.IBAdsLinkUI = { popup: linkPopup, unlink: unlinkAsk }; // owner batch 2 decision 12: the settings page opens them
  // 0120: «الذكاء الاصطناعي» — #ai / #ai-<assistant>; the old #marketing-ai lands here too
  window.IBPages.register('ai', { title: 'الذكاء الاصطناعي', hash: (hs) => { const m = /^(?:ai|marketing-ai)(?:-([a-z][a-z0-9_]{1,30}))?$/.exec(hs); if (!m) return false; if (m[1] && hs.startsWith('ai')) BY.aiTab = m[1]; if (window.IBPages.current !== 'ai' && MK() && MK().state && MK().state() === 'idle') MK().ensure(); return true; },
    defaultHash: () => 'ai' + (BY.aiTab ? '-' + BY.aiTab : ''), view: aiView, api: { goAi, agentForm } });
  document.addEventListener('ib:marketing', () => { if (window.IBPages.current === 'ai' && !document.querySelector('.scrim')) R(); });
  window.IBPages.register('marketing', { title: 'التسويق', hash: (hs) => route(hs), defaultHash, view, api: { st, camp, go, openCampaign, reportBlocks, askAgent, openDraft } });
})();
