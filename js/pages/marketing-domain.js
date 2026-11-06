/* «التسويق» — the v5's campaign domain (IbtekrCampWiz, owner 1 Nov 20:21) + the rules of our schedule and publishing log
   (phase 9.5, docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md). Pure functions (UMD), no UI.
   تفاصيل الكامبين → البناء → المراجعة → النشر (زي ما هو). الرصيد بالكريديت لكل موديل · التكلفة بتظهر قبل أي توليد · لازم كل
   القطع تتوافق قبل النشر.
   Ours (plan decisions 10–16): the prices are the real model credits (PRICE_DEMO false); the AI writing costs no Magnific credit
   (TEXT_FILL 0 — it counts on the monthly AI budget); the video is «قريبًا» (decision 12 — its count stays 0, its code kept for
   later); publishing is a download in 9.5.1 (no platform is connected for posting). */
(function (root) {
  'use strict';
  const GOALS = Object.freeze(['منتج جديد', 'مجموعة جديدة', 'وعي بخدمة', 'عرض / خصم']);
  const MEDIA = Object.freeze([['video', 'فيديو'], ['post', 'بوستات'], ['carousel', 'كاروسيل']]);
  // decision 11: the real model credits (IBImages.MODELS) — no demo prices
  const PRICE_DEMO = false;
  // decision 12: the video waits (AI video after 9.5.1, the owner) — the media tab shows «قريبًا» and its count stays 0
  const VIDEO_SOON = true;
  // كريديت لكل ثانية فيديو (للمرحلة الجاية)
  const VIDEO_RATE = Object.freeze({ 'seedance-2.5': 5, 'seedance-2.0': 6, 'kling-2.5': 2, 'minimax-h3': 1 });
  // decision 10: «املأ بالـ AI» / «إعادة كتابة بالـ AI» are Claude calls on the monthly AI budget (USD) — no Magnific credit
  const TEXT_FILL = 0;
  const METHODS = Object.freeze([['separate', 'مشاهد منفصلة'], ['chained', 'متصلة (بداية ونهاية)']]);
  const METHOD_RATE = Object.freeze({ separate: 1, chained: 1.4 });
  const MAX = Object.freeze({ count: 10, slides: 10, scenes: 8 });
  const DEFAULT_MODEL = 'seedream-5-pro';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const files = () => ({ use: [], ref: [] });

  function defaults() {
    return {
      goal: 'منتج جديد', idea: '', mediaTab: 'post',
      media: {
        video: Object.assign({ count: 0, size: '9:16', dur: 15, model: 'seedance-2.5', notes: '' }, files()),
        post: Object.assign({ count: 2, size: '1080x1350', model: DEFAULT_MODEL, notes: '' }, files()),
        carousel: Object.assign({ count: 1, slides: 4, size: '1080x1350', model: DEFAULT_MODEL, notes: '' }, files()),
      },
      extra: Object.assign({ count: 0, model: DEFAULT_MODEL, notes: '' }, files()),
    };
  }
  const imgRate = (models, id) => ((models || []).find((m) => m.id === id) || (models || [])[0] || { credits: 2 }).credits;
  const videoRate = (id) => VIDEO_RATE[id] || 5;

  function blank(kind) { return { idea: '', caption: '', title: '', sub: '', badge: '', ref: [], use: [], img: null, gen: 0, approved: false, kind }; }
  // القطع بتتبني من إعدادات الميديا؛ القطع اللي اتعملت قبل كده بتفضل زي ما هي لو العدد ما اتغيرش
  function buildPieces(c, prev) {
    const old = {}; (prev || []).forEach((p) => { old[p.id] = p; });
    const out = []; const m = c.media;
    const keep = (id, mk) => out.push(old[id] && old[id].kind === mk().kind ? old[id] : Object.assign(mk(), { id }));
    const vids = VIDEO_SOON ? 0 : m.video.count;
    for (let i = 1; i <= vids; i++) keep('V' + i, () => Object.assign(blank('فيديو'), { n: i, size: m.video.size, model: m.video.model, dur: m.video.dur, sceneCount: 3, scenes: [], method: 'separate', music: { src: 'library', track: '' }, voice: { mode: 'ai', text: '', file: '' }, clips: 0, assembled: false }));
    for (let i = 1; i <= m.post.count; i++) keep('P' + i, () => Object.assign(blank('بوست'), { n: i, size: m.post.size, model: m.post.model }));
    for (let i = 1; i <= m.carousel.count; i++) keep('C' + i, () => Object.assign(blank('كاروسيل'), { n: i, size: m.carousel.size, model: m.carousel.model, slides: Array.from({ length: m.carousel.slides }, (_, k) => Object.assign(blank('شريحة'), { n: k + 1 })) }));
    for (let i = 1; i <= c.extra.count; i++) keep('X' + i, () => Object.assign(blank('ملف إضافي'), { n: i, size: '1080x1080', model: c.extra.model }));
    out.forEach((p) => { if (p.kind === 'كاروسيل') { const want = m.carousel.slides; while (p.slides.length < want) p.slides.push(Object.assign(blank('شريحة'), { n: p.slides.length + 1 })); p.slides.length = want; } });
    return out;
  }
  // مشاهد الفيديو: المدة بتتقسم بالتساوي (ثواني صحيحة) ومجموعها = مدة الفيديو
  function splitScenes(dur, n, prev) {
    n = clamp(n, 1, MAX.scenes); const base = Math.floor(dur / n); let rest = dur - base * n;
    return Array.from({ length: n }, (_, i) => { const d = base + (rest-- > 0 ? 1 : 0); const o = (prev || [])[i] || {}; return { n: i + 1, d, idea: o.idea || '', text: o.text || '', ref: o.ref || [], use: o.use || [], img: o.img || null }; });
  }
  // التكلفة قبل التوليد (كريدت الصور؛ الكتابة بالـ AI = 0 كريدت — قرار 10)
  function cost(action, p, models) {
    if (action === 'fill') return TEXT_FILL;
    if (action === 'image') return imgRate(models, p.model);
    if (action === 'carousel') return imgRate(models, p.model) * (1 + p.slides.length);
    if (action === 'scene') return imgRate(models, DEFAULT_MODEL);
    if (action === 'scenes-img') return imgRate(models, DEFAULT_MODEL) * p.scenes.length;
    if (action === 'clips') return Math.round(videoRate(p.model) * (p.dur || 0) * (METHOD_RATE[p.method] || 1));
    if (action === 'voice') return 2;
    return 0;
  }
  // الرصيد: بيتخصم بس لو كفاية (عرض بس — السيرفر هو اللي بيوقف عند السقف)
  function spend(wallet, n) { if (wallet.cap != null && n > wallet.balance) return false; wallet.balance -= n; wallet.spent += n; return true; }

  // جاهزة للمراجعة = اتولّدت
  function built(p) {
    if (p.kind === 'فيديو') return p.scenes.length > 0 && p.scenes.every((s) => !!s.img);
    if (p.kind === 'كاروسيل') return !!p.img && p.slides.every((s) => !!s.img);
    return !!p.img;
  }
  function approvable(p) { if (p.kind === 'فيديو') return !!p.assembled; return built(p); }
  function approved(p) { if (p.kind === 'كاروسيل') return !!p.approved && p.slides.every((s) => s.approved); return !!p.approved; }
  function approveAll(list) { let n = 0; list.forEach((p) => { if (!approvable(p) || approved(p)) return; p.approved = true; if (p.slides) p.slides.forEach((s) => { s.approved = true; }); n++; }); return n; }
  const progress = (list, fn) => ({ done: list.filter(fn).length, total: list.length });
  const canBuildNext = (list) => list.length > 0 && list.every(built);
  const canReviewNext = (list) => list.length > 0 && list.every(approved);
  function validateDetails(c) {
    const e = {};
    if (!String(c.idea || '').trim()) e.idea = 'اكتب الفكرة العامة';
    if (!c.goal) e.goal = 'اختار الهدف';
    const n = (VIDEO_SOON ? 0 : c.media.video.count) + c.media.post.count + c.media.carousel.count + c.extra.count;
    if (!n) e.media = 'اختار قطعة واحدة على الأقل';
    return e;
  }
  // تقدير تكلفة الكامبين كلها (بيظهر في التفاصيل)
  function estimate(c, models) {
    const m = c.media; const img = (id) => imgRate(models, id);
    const vids = VIDEO_SOON ? 0 : m.video.count;
    return m.post.count * img(m.post.model) + m.carousel.count * (1 + m.carousel.slides) * img(m.carousel.model) + vids * (videoRate(m.video.model) * m.video.dur + 3 * img(DEFAULT_MODEL)) + c.extra.count * img(c.extra.model);
  }

  // ---------------------------------------------------------------- ours: the campaign's status («آخر الشغل», decision 18)

  // [label, tone] from the saved row and its posts: مسودة (step 1) · بتتبني (2) · مستنية المراجعة (3) · جاهزة للنشر (4 before the
  // schedule) · اتجدولت (scheduled, something still waiting) · اتنشرت (scheduled and nothing waiting, one published at least)
  function campaignStatus(row, posts) {
    const r = row || {}; const step = clamp(r.step, 1, 4);
    if (r.scheduledAt) {
      const L = (posts || []).filter((x) => x.campaignId === r.id);
      const waiting = L.some((x) => x.status === 'مجدول' || x.status === 'فشل');
      if (!waiting && L.some((x) => x.status === 'اتنشر')) return ['اتنشرت', 'brand'];
      return ['اتجدولت', 'success'];
    }
    return step === 4 ? ['جاهزة للنشر', 'gold'] : step === 3 ? ['مستنية المراجعة', 'orange'] : step === 2 ? ['بتتبني', 'info'] : ['مسودة', 'neutral'];
  }
  // the campaign's name: the idea's first line (≤ 120)
  const campaignName = (idea) => { const s = String(idea || '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim(); return (s.length > 120 ? s.slice(0, 120).replace(/\s+\S*$/, '') : s) || 'كامبين من غير اسم'; };

  // ---------------------------------------------------------------- ours: the schedule (step 4) and the publishing log

  const PLATFORMS = Object.freeze(['انستجرام', 'فيسبوك', 'تيك توك']);
  // decision 14: nothing connected by default (9.5.1); from 9.5.2 the live connection (mkt-publish status) decides — publishable / notReady
  const CONNECTED = Object.freeze({ 'انستجرام': false, 'فيسبوك': false, 'تيك توك': false });
  const POST_STATUSES = Object.freeze(['مجدول', 'اتنشر', 'فشل', 'اتحذف']);
  const CAP_MAX = 2200; // أقل حد بين المنصات (انستجرام)
  const TAGS = '#إبتكر #هاندميد #ديكور_بوهيمي';
  const TIMES = Object.freeze(Array.from({ length: 16 }, (_, i) => String(8 + i).padStart(2, '0') + ':00'));
  const timeOpts = (cur) => (TIMES.includes(cur) || !cur ? TIMES.slice() : TIMES.concat(cur).sort());
  // the log's kind of a piece
  const postKind = (p) => (p.kind === 'كاروسيل' ? 'كاروسيل' : p.kind === 'فيديو' ? 'ريل' : p.kind === 'ملف إضافي' ? 'ستوري' : 'بوست');
  // a piece's images in order (the post's one, the carousel's cover then its slides)
  function pieceImages(p) {
    if (!p) return [];
    if (p.kind === 'كاروسيل') return [p.img].concat((p.slides || []).map((s) => s.img)).filter(Boolean);
    if (p.kind === 'فيديو') return (p.scenes || []).map((s) => s.img).filter(Boolean);
    return p.img ? [p.img] : [];
  }
  // the hook a log row shows (the v5's syncPub)
  const hookOf = (p) => String(p.title || p.idea || p.kind + ' ' + p.n).replace(/\s+/g, ' ').trim().slice(0, 200);
  // days in ISO (UTC arithmetic on dates only)
  const addD = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // the suggested time of the i-th piece (the v5: every other day from tomorrow, at the evening's busy hours)
  const suggest = (i, today) => ({ date: addD(today, 1 + 2 * (i % 6)), time: ['19:00', '21:00', '20:00'][i % 3] });
  // step 4 → mkt_schedule's items: a row per piece × platform it goes to; `how` (9.5.2) = publish where the piece's «انشر» is on and
  // that platform can take it now (publishable), else a download
  function scheduleItems(pieces, sched, fallbackCaption, conn) {
    const out = [];
    (pieces || []).forEach((p) => {
      const s = (sched || {})[p.id]; if (!s || !Array.isArray(s.pl)) return;
      const caption = String(p.caption || fallbackCaption || '').slice(0, CAP_MAX);
      const kind = postKind(p), images = pieceImages(p), tags = String(p.tags || TAGS).slice(0, 300);
      const wants = Array.isArray(s.how) && s.how.includes('انشر');
      s.pl.filter((x) => PLATFORMS.includes(x)).forEach((platform) => out.push({ piece: p.id, kind, name: hookOf(p), caption, tags, images, platform, day: s.date, time: s.time,
        how: wants && publishable(kind, images, platform, conn, { caption, tags }).ok ? 'publish' : 'download' }));
    });
    return out;
  }

  // ---------------------------------------------------------------- ours: publishing (9.5.2, decisions 30–38)

  // the platforms the system publishes to (TikTok: a download — no API for it yet) and the kinds it publishes (ريل waits for the video)
  const PUBLISHABLE = Object.freeze(['انستجرام', 'فيسبوك']);
  const PUB_KINDS = Object.freeze(['بوست', 'كاروسيل', 'ستوري']);
  const MAX_IMAGES = 10; // a carousel on both platforms
  const PL_KEY = Object.freeze({ 'فيسبوك': 'facebook', 'انستجرام': 'instagram' });
  // the published text: the caption, a blank line, the tags
  const pubText = (caption, tags) => [String(caption || '').trim(), String(tags || '').trim()].filter(Boolean).join('\n\n');
  const chars = (s) => Array.from(String(s || '')).length;
  // the connection (mkt-publish status): { autopublish, facebook: { linked, publish }, instagram: { linked, publish } } → why a platform
  // can't publish now (null = it can)
  function notReady(conn, pl) {
    const c = conn && PL_KEY[pl] ? conn[PL_KEY[pl]] : null;
    if (!conn) return 'حالة الربط لسه بتتحمّل';
    if (!c || !c.linked) return pl === 'انستجرام' ? 'مفيش حساب انستجرام مربوط بالصفحة' : 'الصفحة مش مربوطة';
    if (!c.publish) return 'الربط محتاج صلاحية النشر — الأدمن يربط الصفحة تاني';
    if (!conn.autopublish) return 'النشر التلقائي متوقف — الأدمن يشغّله من كارت الربط';
    return null;
  }
  // a piece × platform can be published by the system now: the platform, the kind, the images, Instagram's text, the connection
  function publishable(kind, images, pl, conn, text) {
    if (!PUBLISHABLE.includes(pl)) return { ok: false, why: pl === 'تيك توك' ? 'تيك توك مش مربوط — داونلود بس' : 'المنصة دي داونلود بس' };
    if (!PUB_KINDS.includes(kind)) return { ok: false, why: 'الفيديو لسه داونلود بس' };
    const n = (images || []).length;
    if (!n) return { ok: false, why: 'مفيش صورة' };
    if (kind === 'كاروسيل' && n < 2) return { ok: false, why: 'الكاروسيل محتاج صورتين على الأقل' };
    if (kind !== 'كاروسيل' && n > 1) return { ok: false, why: 'البوست والستوري صورة واحدة' };
    if (n > MAX_IMAGES) return { ok: false, why: 'أقصى عدد ' + MAX_IMAGES + ' صور في الكاروسيل' };
    if (pl === 'انستجرام' && text && kind !== 'ستوري' && chars(pubText(text.caption, text.tags)) > CAP_MAX) return { ok: false, why: 'الكابشن والهاشتاجات أطول من ' + CAP_MAX + ' حرف (حد انستجرام)' };
    const why = notReady(conn, pl);
    return why ? { ok: false, why } : { ok: true };
  }
  // Instagram's feed ratio (4:5 … 1.91:1): ok as it is, ok with white margins up to 10% to the nearest bound, or refused; a story any ratio.
  // → { ok, pad: { w, h } | null, why }
  const IG_MIN = 0.8, IG_MAX = 1.91, PAD_MAX = 0.10;
  function igFit(w, h, kind) {
    w = Math.round(Number(w)); h = Math.round(Number(h));
    if (!(w > 0) || !(h > 0)) return { ok: false, pad: null, why: 'الصورة مااتقريتش' };
    if (kind === 'ستوري') return { ok: true, pad: null };
    const r = w / h;
    if (r >= IG_MIN && r <= IG_MAX) return { ok: true, pad: null };
    if (r < IG_MIN && IG_MIN / r - 1 <= PAD_MAX) return { ok: true, pad: { w: Math.ceil(h * IG_MIN), h } };
    if (r > IG_MAX && r / IG_MAX - 1 <= PAD_MAX) return { ok: true, pad: { w, h: Math.ceil(w / IG_MAX) } };
    return { ok: false, pad: null, why: 'انستجرام بياخد البوست من 4:5 لـ 1.91:1 — المقاس ده للستوري أو فيسبوك' };
  }
  // the JPEG copy's size (decision 33): the canvas (with the margins) scaled so its long side ≤ 2160
  function jpegSize(w, h, pad) {
    const W = pad ? pad.w : w, H = pad ? pad.h : h; const k = Math.min(1, 2160 / Math.max(W, H));
    return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)), k };
  }
  const isJpeg = (path) => /\.jpe?g$/i.test(String(path || ''));
  // a failed post's reason (the server's code) in words
  const PUB_ERRORS = Object.freeze({
    off: 'النشر التلقائي متوقف', not_linked: 'الصفحة مش مربوطة', no_instagram: 'مفيش حساب انستجرام مربوط بالصفحة',
    permission: 'الربط محتاج صلاحية النشر — الأدمن يربط الصفحة تاني', token: 'ربط الصفحة انتهى — الأدمن يربطها تاني',
    image: 'المنصة رفضت الصورة (المقاس أو النوع)', rate: 'وصلنا لحد النشر على المنصة — جرّب بعد شوية',
    container: 'انستجرام ماقدرش يجهّز البوست', uncertain: 'مش متأكدين إنه اتنشر — بص على الصفحة، ولو مش موجود دوس «انشر دلوقتي»',
    timeout: 'ميتا ماردتش — جرّب تاني', text: 'الكلام أطول من المسموح على المنصة', kind: 'النوع ده مابيتنشرش من السيستم',
    gone: 'البوست مش موجود على المنصة', busy: 'البوست بيتنشر دلوقتي', images: 'صور البوست مش جاهزة للنشر',
  });
  const pubError = (code) => PUB_ERRORS[code] || (/^graph_\d/.test(String(code || '')) ? 'ميتا رفضت (كود ' + String(code).slice(6) + ')' : 'النشر فشل');
  // the numbers (decision 36): a post counts when it was published (or deleted after it was); the engagement = likes + comments + shares + saves
  const seenSt = (x) => !!x && (x.status === 'اتنشر' || (x.status === 'اتحذف' && !!x.wasLive));
  const engOf = (x) => (x && x.eng != null ? Number(x.eng) || 0 : ['likes', 'comments', 'shares', 'saves'].reduce((s, k) => s + (Number(x && x[k]) || 0), 0));
  function postTotals(list) {
    const seen = (list || []).filter(seenSt);
    return { posts: seen.length, views: seen.reduce((s, x) => s + (Number(x.views) || 0), 0), eng: seen.reduce((s, x) => s + engOf(x), 0) };
  }
  const SRC_LABEL = Object.freeze({ system: 'من السيستم', platform: 'من المنصة مباشرة' });
  const isPast = (day, time, today, now) => day < today || (day === today && time <= now);
  const canMove = (x) => x.status === 'مجدول' || x.status === 'فشل';
  // the v5's moveCheck: a day, not a past day or hour (Cairo's today / now), not the same time
  function moveCheck(x, day, time, today, now) {
    if (!day) return { day: 'اختار اليوم' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { day: 'اختار اليوم' };
    if (!/^\d{2}:\d{2}$/.test(String(time || ''))) return { time: 'اختار الساعة' };
    if (day < today) return { day: 'اليوم ده فات — اختار النهارده أو بعده' };
    if (isPast(day, time, today, now)) return { time: 'الساعة دي فاتت النهارده — اختار ساعة بعد ' + now };
    if (x && day === x.day && time === x.time) return { day: 'ده نفس الميعاد الحالي' };
    return null;
  }
  // the ZIP's plan (decision 14): a folder per piece — its images numbered in order and caption.txt (the caption + the tags)
  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'قطعة';
  function zipPlan(items) {
    const used = new Set();
    return (items || []).map((it) => {
      let dir = safeName(it.label); let k = 2; while (used.has(dir)) dir = safeName(it.label) + ' (' + k++ + ')'; used.add(dir);
      const files = (it.images || []).map((path, i) => ({ path, name: dir + '/' + String(i + 1).padStart(2, '0') + '.' + ((/\.([a-z0-9]{3,4})$/i.exec(path) || [, 'jpg'])[1].toLowerCase()) }));
      const text = [it.caption || '', it.tags || ''].filter(Boolean).join('\n\n');
      return { dir, files, caption: { name: dir + '/caption.txt', data: text } };
    });
  }

  // ---------------------------------------------------------------- ours: the calendar (the plan, decision 16)

  const DAYS = Object.freeze(['السبت', 'الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة']);
  const dayIdx = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 1) % 7; // السبت = 0
  const wkStart = (iso) => addD(iso, -dayIdx(iso));
  function weeksOf(from, to) { const out = []; if (!from || !to || from > to) return out; for (let w = wkStart(from); w <= to; w = addD(w, 7)) out.push(w); return out; }
  // the plan's default period (the v5's planDefault): from last week's Saturday, three weeks
  function planDefault(today) { const sat = wkStart(today); return { from: addD(sat, -7), to: addD(sat, 13), preset: 'custom' }; }
  const D2 = (d) => String(d || '').split('-').reverse().join('/');
  const dayLabel = (d) => DAYS[dayIdx(d)] + ' ' + D2(d);
  function relDay(d, today) { const n = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5); return n < 0 ? 'فات ميعاده' : n === 0 ? 'النهارده' : n === 1 ? 'بكرة' : n === 2 ? 'بعد يومين' : n <= 10 ? 'بعد ' + n + ' أيام' : 'بعد ' + n + ' يوم'; }
  const pct = (a, b) => (b ? (Math.round(a / b * 1000) / 10) + '%' : '—');

  // ---------------------------------------------------------------- ours: a pasted link (decision 13)

  // a product link of the site or a SKU → the keys to look it up in the products mirror: the permalink as typed and decoded,
  // with and without its trailing slash (no query or hash), or the SKU in capitals; anything else = null («ارفع الصورة»)
  function linkKeys(text) {
    const s = String(text || '').trim(); if (!s) return null;
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(s)) return { sku: s.toUpperCase() };
    let u; try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const base = u.origin + u.pathname; let dec = base; try { dec = decodeURI(base); } catch (e) { /* keep */ }
    let enc = base; try { enc = encodeURI(dec); } catch (e) { /* keep */ }
    const both = (x) => (x.endsWith('/') ? [x, x.slice(0, -1)] : [x, x + '/']);
    return { permalinks: [...new Set([].concat(both(base), both(dec), both(enc)))] };
  }

  // ---------------------------------------------------------------- 9.5.3: the ads numbers (decisions 44–46) — Meta's own numbers
  // (mkt_ad_stats) next to WooCommerce's orders from the same campaign (mkt_ads_orders, by utm_campaign = Meta's campaign id)

  const ADS_RULES = Object.freeze({ stopSpend: 1500, stopDays: 5, maxCpa: 450, scaleMer: 4, scaleOrders: 5, trackRatio: 2, trackMin: 5, tiredFreq: 4 });
  const AD_PLATFORM = Object.freeze({ meta: 'ميتا', google: 'جوجل', tiktok: 'تيك توك' });
  const SOLD = Object.freeze(['completed', 'in_progress', 'pending']); // an ad order counts as a sale unless cancelled / returned / failed
  const nz = (v) => Number(v) || 0;
  const ratio = (a, b) => (b > 0 ? a / b : null);
  const inRg = (d, rg) => !rg || (d >= rg.from && d <= rg.to);
  // the ad orders (mkt_ads_orders rows) of a period → per platform and per campaign: orders / sales / share (sales only) + cancelled;
  // share stays null when the caller has no accounts.view (the server sends null)
  function adOrders(rows, rg) {
    const out = { platforms: {}, campaigns: {}, shareKnown: false };
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !inRg(r.day, rg)) continue;
      const pl = r.platform || 'meta'; const sold = SOLD.includes(r.grp);
      if (r.share != null) out.shareKnown = true;
      for (const [map, key] of [[out.platforms, pl], [out.campaigns, pl + '|' + (r.campaign || '')]]) {
        const a = map[key] || (map[key] = { orders: 0, sales: 0, share: 0, cancelled: 0, sources: {} });
        if (sold) { a.orders += nz(r.orders); a.sales += nz(r.sales); a.share += nz(r.share); a.sources[r.source || ''] = (a.sources[r.source || ''] || 0) + nz(r.orders); } else a.cancelled += nz(r.orders);
      }
    }
    return out;
  }
  const dayStats = (stats, level, rg) => (Array.isArray(stats) ? stats : []).filter((s) => s && s.level === level && inRg(s.day, rg));
  // the campaigns of a period: Meta's numbers + the Woo orders of the same campaign id; a campaign with orders but no spend in the
  // period is listed too (its ads ran before); sorted by spend
  function adCampaignRows(objects, stats, orderRows, rg) {
    const names = {}; for (const o of Array.isArray(objects) ? objects : []) if (o && o.kind === 'campaign') names[o.id] = o;
    const byId = {};
    const row = (id) => byId[id] || (byId[id] = { id, name: (names[id] && names[id].name) || '#' + id, status: (names[id] && names[id].status) || null, platform: AD_PLATFORM.meta,
      spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0, orders: 0, sales: 0, share: 0, cancelled: 0, sources: {}, days: {} });
    for (const s of dayStats(stats, 'campaign', rg)) {
      const r = row(s.object_id); r.spend += nz(s.spend); r.impressions += nz(s.impressions); r.clicks += nz(s.link_clicks != null ? s.link_clicks : s.clicks);
      r.purchases += nz(s.purchases); r.value += nz(s.purchase_value);
      const d = r.days[s.day] || (r.days[s.day] = { day: s.day, spend: 0, purchases: 0, orders: 0 }); d.spend += nz(s.spend); d.purchases += nz(s.purchases);
    }
    for (const o of Array.isArray(orderRows) ? orderRows : []) {
      if (!o || o.platform !== 'meta' || !/^[0-9]{6,30}$/.test(String(o.campaign || '')) || !inRg(o.day, rg)) continue;
      const r = row(o.campaign);
      if (SOLD.includes(o.grp)) {
        r.orders += nz(o.orders); r.sales += nz(o.sales); r.share += nz(o.share); r.sources[o.source || ''] = (r.sources[o.source || ''] || 0) + nz(o.orders);
        const d = r.days[o.day] || (r.days[o.day] = { day: o.day, spend: 0, purchases: 0, orders: 0 }); d.orders += nz(o.orders);
      } else r.cancelled += nz(o.orders);
    }
    return Object.values(byId).filter((r) => r.spend > 0 || r.orders > 0 || r.cancelled > 0).map((r) => Object.assign(r, {
      spend: Math.round(r.spend * 100) / 100, mer: ratio(r.sales, r.spend), cpa: ratio(r.spend, r.orders), roas: ratio(r.value, r.spend),
      days: Object.values(r.days).sort((a, b) => a.day.localeCompare(b.day)),
    })).sort((a, b) => b.spend - a.spend || b.orders - a.orders);
  }
  // the overview's KPIs: Meta's spend and own numbers; the orders and sales from every ad platform (Google / TikTok have no spend
  // until they are linked); the profit after ads = Ibtekr's share of Meta's orders − the spend (null without accounts.view). `money`
  // (the caller's admin / accounts.view) decides it when given — with no ad order the share is 0 and the profit is the spend's loss;
  // without it the rows say (the server sends the share as null to a member without accounts.view)
  function adTotals(stats, orderRows, rg, money) {
    const st = dayStats(stats, 'campaign', rg); const o = adOrders(orderRows, rg); const meta = o.platforms.meta || { orders: 0, sales: 0, share: 0, cancelled: 0, sources: {} };
    const known = typeof money === 'boolean' ? money : o.shareKnown;
    const spend = Math.round(st.reduce((s, x) => s + nz(x.spend), 0) * 100) / 100; const purchases = st.reduce((s, x) => s + nz(x.purchases), 0); const value = st.reduce((s, x) => s + nz(x.purchase_value), 0);
    const all = Object.values(o.platforms).reduce((a, p) => ({ orders: a.orders + p.orders, sales: a.sales + p.sales, share: a.share + p.share }), { orders: 0, sales: 0, share: 0 });
    const platforms = Object.keys(AD_PLATFORM).map((k) => { const p = o.platforms[k] || { orders: 0, sales: 0, share: 0, cancelled: 0, sources: {} };
      return { key: k, label: AD_PLATFORM[k], linked: k === 'meta', spend: k === 'meta' ? spend : null, purchases: k === 'meta' ? purchases : null, orders: p.orders, sales: p.sales, sources: p.sources,
        mer: k === 'meta' ? ratio(p.sales, spend) : null, roas: k === 'meta' ? ratio(value, spend) : null }; });
    return { spend, purchases, value, orders: all.orders, sales: all.sales, metaOrders: meta.orders, metaSales: meta.sales, cancelled: Object.values(o.platforms).reduce((s, p) => s + p.cancelled, 0),
      mer: ratio(meta.sales, spend), cpa: ratio(spend, meta.orders), roas: ratio(value, spend), platformCpa: ratio(spend, purchases),
      share: known ? Math.round(all.share * 100) / 100 : null, metaShare: known ? Math.round(meta.share * 100) / 100 : null, profit: known ? Math.round((meta.share - spend) * 100) / 100 : null, platforms };
  }
  // the real return of the last n weeks (7 days each, the last ending on `to`), the oldest first — Meta's spend vs its campaigns' sales
  function merWeeks(stats, orderRows, to, n) {
    const out = [];
    for (let i = (n || 5) - 1; i >= 0; i -= 1) {
      const end = addD(to, -7 * i); const rg = { from: addD(end, -6), to: end }; const t = adTotals(stats, orderRows, rg);
      out.push({ from: rg.from, to: rg.to, spend: t.spend, sales: t.metaSales, mer: t.mer });
    }
    return out;
  }
  // the media buyer's alerts (decision 45) — rules only, no action: stop? (≥ stopSpend in the last stopDays without an order, an
  // active campaign), the order's real cost over maxCpa, scale? (real return ≥ scaleMer with ≥ scaleOrders orders, active), check the
  // tracking (Meta's purchases ≥ trackRatio × Woo's orders, ≥ trackMin)
  const ALERT_RANK = { error: 0, orange: 1, info: 2, success: 3 };
  function adAlerts(objects, stats, orderRows, rg, today, rules) {
    const R = Object.assign({}, ADS_RULES, rules || {}); const out = [];
    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    const recent = adCampaignRows(objects, stats, orderRows, { from: addD(today, -(R.stopDays - 1)), to: today });
    for (const c of recent) {
      if (c.status !== 'ACTIVE' || c.spend < R.stopSpend || c.orders > 0) continue;
      out.push({ key: 'stop:' + c.id, tone: 'error', icon: 'alert', campaign: c.id, title: 'وقّف «' + c.name + '»؟', sub: 'صرفت ' + fmt(c.spend) + ' ج.م · ولا أوردر في ووكومرس من ' + R.stopDays + ' أيام',
        why: 'ميتا بتحسب ' + fmt(c.purchases) + ' مشتريات، بس مفيش ولا أوردر في ووكومرس جاي من الحملة دي (utm_campaign) في آخر ' + R.stopDays + ' أيام.' });
    }
    for (const c of adCampaignRows(objects, stats, orderRows, rg)) {
      if (c.orders > 0 && c.cpa > R.maxCpa) out.push({ key: 'cpa:' + c.id, tone: 'orange', icon: 'clock', campaign: c.id, title: 'تكلفة الأوردر عالية في «' + c.name + '»', sub: 'تكلفة الأوردر الحقيقية ' + fmt(c.cpa) + ' ج.م · الحد ' + fmt(R.maxCpa),
        why: 'صرفت ' + fmt(c.spend) + ' ج.م وجابت ' + c.orders + ' أوردر في ووكومرس في الفترة.' });
      if (c.purchases >= R.trackMin && c.purchases >= R.trackRatio * c.orders) out.push({ key: 'track:' + c.id, tone: 'info', icon: 'clock', campaign: c.id, title: 'راجع التتبع في «' + c.name + '»', sub: 'ميتا بتقول ' + fmt(c.purchases) + ' مشتريات · ووكومرس ' + c.orders + ' أوردر',
        why: 'ممكن البكسل بيعد مرتين أو الـ UTM مش متحط على كل الإعلانات.' });
      if (c.status === 'ACTIVE' && c.mer != null && c.mer >= R.scaleMer && c.orders >= R.scaleOrders) out.push({ key: 'scale:' + c.id, tone: 'success', icon: 'users', campaign: c.id, title: 'زوّد «' + c.name + '»؟', sub: 'العائد الحقيقي ' + c.mer.toFixed(2) + '× · ' + c.orders + ' أوردر في ووكومرس',
        why: 'من أعلى عائد حقيقي في الحملات وتكلفة الأوردر ' + fmt(c.cpa) + ' ج.م.' });
    }
    return out.sort((a, b) => ALERT_RANK[a.tone] - ALERT_RANK[b.tone]);
  }
  // the creatives (one row per ad with spend in the period): Meta's numbers; the frequency weighted by impressions (a day's
  // frequency is not additive); tired = the frequency at tiredFreq or more (the people saw it too often); the real return per ad
  // needs utm_content={{ad.id}} in the ads
  function adCreatives(objects, stats, rg, rules) {
    const R = Object.assign({}, ADS_RULES, rules || {});
    const ads = {}, camps = {};
    for (const o of Array.isArray(objects) ? objects : []) { if (!o) continue; if (o.kind === 'ad') ads[o.id] = o; else if (o.kind === 'campaign') camps[o.id] = o; }
    const by = {};
    for (const s of dayStats(stats, 'ad', rg)) {
      const a = by[s.object_id] || (by[s.object_id] = { id: s.object_id, campaign: s.campaign_id, spend: 0, impressions: 0, clicks: 0, purchases: 0, value: 0, fw: 0 });
      a.spend += nz(s.spend); a.impressions += nz(s.impressions); a.clicks += nz(s.link_clicks != null ? s.link_clicks : s.clicks); a.purchases += nz(s.purchases); a.value += nz(s.purchase_value);
      a.fw += nz(s.frequency) * nz(s.impressions);
    }
    return Object.values(by).filter((a) => a.spend > 0).map((a) => {
      const o = ads[a.id] || {}; const c = camps[a.campaign] || {};
      return { id: a.id, name: o.name || '#' + a.id, campaign: c.name || '#' + a.campaign, status: o.status || null, thumb: typeof o.thumb === 'string' && /^https:\/\//.test(o.thumb) ? o.thumb : null,
        spend: Math.round(a.spend * 100) / 100, impressions: a.impressions, clicks: a.clicks, purchases: a.purchases, value: a.value,
        ctr: ratio(a.clicks, a.impressions), frequency: a.impressions ? a.fw / a.impressions : null, roas: ratio(a.value, a.spend),
        tired: a.impressions > 0 && a.fw / a.impressions >= R.tiredFreq };
    }).sort((x, y) => y.spend - x.spend);
  }
  const xr = (v) => (v == null ? '—' : Number(v).toFixed(2) + '×');

  const api = { PRICE_DEMO, VIDEO_SOON, METHOD_RATE, GOALS, MEDIA, VIDEO_RATE, METHODS, MAX, TEXT_FILL, DEFAULT_MODEL, clamp, defaults, buildPieces, splitScenes, cost, spend, built, approvable, approved, approveAll, progress, canBuildNext, canReviewNext, validateDetails, estimate, imgRate, videoRate,
    campaignStatus, campaignName, PLATFORMS, CONNECTED, POST_STATUSES, CAP_MAX, TAGS, TIMES, timeOpts, postKind, pieceImages, hookOf, addD, suggest, scheduleItems, isPast, canMove, moveCheck, safeName, zipPlan,
    PUBLISHABLE, PUB_KINDS, MAX_IMAGES, PL_KEY, pubText, notReady, publishable, igFit, jpegSize, isJpeg, PUB_ERRORS, pubError, seenSt, engOf, postTotals, SRC_LABEL,
    DAYS, dayIdx, wkStart, weeksOf, planDefault, D2, dayLabel, relDay, pct, linkKeys,
    ADS_RULES, AD_PLATFORM, SOLD, adOrders, adCampaignRows, adTotals, merWeeks, adAlerts, adCreatives, xr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrCampWiz = api;
})(typeof window !== 'undefined' ? window : globalThis);
