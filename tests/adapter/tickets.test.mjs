import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// tickets.js (phase 8, 0045) against a stub IBSupabase: the tickets and their recent timeline → the v2 domain's shapes; the writes
// through ticket_create / ticket_act (and the refetch after), the errors in Arabic, the roles behind canWork / canClose, the files
// (the member's own folder, images / PDF ≤ 10 MB), the links (order / maker / customer / conversation) and the live line.
const src = readFileSync(new URL('../../app/js/adapter/tickets.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const ok = (data) => ({ data, error: null });
const ME = 'u1'; const OTHER = 'u2'; const V1 = 'a0000000-0000-4000-8000-000000000001'; const CC = 'c0000000-0000-4000-8000-000000000001'; const CV = 'c0000000-0000-4000-8000-000000000009';
const row = (o) => ({ id: 1, type: 'customer', title: 'فرق شحن', description: 'اتحاسب 100', priority: 'high', assignee_role: 'الحسابات', order_number: '177611', order_id: 177611, customer: 'هالة',
  cs_customer_id: CC, cs_conversation_id: CV, vendor_id: null, vendor: null, reason: 'أخرى', follow_up: '2026-11-08', attachments: [{ path: OTHER + '/a-x.png', name: 'صورة', type: 'image/png', size: 12 }],
  status: 'open', created_by: OTHER, created_by_name: 'سارة', created_by_role: 'خدمة العملاء', created_at: '2026-11-05T08:00:00Z', last_update: '2026-11-05T09:00:00Z', reopen_count: 0,
  resolution_outcome: null, resolution_note: null, resolved_by_name: null, resolved_at: null, closed_by_name: null, closed_at: null, ...o });
const TICKETS = [row({}), row({ id: 2, type: 'vendor', title: 'المبتكر مابيردش', assignee_role: 'اللوجستيك والشحن', order_number: null, order_id: null, customer: null, cs_customer_id: null, cs_conversation_id: null,
  vendor_id: V1, vendor: 'HANDS', reason: 'مش بيرد', status: 'resolved', created_by: ME, created_by_name: 'منى', created_by_role: 'الحسابات', resolution_outcome: 'مكرر', resolution_note: 'اتكررت', resolved_by_name: 'كريم', resolved_at: '2026-11-05T10:00:00Z', attachments: [] })];
const EVENTS = [
  { id: 2, ticket_id: 1, kind: 'message', at: '2026-11-05T08:00:01Z', actor: OTHER, actor_name: 'سارة', actor_role: 'خدمة العملاء', text: 'اتحاسب 100', old_value: null, new_value: null, attachments: [] },
  { id: 1, ticket_id: 1, kind: 'event', at: '2026-11-05T08:00:00Z', actor: OTHER, actor_name: 'سارة', actor_role: 'خدمة العملاء', text: 'سارة أنشأ التذكرة وعيّنها لدور «الحسابات»', old_value: null, new_value: null, attachments: [] },
];
function load({ responses = {}, perms = { 'tickets.view': 'F', 'tickets.manage': 'F' }, role = 'accounts', realtime = false } = {}) {
  const stub = stubClient({ responses: { tickets: ok(TICKETS), ticket_events: ok(EVENTS), ...responses } });
  const events = []; const logs = [];
  const window = { IBSupabase: { client: stub.client }, IB_CONFIG: { realtime },
    IBDirectory: { perm: (k) => perms[k] || 'N', me: () => ({ id: ME, name: 'منى', role_id: role, status: 'active' }) },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBVendors: { store: { findByName: (n) => (n === 'HANDS' ? { id: V1 } : null) } }, crypto: { randomUUID: () => 'abcdef12-0000-4000-8000-000000000000' } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); }, visibilityState: 'visible' }, CustomEvent: class { constructor(t) { this.type = t; } },
    Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, Error, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {} });
  return { T: window.IBTickets, stub, events, logs };
}
const rpcs = (stub) => stub.calls.filter((c) => c.op === 'rpc').map((c) => c.args);

