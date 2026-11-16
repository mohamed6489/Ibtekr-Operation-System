// woo-studio: the product studio's upload (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md) as pure
// functions shared by woo-sync's studio_upload and the node tests. A batch item (studio_batches.state.items[i], written by
// the page) is checked field by field and turned into the WooCommerce payloads: the product (draft, English), its
// variations, the image paths in the bucket `studio` and the Arabic translation's own fields. Anything outside the
// allow-list refuses the item (400 before any call to the site). No backslash-u escapes in this file: the deploy tool rewrites them into the characters.
import { cleanFields } from './woo-products.js';

// the global attributes the studio fills (decision 5), looked up by slug on the site
export const STUDIO_ATTRS = { color: 'pa_color', size: 'pa_size', material: 'pa_material', style: 'pa_style', brand: 'pa_brand' };
export const MAX_IMAGES = 6;
export const MAX_IMAGES_FLOW = 10; // the three flows (docs/superpowers/plans/2026-11-14-studio-flows.md): 4 shots + the size drawing + the features image + room
export const MAX_VARIATIONS = 100;
// the three flows: the SKU comes with the item (the maker's own, or the flow's IBT + brand code + serial + -color + -size) and is
// checked here; the site's variation gallery (the «Variation Images Gallery» plugin's meta, the owner's WP All Import column
// {woovariationgalleryimages}) takes a variation's photos after its first
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,48}$/;
export const VARIATION_GALLERY_KEY = 'woo_variation_gallery_images';
const listOf = (v, max) => String(v == null ? '' : v).split(/[,،]/).map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => plain(x, max));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v, max) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max && !/[<>%]/.test(v) ? v.trim() : null);
const asciiDigits = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));

// The SKU (the owner, 28 Oct; decision 2): IBT + the brand's first two letters + the color code + the serial (4 digits at
// least) + «-size digits» for a variation with a size. The page's products-domain.js studioSku is the same rule.
export const brandCode = (name) => { const l = String(name || '').toUpperCase().replace(/[^A-Z]/g, ''); return l.length >= 2 ? l.slice(0, 2) : null; };
export const sizeDigits = (s) => asciiDigits(s).replace(/[^\d]+/g, '');
// The size as the site shows it (the owner, 2 Nov): a size typed as numbers only («40×50», «٥٠×٥٠», «30») gets the unit — «cm»
// on the English product, «سم» on the Arabic one; a size with its own unit keeps it (the unit word swapped for the other
// language when it is cm / سم); «S» / «M» / «L» and the like stay as typed in both.
const BARE_SIZE = /^[\d.,٠-٩۰-۹\s×xX*\-–]+$/;
export function sizeLabel(size, lang = 'en') {
  const s = String(size == null ? '' : size).trim();
  if (!s) return s;
  if (BARE_SIZE.test(s)) return s + (lang === 'ar' ? ' سم' : ' cm');
  return lang === 'ar' ? s.replace(/\s*\bcm\b\.?/i, ' سم') : s.replace(/\s*سم(?![؀-ۿ])/, ' cm');
}
export function studioSku({ brand, color, serial, size }) {
  const b = brandCode(brand);
  if (!b || !Number.isInteger(serial) || serial < 0 || (color && !/^[A-Z]{2}$/.test(color))) return null;
  const sz = size ? sizeDigits(size) : '';
  return 'IBT' + b + (color || '') + String(serial).padStart(4, '0') + (sz ? '-' + sz : '');
}

const stockOf = (it) => {
  if (it.onDemand === true) return { manage_stock: false, stock_status: 'onbackorder' };
  if (Number.isInteger(it.stock) && it.stock >= 0 && it.stock <= 100000) return { manage_stock: true, stock_quantity: it.stock };
  if (it.stock == null) return { manage_stock: false, stock_status: 'instock' };
  return null;
};

