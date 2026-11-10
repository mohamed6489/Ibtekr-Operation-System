import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// directory.js against a stub IBSupabase: perm(key) is has_perm's rule on the loaded rows (0001) — an active admin 'F', else my
// custom_perms[key] when present (even 'N'), else my role's permissions[key], else 'N'; load() also loads the vendors
// (IBVendors.load) and clear() forgets them.
const src = readFileSync(new URL('../../app/js/adapter/directory.js', import.meta.url), 'utf8');
const ROLES = [{ id: 'admin', name: 'أدمن', permissions: { 'vendors.view': 'F', 'vendors.edit': 'F' } }, { id: 'ops', name: 'عمليات', permissions: { 'vendors.view': 'F', 'vendors.edit': 'P', 'vendors.toggle': 'N', 'sensitive.vendor_bank': 'N' } }];
const profile = (o) => ({ id: 'u1', member_code: 'M02', name: 'سارة أحمد', email: 'ops.dev@ibtekr.local', phone: '01000000002', role_id: 'ops', title: '', dept: '', manager_id: null, status: 'active', twofa: false, custom_perms: {}, ...o });
function load({ me = profile(), signedIn = true } = {}) {
  const stub = stubClient({ responses: { profiles: { data: [me], error: null }, roles: { data: ROLES, error: null } } });
  const members = []; const calls = [];
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => (signedIn ? { user: { id: 'u1' } } : null) },
    IBKit: { store: { members }, setMe: (code) => calls.push(['setMe', code]) },
    IBVendors: { load: () => { calls.push(['vendors.load']); return Promise.resolve(); }, clear: () => calls.push(['vendors.clear']) } };
  runInNewContext(src, { window, document: { dispatchEvent() {} }, Event });
  return { D: window.IBDirectory, calls, queries: stub.calls, members };
}

test('load asks roles.permissions and my profile\'s custom_perms, then loads the vendors with the session', async () => {
  const { D, calls, queries } = load();
  await D.load();
  assert.deepEqual(opsOf(queries, 'roles'), [{ op: 'select', args: ['id, name, permissions'] }]);
  assert.match(opsOf(queries, 'profiles')[0].args[0], /\bcustom_perms\b/);
  assert.deepEqual(calls, [['setMe', 'M02'], ['vendors.load']]);
});

test('perm: the role\'s matrix, a custom_perms entry first (even N), unknown keys N; nothing before a load; admin F everywhere', async () => {
  const { D } = load();
  assert.equal(D.perm('vendors.edit'), 'N'); // not loaded yet
  await D.load();
  assert.equal(D.perm('vendors.view'), 'F');
  assert.equal(D.perm('vendors.edit'), 'P');
  assert.equal(D.perm('vendors.toggle'), 'N');
  assert.equal(D.perm('sensitive.commission'), 'N'); // not in the matrix
  const custom = load({ me: profile({ custom_perms: { 'vendors.edit': 'F', 'vendors.view': 'N' } }) });
  await custom.D.load();
  assert.equal(custom.D.perm('vendors.edit'), 'F');
  assert.equal(custom.D.perm('vendors.view'), 'N');
  assert.equal(custom.D.perm('vendors.toggle'), 'N');
  const admin = load({ me: profile({ role_id: 'admin', custom_perms: { 'vendors.edit': 'N' } }) });
  await admin.D.load();
  assert.equal(admin.D.perm('vendors.edit'), 'F'); // an admin's custom_perms do not apply (has_perm)
  assert.equal(admin.D.perm('anything.else'), 'F');
});

test('a suspended profile has no permission; clear forgets the rows and the vendors', async () => {
  const { D, calls } = load({ me: profile({ status: 'suspended' }) });
  await D.load();
  assert.equal(D.perm('vendors.view'), 'N');
  assert.deepEqual(calls, [['setMe', 'M02']]); // nothing loaded for a suspended member
  const ok = load();
  await ok.D.load();
  ok.D.clear();
  assert.equal(ok.D.perm('vendors.view'), 'N');
  assert.equal(ok.D.me(), null);
  assert.deepEqual(ok.calls, [['setMe', 'M02'], ['vendors.load'], ['vendors.clear']]);
});

