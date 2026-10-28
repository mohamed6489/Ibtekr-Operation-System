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
