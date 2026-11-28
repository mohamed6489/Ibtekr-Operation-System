// mkt-publish: marketing's publishing to Facebook and Instagram — phase 9.5.2, decisions 29–39 of
// docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md. Deployed with verify_jwt false; it authenticates each request itself.
// The page and its Instagram account are customer service's link (Vault «meta_pages», cs-channel) — no link of its own.
//   POST { action } with X-Sync-Secret (the sync secret of 0008, the crons of 0051) and no Authorization:
//     due    → the master switch on (settings «marketing».autopublish) → the due rows claimed (mkt_publish_claim, 5 a run) and published.
//     stats  → the page's / the account's own posts of the last 30 days into the log («من المنصة مباشرة», src = platform — the system's
//              own known by their id) and the numbers of the posts published in the last 30 days (mkt_stats_put, one statement); a post
//              gone from the platform → «اتحذف» (was_live).
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status       (marketing.view) → { autopublish, facebook / instagram: { linked, name, publish, insights }, valid, missing } — the
//                  page token's scopes through debug_token (the app token); never a token or an id.
//     autopublish  (the admin) { on } → the switch written (settings «marketing») + activity_log mkt.autopublish.
//     publish_now  (marketing.publish F, the switch on) { id } → that row (مجدول / فشل) claimed and published now (its day and hour
//                  become now): 200 { status: اتنشر, url } · 202 { result: pending } (Instagram still preparing — the next run goes on)
//                  · 502 { error: <code> } (the row «فشل» with it) · 409 off / busy / status · 404.
//     delete       (marketing.publish F) { id } → a published row with its platform id: DELETE on Meta, then «اتحذف» (was_live);
//                  Meta saying it is gone already counts as done; a refusal = 502 { error } and the row stays «اتنشر».
//     due / stats  (the admin, by hand) as the crons.
//     trends_free  (marketing.view) { q?, days? } → the free trend sources read now (2026-11-28-trends-free.md): YouTube's videos and
//                  Shorts by views, Google Trends' rising searches in Egypt (SerpApi), the competitors' last Instagram posts (Business
//                  Discovery through the page link) → the new ones into mkt_trends as one batch; { rows, states, words, days, count, text }
//                  — a source not linked says not_linked (its key is added from «الربط بالمنصات»).
//     trends_daily (the cron mkt-trends-daily hourly with the sync secret — 0175; or the admin by hand) → the same on the admin's tags,
//                  once a day from DAILY_HOUR Cairo time (sync_state «trends_daily»); the bell says the new ones through the notify
//                  engine's «آخر التريندات» rules.
// Publishing (decisions 32–35): Facebook — a post = one photo published with its text; a carousel = hidden photos then one feed post
// with them attached; a story = a hidden photo then a photo story; a reel (9.5.5, decision 63) = video_reels start → the MP4 by its
// signed link on rupload → finish with the text. Instagram — a container (an image with its caption, a story, a REELS video, or the
// carousel's children then the carousel) waited for (FINISHED), then media_publish. The images reach Meta as signed links (15 minutes)
// of the private bucket «marketing». Before the last call the row's work.stage = publishing: a run that dies there leaves the row to
// mkt_publish_claim's «uncertain» (never published twice); a timeout on that call is «uncertain» too. A container still preparing is
// kept in work.container and the next run publishes it without uploading again.
// Errors are our codes (_shared/mkt-publish.js ourCode): token / permission / image / rate / gone / timeout / container / … — the
// page says them in words. Nothing here logs a token, a caption or a signed link.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { IG_FIELDS, igTrendRows, trendTags } from '../_shared/mkt-trends.js';
import {
  STATS_DAYS, body, cairoParts, connectionOf, containerState, fbStatsOf, graphErrorCode, idOf, igStatsOf, linkOf, ourCode, path, planOf, platformRowsOf, scopesOf,
} from '../_shared/mkt-publish.js';
import { pin, postPath } from '../_shared/meta-pin.js';
import { CACHE_HOURS, DAILY_HOUR, FREE_DAYS, GT_DAY_MAX, GT_MAX, YT_DAY_MAX, afterOf, answerText, bdRows, bdUrl, codeOf, competitorsOf, gtEmpty, gtRows, gtUrl, keywordsOf, mergeRows, parseFree, tagOf, ytIds, ytRows, ytSearchUrl, ytVideosUrl } from '../_shared/mkt-trends-free.js';
import { sourcesOf } from '../_shared/agent-sources.js';
import { vaultEnv } from '../_shared/secrets.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>;
};

const ACTIONS = ['status', 'autopublish', 'publish_now', 'delete', 'due', 'stats', 'trends_ig', 'trends_free', 'trends_daily'];
const GRAPH_MS = 20_000;
const SIGN_SECONDS = 900;
const VIDEO_SIGN_SECONDS = 3600; // a reel's video (decision 63): Meta fetches it while it processes
const POLL = { tries: 6, ms: 2_000 };
const DUE_BATCH = 5;
const STATS_BATCH = 40;
const PIN_BATCH = 12; // the meeting of 23 Nov phase 8 (0156): the pictures kept per run (each a CDN fetch + an upload)
const BUSY_MS = 5 * 60 * 1000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const appOf = (env: Deps['env']) => { const id = (env.META_APP_ID ?? '').trim(); const secret = (env.META_APP_SECRET ?? '').trim(); return /^\d{5,30}$/.test(id) && secret.length >= 16 ? { id, secret } : null; };
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);

