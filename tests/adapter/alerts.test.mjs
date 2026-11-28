import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// alerts.js against a stub IBSupabase: alerts (RLS-filtered) + this user's alert_reads for those ids → the bell's «النظام» section.
const src = readFileSync(new URL('../../app/js/adapter/alerts.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const A2 = { id: 2, at: '2026-10-25T09:00:00Z', kind: 'woo.sync.failed', title: 'فشل المزامنة', body: null, entity: 'settings-integrations', entity_id: null };
const A1 = { id: 1, at: '2026-10-25T08:00:00Z', kind: 'system.backup.off', title: 'النسخ الاحتياطي متوقف', body: 'آخر نسخة من 3 أيام', entity: 'settings-data', entity_id: null };
const loaded = () => ({ alerts: { data: [A2, A1], error: null }, alert_reads: { data: [{ alert_id: 1 }], error: null } });
function load({ responses = loaded(), client = true, channelThrows = false, config } = {}) {
  const stub = stubClient({ responses, channelThrows }); const events = [];
  const window = { IBSupabase: { client: client ? stub.client : null }, IBAuth: { session: () => ({ user: { id: 'u2' } }) }, IBKit: { ME: 'M02', store: { dashPrefs: {}, members: [] }, setMe() {} } };
  if (config) window.IB_CONFIG = config;
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, Event });
  return { A: window.IBAlerts, window, calls: stub.calls, responses: stub.responses, emit: stub.emit, events };
}
const has = (calls, c) => calls.some((x) => JSON.stringify(x) === JSON.stringify(c));

test('load merges reads, asked for the loaded alert ids only (bounded by the alerts limit)', async () => {
  const { A, calls } = load();
  await A.load();
  // 0157: the rule / sub-section / hide_at columns, and an alert whose «تفاصيل الظهور» passed is not asked for
  const ops = opsOf(calls, 'alerts');
  assert.deepEqual(ops[0], { op: 'select', args: ['id, at, kind, title, body, entity, entity_id, rule_id, section_id, hide_at, meta'] });
  assert.equal(ops[1].op, 'or'); assert.match(ops[1].args[0], /^hide_at\.is\.null,hide_at\.gt\.\d{4}-\d\d-\d\dT/);
  assert.deepEqual(ops.slice(2), [{ op: 'order', args: ['at', { ascending: false }] }, { op: 'limit', args: [200] }]);
  assert.deepEqual(opsOf(calls, 'alert_reads'), [{ op: 'select', args: ['alert_id'] }, { op: 'eq', args: ['user_id', 'u2'] }, { op: 'in', args: ['alert_id', [2, 1]] }]);
  assert.ok(calls.findIndex((c) => c.table === 'alert_reads') > calls.findIndex((c) => c.table === 'alerts')); // after the alerts answered
  assert.equal(A.list()[0].id, 2);
  assert.equal(A.list()[1].read, true);
  assert.equal(A.unread(), 1);
  assert.deepEqual(plain(A.list()[0]), { id: 2, at: '2026-10-25T09:00:00Z', kind: 'woo.sync.failed', title: 'فشل المزامنة', body: null, entity: 'settings-integrations', entityId: null, ruleId: null, sectionId: null, meta: null, read: false });
});

