// mkt-ads's TikTok part (phase 9.5.6, decision 69): the TikTok Marketing API (v1.3, read-only) — the OAuth link, the advertiser, its
// campaigns and ads, the daily report per campaign and per ad → the rows of mkt_ad_objects and mkt_ad_stats (platform tiktok). The
// token (Access-Token header) is the owner's, from Vault; it never reaches a row or a log. No I/O here.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const enc = encodeURIComponent;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const idOf = (v) => (typeof v === 'string' || typeof v === 'number') && /^[0-9]{1,30}$/.test(String(v)) ? String(v) : null;
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
const statusOf = (v) => (typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v) ? v : null);

export const TT_API = 'https://business-api.tiktok.com/open_api/v1.3';
export const TT_AUTH = 'https://business-api.tiktok.com/portal/auth';
export const TT_PAGE = 1000; // rows a page (the API's most)
export const TT_MAX_PAGES = 20;
const REPORT_METRICS = { campaign: ['spend', 'impressions', 'reach', 'clicks', 'frequency', 'complete_payment', 'total_complete_payment_rate'], ad: ['campaign_id', 'spend', 'impressions', 'reach', 'clicks', 'frequency', 'complete_payment', 'total_complete_payment_rate'] };
export const ttPath = {
  auth: (appId, redirect, state) => TT_AUTH + '?app_id=' + enc(appId) + '&state=' + enc(state) + '&redirect_uri=' + enc(redirect),
  token: () => TT_API + '/oauth2/access_token/',
  advertisers: (appId, secret) => TT_API + '/oauth2/advertiser/get/?app_id=' + enc(appId) + '&secret=' + enc(secret),
  info: (ids) => TT_API + '/advertiser/info/?advertiser_ids=' + enc(JSON.stringify([].concat(ids).map(String))),
  campaigns: (adv, page) => TT_API + '/campaign/get/?advertiser_id=' + enc(adv) + '&page_size=' + TT_PAGE + '&page=' + (page || 1),
  ads: (adv, page) => TT_API + '/ad/get/?advertiser_id=' + enc(adv) + '&page_size=' + TT_PAGE + '&page=' + (page || 1),
  report: (adv, level, since, until, page) => TT_API + '/report/integrated/get/?advertiser_id=' + enc(adv) + '&report_type=BASIC&data_level=' + (level === 'ad' ? 'AUCTION_AD' : 'AUCTION_CAMPAIGN')
    + '&dimensions=' + enc(JSON.stringify([level === 'ad' ? 'ad_id' : 'campaign_id', 'stat_time_day'])) + '&metrics=' + enc(JSON.stringify(REPORT_METRICS[level === 'ad' ? 'ad' : 'campaign']))
    + '&start_date=' + since + '&end_date=' + until + '&page_size=' + TT_PAGE + '&page=' + (page || 1),
};
export const ttBody = { token: (appId, secret, code) => ({ app_id: appId, secret, auth_code: code }) };

