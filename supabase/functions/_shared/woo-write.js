// woo-write: the WooCommerce → Postgres write path shared by woo-webhook and woo-sync (service_role client: the
// functions read and write the tables directly, never orders_v).
// * Makers first: an unknown _dokan_vendor_id is looked up in vendors, then fetched from dokan/v1/stores/{id} and
//   upserted on woo_vendor_id (mapStore never carries aliases / commission_pct, so the owner's values stay); a store
//   Dokan does not know → woo_sync_log 'skipped' and the row keeps vendor_id null. Only then are rows mapped for good.
// * Orders / lines are upserted with the sync-owned columns only (ORDER_COLUMNS / ITEM_COLUMNS), so an existing row
//   keeps the team's operational values (orders.confirm*/deposit/note/cancel/ret, order_items.status/expected_at/
//   comment/ready_at/waybill/pulled/ret/store, order_items.sub_order_id). orders.status comes from incomingStatus on
//   the status stored now. A payload older than the stored woo_updated_at (an out-of-order or replayed delivery) is
//   skipped as 'stale'. A line that disappeared from WooCommerce is flagged removed = true (never deleted).
// * A Dokan sub-order is written once its parent is in orders (a missing parent is fetched from wc/v3/orders/{id}
//   first), upserted on woo_order_id, then linked to the parent's lines of the same maker (order_items.sub_order_id).
import { isSubOrder, mapOrder, mapStore, mapSubOrder, redactPII } from './woo-core.js';
import { DbError, logSync, selectIn, upsertRows } from './db.js';

export const ORDER_COLUMNS = ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'payment_method',
  'payment_title', 'status', 'woo_status', 'total', 'currency', 'customer_note', 'placed_at', 'woo_updated_at', 'raw', 'synced_at'];