// «ملفي › تعديل بياناتي» (phase 10): my own mobile on profiles — Arabic digits read, an Egyptian mobile only, taken → 'taken'
test('updatePhone: my row only, Arabic digits read, an invalid number refused before any request, a taken one → taken, the same one → nothing sent', async () => {
  const stub = stubClient({ responses: { profiles: (q) => (q.some((x) => x.op === 'update') ? { data: [{ id: 'u1' }], error: null } : { data: [profile()], error: null }), roles: { data: ROLES, error: null } } });
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => ({ user: { id: 'u1' } }) }, IbtekrOps: { toLatin: (x) => String(x).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) },
    IBKit: { store: { members: [] }, setMe() {} } };
  runInNewContext(src, { window, document: { dispatchEvent() {} }, Event });
  const D = window.IBDirectory; await D.refresh();
  assert.deepEqual({ ...(await D.updatePhone('0123')) }, { ok: false, reason: 'invalid' });
  assert.deepEqual({ ...(await D.updatePhone('01000000002')) }, { ok: true, same: true });
  assert.equal(opsOf(stub.calls, 'profiles').filter((c) => c.op === 'update').length, 0, 'nothing sent before a valid, new number');
  assert.deepEqual({ ...(await D.updatePhone('٠١٢٢٣٣٣٤٤٤٥')) }, { ok: true });
  const up = opsOf(stub.calls, 'profiles');
  assert.deepEqual(up.find((c) => c.op === 'update').args, [{ phone: '01223334445' }]);
  assert.deepEqual(up.find((c) => c.op === 'eq').args, ['id', 'u1']);
  stub.responses.profiles = { data: null, error: { code: '23505', message: 'duplicate key' } };
  assert.deepEqual({ ...(await D.updatePhone('01112223334')) }, { ok: false, reason: 'taken' });
});

// phase 13 decision 22: my own name on profiles — 2..80 characters, spaces collapsed, «<>» dropped, the same one sends nothing
test('updateName: my row only, spaces collapsed and <> dropped, too short / too long refused before any request, the same one → nothing sent', async () => {
  const stub = stubClient({ responses: { profiles: (q) => (q.some((x) => x.op === 'update') ? { data: [{ id: 'u1' }], error: null } : { data: [profile()], error: null }), roles: { data: ROLES, error: null } } });
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => ({ user: { id: 'u1' } }) }, IbtekrOps: { toLatin: (x) => String(x) }, IBKit: { store: { members: [] }, setMe() {} } };
  runInNewContext(src, { window, document: { dispatchEvent() {} }, Event });
  const D = window.IBDirectory; await D.refresh();
  const me = D.me().name;
  assert.deepEqual({ ...(await D.updateName(' a ')) }, { ok: false, reason: 'invalid' });
  assert.deepEqual({ ...(await D.updateName('x'.repeat(81))) }, { ok: false, reason: 'invalid' });
  assert.deepEqual({ ...(await D.updateName('  ' + me + ' ')) }, { ok: true, same: true });
  assert.equal(opsOf(stub.calls, 'profiles').filter((c) => c.op === 'update').length, 0, 'nothing sent before a valid, new name');
  assert.deepEqual({ ...(await D.updateName('  سارة   <b>أحمد</b> ')) }, { ok: true });
  const up = opsOf(stub.calls, 'profiles');
  assert.deepEqual(up.find((c) => c.op === 'update').args, [{ name: 'سارة bأحمد/b' }]);
  assert.deepEqual(up.find((c) => c.op === 'eq').args, ['id', 'u1']);
  stub.responses.profiles = { data: null, error: { code: '42501', message: 'only an admin can change this profile field' } };
  assert.deepEqual({ ...(await D.updateName('اسم تاني')) }, { ok: false, reason: 'forbidden' });
});
