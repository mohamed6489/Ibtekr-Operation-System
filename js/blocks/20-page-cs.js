
/* صفحة خدمة العملاء (المرحلة 6 — من الـ prototype v2، artifact «نظام إبتكر» 2 نوفمبر، على بيانات حقيقية عبر IBCS):
   صندوق موحّد (العملاء · المبتكرين · التعليقات + تاب لكل منصة)، الشات والكومبوزر (رد / ملاحظة داخلية / نافذة 24 ساعة)،
   لوحة العميل والمبتكر، سجل العملاء (CRM) وملف العميل، شرايح العملاء، الحملات (مسودة / مجدولة في 6.1)، القنوات (كلها غير متصلة
   لحد 6.2 / 6.4)، الأداء والتقارير، ومجموعة «رسايل» في الجرس. القواعد في الكتلة 19 (IbtekrCS)، والداتا والكتابة كلها عبر IBCS
   (app/js/adapter/cs.js). القوالب والردود السريعة والرد الآلي مؤجلين بقرار صاحب المشروع (أزرارهم بتقول «قريبًا»). */
(function () {
  'use strict';
  const U = window.IBUI, K = window.IBKit, CS = window.IbtekrCS;
  const { h, Icon, Button, IconButton } = U;
  const A = () => window.IBCS || null;
  const meName = () => { const m = K.member(K.ME); return (m && m.name) || '—'; };
  const can = () => (A() ? A().can() : { view: 'N', reply: false, manage: false, phone: false, orders: false, admin: false });
  const PL = { whatsapp: ['واتساب', 'whatsapp'], messenger: ['ماسنجر', 'facebook'], instagram: ['إنستجرام', 'instagram'], tiktok: ['تيك توك', 'tiktok'], facebook: ['فيسبوك', 'facebook'] };
  const STATUS_TONE = { 'جديدة': 'info', 'مستنية ردنا': 'orange', 'مستنية العميل': 'neutral', 'مؤجلة': 'neutral', 'اتحلت': 'success' };
  const STAGE_TONE = { 'استفسار': 'neutral', 'مهتم': 'info', 'عميل': 'brand', 'عميل متكرر': 'gold', 'VIP': 'success' };
  const SOON = (what) => K.toast((what || 'الميزة دي') + ' قريبًا — مؤجلة لمرحلة جاية');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const AR_MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const sinceLabel = (iso) => { const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return '—'; const d = new Date(t); return AR_MON[d.getMonth()] + ' ' + d.getFullYear(); };
  const whenLabel = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) && A() ? A().timeLabel(t) : '—'; };

  // ======================= data: IBCS.data (live) + the parts the page keeps for itself =======================
  // S.customers / convs / segments / campaigns / channels are the adapter's arrays (same objects — a write through IBCS updates them
  // and ib:cs re-renders); vendors are built from IBVendors + IBOrders; templates / quick / rules stay empty (postponed).
  const CHAN_USE = { wa1: 'الاستخدام: الشات + الحملات · العملاء', wa2: 'الاستخدام: شات المبتكرين', messenger: 'الرسايل الخاصة + تعليقات بوستات فيسبوك', instagram: 'الـ DM + تعليقات البوستات والريلز', tiktok: 'الرسايل والتعليقات (حسب المتاح من تيك توك)' };
  const CHAN_WHO = { wa1: 'رقم العملاء · ربط QR (المرحلة الأخيرة)', wa2: 'رقم المبتكرين · ربط QR (المرحلة الأخيرة)', messenger: 'صفحة Ibtekr Club · ربط رسمي من Meta', instagram: '@ibtekr.club · ربط رسمي من Meta', tiktok: '@ibtekr.club · مفيش API رسايل عام' };
  const EMPTY = { customers: [], convs: [], segments: [], campaigns: [], channels: {}, settings: {} };
  const STATIC = { templates: [], quick: [], rules: [], recipients: [], blocked: [] };
  const S = new Proxy(STATIC, {
    get(t, k) { const D = (A() && A().data) || EMPTY; if (k === 'vendors') return vendorsList(); if (k === 'routing') return routingRows(); if (k in D) return D[k]; return t[k]; },
    set(t, k, v) { const D = A() && A().data; if (D && k in D) { D[k] = v; return true; } t[k] = v; return true; },
  });
  const settings = () => ((A() && A().data.settings) || A().DEFAULT_SETTINGS || {});
  function routingRows() { const s = settings(); return [['توزيع تلقائي بالدور', s.routing === 'manual' ? 'يدوي — المسؤول بيعيّن المحادثة بنفسه' : 'المحادثة الجديدة بتروح للي أونلاين وعنده أقل محادثات مفتوحة. محادثات المبتكرين لدور «متابعة المبتكرين» بس.'], ['هدف أول رد (SLA)', s.slaLate + ' دقيقة في مواعيد العمل · تحذير برتقالي بعد ' + s.slaWarn + ' دقايق وأحمر بعد ' + s.slaLate], ['مواعيد العمل', s.hours || '—'], ['قفل تلقائي', 'المحادثة «مستنية العميل» بتتقفل لوحدها بعد ' + s.autoCloseDays + ' أيام من غير رد']]; }
  const OPEN_ST = ['جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن']; const SUB_DONE = ['اتسلم', 'ملغي', 'مرتجع للمبتكر'];
  // the maker as the side panel shows them: open sub-orders from IBOrders, the store data from IBVendors
  function vendorsList() {
    const V = window.IBVendors; const O = window.IBOrders; const list = V && V.store && V.store.all ? V.store.all() : [];
    const orders = (O && O.data && O.data() && O.data().orders) || []; const T = today();
    return list.map((v) => {
      const subs = []; let late = 0;
      orders.forEach((o) => { if (!OPEN_ST.includes(o.st)) return; (o.subs || []).forEach((s) => { if (String(s.vendorId) !== String(v.id) || SUB_DONE.includes(s.ss)) return; const isLate = (s.exp && s.exp < T) || o.age >= 11; const risk = !isLate && o.age >= 9; if (isLate) late += 1; subs.push([s.sid + (s.sid !== o.id ? '' : '-' + s.n), s.prod + ' · ' + o.name, isLate ? 'Late' : risk ? 'AtRisk' : 'OnTime', o.id]); }); });
      return { id: v.id, name: v.name, phone: v.phone || '', contact: v.contactName || '—', craft: [v.category, 'مبتكر من ' + sinceLabel(v.joinedAt)].filter(Boolean).join(' · '), open: subs.length, late, avg: (v.leadDays || 7) + ' يوم', due: '—', rating: 0, ratingTxt: '', subs, status: v.status };
    });
  }
  const C = (id) => S.customers.find((c) => c.id === id); const V = (id) => S.vendors.find((v) => v.id === id) || null;

  // ======================= state =======================
  // تاجز الحالة الجاهزة (owner 1 Nov): بتتضاف للعميل كتاج من «إضافة تاج» — مش حالة منفصلة للشات
  const STATUS_TAGS = [['منتظر الأوردر', 'info'], ['استبدال', 'gold'], ['استرجاع', 'orange'], ['تعديل', 'brand'], ['مستعجل', 'error'], ['غير مؤكد', 'neutral'], ['متابعة', 'info'], ['في انتظار عربون', 'gold']];
  const statusTone = (t) => { const x = STATUS_TAGS.find((y) => y[0] === t); return x ? x[1] : null; };
  // حالة العميل (owner 1 Nov): سعيد / متوسط / متضايق (الثلاثة اللي الجدول بيقبلها) — الموظف بيعدّلها من صفحة العملاء
  const MOODS = [['سعيد', 'success'], ['متوسط', 'gold'], ['متضايق', 'error']];
  const moodOf = (cu) => (cu && cu.mood) || 'متوسط';
  const moodTone = (m) => { const x = MOODS.find((y) => y[0] === m); return x ? x[1] : 'neutral'; };
  const TONES = [['error', 'أحمر'], ['orange', 'برتقالي'], ['gold', 'دهبي'], ['success', 'أخضر فاتح'], ['brand', 'أخضر'], ['info', 'أزرق مخضر'], ['neutral', 'رمادي']];
  const done = (r, okMsg, okTone) => { if (!r || !r.ok) { K.toast(r && r.reason === 'forbidden' ? 'مش مسموح — الصلاحية دي مش عندك' : r && r.reason === 'invalid' ? (r.message || 'البيانات مش صحيحة') : 'حصلت مشكلة في الاتصال — جرّب تاني', 'error'); return false; } if (okMsg) K.toast(okMsg, okTone || 'success'); return true; };
  // بوب أب «حالة جديدة» لتاجز حالة المحادثة: الاسم + اللون (معاينة لايف)
  function newStatusDialog(list, title, onCreate) {
    K.form({ title, values: { name: '', tone: 'info' },
      fields: (f, e, set) => [K.field.text('name', 'اسم الحالة', f, e, (k, v) => { set(k, v); const pv = document.querySelector('[data-new-status-prev] .tg'); if (pv) pv.textContent = v.trim() || 'حالة جديدة'; }, { required: true, placeholder: 'مثلاً: محتاج مكالمة' }),
        h('fieldset', { class: 'blk tone-pick', 'data-tone-pick': '' }, h('legend', null, 'اللون'), h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'لون الحالة' }, TONES.map(([v, l]) => h('button', { type: 'button', role: 'radio', class: 'tone-opt', 'aria-checked': String(f.tone === v), 'aria-label': l, 'data-tone': v, onClick: () => set('tone', v, true) }, K.Tag(v, l))))),
        h('div', { class: 'row-f', 'data-new-status-prev': '' }, h('span', { class: 't-small help' }, 'هتظهر كده:'), K.Tag(f.tone, (f.name || '').trim() || 'حالة جديدة'))],
      validate: (f) => { const n = String(f.name || '').trim(); if (!n) return { name: 'اكتب اسم الحالة' }; if (list.some((x) => x[0] === n)) return { name: 'فيه حالة بنفس الاسم' }; return {}; },
      submitLabel: 'إضافة الحالة',
      submit: (f) => { const n = String(f.name).trim(); list.push([n, f.tone]); K.logEvent('cs.status.new', n + ' · ' + f.tone); onCreate(n); } });
  }
  function moodPick(cu) {
    const cur = moodOf(cu);
    const wrap = h('span', { class: 'pop-anchor st-pick', 'data-popover-root': '', onClick: (e) => e.stopPropagation(), onKeydown: (e) => e.stopPropagation() });
    const btn = h('button', { type: 'button', class: 'st-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'حالة العميل: ' + cur + ' — تغيير', 'data-mood-pick': cur, disabled: !can().reply }, K.Tag(moodTone(cur), cur), Icon('chevD', 'sm'));
    const opts = MOODS.map(([t, tone]) => ({ value: t, label: t, content: K.Tag(tone, t) }));
    const apply = (v) => A().setMood(cu.id, v).then((r) => { if (done(r, 'حالة ' + cu.name + ' بقت «' + v + '»', '')) R(); });
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: opts, value: cur, onSelect: (v) => { close(); if (v !== cur) apply(v); } }));
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.toggle(e); }); wrap.append(btn); return wrap;
  }
  const st = { meta: null, panel: true, fTags: [], fState: ['open'], tab: 'inbox', seg: 'customers', plat: 'all', view: 'all-open', sort: 'oldest', q: '', fChannel: '', fAgent: '', sel: { customers: null, vendors: null, comments: null }, fPost: '', mode: 'reply', draft: '', mobileChat: false,
    cust: { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false, moods: [], provs: [], chans: [], sort: 'recent', seg: '', mode: 'filters', sheet: null, page: 1, picked: new Set() }, segs: { open: '', picked: new Set() }, wiz: null, campaign: null, campFilter: '', recFilter: '' };
  const R = () => { if (window.IBPages.current === 'cs') window.IBPages.render('cs'); };
  const conv = () => S.convs.find((c) => c.id === st.sel[st.seg]);
  const whoName = (c) => (c.who ? (c.seg === 'vendors' ? (V(c.who) || { name: 'مبتكر' }).name : (C(c.who) || { name: 'عميل' }).name) : c.handle || '—');
  const isWA = (c) => c.platform === 'whatsapp';
  const chanKey = (c) => c.channel || (c.seg === 'vendors' ? 'wa2' : c.platform === 'whatsapp' ? 'wa1' : c.platform === 'facebook' ? 'messenger' : c.platform);
  const chanLabel = (c) => (c.seg === 'vendors' ? 'واتساب 2 · المبتكرين' : c.seg === 'comments' ? (c.platform === 'instagram' ? 'إنستجرام · @ibtekr.club' : c.platform === 'tiktok' ? 'تيك توك · @ibtekr.club' : 'فيسبوك · Ibtekr Club') : c.platform === 'whatsapp' ? 'واتساب 1 · العملاء' : PL[c.platform][0]);
  const chanOf = (c) => S.channels[chanKey(c)] || null;
  const connected = (c) => { const ch = chanOf(c); return !!ch && ch.status === 'connected'; };
  const ratingOf = (c) => (c.manualRating ? { value: c.manualRating, stars: c.manualRating, manual: true } : CS.customerRating(c));
  const stageOf = (c) => CS.customerStage(c);
  // ---- تقييم الفريق للعميل: الصفوف من cs_team_ratings (cu.ratings) والمتوسط من السيرفر (مع تقييمات الأوردرات) ----
  const teamList = (cu) => (cu && Array.isArray(cu.ratings) ? cu.ratings : []);
  const r1 = (n) => Math.round(n * 10) / 10;
  const teamOf = (cu) => { if (!cu || !cu.ratingCount) return { count: 0, avg: null, overall: null, last: null }; const avg = { sat: cu.ratingSat == null ? null : r1(cu.ratingSat), manners: cu.ratingManners == null ? null : r1(cu.ratingManners) }; const vals = Object.values(avg).filter((x) => x != null); return { count: cu.ratingCount, avg, overall: vals.length ? r1(vals.reduce((a, x) => a + x, 0) / vals.length) : null, last: teamList(cu)[0] || null }; };
  const segs = () => S.segments;
  const inSeg = (cu, g) => CS.segmentMatch(cu, g, teamOf(cu), today());
  if (window.IBQuick) window.IBQuick.handle('cs-customers', () => { const f = st.cust; const o = {}; ['q', 'stage', 'tag', 'rating', 'prov', 'chan'].forEach((k) => { if (f[k]) o[k] = f[k]; }); if (f.problems) o.problems = true; return o; }, (q) => { const f = st.cust;
    if (q.mode === 'segment') { st.tab = 'segments'; st.segs.open = q.seg || ''; st.segs.picked.clear(); try { history.replaceState(null, '', '#cs-segments'); } catch (e) { /* */ } R(); return; }
    f.mode = 'filters'; ['q', 'stage', 'tag', 'rating', 'prov', 'chan'].forEach((k) => { f[k] = q[k] || ''; }); f.problems = q.problems === '1'; f.picked.clear(); st.tab = 'customers'; R(); });
  if (window.IBQuick) window.IBQuick.handle('cs-segments', () => (st.segs.open ? { seg: st.segs.open } : {}), (q) => { st.tab = 'segments'; st.segs.open = q.seg || ''; st.segs.picked.clear(); R(); });
  function Stars(n, label) { return h('span', { class: 'stars', role: 'img', 'aria-label': label || ('التقييم ' + n + ' من 5') }, [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= n ? 'on' : '' }, Icon('star', 'sm')))); }
  function PlatIcon(p, cls) { return h('span', { class: 'plat plat-' + p + (cls ? ' ' + cls : ''), title: PL[p] ? PL[p][0] : p }, Icon(PL[p] ? PL[p][1] : 'msg', 'sm')); }
  const tagTone = (t) => (t === 'أوردر متأخر' || t.startsWith('رفض') ? 'orange' : t === 'VIP' ? 'success' : t === 'عميل متكرر' ? 'gold' : 'brand');
  const msgsOf = (c) => (A() ? A().withDays(c.msgs) : c.msgs);

  // ======================= inbox =======================
  // قنوات كل عضو بتتحدد من الإعدادات (المرحلة 10) — لحد ساعتها كل عضو عنده cs.view بيشوف كل القنوات
  const myChan = () => true;
  function filtered() {
    let list = S.convs.filter((c) => c.seg === st.seg && myChan(c) && (!st.fAgent || c.assignee === st.fAgent));
    if (st.plat !== 'all') list = list.filter((c) => c.platform === st.plat);
    const v = st.view;
    if (v === 'mine') list = list.filter((c) => c.assignee === meName() && c.status !== 'اتحلت');
    else if (v === 'unassigned') list = list.filter((c) => c.assignee === 'غير معيّنة');
    else if (v === 'all-open' || v === 'all') { const o = st.fState.includes('open'), d = st.fState.includes('done'); if (o !== d) list = list.filter((c) => (o ? c.status !== 'اتحلت' || c.id === st.sel[st.seg] : c.status === 'اتحلت')); }
    else if (v === 'late') list = list.filter((c) => CS.slaLevel(c.status, c.waiting) === 'late');
    else if (v === 'snoozed') list = list.filter((c) => c.status === 'مؤجلة');
    else if (v === 'upset') list = list.filter((c) => c.sentiment === 'neg' || (c.who && c.seg === 'customers' && moodOf(C(c.who)) === 'متضايق'));
    else if (v === 'resolved') list = list.filter((c) => c.status === 'اتحلت');
    if (st.fChannel) list = list.filter((c) => c.platform === st.fChannel);
    if (st.fTags.length) list = list.filter((c) => st.fTags.includes(statusOf(c)));
    if (st.seg === 'comments' && st.fPost) list = list.filter((c) => c.postId === st.fPost); // قرار 20: فلتر البوست
    const q = st.q.trim().toLowerCase();
    if (q) list = list.filter((c) => (whoName(c) + ' ' + (c.who && c.seg !== 'vendors' && C(c.who) ? C(c.who).phone + ' ' + C(c.who).orderList.map((o) => o[0]).join(' ') : '') + ' ' + c.msgs.map((m) => m.text).join(' ')).toLowerCase().includes(q));
    if (st.sort === 'oldest') list = list.slice().sort((a, b) => (b.status === 'مستنية ردنا' || b.status === 'جديدة' ? b.waiting : -1) - (a.status === 'مستنية ردنا' || a.status === 'جديدة' ? a.waiting : -1));
    if (st.sort === 'newest') list = list.slice().sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    if (st.sort === 'priority') list = list.slice().sort((a, b) => score(b) - score(a));
    return list;
  }
  const score = (c) => (c.sentiment === 'neg' || statusOf(c) === 'مستعجل' || (c.who && c.seg !== 'vendors' && C(c.who) && moodOf(C(c.who)) === 'متضايق') ? 3 : 0) + (c.who && c.seg === 'customers' && C(c.who) && stageOf(C(c.who)) === 'VIP' ? 2 : 0) + c.waiting / 100;
  const VIEWS = [['mine', 'محادثاتي المفتوحة'], ['unassigned', 'غير معيّنة'], ['all-open', 'كل المحادثات المفتوحة'], ['late', 'متأخرة عن الرد'], ['snoozed', 'مؤجلة'], ['upset', 'عملاء متضايقين'], ['resolved', 'اتحلت'], ['all', 'كل المحادثات']];
  const SORTS = [['oldest', 'الأقدم انتظاراً'], ['newest', 'الأحدث'], ['priority', 'الأولوية (VIP + متضايق أولاً)']];
  function pickMenu(label, opts, value, onPick, cls, show) {
    const wrap = h('div', { class: 'pop-anchor ' + (cls || ''), 'data-popover-root': '' });
    const cur = opts.find((o) => o[0] === value);
    const btn = h('button', { type: 'button', class: 'select sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label }, Icon('chevD', 'sm'), h('span', { class: 'val' }, show ? show(cur) : (cls === 'view' ? 'العرض: ' : '') + (cur ? cur[1] : label)));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: opts.map(([v, l, content]) => ({ value: v, label: l, content })), value, onSelect: (v) => { close(); onPick(v); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function ConvItem(c) {
    const sel = c.id === st.sel[st.seg]; const lvl = CS.slaLevel(c.status, c.waiting);
    const last = [...c.msgs].reverse().find((m) => m.t !== 'event' && m.t !== 'day');
    const preview = last ? last.text : '';
    const stTag = statusOf(c);
    const tag = c.tag ? K.Tag(c.tag[1], c.tag[0]) : lvl === 'late' ? K.Tag('error', 'متأخرة عن الرد') : K.Tag(STATUS_TONE[c.status], c.status);
    return h('div', { role: 'option', tabindex: '0', 'aria-selected': String(sel), class: 'cv' + (sel ? ' sel' : '') + (c.unread ? ' unread' : ''), 'data-id': c.id, onClick: () => select(c.id), onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); select(c.id); } } },
      U.Avatar(whoName(c)),
      h('span', { class: 'cv-b' },
        h('span', { class: 'cv-r1' }, h('b', { class: 'nm' }, whoName(c)), h('span', { class: 't-small tm' }, c.time)),
        c.seg === 'comments' && c.post ? h('span', { class: 'cv-post t-small', 'data-post-line': '' }, 'على: ' + postLabel(c.post, 40)) : null,
        h('span', { class: 'cv-r2' }, PlatIcon(c.platform), h('span', { class: 'pv' }, preview), c.unread ? h('span', { class: 'badge', 'aria-label': c.unread + ' غير مقروءة' }, String(c.unread)) : null),
        h('span', { class: 'cv-r3' }, statusPick(c, stTag), stTag ? null : tag, h('span', { class: 't-small' }, c.assignee))));
  }
  // قرار 19 (6.2، 4 نوفمبر — «محتاج أعرف البوست اللي بيعلقوا عليه»): البوست اللي عليه التعليق — سطر في القايمة وكارت فوق الشات
  // (الصورة الصغيرة + أول الكابشن + التاريخ + «افتح البوست ↗»)؛ البيانات من cs_posts عبر IBCS (c.post)
  const POST_KIND = { added_photos: 'بوست صور', added_video: 'فيديو', mobile_status_update: 'بوست', shared_story: 'مشاركة', created_event: 'إيفنت', image: 'صورة', video: 'ريل / فيديو', carousel_album: 'ألبوم صور' };
  const postLabel = (p, n) => { const t = String(p.caption || '').replace(/\s+/g, ' ').trim(); return t ? (t.length > n ? t.slice(0, n) + '…' : t) : (POST_KIND[p.kind] || 'بوست') + ' من غير كلام'; };
  function PostCard(c) {
    if (c.seg !== 'comments') return null;
    const p = c.post;
    if (!p) return h('div', { class: 'cs-post empty', 'data-post': '' }, h('span', { class: 't-small' }, 'بيانات البوست لسه ماوصلتش — بتيجي مع السحب الجاي'));
    const when = p.postedAt && !Number.isNaN(Date.parse(p.postedAt)) ? new Date(p.postedAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const img = p.thumb ? h('img', { class: 'cs-post-img', src: p.thumb, alt: 'صورة البوست', loading: 'lazy', referrerpolicy: 'no-referrer', onError: (e) => { e.target.remove(); } }) : null;
    return h('div', { class: 'cs-post', 'data-post': p.id },
      img,
      h('div', { class: 'cs-post-b' },
        h('div', { class: 't-small cs-post-k' }, 'التعليق على ' + (POST_KIND[p.kind] || 'بوست') + ' · ' + (p.platform === 'instagram' ? 'إنستجرام' : 'فيسبوك') + (when ? ' · ' + when : '')),
        h('div', { class: 'cs-post-t' }, postLabel(p, 160))),
      p.permalink ? h('a', { class: 'btn btn-default sm cs-post-a', href: p.permalink, target: '_blank', rel: 'noopener noreferrer', 'data-post-link': '' }, 'افتح البوست ↗') : null);
  }
  // تاج الحالة على كارت المحادثة (owner 1 Nov): حالة واحدة لكل عميل (تاج على العميل)؛ لمحادثة المبتكر / التعليق على المحادثة نفسها
  function statusOf(c) { if (c.who && c.seg !== 'vendors') { const cu = C(c.who); return cu ? [...(cu.tags || [])].reverse().find((t) => statusTone(t)) || '' : ''; } return (c.tags || []).find((t) => statusTone(t)) || ''; }
  async function setStatus(c, t) {
    const old = statusOf(c); let r;
    if (c.who && c.seg !== 'vendors') { const cu = C(c.who); if (!cu) return; const tags = cu.tags.filter((x) => !statusTone(x)); if (t) tags.push(t); r = await A().setTags(cu.id, tags); }
    else { const tags = (c.tags || []).filter((x) => !statusTone(x)); if (t) tags.push(t); r = await A().setConvTags(c.id, tags); }
    if (!done(r)) return;
    await A().event(c.id, t ? 'الحالة بقت «' + t + '»' + (old ? ' (كانت «' + old + '»)' : '') + ' — ' + meName() : 'اتشالت حالة «' + old + '» — ' + meName());
    K.logEvent('cs.tag', whoName(c) + ' · حالة: ' + (t || '—')); R();
  }
  function statusPick(c, cur) {
    const wrap = h('span', { class: 'pop-anchor st-pick', 'data-popover-root': '', onClick: (e) => e.stopPropagation(), onKeydown: (e) => e.stopPropagation() });
    const btn = h('button', { type: 'button', class: 'st-btn' + (cur ? '' : ' is-none'), 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': cur ? 'الحالة: ' + cur + ' — تغيير' : 'إضافة حالة', 'data-status-pick': cur || '', disabled: !can().reply },
      cur ? K.Tag(statusTone(cur), cur, null) : h('span', { class: 'tg tg-neutral dashed' }, '+ حالة'), Icon('chevD', 'sm'));
    const opts = STATUS_TAGS.map(([t, tone]) => ({ value: t, label: t, content: K.Tag(tone, t) })).concat(cur ? [{ value: '__clear', label: 'حذف حالة المحادثة', group: ' ' }] : [], [{ value: '__manage', label: 'تعديل حالات المحادثة', group: cur ? null : ' ' }, { value: '__new', label: 'إضافة حالة جديدة' }]);
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: opts, value: cur, onSelect: (v) => { close(); if (v === '__new') return newStatusDialog(STATUS_TAGS, 'إضافة حالة جديدة', (n) => setStatus(c, n)); if (v === '__manage') return manageStatuses(false); if (v !== cur) setStatus(c, v === '__clear' ? '' : v); } }));
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.toggle(e); }); wrap.append(btn); return wrap;
  }
  // إدارة الحالات (owner 1 Nov): إضافة / تعديل اسم ولون / مسح — التغيير بيتطبّق على تاجز كل العملاء والمحادثات (كتابة لكل واحد عبر IBCS)
  const statusUse = (t) => S.customers.filter((cu) => cu.tags.includes(t)).length + S.convs.filter((x) => (x.tags || []).includes(t) && !(x.who && x.seg !== 'vendors')).length;
  function manageStatuses(addNew, forConv) {
    let seq = 0; const rows = STATUS_TAGS.map(([t, tone]) => ({ id: 'r' + (seq++), orig: t, name: t, tone }));
    if (addNew) rows.push({ id: 'r' + (seq++), orig: '', name: '', tone: 'info' });
    const removed = [];
    K.form({ title: addNew ? 'إضافة حالة جديدة' : 'تعديل حالات المحادثة', wide: true, values: { v: 0 },
      note: () => U.InlineNote({ children: 'الحالات بتظهر كتاج على كارت المحادثة وفي الهيدر وفي ملف العميل. تغيير الاسم أو اللون بيتطبّق على كل العملاء اللي عليهم الحالة، والمسح بيشيلها منهم.' }),
      fields: (f, e, set, draw) => [h('div', { class: 'st-mgr', 'data-status-mgr': '' },
        rows.map((r) => { const n = r.orig ? statusUse(r.orig) : 0;
          const ti = U.TextInput({ id: 'n_' + r.id, label: null, value: r.name, placeholder: 'اسم الحالة', error: e['n_' + r.id], onInput: (v) => { r.name = v; const pv = document.querySelector('[data-row-id="' + r.id + '"] .st-prev .tg'); if (pv) pv.textContent = v.trim() || 'حالة جديدة'; } }); const ip = ti.querySelector('input'); if (ip) ip.setAttribute('aria-label', 'اسم الحالة');
          const tsel = U.Select({ id: 't_' + r.id, label: null, options: TONES.map(([v, l]) => ({ value: v, label: l, content: K.Tag(v, l) })), value: r.tone, onChange: (v) => { r.tone = v; draw(); } }); const tb = tsel.querySelector('button'); if (tb) tb.setAttribute('aria-label', 'لون الحالة');
          return h('div', { class: 'st-row' + (e['n_' + r.id] ? ' has-err' : ''), 'data-status-row': r.orig || 'new', 'data-row-id': r.id },
            h('span', { class: 'st-prev' }, K.Tag(r.tone, r.name.trim() || 'حالة جديدة')),
            ti, tsel,
            h('span', { class: 't-small help st-use' }, r.orig ? (n ? 'على ' + n : 'مش مستخدمة') : 'جديدة'),
            IconButton({ icon: 'trash', label: 'مسح «' + (r.name || 'الحالة') + '»', attrs: { 'data-status-del': r.orig || 'new' }, onClick: () => { rows.splice(rows.indexOf(r), 1); if (r.orig) removed.push([r.orig, n]); draw(); } })); }),
        Button({ type: 'text', icon: 'plus', label: 'إضافة حالة', attrs: { 'data-status-add': '' }, onClick: () => { rows.push({ id: 'r' + (seq++), orig: '', name: '', tone: 'info' }); draw(); setTimeout(() => { const i = document.querySelectorAll('[data-status-mgr] input'); if (i.length) i[i.length - 1].focus(); }); } }),
        removed.length ? U.InlineNote({ kind: 'warning', children: 'هيتمسح: ' + removed.map(([t, n]) => '«' + t + '»' + (n ? ' (هتتشال من ' + n + ')' : '')).join('، ') }) : null)],
      validate: () => { const er = {}; const seen = {}; rows.forEach((r) => { const n = r.name.trim(); if (!n) er['n_' + r.id] = 'اكتب اسم الحالة'; else if (seen[n]) er['n_' + r.id] = 'الاسم ده متكرر'; seen[n] = 1; }); return er; },
      submitLabel: 'حفظ الحالات',
      submit: async () => {
        const ren = rows.filter((r) => r.orig && r.orig !== r.name.trim()).map((r) => [r.orig, r.name.trim()]);
        const del = removed.map((x) => x[0]); const fix = (tags) => tags.filter((t) => !del.includes(t)).map((t) => { const m = ren.find((x) => x[0] === t); return m ? m[1] : t; });
        const changed = (a, b) => a.length !== b.length || a.some((t, i) => t !== b[i]);
        for (const cu of S.customers) { const nt = fix(cu.tags); if (changed(nt, cu.tags)) await A().setTags(cu.id, nt); }
        for (const x of S.convs) { if (x.who && x.seg !== 'vendors') continue; const nt = fix(x.tags || []); if (changed(nt, x.tags || [])) await A().setConvTags(x.id, nt); }
        st.fTags = fix(st.fTags);
        STATUS_TAGS.splice(0, STATUS_TAGS.length, ...rows.map((r) => [r.name.trim(), r.tone]));
        const added = rows.filter((r) => !r.orig).map((r) => r.name.trim());
        K.logEvent('cs.statuses', [added.length ? 'إضافة: ' + added.join('، ') : '', ren.length ? 'تعديل: ' + ren.map((x) => x[0] + '→' + x[1]).join('، ') : '', del.length ? 'مسح: ' + del.join('، ') : ''].filter(Boolean).join(' · ') || 'ألوان');
        if (forConv && added.length === 1) setStatus(forConv, added[0]);
        K.toast('اتحفظت الحالات', 'success'); R(); } });
    if (addNew) setTimeout(() => { const i = document.querySelectorAll('[data-status-mgr] input'); if (i.length) i[i.length - 1].focus(); }, 30);
  }
  // «العرض» (owner 1 Nov): اختيار أكتر من تاج + حالة المحادثة (مفتوحة / تم الحل) — القايمة مش بتقفل مع كل اختيار
  const STATES = [['open', 'مفتوحة'], ['done', 'تم الحل']];
  const viewLabel = () => { const sl = st.fState.length === 1 ? STATES.find((x) => x[0] === st.fState[0])[1] : 'كل المحادثات'; const tg = st.fTags.length ? ' · ' + st.fTags[0] + (st.fTags.length > 1 ? ' +' + (st.fTags.length - 1) : '') : ''; return 'العرض: ' + sl + tg; };
  function viewMenu(refresh) {
    const wrap = h('div', { class: 'pop-anchor view', 'data-popover-root': '' });
    const val = h('span', { class: 'val' }, viewLabel());
    const btn = h('button', { type: 'button', class: 'select sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'العرض' }, Icon('chevD', 'sm'), val);
    const upd = () => { val.textContent = viewLabel(); refresh(); };
    const opt = (on, content, label, toggle, attrs) => { const b = h('button', Object.assign({ type: 'button', class: 'opt multi', role: 'option', 'aria-selected': String(on), 'aria-label': label }, attrs || {}), h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), content);
      b.addEventListener('click', (e) => { e.stopPropagation(); toggle(); const now = b.getAttribute('aria-selected') !== 'true'; b.setAttribute('aria-selected', String(now)); b.querySelector('.mchk').replaceChildren(...(now ? [Icon('check', 'sm')] : [])); upd(); }); return b; };
    const pop = U.popover(wrap, btn, (close) => {
      const tg = (t) => () => { const i = st.fTags.indexOf(t); if (i > -1) st.fTags.splice(i, 1); else st.fTags.push(t); };
      const sg = (k) => () => { const i = st.fState.indexOf(k); if (i > -1) st.fState.splice(i, 1); else st.fState.push(k); };
      const m = h('div', { class: 'menu view-menu', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'العرض', 'data-popover-root': '' },
        h('div', { class: 'opt-group t-small', role: 'presentation' }, 'حالة المحادثة'),
        STATES.map(([k, l]) => opt(st.fState.includes(k), l, l, sg(k), { 'data-view-state': k })),
        h('div', { class: 'opt-group t-small', role: 'presentation' }, 'التاجز'),
        STATUS_TAGS.map(([t, tone]) => opt(st.fTags.includes(t), K.Tag(tone, t), t, tg(t), { 'data-view-tag': t })),
        h('div', { class: 'view-foot' }, Button({ size: 'sm', type: 'text', label: 'مسح', attrs: { 'data-view-clear': '' }, onClick: () => { st.fTags.length = 0; st.fState.splice(0, st.fState.length, 'open'); close(); R(); } }), Button({ size: 'sm', type: 'primary', label: 'تم', onClick: () => close() })));
      return m; });
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function select(id) { st.sel[st.seg] = id; const c = conv(); if (c && c.unread) { c.unread = 0; if (can().reply) A().setUnread(c.id, 0); } st.draft = ''; st.mode = 'reply'; st.mobileChat = true; R(); setTimeout(() => { const l = document.querySelector('.cs-msgs'); if (l) l.scrollTop = l.scrollHeight; }); }
  // قرار 20 (6.2، 4 نوفمبر — «ضيفه»): فلتر «البوست» في قسم التعليقات — البوستات اللي عليها محادثات (بصورتها وعدد المفتوح منها)،
  // اختيار بوست = المحادثات اللي عليه بس؛ بيحترم تاب المنصة
  function postsInList() {
    const by = new Map();
    S.convs.filter((c) => c.seg === 'comments' && c.postId && (st.plat === 'all' || c.platform === st.plat)).forEach((c) => {
      const x = by.get(c.postId) || { id: c.postId, post: c.post, platform: c.platform, open: 0, all: 0, last: '' };
      x.all += 1; if (c.status !== 'اتحلت') x.open += 1; if (c.updatedAt > x.last) x.last = c.updatedAt; if (!x.post && c.post) x.post = c.post;
      by.set(c.postId, x);
    });
    return [...by.values()].sort((a, b) => b.open - a.open || (b.last > a.last ? 1 : -1));
  }
  function PostMenu() {
    if (st.seg !== 'comments') return null;
    const list = postsInList(); if (!list.length) return null;
    const cur = list.find((x) => x.id === st.fPost);
    const name = (x) => (x.post ? postLabel(x.post, 34) : (x.platform === 'instagram' ? 'بوست إنستجرام' : 'بوست فيسبوك'));
    const wrap = h('div', { class: 'pop-anchor post-f', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'select sm', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'فلتر البوست', 'data-post-filter': '' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, cur ? 'البوست: ' + name(cur) : 'كل البوستات (' + list.length + ')'));
    const pop = U.popover(wrap, btn, (close) => {
      const pick = (v) => { close(); st.fPost = v; R(); };
      const menu = h('div', { class: 'menu post-menu', role: 'listbox', 'data-popover-root': '' },
        h('button', { type: 'button', class: 'opt', role: 'option', 'aria-selected': String(!st.fPost), onClick: () => pick('') }, 'كل البوستات'),
        list.map((x) => h('button', { type: 'button', class: 'opt post-opt', role: 'option', 'aria-selected': String(st.fPost === x.id), 'data-post-opt': x.id, onClick: () => pick(x.id) },
          x.post && x.post.thumb ? h('img', { class: 'post-opt-img', src: x.post.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onError: (e) => { e.target.remove(); } }) : h('span', { class: 'post-opt-img ph' }, PlatIcon(x.platform)),
          h('span', { class: 'post-opt-t' }, name(x)),
          h('span', { class: 'cnt', title: x.open + ' مفتوحة من ' + x.all }, String(x.open) + (x.all !== x.open ? '/' + x.all : '')))));
      return menu;
    });
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function ListCol() {
    const segCount = (s) => S.convs.filter((c) => c.seg === s && c.status !== 'اتحلت').length;
    const segsEl = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'نوع المحادثات' }, [['customers', 'العملاء'], ['vendors', 'المبتكرين'], ['comments', 'التعليقات']].map(([id, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(st.seg === id), class: 'seg-b', onClick: () => { st.seg = id; st.plat = 'all'; st.fPost = ''; st.draft = ''; st.mode = 'reply'; R(); } }, l, h('span', { class: 'cnt' }, String(segCount(id))))));
    const plats = st.seg === 'customers' ? [['all', 'الكل'], ['whatsapp', 'واتساب'], ['messenger', 'ماسنجر'], ['instagram', 'إنستجرام'], ['tiktok', 'تيك توك']] : st.seg === 'comments' ? [['all', 'الكل'], ['facebook', 'فيسبوك'], ['instagram', 'إنستجرام'], ['tiktok', 'تيك توك']] : null;
    const counts = CS.unreadBy(S.convs.map((c) => ({ seg: c.seg, platform: c.platform, unread: c.unread || (c.status === 'جديدة' || c.status === 'مستنية ردنا' ? 1 : 0) })), st.seg);
    const disc = (p) => { const key = p === 'whatsapp' ? 'wa1' : p === 'facebook' ? 'messenger' : p; const ch = S.channels[key]; return !!ch && ch.status !== 'connected'; };
    const ptabs = plats ? h('div', { class: 'ptabs', role: 'tablist', 'aria-label': 'المنصة' }, plats.map(([id, l], i) => h('button', { type: 'button', role: 'tab', class: 'ptab', 'aria-selected': String(st.plat === id), title: 'Alt+' + (i + 1), onClick: () => { st.plat = id; R(); } }, id !== 'all' ? Icon(PL[id][1], 'sm') : null, l, h('span', { class: 'cnt' }, String(counts[id] || 0)), id !== 'all' && disc(id) ? h('i', { class: 'dot-err', 'aria-label': 'المنصة مش مربوطة' }) : null))) : null;
    const q = h('input', { type: 'search', value: st.q, placeholder: st.seg === 'vendors' ? 'ابحث باسم المبتكر أو رقم الأوردر الفرعي' : st.seg === 'comments' ? 'ابحث في التعليقات أو باسم الحساب' : 'ابحث بالاسم أو الرقم أو رقم الأوردر', 'aria-label': 'بحث في المحادثات' });
    q.addEventListener('input', () => { st.q = q.value; const l = document.querySelector('.cs-items'); if (l) l.replaceChildren(...items()); });
    const filt = K.RowMenu([{ label: 'القناة: الكل', run: () => { st.fChannel = ''; R(); } }, { label: 'القناة: واتساب 1', run: () => { st.fChannel = 'whatsapp'; R(); } }, { label: 'القناة: ماسنجر', run: () => { st.fChannel = 'messenger'; R(); } }, { label: 'القناة: إنستجرام', run: () => { st.fChannel = 'instagram'; R(); } }, { label: 'القناة: تيك توك', run: () => { st.fChannel = 'tiktok'; R(); } }], 'فلاتر المحادثات');
    const items = () => { const l = filtered(); return l.length ? l.map(ConvItem) : [K.Empty(st.view === 'mine' ? 'مفيش محادثات مستنية رد 🎉' : 'مفيش محادثات هنا', st.view === 'mine' ? 'كل محادثاتك اتردّ عليها. جرّب «غير معيّنة» أو «كل المحادثات» لو عايز تساعد زمايلك.' : S.convs.length ? 'غيّر العرض أو المنصة أو البحث.' : 'القنوات لسه ما اتربطتش — ابدأ محادثة من «رسالة جديدة».')]; };
    const lst = h('div', { class: 'cs-items', role: 'listbox', 'aria-label': 'المحادثات' }, items());
    lst.addEventListener('keydown', (e) => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); const b = [...lst.querySelectorAll('.cv')]; const i = b.indexOf(document.activeElement); const n = b[e.key === 'ArrowDown' ? Math.min(b.length - 1, i + 1) : Math.max(0, i - 1)]; if (n) n.focus(); });
    const wa1 = S.channels.wa1; const disconnected = !!wa1 && wa1.status !== 'connected' && st.seg === 'customers' && (st.plat === 'all' || st.plat === 'whatsapp');
    return h('aside', { class: 'cs-list', 'aria-label': 'قائمة المحادثات' },
      h('div', { class: 'cs-lh' }, segsEl, h('div', { class: 'row-f' }, h('label', { class: 'search grow' }, Icon('search', 'sm'), q), filt),
        h('div', { class: 'row-f' }, viewMenu(() => lst.replaceChildren(...items())), pickMenu('الترتيب', SORTS, st.sort, (v) => { st.sort = v; R(); }, 'sort')),
        st.seg === 'comments' ? PostMenu() : null,
        st.view !== 'all-open' && st.view !== 'all' ? h('div', { class: 'chips' }, h('span', { class: 'chip', 'data-view-chip': st.view }, (VIEWS.find((x) => x[0] === st.view) || ['', st.view])[1], IconButton({ icon: 'close', label: 'مسح', onClick: () => { st.view = 'all-open'; R(); } }))) : null,
        st.fAgent ? h('div', { class: 'chips' }, h('span', { class: 'chip', 'data-agent-chip': '' }, 'المسؤول: ' + st.fAgent, IconButton({ icon: 'close', label: 'مسح فلتر المسؤول', onClick: () => { st.fAgent = ''; R(); } }))) : null,
        st.fChannel ? h('div', { class: 'chips' }, h('span', { class: 'chip' }, 'القناة: ' + PL[st.fChannel][0], IconButton({ icon: 'close', label: 'مسح فلتر القناة', onClick: () => { st.fChannel = ''; R(); } })), Button({ type: 'text', size: 'sm', label: 'مسح الكل', onClick: () => { st.fChannel = ''; R(); } })) : null),
      ptabs, disconnected ? h('div', { class: 'cs-disc t-small' }, Icon('alert', 'sm'), 'واتساب 1 مش مربوط — الرسايل الجديدة مش بتوصل', Button({ type: 'text', size: 'sm', label: 'القنوات', onClick: () => { st.tab = 'channels'; R(); } })) : null, lst);
  }
  function Bubble(m) {
    if (m.t === 'day') return h('div', { class: 'day' }, h('span', null, m.text));
    if (m.t === 'event') return h('div', { class: 'evt' }, U.TimelineEvent({ text: m.text, time: m.time }));
    const side = m.t === 'in' ? 'in' : 'out'; const kind = m.t;
    const body = h('div', { class: 'tx' }, m.text);
    const dl = m.delivery === 'read' ? ['✓✓ اتقرت', 'ok'] : m.delivery === 'delivered' ? ['✓✓ اتسلمت', ''] : m.delivery === 'sent' ? ['✓ اتبعتت', ''] : m.delivery === 'queued' ? ['في الطابور — هتتبعت لما القناة تتربط', ''] : m.delivery === 'failed' ? ['فشل الإرسال', 'err'] : null;
    return h('div', { class: 'brow ' + side }, h('div', { class: 'bub b-' + kind },
      m.t === 'note' ? h('div', { class: 'bh t-small' }, 'ملاحظة داخلية · مش بتوصل للعميل') : m.t === 'auto' ? h('div', { class: 'bh t-small' }, Icon('bot', 'sm'), 'رد آلي' + (m.tpl ? ' · قالب «' + m.tpl + '»' : '')) : null,
      body, h('div', { class: 'meta t-small' }, m.author ? h('span', null, m.author) : null, h('span', null, m.time), dl ? h('span', { class: dl[1] }, dl[0]) : null)));
  }
  const agents = () => (A() ? A().agents() : []);
  function ChatCol(c) {
    if (!c) return h('section', { class: 'cs-chat empty-chat' }, K.Empty('اختار محادثة من القائمة', 'هتلاقي هنا الشات وبيانات العميل وأوردراته. اختصار: J / K للتنقل بين المحادثات.'));
    const lvl = CS.slaLevel(c.status, c.waiting); const reply = can().reply;
    const doAssign = async (to, auto) => { const ag = agents().find((a) => a.name === to); const r = await A().assign(c.id, ag ? ag.id : null); if (!done(r)) return; await A().event(c.id, to === 'غير معيّنة' ? 'المحادثة اتشالت من المسؤول بواسطة ' + meName() : 'المحادثة اتعيّنت لـ ' + to + (auto ? ' (توزيع تلقائي)' : ' بواسطة ' + meName())); K.toast(to === 'غير معيّنة' ? 'اتشالت من المسؤول' : 'اتحولت لـ ' + to); R(); };
    const asg = pickMenu('المسؤول', agents().map((a) => [a.name, a.name + (a.online ? ' · متاح' : ' · مش متاح')]).concat([['غير معيّنة', 'غير معيّن'], ['auto', 'توزيع تلقائي (بالدور)']]), c.assignee, (v) => {
      if (!reply) { K.toast('مش مسموح — التعيين محتاج صلاحية الرد', 'error'); return; }
      if (v === c.assignee) return;
      if (v === 'غير معيّنة') return doAssign(v, false);
      const to = v === 'auto' ? CS.assignNext(agents().map((a) => ({ id: a.name, online: a.online, open: S.convs.filter((x) => x.assignee === a.name && x.status !== 'اتحلت').length }))) : v;
      if (!to) { K.toast('مفيش حد متاح للتوزيع دلوقتي', 'error'); return; }
      confirmAssign(c, to, v === 'auto', () => doAssign(to, v === 'auto')); }, 'asg', (cur) => (cur ? (cur[0] === 'غير معيّنة' ? 'غير معيّن' : cur[0]) : 'المسؤول'));
    const cu = c.who && c.seg !== 'vendors' ? C(c.who) : null;
    const more = K.RowMenu([
      { label: 'تأجيل', icon: 'moon', run: () => snooze(c) },
      { label: 'تحويل لتذكرة', icon: 'ticket', run: () => SOON('تذاكر الفريق') },
      cu ? { label: 'إضافة تاج', icon: 'tag', run: () => addTag(cu) } : null,
      cu && can().manage ? { label: 'دمج مع عميل تاني', icon: 'merge', run: () => merge(cu) } : null,
      { label: 'تعليم كغير مقروءة', run: () => A().setUnread(c.id, 1).then((r) => { if (done(r)) R(); }) },
      { label: 'نسخ رابط المحادثة', icon: 'link', run: () => copy(location.href.split('#')[0] + '#cs-inbox', 'رابط المحادثة') },
      cu ? { label: cu.blocked ? 'فك حظر الرقم' : 'حظر الرقم', danger: !cu.blocked, run: () => block(c) } : null], 'المزيد');
    const who = c.seg === 'vendors' ? V(c.who) : cu;
    const head = h('div', { class: 'cs-ch' }, U.Avatar(whoName(c)), h('div', { class: 'who' }, h('b', null, whoName(c)), h('div', { class: 't-small sub' }, PlatIcon(c.platform), h('span', { class: 'sub-t' }, c.seg === 'comments' ? PL[c.platform][0] + ' · تعليق' : chanLabel(c).split(' · ')[0] + ' · ' + (who ? (who.phone || who.ig || '—') : '—')), h('span', { class: 'sub-st', 'data-head-status': '' }, statusPick(c, statusOf(c))))),
      h('div', { class: 'acts' }, asg, c.status !== 'اتحلت' ? Button({ type: 'primary', size: 'sm', label: 'إنهاء المحادثة', disabled: !reply, attrs: { 'data-close-chat': '' }, onClick: () => closeChat(c) }) : Button({ size: 'sm', label: 'إعادة فتح', disabled: !reply, onClick: () => A().setStatus(c.id, 'مستنية ردنا').then((r) => { if (done(r, 'اتفتحت تاني')) R(); }) }), commentActs(c, reply), more, IconButton({ icon: 'panel', label: st.panel === false ? 'إظهار ملف العميل' : 'إخفاء ملف العميل', attrs: { 'data-panel-toggle': '', 'aria-pressed': String(st.panel !== false), title: st.panel === false ? 'إظهار ملف العميل' : 'إخفاء ملف العميل' }, onClick: () => { st.panel = st.panel === false; R(); } })));
    const vLate = c.seg === 'vendors' && who && who.late ? who.subs.filter((s) => s[2] === 'Late').map((s) => s[0]).join('، ') : '';
    const bar = vLate ? h('div', { class: 'cs-bar err', role: 'status' }, Icon('alert', 'sm'), 'أوردر فرعي متأخر: ' + vLate)
      : lvl !== 'none' ? h('div', { class: 'cs-bar ' + (lvl === 'late' ? 'err' : 'warn'), role: 'status' }, Icon('clock', 'sm'), 'مستنية ردنا من ' + c.waiting + ' دقيقة — الهدف أول رد خلال ' + CS.SLA.late + ' دقيقة') : null;
    const log = h('div', { class: 'cs-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'المحادثة', tabindex: '0' }, msgsOf(c).map((m) => Bubble(m)));
    setTimeout(() => { log.scrollTop = log.scrollHeight; });
    return h('section', { class: 'cs-chat', 'aria-label': 'المحادثة مع ' + whoName(c) }, h('div', { class: 'back-m' }, Button({ type: 'text', size: 'sm', icon: 'chevR', label: 'رجوع للقائمة', onClick: () => { st.mobileChat = false; R(); } })), head, PostCard(c), bar, log, Composer(c));
  }
  // تقرير حجم شغل الموظف قبل التحويل (owner 1 Nov)
  function workload(name) {
    const mine = S.convs.filter((x) => x.assignee === name && x.status !== 'اتحلت');
    const waiting = mine.filter((x) => CS.slaLevel(x.status, x.waiting) !== 'none');
    const late = mine.filter((x) => CS.slaLevel(x.status, x.waiting) === 'late');
    const hot = mine.filter((x) => ['متضايق', 'مستعجل'].includes(statusOf(x)));
    const by = { customers: 0, vendors: 0, comments: 0 }; mine.forEach((x) => { by[x.seg] = (by[x.seg] || 0) + 1; });
    const team = agents().filter((a) => a.online).map((a) => S.convs.filter((x) => x.assignee === a.name && x.status !== 'اتحلت').length);
    const avg = team.length ? team.reduce((p, n) => p + n, 0) / team.length : 0;
    return { mine, waiting, late, hot, by, avg, oldest: waiting.reduce((m, x) => Math.max(m, x.waiting), 0) };
  }
  function confirmAssign(c, to, auto, ok) {
    const a = agents().find((x) => x.name === to) || { name: to, online: true }; const w = workload(to);
    const heavy = w.mine.length > Math.max(2, Math.ceil(w.avg * 1.5));
    const warn = !a.online ? to + ' مش متاح دلوقتي — المحادثة هتستنى لحد ما يرجع.' : w.late.length ? 'عنده ' + w.late.length + ' محادثة متأخرة عن الرد دلوقتي.' : heavy ? 'شغله أكتر من متوسط الفريق (' + w.avg.toFixed(1) + ' محادثة مفتوحة).' : null;
    const kv = [['الحالة', a.online ? 'متاح' : 'مش متاح'], ['محادثات مفتوحة', String(w.mine.length) + ' (متوسط الفريق ' + w.avg.toFixed(1) + ')'], ['مستنية رده', String(w.waiting.length) + (w.oldest ? ' · أقدمها من ' + w.oldest + ' دقيقة' : '')], ['متأخرة عن الرد', String(w.late.length)], ['عملاء متضايقين / مستعجلين', String(w.hot.length)], ['حسب النوع', 'عملاء ' + w.by.customers + ' · مبتكرين ' + w.by.vendors + ' · تعليقات ' + w.by.comments]];
    let m = null;
    m = U.Modal({ title: 'تحويل المحادثة لـ ' + to + '؟', body: [
      h('div', { class: 'stack', 'data-workload': to },
        auto ? U.InlineNote({ children: 'التوزيع التلقائي اختار ' + to + ' (أقل شغل من المتاحين).' }) : null,
        h('p', { class: 't-small help', style: 'margin:0' }, 'حجم الشغل اللي عنده دلوقتي — راجعه قبل ما تحوّل محادثة ' + whoName(c) + '.'),
        h('div', { class: 'kvg wl-kv' }, kv.map(([k, v]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, k), h('b', null, v)))),
        w.mine.length ? h('div', { class: 'stack' }, h('b', { class: 't-small' }, 'محادثاته المفتوحة'), h('div', { class: 'pick-list wl-list' }, w.mine.slice(0, 5).map((x) => { const t = statusOf(x); return h('div', { class: 'pick-row' }, h('span', { class: 'grow' }, h('b', null, whoName(x)), ' ', h('span', { class: 't-small help' }, '· ' + x.status + (x.waiting ? ' · من ' + x.waiting + ' د' : ''))), t ? K.Tag(statusTone(t), t) : null); })), w.mine.length > 5 ? h('span', { class: 't-small help' }, '+ ' + (w.mine.length - 5) + ' كمان') : null) : h('p', { class: 't-small', style: 'margin:0' }, 'مفيش محادثات مفتوحة معاه.'),
        warn ? U.InlineNote({ kind: 'warning', children: warn }) : null)],
      footer: [Button({ label: 'مش دلوقتي', attrs: { 'data-assign-cancel': '' }, onClick: () => m.close() }), Button({ type: 'primary', label: 'تأكيد التحويل', attrs: { 'data-assign-ok': '' }, onClick: () => { m.close(); ok(); } })] });
  }
  function Composer(c) {
    const wa = isWA(c) || c.seg === 'vendors' || (c.seg === 'customers' && (c.platform === 'messenger' || c.platform === 'instagram')); const closed = wa && !CS.windowOpen(c.lastIn, Date.now()) && st.mode === 'reply';
    const note = st.mode === 'note'; const reply = can().reply; const live = connected(c);
    const ta = h('textarea', { class: 'textarea', rows: 1, id: 'cs-ta', title: note ? 'Ctrl+Enter للحفظ' : 'Enter إرسال · Shift+Enter سطر جديد', 'aria-label': note ? 'ملاحظة داخلية' : 'الرد', placeholder: note ? 'اكتب ملاحظة للفريق… استخدم @ لذكر دور أو زميل' : c.seg === 'comments' ? 'رد عام — من غير بيانات شخصية' : 'اكتب ردك…', disabled: !reply });
    ta.value = st.draft;
    const grow = () => { ta.style.height = ''; if (ta.value) ta.style.height = Math.min(ta.scrollHeight + 2, 140) + 'px'; }; setTimeout(grow);
    ta.addEventListener('input', () => { st.draft = ta.value; grow(); });
    ta.addEventListener('keydown', (e) => { if (note ? (e.key === 'Enter' && e.ctrlKey) : (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); send(c, ta.value); } });
    const tool = (icon, label, run) => IconButton({ icon, label, attrs: { title: label, 'data-cmp-tool': label }, onClick: run });
    const tabs = h('div', { class: 'cmp-tabs', role: 'tablist' }, h('button', { type: 'button', role: 'tab', class: 'cmp-tab', 'aria-selected': String(!note), onClick: () => { st.mode = 'reply'; R(); focusComposer(); } }, c.seg === 'comments' ? 'رد عام على التعليق' : c.seg === 'vendors' ? 'رد على المبتكر' : 'رد على العميل'), h('button', { type: 'button', role: 'tab', class: 'cmp-tab note', 'aria-selected': String(note), onClick: () => { st.mode = 'note'; R(); focusComposer(); } }, 'ملاحظة داخلية'));
    return h('div', { class: 'cmp' + (note ? ' is-note' : '') },
      h('div', { class: 'cmp-top' }, tabs, h('span', { class: 't-small from' }, 'هيتبعت من: ', PlatIcon(c.platform), h('b', null, chanLabel(c)))),
      !note && !live ? h('div', { class: 'cs-bar warn sm', role: 'status', 'data-chan-off': '' }, 'القناة مش متصلة — الرد مش هيوصل للعميل دلوقتي. الملاحظات الداخلية شغالة، و' + (chanOf(c) && chanOf(c).kind === 'meta' ? 'الأدمن بيربط ماسنجر/إنستجرام من تاب «القنوات».' : 'الربط في مرحلة جاية.')) : null,
      closed && live ? h('div', { class: 'cs-bar warn sm', role: 'status' }, 'عدّى 24 ساعة من آخر رسالة للعميل. الرسالة الحرة ممكن متوصلش أو تعرّض الرقم للحظر — ابعت قالب متابعة بدلها.') : null,
      h('div', { class: 'cmp-in' }, ta),
      h('div', { class: 'cmp-bar' }, note ? [tool('at', 'ذكر @', () => { ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + '@'; ta.focus(); })]
        : [tool('file', 'قالب', () => SOON('القوالب')), tool('zap', 'ردود سريعة', () => SOON('الردود السريعة')), tool('attach', 'مرفق', () => SOON('المرفقات')), tool('mic', 'فويس', () => SOON('الرسايل الصوتية'))],
        h('span', { class: 'grow' }), h('span', { class: 't-small hint' }, note ? 'Ctrl+Enter للحفظ' : 'Enter إرسال'),
        Button({ type: note ? 'default' : 'primary', label: note ? 'حفظ الملاحظة' : 'إرسال', icon: note ? null : 'send', disabled: !reply || (!note && !live), attrs: { 'data-cmp-send': '' }, onClick: () => send(c, ta.value) })));
  }
  const focusComposer = () => setTimeout(() => { const t = document.getElementById('cs-ta'); if (t) t.focus(); });
  function fillFor(c, text) {
    const cu = c.who && c.seg !== 'vendors' ? C(c.who) : null; const o = cu && cu.orderList[0];
    const vars = { 'اسم_العميل': cu ? cu.name.split(' ')[0] : '', 'رقم_الأوردر': o ? o[0] : '', 'الإجمالي': o ? (o[2].split(' · ')[0] || '') : '', 'رابط_التتبع': o ? 'bosta.co/t/' + o[0] : '', 'اسم_المبتكر': c.seg === 'vendors' ? whoName(c) : '' };
    return CS.fillTemplate(text, vars).text;
  }
  async function send(c, text) {
    text = String(text || '').trim(); if (!text) { focusComposer(); return; }
    if (st.mode === 'note') { const r = await A().note(c.id, text); if (!done(r)) return; const men = text.match(/@\S+/g); if (men) K.toast('الملاحظة اتحفظت — الإشعارات للمنشن مع ربط القنوات'); }
    else {
      if (!connected(c)) { K.toast('القناة مش متصلة — الرسالة مش هتوصل. سيبها ملاحظة داخلية أو استنى ربط القناة.', 'error'); return; }
      const r = await A().send(c.id, text); if (!done(r)) return;
      const next = CS.nextStatus(c.status, 'out'); if (next !== c.status) await A().setStatus(c.id, next);
    }
    st.draft = ''; R(); focusComposer();
  }
  // «إنهاء المحادثة» (owner 1 Nov): نتيجة المحادثة (إجباري) + حالة العميل + تقييم العميل (اختياري) + ملاحظة — كتابة واحدة عبر IBCS.close
  const OUTCOMES = ['أوردر يدوي', 'استفسار فقط', 'تم حل المشكلة', 'تم تسليم الأوردر بنجاح', 'تم التبديل', 'تم الإرجاع'];
  function closeChat(c) {
    const cu = c.who && c.seg !== 'vendors' ? C(c.who) : null; const KEYS = CS.RATE_KEYS;
    K.form({ title: 'إنهاء المحادثة — ' + whoName(c), values: { outcome: c.outcome || '', mood: cu ? moodOf(cu) : '', sat: 0, manners: 0, note: '' },
      note: U.InlineNote({ children: chanLabel(c) + ' · لو العميل كتب تاني المحادثة هتتفتح لوحدها.' }),
      fields: (f, e, set) => [
        h('div', { class: 'cc-outcome', 'data-cc-outcome': '' },
          K.Radios({ label: 'نتيجة المحادثة', required: true, error: e.outcome, options: OUTCOMES.map((x) => ({ value: x, label: x })), value: f.outcome, onChange: (v) => set('outcome', v, true) })),
        cu ? h('div', { class: 'field', 'data-cc-mood': '' }, h('span', { class: 'flabel' }, 'حالة العميل'),
          h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'حالة العميل' }, MOODS.map(([t, tone]) => h('button', { type: 'button', class: 'chip mood-chip', role: 'radio', 'aria-checked': String(f.mood === t), 'data-cc-mood-v': t, onClick: () => set('mood', t, true) }, K.Tag(tone, t))))) : null,
        cu ? h('fieldset', { class: 'blk', 'data-cc-rate': '' }, h('legend', null, 'تقييم العميل (اختياري)'),
          KEYS.map(([k, l]) => K.StarPicker({ id: 'cc-' + k, label: l, value: f[k], error: e[k], onChange: (n) => set(k, n, true) })),
          h('p', { class: 't-small help', style: 'margin:0' }, 'بيتسجل في «تقييم الفريق للعميل» في ملفه وبيتحسب في الشرايح.')) : null,
        K.field.area('note', 'ملاحظة', f, e, set, { placeholder: 'اختياري — مثلاً: طلب يتواصل معاه بكرة' })].filter(Boolean),
      validate: (f) => { const er = {}; if (!f.outcome) er.outcome = 'اختار نتيجة المحادثة'; if (cu && (f.sat || f.manners)) Object.assign(er, CS.validateTeamRating({ sat: f.sat, manners: f.manners })); return er; },
      submitLabel: 'إنهاء المحادثة', cancelLabel: 'رجوع',
      submit: async (f) => {
        const r = await A().close(c.id, { outcome: f.outcome, mood: cu && f.mood && f.mood !== moodOf(cu) ? f.mood : null, rating: cu && f.sat && f.manners ? { sat: f.sat, manners: f.manners, note: (f.note || '').trim() } : null, note: (f.note || '').trim() });
        if (done(r, 'اتنهت المحادثة — «' + f.outcome + '»')) R();
      } });
  }
  const SNOOZE = [['ساعة', 60], ['بكرة 9 ص', null], ['الأحد 9 ص', 'sun']];
  const snoozeUntil = (k) => { const d = new Date(); if (k === 'ساعة') return new Date(d.getTime() + 3600e3).toISOString(); d.setHours(9, 0, 0, 0); if (k === 'الأحد 9 ص') { do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 0); return d.toISOString(); } d.setDate(d.getDate() + 1); return d.toISOString(); };
  function snooze(c) { K.form({ title: 'تأجيل المحادثة', values: { until: 'بكرة 9 ص' }, fields: (f, e, set) => [K.Radios({ label: 'لحد إمتى', options: SNOOZE.map(([x]) => ({ value: x, label: x })), value: f.until, onChange: (v) => set('until', v, true) }), U.InlineNote({ children: 'المحادثة هتختفي من «المفتوحة» وترجع في الميعاد، أو أول ما العميل يكتب.' })], submitLabel: 'تأجيل', submit: async (f) => { const r = await A().snooze(c.id, snoozeUntil(f.until)); if (!done(r)) return; await A().event(c.id, 'اتأجلت لحد ' + f.until + ' — ' + meName()); K.toast('اتأجلت لحد ' + f.until); R(); } }); }
  function copy(text, what) { const ok = () => K.toast('اتنسخ ' + what, 'success'); try { navigator.clipboard.writeText(text).then(ok, () => K.toast(text)); } catch (e) { K.toast(text); } }
  const NEW_TAG = '__new';
  function addTag(cu) {
    const others = [...new Set(S.customers.flatMap((x) => x.tags))].filter((t) => !statusTone(t));
    const sOpts = STATUS_TAGS.filter(([t]) => !cu.tags.includes(t)).map(([t, tone], i) => ({ value: t, label: t, content: K.Tag(tone, t), group: i ? null : 'الحالات' }));
    const oOpts = others.filter((t) => !cu.tags.includes(t)).map((t, i) => ({ value: t, label: t, group: i ? null : 'تاجز العملاء' }));
    const opts = sOpts.concat(oOpts, [{ value: NEW_TAG, label: '+ تاج جديد' }]);
    K.form({ title: 'إضافة تاج — ' + cu.name, values: { tag: '', name: '' },
      fields: (f, e, set) => [K.field.select('tag', 'التاج', opts, f, e, set, { required: true, placeholder: 'اختار تاج', help: 'حالة واحدة للعميل (اختيار حالة جديدة بيبدّل القديمة) + أي عدد من تاجز العملاء — بتستخدم في الفلاتر والشرايح' }),
        f.tag === NEW_TAG ? K.field.text('name', 'اسم التاج الجديد', f, e, set, { required: true, placeholder: 'مثلاً: هدايا شركات' }) : null],
      validate: (f) => { if (!f.tag) return { tag: 'اختار تاج' }; if (f.tag !== NEW_TAG) return {}; const n = String(f.name || '').trim(); if (!n) return { name: 'اكتب اسم التاج' }; if (cu.tags.includes(n)) return { name: 'التاج ده موجود على العميل' }; return {}; },
      submitLabel: 'إضافة',
      submit: async (f) => { const t = f.tag === NEW_TAG ? String(f.name).trim() : f.tag; let tags = cu.tags.slice(); if (statusTone(t)) tags = tags.filter((x) => !statusTone(x)); if (!tags.includes(t)) tags.push(t); const r = await A().setTags(cu.id, tags); if (done(r, 'اتضاف تاج «' + t + '»')) { K.logEvent('cs.tag', cu.name + ' + ' + t); R(); } } });
  }
  function editRating(cu) {
    const auto = CS.customerRating(Object.assign({}, cu));
    K.form({ title: 'تعديل تقييم العميل', values: { stars: String(cu.manualRating || 5), reason: '' },
      note: h('div', { class: 'stack' }, h('div', { class: 'row-f' }, h('span', { class: 't-label' }, 'التقييم المحسوب'), Stars(auto ? auto.stars : 0), h('b', null, auto ? String(auto.value) : '—')),
        auto ? h('div', { class: 'card pad-s' }, h('div', { class: 't-small' }, 'بيتحسب من:'), K.Kv([['أوردرات', cu.orders + (cu.lateOpen ? ' (1 مفتوح متأخر −0.2)' : '')]].concat(auto.parts.filter((p) => p.key !== 'late').map((p) => [p.label, p.count + (p.delta ? ' (' + p.delta + ')' : ' (بدون خصم)')])))) : null),
      fields: (f, e, set) => [K.field.select('stars', 'التقييم الجديد', ['5', '4', '3', '2', '1'].map((x) => ({ value: x, label: x + ' من 5' })), f, e, set, { required: true }), K.field.area('reason', 'سبب التعديل', f, e, set, { required: true, help: 'إجباري. بيظهر في سجل العميل.' })],
      validate: (f) => { const er = CS.validateRatingOverride(Number(f.stars), f.reason); return er ? (er.includes('سبب') ? { reason: er } : { stars: er }) : {}; },
      submitLabel: 'حفظ التقييم', submit: async (f) => { const r = await A().setOverride(cu.id, Number(f.stars), f.reason); if (done(r, 'اتحفظ التقييم — معدّل يدوي')) R(); } });
  }
  function merge(cu) {
    const others = S.customers.filter((x) => x.id !== cu.id);
    if (!others.length) { K.toast('مفيش عميل تاني يتدمج معاه'); return; }
    K.form({ title: 'دمج مع عميل تاني', wide: true, values: { other: others[0].id, keep: cu.id },
      note: U.InlineNote({ children: 'لو نفس الشخص كلمنا من قناتين — المحادثات والملاحظات والتقييمات بتتجمع في ملف واحد، والملف التاني بيتعلّم «مدموج» (الأوردرات بتفضل بتليفونه).' }),
      fields: (f, e, set) => { const o = C(f.other); const card = (x) => (x ? h('div', { class: 'card pad-s merge-c' + (f.keep === x.id ? ' keep' : '') }, h('button', { type: 'button', role: 'radio', class: 'radio', 'aria-checked': String(f.keep === x.id), onClick: () => set('keep', x.id, true) }, h('i'), h('span', null, f.keep === x.id ? 'الملف الأساسي (يفضل)' : 'هيتدمج')), h('b', null, x.name), h('div', { class: 't-small' }, x.channels.map((p) => PL[p][0]).join(' · ') + ' · ' + (x.phone || x.ig || '—')), h('div', { class: 't-small' }, x.orders + ' أوردرات')) : null);
        return [K.field.select('other', 'العميل التاني', others.map((x) => ({ value: x.id, label: x.name + ' · ' + (x.phone || x.ig || '') })), f, e, (k, v) => set(k, v, true), { required: true }), h('div', { class: 'row cols2' }, card(cu), card(o)),
          U.InlineNote({ kind: 'warning', children: 'الدمج مبيترجعش.' })]; },
      submitLabel: 'دمج الملفين', submit: async (f) => { const keep = f.keep; const other = f.keep === cu.id ? f.other : cu.id; const a = C(keep), b = C(other); const r = await A().merge(keep, other); if (done(r, 'اتدمج ' + (b ? b.name : '') + ' في ' + (a ? a.name : ''))) R(); } });
  }
  // 6.2: a comments conversation on a connected Meta channel — a private reply (a DM to the commenter) and hiding the last comment
  function commentActs(c, reply) {
    if (c.seg !== 'comments' || !reply || !connected(c) || !A().commentPrivate) return null;
    return [Button({ size: 'sm', icon: 'send', label: 'رد خاص', attrs: { 'data-comment-private': '' }, onClick: () => privateReply(c) }),
      Button({ size: 'sm', label: 'إخفاء التعليق', attrs: { 'data-comment-hide': '' }, onClick: () => K.confirm({ title: 'إخفاء آخر تعليق من ' + whoName(c) + '؟', text: 'التعليق بيختفي من على البوست لكل الناس إلا صاحبه وأصحابه. الرد العام والخاص لسه شغالين.', okLabel: 'إخفاء', onOk: async () => { const r = await A().commentHide(c.id); if (done(r, 'اتخفى التعليق')) R(); } }) })];
  }
  function privateReply(c) {
    const ta = h('textarea', { class: 'textarea', rows: 4, id: 'cs-private-ta', 'aria-label': 'الرسالة الخاصة', placeholder: 'اكتب الرسالة اللي هتوصل للمعلّق على الخاص…' });
    const m = U.Modal({ title: 'رد خاص على ' + whoName(c), body: h('div', null, h('p', { class: 't-small help' }, 'بيتبعت كرسالة خاصة للمعلّق (مش بيظهر تحت البوست) — Meta بتسمح برد خاص واحد على كل تعليق.'), ta),
      footer: [Button({ type: 'text', label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', icon: 'send', label: 'ابعت على الخاص', attrs: { 'data-private-send': '' }, onClick: async () => { const t = ta.value.trim(); if (!t) { ta.focus(); return; } const r = await A().commentPrivate(c.id, t); if (!done(r, 'اتبعت الرد الخاص')) return; m.close(); R(); } })] });
    setTimeout(() => ta.focus());
  }
  function block(c) {
    const cu = c.who && c.seg !== 'vendors' ? C(c.who) : null; if (!cu) return; const nm = cu.name;
    if (cu.blocked) { A().block(cu.id, false).then((r) => { if (done(r, 'اتفك حظر ' + nm)) R(); }); return; }
    K.form({ title: 'حظر الرقم؟', values: { reason: 'سبام / رسايل مزعجة' }, submitType: 'danger', submitLabel: 'حظر الرقم', note: h('p', { class: 't-body' }, nm + ' — الرسايل الجاية مش هتظهر في صندوق الرسايل، والحملات مش هتبعتله. الأوردرات القديمة هتفضل زي ما هي.'),
      fields: (f, e, set) => [K.field.select('reason', 'السبب', ['سبام / رسايل مزعجة', 'إساءة للفريق', 'طلب العميل', 'أخرى'], f, e, set, { required: true })],
      submit: async (f) => { const r = await A().block(cu.id, true); if (!done(r)) return; await A().event(c.id, 'الرقم اتحظر — ' + f.reason + ' — ' + meName()); K.toast('اتحظر ' + nm); R(); } });
  }
  // رسالة جديدة (6.1): بتفتح محادثة يدوية مع عميل أو مبتكر على قناة؛ القناة متصلة = الرسالة بتتبعت، مش متصلة = المحادثة بتتفتح والرسالة ملاحظة داخلية
  function newMessage(pre) {
    const chans = Object.values(S.channels).filter((c) => c.kind !== 'none');
    if (!chans.length) { K.toast('القنوات لسه ما اتحمّلتش'); return; }
    const isVendorChan = (id) => !!(S.channels[id] && S.channels[id].aud === 'vendors');
    K.form({ title: 'رسالة جديدة', wide: true, values: Object.assign({ from: 'wa1', to: '', text: '' }, pre || {}),
      fields: (f, e, set) => { const toVendors = isVendorChan(f.from); const list = toVendors ? S.vendors : S.customers; const ch = S.channels[f.from];
        return [K.field.select('from', 'هتبعت من', chans.map((c) => ({ value: c.id, label: c.name + (c.status === 'connected' ? '' : ' · مش متصلة') })), f, e, (k, v) => set(k, v, true), { required: true }),
          K.field.select('to', 'لمين', list.map((x) => ({ value: x.id, label: x.name + (x.phone ? ' · ' + x.phone : '') })), f, e, set, { required: true, placeholder: toVendors ? 'اختار المبتكر' : 'اختار العميل' }),
          K.field.area('text', 'الرسالة', f, e, set, { required: true }),
          ch && ch.status !== 'connected' ? U.InlineNote({ kind: 'warning', children: 'القناة دي مش متصلة — المحادثة هتتفتح والرسالة هتتحفظ كملاحظة داخلية لحد ما القناة تتربط.' }) : U.InlineNote({ kind: 'warning', children: 'لحماية الرقم: الرسالة الحرة متاحة بس لو العميل كلمنا آخر 24 ساعة.' })]; },
      validate: (f) => K.req(f, ['to', 'text']), submitLabel: 'إرسال',
      submit: async (f) => { const seg = isVendorChan(f.from) ? 'vendors' : 'customers'; const platform = String(f.from).startsWith('wa') ? 'whatsapp' : f.from;
        let c = S.convs.find((x) => x.seg === seg && x.who === f.to && x.platform === platform && x.status !== 'اتحلت');
        if (!c) { const r = await A().open({ seg, platform, channel: f.from, customerId: seg === 'customers' ? f.to : null, vendorId: seg === 'vendors' ? f.to : null }); if (!done(r)) return; c = r.conv; }
        const live = S.channels[f.from] && S.channels[f.from].status === 'connected';
        const r2 = live ? await A().send(c.id, f.text) : await A().note(c.id, f.text); if (!done(r2)) return;
        st.tab = 'inbox'; st.seg = seg; st.plat = 'all'; st.view = 'all'; st.sel[seg] = c.id; st.mobileChat = true; try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* */ }
        K.toast(live ? 'اتبعتت' : 'اتفتحت المحادثة — الرسالة اتحفظت كملاحظة لحد ما القناة تتربط', 'success'); R(); } });
  }
  // ---- side panel ----
  function sec(title, action, ...body) { return h('div', { class: 'pn-s' }, h('div', { class: 'pn-h' }, h('h3', { class: 't-h5' }, title), action || null), ...body); }
  const link = (label, run) => Button({ type: 'text', size: 'sm', label, onClick: run });
  function OrderRow(o) { return h('div', { class: 'ord' }, h('div', { class: 'r' }, link(o[0], () => openOrder(o[0])), K.Tag(o[1] === 'Completed' ? 'success' : o[1] === 'Cancelled' ? 'neutral' : 'brand', o[1] === 'Completed' ? 'مكتمل' : o[1] === 'Cancelled' ? 'ملغي' : 'قيد التنفيذ')), h('div', { class: 'r t-small' }, h('span', null, o[2]), o[3] ? U.DelayBadge(o[3] === 'AtRisk' ? 'risk' : o[3] === 'Late' ? 'late' : 'ok') : null)); }
  function openOrder(id) { const OA = window.OrdersApp; if (OA && OA.get && OA.get(id)) OA.details(id); else { location.hash = 'orders'; K.toast('الأوردر ' + id + ' بيتفتح من صفحة الأوردرات'); } }
  const cityOf = (cu) => cu.city || cu.province || '—';
  function CustomerPanel(cu, c) {
    const r = ratingOf(cu); const stg = stageOf(cu);
    return h('aside', { class: 'cs-panel', 'aria-label': 'ملف العميل' },
      h('div', { class: 'pn-s' }, h('div', { class: 'pn-who' }, U.Avatar(cu.name), h('div', null, h('b', null, cu.name), h('div', { class: 't-small' }, 'عميل من ' + sinceLabel(cu.since) + ' · ' + cityOf(cu)))),
        h('div', { class: 'tags' }, moodPick(cu), cu.blocked ? K.Tag('error', 'محظور') : null, cu.tags.filter((t) => t !== stg).map((t) => K.Tag(statusTone(t) || tagTone(t), t)), can().reply ? link('+ تاج', () => addTag(cu)) : null),
        h('div', { class: 'row-f' }, h('span', { class: 't-small' }, 'التقييم'), r ? Stars(r.stars) : h('span', null, '—'), h('span', { class: 't-small' }, r ? r.value + (r.manual ? ' · معدّل يدوي' : ' · محسوب') : 'مفيش أوردرات'), h('span', { class: 'grow' }), can().reply ? link('تعديل', () => editRating(cu)) : null, link('الملف الكامل', () => profile(cu)))),
      sec('بيانات التواصل', can().manage ? link('تعديل', () => editContact(cu)) : null, [cu.phone ? U.InfoRow({ label: 'واتساب', value: cu.phone, copy: can().phone, onCopy: (v) => copy(v, 'الرقم') }) : null, cu.ig ? U.InfoRow({ label: 'إنستجرام', value: cu.ig, copy: true, onCopy: (v) => copy(v, 'الحساب') }) : null, cu.address ? U.InfoRow({ label: 'العنوان', value: cu.address }) : null]),
      sec('أرقام الشراء', null, h('div', { class: 'kvg' }, [['الأوردرات', cu.orders], ['إجمالي الشراء', K.n0(cu.total) + ' ج.م'], ['متوسط الأوردر', cu.orders ? K.n0(cu.total / cu.orders) + ' ج.م' : '—'], ['آخر أوردر', cu.lastOrderDays != null ? 'من ' + cu.lastOrderDays + ' يوم' : '—'], ['رفض استلام', cu.refused], ['مرتجع', cu.returned]].map(([k, v]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, k), h('b', null, K.Num(String(v))))))),
      sec('الأوردرات', cu.orderList.length ? link('عرض الكل (' + cu.orders + ')', () => profile(cu, 'orders')) : null, cu.orderList.length ? cu.orderList.map(OrderRow) : h('div', { class: 't-small' }, can().orders ? 'لسه مفيش أوردرات' : 'الأوردرات محتاجة صلاحية عرضها')),
      sec('إجراءات سريعة', null, h('div', { class: 'qa' }, Button({ size: 'sm', label: 'إرسال رابط التتبع', disabled: !cu.orderList.length, onClick: () => { st.draft = fillFor(c, 'تابعي شحنتك من هنا: {رابط_التتبع}'); st.mode = 'reply'; R(); focusComposer(); } }), Button({ size: 'sm', label: 'إرسال لينك دفع', onClick: () => SOON('لينكات الدفع') }), Button({ size: 'sm', label: 'إنشاء أوردر', onClick: () => SOON('إنشاء أوردر من الشات') }), Button({ size: 'sm', label: 'تعديل أوردر', disabled: !cu.orderList.length, attrs: { 'data-edit-order': '', title: cu.orderList.length ? '' : 'مفيش أوردرات للعميل ده' }, onClick: () => editCustOrder(cu, c) }), Button({ size: 'sm', label: 'تحويل لتذكرة', onClick: () => SOON('تذاكر الفريق') }))),
      cu.source ? sec('جه منين', null, h('div', { class: 'r t-small' }, Icon('megaphone', 'sm'), cu.source)) : null);
  }
  function VendorPanel(v, c) {
    if (!v) return h('aside', { class: 'cs-panel' }, sec('المبتكر', null, h('div', { class: 't-small' }, 'المبتكر مش موجود في السجل.')));
    return h('aside', { class: 'cs-panel', 'aria-label': 'ملف المبتكر' },
      h('div', { class: 'pn-s' }, h('div', { class: 'pn-who' }, U.Avatar(v.name), h('div', null, h('b', null, v.name), h('div', { class: 't-small' }, v.craft))), h('div', { class: 'tags' }, U.VendorStatus(v.status || 'active'), v.late ? K.Tag('error', v.late + ' متأخر') : null)),
      sec('التواصل', link('صفحة المبتكر', () => { location.hash = 'vendors'; }), [v.phone ? U.InfoRow({ label: 'واتساب 2', value: v.phone, copy: true, onCopy: (x) => copy(x, 'الرقم') }) : null, U.InfoRow({ label: 'المسؤول عندهم', value: v.contact })]),
      sec('أرقام المبتكر', null, h('div', { class: 'kvg' }, [['فرعي مفتوح', v.open], ['متأخر', v.late], ['مدة التصنيع', v.avg]].map(([k, x]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, k), h('b', null, K.Num(String(x))))))),
      sec('الأوردرات الفرعية المفتوحة', v.open ? link('عرض الكل (' + v.open + ')', () => { location.hash = 'orders'; }) : null, v.subs.length ? v.subs.map((s) => h('div', { class: 'ord' }, h('div', { class: 'r' }, link(s[0], () => openOrder(s[3])), U.DelayBadge(s[2] === 'AtRisk' ? 'risk' : s[2] === 'Late' ? 'late' : 'ok')), h('div', { class: 't-small' }, s[1]))) : h('div', { class: 't-small' }, 'مفيش أوردرات فرعية مفتوحة')),
      sec('إجراءات سريعة', null, h('div', { class: 'qa' }, Button({ size: 'sm', label: 'تذكير بميعاد التسليم', onClick: () => SOON('القوالب') }), Button({ size: 'sm', label: 'تعديل ميعاد التسليم', onClick: () => K.form({ title: 'تعديل ميعاد التسليم', values: { d: today() }, fields: (f, e, set) => [K.field.date('d', 'ميعاد التسليم الجديد', f, e, set, { required: true })], submitLabel: 'حفظ', submit: async (f) => { const r = await A().event(c.id, 'ميعاد تسليم ' + (v.subs[0] ? v.subs[0][0] : '') + ' اتغير لـ ' + K.dlabel(f.d) + ' — ' + meName()); if (done(r)) R(); } }) }), Button({ size: 'sm', label: 'تحويل لتذكرة', onClick: () => SOON('تذاكر الفريق') }))));
  }
  // تعديل أوردر من الشات (owner 1 Nov): لو أكتر من أوردر بيختار الأول؛ بيفتح نفس شاشة تعديل صفحة الأوردرات
  function editCustOrder(cu, c) {
    const open = cu.orderList.filter((o) => o[1] !== 'Completed' && o[1] !== 'Cancelled'); const list = open.length ? open : cu.orderList;
    const go = (id) => { const OA = window.OrdersApp;
      if (OA && OA.get && OA.get(id) && OA.edit) { OA.edit(id); A().event(c.id, 'فتح تعديل الأوردر ' + id + ' من الشات بواسطة ' + meName()); return; }
      location.hash = 'orders'; K.toast('الأوردر ' + id + ' بيتعدل من صفحة الأوردرات'); };
    if (list.length === 1) return go(list[0][0]);
    K.form({ title: 'تعديل أوردر — ' + cu.name, values: { id: list[0][0] }, fields: (f, e, set) => [K.Radios({ label: 'أنهي أوردر؟', options: list.map((o) => ({ value: o[0], label: o[0] + ' · ' + o[2] })), value: f.id, onChange: (v) => set('id', v, true) })], submitLabel: 'كمّل', submit: (f) => setTimeout(() => go(f.id)) });
  }
  // بيانات العميل (cs.manage): الاسم / إنستجرام / المدينة / المحافظة / العناوين / المصدر — التليفون ثابت (مفتاح الأوردرات)
  function editContact(cu) { K.form({ title: 'تعديل بيانات — ' + cu.name, wide: true, values: { name: cu.name, ig: cu.ig || '', city: cu.city || '', province: cu.province || '', address: cu.address || '', address2: cu.address2 || '', source: cu.source || '' },
    note: U.InlineNote({ children: 'الموبايل ' + (cu.phone || '—') + ' ثابت — هو اللي بيربط العميل بأوردراته. لو العميل غيّر رقمه ضيفه كعميل جديد وادمجهم.' }),
    fields: (f, e, set) => [K.two(K.field.text('name', 'الاسم', f, e, set, { required: true }), K.field.text('ig', 'إنستجرام', f, e, set)), K.two(K.field.text('city', 'المدينة / المنطقة', f, e, set), K.field.text('province', 'المحافظة', f, e, set)), K.field.area('address', 'العنوان الأساسي', f, e, set), K.field.area('address2', 'عنوان تاني', f, e, set), K.field.text('source', 'جه منين', f, e, set)],
    validate: (f) => K.req(f, ['name']), submit: async (f) => { const r = await A().updateCustomer(cu.id, f); if (done(r, 'اتحفظ')) R(); } }); }
  function Inbox() {
    const c = conv() || filtered()[0]; if (c && !conv()) st.sel[st.seg] = c.id;
    const open = st.panel !== false;
    const panel = !c ? null : c.seg === 'vendors' ? VendorPanel(V(c.who), c) : c.who && C(c.who) ? CustomerPanel(C(c.who), c) : h('aside', { class: 'cs-panel' }, sec('الحساب', null, h('div', { class: 't-small' }, (c.handle || '—') + ' — مش مربوط بعميل'), Button({ size: 'sm', label: 'ربط بعميل موجود', onClick: () => SOON('ربط الحساب بعميل') })));
    return h('div', { class: 'cs-inbox' + (st.mobileChat ? ' show-chat' : '') + (open ? '' : ' no-panel'), 'data-panel': open ? 'open' : 'closed' }, ListCol(), ChatCol(c), open ? panel : null);
  }

  // ======================= customers (CRM) =======================
  function matchFilters(f) {
    const q = String(f.q || '').trim().toLowerCase();
    return S.customers.filter((cu) => (!q || (cu.name + ' ' + cu.phone + ' ' + (cu.ig || '') + ' ' + (cu.orderList || []).map((o) => o[0]).join(' ')).toLowerCase().includes(q)) && (!f.stage || moodOf(cu) === f.stage) && (!f.tag || cu.tags.includes(f.tag)) && (!f.rating || ((ratingOf(cu) || { stars: 0 }).stars >= Number(f.rating))) && (!f.prov || cu.province === f.prov) && (!f.chan || cu.channels.includes(f.chan)) && (!f.problems || cu.lateOpen || cu.openComplaints) && (!(f.moods || []).length || f.moods.includes(moodOf(cu))) && (!(f.provs || []).length || f.provs.includes(cu.province)) && (!(f.chans || []).length || f.chans.some((ch) => cu.channels.includes(ch))));
  }
  const filterDesc = (f) => [f.q ? 'بحث «' + f.q + '»' : '', f.stage ? 'الحالة: ' + f.stage : '', f.tag ? 'التاج: ' + f.tag : '', f.rating ? 'التقييم ' + f.rating + '+' : '', f.prov ? 'المحافظة: ' + f.prov : '', f.chan ? 'القناة: ' + (PL[f.chan] ? PL[f.chan][0] : f.chan) : '', f.problems ? 'عندهم مشكلة' : ''].filter(Boolean).join(' · ');
  function filtersBar(f, onChange, idp) {
    const all = S.customers;
    const sel = (id, label, opts, key) => U.Select({ id: idp + id, label: null, options: [{ value: '', label: label + ': الكل' }].concat(opts.map((o) => (typeof o === 'string' ? { value: o, label: label + ': ' + o } : o))), value: f[key], onChange: (v) => { f[key] = v; onChange(); } });
    const q = h('input', { type: 'search', value: f.q || '', placeholder: 'ابحث بالاسم أو الرقم أو الحساب', 'aria-label': 'بحث في العملاء' }); q.addEventListener('change', () => { f.q = q.value; onChange(); });
    return [h('label', { class: 'search search-field' }, Icon('search', 'sm'), q), sel('stage', 'الحالة', MOODS.map((x) => x[0]), 'stage'), sel('tag', 'التاج', [...new Set(all.flatMap((x) => x.tags))], 'tag'), sel('rate', 'التقييم', [{ value: '4', label: 'التقييم: 4+' }, { value: '3', label: 'التقييم: 3+' }], 'rating'), sel('prov', 'المحافظة', [...new Set(all.map((x) => x.province).filter((x) => x && x !== '—'))], 'prov'), sel('chan', 'القناة', [{ value: 'whatsapp', label: 'القناة: واتساب' }, { value: 'messenger', label: 'القناة: ماسنجر' }, { value: 'instagram', label: 'القناة: إنستجرام' }, { value: 'tiktok', label: 'القناة: تيك توك' }], 'chan'), K.Checkbox({ label: 'عندهم مشكلة بس', checked: !!f.problems, onChange: (v) => { f.problems = v; onChange(); } })];
  }
  const CUST_SORTS = [['recent', 'آخر تعامل: الأحدث للأقدم'], ['oldest', 'آخر تعامل: الأقدم للأحدث'], ['rating_desc', 'التقييم: الأعلى للأقل'], ['rating_asc', 'التقييم: الأقل للأعلى'], ['orders_desc', 'مرات الشراء: الأكتر للأقل'], ['orders_asc', 'مرات الشراء: الأقل للأكتر']];
  const lastAct = (cu) => (cu.lastActive ? Date.parse(cu.lastActive) || 0 : 0);
  const rateV = (cu) => { const r = ratingOf(cu); return r ? r.value : -1; };
  function custRows() {
    const l = matchFilters(st.cust).slice(); const k = st.cust.sort || 'recent';
    const by = { recent: (a, b) => lastAct(b) - lastAct(a), oldest: (a, b) => lastAct(a) - lastAct(b), rating_desc: (a, b) => rateV(b) - rateV(a), rating_asc: (a, b) => rateV(a) - rateV(b), orders_desc: (a, b) => b.orders - a.orders, orders_asc: (a, b) => a.orders - b.orders }[k];
    return by ? l.sort(by) : l;
  }
  const custFilterCount = (f) => (f.moods || []).length + (f.rating ? 1 : 0) + (f.provs || []).length + (f.chans || []).length + (f.problems ? 1 : 0);
  function custChips(f, rows) {
    const n = (patch) => matchFilters(Object.assign({ q: '', moods: [], provs: [], chans: [], rating: '', problems: false }, patch)).length; const chips = [];
    const ch = (key, label, patch, reset) => chips.push({ key, label, count: n(patch), remove: () => { reset(); f.page = 1; R(); } });
    if (f.q) ch('q', 'بحث: ' + f.q, { q: f.q }, () => { f.q = ''; });
    (f.moods || []).forEach((v) => ch('mood:' + v, 'الحالة: ' + v, { moods: [v] }, () => { f.moods = f.moods.filter((x) => x !== v); }));
    if (f.rating) ch('rating', 'التقييم: ' + f.rating + ' نجوم وأكتر', { rating: f.rating }, () => { f.rating = ''; });
    (f.provs || []).forEach((v) => ch('prov:' + v, 'المحافظة: ' + v, { provs: [v] }, () => { f.provs = f.provs.filter((x) => x !== v); }));
    const CH = { whatsapp: 'واتساب', messenger: 'ماسنجر', instagram: 'إنستجرام', tiktok: 'تيك توك' };
    (f.chans || []).forEach((v) => ch('chan:' + v, 'القناة: ' + (CH[v] || v), { chans: [v] }, () => { f.chans = f.chans.filter((x) => x !== v); }));
    if (f.problems) ch('problems', 'عندهم مشكلة', { problems: true }, () => { f.problems = false; });
    return K.ActiveFilters({ id: 'customers', chips, total: rows.length, noun: 'عميل', onClear: () => { Object.assign(f, { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false, moods: [], provs: [], chans: [] }); f.page = 1; R(); } });
  }
  function custFilterMenu(f, onApply) {
    const wrap = h('div', { class: 'pop-anchor cfm', 'data-popover-root': '' });
    const n0 = custFilterCount(f);
    const btn = h('button', { type: 'button', class: 'select sm' + (n0 ? ' has-val' : ''), 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'فلتر العملاء', 'data-cust-filter-btn': '' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, Icon('filter', 'sm'), ' فلتر' + (n0 ? ' (' + n0 + ')' : '')));
    const pop = U.popover(wrap, btn, (close) => {
      const d = { moods: [...(f.moods || [])], rating: f.rating || '', provs: [...(f.provs || [])], chans: [...(f.chans || [])], problems: !!f.problems };
      const cnt = h('span', null); const upd = () => { const n = matchFilters(Object.assign({}, f, d)).length; cnt.textContent = 'اعرض ' + n + ' عميل'; };
      const box = (on) => h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null);
      const opt = (label, content, isOn, toggle, attrs, radio) => { const b = h('button', Object.assign({ type: 'button', class: 'opt multi', role: radio ? 'menuitemradio' : 'menuitemcheckbox', 'aria-checked': String(isOn()), 'aria-label': label }, attrs || {}), box(isOn()), content || label);
        b.addEventListener('click', (e) => { e.stopPropagation(); toggle(); m.querySelectorAll('.opt.multi').forEach((x) => { const on = x._on(); x.setAttribute('aria-checked', String(on)); x.querySelector('.mchk').replaceChildren(...(on ? [Icon('check', 'sm')] : [])); }); upd(); }); b._on = isOn; return b; };
      const arr = (key, v) => () => { const a = d[key]; const i = a.indexOf(v); if (i > -1) a.splice(i, 1); else a.push(v); };
      const provs = [...new Set(S.customers.map((x) => x.province).filter((x) => x && x !== '—'))];
      const grp = (t) => h('div', { class: 'opt-group t-small', role: 'presentation' }, t);
      const m = h('div', { class: 'menu view-menu cust-filter-menu', role: 'menu', 'aria-label': 'فلتر العملاء', 'data-cust-filter-menu': '' },
        grp('الحالة'), MOODS.map(([t, tone]) => opt(t, K.Tag(tone, t), () => d.moods.includes(t), arr('moods', t), { 'data-cf': 'mood:' + t })),
        grp('التقييم'), [['4', '4 نجوم وأكتر'], ['3', '3 نجوم وأكتر']].map(([v, l]) => opt(l, null, () => d.rating === v, () => { d.rating = d.rating === v ? '' : v; }, { 'data-cf': 'rating:' + v }, true)),
        provs.length ? [grp('المحافظة'), provs.map((p) => opt(p, null, () => d.provs.includes(p), arr('provs', p), { 'data-cf': 'prov:' + p }))] : null,
        grp('القناة'), [['whatsapp', 'واتساب'], ['messenger', 'ماسنجر'], ['instagram', 'إنستجرام'], ['tiktok', 'تيك توك']].map(([v, l]) => opt(l, h('span', { class: 'row-f' }, PlatIcon(v), l), () => d.chans.includes(v), arr('chans', v), { 'data-cf': 'chan:' + v })),
        grp('أخرى'), opt('عندهم مشكلة بس', null, () => d.problems, () => { d.problems = !d.problems; }, { 'data-cf': 'problems' }),
        h('div', { class: 'view-foot' }, Button({ size: 'sm', type: 'text', label: 'مسح', attrs: { 'data-cf-clear': '' }, onClick: () => { d.moods = []; d.rating = ''; d.provs = []; d.chans = []; d.problems = false; m.querySelectorAll('.opt.multi').forEach((x) => { x.setAttribute('aria-checked', 'false'); x.querySelector('.mchk').replaceChildren(); }); upd(); } }),
          Button({ size: 'sm', type: 'primary', label: cnt, attrs: { 'data-cf-apply': '' }, onClick: () => { Object.assign(f, d); f.page = 1; if (f.picked) f.picked.clear(); close(); if (onApply) onApply(); else R(); } })));
      menuKeysLite(m); upd(); return m; });
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  let csTimer = null;
  function custSearch(f) {
    const q = h('input', { type: 'search', id: 'cust-q', value: f.q || '', placeholder: 'ابحث بالاسم أو رقم التليفون أو رقم الأوردر', 'aria-label': 'بحث في العملاء بالاسم أو رقم التليفون أو رقم الأوردر', autocomplete: 'off' });
    q.addEventListener('input', () => { clearTimeout(csTimer); csTimer = setTimeout(() => { const pos = q.selectionStart; f.q = q.value; f.page = 1; R(); const n = document.getElementById('cust-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* */ } } }, 250); });
    return h('label', { class: 'search search-field', 'data-cust-search': '' }, Icon('search', 'sm'), q);
  }
  function menuKeysLite(menu) { menu.addEventListener('keydown', (e) => { const items = [...menu.querySelectorAll('.opt.multi')]; const i = items.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } }); }
  // ======================= KPI «التفاصيل» (owner, 22 Oct) — on the real lists =======================
  const pctS = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%';
  const custRow = (cu) => { const r = ratingOf(cu); return [cu.name, moodOf(cu), String(cu.orders), K.n0(cu.total) + ' ج.م', cu.lastOrderDays == null ? '—' : 'من ' + cu.lastOrderDays + ' يوم', r ? String(r.value) : '—']; };
  const CUST_H = ['العميل', 'الحالة', 'الأوردرات', 'إجمالي الشراء', 'آخر أوردر', 'التقييم'];
  const buyers = () => S.customers.filter((cu) => cu.orders >= 1); const repeaters = () => S.customers.filter((cu) => cu.orders >= 2);
  const avgRating = () => { const l = S.customers.map(ratingOf).filter(Boolean); return l.length ? r1(l.reduce((a, r) => a + r.value, 0) / l.length) : null; };
  const DET = {
    custTotal: () => { const all = S.customers; const by = {}; all.forEach((cu) => { const k = cu.channels[0] ? PL[cu.channels[0]][0] : cu.createdFrom === 'orders' ? 'الموقع (أوردرات)' : 'إضافة يدوية / استيراد'; by[k] = (by[k] || 0) + 1; }); const ch = Object.entries(by).sort((a, b) => b[1] - a[1]); const tot = all.length;
      return { title: 'إجمالي العملاء — ' + K.n0(tot), sub: 'كل العملاء في السيستم (من الأوردرات + الإضافة اليدوية) · حسب القناة الأساسية', summary: [{ label: 'إجمالي', value: K.n0(tot) + ' عميل' }, { label: 'اشتروا مرة على الأقل', value: K.n0(buyers().length) }, { label: 'لسه ما اشتروش', value: K.n0(tot - buyers().length) }], headers: ['القناة الأساسية', 'عدد العملاء', 'النسبة'], rows: ch.map(([l, n]) => [l, K.n0(n), pctS(n, tot)]).concat([['الإجمالي', K.n0(tot), '100%']]), source: 'cs_customers (الأوردرات + الإضافة اليدوية + الاستيراد)' }; },
    custRepeat: () => { const l = repeaters().sort((a, b) => b.orders - a.orders); const b = buyers().length;
      return { title: 'عملاء متكررين — ' + pctS(l.length, b), sub: K.n0(l.length) + ' عميل اشتروا مرتين أو أكتر من ' + K.n0(b) + ' عميل اشتروا · اضغط يفتح ملفه', summary: [{ label: 'متكررين', value: K.n0(l.length) }, { label: 'اشتروا مرة', value: K.n0(b - l.length) }, { label: 'النسبة', value: pctS(l.length, b) }], headers: CUST_H, rows: l.map(custRow), onRow: (i) => profile(l[i]), source: 'الأوردرات لكل عميل (من غير الملغي والمرتجع)' }; },
    custRating: () => { const rated = S.customers.map((cu) => [cu, ratingOf(cu)]).filter((x) => x[1]); const d = [5, 4, 3, 2, 1].map((s) => [s, rated.filter((x) => x[1].stars === s).length]); const n = rated.length; const avg = avgRating(); const low = rated.filter((x) => x[1].value < 4).map((x) => x[0]);
      return { title: 'متوسط التقييم — ' + (avg == null ? '—' : avg + ' من 5'), sub: 'توزيع التقييم على ' + K.n0(n) + ' عميل عندهم أوردرات', summary: [{ label: 'المتوسط', value: avg == null ? '—' : avg + ' من 5' }, { label: 'عملاء متقيّمين', value: K.n0(n) }, { label: 'أقل من 4', value: low.map((x) => x.name).slice(0, 8).join('، ') || '—' }], headers: ['التقييم', 'عدد العملاء', 'النسبة'], rows: d.map(([st_, c]) => [st_ + ' ★', K.n0(c), pctS(c, n)]), note: 'التقييم = 5 − (1 × رفض استلام) − (0.4 × مرتجع) − (0.2 × شكوى مفتوحة) − (0.2 × أوردر مفتوح متأخر)، أقل حاجة 1. التعديل اليدوي محتاج سبب.', source: 'IbtekrCS.customerRating على أرقام الأوردرات' }; },
    custProblems: () => { const l = S.customers.filter((x) => x.lateOpen || x.openComplaints);
      return { title: 'عملاء عندهم مشكلة — ' + l.length, sub: 'أوردر مفتوح متأخر أو شكوى مفتوحة · اضغط على العميل يفتح ملفه', summary: [{ label: 'أوردر متأخر', value: String(l.filter((x) => x.lateOpen).length) }, { label: 'شكوى مفتوحة', value: String(l.filter((x) => x.openComplaints).length) }], headers: ['العميل', 'المشكلة', 'الموبايل', 'الأوردرات', 'آخر أوردر', 'آخر نشاط'], rows: l.map((cu) => [cu.name, [cu.lateOpen ? cu.lateOpen + ' أوردر متأخر' : '', cu.openComplaints ? cu.openComplaints + ' شكوى مفتوحة' : ''].filter(Boolean).join(' + '), cu.phone || '—', String(cu.orders), cu.lastOrderDays == null ? '—' : 'من ' + cu.lastOrderDays + ' يوم', whenLabel(cu.lastActive)]), onRow: (i) => profile(l[i]), source: 'الأوردرات المفتوحة 11+ يوم والمحادثات المفتوحة بتاج «شكوى»' }; },
    campRows: () => { const list = S.campaigns.filter((k) => k.sent).map((k) => ({ id: k.id, name: k.name, sent: k.sent, delivered: k.delivered || k.sent, read: k.read || 0, replies: k.replies || 0, orders: k.orders || 0, revenue: k.revenue || 0 }));
      const tot = list.reduce((a, x) => { ['sent', 'delivered', 'read', 'replies', 'orders', 'revenue'].forEach((f) => { a[f] += x[f]; }); return a; }, { sent: 0, delivered: 0, read: 0, replies: 0, orders: 0, revenue: 0 }); return { list, tot }; },
    camp: (focus) => { const { list, tot } = DET.campRows(); const T = { sent: 'رسايل اتبعتت — ' + K.n0(tot.sent), read: 'نسبة القراءة — ' + pctS(tot.read, tot.delivered), replies: 'ردود — ' + K.n0(tot.replies), orders: 'أوردرات من الحملات — ' + tot.orders };
      const sum = { sent: [{ label: 'اتبعتت', value: K.n0(tot.sent) }, { label: 'اتسلمت', value: K.n0(tot.delivered) }, { label: 'موصلتش', value: K.n0(tot.sent - tot.delivered) }], read: [{ label: 'اتقرت', value: K.n0(tot.read) }, { label: 'من اللي اتسلمت', value: K.n0(tot.delivered) }, { label: 'النسبة', value: pctS(tot.read, tot.delivered) }], replies: [{ label: 'ردود', value: K.n0(tot.replies) }, { label: 'من اللي قروا', value: pctS(tot.replies, tot.read) }], orders: [{ label: 'أوردرات', value: String(tot.orders) }, { label: 'الإيراد', value: K.n0(tot.revenue) + ' ج.م' }, { label: 'متوسط الأوردر', value: K.n0(tot.revenue / (tot.orders || 1)) + ' ج.م' }] }[focus];
      return { title: T[focus], sub: 'كل حملة اتبعتت · اضغط على الحملة يفتح تفاصيلها', summary: sum, headers: ['الحملة', 'اتبعتت', 'اتسلمت', 'اتقرت', 'ردود', 'أوردرات', 'الإيراد'], rows: list.map((x) => [x.name, K.n0(x.sent), K.n0(x.delivered), K.n0(x.read), K.n0(x.replies), String(x.orders), K.n0(x.revenue) + ' ج.م']).concat([['الإجمالي', K.n0(tot.sent), K.n0(tot.delivered), K.n0(tot.read), K.n0(tot.replies), String(tot.orders), K.n0(tot.revenue) + ' ج.م']]), onRow: (i) => { const x = list[i]; if (x && x.id) { st.tab = 'campaigns'; st.campaign = x.id; R(); window.scrollTo(0, 0); } }, empty: 'لسه مفيش حملات اتبعتت — الإرسال بيبدأ مع ربط القنوات.', source: 'cs_campaigns.stats (بيتحدث مع الإرسال)' }; },
  };
  const teamCell = (cu) => { const t = teamOf(cu); if (!t.count) return h('span', { class: 't-small help', 'data-team': '0' }, '—');
    return h('span', { class: 'team-cell', 'data-team': String(t.overall), title: CS.RATE_KEYS.map(([k, l]) => l + ' ' + (t.avg[k] == null ? '—' : t.avg[k])).join(' · ') + ' · ' + t.count + ' تقييم' }, U.Icon('star', 'sm'), K.Num(String(t.overall)), h('small', { class: 't-small help' }, '(' + t.count + ')')); };
  const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/xlsx.full.min.js'; sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.append(sc); }));
  const SHEET_SAMPLE = '﻿الاسم,الموبايل\nنهى عبد الرحمن,01012345678\nعميل جديد,01099999999\n';
  // a sheet (Excel / CSV) → IbtekrCS.matchSheet against the loaded customers → cb({ name, matched, missing, newRows, invalid, total, header, error? })
  function readSheetFile(file, cb) {
    const done_ = (text) => { const X = window.IbtekrDataX; const parsed = X.parseCSV(text); cb(Object.assign({ name: file.name }, CS.matchSheet(parsed, S.customers))); };
    if (/\.(xlsx|xls)$/i.test(file.name)) loadXLSX().then((XL) => file.arrayBuffer().then((buf) => { const wb = XL.read(buf, { type: 'array' }); done_(XL.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: '\t' })); })).catch(() => cb({ name: file.name, error: 'معرفناش نقرا ملف Excel هنا — احفظه CSV وارفعه تاني.', matched: [], missing: [], newRows: [], total: 0 }));
    else file.text().then(done_);
  }
  const sheetNote = (res) => (res.error ? U.InlineNote({ kind: 'error', children: res.error }) : U.InlineNote({ kind: res.missing.length || res.invalid ? 'warning' : null, children: h('span', { 'data-sheet-res': '' }, 'لقينا ' + res.matched.length + ' عميل من ' + res.total + ' صف (عمود «' + res.header + '»)' + (res.missing.length ? ' · ' + res.missing.length + ' رقم مش عندنا: ' + res.missing.slice(0, 5).join('، ') + (res.missing.length > 5 ? '…' : '') : '') + (res.invalid ? ' · ' + res.invalid + ' رقم مش صحيح' : '')) }));
  // ======================= شرايح العملاء (owner 28 Oct) — saved through IBCS.saveSegment =======================
  const segCustomers = (g) => S.customers.filter((cu) => inSeg(cu, g));
  const saveSeg = (g, okMsg) => A().saveSegment(g).then((r) => { if (done(r, okMsg)) R(); return r; });
  const segBase = (name) => ({ name, minTotal: '', minOrders: '', moods: [], last: '', lastFrom: '', lastTo: '', ranges: {}, includeUnrated: false, add: [], remove: [] });
  // شريحة جديدة / تعديل شريحة على مرحلتين (owner 1 Nov): 1) الشروط  2) العملاء المطابقين متحددين تلقائي → تشيل اللي مش عايزه
  function editSegment(g0) {
    const g = g0 || null; const rg = (k) => ((g && g.ranges && g.ranges[k]) || [1, 5]);
    const v = { step: 1, name: g ? g.name : '', minTotal: g && g.minTotal !== '' && g.minTotal != null ? String(g.minTotal) : '', minOrders: g && g.minOrders !== '' && g.minOrders != null ? String(g.minOrders) : '', includeUnrated: !!(g && g.includeUnrated), moods: g && Array.isArray(g.moods) ? g.moods.slice() : [], last: g ? g.last || '' : '', lastFrom: g ? g.lastFrom || '' : '', lastTo: g ? g.lastTo || '' : '', q: '' };
    CS.RATE_KEYS.forEach(([k]) => { v[k + 'Lo'] = String(rg(k)[0]); v[k + 'Hi'] = String(rg(k)[1]); });
    const toSeg = (ff) => { const ranges = {}; CS.RATE_KEYS.forEach(([k]) => { ranges[k] = [Number(ff[k + 'Lo']), Number(ff[k + 'Hi'])]; }); return { name: (ff.name || '').trim(), minTotal: String(ff.minTotal || '').trim(), minOrders: String(ff.minOrders || '').trim(), ranges, includeUnrated: !!ff.includeUnrated, moods: ff.moods.slice(), last: ff.last || '', lastFrom: ff.last === 'range' ? ff.lastFrom || '' : '', lastTo: ff.last === 'range' ? ff.lastTo || '' : '', add: [], remove: [] }; };
    const others = segs().filter((x) => x !== g).map((x) => x.name);
    const stars = ['1', '2', '3', '4', '5'].map((x) => ({ value: x, label: x + ' ★' }));
    const matchOf = (ff) => S.customers.filter((cu) => CS.segmentMatch(cu, toSeg(ff), teamOf(cu), today()));
    const countTxt = (ff) => { const sg = toSeg(ff); const bad = Object.keys(CS.validateSegment(sg, others)).filter((x) => x !== 'name').length; if (bad) return 'كمّل الشروط عشان تشوف عدد العملاء.'; if (!CS.segmentHasRules(sg)) return 'حط شرط واحد على الأقل (حالة العميل أو آخر أوردر أو عدد أوردرات أو قيمة شراء أو تقييم) عشان تشوف عدد العملاء.'; return 'هيطلع ' + matchOf(ff).length + ' عميل — ' + CS.segmentLabel(sg); };
    const refresh = (ff) => { const el = document.getElementById('sg-count'); if (el) el.textContent = countTxt(ff); };
    let chosen = null; let redraw = null; const seen = new Set();
    const steps = (ff) => h('ol', { class: 'seg-steps', 'aria-label': 'خطوات الشريحة' }, [[1, 'الشروط'], [2, 'العملاء']].map(([n, l]) => h('li', { class: ff.step === n ? 'cur' : ff.step > n ? 'done' : '', 'aria-current': ff.step === n ? 'step' : null }, h('span', { class: 'n' }, String(n)), h('span', null, l))));
    const lastOpts = [['', 'أي وقت'], ...Object.entries(CS.SEG_LAST).map(([k, x]) => [k, x[0]]), ['range', 'من تاريخ لتاريخ']].map(([v_, l]) => ({ value: v_, label: l }));
    K.form({ title: g ? 'تعديل شريحة — ' + g.name : 'شريحة جديدة', wide: true, values: v,
      note: (ff) => h('div', { class: 'stack' }, steps(ff), ff.step === 1 ? U.InlineNote({ children: h('span', { id: 'sg-count', 'aria-live': 'polite' }, countTxt(ff)) }) : null),
      fields: (ff, e, set, draw) => { redraw = draw;
        if (ff.step === 2) {
          const all = matchOf(ff); const q = ff.q.trim().toLowerCase(); const shown = all.filter((cu) => !q || (cu.name + ' ' + (cu.phone || '')).toLowerCase().includes(q)); const allOn = all.length && all.every((cu) => chosen.has(cu.id));
          const srch = h('input', { type: 'search', id: 'sg-q', value: ff.q, placeholder: 'ابحث بالاسم أو الرقم', 'aria-label': 'بحث في العملاء المطابقين' }); srch.addEventListener('input', () => { set('q', srch.value, true); });
          return [h('div', { class: 'stack', 'data-seg-step2': '' },
            h('div', { class: 'row-f' }, h('b', { 'data-sg-picked': String(chosen.size) }, chosen.size + ' من ' + all.length + ' عميل متحددين'), h('span', { class: 'grow' }), all.length ? Button({ size: 'sm', label: allOn ? 'شيل تحديد الكل' : 'حدد الكل (' + all.length + ')', attrs: { 'data-sg-all': '' }, onClick: () => { all.forEach((cu) => (allOn ? chosen.delete(cu.id) : chosen.add(cu.id))); draw(); } }) : null),
            h('p', { class: 't-small help', style: 'margin:0' }, CS.segmentLabel(toSeg(ff)) + ' · العملاء المطابقين متحددين تلقائي — شيل علامة اللي مش عايزه في الشريحة.'),
            all.length > 6 ? h('label', { class: 'search search-field' }, Icon('search', 'sm'), srch) : null,
            all.length ? h('div', { class: 'pick-list seg-pick', role: 'group', 'aria-label': 'العملاء المطابقين' }, shown.map((cu) => { const r = ratingOf(cu); return h('label', { class: 'pick-row', 'data-sg-row': cu.id },
              K.Checkbox({ small: true, label: '', checked: chosen.has(cu.id), onChange: (x) => { x ? chosen.add(cu.id) : chosen.delete(cu.id); draw(); } }),
              U.Avatar(cu.name), h('span', { class: 'pick-who' }, h('b', null, cu.name), h('span', { class: 't-small', dir: 'ltr' }, cu.phone || cu.ig || '—')), h('span', { class: 'grow' }),
              h('span', { class: 't-small help' }, cu.lastOrderDays == null ? 'مفيش أوردرات' : 'آخر أوردر من ' + cu.lastOrderDays + ' يوم'), r ? Stars(r.stars) : null, K.Tag(moodTone(moodOf(cu)), moodOf(cu))); }))
              : K.Empty('مفيش عملاء مطابقين للشروط دي', 'ارجع غيّر الشروط — أو احفظ الشريحة فاضية وضيف عملاء بالإيد بعدين.'),
            !chosen.size && all.length ? U.InlineNote({ kind: 'warning', children: 'مفيش ولا عميل متحدد — الشريحة هتتحفظ فاضية.' }) : null)];
        }
        const upd = (k, x) => { set(k, x); refresh(ff); };
        return [K.field.text('name', 'اسم الشريحة', ff, e, set, { required: true, placeholder: 'مثلاً: VIP راضيين' }),
          h('fieldset', { class: 'blk', 'data-sg-moods': '' }, h('legend', null, 'حالة العميل'), h('div', { class: 'chips' }, MOODS.map(([m_, tone]) => { const on = ff.moods.includes(m_); return h('button', { type: 'button', class: 'mood-chip', role: 'checkbox', 'aria-checked': String(on), 'data-sg-mood': m_, onClick: () => { const a = ff.moods; const i_ = a.indexOf(m_); if (i_ > -1) a.splice(i_, 1); else a.push(m_); set('moods', a, true); } }, h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), K.Tag(tone, m_)); })), h('p', { class: 't-small help', style: 'margin:0' }, 'اختار حالة أو أكتر — من غير اختيار = أي حالة.')),
          h('fieldset', { class: 'blk', 'data-sg-last': '' }, h('legend', null, 'تاريخ آخر أوردر'), K.field.select('last', null, lastOpts, ff, e, (k, x) => set(k, x, true)),
            ff.last === 'range' ? h('div', { class: 'row cols2' }, K.field.date('lastFrom', 'من', ff, e, (k, x) => set(k, x, true)), K.field.date('lastTo', 'لحد', ff, e, (k, x) => set(k, x, true))) : null,
            e.last ? h('div', { class: 'err-msg', role: 'alert' }, e.last) : null),
          h('div', { class: 'row cols2' }, K.field.text('minTotal', 'إجمالي الشراء أكبر من أو يساوي (ج.م)', ff, e, upd, { inputmode: 'numeric', placeholder: 'مثلاً 5000 — فاضي = أي قيمة' }), K.field.text('minOrders', 'عدد الأوردرات أكبر من أو يساوي', ff, e, upd, { inputmode: 'numeric', placeholder: 'فاضي = أي عدد' })),
          h('fieldset', { class: 'blk seg-rates' }, h('legend', null, 'تقييم الفريق للعميل (متوسط تقييماته)'),
            CS.RATE_KEYS.map(([k, l]) => h('div', { class: 'seg-rate' + (e[k] ? ' has-err' : '') }, h('span', { class: 't-label' }, l),
              K.field.select(k + 'Lo', 'من', stars, ff, e, (kk, x) => set(kk, x, true)), K.field.select(k + 'Hi', 'لحد', stars, ff, e, (kk, x) => set(kk, x, true)),
              e[k] ? h('div', { class: 'err-msg', role: 'alert' }, e[k]) : null)),
            K.Switch({ id: 'sg-unrated', label: 'ضم العملاء اللي لسه ما اتقيّموش', help: 'من 1 لحد 5 = من غير شرط على التقييم', checked: ff.includeUnrated, onChange: (x) => set('includeUnrated', x, true) })),
          e.rules ? U.InlineNote({ kind: 'error', children: e.rules }) : null]; },
      validate: (ff) => (ff.step === 1 ? CS.validateSegment(toSeg(ff), others) : {}),
      extraFooter: (ff) => (ff.step === 2 ? Button({ type: 'text', icon: 'chevR', label: 'رجوع للشروط', attrs: { 'data-sg-back': '' }, onClick: () => { ff.step = 1; redraw(); } }) : null),
      submitLabel: (ff) => (ff.step === 1 ? 'التالي — العملاء' : g ? 'احفظ الشريحة' : 'أنشئ الشريحة (' + (chosen ? chosen.size : 0) + ' عميل)'),
      submit: (ff) => {
        // step 1 → 2 stays in the form (a sync `false`); the save itself is async and the form closes meanwhile
        if (ff.step === 1) { const all = matchOf(ff); const prevRemoved = chosen ? all.map((cu) => cu.id).filter((id) => seen.has(id) && !chosen.has(id)) : g && Array.isArray(g.remove) ? g.remove : []; all.forEach((cu) => seen.add(cu.id)); chosen = new Set(all.map((cu) => cu.id).filter((id) => !prevRemoved.includes(id))); if (g && Array.isArray(g.add)) g.add.forEach((id) => { if (all.some((cu) => cu.id === id)) chosen.add(id); }); ff.step = 2; ff.q = ''; redraw(); return false; }
        const sg = toSeg(ff); const all = matchOf(ff); sg.remove = all.filter((cu) => !chosen.has(cu.id)).map((cu) => cu.id); sg.add = g && Array.isArray(g.add) ? g.add.filter((id) => !all.some((cu) => cu.id === id)) : [];
        if (g) sg.id = g.id; const n = chosen.size;
        A().saveSegment(sg).then((r) => { if (!done(r)) return;
          if (!g) { st.tab = 'segments'; st.segs.open = r.segment.id; st.segs.picked.clear(); try { history.replaceState(null, '', '#cs-segments'); } catch (e) { /* */ } }
          st.cust.picked.clear(); K.toast(g ? 'اتحفظت الشريحة' : 'اتعملت شريحة «' + sg.name + '» فيها ' + n + ' عميل', 'success'); R(); });
        return true; } });
  }
  function delSegment(g) {
    const m = U.Modal({ title: 'مسح شريحة «' + g.name + '»؟', body: [h('p', { style: 'margin:0' }, 'الشريحة بس هتتمسح — العملاء والتقييمات مش هيتأثروا.')], footer: [Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'danger', label: 'امسح الشريحة', attrs: { 'data-seg-del-ok': '' }, onClick: async () => { m.close(); const r = await A().deleteSegment(g.id); if (!done(r, 'اتمسحت الشريحة')) return; st.cust.seg = ''; if (st.segs.open === g.id) st.segs.open = ''; R(); } })] });
  }
  const NEW_SEG = '__new';
  function addToSegment(ids) {
    const L = segs();
    K.form({ title: 'إضافة ' + ids.length + ' عميل لشريحة', values: { seg: L[0] ? L[0].id : NEW_SEG, newName: '' },
      note: U.InlineNote({ children: 'العميل بيتضاف للشريحة بالإيد حتى لو مش مطابق لشروطها — وتقدر تشيله بعدين من تاب «شرايح العملاء».' }),
      fields: (ff, e, set) => [K.field.select('seg', 'الشريحة', L.map((x) => ({ value: x.id, label: x.name + ' · ' + segCustomers(x).length + ' عميل' })).concat([{ value: NEW_SEG, label: '+ إضافة شريحة جديدة' }]), ff, e, (k, v) => set(k, v, true), { required: true }),
        ff.seg === NEW_SEG ? K.field.text('newName', 'اسم الشريحة', ff, e, set, { required: true, placeholder: 'مثلاً: عملاء معرض ديسمبر', help: 'شريحة يدوية — فيها العملاء اللي اخترتهم بس، وتقدر تزود عليها شروط بعدين.' }) : null],
      validate: (ff) => { if (!ff.seg) return { seg: 'اختار شريحة' }; if (ff.seg !== NEW_SEG) return {}; const n = String(ff.newName || '').trim(); if (!n) return { newName: 'اكتب اسم الشريحة' }; if (L.some((x) => x.name.trim().toLowerCase() === n.toLowerCase())) return { newName: 'فيه شريحة بنفس الاسم' }; return {}; },
      submitLabel: 'ضيف للشريحة',
      submit: async (ff) => {
        const made = ff.seg === NEW_SEG; const g = made ? segBase(String(ff.newName).trim()) : Object.assign({}, L.find((x) => x.id === ff.seg)); if (!g) return;
        g.add = (g.add || []).slice(); g.remove = (g.remove || []).filter((id) => !ids.includes(id)); let n = 0;
        ids.forEach((id) => { if (g.add.indexOf(id) < 0 && (made || !segCustomers(g).some((cu) => cu.id === id))) { g.add.push(id); n++; } });
        const r = await A().saveSegment(g); if (!done(r)) return;
        st.cust.picked.clear(); K.toast(made ? 'اتعملت شريحة «' + g.name + '» فيها ' + n + ' عميل' : n ? 'اتضاف ' + n + ' عميل لـ «' + g.name + '»' : 'كلهم في الشريحة أصلاً', 'success'); R(); } });
  }
  function saveAsSegment(ids) {
    const L = segs(); const desc = [filterDesc(st.cust), (st.cust.moods || []).length ? 'الحالة: ' + st.cust.moods.join(' أو ') : '', (st.cust.provs || []).length ? 'المحافظة: ' + st.cust.provs.join('، ') : ''].filter(Boolean).join(' · ');
    K.form({ title: 'حفظ ' + ids.length + ' عميل كشريحة جديدة', values: { name: '' },
      note: U.InlineNote({ children: 'شريحة يدوية: فيها العملاء دول بس' + (desc ? ' (اخترتهم بـ ' + desc + ')' : '') + ' — من غير قواعد، فمش هتتغير لوحدها. تقدر تضيف أو تشيل عملاء أو تحط قواعد بعدين من «شرايح العملاء».' }),
      fields: (ff, e, set) => [K.field.text('name', 'اسم الشريحة', ff, e, set, { required: true, placeholder: 'مثلاً: عملاء معرض ديسمبر' })],
      validate: (ff) => { const n = String(ff.name || '').trim(); if (!n) return { name: 'اكتب اسم الشريحة' }; if (L.some((x) => x.name.trim().toLowerCase() === n.toLowerCase())) return { name: 'فيه شريحة بنفس الاسم' }; return {}; },
      submitLabel: 'حفظ الشريحة',
      submit: async (ff) => { const g = Object.assign(segBase(String(ff.name).trim()), { add: ids.slice() }); const r = await A().saveSegment(g); if (!done(r)) return;
        st.cust.picked.clear(); K.toast('اتعملت شريحة «' + g.name + '» فيها ' + ids.length + ' عميل', 'success'); st.tab = 'segments'; st.segs.open = r.segment.id; st.segs.picked.clear(); try { history.replaceState(null, '', '#cs-segments'); } catch (e) { /* */ } R(); } });
  }
  function removeFromSegment(g, ids) {
    const n = Object.assign({}, g, { add: (g.add || []).filter((id) => !ids.includes(id)), remove: [...new Set((g.remove || []).concat(ids))] });
    st.segs.picked.clear(); saveSeg(n, 'اتشال ' + ids.length + ' عميل من «' + g.name + '»');
  }
  function pickCustomersFor(g) {
    const inIt = new Set(segCustomers(g).map((cu) => cu.id));
    const f = { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false, moods: [], provs: [], chans: [], page: 1 };
    const chosen = new Set(); let m = null; let t = null;
    const draw = () => {
      const rows = matchFilters(f); const free = rows.filter((cu) => !inIt.has(cu.id)); const allOn = free.length && free.every((cu) => chosen.has(cu.id)); const nf = custFilterCount(f);
      const srch = h('input', { type: 'search', id: 'spk-q', value: f.q, placeholder: 'ابحث بالاسم أو رقم التليفون أو رقم الأوردر', 'aria-label': 'بحث في العملاء', autocomplete: 'off' });
      srch.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const pos = srch.selectionStart; f.q = srch.value; draw(); const n = document.getElementById('spk-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* */ } } }, 200); });
      m.setBody(h('div', { class: 'stack', 'data-seg-picker': '' },
        h('div', { class: 'toolbar wrap', 'data-seg-pick-filters': '' }, h('label', { class: 'search search-field' }, Icon('search', 'sm'), srch), custFilterMenu(f, draw), nf || f.q ? Button({ size: 'sm', type: 'text', label: 'مسح الفلاتر', attrs: { 'data-spk-clear': '' }, onClick: () => { Object.assign(f, { q: '', rating: '', problems: false, moods: [], provs: [], chans: [] }); draw(); } }) : null),
        h('div', { class: 'row-f' }, h('b', { 'data-spk-count': String(rows.length) }, rows.length + ' عميل' + (nf || f.q ? ' بالبحث والفلتر' : '')), h('span', { class: 't-small help' }, '· ' + rows.filter((cu) => inIt.has(cu.id)).length + ' في الشريحة أصلاً' + (chosen.size ? ' · محدد ' + chosen.size + ' للإضافة' : '')), h('span', { class: 'grow' }),
          free.length ? Button({ size: 'sm', label: allOn ? 'شيل تحديد الكل' : 'حدد الكل (' + free.length + ')', attrs: { 'data-spk-all': '' }, onClick: () => { free.forEach((cu) => (allOn ? chosen.delete(cu.id) : chosen.add(cu.id))); draw(); } }) : null),
        rows.length ? h('div', { class: 'pick-list seg-pick', role: 'group', 'aria-label': 'العملاء' }, rows.map((cu) => { const r = ratingOf(cu); const already = inIt.has(cu.id);
          return h('label', { class: 'pick-row' + (already ? ' is-in' : ''), 'data-spk-row': cu.id },
            K.Checkbox({ small: true, label: '', checked: already || chosen.has(cu.id), disabled: already, onChange: (v) => { if (already) return; v ? chosen.add(cu.id) : chosen.delete(cu.id); draw(); } }),
            U.Avatar(cu.name), h('span', { class: 'pick-who' }, h('b', null, cu.name), h('span', { class: 't-small', dir: 'ltr' }, cu.phone || cu.ig || '—')),
            h('span', { class: 'pick-meta' }, already ? K.Tag('brand', 'في الشريحة') : null, r ? Stars(r.stars) : null, K.Tag(moodTone(moodOf(cu)), moodOf(cu)))); }))
          : K.Empty('مفيش عملاء بالبحث أو الفلتر ده', 'غيّر البحث أو امسح الفلاتر.')));
      m.setFooter(Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'ضيف (' + chosen.size + ')', disabled: !chosen.size, attrs: { 'data-seg-add-ok': '' }, onClick: () => { const ids = [...chosen]; const n = Object.assign({}, g, { add: [...new Set((g.add || []).concat(ids))], remove: (g.remove || []).filter((id) => !ids.includes(id)) }); m.close(); saveSeg(n, 'اتضاف ' + ids.length + ' عميل لـ «' + g.name + '»'); } }));
    };
    m = U.Modal({ title: 'إضافة عملاء لـ «' + g.name + '»', body: [], footer: [] }); m.el.classList.add('wide'); draw();
  }
  function sheetIntoSegment(g) {
    let res = null; let m = null;
    const draw = () => {
      const inp = h('input', { type: 'file', id: 'seg-file', class: 'sr-file', accept: '.csv,.tsv,.txt,.xlsx,.xls', onChange: () => { if (inp.files[0]) readSheetFile(inp.files[0], (r) => { res = r; draw(); }); } });
      m.setBody(h('div', { class: 'stack' }, h('label', { class: 'drop cp-drop', for: 'seg-file' }, Icon('upload'), h('b', null, res && res.name ? 'غيّر الشيت (' + res.name + ')' : 'ارفع شيت العملاء'), h('small', null, 'Excel أو CSV · لازم يكون فيه عمود «الموبايل» — بنطابق بالرقم'), inp),
        h('div', { class: 'row-f' }, Button({ size: 'sm', type: 'text', icon: 'download', label: 'نزّل نموذج الشيت', onClick: () => K.saveFile('نموذج-عملاء.csv', SHEET_SAMPLE, 'text/csv') })),
        res ? sheetNote(res) : null));
      const n = res && res.matched ? res.matched.length : 0;
      m.setFooter(Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'ضيف ' + n + ' عميل', disabled: !n, attrs: { 'data-seg-sheet-ok': '' }, onClick: () => { const ids = res.matched; const nn = Object.assign({}, g, { add: [...new Set((g.add || []).concat(ids))], remove: (g.remove || []).filter((id) => !ids.includes(id)) }); m.close(); saveSeg(nn, 'اتضاف ' + n + ' عميل من الشيت لـ «' + g.name + '»'); } }));
    };
    m = U.Modal({ title: 'إضافة عملاء من شيت — «' + g.name + '»', body: [], footer: [] }); draw();
  }
  function Segments() {
    const L = segs(); const open = L.find((x) => x.id === st.segs.open); const manage = can().manage;
    if (open) {
      const rows = segCustomers(open); const picked = [...st.segs.picked];
      return [h('div', { class: 'toolbar' }, Button({ type: 'text', label: '‹ كل الشرايح', attrs: { 'data-seg-back': '' }, onClick: () => { st.segs.open = ''; st.segs.picked.clear(); R(); } }), h('b', null, open.name), K.Tag('brand', rows.length + ' عميل')),
        U.InlineNote({ children: CS.segmentLabel(open) || 'شريحة يدوية — العملاء اللي بتضيفهم بس.' }),
        picked.length ? h('div', { class: 'bulk', role: 'region', 'aria-label': 'إجراءات جماعية' }, h('b', null, picked.length + ' عملاء متحددين'), h('span', { class: 'grow' }),
          manage ? Button({ size: 'sm', type: 'danger', label: 'شيل من الشريحة', attrs: { 'data-seg-rm': '' }, onClick: () => removeFromSegment(open, picked) }) : null,
          IconButton({ icon: 'close', label: 'إلغاء التحديد', onClick: () => { st.segs.picked.clear(); R(); } })) : null,
        K.TableSection({ title: 'عملاء الشريحة', sub: rows.length + ' عميل · ' + ((open.add || []).length) + ' متضافين بالإيد · ' + ((open.remove || []).length) + ' متشالين',
          actions: manage ? [Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'إضافة عملاء', attrs: { 'data-seg-add': '' }, onClick: () => pickCustomersFor(open) }), Button({ size: 'sm', icon: 'upload', label: 'إضافة من شيت', attrs: { 'data-seg-sheet': '' }, onClick: () => sheetIntoSegment(open) }), Button({ size: 'sm', label: 'تعديل الشروط', onClick: () => editSegment(open) })] : [],
          body: rows.length ? U.Table({ headers: [K.Checkbox({ small: true, label: '', checked: !!rows.length && picked.length === rows.length, onChange: (v) => { rows.forEach((x) => (v ? st.segs.picked.add(x.id) : st.segs.picked.delete(x.id))); R(); } }), 'العميل', 'الحالة', 'الأوردرات', 'إجمالي الشراء', 'التقييم', 'إزاي دخل الشريحة', ''],
            rows: rows.map((cu) => { const r = ratingOf(cu); const manual = (open.add || []).indexOf(cu.id) > -1; return [
              K.Checkbox({ small: true, label: '', checked: st.segs.picked.has(cu.id), onChange: (v) => { v ? st.segs.picked.add(cu.id) : st.segs.picked.delete(cu.id); R(); } }),
              h('button', { type: 'button', class: 'who-cell', onClick: () => profile(cu) }, U.Avatar(cu.name), h('span', null, h('b', null, cu.name), h('span', { class: 't-small', dir: 'ltr' }, cu.phone || cu.ig || '—'))),
              moodPick(cu), K.Num(String(cu.orders)), cu.total ? K.Num(K.n0(cu.total) + ' ج.م') : '—', r ? Stars(r.stars) : '—',
              K.Tag(manual ? 'gold' : 'neutral', manual ? 'اتضاف بالإيد' : 'بالشروط'),
              K.RowMenu([{ label: 'الملف الكامل', run: () => profile(cu) }, manage ? { label: 'شيل من الشريحة', danger: true, run: () => removeFromSegment(open, [cu.id]) } : null].filter(Boolean), 'إجراءات ' + cu.name)]; }) })
            : K.Empty('الشريحة فاضية', 'ضيف عملاء بالإيد أو عدّل شروطها.', manage ? Button({ type: 'primary', label: 'إضافة عملاء', onClick: () => pickCustomersFor(open) }) : null) })];
    }
    const SB = K.Bulk({ key: 'cs-segs', ids: L.map((g) => g.id), noun: 'شريحة', render: R, actions: [
      { id: 'camp', label: 'حملة على المحدد', icon: 'send', run: (ids) => { const cs = [...new Set(L.filter((g) => ids.includes(g.id)).flatMap((g) => segCustomers(g).map((c) => c.id)))]; SB.clear(); st.tab = 'campaigns'; startWizard({ fromIds: cs, pickDesc: 'من ' + ids.length + ' شرايح' }); } },
      { id: 'merge', label: 'دمج في شريحة جديدة', icon: 'plus', run: (ids, done_) => { const gs = L.filter((g) => ids.includes(g.id)); if (gs.length < 2) { K.toast('اختار شريحتين أو أكتر للدمج', 'error'); return; } K.form({ title: 'دمج ' + gs.length + ' شرايح في شريحة جديدة', values: { name: gs.map((g) => g.name).join(' + ') }, submitLabel: 'اعمل الشريحة', note: h('p', { class: 't-small help', style: 'margin:0' }, 'الشريحة الجديدة يدوية فيها كل عملاء الشرايح دي دلوقتي (' + new Set(gs.flatMap((g) => segCustomers(g).map((c) => c.id))).size + ' عميل) — الشرايح الأصلية مش هتتمسح.'), fields: (f, e, set) => [K.field.text('name', 'اسم الشريحة', f, e, set, { required: true })], validate: (f) => K.req(f, ['name']), submit: async (f) => { const g = Object.assign(segBase(f.name.trim()), { add: [...new Set(gs.flatMap((x) => segCustomers(x).map((c) => c.id)))] }); const r = await A().saveSegment(g); if (done(r)) done_('اتعملت شريحة «' + f.name.trim() + '»'); } }); } },
      { id: 'export', label: 'تصدير العملاء', icon: 'download', run: (ids, done_) => { const cs = [...new Map(L.filter((g) => ids.includes(g.id)).flatMap((g) => segCustomers(g).map((c) => [c.id, [g.name, c.name, c.phone || '', moodOf(c), c.orders, c.total || 0]]))).values()]; K.xlsxExport('ibtekr-segments-' + today() + '.xlsx', 'عملاء الشرايح', [['الشريحة', 'العميل', 'الموبايل', 'الحالة', 'الأوردرات', 'إجمالي الشراء']].concat(cs)); done_(); } },
      manage ? { id: 'del', label: 'مسح', icon: 'trash', danger: true, run: (ids, done_) => K.confirm({ title: 'مسح ' + ids.length + ' شرايح؟', text: 'الشرايح بس هتتمسح — العملاء والتقييمات مش هيتأثروا. الحملات اللي اتبعتت مش هتتأثر.', okLabel: 'امسح', okType: 'danger', onOk: async () => { for (const id of ids) await A().deleteSegment(id); done_('اتمسحت ' + ids.length + ' شرايح'); R(); } }) } : null].filter(Boolean) });
    return [K.TableSection({ title: 'شرايح العملاء', sub: L.length + ' شريحة · الشريحة بتتبني بشروط أو بإضافة عملاء بالإيد، وبتستعملها في الحملات',
      actions: manage ? [Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'شريحة جديدة', attrs: { 'data-seg-new': '' }, onClick: () => editSegment() })] : [],
      body: L.length ? [SB.bar(), U.Table({ headers: [SB.head(), 'الشريحة', 'الشروط', 'عملاء', 'متضافين بالإيد', 'متشالين', ''],
        rows: L.map((g) => [SB.box(g.id, g.name), h('button', { type: 'button', class: 'who-cell', onClick: () => { st.segs.open = g.id; st.segs.picked.clear(); R(); } }, h('b', null, g.name)),
          h('span', { class: 't-small' }, CS.segmentLabel(g) || 'يدوية'), K.Num(String(segCustomers(g).length)), K.Num(String((g.add || []).length)), K.Num(String((g.remove || []).length)),
          K.RowMenu([{ label: 'فتح الشريحة', run: () => { st.segs.open = g.id; R(); } }, manage ? { label: 'تعديل الشروط', run: () => editSegment(g) } : null, manage ? { label: 'إضافة عملاء', run: () => pickCustomersFor(g) } : null, manage ? { label: 'مسح الشريحة', danger: true, run: () => delSegment(g) } : null].filter(Boolean), 'إجراءات ' + g.name)]) })]
        : K.Empty('مفيش شرايح لسه', 'اعمل شريحة بشروط (قيمة شراء، أوردرات، تقييم) أو ضيف عملاء بالإيد.', manage ? Button({ type: 'primary', label: 'شريحة جديدة', onClick: () => editSegment() }) : null) })];
  }
  function Customers() {
    const f = st.cust; f.mode = 'filters'; const rows = custRows(); const all = S.customers; const manage = can().manage; const reply = can().reply;
    const picked = [...f.picked]; const avg = avgRating(); const problems = all.filter((x) => x.lateOpen || x.openComplaints).length;
    return [h('div', { class: 'cards' }, K.Stat('إجمالي العملاء', K.n0(all.length), 'عميل', 'من الأوردرات + الإضافة اليدوية', undefined, DET.custTotal), K.Stat('عملاء متكررين', buyers().length ? String(Math.round(repeaters().length / buyers().length * 100)) : '0', '%', 'اشتروا مرتين أو أكتر', undefined, DET.custRepeat), K.Stat('متوسط التقييم', avg == null ? '—' : String(avg), 'من 5', 'محسوب تلقائي', undefined, DET.custRating), K.Stat('عملاء عندهم مشكلة', String(problems), 'عميل', 'أوردر متأخر أو شكوى مفتوحة', undefined, DET.custProblems)),
      K.Section('فلاتر العملاء', h('div', { class: 'toolbar', 'data-cust-filters': '' }, custSearch(f), custFilterMenu(f), pickMenu('الترتيب', CUST_SORTS, f.sort || 'recent', (v) => { f.sort = v; R(); }, 'csort', (cur) => 'ترتيب: ' + (cur ? cur[1] : '')), h('span', { class: 'grow' }), custFilterCount(f) || f.q ? Button({ size: 'sm', type: 'text', label: 'مسح الفلاتر', attrs: { 'data-cf-reset': '' }, onClick: () => { Object.assign(f, { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false, moods: [], provs: [], chans: [] }); f.picked.clear(); R(); } }) : null), null, { sub: 'النتيجة: ' + rows.length + ' عميل من ' + all.length + ' · الشرايح المحفوظة في تاب «شرايح العملاء»' }),
      picked.length ? h('div', { class: 'bulk', role: 'region', 'aria-label': 'إجراءات جماعية' }, h('b', null, picked.length + ' عملاء متحددين'), picked.length < rows.length ? Button({ size: 'sm', type: 'text', label: 'حدد كل النتايج (' + rows.length + ')', attrs: { 'data-bulk-all': '' }, onClick: () => { rows.forEach((cu) => f.picked.add(cu.id)); R(); } }) : null, h('span', { class: 'grow' }),
        manage ? Button({ size: 'sm', type: 'primary', icon: 'plus', label: 'حفظ كشريحة جديدة', attrs: { 'data-bulk-newseg': '' }, onClick: () => saveAsSegment(picked) }) : null,
        reply ? Button({ size: 'sm', label: 'إضافة تاج', attrs: { 'data-bulk-tag': '' }, onClick: () => K.form({ title: 'إضافة تاج لـ ' + picked.length + ' عملاء', values: { tag: '' }, fields: (ff, e, set) => [K.field.text('tag', 'التاج', ff, e, set, { required: true })], validate: (ff) => K.req(ff, ['tag']), submit: async (ff) => { const t = ff.tag.trim(); for (const id of picked) { const cu = C(id); if (cu && !cu.tags.includes(t)) await A().setTags(cu.id, cu.tags.concat([t])); } f.picked.clear(); K.toast('اتضاف التاج', 'success'); R(); } }) }) : null,
        manage ? Button({ size: 'sm', label: 'إضافة لشريحة موجودة', attrs: { 'data-bulk-seg': '' }, onClick: () => addToSegment(picked) }) : null, manage ? Button({ size: 'sm', label: 'إضافة لحملة', onClick: () => { startWizard({ fromIds: picked }); } }) : null,
        Button({ size: 'sm', label: 'تصدير', onClick: () => K.xlsxExport('ibtekr-customers-' + today() + '.xlsx', 'العملاء', [['العميل', 'الموبايل', 'الحالة', 'الأوردرات', 'إجمالي الشراء', 'المدينة']].concat(picked.map(C).filter(Boolean).map((cu) => [cu.name, cu.phone || '', moodOf(cu), cu.orders, cu.total || 0, cityOf(cu)]))) }), IconButton({ icon: 'close', label: 'إلغاء التحديد', onClick: () => { f.picked.clear(); R(); } })) : null,
      rows.length ? K.TableSection({ title: 'عملاء إبتكر', cls: 'own-filter', sub: rows.length + ' عميل في القايمة · ' + problems + ' عندهم مشكلة', actions: [Button({ size: 'sm', icon: 'download', label: 'تصدير القايمة', onClick: () => K.xlsxExport('ibtekr-customers-' + today() + '.xlsx', 'العملاء', [['العميل', 'الموبايل', 'الحالة', 'الأوردرات', 'إجمالي الشراء', 'المدينة']].concat(rows.map((cu) => [cu.name, cu.phone || '', moodOf(cu), cu.orders, cu.total || 0, cityOf(cu)]))) })], body: h('div', null, custChips(f, rows), U.Table({ cls: 'cs-cust', headers: [K.Checkbox({ small: true, label: '', checked: picked.length && picked.length === rows.length, onChange: (v) => { rows.forEach((x) => (v ? f.picked.add(x.id) : f.picked.delete(x.id))); R(); } }), 'العميل', 'القنوات', 'الحالة', 'الأوردرات', 'إجمالي الشراء', 'آخر أوردر', 'التقييم', 'تقييم الفريق', 'آخر نشاط', ''],
        rows: rows.map((cu) => { const r = ratingOf(cu); return [K.Checkbox({ small: true, label: '', checked: f.picked.has(cu.id), onChange: (v) => { v ? f.picked.add(cu.id) : f.picked.delete(cu.id); R(); } }), h('button', { type: 'button', class: 'who-cell', onClick: () => profile(cu) }, U.Avatar(cu.name), h('span', null, h('b', null, cu.name), h('span', { class: 't-small', dir: 'ltr' }, cu.phone || cu.ig || '—'))), h('span', { class: 'plats' }, cu.channels.length ? cu.channels.map((p) => chanBtn(cu, p)) : h('span', { class: 't-small help' }, '—')), moodPick(cu), K.Num(String(cu.orders)), cu.total ? K.Num(K.n0(cu.total) + ' ج.م') : '—', cu.lastOrderDays != null ? 'من ' + cu.lastOrderDays + ' يوم' : '—', r ? Stars(r.stars) : '—', teamCell(cu), whenLabel(cu.lastActive), K.RowMenu([{ label: 'الملف الكامل', run: () => profile(cu) }, { label: 'فتح المحادثة', run: () => openConvFor(cu) }, reply ? { label: 'إضافة تاج', run: () => addTag(cu) } : null, reply ? { label: 'تعديل التقييم', run: () => editRating(cu) } : null, manage ? { label: 'دمج مع عميل تاني', run: () => merge(cu) } : null].filter(Boolean))]; }) })) })
        : K.Empty(all.length ? 'مفيش عملاء بالفلاتر دي' : 'مفيش عملاء لسه', all.length ? 'غيّر الفلاتر أو امسحها.' : 'العملاء بيتضافوا تلقائي من الأوردرات، أو من «إضافة عميل».', all.length ? Button({ label: 'مسح الفلاتر', onClick: () => { Object.assign(f, { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false, moods: [], provs: [], chans: [] }); R(); } }) : null),
      h('p', { class: 't-small src-note' }, 'المصدر: الأوردرات (WooCommerce) + محادثات القنوات المربوطة · التقييم بيتحسب من الأوردرات · حالة العميل بيحددها الموظف')];
  }
  function openChannel(cu, p) {
    const c = S.convs.filter((x) => x.seg === 'customers' && x.who === cu.id && x.platform === p).sort((a, b) => (a.status === 'اتحلت') - (b.status === 'اتحلت'))[0];
    if (!c) { if (p === 'tiktok') { K.toast('مفيش محادثة مع ' + cu.name + ' على تيك توك — تيك توك مش بيسمح نبدأ رسالة من عندنا'); return; } newMessage({ from: p === 'whatsapp' ? 'wa1' : p, to: cu.id }); return; }
    st.tab = 'inbox'; st.seg = 'customers'; st.plat = p; st.view = 'all'; st.fState = c.status === 'اتحلت' ? ['open', 'done'] : st.fState; st.fTags = []; st.q = ''; st.sel.customers = c.id; st.mobileChat = true;
    try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* sandbox */ } R(); window.scrollTo(0, 0);
  }
  const chanBtn = (cu, p) => { const has = S.convs.some((x) => x.seg === 'customers' && x.who === cu.id && x.platform === p);
    return h('button', { type: 'button', class: 'chan-btn' + (has ? '' : ' no-conv'), 'data-chan': p, title: has ? 'افتح المحادثة على ' + PL[p][0] : 'مفيش محادثة على ' + PL[p][0] + ' — ابدأ رسالة', 'aria-label': (has ? 'افتح محادثة ' : 'ابدأ رسالة مع ') + cu.name + ' على ' + PL[p][0], onClick: (e) => { e.stopPropagation(); openChannel(cu, p); } }, PlatIcon(p)); };
  function openConvFor(cu) { const c = S.convs.find((x) => x.seg === 'customers' && x.who === cu.id); if (!c) { newMessage({ from: 'wa1', to: cu.id }); return; } st.tab = 'inbox'; st.seg = 'customers'; st.plat = 'all'; st.view = 'all'; st.sel.customers = c.id; st.mobileChat = true; try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* sandbox */ } R(); }
  function teamSec(cu) {
    const t = teamOf(cu); const L = teamList(cu);
    return sec('تقييم الفريق للعميل', h('span', { class: 't-small help' }, 'بيتسجل لما الأوردر يبقى «مكتمل» أو عند إنهاء المحادثة'),
      t.count ? h('div', { class: 'stack', 'data-team-sec': '' }, h('div', { class: 'team-grid' }, CS.RATE_KEYS.map(([k, l]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, l), h('div', { class: 'row-f' }, Stars(Math.round(t.avg[k] || 0), l + ' ' + t.avg[k] + ' من 5'), h('b', null, K.Num(String(t.avg[k] == null ? '—' : t.avg[k]))))))
        .concat([h('div', { class: 'kvc' }, h('span', { class: 't-small' }, 'المتوسط'), h('b', null, K.Num(t.overall + ' من 5 · ' + t.count + ' تقييم')))])),
        L[0] ? h('p', { class: 't-small', style: 'margin:0' }, 'آخر تقييم من الشات: ' + L[0].by + ' · ' + K.dshort(L[0].at) + (L[0].note ? ' — «' + L[0].note + '»' : '')) : null)
        : h('div', { class: 't-small help' }, cu.phone ? 'لسه ما اتقيّمش — أول ما أوردر ليه يبقى «مكتمل» أو تتقفل محادثة بتقييم.' : 'مفيش رقم موبايل — تقييم الأوردرات بيترابط بالرقم.'));
  }
  function profile(cu, tab = 'overview') {
    const d = U.Drawer({ label: 'ملف العميل ' + cu.name }); let t = tab; const manage = can().manage; const reply = can().reply;
    function draw() {
      cu = C(cu.id) || cu; const r = ratingOf(cu); const auto = CS.customerRating(cu); const stg = stageOf(cu);
      const convs = S.convs.filter((x) => x.who === cu.id);
      const tabs = [['overview', 'نظرة عامة'], ['orders', 'الأوردرات (' + cu.orders + ')'], ['convs', 'المحادثات (' + convs.length + ')'], ['log', 'السجل']];
      const body = t === 'overview' ? [
        sec('أرقام الشراء', null, h('div', { class: 'kvg six' }, [['الأوردرات', cu.orders], ['إجمالي الشراء', K.n0(cu.total) + ' ج.م'], ['متوسط الأوردر', cu.orders ? K.n0(cu.total / cu.orders) + ' ج.م' : '—'], ['آخر أوردر', cu.lastOrderDays != null ? 'من ' + cu.lastOrderDays + ' يوم' : '—'], ['رفض استلام', cu.refused], ['مرتجع', cu.returned]].map(([k, v]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, k), h('b', null, K.Num(String(v))))))),
        sec('التقييم والحالة', reply ? link('تعديل التقييم', () => { d.close(); editRating(cu); }) : null, h('div', { class: 'row cols2' }, h('div', null, h('div', { class: 'row-f' }, r ? Stars(r.stars) : '—', h('b', null, r ? r.value + ' من 5 · ' + (r.manual ? 'معدّل يدوي (' + cu.ratingReason + ')' : 'محسوب تلقائي') : 'مفيش أوردرات')), auto ? K.Kv(auto.parts.map((p) => [p.label, p.count + (p.delta ? ' (' + p.delta + ')' : '')])) : null),
          h('div', { 'data-profile-mood': '' }, h('span', { class: 't-label' }, 'حالة العميل'), h('div', { class: 'row-f' }, moodPick(cu)), h('p', { class: 't-small' }, 'الموظف بيحددها من تعامله مع العميل: سعيد / متوسط / متضايق.')))),
        teamSec(cu),
        sec('بيانات التواصل والعناوين', manage ? link('تعديل', () => { d.close(); editContact(cu); }) : null, [U.InfoRow({ label: 'الموبايل / واتساب', value: cu.phone || '—', copy: can().phone && !!cu.phone, onCopy: (v) => copy(v, 'الرقم') }), cu.ig ? U.InfoRow({ label: 'إنستجرام', value: cu.ig, copy: true, onCopy: (v) => copy(v, 'الحساب') }) : null, U.InfoRow({ label: 'المحافظة / المدينة', value: [cu.province, cu.city].filter(Boolean).join(' · ') || '—' }), U.InfoRow({ label: 'العنوان الأساسي', value: cu.address || '—' }), cu.address2 ? U.InfoRow({ label: 'عنوان تاني', value: cu.address2 }) : null]),
        sec('الموافقات', null, K.Switch({ id: 'pf-mk', label: 'رسايل التسويق والعروض', help: 'بيتشال تلقائي لو كتب «إيقاف»', checked: cu.consent, disabled: !manage, onChange: (v) => A().updateCustomer(cu.id, { consent: v }).then((rr) => { if (done(rr)) draw(); }) }), K.Switch({ id: 'pf-auto', label: 'الرد الآلي', help: 'تأكيد وشحن وتأخير الأوردرات (لما يتفعّل)', checked: cu.autoConsent, disabled: !manage, onChange: (v) => A().updateCustomer(cu.id, { autoConsent: v }).then((rr) => { if (done(rr)) draw(); }) })),
        sec('ملاحظات الفريق', reply ? link('+ ملاحظة', () => K.form({ title: 'ملاحظة على ' + cu.name, values: { t: '' }, fields: (f, e, set) => [K.field.area('t', 'الملاحظة', f, e, set, { required: true })], validate: (f) => K.req(f, ['t']), submit: async (f) => { const rr = await A().addNote(cu.id, f.t); if (done(rr)) draw(); } })) : null, cu.notes.length ? cu.notes.map((n) => U.TimelineMessage({ author: n.author, time: n.time, text: n.text })) : h('div', { class: 't-small' }, 'مفيش ملاحظات')),
        cu.source ? sec('جه منين', null, h('div', { class: 'r t-small' }, Icon('megaphone', 'sm'), cu.source)) : null]
        : t === 'orders' ? [cu.orderList.length ? cu.orderList.map(OrderRow) : K.Empty('مفيش أوردرات', can().orders ? 'أول أوردر هيظهر هنا.' : 'الأوردرات محتاجة صلاحية عرضها.')]
          : t === 'convs' ? (convs.length ? convs.map((x) => h('button', { type: 'button', class: 'cv', onClick: () => { d.close(); st.tab = 'inbox'; st.seg = x.seg; st.plat = 'all'; st.view = 'all'; st.sel[x.seg] = x.id; st.mobileChat = true; try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* */ } R(); } }, PlatIcon(x.platform), h('span', { class: 'cv-b' }, h('b', null, chanLabel(x)), h('span', { class: 't-small' }, x.status + ' · ' + x.time)))) : [K.Empty('مفيش محادثات', 'أول محادثة مع العميل هتظهر هنا.')])
            : [U.Table({ headers: ['الوقت', 'الحدث'], rows: [].concat(cu.manualRating ? [[K.dshort(today()), 'التقييم اتعدل لـ ' + cu.manualRating + ' — ' + cu.ratingReason]] : [], teamList(cu).map((x) => [K.dshort(x.at), h('span', { class: 'log-rate', 'data-log-rate': x.chat || '' }, 'تقييم الفريق' + (x.chat ? ' بعد محادثة' : ' بعد أوردر') + ' — ', CS.RATE_KEYS.map(([k, l]) => h('span', { class: 'lr' }, l.replace(' العميل', '') + ' ', Stars(x[k], l + ' ' + x[k] + ' من 5'))), h('span', { class: 't-small help' }, ' · ' + x.by + (x.note ? ' · «' + x.note + '»' : '')))]), cu.notes.map((n) => [n.time, 'ملاحظة من ' + n.author]), [[K.dshort((cu.since || '').slice(0, 10)), 'اتضاف ' + (cu.createdFrom === 'orders' ? 'من الأوردرات' : cu.createdFrom === 'import' ? 'من شيت' : 'يدوي') + (cu.source ? ' — ' + cu.source : '')]]) })];
      d.set(h('div', { class: 'dr-h' }, h('div', { class: 'pn-who' }, U.Avatar(cu.name), h('div', null, h('h2', { class: 't-h4' }, cu.name), h('div', { class: 't-small' }, 'عميل من ' + sinceLabel(cu.since) + ' · ' + cityOf(cu) + ' · آخر نشاط ' + whenLabel(cu.lastActive)))), h('div', { class: 'acts' }, manage ? Button({ size: 'sm', label: 'تعديل', onClick: () => { d.close(); editContact(cu); } }) : null, Button({ type: 'primary', size: 'sm', label: 'فتح المحادثة', onClick: () => { d.close(); openConvFor(cu); } }), K.RowMenu([reply ? { label: 'إضافة تاج', run: () => { d.close(); addTag(cu); } } : null, manage ? { label: 'دمج مع عميل تاني', run: () => { d.close(); merge(cu); } } : null].filter(Boolean)), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => d.close() }))),
        h('div', { class: 'tags pad' }, moodPick(cu), cu.blocked ? K.Tag('error', 'محظور') : null, cu.tags.filter((x) => x !== stg).map((x) => K.Tag(statusTone(x) || tagTone(x), x))),
        U.Tabs({ items: tabs.map(([id, label]) => ({ id, label })), active: t, onChange: (id) => { t = id; draw(); } }), h('div', { class: 'dr-b' }, body));
    }
    draw(); setTimeout(() => { const b = d.el.querySelector('button'); if (b) b.focus(); });
  }
  // ======================= campaigns (6.1: drafts and schedules — the sending comes with the channels, 6.3) =======================
  const CAMP_TONE = { 'خلصت': 'success', 'مجدولة': 'info', 'شغالة': 'brand', 'مسودة': 'neutral', 'متوقفة': 'orange' };
  const campStatus = (k, status, msg) => A().setCampaignStatus(k.id, status).then((r) => { if (done(r, msg)) R(); });
  function Campaigns() {
    if (st.wiz) return Wizard();
    if (st.campaign) { const k = S.campaigns.find((x) => x.id === st.campaign); if (!k) { st.campaign = null; } else return CampaignDetails(k); }
    const list = S.campaigns.filter((k) => !st.campFilter || k.status === st.campFilter); const manage = can().manage;
    const { tot } = DET.campRows(); const anyChan = Object.values(S.channels).some((c) => c.status === 'connected');
    const pick = (ids) => S.campaigns.filter((k) => ids.includes(k.id));
    const CB = K.Bulk({ key: 'cs-camps', ids: list.map((k) => k.id), noun: 'حملة', render: R, actions: [
      manage ? { id: 'pause', label: 'إيقاف مؤقت', icon: 'eyeoff', run: async (ids, done_) => { const l = pick(ids).filter((k) => ['شغالة', 'مجدولة'].includes(k.status)); if (!l.length) { K.toast('مفيش حملة شغالة أو مجدولة في المحدد', 'error'); return; } for (const k of l) await A().setCampaignStatus(k.id, 'متوقفة'); done_('اتوقفت ' + l.length + ' حملة مؤقتًا'); R(); } } : null,
      manage ? { id: 'resume', label: 'استئناف', icon: 'refresh', run: async (ids, done_) => { const l = pick(ids).filter((k) => k.status === 'متوقفة'); if (!l.length) { K.toast('مفيش حملة متوقفة في المحدد', 'error'); return; } for (const k of l) await A().setCampaignStatus(k.id, 'مجدولة'); done_('رجعت ' + l.length + ' حملة مجدولة'); R(); } } : null,
      manage ? { id: 'dup', label: 'نسخ كمسودة', icon: 'copy', run: async (ids, done_) => { for (const k of pick(ids)) await A().saveCampaign(Object.assign({}, k, { id: null, name: k.name + ' (نسخة)', status: 'مسودة', scheduledAt: null })); done_('اتعمل ' + ids.length + ' نسخة كمسودة'); R(); } } : null,
      { id: 'export', label: 'تصدير', icon: 'download', run: (ids, done_) => { K.xlsxExport('ibtekr-campaigns-' + today() + '.xlsx', 'الحملات', [['الحملة', 'الشريحة', 'الحالة', 'اتبعتت', 'اتقرت', 'ردود', 'أوردرات', 'الإيراد']].concat(pick(ids).map((k) => [k.name, k.seg, k.status, k.sent || 0, k.read || 0, k.replies || 0, k.orders || 0, k.revenue || 0]))); done_(); } },
      manage ? { id: 'del', label: 'مسح المسودات', icon: 'trash', danger: true, run: (ids, done_) => { const l = pick(ids).filter((k) => k.status === 'مسودة'); if (!l.length) { K.toast('المسح للمسودات بس — الحملات اللي اتجدولت أو اتبعتت بتفضل في السجل', 'error'); return; } K.confirm({ title: 'مسح ' + l.length + ' مسودة؟', text: l.map((k) => k.name).join(' · '), okLabel: 'امسح', okType: 'danger', onOk: async () => { for (const k of l) await A().deleteCampaign(k.id); done_('اتمسحت ' + l.length + ' مسودة'); R(); } }); } } : null].filter(Boolean) });
    return [h('div', { class: 'cards' }, K.Stat('رسايل اتبعتت', K.n0(tot.sent), 'رسالة', 'من كل الحملات', 'positive', () => DET.camp('sent')), K.Stat('نسبة القراءة', tot.delivered ? String(Math.round(tot.read / tot.delivered * 100)) : '—', '%', 'من الرسايل اللي اتسلمت', 'positive', () => DET.camp('read')), K.Stat('ردود', K.n0(tot.replies), 'رد', tot.read ? Math.round(tot.replies / tot.read * 100) + '% من اللي قروا' : '—', 'negative', () => DET.camp('replies')), K.Stat('أوردرات من الحملات', String(tot.orders), 'أوردر', 'إيراد ' + K.n0(tot.revenue) + ' ج.م', 'positive', () => DET.camp('orders'))),
      anyChan ? null : U.InlineNote({ kind: 'warning', children: 'مفيش قناة مربوطة لسه — الحملات بتتحفظ كمسودات ومجدولة، والإرسال بيبدأ لما القنوات تتربط (Meta في المرحلة الجاية، واتساب في الآخر).', action: Button({ size: 'sm', label: 'القنوات', onClick: () => { st.tab = 'channels'; R(); } }) }),
      h('div', { class: 'toolbar' }, U.Select({ id: 'cp-st', options: [{ value: '', label: 'الحالة: الكل' }].concat(Object.keys(CAMP_TONE).map((x) => ({ value: x, label: 'الحالة: ' + x }))), value: st.campFilter, onChange: (v) => { st.campFilter = v; R(); } })),
      list.length ? h('section', { class: 'card tbl-card' }, h('div', { class: 'table-title' }, h('h2', { class: 't-h4' }, 'الحملات'), h('span', { class: 'count t-body' }, list.length + ' حملة')), CB.bar(), U.Table({ headers: [CB.head(), 'الحملة', 'الشريحة', 'الحالة', 'اتبعتت', 'اتقرت', 'ردود', 'أوردرات', 'الإيراد', ''], rows: list.map((k) => [CB.box(k.id, k.name), h('button', { type: 'button', class: 'who-cell', onClick: () => { st.campaign = k.id; R(); window.scrollTo(0, 0); } }, h('span', null, h('b', null, k.name), h('span', { class: 't-small' }, k.sub))), (k.seg || '—') + ' · ' + K.n0(k.size), K.Tag(CAMP_TONE[k.status] || 'neutral', k.status), K.Num(k.sent ? K.n0(k.sent) : '—'), K.Num(k.read ? K.n0(k.read) : '—'), K.Num(k.replies ? String(k.replies) : '—'), K.Num(k.orders ? String(k.orders) : '—'), k.revenue ? K.Num(K.n0(k.revenue) + ' ج.م') : '—',
        K.RowMenu([{ label: 'التفاصيل', run: () => { st.campaign = k.id; R(); } }, manage && k.status === 'مسودة' ? { label: 'تكملة التعديل', run: () => startWizard(fromCampaign(k)) } : null, manage ? { label: 'نسخ كحملة جديدة', run: () => startWizard(Object.assign(fromCampaign(k), { id: null, name: k.name + ' (نسخة)' })) } : null].filter(Boolean))]) })) : K.Empty(S.campaigns.length ? 'مفيش حملات بالحالة دي' : 'مفيش حملات لسه', S.campaigns.length ? 'غيّر الفلتر أو ابدأ حملة جديدة.' : 'ابدأ حملة: شريحة + رسالة + جدولة — وبتتبعت لما القناة تتربط.'),
      h('p', { class: 't-small src-note' }, '«متوقفة» = اتوقفت بالإيد أو تلقائي لما نسبة الحظر أو البلاغات تعدّي ' + CS.STOP_RATE * 100 + '%. تقدر تكمّلها بعد المراجعة.')];
  }
  const audienceList = () => S.customers.map((cu) => ({ id: cu.id, stage: stageOf(cu), consent: cu.consent, blocked: !!cu.blocked, openComplaint: cu.openComplaints > 0, lateOrder: cu.lateOpen > 0, lastOrderDays: cu.lastOrderDays, rating: (ratingOf(cu) || { value: 0 }).value, channel: cu.channels.includes('whatsapp') || cu.phone ? 'wa1' : 'other' })); // a phone = reachable on WhatsApp 1
  const fromCampaign = (k) => ({ id: k.id, name: k.name, src: k.segId ? 'saved' : 'filters', segId: k.segId || '', chans: [k.channel], text: k.body || '', code: k.discountCode || '', when: k.scheduledAt ? 'schedule' : 'now', date: k.scheduledAt ? k.scheduledAt.slice(0, 10) : '', time: k.scheduledAt ? timeOpt(k.scheduledAt) : '7:00 م', delay: String(k.minDelayS || 20), cap: String(k.capPerDay || 200) });
  const TIMES = [['10:00 ص', 10], ['1:00 م', 13], ['5:00 م', 17], ['7:00 م', 19], ['8:00 م', 20], ['9:00 م', 21]];
  const timeOpt = (iso) => { const hh = new Date(iso).getHours(); const o = TIMES.find((t) => t[1] === hh); return o ? o[0] : '7:00 م'; };
  const schedIso = (date, time) => { const t = TIMES.find((x) => x[0] === time); const d = new Date(date + 'T00:00:00'); d.setHours(t ? t[1] : 19, 0, 0, 0); return d.toISOString(); };
  function startWizard(pre) {
    const p0 = pre || {}; if (p0.fromIds) { p0.src = 'filters'; p0.picked = p0.fromIds.slice(); p0.pickDesc = p0.pickDesc || 'اتحددوا من صفحة العملاء'; delete p0.fromIds; }
    const d = new Date(Date.now() + 3 * 864e5);
    st.wiz = Object.assign({ id: null, step: 0, chans: Object.keys(S.channels).filter((k) => S.channels[k].aud === 'customers' && S.channels[k].kind !== 'none').slice(0, 1), name: '', src: 'saved', segId: (segs()[0] || {}).id || '', picked: [], pickDesc: '', file: null, fileSave: 'campaign', ex: { complaint: true, late: true, recent: true }, text: '', code: '', when: 'schedule', date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), time: '7:00 م', delay: '20', cap: '200', batches: true, quiet: true, measure: 'أوردرات خلال 7 أيام من الرسالة', ok: false, errs: {} }, p0);
    st.tab = 'campaigns'; st.campaign = null; try { history.replaceState(null, '', '#cs-campaigns'); } catch (e) { /* */ } R(); window.scrollTo(0, 0);
  }
  const chanPlat = (id) => (id.startsWith('wa') ? 'whatsapp' : id);
  const campChans = (w) => (Array.isArray(w.chans) && w.chans.length ? w.chans : []);
  const chansLabel = (w) => campChans(w).map((id) => (S.channels[id] ? S.channels[id].name : id)).join(' + ') || '—';
  function chanHint(id, c) {
    if (c.status !== 'connected') return 'مش متصلة دلوقتي — الرسايل هتستنى في الطابور لحد ما تتربط';
    if (id.startsWith('wa') && c.aud === 'vendors') return 'رقم المبتكرين — العملاء هيستلموا من رقم غير اللي بيكلمونا عليه';
    if (id === 'messenger' || id === 'instagram') return 'سياسة Meta: بيوصل بس للي كلمونا آخر 24 ساعة — الباقي بيتسجل «موصلتش»';
    return 'العملاء بيستلموا من نفس الرقم اللي بيكلمونا عليه';
  }
  function chanPicker(w) {
    const on = campChans(w);
    const toggle = (id, v) => { const L = on.slice(); const i = L.indexOf(id); if (v && i < 0) L.push(id); if (!v && i > -1) L.splice(i, 1); w.chans = L; delete w.errs.chans; R(); };
    return h('fieldset', { class: 'blk', 'data-camp-chans': '' }, h('legend', null, 'هتتبعت من (تقدر تختار أكتر من قناة)'),
      Object.entries(S.channels).filter(([, c]) => c.kind !== 'none').map(([id, c]) => h('div', { class: 'chan-opt' + (c.status !== 'connected' ? ' off' : '') }, K.Checkbox({ label: c.name, checked: on.indexOf(id) > -1, onChange: (v) => toggle(id, v) }), h('div', { class: 't-small help' }, chanHint(id, c)))),
      w.errs.chans ? h('div', { class: 'err-msg', role: 'alert' }, w.errs.chans) : null,
      h('div', { class: 't-small help' }, 'لو العميل موجود على أكتر من قناة مختارة، بيستلم مرة واحدة بس — من أول قناة في الترتيب.'));
  }
  function wizBase(w) {
    if (w.src === 'saved') { const g = segs().find((x) => x.id === w.segId); return g ? segCustomers(g).map((cu) => cu.id) : []; }
    if (w.src === 'filters') return (w.picked || []).slice();
    return w.file && w.file.matched ? w.file.matched.slice() : [];
  }
  function wizAudience(w) {
    const ids = wizBase(w); const plats = [...new Set(campChans(w).map(chanPlat))];
    const reach = (id) => { const cu = C(id); return !!cu && (cu.channels.some((p) => plats.indexOf(p) > -1) || (plats.indexOf('whatsapp') > -1 && !!cu.phone)); };
    const base = audienceList().filter((a) => ids.indexOf(a.id) > -1 && reach(a.id));
    const r = CS.audience(base, {}, w.ex);
    const notWa = ids.length - base.length;
    const fresh = w.src === 'file' && w.file && w.file.newRows && plats.indexOf('whatsapp') > -1 ? w.file.newRows.length : 0;
    return { ids, matched: ids.length + fresh, notWa, excluded: r.excluded, recipients: r.recipients, fresh, total: r.recipients.length + fresh };
  }
  function srcLabel(w) {
    if (w.src === 'saved') { const g = segs().find((x) => x.id === w.segId); return g ? 'شريحة «' + g.name + '»' : 'شريحة'; }
    if (w.src === 'filters') return 'عملاء مختارين' + (w.pickDesc ? ' (' + w.pickDesc + ')' : '');
    return 'شيت ' + (w.file && w.file.name ? '«' + w.file.name + '»' : '') + (w.file && w.file.newRows && w.file.newRows.length ? ' · ' + w.file.newRows.length + ' رقم جديد ' + (w.fileSave === 'db' ? 'هيتسجلوا في العملاء' : 'للحملة دي بس') : '');
  }
  function pickForCampaign(w) {
    const f = { q: '', stage: '', tag: '', rating: '', prov: '', chan: '', problems: false }; const chosen = new Set(w.picked || []); let m = null;
    const draw = () => {
      const rows = matchFilters(f); const allOn = rows.length && rows.every((cu) => chosen.has(cu.id));
      m.setBody(h('div', { class: 'stack', 'data-camp-picker': '' }, h('div', { class: 'toolbar wrap' }, ...filtersBar(f, draw, 'cpk-')),
        h('div', { class: 'row-f' }, h('b', null, rows.length + ' عميل بالفلاتر دي'), h('span', { class: 'grow' }), Button({ size: 'sm', label: allOn ? 'شيل تحديد الكل' : 'حدد الكل (' + rows.length + ')', attrs: { 'data-cpk-all': '' }, onClick: () => { rows.forEach((cu) => (allOn ? chosen.delete(cu.id) : chosen.add(cu.id))); draw(); } })),
        rows.length ? h('div', { class: 'pick-list' }, rows.map((cu) => { const r = ratingOf(cu); return h('label', { class: 'pick-row' }, K.Checkbox({ small: true, label: '', checked: chosen.has(cu.id), onChange: (v) => { v ? chosen.add(cu.id) : chosen.delete(cu.id); draw(); } }), U.Avatar(cu.name), h('span', null, h('b', null, cu.name), h('span', { class: 't-small', dir: 'ltr' }, cu.phone || cu.ig || '—')), h('span', { class: 'grow' }), r ? Stars(r.stars) : null, K.Tag(moodTone(moodOf(cu)), moodOf(cu))); }))
          : K.Empty('مفيش عملاء بالفلاتر دي', 'غيّر الفلاتر.')));
      m.setFooter(Button({ label: 'إلغاء', onClick: () => m.close() }), Button({ type: 'primary', label: 'حفظ (' + chosen.size + ' عميل)', disabled: !chosen.size, attrs: { 'data-cpk-ok': '' }, onClick: () => { w.picked = [...chosen]; w.pickDesc = filterDesc(f) || 'اختيار يدوي'; delete w.errs.src; m.close(); R(); } }));
    };
    m = U.Modal({ title: 'اختار عملاء الحملة من صفحة العملاء', body: [], footer: [] }); m.el.classList.add('wide'); draw();
  }
  function srcBlock(w, set) {
    if (w.src === 'saved') {
      const L = segs();
      return h('div', { class: 'stack', 'data-src-block': 'saved' }, U.Select({ id: 'wz-seg', label: 'اختر الشريحة', required: true, error: w.errs.src, options: [{ value: '', label: L.length ? 'اختار شريحة…' : 'مفيش شرايح محفوظة' }].concat(L.map((g) => ({ value: g.id, label: g.name + ' · ' + segCustomers(g).length + ' عميل' }))), value: w.segId, onChange: (v) => set('segId', v) }),
        Button({ size: 'sm', type: 'text', icon: 'plus', label: 'شريحة جديدة', onClick: () => editSegment() }));
    }
    if (w.src === 'filters') {
      const n = (w.picked || []).length;
      return h('div', { class: 'src-pick', 'data-src-block': 'filters' }, n ? h('div', { class: 'row-f' }, Icon('users', 'sm'), h('b', { 'data-picked-count': '' }, n + ' عميل مختار'), w.pickDesc ? h('span', { class: 't-small help' }, w.pickDesc) : null, h('span', { class: 'grow' }), Button({ size: 'sm', label: 'تعديل', attrs: { 'data-pick-edit': '' }, onClick: () => pickForCampaign(w) }))
        : h('div', { class: 'row-f' }, h('span', { class: 't-small help' }, 'لسه ما اخترتش عملاء.'), h('span', { class: 'grow' }), Button({ size: 'sm', type: 'primary', label: 'اختار من صفحة العملاء', attrs: { 'data-pick-open': '' }, onClick: () => pickForCampaign(w) })),
        w.errs.src ? h('div', { class: 'err-msg', role: 'alert' }, w.errs.src) : null);
    }
    const fl = w.file; const inp = h('input', { type: 'file', id: 'wz-file', class: 'sr-file', accept: '.csv,.tsv,.txt,.xlsx,.xls', onChange: () => { if (inp.files[0]) readSheetFile(inp.files[0], (r) => { w.file = r; delete w.errs.src; R(); }); } });
    const fresh = fl && fl.newRows ? fl.newRows.length : 0;
    return h('div', { class: 'stack', 'data-src-block': 'file' },
      h('div', { class: 'upload-box' }, Icon('upload'), h('div', { class: 'grow' }, h('b', null, fl && fl.name ? fl.name : 'ارفع شيت العملاء'), h('div', { class: 't-small help' }, 'Excel أو CSV · لازم يكون فيه عمود «الموبايل» — وعمود «الاسم» اختياري')),
        h('label', { class: 'btn btn-default sm', for: 'wz-file' }, fl ? 'غيّر الملف' : 'رفع ملف', inp),
        Button({ size: 'sm', type: 'text', icon: 'download', label: 'تحميل القالب', onClick: () => K.saveFile('قالب-عملاء-الحملة.csv', SHEET_SAMPLE, 'text/csv') })),
      fl ? (fl.error ? U.InlineNote({ kind: 'error', children: fl.error }) : h('div', { class: 'sheet-review', 'data-sheet-review': '' },
        h('div', { class: 'kvg three' }, [['عملاء مسجلين عندنا', fl.matched.length], ['أرقام جديدة', fresh], ['أرقام غلط (اتشالت)', fl.invalid || 0]].map(([k, v]) => h('div', { class: 'kvc' }, h('span', { class: 't-small' }, k), h('b', null, K.Num(String(v)))))),
        fresh ? K.Radios({ label: 'الأرقام الجديدة (' + fresh + ') — نعمل فيها إيه؟', value: w.fileSave, onChange: (v) => set('fileSave', v), options: [{ value: 'campaign', label: 'للحملة دي بس — متتسجلش في العملاء', hint: 'مش هيتبعتلهم في 6.1 — الإرسال للأرقام الجديدة بييجي مع القناة' }, { value: 'db', label: 'ضيفهم لقاعدة بيانات العملاء', hint: 'بيتعملهم ملف عميل بالاسم والرقم ويبانوا في صفحة العملاء' }] }) : null,
        fresh ? U.InlineNote({ kind: 'warning', children: 'الأرقام الجديدة لازم تكون لناس وافقوا على رسايل العروض — أرقام مستوردة من برّه بتعرّض الرقم للحظر.' }) : null)) : null,
      w.errs.src ? h('div', { class: 'err-msg', role: 'alert' }, w.errs.src) : null);
  }
  // the campaign row from the wizard: its audience is kept as a segment (the saved one, or one made now from the picked / sheet customers)
  async function persistCampaign(w, status) {
    const aud = wizAudience(w); let segId = w.src === 'saved' ? w.segId : null;
    if (w.src === 'file' && w.fileSave === 'db' && w.file && w.file.newRows && w.file.newRows.length) { const imp = await A().importCustomers(w.file.newRows.map((r) => ({ phone: r.phone, name: r.name, source: 'شيت حملة «' + w.name + '»' }))); if (imp.ok && imp.added) K.toast('اتضاف ' + imp.added + ' عميل جديد من الشيت'); }
    if (!segId && aud.ids.length) { const L = segs(); const nm = w.name.trim() || 'شريحة حملة'; let name = nm; let k2 = 2; while (L.some((x) => x.name === name)) name = nm + ' (' + (k2++) + ')'; const r = await A().saveSegment(Object.assign(segBase(name), { add: aud.ids.slice() })); if (r.ok) segId = r.segment.id; }
    const k = { id: w.id || null, name: w.name.trim(), segId, channel: campChans(w)[0] || 'wa1', body: w.text, discountCode: w.code, scheduledAt: status === 'مجدولة' ? (w.when === 'now' ? new Date().toISOString() : schedIso(w.date, w.time)) : null, capPerDay: Number(w.cap) || 200, minDelayS: Number(w.delay) || 20, status, size: aud.total };
    return A().saveCampaign(k);
  }
  function Wizard() {
    const w = st.wiz; const labels = ['الشريحة', 'الرسالة', 'الجدولة والحماية', 'مراجعة وإرسال']; const aud = wizAudience(w); const n = aud.total;
    const waSel = campChans(w).filter((k) => S.channels[k]);
    const ch = { left: waSel.length ? waSel.reduce((a, k) => a + Number(S.channels[k].cap || 200), 0) : 200 }; const bt = CS.batches(n, Number(w.cap) || 200, ch.left); const set = (k, v) => { w[k] = v; delete w.errs[k]; R(); };
    const stepper = h('ol', { class: 'stepper', 'aria-label': 'خطوات الحملة' }, labels.map((l, i) => h('li', { class: i < w.step ? 'done' : i === w.step ? 'cur' : '', 'aria-current': i === w.step ? 'step' : false }, h('span', { class: 'dot' }, i < w.step ? Icon('check', 'sm') : String(i + 1)), h('span', null, l))));
    const preview = () => h('div', { class: 'tp-prev' }, h('div', { class: 't-label' }, 'معاينة'), h('div', { class: 'brow out' }, h('div', { class: 'bub b-out' }, h('div', { class: 'tx' }, CS.fillTemplate(CS.withOptOut(w.text || ' '), { 'اسم_العميل': 'نهى', 'كود_الخصم': w.code }).text))));
    const sumRow = (k, v) => h('div', { class: 'sum-r' }, h('span', { class: 't-small' }, k), h('b', null, v));
    let form = [], side = [];
    if (w.step === 0) {
      form = [U.TextInput({ id: 'wz-name', label: 'اسم الحملة', required: true, value: w.name, error: w.errs.name, onInput: (v) => { w.name = v; } }),
        K.Radios({ label: 'مصدر العملاء', options: [{ value: 'saved', label: 'شريحة محفوظة', hint: 'من تاب «شرايح العملاء»' }, { value: 'filters', label: 'فلاتر من العملاء', hint: 'بتفتح صفحة العملاء وتختار منها' }, { value: 'file', label: 'رفع ملف Excel', hint: 'شيت فيه أرقام الموبايل' }], value: w.src, onChange: (v) => set('src', v) }),
        srcBlock(w, set),
        h('fieldset', { class: 'blk' }, h('legend', null, 'استبعاد تلقائي (لحماية الرقم وسمعة البراند)'), K.Checkbox({ label: 'مش موافقين على رسايل التسويق (إجباري)', checked: true, disabled: true, onChange: () => {} }), K.Checkbox({ label: 'المحظورين (إجباري)', checked: true, disabled: true, onChange: () => {} }), K.Checkbox({ label: 'عندهم شكوى مفتوحة', checked: w.ex.complaint, onChange: (v) => { w.ex.complaint = v; R(); } }), K.Checkbox({ label: 'عندهم أوردر متأخر أو قابل للتأخير', checked: w.ex.late, onChange: (v) => { w.ex.late = v; R(); } }), K.Checkbox({ label: 'اتبعتلهم حملة في آخر 7 أيام', checked: w.ex.recent, onChange: (v) => { w.ex.recent = v; R(); } }))];
      const ex = aud.excluded; const why = [aud.notWa ? aud.notWa + ' مش على القنوات المختارة' : '', ex.consent ? ex.consent + ' مش موافقين' : '', ex.blocked ? ex.blocked + ' محظورين' : '', ex.complaint ? ex.complaint + ' شكوى مفتوحة' : '', ex.late ? ex.late + ' أوردر متأخر' : '', ex.recent ? ex.recent + ' حملة قريبة' : ''].filter(Boolean);
      side = [sumRow('المصدر', srcLabel(w)), sumRow('القنوات', chansLabel(w)), sumRow('عملاء في المصدر', K.n0(aud.matched)), sumRow('مستبعدين', String(aud.matched - n)), h('div', { 'data-recipients': String(n) }, sumRow('هيستلموا', K.n0(n) + ' عميل')), why.length ? U.InlineNote({ children: 'أسباب الاستبعاد: ' + why.join(' · ') }) : null,
        n ? Button({ type: 'text', size: 'sm', label: 'عرض القايمة (' + n + ')', onClick: () => K.toast(aud.recipients.map((x) => (C(x.id) || {}).name).filter(Boolean).concat(aud.fresh ? [aud.fresh + ' رقم جديد'] : []).join('، ')) }) : null,
        w.src !== 'saved' && aud.ids.length && can().manage ? Button({ size: 'sm', label: 'حفظ كشريحة', attrs: { 'data-wz-saveseg': '' }, onClick: async () => { const nm = w.name.trim() || 'شريحة حملة'; const L = segs(); let name = nm; let k2 = 2; while (L.some((x) => x.name === name)) name = nm + ' (' + (k2++) + ')'; const r = await A().saveSegment(Object.assign(segBase(name), { add: aud.ids.slice() })); if (!done(r, 'اتحفظت الشريحة «' + name + '» — ' + aud.ids.length + ' عميل')) return; w.src = 'saved'; w.segId = r.segment.id; R(); } }) : null];
    } else if (w.step === 1) {
      form = [chanPicker(w),
        U.Textarea({ id: 'wz-text', label: 'نص الرسالة', required: true, value: w.text, error: w.errs.text, rows: 5, maxlength: 1024, help: w.text.length + ' / 1024 · «اكتب إيقاف» بيتضاف تلقائي لو مش موجود · المتغيرات: {اسم_العميل} {كود_الخصم}', onInput: (v) => { w.text = v; } }),
        CS.templateVars(w.text).includes('كود_الخصم') ? U.TextInput({ id: 'wz-code', label: 'قيمة {كود_الخصم}', required: true, value: w.code, error: w.errs.code, help: 'متغير مش موجود في بيانات العميل — لازم تحدد قيمته للحملة.', onInput: (v) => { w.code = v; } }) : null,
        h('div', { class: 'row-f' }, Button({ label: 'قالب جاهز', icon: 'file', onClick: () => SOON('القوالب') }), Button({ label: 'ابعت رسالة تجربة', onClick: () => SOON('رسالة التجربة (مع ربط القناة)') }))];
      side = [preview(), sumRow('الشريحة', K.n0(n) + ' عميل')];
    } else if (w.step === 2) {
      const days = bt.length; const bl = bt.map((b, i) => b + (i === 0 ? ' أول يوم' : i === 1 ? ' تاني يوم' : ' يوم ' + (i + 1))).join(' · ');
      form = [K.Radios({ label: 'إمتى', options: [{ value: 'now', label: 'أول ما القناة تتربط' }, { value: 'schedule', label: 'جدولة' }], value: w.when, onChange: (v) => set('when', v) }),
        w.when === 'schedule' ? h('div', { class: 'row cols2' }, U.DateField({ id: 'wz-date', label: 'التاريخ', required: true, value: w.date, today: today(), onChange: (v) => set('date', v) }), U.Select({ id: 'wz-time', label: 'الساعة', required: true, options: TIMES.map((x) => ({ value: x[0], label: x[0] })), value: w.time, onChange: (v) => set('time', v) })) : null,
        w.when === 'schedule' ? h('div', { class: 't-small' }, 'أحسن وقت للقراءة عندنا: 7–9 م') : null,
        h('fieldset', { class: 'blk' }, h('legend', null, 'حماية الرقم'), h('div', { class: 'row cols2' }, U.TextInput({ id: 'wz-delay', label: 'أقل فاصل بين الرسايل (ثانية)', value: w.delay, error: w.errs.delay, inputmode: 'numeric', help: 'عشوائي من القيمة دي لحد 60 ثانية · أقل من 20 ممنوع', onInput: (v) => { w.delay = v; } }), U.TextInput({ id: 'wz-cap', label: 'حد أقصى في اليوم', value: w.cap, inputmode: 'numeric', help: 'حد القنوات المختارة: ' + ch.left, onInput: (v) => { w.cap = v; } })),
          K.Checkbox({ label: 'بعتها على دفعات: ' + bl, checked: w.batches, onChange: (v) => set('batches', v) }), K.Checkbox({ label: 'إيقاف تلقائي لو نسبة الحظر أو البلاغات عدّت ' + CS.STOP_RATE * 100 + '%', checked: true, disabled: true, onChange: () => {} }), K.Checkbox({ label: 'متبعتش بعد 10 م (الرسايل الفاضلة تتأجل لتاني يوم 9 ص)', checked: w.quiet, onChange: (v) => set('quiet', v) })),
        U.Select({ id: 'wz-measure', label: 'قياس النتيجة', options: ['أوردرات خلال 7 أيام من الرسالة', 'أوردرات بكود الخصم بس', 'ردود بس'].map((x) => ({ value: x, label: x })), value: w.measure, onChange: (v) => set('measure', v) })];
      side = [sumRow('الشريحة', K.n0(n) + ' عميل'), sumRow('البداية', w.when === 'now' ? 'أول ما القناة تتربط' : K.dlabel(w.date) + ' · ' + w.time), sumRow('المدة المتوقعة', days === 1 ? 'يوم واحد' : days + ' أيام (' + bt.join(' + ') + ')'), U.InlineNote({ children: 'الإرسال نفسه بيشتغل لما القنوات تتربط — الحملة بتتحفظ مجدولة وبتبدأ في ميعادها أو أول ما القناة تشتغل.' })];
    } else {
      form = [h('h2', { class: 't-h4' }, 'راجع قبل الحفظ'), [['اسم الحملة', w.name], ['هتتبعت من', chansLabel(w)], ['العملاء', K.n0(n) + ' عميل · ' + srcLabel(w)], ['المستبعدين', String(aud.matched - n) + ' (من غير القناة + موافقات + شكاوى + أوردرات متأخرة + حملة قريبة)'], ['الرسالة', (w.text || '').slice(0, 80) + ((w.text || '').length > 80 ? '…' : '') + (CS.templateVars(w.text).includes('كود_الخصم') ? ' · كود ' + w.code : '')], ['الجدولة', (w.when === 'now' ? 'أول ما القناة تتربط' : K.dlabel(w.date) + ' ' + w.time) + ' · ' + bt.length + ' دفعات · فاصل ' + w.delay + '–60 ثانية'], ['الإيقاف التلقائي', 'حظر/بلاغات > ' + CS.STOP_RATE * 100 + '% أو فصل القناة']].map(([k, v]) => U.InfoRow({ label: k, value: v })),
        K.Checkbox({ label: 'راجعت النص والشريحة وموافق على الجدولة', checked: w.ok, onChange: (v) => set('ok', v) }), w.errs.ok ? h('div', { class: 'err-msg', role: 'alert' }, w.errs.ok) : null];
      side = [preview()];
    }
    const next = () => {
      w.errs = {};
      if (w.step === 0 && !w.name.trim()) w.errs.name = 'اسم الحملة مطلوب';
      if (w.step === 0) { if (w.src === 'saved' && !w.segId) w.errs.src = 'اختار الشريحة';
        else if (w.src === 'filters' && !(w.picked || []).length) w.errs.src = 'اختار العملاء من صفحة العملاء';
        else if (w.src === 'file' && !(w.file && !w.file.error && (w.file.matched.length || (w.file.newRows || []).length))) w.errs.src = 'ارفع شيت فيه أرقام صحيحة';
        else if (!wizAudience(w).total) w.errs.src = 'كل العملاء اتستبعدوا — مفيش حد هيستلم'; } // computed now: the state may have changed since the render
      if (w.step === 1) { if (!campChans(w).length) w.errs.chans = 'اختار قناة واحدة على الأقل'; if (!w.text.trim()) w.errs.text = 'نص الرسالة مطلوب'; if (CS.templateVars(w.text).includes('كود_الخصم') && !w.code.trim()) w.errs.code = 'حدد قيمة الكود'; }
      if (w.step === 2) { const er = CS.validateDelay(Number(w.delay)); if (er) w.errs.delay = er; if (w.when === 'schedule' && !w.date) w.errs.date = 'اختار التاريخ'; }
      if (w.step === 3 && !w.ok) w.errs.ok = 'أكّد إنك راجعت قبل الحفظ';
      if (Object.keys(w.errs).length) { R(); setTimeout(() => { const f = document.querySelector('#pg-cs [aria-invalid=true]'); if (f) f.focus(); }); return; }
      if (w.step < 3) { w.step++; R(); window.scrollTo(0, 0); return; }
      K.confirm({ title: 'نجدول الحملة؟', text: K.n0(n) + ' رسالة من ' + chansLabel(w) + ' · ' + (w.when === 'now' ? 'أول ما القناة تتربط' : K.dlabel(w.date) + ' ' + w.time) + '. هتقدر توقفها في أي وقت من صفحة الحملة.', okLabel: 'تأكيد وجدولة', cancelLabel: 'رجوع',
        onOk: async () => { const r = await persistCampaign(w, 'مجدولة'); if (!done(r, 'الحملة اتجدولت')) return; K.notify({ title: 'حملة «' + w.name + '» اتجدولت', link: '#cs-campaigns', kind: 'cs' }); st.wiz = null; R(); } });
    };
    return [stepper, h('div', { class: 'wiz' }, h('section', { class: 'card wiz-form' }, form), h('aside', { class: 'card wiz-side' }, h('h3', { class: 't-h5' }, w.step === 1 || w.step === 3 ? 'معاينة وملخص' : 'ملخص الحملة'), side)),
      h('div', { class: 'wiz-nav' }, Button({ label: 'السابق', disabled: w.step === 0, onClick: () => { w.step--; R(); } }), Button({ type: 'text', label: 'إلغاء', onClick: () => K.confirm({ title: 'إلغاء الحملة؟', text: 'التعديلات اللي مش محفوظة هتضيع.', okLabel: 'إلغاء الحملة', okType: 'danger', cancelLabel: 'رجوع', onOk: () => { st.wiz = null; R(); } }) }), h('span', { class: 'grow' }), Button({ type: 'primary', label: w.step === 3 ? 'جدولة الحملة' : 'التالي: ' + labels[w.step + 1], attrs: { 'data-wz-next': '' }, onClick: next }))];
  }
  function CampaignDetails(k) {
    const pct = k.size ? (k.sent || 0) / k.size : 0; const manage = can().manage;
    return [h('div', { class: 'row-f' }, Button({ type: 'text', size: 'sm', icon: 'chevR', label: 'كل الحملات', onClick: () => { st.campaign = null; R(); } })),
      h('section', { class: 'card pad' }, h('div', { class: 'row-f' }, K.Tag(CAMP_TONE[k.status] || 'neutral', k.status), h('b', null, K.n0(k.sent || 0) + ' من ' + K.n0(k.size) + ' اتبعتت'), h('span', { class: 'grow' }), h('span', { class: 't-small' }, k.sub)), U.ProgressBar('brand', pct),
        manage ? h('div', { class: 'acts-inline' }, k.status === 'مسودة' ? Button({ size: 'sm', type: 'primary', label: 'تكملة التعديل', onClick: () => startWizard(fromCampaign(k)) }) : null, k.status === 'شغالة' || k.status === 'مجدولة' ? Button({ size: 'sm', label: 'إيقاف مؤقت', onClick: () => campStatus(k, 'متوقفة', 'اتوقفت مؤقتًا') }) : k.status === 'متوقفة' ? Button({ size: 'sm', type: 'primary', label: 'تكملة', onClick: () => campStatus(k, 'مجدولة', 'رجعت مجدولة') }) : null, k.status === 'مسودة' ? Button({ size: 'sm', type: 'danger', label: 'مسح المسودة', onClick: () => K.confirm({ title: 'مسح المسودة؟', text: k.name, okType: 'danger', okLabel: 'امسح', onOk: async () => { const r = await A().deleteCampaign(k.id); if (done(r, 'اتمسحت')) { st.campaign = null; R(); } } }) }) : null) : null),
      h('div', { class: 'cards' }, K.Stat('اتسلمت', K.n0(k.delivered || 0), 'رسالة', k.sent ? Math.round((k.delivered || 0) / k.sent * 100) + '% من اللي اتبعتت' : '—'), K.Stat('اتقرت', K.n0(k.read || 0), 'رسالة', k.delivered ? Math.round((k.read || 0) / k.delivered * 100) + '% من اللي اتسلمت' : '—'), K.Stat('ردود', String(k.replies || 0), 'رد', 'بتدخل صندوق الرسايل بتاج الحملة'), K.Stat('أوردرات', String(k.orders || 0), 'أوردر', 'إيراد ' + K.n0(k.revenue || 0) + ' ج.م')),
      K.Section('الرسالة', h('div', { class: 'brow out' }, h('div', { class: 'bub b-out' }, h('div', { class: 'tx' }, k.body || '—'))), null, { sub: (k.from || '—') + ' · ' + (k.seg || 'من غير شريحة') + ' · ' + K.n0(k.size) + ' عميل' + (k.discountCode ? ' · كود ' + k.discountCode : '') }),
      K.TableSection({ title: 'المستلمين', sub: 'بيتسجلوا مع الإرسال', body: K.Empty('لسه مفيش مستلمين', 'قايمة المستلمين وحالة كل رسالة بتتسجل لما الحملة تتبعت من القناة.') })];
  }

  // ======================= channels (in the page until the settings page — connecting comes with 6.2 / 6.4) =======================
  function Channels() {
    const ch = S.channels; const tone = { connected: 'success', error: 'error', disconnected: 'neutral' }; const lbl = { connected: 'متصلة', error: 'فصلت', disconnected: 'غير متصلة' };
    const s = settings(); const admin = can().admin;
    // 6.2: the Meta channels' state from the server (once per visit; the admin also sees the app's configuration for tools/deploy.md §2.7.16)
    if (st.meta === null && can().view !== 'N' && A().channelStatus) { st.meta = false; A().channelStatus().then((r) => { st.meta = r && r.ok ? r : { ok: false }; if (st.tab === 'channels') R(); }); }
    const meta = st.meta && st.meta.ok ? st.meta : null;
    const page = meta && meta.page ? meta.page : null;
    const anyMeta = ['messenger', 'instagram'].some((k) => ch[k] && ch[k].status === 'connected');
    const connect = (id, c) => {
      if (c.kind !== 'meta') { K.toast(c.kind === 'qr' ? 'ربط واتساب آخر مرحلة بقرار صاحب المشروع' : 'تيك توك مفيهوش API رسايل عام — بيفضل غير متصل'); return; }
      if (meta && !meta.configured) { K.toast('تطبيق Meta لسه مش متظبط على السيرفر — الأسرار META_APP_ID / META_APP_SECRET الأول (tools/deploy.md §2.7.16)', 'error'); return; }
      A().connectStart(id).then((r) => { if (!r.ok) { K.toast(r.reason === 'not_configured' ? 'تطبيق Meta لسه مش متظبط على السيرفر (الأسرار ناقصة)' : r.reason === 'forbidden' ? 'الأدمن بس يقدر يربط القنوات' : 'حصلت مشكلة في الاتصال — جرّب تاني', 'error'); return; } location.assign(r.url); });
    };
    const disconnect = (c) => K.confirm({ title: 'فصل ' + c.name + '؟', text: 'بيفصل ماسنجر وإنستجرام مع بعض (نفس الصفحة): الرسايل الجديدة مش هتوصل الصندوق لحد ما تربط تاني. المحادثات القديمة بتفضل.', okLabel: 'فصل', okType: 'danger', onOk: async () => { const r = await A().disconnect(); if (done(r, 'اتفصلت')) { st.meta = null; R(); } } });
    const setupRows = !admin || !meta ? null : [['تطبيق Meta على السيرفر', meta.configured ? 'الأسرار موجودة ✓' : 'META_APP_ID / META_APP_SECRET ناقصين ✗'], ['Verify token للـ webhook', meta.verifyConfigured ? 'موجود ✓' : 'META_VERIFY_TOKEN ناقص ✗'],
      ['Login configuration (Facebook Login for Business)', meta.loginConfig ? 'META_LOGIN_CONFIG_ID موجود ✓' : 'مش محطوط — الربط بالصلاحيات مباشرة'], ['Callback URL (Webhooks في التطبيق)', meta.webhookUrl || '—'], ['Valid OAuth Redirect URI', meta.redirect || '—'], ['الصفحة المربوطة', page ? page.name + (page.ig && page.ig.username ? ' · @' + page.ig.username : '') : '—'], ['اشتراك الصفحة في الـ webhooks', !page ? '—' : meta.subscribedFields ? meta.subscribedFields.join(', ') + (meta.resubscribed ? ' (اتجدد دلوقتي)' : '') : 'مقدرناش نقراه من Meta'], ['صلاحيات ناقصة على الربط', !page ? '—' : meta.missingPermissions ? (meta.missingPermissions.length ? meta.missingPermissions.join(', ') + ' ✗ — اربط تاني وعلّم عليها' : 'مفيش ✓') : 'مقدرناش نقراها من Meta']];
    return [U.InlineNote({ kind: anyMeta ? 'success' : undefined, children: anyMeta ? 'ماسنجر' + (ch.instagram && ch.instagram.status === 'connected' ? ' وإنستجرام' : '') + ' متصل' + (page ? ' بصفحة «' + page.name + '»' : '') + ' — الرسايل والتعليقات بتوصل الصندوق والردود بتتبعت من هنا. التطبيق في وضع التطوير: رسايل أعضاء التطبيق (Testers) بس لحد التحويل للحي. واتساب 1 و2 في الآخر بقرار صاحب المشروع.'
      : 'ربط ماسنجر وإنستجرام (Meta) من زرار «ربط» — الأدمن بيسجّل دخول فيسبوك ويختار صفحة Ibtekr Club، وبعدها الرسايل والتعليقات بتوصل الصندوق. واتساب 1 و2 في الآخر بقرار صاحب المشروع.' }),
      h('div', { class: 'integ-grid three' }, Object.entries(ch).sort((x, y) => (y[0].startsWith('wa') ? 1 : 0) - (x[0].startsWith('wa') ? 1 : 0)).map(([id, c]) => h('div', { class: 'card integ', 'data-channel': id }, h('div', { class: 'integ-h' }, h('span', { class: 'vlogo vlogo-md' }, Icon(id.startsWith('wa') ? 'whatsapp' : id === 'messenger' ? 'facebook' : id, 'sm')), h('div', null, h('b', null, c.name), h('div', { class: 't-small help' }, c.number || CHAN_WHO[id] || '')), h('span', { class: 'acts-inline' }, K.Tag(c.aud === 'vendors' ? 'gold' : 'brand', c.aud === 'vendors' ? 'المبتكرين' : 'العملاء'), K.Tag(tone[c.status] || 'neutral', lbl[c.status] || c.status))),
        h('div', { class: 't-small' }, c.last || ''), h('div', { class: 't-small help' }, CHAN_USE[id] || ''), c.cap ? h('div', { class: 't-small help' }, 'الحد اليومي: ' + K.n0(c.cap)) : null,
        h('div', { class: 't-small help' }, 'بيشتغل عليها: كل فريق خدمة العملاء (التخصيص من الإعدادات)'),
        c.status === 'connected' && c.since ? h('div', { class: 't-small help' }, 'متصلة من ' + A().timeLabel(Date.parse(c.since))) : null,
        h('div', { class: 'acts-inline start' }, c.status === 'connected' ? (c.kind === 'meta' ? Button({ size: 'sm', label: 'فصل', disabled: !admin, attrs: { 'data-chan-disconnect': id }, onClick: () => disconnect(c) }) : Button({ size: 'sm', label: 'الإعدادات', onClick: () => SOON('إعدادات القناة') })) : Button({ type: 'primary', size: 'sm', label: 'ربط', disabled: !admin, attrs: { 'data-chan-connect': id }, onClick: () => connect(id, c) }))))),
      setupRows ? K.Section('إعداد تطبيق Meta (الأدمن)', h('div', { 'data-meta-setup': '' }, setupRows.map(([t, d]) => h('div', { class: 'set-row' }, h('div', null, h('b', null, t), h('div', { class: 't-small help', dir: /^(http|META|—)/.test(d) ? 'ltr' : 'rtl' }, d))))), null, { sub: 'الخطوات بالتفصيل في tools/deploy.md §2.7.16 — التطبيق في وضع التطوير لحد التحويل للموقع الحي' }) : null,
      K.Section('توزيع المحادثات ومواعيد الرد', S.routing.map(([t, d]) => h('div', { class: 'set-row' }, h('div', null, h('b', null, t), h('div', { class: 't-small help' }, d)))), admin ? [Button({ size: 'sm', label: 'تعديل', attrs: { 'data-cs-settings': '' }, onClick: () => K.form({ title: 'إعدادات خدمة العملاء', values: { routing: s.routing, slaWarn: String(s.slaWarn), slaLate: String(s.slaLate), hours: s.hours, autoCloseDays: String(s.autoCloseDays) },
        fields: (f, e, set) => [K.Radios({ label: 'توزيع المحادثات الجديدة', options: [{ value: 'auto', label: 'تلقائي بالدور (أقل شغل من المتاحين)' }, { value: 'manual', label: 'يدوي' }], value: f.routing, onChange: (v) => set('routing', v, true) }), K.two(K.field.text('slaWarn', 'تحذير أول رد بعد (دقيقة)', f, e, set, { inputmode: 'numeric', required: true }), K.field.text('slaLate', 'متأخر بعد (دقيقة)', f, e, set, { inputmode: 'numeric', required: true })), K.field.text('hours', 'مواعيد العمل', f, e, set), K.field.text('autoCloseDays', 'قفل «مستنية العميل» بعد (يوم)', f, e, set, { inputmode: 'numeric', required: true })],
        validate: (f) => { const er = K.req(f, ['slaWarn', 'slaLate', 'autoCloseDays']); if (Number(f.slaWarn) >= Number(f.slaLate)) er.slaLate = 'لازم يبقى أكبر من التحذير'; return er; }, submitLabel: 'حفظ',
        submit: async (f) => { const r = await A().saveSettings({ routing: f.routing, slaWarn: Number(f.slaWarn), slaLate: Number(f.slaLate), hours: f.hours, autoCloseDays: Number(f.autoCloseDays) }); if (done(r, 'اتحفظت الإعدادات')) R(); } }) })] : null, { sub: 'الأدمن بيعدّلها · هدف أول رد بيحدد ألوان التأخير في الصندوق' })];
  }

  // ======================= performance (from the loaded conversations: open + the last 90 days) =======================
  const RB = () => window.IBReportBlocks || null;
  const inRange = (iso, rg) => { if (!iso) return false; const d = iso.slice(0, 10); return (!rg.from || d >= rg.from) && (!rg.to || d <= rg.to); };
  function perfData(rg) {
    const convs = S.convs.filter((c) => inRange(c.createdAt, rg) || (c.closedAt && inRange(c.closedAt, rg)));
    const first = (c) => { const i = c.msgs.find((m) => m.t === 'in'); if (!i) return null; const o = c.msgs.find((m) => m.t === 'out' && m.at > i.at); return o ? (Date.parse(o.at) - Date.parse(i.at)) / 60000 : null; };
    const resolved = convs.filter((c) => c.status === 'اتحلت'); const firsts = convs.map(first).filter((x) => x != null);
    const solve = resolved.map((c) => (Date.parse(c.closedAt || c.updatedAt) - Date.parse(c.createdAt)) / 3600e3).filter((x) => Number.isFinite(x) && x >= 0);
    const avg = (l) => (l.length ? l.reduce((a, x) => a + x, 0) / l.length : null);
    const byPlat = {}; convs.forEach((c) => { const k = c.seg === 'comments' ? 'تعليقات' : c.seg === 'vendors' ? 'واتساب 2 (المبتكرين)' : PL[c.platform] ? PL[c.platform][0] : c.platform; byPlat[k] = (byPlat[k] || 0) + 1; });
    const byOutcome = {}; resolved.forEach((c) => { const k = c.outcome || 'من غير نتيجة'; byOutcome[k] = (byOutcome[k] || 0) + 1; });
    const team = {}; convs.forEach((c) => { const k = c.assignee || 'غير معيّنة'; const t = (team[k] = team[k] || { name: k, all: 0, resolved: 0, firsts: [], late: 0, open: 0 }); t.all += 1; if (c.status === 'اتحلت') t.resolved += 1; else t.open += 1; const f = first(c); if (f != null) t.firsts.push(f); if (CS.slaLevel(c.status, c.waiting) === 'late') t.late += 1; });
    return { convs, resolved, avgFirst: avg(firsts), avgSolve: avg(solve), byPlat: Object.entries(byPlat).sort((a, b) => b[1] - a[1]), byOutcome: Object.entries(byOutcome).sort((a, b) => b[1] - a[1]), team: Object.values(team).map((t) => Object.assign(t, { avgFirst: avg(t.firsts) })).sort((a, b) => b.resolved - a.resolved), vendors: convs.filter((c) => c.seg === 'vendors').length };
  }
  function agentMenu(t) {
    return K.RowMenu([
      { label: 'محادثاته المفتوحة', icon: 'msg', run: () => { st.tab = 'inbox'; st.fAgent = t.name; st.view = 'all-open'; try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* */ } R(); } },
      { label: 'المتأخرة عن الرد', icon: 'clock', run: () => { st.tab = 'inbox'; st.fAgent = t.name; st.view = 'late'; try { history.replaceState(null, '', '#cs-inbox'); } catch (e) { /* */ } R(); } }], 'إجراءات ' + t.name);
  }
  const fmtMin = (m) => (m == null ? '—' : m < 60 ? Math.round(m) + ' د' : (m / 60).toFixed(1) + ' س');
  function Performance(rg, label) {
    const P = perfData(rg); const n = P.convs.length; const pct = (a) => (n ? a / n : 0);
    const bars = (rows) => (rows.length ? rows.map(([l, v]) => U.BarRow({ tone: 'brand', label: l, value: v + ' (' + Math.round(pct(v) * 100) + '%)', pct: pct(v) })) : [h('div', { class: 't-small help' }, 'مفيش محادثات في الفترة دي')]);
    return [h('div', { class: 'cards five' }, K.Stat('متوسط أول رد', P.avgFirst == null ? '—' : fmtMin(P.avgFirst), '', 'الهدف ' + settings().slaLate + ' دقيقة', P.avgFirst != null && P.avgFirst <= settings().slaLate ? 'positive' : 'negative'), K.Stat('متوسط زمن الحل', P.avgSolve == null ? '—' : P.avgSolve.toFixed(1), 'ساعة', 'من أول رسالة لـ «اتحلت»'), K.Stat('محادثات اتحلت', K.n0(P.resolved.length), 'محادثة', 'من ' + K.n0(n) + ' في الفترة', 'positive'), K.Stat('رضا العملاء', '—', 'من 5', 'استبيان بعد قفل المحادثة — مع ربط القنوات'), K.Stat('محادثات المبتكرين', K.n0(P.vendors), 'محادثة', 'واتساب 2')),
      h('div', { class: 'grid3' }, K.Section('المحادثات حسب المنصة', bars(P.byPlat), null, { sub: K.n0(n) + ' محادثة' }),
        K.Section('نتايج المحادثات', bars(P.byOutcome), null, { sub: 'من نتيجة الإنهاء' }),
        K.Section('الحالة دلوقتي', K.Kv([['مفتوحة', String(S.convs.filter((c) => c.status !== 'اتحلت').length)], ['مستنية ردنا', String(S.convs.filter((c) => c.status === 'مستنية ردنا' || c.status === 'جديدة').length)], ['متأخرة عن الرد', String(S.convs.filter((c) => CS.slaLevel(c.status, c.waiting) === 'late').length)], ['مؤجلة', String(S.convs.filter((c) => c.status === 'مؤجلة').length)]]), null, { sub: 'كل المحادثات المحمّلة' })),
      K.Section('أداء الفريق', P.team.length ? U.Table({ headers: ['الموظف', 'محادثات', 'اتحلت', 'مفتوحة', 'أول رد', 'متأخرة عن الرد', ''], rows: P.team.map((t) => [t.name, K.Num(String(t.all)), K.Num(String(t.resolved)), K.Num(String(t.open)), K.Num(fmtMin(t.avgFirst)), K.Num(String(t.late)), agentMenu(t)]) }) : K.Empty('مفيش محادثات في الفترة', 'الأداء بيتحسب من المحادثات اللي اتعملت أو اتقفلت في الفترة.'), null, { sub: label }),
      h('p', { class: 't-small src-note' }, 'المصدر: سجل المحادثات في السيستم (المفتوحة + آخر 90 يوم) · رضا العملاء من استبيان بعد قفل المحادثة لما القنوات تتربط')];
  }
  const last30 = () => { const to = today(); const d = new Date(Date.now() - 30 * 864e5); return { from: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), to }; };

  // ======================= page =======================
  const TABS = [['inbox', 'الرسايل'], ['customers', 'العملاء'], ['segments', 'شرايح العملاء'], ['campaigns', 'الحملات'], ['channels', 'القنوات'], ['performance', 'الأداء'], ['reports', 'التقارير']];
  function view() {
    if (can().view === 'N') return [K.PageHead('خدمة العملاء', 'كل محادثات العملاء والمبتكرين في مكان واحد'), K.Empty('مش مسموح', 'صفحة خدمة العملاء محتاجة صلاحية «عرض خدمة العملاء».')];
    const manage = can().manage; const reply = can().reply;
    const actions = { inbox: reply ? [Button({ type: 'brand', icon: 'plus', label: 'رسالة جديدة', onClick: () => newMessage() })] : [], customers: manage ? [Button({ type: 'brand', icon: 'plus', label: 'إضافة عميل', onClick: addCustomer })] : [], segments: [], channels: [],
      campaigns: st.wiz ? [Button({ label: 'حفظ كمسودة', attrs: { 'data-wz-draft': '' }, onClick: async () => { const w = st.wiz; if (!w.name.trim()) { w.errs = { name: 'اسم الحملة مطلوب' }; R(); return; } const r = await persistCampaign(w, 'مسودة'); if (!done(r, 'اتحفظت كمسودة')) return; st.wiz = null; R(); } })] : st.campaign ? [] : manage ? [Button({ type: 'brand', icon: 'plus', label: 'حملة جديدة', onClick: () => startWizard() })] : [],
      performance: [h('span', { class: 'chip' }, Icon('cal', 'sm'), 'آخر 30 يوم')], reports: RB() && RB().range ? [RB().range()] : [] }[st.tab] || [];
    const k = st.tab === 'campaigns' && st.campaign ? S.campaigns.find((x) => x.id === st.campaign) : null;
    const title = st.tab === 'campaigns' && st.wiz ? (st.wiz.id ? 'تعديل الحملة' : 'حملة جديدة') : k ? k.name : 'خدمة العملاء';
    const sub = st.tab === 'campaigns' && st.wiz ? st.wiz.name : k ? (k.from || '—') + ' · ' + (k.seg || 'من غير شريحة') + ' (' + K.n0(k.size) + ') · ' + k.sub : 'كل محادثات العملاء والمبتكرين من واتساب وماسنجر وإنستجرام وتيك توك في مكان واحد';
    const rr = RB() && RB().get ? RB().get() : null;
    const body = st.tab === 'inbox' ? [Inbox()] : st.tab === 'customers' ? Customers() : st.tab === 'segments' ? Segments() : st.tab === 'campaigns' ? Campaigns() : st.tab === 'channels' ? Channels() : st.tab === 'reports' ? Performance(rr || last30(), rr ? 'فترة التقارير: ' + rr.from + ' – ' + rr.to : 'آخر 30 يوم') : Performance(last30(), 'آخر 30 يوم');
    const panel = h('div', { class: 'cs-body cs-tab-' + st.tab, role: 'tabpanel' }, body);
    const DA = window.IBDataActions;
    return [K.PageHead(title, sub, [].concat(DA && DA.PAGES && DA.PAGES.cs ? [DA.Menu(DA.PAGES.cs, () => 'customers', () => (manage && (st.tab === 'customers' || st.tab === 'segments') ? [{ value: 'seg-new', label: 'إضافة شريحة جديدة', icon: 'filter', run: () => editSegment() }] : []))] : [], actions)),
      K.MainTabs({ items: TABS.map(([id, label]) => ({ id, label })), active: st.tab, label: 'أقسام خدمة العملاء', onChange: (id) => { st.tab = id; st.wiz = null; st.campaign = null; try { history.replaceState(null, '', '#cs-' + id); } catch (e) { /* */ } R(); } }), panel];
  }
  function addCustomer() { K.form({ title: 'إضافة عميل', values: { name: '', phone: '', city: '', ig: '', source: '', consent: true }, note: U.InlineNote({ children: 'عميل من غير أوردر (استفسار أو مهتم) — العملاء اللي عندهم أوردرات بيتضافوا لوحدهم من الأوردرات.' }), fields: (f, e, set) => [K.field.text('name', 'الاسم', f, e, set, { required: true }), K.two(K.field.text('phone', 'الموبايل / واتساب', f, e, set, { inputmode: 'tel', help: 'بصيغة 01xxxxxxxxx — مش إجباري لو العميل من إنستجرام بس' }), K.field.text('city', 'المدينة', f, e, set)), K.two(K.field.text('ig', 'إنستجرام', f, e, set), K.field.text('source', 'جه منين', f, e, set, { placeholder: 'مثلاً: إعلان فيسبوك' })), K.Checkbox({ label: 'موافق على رسايل العروض (وافق بنفسه)', checked: !!f.consent, onChange: (v) => set('consent', v, true) })],
    validate: (f) => Object.assign(K.req(f, ['name']), f.phone && !/^01\d{9}$/.test(CS.normPhone(f.phone)) ? { phone: 'الرقم لازم يبدأ بـ 01 ويكون 11 رقم' } : {}), submitLabel: 'إضافة',
    submit: async (f) => { const r = await A().addCustomer({ name: f.name, phone: f.phone, city: f.city, ig: f.ig, source: f.source || 'إضافة يدوية', consent: !!f.consent }); if (r && r.duplicate) { K.toast('الرقم ده موجود — افتح ملفه أو ادمجه', 'error'); return; } if (done(r, 'اتضاف ' + f.name)) R(); } }); }
  document.addEventListener('keydown', (e) => {
    if (window.IBPages.current !== 'cs' || st.tab !== 'inbox' || document.querySelector('.scrim')) return;
    const typing = /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '');
    if (e.altKey && /^[1-5]$/.test(e.key) && st.seg !== 'vendors') { const p = (st.seg === 'customers' ? ['all', 'whatsapp', 'messenger', 'instagram', 'tiktok'] : ['all', 'facebook', 'instagram', 'tiktok'])[Number(e.key) - 1]; if (p) { e.preventDefault(); st.plat = p; R(); } return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'j' || e.key === 'k') { const l = filtered(); const i = l.findIndex((c) => c.id === st.sel[st.seg]); const n = l[e.key === 'j' ? Math.min(l.length - 1, i + 1) : Math.max(0, i - 1)]; if (n) { e.preventDefault(); select(n.id); } }
  });
  // ---- notifications group «رسايل»: SLA, mentions, channels that dropped, campaigns ----
  function notifSection(hooks) {
    const go = (fn) => () => { if (window.IBPages.current !== 'cs') hooks.go('cs'); fn(); R(); };
    const open = (c) => go(() => { st.tab = 'inbox'; st.seg = c.seg; st.plat = 'all'; st.view = 'all'; st.sel[c.seg] = c.id; st.mobileChat = true; });
    const chans = Object.entries(S.channels).filter(([, c]) => c.status === 'error').map(([id, c]) => ({ key: 'ch:' + id, title: c.name + ' فصلت', sub: 'الرسايل الجديدة مش بتوصل — اضغط لإعادة الربط', meta: 'الآن', tone: 'error', icon: 'alert', run: go(() => { st.tab = 'channels'; }) }));
    const waiting = S.convs.filter((c) => CS.slaLevel(c.status, c.waiting) !== 'none').sort((a, b) => b.waiting - a.waiting).map((c) => { const cu = c.who && c.seg === 'customers' ? C(c.who) : null; return { own: c.assignee && c.assignee !== 'غير معيّنة' ? { member: c.assignee } : { role: 'خدمة العملاء' }, key: 'sla:' + c.id, title: whoName(c) + ' · ' + chanLabel(c).split(' · ')[0], sub: 'مستنية ردنا من ' + c.waiting + ' دقيقة' + (CS.slaLevel(c.status, c.waiting) === 'late' ? ' (عدّت الهدف ' + CS.SLA.late + ')' : '') + (cu && cu.orderList[0] && cu.orderList[0][3] && cu.orderList[0][3] !== 'OnTime' ? ' · عندها أوردر ' + cu.orderList[0][0] + ' ' + (cu.orderList[0][3] === 'Late' ? 'متأخر' : 'قابل للتأخير') : ''), meta: 'منذ ' + c.waiting + ' دقيقة', tone: CS.slaLevel(c.status, c.waiting) === 'late' ? 'orange' : 'warning', icon: 'msg', run: open(c) }; });
    const mentions = S.convs.flatMap((c) => c.msgs.filter((m) => m.t === 'note' && /@/.test(m.text)).map((m) => ({ key: 'mn:' + m.id, title: m.author + ' ذكر ' + (m.text.match(/@\S+/) || [''])[0], sub: 'في محادثة «' + whoName(c) + '»: ' + m.text.replace(/@\S+\s?/, '').slice(0, 60), meta: m.time, tone: 'neutral', icon: 'at', run: open(c) })));
    const camps = S.campaigns.filter((k) => k.status === 'شغالة' || k.status === 'متوقفة').map((k) => ({ key: 'cp:' + k.id, title: 'حملة «' + k.name + '» ' + (k.status === 'شغالة' ? 'شغالة' : 'متوقفة'), sub: K.n0(k.sent) + ' اتبعتت · ' + k.replies + ' رد · ' + k.orders + ' أوردرات', meta: '', tone: k.status === 'شغالة' ? 'neutral' : 'error', icon: 'megaphone', run: go(() => { st.tab = 'campaigns'; st.campaign = k.id; }) }));
    const all = chans.concat(waiting, mentions, camps);
    return { id: 'messages', label: 'رسايل', icon: 'msg', unit: 'تنبيه', all: go(() => { st.tab = 'inbox'; }), allLabel: 'فتح صندوق الرسايل', empty: 'مفيش رسايل مستنياك.',
      // the tabs do not overlap (the bell counts every tab but «الكل»): late ones under «متأخرة» only
      tabs: [['all', 'الكل', all], ['waiting', 'مستنية ردنا', waiting.filter((x) => x.tone !== 'orange')], ['late', 'متأخرة عن الرد', waiting.filter((x) => x.tone === 'orange')], ['mention', 'منشن', mentions], ['channels', 'القنوات', chans], ['camps', 'حملات', camps]] };
  }
  document.addEventListener('ib:cs', () => {
    const ta = document.activeElement && document.activeElement.id === 'cs-ta' ? document.activeElement : null; const pos = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    R();
    if (pos) { const n = document.getElementById('cs-ta'); if (n) { n.focus(); try { n.setSelectionRange(pos[0], pos[1]); } catch (e) { /* not a text field */ } } }
    try { document.dispatchEvent(new CustomEvent('ib:notify')); } catch (e) { /* the bell's badge counts «رسايل» */ } });
  document.addEventListener('ib:directory', () => R());
  window.IBPages.register('cs', { title: 'خدمة العملاء', hash: (hs) => { const m = /^cs(?:-(inbox|customers|segments|campaigns|channels|performance|reports))?$/.exec(hs); if (!m) return false; st.tab = m[1] || 'inbox'; return true; }, defaultHash: () => 'cs-' + st.tab, view,
    api: { notifSection, state: st, data: S, openCustomer: (id) => { const cu = C(id); if (!cu) return; st.tab = 'customers'; location.hash = 'cs-customers'; setTimeout(() => profile(cu), 120); }, openConversation: (id) => { const c = S.convs.find((x) => x.id === id); if (!c) return; st.tab = 'inbox'; st.seg = c.seg; st.plat = 'all'; st.view = 'all'; st.sel[c.seg] = c.id; st.mobileChat = true; location.hash = 'cs-inbox'; R(); } } });
})();
