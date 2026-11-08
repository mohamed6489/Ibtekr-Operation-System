// cs-wa (phase 6.3 + 6.4, decisions 21–24): the door of the wa-bridge service (WhatsApp 1 / 2 by QR) and of the campaigns' sending.
//
// * The bridge (X-Bridge-Secret = WA_BRIDGE_SECRET, constant time; it never holds a service key):
//     state           its state per channel (qr + the QR as SVG / connecting / connected / logged_out / offline) → cs_wa_state +
//                     cs_channels; the answer carries the admin's command (logout) once
//     inbound         a message from a customer (wa1) or a maker (wa2), or an echo of one sent from the phone → the customer (by the
//                     normalised phone; a new one «channel» when missing) or the maker (by phone; unknown = ignored) + the conversation
//                     (one per channel and phone) + the message (dedupe on WhatsApp's id); «إيقاف» on wa1 = the customer opts out
//     receipt         delivered / read on our messages and campaign sends
//     outbox          the queued outgoing messages of the channel (claimed two minutes, so a restart never sends one twice)
//     sent            the outcome of one (sent + WhatsApp's id, or failed + a code)
//     campaign_next   the next campaign message of the channel when the pacing allows (the day's cap in Cairo, the pause); a due
//                     «مجدولة» becomes «شغالة», an emptied one «خلصت»; nothing while settings «cs».live.campaigns is off
//     campaign_result the outcome of one send → the recipient, the campaign's stats; failures over STOP_RATE pause it
// * The admin (member JWT): wa_status (the states + the QR) and wa_logout { channel }.
// No message text, phone or QR is ever logged; activity_log cs.wa.* carries the channel only.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CHANNELS, CLAIM_MS, campaignText, cairoDayStart, isOptOut, jidOfPhone, normPhone, paceOk, parseInbound, parseState, sameSecret, shouldStop } from '../_shared/cs-wa.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = { env: Record<string, string | undefined>; db: Db; now: () => string; userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null> };

const BRIDGE = ['state', 'inbound', 'receipt', 'outbox', 'sent', 'campaign_next', 'campaign_result'];
const ADMIN = ['wa_status', 'wa_logout'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f-]{36}$/i;
const ms = (iso: unknown) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : null; };
const iso = (t: number) => new Date(t).toISOString();
const fail = (where: string, e: { code?: string } | null) => { throw new Error(where + ': ' + (e?.code ?? 'error')); };

async function live(deps: Deps): Promise<{ wa: boolean; campaigns: boolean }> {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'cs').maybeSingle();
  const l = isObj(data) && isObj(data.data) && isObj(data.data.live) ? data.data.live : {};
  return { wa: l.wa === true, campaigns: l.campaigns === true };
}

// ---------------------------------------------------------------- state

async function onState(deps: Deps, b: Json) {
  const s = parseState(b); if (!s) return json(400, { error: 'bad_request' });
  const { data: before } = await deps.db.from('cs_wa_state').select('status, command').eq('channel', s.channel).maybeSingle();
  const command = isObj(before) && before.command ? String(before.command) : null;
  const row: Json = { status: s.status, qr_svg: s.qr_svg, command: null, updated_at: deps.now() };
  if (s.status === 'connected') row.phone = s.phone; else if (s.status === 'logged_out') row.phone = null;
  const { error } = await deps.db.from('cs_wa_state').update(row).eq('channel', s.channel);
  if (error) fail('cs_wa_state', error);
  if (await onCloud(deps, s.channel)) return json(200, { result: 'ok', command: command ?? 'logout' }); // decision 26: wa1 is on the Cloud API — the bridge's session goes
  const was = isObj(before) ? String(before.status) : 'offline';
  const chan = s.status === 'connected' ? 'connected' : s.status === 'offline' && was === 'connected' ? 'error' : 'disconnected';
  const patch: Json = { status: chan, updated_at: deps.now() };
  if (s.status === 'connected') { patch.number = s.phone; if (was !== 'connected') patch.since = deps.now(); }
  if (s.status === 'logged_out') { patch.number = null; patch.since = null; }
  await deps.db.from('cs_channels').update(patch).eq('id', s.channel);
  return json(200, { result: 'ok', command });
}

// ---------------------------------------------------------------- inbound

