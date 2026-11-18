import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  parseCampaign, parseCampaignEdit, campaignTarget, campaignRefs, campaignPrompt, pinsPrompt, campaignPathOk, campaignGenPath, parseMarketing, marketingSchema,
  marketingRequest, cleanMarketing, templateNotes, MKT_LIM, parseBuyer, buyerRequest, cleanBuyer, BUYER_ANSWER_MAX, BUYER_HISTORY,
  parseAgent, agentTitle, agentHistory, agentRequest, cleanAgent, parseAgentImage, agentImagePath, agentImagePathOk, AGENT_ANSWER_MAX, AGENT_HISTORY,
} from '../../supabase/functions/_shared/marketing.js';
import { scenesRequest } from '../../supabase/functions/_shared/mkt-video.js';
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
  assert.deepEqual(parseMarketing({ task: 'fill', campaign_id: C, piece: 'P1' }).req, { task: 'fill', campaignId: C, piece: 'P1', slide: null, kind: null, text: '', image: null, notes: '' });
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
  // the admin's written rules (the v6 prototype's «+ قاعدة جديدة»): in the data block as guidance; none = «(none)»
  const wr = buyerRequest({ question: 'q', history: [] }, { model: 'm', effort: 'low', data: { rules: { notes: [{ title: 'CTR قليل', details: 'إعلان CTR أقل من 0.8% ← بلّغني', kind: 'قاعدة' }] } } }).messages[0].content[0].text;
  assert.ok(wr.includes("The owner's written rules (guidance for your advice only — nothing runs from them):\n- [قاعدة] CTR قليل: إعلان CTR أقل من 0.8% ← بلّغني"));
  assert.ok(buyerRequest({ question: 'q', history: [] }, { model: 'm', effort: 'low', data: {} }).messages[0].content[0].text.includes('nothing runs from them):\n(none)'));
  assert.equal(cleanBuyer({ text: 'x'.repeat(5000) }).text.length, BUYER_ANSWER_MAX);
  assert.equal(cleanBuyer(null).text, '');
});

