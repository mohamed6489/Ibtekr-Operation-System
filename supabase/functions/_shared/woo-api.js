// woo-api: the WooCommerce / Dokan REST client of the Edge Functions, and the scrubber for error text.
// Auth rule (staging probe, Task 1): the WC REST keys authenticate wc/v3 only, so `wc/` paths get
// Basic base64(WOO_CK:WOO_CS); `dokan/` paths get no Authorization header at all (the store list and a single store are
// public; Dokan answers 401 invalid_username to the WC header), unless WOO_WP_USER and WOO_WP_APP_PASSWORD are both set
// (a WordPress Application Password, sent as Basic on dokan/ paths, and on wp/v2/media and wp/v2/product/{id} for the studio,
// phase 5.2). Any other namespace is refused.
// Every request has a 30 s timeout and refuses redirects (the Basic header never follows one); a non-2xx answer (or
// a body that is not JSON) throws a WooError with the status and a scrubbed excerpt of at most 200 characters.
// Scrubbing: our own keys / secrets by exact value (and the Basic header values), then patterns for auth headers,
// credentials in query-like text, WC keys, emails and phone-like digit runs (ASCII, Arabic-Indic, Persian) — the same
// rules as tools/woo-probe.mjs.
import { redactPII } from './woo-core.js';

