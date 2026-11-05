// deno-lint-ignore-file no-explicit-any
// team-admin handler tests (phase 10, decisions 5 / 6 / 13): the admin only; «إضافة عضو» makes the Auth user, the profile with the
// next member code and the HR row, and answers the temporary password once (never stored or logged); a taken email / phone; a
// failure after the Auth user removes it again; a new password for a member. The fake database of ../_test/fakes.ts; no network.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { handler, memberInput, tempPassword } from './index.ts';
import { ENV, NOW, fakeDb } from '../_test/fakes.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const ROLES = ['admin', 'ops', 'cs', 'accounts', 'vendors_followup', 'viewer'].map((id, i) => ({ id, name: id, description: '', is_system: true, permissions: {}, sort: i }));
const PROFILES = [{ id: ADMIN, member_code: 'M01', name: 'صفوت كمال', email: 'owner@ibtekr.club', phone: '01000000001', role_id: 'admin', status: 'active' },
  { id: '00000000-0000-4000-8000-0000000000a2', member_code: 'M07', name: 'سارة أحمد', email: 'sara@ibtekr.club', phone: '01000000002', role_id: 'ops', status: 'active' }];
function setup(opts: { createErr?: string; profileFail?: boolean } = {}) {
  const db = fakeDb({ roles: ROLES, profiles: PROFILES.map((p) => ({ ...p })) }, opts.profileFail ? { fail: (c: any) => (c.table === 'profiles' && c.op === 'insert' ? { code: '23514', message: 'check' } : null) } : {});
  const made: any[] = []; const removed: string[] = []; const passwords: any[] = [];
  const auth = {
    create: async (email: string, password: string, name: string) => { if (opts.createErr) return { error: opts.createErr }; const id = '00000000-0000-4000-8000-0000000000f' + (made.length + 1); made.push({ id, email, password, name }); return { id }; },
    setPassword: async (id: string, password: string) => { passwords.push({ id, password }); return null; },
    remove: async (id: string) => { removed.push(id); },
  };
  const userDb = (jwt: string) => fakeDb({}, { rpc: { is_admin: () => jwt === 'jwt-admin' } });
  const deps = { env: { ...ENV }, db, now: () => NOW, userDb, userId: async (jwt: string) => (jwt === 'jwt-admin' ? ADMIN : jwt === 'jwt-member' ? PROFILES[1].id : null), auth };
  return { db, deps, made, removed, passwords };
}
async function call(deps: any, body: any, jwt = 'jwt-admin') {
  const res = await handler(new Request('http://x/team-admin', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
const NEW = { action: 'member_create', name: '  كريم   سامي ', email: 'Karim@Ibtekr.club', phone: '٠١٠١٢٣٤٥٦٧٨', role: 'cs', title: 'خدمة عملاء', dept: 'خدمة العملاء',
  manager_id: PROFILES[1].id, shift_start: '10:00', shift_end: '18:00', hire_date: '2026-11-01' };

Deno.test('the admin only: no token, a member, an unknown action', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, NEW, 'jwt-none')).res.status, 401);
  assertEquals((await call(deps, NEW, 'jwt-member')).res.status, 401, 'is_admin false');
  assertEquals((await call(deps, { action: 'drop_all' })).res.status, 400);
});

Deno.test('member_create: the Auth user, the profile with the next code, the HR row; the password answered once and never logged', async () => {
  const { db, deps, made } = setup();
  const { res, body } = await call(deps, NEW);
  assertEquals(res.status, 200);
  assertEquals(body.member_code, 'M08', 'after the highest code');
  assertEquals(made.length, 1); assertEquals(made[0].email, 'karim@ibtekr.club'); assertEquals(made[0].name, 'كريم سامي');
  assertEquals(body.password, made[0].password); assertEquals(body.password.length, 12);
  const p = db.rows('profiles').find((r: any) => r.id === body.id);
  assertEquals([p.name, p.email, p.phone, p.role_id, p.manager_id, p.status, p.dept], ['كريم سامي', 'karim@ibtekr.club', '01012345678', 'cs', PROFILES[1].id, 'active', 'خدمة العملاء']);
  const hr = db.rows('hr_members').find((r: any) => r.member_id === body.id);
  assertEquals([hr.shift_start, hr.shift_end, hr.hire_date], ['10:00', '18:00', '2026-11-01']);
  const log = db.rows('activity_log');
  assertEquals(log.map((r: any) => [r.action, r.entity_id, r.new_value]), [['hr.member.create', body.id, 'كريم سامي']]);
  assert(!JSON.stringify(db.rows('activity_log')).includes(body.password) && !JSON.stringify(db.rows('activity_log')).includes('karim@'), 'no password or email in the log');
});

Deno.test('member_create: a bad field, an unknown role or manager, a taken email / phone; a failure after the Auth user removes it', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { ...NEW, email: 'not-an-email' })).body, { error: 'invalid', field: 'email' });
  assertEquals((await call(deps, { ...NEW, phone: '12345' })).body, { error: 'invalid', field: 'phone' });
  assertEquals((await call(deps, { ...NEW, role: 'owner' })).body, { error: 'invalid', field: 'role' });
  assertEquals((await call(deps, { ...NEW, manager_id: '00000000-0000-4000-8000-0000000000ff' })).body, { error: 'invalid', field: 'manager_id' });
  assertEquals((await call(deps, { ...NEW, shift_start: '25:00' })).body, { error: 'invalid', field: 'shift' });
  const taken = await call(deps, { ...NEW, email: 'SARA@ibtekr.club' });
  assertEquals([taken.res.status, taken.body.field], [409, 'email']);
  assertEquals((await call(deps, { ...NEW, phone: '01000000002' })).body, { error: 'exists', field: 'phone' });
  const authTaken = setup({ createErr: 'exists' });
  assertEquals((await call(authTaken.deps, NEW)).res.status, 409);
  const broken = setup({ profileFail: true });
  const r = await call(broken.deps, NEW);
  assertEquals(r.res.status, 500); assertEquals(broken.removed, [broken.made[0].id], 'the Auth user removed again');
});

Deno.test('member_password: a new temporary password for a member (not one\'s own), logged without it', async () => {
  const { db, deps, passwords } = setup();
  const { res, body } = await call(deps, { action: 'member_password', member_id: PROFILES[1].id });
  assertEquals(res.status, 200); assertEquals(passwords, [{ id: PROFILES[1].id, password: body.password }]);
  assertEquals(db.rows('activity_log').map((r: any) => [r.action, r.new_value]), [['hr.member.password', 'سارة أحمد']]);
  assertEquals((await call(deps, { action: 'member_password', member_id: ADMIN })).res.status, 400, 'not the admin\'s own');
  assertEquals((await call(deps, { action: 'member_password', member_id: '00000000-0000-4000-8000-0000000000ff' })).res.status, 404);
});

Deno.test('tempPassword / memberInput: the shape of a password; the input cleaned', () => {
  for (let i = 0; i < 20; i++) { const p = tempPassword(); assertMatch(p, /^[a-zA-Z2-9]{12}$/); assert(/[a-zA-Z]/.test(p) && /[2-9]/.test(p)); assert(!/[01lIoO]/.test(p)); }
  const r: any = memberInput({ ...NEW, title: '<b>x</b>' });
  assertEquals([r.ok, r.v.title], [true, 'b x /b']);
});