// ---------------------------------------------------------------- Graph

class GraphError extends Error { constructor(public code: string, public status: number | null = null) { super(code); this.name = 'GraphError'; } }
async function graph(deps: Deps, method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string | null; body?: Json; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  let b: string | undefined;
  if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(opts.form).toString(); }
  else if (opts.body) { headers['content-type'] = 'application/json'; b = JSON.stringify(opts.body); }
  let res: Response;
  try { res = await f(url, { method, headers, body: b, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out), res.status);
  return isObj(out) ? out : {};
}

// ---------------------------------------------------------------- the page link (cs-channel's Vault secret) and the switch

type Page = { id: string; name: string; token: string; ig: { id: string; username: string | null } | null };
async function pageOf(deps: Deps): Promise<Page | null> {
  const { data, error } = await deps.db.rpc('cs_secret_get', { p_name: 'meta_pages' });
  if (error || typeof data !== 'string' || !data) return null;
  try { const j = JSON.parse(data); const p = isObj(j) && isObj(j.page) ? j.page : null; return p && typeof p.id === 'string' && typeof p.token === 'string' ? p as Page : null; } catch { return null; }
}
async function settingsOf(deps: Deps): Promise<Json> {
  const { data } = await deps.db.from('settings').select('section, data').eq('section', 'marketing').maybeSingle();
  return isObj(data) && isObj(data.data) ? data.data : {};
}
const autopublishOf = async (deps: Deps) => (await settingsOf(deps)).autopublish === true;

// ---------------------------------------------------------------- the members

type Who = { uid: string; admin: boolean; view: boolean; publish: boolean; create: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return error ? 'N' : String(data ?? 'N'); };
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  return { uid, admin, view: admin || (await perm('marketing.view')) !== 'N', publish: admin || (await perm('marketing.publish')) === 'F', create: admin || (await perm('marketing.create')) === 'F' };
}
async function logActivity(deps: Deps, who: Who, action: string, entityId: string, value: string | Json | null) {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: who.uid, action, entity: 'mkt_post', entity_id: entityId, new_value: value }); } catch { /* the log never blocks the action */ }
}
async function syncAllowed(deps: Deps, secret: string) {
  const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
  return !error && data === true;
}

// ---------------------------------------------------------------- publishing a row (decisions 32–35)