// The site's WooCommerce brand for the batch's brand (decision 5): the woo_brands row whose name or slug is the brand's name
// or one of its aliases once case, spaces and signs are set aside («@Sugar-crafts» = «Sugar crafts» = sugar-crafts). None,
// or more than one → null. The brand in both places (the owner 15 Nov, comments plan decision 81): with none, woo-sync makes the
// site's brand under the brand's own name before the product goes up (wooBrandIds tells none from more than one); with more than
// one the product goes up with the pa_brand attribute only and the report says so.
const brandKey = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const slugKey = (s) => { try { return brandKey(decodeURIComponent(String(s == null ? '' : s))); } catch { return brandKey(s); } };
export function wooBrandIds(brand, wooBrands) {
  const keys = new Set([brand?.name, ...(Array.isArray(brand?.aliases) ? brand.aliases : [])].map(brandKey).filter(Boolean));
  return [...new Set((Array.isArray(wooBrands) ? wooBrands : []).filter((w) => isObj(w) && Number.isInteger(Number(w.id)) && Number(w.id) > 0
    && (keys.has(brandKey(w.name)) || keys.has(slugKey(w.slug)))).map((w) => Number(w.id)))];
}
export function matchWooBrand(brand, wooBrands) {
  const ids = wooBrandIds(brand, wooBrands);
  return ids.length === 1 ? ids[0] : null;
}

/**
 * item + { batchId, type, brand, wooBrand (the site's WooCommerce brand id or null), colors: { CODE: 'Name EN' }, colorsAr?: { CODE: 'الاسم' },
 *   attrs: { color, size, material, style, brand } (ids or null) }
 * → { error, field } | { sku, product, variations: [{ sku, payload, image }], images: [path…], ar: { name, short_description? },
 *   arAttributes: [{ id, visible, variation, options }] (the translation's attributes, the same ids) } (the Arabic name is required, decision 15)
 */
