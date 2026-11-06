// The pure part of mkt-publish (phase 9.5.2, decisions 29–39 of docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md): what a
// post of the log becomes on Facebook / Instagram, the Graph paths, Meta's answers read back (the ids, the numbers, the platform's own
// posts) and Meta's errors as our codes. No I/O here — the Edge Function and the node tests share it.
import { GRAPH, graphErrorCode } from './cs-channel.js';

export { graphErrorCode };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const cut = (v, n) => Array.from(String(v ?? '').replace(LONE, '')).slice(0, n).join('');
const chars = (s) => Array.from(String(s ?? '')).length;

export const PLATFORM = Object.freeze({ 'فيسبوك': 'facebook', 'انستجرام': 'instagram' });
export const PLATFORM_AR = Object.freeze({ facebook: 'فيسبوك', instagram: 'انستجرام' });
export const KIND = Object.freeze({ 'بوست': 'post', 'كاروسيل': 'carousel', 'ستوري': 'story' }); // ريل waits for the video
export const IG_TEXT_MAX = 2200;
export const MAX_IMAGES = 10;
export const STATS_DAYS = 30; // the numbers of the posts published in the last 30 days (a story: its 24 hours)
export const PULL_FRESH_MS = 15 * 60 * 1000; // a platform post newer than this waits a run (the system's own may still be saving its id)
export const ID_RE = /^[0-9_]{1,80}$/;

// the published text: the caption, a blank line, the tags (decision 32)
export const pubText = (caption, tags) => [String(caption ?? '').trim(), String(tags ?? '').trim()].filter(Boolean).join('\n\n');

// a row of mkt_posts → what to publish, or { error } (our code): the platform, the kind, 1 image (post / story) or 2–10 (carousel),
// Instagram's images JPEG and its text ≤ 2200 (a story carries no text)
export function planOf(row) {
  const platform = PLATFORM[row?.platform]; if (!platform) return { error: 'kind' };
  const kind = KIND[row?.kind]; if (!kind) return { error: 'kind' };
  const images = Array.isArray(row.images) ? row.images.filter((p) => typeof p === 'string' && p) : [];
  if (!images.length || images.length > MAX_IMAGES || (kind === 'carousel' ? images.length < 2 : images.length !== 1)) return { error: 'images' };
  if (platform === 'instagram' && images.some((p) => !/\.jpe?g$/i.test(p))) return { error: 'images' };
  const text = kind === 'story' ? '' : pubText(row.caption, row.tags);
  if (platform === 'instagram' && chars(text) > IG_TEXT_MAX) return { error: 'text' };
  return { platform, kind, images, text };
}

// Meta's error (graphErrorCode's graph_<code>[:<subcode>], or our graph_timeout / graph_network) → our code (the page says it in words)
const IMAGE_SUBCODES = new Set([2207003, 2207004, 2207005, 2207009, 2207026, 2207052, 36001, 36003, 9004]);
const RATE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80004, 80005, 80006, 80008]);
export function ourCode(code) {
  const s = String(code ?? '');
  if (s === 'graph_timeout' || s === 'graph_network') return 'timeout';
  const m = /^graph_(\d+)(?::(\d+))?$/.exec(s); if (!m) return s && /^[a-z0-9_:]{1,60}$/.test(s) ? s : 'failed';
  const c = Number(m[1]), sub = m[2] == null ? null : Number(m[2]);
  if (c === 190 || c === 102 || c === 463 || c === 467) return 'token';
  if (c === 10 || c === 3 || (c >= 200 && c <= 299)) return 'permission';
  if (c === 100 && sub === 33) return 'gone';
  if (RATE_CODES.has(c) || sub === 2207042) return 'rate';
  if (IMAGE_SUBCODES.has(c) || (sub != null && IMAGE_SUBCODES.has(sub))) return 'image';
  return ('graph_' + c + (sub == null ? '' : ':' + sub)).slice(0, 60);
}

// the Graph calls (decisions 32–37)
const enc = encodeURIComponent;
export const path = {
  fbPhotos: (page) => GRAPH + '/' + page + '/photos',
  fbFeed: (page) => GRAPH + '/' + page + '/feed',
  fbStory: (page) => GRAPH + '/' + page + '/photo_stories',
  igMedia: (ig) => GRAPH + '/' + ig + '/media',
  igPublish: (ig) => GRAPH + '/' + ig + '/media_publish',
  container: (id) => GRAPH + '/' + id + '?fields=status_code',
  object: (id) => GRAPH + '/' + id,
  fbLink: (id) => GRAPH + '/' + id + '?fields=permalink_url',
  igLink: (id) => GRAPH + '/' + id + '?fields=permalink',
  fbCounts: (id) => GRAPH + '/' + id + '?fields=' + enc('reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares'),
  fbInsights: (id) => GRAPH + '/' + id + '/insights?metric=post_media_view,post_total_media_view_unique',
  igCounts: (id) => GRAPH + '/' + id + '?fields=like_count,comments_count,media_product_type',
  igInsights: (id, story) => GRAPH + '/' + id + '/insights?metric=' + (story ? 'views,reach,shares,total_interactions' : 'views,reach,likes,comments,shares,saved,total_interactions'),
  fbPosts: (page, sinceSec) => GRAPH + '/' + page + '/published_posts?fields=' + enc('id,message,created_time,permalink_url,full_picture,status_type,attachments{media_type}') + '&since=' + sinceSec + '&limit=50',
  igPosts: (ig) => GRAPH + '/' + ig + '/media?fields=' + enc('id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp') + '&limit=50',
  debugToken: (token) => GRAPH + '/debug_token?input_token=' + enc(token),
};

