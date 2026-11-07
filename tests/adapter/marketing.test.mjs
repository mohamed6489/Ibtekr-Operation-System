import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// marketing.js (phase 9.5.1, 0049) against a stub IBSupabase: the campaigns / posts / templates / wallet in the page's shapes, the
// campaign's saves one after the other (saveSoon + flush before an AI call), the files (the campaign's folder or templates/), a
// pasted product link, the AI calls (ai-images campaign / campaign_edit, ai-content marketing) and their Arabic refusals, the
// schedule and the log's actions through the RPCs, the templates, and activity_log mkt.* with no idea / caption / note text.
const src = readFileSync(new URL('../../app/js/adapter/marketing.js', import.meta.url), 'utf8');
const dom = readFileSync(new URL('../../app/js/pages/marketing-domain.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const ok = (data) => ({ data, error: null });
const C1 = 'c0000000-0000-4000-8000-000000000001'; const C2 = 'c0000000-0000-4000-8000-000000000002';
const CAMPS = [
  { id: C1, name: 'كولكشن الشتا', goal: 'منتج جديد', step: 2, scheduled_at: null, created_by: 'u1', created_at: '2026-11-05T08:00:00Z', updated_at: '2026-11-06T08:00:00Z', archived_at: null },
  { id: C2, name: 'قديمة', goal: null, step: 4, scheduled_at: '2026-11-01T08:00:00Z', created_by: 'u1', created_at: '2026-10-30T08:00:00Z', updated_at: '2026-11-01T08:00:00Z', archived_at: '2026-11-02T08:00:00Z' },
];
const POSTS = [
  { id: 7, campaign_id: C2, piece: 'P1', kind: 'بوست', name: 'دفا الشتا', caption: 'كابشن سري', caption_orig: 'كابشن سري', tags: '#إبتكر', images: [C2 + '/gen-P1.png'], platform: 'فيسبوك', day: '2026-11-08',
    time: '19:00', how: 'download', status: 'مجدول', was_live: false, post_url: null, published_at: null, published_by: null, deleted_at: null, created_at: '2026-11-01T08:00:00Z', updated_at: '2026-11-01T08:00:00Z' },
];
const TPLS = [{ id: 't1', name: 'منتج على كريمي', kind: 'post', image: 'templates/a.png', descr: 'المنتج في النص', used: 3, created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T08:00:00Z', deleted_at: null }];
function load({ responses = {}, perms = { 'marketing.view': 'F', 'marketing.create': 'F', 'marketing.publish': 'F' }, realtime = false, role = 'ops' } = {}) {
  const stub = stubClient({ responses: { mkt_campaigns: ok(CAMPS), mkt_posts: ok(POSTS), mkt_templates: ok(TPLS), 'rpc:mkt_credits': ok({ cap: 5000, used: 1200 }), ...responses } });
  const events = []; const logs = []; const timers = [];
  const window = { IBSupabase: { client: stub.client }, IB_CONFIG: { realtime },
    IBDirectory: { perm: (k) => perms[k] || 'N', me: () => ({ id: 'u1', name: 'منى', role_id: role, status: 'active' }) },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    crypto: { randomUUID: () => 'abcdef12-3456-4000-8000-000000000000' } };
  const ctx = { window, document: { dispatchEvent(e) { events.push(e.type); }, visibilityState: 'visible' }, CustomEvent: class { constructor(t) { this.type = t; } },
    Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, Error, Intl, isNaN, URL,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].fn = null; }, setInterval: () => 1, clearInterval: () => {} };
  ctx.globalThis = ctx;
  runInNewContext(dom, ctx); window.IbtekrCampWiz = ctx.IbtekrCampWiz || window.IbtekrCampWiz;
  runInNewContext(src, ctx);
  const run = async () => { const L = timers.splice(0); for (const t of L) if (t.fn) await t.fn(); };
  return { M: window.IBMarketing, stub, events, logs, timers, run };
}
const rpcs = (stub) => stub.calls.filter((c) => c.op === 'rpc').map((c) => c.args);
const invokes = (stub) => stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args);

test('load: the campaigns (archived out of the list), the posts with their campaign name, the templates and the wallet', async () => {
  const { M, events } = load();
  eq((await M.load()).ok, true);
  eq(M.campaigns().map((x) => [x.id, x.name, x.step]), [[C1, 'كولكشن الشتا', 2]]);
  const p = M.posts()[0];
  eq([p.id, p.pl, p.camp, p.status, p.img, p.capOrig, p.src], [7, 'فيسبوك', 'قديمة', 'مجدول', C2 + '/gen-P1.png', 'كابشن سري', 'system']);
  eq(M.templates().map((t) => [t.id, t.img, t.desc, t.used]), [['t1', 'templates/a.png', 'المنتج في النص', 3]]);
  eq(M.wallet(), { cap: 5000, used: 1200, balance: 3800 });
  assert.ok(events.includes('ib:marketing'));
});

test('load: a member with marketing.view N reads nothing; no cap = a null balance', async () => {
  const none = load({ perms: {} }); await none.M.load();
  eq([none.M.campaigns().length, none.M.posts().length, none.M.wallet()], [0, 0, null]);
  eq(none.stub.calls.filter((c) => c.op === 'from').length, 0);
  const free = load({ responses: { 'rpc:mkt_credits': ok({ cap: null, used: 40 }) } }); await free.M.load();
  eq(free.M.wallet(), { cap: null, used: 40, balance: null });
});

test('create: the row with its fields, first in the list, logged with the goal only', async () => {
  const made = { ...CAMPS[0], id: 'c0000000-0000-4000-8000-000000000003', name: 'جديدة', step: 1, updated_at: '2026-11-06T10:00:00Z' };
  const { M, stub, logs } = load({ responses: { mkt_campaigns: (ops) => ok(ops.some((o) => o.op === 'insert') ? made : CAMPS) } });
  await M.load();
  const r = await M.create({ name: '  جديدة  ', goal: 'منتج جديد', state: { w: { idea: 'فكرة سرية' } } });
  eq([r.ok, r.id], [true, made.id]);
  const ins = opsOf(stub.calls, 'mkt_campaigns').find((o) => o.op === 'insert');
  eq(ins.args[0], { name: 'جديدة', goal: 'منتج جديد', step: 1, state: { w: { idea: 'فكرة سرية' } } });
  eq(M.campaigns()[0].id, made.id);
  eq(logs.at(-1).slice(0, 2), ['mkt.campaign.add', 'منتج جديد']);
});

test('save: one after the other (the newest last), the step change logged; saveSoon + flush saves the last state now', async () => {
  let n = 0; const order = [];
  const { M, stub, logs, timers } = load({ responses: { mkt_campaigns: (ops) => { const up = ops.find((o) => o.op === 'update'); if (!up) return ok(CAMPS); n += 1; order.push(up.args[0].step); return ok([{ ...CAMPS[0], step: up.args[0].step, updated_at: '2026-11-06T09:0' + n + ':00Z' }]); } } });
  await M.load();
  const a = M.save(C1, { step: 3, state: { x: 1 } }); const b = M.save(C1, { step: 4, state: { x: 2 } });
  eq([(await a).ok, (await b).ok], [true, true]); eq(order, [3, 4]);
  eq(M.campaigns()[0].step, 4);
  assert.ok(logs.some(([a1, d]) => a1 === 'mkt.campaign.step' && d === '2 → 3'));
  let k = 0; M.saveSoon(C1, () => ({ state: { k: ++k } })); M.saveSoon(C1, () => ({ state: { k: 99 } }));
  eq(timers.filter((t) => t.fn).length, 1);
  await M.flush(C1);
  const ups = opsOf(stub.calls, 'mkt_campaigns').filter((o) => o.op === 'update');
  eq(ups.at(-1).args[0], { state: { k: 99 } });
  // an archived one (no row back) is told
  const gone = load({ responses: { mkt_campaigns: (ops) => ok(ops.some((o) => o.op === 'update') ? [] : CAMPS) } }); await gone.M.load();
  eq((await gone.M.save(C1, { step: 2 })).reason, 'notfound');
});

test('archive: the row marked, out of the list, logged', async () => {
  const { M, stub, logs } = load({ responses: { mkt_campaigns: (ops) => ok(ops.some((o) => o.op === 'update') ? [{ id: C1 }] : CAMPS) } });
  await M.load(); eq((await M.archive(C1)).ok, true);
  assert.ok(typeof opsOf(stub.calls, 'mkt_campaigns').find((o) => o.op === 'update').args[0].archived_at === 'string');
  eq(M.campaigns().length, 0); eq(logs.at(-1).slice(0, 2), ['mkt.campaign.archive', '']);
});

test('upload: into the campaign folder (up-<rand>.<ext>) or templates/, images ≤ 15 MB only', async () => {
  const { M, stub } = load();
  const file = { name: 'منتج.PNG', type: 'image/png', size: 2048 };
  const r = await M.upload(C1, file);
  eq([r.ok, r.path, r.name], [true, C1 + '/up-abcdef123456.png', 'منتج.PNG']);
  eq(stub.calls.find((c) => c.table === 'storage:marketing' && c.op === 'upload').args[0], C1 + '/up-abcdef123456.png');
  eq((await M.uploadTemplate({ name: 'x.jpg', type: 'image/jpeg', size: 10 })).path, 'templates/abcdef123456.jpg');
  eq((await M.upload(C1, { name: 'a.pdf', type: 'application/pdf', size: 10 })).field, 'type');
  eq((await M.upload(C1, { name: 'a.png', type: 'image/png', size: 16 * 1024 * 1024 })).field, 'size');
  eq((await M.upload(null, file)).reason, 'invalid');
});

test('product: a SKU by eq, a permalink by in (as typed and decoded), anything else told to upload', async () => {
  const P = { id: 5, name: 'Cushion — Boho', sku: 'IBTA4040BAHC000009', image_url: 'https://ibtekr.club/a.jpg' };
  const { M, stub } = load({ responses: { products: ok([P]) } });
  eq((await M.product('ibta4040bahc000009')).product, { id: 5, name: 'Cushion — Boho', sku: 'IBTA4040BAHC000009', image: 'https://ibtekr.club/a.jpg' });
  assert.ok(opsOf(stub.calls, 'products').some((o) => o.op === 'eq' && o.args[0] === 'sku' && o.args[1] === 'IBTA4040BAHC000009'));
  await M.product('https://ibtekr.club/product/%D9%85%D8%AE%D8%AF%D8%A9/');
  const inn = opsOf(stub.calls, 'products').find((o) => o.op === 'in');
  assert.ok(inn.args[1].includes('https://ibtekr.club/product/مخدة/'));
  const none = load({ responses: { products: ok([]) } });
  eq((await none.M.product('IBTX')).message, 'اللينك ده مش لمنتج على الموقع — ارفع الصورة بدل اللينك');
  eq((await none.M.product('كلام')).field, 'link');
});

test('generate: the pending save goes first, then ai-images campaign; the path and the credits; the wallet counts them; refusals in Arabic', async () => {
  const { M, stub, logs } = load({ responses: { mkt_campaigns: (ops) => ok(ops.some((o) => o.op === 'update') ? [CAMPS[0]] : CAMPS),
    'fn:ai-images': ok({ result: 'ok', path: C1 + '/gen-P1-x.png', credits: 75, model: 'seedream-5-pro' }) } });
  await M.load();
  M.saveSoon(C1, () => ({ state: { pieces: [{ id: 'P1', idea: 'فكرة سرية' }] } }));
  const r = await M.generate(C1, { piece: 'P1', model: 'seedream-5-pro', size: '1080x1350' });
  eq([r.ok, r.path, r.credits], [true, C1 + '/gen-P1-x.png', 75]);
  const iUpdate = stub.calls.findIndex((c) => c.table === 'mkt_campaigns' && c.op === 'update'); const iInvoke = stub.calls.findIndex((c) => c.op === 'invoke');
  assert.ok(iUpdate >= 0 && iUpdate < iInvoke, 'the state is saved before the server reads it');
  eq(invokes(stub)[0], ['ai-images', { body: { action: 'campaign', campaign_id: C1, piece: 'P1', slide: null, model: 'seedream-5-pro', size: '1080x1350' } }]);
  eq(M.wallet().used, 1275);
  eq(logs.find(([a]) => a === 'mkt.ai.image').slice(0, 2), ['mkt.ai.image', 'P1 · 75 credits']);
  const slide = await M.generate(C1, { piece: 'C1', slide: 2, model: 'gpt-image-2' }); eq(slide.ok, true);
  assert.ok(logs.some(([a, d]) => a === 'mkt.ai.image' && d === 'C1·3 · 75 credits'));
  const cap = load({ responses: { 'fn:ai-images': { data: null, error: { context: { status: 402, json: async () => ({ error: 'ai_cap' }) } } } } }); await cap.M.load();
  eq((await cap.M.generate(C1, { piece: 'P1', model: 'seedream-5-pro' })).message, 'رصيد كريدت الصور للشهر ده خلص — الأدمن بيزوّد السقف من «إعدادات الصور»');
  const bad = load({ responses: { 'fn:ai-images': { data: null, error: { context: { status: 400, json: async () => ({ error: 'bad_request', field: 'image' }) } } } } }); await bad.M.load();
  eq((await bad.M.edit(C1, { piece: 'P1', model: 'seedream-5-pro', note: 'أدفى' })).message, 'القطعة لسه مالهاش صورة');
});

test('edit: the pins (x, y in 0–100, text ≤ 200, the empty ones out, 10 at most) and the note go to campaign_edit', async () => {
  const { M, stub } = load({ responses: { 'fn:ai-images': ok({ result: 'ok', path: C1 + '/edit-P1.png', credits: 60 }) } });
  await M.load();
  const pins = [{ x: 120, y: -5, text: '  الإضاءة  ' }, { x: 40, y: 50, text: ' ' }];
  eq((await M.edit(C1, { piece: 'P1', slide: -1, model: 'gpt-image-2', note: 'خلي الألوان أدفى', pins })).path, C1 + '/edit-P1.png');
  eq(invokes(stub)[0][1].body, { action: 'campaign_edit', campaign_id: C1, piece: 'P1', slide: -1, model: 'gpt-image-2', note: 'خلي الألوان أدفى', pins: [{ x: 100, y: 0, text: 'الإضاءة' }] });
});

test('write: ai-content marketing (fill / rewrite / describe) → fields or text; the log carries the kind, never the text', async () => {
  const { M, stub, logs } = load({ responses: { 'fn:ai-content': (o) => ok(o.body.task === 'fill' ? { result: 'ok', fields: { idea: 'لقطة', caption: 'كابشن' } } : { result: 'ok', text: 'كلام جديد' }) } });
  await M.load();
  eq((await M.write(C1, { task: 'fill', piece: 'P1' })).fields, { idea: 'لقطة', caption: 'كابشن' });
  eq((await M.write(C1, { task: 'rewrite', kind: 'caption', piece: 'P1', text: 'كابشن قديم سري' })).text, 'كلام جديد');
  eq(invokes(stub)[1][1].body, { action: 'marketing', task: 'rewrite', campaign_id: C1, piece: 'P1', kind: 'caption', text: 'كابشن قديم سري' });
  eq(logs.find(([a]) => a === 'mkt.ai.rewrite').slice(0, 2), ['mkt.ai.rewrite', 'caption']);
  const off = load({ responses: { 'fn:ai-content': { data: null, error: { context: { status: 503, json: async () => ({ error: 'not_configured' }) } } } } }); await off.M.load();
  eq((await off.M.write(null, { task: 'describe', kind: 'desc', image: { media_type: 'image/png', data: 'AA==' } })).message, 'الـ AI للكتابة لسه مش متوصّل — السر ANTHROPIC_API_KEY مش موجود في أسرار السيرفر');
});

test('schedule: mkt_schedule with the items, the lists loaded again, logged with the count and the platforms; a refusal names its field', async () => {
  const { M, stub, logs } = load({ responses: { 'rpc:mkt_schedule': ok(2) } });
  await M.load();
  const items = [{ piece: 'P1', kind: 'بوست', name: 'دفا', caption: 'كابشن سري', images: [], platform: 'فيسبوك', day: '2026-11-08', time: '19:00' },
    { piece: 'P1', kind: 'بوست', name: 'دفا', caption: 'كابشن سري', images: [], platform: 'انستجرام', day: '2026-11-08', time: '20:00' }];
  eq((await M.schedule(C1, items)).waiting, 2);
  eq(rpcs(stub).find(([f]) => f === 'mkt_schedule')[1], { p_campaign: C1, p_items: items });
  eq(logs.find(([a]) => a === 'mkt.campaign.schedule').slice(0, 2), ['mkt.campaign.schedule', '2 posts · فيسبوك, انستجرام']);
  const bad = load({ responses: { 'rpc:mkt_schedule': { data: null, error: { code: '22023', message: 'invalid: time' } } } }); await bad.M.load();
  const r = await bad.M.schedule(C1, items); eq([r.ok, r.field, r.message], [false, 'time', 'الساعة دي فاتت — اختار ساعة جاية']);
  const no = load({ perms: { 'marketing.view': 'F', 'marketing.create': 'F' } }); await no.M.load();
  eq((await no.M.schedule(C1, items)).reason, 'forbidden');
});

test('the log: move / caption / published / delete through mkt_post_act, the row follows, logged with the id and the platform only', async () => {
  const { M, stub, logs } = load({ responses: { 'rpc:mkt_post_act': (a) => ok(a.p_action === 'published' ? 'اتنشر' : a.p_action === 'delete' ? 'اتحذف' : 'مجدول') } });
  await M.load();
  eq((await M.move(7, '2026-11-09', '21:00')).ok, true); eq([M.getPost(7).day, M.getPost(7).time], ['2026-11-09', '21:00']);
  await M.caption(7, 'كابشن جديد سري'); eq(M.getPost(7).caption, 'كابشن جديد سري');
  eq(rpcs(stub).find(([f, a]) => f === 'mkt_post_act' && a.p_action === 'caption')[1], { p_id: 7, p_action: 'caption', p_args: { text: 'كابشن جديد سري' } });
  await M.published(7, ' https://facebook.com/p/1 '); eq([M.getPost(7).status, M.getPost(7).url], ['اتنشر', 'https://facebook.com/p/1']);
  await M.remove(7); eq([M.getPost(7).status, M.getPost(7).wasLive], ['اتحذف', true]);
  eq(logs.filter(([a]) => a.startsWith('mkt.post.')).map(([a, d]) => [a, d]), [['mkt.post.move', '#7 · فيسبوك · 2026-11-09 21:00'], ['mkt.post.caption', '#7 · فيسبوك'], ['mkt.post.published', '#7 · فيسبوك'], ['mkt.post.delete', '#7 · فيسبوك · اتنشر']]);
});

test('the templates: add / edit / «حذف» (deleted_at) / used; and no log anywhere carries an idea, a caption or a description', async () => {
  const T2 = { ...TPLS[0], id: 't2', name: 'كاروسيل', kind: 'carousel', image: 'templates/b.png', descr: 'وصف سري' };
  const { M, stub, logs } = load({ responses: { mkt_templates: (ops) => ok(ops.some((o) => o.op === 'insert') ? T2 : ops.some((o) => o.op === 'update') ? [ops.find((o) => o.op === 'update').args[0].deleted_at ? { id: 't2' } : { ...T2, name: 'كاروسيل 2' }] : TPLS),
    'rpc:mkt_template_used': ok(4) } });
  await M.load();
  eq((await M.addTemplate({ name: 'كاروسيل', kind: 'carousel', img: 'templates/b.png', desc: 'وصف سري' })).template.id, 't2');
  eq(opsOf(stub.calls, 'mkt_templates').find((o) => o.op === 'insert').args[0], { name: 'كاروسيل', kind: 'carousel', image: 'templates/b.png', descr: 'وصف سري' });
  eq((await M.editTemplate('t2', { name: 'كاروسيل 2' })).template.name, 'كاروسيل 2');
  eq((await M.templateUsed('t1')).used, 4); eq(M.templates().find((t) => t.id === 't1').used, 4);
  eq((await M.removeTemplate('t2')).ok, true); assert.ok(!M.templates().some((t) => t.id === 't2'));
  const all = JSON.stringify(logs);
  for (const secret of ['سري', 'فكرة', 'كابشن']) assert.ok(!all.includes(secret), 'a log carries «' + secret + '»: ' + all);
});

test('live: the private channel «marketing», a broadcast loads again a moment later; clear forgets everything', async () => {
  const { M, stub, run } = load({ realtime: true });
  await M.ensure();
  eq(stub.calls.find((c) => c.op === 'channel').args, ['marketing', { config: { private: true } }]);
  const before = stub.calls.filter((c) => c.table === 'mkt_posts' && c.op === 'from').length;
  await stub.emitBroadcast('changed', { at: 'x' }); await run();
  eq(stub.calls.filter((c) => c.table === 'mkt_posts' && c.op === 'from').length, before + 1);
  M.clear(); eq([M.campaigns().length, M.posts().length, M.wallet(), M.state()], [0, 0, null, 'idle']);
});

// ---------------------------------------------------------------- 9.5.2: publishing (decisions 29–39)

const fnErr = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });
test('9.5.2 the post shape: the platform\'s own rows (their https picture), the numbers, a failure\'s code, a row being published', async () => {
  const live = { ...POSTS[0], id: 8, src: 'platform', campaign_id: null, piece: null, images: [], thumb: 'https://scontent.test/p.jpg', external_id: '111_9500', status: 'اتنشر',
    views: 1200, reach: 900, likes: 40, comments: 5, shares: 3, saves: null, eng: 48, stats_at: '2026-11-06T10:00:00Z', error: null, claimed_at: null };
  const failed = { ...POSTS[0], id: 9, status: 'فشل', error: 'token', claimed_at: new Date().toISOString(), thumb: 'http://bad' };
  const { M } = load({ responses: { mkt_posts: ok([live, failed]) } });
  await M.load();
  const a = M.getPost(8), b = M.getPost(9);
  eq([a.src, a.thumb, a.externalId, a.views, a.eng, a.saves, a.camp], ['platform', 'https://scontent.test/p.jpg', '111_9500', 1200, 48, null, '—']);
  eq([b.src, b.error, b.busy, b.thumb], ['system', 'token', true, null]);
});

