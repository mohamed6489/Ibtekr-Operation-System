// deno-lint-ignore-file no-explicit-any
// cs-channel handler tests (phase 6.2): the webhook verification and signature, the deliveries (messages, echoes, receipts,
// comments) into the fake database of ../_test/fakes.ts, the members' actions (status, the page link through a fake Graph, send,
// private reply, hide). No network: a fake fetch routes «METHOD path» of graph.facebook.com.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler, signBody } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const U = { admin: '00000000-0000-4000-8000-0000000000c1', reply: '00000000-0000-4000-8000-0000000000c2', view: '00000000-0000-4000-8000-0000000000c3', none: '00000000-0000-4000-8000-0000000000c4' };
const MEMBERS: Record<string, { uid: string; admin?: boolean; view?: string; reply?: string }> = {
  'jwt-admin': { uid: U.admin, admin: true }, 'jwt-reply': { uid: U.reply, view: 'F', reply: 'F' }, 'jwt-view': { uid: U.view, view: 'P', reply: 'N' }, 'jwt-none': { uid: U.none, view: 'N', reply: 'N' },
};
const SECRET = 'app-secret-0123456789abcdef';
const META_ENV = { ...ENV, META_APP_ID: '1234567890', META_APP_SECRET: SECRET, META_VERIFY_TOKEN: 'verify-me' };
const PAGE = { id: '111', name: 'Ibtekr Club', token: 'EAAB'.repeat(12), ig: { id: '777', username: 'ibtekr.club' } };
const CHANNELS = [
  { id: 'wa1', name: 'واتساب 1 · العملاء', audience: 'customers', kind: 'qr' }, { id: 'messenger', name: 'ماسنجر', audience: 'customers', kind: 'meta', cap_per_day: 1000 },
  { id: 'instagram', name: 'إنستجرام', audience: 'customers', kind: 'meta', cap_per_day: 1000 }, { id: 'tiktok', name: 'تيك توك', audience: 'customers', kind: 'none', cap_per_day: 0 },
];
type Route = { status?: number; body?: unknown } | ((call: GraphCall) => { status?: number; body?: unknown });
type GraphCall = { method: string; path: string; query: Record<string, string>; auth: string | null; body: any };
function fakeGraph(routes: Record<string, Route> = {}) {
  const calls: GraphCall[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const h = new Headers(init.headers); const ct = h.get('content-type') ?? '';
    const body = !init.body ? undefined : ct.includes('json') ? JSON.parse(String(init.body)) : Object.fromEntries(new URLSearchParams(String(init.body)));
    const call: GraphCall = { method: init.method ?? 'GET', path: url.pathname.replace(/^\/v21\.0\//, ''), query: Object.fromEntries(url.searchParams), auth: h.get('authorization'), body };
    calls.push(call);
    const r = routes[`${call.method} ${call.path}`]; const reply = typeof r === 'function' ? r(call) : r;
    if (!reply) return new Response(JSON.stringify({ error: { message: 'no route', code: 100 } }), { status: 404 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
type Opts = { seed?: Record<string, any[]>; env?: Record<string, string>; vault?: Record<string, string | null>; routes?: Record<string, Route>; fail?: (c: any) => any };
function setup({ seed = {}, env = META_ENV, vault = {}, routes = {}, fail }: Opts = {}) {
  const rpc = {
    cs_secret_get: ({ p_name }: any) => { if (p_name !== 'meta_pages') throw new Error('unknown secret'); return vault.meta_pages ?? null; },
    cs_secret_set: ({ p_name, p_value }: any) => { if (p_name !== 'meta_pages') throw new Error('unknown secret'); if (p_value === null) delete vault.meta_pages; else vault.meta_pages = p_value; return null; },
  };
  const db = fakeDb({ cs_channels: CHANNELS, ...seed }, { rpc, fail });
  const userDb = (jwt: string) => { const m = MEMBERS[jwt]; return fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'cs.view' ? m.view ?? 'N' : key === 'cs.reply' ? m.reply ?? 'N' : 'N'), is_admin: () => m.admin ?? false } : {} }); };
  const g = fakeGraph(routes);
  const deps = { env, db, now: () => NOW, userDb, userId: async (jwt: string) => MEMBERS[jwt]?.uid ?? null, fetch: g.fetch };
  return { deps, db, vault, graph: g };
}
const linked = () => ({ meta_pages: JSON.stringify({ page: PAGE, linked_by: U.admin, linked_at: NOW }) });
async function call(deps: any, body: unknown, jwt: string | null = 'jwt-reply') {
  const res = await handler(new Request('http://x/cs-channel', { method: 'POST', headers: { 'content-type': 'application/json', ...(jwt ? { authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
async function deliver(deps: any, payload: unknown, opts: { secret?: string; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(payload);
  const sig = await signBody(new TextEncoder().encode(raw), opts.secret ?? SECRET);
  const res = await handler(new Request('http://x/cs-channel', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw }), deps);
  return { res, body: await res.json() };
}
const msgEvent = (userId: string, mid: string, text: string, at: number, extra: any = {}) => ({ sender: { id: userId }, recipient: { id: '111' }, timestamp: at, message: { mid, text, ...extra } });
const page = (...messaging: any[]) => ({ object: 'page', entry: [{ id: '111', time: 1762000000000, messaging }] });
const T = 1762000000000;

Deno.test('GET: the verification answers the challenge for the right token only', async () => {
  const { deps } = setup();
  const ok = await handler(new Request('http://x/cs-channel?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234abc'), deps);
  assertEquals([ok.status, await ok.text()], [200, '1234abc']);
  assertEquals((await handler(new Request('http://x/cs-channel?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'), deps)).status, 403);
  assertEquals((await handler(new Request('http://x/cs-channel?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1'), setup({ env: { ...META_ENV, META_VERIFY_TOKEN: '' } }).deps)).status, 403);
  assertEquals((await handler(new Request('http://x/cs-channel', { method: 'PUT' }), deps)).status, 405);
});

Deno.test('webhook: no app secret → 500; a bad signature → 401; both logged without content; an unknown object → 200 ignored', async () => {
  const bare = setup({ env: { ...META_ENV, META_APP_SECRET: '' } });
  assertEquals((await deliver(bare.deps, page())).res.status, 500);
  assertEquals(bare.db.rows('cs_channel_events').map((r: any) => [r.status, r.error]), [['error', 'not_configured']]);
  const { deps, db } = setup();
  const bad = await deliver(deps, page(msgEvent('900', 'm.1', 'hi', T)), { secret: 'other-secret' });
  assertEquals([bad.res.status, bad.body], [401, { error: 'bad_signature' }]);
  assertEquals(db.rows('cs_messages').length, 0);
  const unknown = await deliver(deps, { object: 'user', entry: [] });
  assertEquals([unknown.res.status, unknown.body], [200, { status: 'ignored' }]);
  const junk = await deliver(deps, null, { raw: '{not json' });
  assertEquals(junk.res.status, 200);
  assertEquals(db.rows('cs_channel_events').map((r: any) => [r.status, r.error]), [['error', 'bad_signature'], ['ignored', 'unknown_object'], ['error', 'bad_json']]);
});

Deno.test('webhook: a Messenger message makes the customer (named from the profile), the contact, the conversation and the in message; a redelivery is a duplicate; a second message reopens; echoes, delivery and read receipts', async () => {
  const { deps, db, graph } = setup({ vault: linked(), routes: { 'GET 900': { body: { first_name: 'Noha', last_name: 'Hassan', id: '900' } } } });
  const first = await deliver(deps, page(msgEvent('900', 'm.1', 'الأوردر فين؟', T + 1000, { attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] })));
  assertEquals([first.res.status, first.body], [200, { status: 'ok' }]);
  const cu = db.rows('cs_customers')[0];
  assertEquals([cu.name, cu.created_from, cu.source, cu.created_by, cu.phone], ['Noha Hassan', 'channel', 'ماسنجر', null, null]);
  assertEquals(db.rows('cs_contacts').map((c: any) => [c.customer_id, c.platform, c.external_id]), [[cu.id, 'messenger', '900']]);
  const v = db.rows('cs_conversations')[0];
  assertEquals([v.seg, v.platform, v.channel, v.customer_id, v.external_id, v.status, v.created_by], ['customers', 'messenger', 'messenger', cu.id, '900', 'جديدة', null]);
  const m = db.rows('cs_messages')[0];
  assertEquals([m.conversation_id, m.kind, m.text, m.external_id, m.delivery, m.author, m.created_at], [v.id, 'in', 'الأوردر فين؟', 'm.1', null, null, new Date(T + 1000).toISOString()]);
  assertEquals(m.meta.attachments, [{ type: 'image', url: 'https://cdn/x.jpg', title: null }]);
  assertEquals(graph.calls.map((c) => [c.method, c.path, c.auth]), [['GET', '900', 'Bearer ' + PAGE.token]]);
  assertEquals(db.rows('cs_channel_events').map((r: any) => [r.object, r.entry_id, r.status, r.summary]), [['page', '111', 'ok', { messages: 1 }]]);
  // the same delivery again: nothing new, no second profile call
  await deliver(deps, page(msgEvent('900', 'm.1', 'الأوردر فين؟', T + 1000)));
  assertEquals(db.rows('cs_messages').length, 1); assertEquals(db.rows('cs_customers').length, 1); assertEquals(graph.calls.length, 1);
  assertEquals(db.rows('cs_channel_events')[1].summary, { duplicates: 1 });
  // the team closes it; a new message reopens it «مستنية ردنا»
  await db.from('cs_conversations').update({ status: 'اتحلت' }).eq('id', v.id);
  await deliver(deps, page(msgEvent('900', 'm.2', 'لسه مستنية', T + 5000)));
  assertEquals(db.row('cs_conversations', v.id).status, 'مستنية ردنا'); assertEquals(db.rows('cs_messages').length, 2);
  // an echo of a reply sent from Meta's inbox → an out message without an author; the conversation waits for the customer
  await deliver(deps, page({ sender: { id: '111' }, recipient: { id: '900' }, timestamp: T + 6000, message: { mid: 'm.3', text: 'في الطريق', is_echo: true, app_id: 42 } }));
  const echo = db.rows('cs_messages').find((x: any) => x.external_id === 'm.3');
  assertEquals([echo.kind, echo.author, echo.delivery, echo.meta.echo, echo.text], ['out', null, 'sent', true, 'في الطريق']);
  assertEquals(db.row('cs_conversations', v.id).status, 'مستنية العميل');
  // our own send (the mid already on the row) echoes back: ignored
  await db.from('cs_messages').insert({ conversation_id: v.id, kind: 'out', text: 'تمام', author: U.reply, external_id: 'm.4', delivery: 'sent', created_at: new Date(T + 7000).toISOString() });
  const own = await deliver(deps, page({ sender: { id: '111' }, recipient: { id: '900' }, timestamp: T + 7000, message: { mid: 'm.4', text: 'تمام', is_echo: true } }));
  assertEquals(own.body, { status: 'ok' }); assertEquals(db.rows('cs_messages').length, 4);
  assertEquals(db.rows('cs_channel_events').at(-1).summary, { ignored: 1 });
  // our own send whose echo comes before the Send API's answer is written: the member's queued row takes the mid, no duplicate
  await db.from('cs_messages').insert({ id: 'd1000000-0000-4000-8000-0000000000aa', conversation_id: v.id, kind: 'out', text: 'هنبعته بكرة', author: U.reply, external_id: null, delivery: 'queued', created_at: new Date(T + 7100).toISOString() });
  await deliver(deps, page({ sender: { id: '111' }, recipient: { id: '900' }, timestamp: T + 7200, message: { mid: 'm.5', text: 'هنبعته بكرة', is_echo: true } }));
  assertEquals(db.rows('cs_messages').length, 5);
  assertEquals([db.row('cs_messages', 'd1000000-0000-4000-8000-0000000000aa').external_id, db.row('cs_messages', 'd1000000-0000-4000-8000-0000000000aa').delivery], ['m.5', 'sent']);
  await db.from('cs_messages').update({ delivery: 'read' }).eq('id', 'd1000000-0000-4000-8000-0000000000aa'); // out of the way of the receipts below
  // delivery up to a watermark, then read
  await deliver(deps, page({ sender: { id: '900' }, recipient: { id: '111' }, timestamp: T + 8000, delivery: { mids: ['m.3'], watermark: T + 6500 } }));
  assertEquals(db.rows('cs_messages').filter((x: any) => x.kind === 'out').map((x: any) => [x.external_id, x.delivery]), [['m.3', 'delivered'], ['m.4', 'sent'], ['m.5', 'read']]);
  await deliver(deps, page({ sender: { id: '900' }, recipient: { id: '111' }, timestamp: T + 9000, read: { watermark: T + 8000 } }));
  assertEquals(db.rows('cs_messages').filter((x: any) => x.kind === 'out').map((x: any) => [x.external_id, x.delivery]), [['m.3', 'read'], ['m.4', 'read'], ['m.5', 'read']]);
  // a receipt of an unknown thread, a postback: ignored
  const other = await deliver(deps, page({ sender: { id: '901' }, recipient: { id: '111' }, read: { watermark: T } }, { sender: { id: '900' }, recipient: { id: '111' }, postback: { payload: 'x' } }));
  assertEquals(other.body, { status: 'ok' }); assertEquals(db.rows('cs_channel_events').at(-1).status, 'ignored');
});

Deno.test('webhook: no page linked → the customer gets the default name (no profile call); an Instagram DM lands on the instagram channel with the handle', async () => {
  const { deps, db, graph } = setup({ routes: { 'GET 55': { body: { name: 'Noha', username: 'noha_h' } } } });
  await deliver(deps, page(msgEvent('900', 'm.1', 'hi', T)));
  assertEquals(db.rows('cs_customers')[0].name, 'عميل ماسنجر'); assertEquals(graph.calls.length, 0);
  const ig = setup({ vault: linked(), routes: { 'GET 55': { body: { name: 'Noha', username: 'noha_h' } } } });
  await deliver(ig.deps, { object: 'instagram', entry: [{ id: '777', time: 1762000000, messaging: [{ sender: { id: '55' }, recipient: { id: '777' }, timestamp: 1762000001, message: { mid: 'ig.1', text: 'بكام؟' } }] }] });
  const cu = ig.db.rows('cs_customers')[0]; const v = ig.db.rows('cs_conversations')[0];
  assertEquals([cu.name, cu.ig, cu.source], ['Noha', '@noha_h', 'إنستجرام']);
  assertEquals([v.platform, v.channel, v.external_id, v.handle], ['instagram', 'instagram', '55', '@noha_h']);
  assertEquals(ig.db.rows('cs_messages')[0].created_at, '2025-11-01T12:26:41.000Z'); // seconds → ms
});

Deno.test('webhook: Facebook feed comments → a comments conversation per post × commenter; the page\'s own reply is an echo on that thread; an edit updates the text; a removal is ignored; Instagram comments on the instagram channel', async () => {
  const { deps, db } = setup({ vault: linked() });
  const feed = (value: any) => ({ object: 'page', entry: [{ id: '111', time: 1762000000, changes: [{ field: 'feed', value }] }] });
  await deliver(deps, feed({ item: 'comment', verb: 'add', comment_id: '111_c1', post_id: '111_p1', parent_id: '111_p1', from: { id: '42', name: 'Noha H' }, message: 'السعر؟', created_time: 1762000005 }));
  const v = db.rows('cs_conversations')[0];
  assertEquals([v.seg, v.platform, v.channel, v.external_id, v.handle, v.customer_id, v.status], ['comments', 'facebook', 'messenger', '111_p1:42', 'Noha H', null, 'جديدة']);
  const m = db.rows('cs_messages')[0];
  assertEquals([m.kind, m.text, m.external_id, m.meta.post_id, m.meta.from_id], ['in', 'السعر؟', '111_c1', '111_p1', '42']);
  assertEquals(db.rows('cs_customers').length, 0, 'a commenter is not a customer until a DM');
  await deliver(deps, feed({ item: 'comment', verb: 'add', comment_id: '111_c2', post_id: '111_p1', parent_id: '111_c1', from: { id: '111', name: 'Ibtekr Club' }, message: 'اتفضلي ع الخاص', created_time: 1762000006 }));
  const echo = db.rows('cs_messages')[1];
  assertEquals([echo.conversation_id, echo.kind, echo.author, echo.delivery, echo.meta.echo, echo.external_id], [v.id, 'out', null, 'sent', true, '111_c2']);
  assertEquals(db.rows('cs_conversations').length, 1);
  await deliver(deps, feed({ item: 'comment', verb: 'edited', comment_id: '111_c1', post_id: '111_p1', from: { id: '42', name: 'Noha H' }, message: 'السعر كام؟' }));
  assertEquals(db.rows('cs_messages')[0].text, 'السعر كام؟');
  await deliver(deps, feed({ item: 'comment', verb: 'remove', comment_id: '111_c1', post_id: '111_p1', from: { id: '42' } }));
  assertEquals(db.rows('cs_messages').length, 2);
  // a second comment of the same person on the same post joins the thread; another person opens a new one
  await deliver(deps, feed({ item: 'comment', verb: 'add', comment_id: '111_c3', post_id: '111_p1', parent_id: '111_p1', from: { id: '42', name: 'Noha H' }, message: 'طيب', created_time: 1762000007 }));
  await deliver(deps, feed({ item: 'comment', verb: 'add', comment_id: '111_c4', post_id: '111_p1', parent_id: '111_p1', from: { id: '43', name: 'Ali' }, message: 'عايز واحد', created_time: 1762000008 }));
  assertEquals(db.rows('cs_conversations').map((x: any) => [x.external_id, x.status]), [['111_p1:42', 'مستنية ردنا'], ['111_p1:43', 'جديدة']]);
  // an Instagram comment
  await deliver(deps, { object: 'instagram', entry: [{ id: '777', time: 1762000000, changes: [{ field: 'comments', value: { id: 'c9', text: 'بكام؟', from: { id: '55', username: 'noha_h' }, media: { id: 'med1' } } }] }] });
  const igc = db.rows('cs_conversations').at(-1);
  assertEquals([igc.seg, igc.platform, igc.channel, igc.external_id, igc.handle], ['comments', 'instagram', 'instagram', 'med1:55', '@noha_h']);
  assertEquals(db.rows('cs_channel_events').map((r: any) => r.summary), [{ comments: 1 }, { echoes: 1 }, { edits: 1 }, { ignored: 1 }, { comments: 1 }, { comments: 1 }, { comments: 1 }]);
});

Deno.test('webhook: a database failure answers 500 (Meta retries) and logs an error row with a code only', async () => {
  const { deps, db } = setup({ fail: (c: any) => (c.table === 'cs_messages' && c.op === 'insert' ? { code: '57P01', message: 'down', details: 'the row with the text' } : null) });
  const r = await deliver(deps, page(msgEvent('900', 'm.1', 'سري', T)));
  assertEquals(r.res.status, 500);
  const ev = db.rows('cs_channel_events')[0];
  assertEquals([ev.status, ev.error, ev.summary], ['error', 'cs_messages: 57P01', { errors: 1 }]);
  assertFalse(JSON.stringify(db.rows('cs_channel_events')).includes('سري'));
});

Deno.test('auth: a member JWT only; status for cs.view ≠ N (the admin sees the configuration); connect / disconnect the admin; send cs.reply = F', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { action: 'status' }, null)).res.status, 401);
  assertEquals((await call(deps, { action: 'status' }, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, { action: 'nope' })).body, { error: 'unknown_action' });
  const view = await call(deps, { action: 'status' }, 'jwt-view');
  assertEquals(view.body, { result: 'ok', linked: false, channels: [{ id: 'messenger', name: 'ماسنجر', status: 'disconnected', number: null, since: null, last_message_at: null }, { id: 'instagram', name: 'إنستجرام', status: 'disconnected', number: null, since: null, last_message_at: null }] });
  const admin = await call(deps, { action: 'status' }, 'jwt-admin');
  assertEquals([admin.body.configured, admin.body.verify_configured, admin.body.redirect, admin.body.webhook_url, admin.body.page], [true, true, 'https://operation-system.ibtekr.club/meta-callback.html', 'https://proj.supabase.test/functions/v1/cs-channel', null]);
  for (const action of ['connect_start', 'connect_callback', 'connect_pick', 'disconnect']) assertEquals((await call(deps, { action }, 'jwt-reply')).res.status, 401, action);
  for (const action of ['send', 'comment_private', 'comment_hide']) assertEquals((await call(deps, { action }, 'jwt-view')).res.status, 401, action);
  const bare = setup({ env: { ...META_ENV, META_APP_ID: '' } });
  assertEquals((await call(bare.deps, { action: 'connect_start' }, 'jwt-admin')).body, { error: 'not_configured', configured: false });
  assertEquals((await call(bare.deps, { action: 'status' }, 'jwt-admin')).body.configured, false);
});

Deno.test('connect: the dialog url with a state kept ten minutes; the callback exchanges the code (short → long-lived → pages); one page links at once: subscribed, in Vault, both channels connected, logged', async () => {
  const routes: Record<string, Route> = {
    'GET oauth/access_token': (c) => ({ body: { access_token: c.query.grant_type === 'fb_exchange_token' ? 'LONG-' + 'x'.repeat(30) : 'SHORT-' + 'y'.repeat(30), token_type: 'bearer' } }),
    'GET me/accounts': { body: { data: [{ id: '111', name: 'Ibtekr Club', access_token: PAGE.token, instagram_business_account: { id: '777', username: 'ibtekr.club' } }] } },
    'POST 111/subscribed_apps': { body: { success: true } },
  };
  const { deps, db, vault, graph } = setup({ routes });
  const start = await call(deps, { action: 'connect_start', channel: 'instagram' }, 'jwt-admin');
  assertEquals(start.res.status, 200);
  const st = db.rows('cs_oauth_states')[0];
  assertEquals([st.channel, st.created_by, st.used_at], ['instagram', U.admin, null]); assert(/^[A-Za-z0-9_-]{32,128}$/.test(st.state));
  const u = new URL(start.body.url);
  assertEquals([u.host, u.searchParams.get('client_id'), u.searchParams.get('state'), u.searchParams.get('redirect_uri')], ['www.facebook.com', '1234567890', st.state, 'https://operation-system.ibtekr.club/meta-callback.html']);
  assertEquals((await call(deps, { action: 'connect_start', channel: 'tiktok' }, 'jwt-admin')).body, { error: 'bad_request', field: 'channel' });
  // the callback: a wrong state, a bad code, then the right pair (spent), then the same pair again
  assertEquals((await call(deps, { action: 'connect_callback', code: 'code-12345678', state: 'x'.repeat(40) }, 'jwt-admin')).body, { error: 'bad_request', field: 'state' });
  assertEquals((await call(deps, { action: 'connect_callback', code: 'bad code', state: st.state }, 'jwt-admin')).body, { error: 'bad_request', field: 'code' });
  const cb = await call(deps, { action: 'connect_callback', code: 'AQD-code-12345678', state: st.state }, 'jwt-admin');
  assertEquals(cb.res.status, 200, JSON.stringify(cb.body));
  assertEquals([cb.body.result, cb.body.linked, cb.body.instagram, cb.body.page], ['ok', true, true, { id: '111', name: 'Ibtekr Club', ig: { id: '777', username: 'ibtekr.club' } }]);
  assertEquals(cb.body.channels.map((c: any) => [c.id, c.status, c.number, c.since]), [['messenger', 'connected', 'Ibtekr Club', NOW], ['instagram', 'connected', '@ibtekr.club', NOW]]);
  assertEquals(graph.calls.map((c) => [c.method, c.path]), [['GET', 'oauth/access_token'], ['GET', 'oauth/access_token'], ['GET', 'me/accounts'], ['POST', '111/subscribed_apps']]);
  assertEquals(graph.calls[0].query.client_secret, SECRET); assertEquals(graph.calls[0].query.code, 'AQD-code-12345678');
  assertEquals(graph.calls[1].query.fb_exchange_token, 'SHORT-' + 'y'.repeat(30)); assertEquals(graph.calls[2].auth, 'Bearer LONG-' + 'x'.repeat(30));
  assertEquals([graph.calls[3].auth, graph.calls[3].body], ['Bearer ' + PAGE.token, { subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads,message_echoes,feed' }]);
  const kept = JSON.parse(vault.meta_pages!);
  assertEquals([kept.page.id, kept.page.token, kept.page.ig.username, kept.linked_by], ['111', PAGE.token, 'ibtekr.club', U.admin]);
  const ch = db.row('cs_channels', 'messenger');
  assertEquals(ch.meta, { page_id: '111', page_name: 'Ibtekr Club', ig_id: '777', ig_username: 'ibtekr.club', fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'message_echoes', 'feed'] });
  assertFalse(JSON.stringify(db.rows('cs_channels')).includes(PAGE.token), 'no token outside Vault');
  assertEquals(db.rows('activity_log').map((r: any) => [r.actor, r.action, r.entity_id, r.new_value]), [[U.admin, 'cs.channel.connect', 'messenger', 'Ibtekr Club + instagram']]);
  assertEquals(db.row('cs_oauth_states', st.state, 'state').used_at, NOW);
  assertEquals((await call(deps, { action: 'connect_callback', code: 'AQD-code-12345678', state: st.state }, 'jwt-admin')).body, { error: 'bad_request', field: 'state' });
  const status = await call(deps, { action: 'status' }, 'jwt-admin');
  assertEquals([status.body.linked, status.body.page.name], [true, 'Ibtekr Club']);
  // disconnect: the subscription removed, the secret gone, both channels back
  const off = await call(deps, { action: 'disconnect' }, 'jwt-admin');
  assertEquals([off.body.linked, off.body.channels.map((c: any) => c.status)], [false, ['disconnected', 'disconnected']]);
  assertEquals(graph.calls.at(-1)!.method + ' ' + graph.calls.at(-1)!.path, 'DELETE 111/subscribed_apps');
  assertEquals(vault.meta_pages, undefined); assertEquals(db.row('cs_channels', 'messenger').meta, {}); assertEquals(db.row('cs_channels', 'instagram').number, null);
});

Deno.test('connect: several pages → choose (no tokens in the answer), then connect_pick links the chosen one; a page without an Instagram account leaves instagram disconnected; a refused subscription keeps nothing', async () => {
  const two = { data: [{ id: '111', name: 'Ibtekr Club', access_token: PAGE.token }, { id: '222', name: 'Side page', access_token: 'EAAC'.repeat(12) }] };
  const routes: Record<string, Route> = { 'GET oauth/access_token': { body: { access_token: 'tok-' + 'z'.repeat(30) } }, 'GET me/accounts': { body: two }, 'POST 111/subscribed_apps': { body: { success: true } }, 'POST 222/subscribed_apps': { status: 400, body: { error: { code: 200, message: 'no permission' } } } };
  const { deps, db, vault } = setup({ routes });
  const st = (await call(deps, { action: 'connect_start' }, 'jwt-admin'), db.rows('cs_oauth_states')[0].state);
  const cb = await call(deps, { action: 'connect_callback', code: 'AQD-code-12345678', state: st }, 'jwt-admin');
  assertEquals(cb.body, { result: 'choose', pages: [{ id: '111', name: 'Ibtekr Club', ig: null }, { id: '222', name: 'Side page', ig: null }] });
  assertEquals(JSON.parse(vault.meta_pages!).candidates.length, 2); assertEquals(db.row('cs_channels', 'messenger').status, 'disconnected');
  assertEquals((await call(deps, { action: 'connect_pick', page_id: '333' }, 'jwt-admin')).body, { error: 'not_found' });
  const refused = await call(deps, { action: 'connect_pick', page_id: '222' }, 'jwt-admin');
  assertEquals([refused.res.status, refused.body.error], [502, 'graph_200']); assertEquals(db.row('cs_channels', 'messenger').status, 'disconnected');
  const pick = await call(deps, { action: 'connect_pick', page_id: '111' }, 'jwt-admin');
  assertEquals([pick.body.result, pick.body.instagram, pick.body.channels.map((c: any) => c.status)], ['ok', false, ['connected', 'disconnected']]);
  assertEquals(JSON.parse(vault.meta_pages!).page.id, '111'); assertEquals(JSON.parse(vault.meta_pages!).candidates, undefined);
  assertEquals(db.row('cs_channels', 'instagram').meta.note, 'no_instagram_account');
  const none = setup({ routes: { ...routes, 'GET me/accounts': { body: { data: [] } } } });
  const st2 = (await call(none.deps, { action: 'connect_start' }, 'jwt-admin'), none.db.rows('cs_oauth_states')[0].state);
  assertEquals((await call(none.deps, { action: 'connect_callback', code: 'AQD-code-12345678', state: st2 }, 'jwt-admin')).body, { error: 'no_pages' });
});

const V = 'd1000000-0000-4000-8000-000000000001'; const VC = 'd1000000-0000-4000-8000-000000000002'; const M1 = 'd1000000-0000-4000-8000-000000000011'; const M2 = 'd1000000-0000-4000-8000-000000000012';
const CONV_SEED = {
  cs_conversations: [{ id: V, seg: 'customers', platform: 'messenger', channel: 'messenger', external_id: '900', status: 'مستنية ردنا' }, { id: VC, seg: 'comments', platform: 'facebook', channel: 'messenger', external_id: '111_p1:42', handle: 'Noha H', status: 'جديدة' }],
  cs_messages: [
    { id: 'd1000000-0000-4000-8000-000000000010', conversation_id: V, kind: 'in', text: 'فين؟', external_id: 'm.1', created_at: '2026-10-25T11:00:00.000Z' },
    { id: M1, conversation_id: V, kind: 'out', text: 'في الطريق', author: U.reply, delivery: 'queued', created_at: '2026-10-25T11:30:00.000Z' },
    { id: 'd1000000-0000-4000-8000-000000000020', conversation_id: VC, kind: 'in', text: 'السعر؟', external_id: '111_c1', meta: { post_id: '111_p1' }, created_at: '2026-10-25T11:00:00.000Z' },
    { id: 'd1000000-0000-4000-8000-000000000021', conversation_id: VC, kind: 'in', text: 'طيب؟', external_id: '111_c3', meta: { post_id: '111_p1' }, created_at: '2026-10-25T11:10:00.000Z' },
    { id: M2, conversation_id: VC, kind: 'out', text: 'اتفضلي ع الخاص', author: U.reply, delivery: 'queued', created_at: '2026-10-25T11:30:00.000Z' },
  ],
};

Deno.test('send: the queued DM goes through the Send API (RESPONSE, the page token) → sent + Meta\'s id; a refusal → failed + a code, 502; not queued → 409; not linked → 503; another member\'s message → 401', async () => {
  const { deps, db, graph } = setup({ seed: CONV_SEED, vault: linked(), routes: { 'POST me/messages': (c) => (c.body.message.text === 'في الطريق' ? { body: { recipient_id: '900', message_id: 'm_sent1' } } : { status: 400, body: { error: { code: 10, error_subcode: 2018278 } } }) } });
  assertEquals((await call(deps, { action: 'send', message_id: 'nope' })).body, { error: 'bad_request', field: 'message_id' });
  assertEquals((await call(deps, { action: 'send', message_id: 'd1000000-0000-4000-8000-000000000099' })).res.status, 404);
  assertEquals((await call(deps, { action: 'send', message_id: 'd1000000-0000-4000-8000-000000000010' })).body, { error: 'not_queued', delivery: null });
  const r = await call(deps, { action: 'send', message_id: M1 });
  assertEquals(r.body, { result: 'ok', delivery: 'sent', external_id: 'm_sent1' });
  assertEquals(graph.calls.map((c) => [c.method, c.path, c.auth, c.body]), [['POST', 'me/messages', 'Bearer ' + PAGE.token, { recipient: { id: '900' }, messaging_type: 'RESPONSE', message: { text: 'في الطريق' } }]]);
  assertEquals([db.row('cs_messages', M1).delivery, db.row('cs_messages', M1).external_id], ['sent', 'm_sent1']);
  assertEquals(db.rows('activity_log').map((x: any) => [x.action, x.entity_id, x.new_value]), [['cs.channel.send', V, 'messenger']]);
  assertEquals((await call(deps, { action: 'send', message_id: M1 })).body, { error: 'not_queued', delivery: 'sent' });
  // a refused one (outside the 24-hour window): failed with the code only
  await db.from('cs_messages').insert({ id: 'd1000000-0000-4000-8000-000000000013', conversation_id: V, kind: 'out', text: 'متأخر', author: U.reply, delivery: 'queued', created_at: NOW });
  const bad = await call(deps, { action: 'send', message_id: 'd1000000-0000-4000-8000-000000000013' });
  assertEquals([bad.res.status, bad.body], [502, { error: 'graph_10:2018278', status: 400, delivery: 'failed' }]);
  assertEquals([db.row('cs_messages', 'd1000000-0000-4000-8000-000000000013').delivery, db.row('cs_messages', 'd1000000-0000-4000-8000-000000000013').meta.error], ['failed', 'graph_10:2018278']);
  // another member's queued message: the admin may, a colleague may not
  await db.from('cs_messages').insert({ id: 'd1000000-0000-4000-8000-000000000014', conversation_id: V, kind: 'out', text: 'في الطريق', author: U.admin, delivery: 'queued', created_at: NOW });
  assertEquals((await call(deps, { action: 'send', message_id: 'd1000000-0000-4000-8000-000000000014' }, 'jwt-reply')).res.status, 401);
  assertEquals((await call(deps, { action: 'send', message_id: 'd1000000-0000-4000-8000-000000000014' }, 'jwt-admin')).body.delivery, 'sent'); // Meta's id taken already (the fake answers the same one): the delivery alone
  assertEquals([db.row('cs_messages', 'd1000000-0000-4000-8000-000000000014').delivery, db.row('cs_messages', 'd1000000-0000-4000-8000-000000000014').external_id], ['sent', null]);
  const unlinked = setup({ seed: CONV_SEED });
  assertEquals((await call(unlinked.deps, { action: 'send', message_id: M1 })).body, { error: 'not_linked' });
  assertEquals(unlinked.db.row('cs_messages', M1).delivery, 'queued');
});

Deno.test('comments: send = a public reply on the last incoming comment; comment_private = a private reply through the Send API; comment_hide hides it and leaves an event', async () => {
  const routes: Record<string, Route> = { 'POST 111_c3/comments': { body: { id: '111_c3_r1' } }, 'POST me/messages': { body: { recipient_id: '900', message_id: 'pm_1' } }, 'POST 111_c3': { body: { success: true } } };
  const { deps, db, graph } = setup({ seed: CONV_SEED, vault: linked(), routes });
  const pub = await call(deps, { action: 'send', message_id: M2 });
  assertEquals(pub.body, { result: 'ok', delivery: 'sent', external_id: '111_c3_r1', private: false });
  assertEquals(graph.calls[0].body, { message: 'اتفضلي ع الخاص' }); assertEquals(db.row('cs_messages', M2).meta.reply_to_comment, '111_c3');
  await db.from('cs_messages').insert({ id: 'd1000000-0000-4000-8000-000000000022', conversation_id: VC, kind: 'out', text: 'بعتنالك الكتالوج', author: U.reply, delivery: 'queued', meta: { private: true }, created_at: NOW });
  const priv = await call(deps, { action: 'comment_private', message_id: 'd1000000-0000-4000-8000-000000000022' });
  assertEquals(priv.body, { result: 'ok', delivery: 'sent', external_id: 'pm_1', private: true });
  assertEquals(graph.calls[1].body, { recipient: { comment_id: '111_c3' }, message: { text: 'بعتنالك الكتالوج' } });
  assertEquals((await call(deps, { action: 'comment_private', message_id: M1 })).body, { error: 'bad_request', field: 'conversation' });
  const hide = await call(deps, { action: 'comment_hide', conversation_id: VC });
  assertEquals(hide.body, { result: 'ok', hidden: '111_c3' });
  assertEquals([graph.calls[2].path, graph.calls[2].body], ['111_c3', { is_hidden: true }]);
  const ev = db.rows('cs_messages').at(-1);
  assertEquals([ev.conversation_id, ev.kind, ev.author, ev.meta], [VC, 'event', U.reply, { hidden: '111_c3' }]);
  assertEquals((await call(deps, { action: 'comment_hide', conversation_id: V })).body, { error: 'bad_request', field: 'conversation' });
  assertEquals(db.rows('activity_log').map((x: any) => x.action), ['cs.channel.send', 'cs.channel.private', 'cs.channel.hide']);
});