async function customerByPhone(deps: Deps, phone: string, name: string | null): Promise<string> {
  const { data: had } = await deps.db.from('cs_customers').select('id, merged_into').eq('phone', phone).maybeSingle();
  if (isObj(had)) return String(had.merged_into || had.id);
  const { data: made, error } = await deps.db.from('cs_customers').insert({ phone, name: name || 'عميل واتساب', created_from: 'channel', source: 'واتساب', created_by: null, created_at: deps.now() }).select('id').single();
  if (error?.code === '23505') { const { data: again } = await deps.db.from('cs_customers').select('id, merged_into').eq('phone', phone).maybeSingle(); if (isObj(again)) return String(again.merged_into || again.id); }
  if (error || !isObj(made)) fail('cs_customers', error);
  await deps.db.from('cs_contacts').insert({ customer_id: made.id, platform: 'whatsapp', external_id: phone, handle: name, created_at: deps.now() });
  return String(made.id);
}
async function vendorByPhone(deps: Deps, phone: string): Promise<string | null> {
  const { data } = await deps.db.from('vendors').select('id, phone, alt_phone');
  const v = (Array.isArray(data) ? data : []).find((r: Json) => normPhone(r.phone) === phone || (r.alt_phone && normPhone(r.alt_phone) === phone));
  return v ? String(v.id) : null;
}
async function conversation(deps: Deps, row: Json): Promise<{ id: string; status: string; fresh: boolean }> {
  const { data: found } = await deps.db.from('cs_conversations').select('id, status').eq('channel', row.channel).eq('external_id', row.external_id).maybeSingle();
  if (isObj(found)) return { id: String(found.id), status: String(found.status), fresh: false };
  const { data: made, error } = await deps.db.from('cs_conversations').insert({ ...row, status: 'جديدة', created_by: null, created_at: deps.now(), updated_at: deps.now() }).select('id, status').single();
  if (error?.code === '23505') { const { data: again } = await deps.db.from('cs_conversations').select('id, status').eq('channel', row.channel).eq('external_id', row.external_id).maybeSingle(); if (isObj(again)) return { id: String(again.id), status: String(again.status), fresh: false }; }
  if (error || !isObj(made)) fail('cs_conversations', error);
  return { id: String(made.id), status: 'جديدة', fresh: true };
}
// decision 26 (0043): a channel on Meta's Cloud API (wa1) is cs-whatsapp's — the QR bridge neither feeds it nor sends from it
async function onCloud(deps: Deps, channel: string): Promise<boolean> {
  const { data } = await deps.db.from('cs_channels').select('kind').eq('id', channel).maybeSingle();
  return isObj(data) && data.kind === 'meta';
}
async function onInbound(deps: Deps, b: Json) {
  const ev = parseInbound(b); if (!ev) return json(400, { error: 'bad_request' });
  if (await onCloud(deps, ev.channel)) return json(200, { result: 'ignored', reason: 'cloud_channel' });
  const at = ev.at != null ? iso(ev.at) : deps.now();
  let conv: { id: string; status: string; fresh: boolean }; let customerId: string | null = null;
  if (ev.channel === 'wa1') {
    customerId = await customerByPhone(deps, ev.phone, ev.fromMe ? null : ev.name);
    conv = await conversation(deps, { seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: customerId, external_id: ev.phone, handle: null });
  } else {
    const vendorId = await vendorByPhone(deps, ev.phone);
    if (!vendorId) return json(200, { result: 'ignored', reason: 'unknown_vendor' });
    conv = await conversation(deps, { seg: 'vendors', platform: 'whatsapp', channel: 'wa2', vendor_id: vendorId, external_id: ev.phone, handle: null });
  }
  if (ev.fromMe) { // sent from the phone itself, or the echo of our own send: our claimed row with that text takes the id
    const { data: mine } = await deps.db.from('cs_messages').select('id').eq('conversation_id', conv.id).eq('kind', 'out').eq('text', ev.text).is('external_id', null).not('claimed_at', 'is', null).limit(1);
    if (Array.isArray(mine) && isObj(mine[0])) { await deps.db.from('cs_messages').update({ external_id: ev.id, delivery: 'sent' }).eq('id', mine[0].id); return json(200, { result: 'ok', kind: 'own' }); }
    const { error } = await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'out', text: ev.text, author: null, external_id: ev.id, delivery: 'sent', meta: { echo: true, kind: ev.kind }, created_at: at });
    if (error && error.code !== '23505') fail('cs_messages', error);
    return json(200, { result: 'ok', kind: 'echo' });
  }
  const { error } = await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'in', text: ev.text, author: null, external_id: ev.id, delivery: null, meta: { kind: ev.kind }, created_at: at });
  if (error?.code === '23505') return json(200, { result: 'ok', kind: 'duplicate' });
  if (error) fail('cs_messages', error);
  const next = conv.fresh ? 'جديدة' : 'مستنية ردنا';
  if (next !== conv.status) await deps.db.from('cs_conversations').update({ status: next, snoozed_until: null, updated_at: deps.now() }).eq('id', conv.id);
  if (customerId) {
    // a reply to a campaign of the last three days marks its recipient; «إيقاف» stops the campaigns for this customer
    const since = iso(ms(deps.now())! - 3 * 864e5);
    if (isOptOut(ev.text)) {
      await deps.db.from('cs_customers').update({ consent: false }).eq('id', customerId);
      await deps.db.from('cs_campaign_recipients').update({ status: 'opted_out', at: deps.now() }).eq('customer_id', customerId).eq('status', 'queued');
      await deps.db.from('cs_messages').insert({ conversation_id: conv.id, kind: 'event', text: 'العميل طلب إيقاف رسايل العروض — اتشال من الحملات', author: null, delivery: null, meta: { opt_out: true }, created_at: deps.now() });
    }
    await deps.db.from('cs_campaign_recipients').update({ status: 'replied', reply: ev.text.slice(0, 500) }).eq('customer_id', customerId).in('status', ['sent', 'delivered', 'read']).gte('at', since);
  }
  return json(200, { result: 'ok', kind: 'in' });
}

