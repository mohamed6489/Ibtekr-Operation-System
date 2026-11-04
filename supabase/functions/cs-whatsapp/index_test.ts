// deno-lint-ignore-file no-explicit-any
// cs-whatsapp handler tests (phase 6, decision 26): the webhook (signature, the linked account only, messages / echoes / statuses /
// history / contacts) into the fake database of ../_test/fakes.ts, and the admin's link (Embedded Signup → token → WABA → number →
// subscribed → Vault → the syncs asked for), the send, the disconnect. No network: a fake fetch routes «METHOD path» of Graph.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handler, signBody } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const U = { admin: '00000000-0000-4000-8000-0000000000d1', reply: '00000000-0000-4000-8000-0000000000d2', view: '00000000-0000-4000-8000-0000000000d3' };
const MEMBERS: Record<string, { uid: string; admin?: boolean; view?: string; reply?: string }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-reply': { uid: U.reply, view: 'F', reply: 'F' }, 'jwt-view': { uid: U.view, view: 'P', reply: 'N' },
};
const SECRET = 'app-secret-0123456789abcdef';
const WA_ENV = { ...ENV, META_APP_ID: '1234567890', META_APP_SECRET: SECRET, META_VERIFY_TOKEN: 'verify-me', META_WA_CONFIG_ID: '5550001112' };
const WABA = '1029384756'; const PHONE_ID = '5566778899'; const TOKEN = 'EAAW'.repeat(12);
const LINK = { token: TOKEN, waba_id: WABA, phone_id: PHONE_ID, display: '+20 100 000 0001', name: 'Ibtekr', linked_by: U.admin, linked_at: NOW };
const CHANNELS = [{ id: 'wa1', name: 'واتساب 1 · العملاء', audience: 'customers', kind: 'meta' }, { id: 'wa2', name: 'واتساب 2 · المبتكرين', audience: 'vendors', kind: 'qr', cap_per_day: 150 }];
type Route = { status?: number; body?: unknown } | ((call: any) => { status?: number; body?: unknown });
function fakeGraph(routes: Record<string, Route> = {}) {
  const calls: any[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init.headers);
    const call = { method: init.method ?? 'GET', path: url.pathname.replace(/^\/v25\.0\//, ''), query: Object.fromEntries(url.searchParams), auth: h.get('authorization'), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = routes[`${call.method} ${call.path}`]; const reply = typeof r === 'function' ? r(call) : r;
    if (!reply) return new Response(JSON.stringify({ error: { message: 'no route', code: 100 } }), { status: 404 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
function setup({ seed = {}, env = WA_ENV, vault = {} as Record<string, string | null>, routes = {} as Record<string, Route> } = {}) {
  const rpc = {
    cs_secret_get: ({ p_name }: any) => { if (p_name !== 'meta_wa') throw new Error('unknown secret'); return vault.meta_wa ?? null; },
    cs_secret_set: ({ p_name, p_value }: any) => { if (p_name !== 'meta_wa') throw new Error('unknown secret'); if (p_value === null) delete vault.meta_wa; else vault.meta_wa = p_value; return null; },
  };
  const db = fakeDb({ cs_channels: CHANNELS, ...seed }, { rpc });
  const userDb = (jwt: string) => { const m = MEMBERS[jwt]; return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'cs.view' ? m.view ?? 'N' : key === 'cs.reply' ? m.reply ?? 'N' : 'N'), is_admin: () => m.admin ?? false } : {} }); };
  const g = fakeGraph(routes);
  return { deps: { env, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, fetch: g.fetch }, db, vault, graph: g };
}
const linked = () => ({ meta_wa: JSON.stringify(LINK) });
async function call(deps: any, body: unknown, jwt: string | null = 'jwt-reply') {
  const res = await handler(new Request('http://x/cs-whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', ...(jwt ? { authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
async function deliver(deps: any, payload: unknown, secret = SECRET) {
  const raw = JSON.stringify(payload);
  const res = await handler(new Request('http://x/cs-whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': await signBody(new TextEncoder().encode(raw), secret) }, body: raw }), deps);
  return { res, body: await res.json() };
}
const wa = (field: string, value: any, waba = WABA) => ({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '201000000001', phone_number_id: PHONE_ID }, ...value } }] }] });
const msg = (from: string, id: string, body: string, ts = '1762250000') => ({ from, id, timestamp: ts, type: 'text', text: { body } });

