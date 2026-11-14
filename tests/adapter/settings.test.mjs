import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// settings.js (phase 11, 0056) against a stub IBSupabase: the sections and roles in the page's shapes, settings_public with the
// sign-in, a section saved by merge (team / integrations / security with settings.team, the rest the admin), the team through the
// 0056 RPCs (the Arabic refusals from the SQLSTATE and the «invalid: field» message), the sessions, the platform links through
// settings-admin (a secret never in a log), the engine, the activity log with filters and pages, the papers and the logos — and
// activity_log settings.* with names only.
const src = readFileSync(new URL('../../app/js/adapter/settings.js', import.meta.url), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const ok = (data) => ({ data, error: null });
const A = 'a0000000-0000-4000-8000-000000000001'; const B = 'a0000000-0000-4000-8000-000000000002';
const ROLES = [{ id: 'admin', name: 'أدمن', description: 'كل الصلاحيات', is_system: true, permissions: {}, sort: 1, hidden: false }, { id: 'ops', name: 'عمليات', description: null, is_system: true, permissions: { 'orders.view': 'F' }, sort: 2, hidden: false }, { id: 'old', name: 'قديم', description: null, is_system: true, permissions: {}, sort: 3, hidden: true }];
const SETTINGS = [{ section: 'general', data: { company: 'إبتكر كلوب' }, updated_at: '2026-11-07T08:00:00Z', updated_by: A }, { section: 'notif', data: { quiet: { days: 'الجمعة' } }, updated_at: null, updated_by: null }];
function load({ responses = {}, role = 'admin', perms = {} } = {}) {
  const stub = stubClient({ responses: { settings: ok(SETTINGS), roles: ok(ROLES), ...responses } });
  const events = []; const logs = [];
  const window = { IBSupabase: { client: stub.client },
    IBDirectory: { perm: (k) => (role === 'admin' ? 'F' : perms[k] || 'N'), me: () => ({ id: A, name: 'صفوت', role_id: role, status: 'active' }), members: () => [{ uid: A, name: 'صفوت كمال' }, { uid: B, name: 'سارة أحمد' }], refresh: async () => { events.push('refresh'); } },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    crypto: { randomUUID: () => 'abcdef12-3456-4000-8000-000000000000' } };
  const ctx = { window, document: { dispatchEvent(e) { events.push(e.type); } }, CustomEvent: class { constructor(t) { this.type = t; } }, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Math, Error, RegExp };
  ctx.globalThis = ctx; runInNewContext(src, ctx);
  return { S: window.IBSettings, stub, events, logs };
}
const rpcs = (stub) => stub.calls.filter((c) => c.op === 'rpc').map((c) => c.args);
const invokes = (stub) => stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args);
const file = (type, size) => ({ type, size, name: 'f' });

test('load: the sections and the roles (hidden kept, marked), the meta, settings_public cached; a member without settings.view loads nothing', async () => {
  const { S, events } = load();
  eq(await S.load(), { ok: true });
  eq(S.section('general'), { company: 'إبتكر كلوب' }); eq(S.section('nope'), {}); eq(S.data.meta.general, { updatedAt: '2026-11-07T08:00:00Z', updatedBy: A });
  eq(S.roles().map((r) => [r.id, r.name, r.isSystem, r.hidden, r.sort]), [['admin', 'أدمن', true, false, 1], ['ops', 'عمليات', true, false, 2], ['old', 'قديم', true, true, 3]]);
  eq(S.liveRoles().map((r) => r.id), ['admin', 'ops']); eq(S.roles()[1].description, '');
  assert.ok(events.includes('ib:settings'));
  const pubStub = load({ responses: { 'rpc:settings_public': ok({ brand: { colors: { primary: '#123456' } }, quick: {}, general: { company: 'إبتكر' }, security: { force2fa: true }, notif: { alertRoles: {} } }) } });
  const d = await pubStub.S.loadPublic(); eq(d.security, { force2fa: true }); eq(pubStub.S.public().brand, { colors: { primary: '#123456' } });
  const viewer = load({ role: 'viewer', perms: {} }); eq(await viewer.S.load(), { ok: true }); eq(viewer.S.sections(), {}); eq(opsOf(viewer.stub.calls, 'settings'), [], 'no read without settings.view');
  assert.ok(S.PERM_KEYS.includes('orders.view') && S.PERM_KEYS.includes('sensitive.salaries') && S.PERMS.at(-1)[1].every((r) => r[2] === 1), 'the dictionary: the real keys, the last group sensitive');
});

