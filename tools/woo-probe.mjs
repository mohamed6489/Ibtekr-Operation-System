// Read-only probe of the staging WooCommerce/Dokan data shape (phase 2 Task 1): statuses, recent orders and Dokan
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
// String mode: credentials in query-like text, WC keys, anything with an @ (emails), phone-like runs of 7+ digits.
const SCRUB = [
  [/((?:token|key|secret|sig|signature|auth|password|pass|pwd)=)[^&\s"'<>]*/gi, `$1${REDACTED}`],
  [/(consumer_[a-z]*)(["']?\s*[:=]\s*["']?)[^&\s"'<>,}]+/gi, `$1$2${REDACTED}`],
  [/\b(?:ck|cs)_[A-Za-z0-9]{6,}/g, REDACTED],
  [/[^\s<>"'(),;:]*@[^\s<>"'(),;]*/g, REDACTED],
  [/\+?\d(?:[ ().-]?\d){6,}/g, REDACTED],
];

const has = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, has(o, k) && o[k] !== undefined ? o[k] : null]));
const keysOf = (o) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const typeOnly = (v) => (Array.isArray(v) ? '<array>' : v !== null && typeof v === 'object' ? '<object>' : v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const stripTags = (s) => s.replace(/<[^>]*(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (typeof u !== 'string' || u === '') return u ?? null;
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
// A non-2xx body: JSON is key-redacted, anything else tag-stripped; then scrubbed and cut.
function errorText(text) {
  let s;
  try { s = JSON.stringify(redact(JSON.parse(text))); } catch { s = stripTags(String(text ?? '')); }
  return cut(scrubText(s), BODY_MAX);
}
const thrownText = (e) => cut(scrubText([e?.name, e?.message, e?.cause?.code].filter(Boolean).join(': ')), BODY_MAX);

/** A 2xx body: JSON, or JSON with junk around it (PHP notices, BOM) → {data, junk}, or {fail} describing it without its content. */
function parseBody(text) {
  try { return { data: JSON.parse(text) }; } catch { /* look for the JSON inside */ }
  const start = text.search(/[[{]/);
  const end = start < 0 ? -1 : text.lastIndexOf(text[start] === '[' ? ']' : '}');
  if (end > start) {
    try { return { data: JSON.parse(text.slice(start, end + 1)), junk: { prefix_len: start, suffix_len: text.length - end - 1 } }; } catch { /* not JSON either */ }
  }
  const head = start < 0 ? text : text.slice(0, start);
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
  const headers = { Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'), Accept: 'application/json' };
  let warnings = [];

  async function get(path) {
    let res, text;
    try {
      res = await fetch(base + path, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) {
      throw new ProbeError(res?.status ?? 0, thrownText(e));
    }
    if (!res.ok) throw new ProbeError(res.status, errorText(text));
    const body = parseBody(text);
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

  const print = (section, obj) => out(section + ' ' + JSON.stringify(redact(obj)));
  let failed = false;
  for (const [sections, step] of steps) {
    warnings = [];
    let lines;
    try {
      const payloads = await step();
      lines = sections.map((s, i) => [s, payloads[i]]);
    } catch (e) {
      failed = true;
      const error = e instanceof ProbeError ? { status: e.status, body: e.body, ...e.extra } : { status: 0, body: thrownText(e) };
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