// the bodies (form fields as Graph takes them)
export const body = {
  fbPhoto: (url, text) => ({ url, ...(text ? { message: text } : {}), published: 'true' }),
  fbPhotoHidden: (url) => ({ url, published: 'false', temporary: 'true' }),
  fbStoryPhoto: (url) => ({ url, published: 'false' }),
  fbFeed: (text, photoIds) => ({ ...(text ? { message: text } : {}), attached_media: photoIds.map((id) => ({ media_fbid: id })) }),
  fbStory: (photoId) => ({ photo_id: photoId }),
  igImage: (url, text) => ({ image_url: url, ...(text ? { caption: text } : {}) }),
  igStory: (url) => ({ image_url: url, media_type: 'STORIES' }),
  igChild: (url) => ({ image_url: url, is_carousel_item: 'true' }),
  igCarousel: (ids, text) => ({ media_type: 'CAROUSEL', children: ids.join(','), ...(text ? { caption: text } : {}) }),
  igPublish: (container) => ({ creation_id: container }),
};

// an id Graph gave (a post, a photo, a container, a media) — digits and underscores only, or null
export const idOf = (v) => { const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''; return ID_RE.test(s) ? s : null; };
// the container's state: FINISHED (publish) · IN_PROGRESS (wait) · ERROR / EXPIRED (failed)
export function containerState(json) {
  const s = isObj(json) && typeof json.status_code === 'string' ? json.status_code.toUpperCase() : '';
  if (s === 'FINISHED' || s === 'PUBLISHED') return 'ready';
  if (s === 'ERROR' || s === 'EXPIRED') return 'failed';
  return 'wait'; // IN_PROGRESS, or no answer yet
}
// a link Graph gave (https only)
export const linkOf = (json, field) => { const v = isObj(json) ? json[field] : null; return typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v) && v.length <= 500 ? v : null; };

// ---------------------------------------------------------------- the numbers (decision 36)

const count = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
// /insights → { metric: value } (values[0].value or total_value.value; an object value — a breakdown — is summed)
export function insightsOf(json) {
  const out = {};
  (isObj(json) && Array.isArray(json.data) ? json.data : []).forEach((m) => {
    if (!isObj(m) || typeof m.name !== 'string') return;
    let v = isObj(m.total_value) ? m.total_value.value : Array.isArray(m.values) && isObj(m.values[0]) ? m.values[0].value : null;
    if (isObj(v)) v = Object.values(v).reduce((s, x) => s + (count(x) ?? 0), 0);
    const n = count(v); if (n != null) out[m.name] = n;
  });
  return out;
}
const summaryCount = (j, k) => (isObj(j) && isObj(j[k]) && isObj(j[k].summary) ? count(j[k].summary.total_count) : null);
// Facebook: the post's reactions / comments / shares + its views (post_media_view) and reach (post_total_media_view_unique)
export function fbStatsOf(counts, insights) {
  const ins = insightsOf(insights);
  const likes = summaryCount(counts, 'reactions'); const comments = summaryCount(counts, 'comments');
  const shares = isObj(counts) && isObj(counts.shares) ? count(counts.shares.count) : isObj(counts) && counts.shares === undefined && likes != null ? 0 : null;
  const eng = [likes, comments, shares].some((x) => x != null) ? (likes ?? 0) + (comments ?? 0) + (shares ?? 0) : null;
  return { views: ins.post_media_view ?? null, reach: ins.post_total_media_view_unique ?? null, likes, comments, shares, saves: null, eng };
}
// Instagram: views / reach / likes / comments / shares / saved / total_interactions (the fields' counts when the insights fail)
export function igStatsOf(counts, insights) {
  const ins = insightsOf(insights);
  const likes = ins.likes ?? (isObj(counts) ? count(counts.like_count) : null);
  const comments = ins.comments ?? (isObj(counts) ? count(counts.comments_count) : null);
  const shares = ins.shares ?? null, saves = ins.saved ?? null;
  const sum = [likes, comments, shares, saves].some((x) => x != null) ? (likes ?? 0) + (comments ?? 0) + (shares ?? 0) + (saves ?? 0) : null;
  return { views: ins.views ?? null, reach: ins.reach ?? null, likes, comments, shares, saves, eng: ins.total_interactions ?? sum };
}

// ---------------------------------------------------------------- the platform's own posts (decision 37)