test('9.5.2 connection: mkt-publish status cached a minute; the switch is the admin\'s; «انشر دلوقتي» and «احذف البوست» with their reasons in words', async () => {
  const status = { result: 'ok', autopublish: false, facebook: { linked: true, name: 'Ibtekr Club', publish: true, insights: true }, instagram: { linked: true, name: '@ibtekr.club', publish: false, insights: false }, missing: ['instagram_content_publish'], valid: true, configured: true };
  const { M, stub } = load({ responses: { 'fn:mkt-publish': (o) => ok(o.body.action === 'status' ? status : o.body.action === 'publish_now' ? { result: 'ok', status: 'اتنشر', url: 'https://www.facebook.com/x' } : { result: 'ok', status: 'اتحذف' }) } });
  await M.load();
  const r = await M.connection();
  eq([r.ok, r.conn.autopublish, r.conn.facebook.publish, r.conn.instagram.publish, r.conn.missing], [true, false, true, false, ['instagram_content_publish']]);
  await M.connection(); eq(invokes(stub).filter((x) => x[1].body.action === 'status').length, 1, 'a minute\'s cache');
  eq((await M.setAutopublish(true)).reason, 'forbidden'); // ops is not the admin
  eq(await M.publishNow(7), { ok: true, url: 'https://www.facebook.com/x' });
  eq(invokes(stub).find((x) => x[1].body.action === 'publish_now'), ['mkt-publish', { body: { action: 'publish_now', id: 7 } }]);
  eq((await M.deleteLive(7)).ok, true);
  const adm = load({ role: 'admin', responses: { 'fn:mkt-publish': (o) => ok(o.body.action === 'status' ? status : { result: 'ok', autopublish: o.body.on }) } });
  await adm.M.load(); await adm.M.connection();
  eq((await adm.M.setAutopublish(true)).autopublish, true); eq(adm.M.connNow().autopublish, true);
  // the refusals: the server's code in words
  const off = load({ responses: { 'fn:mkt-publish': fnErr(409, { error: 'off' }) } }); await off.M.load();
  eq((await off.M.publishNow(7)).message, 'النشر التلقائي متوقف — الأدمن يشغّله من كارت الربط');
  const tok = load({ responses: { 'fn:mkt-publish': fnErr(502, { error: 'token' }) } }); await tok.M.load();
  const t = await tok.M.publishNow(7); eq([t.ok, t.code, t.message], [false, 'token', 'ربط الصفحة انتهى — الأدمن يربطها تاني']);
  const pend = load({ responses: { 'fn:mkt-publish': ok({ result: 'pending' }) } }); await pend.M.load();
  eq(await pend.M.publishNow(7), { ok: true, pending: true });
  const view = load({ perms: { 'marketing.view': 'F' } }); await view.M.load();
  eq((await view.M.publishNow(7)).reason, 'forbidden'); eq((await view.M.deleteLive(7)).reason, 'forbidden');
});