export const ITEM_COLUMNS = ['id', 'order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'raw', 'removed'];
const SUB_COLUMNS = ['order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'raw'];
const VENDOR_COLUMNS = ['woo_vendor_id', 'name', 'phone', 'email', 'status', 'raw'];
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
  return { db, woo, kind, now, statusMap: data ?? [], vendors: new Map(), missingVendors: new Set() };
}

const log = (ctx, row) => logSync(ctx.db, { kind: ctx.kind, direction: 'in', ...row });

// ---------------------------------------------------------------- makers

/** Upserts vendors rows (mapStore output) on woo_vendor_id and remembers their ids. → number written. */
export async function saveVendors(ctx, rows) {
  const valid = rows.filter((r) => wooId(r.woo_vendor_id) !== null).map((r) => pick(r, VENDOR_COLUMNS));
  for (const v of await upsertRows(ctx.db, 'vendors', valid, 'woo_vendor_id', 'id, woo_vendor_id')) ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  return valid.length;
}

async function fetchStore(ctx, id) {
  try {
    const row = mapStore((await ctx.woo.get(`dokan/v1/stores/${id}`)).data);
    if (row.woo_vendor_id === id) return row;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  ctx.missingVendors.add(id);
  await log(ctx, { entity: 'vendor', entity_id: String(id), action: 'fetch', result: 'skipped', detail: { reason: 'store_not_found' } });
  return null;
}

/** Makes every given Dokan vendor id known to ctx.vendors (table first, then Dokan), or marks it missing. */
export async function resolveVendors(ctx, wooIds) {
  const wanted = [...new Set(wooIds)].filter((id) => !ctx.vendors.has(id) && !ctx.missingVendors.has(id));
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
 * → { written: [ids], skipped: n (before_start / draft / invalid / stale), conflicts: n }.
 */
export async function writeOrders(ctx, wooOrders) {
  const parents = lastById(wooOrders.filter((o) => isObj(o) && !isSubOrder(o)));
  const ids = parents.map((o) => wooId(o.id)).filter((id) => id !== null);
  const stored = new Map((await selectIn(ctx.db, 'orders', 'id, status, woo_updated_at', 'id', ids)).map((r) => [Number(r.id), r]));
  const now = ctx.now();
  const mapped = await mapWithVendors(ctx, parents, (o) =>
    mapOrder(o, { statusMap: ctx.statusMap, vendorsByWooId: ctx.vendors, now, currentStatus: stored.get(wooId(o.id))?.status ?? null }));
  const kept = mapped.map((m, i) => ({ o: parents[i], m })).filter(({ o, m }) => {
    if (m.skipped) return false;
    const before = ms(stored.get(m.order.id)?.woo_updated_at), incoming = ms(o.date_modified_gmt);
    return before === null || incoming === null || incoming >= before;
  });

  await upsertRows(ctx.db, 'orders', kept.map(({ m }) => pick(m.order, ORDER_COLUMNS)), 'id');
  const items = kept.flatMap(({ m }) => m.items).filter((i) => i.id !== null).map((i) => pick({ ...i, removed: false }, ITEM_COLUMNS));
  await upsertRows(ctx.db, 'order_items', items, 'id');
  await flagRemovedLines(ctx, kept);

  const conflicts = kept.filter(({ m }) => m.statusResult === 'conflict');
  for (const { m } of conflicts) {
    await log(ctx, { entity: 'order', entity_id: String(m.order.id), action: 'status', result: 'conflict', detail: { woo_status: m.order.woo_status, status: m.order.status } });
  }
  return { written: kept.map(({ m }) => m.order.id), skipped: parents.length - kept.length, conflicts: conflicts.length };
}

// ---------------------------------------------------------------- sub-orders

async function fetchParent(ctx, id) {
  let order;
  try {
    order = (await ctx.woo.get(`wc/v3/orders/${id}`)).data;
  } catch (e) {
    if (e?.status === 404) return false;
    throw e;
  }
  return isObj(order) && (await writeOrders(ctx, [order])).written.includes(id);
}

/**
 * Dokan sub-orders → sub_orders (upsert on woo_order_id) + order_items.sub_order_id for the parent's lines of that
 * maker. Operational statuses are never touched. → { written: [woo_order_ids], skipped: n }.
 */
export async function writeSubOrders(ctx, wooSubs) {
  const subs = lastById(wooSubs.filter((o) => isObj(o) && isSubOrder(o) && wooId(o.parent_id) !== null));
  if (!subs.length) return { written: [], skipped: 0 };
  const parentIds = [...new Set(subs.map((o) => wooId(o.parent_id)))];
  const present = new Set((await selectIn(ctx.db, 'orders', 'id', 'id', parentIds)).map((r) => Number(r.id)));
  for (const id of parentIds.filter((id) => !present.has(id))) if (await fetchParent(ctx, id)) present.add(id);

  const ready = subs.filter((o) => present.has(wooId(o.parent_id)));
  for (const o of subs.filter((o) => !present.has(wooId(o.parent_id)))) {
    await log(ctx, { entity: 'sub_order', entity_id: String(wooId(o.id) ?? ''), action: 'link', result: 'skipped', detail: { reason: 'parent_missing', parent_id: wooId(o.parent_id) } });
  }
  const mapped = await mapWithVendors(ctx, ready, (o) => mapSubOrder(o, { vendorsByWooId: ctx.vendors }));
  const rows = mapped.filter((m) => !m.skipped).map((m) => pick(m.sub, SUB_COLUMNS));
  const saved = await upsertRows(ctx.db, 'sub_orders', rows, 'woo_order_id', 'id, order_id, vendor_id');
  for (const s of saved.filter((s) => s.vendor_id)) {
    const { error } = await ctx.db.from('order_items').update({ sub_order_id: s.id }).eq('order_id', s.order_id).eq('vendor_id', s.vendor_id);
    if (error) throw new DbError('order_items', error);
  }
  return { written: rows.map((r) => r.woo_order_id), skipped: subs.length - rows.length };
}

/** A sync page: parents first, then sub-orders. → { orders, sub_orders, skipped, conflicts }. */
export async function writeOrderPage(ctx, page) {
  const list = page.filter(isObj);
  const parents = await writeOrders(ctx, list.filter((o) => !isSubOrder(o)));
  const subs = await writeSubOrders(ctx, list.filter(isSubOrder));
  return { orders: parents.written.length, sub_orders: subs.written.length, skipped: parents.skipped + subs.skipped, conflicts: parents.conflicts };
}

// ---------------------------------------------------------------- products

/** A wc/v3/products item → { product (products row), unknownVendorIds } or { skipped: 'invalid' } (no id / name). */
export function mapProduct(p, vendorsByWooId) {
  const id = wooId(p?.id);
  if (id === null || typeof p.name !== 'string') return { skipped: 'invalid', product: null, unknownVendorIds: [] };
  const maker = wooId(isObj(p.store) ? p.store.id : null); // Dokan adds `store` to the WC product response
  const uuid = maker === null ? null : vendorsByWooId.get(maker) ?? null;
  const image = Array.isArray(p.images) && isObj(p.images[0]) ? orNull(p.images[0].src) : null;
  const raw = { ...pickScalars(p, PRODUCT_RAW),
    ...(Array.isArray(p.categories) ? { categories: p.categories.filter(isObj).map((c) => pickScalars(c, ['id', 'name', 'slug'])) } : {}),
    ...(isObj(p.store) ? { store: pickScalars(p.store, ['id', 'shop_name']) } : {}) };
  return {
    product: { id, sku: orNull(p.sku), name: p.name.trim() || `#${id}`, image_url: image, vendor_id: uuid, price: num(p.price), status: orNull(p.status), raw: redactPII(raw) },
    unknownVendorIds: maker !== null && uuid === null ? [maker] : [],
  };
}

/** Products → products (upsert on id). → { written: [ids], skipped: n }. */
export async function writeProducts(ctx, wooProducts) {
  const list = lastById(wooProducts.filter(isObj));
  const mapped = await mapWithVendors(ctx, list, (p) => mapProduct(p, ctx.vendors));
  const rows = mapped.filter((m) => !m.skipped).map((m) => m.product);
  await upsertRows(ctx.db, 'products', rows, 'id');
  return { written: rows.map((r) => r.id), skipped: list.length - rows.length };
}
