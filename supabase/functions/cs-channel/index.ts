// cs-channel: the Meta channel (Messenger + Instagram) of customer service — phase 6.2, decisions 10–15 of
// docs/superpowers/plans/2026-11-02-phase-6-customer-service.md. Deployed with verify_jwt false; it authenticates each request itself:
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   Meta's webhook verification (META_VERIFY_TOKEN) → the challenge.
//   POST with X-Hub-Signature-256 and no Authorization              a webhook delivery: HMAC-SHA256 of the raw body with META_APP_SECRET
//        (constant-time compare; a bad one is 401 + a cs_channel_events row), then the entries become our rows: a customer's message
//        → the contact (cs_contacts by PSID / IGSID; a new customer `channel` named from the profile) → the conversation (one per
//        user and channel; «مستنية ردنا» again when it was closed / waiting) → an `in` message (mid as external_id: a redelivery is
//        a duplicate, ignored); an echo (a reply sent from Meta's inbox) → an `out` message without an author; delivery / read
//        receipts → the `out` messages' delivery; a Facebook feed comment or an Instagram comment → a `comments` conversation per
//        (post × commenter) with the comment as an `in` message (the page's own comment: an echo). Only the linked page's entries
//        (its id or its Instagram account's id) are read — nothing before a page is linked. Always 200 after the signature
//        (Meta resends on anything else) except a database failure (500 → Meta retries); the delivery is summarised in
//        cs_channel_events (counts, an error code — never a text, a name or a token).
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status           (cs.view ≠ N) → the channels' state; the admin also: configured (the app secrets), redirect, webhook_url, page.
//     connect_start    (the admin) { channel } → the Facebook dialog url (the nine scopes, or a Facebook Login for Business configuration), a state kept ten minutes in cs_oauth_states.
//     connect_callback (the admin) { code, state } → the state spent, the code → a long-lived user token → /me/accounts: one page →
//                      linked now; several → { result: 'choose', pages } with the candidates kept in Vault for connect_pick.
//     connect_pick     (the admin) { page_id } → the candidate linked.
//                      Linking = POST /{page}/subscribed_apps (SUBSCRIBED_FIELDS) + the page (token, Instagram account) in Vault
//                      (0035 cs_secret_set «meta_pages») + cs_channels messenger connected (instagram too when the page has an
//                      Instagram account) + activity_log cs.channel.connect.
//     disconnect       (the admin) → DELETE subscribed_apps (best effort), the secret removed, both channels disconnected.
//     send             (cs.reply, on a conversation the member sees — cs.view F, or P and assigned to them — and their own row unless
//                      the admin) { message_id } → the member's queued `out` message sent: a DM through the Send API (RESPONSE), a
//                      comments conversation's reply through POST /{comment}/comments (Facebook) or /replies (Instagram) on the last
//                      incoming comment → delivery sent + Meta's id; a refusal → delivery failed + meta.error (a code) and 502.
//     comment_private  (cs.reply) { message_id } → the queued message as a private reply to the last incoming comment (opens a DM).
//     comment_hide     (cs.reply) { conversation_id } → the last incoming comment hidden + an `event` message.
// Secrets: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN (Supabase secrets — the owner sets them); META_LOGIN_CONFIG_ID (the
// Facebook Login for Business configuration of a Business app — the dialog then takes config_id instead of the scopes) and
// META_REDIRECT_URI optional.
// Errors: 400 bad_request { field }, 401 unauthorized / bad_signature, 403 verify_failed, 404 not_found, 409 not_queued, 502 graph
// codes, 503 not_configured / not_linked. Nothing here logs a token, a message's text or a phone.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  DEFAULT_NAME, SUBSCRIBED_FIELDS, authUrl, businessIdsOf, subscribedFieldsOf, mergePages, permissionsOf, tokenlessCount, commentThreadId, graphErrorCode, graphPath, hideBody, pagesOf, parseWebhook, privateReplyBody, profileHandle, profileName, publicPages,
  sendBody, statusAfterIn, tokenScopesOf, commentsProbeOf, pulledComments, PULL_WINDOW_MS, postsOf, postOf,
} from '../_shared/cs-channel.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

const ACTIONS = ['status', 'connect_start', 'connect_callback', 'connect_pick', 'disconnect', 'send', 'comment_private', 'comment_hide', 'comments_pull'];
const REDIRECT_DEFAULT = 'https://operation-system.ibtekr.club/meta-callback.html';
const STATE_MINUTES = 10;
const GRAPH_MS = 15_000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f-]{36}$/i;
const redirectUri = (env: Deps['env']) => { const v = (env.META_REDIRECT_URI ?? '').trim(); return /^https:\/\/[^\s]+$/.test(v) ? v : REDIRECT_DEFAULT; };
const appOf = (env: Deps['env']) => { const id = (env.META_APP_ID ?? '').trim(); const secret = (env.META_APP_SECRET ?? '').trim(); return /^\d{5,30}$/.test(id) && secret.length >= 16 ? { id, secret } : null; };
const loginConfig = (env: Deps['env']) => { const v = (env.META_LOGIN_CONFIG_ID ?? '').trim(); return /^\d{5,30}$/.test(v) ? v : null; }; // Facebook Login for Business
const webhookUrl = (env: Deps['env']) => (env.SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1/cs-channel';
export function randomText(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// ---------------------------------------------------------------- the signature of a delivery (constant time over the hex digests)

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function verifySignature(bytes: Uint8Array, header: string, secret: string): Promise<boolean> {
  const given = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())?.[1]?.toLowerCase();
  if (!given) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, bytes as BufferSource));
  let diff = want.length ^ given.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}