// the notifications' new structure (Safwat 24 Nov — 0157): the bell = the settings' tree — a group per main section, «الكل», one tab
// per sub-section; and nothing else (Safwat 25 Nov — «لا أزيد ولا أقل»): an alert shows only under its working rule's sub-section — one
// with no rule, or of a rule switched off or gone, is not in the bell; every main section shows for the admin, even an empty one
test('treeSections: the settings\' tree as the bell\'s groups and filters, nothing more and nothing less; the sort', async () => {
  const R1 = { id: 11, at: '2026-11-24T08:00:00Z', kind: 'rule:orders.confirm', title: 'أوردر غير مؤكد — IB-1', body: 'x', entity: 'orders/1', entity_id: 'o:1', rule_id: 'r1', section_id: 's1', hide_at: null };
  const R2 = { id: 12, at: '2026-11-24T09:00:00Z', kind: 'rule:team.status', title: 'لم يسجل حضور', body: null, entity: 'hr', entity_id: null, rule_id: 'r2', section_id: 's2', hide_at: null };
  const R3 = { id: 13, at: '2026-11-24T10:00:00Z', kind: 'rule:subs.delay', title: 'أوردر فرعي قابل للتأخير', body: null, entity: 'orders/3', entity_id: null, rule_id: null, section_id: null, hide_at: null };
  const R4 = { id: 14, at: '2026-11-24T10:30:00Z', kind: 'hr.overtime', title: 'وقت إضافي', body: null, entity: 'hr', entity_id: null, rule_id: null, section_id: 's2', hide_at: null };
  const R5 = { id: 15, at: '2026-11-24T11:00:00Z', kind: 'rule:orders.delay', title: 'أوردر متأخر', body: null, entity: 'orders/5', entity_id: null, rule_id: 'r3', section_id: 's1', hide_at: null };
  const responses = { alerts: { data: [R5, R4, R3, R2, R1], error: null }, alert_reads: { data: [{ alert_id: 11 }], error: null },
    notif_sections: { data: [{ id: 'm1', parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: 's1', parent_id: 'm1', name: 'غير مؤكدة', sort: 0 }, { id: 'm2', parent_id: null, name: 'الفريق', sort: 1 }, { id: 's2', parent_id: 'm2', name: 'الحضور والانصراف', sort: 0 }, { id: 'm3', parent_id: null, name: 'قسم فاضي', sort: 2 }], error: null },
    notif_rules: { data: [{ id: 'r1', section_id: 's1', element: 'orders', active: true }, { id: 'r2', section_id: 's2', element: 'team', active: true }, { id: 'r3', section_id: 's1', element: 'orders', active: false }], error: null } };
  const { A, window } = load({ responses });
  window.IBNotifCatalog = { elementOfKind: (k) => (/^hr/.test(k) ? 'team' : /subs/.test(k) ? 'subs' : null) };
  await A.load();
  assert.equal(A.hasTree(), true);
  const S = A.treeSections(() => true, 'new');
  // the rule-less ones (R3, R4) and the stopped rule's (R5) are nowhere; the empty main section is there
  assert.deepEqual(plain(S.map((x) => [x.label, x.tabs.map((t) => t[1] + ':' + t[2].length)])), [['خدمة العملاء', ['الكل:1', 'غير مؤكدة:1']], ['الفريق', ['الكل:1', 'الحضور والانصراف:1']], ['قسم فاضي', ['الكل:0']]]); // no «غير مقروء» / «مقروء» tabs (Safwat 24 Nov)
  assert.equal(S[1].received, 1); assert.equal(S[0].received, 0);
  assert.equal(S[1].tabs[0][2][0].fresh, true, 'the green dot on the unread one');
  // the read filter beside the sort: «غير مقروء» drops the read one, «مقروء» keeps it only
  assert.equal(A.treeSections(() => true, 'new', 'unread')[0].tabs[0][2].length, 0);
  assert.equal(A.treeSections(() => true, 'new', 'read')[0].tabs[0][2].length, 1);
  assert.equal(A.treeSections(() => true, 'new', 'read')[1].tabs[0][2].length, 0);
});

test('markRead inserts and updates the cache first', async () => {
  const { A, calls, events } = load();
  await A.load(); events.length = 0; calls.length = 0;
  const pending = A.markRead(2);
  assert.equal(A.unread(), 0); // before the request resolves
  assert.deepEqual(plain(await pending), { ok: true });
  assert.ok(has(calls, { table: 'alert_reads', op: 'insert', args: [{ alert_id: 2, user_id: 'u2' }] }));
  assert.ok(events.includes('ib:notify'));
});

