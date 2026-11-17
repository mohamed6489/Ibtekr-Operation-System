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

// ---------------- the product studio (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md) ----------------
import { deflateRawSync } from 'node:zlib';

test('studioSku (decision 2): IBT + brand 2 letters + color code + serial (4 digits, from 0999); Variable parent without color; size digits after a dash', () => {
  assert.deepEqual(plain(PD.studioSku({ brand: 'Art Craft', color: 'BE', serial: 999 })), { sku: 'IBTARBE0999', missing: [] });
  assert.equal(PD.studioSku({ brand: 'Art Craft', serial: 999 }).sku, 'IBTAR0999');
  assert.equal(PD.studioSku({ brand: 'Art Craft', color: 'BK', serial: 1000, size: '50×50' }).sku, 'IBTARBK1000-5050');
  assert.equal(PD.studioSku({ brand: 'Bian eg', color: 'OW', serial: 12345 }).sku, 'IBTBIOW12345');
  assert.equal(PD.studioSku({ brand: 'Art Craft', color: 'BE', serial: 1001, size: '٤٠×٤٠ سم' }).sku, 'IBTARBE1001-4040');
  assert.deepEqual(plain(PD.studioSku({ brand: 'إبتكر', color: 'b1', serial: null })), { sku: 'IBT??####', missing: ['البراند', 'كود اللون', 'المسلسل'] });
  assert.equal(PD.brandCode('w&r Wood'), 'WR');
  assert.equal(PD.serialText(999), '0999');
});

test('suggestColorCode (decision 3): the first two letters, else the first + another letter, else a free pair', () => {
  assert.equal(PD.suggestColorCode('Sage Green', []), 'SA');
  assert.equal(PD.suggestColorCode('Black', ['BL']), 'BA');
  assert.equal(PD.suggestColorCode('Blue', ['BL', 'BU', 'BE']), 'AA');
  assert.equal(PD.suggestColorCode('Blue', ['BL', 'BU']), 'BE');
});

test('parseCsv: commas / semicolons, quotes with commas and new lines, BOM, empty rows dropped', () => {
  assert.deepEqual(PD.parseCsv('﻿Name,Price\r\n"Lamp, big",1000\r\n\r\n"say ""hi""\nthere",5\n'), [['Name', 'Price'], ['Lamp, big', '1000'], ['say "hi"\nthere', '5']]);
  assert.deepEqual(PD.parseCsv('الاسم;السعر\nلمبة;٥٠٠'), [['الاسم', 'السعر'], ['لمبة', '٥٠٠']]);
});

function zipOf(files, deflate) { // a tiny zip writer for the test (method 8 when deflate)
  const enc = (s) => new TextEncoder().encode(s); const parts = []; const central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const n = enc(name); const raw = enc(text); const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw; const crc = PD.crc32(raw);
    const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(deflate ? 8 : 0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(n.length), ...u16(0)];
    parts.push(Uint8Array.from(head), n, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(deflate ? 8 : 0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(raw.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), n);
    off += head.length + n.length + data.length;
  }
  const cd = central.reduce((a, b) => a + b.length, 0); const cnt = Object.keys(files).length;
  const all = [...parts, ...central, Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(cnt), ...u16(cnt), ...u32(cd), ...u32(off), 0, 0])];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const b of all) { out.set(b, p); p += b.length; } return out;
}

test('parseXlsx: the first sheet of a deflated workbook — shared strings, inline strings, numbers, gaps keep their column; and the studio\'s own export reads back', async () => {
  const wb = zipOf({
    'xl/sharedStrings.xml': '<sst><si><t>Name EN</t></si><si><t>سعر المبتكر</t></si><si><r><t>Lamp</t></r><r><t xml:space="preserve"> &amp; Co</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1200</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Cup</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>other</t></is></c></row></sheetData></worksheet>',
  }, true);
  assert.deepEqual(await PD.parseXlsx(wb), [['Name EN', '', 'سعر المبتكر'], ['Lamp & Co', '', '1200'], ['Cup']]);
  const back = await PD.parseXlsx(PD.xlsx([['الاسم (EN)', 'سعر المبتكر'], ['Lamp', 1500]], 'المنتجات'));
  assert.deepEqual(back.map((r) => r.map(String)), [['الاسم (EN)', 'سعر المبتكر'], ['Lamp', '1500']]);
  await assert.rejects(() => PD.parseXlsx(new Uint8Array([1, 2, 3])));
});

test('mapColumns + rowsToItems + itemIssues: headers matched in English or Arabic, lists split, Arabic digits, empty rows dropped; what is missing', () => {
  const rows = [['Product Name EN', 'الاسم بالعربي', 'Vendor Price', 'Product Colors', 'المقاس', 'الخامة', 'Weight', 'الكمية', 'notes'],
    ['Boho Cushion', 'مخدة بوهيمي', '١٬٠٠٠', 'Beige، Black', '50×50 / 40×40', 'قطن', '0.4 kg', '5', 'x'], ['', '', '', '', '', '', '', '', 'only notes'], ['', 'لمبة', '', '', '', '', '', '', '']];
  const map = PD.mapColumns(rows[0]);
  assert.deepEqual(plain(map), { nameEn: 0, nameAr: 1, vendorPrice: 2, colors: 3, sizes: 4, material: 5, weight: 6, stock: 7 });
  const items = PD.rowsToItems(rows, map);
  assert.equal(items.length, 2);
  assert.deepEqual(plain(items[0]), { row: 2, nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 1000, colors: ['Beige', 'Black'], sizes: ['50×50', '40×40'], material: 'قطن', style: '', weight: '0.4', stock: 5, shortDesc: '', shortDescAr: '', category: '' });
  assert.deepEqual(PD.itemIssues(items[0], 'Variable'), []);
  assert.deepEqual(PD.itemIssues(items[1], 'Variable'), ['الاسم (EN)', 'سعر المبتكر', 'المتغيرات']);
  assert.deepEqual(PD.itemIssues(items[1], 'Simple'), ['الاسم (EN)', 'سعر المبتكر']);
});

