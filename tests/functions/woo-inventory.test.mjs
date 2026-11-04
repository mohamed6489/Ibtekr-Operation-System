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
