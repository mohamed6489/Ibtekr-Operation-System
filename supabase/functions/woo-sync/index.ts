// woo-sync: the backup sync, the status / store pushes and the webhook registration (deployed with verify_jwt false;
// it authenticates here). Auth: an X-Sync-Secret header (pg_cron, Task 7) must satisfy rpc('sync_secret_matches',
// { candidate }) → system mode; else a member's Authorization: Bearer <jwt> → a client with that token:
// push_status needs has_perm('orders.status') = 'F'; push_vendor needs is_admin() or has_perm('vendors.edit') = 'F' — or 'P' for the
// contact fields alone (phone, email, contact_name, address_parts, social: the columns the guard lets 'P' edit), the rate fields add sensitive.commission = 'F',
// the bank (phase 3.5) needs sensitive.vendor_bank = 'F' (alone it needs no vendors.edit)
// (and has_perm('sensitive.commission') = 'F' when `fields` name the commission); every other action is_admin();
// anything else → 401. Writes always go through the service client (deps.db). Body { action, ...args }:
//   'states'   wc/v3/data/countries/EG (one request) → its states[] { code, name } → woo_states on code: the site's
//              own governorate list (EG-01 …, not WooCommerce's EGALX …), shown by name for orders.customer_state.
//   'categories'  wc/v3/products/categories, page by page → woo_categories on id (the names behind the per-category
//              commission of phase 3.3).
//   'orders'   wc/v3/orders?after=2026-10-01T00:00:00&dates_are_gmt=true&modified_after={cursor}&orderby=modified&
//              order=asc&status=any, page by page (100; at most 50 pages per run): parents + Dokan sub-orders;
//              sync_state['orders'] = { cursor, last_run, count, pages, done } after every page.
//   'vendors'  dokan/v1/stores → vendors on woo_vendor_id: a new store whole, an existing one through the snapshot
//              comparison of phase 3.3 (woo-write's store sync: the site's changes are written here, the pending
//              changes of the team are pushed in the same run when WOO_PUSH_ENABLED is 1, a change on both sides is
//              the site's with a conflict row). Counts: { vendors, from_site, conflicts, pushed, push_failed, pages, done }.
//   'products' wc/v3/products?modified_after={cursor} → products.
//   'all'      states, categories, vendors, orders, products (a failed part does not stop the next ones; states and
//              categories are cheap; orders come before the ~40 product pages so a first run that hits the gateway's
//              time limit has the orders already).
//   'push_status' { order_id, status }  refused as skipped/stale unless `status` is the order's stored status (the
//              adapter writes the row first, so a mismatch is a stale page); then skipped/push_disabled unless the
//              secret WOO_PUSH_ENABLED is exactly 1 (staging is a full copy of the shop: real customers' e-mails and
//              the Bosta integration fire on a status change), before any Woo call; the system status → its Woo
//              slug (outgoingWooStatus; none → skipped) → PUT
//              wc/v3/orders/{id}; "system wins": when Woo changed the status since our last sync, the push still goes
//              and a 'conflict' row is logged; orders.woo_status / woo_updated_at follow Woo's answer.
//   'push_vendor' { vendor_id, fields[] }  (phase 3.3, decision 4 b) fields ⊆ SYNC_FIELDS of woo-core (name, phone,
//              email, contact_name, address_parts, social, status, rate, category_rates, bank; anything else → 400). The
//              row is read from the database (never the body); a maker without woo_vendor_id → skipped/no_store; the
//              WOO_PUSH_ENABLED gate → skipped/push_disabled with the fields added to push_pending, before any Woo
//              call; a `#…` placeholder name is never sent (only that → skipped/placeholder); then one PUT
//              dokan/v1/stores/{id} with those fields only (toDokanStore). Success → woo_snapshot takes the site's
//              answer for the sent fields, woo_synced_at, push_pending minus them; the answer lists `accepted` and
//              `refused` (a field Dokan took vs one it silently kept — the acceptance check of decision 4 e). A
//              retryable failure (network, 5xx, 401 / 403 / 408 / 429) → the fields join push_pending, an out/vendor
//              error row, 502 { pending: true }; any other 4xx is the site's final answer → nothing pending, a
//              `refused` row + activity vendor.sync.refused, 502 { pending: false } (review I-3). A rate field whose
//              newest row is still future-dated is held pending (`held`; alone → skipped/future) until that day's
//              run (review I-2).
//   'register_webhooks' { delivery_url? }  ensures one active `ibtekr-ops:<topic>` webhook per topic pointing at
//              {SUPABASE_URL}/functions/v1/woo-webhook; any other webhook on the site (n8n's) is never touched.
// Answer: 200 { action, result, counts, … } or 4xx / 5xx { error }. CORS for the browser's functions.invoke.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { START_DATE, SYNC_FIELDS, mapStore, nextCursor, outgoingWooStatus } from '../_shared/woo-core.js';
import { getState, logSync, setState } from '../_shared/db.js';
import { ConfigError, WooError, errorText, makeScrubber, wooApi } from '../_shared/woo-api.js';
import { VENDOR_SYNC_COLUMNS, applyPushResult, effectiveRates, gmtIso, loadBanks, logActivity, markPushPending, pushStoreFields, retryablePush, saveVendors, wooId, writeCategories, writeContext, writeOrderPage, writeProducts, writeStates } from '../_shared/woo-write.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: Db; now: () => string; userDb?: (jwt: string) => Db };
type Ctx = Awaited<ReturnType<typeof writeContext>>;
type Run = { db: Db; env: Deps['env']; woo: () => ReturnType<typeof wooApi>; ctx: () => Promise<Ctx>; kind: 'cron' | 'manual'; now: () => string };

