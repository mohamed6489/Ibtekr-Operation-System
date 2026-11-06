// cs-channel: the pure part of the Meta channel of customer service (phase 6.2, decisions 10–15 of
// docs/superpowers/plans/2026-11-02-phase-6-customer-service.md) — the Graph API's addresses, the OAuth dialog, and the
// normalisation of a webhook delivery (Messenger / Instagram messages, echoes, delivery and read receipts, Facebook feed and
// Instagram comments) into plain events the function writes. No I/O; tested from node (tests/functions/cs-channel.test.mjs) and used
// by the Deno function. Nothing here keeps a token: the callers pass it per request.

export const GRAPH_VERSION = 'v21.0';
export const GRAPH = 'https://graph.facebook.com/' + GRAPH_VERSION;
export const DIALOG = 'https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth';
// the permissions the page link asks for (decision 12; business_management: a page owned by a Business Portfolio): the pages list, messaging + metadata (webhooks) + engagement (comments) of
// the page (pages_read_user_content: the visitors' comments on its posts), and the Instagram account's basics, messages and comments
export const SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement', 'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments', 'business_management'];
// marketing's (phase 9.5.2 decision 30): publishing posts on the page and the account, and their numbers — asked by the same link,
// read by mkt-publish; customer service's «missing» stays SCOPES'
export const PUBLISH_SCOPES = ['pages_manage_posts', 'instagram_content_publish', 'read_insights', 'instagram_manage_insights'];
// the webhook fields the page is subscribed to at connect time
export const SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes', 'feed'];
export const MAX_TEXT = 4000;
export const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const idOf = (v) => { const s = str(v); return ID_RE.test(s) ? s : null; };
// a message id (mid) runs past 80 characters (Messenger 88, Instagram longer — seen live, 3 Nov): the whole id or nothing — a cut one
// never matches the Send API's; cs_messages.external_id takes up to 1000 (0037)
export const MID_RE = /^[A-Za-z0-9_.:+/=-]{1,1000}$/;
const midOf = (v) => (typeof v === 'string' && MID_RE.test(v) ? v : null);
// a cut never splits an emoji: a lone surrogate half makes Postgres refuse the whole body («invalid input syntax for type json» —
// seen live 4 Nov on a caption cut at 300); cut by code points and drop any stray half
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const cut = (v, n) => Array.from(String(v ?? '').replace(LONE, '')).slice(0, n).join('');
const text = (v) => cut(typeof v === 'string' ? v : '', MAX_TEXT).replace(/\u0000/g, '').trim();
const when = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN; if (!Number.isFinite(n)) return null; return n < 1e11 ? n * 1000 : n; }; // seconds or ms → ms

// a Business app signs in through Facebook Login for Business: a configuration (its id, made in the app's dashboard with the same
// permissions) replaces the scopes — config_id + override_default_response_type keeps the code flow; without one, the scopes
/** @param {string} appId @param {string} redirectUri @param {string} state @param {string | null} [configId] */
export function authUrl(appId, redirectUri, state, configId = null) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (configId) { q.set('config_id', configId); q.set('override_default_response_type', 'true'); } else q.set('scope', SCOPES.concat(PUBLISH_SCOPES).join(','));
  return DIALOG + '?' + q.toString();
}

// an attachment list → a short text the inbox shows («[صورة]» …); the attachments themselves go to meta.attachments (type + url)
const ATT_LABEL = { image: '[صورة]', video: '[فيديو]', audio: '[رسالة صوتية]', file: '[ملف]', sticker: '[ستيكر]', share: '[مشاركة]', story_mention: '[ذكر في ستوري]', reel: '[ريل]', ig_reel: '[ريل]', template: '[قالب]', location: '[موقع]', fallback: '[رابط]' };
export function attachmentsOf(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((a) => {
    if (!isObj(a)) return null;
    const type = str(a.type, 30) || 'file'; const p = isObj(a.payload) ? a.payload : {};
    const url = typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url.slice(0, 1000) : null;
    return { type, url, title: str(p.title, 200) || null };
  }).filter(Boolean);
}
export function attachmentText(attachments) {
  const labels = (attachments || []).map((a) => ATT_LABEL[a.type] || '[مرفق]');
  return [...new Set(labels)].join(' ');
}
// the text the inbox keeps for an incoming message: its text, else its attachments' labels, else «[رسالة]»
export const messageText = (t, attachments) => (text(t) || attachmentText(attachments) || '[رسالة]').slice(0, MAX_TEXT);