const setRow = async (deps: Deps, id: number, patch: Json) => { const { error } = await deps.db.from('mkt_posts').update(patch).eq('id', id); return error ?? null; };
async function signed(deps: Deps, paths: string[], seconds = SIGN_SECONDS): Promise<string[] | null> {
  const out: string[] = [];
  for (const p of paths) {
    const { data, error } = await deps.db.storage.from('marketing').createSignedUrl(p, seconds);
    if (error || !data || typeof data.signedUrl !== 'string') return null;
    out.push(data.signedUrl);
  }
  return out;
}
const pause = (deps: Deps, ms: number) => (deps.sleep ?? ((t: number) => new Promise((r) => setTimeout(r, t))))(ms);
async function waitContainer(deps: Deps, token: string, id: string): Promise<'ready' | 'wait' | 'failed'> {
  for (let i = 0; i < POLL.tries; i++) {
    const s = containerState(await graph(deps, 'GET', path.container(id), { token }));
    if (s !== 'wait') return s;
    if (i < POLL.tries - 1) await pause(deps, POLL.ms);
  }
  return 'wait';
}
type Result = { status: 'اتنشر' | 'فشل' | 'wait'; error?: string; url?: string | null; id?: string | null };
async function publishRow(deps: Deps, page: Page | null, row: Json, extra: Json = {}): Promise<Result> {
  const work: Json = isObj(row.work) ? { ...row.work } : {};
  const fail = async (code: string): Promise<Result> => { await setRow(deps, row.id, { status: 'فشل', error: code, work: null, claimed_at: null, updated_at: deps.now(), ...extra }); return { status: 'فشل', error: code }; };
  const save = async (patch: Json) => { Object.assign(work, patch); await setRow(deps, row.id, { work }); };
  const plan = planOf(row);
  if (plan.error) return await fail(plan.error);
  if (!page) return await fail('not_linked');
  if (plan.platform === 'instagram' && !page.ig) return await fail('no_instagram');
  const token = page.token;
  try {
    let externalId: string | null = null; let url: string | null = null;
    if (plan.platform === 'facebook' && plan.kind === 'reel') {
      // 9.5.5 decision 63: start (a video id + its upload slot) → the file by its signed link (rupload, OAuth) → finish with the text
      const urls = await signed(deps, [plan.video], VIDEO_SIGN_SECONDS); if (!urls) return await fail('video');
      let videoId = typeof work.video === 'string' && idOf(work.video) ? work.video as string : null;
      if (!videoId) {
        videoId = idOf((await graph(deps, 'POST', path.fbReels(page.id), { token, form: body.fbReelStart() })).video_id);
        if (!videoId) return await fail('video');
        await save({ stage: 'upload', video: videoId });
        const up = await graph(deps, 'POST', path.fbReelUpload(videoId), { headers: { authorization: 'OAuth ' + token, file_url: urls[0] } });
        if (up.success !== true) return await fail('video');
      }
      await save({ stage: 'publishing', video: videoId });
      const fin = await graph(deps, 'POST', path.fbReels(page.id), { token, form: body.fbReelFinish(videoId, plan.text) });
      externalId = idOf(fin.post_id) ?? videoId; url = path.fbReelLink(videoId);
    } else if (plan.platform === 'facebook') {
      const urls = await signed(deps, plan.images); if (!urls) return await fail('images');
      if (plan.kind === 'post') {
        await save({ stage: 'publishing' });
        const r = await graph(deps, 'POST', path.fbPhotos(page.id), { token, form: body.fbPhoto(urls[0], plan.text) });
        externalId = idOf(r.post_id) ?? idOf(r.id);
      } else if (plan.kind === 'carousel') {
        const ids: string[] = [];
        for (const u of urls) { const r = await graph(deps, 'POST', path.fbPhotos(page.id), { token, form: body.fbPhotoHidden(u) }); const id = idOf(r.id); if (!id) return await fail('images'); ids.push(id); }
        await save({ stage: 'publishing', photos: ids });
        externalId = idOf((await graph(deps, 'POST', path.fbFeed(page.id), { token, body: body.fbFeed(plan.text, ids) })).id);
      } else {
        const photo = idOf((await graph(deps, 'POST', path.fbPhotos(page.id), { token, form: body.fbStoryPhoto(urls[0]) })).id);
        if (!photo) return await fail('images');
        await save({ stage: 'publishing', photos: [photo] });
        const r = await graph(deps, 'POST', path.fbStory(page.id), { token, form: body.fbStory(photo) });
        externalId = idOf(r.post_id) ?? idOf(r.id);
      }
      if (externalId) { try { url = linkOf(await graph(deps, 'GET', path.fbLink(externalId), { token }), 'permalink_url'); } catch { /* the link is a nicety */ } }
    } else {
      const ig = page.ig!.id;
      let container = typeof work.container === 'string' && idOf(work.container) ? work.container as string : null;
      if (!container && plan.kind === 'reel') { // 9.5.5: the video by its signed link; the container takes its time (the next run publishes it)
        const urls = await signed(deps, [plan.video], VIDEO_SIGN_SECONDS); if (!urls) return await fail('video');
        container = idOf((await graph(deps, 'POST', path.igMedia(ig), { token, form: body.igReel(urls[0], plan.text) })).id);
        if (!container) return await fail('container');
        await save({ stage: 'container', container });
      } else if (!container) {
        const urls = await signed(deps, plan.images); if (!urls) return await fail('images');
        if (plan.kind === 'carousel') {
          const kids: string[] = [];
          for (const u of urls) { const id = idOf((await graph(deps, 'POST', path.igMedia(ig), { token, form: body.igChild(u) })).id); if (!id) return await fail('container'); kids.push(id); }
          for (const k of kids) { if ((await waitContainer(deps, token, k)) === 'failed') return await fail('container'); }
          container = idOf((await graph(deps, 'POST', path.igMedia(ig), { token, form: body.igCarousel(kids, plan.text) })).id);
        } else {
          container = idOf((await graph(deps, 'POST', path.igMedia(ig), { token, form: plan.kind === 'story' ? body.igStory(urls[0]) : body.igImage(urls[0], plan.text) })).id);
        }
        if (!container) return await fail('container');
        await save({ stage: 'container', container });
      }
      const st = await waitContainer(deps, token, container);
      if (st === 'failed') return await fail('container');
      if (st === 'wait') { await setRow(deps, row.id, { claimed_at: null, work, ...extra }); return { status: 'wait' }; } // the next run publishes it
      await save({ stage: 'publishing', container });
      externalId = idOf((await graph(deps, 'POST', path.igPublish(ig), { token, form: body.igPublish(container) })).id);
      if (externalId) { try { url = linkOf(await graph(deps, 'GET', path.igLink(externalId), { token }), 'permalink'); } catch { /* the link is a nicety */ } }
    }
    const done: Json = { status: 'اتنشر', external_id: externalId, post_url: url, published_at: deps.now(), error: null, work: null, claimed_at: null, updated_at: deps.now(), ...extra };
    const e = await setRow(deps, row.id, done);
    if (e && e.code === '23505') await setRow(deps, row.id, { ...done, external_id: null }); // the platform's pull had it first (its row stays)
    return { status: 'اتنشر', url, id: externalId };
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    // the last call timed out: it may be live — never published twice
    if (work.stage === 'publishing' && (e.code === 'graph_timeout' || e.code === 'graph_network')) return await fail('uncertain');
    return await fail(ourCode(e.code));
  }
}

// ---------------------------------------------------------------- the crons

