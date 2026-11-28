// «التريندات من مصادر مجانية» (Safwat 28 Nov — «حط للمساعد مصادر للتريندات تكون مجانية بس عايزة اكونت» · «اعمل كل حاجة و خليهم
// واقفين علي اني اضيف حساب» · «كل يوم الصبح في الجرس» · «غذيهم باقوي منافسين محليين و دوليين في المصادر»; the plan
// docs/superpowers/plans/2026-11-28-trends-free.md). The pure part of mkt-publish `trends_free` / `trends_daily` — the free sources
// that only need an account, each read only and each skipped while its key is not linked:
//   · YouTube Data API (a Google Cloud key — «الربط بالمنصات › YouTube»; 10,000 units a day, a search costs 100): the videos and Shorts
//     of the last days for each keyword, by their views (Egypt for an Arabic word, the world for an English one);
//   · Google Trends through SerpApi (its free plan — 250 searches a month — «الربط بالمنصات › SerpApi»): what Egypt's searches around a
//     keyword rose by lately (its «rising» related queries);
//   · Instagram's Business Discovery through the page link customer service already holds (no new key): the competitors' last posts — an
//     instagram.com link in the designer's or the media buyer's sources, or a competitor's page link.
// Rows in mkt_trends' shape (0109 / 0118 / 0175). Nothing here talks to a provider or a database, and no key is ever in a row or a log.
import { igTrendRows, trendTags } from './mkt-trends.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const FREE_DAYS = 3; // «نتيجة اخر ٣ ايام» — the default window
export const FREE_DAYS_MAX = 30;
export const Q_MAX = 80;
export const KW_MAX = 4; // the keywords of one run (each is a YouTube search = 100 of the day's 10,000 units)
export const GT_MAX = 2; // … the ones Google Trends is asked about (the SerpApi free plan's 250 a month: a daily run is ≈ 60)
export const YT_PER_KW = 8;
export const GT_PER_KW = 6;
export const BD_MAX = 8; // the competitors' accounts read in one run
export const BD_MEDIA = 8;
export const SHOW_MAX = 12; // the rows a chat answer shows
export const CACHE_HOURS = 3; // a keyword read lately is answered from what is stored (no second search)
export const DAILY_HOUR = 9; // «كل يوم الصبح» — Cairo's hour the daily run starts at
// a day's searches at most, whatever the members ask (the free plans: YouTube 10,000 units a day — a search is 100; SerpApi 250 a
// month — the daily run takes 2 a day): over it the source says «الباقة خلصت النهارده» until tomorrow (Cairo's day)
export const YT_DAY_MAX = 60;
export const GT_DAY_MAX = 6;
export const GRAPH = 'https://graph.facebook.com/v21.0';
const YT = 'https://www.googleapis.com/youtube/v3';
const SERP = 'https://serpapi.com/search.json';
const ARABIC = /[؀-ۿ]/;

/** trends_free { q?, days? } → { req: { q, days } } | { error, field }: the words the member asked about (optional) and the window. */
export function parseFree(b) {
  if (!isObj(b)) return { error: 'bad_request', field: 'body' };
  if (b.q != null && typeof b.q !== 'string') return { error: 'bad_request', field: 'q' };
  if (/[<>]/.test(b.q ?? '')) return { error: 'bad_request', field: 'q' };
  const d = b.days == null ? FREE_DAYS : Number(b.days);
  if (!Number.isInteger(d) || d < 1 || d > FREE_DAYS_MAX) return { error: 'bad_request', field: 'days' };
  return { req: { q: line(b.q ?? '', Q_MAX), days: d } };
}

