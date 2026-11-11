import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// accounts.js (phase 4) against a stub IBSupabase: the three ledgers (voided rows never read), the Dokan mirrors, accounts_sales,
// the writes (insert / update / void with .select), the reasons, the activity rows (no beneficiary, no note), the permissions.
const src = readFileSync(new URL('../../app/js/adapter/accounts.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const ME = 'u1'; const V1 = 'a0000000-0000-4000-8000-000000000001';
const ok = (data) => ({ data, error: null });
const EXP = { id: 7, on_date: '2026-10-20', direction: 'withdraw', category: 'الاشتراكات', beneficiary: 'Canva', beneficiary_other: true, amount: '450.00', note: null, sub_name: 'Canva', sub_is_other: false, sub_ends: '2026-11-20', sub_alerts: ['week'], sub_note: 'سنوي', created_by: ME, created_at: '2026-10-20T08:00:00Z' };
const MOVE = { id: 3, vendor_id: V1, on_date: '2026-10-21', direction: 'withdraw', kind: 'عربون', kind_name: null, amount: 700, note: null, created_by: 'u2', created_at: '2026-10-21T08:00:00Z', settled_by: null, settled_at: null };
const SET = { id: 1, withdraw_id: 400, vendor_id: V1, amount: '1000', moves_net: '300', carry_in: 0, consumed: '300', carry_out: '0', cash: '700', moves: 1, source: 'dokan', approved_by: null, settled_on: '2026-10-01', created_at: 'x' };
function load({ responses = {}, perms = { 'accounts.view': 'F', 'accounts.add': 'F', 'accounts.approve': 'N' } } = {}) {
  const stub = stubClient({ responses: { acc_expenses: ok([EXP]), acc_vendor_moves: ok([MOVE]), acc_account_moves: ok([]), dokan_balances: ok([{ vendor_id: V1, woo_vendor_id: 2376, balance: '2500.50', earning: 9000, sales: 11000, orders: 12, synced_at: 'x' }]),
    dokan_withdrawals: ok([{ id: 501, woo_vendor_id: 2376, vendor_id: V1, amount: '1200', charge: 0, receivable: 1200, status: 'pending', method: 'bank', requested_at: '2026-10-25 12:00:00', synced_at: 'x' }]),
    acc_list_items: ok([{ list: 'subs', name: 'Notion' }, { list: 'ads', name: 'سناب شات' }]), acc_vendor_settlements: ok([SET, { ...SET, id: 2, withdraw_id: 401, carry_out: '250', cash: '0' }]), ...responses } });
  const events = []; const logs = [];
  const window = { IBSupabase: { client: stub.client }, IBAuth: { session: () => ({ user: { id: ME } }) }, IBDirectory: { perm: (k) => perms[k] || 'N' },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBKit: { store: { members: [{ id: 'M01', uid: ME, name: 'صفوت كمال' }, { id: 'M04', uid: 'u2', name: 'منى حسن' }] } },
    IBVendors: { store: { get: (id) => (id === V1 ? { id: V1, name: 'Art Craft' } : null), findByName: (n) => (n === 'Art Craft' ? { id: V1, name: 'Art Craft' } : null) } } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, Promise, Date, Number, String, Array, Object, JSON, Map });
  return { A: window.IBAccounts, stub, events, logs };
}

test('load: the three ledgers without the voided rows (named columns), the Dokan mirrors → the prototype shapes; ib:accounts', async () => {
  const { A, stub, events } = load();
  await A.load();
  assert.equal(A.state(), 'ready');
  assert.deepEqual(opsOf(stub.calls, 'acc_expenses').slice(0, 2), [{ op: 'select', args: ['id, on_date, direction, category, beneficiary, beneficiary_other, amount, note, sub_name, sub_is_other, sub_ends, sub_alerts, sub_note, details, staff_kind, reason, created_by, created_at'] }, { op: 'is', args: ['voided_at', null] }]);
  assert.deepEqual(plain(A.rows('expenses')), [{ id: 7, date: '2026-10-20', direction: 'withdraw', category: 'الاشتراكات', beneficiaryName: 'Canva', beneficiaryIsOther: true, amount: 450, note: '', subName: 'Canva', subIsOther: false, subEnds: '2026-11-20', subAlerts: ['week'], subNote: 'سنوي', details: '', staffKind: '', reason: '', platform: '', source: '', createdById: ME, createdBy: 'صفوت كمال', createdAt: '2026-10-20T08:00:00Z' }]);
  assert.deepEqual(plain(A.rows('vendorMoves'))[0], { id: 3, date: '2026-10-21', direction: 'withdraw', type: 'عربون', typeName: 'عربون', vendorId: V1, vendor: 'Art Craft', amount: 700, note: '', createdById: 'u2', createdBy: 'منى حسن', createdAt: '2026-10-21T08:00:00Z', settledBy: null, settledAt: '' });
  // 0078: the settlements (the server's) and the carry of each maker's latest one
  assert.deepEqual(opsOf(stub.calls, 'acc_vendor_settlements')[0], { op: 'select', args: ['id, withdraw_id, vendor_id, amount, moves_net, carry_in, consumed, carry_out, cash, moves, source, approved_by, settled_on, created_at'] });
  assert.deepEqual(plain(A.settlements()[0]), { id: 1, withdrawId: 400, vendorId: V1, amount: 1000, movesNet: 300, carryIn: 0, consumed: 300, carryOut: 0, cash: 700, moves: 1, source: 'dokan', approvedBy: null, settledOn: '2026-10-01', createdAt: 'x' });
  assert.deepEqual(plain(A.carryOf()), { [V1]: 250 });
  assert.deepEqual(plain(A.toVendorMove({ ...MOVE, settled_by: '900', settled_at: '2026-11-10T10:00:00Z' })).settledBy, 900);
  assert.equal(A.balances()[0].balance, 2500.5);
  assert.deepEqual(plain(A.withdrawals()[0]), { id: 501, store: 2376, vendorId: V1, amount: 1200, charge: 0, receivable: 1200, status: 'pending', method: 'bank', at: '2026-10-25 12:00:00', syncedAt: 'x' });
  assert.ok(events.includes('ib:accounts'));
});

test('accounts.view = N reads nothing', async () => {
  const { A, stub } = load({ perms: {} });
  await A.load();
  assert.equal(stub.calls.filter((c) => c.op === 'from').length, 0);
  assert.deepEqual(plain(A.rows('expenses')), []);
});

test('add: the value → the table columns with .select; a subscription keeps its fields, another category drops them; logged without the beneficiary', async () => {
  const { A, stub, logs } = load({ responses: { acc_expenses: (q) => (q.some((c) => c.op === 'insert') ? ok([{ ...EXP, id: 8 }]) : ok([EXP])) } });
  await A.load();
  const r = await A.add('expenses', { date: '2026-10-22', direction: 'withdraw', category: 'المصروفات', beneficiaryName: 'مطبعة', beneficiaryIsOther: true, amount: 100, subName: 'x', subEnds: '2026-12-01', subAlerts: ['day'] });
  assert.equal(r.ok, true);
  const ins = opsOf(stub.calls, 'acc_expenses').find((c) => c.op === 'insert').args[0];
  assert.deepEqual(ins, { on_date: '2026-10-22', direction: 'withdraw', category: 'المصروفات', beneficiary: 'مطبعة', beneficiary_other: true, amount: 100, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, details: null, staff_kind: null, reason: null });
  assert.deepEqual(logs.at(-1).slice(0, 2), ['accounts.expense', 'المصروفات · سحب · 100 · 2026-10-22']);
  assert.ok(!JSON.stringify(logs).includes('مطبعة'));
  await A.add('expenses', { date: '2026-10-23', direction: 'withdraw', category: 'المرتبات', beneficiaryName: 'x', amount: 9000 });
  assert.equal(logs.at(-1)[1], 'المرتبات · سحب · 2026-10-23'); // no amount for the payroll (the log is wider than accounts.view F)
  // a maker move by name → vendor_id
  assert.deepEqual(plain(A.toColumns('vendorMoves', { vendor: 'Art Craft', date: '2026-10-22', direction: 'withdraw', type: 'أخرى', typeName: 'شحن', amount: 50 })), { vendor_id: V1, on_date: '2026-10-22', direction: 'withdraw', kind: 'أخرى', kind_name: 'شحن', amount: 50, note: null });
});

test('the reasons: 42501 forbidden, 23514 invalid, a thrown request network; an update that touches no row (RLS) is forbidden; the void is an update of voided_at', async () => {
  const deny = { data: null, error: { code: '42501', message: 'rls' } };
  let { A } = load({ responses: { acc_account_moves: (q) => (q.some((c) => c.op === 'insert') ? deny : ok([])) } });
  await A.load();
  assert.deepEqual(plain(await A.add('accountMoves', { account: 'حساب البنك', date: '2026-10-22', direction: 'deposit', amount: 5 })), { ok: false, reason: 'forbidden' });
  ({ A } = load({ responses: { acc_account_moves: (q) => (q.some((c) => c.op === 'insert') ? { data: null, error: { code: '23514' } } : ok([])) } }));
  await A.load();
  assert.equal((await A.add('accountMoves', { account: 'حساب البنك', date: '2026-10-22', direction: 'deposit', amount: 5 })).reason, 'invalid');
  const loaded = load({ responses: { acc_vendor_moves: (q) => (q.some((c) => c.op === 'update') ? ok([]) : ok([MOVE])) } });
  await loaded.A.load();
  assert.deepEqual(plain(await loaded.A.update('vendorMoves', 3, { vendor: 'Art Craft', date: '2026-10-21', direction: 'withdraw', type: 'عربون', amount: 800 })), { ok: false, reason: 'forbidden' });
  const v = load({ responses: { acc_vendor_moves: (q) => (q.some((c) => c.op === 'update') ? ok([{ id: 3 }]) : ok([MOVE])) } });
  await v.A.load();
  assert.equal((await v.A.remove('vendorMoves', 3)).ok, true);
  const upd = opsOf(v.stub.calls, 'acc_vendor_moves').find((c) => c.op === 'update').args[0];
  assert.deepEqual(Object.keys(upd), ['voided_at']);
  assert.deepEqual(plain(v.A.rows('vendorMoves')), []);
  assert.equal(v.logs.at(-1)[0], 'accounts.vendor_move.void');
});

test('canEdit: one\'s own row with add F, any row with approve F; sales: one rpc per range, the rows with isTotal', async () => {
  const { A, stub } = load();
  await A.load();
  assert.equal(A.canEdit(A.rows('expenses')[0]), true); // created by u1 (me)
  assert.equal(A.canEdit(A.rows('vendorMoves')[0]), false); // u2's
  const s = load({ perms: { 'accounts.view': 'F', 'accounts.add': 'F', 'accounts.approve': 'F' }, responses: { 'rpc:accounts_sales': ok([{ vendor_id: V1, grp: 'completed', orders: 2, sales: '1000', share: '260', is_total: false }, { vendor_id: null, grp: 'completed', orders: 2, sales: 1000, share: 260, is_total: true }]) } });
  await s.A.load();
  assert.equal(s.A.canEdit(s.A.rows('vendorMoves')[0]), true);
  assert.equal(s.A.sales('2026-10-01', '2026-10-31'), null); // loading
  assert.equal(s.A.sales('2026-10-01', '2026-10-31'), null); // still one request
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plain(s.A.sales('2026-10-01', '2026-10-31')), [{ vendorId: V1, group: 'completed', orders: 2, sales: 1000, share: 260, isTotal: false }, { vendorId: null, group: 'completed', orders: 2, sales: 1000, share: 260, isTotal: true }]);
  assert.equal(s.stub.calls.filter((c) => c.op === 'rpc').length, 1);
  assert.deepEqual(s.stub.calls.find((c) => c.op === 'rpc').args, ['accounts_sales', { p_from: '2026-10-01', p_to: '2026-10-31' }]);
  void stub;
});

