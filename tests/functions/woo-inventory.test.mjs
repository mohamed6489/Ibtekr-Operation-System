import { test } from 'node:test'; import assert from 'node:assert/strict';
import { siteQuantities, skuList, INVENTORY_PUSH_MAX } from '../../supabase/functions/_shared/woo-inventory.js';
// Phase 7 (decision 1 c): the site quantity of the SKUs Ibtekr owns = the available pieces held «متاح للبيع».
const lot = (id, sku, o = {}) => ({ id, sku, mode: 'ملك ابتكر', reason: 'متاح للبيع', closed_at: null, ...o });
const mv = (lot_id, type, qty) => ({ lot_id, type, qty });

test('the available pieces per owned SKU: on hand − reserved over its open «متاح للبيع» lots', () => {
  const q = siteQuantities([lot('a', 'S1'), lot('b', 'S1'), lot('c', 'S2')],
    [mv('a', 'in', 5), mv('a', 'out', 1), mv('a', 'reserve', 2), mv('a', 'release', 1), mv('b', 'in', 2), mv('b', 'adjust', -1), mv('b', 'ship', 1), mv('c', 'in', 1), mv('c', 'move', 0)]);
  assert.deepEqual([...q], [['S1', 3], ['S2', 1]]); // a: 4 on hand − 1 held; b: 0
});

test('a SKU Ibtekr owned but holds in no «متاح للبيع» lot now reads 0; a maker\'s «أمانة» SKU is not followed', () => {
  const q = siteQuantities([lot('a', 'S1', { reason: 'تصوير' }), lot('b', 'S2', { closed_at: '2026-11-01' }), lot('c', 'S3', { mode: 'أمانة' }), lot('d', ' S4 ')],
    [mv('a', 'in', 3), mv('b', 'in', 2), mv('c', 'in', 4), mv('d', 'in', 1), mv('d', 'reserve', 3)]);
  assert.deepEqual([...q], [['S1', 0], ['S2', 0], ['S4', 0]]); // never below 0
});

test('the SKUs asked for', () => {
  assert.equal(skuList(undefined), undefined);
  assert.deepEqual(skuList([' A ', 'A', 'B', 3, '']), ['A', 'B']);
  assert.equal(skuList([]), null);
  assert.equal(skuList('A'), null);
  assert.equal(skuList(Array.from({ length: INVENTORY_PUSH_MAX + 1 }, (_, i) => 'S' + i)), null);
});

// phase 13 T2 (decision 5): the automatic pull of a new order's lines from «متاح للبيع»
import { autoPullPlan, lotAvailability, RESERVED_STATUS } from '../../supabase/functions/_shared/woo-inventory.js';
test('autoPullPlan: a line whose SKU is for sale with enough pieces takes the fullest lot; two lines of one SKU never book the same piece; no SKU / no stock / a closed lot → left alone', () => {
  const lots = [lot('a', 'S1', { name: 'شمعة' }), lot('b', 'S1', { name: 'شمعة' }), lot('c', 'S2', { reason: 'تصوير' }), lot('d', 'S3', { closed_at: '2026-11-01' }), lot('e', 'S4')];
  const moves = [mv('a', 'in', 1), mv('b', 'in', 3), mv('b', 'reserve', 1), mv('c', 'in', 5), mv('d', 'in', 5), mv('e', 'in', 2), mv('e', 'reserve', 2)];
  assert.deepEqual(lotAvailability(lots, moves).map((a) => [a.lot.id, a.available]), [['a', 1], ['b', 2], ['e', 0]]);
  const items = [{ id: 11, order_id: 1001, order_number: '1001', sku: 'S1', qty: 1, name: 'x' }, { id: 12, order_id: 1001, order_number: '1001', sku: ' S1 ', qty: 1 }, { id: 13, order_id: 1001, sku: 'S1', qty: 1 },
    { id: 14, order_id: 1001, sku: 'S2', qty: 1 }, { id: 15, order_id: 1001, sku: 'S3', qty: 1 }, { id: 16, order_id: 1001, sku: 'S4', qty: 1 }, { id: 17, order_id: 1001, sku: null, qty: 1 }, { id: 18, order_id: 1001, sku: 'S1', qty: 0 }];
  const plan = autoPullPlan({ items, lots, moves });
  assert.deepEqual(plan, [
    { itemId: 11, orderId: 1001, orderNumber: '1001', lotId: 'b', sku: 'S1', name: 'شمعة', qty: 1, exhausted: false },
    { itemId: 12, orderId: 1001, orderNumber: '1001', lotId: 'a', sku: 'S1', name: 'شمعة', qty: 1, exhausted: true }, // a tie (1 and 1) keeps the lots' order
    { itemId: 13, orderId: 1001, orderNumber: null, lotId: 'b', sku: 'S1', name: 'شمعة', qty: 1, exhausted: true },
  ]);
  assert.deepEqual(autoPullPlan({ items: [{ id: 1, order_id: 1, sku: 'S1', qty: 4 }], lots, moves }), [], 'a quantity no single lot covers is not split');
  assert.equal(RESERVED_STATUS, 'محجوز لأوردر');
});
