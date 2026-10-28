// What a member may change on a WooCommerce product (phase 5, plan decision 5), as pure functions shared by woo-sync's
// product actions and the node tests. Every field outside these lists is refused (400 before any call to the site);
// prices and quantities are numbers ≥ 0, a sale price above the regular one is refused, a name carries no `<` / `>`, and a
// description holds the allowed tags only (SAFE_TAG).

// the product itself (product_save)
export const EDIT_FIELDS = ['name', 'sku', 'status', 'regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status',
  'backorders', 'low_stock_amount', 'categories', 'brands', 'images', 'weight', 'short_description', 'description', 'featured', 'seo_title', 'seo_description'];
// the Arabic translation (WPML): its own name, descriptions and SEO
export const AR_FIELDS = ['name', 'short_description', 'description', 'seo_title', 'seo_description'];
// phase 5.1 (the SEO tab): the page title / description are Rank Math's own meta on the product (each language its own post);
// '' = Rank Math's default template. Plain text only. The only meta a member can write.
export const SEO_META = { seo_title: 'rank_math_title', seo_description: 'rank_math_description' };
// written on the translation too (WPML syncs them; writing the same value twice is harmless): status, prices, stock
export const SHARED_FIELDS = ['status', 'regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders', 'low_stock_amount'];
// the bulk bar (products_batch)
export const BATCH_FIELDS = [...SHARED_FIELDS, 'categories', 'brands'];
// an existing variation (price and stock only: no variation is added or removed here)
export const VARIATION_FIELDS = ['regular_price', 'sale_price', 'manage_stock', 'stock_quantity', 'stock_status', 'backorders'];

export const STATUSES = ['publish', 'draft', 'pending'];
const STOCK_STATUSES = ['instock', 'outofstock', 'onbackorder'];
const BACKORDERS = ['no', 'notify', 'yes'];
// A description may carry plain formatting tags with no attribute at all, and links whose only attribute is an https href;
// any other `<` (another tag, an attribute, a comment, an unclosed tag) refuses the text — an allow-list, not a blocklist:
// the API user can post unfiltered HTML, so nothing else reaches the shop's pages (security review, 28 Oct).
const SAFE_TAG = /<\/?(p|br|strong|b|em|i|u|ul|ol|li|h2|h3|h4|h5|span|div|blockquote|table|thead|tbody|tr|td|th)\s*\/?>|<a href="https:\/\/[^"<>\s]+">|<\/a>/gi;
const safeHtml = (v) => !v.replace(SAFE_TAG, '').includes('<');
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
const text = (v, max) => (typeof v === 'string' && v.length <= max && safeHtml(v) ? v : undefined);
// Rank Math expands %var% / %var(arg)% in the title and description on the public page, and some read any post meta
// (%customfield(_wc_cog_cost)%): only these plain variables pass; any other %…% with no space inside refuses the text.
export const SEO_VARS = ['title', 'sep', 'sitename', 'sitedesc', 'excerpt', 'primary_category', 'category', 'wc_price', 'wc_sku', 'wc_brand', 'currentyear', 'currentmonth'];
export const seoVarsOk = (v) => [...v.matchAll(/%([^\s%]+)%/g)].every((m) => SEO_VARS.includes(m[1]));
const plain = (v, max) => (typeof v === 'string' && v.trim().length <= max && !/[<>]/.test(v) ? v.trim() : undefined);
const seo = (v, max) => { const out = plain(v, max); return out !== undefined && seoVarsOk(out) ? out : undefined; };

const CHECK = {
  name: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 200 && !/[<>]/.test(v) ? v.trim() : undefined),
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
  seo_title: (v) => seo(v, 200),
  seo_description: (v) => seo(v, 500),
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

/** A cleaned payload as WooCommerce takes it: the SEO fields become their Rank Math meta_data entries. */
export function toWoo(payload) {
  const out = {}; const meta = [];
  for (const [k, v] of Object.entries(payload)) { if (SEO_META[k]) meta.push({ key: SEO_META[k], value: v }); else out[k] = v; }
  if (meta.length) out.meta_data = meta;
  return out;
}

/** The shared fields of a payload (what the Arabic translation gets too). */
export const sharedOf = (payload) => Object.fromEntries(Object.entries(payload).filter(([k]) => SHARED_FIELDS.includes(k)));

const pickStr = (v) => (typeof v === 'string' ? v : '');
const terms = (list) => (Array.isArray(list) ? list.filter(isObj).map((t) => ({ id: posId(t.id), name: pickStr(t.name) })).filter((t) => t.id !== null) : []);

const metaStr = (p, key) => { const m = (Array.isArray(p.meta_data) ? p.meta_data : []).find((x) => isObj(x) && x.key === key); return m && typeof m.value === 'string' ? m.value : ''; };

/** A wc/v3/products answer → what the edit page reads (an allow-list: of meta_data only the two SEO keys, no store address, no purchase note). */
export function editView(p) {
  if (!isObj(p)) return null;
  return {
    seo_title: metaStr(p, SEO_META.seo_title), seo_description: metaStr(p, SEO_META.seo_description),
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