export async function signBody(bytes: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, bytes as BufferSource));
}

// ---------------------------------------------------------------- Graph (the page token in the header, never in a url or a log)

class GraphError extends Error { constructor(public code: string, public status: number | null = null) { super(code); this.name = 'GraphError'; } }
type Page = { id: string; name: string; token: string; ig: { id: string; username: string | null } | null };
type Secret = { page?: Page | null; candidates?: Page[]; linked_by?: string; linked_at?: string };

async function graph(deps: Deps, method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string | null; body?: Json; form?: Record<string, string> } = {}): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  let body: string | undefined;
  if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(opts.form).toString(); }
  else if (opts.body) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let res: Response;
  try { res = await f(url, { method, headers, body, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out), res.status);
  return isObj(out) ? out : {};
}
const graphFail = (e: unknown) => {
  if (e instanceof GraphError) return json(e.code === 'graph_timeout' || e.code === 'graph_network' ? 502 : 502, { error: e.code, status: e.status });
  throw e;
};

async function secretGet(deps: Deps): Promise<Secret | null> {
  const { data, error } = await deps.db.rpc('cs_secret_get', { p_name: 'meta_pages' });
  if (error || typeof data !== 'string' || !data) return null;
  try { const j = JSON.parse(data); return isObj(j) ? j as Secret : null; } catch { return null; }
}
async function secretSet(deps: Deps, value: Secret | null) {
  const { error } = await deps.db.rpc('cs_secret_set', { p_name: 'meta_pages', p_value: value === null ? null : JSON.stringify(value) });
  if (error) throw new Error('vault: ' + (error.code ?? 'error'));
}
const pageOf = async (deps: Deps): Promise<Page | null> => { const s = await secretGet(deps); return s && isObj(s.page) && typeof s.page.token === 'string' && typeof s.page.id === 'string' ? s.page : null; };

// ---------------------------------------------------------------- auth of a member

type Who = { uid: string; admin: boolean; view: boolean; viewAll: boolean; reply: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const perm = async (key: string) => { const { data, error } = await member.rpc('has_perm', { key }); return error ? 'N' : String(data ?? 'N'); };
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  const view = admin ? 'F' : await perm('cs.view');
  return { uid, admin, view: view !== 'N', viewAll: view === 'F', reply: admin || (await perm('cs.reply')) === 'F' };
}
// 0034 cs_conv_visible, repeated here on the service client: cs.view F sees every conversation, P the ones assigned to them
const canSee = (who: Who, conv: Json) => who.viewAll || (who.view && conv.assignee === who.uid);
async function logActivity(deps: Deps, who: Who, action: string, entityId: string, value: string | null) {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: who.uid, action, entity: 'cs_channel', entity_id: entityId, new_value: value }); } catch { /* the log never blocks the action */ }
}

// ---------------------------------------------------------------- the webhook → our rows

type Summary = Record<string, number>;
const bump = (s: Summary, k: string) => { s[k] = (s[k] ?? 0) + 1; };
const isoOf = (ms: number | null, deps: Deps) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : deps.now());
const platformOf = (ev: Json): 'messenger' | 'instagram' => (ev.platform === 'instagram' ? 'instagram' : 'messenger'); // a comment on facebook lives on the messenger channel
const sourceOf = (platform: string) => (platform === 'instagram' ? 'إنستجرام' : platform === 'facebook' ? 'فيسبوك' : 'ماسنجر');

