// The ad platforms' links as the admin writes them from the page (phase 9.5.6, decision 67): the fields a platform takes, what is a
// secret (kept in Vault, shown back as its last four characters only), and what a platform needs before it can be read. No I/O here.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const digits = (v) => { const s = String(v ?? '').replace(/[\s-]/g, ''); return /^[0-9]{1,30}$/.test(s) ? s : null; };

export const PLATFORMS = Object.freeze(['meta', 'tiktok', 'google']);
export const PLATFORM_AR = Object.freeze({ meta: 'ميتا', tiktok: 'تيك توك', google: 'جوجل' });
// a field: secret (Vault, never shown back), id (digits — dashes and spaces dropped), re (a shape), min / max (length); optional = not needed to read
export const LINK_FIELDS = Object.freeze({
  meta: {
    access_token: { secret: true, min: 20, max: 1000, label: 'مفتاح القراية (System User token)' },
    account_id: { id: true, prefix: 'act_', label: 'رقم حساب الإعلانات (act_…)' },
  },
  tiktok: {
    app_id: { re: /^[0-9]{5,30}$/, label: 'App ID (TikTok for Business)' },
    secret: { secret: true, min: 10, max: 300, label: 'App Secret' },
    access_token: { secret: true, min: 10, max: 500, optional: true, label: 'Access Token (بالإيد — بدل زرار الربط)' },
    advertiser_id: { id: true, optional: true, label: 'Advertiser ID' },
  },
  google: {
    developer_token: { secret: true, min: 10, max: 120, label: 'Developer token (Google Ads API Center)' },
    client_id: { re: /^[A-Za-z0-9._-]{10,200}$/, label: 'OAuth Client ID' },
    client_secret: { secret: true, min: 10, max: 300, label: 'OAuth Client secret' },
    login_customer_id: { id: true, optional: true, label: 'Login customer ID (حساب MCC — اختياري)' },
    refresh_token: { secret: true, min: 20, max: 600, optional: true, label: 'Refresh token (بالإيد — بدل زرار الربط)' },
    customer_id: { id: true, optional: true, label: 'Customer ID (حساب الإعلانات)' },
    version: { re: /^v[0-9]{1,3}$/, optional: true, label: 'إصدار Google Ads API' },
  },
});
// what a platform needs before a run can read it
const NEEDS = Object.freeze({ meta: ['access_token', 'account_id'], tiktok: ['access_token', 'advertiser_id'], google: ['developer_token', 'client_id', 'client_secret', 'refresh_token', 'customer_id'] });
// what the OAuth start needs (the app / client the admin registered)
export const OAUTH_NEEDS = Object.freeze({ tiktok: ['app_id', 'secret'], google: ['client_id', 'client_secret', 'developer_token'] });

export const platformOf = (v) => (PLATFORMS.includes(v) ? v : null);
export const SECRET_KEYS = Object.freeze(Object.fromEntries(PLATFORMS.map((p) => [p, Object.keys(LINK_FIELDS[p]).filter((k) => LINK_FIELDS[p][k].secret)])));

// one field's value as the admin typed it → the stored value, or { error }; '' = none
export function fieldValue(platform, key, raw) {
  const f = LINK_FIELDS[platform] && LINK_FIELDS[platform][key]; if (!f) return { error: key };
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== 'string') return { error: key };
  let v = raw.trim(); if (!v) return { value: null };
  if (f.id) { if (f.prefix && v.startsWith(f.prefix)) v = v.slice(f.prefix.length); const d = digits(v); if (!d) return { error: key }; return { value: d }; }
  if (/[\u0000-\u001f\u007f\s]/.test(v)) return { error: key };
  if (f.re && !f.re.test(v)) return { error: key };
  if (f.min && v.length < f.min) return { error: key };
  if (f.max && v.length > f.max) return { error: key };
  return { value: v };
}
// the admin's body over the stored link: a field given replaces the stored one ('' or null = removed), a field left out stays
// → { link } (the fields that have a value) or { error: field }
export function parseLink(platform, body, current) {
  const p = platformOf(platform); if (!p) return { error: 'platform' };
  const b = isObj(body) ? body : {}; const cur = isObj(current) ? current : {}; const out = {};
  for (const key of Object.keys(LINK_FIELDS[p])) {
    if (!(key in b)) { if (cur[key] != null && cur[key] !== '') out[key] = String(cur[key]); continue; }
    const r = fieldValue(p, key, b[key]); if ('error' in r) return r;
    if (r.value != null) out[key] = r.value;
  }
  for (const key of Object.keys(b)) if (!(key in LINK_FIELDS[p])) return { error: key };
  return { link: out };
}
// the fields a run needs are all there
export const linkReady = (platform, link) => !!platformOf(platform) && NEEDS[platform].every((k) => isObj(link) && typeof link[k] === 'string' && link[k].length > 0);
export const oauthReady = (platform, link) => !!OAUTH_NEEDS[platform] && OAUTH_NEEDS[platform].every((k) => isObj(link) && typeof link[k] === 'string' && link[k].length > 0);
// what the page may see: a secret as its last four characters, the rest as it is
export const tailOf = (v) => (typeof v === 'string' && v ? '••••' + v.slice(-4) : null);
export function linkPublic(platform, link) {
  const p = platformOf(platform); if (!p) return null;
  const l = isObj(link) ? link : {}; const fields = {};
  for (const [key, f] of Object.entries(LINK_FIELDS[p])) { const v = l[key]; if (typeof v !== 'string' || !v) continue; fields[key] = f.secret ? tailOf(v) : v; }
  return { platform: p, fields, ready: linkReady(p, l), oauth: oauthReady(p, l), missing: NEEDS[p].filter((k) => !(typeof l[k] === 'string' && l[k])) };
}
// the account id a platform's link reads (for the rows)
export const linkAccount = (platform, link) => (isObj(link) ? link[platform === 'meta' ? 'account_id' : platform === 'tiktok' ? 'advertiser_id' : 'customer_id'] ?? null : null);
