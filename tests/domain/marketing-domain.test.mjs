import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// The marketing domain (phase 9.5): the v5's campaign wizard (IbtekrCampWiz) as it is + our rules (plan decisions 10–18): the
// real credits, the AI writing at no credit, the video «قريبًا», the campaign's status, the schedule's items, the move check,
// the ZIP plan, the plan calendar's weeks and a pasted product link.
const W = loadUmd(new URL('../../app/js/pages/marketing-domain.js', import.meta.url));
const plain = (v) => JSON.parse(JSON.stringify(v));
const MODELS = [{ id: 'seedream-5-pro', credits: 75 }, { id: 'gpt-image-2', credits: 60 }, { id: 'gemini-2-5-flash', credits: 20 }];

test('defaults: posts and a carousel, no video (soon), an empty idea, the real default model', () => {
  const c = W.defaults();
  assert.equal(c.idea, ''); assert.equal(c.mediaTab, 'post');
  assert.equal(c.media.video.count, 0); assert.equal(c.media.post.count, 2); assert.equal(c.media.carousel.count, 1); assert.equal(c.extra.count, 0);
  assert.equal(c.media.post.model, 'seedream-5-pro');
  assert.equal(W.PRICE_DEMO, false); assert.equal(W.VIDEO_SOON, true); assert.equal(W.TEXT_FILL, 0);
});

test('buildPieces: P / C / X ids, the carousel slides, old pieces kept, no video while it is soon', () => {
  const c = W.defaults(); c.media.video.count = 2; c.extra.count = 1;
  const ps = W.buildPieces(c, []);
  assert.deepEqual(ps.map((p) => p.id), ['P1', 'P2', 'C1', 'X1']);
  const car = ps.find((p) => p.id === 'C1'); assert.equal(car.slides.length, 4); assert.equal(car.slides[0].kind, 'شريحة');
  ps[0].idea = 'لقطة'; ps[0].img = 'cid/gen-P1.png';
  c.media.carousel.slides = 2; const again = W.buildPieces(c, ps);
  assert.equal(again[0].idea, 'لقطة'); assert.equal(again[0].img, 'cid/gen-P1.png');
  assert.equal(again.find((p) => p.id === 'C1').slides.length, 2);
  c.media.post.count = 1; assert.deepEqual(W.buildPieces(c, again).map((p) => p.id), ['P1', 'C1', 'X1']);
});

test('cost: the model credits per image, the carousel = cover + slides, the AI writing = 0 credits', () => {
  assert.equal(W.cost('image', { model: 'gpt-image-2' }, MODELS), 60);
  assert.equal(W.cost('carousel', { model: 'seedream-5-pro', slides: [{}, {}, {}] }, MODELS), 300);
  assert.equal(W.cost('fill', {}, MODELS), 0);
  assert.equal(W.cost('image', { model: 'unknown' }, MODELS), 75); // an unknown model = the first one
});

test('estimate: posts + carousels (cover + slides) + extras, no video while it is soon', () => {
  const c = W.defaults(); c.media.video.count = 3; c.extra.count = 2; c.extra.model = 'gemini-2-5-flash';
  // 2 × 75 + 1 × 5 × 75 + 2 × 20
  assert.equal(W.estimate(c, MODELS), 150 + 375 + 40);
});

test('validateDetails: the idea, the goal and one piece at least (the video does not count while soon)', () => {
  const c = W.defaults();
  assert.deepEqual(plain(W.validateDetails(c)), { idea: 'اكتب الفكرة العامة' });
  c.idea = 'كولكشن الشتا'; c.media.post.count = 0; c.media.carousel.count = 0; c.media.video.count = 2;
  assert.deepEqual(plain(W.validateDetails(c)), { media: 'اختار قطعة واحدة على الأقل' });
  c.extra.count = 1; assert.deepEqual(plain(W.validateDetails(c)), {});
});

test('built / approved / approveAll: a carousel needs its cover and every slide', () => {
  const c = W.defaults(); const [p1, , c1] = W.buildPieces(c, []);
  assert.equal(W.built(p1), false); p1.img = 'x.png'; assert.equal(W.built(p1), true);
  c1.img = 'cover.png'; assert.equal(W.built(c1), false); c1.slides.forEach((s, k) => { s.img = 's' + k + '.png'; }); assert.equal(W.built(c1), true);
  assert.equal(W.approveAll([p1, c1]), 2); assert.equal(W.approved(c1), true); assert.equal(W.canReviewNext([p1, c1]), true);
  c1.slides[1].approved = false; assert.equal(W.approved(c1), false);
});

