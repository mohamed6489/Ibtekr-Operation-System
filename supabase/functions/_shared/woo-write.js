// woo-write: the WooCommerce → Postgres write path shared by woo-webhook and woo-sync (service_role client: the
// functions read and write the tables directly, never orders_v).
// * Makers first: an unknown _dokan_vendor_id is looked up in vendors, then fetched from dokan/v1/stores/{id} and
//   upserted on woo_vendor_id. saveVendors writes a store that is already in the table with raw only, by an UPDATE on
//   woo_vendor_id — the team owns name / status / phone / email and the phase-3 columns after the first insert (decision 2 of
//   phase 3: Dokan's public REST returns neither `enabled` nor a phone, and a full rewrite every 15 minutes would undo
//   the team's edits) — and a new store with the full mapStore row (joined_at from `registered`; never aliases /
//   commission_pct / the other team columns). A store Dokan does not know (404) → woo_sync_log 'skipped'; any other
//   failure (401/403/5xx/timeout/network) → woo_sync_log 'error'. Either way the id is asked once per run / delivery
//   (missingVendors / failedVendors) and again on the next one; the rows are still written, with vendor_id null, and
//   the rest of the delivery / page goes on. Only then are rows mapped for good.
// * Orders / lines are upserted with the sync-owned columns only (ORDER_COLUMNS / ITEM_COLUMNS — commission_rate /
//   commission_fee among them, written on every run: the site's commission on the line), so an existing row
//   keeps the team's operational values (orders.confirm*/deposit/note/cancel/ret, order_items.status/expected_at/
//   comment/ready_at/waybill/pulled/ret/store, order_items.sub_order_id). customer_city / customer_address /
//   customer_state and note (= the website note, customer_note) are written on a new order only (the team edits city,
//   address and note afterwards; the governorate code stays with that first address, display only), and a line
//   whose maker is not known from the payload keeps the vendor_id it has (its sub-order gave it). orders.status comes
//   from incomingStatus on the status and woo_status stored now (Woo's slug unchanged → the team's status stays). A
//   payload older than the stored woo_updated_at (an out-of-order or replayed delivery) is skipped as 'stale'. A line
//   that disappeared from WooCommerce is flagged removed = true (never deleted).
// * A Dokan sub-order is written once its parent is in orders (a missing parent is fetched from wc/v3/orders/{id}
//   first; a 404 → 'skipped', any other failure → 'error', and only that sub-order waits for the next delivery / run),
//   upserted on woo_order_id, then linked to the parent's lines (order_items.sub_order_id): those of the same maker,
//   and those of its products (line_items[*].product_id / variation_id) whose maker is still unknown, which get the
//   sub-order's maker — a multi-vendor parent's lines usually carry no _dokan_vendor_id.
// * A row refused with a data error (upsertRows: SQLSTATE 22xxx / 23xxx) is skipped with one woo_sync_log error row
//   (entity = the table, entity_id = its key) and the rest of the delivery / page goes on; a refused order takes its
//   lines with it. Counted as `failed`.
// * The site's governorates (woo-sync part `states`): upserted on code into woo_states, never deleted.
import { isSubOrder, mapOrder, mapStore, mapSubOrder, redactPII } from './woo-core.js';
import { DbError, logSync, selectIn, upsertRows } from './db.js';
import { errorText } from './woo-api.js';

export const ORDER_COLUMNS = ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'customer_state',
  'payment_method', 'payment_title', 'status', 'woo_status', 'total', 'currency', 'customer_note', 'note', 'placed_at', 'woo_updated_at',
  'raw', 'synced_at'];
