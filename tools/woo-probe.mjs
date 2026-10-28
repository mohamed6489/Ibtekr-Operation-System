// Read-only probe of the staging WooCommerce/Dokan data shape (phase 2 Task 1; PROBE=products: phase 5 Task 1): statuses, recent orders and Dokan
// sub-orders, stores, product count, webhooks. Prints one `SECTION {json}` line per section on stdout; every printed
// object goes through redact() first, and orders/stores/webhooks are cut down to an allow-list before that.
// A 2xx body is never echoed: junk around its JSON gives a WARN {section, issue, prefix_len, suffix_len}, an unparseable one an ERROR with
// its length and a scrubbed ≤80-char prefix. A non-2xx body is tag-stripped, scrubbed (scrubText) and cut to 200.
// GET only, Basic auth (ck:cs) over HTTPS. Env: WOO_URL, WOO_CK, WOO_CS (.github/workflows/staging-probe.yml maps them
// from the STAGING_WOO_* secrets). Exit 0 = all sections printed, 1 = at least one ERROR line, 2 = missing/bad env.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SINCE = '2026-10-01T00:00:00';
const SAMPLE = 3, PAGE = 20, BODY_MAX = 200, PREFIX_MAX = 80, TIMEOUT_MS = 30000;
const REDACTED = '<redacted>';
const ORDER_KEYS = ['id', 'number', 'status', 'created_via', 'date_created', 'date_modified', 'parent_id', 'payment_method', 'payment_method_title', 'total', 'currency'];
const ORDER_FIELDS = [...ORDER_KEYS, 'line_items', 'meta_data', 'billing', 'shipping'].join(','); // `_fields`: what summarizeOrder reads, nothing more
// first_name|last_name|email|phone|address_1|address_2|company|customer_note|note — as a whole key or a suffix
// (billing_phone, customer_ip_address), with any address_* and a trailing qualifier (phone_number) too.
const PII_KEY = /(^|_)(first_name|last_name|email|phone|company|note|address)(_\w+)?$/i;
const SECRET_KEY = /(^|_)(secret|token|password|signature|key)$/i; // credentials by name (consumer_key, secret) in an error body
// String mode: auth headers, credentials in query-like text, WC keys, anything with an @ (emails), phone-like runs of
// 7+ digits (ASCII, Arabic-Indic and Persian). run() masks its own keys and host by exact value before this.
const DIGIT = '[\\d\\u0660-\\u0669\\u06F0-\\u06F9]';
const SCRUB = [
  [/\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}/gi, REDACTED],
  [/((?:token|key|secret|sig|signature|auth|password|pass|pwd)=)[^&\s"'<>]*/gi, `$1${REDACTED}`],
  [/(consumer_[a-z]*)(["']?\s*[:=]\s*["']?)[^&\s"'<>,}]+/gi, `$1$2${REDACTED}`],
  [/\b(?:ck|cs)_[A-Za-z0-9]{6,}/g, REDACTED],
  [/[^\s<>"'(),;:]*@[^\s<>"'(),;]*/g, REDACTED],
  [new RegExp(`\\+?${DIGIT}(?:[ ().-]?${DIGIT}){6,}`, 'g'), REDACTED],
];

const has = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, has(o, k) && o[k] !== undefined ? o[k] : null]));
const keysOf = (o) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const typeOnly = (v) => (Array.isArray(v) ? '<array>' : v !== null && typeof v === 'object' ? '<object>' : v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
// Tags out, and <script>/<style> blocks with their contents (a WAF page's first 200 chars are not JS/CSS).
const stripTags = (s) => s.replace(/<(script|style)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ').replace(/<[^>]*(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
// Cut to max and drop a word the cut split in two (half an email or a token never shows).
const cut = (s, max) => (s.length <= max ? s : s.slice(0, max).replace(/[^\s"',;:{}[\]<>&=]+$/, ''));

/** Deep copy with every personal-data or credential key's value replaced by "<redacted>" (input untouched). */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = PII_KEY.test(k) || SECRET_KEY.test(k) ? REDACTED : redact(v);
    return out;
  }
  return value;
}

/** redact() for free text (error pages, fetch messages): see SCRUB. */
export function scrubText(text) {
  let s = String(text ?? '');
  for (const [re, to] of SCRUB) s = s.replace(re, to);
  return s;
}

/** An order cut to its shape: scalar fields, counts and key names only; sub-orders add their `_dokan*` meta values. */
export function summarizeOrder(order) {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data.filter((m) => m !== null && typeof m === 'object') : [];
  const out = pick(order, ORDER_KEYS);
  out.line_items_count = Array.isArray(order?.line_items) ? order.line_items.length : 0;
  out.meta_keys = meta.map((m) => m.key ?? null);
  out.billing_keys = keysOf(order?.billing);
  out.shipping_keys = keysOf(order?.shipping);
  if (Number(order?.parent_id) > 0) {
    out.dokan_meta = Object.fromEntries(meta.filter((m) => typeof m.key === 'string' && m.key.startsWith('_dokan')).map((m) => [m.key, typeOnly(m.value)]));
  }
  return out;
}

export const summarizeStore = (store) => pick(store, ['id', 'store_name', 'enabled', 'registered']);

// Hostname down to its registrable part (last two labels, three after a short SLD such as com.eg): webhook services
// put endpoint ids in subdomains too (xyz.m.pipedream.net). IP literals stay.
function maskHost(host) {
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return host;
  const labels = host.split('.');
  const keep = labels.length > 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
  return labels.length > keep ? REDACTED + '.' + labels.slice(-keep).join('.') : host;
}
/** Where a webhook points, never its secret: scheme + registrable host (+ port); a path becomes /<redacted>, and a
 *  query, fragment or user:pass@ adds ?<redacted>. */
export function maskUrl(u) {
  if (u == null) return null;
  if (typeof u !== 'string') return REDACTED;
  if (u === '') return '';
  try {
    const x = new URL(u);
    return `${x.protocol}//${maskHost(x.hostname)}${x.port ? ':' + x.port : ''}`
      + (x.pathname && x.pathname !== '/' ? '/' + REDACTED : '')
      + (x.search || x.hash || x.username || x.password ? '?' + REDACTED : '');
  } catch { return REDACTED; }
}
export const summarizeWebhook = (hook) => ({ ...pick(hook, ['id', 'name', 'topic', 'status']), delivery_url: maskUrl(hook?.delivery_url) });

export const pickSample = (list, n) => (Array.isArray(list) ? list.slice(0, Math.max(0, n)) : []);

// body is always safe to print by the time it is stored here.
class ProbeError extends Error {
  constructor(status, body, extra = {}) { super(`HTTP ${status}`); this.status = status; this.body = body; this.extra = extra; }
}
// Free text below gets own() first (run()'s exact-value mask of its keys and host), then scrubText, then the cut.
// A non-2xx body: JSON is key-redacted, anything else tag-stripped; then scrubbed and cut.
function errorText(text, own) {
  let s;
  try { s = JSON.stringify(redact(JSON.parse(text))); } catch { s = stripTags(String(text ?? '')); }
  return cut(scrubText(own(s)), BODY_MAX);
}
const thrownText = (e, own) => cut(scrubText(own([e?.name, e?.message, e?.cause?.code].filter(Boolean).join(': '))), BODY_MAX);

/** A value cut to its shape (phase 5): objects → their keys with each value's shape (4 levels), arrays → their length and
 *  the first item's shape, strings → 'string:filled' / 'string:empty', anything else its type. No value is kept. */
export function shapeOf(v, depth = 0) {
  if (Array.isArray(v)) return { array: v.length, item: v.length && depth < 4 ? shapeOf(v[0], depth + 1) : undefined };
  if (v !== null && typeof v === 'object') return depth < 4 ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k], depth + 1)])) : 'object';
  if (typeof v === 'string') return v.trim() ? 'string:filled' : 'string:empty';
  return v === null ? 'null' : typeof v;
}
/** The meta_data key names of a product or variation, sorted, without their values. */
export const metaKeys = (v) => (v && Array.isArray(v.meta_data) ? [...new Set(v.meta_data.filter((m) => m && typeof m === 'object').map((m) => String(m.key)))].sort() : []);
/** An OPTIONS answer → { property: 'type[:readonly]' } for the route's schema (names and types only). */
export function schemaOf(data) {
  const props = data && data.schema && data.schema.properties && typeof data.schema.properties === 'object' ? data.schema.properties : {};
  return Object.fromEntries(Object.keys(props).sort().map((k) => [k, (Array.isArray(props[k]?.type) ? props[k].type.join('|') : props[k]?.type ?? '?') + (props[k]?.readonly ? ':readonly' : '')]));
}

