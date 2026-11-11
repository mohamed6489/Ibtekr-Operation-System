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
  campaigns: (a) => GRAPH + '/act_' + a + '/campaigns?fields=' + enc('id,name,effective_status,objective,daily_budget,lifetime_budget') + '&limit=500',
  // 9.5.4: the budgets (minor units) and the writes of a decision — the object's own node
  accountAdsets: (a) => GRAPH + '/act_' + a + '/adsets?fields=' + enc('id,campaign_id,daily_budget,effective_status') + '&limit=500',
  campaignAdsets: (id) => GRAPH + '/' + id + '/adsets?fields=' + enc('id,daily_budget,effective_status') + '&limit=100',
  node: (id) => GRAPH + '/' + id,
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
  if (kind === 'campaign') return { platform: 'meta', kind, id, parent_id: idOf(parentId), name: text(x.name, 300), status: statusOf(x.effective_status), thumb: null,
    meta: { objective: statusOf(x.objective), daily_budget: num(x.daily_budget) == null ? null : Math.round(num(x.daily_budget)) / 100, lifetime_budget: num(x.lifetime_budget) == null ? null : Math.round(num(x.lifetime_budget)) / 100 } };
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

// ---------------------------------------------------------------- 9.5.4: the media buyer (decisions 49–52)