async function due(deps: Deps): Promise<Response> {
  if (!(await autopublishOf(deps))) return json(200, { result: 'skipped', reason: 'off' });
  const page = await pageOf(deps);
  const { data, error } = await deps.db.rpc('mkt_publish_claim', { p_limit: DUE_BATCH });
  if (error) return json(500, { error: 'failed' });
  const s = { published: 0, failed: 0, waiting: 0 };
  for (const row of Array.isArray(data) ? data : []) {
    const r = await publishRow(deps, page, row);
    if (r.status === 'اتنشر') s.published++; else if (r.status === 'wait') s.waiting++; else s.failed++;
  }
  return json(200, { result: 'ok', ...s });
}

async function stats(deps: Deps): Promise<Response> {
  const page = await pageOf(deps);
  if (!page) return json(200, { result: 'skipped', reason: 'not_linked' });
  const nowMs = Date.parse(deps.now()); const token = page.token; const errors: string[] = [];
  const read = async (url: string) => { try { return await graph(deps, 'GET', url, { token }); } catch (e) { errors.push(e instanceof GraphError ? e.code : 'error'); return null; } };
  // 1. the platform's own posts (decision 37): the ones the log doesn't have yet (system or platform, any status — one removed from
  //    the log never comes back)
  const feed = await read(path.fbPosts(page.id, Math.floor(nowMs / 1000) - STATS_DAYS * 86400));
  const media = page.ig ? await read(path.igPosts(page.ig.id)) : null;
  const pulled = platformRowsOf(feed, media, nowMs);
  let added = 0;
  if (pulled.length) {
    const { data: had } = await deps.db.from('mkt_posts').select('platform, external_id').in('external_id', pulled.map((r) => r.external_id));
    const known = new Set((Array.isArray(had) ? had : []).map((r: Json) => r.platform + '|' + r.external_id));
    const fresh = pulled.filter((r) => !known.has(r.platform + '|' + r.external_id));
    if (fresh.length) { const { error } = await deps.db.from('mkt_posts').insert(fresh); if (error) errors.push('insert:' + (error.code ?? 'error')); else added = fresh.length; }
  }
  // 1b. the meeting of 23 Nov phase 8 (0156): Meta's picture links die in days — keep a copy of each platform post's picture in the
  //     bucket while its link is fresh (this run's feed), and for an older one ask Meta for its picture now; a few a run
  let pinned = 0; try { pinned = await pinPosts(deps, read, pulled); } catch (e) { errors.push('pin'); console.error('mkt-publish pin: ' + quiet(e)); }
  // 2. the numbers (decision 36): the published posts with an id of the last 30 days (a story: its 24 hours)
  const since = new Date(nowMs - STATS_DAYS * 86400_000).toISOString();
  const { data: live } = await deps.db.from('mkt_posts').select('id, platform, kind, external_id, published_at, stats_at').eq('status', 'اتنشر')
    .not('external_id', 'is', null).gte('published_at', since).order('stats_at', { ascending: true, nullsFirst: true }).limit(STATS_BATCH);
  const rows: Json[] = []; let gone = 0;
  for (const p of Array.isArray(live) ? live : []) {
    if (p.kind === 'ستوري' && nowMs - Date.parse(p.published_at) > 86400_000) continue;
    const ig = p.platform === 'انستجرام';
    let counts: Json | null = null;
    try { counts = await graph(deps, 'GET', ig ? path.igCounts(p.external_id) : path.fbCounts(p.external_id), { token }); }
    catch (e) {
      const code = e instanceof GraphError ? ourCode(e.code) : 'error';
      if (code === 'gone') { await setRow(deps, p.id, { status: 'اتحذف', was_live: true, deleted_at: deps.now(), updated_at: deps.now() }); gone++; continue; }
      errors.push(code); continue;
    }
    let insights: Json | null = null;
    try { insights = await graph(deps, 'GET', ig ? path.igInsights(p.external_id, p.kind === 'ستوري') : path.fbInsights(p.external_id), { token }); } catch { /* the counts alone */ }
    rows.push({ id: p.id, ...(ig ? igStatsOf(counts, insights) : fbStatsOf(counts, insights)) });
  }
  if (rows.length) { const { error } = await deps.db.rpc('mkt_stats_put', { p_rows: rows }); if (error) errors.push('stats:' + (error.code ?? 'error')); }
  return json(200, { result: 'ok', added, numbers: rows.length, gone, pinned, errors: [...new Set(errors)].slice(0, 5) });
}

