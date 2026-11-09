// cs-whatsapp: WhatsApp 1 (the customers) on Meta's WhatsApp Cloud API by coexistence — phase 6, decision 26 of
// docs/superpowers/plans/2026-11-02-phase-6-customer-service.md (the owner, 4 Nov: his WhatsApp Business number, with its chats,
// in the system). The number stays on the WhatsApp Business app on the phone; this function receives what Meta sends for it and
// sends the members' replies from it. Deployed with verify_jwt false; it authenticates each request itself:
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   Meta's webhook verification (META_VERIFY_TOKEN).
//   POST with X-Hub-Signature-256 and no Authorization              a delivery of the WhatsApp product (object whatsapp_business_account;
//        HMAC-SHA256 with META_APP_SECRET, constant time) — only the linked account's entries (its WABA id), nothing before a link:
//        messages            a customer's message → the customer by phone (cs_customers; a new one `channel` named from the profile)
//                            + the contact → the conversation wa1 (one per phone) → an `in` message (the wamid: a redelivery is a
//                            duplicate); «إيقاف» = consent off; the statuses of ours → the delivery (sent → delivered → read, failed + code).
//        smb_message_echoes  a reply sent from the phone → an `out` message without an author.
//        history             the last six months the phone shares once after the link → the conversations (a new one closed) and their
//                            messages at their own time (meta.history — 0043's touch leaves unread / waiting alone), in batches;
//                            the progress / a declined share → cs_channels wa1 meta.history.
//        smb_app_state_sync  the phone's contacts → the name of a customer still called «عميل واتساب» (no customer is made from a contact).
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status           (cs.view ≠ N) → wa1's state; the admin also: configured (the app, META_WA_CONFIG_ID), the webhook url, the
//                      number (Graph: still on the Business app?) and the history progress.
//     connect_start    (the admin) → the Embedded Signup dialog (META_WA_CONFIG_ID, the WhatsApp Business app option), a state «wa_…»
//                      kept ten minutes (cs_oauth_states channel wa1).
//     connect_callback (the admin) { code, state } → the business token → its WABA (debug_token) → the number → the app subscribed to
//                      the WABA → Vault (meta_wa) → wa1 connected → the contacts and the history asked for (within Meta's 24 hours).
//     connect_token    (the admin) { token, waba_id, phone_id } → a number linked by hand with a token from Meta's API Setup (no sync).
//     sync             (the admin) { type: 'history' | 'contacts' } → asked again (Meta answers once per number).
//     disconnect       (the admin) → the subscription removed (best effort), the secret removed, wa1 disconnected.
//     send             (cs.reply, on a wa1 conversation the member sees, their own queued row unless the admin) { message_id } →
//                      POST /{phone}/messages (text) → sent + the wamid; a refusal (e.g. 131047: past the 24 hours) → failed + code, 502.
//     media_url        (cs.view, on a conversation the member sees) { message_id } → a customer's media (meta.media_id) fetched from Meta
//                      once into the private bucket cs-media (inbound/<message id>), then a signed link (one hour) — phase 13 T3.
//     send with meta.media (phase 13 T3): the member's attachment in cs-media goes out as an image / document by a signed link.
//     campaign_test    (cs.manage) { template_id, phone, code? } → the approved Meta template to one number with sample values.
//     campaign_tick    (the admin; or the cron with X-Sync-Secret, every minute — 0063) → the campaigns on wa1 (phase 13 T1, decisions
//                      1–3 of docs/superpowers/plans/2026-11-09-phase-13-leftovers.md): nothing while settings «cs».live.campaigns is
//                      off or outside the auto-reply hours; a due «مجدولة» becomes «شغالة»; each running campaign sends up to
//                      perTick(min_delay_s) approved templates (cap_per_day by the Cairo day; the consent / block / merge re-checked at
//                      send time) as `out` rows without an author in the customer's wa1 conversation (meta.campaign_id / recipient_id;
//                      the receipts update the row and the recipient); failures over 2% after 20 pause it; an emptied queue ends it.
// Secrets: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN (shared with cs-channel), META_WA_CONFIG_ID (the Embedded Signup
// configuration); the owner sets them. Nothing here logs a token, a phone or a message's text.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { EXTRAS, STATE_PREFIX, WA_GRAPH, WA_GRAPH_VERSION, graphErrorCode, mediaBody, parseWaWebhook, phoneOfWaId, phonesOf, sentIdOf, syncBody, textBody, waAuthUrl, waIdOfPhone, wabaIdsOf, waPath } from '../_shared/cs-whatsapp.js';
import { CLAIM_MS, cairoDayStart, isOptOut } from '../_shared/cs-wa.js';
import { DAY, inHours, settingsOf, templateBody } from '../_shared/cs-auto.js';
import { DONE_STATUSES, REPLY_WINDOW_DAYS, SAMPLE_VARS, TICK_BUDGET_MS, campaignParams, campaignPreview, campaignStats, nextStatus, perTick, recipientAfter, templateOk } from '../_shared/cs-campaign.js';
import { inboundSafe } from '../_shared/cs-auto-run.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>; // the pause between two campaign sends (the tests pass a no-op)
};

const ACTIONS = ['status', 'connect_start', 'connect_callback', 'connect_token', 'sync', 'disconnect', 'send', 'campaign_test', 'campaign_tick', 'media_url'];
const MEDIA_BUCKET = 'cs-media'; const MEDIA_SIGN_SECONDS = 3600; const MEDIA_MAX = 10 * 1024 * 1024;
const REDIRECT_DEFAULT = 'https://operation-system.ibtekr.club/meta-callback.html';
const STATE_MINUTES = 10;
const GRAPH_MS = 15_000;
const BATCH = 200;
const DEFAULT_NAME = 'عميل واتساب';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f-]{36}$/i;
const redirectUri = (env: Deps['env']) => { const v = (env.META_REDIRECT_URI ?? '').trim(); return /^https:\/\/[^\s]+$/.test(v) ? v : REDIRECT_DEFAULT; };
const appOf = (env: Deps['env']) => { const id = (env.META_APP_ID ?? '').trim(); const secret = (env.META_APP_SECRET ?? '').trim(); return /^\d{5,30}$/.test(id) && secret.length >= 16 ? { id, secret } : null; };
const configOf = (env: Deps['env']) => { const v = (env.META_WA_CONFIG_ID ?? '').trim(); return /^\d{5,30}$/.test(v) ? v : null; };
const webhookUrl = (env: Deps['env']) => (env.SUPABASE_URL ?? '').replace(/\/$/, '') + '/functions/v1/cs-whatsapp';
const errText = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const iso = (ms: number | null, deps: Deps) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : deps.now());
export function randomText(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// ---------------------------------------------------------------- the signature (constant time over the hex digests)
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(bytes: Uint8Array, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, bytes as BufferSource));
}
export async function verifySignature(bytes: Uint8Array, header: string, secret: string): Promise<boolean> {
  const given = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())?.[1]?.toLowerCase();
  if (!given) return false;
  const want = await hmac(bytes, secret);
  let diff = want.length ^ given.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}
