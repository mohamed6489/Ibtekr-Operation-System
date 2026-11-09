// deno-lint-ignore-file no-explicit-any
// cs-auto handler tests (phase 6.5): the cron with the sync secret only (or the admin by hand, a member's status); live off records
// skipped/off and sends nothing; live on → an order's status change fires its rule once: a cs_messages `auto` row sent through the
// WhatsApp Cloud API as text inside the 24-hour window and as the approved template outside it, the run log, the rule's counter,
// the memory; the daily cap holds; the inbound first-message rule answers at once; the silent follow-up opens a ticket as the server.
// No network.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { onInbound } from '../_shared/cs-auto-run.ts';
import { fakeDb } from '../_test/fakes.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000a1'; const CS = '00000000-0000-4000-8000-0000000000a2';
const CUST = '00000000-0000-4000-8000-0000000000c1'; const CONV = '00000000-0000-4000-8000-0000000000d1';
const TPL = '00000000-0000-4000-8000-0000000000e1'; const RULE = '00000000-0000-4000-8000-0000000000f1';
// Sunday 8 Nov 2026, 10:00 Cairo (08:00Z)
const NOW = '2026-11-08T08:00:00.000Z';
const SEED = (o: { live?: boolean; lastIn?: string | null; tick?: string | null } = {}): any => ({
  settings: [{ section: 'cs', data: { auto: { live: o.live !== false, daily: { wa1: 250, wa2: 150 } } } }],
  status_map: [{ id: 1, system_status: 'جاري التنفيذ', woo_status: 'processing' }, { id: 2, system_status: 'جاهز للشحن', woo_status: 'ready' }],
  profiles: [{ id: ADMIN, name: 'أدمن', email: 'admin@x.test', phone: '01000000001', role_id: 'admin', status: 'active' }, { id: CS, name: 'سارة', email: 'cs@x.test', phone: '01000000002', role_id: 'cs', status: 'active' }],
  cs_customers: [{ id: CUST, phone: '01012345678', name: 'نهى عبد الرحمن', consent: true, auto_consent: true, created_from: 'orders' }],
  cs_conversations: [{ id: CONV, seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: CUST, external_id: '01012345678', status: 'اتحلت', last_in_at: o.lastIn === undefined ? '2026-11-08T07:00:00.000Z' : o.lastIn }],
  cs_templates: [{ id: TPL, lib: 'customers', name: 'تأكيد الأوردر', body: 'أهلاً {اسم_العميل} 👋 أوردرك {رقم_الأوردر} اتأكد بإجمالي {الإجمالي}.', wa_template: 'order_confirmed_v1', wa_vars: ['اسم_العميل', 'رقم_الأوردر', 'الإجمالي'], active: true }],
  cs_auto_rules: [{ id: RULE, name: 'تأكيد الأوردر', event: 'status', event_to: 'قيد التنفيذ', conds: [['القناة', '=', 'واتساب 1']], action: 'send', template_id: TPL, delay_min: 0, once: true, ticket_if_silent: true, enabled: true, runs: 0 }],
  orders: [{ id: 177702, number: '177702', customer_name: 'نهى عبد الرحمن', customer_phone: '01012345678', status: 'جاري التنفيذ', payment_method: 'cod', total: 1050, placed_at: '2026-11-08T07:40:00Z', updated_at: '2026-11-08T07:50:00Z' },
    { id: 177703, number: '177703', customer_name: 'هدى', customer_phone: '01099999999', status: 'جاهز للشحن', payment_method: 'cod', total: 300, placed_at: '2026-11-07T07:40:00Z', updated_at: '2026-11-08T07:50:00Z' }],
  ...(o.tick ? { sync_state: [{ key: 'cs-auto', value: { at: o.tick } }] } : {}),
});
function setup(o: { seed?: any; now?: string; wa?: boolean; graphStatus?: number } = {}) {
  const graph: any[] = [];
  const db = fakeDb(o.seed ?? SEED(), { rpc: {
    sync_secret_matches: ({ candidate }: any) => candidate === 'sync-secret-ok',
    cs_secret_get: ({ p_name }: any) => (o.wa !== false && p_name === 'meta_wa' ? JSON.stringify({ token: 'wa-token-1', waba_id: '1', phone_id: '555' }) : null),
  } });
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null; const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    if (url.startsWith('https://graph.facebook.com/')) { graph.push({ url, headers, body }); return new Response(o.graphStatus && o.graphStatus !== 200 ? '{"error":{"code":131047}}' : '{"messages":[{"id":"wamid.1"}]}', { status: o.graphStatus ?? 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 404 });
  };
  const userDb = (jwt: string) => fakeDb({}, { rpc: { is_admin: () => jwt === 'jwt-admin', has_perm: ({ key }: any) => (jwt === 'jwt-cs' && key === 'cs.view' ? 'F' : 'N') } });
  const deps = { env: { SUPABASE_URL: 'https://x', WOO_URL: 'https://staging.ibtekr.club' }, db, now: () => o.now ?? NOW, fetch: fetchFn as unknown as typeof fetch, userDb, userId: async (jwt: string) => (jwt === 'jwt-admin' ? ADMIN : jwt === 'jwt-cs' ? CS : null), sleep: async () => {}, rand: () => 0 };
  return { db, deps, graph };
}
async function cron(deps: any, secret = 'sync-secret-ok', body: any = { action: 'tick' }) {
  const res = await handler(new Request('http://x/cs-auto', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': secret }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
async function call(deps: any, body: any, jwt = 'jwt-admin') {
  const res = await handler(new Request('http://x/cs-auto', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}

Deno.test('auth: the cron needs the sync secret and the tick action; a member reads status with cs.view; the tick by hand is the admin\'s', async () => {
  const { deps } = setup();
  assertEquals((await cron(deps, 'wrong')).res.status, 401); assertEquals((await cron(deps, 'sync-secret-ok', { action: 'status' })).res.status, 401);
  assertEquals((await call(deps, { action: 'tick' }, 'jwt-cs')).res.status, 401); assertEquals((await call(deps, { action: 'status' }, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, { action: 'drop' })).res.status, 400);
  const st = await call(deps, { action: 'status' }, 'jwt-cs'); assertEquals(st.res.status, 200);
  assertEquals([st.body.live, st.body.rules, st.body.channels, st.body.last], [true, { total: 1, enabled: 1 }, { wa1: true, page: false }, null]);
});

Deno.test('live off: the fired rule is recorded skipped/off, nothing is sent, nothing written to the chat', async () => {
  const { db, deps, graph } = setup({ seed: SEED({ live: false }) });
  const { res, body } = await cron(deps);
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals([body.live, body.events, body.skipped, body.sent], [false, 1, 1, 0]);
  assertEquals(db.rows('cs_auto_runs').map((r: any) => [r.entity, r.result, r.code]), [['order:177702', 'skipped', 'off']]);
  assertEquals(graph.length, 0); assertEquals(db.rows('cs_messages').length, 0);
  // once a rule has a live row on the entity, a later tick does not fire it again, live or not
  const again = await cron(deps); assertEquals([again.body.events, again.body.skipped], [0, 0]);
});

Deno.test('live on, inside the window: the status rule sends the template text through WhatsApp 1 as free text; the run log, the counter, the memory; once', async () => {
  const { db, deps, graph } = setup();
  const { res, body } = await cron(deps);
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals([body.events, body.sent, body.skipped, body.held, body.failed], [1, 1, 0, 0, 0], JSON.stringify(body));
  assertEquals(graph.length, 1); assertEquals(graph[0].url, 'https://graph.facebook.com/v25.0/555/messages'); assertEquals(graph[0].headers.authorization, 'Bearer wa-token-1');
  assertEquals(graph[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '201012345678', type: 'text', text: { preview_url: false, body: 'أهلاً نهى 👋 أوردرك 177702 اتأكد بإجمالي 1,050 ج.م.' } });
  const M = db.rows('cs_messages'); assertEquals(M.length, 1);
  assertEquals([M[0].conversation_id, M[0].kind, M[0].author, M[0].delivery, M[0].external_id, M[0].meta.tpl, M[0].meta.mode, M[0].meta.rule_id], [CONV, 'auto', null, 'sent', 'wamid.1', 'تأكيد الأوردر', 'text', RULE]);
  const R = db.rows('cs_auto_runs'); assertEquals(R.map((r: any) => [r.rule_id, r.entity, r.result, r.code, r.customer_id, r.conversation_id, r.message_id]), [[RULE, 'order:177702', 'sent', 'wa1:text', CUST, CONV, M[0].id]]);
  assertEquals([db.row('cs_auto_rules', RULE).runs, db.row('cs_auto_rules', RULE).last_run_at], [1, NOW]);
  assertEquals(db.row('sync_state', 'cs-auto', 'key').value.at, NOW);
  assertEquals(db.row('cs_conversations', CONV).last_out_at, NOW);
  // the next tick: the order did not change again, the row is live → nothing
  const again = await cron(deps); assertEquals([again.body.events, again.body.sent], [0, 0]); assertEquals(graph.length, 1);
});

Deno.test('phase 12 T7 — the visitor\'s cart (cs_carts): a cart rule sends the template with the cart\'s name, total and recovery link + the opt-out line to a known number; a cart whose number ordered after, a completed one, one without a phone and one too young are left; once', async () => {
  const CART_TPL = '00000000-0000-4000-8000-0000000000e2'; const CART_RULE = '00000000-0000-4000-8000-0000000000f2';
  const seed = SEED();
  seed.cs_templates.push({ id: CART_TPL, lib: 'customers', name: 'سلة متروكة', body: '{اسم_العميل}، سلتك بـ {الإجمالي} مستنياك: {رابط_السلة}', active: true });
  seed.cs_auto_rules = [{ id: CART_RULE, name: 'سلة متروكة', event: 'cart', conds: [], action: 'send', template_id: CART_TPL, delay_min: 0, once: true, ticket_if_silent: false, enabled: true, runs: 0 }];
  seed.orders = [{ id: 177703, number: '177703', customer_name: 'هدى', customer_phone: '01099999999', status: 'جاري التنفيذ', payment_method: 'cod', total: 300, placed_at: '2026-11-08T07:40:00Z', updated_at: '2026-11-08T07:50:00Z' }];
  seed.cs_carts = [
    { cart_id: 7, phone: '+201012345678', name: 'نهى عبد الرحمن', total: 1250, items: 2, status: 'normal', url: 'https://staging.ibtekr.club/checkout/?wcf_ac_token=a', site_updated_at: '2026-11-08T06:00:00Z' },
    { cart_id: 8, phone: '01099999999', name: 'هدى', total: 300, items: 1, status: 'normal', site_updated_at: '2026-11-08T06:00:00Z' }, // ordered at 07:40 → not abandoned
    { cart_id: 9, phone: '01055555555', name: 'x', total: 50, items: 1, status: 'normal', site_updated_at: '2026-11-08T07:45:00Z' }, // 15 min
    { cart_id: 10, phone: '', email: 'g@x.test', name: 'g', total: 90, items: 1, status: 'normal', site_updated_at: '2026-11-08T06:00:00Z' },
    { cart_id: 11, phone: '01044444444', name: 'c', total: 90, items: 1, status: 'completed', site_updated_at: '2026-11-08T06:00:00Z' },
    { cart_id: 6, phone: '01012345678', name: 'نهى', total: 400, items: 1, status: 'normal', site_updated_at: '2026-11-08T05:00:00Z' }, // the same number's older cart
  ];
  const { db, deps, graph } = setup({ seed });
  const { res, body } = await cron(deps);
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals([body.events, body.sent, body.skipped, body.by], [1, 1, 0, { cart: 1 }], JSON.stringify(body));
  assertEquals(graph.length, 1); assertEquals(graph[0].body.to, '201012345678');
  assertEquals(graph[0].body.text.body, 'نهى، سلتك بـ 1,250 ج.م مستنياك: https://staging.ibtekr.club/checkout/?wcf_ac_token=a\n\nاكتب «إيقاف» لو مش عايز رسايل عروض.');
  const R = db.rows('cs_auto_runs'); assertEquals(R.map((r: any) => [r.rule_id, r.entity, r.result, r.customer_id, r.conversation_id]), [[CART_RULE, 'cart:c7', 'sent', CUST, CONV]]);
  const again = await cron(deps); assertEquals([again.body.events, again.body.sent], [0, 0]); assertEquals(graph.length, 1);
  // a new cart from the same number two days later: one guest-cart message a number a week → skipped «recent», no send
  await db.from('cs_carts').insert({ cart_id: 20, phone: '01012345678', name: 'نهى', total: 999, items: 3, status: 'normal', unsubscribed: false, url: '', site_updated_at: '2026-11-10T06:00:00Z', first_seen_at: NOW, synced_at: NOW });
  const later = await cron({ ...deps, now: () => '2026-11-10T08:00:00.000Z' });
  assertEquals([later.body.sent, later.body.skipped], [0, 1], JSON.stringify(later.body)); assertEquals(graph.length, 1);
  assertEquals(db.rows('cs_auto_runs').map((r: any) => [r.entity, r.result, r.code]).at(-1), ['cart:c20', 'skipped', 'recent']);
});

Deno.test('outside the 24-hour window: the approved Meta template with the variables in order; a Graph refusal → failed + code, the row failed', async () => {
  const a = setup({ seed: SEED({ lastIn: '2026-11-06T07:00:00.000Z' }) });
  const { body } = await cron(a.deps);
  assertEquals([body.sent, body.failed], [1, 0], JSON.stringify(body));
  assertEquals(a.graph[0].body.type, 'template');
  assertEquals(a.graph[0].body.template, { name: 'order_confirmed_v1', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'نهى' }, { type: 'text', text: '177702' }, { type: 'text', text: '1,050 ج.م' }] }] });
  assertEquals(a.db.rows('cs_auto_runs')[0].code, 'wa1:template');
  const b = setup({ graphStatus: 400 });
  const r = await cron(b.deps);
  assertEquals([r.body.sent, r.body.failed], [0, 1]);
  assertEquals([b.db.rows('cs_messages')[0].delivery, b.db.rows('cs_messages')[0].meta.error, b.db.rows('cs_auto_runs')[0].result, b.db.rows('cs_auto_runs')[0].code], ['failed', 'graph_131047', 'failed', 'graph_131047']);
  // a failed row is not live, but there is no automatic retry: the rule fires again only when its event happens again
  const r2 = await cron(b.deps); assertEquals(r2.body.failed, 0); assertEquals(b.graph.length, 1);
});

Deno.test('the daily cap and the hours hold the message (no delivery, due_at) and a dry run writes nothing', async () => {
  const seed = SEED(); seed.settings[0].data.auto.daily.wa1 = 1;
  for (let i = 0; i < 1; i++) seed.cs_auto_runs = [{ rule_id: RULE, entity: 'order:1', result: 'sent', code: 'wa1:text', at: '2026-11-08T06:00:00.000Z' }];
  const { db, deps, graph } = setup({ seed });
  const dry = await call(deps, { action: 'tick', dry: true });
  assertEquals([dry.body.result, dry.body.events, dry.body.held], ['dry', 1, 1]); assertEquals(dry.body.preview, [{ rule: 'تأكيد الأوردر', entity: 'order:177702', result: 'held', code: 'cap' }]);
  assertEquals(db.rows('cs_auto_runs').length, 1); assertEquals(db.rows('cs_messages').length, 0);
  const { body } = await cron(deps);
  assertEquals([body.held, body.sent], [1, 0], JSON.stringify(body));
  const run = db.rows('cs_auto_runs').find((r: any) => r.entity === 'order:177702');
  assertEquals([run.result, run.code, run.due_at], ['held', 'cap', '2026-11-09T07:00:00.000Z']);
  const m = db.rows('cs_messages')[0]; assertEquals([m.delivery, m.meta.due_at], [null, '2026-11-09T07:00:00.000Z']); assertEquals(graph.length, 0);
  // at night the hold is on the hours
  const night = setup({ seed: SEED({ tick: '2026-11-08T07:45:00.000Z' }), now: '2026-11-08T21:30:00.000Z' }); // the last tick before the order changed
  const nb = (await cron(night.deps)).body; assertEquals([nb.held, nb.sent], [1, 0]);
  assertEquals(night.db.rows('cs_auto_runs')[0].code, 'hours');
  // the next morning the held row goes out
  night.deps.now = () => '2026-11-09T07:02:00.000Z';
  const morning = (await cron(night.deps)).body; assertEquals(morning.due, 1);
  // by the morning the customer's last message is older than 24 hours: the hold goes out as the approved template
  assertEquals([night.db.rows('cs_auto_runs')[0].result, night.db.rows('cs_auto_runs')[0].code, night.db.rows('cs_messages')[0].delivery], ['sent', 'wa1:template', 'sent']);
  assertEquals(night.graph[0].body.type, 'template');
});

Deno.test('inbound: the first message on a new conversation gets the welcome at once; outside the hours the settings text once a night; off → nothing', async () => {
  const seed = SEED(); seed.cs_auto_rules = [
    { id: RULE, name: 'ترحيب', event: 'first', action: 'send', template_id: TPL, enabled: true, runs: 0 },
    { id: '00000000-0000-4000-8000-0000000000f2', name: 'خارج المواعيد', event: 'afterhours', action: 'send', template_id: null, enabled: true, runs: 0 }];
  seed.cs_templates[0].body = 'أهلاً {اسم_العميل}! ازاي نقدر نساعدك؟';
  const { db, deps, graph } = setup({ seed });
  await onInbound(deps, { conversationId: CONV, customerId: CUST, channel: 'wa1', fresh: true });
  assertEquals(graph.length, 1); assertEquals(graph[0].body.text.body, 'أهلاً نهى! ازاي نقدر نساعدك؟');
  assertEquals(db.rows('cs_auto_runs').map((r: any) => [r.entity, r.result, r.code]), [['conv:' + CONV, 'sent', 'wa1:text']]);
  await onInbound(deps, { conversationId: CONV, customerId: CUST, channel: 'wa1', fresh: false }); assertEquals(graph.length, 1, 'a later message is not a first one');
  deps.now = () => '2026-11-08T21:30:00.000Z';
  await onInbound(deps, { conversationId: CONV, customerId: CUST, channel: 'wa1', fresh: false });
  assertEquals(graph.length, 2); assert(/مواعيد الرد/.test(graph[1].body.text.body));
  assertEquals(db.rows('cs_auto_runs')[1].entity, 'conv:' + CONV + '-20261108');
  await onInbound(deps, { conversationId: CONV, customerId: CUST, channel: 'wa1', fresh: false }); assertEquals(graph.length, 2, 'once a night');
  const off = setup({ seed: { ...SEED({ live: false }), cs_auto_rules: seed.cs_auto_rules } });
  await onInbound(off.deps, { conversationId: CONV, customerId: CUST, channel: 'wa1', fresh: true }); assertEquals(off.graph.length, 0); assertEquals(off.db.rows('cs_auto_runs').length, 0);
});

Deno.test('no answer in 24 hours: a ticket for خدمة العملاء as the server, once', async () => {
  const seed = SEED(); seed.cs_auto_runs = [{ rule_id: RULE, entity: 'order:177702', result: 'sent', code: 'wa1:text', customer_id: CUST, conversation_id: CONV, at: '2026-11-07T06:00:00.000Z' }];
  seed.cs_conversations[0].last_in_at = '2026-11-07T05:00:00.000Z';
  const { db, deps } = setup({ seed });
  const { body } = await cron(deps);
  assertEquals(body.silent, 1, JSON.stringify(body));
  const T = db.rows('tickets'); assertEquals(T.length, 1);
  assertEquals([T[0].type, T[0].assignee_role, T[0].priority, T[0].order_id, T[0].cs_customer_id, T[0].cs_conversation_id, T[0].created_by, T[0].created_by_name, T[0].status], ['customer', 'خدمة العملاء', 'normal', 177702, CUST, CONV, null, 'الرد الآلي', 'open']);
  assertEquals(db.rows('ticket_events').map((e: any) => e.kind), ['event', 'message']);
  assertEquals(db.rows('cs_auto_runs').find((r: any) => r.entity === 'order:177702-silent').result, 'ticket');
  const again = await cron(deps); assertEquals(again.body.silent, 0); assertEquals(db.rows('tickets').length, 1);
});
