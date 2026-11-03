// cs-channel: the pure part of the Meta channel of customer service (phase 6.2, decisions 10–15 of
// docs/superpowers/plans/2026-11-02-phase-6-customer-service.md) — the Graph API's addresses, the OAuth dialog, and the
// normalisation of a webhook delivery (Messenger / Instagram messages, echoes, delivery and read receipts, Facebook feed and
// Instagram comments) into plain events the function writes. No I/O; tested from node (tests/functions/cs-channel.test.mjs) and used
// by the Deno function. Nothing here keeps a token: the callers pass it per request.

export const GRAPH_VERSION = 'v21.0';
export const GRAPH = 'https://graph.facebook.com/' + GRAPH_VERSION;
export const DIALOG = 'https://www.facebook.com/' + GRAPH_VERSION + '/dialog/oauth';
// the permissions the page link asks for (decision 12): the pages list, messaging + metadata (webhooks) + engagement (comments) of
// the page (pages_read_user_content: the visitors' comments on its posts), and the Instagram account's basics, messages and comments
export const SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement', 'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments'];
// the webhook fields the page is subscribed to at connect time
export const SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes', 'feed'];
export const MAX_TEXT = 4000;
export const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const idOf = (v) => { const s = str(v); return ID_RE.test(s) ? s : null; };
const text = (v) => str(v, MAX_TEXT).replace(/\u0000/g, '').trim();
const when = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN; if (!Number.isFinite(n)) return null; return n < 1e11 ? n * 1000 : n; }; // seconds or ms → ms

// a Business app signs in through Facebook Login for Business: a configuration (its id, made in the app's dashboard with the same
// permissions) replaces the scopes — config_id + override_default_response_type keeps the code flow; without one, the scopes
/** @param {string} appId @param {string} redirectUri @param {string} state @param {string | null} [configId] */
export function authUrl(appId, redirectUri, state, configId = null) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (configId) { q.set('config_id', configId); q.set('override_default_response_type', 'true'); } else q.set('scope', SCOPES.join(','));
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
        const msg = m.message; const echo = msg.is_echo === true; const userId = echo ? recipient : sender; const mid = idOf(msg.mid);
        if (!userId || !mid) return;
        const attachments = attachmentsOf(msg.attachments);
        events.push({ type: 'message', platform, pageId: echo ? sender : recipient || pageId, userId, mid, text: messageText(msg.text, attachments), attachments, at, echo,
          replyTo: isObj(msg.reply_to) ? idOf(msg.reply_to.mid) : null, deleted: msg.is_deleted === true, unsupported: msg.is_unsupported === true });
        return;
      }
      if (isObj(m.delivery) && sender) { events.push({ type: 'delivery', platform, pageId: recipient || pageId, userId: sender, watermark: when(m.delivery.watermark), mids: (Array.isArray(m.delivery.mids) ? m.delivery.mids : []).map(idOf).filter(Boolean) }); return; }
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

// the conversation of a comment: one per (post × commenter)
export const commentThreadId = (postId, fromId) => (postId + ':' + (fromId || 'anon')).slice(0, 160);
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
  subscribe: (pageId) => GRAPH + '/' + pageId + '/subscribed_apps',
  profile: (userId, platform) => GRAPH + '/' + userId + (platform === 'instagram' ? '?fields=name,username' : '?fields=first_name,last_name,name'),
  send: () => GRAPH + '/me/messages',
  commentReply: (commentId, platform) => GRAPH + '/' + commentId + (platform === 'instagram' ? '/replies' : '/comments'),
  commentHide: (commentId) => GRAPH + '/' + commentId,
};
// the body of a Send API call: a DM answer (RESPONSE: within the 24-hour window) or a private reply to a comment
export const sendBody = (userId, text) => ({ recipient: { id: userId }, messaging_type: 'RESPONSE', message: { text } });
export const privateReplyBody = (commentId, text) => ({ recipient: { comment_id: commentId }, message: { text } });
export const hideBody = (platform) => (platform === 'instagram' ? { hide: true } : { is_hidden: true });
