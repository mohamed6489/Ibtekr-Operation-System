// What a member may change on a WooCommerce product (phase 5, plan decision 5), as pure functions shared by woo-sync's
// product actions and the node tests. Every field outside these lists is refused (400 before any call to the site);
// prices and quantities are numbers ≥ 0, a sale price above the regular one is refused, and a description carrying a
// script, a frame, an event handler or a javascript: link is refused.

// the product itself (product_save)
export const EDIT_FIELDS = ['name', 'sku', 'status', 'regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status',
  'backorders', 'low_stock_amount', 'categories', 'brands', 'images', 'weight', 'short_description', 'description', 'featured'];
// the Arabic translation (WPML): its own name and descriptions
export const AR_FIELDS = ['name', 'short_description', 'description'];
// written on the translation too (WPML syncs them; writing the same value twice is harmless): status, prices, stock
export const SHARED_FIELDS = ['status', 'regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders', 'low_stock_amount'];
// the bulk bar (products_batch)
export const BATCH_FIELDS = [...SHARED_FIELDS, 'categories', 'brands'];
// an existing variation (price and stock only: no variation is added or removed here)
export const VARIATION_FIELDS = ['regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders'];

export const STATUSES = ['publish', 'draft', 'pending'];
const STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'];
const BACKORDERS = ['no', 'notify', 'yes'];
const UNSAFE_HTML = /<\s*\/?\s*(script|iframe|object|embed|style|form)\b|\son[a-z]+\s*=|javascript\s*:/i;
const MAX_PRICE = 10_000_000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const posId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && String(v).trim() !== '' ? Number(v) : null);
const price = (v) => {
  if (v === '' || v === null) return '';
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d{1,2})?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? String(Math.round(n * 100) / 100) : undefined;
};
const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) && Number(v) <= max ? Number(v) : undefined);
const ids = (v, max) => (Array.isArray(v) && v.length <= max && v.every((x) => posId(x) !== null) ? [...new Set(v.map(posId))].map((id) => ({ id })) : undefined);
const text = (v, max) => (typeof v === 'string' && v.length <= max && !UNSAFE_HTML.test(v) ? v : undefined);

const CHECK = {
  name: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 200 ? v.trim() : undefined),
  sku: (v) => (typeof v === 'string' && v.trim().length <= 100 && !/[<>]/.test(v) ? v.trim() : undefined),
  status: (v) => (STATUSES.includes(v) ? v : undefined),
  regular_price: price,
  sale_price: price,
  manage_stock: (v) => (typeof v === 'boolean' ? v : undefined),
  stock_quantity: (v) => int(v, 1_000_000),
  stock_status: (v) => (STOCK_STATUSES.includes(v) ? v : undefined),
  backorders: (v) => (BACKORDERS.includes(v) ? v : undefined),
  low_stock_amount: (v) => (v === null ? null : int(v, 5)),
  categories: (v) => ids(v, 20),
  brands: (v) => ids(v, 5),
  images: (v) => ids(v, 30),
  weight: (v) => (v === '' ? '' : typeof v === 'string' && /^\s*\d{1,5}(\.\d{1,3})?\s*$/.test(v) ? v.trim() : undefined),
  short_description: (v) => text(v, 5000),
  description: (v) => text(v, 50000),
  featured: (v) => (typeof v === 'boolean' ? v : undefined),
};

/**
 * fields (an object from the body) → { payload } with the allowed, cleaned values, or { error: 'bad_field', field }.
 * An empty object is { payload: {} }. A sale price above the regular price (both given) → { error: 'sale_above_regular' }.
 * @returns {{ payload: Record<string, any>, error: string | null, field: string | null }}
 */
export function cleanFields(fields, allowed) {
  const refuse = (error, field) => ({ payload: {}, error, field });
  if (!isObj(fields)) return refuse('bad_field', null);
  const payload = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k) || !CHECK[k]) return refuse('bad_field', k);
    const out = CHECK[k](v);
    if (out === undefined) return refuse('bad_field', k);
    payload[k] = out;
  }
  if (payload.sale_price && payload.regular_price !== undefined && payload.regular_price !== '' && Number(payload.sale_price) > Number(payload.regular_price)) {
    return refuse('sale_above_regular', 'sale_price');
  }
  return { payload, error: null, field: null };
}

/** The shared fields of a payload (what the Arabic translation gets too). */
export const sharedOf = (payload) => Object.fromEntries(Object.entries(payload).filter(([k]) => SHARED_FIELDS.includes(k)));

const pickStr = (v) => (typeof v === 'string' ? v : '');
const terms = (list) => (Array.isArray(list) ? list.filter(isObj).map((t) => ({ id: posId(t.id), name: pickStr(t.name) })).filter((t) => t.id !== null) : []);

/** A wc/v3/products answer → what the edit page reads (an allow-list: no meta_data, no store address, no purchase note). */
export function editView(p) {
  if (!isObj(p)) return null;
  return {
    id: posId(p.id), name: pickStr(p.name), sku: pickStr(p.sku), status: pickStr(p.status), type: pickStr(p.type), lang: pickStr(p.lang),
    translations: isObj(p.translations) ? Object.fromEntries(Object.entries(p.translations).filter(([k, v]) => /^[a-z]{2}$/.test(k) && posId(v) !== null).map(([k, v]) => [k, posId(v)])) : {},
    permalink: pickStr(p.permalink).startsWith('https://') ? p.permalink : '',
    regular_price: pickStr(p.regular_price), sale_price: pickStr(p.sale_price), price: pickStr(p.price),
    manage_stock: p.manage_stock === true, stock_quantity: Number.isInteger(p.stock_quantity) ? p.stock_quantity : null, stock_status: pickStr(p.stock_status),
    backorders: pickStr(p.backorders), low_stock_amount: Number.isInteger(p.low_stock_amount) ? p.low_stock_amount : null,
    total_sales: Number.isFinite(Number(p.total_sales)) ? Number(p.total_sales) : 0, weight: pickStr(p.weight), featured: p.featured === true,
    categories: terms(p.categories), brands: terms(p.brands),
    images: Array.isArray(p.images) ? p.images.filter(isObj).map((i) => ({ id: posId(i.id), src: pickStr(i.src).startsWith('https://') ? i.src : '', name: pickStr(i.name) })).filter((i) => i.id !== null) : [],
    short_description: pickStr(p.short_description), description: pickStr(p.description), modified: pickStr(p.date_modified_gmt),
    store: isObj(p.store) ? { id: posId(p.store.id), shop_name: pickStr(p.store.shop_name) } : null,
  };
}

/** A wc/v3/products/{id}/variations item → the edit page's row (attributes as «name: option», price and stock). */
export function variationView(v) {
  if (!isObj(v)) return null;
  return {
    id: posId(v.id), sku: pickStr(v.sku),
    attributes: Array.isArray(v.attributes) ? v.attributes.filter(isObj).map((a) => ({ name: pickStr(a.name), option: pickStr(a.option) })) : [],
    regular_price: pickStr(v.regular_price), sale_price: pickStr(v.sale_price), price: pickStr(v.price),
    manage_stock: v.manage_stock === true, stock_quantity: Number.isInteger(v.stock_quantity) ? v.stock_quantity : null,
    stock_status: pickStr(v.stock_status), backorders: pickStr(v.backorders),
    image: isObj(v.image) && pickStr(v.image.src).startsWith('https://') ? v.image.src : '',
  };
}