test('statement: woo-sync action statement with the member\'s session; rows back, nothing kept', async () => {
  const { A, stub } = load({ responses: { 'fn:woo-sync': ok({ action: 'statement', result: 'ok', rows: [{ date: '2026-10-01', type: 'opening_balance', debit: 0, credit: 0, balance: 300 }], done: true }) } });
  const r = await A.statement(V1, '2026-10-01', '2026-10-27');
  assert.equal(r.ok, true); assert.equal(r.rows.length, 1);
  assert.deepEqual(stub.calls.find((c) => c.op === 'invoke').args, ['woo-sync', { body: { action: 'statement', vendor_id: V1, from: '2026-10-01', to: '2026-10-27' } }]);
});

test('phase 4.1: the fields per type → columns (deposit: reason, no sub fields; payroll outside the team: staff_kind); lists; addListItem', async () => {
  const { A, stub } = load({ responses: { acc_list_items: (q) => (q.some((c) => c.op === 'insert') ? { data: null, error: { code: '23505' } } : ok([{ list: 'subs', name: 'Notion' }, { list: 'ads', name: 'سناب شات' }])) } });
  await A.load();
  assert.deepEqual(plain(A.toColumns('expenses', { date: '2026-10-22', direction: 'deposit', category: 'الاشتراكات', beneficiaryName: 'Canva', beneficiaryIsOther: true, amount: 120, reason: 'إلغاء اشتراك', subName: 'Canva', subEnds: '2026-12-01', subAlerts: ['day'] })),
    { on_date: '2026-10-22', direction: 'deposit', category: 'الاشتراكات', beneficiary: 'Canva', beneficiary_other: true, amount: 120, note: null, sub_name: null, sub_is_other: false, sub_ends: null, sub_alerts: [], sub_note: null, details: null, staff_kind: null, reason: 'إلغاء اشتراك' });
  assert.equal(A.toColumns('expenses', { date: '2026-10-22', direction: 'withdraw', category: 'المرتبات', beneficiaryName: 'سامح', beneficiaryIsOther: true, staffKind: 'freelance', amount: 9 }).staff_kind, 'freelance');
  assert.equal(A.toColumns('expenses', { date: '2026-10-22', direction: 'withdraw', category: 'المرتبات', beneficiaryName: 'منى', beneficiaryIsOther: false, staffKind: 'staff', amount: 9 }).staff_kind, null, 'a team member: no staff_kind');
  assert.equal(A.toColumns('expenses', { date: '2026-10-22', direction: 'withdraw', category: 'الإعلانات', beneficiaryName: 'تيك توك', details: 'حملة', amount: 9 }).details, 'حملة');
  const ad = A.toExpense({ id: 9, on_date: '2026-10-22', direction: 'withdraw', category: 'الإعلانات', beneficiary: 'تيك توك', amount: 9, details: 'حملة' });
  assert.deepEqual([ad.platform, ad.details, ad.source], ['تيك توك', 'حملة', '']);
  assert.deepEqual([...A.lists('subs')], ['Notion']);
  assert.deepEqual(plain(await A.addListItem('ads', ' جوجل ')), { ok: true }, 'a duplicate (23505) is fine');
  assert.deepEqual(opsOf(stub.calls, 'acc_list_items').find((c) => c.op === 'insert').args[0], { list: 'ads', name: 'جوجل' });
  assert.deepEqual([...A.lists('ads')], ['سناب شات', 'جوجل']);
  assert.equal((await A.addListItem('vendors', 'x')).ok, false);
});

