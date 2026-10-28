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
//   'accounts' (phase 4, decision 5)  read-only mirrors of the makers' Dokan accounts: dokan/v1/withdraw?status=all page by
//              page → dokan_withdrawals (id, store, amount, charge, receivable, status, method, created — never `details`
//              (the bank account), `ip` or `note`), then dokan/v1/stores/{id}/stats for the next ACCOUNTS_BATCH makers with a
//              store (sync_state['accounts'].offset goes round) → dokan_balances. Nothing is ever written to Dokan.
//   'statement' { vendor_id, from, to }  (decision 6) the maker's Dokan statement for the range (at most 400 days),
//              dokan/v1/vendor/reports/statement, read-only and not stored: rows { date, type, title, debit, credit,
//              balance } (title scrubbed). A member needs accounts.view <> N.
//   'withdraw_approve' { id }  (phase 4.1, the owner's one write from the accounts page) approves a Dokan withdraw request
//              that is pending in dokan_withdrawals and still pending on Dokan (GET, then PUT dokan/v1/withdraw/{id}
//              { status: 'approved' }; else skipped/stale and the mirror corrected); the maker's balance is read again.
//              WOO_PUSH_ENABLED gates it (skipped/push_disabled). The admin or has_perm('accounts.approve') = 'F' only —
//              never the sync secret. No cancel, no amount, nothing of the bank details logged or stored.
//   'withdrawals' (phase 4.1, decision 12: «تحديث من Dokan»)  the withdraw-request half of 'accounts' on demand: dokan/v1/withdraw
//              ?status=all → dokan_withdrawals (the same allow-list), read-only on Dokan; no balances. A member needs
//              accounts.view <> N (like 'statement').
//   'products' { full: true }  (phase 5, decision 4) every product of both languages by id, page by page from
//              sync_state['products_full'] (the products the delta cursor missed); the delta 'products' pull itself reads
//              the default language, then lang=ar, then status=trash, each with its own cursor.
//   'product_get' { id }  (phase 5, decision 5) the product live + its Arabic translation's name / descriptions + its
//              variations, allow-listed (woo-products.js editView); products.view <> N.
//   'product_save' { id, fields, ar?, variations? } (products.edit = F) / 'products_batch' { update: [{ id, …fields }] } (≤ 100,
//              products.bulk = F): the allowed fields only (woo-products.js), PUT / batch `update` (never `delete`);
//              the Arabic translation gets its own fields + status / price / stock. WOO_PUSH_ENABLED gates them. Phase 5.1:
//              seo_title / seo_description (both languages) go as Rank Math's meta (toWoo) — the only meta written.
//   'products_trash' / 'products_restore' { ids } (≤ 100)  products.trash = F: DELETE with no query (the trash —
//              never `force`) / PUT status draft, on the product and its translation. WOO_PUSH_ENABLED gates them.
//              The product actions are a person's, never the sync secret's; the mirror follows WooCommerce's answers.
//   'studio_upload' { batch_id, index }  products.add = F (phase 5.2): one studio batch item, read from studio_batches
//              and allow-listed (woo-studio.js) → images to wp/v2/media, a draft product + variations, the Arabic translation
//              (WPML), the maker as author (PUT dokan/v1/products/{id} post_author); the result on the batch. 'category_create' { name_en, name_ar?,
//              parent? } products.add = F: a new category + its translation. WOO_PUSH_ENABLED gates both.
//   'register_webhooks' { delivery_url? }  ensures one active `ibtekr-ops:<topic>` webhook per topic pointing at
//              {SUPABASE_URL}/functions/v1/woo-webhook; any other webhook on the site (n8n's) is never touched.
// Answer: 200 { action, result, counts, … } or 4xx / 5xx { error }. CORS for the browser's functions.invoke.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { START_DATE, SYNC_FIELDS, mapStore, nextCursor, outgoingWooStatus } from '../_shared/woo-core.js';
import { getState, logSync, setState, upsertRows } from '../_shared/db.js';
import { ConfigError, WooError, errorText, makeScrubber, wooApi } from '../_shared/woo-api.js';
import { AR_FIELDS, BATCH_FIELDS, EDIT_FIELDS, VARIATION_FIELDS, cleanFields, editView, sharedOf, toWoo, variationView } from '../_shared/woo-products.js';
import { STUDIO_ATTRS, buildStudio } from '../_shared/woo-studio.js';
import { VENDOR_SYNC_COLUMNS, applyPushResult, effectiveRates, gmtIso, loadBanks, logActivity, markPushPending, pushStoreFields, retryablePush, saveVendors, wooId, writeBrands, writeCategories, writeContext, writeOrderPage, writeProducts, writeStates } from '../_shared/woo-write.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: Db; now: () => string; userDb?: (jwt: string) => Db };
type Ctx = Awaited<ReturnType<typeof writeContext>>;
type Run = { db: Db; env: Deps['env']; woo: () => ReturnType<typeof wooApi>; ctx: () => Promise<Ctx>; kind: 'cron' | 'manual'; now: () => string };

const ACTIONS = ['states', 'categories', 'orders', 'vendors', 'products', 'all', 'push_status', 'push_vendor', 'register_webhooks', 'probe_store', 'probe_dokan', 'accounts', 'statement', 'withdraw_approve', 'withdrawals',
  'product_get', 'product_save', 'products_batch', 'products_trash', 'products_restore', 'studio_upload', 'category_create'];
