// woo-studio: the product studio's upload (phase 5.2, docs/superpowers/plans/2026-10-28-phase-5-2-studio.md) as pure
// functions shared by woo-sync's studio_upload and the node tests. A batch item (studio_batches.state.items[i], written by
// the page) is checked field by field and turned into the WooCommerce payloads: the product (draft, English), its
// variations, the image paths in the bucket `studio` and the Arabic translation's own fields. Anything outside the
// allow-list refuses the item (400 before any call to the site). No backslash-u escapes in this file: the deploy tool rewrites them into the characters.
import { cleanFields } from './woo-products.js';

// the global attributes the studio fills (decision 5), looked up by slug on the site
export const STUDIO_ATTRS = { color: 'pa_color', size: 'pa_size', material: 'pa_material', style: 'pa_style', brand: 'pa_brand' };
export const MAX_IMAGES = 6;
export const MAX_VARIATIONS = 100;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plain = (v, max) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max && !/[<>%]/.test(v) ? v.trim() : null);
const asciiDigits = (s) => String(s == null ? '' : s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));

// The SKU (the owner, 28 Oct; decision 2): IBT + the brand's first two letters + the color code + the serial (4 digits at
// least) + «-size digits» for a variation with a size. The page's products-domain.js studioSku is the same rule.
export const brandCode = (name) => { const l = String(name || '').toUpperCase().replace(/[^A-Z]/g, ''); return l.length >= 2 ? l.slice(0, 2) : null; };
export const sizeDigits = (s) => asciiDigits(s).replace(/[^\d]+/g, '');
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
// or more than one → null: the product goes up with the pa_brand attribute only and the report says so.
const brandKey = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const slugKey = (s) => { try { return brandKey(decodeURIComponent(String(s == null ? '' : s))); } catch { return brandKey(s); } };
export function matchWooBrand(brand, wooBrands) {
  const keys = new Set([brand?.name, ...(Array.isArray(brand?.aliases) ? brand.aliases : [])].map(brandKey).filter(Boolean));
  const ids = new Set((Array.isArray(wooBrands) ? wooBrands : []).filter((w) => isObj(w) && Number.isInteger(Number(w.id)) && Number(w.id) > 0
    && (keys.has(brandKey(w.name)) || keys.has(slugKey(w.slug)))).map((w) => Number(w.id)));
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * item + { batchId, type, brand, wooBrand (the site's WooCommerce brand id or null), colors: { CODE: 'Name EN' },
 *   attrs: { color, size, material, style, brand } (ids or null) }
 * → { error, field } | { sku, product, variations: [{ sku, payload, image }], images: [path…], ar: { name, short_description? } } (the Arabic name is required, decision 15)
 */
export function buildStudio(item, o) {
  const bad = (field) => ({ error: 'bad_field', field });
  if (!isObj(item) || !isObj(o)) return bad('item');
  const type = o.type === 'Variable' ? 'Variable' : o.type === 'Simple' ? 'Simple' : null;
  if (!type) return bad('type');
  if (!brandCode(o.brand)) return bad('brand');
  const name = plain(item.nameEn, 200); if (!name) return bad('nameEn');
  const nameAr = plain(item.nameAr, 200); if (!nameAr) return bad('nameAr'); // decision 15: every product gets its Arabic translation
  if (!Number.isInteger(item.serial) || item.serial < 0 || item.serial > 99999999) return bad('serial');
  const colors = Array.isArray(item.colors) ? item.colors : [];
  if (colors.length > 30 || !colors.every((c) => typeof c === 'string' && o.colors && typeof o.colors[c] === 'string')) return bad('colors');
  const sizes = Array.isArray(item.sizes) ? item.sizes.map((s) => plain(s, 30)) : [];
  if (sizes.length > 30 || sizes.some((s) => !s)) return bad('sizes');
  const material = item.material ? plain(item.material, 80) : null; if (item.material && !material) return bad('material');
  const style = item.style ? plain(item.style, 80) : null; if (item.style && !style) return bad('style');
  const pathRe = new RegExp('^' + String(o.batchId).replace(/[^0-9a-f-]/gi, '') + '/[A-Za-z0-9._-]{1,120}\\.(webp|png|jpe?g)$');
  const images = Array.isArray(item.images) ? item.images : [];
  if (images.length > MAX_IMAGES || !images.every((p) => typeof p === 'string' && pathRe.test(p))) return bad('images');
  const base = cleanFields({ name, ...(item.shortDesc ? { short_description: item.shortDesc } : {}), ...(item.weight ? { weight: String(item.weight) } : {}),
    categories: Array.isArray(item.categories) ? item.categories : [], ...(o.wooBrand != null ? { brands: [o.wooBrand] } : {}) }, ['name', 'short_description', 'weight', 'categories', 'brands']);
  if (base.error) return bad(base.field);
  const arShort = item.shortDescAr ? cleanFields({ short_description: item.shortDescAr }, ['short_description']) : { payload: {} };
  if (arShort.error) return bad('shortDescAr');

  const attrs = [];
  const add = (id, options, variation) => { if (Number.isInteger(id) && options.length) attrs.push({ id, visible: true, variation, options }); };
  const colorNames = colors.map((c) => o.colors[c]);
  const at = o.attrs || {};
  if (type === 'Simple') {
    if (colors.length > 1 || sizes.length > 1) return bad('variations');
    add(at.color, colorNames, false); add(at.size, sizes, false);
  } else {
    if (!colors.length && !sizes.length) return bad('variations');
    add(at.color, colorNames, colors.length > 0); add(at.size, sizes, sizes.length > 0);
  }
  add(at.material, material ? [material] : [], false); add(at.style, style ? [style] : [], false); add(at.brand, [String(o.brand).trim()], false);

  const product = { ...base.payload, type: type === 'Variable' ? 'variable' : 'simple', status: 'draft', attributes: attrs, lang: 'en', wpml_language: 'en' };
  const variations = [];
  let sku;
  if (type === 'Simple') {
    sku = studioSku({ brand: o.brand, color: colors[0] || null, serial: item.serial });
    const price = cleanFields({ regular_price: item.regular, sale_price: item.sale }, ['regular_price', 'sale_price']); if (price.error || !price.payload.sale_price) return bad('price');
    const stock = stockOf(item); if (!stock) return bad('stock');
    Object.assign(product, price.payload, stock);
  } else {
    sku = studioSku({ brand: o.brand, serial: item.serial });
    const vars = Array.isArray(item.variations) ? item.variations : [];
    if (!vars.length || vars.length > MAX_VARIATIONS) return bad('variations');
    const seen = new Set();
    for (const v of vars) {
      if (!isObj(v)) return bad('variations');
      const color = v.color == null ? null : v.color; const size = v.size == null ? null : plain(v.size, 30);
      if ((colors.length ? !colors.includes(color) : color !== null) || (sizes.length ? !sizes.includes(size) : size !== null)) return bad('variations');
      const key = (color || '') + '|' + (size || ''); if (seen.has(key)) return bad('variations'); seen.add(key);
      const price = cleanFields({ regular_price: v.regular, sale_price: v.sale }, ['regular_price', 'sale_price']); if (price.error || !price.payload.sale_price) return bad('variations.price');
      const stock = stockOf(v); if (!stock) return bad('variations.stock');
      const image = v.image == null ? null : typeof v.image === 'string' && pathRe.test(v.image) ? v.image : undefined; if (image === undefined) return bad('variations.image');
      const vsku = studioSku({ brand: o.brand, color, serial: item.serial, size: sizes.length ? size : null });
      variations.push({ sku: vsku, image, payload: { sku: vsku, ...price.payload, ...stock,
        attributes: [color && Number.isInteger(at.color) ? { id: at.color, option: o.colors[color] } : null, size && Number.isInteger(at.size) ? { id: at.size, option: size } : null].filter(Boolean) } });
    }
  }
  if (!sku) return bad('sku');
  product.sku = sku;
  return { sku, product, variations, images, ar: { name: nameAr, ...arShort.payload } };
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
