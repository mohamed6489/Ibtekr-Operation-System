import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const D = loadUmd(new URL('../../app/js/blocks/02-accounts-domain.js', import.meta.url));
const VD = loadUmd(new URL('../../app/js/blocks/06-vendors-domain.js', import.meta.url));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('liveSeed (phase 4): the makers with Dokan\'s balance, the sales per maker and the group totals; opening balances 0', () => {
  const s = D.liveSeed({ makers: [{ id: 'a', name: 'A', rate: 20 }, { id: 'b', name: 'B', rate: null }], balances: [{ vendorId: 'a', balance: '1500.5' }],
    sales: [{ vendorId: 'a', group: 'completed', orders: 2, sales: 1000, share: 260 }, { vendorId: 'b', group: 'completed', orders: 1, sales: 300, share: 60 },
      { vendorId: null, group: 'completed', orders: 2, sales: 1300, share: 320, isTotal: true }, { vendorId: 'a', group: 'in_progress', orders: 1, sales: 500, share: 100 }, { vendorId: null, group: 'in_progress', orders: 1, sales: 500, share: 100, isTotal: true }] });
  assert.deepEqual(plain(s.vendors[0]), { id: 'a', name: 'A', pct: '20.0%', c: [2, 1000, 260], p: [1, 500, 100], x: [0, 0, 0], deposits: 0, dokanBalance: 1500.5, balance: 1500.5 });
  assert.equal(s.vendors[1].pct, '—'); assert.equal(s.vendors[1].dokanBalance, null); assert.equal(s.vendors[1].balance, 0);
  assert.deepEqual(plain(s.sales.map((r) => [r.label, r.orders, r.sales, r.share, r.pct])), [['مكتملة', 2, 1300, 320, '24.6%'], ['تحت التنفيذ', 1, 500, 100, '20.0%'], ['مرتجع / ملغي', 0, 0, 0, '0.0%']]);
  assert.deepEqual(plain(s.salesTotal), { orders: 3, sales: 1800, share: 420, pct: '23.3%' });
  assert.equal(s.inProgressShare, 100);
  assert.deepEqual(plain(Object.values(s.accounts)), [0, 0, 0, 0]);
  assert.deepEqual(plain(s.expenseSeed), {});
});

test('the maker\'s net: Dokan\'s balance − deposits − transport (deriveVendors / deductTransport)', () => {
  const s = D.liveSeed({ makers: [{ id: 'a', name: 'A', rate: 20 }], balances: [{ vendorId: 'a', balance: 2500 }] });
  const v = D.deductTransport(D.deriveVendors(s.vendors, [{ vendor: 'A', direction: 'deposit', amount: 700 }]), { A: 100 })[0];
  assert.deepEqual([v.deposits, v.transport, v.balance, v.dokanBalance], [700, 100, 1700, 2500]);
});

test('subscriptions: validateSubscription wants the name, the end and an alert; subsDue sorts by days left and fires the nearest alert', () => {
  assert.deepEqual(Object.keys(D.validateSubscription({ subName: '', subEnds: '', subAlerts: [] }).errors).sort(), ['subAlerts', 'subEnds', 'subName']);
  const ok = D.validateSubscription({ subName: 'Canva', subEnds: '2026-11-01', subAlerts: ['week', 'bogus'] });
  assert.deepEqual(plain(ok), { errors: {}, value: { subName: 'Canva', subEnds: '2026-11-01', subAlerts: ['week'], subNote: '', beneficiaryName: 'Canva', beneficiaryIsOther: false } });
  const due = D.subsDue([{ subName: 'A', subEnds: '2026-11-25', subAlerts: ['month'] }, { subName: 'B', subEnds: '2026-10-30', subAlerts: ['week', 'day'] }], '2026-10-27');
  assert.deepEqual(plain(due.map((x) => [x.name, x.daysLeft, x.due, x.alert])), [['B', 3, true, 'week'], ['A', 29, true, 'month']]);
});

