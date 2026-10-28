// woo-write: the WooCommerce → Postgres write path shared by woo-webhook and woo-sync (service_role client: the
// functions read and write the tables directly, never orders_v).
// * Makers first: an unknown _dokan_vendor_id is looked up in vendors, then fetched from dokan/v1/stores/{id} and
//   upserted on woo_vendor_id. A new store is inserted with the full mapStore row (joined_at from `registered`, the
//   phase-3.3 columns, its first snapshot; never aliases / commission_pct / the other team columns) and the site's
//   commission becomes its first vendor_rates / vendor_category_rates rows (set_by «الموقع»). A store already in the
//   table gets the snapshot comparison of phase 3.3 (decision 3 / 4 a — see "store sync" below) by one UPDATE on
//   woo_vendor_id — never an upsert: Postgres checks the not-null columns of the proposed row before `on conflict`, so
//   a partial upsert fails with 23502 on `name` (seen live, 26 Oct). A store Dokan does not know (404) → woo_sync_log
//   'skipped'; any other failure (401/403/5xx/timeout/network) → woo_sync_log 'error'. Either way the id is asked once
//   per run / delivery (missingVendors / failedVendors) and again on the next one; the rows are still written, with
//   vendor_id null, and the rest of the delivery / page goes on. Only then are rows mapped for good.
// * Store sync (phase 3.3): for an existing store the synced fields (SYNC_FIELDS of woo-core) are compared field by
//   field with vendors.woo_snapshot — the site's values at the last run or push (diffStore). 'site' / 'both' → the
//   site's value is written here ('both' = the site wins, with a woo_sync_log 'conflict' row and an activity_log
//   vendor.sync.conflict row); 'system' → pushed to the site in the same run when the field is in push_pending (the
//   adapter's own push failed or was disabled) and WOO_PUSH_ENABLED is 1 — one PUT per store with those fields only,
//   cleared from push_pending on success; a 'system' field that is not pending (the team's value from before the
//   snapshot existed, or a first-run conflict) is left alone on both sides. No snapshot yet (the first run after the
//   deploy): every empty field of ours takes the site's value, a filled and equal one stays, a filled and different one
//   stays and is logged as a conflict, and nothing is pushed. A site name that is a `#id` placeholder (no name on the
//   site) never overwrites ours. Every site-side change writes one activity_log row vendor.sync (entity vendor,
//   entity_id the maker's uuid, new_value = the field names joined by ', ' — never a value; actor null: the server).
//   raw / logo_url / banner_url / woo_payment_methods / woo_snapshot / woo_synced_at are refreshed on every run; status
//   follows `enabled` (false → inactive; true → active unless the row is `leave`). The commission (decision 2): the
//   site's effective percentage + flat fee (commissionOf) as the field `rate`, its category items as `category_rates`;
//   a site-side change → a new vendor_rates row (since = today, set_by «الموقع», upserted on (vendor_id, since): a
//   second change on the same day replaces that day's row) and vendor_category_rates rows the same way (a category the
//   site dropped → a row with rate null); vendors.commission_pct is set with it (the 0011 trigger refreshes the copy on
//   insert only). The activity / sync log rows carry field names only.
// * The bank (phase 3.5): the site's payment.bank is the field `bank` — compared by its digest (bankDigest: the snapshot
//   keeps the digest only), written to vendor_bank (the eight Dokan fields; method / wallet are ours) when the site changed
//   it, pushed as payment.bank when ours is pending. A new store with a bank on the site gets its vendor_bank row.
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
// * The site's governorates (woo-sync part `states`): upserted on code into woo_states, never deleted. The site's
//   product categories (part `categories`, phase 3.3): upserted on id into woo_categories, never deleted.
import { BANK_KEYS, SYNC_FIELDS, addressText, bankDigest, canonicalCategories, categoryTree, commissionType, diffStore, explicitCategories, isSubOrder, mapOrder, mapStore, mapSubOrder, redactPII, sameField, storeSnapshot, toDokanStore } from './woo-core.js';
import { DbError, logSync, selectIn, upsertRows } from './db.js';
import { WooError, errorText } from './woo-api.js';

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
// A new store: the full mapStore row (+ its first snapshot), upserted. An existing store: the store sync (see the
// header), as an UPDATE by woo_vendor_id — never an upsert (23502 on `name`, seen live, 26 Oct).
const VENDOR_COLUMNS = ['woo_vendor_id', 'name', 'phone', 'email', 'status', 'joined_at', 'contact_name', 'address_parts', 'address', 'social',
  'logo_url', 'banner_url', 'woo_payment_methods', 'raw', 'woo_snapshot', 'woo_synced_at'];