export function buildStudio(item, o) {
  const bad = (field) => ({ error: 'bad_field', field });
  if (!isObj(item) || !isObj(o)) return bad('item');
  const flow = item.flow === 2; // the three flows: the item carries its type, its SKUs and the Arabic attribute words
  const rawType = flow && (item.type === 'Simple' || item.type === 'Variable') ? item.type : o.type;
  const type = rawType === 'Variable' ? 'Variable' : rawType === 'Simple' ? 'Simple' : null;
  if (!type) return bad('type');
  if (!brandCode(o.brand)) return bad('brand');
  const name = plain(item.nameEn, 200); if (!name) return bad('nameEn');
  const nameAr = plain(item.nameAr, 200); if (!nameAr) return bad('nameAr'); // decision 15: every product gets its Arabic translation
  if (flow ? !(typeof item.sku === 'string' && SKU_RE.test(item.sku)) : (!Number.isInteger(item.serial) || item.serial < 0 || item.serial > 99999999)) return bad(flow ? 'sku' : 'serial');
  const colors = Array.isArray(item.colors) ? item.colors : [];
  if (colors.length > 30 || !colors.every((c) => typeof c === 'string' && o.colors && typeof o.colors[c] === 'string')) return bad('colors');
  const sizes = Array.isArray(item.sizes) ? item.sizes.map((s) => plain(s, flow ? 40 : 30)) : [];
  if (sizes.length > 30 || sizes.some((s) => !s)) return bad('sizes');
  const material = item.material ? plain(item.material, 80) : null; if (item.material && !material) return bad('material');
  const style = item.style ? plain(item.style, 80) : null; if (item.style && !style) return bad('style');
  // the flows: «Rustic, Modern» is two terms, and the Arabic words of each go on the translation in the same order
  const materials = flow && material ? listOf(material, 60) : material ? [material] : [];
  const styles = flow && style ? listOf(style, 60) : style ? [style] : [];
  const materialsAr = flow && item.materialAr ? listOf(item.materialAr, 60) : materials;
  const stylesAr = flow && item.styleAr ? listOf(item.styleAr, 60) : styles;
  if ([materials, styles, materialsAr, stylesAr].some((l) => l.some((x) => !x))) return bad('material');
  const sizesArIn = flow && Array.isArray(item.sizesAr) ? item.sizesAr.map((x) => (x == null || x === '' ? null : plain(x, 40))) : [];
  if (sizesArIn.some((x) => x === undefined)) return bad('sizesAr');
  const pathRe = new RegExp('^' + String(o.batchId).replace(/[^0-9a-f-]/gi, '') + '/[A-Za-z0-9._-]{1,120}\\.(webp|png|jpe?g)$');
  const images = Array.isArray(item.images) ? item.images : [];
  if (images.length > (flow ? MAX_IMAGES_FLOW : MAX_IMAGES) || !images.every((p) => typeof p === 'string' && pathRe.test(p))) return bad('images');
  const base = cleanFields({ name, ...(item.shortDesc ? { short_description: item.shortDesc } : {}), ...(item.weight ? { weight: String(item.weight) } : {}),
    categories: Array.isArray(item.categories) ? item.categories : [], ...(o.wooBrand != null ? { brands: [o.wooBrand] } : {}) }, ['name', 'short_description', 'weight', 'categories', 'brands']);
  if (base.error) return bad(base.field);
  const arShort = item.shortDescAr ? cleanFields({ short_description: item.shortDescAr }, ['short_description']) : { payload: {} };
  if (arShort.error) return bad('shortDescAr');

  // the attributes twice: the English product's and the Arabic translation's (the same taxonomy ids; the Arabic color name
  // from sku_colors, the size with «سم», the rest as typed — the owner, 2 Nov: the translation used to come without a size or
  // a brand because the English terms the site made had no Arabic translation)
  const attrs = []; const arAttrs = [];
  const add = (id, options, variation, arOptions = options) => { if (Number.isInteger(id) && options.length) { attrs.push({ id, visible: true, variation, options }); arAttrs.push({ id, visible: true, variation, options: arOptions }); } };
  const colorNames = colors.map((c) => o.colors[c]);
  const colorNamesAr = colors.map((c) => (o.colorsAr && typeof o.colorsAr[c] === 'string' && o.colorsAr[c].trim()) || o.colors[c]);
  const sizesEn = flow ? sizes : sizes.map((s) => sizeLabel(s, 'en')); const sizesAr = sizes.map((s, k) => (flow && sizesArIn[k]) || sizeLabel(s, 'ar'));
  const at = o.attrs || {};
  if (type === 'Simple') {
    if (colors.length > 1 || sizes.length > 1) return bad('variations');
    add(at.color, colorNames, false, colorNamesAr); add(at.size, sizesEn, false, sizesAr);
  } else {
    if (!colors.length && !sizes.length) return bad('variations');
    add(at.color, colorNames, colors.length > 0, colorNamesAr); add(at.size, sizesEn, sizes.length > 0, sizesAr);
  }
  add(at.material, materials, false, materialsAr); add(at.style, styles, false, stylesAr); add(at.brand, [String(o.brand).trim()], false);

  const product = { ...base.payload, type: type === 'Variable' ? 'variable' : 'simple', status: 'draft', attributes: attrs, lang: 'en', wpml_language: 'en' };
  const variations = [];
  let sku;
  if (type === 'Simple') {
    sku = flow ? item.sku : studioSku({ brand: o.brand, color: colors[0] || null, serial: item.serial });
    const price = cleanFields({ regular_price: item.regular, sale_price: item.sale }, ['regular_price', 'sale_price']); if (price.error || !price.payload.sale_price) return bad('price');
    const stock = stockOf(item); if (!stock) return bad('stock');
    Object.assign(product, price.payload, stock);
  } else {
    sku = flow ? item.sku : studioSku({ brand: o.brand, serial: item.serial });
    const vars = Array.isArray(item.variations) ? item.variations : [];
    if (!vars.length || vars.length > MAX_VARIATIONS) return bad('variations');
    const seen = new Set();
    for (const v of vars) {
      if (!isObj(v)) return bad('variations');
      const color = v.color == null ? null : v.color; const size = v.size == null ? null : plain(v.size, flow ? 40 : 30);
      if ((colors.length ? !colors.includes(color) : color !== null) || (sizes.length ? !sizes.includes(size) : size !== null)) return bad('variations');
      const key = (color || '') + '|' + (size || ''); if (seen.has(key)) return bad('variations'); seen.add(key);
      const price = cleanFields({ regular_price: v.regular, sale_price: v.sale }, ['regular_price', 'sale_price']); if (price.error || !price.payload.sale_price) return bad('variations.price');
      const stock = stockOf(v); if (!stock) return bad('variations.stock');
      const image = v.image == null ? null : typeof v.image === 'string' && pathRe.test(v.image) ? v.image : undefined; if (image === undefined) return bad('variations.image');
      const gallery = flow && Array.isArray(v.gallery) ? v.gallery : [];
      if (gallery.length > MAX_IMAGES_FLOW || !gallery.every((p) => typeof p === 'string' && pathRe.test(p))) return bad('variations.gallery');
      if (flow && !(typeof v.sku === 'string' && SKU_RE.test(v.sku))) return bad('variations.sku');
      const vsku = flow ? v.sku : studioSku({ brand: o.brand, color, serial: item.serial, size: sizes.length ? size : null });
      variations.push({ sku: vsku, image, gallery, payload: { sku: vsku, ...price.payload, ...stock, ...(flow && Number(v.weight) > 0 && Number(v.weight) < 10000 ? { weight: String(v.weight) } : {}),
        attributes: [color && Number.isInteger(at.color) ? { id: at.color, option: o.colors[color] } : null, size && Number.isInteger(at.size) ? { id: at.size, option: flow ? size : sizeLabel(size, 'en') } : null].filter(Boolean) } });
    }
  }
  if (!sku) return bad('sku');
  if (flow && new Set([sku, ...variations.map((v) => v.sku)]).size !== variations.length + 1) return bad('variations.sku'); // every SKU its own
  product.sku = sku;
  return { sku, product, variations, images, ar: { name: nameAr, ...arShort.payload }, arAttributes: arAttrs };
}

