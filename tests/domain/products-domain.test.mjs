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
  assert.deepEqual(plain(items[0]), { row: 2, nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', vendorPrice: 1000, colors: ['Beige', 'Black'], sizes: ['50×50', '40×40'], material: 'قطن', style: '', weight: '0.4', stock: 5, shortDesc: '' });
  assert.deepEqual(PD.itemIssues(items[0], 'Variable'), []);
  assert.deepEqual(PD.itemIssues(items[1], 'Variable'), ['الاسم (EN)', 'سعر المبتكر', 'المتغيرات']);
  assert.deepEqual(PD.itemIssues(items[1], 'Simple'), ['الاسم (EN)', 'سعر المبتكر']);
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
