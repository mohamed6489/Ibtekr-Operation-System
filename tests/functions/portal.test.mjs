import { test } from 'node:test'; import assert from 'node:assert/strict';
import { DONE_STATUSES, LOCK_TRIES, TOKEN_TTL_S, ageDays, bankNote, deliveryState, loginInput, makerLedger, makerLines, maskTail, maskedBank, passwordIssues, resetEmail, resetLink, resetTokenOk, tokenClaims } from '../../supabase/functions/_shared/portal.js';
// the maker portal (phase 13 T4): the pure rules of the Edge Function portal

const NOW = '2026-11-09T12:00:00Z';

test('passwordIssues: block 06\'s four rules in the same words, plus the 128 cap', () => {
  assert.deepEqual(passwordIssues('Bian2026'), []);
  assert.deepEqual(passwordIssues('short1'), ['8 حروف على الأقل']);
  assert.deepEqual(passwordIssues('12345678'), ['حرف إنجليزي']);
  assert.deepEqual(passwordIssues('abcdefgh'), ['رقم']);
  assert.deepEqual(passwordIssues('abcd efg1'), ['من غير مسافات']);
  assert.deepEqual(passwordIssues('abcd efg1'), ['من غير مسافات'], 'U+00A0 is a space too');
  assert.deepEqual(passwordIssues('a1' + 'x'.repeat(127)), ['أقصى طول 128 حرف']);
  assert.equal(LOCK_TRIES, 5);
});

test('loginInput: the user trimmed and lower-cased, the password as typed; a missing or absurd part', () => {
  assert.deepEqual(loginInput({ user: '  Bian.EG ', password: 'Bian2026' }), { user: 'bian.eg', password: 'Bian2026' });
  assert.deepEqual(loginInput({ user: '', password: 'x' }), { error: 'bad_request', field: 'user' });
  assert.deepEqual(loginInput({ user: 'a'.repeat(161), password: 'x' }), { error: 'bad_request', field: 'user' });
  assert.deepEqual(loginInput({ user: 'bian.eg' }), { error: 'bad_request', field: 'password' });
  assert.deepEqual(loginInput({ user: 'bian.eg', password: 'x'.repeat(129) }), { error: 'bad_request', field: 'password' });
  assert.deepEqual(loginInput(null), { error: 'bad_request', field: 'user' });
});

test('ageDays + deliveryState: block 29\'s rule on the order\'s age — late past 11 days, at risk from 9 to 11, a closed line never late', () => {
  assert.equal(ageDays('2026-11-01T10:00:00Z', NOW), 8); assert.equal(ageDays('2026-11-09T13:00:00Z', NOW), 0); assert.equal(ageDays('bad', NOW), 0);
  assert.equal(deliveryState(8, true), 'ok'); assert.equal(deliveryState(9, true), 'risk'); assert.equal(deliveryState(11, true), 'risk'); assert.equal(deliveryState(12, true), 'late');
  assert.equal(deliveryState(30, false), 'ok');
  assert.deepEqual(DONE_STATUSES, ['مكتمل', 'ملغي', 'استرجاع', 'فشل']);
});

test('makerLines: his lines with their order and sub-order — open while the order runs and the sub-order is processing / pending / on-hold; removed lines and deleted orders left out; newest first; no customer field', () => {
  const orders = [
    { id: 181668, number: '181668', status: 'جاري التنفيذ', placed_at: '2026-10-28T10:00:00Z', customer_name: 'سلوى', customer_phone: '0120' },
    { id: 180686, number: '180686', status: 'مكتمل', placed_at: '2026-10-20T10:00:00Z' },
    { id: 170000, number: '170000', status: 'جاري التنفيذ', placed_at: '2026-10-25T10:00:00Z', deleted_at: '2026-11-01T00:00:00Z' },
  ];
  const subs = [{ id: 1, order_id: 181668, woo_order_id: 181669, woo_status: 'processing' }, { id: 2, order_id: 180686, woo_order_id: 180687, woo_status: 'completed' }];
  const items = [
    { id: 11, order_id: 181668, sub_order_id: 1, name: 'Cushion', qty: 2, total: 700, status: 'قيد التنفيذ', expected_at: '2026-11-12' },
    { id: 12, order_id: 181668, sub_order_id: 1, name: 'Removed', qty: 1, total: 100, status: '', removed: true },
    { id: 13, order_id: 180686, sub_order_id: 2, name: 'Vase', qty: 1, total: 300, status: 'تم الشحن للعميل' },
    { id: 14, order_id: 170000, sub_order_id: null, name: 'Gone', qty: 1, total: 50, status: '' },
    { id: 15, order_id: 999999, sub_order_id: null, name: 'Orphan', qty: 1, total: 50, status: '' },
  ];
  const rows = makerLines({ items, orders, subs, now: NOW });
  assert.deepEqual(rows, [
    { order: '181668', n: '181669', prod: 'Cushion', qty: 2, total: 700, ss: 'قيد التنفيذ', exp: '2026-11-12', open: true, status: 'جاري التنفيذ', delivery: 'late', age: 12, placed: '2026-10-28' },
    { order: '180686', n: '180687', prod: 'Vase', qty: 1, total: 300, ss: 'تم الشحن للعميل', exp: null, open: false, status: 'مكتمل', delivery: 'ok', age: 20, placed: '2026-10-20' },
  ]);
  assert.ok(!JSON.stringify(rows).includes('سلوى') && !JSON.stringify(rows).includes('0120'), 'no customer data');
  assert.equal(makerLines({ items: [{ id: 1, order_id: 5, name: 'x' }], orders: [{ id: 5, status: 'جاري التنفيذ', placed_at: '2026-11-08T10:00:00Z' }], subs: [], now: NOW })[0].open, true, 'no sub-order: open while the order runs');
});

