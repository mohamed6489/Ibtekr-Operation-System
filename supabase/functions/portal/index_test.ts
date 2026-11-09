// deno-lint-ignore-file no-explicit-any
// portal handler tests (phase 13 T4, decision 10): the sign-in through vendor_login_check (the fake RPC plays 0065), the first sign-in's
// forced password, the token (HS256, 12 hours) and its scope, the maker's own view filtered by his vendor id only (no customer field,
// no other maker), the account figures, the bank request ticket (one open at a time), the reset request (the same answer whatever the
// user; the mail only when Resend is set) and the reset by token. The fake database of ../_test/fakes.ts; no network.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { handler, signToken, verifyToken } from './index.ts';
import { ENV, NOW, fakeDb, vendorId, vendorRow } from '../_test/fakes.ts';

const SECRET = 'portal-test-secret-0123456789abcdef0123456789abcdef';
const V1 = vendorId(11), V2 = vendorId(12);
const loginRows = () => [
  { vendor_id: V1, username: 'bian.eg', email: 'bian.dev@ibtekr.local', pw_mode: 'temp', status: 'invited', must_change: true, own_password: false, secret_id: '00000000-0000-4000-8000-00000000c0de', fails: 0 },
  { vendor_id: V2, username: 'other', email: 'other.dev@ibtekr.local', pw_mode: 'temp', status: 'active', must_change: false, own_password: true, secret_id: '00000000-0000-4000-8000-00000000c0df', fails: 0 },
];
// the 0065 functions, played in memory on this setup's own rows: the password of bian.eg is Bian2026 until set_own changes it
function setup(opts: { resend?: boolean; mailFail?: boolean } = {}) {
  const LOGINS = loginRows();
  const pw: Record<string, string> = { [V1]: 'Bian2026', [V2]: 'Other999' }; const locked: Record<string, boolean> = {}; const fails: Record<string, number> = {};
  const resets: { vendor: string; token: string; used: boolean }[] = []; const rpcLog: any[] = []; const mails: any[] = [];
  // deno-lint-ignore prefer-const
  let db: any;
  const rpc = {
    portal_jwt_secret: () => SECRET,
    vendor_login_check: ({ p_user, p_password }: any) => {
      rpcLog.push(['check', p_user]);
      const row = LOGINS.find((l) => l.username === p_user || l.email === p_user); if (!row) return { ok: false, reason: 'wrong' };
      // the status and the secret as the fake database now holds them (a test may disable the login or drop its secret)
      const live = db.rows('vendor_logins').find((l: any) => l.vendor_id === row.vendor_id) ?? row;
      if (live.status === 'disabled') return { ok: false, reason: 'disabled' };
      if (locked[row.vendor_id]) return { ok: false, reason: 'locked', until: '2026-10-25T12:15:00.000Z' };
      if (!live.secret_id) return { ok: false, reason: 'nopw' };
      if (pw[row.vendor_id] !== p_password) { fails[row.vendor_id] = (fails[row.vendor_id] ?? 0) + 1; if (fails[row.vendor_id] >= 5) { locked[row.vendor_id] = true; return { ok: false, reason: 'locked', until: '2026-10-25T12:15:00.000Z' }; } return { ok: false, reason: 'wrong', left: 5 - fails[row.vendor_id] }; }
      return { ok: true, vendor_id: row.vendor_id, must_change: row.must_change, own_password: row.own_password };
    },
    vendor_login_set_own: ({ p_vendor, p_password }: any) => { rpcLog.push(['set_own', p_vendor]); const row = LOGINS.find((l) => l.vendor_id === p_vendor); if (!row) throw Object.assign(new Error('no row'), { code: 'P0002' }); pw[p_vendor] = p_password; row.must_change = false; row.own_password = true; return NOW; },
    vendor_login_reset_create: ({ p_user }: any) => { rpcLog.push(['reset_create', p_user]); const row = LOGINS.find((l) => l.username === p_user || l.email === p_user); if (!row) return null; const token = 'ab'.repeat(32); resets.push({ vendor: row.vendor_id, token, used: false }); return { vendor_id: row.vendor_id, email: row.email, name: 'بيان', token }; },
    vendor_login_reset_use: ({ p_token, p_password }: any) => { const r = resets.find((x) => x.token === p_token && !x.used); if (!r) throw Object.assign(new Error('bad'), { code: 'P0002' }); r.used = true; pw[r.vendor] = p_password; return r.vendor; },
  };
  db = fakeDb({
    vendors: [vendorRow(11, { name: 'بيان إيجيبت', phone: '01000000011', email: 'bian@x.test' }), vendorRow(12, { name: 'الآخر', phone: '01000000012' })],
    vendor_logins: LOGINS.map((l) => ({ ...l })),
    vendor_bank: [{ vendor_id: V1, method: 'bank', holder: 'Bian Egypt', bank_name: 'NBE', iban: 'EG380019000500000000263180002', wallet: '01000000011' }],
    brands: [{ id: '00000000-0000-4000-8000-00000000b001', name: 'Bian', store_vendor_id: V1 }, { id: '00000000-0000-4000-8000-00000000b002', name: 'Rope', store_vendor_id: V2 }, { id: '00000000-0000-4000-8000-00000000b003', name: 'Old Brand', store_vendor_id: null }],
    brand_owners: [{ id: 1, brand_id: '00000000-0000-4000-8000-00000000b003', vendor_id: V1, since: '2026-01-01' }],
    orders: [
      { id: 181668, number: '181668', status: 'جاري التنفيذ', placed_at: '2026-10-13T10:00:00Z', customer_name: 'سلوى', customer_phone: '01200007052' },
      { id: 180686, number: '180686', status: 'مكتمل', placed_at: '2026-10-01T10:00:00Z', customer_name: 'هدير', customer_phone: '01000007030' },
      { id: 150001, number: '150001', status: 'مكتمل', placed_at: '2026-06-01T10:00:00Z', customer_name: 'قديم', customer_phone: '01000000000' },
    ],
    sub_orders: [{ id: 1, order_id: 181668, vendor_id: V1, woo_order_id: 181669, woo_status: 'processing' }, { id: 2, order_id: 181668, vendor_id: V2, woo_order_id: 181670, woo_status: 'processing' }, { id: 3, order_id: 180686, vendor_id: V1, woo_order_id: 180687, woo_status: 'completed' }, { id: 4, order_id: 150001, vendor_id: V1, woo_order_id: 150002, woo_status: 'completed' }],
    order_items: [{ id: 11, order_id: 181668, sub_order_id: 1, vendor_id: V1, name: 'Cushion', qty: 2, total: 700, status: 'قيد التنفيذ', expected_at: '2026-10-26' }, { id: 12, order_id: 181668, sub_order_id: 2, vendor_id: V2, name: 'Other thing', qty: 1, total: 100, status: '' },
      { id: 13, order_id: 180686, sub_order_id: 3, vendor_id: V1, name: 'Vase', qty: 1, total: 300, status: 'تم الشحن للعميل' }, { id: 14, order_id: 150001, sub_order_id: 4, vendor_id: V1, name: 'Ancient', qty: 1, total: 50, status: 'تم الشحن للعميل' }],
    dokan_balances: [{ vendor_id: V1, woo_vendor_id: 11, balance: 5000, synced_at: NOW }],
    acc_vendor_moves: [{ id: 1, vendor_id: V1, on_date: '2026-10-01', direction: 'withdraw', kind: 'عربون', amount: 1000 }, { id: 2, vendor_id: V1, on_date: '2026-10-02', direction: 'withdraw', kind: 'مواصلات', amount: 150 }, { id: 3, vendor_id: V2, on_date: '2026-10-02', direction: 'withdraw', kind: 'عربون', amount: 9999 }],
    dokan_withdrawals: [{ id: 501, woo_vendor_id: 11, vendor_id: V1, amount: 2000, status: 'approved', method: 'bank', requested_at: '2026-10-20T10:00:00' }, { id: 502, woo_vendor_id: 12, vendor_id: V2, amount: 5, status: 'pending', method: 'bank', requested_at: '2026-10-21T10:00:00' }],
  }, { rpc });
  const env = { ...ENV, ...(opts.resend ? { RESEND_API_KEY: 're_test', RESEND_FROM: 'alerts@ibtekr.club', PORTAL_URL: 'https://ops.test/portal.html' } : {}) };
  const fetchFake = async (url: string, init: any) => { mails.push({ url, body: JSON.parse(init.body) }); return new Response(opts.mailFail ? '{"error":1}' : '{"id":"m1"}', { status: opts.mailFail ? 500 : 200 }); };
  const deps = { env, db, now: () => NOW, fetch: fetchFake as any };
  return { db, deps, rpcLog, mails, resets, pw };
}
async function call(deps: any, body: any, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }; if (token) headers['x-portal-token'] = token;
  const res = await handler(new Request('http://x/portal', { method: 'POST', headers, body: JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}
const NOW_SEC = Math.floor(Date.parse(NOW) / 1000);

Deno.test('the token: signed and verified with the secret; a tampered, foreign or expired token is nothing', async () => {
  const t = await signToken(SECRET, { sub: V1, scope: 'full', iat: NOW_SEC, exp: NOW_SEC + 100 });
  assertEquals((await verifyToken(SECRET, t, NOW_SEC))!.sub, V1);
  assertEquals(await verifyToken('other-secret-0123456789abcdef0123456789abcdef', t, NOW_SEC), null);
  assertEquals(await verifyToken(SECRET, t + 'x', NOW_SEC), null);
  assertEquals(await verifyToken(SECRET, t, NOW_SEC + 101), null, 'expired');
  const parts = t.split('.'); const forged = parts[0] + '.' + btoa(JSON.stringify({ sub: V2, scope: 'full', iat: NOW_SEC, exp: NOW_SEC + 100 })).replace(/=+$/, '') + '.' + parts[2];
  assertEquals(await verifyToken(SECRET, forged, NOW_SEC), null, 'a changed sub breaks the signature');
});

Deno.test('login: wrong → 401 with the tries left, the fifth locks; a right password on a first sign-in gives a «first» token that opens set_password only; after it everything opens', async () => {
  const { deps, rpcLog } = setup();
  let r = await call(deps, { action: 'login', user: 'Bian.EG', password: 'nope1234' });
  assertEquals([r.res.status, r.body], [401, { error: 'wrong' }], 'no tries-left in the answer: the same as an unknown user');
  for (let i = 0; i < 3; i++) await call(deps, { action: 'login', user: 'bian.eg', password: 'nope1234' });
  r = await call(deps, { action: 'login', user: 'bian.eg', password: 'nope1234' });
  assertEquals([r.res.status, r.body.error, typeof r.body.until], [401, 'locked', 'string']);
  assertEquals((await call(deps, { action: 'login', user: 'nobody', password: 'x1234567' })).body, { error: 'wrong' }, 'an unknown user looks like a wrong password');
  // a disabled login and a login without a password read «wrong» too (no account enumeration); a maker taken off the site has no session
  const { deps: d3, db: db3 } = setup();
  await db3.from('vendor_logins').update({ status: 'disabled' }).eq('vendor_id', V2);
  assertEquals((await call(d3, { action: 'login', user: 'other', password: 'Other999' })).body, { error: 'wrong' }, 'disabled reads wrong');
  await db3.from('vendor_logins').update({ status: 'active', secret_id: null }).eq('vendor_id', V2);
  assertEquals((await call(d3, { action: 'login', user: 'other', password: 'Other999' })).body, { error: 'wrong' }, 'no password reads wrong');
  await db3.from('vendors').update({ status: 'inactive' }).eq('id', V1);
  const tokV1 = await signToken(SECRET, { sub: V1, scope: 'full', iat: NOW_SEC, exp: NOW_SEC + 3600 });
  assertEquals((await call(d3, { action: 'me' }, tokV1)).res.status, 401, 'an inactive maker has no session');
  assertEquals((await call(deps, { action: 'login', user: '', password: 'x' })).res.status, 400);
  // the other maker signs in straight (own password, nothing to change)
  const { deps: d2 } = setup();
  r = await call(d2, { action: 'login', user: 'bian.eg', password: 'Bian2026' });
  assertEquals([r.res.status, r.body.ok, r.body.must_change, r.body.name], [200, true, true, 'بيان إيجيبت']);
  const first = r.body.token;
  assertEquals((await call(d2, { action: 'me' }, first)).body, { error: 'must_change' }, 'a first token opens nothing but set_password');
  assertEquals((await call(d2, { action: 'set_password', password: 'weak' }, first)).body.error, 'weak_password');
  r = await call(d2, { action: 'set_password', password: 'MyOwn2026' }, first);
  assertEquals([r.res.status, r.body.ok], [200, true]); const full = r.body.token;
  assertEquals((await call(d2, { action: 'me' }, full)).res.status, 200);
  assertEquals((await call(d2, { action: 'set_password', password: 'Again2026' }, full)).body, { error: 'use_change_password' }, 'a signed-in maker changes the password with the current one only');
  assertEquals((await call(d2, { action: 'me' })).res.status, 401, 'no token');
  assertEquals((await call(d2, { action: 'me' }, 'garbage')).res.status, 401);
  // a token made before the password change is dead; a disabled login ends the session too
  const stale = await signToken(SECRET, { sub: V1, scope: 'full', iat: NOW_SEC - 600, exp: NOW_SEC + 3600 });
  d2.db.rows('vendor_logins'); // (sanity: the fake holds the rows)
  const { data: row } = await d2.db.from('vendor_logins').select('vendor_id, password_set_at').eq('vendor_id', V1).maybeSingle();
  if (!row.password_set_at) await d2.db.from('vendor_logins').update({ password_set_at: NOW }).eq('vendor_id', V1);
  assertEquals((await call(d2, { action: 'me' }, stale)).res.status, 401, 'a token older than the password change');
  await d2.db.from('vendor_logins').update({ status: 'disabled' }).eq('vendor_id', V1);
  assertEquals((await call(d2, { action: 'me' }, full)).res.status, 401, 'a disabled login');
  await d2.db.from('vendor_logins').update({ status: 'active' }).eq('vendor_id', V1);
  // the old password is gone, the new one signs in with a full token
  assertEquals((await call(d2, { action: 'login', user: 'bian.eg', password: 'Bian2026' })).res.status, 401);
  r = await call(d2, { action: 'login', user: 'bian.eg', password: 'MyOwn2026' }); assertEquals([r.body.ok, r.body.must_change], [true, false]);
  assert(!JSON.stringify(rpcLog).includes('Bian2026'), 'the log of the fake keeps no password (sanity of the test itself)');
});

Deno.test('me / orders / account: the maker\'s own rows only — his brands (store + owned), his bank masked, his lines of the last 90 days with the delay rule, his ledger and last withdrawals; nothing of the other maker, no customer field', async () => {
  const { deps } = setup();
  const full = (await call(deps, { action: 'login', user: 'other', password: 'Other999' })).body.token;
  const tokenV1 = await signToken(SECRET, { sub: V1, scope: 'full', iat: NOW_SEC, exp: NOW_SEC + 3600 });
  let r = await call(deps, { action: 'me' }, tokenV1);
  assertEquals(r.res.status, 200);
  assertEquals(r.body.v, { id: V1, name: 'بيان إيجيبت', phone: '01000000011', email: 'bian.dev@ibtekr.local', status: 'active' });
  assertEquals(r.body.login, { username: 'bian.eg', ownPassword: false, mustChange: true, lastLoginAt: null });
  assertEquals(r.body.brands.map((b: any) => b.name).sort(), ['Bian', 'Old Brand']);
  assertEquals(r.body.bank, { method: 'bank', holder: 'Bian Egypt', bankName: 'NBE', iban: '•••• •••• •••• 0002', account: null, wallet: '•••• •••• •••• 0011' });
  assert(!JSON.stringify(r.body).includes('EG380019000500000000263180002'), 'no IBAN in clear');
  r = await call(deps, { action: 'orders' }, tokenV1);
  assertEquals(r.body.rows.map((x: any) => [x.order, x.n, x.prod, x.open, x.delivery, x.age]), [['181668', '181669', 'Cushion', true, 'late', 12], ['180686', '180687', 'Vase', false, 'ok', 24]], 'his two lines of the last 90 days; the June one is out, the other maker\'s line is out');
  assert(!JSON.stringify(r.body).includes('سلوى') && !JSON.stringify(r.body).includes('0120000') && !JSON.stringify(r.body).includes('Other thing'));
  r = await call(deps, { action: 'account' }, tokenV1);
  assertEquals(r.body.ledger, { dokan: 5000, deposits: 1000, transport: 150, other: 0, net: 3850, status: 'ليك' });
  assertEquals(r.body.withdrawals, [{ id: 501, amount: 2000, status: 'approved', method: 'bank', at: '2026-10-20T10:00:00' }]);
  // the other maker through his own token sees his own
  r = await call(deps, { action: 'account' }, full); assertEquals(r.body.ledger.dokan, 0); assertEquals(r.body.dokan, false); assertEquals(r.body.ledger.deposits, 9999);
  r = await call(deps, { action: 'me' }, full); assertEquals(r.body.brands, [{ name: 'Rope' }]); assertEquals(r.body.bank, null);
});

Deno.test('bank_request: a ticket for «الحسابات» opened by «بوابة المبتكر», one open at a time; a second ask answers the same ticket; the log carries the uuid and the ticket id only', async () => {
  const { db, deps } = setup();
  const tokenV1 = await signToken(SECRET, { sub: V1, scope: 'full', iat: NOW_SEC, exp: NOW_SEC + 3600 });
  let r = await call(deps, { action: 'bank_request', note: '  غيّرت البنك <b>  ' }, tokenV1);
  assertEquals([r.res.status, r.body.ok], [200, true]); const id = r.body.id;
  const t = db.rows('tickets').find((x: any) => x.id === id);
  assertEquals([t.type, t.title, t.priority, t.assignee_role, t.vendor_id, t.vendor, t.created_by, t.created_by_name, t.created_by_role, t.status], ['vendor', 'طلب تعديل الحساب البنكي — بيان إيجيبت', 'normal', 'الحسابات', V1, 'بيان إيجيبت', null, 'بوابة المبتكر', 'بوابة المبتكر', 'open']);
  assertMatch(t.description, /غيّرت البنك b/); assert(!t.description.includes('<b>'));
  assertEquals(db.rows('ticket_events').filter((e: any) => e.ticket_id === id).map((e: any) => e.kind), ['event', 'message']);
  r = await call(deps, { action: 'bank_request' }, tokenV1);
  assertEquals(r.body, { ok: true, id, existing: true });
  assertEquals(db.rows('tickets').length, 1);
  assertEquals(db.rows('activity_log').map((x: any) => [x.action, x.entity_id, x.new_value]), [['portal.bank_request', V1, String(id)]]);
});

Deno.test('change_password: the current one checked through vendor_login_check, then set_own; a wrong current → 401', async () => {
  const { deps } = setup();
  const full = (await call(deps, { action: 'login', user: 'other', password: 'Other999' })).body.token;
  assertEquals((await call(deps, { action: 'change_password', current: 'bad', password: 'NewOne2026' }, full)).body, { error: 'wrong' });
  assertEquals((await call(deps, { action: 'change_password', current: 'Other999', password: 'short' }, full)).body.error, 'weak_password');
  const r = await call(deps, { action: 'change_password', current: 'Other999', password: 'NewOne2026' }, full);
  assertEquals([r.res.status, r.body.ok, typeof r.body.token], [200, true, 'string']);
  assertEquals((await call(deps, { action: 'login', user: 'other', password: 'NewOne2026' })).body.ok, true);
});

Deno.test('reset_request: the same 200 for a known and an unknown user; the mail goes out through Resend for a known one when the key is set (the link carries the token in the hash, no username); without the key mode team and no mail; reset by token sets the password and signs in, a spent or bad token → 404', async () => {
  const { deps, mails, resets } = setup({ resend: true });
  let r = await call(deps, { action: 'reset_request', user: 'nobody@x.test' }); assertEquals([r.res.status, r.body], [200, { ok: true, mode: 'email' }]); assertEquals(mails.length, 0);
  r = await call(deps, { action: 'reset_request', user: 'BIAN.EG' }); assertEquals(r.body, { ok: true, mode: 'email' });
  assertEquals(mails.length, 1); assertEquals(mails[0].body.to, ['bian.dev@ibtekr.local']); assertEquals(mails[0].body.from, 'alerts@ibtekr.club');
  assertMatch(mails[0].body.html, /https:\/\/ops\.test\/portal\.html#portal-reset\/abab/); assert(!mails[0].body.html.includes('bian.eg'));
  const token = resets[0].token;
  assertEquals((await call(deps, { action: 'reset', token: 'zz', password: 'Fresh5678' })).res.status, 404);
  assertEquals((await call(deps, { action: 'reset', token, password: 'short' })).body.error, 'weak_password');
  r = await call(deps, { action: 'reset', token, password: 'Fresh5678' });
  assertEquals([r.res.status, r.body.ok, r.body.name, typeof r.body.token], [200, true, 'بيان إيجيبت', 'string']);
  assertEquals((await call(deps, { action: 'reset', token, password: 'Fresh5678' })).res.status, 404, 'spent');
  assertEquals((await call(deps, { action: 'login', user: 'bian.eg', password: 'Fresh5678' })).body.ok, true);
  const { deps: noMail, mails: m2 } = setup();
  r = await call(noMail, { action: 'reset_request', user: 'bian.eg' }); assertEquals(r.body, { ok: true, mode: 'team' }); assertEquals(m2.length, 0);
});

Deno.test('the door: an unknown action, bad JSON, GET', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { action: 'drop' })).res.status, 400);
  assertEquals((await handler(new Request('http://x/portal', { method: 'POST', body: '{' }), deps)).status, 400);
  assertEquals((await handler(new Request('http://x/portal', { method: 'GET' }), deps)).status, 405);
});
