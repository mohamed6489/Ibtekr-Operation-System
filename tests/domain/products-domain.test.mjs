import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// The products domain (phase 5): the prototype's block 17 as it is (app/js/pages/products-domain.js) — the rules the records and
// the bulk popups use: the price formula, the bulk price change, the stock state, the completeness check and the trash days.
const PD = loadUmd(new URL('../../app/js/pages/products-domain.js', import.meta.url));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('price: sale = vendor ÷ (1 − rate), regular = sale ÷ (1 − discount), share = sale − vendor', () => {
  assert.deepEqual(plain(PD.price(1000, 0.33, 0.2)), { sale: 1493, regular: 1866, share: 493 });
  assert.deepEqual(plain(PD.price(800, 0.25, 0)), { sale: 1067, regular: 1067, share: 267 });
});

test('bulkPrice: the maker price (± % or value) recomputes the sale; the Ibtekr rate and the discount move in points, capped 0–90', () => {
  const p = { vendorPrice: 1000, rate: 33, disc: 20 };
  assert.deepEqual(plain(PD.bulkPrice(p, { target: 'vendor', mode: 'pct', dir: 1, amount: 10 })), { vendorPrice: 1100, rate: 33, disc: 20, sale: 1642, regular: 2053 });
  assert.deepEqual(plain(PD.bulkPrice(p, { target: 'vendor', mode: 'value', dir: -1, amount: 2000 })).vendorPrice, 0);
  assert.equal(PD.bulkPrice(p, { target: 'rate', mode: 'value', dir: 1, amount: 70 }).rate, 90);
  assert.equal(PD.bulkPrice(p, { target: 'discount', mode: 'value', dir: -1, amount: 30 }).disc, 0);
});

test('stockState: on demand, out, low (at the alert, 3 by default), available', () => {
  assert.equal(PD.stockState(0, true, 3), 'حسب الطلب');
  assert.equal(PD.stockState(0, false, 3), 'نفد');
  assert.equal(PD.stockState(3, false), 'قليل');
  assert.equal(PD.stockState(2, false, 1), 'متاح');
});

test('completeness: the missing fields by label and the share filled', () => {
  const c = PD.completeness({ nameEn: 'Lamp', nameAr: '', sku: 'X', price: 10, images: 2, category: 'Decor', weight: '', sizeImage: true, desc: 'x' });
  assert.deepEqual(plain(c), { missing: ['الاسم AR', 'الوزن'], pct: 78 });
});

test('trash: 30 days kept, the days left never below 0, «قرب يتمسح» at 5 days or less', () => {
  assert.equal(PD.TRASH_DAYS, 30);
  assert.equal(PD.trashDaysLeft('2026-10-01', '2026-10-28'), 3);
  assert.equal(PD.trashDaysLeft('2026-09-01', '2026-10-28'), 0);
  assert.equal(PD.trashSoon(5), true); assert.equal(PD.trashSoon(6), false);
});