test('phase 4.1: approveWithdraw → woo-sync withdraw_approve { id }; logged on ok only; 401 forbidden', async () => {
  const { A, stub, logs } = load();
  await A.load();
  const calls = []; let answer = { data: { action: 'withdraw_approve', result: 'ok', status: 'approved' }, error: null };
  stub.client.functions = { invoke: async (name, opts) => { calls.push([name, opts.body]); return answer; } };
  assert.deepEqual(plain(await A.approveWithdraw(501)), { ok: true, result: 'ok', reason: null, status: 'approved', settlement: null });
  assert.deepEqual(plain(calls[0]), ['woo-sync', { action: 'withdraw_approve', id: 501 }]);
  assert.deepEqual(plain(logs.at(-1).slice(0, 2)), ['accounts.withdraw.approve', '#501 · 1200']);
  answer = { data: { action: 'withdraw_approve', result: 'skipped', reason: 'push_disabled', status: 'pending' }, error: null };
  const n = logs.length;
  assert.deepEqual(plain(await A.approveWithdraw(501)), { ok: true, result: 'skipped', reason: 'push_disabled', status: 'pending', settlement: null });
  assert.equal(logs.length, n, 'a skip is not logged as an approval');
  answer = { data: null, error: { context: { status: 401 } } };
  assert.deepEqual(plain(await A.approveWithdraw(501)), { ok: false, reason: 'forbidden' });
  assert.equal((await A.approveWithdraw('x')).reason, 'invalid');
  // 0078: the settlement the server made comes back
  answer = { data: { action: 'withdraw_approve', result: 'ok', status: 'approved', settlement: { amount: 1200, consumed: 700, cash: 500, carry_out: 0, moves: 1 } }, error: null };
  assert.deepEqual(plain((await A.approveWithdraw(501)).settlement), { amount: 1200, consumed: 700, cash: 500, carry_out: 0, moves: 1 });
});