// phase 5: the product actions a person runs (never the sync secret); phase 5.2: the studio's upload and a new category
const PRODUCT_ACTIONS = ['product_get', 'product_save', 'products_batch', 'products_trash', 'products_restore', 'studio_upload', 'category_create'];
const PRODUCT_BATCH_MAX = 100;
const ACCOUNTS_BATCH = 50; // stats requests per run (one per maker; the hourly cron goes round the list)
const STATEMENT_MAX_DAYS = 400;
const STATEMENT_MAX_PAGES = 10;
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
    if (action === 'withdraw_approve') return null; // a person approves, never the cron / sync secret (phase 4.1)
    if (PRODUCT_ACTIONS.includes(action)) return null; // a person edits products, never the cron / sync secret (phase 5)
    const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
    return !error && data === true ? 'system' : null;
  }
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return !error && data === 'F'; };
  const admin = async () => { const { data, error } = await member.rpc('is_admin'); return !error && data === true; };
  if (action === 'push_status') return (await perm('orders.status')) ? 'member' : null;
  if (action === 'statement' || action === 'withdrawals') { const { data, error } = await member.rpc('has_perm', { key: 'accounts.view' }); return !error && (data === 'F' || data === 'P') ? 'member' : null; }
  // phase 4.1 (decision 1): approving a Dokan withdraw request — the admin or accounts.approve = F (has_perm carries aal2)
  if (action === 'withdraw_approve') return (await admin()) || (await perm('accounts.approve')) ? 'member' : null;
  // phase 5 (decision 5): reading a product live needs products.view <> N; editing products.edit = F; the trash products.trash = F
  if (action === 'product_get') { const { data, error } = await member.rpc('has_perm', { key: 'products.view' }); return !error && (data === 'F' || data === 'P') ? 'member' : null; }
  if (action === 'product_save') return (await admin()) || (await perm('products.edit')) ? 'member' : null;
  if (action === 'products_batch') return (await admin()) || (await perm('products.bulk')) ? 'member' : null; // the owner, 28 Oct: bulk edit is its own permission
  if (action === 'products_trash' || action === 'products_restore') return (await admin()) || (await perm('products.trash')) ? 'member' : null;
  // phase 5.2 (decisions 7 / 8): the studio's upload and a new category need products.add = F
  if (action === 'studio_upload' || action === 'category_create') return (await admin()) || (await perm('products.add')) ? 'member' : null;
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

// Products (phase 5, decision 4): the default language (en), then the Arabic translations (lang=ar) and the trash
// (status=trash, every language), each with its own cursor. The counts of the two extra pulls come back under ar / trash.
const PRODUCT_QUERY = { dates_are_gmt: 'true', orderby: 'modified', order: 'asc' };
async function pullProducts(run: Run) {
  const ctx = await run.ctx();
  const write = async (page: Json[]) => { const r = await writeProducts(ctx, page); return { products: r.written.length, failed: r.failed }; };
  const en: Json = await cursorPull(run, 'products', 'wc/v3/products', PRODUCT_QUERY, write);
  const ar: Json = await cursorPull(run, 'products_ar', 'wc/v3/products', { ...PRODUCT_QUERY, lang: 'ar' }, write);
  const trash: Json = await cursorPull(run, 'products_trash', 'wc/v3/products', { ...PRODUCT_QUERY, status: 'trash', lang: 'all' }, write);
  return { ...en, ar: ar.products ?? 0, ar_done: ar.done, trash: trash.products ?? 0, failed: (en.failed ?? 0) + (ar.failed ?? 0) + (trash.failed ?? 0) };
}

// A full products pull (decision 4: the products the cursor missed): every product of both languages by id, from the page
// sync_state['products_full'] holds (saved after every page, so the next run goes on); done → back to page 1. The cursors
// of the delta pulls are not touched.
async function fullProducts(run: Run) {
  const ctx = await run.ctx();
  const state = await getState(run.db, 'products_full');
  let lang: string = state.lang === 'ar' ? 'ar' : 'en';
  let start = Number.isInteger(state.page) && state.page > 0 ? state.page : 1;
  let products = 0, failed = 0, done = false;
  for (;;) {
    const res = await ctx.woo.eachPage('wc/v3/products', { orderby: 'id', order: 'asc', status: 'any', lang }, async (page: Json[], n: number) => {
      const r = await writeProducts(ctx, page);
      products += r.written.length; failed += r.failed;
      await setState(run.db, 'products_full', { lang, page: n + 1, last_run: run.now() }, run.now());
    }, { startPage: start });
    if (!res.done) break;
    if (lang === 'ar') { done = true; break; }
    lang = 'ar'; start = 1;
    await setState(run.db, 'products_full', { lang, page: 1, last_run: run.now() }, run.now());
  }
  if (done) await setState(run.db, 'products_full', { lang: 'en', page: 1, last_run: run.now(), done_at: run.now() }, run.now());
  const counts = { products, failed, lang, done };
  await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'products', action: 'full', result: 'ok', detail: counts });
  return json(200, { action: 'products', result: 'ok', full: true, counts });
}

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
  // phase 5 (decision 6): the site's WooCommerce Brands the same way (a site without the Brands plugin answers 404: none)
  let brands = 0;
  try {
    await ctx.woo.eachPage('wc/v3/products/brands', {}, async (page: Json[]) => { const r = await writeBrands(ctx, page); brands += r.written.length; totals.failed += r.failed; });
  } catch (e) { if (!(e instanceof WooError && e.status === 404)) throw e; }
  return { ...totals, brands, pages: res.pages, done: res.done };
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
  // phase 5 (the owner, 28 Oct: "the site has a fixed place that gives my commission and the maker's"): `earning:
  // { product_id, amount }` asks Dokan's own commission endpoint (the product page's "You earn") for that product at that
  // price — seller = the maker's earning, admin = ours; numbers only (anything else → its shape).
  if (isObj(args.earning)) {
    const id = wooId(args.earning.product_id);
    const raw = args.earning.amount;
    const amount = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
    if (id === null || !Number.isFinite(amount) || amount < 0 || amount > 1e9) return json(400, { error: 'bad_request' });
    const woo = run.woo();
    const out: Json = {};
    for (const context of ['seller', 'admin']) {
      try {
        const { data } = await woo.get('dokan/v1/commission', { product_id: id, amount, context });
        out[context] = typeof data === 'number' || (typeof data === 'string' && data.trim() !== '' && Number.isFinite(Number(data))) ? Number(data) : { shape: shapeOf(data) };
      } catch (e) {
        out[context] = e instanceof WooError ? { status: e.status, error: e.message.slice(0, 300) } : { status: 0 };
      }
    }
    return json(200, { action: 'probe_dokan', auth: woo.hasDokanAuth, earning: { product_id: id, amount, ...out } });
  }
  const paths = Array.isArray(args.paths) ? args.paths.filter((p: unknown): p is string => typeof p === 'string' && DOKAN_PATH.test(p)).slice(0, 10) : [];
  if (!paths.length) return json(400, { error: 'bad_request' });
  const woo = run.woo();
  const out: Json = {};
  for (const path of paths) {
    try {
      // phase 5 (decision 6): `options: true` asks each route's schema instead — property names, types, readonly; no values
      if (args.options === true) {
        const { data } = await woo.options(path);
        const props = isObj(data) && isObj(data.schema) && isObj(data.schema.properties) ? data.schema.properties : {};
        const methods = isObj(data) && Array.isArray(data.endpoints) ? [...new Set(data.endpoints.filter(isObj).flatMap((e: Json) => (Array.isArray(e.methods) ? e.methods : [])))].sort() : [];
        out[path] = { status: 200, methods, schema: Object.fromEntries(Object.keys(props).sort().map((k) => [k, `${Array.isArray(props[k]?.type) ? props[k].type.join('|') : props[k]?.type ?? '?'}${props[k]?.readonly ? ':readonly' : ''}`])) };
        continue;
      }
      const { data, total } = await woo.get(path, { ...probeQuery(args.query), per_page: 1, page: 1 });
      out[path] = isObj(data) && isObj(data.routes) ? { status: 200, routes: Object.keys(data.routes).sort() } : { status: 200, total, shape: shapeOf(data) };
    } catch (e) {
      out[path] = e instanceof WooError ? { status: e.status, error: e.message.slice(0, 300) } : { status: 0 };
    }
  }
  return json(200, { action: 'probe_dokan', auth: woo.hasDokanAuth, paths: out });
}