test('9.5.2 preparePublish: download items as they are, the publish items\' images as JPEG copies (one per image and margin); a missing image → the problem', async () => {
  const { M } = load({ responses: { 'storage:download': ok(null) } });
  await M.load();
  const items = [{ piece: 'P2', platform: 'تيك توك', kind: 'بوست', images: [C1 + '/p.png'], how: 'download' }];
  eq(await M.preparePublish(C1, items), { ok: true, items });
  const r = await M.preparePublish(C1, [{ piece: 'P1', platform: 'انستجرام', kind: 'بوست', images: [C1 + '/gone.png'], how: 'publish' }]);
  eq([r.ok, r.problems[0].piece, r.problems[0].why], [false, 'P1', 'صورة القطعة مش موجودة أو مااتقريتش']);
  eq((await load({ perms: { 'marketing.view': 'F', 'marketing.publish': 'F' } }).M.preparePublish(C1, items)).reason, 'forbidden');
});

// ---------------------------------------------------------------- 9.5.3: the ads numbers
const AD_OBJ = [{ platform: 'meta', kind: 'campaign', id: '120252323303340228', parent_id: '11', name: 'Macrame', status: 'ACTIVE', thumb: null, meta: {}, updated_at: '2026-11-06T10:00:00Z' },
  { platform: 'meta', kind: 'ad', id: '1206', parent_id: '120252323303340228', name: 'carousel', status: 'ACTIVE', thumb: 'http://bad', meta: {}, updated_at: '2026-11-06T10:00:00Z' }];
