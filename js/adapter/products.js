// Products (phase 5): the products page reads the sync's mirror (products, woo_categories, woo_brands — 0021) and writes the
// site through woo-sync only (product_get / product_save / products_batch / products_trash / products_restore; the server checks
// products.view / edit / trash and WOO_PUSH_ENABLED). The mirror holds both WPML languages: a record is a row whose lang is not
// 'ar', or an Arabic row with no English translation; its Arabic name is the name of its translation row.
// load() runs when the page first opens (not with the sign-in: thousands of rows) and refresh(ids) after a write reads those rows
// again (the server wrote them from WooCommerce's answers); report(from, to) reads the reports tab's totals (products_report, 0022); state() is 'idle' | 'loading' | 'ready' | 'error'; every change
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
  const BATCH = 25; // the owner (28 Oct): bulk writes go 25 products a request, one request after the other, with progress
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
  let cats = new Map(); let brands = new Map(); let comm = new Map(); // comm: product id → its own Dokan commission (decision 12)

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
      const canComm = perm('sensitive.commission') === 'F';
      const [main, ar, cs, bs, pc] = await Promise.all([
        pages(() => cl.from('products').select(COLS).or('lang.is.null,lang.neq.ar').order('id', { ascending: true }), g),
        pages(() => cl.from('products').select(AR_COLS).eq('lang', 'ar').order('id', { ascending: true }), g),
        pages(() => cl.from('woo_categories').select('id, name, parent_id').order('id', { ascending: true }), g),
        pages(() => cl.from('woo_brands').select('id, name, parent_id').order('name', { ascending: true }), g),
        canComm ? pages(() => cl.from('product_commissions').select('product_id, rate, type, fee').not('rate', 'is', null).order('product_id', { ascending: true }), g) : Promise.resolve([]),
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
      comm = new Map(pc.map((x) => [Number(x.product_id), { rate: num(x.rate), type: x.type || 'percentage', fee: num(x.fee) }]));
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
  // onProgress(done, total) after every request; a request the site did not answer (woo_down / network) marks its 25 as failed
  // and the next ones still go; a refusal (forbidden / invalid) or the push gate stops there
  async function batch(updates, onProgress) {
    const out = { ok: true, result: 'ok', updated: 0, failedIds: [], reason: null };
    for (let i = 0; i < updates.length; i += BATCH) {
      const part = updates.slice(i, i + BATCH);
      const r = await invoke({ action: 'products_batch', update: part });
      if (!r.ok && (r.reason === 'woo_down' || r.reason === 'network')) { out.failedIds.push(...part.map((u) => Number(u.id))); out.reason = r.reason; }
      else if (!r.ok) return Object.assign(out, { ok: i > 0 && out.updated > 0, partial: i > 0, reason: r.reason, field: r.field || null });
      else if (r.body.result === 'skipped') return Object.assign(out, { result: 'skipped', reason: r.body.reason });
      else { out.updated += (r.body.counts && r.body.counts.updated) || 0; out.failedIds.push(...(r.body.failed_ids || [])); }
      if (onProgress) quiet(() => onProgress(Math.min(i + BATCH, updates.length), updates.length));
    }
    const ids = updates.map((u) => Number(u.id));
    logged('product.bulk', ids, [...new Set(updates.flatMap((u) => Object.keys(u).filter((k) => k !== 'id')))]);
    await refresh(ids);
    return out;
  }
  async function moveTrash(ids, back, onProgress) {
    const out = { ok: true, result: 'ok', done: 0, failedIds: [], reason: null };
    for (let i = 0; i < ids.length; i += BATCH) {
      if (i && onProgress) quiet(() => onProgress(i, ids.length));
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
  const can = () => ({ view: perm('products.view') !== 'N', edit: perm('products.edit') === 'F', bulk: perm('products.bulk') === 'F', trash: perm('products.trash') === 'F', commission: perm('sensitive.commission') === 'F' });
  // Dokan's admin commission on a product (decision 12, the owner's «Commission» column): the product's own commission when set,
  // else its store's — for a category_based store the nearest category (or ancestor) with a figure, else the store's default —
  // percentage of the sale price + the flat fee. → { amount, rate, fee, source } or null (no price / no visible rate).
  function vendorOf(id) { const V = window.IBVendors; return id && V && V.store && V.store.get ? quiet(() => V.store.get(id)) : null; }
  function commissionOf(rec) {
    const sale = rec ? (rec.sale != null ? rec.sale : rec.price) : null; if (sale == null) return null;
    const c = commissionParams(rec); if (!c) return null;
    return { amount: Math.round((sale * (c.rate || 0) / 100 + c.fee) * 100) / 100, rate: c.rate, fee: c.fee, source: c.source };
  }
  // the commission's figures without a price (decision 16: the prices are computed from the maker's price) →
  // { rate (% or null for a flat-only product commission), fee, source } or null (no visible rate / not sensitive.commission = F)
  function commissionParams(rec) {
    if (!rec || perm('sensitive.commission') !== 'F') return null;
    const own = comm.get(Number(rec.id));
    if (own && own.rate != null) return own.type === 'flat' ? { rate: null, fee: own.rate, source: 'product' } : { rate: own.rate, fee: own.fee || 0, source: 'product' };
    const v = vendorOf(rec.vendorId); if (!v || !v.ratesVisible) return null;
    let rate = rateOf(rec.vendorId); let fee = v.rateFlat || 0; let source = 'store';
    if (v.commissionType === 'category_based') {
      const byCat = new Map((v.categoryRates || []).map((c) => [Number(c.wooCategoryId), c]));
      for (const id of rec.categoryIds) {
        let cur = cats.get(Number(id)); const seen = new Set(); let hit = null;
        while (cur && !seen.has(cur.id) && !hit) { seen.add(cur.id); hit = byCat.get(Number(cur.id)) || null; cur = cur.parent_id ? cats.get(Number(cur.parent_id)) : null; }
        if (!hit && byCat.has(Number(id))) hit = byCat.get(Number(id));
        if (hit) { rate = hit.rate; fee = hit.flat || 0; source = 'category'; break; }
      }
    }
    if (rate == null) return null;
    return { rate, fee, source };
  }
  const vendorPriceOf = (rec) => { const c = commissionOf(rec); const sale = rec && (rec.sale != null ? rec.sale : rec.price); return c && sale != null ? Math.round((sale - c.amount) * 100) / 100 : null; };
  // the maker's rate today (vendor_rates, sensitive.commission) — null when it is not visible
  function rateOf(vendorId) {
    const V = window.IBVendors; const v = vendorId && V && V.store && V.store.get ? quiet(() => V.store.get(vendorId)) : null;
    if (!v || !v.ratesVisible || !V.rateAt) return null;
    const r = quiet(() => V.rateAt(v, V.today ? V.today() : new Date().toISOString().slice(0, 10)));
    return r == null || !Number.isFinite(Number(r)) ? null : Number(r);
  }

  // ---------- the reports tab (decision 20): products_report (0022) → totals only, cached per range ----------
  // report(from, to) → null while it loads (ib:products { report } when it lands) or failed (reportFailed), else
  // { orders, qty, revenue, distinct, top: [{ id, name, sku, skuCount, vendor, qty, orders, revenue }], cats: [{ id, name, sold, revenue, orders, products }] }.
  // A top row whose product is a record carries the record's name (English first) and maker; else the line's own name.
  let repCache = new Map();
  function report(from, to) {
    const key = from + '|' + to; const hit = repCache.get(key);
    if (hit && typeof hit === 'object') {
      return { orders: num(hit.orders) || 0, qty: num(hit.qty) || 0, revenue: num(hit.revenue) || 0, distinct: num(hit.distinct) || 0,
        top: (Array.isArray(hit.top) ? hit.top : []).map((t) => { const r = t.key != null && rows.has(Number(t.key)) ? get(t.key) : null; const skus = Array.isArray(t.skus) ? t.skus : [];
          return { id: r ? r.id : null, name: r ? r.nameEn || r.nameAr : t.name || '—', sku: skus[0] || (r && r.sku) || '—', skuCount: skus.length, vendor: (r ? r.vendor : vendorName(t.vendor_id)) || '—', qty: num(t.qty) || 0, orders: num(t.orders) || 0, revenue: num(t.revenue) || 0 }; }),
        cats: (Array.isArray(hit.cats) ? hit.cats : []).map((x) => ({ id: Number(x.id), name: (cats.get(Number(x.id)) || {}).name || '#' + x.id, sold: num(x.sold) || 0, revenue: num(x.revenue) || 0, orders: num(x.orders) || 0, products: num(x.products) || 0 })) };
    }
    if (hit === 'loading' || hit === 'error') return null;
    const cl = c(); if (!cl || perm('products.view') === 'N') return null;
    repCache.set(key, 'loading');
    Promise.resolve(cl.rpc('products_report', { p_from: from, p_to: to })).then(({ data, error }) => {
      repCache.set(key, error || !data || typeof data !== 'object' ? 'error' : data); emit({ report: key });
    }, () => { repCache.set(key, 'error'); emit({ report: key }); });
    return null;
  }
  const reportFailed = (from, to) => repCache.get(from + '|' + to) === 'error';
  const reportRetry = (from, to) => { repCache.delete(from + '|' + to); return report(from, to); };

  function clear() { gen++; st = 'idle'; rows = new Map(); cats = new Map(); brands = new Map(); comm = new Map(); repCache = new Map(); }

  window.IBProducts = {
    load, ensure, refresh, clear, state: () => st, list, trash, get, toRecord, can, rateOf, commissionOf, commissionParams, vendorPriceOf, STATUS, report, reportFailed, reportRetry,
    categories: () => [...cats.values()].map((x) => ({ id: Number(x.id), name: x.name, parentId: x.parent_id ? Number(x.parent_id) : null, path: catPath(x.id) })).sort((a, b) => a.path.localeCompare(b.path)),
    brands: () => [...brands.values()].map((x) => ({ id: Number(x.id), name: x.name })),
    // phase 5.2: a category the studio just made on the site (category_create) shows at once
    addCategory: (row) => { cats.set(Number(row.id), { id: Number(row.id), name: row.name, parent_id: row.parent_id || null }); emit({ categories: true }); },
    fetchLive, save, batch, trashIds: (ids, onProgress) => moveTrash(ids, false, onProgress), restore: (ids, onProgress) => moveTrash(ids, true, onProgress),
  };
})();