test('load: the tickets in the v2 shapes (TKT-0001, createdBy, resolution) and the recent timeline oldest first', async () => {
  const { T, stub, events } = load();
  eq((await T.load()).ok, true);
  const a = T.get('TKT-0001');
  eq([a.id, a.dbId, a.assigneeRole, a.orderId, a.followUp, a.createdBy, a.resolution, a.attachments[0].name], ['TKT-0001', 1, 'الحسابات', '177611', '2026-11-08', { name: 'سارة', role: 'خدمة العملاء', uid: OTHER }, null, 'صورة']);
  eq(T.get('TKT-0002').resolution, { outcome: 'مكرر', note: 'اتكررت', by: 'كريم', at: '2026-11-05T10:00:00Z' });
  eq(T.events('TKT-0001').map((e) => [e.kind, e.id]), [['event', 1], ['message', 2]]);
  eq(T.events('TKT-0001')[1].author, { name: 'سارة', role: 'خدمة العملاء' });
  const evq = opsOf(stub.calls, 'ticket_events'); assert(evq.some((c) => c.op === 'gte' && c.args[0] === 'at'));
  assert(events.includes('ib:tickets'));
  eq(T.all().length, 2);
});

test('without tickets.view nothing is read', async () => {
  const { T, stub } = load({ perms: {} });
  eq((await T.load()).ok, true); eq(T.all(), []); eq(opsOf(stub.calls, 'tickets').length, 0);
});

test('the roles: canWork = the admin or a member of the assigned role (ops holds two); canClose = the admin or the opener', async () => {
  const acc = load(); await acc.T.load();
  eq([acc.T.canWork(acc.T.get('TKT-0001')), acc.T.canClose(acc.T.get('TKT-0001')), acc.T.canWork(acc.T.get('TKT-0002')), acc.T.canClose(acc.T.get('TKT-0002'))], [true, false, false, true]);
  const ops = load({ role: 'ops' }); await ops.T.load();
  eq(ops.T.myRoles(), ['اللوجستيك والشحن', 'المحتوى والتصوير']);
  eq([ops.T.canWork(ops.T.get('TKT-0002')), ops.T.isMine(ops.T.get('TKT-0002'))], [true, true]);
  const adm = load({ role: 'admin' }); await adm.T.load();
  eq([adm.T.canWork(adm.T.get('TKT-0001')), adm.T.canClose(adm.T.get('TKT-0001')), adm.T.actor().role], [true, true, 'مدير النظام']);
  const view = load({ role: 'viewer', perms: { 'tickets.view': 'P' } }); await view.T.load();
  eq([view.T.canWork(view.T.get('TKT-0001')), view.T.can().manage], [false, false]);
});

test('create: ticket_create with the v2 form (the maker by name → its id), the activity row without text, the ticket refetched', async () => {
  const { T, stub, logs } = load({ responses: { 'rpc:ticket_create': ok(7) } });
  await T.load();
  const more = TICKETS.concat([row({ id: 7, type: 'vendor', vendor_id: V1, vendor: 'HANDS', title: 'تأخير' })]);
  stub.responses.tickets = (q) => { const f = q.find((c) => c.op === 'eq' && c.args[0] === 'id'); return ok(f ? more.filter((t) => t.id === f.args[1]) : more); };
  const r = await T.create({ type: 'vendor', title: 'تأخير', description: 'سر الوصف', priority: 'normal', assigneeRole: 'متابعة المبتكرين', vendor: 'HANDS', reason: 'تأخير تسليم', orderId: '', followUp: '' });
  eq(r, { ok: true, id: 'TKT-0007' });
  eq(rpcs(stub).at(-1), ['ticket_create', { p_input: { type: 'vendor', title: 'تأخير', description: 'سر الوصف', priority: 'normal', assigneeRole: 'متابعة المبتكرين', reason: 'تأخير تسليم', followUp: null, attachments: [], vendorId: V1 } }]);
  eq(logs.at(-1), ['ticket.create', 'TKT-0007 · vendor · متابعة المبتكرين', { entity: 'ticket', entity_id: 'TKT-0007' }]);
  assert(!JSON.stringify(logs).includes('سر الوصف'));
  assert(T.get('TKT-0007'));
});