// ---------------------------------------------------------------- 9.5.5: a video piece's scenes are images of the campaign (decision 59)
test('campaignTarget / campaignPrompt for a video scene: slide = the scene, the key-frame prompt without text; the piece itself is no image; parseMarketing scenes', () => {
  const state = { w: { goal: 'منتج جديد', idea: 'الشتا', media: { video: { notes: 'بطيء', use: [], ref: [] } } }, pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', idea: 'المخدة', scenes: [{ n: 1, d: 5, idea: 'لقطة قريبة', text: 'دفا' }, { n: 2, d: 5, idea: 'القعدة' }] }] };
  const t = campaignTarget(state, 'V1', 1);
  assert.equal(t.label, 'فيديو 1 · المشهد 2'); assert.equal(t.slides, 2); assert.equal(t.media.notes, 'بطيء'); assert.equal(t.target.idea, 'القعدة');
  assert.equal(campaignTarget(state, 'V1', null), null); assert.equal(campaignTarget(state, 'V1', 2), null);
  const pr = campaignPrompt(t, {});
  assert.ok(pr.includes('key frame) of scene 2 of a 2-scene short vertical product video') && pr.includes('This scene (in Arabic): «القعدة»') && pr.includes('The video (in Arabic): «المخدة»') && pr.includes('No text on the image') && !pr.includes('دفا'));
  assert.equal(parseMarketing({ task: 'scenes', campaign_id: 'f0000000-0000-4000-8000-000000000001', piece: 'P1' }).field, 'piece');
  assert.deepEqual(parseMarketing({ task: 'scenes', campaign_id: 'f0000000-0000-4000-8000-000000000001', piece: 'V2', voice: true }).req, { task: 'scenes', campaignId: 'f0000000-0000-4000-8000-000000000001', piece: 'V2', slide: null, kind: null, text: '', image: null, voice: true, notes: '' });
});

// 15 Nov: the video piece's own texts — «فكرة الفيديو» / «الكابشن المقترح» (rewrite) and «املأ بالـ AI» (fill) were answered 400 «piece»:
// campaignTarget gave null for a video piece with no scene. The writing asks with { text: true }; the images never do.
const videoState = () => ({ w: { goal: 'منتج جديد', idea: 'كولكشن الشتا', media: { video: { notes: 'بطيء', tpl: ['v1'], use: [], ref: [] }, post: { notes: 'ألوان دافية' } } },
  pieces: [{ id: 'V1', kind: 'فيديو', n: 1, size: '9:16', dur: 10, sceneCount: 3, idea: 'المخدة', caption: 'ريل الشتا', title: '', sub: '', badge: '', scenes: [{ n: 1, d: 5, idea: 'لقطة قريبة', text: 'دفا' }, { n: 2, d: 5, idea: 'القعدة' }] },
    { id: 'P1', kind: 'بوست', n: 1, size: '1080x1350', idea: 'المخدة على كنبة' }] });

test('campaignTarget for a video piece: null for the image use (no scene, a cover, any opts but text) — { text: true } is the piece itself with media.video; a scene and the other pieces read the same either way', () => {
  const s = videoState();
  // the image use (ai-images campaign / campaign_edit): a video piece has no image of its own
  for (const opts of [undefined, null, {}, { text: false }, { text: 1 }]) { assert.equal(campaignTarget(s, 'V1', null, opts), null); assert.equal(campaignTarget(s, 'V1', -1, opts), null); }
  // the writing (ai-content marketing fill / rewrite)
  const t = campaignTarget(s, 'V1', null, { text: true });
  assert.equal(t.target, t.piece); assert.equal(t.piece, s.pieces[0]); assert.equal(t.media, s.w.media.video);
  assert.deepEqual([t.kind, t.label, t.size, t.slides, t.slideIndex], ['فيديو', 'فيديو 1', '9:16', 2, null]);
  assert.equal(campaignTarget(s, 'V1', -1, { text: true }), null); // a video has no cover
  assert.equal(campaignTarget(s, 'V1', 2, { text: true }), null); assert.equal(campaignTarget(s, 'V9', null, { text: true }), null);
  assert.deepEqual(campaignTarget(s, 'V1', 1, { text: true }), campaignTarget(s, 'V1', 1)); // a scene: the same target
  assert.deepEqual(campaignTarget(s, 'P1', null, { text: true }), campaignTarget(s, 'P1', null));
  assert.equal(campaignTarget({ pieces: [{ id: 'V1', kind: 'فيديو', n: 1 }] }, 'V1', null, { text: true }).media.notes, undefined); // no media saved: an empty one
});

test('marketingRequest / cleanMarketing for a video piece: rewrite its idea or its caption as a reel\'s (the length, the scenes, the video\'s instructions as data); fill = idea and caption only; a scene keeps the image wording', () => {
  const s = videoState(); const t = campaignTarget(s, 'V1', null, { text: true });
  // rewrite «فكرة الفيديو» — what the page sends: { piece, slide: null, kind: 'idea', text }
  const rw = parseMarketing({ task: 'rewrite', kind: 'idea', campaign_id: C, piece: 'V1', slide: null, text: 'المخدة' }).req;
  assert.deepEqual([rw.task, rw.piece, rw.slide, rw.kind], ['rewrite', 'V1', null, 'idea']);
  const r = marketingRequest(rw, { model: 'm', effort: 'low', target: t, tplNotes: 'حركة هادية' });
  const text = r.messages[0].content[0].text;
  for (const part of ['Piece: فيديو 1', 'Size: 9:16', 'Video length: 10 seconds', 'Video scenes: 3', 'Current video idea: المخدة', 'Current caption: ريل الشتا', 'Instructions for this media: بطيء',
    'Instruction templates of the team: حركة هادية', "Write the idea of the campaign's short vertical product video (a reel)", 'in at most 400 characters', '<current_text>\nالمخدة\n</current_text>']) assert.ok(text.includes(part), part);
  assert.ok(!text.includes('Current image idea') && !text.includes('one image of the campaign') && !text.includes('Current headline'));
  assert.deepEqual(Object.keys(r.output_config.format.schema.properties), ['text']);
  assert.deepEqual(cleanMarketing({ text: '  ريل <b>دافي</b> للمخدة  ' }, rw, t), { text: 'ريل دافي للمخدة' });
  // rewrite «الكابشن المقترح»: the reel's caption, its lines kept
  const cap = parseMarketing({ task: 'rewrite', kind: 'caption', campaign_id: C, piece: 'V1', text: 'ريل الشتا' }).req;
  assert.ok(marketingRequest(cap, { model: 'm', effort: 'low', target: t }).messages[0].content[0].text.includes("Write the reel's caption for Instagram / Facebook"));
  assert.equal(cleanMarketing({ text: 'الدفا وصل 🧶\nاطلبه من إبتكر' }, cap, t).text, 'الدفا وصل 🧶\nاطلبه من إبتكر');
  // «املأ بالـ AI»: the two fields the page shows and saves for a video piece — no headline, subheadline, badge or slides
  const fl = parseMarketing({ task: 'fill', campaign_id: C, piece: 'V1' }).req;
  const schema = marketingSchema(fl, t);
  assert.deepEqual([Object.keys(schema.properties), schema.required, schema.additionalProperties], [['idea', 'caption'], ['idea', 'caption'], false]);
  const f = marketingRequest(fl, { model: 'm', effort: 'low', target: t });
  const ask = f.messages[0].content[0].text;
  assert.ok(ask.includes('Fill these fields of this video piece: idea, caption (idea ≤ 400, caption ≤ 1000 characters)') && ask.includes('Keep any current text that is already good.'));
  assert.ok(!ask.includes('title ≤ 40') && !ask.includes('slides'));
  assert.deepEqual(f.output_config.format.schema, schema);
  assert.deepEqual(cleanMarketing({ idea: 'ريل للمخدة في قعدة دافية', caption: 'كولكشن الشتا وصل ✨\nاطلبه دلوقتي', title: 'دفا الشتا', sub: 'مشغولة يدويًا', badge: 'جديد', slides: [{ idea: 'الغرزة' }] }, fl, t).fields,
    { idea: 'ريل للمخدة في قعدة دافية', caption: 'كولكشن الشتا وصل ✨\nاطلبه دلوقتي' });
  assert.deepEqual(cleanMarketing({ idea: 'English only', caption: 'ي'.repeat(1500) }, fl, t).fields, { caption: 'ي'.repeat(MKT_LIM.caption) });
  // a scene of the video is an image of the campaign (its key frame): the wording and the fields of an image, as before
  const sc = campaignTarget(s, 'V1', 1, { text: true });
  const st = marketingRequest(parseMarketing({ task: 'rewrite', kind: 'idea', campaign_id: C, piece: 'V1', slide: 1, text: 'القعدة' }).req, { model: 'm', effort: 'low', target: sc }).messages[0].content[0].text;
  assert.ok(st.includes('Piece: فيديو 1 · المشهد 2') && st.includes('Current image idea: القعدة') && st.includes('the idea of one image of the campaign') && !st.includes('Video length'));
  // a post is untouched by the mode
  assert.deepEqual(Object.keys(marketingSchema(fl, campaignTarget(s, 'P1', null, { text: true })).properties), ['idea', 'title', 'sub', 'badge', 'caption']);
});

// ---------------------------------------------------------------- 0084: the assistants' chats (decisions 5 and 6)
test('parseAgent: the assistant, an optional chat uuid, the question (≤ 1000); agentTitle: the first question on one line, cut at a word', () => {
  const U = 'c0000000-0000-4000-8000-0000000000aa';
  assert.deepEqual(parseAgent({ agent: 'designer', question: '  بوست\r\nللشتا ' }), { req: { agent: 'designer', chatId: null, question: 'بوست\nللشتا', files: [] } });
  assert.deepEqual(parseAgent({ agent: 'dev', chat_id: U.toUpperCase(), question: 'x' }).req.chatId, U);
  assert.deepEqual(parseAgent({ agent: 'SEO!', question: 'x' }), { error: 'bad_request', field: 'agent' });
  assert.equal(parseAgent({ agent: 'stock', question: 'x' }).req.agent, 'stock', '0120: any assistant id — the server checks the registry');
  assert.deepEqual(parseAgent({ agent: 'buyer', chat_id: 'x', question: 'x' }), { error: 'bad_request', field: 'chat_id' });
  assert.deepEqual(parseAgent({ agent: 'buyer', question: '   ' }), { error: 'bad_request', field: 'question' });
  assert.equal(parseAgent({ agent: 'buyer', question: 'ا'.repeat(1500) }).req.question.length, 1000);
  assert.equal(agentTitle('  بوست   الشتا \n تاني '), 'بوست الشتا تاني');
  const long = agentTitle('ممكن تعملي فكرة بوست جديد لعروض الشتا على منتجات الماكرامية والكروشيه بألوان دافية');
  assert.ok(long.length <= 61 && long.endsWith('…') && !long.includes('دافية'));
  assert.equal(agentTitle(''), 'شات جديد');
});
test('agentHistory: the table\'s turns → alternating, the member first, the last 12, an image turn named; agentRequest: the base + the admin\'s instructions, the buyer\'s numbers only for the buyer, the designer\'s image prompt in the schema', () => {
  const rows = [{ role: 'assistant', text: 'intro' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: '', images: ['agents/x.png'] }, { role: 'system', text: 'x' }];
  assert.deepEqual(agentHistory(rows), [{ role: 'user', text: 'a\n\nb' }, { role: 'assistant', text: '(an image was generated here)' }]);
  assert.equal(agentHistory(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i }))).length, AGENT_HISTORY);
  const d = agentRequest({ agent: 'designer', question: 'صورة بوست' }, { model: 'm', effort: 'low', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }], cfg: { instructions: 'الألوان بيج' } });
  assert.equal(d.system.length, 5); assert.match(d.system[0].text, /designer assistant/); assert.match(d.system[1].text, /الألوان بيج/); assert.match(d.system[2].text, /open_form|expense_add/); // agents-brain T3
  assert.deepEqual(d.messages.map((m) => [m.role, m.content[0].text]), [['user', 'a'], ['assistant', 'b'], ['user', 'صورة بوست']]);
  assert.deepEqual(d.output_config.format.schema.required, ['text', 'image_prompt', 'request', 'campaign', 'forms', 'page', 'ask', 'need']); // ش45 decision 4 · agents-brain T3
  assert.match(d.system[0].text, /«تقديم طلب»[\s\S]*fill request/); // owner batch 14 Nov decision 14
  const b = agentRequest({ agent: 'buyer', question: 'أحسن حملة؟' }, { model: 'm', effort: 'low', history: [{ role: 'user', text: 'سؤال من غير رد' }], cfg: {}, data: { today: '2026-11-12', rules: {}, campaigns: [{ name: 'Macrame', spend: 100, orders: 2, sales: 500 }] } });
  assert.equal(b.system.length, 4); // + the ask rule (18 Nov) assert.equal(b.messages.length, 1); // a turn left without an answer is not repeated
  assert.match(b.messages[0].content[0].text, /<ads_data>[\s\S]*Macrame[\s\S]*<\/ads_data>\n\nأحسن حملة؟$/);
  assert.deepEqual(b.output_config.format.schema.required, ['text', 'request', 'campaign', 'campaign_action', 'decisions', 'forms', 'page', 'ask', 'need']); // ش45 decision 5 · agents-brain T3 · T5 (the five videos' campaign)
  assert.deepEqual(b.output_config.format.schema.properties.request.required, ['title', 'details']);
  const v = agentRequest({ agent: 'dev', question: 'صفحة هبوط' }, { model: 'm', effort: 'low', history: [], cfg: null, data: { campaigns: [{ name: 'X' }] } });
  assert.match(v.system[0].text, /staging site first/); assert.doesNotMatch(v.messages[0].content[0].text, /ads_data/);
});
test('cleanAgent: the text limit; the image prompt for the designer only, without markup; parseAgentImage and the member\'s folder', () => {
  assert.equal(cleanAgent({ text: 'x'.repeat(5000) }, 'buyer').text.length, AGENT_ANSWER_MAX);
  assert.deepEqual(cleanAgent({ text: 'تمام', image_prompt: 'a <b>cozy</b> flat lay' }, 'designer'), { text: 'تمام', handoff: null, imagePrompt: 'a cozy flat lay', campaign: null, forms: [], page: null, request: null, ask: null, need: null });
  assert.deepEqual(cleanAgent({ text: 'تمام', image_prompt: 'x' }, 'dev'), { text: 'تمام', handoff: null, forms: [], page: null, request: null, ask: null, need: null });
  // agents-brain T3: the popups pass the header assistant's rules (an unknown form or key dropped, at most 3), the page one of the pages
  const fa = cleanAgent({ text: 'x', forms: [{ form: 'expense_add', values: [{ key: 'direction', value: 'withdraw' }, { key: 'amount', value: '1,500' }, { key: 'evil', value: 'y' }] }, { form: 'drop_db', values: [] }], page: { page: 'nowhere', tab: '' } }, 'accountant');
  assert.deepEqual(fa.forms, [{ form: 'expense_add', values: { direction: 'withdraw', amount: '1500' } }]); assert.equal(fa.page, null);
  assert.equal(cleanAgent({ text: 'x', forms: Array.from({ length: 6 }, () => ({ form: 'task_add', values: [{ key: 'title', value: 't' }] })) }, 'hr').forms.length, 3);
  // owner batch 14 Nov decision 14: a ready request — one line of 80 for the title, the details within 1500; no title = none
  const rq = cleanAgent({ text: 'قدّمه', request: { title: 'صفحة هبوط\nلعروض الشتا ' + 'x'.repeat(100), details: 'd'.repeat(2000) } }, 'dev').request;
  assert.equal(rq.title.length, 80); assert.doesNotMatch(rq.title, /\n/); assert.equal(rq.details.length, 1500);
  assert.equal(cleanAgent({ text: 'x', request: { title: '  ', details: 'y' } }, 'buyer').request, null);
  assert.equal(cleanAgent({ text: 'x', request: 'not an object' }, 'designer').request, null);
  const U = 'c0000000-0000-4000-8000-0000000000aa'; const M = '00000000-0000-4000-8000-000000000001';
  const r = parseAgentImage({ chat_id: U, prompt: ' a  winter post ' }); assert.equal(r.req.prompt, 'a winter post'); assert.equal(r.req.size.id, '1080x1350');
  assert.deepEqual(parseAgentImage({ chat_id: U, prompt: '' }), { error: 'bad_request', field: 'prompt' });
  assert.deepEqual(parseAgentImage({ chat_id: 'x', prompt: 'p' }), { error: 'bad_request', field: 'chat_id' });
  assert.deepEqual(parseAgentImage({ chat_id: U, prompt: 'p', size: '7x7' }), { error: 'bad_request', field: 'size' });
  const path = agentImagePath(M, U, '2611120101abcd', 'png');
  assert.equal(path, 'agents/' + M + '/' + U + '/2611120101abcd.png');
  assert.ok(agentImagePathOk(M, path)); assert.ok(!agentImagePathOk('00000000-0000-4000-8000-000000000002', path)); assert.ok(!agentImagePathOk(M, 'agents/' + M + '/../x.png'));
});