// ---------------------------------------------------------------- the webhook delivery → events
// { object, entries: [{ id, time, events: [...] }] } — each event one of:
//   { type: 'message', platform: 'messenger' | 'instagram', pageId, userId, mid, text, attachments, at, echo, replyTo }
//     (an echo: a message the page sent — from Meta's inbox or from us; userId is then the recipient)
//   { type: 'delivery', platform, pageId, userId, watermark, mids }   { type: 'read', platform, pageId, userId, watermark }
//   { type: 'comment', platform: 'facebook' | 'instagram', pageId, commentId, postId, parentId, fromId, fromName, text, at, removed }
//   { type: 'other', field }
export function parseWebhook(body) {
  if (!isObj(body) || (body.object !== 'page' && body.object !== 'instagram') || !Array.isArray(body.entry)) return null;
  const platform = body.object === 'page' ? 'messenger' : 'instagram';
  const entries = body.entry.slice(0, 100).map((e) => {
    if (!isObj(e)) return null;
    const pageId = idOf(e.id); const time = when(e.time);
    const events = [];
    (Array.isArray(e.messaging) ? e.messaging : []).slice(0, 200).forEach((m) => {
      if (!isObj(m)) return;
      const sender = isObj(m.sender) ? idOf(m.sender.id) : null; const recipient = isObj(m.recipient) ? idOf(m.recipient.id) : null;
      const at = when(m.timestamp) ?? time;
      if (isObj(m.message)) {
        const msg = m.message; const echo = msg.is_echo === true; const userId = echo ? recipient : sender; const mid = midOf(msg.mid);
        if (!userId || !mid) { events.push({ type: 'other', field: 'bad_id' }); return; }
        const attachments = attachmentsOf(msg.attachments);
        events.push({ type: 'message', platform, pageId: echo ? sender : recipient || pageId, userId, mid, text: messageText(msg.text, attachments), attachments, at, echo,
          replyTo: isObj(msg.reply_to) ? midOf(msg.reply_to.mid) : null, deleted: msg.is_deleted === true, unsupported: msg.is_unsupported === true });
        return;
      }
      if (isObj(m.delivery) && sender) { events.push({ type: 'delivery', platform, pageId: recipient || pageId, userId: sender, watermark: when(m.delivery.watermark), mids: (Array.isArray(m.delivery.mids) ? m.delivery.mids : []).map(midOf).filter(Boolean) }); return; }
      if (isObj(m.read) && sender) { events.push({ type: 'read', platform, pageId: recipient || pageId, userId: sender, watermark: when(m.read.watermark) }); return; }
      events.push({ type: 'other', field: isObj(m.postback) ? 'postback' : isObj(m.reaction) ? 'reaction' : 'messaging' });
    });
    (Array.isArray(e.changes) ? e.changes : []).slice(0, 200).forEach((c) => {
      if (!isObj(c)) return;
      const field = str(c.field, 40); const v = isObj(c.value) ? c.value : {};
      if (platform === 'messenger' && field === 'feed' && v.item === 'comment') {
        const commentId = idOf(v.comment_id); const from = isObj(v.from) ? v.from : {};
        if (!commentId || (v.verb !== 'add' && v.verb !== 'edited' && v.verb !== 'remove')) { events.push({ type: 'other', field: 'feed' }); return; }
        events.push({ type: 'comment', platform: 'facebook', pageId, commentId, postId: idOf(v.post_id) || idOf(v.parent_id) || commentId, parentId: idOf(v.parent_id), fromId: idOf(from.id), fromName: str(from.name, 120) || null,
          text: v.verb === 'remove' ? '' : messageText(v.message, []), at: when(v.created_time) ?? time, removed: v.verb === 'remove', edited: v.verb === 'edited' });
        return;
      }
      if (platform === 'instagram' && field === 'comments') {
        const commentId = idOf(v.id); const from = isObj(v.from) ? v.from : {}; const media = isObj(v.media) ? v.media : {};
        if (!commentId) { events.push({ type: 'other', field: 'comments' }); return; }
        events.push({ type: 'comment', platform: 'instagram', pageId, commentId, postId: idOf(media.id) || commentId, parentId: idOf(v.parent_id), fromId: idOf(from.id), fromName: from.username ? '@' + str(from.username, 118) : null,
          text: messageText(v.text, []), at: time, removed: false, edited: false });
        return;
      }
      events.push({ type: 'other', field: field || 'change' });
    });
    return { id: pageId, time, events };
  }).filter(Boolean);
  return { object: body.object, platform, entries };
}