const AD_STATS = [{ level: 'campaign', object_id: '120252323303340228', campaign_id: '120252323303340228', day: '2026-11-02', spend: '800.50', impressions: '12000', reach: null, clicks: '300', link_clicks: '210', frequency: '1.333', purchases: '3', purchase_value: '4200' }];
const AD_ORD = [{ day: '2026-11-02', platform: 'meta', source: 'fb', campaign: '120252323303340228', grp: 'completed', orders: 3, sales: '3000.00', share: null }];

test('9.5.3 adsStatus: mkt-ads status cached a minute, the account and the last error in words; adsSync is the admin\'s', async () => {
  const { M, stub } = load({ responses: { 'fn:mkt-ads': (o) => (o.body.action === 'status'
    ? ok({ configured: true, account: { name: 'Ibtekr Club', currency: 'EGP', status: 'ACTIVE' }, synced_at: '2026-11-06T10:00:00Z', checked_at: '2026-11-06T11:00:00Z', error: 'token' })
    : ok({ result: 'ok', days: 3, campaigns: 4, ads: 9, stats: 30 })) } });
  const s = await M.adsStatus();
  eq([s.ok, s.ads.configured, s.ads.account.name, s.ads.syncedAt, s.ads.error], [true, true, 'Ibtekr Club', '2026-11-06T10:00:00Z', 'token']);
  assert.match(s.ads.why, /مفتاح إعلانات ميتا انتهى/);
  await M.adsStatus(); eq(invokes(stub).length, 1); // cached
  eq((await M.adsSync()).reason, 'forbidden'); // ops is not the admin
  const adm = load({ role: 'admin', responses: { 'fn:mkt-ads': (o) => (o.body.action === 'sync' ? ok({ result: 'ok', days: 7, campaigns: 4, ads: 9, stats: 30 }) : ok({ configured: true, account: null })) } });
  eq(await adm.M.adsSync(7), { ok: true, days: 7, campaigns: 4, ads: 9, stats: 30, platforms: {} });
  eq(invokes(adm.stub)[0], ['mkt-ads', { body: { action: 'sync', days: 7 } }]);
  const off = load({ role: 'admin', responses: { 'fn:mkt-ads': { data: null, error: { context: { status: 503, json: async () => ({ error: 'not_configured', configured: false }) } } } } });
  assert.match((await off.M.adsSync()).message, /مفيش منصة إعلانات مربوطة/);
  eq(M.adsWhy('rate').includes('استنى'), true); eq(M.adsWhy('graph_368'), 'ميتا رفضت (graph_368)'); eq(M.adsWhy(null), null);
  // Meta's own words come after a code we have no message for (never after a known one)
  eq(M.adsWhy('graph_1', 'An unknown error occurred'), 'ميتا رفضت (graph_1) — An unknown error occurred'); eq(M.adsWhy('token', 'expired').includes('expired'), false);
  const bad = load({ role: 'admin', responses: { 'fn:mkt-ads': (o) => (o.body.action === 'sync' ? { data: null, error: { context: { status: 502, json: async () => ({ error: 'graph_1', text: 'Unsupported get request' }) } } } : ok({ configured: true, account: null, error: 'graph_1', text: 'Unsupported get request' })) } });
  assert.match((await bad.M.adsSync()).message, /graph_1\) — Unsupported get request/);
  assert.match((await bad.M.adsStatus()).ads.why, /Unsupported get request/);
});