// the customer behind a PSID / IGSID: the contact, else a new customer «channel» named from the profile (best effort) + the contact
async function ensureCustomer(deps: Deps, page: Page | null, platform: string, userId: string): Promise<{ id: string; handle: string | null }> {
  const { data: contact } = await deps.db.from('cs_contacts').select('customer_id, handle').eq('platform', platform).eq('external_id', userId).maybeSingle();
  if (isObj(contact) && contact.customer_id) return { id: String(contact.customer_id), handle: contact.handle ? String(contact.handle) : null };
  let name: string | null = null; let handle: string | null = null;
  if (page) { try { const p = await graph(deps, 'GET', graphPath.profile(userId, platform), { token: page.token }); name = profileName(p); handle = profileHandle(p); } catch { name = null; } }
  const row: Json = { name: name ?? (DEFAULT_NAME as Json)[platform] ?? 'عميل', created_from: 'channel', source: sourceOf(platform), created_by: null, created_at: deps.now() };
  if (platform === 'instagram' && handle) row.ig = handle;
  const { data: cu, error } = await deps.db.from('cs_customers').insert(row).select('id').single();
  if (error || !isObj(cu)) throw new Error('cs_customers: ' + (error?.code ?? 'insert'));
  const ins = await deps.db.from('cs_contacts').insert({ customer_id: cu.id, platform, external_id: userId, handle, created_at: deps.now() });
  if (ins.error && ins.error.code === '23505') { // a parallel delivery made it first: use theirs
    const { data: again } = await deps.db.from('cs_contacts').select('customer_id, handle').eq('platform', platform).eq('external_id', userId).maybeSingle();
    if (isObj(again) && again.customer_id) return { id: String(again.customer_id), handle: again.handle ? String(again.handle) : null };
  }
  return { id: String(cu.id), handle };
}
// the conversation of a user on a channel (one per channel + external id), made when missing
async function ensureConversation(deps: Deps, row: Json): Promise<{ id: string; status: string; fresh: boolean }> {
  const { data: found } = await deps.db.from('cs_conversations').select('id, status').eq('channel', row.channel).eq('external_id', row.external_id).maybeSingle();
  if (isObj(found) && found.id) return { id: String(found.id), status: String(found.status), fresh: false };
  const { data: made, error } = await deps.db.from('cs_conversations').insert({ ...row, status: 'جديدة', created_by: null, created_at: deps.now(), updated_at: deps.now() }).select('id, status').single();
  if (error?.code === '23505') { const { data: again } = await deps.db.from('cs_conversations').select('id, status').eq('channel', row.channel).eq('external_id', row.external_id).maybeSingle(); if (isObj(again) && again.id) return { id: String(again.id), status: String(again.status), fresh: false }; }
  if (error || !isObj(made)) throw new Error('cs_conversations: ' + (error?.code ?? 'insert'));
  return { id: String(made.id), status: 'جديدة', fresh: true };
}
async function setStatus(deps: Deps, convId: string, status: string) {
  const { error } = await deps.db.from('cs_conversations').update({ status, snoozed_until: null, updated_at: deps.now() }).eq('id', convId);
  if (error) throw new Error('cs_conversations: ' + (error.code ?? 'update'));
}
// an incoming / echoed message row; false when its external id is already there (a redelivery, or our own send)
async function putMessage(deps: Deps, row: Json): Promise<boolean> {
  const { error } = await deps.db.from('cs_messages').insert(row);
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error('cs_messages: ' + (error.code ?? 'insert'));
}
async function onMessage(deps: Deps, page: Page | null, ev: Json, s: Summary) {
  const platform = platformOf(ev);
  if (ev.echo) {
    const { data: found } = await deps.db.from('cs_conversations').select('id, status').eq('channel', platform).eq('external_id', ev.userId).maybeSingle();
    let conv = isObj(found) && found.id ? { id: String(found.id), status: String(found.status) } : null;
    if (!conv) { const cu = await ensureCustomer(deps, page, platform, ev.userId); conv = await ensureConversation(deps, { seg: 'customers', platform, channel: platform, customer_id: cu.id, external_id: ev.userId, handle: cu.handle }); }
    // our own send whose echo arrived before the Send API's answer was written: the member's row with that text and no id yet takes the mid
    const { data: mine } = await deps.db.from('cs_messages').select('id').eq('conversation_id', conv.id).eq('kind', 'out').eq('text', ev.text).is('external_id', null).not('author', 'is', null).limit(1);
    const own = Array.isArray(mine) && isObj(mine[0]) ? mine[0] : null;
    if (own) { const { error } = await deps.db.from('cs_messages').update({ external_id: ev.mid, delivery: 'sent' }).eq('id', own.id); if (error && error.code !== '23505') throw new Error('cs_messages: ' + error.code); bump(s, 'ignored'); return; }
    const put = await putMessage(deps, { conversation_id: conv.id, kind: 'out', text: ev.text, author: null, external_id: ev.mid, delivery: 'sent', meta: { echo: true, attachments: ev.attachments, at: ev.at }, created_at: isoOf(ev.at, deps) });
    if (!put) { bump(s, 'ignored'); return; } // our own send (its mid is on the row already)
    if (conv.status !== 'مستنية العميل' && conv.status !== 'اتحلت') await setStatus(deps, conv.id, 'مستنية العميل');
    bump(s, 'echoes'); return;
  }
  const cu = await ensureCustomer(deps, page, platform, ev.userId);
  const conv = await ensureConversation(deps, { seg: 'customers', platform, channel: platform, customer_id: cu.id, external_id: ev.userId, handle: cu.handle });
  const put = await putMessage(deps, { conversation_id: conv.id, kind: 'in', text: ev.text, author: null, external_id: ev.mid, delivery: null, meta: { attachments: ev.attachments, reply_to: ev.replyTo, at: ev.at, ...(ev.unsupported ? { unsupported: true } : {}) }, created_at: isoOf(ev.at, deps) });
  if (!put) { bump(s, 'duplicates'); return; }
  const next = statusAfterIn(conv.fresh ? null : conv.status);
  if (next !== conv.status) await setStatus(deps, conv.id, next);
  bump(s, 'messages');
}
async function onReceipt(deps: Deps, ev: Json, s: Summary) {
  const platform = platformOf(ev);
  const { data: found } = await deps.db.from('cs_conversations').select('id').eq('channel', platform).eq('external_id', ev.userId).maybeSingle();
  if (!isObj(found) || !found.id || ev.watermark == null) { bump(s, 'ignored'); return; }
  const to = ev.type === 'read' ? 'read' : 'delivered'; const from = ev.type === 'read' ? ['sent', 'delivered'] : ['sent'];
  const { error } = await deps.db.from('cs_messages').update({ delivery: to }).eq('conversation_id', found.id).eq('kind', 'out').in('delivery', from).lte('created_at', isoOf(ev.watermark, deps));
  if (error) throw new Error('cs_messages: ' + (error.code ?? 'update'));
  bump(s, ev.type === 'read' ? 'reads' : 'deliveries');
}
// decision 19: a post not kept yet is read once from Graph (best effort — a comment never fails on it)
async function ensurePost(deps: Deps, page: Page, postId: string, platform: string) {
  try {
    if (!postId || !/^[0-9_]{1,80}$/.test(postId)) return;
    const { data: had } = await deps.db.from('cs_posts').select('id').eq('id', postId).maybeSingle();
    if (isObj(had)) return;
    const row = postOf(await graph(deps, 'GET', graphPath.post(postId, platform), { token: page.token }), platform);
    if (row) await deps.db.from('cs_posts').upsert({ ...row, seen_at: deps.now() }, { onConflict: 'id' });
  } catch { /* the post card stays empty */ }
}
async function onComment(deps: Deps, page: Page | null, ev: Json, s: Summary) {
  const platform = ev.platform === 'instagram' ? 'instagram' : 'facebook'; const channel = platform === 'instagram' ? 'instagram' : 'messenger';
  const ours = !!ev.fromId && !!page && (ev.fromId === page.id || (page.ig && ev.fromId === page.ig.id));
  if (ev.removed) { bump(s, 'ignored:removed'); return; }
  if (ours) { // the page's own reply: an echo on the thread of the parent comment
    const { data: parent } = ev.parentId ? await deps.db.from('cs_messages').select('conversation_id').eq('external_id', ev.parentId).maybeSingle() : { data: null };
    if (!isObj(parent) || !parent.conversation_id) { bump(s, 'ignored:page_comment'); return; }
    const put = await putMessage(deps, { conversation_id: parent.conversation_id, kind: 'out', text: ev.text, author: null, external_id: ev.commentId, delivery: 'sent', meta: { echo: true, comment_id: ev.commentId, post_id: ev.postId, parent_id: ev.parentId }, created_at: isoOf(ev.at, deps) });
    bump(s, put ? 'echoes' : 'ignored'); return;
  }
  if (ev.edited) {
    const { error } = await deps.db.from('cs_messages').update({ text: ev.text || '[تعليق]' }).eq('external_id', ev.commentId).eq('kind', 'in');
    if (error) throw new Error('cs_messages: ' + (error.code ?? 'update'));
    bump(s, 'edits'); return;
  }
  if (!ev.pulled && page) await ensurePost(deps, page, ev.postId, platform); // a webhook comment: the post it is on, once
  const topId = ev.parentId && ev.parentId !== ev.postId ? ev.parentId : ev.commentId; // a hidden commenter: the thread of the top-level comment
  const threadId = commentThreadId(ev.postId, ev.fromId, ev.fromId ? null : topId);
  const conv = await ensureConversation(deps, { seg: 'comments', platform, channel, customer_id: null, external_id: threadId, handle: ev.fromName });
  const put = await putMessage(deps, { conversation_id: conv.id, kind: 'in', text: ev.text, author: null, external_id: ev.commentId, delivery: null, meta: { comment_id: ev.commentId, post_id: ev.postId, parent_id: ev.parentId, from_id: ev.fromId, at: ev.at }, created_at: isoOf(ev.at, deps) });
  if (!put) { bump(s, 'duplicates'); return; }
  const next = statusAfterIn(conv.fresh ? null : conv.status);
  if (next !== conv.status) await setStatus(deps, conv.id, next);
  bump(s, 'comments');
}