// ---------------------------------------------------------------- receipts, outbox, sent

async function onReceipt(deps: Deps, b: Json) {
  const ids = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_.:-]{4,200}$/.test(x)).slice(0, 100) : [];
  const to = b.status === 'read' ? 'read' : b.status === 'delivered' ? 'delivered' : null;
  if (!ids.length || !to || !CHANNELS.includes(b.channel)) return json(400, { error: 'bad_request' });
  const from = to === 'read' ? ['sent', 'delivered'] : ['sent'];
  await deps.db.from('cs_messages').update({ delivery: to }).in('external_id', ids).eq('kind', 'out').in('delivery', from);
  await deps.db.from('cs_campaign_recipients').update({ status: to }).in('wa_id', ids).in('status', from);
  return json(200, { result: 'ok' });
}
async function phoneOfConv(deps: Deps, c: Json): Promise<string | null> {
  if (c.external_id && /^\d{6,15}$/.test(String(c.external_id))) return String(c.external_id);
  if (c.seg === 'vendors' && c.vendor_id) { const { data } = await deps.db.from('vendors').select('phone').eq('id', c.vendor_id).maybeSingle(); return isObj(data) && data.phone ? normPhone(data.phone) || null : null; }
  if (c.customer_id) { const { data } = await deps.db.from('cs_customers').select('phone').eq('id', c.customer_id).maybeSingle(); return isObj(data) && data.phone ? String(data.phone) : null; }
  return null;
}
async function onOutbox(deps: Deps, b: Json) {
  if (!CHANNELS.includes(b.channel)) return json(400, { error: 'bad_request' });
  if (await onCloud(deps, b.channel)) return json(200, { result: 'ok', items: [] });
  const { data: convs } = await deps.db.from('cs_conversations').select('id, seg, customer_id, vendor_id, external_id').eq('channel', b.channel).neq('status', 'اتحلت');
  const byId = new Map((Array.isArray(convs) ? convs : []).map((c: Json) => [String(c.id), c]));
  if (!byId.size) return json(200, { result: 'ok', items: [] });
  const stale = iso(ms(deps.now())! - CLAIM_MS);
  const { data: rows } = await deps.db.from('cs_messages').select('id, conversation_id, text, claimed_at').in('kind', ['out', 'auto']).eq('delivery', 'queued').in('conversation_id', [...byId.keys()]).order('created_at').limit(20);
  const items: Json[] = [];
  for (const m of Array.isArray(rows) ? rows : []) {
    if (m.claimed_at && String(m.claimed_at) > stale) continue;
    const phone = await phoneOfConv(deps, byId.get(String(m.conversation_id)) ?? {});
    const jid = phone ? jidOfPhone(phone) : null;
    if (!jid) { await deps.db.from('cs_messages').update({ delivery: 'failed', meta: { error: 'no_phone' } }).eq('id', m.id); continue; }
    await deps.db.from('cs_messages').update({ claimed_at: deps.now() }).eq('id', m.id);
    items.push({ id: m.id, jid, text: m.text });
  }
  return json(200, { result: 'ok', items });
}
async function onSent(deps: Deps, b: Json) {
  if (typeof b.id !== 'string' || !UUID.test(b.id)) return json(400, { error: 'bad_request' });
  const waId = typeof b.wa_id === 'string' && /^[A-Za-z0-9_.:-]{4,200}$/.test(b.wa_id) ? b.wa_id : null;
  const patch: Json = b.ok === true ? { delivery: 'sent', external_id: waId } : { delivery: 'failed', meta: { error: String(b.error ?? 'send_failed').replace(/[^\w:.-]/g, '').slice(0, 60) } };
  const { error } = await deps.db.from('cs_messages').update(patch).eq('id', b.id).in('kind', ['out', 'auto']);
  if (error && error.code !== '23505') fail('cs_messages', error);
  return json(200, { result: 'ok' });
}