// ---------------------------------------------------------------- accounts (phase 4, decisions 5 / 6)

const numOrNull = (v: unknown) => { const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''; return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null; };
const strOrNull = (v: unknown, max = 40) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const localTs = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(v.trim()) ? v.trim().slice(0, 19).replace('T', ' ') : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A dokan/v1/withdraw item → a dokan_withdrawals row (allow-listed: no details / ip / note), or null without ids. */
export function mapWithdrawal(w: Json, vendorOf: (store: number) => string | null) {
  const id = wooId(w?.id);
  const store = wooId(isObj(w?.user) ? w.user.id : w?.user_id);
  if (id === null || store === null) return null;
  return { id, woo_vendor_id: store, vendor_id: vendorOf(store), amount: numOrNull(w.amount), charge: numOrNull(w.charge), receivable: numOrNull(w.receivable),
    status: strOrNull(w.status, 20) ?? 'unknown', method: strOrNull(w.method, 40), requested_at: localTs(w.created ?? w.date) };
}

async function makersWithStore(run: Run) {
  const makers: Json[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run.db.from('vendors').select('id, woo_vendor_id').order('id').range(from, from + 999);
    if (error) throw new Error(`vendors: ${error.message}`);
    makers.push(...(data ?? []).filter((v: Json) => wooId(v.woo_vendor_id) !== null));
    if ((data ?? []).length < 1000) break;
  }
  makers.sort((a, b) => Number(a.woo_vendor_id) - Number(b.woo_vendor_id));
  return makers;
}

// Every withdraw request (every status), page by page → dokan_withdrawals (mapWithdrawal's allow-list). GET only.
async function pullWithdrawals(run: Run, makers: Json[], now: string) {
  const woo = run.woo();
  const scrub = makeScrubber(run.env);
  const byStore = new Map(makers.map((v) => [Number(v.woo_vendor_id), v.id]));
  let withdrawals = 0, skipped = 0, failedRows = 0;
  const res = await woo.eachPage('dokan/v1/withdraw', { status: 'all' }, async (page: Json[]) => {
    const rows = page.filter(isObj).map((w) => mapWithdrawal(w, (store) => byStore.get(store) ?? null)).filter((r): r is NonNullable<typeof r> => r !== null).map((r) => ({ ...r, synced_at: now }));
    skipped += page.length - rows.length;
    const { bad } = await upsertRows(run.db, 'dokan_withdrawals', rows, 'id');
    for (const b of bad) await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', entity_id: b.key, action: 'upsert', result: 'error', detail: { error: errorText(b.error, scrub) } });
    withdrawals += rows.length - bad.length; failedRows += bad.length;
  });
  return { withdrawals, skipped, failedRows, pages: res.pages, done: res.done };
}

async function pullAccounts(run: Run) {
  const woo = run.woo();
  const scrub = makeScrubber(run.env);
  const makers = await makersWithStore(run);
  const now = run.now();
  // the requests, every status, page by page
  const w = await pullWithdrawals(run, makers, now);
  let failedRows = w.failedRows;
  // the balances: the next batch of makers, going round the list
  const state = await getState(run.db, 'accounts');
  const offset = Number.isInteger(state.offset) && state.offset >= 0 && state.offset < makers.length ? state.offset : 0;
  const batch = makers.slice(offset, offset + ACCOUNTS_BATCH);
  let balances = 0, missing = 0, failed = 0;
  const rows: Json[] = [];
  for (const v of batch) {
    try {
      const { data } = await woo.get(`dokan/v1/stores/${Number(v.woo_vendor_id)}/stats`);
      const others = isObj(data) && isObj(data.others) ? data.others : {};
      const revenue = isObj(data) && isObj(data.revenue) ? data.revenue : {};
      rows.push({ vendor_id: v.id, woo_vendor_id: Number(v.woo_vendor_id), balance: numOrNull(others.balance), earning: numOrNull(revenue.earning), sales: numOrNull(revenue.sales),
        orders: Number.isInteger(numOrNull(revenue.orders)) ? numOrNull(revenue.orders) : null, synced_at: now });
    } catch (e) {
      if (e instanceof WooError && e.status === 404) { missing++; continue; }
      if (!(e instanceof WooError)) throw e;
      failed++;
      if (failed === 1) await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_balances', entity_id: String(v.woo_vendor_id), action: 'stats', result: 'error', detail: { error: errorText(e, scrub) } });
    }
  }
  const { bad } = await upsertRows(run.db, 'dokan_balances', rows, 'vendor_id');
  balances = rows.length - bad.length; failedRows += bad.length;
  const next = offset + batch.length >= makers.length ? 0 : offset + batch.length;
  await setState(run.db, 'accounts', { offset: next, last_run: now, makers: makers.length }, now);
  return { withdrawals: w.withdrawals, skipped: w.skipped, pages: w.pages, done: w.done, balances, missing, failed, failed_rows: failedRows, offset, next };
}

