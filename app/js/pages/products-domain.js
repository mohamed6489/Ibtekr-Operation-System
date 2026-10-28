
/* Products + marketing «إنشاء» domain — pure functions (UMD). Rules from the owner (25 Oct 2026):
   SKU = IBTK + size + color + supplier + category + design + 6-digit serial; image name = Product name-00-SKU;
   sale = vendor ÷ (1 − Ibtekr rate); regular = sale ÷ (1 − discount); trash kept 30 days. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrProducts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SKU_PARTS = ['size', 'color', 'supplier', 'category', 'design'];
  const pad6 = (n) => String(n).padStart(6, '0');
  function skuParts(c) {
    const missing = SKU_PARTS.filter((k) => !c[k]);
    const sku = 'IBTK' + SKU_PARTS.map((k) => c[k] || '?').join('') + pad6(c.serial || 0);
    return { sku, complete: missing.length === 0, missing };
  }
  const buildSku = (c) => skuParts(c).sku;
  const serialStart = ({ isNew, from }) => (isNew ? 1 : parseInt(String(from || '1').replace(/\D/g, ''), 10) || 1);
  const serials = (start, n) => Array.from({ length: n }, (_, i) => start + i);
  const sizeCode = (s) => String(s || '').replace(/[^\d]+/g, ' ').trim().split(/\s+/).join('');
  function price(vendor, rate, discount) {
    const sale = Math.round(vendor / (1 - rate));
    const regular = Math.round(sale / (1 - (discount || 0)));
    return { sale, regular, share: sale - vendor };
  }
  const DISCOUNTS = [0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.3];
  const rotatingDiscount = (i) => DISCOUNTS[i % DISCOUNTS.length];
  const slug = (name) => String(name || '').trim().split(/\s+/).join('-');
  const imageName = (name, idx, sku) => slug(name) + '-' + String(idx).padStart(2, '0') + '-' + sku + '.webp';
  const imagePath = (sku, color, name, idx) => sku + '/' + color + '/' + imageName(name, idx, sku);
  function combos(opts) {
    const keys = Object.keys(opts || {}).filter((k) => (opts[k] || []).length);
    if (!keys.length) return [];
    return keys.reduce((acc, k) => acc.flatMap((a) => opts[k].map((v) => Object.assign({}, a, { [k]: v }))), [{}]);
  }
  function stockState(qty, onDemand, alert) {
    if (onDemand) return 'حسب الطلب';
    if (qty <= 0) return 'نفد';
    if (qty <= (alert == null ? 3 : alert)) return 'قليل';
    return 'متاح';
  }
  const CHECKS = [['nameEn', 'الاسم EN'], ['nameAr', 'الاسم AR'], ['sku', 'SKU'], ['price', 'السعر'], ['images', 'الصور'], ['category', 'القسم'], ['weight', 'الوزن'], ['sizeImage', 'صورة المقاس'], ['desc', 'الوصف']];
  function completeness(p) {
    const missing = CHECKS.filter(([k]) => !p[k]).map(([, l]) => l);
    return { missing, pct: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100) };
  }
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const TRASH_DAYS = 30;
  const trashDaysLeft = (movedAt, today) => Math.max(0, TRASH_DAYS - days(movedAt, today));
  const trashSoon = (left) => left <= 5;
  function moveVendor(p, { vendor, code, keepSku }) {
    const out = Object.assign({}, p, { vendor });
    if (!keepSku && code && /^IBTK/.test(p.sku)) {
      // supplier code sits right after size + color; size code length varies, so swap the char before category+design+serial (8 chars from the end)
      const s = p.sku; const i = s.length - 6 - 2 - 1;
      out.sku = s.slice(0, i) + code + s.slice(i + 1); out.oldSku = s;
    }
    return out;
  }
  const bumpPrice = (v, pct) => Math.round(v * (1 + pct / 100));
  // كود التصميم من اسم المنتج (owner 26 Oct): النوع = الاسم قبل «—». لو موجود في جدول الأكواد ياخد كوده،
  // غير كده بيتعمل كود جديد تلقائي: أول حرف، وبعدين أول حرفين من الكلمتين، وبعدين أول حرفين — من غير تكرار.
  const designBase = (name) => String(name || '').split(/\s+[—–-]\s+/)[0].trim();
  function designCode(name, table, taken) {
    const base = designBase(name); if (!base) return { code: '', base, isNew: false };
    const hit = (table || []).find((x) => String(x[0]).toLowerCase() === base.toLowerCase()); if (hit) return { code: hit[1], base, isNew: false };
    const used = new Set((table || []).map((x) => x[1]).concat(taken || []));
    const w = base.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean); const up = (x) => x.toUpperCase();
    const cands = [w[0] && up(w[0][0]), w.length > 1 && up(w[0][0] + w[1][0]), w[0] && up(w[0].slice(0, 2)), w.length > 1 && up(w[0][0] + w[w.length - 1][0])].filter(Boolean);
    for (const c of cands) if (!used.has(c)) return { code: c, base, isNew: true };
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const c = up((w[0] || 'X')[0]) + a; if (!used.has(c)) return { code: c, base, isNew: true }; }
    return { code: '', base, isNew: true };
  }
  // مقاسات الصور (owner 26 Oct): مقاس المنتج على الموقع + كل مقاسات السوشيال. موديلات الصور من كتالوج Magnific (الأسماء الحقيقية).
  const IMG_SIZES = Object.freeze([
    { id: '700x800', label: '700 × 800 · صورة المنتج (الموقع)', group: 'الموقع', def: true },
    { id: '1080x1350', label: '1080 × 1350 · انستجرام بوست 4:5', group: 'انستجرام' }, { id: '1080x1080', label: '1080 × 1080 · انستجرام مربع 1:1', group: 'انستجرام' }, { id: '1080x1920', label: '1080 × 1920 · ستوري / ريلز 9:16', group: 'انستجرام' },
    { id: '1200x630', label: '1200 × 630 · فيسبوك بوست / لينك', group: 'فيسبوك' }, { id: '1640x624', label: '1640 × 624 · فيسبوك كوفر', group: 'فيسبوك' },
    { id: '1080x1920t', label: '1080 × 1920 · تيك توك 9:16', group: 'تيك توك' }, { id: '1000x1500', label: '1000 × 1500 · بنترست 2:3', group: 'بنترست' },
    { id: '1600x900', label: '1600 × 900 · X (تويتر) 16:9', group: 'X' }, { id: '1200x627', label: '1200 × 627 · لينكدإن', group: 'لينكدإن' }, { id: '1280x720', label: '1280 × 720 · يوتيوب ثامبنيل', group: 'يوتيوب' }]);
  // مقاس مخصص (owner 27 Oct): عرض × طول بالبكسل — من 256 لـ 4096، والنسبة مش أكتر من 4:1
  const CUSTOM_MIN = 256, CUSTOM_MAX = 4096;
  function customSize(w, hgt) {
    const W = Number(String(w == null ? '' : w).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).trim()), H = Number(String(hgt == null ? '' : hgt).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).trim());
    const e = {};
    if (!Number.isInteger(W) || W < CUSTOM_MIN || W > CUSTOM_MAX) e.w = 'العرض من ' + CUSTOM_MIN + ' لـ ' + CUSTOM_MAX + ' بكسل';
    if (!Number.isInteger(H) || H < CUSTOM_MIN || H > CUSTOM_MAX) e.h = 'الطول من ' + CUSTOM_MIN + ' لـ ' + CUSTOM_MAX + ' بكسل';
    if (!e.w && !e.h && Math.max(W, H) / Math.min(W, H) > 4) e.h = 'النسبة كبيرة أوي — أقصى حاجة 4:1';
    return { ok: !e.w && !e.h, w: W, h: H, errors: e, label: !e.w && !e.h ? W + ' × ' + H + ' · مقاس مخصص' : 'مقاس مخصص' };
  }
  const IMG_MODELS = Object.freeze([
    { id: 'seedream-5-pro', name: 'Seedream 5 Pro', credits: 2, def: true, note: 'الافتراضي — منتجات وتعديل بالمرجعية' },
    { id: 'imagen-nano-banana-2', name: 'Google Nano Banana Pro', credits: 3, note: 'أدق في تفاصيل المنتج والبراند' },
    { id: 'imagen-nano-banana-2-lite', name: 'Google Nano Banana 2 Lite', credits: 1, note: 'سريع ورخيص — للتجارب' },
    { id: 'recraft-v4-1', name: 'Recraft V4.1', credits: 2, note: 'نص لصورة من غير مرجعية' },
    { id: 'gpt-2', name: 'GPT 2', credits: 3, note: 'بوستات فيها كلام وتصميمات' },
    { id: 'magnific-one', name: 'Magnific One', credits: 4, note: 'الوحيد اللي بيشتغل بـ Brand Kit' }]);
  const imgCredits = (count, modelId) => (Number(count) || 0) * ((IMG_MODELS.find((m) => m.id === modelId) || IMG_MODELS[0]).credits);
  function validateCode(code, used) {
    if (!code) return 'اكتب الكود';
    if (!/^[A-Za-z0-9]{1,2}$/.test(code)) return 'حرف أو حرفين بالإنجليزي أو أرقام';
    if ((used || []).includes(code)) return 'الكود ده مستخدم قبل كده';
    return '';
  }
  function groupImages(files) {
    const g = {};
    files.forEach((f) => { const m = /^(\d+)/.exec(f); if (!m) return; (g[m[1]] = g[m[1]] || []).push(f); });
    const ordered = {}; Object.keys(g).sort((a, b) => a - b).forEach((k) => { ordered[k] = g[k]; });
    return ordered;
  }
  // ---------- v2 (26 Oct): variants SKU = parent + suffix, image slots, credits, multi-category, bulk price ----------
  const variantSku = (parent, codes) => String(parent || '') + (codes || []).filter(Boolean).map((c) => '-' + c).join('');
  const SLOTS = ['Close-up', 'البيئة المحيطة', 'Feature', 'المقاسات'];
  const SLOT_HINT = ['تركيز على المنتج', 'المنتج في مكانه', 'ميزة أو تفصيلة', 'الأبعاد على المنتج'];
  function credits({ images, texts, data }) { return (images || 0) * 1 + (texts || 0) * 1 + Math.ceil((data || 0) / 4); }
  const catsOf = (p) => (Array.isArray(p.cats) && p.cats.length ? p.cats : String(p.category || '').split(' + ').filter(Boolean));
  const inCategory = (p, cat) => !cat || catsOf(p).includes(cat);
  // target: 'vendor' (سعر المبتكر → sale recalculated) | 'rate' (نسبة إبتكر, points) | 'discount' (الخصم الوهمي, points) ; mode 'pct' | 'value' ; dir +1 | -1
  function bulkPrice(p, { target, mode, dir, amount }) {
    const a = Number(amount) || 0; const sgn = dir < 0 ? -1 : 1; const rate = p.rate != null ? p.rate : 33; const disc = p.disc != null ? p.disc : 20;
    const bump = (v) => (mode === 'pct' ? Math.round(v * (1 + (sgn * a) / 100)) : Math.round(v + sgn * a));
    let vendorPrice = p.vendorPrice, r = rate, d = disc;
    if (target === 'vendor') vendorPrice = Math.max(0, bump(p.vendorPrice));
    else if (target === 'rate') r = Math.min(90, Math.max(0, mode === 'pct' ? +(rate * (1 + (sgn * a) / 100)).toFixed(1) : rate + sgn * a));
    else d = Math.min(90, Math.max(0, mode === 'pct' ? +(disc * (1 + (sgn * a) / 100)).toFixed(1) : disc + sgn * a));
    const pr = price(vendorPrice, r / 100, d / 100);
    return { vendorPrice, rate: r, disc: d, sale: pr.sale, regular: pr.regular };
  }
  // ---------- التسعير من سعر المبتكر (صاحب المشروع 28 أكتوبر، قرار 16 في خطة المرحلة 5) ----------
  // سعر التخفيض = (سعر المبتكر + الرسوم) ÷ (1 − النسبة) لفوق لأقرب 10؛ السعر العادي (وهمي) = سعر التخفيض + 15–30% عشوائي لفوق لأقرب 10.
  const ceil10 = (x) => Math.ceil(Math.round(x * 1000) / 10000) * 10; // the rounding first: 1660.0000001 stays 1660
  const MARKUP_MIN = 15, MARKUP_MAX = 30;
  const randomMarkup = (rng) => MARKUP_MIN + Math.floor(Math.min(0.999999, Math.max(0, (rng || Math.random)())) * (MARKUP_MAX - MARKUP_MIN + 1));
  // vendor: سعر المبتكر · rate: نسبة إبتكر % (0 لعمولة ثابتة بس) · fee: الرسوم الثابتة · markup: الزيادة % (من غيرها عشوائي) → null لو الأرقام مش صالحة
  function priceFromVendor(vendor, opts) {
    const o = opts || {}; const v = Number(vendor), r = o.rate == null ? 0 : Number(o.rate), f = o.fee == null ? 0 : Number(o.fee);
    if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(r) || r < 0 || r >= 100 || !Number.isFinite(f) || f < 0) return null;
    const m = o.markup == null ? randomMarkup(o.rng) : Number(o.markup);
    const sale = ceil10((v + f) / (1 - r / 100));
    const regular = ceil10(sale * (1 + m / 100));
    return { sale, regular, markup: m, vendorNet: Math.round((sale * (1 - r / 100) - f) * 100) / 100 };
  }
  // ---------- marketing «إنشاء» ----------
  const VIDEO_MODELS = [
    { id: 'seedance-2.5', name: 'Seedance 2.5', note: 'الأفضل · لحد 30 ث · صوت', max: 30, durations: [10, 15, 30], res: ['1080p', '720p'], def: true },
    { id: 'seedance-2.0', name: 'Seedance 2.0', note: 'لو عايز 4K · لحد 15 ث', max: 15, durations: [10, 15], res: ['4K', '1080p'] },
    { id: 'kling-2.5', name: 'Kling 2.5', note: 'أرخص · صامت · 5 أو 10 ث', max: 10, durations: [5, 10], res: ['1080p', '720p'] },
    { id: 'minimax-h3', name: 'MiniMax H3', note: 'مسودات سريعة · لحد 15 ث', max: 15, durations: [10, 15], res: ['768p', '480p'] },
  ];
  const scenesTotal = (sc) => sc.reduce((s, x) => s + (Number(x.d) || 0), 0);
  function scenesFit(sc, model, target) {
    const m = VIDEO_MODELS.find((x) => x.id === model); const t = scenesTotal(sc);
    if (m && t > m.max) return 'المشاهد ' + t + ' ث والموديل ده لحد ' + m.max + ' ث';
    if (target && t !== target) return 'المشاهد ' + t + ' ث والمدة المختارة ' + target + ' ث';
    return '';
  }
  function campaignPieces({ posts, videos, stories }) {
    const out = [];
    for (let i = 1; i <= (posts || 0); i++) out.push({ id: 'P' + i, kind: 'بوست', n: i });
    for (let i = 1; i <= (videos || 0); i++) out.push({ id: 'V' + i, kind: 'فيديو', n: i });
    for (let i = 1; i <= (stories || 0); i++) out.push({ id: 'S' + i, kind: 'ستوري', n: i });
    return out;
  }
  // ---- real files for «حفظ على الجهاز» (owner 26 Oct): a store-only ZIP writer + a minimal XLSX with live formulas. Pure, no deps. ----
  const enc = (x) => (typeof x === 'string' ? new TextEncoder().encode(x) : x);
  let CRC = null;
  function crc32(b) { if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // files: [{ name: 'a/b.txt', data: string|Uint8Array }] → Uint8Array (.zip, stored, UTF-8 names so Arabic folder names survive)
  function zip(files, when) {
    const d = when || new Date(); const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff; const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    const parts = []; const central = []; let off = 0;
    const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc(f.name), data = enc(f.data); const crc = crc32(data);
      const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(Uint8Array.from(head), name, data);
      central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += head.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
    const all = parts.concat(central, [end]); const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const b of all) { out.set(b, p); p += b.length; } return out;
  }
  const xesc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // rows: arrays of cells — string | number | { f: 'G{r}/(1-H{r})' } ({r} = this row number) → files of an .xlsx (RTL sheet)
  function xlsxFiles(rows, sheetName) {
    const NS = 'http://schemas.openxmlformats.org/'; const sd = rows.map((row, ri) => '<row r="' + (ri + 1) + '">' + row.map((c, ci) => { const ref = colName(ci) + (ri + 1); if (c == null || c === '') return ''; if (typeof c === 'number') return '<c r="' + ref + '"><v>' + c + '</v></c>'; if (typeof c === 'object' && c.f) return '<c r="' + ref + '"><f>' + xesc(c.f.replace(/\{r\}/g, ri + 1)) + '</f></c>'; return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(c) + '</t></is></c>'; }).join('') + '</row>').join('');
    return [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets><sheet name="' + xesc((sheetName || 'Sheet1').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS + 'spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>' + sd + '</sheetData></worksheet>' }];
  }
  const xlsx = (rows, sheetName) => zip(xlsxFiles(rows, sheetName));
  const SLOT_DIRS = ['1 - الصورة الأساسية', '2 - البيئة المحيطة', '3 - المميزات والتفاصيل', '4 - المقاسات', '5 - صور إضافية'];
  const safeName = (s) => String(s || 'Product').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Product';
  // backup plan: which file goes where — pure, so the browser only fills in the bytes
  function backupPlan(root, items, ext) { const out = []; items.forEach((it) => (it.slots || []).forEach((sl, k) => { if (sl && sl.src) out.push({ dir: SLOT_DIRS[Math.min(k, 4)], src: sl.src, name: root + '/' + SLOT_DIRS[Math.min(k, 4)] + '/' + safeName(it.name) + '-0' + (k + 1) + '-' + safeName(it.sku || 'SKU') + '.' + (ext || 'webp') }); })); return out; }
  return { priceFromVendor, randomMarkup, ceil10, MARKUP_MIN, MARKUP_MAX, crc32, zip, xlsx, xlsxFiles, backupPlan, SLOT_DIRS, safeName, IMG_SIZES, customSize, IMG_MODELS, imgCredits, designCode, designBase, variantSku, SLOTS, SLOT_HINT, credits, catsOf, inCategory, bulkPrice, buildSku, skuParts, serialStart, serials, sizeCode, price, DISCOUNTS, rotatingDiscount, imageName, imagePath, combos, stockState, completeness, trashDaysLeft, trashSoon, TRASH_DAYS, moveVendor, bumpPrice, validateCode, groupImages, VIDEO_MODELS, scenesTotal, scenesFit, campaignPieces };
});

