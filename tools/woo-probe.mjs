// Read-only probe of the staging WooCommerce/Dokan data shape (phase 2 Task 1): statuses, recent orders and Dokan
// sub-orders, stores, product count, webhooks. Prints one `SECTION {json}` line per section on stdout; every printed
// object goes through redact() first, and orders/stores/webhooks are cut down to an allow-list before that.
// GET only, Basic auth (ck:cs) over HTTPS. Env: WOO_URL, WOO_CK, WOO_CS (.github/workflows/staging-probe.yml maps them
// from the STAGING_WOO_* secrets). Exit 0 = all sections printed, 1 = at least one ERROR line, 2 = missing/bad env.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SINCE = '2026-10-01T00:00:00';
const SAMPLE = 3, PAGE = 20, BODY_MAX = 200, TIMEOUT_MS = 30000;
const REDACTED = '<redacted>';
const ORDER_KEYS = ['id', 'number', 'status', 'created_via', 'date_created', 'date_modified', 'parent_id', 'payment_method', 'payment_method_title', 'total', 'currency'];
const ORDER_FIELDS = [...ORDER_KEYS, 'line_items', 'meta_data', 'billing', 'shipping'].join(','); // `_fields`: what summarizeOrder reads, nothing more
// first_name|last_name|email|phone|address_1|address_2|company|customer_note|note — as a whole key or a suffix
// (billing_phone, customer_ip_address), with any address_* and a trailing qualifier (phone_number) too.
const PII_KEY = /(^|_)(first_name|last_name|email|phone|company|note|address)(_\w+)?$/i;

const has = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, has(o, k) && o[k] !== undefined ? o[k] : null]));
const keysOf = (o) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const typeOnly = (v) => (Array.isArray(v) ? '<array>' : v !== null && typeof v === 'object' ? '<object>' : v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Deep copy with every personal-data key's value replaced by "<redacted>" (input untouched). */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = PII_KEY.test(k) ? REDACTED : redact(v);
    return out;
  }
  return value;
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

/** delivery_url keeps origin + path; a query/fragment (often a token) and any user:pass@ are dropped. */
export function maskUrl(u) {
  if (typeof u !== 'string' || u === '') return u ?? null;
  try { const x = new URL(u); return x.origin + x.pathname + (x.search || x.hash ? '?' + REDACTED : ''); } catch { return REDACTED; }
}
export const summarizeWebhook = (hook) => ({ ...pick(hook, ['id', 'name', 'topic', 'status']), delivery_url: maskUrl(hook?.delivery_url) });

export const pickSample = (list, n) => (Array.isArray(list) ? list.slice(0, Math.max(0, n)) : []);

class ProbeError extends Error {
  constructor(status, body) { super(`HTTP ${status}`); this.status = status; this.body = body; }
}
// JSON bodies are redacted before they are cut; anything else is cut as text.
function clip(body) {
  let text = String(body ?? '');
  try { text = JSON.stringify(redact(JSON.parse(text))); } catch { /* not JSON: keep the text */ }
  return text.slice(0, BODY_MAX);
}

/** The probe. Injectable fetch/out/err for tests; returns the exit code. */
export async function run({ env = process.env, fetch = globalThis.fetch, out = console.log, err = console.error } = {}) {
  const [url, ck, cs] = ['WOO_URL', 'WOO_CK', 'WOO_CS'].map((k) => String(env[k] ?? '').trim());
  const missing = ['WOO_URL', 'WOO_CK', 'WOO_CS'].filter((k, i) => ![url, ck, cs][i]);
  if (missing.length) { err(`woo-probe: missing env ${missing.join(', ')} (the staging-probe workflow maps them from the STAGING_WOO_* secrets)`); return 2; }
  let parsed;
  try { parsed = new URL(url); } catch { err('woo-probe: WOO_URL is not a valid URL'); return 2; }
  if (parsed.protocol !== 'https:') { err('woo-probe: WOO_URL must be https:// (the keys travel in the Authorization header)'); return 2; }
  const base = url.replace(/\/+$/, '') + '/wp-json/';
  const headers = { Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'), Accept: 'application/json' };

  async function get(path) {
    let res, text;
    try {
      res = await fetch(base + path, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) {
      throw new ProbeError(res?.status ?? 0, [e?.name, e?.message, e?.cause?.code].filter(Boolean).join(': '));
    }
    if (!res.ok) throw new ProbeError(res.status, text);
    let data;
    try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new ProbeError(res.status, 'not JSON: ' + text); }
    return { data, total: num(res.headers.get('x-wp-total')), pages: num(res.headers.get('x-wp-totalpages')), status: res.status };
  }
  async function getList(path) {
    const r = await get(path);
    if (!Array.isArray(r.data)) throw new ProbeError(r.status, 'expected a JSON array, got ' + (r.data === null ? 'null' : typeof r.data));
    return r;
  }

  const steps = [
    [['statuses'], async () => {
      const { data } = await getList('wc/v3/reports/orders/totals');
      return [{ count: data.length, items: data.map((s) => pick(s, ['slug', 'name', 'total'])) }];
    }],
    [['orders_since'], async () => [{ after: SINCE, total: (await getList(`wc/v3/orders?after=${SINCE}&per_page=1&_fields=id`)).total }]],
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
    [['products_total'], async () => [{ total: (await getList('wc/v3/products?per_page=1&_fields=id')).total }]],
    [['webhooks'], async () => {
      const r = await getList('wc/v3/webhooks?per_page=50&_fields=id,name,topic,status,delivery_url');
      return [{ total: r.total, count: r.data.length, items: r.data.map(summarizeWebhook) }];
    }],
  ];

  const print = (section, obj) => out(section + ' ' + JSON.stringify(redact(obj)));
  let failed = false;
  for (const [sections, step] of steps) {
    try {
      const payloads = await step();
      sections.forEach((s, i) => print(s, payloads[i]));
    } catch (e) {
      failed = true;
      const status = e instanceof ProbeError ? e.status : 0;
      const body = clip(e instanceof ProbeError ? e.body : [e?.name, e?.message].filter(Boolean).join(': '));
      for (const section of sections) print('ERROR', { section, status, body });
    }
  }
  return failed ? 1 : 0;
}

// CLI only when run directly (realpath on both sides, so a symlinked path still counts); importing makes no request.
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) process.exitCode = await run();
