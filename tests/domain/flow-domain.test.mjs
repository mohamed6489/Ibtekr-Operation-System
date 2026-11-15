import { test } from 'node:test'; import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { loadUmd } from '../helpers/load-umd.mjs';
// The product studio's three flows (docs/superpowers/plans/2026-11-14-studio-flows.md): the owner's template (his BIAN / Glastora
// sheets), a maker's sheet read onto it, the photos by row, the SKU, the grouping, the prices, the site's file names and the .xlsx.
const PD = loadUmd(new URL('../../app/js/pages/products-domain.js', import.meta.url));
globalThis.IbtekrProducts = PD;
const F = loadUmd(new URL('../../app/js/pages/flow-domain.js', import.meta.url));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the template: the owner\'s two sheets\' headers as they are, the reference image in column H, image6 at the end', () => {
  assert.equal(F.HEAD_SIMPLE.length, F.FIELDS.length);
  assert.equal(F.HEAD_VARIABLE.length, F.FIELDS.length);
  assert.equal(F.HEAD_SIMPLE[7], 'refrance image');
  assert.equal(F.HEAD_VARIABLE[7], 'Image for review');
  assert.equal(F.colName(F.FIELDS.indexOf('ref')), 'H');
  assert.equal(F.colName(F.FIELDS.indexOf('img1')), 'W');
  assert.deepEqual(F.HEAD_SIMPLE.slice(-6), ['image1', 'image2', 'image3', 'image4', 'image5', 'image6']);
  assert.equal(F.TEMPLATE.Simple.sheet, 'Products'); assert.equal(F.TEMPLATE.Variable.sheet, 'Form');
});

test('readSheet: the template\'s own headers map field by field; a maker\'s Arabic / loose headers too; numbers read with separators', () => {
  const r = F.readSheet([F.HEAD_VARIABLE, ['5', 'IBTGLS1004-ME', 'Fiberglass Wall Light Set 2 pcs', 'إضاءة حائط فايبر جلاس', 'Marble Effect', 'تأثير رخامي', '20 cm set', '', 'طقم مقاس 20 سم', 'Modern', 'حديث',
    'Fiberglass', 'فايبر جلاس', '', '1,441', '2620', '2220', 'glasstora', 'LIGHTING > Wall Lamp', 'الإضاءة > إضاءة حائط', 'desc', 'وصف', 'https://x/1.webp']]);
  assert.equal(r.rows.length, 1);
  const x = r.rows[0];
  assert.equal(x.sku, 'IBTGLS1004-ME'); assert.equal(x.nameEn, 'Fiberglass Wall Light Set 2 pcs'); assert.equal(x.nameAr, 'إضاءة حائط فايبر جلاس');
  assert.equal(x.colorEn, 'Marble Effect'); assert.equal(x.size, '20 cm set'); assert.equal(x.sizeAr, 'طقم مقاس 20 سم');
  assert.equal(x.vendorPrice, 1441); assert.equal(x.regular, 2620); assert.equal(x.sale, 2220); assert.equal(x.catEn, 'LIGHTING > Wall Lamp'); assert.equal(x.catAr, 'الإضاءة > إضاءة حائط');
  const m = F.readSheet([['اسم المنتج', 'السعر', 'اللون', 'المقاس', 'ملاحظات'], ['فازة', '٥٢٠', 'أزرق', '25 سم', 'x'], ['', '', '', '', '']]);
  assert.equal(m.rows.length, 1); assert.equal(m.rows[0].nameAr, 'فازة'); assert.equal(m.rows[0].vendorPrice, 520); assert.equal(m.rows[0].colorAr, 'أزرق'); assert.equal(m.rows[0].sizeAr, '25 سم');
  assert.deepEqual(m.unknown, ['ملاحظات']);
});

test('photos by row (decision 3): «1» / «01» / «1-2» / «1_2» / «1 (2)»; the first of a row is its reference; anything else unmatched', () => {
  assert.deepEqual(plain(F.photoIndex('1.jpg')), { row: 1, order: 0 });
  assert.deepEqual(plain(F.photoIndex('01.PNG')), { row: 1, order: 0 });
  assert.deepEqual(plain(F.photoIndex('3-2.webp')), { row: 3, order: 2 });
  assert.deepEqual(plain(F.photoIndex('3_1.jpeg')), { row: 3, order: 1 });
  assert.deepEqual(plain(F.photoIndex('4 (2).jpg')), { row: 4, order: 2 });
  assert.equal(F.photoIndex('vase.jpg'), null); assert.equal(F.photoIndex('0.jpg'), null);
  const a = F.assignPhotos(['2.jpg', '1-2.jpg', '1-1.jpg', 'x.png', '3.jpg']);
  assert.deepEqual(plain(a.byRow), { 1: ['1-1.jpg', '1-2.jpg'], 2: ['2.jpg'], 3: ['3.jpg'] });
  assert.deepEqual(a.unmatched, ['x.png']);
});