// the business's own words and their English — an Arabic word is searched in Egypt, its English in the world
export const ALIAS = Object.freeze({ 'مكرمية': 'macrame', 'ماكرامية': 'macrame', 'ماكرميه': 'macrame', 'مكرميه': 'macrame', 'هاندميد': 'handmade', 'هاند ميد': 'handmade',
  'كروشيه': 'crochet', 'ديكور': 'home decor', 'شموع': 'candles', 'ريزن': 'resin art', 'فخار': 'pottery', 'سيراميك': 'ceramics', 'خزف': 'ceramics',
  'اكسسوارات': 'accessories', 'إكسسوارات': 'accessories', 'بوهو': 'boho decor', 'بوهيمي': 'boho decor', 'سجاد': 'rugs', 'كليم': 'kilim', 'تطريز': 'embroidery',
  'جلد': 'leather goods', 'خشب': 'woodwork', 'رسم': 'wall art', 'لوحات': 'wall art', 'هدايا': 'gift ideas', 'شنط': 'handmade bags', 'مجوهرات': 'handmade jewelry' });
// a word as the system keeps it: no «ال» before it, the letters the people spell two ways made one
export const normWord = (w) => String(w ?? '').trim().replace(/^#+/, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة(?=\s|$)/g, 'ه').replace(/^ال(?=\S{3,})/, '').replace(/\s+/g, ' ').toLowerCase();
const ALIAS_N = Object.fromEntries(Object.entries(ALIAS).map(([k, v]) => [normWord(k), v]));
/**
 * The keywords of a run: the member's words (with their English, when the business knows it), else the admin's tags (settings
 * «marketing».trends.tags) — each base word first, then the English ones; KW_MAX at most, each once.
 */
export function keywordsOf(q, tags) {
  const base = q ? [line(q, Q_MAX)] : trendTags(tags).map((t) => t.replace(/_/g, ' '));
  const words = base.map((w) => w.replace(/^ال(?=\S{3,})/, '').trim()).filter(Boolean);
  const en = words.map((w) => ALIAS_N[normWord(w)]).filter(Boolean);
  const out = [];
  for (const w of [...words, ...en]) { if (!out.some((x) => normWord(x) === normWord(w))) out.push(w); if (out.length >= KW_MAX) break; }
  return out;
}
/** The tag a row keeps (mkt_trends.tag: one word, letters, digits and «_») — the keyword's own form when it fits. */
export const tagOf = (kw) => trendTags([String(kw ?? '').trim().replace(/\s+/g, '_')])[0] || null;

// ---------------------------------------------------------------- YouTube Data API v3 (read only; the key goes in a header)

/** The window's start as YouTube takes it (RFC 3339, whole seconds). */
export const afterOf = (nowIso, days) => new Date(Date.parse(nowIso) - days * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** search.list: the most viewed videos of the window for one keyword — Egypt and Arabic for an Arabic word, the world for another. */
export function ytSearchUrl(kw, after) {
  const p = { part: 'snippet', type: 'video', order: 'viewCount', q: kw, publishedAfter: after, maxResults: String(YT_PER_KW), safeSearch: 'moderate' };
  if (ARABIC.test(kw)) Object.assign(p, { regionCode: 'EG', relevanceLanguage: 'ar' });
  return YT + '/search?' + new URLSearchParams(p).toString();
}
/** videos.list: their numbers and length (1 unit for up to 50). */
export const ytVideosUrl = (ids) => YT + '/videos?' + new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: ids.join(','), maxResults: '50' }).toString();
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** The videos' ids a search answered (each once). */
export function ytIds(search) {
  const out = [];
  for (const it of isObj(search) && Array.isArray(search.items) ? search.items : []) { const id = isObj(it) && isObj(it.id) ? String(it.id.videoId ?? '') : ''; if (YT_ID.test(id) && !out.includes(id)) out.push(id); }
  return out;
}
/** ISO 8601 duration → seconds (PT1M5S → 65; null when it is not one). */
export function durationOf(v) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(v ?? '')); if (!m || v === 'P' || v === 'PT') return null;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1e12) : null; };
const YT_IMG = /^https:\/\/i\d?\.ytimg\.com\/[^\s<>"]{1,300}$/;
/**
 * videos.list → rows: its link (a Short's when it is a minute or less), the title and the channel, the views / likes / comments, the
 * day it went up, its picture on YouTube's own image host (kept later by ai-images `trend_thumbs`), the keyword as its tag. Only the
 * ones that went up inside the window (sinceMs); the most viewed first.
 */
export function ytRows(videos, kwOf, sinceMs) {
  const out = [];
  for (const v of isObj(videos) && Array.isArray(videos.items) ? videos.items : []) {
    if (!isObj(v) || !YT_ID.test(String(v.id ?? ''))) continue;
    const sn = isObj(v.snippet) ? v.snippet : {}; const st = isObj(v.statistics) ? v.statistics : {};
    const at = Date.parse(String(sn.publishedAt ?? '')); if (!Number.isFinite(at) || (sinceMs != null && at < sinceMs)) continue;
    const title = line(sn.title, 160); if (!title) continue;
    const secs = durationOf(isObj(v.contentDetails) ? v.contentDetails.duration : null);
    const th = isObj(sn.thumbnails) ? sn.thumbnails : {}; const pic = [th.high, th.medium, th.default].find((x) => isObj(x) && typeof x.url === 'string' && YT_IMG.test(x.url));
    const desc = String(sn.description ?? '').split(/\r?\n/).map((l) => line(l, 300)).find(Boolean) || '';
    const kw = kwOf instanceof Map ? kwOf.get(String(v.id)) : null;
    out.push({ title, summary: desc || null, source: 'YouTube', url: secs != null && secs <= 60 ? 'https://www.youtube.com/shorts/' + v.id : 'https://www.youtube.com/watch?v=' + v.id,
      kind: 'video', platform: 'youtube', external_id: String(v.id), tag: tagOf(kw), author: line(sn.channelTitle, 80) || null,
      views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount), posted_at: new Date(at).toISOString(), thumb_src: pic ? pic.url : null });
  }
  return out.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}

