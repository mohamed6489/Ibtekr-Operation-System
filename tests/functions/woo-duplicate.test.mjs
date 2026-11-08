import { test } from 'node:test'; import assert from 'node:assert/strict';
import { COPY_SUFFIX, duplicateSku, variationSku, duplicatePayload, duplicateVariation, duplicateAr } from '../../supabase/functions/_shared/woo-duplicate.js';
// «تكرار كمنتج جديد» (phase 12 T2): the copy's SKU under the studio's serial, the variations' SKUs, and the payloads WooCommerce
// takes — a draft with the source's data, the same media ids, no price or text invented.

test('duplicateSku: a studio SKU keeps brand, color and size under the new serial; another SKU takes -serial; none or a bad serial → null', () => {
  assert.equal(duplicateSku('IBTARBE0999', 1234), 'IBTARBE1234');
  assert.equal(duplicateSku('IBTAR0999', 1234), 'IBTAR1234', 'a Variable has no color');
  assert.equal(duplicateSku('IBTARBE0999-40', 7), 'IBTARBE0007-40');
  assert.equal(duplicateSku('IBTARBE12345', 20000), 'IBTARBE20000', 'five digits stay five');
  assert.equal(duplicateSku('OLD-SKU-1', 1234), 'OLD-SKU-1-1234');
  assert.equal(duplicateSku('', 1234), null); assert.equal(duplicateSku('IBTARBE0999', -1), null); assert.equal(duplicateSku('IBTARBE0999', '12'), null);
});

test('variationSku: a studio variation SKU keeps its color and size under the new serial; else the parent part swapped when it leads the SKU; else the new parent + -n', () => {
  const o = { serial: 1234, oldParent: 'IBTAR0999', newParent: 'IBTAR1234' };
  assert.equal(variationSku('IBTARBE0999-40', { ...o, n: 1 }), 'IBTARBE1234-40', 'the studio\'s Variable: the color sits between the brand and the serial');
  assert.equal(variationSku('IBTARBK0999', { ...o, n: 2 }), 'IBTARBK1234');
  assert.equal(variationSku('OLD-1-S', { serial: 1234, oldParent: 'OLD-1', newParent: 'OLD-1-1234', n: 1 }), 'OLD-1-1234-S');
  assert.equal(variationSku('X-1', { ...o, n: 3 }), 'IBTAR1234-3');
  assert.equal(variationSku('', { ...o, n: 2 }), 'IBTAR1234-2');
  assert.equal(variationSku('X-1', { serial: 1234, oldParent: '', newParent: null, n: 2 }), 'X-1', 'no new parent SKU: the old one stays');
});

const SRC = { id: 501, name: ' Boho Lamp ', type: 'variable', status: 'publish', lang: 'en', description: '<p>d</p>', short_description: 's', regular_price: '150', sale_price: '120', manage_stock: false, stock_quantity: null, stock_status: 'instock', backorders: 'no', weight: '1.2',
  dimensions: { length: '10', width: '', height: '5' }, categories: [{ id: 20, name: 'Lamps' }, { id: 'x' }], tags: [{ id: 3 }], brands: [{ id: 7, name: 'Art Craft' }], images: [{ id: 11, src: 'https://woo.test/a.jpg' }, { id: 12 }],
  attributes: [{ id: 12, name: 'Color', position: 0, visible: true, variation: true, options: ['Beige', 'Black'] }, { id: 0, name: 'Material', position: 1, visible: true, variation: false, options: ['Bamboo'] }, { id: 15, name: 'Empty', options: [] }],
  translations: { ar: 601, en: 501 }, permalink: 'https://woo.test/p/501', price: '120', date_created: 'x', total_sales: 9, meta_data: [{ key: 'rank_math_title', value: 't' }] };

test('duplicatePayload: a draft with the source\'s texts, prices, stock, weight / dimensions, categories, tags, brands, attributes and the same media ids under the new SKU; nothing of the source\'s identity or sales', () => {
  const p = duplicatePayload(SRC, { sku: 'IBTAR1234' });
  assert.deepEqual(p, { name: 'Boho Lamp ' + COPY_SUFFIX, type: 'variable', status: 'draft', description: '<p>d</p>', short_description: 's', regular_price: '150', sale_price: '120', manage_stock: false, stock_status: 'instock', backorders: 'no', weight: '1.2',
    categories: [{ id: 20 }], tags: [{ id: 3 }], images: [{ id: 11 }, { id: 12 }], attributes: [{ id: 12, name: 'Color', position: 0, visible: true, variation: true, options: ['Beige', 'Black'] }, { name: 'Material', position: 1, visible: true, variation: false, options: ['Bamboo'] }],
    lang: 'en', wpml_language: 'en', brands: [{ id: 7 }], dimensions: { length: '10', height: '5' }, sku: 'IBTAR1234' });
  assert.ok(!('id' in p) && !('permalink' in p) && !('total_sales' in p) && !('meta_data' in p) && !('translations' in p));
  const s = duplicatePayload({ name: 'Mug', type: 'simple', manage_stock: true, stock_quantity: 4, regular_price: 100 }, {});
  assert.deepEqual([s.sku, s.manage_stock, s.stock_quantity, s.regular_price, s.brands, s.type], [undefined, true, 4, '100', undefined, 'simple']);
  assert.equal(duplicatePayload(null, {}), null);
});

test('duplicateVariation / duplicateAr: the variation\'s prices, stock, attribute options and image under its SKU; the Arabic copy linked with translation_of, no SKU', () => {
  const v = duplicateVariation({ id: 5011, sku: 'IBTAR0999-40', regular_price: '150', sale_price: '120', manage_stock: true, stock_quantity: 3, attributes: [{ id: 12, name: 'Color', option: 'Beige' }, { id: 9, option: '' }], image: { id: 12, src: 'x' }, permalink: 'y' }, 'IBTAR1234-40');
  assert.deepEqual(v, { regular_price: '150', sale_price: '120', manage_stock: true, stock_quantity: 3, attributes: [{ id: 12, name: 'Color', option: 'Beige' }], sku: 'IBTAR1234-40', image: { id: 12 } });
  const a = duplicateAr({ id: 601, name: 'لمبة بوهو', sku: 'IBTAR0999', description: '<p>وصف</p>', short_description: 'قصير', attributes: [{ id: 12, name: 'اللون', position: 0, visible: true, variation: true, options: ['بيج'] }] }, { type: 'variable', translationOf: 900 });
  assert.deepEqual(a, { name: 'لمبة بوهو ' + COPY_SUFFIX, description: '<p>وصف</p>', short_description: 'قصير', attributes: [{ id: 12, name: 'اللون', position: 0, visible: true, variation: true, options: ['بيج'] }], type: 'variable', status: 'draft', lang: 'ar', wpml_language: 'ar', translation_of: 900 });
  assert.ok(!('sku' in a));
});