// The columns the store sync reads of an existing store (also push_vendor's read: the PUT body comes from these).
export const VENDOR_SYNC_COLUMNS = 'id, woo_vendor_id, name, phone, email, contact_name, address_parts, social, status, woo_snapshot, push_pending';
// Read-only mirrors of the site on an existing store: refreshed on every run (decision 1).
const MIRROR_COLUMNS = ['raw', 'logo_url', 'banner_url', 'woo_payment_methods'];
const RATE_FIELDS = ['rate', 'category_rates'];
export const SET_BY_SITE = 'الموقع';
// Dokan's payment.bank key → vendor_bank column (phase 3.5, decision 1); method / wallet are ours, never synced
export const BANK_COLUMNS = { ac_name: 'holder', ac_number: 'account_number', ac_type: 'account_type', bank_name: 'bank_name', bank_addr: 'bank_address', routing_number: 'routing_number', iban: 'iban', swift: 'swift' };
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

/**
 * Per-invocation state: status_map (read once), makers resolved so far, the Woo client, the log kind, the clock, and
 * pushEnabled — the WOO_PUSH_ENABLED gate as the caller read it (woo-sync: the secret is exactly 1; woo-webhook never
 * pushes): without it the store sync writes nothing to the site and pending fields stay pending.
 */
export async function writeContext({ db, woo, kind, now, pushEnabled = false }) {
  const { data, error } = await db.from('status_map').select('system_status, woo_status, direction, sort');
  if (error) throw new DbError('status_map', error);
  return { db, woo, kind, now, pushEnabled: pushEnabled === true, statusMap: data ?? [], vendors: new Map(), missingVendors: new Set(), failedVendors: new Set(),
    // the store sync's counters of this run (pullVendors reports them): makers changed from the site, conflicts, pushes
    vendorSync: { from_site: 0, conflicts: 0, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0 } };
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
 * mapStore rows → vendors, their ids remembered in ctx.vendors. A new store is upserted on woo_vendor_id with the full
 * row and its first snapshot, and the site's commission becomes its first rate rows; a store already in the table goes
 * through the store sync (syncVendor). → number written.
 */
export async function saveVendors(ctx, rows) {
  const valid = rows.filter((r) => wooId(r.woo_vendor_id) !== null);
  const ids = [...new Set(valid.map((r) => wooId(r.woo_vendor_id)))];
  const stored = new Map((await selectIn(ctx.db, 'vendors', VENDOR_SYNC_COLUMNS, 'woo_vendor_id', ids)).map((v) => [Number(v.woo_vendor_id), v]));
  for (const v of stored.values()) ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  const now = ctx.now();
  for (const r of valid) r.bank_digest = await bankDigest(r.bank); // phase 3.5: the snapshot keeps the digest only
  const fresh = valid.filter((r) => !stored.has(wooId(r.woo_vendor_id)));
  const added = await save(ctx, 'vendors', fresh.map((r) => pick({ ...r, woo_snapshot: storeSnapshot(r), woo_synced_at: now }, VENDOR_COLUMNS)), 'woo_vendor_id', 'id, woo_vendor_id');
  for (const v of added.rows) ctx.vendors.set(Number(v.woo_vendor_id), v.id);
  for (const r of fresh) {
    const uuid = ctx.vendors.get(wooId(r.woo_vendor_id));
    if (uuid && !added.bad.has(String(wooId(r.woo_vendor_id)))) {
      await writeSiteRates(ctx, uuid, storeSnapshot(r), null, now);
      if (r.bank_digest) await writeSiteBank(ctx, uuid, r.bank, now);
    }
  }
  const existing = valid.filter((r) => stored.has(wooId(r.woo_vendor_id)));
  const uuids = existing.map((r) => stored.get(wooId(r.woo_vendor_id)).id);
  const rates = await effectiveRates(ctx, uuids, now);
  const banks = await loadBanks(ctx, uuids);
  const bad = new Set();
  for (const r of existing) {
    const row = stored.get(wooId(r.woo_vendor_id));
    if (!(await syncVendor(ctx, r, row, rates.get(row.id), now, banks.get(row.id) ?? null))) bad.add(String(wooId(r.woo_vendor_id)));
  }
  return valid.length - added.bad.size - bad.size;
}

// ---------------------------------------------------------------- store sync (phase 3.3)

// The team's "today" is Cairo's calendar date (a rate dated today applies from Cairo midnight, not UTC's — review I-2).
const CAIRO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const cairoDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : CAIRO.format(d); };
const dateOf = cairoDate;
/**
 * Whether a failed PUT is worth retrying by the next sync run (review I-3): a network / timeout failure (not a WooError),
 * any 5xx, and the four 4xx that say "not now" (401 / 403 — the application password, 408, 429). Every other 4xx (400,
 * 404, 422, …) is the site's final answer to these values: the fields leave push_pending with one `refused` row.
 */
