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
  // decision 14: nothing is connected for posting in 9.5.1 (9.5.2 connects Facebook and Instagram) — every piece is a download
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
  // step 4 → mkt_schedule's items: a row per piece × platform it goes to
  function scheduleItems(pieces, sched, fallbackCaption) {
    const out = [];
    (pieces || []).forEach((p) => {
      const s = (sched || {})[p.id]; if (!s || !Array.isArray(s.pl)) return;
      const caption = String(p.caption || fallbackCaption || '').slice(0, CAP_MAX);
      s.pl.filter((x) => PLATFORMS.includes(x)).forEach((platform) => out.push({ piece: p.id, kind: postKind(p), name: hookOf(p), caption, tags: String(p.tags || TAGS).slice(0, 300), images: pieceImages(p), platform, day: s.date, time: s.time }));
    });
    return out;
  }
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

  const api = { PRICE_DEMO, VIDEO_SOON, METHOD_RATE, GOALS, MEDIA, VIDEO_RATE, METHODS, MAX, TEXT_FILL, DEFAULT_MODEL, clamp, defaults, buildPieces, splitScenes, cost, spend, built, approvable, approved, approveAll, progress, canBuildNext, canReviewNext, validateDetails, estimate, imgRate, videoRate,
    campaignStatus, campaignName, PLATFORMS, CONNECTED, POST_STATUSES, CAP_MAX, TAGS, TIMES, timeOpts, postKind, pieceImages, hookOf, addD, suggest, scheduleItems, isPast, canMove, moveCheck, safeName, zipPlan,
    DAYS, dayIdx, wkStart, weeksOf, planDefault, D2, dayLabel, relDay, pct, linkKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrCampWiz = api;
})(typeof window !== 'undefined' ? window : globalThis);
