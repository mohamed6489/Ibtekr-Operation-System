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
//              An order with Dokan sub-orders (several makers) — the owner 11 Nov, «زي الـ automation»: its parent is never written,
//              since Dokan deletes and recreates the sub-orders of a multi-vendor parent on any REST update of it (getdokan/dokan PR
//              #3454 — the numbers changed at every status change): PUT wc/v3/orders/{sub} { status } on each current sub-order
//              (currentSubOrders — the ones the order's live lines point to; trashed ones never), like the owner's n8n automation;
//              sub_orders.woo_status from each answer; 404 / 410 = gone; any other failure → 502 after the rest; orders.woo_status
//              stays the site's parent.
//   'order_trash' { order_id }  (phase 5.5 decision 10, the owner 2 Nov: «لما أحذفه يتحذف من الموقع») the cancelled order and its
//              Dokan sub-orders go to the site's trash: DELETE wc/v3/orders/{id} with no `force` (never deleted for good), the
//              sub-orders (sub_orders.woo_order_id) first, then the parent; 404 / 410 (already trashed) count as done. The order
//              must be «ملغي» in our database (else skipped/not_cancelled, no Woo call); WOO_PUSH_ENABLED gates it
//              (skipped/push_disabled). A member with has_perm('orders.status') = 'F' only — never the sync secret. The adapter
//              marks the order deleted (RPC order_delete) after this answers ok / skipped.
//   'suborder_trash' { order_id, sub_id, reason }  (phase 13 decision 54, the owner 10 Nov: «مسح الأوردر الفرعي … يتحذف من
//              الموقع ويتشال من الأوردر الأصلي») one Dokan sub-order (sub_orders.woo_order_id) of an order that is not «مكتمل» /
//              «استرجاع» goes to the site's trash (DELETE wc/v3/orders/{sub}, never `force`; 404 / 410 = done; sub_orders.woo_status
//              'trash'), and its lines leave the order here (removed + dropped_at — 0079 keeps them removed whatever the sync brings
//              back), the hub's reservations of those lines released (releaseLines). The parent on the site is never written (the owner
//              11 Nov, «زي الـ automation»: Dokan recreates the sub-orders of a parent updated through the API — PR #3454): it keeps
//              those lines and its total; the answer's total is null. The order's only sub-order → 409 only_sub (the page deletes the order instead). The same
//              two permissions as order_trash; never the sync secret; WOO_PUSH_ENABLED gates it (skipped/push_disabled — nothing
//              changes here either: the lines would come back with the next sync).
//   'line_trash' { order_id, item_id, reason }  (the owner 11 Nov — «امسح منتج بعينه من الاوردر») one product off an order that is not
//              «مكتمل» / «استرجاع»: its line off the maker's Dokan sub-order (GET, the one line of the same product — else 409 sub_line,
//              nothing written; product_id null — WooCommerce recalculates the sub-order), flagged here (removed + dropped_at, 0079), the
//              hub's hold of that line released; the parent on the site is never written (the owner 11 Nov, «زي الـ automation» — PR
//              #3454) and the answer's total is null. An order of one maker (no sub-order): the line off the order itself (PUT, mirrored,
//              its total — no sub-order for Dokan to recreate); a line of an order with sub-orders that points to none → 409 sub_line.
//              Its sub-order's last line → 409 only_in_sub; the order's last line → 409 only_line. Same
//              permissions as suborder_trash; never the sync secret; WOO_PUSH_ENABLED.
//   'suborder_status' { order_id, sub_id, status }  (the owner 11 Nov, option «أ» — this lifts «never writes a sub-order's status»
//              for this action only) a Dokan sub-order's own status on the site: a WooCommerce slug status_map knows, PUT
//              wc/v3/orders/{sub} { status }, the answer's status kept in sub_orders.woo_status (another answer → 502). The team's
//              own line status (order_items.status) is untouched. Same permissions; never the sync secret; WOO_PUSH_ENABLED.
//   'vendor_store' { vendor_id, password, shop_url?, notify?, trusted?, featured? }  (the owner 11 Nov — «إضافة مبتكر» on the site)
//              a maker of ours without a store gets Dokan's «Add New Vendor»: POST dokan/v1/stores with his portal login, the
//              password the member typed (never stored nor logged), the shop URL, the row's store fields, the commission (admin
//              / sensitive.commission = F) and the bank (admin / sensitive.vendor_bank = F); then the row is linked to the new
//              store (woo_vendor_id, snapshot, mirrors) and his automatic brand tied to it. A taken login / e-mail links the
//              store with that e-mail when no maker of ours has it — after an earlier failed try for this maker, or by the admin
//              (else 409 store_unlinked). The admin or vendors.edit = F; never the sync secret; WOO_PUSH_ENABLED.
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
//              balance, ref } (title scrubbed; ref = Dokan's trn_id, the maker's order for dokan_orders — phase 5.5
//              decision 13). A member needs accounts.view <> N.
//   'withdraw_approve' { id }  (phase 4.1, the owner's one write from the accounts page) approves a Dokan withdraw request
//              that is pending in dokan_withdrawals and still pending on Dokan (GET, then PUT dokan/v1/withdraw/{id}
//              { status: 'approved' }; else skipped/stale and the mirror corrected); the maker's balance is read again.
//              WOO_PUSH_ENABLED gates it (skipped/push_disabled). The admin or has_perm('accounts.approve') = 'F' only —
//              never the sync secret. No cancel, no amount, nothing of the bank details logged or stored.
//   'withdrawals' (phase 4.1, decision 12: «تحديث من Dokan»)  the withdraw-request half of 'accounts' on demand: dokan/v1/withdraw
//              ?status=all → dokan_withdrawals (the same allow-list), read-only on Dokan; no balances. A member needs
//              accounts.view <> N (like 'statement').
//   'carts'  (phase 12 T7, decisions 7 / 13)  the visitor's abandoned carts from the site's snippet (tools/wp-snippets/ibtekr-carts.php
//              over CartFlows' table) — GET ibtekr/v1/carts?hours=48 with the WC keys → cs_carts on cart_id (the phone and e-mail
//              the visitor typed, the total, the item count, the plugin's status and recovery link; never the contents). The snippet
//              not installed (404, or 401 invalid_username — the route unknown to WordPress) = ok with installed: false, no error
//              row. The cron woo-sync-carts (0062) ran it every 10 minutes — off since 0085 (the owner keeps the snippet off); by hand the admin.
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
//              parent? } products.add = F: a new category + its translation. WOO_PUSH_ENABLED gates both. 'studio_sheet' { url }
//              products.add = F (decision 13): the CSV of a Google Sheets link (published, or shared with anyone), read here —
//              Google answers it with no CORS after its redirect — from the URL built from the link's id (woo-studio.js
//              fetchSheetCsv); nothing is written or logged.
//   'product_images_add' { id, paths, first? }  products.edit = F (phase 5.4 T8): the images tool's results (bucket ai-images,
//              the member's own folder — the admin any) onto a site product: each downloaded and sent to wp/v2/media, then one
//              PUT with the product's current images + the new ones (first: ahead of them). WOO_PUSH_ENABLED gates it.
//   'register_webhooks' { delivery_url? }  ensures one active `ibtekr-ops:<topic>` webhook per topic pointing at
//              {SUPABASE_URL}/functions/v1/woo-webhook; any other webhook on the site (n8n's) is never touched.
// Answer: 200 { action, result, counts, … } or 4xx / 5xx { error }. CORS for the browser's functions.invoke.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { START_DATE, SYNC_FIELDS, bankDigest, mapStore, nextCursor, outgoingWooStatus, storeSnapshot, toDokanStore } from '../_shared/woo-core.js';
import { getState, logSync, setState, upsertRows } from '../_shared/db.js';
import { PAY_STATUSES, orderCreateInput, orderPayable, payUrl, wooOrderBody } from '../_shared/woo-order-create.js';
import { vaultEnv } from '../_shared/secrets.js';
import { ConfigError, WooError, errorText, makeScrubber, wooApi } from '../_shared/woo-api.js';
import { AR_FIELDS, BATCH_FIELDS, EDIT_FIELDS, VARIATION_FIELDS, cleanFields, editView, sharedOf, toWoo, variationView } from '../_shared/woo-products.js';
import { STUDIO_ATTRS, buildStudio, fetchSheetCsv, matchWooBrand } from '../_shared/woo-studio.js';
import { duplicateAr, duplicatePayload, duplicateSku, duplicateVariation, variationSku } from '../_shared/woo-duplicate.js';
import { OWNED, siteQuantities, skuList } from '../_shared/woo-inventory.js';
import { CART_HOURS, CART_PATH, cartRows } from '../_shared/woo-carts.js';
import { VENDOR_SYNC_COLUMNS, applyPushResult, effectiveRates, gmtIso, loadBanks, loadTree, logActivity, markPushPending, pushStoreFields, retryablePush, saveVendors, wooId, writeBrands, writeCategories, releaseLines, writeContext, writeOrderPage, writeOrders, writeProducts, writeStates } from '../_shared/woo-write.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: Db; now: () => string; userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null> };
type Ctx = Awaited<ReturnType<typeof writeContext>>;
type Run = { db: Db; env: Deps['env']; woo: () => ReturnType<typeof wooApi>; ctx: () => Promise<Ctx>; kind: 'cron' | 'manual'; now: () => string };

const ACTIONS = ['states', 'categories', 'orders', 'vendors', 'products', 'all', 'push_status', 'push_vendor', 'register_webhooks', 'probe_store', 'probe_dokan', 'accounts', 'statement', 'withdraw_approve', 'withdraw_create', 'withdrawals', 'order_trash', 'suborder_trash', 'line_trash', 'suborder_status', 'order_create', 'order_pay_link',
  'vendor_photo', 'vendor_store', 'product_get', 'product_save', 'products_batch', 'products_vendor', 'products_trash', 'products_restore', 'studio_upload', 'category_create', 'studio_sheet', 'product_images_add', 'inventory_push', 'product_duplicate', 'carts',
  'category_get', 'category_update', 'category_delete'];
// phase 5: the product actions a person runs (never the sync secret); phase 5.2: the studio's upload, a new category, a sheet link;
// phase 5.4: the images tool's results onto a product; B4 (11 Nov): the categories tab's read, edit and delete
const PRODUCT_ACTIONS = ['product_get', 'product_save', 'products_batch', 'products_vendor', 'products_trash', 'products_restore', 'studio_upload', 'category_create', 'studio_sheet', 'product_images_add', 'inventory_push', 'product_duplicate',
  'category_get', 'category_update', 'category_delete'];
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
    if (action === 'withdraw_approve' || action === 'withdraw_create') return null; // a person approves / asks, never the cron / sync secret (phase 4.1; 0078)
    if (action === 'order_trash' || action === 'suborder_trash' || action === 'line_trash' || action === 'suborder_status') return null; // a person deletes an order / a sub-order, never the cron / sync secret (phase 5.5 decision 10, phase 13 decision 54)
    if (action === 'order_create' || action === 'order_pay_link') return null; // a person makes an order from the chat (phase 13 T3)
    if (action === 'vendor_photo' || action === 'vendor_store') return null; // a person sets a maker's photo / makes his store (phase 13 decision 51; 11 Nov)
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
  // phase 5.5 decision 10: the site trash needs the same two permissions RPC order_delete checks — orders.status = F and orders.view <> N
  if (action === 'order_trash' || action === 'suborder_trash' || action === 'line_trash' || action === 'suborder_status') { if (!(await perm('orders.status'))) return null; const { data, error } = await member.rpc('has_perm', { key: 'orders.view' }); return !error && (data === 'F' || data === 'P') ? 'member' : null; }
  // phase 13 T3 (decision 7): an order from the customer-service chat and its pay link — the admin or orders.status = F
  if (action === 'order_create' || action === 'order_pay_link') return (await admin()) || (await perm('orders.status')) ? 'member' : null;
  if (action === 'statement' || action === 'withdrawals') { const { data, error } = await member.rpc('has_perm', { key: 'accounts.view' }); return !error && (data === 'F' || data === 'P') ? 'member' : null; }
  // phase 4.1 (decision 1): approving a Dokan withdraw request — the admin or accounts.approve = F (has_perm carries aal2)
  if (action === 'withdraw_approve') return (await admin()) || (await perm('accounts.approve')) ? 'member' : null;
  // 0078 (the owner, 11 Nov — «تسوية دلوقتي»): a request for the maker's whole Dokan balance — the same people who approve one
  if (action === 'withdraw_create') return (await admin()) || (await perm('accounts.approve')) ? 'member' : null;
  // phase 5 (decision 5): reading a product live needs products.view <> N; editing products.edit = F; the trash products.trash = F
  if (action === 'product_get') { const { data, error } = await member.rpc('has_perm', { key: 'products.view' }); return !error && (data === 'F' || data === 'P') ? 'member' : null; }
  if (action === 'product_save' || action === 'product_images_add') return (await admin()) || (await perm('products.edit')) ? 'member' : null;
  if (action === 'products_batch' || action === 'products_vendor') return (await admin()) || (await perm('products.bulk')) ? 'member' : null; // the owner, 28 Oct: bulk edit is its own permission
  if (action === 'products_trash' || action === 'products_restore') return (await admin()) || (await perm('products.trash')) ? 'member' : null;
  // phase 5.2 (decisions 7 / 8 / 13): the studio's upload, a new category and reading a sheet link need products.add = F
  if (action === 'studio_upload' || action === 'category_create' || action === 'studio_sheet') return (await admin()) || (await perm('products.add')) ? 'member' : null;
  // B4 (the owner, 11 Nov): the categories tab — reading one for «تعديل», editing and deleting it — the same people who add one
  if (action === 'category_get' || action === 'category_update' || action === 'category_delete') return (await admin()) || (await perm('products.add')) ? 'member' : null;
  // phase 12 T2 (decision 9): a copy of a product is a new product — products.add = F, like the studio
  if (action === 'product_duplicate') return (await admin()) || (await perm('products.add')) ? 'member' : null;
  // phase 7 (decision 1 c): the site quantity from the hub — the admin, or inventory.edit = F AND products.edit = F (a person, never the
  // sync secret): a lot's mode and SKU are the member's own input, so pushing needs the right that already sets a product's stock
  if (action === 'inventory_push') return (await admin()) || ((await perm('inventory.edit')) && (await perm('products.edit'))) ? 'member' : null;
  // phase 13 decision 51: the maker's photo (recorded, then set as the Dokan store's photo) — the admin or vendors.edit = F
  if (action === 'vendor_photo') return (await admin()) || (await perm('vendors.edit')) ? 'member' : null;
  // the owner, 11 Nov: a maker's store on the site — the people who add a maker (the commission and the bank follow their own rules inside)
  if (action === 'vendor_store') return (await admin()) || (await perm('vendors.edit')) ? 'member' : null;
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
  // the owner (2 Nov): a store gone from the site → its maker is marked here (site_removed_at, the status inactive) — never
  // deleted: orders, the accounts and the brands' history point at it; the admin removes it from the drawer. Back on the site →
  // the mark lifts. Only after a complete run that saw at least one store (a bad answer must not mark everyone).
  const removed: string[] = []; const back: string[] = [];
  if (res.done && ctx.vendors.size) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await run.db.from('vendors').select('id, woo_vendor_id, site_removed_at').order('id').range(from, from + 999);
      if (error) throw new Error(`vendors: ${error.message}`);
      const rows = (data ?? []) as Json[];
      for (const v of rows) {
        const w = wooId(v.woo_vendor_id); if (w === null) continue;
        if (!ctx.vendors.has(w) && !v.site_removed_at) removed.push(String(v.id));
        else if (ctx.vendors.has(w) && v.site_removed_at) back.push(String(v.id));
      }
      if (rows.length < 1000) break;
    }
    if (removed.length) await run.db.from('vendors').update({ site_removed_at: run.now(), status: 'inactive' }).in('id', removed);
    if (back.length) await run.db.from('vendors').update({ site_removed_at: null }).in('id', back);
  }
  return { vendors, ...ctx.vendorSync, removed: removed.length, back: back.length, pages: res.pages, done: res.done };
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
  // An order with Dokan sub-orders: the status goes to each sub-order, never the parent (the owner 11 Nov — Dokan PR #3454).
  const subs = await currentSubOrders(run.db, id);
  if (subs.length) return await pushSubStatuses(run, ctx.woo, entry, status, slug, subs);
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