test('save: a merge upsert on the section, nulls dropped, the keys only in the log; team / integrations / security need settings.team, the rest the admin', async () => {
  const { S, stub, logs } = load(); await S.load();
  eq(await S.save('general', { site: 'https://ibtekr.club', legal: null }), { ok: true });
  const up = opsOf(stub.calls, 'settings').find((c) => c.op === 'upsert'); eq(up.args, [{ section: 'general', data: { company: 'إبتكر كلوب', site: 'https://ibtekr.club' } }, { onConflict: 'section' }]);
  eq(S.section('general'), { company: 'إبتكر كلوب', site: 'https://ibtekr.club' }); eq(logs.at(-1), ['settings.general.save', 'legal, site', { entity: 'settings', entity_id: 'general' }]);
  eq(await S.save('notif', { quiet: { days: 'لا يوجد' } }, { merge: false }), { ok: true }); eq(S.section('notif'), { quiet: { days: 'لا يوجد' } });
  eq((await S.save('Bad Name', {})).reason, 'invalid'); eq((await S.save('general', [1])).reason, 'invalid');
  const team = load({ role: 'ops', perms: { 'settings.view': 'F', 'settings.team': 'F' } }); await team.S.load();
  eq((await team.S.save('team', { x: 1 })).ok, true); eq((await team.S.save('general', { x: 1 })).reason, 'forbidden', 'the admin only');
  const denied = load({ responses: { settings: (calls) => (calls.some((c) => c.op === 'upsert') ? { data: null, error: { code: '42501', message: 'rls' } } : ok(SETTINGS)) } }); await denied.S.load();
  eq((await denied.S.save('general', { x: 1 })), { ok: false, reason: 'forbidden', field: null, message: 'مفيش صلاحية للإجراء ده' });
});

