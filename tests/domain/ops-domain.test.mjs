import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const O = loadUmd(new URL('../../app/js/blocks/12-ops-domain.js', import.meta.url));
test('AUTH constants match the spec', () => assert.deepEqual(O.AUTH, { maxTries: 5, lockMinutes: 15, idleMinutes: 480, warnSeconds: 60, linkMinutes: 30, inviteDays: 7, rememberDays: 30 }));
test('5 failures lock for 15 minutes', () => { let a = O.loginInit(); for (let i = 0; i < 5; i++) a = O.loginFail(a, 0); assert.equal(O.isLocked(a, 14 * 60 * 1000), true); assert.equal(O.isLocked(a, 15 * 60 * 1000 + 1), false); });
test('identifierKind: email, 11-digit phone, arabic digits, junk', () => { assert.equal(O.identifierKind('a@b.co'), 'email'); assert.equal(O.identifierKind('01012345678'), 'phone'); assert.equal(O.identifierKind(O.toLatin('٠١٠١٢٣٤٥٦٧٨')), 'phone'); assert.equal(O.identifierKind('abc'), null); });
test('idleState thresholds', () => { assert.equal(O.idleState(0), 'active'); assert.equal(O.idleState(28800 - 30), 'warn'); assert.equal(O.idleState(28800), 'expired'); });

// phase 12 T3 (decision 10): the cancel / return validators take the settings' saved list — a reason outside it is refused like none
test('validateCancel / validateReturn with a saved list: in the list passes, outside it is «اختار», «أخرى» still needs its text; no list = the old rule', () => {
  const list = ['العميل مش بيرد / مش متاح', 'سبب جديد من الإعدادات', 'أخرى'];
  assert.equal(O.validateCancel({ reason: 'سبب جديد من الإعدادات' }, list), null);
  assert.equal(O.validateCancel({ reason: 'العميل لغى الطلب' }, list), 'اختار سبب الإلغاء', 'a default reason the admin removed');
  assert.equal(O.validateCancel({ reason: 'أخرى', other: ' ' }, list), 'اكتب السبب');
  assert.equal(O.validateCancel({ reason: 'العميل لغى الطلب' }), null, 'without a list any reason passes (the old rule)');
  assert.equal(O.validateReturn({ reason: 'x' }, list), 'اختار سبب المرتجع');
  assert.equal(O.validateReturn({ reason: 'أخرى', other: 'وصل مكسور' }, list), null);
});

// owner batch 14 Nov decision 7 (0087): the overtime pay with the settings' day-rate divisor and the member's day hours
test('overtimePay: 24 / 8 by default; the settings\' divisor and the member\'s day hours when given (the same as hr_payroll_calc)', () => {
  assert.equal(O.overtimePay(4800, { hours: 2 }), 50); // 4800 ÷ 24 = 200 a day ÷ 8 = 25 an hour × 2
  assert.equal(O.overtimePay(4800, { offDays: 1 }), 400); // a rest day = the day ×2
  assert.equal(O.overtimePay(6000, { hours: 3 }, { divisor: 30, dayHours: 6 }), 100); // 6000 ÷ 30 = 200 ÷ 6 h = 33.33 × 3
  assert.equal(O.overtimePay(6000, { offDays: 2 }, { divisor: 30, dayHours: 6 }), 800);
});
