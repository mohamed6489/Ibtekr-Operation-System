import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// products.js (phase 5) against a stub IBSupabase: the mirror read by language (records = not Arabic, or Arabic without an English
// row; the Arabic name from the translation), the category paths and brands, the writes through woo-sync (bodies, reasons,
// skipped), the refresh of the written rows, the activity rows (ids and field names only), the permissions.
const src = readFileSync(new URL('../../app/js/adapter/products.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const V1 = 'a0000000-0000-4000-8000-000000000001';
const ok = (data) => ({ data, error: null });
const EN = { id: 501, sku: 'IBTK-1', name: 'Lamp', image_url: 'https://x/a.jpg', vendor_id: V1, price: '1200', status: 'publish', permalink: 'https://x/p/501', lang: 'en', translation_ids: { ar: 601, en: 501 },
  type: 'simple', regular_price: '1500', sale_price: '1200', stock_quantity: 4, stock_status: 'instock', manage_stock: true, backorders: 'no', low_stock_amount: 2, total_sales: 9,
  category_ids: [16], brand_ids: [3], image_count: 5, weight: '1.2', featured: false, desc_filled: true, short_desc_filled: false, woo_modified_at: '2026-10-20T08:00:00Z', trashed_at: null };
const DRAFT = { ...EN, id: 502, name: 'Vase', status: 'draft', translation_ids: { en: 502 }, type: 'variable', manage_stock: false, stock_quantity: null, stock_status: 'onbackorder', sale_price: null, price: '300' };
const TRASHED = { ...EN, id: 503, name: 'Old', status: 'trash', translation_ids: null, trashed_at: '2026-10-21T09:00:00Z' };
const AR = [{ id: 601, name: 'لمبة', translation_ids: { ar: 601, en: 501 } }, { id: 700, name: 'منتج عربي بس', translation_ids: { ar: 700 } }];
const AR_ONLY = { ...EN, id: 700, name: 'منتج عربي بس', lang: 'ar', translation_ids: { ar: 700 }, category_ids: [], brand_ids: [] };
function load({ responses = {}, perms = { 'products.view': 'F', 'products.edit': 'F', 'products.trash': 'N' } } = {}) {
  const stub = stubClient({ responses: {
    products: (q) => (q.some((c) => c.op === 'or') ? ok([EN, DRAFT, TRASHED]) : q.some((c) => c.op === 'eq' && c.args[1] === 'ar') ? ok(AR) : q.some((c) => c.op === 'in') ? ok([EN, AR_ONLY].filter((r) => q.find((c) => c.op === 'in').args[1].includes(r.id))) : ok([])),
    woo_categories: ok([{ id: 15, name: 'ديكور', parent_id: null }, { id: 16, name: 'إضاءة', parent_id: 15 }]), woo_brands: ok([{ id: 3, name: 'Lusso', parent_id: null }]), ...responses } });
  const events = []; const logs = [];
  const window = { IBSupabase: { client: stub.client }, IBDirectory: { perm: (k) => perms[k] || 'N' },
    IBActivity: { log: (action, detail, meta) => { logs.push([action, detail, meta]); return Promise.resolve(); } },
    IBVendors: { store: { get: (id) => (id === V1 ? { id: V1, name: 'Art Craft', ratesVisible: true, rateHistory: [{ since: '2026-01-01', rate: 25 }] } : null) }, rateAt: (v, d) => v.rateHistory[0].rate, today: () => '2026-10-28' } };
  runInNewContext(src, { window, document: { dispatchEvent(e) { events.push(e.type); } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, Promise, Date, Number, String, Array, Object, JSON, Map, Set, Error });
  return { P: window.IBProducts, stub, events, logs };
}

test('load: the non-Arabic rows (named columns, no raw), the Arabic names, the Arabic-only products in full; records + trash in the page shape', async () => {
  const { P, stub, events } = load();
  await P.load();
  assert.equal(P.state(), 'ready');
  const sel = opsOf(stub.calls, 'products').filter((c) => c.op === 'select').map((c) => c.args[0]);
  assert.ok(sel.every((s) => !s.includes('raw') && s !== '*'));
  const list = plain(P.list());
  assert.deepEqual(list.map((r) => [r.id, r.nameEn, r.nameAr, r.status]), [[501, 'Lamp', 'لمبة', 'منشور'], [502, 'Vase', '', 'مسودة'], [700, '', 'منتج عربي بس', 'منشور']]);
  const lamp = list[0];
  assert.deepEqual([lamp.cats, lamp.brands, lamp.sale, lamp.regular, lamp.stock, lamp.onDemand, lamp.alert, lamp.sales, lamp.vendor, lamp.imageCount, lamp.type, lamp.arId],
    [['ديكور › إضاءة'], ['Lusso'], 1200, 1500, 4, false, 2, 9, 'Art Craft', 5, 'Simple', 601]);
  assert.deepEqual([list[1].stock, list[1].onDemand, list[1].sale, list[1].type], [null, true, 300, 'Variable']);
  assert.deepEqual(plain(P.trash()).map((r) => [r.id, r.status]), [[503, 'المهملات']]);
  assert.deepEqual(plain(P.categories()).map((c) => c.path), ['ديكور', 'ديكور › إضاءة']);
  assert.ok(events.includes('ib:products'));
});

test('no products.view: nothing read (orders.view alone is the orders screen\'s)', async () => {
  const { P, stub } = load({ perms: { 'orders.view': 'F' } });
  await P.load();
  assert.equal(stub.calls.filter((c) => c.op === 'from').length, 0);
  assert.deepEqual(plain(P.list()), []);
});

test('save: the product_save body (fields, ar, variations), logged with field names only, the row and its translation read again', async () => {
  const { P, stub, logs } = load({ responses: { 'fn:woo-sync': (o) => ({ data: { action: o.body.action, result: 'ok', counts: { saved: 2 } }, error: null }) } });
  await P.load();
  const r = await P.save(501, { fields: { regular_price: '1600' }, ar: { name: 'لمبة 2' }, variations: [] });
  assert.deepEqual(plain(r), { ok: true, result: 'ok', reason: null, counts: { saved: 2 } });
  const inv = stub.calls.filter((c) => c.op === 'invoke').at(-1).args;
  assert.deepEqual(inv, ['woo-sync', { body: { action: 'product_save', id: 501, fields: { regular_price: '1600' }, ar: { name: 'لمبة 2' } } }]);
  assert.deepEqual(logs.at(-1).slice(0, 2), ['product.save', '#501 · regular_price, ar.name']);
  assert.ok(!JSON.stringify(logs).includes('1600'));
  const last = opsOf(stub.calls, 'products').filter((c) => c.op === 'in').at(-1).args;
  assert.deepEqual(last, ['id', [501, 601]]);
});

test('the reasons: 401 forbidden, 400 invalid with the field, 409 no_translation, 502 woo_down; skipped push_disabled is not logged', async () => {
  const err = (status, body) => ({ data: null, error: { context: { status, json: async () => body } } });
  for (const [status, body, reason] of [[401, null, 'forbidden'], [400, { error: 'bad_field', field: 'sale_price' }, 'invalid'], [409, { error: 'no_translation' }, 'no_translation'], [502, null, 'woo_down']]) {
    const { P } = load({ responses: { 'fn:woo-sync': err(status, body) } });
    const r = await P.save(501, { fields: { sale_price: '1' } });
    assert.equal(r.reason, reason); assert.equal(r.ok, false);
    if (status === 400) assert.equal(r.field, 'sale_price');
  }
  const { P, logs } = load({ responses: { 'fn:woo-sync': ok({ result: 'skipped', reason: 'push_disabled' }) } });
  const r = await P.batch([{ id: 501, status: 'draft' }]);
  assert.deepEqual([r.ok, r.result, r.reason], [true, 'skipped', 'push_disabled']);
  assert.equal(logs.length, 0);
});

test('batch / trash / restore: 25 a request one after the other with progress, failed ids collected, one activity row with the ids', async () => {
  const { P, stub, logs } = load({ responses: { 'fn:woo-sync': (o) => ({ data: { result: 'ok', counts: { updated: o.body.update ? o.body.update.length - 1 : 0, done: o.body.ids ? o.body.ids.length : 0 }, failed_ids: o.body.update ? [o.body.update[0].id] : [] }, error: null }) } });
  const updates = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, status: 'publish' }));
  const progress = [];
  const r = await P.batch(updates, (done, total) => progress.push(done + '/' + total));
  assert.deepEqual(plain([r.updated, r.failedIds]), [144, [1, 26, 51, 76, 101, 126]]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').map((c) => c.args[1].body.update.length), [25, 25, 25, 25, 25, 25]);
  assert.deepEqual(progress, ['25/150', '50/150', '75/150', '100/150', '125/150', '150/150']);
  assert.equal(logs.at(-1)[0], 'product.bulk');
  const t = await P.trashIds([501, 502]);
  assert.deepEqual([t.ok, t.done], [true, 2]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'products_trash', ids: [501, 502] });
  await P.restore([503]);
  assert.deepEqual(stub.calls.filter((c) => c.op === 'invoke').at(-1).args[1].body, { action: 'products_restore', ids: [503] });
  assert.deepEqual(logs.slice(-2).map((l) => [l[0], l[1]]), [['product.trash', '#501 #502'], ['product.restore', '#503']]);
});