test('0078: createWithdraw → woo-sync withdraw_create { vendor_id }; logged on ok only (the request and its amount); 409 refused / no_store; 401 forbidden', async () => {
  const { A, stub, logs } = load();
  await A.load();
  const calls = []; let answer = { data: { action: 'withdraw_create', result: 'ok', id: 701, amount: 25000, status: 'pending' }, error: null };
  stub.client.functions = { invoke: async (name, opts) => { calls.push([name, opts.body]); return answer; } };
  assert.deepEqual(plain(await A.createWithdraw(V1)), { ok: true, result: 'ok', reason: null, id: 701, amount: 25000 });
  assert.deepEqual(plain(calls[0]), ['woo-sync', { action: 'withdraw_create', vendor_id: V1 }]);
  assert.deepEqual(plain(logs.at(-1).slice(0, 2)), ['accounts.withdraw.create', '#701 · 25000']);
  const n = logs.length;
  answer = { data: { action: 'withdraw_create', result: 'skipped', reason: 'pending_exists', id: 501 }, error: null };
  assert.deepEqual(plain(await A.createWithdraw(V1)), { ok: true, result: 'skipped', reason: 'pending_exists', id: 501, amount: null });
  assert.equal(logs.length, n, 'a skip is not logged');
  answer = { data: null, error: { context: { status: 409, json: async () => ({ action: 'withdraw_create', result: 'refused', reason: 'dokan_rest_withdraw_error' }) } } };
  assert.deepEqual(plain(await A.createWithdraw(V1)), { ok: true, result: 'refused', reason: 'dokan_rest_withdraw_error' });
  answer = { data: null, error: { context: { status: 409, json: async () => ({ error: 'no_store' }) } } };
  assert.deepEqual(plain(await A.createWithdraw(V1)), { ok: true, result: 'refused', reason: 'no_store' });
  answer = { data: null, error: { context: { status: 401 } } };
  assert.deepEqual(plain(await A.createWithdraw(V1)), { ok: false, reason: 'forbidden' });
  assert.equal((await A.createWithdraw('')).reason, 'invalid');
});