test('the actions go to ticket_act by number; the server\'s refusals come back in Arabic, the reply text never in the log', async () => {
  const { T, stub, logs } = load({ responses: { 'rpc:ticket_act': (a) => (a.p_action === 'reply' && a.p_id === 2 ? { data: null, error: { code: '22023', message: 'invalid: closed' } } : a.p_action === 'close' ? { data: null, error: { code: '42501', message: 'not the opener' } } : ok(null)) } });
  await T.load();
  eq(await T.setStatus('TKT-0001', 'in_progress'), { ok: true });
  eq(rpcs(stub).at(-1), ['ticket_act', { p_id: 1, p_action: 'set_status', p_args: { status: 'in_progress' } }]);
  eq(logs.at(-1)[0], 'ticket.set_status'); eq(logs.at(-1)[1], 'TKT-0001 · open → in_progress');
  eq(await T.reply('TKT-0002', 'سر الرد', [{ path: ME + '/x.pdf', name: 'إيصال', type: 'application/pdf', size: 4 }]), { ok: false, reason: 'invalid', field: 'closed', message: 'التذكرة مغلقة — أعد فتحها الأول' });
  eq((await T.close('TKT-0001')).message, 'مفيش صلاحية للإجراء ده');
  await T.reply('TKT-0001', 'سر الرد', []);
  eq(rpcs(stub).at(-1), ['ticket_act', { p_id: 1, p_action: 'reply', p_args: { text: 'سر الرد', attachments: [] } }]);
  assert(!JSON.stringify(logs).includes('سر الرد'));
  await T.update('TKT-0001', { priority: 'urgent', followUp: null });
  eq(rpcs(stub).at(-1)[1].p_args, { priority: 'urgent', followUp: '' });
  await T.resolve('TKT-0001', { outcome: 'اتحلت المشكلة', note: 'n' });
  eq(rpcs(stub).at(-1)[1], { p_id: 1, p_action: 'resolve', p_args: { outcome: 'اتحلت المشكلة', note: 'n' } });
  const noManage = load({ perms: { 'tickets.view': 'P' } }); await noManage.T.load();
  eq((await noManage.T.setStatus('TKT-0001', 'waiting')).reason, 'forbidden'); eq(rpcs(noManage.stub).length, 0);
});

test('files: images / PDF ≤ 10 MB into tickets/<my uid>/…, a signed link for 10 minutes', async () => {
  const { T, stub } = load({ responses: { 'storage:tickets:createSignedUrl': ok({ signedUrl: 'https://x/signed' }) } });
  const r = await T.upload({ name: 'صورة الكسر (1).PNG', type: 'image/png', size: 2048 });
  eq(r.ok, true); eq(r.file.path, ME + '/abcdef12-1.png'); eq(r.file.name, 'صورة الكسر (1).PNG');
  const up = opsOf(stub.calls, 'storage:tickets').find((c) => c.op === 'upload'); eq(up.args[0], ME + '/abcdef12-1.png'); eq(up.args[2], { contentType: 'image/png', upsert: false });
  eq((await T.upload({ name: 'a.html', type: 'text/html', size: 10 })).reason, 'invalid');
  eq((await T.upload({ name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).message, 'الملف أكبر من 10 ميجا');
  eq(await T.fileUrl(ME + '/abcdef12-1.png'), 'https://x/signed');
  await T.fileUrl(ME + '/abcdef12-1.png'); eq(opsOf(stub.calls, 'storage:tickets').filter((c) => c.op === 'createSignedUrl').length, 1); // cached
  eq(T._test.safeName('../../etc/passwd'), 'passwd');
});

test('links: the open tickets of an order, a maker, a customer, a conversation', async () => {
  const { T } = load(); await T.load();
  eq(T.forOrder('177611').map((t) => t.id), ['TKT-0001']);
  eq(T.forVendor(V1).map((t) => t.id), []); // TKT-0002 is resolved
  eq(T.forCustomer(CC).map((t) => t.id), ['TKT-0001']);
  eq(T.forConversation(CV, true).map((t) => t.id), ['TKT-0001']);
});

test('live: the private «tickets» broadcast → one load(); sign-out removes it', async () => {
  const { T, stub } = load({ realtime: true }); await T.load();
  const ch = stub.calls.find((c) => c.op === 'channel'); eq(ch.args, ['tickets', { config: { private: true } }]);
  const before = opsOf(stub.calls, 'tickets').filter((c) => c.op === 'select').length;
  await stub.emitBroadcast('changed', { at: 'x' }); await new Promise((r) => setTimeout(r, 400));
  assert(opsOf(stub.calls, 'tickets').filter((c) => c.op === 'select').length > before);
  T.clear(); assert(stub.calls.some((c) => c.op === 'removeChannel'));
});