// ---------------------------------------------------------------- Google Trends through SerpApi (read only)

/** The window Google Trends has for it: a day, a week, a month (there is no «3 days» — a week holds them). */
export const gtDate = (days) => (days <= 1 ? 'now 1-d' : days <= 7 ? 'now 7-d' : 'today 1-m');
/** The search's address. SerpApi takes its key in the query only: this URL is never logged and never leaves the server. */
export const gtUrl = (kw, key, days) => SERP + '?' + new URLSearchParams({ engine: 'google_trends', q: kw, geo: 'EG', date: gtDate(days), data_type: 'RELATED_QUERIES', hl: 'ar', api_key: key }).toString();
/** A short stable id of a text (FNV-1a, hex) — a query has no id of its own. */
export function hashOf(s) { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const GT_LINK = /^https:\/\/trends\.google\.[a-z.]{2,8}\/[^\s<>"]{1,400}$/;
const DAY_WORD = (days) => (days <= 1 ? 'آخر يوم' : days <= 7 ? 'آخر أسبوع' : 'آخر شهر');
/**
 * The «rising» related queries (else the top ones) → rows: the query as the title, how much it rose, Google Trends' own link to it
 * (else one built for Egypt and the window), the keyword as the tag. One row per query and day (its id = the day + the query's hash).
 */
export function gtRows(resp, kw, day, days) {
  const rq = isObj(resp) && isObj(resp.related_queries) ? resp.related_queries : {};
  const rising = Array.isArray(rq.rising) ? rq.rising : []; const top = Array.isArray(rq.top) ? rq.top : [];
  const list = (rising.length ? rising.map((x) => ({ x, up: true })) : top.map((x) => ({ x, up: false }))).slice(0, GT_PER_KW);
  const out = [];
  for (const { x, up } of list) {
    if (!isObj(x)) continue;
    const query = line(x.query, 160); if (!query) continue;
    const v = line(x.value, 20); const breakout = /breakout/i.test(v);
    const how = up ? (breakout ? 'طالع جامد (Breakout)' : 'طالع ' + (v || '')) : 'من الأكتر بحثًا';
    const link = typeof x.link === 'string' && GT_LINK.test(x.link) ? x.link
      : 'https://trends.google.com/trends/explore?' + new URLSearchParams({ date: gtDate(days), geo: 'EG', q: query }).toString();
    out.push({ title: query, summary: how.trim() + ' في بحث جوجل في مصر — ' + DAY_WORD(days) + ' حوالين «' + line(kw, 40) + '»', source: 'Google Trends', url: link,
      kind: 'search', platform: 'google', external_id: 'gt-' + day + '-' + hashOf(query), tag: tagOf(kw), author: null, views: null, likes: null, comments: null, posted_at: null,
      thumb_src: null, thumb_tries: 2 }); // a search has no picture: ai-images `trend_thumbs` never tries it
  }
  return out;
}
/** SerpApi's own refusal on a 200 (a word Google has nothing for is no failure — it has no rows). */
export const gtEmpty = (resp) => isObj(resp) && typeof resp.error === 'string' && /hasn.?t returned any results|no results/i.test(resp.error);

// ---------------------------------------------------------------- the competitors on Instagram (Business Discovery, read only)

const IG_USER = /^[A-Za-z0-9._]{1,30}$/;
/** An Instagram account's username from its link (https://www.instagram.com/<user>/ …), else null (a post, a reel or a tag is not one). */
export function igUserOf(url) {
  let u; try { u = new URL(String(url ?? '')); } catch { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean); if (seg.length !== 1) return null;
  const name = seg[0]; return IG_USER.test(name) && !/^(p|reel|reels|tv|explore|stories|accounts)$/i.test(name) ? name.toLowerCase() : null;
}
/**
 * The competitors to read: every instagram.com account among the sources given (the designer's and the media buyer's — name + url) and
 * the competitors' list (name + page_url), each once, BD_MAX at most — [{ username, name }].
 */
export function competitorsOf(sources, competitors) {
  const out = [];
  const add = (name, url) => { const u = igUserOf(url); if (u && !out.some((x) => x.username === u)) out.push({ username: u, name: line(name, 60) || '@' + u }); };
  for (const s of Array.isArray(sources) ? sources : []) if (isObj(s)) add(s.name, s.url);
  for (const c of Array.isArray(competitors) ? competitors : []) if (isObj(c)) add(c.name, c.page_url);
  return out.slice(0, BD_MAX);
}
const BD_FIELDS = (u) => 'business_discovery.username(' + u + '){username,name,followers_count,media.limit(' + BD_MEDIA + '){id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,children{media_type,media_url}}}';
/** One competitor's account and last posts, through the page link's own Instagram account. */
export const bdUrl = (ig, username) => GRAPH + '/' + ig + '?' + new URLSearchParams({ fields: BD_FIELDS(username) }).toString();
/** Its posts inside the window → rows, the account as the author and the competitor's name in the text; the most liked first. */
export function bdRows(resp, who, sinceMs) {
  const bd = isObj(resp) && isObj(resp.business_discovery) ? resp.business_discovery : null; if (!bd) return [];
  const media = isObj(bd.media) && Array.isArray(bd.media.data) ? bd.media.data : [];
  const fresh = media.filter((m) => { const at = Date.parse(String(isObj(m) ? m.timestamp ?? '' : '')); return Number.isFinite(at) && (sinceMs == null || at >= sinceMs); });
  const handle = '@' + (IG_USER.test(String(bd.username ?? '')) ? String(bd.username) : who.username);
  return igTrendRows(fresh, null).map((r) => ({ ...r, author: line(handle, 80), summary: line('منافس: ' + who.name + (r.summary ? ' — ' + r.summary : ''), 600) }));
}

// ---------------------------------------------------------------- the run's result, the chat's text and the codes

/** The rows of one run, each post once (its platform and id), the ones with numbers first, at most `max`. */
export function mergeRows(lists, max) {
  const seen = new Set(); const out = [];
  for (const r of lists.flat()) { if (!isObj(r)) continue; const k = r.platform + ':' + r.external_id; if (seen.has(k)) continue; seen.add(k); out.push(r); }
  const score = (r) => (r.views ?? 0) + (r.likes ?? 0) * 20;
  return out.sort((a, b) => score(b) - score(a)).slice(0, max ?? 60);
}
/** A source's state for the page: ok · not_linked (no key yet — «واقفين على إنك تضيف حساب») · a code. */
export const SOURCES = Object.freeze(['youtube', 'google', 'instagram']);
/** HTTP status → our code (never the provider's text). */
export const codeOf = (status) => (status === 400 ? 'refused' : status === 401 || status === 403 ? 'unauthorized' : status === 404 ? 'not_found' : status === 429 ? 'quota' : status >= 500 ? 'provider' : 'failed');
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const PF = { youtube: 'يوتيوب', google: 'بحث جوجل', instagram: 'إنستجرام', tiktok: 'تيك توك', facebook: 'فيسبوك', web: 'موقع' };
/** One row as a line of text (the chat keeps the text; the cards are drawn from the rows). */
export function rowLine(r) {
  const nums = [r.views != null ? n0(r.views) + ' مشاهدة' : '', r.likes != null ? n0(r.likes) + ' لايك' : ''].filter(Boolean).join(' · ');
  return '• ' + (PF[r.platform] || r.source || '') + ': ' + r.title + (r.author ? ' — ' + r.author : '') + (nums ? ' (' + nums + ')' : '') + '\n  ' + r.url;
}
export const STATE_WORD = Object.freeze({ not_linked: 'مش مربوط لسه', no_words: 'مفيش كلمات أدوّر بيها — ضيف تاجز التريندات من الإعدادات', unauthorized: 'المفتاح مرفوض', quota: 'الباقة خلصت النهارده',
  refused: 'رفض الطلب', provider: 'ماردّش', failed: 'ماردّش', timeout: 'ماردّش في الوقت', permission: 'محتاج صلاحية من ميتا', token: 'ربط صفحة ميتا محتاج يتجدد', rate: 'وصلنا لحد ميتا — جرّب بعد شوية',
  none: 'مفيش منافسين بحساب إنستجرام في المصادر' });
/** The answer's text: what was found by source, then the lines; what could not be read says why (no key = how to link it). */
export function answerText(rows, states, days, kws) {
  const L = Array.isArray(rows) ? rows : []; const S = isObj(states) ? states : {};
  const head = L.length ? 'لقيت ' + n0(L.length) + ' تريند آخر ' + (days === 1 ? 'يوم' : n0(days) + ' أيام') + (kws && kws.length ? ' حوالين ' + kws.map((k) => '«' + k + '»').join(' و') : '') + ':'
    : 'مالقيتش تريندات جديدة آخر ' + (days === 1 ? 'يوم' : n0(days) + ' أيام') + (kws && kws.length ? ' حوالين ' + kws.map((k) => '«' + k + '»').join(' و') : '') + '.';
  const off = SOURCES.filter((s) => S[s] && S[s] !== 'ok').map((s) => '• ' + PF[s] + ': ' + (STATE_WORD[S[s]] || STATE_WORD.failed));
  const link = SOURCES.some((s) => S[s] === 'not_linked') ? '\nالمصادر اللي مش مربوطة بتتربط من «الإعدادات › الربط بالمنصات».' : '';
  return [head, ...L.slice(0, SHOW_MAX).map(rowLine), off.length ? '\nمصادر ماقرتهاش المرة دي:\n' + off.join('\n') + link : ''].filter(Boolean).join('\n').slice(0, 3900);
}