test('9.5.3 adsData: the period + the 5 weeks before its end, Meta\'s objects and daily numbers as numbers, the ad orders; https pictures only; cached', async () => {
  const { M, stub } = load({ responses: { mkt_ad_objects: ok(AD_OBJ), mkt_ad_stats: ok(AD_STATS), 'rpc:mkt_ads_orders': ok(AD_ORD) } });
  const r = await M.adsData({ from: '2026-11-01', to: '2026-11-05' });
  eq([r.ok, r.from, r.to], [true, '2026-10-02', '2026-11-05']);
  eq(rpcs(stub), [['mkt_ads_orders', { p_from: '2026-10-02', p_to: '2026-11-05' }]]);
  const stats = stub.calls.filter((c) => c.table === 'mkt_ad_stats' || (c.op === 'gte' || c.op === 'lte'));
  assert.ok(stats.some((c) => c.op === 'gte' && c.args[0] === 'day' && c.args[1] === '2026-10-02') && stats.some((c) => c.op === 'lte' && c.args[1] === '2026-11-05'));
  eq([r.stats[0].spend, r.stats[0].impressions, r.stats[0].reach, r.stats[0].frequency, r.stats[0].purchase_value], [800.5, 12000, null, 1.333, 4200]);
  eq([r.orders[0].sales, r.orders[0].share], [3000, null]);
  eq(r.objects.find((o) => o.kind === 'ad').thumb, null);
  await M.adsData({ from: '2026-11-01', to: '2026-11-05' }); eq(rpcs(stub).length, 1); // cached
  eq((await M.adsData({ from: '2026-11-05', to: '2026-11-01' })).reason, 'invalid');
  eq((await M.adsData({ from: '2025-01-01', to: '2026-11-05' })).from, '2025-10-01'); // 400 days at most
  const none = load({ perms: {} }); eq((await none.M.adsData({ from: '2026-11-01', to: '2026-11-05' })).reason, 'forbidden');
});