test('spend: only the display — with a cap it refuses over the balance, with no cap it counts what was spent', () => {
  const w = { cap: 100, balance: 100, spent: 0 };
  assert.equal(W.spend(w, 75), true); assert.equal(w.balance, 25); assert.equal(W.spend(w, 60), false); assert.equal(w.spent, 75);
  const free = { cap: null, balance: 0, spent: 10 }; assert.equal(W.spend(free, 60), true); assert.equal(free.spent, 70);
});

test('campaignStatus: draft → building → review → ready → scheduled → published', () => {
  assert.deepEqual(W.campaignStatus({ step: 1 }), ['مسودة', 'neutral']);
  assert.deepEqual(W.campaignStatus({ step: 2 }), ['بتتبني', 'info']);
  assert.deepEqual(W.campaignStatus({ step: 3 }), ['مستنية المراجعة', 'orange']);
  assert.deepEqual(W.campaignStatus({ step: 4 }), ['جاهزة للنشر', 'gold']);
  const row = { id: 'c1', step: 4, scheduledAt: '2026-11-06T10:00:00Z' };
  assert.deepEqual(W.campaignStatus(row, [{ campaignId: 'c1', status: 'مجدول' }, { campaignId: 'c1', status: 'اتنشر' }]), ['اتجدولت', 'success']);
  assert.deepEqual(W.campaignStatus(row, [{ campaignId: 'c1', status: 'اتحذف' }, { campaignId: 'c1', status: 'اتنشر' }, { campaignId: 'c2', status: 'مجدول' }]), ['اتنشرت', 'brand']);
  assert.deepEqual(W.campaignStatus(row, [{ campaignId: 'c1', status: 'اتحذف' }]), ['اتجدولت', 'success']);
});

test('campaignName: the idea first line, 120 at most, a name when empty', () => {
  assert.equal(W.campaignName('كولكشن الشتا\nمشغولة يدويًا'), 'كولكشن الشتا');
  assert.equal(W.campaignName('   '), 'كامبين من غير اسم');
  assert.ok(W.campaignName('كلمة '.repeat(60)).length <= 120);
});

test('scheduleItems: a row per piece × platform, the images in order, the kind of the log, the caption capped', () => {
  const c = W.defaults(); c.extra.count = 1; const ps = W.buildPieces(c, []);
  ps[0].img = 'c/p1.png'; ps[0].title = 'دفا الشتا'; ps[0].caption = 'x'.repeat(2500);
  const car = ps[2]; car.img = 'c/cover.png'; car.slides.forEach((s, k) => { s.img = 'c/s' + k + '.png'; });
  ps[3].img = 'c/x1.png';
  const sched = { P1: { date: '2026-11-08', time: '19:00', pl: ['انستجرام', 'فيسبوك'] }, C1: { date: '2026-11-09', time: '21:00', pl: ['فيسبوك', 'X'] }, X1: { date: '2026-11-10', time: '20:00', pl: [] } };
  const items = W.scheduleItems(ps, sched, 'الفكرة');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((x) => [x.piece, x.platform, x.kind]), [['P1', 'انستجرام', 'بوست'], ['P1', 'فيسبوك', 'بوست'], ['C1', 'فيسبوك', 'كاروسيل']]);
  assert.equal(items[0].caption.length, W.CAP_MAX); assert.equal(items[0].name, 'دفا الشتا');
  assert.deepEqual(items[2].images, ['c/cover.png', 'c/s0.png', 'c/s1.png', 'c/s2.png', 'c/s3.png']);
  assert.equal(items[2].caption, 'الفكرة'); // no caption → the campaign's idea
  assert.equal(W.postKind({ kind: 'ملف إضافي' }), 'ستوري');
  assert.ok(items.every((x) => x.how === 'download')); // 9.5.2: no «انشر» on the piece, no connection → a download
});

