// «تكرار كمنتج جديد» (phase 12 T2, docs/superpowers/plans/2026-11-08-phase-12-followups.md decisions 2 and 9) — the pure part of
// woo-sync's product_duplicate: a draft copy of a site product with its data, images (the same media), categories, brands,
// attributes, variations and Arabic translation, under a new SKU from the studio's serial (the IBT… rule of 5.2). No I/O here.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const wooId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const ids = (list) => (Array.isArray(list) ? list : []).map((x) => (isObj(x) ? wooId(x.id) : wooId(x))).filter((x) => x !== null).map((id) => ({ id }));

export const COPY_SUFFIX = '(نسخة)';
/** The studio's SKU (5.2 decision 2): IBT + brand's two letters + the color's two letters (a Variable has none) + the serial (4+ digits) + «-size». */
export const STUDIO_SKU = /^IBT([A-Z]{2})([A-Z]{2})?(\d{4,})(-\d+)?$/;
const pad4 = (n) => String(n).padStart(4, '0');

/** The copy's SKU: a studio SKU keeps its brand, color and size under the new serial; any other SKU takes «-<serial>»; none → null (no SKU). */
export function duplicateSku(sourceSku, serial) {
  const s = str(sourceSku, 120).trim();
  if (!Number.isInteger(serial) || serial < 0) return null;
  const m = STUDIO_SKU.exec(s);
  if (m) return 'IBT' + m[1] + (m[2] || '') + pad4(serial) + (m[4] || '');
  return s ? s + '-' + pad4(serial) : null;
}
/** A variation's SKU: a studio SKU (brand + color + serial + size) under the new serial; else the parent's part swapped when the old one leads it; else the new parent + «-n». */
export function variationSku(varSku, opts) {
  const { serial, oldParent, newParent, n } = opts || {};
  const v = str(varSku, 120).trim(); const o = str(oldParent, 120).trim();
  if (STUDIO_SKU.test(v)) return duplicateSku(v, serial);
  if (!newParent) return v || undefined;
  if (v && o && v.startsWith(o)) return newParent + v.slice(o.length);
  return newParent + '-' + n;
}

const SHARED = ['regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders', 'weight'];
const copyShared = (p) => {
  const out = {};
  for (const k of SHARED) {
    if (p[k] === undefined || p[k] === null || p[k] === '') continue; // an empty price / weight is none (a Variable's parent)
    if (k === 'manage_stock') out[k] = p[k] === true; else if (k === 'stock_quantity') { const n = Number(p[k]); if (Number.isInteger(n) && n >= 0) out[k] = n; } else out[k] = str(p[k], 40);
  }
  if (out.manage_stock === false) delete out.stock_quantity;
  return out;
};
const copyAttrs = (list) => (Array.isArray(list) ? list : []).filter(isObj).map((a) => ({ ...(wooId(a.id) !== null ? { id: wooId(a.id) } : {}), ...(a.name ? { name: str(a.name, 120) } : {}),
  position: Number.isInteger(a.position) ? a.position : 0, visible: a.visible !== false, variation: a.variation === true, options: (Array.isArray(a.options) ? a.options : []).map((o) => str(o, 120)).filter(Boolean) }))
  .filter((a) => (a.id !== undefined || a.name) && a.options.length);

/** The new product as WooCommerce takes it: a draft, the source's texts, prices, stock, weight / dimensions, categories, tags, brands, attributes and the same media, under `sku`. */
export function duplicatePayload(p, o = {}) {
  if (!isObj(p)) return null;
  const sku = o.sku; const suffix = o.suffix ?? COPY_SUFFIX;
  const out = {
    name: (str(p.name, 180).trim() || 'Product') + ' ' + suffix, type: p.type === 'variable' ? 'variable' : 'simple', status: 'draft',
    description: str(p.description), short_description: str(p.short_description, 2000), ...copyShared(p),
    categories: ids(p.categories), tags: ids(p.tags), images: ids(p.images), attributes: copyAttrs(p.attributes),
    lang: p.lang === 'ar' ? 'ar' : 'en', wpml_language: p.lang === 'ar' ? 'ar' : 'en',
  };
  if (Array.isArray(p.brands) && p.brands.length) out.brands = ids(p.brands);
  if (isObj(p.dimensions)) { const d = {}; for (const k of ['length', 'width', 'height']) if (p.dimensions[k]) d[k] = str(p.dimensions[k], 20); if (Object.keys(d).length) out.dimensions = d; }
  if (sku) out.sku = sku;
  return out;
}
/** A variation of the copy: its prices, stock, attributes and image under its new SKU. */
export function duplicateVariation(v, sku) {
  if (!isObj(v)) return null;
  const out = { ...copyShared(v), attributes: (Array.isArray(v.attributes) ? v.attributes : []).filter(isObj).map((a) => ({ ...(wooId(a.id) !== null ? { id: wooId(a.id) } : {}), ...(a.name ? { name: str(a.name, 120) } : {}), option: str(a.option, 120) })).filter((a) => a.option) };
  if (sku) out.sku = sku;
  const img = isObj(v.image) ? wooId(v.image.id) : null; if (img !== null) out.image = { id: img };
  if (v.description) out.description = str(v.description, 2000);
  return out;
}
/** The Arabic translation of the copy (WPML): its texts and attributes; the type and status follow the product, the link is translation_of. */
export function duplicateAr(ar, o = {}) {
  if (!isObj(ar)) return null;
  const type = o.type; const translationOf = o.translationOf; const suffix = o.suffix ?? COPY_SUFFIX;
  return { name: (str(ar.name, 180).trim() || 'منتج') + ' ' + suffix, description: str(ar.description), short_description: str(ar.short_description, 2000), attributes: copyAttrs(ar.attributes),
    type: type === 'variable' ? 'variable' : 'simple', status: 'draft', lang: 'ar', wpml_language: 'ar', translation_of: translationOf };
}