async function logEvent(deps: Deps, row: Json) {
  try { await deps.db.from('cs_channel_events').insert({ received_at: deps.now(), ...row }); } catch { console.error('cs_channel_events insert failed'); }
}
async function webhook(req: Request, deps: Deps): Promise<Response> {
  const secret = (deps.env.META_APP_SECRET ?? '').trim();
  if (!secret) { await logEvent(deps, { object: 'unknown', status: 'error', error: 'not_configured' }); return json(500, { error: 'not_configured' }); }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(bytes, req.headers.get('x-hub-signature-256') ?? '', secret))) { await logEvent(deps, { object: 'unknown', status: 'error', error: 'bad_signature' }); return json(401, { error: 'bad_signature' }); }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { await logEvent(deps, { object: 'unknown', status: 'error', error: 'bad_json' }); return json(200, { status: 'ignored' }); }
  const parsed = parseWebhook(body);
  if (!parsed) { await logEvent(deps, { object: isObj(body) && typeof body.object === 'string' ? body.object.slice(0, 40) : 'unknown', status: 'ignored', error: 'unknown_object' }); return json(200, { status: 'ignored' }); }
  // the linked page is the only tenant: nothing is written before a page is linked, and only its own entries (the page's id, or
  // its Instagram account's id) are read — another page the app happens to be subscribed to is ignored
  const page = await pageOf(deps);
  if (!page) { await logEvent(deps, { object: parsed.object, status: 'ignored', error: 'not_linked', summary: { entries: parsed.entries.length } }); return json(200, { status: 'ignored' }); }
  let failed = false;
  for (const entry of parsed.entries) {
    const s: Summary = {}; let error: string | null = null;
    if (entry.id !== page.id && entry.id !== page.ig?.id) { await logEvent(deps, { object: parsed.object, entry_id: entry.id, status: 'ignored', error: 'other_page', summary: { events: entry.events.length } }); continue; }
    for (const ev of entry.events) {
      try {
        if (ev.type === 'message') await onMessage(deps, page, ev, s);
        else if (ev.type === 'delivery' || ev.type === 'read') await onReceipt(deps, ev, s);
        else if (ev.type === 'comment') await onComment(deps, page, ev, s);
        else bump(s, 'ignored:' + String(ev.field ?? 'other').replace(/[^a-z_]/g, '').slice(0, 30));
      } catch (e) { failed = true; bump(s, 'errors'); error = String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200); console.error('cs-channel webhook: ' + error); }
    }
    const handled = Object.keys(s).some((k) => !k.startsWith('ignored') && !['duplicates', 'errors'].includes(k));
    await logEvent(deps, { object: parsed.object, entry_id: entry.id, status: error ? 'error' : handled ? 'ok' : 'ignored', error, summary: s });
  }
  return failed ? json(500, { status: 'error' }) : json(200, { status: 'ok' });
}