export const ITEM_COLUMNS = ['id', 'order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'commission_rate', 'commission_fee', 'raw', 'removed'];
// Written on a new order only: an existing order is upserted without them (the team edits city / address / note after
// the first sync; customer_state, display only, stays with that first address).
const TEAM_EDITED = ['customer_city', 'customer_address', 'customer_state', 'note'];
const ORDER_UPDATE_COLUMNS = ORDER_COLUMNS.filter((c) => !TEAM_EDITED.includes(c));
const ITEM_COLUMNS_NO_VENDOR = ITEM_COLUMNS.filter((c) => c !== 'vendor_id');
const SUB_COLUMNS = ['order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'raw'];
// A new store: the full mapStore row, upserted. An existing store: raw only (decision 2 of phase 3), as an UPDATE by
// woo_vendor_id — never an upsert: Postgres checks the not-null columns of the proposed row before `on conflict`, so a
// raw-only upsert fails with 23502 on `name` for every store (seen live, 26 Oct, every cron run after the v8 deploy).
const VENDOR_COLUMNS = ['woo_vendor_id', 'name', 'phone', 'email', 'status', 'joined_at', 'raw'];
// products.raw is readable by members: an allow-list of public product fields (no store owner name or address).
const PRODUCT_RAW = ['id', 'name', 'slug', 'type', 'status', 'sku', 'price', 'regular_price', 'sale_price', 'on_sale', 'stock_status',
  'stock_quantity', 'date_created_gmt', 'date_modified_gmt', 'permalink', 'parent_id'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const pick = (row, cols) => Object.fromEntries(cols.map((c) => [c, row[c] ?? null]));
const pickScalars = (o, keys) => Object.fromEntries(keys.filter((k) => isObj(o) && k in o && isScalar(o[k])).map((k) => [k, o[k]]));
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const orNull = (v) => str(v) || null;
const num = (v) => (str(v) === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** A positive integer WooCommerce id, or null. */
export const wooId = (v) => { const n = num(v); return Number.isInteger(n) && n > 0 ? n : null; };
/** Woo *_gmt dates carry no zone: UTC. → ISO with a zone, or null. */
export const gmtIso = (v) => { const s = str(v); return !s ? null : /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`; };
const ms = (v) => { const t = Date.parse(gmtIso(v) ?? ''); return Number.isFinite(t) ? t : null; };
// Last payload wins per id (a page or a batch may carry the same object twice).
const lastById = (list) => [...new Map(list.map((o, i) => [wooId(o.id) ?? `#${i}`, o])).values()];

/** Per-invocation state: status_map (read once), makers resolved so far, the Woo client, the log kind, the clock. */
export async function writeContext({ db, woo, kind, now }) {
  const { data, error } = await db.from('status_map').select('system_status, woo_status, direction, sort');
  if (error) throw new DbError('status_map', error);
  return { db, woo, kind, now, statusMap: data ?? [], vendors: new Map(), missingVendors: new Set(), failedVendors: new Set() };
}

const log = (ctx, row) => logSync(ctx.db, { kind: ctx.kind, direction: 'in', ...row });

// upsertRows + one error row per row a data error refused. → { rows (the `returning` rows), bad: Set of keys }.
async function save(ctx, table, rows, onConflict, returning = null) {
  const res = await upsertRows(ctx.db, table, rows, onConflict, returning);
  for (const b of res.bad) {
    await log(ctx, { entity: table, entity_id: b.key, action: 'upsert', result: 'error', detail: { error: errorText(b.error, ctx.woo.scrub) } });
  }
  return { rows: res.rows, bad: new Set(res.bad.map((b) => b.key)) };
}

// ---------------------------------------------------------------- makers

/**
 * mapStore rows → vendors, upserted on woo_vendor_id, their ids remembered in ctx.vendors. A store already in the table
 * (ctx.vendors, else looked up) gets raw only, by one UPDATE per store; a new one is inserted with the full row (see the
 * header). → number
 * written.
 */
export async function saveVendors(ctx, rows) {
  const valid = rows.filter((r) => wooId(r.woo_vendor_id) !== null);
  const ids = [...new Set(valid.map((r) => wooId(r.woo_vendor_id)))];
  const known = new Set(ids.filter((id) => ctx.vendors.has(id)));
  for (const v of await selectIn(ctx.db, 'vendors', 'id, woo_vendor_id', 'woo_vendor_id', ids.filter((id) => !known.has(id)))) {
    known.add(Number(v.woo_vendor_id));
    ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  }
  const added = await save(ctx, 'vendors', valid.filter((r) => !known.has(wooId(r.woo_vendor_id))).map((r) => pick(r, VENDOR_COLUMNS)), 'woo_vendor_id', 'id, woo_vendor_id');
  const kept = await updateVendorRaw(ctx, valid.filter((r) => known.has(wooId(r.woo_vendor_id))));
  for (const v of added.rows) ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  return valid.length - added.bad.size - kept.bad.size;
}

// raw of each existing store, one UPDATE by woo_vendor_id (the team owns every other column). A row refused with a data
// error (SQLSTATE 22xxx / 23xxx) gets one woo_sync_log error row and the others go on; any other error throws.
async function updateVendorRaw(ctx, rows) {
  const bad = new Set();
  for (const r of rows) {
    const id = wooId(r.woo_vendor_id);
    const { error } = await ctx.db.from('vendors').update({ raw: r.raw }).eq('woo_vendor_id', id);
    if (!error) continue;
    if (!/^2[23]/.test(String(error.code ?? ''))) throw new DbError('vendors', error);
    bad.add(String(id));
    await log(ctx, { entity: 'vendors', entity_id: String(id), action: 'update', result: 'error', detail: { error: errorText(new DbError('vendors', error), ctx.woo.scrub) } });
  }
  return { bad };
}

// The store as a vendors row, or null: 404 / another store → skipped (missingVendors); any other failure → an error
// row (failedVendors). Both sets live for this run / delivery only, so the next one asks again.
async function fetchStore(ctx, id) {
  let store = null;
  try {
    store = (await ctx.woo.get(`dokan/v1/stores/${id}`)).data;
  } catch (e) {
    if (e?.status !== 404) {
      ctx.failedVendors.add(id);
      await log(ctx, { entity: 'vendor', entity_id: String(id), action: 'fetch', result: 'error', detail: { error: errorText(e, ctx.woo.scrub) } });
      return null;
    }
  }
  const row = store === null ? null : mapStore(store);
  if (row?.woo_vendor_id === id) return row;
  ctx.missingVendors.add(id);
  await log(ctx, { entity: 'vendor', entity_id: String(id), action: 'fetch', result: 'skipped', detail: { reason: 'store_not_found' } });
  return null;
}

/** Makes every given Dokan vendor id known to ctx.vendors (table first, then Dokan), or marks it missing. */
export async function resolveVendors(ctx, wooIds) {
  const wanted = [...new Set(wooIds)].filter((id) => !ctx.vendors.has(id) && !ctx.missingVendors.has(id) && !ctx.failedVendors.has(id));
  if (!wanted.length) return;
  for (const v of await selectIn(ctx.db, 'vendors', 'id, woo_vendor_id', 'woo_vendor_id', wanted)) ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  const stores = [];
  for (const id of wanted.filter((id) => !ctx.vendors.has(id))) {
    const row = await fetchStore(ctx, id);
    if (row) stores.push(row);
  }
  await saveVendors(ctx, stores);
}

// Maps every payload; when some maker was unknown, resolves them all once and maps again.
async function mapWithVendors(ctx, list, map) {
  const first = list.map(map);
  const unknown = first.flatMap((m) => m.unknownVendorIds ?? []);
  if (!unknown.length) return first;
  await resolveVendors(ctx, unknown);
  return list.map(map);
}

// ---------------------------------------------------------------- orders

// Lines of these orders that are stored, not flagged, and absent from their payload → removed = true.
async function flagRemovedLines(ctx, kept) {
  const listed = kept.filter(({ o }) => Array.isArray(o.line_items));
  if (!listed.length) return;
  const present = new Set(listed.flatMap(({ m }) => m.items.map((i) => i.id)));
  const stored = await selectIn(ctx.db, 'order_items', 'id', 'order_id', listed.map(({ m }) => m.order.id), (q) => q.eq('removed', false));
  const gone = stored.map((r) => Number(r.id)).filter((id) => !present.has(id));
  for (let i = 0; i < gone.length; i += 100) {
    const { error } = await ctx.db.from('order_items').update({ removed: true }).in('id', gone.slice(i, i + 100));
    if (error) throw new DbError('order_items', error);
  }
}

/**
 * Parent orders → orders + order_items (+ removed flags, conflict rows). Sub-orders in the list are ignored here.
 * → { written: [ids], skipped: n (before_start / draft / invalid / stale), conflicts: n, failed: n (refused rows) }.
 */
export async function writeOrders(ctx, wooOrders) {
  const parents = lastById(wooOrders.filter((o) => isObj(o) && !isSubOrder(o)));
  const ids = parents.map((o) => wooId(o.id)).filter((id) => id !== null);
  const stored = new Map((await selectIn(ctx.db, 'orders', 'id, status, woo_status, woo_updated_at', 'id', ids)).map((r) => [Number(r.id), r]));
  const now = ctx.now();
  const mapped = await mapWithVendors(ctx, parents, (o) => {
    const row = stored.get(wooId(o.id));
    return mapOrder(o, { statusMap: ctx.statusMap, vendorsByWooId: ctx.vendors, now, currentStatus: row?.status ?? null, currentWooStatus: row?.woo_status ?? null });
  });
  const kept = mapped.map((m, i) => ({ o: parents[i], m })).filter(({ o, m }) => {
    if (m.skipped) return false;
    const before = ms(stored.get(m.order.id)?.woo_updated_at), incoming = ms(o.date_modified_gmt);
    return before === null || incoming === null || incoming >= before;
  });

  const isNew = ({ m }) => !stored.has(m.order.id);
  const added = await save(ctx, 'orders', kept.filter(isNew).map(({ m }) => pick(m.order, ORDER_COLUMNS)), 'id');
  const updated = await save(ctx, 'orders', kept.filter((k) => !isNew(k)).map(({ m }) => pick(m.order, ORDER_UPDATE_COLUMNS)), 'id');
  const written = kept.filter(({ m }) => !added.bad.has(String(m.order.id)) && !updated.bad.has(String(m.order.id)));
  const items = written.flatMap(({ m }) => m.items).filter((i) => i.id !== null).map((i) => ({ ...i, removed: false }));
  const known = await save(ctx, 'order_items', items.filter((i) => i.vendor_id !== null).map((i) => pick(i, ITEM_COLUMNS)), 'id');
  const unknown = await save(ctx, 'order_items', items.filter((i) => i.vendor_id === null).map((i) => pick(i, ITEM_COLUMNS_NO_VENDOR)), 'id');
  await flagRemovedLines(ctx, written);

  const conflicts = written.filter(({ m }) => m.statusResult === 'conflict');
  for (const { m } of conflicts) {
    await log(ctx, { entity: 'order', entity_id: String(m.order.id), action: 'status', result: 'conflict', detail: { woo_status: m.order.woo_status, status: m.order.status } });
  }
  return { written: written.map(({ m }) => m.order.id), skipped: parents.length - kept.length, conflicts: conflicts.length,
    failed: added.bad.size + updated.bad.size + known.bad.size + unknown.bad.size };
}

// ---------------------------------------------------------------- sub-orders

// → { written } | { missing } (404, or a payload writeOrders skips) | { error } (any other Woo failure: scrubbed text;
// or the parent row refused by the database, logged by writeOrders).
async function fetchParent(ctx, id) {
  let order;
  try {
    order = (await ctx.woo.get(`wc/v3/orders/${id}`)).data;
  } catch (e) {
    return e?.status === 404 ? { missing: true } : { error: errorText(e, ctx.woo.scrub) };
  }
  if (!isObj(order)) return { missing: true };
  const r = await writeOrders(ctx, [order]);
  return r.written.includes(id) ? { written: true } : r.failed ? { error: 'parent row refused by the database' } : { missing: true };
}

// The product and variation ids of a sub-order's lines.
const productIdsOf = (o) => [...new Set((Array.isArray(o.line_items) ? o.line_items : []).filter(isObj)
  .flatMap((li) => [wooId(li.product_id), wooId(li.variation_id)]).filter((id) => id !== null))];

// A saved sub-order { id, order_id, vendor_id } → its parent's lines: those of its products whose maker is unknown
// (they take the sub-order's maker: coalesce(vendor_id, s.vendor_id)), then every line of its maker.
async function linkLines(ctx, s, productIds) {
  const run = async (query) => { const { error } = await query; if (error) throw new DbError('order_items', error); };
  if (productIds.length) {
    await run(ctx.db.from('order_items').update({ sub_order_id: s.id, vendor_id: s.vendor_id ?? null })
      .eq('order_id', s.order_id).in('product_id', productIds).is('vendor_id', null));
  }
  if (s.vendor_id) await run(ctx.db.from('order_items').update({ sub_order_id: s.id }).eq('order_id', s.order_id).eq('vendor_id', s.vendor_id));
}

/**
 * Dokan sub-orders → sub_orders (upsert on woo_order_id) + order_items.sub_order_id (and a missing vendor_id) for the
 * parent's lines (linkLines). Operational statuses are never touched. → { written: [woo_order_ids], skipped: n,
 * failed: n (refused rows) }.
 */
export async function writeSubOrders(ctx, wooSubs) {
  const subs = lastById(wooSubs.filter((o) => isObj(o) && isSubOrder(o) && wooId(o.parent_id) !== null));
  if (!subs.length) return { written: [], skipped: 0, failed: 0 };
  const parentIds = [...new Set(subs.map((o) => wooId(o.parent_id)))];
  const present = new Set((await selectIn(ctx.db, 'orders', 'id', 'id', parentIds)).map((r) => Number(r.id)));
  const failed = new Map(); // parent id → error text
  for (const id of parentIds.filter((id) => !present.has(id))) {
    const r = await fetchParent(ctx, id);
    if (r.written) present.add(id);
    else if (r.error) failed.set(id, r.error);
  }

  const ready = subs.filter((o) => present.has(wooId(o.parent_id)));
  for (const o of subs.filter((o) => !present.has(wooId(o.parent_id)))) {
    const parent_id = wooId(o.parent_id), error = failed.get(parent_id);
    await log(ctx, { entity: 'sub_order', entity_id: String(wooId(o.id) ?? ''), action: 'link', result: error ? 'error' : 'skipped',
      detail: error ? { reason: 'parent_fetch_failed', parent_id, error } : { reason: 'parent_missing', parent_id } });
  }
  const mapped = await mapWithVendors(ctx, ready, (o) => mapSubOrder(o, { vendorsByWooId: ctx.vendors }));
  const rows = mapped.filter((m) => !m.skipped).map((m) => pick(m.sub, SUB_COLUMNS));
  const products = new Map(ready.map((o) => [wooId(o.id), productIdsOf(o)])); // woo_order_id → its payload's products
  const { rows: saved, bad } = await save(ctx, 'sub_orders', rows, 'woo_order_id', 'id, order_id, vendor_id, woo_order_id');
  for (const s of saved) await linkLines(ctx, s, products.get(Number(s.woo_order_id)) ?? []);
  return { written: rows.map((r) => r.woo_order_id).filter((id) => !bad.has(String(id))), skipped: subs.length - rows.length, failed: bad.size };
}

/** A sync page: parents first, then sub-orders. → { orders, sub_orders, skipped, conflicts, failed }. */
export async function writeOrderPage(ctx, page) {
  const list = page.filter(isObj);
  const parents = await writeOrders(ctx, list.filter((o) => !isSubOrder(o)));
  const subs = await writeSubOrders(ctx, list.filter(isSubOrder));
  return { orders: parents.written.length, sub_orders: subs.written.length, skipped: parents.skipped + subs.skipped, conflicts: parents.conflicts,
    failed: parents.failed + subs.failed };
}

// ---------------------------------------------------------------- products

/**
 * A wc/v3/products item → { product (products row), unknownVendorIds } or { skipped: 'invalid' } (no id / name).
 * permalink: the product page on the site when it is an https:// URL, else null (the orders screen links to it).
 */
export function mapProduct(p, vendorsByWooId) {
  const id = wooId(p?.id);
  if (id === null || typeof p.name !== 'string') return { skipped: 'invalid', product: null, unknownVendorIds: [] };
  const maker = wooId(isObj(p.store) ? p.store.id : null); // Dokan adds `store` to the WC product response
  const uuid = maker === null ? null : vendorsByWooId.get(maker) ?? null;
  const image = Array.isArray(p.images) && isObj(p.images[0]) ? orNull(p.images[0].src) : null;
  const link = typeof p.permalink === 'string' ? p.permalink.trim() : '';
  const raw = { ...pickScalars(p, PRODUCT_RAW),
    ...(Array.isArray(p.categories) ? { categories: p.categories.filter(isObj).map((c) => pickScalars(c, ['id', 'name', 'slug'])) } : {}),
    ...(isObj(p.store) ? { store: pickScalars(p.store, ['id', 'shop_name']) } : {}) };
  return {
    product: { id, sku: orNull(p.sku), name: p.name.trim() || `#${id}`, image_url: image, permalink: link.startsWith('https://') ? link : null,
      vendor_id: uuid, price: num(p.price), status: orNull(p.status), raw: redactPII(raw) },
    unknownVendorIds: maker !== null && uuid === null ? [maker] : [],
  };
}

/** Products → products (upsert on id). → { written: [ids], skipped: n, failed: n (refused rows) }. */
export async function writeProducts(ctx, wooProducts) {
  const list = lastById(wooProducts.filter(isObj));
  const mapped = await mapWithVendors(ctx, list, (p) => mapProduct(p, ctx.vendors));
  const rows = mapped.filter((m) => !m.skipped).map((m) => m.product);
  const { bad } = await save(ctx, 'products', rows, 'id');
  return { written: rows.map((r) => r.id).filter((id) => !bad.has(String(id))), skipped: list.length - rows.length, failed: bad.size };
}

// ---------------------------------------------------------------- governorates

/**
 * The site's state list (wc/v3/data/countries/EG → states: [{ code, name }]) → woo_states, upserted on code with
 * updated_at = ctx.now(). An item without a non-empty string code and name (trimmed) is skipped; a code listed twice
 * keeps its last name. Nothing is deleted (an old order may still carry a code the site dropped).
 * → { written: [codes], skipped: n (malformed items), failed: n (refused rows) }.
 */
export async function writeStates(ctx, states) {
  const list = Array.isArray(states) ? states : [];
  const valid = list.filter((s) => isObj(s) && typeof s.code === 'string' && s.code.trim() !== '' && typeof s.name === 'string' && s.name.trim() !== '');
  const now = ctx.now();
  const rows = [...new Map(valid.map((s) => [s.code.trim(), { code: s.code.trim(), name: s.name.trim(), updated_at: now }])).values()];
  const { bad } = await save(ctx, 'woo_states', rows, 'code');
  return { written: rows.map((r) => r.code).filter((code) => !bad.has(code)), skipped: list.length - valid.length, failed: bad.size };
}