export const signBody = async (bytes: Uint8Array, secret: string) => 'sha256=' + await hmac(bytes, secret);

// ---------------------------------------------------------------- Graph (the token in the header, never in a url or a log)
class GraphError extends Error { constructor(public code: string, public status: number | null = null) { super(code); this.name = 'GraphError'; } }
async function graph(deps: Deps, method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string | null; body?: Json } = {}): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  if (opts.body) headers['content-type'] = 'application/json';
  let res: Response;
  try { res = await f(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out), res.status);
  return isObj(out) ? out : {};
}
const graphFail = (e: unknown) => { if (e instanceof GraphError) return json(502, { error: e.code, status: e.status }); throw e; };

type Link = { token: string; waba_id: string; phone_id: string; display: string | null; name: string | null; linked_by?: string; linked_at?: string };
async function linkOf(deps: Deps): Promise<Link | null> {
  const { data, error } = await deps.db.rpc('cs_secret_get', { p_name: 'meta_wa' });
  if (error || typeof data !== 'string' || !data) return null;
  try { const j = JSON.parse(data); return isObj(j) && typeof j.token === 'string' && typeof j.waba_id === 'string' && typeof j.phone_id === 'string' ? j as Link : null; } catch { return null; }
}
async function linkSet(deps: Deps, v: Link | null) {
  const { error } = await deps.db.rpc('cs_secret_set', { p_name: 'meta_wa', p_value: v === null ? null : JSON.stringify(v) });
  if (error) throw new Error('vault: ' + (error.code ?? 'error'));
}

// ---------------------------------------------------------------- auth of a member
type Who = { uid: string; admin: boolean; view: boolean; viewAll: boolean; reply: boolean; manage: boolean };
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
  return { uid, admin, view: view !== 'N', viewAll: view === 'F', reply: admin || (await perm('cs.reply')) === 'F', manage: admin || (await perm('cs.manage')) === 'F' };
}
// the cron's door (0063): the sync secret of 0008, compared on the server
async function syncAllowed(deps: Deps, secret: string) { const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret }); return !error && data === true; }
// settings «cs»: the live switches (decision 24 of phase 6) and the auto-reply sending settings (the hours the campaigns keep too)
async function csSettings(deps: Deps) {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'cs').maybeSingle();
  const d = isObj(data) && isObj(data.data) ? data.data : {}; const l = isObj(d.live) ? d.live : {};
  return { live: { wa: l.wa === true, campaigns: l.campaigns === true }, auto: settingsOf(d.auto) };
}
const canSee = (who: Who, conv: Json) => who.viewAll || (who.view && conv.assignee === who.uid);
async function logActivity(deps: Deps, who: Who, action: string, entityId: string, value: string | null) {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: who.uid, action, entity: 'cs_channel', entity_id: entityId, new_value: value }); } catch { /* never blocks */ }
}
async function logEvent(deps: Deps, row: Json) {
  try { await deps.db.from('cs_channel_events').insert({ received_at: deps.now(), ...row }); } catch { console.error('cs_channel_events insert failed'); }
}
async function channelMeta(deps: Deps): Promise<Json> {
  const { data } = await deps.db.from('cs_channels').select('meta').eq('id', 'wa1').maybeSingle();
  return isObj(data) && isObj(data.meta) ? data.meta : {};
}
async function patchMeta(deps: Deps, patch: Json) {
  const meta = { ...(await channelMeta(deps)), ...patch };
  await deps.db.from('cs_channels').update({ meta, updated_at: deps.now() }).eq('id', 'wa1');
}

// ---------------------------------------------------------------- the webhook → our rows
type Summary = Record<string, number>;
const bump = (s: Summary, k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };

async function customerOf(deps: Deps, phone: string, name: string | null): Promise<string> {
  const { data: had } = await deps.db.from('cs_customers').select('id, merged_into, name').eq('phone', phone).maybeSingle();
  if (isObj(had)) {
    if (name && had.name === DEFAULT_NAME) await deps.db.from('cs_customers').update({ name }).eq('id', had.id); // the profile names an unnamed one
    return String(had.merged_into || had.id);
  }
  const { data: made, error } = await deps.db.from('cs_customers').insert({ phone, name: name || DEFAULT_NAME, created_from: 'channel', source: 'واتساب', created_by: null, created_at: deps.now() }).select('id').single();
  if (error?.code === '23505') { const { data: again } = await deps.db.from('cs_customers').select('id, merged_into').eq('phone', phone).maybeSingle(); if (isObj(again)) return String(again.merged_into || again.id); }
  if (error || !isObj(made)) throw new Error('cs_customers: ' + (error?.code ?? 'insert'));
  const c = await deps.db.from('cs_contacts').insert({ customer_id: made.id, platform: 'whatsapp', external_id: phone, handle: name, created_at: deps.now() });
  if (c.error && c.error.code !== '23505') throw new Error('cs_contacts: ' + c.error.code);
  return String(made.id);
}
async function conversationOf(deps: Deps, phone: string, customerId: string, init: { status: string; at?: string } = { status: 'جديدة' }): Promise<{ id: string; status: string; fresh: boolean }> {
  const { data: found } = await deps.db.from('cs_conversations').select('id, status').eq('channel', 'wa1').eq('external_id', phone).maybeSingle();
  if (isObj(found)) return { id: String(found.id), status: String(found.status), fresh: false };
  const row = { seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: customerId, external_id: phone, handle: null, status: init.status, created_by: null, created_at: deps.now(), updated_at: init.at ?? deps.now() };
  const { data: made, error } = await deps.db.from('cs_conversations').insert(row).select('id, status').single();
  if (error?.code === '23505') { const { data: again } = await deps.db.from('cs_conversations').select('id, status').eq('channel', 'wa1').eq('external_id', phone).maybeSingle(); if (isObj(again)) return { id: String(again.id), status: String(again.status), fresh: false }; }
  if (error || !isObj(made)) throw new Error('cs_conversations: ' + (error?.code ?? 'insert'));
  return { id: String(made.id), status: init.status, fresh: true };
}
async function setStatus(deps: Deps, convId: string, status: string) {
  const { error } = await deps.db.from('cs_conversations').update({ status, snoozed_until: null, updated_at: deps.now() }).eq('id', convId);
  if (error) throw new Error('cs_conversations: ' + (error.code ?? 'update'));
}
async function put(deps: Deps, row: Json): Promise<boolean> {
  const { error } = await deps.db.from('cs_messages').insert(row);
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error('cs_messages: ' + (error.code ?? 'insert'));
}