// The owner 11 Nov («زي الـ automation»): Dokan deletes and recreates the sub-orders of a multi-vendor parent whenever that parent is
// updated through the REST API (getdokan/dokan PR #3454), so the system never writes the parent of an order that has sub-orders.
// currentSubOrders: the order's Dokan sub-orders on the site now — the ones its live lines point to (a re-split by Dokan leaves older
// rows behind), else every sub-order row of the order; a trashed one never. [] = an order of one maker (no sub-order).
type SubRef = { id: number; woo: number; status: string | null };
async function currentSubOrders(db: Db, id: number): Promise<SubRef[]> {
  const { data: rows, error } = await db.from('sub_orders').select('id, woo_order_id, woo_status').eq('order_id', id);
  if (error) throw new Error(`sub_orders: ${error.message}`);
  const all: SubRef[] = [];
  for (const r of (rows ?? []) as Json[]) {
    const woo = wooId(r.woo_order_id), status = typeof r.woo_status === 'string' ? r.woo_status : null;
    if (woo !== null && woo !== id && status !== 'trash') all.push({ id: Number(r.id), woo, status });
  }
  if (!all.length) return [];
  const { data: lines, error: lineErr } = await db.from('order_items').select('sub_order_id').eq('order_id', id).eq('removed', false);
  if (lineErr) throw new Error(`order_items: ${lineErr.message}`);
  const linked = new Set(((lines ?? []) as Json[]).map((l) => Number(l.sub_order_id)).filter((n) => Number.isInteger(n) && n > 0));
  const live = all.filter((s) => linked.has(s.id));
  return live.length ? live : all;
}
// push_status on an order with sub-orders: PUT wc/v3/orders/{sub} { status } on each, like the owner's n8n automation; the answer's
// status kept in sub_orders.woo_status; 404 / 410 = gone (not a failure); any other refusal is counted and answered 502 after the rest.
async function pushSubStatuses(run: Run, woo: ReturnType<typeof wooApi>, entry: Json, status: string, slug: string, subs: SubRef[]) {
  const done: number[] = [], failed: number[] = []; let gone = 0, first: string | null = null;
  for (const s of subs) {
    let after: Json;
    try { after = (await woo.put(`wc/v3/orders/${s.woo}`, { status: slug })).data ?? {}; } catch (e) {
      if (e instanceof WooError && (e.status === 404 || e.status === 410)) { gone += 1; continue; }
      if (!(e instanceof WooError)) throw e;
      failed.push(s.woo); first ??= errorText(e, woo.scrub); continue;
    }
    const now = isObj(after) && typeof after.status === 'string' ? after.status : null;
    if (now !== slug) { failed.push(s.woo); first ??= `kept ${now ?? '—'}`; continue; }
    const { error } = await run.db.from('sub_orders').update({ woo_status: now }).eq('id', s.id);
    if (error) throw new Error(`sub_orders: ${error.message}`);
    done.push(s.woo);
  }
  const detail = { status, woo_status: slug, subs: done, ...(gone ? { gone } : {}), ...(failed.length ? { failed, error: first } : {}) };
  await logSync(run.db, { ...entry, result: failed.length ? 'error' : 'ok', detail });
  if (failed.length) return json(502, { error: 'woo_error', subs: done, failed });
  return json(200, { action: 'push_status', result: 'ok', conflict: false, subs: done, woo_status: slug, counts: { pushed: done.length } });
}

// ---------------------------------------------------------------- order_trash (phase 5.5 decision 10)

// ---------------------------------------------------------------- an order from the chat (phase 13 T3, decision 7)
// POST wc/v3/orders: pending and unpaid, the customer's name / phone / address from our row (the browser sends the customer id only),
// the lines by product id from the mirror (a trashed or unknown product is refused), then the order mirrored at once; the answer is the
// pay link (WooCommerce's payment_url, else built from the order key). Nothing is paid or shipped here.
async function orderCreate(run: Run, args: Json) {
  const inp = orderCreateInput(args);
  if ('error' in inp) return json(400, inp);
  if (!pushEnabled(run.env)) { await logSync(run.db, { kind: 'push', direction: 'out', entity: 'order', entity_id: '', action: 'create', result: 'skipped', detail: { reason: 'push_disabled' } }); return json(200, { action: 'order_create', result: 'skipped', reason: 'push_disabled' }); }
  const { data: cu } = await run.db.from('cs_customers').select('id, name, phone, city, province, address, address2, merged_into, blocked_at').eq('id', inp.customer_id).maybeSingle();
  if (!isObj(cu) || cu.merged_into) return json(404, { error: 'customer_not_found' });
  if (!cu.phone) return json(409, { error: 'no_phone' });
  const ids = [...new Set(inp.items.flatMap((it) => [it.product_id, it.variation_id]).filter((x): x is number => x !== null))];
  const { data: prods } = await run.db.from('products').select('id, trashed_at').in('id', ids);
  const known = new Map((Array.isArray(prods) ? prods : []).map((p: Json) => [Number(p.id), p]));
  for (const id of ids) { const p = known.get(id); if (!p || p.trashed_at) return json(400, { error: 'bad_request', field: 'product', product_id: id }); }
  const ctx = await run.ctx();
  let order: Json;
  try { order = (await ctx.woo.post('wc/v3/orders', wooOrderBody({ customer: cu, items: inp.items, note: inp.note, conversationId: inp.conversation_id }))).data as Json; }
  catch (e) {
    await logSync(run.db, { kind: 'push', direction: 'out', entity: 'order', entity_id: '', action: 'create', result: 'error', detail: { error: errorText(e, ctx.woo.scrub) } });
    if (e instanceof WooError) return json(502, { error: 'woo_error', status: e.status });
    throw e;
  }
  const id = wooId(order?.id); if (id === null) return json(502, { error: 'woo_error' });
  const w = await writeOrders(ctx, [order]); // mirrored now (the webhook will say the same again)
  const url = payUrl(run.env.WOO_URL ?? '', order);
  await logSync(run.db, { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'create', result: 'ok', detail: { lines: inp.items.length, mirrored: w.written.includes(id), conversation: inp.conversation_id } });
  return json(200, { action: 'order_create', result: 'ok', id, number: typeof order.number === 'string' || typeof order.number === 'number' ? String(order.number) : String(id), payment_url: url });
}
// the pay link of an order of this customer that still waits for its payment — read live from WooCommerce (the order key never sits
// in our mirror: phase 2's privacy rule on raw), so the link is as fresh as the shop's
async function orderPayLink(run: Run, args: Json) {
  const id = wooId(args.order_id); if (id === null) return json(400, { error: 'bad_request', field: 'order_id' });
  const customerId = typeof args.customer_id === 'string' && UUID.test(args.customer_id) ? args.customer_id : null;
  const { data: o } = await run.db.from('orders').select('id, number, status, customer_phone, deleted_at').eq('id', id).maybeSingle();
  if (!isObj(o) || o.deleted_at) return json(404, { error: 'order_not_found' });
  if (customerId) { // the order must be this customer's (the same normalised phone)
    const { data: cu } = await run.db.from('cs_customers').select('phone').eq('id', customerId).maybeSingle();
    const norm = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0020/, '').replace(/^20(?=\d{10}$)/, '0');
    if (!isObj(cu) || !cu.phone || norm(cu.phone) !== norm(o.customer_phone)) return json(404, { error: 'order_not_found' });
  }
  if (!orderPayable(o.status)) return json(409, { error: 'not_payable', status: o.status, payable: PAY_STATUSES });
  let live: Json;
  try { live = (await run.woo().get(`wc/v3/orders/${id}`)).data as Json; } catch (e) { if (e instanceof WooError) return json(502, { error: 'woo_error', status: e.status }); throw e; }
  const url = payUrl(run.env.WOO_URL ?? '', { id, order_key: isObj(live) ? live.order_key : null, payment_url: isObj(live) ? live.payment_url : null });
  if (!url) return json(409, { error: 'no_key' });
  return json(200, { action: 'order_pay_link', result: 'ok', id, number: String(o.number ?? id), url });
}

async function orderTrash(run: Run, args: Json) {
  const id = wooId(args.order_id);
  if (id === null) return json(400, { error: 'bad_request' });
  const { data: order, error } = await run.db.from('orders').select('id, status').eq('id', id).is('deleted_at', null).maybeSingle(); // an order already marked deleted is gone for members too
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return json(404, { error: 'order_not_found' });
  const entry = { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'trash' };
  const skip = async (reason: string, extra: Json = {}) => {
    await logSync(run.db, { ...entry, result: 'skipped', detail: { reason, ...extra } });
    return json(200, { action: 'order_trash', result: 'skipped', reason, counts: { trashed: 0, already: 0 } });
  };
  if (order.status !== 'ملغي') return await skip('not_cancelled', { current: order.status });
  if (!pushEnabled(run.env)) return await skip('push_disabled');
  const { data: subs, error: subErr } = await run.db.from('sub_orders').select('woo_order_id').eq('order_id', id);
  if (subErr) throw new Error(`sub_orders: ${subErr.message}`);
  const subIds: number[] = []; for (const r of (subs ?? []) as Json[]) { const n = wooId(r.woo_order_id); if (n !== null && n !== id) subIds.push(n); }
  const woo = run.woo();
  let trashed = 0, already = 0;
  for (const oid of [...subIds, id]) { // the sub-orders first: Dokan trashes them with the parent, a second DELETE is then 410
    try { await woo.del(`wc/v3/orders/${oid}`); trashed += 1; } catch (e) {
      if (e instanceof WooError && (e.status === 404 || e.status === 410)) { already += 1; continue; }
      throw e;
    }
  }
  await logSync(run.db, { ...entry, result: 'ok', detail: { trashed, already, sub_orders: subIds.length } });
  return json(200, { action: 'order_trash', result: 'ok', counts: { trashed, already } });
}

// ---------------------------------------------------------------- suborder_trash (phase 13 decision 54)
const CLOSED_ORDER = ['مكتمل', 'استرجاع'];
async function suborderTrash(run: Run, args: Json) {
  const id = wooId(args.order_id), sid = wooId(args.sub_id);
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (id === null || sid === null || sid === id || !reason || reason.length > 120) return json(400, { error: 'bad_request' });
  const { data: order, error } = await run.db.from('orders').select('id, number, status').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return json(404, { error: 'order_not_found' });
  const entry = { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'suborder_trash' };
  if (CLOSED_ORDER.includes(String(order.status))) return json(409, { error: 'closed', status: order.status });
  const { data: sub } = await run.db.from('sub_orders').select('id, woo_order_id').eq('order_id', id).eq('woo_order_id', sid).maybeSingle();
  if (!isObj(sub)) return json(404, { error: 'sub_not_found' });
  const { data: lines, error: lineErr } = await run.db.from('order_items').select('id, sub_order_id').eq('order_id', id).eq('removed', false);
  if (lineErr) throw new Error(`order_items: ${lineErr.message}`);
  const all = (lines ?? []) as Json[];
  const mine = all.filter((l) => Number(l.sub_order_id) === Number(sub.id)).map((l) => Number(l.id));
  if (!mine.length) return json(404, { error: 'sub_not_found' });
  if (mine.length === all.length) return json(409, { error: 'only_sub' });
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled', sub: sid } }); return json(200, { action: 'suborder_trash', result: 'skipped', reason: 'push_disabled' }); }
  const woo = run.woo();
  let already = false;
  try { await woo.del(`wc/v3/orders/${sid}`); } catch (e) {
    if (e instanceof WooError && (e.status === 404 || e.status === 410)) already = true;
    else { await logSync(run.db, { ...entry, result: 'error', detail: { step: 'trash', sub: sid, error: errorText(e, woo.scrub) } }); if (e instanceof WooError) return json(502, { error: 'woo_error', step: 'trash' }); throw e; }
  }
  // the owner 11 Nov («زي الـ automation»): the parent on the site is never written (Dokan would recreate its sub-orders — PR #3454);
  // the sub-order's lines leave the order here (removed + dropped_at: 0079 keeps them removed whatever the sync brings back)
  await dropLines(run.db, mine, run.now());
  const { error: subErr } = await run.db.from('sub_orders').update({ woo_status: 'trash' }).eq('id', sub.id);
  if (subErr) throw new Error(`sub_orders: ${subErr.message}`);
  const ctx = await run.ctx();
  let released = 0;
  try { released = await releaseLines(ctx, { ref: 'IB-' + (order.number ?? id), itemIds: mine, sid }); } catch (e) { await logSync(run.db, { ...entry, result: 'error', detail: { step: 'release', error: errorText(e, woo.scrub) } }); }
  await logSync(run.db, { ...entry, result: 'ok', detail: { sub: sid, lines: mine.length, already, released } });
  return json(200, { action: 'suborder_trash', result: 'ok', lines: mine.length, already, released, total: null });
}
// lines the system took off an order with sub-orders: removed + dropped_at (0079), the parent on the site untouched
async function dropLines(db: Db, ids: number[], at: string) {
  if (!ids.length) return;
  const { error } = await db.from('order_items').update({ removed: true, dropped_at: at }).in('id', ids);
  if (error) throw new Error(`order_items: ${error.message}`);
}