export const retryablePush = (e) => !(e instanceof WooError) || !(e.status >= 400 && e.status < 500) || [401, 403, 408, 429].includes(e.status);
const union = (a, b) => [...new Set([...a, ...b])];
const asPending = (v) => (Array.isArray(v) ? v.filter((f) => SYNC_FIELDS.includes(f)) : []);
const pendingOrNull = (list) => (list.length ? list : null);

/** One activity_log row written by the server (actor null): the field names only, never a value. Never throws. */
export async function logActivity(ctx, action, vendorUuid, fields) {
  try {
    const { error } = await ctx.db.from('activity_log').insert({ action, entity: 'vendor', entity_id: vendorUuid, old_value: null, new_value: fields.join(', ') });
    if (error) console.error(`activity_log insert failed (${error.code ?? 'error'})`);
  } catch {
    console.error('activity_log insert failed');
  }
}

// One UPDATE of a vendors row by woo_vendor_id. A row refused with a data error (SQLSTATE 22xxx / 23xxx) gets one
// woo_sync_log error row and false; any other error throws.
async function updateVendor(ctx, wooVendorId, patch) {
  const { error } = await ctx.db.from('vendors').update(patch).eq('woo_vendor_id', wooVendorId);
  if (!error) return true;
  if (!/^2[23]/.test(String(error.code ?? ''))) throw new DbError('vendors', error);
  await log(ctx, { entity: 'vendors', entity_id: String(wooVendorId), action: 'update', result: 'error', detail: { error: errorText(new DbError('vendors', error), ctx.woo.scrub) } });
  return false;
}

/**
 * The rate effective today of each maker (vendor_rates: the latest `since` not after today) and their effective
 * category rates (vendor_category_rates, one per category, the removed ones — rate null — left out).
 * → Map uuid → { rate: { rate, flat }, category_rates: [{ woo_category_id, rate, flat }] }.
 */