// ---------------------------------------------------------------- 9.5.4: the media buyer
const SUGG = [
  { id: 1, platform: 'meta', kind: 'stop', campaign_id: '120251977233530228', campaign_name: 'Lamps', ad_id: null, title: 'وقّف «Lamps»', sub: 'صرفت 2,000 ج.م', why: 'ولا أوردر', impact: 'توفير ~400 ج.م/يوم', pct: null, data: { spend5: 2000 }, status: 'pending', created_at: '2026-11-06T10:00:00Z', checked_at: '2026-11-06T10:00:00Z', decided_by: null, decided_at: null, value: null, note: null, result: null, error: null },
  { id: 2, platform: 'meta', kind: 'budget_up', campaign_id: '120252323303340228', campaign_name: 'Macrame', ad_id: null, title: 'زوّد «Macrame» 20%', sub: '', why: '', impact: '', pct: '20', data: { daily_budget: 300 }, status: 'done', created_at: '2026-11-05T10:00:00Z', checked_at: '2026-11-05T10:00:00Z', decided_by: 'u1', decided_at: '2026-11-05T11:00:00Z', value: 10, note: 'شوية', result: { before: 300, after: 330 }, error: null },
  { id: 3, platform: 'meta', kind: 'weird', campaign_id: '1', campaign_name: null, ad_id: '1206', title: 'x', pct: null, data: null, status: 'nope', created_at: '2026-11-04T10:00:00Z' },
];
const REQS = [
  { id: 1, kind: 'designer', title: 'فيديو للمخدة', details: '15 ثانية', project: 'الشتا', status: 'جديد', created_by: 'u1', created_at: '2026-11-06T09:00:00Z', updated_by: 'u1', updated_at: '2026-11-06T09:00:00Z', done_at: null },
  { id: 2, kind: 'dev', title: 'صفحة هبوط', details: null, project: null, status: 'خلص', created_by: 'u2', created_at: '2026-11-05T09:00:00Z', updated_by: 'u1', updated_at: '2026-11-06T09:00:00Z', done_at: '2026-11-06T09:00:00Z' },
];
const RULES = { dailyCap: 5000, maxCpa: 450, autoStop: 1500, autoStopMode: 'suggest', reportHour: 9, live: false };

test('9.5.4 suggestions: the open + the last 30 days in the page\'s shape (unknown kinds and statuses tamed), cached a minute; rules through the RPC; requests with the author\'s name', async () => {
  const { M, stub } = load({ responses: { mkt_suggestions: ok(SUGG), 'rpc:mkt_buyer_rules': ok({ ...RULES, dailyCap: 8000, live: true }), mkt_requests: ok(REQS) } });
  const r = await M.suggestions();
  eq(r.items.map((s) => [s.id, s.kind, s.status, s.pct, s.value]), [[1, 'stop', 'pending', null, null], [2, 'budget_up', 'done', 20, 10], [3, 'tracking', 'pending', null, null]]);
  eq([r.items[1].result.after, r.items[1].note, r.items[2].data, r.items[2].ad_id], [330, 'شوية', {}, '1206']);
  const or = stub.calls.find((c) => c.op === 'or'); assert.match(or.args[0], /^status\.eq\.pending,created_at\.gte\.20/);
  await M.suggestions(); eq(stub.calls.filter((c) => c.table === 'mkt_suggestions' && c.op === 'from').length, 1); // cached
  eq(M.suggNow().length, 3);
  const ru = await M.rules(); eq(ru.rules, { ...RULES, dailyCap: 8000, live: true }); eq(rpcs(stub).at(-1), ['mkt_buyer_rules', undefined]);
  await M.rules(); eq(rpcs(stub).filter((x) => x[0] === 'mkt_buyer_rules').length, 1);
  const q = await M.requests(); eq(q.items.map((x) => [x.id, x.kind, x.status, x.mine, x.doneAt]), [[1, 'designer', 'جديد', true, null], [2, 'dev', 'خلص', false, '2026-11-06T09:00:00Z']]);
  const none = load({ perms: {} }); eq((await none.M.suggestions()).reason, 'forbidden'); eq((await none.M.rules()).reason, 'forbidden'); eq((await none.M.requests()).reason, 'forbidden');
});

