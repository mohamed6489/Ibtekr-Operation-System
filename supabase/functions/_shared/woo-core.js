// woo-core: the pure WooCommerce / Dokan sync core shared by the woo-webhook and woo-sync Edge Functions.
// Contract: plain ESM with no imports, loaded unchanged by Deno (the Edge Functions) and Node (node:test). Standard
// JS and Web APIs only (crypto.subtle, TextEncoder, btoa); no I/O, no clock (the caller passes `now`),
// deterministic, inputs never mutated and never aliased by the output. Rows use the column names of 0007_orders.sql.
// `raw` is built from allow-lists, never by deleting known-bad keys, so nothing personal can reach it through a field
// nobody listed: the RAW_* fields below (scalars only), billing / shipping cut to city/state/postcode/country, order
// meta cut to META_KEEP, line_items as `{ id, _dokan_* meta }`, and fixed fields for shipping/coupon/fee/tax lines and
// refunds (no fee names, no refund reasons, no meta on those lines); order_items raw = RAW_ITEM + `_dokan_*` meta;
// vendors raw = RAW_STORE + rating. A kept meta value is stored as-is only when it is a scalar; an object / array
// value goes through redactPII first (a deep, redacted copy). redactPII is also exported for callers (logging).

export const START_DATE = '2026-10-01';
export const OPEN_WOO = ['processing', 'pending', 'on-hold'];
export const WOO_FALLBACK = { failed: 'ملغي' };
// Order meta kept in raw (a trailing * is a prefix); every other key is removed, not redacted — staging carries
// phones (bosta_customer_phone), Facebook ids and user agents in meta.
export const META_KEEP = [
  '_dokan_*', 'bosta_delivery_id', 'bosta_tracking_number', 'bosta_status', 'bosta_sync_status', 'wpml_language',
  '_wc_order_attribution_source_type', '_wc_order_attribution_utm_source', '_wc_order_attribution_utm_medium',
  '_wc_order_attribution_utm_campaign',
];

const REDACTED = '<redacted>';
// Same key rule as tools/woo-probe.mjs (Task 1): a personal field as a whole key or a suffix, with any qualifier.
const PII_KEY = /(^|_)(first_name|last_name|email|phone|company|note|address)(_\w+)?$/i;
// raw allow-lists (orders and sub-orders; order_items; vendors).
const RAW_SCALARS = ['id', 'number', 'status', 'currency', 'total', 'subtotal', 'total_tax', 'shipping_total', 'discount_total',
  'payment_method', 'payment_method_title', 'created_via', 'date_created_gmt', 'date_modified_gmt', 'date_paid_gmt',
  'date_completed_gmt', 'parent_id', 'customer_id', 'cart_hash'];
const RAW_ADDRESS = ['city', 'state', 'postcode', 'country'];
const RAW_LISTS = {
  shipping_lines: ['id', 'method_id', 'method_title', 'total'], coupon_lines: ['id', 'code', 'discount'],
  fee_lines: ['id', 'total'], tax_lines: ['id', 'rate_code', 'tax_total'], refunds: ['id', 'total'],
};
const RAW_ITEM = ['id', 'product_id', 'variation_id', 'name', 'sku', 'quantity', 'price', 'subtotal', 'subtotal_tax', 'total',
  'total_tax', 'tax_class', 'parent_name'];
const RAW_STORE = ['id', 'store_name', 'shop_url', 'enabled', 'registered', 'featured', 'trusted'];
const DRAFT = ['checkout-draft', 'trash'];
const COMMISSION = { rate: '_dokan_commission_rate', type: '_dokan_commission_type', admin_fee: '_dokan_admin_fee', additional_fee: '_dokan_additional_fee' };
const DEFAULT_STATUS = 'قيد الانتظار'; // only when the map is empty; otherwise its first row
const START_MS = Date.parse(`${START_DATE}T00:00:00Z`);
const CURSOR_OVERLAP_MS = 60 * 1000;
const enc = new TextEncoder();

