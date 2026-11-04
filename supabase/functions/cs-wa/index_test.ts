// deno-lint-ignore-file no-explicit-any
// cs-wa handler tests (phase 6.3 + 6.4): the bridge's secret, its state and QR, the inbound messages (customers on wa1, makers on wa2,
// echoes, opt-out, campaign replies), the outbox with its claim, the campaigns' sending (the live switch, the pacing, the result, the
// auto stop, the send-time re-check) and the admin's actions. The fake database of ../_test/fakes.ts; no network.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const SECRET = 'b'.repeat(40);
const ADMIN = '00000000-0000-4000-8000-0000000000d1';
const CHANNELS = [{ id: 'wa1', name: 'واتساب 1 · العملاء', audience: 'customers', kind: 'qr', status: 'disconnected' }, { id: 'wa2', name: 'واتساب 2 · المبتكرين', audience: 'vendors', kind: 'qr', status: 'disconnected' }];
const STATE = [{ channel: 'wa1', status: 'offline' }, { channel: 'wa2', status: 'offline' }];
function setup(seed: Record<string, any[]> = {}, liveCampaigns = true) {
  const db = fakeDb({ cs_channels: CHANNELS, cs_wa_state: STATE, settings: [{ section: 'cs', data: { live: { wa: true, campaigns: liveCampaigns } } }], ...seed });
  const userDb = (jwt: string) => fakeDb({}, { rpc: { is_admin: () => jwt === 'jwt-admin' } });
  const deps = { env: { ...ENV, WA_BRIDGE_SECRET: SECRET }, db, now: () => NOW, userDb, userId: async (jwt: string) => (jwt === 'jwt-admin' ? ADMIN : jwt === 'jwt-member' ? '00000000-0000-4000-8000-0000000000d2' : null) };
  return { db, deps };
}
async function bridge(deps: any, body: any, secret = SECRET) {
  const res = await handler(new Request('http://x/cs-wa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-secret': secret }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
async function member(deps: any, body: any, jwt: string) {
  const res = await handler(new Request('http://x/cs-wa', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
const JID = '201012345678@s.whatsapp.net';

Deno.test('the bridge secret: a wrong or missing one is refused; a member cannot call the bridge actions', async () => {
  const { deps } = setup();
  assertEquals((await bridge(deps, { action: 'outbox', channel: 'wa1' }, 'c'.repeat(40))).res.status, 401);
  assertEquals((await bridge(deps, { action: 'outbox', channel: 'wa1' }, '')).res.status, 401);
  assertEquals((await member(deps, { action: 'outbox', channel: 'wa1' }, 'jwt-admin')).res.status, 400, 'the bridge actions need the secret');
  const short = setup(); short.deps.env.WA_BRIDGE_SECRET = 'short';
  assertEquals((await bridge(short.deps, { action: 'outbox', channel: 'wa1' }, 'short')).res.status, 401, 'a short secret never matches');
});

Deno.test('state: the QR (a clean SVG) for the admin only, connected → the channel connected with its number; the admin\'s logout reaches the bridge once', async () => {
  const { db, deps } = setup();
  await bridge(deps, { action: 'state', channel: 'wa1', status: 'qr', qr_svg: '<svg viewBox="0 0 4 4"><path d="M0 0h1v1H0z"/></svg>' });
  assertEquals(db.row('cs_wa_state', 'wa1', 'channel').status, 'qr');
  const st = await member(deps, { action: 'wa_status' }, 'jwt-admin');
  assert(st.body.states.find((x: any) => x.channel === 'wa1').qr_svg.startsWith('<svg'));
  assertEquals(st.body.live, { wa: true, campaigns: true });
  assertEquals((await member(deps, { action: 'wa_status' }, 'jwt-member')).res.status, 401, 'members never see the QR');
  await bridge(deps, { action: 'state', channel: 'wa1', status: 'connected', phone: '201000000001' });
  assertEquals([db.row('cs_wa_state', 'wa1', 'channel').qr_svg, db.row('cs_wa_state', 'wa1', 'channel').phone], [null, '01000000001']);
  assertEquals([db.row('cs_channels', 'wa1').status, db.row('cs_channels', 'wa1').number], ['connected', '01000000001']);
  assertEquals((await member(deps, { action: 'wa_logout', channel: 'wa1' }, 'jwt-admin')).res.status, 200);
  assertEquals((await bridge(deps, { action: 'state', channel: 'wa1', status: 'connected', phone: '201000000001' })).body.command, 'logout');
  assertEquals((await bridge(deps, { action: 'state', channel: 'wa1', status: 'logged_out' })).body.command, null, 'once');
  assertEquals([db.row('cs_channels', 'wa1').status, db.row('cs_channels', 'wa1').number], ['disconnected', null]);
  await bridge(deps, { action: 'state', channel: 'wa2', status: 'connected', phone: '201000000002' });
  await bridge(deps, { action: 'state', channel: 'wa2', status: 'offline' });
  assertEquals(db.row('cs_channels', 'wa2').status, 'error', 'a connected channel that drops is an error, not «disconnected»');
});

Deno.test('inbound on wa1: a new customer by phone + the conversation + the message (once); a reply → «مستنية ردنا»; «إيقاف» opts out; a campaign reply is marked', async () => {
  const { db, deps } = setup({ cs_campaigns: [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'k', channel: 'wa1', body: 'x', status: 'شغالة' }] });
  const ev = { action: 'inbound', channel: 'wa1', jid: JID, id: '3EB0AAA1', name: 'نهى', text: 'بكام؟', at: 1762000000 };
  assertEquals((await bridge(deps, ev)).body.kind, 'in');
  assertEquals((await bridge(deps, ev)).body.kind, 'duplicate');
  const cu = db.rows('cs_customers')[0];
  assertEquals([cu.phone, cu.name, cu.created_from], ['01012345678', 'نهى', 'channel']);
  const v = db.rows('cs_conversations')[0];
  assertEquals([v.seg, v.platform, v.channel, v.external_id, v.customer_id, v.status], ['customers', 'whatsapp', 'wa1', '01012345678', cu.id, 'جديدة']);
  await db.from('cs_campaign_recipients').insert({ id: 9, campaign_id: 'c0000000-0000-4000-8000-000000000001', customer_id: cu.id, phone: '01012345678', status: 'sent', at: NOW });
  await bridge(deps, { ...ev, id: '3EB0AAA2', text: 'طيب ابعتيلي الصور' });
  assertEquals(db.row('cs_conversations', v.id).status, 'مستنية ردنا');
  assertEquals(db.rows('cs_campaign_recipients')[0].status, 'replied');
  await bridge(deps, { ...ev, id: '3EB0AAA3', text: 'إيقاف' });
  assertEquals(db.row('cs_customers', cu.id).consent, false);
  assert(db.rows('cs_messages').some((m: any) => m.kind === 'event' && m.meta.opt_out));
});

Deno.test('inbound on wa2: a maker by phone (or alt phone); an unknown number is ignored; an echo of our claimed send takes its id', async () => {
  const V = '00000000-0000-4000-8000-0000000000e1';
  const { db, deps } = setup({ vendors: [{ id: V, name: 'مبتكر', phone: '+20 101 234 5678', alt_phone: null, aliases: [], status: 'active' }] });
  assertEquals((await bridge(deps, { action: 'inbound', channel: 'wa2', jid: '201099999999@s.whatsapp.net', id: '3EB0BBB1', text: 'x' })).body.reason, 'unknown_vendor');
  await bridge(deps, { action: 'inbound', channel: 'wa2', jid: JID, id: '3EB0BBB2', text: 'الأوردر جاهز' });
  const v = db.rows('cs_conversations')[0];
  assertEquals([v.seg, v.vendor_id, v.channel], ['vendors', V, 'wa2']);
  await db.from('cs_messages').insert({ id: '00000000-0000-4000-8000-0000000000f1', conversation_id: v.id, kind: 'out', text: 'تمام شكرًا', author: ADMIN, delivery: 'queued', external_id: null, claimed_at: NOW, meta: {}, created_at: NOW });
  assertEquals((await bridge(deps, { action: 'inbound', channel: 'wa2', jid: JID, id: '3EB0BBB3', fromMe: true, text: 'تمام شكرًا' })).body.kind, 'own');
  assertEquals([db.row('cs_messages', '00000000-0000-4000-8000-0000000000f1').external_id, db.row('cs_messages', '00000000-0000-4000-8000-0000000000f1').delivery], ['3EB0BBB3', 'sent']);
  assertEquals((await bridge(deps, { action: 'inbound', channel: 'wa2', jid: JID, id: '3EB0BBB4', fromMe: true, text: 'من الموبايل' })).body.kind, 'echo');
});

Deno.test('outbox: the queued messages of the channel with the WhatsApp id, claimed (not handed twice in two minutes); sent / failed', async () => {
  const C = '00000000-0000-4000-8000-0000000000c9'; const K = '00000000-0000-4000-8000-0000000000a9';
  const { db, deps } = setup({
    cs_customers: [{ id: C, phone: '01012345678', name: 'نهى', created_from: 'orders' }],
    cs_conversations: [{ id: K, seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: C, external_id: null, status: 'مستنية ردنا' }],
    cs_messages: [{ id: '00000000-0000-4000-8000-0000000000b1', conversation_id: K, kind: 'out', text: 'أهلا', author: ADMIN, delivery: 'queued', external_id: null, meta: {}, created_at: NOW }],
  });
  const a = await bridge(deps, { action: 'outbox', channel: 'wa1' });
  assertEquals(a.body.items, [{ id: '00000000-0000-4000-8000-0000000000b1', jid: JID, text: 'أهلا' }]);
  assertEquals((await bridge(deps, { action: 'outbox', channel: 'wa1' })).body.items, [], 'claimed');
  assertEquals((await bridge(deps, { action: 'outbox', channel: 'wa2' })).body.items, [], 'another channel');
  await bridge(deps, { action: 'sent', id: '00000000-0000-4000-8000-0000000000b1', ok: true, wa_id: '3EB0CCC1' });
  assertEquals([db.rows('cs_messages')[0].delivery, db.rows('cs_messages')[0].external_id], ['sent', '3EB0CCC1']);
  await bridge(deps, { action: 'receipt', channel: 'wa1', ids: ['3EB0CCC1'], status: 'read' });
  assertEquals(db.rows('cs_messages')[0].delivery, 'read');
});

Deno.test('campaigns: nothing while not live; a due one starts, pacing by the day\'s cap and the pause, the text filled, the send-time re-check, results and the auto stop', async () => {
  const K = 'c0000000-0000-4000-8000-000000000002';
  const C1 = '00000000-0000-4000-8000-0000000000c1'; const C2 = '00000000-0000-4000-8000-0000000000c2'; const C3 = '00000000-0000-4000-8000-0000000000c3';
  const seed = {
    cs_customers: [{ id: C1, phone: '01011112221', name: 'نهى حسن', consent: true, created_from: 'orders' }, { id: C2, phone: '01011112222', name: 'علي', consent: false, created_from: 'orders' }, { id: C3, phone: '01011112223', name: 'سارة', consent: true, created_from: 'orders' }],
    cs_campaigns: [{ id: K, name: 'عرض', channel: 'wa1', body: 'أهلا {اسم_العميل} كود {كود_الخصم}', discount_code: 'IB10', status: 'مجدولة', scheduled_at: '2026-10-25T11:00:00.000Z', cap_per_day: 300, min_delay_s: 20 }],
    cs_campaign_recipients: [{ id: 1, campaign_id: K, customer_id: C1, phone: '01011112221', status: 'queued' }, { id: 2, campaign_id: K, customer_id: C2, phone: '01011112222', status: 'queued' }, { id: 3, campaign_id: K, customer_id: C3, phone: '01011112223', status: 'queued' }],
  };
  const off = setup(structuredClone(seed), false);
  assertEquals((await bridge(off.deps, { action: 'campaign_next', channel: 'wa1' })).body, { result: 'ok', items: [], reason: 'not_live' });
  const { db, deps } = setup(structuredClone(seed));
  const first = await bridge(deps, { action: 'campaign_next', channel: 'wa1' });
  assertEquals(db.row('cs_campaigns', K).status, 'شغالة');
  assertEquals(first.body.items[0].jid, '201011112221@s.whatsapp.net');
  assert(first.body.items[0].text.startsWith('أهلا نهى كود IB10'));
  assert(first.body.items[0].text.includes('إيقاف'), 'the opt-out line');
  await bridge(deps, { action: 'campaign_result', recipient_id: 1, ok: true, wa_id: '3EB0DDD1' });
  assertEquals((await bridge(deps, { action: 'campaign_next', channel: 'wa1' })).body.items, [], 'the 20-second pause');
  // later: the customer who withdrew consent since the scheduling is skipped at send time (opted_out), the next one goes
  const later = { ...deps, now: () => '2026-10-25T12:01:00.000Z' };
  const next = await bridge(later, { action: 'campaign_next', channel: 'wa1' });
  assertEquals(db.rows('cs_campaign_recipients').find((r: any) => r.id === 2).status, 'opted_out');
  assertEquals(next.body.items[0].recipient_id, 3);
  await bridge(later, { action: 'campaign_result', recipient_id: 3, ok: false, error: 'not_on_whatsapp' });
  const k = db.row('cs_campaigns', K);
  assertEquals([k.stats.sent, k.stats.failed, k.stats.opted_out, k.status], [1, 1, 1, 'خلصت']);
});

Deno.test('campaigns: the day\'s cap holds the rest for tomorrow; failures over 2% after 20 sends pause the campaign', async () => {
  const K = 'c0000000-0000-4000-8000-000000000003';
  const rec = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, campaign_id: K, customer_id: null, phone: '0101111' + String(2000 + i), status: i < 19 ? 'sent' : i < 20 ? 'failed' : 'queued', at: i < 20 ? '2026-10-25T11:59:00.000Z' : null }));
  const { db, deps } = setup({ cs_campaigns: [{ id: K, name: 'k', channel: 'wa1', body: 'x', status: 'شغالة', scheduled_at: '2026-10-25T10:00:00.000Z', cap_per_day: 20, min_delay_s: 1 }], cs_campaign_recipients: rec });
  assertEquals((await bridge(deps, { action: 'campaign_next', channel: 'wa1' })).body.items, [], 'the cap of the day (Cairo)');
  await db.from('cs_campaigns').update({ cap_per_day: 100 }).eq('id', K);
  const n = await bridge({ ...deps, now: () => '2026-10-25T12:00:30.000Z' }, { action: 'campaign_next', channel: 'wa1' });
  assertEquals(n.body.items.length, 0, 'a recipient without a customer is never sent (the send-time check needs one)');
  assertEquals(db.rows('cs_campaign_recipients').find((r: any) => r.id === 21).status, 'opted_out');
  await bridge(deps, { action: 'campaign_result', recipient_id: 22, ok: false, error: 'x' });
  assertEquals(db.row('cs_campaigns', K).status, 'متوقفة', '2 failed of 21 > 2%');
});

Deno.test('decision 26: wa1 on the Cloud API (kind meta) — the bridge neither feeds it, sends from it nor changes its state; its session is told to log out', async () => {
  const { db, deps } = setup({ cs_channels: [{ ...CHANNELS[0], kind: 'meta', status: 'connected', number: '+20 100 000 0001' }, CHANNELS[1]] });
  const inb = await bridge(deps, { action: 'inbound', channel: 'wa1', jid: JID, id: '3EB0CLOUD', fromMe: false, text: 'أهلا' });
  assertEquals(inb.body, { result: 'ignored', reason: 'cloud_channel' });
  assertEquals(db.rows('cs_messages').length, 0);
  assertEquals((await bridge(deps, { action: 'outbox', channel: 'wa1' })).body.items, []);
  const st = await bridge(deps, { action: 'state', channel: 'wa1', status: 'offline' });
  assertEquals([st.body.command, db.row('cs_channels', 'wa1').status, db.row('cs_channels', 'wa1').number], ['logout', 'connected', '+20 100 000 0001']);
});