export async function effectiveRates(ctx, vendorIds, now) {
  const today = dateOf(now);
  const out = new Map(vendorIds.map((id) => [id, { rate: { type: 'fixed', rate: null, flat: null }, category_rates: [], future: { rate: false, category_rates: false } }]));
  if (!vendorIds.length) return out;
  // `future.<field>` = a row dated after today exists (review I-2): the field's push waits for that day instead of
  // sending the current figure as if it were the new one.
  const latest = (rows, keyOf, field) => {
    const m = new Map();
    for (const r of rows) if (String(r.since) > today && out.has(r.vendor_id)) out.get(r.vendor_id).future[field] = true;
    for (const r of rows.filter((x) => String(x.since) <= today).sort((x, y) => String(x.since).localeCompare(String(y.since)) || Number(x.id) - Number(y.id))) m.set(keyOf(r), r);
    return [...m.values()];
  };
  for (const r of latest(await selectIn(ctx.db, 'vendor_rates', 'id, vendor_id, rate, flat, since, commission_type', 'vendor_id', vendorIds), (r) => r.vendor_id, 'rate')) {
    out.get(r.vendor_id).rate = { type: commissionType(r.commission_type), rate: num(r.rate), flat: num(r.flat) };
  }
  for (const r of latest(await selectIn(ctx.db, 'vendor_category_rates', 'id, vendor_id, woo_category_id, rate, flat, since', 'vendor_id', vendorIds), (r) => `${r.vendor_id}|${r.woo_category_id}`, 'category_rates')) {
    if (num(r.rate) !== null) out.get(r.vendor_id).category_rates.push({ woo_category_id: Number(r.woo_category_id), rate: num(r.rate), flat: num(r.flat) });
  }
  return out;
}

/** The synced fields of a vendors row as the system has them (the counterpart of storeSnapshot for diffStore). */
export const systemSnapshot = (row, rates, bankKey = '') => ({
  name: row.name ?? null, phone: row.phone ?? null, email: row.email ?? null, contact_name: row.contact_name ?? null,
  address_parts: row.address_parts ?? null, social: row.social ?? null, status: row.status ?? 'active',
  rate: rates?.rate ?? { type: 'fixed', rate: null, flat: null }, category_rates: rates?.category_rates ?? [],
  bank: bankKey ?? '', // phase 3.5: the digest of our vendor_bank row ('' = none)
});

/** Our vendor_bank rows as Dokan's payment.bank objects (BANK_KEYS; null → ''). → Map uuid → bank. */
export async function loadBanks(ctx, vendorIds) {
  const out = new Map();
  if (!vendorIds.length) return out;
  const cols = ['vendor_id', ...Object.values(BANK_COLUMNS)].join(', ');
  for (const r of await selectIn(ctx.db, 'vendor_bank', cols, 'vendor_id', vendorIds)) {
    out.set(r.vendor_id, Object.fromEntries(BANK_KEYS.map((k) => [k, str(r[BANK_COLUMNS[k]])])));
  }
  return out;
}

// The site's payment.bank → the maker's vendor_bank row (upserted on vendor_id: the eight synced columns only, so method /
// wallet stay; a new row takes method 'bank'), updated_by «الموقع». A refused row → one woo_sync_log error row (no value).
async function writeSiteBank(ctx, vendorUuid, bank, now) {
  const row = { vendor_id: vendorUuid, updated_by: SET_BY_SITE, updated_at: now };
  for (const k of BANK_KEYS) row[BANK_COLUMNS[k]] = orNull(isObj(bank) ? bank[k] : null);
  const { bad } = await save(ctx, 'vendor_bank', [row], 'vendor_id');
  return !bad.size;
}

/** The site's category tree (woo_categories: id → parent id), read once per run (plan 3.4). Never throws: [] on error. */
export async function loadTree(ctx) {
  if (ctx.tree) return ctx.tree;
  try {
    const { data, error } = await ctx.db.from('woo_categories').select('id, parent_id').range(0, 9999);
    ctx.tree = categoryTree(error ? [] : data ?? []);
  } catch {
    ctx.tree = new Map();
  }
  return ctx.tree;
}
// A snapshot with its category commission read for its meaning on the tree (plan 3.4, decision 4), for diffStore and
// the acceptance check; null stays null.
const canon = (snap, tree) => (isObj(snap) ? { ...snap, category_rates: canonicalCategories(snap.rate, snap.category_rates, tree) } : snap);