test('the owner 15 Nov («مبتترفعش» · «لو متسميين صح يترتبوا بحسب التسمية»): a photo without a number takes the next free row, one a row, in its name\'s order — none is dropped', () => {
  // a maker's photos: no number at all → rows 1, 2, 3 in their names' order (case aside), not the order picked
  assert.deepEqual(plain(F.placePhotos(['IMG_2041.jpg', 'WhatsApp Image 2026-11-14.jpeg', 'vase.png'])),
    [{ i: 0, row: 1, order: 0, auto: true }, { i: 2, row: 2, order: 0, auto: true }, { i: 1, row: 3, order: 0, auto: true }]);
  // the numbers inside a name count as numbers: IMG_9 before IMG_10, whatever the order picked
  assert.deepEqual(plain(F.placePhotos(['IMG_10.jpg', 'IMG_9.jpg', 'img_11.jpg'])).map((x) => [x.i, x.row]), [[1, 1], [0, 2], [2, 3]]);
  assert.deepEqual(['shot 10.png', 'Shot 2.png', 'shot 1.png'].sort(F.nameOrder), ['shot 1.png', 'Shot 2.png', 'shot 10.png']);
  // the numbered ones keep their rows; the loose ones take the free rows (never a numbered one), then go after
  assert.deepEqual(plain(F.placePhotos(['2.jpg', 'x.jpg', '1-2.jpg', 'y.jpg', '4.jpg'])),
    [{ i: 2, row: 1, order: 2, auto: false }, { i: 0, row: 2, order: 0, auto: false }, { i: 1, row: 3, order: 0, auto: true },
      { i: 4, row: 4, order: 0, auto: false }, { i: 3, row: 5, order: 0, auto: true }]);
  // rows that already have photos (a second pick) are skipped by the loose ones
  assert.deepEqual(plain(F.placePhotos(['a.jpg', 'b.jpg'], ['1', '2', '4'])), [{ i: 0, row: 3, order: 0, auto: true }, { i: 1, row: 5, order: 0, auto: true }]);
  assert.deepEqual(plain(F.placePhotos([], [])), []);
});

test('the SKU (decision 5): IBT + brand code + 4-digit serial + «-color» + «-size»; the brand code from the brand\'s letters', () => {
  assert.equal(F.brandCode3('glasstora'), 'GLS');
  assert.equal(F.brandCode3('bian'), 'BNI');
  assert.equal(F.brandCode3('Art Craft'), 'ART');
  assert.equal(F.brandCode3('x'), '');
  assert.equal(F.skuOf({ code: 'GLS', serial: 1020, color: 'OW' }), 'IBTGLS1020-OW');
  assert.equal(F.skuOf({ code: 'GLS', serial: 1119, color: 'GR', size: '(S)' }), 'IBTGLS1119-GR-S');
  assert.equal(F.skuOf({ code: 'GLS', serial: 999 }), 'IBTGLS0999');
  assert.equal(F.skuOf({ code: 'GLS', serial: 1200, size: '40 × 60 cm' }), 'IBTGLS1200-40X60');
  assert.equal(F.skuOf({ code: 'g', serial: 1 }), null);
  assert.equal(F.sizeCode('Small'), 'S'); assert.equal(F.sizeCode('كبير'), 'L'); assert.equal(F.sizeCode('H 26 × W 50 × D 33 cm'), '26X50X33');
  assert.equal(F.skuBase('IBTGLS1020-OW'), 'IBTGLS1020'); assert.equal(F.skuBase('IBTGLS1119-GR-S'), 'IBTGLS1119'); assert.equal(F.skuBase('BIAN-CHD-059'), 'BIAN-CHD-059');
  assert.ok(F.validSku('IBTGLS1020-OW')); assert.ok(!F.validSku('bad sku')); assert.ok(!F.validSku(''));
});

