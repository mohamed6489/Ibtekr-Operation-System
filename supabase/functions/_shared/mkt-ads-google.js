// mkt-ads's Google part (phase 9.5.6, decision 69): the Google Ads API (GAQL through googleAds:search, read-only) — the OAuth link
// (a refresh token), the customer, its campaigns and ads, the daily numbers per campaign and per ad → the rows of mkt_ad_objects and
// mkt_ad_stats (platform google). The developer token, the OAuth client and the refresh token are the owner's, from Vault; the access
// token is minted a run at a time and kept in memory only. No I/O here.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const enc = encodeURIComponent;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const idOf = (v) => (typeof v === 'string' || typeof v === 'number') && /^[0-9]{1,30}$/.test(String(v)) ? String(v) : null;
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
const statusOf = (v) => (typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v) ? v : null);

export const G_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const G_TOKEN = 'https://oauth2.googleapis.com/token';
export const G_API = 'https://googleads.googleapis.com';
export const G_SCOPE = 'https://www.googleapis.com/auth/adwords';
export const G_VERSION = 'v21'; // settings «marketing».ads.google.version moves it (the API retires a version a year after it ships)
export const G_PAGE = 10000;
export const G_MAX_PAGES = 20;
export const gVersion = (v) => (typeof v === 'string' && /^v[0-9]{1,3}$/.test(v) ? v : G_VERSION);
// a customer id as the admin pastes it: digits, dashes dropped
export const customerIdOf = (v) => { const s = String(v ?? '').replace(/[\s-]/g, ''); return /^[0-9]{1,30}$/.test(s) ? s : null; };
export const gPath = {
  auth: (clientId, redirect, state) => G_AUTH + '?client_id=' + enc(clientId) + '&redirect_uri=' + enc(redirect) + '&response_type=code&scope=' + enc(G_SCOPE) + '&access_type=offline&prompt=consent&state=' + enc(state),
  token: () => G_TOKEN,
  accessible: (version) => G_API + '/' + gVersion(version) + '/customers:listAccessibleCustomers',
  search: (version, customer) => G_API + '/' + gVersion(version) + '/customers/' + enc(customer) + '/googleAds:search',
};
export const gBody = {
  token: (code, clientId, secret, redirect) => ({ code, client_id: clientId, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  refresh: (refreshToken, clientId, secret) => ({ refresh_token: refreshToken, client_id: clientId, client_secret: secret, grant_type: 'refresh_token' }),
  query: (gaql, pageToken) => ({ query: gaql, pageSize: G_PAGE, ...(pageToken ? { pageToken } : {}) }),
};
const day = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
// the GAQL queries (read-only)
export const gaql = {
  account: () => 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer',
  campaigns: () => 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != \'REMOVED\'',
  ads: () => 'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != \'REMOVED\'',
  campaignStats: (since, until) => 'SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN \'' + day(since) + '\' AND \'' + day(until) + '\' AND metrics.impressions > 0',
  adStats: (since, until) => 'SELECT ad_group_ad.ad.id, campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE segments.date BETWEEN \'' + day(since) + '\' AND \'' + day(until) + '\' AND metrics.impressions > 0',
};
// the HTTP status and body of a refusal → our code: token (401 / the OAuth refresh refused), permission (403 — the developer token
// not approved for this account, or no access), rate (429), else google_<status>
export function gCode(status, json) {
  const s = Number(status); const j = isObj(json) ? json : {};
  const st = isObj(j.error) ? String(j.error.status ?? '') : String(j.error ?? '');
  if (s === 401 || st === 'UNAUTHENTICATED' || st === 'invalid_grant' || st === 'invalid_client') return 'token';
  if (s === 403 || st === 'PERMISSION_DENIED') return 'permission';
  if (s === 429 || st === 'RESOURCE_EXHAUSTED') return 'rate';
  return 'google_' + (Number.isFinite(s) && s ? s : 'error');
}
// Google's own words of a refusal (letters, digits and plain punctuation, 200 characters) — never a token
export function gText(json) {
  const j = isObj(json) ? json : {}; const e = isObj(j.error) ? j.error : j;
  const d = Array.isArray(e.details) ? e.details.find(isObj) : null;
  const inner = d && Array.isArray(d.errors) && isObj(d.errors[0]) ? d.errors[0].message : null;
  const m = inner ?? e.message ?? e.error_description ?? null;
  return typeof m === 'string' ? m.replace(/[^\w .,:;()#'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
}
export const gResults = (json) => (isObj(json) && Array.isArray(json.results) ? json.results.filter(isObj) : []);
export const gNextPage = (json) => (isObj(json) && typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null);
// customers:listAccessibleCustomers → ['1234567890', …]
export const gCustomersOf = (json) => (isObj(json) && Array.isArray(json.resourceNames) ? json.resourceNames : []).map((r) => idOf(String(r).replace(/^customers\//, ''))).filter(Boolean);
// the OAuth token answer: the refresh token (first consent) and the access token
export function gTokenOf(json) {
  const j = isObj(json) ? json : {};
  return { access: typeof j.access_token === 'string' && j.access_token ? j.access_token : null, refresh: typeof j.refresh_token === 'string' && j.refresh_token.length >= 20 ? j.refresh_token : null };
}
const CAMP_STATUS = { ENABLED: 'ACTIVE', PAUSED: 'PAUSED', REMOVED: 'DELETED' };
export function gObjectRowOf(kind, r) {
  if (!isObj(r)) return null;
  if (kind === 'campaign') {
    const c = isObj(r.campaign) ? r.campaign : {}; const id = idOf(c.id); if (!id) return null;
    const micros = num(isObj(r.campaignBudget) ? r.campaignBudget.amountMicros : null);
    return { platform: 'google', kind, id, parent_id: null, name: text(c.name, 300), status: CAMP_STATUS[String(c.status)] ?? statusOf(c.status), thumb: null,
      meta: { objective: statusOf(c.advertisingChannelType), daily_budget: micros == null ? null : Math.round(micros / 10000) / 100, lifetime_budget: null } };
  }
  if (kind === 'ad') {
    const a = isObj(r.adGroupAd) ? r.adGroupAd : {}; const ad = isObj(a.ad) ? a.ad : {}; const id = idOf(ad.id); if (!id) return null;
    return { platform: 'google', kind, id, parent_id: idOf(isObj(r.campaign) ? r.campaign.id : null), name: text(ad.name, 300) ?? (statusOf(ad.type) ? statusOf(ad.type) + ' #' + id : '#' + id), status: CAMP_STATUS[String(a.status)] ?? statusOf(a.status), thumb: null, meta: { type: statusOf(ad.type) } };
  }
  return null;
}
// a search row with segments.date and metrics → a mkt_ad_stats row (the cost in micros → money; no reach, no frequency)
export function gStatRowOf(r, level) {
  if (!isObj(r) || (level !== 'campaign' && level !== 'ad')) return null;
  const campaign = idOf(isObj(r.campaign) ? r.campaign.id : null);
  const obj = level === 'ad' ? idOf(isObj(r.adGroupAd) && isObj(r.adGroupAd.ad) ? r.adGroupAd.ad.id : null) : campaign;
  const d = day(isObj(r.segments) ? r.segments.date : null); const m = isObj(r.metrics) ? r.metrics : {};
  if (!campaign || !obj || !d) return null;
  return { platform: 'google', level, object_id: obj, campaign_id: campaign, day: d, spend: Math.round((num(m.costMicros) ?? 0) / 10000) / 100,
    impressions: int(m.impressions) ?? 0, reach: null, clicks: int(m.clicks) ?? 0, link_clicks: null, frequency: null,
    purchases: Math.round((num(m.conversions) ?? 0) * 100) / 100, purchase_value: Math.round((num(m.conversionsValue) ?? 0) * 100) / 100 };
}
const CUST_STATUS = { ENABLED: 'ACTIVE', CANCELED: 'CLOSED', SUSPENDED: 'DISABLED', CLOSED: 'CLOSED' };
// the account row (the customer): its name, currency and status, the last run — like Meta's accountRowOf
export function gAccountRowOf(customerId, r, at, error, prev) {
  const c = isObj(r) && isObj(r.customer) ? r.customer : {}; const p = isObj(prev) ? prev : {}; const pm = isObj(p.meta) ? p.meta : {};
  return { platform: 'google', kind: 'account', id: customerId, parent_id: null, name: text(c.descriptiveName, 300) ?? p.name ?? null,
    status: CUST_STATUS[String(c.status)] ?? (c.status != null ? 'OTHER' : p.status ?? null), thumb: null,
    meta: { currency: text(c.currencyCode, 8) ?? pm.currency ?? null, timezone: text(c.timeZone, 60) ?? pm.timezone ?? null, synced_at: error ? pm.synced_at ?? null : at, checked_at: at, error: error || null } };
}