test('the team: the RPCs with cleaned perms / moves, the reload and the directory refresh after; the refusals: last admin, invalid field, exists, P0002', async () => {
  const { S, stub, events } = load({ responses: { 'rpc:role_create': ok('content') } }); await S.load();
  eq(await S.setRolePerms('ops', { 'orders.view': 'F', 'orders.status': 'P', 'x.y': 'Z', junk: 'F', 'custom.thing': 'N' }), { ok: true });
  eq(rpcs(stub).at(-1), ['role_perms_set', { p_role: 'ops', p_perms: { 'orders.view': 'F', 'orders.status': 'P', 'custom.thing': 'N' } }]); assert.ok(events.includes('refresh'));
  eq((await S.setRolePerms('admin', {})).field, 'admin');
  eq(await S.createRole({ name: 'محتوى', desc: 'الكتابة', base: 'ops' }), { ok: true, id: 'content' });
  const made = rpcs(stub).at(-1)[1]; assert.match(made.p_id, /^r_[a-z0-9]+$/, 'an Arabic name gets a generated id'); eq([made.p_name, made.p_desc, made.p_base], ['محتوى', 'الكتابة', 'ops']);
  eq(await S.createRole({ id: 'Content_Team', name: 'Content', base: 'viewer' }), { ok: true, id: 'content' }); eq(rpcs(stub).at(-1)[1].p_id, 'content_team');
  eq((await S.createRole({ id: '1bad', name: 'x' })).field, 'id'); eq((await S.createRole({ name: '  ' })).field, 'name');
  eq(await S.updateRole('content', { name: 'المحتوى', desc: '' }), { ok: true }); eq(rpcs(stub).at(-1), ['role_update', { p_role: 'content', p_name: 'المحتوى', p_desc: '' }]);
  eq(await S.deleteRole('content', { [B]: 'ops', '*': 'viewer', bad: 'x', [A]: 5 }), { ok: true }); eq(rpcs(stub).at(-1), ['role_delete', { p_role: 'content', p_moves: { [B]: 'ops', '*': 'viewer' } }]);
  eq((await S.deleteRole('admin', {})).field, 'admin');
  eq(await S.setMemberRole(B, 'ops'), { ok: true }); eq(rpcs(stub).at(-1), ['member_role_set', { p_member: B, p_role: 'ops' }]); eq((await S.setMemberRole('M02', 'ops')).reason, 'invalid');
  eq(await S.setMemberPerms(B, { 'orders.view': 'N' }), { ok: true }); eq(rpcs(stub).at(-1), ['member_perms_set', { p_member: B, p_perms: { 'orders.view': 'N' } }]);
  const refused = load({ responses: { 'rpc:member_role_set': { data: null, error: { code: '22023', message: 'last admin' } }, 'rpc:role_update': { data: null, error: { code: '22023', message: 'invalid: name' } }, 'rpc:role_create': { data: null, error: { code: '23505', message: 'exists' } }, 'rpc:role_delete': { data: null, error: { code: 'P0002', message: 'no such role' } } } }); await refused.S.load();
  eq(await refused.S.setMemberRole(B, 'ops'), { ok: false, reason: 'last_admin', field: null, message: 'لازم يفضل أدمن واحد نشط على الأقل' });
  eq((await refused.S.updateRole('ops', { name: 'x' })).message, 'الاسم مطلوب (لحد 40 حرف) — اسم الدور الجاهز ثابت');
  eq((await refused.S.createRole({ name: 'xx', base: 'ops' })).reason, 'exists'); eq((await refused.S.deleteRole('zz', {})).reason, 'notfound');
  const member = load({ role: 'ops', perms: { 'settings.view': 'F', 'settings.team': 'F' } }); await member.S.load(); eq((await member.S.setRolePerms('ops', {})).reason, 'forbidden', 'the admin only, settings.team is not enough for the RPCs');
});