test('markRead of an alert already read is a no-op: no request, no ib:notify', async () => {
  const { A, calls, events } = load();
  await A.load(); events.length = 0; calls.length = 0;
  assert.equal(A.list().find((a) => a.id === 1).read, true); // read on load (alert_reads)
  assert.deepEqual(plain(await A.markRead(1)), { ok: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
  assert.deepEqual(plain(await A.markRead(2)), { ok: true }); // unread: written once
  calls.length = 0; events.length = 0;
  assert.deepEqual(plain(await A.markRead(2)), { ok: true }); // now read here: no second request
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
  assert.equal(A.unread(), 0);
});

test('duplicate read (23505) is ok', async () => {
  const { A, responses } = load();
  await A.load();
  responses.alert_reads = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "alert_reads_pkey"' } };
  assert.deepEqual(plain(await A.markRead(2)), { ok: true });
});

test('any other write error → { ok:false }, no throw, the mark stays on this device', async () => {
  const { A, responses } = load();
  await A.load();
  responses.alert_reads = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
  assert.deepEqual(plain(await A.markRead(2)), { ok: false });
  assert.equal(A.unread(), 0);
});

test('markAllRead marks only the unread ids, ignoring duplicates (alert_reads has no UPDATE grant)', async () => {
  const { A, calls, events } = load();
  await A.load(); events.length = 0; calls.length = 0;
  const pending = A.markAllRead();
  assert.equal(A.unread(), 0);
  assert.deepEqual(plain(await pending), { ok: true });
  assert.deepEqual(opsOf(calls, 'alert_reads'), [{ op: 'upsert', args: [[{ alert_id: 2, user_id: 'u2' }], { onConflict: 'alert_id,user_id', ignoreDuplicates: true }] }]);
  assert.ok(events.includes('ib:notify'));
  calls.length = 0;
  assert.deepEqual(plain(await A.markAllRead()), { ok: true }); // nothing unread: no request
  assert.deepEqual(calls, []);
});

test('section: unread counted, read muted, error ranks first', async () => {
  const { A } = load();
  await A.load();
  const s = A.section(); const all = s.tabs[0][2];
  assert.equal(s.received, 1);
  assert.equal(all[1].muted, true);
  assert.equal(all[0].tone, 'error');
  assert.equal(all[0].icon, 'alert');
  assert.deepEqual(plain({ id: s.id, label: s.label, icon: s.icon, unit: s.unit, allLabel: s.allLabel, empty: s.empty }), { id: 'server', label: 'النظام', icon: 'bell', unit: 'تنبيه', allLabel: 'تعليم الكل كمقروء', empty: 'مفيش تنبيهات من السيستم.' });
  assert.deepEqual(plain(s.tabs.map((t) => [t[0], t[1], t[2].map((it) => it.key)])), [['all', 'الكل', ['sa:2', 'sa:1']], ['unread', 'غير مقروء', ['sa:2']], ['read', 'مقروء', ['sa:1']]]);
  assert.deepEqual(plain({ title: all[0].title, sub: all[0].sub, muted: all[0].muted }), { title: 'فشل المزامنة', sub: '', muted: false });
  assert.deepEqual(plain({ sub: all[1].sub, tone: all[1].tone, icon: all[1].icon }), { sub: 'آخر نسخة من 3 أيام', tone: 'warning', icon: 'bell' });
  assert.equal(typeof all[0].meta, 'string');
});

test('run marks read and navigates to the entity hash', async () => {
  const { A, window, calls } = load();
  await A.load();
  window.location = { hash: '' };
  A.section().tabs[0][2][0].run();
  assert.equal(window.location.hash, 'settings-integrations');
  assert.equal(A.unread(), 0);
  assert.ok(has(calls, { table: 'alert_reads', op: 'insert', args: [{ alert_id: 2, user_id: 'u2' }] }));
});

test('run does not navigate to an entity that is not an app hash', async () => {
  const { A, window } = load({ responses: { alerts: { data: [{ ...A2, entity: 'javascript:alert(1)' }, { ...A1, entity: 'https://evil.example/x' }], error: null }, alert_reads: { data: [], error: null } } });
  await A.load();
  window.location = { hash: 'dashboard' };
  A.section().tabs[0][2].forEach((it) => it.run());
  assert.equal(window.location.hash, 'dashboard');
  assert.equal(A.unread(), 0);
});

test('toneOf', async () => {
  const { A } = load();
  assert.equal(A.toneOf('woo.sync.failed'), 'error');
  assert.equal(A.toneOf('vendor.late'), 'error');
  assert.equal(A.toneOf('backup.ok'), 'info');
  assert.equal(A.toneOf('system.backup.off'), 'warning');
});

test('relTime', async () => {
  const { A } = load();
  const now = Date.parse('2026-10-25T12:00:00Z'); const ago = (ms) => new Date(now - ms).toISOString();
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  assert.equal(A.relTime(ago(30e3), now), 'دلوقتي');
  assert.equal(A.relTime(ago(5 * MIN), now), 'منذ 5 دقيقة');
  assert.equal(A.relTime(ago(3 * HOUR), now), 'منذ 3 ساعة');
  assert.equal(A.relTime(ago(30 * HOUR), now), 'أمس');
  assert.equal(A.relTime(ago(4 * DAY), now), 'منذ 4 أيام');
});

test('subscribe swallows a throwing channel and load still works', async () => {
  const { A, calls } = load({ channelThrows: true });
  assert.doesNotThrow(() => A.subscribe());
  assert.ok(calls.some((c) => c.op === 'channel'));
  await A.load();
  assert.equal(A.list().length, 2);
});

test('realtime:false → no channel call', async () => {
  const { A, calls } = load({ config: { realtime: false } });
  await A.load();
  A.subscribe();
  assert.equal(calls.some((c) => c.op === 'channel'), false);
});

test('a Realtime insert lands first in the cache and dispatches ib:notify; unsubscribe removes the channel', async () => {
  const { A, calls, emit, events } = load();
  await A.load(); A.subscribe(); events.length = 0;
  assert.ok(has(calls, { op: 'channel', args: ['alerts'] }));
  assert.ok(has(calls, { op: 'on', args: ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }] }));
  const row = { id: 3, at: '2026-10-25T10:00:00Z', kind: 'stock.cons.late', title: 'تجميع متأخر', body: null, role_id: 'ops', user_id: null, entity: 'inventory-consolidate', entity_id: null, read_at: null };
  emit(row); emit(row); // the same row twice (reconnect) is kept once
  assert.deepEqual(A.list().map((a) => a.id), [3, 2, 1]);
  assert.equal(A.unread(), 2);
  assert.ok(events.includes('ib:notify'));
  A.unsubscribe();
  assert.ok(calls.some((c) => c.op === 'removeChannel'));
});