// ---------------------------------------------------------------- 9.5.2: publishing (decisions 30–38)

const LIVE = { autopublish: true, facebook: { linked: true, publish: true }, instagram: { linked: true, publish: true } };

test('9.5.2 scheduleItems: «انشر» on the piece → publish where the platform can take it, TikTok and the video stay a download', () => {
  const c = W.defaults(); const ps = W.buildPieces(c, []);
  ps[0].img = 'c/p1.jpg'; ps[2].img = 'c/cover.jpg'; ps[2].slides.forEach((s, k) => { s.img = 'c/s' + k + '.jpg'; });
  const sched = { P1: { date: '2026-11-08', time: '19:00', pl: ['انستجرام', 'فيسبوك', 'تيك توك'], how: ['انشر'] }, C1: { date: '2026-11-09', time: '21:00', pl: ['فيسبوك'], how: ['داونلود'] } };
  const items = W.scheduleItems(ps, sched, 'الفكرة', LIVE);
  assert.deepEqual(items.map((x) => [x.piece, x.platform, x.how]), [['P1', 'انستجرام', 'publish'], ['P1', 'فيسبوك', 'publish'], ['P1', 'تيك توك', 'download'], ['C1', 'فيسبوك', 'download']]);
  // the switch off (or no permission) → nothing is published
  assert.ok(W.scheduleItems(ps, sched, 'x', { ...LIVE, autopublish: false }).every((x) => x.how === 'download'));
  assert.ok(W.scheduleItems(ps, sched, 'x', null).every((x) => x.how === 'download'));
});

test('9.5.2 publishable: the platform, the kind, the image count, Instagram\'s 2200 characters, then the connection with its reason', () => {
  assert.deepEqual(W.publishable('بوست', ['a.jpg'], 'فيسبوك', LIVE), { ok: true });
  assert.equal(W.publishable('بوست', ['a.jpg'], 'تيك توك', LIVE).why, 'تيك توك مش مربوط — داونلود بس');
  assert.equal(W.publishable('ريل', ['a.jpg'], 'انستجرام', LIVE).why, 'الفيديو لسه داونلود بس');
  assert.equal(W.publishable('بوست', [], 'انستجرام', LIVE).why, 'مفيش صورة');
  assert.equal(W.publishable('كاروسيل', ['a.jpg'], 'انستجرام', LIVE).why, 'الكاروسيل محتاج صورتين على الأقل');
  assert.equal(W.publishable('بوست', ['a.jpg', 'b.jpg'], 'انستجرام', LIVE).why, 'البوست والستوري صورة واحدة');
  assert.equal(W.publishable('كاروسيل', Array(11).fill('a.jpg'), 'فيسبوك', LIVE).why, 'أقصى عدد 10 صور في الكاروسيل');
  assert.ok(W.publishable('كاروسيل', Array(10).fill('a.jpg'), 'انستجرام', LIVE).ok);
  // Instagram's limit counts the caption + the tags (a story has none)
  const long = { caption: 'ك'.repeat(2190), tags: '#إبتكر #هاندميد' };
  assert.match(W.publishable('بوست', ['a.jpg'], 'انستجرام', LIVE, long).why, /2200/);
  assert.ok(W.publishable('بوست', ['a.jpg'], 'فيسبوك', LIVE, long).ok);
  assert.ok(W.publishable('ستوري', ['a.jpg'], 'انستجرام', LIVE, long).ok);
  // the connection's reasons, in order
  assert.equal(W.publishable('بوست', ['a.jpg'], 'فيسبوك', null).why, 'حالة الربط لسه بتتحمّل');
  assert.equal(W.publishable('بوست', ['a.jpg'], 'انستجرام', { ...LIVE, instagram: { linked: false } }).why, 'مفيش حساب انستجرام مربوط بالصفحة');
  assert.equal(W.publishable('بوست', ['a.jpg'], 'فيسبوك', { ...LIVE, facebook: { linked: false } }).why, 'الصفحة مش مربوطة');
  assert.match(W.publishable('بوست', ['a.jpg'], 'فيسبوك', { ...LIVE, facebook: { linked: true, publish: false } }).why, /صلاحية النشر/);
  assert.match(W.publishable('بوست', ['a.jpg'], 'فيسبوك', { ...LIVE, autopublish: false }).why, /متوقف/);
});