test('member status through settings-admin; the sessions with a device label; a revoke', async () => {
  const sessionsRows = [{ id: 'b0000000-0000-4000-8000-000000000001', created_at: '2026-11-01T08:00:00Z', refreshed_at: '2026-11-07T09:00:00Z', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', ip: '41.1.1.1', aal: 'aal2', current: true },
    { id: 'b0000000-0000-4000-8000-000000000002', created_at: '2026-11-05T08:00:00Z', refreshed_at: null, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', ip: null, aal: 'aal1', current: false }];
  const { S, stub } = load({ responses: { 'rpc:my_sessions': ok(sessionsRows), 'rpc:my_session_revoke': ok(true), 'fn:settings-admin': ok({ ok: true }) } }); await S.load();
  eq(await S.setMemberStatus(B, 'suspended', ' سبب  طويل '), { ok: true }); eq(invokes(stub).at(-1), ['settings-admin', { body: { action: 'member_status', member_id: B, status: 'suspended', reason: 'سبب طويل' } }]);
  const s = await S.sessions(); eq(s.sessions.map((x) => [x.device, x.current, x.aal, x.refreshedAt, x.ip]), [['Chrome · macOS', true, 'aal2', '2026-11-07T09:00:00Z', '41.1.1.1'], ['Safari · iPhone', false, 'aal1', '2026-11-05T08:00:00Z', '']]);
  eq(await S.revokeSession('b0000000-0000-4000-8000-000000000002'), { ok: true, revoked: true }); eq(rpcs(stub).at(-1), ['my_session_revoke', { p_id: 'b0000000-0000-4000-8000-000000000002' }]);
  eq((await S.revokeSession('x')).reason, 'invalid');
  const cur = load({ responses: { 'rpc:my_session_revoke': { data: null, error: { code: '22023', message: 'invalid: current' } } } });
  eq((await cur.S.revokeSession('b0000000-0000-4000-8000-000000000001')).message, 'الجلسة الحالية بتتقفل بـ «تسجيل الخروج»');
});

test('the links through settings-admin: status, a secret set (the fields cleaned; the log has the names only), the site keys with the probe then confirm, a test, an unlink; the function\'s refusals in Arabic', async () => {
  const KEY = 'sk-test-' + 'a'.repeat(30);
  const answers = { status: { links: { openai: { ready: true, fields: { key: '••••aaaa' } } }, cards: [{ id: 'openai' }], now: 'x' }, secret_set: { link: { ready: true, fields: { key: '••••aaaa' } }, test: { ok: true, account: '2 موديل' } }, woo_set: { probe: { ok: true, site: 'ibtekr.club' }, pending: true }, secret_test: { test: { ok: false, error: 'probe_failed' } } };
  const { S, stub, logs } = load({ responses: { 'fn:settings-admin': (opts) => ok(answers[opts.body.action] || { ok: true }) } }); await S.load();
  const st = await S.links(); eq([st.ok, Object.keys(st.links), st.cards.length], [true, ['openai'], 1]);
  const set = await S.setSecret('openai', { key: ' ' + KEY + ' ', bad$: 'x', n: 5 }); eq([set.ok, set.link.fields.key, set.test.account], [true, '••••aaaa', '2 موديل']);
  eq(invokes(stub).at(-1), ['settings-admin', { body: { action: 'secret_set', name: 'openai', fields: { key: KEY } } }]);
  eq(logs.filter((l) => l[0].startsWith('settings.integration')), [], 'the server logs the set itself'); assert.ok(!JSON.stringify(logs).includes(KEY), 'the key is never logged');
  const w1 = await S.wooSet({ url: 'https://ibtekr.club', ck: 'ck_x', cs: 'cs_y' }); eq([w1.ok, w1.body.pending], [true, true]); 
  eq((await S.wooSet({ url: 'https://ibtekr.club' }, true)).ok, true); eq(invokes(stub).at(-1)[1].body.confirm, true);
  eq((await S.testSecret('openai')).test, { ok: false, error: 'probe_failed' }); eq(await S.unlink('openai'), { ok: true });
  const bad = load({ responses: { 'fn:settings-admin': (opts) => ok(opts.body.action === 'secret_set' ? { error: 'invalid', field: 'key' } : { error: 'no_vault' }) } }); await bad.S.load();
  eq(await bad.S.setSecret('openai', { key: 'short' }), { ok: false, reason: 'invalid', field: 'key', message: 'المفتاح مش بالشكل المتوقع', body: { error: 'invalid', field: 'key' } });
  eq((await bad.S.links()).message, 'الخزنة (Vault) مش متاحة في المشروع');
  const member = load({ role: 'ops', perms: { 'settings.view': 'F', 'settings.team': 'F' } }); eq((await member.S.links()).reason, 'forbidden');
  // the engine
  const n = load({ responses: { 'fn:notify': (opts) => ok(opts.body.action === 'status' ? { result: 'ok', email: { ready: true }, whatsapp: { ready: false } } : { result: opts.body.dry ? 'dry' : 'ok', alerts: 3 }) } });
  eq((await n.S.notifyStatus()).email, { ready: true }); eq((await n.S.notifyTick(true)).result, 'dry'); eq(n.logs.length, 0, 'a dry run is not logged'); eq((await n.S.notifyTick()).alerts, 3); eq(n.logs.at(-1)[0], 'settings.notify.tick');
});

test('the activity log: the filters as PostgREST calls, pages of 100 (one more row = more), the actor names from the directory and the page from the action prefix', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ id: 500 - i, at: '2026-11-0' + (7 - (i % 7)) + 'T10:00:00Z', actor: i % 2 ? A : B, action: i % 3 ? 'order.status' : 'settings.role.perms', entity: 'x', entity_id: String(i), old_value: null, new_value: { k: i } }));
  const { S, stub } = load({ responses: { activity_log: ok(rows) } }); await S.load();
  const r = await S.activity({ actor: B, prefix: 'settings', from: '2026-11-01', to: '2026-11-07', page: 2, size: 100 });
  eq([r.ok, r.rows.length, r.more, r.page], [true, 100, true, 2]);
  eq(r.rows[0], { id: 500, at: '2026-11-07T10:00:00Z', actor: B, actorName: 'سارة أحمد', action: 'settings.role.perms', page: 'الإعدادات', entity: 'x', entityId: '0', oldValue: null, newValue: { k: 0 } });
  const ops = opsOf(stub.calls, 'activity_log').map((c) => [c.op, ...c.args]);
  eq(ops, [['select', 'id, at, actor, action, entity, entity_id, old_value, new_value'], ['order', 'at', { ascending: false }], ['range', 200, 300], ['eq', 'actor', B], ['like', 'action', 'settings.%'], ['gte', 'at', '2026-11-01T00:00:00Z'], ['lte', 'at', '2026-11-07T23:59:59Z']]);
  const r2 = await S.activity({ action: 'order.status', prefix: 'settings', actor: 'M01', from: 'bad' }); eq(opsOf(stub.calls, 'activity_log').slice(-4).map((c) => c.op), ['select', 'order', 'range', 'eq'], 'action wins over prefix; a bad actor / date is ignored');
  eq(r2.rows[1].page, 'الأوردرات'); eq(S.pageOf('mkt.post.publish'), 'التسويق'); eq(S.pageOf('zzz'), 'أخرى');
});