/** A 2xx body: JSON, or JSON with junk around it (PHP notices, BOM) → {data, junk}, or {fail} describing it without its content. */
function parseBody(text, own) {
  try { return { data: JSON.parse(text) }; } catch { /* look for the JSON inside */ }
  const start = text.search(/[[{]/);
  const end = start < 0 ? -1 : text.lastIndexOf(text[start] === '[' ? ']' : '}');
  if (end > start) {
    try { return { data: JSON.parse(text.slice(start, end + 1)), junk: { prefix_len: start, suffix_len: text.length - end - 1 } }; } catch { /* not JSON either */ }
  }
  const head = own(start < 0 ? text : text.slice(0, start)); // before the cut, so a key split by it is still caught
  return { fail: { length: text.length, prefix: scrubText(stripTags(cut(head, PREFIX_MAX))), suffix_len: end > start ? text.length - end - 1 : 0 } };
}

/** The probe. Injectable fetch/out/err for tests; returns the exit code. */
export async function run({ env = process.env, fetch = globalThis.fetch, out = console.log, err = console.error } = {}) {
  const [url, ck, cs] = ['WOO_URL', 'WOO_CK', 'WOO_CS'].map((k) => String(env[k] ?? '').trim());
  const missing = ['WOO_URL', 'WOO_CK', 'WOO_CS'].filter((k, i) => ![url, ck, cs][i]);
  if (missing.length) { err(`woo-probe: missing env ${missing.join(', ')} (the staging-probe workflow maps them from the STAGING_WOO_* secrets)`); return 2; }
  let parsed;
  try { parsed = new URL(url); } catch { err('woo-probe: WOO_URL is not a valid URL'); return 2; }
  if (parsed.protocol !== 'https:') { err('woo-probe: WOO_URL must be https:// (the keys travel in the Authorization header)'); return 2; }
  if (parsed.username || parsed.password) { err('woo-probe: WOO_URL must not contain user:pass@ (the keys go in WOO_CK/WOO_CS)'); return 2; }
  const base = parsed.origin + parsed.pathname.replace(/\/+$/, '') + '/wp-json/';
  const basic = Buffer.from(`${ck}:${cs}`).toString('base64');
  const headers = { Authorization: 'Basic ' + basic, Accept: 'application/json' };
  // Exact values, longest first, split/join (no regex): an error page that echoes our header, keys or host prints none of them.
  const mine = [basic, ck, cs, parsed.hostname].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  const own = (s) => mine.reduce((t, v) => t.split(v).join(REDACTED), String(s ?? ''));
  let warnings = [];

  async function get(path, method = 'GET') {
    let res, text;
    try {
      res = await fetch(base + path, { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) {
      throw new ProbeError(res?.status ?? 0, thrownText(e, own));
    }
    if (!res.ok) throw new ProbeError(res.status, errorText(text, own));
    const body = parseBody(text, own);
    if (body.fail) throw new ProbeError(res.status, 'not JSON', body.fail);
    if (body.junk) warnings.push({ issue: 'junk around JSON', ...body.junk }); // not "note": that key is redacted
    return { data: body.data, total: num(res.headers.get('x-wp-total')), pages: num(res.headers.get('x-wp-totalpages')), status: res.status };
  }
  async function getList(path) {
    const r = await get(path);
    if (!Array.isArray(r.data)) throw new ProbeError(r.status, 'expected a JSON array, got ' + (r.data === null ? 'null' : typeof r.data));
    return r;
  }
  const totalOf = (r) => { if (r.total == null) throw new ProbeError(r.status, 'missing X-WP-Total header'); return r.total; };

  const steps = [
    [['statuses'], async () => {
      const { data } = await getList('wc/v3/reports/orders/totals');
      return [{ count: data.length, items: data.map((s) => pick(s, ['slug', 'name', 'total'])) }];
    }],
    [['orders_since'], async () => [{ after: SINCE, total: totalOf(await getList(`wc/v3/orders?after=${SINCE}&per_page=1&_fields=id`)) }]],
    // WC has no "parents only" filter: read the newest orders and split them by parent_id ourselves.
    [['parents_sample', 'subs_sample'], async () => {
      const q = `wc/v3/orders?after=${SINCE}&per_page=${PAGE}&_fields=${ORDER_FIELDS}`;
      const first = await getList(q);
      let orders = first.data;
      const isSub = (o) => Number(o?.parent_id) > 0;
      const more = first.pages != null ? first.pages > 1 : orders.length === PAGE;
      if (orders.filter(isSub).length < SAMPLE && more) orders = orders.concat((await getList(q + '&page=2')).data);
      const parents = orders.filter((o) => o?.parent_id != null && Number(o.parent_id) === 0), subs = orders.filter(isSub);
      const sample = (list) => ({ scanned: orders.length, found: list.length, items: pickSample(list, SAMPLE).map(summarizeOrder) });
      return [sample(parents), sample(subs)];
    }],
    [['stores'], async () => {
      const r = await getList('dokan/v1/stores?per_page=100&_fields=id,store_name,enabled,registered');
      return [{ total: r.total, count: r.data.length, items: r.data.map(summarizeStore) }];
    }],
    [['products_total'], async () => [{ total: totalOf(await getList('wc/v3/products?per_page=1&_fields=id')) }]],
    [['webhooks'], async () => {
      const r = await getList('wc/v3/webhooks?per_page=50&_fields=id,name,topic,status,delivery_url');
      return [{ total: r.total, count: r.data.length, items: r.data.map(summarizeWebhook) }];
    }],
  ];

  // PROBE=products (phase 5 Task 1): the product sections instead — shapes, meta key names, schema names, totals.
  const productSteps = [
    [['product_shape'], async () => {
      const { data } = await getList('wc/v3/products?per_page=1');
      return [{ shape: shapeOf(data[0]), meta_keys: metaKeys(data[0]) }];
    }],
    [['variation_shape'], async () => {
      const { data } = await getList('wc/v3/products?type=variable&per_page=1&_fields=id');
      if (!data.length) return [{ none: true }];
      const r = await getList(`wc/v3/products/${Number(data[0].id)}/variations?per_page=1`);
      return [{ total: r.total, shape: shapeOf(r.data[0]), meta_keys: metaKeys(r.data[0]) }];
    }],
    [['schema_wc'], async () => [schemaOf((await get('wc/v3/products', 'OPTIONS')).data)]],
    [['schema_dokan'], async () => [schemaOf((await get('dokan/v1/products', 'OPTIONS')).data)]],
    [['totals'], async () => {
      const t = {};
      for (const q of ['status=any', 'status=publish', 'status=draft', 'status=pending', 'status=private', 'status=trash', 'type=simple', 'type=variable', 'lang=ar', 'lang=en', 'lang=all']) {
        try { t[q] = totalOf(await getList(`wc/v3/products?${q}&per_page=1&_fields=id`)); } catch (e) { t[q] = e instanceof ProbeError ? 'HTTP ' + e.status : 'error'; }
      }
      return [t];
    }],
    [['taxonomies'], async () => {
      const out = {};
      try { const r = await getList('wc/v3/products/brands?per_page=1'); out.brands = { total: r.total, shape: shapeOf(r.data[0]) }; } catch (e) { out.brands = e instanceof ProbeError ? 'HTTP ' + e.status : 'error'; }
      try { const r = await getList('wc/v3/products/tags?per_page=1'); out.tags_total = r.total; } catch (e) { out.tags_total = e instanceof ProbeError ? 'HTTP ' + e.status : 'error'; }
      const a = await getList('wc/v3/products/attributes');
      out.attributes = a.data.map((x) => String(x?.slug ?? '') + ':' + String(x?.name ?? ''));
      return [out];
    }],
  ];
  // PROBE=commission (phase 5, the owner's «Commission» column): where a product's admin commission comes from — the
  // commission meta of one product (PROBE_ID, else the newest) and its variations (key + scalar value, commission keys only),
  // its store's Dokan commission fields, and how many of the newest 100 products carry a product-level commission.
  const isComm = (k) => /commission/i.test(String(k));
  const commMeta = (p) => Object.fromEntries((Array.isArray(p?.meta_data) ? p.meta_data : []).filter((m) => m && isComm(m.key) && (m.value === null || ['string', 'number', 'boolean'].includes(typeof m.value))).map((m) => [m.key, m.value]));
  const pid = /^\d{1,10}$/.test(String(env.PROBE_ID ?? '').trim()) ? String(env.PROBE_ID).trim() : '';
  const commissionSteps = [
    [['product_commission'], async () => {
      const p = pid ? (await get('wc/v3/products/' + pid)).data : (await getList('wc/v3/products?per_page=1')).data[0];
      const out = { id: p?.id, type: p?.type, price: p?.price, regular_price: p?.regular_price, sale_price: p?.sale_price, store: p?.store?.id ?? null, meta: commMeta(p) };
      if (p?.type === 'variable') { const v = await getList('wc/v3/products/' + Number(p.id) + '/variations?per_page=20'); out.variations = v.data.map((x) => ({ id: x.id, price: x.price, meta: commMeta(x) })); }
      if (out.store) { try { const st = (await get('dokan/v1/stores/' + Number(out.store))).data; out.store_commission = { type: st?.admin_commission_type ?? null, rate: st?.admin_commission ?? null, fee: st?.admin_additional_fee ?? null }; } catch (e) { out.store_commission = e instanceof ProbeError ? 'HTTP ' + e.status : 'error'; } }
      return [out];
    }],
    [['commission_spread'], async () => {
      const { data } = await getList('wc/v3/products?per_page=100');
      const withMeta = data.filter((p) => Object.keys(commMeta(p)).length);
      const keys = {}; withMeta.forEach((p) => Object.keys(commMeta(p)).forEach((k) => { keys[k] = (keys[k] || 0) + 1; }));
      return [{ scanned: data.length, with_commission_meta: withMeta.length, keys }];
    }],
  ];
  // PROBE=earning (phase 5, the owner: "the site has a fixed place that gives my commission and the maker's"): does Dokan
  // answer a product's commission itself? Route names with commission / earning in dokan/v1..v3, then dokan/v1/commission
  // for one product (PROBE_ID, else the newest) at its price, context seller (the maker's earning) and admin (ours) —
  // numbers and shapes only — beside the product's commission meta and its store's rate (to compare with our formula).
  const numOrShape = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) ? Number(v) : shapeOf(v));
  const failOf = (e) => (e instanceof ProbeError ? { status: e.status, body: e.body } : 'error');
  const earningSteps = [
    [['earning_routes'], async () => {
      const out = {};
      for (const ns of ['dokan/v1', 'dokan/v2', 'dokan/v3']) {
        try { const { data } = await get(ns); out[ns] = Object.keys(data?.routes ?? {}).filter((r) => /commission|earning/i.test(r)).sort(); } catch (e) { out[ns] = failOf(e); }
      }
      return [out];
    }],
    [['earning_product'], async () => {
      const p = pid ? (await get('wc/v3/products/' + pid)).data : (await getList('wc/v3/products?per_page=1')).data[0];
      const id = Number(p?.id);
      const out = { id, type: p?.type, price: num(p?.price), store: p?.store?.id ?? null, meta: commMeta(p) };
      if (out.store) { try { const st = (await get('dokan/v1/stores/' + Number(out.store))).data; out.store_commission = { type: st?.admin_commission_type ?? null, rate: st?.admin_commission ?? null, fee: st?.admin_additional_fee ?? null }; } catch (e) { out.store_commission = failOf(e); } }
      let target = { id, price: out.price };
      if (p?.type === 'variable') { const v = (await getList('wc/v3/products/' + id + '/variations?per_page=1')).data[0]; target = { id: Number(v?.id), price: num(v?.price) }; out.variation = target; }
      for (const context of ['seller', 'admin']) {
        try { out[context] = numOrShape((await get(`dokan/v1/commission?product_id=${target.id}&amount=${target.price ?? 0}&context=${context}`)).data); } catch (e) { out[context] = failOf(e); }
      }
      return [out];
    }],
  ];
  const mode = String(env.PROBE ?? '').trim();
  const chosen = mode === 'products' ? productSteps : mode === 'commission' ? commissionSteps : mode === 'earning' ? earningSteps : steps;

  const print = (section, obj) => out(section + ' ' + JSON.stringify(redact(obj)));
  let failed = false;
  for (const [sections, step] of chosen) {
    warnings = [];
    let lines;
    try {
      const payloads = await step();
      lines = sections.map((s, i) => [s, payloads[i]]);
    } catch (e) {
      failed = true;
      const error = e instanceof ProbeError ? { status: e.status, body: e.body, ...e.extra } : { status: 0, body: thrownText(e, own) };
      lines = sections.map((section) => ['ERROR', { section, ...error }]);
    }
    sections.forEach((section, i) => {
      for (const w of warnings) print('WARN', { section, ...w });
      print(...lines[i]);
    });
  }
  return failed ? 1 : 0;
}

// CLI only when run directly (realpath on both sides, so a symlinked path still counts); importing makes no request.
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) process.exitCode = await run();
