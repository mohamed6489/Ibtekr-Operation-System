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
function setup({ seed = {}, env = WA_ENV, vault = {} as Record<string, string | null>, routes = {} as Record<string, Route>, rpc: extraRpc = {} as Record<string, (args: any) => unknown> } = {}) {
  const rpc = {
    ...extraRpc,
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

Deno.test('the SDK sign-in (app/wa-connect.html): connect_start hands the public app / config ids and the extras; a code from FB.login is exchanged without a redirect_uri; the session info\'s WABA is a hint the token must be able to read', async () => {
  const routes: Record<string, Route> = {
    'GET oauth/access_token': { body: { access_token: TOKEN } },
    'GET debug_token': { body: { data: { granular_scopes: [] } } },
    ['GET ' + WABA + '/phone_numbers']: { body: { data: [{ id: '111222', display_phone_number: '+20 1', is_on_biz_app: false }, { id: PHONE_ID, display_phone_number: '+20 100 000 0001', verified_name: 'Ibtekr', is_on_biz_app: true }] } },
    ['POST ' + WABA + '/subscribed_apps']: { body: { success: true } },
    ['POST ' + PHONE_ID + '/smb_app_data']: { body: { request_id: 'r' } },
  };
  const { deps, vault, graph } = setup({ routes });
  const s = await call(deps, { action: 'connect_start' }, 'jwt-admin');
  assertEquals([s.body.sdk.app_id, s.body.sdk.config_id, s.body.sdk.extras.featureType, s.body.sdk.extras.version], ['1234567890', '5550001112', 'whatsapp_business_app_onboarding', 'v4']);
  assert(s.body.state.startsWith('wa_') && !JSON.stringify(s.body).includes(SECRET));
  const cb = await call(deps, { action: 'connect_callback', code: 'sdk-code-123456', state: s.body.state, sdk: true, waba_id: WABA, phone_id: PHONE_ID }, 'jwt-admin');
  assertEquals([cb.res.status, cb.body.linked], [200, true]);
  const ex = graph.calls.find((c: any) => c.path === 'oauth/access_token');
  assertEquals([ex.query.code, 'redirect_uri' in ex.query], ['sdk-code-123456', false]);
  assertEquals(JSON.parse(vault.meta_wa!).phone_id, PHONE_ID);
  // a hint the token cannot read, and no scope: no account
  const other = setup({ routes: { ...routes, ['GET ' + WABA + '/phone_numbers']: { status: 403, body: { error: { code: 200 } } } } });
  const s2 = await call(other.deps, { action: 'connect_start' }, 'jwt-admin');
  assertEquals((await call(other.deps, { action: 'connect_callback', code: 'sdk-code-123456', state: s2.body.state, sdk: true, waba_id: WABA }, 'jwt-admin')).body.error, 'no_number');
});

Deno.test('connect_token (the admin, the App Review test number): the token checked against the WABA\'s numbers, the app subscribed, Vault, wa1 connected; no sync; the token never comes back', async () => {
  const routes: Record<string, Route> = {
    ['GET ' + WABA + '/phone_numbers']: { body: { data: [{ id: PHONE_ID, display_phone_number: '+1 555 161 0811', verified_name: 'Test Number' }] } },
    ['POST ' + WABA + '/subscribed_apps']: { body: { success: true } },
  };
  const { deps, db, vault, graph } = setup({ routes });
  assertEquals((await call(deps, { action: 'connect_token', token: TOKEN, waba_id: WABA, phone_id: PHONE_ID }, 'jwt-reply')).res.status, 401);
  assertEquals((await call(deps, { action: 'connect_token', token: 'short', waba_id: WABA, phone_id: PHONE_ID }, 'jwt-admin')).body.field, 'token');
  assertEquals((await call(deps, { action: 'connect_token', token: TOKEN, waba_id: WABA, phone_id: '999999' }, 'jwt-admin')).body.error, 'no_number');
  const ok = await call(deps, { action: 'connect_token', token: TOKEN, waba_id: WABA, phone_id: PHONE_ID }, 'jwt-admin');
  assertEquals([ok.res.status, ok.body.linked, ok.body.manual, ok.body.number.display], [200, true, true, '+1 555 161 0811']);
  assertEquals([JSON.parse(vault.meta_wa!).token, JSON.parse(vault.meta_wa!).phone_id], [TOKEN, PHONE_ID]);
  assertEquals([db.row('cs_channels', 'wa1').status, db.row('cs_channels', 'wa1').meta.manual], ['connected', true]);
  assertEquals(graph.calls.filter((c: any) => c.path.endsWith('/smb_app_data')).length, 0, 'no sync for a test number');
  assert(!JSON.stringify(ok.body).includes(TOKEN) && !JSON.stringify(db.rows('activity_log')).includes(TOKEN));
});

// ---------------------------------------------------------------- the campaigns on wa1 through Meta (phase 13 T1, decisions 1–4)
const TPL = { id: '00000000-0000-4000-8000-00000000c0a1', lib: 'customers', name: 'عرض الجمعة', cat: 'عروض', body: 'أهلاً {اسم_العميل} 👋 خصم بكود {كود_الخصم}.', trig_kind: 'campaign', wa_template: 'ibtekr_offer_v1', wa_vars: ['اسم_العميل', 'كود_الخصم'], active: true };
const CUST = [
  { id: '00000000-0000-4000-8000-00000000c0b1', name: 'نهى عبد الرحمن', phone: '01012345678', consent: true },
  { id: '00000000-0000-4000-8000-00000000c0b2', name: 'كريم', phone: '01098765432', consent: true },
  { id: '00000000-0000-4000-8000-00000000c0b3', name: 'سامح', phone: '01055555555', consent: false },
];
const CAMP = { id: '00000000-0000-4000-8000-00000000c0c1', name: 'حملة الجمعة', channel: 'wa1', body: TPL.body, discount_code: 'FRI10', template_id: TPL.id, scheduled_at: '2026-11-05T10:00:00.000Z', cap_per_day: 300, min_delay_s: 20, status: 'مجدولة', size: 3, stats: {} };
const RECIP = CUST.map((c, i) => ({ id: i + 1, campaign_id: CAMP.id, customer_id: c.id, phone: c.phone, status: 'queued' }));
const DAY_NOW = '2026-11-09T12:00:00.000Z'; // 14:00 Cairo — inside the 9–22 hours
function campaignSetup(extra: { live?: boolean; now?: string; routes?: Record<string, Route>; seed?: Record<string, any[]> } = {}) {
  let n = 0;
  const routes: Record<string, Route> = { ['POST ' + PHONE_ID + '/messages']: () => ({ body: { messages: [{ id: 'wamid.C' + (++n) }] } }), ...(extra.routes ?? {}) };
  const s = setup({ vault: linked(), routes, rpc: { sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok' }, seed: { cs_channels: CHANNELS.map((c) => (c.id === 'wa1' ? { ...c, status: 'connected' } : c)), settings: [{ section: 'cs', data: { live: { wa: false, campaigns: extra.live !== false }, auto: { hours: { from: 9, to: 22 } } } }], cs_templates: [TPL], cs_customers: CUST, cs_campaigns: [CAMP], cs_campaign_recipients: RECIP, ...(extra.seed ?? {}) } });
  const sleeps: number[] = [];
  const deps = { ...s.deps, now: () => extra.now ?? DAY_NOW, sleep: async (ms: number) => { sleeps.push(ms); } };
  return { ...s, deps, sleeps, graph: s.graph };
}
async function tick(deps: any, secret: string | null = 'sync-secret-ok') {
  const res = await handler(new Request('http://x/cs-whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-sync-secret': secret } : {}) }, body: JSON.stringify({ action: 'campaign_tick' }) }), deps);
  return { res, body: await res.json() };
}

Deno.test('campaign_tick (the cron): off → nothing; on → the due campaign runs, up to three approved templates a tick spaced by min_delay_s, each an out row in the customer\'s wa1 conversation; the opted-out customer never gets it', async () => {
  const off = campaignSetup({ live: false });
  assertEquals((await tick(off.deps)).body, { result: 'ok', skipped: 'off' });
  assertEquals(off.db.row('cs_campaigns', CAMP.id).status, 'مجدولة');
  const on = campaignSetup();
  assertEquals((await tick(on.deps, 'wrong')).res.status, 401, 'the sync secret is checked');
  const r = await tick(on.deps);
  assertEquals([r.res.status, r.body.sent, r.body.opted_out], [200, 2, 1]);
  const sends = on.graph.calls.filter((c: any) => c.path === PHONE_ID + '/messages');
  assertEquals(sends.length, 2);
  assertEquals(sends[0].body.type, 'template');
  assertEquals([sends[0].body.to, sends[0].body.template.name, sends[0].body.template.language.code], ['201012345678', 'ibtekr_offer_v1', 'ar']);
  assertEquals(sends[0].body.template.components[0].parameters.map((p: any) => p.text), ['نهى', 'FRI10']);
  assertEquals(sends[1].body.template.components[0].parameters.map((p: any) => p.text), ['كريم', 'FRI10']);
  assertEquals(on.sleeps, [20000], 'one pause between the two sends');
  const recips = on.db.rows('cs_campaign_recipients');
  assertEquals(recips.map((x: any) => [x.status, x.wa_id ?? null]), [['sent', 'wamid.C1'], ['sent', 'wamid.C2'], ['opted_out', null]]);
  const msgs = on.db.rows('cs_messages');
  assertEquals(msgs.length, 2);
  assertEquals([msgs[0].kind, msgs[0].author, msgs[0].delivery, msgs[0].external_id, msgs[0].text, msgs[0].meta.recipient_id, msgs[0].meta.tpl], ['out', null, 'sent', 'wamid.C1', 'أهلاً نهى 👋 خصم بكود FRI10.', 1, 'ibtekr_offer_v1']);
  const convs = on.db.rows('cs_conversations');
  assertEquals(convs.map((c: any) => [c.channel, c.external_id, c.status, c.customer_id]), [['wa1', '01012345678', 'مستنية العميل', CUST[0].id], ['wa1', '01098765432', 'مستنية العميل', CUST[1].id]]);
  const k = on.db.row('cs_campaigns', CAMP.id);
  assertEquals([k.status, k.stats.sent, k.stats.opted_out, k.stats.queued], ['خلصت', 2, 1, 0], 'the queue emptied → finished');
  assertEquals((await tick(on.deps)).body.sent, undefined, 'nothing more to send');
});

Deno.test('campaign_tick: outside the hours it waits (the due campaign still becomes running); a template-less campaign pauses with no_template; the day cap holds; a refusal fails the recipient with the code; the admin may tick by hand, a member may not', async () => {
  const night = campaignSetup({ now: '2026-11-09T22:30:00.000Z' }); // 00:30 Cairo
  assertEquals((await tick(night.deps)).body, { result: 'ok', skipped: 'hours' });
  assertEquals(night.db.row('cs_campaigns', CAMP.id).status, 'شغالة');
  const noTpl = campaignSetup({ seed: { cs_campaigns: [{ ...CAMP, template_id: null }] } });
  assertEquals((await tick(noTpl.deps)).body.no_template, 1);
  assertEquals([noTpl.db.row('cs_campaigns', CAMP.id).status, noTpl.db.row('cs_campaigns', CAMP.id).stats.error], ['متوقفة', 'no_template']);
  const capped = campaignSetup({ seed: { cs_campaigns: [{ ...CAMP, cap_per_day: 1 }], cs_campaign_recipients: [...RECIP, { id: 9, campaign_id: CAMP.id, customer_id: CUST[1].id, phone: CUST[1].phone, status: 'sent', at: '2026-11-09T08:00:00.000Z' }] } });
  assertEquals((await tick(capped.deps)).body.cap, 1, 'one already sent today against a cap of one');
  const refused = campaignSetup({ routes: { ['POST ' + PHONE_ID + '/messages']: { status: 400, body: { error: { code: 132000, message: 'param mismatch' } } } } });
  const r = await tick(refused.deps);
  assertEquals([r.body.failed, r.body.opted_out], [2, 1]);
  assertEquals(refused.db.rows('cs_campaign_recipients').map((x: any) => [x.status, x.error ?? null]), [['failed', 'graph_132000'], ['failed', 'graph_132000'], ['opted_out', null]]);
  assertEquals(refused.db.rows('cs_messages').map((m: any) => [m.delivery, m.meta.error]), [['failed', 'graph_132000'], ['failed', 'graph_132000']]);
  const byHand = campaignSetup();
  assertEquals((await call(byHand.deps, { action: 'campaign_tick' }, 'jwt-reply')).res.status, 401);
  assertEquals((await call(byHand.deps, { action: 'campaign_tick' }, 'jwt-admin')).body.sent, 2);
  // overlapping ticks (security review): a row claimed 30 s ago is another tick's — skipped and counted against the cap; a claim
  // gone stale (3 minutes) is taken again; the claim is conditional, so a row claimed in between is never sent twice
  const racing = campaignSetup({ seed: { cs_campaign_recipients: [{ ...RECIP[0], claimed_at: '2026-11-09T11:59:30.000Z' }, { ...RECIP[1], claimed_at: '2026-11-09T11:57:00.000Z' }] } });
  const r2 = await tick(racing.deps);
  assertEquals([r2.body.sent, racing.graph.calls.filter((c: any) => c.path === PHONE_ID + '/messages').length], [1, 1]);
  assertEquals(racing.db.rows('cs_campaign_recipients').map((x: any) => x.status), ['queued', 'sent']);
});

Deno.test('a receipt on a campaign message moves the recipient and the campaign\'s figures; a customer\'s message within three days is the campaign\'s reply; campaign_test sends the template to one number for cs.manage only', async () => {
  const s = campaignSetup();
  await tick(s.deps);
  await deliver(s.deps, wa('messages', { statuses: [{ id: 'wamid.C1', status: 'delivered', timestamp: '1762690000', recipient_id: '201012345678' }] }));
  await deliver(s.deps, wa('messages', { statuses: [{ id: 'wamid.C2', status: 'read', timestamp: '1762690000', recipient_id: '201098765432' }] }));
  assertEquals(s.db.rows('cs_campaign_recipients').map((x: any) => x.status), ['delivered', 'read', 'opted_out']);
  assertEquals(s.db.row('cs_campaigns', CAMP.id).stats.delivered, 2);
  await deliver(s.deps, wa('messages', { contacts: [{ wa_id: '201012345678', profile: { name: 'Noha' } }], messages: [msg('201012345678', 'wamid.IN1', 'عايزة الكود ده 😍', '1762692000')] }));
  const r1 = s.db.row('cs_campaign_recipients', 1);
  assertEquals([r1.status, r1.reply], ['replied', 'عايزة الكود ده 😍']);
  assertEquals(s.db.row('cs_campaigns', CAMP.id).stats.replies, 1, 'the figures follow the reply too');
  // the test send
  const t = await call(s.deps, { action: 'campaign_test', template_id: TPL.id, phone: '01011112222', code: 'TRY5' }, 'jwt-admin');
  assertEquals([t.res.status, t.body.template], [200, 'ibtekr_offer_v1']);
  const sent = s.graph.calls.filter((c: any) => c.path === PHONE_ID + '/messages').at(-1);
  assertEquals([sent.body.to, sent.body.template.components[0].parameters.map((p: any) => p.text)], ['201011112222', ['نهى', 'TRY5']]);
  assertEquals(s.db.rows('activity_log').at(-1).action, 'cs.campaign.test');
  assertEquals((await call(s.deps, { action: 'campaign_test', template_id: TPL.id, phone: '01011112222' }, 'jwt-reply')).res.status, 401, 'cs.reply without cs.manage');
  assertEquals((await call(s.deps, { action: 'campaign_test', template_id: TPL.id, phone: '12' }, 'jwt-admin')).body.field, 'phone');
  assertEquals((await call(s.deps, { action: 'campaign_test', template_id: '00000000-0000-4000-8000-00000000c0ff', phone: '01011112222' }, 'jwt-admin')).body.field, 'template_id');
});

// ---------------------------------------------------------------- attachments (phase 13 T3, decision 6)
Deno.test('send with meta.media: the member\'s file in cs-media goes out as an image / document by a signed link (the caption unless the placeholder); another member\'s folder → 401; a customer\'s media is kept once and signed (media_url), for members who see the thread', async () => {
  const conv = { id: '00000000-0000-4000-8000-00000000e0f1', seg: 'customers', platform: 'whatsapp', channel: 'wa1', external_id: '01012345678', status: 'مستنية ردنا' };
  const img = { id: '00000000-0000-4000-8000-00000000e0f2', conversation_id: conv.id, kind: 'out', text: 'شوفي دي', author: U.reply, delivery: 'queued', meta: { media: { path: U.reply + '/ab12-photo.jpg', type: 'image/jpeg', name: 'photo.jpg', size: 1200 } } };
  const pdf = { id: '00000000-0000-4000-8000-00000000e0f3', conversation_id: conv.id, kind: 'out', text: '📎 فاتورة.pdf', author: U.reply, delivery: 'queued', meta: { media: { path: U.reply + '/cd34-invoice.pdf', type: 'application/pdf', name: 'فاتورة.pdf', size: 5000 } } };
  const theirs = { id: '00000000-0000-4000-8000-00000000e0f4', conversation_id: conv.id, kind: 'out', text: 'x', author: U.reply, delivery: 'queued', meta: { media: { path: U.admin + '/zz-other.jpg', type: 'image/jpeg', name: 'o.jpg', size: 1 } } };
  const inMedia = { id: '00000000-0000-4000-8000-00000000e0f5', conversation_id: conv.id, kind: 'in', text: '[صورة]', author: null, external_id: 'wamid.IN9', delivery: null, meta: { kind: 'image', media_id: '5550001234', mime: 'image/jpeg' } };
  const storage: Record<string, Uint8Array> = { ['cs-media/' + U.reply + '/ab12-photo.jpg']: new Uint8Array([1]), ['cs-media/' + U.reply + '/cd34-invoice.pdf']: new Uint8Array([2]) };
  const routes: Record<string, Route> = {
    ['POST ' + PHONE_ID + '/messages']: (() => { let k = 0; return () => ({ body: { messages: [{ id: 'wamid.MEDIA' + (++k) }] } }); })(),
    'GET 5550001234': { body: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=5550001234', mime_type: 'image/jpeg' } },
    'GET /whatsapp_business/attachments/': { body: { bytes: 'jpeg' } },
  };
  const base = setup({ vault: linked(), routes, seed: { cs_conversations: [conv], cs_messages: [img, pdf, theirs, inMedia] } });
  (base.db as any).storage = fakeDb({}, { storage }).storage; // the bucket's files
  const deps = base.deps;
  const r1 = await call(deps, { action: 'send', message_id: img.id });
  assertEquals([r1.res.status, r1.body.external_id], [200, 'wamid.MEDIA1']);
  const sent = base.graph.calls.filter((c: any) => c.path === PHONE_ID + '/messages');
  assertEquals([sent[0].body.type, sent[0].body.image.caption, /^https:\/\/signed\.test\/cs-media\//.test(sent[0].body.image.link)], ['image', 'شوفي دي', true]);
  const r2 = await call(deps, { action: 'send', message_id: pdf.id });
  assertEquals(r2.res.status, 200);
  assertEquals([sent[1]?.body.type ?? base.graph.calls.at(-1).body.type, base.graph.calls.at(-1).body.document.filename, base.graph.calls.at(-1).body.document.caption], ['document', 'فاتورة.pdf', undefined], 'the placeholder is no caption');
  assertEquals((await call(deps, { action: 'send', message_id: theirs.id })).res.status, 401, 'a file of another member\'s folder');
  // the customer's media: fetched from Meta once into inbound/<message id>, then signed; the viewer of the thread may ask
  const m1 = await call(deps, { action: 'media_url', message_id: inMedia.id });
  assertEquals([m1.res.status, m1.body.type, /cs-media\/inbound\/00000000-0000-4000-8000-00000000e0f5\.jpg/.test(m1.body.url)], [200, 'image/jpeg', true]);
  assertEquals(base.db.row('cs_messages', inMedia.id).meta.media_path, 'inbound/' + inMedia.id + '.jpg');
  const fetched = base.graph.calls.filter((c: any) => c.path === '5550001234' || c.path === '/whatsapp_business/attachments/').length;
  await call(deps, { action: 'media_url', message_id: inMedia.id });
  assertEquals(base.graph.calls.filter((c: any) => c.path === '5550001234' || c.path === '/whatsapp_business/attachments/').length, fetched, 'the second ask signs the kept file');
  assertEquals((await call(deps, { action: 'media_url', message_id: inMedia.id }, 'jwt-view')).res.status, 404, 'cs.view P without the assignment');
  assertEquals((await call(deps, { action: 'media_url', message_id: img.id })).res.status, 200, 'our own attachment is signed too');
  assertEquals((await call(deps, { action: 'media_url', message_id: '00000000-0000-4000-8000-00000000e0ff' })).res.status, 404);
});