Deno.test('GET verification; a bad signature is 401; nothing is written before a link; another account is ignored', async () => {
  const { deps, db } = setup();
  const ok = await handler(new Request('http://x/cs-whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42'), deps);
  assertEquals([ok.status, await ok.text()], [200, '42']);
  assertEquals((await deliver(deps, wa('messages', {}), 'other-secret')).res.status, 401);
  assertEquals((await deliver(deps, wa('messages', { messages: [msg('201012345678', 'wamid.A', 'hi')] }))).body, { status: 'ignored' });
  assertEquals(db.rows('cs_messages').length, 0);
  assertEquals(db.rows('cs_channel_events').map((r: any) => r.error), ['bad_signature', 'not_linked']);
  const l = setup({ vault: linked() });
  await deliver(l.deps, wa('messages', { messages: [msg('201012345678', 'wamid.A', 'hi')] }, '999999999'));
  assertEquals(l.db.rows('cs_messages').length, 0);
  assertEquals(l.db.rows('cs_channel_events').at(-1).error, 'other_account');
});

Deno.test('a customer\'s message → the customer by phone (named from the profile), the wa1 conversation, an in message once; an echo; statuses', async () => {
  const { deps, db } = setup({ vault: linked() });
  const r = await deliver(deps, wa('messages', { contacts: [{ wa_id: '201012345678', profile: { name: 'منى' } }], messages: [msg('201012345678', 'wamid.A', 'عندكم توصيل؟')] }));
  assertEquals(r.res.status, 200);
  const cu = db.rows('cs_customers')[0];
  assertEquals([cu.phone, cu.name, cu.created_from, cu.source], ['01012345678', 'منى', 'channel', 'واتساب']);
  assertEquals(db.rows('cs_contacts').map((c: any) => [c.platform, c.external_id]), [['whatsapp', '01012345678']]);
  const conv = db.rows('cs_conversations')[0];
  assertEquals([conv.seg, conv.platform, conv.channel, conv.external_id, conv.status], ['customers', 'whatsapp', 'wa1', '01012345678', 'جديدة']);
  const m = db.rows('cs_messages')[0];
  assertEquals([m.kind, m.text, m.external_id, m.created_at], ['in', 'عندكم توصيل؟', 'wamid.A', '2025-11-04T09:53:20.000Z']);
  await deliver(deps, wa('messages', { messages: [msg('201012345678', 'wamid.A', 'عندكم توصيل؟')] }));
  assertEquals(db.rows('cs_messages').length, 1, 'a redelivery is a duplicate');
  // the reply from the phone
  await deliver(deps, wa('smb_message_echoes', { message_echoes: [{ from: '201000000001', to: '201012345678', id: 'wamid.E', timestamp: '1762250100', type: 'text', text: { body: 'أيوه' } }] }));
  const echo = db.rows('cs_messages').find((x: any) => x.external_id === 'wamid.E');
  assertEquals([echo.kind, echo.author, echo.delivery, echo.meta.echo], ['out', null, 'sent', true]);
  assertEquals(db.rows('cs_conversations')[0].status, 'مستنية العميل');
  // statuses: forward only, failed keeps the code
  await deliver(deps, wa('messages', { statuses: [{ id: 'wamid.E', status: 'read', timestamp: '1', recipient_id: '201012345678' }, { id: 'wamid.E', status: 'delivered', timestamp: '2' }] }));
  assertEquals(db.rows('cs_messages').find((x: any) => x.external_id === 'wamid.E').delivery, 'read');
  assert(!JSON.stringify(db.rows('cs_channel_events')).includes('01012345678') && !JSON.stringify(db.rows('cs_channel_events')).includes('أيوه'), 'no phone, no text in the log');
});

