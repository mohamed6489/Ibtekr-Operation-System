// settings-link: the platform keys the admin writes from «الإعدادات › الربط بالمنصات» (phase 11, decisions 9 / 10 / 13) — pure,
// no I/O, shared by settings-admin (the server) and mirrored by the page (SETTINGS_LINK_FIELDS in the settings block: labels and
// placeholders there, the rule here). Every secret lives in Vault as app_<name>; a secret field's value never leaves the server
// except as its last 4 characters (tailOf). parseSecret merges a save over what is stored: a given value replaces, an empty one
// removes, an omitted one stays (the way 9.5.6 saves an ads link). probeOf names the one cheap read that proves a key works.

export const SECRET_NAMES = Object.freeze(['woo', 'anthropic', 'openai', 'gemini', 'elevenlabs', 'higgsfield', 'magnific_api', 'resend',
  'airtable', 'sheets', 'paymob', 'bosta', 'n8n', 'github', 'figma']);
export const DYNAMIC_NAME = /^(mcp|custom)_[a-z0-9][a-z0-9_]{0,39}$/;
export const nameOk = (n) => SECRET_NAMES.includes(n) || DYNAMIC_NAME.test(String(n ?? ''));

const HTTPS = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,180}\.[a-z]{2,24}$/i;
// a field: { secret?: true (never shown back), optional?: true, re?: RegExp, kind: 'secret' | 'id' | 'url' | 'email' | 'bool' | 'text' }
const KEY = { secret: true };
export const SECRET_FIELDS = Object.freeze({
  woo: { url: { kind: 'url' }, ck: { ...KEY, re: /^ck_[A-Za-z0-9]{20,64}$/ }, cs: { ...KEY, re: /^cs_[A-Za-z0-9]{20,64}$/ }, wp_user: { kind: 'id', optional: true, re: /^[A-Za-z0-9._@-]{1,60}$/ }, wp_app_password: { ...KEY, optional: true, re: /^[A-Za-z0-9 ]{16,64}$/ }, push: { kind: 'bool', optional: true } },
  anthropic: { key: { ...KEY, re: /^sk-ant-[A-Za-z0-9_-]{20,200}$/ } },
  openai: { key: { ...KEY, re: /^sk-[A-Za-z0-9_-]{20,200}$/ } },
  gemini: { key: { ...KEY, re: /^[A-Za-z0-9_-]{20,120}$/ } },
  elevenlabs: { key: { ...KEY, re: /^[A-Za-z0-9_-]{20,120}$/ } },
  higgsfield: { key: { ...KEY, re: /^[A-Za-z0-9_-]{8,200}$/ }, secret: { ...KEY, optional: true, re: /^[A-Za-z0-9_-]{8,200}$/ } },
  magnific_api: { key: { ...KEY, re: /^[A-Za-z0-9_-]{16,200}$/ } },
  resend: { key: { ...KEY, re: /^re_[A-Za-z0-9_-]{10,120}$/ }, from: { kind: 'email', optional: true } },
  airtable: { key: { ...KEY, re: /^pat[A-Za-z0-9._-]{10,200}$/ }, base: { kind: 'id', optional: true, re: /^app[A-Za-z0-9]{10,20}$/ } },
  sheets: { key: { ...KEY, re: /^[A-Za-z0-9_-]{20,200}$/ }, sheet: { kind: 'id', optional: true, re: /^[A-Za-z0-9_-]{20,120}$/ } },
  paymob: { key: { ...KEY, re: /^[A-Za-z0-9._-]{20,400}$/ }, merchant: { kind: 'id', optional: true, re: /^[A-Za-z0-9_-]{1,60}$/ } },
  bosta: { key: { ...KEY, re: /^[A-Za-z0-9._-]{20,400}$/ } },
  n8n: { url: { kind: 'url' }, key: { ...KEY, optional: true, re: /^[A-Za-z0-9._-]{8,400}$/ } },
  github: { key: { ...KEY, re: /^(ghp_|github_pat_)[A-Za-z0-9_]{20,255}$/ }, repo: { kind: 'id', optional: true, re: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ } },
  figma: { key: { ...KEY, re: /^fig[a-z]{0,3}_[A-Za-z0-9_-]{20,120}$/ }, file: { kind: 'id', optional: true, re: /^[A-Za-z0-9]{10,60}$/ } },
  // an MCP server the system connects to (decision 4): the URL and an optional token; a custom tool (decision 13): the name,
  // how it connects and a key or URL
  mcp: { url: { kind: 'url' }, token: { ...KEY, optional: true, re: /^[^\s]{8,400}$/ }, name: { kind: 'text', optional: true, re: /^[^<>\u0000-\u001f]{1,60}$/ } },
  custom: { name: { kind: 'text', re: /^[^<>\u0000-\u001f]{1,60}$/ }, conn: { kind: 'id', re: /^(API|MCP|OAuth)$/ }, key: { ...KEY, optional: true, re: /^[^\s]{4,400}$/ }, url: { kind: 'url', optional: true }, desc: { kind: 'text', optional: true, re: /^[^<>\u0000-\u001f]{0,200}$/ } },
});
export const fieldsOf = (name) => SECRET_FIELDS[name] ?? (String(name).startsWith('mcp_') ? SECRET_FIELDS.mcp : String(name).startsWith('custom_') ? SECRET_FIELDS.custom : null);
// what a saved link needs to count as linked (every non-optional field)
export const linkReady = (name, stored) => { const F = fieldsOf(name); return !!F && !!stored && Object.entries(F).every(([k, f]) => f.optional || fieldOk(f, stored[k])); };

