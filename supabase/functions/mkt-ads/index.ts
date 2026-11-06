// mkt-ads: Meta Ads' own numbers, read-only — phase 9.5.3, decisions 43 / 48 of docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md.
// Deployed with verify_jwt false; it authenticates each request itself. Nothing here writes on Meta.
//   POST { action: 'sync' } with X-Sync-Secret (the sync secret of 0008, the cron mkt-ads-sync of 0052) and no Authorization:
//     the ad account (name, currency, status), its campaigns and ads (name, status, the creative's thumbnail) and the daily insights
//     per campaign and per ad of the last 3 days (90 on the first run, with no numbers yet) → mkt_ad_objects / mkt_ad_stats.
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status (marketing.view) → { configured, account: { name, currency, status } | null, synced_at, checked_at, error }.
//     sync   (the admin) { days? } → the same run now (1–400 days) + activity_log mkt.ads.sync (the counts only).
// Secrets (the owner's): META_ADS_TOKEN — a System User token of the Business Manager with ads_read (it never expires and never
// reaches a row, a log or an answer) — and META_AD_ACCOUNT_ID («act_…» or the digits). Without them: 503 not_configured.
// A failed run keeps the last numbers and the last success and says our code (token / permission / rate / timeout / graph_N) on
// the account row; the page says it in words.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { FIRST_DAYS, MAX_DAYS, MAX_PAGES, SYNC_DAYS, accountOf, accountRowOf, nextOf, objectRowOf, path, statRowOf, windowOf } from '../_shared/mkt-ads.js';
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

const ACTIONS = ['status', 'sync'];
const GRAPH_MS = 30_000;
const CHUNK = 500;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const configOf = (env: Deps['env']) => {
  const token = (env.META_ADS_TOKEN ?? '').trim(); const account = accountOf(env.META_AD_ACCOUNT_ID);
  return token.length >= 20 && account ? { token, account } : null;
};

// ---------------------------------------------------------------- Graph (GET only)

class GraphError extends Error { constructor(public code: string) { super(code); this.name = 'GraphError'; } }
async function get(deps: Deps, url: string, token: string): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  let res: Response;
  try { res = await f(url, { method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer ' + token }, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out));
  return isObj(out) ? out : {};
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

// ---------------------------------------------------------------- the run (decision 43)

async function accountRow(deps: Deps, id: string): Promise<Json | null> {
  const { data } = await deps.db.from('mkt_ad_objects').select('platform, kind, id, name, status, meta').eq('platform', 'meta').eq('kind', 'account').eq('id', id).maybeSingle();
  return isObj(data) ? data : null;
}
async function upsertAll(deps: Deps, table: string, rows: Json[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await deps.db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error('db ' + table + ' ' + (error.code ?? ''));
  }
}
async function run(deps: Deps, daysArg: number | null): Promise<Response> {
  const cfg = configOf(deps.env); if (!cfg) return json(503, { error: 'not_configured', configured: false });
  const at = deps.now(); const nowMs = Date.parse(at); const prev = await accountRow(deps, cfg.account);
  let days = daysArg;
  if (!days) { const { data } = await deps.db.from('mkt_ad_stats').select('day').eq('platform', 'meta').limit(1); days = Array.isArray(data) && data.length ? SYNC_DAYS : FIRST_DAYS; }
  const w = windowOf(nowMs, days);
  try {
    const acct = await get(deps, path.account(cfg.account), cfg.token);
    const camps = await list(deps, path.campaigns(cfg.account), cfg.token);
    const ads = await list(deps, path.ads(cfg.account), cfg.token);
    const cStats = await list(deps, path.insights(cfg.account, 'campaign', w.since, w.until), cfg.token);
    const aStats = await list(deps, path.insights(cfg.account, 'ad', w.since, w.until), cfg.token);
    const objects = [...camps.map((c) => objectRowOf('campaign', c, cfg.account)), ...ads.map((a) => objectRowOf('ad', a, null))].filter(isObj).map((r) => ({ ...r, updated_at: at }));
    const stats = [...cStats.map((x) => statRowOf(x, 'campaign')), ...aStats.map((x) => statRowOf(x, 'ad'))].filter(isObj).map((r) => ({ ...r, updated_at: at }));
    await upsertAll(deps, 'mkt_ad_objects', objects, 'platform,kind,id');
    await upsertAll(deps, 'mkt_ad_stats', stats, 'platform,level,object_id,day');
    await upsertAll(deps, 'mkt_ad_objects', [{ ...accountRowOf(cfg.account, acct, at, null, prev), updated_at: at }], 'platform,kind,id'); // last: the success mark
    return json(200, { result: 'ok', days: w.days, since: w.since, until: w.until, campaigns: camps.length, ads: ads.length, stats: stats.length });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    await upsertAll(deps, 'mkt_ad_objects', [{ ...accountRowOf(cfg.account, null, at, code, prev), updated_at: at }], 'platform,kind,id');
    return json(502, { error: code });
  }
}

async function status(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const cfg = configOf(deps.env);
  const row = cfg ? await accountRow(deps, cfg.account) : null; const m = row && isObj(row.meta) ? row.meta : {};
  return json(200, { configured: !!cfg, account: row ? { name: row.name ?? null, currency: m.currency ?? null, status: row.status ?? null } : null,
    synced_at: m.synced_at ?? null, checked_at: m.checked_at ?? null, error: m.error ?? null });
}
async function syncByHand(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const d = args.days == null ? null : Number(args.days);
  if (d != null && !(Number.isInteger(d) && d >= 1 && d <= MAX_DAYS)) return json(400, { error: 'bad_request', field: 'days' });
  const res = await run(deps, d);
  const b = await res.clone().json().catch(() => ({}));
  const value = res.ok ? [b.days, b.campaigns, b.ads, b.stats].join(' · ') : String(b.error ?? res.status);
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: who.uid, action: 'mkt.ads.sync', entity: 'mkt_ads', entity_id: 'meta', new_value: value }); } catch { /* the log never blocks */ }
  return res;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let parsed: unknown;
  try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {};
  const action = typeof args.action === 'string' ? args.action : '';
  // the cron: the sync secret of 0008, `sync` only — never a member's action
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (action !== 'sync' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return await run(deps, null); } catch (e) { console.error('mkt-ads sync: ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    return action === 'status' ? await status(deps, who) : await syncByHand(deps, who, args);
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
