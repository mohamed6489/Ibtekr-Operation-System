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
  const v = D.deductTransport(D.deriveVendors(s.vendors, [{ vendor: 'A', direction: 'withdraw', type: 'عربون', amount: 700 }]), { A: 100 })[0];
  assert.deepEqual([v.deposits, v.transport, v.balance, v.dokanBalance], [700, 100, 1700, 2500]);
});

// 0078 (the owner, 11 Nov): «سحب» always deducts (even below zero), «إيداع» is a correction added to the net
test('0078: a «سحب» deducts by its kind, a «إيداع» corrects; the net may go below zero; the carry left by a settlement', () => {
  const s = D.liveSeed({ makers: [{ id: 'a', name: 'A', rate: 20 }], balances: [{ vendorId: 'a', balance: 1000 }] });
  const moves = [{ vendor: 'A', direction: 'withdraw', type: 'عربون', amount: 4000 }, { vendor: 'A', direction: 'withdraw', type: 'مواصلات', amount: 300 },
    { vendor: 'A', direction: 'withdraw', type: 'أخرى', typeName: 'خامات', amount: 200 }, { vendor: 'A', direction: 'deposit', type: 'أخرى', typeName: 'فرق مقاس', amount: 500 }];
  const v = D.withCarry(D.deriveVendors(s.vendors, moves), { a: 250 })[0];
  assert.deepEqual([v.deposits, v.transport, v.other, v.corrections, v.carry, v.balance], [4000, 300, 200, 500, 250, 1000 - 4000 - 300 - 200 + 500 - 250]);
  assert.equal(D.openOf(v), 4000 + 300 + 200 + 250 - 500, 'the open moves = Dokan\'s balance − the net');
  assert.equal(v.balance, v.dokanBalance - D.openOf(v));
  const sum = D.vendorSummary([v]);
  assert.deepEqual([sum.deposits, sum.transport, sum.other, sum.corrections, sum.carry, sum.negative, sum.negativeCount], [4000, 300, 200, 500, 250, -3250, 1]);
  assert.equal(D.withCarry([{ id: 'b', balance: 10 }], {})[0].carry, 0, 'no settlement, no carry');
});

test('0078 settlePlan: the owner\'s example and the same rule as acc_settle_withdrawal (smaller request, credit, nothing open)', () => {
  // net 20,000 + عربون 4,000 + مواصلات 1,000 → a request of 25,000 → transfer 20,000
  assert.deepEqual(plain(D.settlePlan(25000, 5000)), { amount: 25000, open: 5000, consumed: 5000, carryOut: 0, cash: 20000 });
  // a request smaller than the deductions: nothing transferred, the rest stays on the maker
  assert.deepEqual(plain(D.settlePlan(3000, 5000)), { amount: 3000, open: 5000, consumed: 3000, carryOut: 2000, cash: 0 });
  // a correction larger than the deductions is paid with the request
  assert.deepEqual(plain(D.settlePlan(500, -1000)), { amount: 500, open: -1000, consumed: -1000, carryOut: 0, cash: 1500 });
  assert.deepEqual(plain(D.settlePlan(800, 0)), { amount: 800, open: 0, consumed: 0, carryOut: 0, cash: 800 });
});

