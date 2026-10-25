import { test } from 'node:test'; import assert from 'node:assert/strict';
import { redact, summarizeOrder, summarizeStore, summarizeWebhook, pickSample, run } from '../../tools/woo-probe.mjs';
// tools/woo-probe.mjs offline: the pure helpers, and run() against a stub fetch (the staging site is never reached from tests).
const PII = ['Mona', 'Adel', 'Nile Co', '12 Nile St', 'Flat 3', 'mona@example.com', '01000000001', 'call after 5', '10.1.2.3', 'Mona Adel 12 Nile St', 'vendor@example.com', '01111111111', 'secret-token'];
const person = () => ({ first_name: 'Mona', last_name: 'Adel', company: 'Nile Co', address_1: '12 Nile St', address_2: 'Flat 3', city: 'Cairo', state: 'C', postcode: '11511', country: 'EG', email: 'mona@example.com', phone: '01000000001' });
const order = (id, parent_id = 0, meta = []) => ({
  id, number: String(id), status: 'processing', created_via: parent_id ? 'dokan' : 'checkout', date_created: '2026-10-20T10:00:00', date_modified: '2026-10-20T11:00:00',
  parent_id, payment_method: 'cod', payment_method_title: 'الدفع عند الاستلام', total: '250.00', currency: 'EGP', customer_id: 3,
  billing: person(), shipping: { ...person(), email: undefined }, customer_note: 'call after 5', customer_ip_address: '10.1.2.3',
  line_items: [{ id: 1, name: 'Secret Lamp', quantity: 2, total: '200.00' }, { id: 2, name: 'Rug', quantity: 1, total: '50.00' }],
  meta_data: [{ id: 9, key: '_billing_address_index', value: 'Mona Adel 12 Nile St' }, ...meta],
});
const SUB_META = [{ id: 10, key: '_dokan_vendor_id', value: '7' }, { id: 11, key: '_dokan_commission_rate', value: { a: 1 } }, { id: 12, key: '_dokan_admin_fee', value: '12.5' }, { id: 13, key: '_dokan_extra', value: [1, 2] }, { id: 14, key: 'shipping_fee_recipient', value: 'seller' }];

test('redact replaces personal fields at any depth and keeps the rest (input untouched)', () => {
  const o = order(5);
  const r = redact(o);
  assert.equal(r.billing.phone, '<redacted>');
  assert.equal(r.shipping.address_1, '<redacted>');
  assert.equal(r.customer_note, '<redacted>');
  assert.equal(r.line_items[0].quantity, 2);
  assert.equal(r.line_items[0].name, 'Secret Lamp'); // redact itself keeps names; summarizeOrder never prints line items
  assert.equal(r.id, 5);
  assert.equal(r.billing.city, 'Cairo');
  assert.equal(o.billing.phone, '01000000001');
  for (const k of ['first_name', 'last_name', 'email', 'phone', 'address_1', 'address_2', 'company']) assert.equal(r.billing[k], '<redacted>', k);
  assert.deepEqual(redact({ a: [{ note: 'x', b: { billing_email: 'y', customer_ip_address: 'z', address: { street_1: 's' } } }], n: null, q: 1 }),
    { a: [{ note: '<redacted>', b: { billing_email: '<redacted>', customer_ip_address: '<redacted>', address: '<redacted>' } }], n: null, q: 1 });
});

test('summarizeOrder keeps only the allowed keys; meta keys, billing/shipping key names, line count', () => {
  const s = summarizeOrder(order(5, 0, [{ id: 10, key: '_dokan_vendor_id', value: '7' }]));
  assert.deepEqual(Object.keys(s), ['id', 'number', 'status', 'created_via', 'date_created', 'date_modified', 'parent_id', 'payment_method', 'payment_method_title', 'total', 'currency', 'line_items_count', 'meta_keys', 'billing_keys', 'shipping_keys']);
  assert.equal(s.line_items_count, 2);
  assert.deepEqual(s.meta_keys, ['_billing_address_index', '_dokan_vendor_id']);
  assert.deepEqual(s.billing_keys, Object.keys(person()));
  assert.ok(s.shipping_keys.includes('phone'));
  for (const v of PII) assert.ok(!JSON.stringify(s).includes(v), v);
});

test('summarizeOrder on a sub-order adds dokan_meta: every _dokan* entry, objects/arrays as their type', () => {
  const s = summarizeOrder(order(6, 5, SUB_META));
  assert.equal(s.parent_id, 5);
  assert.deepEqual(s.dokan_meta, { _dokan_vendor_id: '7', _dokan_commission_rate: '<object>', _dokan_admin_fee: '12.5', _dokan_extra: '<array>' });
  assert.deepEqual(s.meta_keys, ['_billing_address_index', '_dokan_vendor_id', '_dokan_commission_rate', '_dokan_admin_fee', '_dokan_extra', 'shipping_fee_recipient']);
  assert.deepEqual(summarizeOrder({ id: 1 }), { id: 1, number: null, status: null, created_via: null, date_created: null, date_modified: null, parent_id: null, payment_method: null, payment_method_title: null, total: null, currency: null, line_items_count: 0, meta_keys: [], billing_keys: [], shipping_keys: [] });
});

