import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// IBShare's pure half (the owner 15 Nov, 2026-11-15-comments.md decision 10): the file's name, who it goes to, the message, the
// sheet's rows and the PDF's bytes. The popup and the drawing are in the browser tests (tests/e2e/comments-2.spec.mjs).
const win = {};
vm.runInContext(readFileSync(new URL('../../app/js/pages/share.js', import.meta.url), 'utf8'), vm.createContext({ window: win, TextEncoder, console }));
const P = win.IBShare.pure;
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm's realm

test('the file\'s name: no path or reserved characters, one space between words, never empty', () => {
  assert.equal(P.fileBase('تقرير مختصر — Art/Craft: "A"  <1>?'), 'تقرير مختصر — Art Craft A 1');
  assert.equal(P.fileBase('  '), 'تقرير');
  assert.equal(P.fileBase(null), 'تقرير');
  assert.equal(P.fileBase('x'.repeat(200)).length, 80);
});

test('the WhatsApp number: an Egyptian mobile in any writing → 20…; nothing usable → empty (WhatsApp asks whom)', () => {
  assert.equal(P.waNumber('01012345678'), '201012345678');
  assert.equal(P.waNumber('+20 101 234 5678'), '201012345678');
  assert.equal(P.waNumber('0020 1012345678'), '201012345678');
  assert.equal(P.waNumber('٠١٠١٢٣٤٥٦٧٨'), '201012345678');
  assert.equal(P.waNumber(''), ''); assert.equal(P.waNumber(null), ''); assert.equal(P.waNumber('—'), '');
});

test('the message: the title, the line under it and the numbers — the table stays in the file', () => {
  const spec = { title: 'تقرير مختصر — Art Craft', sub: '3 أوردر', summary: [{ label: 'رصيد Dokan', value: '1,200 ج.م' }, { label: 'صافي الرصيد', value: { text: '900 ج.م' } }, null], headers: ['a'], rows: [['سر']] };
  assert.equal(P.messageText(spec), 'تقرير مختصر — Art Craft\n3 أوردر\nرصيد Dokan: 1,200 ج.م\nصافي الرصيد: 900 ج.م');
  assert.equal(P.messageText({ title: 'منتج', link: 'https://shop.test/p/1' }), 'منتج\nhttps://shop.test/p/1');
  assert.equal(P.messageText(null), '');
});

test('where it opens: wa.me with the number (or none) and the text; mailto with the address, the subject and the body', () => {
  assert.equal(P.shareHref('whatsapp', { phone: '01012345678', text: 'أهلا & 1' }), 'https://wa.me/201012345678?text=' + encodeURIComponent('أهلا & 1'));
  assert.equal(P.shareHref('whatsapp', { text: 'x' }), 'https://wa.me/?text=x');
  assert.equal(P.shareHref('email', { email: 'a.b@shop.test', title: 'تقرير', text: 'سطر\nسطر' }), 'mailto:a.b@shop.test?subject=' + encodeURIComponent('تقرير') + '&body=' + encodeURIComponent('سطر\nسطر'));
  assert.equal(P.shareHref('email', { email: 'a@b.c?bcc=x@y.z', title: '', text: '' }).startsWith('mailto:a@b.c%3Fbcc%3Dx@y.z?subject='), true); // an address cannot add headers
});

