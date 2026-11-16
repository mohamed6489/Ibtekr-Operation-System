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
    // each row keeps the line it sits on in the sheet (cells.lines from PD.parseXlsx, else its place) — a picture inside the sheet
    // is found by that line (comments decision 40)
    const src = Array.isArray(cells) ? cells : []; const lines = Array.isArray(src.lines) && src.lines.length === src.length ? src.lines : null;
    const kept = []; src.forEach((r, i) => { if (Array.isArray(r) && r.some((c) => String(c == null ? '' : c).trim() !== '')) kept.push({ r, line: lines ? Number(lines[i]) : i + 1 }); });
    const all = kept.map((x) => x.r);
    if (!all.length) return { rows: [], map: {}, unknown: [] };
    const head = all[0]; const map = mapHeaders(head);
    const taken = new Set(Object.values(map));
    const unknown = head.map((x, i) => (taken.has(i) || !String(x == null ? '' : x).trim() || /^#$|^preview|image|refrance|reference|صور/i.test(String(x)) ? null : String(x).trim())).filter(Boolean);
    const rows = kept.slice(1).map(({ r, line }) => {
      const o = blankRow();
      Object.keys(map).forEach((f) => { const v = r[map[f]]; if (NUMERIC.includes(f)) o[f] = num(v); else o[f] = text(v, f.startsWith('short') ? 2000 : 200); });
      o.line = line;
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
  /** the picked photos → [{ i, row, order, auto }] in the upload order. A numbered name keeps its row (1, 2, 1-2…); a name without a
   *  number (a maker's «IMG_…» / «WhatsApp Image …») takes the next free row, one photo a row, in the order picked — the owner 15 Nov:
   *  «بجرب ارفع الصور … مبتترفعش» (they were all dropped). `taken` = the rows that already have photos. */
  /** file names in their natural order — the numbers in them counted as numbers («IMG_9» before «IMG_10»), case aside. */
  const nameOrder = (a, b) => String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'en', { numeric: true, sensitivity: 'base' });
  function placePhotos(names, taken) {
    const used = new Set((Array.isArray(taken) ? taken : []).map(Number).filter((n) => n >= 1));
    const out = []; const loose = []; const list = Array.isArray(names) ? names : [];
    list.forEach((n, i) => { const p = photoIndex(n); if (p) { out.push({ i, row: p.row, order: p.order, auto: false }); used.add(p.row); } else loose.push(i); });
    // the owner 15 Nov («لو متسميين صح يترتبوا بحسب التسمية»): the photos without a row number take the free rows in their names' order
    loose.sort((a, b) => nameOrder(list[a], list[b]) || a - b);
    let next = 1;
    loose.forEach((i) => { while (used.has(next)) next += 1; used.add(next); out.push({ i, row: next, order: 0, auto: true }); });
    return out.sort((a, b) => a.row - b.row || a.order - b.order || a.i - b.i);
  }

  // ---------------------------------------------------------------- the chat's rows on the sheet's shape (comments decision 42)
  /**
   * The owner 15 Nov: «الشيت هيبقى عامل إزاي» in the WhatsApp flow too. A Variable batch with a shape — kinds { colors, sizes }, 0–5 each —
   * gives every product at least max(1, colors) × max(1, sizes) rows: the rows read from the chat stay as they are and where they
   * are; the variations the chat did not give are added after them (`added`), with the product's own names / material / style /
   * description and an empty colour, size and price for the member to fill. An added row still empty is dropped first, so a smaller
   * shape shrinks. Simple, or no shape: only the added-and-empty rows go.
   */
  function fitKinds(rows, type, kinds) {
    const emptyAdded = (r) => r && r.added && !r.colorEn && !r.colorAr && !r.size && !r.sizeAr && r.vendorPrice == null && !r.sku;
    const L = (Array.isArray(rows) ? rows : []).filter((r) => r && !emptyAdded(r));
    const k = kinds || {}; const n = (v) => Math.max(0, Math.min(5, Math.trunc(Number(v) || 0)));
    const want = type === 'Variable' && (n(k.colors) || n(k.sizes)) ? Math.max(1, n(k.colors)) * Math.max(1, n(k.sizes)) : 0;
    if (!want) return L;
    const order = []; const by = new Map();
    L.forEach((r) => { const p = Number(r.product) || 1; if (!by.has(p)) { by.set(p, []); order.push(p); } by.get(p).push(r); });
    const out = [];
    order.forEach((p) => {
      const mine = by.get(p); const first = mine[0]; out.push(...mine);
      for (let i = mine.length; i < want; i++) out.push(Object.assign(blankRow(), { product: p, nameEn: first.nameEn || '', nameAr: first.nameAr || '', materialEn: first.materialEn || '', materialAr: first.materialAr || '',
        styleEn: first.styleEn || '', styleAr: first.styleAr || '', shortEn: first.shortEn || '', shortAr: first.shortAr || '', catEn: first.catEn || '', added: true }));
    });
    return out;
  }

  // ---------------------------------------------------------------- a picture's signature (comments decision 40)
  // The owner 15 Nov: «محتاج السيستم يعمل ماتشينج للصور ف الترتيب لوحده بناءا علي الصور اللي جوة الشيت» — the photos a member uploads
  // are put on their rows by looking like the picture the sheet has on that row. Pure: the page hands the pixels.
  const SIG_G = 10, SIG_C = 3, SIG_TOL = 26, SIG_MAX = 0.35; // the same picture small and big measures ≈ 0.05–0.2; the same shape in another colour ≈ 0.65
  const SIG_LEN = SIG_G * SIG_G + SIG_C * SIG_C * 3 + 1;
  /**
   * A picture's signature from its pixels (RGBA, w × h — the picture drawn into a small square; `ratio` its real width ÷ height).
   * The plain border — the same colour as the four corners — is cut first, so a product on white and its small copy between white
   * bars show the same box; the box is then read as a 10 × 10 grid of grey, a 3 × 3 grid of colour and its shape. → a hex string
   * ('' when there are no pixels to read).
   */
  function photoSig(px, w, h, ratio) {
    if (!px || !(w >= 8) || !(h >= 8) || px.length < w * h * 4) return '';
    const at = (x, y) => (y * w + x) * 4;
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const bg = [0, 1, 2].map((c) => corners.reduce((t, i) => t + px[i + c], 0) / 4);
    const plain = corners.every((i) => [0, 1, 2].every((c) => Math.abs(px[i + c] - bg[c]) <= SIG_TOL));
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (plain) {
      const isBg = (i) => Math.abs(px[i] - bg[0]) <= SIG_TOL && Math.abs(px[i + 1] - bg[1]) <= SIG_TOL && Math.abs(px[i + 2] - bg[2]) <= SIG_TOL;
      const rowBg = (y) => { let n = 0; for (let x = 0; x < w; x++) if (!isBg(at(x, y))) n += 1; return n <= w * 0.03; };
      const colBg = (x) => { let n = 0; for (let y = y0; y <= y1; y++) if (!isBg(at(x, y))) n += 1; return n <= (y1 - y0 + 1) * 0.03; };
      while (y0 < y1 && rowBg(y0)) y0 += 1;
      while (y1 > y0 && rowBg(y1)) y1 -= 1;
      while (x0 < x1 && colBg(x0)) x0 += 1;
      while (x1 > x0 && colBg(x1)) x1 -= 1;
      if (x1 - x0 + 1 < 6 || y1 - y0 + 1 < 6) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; } // nothing but the background: the whole picture
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1; const bytes = [];
    const grid = (g, each) => {
      for (let gy = 0; gy < g; gy++) for (let gx = 0; gx < g; gx++) {
        const xa = x0 + Math.floor(gx * bw / g), xb = Math.max(xa, x0 + Math.ceil((gx + 1) * bw / g) - 1), ya = y0 + Math.floor(gy * bh / g), yb = Math.max(ya, y0 + Math.ceil((gy + 1) * bh / g) - 1);
        let r = 0, gr = 0, b = 0, n = 0;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const i = at(x, y); r += px[i]; gr += px[i + 1]; b += px[i + 2]; n += 1; }
        each(r / n, gr / n, b / n);
      }
    };
    grid(SIG_G, (r, g, b) => bytes.push(0.299 * r + 0.587 * g + 0.114 * b));
    grid(SIG_C, (r, g, b) => bytes.push(r, g, b));
    const shape = (bw / bh) * (ratio > 0 ? ratio * h / w : 1); // the box's real width ÷ height
    bytes.push(64 + 32 * Math.log2(Math.max(0.25, Math.min(4, shape)))); // 64 = a square, 32 a doubling
    return bytes.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  const sigBytes = (sig) => { const t = String(sig || ''); if (t.length !== SIG_LEN * 2 || /[^0-9a-f]/.test(t)) return null; const o = new Array(SIG_LEN); for (let i = 0; i < SIG_LEN; i++) o[i] = parseInt(t.substr(i * 2, 2), 16); return o; };
  /** how far two signatures are — 0 the same picture: the grey grids' likeness (1 − correlation) + twice the colours' difference + the boxes' shapes. Infinity for a broken one. */
  function sigDistance(a, b) {
    const A = sigBytes(a), B = sigBytes(b); if (!A || !B) return Infinity;
    const n = SIG_G * SIG_G; let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += A[i]; mb += B[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = A[i] - ma, y = B[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    const flatA = saa < n * 4, flatB = sbb < n * 4; // one grey all over: no shape to compare, the colour speaks
    const corr = flatA || flatB ? (flatA && flatB ? 1 : 0) : sab / Math.sqrt(saa * sbb);
    const m = SIG_C * SIG_C * 3; let col = 0;
    for (let i = 0; i < m; i++) col += Math.abs(A[n + i] - B[n + i]);
    col /= m * 255;
    const shape = Math.abs(A[n + m] - B[n + m]) / 32; // in doublings
    return (1 - corr) + col * 2 + (shape > 0.35 ? 0.5 : shape * 0.3);
  }
  /**
   * The uploaded photos against the sheet's own pictures: refs [{ row, sig }], photos [{ i, sig }] → { pairs: [{ i, row, d }], loose: [i] }.
   * The closest pair first; a row takes one photo and a photo one row; a pair further than `max` is no match.
   */
  function matchPhotos(refs, photos, max) {
    const lim = Number.isFinite(max) ? max : SIG_MAX; const all = []; const P = Array.isArray(photos) ? photos : [];
    (Array.isArray(refs) ? refs : []).forEach((r) => P.forEach((p) => { const d = sigDistance(r.sig, p.sig); if (d <= lim) all.push({ i: p.i, row: r.row, d }); }));
    all.sort((a, b) => a.d - b.d || a.row - b.row || a.i - b.i);
    const rows = new Set(); const used = new Set(); const pairs = [];
    all.forEach((x) => { if (rows.has(x.row) || used.has(x.i)) return; rows.add(x.row); used.add(x.i); pairs.push(x); });
    return { pairs: pairs.sort((a, b) => a.row - b.row), loose: P.map((p) => p.i).filter((i) => !used.has(i)) };
  }
  /**
   * What stops «التالي» in the first step (comments decision 41 — «لو لقي حاجة زيادة … او حاجة ناقصة»): rows [{ src, group }] (group =
   * its product — the variations of one product share its photos) and photoRows { row: [paths] } → { missing: [src of the first row
   * of each product without a photo], extra: [photo rows that are not rows of the sheet] }.
   */
  function photoGaps(rows, photoRows) {
    const L = Array.isArray(rows) ? rows : []; const by = photoRows && typeof photoRows === 'object' ? photoRows : {};
    const has = (n) => Array.isArray(by[n]) && by[n].length > 0;
    const srcs = new Set(L.map((r) => Number(r.src)));
    const groups = new Map(); L.forEach((r) => { const k = r.group == null ? 'r' + r.src : String(r.group); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(Number(r.src)); });
    const missing = [...groups.values()].filter((g) => !g.some(has)).map((g) => g[0]).sort((a, b) => a - b);
    const extra = Object.keys(by).map(Number).filter((n) => has(n) && !srcs.has(n)).sort((a, b) => a - b);
    return { missing, extra };
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
    const p = PD.priceFromVendor(vendor, { rate: o && o.rate, fee: o && o.fee, markup: o && o.markup, fake: o && o.fake }); // fake: the «الخصم الوهمي» tiers (15 Nov)
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
        if (f === 'n') return r.n != null && r.n !== '' ? r.n : i + 1; // case 3: «1-2» = product 1, its second variant
        if (f === 'ref') return '';
        if (/^img\d$/.test(f)) return imgs[Number(f.slice(3)) - 1] || '';
        const v = r[f]; return v == null ? '' : NUMERIC.includes(f) ? (Number.isFinite(Number(v)) && v !== '' ? Number(v) : '') : String(v);
      });
      if (t.previews) PREVIEWS.forEach((_, k) => { const col = colName(FIELDS.indexOf('img' + (k + 1))); cells.push(imgs[k] ? { f: 'IMAGE(' + col + (i + 2) + ')' } : ''); });
      return cells;
    });
    return { sheet: t.sheet, head, widths: WIDTHS.concat(t.previews ? PREVIEWS.map(() => 13) : []), fill: t.fill, refCol: FIELDS.indexOf('ref'), rows };
  }
  /**
   * The maker's copy of the sheet (comments decision 36 — «نسخة الفيندور تبقي بسيطة»): only what the maker reads and fills — the
   * reference photo, the two names, the colour, the size and his price. Its headers are Arabic and read back by mapHeaders
   * (the photo column is skipped by readSheet), so the sheet he returns starts a «شيت جاهز» batch as it is.
   */
  const MAKER_HEAD = ['#', 'الصورة المرجعية', 'الاسم بالإنجليزي', 'الاسم بالعربي', 'اللون', 'المقاس', 'سعر المبتكر'];
  function makerSheetOf(batch) {
    const rows = (batch && Array.isArray(batch.rows) ? batch.rows : []).map((r, i) => {
      const p = Number(r.vendorPrice);
      return [r.n != null && r.n !== '' ? r.n : i + 1, '', String(r.nameEn || ''), String(r.nameAr || ''), String(r.colorAr || r.colorEn || ''), String(r.sizeAr || r.size || ''),
        r.vendorPrice != null && r.vendorPrice !== '' && Number.isFinite(p) && p > 0 ? p : ''];
    });
    return { sheet: 'المنتجات', head: MAKER_HEAD.slice(), widths: [6, 17, 32, 32, 16, 18, 14], fill: 'FF005642', refCol: 1, rtl: true, rows };
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
      + '<sheetViews><sheetView' + (o.rtl ? ' rightToLeft="1"' : '') + ' workbookViewId="0">' + pane + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + headXml + body + '</sheetData>'
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
  // ---------------------------------------------------------------- the data step's lists (the owner 15 Nov: Arabic and English side by side)
  /** the material and the style dropdowns: [English, Arabic] pairs — a pick sets both columns; a value not in the list stays as typed. */
  const MATERIALS = [['Cotton', 'قطن'], ['Linen', 'كتان'], ['Wool', 'صوف'], ['Silk', 'حرير'], ['Velvet', 'قطيفة'], ['Bouclé', 'بوكليه'], ['Fabric', 'قماش'],
    ['Polyester', 'بوليستر'], ['Leather', 'جلد'], ['Felt', 'لباد'], ['Canvas', 'كانفاس'], ['Wood', 'خشب'], ['MDF', 'إم دي إف'], ['Plywood', 'أبلكاش'],
    ['Bamboo', 'بامبو'], ['Rattan', 'راتان'], ['Wicker', 'خوص'], ['Jute', 'جوت'], ['Macrame', 'مكرمية'], ['Crochet', 'كروشيه'], ['Ceramic', 'سيراميك'],
    ['Pottery', 'فخار'], ['Porcelain', 'بورسلين'], ['Glass', 'زجاج'], ['Marble', 'رخام'], ['Stone', 'حجر'], ['Concrete', 'أسمنت'], ['Metal', 'معدن'],
    ['Iron', 'حديد'], ['Stainless Steel', 'ستانلس ستيل'], ['Brass', 'نحاس أصفر'], ['Copper', 'نحاس'], ['Aluminum', 'ألومنيوم'], ['Silver', 'فضة'],
    ['Gold Plated', 'مطلي ذهب'], ['Resin', 'ريزن'], ['Epoxy', 'إيبوكسي'], ['Acrylic', 'أكريليك'], ['Plastic', 'بلاستيك'], ['Paper', 'ورق'],
    ['Beads', 'خرز'], ['Wax', 'شمع'], ['Mixed Materials', 'خامات متعددة']];
  const STYLES = [['Modern', 'مودرن'], ['Contemporary', 'معاصر'], ['Minimalist', 'مينيمال'], ['Boho', 'بوهيمي'], ['Classic', 'كلاسيك'], ['Vintage', 'فينتدج'],
    ['Retro', 'ريترو'], ['Rustic', 'ريفي'], ['Farmhouse', 'فارم هاوس'], ['Scandinavian', 'إسكندنافي'], ['Japandi', 'جاباندي'], ['Industrial', 'صناعي'],
    ['Mid-Century', 'ميد سنشري'], ['Art Deco', 'آرت ديكو'], ['Luxury', 'فخم'], ['Oriental', 'شرقي'], ['Islamic', 'إسلامي'], ['Pharaonic', 'فرعوني'],
    ['Coastal', 'ساحلي'], ['Tropical', 'استوائي'], ['Handmade', 'هاند ميد'], ['Geometric', 'هندسي'], ['Abstract', 'تجريدي'], ['Floral', 'فلورال'], ['Kids', 'أطفال']];
  /** the pair a value names, by its English or its Arabic (accents and case aside) → [en, ar] | null */
  const bare = (v) => norm(String(v == null ? '' : v).normalize('NFD').replace(/\p{M}/gu, '')); // «Bouclé» = «boucle»; the Arabic marks off too
  const pairOf = (list, en, ar) => { const e = bare(en); const a = bare(ar); return (e || a) ? list.find(([x, y]) => (e && bare(x) === e) || (a && bare(y) === a)) || null : null; };
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const SIZE_WORDS = [[/سنتيمتر|سنتي|سم/g, 'cm'], [/مليمتر|ملي|مم/g, 'mm'], [/كيلو\s*جرام|كيلو|كجم/g, 'kg'], [/متر/g, 'm'], [/عرض/g, 'W'], [/طول/g, 'L'],
    [/ارتفاع|إرتفاع/g, 'H'], [/عمق/g, 'D'], [/قطر/g, 'Ø'], [/مقاس/g, ''], [/صغير/g, 'S'], [/وسط|متوسط/g, 'M'], [/كبير/g, 'L']];
  /** an Arabic size → its English (the digits Latin, the units and the dimension words in English): «عرض ١٢٠ × طول ٧٠ سم» → «W 120 × L 70 cm»;
   * a size with Arabic letters left over → '' (the English stays as it is). */
  function sizeEnOf(ar) {
    let s = String(ar == null ? '' : ar).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/(\d)\s*[xX*]\s*(?=\d)/g, '$1×');
    SIZE_WORDS.forEach(([re, to]) => { s = s.replace(re, to); });
    s = s.replace(/\s*×\s*/g, ' × ').replace(/\s+/g, ' ').trim();
    return /[\u0600-\u06FF]/.test(s) ? '' : s;
  }

  const xlsx = (o) => PD.zip(xlsxParts(o));
  /** the sheet's file name: «<maker> - <yyyy-mm-dd>.xlsx» (signs a file system refuses dropped). */
  const sheetFileName = (maker, when, tag) => { const d = when instanceof Date ? when : new Date(); const clean = (x) => String(x || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
    return (clean(maker).slice(0, 60) || 'Products') + (clean(tag) ? ' - ' + clean(tag).slice(0, 30) : '') + ' - ' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.xlsx'; };

  return { FIELDS, LABELS, NUMERIC, TEMPLATE, HEAD_SIMPLE, HEAD_VARIABLE, PREVIEWS, mapHeaders, readSheet, blankRow, photoIndex, assignPhotos, placePhotos, brandCode3, validCode, sizeCode, skuOf, validSku, skuBase, baseName,
    groupRows, slugName, imageSku, fileName, siteUrl, pricesOf, rowIssues, sheetOf, makerSheetOf, MAKER_HEAD, photoSig, sigDistance, matchPhotos, photoGaps, SIG_MAX, fitKinds, blankSheetRows, colName, xlsxParts, xlsx, sheetFileName, norm,
    MATERIALS, STYLES, pairOf, sizeEnOf, nameOrder };
});