// the platform's posts without a kept picture (the newest first): the link this run's feed gave (fresh), else the post's own picture
// read now (Facebook full_picture · Instagram the photo or the video's cover); the CDN link is refreshed on the row too
async function pinPosts(deps: Deps, read: (url: string) => Promise<Json | null>, pulled: Json[]): Promise<number> {
  const { data: want, error } = await deps.db.from('mkt_posts').select('id, platform, external_id, thumb').eq('src', 'platform').is('thumb_path', null)
    .is('deleted_at', null).not('external_id', 'is', null).order('published_at', { ascending: false }).limit(PIN_BATCH);
  if (error || !Array.isArray(want)) return 0; // 0156 not applied yet
  const fresh = new Map(pulled.map((r) => [r.platform + '|' + r.external_id, r.thumb]));
  let n = 0;
  for (const r of want) {
    const ig = r.platform === 'انستجرام';
    let link: string | null = fresh.get(r.platform + '|' + r.external_id) ?? null;
    if (!link) {
      const one = await read(ig ? path.igPic(r.external_id) : path.fbPic(r.external_id));
      link = isObj(one) ? (ig ? (one.media_type === 'VIDEO' ? one.thumbnail_url : one.media_url ?? one.thumbnail_url) : one.full_picture) ?? null : null;
    }
    if (typeof link !== 'string') continue;
    const kept = await pin(deps.db, 'marketing', deps.fetch ?? fetch, link, (mime: string) => postPath(r.platform, r.external_id, mime));
    const patch: Json = kept ? { thumb_path: kept, thumb: link } : link !== r.thumb ? { thumb: link } : {};
    if (Object.keys(patch).length) { await deps.db.from('mkt_posts').update(patch).eq('id', r.id); if (kept) n += 1; }
  }
  return n;
}

// ---------------------------------------------------------------- the designer's trends from Instagram's hashtags (ش39)

// The admin's tags (settings «marketing».trends.tags, 0118) through Instagram's official hashtag search with the page link's own
// Instagram account: each tag's most liked posts now → mkt_trends (one row per post — a post met again is skipped), their picture's
// CDN link kept for ai-images `trend_thumbs` (thumb_src, the server's only). Without Meta's «Instagram Public Content Access» the
// first call is refused: 200 { result: 'unavailable', code } and nothing is written. Read only — nothing is posted.
const IG_TAG_PAUSE = new Set(['permission', 'token', 'rate']);
async function trendsIg(deps: Deps, who: Who): Promise<Response> {
  if (!who.create) return json(401, { error: 'unauthorized' });
  if ((await deps.db.from('mkt_trends').select('id, platform').limit(1)).error) return json(503, { error: 'not_ready' }); // 0118
  const set = await settingsOf(deps);
  const tags = trendTags(isObj(set.trends) ? set.trends.tags : null);
  if (!tags.length) return json(200, { result: 'no_tags', count: 0 });
  const page = await pageOf(deps);
  if (!page || !page.ig || !/^\d{1,30}$/.test(String(page.ig.id))) return json(200, { result: 'not_linked', count: 0 });
  const ig = String(page.ig.id); const rows: Json[] = []; const skipped: Json[] = [];
  for (const tag of tags) {
    try {
      const found = await graph(deps, 'GET', path.igHashtag(ig, tag), { token: page.token });
      const hid = Array.isArray(found.data) && isObj(found.data[0]) ? String(found.data[0].id ?? '') : '';
      if (!/^\d{3,40}$/.test(hid)) { skipped.push({ tag, code: 'no_hashtag' }); continue; }
      const top = await graph(deps, 'GET', path.igTopMedia(hid, ig, IG_FIELDS), { token: page.token });
      rows.push(...igTrendRows(top.data, tag));
    } catch (e) {
      const code = ourCode(e instanceof GraphError ? e.code : 'failed');
      if (!rows.length && !skipped.length && IG_TAG_PAUSE.has(code)) return json(200, { result: 'unavailable', code, count: 0 }); // the feature, the token, the limit
      skipped.push({ tag, code });
      if (IG_TAG_PAUSE.has(code)) break; // no use asking the next tags
    }
  }
  const seen = new Set<string>(); const fresh = rows.filter((r) => { const k = r.external_id; if (seen.has(k)) return false; seen.add(k); return true; });
  let count = 0;
  if (fresh.length) {
    const batch = crypto.randomUUID(); const at = deps.now();
    const { data, error } = await deps.db.from('mkt_trends').upsert(fresh.map((r) => ({ ...r, batch, found_at: at, created_by: who.uid })), { onConflict: 'platform,external_id', ignoreDuplicates: true }).select('id');
    if (error) return json(500, { error: 'failed' });
    count = Array.isArray(data) ? data.length : 0;
  }
  await logActivity(deps, who, 'mkt.trends.ig', 'trends', { tags: tags.length, count, skipped: skipped.length });
  return json(200, { result: 'ok', count, found: fresh.length, skipped: skipped.slice(0, 30) });
}

// ---------------------------------------------------------------- the trends from the free sources (2026-11-28-trends-free.md)