test('templateNotes (owner batch 2 decision 14): the picked templates\' text from the admin\'s settings, in the image and the text prompts', () => {
  const rules = { sections: { img: [{ id: 'post', prompt: 'البوست' }, { id: 'c1', prompt: 'ألوان الشتا الدافية' }, { id: 'c2', prompt: 'من غير <ناس>' }], vid: [{ id: 'post', prompt: 'ريلز قصير بـ hook' }, { id: 'v1', prompt: 'حركة كاميرا ناعمة' }] } };
  assert.equal(templateNotes(rules, { tpl: ['c2', 'c1', 'c1', 'post', 'zz', 5] }), 'من غير · ألوان الشتا الدافية'); // a tag is dropped, the duplicate and «البوست» too
  assert.equal(templateNotes(rules, { tpl: ['v1'] }, true), 'حركة كاميرا ناعمة');
  // the owner 15 Nov: the videos' «البوست» is picked like the others (nothing applies it to a video by itself); the images' one stays automatic
  assert.equal(templateNotes(rules, { tpl: ['post', 'v1'] }, true), 'ريلز قصير بـ hook · حركة كاميرا ناعمة');
  assert.equal(templateNotes(rules, { tpl: ['none'] }, true), ''); // «غير محدد» is never stored, and an unknown id reads as nothing
  assert.equal(templateNotes(rules, { tpl: ['v1'] }), ''); // a video template is not an image one
  assert.equal(templateNotes(null, { tpl: ['c1'] }), '');
  assert.equal(templateNotes(rules, {}), '');
  assert.ok(templateNotes({ sections: { img: Array.from({ length: 4 }, (_, i) => ({ id: 'x' + i, prompt: 'ي'.repeat(600) })) } }, { tpl: ['x0', 'x1', 'x2', 'x3'] }).length <= 1200);
  const t = campaignTarget(state(), 'P1', null);
  assert.ok(campaignPrompt(t, { tplNotes: 'ألوان الشتا الدافية' }).includes("The team's instruction templates (in Arabic): «ألوان الشتا الدافية»."));
  assert.ok(!campaignPrompt(t, {}).includes('instruction templates'));
  const r = marketingRequest({ task: 'fill', campaignId: C, piece: 'P1', slide: null }, { model: 'm', effort: 'low', target: t, tplNotes: 'ألوان الشتا الدافية' });
  assert.ok(JSON.stringify(r).includes('Instruction templates of the team: ألوان الشتا الدافية'));
});

