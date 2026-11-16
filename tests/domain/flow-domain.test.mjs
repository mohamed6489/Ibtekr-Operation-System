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

// comments decision 36 («نسخة الفيندور تبقي بسيطة … الصورة المرجعية و الاسم انجليزي و عربي و اللون و المقاس و سعر المبتكر»)
test('the maker\'s copy: seven columns — #, the reference photo, the two names, the colour, the size, his price — read from the right, and read back as a ready sheet', () => {
  const rows = [
    Object.assign(F.blankRow(), { n: '1-2', sku: 'IBTART-0999-RD', nameEn: 'Vase', nameAr: 'فازة', colorEn: 'Red', colorAr: 'أحمر', size: '40 cm', sizeAr: '40 سم', vendorPrice: 250, sale: 400, catEn: 'Decor', shortEn: 'a vase' }),
    Object.assign(F.blankRow(), { nameEn: 'Lamp', colorEn: 'Blue', size: 'M', vendorPrice: null }), // English only → the one column still filled; no price → an empty cell
    Object.assign(F.blankRow(), { nameAr: 'طبق', vendorPrice: 0 }),
  ];
  const s = F.makerSheetOf({ rows });
  assert.deepEqual(plain(s.head), ['#', 'الصورة المرجعية', 'الاسم بالإنجليزي', 'الاسم بالعربي', 'اللون', 'المقاس', 'سعر المبتكر']);
  assert.deepEqual(plain(s.head), plain(F.MAKER_HEAD));
  assert.deepEqual(plain(s.rows), [['1-2', '', 'Vase', 'فازة', 'أحمر', '40 سم', 250], [2, '', 'Lamp', '', 'Blue', 'M', ''], [3, '', '', 'طبق', '', '', '']]);
  assert.equal(s.refCol, 1); assert.equal(s.rtl, true); assert.equal(s.widths.length, 7);
  // nothing of the system's copy: no SKU, no category, no description, no sale price
  assert.ok(!JSON.stringify(s.rows).includes('IBTART') && !JSON.stringify(s.rows).includes('Decor') && !JSON.stringify(s.rows).includes('400'));
  // the file: the sheet opens right-to-left, the photo drawn in column B, the price a number
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const files = unzip(F.xlsx({ ...s, freeze: 'C2', images: [{ row: 0, col: s.refCol, bytes: png, ext: 'png', w: 105, h: 120 }] }));
  const td = (n) => new TextDecoder().decode(files[n]);
  assert.match(td('xl/worksheets/sheet1.xml'), /<sheetView rightToLeft="1" workbookViewId="0">/);
  assert.match(td('xl/worksheets/sheet1.xml'), /<c r="G2" s="2"><v>250<\/v><\/c>/);
  assert.match(td('xl/drawings/drawing1.xml'), /<xdr:col>1<\/xdr:col>.*<xdr:row>1<\/xdr:row>/s);
  assert.match(td('xl/styles.xml'), /FF005642/);
  assert.doesNotMatch(new TextDecoder().decode(unzip(F.xlsx({ ...F.sheetOf({ type: 'Simple', rows }), freeze: 'C2' }))['xl/worksheets/sheet1.xml']), /rightToLeft/); // the system's copy as it was
  // the maker returns it: every column is read (the photo column and # are not data) — a «شيت جاهز» batch starts from it
  const back = F.readSheet([s.head].concat(s.rows.map((r) => r.map((c, k) => (k === 6 && c === '' ? 300 : c)))));
  assert.deepEqual(plain(back.map), { nameEn: 2, nameAr: 3, colorAr: 4, sizeAr: 5, vendorPrice: 6 });
  assert.deepEqual(plain(back.unknown), []);
  assert.deepEqual(back.rows.map((r) => [r.nameEn, r.nameAr, r.colorAr, r.sizeAr, r.vendorPrice]), [['Vase', 'فازة', 'أحمر', '40 سم', 250], ['Lamp', '', 'Blue', 'M', 300], ['', 'طبق', '', '', 300]]);
  assert.equal(F.sizeEnOf('40 سم'), '40 cm'); // the English size is written from the Arabic one when the batch opens
  // the two copies' file names
  assert.equal(F.sheetFileName('Art Craft', new Date(2026, 10, 16), 'نسخة المبتكر'), 'Art Craft - نسخة المبتكر - 2026-11-16.xlsx');
  assert.equal(F.sheetFileName('Art Craft', new Date(2026, 10, 16), 'a/b'), 'Art Craft - a-b - 2026-11-16.xlsx');
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

// ---------------------------------------------------------------- comments decisions 39–41 (a ready sheet's photos)
// a picture as pixels: fn(u, v) → [r, g, b] over the unit square, drawn inside `box` of a w × h raster (white around it)
const raster = (w, h, fn, box) => {
  const b = box || { x: 0, y: 0, w, h }; const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const c = fn((x - b.x + 0.5) / b.w, (y - b.y + 0.5) / b.h); const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
  return px;
};
const W = [255, 255, 255];
const disc = (col) => (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.2 ? (v < 0.35 && Math.abs(u - 0.5) < 0.12 ? [40, 60, 80] : col) : W);
const tray = (u, v) => (v > 0.28 && v < 0.72 && u > 0.05 && u < 0.95 ? (u < 0.3 ? [240, 200, 20] : [30, 110, 140]) : W);
const tree = (u, v) => (Math.abs(u - 0.5) < v * 0.45 && v > 0.06 ? (v > 0.6 && Math.abs(u - 0.5) < 0.08 ? [140, 70, 170] : [40, 170, 95]) : W);
// the photo a maker has (the product in the middle of a white square) and the small copy in his sheet's cell (the photo between white bars)
const photo = (fn) => F.photoSig(raster(64, 64, fn, { x: 8, y: 8, w: 48, h: 48 }), 64, 64, 1);
const inSheet = (fn) => F.photoSig(raster(64, 64, fn, { x: 6, y: 10, w: 52, h: 44 }), 64, 64, 210 / 240);

test('photoSig / sigDistance: a photo and its small copy between white bars are the same picture; another shape, or the same shape in another colour, is not', () => {
  const red = disc([200, 50, 40]); const blue = disc([40, 90, 200]);
  assert.match(photo(red), /^[0-9a-f]{256}$/); // 100 greys + 27 colours + the shape, two hex digits each
  assert.equal(photo(red), photo(red));
  for (const fn of [red, tray, tree]) assert.ok(F.sigDistance(photo(fn), inSheet(fn)) < 0.15, 'the same picture: ' + F.sigDistance(photo(fn), inSheet(fn)));
  assert.ok(F.sigDistance(photo(red), inSheet(tray)) > F.SIG_MAX && F.sigDistance(photo(tree), inSheet(tray)) > F.SIG_MAX && F.sigDistance(photo(tree), inSheet(red)) > F.SIG_MAX);
  assert.ok(F.sigDistance(photo(blue), inSheet(red)) > F.SIG_MAX, 'the same vase in another colour is another product: ' + F.sigDistance(photo(blue), inSheet(red)));
  assert.equal(F.sigDistance(photo(red), photo(red)), 0);
  // nothing to read
  assert.equal(F.photoSig(null, 64, 64, 1), ''); assert.equal(F.photoSig(new Uint8ClampedArray(16), 2, 2, 1), '');
  assert.equal(F.sigDistance('', photo(red)), Infinity); assert.equal(F.sigDistance('zz', 'zz'), Infinity);
  // a picture with a background of its own is read whole (no border to cut), still itself
  const scene = (u, v) => ((u - 0.4) ** 2 + (v - 0.55) ** 2 < 0.07 ? [250, 250, 250] : [140 + Math.round(60 * u), 110 + Math.round(60 * v), 100]);
  assert.ok(F.sigDistance(F.photoSig(raster(64, 64, scene), 64, 64, 1.5), F.photoSig(raster(64, 64, scene, { x: 0, y: 12, w: 64, h: 40 }), 64, 64, 210 / 240)) < F.SIG_MAX);
});

test('matchPhotos: each photo to the row whose picture it looks like — closest first, a row and a photo once; a stranger stays loose', () => {
  const red = disc([200, 50, 40]); const stripes = (u, v) => (Math.floor(u * 8) % 2 === 0 && v > 0.08 && v < 0.92 ? [230, 126, 34] : W);
  const refs = [{ row: 1, sig: inSheet(red) }, { row: 2, sig: inSheet(tray) }, { row: 3, sig: inSheet(tree) }];
  const photos = [{ i: 0, sig: photo(tree) }, { i: 1, sig: photo(stripes) }, { i: 2, sig: photo(red) }, { i: 3, sig: photo(tray) }];
  const m = F.matchPhotos(refs, photos);
  assert.deepEqual(m.pairs.map((x) => [x.i, x.row]), [[2, 1], [3, 2], [0, 3]]);
  assert.deepEqual(plain(m.loose), [1]);
  // the same picture on two rows (a Variable sheet): the first row takes the photo, a second copy of the photo takes the next
  const twice = [{ row: 4, sig: inSheet(red) }, { row: 5, sig: inSheet(red) }];
  assert.deepEqual(F.matchPhotos(twice, [{ i: 0, sig: photo(red) }]).pairs.map((x) => [x.i, x.row]), [[0, 4]]);
  assert.deepEqual(F.matchPhotos(twice, [{ i: 0, sig: photo(red) }, { i: 1, sig: photo(red) }]).pairs.map((x) => [x.i, x.row]), [[0, 4], [1, 5]]);
  // nothing to match to, or a photo that could not be read
  assert.deepEqual(plain(F.matchPhotos([], photos)), { pairs: [], loose: [0, 1, 2, 3] });
  assert.deepEqual(plain(F.matchPhotos(refs, [{ i: 0, sig: '' }])), { pairs: [], loose: [0] });
  assert.deepEqual(plain(F.matchPhotos(refs, [{ i: 0, sig: photo(red) }], 0)).loose, [0]); // a limit of 0 takes only the very same pixels
});

test('photoGaps (decision 41): a product with no photo on any of its rows is missing; photos on a row the sheet does not have are extra', () => {
  const rows = [{ src: 1, group: 'a' }, { src: 2, group: 'a' }, { src: 3, group: 'b' }, { src: 4, group: 'c' }, { src: 5 }];
  assert.deepEqual(plain(F.photoGaps(rows, { 2: ['p2'], 4: ['p4'], 7: ['x'], 9: [] })), { missing: [3, 5], extra: [7] }); // the variations of «a» share row 2's photo
  assert.deepEqual(plain(F.photoGaps(rows, {})), { missing: [1, 3, 4, 5], extra: [] });
  assert.deepEqual(plain(F.photoGaps(rows, { 1: ['a'], 3: ['b'], 4: ['c'], 5: ['d'] })), { missing: [], extra: [] });
  assert.deepEqual(plain(F.photoGaps([], { 1: ['a'] })), { missing: [], extra: [1] });
  assert.deepEqual(plain(F.photoGaps(null, null)), { missing: [], extra: [] });
});

test('the pictures inside a workbook (decision 40): a drawing\'s cell and a «Place in cell» picture are found by their sheet lines; readSheet keeps each row\'s line', async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]); const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9]);
  // our own writer: an empty line between the head and the rows would shift a plain count — the lines come from the sheet
  const sh = F.makerSheetOf({ rows: [{ n: 1, nameEn: 'Vase', vendorPrice: 100 }, { n: 2, nameEn: 'Tray', vendorPrice: 200 }, { n: 3, nameEn: 'Tree', vendorPrice: 300 }] });
  const bytes = F.xlsx({ ...sh, freeze: 'C2', images: [{ row: 0, col: sh.refCol, bytes: png, ext: 'png', w: 10, h: 10 }, { row: 2, col: sh.refCol, bytes: jpg, ext: 'jpeg', w: 10, h: 10 }] });
  const pics = await PD.xlsxPhotos(bytes);
  assert.deepEqual(pics.map((p) => [p.line, p.col, p.ext, p.bytes.length]), [[2, 1, 'png', 8], [4, 1, 'jpeg', 5]]);
  const cells = await PD.parseXlsx(bytes); assert.deepEqual(plain(cells.lines), [1, 2, 3, 4]);
  assert.deepEqual(F.readSheet(cells).rows.map((r) => [r.nameEn, r.line]), [['Vase', 2], ['Tray', 3], ['Tree', 4]]);
  assert.deepEqual(F.readSheet([['Name EN', 'Vendor Price'], [], ['Lamp', 5]]).rows.map((r) => r.line), [3]); // a csv: the row's place among the lines
  // a sheet with a gap: row 5 of the file is the second product
  const NS = 'http://schemas.openxmlformats.org/';
  const sheet = '<?xml version="1.0"?><worksheet xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>Name EN</t></is></c><c r="B1" t="inlineStr"><is><t>photo</t></is></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>Lamp</t></is></c><c r="B3" t="e" vm="1"><v>#VALUE!</v></c></row>'
    + '<row r="5"><c r="A5" t="inlineStr"><is><t>Mug</t></is></c><c r="B5" t="e" vm="2"><v>#VALUE!</v></c></row></sheetData></worksheet>';
  const rich = PD.zip([
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/metadata.xml', data: '<metadata><futureMetadata name="XLRICHVALUE" count="2"><bk/><bk/></futureMetadata><valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata></metadata>' },
    { name: 'xl/richData/rdrichvalue.xml', data: '<rvData count="2"><rv s="0"><v>1</v><v>5</v></rv><rv s="0"><v>0</v><v>5</v></rv></rvData>' },
    { name: 'xl/richData/richValueRel.xml', data: '<richValueRels xmlns:r="' + NS + 'officeDocument/2006/relationships"><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>' },
    { name: 'xl/richData/_rels/richValueRel.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x" Target="../media/image1.png"/><Relationship Id="rId2" Type="x" Target="../media/image2.jpeg"/></Relationships>' },
    { name: 'xl/media/image1.png', data: png }, { name: 'xl/media/image2.jpeg', data: jpg }, { name: 'xl/media/vector1.emf', data: png }]);
  // the first cell's value is rich value 0 → relation 1 → image2.jpeg; the second → relation 0 → image1.png
  assert.deepEqual((await PD.xlsxPhotos(rich)).map((p) => [p.line, p.col, p.name]), [[3, 1, 'xl/media/image2.jpeg'], [5, 1, 'xl/media/image1.png']]);
  assert.deepEqual(F.readSheet(await PD.parseXlsx(rich)).rows.map((r) => [r.nameEn, r.line]), [['Lamp', 3], ['Mug', 5]]);
  // not a workbook, or one with no pictures
  assert.deepEqual(await PD.xlsxPhotos(new Uint8Array([1, 2, 3])), []);
  assert.deepEqual(await PD.xlsxPhotos(F.xlsx({ ...sh, freeze: 'C2' })), []);
});