// decision 16 (the owner, 31 Oct — his WP All Import template): a shared «unique id» groups the rows of one Variable product
test('rowsToItems grouped (decision 16): rows with the same parentsku = one product, the first row the parent, the next ones its variations with their own price and stock; a lone row or no id = a product as usual; Simple ignores the id', () => {
  const rows = [['Name EN', 'Name AR', 'Vendor Price', 'Colors', 'Sizes', 'Stock', 'parentsku'],
    ['Kilim Pouf', 'بوف كليم', '2000', '', '', '', 'P1'], ['', '', '', 'Beige', '50×50', '3', 'P1'], ['', '', '2200', 'Black', '40×40', '', 'P1'], ['', '', '', '', '', '', 'P1'],
    ['Tote', 'شنطة', '500', 'White', '', '2', 'P2'], ['Mug', 'مج', '120', 'Red, Blue', '', '', '']];
  const map = PD.mapColumns(rows[0]);
  assert.equal(map.group, 6);
  const V = PD.rowsToItems(rows, map, { type: 'Variable' });
  assert.deepEqual(V.map((it) => [it.row, it.nameEn, it.colors, it.sizes, it.vendorPrice]), [[2, 'Kilim Pouf', ['Beige', 'Black'], ['50×50', '40×40'], 2000], [6, 'Tote', ['White'], [], 500], [7, 'Mug', ['Red', 'Blue'], [], 120]]);
  assert.deepEqual(plain(V[0].variationRows), [{ row: 3, color: 'Beige', size: '50×50', vendorPrice: 2000, stock: 3 }, { row: 4, color: 'Black', size: '40×40', vendorPrice: 2200, stock: null }]); // the empty row of the group adds nothing; the parent's price fills a variation without one
  assert.equal(V[1].variationRows, undefined); // a lone row keeps the usual colors × sizes
  assert.equal(V[2].variationRows, undefined);
  const S = PD.rowsToItems(rows, map, { type: 'Simple' });
  assert.deepEqual(S.map((it) => it.row), [2, 4, 6, 7]); // Simple: every row with a name or a price is a product, the id column is ignored
  assert.equal(PD.rowsToItems(rows, map).length, 4); // no type given = as before
});

// the owner's real sheet (31 Oct, «Antikiano New Macrame Products»): every row repeats the product data and changes the color —
// the first row is a variation too; his column names; the category as a path; the Arabic short description
test('rowsToItems grouped — the owner\'s sheet: the first row of a group is a variation when it has a color; his headers (Parent SKU, Product Colors, size, Product Weight per KG, Short Description AR, Product Category) are matched; a one-row group stays a usual product', () => {
  const rows = [['#', 'Parent SKU', 'SKU', 'Product Name EN', 'Product Name AR', 'Product Colors', 'Product Colors AR', 'size', 'Product Style', 'Product Material', 'Product Weight per KG', 'Vendor Price', 'Regular price', 'sale price', 'Brand Name', 'Product Category', 'Short Description EN', 'Short Description AR'],
    ['24', 'IBTANTCH008', 'IBTANTCH008-BUR', 'Hourglass Macrame Chandelier', 'نجفة مكرمية', 'Burgundy', 'نبيتي', 'H 150 × Ø 80 cm', 'Modern', 'Fiber', '1.5', '15000', '24375', '19500', 'Antikiano', 'Lighting > CHANDELIERS > Macrame Chandellers', 'A tall macrame chandelier.', 'نجفة مكرمية طويلة.'],
    ['25', 'IBTANTCH008', 'IBTANTCH008-PNK', 'Hourglass Macrame Chandelier', 'نجفة مكرمية', 'Pink', 'وردي', 'H 150 × Ø 80 cm', 'Modern', 'Fiber', '1.5', '15000', '24375', '19500', 'Antikiano', 'Lighting > CHANDELIERS > Macrame Chandellers', 'A tall macrame chandelier.', 'نجفة مكرمية طويلة.'],
    ['22', 'IBTANTMW006', 'IBTANTMW006', 'Gradient Macrame Wall Hanging', 'معلقة حائط', 'Multicolor', 'متعدد', 'W 300 × L 100 cm', 'Modern', 'Fiber', '', '7000', '11875', '9500', 'Antikiano', 'Decor >WALL MACRAME> Macrame Balls', 'Colorful.', 'ملونة.']];
  const map = PD.mapColumns(rows[0]);
  assert.deepEqual(plain(map), { nameEn: 3, nameAr: 4, vendorPrice: 11, colors: 5, sizes: 7, material: 9, style: 8, weight: 10, shortDesc: 16, shortDescAr: 17, category: 15, group: 1 }); // Colors AR / size ar / SKU / prices / brand are not fields
  const V = PD.rowsToItems(rows, map, { type: 'Variable' });
  assert.equal(V.length, 2);
  assert.deepEqual([V[0].nameEn, V[0].colors, V[0].sizes, V[0].weight, V[0].shortDescAr, V[0].category], ['Hourglass Macrame Chandelier', ['Burgundy', 'Pink'], ['H 150 × Ø 80 cm'], '1.5', 'نجفة مكرمية طويلة.', 'Lighting > CHANDELIERS > Macrame Chandellers']);
  assert.deepEqual(plain(V[0].variationRows), [{ row: 2, color: 'Burgundy', size: 'H 150 × Ø 80 cm', vendorPrice: 15000, stock: null }, { row: 3, color: 'Pink', size: 'H 150 × Ø 80 cm', vendorPrice: 15000, stock: null }]);
  assert.equal(V[1].variationRows, undefined); assert.deepEqual(V[1].colors, ['Multicolor']);
  const tree = PD.catTree([{ id: 1, name: 'Lighting', parentId: null }, { id: 2, name: 'Chandeliers', parentId: 1 }, { id: 3, name: 'Macrame Chandellers', parentId: 2 }, { id: 4, name: 'Decor', parentId: null }, { id: 5, name: 'Macrame Balls', parentId: 4 }, { id: 6, name: 'Chandeliers', parentId: 4 }]);
  assert.equal(PD.catFromPath(tree, V[0].category), 3);
  assert.equal(PD.catFromPath(tree, V[1].category), 5); // the last name, case-insensitive, odd spacing around >
  assert.equal(PD.catFromPath(tree, 'Decor > Chandeliers'), 6); // two «Chandeliers»: the parent's name decides
  assert.equal(PD.catFromPath(tree, 'Lighting > Chandeliers'), 2);
  assert.equal(PD.catFromPath(tree, 'Nowhere > Unknown'), null);
  assert.equal(PD.catFromPath(tree, ''), null);
});