// the owner 15 Nov: the member's instructions from the popup reach every marketing AI task (fill, rewrite, describe, scenes) — cleaned,
// last in the request inside <member_notes>; a non-string is refused
test('parseMarketing / marketingRequest / scenesRequest: the member notes', () => {
  const C = 'f0000000-0000-4000-8000-000000000001';
  assert.equal(parseMarketing({ task: 'rewrite', kind: 'caption', text: 'x', notes: 'أقصر <b>' }).req.notes, 'أقصر b');
  assert.equal(parseMarketing({ task: 'fill', campaign_id: C, piece: 'P1', notes: 7 }).field, 'notes');
  const req = parseMarketing({ task: 'rewrite', kind: 'caption', text: 'كابشن قديم', notes: 'خلّيه أقصر وبإيموجي واحد' }).req;
  const t = marketingRequest(req, { model: 'm', effort: 'low' }).messages[0].content[0].text;
  assert.match(t, /<member_notes>\nخلّيه أقصر وبإيموجي واحد\n<\/member_notes>/); assert.ok(t.indexOf('<member_notes>') > t.indexOf('<current_text>'));
  assert.doesNotMatch(marketingRequest(parseMarketing({ task: 'rewrite', kind: 'caption', text: 'x' }).req, { model: 'm', effort: 'low' }).messages[0].content[0].text, /member_notes/);
  const sc = scenesRequest({ model: 'm', effort: 'low', w: { goal: 'مبيعات' }, piece: { idea: 'فكرة' }, n: 3, dur: 15, memberNotes: 'مشاهد أهدى' }).messages[0].content[0].text;
  assert.match(sc, /<member_notes>\nمشاهد أهدى\n<\/member_notes>/);
});