// ---------------------------------------------------------------- campaigns

async function onCampaignNext(deps: Deps, b: Json) {
  if (!CHANNELS.includes(b.channel)) return json(400, { error: 'bad_request' });
  if (!(await live(deps)).campaigns) return json(200, { result: 'ok', items: [], reason: 'not_live' });
  const now = deps.now(); const nowMs = ms(now)!;
  await deps.db.from('cs_campaigns').update({ status: 'شغالة' }).eq('channel', b.channel).eq('status', 'مجدولة').lte('scheduled_at', now);
  const { data: running } = await deps.db.from('cs_campaigns').select('id, body, discount_code, cap_per_day, min_delay_s').eq('channel', b.channel).eq('status', 'شغالة').order('scheduled_at');
  const dayStart = cairoDayStart(now); const stale = iso(nowMs - CLAIM_MS);
  let wait: number | null = null;
  for (const k of Array.isArray(running) ? running : []) {
    const { data: done } = await deps.db.from('cs_campaign_recipients').select('at').eq('campaign_id', k.id).in('status', ['sent', 'delivered', 'read', 'replied', 'ordered', 'failed']).gte('at', dayStart);
    const ats = (Array.isArray(done) ? done : []).map((r: Json) => ms(r.at)).filter((t: number | null): t is number => t != null);
    const pace = paceOk({ sentToday: ats.length, cap: Number(k.cap_per_day) || 300, lastAt: ats.length ? Math.max(...ats) : null, minDelayS: Number(k.min_delay_s) || 20, nowMs });
    if (!pace.ok) { if (pace.waitMs != null) wait = wait == null ? pace.waitMs : Math.min(wait, pace.waitMs); continue; }
    const { data: queued } = await deps.db.from('cs_campaign_recipients').select('id, customer_id, phone, claimed_at').eq('campaign_id', k.id).eq('status', 'queued').order('id').limit(10);
    const list = Array.isArray(queued) ? queued : [];
    if (!list.length) { await deps.db.from('cs_campaigns').update({ status: 'خلصت' }).eq('id', k.id); continue; }
    for (const r of list) {
      if (r.claimed_at && String(r.claimed_at) > stale) continue; // a send in flight
      const jid = jidOfPhone(r.phone);
      if (!jid) { await deps.db.from('cs_campaign_recipients').update({ status: 'failed', error: 'no_phone', at: now }).eq('id', r.id); continue; }
      // re-checked at send time (review of 0042): a status set to «مجدولة» by hand, or a customer who opted out / was blocked or merged
      // since the scheduling, never gets the message
      const { data: cu } = r.customer_id ? await deps.db.from('cs_customers').select('name, consent, blocked_at, merged_into').eq('id', r.customer_id).maybeSingle() : { data: null };
      if (!isObj(cu) || cu.consent === false || cu.blocked_at || cu.merged_into) { await deps.db.from('cs_campaign_recipients').update({ status: 'opted_out', at: now }).eq('id', r.id); continue; }
      await deps.db.from('cs_campaign_recipients').update({ claimed_at: now }).eq('id', r.id);
      return json(200, { result: 'ok', items: [{ recipient_id: r.id, campaign_id: k.id, jid, text: campaignText(k.body, { name: cu.name, code: k.discount_code }) }] });
    }
  }
  return json(200, { result: 'ok', items: [], wait_ms: wait });
}
async function onCampaignResult(deps: Deps, b: Json) {
  const id = Number(b.recipient_id); if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request' });
  const waId = typeof b.wa_id === 'string' && /^[A-Za-z0-9_.:-]{4,200}$/.test(b.wa_id) ? b.wa_id : null;
  const { data: r } = await deps.db.from('cs_campaign_recipients').select('campaign_id').eq('id', id).maybeSingle();
  if (!isObj(r)) return json(404, { error: 'not_found' });
  await deps.db.from('cs_campaign_recipients').update(b.ok === true ? { status: 'sent', wa_id: waId, at: deps.now(), claimed_at: null } : { status: 'failed', error: String(b.error ?? 'send_failed').replace(/[^\w:.-]/g, '').slice(0, 60), at: deps.now(), claimed_at: null }).eq('id', id);
  const { data: all } = await deps.db.from('cs_campaign_recipients').select('status').eq('campaign_id', r.campaign_id);
  const counts: Record<string, number> = {}; (Array.isArray(all) ? all : []).forEach((x: Json) => { counts[x.status] = (counts[x.status] ?? 0) + 1; });
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.replied ?? 0) + (counts.ordered ?? 0);
  const stats = { sent, delivered: (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.replied ?? 0), read: (counts.read ?? 0) + (counts.replied ?? 0), replies: counts.replied ?? 0, failed: counts.failed ?? 0, opted_out: counts.opted_out ?? 0, queued: counts.queued ?? 0 };
  const patch: Json = { stats };
  if (shouldStop({ sent, failed: stats.failed })) patch.status = 'متوقفة';
  else if (!stats.queued) patch.status = 'خلصت';
  await deps.db.from('cs_campaigns').update(patch).eq('id', r.campaign_id).eq('status', 'شغالة');
  return json(200, { result: 'ok', stopped: patch.status === 'متوقفة' });
}

