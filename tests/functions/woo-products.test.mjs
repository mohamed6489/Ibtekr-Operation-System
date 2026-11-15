// The brand in both places (the owner 15 Nov — docs/superpowers/plans/2026-11-15-comments.md decision 81): the pure helpers woo-sync
// uses to write a product's WooCommerce brand into its «Product Brand» attribute (pa_brand) too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brandNamesOf, withBrandAttr } from '../../supabase/functions/_shared/woo-products.js';

const color = { id: 12, name: 'Color', slug: 'pa_color', position: 0, visible: true, variation: true, options: ['Red', 'Blue'] };
const custom = { id: 0, name: 'Care', position: 1, visible: false, variation: false, options: ['Dry clean'] };
const brand = (options, extra = {}) => ({ id: 13, name: 'Product Brand', slug: 'pa_brand', position: 2, visible: true, variation: false, options, ...extra });

test('brandNamesOf: the names as plain text (the REST answer escapes «&»), no duplicates, nothing with a tag', () => {
  assert.deepEqual(brandNamesOf({ brands: [{ id: 3, name: 'Sugar &amp; Crafts' }, { id: 4, name: ' sugar & crafts ' }, { id: 5, name: 'Lusso' }, { id: 6, name: '' }, { id: 7, name: '<b>x</b>' }, null] }), ['Sugar & Crafts', 'Lusso']);
  assert.deepEqual(brandNamesOf({}), []);
  assert.deepEqual(brandNamesOf(null), []);
});

test('withBrandAttr: the brand attribute takes the names; every other attribute goes back as it was (a global one by id, a custom one by name)', () => {
  assert.deepEqual(withBrandAttr([color, custom, brand(['Old'])], 13, ['Lusso']), [
    { id: 12, position: 0, visible: true, variation: true, options: ['Red', 'Blue'] },
    { name: 'Care', position: 1, visible: false, variation: false, options: ['Dry clean'] },
    { id: 13, position: 2, visible: true, variation: false, options: ['Lusso'] },
  ]);
  // a product with no brand attribute yet: it goes last
  assert.deepEqual(withBrandAttr([color], 13, ['Lusso']), [{ id: 12, position: 0, visible: true, variation: true, options: ['Red', 'Blue'] }, { id: 13, position: 1, visible: true, variation: false, options: ['Lusso'] }]);
  assert.deepEqual(withBrandAttr([], 13, ['Lusso']), [{ id: 13, position: 0, visible: true, variation: false, options: ['Lusso'] }]);
  assert.deepEqual(withBrandAttr(undefined, 13, ['Lusso']), [{ id: 13, position: 0, visible: true, variation: false, options: ['Lusso'] }]);
  // a hidden brand attribute stays hidden; one wrongly used for variations stops being one
  assert.deepEqual(withBrandAttr([brand(['Old'], { visible: false, variation: true })], 13, ['Lusso']), [{ id: 13, position: 2, visible: false, variation: false, options: ['Lusso'] }]);
});

test('withBrandAttr: already right → null (case, spaces and the escaped «&» set aside); no brand → the attribute is taken off; a bad attribute id → null', () => {
  assert.equal(withBrandAttr([color, brand(['lusso'])], 13, ['Lusso']), null);
  assert.equal(withBrandAttr([brand(['Sugar &amp; Crafts'])], 13, ['Sugar & Crafts ']), null);
  assert.equal(withBrandAttr([color], 13, []), null, 'no brand and no attribute: nothing to write');
  assert.deepEqual(withBrandAttr([color, brand(['Lusso'])], 13, []), [{ id: 12, position: 0, visible: true, variation: true, options: ['Red', 'Blue'] }]);
  assert.deepEqual(withBrandAttr([brand(['Lusso', 'Old'])], 13, ['Lusso']), [{ id: 13, position: 2, visible: true, variation: false, options: ['Lusso'] }], 'an extra old name goes');
  assert.equal(withBrandAttr([color], null, ['Lusso']), null);
  assert.equal(withBrandAttr([color], 0, ['Lusso']), null);
  // names twice or empty are one
  assert.deepEqual(withBrandAttr([], 13, ['Lusso', ' lusso ', '']), [{ id: 13, position: 0, visible: true, variation: false, options: ['Lusso'] }]);
});