// ---------------------------------------------------------------- line_trash (the owner 11 Nov — «لو عايز امسح منتج بعينه من الاوردر»)
// One product off an order: its line off the maker's Dokan sub-order (found by product + quantity + total — refused when it is not one
// line; product_id null, WooCommerce recalculates the sub-order) and flagged here (dropped_at, 0079) — the parent on the site is never
// written for an order with sub-orders (the owner 11 Nov, PR #3454); an order of one maker: off the order itself (PUT, mirrored). The
// hub's hold released. The last line of a sub-order → 409 only_in_sub (the page deletes the sub-order); the last line of the order →
// 409 only_line (the order).
async function lineTrash(run: Run, args: Json) {
  const id = wooId(args.order_id), item = wooId(args.item_id);
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (id === null || item === null || !reason || reason.length > 120) return json(400, { error: 'bad_request' });
  const { data: order, error } = await run.db.from('orders').select('id, number, status').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return json(404, { error: 'order_not_found' });
  if (CLOSED_ORDER.includes(String(order.status))) return json(409, { error: 'closed', status: order.status });
  const { data: lines, error: lineErr } = await run.db.from('order_items').select('id, sub_order_id, product_id, qty, total').eq('order_id', id).eq('removed', false);
  if (lineErr) throw new Error(`order_items: ${lineErr.message}`);
  const all = (lines ?? []) as Json[]; const line = all.find((l) => Number(l.id) === item);
  if (!line) return json(404, { error: 'line_not_found' });
  if (all.length === 1) return json(409, { error: 'only_line' });
  let sid: number | null = null;
  if (line.sub_order_id != null) {
    const { data: sub } = await run.db.from('sub_orders').select('id, woo_order_id').eq('id', line.sub_order_id).maybeSingle();
    const w = isObj(sub) ? wooId(sub.woo_order_id) : null; if (w !== null && w !== id) sid = w;
    if (sid !== null && all.filter((l) => Number(l.sub_order_id) === Number(line.sub_order_id)).length === 1) return json(409, { error: 'only_in_sub', sub: sid });
  }
  // an order with sub-orders whose line points to none: its maker's sub-order is unknown, and the parent is never written (PR #3454)
  if (sid === null && (await currentSubOrders(run.db, id)).length) return json(409, { error: 'sub_line', matches: 0 });
  const entry = { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'line_trash' };
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled', line: item } }); return json(200, { action: 'line_trash', result: 'skipped', reason: 'push_disabled' }); }
  const woo = run.woo();
  const fail = async (step: string, e: unknown, extra: Json = {}) => {
    await logSync(run.db, { ...entry, result: 'error', detail: { step, line: item, ...extra, error: e ? errorText(e, woo.scrub) : undefined } });
    if (!e || e instanceof WooError) return json(502, { error: 'woo_error', step }); throw e;
  };
  if (sid !== null) { // the maker's sub-order first: a refusal there leaves the parent as it was
    let subOrder: Json;
    try { subOrder = (await woo.get(`wc/v3/orders/${sid}`)).data as Json; } catch (e) { return await fail('sub_read', e); }
    const pid = wooId(line.product_id); const qty = Number(line.qty) || 0; const tot = Number(line.total) || 0;
    const items = isObj(subOrder) && Array.isArray(subOrder.line_items) ? subOrder.line_items.filter(isObj) : [];
    let hits = items.filter((li: Json) => pid !== null && (wooId(li.product_id) === pid || wooId(li.variation_id) === pid));
    if (hits.length > 1) hits = hits.filter((li: Json) => Number(li.quantity) === qty && Math.abs(Number(li.total) - tot) < 0.01);
    if (hits.length !== 1) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'sub_line', line: item, sub: sid, matches: hits.length } }); return json(409, { error: 'sub_line', matches: hits.length }); }
    const subLine = wooId(hits[0].id);
    let after: Json;
    try { after = (await woo.put(`wc/v3/orders/${sid}`, { line_items: [{ id: subLine, product_id: null }] })).data as Json; } catch (e) { return await fail('sub_line', e, { sub: sid }); }
    if (isObj(after) && Array.isArray(after.line_items) && after.line_items.some((li: Json) => wooId(li?.id) === subLine)) return await fail('sub_line', null, { sub: sid, kept: 1 });
    // the owner 11 Nov («زي الـ automation»): the parent on the site is never written (Dokan would recreate its sub-orders — PR
    // #3454); the line leaves the order here (removed + dropped_at, 0079) and the parent keeps it and its total
    await dropLines(run.db, [item], run.now());
    const ctx = await run.ctx();
    let released = 0;
    try { released = await releaseLines(ctx, { ref: 'IB-' + (order.number ?? id), itemIds: [item], sid: null }); } catch (e) { await logSync(run.db, { ...entry, result: 'error', detail: { step: 'release', error: errorText(e, woo.scrub) } }); }
    await logSync(run.db, { ...entry, result: 'ok', detail: { line: item, sub: sid, released } });
    return json(200, { action: 'line_trash', result: 'ok', sub: sid, released, total: null });
  }
  // an order of one maker (no sub-order): the line off the order itself — no sub-order for Dokan to recreate
  let parent: Json;
  try { parent = (await woo.put(`wc/v3/orders/${id}`, { line_items: [{ id: item, product_id: null }] })).data as Json; } catch (e) { return await fail('lines', e); }
  if (isObj(parent) && Array.isArray(parent.line_items) && parent.line_items.some((li: Json) => wooId(li?.id) === item)) { await logSync(run.db, { ...entry, result: 'error', detail: { step: 'lines', line: item, kept: 1 } }); return json(502, { error: 'woo_kept_lines' }); }
  const ctx = await run.ctx();
  await writeOrders(ctx, [parent]); // the line flagged removed, the total from WooCommerce
  let released = 0;
  try { released = await releaseLines(ctx, { ref: 'IB-' + (order.number ?? id), itemIds: [item], sid: null }); } catch (e) { await logSync(run.db, { ...entry, result: 'error', detail: { step: 'release', error: errorText(e, woo.scrub) } }); }
  await logSync(run.db, { ...entry, result: 'ok', detail: { line: item, sub: sid, released } });
  return json(200, { action: 'line_trash', result: 'ok', sub: sid, released, total: isObj(parent) ? parent.total ?? null : null });
}

// ---------------------------------------------------------------- suborder_status (the owner 11 Nov, option «أ»)
// A Dokan sub-order's own status on the site — one of the statuses status_map knows on WooCommerce; the sub-order's own number only
// (an order of one maker has no sub-order — its status is the order's); WooCommerce's answer is what is kept (sub_orders.woo_status).
async function suborderStatus(run: Run, args: Json) {
  const id = wooId(args.order_id), sid = wooId(args.sub_id); const status = typeof args.status === 'string' ? args.status.trim() : '';
  if (id === null || sid === null || sid === id || !/^[a-z0-9-]{2,30}$/.test(status)) return json(400, { error: 'bad_request' });
  const { data: order, error } = await run.db.from('orders').select('id, status').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(`orders: ${error.message}`);
  if (!order) return json(404, { error: 'order_not_found' });
  const { data: sub } = await run.db.from('sub_orders').select('id, woo_order_id, woo_status').eq('order_id', id).eq('woo_order_id', sid).maybeSingle();
  if (!isObj(sub)) return json(404, { error: 'sub_not_found' });
  const { data: map, error: mapErr } = await run.db.from('status_map').select('woo_status');
  if (mapErr) throw new Error(`status_map: ${mapErr.message}`);
  const known = new Set(((map ?? []) as Json[]).map((r) => r.woo_status).filter((x) => typeof x === 'string' && x));
  if (!known.has(status)) return json(400, { error: 'bad_status' });
  const entry = { kind: 'push', direction: 'out', entity: 'order', entity_id: String(id), action: 'suborder_status' };
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled', sub: sid } }); return json(200, { action: 'suborder_status', result: 'skipped', reason: 'push_disabled' }); }
  const woo = run.woo();
  let after: Json;
  try { after = (await woo.put(`wc/v3/orders/${sid}`, { status })).data as Json; } catch (e) {
    await logSync(run.db, { ...entry, result: 'error', detail: { sub: sid, status, error: errorText(e, woo.scrub) } });
    if (e instanceof WooError) return json(502, { error: 'woo_error' }); throw e;
  }
  const now = isObj(after) && typeof after.status === 'string' ? after.status : null;
  if (now !== status) { await logSync(run.db, { ...entry, result: 'error', detail: { sub: sid, status, got: now } }); return json(502, { error: 'woo_kept_status', status: now }); }
  const { error: upErr } = await run.db.from('sub_orders').update({ woo_status: now }).eq('id', sub.id);
  if (upErr) throw new Error(`sub_orders: ${upErr.message}`);
  await logSync(run.db, { ...entry, result: 'ok', detail: { sub: sid, from: sub.woo_status ?? null, to: now } });
  return json(200, { action: 'suborder_status', result: 'ok', sub: sid, status: now });
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

// ---------------------------------------------------------------- vendor_photo (phase 13 decision 51)

// vendor_photo { vendor_id, path }: the photo the member uploaded into vendor-photos/<vendor id>/… (the bucket's policy checked the
// right) is recorded on the maker (vendors.photo_path — the server's column); when the maker has a store on the site and
// WOO_PUSH_ENABLED = 1 it goes to wp/v2/media and becomes the store's photo (Dokan `gravatar_id`), the mirror logo_url follows the
// media's URL. Without a store / with the switch off the photo stays in the system (result ok, site skipped). The log holds ids only.
const PHOTO_BUCKET = 'vendor-photos';
// PNG (89 50 4E 47), JPEG (FF D8 FF), WebP (RIFF....WEBP)
function isPhotoBytes(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}
const PHOTO_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$/i;
async function vendorPhoto(run: Run, args: Json) {
  const vendorId = typeof args.vendor_id === 'string' && UUID.test(args.vendor_id) ? args.vendor_id.toLowerCase() : null;
  const path = typeof args.path === 'string' ? args.path : '';
  const m = PHOTO_PATH.exec(path);
  if (vendorId === null || !m || m[1].toLowerCase() !== vendorId) return json(400, { error: 'bad_request', field: 'path' });
  const { data: row, error } = await run.db.from('vendors').select('id, woo_vendor_id').eq('id', vendorId).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (!row) return json(404, { error: 'vendor_not_found' });
  const { data: blob, error: dlErr } = await run.db.storage.from(PHOTO_BUCKET).download(path);
  if (dlErr || !blob) return json(404, { error: 'not_found', field: 'path' });
  // the bucket trusts the uploader's content-type: the bytes themselves must be a PNG / JPEG / WebP before anything is kept or sent
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPhotoBytes(bytes) || bytes.length > 5 * 1048576) return json(400, { error: 'bad_type', field: 'path' });
  const { error: upErr } = await run.db.from('vendors').update({ photo_path: path }).eq('id', vendorId);
  if (upErr) throw new Error(`vendors photo: ${upErr.message}`);
  const storeId = wooId(row.woo_vendor_id);
  const entry = { kind: 'push', direction: 'out', entity: 'vendor', entity_id: storeId === null ? vendorId : String(storeId), action: 'vendor_photo' };
  if (storeId === null || !pushEnabled(run.env)) {
    const reason = storeId === null ? 'no_store' : 'push_disabled';
    await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason } });
    return json(200, { action: 'vendor_photo', result: 'ok', site: 'skipped', reason });
  }
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const ctx = await run.ctx();
  try {
    const mid = await storePhoto(run, ctx, vendorId, storeId, bytes, ext);
    if (mid === null) { await logSync(run.db, { ...entry, result: 'error', detail: { vendor_id: vendorId, error: 'media_refused' } }); return json(502, { error: 'media_refused' }); }
    await logSync(run.db, { ...entry, result: 'ok', detail: { vendor_id: vendorId, media: mid } });
    return json(200, { action: 'vendor_photo', result: 'ok', site: 'ok', media: mid });
  } catch (e) {
    if (!(e instanceof WooError)) throw e;
    await logSync(run.db, { ...entry, result: 'error', detail: { vendor_id: vendorId, error: errorText(e, ctx.woo.scrub) } });
    return json(502, { error: 'woo_error', action: 'vendor_photo', saved: true });
  }
}
// The photo's bytes → wp/v2/media → the store's photo (Dokan gravatar_id); the mirror logo_url follows. → the media id, or null when
// the site did not take the file. WooError passes to the caller.
async function storePhoto(run: Run, ctx: Ctx, vendorId: string, storeId: number, bytes: Uint8Array, ext: string): Promise<number | null> {
  const media = (await ctx.woo.upload('wp/v2/media', bytes, `maker-${storeId}-${run.now().replace(/[^0-9]/g, '').slice(2, 12)}.${ext}`, MIME[ext] ?? 'image/png')).data;
  const mid = wooId(isObj(media) ? media.id : null);
  if (mid === null) return null;
  const store = (await ctx.woo.put(`dokan/v1/stores/${storeId}`, { gravatar_id: mid })).data;
  const url = isObj(store) && typeof store.gravatar === 'string' && /^https:\/\//.test(store.gravatar) ? store.gravatar
    : isObj(media) && typeof media.source_url === 'string' && /^https:\/\//.test(media.source_url) ? media.source_url : null;
  if (url) await run.db.from('vendors').update({ logo_url: url }).eq('id', vendorId);
  return mid;
}

// ---------------------------------------------------------------- vendor_store (the owner, 11 Nov — «إضافة مبتكر» on the site)