test('section() is null before load', async () => {
  const { A } = load();
  assert.equal(A.section(), null);
  assert.deepEqual(plain(A.list()), []);
  assert.equal(A.unread(), 0);
});

test('no alerts: no alert_reads request, an empty section', async () => {
  const { A, calls, events } = load({ responses: { alerts: { data: [], error: null }, alert_reads: { data: [{ alert_id: 1 }], error: null } } });
  await A.load();
  assert.deepEqual(opsOf(calls, 'alert_reads'), []);
  assert.deepEqual(plain(A.list()), []);
  assert.equal(A.section().received, 0);
  assert.ok(events.includes('ib:notify'));
});

test('a failed marks read leaves section() null (never every alert shown unread)', async () => {
  const { A, responses } = load();
  responses.alert_reads = { data: null, error: { message: 'x' } };
  await A.load();
  assert.equal(A.section(), null);
});

test('clear forgets the alerts; a failed load leaves section() null', async () => {
  const { A, responses } = load();
  await A.load();
  A.clear();
  assert.equal(A.section(), null);
  responses.alerts = { data: null, error: { message: 'x' } };
  await A.load();
  assert.equal(A.section(), null);
});

test('no client: load, subscribe and markRead never throw', async () => {
  const { A, calls } = load({ client: false });
  await A.load();
  assert.doesNotThrow(() => A.subscribe());
  assert.equal(A.section(), null);
  assert.deepEqual(plain(await A.markRead(2)), { ok: false });
  assert.deepEqual(calls, []);
});

// agents-brain decision 7 (T7): a note with the action ready opens the place — the late conversation with the assistant's reply in the box
test('noteOpen: a «cs/<conversation>» note opens that conversation with the reply after «الرد المقترح:», marks it read, makes no chat', async () => {
  const CID = '11111111-2222-4333-8444-555555555555';
  const N = { id: 7, agent: 'cs', kind: 'alert', title: 'رد جاهز لـ «منى»', body: 'منى مستني ردنا…\n\nالرد المقترح:\nأهلًا يا منى 🌿\nإحنا معاك دلوقتي', link: 'cs/' + CID, created_at: '2026-11-18T08:00:00Z' };
  const responses = { ...loaded(), ai_agent_notes: { data: [N], error: null }, ai_agent_note_reads: { data: [], error: null } };
  const { A, window, calls } = load({ responses });
  const opened = [];
  let status = 'مستنية ردنا';
  window.IBPages = { all: () => ({ cs: { api: { data: { convs: [{ id: CID, status }] }, openConversation: (id, draft) => { opened.push([id, draft]); return true; } } } }) };
  await A.load();
  const r = await A.noteOpen(7);
  assert.equal(r.ok, true);
  assert.deepEqual(opened, [[CID, 'أهلًا يا منى 🌿\nإحنا معاك دلوقتي']]);
  assert.ok(calls.some((c) => c.op === 'rpc' && c.args[0] === 'ai_agent_note_read'));
  assert.ok(!calls.some((c) => c.op === 'rpc' && c.args[0] === 'ai_agent_note_open'));
  assert.equal(A.noteList()[0].read, true);
  // answered since: the conversation opens with no reply put in
  status = 'مستنية العميل'; window.IBPages = { all: () => ({ cs: { api: { data: { convs: [{ id: CID, status }] }, openConversation: (id, draft) => { opened.push([id, draft]); return true; } } } }) };
  await A.noteOpen(7);
  assert.deepEqual(opened[1], [CID, '']);
  assert.equal(A.draftOf('x\nالرد المقترح:\n  رد  '), 'رد'); assert.equal(A.draftOf('من غير رد'), '');
});