test('9.5.4 decide: the admin only; reject / approve / edit through mkt-ads with the value and the note; the switch off = recorded; the refusals in words; the log carries the decision and the status only', async () => {
  const seen = [];
  const fn = (o) => { const b = o.body; seen.push(b); if (b.action !== 'decide') return ok({});
    if (b.id === 1) return ok({ result: 'ok', status: 'rejected' });
    if (b.id === 2) return ok({ result: 'ok', status: 'approved', live: false });
    if (b.id === 3) return ok({ result: 'ok', status: 'done', before: 300, after: 330, updates: 1 });
    if (b.id === 4) return ok({ result: 'ok', status: 'done', request: true });
    if (b.id === 5) return { data: null, error: { context: { status: 409, json: async () => ({ error: 'cap', cap: 5000, after: 5060 }) } } };
    if (b.id === 6) return { data: null, error: { context: { status: 400, json: async () => ({ error: 'bad_request', field: 'value' }) } } };
    if (b.id === 7) return { data: null, error: { context: { status: 502, json: async () => ({ error: 'token' }) } } };
    return { data: null, error: { context: { status: 409, json: async () => ({ error: 'decided' }) } } }; };
  const { M, stub, logs } = load({ role: 'admin', responses: { 'fn:mkt-ads': fn } });
  eq((await M.decide(1, 'reject', { note: ' سيبها ' })).message, 'اترفض'); eq(seen[0], { action: 'decide', id: 1, decision: 'reject', note: 'سيبها' });
  const off = await M.decide(2, 'approve'); eq([off.ok, off.status, off.live], [true, 'approved', false]); assert.match(off.message, /مفتاح التنفيذ مقفول/);
  const e = await M.decide(3, 'edit', { value: '10' }); eq([e.status, e.before, e.after, e.updates], ['done', 300, 330, 1]); assert.match(e.message, /330 ج\.م\/يوم/); eq(seen[2].value, 10);
  assert.match((await M.decide(4, 'approve')).message, /للديزاينر/);
  assert.match((await M.decide(5, 'approve')).message, /السقف اليومي/);
  assert.match((await M.decide(6, 'edit', { value: 40 })).message, /30%/);
  assert.match((await M.decide(7, 'approve')).message, /مفتاح إعلانات ميتا/);
  assert.match((await M.decide(8, 'approve')).message, /اتقرر فيه قبل كده/);
  eq(logs.map((l) => l[0] + ' ' + l[1]), ['mkt.buyer.decide reject · rejected', 'mkt.buyer.decide approve · approved · live_off', 'mkt.buyer.decide edit · done', 'mkt.buyer.decide approve · done',
    'mkt.buyer.decide approve · cap', 'mkt.buyer.decide edit · invalid', 'mkt.buyer.decide approve · ai_error', 'mkt.buyer.decide approve · decided']);
  assert.ok(!JSON.stringify(logs).includes('سيبها'));
  const ops = load(); eq((await ops.M.decide(1, 'approve')).reason, 'forbidden'); eq(invokes(ops.stub).length, 0);
});

test('9.5.4 rulesSet / setLive: the admin only; the numbers and the modes go, never live; the switch by its own action; the cache follows', async () => {
  const { M, stub, events } = load({ role: 'admin', responses: { 'fn:mkt-ads': (o) => ok({ result: 'ok', rules: { ...RULES, ...(o.body.rules || {}), live: o.body.action === 'live' ? o.body.on : false } }) } });
  const r = await M.rulesSet({ dailyCap: '8000', autoStopMode: 'auto', live: true, junk: 1 });
  eq(invokes(stub)[0], ['mkt-ads', { body: { action: 'rules_set', rules: { dailyCap: 8000, autoStopMode: 'auto' } } }]);
  eq([r.rules.dailyCap, r.rules.autoStopMode, r.rules.live], [8000, 'auto', false]);
  const on = await M.setLive(true); eq(invokes(stub)[1], ['mkt-ads', { body: { action: 'live', on: true } }]); eq(on.rules.live, true); eq(M.rulesNow().live, true);
  eq(events.filter((e) => e === 'ib:marketing').length, 2);
  const bad = load({ role: 'admin', responses: { 'fn:mkt-ads': { data: null, error: { context: { status: 400, json: async () => ({ error: 'bad_request', field: 'maxCpa' }) } } } } });
  assert.match((await bad.M.rulesSet({ maxCpa: 0 })).message, /maxCpa/);
  const ops = load(); eq((await ops.M.rulesSet({ dailyCap: 1 })).reason, 'forbidden'); eq((await ops.M.setLive(true)).reason, 'forbidden');
});

test('9.5.4 requests: add (marketing.create, the title required, the kind designer / dev), edit the text, the admin\'s status; logged with the kind and the status only', async () => {
  const row = (x) => ({ id: 9, kind: 'designer', title: 'فيديو', details: null, project: null, status: 'جديد', created_by: 'u1', created_at: '2026-11-06T09:00:00Z', updated_by: 'u1', updated_at: '2026-11-06T09:00:00Z', done_at: null, ...x });
  const { M, stub, logs } = load({ role: 'admin', responses: { mkt_requests: (calls) => { const ins = calls.find((c) => c.op === 'insert'); return ins ? ok(row({ kind: ins.args[0].kind, title: ins.args[0].title, details: ins.args[0].details, project: ins.args[0].project })) : ok([row({ title: 'فيديو 9:16', status: 'خلص', done_at: '2026-11-07T09:00:00Z' })]); } } });
  eq((await M.addRequest({ kind: 'dev', title: '  ' })).field, 'title');
  const a = await M.addRequest({ kind: 'video', title: ' فيديو ', details: 'الوصف سري\r\n9:16', project: 'الشتا' });
  eq([a.ok, a.request.kind, a.request.title, a.request.details, a.request.project, a.request.mine], [true, 'designer', 'فيديو', 'الوصف سري\n9:16', 'الشتا', true]);
  eq(stub.calls.find((c) => c.op === 'insert').args[0], { kind: 'designer', title: 'فيديو', details: 'الوصف سري\n9:16', project: 'الشتا' });
  const e = await M.editRequest(9, { title: 'فيديو 9:16' }); eq(e.request.title, 'فيديو 9:16');
  eq((await M.editRequest(9, { title: '' })).field, 'title');
  const s = await M.setRequestStatus(9, 'خلص'); eq([s.request.status, s.request.doneAt], ['خلص', '2026-11-07T09:00:00Z']);
  eq((await M.setRequestStatus(9, 'done')).reason, 'invalid');
  eq(M.reqsNow().length, 1);
  eq(logs.map((l) => l[0] + ' ' + l[1]), ['mkt.request.add designer', 'mkt.request.edit designer', 'mkt.request.status designer · خلص']);
  assert.ok(!JSON.stringify(logs).includes('سري'));
  const ops = load(); eq((await ops.M.setRequestStatus(9, 'خلص')).reason, 'forbidden');
  const none = load({ perms: { 'marketing.view': 'F' } }); eq((await none.M.addRequest({ kind: 'dev', title: 'x' })).reason, 'forbidden');
});

