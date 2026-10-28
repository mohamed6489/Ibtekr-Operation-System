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

// decision 16 (the owner, 28 Oct): the prices come from the maker's price
test('priceFromVendor: sale = (vendor + fee) ÷ (1 − rate) up to the next 10; regular = sale + 15–30% up to the next 10', () => {
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, markup: 22 })), { sale: 1670, regular: 2040, markup: 22, vendorNet: 1002 });
  // the fee before the division: the maker keeps his full price
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, fee: 10, markup: 15 })), { sale: 1690, regular: 1950, markup: 15, vendorNet: 1004 });
  // already a multiple of 10 stays (no float drift): 600 ÷ 0.6 = 1000
  assert.equal(PD.priceFromVendor(600, { rate: 40, markup: 30 }).sale, 1000);
  assert.equal(PD.priceFromVendor(600, { rate: 40, markup: 30 }).regular, 1300);
  // a flat-only commission (rate 0): vendor + amount
  assert.equal(PD.priceFromVendor(995, { rate: 0, fee: 50, markup: 20 }).sale, 1050);
  // Woven Floor Lamp: 11,375 at 35% → 17,500 exactly
  assert.equal(PD.priceFromVendor(11375, { rate: 35, markup: 20 }).sale, 17500);
  for (const bad of [0, -5, 'x', null]) assert.equal(PD.priceFromVendor(bad, { rate: 40 }), null);
  assert.equal(PD.priceFromVendor(1000, { rate: 100 }), null);
  assert.equal(PD.priceFromVendor(1000, { rate: -1 }), null);
});

test('randomMarkup: a whole number from 15 to 30, both ends reachable; priceFromVendor without a markup picks one', () => {
  assert.equal(PD.randomMarkup(() => 0), 15);
  assert.equal(PD.randomMarkup(() => 0.999999), 30);
  assert.equal(PD.randomMarkup(() => 1), 30);
  for (let i = 0; i < 200; i++) { const m = PD.randomMarkup(); assert.ok(Number.isInteger(m) && m >= 15 && m <= 30, String(m)); }
  const r = PD.priceFromVendor(1000, { rate: 40, rng: () => 0.5 });
  assert.equal(r.markup, 23);
  assert.equal(r.regular, PD.ceil10(1670 * 1.23));
  assert.ok(r.regular % 10 === 0 && r.regular > r.sale);
});

test('outOfStock (decision 20): out on the site or tracked stock at 0, never «حسب الطلب»; most sold first', () => {
  const recs = [
    { id: 1, stockStatus: 'outofstock', onDemand: false, sales: 2 },
    { id: 2, stockStatus: 'instock', manageStock: true, stock: 0, onDemand: false, sales: 9 },
    { id: 3, stockStatus: 'onbackorder', manageStock: true, stock: 0, onDemand: true, sales: 50 },
    { id: 4, stockStatus: 'instock', manageStock: true, stock: 3, onDemand: false, sales: 70 },
    { id: 5, stockStatus: 'instock', manageStock: false, stock: null, onDemand: false, sales: 1 },
  ];
  assert.deepEqual(PD.outOfStock(recs).map((p) => p.id), [2, 1]);
  assert.deepEqual(plain(PD.outOfStock(null)), []);
});

test('categoriesRank (decision 20): same-name categories merged, ranked by pieces then revenue, share of all pieces, top n', () => {
  const r = PD.categoriesRank([
    { name: 'Lamps', sold: 3, revenue: 600, products: 1, orders: 2 },
    { name: ' lamps ', sold: 1, revenue: 100, products: 1, orders: 1 },
    { name: 'Cups', sold: 4, revenue: 50.5, products: 2, orders: 1 },
    { name: 'Rugs', sold: 2, revenue: 900, products: 1, orders: 2 },
  ]);
  assert.deepEqual(plain(r.map((x) => [x.rank, x.name, x.sold, x.revenue, x.products, x.share])), [[1, 'Lamps', 4, 700, 2, 0.4], [2, 'Cups', 4, 50.5, 2, 0.4], [3, 'Rugs', 2, 900, 1, 0.2]]);
  assert.equal(PD.categoriesRank([{ name: 'A', sold: 1 }, { name: 'B', sold: 2 }], 1).length, 1);
  assert.deepEqual(plain(PD.categoriesRank([])), []);
});