async function onIn(deps: Deps, ev: Json, s: Summary) {
  const phone = phoneOfWaId(ev.waId); if (!phone) { bump(s, 'ignored:bad_phone'); return; }
  const customerId = await customerOf(deps, phone, ev.name);
  const conv = await conversationOf(deps, phone, customerId);
  if (!(await put(deps, { conversation_id: conv.id, kind: 'in', text: ev.text, author: null, external_id: ev.id, delivery: null, meta: { kind: ev.kind, reply_to: ev.replyTo, at: ev.at, ...(isObj(ev.media) ? { media_id: ev.media.media_id, mime: ev.media.mime } : {}) }, created_at: iso(ev.at, deps) }))) { bump(s, 'duplicates'); return; }
  const next = conv.fresh ? 'جديدة' : 'مستنية ردنا';
  if (next !== conv.status) await setStatus(deps, conv.id, next);
  await inboundSafe(deps, { conversationId: conv.id, customerId, channel: 'wa1', fresh: conv.fresh }); // phase 6.5: the first-message / after-hours rules
  if (isOptOut(ev.text)) { // «إيقاف»: no more campaigns for this customer
    await deps.db.from('cs_customers').update({ consent: false }).eq('id', customerId);
    await deps.db.from('cs_campaign_recipients').update({ status: 'opted_out', at: deps.now() }).eq('customer_id', customerId).eq('status', 'queued');
    await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'event', text: 'العميل طلب إيقاف رسايل العروض — اتشال من الحملات', author: null, delivery: null, meta: { opt_out: true }, created_at: deps.now() });
  } else { // a message within three days of a campaign send is its reply (phase 13 T1 — as the bridge counts it)
    const since = new Date(Date.parse(deps.now()) - REPLY_WINDOW_DAYS * DAY).toISOString();
    const { data: hit } = await deps.db.from('cs_campaign_recipients').update({ status: 'replied', reply: String(ev.text).slice(0, 500) }).eq('customer_id', customerId).in('status', ['sent', 'delivered', 'read']).gte('at', since).select('campaign_id');
    for (const cid of new Set((Array.isArray(hit) ? hit : []).map((x: Json) => String(x.campaign_id)))) await campaignFigures(deps, cid);
  }
  bump(s, 'messages');
}
async function onEcho(deps: Deps, ev: Json, s: Summary) {
  const phone = phoneOfWaId(ev.waId); if (!phone) { bump(s, 'ignored:bad_phone'); return; }
  const customerId = await customerOf(deps, phone, null);
  const conv = await conversationOf(deps, phone, customerId, { status: 'مستنية العميل' });
  if (!(await put(deps, { conversation_id: conv.id, kind: 'out', text: ev.text, author: null, external_id: ev.id, delivery: 'sent', meta: { echo: true, kind: ev.kind, at: ev.at }, created_at: iso(ev.at, deps) }))) { bump(s, 'ignored'); return; }
  if (!conv.fresh && conv.status !== 'مستنية العميل' && conv.status !== 'اتحلت') await setStatus(deps, conv.id, 'مستنية العميل');
  bump(s, 'echoes');
}
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
async function onStatus(deps: Deps, ev: Json, s: Summary) {
  const { data: m } = await deps.db.from('cs_messages').select('id, delivery, meta').eq('external_id', ev.id).in('kind', ['out', 'auto']).maybeSingle();
  if (!isObj(m)) { bump(s, 'ignored:status'); return; }
  if (ev.status === 'failed') { if (m.delivery !== 'read') await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { ...(isObj(m.meta) ? m.meta : {}), error: ev.error ?? 'wa_failed' } }).eq('id', m.id); await recipientStatus(deps, m, 'failed', ev.error); bump(s, 'failed'); return; }
  if ((RANK[ev.status] ?? -1) > (RANK[String(m.delivery)] ?? -1) && m.delivery !== 'failed') await deps.db.from('cs_messages').update({ delivery: ev.status }).eq('id', m.id);
  await recipientStatus(deps, m, String(ev.status), null);
  bump(s, ev.status === 'read' ? 'reads' : ev.status === 'delivered' ? 'deliveries' : 'sent');
}
// a receipt on a campaign message (meta.recipient_id) moves its recipient along too, never backwards; the campaign's figures follow
async function recipientStatus(deps: Deps, m: Json, delivery: string, error: unknown) {
  const meta = isObj(m.meta) ? m.meta : {}; const rid = Number(meta.recipient_id);
  if (!Number.isInteger(rid) || rid <= 0) return;
  const { data: r } = await deps.db.from('cs_campaign_recipients').select('id, campaign_id, status').eq('id', rid).maybeSingle();
  if (!isObj(r)) return;
  const next = recipientAfter(String(r.status), delivery); if (!next) return;
  await deps.db.from('cs_campaign_recipients').update(next === 'failed' ? { status: 'failed', error: String(error ?? 'wa_failed').replace(/[^\w:.-]/g, '').slice(0, 60) } : { status: next }).eq('id', rid);
  await campaignFigures(deps, String(r.campaign_id));
}
// the figures follow every change (a finished campaign keeps counting its deliveries and replies); the status moves only while running
async function campaignFigures(deps: Deps, campaignId: string) {
  const { data: all } = await deps.db.from('cs_campaign_recipients').select('status').eq('campaign_id', campaignId);
  const stats = campaignStats((Array.isArray(all) ? all : []).map((x: Json) => String(x.status)));
  await deps.db.from('cs_campaigns').update({ stats }).eq('id', campaignId);
  const next = nextStatus(stats); if (next) await deps.db.from('cs_campaigns').update({ status: next }).eq('id', campaignId).eq('status', 'شغالة');
  return stats;
}
async function onContact(deps: Deps, ev: Json, s: Summary) {
  const phone = phoneOfWaId(ev.waId);
  if (!phone || !ev.name || ev.action === 'remove') { bump(s, 'ignored:contact'); return; }
  const { data } = await deps.db.from('cs_customers').update({ name: ev.name }).eq('phone', phone).eq('name', DEFAULT_NAME).select('id');
  bump(s, Array.isArray(data) && data.length ? 'contacts_named' : 'contacts');
}
// the history of one delivery, grouped by thread: the customer + conversation once (a new one closed, at its first message's time),
// then the messages not kept yet in batches (a race with a redelivery falls back to one by one)
async function onHistory(deps: Deps, events: Json[], s: Summary) {
  const byPhone = new Map<string, Json[]>();
  for (const ev of events) { const p = phoneOfWaId(ev.waId); if (!p) { bump(s, 'ignored:bad_phone'); continue; } if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p)!.push(ev); }
  for (const [phone, list] of byPhone) {
    list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const customerId = await customerOf(deps, phone, null);
    const conv = await conversationOf(deps, phone, customerId, { status: 'اتحلت', at: iso(list[0].at, deps) });
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const { data: had } = await deps.db.from('cs_messages').select('external_id').in('external_id', chunk.map((e) => e.id));
      const known = new Set((Array.isArray(had) ? had : []).map((r: Json) => String(r.external_id)));
      const rows = chunk.filter((e) => !known.has(e.id)).map((e) => ({ conversation_id: conv.id, kind: e.out ? 'out' : 'in', text: e.text, author: null, external_id: e.id, delivery: e.out ? 'sent' : null, meta: { history: true, kind: e.kind, at: e.at }, created_at: iso(e.at, deps) }));
      bump(s, 'duplicates', chunk.length - rows.length);
      if (!rows.length) continue;
      const { error } = await deps.db.from('cs_messages').insert(rows);
      if (!error) { bump(s, 'history', rows.length); continue; }
      if (error.code !== '23505') throw new Error('cs_messages: ' + (error.code ?? 'insert'));
      for (const r of rows) bump(s, (await put(deps, r)) ? 'history' : 'duplicates');
    }
  }
}
async function onHistoryMeta(deps: Deps, ev: Json, s: Summary) {
  const cur = await channelMeta(deps); const h = isObj(cur.history) ? cur.history : {};
  const next = ev.error ? { ...h, error: ev.error, at: deps.now() } : { ...h, phase: ev.phase, progress: ev.progress, at: deps.now(), ...(ev.phase === 2 && ev.progress === 100 ? { done: true } : {}) };
  await deps.db.from('cs_channels').update({ meta: { ...cur, history: next }, updated_at: deps.now() }).eq('id', 'wa1');
  bump(s, ev.error ? 'history_declined' : 'history_chunks');
}