const ACTIONS = ['states', 'categories', 'orders', 'vendors', 'products', 'all', 'push_status', 'push_vendor', 'register_webhooks', 'probe_store', 'probe_dokan'];
const STATES_PATH = 'wc/v3/data/countries/EG'; // a wc/ path: the WC keys authenticate it
const CATEGORIES_PATH = 'wc/v3/products/categories';
const RATE_FIELDS = ['rate', 'category_rates'];
const CONTACT_PUSH_FIELDS = ['phone', 'email', 'contact_name', 'address_parts', 'social']; // what vendors.edit = 'P' may push (the guard's contact rule)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pushEnabled = (env: Deps['env']) => env.WOO_PUSH_ENABLED?.trim() === '1';
const TOPICS = ['order.created', 'order.updated', 'product.created', 'product.updated'];
const PREFIX = 'ibtekr-ops:';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const ms = (v: unknown) => { const t = Date.parse(gmtIso(v) ?? ''); return Number.isFinite(t) ? t : null; };
const ourUrl = (env: Deps['env']) => `${(env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')}/functions/v1/woo-webhook`;

// ---------------------------------------------------------------- auth

async function authorize(req: Request, deps: Deps, action: string, args: Json): Promise<'system' | 'member' | null> {
  const secret = req.headers.get('x-sync-secret');
  if (secret) {
    const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
    return !error && data === true ? 'system' : null;
  }
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && data === 'F'; };
  const admin = async () => { const { data, error } = await member.rpc('is_admin'); return !error && data === true; };
  if (action === 'push_status') return (await perm('orders.status')) ? 'member' : null;
  if (action === 'push_vendor') {
    if (await admin()) return 'member';
    const fields = Array.isArray(args.fields) ? args.fields : [];
    // phase 3.5 (decision 5): `bank` needs sensitive.vendor_bank = F (the rule that writes vendor_bank), whatever vendors.edit says
    if (fields.includes('bank') && !(await perm('sensitive.vendor_bank'))) return null;
    const store = fields.filter((f) => f !== 'bank');
    if (store.length) {
      const { data: edit, error: editErr } = await member.rpc('has_perm', { key: 'vendors.edit' });
      const level = editErr ? null : edit;
      const contactOnly = store.every((f) => CONTACT_PUSH_FIELDS.includes(f));
      if (level !== 'F' && !(level === 'P' && contactOnly)) return null;
    } else if (!fields.length) return null;
    return !fields.some((f) => RATE_FIELDS.includes(f)) || (await perm('sensitive.commission')) ? 'member' : null;
  }
  return (await admin()) ? 'member' : null;
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
  return { vendors, ...ctx.vendorSync, pages: res.pages, done: res.done };
}