export const PER_PAGE = 100;
export const MAX_PAGES = 50;
const TIMEOUT_MS = 30_000;
const EXCERPT_MAX = 200;
const TEXT_MAX = 400;
const REDACTED = '<redacted>';
const DIGIT = '[\\d\\u0660-\\u0669\\u06F0-\\u06F9]';
const PATTERNS = [
  [/\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}/gi, REDACTED],
  [/((?:token|key|secret|sig|signature|auth|password|pass|pwd)=)[^&\s"'<>]*/gi, `$1${REDACTED}`],
  [/(consumer_[a-z]*)(["']?\s*[:=]\s*["']?)[^&\s"'<>,}]+/gi, `$1$2${REDACTED}`],
  [/\b(?:ck|cs)_[A-Za-z0-9_]{6,}/g, REDACTED],
  [/[^\s<>"'(),;:]*@[^\s<>"'(),;]*/g, REDACTED],
  [new RegExp(`\\+?${DIGIT}(?:[ ().-]?${DIGIT}){6,}`, 'g'), REDACTED],
];

export class WooError extends Error {
  constructor(status, what, excerpt) {
    super(`${what} → HTTP ${status}${excerpt ? `: ${excerpt}` : ''}`);
    this.name = 'WooError';
    this.status = status;
  }
}

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

const trim = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const base64 = (text) => { let s = ''; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };
const stripTags = (s) => s.replace(/<(script|style)\b[^>]*>[\s\S]*?(<\/\1\s*>|$)/gi, ' ').replace(/<[^>]*(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
// Cut to max and drop a word the cut split in two (half a token never shows).
const cut = (s, max) => (s.length <= max ? s : s.slice(0, max).replace(/[^\s"',;:{}[\]<>&=]+$/, ''));

/** (text, max?) → text with our secrets and personal data masked, at most `max` characters. */
export function makeScrubber(env = {}) {
  const [ck, cs, user, pass] = ['WOO_CK', 'WOO_CS', 'WOO_WP_USER', 'WOO_WP_APP_PASSWORD'].map((k) => trim(env[k]));
  const own = [ck, cs, pass, trim(env.WOO_WEBHOOK_SECRET), trim(env.SUPABASE_SERVICE_ROLE_KEY),
    ck && cs ? base64(`${ck}:${cs}`) : '', user && pass ? base64(`${user}:${pass}`) : '']
    .filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  return (text, max = TEXT_MAX) => {
    let s = own.reduce((t, v) => t.split(v).join(REDACTED), String(text ?? ''));
    for (const [re, to] of PATTERNS) s = s.replace(re, to);
    return cut(s, max);
  };
}

/** "Name: message" of a thrown value, scrubbed (for woo_sync_log.detail / woo_webhook_events.error). */
export const errorText = (e, scrub) => scrub(`${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`);

// A non-2xx body: JSON is key-redacted (redactPII), anything else tag-stripped; then scrubbed and cut.
function excerpt(text, scrub) {
  let s;
  try { s = JSON.stringify(redactPII(JSON.parse(text))); } catch { s = stripTags(String(text ?? '')); }
  return scrub(s, EXCERPT_MAX);
}

function baseUrl(raw) {
  let url;
  try { url = new URL(trim(raw)); } catch { throw new ConfigError('WOO_URL is not set or not a URL'); }
  if (url.protocol !== 'https:') throw new ConfigError('WOO_URL must be https:// (the keys travel in the Authorization header)');
  if (url.username || url.password) throw new ConfigError('WOO_URL must not contain user:pass@');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/wp-json/`;
}

/**
 * { get(path, query), put(path, body), post(path, body), del(path), upload(path, bytes, filename, mime), eachPage(path, query, onPage, { maxPages, startPage }), scrub }.
 * get/put/post → { data, total, pages } (X-WP-Total / X-WP-TotalPages as numbers or null).
 */
export function wooApi(env, fetchFn) {
  const base = baseUrl(env.WOO_URL);
  const [ck, cs, user, pass] = ['WOO_CK', 'WOO_CS', 'WOO_WP_USER', 'WOO_WP_APP_PASSWORD'].map((k) => trim(env[k]));
  if (!ck || !cs) throw new ConfigError('WOO_CK / WOO_CS are not set');
  const wcAuth = `Basic ${base64(`${ck}:${cs}`)}`;
  const dokanAuth = user && pass ? `Basic ${base64(`${user}:${pass}`)}` : null;
  const scrub = makeScrubber(env);

  // phase 5.2 (the studio): two WordPress routes only — the media library and a product's author — with the Application
  // Password; any other wp/ path is refused, and without the password these two are a ConfigError.
  const WP_PATH = /^wp\/v2\/(media|product\/\d+)$/;
  function authFor(path) {
    if (path.startsWith('wc/')) return wcAuth;
    if (path.startsWith('dokan/')) return dokanAuth;
    if (WP_PATH.test(path)) { if (!dokanAuth) throw new ConfigError('WOO_WP_USER / WOO_WP_APP_PASSWORD are not set'); return dokanAuth; }
    throw new ConfigError(`refused REST path ${path.split('/')[0]}/`);
  }

  async function request(method, path, { query = null, body, raw } = {}) {
    const auth = authFor(path);
    const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) Object.assign(headers, raw.headers);
    const what = `${method} ${path}`;
    let res, text;
    try {
      res = await fetchFn(base + path + (qs ? `?${qs}` : ''), { method, headers, body: raw ? raw.bytes : body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(raw ? TIMEOUT_MS * 2 : TIMEOUT_MS) });
      text = await res.text();
    } catch (e) {
      throw new WooError(res?.status ?? 0, what, scrub(`${e?.name ?? 'Error'}: ${e?.message ?? ''}`, EXCERPT_MAX));
    }
    if (!res.ok) throw new WooError(res.status, what, excerpt(text, scrub));
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new WooError(res.status, what, 'not JSON'); }
    return { data, total: num(res.headers.get('x-wp-total')), pages: num(res.headers.get('x-wp-totalpages')) };
  }

  /** GET page 1, 2, … (per_page PER_PAGE) until a short page, X-WP-TotalPages or maxPages; → { pages, done }. */
  async function eachPage(path, query, onPage, { maxPages = MAX_PAGES, startPage = 1 } = {}) {
    for (let page = startPage; ; page++) {
      const r = await request('GET', path, { query: { ...query, per_page: PER_PAGE, page } });
      if (!Array.isArray(r.data)) throw new WooError(200, `GET ${path}`, 'expected a JSON array');
      await onPage(r.data, page);
      if (r.data.length < PER_PAGE || (r.pages !== null && page >= r.pages)) return { pages: page, done: true };
      if (page - startPage + 1 >= maxPages) return { pages: page, done: false };
    }
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    put: (path, body) => request('PUT', path, { body }),
    post: (path, body) => request('POST', path, { body }),
    // DELETE with no query at all: a product goes to the trash (never `force`, which deletes it for good; phase 5)
    del: (path) => request('DELETE', path),
    options: (path) => request('OPTIONS', path), // a route's schema, read-only (probe_dokan options, phase 5)
    // a file to the media library (phase 5.2): the bytes as they are, the file name ASCII-safe in Content-Disposition
    upload: (path, bytes, filename, mime) => request('POST', path, { raw: { bytes, headers: { 'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${String(filename).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 150)}"` } } }),
    eachPage,
    scrub,
    hasDokanAuth: dokanAuth !== null, // a WordPress Application Password is set (dokan/ paths are authenticated)
  };
}
