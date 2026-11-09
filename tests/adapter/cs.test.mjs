import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// cs.js (phase 6) against a stub IBSupabase: the customers through the rpc only (never the base table's phone), the conversations
// of the last 90 days / open with their messages, the segments / campaigns / channels / settings → the v2 prototype's shapes;
// the writes (messages, status, close with mood + rating, a lead, mood / tags, notes, override, merge, segments, campaigns,
// settings), the reasons, the activity rows (ids / names / statuses only), the permissions, the Realtime reload.
const src = readFileSync(new URL('../../app/js/adapter/cs.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg); // the adapter's values live in the vm realm
const ME = 'u1'; const SARA = 'u2'; const C1 = 'c0000000-0000-4000-8000-000000000001'; const C2 = 'c0000000-0000-4000-8000-000000000002'; const V1 = 'a0000000-0000-4000-8000-000000000001';
const K1 = 'd0000000-0000-4000-8000-000000000001'; const K2 = 'd0000000-0000-4000-8000-000000000002'; const G1 = 'e0000000-0000-4000-8000-000000000001';
const ok = (data) => ({ data, error: null });
const DAY = 864e5; const NOW = Date.now(); const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const CUST = [
  { id: C1, phone: '01012345678', name: 'نهى عبد الرحمن', ig: '@noha', city: 'القاهرة', province: 'القاهرة', address: '12 ش عباس العقاد', address2: null, mood: null, tags: ['فخار'], consent: true, auto_consent: true, source: 'الموقع', created_from: 'orders', blocked_at: null, merged_into: null, created_at: '2026-03-01T10:00:00Z',
    orders: 2, total: '800.00', last_order_at: iso(13 * DAY), refused: 0, returned: 1, open_complaints: 1, late_open: 1, conversations: 1, last_active_at: iso(3600e3), rating_sat: '4.5', rating_manners: '3.0', rating_count: 2, override_stars: null, override_reason: null,
    order_list: [{ id: 178611, status: 'جاري التنفيذ', total: 1250, placed_at: iso(13 * DAY) }, { id: 176980, status: 'مكتمل', total: 980, placed_at: '2026-10-02T09:00:00Z' }, { id: 170001, status: 'استرجاع', total: 300, placed_at: '2026-09-02T09:00:00Z' }] },
  { id: C2, phone: '011••••6677', name: 'Mariam Khaled', ig: null, city: null, province: null, address: null, address2: null, mood: 'متضايق', tags: [], consent: true, auto_consent: false, source: null, created_from: 'manual', blocked_at: null, merged_into: null, created_at: '2026-10-20T10:00:00Z',
    orders: 0, total: 0, last_order_at: null, refused: 0, returned: 0, open_complaints: 0, late_open: 0, conversations: 0, last_active_at: '2026-10-20T10:00:00Z', rating_sat: null, rating_manners: null, rating_count: 0, override_stars: 4, override_reason: 'تعديل يدوي', order_list: [] },
  { id: 'c0000000-0000-4000-8000-000000000003', phone: null, name: 'مدموج', merged_into: C1, created_at: '2026-10-01T00:00:00Z', orders: 0, total: 0, tags: [], order_list: [] },
];
const CONVS = [
  { id: K1, seg: 'customers', platform: 'whatsapp', channel: 'wa1', customer_id: C1, vendor_id: null, handle: null, external_id: null, status: 'مستنية ردنا', assignee: SARA, outcome: null, tags: ['شكوى'], last_in_at: iso(18 * 60000), last_out_at: null, waiting_since: iso(18 * 60000), unread: 2, snoozed_until: null, closed_at: null, closed_by: null, created_by: null, created_at: iso(3 * 3600e3), updated_at: iso(18 * 60000) },
  { id: K2, seg: 'vendors', platform: 'whatsapp', channel: 'wa2', customer_id: null, vendor_id: V1, handle: null, external_id: null, status: 'اتحلت', assignee: null, outcome: 'اتحل', tags: [], last_in_at: iso(2 * DAY), last_out_at: iso(2 * DAY), waiting_since: null, unread: 0, snoozed_until: null, closed_at: iso(DAY), closed_by: ME, created_by: ME, created_at: iso(3 * DAY), updated_at: iso(DAY) },
];
const MSGS = [
  { id: 'm1', conversation_id: K1, kind: 'in', text: 'الأوردر 178611 اتأخر ليه؟', author: null, delivery: null, meta: {}, created_at: iso(3 * 3600e3) },
  { id: 'm2', conversation_id: K1, kind: 'auto', text: 'أهلاً نهى 🙏', author: null, delivery: 'sent', meta: { tpl: 'تنبيه تأخير مسبق' }, created_at: iso(2 * 3600e3) },
  { id: 'm3', conversation_id: K1, kind: 'note', text: 'كلموا الورشة', author: SARA, delivery: null, meta: {}, created_at: iso(18 * 60000) },
  { id: 'm4', conversation_id: K2, kind: 'out', text: 'إمتى التسليم؟', author: ME, delivery: 'read', meta: {}, created_at: iso(2 * DAY) },
];
const SEG = { id: G1, name: 'VIP راضيين', min_total: '5000.00', min_orders: null, moods: ['سعيد'], last_kind: 'in90', last_from: null, last_to: null, ranges: { sat: [4, 5] }, include_unrated: false, add_ids: [C2], remove_ids: [], created_by: ME, created_at: '2026-10-01T00:00:00Z', updated_at: null };
const CAMP = { id: 'f0000000-0000-4000-8000-000000000001', name: 'عرض أكتوبر', segment_id: G1, channel: 'wa1', body: 'خصم 10%', image_path: null, discount_code: 'OCT10', scheduled_at: null, cap_per_day: 300, min_delay_s: 20, status: 'مسودة', size: 12, stats: { sent: 3, read: 1 }, created_by: ME, created_at: '2026-10-21T00:00:00Z', updated_at: iso(DAY) };
const CHANS = [{ id: 'wa1', name: 'واتساب 1 · العملاء', audience: 'customers', kind: 'qr', status: 'disconnected', number: null, cap_per_day: 300, since: null, last_message_at: null, updated_at: null }, { id: 'messenger', name: 'ماسنجر', audience: 'customers', kind: 'meta', status: 'disconnected', number: null, cap_per_day: 1000, since: null, last_message_at: null, updated_at: null }];
const BASE_PERMS = { 'cs.view': 'F', 'cs.reply': 'F', 'cs.manage': 'F', 'sensitive.customer_phone': 'F', 'orders.view': 'F' };
function load({ responses = {}, perms = BASE_PERMS, admin = false, channelThrows = false } = {}) {
  const stub = stubClient({ channelThrows, responses: { 'rpc:cs_customers_list': ok(CUST), cs_conversations: ok(CONVS), cs_messages: ok(MSGS), cs_segments: ok([SEG]), cs_campaigns: ok([CAMP]), cs_channels: ok(CHANS),
    cs_customer_notes: ok([{ id: 1, customer_id: C1, text: 'بتحب التغليف كهدية', author: SARA, at: iso(2 * 3600e3) }]), cs_team_ratings: ok([{ id: 1, customer_id: C1, conversation_id: K2, sat: 4, manners: 3, note: null, by_user: ME, at: iso(5 * DAY) }]),
    settings: ok({ data: { routing: 'manual', sla_warn: 5, sla_late: 20 } }), ...responses } });
  const events = []; const logs = [];
  const members = [{ id: 'M01', uid: ME, name: 'صفوت كمال', role: 'أدمن', status: 'active' }, { id: 'M02', uid: SARA, name: 'سارة أحمد', role: 'عمليات', status: 'active' }, { id: 'M05', uid: 'u5', name: 'كريم سامي', role: 'مشاهد', status: 'active' }, { id: 'M06', uid: 'u6', name: 'نورا', role: 'خدمة العملاء', status: 'suspended' }];
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => ({ user: { id: ME } }) }, IBDirectory: { perm: (k) => perms[k] || 'N', me: () => ({ id: ME, role_id: admin ? 'admin' : 'ops' }), members: () => members },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBVendors: { store: { get: (id) => (id === V1 ? { id: V1, name: 'Art Craft' } : null) } },
    IbtekrCS: { normPhone: (v) => String(v).replace(/\D/g, ''), validateRatingOverride: (s, r) => (!(s >= 1 && s <= 5) ? 'اختار تقييم' : !r ? 'اكتب السبب' : null), validateTeamRating: (r) => (r && r.sat >= 1 && r.sat <= 5 && r.manners >= 1 && r.manners <= 5 ? {} : { sat: 'x' }), validateSegment: (s, names) => (!String(s.name || '').trim() ? { name: 'اكتب اسم الشريحة' } : names.includes(s.name) ? { name: 'الاسم موجود' } : {}) } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, setTimeout, clearTimeout, Intl, Error });
  return { S: window.IBCS, stub, events, logs };
}
const inserted = (stub, table) => opsOf(stub.calls, table).filter((c) => c.op === 'insert').map((c) => c.args[0]);