test('the sheet: the photo column first when the table has photos; a cell that starts like a formula is neutralised; the total and the numbers under the table', () => {
  const spec = { headers: ['المنتج', 'رقم الأوردر', 'القيمة'], rows: [[{ text: 'Lamp', img: 'https://shop.test/a.webp' }, '#1001', 250], [{ text: '=HYPERLINK("x")', img: '' }, '-5', '+2']],
    total: ['الإجمالي', '2 أوردر', '252'], summary: [{ label: 'صافي الرصيد', value: '900 ج.م' }] };
  const s = plain(P.sheetOf(spec));
  assert.deepEqual(s.head, ['الصورة', 'المنتج', 'رقم الأوردر', 'القيمة']);
  assert.deepEqual(s.rows, [['', 'Lamp', '#1001', 250], ['', "'=HYPERLINK(\"x\")", "'-5", "'+2"], ['', 'الإجمالي', '2 أوردر', '252'], [], ['', 'صافي الرصيد', '900 ج.م']]);
  assert.deepEqual([s.images, s.dataRows, s.withImg, s.widths.length, s.widths[0]], [['https://shop.test/a.webp', ''], 2, true, 4, 10]);
  // a cell's own number goes to the sheet as a number (the text is what the screen shows)
  const n = plain(P.sheetOf({ headers: ['المنتج', 'القيمة'], rows: [['Lamp', { text: '1,002.00', n: 1002 }], ['Vase', { text: '—', n: NaN }]], total: ['الإجمالي', { text: '1,002.00', n: 1002 }], summary: [{ label: 'الصافي', value: { text: '900.00 ج.م', n: 900 } }] }));
  assert.deepEqual(n.rows, [['Lamp', 1002], ['Vase', '—'], ['الإجمالي', 1002], [], ['الصافي', 900]]);
  // a photo that is not https is no photo; a table without photo cells has no photo column
  assert.equal(P.cellImg({ text: 'x', img: 'javascript:alert(1)' }), '');
  // a picture the page already holds (the studio's reference photo — comments decision 37) is taken as a data: URL: JPEG / PNG / WebP only
  assert.equal(P.cellImg({ text: '1', img: 'data:image/jpeg;base64,AAAA' }), 'data:image/jpeg;base64,AAAA');
  assert.equal(P.cellImg({ text: '1', img: 'data:image/svg+xml;base64,AAAA' }), '');
  assert.equal(P.cellImg({ text: '1', img: 'data:text/html;base64,AAAA' }), '');
  assert.equal(P.cellImg({ text: '1', img: 'http://shop.test/a.png' }), '');
  const t = plain(P.sheetOf({ headers: ['أ', 'ب'], rows: [['1', '2']] }));
  assert.deepEqual([t.head, t.rows, t.withImg, t.images], [['أ', 'ب'], [['1', '2']], false, []]);
  assert.deepEqual(plain(P.sheetOf({})).rows, []);
});

test('the PDF: a page a picture, every object where the table at the end says it is, the pictures untouched', () => {
  const jpeg = (n, fill) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0].concat(new Array(n).fill(fill), [0xff, 0xd9]));
  const pages = [{ jpeg: jpeg(40, 7), w: 1588, h: 2246 }, { jpeg: jpeg(25, 9), w: 1588, h: 1000 }, { jpeg: new Uint8Array(0), w: 10, h: 10 }, null];
  const out = new Uint8Array(P.pdfBytes(pages)); const text = Buffer.from(out).toString('latin1');
  assert.equal(text.startsWith('%PDF-1.4\n'), true); assert.equal(text.endsWith('%%EOF\n'), true);
  assert.equal(/\/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\]/.test(text), true, 'two pages — the empty picture and the null are left out');
  // the cross-reference table: 9 entries (0 + catalog + pages + 2 × (page, image, content)), each offset at its own «n 0 obj»
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 9), 'xref\n0 9\n');
  const offs = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(offs.length, 8);
  offs.forEach((o, i) => assert.equal(text.slice(o, o + String(i + 1).length + 7), (i + 1) + ' 0 obj\n', 'object ' + (i + 1)));
  assert.equal(/\/Size 9 \/Root 1 0 R/.test(text), true);
  // each picture whole, with its real length and size
  for (const p of pages.slice(0, 2)) {
    const head = '/Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n';
    const at = text.indexOf(head); assert.notEqual(at, -1);
    assert.deepEqual([...out.slice(at + head.length, at + head.length + p.jpeg.length)], [...p.jpeg]);
    assert.equal(text.slice(at + head.length + p.jpeg.length, at + head.length + p.jpeg.length + 10), '\nendstream');
  }
  // the first picture fills the A4 page; the shorter one sits at the top across the width
  assert.equal(text.includes('q 595.28 0 0 841.89 0.00 0.00 cm /Im0 Do Q') || /q 595\.2\d 0 0 841\.89 0\.0\d 0\.00 cm \/Im0 Do Q/.test(text), true);
  assert.equal(/q 595\.28 0 0 374\.86 0\.00 467\.03 cm \/Im0 Do Q/.test(text), true);
  assert.equal(new Uint8Array(P.pdfBytes([])).length > 0, true); // no page: still a well-formed (empty) file
});
