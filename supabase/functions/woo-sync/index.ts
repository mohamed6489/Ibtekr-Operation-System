// woo-sync: the backup sync, the status push and the webhook registration (deployed with verify_jwt false; it
// authenticates here). Auth: an X-Sync-Secret header (pg_cron, Task 7) must satisfy rpc('sync_secret_matches',
// { candidate }) → system mode; else a member's Authorization: Bearer <jwt> → a client with that token:
// push_status needs has_perm('orders.status') = 'F', every other action is_admin(); anything else → 401. Writes
// always go through the service client (deps.db). Body { action, ...args }:
//   'orders'   wc/v3/orders?after=2026-10-01T00:00:00&dates_are_gmt=true&modified_after={cursor}&orderby=modified&
//              order=asc&status=any, page by page (100; at most 50 pages per run): parents + Dokan sub-orders;
//              sync_state['orders'] = { cursor, last_run, count, pages, done } after every page.
//   'vendors'  dokan/v1/stores → vendors on woo_vendor_id.  'products'  wc/v3/products?modified_after={cursor} → products.
//   'all'      vendors, then orders, then products (a failed part does not stop the next ones; orders come before
//              the ~40 product pages so a first run that hits the gateway's time limit has the orders already).
//   'push_status' { order_id, status }  refused as skipped/stale unless `status` is the order's stored status (the
//              adapter writes the row first, so a mismatch is a stale page); then skipped/push_disabled unless the
//              secret WOO_PUSH_ENABLED is exactly 1 (staging is a full copy of the shop: real customers' e-mails and
//              the Bosta integration fire on a status change), before any Woo call; the system status → its Woo
//              slug (outgoingWooStatus; none → skipped) → PUT
//              wc/v3/orders/{id}; "system wins": when Woo changed the status since our last sync, the push still goes
//              and a 'conflict' row is logged; orders.woo_status / woo_updated_at follow Woo's answer.
//   'register_webhooks' { delivery_url? }  ensures one active `ibtekr-ops:<topic>` webhook per topic pointing at
//              {SUPABASE_URL}/functions/v1/woo-webhook; any other webhook on the site (n8n's) is never touched.
// Answer: 200 { action, result, counts, … } or 4xx / 5xx { error }. CORS for the browser's functions.invoke.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { START_DATE, mapStore, nextCursor, outgoingWooStatus } from '../_shared/woo-core.js';
import { getState, logSync, setState } from '../_shared/db.js';
import { ConfigError, WooError, errorText, makeScrubber, wooApi } from '../_shared/woo-api.js';
import { gmtIso, saveVendors, wooId, writeContext, writeOrderPage, writeProducts } from '../_shared/woo-write.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: Db; now: () => string; userDb?: (jwt: string) => Db };
type Ctx = Awaited<ReturnType<typeof writeContext>>;
type Run = { db: Db; env: Deps['env']; woo: () => ReturnType<typeof wooApi>; ctx: () => Promise<Ctx>; kind: 'cron' | 'manual'; now: () => string };

const ACTIONS = ['orders', 'vendors', 'products', 'all', 'push_status', 'register_webhooks'];
const TOPICS = ['order.created', 'order.updated', 'product.created', 'product.updated'];
const PREFIX = 'ibtekr-ops:';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const ms = (v: unknown) => { const t = Date.parse(gmtIso(v) ?? ''); return Number.isFinite(t) ? t : null; };
const ourUrl = (env: Deps['env']) => `${(env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')}/functions/v1/woo-webhook`;

// ---------------------------------------------------------------- auth

async function authorize(req: Request, deps: Deps, action: string): Promise<'system' | 'member' | null> {
  const secret = req.headers.get('x-sync-secret');
  if (secret) {
    const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
    return !error && data === true ? 'system' : null;
  }
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb) return null;
  const member = deps.userDb(jwt);
  if (action === 'push_status') {
    const { data, error } = await member.rpc('has_perm', { key: 'orders.status' });
    return !error && data === 'F' ? 'member' : null;
  }
  const { data, error } = await member.rpc('is_admin');
  return !error && data === true ? 'member' : null;
}

// ---------------------------------------------------------------- pulls