async function statement(run: Run, args: Json) {
  const vendorId = typeof args.vendor_id === 'string' && UUID.test(args.vendor_id) ? args.vendor_id.toLowerCase() : null;
  const from = typeof args.from === 'string' && ISO_DAY.test(args.from) ? args.from : null;
  const to = typeof args.to === 'string' && ISO_DAY.test(args.to) ? args.to : null;
  const days = from && to ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 : NaN;
  if (vendorId === null || !(days >= 0 && days <= STATEMENT_MAX_DAYS)) return json(400, { error: 'bad_request' });
  const { data: row, error } = await run.db.from('vendors').select('id, woo_vendor_id').eq('id', vendorId).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (!row) return json(404, { error: 'vendor_not_found' });
  const store = wooId(row.woo_vendor_id);
  if (store === null) return json(200, { action: 'statement', result: 'no_store', rows: [] });
  const woo = run.woo();
  const out: Json[] = [];
  const res = await woo.eachPage('dokan/v1/vendor/reports/statement', { vendor_id: store, start_date: from, end_date: to }, (page: Json[]) => {
    for (const r of page.filter(isObj)) {
      out.push({ date: localTs(r.trn_date) ?? localTs(r.balance_date) ?? (typeof r.balance_date === 'string' && ISO_DAY.test(r.balance_date) ? r.balance_date : null),
        type: strOrNull(r.trn_type, 40), title: typeof r.perticulars === 'string' ? woo.scrub(r.perticulars, 120) : strOrNull(r.trn_title, 120),
        debit: numOrNull(r.debit) ?? 0, credit: numOrNull(r.credit) ?? 0, balance: numOrNull(r.balance) });
    }
  }, { maxPages: STATEMENT_MAX_PAGES });
  return json(200, { action: 'statement', result: 'ok', store, from, to, rows: out, done: res.done });
}

// ---------------------------------------------------------------- withdraw_approve (phase 4.1)

// The owner's one write from the accounts page (28 Oct): approve a pending Dokan withdraw request. The body names the request
// only; it must be pending in our mirror and still pending on Dokan (GET first), else skipped/stale and the mirror is
// corrected. WOO_PUSH_ENABLED gates every call to Dokan. Never a cancel, never an amount: Dokan lowers the balance itself.
// Nothing of the request's bank details is read into the log or the mirror (mapWithdrawal's allow-list rule).
async function withdrawApprove(run: Run, args: Json) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request' });
  const { data: row, error } = await run.db.from('dokan_withdrawals').select('id, woo_vendor_id, vendor_id, amount, status').eq('id', id).maybeSingle();
  if (error) throw new Error(`dokan_withdrawals: ${error.message}`);
  if (!row) return json(404, { error: 'withdraw_not_found' });
  const entry = { kind: 'push', direction: 'out', entity: 'dokan_withdrawals', entity_id: String(id), action: 'withdraw_approve' };
  const skip = async (reason: string, status: string) => {
    await logSync(run.db, { ...entry, result: 'skipped', detail: { reason, status } });
    return json(200, { action: 'withdraw_approve', result: 'skipped', reason, status });
  };
  if (row.status !== 'pending') return await skip('not_pending', row.status);
  if (!pushEnabled(run.env)) return await skip('push_disabled', row.status);
  const woo = run.woo();
  const mirror = async (status: string) => {
    const upd = await run.db.from('dokan_withdrawals').update({ status, synced_at: run.now() }).eq('id', id);
    if (upd.error) throw new Error(`dokan_withdrawals: ${upd.error.message}`);
  };
  const before = (await woo.get(`dokan/v1/withdraw/${id}`)).data;
  const current = strOrNull(isObj(before) ? before.status : null, 20) ?? 'unknown';
  if (current !== 'pending') { await mirror(current); return await skip('stale', current); }
  const after = (await woo.put(`dokan/v1/withdraw/${id}`, { status: 'approved' })).data;
  const status = strOrNull(isObj(after) ? after.status : null, 20) ?? 'approved';
  await mirror(status);
  // the maker's balance right away (Dokan lowered it); a failure here waits for the hourly run
  const store = wooId(row.woo_vendor_id);
  if (store !== null && row.vendor_id) {
    try {
      const { data } = await woo.get(`dokan/v1/stores/${store}/stats`);
      const others = isObj(data) && isObj(data.others) ? data.others : {};
      const revenue = isObj(data) && isObj(data.revenue) ? data.revenue : {};
      await upsertRows(run.db, 'dokan_balances', [{ vendor_id: row.vendor_id, woo_vendor_id: store, balance: numOrNull(others.balance), earning: numOrNull(revenue.earning),
        sales: numOrNull(revenue.sales), orders: Number.isInteger(numOrNull(revenue.orders)) ? numOrNull(revenue.orders) : null, synced_at: run.now() }], 'vendor_id');
    } catch (e) { if (!(e instanceof WooError)) throw e; }
  }
  await logSync(run.db, { ...entry, result: 'ok', detail: { status, amount: row.amount } });
  return json(200, { action: 'withdraw_approve', result: 'ok', status });
}