async function webhook(req: Request, deps: Deps): Promise<Response> {
  const secret = (deps.env.META_APP_SECRET ?? '').trim();
  if (!secret) { await logEvent(deps, { object: 'whatsapp', status: 'error', error: 'not_configured' }); return json(500, { error: 'not_configured' }); }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(bytes, req.headers.get('x-hub-signature-256') ?? '', secret))) { await logEvent(deps, { object: 'whatsapp', status: 'error', error: 'bad_signature' }); return json(401, { error: 'bad_signature' }); }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { await logEvent(deps, { object: 'whatsapp', status: 'error', error: 'bad_json' }); return json(200, { status: 'ignored' }); }
  const parsed = parseWaWebhook(body);
  if (!parsed) { await logEvent(deps, { object: 'whatsapp', status: 'ignored', error: 'unknown_object' }); return json(200, { status: 'ignored' }); }
  const link = await linkOf(deps);
  if (!link) { await logEvent(deps, { object: 'whatsapp', status: 'ignored', error: 'not_linked', summary: { entries: parsed.entries.length } }); return json(200, { status: 'ignored' }); }
  let failed = false;
  for (const entry of parsed.entries) {
    const s: Summary = {}; let error: string | null = null;
    if (entry.id !== link.waba_id || (entry.phoneId && entry.phoneId !== link.phone_id)) { await logEvent(deps, { object: 'whatsapp', entry_id: entry.id.slice(0, 80), status: 'ignored', error: 'other_account', summary: { events: entry.events.length } }); continue; }
    const history: Json[] = [];
    for (const ev of entry.events) {
      try {
        if (ev.type === 'in') await onIn(deps, ev, s);
        else if (ev.type === 'echo') await onEcho(deps, ev, s);
        else if (ev.type === 'status') await onStatus(deps, ev, s);
        else if (ev.type === 'history') history.push(ev);
        else if (ev.type === 'history_meta') await onHistoryMeta(deps, ev, s);
        else if (ev.type === 'contact') await onContact(deps, ev, s);
        else bump(s, 'ignored:' + String(ev.field ?? 'other').replace(/[^a-z_]/g, '').slice(0, 30));
      } catch (e) { failed = true; bump(s, 'errors'); error = errText(e); console.error('cs-whatsapp webhook: ' + error); }
    }
    if (history.length) { try { await onHistory(deps, history, s); } catch (e) { failed = true; bump(s, 'errors'); error = errText(e); console.error('cs-whatsapp history: ' + error); } }
    const handled = Object.keys(s).some((k) => !k.startsWith('ignored') && !['duplicates', 'errors'].includes(k));
    await logEvent(deps, { object: 'whatsapp', entry_id: entry.id.slice(0, 80), status: error ? 'error' : handled ? 'ok' : 'ignored', error, summary: s });
  }
  return failed ? json(500, { status: 'error' }) : json(200, { status: 'ok' });
}