// Page through `path` from sync_state[key].cursor, writing each page; the state is saved after every page.
async function cursorPull(run: Run, key: string, path: string, query: Json, write: (page: Json[]) => Promise<Json>) {
  const ctx = await run.ctx();
  let cursor: string | null = (await getState(run.db, key)).cursor ?? null;
  const totals: Json = {};
  let count = 0;
  const save = (pages: number, done: boolean) => setState(run.db, key, { cursor, last_run: run.now(), count, pages, done }, run.now());
  const res = await ctx.woo.eachPage(path, { ...query, modified_after: cursor ?? undefined }, async (page: Json[], n: number) => {
    for (const [k, v] of Object.entries(await write(page))) totals[k] = (totals[k] ?? 0) + v;
    count += page.length;
    cursor = nextCursor(cursor, page);
    await save(n, false);
  });
  await save(res.pages, res.done);
  return { ...totals, pages: res.pages, done: res.done };
}

const pullOrders = (run: Run) => run.ctx().then((ctx) => cursorPull(run, 'orders', 'wc/v3/orders',
  { after: `${START_DATE}T00:00:00`, dates_are_gmt: 'true', orderby: 'modified', order: 'asc', status: 'any' },
  (page) => writeOrderPage(ctx, page)));

const pullProducts = (run: Run) => run.ctx().then((ctx) => cursorPull(run, 'products', 'wc/v3/products',
  { dates_are_gmt: 'true', orderby: 'modified', order: 'asc' },
  async (page) => { const r = await writeProducts(ctx, page); return { products: r.written.length, failed: r.failed }; }));

async function pullVendors(run: Run) {
  const ctx = await run.ctx();
  let vendors = 0;
  const res = await ctx.woo.eachPage('dokan/v1/stores', {}, async (stores: Json[]) => { vendors += await saveVendors(ctx, stores.filter(isObj).map(mapStore)); });
  return { vendors, pages: res.pages, done: res.done };
}

// 'all' runs them in this order: the makers first (lines and products link to them), then orders, then products.
const PULLS: Record<string, (run: Run) => Promise<Json>> = { vendors: pullVendors, orders: pullOrders, products: pullProducts };

// One pull or 'all'; every part logs its own woo_sync_log row (ok with the counts, or error with scrubbed text).
async function pull(run: Run, action: string) {
  const counts: Json = {};
  const failed: string[] = [];
  let upstream = false;
  for (const part of action === 'all' ? Object.keys(PULLS) : [action]) {
    try {
      counts[part] = await PULLS[part](run);
      await logSync(run.db, { kind: run.kind, direction: 'in', entity: part, action: 'sync', result: 'ok', detail: counts[part] });
    } catch (e) {
      failed.push(part);
      upstream ||= e instanceof WooError;
      await logSync(run.db, { kind: run.kind, direction: 'in', entity: part, action: 'sync', result: 'error', detail: { error: errorText(e, makeScrubber(run.env)) } });
      if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
    }
  }
  if (failed.length) return json(upstream ? 502 : 500, { error: 'sync_failed', action, failed, counts });
  return json(200, { action, result: 'ok', counts });
}

// ---------------------------------------------------------------- push_status

