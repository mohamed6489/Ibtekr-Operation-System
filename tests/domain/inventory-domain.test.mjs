import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// Phase 7: the inventory hub's rules in block 12 (= the v2 prototype's IbtekrOps, decision 2). Quantities come from the moves only.
const O = loadUmd(new URL('../../app/js/blocks/12-ops-domain.js', import.meta.url));

test('the four reasons and the statuses each one can take', () => {
  assert.deepEqual(O.REASONS, ['تجميع أوردر', 'مرتجع', 'تصوير', 'متاح للبيع']);
  assert.deepEqual(O.STATUS_BY_REASON['مرتجع'], ['بانتظار الفحص', 'تالف', 'راجع للمبتكر']);
  assert.deepEqual(O.STATUS_BY_REASON['متاح للبيع'], ['متاح', 'محجوز لأوردر']);
});

test('quantities from the moves: in / out / adjust / reserve / release / ship', () => {
  const s = O.stockFromLedger([
    { sku: 'A', type: 'in', qty: 5 }, { sku: 'A', type: 'reserve', qty: 2 }, { sku: 'A', type: 'ship', qty: 1 },
    { sku: 'A', type: 'release', qty: 1 }, { sku: 'A', type: 'adjust', qty: -1 }, { sku: 'A', type: 'out', qty: 1 },
    { sku: 'B', type: 'in', qty: 1 },
  ]);
  assert.deepEqual(s.A, { onHand: 2, reserved: 0, available: 2 }); // 5 − 1 shipped − 1 adjusted − 1 out; 2 − 1 − 1 reserved
  assert.deepEqual(s.B, { onHand: 1, reserved: 0, available: 1 });
});

test('auto-pull only from «متاح للبيع» with enough available', () => {
  assert.equal(O.canAutoPull({ reason: 'متاح للبيع', available: 2 }, 2), true);
  assert.equal(O.canAutoPull({ reason: 'متاح للبيع', available: 1 }, 2), false);
  assert.equal(O.canAutoPull({ reason: 'تصوير', available: 5 }, 1), false, 'a photo piece is never pulled');
});

test('receiving: the product, a quantity ≥ 1, the reason; a return needs its condition, and a note for a defect', () => {
  assert.deepEqual(Object.keys(O.validateReceive({})).sort(), ['qty', 'reason', 'sku']);
  assert.deepEqual(O.validateReceive({ sku: 'A', qty: 1, reason: 'مرتجع' }), { condition: 'اختار حالة المنتج' });
  assert.deepEqual(O.validateReceive({ sku: 'A', qty: 1, reason: 'مرتجع', condition: 'ناقص' }), { conditionNote: 'اكتب وصف الحالة' });
  assert.deepEqual(O.validateReceive({ sku: 'A', qty: 1, reason: 'مرتجع', condition: 'سليم' }), {});
  assert.deepEqual(O.validateReceive({ sku: 'A', qty: 2, reason: 'متاح للبيع' }), {});
});

test('a sub-order arriving: the reason defaults to «تجميع أوردر» inside a consolidation; the first status, the ref and the zone', () => {
  assert.equal(O.arrivalReason(true), 'تجميع أوردر');
  assert.equal(O.arrivalReason(false), '');
  assert.deepEqual(O.arrivalStock({ reason: 'تجميع أوردر', order: 180662, sid: 7 }), { status: 'وصل المخزن', ref: 'IB-180662', label: 'دخول — تجميع', zone: 'T' });
  assert.deepEqual(O.arrivalStock({ reason: 'مرتجع', order: 180662, sid: 7 }), { status: 'بانتظار الفحص', ref: '#7', label: 'دخول — مرتجع', zone: 'R' });
  assert.throws(() => O.arrivalStock({ reason: 'x' }));
});

test('inspection default, the late rules (consolidation 5 days, photo 14 days), a consolidation ready when all arrived', () => {
  assert.equal(O.inspectDefault('تالف'), 'تالف');
  assert.equal(O.inspectDefault('عيب بسيط'), 'سليم');
  assert.equal(O.inspectDefault(''), undefined);
  assert.equal(O.consolidationLate(4), false); assert.equal(O.consolidationLate(5), true);
  assert.equal(O.photoOverdue(13), false); assert.equal(O.photoOverdue(14), true);
  assert.deepEqual(O.consolidation(['وصل المخزن', 'قيد التنفيذ']), { arrived: 1, total: 2, ready: false });
  assert.deepEqual(O.consolidation(['وصل المخزن', 'وصل المخزن']), { arrived: 2, total: 2, ready: true });
});

test('a count\'s difference: the lines counted differently, the units and the value', () => {
  assert.deepEqual(O.countDiff([{ system: 5, counted: 4, cost: 450 }, { system: 6, counted: 7, cost: 220 }, { system: 3, counted: 3, cost: 280 }]), { items: 2, units: 0, value: -230 });
});

test('the ship-ready statuses carry «المبتكر» like the orders (0018) — a waybill is made for them', () => {
  assert.equal(O.isShipReady('جاهز للشحن من المبتكر للعميل'), true);
  assert.equal(O.isShipReady('جاهز للشحن من المورد للعميل'), false);
  assert.deepEqual(O.shipRoute('جاهز للشحن من المبتكر للمخزن'), { from: 'vendor', to: 'warehouse', label: 'من المبتكر للمخزن' });
});