// The site's commission (a snapshot's `rate` / `category_rates`) → vendor_rates / vendor_category_rates rows dated
// today, set_by «الموقع», for what differs from ours (`ours` = effectiveRates entry, null for a new store). Upserted on
// the unique keys. → { commission_pct } when a rate row was written (the caller patches the copy), else {}.
async function writeSiteRates(ctx, vendorUuid, site, ours, now, which = RATE_FIELDS) {
  const since = dateOf(now);
  const patch = {};
  if (which.includes('rate') && site.rate?.rate !== null && site.rate?.rate !== undefined && !(ours && sameField('rate', site.rate, ours.rate))) {
    const { bad } = await save(ctx, 'vendor_rates', [{ vendor_id: vendorUuid, rate: site.rate.rate, flat: site.rate.flat ?? null, since, set_by: SET_BY_SITE, commission_type: commissionType(site.rate.type) }], 'vendor_id,since');
    if (!bad.size) patch.commission_pct = site.rate.rate;
  }
  // the hand-set figures read back from the site's items (plan 3.4, decision 4); a site on `fixed` leaves ours alone
  if (which.includes('category_rates') && commissionType(site.rate?.type) === 'category_based') {
    const mine = new Map((ours?.category_rates ?? []).map((c) => [c.woo_category_id, c]));
    const theirs = explicitCategories(site.rate, site.category_rates ?? [], await loadTree(ctx));
    const rows = theirs.filter((c) => !mine.has(c.woo_category_id) || !sameField('category_rates', [c], [mine.get(c.woo_category_id)]))
      .map((c) => ({ vendor_id: vendorUuid, woo_category_id: c.woo_category_id, rate: c.rate, flat: c.flat ?? null, since, set_by: SET_BY_SITE }));
    for (const c of mine.values()) {
      if (!theirs.some((t) => t.woo_category_id === c.woo_category_id)) rows.push({ vendor_id: vendorUuid, woo_category_id: c.woo_category_id, rate: null, flat: null, since, set_by: SET_BY_SITE });
    }
    if (rows.length) await save(ctx, 'vendor_category_rates', rows, 'vendor_id,woo_category_id,since');
  }
  return patch;
}

/**
 * PUT dokan/v1/stores/{woo_vendor_id} with the given fields of a vendors row (toDokanStore: a placeholder name is
 * dropped; rates = the effectiveRates entry). → { sent, dropped, accepted, refused, answer }: answer =
 * storeSnapshot(mapStore(Dokan's reply)) when the reply is the store (else null and every sent field counts as
 * accepted); accepted = the sent fields the site now shows as ours, refused = the sent fields the site kept as they
 * were (Dokan answers 200 and ignores a field it does not take — the acceptance check of decision 4 e). The e-mail is
 * checked against the reply's own `email`. Nothing is sent when every
 * field was dropped. Throws a WooError on a non-2xx answer (the caller logs it and marks the fields pending).
 */
export async function pushStoreFields(ctx, row, fields, rates, bank = null) {
  // a rate field whose newest row is still future-dated is held (review I-2): it stays pending until that day's run
  const held = (Array.isArray(fields) ? fields : []).filter((f) => RATE_FIELDS.includes(f) && rates?.future?.[f]);
  const tree = await loadTree(ctx);
  const { body, sent, dropped } = toDokanStore(row, (Array.isArray(fields) ? fields : []).filter((f) => !held.includes(f)), { type: rates?.rate?.type ?? 'fixed', rate: rates?.rate?.rate ?? null, flat: rates?.rate?.flat ?? null, categoryRates: rates?.category_rates ?? [], tree }, bank);
  const oursBank = await bankDigest(bank);
  if (!body) return { sent, dropped, held, accepted: [], refused: [], answer: null, oursBank };
  const id = wooId(row.woo_vendor_id);
  const { data } = await ctx.woo.put(`dokan/v1/stores/${id}`, body);
  let answer = null;
  if (isObj(data) && wooId(data.id) === id) { const mapped = mapStore(data); mapped.bank_digest = await bankDigest(mapped.bank); answer = storeSnapshot(mapped); }
  const shown = answer === null ? null : canon({ ...answer, email: typeof data.email === 'string' ? orNull(data.email) : answer.email }, tree);
  const ours = canon(systemSnapshot(row, rates, oursBank), tree);
  const accepted = sent.filter((f) => shown === null || sameField(f, shown[f], ours[f]));
  return { sent, dropped, held, accepted, refused: sent.filter((f) => !accepted.includes(f)), answer, oursBank };
}