Deno.test('the history: a new conversation closed at its first message, the messages in / out at their own time once; the progress and a declined share', async () => {
  const { deps, db } = setup({ vault: linked(), seed: { cs_customers: [{ id: '00000000-0000-4000-8000-0000000000e1', phone: '01055556666', name: 'عميل واتساب', created_from: 'channel' }] } });
  const h = (n: number, out: boolean, ts: string) => ({ from: out ? '201000000001' : '201055556666', id: 'wamid.H' + n, timestamp: ts, type: 'text', text: { body: 'رسالة ' + n } });
  const payload = wa('history', { history: [{ metadata: { phase: 1, chunk_order: 1, progress: 50 }, threads: [{ id: '201055556666', messages: [h(2, true, '1750000060'), h(1, false, '1750000000')] }] }] });
  assertEquals((await deliver(deps, payload)).res.status, 200);
  const conv = db.rows('cs_conversations')[0];
  assertEquals([conv.status, conv.customer_id, conv.updated_at], ['اتحلت', '00000000-0000-4000-8000-0000000000e1', '2025-06-15T15:06:40.000Z']);
  assertEquals(db.rows('cs_messages').map((m: any) => [m.external_id, m.kind, m.meta.history, m.created_at]), [['wamid.H1', 'in', true, '2025-06-15T15:06:40.000Z'], ['wamid.H2', 'out', true, '2025-06-15T15:07:40.000Z']]);
  await deliver(deps, payload);
  assertEquals(db.rows('cs_messages').length, 2, 'a redelivered chunk adds nothing');
  assertEquals(db.row('cs_channels', 'wa1').meta.history.progress, 50);
  await deliver(deps, wa('history', { history: [{ errors: [{ code: 2593109 }] }] }));
  assertEquals(db.row('cs_channels', 'wa1').meta.history.error, 'wa_2593109');
  // the contacts: the unnamed customer takes the phone's name; no customer is made from a contact
  await deliver(deps, wa('smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { full_name: 'كريم', phone_number: '201055556666' }, action: 'add' }, { type: 'contact', contact: { full_name: 'صاحبي', phone_number: '201077778888' }, action: 'add' }] }));
  assertEquals(db.rows('cs_customers').map((c: any) => [c.phone, c.name]), [['01055556666', 'كريم']]);
});

Deno.test('the link: the dialog for the admin only (config id needed); the callback → token → WABA → number → subscribed → Vault → wa1 connected → the syncs asked for', async () => {
  const routes: Record<string, Route> = {
    'GET oauth/access_token': { body: { access_token: TOKEN } },
    'GET debug_token': { body: { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [WABA] }] } } },
    ['GET ' + WABA + '/phone_numbers']: { body: { data: [{ id: PHONE_ID, display_phone_number: '+20 100 000 0001', verified_name: 'Ibtekr', is_on_biz_app: true, platform_type: 'CLOUD_API' }] } },
    ['POST ' + WABA + '/subscribed_apps']: { body: { success: true } },
    ['POST ' + PHONE_ID + '/smb_app_data']: (c: any) => ({ body: { request_id: 'req-' + c.body.sync_type } }),
  };
  const { deps, db, vault, graph } = setup({ routes });
  assertEquals((await call(deps, { action: 'connect_start' }, 'jwt-reply')).res.status, 401);
  assertEquals((await call(setup({ env: { ...WA_ENV, META_WA_CONFIG_ID: '' } }).deps, { action: 'connect_start' }, 'jwt-admin')).body.error, 'not_configured');
  const s = await call(deps, { action: 'connect_start' }, 'jwt-admin');
  const u = new URL(s.body.url); const state = u.searchParams.get('state')!;
  assert(state.startsWith('wa_') && u.searchParams.get('config_id') === '5550001112');
  assertEquals(db.rows('cs_oauth_states')[0].channel, 'wa1');
  const cb = await call(deps, { action: 'connect_callback', code: 'code-123456', state }, 'jwt-admin');
  assertEquals([cb.res.status, cb.body.linked, cb.body.sync], [200, true, { contacts: 'requested', history: 'requested' }]);
  assertEquals(JSON.parse(vault.meta_wa!).phone_id, PHONE_ID);
  const ch = db.row('cs_channels', 'wa1');
  assertEquals([ch.status, ch.number, ch.meta.waba_id, ch.meta.history.request_id, ch.meta.contacts.request_id], ['connected', '+20 100 000 0001', WABA, 'req-history', 'req-smb_app_state_sync']);
  const syncs = graph.calls.filter((c: any) => c.path === PHONE_ID + '/smb_app_data').map((c: any) => c.body.sync_type);
  assertEquals(syncs, ['smb_app_state_sync', 'history'], 'the contacts first, then the history');
  assertEquals(graph.calls.find((c: any) => c.path === 'debug_token').auth, 'Bearer 1234567890|' + SECRET);
  assert(!JSON.stringify(cb.body).includes(TOKEN) && !JSON.stringify(db.rows('activity_log')).includes(TOKEN), 'no token in the answer or the log');
  assertEquals((await call(deps, { action: 'connect_callback', code: 'code-123456', state }, 'jwt-admin')).body.field, 'state', 'a state is spent once');
});