test('9.5.2 igFit / jpegSize: 4:5 … 1.91:1 as it is, white margins up to 10%, refused beyond; a story any ratio; the long side ≤ 2160', () => {
  assert.deepEqual(W.igFit(1080, 1350, 'بوست'), { ok: true, pad: null });
  assert.deepEqual(W.igFit(1080, 1080, 'كاروسيل'), { ok: true, pad: null });
  assert.deepEqual(W.igFit(1080, 1440, 'بوست'), { ok: true, pad: { w: 1152, h: 1440 } }); // 3:4 → 4:5 with side margins
  assert.ok(1152 / 1440 >= 0.8);
  assert.deepEqual(W.igFit(1200, 627, 'بوست'), { ok: true, pad: { w: 1200, h: 629 } }); // just over 1.91 → top / bottom margins
  assert.ok(1200 / 629 <= 1.91);
  assert.equal(W.igFit(1080, 1920, 'بوست').ok, false); // 9:16: a story size
  assert.match(W.igFit(1000, 1500, 'كاروسيل').why, /4:5/);
  assert.deepEqual(W.igFit(1080, 1920, 'ستوري'), { ok: true, pad: null });
  assert.equal(W.igFit(0, 100, 'بوست').ok, false);
  assert.deepEqual(W.jpegSize(1080, 1350, null), { w: 1080, h: 1350, k: 1 });
  const big = W.jpegSize(2048, 2560, null); assert.equal(Math.max(big.w, big.h), 2160);
  assert.deepEqual(W.jpegSize(1080, 1440, { w: 1152, h: 1440 }), { w: 1152, h: 1440, k: 1 });
  assert.ok(W.isJpeg('c/pub-ab.jpg') && W.isJpeg('c/x.JPEG') && !W.isJpeg('c/x.png'));
});

test('9.5.2 the text, the reasons, the numbers: caption + blank line + tags, every code in words, the totals of the seen posts', () => {
  assert.equal(W.pubText(' كابشن ', '#a #b'), 'كابشن\n\n#a #b');
  assert.equal(W.pubText('كابشن', ''), 'كابشن');
  assert.equal(W.pubError('rate'), 'وصلنا لحد النشر على المنصة — جرّب بعد شوية');
  assert.match(W.pubError('uncertain'), /انشر دلوقتي/);
  assert.equal(W.pubError('graph_368'), 'ميتا رفضت (كود 368)');
  assert.equal(W.pubError('weird'), 'النشر فشل');
  const L = [{ status: 'اتنشر', views: 1000, likes: 40, comments: 5, shares: 3, saves: 2 }, { status: 'اتنشر', views: 500, eng: 20 },
    { status: 'اتحذف', wasLive: true, views: 100, eng: 10 }, { status: 'اتحذف', wasLive: false, views: 900, eng: 90 }, { status: 'مجدول', views: 0 }];
  assert.deepEqual(W.postTotals(L), { posts: 3, views: 1600, eng: 80 });
  assert.equal(W.engOf({ likes: 1, comments: 2, shares: 3, saves: 4 }), 10);
  assert.equal(W.SRC_LABEL.platform, 'من المنصة مباشرة');
});

test('moveCheck: a day, not past, not the same; isPast on Cairo today and now', () => {
  const x = { day: '2026-11-08', time: '19:00' };
  assert.deepEqual(plain(W.moveCheck(x, '', '19:00', '2026-11-06', '12:00')), { day: 'اختار اليوم' });
  assert.deepEqual(plain(W.moveCheck(x, '2026-11-05', '19:00', '2026-11-06', '12:00')), { day: 'اليوم ده فات — اختار النهارده أو بعده' });
  assert.deepEqual(plain(W.moveCheck(x, '2026-11-06', '11:00', '2026-11-06', '12:00')), { time: 'الساعة دي فاتت النهارده — اختار ساعة بعد 12:00' });
  assert.deepEqual(plain(W.moveCheck(x, '2026-11-08', '19:00', '2026-11-06', '12:00')), { day: 'ده نفس الميعاد الحالي' });
  assert.equal(W.moveCheck(x, '2026-11-06', '13:00', '2026-11-06', '12:00'), null);
  assert.equal(W.canMove({ status: 'مجدول' }), true); assert.equal(W.canMove({ status: 'اتنشر' }), false);
});