test('the papers: list, add (the file into bucket company-docs then the row; a refused row removes the file), update, remove, a signed link of 60 seconds that is logged; the logos', async () => {
  const D = 'd0000000-0000-4000-8000-000000000001';
  const row = { id: D, name: 'السجل التجاري', type: 'سجل تجاري', doc_no: '1234', issued: '2025-01-01', expires: '2026-12-01', path: 'docs/abcdef12-3456-4000-8000-000000000000.pdf', size: 1000, mime: 'application/pdf', notes: null, created_at: '2026-11-07T08:00:00Z', updated_at: null };
  const { S, stub, logs } = load({ responses: { company_docs: (calls) => ok(calls.some((c) => c.op === 'insert') ? row : calls.some((c) => c.op === 'maybeSingle') ? row : [row]), 'storage:company-docs:createSignedUrl': ok({ signedUrl: 'https://signed.test/doc' }), 'storage:settings:createSignedUrl': ok({ signedUrl: 'https://signed.test/logo' }) } }); await S.load();
  const list = await S.docs(); eq(list.docs.map((d) => [d.id, d.docNo, d.expires, d.size]), [[D, '1234', '2026-12-01', 1000]]);
  const add = await S.addDoc(file('application/pdf', 1000), { name: ' السجل التجاري ', type: 'سجل تجاري', docNo: '1234', issued: '2025-01-01', expires: '2026-12-01' });
  eq([add.ok, add.doc.id], [true, D]);
  eq(opsOf(stub.calls, 'storage:company-docs').at(0), { op: 'upload', args: ['docs/abcdef12-3456-4000-8000-000000000000.pdf', { blob: 1000 }, { contentType: 'application/pdf', upsert: false }] });
  const ins = opsOf(stub.calls, 'company_docs').find((c) => c.op === 'insert'); eq(ins.args[0], { name: 'السجل التجاري', type: 'سجل تجاري', doc_no: '1234', issued: '2025-01-01', expires: '2026-12-01', path: 'docs/abcdef12-3456-4000-8000-000000000000.pdf', size: 1000, mime: 'application/pdf', notes: null });
  eq(logs.at(-1), ['settings.doc.add', 'سجل تجاري', { entity: 'settings', entity_id: D }]);
  eq((await S.addDoc(file('text/plain', 10), { name: 'x', type: 'y' })).field, 'file'); eq((await S.addDoc(file('image/png', 10), { name: '', type: 'y' })).field, 'name'); eq((await S.addDoc(file('image/png', 10), { name: 'x', type: 'y', expires: '12/2026' })).field, 'expires');
  eq(await S.updateDoc(D, { expires: '2027-01-01', notes: ' ملاحظة ' }), { ok: true }); eq(opsOf(stub.calls, 'company_docs').filter((c) => c.op === 'update').at(-1).args, [{ expires: '2027-01-01', notes: 'ملاحظة' }]); eq(logs.at(-1)[1], 'expires, notes');
  const url = await S.docUrl(D); eq(url, { ok: true, url: 'https://signed.test/doc' }); eq(opsOf(stub.calls, 'storage:company-docs').at(-1), { op: 'createSignedUrl', args: [row.path, 60] }); eq(logs.at(-1), ['settings.doc.view', 'سجل تجاري', { entity: 'settings', entity_id: D }]);
  eq(await S.removeDoc(D), { ok: true }); eq(opsOf(stub.calls, 'company_docs').some((c) => c.op === 'delete'), true); eq(opsOf(stub.calls, 'storage:company-docs').at(-1), { op: 'remove', args: [[row.path]] });
  // a refused insert removes the uploaded file
  const bad = load({ responses: { company_docs: (calls) => (calls.some((c) => c.op === 'insert') ? { data: null, error: { code: '42501', message: 'rls' } } : ok([])) } }); await bad.S.load();
  eq((await bad.S.addDoc(file('image/png', 10), { name: 'x', type: 'y' })).reason, 'forbidden'); eq(opsOf(bad.stub.calls, 'storage:company-docs').at(-1).op, 'remove');
  // the logos: the file into bucket settings, the path into the brand row, a signed link cached
  const up = await S.uploadLogo('color', file('image/svg+xml', 500)); eq(up.ok, true); assert.match(up.path, /^brand\/color-[a-z0-9]+\.svg$/);
  eq(opsOf(stub.calls, 'settings').filter((c) => c.op === 'upsert').at(-1).args[0].data.logos.color, up.path); eq(logs.at(-1), ['settings.brand.logo', 'color', { entity: 'settings', entity_id: null }]);
  eq((await S.uploadLogo('huge', file('image/png', 10))).reason, 'invalid'); eq((await S.uploadLogo('mark', file('image/png', 3 * 1024 * 1024))).field, 'file');
  eq(await S.logoUrl(up.path), 'https://signed.test/logo'); eq(await S.logoUrl(up.path), 'https://signed.test/logo'); eq(opsOf(stub.calls, 'storage:settings').filter((c) => c.op === 'createSignedUrl').length, 1, 'cached'); eq(await S.logoUrl('../etc'), null);
  const member = load({ role: 'ops', perms: { 'settings.view': 'F' } }); await member.S.load(); eq(await member.S.docs(), { ok: true, docs: [] }); eq((await member.S.addDoc(file('image/png', 10), { name: 'x', type: 'y' })).reason, 'forbidden');
});