// decision 14 (the owner, 29 Oct): the studio's category picker is the site's tree; a sub-category ticks the ones above it
const CATS = [{ id: 1, name: 'Decor', parentId: null }, { id: 2, name: 'accessories', parentId: 1 }, { id: 3, name: 'Animals', parentId: 2 }, { id: 4, name: 'Trays', parentId: 1 },
  { id: 5, name: 'FURNITURE', parentId: null }, { id: 6, name: 'Chairs', parentId: 5 }, { id: 7, name: 'Orphan', parentId: 99 }, { id: 8, name: 'Loop A', parentId: 9 }, { id: 9, name: 'Loop B', parentId: 8 }];
const ids = (s) => [...s].sort((a, b) => a - b);

test('catTree + catAncestors (decision 14): roots and branches by name (case-insensitive), a missing parent = a root, a loop in the data never hangs', () => {
  const t = PD.catTree(CATS);
  assert.deepEqual(t.roots.map((c) => c.id), [1, 5, 7]);
  assert.deepEqual(t.kids.get(1).map((c) => c.name), ['accessories', 'Trays']);
  assert.deepEqual(PD.catAncestors(t, 3), [2, 1]);
  assert.deepEqual(PD.catAncestors(t, 1), []);
  assert.deepEqual(PD.catAncestors(t, 7), []);
  assert.deepEqual(PD.catAncestors(t, 8), [9]);
});

test('catToggle (decision 14): ticking a sub-category ticks the ones above it; unticking drops the ones it ticked when nothing under them is left; a parent ticked by hand stays; a parent can be unticked alone', () => {
  const t = PD.catTree(CATS);
  let s = PD.catToggle(t, { chosen: new Set(), auto: new Set() }, 3, true);
  assert.deepEqual([ids(s.chosen), ids(s.auto)], [[1, 2, 3], [1, 2]]);
  s = PD.catToggle(t, s, 4, true);
  assert.deepEqual([ids(s.chosen), ids(s.auto)], [[1, 2, 3, 4], [1, 2]]);
  const before = s;
  s = PD.catToggle(t, s, 3, false); // Decor stays: Trays is still under it
  assert.deepEqual([ids(s.chosen), ids(s.auto)], [[1, 4], [1]]);
  assert.deepEqual(ids(before.chosen), [1, 2, 3, 4]); // the input is untouched
  s = PD.catToggle(t, s, 4, false);
  assert.deepEqual([ids(s.chosen), ids(s.auto)], [[], []]);
  s = PD.catToggle(t, { chosen: new Set([1]), auto: new Set() }, 4, true); // Decor ticked by hand (or saved on the item)
  s = PD.catToggle(t, s, 4, false);
  assert.deepEqual(ids(s.chosen), [1]);
  s = PD.catToggle(t, PD.catToggle(t, { chosen: new Set(), auto: new Set() }, 6, true), 5, false); // the parent unticked alone
  assert.deepEqual([ids(s.chosen), ids(s.auto)], [[6], []]);
  s = PD.catToggle(t, s, 6, false);
  assert.deepEqual(ids(s.chosen), []);
});

test('catSearch (decision 14): the categories whose name has the text (any case) and the ones above them, opened; empty text = the whole tree', () => {
  const t = PD.catTree(CATS);
  assert.equal(PD.catSearch(t, '  '), null);
  const f = PD.catSearch(t, 'ANIM');
  assert.deepEqual([ids(f.hits), ids(f.show), ids(f.open)], [[3], [1, 2, 3], [1, 2]]);
  assert.deepEqual(ids(PD.catSearch(t, 'zzz').show), []);
});

test('itemIssues (decision 15): the Arabic name is required — «الاستلام» lets it through ({ ar: false }) so it can be typed in «البيانات و SKU»', () => {
  const it = { nameEn: 'Desk Lamp', nameAr: '  ', vendorPrice: 900, colors: ['BE'], sizes: [] };
  assert.deepEqual(PD.itemIssues(it, 'Simple'), ['الاسم (AR)']);
  assert.deepEqual(PD.itemIssues({ ...it, nameAr: undefined }, 'Simple'), ['الاسم (AR)']);
  assert.deepEqual(PD.itemIssues(it, 'Simple', { ar: false }), []);
  assert.deepEqual(PD.itemIssues({ ...it, nameEn: '', nameAr: '' }, 'Simple'), ['الاسم (EN)', 'الاسم (AR)']);
  assert.deepEqual(PD.itemIssues({ ...it, nameAr: 'أباجورة' }, 'Simple'), []);
});

test('itemIssues ({ color: true } — «البيانات و SKU», the owner 1 Nov: «اللون مبيتحطش في الداتا»): a Simple product without a color is missing «اللون»; a Variable one is covered by «المتغيرات»; the intake never asks', () => {
  const it = { nameEn: 'Clay Vase', nameAr: 'مزهرية فخار', vendorPrice: 400, colors: [], sizes: [] };
  assert.deepEqual(PD.itemIssues(it, 'Simple', { color: true }), ['اللون']);
  assert.deepEqual(PD.itemIssues(it, 'Simple'), [], 'the intake lets it through');
  assert.deepEqual(PD.itemIssues({ ...it, colors: ['BE'] }, 'Simple', { color: true }), []);
  assert.deepEqual(PD.itemIssues(it, 'Variable', { color: true }), ['المتغيرات'], 'no «اللون» twice');
  assert.deepEqual(PD.itemIssues({ ...it, sizes: ['S'] }, 'Variable', { color: true }), [], 'sizes alone make a Variable product');
});

test('itemIssues ({ en: false } — «صور بس», the owner 1 Nov): one name in the file name is enough; the English name is still required everywhere else', () => {
  const arOnly = { nameEn: '', nameAr: 'شنطة جلد', vendorPrice: 1500, colors: ['BE'], sizes: [] };
  assert.deepEqual(PD.itemIssues(arOnly, 'Simple', { ar: false, en: false }), [], 'Arabic only passes the photos intake');
  assert.deepEqual(PD.itemIssues(arOnly, 'Simple', { en: false }), []);
  assert.deepEqual(PD.itemIssues(arOnly, 'Simple'), ['الاسم (EN)'], '«البيانات و SKU» still asks for it (AI or by hand)');
  assert.deepEqual(PD.itemIssues({ ...arOnly, nameAr: '' }, 'Simple', { ar: false, en: false }), ['الاسم (EN)'], 'no name at all = still missing');
  assert.deepEqual(PD.itemIssues({ ...arOnly, nameAr: '', nameEn: 'Leather Bag' }, 'Simple', { ar: false, en: false }), [], 'English only passes too');
});