// A Google Sheets link for the studio's «الاستلام» (decision 13; the owner, 28 Oct): «Publish to the web»
// (…/spreadsheets/d/e/<id>/pubhtml | pub…) or a sheet shared with anyone (…/spreadsheets/d/<id>/edit…), its tab from gid.
// → the CSV URL built from the id and the tab only (the link itself is never fetched); null for anything else.
export const SHEET_MAX_BYTES = 2_000_000;
export function sheetCsvUrl(link) {
  let u; try { u = new URL(String(link == null ? '' : link).trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port || u.username || u.password) return null;
  const raw = u.searchParams.get('gid') ?? (/(?:^#|&)gid=(\d+)/.exec(u.hash) || [])[1] ?? null;
  const gid = raw != null && /^\d{1,12}$/.test(raw) ? raw : null;
  let m = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})\/(?:pubhtml|pub)(?:\/[^?#]*)?$/.exec(u.pathname);
  if (m) return 'https://docs.google.com/spreadsheets/d/e/' + m[1] + '/pub?output=csv' + (gid ? '&gid=' + gid + '&single=true' : '');
  m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/[^?#]*)?$/.exec(u.pathname);
  if (m) return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/export?format=csv' + (gid ? '&gid=' + gid : '');
  return null;
}
// Google answers the CSV through a redirect to *.googleusercontent.com; a sheet that is neither published nor shared
// redirects to accounts.google.com (sign-in) or answers an HTML page.
const SHEET_HOST = /^(docs\.google\.com|[a-z0-9-]{1,63}\.googleusercontent\.com)$/;
/**
 * The CSV text of a Google Sheets link, with an injected fetch: redirects followed by hand (3 at most; https and Google's
 * hosts only), 20 s, SHEET_MAX_BYTES at most, an HTML answer refused.
 * → { csv } | { error: 'bad_link' | 'not_published' | 'too_big' | 'unreachable' }
 */
export async function fetchSheetCsv(link, fetchFn, { timeoutMs = 20_000, maxBytes = SHEET_MAX_BYTES } = {}) {
  let url = sheetCsvUrl(link);
  if (!url) return { error: 'bad_link' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const res = await fetchFn(url, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { accept: 'text/csv, text/plain;q=0.9' } });
      if (res.status >= 300 && res.status < 400) {
        let next = null; try { next = new URL(res.headers.get('location') || '', url); } catch { next = null; }
        if (!next || next.protocol !== 'https:' || next.port || next.username || next.password || !SHEET_HOST.test(next.hostname)) return { error: 'not_published' };
        url = next.href; continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) return { error: 'not_published' };
      if (!res.ok) return { error: 'unreachable' };
      if (/text\/html/i.test(res.headers.get('content-type') || '')) return { error: 'not_published' };
      if (Number(res.headers.get('content-length') || 0) > maxBytes) return { error: 'too_big' };
      const chunks = []; let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { try { await reader.cancel(); } catch { /* the size answers already */ } return { error: 'too_big' }; }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
      const csv = new TextDecoder('utf-8').decode(bytes);
      if (/^\s*<(!doctype|html)/i.test(csv)) return { error: 'not_published' };
      return { csv };
    }
    return { error: 'unreachable' };
  } catch {
    return { error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ the shop's styles (comments decision 51, owner 16 Nov)
// «عايزه ياخد من الاستايلات اللي موجودة علي الويب سايت بس اللي هم داخل attributes اللي اسمها style»: the list is the terms of
// the site's style attribute, one entry per style — { id, en, ar }. WPML may hand the Arabic terms back with the English read
// (and the English term itself for lang=ar), so an Arabic term never stands as its own entry when an English term owns it; a
// term with no English is still the site's (its name both ways). Same style twice (same English or same Arabic name) = once.
const AR_SCRIPT = /[؀-ۿ]/;
const termId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const trOf = (t, lang) => termId(t && t.translations && typeof t.translations === 'object' ? t.translations[lang] : null);
const styleKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {any[]} enTerms the English read  @param {any[]} arTerms the Arabic read  @param {(v: unknown) => string | null} clean a term name → the name, or null when unusable
 * @returns {{ id: number, en: string, ar: string }[]} */
export function styleTerms(enTerms, arTerms, clean) {
  const all = new Map();
  for (const t of [...(Array.isArray(enTerms) ? enTerms : []), ...(Array.isArray(arTerms) ? arTerms : [])]) {
    const id = termId(t && t.id); const name = id !== null ? clean(t.name) : null;
    if (id !== null && name && !all.has(id)) all.set(id, { id, name, en: trOf(t, 'en'), ar: trOf(t, 'ar'), arabic: AR_SCRIPT.test(name) });
  }
  // an Arabic term = Arabic script, or named as another term's Arabic translation
  const arIds = new Set([...all.values()].filter((t) => t.arabic).map((t) => t.id));
  all.forEach((t) => { if (t.ar !== null && t.ar !== t.id && all.has(t.ar)) arIds.add(t.ar); });
  const english = [...all.values()].filter((t) => !arIds.has(t.id));
  const claimed = new Set();
  const out = [];
  for (const t of english) {
    const linked = t.ar !== null && t.ar !== t.id && arIds.has(t.ar) ? all.get(t.ar) : [...all.values()].find((x) => arIds.has(x.id) && x.en === t.id) || null;
    if (linked) claimed.add(linked.id);
    out.push({ id: t.id, en: t.name, ar: linked ? linked.name : '' });
  }
  // an Arabic term no English term owns (and that names no English term on the list) is a style of its own
  const enIds = new Set(english.map((t) => t.id));
  for (const id of arIds) { const t = all.get(id); if (!claimed.has(id) && !(t.en !== null && t.en !== id && enIds.has(t.en))) out.push({ id, en: t.name, ar: t.name }); }
  const seenEn = new Set(); const seenAr = new Set();
  return out.filter((s) => {
    const e = styleKey(s.en); const a = styleKey(s.ar);
    if (seenEn.has(e) || (a && (seenAr.has(a) || seenEn.has(a))) || seenAr.has(e)) return false;
    seenEn.add(e); if (a) seenAr.add(a); return true;
  }).slice(0, 200);
}