// The site's product categories, page by page (wc/: the WC keys), upserted on id; nothing is deleted.
async function pullCategories(run: Run) {
  const ctx = await run.ctx();
  const totals = { categories: 0, skipped: 0, failed: 0 };
  const res = await ctx.woo.eachPage(CATEGORIES_PATH, {}, async (page: Json[]) => {
    const r = await writeCategories(ctx, page);
    totals.categories += r.written.length; totals.skipped += r.skipped; totals.failed += r.failed;
  });
  return { ...totals, pages: res.pages, done: res.done };
}

// The site's governorates: one GET; an answer without a states array is an upstream error (nothing written).
async function pullStates(run: Run) {
  const ctx = await run.ctx();
  const { data } = await ctx.woo.get(STATES_PATH);
  if (!isObj(data) || !Array.isArray(data.states)) throw new WooError(200, `GET ${STATES_PATH}`, 'expected an object with a states array');
  const r = await writeStates(ctx, data.states);
  return { states: r.written.length, skipped: r.skipped, failed: r.failed };
}

// 'all' runs them in this order: the governorate names (one request), the category names (a few pages), the makers
// (lines and products link to them), then orders, then products.
const PULLS: Record<string, (run: Run) => Promise<Json>> = { states: pullStates, categories: pullCategories, vendors: pullVendors, orders: pullOrders, products: pullProducts };

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
  if (!pushEnabled(run.env)) return await skip('push_disabled');
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

// ---------------------------------------------------------------- push_vendor (phase 3.3)

async function pushVendor(run: Run, args: Json) {
  const vendorId = typeof args.vendor_id === 'string' && UUID.test(args.vendor_id) ? args.vendor_id.toLowerCase() : null;
  const fields: string[] = Array.isArray(args.fields) ? [...new Set(args.fields.filter((f: unknown): f is string => typeof f === 'string'))] : [];
  if (vendorId === null || !fields.length || fields.some((f) => !SYNC_FIELDS.includes(f))) return json(400, { error: 'bad_request' });
  // The values come from the row, never from the body (decision 8): the body names the fields only.
  const { data: row, error } = await run.db.from('vendors').select(VENDOR_SYNC_COLUMNS).eq('id', vendorId).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (!row) return json(404, { error: 'vendor_not_found' });
  const storeId = wooId(row.woo_vendor_id);
  const entry = { kind: 'push', direction: 'out', entity: 'vendor', entity_id: storeId === null ? vendorId : String(storeId), action: 'vendor' };
  const skip = async (reason: string, pend: boolean) => {
    const ctx = pend ? await run.ctx() : null;
    if (ctx) await markPushPending(ctx, row, fields);
    await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, fields, reason } });
    return json(200, { action: 'push_vendor', result: 'skipped', reason, fields, counts: { pushed: 0 } });
  };
  if (storeId === null) return await skip('no_store', false);
  // The gate sits before the Woo client is built and before any Woo call; the fields wait in push_pending.
  if (!pushEnabled(run.env)) return await skip('push_disabled', true);
  const ctx = await run.ctx();
  const rates = (await effectiveRates(ctx, [vendorId], run.now())).get(vendorId);
  const bank = fields.includes('bank') ? (await loadBanks(ctx, [vendorId])).get(vendorId) ?? null : null;
  let r;
  try {
    r = await pushStoreFields(ctx, row, fields, rates, bank);
  } catch (e) {
    if (!(e instanceof WooError)) throw e;
    // a retryable failure (network, 5xx, 401 / 403 / 408 / 429) waits in push_pending for the next run; any other 4xx is the
    // site's final answer to these values (review I-3): nothing pending, one refused row, one activity row (names only)
    const pending = retryablePush(e);
    if (pending) await markPushPending(ctx, row, fields);
    else await logActivity(ctx, 'vendor.sync.refused', vendorId, fields);
    await logSync(run.db, { ...entry, result: pending ? 'error' : 'skipped', detail: { vendor_id: vendorId, fields, ...(pending ? {} : { reason: 'refused' }), error: errorText(e, ctx.woo.scrub) } });
    return json(502, { error: 'woo_error', action: 'push_vendor', fields, pending });
  }
  // a rate field whose newest row is future-dated is held pending until that day's run (review I-2)
  if (r.held.length && !r.sent.length) { await markPushPending(ctx, row, r.held); return await skip('future', false); }
  if (!r.sent.length) return await skip('placeholder', false);
  await applyPushResult(ctx, row, r, run.now());
  await logSync(run.db, { ...entry, result: 'ok', detail: { vendor_id: vendorId, fields: r.sent, accepted: r.accepted, refused: r.refused, dropped: r.dropped } });
  return json(200, { action: 'push_vendor', result: 'ok', fields: r.sent, accepted: r.accepted, refused: r.refused, dropped: r.dropped, held: r.held, counts: { pushed: 1 } });
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