// phase 5.3 (docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md): the content tool's text and its «احفظ على المنتج»
test('aiDisplay: one editable text per field — keywords on one line, bullets one per line; nothing invented for a missing language', () => {
  assert.deepEqual(plain(PD.aiDisplay({ ar: { name: 'مراية', keywords: ['مرايا بامبو', 'ديكور'], bullets: ['بامبو', '30×50 سم'] }, en: { short: 'A mirror.' } })),
    { ar: { name: 'مراية', keywords: 'مرايا بامبو · ديكور', bullets: '• بامبو\n• 30×50 سم' }, en: { short: 'A mirror.' } });
  assert.deepEqual(plain(PD.aiDisplay(null)), { ar: {}, en: {} });
});

test('paraHtml: paragraphs by blank lines, <br> inside one, & < > escaped (passes product_save\'s p / br allow-list)', () => {
  assert.equal(PD.paraHtml('Soft & warm <b>\n\n\nline 1\n line 2 '), '<p>Soft &amp; warm &lt;b&gt;</p><p>line 1<br>line 2</p>');
  assert.equal(PD.paraHtml('  \n\n '), '');
  assert.equal(PD.paraHtml(null), '');
});

test('aiSaveChange: name, descriptions (as HTML) and SEO per language; keywords / bullets never; the Arabic only with a translation', () => {
  const shown = { en: { name: ' Boho <Bamboo> Mirror ', short: 'A mirror.\n\nHandmade.', long: '', keywords: 'a · b', bullets: '• x', seo_title: 'Boho Mirror | Alaa Anas', seo_description: 'Natural\nbamboo.' },
    ar: { name: 'مراية بامبو', short: 'مراية.', seo_title: 'مرايا | Alaa Anas — إبتكر كلوب' } };
  assert.deepEqual(plain(PD.aiSaveChange(shown, true)), {
    fields: { name: 'Boho Bamboo Mirror', short_description: '<p>A mirror.</p><p>Handmade.</p>', seo_title: 'Boho Mirror | Alaa Anas', seo_description: 'Natural bamboo.' },
    ar: { name: 'مراية بامبو', short_description: '<p>مراية.</p>', seo_title: 'مرايا | Alaa Anas — إبتكر كلوب' } });
  assert.deepEqual(plain(PD.aiSaveChange(shown, false)).ar, {});
  assert.deepEqual(plain(PD.aiSaveChange({}, true)), { fields: {}, ar: {} });
});

test('aiApply (the studio): names only when empty, descriptions per empty language (all with force), categories with their parents, colors from the table, sizes only when none; each filled field marked', () => {
  const tree = PD.catTree([{ id: 10, name: 'Home', parentId: null }, { id: 11, name: 'Lamps', parentId: 10 }]);
  const it = { nameEn: 'Desk Lamp', nameAr: '', shortDesc: 'Warm.', shortDescAr: '', categories: [], colors: [], unknownColors: ['Sage'], sizes: [] };
  const marked = PD.aiApply(it, { nameEn: 'Other', nameAr: 'أباجورة', shortDesc: 'New.', shortDescAr: 'جديد.', categories: [11, 99], colors: ['BE', 'BK'], sizes: ['30×40'] },
    ['nameEn', 'nameAr', 'desc', 'category', 'variations'], { tree, type: 'Simple' });
  assert.deepEqual(plain(marked), ['nameAr', 'desc', 'category', 'variations']);
  assert.deepEqual(plain(it), { nameEn: 'Desk Lamp', nameAr: 'أباجورة', shortDesc: 'Warm.', shortDescAr: 'جديد.', categories: [11, 10], colors: ['BE'], unknownColors: [], sizes: ['30×40'],
    ai: { nameAr: true, desc: true, category: true, variations: true } });
  PD.aiApply(it, { shortDesc: 'Rewritten.', shortDescAr: 'تاني.' }, ['desc'], { tree, force: true });
  assert.deepEqual([it.shortDesc, it.shortDescAr], ['Rewritten.', 'تاني.']);
  const v = { colors: [], sizes: ['M'] };
  PD.aiApply(v, { colors: ['BE', 'BK'], sizes: ['L'] }, ['variations'], { type: 'Variable' });
  assert.deepEqual(plain([v.colors, v.sizes]), [['BE', 'BK'], ['M']]);
  assert.deepEqual(plain(PD.aiApply({ nameAr: 'موجود' }, { nameAr: 'تاني' }, ['nameAr'], {})), [], 'nothing replaced, nothing marked');
});