// vendor_store { vendor_id, password, shop_url?, notify?, trusted?, featured? }: a maker of ours without a store gets one on the site,
// Dokan's «Add New Vendor» in one call — POST dokan/v1/stores = a WordPress user with Dokan's seller role + the store:
// - the login is the maker's portal login (vendor_logins username, its e-mail — else the maker's), the password the one the member
//   typed (the portal's temporary one, the owner's choice): sent to Dokan once, never stored, logged nor returned here;
// - user_nicename = the shop URL given, else the username's (a-z 0-9 -); Dokan refuses one another store has (shop-url-error);
// - the store's fields come from the row (toDokanStore: name, phone, owner's name, address, social, enabled = not inactive), the
//   commission only for the admin or sensitive.commission = F (else none: the site's global one applies), the bank only for the
//   admin or sensitive.vendor_bank = F; trusted («نشر المنتجات مباشرة») / featured («مبتكر مميز») off unless asked; notify_vendor =
//   Dokan's «Send an email to vendor about account» (on unless asked off).
// Then our row takes the store (only while it still has none): woo_vendor_id, the snapshot of the site's answer, the mirrors, no
// push pending; the maker's own brand (the automatic one) is tied to the store as a synced store's is; a photo kept before the store
// existed becomes the store's photo. The site's login or e-mail already taken → the Dokan store with that e-mail is linked when no
// maker of ours has it and it is ours to link: an earlier try for this maker and this account that failed on the way (maybe made),
// the store registered around it, or the admin's call (a store made by hand on the site) — anyone else → 409 store_unlinked; a
// maker of ours has it → 409 exists_store. A maker
// with a store, without a login, or with no name → 409. Gated by WOO_PUSH_ENABLED; a person only (never the sync secret).
const SHOP_URL = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const shopOf = (s: string) => s.toLowerCase().replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const STORE_TOGGLES = ['notify', 'trusted', 'featured'];
async function vendorStore(run: Run, args: Json, member: ReturnType<NonNullable<Deps['userDb']>> | null) {
  const vendorId = typeof args.vendor_id === 'string' && UUID.test(args.vendor_id) ? args.vendor_id.toLowerCase() : null;
  const password = typeof args.password === 'string' ? args.password : '';
  if (vendorId === null) return json(400, { error: 'bad_request', field: 'vendor_id' });
  // the portal's rule (8–64, no spaces / control characters, a letter and a digit)
  if (password.length < 8 || password.length > 64 || /[\s\u0000-\u001f\u007f]/.test(password) || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return json(400, { error: 'bad_request', field: 'password' });
  if (STORE_TOGGLES.some((k) => args[k] !== undefined && typeof args[k] !== 'boolean')) return json(400, { error: 'bad_request', field: 'toggles' });
  const asked = typeof args.shop_url === 'string' ? args.shop_url.trim().toLowerCase() : '';
  if (asked && !SHOP_URL.test(asked)) return json(400, { error: 'bad_request', field: 'shop_url' });
  const { data: row, error } = await run.db.from('vendors').select(VENDOR_SYNC_COLUMNS + ', photo_path').eq('id', vendorId).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (!row) return json(404, { error: 'vendor_not_found' });
  if (wooId(row.woo_vendor_id) !== null) return json(409, { error: 'has_store' });
  const { data: login, error: lErr } = await run.db.from('vendor_logins').select('username, email').eq('vendor_id', vendorId).maybeSingle();
  if (lErr) throw new Error(`vendor_logins: ${lErr.message}`);
  const username = isObj(login) && typeof login.username === 'string' ? login.username.trim() : '';
  const email = (isObj(login) && typeof login.email === 'string' && login.email.trim() ? login.email : typeof row.email === 'string' ? row.email : '').trim().toLowerCase();
  if (!username || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(409, { error: 'no_login' });
  if (!String(row.name ?? '').trim() || String(row.name).startsWith('#')) return json(409, { error: 'no_name' });
  const shop = asked || shopOf(username);
  if (!SHOP_URL.test(shop)) return json(400, { error: 'bad_request', field: 'shop_url' });
  const entry = { kind: 'push', direction: 'out', entity: 'vendor', entity_id: vendorId, action: 'vendor_store' };
  if (!pushEnabled(run.env)) {
    await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason: 'push_disabled' } });
    return json(200, { action: 'vendor_store', result: 'skipped', reason: 'push_disabled' });
  }
  // the account this call asks for, as a digest (no e-mail in the log): a failed try is bound to it — see the linking below
  const attempt = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${email}\n${username}\n${shop}`)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  // what the member may send: the commission and the bank follow their own rules (as push_vendor's)
  const isAdmin = member ? (await member.rpc('is_admin')).data === true : false;
  const may = async (key: string) => { if (!member) return false; if (isAdmin) return true; const { data, error: e } = await member.rpc('has_perm', { key }); return !e && data === 'F'; };
  const withRates = await may('sensitive.commission');
  const withBank = await may('sensitive.vendor_bank');
  const ctx = await run.ctx();
  const rates = withRates ? (await effectiveRates(ctx, [vendorId], run.now())).get(vendorId) : undefined;
  const bank = withBank ? (await loadBanks(ctx, [vendorId])).get(vendorId) ?? null : null;
  const tree = withRates ? await loadTree(ctx) : null;
  const fields = ['name', 'phone', 'contact_name', 'address_parts', 'social', 'status', ...(withRates ? ['rate', 'category_rates'] : []), ...(bank ? ['bank'] : [])];
  const toStore = toDokanStore as unknown as (r: Json, f: string[], rt: Json | null, b: Json | null) => { body: Json | null; sent: string[] }; // a .js export: its defaults type the arguments as null
  const { body, sent } = toStore(row, fields, rates ? { type: rates.rate?.type ?? 'fixed', rate: rates.rate?.rate ?? null, flat: rates.rate?.flat ?? null, categoryRates: rates.category_rates ?? [], tree } : null, bank);
  const post = { ...(body ?? {}), user_login: username, email, user_pass: password, user_nicename: shop,
    notify_vendor: args.notify !== false, trusted: args.trusted === true, featured: args.featured === true };
  let store: Json | null = null; let adopted = false;
  try {
    const { data } = await ctx.woo.post('dokan/v1/stores', post);
    if (isObj(data) && wooId(data.id) !== null) store = data;
  } catch (e) {
    if (!(e instanceof WooError)) throw e;
    const code = /"code":"([a-z0-9_-]{1,60})"/.exec(e.message)?.[1] ?? wooCode(e); // Dokan's own codes carry hyphens (shop-url-error)
    if (e.status === 400 && (code === 'existing_user_login' || code === 'existing_user_email')) {
      // a former try that timed out after Dokan made the store, or a store made by hand on the site: the store with this e-mail
      const found = await storeByEmail(ctx, email);
      if (found) {
        const { data: other } = await run.db.from('vendors').select('id, name').eq('woo_vendor_id', wooId(found.id)).maybeSingle();
        if (other) { await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason: 'exists_store', store: wooId(found.id) } }); return json(409, { error: 'exists_store', name: String(other.name ?? '') }); }
        // (security review) a store is linked by its e-mail only when it is ours — an earlier vendor_store call for this very maker and
        // this very account (e-mail, username, shop URL: the digest) that failed on the way (a 5xx, a timeout, an answer without the
        // store: maybe made), the store registered on the site around that try (WordPress keeps user_registered in GMT; ±15 min) — or
        // by the admin (a store made by hand on the site). Anyone else cannot claim a store of the site by typing its e-mail, nor by
        // changing the login's e-mail after a failed try.
        const regRaw = typeof found.registered === 'string' ? found.registered.trim() : '';
        const reg = regRaw ? Date.parse(regRaw.replace(' ', 'T') + (/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(regRaw) ? '' : 'Z')) : NaN;
        const { data: tries } = await run.db.from('woo_sync_log').select('at, detail').eq('entity', 'vendor').eq('entity_id', vendorId).eq('action', 'vendor_store').eq('result', 'error').order('at', { ascending: false }).limit(20);
        const ours = Number.isFinite(reg) && (Array.isArray(tries) ? tries : []).some((t: Json) => isObj(t) && isObj(t.detail) && t.detail.attempt === attempt && Math.abs(Date.parse(String(t.at)) - reg) <= 15 * 60000);
        if (!isAdmin && !ours) {
          await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason: 'store_unlinked', store: wooId(found.id) } });
          return json(409, { error: 'store_unlinked' });
        }
        store = found; adopted = true;
      } else {
        await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason: code } });
        return json(409, { error: code === 'existing_user_login' ? 'login_taken' : 'email_taken' });
      }
    } else if (e.status === 400 && code === 'shop-url-error') {
      await logSync(run.db, { ...entry, result: 'skipped', detail: { vendor_id: vendorId, reason: 'shop_url' } });
      return json(409, { error: 'shop_url_taken' });
    } else {
      // another refusal (4xx: the site's answer, nothing made) or a failure on the way (5xx / timeout: maybe made — a retry links it)
      const final = e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status);
      const scrub = (s: string) => ctx.woo.scrub(s).split(password).join('***'); // an answer that echoes the request never logs the password
      await logSync(run.db, { ...entry, ...(final ? {} : { at: run.now() }), result: final ? 'skipped' : 'error', detail: { vendor_id: vendorId, ...(final ? { reason: 'refused' } : { attempt }), error: errorText(e, scrub) } });
      return json(final ? 409 : 502, final ? { error: 'refused', code } : { error: 'woo_error', action: 'vendor_store' });
    }
  }
  if (store === null) { await logSync(run.db, { ...entry, at: run.now(), result: 'error', detail: { vendor_id: vendorId, attempt, error: 'no_store_in_answer' } }); return json(502, { error: 'woo_error', action: 'vendor_store' }); }
  const storeId = wooId(store.id) as number;
  const mapped = mapStore(store) as Json; mapped.bank_digest = await bankDigest(mapped.bank);
  const now = run.now();
  const patch = { woo_vendor_id: storeId, woo_snapshot: storeSnapshot(mapped), woo_synced_at: now, push_pending: null, raw: mapped.raw, logo_url: mapped.logo_url, banner_url: mapped.banner_url, woo_payment_methods: mapped.woo_payment_methods };
  const { data: linked, error: upErr } = await run.db.from('vendors').update(patch).eq('id', vendorId).is('woo_vendor_id', null).select('id');
  if (upErr) {
    // the store sync took the new store first (unique woo_vendor_id): it is a maker of its own now — said, not merged
    await logSync(run.db, { ...entry, entity_id: String(storeId), result: 'error', detail: { vendor_id: vendorId, store: storeId, error: String(upErr.code ?? 'db') } });
    return json(409, { error: 'linked_elsewhere', store: storeId });
  }
  if (!Array.isArray(linked) || !linked.length) return json(409, { error: 'has_store' }); // another call linked one meanwhile
  // the maker's automatic brand (made with the row) becomes the store's brand, as a synced store's is (0013)
  const { data: brand } = await run.db.from('brands').select('id').eq('origin_vendor_id', vendorId).eq('created_by', 'system').is('store_vendor_id', null).limit(1).maybeSingle();
  if (isObj(brand) && brand.id) await run.db.from('brands').update({ store_vendor_id: vendorId }).eq('id', brand.id);
  // a photo kept before the store existed becomes the store's photo (best effort: the store stands either way)
  let photo = 'none';
  const pm = typeof row.photo_path === 'string' ? PHOTO_PATH.exec(row.photo_path) : null;
  if (pm && pm[1].toLowerCase() === vendorId && !adopted) {
    try {
      const { data: blob } = await run.db.storage.from(PHOTO_BUCKET).download(row.photo_path);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      photo = bytes && isPhotoBytes(bytes) && bytes.length <= 5 * 1048576 && (await storePhoto(run, ctx, vendorId, storeId, bytes, pm[2].toLowerCase() === 'jpeg' ? 'jpg' : pm[2].toLowerCase())) !== null ? 'ok' : 'failed';
    } catch (e) { if (!(e instanceof WooError)) throw e; photo = 'failed'; }
  }
  await logSync(run.db, { ...entry, entity_id: String(storeId), result: 'ok', detail: { vendor_id: vendorId, store: storeId, adopted, fields: adopted ? [] : sent, photo } });
  await logActivity(ctx, adopted ? 'vendor.store.link' : 'vendor.store.create', vendorId, ['#' + storeId]);
  return json(200, { action: 'vendor_store', result: 'ok', store: storeId, adopted, commission: !adopted && sent.includes('rate'), bank: !adopted && sent.includes('bank'), photo, shop_url: typeof store.shop_url === 'string' && /^https:\/\//.test(store.shop_url) ? store.shop_url : null });
}
// The Dokan store whose WordPress e-mail is exactly `email` (the store search covers user_email), or null.
async function storeByEmail(ctx: Ctx, email: string): Promise<Json | null> {
  const { data } = await ctx.woo.get('dokan/v1/stores', { search: email, per_page: 10, page: 1 });
  const hits = (Array.isArray(data) ? data : []).filter((s: unknown): s is Json => isObj(s) && wooId(s.id) !== null && typeof s.email === 'string' && s.email.trim().toLowerCase() === email);
  return hits.length === 1 ? hits[0] : null;
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
// 0078: a request that turned approved on Dokan itself — pending in our mirror before, or new to it and asked from SETTLE_FROM on
// (never the history) — settles the maker's open moves (acc_settle_withdrawal, source 'dokan'); idempotent with withdraw_approve.
async function pullWithdrawals(run: Run, makers: Json[], now: string) {
  const woo = run.woo();
  const scrub = makeScrubber(run.env);
  const byStore = new Map(makers.map((v) => [Number(v.woo_vendor_id), v.id]));
  let withdrawals = 0, skipped = 0, failedRows = 0, settled = 0;
  const settledMakers = new Set<string>(); // their Dokan balance is read again in the same run (the request lowered it)
  const res = await woo.eachPage('dokan/v1/withdraw', { status: 'all' }, async (page: Json[]) => {
    const rows = page.filter(isObj).map((w) => mapWithdrawal(w, (store) => byStore.get(store) ?? null)).filter((r): r is NonNullable<typeof r> => r !== null).map((r) => ({ ...r, synced_at: now }));
    skipped += page.length - rows.length;
    const was = new Map<number, string>();
    if (rows.length) {
      const { data: before, error } = await run.db.from('dokan_withdrawals').select('id, status').in('id', rows.map((r) => r.id));
      if (error) throw new Error(`dokan_withdrawals: ${error.message}`);
      for (const b of before ?? []) was.set(Number(b.id), String(b.status));
    }
    const { bad } = await upsertRows(run.db, 'dokan_withdrawals', rows, 'id');
    for (const b of bad) await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', entity_id: b.key, action: 'upsert', result: 'error', detail: { error: errorText(b.error, scrub) } });
    withdrawals += rows.length - bad.length; failedRows += bad.length;
    const failed = new Set(bad.map((b) => String(b.key)));
    for (const r of rows) {
      if (failed.has(String(r.id)) || r.status !== 'approved' || !r.vendor_id) continue;
      const before = was.get(r.id);
      if (before === 'pending' || (before === undefined && String(r.requested_at ?? '') >= SETTLE_FROM)) { if (await settle(run, r.id, 'dokan', null)) { settled++; settledMakers.add(String(r.vendor_id)); } }
    }
  });
  return { withdrawals, skipped, failedRows, settled, settledMakers, pages: res.pages, done: res.done };
}

// The makers' Dokan balances now (stores/{id}/stats, GET) → dokan_balances. A 404 is a store gone (missing); any other Dokan
// failure is counted and the first one logged; the row of a maker that failed keeps its last numbers.
async function readBalances(run: Run, makers: Json[], now: string) {
  const woo = run.woo();
  const scrub = makeScrubber(run.env);
  let missing = 0, failed = 0;
  const rows: Json[] = [];
  for (const v of makers) {
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
  const { bad } = rows.length ? await upsertRows(run.db, 'dokan_balances', rows, 'vendor_id') : { bad: [] };
  return { balances: rows.length - bad.length, missing, failed, failedRows: bad.length };
}

// 0078: settle the maker's open moves against an approved request (acc_settle_withdrawal — the server's only) → the numbers, or
// null when it failed (logged with the code; the hourly run tries again for a request it still sees turning approved)
const SETTLE_FROM = '2026-11-11';
async function settle(run: Run, id: number, source: 'system' | 'dokan', by: string | null) {
  const { data, error } = await run.db.rpc('acc_settle_withdrawal', { p_withdraw: id, p_source: source, p_by: by });
  if (error) { await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'acc_vendor_settlements', entity_id: String(id), action: 'settle', result: 'error', detail: { code: error.code ?? null } }); return null; }
  const s = Array.isArray(data) ? data[0] : data;
  if (!isObj(s)) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { amount: n(s.amount), consumed: n(s.consumed), cash: n(s.cash), carry_out: n(s.carry_out), moves: n(s.moves) };
}

async function pullAccounts(run: Run) {
  const makers = await makersWithStore(run);
  const now = run.now();
  // the requests, every status, page by page
  const w = await pullWithdrawals(run, makers, now);
  // the balances: the next batch of makers, going round the list — and every maker a request was just settled for (0078)
  const state = await getState(run.db, 'accounts');
  const offset = Number.isInteger(state.offset) && state.offset >= 0 && state.offset < makers.length ? state.offset : 0;
  const batch = makers.slice(offset, offset + ACCOUNTS_BATCH);
  const inBatch = new Set(batch.map((v) => String(v.id)));
  const b = await readBalances(run, batch.concat(makers.filter((v) => w.settledMakers.has(String(v.id)) && !inBatch.has(String(v.id)))), now);
  const next = offset + batch.length >= makers.length ? 0 : offset + batch.length;
  await setState(run.db, 'accounts', { offset: next, last_run: now, makers: makers.length }, now);
  return { withdrawals: w.withdrawals, skipped: w.skipped, settled: w.settled, pages: w.pages, done: w.done, balances: b.balances, missing: b.missing, failed: b.failed, failed_rows: w.failedRows + b.failedRows, offset, next };
}

// phase 12 T7: the visitor's abandoned carts — the site's snippet over CartFlows' table, mirrored on cart_id (no contents, no address)
// The snippet not on the site: 404, or 401 «invalid_username» — the route is unknown, so WordPress core reads the WooCommerce keys
// as an application password and refuses them before routing (live 9–14 Nov, every run: the owner keeps the snippet off — 9 Nov)
const cartsMissing = (e: unknown) => e instanceof WooError && (e.status === 404 || (e.status === 401 && /invalid_username|rest_no_route/.test(e.message)));
// the probe (the admin): what the site keeps abandoned carts in — the tables found, their columns, the name-mapping, row counts; no rows
async function probeCarts(run: Run) {
  const woo = run.woo();
  try {
    const res = await woo.get(CART_PATH, { probe: 1 });
    return { installed: true, probe: isObj(res.data) ? res.data : {} };
  } catch (e) {
    if (cartsMissing(e)) return { installed: false, probe: null };
    throw e;
  }
}
async function pullCarts(run: Run) {
  const woo = run.woo();
  let data: Json[] = [];
  try {
    const res = await woo.get(CART_PATH, { hours: CART_HOURS });
    data = Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    if (cartsMissing(e)) return { installed: false, carts: 0, bad: 0, failed_rows: 0 }; // the snippet or the plugin is not on the site
    throw e;
  }
  const { rows, bad } = cartRows(data, { siteUrl: run.env.WOO_URL, now: run.now() });
  const { bad: failed } = rows.length ? await upsertRows(run.db, 'cs_carts', rows, 'cart_id') : { bad: [] };
  return { installed: true, carts: rows.length - failed.length, bad, failed_rows: failed.length };
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
        debit: numOrNull(r.debit) ?? 0, credit: numOrNull(r.credit) ?? 0, balance: numOrNull(r.balance),
        // phase 5.5 decision 13: Dokan's own id of the row (the maker's order for dokan_orders) — the page's period ledger
        // finds that order's lines in our mirror for the sales; a number or null, nothing else
        ref: wooId(r.trn_id) });
    }
  }, { maxPages: STATEMENT_MAX_PAGES });
  return json(200, { action: 'statement', result: 'ok', store, from, to, rows: out, done: res.done });
}

// ---------------------------------------------------------------- withdraw_approve (phase 4.1)

// The owner's one write from the accounts page (28 Oct): approve a pending Dokan withdraw request. The body names the request
// only; it must be pending in our mirror and still pending on Dokan (GET first), else skipped/stale and the mirror is
// corrected. WOO_PUSH_ENABLED gates every call to Dokan. Never a cancel, never an amount: Dokan lowers the balance itself.
// Nothing of the request's bank details is read into the log or the mirror (mapWithdrawal's allow-list rule).
async function withdrawApprove(run: Run, args: Json, by: string | null = null) {
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
  if (store !== null && row.vendor_id) await readBalances(run, [{ id: row.vendor_id, woo_vendor_id: store }], run.now());
  // 0078: the maker's open moves settle against it — what the request covered and what is transferred to the maker
  const settlement = status === 'approved' ? await settle(run, id, 'system', by) : null;
  await logSync(run.db, { ...entry, result: 'ok', detail: { status, amount: row.amount, settled: settlement ? settlement.moves : null } });
  return json(200, { action: 'withdraw_approve', result: 'ok', status, settlement });
}

// ---------------------------------------------------------------- withdraw_create (0078 — «تسوية دلوقتي»)

// The owner (11 Nov): when the maker has no request, the system asks Dokan for one — his whole Dokan balance (= the net + the moves
// we paid him, which Dokan does not count), pending until it is approved like any other. The body names the maker only: the
// amount is Dokan's own balance read now (stores/{id}/stats), the method the bank (the only one: the owner's rule), the note a
// fixed line. Never with a pending request (ours or Dokan's own check); WOO_PUSH_ENABLED gates it (skipped/push_disabled before
// any call); a refusal of Dokan's (4xx) comes back as refused with its code. The new request lands in the mirror at once.
const WITHDRAW_NOTE = 'تسوية من سيستم إبتكر';
async function withdrawCreate(run: Run, args: Json) {
  const vendorId = typeof args.vendor_id === 'string' && UUID.test(args.vendor_id) ? args.vendor_id.toLowerCase() : null;
  if (vendorId === null) return json(400, { error: 'bad_request' });
  const { data: v, error } = await run.db.from('vendors').select('id, woo_vendor_id').eq('id', vendorId).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (!v) return json(404, { error: 'vendor_not_found' });
  const store = wooId(v.woo_vendor_id);
  if (store === null) return json(409, { error: 'no_store' });
  const entry = { kind: 'push', direction: 'out', entity: 'dokan_withdrawals', entity_id: 'store:' + store, action: 'withdraw_create' };
  const skip = async (reason: string, extra: Json = {}) => {
    await logSync(run.db, { ...entry, result: 'skipped', detail: { reason } });
    return json(200, { action: 'withdraw_create', result: 'skipped', reason, ...extra });
  };
  const { data: open, error: openErr } = await run.db.from('dokan_withdrawals').select('id').eq('woo_vendor_id', store).eq('status', 'pending');
  if (openErr) throw new Error(`dokan_withdrawals: ${openErr.message}`);
  if ((open ?? []).length) return await skip('pending_exists', { id: Number(open[0].id) });
  if (!pushEnabled(run.env)) return await skip('push_disabled');
  const woo = run.woo();
  const { data: stats } = await woo.get(`dokan/v1/stores/${store}/stats`);
  const balance = numOrNull(isObj(stats) && isObj(stats.others) ? stats.others.balance : null);
  if (balance === null || balance <= 0) return await skip('no_balance', { balance });
  const amount = Math.floor(balance * 100) / 100;
  let created: Json;
  try {
    created = (await woo.post('dokan/v1/withdraw', { user_id: store, amount, method: 'bank', note: WITHDRAW_NOTE })).data as Json;
  } catch (e) {
    if (e instanceof WooError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403) {
      // Dokan's own code (e.g. dokan_rest_withdraw_error) from the answer's excerpt in the message; never its text
      const code = (/"code"\s*:\s*"([a-z0-9_]{1,60})"/i.exec(String(e.message)) ?? [])[1] ?? String(e.status);
      await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'refused', code } });
      return json(409, { action: 'withdraw_create', result: 'refused', reason: code });
    }
    throw e;
  }
  const row = isObj(created) ? mapWithdrawal(created, () => v.id) : null;
  if (!row) throw new Error('withdraw_create: the answer carries no request');
  const { bad } = await upsertRows(run.db, 'dokan_withdrawals', [{ ...row, synced_at: run.now() }], 'id');
  if (bad.length) throw new Error('dokan_withdrawals: the new request was not mirrored');
  await logSync(run.db, { ...entry, entity_id: String(row.id), result: 'ok', detail: { amount: row.amount, status: row.status } });
  return json(200, { action: 'withdraw_create', result: 'ok', id: row.id, amount: row.amount, status: row.status });
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
  // the translation's status too: the page shows when it differs from the product's (a translation added after the product was published)
  return json(200, { action: 'product_get', product: editView(p), ar: arView && { id: arView.id, name: arView.name, short_description: arView.short_description, description: arView.description, seo_title: arView.seo_title, seo_description: arView.seo_description, status: arView.status }, variations });
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
// products_vendor { ids, vendor_id } (≤ 100; the admin or products.bulk — the owner, 1 Nov): the products' maker on the site, the
// studio's own way (decision 9 of 5.2): Dokan's PUT dokan/v1/products/{id} { post_author } on each product and on its Arabic
// translation, the answer's post_author checked (never trusted); the mirror's vendor_id follows the ones that took it. (Phase 5
// decision 18 kept this to the WordPress dashboard — Dokan's route does take the author.) A maker without a store on the site: 409.
async function productsVendor(run: Run, args: Json) {
  const ids = Array.isArray(args.ids) ? [...new Set(args.ids.map((x: unknown) => wooId(x)).filter((x: number | null): x is number => x !== null))] : [];
  const vendorId = typeof args.vendor_id === 'string' && /^[0-9a-f-]{36}$/i.test(args.vendor_id) ? args.vendor_id : null;
  if (!vendorId) return json(400, { error: 'bad_request', field: 'vendor_id' });
  if (!ids.length || ids.length > PRODUCT_BATCH_MAX) return json(400, { error: 'bad_request', field: 'ids' });
  const { data: vendor } = await run.db.from('vendors').select('id, woo_vendor_id').eq('id', vendorId).maybeSingle();
  if (!isObj(vendor)) return json(404, { error: 'not_found' });
  const owner = wooId(vendor.woo_vendor_id);
  if (owner === null) return json(409, { error: 'no_store' });
  if (!pushEnabled(run.env)) return await pushSkip(run, 'products_vendor', null, { count: ids.length, vendor_id: vendorId });
  const ctx = await run.ctx();
  const ar = await arIds(run, ids);
  const put = async (id: number) => {
    try { return wooId(((await ctx.woo.put(`dokan/v1/products/${id}`, { post_author: owner })).data as Json)?.post_author) === owner; }
    catch (e) { if (!(e instanceof WooError)) throw e; return false; }
  };
  const moved: number[] = []; const failed: number[] = []; const rows: number[] = [];
  for (const id of ids) {
    if (!(await put(id))) { failed.push(id); continue; }
    moved.push(id); rows.push(id);
    const arId = ar.get(id);
    if (arId && await put(arId)) rows.push(arId);
  }
  if (rows.length) await run.db.from('products').update({ vendor_id: vendorId }).in('id', rows);
  await logSync(run.db, { ...productEntry(null, 'products_vendor'), result: failed.length ? 'error' : 'ok', detail: { moved: moved.length, failed: failed.length, vendor_id: vendorId, ids: ids.slice(0, PRODUCT_BATCH_MAX) } });
  return json(200, { action: 'products_vendor', result: 'ok', counts: { moved: moved.length, failed: failed.length }, failed_ids: failed });
}

// inventory_push { skus? } (phase 7, decision 1 c; the admin or inventory.edit + products.edit): the site quantity of the SKUs Ibtekr owns («ملك ابتكر» lots) = the hub's
// available pieces held «متاح للبيع» (siteQuantities). Off until the settings row «inventory» has wooSync = true, and gated by
// WOO_PUSH_ENABLED; a maker's «أمانة» SKU is never touched. The product of the mirror by its SKU (not the Arabic one), then its
// Arabic translation: PUT manage_stock + stock_quantity; the mirror follows. Counts and SKUs only in the log.
async function inventoryPush(run: Run, args: Json) {
  const skus = skuList(args.skus);
  if (skus === null) return json(400, { error: 'bad_request', field: 'skus' });
  const { data: set } = await run.db.from('settings').select('data').eq('section', 'inventory').maybeSingle();
  if (!(isObj(set) && isObj(set.data) && set.data.wooSync === true)) {
    await logSync(run.db, { ...productEntry(null, 'inventory_push'), result: 'skipped', detail: { reason: 'off', count: skus?.length ?? 0 } });
    return json(200, { action: 'inventory_push', result: 'skipped', reason: 'off' });
  }
  if (!pushEnabled(run.env)) return await pushSkip(run, 'inventory_push', null, { count: skus?.length ?? 0 });
  let q = run.db.from('inv_lots').select('id, sku, reason, mode, closed_at').eq('mode', OWNED);
  if (skus) q = q.in('sku', skus);
  const { data: lots, error: lotErr } = await q;
  if (lotErr) throw new Error(`inv_lots: ${lotErr.message}`);
  const lotIds = (lots ?? []).map((l: Json) => l.id);
  const { data: moves, error: mvErr } = lotIds.length ? await run.db.from('inv_moves').select('lot_id, type, qty').in('lot_id', lotIds) : { data: [], error: null };
  if (mvErr) throw new Error(`inv_moves: ${mvErr.message}`);
  const qty = siteQuantities(lots ?? [], moves ?? []) as Map<string, number>;
  const counts = { pushed: 0, missing: 0, failed: 0 };
  if (!qty.size) { await logSync(run.db, { ...productEntry(null, 'inventory_push'), result: 'ok', detail: { ...counts } }); return json(200, { action: 'inventory_push', result: 'ok', counts, missing: [], failed: [] }); }
  const { data: prods, error: pErr } = await run.db.from('products').select('id, sku, lang, translation_ids, trashed_at').in('sku', [...qty.keys()]);
  if (pErr) throw new Error(`products: ${pErr.message}`);
  const main = new Map<string, number>();
  for (const p of prods ?? []) { if (p.lang === 'ar' || p.trashed_at) continue; const k = String(p.sku ?? '').trim(); if (k && !main.has(k)) main.set(k, Number(p.id)); }
  const ar = main.size ? await arIds(run, [...main.values()]) : new Map<number, number>();
  const ctx = await run.ctx();
  const missing: string[] = []; const failed: string[] = [];
  for (const [sku, n] of qty) {
    const id = main.get(sku); if (id === undefined) { missing.push(sku); continue; }
    try {
      for (const pid of [id, ...(ar.has(id) ? [ar.get(id) as number] : [])]) {
        await ctx.woo.put(`wc/v3/products/${pid}`, { manage_stock: true, stock_quantity: n });
        await run.db.from('products').update({ manage_stock: true, stock_quantity: n }).eq('id', pid);
      }
      counts.pushed += 1;
    } catch (e) { if (!(e instanceof WooError)) throw e; failed.push(sku); }
  }
  counts.missing = missing.length; counts.failed = failed.length;
  await logSync(run.db, { ...productEntry(null, 'inventory_push'), result: failed.length ? 'error' : 'ok', detail: { ...counts, skus: [...qty.keys()].slice(0, 50) } });
  return json(200, { action: 'inventory_push', result: 'ok', counts, missing, failed });
}

// product_duplicate { id } (phase 12 T2, decision 9; the admin or products.add = F; WOO_PUSH_ENABLED): «تكرار كمنتج جديد» — a draft copy on
// the site of the product as it is now: its texts, prices, stock, categories, brands, attributes and the same media (the ids), under a
// new SKU from the studio's serial (sku_serial_take with the member's own client: the RPC checks products.add), then its variations
// (each under its SKU on the new serial), then the Arabic translation (WPML, linked with translation_of — one that came back unlinked
// is trashed, never force), then the maker (Dokan's post_author = the source's store) on both, like the studio. The mirror takes the
// new rows. Names and counts in the log only.
async function productDuplicate(run: Run, args: Json, member: Db | null) {
  const srcId = wooId(args.id);
  if (srcId === null) return json(400, { error: 'bad_request', field: 'id' });
  if (!member) return json(401, { error: 'unauthorized' });
  if (!pushEnabled(run.env)) return await pushSkip(run, 'product_duplicate', srcId, { source: srcId });
  const ctx = await run.ctx();
  let src = (await ctx.woo.get(`wc/v3/products/${srcId}`)).data as Json;
  if (!isObj(src)) return json(502, { error: 'woo_error' });
  // the Arabic row was sent: copy from its English product (the translation follows)
  const en = isObj(src.translations) ? wooId(src.translations.en) : null;
  if (src.lang === 'ar' && en !== null && en !== srcId) { const e = (await ctx.woo.get(`wc/v3/products/${en}`)).data; if (isObj(e)) src = e; }
  const id = wooId(src.id) ?? srcId;
  const arId = isObj(src.translations) ? wooId(src.translations.ar) : null;
  const { data: serialRaw, error: serialErr } = await member.rpc('sku_serial_take', { n: 1 });
  const serial = serialErr ? null : Number(serialRaw);
  if (serial === null || !Number.isInteger(serial)) return json(serialErr?.code === '42501' ? 401 : 502, { error: serialErr?.code === '42501' ? 'unauthorized' : 'serial_failed' });
  const sku = duplicateSku(src.sku, serial);
  const entry = productEntry(null, 'product_duplicate');
  const res: Json = { source: id, sku, product: null, ar: null, variations: null, author: null, error: null };
  try {
    const created = (await ctx.woo.post('wc/v3/products', duplicatePayload(src, { sku }))).data;
    const newId = wooId(isObj(created) ? created.id : null);
    if (newId === null) { res.error = 'product_refused'; }
    else {
      res.product = newId;
      // the maker before the variations (a new variation takes its product's author — 5.2 decision 9); the answer checked, never trusted
      const owner = wooId(isObj(src.store) ? src.store.id : null);
      const authorOf = async (pid: number) => { try { return wooId(((await ctx.woo.put(`dokan/v1/products/${pid}`, { post_author: owner })).data as Json)?.post_author) === owner; } catch (e) { if (!(e instanceof WooError || e instanceof ConfigError)) throw e; return false; } };
      let authored = owner === null ? true : await authorOf(newId);
      if (src.type === 'variable') {
        const vars = ((await ctx.woo.get(`wc/v3/products/${id}/variations`, { per_page: 100, page: 1 })).data ?? []) as Json[];
        const create = vars.filter(isObj).map((v, i) => duplicateVariation(v, variationSku(v.sku, { serial, oldParent: src.sku, newParent: sku, n: i + 1 }))).filter(isObj);
        if (create.length) {
          const r = (await ctx.woo.post(`wc/v3/products/${newId}/variations/batch`, { create })).data;
          const made = isObj(r) && Array.isArray(r.create) ? r.create : [];
          const failed = made.filter((x: Json) => !isObj(x) || isObj(x.error) || wooId(x.id) === null).length + Math.max(0, create.length - made.length);
          res.variations = { done: create.length - failed, failed };
        } else res.variations = { done: 0, failed: 0 };
      }
      if (arId !== null && arId !== id) {
        try {
          const ar = (await ctx.woo.get(`wc/v3/products/${arId}`)).data;
          if (isObj(ar)) {
            const a = (await ctx.woo.post('wc/v3/products', duplicateAr(ar, { type: src.type, translationOf: newId }))).data;
            const newAr = wooId(isObj(a) ? a.id : null);
            const linked = isObj(a) && isObj(a.translations) && wooId(a.translations.en) === newId;
            if (newAr !== null && !linked) { await ctx.woo.del(`wc/v3/products/${newAr}`); res.ar_code = 'not_linked'; }
            else if (newAr !== null) { res.ar = newAr; if (owner !== null && !(await authorOf(newAr))) authored = false; }
            else res.ar_code = 'refused';
          }
        } catch (e) { if (!(e instanceof WooError)) throw e; res.ar_code = wooCode(e); }
      }
      res.author = owner === null ? 'no_store' : authored ? 'ok' : 'failed';
      const fresh = [(await ctx.woo.get(`wc/v3/products/${newId}`)).data];
      if (res.ar) { try { fresh.push((await ctx.woo.get(`wc/v3/products/${res.ar}`)).data); } catch (e) { if (!(e instanceof WooError)) throw e; } }
      await writeProducts(ctx, fresh.filter(isObj));
    }
  } catch (e) {
    if (!(e instanceof WooError || e instanceof ConfigError)) throw e;
    res.error = wooCode(e);
  }
  await logSync(run.db, { ...entry, entity_id: res.product == null ? String(id) : String(res.product), result: res.error ? 'error' : 'ok', detail: res });
  if (res.error) return json(502, { action: 'product_duplicate', result: 'error', error: res.error, source: id });
  return json(200, { action: 'product_duplicate', result: 'ok', id: res.product, sku, variations: res.variations, ar: res.ar, ar_code: res.ar_code ?? null, author: res.author });
}

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
// bucket to the media library, the product as a draft (with the site's WooCommerce brand when one is named like the batch's
// brand — matchWooBrand; a product made before it gets it on a retry), the maker as its author (Dokan's PUT dokan/v1/products/{id}
// { post_author } with the Application Password — before the variations, which take their product's vendor when Dokan
// creates them; a maker that did not stick = author_failed, no variations yet, the product stays; the batch's maker changed
// after the variations were sent = maker_changed, nothing written), its variations, the Arabic translation (WPML:
// wpml_language ar + translation_of; an answer that is not linked to the product is trashed, never left as a second
// product) and its author («failed» when it did not stick), the mirror. The item's result goes to
// studio_batches.result.items[index] (ids, the SKU, a short reason — never a price or a text); once the product is made its
// SKU there is the site's, and a retry whose item builds another writes nothing (brand_changed / sku_changed).
const STUDIO_BUCKET = 'studio';
const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const wooCode = (e: unknown) => (e instanceof WooError ? (/"code":"([a-z0-9_]{1,60})"/.exec(e.message)?.[1] ?? `http_${e.status}`) : e instanceof ConfigError ? 'config' : 'error');
const fileBase = (name: string) => String(name || 'Product').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Product';
async function attributeIds(run: Run, ctx: Ctx) {
  const list = (await ctx.woo.get('wc/v3/products/attributes')).data;
  const bySlug = new Map((Array.isArray(list) ? list : []).filter(isObj).map((a: Json) => [String(a.slug), wooId(a.id)]));
  return Object.fromEntries(Object.entries(STUDIO_ATTRS).map(([k, slug]) => [k, bySlug.get(slug) ?? null]));
}
// The attribute terms the site shows are translated in WPML (Brown ↔ بنى, Sugar crafts ↔ Sugar crafts): a term WooCommerce
// made for the English product has no Arabic term, so the translation came without a size or a brand (the owner, 2 Nov).
// For every English option: its term (GET by search, the name compared), then the Arabic term — found with lang=ar, or made
// as the English term's translation (WCML's `lang` + `translation_of`, as category_create does). Soft: a failure is reported
// in the result (arAttrs), never the item's error; the translation's attributes are then written with the Arabic names.
const termKey = (s: unknown) => String(s ?? '').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#215;|&times;/g, '×').normalize('NFKC').trim().toLowerCase();
async function ensureArTerms(ctx: Ctx, enAttrs: Json[], arAttrs: Json[]) {
  let ok = true;
  const find = async (attr: number, name: string, lang: string | null) => {
    const q: Record<string, string> = { search: name, per_page: '100' }; if (lang) q.lang = lang;
    const list = (await ctx.woo.get(`wc/v3/products/attributes/${attr}/terms`, q)).data;
    const hit = (Array.isArray(list) ? list : []).find((t: Json) => isObj(t) && termKey(t.name) === termKey(name));
    return hit ? wooId(hit.id) : null;
  };
  for (let i = 0; i < enAttrs.length; i++) {
    const en = enAttrs[i]; const ar = arAttrs[i]; const attr = wooId(en?.id);
    if (attr === null || !isObj(ar) || !Array.isArray(en.options) || !Array.isArray(ar.options)) continue;
    for (let j = 0; j < en.options.length; j++) {
      const enName = String(en.options[j]); const arName = String(ar.options[j] ?? enName);
      try {
        if (await find(attr, arName, 'ar') !== null) continue;
        const enId = await find(attr, enName, null);
        if (enId === null) { ok = false; continue; }
        await ctx.woo.post(`wc/v3/products/attributes/${attr}/terms`, { name: arName, lang: 'ar', translation_of: enId });
      } catch (e) {
        if (!(e instanceof WooError)) throw e;
        if (!/term_exists/.test(e.message)) ok = false;
      }
    }
  }
  return ok;
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
  const [{ data: brand }, { data: vendor }, { data: colorRows }, { data: wooBrands }] = await Promise.all([
    batch.brand_id ? run.db.from('brands').select('name, aliases').eq('id', batch.brand_id).maybeSingle() : Promise.resolve({ data: null }),
    batch.vendor_id ? run.db.from('vendors').select('woo_vendor_id').eq('id', batch.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    run.db.from('sku_colors').select('code, name_en, name_ar'), run.db.from('woo_brands').select('id, name, slug')]);
  const colors = Object.fromEntries((colorRows ?? []).map((c: Json) => [c.code, c.name_en]));
  const colorsAr = Object.fromEntries((colorRows ?? []).map((c: Json) => [c.code, c.name_ar]));
  const wooBrand = matchWooBrand(brand, wooBrands ?? []) as number | null; // decision 5: the site's WooCommerce brand, by name
  const check = buildStudio(item, { batchId, type: batch.type, brand: brand?.name ?? '', wooBrand, colors, colorsAr, attrs: {} }) as Json;
  if (check.error) return json(400, check);
  const entry = { ...productEntry(null, 'studio_upload'), entity_id: `${batchId}#${index}` };
  if (!pushEnabled(run.env)) return await pushSkip(run, 'studio_upload', null, { batch: batchId, index });
  const ctx = await run.ctx();
  const built = buildStudio(item, { batchId, type: batch.type, brand: brand?.name ?? '', wooBrand, colors, colorsAr, attrs: await attributeIds(run, ctx) }) as Json;
  if (built.error) return json(400, built);
  const prev = isObj(batch.result) && Array.isArray(batch.result.items) && isObj(batch.result.items[index]) ? batch.result.items[index] : {};
  // the SKU (decision 2) is fixed when the product is made: the result keeps it, and a retry whose item builds another (its
  // variations would take that one under a parent with the old) writes nothing — brand_changed when the brand's two letters
  // differ (another brand, or its name changed), sku_changed for the rest (a Simple's color, the serial, another row here)
  const made = wooId(prev.productId) !== null && typeof prev.sku === 'string';
  const res: Json = { ...prev, sku: made ? prev.sku : built.sku, media: isObj(prev.media) ? { ...prev.media } : {}, error: null };
  if (made && res.sku !== built.sku) res.error = res.sku.slice(3, 5) === built.sku.slice(3, 5) ? 'sku_changed' : 'brand_changed';
  // the maker (decision 9): Dokan's own route writes an admin's post_author when that user can dokan_add_product (otherwise
  // the caller) — the answer's post_author is checked, never trusted. The ids it took stay on the result with the maker they
  // took (authorOwner; a result written before it was kept counts as the batch's maker): a retry skips them while the batch's
  // maker is still that one, and for another maker the record starts again at its first PUT (both are asked again)
  const owner = wooId(vendor?.woo_vendor_id);
  let on = prev.authorOwner === undefined ? owner : wooId(prev.authorOwner);
  const authored = new Set<number>((Array.isArray(prev.authorIds) ? prev.authorIds : []).map((x: unknown) => wooId(x)).filter((x: number | null): x is number => x !== null));
  const authorOf = async (id: number) => {
    if (on !== owner) { authored.clear(); on = owner; }
    if (authored.has(id)) return;
    try { if (wooId(((await ctx.woo.put(`dokan/v1/products/${id}`, { post_author: owner })).data as Json)?.post_author) === owner) authored.add(id); }
    catch (e) { if (!(e instanceof WooError || e instanceof ConfigError)) throw e; }
  };
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
    for (const path of res.error ? [] : paths) {
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
      else res.wooBrand = wooBrand; // the site's WooCommerce brand went with the product (null: none matched)
    }
    // the maker before the variations: Dokan orders a variation by the variation's own author, gives a new variation its
    // product's vendor, and has no REST route to change a variation's author afterwards — so a product whose maker did not
    // stick gets no variations yet (author_failed; «جرّب تاني» asks again and goes on), and once its variations were sent on
    // a maker, another batch maker writes nothing (maker_changed: the product stays whole on the maker its variations have)
    if (!res.error && owner !== null) {
      if (on !== owner && isObj(res.variations)) res.error = 'maker_changed';
      else {
        await authorOf(res.productId);
        if (!authored.has(res.productId)) res.error = 'author_failed';
      }
    }
    // a product made before its WooCommerce brand was sent (woo-sync v33) gets it on a retry
    if (!res.error && res.wooBrand === undefined) {
      if (wooBrand !== null) await ctx.woo.put(`wc/v3/products/${res.productId}`, { brands: [{ id: wooBrand }] });
      res.wooBrand = wooBrand;
    }
    if (!res.error && built.variations.length && !isObj(res.variations)) {
      if (!authored.has(res.productId)) { authored.clear(); on = null; } // made with no maker on their product (no store): theirs is none
      const r = (await ctx.woo.post(`wc/v3/products/${res.productId}/variations/batch`, { create: built.variations.map((v: Json) => ({ ...v.payload, ...(v.image ? { image: { id: res.media[v.image] } } : {}) })) })).data;
      const created = isObj(r) && Array.isArray(r.create) ? r.create : [];
      const failed = created.filter((x: Json) => !isObj(x) || isObj(x.error) || wooId(x.id) === null).length + Math.max(0, built.variations.length - created.length);
      res.variations = { done: built.variations.length - failed, failed };
    }
    // a product without its Arabic translation (never made, refused — arId null — or trashed as not linked) asks for it again
    // on every retry: the product itself is never made twice, so the translation is the one thing a retry here adds
    if (!res.error && built.ar && wooId(res.arId) === null) {
      try {
        // WCML's REST reads the language as `lang` (WPML's own key is wpml_language — both go); a refusal keeps the site's
        // scrubbed answer in arError so the batch report says why (the live uploads of 29 / 31 Oct answered 422 with no detail)
        // a translation added on a retry takes the product's status as it is now (the live product 182053 was published from the
        // product page before its translation existed — a draft translation would leave the Arabic site without it)
        let status = 'draft';
        if (made) { try { const p = (await ctx.woo.get(`wc/v3/products/${res.productId}`)).data; if (isObj(p) && p.status === 'publish') status = 'publish'; } catch (e) { if (!(e instanceof WooError)) throw e; } }
        // the Arabic terms first (the owner, 2 Nov), so the translation's attributes land on linked, translated terms
        const termsOk = await ensureArTerms(ctx, built.product.attributes, built.arAttributes);
        const a = (await ctx.woo.post('wc/v3/products', { ...built.ar, attributes: built.arAttributes, type: built.product.type, status, lang: 'ar', wpml_language: 'ar', translation_of: res.productId })).data;
        const arId = wooId(isObj(a) ? a.id : null);
        const linked = isObj(a) && isObj(a.translations) && wooId(a.translations.en) === res.productId;
        delete res.arNote; delete res.arError;
        if (arId !== null && !linked) { await ctx.woo.del(`wc/v3/products/${arId}`); res.arId = null; res.arNote = 'not_linked'; } else { res.arId = arId; res.arAttrs = termsOk ? 'ok' : 'partial'; }
      } catch (e) { if (!(e instanceof WooError)) throw e; res.arId = null; res.arNote = wooCode(e); res.arError = String(e.message).slice(0, 240); }
    }
    // a translation made before this run (or one whose terms failed then) gets its attributes on a retry: the Arabic terms, then
    // one PUT — never in the run that just posted the translation with them
    if (!res.error && wooId(prev.arId) !== null && wooId(res.arId) !== null && res.arAttrs !== 'ok' && Array.isArray(built.arAttributes) && built.arAttributes.length) {
      try {
        const termsOk = await ensureArTerms(ctx, built.product.attributes, built.arAttributes);
        await ctx.woo.put(`wc/v3/products/${res.arId}`, { attributes: built.arAttributes });
        res.arAttrs = termsOk ? 'ok' : 'partial';
      } catch (e) { if (!(e instanceof WooError)) throw e; res.arAttrs = 'failed'; }
    }
    if (!res.error && owner !== null && wooId(res.arId) !== null) await authorOf(res.arId);
    if (wooId(res.productId) !== null) {
      res.authorIds = [...authored];
      res.authorOwner = on;
      res.author = owner === null ? 'no_store' : on === owner && [res.productId, res.arId].filter((x) => wooId(x) !== null).every((x) => authored.has(x)) ? 'ok' : 'failed';
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
    // ar_code / ar_error, not ar_note: redactPII masks every key with «note» (the 29 / 31 Oct rows show <redacted>)
    detail: { batch: batchId, index, sku: res.sku, media: Object.keys(res.media).length, variations: res.variations ?? null, ar: res.arId ?? null, ar_code: res.arNote ?? null, ar_error: res.arError ?? null, ar_attrs: res.arAttrs ?? null, author: res.author ?? null, woo_brand: res.wooBrand ?? null, error: res.error } });
  return json(200, { action: 'studio_upload', result: res.error ? 'error' : 'ok', item: res });
}

