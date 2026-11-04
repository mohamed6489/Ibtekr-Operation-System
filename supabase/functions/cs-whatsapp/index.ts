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
//     sync             (the admin) { type: 'history' | 'contacts' } → asked again (Meta answers once per number).
//     disconnect       (the admin) → the subscription removed (best effort), the secret removed, wa1 disconnected.
//     send             (cs.reply, on a wa1 conversation the member sees, their own queued row unless the admin) { message_id } →
//                      POST /{phone}/messages (text) → sent + the wamid; a refusal (e.g. 131047: past the 24 hours) → failed + code, 502.
// Secrets: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN (shared with cs-channel), META_WA_CONFIG_ID (the Embedded Signup
// configuration); the owner sets them. Nothing here logs a token, a phone or a message's text.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { STATE_PREFIX, graphErrorCode, parseWaWebhook, phoneOfWaId, phonesOf, sentIdOf, syncBody, textBody, waAuthUrl, waIdOfPhone, wabaIdsOf, waPath } from '../_shared/cs-whatsapp.js';
import { isOptOut } from '../_shared/cs-wa.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

const ACTIONS = ['status', 'connect_start', 'connect_callback', 'sync', 'disconnect', 'send'];
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
  if (!(await put(deps, { conversation_id: conv.id, kind: 'in', text: ev.text, author: null, external_id: ev.id, delivery: null, meta: { kind: ev.kind, reply_to: ev.replyTo, at: ev.at }, created_at: iso(ev.at, deps) }))) { bump(s, 'duplicates'); return; }
  const next = conv.fresh ? 'جديدة' : 'مستنية ردنا';
  if (next !== conv.status) await setStatus(deps, conv.id, next);
  if (isOptOut(ev.text)) { // «إيقاف»: no more campaigns for this customer
    await deps.db.from('cs_customers').update({ consent: false }).eq('id', customerId);
    await deps.db.from('cs_campaign_recipients').update({ status: 'opted_out', at: deps.now() }).eq('customer_id', customerId).eq('status', 'queued');
    await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'event', text: 'العميل طلب إيقاف رسايل العروض — اتشال من الحملات', author: null, delivery: null, meta: { opt_out: true }, created_at: deps.now() });
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
  const { data: m } = await deps.db.from('cs_messages').select('id, delivery, meta').eq('external_id', ev.id).eq('kind', 'out').maybeSingle();
  if (!isObj(m)) { bump(s, 'ignored:status'); return; }
  if (ev.status === 'failed') { if (m.delivery !== 'read') await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { ...(isObj(m.meta) ? m.meta : {}), error: ev.error ?? 'wa_failed' } }).eq('id', m.id); bump(s, 'failed'); return; }
  if ((RANK[ev.status] ?? -1) > (RANK[String(m.delivery)] ?? -1) && m.delivery !== 'failed') await deps.db.from('cs_messages').update({ delivery: ev.status }).eq('id', m.id);
  bump(s, ev.status === 'read' ? 'reads' : ev.status === 'delivered' ? 'deliveries' : 'sent');
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
  return json(200, { result: 'ok', url: waAuthUrl(app.id, redirectUri(deps.env), state, config) });
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
    const t = await graph(deps, 'GET', waPath.tokenExchange(app.id, redirectUri(deps.env), code) + encodeURIComponent(app.secret));
    const token = typeof t.access_token === 'string' ? t.access_token : '';
    if (!token) throw new GraphError('graph_no_token');
    const wabas = wabaIdsOf(await graph(deps, 'GET', waPath.debugToken(token), { token: app.id + '|' + app.secret }));
    if (!wabas.length) return json(400, { error: 'no_account' });
    let picked: { waba: string; phone: ReturnType<typeof phonesOf>[number] } | null = null;
    for (const waba of wabas) { const p = phonesOf(await graph(deps, 'GET', waPath.phones(waba), { token }))[0]; if (p) { picked = { waba, phone: p }; break; } }
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
  try {
    const wamid = sentIdOf(await graph(deps, 'POST', waPath.send(link.phone_id), { token: link.token, body: textBody(waId, String(m.text)) }));
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
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    if (action === 'status') return await status(deps, who);
    if (action === 'connect_start') return await connectStart(deps, who);
    if (action === 'connect_callback') return await connectCallback(deps, who, args);
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
