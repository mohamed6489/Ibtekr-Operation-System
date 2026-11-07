// mkt-ads's pure part (phase 9.5.3, decisions 43 / 48): the Meta Marketing API's answers (read-only — the ad account, its campaigns
// and ads, the daily insights per campaign and per ad) → the rows of mkt_ad_objects and mkt_ad_stats. Nothing here writes on Meta.
// The token is the owner's System User token (ads_read) in the function's secrets; it never reaches a row or a log.
import { GRAPH } from './cs-channel.js';
import { cairoParts } from './mkt-publish.js';

export const SYNC_DAYS = 3; // an hourly run re-reads the last three days (Meta settles its numbers late)
export const FIRST_DAYS = 90; // the first run, with no numbers yet
export const MAX_DAYS = 400;
export const MAX_PAGES = 25; // the pages followed per list (a page is up to 500 rows; insights 100)
export const CHUNK_DAYS = 7; // the insights are asked a week at a time: 90 days × every ad in one query made Meta answer «reduce the amount of data» (the first live run, 7 Nov)
export const PURCHASE_TYPES = Object.freeze(['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const enc = encodeURIComponent;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }; // missing ≠ 0
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const idOf = (v) => (typeof v === 'string' || typeof v === 'number') && /^[0-9]{1,30}$/.test(String(v)) ? String(v) : null;
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
const statusOf = (v) => (typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v) ? v : null);
const httpsOf = (v, max) => (typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v) && v.length <= max ? v : null);
const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// the account id as the owner may paste it: «act_123…» or the digits
export const accountOf = (v) => { const m = String(v ?? '').trim().match(/^(?:act_)?([0-9]{1,30})$/); return m ? m[1] : null; };

const INSIGHT_FIELDS = {
  campaign: 'campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,action_values,date_start',
  ad: 'ad_id,ad_name,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,action_values,date_start',
};
export const path = {
  account: (a) => GRAPH + '/act_' + a + '?fields=' + enc('name,currency,timezone_name,account_status'),
  campaigns: (a) => GRAPH + '/act_' + a + '/campaigns?fields=' + enc('id,name,effective_status,objective') + '&limit=500',
  ads: (a) => GRAPH + '/act_' + a + '/ads?fields=' + enc('id,name,campaign_id,effective_status,creative{thumbnail_url}') + '&limit=500',
  insights: (a, level, since, until) => GRAPH + '/act_' + a + '/insights?level=' + level + '&time_increment=1&time_range=' + enc(JSON.stringify({ since, until }))
    + '&fields=' + enc(INSIGHT_FIELDS[level]) + '&limit=100',
};
// the next page of a list — Meta's own link only (never a host from the answer)
export function nextOf(json) {
  const u = isObj(json) && isObj(json.paging) ? json.paging.next : null;
  return typeof u === 'string' && u.startsWith('https://graph.facebook.com/') && u.length <= 4000 ? u : null;
}
// the days to read: the last `days` days ending today (Cairo's), at most MAX_DAYS
export function windowOf(nowMs, days) {
  const n = Math.max(1, Math.min(MAX_DAYS, Math.round(Number(days) || SYNC_DAYS)));
  const until = cairoParts(nowMs).day; const since = cairoParts(nowMs - (n - 1) * 86400_000).day;
  return { since, until, days: n };
}
// a window cut into pieces of at most CHUNK_DAYS days, the oldest first: [{ since, until }]
export function windowChunks(since, until, days) {
  const n = Math.max(1, Math.round(Number(days) || CHUNK_DAYS)); const out = [];
  const d = (s) => new Date(s + 'T00:00:00Z'); const iso = (t) => t.toISOString().slice(0, 10);
  for (let a = d(since); a <= d(until); a = new Date(a.getTime() + n * 86400_000)) {
    const b = new Date(Math.min(a.getTime() + (n - 1) * 86400_000, d(until).getTime())); out.push({ since: iso(a), until: iso(b) });
  }
  return out;
}
// Meta's purchases of a row: the first type present of omni_purchase › purchase › the pixel's (never summed — one purchase is
// reported under several types), and its value from action_values of the same type
export function purchasesOf(actions, values) {
  const pick = (list) => { const arr = Array.isArray(list) ? list.filter(isObj) : []; for (const t of PURCHASE_TYPES) { const x = arr.find((a) => a.action_type === t); if (x) return { type: t, v: num(x.value) ?? 0 }; } return null; };
  const p = pick(actions); if (!p) return { purchases: 0, value: 0 };
  const v = (Array.isArray(values) ? values.filter(isObj) : []).find((a) => a.action_type === p.type);
  return { purchases: p.v, value: v ? num(v.value) ?? 0 : 0 };
}
// one insights row (a day × a campaign or an ad) → a mkt_ad_stats row, or null when it is not one
export function statRowOf(x, level) {
  if (!isObj(x) || (level !== 'campaign' && level !== 'ad')) return null;
  const campaign = idOf(x.campaign_id); const obj = level === 'ad' ? idOf(x.ad_id) : campaign; const day = dayOf(x.date_start);
  if (!campaign || !obj || !day) return null;
  const { purchases, value } = purchasesOf(x.actions, x.action_values);
  return { platform: 'meta', level, object_id: obj, campaign_id: campaign, day, spend: Math.round((num(x.spend) ?? 0) * 100) / 100,
    impressions: int(x.impressions) ?? 0, reach: int(x.reach), clicks: int(x.clicks) ?? 0, link_clicks: int(x.inline_link_clicks),
    frequency: num(x.frequency) == null ? null : Math.round(num(x.frequency) * 1000) / 1000, purchases, purchase_value: Math.round(value * 100) / 100 };
}
// a campaign / an ad / the account → a mkt_ad_objects row, or null
export function objectRowOf(kind, x, parentId) {
  if (!isObj(x)) return null; const id = idOf(x.id); if (!id) return null;
  if (kind === 'campaign') return { platform: 'meta', kind, id, parent_id: idOf(parentId), name: text(x.name, 300), status: statusOf(x.effective_status), thumb: null, meta: { objective: statusOf(x.objective) } };
  if (kind === 'ad') return { platform: 'meta', kind, id, parent_id: idOf(x.campaign_id), name: text(x.name, 300), status: statusOf(x.effective_status),
    thumb: httpsOf(isObj(x.creative) ? x.creative.thumbnail_url : null, 2000), meta: {} };
  return null;
}
// Meta's account_status → ours
const ACCOUNT_STATUS = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED' };
// the account row: its name, currency and status, the last run — synced_at on success; a failure keeps the last success and the
// name it had (prev = the stored row) and says our code in error
export function accountRowOf(accountId, json, at, error, prev) {
  const a = isObj(json) ? json : {}; const p = isObj(prev) ? prev : {}; const pm = isObj(p.meta) ? p.meta : {};
  return { platform: 'meta', kind: 'account', id: accountId, parent_id: null, name: text(a.name, 300) ?? p.name ?? null,
    status: ACCOUNT_STATUS[Number(a.account_status)] ?? (a.account_status != null ? 'OTHER' : p.status ?? null), thumb: null,
    meta: { currency: text(a.currency, 8) ?? pm.currency ?? null, timezone: text(a.timezone_name, 60) ?? pm.timezone ?? null,
      synced_at: error ? pm.synced_at ?? null : at, checked_at: at, error: error || null } };
}