// ---------------------------------------------------------------- the comments pull (decision 18)
// Meta sends no comment webhook to an app without Advanced Access (seen live 4 Nov: an app member's comment, its author visible
// to Graph, and no delivery). The function reads the latest posts' comments itself (cron every minute) and feeds them through the
// webhook's own path (the same events, the same dedupe on the comment id). A comment whose author Graph hides (a person with no
// role on the app, before App Review) opens its own conversation as «زائر فيسبوك / إنستجرام»; its replies join it.
export const PULL_WINDOW_MS = 2 * 60 * 60 * 1000; // the comments of the last two hours (older ones are not pulled into the inbox)
export const VISITOR = { facebook: 'زائر فيسبوك', instagram: 'زائر إنستجرام' };
export function pulledComments(feedJson, mediaJson, pageId, sinceMs) {
  const out = [];
  const keep = (ev) => { if (ev.commentId && ev.at != null && ev.at >= sinceMs) out.push(ev); };
  (isObj(feedJson) && Array.isArray(feedJson.data) ? feedJson.data : []).slice(0, 25).forEach((p) => {
    if (!isObj(p)) return; const postId = idOf(p.id); if (!postId) return;
    const list = isObj(p.comments) && Array.isArray(p.comments.data) ? p.comments.data : [];
    list.slice(0, 100).forEach((c) => {
      if (!isObj(c)) return; const from = isObj(c.from) ? c.from : {}; const fromId = idOf(from.id);
      // a top-level comment's parent is the post (as in the feed webhook); a reply's is its comment
      const parentId = isObj(c.parent) && idOf(c.parent.id) ? idOf(c.parent.id) : postId;
      keep({ type: 'comment', platform: 'facebook', pageId, commentId: idOf(c.id), postId, parentId, fromId, fromName: str(from.name, 120) || (fromId ? null : VISITOR.facebook),
        text: messageText(c.message, []), at: when(c.created_time), removed: false, edited: false, pulled: true });
    });
  });
  (isObj(mediaJson) && Array.isArray(mediaJson.data) ? mediaJson.data : []).slice(0, 25).forEach((m) => {
    if (!isObj(m)) return; const postId = idOf(m.id); if (!postId) return;
    const one = (c, parentId) => {
      if (!isObj(c)) return; const from = isObj(c.from) ? c.from : {}; const fromId = idOf(from.id);
      const user = str(from.username, 118) || str(c.username, 118);
      keep({ type: 'comment', platform: 'instagram', pageId, commentId: idOf(c.id), postId, parentId, fromId, fromName: user ? '@' + user : (fromId ? null : VISITOR.instagram),
        text: messageText(c.text, []), at: when(c.timestamp), removed: false, edited: false, pulled: true });
    };
    (isObj(m.comments) && Array.isArray(m.comments.data) ? m.comments.data : []).slice(0, 100).forEach((c) => {
      one(c, null);
      if (isObj(c) && isObj(c.replies) && Array.isArray(c.replies.data)) c.replies.data.slice(0, 50).forEach((r) => one(r, idOf(c.id)));
    });
  });
  return out.sort((a, b) => a.at - b.at); // oldest first: a reply lands after its comment
}