// ---------------------------------------------------------------- small helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const objs = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const orNull = (v) => str(v) || null;
const num = (v) => (str(v) === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const wooId = (v) => { const n = num(v); return Number.isInteger(n) && n > 0 ? n : null; };
// Woo's *_gmt dates carry no zone: they are UTC.
const gmtIso = (v) => { const s = str(v); return !s ? null : /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`; };
const gmtMs = (v) => { const s = gmtIso(v); const ms = s ? Date.parse(s) : NaN; return Number.isFinite(ms) ? ms : null; };
const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const toIso = (now) => (now instanceof Date ? now.toISOString() : typeof now === 'number' ? new Date(now).toISOString() : orNull(now));

const metaValue = (meta, key) => objs(meta).find((e) => e.key === key)?.value;
const hasMeta = (meta, key) => objs(meta).some((e) => e.key === key);
const keeper = (list) => (key) => typeof key === 'string' && list.some((k) => (k.endsWith('*') ? key.startsWith(k.slice(0, -1)) : key === k));
const keepOrderMeta = keeper(META_KEEP);
const keepDokanMeta = keeper(['_dokan_*']);
// A kept meta entry: { id, key, value } with an object / array value redacted (redactPII returns a deep copy).
const cutMeta = (meta, keep) => objs(meta).filter((e) => keep(e.key)).map((e) => ({ id: e.id ?? null, key: e.key, value: isScalar(e.value ?? null) ? e.value ?? null : redactPII(e.value) }));
// Copies only the listed keys whose value is a scalar (an unexpected object under a listed key is not copied).
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => isObj(o) && isScalar(o[k])).map((k) => [k, o[k]]));
const isOn = (v) => v === true || v === 1 || v === '1' || v === 'yes' || v === 'true';

const personName = (p) => `${str(p.first_name)} ${str(p.last_name)}`.trim();
const addressOf = (p) => orNull(`${str(p.address_1)} ${str(p.address_2)}`);

// vendorsByWooId: { [wooVendorId]: uuid } or a Map keyed by number or string.
function vendorUuid(vendorsByWooId, id) {
  if (id === null || !vendorsByWooId || typeof vendorsByWooId !== 'object') return null;
  if (vendorsByWooId instanceof Map) return vendorsByWooId.get(id) ?? vendorsByWooId.get(String(id)) ?? null;
  return Object.hasOwn(vendorsByWooId, id) ? vendorsByWooId[id] ?? null : null;
}

// status_map rows in map order (the sort column when present, else as given).
const rowsOf = (statusMap) => objs(statusMap).sort((a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0));
const dirOf = (row) => row.direction || 'both';

// ---------------------------------------------------------------- privacy

/** Deep copy with every personal-data key's value replaced by "<redacted>" (input untouched). */
export function redactPII(value) {
  if (Array.isArray(value)) return value.map(redactPII);
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, PII_KEY.test(k) ? REDACTED : redactPII(v)]));
  return value;
}

// An order / sub-order payload as stored in raw (see the header).
function cleanRaw(o) {
  const raw = pick(o, RAW_SCALARS);
  for (const k of ['billing', 'shipping']) if (isObj(o[k])) raw[k] = pick(o[k], RAW_ADDRESS);
  if (Array.isArray(o.meta_data)) raw.meta_data = cutMeta(o.meta_data, keepOrderMeta);
  if (Array.isArray(o.line_items)) raw.line_items = objs(o.line_items).map((li) => ({ id: li.id ?? null, meta_data: cutMeta(li.meta_data, keepDokanMeta) }));
  for (const [k, keys] of Object.entries(RAW_LISTS)) if (Array.isArray(o[k])) raw[k] = objs(o[k]).map((e) => pick(e, keys));
  return raw;
}

const itemRaw = (line) => ({ ...pick(line, RAW_ITEM), meta_data: cutMeta(line.meta_data, keepDokanMeta) });

/**
 * Digits only (Arabic-Indic and Persian digits too). An explicit Egyptian prefix (+20, 0020, 00 20) is replaced by a
 * leading 0 whatever follows (mobiles and landlines); a bare 20 only on a 12-digit number (20 + a 10-digit mobile).
 */
export function normalizePhone(s) {
  const text = str(s)
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
  const prefixed = /^\(?\s*(?:\+|00)\s*20(.*)$/s.exec(text);
  if (prefixed) {
    const rest = prefixed[1].replace(/\D/g, '');
    return !rest ? null : rest.startsWith('0') ? rest : `0${rest}`;
  }
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  return /^20\d{10}$/.test(digits) ? `0${digits.slice(2)}` : digits;
}

// ---------------------------------------------------------------- webhook signature

const base64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

// Constant time for equal lengths (the length of a Base64 SHA-256 MAC is public).
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** X-WC-Webhook-Signature: Base64(HMAC-SHA256(raw body, secret)). false for any empty input; never throws. */
export async function verifySignature(rawBody, signatureHeader, secret) {
  try {
    const body = typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody instanceof Uint8Array ? rawBody : null;
    if (!body?.length || typeof signatureHeader !== 'string' || typeof secret !== 'string' || !secret) return false;
    const given = enc.encode(signatureHeader.trim());
    if (!given.length) return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
    return sameBytes(enc.encode(base64(mac)), given);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- status rules

/**
 * Woo status → system status. A current status whose row is from_system (e.g. «تم RTC», set by the team) is never
 * overwritten: 'unchanged'. Nor is a current status when Woo's slug is the one already stored (currentWooStatus, the
 * order's woo_status in the DB): Woo did not change its status, so a delivery about anything else (a note, an
 * address) keeps the team's status: 'unchanged'. Else the both / from_woo row of that slug (the current status if it
 * is one of them): 'ok'; a slug with only from_system rows: 'unchanged'; WOO_FALLBACK: 'ok'; unknown: the current
 * status (or the map's first) as 'conflict'.
 */
export function incomingStatus(wooStatus, currentSystemStatus, statusMap, currentWooStatus = null) {
  const rows = rowsOf(statusMap);
  const current = orNull(currentSystemStatus);
  const keep = current ?? rows[0]?.system_status ?? DEFAULT_STATUS;
  const currentRow = current && rows.find((r) => r.system_status === current);
  if (currentRow && dirOf(currentRow) === 'from_system') return { status: current, result: 'unchanged' };
  const slug = str(wooStatus);
  const storedSlug = str(currentWooStatus);
  if (current && storedSlug && slug === storedSlug) return { status: current, result: 'unchanged' };
  const matches = slug ? rows.filter((r) => r.woo_status === slug) : [];
  const usable = matches.filter((r) => ['both', 'from_woo'].includes(dirOf(r)));
  if (usable.length) return { status: (usable.find((r) => r.system_status === current) ?? usable[0]).system_status, result: 'ok' };
  if (matches.length) return { status: keep, result: 'unchanged' };
  if (Object.hasOwn(WOO_FALLBACK, slug)) return { status: WOO_FALLBACK[slug], result: 'ok' };
  return { status: keep, result: 'conflict' };
}

/** System status → the Woo slug to push, or null (= not pushed): a both / from_system row with a slug. */
export function outgoingWooStatus(systemStatus, statusMap) {
  const row = rowsOf(statusMap).find((r) => r.system_status === systemStatus);
  return row && row.woo_status && ['both', 'from_system'].includes(dirOf(row)) ? row.woo_status : null;
}

// ---------------------------------------------------------------- mapping

export const isSubOrder = (wooOrder) => (num(wooOrder?.parent_id) ?? 0) > 0;

/**
 * A Woo parent order → { order (orders row), items (order_items rows), unknownVendorIds, statusResult }, or
 * { skipped: 'invalid' | 'before_start' | 'draft', order: null, items: [] } (invalid = not an object, no numeric id or
 * no date_created_gmt). ctx (null = {}): statusMap, vendorsByWooId, now, currentStatus / currentWooStatus (the
 * order's status / woo_status in the DB). A line's vendor comes from its own _dokan_vendor_id, else the parent's (a
 * single-vendor parent carries it itself); a multi-vendor parent's line without one gets its maker from the sub-order
 * (woo-write links it by product id).
 */
export function mapOrder(wooOrder, ctx) {
  const { statusMap = [], vendorsByWooId = null, now = null, currentStatus = null, currentWooStatus = null } = ctx ?? {};
  const o = isObj(wooOrder) ? wooOrder : {};
  const created = gmtMs(o.date_created_gmt);
  const skipped = wooId(o.id) === null || created === null ? 'invalid'
    : created < START_MS ? 'before_start' : DRAFT.includes(o.status) ? 'draft' : null;
  if (skipped) return { skipped, order: null, items: [], unknownVendorIds: [], statusResult: null };

  const unknown = new Set();
  const vendorOf = (id) => {
    const uuid = vendorUuid(vendorsByWooId, id);
    if (id !== null && uuid === null) unknown.add(id);
    return uuid;
  };
  const parentVendor = wooId(metaValue(o.meta_data, '_dokan_vendor_id'));
  vendorOf(parentVendor);
  const items = objs(o.line_items).map((li) => ({
    id: num(li.id), order_id: num(o.id), product_id: num(li.product_id) || null, sku: orNull(li.sku), name: str(li.name),
    qty: num(li.quantity) ?? 1, total: num(li.total) ?? 0,
    vendor_id: vendorOf(wooId(metaValue(li.meta_data, '_dokan_vendor_id')) ?? parentVendor),
    raw: itemRaw(li),
  }));

  const b = isObj(o.billing) ? o.billing : {};
  const s = isObj(o.shipping) ? o.shipping : {};
  const status = incomingStatus(o.status, currentStatus, statusMap, currentWooStatus);
  const order = {
    id: num(o.id), number: str(o.number ?? o.id),
    customer_name: personName(b) || personName(s),
    customer_phone: normalizePhone(b.phone) ?? normalizePhone(s.phone),
    customer_city: orNull(s.city) ?? orNull(b.city),
    customer_address: addressOf(s) ?? addressOf(b),
    payment_method: orNull(o.payment_method), payment_title: orNull(o.payment_method_title),
    status: status.status, woo_status: orNull(o.status),
    total: num(o.total) ?? 0, currency: orNull(o.currency) ?? 'EGP', customer_note: orNull(o.customer_note),
    placed_at: gmtIso(o.date_created_gmt), woo_updated_at: gmtIso(o.date_modified_gmt), synced_at: toIso(now),
    raw: cleanRaw(o),
  };
  return { order, items, unknownVendorIds: [...unknown], statusResult: status.result };
}

/**
 * A Dokan sub-order (a WC order with parent_id) → { sub (sub_orders row), unknownVendorIds }, or
 * { skipped: 'invalid', sub: null, unknownVendorIds: [] } without a numeric id / parent_id. ctx null = {}.
 */
export function mapSubOrder(wooSubOrder, ctx) {
  const { vendorsByWooId = null } = ctx ?? {};
  const o = isObj(wooSubOrder) ? wooSubOrder : {};
  if (wooId(o.id) === null || wooId(o.parent_id) === null) return { skipped: 'invalid', sub: null, unknownVendorIds: [] };
  const vendor = wooId(metaValue(o.meta_data, '_dokan_vendor_id'));
  const uuid = vendorUuid(vendorsByWooId, vendor);
  const meta = (key) => metaValue(o.meta_data, key);
  const hasCommission = Object.values(COMMISSION).some((key) => hasMeta(o.meta_data, key));
  const sub = {
    order_id: num(o.parent_id), vendor_id: uuid, woo_order_id: num(o.id), woo_status: orNull(o.status), total: num(o.total),
    dokan_earning: num(meta('_dokan_vendor_earning')) ?? num(o.earning),
    commission: hasCommission
      ? { rate: num(meta(COMMISSION.rate)), type: orNull(meta(COMMISSION.type)), admin_fee: num(meta(COMMISSION.admin_fee)), additional_fee: num(meta(COMMISSION.additional_fee)) }
      : null,
    raw: cleanRaw(o),
  };
  return { sub, unknownVendorIds: vendor !== null && uuid === null ? [vendor] : [] };
}

/**
 * A dokan/v1/stores item → vendors row (raw keeps the public store fields only). status: 'inactive' only when Dokan says
 * so (`enabled` off); the public REST omits `enabled` (seen live, 2026-10-26: list and single store), so an absent / null
 * flag reads 'active' — a store Dokan lists, or one that has orders, is selling until the flag says otherwise.
 */
export function mapStore(dokanStore) {
  const s = isObj(dokanStore) ? dokanStore : {};
  const id = wooId(s.id);
  return {
    woo_vendor_id: id,
    name: str(s.store_name) || `#${id ?? ''}`,
    phone: orNull(s.phone),
    email: isOn(s.show_email) ? orNull(s.email) : null,
    status: s.enabled == null || isOn(s.enabled) ? 'active' : 'inactive',
    raw: { ...pick(s, RAW_STORE), ...(isObj(s.rating) ? { rating: pick(s.rating, ['rating', 'count']) } : {}) },
  };
}

// ---------------------------------------------------------------- cursor

/**
 * Backup-sync cursor: the newest date_modified_gmt − 60 s (late writes), never before the previous cursor. Always
 * `YYYY-MM-DDTHH:MM:SSZ` (the previous one is normalised too); null when neither gives a usable date.
 */
export function nextCursor(previousIso, orders) {
  const newest = objs(orders).reduce((max, o) => Math.max(max, gmtMs(o.date_modified_gmt) ?? -Infinity), -Infinity);
  const prev = gmtMs(previousIso);
  const next = Number.isFinite(newest) ? Math.max(newest - CURSOR_OVERLAP_MS, prev ?? -Infinity) : prev;
  return next === null ? null : isoSeconds(next);
}