// ---------------------------------------------------------------- phase 12 T3: the saved lists (decision 10)

test('lists(): the public slice first, then the row, else block 12\'s defaults — «أخرى» always last; saveLists cleans, refuses a bad list, writes the row «lists» whole and logs counts only', async () => {
  // no IbtekrOps in the test window → the bare default [أخرى]
  // owner batch 14 Nov (decisions 4 and 8): + the makers' stop reasons, the shipping companies and the shown status names
  const X = { stop: ['تأخير متكرر', 'جودة', 'عدم رد', 'طلب المبتكر', 'أخرى'], shipping: ['بوسطة', 'أرامكس', 'مندوب إبتكر'], labels: {} };
  const r0 = load(); await r0.S.load();
  eq(r0.S.lists(), { cancel: ['أخرى'], returns: ['أخرى'], ...X });
  // the row «lists» (the admin's page): cleaned, «أخرى» moved last
  const r1 = load({ responses: { settings: ok(SETTINGS.concat([{ section: 'lists', data: { cancel: ['أخرى', 'سبب 1', ' سبب   2 '], returns: ['عيب'] } }])) } }); await r1.S.load();
  eq(r1.S.lists(), { cancel: ['سبب 1', 'سبب 2', 'أخرى'], returns: ['عيب', 'أخرى'], ...X });
  // the public slice wins (every member gets it with the sign-in)
  const r2 = load({ responses: { 'rpc:settings_public': ok({ brand: {}, quick: {}, lists: { cancel: ['من الصفحة'] }, general: {}, security: {}, notif: {} }) } }); await r2.S.loadPublic();
  eq(r2.S.lists(), { cancel: ['من الصفحة', 'أخرى'], returns: ['أخرى'], ...X });
  // saveLists: cleaned, the whole row, logged without the texts
  const r3 = load(); await r3.S.load();
  const saved = await r3.S.saveLists({ cancel: ['أخرى', ' العميل مش بيرد ', 'أوردر مكرر'], returns: ['فيه عيب'] });
  eq(saved, { ok: true, lists: { cancel: ['العميل مش بيرد', 'أوردر مكرر', 'أخرى'], returns: ['فيه عيب', 'أخرى'], ...X } });
  const up = r3.stub.calls.filter((c) => c.op === 'upsert').at(-1).args[0];
  eq(up, { section: 'lists', data: { cancel: ['العميل مش بيرد', 'أوردر مكرر'], returns: ['فيه عيب'] } });
  eq(r3.logs.at(-1).slice(0, 2), ['settings.lists.save', 'cancel, returns']);
  assert.ok(!JSON.stringify(r3.logs).includes('أوردر مكرر'));
  eq(await r3.S.saveLists({ cancel: [], returns: ['x'] }), { ok: false, reason: 'invalid', field: 'cancel' });
  eq(await r3.S.saveLists({ cancel: ['a', 'a'], returns: ['x'] }), { ok: false, reason: 'invalid', field: 'cancel' }, 'a repeat');
  eq(await r3.S.saveLists({ cancel: ['a'.repeat(61)], returns: ['x'] }), { ok: false, reason: 'invalid', field: 'cancel' }, 'too long');
  const ops = load({ role: 'ops' }); assert.equal((await ops.S.saveLists({ cancel: ['a'], returns: ['b'] })).reason, 'forbidden');
  // one list at a time: the others stay (cancel / returns always written), a shipping company list has no «أخرى»
  const s2 = await r3.S.saveLists({ shipping: ['بوسطة', ' J&T '] });
  assert.equal(s2.ok, true); eq(s2.lists.shipping, ['بوسطة', 'J&T']);
  eq(r3.stub.calls.filter((c) => c.op === 'upsert').at(-1).args[0].data, { cancel: ['العميل مش بيرد', 'أوردر مكرر'], returns: ['فيه عيب'], shipping: ['بوسطة', 'J&T'] });
  eq(await r3.S.saveLists({ stop: [] }), { ok: false, reason: 'invalid', field: 'stop' });
  // the shown name of a status: known statuses only, not the same as the value, ≤ 40, no < >; the value stays everywhere else
  const s3 = await r3.S.saveLists({ labels: { order: { 'جاري التنفيذ': ' تحت  التصنيع ', 'مكتمل': 'مكتمل', 'مش حالة': 'x', 'ملغي': '<b>' }, sub: { 'وصل المخزن': 'وصل عندنا' }, other: { a: 'b' } } });
  eq(s3.lists.labels, { order: { 'جاري التنفيذ': 'تحت التصنيع' }, sub: { 'وصل المخزن': 'وصل عندنا' } });
  assert.equal(r3.S.statusLabel('order', 'جاري التنفيذ'), 'تحت التصنيع'); assert.equal(r3.S.statusLabel('order', 'مكتمل'), 'مكتمل');
  assert.equal(r3.S.statusLabel('confirm', 'وصل المخزن'), 'وصل المخزن', 'a name belongs to its kind only');
  eq(r3.stub.calls.filter((c) => c.op === 'upsert').at(-1).args[0].data.shipping, ['بوسطة', 'J&T'], 'the labels save keeps the saved shipping list');
  assert.ok(!JSON.stringify(r3.logs).includes('J&T') && !JSON.stringify(r3.logs).includes('التصنيع'));
});