Deno.test('send: the member\'s queued reply → POST /{phone}/messages → sent + wamid; a refusal → failed + code 502; not wa1 → 400; disconnect', async () => {
  const conv = { id: '00000000-0000-4000-8000-0000000000f1', seg: 'customers', platform: 'whatsapp', channel: 'wa1', external_id: '01012345678', status: 'مستنية ردنا' };
  const m1 = { id: '00000000-0000-4000-8000-0000000000f2', conversation_id: conv.id, kind: 'out', text: 'أهلا بيكي', author: U.reply, delivery: 'queued' };
  const m2 = { id: '00000000-0000-4000-8000-0000000000f3', conversation_id: conv.id, kind: 'out', text: 'تاني', author: U.reply, delivery: 'queued' };
  let refuse = false;
  const routes: Record<string, Route> = { ['POST ' + PHONE_ID + '/messages']: () => (refuse ? { status: 400, body: { error: { code: 131047, message: 're-engagement' } } } : { body: { messages: [{ id: 'wamid.SENT' }] } }), ['DELETE ' + WABA + '/subscribed_apps']: { body: { success: true } } };
  const { deps, db, vault, graph } = setup({ vault: linked(), routes, seed: { cs_conversations: [conv], cs_messages: [m1, m2] } });
  const ok = await call(deps, { action: 'send', message_id: m1.id });
  assertEquals([ok.res.status, ok.body.external_id], [200, 'wamid.SENT']);
  const sent = graph.calls.find((c: any) => c.path === PHONE_ID + '/messages');
  assertEquals([sent.body.to, sent.body.text.body, sent.auth], ['201012345678', 'أهلا بيكي', 'Bearer ' + TOKEN]);
  assertEquals([db.row('cs_messages', m1.id).delivery, db.row('cs_messages', m1.id).external_id], ['sent', 'wamid.SENT']);
  refuse = true;
  const bad = await call(deps, { action: 'send', message_id: m2.id });
  assertEquals([bad.res.status, bad.body.error, db.row('cs_messages', m2.id).delivery], [502, 'graph_131047', 'failed']);
  assertEquals((await call(deps, { action: 'send', message_id: m1.id })).res.status, 409, 'not queued any more');
  assertEquals((await call(deps, { action: 'send', message_id: m1.id }, 'jwt-view')).res.status, 401);
  const d = await call(deps, { action: 'disconnect' }, 'jwt-admin');
  assertEquals([d.body.linked, db.row('cs_channels', 'wa1').status, vault.meta_wa], [false, 'disconnected', undefined]);
});

Deno.test('status: the members see wa1\'s state; the admin also the configuration and the number on the Business app', async () => {
  const routes: Record<string, Route> = { ['GET ' + PHONE_ID]: { body: { id: PHONE_ID, display_phone_number: '+20 100 000 0001', is_on_biz_app: true, platform_type: 'CLOUD_API' } } };
  const { deps } = setup({ vault: linked(), routes });
  const m = await call(deps, { action: 'status' }, 'jwt-view');
  assertEquals([m.body.linked, m.body.channel.id, m.body.configured], [true, 'wa1', undefined]);
  const a = await call(deps, { action: 'status' }, 'jwt-admin');
  assertEquals([a.body.config_id, a.body.number.biz_app, a.body.webhook_url.endsWith('/functions/v1/cs-whatsapp')], [true, true, true]);
  assert(!JSON.stringify(a.body).includes(TOKEN));
});