// comments decision 52 (the owner 15 Nov — the campaign's pieces on Magnific): which images a campaign needs, and a generator's ratio
test('decision 52 — campaignTargets / flowKey / aspectOf: a post and an extra file are one image, a carousel its cover then its slides, a video the key frame of each scene it has; 30 at most; a size snaps to the nearest ratio a generator takes', async () => {
  const { campaignTargets, flowKey, aspectOf, MAX_FLOW_TARGETS } = await import('../../supabase/functions/_shared/marketing.js');
  const state = { pieces: [{ id: 'P1', kind: 'بوست' }, { id: 'C1', kind: 'كاروسيل', slides: [{ n: 1 }, null, { n: 3 }] }, { id: 'V1', kind: 'فيديو', scenes: [{ n: 1 }, { n: 2 }] }, { id: 'V2', kind: 'فيديو' },
    { id: 'X1', kind: 'ملف إضافي' }, { id: 'bad id', kind: 'بوست' }, { id: 'Z1', kind: 'حاجة تانية' }, null] };
  assert.deepEqual(campaignTargets(state), [{ piece: 'P1', slide: null }, { piece: 'C1', slide: -1 }, { piece: 'C1', slide: 0 }, { piece: 'C1', slide: 2 }, { piece: 'V1', slide: 0 }, { piece: 'V1', slide: 1 }, { piece: 'X1', slide: null }]);
  assert.deepEqual(campaignTargets(state).map((t) => flowKey(t.piece, t.slide)), ['P1', 'C1:-1', 'C1:0', 'C1:2', 'V1:0', 'V1:1', 'X1']);
  // every one of them is a piece the image prompt can be built for
  const full = { w: { media: {} }, pieces: state.pieces.filter(Boolean).map((p) => ({ n: 1, ...p, slides: p.slides ? p.slides.map((x) => x || { n: 2 }) : undefined })) };
  for (const t of campaignTargets(full)) assert.ok(campaignTarget(full, t.piece, t.slide), flowKey(t.piece, t.slide));
  assert.deepEqual(campaignTargets(null), []); assert.deepEqual(campaignTargets({ pieces: 'x' }), []);
  const many = { pieces: Array.from({ length: 40 }, (_, i) => ({ id: 'P' + (i + 1), kind: 'بوست' })) };
  assert.equal(campaignTargets(many).length, MAX_FLOW_TARGETS);
  assert.deepEqual(['1080x1350', '1080x1080', '1080x1920', '1600x900', 'nope', null].map((x) => aspectOf(x)), ['4:5', '1:1', '9:16', '16:9', '4:5', '4:5']);
  assert.deepEqual([aspectOf({ w: 1200, h: 628 }), aspectOf({ w: 1000, h: 1500 }), aspectOf({ w: 0, h: 10 })], ['16:9', '2:3', '4:5']);
});

