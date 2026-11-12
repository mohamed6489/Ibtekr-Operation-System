// mkt-ads: the ad platforms' own numbers, read-only — phase 9.5.3 (decisions 43 / 48), 9.5.4 (49–52) and 9.5.6 (67–72) of
// docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md. Deployed with verify_jwt false; it authenticates each request itself.
// Nothing here writes on TikTok or Google; on Meta only a decision the admin approved while the switch is on (9.5.4).
//   POST { action: 'sync' } with X-Sync-Secret (the sync secret of 0008, the cron mkt-ads-sync of 0052) and no Authorization:
//     every linked platform (Meta / TikTok / Google), each on its own: the account (name, currency, status), its campaigns and ads
//     and the daily numbers per campaign and per ad of the last 3 days (90 on the first run) → mkt_ad_objects / mkt_ad_stats.
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status (marketing.view) → { platforms: { meta | tiktok | google: { configured, fields (a secret as its last four), account,
//              synced_at, error, … } }, redirect } (+ Meta's old top-level fields).
//     sync   (the admin) { days?, platform? } → the run now (1–400 days) + activity_log mkt.ads.sync (the platform and counts only).
//     9.5.6 — the links from the page (the admin): link_set { platform, fields } (into Vault through mkt_secret_set — never a
//              Supabase secret, never echoed), link_start { platform } → the platform's OAuth url (a state kept ten minutes in
//              cs_oauth_states), link_callback { code, state } → the code exchanged, the account(s) read (one = linked, several =
//              choose), link_pick { platform, account }, unlink { platform }.
//     9.5.4 — rules / rules_set / live / decide / report as before; a decision on a TikTok or Google suggestion is recorded only
//              (the execution is Meta's).
// Secrets: the links live in Vault (mkt_secret_get / mkt_secret_set, service_role); Meta's owner secrets META_ADS_TOKEN /
// META_AD_ACCOUNT_ID remain the fallback. A failed run keeps the last numbers and the last success and says our code (token /
// permission / rate / timeout / graph_N / tiktok_N / google_N) on the platform's account row; the page says it in words.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { CHUNK_DAYS, FIRST_DAYS, MAX_DAYS, MAX_PAGES, SUGGEST_DAYS, SYNC_DAYS, accountDaily, accountOf, accountRowOf, budgetPlan, buyerRules, nextOf, objectRowOf, path, reportText, rulesPatch, statRowOf, suggestionKey, suggestionsOf, windowChunks, windowOf } from '../_shared/mkt-ads.js';
import { LINK_FIELDS, PLATFORMS, linkAccount, linkPublic, linkReady, oauthReady, parseLink, platformOf } from '../_shared/mkt-ads-link.js';
import { ttAccountRowOf, ttAdvertisersOf, ttAnswer, ttBody, ttList, ttObjectRowOf, ttPages, ttPath, ttStatRowOf, ttTokenOf } from '../_shared/mkt-ads-tiktok.js';
import { gAccountRowOf, gBody, gCode, gCustomersOf, gNextPage, gObjectRowOf, gPath, gResults, gStatRowOf, gText, gTokenOf, gVersion, gaql, G_MAX_PAGES } from '../_shared/mkt-ads-google.js';
import { cairoParts } from '../_shared/mkt-publish.js';
import { graphErrorCode } from '../_shared/cs-channel.js';
import { ourCode } from '../_shared/mkt-publish.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch;
};
type Link = Record<string, string>;

const ACTIONS = ['status', 'sync', 'rules', 'rules_set', 'live', 'decide', 'link_set', 'link_start', 'link_callback', 'link_pick', 'unlink'];
const CRON_ACTIONS = ['sync', 'report'];
const GRAPH_MS = 30_000;
const CHUNK = 500;
const STATE_MINUTES = 10;
const REDIRECT_DEFAULT = 'https://operation-system.ibtekr.club/ads-callback.html';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const redirectUri = (env: Deps['env']) => (env.ADS_REDIRECT_URL ?? '').trim() || REDIRECT_DEFAULT;
const randomText = (bytes = 32) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
// Meta's owner secrets (9.5.3) — the fallback when the page wrote no Meta link
const configOf = (env: Deps['env']) => {
  const token = (env.META_ADS_TOKEN ?? '').trim(); const account = accountOf(env.META_AD_ACCOUNT_ID);
  return token.length >= 20 && account ? { token, account } : null;
};

// ---------------------------------------------------------------- the calls (Meta GET / POST, TikTok GET, Google POST)

// code: our code or Meta's graph_<n>; text: the platform's own words of the refusal (letters, digits and plain punctuation, 200
// characters) — never a token, shown to the admin
class GraphError extends Error { constructor(public code: string, public text: string | null = null) { super(code); this.name = 'GraphError'; } }
const graphText = (out: unknown) => { const m = isObj(out) && isObj(out.error) ? out.error.message : null; return typeof m === 'string' ? m.replace(/[^\w .,:;()#'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null; };
async function send(deps: Deps, method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: string): Promise<{ status: number; ok: boolean; out: unknown }> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  let res: Response;
  try { res = await f(url, { method, headers: { accept: 'application/json', ...headers }, body, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  return { status: res.status, ok: res.ok, out };
}
async function get(deps: Deps, url: string, token: string): Promise<Json> {
  const r = await send(deps, 'GET', url, { authorization: 'Bearer ' + token });
  if (!r.ok) throw new GraphError(graphErrorCode(r.out), graphText(r.out));
  return isObj(r.out) ? r.out : {};
}
// a write on an object's own node (a decision): form fields, the token in the header
async function post(deps: Deps, url: string, token: string, form: Record<string, string>): Promise<Json> {
  const r = await send(deps, 'POST', url, { authorization: 'Bearer ' + token, 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams(form).toString());
  if (!r.ok) throw new GraphError(graphErrorCode(r.out), graphText(r.out));
  return isObj(r.out) ? r.out : {};
}
// a list with its pages (Meta's own next links), MAX_PAGES at most
async function list(deps: Deps, url: string, token: string): Promise<Json[]> {
  const out: Json[] = []; let next: string | null = url;
  for (let i = 0; next && i < MAX_PAGES; i += 1) {
    const page = await get(deps, next, token);
    if (Array.isArray(page.data)) out.push(...page.data.filter(isObj));
    next = nextOf(page);
  }
  return out;
}
// TikTok: the token in the Access-Token header; the envelope { code, message, data } (200 even on a refusal)
type TtAnswer = { ok: boolean; data?: Json; code?: string; text?: string | null };
async function ttGet(deps: Deps, url: string, token: string): Promise<Json> {
  const r = await send(deps, 'GET', url, { 'Access-Token': token });
  const a = ttAnswer(r.out) as TtAnswer;
  if (!a.ok) throw new GraphError(a.code ?? 'tiktok_error', a.text ?? null);
  return a.data ?? {};
}
async function ttPost(deps: Deps, url: string, body: Json, token?: string): Promise<Json> {
  const r = await send(deps, 'POST', url, { 'content-type': 'application/json', ...(token ? { 'Access-Token': token } : {}) }, JSON.stringify(body));
  const a = ttAnswer(r.out) as TtAnswer;
  if (!a.ok) throw new GraphError(a.code ?? 'tiktok_error', a.text ?? null);
  return a.data ?? {};
}
// every page of a TikTok list (campaign/get, ad/get, report)
async function ttAll(deps: Deps, urlOf: (page: number) => string, token: string): Promise<Json[]> {
  const first = await ttGet(deps, urlOf(1), token); const out = ttList(first); const pages = ttPages(first);
  for (let p = 2; p <= pages; p += 1) out.push(...ttList(await ttGet(deps, urlOf(p), token)));
  return out;
}
// Google: an access token minted from the refresh token (kept in memory only), then googleAds:search with its pages
async function gAccess(deps: Deps, link: Link): Promise<string> {
  const r = await send(deps, 'POST', gPath.token(), { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams(gBody.refresh(link.refresh_token, link.client_id, link.client_secret)).toString());
  const t = gTokenOf(r.out);
  if (!r.ok || !t.access) throw new GraphError(r.ok ? 'token' : gCode(r.status, r.out), gText(r.out));
  return t.access;
}
const gHeaders = (link: Link, access: string) => ({ authorization: 'Bearer ' + access, 'developer-token': link.developer_token, 'content-type': 'application/json', ...(link.login_customer_id ? { 'login-customer-id': link.login_customer_id } : {}) });
async function gSearch(deps: Deps, link: Link, access: string, customer: string, query: string): Promise<Json[]> {
  const out: Json[] = []; let token: string | null = null;
  for (let i = 0; i < G_MAX_PAGES; i += 1) {
    const r = await send(deps, 'POST', gPath.search(link.version, customer), gHeaders(link, access), JSON.stringify(gBody.query(query, token)));
    if (!r.ok) throw new GraphError(gCode(r.status, r.out), gText(r.out));
    out.push(...gResults(r.out)); token = gNextPage(r.out);
    if (!token) break;
  }
  return out;
}

// ---------------------------------------------------------------- the links (9.5.6, decision 67): Vault through mkt_secret_*

async function secretGet(deps: Deps, name: string): Promise<Json | null> {
  const { data, error } = await deps.db.rpc('mkt_secret_get', { p_name: name });
  if (error || typeof data !== 'string' || !data) return null;
  try { const j = JSON.parse(data); return isObj(j) ? j : null; } catch { return null; }
}
async function secretSet(deps: Deps, name: string, value: Json | null) {
  const { error } = await deps.db.rpc('mkt_secret_set', { p_name: name, p_value: value ? JSON.stringify(value) : null });
  if (error) throw new GraphError(error.code === '0A000' ? 'no_vault' : 'vault', null);
}
// the stored link of a platform (the page's); Meta falls back to the owner's secrets when the page wrote none that can run
async function storedLink(deps: Deps, platform: string): Promise<Link> {
  const v = await secretGet(deps, 'ads_' + platform); const link: Link = {};
  if (v) for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && x && k in (LINK_FIELDS as Json)[platform]) link[k] = x;
  return link;
}
async function linkOf(deps: Deps, platform: string): Promise<Link> {
  const link = await storedLink(deps, platform);
  if (platform === 'meta' && !linkReady('meta', link)) { const cfg = configOf(deps.env); if (cfg) return { access_token: cfg.token, account_id: cfg.account }; }
  return link;
}
// the non-secret side of a link (settings «marketing».ads.<platform>: the account's name, linked_at, the candidates while the admin picks)
async function marketingSettings(deps: Deps): Promise<Json> {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'marketing').maybeSingle();
  return isObj(data) && isObj(data.data) ? data.data : {};
}
async function adsSettings(deps: Deps): Promise<Json> { const s = await marketingSettings(deps); return isObj(s.ads) ? s.ads : {}; }
async function adsSettingsWrite(deps: Deps, platform: string, patch: Json | null, at: string) {
  const cur = await marketingSettings(deps); const ads = isObj(cur.ads) ? { ...cur.ads } : {};
  if (patch === null) delete ads[platform]; else ads[platform] = { ...(isObj(ads[platform]) ? ads[platform] : {}), ...patch };
  const { error } = await deps.db.from('settings').upsert({ section: 'marketing', data: { ...cur, ads }, updated_at: at }, { onConflict: 'section' });
  if (error) throw new Error('db settings ' + (error.code ?? ''));
}

// ---------------------------------------------------------------- the members

type Who = { uid: string; admin: boolean; view: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  let view = admin;
  if (!view) { const { data, error } = await member.rpc('has_perm', { key: 'marketing.view' }); view = !error && String(data ?? 'N') !== 'N'; }
  return { uid, admin, view };
}
async function syncAllowed(deps: Deps, secret: string) {
  const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
  return !error && data === true;
}
const log = async (deps: Deps, uid: string | null, action: string, entityId: string, value: string) => {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: uid, action, entity: 'mkt_ads', entity_id: entityId, new_value: value.slice(0, 200) }); } catch { /* the log never blocks */ }
};

// ---------------------------------------------------------------- the run (decisions 43 / 69): a platform at a time

async function accountRow(deps: Deps, platform: string, id: string): Promise<Json | null> {
  const { data } = await deps.db.from('mkt_ad_objects').select('platform, kind, id, name, status, meta').eq('platform', platform).eq('kind', 'account').eq('id', id).maybeSingle();
  return isObj(data) ? data : null;
}
async function upsertAll(deps: Deps, table: string, rows: Json[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await deps.db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error('db ' + table + ' ' + (error.code ?? ''));
  }
}
type Fetched = { acct: Json | null; objects: (Json | null)[]; stats: (Json | null)[] };
// Meta: the account, campaigns, ads, the insights a week at a time (a long range over every ad is too much data for Meta)
async function fetchMeta(deps: Deps, link: Link, w: { since: string; until: string }): Promise<Fetched> {
  const token = link.access_token; const a = link.account_id;
  const acct = await get(deps, path.account(a), token);
  const camps = await list(deps, path.campaigns(a), token);
  const ads = await list(deps, path.ads(a), token);
  const cStats: Json[] = []; const aStats: Json[] = [];
  for (const ch of windowChunks(w.since, w.until, CHUNK_DAYS)) {
    cStats.push(...await list(deps, path.insights(a, 'campaign', ch.since, ch.until), token));
    aStats.push(...await list(deps, path.insights(a, 'ad', ch.since, ch.until), token));
  }
  return { acct, objects: [...camps.map((c) => objectRowOf('campaign', c, a)), ...ads.map((x) => objectRowOf('ad', x, null))], stats: [...cStats.map((x) => statRowOf(x, 'campaign')), ...aStats.map((x) => statRowOf(x, 'ad'))] };
}
// TikTok: the advertiser, campaigns, ads, the integrated report per campaign and per ad by day
async function fetchTiktok(deps: Deps, link: Link, w: { since: string; until: string }): Promise<Fetched> {
  const token = link.access_token; const adv = link.advertiser_id;
  const info = (ttList(await ttGet(deps, ttPath.info([adv]), token)) as Json[]).find((x: Json) => String(x.advertiser_id) === adv) ?? null;
  const camps = await ttAll(deps, (p) => ttPath.campaigns(adv, p), token);
  const ads = await ttAll(deps, (p) => ttPath.ads(adv, p), token);
  const cStats = await ttAll(deps, (p) => ttPath.report(adv, 'campaign', w.since, w.until, p), token);
  const aStats = await ttAll(deps, (p) => ttPath.report(adv, 'ad', w.since, w.until, p), token);
  return { acct: info, objects: [...camps.map((c) => ttObjectRowOf('campaign', c)), ...ads.map((x) => ttObjectRowOf('ad', x))], stats: [...cStats.map((x) => ttStatRowOf(x, 'campaign')), ...aStats.map((x) => ttStatRowOf(x, 'ad'))] };
}
// Google: an access token, then GAQL for the customer, campaigns, ads and the day rows per campaign and per ad
async function fetchGoogle(deps: Deps, link: Link, w: { since: string; until: string }): Promise<Fetched> {
  const access = await gAccess(deps, link); const cid = link.customer_id;
  const acct = (await gSearch(deps, link, access, cid, gaql.account()))[0] ?? null;
  const camps = await gSearch(deps, link, access, cid, gaql.campaigns());
  const ads = await gSearch(deps, link, access, cid, gaql.ads());
  const cStats = await gSearch(deps, link, access, cid, gaql.campaignStats(w.since, w.until));
  const aStats = await gSearch(deps, link, access, cid, gaql.adStats(w.since, w.until));
  return { acct, objects: [...camps.map((c) => gObjectRowOf('campaign', c)), ...ads.map((x) => gObjectRowOf('ad', x))], stats: [...cStats.map((x) => gStatRowOf(x, 'campaign')), ...aStats.map((x) => gStatRowOf(x, 'ad'))] };
}
const FETCH: Record<string, (deps: Deps, link: Link, w: { since: string; until: string }) => Promise<Fetched>> = { meta: fetchMeta, tiktok: fetchTiktok, google: fetchGoogle };
const accountRowFor = (platform: string, id: string, acct: Json | null, at: string, error: string | null, prev: Json | null) =>
  platform === 'tiktok' ? ttAccountRowOf(id, acct, at, error, prev) : platform === 'google' ? gAccountRowOf(id, acct, at, error, prev) : accountRowOf(id, acct, at, error, prev);
// one platform's run → its counts, or { error, text } (the failure on its account row, the last success kept)
async function runPlatform(deps: Deps, platform: string, link: Link, daysArg: number | null): Promise<Json> {
  const id = String(linkAccount(platform, link)); const at = deps.now(); const nowMs = Date.parse(at); const prev = await accountRow(deps, platform, id);
  let days = daysArg;
  if (!days) { const { data } = await deps.db.from('mkt_ad_stats').select('day').eq('platform', platform).limit(1); days = Array.isArray(data) && data.length ? SYNC_DAYS : FIRST_DAYS; }
  const w = windowOf(nowMs, days);
  try {
    const f = await FETCH[platform](deps, link, w);
    // one row a key (a page or a chunk answering a row twice would make the upsert refuse the whole batch — 21000)
    const unique = (rows: (Json | null)[], key: (r: Json) => string): Json[] => [...new Map(rows.filter(isObj).map((r): [string, Json] => [key(r), { ...r, updated_at: at }])).values()];
    const objects = unique(f.objects, (r) => r.platform + '|' + r.kind + '|' + r.id);
    const stats = unique(f.stats, (r) => r.platform + '|' + r.level + '|' + r.object_id + '|' + r.day);
    await upsertAll(deps, 'mkt_ad_objects', objects, 'platform,kind,id');
    await upsertAll(deps, 'mkt_ad_stats', stats, 'platform,level,object_id,day');
    await upsertAll(deps, 'mkt_ad_objects', [{ ...accountRowFor(platform, id, f.acct, at, null, prev), updated_at: at }], 'platform,kind,id'); // last: the success mark
    let suggestions = 0;
    try { suggestions = await suggest(deps, platform, link, at); } catch (e) { console.error('mkt-ads suggest ' + platform + ': ' + quiet(e)); }
    return { platform, days: w.days, since: w.since, until: w.until, campaigns: objects.filter((o) => o.kind === 'campaign').length, ads: objects.filter((o) => o.kind === 'ad').length, stats: stats.length, suggestions };
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    const row: Json = accountRowFor(platform, id, null, at, code, prev); row.meta = { ...row.meta, error_text: e.text };
    await upsertAll(deps, 'mkt_ad_objects', [{ ...row, updated_at: at }], 'platform,kind,id');
    return { platform, error: code, text: e.text };
  }
}
// every linked platform (or the one asked): the counts summed at the top, each platform's own under `platforms`; no platform
// linked → 503; the one asked (or the only one) failing → 502 with its code
async function run(deps: Deps, daysArg: number | null, only: string | null): Promise<Response> {
  const out: Json = {}; const ran: Json[] = [];
  for (const p of PLATFORMS) {
    if (only && only !== p) continue;
    const link = await linkOf(deps, p);
    if (!linkReady(p, link)) { out[p] = { skipped: 'not_configured' }; continue; }
    const r = await runPlatform(deps, p, link, daysArg); out[p] = r; ran.push(r);
  }
  if (!ran.length) return json(503, { error: 'not_configured', configured: false });
  const failed = ran.filter((r) => r.error); const ok = ran.filter((r) => !r.error);
  if (!ok.length) { const f = failed[0]; return json(502, { error: f.error, text: f.text ?? null, platform: f.platform, platforms: out }); }
  const sum = (k: string) => ok.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return json(200, { result: 'ok', days: ok[0].days, since: ok[0].since, until: ok[0].until, campaigns: sum('campaigns'), ads: sum('ads'), stats: sum('stats'), suggestions: sum('suggestions'), platforms: out });
}

// ---------------------------------------------------------------- 9.5.4: the media buyer (decisions 49–52)

// the rules as the server reads them: settings «marketing».buyer over the defaults
async function rulesOf(deps: Deps) { const s = await marketingSettings(deps); return buyerRules(s.buyer); }
async function rulesWrite(deps: Deps, patch: Json, at: string) {
  const cur = await marketingSettings(deps); const buyer = { ...(isObj(cur.buyer) ? cur.buyer : {}), ...patch };
  const { error } = await deps.db.from('settings').upsert({ section: 'marketing', data: { ...cur, buyer }, updated_at: at }, { onConflict: 'section' });
  if (error) throw new Error('db settings ' + (error.code ?? ''));
  return buyerRules(buyer);
}
// the Woo ad orders of the last days for the rules: { day, campaign, sold, confirmed, sales } (the order's own total — the lines are the
// report's); platform null = every ad platform
async function adOrdersSince(deps: Deps, sinceDay: string, platform: string | null): Promise<Json[]> {
  let q = deps.db.from('orders').select('utm_campaign, placed_at, status, confirm, total, deleted_at, ad_platform').gte('placed_at', sinceDay + 'T00:00:00+02:00').limit(5000);
  q = platform ? q.eq('ad_platform', platform) : q.not('ad_platform', 'is', null);
  const { data } = await q;
  return (Array.isArray(data) ? data : []).filter((o: Json) => isObj(o) && !o.deleted_at && typeof o.utm_campaign === 'string').map((o: Json) => {
    const sold = !['ملغي', 'استرجاع', 'فشل'].includes(String(o.status));
    // confirmed by the team (a deposit or not) or already completed — the orders a budget raise may count
    const confirmed = sold && (String(o.confirm).startsWith('مؤكد') || o.status === 'مكتمل');
    return { day: cairoParts(Date.parse(o.placed_at)).day, campaign: o.utm_campaign, sold, confirmed, sales: Number(o.total) || 0, platform: o.ad_platform };
  });
}
// after a platform's sync: the suggestions of today — the open ones kept (their numbers refreshed) or expired, the new ones inserted;
// autoStop «auto» acts at once on Meta only (decision 70)
async function suggest(deps: Deps, platform: string, link: Link, at: string): Promise<number> {
  const today = cairoParts(Date.parse(at)).day; const since = windowOf(Date.parse(at), SUGGEST_DAYS * 2).since;
  const [{ data: objects }, { data: stats }, orders, rules, { data: open }] = await Promise.all([
    deps.db.from('mkt_ad_objects').select('kind, id, name, status, meta').eq('platform', platform).limit(5000),
    deps.db.from('mkt_ad_stats').select('level, object_id, campaign_id, day, spend, impressions, clicks, link_clicks, frequency, purchases, purchase_value').eq('platform', platform).gte('day', since).limit(20000),
    adOrdersSince(deps, since, platform), rulesOf(deps),
    deps.db.from('mkt_suggestions').select('id, kind, campaign_id, ad_id').eq('platform', platform).eq('status', 'pending').limit(1000),
  ]);
  const wanted = suggestionsOf({ objects: objects ?? [], stats: stats ?? [], orders, today, rules });
  const have = new Map((Array.isArray(open) ? open : []).map((r: Json) => [suggestionKey(r), r]));
  const fresh: Json[] = [];
  for (const s of wanted) {
    const row = have.get(suggestionKey(s));
    if (row) { have.delete(suggestionKey(s)); await deps.db.from('mkt_suggestions').update({ sub: s.sub, why: s.why, impact: s.impact, pct: s.pct, data: s.data, campaign_name: s.campaign_name, checked_at: at }).eq('id', row.id); }
    else fresh.push({ ...s, platform, status: 'pending', created_at: at, checked_at: at });
  }
  if (have.size) await deps.db.from('mkt_suggestions').update({ status: 'expired', checked_at: at }).in('id', [...have.values()].map((r: Json) => r.id));
  const { data: inserted, error } = fresh.length ? await deps.db.from('mkt_suggestions').insert(fresh).select('id, kind, campaign_id, campaign_name') : { data: [], error: null };
  if (error) throw new Error('db mkt_suggestions ' + (error.code ?? ''));
  // autoStop «auto» (the owner's own rule): a new stop is carried out now and the bell told — only with the switch on, only on Meta
  if (platform === 'meta' && rules.autoStopMode === 'auto' && rules.live) {
    for (const s of (Array.isArray(inserted) ? inserted : []).filter((r: Json) => r.kind === 'stop')) {
      try {
        await post(deps, path.node(s.campaign_id), link.access_token, { status: 'PAUSED' });
        await deps.db.from('mkt_suggestions').update({ status: 'done', decided_at: at, note: 'تلقائي', result: { status: 'PAUSED', auto: true } }).eq('id', s.id);
        await deps.db.from('alerts').insert(['admin', 'ops'].map((role) => ({ at, kind: 'marketing', title: 'الميديا باير وقّف «' + (s.campaign_name ?? s.campaign_id) + '»', body: 'صرفت ' + rules.autoStop + ' ج.م أو أكتر من غير أوردر — اتوقفت تلقائي بقاعدتك. تقدر تشغّلها تاني من مدير إعلانات ميتا.', role_id: role, entity: 'marketing-ai', entity_id: String(s.id) })));
        await log(deps, null, 'mkt.buyer.decide', String(s.id), 'stop · auto · ' + s.campaign_id + ' · ok');
      } catch (e) {
        const code = e instanceof GraphError ? ourCode(e.code) : 'failed';
        await deps.db.from('mkt_suggestions').update({ status: 'failed', decided_at: at, note: 'تلقائي', error: code }).eq('id', s.id);
        await log(deps, null, 'mkt.buyer.decide', String(s.id), 'stop · auto · ' + s.campaign_id + ' · ' + code);
      }
    }
  }
  return wanted.length;
}
async function rulesGet(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  return json(200, { rules: await rulesOf(deps) });
}
async function rulesSet(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const p = rulesPatch(args.rules);
  if ('error' in p) return json(400, { error: 'bad_request', field: p.error });
  const rules = await rulesWrite(deps, p.patch, deps.now());
  await log(deps, who.uid, 'mkt.buyer.rules', 'buyer', Object.keys(p.patch).join(', '));
  return json(200, { rules });
}
async function liveSet(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  if (typeof args.on !== 'boolean') return json(400, { error: 'bad_request', field: 'on' });
  const rules = await rulesWrite(deps, { live: args.on }, deps.now());
  await log(deps, who.uid, 'mkt.buyer.live', 'buyer', args.on ? 'on' : 'off');
  return json(200, { rules });
}
// the admin's decision on a suggestion (decision 50); on TikTok / Google (decision 70) the money kinds are recorded only
async function decide(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const id = Number(args.id); const decision = args.decision;
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request', field: 'id' });
  if (!['approve', 'edit', 'reject'].includes(decision)) return json(400, { error: 'bad_request', field: 'decision' });
  const { data: s } = await deps.db.from('mkt_suggestions').select('id, platform, kind, campaign_id, campaign_name, ad_id, title, pct, data, status').eq('id', id).maybeSingle();
  if (!isObj(s)) return json(404, { error: 'not_found' });
  if (s.status !== 'pending') return json(409, { error: 'decided' });
  const platform = platformOf(s.platform) ?? 'meta';
  const at = deps.now(); const note = typeof args.note === 'string' ? args.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || null : null;
  const base = { decided_by: who.uid, decided_at: at, note };
  if (decision === 'reject') {
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'rejected' }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · reject · ' + s.campaign_id);
    return json(200, { result: 'ok', status: 'rejected' });
  }
  let pct: number | null = null;
  if (s.kind === 'budget_up' || s.kind === 'budget_down') {
    pct = decision === 'edit' ? Number(args.value) : Number(s.pct);
    if (!Number.isFinite(pct) || !Number.isInteger(pct) || pct === 0 || Math.sign(pct) !== Math.sign(Number(s.pct))) return json(400, { error: 'bad_request', field: 'value' });
  } else if (decision === 'edit') return json(400, { error: 'bad_request', field: 'decision' });
  const status = decision === 'edit' ? 'edited' : 'approved';
  // the ones with no money: a designer request / reviewed
  if (s.kind === 'creative') {
    // 0082 (the owner 12 Nov): the request is a team request (ticket) to the designer's role — «طلبات الفريق» works it, التسويق lists it
    const ad = (s.title ?? '').replace(/^إعلان «|» الناس زهقت منه$/g, '');
    const { data: ticket, error } = await deps.db.rpc('ticket_request_server', { p_kind: 'design', p_project: s.campaign_name ?? null, p_title: 'نسخة جديدة لإعلان «' + ad + '»', p_desc: 'الميديا باير: ' + (s.title ?? '') + (note ? ' — ' + note : ''), p_by: who.uid });
    if (error) return json(500, { error: 'failed' });
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', result: { request: true, ticket: ticket ?? null } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), 'creative · approve · ' + s.campaign_id + ' · request');
    return json(200, { result: 'ok', status: 'done', request: true, ticket: ticket ?? null });
  }
  if (s.kind === 'tracking') {
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', result: { reviewed: true } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), 'tracking · approve · ' + s.campaign_id);
    return json(200, { result: 'ok', status: 'done' });
  }
  // money: stop / budget — Meta only, and the switch first
  const rules = await rulesOf(deps); const link = await linkOf(deps, 'meta'); const cfg = platform === 'meta' && linkReady('meta', link) ? { token: link.access_token, account: link.account_id } : null;
  if (platform !== 'meta' || !rules.live || !cfg) {
    const why = platform !== 'meta' ? 'manual' : 'live_off';
    await deps.db.from('mkt_suggestions').update({ ...base, status, value: pct, result: { live: false, platform, ...(platform !== 'meta' ? { manual: true } : {}) } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ' + why);
    return json(200, { result: 'ok', status, live: false, platform });
  }
  try {
    let result: Json;
    if (s.kind === 'stop') {
      await post(deps, path.node(s.campaign_id), cfg.token, { status: 'PAUSED' });
      result = { status: 'PAUSED' };
    } else {
      const [camp, adsets, allCamps, allAdsets] = await Promise.all([
        get(deps, path.node(s.campaign_id) + '?fields=' + encodeURIComponent('id,daily_budget,lifetime_budget,effective_status'), cfg.token),
        list(deps, path.campaignAdsets(s.campaign_id), cfg.token),
        list(deps, path.campaigns(cfg.account), cfg.token), list(deps, path.accountAdsets(cfg.account), cfg.token)]);
      const plan = budgetPlan({ campaign: camp, adsets }, pct, rules, accountDaily(allCamps, allAdsets, s.campaign_id));
      if ('error' in plan) {
        await deps.db.from('mkt_suggestions').update({ ...base, status: 'failed', value: pct, error: plan.error, result: plan }).eq('id', id);
        await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ' + plan.error);
        return json(409, { error: plan.error, max: plan.max ?? null, cap: plan.cap ?? null, after: plan.after ?? null });
      }
      for (const u of plan.updates) await post(deps, path.node(u.id), cfg.token, { daily_budget: String(u.daily_budget) });
      result = { pct, before: plan.before, after: plan.after, updates: plan.updates.length };
    }
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', value: pct, result }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ok');
    return json(200, { ...result, result: 'ok', status: 'done' }); // the stored result (before / after / updates) beside ours
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'failed', value: pct, error: code, result: { text: e.text } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ' + code);
    return json(502, { error: code, text: e.text });
  }
}
// the daily report (decision 52): once a day at the rule's Cairo hour, to the bell of the admin and ops roles — every platform's spend
async function report(deps: Deps): Promise<Response> {
  const at = deps.now(); const nowMs = Date.parse(at); const p = cairoParts(nowMs); const rules = await rulesOf(deps);
  if (Number(p.time.slice(0, 2)) !== rules.reportHour) return json(200, { result: 'skipped', reason: 'hour' });
  const { data: sent } = await deps.db.from('alerts').select('id').eq('kind', 'marketing').eq('entity', 'marketing-ai').eq('entity_id', 'report:' + p.day).limit(1);
  if (Array.isArray(sent) && sent.length) return json(200, { result: 'skipped', reason: 'sent' });
  const y = cairoParts(nowMs - 86400_000).day;
  const [{ data: st }, orders, { data: pending }] = await Promise.all([
    deps.db.from('mkt_ad_stats').select('spend').eq('level', 'campaign').eq('day', y).limit(5000),
    adOrdersSince(deps, y, null), deps.db.from('mkt_suggestions').select('id').eq('status', 'pending').limit(1000)]);
  const spend = (Array.isArray(st) ? st : []).reduce((s: number, r: Json) => s + (Number(r.spend) || 0), 0);
  const sold = orders.filter((o) => o.day === y && o.sold);
  const t = reportText({ day: y, spend, orders: sold.length, sales: sold.reduce((s, o) => s + o.sales, 0), pending: Array.isArray(pending) ? pending.length : 0 });
  const { error } = await deps.db.from('alerts').insert(['admin', 'ops'].map((role) => ({ at, kind: 'marketing', title: t.title, body: t.body, role_id: role, entity: 'marketing-ai', entity_id: 'report:' + p.day })));
  if (error) throw new Error('db alerts ' + (error.code ?? ''));
  return json(200, { result: 'ok', day: y });
}

// ---------------------------------------------------------------- the status and the links (decisions 67 / 68 / 71)

// one platform as the page sees it: never a secret (a tail), the account row's name / currency / status and last run
async function platformView(deps: Deps, platform: string, link: Link, settings: Json): Promise<Json> {
  const pub = linkPublic(platform, link)!; const acc = linkAccount(platform, link); const s = isObj(settings[platform]) ? settings[platform] : {};
  const row = acc ? await accountRow(deps, platform, String(acc)) : null; const m = row && isObj(row.meta) ? row.meta : {};
  return { configured: pub.ready, oauth: pub.oauth, fields: pub.fields, missing: pub.missing,
    account: row ? { id: acc, name: row.name ?? null, currency: m.currency ?? null, status: row.status ?? null } : acc ? { id: acc, name: s.name ?? null, currency: null, status: null } : null,
    synced_at: m.synced_at ?? null, checked_at: m.checked_at ?? null, error: m.error ?? null, text: m.error ? m.error_text ?? null : null,
    linked_at: s.linked_at ?? null, candidates: Array.isArray(s.candidates) ? s.candidates : null, ...(platform === 'google' ? { version: gVersion(link.version) } : {}) };
}
async function status(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const settings = await adsSettings(deps); const platforms: Json = {};
  for (const p of PLATFORMS) platforms[p] = await platformView(deps, p, await linkOf(deps, p), settings);
  const meta = platforms.meta; // Meta's old top-level fields stay for the page before 9.5.6
  return json(200, { configured: meta.configured, account: meta.account, synced_at: meta.synced_at, checked_at: meta.checked_at, error: meta.error, text: meta.text, platforms, redirect: redirectUri(deps.env) });
}
async function syncByHand(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const d = args.days == null ? null : Number(args.days);
  if (d != null && !(Number.isInteger(d) && d >= 1 && d <= MAX_DAYS)) return json(400, { error: 'bad_request', field: 'days' });
  const only = args.platform == null ? null : platformOf(args.platform);
  if (args.platform != null && !only) return json(400, { error: 'bad_request', field: 'platform' });
  const res = await run(deps, d, only);
  const b = await res.clone().json().catch(() => ({}));
  const value = res.ok ? [b.days, b.campaigns, b.ads, b.stats].join(' · ') : String(b.error ?? res.status);
  await log(deps, who.uid, 'mkt.ads.sync', only ?? 'all', value);
  return res;
}
// the admin writes a platform's fields (decision 67): the stored link under them, into Vault; the view back (tails only)
async function linkSet(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const platform = platformOf(args.platform); if (!platform) return json(400, { error: 'bad_request', field: 'platform' });
  const current = await storedLink(deps, platform);
  const p = parseLink(platform, args.fields, current) as { link?: Link; error?: string };
  if (p.error || !p.link) return json(400, { error: 'bad_request', field: p.error ?? 'fields' });
  const at = deps.now();
  try { await secretSet(deps, 'ads_' + platform, Object.keys(p.link).length ? p.link : null); } catch (e) { return json(503, { error: e instanceof GraphError ? e.code : 'failed' }); }
  const given = isObj(args.fields) ? Object.keys(args.fields).filter((k) => k in (LINK_FIELDS as Json)[platform]) : [];
  await adsSettingsWrite(deps, platform, { linked_at: at, linked_by: who.uid, candidates: null }, at);
  await log(deps, who.uid, 'mkt.ads.link', platform, 'set · ' + given.join(', '));
  return json(200, { result: 'ok', platform, ...(await platformView(deps, platform, await linkOf(deps, platform), await adsSettings(deps))) });
}
async function unlink(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const platform = platformOf(args.platform); if (!platform) return json(400, { error: 'bad_request', field: 'platform' });
  const at = deps.now();
  try { await secretSet(deps, 'ads_' + platform, null); } catch (e) { return json(503, { error: e instanceof GraphError ? e.code : 'failed' }); }
  await adsSettingsWrite(deps, platform, null, at);
  await log(deps, who.uid, 'mkt.ads.link', platform, 'unlink');
  return json(200, { result: 'ok', platform, ...(await platformView(deps, platform, await linkOf(deps, platform), {})) });
}
// the OAuth start (decision 68): the app / client the admin wrote → the platform's sign-in url with a state of ours
async function linkStart(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const platform = platformOf(args.platform); if (!platform || platform === 'meta') return json(400, { error: 'bad_request', field: 'platform' });
  const link = await storedLink(deps, platform);
  if (!oauthReady(platform, link)) return json(400, { error: 'bad_request', field: 'oauth' });
  const state = randomText();
  const { error } = await deps.db.from('cs_oauth_states').insert({ state, verifier: randomText(48), channel: 'ads_' + platform, created_by: who.uid, created_at: deps.now() });
  if (error) return json(500, { error: 'failed' });
  const url = platform === 'tiktok' ? ttPath.auth(link.app_id, redirectUri(deps.env), state) : gPath.auth(link.client_id, redirectUri(deps.env), state);
  return json(200, { result: 'ok', platform, url });
}
// the code back from the platform: spent state, the token(s) into the link, the account(s) read — one = linked, several = choose
async function linkCallback(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const code = typeof args.code === 'string' && /^[A-Za-z0-9._~%/+=-]{8,4096}$/.test(args.code) ? args.code : null;
  const state = typeof args.state === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(args.state) ? args.state : null;
  if (!code) return json(400, { error: 'bad_request', field: 'code' });
  if (!state) return json(400, { error: 'bad_request', field: 'state' });
  const { data: found } = await deps.db.from('cs_oauth_states').select('state, channel, created_at, used_at').eq('state', state).maybeSingle();
  const row = isObj(found) ? { channel: String(found.channel ?? ''), createdAt: String(found.created_at ?? ''), used: !!found.used_at } : null;
  if (row && !row.used) await deps.db.from('cs_oauth_states').update({ used_at: deps.now() }).eq('state', state); // spent, whatever follows
  const platform = row ? platformOf(row.channel.replace(/^ads_/, '')) : null;
  if (!row || row.used || !platform || platform === 'meta' || Date.parse(deps.now()) - Date.parse(row.createdAt) > STATE_MINUTES * 60_000) return json(400, { error: 'bad_request', field: 'state' });
  const link = await storedLink(deps, platform);
  if (!oauthReady(platform, link)) return json(400, { error: 'bad_request', field: 'oauth' });
  const at = deps.now();
  try {
    let accounts: { id: string; name: string | null }[] = [];
    if (platform === 'tiktok') {
      const t = ttTokenOf(await ttPost(deps, ttPath.token(), ttBody.token(link.app_id, link.secret, code)));
      if (!t) throw new GraphError('no_token');
      link.access_token = t.token;
      let named: { id: string; name: string | null }[] = [];
      try { named = ttAdvertisersOf(await ttGet(deps, ttPath.advertisers(link.app_id, link.secret), t.token)); } catch { named = []; }
      accounts = (t.advertisers.length ? t.advertisers : named.map((a) => a.id)).map((id: string) => ({ id, name: named.find((a) => a.id === id)?.name ?? null }));
    } else {
      const r = await send(deps, 'POST', gPath.token(), { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams(gBody.token(code, link.client_id, link.client_secret, redirectUri(deps.env))).toString());
      const t = gTokenOf(r.out);
      if (!r.ok || !t.access) throw new GraphError(r.ok ? 'token' : gCode(r.status, r.out), gText(r.out));
      if (!t.refresh) throw new GraphError('no_refresh_token', 'Google gave no refresh token - remove the app from the Google account (myaccount.google.com) and link again');
      link.refresh_token = t.refresh;
      const a = await send(deps, 'GET', gPath.accessible(link.version), { authorization: 'Bearer ' + t.access, 'developer-token': link.developer_token });
      if (!a.ok) throw new GraphError(gCode(a.status, a.out), gText(a.out));
      accounts = (gCustomersOf(a.out) as string[]).map((id: string) => ({ id, name: null }));
    }
    if (!accounts.length) throw new GraphError('no_account');
    const key = platform === 'tiktok' ? 'advertiser_id' : 'customer_id';
    if (accounts.length === 1) { link[key] = accounts[0].id; await secretSet(deps, 'ads_' + platform, link); await adsSettingsWrite(deps, platform, { linked_at: at, linked_by: who.uid, name: accounts[0].name, candidates: null }, at); }
    else { delete link[key]; await secretSet(deps, 'ads_' + platform, link); await adsSettingsWrite(deps, platform, { linked_at: at, linked_by: who.uid, candidates: accounts }, at); }
    await log(deps, who.uid, 'mkt.ads.link', platform, 'oauth · ' + accounts.length);
    const view = await platformView(deps, platform, await linkOf(deps, platform), await adsSettings(deps));
    return json(200, accounts.length === 1 ? { result: 'ok', linked: true, platform, ...view } : { result: 'choose', linked: false, platform, accounts, ...view });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    await log(deps, who.uid, 'mkt.ads.link', platform, 'oauth · ' + code);
    return json(502, { error: code, text: e.text, platform });
  }
}
// the admin picks one of the accounts the sign-in offered
async function linkPick(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const platform = platformOf(args.platform); if (!platform || platform === 'meta') return json(400, { error: 'bad_request', field: 'platform' });
  const id = typeof args.account === 'string' && /^[0-9]{1,30}$/.test(args.account) ? args.account : null; if (!id) return json(400, { error: 'bad_request', field: 'account' });
  const settings = await adsSettings(deps); const s = isObj(settings[platform]) ? settings[platform] : {};
  const cand = Array.isArray(s.candidates) ? s.candidates.find((c: Json) => isObj(c) && String(c.id) === id) : null;
  if (!cand) return json(400, { error: 'bad_request', field: 'account' });
  const link = await storedLink(deps, platform); link[platform === 'tiktok' ? 'advertiser_id' : 'customer_id'] = id;
  const at = deps.now();
  try { await secretSet(deps, 'ads_' + platform, link); } catch (e) { return json(503, { error: e instanceof GraphError ? e.code : 'failed' }); }
  await adsSettingsWrite(deps, platform, { linked_at: at, linked_by: who.uid, name: cand.name ?? null, candidates: null }, at);
  await log(deps, who.uid, 'mkt.ads.link', platform, 'pick');
  return json(200, { result: 'ok', linked: true, platform, ...(await platformView(deps, platform, await linkOf(deps, platform), await adsSettings(deps))) });
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let parsed: unknown;
  try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {};
  const action = typeof args.action === 'string' ? args.action : '';
  // the cron: the sync secret of 0008, `sync` / `report` only — never a member's action
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (!CRON_ACTIONS.includes(action) || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return action === 'report' ? await report(deps) : await run(deps, null, null); } catch (e) { console.error('mkt-ads ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    switch (action) {
      case 'status': return await status(deps, who);
      case 'rules': return await rulesGet(deps, who);
      case 'rules_set': return await rulesSet(deps, who, args);
      case 'live': return await liveSet(deps, who, args);
      case 'decide': return await decide(deps, who, args);
      case 'link_set': return await linkSet(deps, who, args);
      case 'link_start': return await linkStart(deps, who, args);
      case 'link_callback': return await linkCallback(deps, who, args);
      case 'link_pick': return await linkPick(deps, who, args);
      case 'unlink': return await unlink(deps, who, args);
      default: return await syncByHand(deps, who, args);
    }
  } catch (e) {
    console.error('mkt-ads ' + action + ': ' + quiet(e));
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