/**
 * After pushStoreFields: the snapshot takes the site's answer for the sent fields (ours when the reply was not the
 * store), woo_synced_at = now, push_pending loses the sent and the dropped fields. A row without a snapshot keeps
 * none: the first pull after the deploy builds it (the first-run rule). → true when the row was written.
 */
export async function applyPushResult(ctx, row, result, now) {
  const base = isObj(row.woo_snapshot) ? row.woo_snapshot : null;
  const ours = systemSnapshot(row, null);
  const patch = { woo_synced_at: now, push_pending: pendingOrNull(union(asPending(row.push_pending), result.held ?? []).filter((f) => !result.sent.includes(f) && !result.dropped.includes(f))) };
  if (base !== null) {
    const snap = { ...base };
    for (const f of result.sent) snap[f] = result.answer === null ? (f === 'bank' ? result.oursBank ?? base[f] ?? '' : RATE_FIELDS.includes(f) ? base[f] ?? null : ours[f]) : result.answer[f];
    patch.woo_snapshot = snap;
  }
  return updateVendor(ctx, wooId(row.woo_vendor_id), patch);
}

/** push_pending ∪ fields on the row (a failed or disabled push: the next sync run sends them). → true when written. */
export async function markPushPending(ctx, row, fields) {
  return updateVendor(ctx, wooId(row.woo_vendor_id), { push_pending: pendingOrNull(union(asPending(row.push_pending), fields.filter((f) => SYNC_FIELDS.includes(f)))) });
}