test('summarizeStore and summarizeWebhook keep their fields only (webhook query strings masked)', () => {
  assert.deepEqual(summarizeStore({ id: 7, store_name: 'متجر', enabled: true, registered: '2025-01-01 10:00:00', email: 'vendor@example.com', phone: '01111111111', payment: { bank: {} } }),
    { id: 7, store_name: 'متجر', enabled: true, registered: '2025-01-01 10:00:00' });
  assert.deepEqual(summarizeWebhook({ id: 3, name: 'Order updated', topic: 'order.updated', status: 'active', delivery_url: 'https://u:p@hook.example.com/in?token=secret-token', secret: 'x' }),
    { id: 3, name: 'Order updated', topic: 'order.updated', status: 'active', delivery_url: 'https://hook.example.com/in?<redacted>' });
  assert.equal(summarizeWebhook({ delivery_url: 'https://hook.example.com/in' }).delivery_url, 'https://hook.example.com/in');
});

test('pickSample returns at most n, in order', () => {
  assert.deepEqual(pickSample([1, 2, 3, 4], 3), [1, 2, 3]);
  assert.deepEqual(pickSample([1, 2], 3), [1, 2]);
  assert.deepEqual(pickSample([], 3), []);
  assert.deepEqual(pickSample(null, 3), []);
});