test('zipPlan: a folder per piece, the images numbered with their extension, caption.txt, no clash in the names', () => {
  const plan = W.zipPlan([{ label: 'بوست 1', images: ['c/a.png'], caption: 'كابشن', tags: '#إبتكر' }, { label: 'بوست 1', images: ['c/b.jpeg', 'c/c'], caption: '' }, { label: 'a/b:c', images: [] }]);
  assert.equal(plan[0].dir, 'بوست 1'); assert.deepEqual(plan[0].files, [{ path: 'c/a.png', name: 'بوست 1/01.png' }]);
  assert.deepEqual(plan[0].caption, { name: 'بوست 1/caption.txt', data: 'كابشن\n\n#إبتكر' });
  assert.equal(plan[1].dir, 'بوست 1 (2)'); assert.deepEqual(plan[1].files.map((f) => f.name), ['بوست 1 (2)/01.jpeg', 'بوست 1 (2)/02.jpg']);
  assert.equal(plan[2].dir, 'a-b-c');
});

test('the calendar: Saturday weeks, the plan default (from last week, three weeks), the day labels', () => {
  assert.equal(W.dayIdx('2026-11-07'), 0); // Saturday
  assert.equal(W.wkStart('2026-11-06'), '2026-10-31');
  assert.deepEqual(W.weeksOf('2026-11-01', '2026-11-20'), ['2026-10-31', '2026-11-07', '2026-11-14']);
  assert.deepEqual(plain(W.planDefault('2026-11-06')), { from: '2026-10-24', to: '2026-11-13', preset: 'custom' });
  assert.equal(W.dayLabel('2026-11-06'), 'الجمعة 06/11/2026');
  assert.equal(W.relDay('2026-11-07', '2026-11-06'), 'بكرة'); assert.equal(W.relDay('2026-11-05', '2026-11-06'), 'فات ميعاده');
  assert.equal(W.suggest(0, '2026-11-06').date, '2026-11-07'); assert.equal(W.suggest(1, '2026-11-06').time, '21:00');
});

test('linkKeys: a product link of the site (as typed / decoded / trailing slash) or a SKU; anything else is null', () => {
  assert.deepEqual(plain(W.linkKeys('ibta4040bahc000009')), { sku: 'IBTA4040BAHC000009' });
  const k = W.linkKeys('https://ibtekr.club/product/%D9%85%D8%AE%D8%AF%D8%A9/?ref=x#top');
  assert.ok(k.permalinks.includes('https://ibtekr.club/product/%D9%85%D8%AE%D8%AF%D8%A9/'));
  assert.ok(k.permalinks.includes('https://ibtekr.club/product/مخدة/'));
  assert.ok(k.permalinks.includes('https://ibtekr.club/product/مخدة'));
  assert.equal(W.linkKeys('javascript:alert(1)'), null); assert.equal(W.linkKeys(''), null); assert.equal(W.linkKeys('كلام عادي'), null);
});