test('grouping: a Variable batch groups by the base SKU (or the name without «(S)»); one row alone = Simple; a Simple batch = a product a row', () => {
  const rows = [{ sku: 'IBTGLS1004-ME' }, { sku: 'IBTGLS1020-OW' }, { sku: 'IBTGLS1020-TE' }, { nameEn: 'Vase (S)' }, { nameEn: 'Vase (L)' }];
  const g = F.groupRows(rows, 'Variable');
  assert.deepEqual(g.map((x) => [x.rows, x.type]), [[[0], 'Simple'], [[1, 2], 'Variable'], [[3, 4], 'Variable']]);
  assert.deepEqual(F.groupRows(rows, 'Simple').map((x) => x.rows), [[0], [1], [2], [3], [4]]);
});

test('the site\'s file names (the owner: «اه صح كده»): «<name EN without (…)>-<SKU without the size>-NN.webp», and the link under uploads/<year>/<month>', () => {
  assert.equal(F.fileName('Olive Wood 6-Light Chandelier', 'BIAN-CHD-059', 1), 'Olive-Wood-6-Light-Chandelier-BIAN-CHD-059-01.webp');
  assert.equal(F.fileName('Fiberglass Wall Light A203 (15 cm)', 'IBTGLS1010-OW', 4), 'Fiberglass-Wall-Light-A203-IBTGLS1010-OW-04.webp');
  assert.equal(F.imageSku('IBTGLS1119-GR-S', '(S)'), 'IBTGLS1119-GR');
  assert.equal(F.imageSku('IBTGLS1020-OW', ''), 'IBTGLS1020-OW');
  assert.equal(F.siteUrl('a.webp', new Date(2026, 9, 3)), 'https://ibtekr.club/wp-content/uploads/2026/10/a.webp');
});

test('prices (decision 7): the studio\'s rule — sale = ceil10((vendor + fee) ÷ (1 − rate)), regular = sale + the markup; nothing without a price', () => {
  assert.deepEqual(plain(F.pricesOf(1441, { rate: 35, fee: 0, markup: 18 })), { sale: 2220, regular: 2620, markup: 18 });
  assert.equal(F.pricesOf(null, { rate: 35 }), null);
  assert.equal(F.pricesOf(100, { rate: 100 }), null);
});

test('rowIssues: both names, the maker\'s and the sale prices, the category and a valid SKU', () => {
  assert.deepEqual(F.rowIssues({}), ['الاسم EN', 'الاسم AR', 'سعر المبتكر', 'سعر البيع', 'القسم', 'SKU']);
  assert.deepEqual(F.rowIssues({ nameEn: 'a', nameAr: 'ب', vendorPrice: 1, sale: 2, catEn: 'X', sku: 'IBTGLS1000' }), []);
});

test('sheetOf: the rows in the template\'s order with the images as links; the Variable sheet ends with =IMAGE() previews', () => {
  const r = Object.assign(F.blankRow(), { sku: 'IBTGLS1020-OW', nameEn: 'Lamp', vendorPrice: 878, sale: 1360, images: ['https://ibtekr.club/a-01.webp', 'https://ibtekr.club/a-02.webp'] });
  const s = F.sheetOf({ type: 'Variable', rows: [r] });
  assert.equal(s.sheet, 'Form'); assert.equal(s.head.length, F.FIELDS.length + 5);
  const row = s.rows[0];
  assert.equal(row[0], 1); assert.equal(row[1], 'IBTGLS1020-OW'); assert.equal(row[7], ''); assert.equal(row[14], 878);
  assert.equal(row[F.FIELDS.indexOf('img1')], 'https://ibtekr.club/a-01.webp');
  assert.deepEqual(row[F.FIELDS.length], { f: 'IMAGE(W2)' }); assert.equal(row[F.FIELDS.length + 2], '');
  const simple = F.sheetOf({ type: 'Simple', rows: [r] }); assert.equal(simple.head.length, F.FIELDS.length); assert.equal(simple.sheet, 'Products');
});

test('blankSheetRows (case 3): Simple = a row per product; Variable = product × color slots × size slots (5 at most each)', () => {
  assert.equal(F.blankSheetRows({ type: 'Simple', products: 3 }).length, 3);
  const v = F.blankSheetRows({ type: 'Variable', products: 2, kinds: { sizes: 3, colors: 2 } });
  assert.equal(v.length, 12);
  assert.deepEqual([v[0].product, v[0].variant, v[0].colorSlot, v[0].sizeSlot], [0, 1, 1, 1]);
  assert.deepEqual([v[5].colorSlot, v[5].sizeSlot, v[6].product], [2, 3, 1]);
  assert.equal(F.blankSheetRows({ type: 'Variable', products: 1, kinds: { sizes: 9 } }).length, 5);
});