// TikTok answers 200 with { code, message, data }; code 0 is success. Our code: token (the token invalid / expired / revoked),
// permission (no right on the advertiser), rate (too many calls), else tiktok_<code>
export function ttCode(code) {
  const c = Number(code);
  if ([40102, 40104, 40105, 40110, 40100].includes(c)) return c === 40100 ? 'rate' : 'token';
  if ([40001, 40002, 40003, 40107, 40108, 40113, 40117, 40118].includes(c)) return 'permission';
  if (c === 50002 || c === 51000) return 'rate';
  return 'tiktok_' + (Number.isFinite(c) ? c : 'error');
}
// an answer → { ok, data } or { ok: false, code, text } (the API's words cleaned, 200 characters — never a token)
export function ttAnswer(json) {
  const j = isObj(json) ? json : {}; const c = Number(j.code);
  if (c === 0) return { ok: true, data: isObj(j.data) ? j.data : {} };
  const t = typeof j.message === 'string' ? j.message.replace(/[^\w .,:;()#'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  return { ok: false, code: ttCode(j.code), text: t || null };
}
export const ttList = (data) => (isObj(data) && Array.isArray(data.list) ? data.list.filter(isObj) : []);
export const ttPages = (data) => { const n = isObj(data) && isObj(data.page_info) ? Number(data.page_info.total_page) : 1; return Number.isFinite(n) && n > 0 ? Math.min(n, TT_MAX_PAGES) : 1; };
// the OAuth token answer: the token and the advertiser ids the account may read
export function ttTokenOf(data) {
  const d = isObj(data) ? data : {}; const token = typeof d.access_token === 'string' && d.access_token.length >= 10 ? d.access_token : null;
  const ids = (Array.isArray(d.advertiser_ids) ? d.advertiser_ids : []).map(idOf).filter(Boolean);
  return token ? { token, advertisers: ids } : null;
}
// /oauth2/advertiser/get → [{ id, name }]
export const ttAdvertisersOf = (data) => ttList(data).map((a) => ({ id: idOf(a.advertiser_id), name: text(a.advertiser_name, 300) })).filter((a) => a.id);
// TikTok's operation statuses → ours
const OP = { ENABLE: 'ACTIVE', DISABLE: 'PAUSED', DELETE: 'DELETED' };
const statusMap = (op, secondary) => OP[String(op)] ?? statusOf(secondary) ?? statusOf(op);
export function ttObjectRowOf(kind, x) {
  if (!isObj(x)) return null;
  if (kind === 'campaign') {
    const id = idOf(x.campaign_id); if (!id) return null;
    const daily = x.budget_mode === 'BUDGET_MODE_DAY' ? num(x.budget) : null;
    return { platform: 'tiktok', kind, id, parent_id: null, name: text(x.campaign_name, 300), status: statusMap(x.operation_status, x.secondary_status), thumb: null,
      meta: { objective: statusOf(x.objective_type), daily_budget: daily == null ? null : Math.round(daily * 100) / 100, lifetime_budget: x.budget_mode === 'BUDGET_MODE_TOTAL' ? num(x.budget) : null, budget_mode: statusOf(x.budget_mode) } };
  }
  if (kind === 'ad') {
    const id = idOf(x.ad_id); if (!id) return null;
    return { platform: 'tiktok', kind, id, parent_id: idOf(x.campaign_id), name: text(x.ad_name, 300), status: statusMap(x.operation_status, x.secondary_status), thumb: null, meta: {} };
  }
  return null;
}
// the report rows: { dimensions: { campaign_id | ad_id, stat_time_day: 'YYYY-MM-DD 00:00:00' }, metrics: { … strings } }
export function ttStatRowOf(x, level) {
  if (!isObj(x) || (level !== 'campaign' && level !== 'ad')) return null;
  const d = isObj(x.dimensions) ? x.dimensions : {}; const m = isObj(x.metrics) ? x.metrics : {};
  const obj = idOf(level === 'ad' ? d.ad_id : d.campaign_id); const campaign = level === 'ad' ? idOf(m.campaign_id) : obj;
  const day = typeof d.stat_time_day === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.stat_time_day) ? d.stat_time_day.slice(0, 10) : null;
  if (!obj || !campaign || !day) return null;
  return { platform: 'tiktok', level, object_id: obj, campaign_id: campaign, day, spend: Math.round((num(m.spend) ?? 0) * 100) / 100,
    impressions: int(m.impressions) ?? 0, reach: int(m.reach), clicks: int(m.clicks) ?? 0, link_clicks: null,
    frequency: num(m.frequency) == null ? null : Math.round(num(m.frequency) * 1000) / 1000, purchases: num(m.complete_payment) ?? 0, purchase_value: Math.round((num(m.total_complete_payment_rate) ?? 0) * 100) / 100 };
}
const ADV_STATUS = { STATUS_ENABLE: 'ACTIVE', STATUS_DISABLE: 'DISABLED', STATUS_PENDING_CONFIRM: 'PENDING', STATUS_PENDING_VERIFIED: 'PENDING', STATUS_CONFIRM_FAIL: 'DISABLED', STATUS_LIMIT: 'LIMITED', STATUS_WAIT_FOR_BPM_AUDIT: 'PENDING', STATUS_WAIT_FOR_PUBLIC_AUTH: 'PENDING', STATUS_SELF_SERVICE_UNAUDITED: 'PENDING', STATUS_CONTRACT_PENDING: 'PENDING' };
// the account row (the advertiser): its name, currency and status, the last run — like Meta's accountRowOf
export function ttAccountRowOf(advId, info, at, error, prev) {
  const a = isObj(info) ? info : {}; const p = isObj(prev) ? prev : {}; const pm = isObj(p.meta) ? p.meta : {};
  return { platform: 'tiktok', kind: 'account', id: advId, parent_id: null, name: text(a.name, 300) ?? p.name ?? null,
    status: ADV_STATUS[String(a.status)] ?? (a.status != null ? 'OTHER' : p.status ?? null), thumb: null,
    meta: { currency: text(a.currency, 8) ?? pm.currency ?? null, timezone: text(a.timezone, 60) ?? pm.timezone ?? null, synced_at: error ? pm.synced_at ?? null : at, checked_at: at, error: error || null } };
}