test('photoName (decision 10, «صور بس»): the product\'s data from the file name — names by script, a bare number is the price, n×n / units / S-M-L are sizes, kg or grams the weight, the table\'s names are colors, the crafts lexicon the material, labels win, copy counters drop, the same names share a key', () => {
  const colors = ['Beige', 'بيج', 'Black', 'أسود', 'Sage Green', 'أخضر زرعي'];
  const a = PD.photoName('Boho Cushion - مخدة بوهيمي - بيج - 45×45 - قطن - 350 (2).jpg', { colors });
  assert.deepEqual(plain(a), { nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 350, colors: ['بيج'], sizes: ['45×45'], material: 'قطن', style: '', weight: '', stock: null, unknown: [], key: 'boho cushion|مخدة بوهيمي' });
  assert.equal(PD.photoName('Boho Cushion - مخدة بوهيمي - بيج - 45×45 - قطن - 350.jpg', { colors }).key, a.key, 'the copy and the original are one product');
  // any order, other separators, Arabic digits, a labeled part, two colors, a weight in grams, a size word
  const b = PD.photoName('٣٥٠ ج.م | Black / Beige | Stripe Pillow_wool_XL_weight: 400g_style: Boho_مخدة مخططة_copy 3.png', { colors });
  assert.deepEqual(plain(b), { nameEn: 'Stripe Pillow', nameAr: 'مخدة مخططة', vendorPrice: 350, colors: ['Black', 'Beige'], sizes: ['XL'], material: 'wool', style: 'Boho', weight: '0.4', stock: null, unknown: [], key: 'stripe pillow|مخدة مخططة' });
  // only a name: the rest empty; an unknown word waits; a color not in the table is a word, not a color; a size with x; a hyphenated name stays whole
  const c = PD.photoName('Sage Green Vase - Teal - 20x30cm - handmade - أصيص سيج - 2.webp', { colors });
  assert.deepEqual(plain(c), { nameEn: 'Sage Green Vase', nameAr: 'أصيص سيج', vendorPrice: null, colors: [], sizes: ['20×30cm'], material: '', style: '', weight: '', stock: null, unknown: ['Teal', 'handmade'], key: 'sage green vase|أصيص سيج' });
  assert.deepEqual(plain(PD.photoName('T-shirt.jpg', { colors })), { nameEn: 'T-shirt', nameAr: '', vendorPrice: null, colors: [], sizes: [], material: '', style: '', weight: '', stock: null, unknown: [], key: 't-shirt|' });
  assert.deepEqual([PD.photoName('مج سيراميك - 120 - أسود - qty: 5 - price: 150.jpeg', { colors }).vendorPrice, PD.photoName('مج سيراميك - 120 - أسود - qty: 5 - price: 150.jpeg', { colors }).stock, PD.photoName('مج سيراميك - 120 - أسود.jpeg', { colors }).material, PD.photoName('مج - 120 - natural cotton.jpeg', { colors }).material, PD.photoName('مج سيراميك - 120 - أسود.jpeg', { colors }).nameAr], [150, 5, 'سيراميك', 'natural cotton', 'مج سيراميك'], 'a label wins over the bare number; a material word alone (or with a modifier) is the material; inside a name it sets the material and stays in the name');
  assert.equal(PD.photoName('IMG_2041.jpg', { colors }).key, 'img|', 'a camera name is a name of its own (one product a file)');
  // one phrase, the owner's way (1 Nov): the price («ب 1500ج» / «1500 جنيه»), the size («مقاسها 40x50») and a material word read out of it
  const d = PD.photoName('شنطة جلد عليا رسمة زهور ب 1500ج مقاسها 40x50.jpg', { colors });
  assert.deepEqual(plain(d), { nameEn: '', nameAr: 'شنطة جلد عليا رسمة زهور', vendorPrice: 1500, colors: [], sizes: ['40×50'], material: 'جلد', style: '', weight: '', stock: null, unknown: [], key: '|شنطة جلد عليا رسمة زهور' });
  const e = PD.photoName('Cotton tote bag 45x35cm 350 EGP.jpg', { colors });
  assert.deepEqual([e.nameEn, e.vendorPrice, e.sizes, e.material], ['Cotton tote bag', 350, ['45×35cm'], 'Cotton']);
});

test('slotPrompt (phase 5.4 decision 11): the page\'s prompt a slot is the server\'s word for word — the subject from the item, the brand, the color, the sizes on the proportions slot, the extras, a color slot; tags stripped', async () => {
  const { slotPrompt } = await import('../../supabase/functions/_shared/ai-images.js');
  const it = { nameEn: 'Kilim Pouf <b>x</b>', nameAr: 'بوف', material: 'Cotton', style: 'Boho', sizes: ['50×50', '60×60'], colors: ['BE'] };
  for (const slot of [0, 1, 2, 3, 4, 5, { color: 'BE' }]) for (const ctx of [{}, { brand: 'Art Craft' }, { brand: 'Art Craft', colorName: 'Beige' }]) assert.equal(PD.slotPrompt(it, slot, ctx), slotPrompt(it, slot, ctx), JSON.stringify([slot, ctx]));
  assert.equal(PD.slotPrompt({}, 0), slotPrompt({}, 0));
  assert.ok(PD.slotPrompt(it, 3, { brand: 'Art Craft' }).includes('(50×50, 60×60)') && !PD.slotPrompt(it, 3).includes('<b>'));
  assert.ok(PD.slotPrompt(it, { color: 'BE' }, { colorName: 'Beige' }).includes('Kilim Pouf x, in Beige, made of Cotton, Boho style'));
});

// B3 (the owner, 11 Nov — «الاقسام اختار منها … الرئيسي … - و -- و ---»): the categories filter lists the tree in order, a main category
// then its subs, each with its depth; a category whose parent is not in the list stands as a main one; a loop does not hang
test('catOptions (B3): the site\'s category tree in order — main, then its subs by name with their depth; the value is the path the records filter on', () => {
  const cats = [{ id: 20, name: 'Lighting', parentId: 10, path: 'Decor › Lighting' }, { id: 10, name: 'Decor', parentId: null, path: 'Decor' }, { id: 30, name: 'Lamps', parentId: 20, path: 'Decor › Lighting › Lamps' },
    { id: 11, name: 'Accessories', parentId: 10, path: 'Decor › Accessories' }, { id: 40, name: 'Kids', parentId: 0, path: 'Kids' }, { id: 50, name: 'Orphan', parentId: 999, path: 'Orphan' }];
  assert.deepEqual(plain(PD.catOptions(cats)), [['Decor', 'Decor', 0], ['Decor › Accessories', 'Accessories', 1], ['Decor › Lighting', 'Lighting', 1], ['Decor › Lighting › Lamps', 'Lamps', 2], ['Kids', 'Kids', 0], ['Orphan', 'Orphan', 0]]);
  assert.deepEqual(plain(PD.catOptions([{ id: 1, name: 'A', parentId: 2, path: 'B › A' }, { id: 2, name: 'B', parentId: 1, path: 'A › B' }])).length, 2); // a loop: each once
  assert.deepEqual(plain(PD.catOptions(null)), []);
});