// ---------------------------------------------------------------- 9.5.3: the ads numbers (decisions 44–46)
const OBJ = [
  { kind: 'campaign', id: '120252323303340228', name: 'Macrame — Retargeting', status: 'ACTIVE' },
  { kind: 'campaign', id: '120251977233530228', name: 'Lamps — Broad', status: 'ACTIVE' },
  { kind: 'campaign', id: '120251297405730228', name: 'Rug — Paused', status: 'PAUSED' },
  { kind: 'ad', id: '1206', parent_id: '120252323303340228', name: 'Macrame carousel', status: 'ACTIVE', thumb: 'https://scontent.example/t.jpg' },
  { kind: 'ad', id: '1207', parent_id: '120251977233530228', name: 'Lamps video', status: 'ACTIVE', thumb: 'http://bad' },
];
const C1 = '120252323303340228', C2 = '120251977233530228', C3 = '120251297405730228';
const st = (level, id, camp, day, spend, extra = {}) => ({ level, object_id: id, campaign_id: camp, day, spend, impressions: 1000, clicks: 30, link_clicks: 20, purchases: 0, purchase_value: 0, frequency: 1.5, ...extra });
const STATS = [
  st('campaign', C1, C1, '2026-11-01', 400, { purchases: 3, purchase_value: 3600 }), st('campaign', C1, C1, '2026-11-02', 600, { purchases: 3, purchase_value: 4000 }),
  st('campaign', C2, C2, '2026-11-02', 900, { purchases: 6, purchase_value: 5000 }), st('campaign', C2, C2, '2026-11-05', 800, { purchases: 4, purchase_value: 2000 }),
  st('campaign', C3, C3, '2026-10-20', 300), // outside the period
  st('ad', '1206', C1, '2026-11-01', 400, { impressions: 2000, link_clicks: 60, frequency: 1.2, purchases: 3, purchase_value: 3600 }),
  st('ad', '1206', C1, '2026-11-02', 600, { impressions: 1000, link_clicks: 30, frequency: 2.1, purchases: 3, purchase_value: 4000 }),
  st('ad', '1207', C2, '2026-11-02', 900, { impressions: 3000, link_clicks: 30, frequency: 3, purchases: 6, purchase_value: 5000 }),
];
const ORD = [
  { day: '2026-11-01', platform: 'meta', source: 'fb', campaign: C1, grp: 'completed', orders: 3, sales: 3000, share: 450 },
  { day: '2026-11-02', platform: 'meta', source: 'ig', campaign: C1, grp: 'in_progress', orders: 2, sales: 2000, share: 300 },
  { day: '2026-11-02', platform: 'meta', source: 'fb', campaign: C1, grp: 'cancelled', orders: 1, sales: 700, share: 70 },
  { day: '2026-11-03', platform: 'meta', source: 'fb', campaign: C3, grp: 'pending', orders: 1, sales: 500, share: 50 }, // a paused campaign's late order
  { day: '2026-11-04', platform: 'google', source: 'google', campaign: 'winter', grp: 'completed', orders: 2, sales: 900, share: 90 },
  { day: '2026-10-25', platform: 'meta', source: 'fb', campaign: C1, grp: 'completed', orders: 9, sales: 9000, share: 900 }, // before the period
];
const RG = { from: '2026-11-01', to: '2026-11-05' };

test('9.5.3 adCampaignRows: Meta\'s numbers + Woo\'s orders of the same campaign id, the cancelled apart, a late order\'s campaign listed, by spend', () => {
  const rows = W.adCampaignRows(OBJ, STATS, ORD, RG);
  assert.deepEqual(rows.map((r) => [r.id, r.spend, r.orders, r.sales, r.cancelled, r.purchases]), [[C2, 1700, 0, 0, 0, 10], [C1, 1000, 5, 5000, 1, 6], [C3, 0, 1, 500, 0, 0]]);
  const m = rows.find((r) => r.id === C1);
  assert.equal(m.mer, 5); assert.equal(m.cpa, 200); assert.equal(m.roas, 7.6); assert.deepEqual(plain(m.sources), { fb: 3, ig: 2 });
  assert.deepEqual(m.days.map((d) => [d.day, d.spend, d.orders]), [['2026-11-01', 400, 3], ['2026-11-02', 600, 2]]);
  assert.equal(rows.find((r) => r.id === C2).mer, 0); assert.equal(rows.find((r) => r.id === C2).cpa, null);
  assert.equal(W.adCampaignRows([], STATS, [], RG)[0].name, '#' + C2); // a campaign not synced yet keeps its id
});