// YouTube (its Google Cloud key), Google Trends (SerpApi's key) and the competitors' Instagram posts (Business Discovery through the
// page link above) — each read only, each skipped while it is not linked; the keys come from «الربط بالمنصات» (Vault, vaultEnv) and
// never leave this function. A keyword asked lately is answered from what is stored (sync_state «trends_free»: YouTube and Instagram
// for CACHE_HOURS, Google Trends once a day — the free plan's 250 a month). The new rows go to mkt_trends as one batch: the notify
// engine's «آخر التريندات» rules (ai › designer / buyer › trends) say them in the bell under the assistants.
const TREND_COLS = 'id, title, summary, source, url, kind, platform, external_id, tag, author, views, likes, comments, posted_at, thumb, found_at';
const GT_HOURS = 20;
type FreeOut = { rows: Json[]; states: Record<string, string>; kws: string[]; days: number; count: number };
async function freeGet(deps: Deps, url: string, headers: Record<string, string>): Promise<{ status: number; body: Json | null }> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  try {
    const res = await f(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, signal: ctl.signal, redirect: 'manual' });
    let b: unknown = null; try { b = await res.json(); } catch { b = null; }
    return { status: res.status, body: isObj(b) ? b : null };
  } catch { return { status: 0, body: null }; } finally { clearTimeout(timer); }
}
const listOf = (r: { data?: unknown }) => (Array.isArray(r.data) ? r.data as Json[] : []);
async function readFree(deps: Deps, req: { q: string; days: number }, uid: string | null): Promise<FreeOut> {
  const env = await vaultEnv(deps.db, deps.env);
  const yt = String(env.YOUTUBE_API_KEY ?? '').trim(); const serp = String(env.SERPAPI_API_KEY ?? '').trim();
  const set = await settingsOf(deps); const kws = keywordsOf(req.q, isObj(set.trends) ? set.trends.tags : null);
  const at = deps.now(); const nowMs = Date.parse(at); const sinceMs = nowMs - req.days * 86400_000; const since = new Date(sinceMs).toISOString(); const day = cairoParts(nowMs).day;
  const { data: cst } = await deps.db.from('sync_state').select('value').eq('key', 'trends_free').maybeSingle();
  const last: Record<string, string> = isObj(cst) && isObj(cst.value) && isObj(cst.value.last) ? { ...cst.value.last } : {};
  // the day's searches so far (Cairo's day) — the free plans' caps, whatever the members ask
  const use0 = isObj(cst) && isObj(cst.value) && isObj(cst.value.use) && cst.value.use.day === day ? cst.value.use : null;
  const use = { day, yt: Number(use0?.yt) || 0, gt: Number(use0?.gt) || 0 };
  const fresh = (k: string, hours: number) => typeof last[k] === 'string' && nowMs - Date.parse(last[k]) < hours * 3600_000;
  const states: Record<string, string> = {}; const lists: Json[][] = []; const stored: Json[] = [];
  const fromTable = async (q: Db) => { stored.push(...listOf(await q.limit(40))); };
  // YouTube: each keyword's most viewed videos of the window, then their numbers in one call
  if (!yt) states.youtube = 'not_linked';
  else if (!kws.length) states.youtube = 'no_words';
  else {
    const kwOf = new Map<string, string>(); let code: string | null = null; let asked = 0;
    for (const kw of kws) {
      if (fresh('yt:' + kw, CACHE_HOURS)) { const t = tagOf(kw); if (t) await fromTable(deps.db.from('mkt_trends').select(TREND_COLS).eq('platform', 'youtube').eq('tag', t).gte('posted_at', since).order('views', { ascending: false })); continue; }
      if (use.yt >= YT_DAY_MAX) { code = 'quota'; break; }
      use.yt += 1;
      const s = await freeGet(deps, ytSearchUrl(kw, afterOf(at, req.days)), { 'x-goog-api-key': yt });
      if (s.status !== 200) { code = codeOf(s.status); if (code === 'unauthorized' || code === 'quota') break; continue; }
      asked += 1; last['yt:' + kw] = at;
      for (const id of ytIds(s.body)) if (!kwOf.has(id)) kwOf.set(id, kw);
    }
    const ids = [...kwOf.keys()].slice(0, 50);
    if (ids.length) { const v = await freeGet(deps, ytVideosUrl(ids), { 'x-goog-api-key': yt }); if (v.status === 200) lists.push(ytRows(v.body, kwOf, sinceMs)); else code = codeOf(v.status); }
    states.youtube = asked || stored.length || !code ? 'ok' : code;
  }
  // Google Trends through SerpApi: the first GT_MAX keywords, each once a day
  if (!serp) states.google = 'not_linked';
  else if (!kws.length) states.google = 'no_words';
  else {
    let code: string | null = null; let ok = 0;
    for (const kw of kws.slice(0, GT_MAX)) {
      const t = tagOf(kw);
      if (fresh('gt:' + kw, GT_HOURS)) { ok += 1; if (t) await fromTable(deps.db.from('mkt_trends').select(TREND_COLS).eq('platform', 'google').eq('tag', t).like('external_id', 'gt-' + cairoParts(Date.parse(last['gt:' + kw])).day + '-%')); continue; }
      if (use.gt >= GT_DAY_MAX) { code = 'quota'; break; }
      use.gt += 1;
      const r = await freeGet(deps, gtUrl(kw, serp, req.days), {});
      if (r.status === 200 && r.body && typeof r.body.error !== 'string') { lists.push(gtRows(r.body, kw, day, req.days)); ok += 1; last['gt:' + kw] = at; }
      else if (r.status === 200 && gtEmpty(r.body)) { ok += 1; last['gt:' + kw] = at; }
      else { code = codeOf(r.status === 200 ? 400 : r.status); if (code === 'unauthorized' || code === 'quota') break; }
    }
    states.google = ok || !code ? 'ok' : code;
  }
  // the competitors on Instagram: the accounts among the designer's and the media buyer's sources and the competitors' list
  const { data: aiRow } = await deps.db.from('settings').select('data').eq('section', 'ai').maybeSingle();
  const ai = isObj(aiRow) && isObj(aiRow.data) ? aiRow.data : {};
  const { data: comps } = await deps.db.from('mkt_competitors').select('name, page_url').is('archived_at', null).limit(100);
  const rivals = competitorsOf([...sourcesOf(ai, 'designer'), ...sourcesOf(ai, 'buyer')], Array.isArray(comps) ? comps : []);
  const page = rivals.length ? await pageOf(deps) : null;
  if (!rivals.length) states.instagram = 'none';
  else if (!page || !page.ig || !/^\d{1,30}$/.test(String(page.ig.id))) states.instagram = 'not_linked';
  else {
    let code: string | null = null; let ok = 0;
    for (const w of rivals) {
      if (fresh('ig:' + w.username, CACHE_HOURS)) { ok += 1; await fromTable(deps.db.from('mkt_trends').select(TREND_COLS).eq('platform', 'instagram').eq('author', '@' + w.username).gte('posted_at', since)); continue; }
      try { lists.push(bdRows(await graph(deps, 'GET', bdUrl(String(page.ig.id), w.username), { token: page.token }), w, sinceMs)); ok += 1; last['ig:' + w.username] = at; }
      catch (e) { code = ourCode(e instanceof GraphError ? e.code : 'failed'); if (IG_TAG_PAUSE.has(code)) break; }
    }
    states.instagram = ok ? 'ok' : code ?? 'failed';
  }
  await deps.db.from('sync_state').upsert({ key: 'trends_free', value: { last, use }, updated_at: at }, { onConflict: 'key' });
  const merged = mergeRows(lists, 60); let count = 0;
  if (merged.length) {
    const batch = crypto.randomUUID();
    const { data } = await deps.db.from('mkt_trends').upsert(merged.map((r) => ({ ...r, batch, found_at: at, created_by: uid })), { onConflict: 'platform,external_id', ignoreDuplicates: true }).select('id');
    count = Array.isArray(data) ? data.length : 0;
  }
  // the rows as stored (their id and picture) in the run's order, then the ones answered from the table
  const ids = [...new Set(merged.map((r) => String(r.external_id)))];
  const got = ids.length ? listOf(await deps.db.from('mkt_trends').select(TREND_COLS).in('external_id', ids).limit(200)) : [];
  const byKey = new Map(got.concat(stored).map((r) => [r.platform + ':' + r.external_id, r] as [string, Json]));
  const order = merged.map((r) => r.platform + ':' + r.external_id).concat(stored.map((r) => r.platform + ':' + r.external_id));
  const rows = mergeRows([[...new Set(order)].map((k) => byKey.get(k)).filter(Boolean) as Json[]], 60);
  return { rows, states, kws, days: req.days, count };
}