// The assistant's category plan (the owner 15 Nov — 2026-11-15-assistant-categories.md): an outline reviewed in a popup, then created in
// order — a parent always before what is under it, and never a category the site already has under the same parent.
test('category plan: the outline made valid, each row\'s parent, the row\'s subtree', () => {
  const rows = PD.planOutline([{ level: 2, en: ' Home Decor ', ar: 'ديكور' }, { level: 2, en: 'Vases', ar: 'فازات' }, { level: 9, en: 'Glass', ar: 'زجاج' }, { level: 2, en: 'Candles', ar: '' }, null, { en: '', ar: ' ' }, { level: 1, en: 'Gifts', ar: 'هدايا' }]);
  assert.deepEqual(plain(rows), [{ level: 1, en: 'Home Decor', ar: 'ديكور' }, { level: 2, en: 'Vases', ar: 'فازات' }, { level: 3, en: 'Glass', ar: 'زجاج' }, { level: 2, en: 'Candles', ar: '' }, { level: 1, en: 'Gifts', ar: 'هدايا' }]);
  assert.deepEqual(plain(PD.planParents(rows)), [-1, 0, 1, 0, -1]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => PD.planEnd(rows, i)), [4, 3, 3, 4, 5]); // a row and everything under it
  assert.equal(PD.planOutline(Array.from({ length: 70 }, (_, i) => ({ level: 1, en: 'C' + i, ar: '' }))).length, PD.PLAN_MAX);
  assert.deepEqual(plain(PD.planOutline([{ level: 1, en: 'a', ar: '' }, { level: 2, en: 'b', ar: '' }, { level: 3, en: 'c', ar: '' }, { level: 4, en: 'd', ar: '' }, { level: 5, en: 'e', ar: '' }]).map((x) => x.level)), [1, 2, 3, 4, PD.PLAN_DEPTH]);
  assert.deepEqual(plain(PD.planOutline('x')), []);
});

test('category plan: what «نشر» does with each row — the parent\'s id on the site, a category already there used as it is, a name written twice', () => {
  const cats = [{ id: 10, name: 'Home Decor', parentId: null }, { id: 11, name: 'Candles', parentId: 10 }, { id: 12, name: 'Gifts', parentId: 10 }];
  const rows = [{ level: 1, en: 'home decor ' }, { level: 2, en: 'Vases' }, { level: 3, en: 'Glass' }, { level: 2, en: 'Candles' }, { level: 2, en: 'vases' }, { level: 1, en: 'Gifts' }];
  const view = (r) => plain(r.map((x) => [x.parent, x.parentId, x.existing, x.dup]));
  // «Home Decor» is on the site (10): used as it is, so «Vases» goes under 10 at once; «Glass» waits for «Vases»; «Candles» is there (11);
  // the second «vases» under the same parent is a duplicate; «Gifts» as a main category is new (the site's «Gifts» sits under 10)
  assert.deepEqual(view(PD.planResolve(rows, cats, 0)), [[-1, 0, 10, false], [0, 10, null, false], [1, null, null, false], [0, 10, 11, false], [0, 10, null, true], [-1, 0, null, false]]);
  // once «Vases» was made (the site answered 77) its child knows its parent, and the made row is never matched again
  rows[1].id = 77; assert.deepEqual(view(PD.planResolve(rows, cats.concat([{ id: 77, name: 'Vases', parentId: 10 }]), 0)).slice(1, 3), [[0, 10, null, false], [1, 77, null, false]]);
  // the whole plan under a category of the site: its top rows are that category's children
  assert.deepEqual(view(PD.planResolve([{ level: 1, en: 'Candles' }, { level: 2, en: 'Soy' }, { level: 1, en: 'Mirrors' }], cats, 10)), [[-1, 10, 11, false], [0, 11, null, false], [-1, 10, null, false]]);
  // an empty name matches nothing and is no duplicate (the popup asks for it)
  assert.deepEqual(view(PD.planResolve([{ level: 1, en: '' }, { level: 1, en: ' ' }], cats, 0)), [[-1, 0, null, false], [-1, 0, null, false]]);
});

// ---- the fake discount by tiers (the owner 15 Nov — docs/superpowers/plans/2026-11-15-fake-discount.md) ----
const OWNER = { tiers: [{ to: 1000, type: 'amount', value: 500 }, { to: 2000, type: 'amount', value: 1000 }, { to: null, type: 'amount', value: 1500 }] };
test('fakeRegular: the owner\'s example — up to 1000 adds 500, 1001–2000 adds 1000, above adds 1500', () => {
  assert.equal(PD.fakeRegular(1000, OWNER), 1500);
  assert.equal(PD.fakeRegular(10, OWNER), 510);
  assert.equal(PD.fakeRegular(1001, OWNER), 2001); assert.equal(PD.fakeRegular(2000, OWNER), 3000);
  assert.equal(PD.fakeRegular(2001, OWNER), 3501); assert.equal(PD.fakeRegular(250000, OWNER), 251500, '«فيما فوق»');
  assert.equal(PD.fakeRegular(0, OWNER), null); assert.equal(PD.fakeRegular('x', OWNER), null);
});
test('fakeRegular: a percent tier goes up to the next 10; a price above the last «لحد» with no «فيما فوق» has no tier', () => {
  const R = { tiers: [{ to: 500, type: 'percent', value: 25 }, { to: 1500, type: 'amount', value: 499 }] };
  assert.equal(PD.fakeRegular(330, R), 420, '330 × 1.25 = 412.5 → 420');
  assert.equal(PD.fakeRegular(400, R), 500, 'an exact product stays');
  assert.equal(PD.fakeRegular(1000, R), 1499, 'an amount is added as it is — no rounding');
  assert.equal(PD.fakeRegular(1501, R), null);
  assert.equal(PD.fakeTier(1501, R), null); assert.deepEqual(plain(PD.fakeTier(1500, R)), { to: 1500, type: 'amount', value: 499 });
});
test('fakeRule: sorted by «لحد», «فيما فوق» last and once, a repeated «لحد» keeps the first, bad tiers dropped, 20 at most; nothing valid → null', () => {
  assert.deepEqual(plain(PD.fakeRule({ tiers: [{ to: null, type: 'amount', value: 1500 }, { to: 2000, type: 'amount', value: 1000 }, { to: '1000', type: 'amount', value: '500' }, { to: 2000, type: 'percent', value: 9 }, { to: '', type: 'percent', value: 9 }] })), OWNER);
  assert.deepEqual(plain(PD.fakeRule([{ to: 100, value: 5 }])), { tiers: [{ to: 100, type: 'amount', value: 5 }] }, 'a bare list; the type defaults to an amount');
  for (const bad of [null, undefined, {}, { tiers: [] }, { tiers: 'x' }, { tiers: [null, 5, { to: 100, value: 0 }, { to: 100, value: -5 }, { to: -1, value: 5 }, { to: 'abc', value: 5 }, { to: 100, type: 'percent', value: 501 }, { to: 100, value: 1000001 }] }]) assert.equal(PD.fakeRule(bad), null);
  const many = PD.fakeRule({ tiers: Array.from({ length: 30 }, (_, i) => ({ to: (i + 1) * 100, value: 10 })).concat([{ to: null, value: 99 }]) });
  assert.equal(many.tiers.length, PD.FAKE_MAX); assert.equal(many.tiers[PD.FAKE_MAX - 1].to, null, '«فيما فوق» is kept when the list is cut');
  assert.deepEqual(plain(PD.fakeRule(PD.fakeRule(OWNER))), OWNER, 'a clean rule stays as it is');
});
test('fakeLines: «من» is the tier before + 1 (the first from 0)', () => {
  assert.deepEqual(plain(PD.fakeLines(OWNER)), [{ from: 0, to: 1000, type: 'amount', value: 500 }, { from: 1001, to: 2000, type: 'amount', value: 1000 }, { from: 2001, to: null, type: 'amount', value: 1500 }]);
  assert.deepEqual(plain(PD.fakeLines(null)), []);
});
test('priceFromVendor with the rule: «قبل الخصم» from the sale price\'s tier; no tier for it (or no rule) → the old sale + markup %', () => {
  assert.deepEqual(plain(PD.priceFromVendor(600, { rate: 40, markup: 30, fake: OWNER })), { sale: 1000, regular: 1500, markup: 30, vendorNet: 600, tiered: true });
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, markup: 22, fake: OWNER })), { sale: 1670, regular: 2670, markup: 22, vendorNet: 1002, tiered: true });
  const capped = { tiers: [{ to: 1000, type: 'amount', value: 500 }] };
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, markup: 22, fake: capped })), { sale: 1670, regular: 2040, markup: 22, vendorNet: 1002 }, 'above the last tier: 22%');
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, markup: 22, fake: null })), { sale: 1670, regular: 2040, markup: 22, vendorNet: 1002 });
  assert.deepEqual(plain(PD.priceFromVendor(1000, { rate: 40, markup: 22, fake: { tiers: [] } })), { sale: 1670, regular: 2040, markup: 22, vendorNet: 1002 });
  assert.equal(typeof PD.priceFromVendor(600, { rate: 40, fake: OWNER }).markup, 'number', 'a markup is still drawn: it is what a later rule change falls back to');
});