test('0078 validateVendorMovement: «سحب» by its kind; «إيداع» = a correction with a title (kind أخرى) and an optional description', () => {
  const w = D.validateVendorMovement({ amount: '1,500', date: '05/11/2026', direction: 'withdraw', type: 'عربون', vendor: 'A', note: ' مقدم ' });
  assert.deepEqual(plain(w), { errors: {}, value: { direction: 'withdraw', amount: 1500, date: '2026-11-05', type: 'عربون', typeName: 'عربون', vendor: 'A', note: 'مقدم' } });
  assert.deepEqual(Object.keys(D.validateVendorMovement({ amount: '10', date: '05/11/2026', direction: 'withdraw', type: 'أخرى', vendor: 'A', otherName: '' }).errors), ['otherName']);
  assert.deepEqual(Object.keys(D.validateVendorMovement({ amount: '10', date: '05/11/2026', direction: 'withdraw', type: 'bogus', vendor: 'A' }).errors), ['type']);
  // a deposit takes no kind from the form: always the correction «أخرى» with its title
  const d = D.validateVendorMovement({ amount: '1000', date: '05/11/2026', direction: 'deposit', type: 'عربون', vendor: 'A', otherName: ' فرق مقاس مخصص ', note: 'العميل طلب مقاس أكبر' });
  assert.deepEqual(plain(d), { errors: {}, value: { direction: 'deposit', amount: 1000, date: '2026-11-05', type: 'أخرى', typeName: 'فرق مقاس مخصص', vendor: 'A', note: 'العميل طلب مقاس أكبر' } });
  assert.deepEqual(Object.keys(D.validateVendorMovement({ amount: '1000', date: '05/11/2026', direction: 'deposit', vendor: 'A', otherName: '  ' }).errors), ['otherName']);
  assert.equal(D.CORRECTION, 'أخرى');
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
  const r = D.movementLog('vendorMoves', { vendorMoves: [{ date: '2026-10-21', direction: 'deposit', type: 'أخرى', typeName: 'فرق مقاس', vendor: 'A', amount: 700 }], withdrawals: [{ at: '2026-10-25 12:00:00', vendor: 'A', amount: 1200, id: '#501', source: 'vendor', by: 'Dokan', note: 'مستني الموافقة' }] });
  assert.deepEqual(plain(r.rows.map((x) => [x.date, x.kind, x.what, x.who, x.amount, x.ref])), [['2026-10-25', 'طلب سحب', 'طلب من المبتكر', 'A', 1200, '#501'], ['2026-10-21', 'إيداع', 'تصحيح: فرق مقاس', 'A', 700, '']]);
  assert.deepEqual([r.inTotal, r.outTotal, r.requests], [700, 0, 1]);
  // 0078: a settled move says which request settled it
  const s = D.movementLog('vendorMoves', { vendorMoves: [{ id: 9, date: '2026-11-01', direction: 'withdraw', type: 'عربون', typeName: 'عربون', vendor: 'A', amount: 400, note: 'مقدم', settledBy: 900 }] });
  assert.deepEqual([s.rows[0].what, s.rows[0].note, s.outTotal], ['عربون', 'مقدم · اتصفّت مع طلب السحب #900', 400]);
});

test('Dokan requests: openRequest = the latest pending / approved of the maker; the labels', () => {
  const list = [{ id: 1, vendorId: 'a', status: 'approved', at: '2026-10-01 10:00:00' }, { id: 2, vendorId: 'a', status: 'pending', at: '2026-10-05 10:00:00' }, { id: 3, vendorId: 'a', status: 'cancelled', at: '2026-10-09 10:00:00' }, { id: 4, vendorId: 'b', status: 'pending', at: '2026-10-10' }];
  assert.equal(VD.openRequest(list, 'a').id, 2);
  assert.equal(VD.openRequest(list.filter((w) => w.id === 3), 'a'), null);
  assert.deepEqual([VD.wdLabel('pending'), VD.wdLabel('approved'), VD.wdLabel('cancelled')], ['مستني الموافقة', 'اتوافق عليه', 'اتلغى']);
});

