// The store layer (docs/superpowers/plans/2026-11-17-stores-single.md — the owner 17 Nov: «لو فصلتوا من ووكوميرس اقدر اربطوا ب شوبيفاي او
// ايزياوردر … عشان يباع لناس تانيين»). One store platform at a time, and how the business sells:
//   settings row «store» = { platform: 'woo' | 'shopify' | 'easyorders', mode: 'marketplace' | 'single', dokan: bool, margin: % }
//   - marketplace = WooCommerce + Dokan (makers, sub-orders, Dokan accounts) — the default, as the system has always worked;
//   - single      = one seller (a factory or a brand owner): no makers, no sub-orders — forced for any platform without Dokan.
// caps(platform, mode) say what the store can do, so a page hides what it cannot instead of a button that fails. The page's copy is
// app/js/adapter/settings.js (STORE_* / storeOf) — tests/functions/store.test.mjs compares them. Pure.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const PLATFORMS = ['woo', 'shopify', 'easyorders'];
/** the platforms the system can run on today (the others are listed, not offered) */
export const READY = ['woo'];
export const MODES = ['marketplace', 'single'];
export const MARGIN_DEFAULT = 30;

/** What each platform can do (before the mode): the WooCommerce shop as built (WPML, Rank Math, Brands, Dokan); Shopify and EasyOrders sell for one seller. */
export const CAPS = {
  woo: { vendors: true, suborders: true, translations: true, seo: true, brands: true, media: true, carts: true, categories: true, variations: true, statusWrite: true, productWrite: true, studio: true },
  shopify: { vendors: false, suborders: false, translations: false, seo: true, brands: true, media: true, carts: false, categories: true, variations: true, statusWrite: true, productWrite: true, studio: true },
  easyorders: { vendors: false, suborders: false, translations: false, seo: false, brands: false, media: true, carts: false, categories: true, variations: true, statusWrite: true, productWrite: true, studio: true },
};

/** The row «store» (or null) → { platform, mode, dokan, margin, caps } — unknown values fall back to how the system works today. */
export function storeOf(row) {
  const r = isObj(row) ? row : {};
  const platform = PLATFORMS.includes(r.platform) ? r.platform : 'woo';
  const dokan = platform === 'woo' && r.dokan !== false && r.dokan !== 'false';
  const mode = dokan && r.mode !== 'single' ? 'marketplace' : 'single';
  const m = r.margin; // a JSON number only (as store_cfg in 0127)
  const margin = typeof m === 'number' && Number.isFinite(m) && m >= 0 && m <= 500 ? Math.round(m * 100) / 100 : MARGIN_DEFAULT;
  const caps = { ...CAPS[platform] };
  if (mode === 'single') { caps.vendors = false; caps.suborders = false; }
  return { platform, mode, dokan, margin, caps };
}
/** storeOf is idempotent: the row or its result. */
export const isSingle = (store) => storeOf(store).mode === 'single';

/** The row from the database (service client): { platform, … } — no row = WooCommerce + Dokan. */
export async function readStore(db) {
  try { const { data } = await db.from('settings').select('data').eq('section', 'store').maybeSingle(); return storeOf(data && data.data); }
  catch (_e) { return storeOf(null); }
}

/** woo-sync / woo-webhook talk to WooCommerce only while it is the store; the actions that never reach the store stay open. */
export const STORE_FREE_ACTIONS = ['thumbs', 'studio_sheet'];
export const wooActive = (store) => storeOf(store).platform === 'woo';
/** single-seller mode: woo-sync skips what is Dokan's alone (its stores, sub-orders, balances and withdrawals, a product's maker). */
export const SINGLE_OFF_ACTIONS = ['vendors', 'push_vendor', 'probe_dokan', 'accounts', 'statement', 'withdraw_approve', 'withdraw_create', 'withdrawals',
  'suborder_trash', 'suborder_status', 'vendor_photo', 'vendor_store', 'vendor_delete', 'products_vendor'];
