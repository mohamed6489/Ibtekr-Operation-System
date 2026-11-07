import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  parseCampaign, parseCampaignEdit, campaignTarget, campaignRefs, campaignPrompt, pinsPrompt, campaignPathOk, campaignGenPath, parseMarketing, marketingSchema,
  marketingRequest, cleanMarketing, MKT_LIM, parseBuyer, buyerRequest, cleanBuyer, BUYER_ANSWER_MAX, BUYER_HISTORY,
} from '../../supabase/functions/_shared/marketing.js';
// The marketing campaign's AI (phase 9.5.1, decisions 8–10): the request checks, the piece read from the state the page saved, its
// references in order, the image prompt (the Arabic text written into the image), the pins' edit prompt, and the AI writing's
// requests and their cleaning — the pure part shared by ai-images and ai-content.
const C = 'f0000000-0000-4000-8000-000000000001';
const T1 = 'f1000000-0000-4000-8000-000000000001';
const state = () => ({
  w: { goal: 'منتج جديد', idea: 'كولكشن الشتا من Art craft — مخدات مشغولة يدويًا', media: {
    post: { count: 1, size: '1080x1350', notes: 'ألوان دافية', use: [{ t: 'file', name: 'logo', path: C + '/up-logo.png' }], ref: [{ t: 'tpl', name: 'قالب', tpl: T1 }] },
    carousel: { count: 1, slides: 2, notes: 'تفاصيل الخامة', use: [], ref: [{ t: 'file', name: 'مثال', path: C + '/up-ex.jpg' }] } }, extra: { count: 1, notes: '', use: [], ref: [] } },
  pieces: [
    { id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', idea: 'المخدة على كنبة لينن', title: 'دفا الشتا', sub: 'مشغولة يدويًا', badge: 'جديد', use: [{ t: 'product', name: 'Cushion', id: 4001 }, { t: 'file', path: 'other/x.png' }], ref: [], img: C + '/gen-P1-a.png' },
    { id: 'C1', kind: 'كاروسيل', n: 1, size: '1080x1350', idea: 'تفاصيل', title: 'الغلاف', use: [], ref: [], img: null, slides: [{ n: 1, idea: 'الغرزة', title: 'شريحة', use: [], ref: [] }, { n: 2, idea: 'الألوان', use: [], ref: [] }] },
    { id: 'X1', kind: 'ملف إضافي', n: 1, size: '1080x1080', idea: 'ستوري', use: [], ref: [] },
    { id: 'V1', kind: 'فيديو', n: 1 },
  ],
});

test('parseCampaign / parseCampaignEdit: the campaign id, a piece id, a slide (null | -1 | 0–9), a known model and size; an edit needs a note or a pin', () => {
  assert.deepEqual(parseCampaign({ campaign_id: C.toUpperCase(), piece: 'P1' }).req, { campaignId: C, piece: 'P1', slide: null, model: 'seedream-5-pro', size: null });
  assert.equal(parseCampaign({ campaign_id: C, piece: 'C1', slide: -1, size: '1080x1080' }).req.size.w, 1080);
  for (const [b, field] of [[{ campaign_id: 'x', piece: 'P1' }, 'campaign_id'], [{ campaign_id: C, piece: 'p1' }, 'piece'], [{ campaign_id: C, piece: 'P1', slide: 10 }, 'slide'],
    [{ campaign_id: C, piece: 'P1', model: 'dall-e' }, 'model'], [{ campaign_id: C, piece: 'P1', size: 'custom' }, 'size']]) assert.equal(parseCampaign(b).field, field);
  const e = parseCampaignEdit({ campaign_id: C, piece: 'P1', note: ' خلي الإضاءة <b>أدفى</b> ', pins: [{ x: 10.4, y: 90, text: 'الخلفية' }, { x: 5, y: 5, text: '  ' }] });
  assert.deepEqual([e.req.note, e.req.pins], ['خلي الإضاءة أدفى', [{ x: 10, y: 90, text: 'الخلفية' }]]);
  assert.equal(parseCampaignEdit({ campaign_id: C, piece: 'P1' }).field, 'note');
  assert.equal(parseCampaignEdit({ campaign_id: C, piece: 'P1', pins: [{ x: 120, y: 0, text: 'x' }] }).field, 'pins');
  assert.equal(parseCampaignEdit({ campaign_id: C, piece: 'P1', pins: Array.from({ length: 11 }, () => ({ x: 1, y: 1, text: 'x' })) }).field, 'pins');
});

test('campaignTarget: the piece, a carousel slide or its cover, the media settings; no video, no unknown piece or slide', () => {
  const s = state();
  const p = campaignTarget(s, 'P1', null); assert.equal(p.label, 'بوست 1'); assert.equal(p.media.notes, 'ألوان دافية'); assert.equal(p.size, '1080x1350');
  const cv = campaignTarget(s, 'C1', -1); assert.equal(cv.label, 'كاروسيل 1 · الغلاف'); assert.equal(cv.target, cv.piece); assert.equal(cv.slides, 2);
  const sl = campaignTarget(s, 'C1', 1); assert.equal(sl.label, 'كاروسيل 1 · صورة 2'); assert.equal(sl.target.idea, 'الألوان'); assert.equal(sl.slideIndex, 1);
  assert.equal(campaignTarget(s, 'X1', null).media, s.w.extra);
  assert.equal(campaignTarget(s, 'V1', null), null); assert.equal(campaignTarget(s, 'P9', null), null); assert.equal(campaignTarget(s, 'C1', 5), null); assert.equal(campaignTarget(s, 'P1', 0), null);
  assert.equal(campaignTarget(null, 'P1', null), null);
});

test('campaignRefs: the photos to feature first (this campaign\'s files, the site products), then the examples and the templates; other folders out; 4 at most', () => {
  const s = state();
  assert.deepEqual(campaignRefs(campaignTarget(s, 'P1', null), C), { use: [{ product: 4001 }, { path: C + '/up-logo.png' }], style: [{ tpl: T1 }] });
  assert.deepEqual(campaignRefs(campaignTarget(s, 'C1', 0), C), { use: [], style: [{ path: C + '/up-ex.jpg' }] });
  s.pieces[0].use = Array.from({ length: 6 }, (_, i) => ({ t: 'file', path: C + '/up-' + i + '.png' }));
  const r = campaignRefs(campaignTarget(s, 'P1', null), C); assert.equal(r.use.length + r.style.length, 4);
  assert.equal(campaignPathOk(C, C + '/up-a.png'), true); assert.equal(campaignPathOk(C, 'x/' + C + '/a.png'), false); assert.equal(campaignPathOk(C, C + '/../a.png'), false);
  assert.equal(campaignGenPath(C, 'C1', 1, 'st1', 'png'), C + '/gen-C1-s2-st1.png'); assert.equal(campaignGenPath(C, 'C1', -1, 'st1', 'jpg', true), C + '/edit-C1-cv-st1.jpg');
});

test('campaignPrompt: the kind, the goal, the idea and the scene, the Arabic text to write, the notes, the references and the templates', () => {
  const s = state();
  const p = campaignPrompt(campaignTarget(s, 'P1', null), { useCount: 2, styleCount: 1, templates: [{ kind: 'post', descr: 'المنتج في النص على كريمي' }] });
  for (const bit of ['A social media post image', 'launching a new product', '«كولكشن الشتا من Art craft — مخدات مشغولة يدويًا»', '«المخدة على كنبة لينن»',
    'Write this Arabic text on the image exactly as given', 'headline «دفا الشتا»', 'subheadline «مشغولة يدويًا»', 'a small badge in a corner «جديد»', '«ألوان دافية»',
    'The first 2 reference images show the products', 'The other 1 reference image is an example', '«المنتج في النص على كريمي»']) assert.ok(p.includes(bit), bit + ' — ' + p);
  const cv = campaignPrompt(campaignTarget(s, 'C1', 1), {});
  assert.ok(cv.includes('Slide 2 of a 2-slide')); assert.ok(cv.includes('No text on the image.'));
  s.pieces[0].title = '<script>x</script>'; assert.ok(!campaignPrompt(campaignTarget(s, 'P1', null), {}).includes('<'));
});

test('pinsPrompt: each pin at its place (% from the left / the top) and the general change; the rest kept', () => {
  const p = pinsPrompt('خلي الإضاءة أدفى', [{ x: 10, y: 90, text: 'الخلفية فاتحة' }, { x: 50, y: 20, text: 'كبّر العنوان' }]);
  assert.ok(p.startsWith('Edit this image as instructed and keep everything else exactly as it is'));
  assert.ok(p.includes('1) at about 10% from the left and 90% from the top: الخلفية فاتحة; 2) at about 50% from the left and 20% from the top: كبّر العنوان'));
  assert.ok(p.includes('General change: خلي الإضاءة أدفى.'));
});

test('parseMarketing: fill needs the campaign and the piece, rewrite a known kind, describe an image', () => {
  assert.deepEqual(parseMarketing({ task: 'fill', campaign_id: C, piece: 'P1' }).req, { task: 'fill', campaignId: C, piece: 'P1', slide: null, kind: null, text: '', image: null });
  assert.equal(parseMarketing({ task: 'fill', piece: 'P1' }).field, 'campaign_id');
  assert.equal(parseMarketing({ task: 'rewrite', kind: 'caption', text: 'كابشن' }).req.kind, 'caption');
  assert.equal(parseMarketing({ task: 'rewrite', kind: 'screen' }).field, 'kind');
  assert.equal(parseMarketing({ task: 'rewrite', kind: 'title', text: 'x'.repeat(3001) }).field, 'text');
  assert.equal(parseMarketing({ task: 'describe' }).field, 'image');
  assert.equal(parseMarketing({ task: 'describe', image: { media_type: 'image/png', data: 'A'.repeat(200) } }).req.image.media_type, 'image/png');
  assert.equal(parseMarketing({ task: 'nope' }).field, 'task');
});

test('marketingRequest / schema: the campaign data block, the fields of the piece (no caption for an extra, the slides for a carousel), the image for describe', () => {
  const s = state(); const t = campaignTarget(s, 'C1', null);
  const r = marketingRequest(parseMarketing({ task: 'fill', campaign_id: C, piece: 'C1' }).req, { model: 'claude-sonnet-5-5', effort: 'medium', target: t });
  const text = r.messages[0].content[0].text;
  assert.ok(text.startsWith('<campaign_data>') && text.includes('Campaign idea: كولكشن الشتا') && text.includes('Carousel slides: 2') && text.includes('slides: exactly 2 items'));
  assert.deepEqual(Object.keys(r.output_config.format.schema.properties), ['idea', 'title', 'sub', 'badge', 'caption', 'slides']);
  assert.ok(!('caption' in marketingSchema({ task: 'fill' }, campaignTarget(s, 'X1', null)).properties));
  assert.ok(r.system[0].text.includes('Egyptian Arabic'));
  const d = marketingRequest(parseMarketing({ task: 'describe', image: { media_type: 'image/png', data: 'A'.repeat(200) } }).req, { model: 'm', effort: 'low', target: null });
  assert.equal(d.messages[0].content[0].type, 'image'); assert.deepEqual(Object.keys(d.output_config.format.schema.properties), ['text']);
  const rw = marketingRequest(parseMarketing({ task: 'rewrite', kind: 'title', text: 'دفا الشتا' }).req, { model: 'm', effort: 'low', target: null });
  assert.ok(rw.messages[0].content[0].text.includes('<current_text>\nدفا الشتا\n</current_text>'));
});

test('cleanMarketing: the limits, an Arabic idea and caption, the slides by count, no caption for an extra; rewrite → text', () => {
  const s = state();
  const f = cleanMarketing({ idea: 'المخدة جنب الشباك', caption: 'كولكشن الشتا وصل ✨\nاطلبه دلوقتي', title: 'دفا الشتا بإيد مصرية جدًا جدًا جدًا جدًا جدًا', sub: 'x', badge: 'جديد', slides: [{ idea: 'الغرزة', title: 'تفاصيل' }] },
    { task: 'fill' }, campaignTarget(s, 'C1', null)).fields;
  assert.equal(f.caption, 'كولكشن الشتا وصل ✨\nاطلبه دلوقتي'); assert.ok(f.title.length <= MKT_LIM.title);
  assert.deepEqual(f.slides, [{ idea: 'الغرزة', title: 'تفاصيل' }, {}]);
  assert.equal(cleanMarketing({ idea: 'English only idea', caption: 'Hi' }, { task: 'fill' }, campaignTarget(s, 'P1', null)).fields.idea, undefined);
  assert.ok(!('caption' in cleanMarketing({ caption: 'كابشن' }, { task: 'fill' }, campaignTarget(s, 'X1', null)).fields));
  assert.deepEqual(cleanMarketing({ text: '  خصم <b>20%</b>  ' }, { task: 'rewrite', kind: 'badge' }), { text: 'خصم 20%' });
});

// ---------------------------------------------------------------- the media buyer's chat (phase 9.5.4, decision 53)

test('parseBuyer: the question is required (≤ 1000), the history user / assistant only and the last 6 turns; buyerRequest: the data block from the server, the numbers derived; cleanBuyer: the limit', () => {
  assert.equal(parseBuyer({}).field, 'question');
  assert.equal(parseBuyer({ question: 'x', history: 'y' }).field, 'history');
  assert.equal(parseBuyer({ question: 'x', history: [{ role: 'tool', text: 'y' }] }).field, 'history');
  const long = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i }));
  const r = parseBuyer({ question: ' أزوّد؟ ', history: long }).req;
  assert.equal(r.question, 'أزوّد؟');
  assert.equal(r.history.length, BUYER_HISTORY);
  assert.equal(r.history[0].text, 't4');
  const q = buyerRequest(r, { model: 'm', effort: 'low', data: { today: '2026-10-25', rules: { dailyCap: 5000, maxCpa: 450, autoStop: 1500, autoStopMode: 'suggest', live: true },
    campaigns: [{ name: 'Macrame', status: 'ACTIVE', spend: 500, purchases: 4, orders: 2, sales: 1000, daily_budget: 300 }, { name: 'Zero', status: 'ACTIVE', spend: 0, purchases: 0, orders: 0, sales: 0 }],
    suggestions: [{ kind: 'stop', title: 'وقّف «Lamps»', sub: 'صرفت 2,000' }] } });
  const last = q.messages.at(-1).content[0].text;
  assert.ok(last.includes('Macrame | ACTIVE | spend 500 | meta purchases 4 | woo orders 2 | woo sales 1000 | MER 2.00 | cost/order 250 | daily budget 300'));
  assert.ok(last.includes('Zero | ACTIVE | spend 0 | meta purchases 0 | woo orders 0 | woo sales 0 | MER — | cost/order —'));
  assert.ok(last.includes('execution switch on') && last.includes('stop: وقّف «Lamps» — صرفت 2,000') && last.endsWith('أزوّد؟'));
  assert.deepEqual(q.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(q.output_config.format.schema.required[0], 'text');
  // a history ending with the user's turn: the question joins it; none: one user turn
  assert.equal(buyerRequest({ question: 'q', history: [{ role: 'user', text: 'a' }] }, { model: 'm', effort: 'low', data: {} }).messages.length, 1);
  assert.ok(buyerRequest({ question: 'q', history: [] }, { model: 'm', effort: 'low', data: {} }).messages[0].content[0].text.includes('(no campaign numbers yet'));
  assert.equal(cleanBuyer({ text: 'x'.repeat(5000) }).text.length, BUYER_ANSWER_MAX);
  assert.equal(cleanBuyer(null).text, '');
});