// the prototype's rules and limits; settings «marketing».buyer (the admin's) over them — mkt_buyer_rules() does the same on the server
export const BUYER_DEFAULTS = Object.freeze({ dailyCap: 5000, maxCpa: 450, autoStop: 1500, autoStopMode: 'suggest', reportHour: 9, live: false, notes: Object.freeze([]) });
// the admin's written rules (the v6 prototype's «+ قاعدة جديدة», owner 11 Nov): text the buyer's chat reads as guidance — nothing runs
// from them; at most 20, a title (1–80) + details (1–300) + a kind; no control characters and no angle brackets (they go into a prompt)
export const NOTE_KINDS = Object.freeze(['حد', 'هدف', 'قاعدة', 'تقرير']);
export const NOTES_MAX = 20;
const noteText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '');
function noteOf(x) {
  if (!isObj(x)) return null; const title = noteText(x.title, 81); const details = noteText(x.details, 301);
  if (!title || title.length > 80 || !details || details.length > 300 || !NOTE_KINDS.includes(x.kind)) return null;
  return { title, details, kind: x.kind };
}
const notesOf = (v) => (Array.isArray(v) ? v.slice(0, NOTES_MAX).map(noteOf).filter(Boolean) : []);
export const MAX_STEP = 30; // a budget step at most 30% at a time
export const SUGGEST_DAYS = 7; // the window the suggestions look at
export const STOP_DAYS = 5;
const nz = (v) => num(v) ?? 0;
const money = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : d; };
export function buyerRules(json) {
  const j = isObj(json) ? json : {};
  return { dailyCap: Math.max(100, money(j.dailyCap, BUYER_DEFAULTS.dailyCap)), maxCpa: Math.max(1, money(j.maxCpa, BUYER_DEFAULTS.maxCpa)),
    autoStop: Math.max(100, money(j.autoStop, BUYER_DEFAULTS.autoStop)), autoStopMode: j.autoStopMode === 'auto' ? 'auto' : 'suggest',
    reportHour: Number.isInteger(j.reportHour) && j.reportHour >= 0 && j.reportHour <= 23 ? j.reportHour : BUYER_DEFAULTS.reportHour, live: j.live === true, notes: notesOf(j.notes) };
}
// the rules a member may set (the admin): the numbers and the modes only — never `live` (its own action)
export function rulesPatch(body) {
  const b = isObj(body) ? body : {}; const out = {};
  for (const k of ['dailyCap', 'maxCpa', 'autoStop']) if (b[k] !== undefined) { const n = Number(b[k]); if (!Number.isFinite(n) || n < (k === 'maxCpa' ? 1 : 100) || n > 10_000_000) return { error: k }; out[k] = Math.round(n); }
  if (b.autoStopMode !== undefined) { if (b.autoStopMode !== 'auto' && b.autoStopMode !== 'suggest') return { error: 'autoStopMode' }; out.autoStopMode = b.autoStopMode; }
  if (b.reportHour !== undefined) { const n = Number(b.reportHour); if (!Number.isInteger(n) || n < 0 || n > 23) return { error: 'reportHour' }; out.reportHour = n; }
  if (b.notes !== undefined) { // the whole list each time (add / edit / delete on the page)
    if (!Array.isArray(b.notes) || b.notes.length > NOTES_MAX) return { error: 'notes' };
    const L = b.notes.map(noteOf); if (L.some((x) => !x)) return { error: 'notes' }; out.notes = L;
  }
  return { patch: out };
}
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const inWin = (d, from, to) => d >= from && d <= to;
// the buyer's suggestions of today (decision 49), from the stored rows: campaigns (mkt_ad_objects kind campaign / ad), the daily
// numbers (mkt_ad_stats, both levels, the last 14 days), the Woo ad orders ({ day, campaign, sold, confirmed, sales } — sold false = cancelled;
// confirmed = confirmed by the team or completed — the only orders a budget raise counts);
// one row a (kind × campaign [× ad]) — the caller keeps one open at a time
export function suggestionsOf({ objects, stats, orders, today, rules }) {
  const R = buyerRules(rules); const out = [];
  const camps = {}, ads = {};
  for (const o of Array.isArray(objects) ? objects : []) { if (!o) continue; if (o.kind === 'campaign') camps[o.id] = o; else if (o.kind === 'ad') ads[o.id] = o; }
  const from7 = addDays(today, -(SUGGEST_DAYS - 1)), from5 = addDays(today, -(STOP_DAYS - 1)), prevFrom = addDays(from7, -SUGGEST_DAYS), prevTo = addDays(from7, -1);
  const c = {}; // campaign → { spend7, purchases7, spend5, orders7, orders5, sure7, sales7 } — sure7 / sales7 = the confirmed (or completed) orders only
  const row = (id) => c[id] || (c[id] = { spend7: 0, purchases7: 0, spend5: 0, orders7: 0, orders5: 0, sure7: 0, sales7: 0 });
  for (const s of Array.isArray(stats) ? stats : []) {
    if (!s || s.level !== 'campaign') continue;
    if (inWin(s.day, from7, today)) { const r = row(s.object_id); r.spend7 += nz(s.spend); r.purchases7 += nz(s.purchases); }
    if (inWin(s.day, from5, today)) row(s.object_id).spend5 += nz(s.spend);
  }
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !o.sold || !camps[o.campaign] && !c[o.campaign]) continue;
    if (inWin(o.day, from7, today)) { const r = row(o.campaign); r.orders7 += 1; if (o.confirmed) { r.sure7 += 1; r.sales7 += nz(o.sales); } }
    if (inWin(o.day, from5, today)) row(o.campaign).orders5 += 1;
  }
  const name = (id) => (camps[id] && camps[id].name) || '#' + id;
  const active = (id) => !!camps[id] && camps[id].status === 'ACTIVE';
  const budgetOf = (id) => { const m = camps[id] && isObj(camps[id].meta) ? camps[id].meta : {}; const b = Number(m.daily_budget); return Number.isFinite(b) && b > 0 ? b : null; };
  for (const [id, r] of Object.entries(c)) {
    const spend7 = Math.round(r.spend7 * 100) / 100; const cpa = r.orders7 ? r.spend7 / r.orders7 : null; const budget = budgetOf(id);
    const data = { spend: spend7, purchases: r.purchases7, orders: r.orders7, cpa: cpa == null ? null : Math.round(cpa), spend5: Math.round(r.spend5), orders5: r.orders5, daily_budget: budget };
    if (active(id) && r.spend5 >= R.autoStop && r.orders5 === 0) {
      out.push({ kind: 'stop', campaign_id: id, campaign_name: name(id), title: 'وقّف «' + name(id) + '»', sub: 'صرفت ' + fmt(r.spend5) + ' ج.م · 0 أوردر في ووكومرس من ' + STOP_DAYS + ' أيام',
        why: 'ميتا بتحسب ' + fmt(r.purchases7) + ' مشتريات في الأسبوع، بس مفيش ولا أوردر في ووكومرس جاي من الحملة دي (utm_campaign) من ' + STOP_DAYS + ' أيام.',
        impact: 'توفير ~' + fmt(r.spend5 / STOP_DAYS) + ' ج.م/يوم', pct: null, data });
      continue; // stop outranks a budget change on the same campaign
    }
    if (active(id) && r.orders7 >= 3 && cpa != null && cpa > R.maxCpa) {
      out.push({ kind: 'budget_down', campaign_id: id, campaign_name: name(id), title: 'قلّل ميزانية «' + name(id) + '» 30%', sub: 'تكلفة الأوردر الحقيقية ' + fmt(cpa) + ' ج.م أعلى من الحد ' + fmt(R.maxCpa),
        why: 'صرفت ' + fmt(spend7) + ' ج.م وجابت ' + r.orders7 + ' أوردر في ووكومرس في 7 أيام — تكلفة الأوردر ' + fmt(cpa) + ' ج.م والحد المقبول ' + fmt(R.maxCpa) + '.',
        impact: budget ? 'توفير ~' + fmt(budget * 0.3) + ' ج.م/يوم' : 'توفير ~' + fmt(spend7 / SUGGEST_DAYS * 0.3) + ' ج.م/يوم', pct: -30, data });
    } else if (active(id) && r.sure7 >= 5 && spend7 > 0) {
      // a raise (money) counts the confirmed or completed orders only — an unconfirmed order anyone can place with the campaign's UTM
      // never scales a budget; the real return = their Woo sales ÷ spend
      const mer = r.sales7 / spend7;
      if (mer >= 4) out.push({ kind: 'budget_up', campaign_id: id, campaign_name: name(id), title: 'زوّد «' + name(id) + '» 20%', sub: 'العائد الحقيقي ' + mer.toFixed(2) + '× · ' + r.sure7 + ' أوردر مؤكد في ووكومرس',
        why: 'من أعلى عائد حقيقي في الحملات (' + mer.toFixed(2) + '× على الأوردرات المؤكدة) وتكلفة الأوردر ' + fmt(cpa) + ' ج.م.', impact: 'متوقع +' + Math.max(1, Math.round(r.sure7 * 0.2)) + ' أوردرات/أسبوع', pct: 20, data: { ...data, confirmed: r.sure7, mer: Math.round(mer * 100) / 100 } });
    }
    if (r.purchases7 >= 5 && r.purchases7 >= 2 * r.orders7) {
      out.push({ kind: 'tracking', campaign_id: id, campaign_name: name(id), title: 'فرق كبير في أرقام «' + name(id) + '»', sub: 'ميتا بتقول ' + fmt(r.purchases7) + ' مشتريات · ووكومرس ' + r.orders7 + ' أوردر',
        why: 'ممكن البكسل بيعد مرتين أو الـ UTM مش متحط على كل الإعلانات.', impact: 'راجع التتبع', pct: null, data });
    }
  }
  // the creatives: an active ad seen too often (frequency ≥ 4 over the week) or whose CTR fell by 40% against the week before
  const a = {};
  for (const s of Array.isArray(stats) ? stats : []) {
    if (!s || s.level !== 'ad') continue;
    const r = a[s.object_id] || (a[s.object_id] = { campaign: s.campaign_id, imp: 0, clicks: 0, fw: 0, pimp: 0, pclicks: 0, spend: 0 });
    if (inWin(s.day, from7, today)) { r.imp += nz(s.impressions); r.clicks += nz(s.link_clicks != null ? s.link_clicks : s.clicks); r.fw += nz(s.frequency) * nz(s.impressions); r.spend += nz(s.spend); }
    else if (inWin(s.day, prevFrom, prevTo)) { r.pimp += nz(s.impressions); r.pclicks += nz(s.link_clicks != null ? s.link_clicks : s.clicks); }
  }
  for (const [id, r] of Object.entries(a)) {
    const o = ads[id]; if (!o || o.status !== 'ACTIVE' || r.imp < 1000) continue;
    const freq = r.fw / r.imp; const ctr = r.clicks / r.imp; const pctr = r.pimp >= 1000 ? r.pclicks / r.pimp : null;
    const tired = freq >= 4; const fell = pctr != null && pctr > 0 && ctr <= pctr * 0.6;
    if (!tired && !fell) continue;
    const adName = o.name || '#' + id; const camp = r.campaign;
    out.push({ kind: 'creative', campaign_id: camp, campaign_name: name(camp), ad_id: id, title: 'إعلان «' + adName + '» الناس زهقت منه',
      sub: (tired ? 'التكرار ' + freq.toFixed(1) : 'النقرات نزلت ' + Math.round((1 - ctr / pctr) * 100) + '% في 7 أيام') + ' · اطلب نسخة من الديزاينر',
      why: 'التكرار ' + freq.toFixed(1) + (pctr != null ? ' والنقرات (CTR) ' + (ctr * 100).toFixed(2) + '% بعد ' + (pctr * 100).toFixed(2) + '%' : '') + '.', impact: 'نسخة جديدة من الديزاينر', pct: null,
      data: { spend: Math.round(r.spend * 100) / 100, frequency: Math.round(freq * 100) / 100, ctr: Math.round(ctr * 10000) / 10000, prev_ctr: pctr == null ? null : Math.round(pctr * 10000) / 10000 } });
  }
  return out;
}
// the suggestion's key — one open row a kind × campaign × ad
export const suggestionKey = (s) => s.kind + '|' + s.campaign_id + '|' + (s.ad_id || '');