test('validateExpenseCategory (phase 4.1): the fields follow the type — deposit, payroll, ads, general', () => {
  const dep = D.validateExpenseCategory({ direction: 'deposit', category: 'الإعلانات', source: '', reason: 'x' });
  assert.deepEqual(Object.keys(dep.errors).sort(), ['reason', 'source']);
  assert.deepEqual(plain(D.validateExpenseCategory({ direction: 'deposit', category: 'الاشتراكات', source: ' Canva ', reason: 'إلغاء اشتراك', note: '' }).value),
    { source: 'Canva', reason: 'إلغاء اشتراك', note: '', beneficiaryName: 'Canva', beneficiaryIsOther: true });
  assert.deepEqual(plain(D.validateExpenseCategory({ direction: 'withdraw', category: 'الاشتراكات' })), { errors: {}, value: {} });
  assert.deepEqual(Object.keys(D.validateExpenseCategory({ direction: 'withdraw', category: 'المرتبات', beneficiary: '' }).errors), ['beneficiary']);
  assert.deepEqual(Object.keys(D.validateExpenseCategory({ direction: 'withdraw', category: 'المرتبات', beneficiary: D.OTHER, otherName: '' }).errors), ['otherName']);
  assert.deepEqual(plain(D.validateExpenseCategory({ direction: 'withdraw', category: 'المرتبات', beneficiary: D.OTHER, otherName: 'سامح', staffKind: 'freelance' }).value),
    { beneficiaryName: 'سامح', beneficiaryIsOther: true, staffKind: 'freelance', note: '' });
  assert.equal(D.validateExpenseCategory({ direction: 'withdraw', category: 'المرتبات', beneficiary: 'منى', staffKind: 'freelance' }).value.staffKind, 'staff', 'a team member is staff');
  assert.deepEqual(Object.keys(D.validateExpenseCategory({ direction: 'withdraw', category: 'الإعلانات', platform: '' }).errors), ['platform']);
  assert.deepEqual(Object.keys(D.validateExpenseCategory({ direction: 'withdraw', category: 'المصروفات', details: '  ' }).errors), ['details']);
  assert.deepEqual([...D.REFUND_REASONS], ['استرجاع مبلغ مدفوع', 'إلغاء اشتراك', 'خصم من مورد', 'تصحيح تسجيل غلط', 'أخرى'], 'the same list as 0020');
  assert.ok(!D.VENDOR_TYPES.includes(D.PAYOUT_TYPE), 'no «تحويل مستحقات» move (decision 1)');
});

test('movementLog: Dokan requests in the makers\' log as «طلب سحب», counted apart from the money in and out', () => {
  const r = D.movementLog('vendorMoves', { vendorMoves: [{ date: '2026-10-21', direction: 'deposit', type: 'عربون', typeName: 'عربون', vendor: 'A', amount: 700 }], withdrawals: [{ at: '2026-10-25 12:00:00', vendor: 'A', amount: 1200, id: '#501', source: 'vendor', by: 'Dokan', note: 'مستني الموافقة' }] });
  assert.deepEqual(plain(r.rows.map((x) => [x.date, x.kind, x.who, x.amount, x.ref])), [['2026-10-25', 'طلب سحب', 'A', 1200, '#501'], ['2026-10-21', 'إيداع', 'A', 700, '']]);
  assert.deepEqual([r.inTotal, r.outTotal, r.requests], [700, 0, 1]);
});

test('Dokan requests: openRequest = the latest pending / approved of the maker; the labels', () => {
  const list = [{ id: 1, vendorId: 'a', status: 'approved', at: '2026-10-01 10:00:00' }, { id: 2, vendorId: 'a', status: 'pending', at: '2026-10-05 10:00:00' }, { id: 3, vendorId: 'a', status: 'cancelled', at: '2026-10-09 10:00:00' }, { id: 4, vendorId: 'b', status: 'pending', at: '2026-10-10' }];
  assert.equal(VD.openRequest(list, 'a').id, 2);
  assert.equal(VD.openRequest(list.filter((w) => w.id === 3), 'a'), null);
  assert.deepEqual([VD.wdLabel('pending'), VD.wdLabel('approved'), VD.wdLabel('cancelled')], ['مستني الموافقة', 'اتوافق عليه', 'اتلغى']);
});