// ---- run() against a stub fetch ----
const ENV = { WOO_URL: 'https://stage.example.com/', WOO_CK: 'ck_test', WOO_CS: 'cs_test' };
const json = (body, { status = 200, total, pages } = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(total != null && { 'x-wp-total': String(total) }), ...(pages != null && { 'x-wp-totalpages': String(pages) }) } });
const PAGE1 = [order(12), order(11, 10, SUB_META), order(10, 0, [{ id: 1, key: 'has_sub_order', value: '1' }]), order(9), order(8), order(7)];
const PAGE2 = [order(6, 5, SUB_META), order(5), order(4, 3, SUB_META), order(3, 2, SUB_META)];
function stubFetch(overrides = {}) {
  const calls = [];
  const routes = {
    'wc/v3/reports/orders/totals': () => json([{ slug: 'processing', name: 'قيد التنفيذ', total: 4 }, { slug: 'ready-for-shipping', name: 'جاهز للشحن', total: 2 }]),
    'wc/v3/orders?per_page=1': () => json([{ id: 12 }], { total: 57, pages: 57 }),
    'wc/v3/orders?per_page=20': (u) => json(u.searchParams.get('page') === '2' ? PAGE2 : PAGE1, { total: 26, pages: 2 }),
    'dokan/v1/stores': () => json([{ id: 7, store_name: 'متجر', enabled: true, registered: '2025-01-01 10:00:00', email: 'vendor@example.com', phone: '01111111111' }], { total: 1, pages: 1 }),
    'wc/v3/products': () => json([{ id: 1 }], { total: 140, pages: 140 }),
    'wc/v3/webhooks': () => json([{ id: 3, name: 'sync', topic: 'order.updated', status: 'active', delivery_url: 'https://hook.example.com/in?token=secret-token' }], { total: 1, pages: 1 }),
    ...overrides,
  };
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    const path = u.pathname.replace(/^\/wp-json\//, '');
    const key = Object.keys(routes).find((k) => { const [p, q] = k.split('?'); return p === path && (!q || u.search.includes(q)); });
    if (!key) throw new Error('unexpected request ' + url);
    return routes[key](u);
  };
  return { fetch, calls };
}
async function probe(env = ENV, overrides) {
  const out = [], err = []; const { fetch, calls } = stubFetch(overrides);
  const code = await run({ env, fetch, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out, err, calls, parsed: out.map((l) => ({ section: l.slice(0, l.indexOf(' ')), data: JSON.parse(l.slice(l.indexOf(' ') + 1)) })) };
}

test('run prints the seven sections, one JSON line each, with no personal data, over Basic auth', async () => {
  const { code, out, err, calls, parsed } = await probe();
  assert.equal(code, 0); assert.deepEqual(err, []);
  assert.deepEqual(parsed.map((p) => p.section), ['statuses', 'orders_since', 'parents_sample', 'subs_sample', 'stores', 'products_total', 'webhooks']);
  for (const l of out) { assert.ok(!l.includes('\n')); for (const v of PII) assert.ok(!l.includes(v), v + ' leaked in: ' + l); }
  const by = Object.fromEntries(parsed.map((p) => [p.section, p.data]));
  assert.deepEqual(by.statuses.items[1], { slug: 'ready-for-shipping', name: 'جاهز للشحن', total: 2 });
  assert.deepEqual(by.orders_since, { after: '2026-10-01T00:00:00', total: 57 });
  assert.deepEqual(by.parents_sample.items.map((o) => o.id), [12, 10, 9]);
  assert.deepEqual(by.subs_sample.items.map((o) => o.id), [11, 6, 4]); // page 1 had one sub-order, so page 2 was read
  assert.equal(by.subs_sample.scanned, 10); assert.equal(by.subs_sample.found, 4);
  assert.equal(by.subs_sample.items[0].dokan_meta._dokan_vendor_id, '7');
  assert.ok(!('dokan_meta' in by.parents_sample.items[0]));
  assert.deepEqual(by.stores, { total: 1, count: 1, items: [{ id: 7, store_name: 'متجر', enabled: true, registered: '2025-01-01 10:00:00' }] });
  assert.deepEqual(by.products_total, { total: 140 });
  assert.equal(by.webhooks.items[0].delivery_url, 'https://hook.example.com/in?<redacted>');
  const auth = 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64');
  for (const c of calls) { assert.equal(c.init.headers.Authorization, auth); assert.match(c.url, /^https:\/\/stage\.example\.com\/wp-json\/(wc\/v3|dokan\/v1)\//); assert.ok(!c.url.includes('ck_test') && !c.url.includes('cs_test')); assert.ok(!c.init.method || c.init.method === 'GET'); }
  const urls = calls.map((c) => new URL(c.url));
  const since = urls.find((u) => u.searchParams.get('per_page') === '1' && u.pathname.endsWith('/orders'));
  assert.equal(since.searchParams.get('after'), '2026-10-01T00:00:00');
  assert.equal(urls.filter((u) => u.searchParams.get('per_page') === '20').length, 2);
  assert.ok(urls.every((u) => !u.searchParams.has('parent')));
  assert.equal(urls.find((u) => u.pathname.endsWith('/stores')).searchParams.get('per_page'), '100');
  assert.equal(urls.find((u) => u.pathname.endsWith('/webhooks')).searchParams.get('per_page'), '50');
});

test('run reads one page only when it already holds 3 sub-orders', async () => {
  const page = [order(12), order(11, 10, SUB_META), order(10), order(9, 8, SUB_META), order(8), order(7, 6, SUB_META)];
  const { code, calls, parsed } = await probe(ENV, { 'wc/v3/orders?per_page=20': () => json(page, { total: 40, pages: 2 }) });
  assert.equal(code, 0);
  assert.equal(calls.filter((c) => c.url.includes('per_page=20')).length, 1);
  assert.deepEqual(parsed.find((p) => p.section === 'subs_sample').data.items.map((o) => o.id), [11, 9, 7]);
});

test('a non-2xx prints ERROR {section, status, body ≤200}, the other sections still run, exit 1', async () => {
  const long = { code: 'woocommerce_rest_cannot_view', message: 'x'.repeat(300), data: { status: 401, email: 'mona@example.com' } };
  const { code, out, parsed } = await probe(ENV, { 'dokan/v1/stores': () => json(long, { status: 401 }), 'wc/v3/products': () => new Response('<html>Bad Gateway</html>', { status: 502 }) });
  assert.equal(code, 1);
  assert.deepEqual(parsed.map((p) => p.section), ['statuses', 'orders_since', 'parents_sample', 'subs_sample', 'ERROR', 'ERROR', 'webhooks']);
  const [e1, e2] = parsed.filter((p) => p.section === 'ERROR').map((p) => p.data);
  assert.equal(e1.section, 'stores'); assert.equal(e1.status, 401); assert.ok(e1.body.length <= 200); assert.match(e1.body, /woocommerce_rest_cannot_view/);
  assert.deepEqual(e2, { section: 'products_total', status: 502, body: '<html>Bad Gateway</html>' });
  for (const l of out) assert.ok(!l.includes('mona@example.com'));
});

test('a failing orders page errors both sample sections; a thrown fetch is status 0', async () => {
  const { code, parsed } = await probe(ENV, { 'wc/v3/orders?per_page=20': () => json({ code: 'x' }, { status: 500 }), 'wc/v3/webhooks': () => { throw new TypeError('fetch failed'); } });
  assert.equal(code, 1);
  const errs = parsed.filter((p) => p.section === 'ERROR').map((p) => p.data);
  assert.deepEqual(errs.map((e) => [e.section, e.status]), [['parents_sample', 500], ['subs_sample', 500], ['webhooks', 0]]);
  assert.match(errs[2].body, /fetch failed/);
});

test('missing or non-https env exits 2 before any request', async () => {
  for (const env of [{}, { ...ENV, WOO_CS: '' }, { ...ENV, WOO_URL: 'http://stage.example.com' }, { ...ENV, WOO_URL: 'not a url' }]) {
    const { code, out, err, calls } = await probe(env);
    assert.equal(code, 2); assert.deepEqual(out, []); assert.equal(calls.length, 0); assert.equal(err.length, 1);
    assert.ok(!err[0].includes('cs_test') && !err[0].includes('ck_test'));
  }
  assert.match((await probe({ WOO_URL: 'https://x.example.com' })).err[0], /WOO_CK, WOO_CS/);
});

test('importing the module makes no request', async () => {
  const real = globalThis.fetch; let hit = 0;
  globalThis.fetch = async () => { hit++; throw new Error('network at import'); };
  try { await import('../../tools/woo-probe.mjs?fresh=1'); } finally { globalThis.fetch = real; }
  assert.equal(hit, 0);
});