test('makerLedger: Dokan\'s balance − deposits − transport ± the other moves (voided rows skipped); the status words', () => {
  const l = makerLedger({ balance: 5000, moves: [
    { direction: 'withdraw', kind: 'عربون', amount: 1000 }, { direction: 'withdraw', kind: 'مواصلات', amount: 150.5 },
    { direction: 'deposit', kind: 'أخرى', kind_name: 'مكافأة', amount: 200 }, { direction: 'withdraw', kind: 'أخرى', kind_name: 'غرامة', amount: 50 },
    { direction: 'withdraw', kind: 'عربون', amount: 9999, voided_at: '2026-11-01T00:00:00Z' }, { direction: 'deposit', kind: 'عربون', amount: 100 },
  ] });
  assert.deepEqual(l, { dokan: 5000, deposits: 900, transport: 150.5, other: 150, net: 4099.5, status: 'ليك' });
  assert.equal(makerLedger({ balance: 0, moves: [{ direction: 'withdraw', kind: 'عربون', amount: 10 }] }).status, 'عليك');
  assert.equal(makerLedger({ balance: null, moves: [] }).status, 'متصفّي');
});

test('maskTail / maskedBank: the last 4 digits only; the method and the holder stay', () => {
  assert.equal(maskTail('EG380019000500000000263180002'), '•••• •••• •••• 0002'); assert.equal(maskTail('01000000000'), '•••• •••• •••• 0000'); assert.equal(maskTail('1234'), '•••• 1234'); assert.equal(maskTail(''), null);
  assert.deepEqual(maskedBank({ method: 'bank', holder: 'Bian Egypt', bank_name: 'NBE', iban: 'EG380019000500000000263180002', account_number: '12345678901', wallet: null }),
    { method: 'bank', holder: 'Bian Egypt', bankName: 'NBE', iban: '•••• •••• •••• 0002', account: '•••• •••• •••• 8901', wallet: null });
  assert.equal(maskedBank(null), null);
  assert.equal(bankNote(' غيّرت  <البنك>\u0000 '), 'غيّرت البنك');
});

test('resetLink / resetEmail / tokenClaims: the token in the hash, the e-mail without username or password, a 12-hour token', () => {
  const tok = 'a'.repeat(64);
  assert.equal(resetLink('', tok), 'https://operation-system.ibtekr.club/portal.html#portal-reset/' + tok);
  assert.equal(resetLink('https://x.test/p.html#old', tok), 'https://x.test/p.html#portal-reset/' + tok);
  const m = resetEmail('بيان', 'https://x/#portal-reset/' + tok);
  assert.ok(m.subject.includes('بوابة المبتكر') && m.body.includes('أهلاً بيان') && m.body.includes(tok) && m.body.includes('30 دقيقة'));
  assert.ok(!m.body.includes('bian.eg'));
  assert.deepEqual(tokenClaims('v1', 'first', 1000.7), { sub: 'v1', scope: 'first', iat: 1000, exp: 1000 + TOKEN_TTL_S });
  assert.equal(tokenClaims('v1', 'anything', 1).scope, 'full');
  assert.equal(resetTokenOk(tok), true); assert.equal(resetTokenOk('zz'), false);
});