test('plan 4.1 decision 12: refreshWithdrawals → woo-sync withdrawals, then load(); one at a time; 502 woo_down', async () => {
  const { A, stub } = load();
  await A.load();
  const calls = []; let answer = { data: { action: 'withdrawals', result: 'ok', counts: {} }, error: null };
  stub.client.functions = { invoke: async (name, opts) => { calls.push([name, opts.body]); return answer; } };
  const first = A.refreshWithdrawals();
  assert.equal(A.refreshing(), true);
  assert.equal((await A.refreshWithdrawals()).reason, 'busy');
  assert.deepEqual(plain(await first), { ok: true, pending: 1 });
  assert.equal(A.refreshing(), false);
  assert.deepEqual(plain(calls), [['woo-sync', { action: 'withdrawals' }]]);
  answer = { data: null, error: { context: { status: 502 } } };
  assert.deepEqual(plain(await A.refreshWithdrawals()), { ok: false, reason: 'woo_down' });
});

test('phase 5.5 decision 13: loadLedger asks woo-sync statement per maker (4 at a time), keeps the answers per range; a retry re-asks; ib:accounts-ledger', async () => {
  const ids = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((x, i) => 'a0000000-0000-4000-8000-00000000000' + (i + 1));
  let inFlight = 0, most = 0; const fail = new Set([ids[4]]);
  const fn = (opts) => { inFlight += 1; most = Math.max(most, inFlight);
    return new Promise((res) => setTimeout(() => { inFlight -= 1; const id = opts.body.vendor_id;
      res(fail.has(id) ? { data: null, error: { message: 'boom' } } : ok({ action: 'statement', result: id === ids[5] ? 'no_store' : 'ok', rows: [{ type: 'opening_balance', balance: 100, debit: 0, credit: 0 }], done: true })); }, 5)); };
  const { A, stub, events } = load({ responses: { 'fn:woo-sync': fn } });
  const first = A.loadLedger('2026-10-01', '2026-10-31', ids.concat(ids[0], '', null));
  assert.equal(first.total, 6, 'one call per maker, the duplicates and blanks dropped'); assert.equal(first.running, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(most <= 4, 'at most four at a time — ' + most);
  const L = A.ledgerOf('2026-10-01', '2026-10-31');
  assert.deepEqual([L.total, L.settled, L.failed, L.running], [6, 6, 1, false]);
  assert.equal(L.by.get(ids[0]).status, 'ok'); assert.equal(L.by.get(ids[0]).rows[0].balance, 100);
  assert.equal(L.by.get(ids[4]).status, 'error'); assert.equal(L.by.get(ids[5]).noStore, true);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args[1].body.action), Array(6).fill('statement'));
  assert.ok(events.filter((e) => e === 'ib:accounts-ledger').length >= 6);
  assert.equal(A.ledgerOf('2026-11-01', '2026-11-30'), null, 'another range is not loaded');
  // the retry asks the failed maker only
  fail.clear(); A.loadLedger('2026-10-01', '2026-10-31', [ids[4]]); await new Promise((r) => setTimeout(r, 30));
  assert.equal(stub.calls.filter((c) => c.op === 'invoke').length, 7); assert.equal(A.ledgerOf('2026-10-01', '2026-10-31').failed, 0);
  A.loadLedger('2026-09-01', '2026-09-30', [ids[0]]); A.clear(); assert.equal(A.ledgerOf('2026-09-01', '2026-09-30'), null, 'the sign-out wipe forgets the statements');
  A.dropLedger('2026-10-01', '2026-10-31'); assert.equal(A.ledgerOf('2026-10-01', '2026-10-31'), null);
});