async function pushStatus(run: Run, args: Json) {
  const id = wooId(args.order_id);
  const status = typeof args.status === 'string' ? args.status.trim() : '';
  if (id === null || !status) return json(400, { error: 'bad_request' });
  const { data: order, error } = await run.db.from('orders').select('id, status, woo_status, woo_updated_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return json(404, { error: 'order_not_found' });
  const entry = { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'status' };
  const skip = async (reason: string, extra: Json = {}) => {
    await logSync(run.db, { ...entry, result: 'skipped', detail: { status, reason, ...extra } });
    return json(200, { action: 'push_status', result: 'skipped', reason, counts: { pushed: 0 } });
  };
  if (status !== order.status) return await skip('stale', { current: order.status });
  // The guard sits after the stale check and before the status_map read and any Woo client or call.
  if (run.env.WOO_PUSH_ENABLED?.trim() !== '1') return await skip('push_disabled');
  const ctx = await run.ctx();
  const slug = outgoingWooStatus(status, ctx.statusMap);
  if (!slug) return await skip('no_woo_status');
  // Conflict: WooCommerce changed the status after the version we last stored (neither ours nor the one pushed).
  const before = (await ctx.woo.get(`wc/v3/orders/${id}`)).data ?? {};
  const newer = (ms(before.date_modified_gmt) ?? 0) > (ms(order.woo_updated_at) ?? Infinity);
  const conflict = newer && before.status !== order.woo_status && before.status !== slug;
  const after = (await ctx.woo.put(`wc/v3/orders/${id}`, { status: slug })).data ?? {};
  const patch = { woo_status: typeof after.status === 'string' ? after.status : slug, woo_updated_at: gmtIso(after.date_modified_gmt) ?? order.woo_updated_at };
  const upd = await run.db.from('orders').update(patch).eq('id', id);
  if (upd.error) throw new Error(`orders: ${upd.error.message}`);
  await logSync(run.db, { ...entry, result: conflict ? 'conflict' : 'ok', detail: { status, woo_status: patch.woo_status, ...(conflict ? { woo_before: before.status ?? null } : {}) } });
  return json(200, { action: 'push_status', result: 'ok', conflict, counts: { pushed: 1 } });
}

// ---------------------------------------------------------------- register_webhooks

async function registerWebhooks(run: Run, args: Json) {
  const url = ourUrl(run.env);
  const asked = typeof args.delivery_url === 'string' ? args.delivery_url.trim().replace(/\/+$/, '') : null;
  if (asked !== null && asked !== url) return json(400, { error: 'delivery_url_mismatch' });
  const secret = run.env.WOO_WEBHOOK_SECRET?.trim();
  if (!secret || !/^https:\/\//.test(url)) return json(500, { error: 'not_configured' });
  const woo = run.woo();
  const all: Json[] = [];
  await woo.eachPage('wc/v3/webhooks', {}, (page: Json[]) => { all.push(...page.filter(isObj)); });
  const ours = all.filter((h) => wooId(h.id) !== null && typeof h.name === 'string' && h.name.startsWith(PREFIX) && h.delivery_url === url);
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const result: Json[] = [];
  for (const topic of TOPICS) {
    const hook = ours.find((h) => h.topic === topic);
    if (!hook) {
      result.push((await woo.post('wc/v3/webhooks', { name: `${PREFIX}${topic}`, topic, delivery_url: url, secret, status: 'active' })).data);
      counts.created++;
    } else if (hook.status !== 'active') {
      result.push((await woo.put(`wc/v3/webhooks/${wooId(hook.id)}`, { status: 'active', secret })).data);
      counts.updated++;
    } else {
      result.push(hook);
      counts.unchanged++;
    }
  }
  const webhooks = result.filter(isObj).map((h) => ({ id: h.id ?? null, name: h.name ?? null, topic: h.topic ?? null, status: h.status ?? null, delivery_url: h.delivery_url ?? null }));
  await logSync(run.db, { kind: run.kind, direction: 'out', entity: 'webhooks', action: 'register', result: 'ok', detail: counts });
  return json(200, { action: 'register_webhooks', result: 'ok', counts, webhooks: webhooks.sort((a, b) => Number(a.id) - Number(b.id)) });
}

// ---------------------------------------------------------------- handler

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(body) ? body : {};
  const action = typeof args.action === 'string' ? args.action : '';
  const mode = await authorize(req, deps, action);
  if (!mode) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });

  let woo: ReturnType<typeof wooApi> | null = null;
  let ctx: Promise<Ctx> | null = null;
  const run: Run = {
    db: deps.db, env: deps.env, now: deps.now, kind: mode === 'system' ? 'cron' : 'manual',
    woo: () => (woo ??= wooApi(deps.env, deps.fetch)),
    ctx: () => (ctx ??= writeContext({ db: deps.db, woo: run.woo(), kind: 'sync', now: deps.now })),
  };
  try {
    if (action === 'push_status') return await pushStatus(run, args);
    if (action === 'register_webhooks') return await registerWebhooks(run, args);
    return await pull(run, action);
  } catch (e) {
    const entity = action === 'push_status' ? 'order' : 'webhooks';
    await logSync(deps.db, { kind: action === 'push_status' ? 'push' : run.kind, direction: 'out', entity, entity_id: wooId(args.order_id)?.toString() ?? null, action, result: 'error', detail: { error: errorText(e, makeScrubber(deps.env)) } });
    if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
    return json(e instanceof WooError ? 502 : 500, { error: e instanceof WooError ? 'woo_error' : 'failed' });
  }
}

// ---------------------------------------------------------------- runtime wiring

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, fetch: globalThis.fetch, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
  };
}

// Serve only as the entry point (the Supabase Edge Runtime defines EdgeRuntime); importing the module (tests) does not.
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