// ---------------------------------------------------------------- probe_store (phase 3.3 preparation)

// What Dokan answers for one store with the credentials in place: the field names only (never a value) — top-level
// keys, the address keys, whether phone / email / address carry something, show_email, and whether the request was
// authenticated (WOO_WP_USER / WOO_WP_APP_PASSWORD). { store_id } picks the store; without it, the first of the list.
async function probeStore(run: Run, args: Json) {
  const woo = run.woo();
  let storeId = wooId(args.store_id);
  let store: Json | null = null;
  if (storeId == null) {
    const { data } = await woo.get('dokan/v1/stores', { per_page: 1, page: 1 });
    store = Array.isArray(data) && isObj(data[0]) ? data[0] : null;
    storeId = store ? wooId(store.id) : null;
  } else {
    const { data } = await woo.get(`dokan/v1/stores/${storeId}`);
    store = isObj(data) ? data : null;
  }
  if (!store) return json(502, { error: 'woo_error', action: 'probe_store' });
  const filled = (v: unknown) => v != null && String(v).trim() !== '';
  const address = isObj(store.address) ? store.address : null;
  // The shape of a value, never its content: objects → their keys with the shape of each value (3 levels), arrays →
  // their length and the first item's shape, scalars → their type ('string' adds 'filled' / 'empty'; a number its
  // value only when it is a commission figure the caller asked for — never here). No string value ever comes back.
  const shape = (v: unknown, depth = 0): unknown => {
    if (Array.isArray(v)) return { array: v.length, item: v.length && depth < 3 ? shape(v[0], depth + 1) : undefined };
    if (isObj(v)) return depth < 3 ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k], depth + 1)])) : 'object';
    if (typeof v === 'string') return v.trim() ? 'string:filled' : 'string:empty';
    return v === null ? 'null' : typeof v;
  };
  const SHAPED = ['address', 'social', 'payment', 'admin_category_commission', 'withdraw_options', 'active_payment_methods', 'location', 'store_toc'];
  return json(200, {
    action: 'probe_store', store_id: storeId, auth: woo.hasDokanAuth, keys: Object.keys(store).sort(),
    address_keys: address ? Object.keys(address).sort() : null,
    has: { phone: filled(store.phone), email: filled(store.email), address: !!address && Object.values(address).some(filled), banner: filled(store.banner), social: isObj(store.social), payment: isObj(store.payment) },
    show_email: store.show_email ?? null, enabled: store.enabled ?? null,
    commission: { type: typeof store.admin_commission_type === 'string' ? store.admin_commission_type : shape(store.admin_commission_type), admin_commission: shape(store.admin_commission), admin_additional_fee: shape(store.admin_additional_fee) },
    shapes: Object.fromEntries(SHAPED.filter((k) => k in store).map((k) => [k, shape(store[k])])),
  });
}

// ---------------------------------------------------------------- probe_dokan (phase 4 preparation)