// the bell's redesign (docs/superpowers/plans/2026-11-24-bell-redesign.md): a maker's delay alerts in a tab are one card (his logo, «N
// متأخر · M قابل للتأخير · P قطعة») that opens his late orders; the critical first; a member's alert carries his first letter
test('treeSections: one card per maker with his counts, the critical first, the owner\'s avatar', async () => {
  const meta = (st, pcs) => ({ lv: st === 'late' ? 'critical' : 'important', g: 'vendor', gid: 'v1', gname: 'Art Craft', n: 1, pcs, st });
  const rows = [
    { id: 21, at: '2026-11-24T09:00:00Z', kind: 'rule:subs.delay', title: 'أوردر فرعي متأخر — IB-1', body: 'x', entity: 'orders/1', entity_id: 's:1:v1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: meta('late', 3) },
    { id: 22, at: '2026-11-24T08:00:00Z', kind: 'rule:subs.delay', title: 'أوردر فرعي متأخر — IB-2', body: 'x', entity: 'orders/2', entity_id: 's:2:v1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: meta('late', 1) },
    { id: 23, at: '2026-11-24T07:00:00Z', kind: 'rule:subs.delay', title: 'أوردر فرعي قابل للتأخير — IB-3', body: 'x', entity: 'orders/3', entity_id: 's:3:v1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: meta('risk', 2) },
    { id: 24, at: '2026-11-24T10:00:00Z', kind: 'rule:makers.making', title: 'أوردر مؤكد جديد', body: 'x', entity: 'orders/4', entity_id: 'mk:1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: { lv: 'info' } },
    { id: 25, at: '2026-11-24T11:00:00Z', kind: 'rule:team.status', title: 'لم يسجل حضور', body: 'x', entity: 'hr-team', entity_id: 'noin:1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: { lv: 'important', g: 'member', gid: 'm1', gname: 'سارة أحمد' } }];
  const responses = { alerts: { data: rows, error: null }, alert_reads: { data: [], error: null },
    notif_sections: { data: [{ id: 'm1', parent_id: null, name: 'متابعة المبتكرين', sort: 0 }, { id: 's1', parent_id: 'm1', name: 'متأخر', sort: 0 }], error: null },
    notif_rules: { data: [{ id: 'r1', section_id: 's1', element: 'subs', active: true }], error: null } };
  const { A, window } = load({ responses });
  window.IBVendors = { store: { get: (id) => (id === 'v1' ? { logoUrl: 'https://ibtekr.club/logo.webp' } : null) } };
  await A.load();
  const opened = []; const S = A.treeSections((a) => { opened.push(a); return true; }, 'new');
  const all = S[0].tabs[0][2];
  assert.deepEqual(plain(all.map((x) => [x.title, x.lv])), [['Art Craft', 'critical'], ['لم يسجل حضور', 'important'], ['أوردر مؤكد جديد', 'info']]);
  assert.equal(all[0].sub, '2 أوردر متأخر · 1 قابل للتأخير · 6 قطعة'); assert.equal(all[0].group, true);
  assert.deepEqual(plain(all[0].av), { img: 'https://ibtekr.club/logo.webp', photo: null, letter: 'A', tone: 'vendor' });
  assert.deepEqual(plain(all[1].av), { letter: 'س', tone: 'member' });
  assert.equal(S[0].received, 5); assert.equal(S[0].critical, 2);
  all[0].run();
  assert.deepEqual(plain(opened), [{ title: 'Art Craft', body: '2 أوردر متأخر · 1 قابل للتأخير · 6 قطعة', vendorLate: 'Art Craft', vendorId: 'v1', kind: 'all' }]); // the alert popup's head and line (Safwat 28 Nov)
  assert.equal(A.list().filter((a) => a.read).length, 3, 'the card marks the maker\'s alerts read');
});

// customer service's order alert (Safwat 25 Nov — bell-redesign decision 17): the card carries the customer, his phone read from orders_v
// (a full one: copy + WhatsApp; a masked one shown as it is, no links), the order's status, «محتاج متابعة», its sub-orders and late makers
test('treeSections: an order alert of customer service — the phone from orders_v, the status, the follow-up, the sub-orders and the late makers', async () => {
  const meta = (gid, dl) => ({ lv: 'important', g: 'customer', gid, gname: 'منى أحمد', ost: 'جاري التنفيذ', dl, subs: 2, lm: dl === 'late' ? ['Art Craft'] : [], rm: dl === 'risk' ? ['sala'] : [],
    mk: [{ n: 'Art Craft', p: 3, s: 'جاري التنفيذ', d: dl === 'late' ? 'late' : 'ok' }] });
  const rows = [
    { id: 31, at: '2026-11-25T09:00:00Z', kind: 'rule:orders.delay', title: 'أوردر متأخر — IB-1', body: 'x', entity: 'orders/1', entity_id: 'o:1', rule_id: 'r1', section_id: 's1', hide_at: null, meta: meta('o1', 'late') },
    { id: 32, at: '2026-11-25T08:00:00Z', kind: 'rule:orders.delay', title: 'أوردر متأخر — IB-2', body: 'x', entity: 'orders/2', entity_id: 'o:2', rule_id: 'r1', section_id: 's1', hide_at: null, meta: meta('o2', 'ok') }];
  const responses = { alerts: { data: rows, error: null }, alert_reads: { data: [], error: null },
    orders_v: { data: [{ id: 'o1', customer_phone: '01011112222' }, { id: 'o2', customer_phone: '010•••2222' }], error: null },
    notif_sections: { data: [{ id: 'm1', parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: 's1', parent_id: 'm1', name: 'أوردر متأخر', sort: 0 }], error: null },
    notif_rules: { data: [{ id: 'r1', section_id: 's1', element: 'orders', active: true, template: null }], error: null } };
  const { A, calls, window } = load({ responses });
  await import(new URL('../../app/js/pages/notif-catalog.js', import.meta.url).href); window.IBNotifCatalog = globalThis.IBNotifCatalog;
  await A.load();
  assert.deepEqual(opsOf(calls, 'orders_v'), [{ op: 'select', args: ['id, customer_phone'] }, { op: 'in', args: ['id', ['o1', 'o2']] }]);
  const all = A.treeSections(() => true, 'new')[0].tabs[0][2];
  // the card's lines from the default template (no template on the rule): the name and phone · «محتاج متابعة», the sub-orders · a row per
  // maker (Safwat 25 Nov — «اسم العميل و شيل حالة الاوردر الرئيسي … كل فيندور قداموا عدد القطع و حالة التسليم»)
  assert.deepEqual(plain(all[0].card.lines), [[{ kind: 'name', text: 'منى أحمد' }, { kind: 'phone', text: '01011112222' }], [{ kind: 'follow', text: 'محتاج متابعة' }, { kind: 'subs', text: '2 أوردر فرعي' }],
    [{ kind: 'makers', text: 'Art Craft: 3 قطع (متأخر · جاري التنفيذ)', items: [{ n: 'Art Craft', p: 3, s: 'جاري التنفيذ', d: 'late' }] }]]);
  assert.deepEqual([all[0].card.dial, all[0].card.wa, all[0].card.dl], [true, 'https://wa.me/201011112222', 'late']);
  assert.equal(all[1].card.dial, false); assert.equal(all[1].card.wa, null); assert.ok(!all[1].card.lines.flat().some((p) => p.kind === 'follow'), 'no «محتاج متابعة» on an order not late');
  assert.deepEqual(plain(all[1].card.lines[0]), [{ kind: 'name', text: 'منى أحمد' }, { kind: 'phone', text: '010•••2222' }], 'a masked phone shown as it is');
  assert.deepEqual(plain(all[0].av), { letter: 'م', tone: 'customer' }, 'the customer\'s first letter');
});

// the template is the card (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي ظاهر عشان المستخدم لو عايز يعدل يقدر يعدل»): the
// admin's own template draws the order alert's card — its lines and parts, the empty ones left out
test('treeSections: the order alert\'s card drawn from its rule\'s template', async () => {
  const rows = [{ id: 41, at: '2026-11-25T09:00:00Z', kind: 'rule:orders.confirm', title: 'أوردر غير مؤكد — IB-1', body: 'x', entity: 'orders/1', entity_id: 'o:1', rule_id: 'r1', section_id: 's1', hide_at: null,
    meta: { lv: 'important', g: 'customer', gid: 'o1', gname: 'منى', ost: 'معلّق', dl: 'ok', subs: 1, lm: [], rm: [] } }];
  const responses = { alerts: { data: rows, error: null }, alert_reads: { data: [], error: null }, orders_v: { data: [{ id: 'o1', customer_phone: '01011112222' }], error: null },
    notif_sections: { data: [{ id: 'm1', parent_id: null, name: 'خدمة العملاء', sort: 0 }, { id: 's1', parent_id: 'm1', name: 'غير مؤكدة', sort: 0 }], error: null },
    notif_rules: { data: [{ id: 'r1', section_id: 's1', element: 'orders', active: true, template: '{حالة_الأوردر} · {المتابعة}\nاتصل بـ {العميل} على {التليفون}' }], error: null } };
  const { A, window } = load({ responses });
  await import(new URL('../../app/js/pages/notif-catalog.js', import.meta.url).href); window.IBNotifCatalog = globalThis.IBNotifCatalog;
  await A.load();
  const it = A.treeSections(() => true, 'new')[0].tabs[0][2][0];
  assert.deepEqual(plain(it.card.lines), [[{ kind: 'chip', text: 'معلّق' }], [{ kind: 'phone', text: 'اتصل بـ منى على 01011112222' }]], '«محتاج متابعة» empty — gone; the phone line as the admin wrote it');
});

// every template works the same way (Safwat 25 Nov — «قوالب الرسايل كلها تشتغل بنفس الطريقة»): a rule of any element with a template draws
// its alert's card from the alert's own variables (meta.v); without one its line ({التفاصيل}) in its pieces
test('treeSections: any rule\'s template draws its alert\'s card from meta.v; no template = its line as the card', async () => {
  const rows = [
    { id: 51, at: '2026-11-25T09:00:00Z', kind: 'rule:team.status', title: 'لم يسجل حضور', body: 'سارة مسجّلتش حضور', entity: 'hr-team', entity_id: 'noin:1', rule_id: 'r1', section_id: 's1', hide_at: null,
      meta: { lv: 'important', g: 'member', gid: 'm1', gname: 'سارة', v: { n: 'سارة', r: '', s: 'لم يسجل حضور', d: 'سارة مسجّلتش حضور لحد دلوقتي' } } },
    { id: 52, at: '2026-11-25T08:00:00Z', kind: 'rule:team.status', title: 'لم يسجل انصراف', body: 'x', entity: 'hr-team', entity_id: 'noout:1', rule_id: 'r2', section_id: 's1', hide_at: null, meta: { lv: 'important', v: { n: 'علي', s: 'لم يسجل انصراف', d: 'x' } } }];
  const responses = { alerts: { data: rows, error: null }, alert_reads: { data: [], error: null },
    notif_sections: { data: [{ id: 'm1', parent_id: null, name: 'الفريق', sort: 0 }, { id: 's1', parent_id: 'm1', name: 'الحضور', sort: 0 }], error: null },
    notif_rules: { data: [{ id: 'r1', section_id: 's1', element: 'team', type: 'status', active: true, template: '{الوضع}\n{الاسم} — كلّمه' }, { id: 'r2', section_id: 's1', element: 'team', type: 'status', active: true, template: null }], error: null } };
  const { A, window } = load({ responses });
  await import(new URL('../../app/js/pages/notif-catalog.js', import.meta.url).href); window.IBNotifCatalog = globalThis.IBNotifCatalog;
  await A.load();
  const L = A.treeSections(() => true, 'new')[0].tabs[0][2];
  assert.deepEqual(plain(L[0].card.lines), [[{ kind: 'chip', text: 'لم يسجل حضور' }], [{ kind: 'text', text: 'سارة — كلّمه' }]]);
  assert.deepEqual(plain(L[1].card.lines), [[{ kind: 'details', text: 'x' }]], 'no template: the card of its line — every alert a card (Safwat 25 Nov — «خلي التصميم لكل التنبيهات يكون احترافي و منظم»)');
});