test('9.5.4 buyerChat: marketing.view; the question (≤ 1000) and the last 6 turns go to ai-content buyer; text back; the refusals in words; the log carries no text', async () => {
  const { M, stub, logs } = load({ perms: { 'marketing.view': 'P' }, responses: { 'fn:ai-content': ok({ result: 'ok', text: 'Macrame الأحسن — وافق على الاقتراح من الصفحة', model: 'm', cost_usd: 0.003 }) } });
  eq((await M.buyerChat('  ')).field, 'question');
  const hist = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i })).concat([{ role: 'system', text: 'x' }, { role: 'user', text: '  ' }]);
  const r = await M.buyerChat(' أزوّد Macrame؟ ', hist);
  eq([r.ok, r.text], [true, 'Macrame الأحسن — وافق على الاقتراح من الصفحة']);
  const body = invokes(stub)[0][1].body; eq([body.action, body.question, body.history.length, body.history[0].text, body.history.at(-1).text], ['buyer', 'أزوّد Macrame؟', 6, 't3', 't8']);
  eq(logs, [['mkt.buyer.chat', '', { entity: 'marketing', entity_id: null }]]);
  const cap = load({ responses: { 'fn:ai-content': { data: null, error: { context: { status: 402, json: async () => ({ error: 'ai_cap' }) } } } } });
  assert.match((await cap.M.buyerChat('x')).message, /سقف الـ AI الشهري/);
  const ref = load({ responses: { 'fn:ai-content': ok({ result: 'refused' }) } }); eq((await ref.M.buyerChat('x')).reason, 'refused');
  const none = load({ perms: {} }); eq((await none.M.buyerChat('x')).reason, 'forbidden');
});

// ---------------------------------------------------------------- 9.5.5: the video through ai-images (the bridge's jobs)
test('9.5.5 video: clip / voice / music / assemble / poll to ai-images with the campaign and the piece (flushed first); the jobs in the page\'s shape; the refusals in words; the log carries the piece and the kind only', async () => {
  const calls = [];
  const fn = (o) => { const b = o.body; calls.push(b);
    if (b.action === 'video_poll') return ok({ result: 'ok', jobs: [{ id: 1, kind: 'clip', scene: 0, status: 'done', ref: 'c1', path: C1 + '/vid-V1-s1-a.mp4', bytes: 10, error: null, data: {}, createdAt: 't', doneAt: 't' }], open: 0, final: { id: 1, kind: 'mix', scene: null, status: 'done', ref: 'm1', path: C1 + '/vid-V1-mix-a.mp4', bytes: 20, data: { final: true } } });
    if (b.action === 'video_assemble') return { data: null, error: { context: { status: 409, json: async () => ({ error: 'clips' }) } } };
    if (b.action === 'video_music') return { data: null, error: { context: { status: 503, json: async () => ({ error: 'not_linked' }) } } };
    return ok({ result: 'ok', job: { id: 7, kind: b.action.replace('video_', ''), scene: b.scene == null ? null : b.scene, status: 'running', ref: 'x', path: null, bytes: null, error: null, data: { model: 'seedance-2.5' }, createdAt: 't', doneAt: null } }); };
  const { M, logs } = load({ responses: { 'fn:ai-images': fn } });
  const c = await M.videoClip(C1, 'V1', 1);
  eq([c.ok, c.job.kind, c.job.scene, c.job.status, c.job.data.model], [true, 'clip', 1, 'running', 'seedance-5.2'.replace('5.2', '2.5')]);
  eq(calls[0], { action: 'video_clip', campaign_id: C1, piece: 'V1', scene: 1 });
  const v = await M.videoVoice(C1, 'V1', { voice: 'm-eg-1', text: ' الدفا الحقيقي ' }); eq([v.ok, calls[1].text, calls[1].voice], [true, 'الدفا الحقيقي', 'm-eg-1']);
  assert.match((await M.videoMusic(C1, 'V1', 'مبهجة')).message, /اربط حساب Magnific/);
  assert.match((await M.videoAssemble(C1, 'V1')).message, /ولّد كل المشاهد الأول/);
  const p = await M.videoPoll(C1, 'V1'); eq([p.ok, p.jobs.length, p.open, p.final.path], [true, 1, 0, C1 + '/vid-V1-mix-a.mp4']);
  eq(logs.map((l) => l[0] + ' ' + l[1]), ['mkt.video.clip V1 · s2 · clip', 'mkt.video.voice V1 · voice', 'mkt.video.music V1 · not_linked', 'mkt.video.assemble V1 · clips']);
  assert.ok(!JSON.stringify(logs).includes('الدفا'));
  eq((await M.videoClip(null, 'V1', 0)).reason, 'invalid');
  const none = load({ perms: { 'marketing.view': 'F' } }); eq((await none.M.videoClip(C1, 'V1', 0)).reason, 'forbidden');
});

test('9.5.5 videoUpload: an audio file (MP3 / M4A / WAV, ≤ 50 MB) into the campaign\'s folder as vid-<piece>-up…, then video_upload with its role; videoScenes through ai-content scenes', async () => {
  const seen = [];
  const { M, stub } = load({ responses: { 'fn:ai-images': (o) => { seen.push(o.body); return ok({ result: 'ok', job: { id: 9, kind: 'upload', status: 'done', ref: 'u1', path: o.body.path, data: { role: o.body.role } } }); },
    'fn:ai-content': (o) => { seen.push(o.body); return ok({ result: 'ok', scenes: [{ n: 1, d: 5, idea: 'أ', text: '', cam: 'ثابتة' }], voice: 'الدفا' }); } } });
  eq((await M.videoUpload(C1, 'V1', { type: 'image/png', size: 10, name: 'a.png' }, 'voice')).field, 'type');
  eq((await M.videoUpload(C1, 'V1', { type: 'audio/mpeg', size: 60 * 1024 * 1024, name: 'a.mp3' }, 'voice')).field, 'size');
  const r = await M.videoUpload(C1, 'V1', { type: 'audio/mpeg', size: 1000, name: 'my voice.mp3' }, 'voice');
  eq([r.ok, r.job.kind, r.job.data.role], [true, 'upload', 'voice']);
  const up = stub.calls.find((c) => c.op === 'upload'); assert.match(up.args[0], new RegExp('^' + C1 + '/vid-V1-up[0-9]{2}-[0-9a-f]{12}\\.mp3$')); eq(up.args[2].contentType, 'audio/mpeg');
  eq(seen[0].path, up.args[0]); eq(seen[0].role, 'voice');
  const sc = await M.videoScenes(C1, 'V1', true);
  eq([sc.ok, sc.scenes.length, sc.voice], [true, 1, 'الدفا']); eq([seen[1].task, seen[1].piece, seen[1].voice], ['scenes', 'V1', true]);
});
