/* The product studio's three flows (docs/superpowers/plans/2026-11-14-studio-flows.md) — pure functions (UMD), no DOM.
   The owner's template (his two sheets, 14 Nov): one row per product (Simple) or per variation (Variable, no parent row — the
   variations of a product share the base SKU), Arabic in the same row, the images as links named «<name EN>-<SKU>-NN.webp».
   Reads a maker's sheet onto the template, numbers the photos by row («1», «1-2»), builds the SKU (IBT + brand code + serial +
   «-color» + «-size»), prices (the studio's rule), the site's file names and the sheet's rows, and writes the .xlsx with the
   reference image inside its cell (OneCellAnchor, like the owner's BIAN sheet) — the ZIP writer is products-domain.js's. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.IbtekrProducts || (typeof require === 'function' ? require('./products-domain.js') : null));
  else root.IbtekrFlow = factory(root.IbtekrProducts);
})(typeof self !== 'undefined' ? self : this, function (PD) {
  'use strict';

  // ---------------------------------------------------------------- the template (decision: the owner's two sheets as they are)
  // field keys, in the sheet's order (the reference image sits in column H, between Size and Size AR, like both sheets)
  const FIELDS = ['n', 'sku', 'nameEn', 'nameAr', 'colorEn', 'colorAr', 'size', 'ref', 'sizeAr', 'styleEn', 'styleAr', 'materialEn', 'materialAr', 'weight',
    'vendorPrice', 'regular', 'sale', 'brand', 'catEn', 'catAr', 'shortEn', 'shortAr', 'img1', 'img2', 'img3', 'img4', 'img5', 'img6'];
  const HEAD_SIMPLE = ['#', 'SKU', 'Product Name EN', 'Product Name AR', 'Product Colors', 'Product Colors AR', 'Size', 'refrance image', 'Size AR', 'Product Style', 'Product Style AR',
    'Product Material', 'Product Material AR', 'Product Weight per KG', 'Vendor Price', 'Regular Price', 'Sale Price', 'Brand Name', 'Product Category', 'Product Category AR',
    'Short Description EN', 'Short Description AR', 'image1', 'image2', 'image3', 'image4', 'image5', 'image6'];
  const HEAD_VARIABLE = ['#', 'SKU', 'Product Name EN', 'Product Name AR', 'Product Colors', 'Product Colors AR', 'size', 'Image for review', 'size ar', 'Product Style', 'Product Style AR',
    'Product Material', 'Product Material AR', 'Product Weight per KG', 'Vendor Price', 'Regular price', 'sale price', 'Brand Name', 'Product Category', 'Product Category AR',
    'Short Description EN', 'Short Description AR', 'image1', 'image2', 'image3', 'image4', 'Image 5', 'image6'];
  const PREVIEWS = ['preview 1', 'preview 2', 'preview 3', 'preview 4', 'preview 5'];
  const WIDTHS = [5, 16, 30, 26, 14, 13, 20, 17, 20, 15, 13, 22, 22, 11, 12, 12, 12, 12, 26, 20, 44, 44, 34, 28, 26, 26, 26, 26];
  const TEMPLATE = {
    Simple: { sheet: 'Products', head: HEAD_SIMPLE, fill: 'FF2E7D32', previews: false },
    Variable: { sheet: 'Form', head: HEAD_VARIABLE, fill: 'FF34A853', previews: true },
  };
  const LABELS = { sku: 'SKU', nameEn: 'الاسم EN', nameAr: 'الاسم AR', colorEn: 'اللون', colorAr: 'اللون AR', size: 'المقاس', sizeAr: 'المقاس AR', styleEn: 'الستايل', styleAr: 'الستايل AR',
    materialEn: 'الخامة', materialAr: 'الخامة AR', weight: 'الوزن (كجم)', vendorPrice: 'سعر المبتكر', regular: 'قبل الخصم', sale: 'سعر البيع', brand: 'البراند', catEn: 'القسم', catAr: 'القسم AR',
    shortEn: 'الوصف EN', shortAr: 'الوصف AR' };
  const NUMERIC = ['weight', 'vendorPrice', 'regular', 'sale'];

  // ---------------------------------------------------------------- reading a maker's sheet onto the template
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKC').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, '');
  // every header both sheets use, plus the names a maker's own sheet tends to have (first match wins, in this order)
  const SYNONYMS = {
    sku: ['sku', 'كود', 'الكود', 'كودالمنتج'],
    nameEn: ['productnameen', 'nameen', 'englishname', 'productname', 'name', 'الاسمبالانجليزي', 'الاسمانجليزي', 'اسمالمنتجانجليزي'],
    nameAr: ['productnamear', 'namear', 'arabicname', 'productname_ar', 'الاسم', 'اسمالمنتج', 'الاسمبالعربي', 'الاسمعربي', 'المنتج'],
    colorEn: ['productcolors', 'productcolor', 'colors', 'color', 'colour'],
    colorAr: ['productcolorsar', 'colorsar', 'colorar', 'اللون', 'الالوان', 'لون'],
    size: ['size', 'sizes', 'dimensions'],
    sizeAr: ['sizear', 'المقاس', 'المقاسات', 'مقاس', 'الابعاد'],
    styleEn: ['productstyle', 'style'], styleAr: ['productstylear', 'stylear', 'الستايل', 'الطراز'],
    materialEn: ['productmaterial', 'material', 'materials'], materialAr: ['productmaterialar', 'materialar', 'الخامه', 'الخامات', 'خامه'],
    weight: ['productweightperkg', 'weight', 'weightkg', 'الوزن', 'وزن'],
    vendorPrice: ['vendorprice', 'makerprice', 'cost', 'سعرالمبتكر', 'سعرالمورد', 'سعرالفيندور', 'سعرالجمله', 'التكلفه', 'price', 'السعر', 'سعر'],
    regular: ['regularprice', 'regular', 'قبلالخصم', 'السعرقبلالخصم'],
    sale: ['saleprice', 'sale', 'سعرالبيع'],
    brand: ['brandname', 'brand', 'البراند', 'الماركه'],
    catEn: ['productcategory', 'category', 'categories'], catAr: ['productcategoryar', 'categoryar', 'القسم', 'الاقسام', 'الفئه', 'التصنيف'],
    shortEn: ['shortdescriptionen', 'descriptionen', 'description', 'shortdescription'], shortAr: ['shortdescriptionar', 'descriptionar', 'الوصف', 'وصف'],
  };
  /** headers → { field: column index } (the first header that matches a field takes it; a header is used once). */
  function mapHeaders(headers) {
    const H = (Array.isArray(headers) ? headers : []).map(norm);
    const used = new Set(); const map = {};
    Object.keys(SYNONYMS).forEach((f) => {
      for (const syn of SYNONYMS[f]) { const i = H.findIndex((x, k) => !used.has(k) && x === norm(syn)); if (i >= 0) { map[f] = i; used.add(i); return; } }
    });
    return map;
  }
  const num = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[,،\s]/g, '').replace(/ج\.?م|egp|le/gi, '');
    const n = Number(s); return Number.isFinite(n) ? n : null;
  };
  const text = (v, max) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; };
  /** a sheet as rows of cells (the first row its headers) → { rows: [template row], map, unknown: [header] } — rows with no name and no price are skipped. */
  function readSheet(cells) {
    const all = (Array.isArray(cells) ? cells : []).filter((r) => Array.isArray(r) && r.some((c) => String(c == null ? '' : c).trim() !== ''));
    if (!all.length) return { rows: [], map: {}, unknown: [] };
    const head = all[0]; const map = mapHeaders(head);
    const taken = new Set(Object.values(map));
    const unknown = head.map((x, i) => (taken.has(i) || !String(x == null ? '' : x).trim() || /^#$|^preview|image|refrance|reference/i.test(String(x)) ? null : String(x).trim())).filter(Boolean);
    const rows = all.slice(1).map((r) => {
      const o = blankRow();
      Object.keys(map).forEach((f) => { const v = r[map[f]]; if (NUMERIC.includes(f)) o[f] = num(v); else o[f] = text(v, f.startsWith('short') ? 2000 : 200); });
      return o;
    }).filter((o) => o.nameEn || o.nameAr || o.vendorPrice != null);
    return { rows, map, unknown };
  }
  function blankRow() { const o = {}; FIELDS.forEach((f) => { o[f] = NUMERIC.includes(f) ? null : ''; }); return o; }

  // ---------------------------------------------------------------- the photos, by row (decision 3: «1», «2» … or «1-1», «1-2» …)
  /** a file name → { row: 1-based, order } | null («1.jpg», «01.png», «1-2.webp», «1_2», «1 (2)»). */
  function photoIndex(name) {
    const base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    const m = /^0*(\d{1,4})(?:\s*[-_ ]\s*0*(\d{1,3})|\s*\(\s*(\d{1,3})\s*\))?$/.exec(base);
    if (!m) return null;
    const row = Number(m[1]); const order = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0;
    return row >= 1 ? { row, order } : null;
  }
  /** names → { byRow: { 1: [names in order] }, unmatched: [names] } — the first name of a row is its reference photo. */
  function assignPhotos(names) {
    const byRow = {}; const unmatched = [];
    (Array.isArray(names) ? names : []).forEach((n) => { const p = photoIndex(n); if (!p) { unmatched.push(n); return; } (byRow[p.row] = byRow[p.row] || []).push({ n, o: p.order }); });
    Object.keys(byRow).forEach((k) => { byRow[k] = byRow[k].sort((a, b) => a.o - b.o || String(a.n).localeCompare(String(b.n))).map((x) => x.n); });
    return { byRow, unmatched };
  }

  // ---------------------------------------------------------------- the SKU (decision 5: the Glastora sheet's shape)
  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
  /** the brand's code: its first letter + the consonants after it, to 3 («glasstora» → GLS), filled from its other letters when short (bian → BNI). */
  function brandCode3(name) {
    const L = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').split('');
    if (L.length < 2) return '';
    const out = [L[0]]; const used = new Set([0]);
    for (let i = 1; i < L.length && out.length < 3; i++) if (!VOWELS.has(L[i]) && L[i] !== out[out.length - 1]) { out.push(L[i]); used.add(i); }
    for (let i = 1; i < L.length && out.length < 3; i++) if (!used.has(i)) { out.push(L[i]); used.add(i); }
    return out.join('');
  }
  const validCode = (c) => /^[A-Z]{2,4}$/.test(String(c || ''));
  const LETTER_SIZE = /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL)$/i;
  /** a size's code for the SKU: a letter size as it is (S / M / XL — also from «(S)» or «Small»), else its numbers joined with X (at most 3). */
  function sizeCode(size) {
    const s = String(size == null ? '' : size).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).trim();
    const word = s.replace(/[()]/g, '').trim();
    if (LETTER_SIZE.test(word)) return word.toUpperCase();
    const w = { small: 'S', medium: 'M', large: 'L', صغير: 'S', وسط: 'M', متوسط: 'M', كبير: 'L' }[word.toLowerCase()];
    if (w) return w;
    const nums = s.match(/\d+(?:\.\d+)?/g) || [];
    return nums.slice(0, 3).map((x) => x.replace('.', '')).join('X');
  }
  const pad4 = (n) => String(n).padStart(4, '0');
  /** { code, serial, color?, size? } → 'IBT' + code + serial + «-color» + «-size» | null. */
  function skuOf(o) {
    const x = o || {};
    if (!validCode(x.code) || !Number.isInteger(x.serial) || x.serial < 0) return null;
    const c = x.color ? String(x.color).toUpperCase() : ''; if (c && !/^[A-Z0-9]{1,4}$/.test(c)) return null;
    const z = x.size ? sizeCode(x.size) : ''; if (x.size && !z) return null;
    return 'IBT' + x.code + pad4(x.serial) + (c ? '-' + c : '') + (z ? '-' + z : '');
  }
  const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,48}$/;
  const validSku = (s) => SKU_RE.test(String(s || ''));
  /** a variation's SKU → its product's («IBTGLS1020-OW» → «IBTGLS1020»; a SKU with no serial part stays as it is). */
  function skuBase(sku) { const s = String(sku || '').trim(); const m = /^(.*?\d{3,})(?:-[A-Za-z0-9]+)*$/.exec(s); return m ? m[1] : s; }
  /** the name a product's variations share: «Fiberglass Pendant Light A102 (S)» → «Fiberglass Pendant Light A102». */
  const baseName = (name) => text(name).replace(/\s*\([^)]*\)\s*$/, '').trim();

  // ---------------------------------------------------------------- grouping (decision: the variations share the base SKU; one row alone = Simple)
  /** rows + the batch type → [{ key, rows: [index], type: 'Simple' | 'Variable' }] in first-seen order. */
  function groupRows(rows, type) {
    const L = Array.isArray(rows) ? rows : [];
    if (type !== 'Variable') return L.map((r, i) => ({ key: 'r' + i, rows: [i], type: 'Simple' }));
    const groups = []; const at = new Map();
    L.forEach((r, i) => {
      const k = r.sku ? 's:' + skuBase(r.sku).toUpperCase() : 'n:' + norm(baseName(r.nameEn || r.nameAr));
      if (!at.has(k)) { at.set(k, groups.length); groups.push({ key: k, rows: [] }); }
      groups[at.get(k)].rows.push(i);
    });
    return groups.map((g) => ({ ...g, type: g.rows.length > 1 ? 'Variable' : 'Simple' }));
  }

  // ---------------------------------------------------------------- the site's file names and links (the owner: «اه صح كده»)
  const slugName = (name) => baseName(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Product';
  /** the SKU the images carry: a variation's without its size (the sizes of one color share their photos). */
  function imageSku(sku, size) { const s = String(sku || ''); const z = size ? sizeCode(size) : ''; return z && s.toUpperCase().endsWith('-' + z.toUpperCase()) ? s.slice(0, -(z.length + 1)) : s; }
  const pad2 = (n) => String(n).padStart(2, '0');
  /** «<name EN>-<SKU>-NN.webp» (NN from 1). */
  const fileName = (nameEn, sku, n, ext) => slugName(nameEn) + '-' + String(sku || '').replace(/[^A-Za-z0-9-]+/g, '') + '-' + pad2(n) + '.' + (ext || 'webp');
  /** the link the file gets on the site, before it is uploaded (the year and month of `when`). */
  function siteUrl(file, when, host) {
    const d = when instanceof Date ? when : new Date();
    return (host || 'https://ibtekr.club') + '/wp-content/uploads/' + d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + file;
  }

  // ---------------------------------------------------------------- prices (decision 7 = the studio's rule, phase 5 decision 16)
  /** a row's prices from the maker's price: { sale, regular } (null when the price or the rate is missing). The markup kept per row. */
  function pricesOf(vendor, o) {
    const p = PD.priceFromVendor(vendor, { rate: o && o.rate, fee: o && o.fee, markup: o && o.markup });
    return p ? { sale: p.sale, regular: p.regular, markup: p.markup } : null;
  }

  // ---------------------------------------------------------------- what a row lacks before it can go up
  /** a row → the labels of the fields it still needs (the name in both languages, the prices, the category, the SKU). */
  function rowIssues(r) {
    const out = [];
    if (!r || !text(r.nameEn)) out.push('الاسم EN');
    if (!r || !text(r.nameAr)) out.push('الاسم AR');
    if (!r || !(Number(r.vendorPrice) > 0)) out.push('سعر المبتكر');
    if (!r || !(Number(r.sale) > 0)) out.push('سعر البيع');
    if (!r || !text(r.catEn)) out.push('القسم');
    if (!r || !validSku(r.sku)) out.push('SKU');
    return out;
  }

  // ---------------------------------------------------------------- the sheet (decision 10: the template with the images as links)
  /**
   * The template's rows for a batch: { type, rows: [template row + images: [url…]] } → { sheet, head, widths, fill, rows: [[cell…]] }.
   * A cell is a string, a number or { f } (a formula); the reference column is empty (the picture goes in the cell's drawing).
   * The Variable sheet ends with the five «preview» columns (=IMAGE(Wn)…) like the owner's Glastora sheet.
   */
  function sheetOf(batch) {
    const t = TEMPLATE[batch && batch.type === 'Variable' ? 'Variable' : 'Simple'];
    const head = t.head.concat(t.previews ? PREVIEWS : []);
    const rows = (batch && Array.isArray(batch.rows) ? batch.rows : []).map((r, i) => {
      const imgs = Array.isArray(r.images) ? r.images : [];
      const cells = FIELDS.map((f, k) => {
        if (f === 'n') return i + 1;
        if (f === 'ref') return '';
        if (/^img\d$/.test(f)) return imgs[Number(f.slice(3)) - 1] || '';
        const v = r[f]; return v == null ? '' : NUMERIC.includes(f) ? (Number.isFinite(Number(v)) && v !== '' ? Number(v) : '') : String(v);
      });
      if (t.previews) PREVIEWS.forEach((_, k) => { const col = colName(FIELDS.indexOf('img' + (k + 1))); cells.push(imgs[k] ? { f: 'IMAGE(' + col + (i + 2) + ')' } : ''); });
      return cells;
    });
    return { sheet: t.sheet, head, widths: WIDTHS.concat(t.previews ? PREVIEWS.map(() => 13) : []), fill: t.fill, refCol: FIELDS.indexOf('ref'), rows };
  }

  // ---------------------------------------------------------------- the photos → a sheet for the maker (case 3, decision 12)
  /**
   * { type, kinds: { sizes: n, colors: n } (0–5 each), photos: [name…] (one per product, in order) } → template rows to fill:
   * Simple = a row per product; Variable = a row per product × color slot × size slot, the slots numbered in «#» («1-2») so the
   * maker sees which variant he fills. The prices and the sizes stay empty for the maker.
   */
  function blankSheetRows(o) {
    const x = o || {}; const n = Math.max(0, Math.min(500, Number(x.products) || 0));
    const sizes = x.type === 'Variable' ? Math.max(0, Math.min(5, Number(x.kinds && x.kinds.sizes) || 0)) : 0;
    const colors = x.type === 'Variable' ? Math.max(0, Math.min(5, Number(x.kinds && x.kinds.colors) || 0)) : 0;
    const out = [];
    for (let p = 0; p < n; p++) {
      const cs = Math.max(1, colors); const ss = Math.max(1, sizes); let v = 0;
      for (let c = 0; c < cs; c++) for (let s = 0; s < ss; s++) { v += 1; out.push(Object.assign(blankRow(), { product: p, variant: cs * ss > 1 ? v : 0, colorSlot: colors ? c + 1 : 0, sizeSlot: sizes ? s + 1 : 0 })); }
    }
    return out;
  }

  // ---------------------------------------------------------------- the .xlsx (styled head, frozen columns, a picture in a cell)
  const xesc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  function colName(i) { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  const EMU = 9525; // per pixel
  /**
   * { sheet, head, widths, fill, rows, freeze: 'C2', rowHeight, images: [{ row (0-based data row), col, bytes, ext: 'jpeg'|'png', w, h }] }
   * → the files of the .xlsx (feed PD.zip). Strings inline, numbers as numbers (prices #,##0), formulas as formulas.
   */
  function xlsxParts(o) {
    const NS = 'http://schemas.openxmlformats.org/';
    const head = o.head || []; const rows = o.rows || []; const imgs = (o.images || []).filter((im) => im && im.bytes && im.bytes.length);
    const rh = o.rowHeight || 78.75; const fill = /^[0-9A-F]{8}$/i.test(o.fill || '') ? o.fill : 'FF2E7D32';
    const cell = (c, ref, style) => {
      if (c == null || c === '') return '';
      if (typeof c === 'number') return '<c r="' + ref + '" s="' + (style || 2) + '"><v>' + c + '</v></c>';
      if (typeof c === 'object' && c.f) return '<c r="' + ref + '" s="3"><f>' + xesc(c.f) + '</f></c>';
      return '<c r="' + ref + '" s="' + (style || 3) + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(c) + '</t></is></c>';
    };
    const headXml = '<row r="1" ht="30" customHeight="1">' + head.map((x, i) => cell(String(x), colName(i) + '1', 1)).join('') + '</row>';
    const body = rows.map((r, ri) => '<row r="' + (ri + 2) + '" ht="' + rh + '" customHeight="1">' + r.map((c, ci) => cell(c, colName(ci) + (ri + 2))).join('') + '</row>').join('');
    const cols = '<cols>' + (o.widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    const at = o.freeze || 'C2'; const fz = /^([A-Z]+)(\d+)$/.exec(at);
    let pane = '';
    if (fz) { const xs = fz[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; const ys = Number(fz[2]) - 1; pane = '<pane xSplit="' + xs + '" ySplit="' + ys + '" topLeftCell="' + at + '" activePane="bottomRight" state="frozen"/>'; }
    const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships">'
      + '<sheetViews><sheetView workbookViewId="0">' + pane + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + headXml + body + '</sheetData>'
      + (imgs.length ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS + 'spreadsheetml/2006/main">'
      + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="' + fill + '"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
      + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const exts = [...new Set(imgs.map((im) => (im.ext === 'png' ? 'png' : 'jpeg')))];
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + exts.map((e) => '<Default Extension="' + e + '" ContentType="image/' + e + '"/>').join('')
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + (imgs.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets><sheet name="' + xesc(String(o.sheet || 'Sheet1').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    ];
    if (imgs.length) {
      files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' });
      const anchors = imgs.map((im, k) => '<xdr:oneCellAnchor><xdr:from><xdr:col>' + im.col + '</xdr:col><xdr:colOff>' + 2 * EMU + '</xdr:colOff><xdr:row>' + (im.row + 1) + '</xdr:row><xdr:rowOff>' + 2 * EMU + '</xdr:rowOff></xdr:from>'
        + '<xdr:ext cx="' + Math.round(im.w * EMU) + '" cy="' + Math.round(im.h * EMU) + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Picture ' + (k + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
        + '<xdr:blipFill><a:blip r:embed="rId' + (k + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + Math.round(im.w * EMU) + '" cy="' + Math.round(im.h * EMU) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>').join('');
      files.push({ name: 'xl/drawings/drawing1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="' + NS + 'drawingml/2006/spreadsheetDrawing" xmlns:a="' + NS + 'drawingml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships">' + anchors + '</xdr:wsDr>' });
      files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships">'
        + imgs.map((im, k) => '<Relationship Id="rId' + (k + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/image" Target="../media/image' + (k + 1) + '.' + (im.ext === 'png' ? 'png' : 'jpeg') + '"/>').join('') + '</Relationships>' });
      imgs.forEach((im, k) => files.push({ name: 'xl/media/image' + (k + 1) + '.' + (im.ext === 'png' ? 'png' : 'jpeg'), data: im.bytes }));
    }
    return files;
  }
  const xlsx = (o) => PD.zip(xlsxParts(o));
  /** the sheet's file name: «<maker> - <yyyy-mm-dd>.xlsx» (signs a file system refuses dropped). */
  const sheetFileName = (maker, when) => { const d = when instanceof Date ? when : new Date(); return (String(maker || 'Products').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 60) || 'Products') + ' - ' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.xlsx'; };

  return { FIELDS, LABELS, NUMERIC, TEMPLATE, HEAD_SIMPLE, HEAD_VARIABLE, PREVIEWS, mapHeaders, readSheet, blankRow, photoIndex, assignPhotos, brandCode3, validCode, sizeCode, skuOf, validSku, skuBase, baseName,
    groupRows, slugName, imageSku, fileName, siteUrl, pricesOf, rowIssues, sheetOf, blankSheetRows, colName, xlsxParts, xlsx, sheetFileName, norm };
});