// a store-only ZIP reader for the test (products-domain's zip writes stored entries)
function unzip(buf) {
  const out = {}; let i = 0;
  while (i + 30 <= buf.length && buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 3 && buf[i + 3] === 4) {
    const method = buf[i + 8] | (buf[i + 9] << 8); const size = buf[i + 18] | (buf[i + 19] << 8) | (buf[i + 20] << 16) | (buf[i + 21] << 24);
    const nl = buf[i + 26] | (buf[i + 27] << 8); const xl = buf[i + 28] | (buf[i + 29] << 8);
    const name = new TextDecoder().decode(buf.slice(i + 30, i + 30 + nl)); const data = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + size);
    out[name] = method === 8 ? inflateRawSync(data) : data; i += 30 + nl + xl + size;
  }
  return out;
}
test('the .xlsx: a styled green head, frozen at C2, prices #,##0, the reference image drawn in its cell (OneCellAnchor on column H)', () => {
  const r = Object.assign(F.blankRow(), { sku: 'BIAN-CHD-059', nameEn: 'Olive & Wood <6>', vendorPrice: 9000, sale: 13850 });
  const s = F.sheetOf({ type: 'Simple', rows: [r] });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const bytes = F.xlsx({ ...s, freeze: 'C2', images: [{ row: 0, col: s.refCol, bytes: png, ext: 'png', w: 105, h: 120 }] });
  const files = unzip(bytes);
  const td = (n) => new TextDecoder().decode(files[n]);
  assert.ok(files['xl/media/image1.png']);
  assert.match(td('xl/worksheets/sheet1.xml'), /<pane xSplit="2" ySplit="1" topLeftCell="C2"/);
  assert.match(td('xl/worksheets/sheet1.xml'), /Olive &amp; Wood &lt;6&gt;/);
  assert.match(td('xl/worksheets/sheet1.xml'), /<c r="O2" s="2"><v>9000<\/v><\/c>/);
  assert.match(td('xl/worksheets/sheet1.xml'), /<drawing r:id="rId1"\/>/);
  assert.match(td('xl/drawings/drawing1.xml'), /<xdr:col>7<\/xdr:col>.*<xdr:row>1<\/xdr:row>/s);
  assert.match(td('xl/styles.xml'), /FF2E7D32/);
  assert.match(td('[Content_Types].xml'), /Extension="png"/);
  assert.equal(F.sheetFileName('Glas/stora', new Date(2026, 10, 14)), 'Glas-stora - 2026-11-14.xlsx');
});

// the owner 15 Nov (the data step: Arabic and English side by side, «لو غير اي حاجة في العربي تتغير اوتوماتيك في الانجليزي»)
test('the data step: material / style pairs found by either language; an Arabic size written in English', () => {
  assert.deepEqual(plain(F.pairOf(F.MATERIALS, '', 'راتان')), ['Rattan', 'راتان']);
  assert.deepEqual(plain(F.pairOf(F.MATERIALS, 'boucle', '')), ['Bouclé', 'بوكليه'], 'accents and case aside');
  assert.deepEqual(plain(F.pairOf(F.STYLES, 'Boho', 'شيء تاني')), ['Boho', 'بوهيمي']);
  assert.equal(F.pairOf(F.STYLES, 'Space Age', ''), null);
  assert.equal(F.pairOf(F.STYLES, '', ''), null);
  for (const list of [F.MATERIALS, F.STYLES]) {
    assert.equal(new Set(list.map(([e]) => F.norm(e))).size, list.length, 'no English twice');
    assert.equal(new Set(list.map(([, a]) => F.norm(a))).size, list.length, 'no Arabic twice');
  }
  assert.equal(F.sizeEnOf('عرض ١٢٠ × طول ٧٠ × عمق ٥٠ سم'), 'W 120 × L 70 × D 50 cm');
  assert.equal(F.sizeEnOf('40x40 سم'), '40 × 40 cm');
  assert.equal(F.sizeEnOf('قطر 30 سم'), 'Ø 30 cm');
  assert.equal(F.sizeEnOf('XL'), 'XL', 'a letter size is no multiplication');
  assert.equal(F.sizeEnOf('مقاس كبير'), 'L');
  assert.equal(F.sizeEnOf('٢ كيلو'), '2 kg');
  assert.equal(F.sizeEnOf('حجم عائلي'), '', 'Arabic words left → nothing (the English stays)');
  assert.equal(F.sizeEnOf(''), '');
});