// ---------------------------------------------------------------- the comments pull (decision 18: cron every minute, X-Sync-Secret)

async function commentsPull(deps: Deps): Promise<Response> {
  const page = await pageOf(deps);
  if (!page) return json(200, { result: 'skipped', reason: 'not_linked' });
  const s: Summary = {}; let error: string | null = null;
  const read = async (url: string) => { try { return await graph(deps, 'GET', url, { token: page.token }); } catch (e) { error = (e instanceof GraphError ? e.code : 'error'); bump(s, 'errors'); return null; } };
  const feed = await read(graphPath.feedPull(page.id));
  const media = page.ig ? await read(graphPath.mediaPull(page.ig.id)) : null;
  const events = pulledComments(feed, media, page.id, Date.parse(deps.now()) - PULL_WINDOW_MS);
  // the posts that carry comments (decision 19): their caption / link / picture kept fresh for the comments conversations
  const posts = postsOf(feed, media);
  if (posts.length) { const { error: pe } = await deps.db.from('cs_posts').upsert(posts.map((p) => ({ ...p, seen_at: deps.now() })), { onConflict: 'id' }); if (pe) console.error('cs_posts: ' + (pe.code ?? 'upsert') + ' ' + String(pe.message ?? '').replace(/"[^"]*"/g, '"…"').slice(0, 160)); } // the value never in the log
  // the ones already in the inbox (pulled before, or delivered by a webhook) are skipped before any write
  const ids = events.map((e) => e.commentId);
  const known = new Set<string>();
  if (ids.length) { const { data } = await deps.db.from('cs_messages').select('external_id').in('external_id', ids); (Array.isArray(data) ? data : []).forEach((r: Json) => known.add(String(r.external_id))); }
  for (const ev of events) {
    if (known.has(ev.commentId)) continue;
    try { await onComment(deps, page, ev, s); } catch (e) { bump(s, 'errors'); error = String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200); }
  }
  // a row only when something came in or failed (not one a minute for nothing)
  if (Object.keys(s).length) await logEvent(deps, { object: 'pull', entry_id: page.id, status: error ? 'error' : Object.keys(s).some((k) => !k.startsWith('ignored') && k !== 'duplicates' && k !== 'errors') ? 'ok' : 'ignored', error, summary: { ...s, seen: events.length } });
  return json(200, { result: 'ok', seen: events.length, summary: s });
}
async function syncAllowed(deps: Deps, secret: string) {
  const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
  return !error && data === true;
}

// ---------------------------------------------------------------- the members' actions

async function channelsOf(deps: Deps) {
  const { data } = await deps.db.from('cs_channels').select('id, name, status, number, since, last_message_at, meta').in('id', ['messenger', 'instagram']);
  return (Array.isArray(data) ? data : []).map((r: Json) => ({ id: r.id, name: r.name, status: r.status, number: r.number ?? null, since: r.since ?? null, last_message_at: r.last_message_at ?? null }));
}
async function status(deps: Deps, who: Who) {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const page = await pageOf(deps);
  const out: Json = { result: 'ok', linked: !!page, channels: await channelsOf(deps) };
  if (who.admin) {
    out.configured = !!appOf(deps.env); out.verify_configured = !!(deps.env.META_VERIFY_TOKEN ?? '').trim(); out.login_config = !!loginConfig(deps.env); out.redirect = redirectUri(deps.env); out.webhook_url = webhookUrl(deps.env); out.page = page ? { id: page.id, name: page.name, ig: page.ig } : null;
    // the page's live subscription to this app (Graph): the fields, re-subscribed once when one is missing; the permissions the link holds
    if (page) {
      const app = appOf(deps.env);
      const read = async () => { try { return subscribedFieldsOf(await graph(deps, 'GET', graphPath.subscribedFields(page.id), { token: page.token }), app?.id ?? ''); } catch { return null; } };
      let fields = await read();
      if (fields && SUBSCRIBED_FIELDS.some((x) => !fields!.includes(x))) {
        try { await graph(deps, 'POST', graphPath.subscribe(page.id), { token: page.token, form: { subscribed_fields: SUBSCRIBED_FIELDS.join(',') } }); out.resubscribed = true; fields = await read(); } catch (e) { out.resubscribe_error = e instanceof GraphError ? e.code : 'error'; }
      }
      out.subscribed_fields = fields;
      // the scopes of the page token: debug_token with the app token (/me/permissions does not answer a page token)
      let scopes: Json | null = null;
      try { scopes = app ? tokenScopesOf(await graph(deps, 'GET', graphPath.debugToken(page.token), { token: app.id + '|' + app.secret })) : null; } catch (e) { out.scopes_error = e instanceof GraphError ? e.code : 'error'; }
      out.missing_permissions = scopes ? scopes.missing : null;
      // the comments probe (decision 17): can the app see the latest comments and their commenter — counts only, logged for the diagnosis
      const own = [page.id, page.ig?.id].filter(Boolean) as string[];
      const probe = async (url: string, platform: string) => { try { return commentsProbeOf(await graph(deps, 'GET', url, { token: page.token }), platform, own); } catch (e) { return { error: e instanceof GraphError ? e.code : 'error' }; } };
      const fb = await probe(graphPath.feedProbe(page.id), 'facebook');
      const ig = page.ig ? await probe(graphPath.mediaProbe(page.ig.id), 'instagram') : null;
      out.comments_probe = { facebook: fb, instagram: ig };
      await logEvent(deps, { object: 'probe', entry_id: page.id, status: 'ok', summary: { facebook: fb, instagram: ig, fields: fields ?? null, scopes: scopes ? scopes.granted : null, token_valid: scopes ? scopes.valid : null } });
    }
  }
  return json(200, out);
}
async function connectStart(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const app = appOf(deps.env); if (!app) return json(503, { error: 'not_configured', configured: false });
  const channel = args.channel === 'instagram' ? 'instagram' : args.channel === 'messenger' || args.channel == null ? 'messenger' : null;
  if (!channel) return json(400, { error: 'bad_request', field: 'channel' });
  const state = randomText();
  const { error } = await deps.db.from('cs_oauth_states').insert({ state, verifier: randomText(48), channel, created_by: who.uid, created_at: deps.now() });
  if (error) return json(500, { error: 'failed' });
  return json(200, { result: 'ok', url: authUrl(app.id, redirectUri(deps.env), state, loginConfig(deps.env)), channel });
}
// the page linked: subscribed to the app's webhooks, kept in Vault, the channels connected
async function linkPage(deps: Deps, who: Who, page: Page) {
  try { await graph(deps, 'POST', graphPath.subscribe(page.id), { token: page.token, form: { subscribed_fields: SUBSCRIBED_FIELDS.join(',') } }); } catch (e) { return graphFail(e); }
  const before = await pageOf(deps); // another page linked before: its subscription goes (best effort), so only one page feeds the inbox
  if (before && before.id !== page.id) { try { await graph(deps, 'DELETE', graphPath.subscribe(before.id), { token: before.token }); } catch { /* the old token may be gone */ } }
  await secretSet(deps, { page, linked_by: who.uid, linked_at: deps.now() });
  const meta = { page_id: page.id, page_name: page.name, ig_id: page.ig?.id ?? null, ig_username: page.ig?.username ?? null, fields: SUBSCRIBED_FIELDS };
  const now = deps.now();
  await deps.db.from('cs_channels').update({ status: 'connected', number: page.name, since: now, meta, updated_at: now }).eq('id', 'messenger');
  await deps.db.from('cs_channels').update(page.ig ? { status: 'connected', number: page.ig.username ? '@' + page.ig.username : page.ig.id, since: now, meta, updated_at: now } : { status: 'disconnected', number: null, since: null, meta: { ...meta, note: 'no_instagram_account' }, updated_at: now }).eq('id', 'instagram');
  await logActivity(deps, who, 'cs.channel.connect', 'messenger', page.name + (page.ig ? ' + instagram' : ''));
  return json(200, { result: 'ok', linked: true, page: { id: page.id, name: page.name, ig: page.ig }, instagram: !!page.ig, channels: await channelsOf(deps) });
}
async function connectCallback(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const app = appOf(deps.env); if (!app) return json(503, { error: 'not_configured', configured: false });
  const code = typeof args.code === 'string' && /^[A-Za-z0-9._~#-]{8,2048}$/.test(args.code) ? args.code : null;
  const state = typeof args.state === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(args.state) ? args.state : null;
  if (!code) return json(400, { error: 'bad_request', field: 'code' });
  if (!state) return json(400, { error: 'bad_request', field: 'state' });
  const { data: found } = await deps.db.from('cs_oauth_states').select('state, created_at, used_at').eq('state', state).maybeSingle();
  const row = isObj(found) ? { createdAt: String(found.created_at ?? ''), used: !!found.used_at } : null;
  if (row && !row.used) await deps.db.from('cs_oauth_states').update({ used_at: deps.now() }).eq('state', state); // spent, whatever follows
  if (!row || row.used || Date.parse(deps.now()) - Date.parse(row.createdAt) > STATE_MINUTES * 60_000) return json(400, { error: 'bad_request', field: 'state' });
  let pages: Page[] = []; let seen = 0; let perms: { granted: string[]; declined: string[]; missing: string[] } | null = null;
  try {
    const short = await graph(deps, 'GET', graphPath.tokenExchange(app.id, redirectUri(deps.env), code) + encodeURIComponent(app.secret));
    if (typeof short.access_token !== 'string' || !short.access_token) throw new GraphError('graph_no_token');
    const long = await graph(deps, 'GET', graphPath.longLived(app.id) + encodeURIComponent(app.secret) + '&fb_exchange_token=' + encodeURIComponent(short.access_token));
    const userToken = typeof long.access_token === 'string' && long.access_token ? long.access_token : short.access_token;
    const accounts = await graph(deps, 'GET', graphPath.accounts(), { token: userToken });
    pages = pagesOf(accounts); seen = tokenlessCount(accounts);
    if (!pages.length) { // a page owned by a Business Portfolio: through the portfolio's pages (business_management), best effort
      const found: Page[][] = [];
      try {
        for (const biz of businessIdsOf(await graph(deps, 'GET', graphPath.businesses(), { token: userToken }))) {
          for (const kind of ['owned', 'client']) { try { found.push(pagesOf(await graph(deps, 'GET', graphPath.businessPages(biz, kind), { token: userToken }))); } catch { /* not this kind */ } }
        }
      } catch { /* no business_management */ }
      pages = mergePages(...found);
    }
    if (!pages.length) { try { perms = permissionsOf(await graph(deps, 'GET', graphPath.permissions(), { token: userToken })); } catch { perms = null; } }
  } catch (e) { return graphFail(e); }
  // nothing to link: the diagnosis for the admin — how many pages came without a token, the permissions granted / declined / missing (names only)
  if (!pages.length) return json(400, { error: 'no_pages', seen, granted: perms?.granted ?? null, declined: perms?.declined ?? null, missing: perms?.missing ?? null });
  if (pages.length === 1) return linkPage(deps, who, pages[0]);
  await secretSet(deps, { page: (await pageOf(deps)) ?? null, candidates: pages });
  return json(200, { result: 'choose', pages: publicPages(pages) });
}
async function connectPick(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const id = typeof args.page_id === 'string' && /^\d{1,30}$/.test(args.page_id) ? args.page_id : null;
  if (!id) return json(400, { error: 'bad_request', field: 'page_id' });
  const s = await secretGet(deps); const page = (Array.isArray(s?.candidates) ? s!.candidates! : []).find((p) => isObj(p) && p.id === id && typeof p.token === 'string');
  if (!page) return json(404, { error: 'not_found' });
  return linkPage(deps, who, page);
}
async function disconnect(deps: Deps, who: Who) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const page = await pageOf(deps);
  if (page) { try { await graph(deps, 'DELETE', graphPath.subscribe(page.id), { token: page.token }); } catch { /* best effort: the token may be gone already */ } }
  await secretSet(deps, null);
  const now = deps.now();
  await deps.db.from('cs_channels').update({ status: 'disconnected', number: null, since: null, meta: {}, updated_at: now }).in('id', ['messenger', 'instagram']);
  await logActivity(deps, who, 'cs.channel.disconnect', 'messenger', page ? page.name : null);
  return json(200, { result: 'ok', linked: false, channels: await channelsOf(deps) });
}

// the member's queued message with its conversation (a Meta channel, the member's own row)
async function queuedOf(deps: Deps, who: Who, args: Json) {
  const id = typeof args.message_id === 'string' && UUID.test(args.message_id) ? args.message_id : null;
  if (!id) return { res: json(400, { error: 'bad_request', field: 'message_id' }) };
  const { data: m } = await deps.db.from('cs_messages').select('id, conversation_id, kind, text, author, delivery, meta').eq('id', id).maybeSingle();
  if (!isObj(m)) return { res: json(404, { error: 'not_found' }) };
  if (m.kind !== 'out' || m.delivery !== 'queued') return { res: json(409, { error: 'not_queued', delivery: m.delivery ?? null }) };
  if (!who.admin && m.author && m.author !== who.uid) return { res: json(401, { error: 'unauthorized' }) };
  const { data: v } = await deps.db.from('cs_conversations').select('id, seg, platform, channel, external_id, status, assignee').eq('id', m.conversation_id).maybeSingle();
  if (!isObj(v) || !canSee(who, v)) return { res: json(404, { error: 'not_found' }) };
  if (v.channel !== 'messenger' && v.channel !== 'instagram') return { res: json(400, { error: 'bad_request', field: 'channel' }) };
  return { msg: m, conv: v };
}
async function lastIncomingComment(deps: Deps, convId: string) {
  const { data } = await deps.db.from('cs_messages').select('id, external_id, meta, created_at').eq('conversation_id', convId).eq('kind', 'in').order('created_at', { ascending: false }).limit(1);
  const r = Array.isArray(data) ? data[0] : null;
  return isObj(r) && r.external_id ? String(r.external_id) : null;
}
async function settle(deps: Deps, msg: Json, patch: Json) {
  const { error } = await deps.db.from('cs_messages').update(patch).eq('id', msg.id);
  if (error?.code === '23505' && 'external_id' in patch) { // the echo of this very send landed first and holds the id: keep the delivery only
    const rest: Json = {}; for (const k of Object.keys(patch)) if (k !== 'external_id') rest[k] = patch[k];
    const again = await deps.db.from('cs_messages').update(rest).eq('id', msg.id);
    if (!again.error) return;
    throw new Error('cs_messages: ' + (again.error.code ?? 'update'));
  }
  if (error) throw new Error('cs_messages: ' + (error.code ?? 'update'));
}
async function deliver(deps: Deps, who: Who, args: Json, mode: 'send' | 'private') {
  if (!who.reply) return json(401, { error: 'unauthorized' });
  const q = await queuedOf(deps, who, args); if (q.res) return q.res;
  const { msg, conv } = q as { msg: Json; conv: Json };
  const page = await pageOf(deps); if (!page) return json(503, { error: 'not_linked' });
  const meta = isObj(msg.meta) ? msg.meta : {};
  try {
    let out: Json;
    if (conv.seg === 'comments') {
      const commentId = await lastIncomingComment(deps, conv.id);
      if (!commentId) return json(409, { error: 'no_comment' });
      out = mode === 'private'
        ? await graph(deps, 'POST', graphPath.send(), { token: page.token, body: privateReplyBody(commentId, msg.text) })
        : await graph(deps, 'POST', graphPath.commentReply(commentId, conv.platform), { token: page.token, body: { message: msg.text } });
      const id = typeof out.id === 'string' ? out.id : typeof out.message_id === 'string' ? out.message_id : null;
      await settle(deps, msg, { delivery: 'sent', external_id: id, meta: { ...meta, ...(mode === 'private' ? { private: true } : { reply_to_comment: commentId }) } });
      await logActivity(deps, who, mode === 'private' ? 'cs.channel.private' : 'cs.channel.send', conv.id, conv.platform);
      return json(200, { result: 'ok', delivery: 'sent', external_id: id, private: mode === 'private' });
    }
    if (mode === 'private') return json(400, { error: 'bad_request', field: 'conversation' });
    if (!conv.external_id) return json(409, { error: 'no_thread' });
    out = await graph(deps, 'POST', graphPath.send(), { token: page.token, body: sendBody(String(conv.external_id), msg.text) });
    const id = typeof out.message_id === 'string' ? out.message_id : null;
    await settle(deps, msg, { delivery: 'sent', external_id: id });
    await logActivity(deps, who, 'cs.channel.send', conv.id, conv.platform);
    return json(200, { result: 'ok', delivery: 'sent', external_id: id });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    await settle(deps, msg, { delivery: 'failed', meta: { ...meta, error: e.code } });
    await logActivity(deps, who, 'cs.channel.failed', conv.id, e.code);
    return json(502, { error: e.code, status: e.status, delivery: 'failed' });
  }
}
async function commentHide(deps: Deps, who: Who, args: Json) {
  if (!who.reply) return json(401, { error: 'unauthorized' });
  const id = typeof args.conversation_id === 'string' && UUID.test(args.conversation_id) ? args.conversation_id : null;
  if (!id) return json(400, { error: 'bad_request', field: 'conversation_id' });
  const { data: v } = await deps.db.from('cs_conversations').select('id, seg, platform, channel, assignee').eq('id', id).maybeSingle();
  if (!isObj(v) || !canSee(who, v)) return json(404, { error: 'not_found' });
  if (v.seg !== 'comments') return json(400, { error: 'bad_request', field: 'conversation' });
  const page = await pageOf(deps); if (!page) return json(503, { error: 'not_linked' });
  const commentId = await lastIncomingComment(deps, id); if (!commentId) return json(409, { error: 'no_comment' });
  try { await graph(deps, 'POST', graphPath.commentHide(commentId), { token: page.token, body: hideBody(v.platform) }); } catch (e) { return graphFail(e); }
  await deps.db.from('cs_messages').insert({ conversation_id: id, kind: 'event', text: 'التعليق اتخفى من على البوست', author: who.uid, delivery: null, meta: { hidden: commentId }, created_at: deps.now() });
  await logActivity(deps, who, 'cs.channel.hide', id, v.platform);
  return json(200, { result: 'ok', hidden: commentId });
}

// ---------------------------------------------------------------- entry

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method === 'GET') {
    const u = new URL(req.url); const token = (deps.env.META_VERIFY_TOKEN ?? '').trim();
    if (u.searchParams.get('hub.mode') === 'subscribe' && token && u.searchParams.get('hub.verify_token') === token && u.searchParams.get('hub.challenge')) {
      return new Response(String(u.searchParams.get('hub.challenge')).slice(0, 200), { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return json(403, { error: 'verify_failed' });
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!req.headers.get('authorization') && req.headers.get('x-hub-signature-256')) return webhook(req, deps);
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(body) ? body : {};
  const action = typeof args.action === 'string' ? args.action : '';
  // the cron (decision 18): the sync secret of 0008 (Vault), the comments pull only — never a member's action
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (action !== 'comments_pull' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return await commentsPull(deps); } catch (e) { console.error('cs-channel comments_pull: ' + String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'status') return await status(deps, who);
    if (action === 'connect_start') return await connectStart(deps, who, args);
    if (action === 'connect_callback') return await connectCallback(deps, who, args);
    if (action === 'connect_pick') return await connectPick(deps, who, args);
    if (action === 'disconnect') return await disconnect(deps, who);
    if (action === 'send') return await deliver(deps, who, args, 'send');
    if (action === 'comment_private') return await deliver(deps, who, args, 'private');
    if (action === 'comments_pull') return who.admin ? await commentsPull(deps) : json(401, { error: 'unauthorized' }); // the admin, by hand
    return await commentHide(deps, who, args);
  } catch (e) {
    console.error('cs-channel ' + action + ': ' + String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