function fieldOk(f, v) {
  if (f.kind === 'bool') return typeof v === 'boolean';
  if (typeof v !== 'string' || !v) return false;
  if (f.kind === 'url') return HTTPS.test(v) && v.length <= 300;
  if (f.kind === 'email') return EMAIL.test(v);
  return f.re ? f.re.test(v) : v.length <= 400;
}
const asBool = (v) => (v === true || v === 'true' || v === '1' || v === 1 ? true : v === false || v === 'false' || v === '0' || v === 0 ? false : null);

// { link } or { error, field }: body = the admin's fields, current = what Vault holds (object or null)
export function parseSecret(name, body, current) {
  const F = fieldsOf(name);
  if (!nameOk(name) || !F) return { error: 'unknown_secret' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid', field: 'fields' };
  for (const k of Object.keys(body)) if (!F[k]) return { error: 'invalid', field: k };
  const cur = current && typeof current === 'object' ? current : {};
  // a new host never receives the stored secrets (security review, 7 Nov): when the url changes, every secret field must come
  // with it in the same save — the stored ones are dropped, not merged
  const urlField = Object.keys(F).find((k) => F[k].kind === 'url');
  const newHost = urlField && typeof body[urlField] === 'string' && body[urlField].trim().replace(/\/+$/, '') !== String(cur[urlField] ?? '');
  const out = {};
  for (const [k, v] of Object.entries(cur)) if (F[k] && !(newHost && F[k].secret)) out[k] = v;
  for (const [k, f] of Object.entries(F)) {
    if (!(k in body)) continue; // omitted → stays
    let v = body[k];
    if (f.kind === 'bool') { const b = asBool(v); if (b === null && v !== '' && v !== null) return { error: 'invalid', field: k }; if (b === null) delete out[k]; else out[k] = b; continue; }
    v = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    if (v === '') { delete out[k]; continue; } // emptied → removed
    if (f.kind === 'url') v = v.replace(/\/+$/, '');
    if (!fieldOk(f, v)) return { error: 'invalid', field: k };
    out[k] = v;
  }
  for (const [k, f] of Object.entries(F)) if (!f.optional && !fieldOk(f, out[k])) return { error: 'missing', field: k };
  return { link: out };
}

export const tailOf = (v) => { const s = String(v ?? ''); return s.length >= 8 ? '••••' + s.slice(-4) : s ? '••••' : ''; };
// the shape the page may see: a secret field as its tail, a plain field as is, plus the meta (when linked, by whom, the last test)
export function secretPublic(name, stored, meta) {
  const F = fieldsOf(name); if (!F) return null;
  const fields = {};
  if (stored && typeof stored === 'object') for (const [k, f] of Object.entries(F)) if (k in stored) fields[k] = f.secret ? tailOf(stored[k]) : stored[k];
  return { name, fields, ready: linkReady(name, stored), linked_at: meta?.linked_at ?? null, linked_by: meta?.linked_by ?? null, test: meta?.test ?? null };
}

// The one read that proves a key works, as { method, url, headers, ok(status, body) → { account } | null } — or null for a platform
// with no safe probe (it is saved untested). Never a write. WooCommerce has two: the store (WC keys) and the media user (the app
// password) when it is set.
export function probesOf(name, link) {
  const L = link ?? {};
  const bearer = (k) => ({ Authorization: 'Bearer ' + L[k] });
  const basic = (u, p) => ({ Authorization: 'Basic ' + btoa(u + ':' + p) });
  const acct = (f) => (status, body) => (status >= 200 && status < 300 ? { account: safeText(f(body)) } : null);
  switch (name) {
    case 'woo': {
      const base = String(L.url ?? '').replace(/\/+$/, '');
      const out = [{ id: 'store', method: 'GET', url: base + '/wp-json/wc/v3/system_status?_fields=environment.site_url,environment.version,settings.currency', headers: basic(L.ck, L.cs),
        ok: acct((b) => [b?.environment?.site_url, b?.environment?.version ? 'WooCommerce ' + b.environment.version : '', b?.settings?.currency].filter(Boolean).join(' · ')) }];
      if (L.wp_user && L.wp_app_password) out.push({ id: 'media', method: 'GET', url: base + '/wp-json/wp/v2/users/me?context=edit&_fields=id,name,roles', headers: basic(L.wp_user, L.wp_app_password), ok: acct((b) => [b?.name, Array.isArray(b?.roles) ? b.roles.join(',') : ''].filter(Boolean).join(' · ')) });
      return out;
    }
    case 'anthropic': return [{ id: 'models', method: 'GET', url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': L.key, 'anthropic-version': '2023-06-01' }, ok: acct((b) => (Array.isArray(b?.data) ? b.data.length + ' موديل متاح' : 'ok')) }];
    case 'openai': return [{ id: 'models', method: 'GET', url: 'https://api.openai.com/v1/models', headers: bearer('key'), ok: acct((b) => (Array.isArray(b?.data) ? b.data.length + ' موديل متاح' : 'ok')) }];
    case 'gemini': return [{ id: 'models', method: 'GET', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': L.key }, ok: acct((b) => (Array.isArray(b?.models) ? 'ok' : 'ok')) }];
    case 'elevenlabs': return [{ id: 'user', method: 'GET', url: 'https://api.elevenlabs.io/v1/user/subscription', headers: { 'xi-api-key': L.key }, ok: acct((b) => [b?.tier, b?.character_limit != null ? b.character_limit + ' حرف' : ''].filter(Boolean).join(' · ')) }];
    case 'magnific_api': return [{ id: 'tasks', method: 'GET', url: 'https://api.magnific.com/v1/ai/text-to-image/seedream-v5-pro', headers: { 'x-magnific-api-key': L.key }, ok: acct(() => 'ok') }];
    case 'resend': return [{ id: 'domains', method: 'GET', url: 'https://api.resend.com/domains', headers: bearer('key'), ok: acct((b) => (Array.isArray(b?.data) ? b.data.map((d) => d?.name + (d?.status === 'verified' ? ' ✓' : ' (' + d?.status + ')')).join(' · ') : 'ok')) }];
    case 'airtable': return [{ id: 'whoami', method: 'GET', url: 'https://api.airtable.com/v0/meta/whoami', headers: bearer('key'), ok: acct((b) => b?.email ?? b?.id) }];
    case 'github': return [{ id: 'user', method: 'GET', url: 'https://api.github.com/user', headers: { ...bearer('key'), 'User-Agent': 'ibtekr-ops' }, ok: acct((b) => b?.login) }];
    case 'figma': return [{ id: 'me', method: 'GET', url: 'https://api.figma.com/v1/me', headers: { 'X-Figma-Token': L.key }, ok: acct((b) => b?.email ?? b?.handle) }];
    default: return null; // higgsfield / sheets / paymob / bosta / n8n / mcp_* / custom_*: saved untested
  }
}
const safeText = (v) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ok';

// a probe's HTTP status → our code
export const probeCode = (status) => (status === 401 || status === 403 ? 'unauthorized' : status === 404 ? 'not_found' : status === 429 ? 'rate' : status >= 500 ? 'provider' : status >= 400 ? 'refused' : 'ok');

// the display cards' catalogue (decision 5): every v6 card, which secret it uses and whether the system uses it yet
export const CARDS = Object.freeze([
  { id: 'woo', kind: 'site', name: 'WooCommerce', secret: 'woo', used: true },
  { id: 'airtable', kind: 'site', name: 'Airtable', secret: 'airtable', used: false },
  { id: 'wa', kind: 'social', name: 'WhatsApp Business', secret: null, used: true },
  { id: 'messenger', kind: 'social', name: 'Meta (فيسبوك + ماسنجر)', secret: null, used: true },
  { id: 'instagram', kind: 'social', name: 'Instagram', secret: null, used: true },
  { id: 'tiktok', kind: 'social', name: 'TikTok', secret: null, used: false },
  { id: 'sheets', kind: 'site', name: 'Google Sheets', secret: 'sheets', used: false },
  { id: 'paymob', kind: 'site', name: 'Paymob', secret: 'paymob', used: false },
  { id: 'bosta', kind: 'site', name: 'بوسطة', secret: 'bosta', used: false },
  { id: 'n8n', kind: 'site', name: 'n8n', secret: 'n8n', used: false },
  { id: 'metaads', kind: 'ads', name: 'Meta Ads (إعلانات)', secret: null, used: true },
  { id: 'googleads', kind: 'ads', name: 'Google Ads', secret: null, used: true },
  { id: 'tiktokads', kind: 'ads', name: 'TikTok Ads', secret: null, used: true },
  { id: 'magnific', kind: 'ai', name: 'Magnific', secret: 'magnific_api', used: true },
  { id: 'github', kind: 'site', name: 'GitHub + Staging', secret: 'github', used: false },
  { id: 'claude', kind: 'ai', name: 'Claude (Anthropic)', secret: 'anthropic', used: true },
  { id: 'openai', kind: 'ai', name: 'ChatGPT (OpenAI)', secret: 'openai', used: true },
  { id: 'gemini', kind: 'ai', name: 'Gemini (Google)', secret: 'gemini', used: true },
  { id: 'elevenlabs', kind: 'ai', name: 'ElevenLabs', secret: 'elevenlabs', used: true },
  { id: 'higgsfield', kind: 'ai', name: 'Higgsfield', secret: 'higgsfield', used: true },
  { id: 'resend', kind: 'site', name: 'Resend (إيميل)', secret: 'resend', used: true },
  { id: 'figma', kind: 'ai', name: 'Figma', secret: 'figma', used: false }]);