// ---------------------------------------------------------------- products (phase 5, decision 5)

// Every product write: WOO_PUSH_ENABLED first (skipped/push_disabled, no call to the site), a woo_sync_log row per
// attempt (entity products, the field names only — never a price or a description), and the mirror refreshed from
// WooCommerce's own answer. The Arabic translation (WPML) gets the status / price / stock too and its own name and
// descriptions; categories, brands and images stay on the product itself.
const productEntry = (id: number | null, action: string) => ({ kind: 'push', direction: 'out', entity: 'products', entity_id: id === null ? null : String(id), action });
const idList = (v: unknown, max: number) => (Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((x) => wooId(x) !== null) ? [...new Set(v.map((x) => wooId(x) as number))] : null);
const pushSkip = async (run: Run, action: string, id: number | null, extra: Json = {}) => {
  await logSync(run.db, { ...productEntry(id, action), result: 'skipped', detail: { reason: 'push_disabled', ...extra } });
  return json(200, { action, result: 'skipped', reason: 'push_disabled' });
};
// the Arabic translation ids of these products, from the mirror (translation_ids.ar, when it is another product)
async function arIds(run: Run, ids: number[]) {
  const { data, error } = await run.db.from('products').select('id, translation_ids').in('id', ids);
  if (error) throw new Error(`products: ${error.message}`);
  const out = new Map<number, number>();
  for (const r of data ?? []) { const ar = wooId(isObj(r.translation_ids) ? r.translation_ids.ar : null); if (ar !== null && ar !== Number(r.id)) out.set(Number(r.id), ar); }
  return out;
}

// product_get { id }: the product as it is on the site now (+ its Arabic translation's name / descriptions + its
// variations, up to 100), allow-listed (editView / variationView); the mirror is refreshed on the way.
async function productGet(run: Run, args: Json) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request' });
  const ctx = await run.ctx();
  const p = (await ctx.woo.get(`wc/v3/products/${id}`)).data;
  if (!isObj(p)) return json(502, { error: 'woo_error' });
  const arId = wooId(isObj(p.translations) ? p.translations.ar : null);
  let ar: Json | null = null;
  if (arId !== null && arId !== id) { try { ar = (await ctx.woo.get(`wc/v3/products/${arId}`)).data; } catch (e) { if (!(e instanceof WooError)) throw e; } }
  let variations: Json[] = [];
  if (p.type === 'variable') variations = ((await ctx.woo.get(`wc/v3/products/${id}/variations`, { per_page: 100, page: 1 })).data ?? []).map(variationView).filter(Boolean);
  await writeProducts(ctx, [p, ...(isObj(ar) ? [ar] : [])]);
  const arView = isObj(ar) ? editView(ar) : null;
  return json(200, { action: 'product_get', product: editView(p), ar: arView && { id: arView.id, name: arView.name, short_description: arView.short_description, description: arView.description, seo_title: arView.seo_title, seo_description: arView.seo_description }, variations });
}

// product_save { id, fields, ar?, variations? }: PUT the product with the allowed fields, the translation with its
// own fields + the shared ones, the variations through variations/batch (update only).
async function productSave(run: Run, args: Json) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request' });
  const main = cleanFields(args.fields ?? {}, EDIT_FIELDS);
  if (main.error) return json(400, { error: main.error, field: main.field });
  const arF = cleanFields(args.ar ?? {}, AR_FIELDS);
  if (arF.error) return json(400, { error: arF.error, field: `ar.${arF.field}` });
  const vars = Array.isArray(args.variations) ? args.variations : [];
  if (vars.length > PRODUCT_BATCH_MAX) return json(400, { error: 'too_many' });
  const varPayload: Json[] = [];
  for (const v of vars) {
    const vid = wooId(isObj(v) ? v.id : null);
    const { id: _id, ...rest } = isObj(v) ? v : {};
    const c = cleanFields(rest, VARIATION_FIELDS);
    if (vid === null || c.error) return json(400, { error: c.error ?? 'bad_field', field: `variations.${c.field ?? 'id'}` });
    varPayload.push({ id: vid, ...c.payload });
  }
  const fields = Object.keys(main.payload), arFields = Object.keys(arF.payload);
  if (!fields.length && !arFields.length && !varPayload.length) return json(400, { error: 'nothing_to_save' });
  const detail = { fields, ar: arFields, variations: varPayload.length };
  if (!pushEnabled(run.env)) return await pushSkip(run, 'product_save', id, detail);
  const ctx = await run.ctx();
  const saved: Json[] = [];
  if (fields.length) saved.push((await ctx.woo.put(`wc/v3/products/${id}`, toWoo(main.payload))).data);
  const shared = sharedOf(main.payload);
  const arId = (await arIds(run, [id])).get(id) ?? null;
  if (arFields.length && arId === null) return json(409, { error: 'no_translation' });
  if (arId !== null && (arFields.length || Object.keys(shared).length)) saved.push((await ctx.woo.put(`wc/v3/products/${arId}`, toWoo({ ...shared, ...arF.payload }))).data);
  let varFailed = 0;
  if (varPayload.length) {
    const r = (await ctx.woo.post(`wc/v3/products/${id}/variations/batch`, { update: varPayload })).data;
    varFailed = (isObj(r) && Array.isArray(r.update) ? r.update : []).filter((x: Json) => isObj(x) && isObj(x.error)).length;
  }
  await writeProducts(ctx, saved.filter(isObj));
  await logSync(run.db, { ...productEntry(id, 'product_save'), result: varFailed ? 'error' : 'ok', detail: { ...detail, translation: arId !== null, variations_failed: varFailed } });
  return json(200, { action: 'product_save', result: 'ok', counts: { saved: saved.length, variations: varPayload.length - varFailed, variations_failed: varFailed } });
}