test('decision 52 — placeImage: an image on a post, a carousel\'s cover or slide, a video scene — reviewed again, the video\'s cut stale; no such place → null; the state it was given is not touched', async () => {
  const { placeImage } = await import('../../supabase/functions/_shared/marketing.js');
  const state = { w: { idea: 'x' }, pieces: [{ id: 'P1', kind: 'بوست', img: 'c/old.png', gen: 1, approved: true }, { id: 'C1', kind: 'كاروسيل', approved: true, slides: [{ n: 1, approved: true }, { n: 2 }] },
    { id: 'V1', kind: 'فيديو', assembled: true, video: 'c/v.mp4', approved: true, scenes: [{ n: 1 }] }] };
  const keep = JSON.stringify(state);
  const a = placeImage(state, 'P1', null, 'c/new.png');
  assert.deepEqual(a.pieces[0], { id: 'P1', kind: 'بوست', img: 'c/new.png', gen: 2, approved: false, v: 2 });
  assert.equal(a.w, state.w); assert.equal(a.pieces[1], state.pieces[1], 'the other pieces as they were');
  const b = placeImage(state, 'C1', -1, 'c/cv.png');
  assert.deepEqual([b.pieces[1].img, b.pieces[1].gen, b.pieces[1].approved, b.pieces[1].slides[0].approved], ['c/cv.png', 1, false, true]);
  const c = placeImage(state, 'C1', 1, 'c/s2.png');
  assert.deepEqual([c.pieces[1].slides[1], c.pieces[1].approved, c.pieces[1].img], [{ n: 2, img: 'c/s2.png', gen: 1, approved: false }, false, undefined]);
  const d = placeImage(state, 'V1', 0, 'c/k.png');
  assert.deepEqual([d.pieces[2].scenes[0].img, d.pieces[2].assembled, d.pieces[2].video, d.pieces[2].approved], ['c/k.png', false, null, false]);
  for (const bad of [['V1', null], ['V1', 3], ['C1', 5], ['P1', 0], ['Z9', null]]) assert.equal(placeImage(state, bad[0], bad[1], 'c/x.png'), null, JSON.stringify(bad));
  assert.equal(placeImage(state, 'P1', null, ''), null); assert.equal(placeImage(null, 'P1', null, 'c/x.png'), null);
  assert.equal(JSON.stringify(state), keep);
});