// A mapStore row of an existing store + its vendors row (VENDOR_SYNC_COLUMNS) + the maker's effective rates → the
// comparison of the header, one UPDATE, the rate rows, the pending push, the logs. → false when the row was refused.
async function syncVendor(ctx, site, row, rates, now, bank = null) {
  const id = wooId(site.woo_vendor_id);
  const siteSnap = storeSnapshot(site);
  const ours = systemSnapshot(row, rates, await bankDigest(bank));
  const snap = isObj(row.woo_snapshot) ? row.woo_snapshot : null;
  const tree = await loadTree(ctx);
  const diff = diffStore(canon(snap, tree), canon(siteSnap, tree), canon(ours, tree));
  // A site without a commission figure (the public shape, or no rate set there) says nothing about the rate: ours
  // stays and no change / conflict is recorded for the two rate fields. A `#id` placeholder name never overwrites ours.
  const ignored = (f) => (RATE_FIELDS.includes(f) && siteSnap.rate.rate === null) || (f === 'name' && String(siteSnap.name ?? '').startsWith('#'));
  const pending = asPending(row.push_pending);
  const fromSite = SYNC_FIELDS.filter((f) => ['site', 'both', 'fill'].includes(diff[f]) && !ignored(f));
  const conflicts = SYNC_FIELDS.filter((f) => ['both', 'conflict'].includes(diff[f]) && !ignored(f));
  const future = (f) => RATE_FIELDS.includes(f) && rates?.future?.[f] === true; // review I-2: waits for its day
  const toPush = snap === null ? [] : pending.filter((f) => diff[f] === 'system' && !future(f));
  if (pending.some(future)) ctx.vendorSync.push_held += 1;
  const patch = { ...pick(site, MIRROR_COLUMNS), woo_synced_at: now };
  const newSnap = { ...siteSnap };

  for (const f of fromSite) {
    if (f === 'address_parts') { patch.address_parts = siteSnap.address_parts; patch.address = addressText(siteSnap.address_parts); }
    else if (f === 'status') patch.status = siteSnap.status === 'inactive' ? 'inactive' : row.status === 'leave' ? 'leave' : 'active';
    else if (f !== 'bank' && !RATE_FIELDS.includes(f)) patch[f] = siteSnap[f];
  }
  if (fromSite.includes('bank')) await writeSiteBank(ctx, row.id, site.bank, now); // phase 3.5: vendor_bank, not a vendors column
  const siteRates = fromSite.filter((f) => RATE_FIELDS.includes(f));
  if (siteRates.length) Object.assign(patch, await writeSiteRates(ctx, row.id, siteSnap, ours, now, siteRates));

  let settled = [];
  if (toPush.length && ctx.pushEnabled) {
    try {
      const r = await pushStoreFields(ctx, row, toPush, rates, bank);
      settled = [...r.sent, ...r.dropped];
      for (const f of r.sent) newSnap[f] = r.answer === null ? (RATE_FIELDS.includes(f) ? siteSnap[f] : ours[f]) : r.answer[f];
      if (r.sent.length) {
        ctx.vendorSync.pushed += 1;
        await logSync(ctx.db, { kind: 'push', direction: 'out', entity: 'vendor', entity_id: String(id), action: 'vendor', result: 'ok', detail: { vendor_id: row.id, fields: r.sent, accepted: r.accepted, refused: r.refused, dropped: r.dropped } });
      }
    } catch (e) {
      if (!(e instanceof WooError)) throw e;
      if (retryablePush(e)) {
        ctx.vendorSync.push_failed += 1;
        await logSync(ctx.db, { kind: 'push', direction: 'out', entity: 'vendor', entity_id: String(id), action: 'vendor', result: 'error', detail: { vendor_id: row.id, fields: toPush, error: errorText(e, ctx.woo.scrub) } });
      } else {
        // the site's final answer to these values (review I-3): the fields leave push_pending — one skipped/refused row
        // (woo_sync_log.result has no 'refused' value; the reason sits in detail), one activity row (the field names
        // only) — instead of an error row every quarter hour for ever
        ctx.vendorSync.push_refused += 1;
        settled = [...settled, ...toPush];
        await logSync(ctx.db, { kind: 'push', direction: 'out', entity: 'vendor', entity_id: String(id), action: 'vendor', result: 'skipped', detail: { vendor_id: row.id, fields: toPush, reason: 'refused', error: errorText(e, ctx.woo.scrub) } });
        await logActivity(ctx, 'vendor.sync.refused', row.id, toPush);
      }
    }
  }
  patch.woo_snapshot = newSnap;
  patch.push_pending = pendingOrNull(pending.filter((f) => !settled.includes(f) && (future(f) || !['same', 'site', 'both', 'keep', 'fill'].includes(diff[f]))));

  if (!(await updateVendor(ctx, id, patch))) return false;
  if (fromSite.length) {
    ctx.vendorSync.from_site += 1;
    await logActivity(ctx, 'vendor.sync', row.id, fromSite);
  }
  if (conflicts.length) {
    ctx.vendorSync.conflicts += 1;
    await log(ctx, { entity: 'vendor', entity_id: String(id), action: 'sync', result: 'conflict', detail: { vendor_id: row.id, fields: conflicts, first_run: snap === null } });
    await logActivity(ctx, 'vendor.sync.conflict', row.id, conflicts);
  }
  return true;
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
  const status = orNull(p.status);
  const modified = gmtIso(p.date_modified_gmt);
  return {
    product: { id, sku: orNull(p.sku), name: p.name.trim() || `#${id}`, image_url: image, permalink: link.startsWith('https://') ? link : null,
      vendor_id: uuid, price: num(p.price), status, raw: redactPII(raw), ...productColumns(p), woo_modified_at: modified,
      trashed_at: status === 'trash' ? modified : null },
    unknownVendorIds: maker !== null && uuid === null ? [maker] : [],
  };
}

/** Dokan's per-product admin commission meta → { rate, type, fee } (null when not set on the product). */
export function productCommission(p) {
  const meta = new Map((isObj(p) && Array.isArray(p.meta_data) ? p.meta_data : []).filter(isObj).map((m) => [m.key, m.value]));
  const rate = num(meta.get('_per_product_admin_commission'));
  const type = str(meta.get('_per_product_admin_commission_type'));
  return { rate, type: rate === null ? null : (/^[a-z_]{1,20}$/.test(type) ? type : 'percentage'), fee: rate === null ? null : num(meta.get('_per_product_admin_additional_fee')) };
}