// trends_free (marketing.view): the chat's «آخر التريندات» and the trends card's refresh — the rows found and each source's state
async function trendsFree(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const p = parseFree(args); if ('error' in p) return json(400, p);
  if ((await deps.db.from('mkt_trends').select('id, platform').limit(1)).error) return json(503, { error: 'not_ready' }); // 0118
  const out = await readFree(deps, p.req, who.uid);
  await logActivity(deps, who, 'mkt.trends.free', 'trends', { days: out.days, words: out.kws.length, count: out.count, found: out.rows.length, ...out.states });
  return json(200, { result: 'ok', rows: out.rows, states: out.states, words: out.kws, days: out.days, count: out.count, text: answerText(out.rows, out.states, out.days, out.kws) });
}

// trends_daily (the cron hourly, or the admin by hand): once a day from DAILY_HOUR Cairo time, on the admin's tags and the competitors
async function trendsDaily(deps: Deps, byHand: Who | null): Promise<Response> {
  if ((await deps.db.from('mkt_trends').select('id, platform').limit(1)).error) return json(503, { error: 'not_ready' });
  const p = cairoParts(Date.parse(deps.now()));
  if (!byHand && Number(p.time.slice(0, 2)) < DAILY_HOUR) return json(200, { result: 'skipped', reason: 'hour' });
  const { data: st } = await deps.db.from('sync_state').select('value').eq('key', 'trends_daily').maybeSingle();
  if (!byHand && isObj(st) && isObj(st.value) && st.value.day === p.day) return json(200, { result: 'skipped', reason: 'done' });
  const out = await readFree(deps, { q: '', days: FREE_DAYS }, byHand ? byHand.uid : null);
  await deps.db.from('sync_state').upsert({ key: 'trends_daily', value: { day: p.day, at: deps.now(), count: out.count, found: out.rows.length, states: out.states }, updated_at: deps.now() }, { onConflict: 'key' });
  return json(200, { result: 'ok', day: p.day, count: out.count, found: out.rows.length, states: out.states });
}

// ---------------------------------------------------------------- the members' actions

async function status(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const page = await pageOf(deps); const auto = await autopublishOf(deps); const app = appOf(deps.env);
  let scopes = null;
  if (page && app) { try { scopes = scopesOf(await graph(deps, 'GET', path.debugToken(page.token), { token: app.id + '|' + app.secret })); } catch { scopes = null; } }
  return json(200, { result: 'ok', ...connectionOf(page, scopes, auto), configured: !!app });
}