// products_batch { update: [{ id, ...fields }] } (≤ 100): wc/v3/products/batch with `update` only — the batch's
// `delete` removes for good, so it is never sent — then the same shared fields on the Arabic translations.
async function productsBatch(run: Run, args: Json) {
  const items = Array.isArray(args.update) ? args.update : null;
  if (!items || !items.length || items.length > PRODUCT_BATCH_MAX) return json(400, { error: 'bad_request' });
  const update: Json[] = [];
  for (const it of items) {
    const id = wooId(isObj(it) ? it.id : null);
    const { id: _id, ...rest } = isObj(it) ? it : {};
    const c = cleanFields(rest, BATCH_FIELDS);
    if (id === null || c.error || !Object.keys(c.payload).length) return json(400, { error: c.error ?? 'bad_field', field: c.field ?? 'id' });
    update.push({ id, ...c.payload });
  }
  const ids = update.map((u) => u.id as number);
  const fields = [...new Set(update.flatMap((u) => Object.keys(u).filter((k) => k !== 'id')))];
  if (!pushEnabled(run.env)) return await pushSkip(run, 'products_batch', null, { count: ids.length, fields });
  const ctx = await run.ctx();
  const ar = await arIds(run, ids);
  const arUpdate = update.map((u) => ({ id: ar.get(u.id as number), ...sharedOf(u) })).filter((u) => u.id && Object.keys(u).length > 1);
  const res = (await ctx.woo.post('wc/v3/products/batch', { update })).data;
  const done = (isObj(res) && Array.isArray(res.update) ? res.update : []).filter(isObj);
  const okRows = done.filter((x: Json) => !isObj(x.error) && wooId(x.id) !== null);
  let arRows: Json[] = [];
  if (arUpdate.length) {
    try { const r2 = (await ctx.woo.post('wc/v3/products/batch', { update: arUpdate })).data; arRows = (isObj(r2) && Array.isArray(r2.update) ? r2.update : []).filter((x: Json) => isObj(x) && !isObj(x.error)); }
    catch (e) { if (!(e instanceof WooError)) throw e; }
  }
  await writeProducts(ctx, [...okRows, ...arRows]);
  const counts = { updated: okRows.length, failed: ids.length - okRows.length, translations: arRows.length };
  await logSync(run.db, { ...productEntry(null, 'products_batch'), result: counts.failed ? 'error' : 'ok', detail: { ...counts, fields, ids: ids.slice(0, PRODUCT_BATCH_MAX) } });
  return json(200, { action: 'products_batch', result: 'ok', counts, failed_ids: ids.filter((i) => !okRows.some((r: Json) => wooId(r.id) === i)) });
}

// products_trash { ids } / products_restore { ids } (≤ 100): to the trash = DELETE wc/v3/products/{id} with no query
// (never `force`: WordPress empties its trash after 30 days by itself); back = status draft. The product and its translation.
async function productsTrash(run: Run, args: Json, restore: boolean) {
  const action = restore ? 'products_restore' : 'products_trash';
  const ids = idList(args.ids, PRODUCT_BATCH_MAX);
  if (!ids) return json(400, { error: 'bad_request' });
  if (!pushEnabled(run.env)) return await pushSkip(run, action, null, { count: ids.length });
  const ctx = await run.ctx();
  const ar = await arIds(run, ids);
  const rows: Json[] = [];
  const failed: number[] = [];
  for (const id of ids) {
    try {
      for (const pid of [id, ...(ar.has(id) ? [ar.get(id) as number] : [])]) {
        const r = restore ? await ctx.woo.put(`wc/v3/products/${pid}`, { status: 'draft' }) : await ctx.woo.del(`wc/v3/products/${pid}`);
        if (isObj(r.data)) rows.push(r.data);
      }
    } catch (e) {
      if (!(e instanceof WooError)) throw e;
      failed.push(id);
    }
  }
  await writeProducts(ctx, rows);
  const counts = { done: ids.length - failed.length, failed: failed.length };
  await logSync(run.db, { ...productEntry(null, action), result: failed.length ? 'error' : 'ok', detail: { ...counts, ids } });
  return json(200, { action, result: 'ok', counts, failed_ids: failed });
}

// ---------------------------------------------------------------- the product studio (phase 5.2, decisions 5–9)