// an instant → Cairo's day and hour ('YYYY-MM-DD', 'HH:MM')
const CAIRO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function cairoParts(ms) {
  const p = Object.fromEntries(CAIRO.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute };
}
const when = (v) => { const n = typeof v === 'string' ? Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN; return Number.isFinite(n) ? n : null; };
const nameOf = (text, fallback) => { const first = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean) || ''; return cut(first, 200) || fallback; };
const httpsOf = (v, n) => (typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v) && v.length <= n ? v : null);
function fbKindOf(p) {
  const t = isObj(p.attachments) && Array.isArray(p.attachments.data) && isObj(p.attachments.data[0]) ? String(p.attachments.data[0].media_type || '').toLowerCase() : '';
  if (t === 'album') return 'كاروسيل';
  if (t === 'video' || /video/i.test(String(p.status_type || ''))) return 'ريل';
  return 'بوست';
}
function igKindOf(p) {
  const t = String(p.media_type || '').toUpperCase(), pt = String(p.media_product_type || '').toUpperCase();
  if (pt === 'STORY') return 'ستوري';
  if (t === 'CAROUSEL_ALBUM') return 'كاروسيل';
  if (t === 'VIDEO' || pt === 'REELS') return 'ريل';
  return 'بوست';
}
// a published post of the page / a media of the account → a «من المنصة مباشرة» row (no campaign, «اتنشر»), or null
export function platformRowOf(p, platform, nowMs) {
  if (!isObj(p)) return null; const id = idOf(p.id); if (!id) return null;
  const ig = platform === 'instagram';
  const at = when(ig ? p.timestamp : p.created_time); if (at == null) return null;
  if (nowMs - at < PULL_FRESH_MS) return null; // the system's own may still be saving its id — the next run takes it
  // the last 30 days only (decision 37), as the numbers: Facebook asks with since=, Instagram's media edge answers its latest ones
  // whatever their date — an older post would stay in the log without numbers
  if (nowMs - at > STATS_DAYS * 86400_000) return null;
  const { day, time } = cairoParts(at);
  const text = cut(String((ig ? p.caption : p.message) ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' '), 2200).trim();
  const kind = ig ? igKindOf(p) : fbKindOf(p);
  return {
    src: 'platform', kind, name: nameOf(text, ig ? 'بوست على انستجرام' : 'بوست على فيسبوك'), caption: text, caption_orig: text, platform: PLATFORM_AR[platform],
    day, time, how: 'publish', status: 'اتنشر', external_id: id,
    thumb: ig ? httpsOf(p.thumbnail_url, 2000) || (kind === 'ريل' ? null : httpsOf(p.media_url, 2000)) : httpsOf(p.full_picture, 2000),
    post_url: httpsOf(ig ? p.permalink : p.permalink_url, 500), published_at: new Date(at).toISOString(),
  };
}
export function platformRowsOf(feedJson, mediaJson, nowMs) {
  const fb = (isObj(feedJson) && Array.isArray(feedJson.data) ? feedJson.data : []).map((p) => platformRowOf(p, 'facebook', nowMs));
  const ig = (isObj(mediaJson) && Array.isArray(mediaJson.data) ? mediaJson.data : []).map((p) => platformRowOf(p, 'instagram', nowMs));
  return [...fb, ...ig].filter(Boolean).slice(0, 100);
}

// ---------------------------------------------------------------- the link's permissions (decision 30)

export const PUBLISH_NEEDS = Object.freeze({ facebook: ['pages_manage_posts'], instagram: ['instagram_content_publish'] });
export const INSIGHTS_NEEDS = Object.freeze({ facebook: ['read_insights'], instagram: ['instagram_manage_insights'] });
// /debug_token (the app token) → the granted scopes and validity, or null
export function scopesOf(json) {
  const d = isObj(json) && isObj(json.data) ? json.data : null;
  if (!d || !Array.isArray(d.scopes)) return null;
  return { valid: d.is_valid === true, granted: d.scopes.filter((s) => typeof s === 'string').map((s) => s.slice(0, 60)) };
}
// the page link (Vault) + its scopes + the switch → what the page shows (no token, no id beyond the page's name)
export function connectionOf(page, scopes, autopublish) {
  const has = (list) => !!scopes && scopes.valid && list.every((s) => scopes.granted.includes(s));
  const missing = scopes ? [...PUBLISH_NEEDS.facebook, ...PUBLISH_NEEDS.instagram, ...INSIGHTS_NEEDS.facebook, ...INSIGHTS_NEEDS.instagram].filter((s) => !scopes.granted.includes(s)) : null;
  return {
    autopublish: !!autopublish,
    facebook: { linked: !!page, name: page ? cut(page.name, 120) : null, publish: !!page && has(PUBLISH_NEEDS.facebook), insights: !!page && has(INSIGHTS_NEEDS.facebook) },
    instagram: { linked: !!page?.ig, name: page?.ig?.username ? '@' + cut(page.ig.username, 60) : null, publish: !!page?.ig && has(PUBLISH_NEEDS.instagram), insights: !!page?.ig && has(INSIGHTS_NEEDS.instagram) },
    valid: scopes ? scopes.valid : null, missing,
  };
}