async function setAutopublish(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  if (typeof args.on !== 'boolean') return json(400, { error: 'bad_request', field: 'on' });
  const data = { ...(await settingsOf(deps)), autopublish: args.on };
  const { error } = await deps.db.from('settings').upsert({ section: 'marketing', data, updated_at: deps.now(), updated_by: who.uid }, { onConflict: 'section' });
  if (error) return json(500, { error: 'failed' });
  await logActivity(deps, who, 'mkt.autopublish', 'marketing', args.on ? 'on' : 'off');
  return json(200, { result: 'ok', autopublish: args.on });
}

const idArg = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN; return Number.isSafeInteger(n) && n > 0 ? n : null; };
const busy = (row: Json, nowMs: number) => row.claimed_at != null && nowMs - Date.parse(row.claimed_at) < BUSY_MS;

async function publishNow(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.publish) return json(401, { error: 'unauthorized' });
  const id = idArg(args.id); if (!id) return json(400, { error: 'bad_request', field: 'id' });
  if (!(await autopublishOf(deps))) return json(409, { error: 'off' });
  const { data, error } = await deps.db.rpc('mkt_publish_claim', { p_limit: 1, p_id: id });
  if (error) return json(500, { error: 'failed' });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    const { data: r } = await deps.db.from('mkt_posts').select('id, status, src, claimed_at').eq('id', id).maybeSingle();
    if (!r) return json(404, { error: 'not_found' });
    return json(409, { error: r.src === 'system' && (r.status === 'مجدول' || r.status === 'فشل') && busy(r, Date.parse(deps.now())) ? 'busy' : 'status' });
  }
  const now = cairoParts(Date.parse(deps.now()));
  const r = await publishRow(deps, await pageOf(deps), row, { day: now.day, time: now.time });
  await logActivity(deps, who, 'mkt.post.publish', String(id), [row.platform, row.kind, r.status === 'اتنشر' ? 'ok' : r.status === 'wait' ? 'pending' : r.error].join(' · '));
  if (r.status === 'اتنشر') return json(200, { result: 'ok', status: 'اتنشر', url: r.url ?? null });
  if (r.status === 'wait') return json(202, { result: 'pending' });
  return json(502, { error: r.error });
}

async function deleteLive(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.publish) return json(401, { error: 'unauthorized' });
  const id = idArg(args.id); if (!id) return json(400, { error: 'bad_request', field: 'id' });
  const { data: row } = await deps.db.from('mkt_posts').select('id, status, platform, external_id, claimed_at').eq('id', id).maybeSingle();
  if (!row) return json(404, { error: 'not_found' });
  if (row.status !== 'اتنشر' || !row.external_id || !['فيسبوك', 'انستجرام'].includes(row.platform)) return json(409, { error: 'status' });
  if (busy(row, Date.parse(deps.now()))) return json(409, { error: 'busy' });
  const page = await pageOf(deps); if (!page) return json(503, { error: 'not_linked' });
  let code: string | null = null;
  try { await graph(deps, 'DELETE', path.object(row.external_id), { token: page.token }); }
  catch (e) { if (!(e instanceof GraphError)) throw e; code = ourCode(e.code); }
  if (code && code !== 'gone') { await logActivity(deps, who, 'mkt.post.delete_live', String(id), row.platform + ' · ' + code); return json(502, { error: code }); }
  const e = await setRow(deps, id, { status: 'اتحذف', was_live: true, deleted_at: deps.now(), deleted_by: who.uid, updated_by: who.uid, updated_at: deps.now() });
  if (e) return json(500, { error: 'failed' });
  await logActivity(deps, who, 'mkt.post.delete_live', String(id), row.platform + ' · ' + (code ?? 'ok'));
  return json(200, { result: 'ok', status: 'اتحذف' });
}

// ---------------------------------------------------------------- the handler

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let parsed: unknown;
  try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {};
  const action = typeof args.action === 'string' ? args.action : '';
  // the crons: the sync secret of 0008, `due` and `stats` only — never a member's action
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if ((action !== 'due' && action !== 'stats' && action !== 'trends_daily') || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return action === 'due' ? await due(deps) : action === 'stats' ? await stats(deps) : await trendsDaily(deps, null); }
    catch (e) { console.error('mkt-publish ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'status') return await status(deps, who);
    if (action === 'autopublish') return await setAutopublish(deps, who, args);
    if (action === 'publish_now') return await publishNow(deps, who, args);
    if (action === 'delete') return await deleteLive(deps, who, args);
    if (action === 'trends_ig') return await trendsIg(deps, who);
    if (action === 'trends_free') return await trendsFree(deps, who, args);
    if (!who.admin) return json(401, { error: 'unauthorized' }); // due / stats / trends_daily by hand: the admin
    return action === 'due' ? await due(deps) : action === 'stats' ? await stats(deps) : await trendsDaily(deps, who);
  } catch (e) {
    console.error('mkt-publish ' + action + ': ' + quiet(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