// What Dokan exposes about the makers' accounts (balances, withdrawals, earnings, reports), read-only and as shapes: the
// admin names up to 10 GET paths under dokan/ (no query string, no dot segments); each answers { status, shape } — a route
// index ({ routes }) answers its route names only. No value ever leaves (strings → filled / empty, numbers → 'number').
// `query` may add a few filters to every path (PROBE_QUERY: a store id, a date range, a status word); a failed path also
// answers Dokan's error excerpt (scrubbed by the client: which parameter is missing).
const DOKAN_PATH = /^dokan\/v[0-9]+(\/[A-Za-z0-9_-]+)*$/;
const PROBE_QUERY: Record<string, RegExp> = { vendor_id: /^[1-9][0-9]{0,9}$/, start_date: /^\d{4}-\d{2}-\d{2}$/, end_date: /^\d{4}-\d{2}-\d{2}$/, status: /^[a-z_]{1,20}$/ };
const probeQuery = (q: unknown) => Object.fromEntries(Object.entries(isObj(q) ? q : {}).filter(([k, v]) => k in PROBE_QUERY && typeof v === 'string' && PROBE_QUERY[k].test(v)));
const shapeOf = (v: unknown, depth = 0): unknown => {
  if (Array.isArray(v)) return { array: v.length, item: v.length && depth < 4 ? shapeOf(v[0], depth + 1) : undefined };
  if (isObj(v)) return depth < 4 ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k], depth + 1)])) : 'object';
  if (typeof v === 'string') return v.trim() ? 'string:filled' : 'string:empty';
  return v === null ? 'null' : typeof v;
};
async function probeDokan(run: Run, args: Json) {
  const paths = Array.isArray(args.paths) ? args.paths.filter((p: unknown): p is string => typeof p === 'string' && DOKAN_PATH.test(p)).slice(0, 10) : [];
  if (!paths.length) return json(400, { error: 'bad_request' });
  const woo = run.woo();
  const out: Json = {};
  for (const path of paths) {
    try {
      const { data, total } = await woo.get(path, { ...probeQuery(args.query), per_page: 1, page: 1 });
      out[path] = isObj(data) && isObj(data.routes) ? { status: 200, routes: Object.keys(data.routes).sort() } : { status: 200, total, shape: shapeOf(data) };
    } catch (e) {
      out[path] = e instanceof WooError ? { status: e.status, error: e.message.slice(0, 300) } : { status: 0 };
    }
  }
  return json(200, { action: 'probe_dokan', auth: woo.hasDokanAuth, paths: out });
}

// ---------------------------------------------------------------- handler

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(body) ? body : {};
  const action = typeof args.action === 'string' ? args.action : '';
  const mode = await authorize(req, deps, action, args);
  if (!mode) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });

  let woo: ReturnType<typeof wooApi> | null = null;
  let ctx: Promise<Ctx> | null = null;
  const run: Run = {
    db: deps.db, env: deps.env, now: deps.now, kind: mode === 'system' ? 'cron' : 'manual',
    woo: () => (woo ??= wooApi(deps.env, deps.fetch)),
    ctx: () => (ctx ??= writeContext({ db: deps.db, woo: run.woo(), kind: 'sync', now: deps.now, pushEnabled: pushEnabled(deps.env) })),
  };
  try {
    if (action === 'push_status') return await pushStatus(run, args);
    if (action === 'push_vendor') return await pushVendor(run, args);
    if (action === 'register_webhooks') return await registerWebhooks(run, args);
    if (action === 'probe_store') return await probeStore(run, args);
    if (action === 'probe_dokan') return await probeDokan(run, args);
    return await pull(run, action);
  } catch (e) {
    const isPush = action === 'push_status' || action === 'push_vendor';
    const entity = action === 'push_status' ? 'order' : action === 'push_vendor' ? 'vendor' : 'webhooks';
    const entityId = action === 'push_status' ? wooId(args.order_id)?.toString() ?? null : action === 'push_vendor' && typeof args.vendor_id === 'string' ? args.vendor_id.slice(0, 36) : null;
    await logSync(deps.db, { kind: isPush ? 'push' : run.kind, direction: 'out', entity, entity_id: entityId, action, result: 'error', detail: { error: errorText(e, makeScrubber(deps.env)) } });
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