// phase 5.5 decision 13 (owner 5 Nov): «كشف بالفترة» — the opening is Dokan's balance on the first day less our earlier moves
const ST = (rows) => ({ rows });
test('makerLedger: the opening = Dokan\'s opening row less our moves before the period; the period from the statement + our moves', () => {
  const statement = ST([
    { date: '2026-10-01', type: 'opening_balance', debit: 0, credit: 0, balance: 1000 },
    { date: '2026-10-05 10:00:00', type: 'dokan_orders', debit: 650, credit: 0, balance: 1650, ref: 55 },
    { date: '2026-10-09 12:00:00', type: 'dokan_orders', debit: 350, credit: 0, balance: 2000, ref: 61 },
    { date: '2026-10-20 09:00:00', type: 'dokan_withdraw', debit: 0, credit: 1200, balance: 800, ref: 501 }]);
  const moves = [
    { date: '2026-09-20', type: 'عربون', direction: 'deposit', amount: 300 }, // before: −300
    { date: '2026-09-25', type: 'مواصلات', direction: 'withdraw', amount: 50 }, // before: −50
    { date: '2026-09-28', type: 'عربون', direction: 'withdraw', amount: 100 }, // before: the maker gave 100 back → +100
    { date: '2026-10-10', type: 'عربون', direction: 'deposit', amount: 200 }, // in the period
    { date: '2026-10-12', type: 'مواصلات', direction: 'withdraw', amount: 80 },
    { date: '2026-11-02', type: 'عربون', direction: 'deposit', amount: 999 }]; // after the period: not counted
  const sales = { 55: 1000, 61: 500 };
  const l = D.makerLedger({ statement, moves, from: '2026-10-01', to: '2026-10-31', salesOf: (ref) => (ref in sales ? sales[ref] : null) });
  assert.deepEqual(plain(l), { from: '2026-10-01', to: '2026-10-31', dokanOpening: 1000, opening: 750,
    completed: { orders: 2, lines: 2, earned: 1000, sales: 1500, share: 500, matched: 2 },
    refunds: 0, payouts: 1200, deposits: 200, transport: 80, other: 0, closing: 270, status: 'owed' });
  // the last day: Dokan's balance (800) less every move up to it (−300 −50 +100 −200 −80) = «الصافي»
  assert.equal(l.closing, 800 - 300 - 50 + 100 - 200 - 80);
});
test('makerLedger: no opening row → from the first row; no statement (no store) → Dokan\'s part 0; refunds, other rows, statuses', () => {
  const a = D.makerLedger({ statement: ST([{ type: 'dokan_orders', debit: 400, credit: 0, balance: 900, ref: 7 }, { type: 'dokan_refund', debit: 0, credit: 150, balance: 750 }, { type: 'dokan_gateway_fee', debit: 0, credit: 20, balance: 730 }]), moves: [], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([a.dokanOpening, a.completed.earned, a.completed.matched, a.completed.sales, a.refunds, a.other, a.closing, a.status], [500, 400, 0, 0, 150, -20, 730, 'owed']);
  const b = D.makerLedger({ statement: null, moves: [{ date: '2026-10-03', type: 'عربون', direction: 'deposit', amount: 250 }], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([b.dokanOpening, b.opening, b.deposits, b.closing, b.status], [0, 0, 250, -250, 'onThem']);
  const c = D.makerLedger({ statement: ST([{ type: 'opening_balance', balance: 0, debit: 0, credit: 0 }]), moves: [], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([c.closing, c.status, D.LEDGER_STATUS[c.status]], [0, 'settled', 'متصفّي']);
  // an unmatched order (not in our mirror) counts in the orders and «حقه», not in the sales / share
  const d = D.makerLedger({ statement: ST([{ type: 'opening_balance', balance: 0 }, { type: 'dokan_orders', debit: 100, ref: 1 }, { type: 'dokan_orders', debit: 50, ref: 2 }]), moves: [], from: '2026-10-01', to: '2026-10-31', salesOf: (r) => (r === 1 ? 150 : null) });
  assert.deepEqual(plain(d.completed), { orders: 2, lines: 2, earned: 150, sales: 150, share: 50, matched: 1 });
});
test('ledgerTotals: the sums, what is owed to the makers and what is on them', () => {
  const L = [{ opening: 100, completed: { orders: 2, lines: 2, sales: 1500, share: 500, earned: 1000 }, refunds: 0, payouts: 200, deposits: 50, transport: 10, other: 0, closing: 840, status: 'owed' },
    { opening: -40, completed: { orders: 0, lines: 0, sales: 0, share: 0, earned: 0 }, refunds: 0, payouts: 0, deposits: 60, transport: 0, other: 0, closing: -100, status: 'onThem' },
    { opening: 0, completed: { orders: 0, lines: 0, sales: 0, share: 0, earned: 0 }, refunds: 0, payouts: 0, deposits: 0, transport: 0, other: 0, closing: 0, status: 'settled' }];
  const t = D.ledgerTotals(L);
  assert.deepEqual([t.opening, t.orders, t.sales, t.share, t.earned, t.payouts, t.deposits, t.transport, t.closing, t.owed, t.owedCount, t.onThem, t.onThemCount], [60, 2, 1500, 500, 1000, 200, 110, 10, 740, 840, 1, -100, 1]);
});