// the posts (decision 19): what a comments conversation shows of the post it is on — the caption's start, the link, the picture,
// the kind and the date; https links only. With `withComments`, only the posts that carry comments in this answer.
const https = (v, n) => (typeof v === 'string' && /^https:\/\//.test(v) && v.length <= n ? v : null);
export function postOf(p, platform) {
  if (!isObj(p)) return null; const id = idOf(p.id); if (!id || !/^[0-9_]{1,80}$/.test(id)) return null;
  const at = when(platform === 'instagram' ? p.timestamp : p.created_time);
  return platform === 'instagram'
    ? { id, platform, caption: cut(text(p.caption), 300) || null, permalink: https(p.permalink, 1000), thumb: https(p.thumbnail_url, 2000) || (p.media_type === 'VIDEO' ? null : https(p.media_url, 2000)), kind: str(p.media_type, 40).toLowerCase() || null, posted_at: at == null ? null : new Date(at).toISOString() }
    : { id, platform, caption: cut(text(p.message), 300) || null, permalink: https(p.permalink_url, 1000), thumb: https(p.full_picture, 2000), kind: str(p.status_type, 40) || null, posted_at: at == null ? null : new Date(at).toISOString() };
}
export function postsOf(feedJson, mediaJson, withComments = true) {
  const has = (p) => !withComments || (isObj(p.comments) && Array.isArray(p.comments.data) && p.comments.data.length > 0);
  const fb = (isObj(feedJson) && Array.isArray(feedJson.data) ? feedJson.data : []).filter((p) => isObj(p) && has(p)).map((p) => postOf(p, 'facebook'));
  const ig = (isObj(mediaJson) && Array.isArray(mediaJson.data) ? mediaJson.data : []).filter((p) => isObj(p) && has(p)).map((p) => postOf(p, 'instagram'));
  return [...fb, ...ig].filter(Boolean).slice(0, 50);
}

// the conversation of a comment: one per (post × commenter); a hidden commenter: one per top-level comment (its replies join it)
export const commentThreadId = (postId, fromId, topCommentId = null) => (postId + ':' + (fromId || (topCommentId ? 'c' + topCommentId : 'anon'))).slice(0, 160);
// the status an incoming message gives a conversation (block 19 nextStatus(status, 'in'))
export const statusAfterIn = (existing) => (existing == null ? 'جديدة' : 'مستنية ردنا');
export const DEFAULT_NAME = { messenger: 'عميل ماسنجر', instagram: 'عميل إنستجرام' };
// a profile answer of Graph → a display name (first + last, or name, or @username), else null
export function profileName(json) {
  if (!isObj(json)) return null;
  const full = [str(json.first_name, 60), str(json.last_name, 60)].filter(Boolean).join(' ').trim();
  const n = full || str(json.name, 120).trim() || (json.username ? '@' + str(json.username, 118) : '');
  return n ? n.slice(0, 120) : null;
}
export const profileHandle = (json) => (isObj(json) && json.username ? '@' + str(json.username, 118) : null);

// /me/accounts → [{ id, name, token, ig: { id, username } | null }] (tokens stay in the caller's memory / Vault)
export function pagesOf(json) {
  const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
  return list.map((p) => {
    if (!isObj(p)) return null;
    const id = idOf(p.id); const token = typeof p.access_token === 'string' && p.access_token.length >= 20 ? p.access_token : null;
    if (!id || !token) return null;
    const ig = isObj(p.instagram_business_account) && idOf(p.instagram_business_account.id) ? { id: idOf(p.instagram_business_account.id), username: str(p.instagram_business_account.username, 80) || null } : null;
    return { id, name: str(p.name, 120) || id, token, ig };
  }).filter(Boolean);
}
// /me/accounts entries that came back without a page token (the page is seen, its management is not granted) — a count for the diagnosis
export const tokenlessCount = (json) => (isObj(json) && Array.isArray(json.data) ? json.data.filter((p) => isObj(p) && idOf(p.id) && !(typeof p.access_token === 'string' && p.access_token.length >= 20)).length : 0);
// the pages of several answers, once each (the first answer with a token wins)
export function mergePages(...lists) {
  const seen = new Map(); lists.flat().forEach((p) => { if (p && !seen.has(p.id)) seen.set(p.id, p); }); return [...seen.values()];
}
// /me/businesses → the portfolio ids (a page owned by a Business Portfolio may not be in /me/accounts)
export const businessIdsOf = (json) => (isObj(json) && Array.isArray(json.data) ? json.data.map((b) => (isObj(b) ? idOf(b.id) : null)).filter(Boolean).slice(0, 10) : []);
// /me/permissions → { granted, declined } names only; and what the system needs that is not granted
export function permissionsOf(json) {
  const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
  const granted = [], declined = [];
  list.forEach((p) => { if (!isObj(p) || typeof p.permission !== 'string') return; const n = p.permission.slice(0, 60); if (p.status === 'granted') granted.push(n); else declined.push(n); });
  return { granted, declined, missing: SCOPES.filter((s) => s !== 'business_management' && !granted.includes(s)) };
}
// /{page}/subscribed_apps → this app's subscribed fields (null when the app is not in the list)
export function subscribedFieldsOf(json, appId) {
  const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
  const row = list.find((a) => isObj(a) && String(a.id) === String(appId)) || (list.length === 1 && isObj(list[0]) ? list[0] : null);
  return row && Array.isArray(row.subscribed_fields) ? row.subscribed_fields.filter((f) => typeof f === 'string').map((f) => f.slice(0, 60)) : null;
}
// /debug_token (with the app token) → the scopes the linked page token holds; and what the system needs that it lacks
export function tokenScopesOf(json) {
  const d = isObj(json) && isObj(json.data) ? json.data : null;
  if (!d || !Array.isArray(d.scopes)) return null;
  const granted = d.scopes.filter((s) => typeof s === 'string').map((s) => s.slice(0, 60));
  return { valid: d.is_valid === true, granted, missing: SCOPES.filter((s) => s !== 'business_management' && !granted.includes(s)) };
}
// the comments probe (decision 17): what Graph shows of the latest posts' comments — counts and dates only, never a text or a name.
// `from` is what the webhook needs to open a thread; a comment without it is one Meta hides from the app (no pages_read_user_content /
// Advanced Access) — the reason a live comment may never reach the inbox
export function commentsProbeOf(json, platform, ownIds = []) {
  const posts = isObj(json) && Array.isArray(json.data) ? json.data.filter(isObj) : [];
  let comments = 0, sampled = 0, withFrom = 0, latest = null; const items = [];
  posts.forEach((p) => {
    const c = isObj(p.comments) ? p.comments : null;
    const total = platform === 'instagram' ? Number(p.comments_count) : Number(c && isObj(c.summary) ? c.summary.total_count : NaN);
    if (Number.isFinite(total) && total > 0) comments += total;
    (c && Array.isArray(c.data) ? c.data : []).forEach((x) => {
      if (!isObj(x)) return; sampled++;
      const fromId = isObj(x.from) && x.from.id ? String(x.from.id) : null;
      if (fromId) withFrom++;
      const at = typeof x.created_time === 'string' ? x.created_time : typeof x.timestamp === 'string' ? x.timestamp : null;
      if (at && (!latest || at > latest)) latest = at.slice(0, 30);
      // each sampled comment: its date and who Graph says wrote it — the page itself, a person (no id kept), or hidden
      items.push({ at: at ? at.slice(0, 30) : null, by: !fromId ? 'hidden' : ownIds.includes(fromId) ? 'page' : 'user' });
    });
  });
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { posts: posts.length, comments, sampled, with_from: withFrom, latest, items: items.slice(0, 15) };
}
// the pages without their tokens (the answer to the admin)
export const publicPages = (pages) => pages.map((p) => ({ id: p.id, name: p.name, ig: p.ig ? { id: p.ig.id, username: p.ig.username } : null }));

// a Graph error → a short code «code:subcode» (never the message: it can echo ids and text)
export function graphErrorCode(json) {
  const e = isObj(json) && isObj(json.error) ? json.error : null;
  if (!e) return 'graph_error';
  const code = Number.isFinite(Number(e.code)) ? String(e.code) : 'x'; const sub = Number.isFinite(Number(e.error_subcode)) ? ':' + e.error_subcode : '';
  return ('graph_' + code + sub).slice(0, 40);
}

// the addresses the function calls (page token passed as a header, never in the url)
export const graphPath = {
  tokenExchange: (appId, redirectUri, code) => GRAPH + '/oauth/access_token?' + new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, code }).toString() + '&client_secret=',
  longLived: (appId) => GRAPH + '/oauth/access_token?' + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId }).toString() + '&client_secret=',
  accounts: () => GRAPH + '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50',
  permissions: () => GRAPH + '/me/permissions',
  businesses: () => GRAPH + '/me/businesses?fields=id&limit=10',
  businessPages: (businessId, kind) => GRAPH + '/' + businessId + '/' + (kind === 'client' ? 'client_pages' : 'owned_pages') + '?fields=id,name,access_token,instagram_business_account{id,username}&limit=50',
  subscribe: (pageId) => GRAPH + '/' + pageId + '/subscribed_apps',
  subscribedFields: (pageId) => GRAPH + '/' + pageId + '/subscribed_apps?fields=id,subscribed_fields',
  profile: (userId, platform) => GRAPH + '/' + userId + (platform === 'instagram' ? '?fields=name,username' : '?fields=first_name,last_name,name'),
  // the probe (decision 17): the latest 5 posts / media with up to 3 comments each (ids, dates and the commenter id only)
  feedProbe: (pageId) => GRAPH + '/' + pageId + '/feed?fields=id,comments.summary(true).limit(3){id,created_time,from}&limit=5',
  mediaProbe: (igId) => GRAPH + '/' + igId + '/media?fields=id,comments_count,comments.limit(3){id,timestamp,from}&limit=5',
  // the pull (decision 18): the latest 10 posts / media with their recent comments (replies included)
  feedPull: (pageId) => GRAPH + '/' + pageId + '/feed?fields=id,message,permalink_url,full_picture,status_type,created_time,comments.filter(stream).order(reverse_chronological).limit(50){id,created_time,from,message,parent{id}}&limit=10',
  mediaPull: (igId) => GRAPH + '/' + igId + '/media?fields=id,caption,permalink,media_type,media_url,thumbnail_url,timestamp,comments.limit(50){id,timestamp,from,username,text,replies.limit(25){id,timestamp,from,username,text}}&limit=10',
  // the WhatsApp probe (owner, 4 Nov — «the page's WhatsApp, can we show it?»): the number linked to the page and a
  // conversations list on the whatsapp platform; read-only, the answer is reduced to booleans / counts / codes
  waNumberProbe: (pageId) => GRAPH + '/' + pageId + '?fields=whatsapp_number',
  waConvProbe: (pageId) => GRAPH + '/' + pageId + '/conversations?platform=whatsapp&fields=id,updated_time&limit=5',
  // the one call with a token in the url: debug_token takes the token it inspects as input_token (sent to Meta only, never logged)
  debugToken: (inputToken) => GRAPH + '/debug_token?' + new URLSearchParams({ input_token: inputToken }).toString(),
  // one post / media by id (decision 19: a webhook comment on a post the pull has not seen)
  post: (postId, platform) => GRAPH + '/' + postId + (platform === 'instagram' ? '?fields=id,caption,permalink,media_type,media_url,thumbnail_url,timestamp' : '?fields=id,message,permalink_url,full_picture,status_type,created_time'),
  send: () => GRAPH + '/me/messages',
  commentReply: (commentId, platform) => GRAPH + '/' + commentId + (platform === 'instagram' ? '/replies' : '/comments'),
  commentHide: (commentId) => GRAPH + '/' + commentId,
};
// the WhatsApp probe reduced: never the number itself, only whether the page has one and how many conversations answer
export function waProbeOf(numberJson, convJson) {
  const linked = typeof numberJson?.whatsapp_number === 'string' && numberJson.whatsapp_number.trim() !== '';
  const list = Array.isArray(convJson?.data) ? convJson.data : null;
  return { number_linked: linked, conversations: list ? list.length : null };
}
// the body of a Send API call: a DM answer (RESPONSE: within the 24-hour window) or a private reply to a comment
export const sendBody = (userId, text) => ({ recipient: { id: userId }, messaging_type: 'RESPONSE', message: { text } });
export const privateReplyBody = (commentId, text) => ({ recipient: { comment_id: commentId }, message: { text } });
export const hideBody = (platform) => (platform === 'instagram' ? { hide: true } : { is_hidden: true });