// comments decision 82 (the owner 15 Nov on «تعديل سعر منتج») with his 17 Nov rules: a change of Ibtekr's rate is the maker's commission —
// the whole maker when all his products are picked; else the category the records are filtered on, or the deepest one the picked share
// (some of its products picked is enough — the others' prices follow); none shared = only the price
test('decision 82 + owner 17 Nov — rateScopes: all his products = the whole maker (filter or not); else the filtered category, or the deepest shared one, some picked is enough; the rest of his products in it are «affected»', () => {
  const parent = new Map([[10, null], [11, 10], [12, 10], [20, null]]); const parentOf = (id) => (parent.has(Number(id)) ? parent.get(Number(id)) : null);
  const all = [
    { id: 1, vendorId: 'A', categoryIds: [10, 11] }, { id: 2, vendorId: 'A', categoryIds: [10, 11] }, { id: 3, vendorId: 'A', categoryIds: [10, 12] }, { id: 4, vendorId: 'A', categoryIds: [20] }, { id: 5, vendorId: 'A', categoryIds: [20] },
    { id: 6, vendorId: 'B', categoryIds: [20] }, { id: 7, vendorId: 'B', categoryIds: [10] }, { id: 8, vendorId: null, categoryIds: [10] }];
  const pick = (ids) => all.filter((p) => ids.includes(p.id));
  // the whole of A, and one of B's two (its category moves, the other one in it — none — follows)
  assert.deepEqual(plain(PD.rateScopes(pick([1, 2, 3, 4, 5, 6]), all, parentOf)), [{ vendorId: 'A', picked: 5, total: 5, whole: true, cats: [], rest: 0, affected: [] }, { vendorId: 'B', picked: 1, total: 2, whole: false, cats: [20], rest: 0, affected: [6] }]);
  // A's three under 10 in two sub-categories: 10 is what they share
  assert.deepEqual(plain(PD.rateScopes(pick([1, 2, 3]), all, parentOf)), [{ vendorId: 'A', picked: 3, total: 5, whole: false, cats: [10], rest: 0, affected: [1, 2, 3] }]);
  // one of the two in 11: 11 (the deepest) moves anyway, and product 2 — not picked — follows
  assert.deepEqual(plain(PD.rateScopes(pick([1]), all, parentOf)), [{ vendorId: 'A', picked: 1, total: 5, whole: false, cats: [11], rest: 0, affected: [1, 2] }]);
  // picked ones with no category in common: the price alone
  assert.deepEqual(plain(PD.rateScopes(pick([1, 4]), all, parentOf)), [{ vendorId: 'A', picked: 2, total: 5, whole: false, cats: [], rest: 2, affected: [] }]);
  // filtered on 10, one picked: 10 moves and every product of A under it follows
  assert.deepEqual(plain(PD.rateScopes(pick([3]), all, parentOf, { focus: [10] })), [{ vendorId: 'A', picked: 1, total: 5, whole: false, cats: [10], rest: 0, affected: [1, 2, 3] }]);
  // a filter, but all of B picked: his whole commission
  assert.deepEqual(plain(PD.rateScopes(pick([6, 7]), all, parentOf, { focus: [10] }))[0].whole, true);
  // a product without a maker is nobody's
  assert.deepEqual(plain(PD.rateScopes(pick([8]), all, parentOf)), []);
});
// his live case — cushions in «Best seller › Textiles › Cushions» and «Textiles › CUSHIONS › Wool cushions», and an Arabic-only record
// whose Arabic terms map to the English ones (0121): «لو موجود انجليزي بس او عربي بس يتغير عادي»
test('owner 17 Nov — rateScopes: an Arabic-only product counts in its English categories; the deepest shared ones tie across two branches; a filter picks its own', () => {
  const parent = new Map([[4117, null], [4123, 4117], [4125, 4123], [3672, null], [53, 3672], [5311, 53], [99, null]]);
  const parentOf = (id) => (parent.has(Number(id)) ? parent.get(Number(id)) : null);
  const AR = new Map([[4118, 4117], [4124, 4123], [4126, 4125], [3678, 3672], [177, 53], [5312, 5311]]);
  const toEn = (id) => (parent.has(Number(id)) ? Number(id) : AR.has(Number(id)) ? AR.get(Number(id)) : null);
  const EN = [4117, 4123, 4125, 3672, 53, 5311]; const ARC = [4118, 4124, 177, 4126, 3678, 5312];
  const all = [{ id: 1, vendorId: 'R', categoryIds: EN }, { id: 2, vendorId: 'R', categoryIds: EN }, { id: 3, vendorId: 'R', categoryIds: ARC }, { id: 4, vendorId: 'R', categoryIds: [99] }];
  const pick = (ids) => all.filter((p) => ids.includes(p.id));
  // no filter: the two deepest shared — «Cushions» (4125) and «Wool cushions» (5311); the Arabic-only one is in both, the Arabic ids never show
  assert.deepEqual(plain(PD.rateScopes(pick([1, 3]), all, parentOf, { toEn })), [{ vendorId: 'R', picked: 2, total: 4, whole: false, cats: [4125, 5311], rest: 0, affected: [1, 2, 3] }]);
  // filtered on «Textiles › CUSHIONS» (53): that one alone — not «Best seller» nor «Cushions»
  assert.deepEqual(plain(PD.rateScopes(pick([1]), all, parentOf, { toEn, focus: [53] })), [{ vendorId: 'R', picked: 1, total: 4, whole: false, cats: [53], rest: 0, affected: [1, 2, 3] }]);
  // a focus given by its Arabic id maps to the English one
  assert.deepEqual(plain(PD.rateScopes(pick([3]), all, parentOf, { toEn, focus: [177] }))[0].cats, [53]);
  // an unknown category is never a scope
  assert.deepEqual(plain(PD.rateScopes([{ id: 9, vendorId: 'Z', categoryIds: [777] }, { id: 10, vendorId: 'Z', categoryIds: [777] }].slice(0, 1), [{ id: 9, vendorId: 'Z', categoryIds: [777] }, { id: 10, vendorId: 'Z', categoryIds: [777] }], parentOf, { toEn }))[0].cats, []);
});
test('decision 82 — ratePlan: the whole maker moves his general rate and each category rate of his; a category moves from what it pays today (its own, its parent\'s, else the general) and the maker turns «حسب القسم»; past 65 is flagged', () => {
  const parent = new Map([[10, null], [11, 10], [12, 10], [20, null]]); const parentOf = (id) => (parent.has(Number(id)) ? parent.get(Number(id)) : null);
  const up2 = { mode: 'value', dir: 1, amount: 2 }; const pct10 = { mode: 'pct', dir: -1, amount: 10 };
  const fixed = { rate: 30, rateFlat: 5, commissionType: 'fixed', categoryRates: [] };
  const byCat = { rate: 30, rateFlat: null, commissionType: 'category_based', categoryRates: [{ wooCategoryId: 10, rate: 25, flat: 3 }, { wooCategoryId: 11, rate: 20, flat: null }] };
  // the whole maker, fixed: the general rate only, the type as it is
  assert.deepEqual(plain(PD.ratePlan({ whole: true, cats: [] }, fixed, up2, parentOf)), { input: { type: 'fixed', rate: 32, flat: 5, categories: [] }, lines: [{ kind: 'general', id: null, from: 30, to: 32 }], over: false, changed: true });
  // a «ثابت» maker's old category rows are not what he pays: they stay out of it
  assert.deepEqual(plain(PD.ratePlan({ whole: true, cats: [] }, Object.assign({}, fixed, { categoryRates: [{ wooCategoryId: 10, rate: 25, flat: null }] }), up2, parentOf).input), { type: 'fixed', rate: 32, flat: 5, categories: [] });
  // the whole maker, by category: the general rate and both category rates by the same step
  const w = PD.ratePlan({ whole: true, cats: [] }, byCat, up2, parentOf);
  assert.deepEqual(plain(w.input), { type: 'category_based', rate: 32, flat: null, categories: [{ id: 10, rate: 27, flat: 3 }, { id: 11, rate: 22, flat: null }] });
  assert.deepEqual(plain(w.lines.map((l) => [l.kind, l.id, l.from, l.to])), [['general', null, 30, 32], ['category', 10, 25, 27], ['category', 11, 20, 22]]);
  // a category on a fixed maker: from the general rate, the maker becomes «حسب القسم», the general stays
  assert.deepEqual(plain(PD.ratePlan({ whole: false, cats: [20] }, fixed, up2, parentOf)), { input: { type: 'category_based', rate: 30, flat: 5, categories: [{ id: 20, rate: 32, flat: null }] }, lines: [{ kind: 'category', id: 20, from: 30, to: 32 }], over: false, changed: true });
  // a parent category with a rate: itself and the sub-category that has its own; 12 (no rate of its own) follows the parent by itself
  const c = PD.ratePlan({ whole: false, cats: [10] }, byCat, pct10, parentOf);
  assert.deepEqual(plain(c.input), { type: 'category_based', rate: 30, flat: null, categories: [{ id: 10, rate: 22.5, flat: 3 }, { id: 11, rate: 18, flat: null }] });
  // a sub-category without a rate of its own starts from its parent's
  assert.deepEqual(plain(PD.ratePlan({ whole: false, cats: [12] }, byCat, up2, parentOf).lines), [{ kind: 'category', id: 12, from: 25, to: 27 }]);
  // nothing to write: no general rate to start from, or no category covered
  assert.equal(PD.ratePlan({ whole: true, cats: [] }, { rate: null, categoryRates: [] }, up2, parentOf), null);
  assert.equal(PD.ratePlan({ whole: false, cats: [] }, fixed, up2, parentOf), null);
  // past 65 the write is not sent
  assert.equal(PD.ratePlan({ whole: true, cats: [] }, { rate: 60, commissionType: 'fixed', categoryRates: [] }, { mode: 'value', dir: 1, amount: 10 }, parentOf).over, true);
  // the same step as a product's own price: shiftRate
  assert.equal(PD.shiftRate(33, { mode: 'pct', dir: 1, amount: 10 }), 36.3);
  assert.equal(PD.shiftRate(33, { mode: 'value', dir: -1, amount: 40 }), 0);
  assert.equal(PD.bulkPrice({ vendorPrice: 1000, rate: 33, disc: 20 }, { target: 'rate', mode: 'pct', dir: 1, amount: 10 }).rate, 36.3);
});