// ---------------------------------------------------------------- the members' actions
async function channelOf(deps: Deps) {
  const { data } = await deps.db.from('cs_channels').select('id, name, status, number, since, last_message_at, meta').eq('id', 'wa1').maybeSingle();
  if (!isObj(data)) return null;
  const m = isObj(data.meta) ? data.meta : {};
  return { id: 'wa1', name: data.name, status: data.status, number: data.number ?? null, since: data.since ?? null, last_message_at: data.last_message_at ?? null, history: isObj(m.history) ? m.history : null, contacts: isObj(m.contacts) ? m.contacts : null };
}
async function status(deps: Deps, who: Who) {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const link = await linkOf(deps);
  const out: Json = { result: 'ok', linked: !!link, channel: await channelOf(deps) };
  if (who.admin) {
    out.configured = !!appOf(deps.env); out.config_id = !!configOf(deps.env); out.verify_configured = !!(deps.env.META_VERIFY_TOKEN ?? '').trim(); out.webhook_url = webhookUrl(deps.env); out.redirect = redirectUri(deps.env);
    if (link) {
      out.number = { display: link.display, name: link.name, waba_id: link.waba_id };
      try { const p = phonesOf({ data: [await graph(deps, 'GET', waPath.phone(link.phone_id), { token: link.token })] })[0]; out.number.biz_app = p?.biz_app ?? null; out.number.platform = p?.platform ?? null; } catch (e) { out.number_error = e instanceof GraphError ? e.code : 'error'; }
    }
  }
  return json(200, out);
}
async function connectStart(deps: Deps, who: Who) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const app = appOf(deps.env); const config = configOf(deps.env);
  if (!app || !config) return json(503, { error: 'not_configured', configured: !!app, config_id: !!config });
  const state = STATE_PREFIX + randomText();
  const { error } = await deps.db.from('cs_oauth_states').insert({ state, verifier: randomText(48), channel: 'wa1', created_by: who.uid, created_at: deps.now() });
  if (error) return json(500, { error: 'failed' });
  // the sign-in runs through Meta's JavaScript SDK on app/wa-connect.html (FB.login with the configuration — the plain dialog url
  // answers 500 for Embedded Signup, seen live 4 Nov); the url stays for reference. app id and config id are public (Meta puts both
  // in its own landing page url), nothing secret leaves here.
  return json(200, { result: 'ok', state, url: waAuthUrl(app.id, redirectUri(deps.env), state, config), sdk: { app_id: app.id, config_id: config, version: WA_GRAPH_VERSION, extras: EXTRAS } });
}
async function requestSync(deps: Deps, link: Link, type: 'history' | 'contacts') {
  const key = type === 'history' ? 'history' : 'contacts';
  try { const r = await graph(deps, 'POST', waPath.sync(link.phone_id), { token: link.token, body: syncBody(type) }); await patchMeta(deps, { [key]: { requested_at: deps.now(), request_id: typeof r.request_id === 'string' ? r.request_id.slice(0, 80) : null } }); return { ok: true }; }
  catch (e) { const code = e instanceof GraphError ? e.code : 'error'; await patchMeta(deps, { [key]: { requested_at: deps.now(), error: code } }); return { ok: false, code }; }
}
async function connectCallback(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const app = appOf(deps.env); if (!app) return json(503, { error: 'not_configured' });
  const code = typeof args.code === 'string' && /^[A-Za-z0-9._~#-]{8,2048}$/.test(args.code) ? args.code : null;
  const state = typeof args.state === 'string' && /^wa_[A-Za-z0-9_-]{32,125}$/.test(args.state) ? args.state : null;
  if (!code) return json(400, { error: 'bad_request', field: 'code' });
  if (!state) return json(400, { error: 'bad_request', field: 'state' });
  const { data: found } = await deps.db.from('cs_oauth_states').select('state, channel, created_at, used_at').eq('state', state).maybeSingle();
  const row = isObj(found) && found.channel === 'wa1' ? { createdAt: String(found.created_at ?? ''), used: !!found.used_at } : null;
  if (row && !row.used) await deps.db.from('cs_oauth_states').update({ used_at: deps.now() }).eq('state', state);
  if (!row || row.used || Date.parse(deps.now()) - Date.parse(row.createdAt) > STATE_MINUTES * 60_000) return json(400, { error: 'bad_request', field: 'state' });
  let link: Link;
  try {
    // a code from the JavaScript SDK (FB.login) is exchanged without a redirect_uri; one from the dialog with ours
    const t = await graph(deps, 'GET', (args.sdk === true ? waPath.tokenExchangeSdk(app.id, code) : waPath.tokenExchange(app.id, redirectUri(deps.env), code)) + encodeURIComponent(app.secret));
    const token = typeof t.access_token === 'string' ? t.access_token : '';
    if (!token) throw new GraphError('graph_no_token');
    // the WABA: the token's own scopes; the session info the SDK page saw (waba_id) is a hint only — it is used when the token can read it
    const hint = typeof args.waba_id === 'string' && /^\d{5,30}$/.test(args.waba_id) ? args.waba_id : null;
    const scoped = wabaIdsOf(await graph(deps, 'GET', waPath.debugToken(token), { token: app.id + '|' + app.secret }));
    const wabas = hint && !scoped.includes(hint) ? [hint, ...scoped] : scoped;
    if (!wabas.length) return json(400, { error: 'no_account' });
    let picked: { waba: string; phone: ReturnType<typeof phonesOf>[number] } | null = null;
    for (const waba of wabas) {
      let list: ReturnType<typeof phonesOf> = [];
      try { list = phonesOf(await graph(deps, 'GET', waPath.phones(waba), { token })); } catch (e) { if (waba === hint && !scoped.includes(hint)) continue; throw e; } // a hint the token cannot read is skipped
      const want = typeof args.phone_id === 'string' && /^\d{5,30}$/.test(args.phone_id) ? args.phone_id : null;
      const p = (want && list.find((x: Json) => x.id === want)) || list[0];
      if (p) { picked = { waba, phone: p }; break; }
    }
    if (!picked) return json(400, { error: 'no_number' });
    await graph(deps, 'POST', waPath.subscribe(picked.waba), { token });
    link = { token, waba_id: picked.waba, phone_id: picked.phone.id, display: picked.phone.display, name: picked.phone.name, linked_by: who.uid, linked_at: deps.now() };
  } catch (e) { return graphFail(e); }
  const before = await linkOf(deps);
  if (before && before.waba_id !== link.waba_id) { try { await graph(deps, 'DELETE', waPath.subscribe(before.waba_id), { token: before.token }); } catch { /* the old token may be gone */ } }
  await linkSet(deps, link);
  const now = deps.now();
  await deps.db.from('cs_channels').update({ kind: 'meta', status: 'connected', number: link.display, since: now, meta: { waba_id: link.waba_id, phone_id: link.phone_id, name: link.name }, updated_at: now }).eq('id', 'wa1');
  // Meta shares the contacts and the history once, within 24 hours of the link: asked for now (contacts first, as Meta documents)
  const contacts = await requestSync(deps, link, 'contacts');
  const history = await requestSync(deps, link, 'history');
  await logActivity(deps, who, 'cs.channel.connect', 'wa1', link.name ?? 'whatsapp');
  return json(200, { result: 'ok', linked: true, number: { display: link.display, name: link.name }, sync: { contacts: contacts.ok ? 'requested' : contacts.code, history: history.ok ? 'requested' : history.code }, channel: await channelOf(deps) });
}
// the admin links a number by hand with a token from Meta's API Setup (the test number of the App Review screencast, 4 Nov — the
// coexistence option opens only after the review): the token is checked against the number and the WABA it names, the app is
// subscribed to that WABA, and the link goes to Vault like the Embedded Signup one; no contacts / history sync (a test number has
// none). The token never comes back, never reaches a log.
async function connectToken(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const token = typeof args.token === 'string' && /^[A-Za-z0-9_-]{40,1024}$/.test(args.token.trim()) ? args.token.trim() : null;
  const waba = typeof args.waba_id === 'string' && /^\d{5,30}$/.test(args.waba_id.trim()) ? args.waba_id.trim() : null;
  const phoneId = typeof args.phone_id === 'string' && /^\d{5,30}$/.test(args.phone_id.trim()) ? args.phone_id.trim() : null;
  if (!token) return json(400, { error: 'bad_request', field: 'token' });
  if (!waba) return json(400, { error: 'bad_request', field: 'waba_id' });
  if (!phoneId) return json(400, { error: 'bad_request', field: 'phone_id' });
  let link: Link;
  try {
    const phone = phonesOf(await graph(deps, 'GET', waPath.phones(waba), { token })).find((x: Json) => x.id === phoneId);
    if (!phone) return json(400, { error: 'no_number' });
    await graph(deps, 'POST', waPath.subscribe(waba), { token });
    link = { token, waba_id: waba, phone_id: phoneId, display: phone.display, name: phone.name, linked_by: who.uid, linked_at: deps.now() };
  } catch (e) { return graphFail(e); }
  const before = await linkOf(deps);
  if (before && before.waba_id !== link.waba_id) { try { await graph(deps, 'DELETE', waPath.subscribe(before.waba_id), { token: before.token }); } catch { /* the old token may be gone */ } }
  await linkSet(deps, link);
  const now = deps.now();
  await deps.db.from('cs_channels').update({ kind: 'meta', status: 'connected', number: link.display, since: now, meta: { waba_id: link.waba_id, phone_id: link.phone_id, name: link.name, manual: true }, updated_at: now }).eq('id', 'wa1');
  await logActivity(deps, who, 'cs.channel.connect', 'wa1', 'manual · ' + (link.name ?? 'whatsapp'));
  return json(200, { result: 'ok', linked: true, manual: true, number: { display: link.display, name: link.name }, channel: await channelOf(deps) });
}
async function sync(deps: Deps, who: Who, args: Json) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const type = args.type === 'history' ? 'history' : args.type === 'contacts' ? 'contacts' : null;
  if (!type) return json(400, { error: 'bad_request', field: 'type' });
  const link = await linkOf(deps); if (!link) return json(503, { error: 'not_linked' });
  const r = await requestSync(deps, link, type);
  await logActivity(deps, who, 'cs.channel.sync', 'wa1', type + (r.ok ? '' : ' · ' + r.code));
  return r.ok ? json(200, { result: 'ok', type }) : json(502, { error: r.code, type });
}
async function disconnect(deps: Deps, who: Who) {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const link = await linkOf(deps);
  if (link) { try { await graph(deps, 'DELETE', waPath.subscribe(link.waba_id), { token: link.token }); } catch { /* best effort */ } }
  await linkSet(deps, null);
  await deps.db.from('cs_channels').update({ status: 'disconnected', number: null, since: null, meta: {}, updated_at: deps.now() }).eq('id', 'wa1');
  await logActivity(deps, who, 'cs.channel.disconnect', 'wa1', link ? link.name ?? 'whatsapp' : null);
  return json(200, { result: 'ok', linked: false, channel: await channelOf(deps) });
}
async function send(deps: Deps, who: Who, args: Json) {
  if (!who.reply) return json(401, { error: 'unauthorized' });
  const id = typeof args.message_id === 'string' && UUID.test(args.message_id) ? args.message_id : null;
  if (!id) return json(400, { error: 'bad_request', field: 'message_id' });
  const { data: m } = await deps.db.from('cs_messages').select('id, conversation_id, kind, text, author, delivery, meta').eq('id', id).maybeSingle();
  if (!isObj(m)) return json(404, { error: 'not_found' });
  if (m.kind !== 'out' || m.delivery !== 'queued') return json(409, { error: 'not_queued', delivery: m.delivery ?? null });
  if (!who.admin && m.author && m.author !== who.uid) return json(401, { error: 'unauthorized' });
  const { data: v } = await deps.db.from('cs_conversations').select('id, channel, external_id, customer_id, assignee').eq('id', m.conversation_id).maybeSingle();
  if (!isObj(v) || !canSee(who, v)) return json(404, { error: 'not_found' });
  if (v.channel !== 'wa1') return json(400, { error: 'bad_request', field: 'channel' });
  let phone = v.external_id ? String(v.external_id) : null;
  if (!phone && v.customer_id) { const { data: cu } = await deps.db.from('cs_customers').select('phone').eq('id', v.customer_id).maybeSingle(); phone = isObj(cu) && cu.phone ? String(cu.phone) : null; }
  const waId = phone ? waIdOfPhone(phone) : null;
  if (!waId) return json(409, { error: 'no_phone' });
  const link = await linkOf(deps); if (!link) return json(503, { error: 'not_linked' });
  const meta = isObj(m.meta) ? m.meta : {};
  // phase 13 T3: an attachment of the member (cs-media/<their uid>/…) goes out by a signed link; the caption is the row's text unless it is the placeholder
  let body: Json = textBody(waId, String(m.text));
  if (isObj(meta.media) && typeof meta.media.path === 'string') {
    if (!meta.media.path.startsWith((m.author ?? '') + '/') && !who.admin) return json(401, { error: 'unauthorized' });
    const { data: sg } = await deps.db.storage.from(MEDIA_BUCKET).createSignedUrl(meta.media.path, MEDIA_SIGN_SECONDS);
    if (!sg?.signedUrl) return json(409, { error: 'no_media' });
    body = mediaBody(waId, meta.media, sg.signedUrl, String(m.text).startsWith('📎') ? '' : String(m.text));
  }
  try {
    const wamid = sentIdOf(await graph(deps, 'POST', waPath.send(link.phone_id), { token: link.token, body }));
    const { error } = await deps.db.from('cs_messages').update({ delivery: 'sent', external_id: wamid }).eq('id', m.id);
    if (error) throw new Error('cs_messages: ' + (error.code ?? 'update'));
    await logActivity(deps, who, 'cs.channel.send', String(v.id), 'whatsapp');
    return json(200, { result: 'ok', delivery: 'sent', external_id: wamid });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { ...meta, error: e.code } }).eq('id', m.id);
    await logActivity(deps, who, 'cs.channel.failed', String(v.id), e.code);
    return json(502, { error: e.code, status: e.status, delivery: 'failed' });
  }
}