// a budget step (decision 50): Meta's minor units → the account's money; the step at most MAX_STEP, the account's daily total after it
// at most the cap. current: { campaign: { daily_budget }, adsets: [{ id, daily_budget, status }] } (budgets in minor units);
// otherDaily: the rest of the account's active daily budgets (money). Returns { updates: [{ id, daily_budget }], before, after } or { error }.
export function budgetPlan(current, pct, rules, otherDaily) {
  const R = buyerRules(rules); const p = Number(pct);
  if (!Number.isFinite(p) || p === 0 || Math.abs(p) > MAX_STEP) return { error: 'step', max: MAX_STEP };
  const cur = isObj(current) ? current : {}; const camp = isObj(cur.campaign) ? cur.campaign : {};
  const targets = [];
  if (Number(camp.daily_budget) > 0) targets.push({ id: String(camp.id ?? ''), daily_budget: Number(camp.daily_budget) });
  else for (const s of Array.isArray(cur.adsets) ? cur.adsets : []) if (isObj(s) && Number(s.daily_budget) > 0 && (s.status === 'ACTIVE' || s.effective_status === 'ACTIVE')) targets.push({ id: String(s.id), daily_budget: Number(s.daily_budget) });
  if (!targets.length) return { error: 'no_daily_budget' };
  const before = targets.reduce((s, t) => s + t.daily_budget, 0) / 100;
  const updates = targets.map((t) => ({ id: t.id, daily_budget: Math.max(100, Math.round(t.daily_budget * (1 + p / 100))) }));
  const after = updates.reduce((s, t) => s + t.daily_budget, 0) / 100;
  if (p > 0 && (Number(otherDaily) || 0) + after > R.dailyCap) return { error: 'cap', cap: R.dailyCap, after: Math.round(((Number(otherDaily) || 0) + after) * 100) / 100 };
  return { updates, before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100 };
}
// the account's active daily budgets (money) from the campaigns (CBO) and the ad sets with one, minus a campaign's own
export function accountDaily(campaigns, adsets, exceptCampaign) {
  let sum = 0;
  for (const c of Array.isArray(campaigns) ? campaigns : []) if (isObj(c) && c.effective_status === 'ACTIVE' && String(c.id) !== String(exceptCampaign)) sum += nz(c.daily_budget) / 100;
  for (const s of Array.isArray(adsets) ? adsets : []) if (isObj(s) && s.effective_status === 'ACTIVE' && String(s.campaign_id) !== String(exceptCampaign)) sum += nz(s.daily_budget) / 100;
  return Math.round(sum * 100) / 100;
}
// the daily report's words (decision 52): numbers only
export function reportText({ day, spend, orders, sales, pending }) {
  const mer = spend > 0 ? (sales / spend).toFixed(2) + '×' : '—';
  return { title: 'تقرير الميديا باير — ' + day, body: 'الصرف إمبارح ' + fmt(spend) + ' ج.م · ' + fmt(orders) + ' أوردر من الإعلانات (' + fmt(sales) + ' ج.م) · العائد الحقيقي ' + mer + ' · ' + fmt(pending) + ' اقتراح مستني موافقتك' };
}