// ---------------------------------------------------------------- the admin

async function adminOf(req: Request, deps: Deps): Promise<string | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const { data, error } = await deps.userDb(jwt).rpc('is_admin');
  if (error || data !== true) return null;
  return await deps.userId(jwt);
}
async function onAdmin(deps: Deps, uid: string, action: string, b: Json) {
  if (action === 'wa_status') {
    const { data } = await deps.db.from('cs_wa_state').select('channel, status, qr_svg, phone, updated_at');
    return json(200, { result: 'ok', live: await live(deps), states: (Array.isArray(data) ? data : []).map((r: Json) => ({ channel: r.channel, status: r.status, qr_svg: r.status === 'qr' ? r.qr_svg : null, phone: r.phone, updated_at: r.updated_at })) });
  }
  if (!CHANNELS.includes(b.channel)) return json(400, { error: 'bad_request', field: 'channel' });
  await deps.db.from('cs_wa_state').update({ command: 'logout', updated_at: deps.now() }).eq('channel', b.channel);
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: uid, action: 'cs.wa.logout', entity: 'cs_channel', entity_id: b.channel, new_value: null }); } catch { /* never blocks */ }
  return json(200, { result: 'ok' });
}

// ---------------------------------------------------------------- entry

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const b: Json = isObj(body) ? body : {}; const action = typeof b.action === 'string' ? b.action : '';
  try {
    const secret = req.headers.get('x-bridge-secret');
    if (secret != null) {
      if (!sameSecret(secret, (deps.env.WA_BRIDGE_SECRET ?? '').trim())) return json(401, { error: 'unauthorized' });
      if (!BRIDGE.includes(action)) return json(400, { error: 'unknown_action' });
      if (action === 'state') return await onState(deps, b);
      if (action === 'inbound') return await onInbound(deps, b);
      if (action === 'receipt') return await onReceipt(deps, b);
      if (action === 'outbox') return await onOutbox(deps, b);
      if (action === 'sent') return await onSent(deps, b);
      if (action === 'campaign_next') return await onCampaignNext(deps, b);
      return await onCampaignResult(deps, b);
    }
    if (!ADMIN.includes(action)) return json(400, { error: 'unknown_action' });
    const uid = await adminOf(req, deps); if (!uid) return json(401, { error: 'unauthorized' });
    return await onAdmin(deps, uid, action, b);
  } catch (e) {
    console.error('cs-wa ' + action + ': ' + String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200));
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
