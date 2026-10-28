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

/**
 * item + { batchId, type, brand, colors: { CODE: 'Name EN' }, attrs: { color, size, material, style, brand } (ids or null) }
 * → { error, field } | { sku, product, variations: [{ sku, payload, image }], images: [path…], ar: { name, short_description } | null }
 */
export function buildStudio(item, o) {
  const bad = (field) => ({ error: 'bad_field', field });
  if (!isObj(item) || !isObj(o)) return bad('item');
  const type = o.type === 'Variable' ? 'Variable' : o.type === 'Simple' ? 'Simple' : null;
  if (!type) return bad('type');
  if (!brandCode(o.brand)) return bad('brand');
  const name = plain(item.nameEn, 200); if (!name) return bad('nameEn');
  const nameAr = item.nameAr == null || item.nameAr === '' ? null : plain(item.nameAr, 200); if (item.nameAr && !nameAr) return bad('nameAr');
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
    categories: Array.isArray(item.categories) ? item.categories : [] }, ['name', 'short_description', 'weight', 'categories']);
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

  const product = { ...base.payload, type: type === 'Variable' ? 'variable' : 'simple', status: 'draft', attributes: attrs, wpml_language: 'en' };
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
  return { sku, product, variations, images, ar: nameAr ? { name: nameAr, ...arShort.payload } : null };
}