test('can + rateOf: products.edit / bulk / trash = F only; the maker rate when the rates are visible', async () => {
  const { P } = load({ perms: { 'products.view': 'P', 'products.edit': 'P', 'products.bulk': 'F', 'products.trash': 'F', 'sensitive.commission': 'F' } });
  assert.deepEqual(plain(P.can()), { view: true, edit: false, bulk: true, trash: true, commission: true });
  assert.equal(P.rateOf(V1), 25);
  assert.equal(P.rateOf('other'), null);
});

test('commission (the owner\'s «Commission» column): the product\'s own Dokan commission, else the store\'s rate; vendor price = sale − commission; nothing without sensitive.commission', async () => {
  const perms = { 'products.view': 'F', 'sensitive.commission': 'F' };
  const { P, stub } = load({ perms, responses: { product_commissions: { data: [{ product_id: 502, rate: 20, type: 'percentage', fee: 10 }], error: null } } });
  await P.load();
  assert.deepEqual(opsOf(stub.calls, 'product_commissions')[0], { op: 'select', args: ['product_id, rate, type, fee'] });
  const lamp = P.get(501); // store rate 25% (rateAt in the stub), no own commission
  assert.deepEqual(plain(P.commissionOf(lamp)), { amount: 300, rate: 25, fee: 0, source: 'store' });
  assert.equal(P.vendorPriceOf(lamp), 900);
  const vase = P.get(502); // its own 20% + 10 on 300
  assert.deepEqual(plain(P.commissionOf(vase)), { amount: 70, rate: 20, fee: 10, source: 'product' });
  assert.equal(P.vendorPriceOf(vase), 230);
  // decision 16: the figures without a price (the prices are computed from the maker's price)
  assert.deepEqual(plain(P.commissionParams(lamp)), { rate: 25, fee: 0, source: 'store' });
  assert.deepEqual(plain(P.commissionParams(vase)), { rate: 20, fee: 10, source: 'product' });
  assert.deepEqual(plain(P.commissionParams(Object.assign({}, lamp, { sale: null, price: null }))), { rate: 25, fee: 0, source: 'store' });
  const { P: P2, stub: s2 } = load({ perms: { 'products.view': 'F' } });
  await P2.load();
  assert.equal(s2.calls.filter((c) => c.table === 'product_commissions').length, 0);
  assert.equal(P2.commissionOf(P2.get(501)), null);
  assert.equal(P2.commissionParams(P2.get(501)), null);
});
