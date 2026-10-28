// Products (phase 5): the products page reads the sync's mirror (products, woo_categories, woo_brands — 0021) and writes the
// site through woo-sync only (product_get / product_save / products_batch / products_trash / products_restore; the server checks
// products.view / edit / trash and WOO_PUSH_ENABLED). The mirror holds both WPML languages: a record is a row whose lang is not
// 'ar', or an Arabic row with no English translation; its Arabic name is the name of its translation row.
// load() runs when the page first opens (not with the sign-in: thousands of rows) and refresh(ids) after a write reads those rows
// again (the server wrote them from WooCommerce's answers); state() is 'idle' | 'loading' | 'ready' | 'error'; every change
// dispatches ib:products. Records are handed out in the page's shape (toRecord, pure but for the names of the makers):
//   { id, nameEn, nameAr, arId, sku, img, imageCount, vendorId, vendor, brandIds, brands, categoryIds, cats, type, status,
//     wooStatus, sale, regular, price, stock, manageStock, onDemand, alert, stockStatus, sales, weight, descFilled, shortDescFilled,
//     featured, permalink, trashedAt, modified }
// The writes return Promises of { ok, result, reason, … } and never throw: reason 'forbidden' (401), 'invalid' (400, with the
// refused field), 'no_translation' (409), 'woo_down' (502), 'network'; result 'skipped' with reason 'push_disabled' when the
// site is not written yet (staging switch). Every write the site took is logged through IBActivity.log as product.save /
// product.bulk / product.trash / product.restore with the product ids and the field names (never a price or a text).
(function () {
  'use strict';
  const PAGE = 1000; // PostgREST max_rows
  const BATCH = 100; // woo-sync's products_batch / products_trash limit
  const COLS = 'id, sku, name, image_url, vendor_id, price, status, permalink, lang, translation_ids, type, regular_price, sale_price, stock_quantity, stock_status, manage_stock, backorders, low_stock_amount, total_sales, category_ids, brand_ids, image_count, weight, featured, desc_filled, short_desc_filled, woo_modified_at, trashed_at';
  const AR_COLS = 'id, name, translation_ids';
  const STATUS = { publish: 'منشور', draft: 'مسودة', pending: 'قيد المراجعة', private: 'خاص', trash: 'المهملات' };
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const emit = (detail) => quiet(() => document.dispatchEvent(new CustomEvent('ib:products', { detail: detail || {} })));
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');

  let st = 'idle'; let gen = 0;
  let rows = new Map(); // id → mirror row (every language)
  let cats = new Map(); let brands = new Map();

  // ---------- rows → the page's shape ----------
  const vendorName = (id) => { const V = window.IBVendors; const v = id && V && V.store && V.store.get ? quiet(() => V.store.get(id)) : null; return v ? v.name : ''; };
  function catPath(id) {
    const out = []; let cur = cats.get(Number(id)); const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur.name); cur = cur.parent_id ? cats.get(Number(cur.parent_id)) : null; }
    return out.join(' › ');
  }
  const onDemandOf = (r) => r.stock_status === 'onbackorder' || (!!r.manage_stock && !!r.backorders && r.backorders !== 'no');
  const arOf = (r) => { const t = r.translation_ids && typeof r.translation_ids === 'object' ? Number(r.translation_ids.ar) : NaN; return Number.isInteger(t) && t !== Number(r.id) ? t : null; };
  const enOf = (r) => { const t = r.translation_ids && typeof r.translation_ids === 'object' ? Number(r.translation_ids.en) : NaN; return Number.isInteger(t) && t !== Number(r.id) ? t : null; };
  function toRecord(r) {
    const arId = arOf(r); const ar = arId ? rows.get(arId) : null;
    const isAr = r.lang === 'ar';
    const type = r.type === 'variable' ? 'Variable' : r.type === 'simple' ? 'Simple' : r.type || '—';
    return {
      id: Number(r.id), nameEn: isAr ? '' : r.name || '', nameAr: isAr ? r.name || '' : ar ? ar.name || '' : '', arId: isAr ? Number(r.id) : arId, sku: r.sku || '',
      img: r.image_url || '', imageCount: num(r.image_count) || 0, vendorId: r.vendor_id || null, vendor: vendorName(r.vendor_id),
      brandIds: Array.isArray(r.brand_ids) ? r.brand_ids.map(Number) : [], brands: (r.brand_ids || []).map((b) => (brands.get(Number(b)) || {}).name).filter(Boolean),
      categoryIds: Array.isArray(r.category_ids) ? r.category_ids.map(Number) : [], cats: (r.category_ids || []).map(catPath).filter(Boolean),
      type, status: STATUS[r.status] || r.status || '—', wooStatus: r.status || '', sale: num(r.sale_price) != null ? num(r.sale_price) : num(r.price), regular: num(r.regular_price), price: num(r.price),
      stock: r.manage_stock ? num(r.stock_quantity) : null, manageStock: !!r.manage_stock, onDemand: onDemandOf(r), alert: num(r.low_stock_amount), stockStatus: r.stock_status || '',
      sales: num(r.total_sales) || 0, weight: r.weight || '', descFilled: !!r.desc_filled, shortDescFilled: !!r.short_desc_filled, featured: !!r.featured,
      permalink: r.permalink || '', trashedAt: r.trashed_at || '', modified: r.woo_modified_at || '', lang: r.lang || '',
    };
  }
  const isRecord = (r) => r.lang !== 'ar' || !enOf(r) || !rows.has(enOf(r));
  const list = () => [...rows.values()].filter((r) => r.status !== 'trash' && isRecord(r)).map(toRecord);
  const trash = () => [...rows.values()].filter((r) => r.status === 'trash' && isRecord(r)).map(toRecord);
  const get = (id) => { const r = rows.get(Number(id)); return r ? toRecord(r) : null; };

  // ---------- load ----------
  async function pages(build, g) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      if (g !== gen) throw new Error('stale');
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
  async function load() {
    const cl = c(); if (!cl) return;
    if (perm('products.view') === 'N') { st = 'ready'; emit(); return; } // the page's own permission (decision 3)
    const g = ++gen; st = 'loading'; emit();
    try {
      const [main, ar, cs, bs] = await Promise.all([
        pages(() => cl.from('products').select(COLS).or('lang.is.null,lang.neq.ar').order('id', { ascending: true }), g),
        pages(() => cl.from('products').select(AR_COLS).eq('lang', 'ar').order('id', { ascending: true }), g),
        pages(() => cl.from('woo_categories').select('id, name, parent_id').order('id', { ascending: true }), g),
        pages(() => cl.from('woo_brands').select('id, name, parent_id').order('name', { ascending: true }), g),
      ]);
      if (g !== gen) return;
      const next = new Map();
      main.forEach((r) => next.set(Number(r.id), r));
      ar.forEach((r) => next.set(Number(r.id), Object.assign({ lang: 'ar' }, r)));
      // an Arabic product with no English row is a record of its own: read its full row
      const lone = ar.filter((r) => { const en = enOf(r); return !en || !next.has(en); }).map((r) => Number(r.id));
      for (let i = 0; i < lone.length; i += 200) {
        const { data, error } = await cl.from('products').select(COLS).in('id', lone.slice(i, i + 200));
        if (error) throw error;
        (data || []).forEach((r) => next.set(Number(r.id), r));
      }
      rows = next;
      cats = new Map(cs.map((x) => [Number(x.id), x]));
      brands = new Map(bs.map((x) => [Number(x.id), x]));
      st = 'ready';
    } catch (e) { if (g === gen) st = 'error'; }
    if (g === gen) emit();
  }
  const ensure = () => { if (st === 'idle' || st === 'error') load(); };

  // the rows of these products and their translations again (after a write: the server wrote them from WooCommerce's answer)
  async function refresh(ids) {
    const cl = c(); if (!cl || !ids.length) return;
    const all = [...new Set(ids.flatMap((id) => { const r = rows.get(Number(id)); const ar = r ? arOf(r) : null; return ar ? [Number(id), ar] : [Number(id)]; }))];
    try {
      for (let i = 0; i < all.length; i += 200) {
        const { data, error } = await cl.from('products').select(COLS).in('id', all.slice(i, i + 200));
        if (error) return;
        (data || []).forEach((r) => rows.set(Number(r.id), r));
      }
    } catch (e) { return; }
    emit({ ids });
  }

  // ---------- writes (woo-sync) ----------
  async function invoke(body) {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    try {
      const { data, error } = await cl.functions.invoke('woo-sync', { body });
      if (error || !data) {
        const s = error && error.context && error.context.status;
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const reason = s === 401 || s === 403 ? 'forbidden' : s === 400 ? 'invalid' : s === 409 ? 'no_translation' : s === 502 ? 'woo_down' : 'network';
        return { ok: false, reason, field: b && b.field ? String(b.field) : null, error: b && b.error ? String(b.error) : null };
      }
      return { ok: true, body: data };
    } catch (e) { return { ok: false, reason: 'network' }; }
  }
  const logged = (action, ids, fields) => {
    const L = window.IBActivity; if (!L || !L.log) return;
    const list = ids.slice(0, 20).map((x) => '#' + x).join(' ') + (ids.length > 20 ? ' +' + (ids.length - 20) : '');
    quiet(() => L.log(action, [list, (fields || []).join(', ')].filter(Boolean).join(' · '), { entity: 'products', entity_id: ids.length === 1 ? String(ids[0]) : null }));
  };

  async function fetchLive(id) {
    const r = await invoke({ action: 'product_get', id: Number(id) });
    if (!r.ok) return r;
    refresh([Number(id)]);
    return { ok: true, product: r.body.product, ar: r.body.ar || null, variations: Array.isArray(r.body.variations) ? r.body.variations : [] };
  }
  async function save(id, change) {
    const body = { action: 'product_save', id: Number(id), fields: change.fields || {} };
    if (change.ar && Object.keys(change.ar).length) body.ar = change.ar;
    if (change.variations && change.variations.length) body.variations = change.variations;
    const r = await invoke(body);
    if (!r.ok) return r;
    if (r.body.result === 'ok') { logged('product.save', [Number(id)], Object.keys(body.fields).concat(body.ar ? Object.keys(body.ar).map((k) => 'ar.' + k) : [], body.variations ? ['variations'] : [])); await refresh([Number(id)]); }
    return { ok: true, result: r.body.result, reason: r.body.reason || null, counts: r.body.counts || {} };
  }
  async function batch(updates) {
    const out = { ok: true, result: 'ok', updated: 0, failedIds: [], reason: null };
    for (let i = 0; i < updates.length; i += BATCH) {
      const part = updates.slice(i, i + BATCH);
      const r = await invoke({ action: 'products_batch', update: part });
      if (!r.ok) return Object.assign(out, { ok: false, reason: r.reason, field: r.field || null });
      if (r.body.result === 'skipped') return Object.assign(out, { result: 'skipped', reason: r.body.reason });
      out.updated += (r.body.counts && r.body.counts.updated) || 0;
      out.failedIds.push(...(r.body.failed_ids || []));
    }
    const ids = updates.map((u) => Number(u.id));
    logged('product.bulk', ids, [...new Set(updates.flatMap((u) => Object.keys(u).filter((k) => k !== 'id')))]);
    await refresh(ids);
    return out;
  }
  async function moveTrash(ids, back) {
    const out = { ok: true, result: 'ok', done: 0, failedIds: [], reason: null };
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await invoke({ action: back ? 'products_restore' : 'products_trash', ids: ids.slice(i, i + BATCH).map(Number) });
      if (!r.ok) return Object.assign(out, { ok: false, reason: r.reason });
      if (r.body.result === 'skipped') return Object.assign(out, { result: 'skipped', reason: r.body.reason });
      out.done += (r.body.counts && r.body.counts.done) || 0;
      out.failedIds.push(...(r.body.failed_ids || []));
    }
    logged(back ? 'product.restore' : 'product.trash', ids.map(Number), []);
    await refresh(ids.map(Number));
    return out;
  }

  // ---------- who may ----------
  const can = () => ({ view: perm('products.view') !== 'N', edit: perm('products.edit') === 'F', trash: perm('products.trash') === 'F', commission: perm('sensitive.commission') === 'F' });
  // the maker's rate today (vendor_rates, sensitive.commission) — null when it is not visible
  function rateOf(vendorId) {
    const V = window.IBVendors; const v = vendorId && V && V.store && V.store.get ? quiet(() => V.store.get(vendorId)) : null;
    if (!v || !v.ratesVisible || !V.rateAt) return null;
    const r = quiet(() => V.rateAt(v, V.today ? V.today() : new Date().toISOString().slice(0, 10)));
    return r == null || !Number.isFinite(Number(r)) ? null : Number(r);
  }

  function clear() { gen++; st = 'idle'; rows = new Map(); cats = new Map(); brands = new Map(); }

  window.IBProducts = {
    load, ensure, refresh, clear, state: () => st, list, trash, get, toRecord, can, rateOf, STATUS,
    categories: () => [...cats.values()].map((x) => ({ id: Number(x.id), name: x.name, parentId: x.parent_id ? Number(x.parent_id) : null, path: catPath(x.id) })).sort((a, b) => a.path.localeCompare(b.path)),
    brands: () => [...brands.values()].map((x) => ({ id: Number(x.id), name: x.name })),
    fetchLive, save, batch, trashIds: (ids) => moveTrash(ids, false), restore: (ids) => moveTrash(ids, true),
  };
})();