// studio_sheet { url } (decision 13): a Google Sheets link → { result: 'ok', csv } | { result: 'error', reason: not_published |
// too_big | unreachable }; a link that is not a Google sheet → 400 bad_link. Read only: no Woo call, nothing stored.
async function studioSheet(args: Json, fetchFn: typeof fetch) {
  const r = await fetchSheetCsv(typeof args.url === 'string' ? args.url.slice(0, 2000) : '', fetchFn) as Json;
  if (r.error === 'bad_link') return json(400, { error: 'bad_link', field: 'url' });
  if (r.error) return json(200, { action: 'studio_sheet', result: 'error', reason: r.error });
  return json(200, { action: 'studio_sheet', result: 'ok', csv: r.csv });
}

// category_create { name_en, name_ar?, parent?, image? }: a new WooCommerce category in English and its Arabic translation
// (best effort, like studio_upload's), then into woo_categories — the English term only: the mirror is the default language's list
// (what the pull reads), so a translation there would show as a second category (B4).
const plainName = (v: unknown) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 80 && !/[<>%]/.test(v) ? v.trim() : null);
// owner batch 14 Nov (decision 9): a category's slug — small English letters, digits and single «-», 1–80; '' / null = the site makes one
const catSlug = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && v.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? v : false);
// B4 (the owner, 11 Nov — «قسم رئيسي جديد … بصورة مربعة»): a category's image comes in the request as { data: base64 } — the page's
// square crop (catImage in products.js) — a PNG / JPEG / WebP of 2 MB at most, checked by its own bytes (never the stated type);
// it goes to the media library (wp/v2/media) and the category and its translation take it as `image: { id }`. undefined / null =
// no image; anything else that is not such an image = false (400).
const CAT_IMAGE_MAX = 2 * 1048576;
function catImageBytes(v: unknown): Uint8Array | null | false {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || typeof v.data !== 'string' || v.data.length > Math.ceil(CAT_IMAGE_MAX / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) return false;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(v.data), (ch) => ch.charCodeAt(0)); } catch { return false; }
  return isPhotoBytes(bytes) && bytes.length <= CAT_IMAGE_MAX ? bytes : false;
}
async function catMedia(run: Run, ctx: Ctx, bytes: Uint8Array, name: string): Promise<number | null> {
  const ext = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpg' : 'webp';
  const media = (await ctx.woo.upload('wp/v2/media', bytes, `category-${name}-${run.now().replace(/[^0-9]/g, '').slice(2, 12)}.${ext}`, MIME[ext])).data;
  return wooId(isObj(media) ? media.id : null);
}
// a category as the page needs it: names, the parent, the site's count and the image's https URL (nothing else of the answer)
const catView = (c: unknown) => (isObj(c) ? { id: wooId(c.id), name: typeof c.name === 'string' ? c.name : '', parent: wooId(c.parent) ?? 0, count: Number.isInteger(Number(c.count)) ? Number(c.count) : 0,
  image: isObj(c.image) && typeof c.image.src === 'string' && /^https:\/\//.test(c.image.src) ? c.image.src.slice(0, 600) : null } : null);
// a category's Arabic translation read in Arabic (WPML's `lang`), taken only when it is that term and linked to the English one
async function catArabic(ctx: Ctx, id: number, en: Json): Promise<Json | null> {
  const arId = wooId(isObj(en.translations) ? en.translations.ar : null);
  if (arId === null || arId === id) return null;
  const a = (await ctx.woo.get(`${CATEGORIES_PATH}/${arId}`, { lang: 'ar' })).data;
  const linked = isObj(a) && wooId(a.id) === arId && (!isObj(a.translations) || wooId(a.translations.en) === id);
  return linked ? a : null;
}
async function categoryCreate(run: Run, args: Json) {
  const name = plainName(args.name_en); const nameAr = args.name_ar == null || args.name_ar === '' ? null : plainName(args.name_ar);
  const parent = args.parent == null || args.parent === 0 ? 0 : wooId(args.parent);
  const img = catImageBytes(args.image); const slug = catSlug(args.slug);
  if (!name || (args.name_ar && !nameAr) || parent === null || img === false || slug === false) return json(400, { error: 'bad_request', ...(img === false ? { field: 'image' } : slug === false ? { field: 'slug' } : {}) });
  const entry = { kind: 'push', direction: 'out', entity: 'woo_categories', entity_id: null, action: 'category_create' };
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled' } }); return json(200, { action: 'category_create', result: 'skipped', reason: 'push_disabled' }); }
  const ctx = await run.ctx();
  let mediaId: number | null = null;
  if (img) {
    try { mediaId = await catMedia(run, ctx, img, name); } catch (e) { if (!(e instanceof WooError || e instanceof ConfigError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e), step: 'image' } }); return json(200, { action: 'category_create', result: 'error', reason: 'media_refused' }); }
    if (mediaId === null) { await logSync(run.db, { ...entry, result: 'error', detail: { error: 'media_refused' } }); return json(200, { action: 'category_create', result: 'error', reason: 'media_refused' }); }
  }
  const image = mediaId === null ? {} : { image: { id: mediaId } };
  let c: Json;
  try { c = (await ctx.woo.post(CATEGORIES_PATH, { name, parent, ...(slug ? { slug } : {}), lang: 'en', wpml_language: 'en', ...image })).data; }
  catch (e) { if (!(e instanceof WooError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_create', result: 'error', reason: wooCode(e) }); }
  const id = wooId(isObj(c) ? c.id : null);
  if (id === null) return json(502, { error: 'woo_error' });
  let arId: number | null = null;
  if (nameAr) {
    // phase 13 decision 56: a sub-category's Arabic translation sits under the parent's Arabic translation (WPML's `translations` on the
    // parent, when the site answers it; else WPML keeps it where it puts it)
    let parentAr: number | null = null;
    if (parent) { try { const pc = (await ctx.woo.get(`${CATEGORIES_PATH}/${parent}`)).data; parentAr = wooId(isObj(pc) && isObj(pc.translations) ? pc.translations.ar : null); } catch (e) { if (!(e instanceof WooError)) throw e; } }
    try { const a = (await ctx.woo.post(CATEGORIES_PATH, { name: nameAr, lang: 'ar', wpml_language: 'ar', translation_of: id, ...(parentAr ? { parent: parentAr } : {}), ...image })).data; arId = wooId(isObj(a) ? a.id : null); }
    catch (e) { if (!(e instanceof WooError)) throw e; }
  }
  await writeCategories(ctx, [c]);
  await logSync(run.db, { ...entry, entity_id: String(id), result: 'ok', detail: { ar: arId, image: mediaId !== null } });
  return json(200, { action: 'category_create', result: 'ok', id, ar_id: arId, image: catView(c)?.image ?? null });
}

// ---------------------------------------------------------------- the categories tab (B4, the owner 11 Nov)

// category_get { id }: the category live from the site for «تعديل» — its name, image and count, and its Arabic translation's
// (read with lang=ar, kept only when linked). A read: nothing written, nothing logged.
async function categoryGet(run: Run, args: Json) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request' });
  const ctx = await run.ctx();
  let c: Json;
  try { c = (await ctx.woo.get(`${CATEGORIES_PATH}/${id}`)).data; }
  catch (e) { if (!(e instanceof WooError)) throw e; if (e.status === 404) return json(404, { error: 'not_found' }); return json(200, { action: 'category_get', result: 'error', reason: wooCode(e) }); }
  if (!isObj(c) || wooId(c.id) !== id) return json(502, { error: 'woo_error' });
  let ar: Json | null = null;
  try { ar = await catArabic(ctx, id, c); } catch (e) { if (!(e instanceof WooError)) throw e; }
  return json(200, { action: 'category_get', result: 'ok', category: catView(c), ar: ar ? catView(ar) : null });
}

// category_update { id, name_en?, name_ar?, image? }: a category's English name and image (PUT on the term), then its Arabic
// translation's name and the same image — read first in Arabic and written (lang=ar) only when it is this category's translation;
// a category without one gets it made like category_create's. Only what changed is sent; the English term goes back to the mirror.
async function categoryUpdate(run: Run, args: Json) {
  const id = wooId(args.id);
  const name = args.name_en == null || args.name_en === '' ? null : plainName(args.name_en);
  const nameAr = args.name_ar == null || args.name_ar === '' ? null : plainName(args.name_ar);
  const img = catImageBytes(args.image); const slug = catSlug(args.slug);
  // owner batch 14 Nov (decision 9): the bulk «تغيير القسم الأب» — a new parent (0 = a main category), never itself or one under it
  const parent = args.parent === undefined || args.parent === null ? null : args.parent === 0 ? 0 : wooId(args.parent);
  if (id === null || (args.name_en && !name) || (args.name_ar && !nameAr) || img === false || slug === false || (args.parent != null && parent === null) || parent === id) return json(400, { error: 'bad_request', ...(img === false ? { field: 'image' } : slug === false ? { field: 'slug' } : parent === id || (args.parent != null && parent === null) ? { field: 'parent' } : {}) });
  if (!name && !nameAr && !img && !slug && parent === null) return json(400, { error: 'bad_request', field: 'nothing' });
  if (parent) {
    const { data: tree } = await run.db.from('woo_categories').select('id, parent_id').range(0, 9999);
    const up = new Map<number, number>((tree ?? []).map((r: Json) => [Number(r.id), Number(r.parent_id) || 0] as [number, number]));
    let x: number = parent; const seen = new Set<number>();
    while (x && !seen.has(x)) { if (x === id) return json(400, { error: 'bad_request', field: 'parent' }); seen.add(x); x = up.get(x) ?? 0; }
  }
  const entry = { kind: 'push', direction: 'out', entity: 'woo_categories', entity_id: String(id), action: 'category_update' };
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled' } }); return json(200, { action: 'category_update', result: 'skipped', reason: 'push_disabled' }); }
  const ctx = await run.ctx();
  let cur: Json;
  try { cur = (await ctx.woo.get(`${CATEGORIES_PATH}/${id}`)).data; }
  catch (e) { if (!(e instanceof WooError)) throw e; if (e.status === 404) return json(404, { error: 'not_found' }); await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_update', result: 'error', reason: wooCode(e) }); }
  if (!isObj(cur) || wooId(cur.id) !== id) return json(502, { error: 'woo_error' });
  let mediaId: number | null = null;
  if (img) {
    try { mediaId = await catMedia(run, ctx, img, name ?? (typeof cur.slug === 'string' ? cur.slug : String(id))); } catch (e) { if (!(e instanceof WooError || e instanceof ConfigError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e), step: 'image' } }); return json(200, { action: 'category_update', result: 'error', reason: 'media_refused' }); }
    if (mediaId === null) { await logSync(run.db, { ...entry, result: 'error', detail: { error: 'media_refused' } }); return json(200, { action: 'category_update', result: 'error', reason: 'media_refused' }); }
  }
  const image = mediaId === null ? {} : { image: { id: mediaId } };
  const enBody = { ...(name && name !== cur.name ? { name } : {}), ...(slug && slug !== cur.slug ? { slug } : {}), ...(parent !== null && parent !== (wooId(cur.parent) ?? 0) ? { parent } : {}), ...image };
  let c: Json = cur;
  if (Object.keys(enBody).length) {
    try { c = (await ctx.woo.put(`${CATEGORIES_PATH}/${id}`, enBody)).data; }
    catch (e) { if (!(e instanceof WooError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_update', result: 'error', reason: wooCode(e) }); }
  }
  // the translation: soft — a failure there is said in the answer (ar), never undoes the English term
  let ar = 'none';
  if (nameAr || mediaId !== null || 'parent' in enBody) {
    try {
      const a = await catArabic(ctx, id, cur);
      const arId = isObj(a) ? wooId(a.id) : null;
      if (a && arId !== null) {
        // a new parent: the translation goes under the parent's Arabic translation (0 = a main category)
        let arParent: Json = {};
        if ('parent' in enBody) { const np = Number(enBody.parent) || 0; if (!np) arParent = { parent: 0 }; else { const pc = (await ctx.woo.get(`${CATEGORIES_PATH}/${np}`)).data; const pa = wooId(isObj(pc) && isObj(pc.translations) ? pc.translations.ar : null); if (pa) arParent = { parent: pa }; } }
        const b = { ...(nameAr && nameAr !== a.name ? { name: nameAr } : {}), ...arParent, ...image };
        ar = 'ok';
        if (Object.keys(b).length) {
          const put = (await ctx.woo.put(`${CATEGORIES_PATH}/${arId}`, b, { lang: 'ar' })).data;
          // WPML answering another term than the translation (it can map an id to the request's language): that term just took the
          // Arabic name — the English name goes straight back on it, and the answer says so
          if (!isObj(put) || wooId(put.id) !== arId) {
            const enName = isObj(c) && typeof c.name === 'string' ? c.name : typeof cur.name === 'string' ? cur.name : null;
            if (wooId(isObj(put) ? put.id : null) === id && 'name' in b && enName) await ctx.woo.put(`${CATEGORIES_PATH}/${id}`, { name: enName });
            ar = 'mismatch';
          }
        }
      } else if (wooId(isObj(cur.translations) ? cur.translations.ar : null) !== null) ar = 'not_linked';
      else if (nameAr) {
        const parent = wooId(cur.parent) ?? 0;
        let parentAr: number | null = null;
        if (parent) { const pc = (await ctx.woo.get(`${CATEGORIES_PATH}/${parent}`)).data; parentAr = wooId(isObj(pc) && isObj(pc.translations) ? pc.translations.ar : null); }
        await ctx.woo.post(CATEGORIES_PATH, { name: nameAr, lang: 'ar', wpml_language: 'ar', translation_of: id, ...(parentAr ? { parent: parentAr } : {}), ...image });
        ar = 'made';
      }
    } catch (e) { if (!(e instanceof WooError)) throw e; ar = wooCode(e); }
  }
  if (isObj(c) && wooId(c.id) === id) await writeCategories(ctx, [c]);
  await logSync(run.db, { ...entry, result: 'ok', detail: { name: 'name' in enBody, slug: 'slug' in enBody, parent: 'parent' in enBody, image: mediaId !== null, ar } });
  return json(200, { action: 'category_update', result: 'ok', id, ar, image: catView(c)?.image ?? null });
}

// category_delete { id }: WooCommerce has no trash for a category, so it goes for good — refused first (409, nothing on the site)
// while anything still uses it: a product in the mirror (any status, the trash too — the site would take the category off it), a
// sub-category (ours or the site's), a maker's «الفئة الأساسية» (0080), or the site's own count. Then DELETE force=true on the
// English term and on its Arabic translation (404 / 410 = already gone), and the rows leave the mirror.
async function categoryDelete(run: Run, args: Json) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request' });
  const entry = { kind: 'push', direction: 'out', entity: 'woo_categories', entity_id: String(id), action: 'category_delete' };
  const refuse = async (reason: string, count: number) => { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason, count } }); return json(409, { error: reason, count }); };
  const q = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => { const { data, error } = await p; if (error) throw new Error(`${what}: ${error.message}`); return Array.isArray(data) ? data.length : 0; };
  const prods = await q(run.db.from('products').select('id').contains('category_ids', [id]).limit(1000), 'products');
  if (prods) return await refuse('has_products', prods);
  const kids = await q(run.db.from('woo_categories').select('id').eq('parent_id', id).limit(1000), 'woo_categories');
  if (kids) return await refuse('has_children', kids);
  const makers = await q(run.db.from('vendors').select('id').contains('main_categories', [id]).limit(1000), 'vendors');
  if (makers) return await refuse('has_makers', makers);
  if (!pushEnabled(run.env)) { await logSync(run.db, { ...entry, result: 'skipped', detail: { reason: 'push_disabled' } }); return json(200, { action: 'category_delete', result: 'skipped', reason: 'push_disabled' }); }
  const ctx = await run.ctx();
  let cur: Json;
  try { cur = (await ctx.woo.get(`${CATEGORIES_PATH}/${id}`)).data; }
  catch (e) {
    if (!(e instanceof WooError)) throw e;
    if (e.status === 404 || e.status === 410) { await run.db.from('woo_categories').delete().eq('id', id); await logSync(run.db, { ...entry, result: 'ok', detail: { gone: true } }); return json(200, { action: 'category_delete', result: 'ok', id, gone: true }); }
    await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_delete', result: 'error', reason: wooCode(e) });
  }
  if (!isObj(cur) || wooId(cur.id) !== id) return json(502, { error: 'woo_error' });
  const siteCount = Number(cur.count) || 0;
  if (siteCount > 0) return await refuse('has_products', siteCount);
  let siteKids: unknown = [];
  try { siteKids = (await ctx.woo.get(CATEGORIES_PATH, { parent: id, per_page: 1 })).data; } catch (e) { if (!(e instanceof WooError)) throw e; await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_delete', result: 'error', reason: wooCode(e) }); }
  if (Array.isArray(siteKids) && siteKids.length) return await refuse('has_children', siteKids.length);
  // the translation must be read before anything goes: a failed read stops here (nothing deleted, never an orphaned Arabic term)
  let a: Json | null = null;
  try { a = await catArabic(ctx, id, cur); }
  catch (e) { if (!(e instanceof WooError)) throw e; if (e.status !== 404 && e.status !== 410) { await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e), step: 'ar' } }); return json(200, { action: 'category_delete', result: 'error', reason: wooCode(e) }); } }
  if (a && (Number(a.count) || 0) > 0) return await refuse('has_products', Number(a.count));
  try { await ctx.woo.delCategory(id); }
  catch (e) { if (!(e instanceof WooError)) throw e; if (e.status !== 404 && e.status !== 410) { await logSync(run.db, { ...entry, result: 'error', detail: { error: wooCode(e) } }); return json(200, { action: 'category_delete', result: 'error', reason: wooCode(e) }); } }
  const arId = a ? wooId(a.id) : null;
  let ar = arId === null ? 'none' : 'ok';
  if (arId !== null) { try { await ctx.woo.delCategory(arId, 'ar'); } catch (e) { if (!(e instanceof WooError)) throw e; ar = e.status === 404 || e.status === 410 ? 'ok' : wooCode(e); } }
  const { error: delErr } = await run.db.from('woo_categories').delete().in('id', arId === null ? [id] : [id, arId]);
  if (delErr) throw new Error(`woo_categories: ${delErr.message}`);
  await logSync(run.db, { ...entry, result: 'ok', detail: { ar } });
  return json(200, { action: 'category_delete', result: 'ok', id, ar });
}

