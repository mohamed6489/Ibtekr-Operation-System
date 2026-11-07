// deno-lint-ignore-file no-explicit-any
// mkt-publish handler tests (phase 9.5.2): the crons' auth and switch, publishing a row to Facebook (post / carousel / story) and
// Instagram (container → FINISHED → media_publish, a container still preparing kept for the next run), the failures as our codes
// (and the timed-out last call as «uncertain»), «انشر دلوقتي», deleting a live post, the numbers and the platform's own posts, the
// connection's status and the switch. No network: a fake fetch routes «METHOD path» of graph.facebook.com; the database is
// ../_test/fakes.ts with mkt_publish_claim / mkt_stats_put played by the test.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const U = { admin: '00000000-0000-4000-8000-0000000051d1', pub: '00000000-0000-4000-8000-0000000051d2', view: '00000000-0000-4000-8000-0000000051d3', none: '00000000-0000-4000-8000-0000000051d4' };
const MEMBERS: Record<string, { uid: string; admin?: boolean; view?: string; publish?: string }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-pub': { uid: U.pub, view: 'F', publish: 'F' }, 'jwt-view': { uid: U.view, view: 'F', publish: 'N' }, 'jwt-none': { uid: U.none, view: 'N', publish: 'N' },
};
const META_ENV = { ...ENV, META_APP_ID: '1234567890', META_APP_SECRET: 'app-secret-0123456789abcdef' };
const PAGE = { id: '111', name: 'Ibtekr Club', token: 'EAAB'.repeat(12), ig: { id: '777', username: 'ibtekr.club' } };
const CID = '00000000-0000-4000-8000-00000000c051';
type Route = { status?: number; body?: unknown } | ((call: GraphCall) => { status?: number; body?: unknown } | Error);
type GraphCall = { method: string; path: string; query: Record<string, string>; auth: string | null; body: any };
function fakeGraph(routes: Record<string, Route> = {}) {
  const calls: GraphCall[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init.headers); const ct = h.get('content-type') ?? '';
    const body = !init.body ? undefined : ct.includes('json') ? JSON.parse(String(init.body)) : Object.fromEntries(new URLSearchParams(String(init.body)));
    const call: GraphCall = { method: init.method ?? 'GET', path: url.pathname.replace(/^\/v21\.0\//, ''), query: Object.fromEntries(url.searchParams), auth: h.get('authorization'), body };
    calls.push(call);
    const r = routes[`${call.method} ${call.path}`]; const reply = typeof r === 'function' ? r(call) : r;
    if (reply instanceof Error) throw reply;
    if (!reply) return new Response(JSON.stringify({ error: { message: 'no route', code: 100 } }), { status: 404 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const timeout = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const post = (extra: Record<string, any> = {}) => ({ id: 5001, src: 'system', campaign_id: CID, piece: 'P1', kind: 'بوست', name: 'دفا الشتا', caption: 'كابشن', tags: '#إبتكر', images: [CID + '/pub-a.jpg'], platform: 'فيسبوك', day: '2026-10-24', time: '19:00', how: 'publish', status: 'مجدول', attempts: 0, ...extra });
type Opts = { posts?: any[]; routes?: Record<string, Route>; auto?: boolean | null; linked?: boolean | 'no_ig'; storage?: Record<string, Uint8Array>; env?: Record<string, string> };
function setup({ posts = [], routes = {}, auto = true, linked = true, storage, env = META_ENV }: Opts = {}) {
  const ref: { db: any } = { db: null };
  const nowMs = Date.parse(NOW);
  const busy = (r: any) => r.claimed_at && nowMs - Date.parse(r.claimed_at) < 300_000;
  const page = linked === 'no_ig' ? { ...PAGE, ig: null } : PAGE;
  const rpc = {
    cs_secret_get: ({ p_name }: any) => (p_name === 'meta_pages' && linked ? JSON.stringify({ page }) : null),
    sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok',
    mkt_publish_claim: async ({ p_limit, p_id }: any) => {
      const all = ref.db.rows('mkt_posts');
      const pick = p_id ? all.filter((r: any) => r.id === p_id && r.src === 'system' && ['مجدول', 'فشل'].includes(r.status) && !busy(r))
        : all.filter((r: any) => r.src === 'system' && r.status === 'مجدول' && r.how === 'publish' && r.day <= '2026-10-25' && !busy(r)).slice(0, p_limit);
      for (const r of pick) await ref.db.from('mkt_posts').update({ claimed_at: NOW, attempts: (r.attempts ?? 0) + 1, ...(p_id ? { how: 'publish', status: 'مجدول', error: null, work: r.status === 'فشل' ? null : r.work } : {}) }).eq('id', r.id);
      return pick.map((r: any) => ref.db.row('mkt_posts', r.id));
    },
    mkt_stats_put: async ({ p_rows }: any) => { for (const x of p_rows) await ref.db.from('mkt_posts').update({ views: x.views, reach: x.reach, likes: x.likes, comments: x.comments, shares: x.shares, saves: x.saves, eng: x.eng, stats_at: NOW }).eq('id', x.id); return p_rows.length; },
  };
  const files = storage ?? Object.fromEntries(['pub-a.jpg', 'pub-b.jpg', 'pub-c.jpg', 'p.png'].map((f) => [`marketing/${CID}/${f}`, new Uint8Array([1])]));
  const settings = auto == null ? [] : [{ section: 'marketing', data: { autopublish: auto } }];
  const db = fakeDb({ mkt_posts: posts, settings }, { rpc, storage: files });
  ref.db = db;
  const userDb = (jwt: string) => { const m = MEMBERS[jwt]; return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'marketing.view' ? m.view ?? 'N' : key === 'marketing.publish' ? m.publish ?? 'N' : 'N'), is_admin: () => !!m.admin } : {} }); };
  const g = fakeGraph(routes);
  const deps = { env, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, fetch: g.fetch, sleep: async () => {} };
  return { deps, db, graph: g };
}
async function call(deps: any, b: unknown, jwt: string | null = 'jwt-pub', secret: string | null = null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (jwt) headers.authorization = 'Bearer ' + jwt; if (secret) headers['x-sync-secret'] = secret;
  const res = await handler(new Request('http://x/mkt-publish', { method: 'POST', headers, body: JSON.stringify(b) }), deps);
  return { res, body: await res.json() };
}
const cron = (deps: any, action: string, secret = 'sync-secret-ok') => call(deps, { action }, null, secret);

Deno.test('the crons: the sync secret only, due / stats only; the switch off → nothing claimed', async () => {
  const { deps, db } = setup({ posts: [post()], auto: false });
  assertEquals((await cron(deps, 'due', 'wrong')).res.status, 401);
  assertEquals((await cron(deps, 'status')).res.status, 401);
  const r = await cron(deps, 'due');
  assertEquals(r.body, { result: 'skipped', reason: 'off' });
  assertFalse(db.calls.some((c: any) => c.op === 'rpc' && c.name === 'mkt_publish_claim'));
  // no settings row at all = off too
  const s2 = setup({ posts: [post()], auto: null });
  assertEquals((await cron(s2.deps, 'due')).body.reason, 'off');
});

Deno.test('due: a Facebook post — signed link, the stage saved before the publishing call, the post id and its link back on the row', async () => {
  const stages: string[] = [];
  const { deps, db, graph } = setup({ posts: [post()], routes: {
    'POST 111/photos': (c) => { stages.push(db.row('mkt_posts', 5001).work?.stage ?? 'none'); return { body: { id: '9001', post_id: '111_9001' }, ...(c.body.published === 'true' ? {} : { status: 400 }) }; },
    'GET 111_9001': { body: { permalink_url: 'https://www.facebook.com/111/posts/9001' } },
  } });
  const r = await cron(deps, 'due');
  assertEquals(r.body, { result: 'ok', published: 1, failed: 0, waiting: 0 });
  assertEquals(stages, ['publishing']);
  const p = graph.calls.find((c) => c.path === '111/photos')!;
  assertEquals(p.body.message, 'كابشن\n\n#إبتكر'); assert(p.body.url.startsWith('https://signed.test/marketing/' + CID + '/pub-a.jpg'));
  assertEquals(p.auth, 'Bearer ' + PAGE.token);
  const row = db.row('mkt_posts', 5001);
  assertEquals([row.status, row.external_id, row.post_url, row.error, row.work, row.claimed_at], ['اتنشر', '111_9001', 'https://www.facebook.com/111/posts/9001', null, null, null]);
  assertEquals(row.published_at, NOW);
});

Deno.test('due: a Facebook carousel = hidden photos then one feed post; a story = a hidden photo then a photo story', async () => {
  let n = 0;
  const { deps, db, graph } = setup({ posts: [post({ kind: 'كاروسيل', images: [CID + '/pub-a.jpg', CID + '/pub-b.jpg', CID + '/pub-c.jpg'] }), post({ id: 5002, piece: 'X1', kind: 'ستوري' })], routes: {
    'POST 111/photos': () => ({ body: { id: String(8000 + ++n) } }),
    'POST 111/feed': { body: { id: '111_7000' } },
    'POST 111/photo_stories': { body: { success: true, post_id: '111_7100' } },
  } });
  const r = await cron(deps, 'due');
  assertEquals(r.body.published, 2);
  const photos = graph.calls.filter((c) => c.path === '111/photos');
  assert(photos.slice(0, 3).every((c) => c.body.published === 'false' && c.body.temporary === 'true'));
  assertEquals(graph.calls.find((c) => c.path === '111/feed')!.body, { message: 'كابشن\n\n#إبتكر', attached_media: [{ media_fbid: '8001' }, { media_fbid: '8002' }, { media_fbid: '8003' }] });
  assertEquals(graph.calls.find((c) => c.path === '111/photo_stories')!.body, { photo_id: '8004' });
  assertEquals(db.row('mkt_posts', 5001).external_id, '111_7000'); assertEquals(db.row('mkt_posts', 5002).external_id, '111_7100');
});

Deno.test('due: Instagram — the container, FINISHED, media_publish; still preparing → kept for the next run, published then without uploading again', async () => {
  let ready = false;
  const { deps, db, graph } = setup({ posts: [post({ platform: 'انستجرام' })], routes: {
    'POST 777/media': { body: { id: '4400' } },
    'GET 4400': () => ({ body: { status_code: ready ? 'FINISHED' : 'IN_PROGRESS' } }),
    'POST 777/media_publish': { body: { id: '17890001' } },
    'GET 17890001': { body: { permalink: 'https://www.instagram.com/p/abc/' } },
  } });
  let r = await cron(deps, 'due');
  assertEquals(r.body, { result: 'ok', published: 0, failed: 0, waiting: 1 });
  let row = db.row('mkt_posts', 5001);
  assertEquals([row.status, row.work, row.claimed_at], ['مجدول', { stage: 'container', container: '4400' }, null]);
  assertEquals(graph.calls.filter((c) => c.path === '4400').length, 6); // polled, then left
  ready = true;
  r = await cron(deps, 'due');
  assertEquals(r.body.published, 1);
  assertEquals(graph.calls.filter((c) => c.path === '777/media').length, 1, 'the image was not uploaded twice');
  assertEquals(graph.calls.find((c) => c.path === '777/media')!.body, { image_url: graph.calls.find((c) => c.path === '777/media')!.body.image_url, caption: 'كابشن\n\n#إبتكر' });
  assertEquals(graph.calls.find((c) => c.path === '777/media_publish')!.body, { creation_id: '4400' });
  row = db.row('mkt_posts', 5001);
  assertEquals([row.status, row.external_id, row.post_url], ['اتنشر', '17890001', 'https://www.instagram.com/p/abc/']);
});

Deno.test('due: an Instagram carousel = its children, then the carousel with their ids; a story has no caption', async () => {
  let k = 0;
  const { deps, graph } = setup({ posts: [post({ platform: 'انستجرام', kind: 'كاروسيل', images: [CID + '/pub-a.jpg', CID + '/pub-b.jpg'] }), post({ id: 5002, piece: 'X1', platform: 'انستجرام', kind: 'ستوري' })], routes: {
    'POST 777/media': (c) => ({ body: { id: c.body.media_type === 'CAROUSEL' ? '4500' : String(4600 + ++k) } }),
    'GET 4500': { body: { status_code: 'FINISHED' } }, 'GET 4601': { body: { status_code: 'FINISHED' } }, 'GET 4602': { body: { status_code: 'FINISHED' } }, 'GET 4603': { body: { status_code: 'FINISHED' } },
    'POST 777/media_publish': (c) => ({ body: { id: c.body.creation_id === '4500' ? '1801' : '1802' } }),
  } });
  assertEquals((await cron(deps, 'due')).body.published, 2);
  const media = graph.calls.filter((c) => c.path === '777/media').map((c) => c.body);
  assertEquals(media[0].is_carousel_item, 'true'); assertEquals(media[1].is_carousel_item, 'true');
  assertEquals([media[2].media_type, media[2].children, media[2].caption], ['CAROUSEL', '4601,4602', 'كابشن\n\n#إبتكر']);
  assertEquals([media[3].media_type, media[3].caption], ['STORIES', undefined]);
});

Deno.test('9.5.5 due: a Facebook reel = start (video id), the MP4 by its signed link on rupload (OAuth), finish with the text; an Instagram reel = a REELS container with video_url then media_publish', async () => {
  const reel = (extra: Record<string, any> = {}) => post({ kind: 'ريل', images: [CID + '/vid-V1-mix-1.mp4', CID + '/gen-V1-s1-a.png'], ...extra });
  const stages: string[] = [];
  const { deps, db, graph } = setup({ posts: [reel(), reel({ id: 5002, piece: 'V1', platform: 'انستجرام' })], storage: { [`marketing/${CID}/vid-V1-mix-1.mp4`]: new Uint8Array([1]), [`marketing/${CID}/gen-V1-s1-a.png`]: new Uint8Array([1]) }, routes: {
    'POST 111/video_reels': (c) => { stages.push(db.row('mkt_posts', 5001).work?.stage ?? 'none'); return c.body.upload_phase === 'start' ? { body: { video_id: '9500', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/9500' } } : { body: { success: true, post_id: '111_9500' } }; },
    'POST /video-upload/v21.0/9500': { body: { success: true } }, // rupload keeps its own path (the fake strips graph's /v21.0/ prefix only)
    'POST 777/media': { body: { id: '4500' } }, 'GET 4500': { body: { status_code: 'FINISHED' } }, 'POST 777/media_publish': { body: { id: '17900' } }, 'GET 17900': { body: { permalink: 'https://www.instagram.com/reel/abc/' } },
  } });
  const r = await cron(deps, 'due');
  assertEquals(r.body, { result: 'ok', published: 2, failed: 0, waiting: 0 });
  assertEquals(stages, ['none', 'publishing']); // start before any stage; finish is the publishing call (a timeout there = «uncertain»)
  const up = graph.calls.find((c) => c.path === '/video-upload/v21.0/9500')!;
  assertEquals(up.auth, 'OAuth ' + PAGE.token);
  const fin = graph.calls.filter((c) => c.path === '111/video_reels')[1];
  assertEquals(fin.body, { upload_phase: 'finish', video_id: '9500', video_state: 'PUBLISHED', description: 'كابشن\n\n#إبتكر' });
  const fb = db.row('mkt_posts', 5001);
  assertEquals([fb.status, fb.external_id, fb.post_url, fb.work], ['اتنشر', '111_9500', 'https://www.facebook.com/reel/9500', null]);
  const ig = graph.calls.find((c) => c.path === '777/media')!;
  assertEquals([ig.body.media_type, ig.body.share_to_feed, ig.body.caption], ['REELS', 'true', 'كابشن\n\n#إبتكر']);
  assert(ig.body.video_url.startsWith('https://signed.test/marketing/' + CID + '/vid-V1-mix-1.mp4')); assertEquals(ig.body.image_url, undefined);
  assertEquals([db.row('mkt_posts', 5002).status, db.row('mkt_posts', 5002).external_id], ['اتنشر', '17900']);
  // a reel whose first file is not a video fails before any call
  const s2 = setup({ posts: [reel({ images: [CID + '/gen-V1-s1-a.png'] })] });
  await cron(s2.deps, 'due');
  assertEquals([s2.db.row('mkt_posts', 5001).status, s2.db.row('mkt_posts', 5001).error], ['فشل', 'video']); assertEquals(s2.graph.calls.length, 0);
});

Deno.test('the failures: Meta\'s refusal as our code, the bad row before any call, the timed-out last call «uncertain», no page / no Instagram', async () => {
  const s1 = setup({ posts: [post()], routes: { 'POST 111/photos': { status: 400, body: { error: { code: 190, message: 'expired' } } } } });
  await cron(s1.deps, 'due');
  assertEquals([s1.db.row('mkt_posts', 5001).status, s1.db.row('mkt_posts', 5001).error], ['فشل', 'token']);
  const s2 = setup({ posts: [post({ platform: 'انستجرام' })], routes: { 'POST 777/media': { status: 400, body: { error: { code: 9004, error_subcode: 2207052, message: 'fetch' } } } } });
  await cron(s2.deps, 'due');
  assertEquals(s2.db.row('mkt_posts', 5001).error, 'image');
  const s3 = setup({ posts: [post({ platform: 'انستجرام', images: [CID + '/p.png'] }), post({ id: 5002, piece: 'V1', kind: 'ريل' })] });
  await cron(s3.deps, 'due');
  assertEquals([s3.db.row('mkt_posts', 5001).error, s3.db.row('mkt_posts', 5002).error], ['images', 'video']); // 9.5.5: a reel without its MP4
  assertEquals(s3.graph.calls.length, 0, 'nothing reached Meta');
  const s4 = setup({ posts: [post()], routes: { 'POST 111/photos': () => timeout() } });
  await cron(s4.deps, 'due');
  assertEquals(s4.db.row('mkt_posts', 5001).error, 'uncertain');
  const s5 = setup({ posts: [post()], linked: false });
  await cron(s5.deps, 'due');
  assertEquals(s5.db.row('mkt_posts', 5001).error, 'not_linked');
  const s6 = setup({ posts: [post({ platform: 'انستجرام' })], linked: 'no_ig' });
  await cron(s6.deps, 'due');
  assertEquals(s6.db.row('mkt_posts', 5001).error, 'no_instagram');
  // a missing image in the bucket: no signed link → «images», nothing sent
  const s7 = setup({ posts: [post({ images: [CID + '/gone.jpg'] })] });
  await cron(s7.deps, 'due');
  assertEquals(s7.db.row('mkt_posts', 5001).error, 'images'); assertEquals(s7.graph.calls.length, 0);
});

Deno.test('publish_now: marketing.publish and the switch; a waiting or failed row published now (its day and hour now); busy / status / missing', async () => {
  const routes = { 'POST 111/photos': { body: { post_id: '111_9100' } }, 'GET 111_9100': { body: { permalink_url: 'https://www.facebook.com/111/posts/9100' } } };
  const { deps, db } = setup({ posts: [post({ day: '2026-11-20', time: '21:00', status: 'فشل', error: 'rate' }), post({ id: 5002, piece: 'P2', status: 'اتنشر' })], routes });
  assertEquals((await call(deps, { action: 'publish_now', id: 5001 }, 'jwt-view')).res.status, 401);
  const r = await call(deps, { action: 'publish_now', id: 5001 });
  assertEquals(r.res.status, 200); assertEquals(r.body, { result: 'ok', status: 'اتنشر', url: 'https://www.facebook.com/111/posts/9100' });
  const row = db.row('mkt_posts', 5001);
  assertEquals([row.status, row.error, row.day, row.time.length], ['اتنشر', null, '2026-10-25', 5]);
  assertEquals((await call(deps, { action: 'publish_now', id: 5002 })).body.error, 'status');
  assertEquals((await call(deps, { action: 'publish_now', id: 9999 })).res.status, 404);
  assert(db.rows('activity_log').some((l: any) => l.action === 'mkt.post.publish' && l.new_value === 'فيسبوك · بوست · ok' && l.actor === U.pub));
  // a row being published right now
  const s2 = setup({ posts: [post({ claimed_at: NOW })], routes });
  assertEquals((await call(s2.deps, { action: 'publish_now', id: 5001 })).body, { error: 'busy' });
  // the switch off
  const s3 = setup({ posts: [post()], routes, auto: false });
  assertEquals((await call(s3.deps, { action: 'publish_now', id: 5001 })).res.status, 409);
  // Meta refuses → 502 with the code, the row «فشل»
  const s4 = setup({ posts: [post()], routes: { 'POST 111/photos': { status: 400, body: { error: { code: 200, message: 'perm' } } } } });
  const r4 = await call(s4.deps, { action: 'publish_now', id: 5001 });
  assertEquals([r4.res.status, r4.body.error, s4.db.row('mkt_posts', 5001).status], [502, 'permission', 'فشل']);
});

Deno.test('delete: a live post removed on Meta then «اتحذف» (was_live); gone already counts; a refusal keeps it live', async () => {
  const live = (extra = {}) => post({ status: 'اتنشر', external_id: '111_9001', ...extra });
  const s1 = setup({ posts: [live()], routes: { 'DELETE 111_9001': { body: { success: true } } } });
  const r1 = await call(s1.deps, { action: 'delete', id: 5001 });
  assertEquals(r1.body, { result: 'ok', status: 'اتحذف' });
  const row = s1.db.row('mkt_posts', 5001);
  assertEquals([row.status, row.was_live, row.deleted_by], ['اتحذف', true, U.pub]);
  const s2 = setup({ posts: [live()], routes: { 'DELETE 111_9001': { status: 400, body: { error: { code: 100, error_subcode: 33, message: 'gone' } } } } });
  assertEquals((await call(s2.deps, { action: 'delete', id: 5001 })).body.status, 'اتحذف');
  const s3 = setup({ posts: [live()], routes: { 'DELETE 111_9001': { status: 400, body: { error: { code: 10, message: 'no' } } } } });
  const r3 = await call(s3.deps, { action: 'delete', id: 5001 });
  assertEquals([r3.res.status, r3.body.error, s3.db.row('mkt_posts', 5001).status], [502, 'permission', 'اتنشر']);
  const s4 = setup({ posts: [post()] });
  assertEquals((await call(s4.deps, { action: 'delete', id: 5001 })).body.error, 'status'); // not published
  assertEquals((await call(s4.deps, { action: 'delete', id: 5001 }, 'jwt-view')).res.status, 401);
});

Deno.test('stats: the platform\'s own posts (old enough, not known), the numbers in one call, a post gone from the platform', async () => {
  const known = post({ id: 5001, status: 'اتنشر', external_id: '111_9001', published_at: '2026-10-20T10:00:00.000Z' });
  const ig = post({ id: 5002, piece: 'P2', platform: 'انستجرام', status: 'اتنشر', external_id: '1801', published_at: '2026-10-21T10:00:00.000Z' });
  const gone = post({ id: 5003, piece: 'P3', status: 'اتنشر', external_id: '111_9002', published_at: '2026-10-22T10:00:00.000Z' });
  const { deps, db } = setup({ posts: [known, ig, gone], routes: {
    'GET 111/published_posts': { body: { data: [
      { id: '111_9001', message: 'من السيستم', created_time: '2026-10-20T10:00:00+0000' },
      { id: '111_9500', message: 'بوست من الصفحة\nسطر تاني', created_time: '2026-10-23T08:00:00+0000', permalink_url: 'https://www.facebook.com/111/posts/9500', full_picture: 'https://scontent.test/p.jpg', attachments: { data: [{ media_type: 'album' }] } },
      { id: '111_9600', message: 'لسه طازة', created_time: '2026-10-25T11:55:00+0000' },
    ] } },
    'GET 777/media': { body: { data: [{ id: '1890', caption: 'ريل', media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 'https://cdn.test/t.jpg', permalink: 'https://www.instagram.com/reel/x/', timestamp: '2026-10-22T09:00:00+0000' },
      { id: '1700', caption: 'قديم', media_type: 'IMAGE', media_url: 'https://cdn.test/old.jpg', timestamp: '2026-08-01T09:00:00+0000' }] } }, // older than 30 days: not taken
    'GET 111_9001': { body: { reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 5 } }, shares: { count: 3 } } },
    'GET 111_9001/insights': { body: { data: [{ name: 'post_media_view', values: [{ value: 1200 }] }, { name: 'post_total_media_view_unique', values: [{ value: 900 }] }] } },
    'GET 1801': { body: { like_count: 10, comments_count: 2 } },
    'GET 1801/insights': { body: { data: [{ name: 'views', values: [{ value: 700 }] }, { name: 'saved', values: [{ value: 4 }] }, { name: 'total_interactions', values: [{ value: 19 }] }] } },
    'GET 111_9002': { status: 400, body: { error: { code: 100, error_subcode: 33, message: 'gone' } } },
  } });
  const r = await cron(deps, 'stats');
  assertEquals([r.body.result, r.body.added, r.body.numbers, r.body.gone], ['ok', 2, 2, 1]);
  const platform = db.rows('mkt_posts').filter((x: any) => x.src === 'platform');
  assertEquals(platform.map((x: any) => [x.platform, x.external_id, x.kind, x.name, x.status]), [['فيسبوك', '111_9500', 'كاروسيل', 'بوست من الصفحة', 'اتنشر'], ['انستجرام', '1890', 'ريل', 'ريل', 'اتنشر']]);
  assertEquals([platform[0].day, platform[0].time, platform[0].thumb, platform[0].campaign_id], ['2026-10-23', '11:00', 'https://scontent.test/p.jpg', null]);
  const k = db.row('mkt_posts', 5001);
  assertEquals([k.views, k.reach, k.likes, k.comments, k.shares, k.saves, k.eng], [1200, 900, 40, 5, 3, null, 48]);
  const i = db.row('mkt_posts', 5002);
  assertEquals([i.views, i.likes, i.comments, i.saves, i.eng], [700, 10, 2, 4, 19]);
  assertEquals([db.row('mkt_posts', 5003).status, db.row('mkt_posts', 5003).was_live], ['اتحذف', true]);
  // a second run brings nothing back twice
  const r2 = await cron(deps, 'stats');
  assertEquals(r2.body.added, 0);
});

Deno.test('status: the link, the scopes through debug_token, the switch — publishing and numbers per platform, what is missing', async () => {
  const { deps, graph } = setup({ routes: { 'GET debug_token': { body: { data: { is_valid: true, scopes: ['pages_show_list', 'pages_manage_posts', 'read_insights', 'instagram_basic'] } } } } });
  const r = await call(deps, { action: 'status' }, 'jwt-view');
  assertEquals(r.body.autopublish, true);
  assertEquals(r.body.facebook, { linked: true, name: 'Ibtekr Club', publish: true, insights: true });
  assertEquals(r.body.instagram, { linked: true, name: '@ibtekr.club', publish: false, insights: false });
  assertEquals(r.body.missing, ['instagram_content_publish', 'instagram_manage_insights']);
  assertEquals(graph.calls[0].auth, 'Bearer 1234567890|app-secret-0123456789abcdef');
  assertFalse(JSON.stringify(r.body).includes(PAGE.token));
  assertEquals((await call(deps, { action: 'status' }, 'jwt-none')).res.status, 401);
  const s2 = setup({ linked: false });
  const r2 = await call(s2.deps, { action: 'status' }, 'jwt-view');
  assertEquals([r2.body.facebook.linked, r2.body.instagram.linked, r2.body.facebook.publish], [false, false, false]);
});

Deno.test('autopublish: the admin only; the settings row written (merged) and logged', async () => {
  const { deps, db } = setup({ auto: null });
  assertEquals((await call(deps, { action: 'autopublish', on: true }, 'jwt-pub')).res.status, 401);
  assertEquals((await call(deps, { action: 'autopublish', on: 'yes' }, 'jwt-admin')).res.status, 400);
  assertEquals((await call(deps, { action: 'autopublish', on: true }, 'jwt-admin')).body, { result: 'ok', autopublish: true });
  assertEquals(db.row('settings', 'marketing', 'section').data, { autopublish: true });
  assert(db.rows('activity_log').some((l: any) => l.action === 'mkt.autopublish' && l.new_value === 'on'));
  await call(deps, { action: 'autopublish', on: false }, 'jwt-admin');
  assertEquals(db.row('settings', 'marketing', 'section').data.autopublish, false);
});