// studio_upload { batch_id, index }: one batch item to WooCommerce, read from studio_batches (never from the request) and
// allow-listed by buildStudio; then, each step once (a retry goes on from the step that stopped): the images from the
// bucket to the media library, the product as a draft, its variations, the Arabic translation (WPML: wpml_language ar +
// translation_of; an answer that is not linked to the product is trashed, never left as a second product), the maker as
// the product's author (and its translation's: Dokan's PUT dokan/v1/products/{id} { post_author } with the Application
// Password — «failed» when the answer is not the maker, the product stays), the mirror. The item's result
// goes to studio_batches.result.items[index] (ids, the SKU, a short reason — never a price or a text).
const STUDIO_BUCKET = 'studio';
const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const wooCode = (e: unknown) => (e instanceof WooError ? (/"code":"([a-z0-9_]{1,60})"/.exec(e.message)?.[1] ?? `http_${e.status}`) : e instanceof ConfigError ? 'config' : 'error');
const fileBase = (name: string) => String(name || 'Product').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Product';
async function attributeIds(run: Run, ctx: Ctx) {
  const list = (await ctx.woo.get('wc/v3/products/attributes')).data;
  const bySlug = new Map((Array.isArray(list) ? list : []).filter(isObj).map((a: Json) => [String(a.slug), wooId(a.id)]));
  return Object.fromEntries(Object.entries(STUDIO_ATTRS).map(([k, slug]) => [k, bySlug.get(slug) ?? null]));
}
async function studioUpload(run: Run, args: Json) {
  const batchId = typeof args.batch_id === 'string' && UUID.test(args.batch_id) ? args.batch_id : null;
  const index = Number.isInteger(args.index) && (args.index as number) >= 0 && (args.index as number) < 500 ? (args.index as number) : null;
  if (!batchId || index === null) return json(400, { error: 'bad_request' });
  const { data: batch, error } = await run.db.from('studio_batches').select('id, type, state, result, brand_id, vendor_id, archived_at').eq('id', batchId).maybeSingle();
  if (error) throw new Error(`studio_batches: ${error.message}`);
  if (!batch || batch.archived_at) return json(404, { error: 'no_batch' });
  const item = Array.isArray(batch.state?.items) ? batch.state.items[index] : null;
  if (!isObj(item)) return json(404, { error: 'no_item' });
  const [{ data: brand }, { data: vendor }, { data: colorRows }] = await Promise.all([
    batch.brand_id ? run.db.from('brands').select('name').eq('id', batch.brand_id).maybeSingle() : Promise.resolve({ data: null }),
    batch.vendor_id ? run.db.from('vendors').select('woo_vendor_id').eq('id', batch.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    run.db.from('sku_colors').select('code, name_en')]);
  const colors = Object.fromEntries((colorRows ?? []).map((c: Json) => [c.code, c.name_en]));
  const check = buildStudio(item, { batchId, type: batch.type, brand: brand?.name ?? '', colors, attrs: {} }) as Json;
  if (check.error) return json(400, check);
  const entry = { ...productEntry(null, 'studio_upload'), entity_id: `${batchId}#${index}` };
  if (!pushEnabled(run.env)) return await pushSkip(run, 'studio_upload', null, { batch: batchId, index });
  const ctx = await run.ctx();
  const built = buildStudio(item, { batchId, type: batch.type, brand: brand?.name ?? '', colors, attrs: await attributeIds(run, ctx) }) as Json;
  if (built.error) return json(400, built);
  const prev = isObj(batch.result) && Array.isArray(batch.result.items) && isObj(batch.result.items[index]) ? batch.result.items[index] : {};
  const res: Json = { ...prev, sku: built.sku, media: isObj(prev.media) ? { ...prev.media } : {}, error: null };
  const saveResult = async () => {
    const { data: cur } = await run.db.from('studio_batches').select('state, result').eq('id', batchId).maybeSingle();
    const items = isObj(cur?.result) && Array.isArray(cur.result.items) ? [...cur.result.items] : [];
    while (items.length < index) items.push(null);
    items[index] = res;
    const n = Array.isArray(cur?.state?.items) ? cur.state.items.length : 0;
    const done = n > 0 && Array.from({ length: n }, (_, i) => items[i]).every((x) => isObj(x) && wooId(x.productId) !== null && !x.error);
    const { error: upErr } = await run.db.from('studio_batches').update({ result: { items }, status: done ? 'done' : 'uploading' }).eq('id', batchId);
    if (upErr) throw new Error(`studio_batches: ${upErr.message}`);
  };
  try {
    const paths = [...new Set([...built.images, ...built.variations.map((v: Json) => v.image).filter(Boolean)])] as string[];
    for (const path of paths) {
      if (wooId(res.media[path]) !== null) continue;
      const { data: blob, error: dlErr } = await run.db.storage.from(STUDIO_BUCKET).download(path);
      if (dlErr || !blob) { res.error = 'image_missing'; break; }
      const k = built.images.indexOf(path); const v = built.variations.find((x: Json) => x.image === path);
      const ext = path.split('.').pop()!.toLowerCase();
      const fname = `${fileBase(item.nameEn)}-${String(k >= 0 ? k + 1 : 1).padStart(2, '0')}-${k >= 0 ? built.sku : v?.sku ?? built.sku}.${ext}`;
      const m = (await ctx.woo.upload('wp/v2/media', new Uint8Array(await blob.arrayBuffer()), fname, MIME[ext] ?? 'image/webp')).data;
      const mid = wooId(isObj(m) ? m.id : null);
      if (mid === null) { res.error = 'media_refused'; break; }
      res.media[path] = mid;
    }
    if (!res.error && wooId(res.productId) === null) {
      const p = (await ctx.woo.post('wc/v3/products', { ...built.product, images: built.images.map((path: string) => ({ id: res.media[path] })) })).data;
      res.productId = wooId(isObj(p) ? p.id : null);
      if (res.productId === null) res.error = 'product_refused';
    }
    if (!res.error && built.variations.length && !isObj(res.variations)) {
      const r = (await ctx.woo.post(`wc/v3/products/${res.productId}/variations/batch`, { create: built.variations.map((v: Json) => ({ ...v.payload, ...(v.image ? { image: { id: res.media[v.image] } } : {}) })) })).data;
      const created = isObj(r) && Array.isArray(r.create) ? r.create : [];
      const failed = created.filter((x: Json) => !isObj(x) || isObj(x.error) || wooId(x.id) === null).length + Math.max(0, built.variations.length - created.length);
      res.variations = { done: built.variations.length - failed, failed };
    }
    if (!res.error && built.ar && res.arId === undefined) {
      try {
        const a = (await ctx.woo.post('wc/v3/products', { ...built.ar, type: built.product.type, status: 'draft', wpml_language: 'ar', translation_of: res.productId })).data;
        const arId = wooId(isObj(a) ? a.id : null);
        const linked = isObj(a) && isObj(a.translations) && wooId(a.translations.en) === res.productId;
        if (arId !== null && !linked) { await ctx.woo.del(`wc/v3/products/${arId}`); res.arId = null; res.arNote = 'not_linked'; } else res.arId = arId;
      } catch (e) { if (!(e instanceof WooError)) throw e; res.arId = null; res.arNote = wooCode(e); }
    }
    if (!res.error && res.author !== 'ok') {
      const owner = wooId(vendor?.woo_vendor_id);
      if (owner === null) res.author = 'no_store';
      else {
        // Dokan's own route: an admin's post_author is written by update_post_author_if_needed when that user can
        // dokan_add_product (otherwise Dokan writes the caller) — so the answer's post_author is checked, not trusted.
        const setAuthor = async (id: number) => wooId(((await ctx.woo.put(`dokan/v1/products/${id}`, { post_author: owner })).data as Json)?.post_author) === owner;
        try {
          const ok = await setAuthor(res.productId) && (wooId(res.arId) === null || await setAuthor(res.arId));
          res.author = ok ? 'ok' : 'failed';
        } catch (e) { if (!(e instanceof WooError || e instanceof ConfigError)) throw e; res.author = 'failed'; }
      }
    }
    if (wooId(res.productId) !== null) {
      const fresh = [(await ctx.woo.get(`wc/v3/products/${res.productId}`)).data];
      if (wooId(res.arId) !== null) { try { fresh.push((await ctx.woo.get(`wc/v3/products/${res.arId}`)).data); } catch (e) { if (!(e instanceof WooError)) throw e; } }
      await writeProducts(ctx, fresh.filter(isObj));
    }
  } catch (e) {
    if (!(e instanceof WooError || e instanceof ConfigError)) throw e;
    res.error = wooCode(e);
  }
  await saveResult();
  await logSync(run.db, { ...entry, entity_id: res.productId == null ? entry.entity_id : String(res.productId), result: res.error ? 'error' : 'ok',
    detail: { batch: batchId, index, sku: built.sku, media: Object.keys(res.media).length, variations: res.variations ?? null, ar: res.arId ?? null, ar_note: res.arNote ?? null, author: res.author ?? null, error: res.error } });
  return json(200, { action: 'studio_upload', result: res.error ? 'error' : 'ok', item: res });
}

// category_create { name_en, name_ar?, parent? }: a new WooCommerce category in English and its Arabic translation
// (best effort, like studio_upload's), then into woo_categories.
const plainName = (v: unknown) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 80 && !/[<>%]/.test(v) ? v.trim() : null);
async function categoryCreate(run: Run, args: Json) {
  const name = plainName(args.name_en); const nameAr = args.name_ar == null || args.name_ar === '' ? null : plainName(args.name_ar);
  const parent = args.parent == null || args.parent === 0 ? 0 : wooId(args.parent);
  if (!name || (args.name_ar && !nameAr) || parent === null) return json(400, { error: 'bad_request' });
  const entry = { kind: 'push', direction: 'out', entity: 'woo_categories', entity_id: null, action: 'category_create' };
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled' } }); return json(200, { action: 'category_create', result: 'skipped', reason: 'push_disabled' }); }
  const ctx = await run.ctx();
  let c: Json;
  try { c = (await ctx.woo.post(CATEGORIES_PATH, { name, parent, wpml_language: 'en' })).data; }
  catch (e) { if (!(e instanceof WooError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_create', result: 'error', reason: wooCode(e) }); }
  const id = wooId(isObj(c) ? c.id : null);
  if (id === null) return json(502, { error: 'woo_error' });
  const rows: Json[] = [c];
  let arId: number | null = null;
  if (nameAr) {
    try { const a = (await ctx.woo.post(CATEGORIES_PATH, { name: nameAr, wpml_language: 'ar', translation_of: id })).data; arId = wooId(isObj(a) ? a.id : null); if (isObj(a)) rows.push(a); }
    catch (e) { if (!(e instanceof WooError)) throw e; }
  }
  await writeCategories(ctx, rows);
  await logSync(run.db, { ...entry, entity_id: String(id), result: 'ok', detail: { ar: arId } });
  return json(200, { action: 'category_create', result: 'ok', id, ar_id: arId });
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
    if (action === 'statement') return await statement(run, args);
    if (action === 'withdraw_approve') return await withdrawApprove(run, args);
    if (action === 'product_get') return await productGet(run, args);
    if (action === 'product_save') return await productSave(run, args);
    if (action === 'products_batch') return await productsBatch(run, args);
    if (action === 'products_trash' || action === 'products_restore') return await productsTrash(run, args, action === 'products_restore');
    if (action === 'products' && args.full === true) return await fullProducts(run);
    if (action === 'studio_upload') return await studioUpload(run, args);
    if (action === 'category_create') return await categoryCreate(run, args);
    if (action === 'withdrawals') {
      try {
        const w = await pullWithdrawals(run, await makersWithStore(run), run.now());
        const counts = { withdrawals: w.withdrawals, skipped: w.skipped, failed_rows: w.failedRows, pages: w.pages, done: w.done };
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', action: 'refresh', result: 'ok', detail: counts });
        return json(200, { action, result: 'ok', counts });
      } catch (e) {
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', action: 'refresh', result: 'error', detail: { error: errorText(e, makeScrubber(run.env)) } });
        if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
        return json(e instanceof WooError ? 502 : 500, { error: 'sync_failed', action });
      }
    }
    if (action === 'accounts') {
      try {
        const counts = await pullAccounts(run);
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'accounts', action: 'sync', result: 'ok', detail: counts });
        return json(200, { action, result: 'ok', counts });
      } catch (e) {
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'accounts', action: 'sync', result: 'error', detail: { error: errorText(e, makeScrubber(run.env)) } });
        if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
        return json(e instanceof WooError ? 502 : 500, { error: 'sync_failed', action });
      }
    }
    return await pull(run, action);
  } catch (e) {
    const isPush = action === 'push_status' || action === 'push_vendor' || action === 'withdraw_approve' || PRODUCT_ACTIONS.includes(action);
    const entity = action === 'push_status' ? 'order' : action === 'push_vendor' ? 'vendor' : action === 'withdraw_approve' ? 'dokan_withdrawals'
      : PRODUCT_ACTIONS.includes(action) || action === 'products' ? 'products' : 'webhooks';
    const entityId = action === 'push_status' ? wooId(args.order_id)?.toString() ?? null : action === 'push_vendor' && typeof args.vendor_id === 'string' ? args.vendor_id.slice(0, 36)
      : action === 'withdraw_approve' || action === 'product_get' || action === 'product_save' ? wooId(args.id)?.toString() ?? null : null;
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