// ---------------------------------------------------------------- a customer's media (phase 13 T3, decision 6)
// Meta's media links need the token, so the browser cannot open them: the function fetches the bytes once (≤ 10 MB) into the private
// bucket under inbound/<message id> and answers a signed link; a second ask signs the kept file. Nothing about the file is logged.
async function graphBytes(deps: Deps, url: string, token: string): Promise<{ bytes: Uint8Array; type: string }> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS * 2);
  let res: Response;
  try { res = await f(url, { headers: { authorization: 'Bearer ' + token }, signal: ctl.signal, redirect: 'follow' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new GraphError('graph_media_' + res.status, res.status);
  // the size is checked before anything is read (Content-Length), then while streaming — a body past MEDIA_MAX is dropped mid-way
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MEDIA_MAX) { try { await res.body?.cancel(); } catch { /* nothing to free */ } throw new GraphError('media_too_large'); }
  const buf = await readCapped(res, MEDIA_MAX);
  return { bytes: buf, type: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
}
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(); const parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > max) { try { await reader.cancel(); } catch { /* already closed */ } throw new GraphError('media_too_large'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let at = 0; for (const p of parts) { out.set(p, at); at += p.byteLength; } return out;
}
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr' };
async function mediaUrl(deps: Deps, who: Who, args: Json) {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const id = typeof args.message_id === 'string' && UUID.test(args.message_id) ? args.message_id : null;
  if (!id) return json(400, { error: 'bad_request', field: 'message_id' });
  const { data: m } = await deps.db.from('cs_messages').select('id, conversation_id, kind, author, meta').eq('id', id).maybeSingle();
  if (!isObj(m)) return json(404, { error: 'not_found' });
  const { data: v } = await deps.db.from('cs_conversations').select('id, channel, assignee').eq('id', m.conversation_id).maybeSingle();
  if (!isObj(v) || !canSee(who, v)) return json(404, { error: 'not_found' });
  const meta = isObj(m.meta) ? m.meta : {};
  const sign = async (path: string) => { const { data: sg } = await deps.db.storage.from(MEDIA_BUCKET).createSignedUrl(path, MEDIA_SIGN_SECONDS); return sg?.signedUrl ? json(200, { result: 'ok', url: sg.signedUrl, type: meta.mime ?? null }) : json(409, { error: 'no_media' }); };
  // only a path tied to this row is ever signed (security review): the server's own inbound/<id>.<ext> on a customer's message, or the
  // author's own folder on a member's message — a meta that points anywhere else is treated as no media
  const inboundPath = typeof meta.media_path === 'string' && m.kind === 'in' && meta.media_path.startsWith('inbound/' + id + '.') && /^inbound\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(meta.media_path) ? meta.media_path : null;
  if (inboundPath) return await sign(inboundPath);
  const ownPath = isObj(meta.media) && typeof meta.media.path === 'string' && m.kind === 'out' && typeof m.author === 'string' && m.author && meta.media.path.startsWith(m.author + '/') && !meta.media.path.includes('..') ? meta.media.path : null;
  if (ownPath) return await sign(ownPath);
  const mediaId = m.kind === 'in' && typeof meta.media_id === 'string' && /^\d{5,40}$/.test(meta.media_id) ? meta.media_id : null;
  if (!mediaId) return json(409, { error: 'no_media' });
  const link = await linkOf(deps); if (!link) return json(503, { error: 'not_linked' });
  try {
    const info = await graph(deps, 'GET', WA_GRAPH + '/' + mediaId, { token: link.token });
    const url = typeof info.url === 'string' && /^https:\/\//.test(info.url) ? info.url : null; if (!url) throw new GraphError('graph_no_media');
    if (Number(info.file_size ?? 0) > MEDIA_MAX) throw new GraphError('media_too_large'); // Meta's own size before any download
    const got = await graphBytes(deps, url, link.token);
    const type = typeof info.mime_type === 'string' && info.mime_type ? String(info.mime_type).split(';')[0] : got.type || String(meta.mime ?? 'application/octet-stream');
    const path = 'inbound/' + id + '.' + (EXT[type] ?? 'bin');
    const up = await deps.db.storage.from(MEDIA_BUCKET).upload(path, got.bytes, { contentType: type, upsert: true });
    if (up.error) return json(500, { error: 'failed' });
    await deps.db.from('cs_messages').update({ meta: { ...meta, media_path: path, mime: type } }).eq('id', id);
    return await sign(path);
  } catch (e) { return graphFail(e); }
}

// ---------------------------------------------------------------- the campaigns on wa1 (phase 13 T1)
const campaignTemplate = async (deps: Deps, id: unknown) => { if (typeof id !== 'string' || !UUID.test(id)) return null; const { data } = await deps.db.from('cs_templates').select('id, name, body, wa_template, wa_vars, active').eq('id', id).maybeSingle(); return templateOk(data) ? data as Json : null; };
// one template send: the row in the customer's wa1 conversation first (queued, no author), then Graph; the row and the recipient follow
type Target = { cu: Json; phone: string; waId: string; params: string[] };
// who gets this recipient's send, re-checked at send time (decision 24 of phase 6): a customer who opted out, was blocked or merged
// since the scheduling never gets it; no phone / a variable without a value → the recipient fails without a Graph call
async function campaignTarget(deps: Deps, k: Json, tpl: Json, r: Json): Promise<Target | 'opted_out' | 'failed'> {
  const now = deps.now();
  const { data: cu } = r.customer_id ? await deps.db.from('cs_customers').select('id, name, phone, consent, blocked_at, merged_into').eq('id', r.customer_id).maybeSingle() : { data: null };
  if (!isObj(cu) || cu.consent === false || cu.blocked_at || cu.merged_into) { await deps.db.from('cs_campaign_recipients').update({ status: 'opted_out', at: now, claimed_at: null }).eq('id', r.id); return 'opted_out'; }
  const phone = String(r.phone || cu.phone || ''); const waId = phone ? waIdOfPhone(phone) : null;
  const fail = async (code: string) => { await deps.db.from('cs_campaign_recipients').update({ status: 'failed', error: code, at: now, claimed_at: null }).eq('id', r.id); return 'failed' as const; };
  if (!waId) return fail('no_phone');
  const { params, missing } = campaignParams(tpl, { name: cu.name, code: k.discount_code });
  if (missing.length) return fail('missing_var');
  return { cu, phone, waId, params };
}
async function sendCampaignOne(deps: Deps, link: Link, k: Json, tpl: Json, r: Json, lang: string, t: Target): Promise<'sent' | 'failed'> {
  const now = deps.now(); const { cu, phone, waId, params } = t;
  const fail = async (code: string) => { await deps.db.from('cs_campaign_recipients').update({ status: 'failed', error: code, at: now, claimed_at: null }).eq('id', r.id); return 'failed' as const; };
  const conv = await conversationOf(deps, phone, String(cu.id), { status: 'مستنية العميل' });
  const { data: made, error } = await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'out', text: campaignPreview(tpl, { name: cu.name, code: k.discount_code }), author: null, delivery: 'queued', meta: { campaign_id: k.id, recipient_id: r.id, tpl: tpl.wa_template }, created_at: now }).select('id').single();
  if (error || !isObj(made)) throw new Error('cs_messages: ' + (error?.code ?? 'insert'));
  try {
    const wamid = sentIdOf(await graph(deps, 'POST', waPath.send(link.phone_id), { token: link.token, body: templateBody(waId, tpl.wa_template, lang, params) }));
    await deps.db.from('cs_messages').update({ delivery: 'sent', external_id: wamid }).eq('id', made.id);
    await deps.db.from('cs_campaign_recipients').update({ status: 'sent', wa_id: wamid, at: now, claimed_at: null }).eq('id', r.id);
    return 'sent';
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { campaign_id: k.id, recipient_id: r.id, tpl: tpl.wa_template, error: e.code } }).eq('id', made.id);
    return fail(e.code);
  }
}
export async function campaignTick(deps: Deps): Promise<Json> {
  const startMs = Date.parse(deps.now()); const s: Summary = {};
  const cfg = await csSettings(deps);
  if (!cfg.live.campaigns) return { result: 'ok', skipped: 'off' };
  const { data: ch } = await deps.db.from('cs_channels').select('kind, status').eq('id', 'wa1').maybeSingle();
  if (!isObj(ch) || ch.kind !== 'meta') return { result: 'ok', skipped: 'bridge' }; // a QR number: cs-wa's campaign_next sends
  if (ch.status !== 'connected') return { result: 'ok', skipped: 'disconnected' };
  const link = await linkOf(deps); if (!link) return { result: 'ok', skipped: 'not_linked' };
  const now = deps.now(); const nowMs = Date.parse(now);
  await deps.db.from('cs_campaigns').update({ status: 'شغالة' }).eq('channel', 'wa1').eq('status', 'مجدولة').lte('scheduled_at', now);
  if (!inHours(cfg.auto, nowMs)) return { result: 'ok', skipped: 'hours' };
  const { data: running } = await deps.db.from('cs_campaigns').select('id, template_id, discount_code, cap_per_day, min_delay_s').eq('channel', 'wa1').eq('status', 'شغالة').order('scheduled_at');
  const dayStart = cairoDayStart(now); const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  for (const k of Array.isArray(running) ? running : []) {
    const tpl = await campaignTemplate(deps, k.template_id);
    if (!tpl) { await deps.db.from('cs_campaigns').update({ status: 'متوقفة', stats: { ...(await campaignFigures(deps, String(k.id))), error: 'no_template' } }).eq('id', k.id); bump(s, 'no_template'); continue; }
    const { data: done } = await deps.db.from('cs_campaign_recipients').select('id').eq('campaign_id', k.id).in('status', DONE_STATUSES).gte('at', dayStart);
    // a tick may still be sending when the next minute's fires: a row claimed within CLAIM_MS is another tick's (counted against the
    // cap as in flight), and the claim itself is conditional — a row somebody claimed first is skipped, never sent twice (paid sends)
    const stale = new Date(nowMs - CLAIM_MS).toISOString();
    const { data: queuedAll } = await deps.db.from('cs_campaign_recipients').select('id, customer_id, phone, claimed_at').eq('campaign_id', k.id).eq('status', 'queued').order('id');
    const all = Array.isArray(queuedAll) ? queuedAll : [];
    const inFlight = all.filter((r: Json) => r.claimed_at && String(r.claimed_at) >= stale).length;
    const room = Math.min(perTick(k.min_delay_s), (Number(k.cap_per_day) || 300) - (Array.isArray(done) ? done.length : 0) - inFlight);
    if (!all.length) { await campaignFigures(deps, String(k.id)); bump(s, 'finished'); continue; }
    if (room <= 0) { bump(s, 'cap'); continue; }
    const list = all.filter((r: Json) => !r.claimed_at || String(r.claimed_at) < stale).slice(0, room);
    let calls = 0;
    for (const r of list) {
      if (Date.parse(deps.now()) - startMs > TICK_BUDGET_MS) { bump(s, 'budget'); break; }
      let claim = deps.db.from('cs_campaign_recipients').update({ claimed_at: deps.now() }).eq('id', r.id).eq('status', 'queued');
      claim = r.claimed_at ? claim.eq('claimed_at', r.claimed_at) : claim.is('claimed_at', null);
      const { data: got } = await claim.select('id');
      if (!Array.isArray(got) || !got.length) { bump(s, 'raced'); continue; } // another tick took it
      const t = await campaignTarget(deps, k, tpl, r);
      if (typeof t === 'string') { bump(s, t); continue; } // skipped without a Graph call: no pause
      if (calls > 0) await sleep((Number(k.min_delay_s) || 20) * 1000);
      bump(s, await sendCampaignOne(deps, link, k, tpl, r, cfg.auto.waLang, t)); calls += 1;
    }
    await campaignFigures(deps, String(k.id));
  }
  await logEvent(deps, { object: 'whatsapp', status: 'ok', summary: { campaign_tick: 1, ...s } });
  return { result: 'ok', ...s };
}
async function campaignTest(deps: Deps, who: Who, args: Json) {
  if (!who.manage) return json(401, { error: 'unauthorized' });
  const tpl = await campaignTemplate(deps, args.template_id); if (!tpl) return json(400, { error: 'bad_request', field: 'template_id' });
  const waId = typeof args.phone === 'string' ? waIdOfPhone(args.phone) : null; if (!waId) return json(400, { error: 'bad_request', field: 'phone' });
  const code = typeof args.code === 'string' && args.code.trim() ? args.code.trim().slice(0, 40) : SAMPLE_VARS['كود_الخصم'];
  const link = await linkOf(deps); if (!link) return json(503, { error: 'not_linked' });
  const { params, missing } = campaignParams(tpl, { name: SAMPLE_VARS['اسم_العميل'], code });
  if (missing.length) return json(400, { error: 'bad_request', field: 'wa_vars' });
  const cfg = await csSettings(deps);
  try {
    const wamid = sentIdOf(await graph(deps, 'POST', waPath.send(link.phone_id), { token: link.token, body: templateBody(waId, tpl.wa_template, cfg.auto.waLang, params) }));
    await logActivity(deps, who, 'cs.campaign.test', String(tpl.id), tpl.wa_template);
    return json(200, { result: 'ok', external_id: wamid, template: tpl.wa_template });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    await logActivity(deps, who, 'cs.campaign.test_failed', String(tpl.id), e.code);
    return json(502, { error: e.code, status: e.status });
  }
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
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) { // the cron (0063): campaign_tick only
    if (action !== 'campaign_tick' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return json(200, await campaignTick(deps)); } catch (e) { console.error('cs-whatsapp campaign_tick: ' + errText(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'status') return await status(deps, who);
    if (action === 'campaign_test') return await campaignTest(deps, who, args);
    if (action === 'media_url') return await mediaUrl(deps, who, args);
    if (action === 'campaign_tick') return who.admin ? json(200, await campaignTick(deps)) : json(401, { error: 'unauthorized' });
    if (action === 'connect_start') return await connectStart(deps, who);
    if (action === 'connect_callback') return await connectCallback(deps, who, args);
    if (action === 'connect_token') return await connectToken(deps, who, args);
    if (action === 'sync') return await sync(deps, who, args);
    if (action === 'disconnect') return await disconnect(deps, who);
    return await send(deps, who, args);
  } catch (e) {
    console.error('cs-whatsapp ' + action + ': ' + errText(e));
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