// The phase 5 mirror columns (0021, plan decision 4): WPML language + translation ids, prices, stock, sales, categories,
// brands, the number of images, weight and flags. Absent / malformed values are null (the edit page reads the images live).
const intOrNull = (v) => { const n = num(v); return n === null ? null : Math.trunc(n); };
const boolOrNull = (v) => (typeof v === 'boolean' ? v : null);
const idsOf = (list) => (Array.isArray(list) ? [...new Set(list.filter(isObj).map((x) => wooId(x.id)).filter((x) => x !== null))] : null);
function productColumns(p) {
  const tr = isObj(p.translations)
    ? Object.fromEntries(Object.entries(p.translations).filter(([k]) => /^[a-z]{2}$/.test(k)).map(([k, v]) => [k, wooId(v)]).filter(([, v]) => v !== null))
    : null;
  return {
    lang: /^[a-z]{2}$/.test(str(p.lang)) ? str(p.lang) : null, translation_ids: tr && Object.keys(tr).length ? tr : null,
    type: orNull(p.type), regular_price: num(p.regular_price), sale_price: num(p.sale_price), stock_quantity: intOrNull(p.stock_quantity),
    stock_status: orNull(p.stock_status), manage_stock: boolOrNull(p.manage_stock), backorders: orNull(p.backorders),
    low_stock_amount: intOrNull(p.low_stock_amount), total_sales: intOrNull(p.total_sales), category_ids: idsOf(p.categories),
    brand_ids: idsOf(p.brands), image_count: Array.isArray(p.images) ? p.images.filter(isObj).length : null, weight: orNull(p.weight), featured: boolOrNull(p.featured),
    desc_filled: typeof p.description === 'string' ? p.description.trim() !== '' : null,
    short_desc_filled: typeof p.short_description === 'string' ? p.short_description.trim() !== '' : null,
  };
}

/** Products → products (upsert on id). → { written: [ids], skipped: n, failed: n (refused rows) }. */
export async function writeProducts(ctx, wooProducts) {
  const list = lastById(wooProducts.filter(isObj));
  const mapped = await mapWithVendors(ctx, list, (p) => mapProduct(p, ctx.vendors));
  const rows = mapped.filter((m) => !m.skipped).map((m) => m.product);
  const { bad } = await save(ctx, 'products', rows, 'id');
  const written = rows.map((r) => r.id).filter((id) => !bad.has(String(id)));
  // phase 5 (decision 12): the product's own Dokan commission, one row per written product (rate null = none)
  const byId = new Map(list.map((p) => [wooId(p.id), p]));
  if (written.length) await save(ctx, 'product_commissions', written.map((id) => ({ product_id: id, ...productCommission(byId.get(id)), updated_at: ctx.now() })), 'product_id');
  return { written, skipped: list.length - rows.length, failed: bad.size };
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

// ---------------------------------------------------------------- product categories (phase 3.3)

/**
 * The site's product categories (wc/v3/products/categories items { id, name, slug, parent }) → woo_categories,
 * upserted on id with updated_at = ctx.now(): the names behind vendor_category_rates.woo_category_id. An item without
 * a positive integer id or a non-empty string name is skipped; parent 0 / absent → parent_id null. Nothing is deleted
 * (a rate may still point at a category the site dropped).
 * → { written: [ids], skipped: n (malformed items), failed: n (refused rows) }.
 */
export const writeCategories = (ctx, categories) => writeTerms(ctx, 'woo_categories', categories);
/** The site's WooCommerce Brands (wc/v3/products/brands, phase 5 decision 6) → woo_brands, the same rules as the categories. */
export const writeBrands = (ctx, brands) => writeTerms(ctx, 'woo_brands', brands);
async function writeTerms(ctx, table, categories) {
  const list = Array.isArray(categories) ? categories : [];
  const valid = list.filter((c) => isObj(c) && wooId(c.id) !== null && typeof c.name === 'string' && c.name.trim() !== '');
  const now = ctx.now();
  const rows = lastById(valid).map((c) => ({ id: wooId(c.id), name: c.name.trim(), slug: orNull(c.slug), parent_id: wooId(c.parent), updated_at: now }));
  const { bad } = await save(ctx, table, rows, 'id');
  return { written: rows.map((r) => r.id).filter((id) => !bad.has(String(id))), skipped: list.length - valid.length, failed: bad.size };
}