test('load: the customers through the rpc only (merged rows dropped), the conversations with their messages in chunks, segments / campaigns / channels / settings → the prototype shapes; ib:cs', async () => {
  const { S, stub, events } = load();
  await S.load();
  assert.equal(S.state(), 'ready');
  assert.ok(stub.calls.some((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list'));
  assert.ok(!stub.calls.some((c) => c.table === 'cs_customers'), 'the base table is never read');
  const convOps = opsOf(stub.calls, 'cs_conversations');
  assert.equal(convOps[1].op, 'or'); assert.match(convOps[1].args[0], /^status\.neq\.اتحلت,updated_at\.gte\.\d{4}-/);
  eq(opsOf(stub.calls, 'cs_messages')[1], { op: 'in', args: ['conversation_id', [K1, K2]] });
  const cu = plain(S.customer(C1));
  assert.equal(cu.phone, '01012345678'); assert.equal(cu.total, 800); assert.equal(cu.orders, 2); assert.equal(cu.lastOrderDays, 13); assert.equal(cu.returned, 1); assert.equal(cu.openComplaints, 1); assert.equal(cu.lateOpen, 1);
  assert.equal(cu.ratingSat, 4.5); assert.equal(cu.ratingManners, 3); assert.equal(cu.ratingCount, 2); assert.equal(cu.manualRating, null);
  eq(cu.orderList.map((o) => [o[0], o[1], o[3]]), [['178611', 'Processing', 'Late'], ['176980', 'Completed', null], ['170001', 'Cancelled', null]]);
  assert.match(cu.orderList[0][2], /^1,250 ج\.م · \d+ [^ ]+$/);
  eq(cu.channels, ['whatsapp']); assert.equal(cu.notes.length, 1); assert.equal(cu.notes[0].author, 'سارة أحمد'); assert.equal(cu.notes[0].text, 'بتحب التغليف كهدية');
  eq(cu.ratings.map((r) => [r.sat, r.manners, r.by, r.chat]), [[4, 3, 'صفوت كمال', K2]]);
  const c2 = S.customer(C2); assert.equal(c2.phone, '011••••6677'); assert.equal(c2.mood, 'متضايق'); assert.equal(c2.manualRating, 4); assert.equal(c2.ratingReason, 'تعديل يدوي'); assert.equal(c2.lastOrderDays, null); assert.equal(c2.autoConsent, false);
  assert.equal(S.data.customers.length, 2, 'the merged row is not listed');
  const v = plain(S.conv(K1));
  assert.equal(v.who, C1); assert.equal(v.assignee, 'سارة أحمد'); assert.equal(v.assigneeUid, SARA); assert.equal(v.waiting, 18); assert.equal(v.unread, 2); eq(v.tags, ['شكوى']);
  eq(v.msgs.map((m) => [m.t, m.author, m.tpl, m.delivery]), [['in', '', null, null], ['auto', '', 'تنبيه تأخير مسبق', 'sent'], ['note', 'سارة أحمد', null, null]]);
  // m1 is 3 hours old and m3 18 minutes: a clock when they fell today, «أمس» when the run sits just after midnight (the label follows the real clock)
  assert.match(v.msgs[0].time, /^(\d{1,2}:\d{2} [صم]|أمس)$/); assert.match(v.time, /^(\d{1,2}:\d{2} [صم]|أمس)$/);
  const v2 = S.conv(K2); assert.equal(v2.who, V1); assert.equal(v2.assignee, 'غير معيّنة'); assert.equal(v2.waiting, 0); assert.equal(v2.time, 'أمس');
  eq(plain(S.data.segments[0]), { id: G1, name: 'VIP راضيين', minTotal: 5000, minOrders: '', moods: ['سعيد'], last: 'in90', lastFrom: '', lastTo: '', ranges: { sat: [4, 5] }, includeUnrated: false, add: [C2], remove: [] });
  const k = S.data.campaigns[0]; assert.equal(k.seg, 'VIP راضيين'); assert.equal(k.from, 'واتساب 1 · العملاء'); assert.equal(k.sent, 3); assert.equal(k.read, 1); assert.equal(k.status, 'مسودة'); assert.match(k.sub, /^مسودة — آخر تعديل أمس$/);
  assert.equal(S.data.channels.wa1.status, 'disconnected'); assert.equal(S.data.channels.wa1.cap, 300); assert.equal(S.data.channels.messenger.kind, 'meta'); assert.equal(S.data.channels.wa1.last, 'مش مربوط');
  eq(plain(S.data.settings), { routing: 'manual', slaWarn: 5, slaLate: 20, hours: S.DEFAULT_SETTINGS.hours, autoCloseDays: 3, live: { wa: false, campaigns: false } });
  assert.ok(events.includes('ib:cs'));
});

test('cs.view = N reads nothing; a failing rpc → error; the agents are the active members of the service roles', async () => {
  const none = load({ perms: {} }); await none.S.load();
  assert.equal(none.stub.calls.filter((c) => c.op === 'from' || c.op === 'rpc').length, 0); assert.equal(none.S.state(), 'ready'); eq(none.S.data.customers, []);
  const bad = load({ responses: { 'rpc:cs_customers_list': { data: null, error: { code: '42501' } } } }); await bad.S.load();
  assert.equal(bad.S.state(), 'error');
  const { S } = load();
  eq(plain(S.agents()).map((a) => [a.name, a.role]), [['صفوت كمال', 'أدمن'], ['سارة أحمد', 'عمليات']]);
  eq(S.can(), { view: 'F', reply: true, manage: true, phone: true, orders: true, admin: false });
});

test('withDays puts a day row before each new day; timeLabel: today a clock, yesterday «أمس», else the date', () => {
  const { S } = load();
  const rows = S.withDays([{ at: new Date(NOW - 2 * DAY).toISOString(), t: 'in' }, { at: new Date(NOW - 2 * DAY + 60000).toISOString(), t: 'out' }, { at: new Date(NOW).toISOString(), t: 'in' }], NOW);
  eq(rows.map((r) => r.t), ['day', 'in', 'out', 'day', 'in']); assert.equal(rows[3].text, 'اليوم');
  assert.equal(S.timeLabel(NOW - DAY, NOW), 'أمس'); assert.match(S.timeLabel(NOW - 40 * DAY, NOW), /^\d{1,2} [^\d ]+$/);
});

test('send / note / event insert a message of that kind (out: no delivery of our own — the server queues it); the log carries no text', async () => {
  const { S, stub, logs } = load({ responses: { cs_messages: (q) => (q.some((c) => c.op === 'insert') ? ok([{ id: 'm9', conversation_id: K1, kind: q.find((c) => c.op === 'insert').args[0].kind, text: 'x', author: ME, delivery: 'queued', meta: q.find((c) => c.op === 'insert').args[0].meta, created_at: new Date().toISOString() }]) : ok(MSGS)) } });
  await S.load();
  const r = await S.send(K1, '  أهلاً يا نهى  ', { tpl: 'اعتذار' });
  assert.equal(r.ok, true); assert.equal(r.msg.t, 'out'); assert.equal(r.msg.tpl, 'اعتذار'); assert.equal(r.msg.author, 'صفوت كمال');
  eq(inserted(stub, 'cs_messages').at(-1), { conversation_id: K1, kind: 'out', text: 'أهلاً يا نهى', meta: { tpl: 'اعتذار' } });
  assert.equal(S.conv(K1).msgs.at(-1).id, 'm9'); assert.equal(S.conv(K1).waiting, 0);
  eq(logs.at(-1).slice(0, 2), ['cs.send', 'customers · whatsapp · اعتذار']); assert.ok(!JSON.stringify(logs).includes('نهى'));
  await S.note(K1, 'ملاحظة'); assert.equal(inserted(stub, 'cs_messages').at(-1).kind, 'note'); assert.equal(logs.at(-1)[0], 'cs.note');
  const n = logs.length; await S.event(K1, 'حدث'); assert.equal(inserted(stub, 'cs_messages').at(-1).kind, 'event'); assert.equal(logs.length, n, 'an event is not logged');
  eq(await S.send(K1, '   '), { ok: false, reason: 'invalid' });
  eq(await S.send(K1, 'x'.repeat(4001)), { ok: false, reason: 'invalid' });
});

test('setStatus / assign / tags / snooze update the row (.select); an unknown status is invalid; zero rows → forbidden; 42501 → forbidden', async () => {
  const { S, stub, logs } = load({ responses: { cs_conversations: (q) => { const u = q.find((c) => c.op === 'update'); return u ? ok([{ ...CONVS[0], ...u.args[0], updated_at: new Date().toISOString() }]) : ok(CONVS); } } });
  await S.load();
  const r = await S.setStatus(K1, 'مستنية العميل');
  assert.equal(r.ok, true); assert.equal(r.conv.status, 'مستنية العميل'); assert.equal(S.conv(K1).status, 'مستنية العميل'); assert.equal(S.conv(K1).msgs.length, 3, 'the messages stay');
  eq(logs.at(-1).slice(0, 2), ['cs.status', 'مستنية العميل']);
  eq(await S.setStatus(K1, 'x'), { ok: false, reason: 'invalid' });
  await S.assign(K1, ME); eq(opsOf(stub.calls, 'cs_conversations').filter((c) => c.op === 'update').at(-1).args[0], { assignee: ME }); assert.equal(S.conv(K1).assignee, 'صفوت كمال'); assert.equal(logs.at(-1)[1], 'صفوت كمال');
  await S.assign(K1, null); assert.equal(S.conv(K1).assignee, 'غير معيّنة');
  await S.setConvTags(K1, [' شكوى ', '', 'مستعجل']); eq(opsOf(stub.calls, 'cs_conversations').filter((c) => c.op === 'update').at(-1).args[0], { tags: ['شكوى', 'مستعجل'] });
  await S.snooze(K1, '2026-11-03T09:00:00Z'); eq(opsOf(stub.calls, 'cs_conversations').filter((c) => c.op === 'update').at(-1).args[0], { status: 'مؤجلة', snoozed_until: '2026-11-03T09:00:00Z' });
  const zero = load({ responses: { cs_conversations: (q) => (q.some((c) => c.op === 'update') ? ok([]) : ok(CONVS)) } }); await zero.S.load();
  eq(await zero.S.setStatus(K1, 'اتحلت'), { ok: false, reason: 'forbidden' });
  const deny = load({ responses: { cs_conversations: (q) => (q.some((c) => c.op === 'update') ? { data: null, error: { code: '42501' } } : ok(CONVS)) } }); await deny.S.load();
  eq(await deny.S.assign(K1, ME), { ok: false, reason: 'forbidden' });
});

test('close: the outcome on the conversation, the mood on the customer, the team rating in cs_team_ratings, then one event; the rating averages locally', async () => {
  const { S, stub, logs } = load({ responses: {
    cs_conversations: (q) => { const u = q.find((c) => c.op === 'update'); return u ? ok([{ ...CONVS[0], ...u.args[0], closed_at: new Date().toISOString() }]) : ok(CONVS); },
    cs_customers: ok([{ id: C1 }]),
    cs_team_ratings: (q) => { const i = q.find((c) => c.op === 'insert'); return i ? ok([{ id: 7, ...i.args[0], by_user: ME, at: new Date().toISOString() }]) : ok([]); },
    cs_messages: (q) => { const i = q.find((c) => c.op === 'insert'); return i ? ok([{ id: 'ev', conversation_id: K1, author: ME, created_at: new Date().toISOString(), meta: {}, delivery: null, ...i.args[0] }]) : ok(MSGS); } } });
  await S.load();
  const r = await S.close(K1, { outcome: 'اتحلت المشكلة', mood: 'سعيد', rating: { sat: 5, manners: 4, note: 'ذوق' }, note: 'تمام' });
  assert.equal(r.ok, true); assert.equal(r.mood, 'سعيد'); eq([r.rating.sat, r.rating.manners], [5, 4]);
  eq(opsOf(stub.calls, 'cs_conversations').filter((c) => c.op === 'update')[0].args[0], { status: 'اتحلت', outcome: 'اتحلت المشكلة' });
  eq(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update')[0].args[0], { mood: 'سعيد' });
  eq(inserted(stub, 'cs_team_ratings')[0], { customer_id: C1, conversation_id: K1, sat: 5, manners: 4, note: 'ذوق' });
  const ev = inserted(stub, 'cs_messages')[0]; assert.equal(ev.kind, 'event'); assert.match(ev.text, /النتيجة: «اتحلت المشكلة» · حالة العميل: سعيد · تقييم: رضا 5 · أخلاق 4 · تمام$/);
  const cu = S.customer(C1); assert.equal(cu.mood, 'سعيد'); assert.equal(cu.ratingCount, 3); assert.equal(cu.ratingSat, 4.7); assert.equal(cu.ratingManners, 3.3); assert.equal(cu.ratings[0].sat, 5);
  assert.ok(logs.some((l) => l[0] === 'cs.close' && l[1] === 'customers · اتحلت المشكلة')); assert.ok(logs.some((l) => l[0] === 'cs.rating' && l[1] === '5 · 4')); assert.ok(!JSON.stringify(logs).includes('ذوق'));
  eq(await S.close(K1, { outcome: '' }), { ok: false, reason: 'invalid', field: 'outcome' });
  eq(await S.close('nope', { outcome: 'x' }), { ok: false, reason: 'notfound' });
});

test('open: a plain conversation (status مستنية العميل, assigned to me) for a customer or a maker; the customer gains the platform', async () => {
  const { S, stub, logs } = load({ responses: { cs_conversations: (q) => { const i = q.find((c) => c.op === 'insert'); return i ? ok([{ ...CONVS[0], id: 'new', ...i.args[0], assignee: i.args[0].assignee, created_at: new Date().toISOString(), updated_at: null, tags: [], unread: 0, waiting_since: null, last_in_at: null }]) : ok(CONVS); } } });
  await S.load();
  const r = await S.open({ seg: 'customers', platform: 'instagram', customerId: C2 });
  assert.equal(r.ok, true); assert.equal(r.conv.status, 'مستنية العميل'); assert.equal(r.conv.assignee, 'صفوت كمال'); assert.equal(r.conv.who, C2);
  eq(inserted(stub, 'cs_conversations')[0], { seg: 'customers', platform: 'instagram', channel: 'wa1', customer_id: C2, vendor_id: null, handle: null, status: 'مستنية العميل', assignee: ME });
  eq(S.customer(C2).channels, ['instagram']); assert.equal(S.customer(C2).conversations, 1); assert.equal(S.data.convs[0].id, 'new');
  await S.open({ seg: 'vendors', vendorId: V1, assignee: null }); eq(inserted(stub, 'cs_conversations')[1], { seg: 'vendors', platform: 'whatsapp', channel: 'wa2', customer_id: null, vendor_id: V1, handle: null, status: 'مستنية العميل', assignee: null });
  eq(await S.open({ seg: 'comments' }), { ok: false, reason: 'invalid', field: 'seg' });
  assert.equal(logs.at(-1)[0], 'cs.open');
});

test('addCustomer: a manual lead (normalised phone, created_from manual) then the list again; a taken phone is a duplicate; importCustomers counts added / existing / invalid', async () => {
  let seq = 0;
  const { S, stub, logs } = load({ responses: { cs_customers: (q) => { const i = q.find((c) => c.op === 'insert'); if (!i) return ok([]); if (i.args[0].phone === '01012345678') return { data: null, error: { code: '23505' } }; seq += 1; return ok([{ id: 'n' + seq, name: i.args[0].name }]); } } });
  await S.load();
  const r = await S.addCustomer({ name: ' يوسف حامد ', phone: '+20 127 776 6655', city: 'المنصورة', source: 'إعلان' });
  assert.equal(r.ok, true); assert.equal(r.id, 'n1');
  eq(inserted(stub, 'cs_customers')[0], { name: 'يوسف حامد', phone: '201277766655', ig: null, city: 'المنصورة', province: null, address: null, address2: null, mood: null, tags: [], consent: true, auto_consent: true, source: 'إعلان', created_from: 'manual' });
  assert.equal(stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length, 2, 'the list is read again');
  eq(logs.at(-1).slice(0, 2), ['cs.customer.add', 'يوسف حامد']); assert.ok(!JSON.stringify(logs).includes('7766655'));
  const dup = await S.addCustomer({ name: 'نهى', phone: '01012345678' }); assert.equal(dup.ok, false); assert.equal(dup.reason, 'invalid'); assert.equal(dup.duplicate, true);
  eq(await S.addCustomer({ name: '' }), { ok: false, reason: 'invalid', field: 'name' });
  eq(await S.addCustomer({ name: 'x', phone: '12' }), { ok: false, reason: 'invalid', field: 'phone' });
  const imp = await S.importCustomers([{ phone: '01099988877', name: 'أحمد' }, { phone: '01012345678' }, { phone: 'abc' }]);
  eq(imp, { ok: true, added: 1, existing: 1, invalid: 1 }); assert.equal(inserted(stub, 'cs_customers').at(-1).created_from, 'import'); assert.equal(logs.at(-1)[0], 'cs.customer.import');
});

test('setMood / setTags / updateCustomer / block / addNote / setOverride write the right columns; the local row follows', async () => {
  const { S, stub, logs } = load({ responses: { cs_customers: ok([{ id: C1 }]), cs_customer_notes: (q) => { const i = q.find((c) => c.op === 'insert'); return i ? ok([{ id: 9, ...i.args[0], author: ME, at: new Date().toISOString() }]) : ok([]); } } });
  await S.load();
  await S.setMood(C1, 'متضايق'); eq(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update').at(-1).args[0], { mood: 'متضايق' }); assert.equal(S.customer(C1).mood, 'متضايق');
  eq(await S.setMood(C1, 'x'), { ok: false, reason: 'invalid' });
  await S.setTags(C1, ['فخار', ' هدايا ', 'فخار']); eq(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update').at(-1).args[0], { tags: ['فخار', 'هدايا'] });
  await S.updateCustomer(C1, { name: 'نهى', ig: '', consent: false, autoConsent: true, city: 'الجيزة', mood: 'سعيد', phone: '000' });
  eq(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update').at(-1).args[0], { name: 'نهى', ig: null, city: 'الجيزة', consent: false, auto_consent: true, mood: 'سعيد' }); // never the phone
  assert.equal(S.customer(C1).autoConsent, true); assert.equal(S.customer(C1).city, 'الجيزة'); assert.equal(logs.at(-1)[1], 'name, ig, city, consent, auto_consent, mood');
  eq(await S.updateCustomer(C1, { name: ' ' }), { ok: false, reason: 'invalid', field: 'name' });
  await S.block(C1); assert.match(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update').at(-1).args[0].blocked_at, /^\d{4}-/); assert.equal(S.customer(C1).blocked, true); assert.equal(logs.at(-1)[0], 'cs.block');
  await S.block(C1, false); eq(opsOf(stub.calls, 'cs_customers').filter((c) => c.op === 'update').at(-1).args[0], { blocked_at: null }); assert.equal(S.customer(C1).blocked, false);
  const n = await S.addNote(C1, ' تحب الهدايا '); assert.equal(n.ok, true); eq(inserted(stub, 'cs_customer_notes')[0], { customer_id: C1, text: 'تحب الهدايا' }); assert.equal(S.customer(C1).notes[0].id, 9); assert.ok(!JSON.stringify(logs).includes('الهدايا'));
  const o = await S.setOverride(C1, 4, 'عميلة قديمة'); assert.equal(o.ok, true); eq(inserted(stub, 'cs_rating_overrides')[0], { customer_id: C1, stars: 4, reason: 'عميلة قديمة' }); assert.equal(S.customer(C1).manualRating, 4);
  eq(await S.setOverride(C1, 4, ''), { ok: false, reason: 'invalid', message: 'اكتب السبب' });
});

test('merge: the rpc, the conversations re-pointed, the list and the kept customer\'s notes / ratings read again', async () => {
  const { S, stub, logs } = load({ responses: { 'rpc:cs_merge_customers': ok(C1), cs_customer_notes: ok([{ id: 1, customer_id: C1, text: 'a', author: ME, at: iso(0) }, { id: 2, customer_id: C1, text: 'b', author: ME, at: iso(DAY) }]) } });
  await S.load();
  S.conv(K1).who = C2;
  const r = await S.merge(C1, C2);
  assert.equal(r.ok, true); eq(stub.calls.find((c) => c.op === 'rpc' && c.args[0] === 'cs_merge_customers').args[1], { p_keep: C1, p_other: C2 });
  assert.equal(S.conv(K1).who, C1); assert.equal(S.customer(C1).notes.length, 2); eq(S.customer(C1).channels, ['whatsapp']);
  eq(logs.at(-1).slice(0, 2), ['cs.merge', C2 + ' → ' + C1]);
  const deny = load({ responses: { 'rpc:cs_merge_customers': { data: null, error: { code: '42501' } } } }); await deny.S.load();
  eq(await deny.S.merge(C1, C2), { ok: false, reason: 'forbidden' });
  const miss = load({ responses: { 'rpc:cs_merge_customers': { data: null, error: { code: 'P0002' } } } }); await miss.S.load();
  eq(await miss.S.merge(C1, C2), { ok: false, reason: 'notfound' });
});

test('segments: save (insert / update with the rules\' columns, validated by IbtekrCS) and delete; the campaigns follow the name', async () => {
  const { S, stub, logs } = load({ responses: { cs_segments: (q) => { const w = q.find((c) => c.op === 'insert' || c.op === 'update'); if (!w) return ok([SEG]); if (q.some((c) => c.op === 'delete')) return ok([{ id: G1 }]); return ok([{ ...SEG, id: w.op === 'insert' ? 'g2' : G1, ...w.args[0] }]); } } });
  await S.load();
  const r = await S.saveSegment({ name: ' محتاجين متابعة ', minTotal: '', minOrders: '2', moods: ['متضايق', 'x'], last: 'range', lastFrom: '2026-10-01', lastTo: '2026-10-31', ranges: { manners: [1, 3] }, includeUnrated: true, add: [], remove: [C1] });
  assert.equal(r.ok, true); assert.equal(r.segment.id, 'g2');
  eq(inserted(stub, 'cs_segments')[0], { name: 'محتاجين متابعة', min_total: null, min_orders: 2, moods: ['متضايق'], last_kind: 'range', last_from: '2026-10-01', last_to: '2026-10-31', ranges: { manners: [1, 3] }, include_unrated: true, add_ids: [], remove_ids: [C1] });
  assert.equal(S.data.segments.length, 2); assert.equal(logs.at(-1)[0], 'cs.segment.add');
  const up = await S.saveSegment({ ...S.data.segments.find((s) => s.id === G1), name: 'VIP' }); assert.equal(up.ok, true); assert.equal(S.data.campaigns[0].seg, 'VIP'); assert.equal(logs.at(-1)[0], 'cs.segment.edit');
  const bad = await S.saveSegment({ name: 'VIP' }); assert.equal(bad.ok, false); assert.equal(bad.reason, 'invalid'); eq(bad.errors, { name: 'الاسم موجود' });
  const del = load({ responses: { cs_segments: (q) => (q.some((c) => c.op === 'delete') ? ok([{ id: G1 }]) : ok([SEG])) } }); await del.S.load();
  eq(await del.S.deleteSegment(G1), { ok: true }); eq(del.S.data.segments, []); assert.equal(del.S.data.campaigns[0].segId, null);
  eq(opsOf(del.stub.calls, 'cs_segments').filter((c) => c.op === 'delete' || c.op === 'eq').slice(-2), [{ op: 'delete', args: [] }, { op: 'eq', args: ['id', G1] }]);
});

test('campaigns: a draft / a schedule (never another status from here), setCampaignStatus, delete; invalid without a name, a channel or a schedule time', async () => {
  const { S, stub, logs } = load({ responses: { cs_campaigns: (q) => { const w = q.find((c) => c.op === 'insert' || c.op === 'update'); if (q.some((c) => c.op === 'delete')) return ok([{ id: CAMP.id }]); if (!w) return ok([CAMP]); return ok([{ ...CAMP, id: w.op === 'insert' ? 'k2' : CAMP.id, ...w.args[0], stats: {} }]); } } });
  await S.load();
  const r = await S.saveCampaign({ name: ' الجمعة البيضاء ', segId: G1, channel: 'wa1', body: 'خصم', discountCode: ' BF ', scheduledAt: '2026-11-20T17:00:00Z', capPerDay: 200, minDelayS: 30, status: 'مجدولة', size: 1930 });
  assert.equal(r.ok, true); assert.equal(r.campaign.id, 'k2'); assert.equal(r.campaign.seg, 'VIP راضيين'); assert.match(r.campaign.sub, /^مجدولة 20 نوفمبر /);
  eq(inserted(stub, 'cs_campaigns')[0], { name: 'الجمعة البيضاء', segment_id: G1, channel: 'wa1', body: 'خصم', image_path: null, discount_code: 'BF', scheduled_at: '2026-11-20T17:00:00Z', cap_per_day: 200, min_delay_s: 30, status: 'مجدولة', size: 1930 });
  eq(logs.at(-1).slice(0, 2), ['cs.campaign.add', 'الجمعة البيضاء · مجدولة · 1930']); assert.ok(!JSON.stringify(logs).includes('خصم'));
  const run = await S.saveCampaign({ name: 'x', channel: 'wa1', status: 'شغالة' }); assert.equal(inserted(stub, 'cs_campaigns').at(-1).status, 'مسودة'); assert.equal(run.ok, true);
  await S.setCampaignStatus(CAMP.id, 'متوقفة'); eq(opsOf(stub.calls, 'cs_campaigns').filter((c) => c.op === 'update').at(-1).args[0].status, 'متوقفة');
  eq(await S.saveCampaign({ name: '', channel: 'wa1' }), { ok: false, reason: 'invalid', field: 'name' });
  eq(await S.saveCampaign({ name: 'x', channel: 'tiktok' }), { ok: false, reason: 'invalid', field: 'channel' });
  eq(await S.saveCampaign({ name: 'x', channel: 'wa1', status: 'مجدولة' }), { ok: false, reason: 'invalid', field: 'scheduledAt' });
  eq(await S.deleteCampaign(CAMP.id), { ok: true }); assert.ok(!S.data.campaigns.some((k) => k.id === CAMP.id));
});

test('settings: the admin upserts the row «cs»; others are forbidden; warn below late', async () => {
  const other = load(); await other.S.load();
  eq(await other.S.saveSettings({ routing: 'auto' }), { ok: false, reason: 'forbidden' });
  const { S, stub, logs } = load({ admin: true }); await S.load();
  const r = await S.saveSettings({ routing: 'auto', slaWarn: 8, slaLate: 12, hours: '10 ص – 10 م', autoCloseDays: 5 });
  assert.equal(r.ok, true);
  const up = opsOf(stub.calls, 'settings').find((c) => c.op === 'upsert');
  eq(up.args, [{ section: 'cs', data: { routing: 'auto', sla_warn: 8, sla_late: 12, hours: '10 ص – 10 م', auto_close_days: 5, live: { wa: false, campaigns: false } } }, { onConflict: 'section' }]);
  eq(plain(S.data.settings), { routing: 'auto', slaWarn: 8, slaLate: 12, hours: '10 ص – 10 م', autoCloseDays: 5, live: { wa: false, campaigns: false } }); assert.equal(logs.at(-1)[0], 'cs.settings');
  eq(await S.saveSettings({ slaWarn: 20, slaLate: 10 }), { ok: false, reason: 'invalid', field: 'slaLate' });
});

test('subscribe: one channel on cs_conversations / cs_messages (INSERT + UPDATE); a change → one load() after a moment; clear() unsubscribes; a throwing channel is ignored', async () => {
  const { S, stub } = load();
  await S.load(); const before = stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length;
  S.subscribe(); S.subscribe();
  eq(stub.calls.filter((c) => c.op === 'channel').map((c) => c.args[0]), ['cs', 'cs-inbox'], 'the postgres changes channel + the live broadcast line (0038), once each');
  eq(stub.calls.find((c) => c.op === 'channel' && c.args[0] === 'cs-inbox').args[1], { config: { private: true } }, '0039: a private channel');
  eq(stub.calls.filter((c) => c.op === 'on').map((c) => c.args[0] + ':' + (c.args[1].table || '') + ':' + c.args[1].event), ['postgres_changes:cs_conversations:INSERT', 'postgres_changes:cs_conversations:UPDATE', 'postgres_changes:cs_messages:INSERT', 'postgres_changes:cs_messages:UPDATE', 'broadcast::changed']);
  await stub.emitChange({ table: 'cs_messages', eventType: 'INSERT', new: { id: 'x' } }); await stub.emitChange({ table: 'cs_conversations', eventType: 'UPDATE', new: { id: K1 } });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length, before + 1, 'one load for the two changes');
  // the live line: a database broadcast «changed» → one load() a moment later (two quick ones → still one)
  const mid = stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length;
  await stub.emitBroadcast('changed', { at: 'x' }); await stub.emitBroadcast('changed', { at: 'y' });
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length, mid + 1, 'one load for the two broadcasts');
  S.clear(); assert.equal(stub.calls.filter((c) => c.op === 'removeChannel').length, 2, 'both channels closed'); eq(S.data.customers, []); assert.equal(S.state(), 'idle');
  const t = load({ channelThrows: true }); t.S.subscribe(); assert.equal(t.stub.calls.filter((c) => c.op === 'subscribe').length, 0);
});

test('6.2 — send on a connected Meta channel: the queued row then cs-channel send → sent; a refusal → failed + a message; commentPrivate / commentHide; connectStart (the admin) → the Facebook url; channelStatus merges the channels; a WhatsApp conversation never calls the function', async () => {
  const K3 = 'd0000000-0000-4000-8000-000000000003'; const K4 = 'd0000000-0000-4000-8000-000000000004';
  const CHANS_ON = CHANS.map((c) => (c.id === 'messenger' ? { ...c, status: 'connected', number: 'Ibtekr Club', since: iso(DAY) } : c));
  const CONVS2 = CONVS.concat([
    { id: K3, seg: 'customers', platform: 'messenger', channel: 'messenger', customer_id: C1, vendor_id: null, handle: null, external_id: '900', status: 'مستنية ردنا', assignee: null, outcome: null, tags: [], last_in_at: iso(3600e3), last_out_at: null, waiting_since: iso(3600e3), unread: 1, created_at: iso(3600e3), updated_at: iso(3600e3) },
    { id: K4, seg: 'comments', platform: 'facebook', channel: 'messenger', customer_id: null, vendor_id: null, handle: 'Noha H', external_id: '111_p1:42', status: 'جديدة', assignee: null, outcome: null, tags: [], last_in_at: iso(1800e3), last_out_at: null, waiting_since: iso(1800e3), unread: 1, created_at: iso(1800e3), updated_at: iso(1800e3) }]);
  const calls = []; let refuse = false; let seq = 20;
  const fnFail = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });
  const { S, stub, logs } = load({ admin: true, responses: { cs_channels: ok(CHANS_ON), cs_conversations: ok(CONVS2),
    cs_messages: (q) => { const ins = q.find((c) => c.op === 'insert'); return ins ? ok([{ id: 'm' + (seq += 1), conversation_id: ins.args[0].conversation_id, kind: ins.args[0].kind, text: ins.args[0].text, author: ME, delivery: ins.args[0].kind === 'out' ? 'queued' : null, meta: ins.args[0].meta, created_at: iso(0) }]) : ok(MSGS); },
    'fn:cs-channel': (opts) => { const b = opts.body; calls.push(b);
      if (b.action === 'status') return { data: { result: 'ok', linked: true, channels: [{ id: 'messenger', status: 'connected', number: 'Ibtekr Club', since: iso(DAY), last_message_at: iso(60e3) }, { id: 'instagram', status: 'disconnected', number: null, since: null, last_message_at: null }], configured: true, verify_configured: false, redirect: 'https://operation-system.ibtekr.club/meta-callback.html', webhook_url: 'https://x.supabase.co/functions/v1/cs-channel', page: { id: '111', name: 'Ibtekr Club', ig: null } }, error: null };
      if (b.action === 'connect_start') return { data: { result: 'ok', url: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1&state=s', channel: b.channel }, error: null };
      if (b.action === 'comment_hide') return { data: { result: 'ok', hidden: '111_c1' }, error: null };
      if (refuse) return fnFail(502, { error: 'graph_10:2018278', status: 400, delivery: 'failed' });
      return { data: { result: 'ok', delivery: 'sent', external_id: 'm_x', private: b.action === 'comment_private' }, error: null }; } } });
  await S.load();
  assert.equal(S.metaChannel(S.conv(K3)), true); assert.equal(S.metaConnected(S.conv(K3)), true); assert.equal(S.metaChannel(S.conv(K1)), false);
  const r = await S.send(K3, 'في الطريق');
  assert.equal(r.ok, true); assert.equal(r.delivery, 'sent'); assert.equal(S.conv(K3).msgs.at(-1).delivery, 'sent');
  eq(calls.at(-1), { action: 'send', message_id: 'm21' });
  refuse = true;
  const bad = await S.send(K3, 'متأخر');
  assert.equal(bad.ok, false); assert.equal(bad.reason, 'invalid'); assert.equal(bad.code, 'graph_10:2018278'); assert.match(bad.message, /Meta رفضتها/);
  assert.equal(S.conv(K3).msgs.at(-1).delivery, 'failed');
  refuse = false;
  const n = calls.length; await S.send(K1, 'واتساب'); assert.equal(calls.length, n, 'a WhatsApp conversation (not connected) never calls the function');
  const pr = await S.commentPrivate(K4, 'على الخاص');
  assert.equal(pr.ok, true); eq(calls.at(-1), { action: 'comment_private', message_id: 'm24' }); eq(inserted(stub, 'cs_messages').at(-1).meta, { private: true });
  eq(await S.commentPrivate(K3, 'x'), { ok: false, reason: 'invalid' });
  const hd = await S.commentHide(K4);
  assert.equal(hd.ok, true); assert.equal(hd.hidden, '111_c1'); eq(calls.at(-1), { action: 'comment_hide', conversation_id: K4 }); eq(logs.at(-1).slice(0, 2), ['cs.channel.hide', 'facebook']);
  const cs = await S.connectStart('instagram');
  assert.equal(cs.ok, true); assert.match(cs.url, /^https:\/\/www\.facebook\.com\//); eq(calls.at(-1), { action: 'connect_start', channel: 'instagram' });
  const st = await S.channelStatus();
  eq([st.linked, st.configured, st.verifyConfigured, st.page.name], [true, true, false, 'Ibtekr Club']);
  assert.equal(S.data.channels.messenger.last, 'آخر رسالة: ' + S.clock(Date.now() - 60e3));
  assert.ok(!JSON.stringify(logs).includes('في الطريق'), 'no text in the log');
  const member = load({ admin: false, responses: { 'fn:cs-channel': () => ({ data: { result: 'ok', url: 'https://www.facebook.com/x' }, error: null }) } });
  await member.S.load();
  eq(await member.S.connectStart('messenger'), { ok: false, reason: 'forbidden' });
  eq(await member.S.disconnect(), { ok: false, reason: 'forbidden' });
});

test('the safety net: check() reads the newest conversation; newer than what is loaded → one load(), else nothing; not before ready', async () => {
  let newest = null;
  const { S, stub } = load({ responses: { cs_conversations: (q) => (q.some((c) => c.op === 'limit') ? ok(newest ? [{ updated_at: newest }] : []) : ok(CONVS)) } });
  assert.equal(await S.check(), false, 'not loaded yet');
  await S.load(); const before = stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length;
  const mine = Math.max(...CONVS.map((r) => Date.parse(r.updated_at || r.created_at)));
  newest = new Date(mine).toISOString();
  assert.equal(await S.check(), false, 'the same moment: nothing new'); assert.equal(stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length, before);
  newest = new Date(mine + 60000).toISOString();
  assert.equal(await S.check(), true, 'a newer conversation: one reload'); assert.equal(stub.calls.filter((c) => c.op === 'rpc' && c.args[0] === 'cs_customers_list').length, before + 1);
  newest = null; assert.equal(await S.check(), false, 'no answer: nothing');
});

test('decisions 23–24: settings «cs».live is read (hidden by default) and kept by the settings form; scheduleCampaign needs cs.manage and calls cs_campaign_schedule', async () => {
  const { S } = load({ admin: true }); await S.load();
  eq(plain(S.DEFAULT_SETTINGS.live), { wa: false, campaigns: false });
  assert.equal(typeof S.scheduleCampaign, 'function'); assert.equal(typeof S.waStatus, 'function'); assert.equal(typeof S.waLogout, 'function');
  eq(await S.waLogout('wa9'), { ok: false, reason: 'invalid' });
  assert.equal((await S.scheduleCampaign('c0000000-0000-4000-8000-000000000001', [], null)).ok, false);
});

// ---------- phase 6.5 (0058): the auto-reply page's data — templates · quick replies · rules · the sending settings ----------
const T1 = 'f1000000-0000-4000-8000-000000000001'; const R1 = 'f2000000-0000-4000-8000-000000000001'; const Q1 = 'f3000000-0000-4000-8000-000000000001';
const TPL = { id: T1, lib: 'customers', name: 'تأكيد الأوردر', cat: 'حالة الأوردر', tone: 'brand', body: 'أهلاً {اسم_العميل} أوردرك {رقم_الأوردر} اتأكد.', trig_kind: 'auto', trig_on: ['جاري التنفيذ'], trig_when: 'فورًا', channels: 'كل القنوات', quick_key: '/تأكيد', wa_template: 'order_confirmed_v1', wa_vars: ['اسم_العميل', 'رقم_الأوردر'], used: 12, active: true, created_at: '2026-11-08T08:00:00Z', updated_at: null };
const RULE = { id: R1, name: 'تأكيد الأوردر', grp: 'العملاء — حالة الأوردر', event: 'status', event_to: 'جاري التنفيذ', conds: [['القناة', '=', 'واتساب 1']], action: 'send', template_id: T1, role_id: null, tag: null, delay_min: 5, once: true, ticket_if_silent: true, enabled: true, runs: 3, last_run_at: iso(3600e3), created_at: '2026-11-08T08:00:00Z', updated_at: null };
const QUICK = { id: Q1, key: '/شحن', label: 'مواعيد الشحن', text: 'الشحن 2–3 أيام.', created_at: '2026-11-08T08:00:00Z', updated_at: null };
const AUTO_RESP = { cs_templates: ok([TPL]), cs_quick_replies: ok([QUICK]), cs_auto_rules: ok([RULE]), 'rpc:cs_auto_settings': ok({ live: true, hours: { from: 10, to: 23 }, delayMin: 20, delayMax: 60, daily: { wa1: 300, wa2: 150 }, afterHoursText: 'نرد بكرة', cart: { afterMin: 90 } }) };
function loadAuto(extra = {}) { return load({ admin: true, responses: Object.assign({}, AUTO_RESP, extra.responses || {}), perms: extra.perms || BASE_PERMS }); }

test('6.5 load: templates / quick replies / rules → the prototype shapes (trigger text, key, logic, stats), the sending settings from the rpc; a missing table leaves them empty', async () => {
  const { S } = loadAuto(); await S.load();
  const t = plain(S.data.templates[0]);
  eq([t.id, t.lib, t.name, t.key, t.waTemplate, t.waVars, t.used, t.active, t.draft, t.trigKind, t.trigOn], [T1, 'customers', 'تأكيد الأوردر', '/تأكيد', 'order_confirmed_v1', ['اسم_العميل', 'رقم_الأوردر'], 12, true, false, 'auto', ['جاري التنفيذ']]);
  eq(plain(S.data.quick), [{ id: Q1, key: '/شحن', label: 'مواعيد الشحن', text: 'الشحن 2–3 أيام.' }]);
  const r = plain(S.data.rules[0]);
  eq([r.id, r.group, r.event, r.to, r.conds, r.action, r.tpl, r.tplName, r.delayMin, r.once, r.ticket, r.on, r.runs], [R1, 'العملاء — حالة الأوردر', 'status', 'جاري التنفيذ', [['القناة', '=', 'واتساب 1']], 'send', T1, 'تأكيد الأوردر', 5, true, true, true, 3]);
  assert.equal(r.logic, 'لما: الأوردر بقى «جاري التنفيذ» والقناة = واتساب 1 ← ابعت قالب «تأكيد الأوردر» · بعد 5 دقايق · مرة واحدة · مردّش 24 ساعة → تذكرة');
  assert.match(r.stats, /^اتنفذت 3 مرة · آخر مرة /);
  eq(plain(S.data.auto), { live: true, hours: { from: 10, to: 23 }, delayMin: 20, delayMax: 60, daily: { wa1: 300, wa2: 150 }, afterHoursText: 'نرد بكرة', cart: { afterMin: 90 } });
  eq(plain(S.quickList()), [{ key: '/شحن', label: 'مواعيد الشحن', text: 'الشحن 2–3 أيام.', kind: 'quick' }, { key: '/تأكيد', label: 'تأكيد الأوردر', text: TPL.body, kind: 'template', id: T1 }]);
  const bare = load({ responses: { cs_templates: { data: null, error: { code: '42P01' } }, 'rpc:cs_auto_settings': { data: null, error: { code: '42883' } } } }); await bare.S.load();
  assert.equal(bare.S.state(), 'ready'); eq(bare.S.data.templates, []); eq(plain(bare.S.data.auto), plain(bare.S.DEFAULT_AUTO));
});

test('6.5 templates: the validation, the columns written, a taken key, delete refused while a rule sends it', async () => {
  const { S, stub, logs } = loadAuto({ responses: { cs_templates: (q) => (q.some((c) => c.op === 'insert') ? ok([Object.assign({}, TPL, { id: 'f1000000-0000-4000-8000-000000000002', name: 'تم الشحن', quick_key: '/تتبع' })]) : ok([TPL])) } }); await S.load();
  eq(await S.saveTemplate({ lib: 'customers', name: '', body: 'x' }), { ok: false, reason: 'invalid', errors: { name: 'اكتب اسم القالب' } });
  eq((await S.saveTemplate({ lib: 'customers', name: 'x', body: 'y', trigKind: 'auto', trigOn: [], cat: 'متابعة' })).errors, { trigOn: 'اختار مشغّل واحد على الأقل' });
  eq((await S.saveTemplate({ lib: 'customers', name: 'x', body: 'y', key: 'تتبع' })).errors, { key: 'الاختصار لازم يبدأ بـ / وبعده كلمة من غير مسافات' });
  eq((await S.saveTemplate({ lib: 'customers', name: 'x', body: 'y', waTemplate: 'Order Shipped' })).errors, { waTemplate: 'اسم قالب Meta: حروف إنجليزي صغيرة وأرقام و_ بس' });
  eq((await S.saveTemplate({ lib: 'customers', name: 'x', body: 'y {رقم_الأوردر}', waTemplate: 'shipped_v1', waVars: ['اسم_العميل'] })).errors, { waVars: 'المتغير {اسم_العميل} مش في النص' });
  const r = await S.saveTemplate({ lib: 'customers', name: ' تم الشحن ', cat: 'حالة الأوردر', body: 'أوردرك {رقم_الأوردر} اتشحن {رابط_التتبع}', trigKind: 'auto', trigOn: ['قيد الشحن'], trigWhen: 'فورًا', key: '/تتبع', waTemplate: 'shipped_v1', waVars: ['رقم_الأوردر', 'رابط_التتبع'] });
  assert.equal(r.ok, true); assert.equal(S.data.templates.length, 2);
  eq(inserted(stub, 'cs_templates')[0], { lib: 'customers', name: 'تم الشحن', cat: 'حالة الأوردر', tone: 'brand', body: 'أوردرك {رقم_الأوردر} اتشحن {رابط_التتبع}', trig_kind: 'auto', trig_on: ['قيد الشحن'], trig_when: 'فورًا', channels: 'كل القنوات', quick_key: '/تتبع', wa_template: 'shipped_v1', wa_vars: ['رقم_الأوردر', 'رابط_التتبع'], active: true });
  eq(logs.at(-1).slice(0, 2), ['cs.template.add', 'customers · تم الشحن']);
  eq(await S.deleteTemplate(T1), { ok: false, reason: 'in_use' }, 'the rule sends it');
  const dup = load({ admin: true, responses: Object.assign({}, AUTO_RESP, { cs_templates: (q) => (q.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505' } } : ok([TPL])) }) }); await dup.S.load();
  eq(await dup.S.saveTemplate({ lib: 'customers', name: 'x', body: 'y', key: '/تأكيد' }), { ok: false, reason: 'invalid', errors: { key: 'الاختصار ده مستخدم في قالب تاني' } });
  const ops = load({ perms: Object.assign({}, BASE_PERMS, { 'cs.manage': 'N' }), responses: AUTO_RESP }); await ops.S.load();
  eq(await ops.S.saveTemplate({ lib: 'customers', name: 'x', body: 'y' }), { ok: false, reason: 'forbidden' });
});

test('6.5 quick replies and rules: the validation, the columns, the toggle, the delete; a rule without a template only for after-hours', async () => {
  const { S, stub, logs } = loadAuto({ responses: { cs_quick_replies: (q) => (q.some((c) => c.op === 'insert') ? ok([Object.assign({}, QUICK, { id: 'f3000000-0000-4000-8000-000000000002', key: '/دفع' })]) : ok([QUICK])),
    cs_auto_rules: (q) => (q.some((c) => c.op === 'insert') ? ok([Object.assign({}, RULE, { id: 'f2000000-0000-4000-8000-000000000002', name: 'خارج المواعيد', grp: 'العملاء — المحادثات', event: 'afterhours', event_to: null, conds: [], template_id: null, delay_min: 0, ticket_if_silent: false, enabled: false, runs: 0, last_run_at: null })]) : q.some((c) => c.op === 'update') ? ok([Object.assign({}, RULE, { enabled: false })]) : ok([RULE])) } }); await S.load();
  eq((await S.saveQuick({ key: 'دفع', label: '', text: '' })).errors, { key: 'الاختصار لازم يبدأ بـ / وبعده كلمة', label: 'اكتب الوصف', text: 'اكتب النص' });
  assert.equal((await S.saveQuick({ key: '/دفع', label: 'طرق الدفع', text: 'كاش أو لينك دفع.' })).ok, true); eq(inserted(stub, 'cs_quick_replies')[0], { key: '/دفع', label: 'طرق الدفع', text: 'كاش أو لينك دفع.' });
  eq((await S.saveRule({ name: '', event: 'status', to: '', action: 'send', tpl: '' })).errors, { name: 'اكتب اسم القاعدة', to: 'اختار الحالة', tpl: 'اختار القالب' });
  eq((await S.saveRule({ name: 'x', event: 'first', action: 'assign' })).errors, { roleId: 'اختار الدور' });
  eq((await S.saveRule({ name: 'x', event: 'first', action: 'ticket', conds: [['القناة', '=']] })).errors, { conds: 'كل شرط لازم يبقى حقل وعلاقة وقيمة' });
  const r = await S.saveRule({ name: 'خارج المواعيد', group: 'العملاء — المحادثات', event: 'afterhours', action: 'send', tpl: '', conds: [], delayMin: 0, once: true, ticket: false, on: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  eq(inserted(stub, 'cs_auto_rules')[0], { name: 'خارج المواعيد', grp: 'العملاء — المحادثات', event: 'afterhours', event_to: null, conds: [], action: 'send', template_id: null, role_id: null, tag: null, delay_min: 0, once: true, ticket_if_silent: false, enabled: false });
  assert.equal(S.data.rules.length, 2); assert.equal(S.data.rules[1].logic, 'لما: رسالة خارج مواعيد العمل ← ابعت قالب «نص خارج المواعيد» · فوراً (في مواعيد الإرسال) · مرة واحدة'); assert.equal(S.data.rules[1].stats, 'متوقفة');
  eq(logs.at(-1).slice(0, 2), ['cs.rule.add', 'afterhours → send · خارج المواعيد · متوقفة']);
  const t = await S.setRuleOn(R1, false); assert.equal(t.ok, true); assert.equal(S.data.rules[0].on, false);
  eq(opsOf(stub.calls, 'cs_auto_rules').filter((c) => c.op === 'update').at(-1).args[0], { enabled: false }); eq(logs.at(-1).slice(0, 2), ['cs.rule.toggle', 'تأكيد الأوردر · وقفت']);
  assert.equal((await S.deleteRule(R1)).ok, true); assert.equal(S.data.rules.length, 1); assert.equal((await S.deleteQuick(Q1)).ok, true);
});

test('6.5 the sending settings: the admin merges «auto» into the row and keeps the other keys; live is its own switch; saveSettings keeps «auto»; the engine calls', async () => {
  const member = load({ responses: AUTO_RESP }); await member.S.load();
  eq(await member.S.saveAutoSettings({ delayMin: 30 }), { ok: false, reason: 'forbidden' }); eq(await member.S.setAutoLive(true), { ok: false, reason: 'forbidden' }); eq(await member.S.autoTick(), { ok: false, reason: 'forbidden' });
  const { S, stub, logs } = loadAuto({ responses: { settings: ok({ data: { routing: 'manual', sla_warn: 5, sla_late: 20, auto: { live: false, daily: { wa1: 200, wa2: 150 } } } }), 'fn:cs-auto': (o) => ({ data: { result: o.body.dry ? 'dry' : 'ok', live: true, events: 2 }, error: null }) } }); await S.load();
  eq(await S.saveAutoSettings({ delayMin: 10 }), { ok: false, reason: 'invalid', field: 'delayMin' });
  const r = await S.saveAutoSettings({ hours: { from: 9, to: 21 }, daily: { wa1: 280, wa2: 100 }, afterHoursText: ' هنرد الصبح ' });
  assert.equal(r.ok, true);
  const up = opsOf(stub.calls, 'settings').filter((c) => c.op === 'upsert').at(-1);
  eq(up.args[0].data.routing, 'manual'); eq(up.args[0].data.sla_warn, 5); eq(up.args[0].data.auto, { live: true, hours: { from: 9, to: 21 }, delayMin: 20, delayMax: 60, daily: { wa1: 280, wa2: 100 }, afterHoursText: 'هنرد الصبح', cart: { afterMin: 90 } }, 'live stays what the rpc said (true) — this form never flips it');
  eq(logs.at(-1).slice(0, 2), ['cs.auto.settings', 'hours, daily, afterHoursText']);
  eq(await S.setAutoLive(false), { ok: true, live: false }); assert.equal(S.data.auto.live, false); eq(logs.at(-1).slice(0, 2), ['cs.auto.live', 'off']);
  const s = await S.saveSettings({ routing: 'auto', slaWarn: 8, slaLate: 12, hours: '10 ص – 10 م', autoCloseDays: 5 }); assert.equal(s.ok, true);
  const up2 = opsOf(stub.calls, 'settings').filter((c) => c.op === 'upsert').at(-1); eq(up2.args[0].data.auto.live, false); eq(up2.args[0].data.auto.daily, { wa1: 280, wa2: 100 }, 'the other form keeps the auto-reply keys');
  const st = await S.autoStatus(); eq([st.ok, st.live], [true, true]);
  const run = await S.autoTick(true); eq([run.ok, run.result, run.events], [true, 'dry', 2]); eq(logs.at(-1).slice(0, 2), ['cs.auto.tick', 'dry']);
  eq(stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args), [['cs-auto', { body: { action: 'status' } }], ['cs-auto', { body: { action: 'tick', dry: true } }]]);
});