// ---------------------------------------------------------------- product_images_add (phase 5.4 T8)

// product_images_add { id, paths, first? }: the images tool's results (bucket ai-images — a member sends paths of their own
// folder only, the admin any) onto a site product: every path downloaded first (one missing → 404, nothing sent), each sent to
// wp/v2/media, then one PUT with the current images + the new media (first → ahead of them); the translation shares the gallery
// through WPML; the mirror follows the answer; the log holds counts only.
const TOOL_BUCKET = 'ai-images';
const TOOL_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9._-]{1,120}\.(webp|png|jpe?g)$/i;
const IMAGES_ADD_MAX = 10;
async function productImagesAdd(run: Run, args: Json, who: { uid: string | null; admin: boolean }) {
  const id = wooId(args.id);
  if (id === null) return json(400, { error: 'bad_request', field: 'id' });
  const paths = Array.isArray(args.paths) ? [...new Set(args.paths)] : [];
  if (!paths.length || paths.length > IMAGES_ADD_MAX || !paths.every((p) => typeof p === 'string' && TOOL_PATH.test(p))) return json(400, { error: 'bad_request', field: 'paths' });
  if (!who.admin && !(who.uid && paths.every((p) => (p as string).startsWith(who.uid + '/')))) return json(401, { error: 'unauthorized' });
  const first = args.first === true;
  const detail = { count: paths.length, first };
  if (!pushEnabled(run.env)) return await pushSkip(run, 'product_images_add', id, detail);
  const blobs: { path: string; bytes: Uint8Array; ext: string }[] = [];
  for (const path of paths as string[]) {
    const { data: blob, error } = await run.db.storage.from(TOOL_BUCKET).download(path);
    if (error || !blob) return json(404, { error: 'not_found', field: 'paths' });
    blobs.push({ path, bytes: new Uint8Array(await blob.arrayBuffer()), ext: path.split('.').pop()!.toLowerCase() });
  }
  const ctx = await run.ctx();
  const p = (await ctx.woo.get(`wc/v3/products/${id}`)).data;
  if (!isObj(p)) return json(502, { error: 'woo_error' });
  const current = (Array.isArray(p.images) ? p.images : []).map((i: Json) => wooId(isObj(i) ? i.id : null)).filter((x): x is number => x !== null);
  const media: number[] = [];
  const stamp = run.now().replace(/[^0-9]/g, '').slice(2, 12);
  for (const [k, b] of blobs.entries()) {
    const m = (await ctx.woo.upload('wp/v2/media', b.bytes, `${fileBase(p.name)}-ai-${stamp}-${String(k + 1).padStart(2, '0')}.${b.ext}`, MIME[b.ext] ?? 'image/webp')).data;
    const mid = wooId(isObj(m) ? m.id : null);
    if (mid === null) { await logSync(run.db, { ...productEntry(id, 'product_images_add'), result: 'error', detail: { ...detail, media: media.length, error: 'media_refused' } }); return json(502, { error: 'media_refused', media }); }
    media.push(mid);
  }
  const images = (first ? [...media, ...current] : [...current, ...media]).map((i) => ({ id: i }));
  const saved = (await ctx.woo.put(`wc/v3/products/${id}`, { images })).data;
  await writeProducts(ctx, [saved].filter(isObj));
  await logSync(run.db, { ...productEntry(id, 'product_images_add'), result: 'ok', detail: { ...detail, media: media.length, images: images.length } });
  return json(200, { action: 'product_images_add', result: 'ok', media, count: media.length, images: images.length });
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
    if (action === 'order_trash') return await orderTrash(run, args);
    if (action === 'suborder_trash') return await suborderTrash(run, args);
    if (action === 'line_trash') return await lineTrash(run, args);
    if (action === 'suborder_status') return await suborderStatus(run, args);
    if (action === 'order_create') return await orderCreate(run, args);
    if (action === 'order_pay_link') return await orderPayLink(run, args);
    if (action === 'push_vendor') return await pushVendor(run, args);
    if (action === 'vendor_photo') return await vendorPhoto(run, args);
    if (action === 'vendor_store') { const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''; return await vendorStore(run, args, deps.userDb && jwt ? deps.userDb(jwt) : null); }
    if (action === 'register_webhooks') return await registerWebhooks(run, args);
    if (action === 'probe_store') return await probeStore(run, args);
    if (action === 'probe_dokan') return await probeDokan(run, args);
    if (action === 'statement') return await statement(run, args);
    if (action === 'withdraw_approve') { const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''; return await withdrawApprove(run, args, deps.userId && jwt ? await deps.userId(jwt) : null); }
    if (action === 'withdraw_create') return await withdrawCreate(run, args);
    if (action === 'product_get') return await productGet(run, args);
    if (action === 'product_save') return await productSave(run, args);
    if (action === 'products_batch') return await productsBatch(run, args);
    if (action === 'products_vendor') return await productsVendor(run, args);
    if (action === 'products_trash' || action === 'products_restore') return await productsTrash(run, args, action === 'products_restore');
    if (action === 'products' && args.full === true) return await fullProducts(run);
    if (action === 'studio_upload') return await studioUpload(run, args);
    if (action === 'category_create') return await categoryCreate(run, args);
    if (action === 'category_get') return await categoryGet(run, args);
    if (action === 'category_update') return await categoryUpdate(run, args);
    if (action === 'category_delete') return await categoryDelete(run, args);
    if (action === 'studio_sheet') return await studioSheet(args, deps.fetch);
    if (action === 'inventory_push') return await inventoryPush(run, args);
    if (action === 'product_duplicate') { const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''; return await productDuplicate(run, args, deps.userDb && jwt ? deps.userDb(jwt) : null); }
    if (action === 'product_images_add') {
      // who sends: the member's id (the paths must be of their folder) and whether they are the admin
      const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
      const uid = deps.userId ? await deps.userId(jwt) : null;
      const { data: adm, error: admErr } = deps.userDb ? await deps.userDb(jwt).rpc('is_admin') : { data: false, error: null };
      return await productImagesAdd(run, args, { uid, admin: !admErr && adm === true });
    }
    if (action === 'withdrawals') {
      try {
        const makers = await makersWithStore(run);
        const w = await pullWithdrawals(run, makers, run.now());
        // 0078: a maker whose request was just settled gets Dokan's balance now too (the request lowered it)
        if (w.settledMakers.size) await readBalances(run, makers.filter((v) => w.settledMakers.has(String(v.id))), run.now());
        const counts = { withdrawals: w.withdrawals, skipped: w.skipped, failed_rows: w.failedRows, settled: w.settled, pages: w.pages, done: w.done };
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', action: 'refresh', result: 'ok', detail: counts });
        return json(200, { action, result: 'ok', counts });
      } catch (e) {
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'dokan_withdrawals', action: 'refresh', result: 'error', detail: { error: errorText(e, makeScrubber(run.env)) } });
        if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
        return json(e instanceof WooError ? 502 : 500, { error: 'sync_failed', action });
      }
    }
    if (action === 'carts') {
      try {
        if (args.probe === true) { if (mode !== 'member') return json(401, { error: 'unauthorized' }); return json(200, { action, result: 'ok', ...(await probeCarts(run)) }); } // the admin's diagnostic, never the cron's
        const counts = await pullCarts(run);
        // the snippet not on the site = nothing to say every 10 minutes (the owner declined it, 9 Nov): no log row, the cron stays quiet
        if (counts.installed) await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'cs_carts', action: 'sync', result: 'ok', detail: counts });
        return json(200, { action, result: 'ok', counts });
      } catch (e) {
        await logSync(run.db, { kind: run.kind, direction: 'in', entity: 'cs_carts', action: 'sync', result: 'error', detail: { error: errorText(e, makeScrubber(run.env)) } });
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
    const isPush = action === 'push_status' || action === 'order_trash' || action === 'suborder_trash' || action === 'push_vendor' || action === 'withdraw_approve' || PRODUCT_ACTIONS.includes(action);
    const entity = action === 'push_status' || action === 'order_trash' || action === 'suborder_trash' ? 'order' : action === 'push_vendor' ? 'vendor' : action === 'withdraw_approve' ? 'dokan_withdrawals'
      : PRODUCT_ACTIONS.includes(action) || action === 'products' ? 'products' : 'webhooks';
    const entityId = action === 'push_status' || action === 'order_trash' || action === 'suborder_trash' ? wooId(args.order_id)?.toString() ?? null : action === 'push_vendor' && typeof args.vendor_id === 'string' ? args.vendor_id.slice(0, 36)
      : action === 'withdraw_approve' || action === 'product_get' || action === 'product_save' || action === 'product_images_add' ? wooId(args.id)?.toString() ?? null : null;
    await logSync(deps.db, { kind: isPush ? 'push' : run.kind, direction: 'out', entity, entity_id: entityId, action, result: 'error', detail: { error: errorText(e, makeScrubber(deps.env)) } });
    if (e instanceof ConfigError) return json(500, { error: 'not_configured' });
    return json(e instanceof WooError ? 502 : 500, { error: e instanceof WooError ? 'woo_error' : 'failed' });
  }
}

// ---------------------------------------------------------------- runtime wiring

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
let service: Db = null;
async function realDeps(): Promise<Deps> {
  const raw = Deno.env.toObject();
  service ??= createClient(raw.SUPABASE_URL ?? '', raw.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  const env = await vaultEnv(service, raw); // the keys written from the settings page win over the Supabase secrets (0056)
  return {
    env, fetch: globalThis.fetch, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}

// Serve only as the entry point (the Supabase Edge Runtime defines EdgeRuntime); importing the module (tests) does not.
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve(async (req) => handler(req, await realDeps()));