// phase 5.5 decision 13 (owner 5 Nov): «كشف بالفترة» — the opening is Dokan's balance on the first day less our earlier moves
const ST = (rows) => ({ rows });
test('makerLedger: the opening = Dokan\'s opening row less the moves open the evening before; the period from the statement + our moves', () => {
  const statement = ST([
    { date: '2026-10-01', type: 'opening_balance', debit: 0, credit: 0, balance: 1000 },
    { date: '2026-10-05 10:00:00', type: 'dokan_orders', debit: 650, credit: 0, balance: 1650, ref: 55 },
    { date: '2026-10-09 12:00:00', type: 'dokan_orders', debit: 350, credit: 0, balance: 2000, ref: 61 },
    { date: '2026-10-20 09:00:00', type: 'dokan_withdraw', debit: 0, credit: 1200, balance: 800, ref: 501 }]);
  const moves = [
    { date: '2026-09-20', type: 'عربون', direction: 'withdraw', amount: 300 }, // before: −300
    { date: '2026-09-25', type: 'مواصلات', direction: 'withdraw', amount: 50 }, // before: −50
    { date: '2026-09-28', type: 'أخرى', typeName: 'فرق مقاس', direction: 'deposit', amount: 100 }, // before: a correction → +100
    { date: '2026-10-10', type: 'عربون', direction: 'withdraw', amount: 200 }, // in the period
    { date: '2026-10-12', type: 'مواصلات', direction: 'withdraw', amount: 80 },
    { date: '2026-10-14', type: 'أخرى', typeName: 'خامات', direction: 'withdraw', amount: 30 },
    { date: '2026-10-15', type: 'أخرى', typeName: 'تصحيح', direction: 'deposit', amount: 60 },
    { date: '2026-11-02', type: 'عربون', direction: 'withdraw', amount: 999 }]; // after the period: not counted
  const sales = { 55: 1000, 61: 500 };
  const l = D.makerLedger({ statement, moves, from: '2026-10-01', to: '2026-10-31', salesOf: (ref) => (ref in sales ? sales[ref] : null) });
  assert.deepEqual(plain(l), { from: '2026-10-01', to: '2026-10-31', dokanOpening: 1000, opening: 750,
    completed: { orders: 2, lines: 2, earned: 1000, sales: 1500, share: 500, matched: 2 },
    refunds: 0, requested: 1200, consumed: 0, payouts: 1200, deposits: 200, transport: 80, otherMoves: 30, corrections: 60, other: 0, closing: 300, status: 'owed' });
  // the last day: Dokan's balance (800) less every open move up to it (−300 −50 +100 −200 −80 −30 +60) = «الصافي»
  assert.equal(l.closing, 800 - 300 - 50 + 100 - 200 - 80 - 30 + 60);
});
test('0078 makerLedger: a settled request — «اتحوّله» is the cash (the request less the moves it covered); the closing is still Dokan − the open moves', () => {
  // the owner's example: net 20,000 + عربون 4,000 + مواصلات 1,000; Dokan approves 25,000 on 10 Nov
  const statement = ST([
    { date: '2026-11-01', type: 'opening_balance', debit: 0, credit: 0, balance: 25000 },
    { date: '2026-11-10 13:00:00', type: 'dokan_withdraw', debit: 0, credit: 25000, balance: 0, ref: 900 }]);
  const moves = [{ date: '2026-10-20', type: 'عربون', direction: 'withdraw', amount: 4000, settledBy: 900 },
    { date: '2026-11-03', type: 'مواصلات', direction: 'withdraw', amount: 1000, settledBy: 900 },
    { date: '2026-11-12', type: 'مواصلات', direction: 'withdraw', amount: 150 }]; // after the request, still open
  const settlements = [{ id: 1, withdrawId: 900, consumed: 5000, carryOut: 0, settledOn: '2026-11-10' }];
  const l = D.makerLedger({ statement, moves, settlements, from: '2026-11-01', to: '2026-11-30' });
  // the opening: Dokan 25,000 less the عربون open on 31 Oct = 21,000; the period: مواصلات 1,000 + 150, the request 25,000 of which 5,000 covered the moves
  assert.deepEqual([l.dokanOpening, l.opening, l.requested, l.consumed, l.payouts, l.deposits, l.transport, l.closing], [25000, 21000, 25000, 5000, 20000, 0, 1150, -150]);
  assert.equal(l.closing, 0 - 150, 'Dokan 0 less the open مواصلات');
  assert.equal(D.openAt(moves, settlements, '2026-11-09'), 5000);
  assert.equal(D.openAt(moves, settlements, '2026-11-10'), 0, 'settled on the day of the request');
  assert.equal(D.openAt(moves, settlements, '2026-11-12'), 150);
  // a smaller request carries the rest: 3,000 against 5,000 → nothing transferred, 2,000 left on the maker
  const small = [{ id: 2, withdrawId: 901, consumed: 3000, carryOut: 2000, settledOn: '2026-11-10' }];
  const m2 = moves.slice(0, 2).map((m) => ({ ...m, settledBy: 901 }));
  const st2 = ST([{ type: 'opening_balance', balance: 3000, debit: 0, credit: 0 }, { type: 'dokan_withdraw', credit: 3000, balance: 0, ref: 901 }]);
  const l2 = D.makerLedger({ statement: st2, moves: m2, settlements: small, from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual([l2.opening, l2.payouts, l2.transport, l2.closing], [-1000, 0, 1000, -2000]);
  assert.equal(D.openAt(m2, small, '2026-11-30'), 2000, 'the carry stays open');
});
test('makerLedger: no opening row → from the first row; no statement (no store) → Dokan\'s part 0; refunds, other rows, statuses', () => {
  const a = D.makerLedger({ statement: ST([{ type: 'dokan_orders', debit: 400, credit: 0, balance: 900, ref: 7 }, { type: 'dokan_refund', debit: 0, credit: 150, balance: 750 }, { type: 'dokan_gateway_fee', debit: 0, credit: 20, balance: 730 }]), moves: [], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([a.dokanOpening, a.completed.earned, a.completed.matched, a.completed.sales, a.refunds, a.other, a.closing, a.status], [500, 400, 0, 0, 150, -20, 730, 'owed']);
  const b = D.makerLedger({ statement: null, moves: [{ date: '2026-10-03', type: 'عربون', direction: 'withdraw', amount: 250 }], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([b.dokanOpening, b.opening, b.deposits, b.closing, b.status], [0, 0, 250, -250, 'onThem']);
  const c = D.makerLedger({ statement: ST([{ type: 'opening_balance', balance: 0, debit: 0, credit: 0 }]), moves: [], from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([c.closing, c.status, D.LEDGER_STATUS[c.status]], [0, 'settled', 'متصفّي']);
  // an unmatched order (not in our mirror) counts in the orders and «حقه», not in the sales / share
  const d = D.makerLedger({ statement: ST([{ type: 'opening_balance', balance: 0 }, { type: 'dokan_orders', debit: 100, ref: 1 }, { type: 'dokan_orders', debit: 50, ref: 2 }]), moves: [], from: '2026-10-01', to: '2026-10-31', salesOf: (r) => (r === 1 ? 150 : null) });
  assert.deepEqual(plain(d.completed), { orders: 2, lines: 2, earned: 150, sales: 150, share: 50, matched: 1 });
});
test('0078 lifetimeLedger («كشف بالفترة» من غير فلتر): Dokan\'s totals + every approved request + all our moves; closing = the net now', () => {
  const moves = [{ date: '2026-09-01', type: 'عربون', direction: 'withdraw', amount: 4000, settledBy: 900 }, { date: '2026-11-03', type: 'مواصلات', direction: 'withdraw', amount: 1000, settledBy: 900 },
    { date: '2026-11-12', type: 'أخرى', typeName: 'خامات', direction: 'withdraw', amount: 150 }, { date: '2026-11-13', type: 'أخرى', typeName: 'فرق', direction: 'deposit', amount: 50 }];
  const withdrawals = [{ id: 900, amount: 25000, status: 'approved' }, { id: 901, amount: 700, status: 'pending' }, { id: 902, amount: 300, status: 'cancelled' }];
  const settlements = [{ id: 1, withdrawId: 900, consumed: 5000, carryOut: 0, settledOn: '2026-11-10' }];
  // Dokan: earned 31,000 over the store's life, 25,000 paid → 6,000 left
  const l = D.lifetimeLedger({ dokan: { balance: 6000, earning: 31000, sales: 40000, orders: 12 }, withdrawals, moves, settlements });
  assert.deepEqual(plain(l.completed), { orders: 12, lines: 12, earned: 31000, sales: 40000, share: 9000, matched: 12 });
  assert.deepEqual([l.opening, l.requested, l.consumed, l.payouts, l.deposits, l.transport, l.otherMoves, l.corrections, l.other], [0, 25000, 5000, 20000, 4000, 1000, 150, 50, 0]);
  assert.equal(l.closing, 6000 - 150 + 50, 'Dokan\'s balance less the open moves');
  assert.equal(l.status, 'owed');
  // no earning from Dokan → balance + what was paid; no Dokan at all → only our moves
  assert.equal(D.lifetimeLedger({ dokan: { balance: 100 }, withdrawals: [{ amount: 400, status: 'approved' }], moves: [] }).completed.earned, 500);
  const n = D.lifetimeLedger({ dokan: null, moves: [{ date: '2026-11-01', type: 'عربون', direction: 'withdraw', amount: 80 }] });
  assert.deepEqual([n.closing, n.status], [-80, 'onThem']);
});
test('ledgerTotals: the sums, what is owed to the makers and what is on them', () => {
  const L = [{ opening: 100, completed: { orders: 2, lines: 2, sales: 1500, share: 500, earned: 1000 }, refunds: 0, requested: 300, consumed: 100, payouts: 200, deposits: 50, transport: 10, otherMoves: 5, corrections: 5, other: 0, closing: 840, status: 'owed' },
    { opening: -40, completed: { orders: 0, lines: 0, sales: 0, share: 0, earned: 0 }, refunds: 0, payouts: 0, deposits: 60, transport: 0, other: 0, closing: -100, status: 'onThem' },
    { opening: 0, completed: { orders: 0, lines: 0, sales: 0, share: 0, earned: 0 }, refunds: 0, payouts: 0, deposits: 0, transport: 0, other: 0, closing: 0, status: 'settled' }];
  const t = D.ledgerTotals(L);
  assert.deepEqual([t.opening, t.orders, t.sales, t.share, t.earned, t.payouts, t.deposits, t.transport, t.closing, t.owed, t.owedCount, t.onThem, t.onThemCount], [60, 2, 1500, 500, 1000, 200, 110, 10, 740, 840, 1, -100, 1]);
  assert.deepEqual([t.requested, t.consumed, t.otherMoves, t.corrections], [300, 100, 5, 5]);
});

test('0078 periodMoney (block 06): an «عربون» counts when it is a «سحب» in the range; a «إيداع» is a correction, never a deposit', () => {
  const moves = [{ vendor: 'A', type: 'عربون', direction: 'withdraw', amount: 400, date: '2026-11-02' }, { vendor: 'A', type: 'أخرى', typeName: 'فرق', direction: 'deposit', amount: 90, date: '2026-11-03' },
    { vendor: 'A', type: 'عربون', direction: 'withdraw', amount: 50, date: '2026-10-01' }, { vendor: 'B', type: 'عربون', direction: 'withdraw', amount: 70, date: '2026-11-02' }];
  const r = VD.periodMoney(moves, [{ vendor: 'A', amount: 30, date: '2026-11-05' }], 'A', { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(plain(r), { deposits: 400, depositCount: 1, transport: 30, trips: 1 });
});