test('9.5.3 adTotals: the spend, the real return and cost, Meta says, the profit after ads (null without the share), Google\'s orders without spend', () => {
  const t = W.adTotals(STATS, ORD, RG);
  assert.deepEqual([t.spend, t.purchases, t.value, t.metaOrders, t.metaSales, t.orders, t.sales, t.cancelled], [2700, 16, 14600, 6, 5500, 8, 6400, 1]);
  assert.equal(Math.round(t.mer * 1000) / 1000, 2.037); assert.equal(t.cpa, 450); assert.equal(t.platformCpa, 168.75);
  assert.equal(t.share, 890); assert.equal(t.profit, 800 - 2700);
  assert.deepEqual(t.platforms.map((p) => [p.key, p.linked, p.spend, p.orders]), [['meta', true, 2700, 6], ['google', false, null, 2], ['tiktok', false, null, 0]]);
  assert.equal(t.metaShare, 800);
  const noMoney = W.adTotals(STATS, ORD.map((o) => ({ ...o, share: null })), RG);
  assert.equal(noMoney.share, null); assert.equal(noMoney.profit, null);
  // the caller's permission decides when given: an admin with no ad order sees the spend as the loss; no accounts.view = no profit
  assert.deepEqual([W.adTotals(STATS, [], RG, true).profit, W.adTotals(STATS, [], RG, true).metaShare], [-2700, 0]);
  assert.equal(W.adTotals(STATS, ORD, RG, false).profit, null); assert.equal(W.adTotals(STATS, ORD, RG, false).share, null);
  assert.equal(W.adTotals([], [], RG).mer, null); // nothing spent: no ratio
});

test('9.5.3 merWeeks: five 7-day weeks ending on the day, the oldest first, the real return of each', () => {
  const w = W.merWeeks(STATS, ORD, '2026-11-05', 5);
  assert.equal(w.length, 5); assert.deepEqual([w[0].from, w[4].from, w[4].to], ['2026-10-02', '2026-10-30', '2026-11-05']);
  assert.deepEqual([w[2].from, w[2].spend, w[2].sales, w[2].mer], ['2026-10-16', 300, 0, 0]); // 16–22 Oct: the paused campaign's spend, no order
  assert.deepEqual([w[3].spend, w[3].sales, w[3].mer], [0, 9000, null]); // 23–29 Oct: an old order, nothing spent → no ratio
  assert.deepEqual([w[4].spend, w[4].sales], [2700, 5500]);
  assert.equal(w[0].mer, null);
});

test('9.5.3 adAlerts: stop? (active, ≥ 1,500 in 5 days, no order), the cost over 450, check the tracking, scale? — no action, the worst first', () => {
  const a = W.adAlerts(OBJ, STATS, ORD, RG, '2026-11-05');
  assert.deepEqual(a.map((x) => x.key), ['stop:' + C2, 'track:' + C2, 'scale:' + C1]);
  assert.match(a[0].title, /وقّف «Lamps — Broad»؟/); assert.match(a[0].sub, /1,700 ج\.م/);
  assert.match(a[2].sub, /5\.00× · 5 أوردر/);
  // the rules can move: a 150 cost limit flags Macrame; a paused campaign never gets stop / scale
  const b = W.adAlerts(OBJ, STATS, ORD, RG, '2026-11-05', { maxCpa: 150 });
  assert.ok(b.some((x) => x.key === 'cpa:' + C1));
  const paused = W.adAlerts(OBJ.map((o) => ({ ...o, status: 'PAUSED' })), STATS, ORD, RG, '2026-11-05');
  assert.ok(!paused.some((x) => /^(stop|scale):/.test(x.key)));
});

test('9.5.3 adCreatives: one row per ad with spend, CTR from link clicks, frequency weighted by impressions, Meta\'s return, https pictures only', () => {
  const c = W.adCreatives(OBJ, STATS, RG);
  assert.deepEqual(c.map((x) => [x.id, x.spend, x.campaign]), [['1207', 900, 'Lamps — Broad'], ['1206', 1000, 'Macrame — Retargeting']].sort((a, b) => b[1] - a[1]));
  const m = c.find((x) => x.id === '1206');
  assert.equal(m.ctr, 90 / 3000); assert.equal(Math.round(m.frequency * 1000) / 1000, 1.5); assert.equal(m.roas, 7.6); assert.equal(m.thumb, 'https://scontent.example/t.jpg');
  assert.equal(c.find((x) => x.id === '1207').thumb, null);
  // tired: the frequency at 4 or more (1207 is seen 3 times on average; a 2.5 limit flags it, never 1206 at 1.5)
  assert.deepEqual(c.map((x) => x.tired), [false, false]);
  const t2 = W.adCreatives(OBJ, STATS, RG, { tiredFreq: 2.5 }); assert.deepEqual([t2.find((x) => x.id === '1207').tired, t2.find((x) => x.id === '1206').tired], [true, false]);
  assert.equal(W.xr(5), '5.00×'); assert.equal(W.xr(null), '—');
});
