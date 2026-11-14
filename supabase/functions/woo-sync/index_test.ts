// deno-lint-ignore-file no-explicit-any
// woo-sync handler tests: fake Woo fetch + in-memory Supabase clients (service and per-member) from ../_test/fakes.ts.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { cairoDate } from '../_shared/woo-write.js';
import { bankDigest } from '../_shared/woo-core.js';
import { ConfigError, wooApi } from '../_shared/woo-api.js';
import { ENV, NOW, PHONE, STATUS_MAP, WC_AUTH, fakeDb, fakeWoo, vendorId, vendorRow, wooOrder, wooProduct, wooStore, wooStoreFull, wooSub, writtenText } from '../_test/fakes.ts';

const SYNC_SECRET = 'sync-test-secret';
const OURS = `${ENV.SUPABASE_URL}/functions/v1/woo-webhook`;
// Member tokens → what has_perm('orders.status') / is_admin() answer for them, plus (phase 3.3) has_perm('vendors.edit') /
// has_perm('sensitive.commission') for push_vendor: ops = vendors.edit P, vf = vendors follow-up (vendors.edit F, commission N),
// acct = accounts (nothing). (the last three answer "truthy" values that are not the exact true / 'F' the function requires).
const MEMBERS: Record<string, { perm: unknown; admin: unknown; view?: unknown; edit?: unknown; commission?: unknown; bank?: unknown; accounts?: unknown; approve?: unknown; pview?: unknown; pedit?: unknown; pbulk?: unknown; ptrash?: unknown; padd?: unknown; iedit?: unknown }> = {
  'jwt-admin': { perm: 'F', admin: true }, 'jwt-ops': { perm: 'F', admin: false, edit: 'P' }, 'jwt-acct': { perm: 'P', admin: false, edit: 'N', accounts: 'P' },
  'jwt-vf': { perm: 'N', admin: false, edit: 'F', commission: 'N' },
  'jwt-bank': { perm: 'N', admin: false, edit: 'N', bank: 'F' }, // phase 3.5: accounts — sensitive.vendor_bank = F, vendors.edit = N
  'jwt-approver': { perm: 'N', admin: false, accounts: 'F', approve: 'F' }, // phase 4.1: accounts.approve = F
  // phase 5: products.view P (reads a product live), products.edit F, products.trash F
  'jwt-pview': { perm: 'N', admin: false, pview: 'P' }, 'jwt-pedit': { perm: 'N', admin: false, pview: 'F', pedit: 'F', pbulk: 'F' }, 'jwt-pone': { perm: 'N', admin: false, pview: 'F', pedit: 'F' },
  'jwt-ptrash': { perm: 'N', admin: false, pview: 'F', ptrash: 'F' },
  'jwt-padd': { perm: 'N', admin: false, pview: 'F', padd: 'F' }, // phase 5.2: products.add = F (the studio)
  'jwt-inv': { perm: 'N', admin: false, iedit: 'F', pedit: 'F' }, // phase 7: ops — inventory.edit = F and products.edit = F
  'jwt-invonly': { perm: 'N', admin: false, iedit: 'F' }, // inventory.edit = F without products.edit: never pushes
  'jwt-admin-text': { perm: 'f', admin: 'true' }, 'jwt-admin-one': { perm: 'F ', admin: 1 },
  'jwt-noview': { perm: 'F', admin: false, view: 'N' }, // phase 5.5 decision 10: orders.status F without orders.view — never deletes
};

type Opts = { seed?: Record<string, any[]>; routes?: Record<string, any>; env?: Record<string, string>; secretAnswer?: (ok: boolean) => unknown; fail?: (c: any) => any; storage?: Record<string, Uint8Array>; rpc?: Record<string, (args: any) => unknown> };
function setup({ seed = {}, routes = {}, env = {}, secretAnswer = (ok) => ok, fail, storage, rpc = {} }: Opts = {}) {
  const db = fakeDb({ status_map: STATUS_MAP, vendors: [vendorRow(44), vendorRow(2376)], ...seed }, {
    rpc: { sync_secret_matches: ({ candidate }: any) => secretAnswer(candidate === SYNC_SECRET), ...rpc }, fail, storage,
  });
  const woo = fakeWoo(routes);
  const members: any[] = [];
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    const client = fakeDb({}, { rpc: m ? { sku_serial_take: () => 1234, has_perm: ({ key }: any) => (key === 'orders.status' ? m.perm : key === 'orders.view' ? m.view ?? (m.perm === 'F' || m.perm === 'P' ? 'F' : 'N') : key === 'vendors.edit' ? m.edit ?? 'N' : key === 'sensitive.commission' ? m.commission ?? 'N' : key === 'sensitive.vendor_bank' ? m.bank ?? 'N' : key === 'accounts.view' ? m.accounts ?? 'N' : key === 'accounts.approve' ? m.approve ?? 'N' : key === 'products.view' ? m.pview ?? 'N' : key === 'products.edit' ? m.pedit ?? 'N' : key === 'products.bulk' ? m.pbulk ?? 'N' : key === 'products.trash' ? m.ptrash ?? 'N' : key === 'products.add' ? m.padd ?? 'N' : key === 'inventory.edit' ? m.iedit ?? 'N' : 'N'), is_admin: () => m.admin } : {} });
    members.push({ jwt, client });
    return client;
  };
  return { db, woo, members, deps: { env: { ...ENV, ...env }, fetch: woo.fetch, db, now: () => NOW, userDb, userId: async (jwt: string) => (MEMBERS[jwt] ? 'uid-' + jwt : null) } };
}

async function call(deps: any, body: unknown, auth: { secret?: string; jwt?: string } = { secret: SYNC_SECRET }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.secret) headers['x-sync-secret'] = auth.secret;
  if (auth.jwt) headers.authorization = `Bearer ${auth.jwt}`;
  const res = await handler(new Request('https://fn.test/woo-sync', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), deps);
  return { res, body: await res.json() };
}

const PUSH_ON = { WOO_PUSH_ENABLED: '1' };
const pushSeed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاهز للشحن', woo_status: 'processing', placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' }] };
const page = (items: any[], totalPages = 1) => ({ body: items, headers: { 'X-WP-Total': String(items.length), 'X-WP-TotalPages': String(totalPages) } });
// wc/v3/data/countries/EG as WooCommerce answers it (the site's own codes; names made up for the tests).
const STATES = 'GET wc/v3/data/countries/EG';
const CATS = 'GET wc/v3/products/categories';
// products: the default language, then lang=ar, then the trash (phase 5)
const ALL_PATHS = ['wc/v3/data/countries/EG', 'wc/v3/products/categories', 'wc/v3/products/brands', 'dokan/v1/stores', 'wc/v3/orders', 'wc/v3/products', 'wc/v3/products', 'wc/v3/products'];
const country = (states: unknown) => ({ body: { code: 'EG', name: 'Egypt', states, _links: { self: [{ href: 'https://woo.test/wp-json/wc/v3/data/countries/eg' }] } } });
const single = (id: number, vendor: number, modified: string) =>
  wooOrder({ id, number: String(id), date_modified_gmt: modified, meta_data: [{ key: '_dokan_vendor_id', value: String(vendor) }],
    line_items: [{ id: id * 10, product_id: 9, name: 'x', quantity: 1, total: '10', meta_data: [] }] });

// ---------------------------------------------------------------- auth

Deno.test('no credentials → 401 and nothing read or written', async () => {
  const { db, woo, deps } = setup();
  const { res, body } = await call(deps, { action: 'orders' }, {});
  assertEquals(res.status, 401);
  assertEquals(body, { error: 'unauthorized' });
  assertEquals(db.calls.length + woo.calls.length, 0);
});

Deno.test('a wrong X-Sync-Secret → 401 (checked with rpc sync_secret_matches({ candidate }))', async () => {
  const { db, woo, deps } = setup();
  const { res } = await call(deps, { action: 'orders' }, { secret: 'nope' });
  assertEquals(res.status, 401);
  assertEquals(db.calls.map((c: any) => [c.op, c.name, c.args]), [['rpc', 'sync_secret_matches', { candidate: 'nope' }]]);
  assertEquals(woo.calls.length, 0);
});

Deno.test('a sync action by a member who is not admin → 401; push_status by a member with orders.status = P → 401, nothing pushed', async () => {
  const { db, woo, members, deps } = setup({ seed: { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', placed_at: '2026-10-20T10:00:00Z' }] } });
  assertEquals((await call(deps, { action: 'all' }, { jwt: 'jwt-ops' })).res.status, 401);
  assertEquals(members[0].client.calls.map((c: any) => c.name), ['is_admin']);
  const { res } = await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { jwt: 'jwt-acct' });
  assertEquals(res.status, 401);
  assertEquals(members[1].client.calls.map((c: any) => [c.name, c.args]), [['has_perm', { key: 'orders.status' }]]);
  assertEquals(woo.calls.length, 0);
  assertEquals(db.writes().length, 0);
});

Deno.test('only an exact true / \'F\' authorizes: sync_secret_matches or is_admin answering "true" or 1, has_perm \'f\' or \'F \' → 401', async () => {
  for (const answer of ['true', 1]) {
    const { woo, deps } = setup({ secretAnswer: (ok) => (ok ? answer : false) });
    assertEquals((await call(deps, { action: 'orders' })).res.status, 401);
    assertEquals(woo.calls.length, 0);
  }
  const { woo, deps } = setup({ seed: pushSeed });
  for (const jwt of ['jwt-admin-text', 'jwt-admin-one']) {
    assertEquals((await call(deps, { action: 'orders' }, { jwt })).res.status, 401);
    assertEquals((await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { jwt })).res.status, 401);
  }
  assertEquals(woo.calls.length, 0);
});

Deno.test('an unknown token → 401; an unknown action by an admin → 400; a body that is not JSON → 400', async () => {
  const { deps } = setup();
  assertEquals((await call(deps, { action: 'orders' }, { jwt: 'jwt-unknown' })).res.status, 401);
  const { res, body } = await call(deps, { action: 'drop_everything' }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body], [400, { error: 'unknown_action' }]);
  assertEquals((await call(deps, 'not json', { jwt: 'jwt-admin' })).res.status, 400);
});

Deno.test('OPTIONS → CORS preflight for the browser (functions.invoke), no database call', async () => {
  const { db, deps } = setup();
  const res = await handler(new Request('https://fn.test/woo-sync', { method: 'OPTIONS' }), deps as any);
  assert(res.ok);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  assert(/authorization/.test(res.headers.get('access-control-allow-headers') ?? ''));
  await res.body?.cancel();
  assertEquals(db.calls.length, 0);
});

// ---------------------------------------------------------------- orders

Deno.test('the right X-Sync-Secret → system mode: orders pulled with the exact params, parents + sub-orders written, cursor saved', async () => {
  const items = [wooOrder(), wooSub(2001, 1001, 44), wooSub(2002, 1001, 2376), wooOrder({ id: 1003, status: 'checkout-draft' }), single(1002, 44, '2026-10-21T09:30:00')];
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/orders': page(items) } });
  const { res, body } = await call(deps, { action: 'orders' });
  assertEquals(res.status, 200);
  assertEquals([body.action, body.result], ['orders', 'ok']);
  assertEquals(body.counts.orders, { orders: 2, sub_orders: 2, skipped: 1, conflicts: 0, failed: 0, pages: 1, done: true });

  assertEquals(woo.calls.length, 1);
  assertEquals(woo.calls[0].query, { after: '2026-10-01T00:00:00', dates_are_gmt: 'true', orderby: 'modified', order: 'asc', status: 'any', per_page: '100', page: '1' });
  assertEquals(woo.calls[0].headers.authorization, WC_AUTH);
  assertEquals(db.rows('orders').map((o: any) => o.id), [1001, 1002]);
  assertEquals(db.rows('sub_orders').map((s: any) => s.woo_order_id), [2001, 2002]);
  assertEquals(db.row('order_items', 1).sub_order_id, db.row('sub_orders', 2001, 'woo_order_id').id);
  assertEquals(db.row('sync_state', 'orders', 'key').value, { cursor: '2026-10-21T09:29:00Z', last_run: NOW, count: 5, pages: 1, done: true });
  const log = db.rows('woo_sync_log').find((r: any) => r.entity === 'orders')!;
  assertEquals([log.kind, log.direction, log.action, log.result], ['cron', 'in', 'sync', 'ok']);
  assertFalse(writtenText(db).includes(PHONE));
});

Deno.test('the next run asks only for orders modified after the saved cursor', async () => {
  const { woo, deps } = setup({ seed: { sync_state: [{ key: 'orders', value: { cursor: '2026-10-21T09:29:00Z' } }] }, routes: { 'GET wc/v3/orders': page([]) } });
  await call(deps, { action: 'orders' });
  assertEquals(woo.calls[0].query.modified_after, '2026-10-21T09:29:00Z');
});

Deno.test('pagination: a full page asks for the next one, X-WP-TotalPages ends the run', async () => {
  const many = Array.from({ length: 100 }, (_, i) => single(5000 + i, 44, `2026-10-21T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`));
  const rest = [single(6000, 44, '2026-10-22T08:00:00'), single(6001, 2376, '2026-10-22T08:00:01')];
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/orders': (c: any) => (c.query.page === '1' ? page(many, 2) : page(rest, 2)) } });
  const { body } = await call(deps, { action: 'orders' });
  assertEquals(woo.calls.map((c) => c.query.page), ['1', '2']);
  assertEquals(db.rows('orders').length, 102);
  assertEquals(body.counts.orders.pages, 2);
  assertEquals(db.row('sync_state', 'orders', 'key').value.cursor, '2026-10-22T07:59:01Z');
});

Deno.test('at most 50 pages per run: the run stops, keeps its cursor and says done = false', async () => {
  const pageOf = (n: number) => Array.from({ length: 100 }, (_, i) => single(7000 + i, 44, `2026-10-${String(1 + Math.floor(n / 3)).padStart(2, '0')}T0${n % 3}:00:${String(i % 60).padStart(2, '0')}`));
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/orders': (c: any) => page(pageOf(Number(c.query.page)), 999) } });
  const { body } = await call(deps, { action: 'orders' });
  assertEquals(woo.calls.length, 50);
  assertEquals([body.counts.orders.pages, body.counts.orders.done], [50, false]);
  const state = db.row('sync_state', 'orders', 'key').value;
  assertEquals([state.pages, state.done, state.count, state.cursor], [50, false, 5000, '2026-10-17T01:59:59Z']);
});

Deno.test('a Dokan network error → the orders are written without a maker; the store is asked once per run (one error row) and again on the next run', async () => {
  const many = Array.from({ length: 100 }, (_, i) => single(5000 + i, 777, '2026-10-21T10:00:00'));
  const routes = {
    'GET wc/v3/orders': (c: any) => (c.query.page === '1' ? page(many, 2) : page([single(6000, 777, '2026-10-22T08:00:00')], 2)),
    'GET dokan/v1/stores/777': { error: new TypeError(`error sending request for url (https://woo.test/wp-json/dokan/v1/stores/777) ${PHONE}`) },
  };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'orders' });
  assertEquals([res.status, body.result], [200, 'ok']);
  const storeCalls = () => woo.calls.filter((c) => c.path === 'dokan/v1/stores/777').length;
  const vendorRows = () => db.rows('woo_sync_log').filter((r: any) => r.entity === 'vendor').map((r: any) => [r.kind, r.entity_id, r.result]);
  assertEquals([storeCalls(), vendorRows()], [1, [['sync', '777', 'error']]], '101 orders over two pages, one attempt');
  assertEquals(db.rows('orders').length, 101);
  assert(db.rows('order_items').every((i: any) => i.vendor_id === null));
  assertFalse(writtenText(db).includes(PHONE));
  await call(deps, { action: 'orders' });
  assertEquals(storeCalls(), 2, 'the next run asks again');
});

Deno.test('a sub-order whose parent fetch fails (500) → that sub-order is skipped with an error row; the rest of the page is processed', async () => {
  const items = [wooOrder(), wooSub(2001, 1001, 44), wooSub(3001, 9999, 44), single(1002, 44, '2026-10-21T09:30:00')];
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders': page(items), 'GET wc/v3/orders/9999': { status: 500, text: 'down' } } });
  const { res, body } = await call(deps, { action: 'orders' });
  assertEquals([res.status, body.result], [200, 'ok']);
  assertEquals(db.rows('orders').map((o: any) => o.id), [1001, 1002]);
  assertEquals(db.rows('sub_orders').map((s: any) => s.woo_order_id), [2001]);
  const log = db.rows('woo_sync_log').find((r: any) => r.entity === 'sub_order')!;
  assertEquals([log.kind, log.entity_id, log.result, log.detail.reason, log.detail.parent_id], ['sync', '3001', 'error', 'parent_fetch_failed', 9999]);
});

Deno.test('one row refused with a data error (22xxx / 23xxx) in a batch of three → the other two written, one error row for it, the page goes on', async () => {
  const bad = (c: any) => c.table === 'orders' && c.op === 'upsert' && c.rows.some((r: any) => r.id === 1002)
    ? { code: '22P02', message: 'invalid input syntax for type numeric', details: `Failing row contains (1002, ${PHONE})` } : null;
  const items = [single(1001, 44, '2026-10-21T09:00:00'), single(1002, 44, '2026-10-21T09:10:00'), single(1003, 2376, '2026-10-21T09:20:00')];
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders': page(items) }, fail: bad });
  const { res, body } = await call(deps, { action: 'orders' });
  assertEquals([res.status, body.result], [200, 'ok']);
  assertEquals([body.counts.orders.orders, body.counts.orders.failed], [2, 1]);
  assertEquals(db.rows('orders').map((o: any) => o.id), [1001, 1003]);
  assertEquals(db.rows('order_items').map((i: any) => i.order_id), [1001, 1003], 'the refused order takes its lines with it (no FK error rows)');
  assertEquals(db.writes('orders').map((w: any) => w.rows.map((r: any) => r.id)), [[1001, 1002, 1003], [1001], [1002], [1003]], 'the batch, then row by row');
  const errors = db.rows('woo_sync_log').filter((r: any) => r.result === 'error');
  assertEquals(errors.map((r: any) => [r.kind, r.direction, r.entity, r.entity_id, r.action]), [['sync', 'in', 'orders', '1002', 'upsert']]);
  assertEquals(errors[0].detail, { error: 'DbError: orders: invalid input syntax for type numeric' });
  assertEquals(db.row('sync_state', 'orders', 'key').value.cursor, '2026-10-21T09:19:00Z', 'the cursor moves past the page');
  assertFalse(writtenText(db).includes(PHONE));
});

Deno.test('any other database error (not 22xxx / 23xxx) still stops the part: 500 sync_failed, no row-by-row retry', async () => {
  const down = (c: any) => (c.table === 'orders' && c.op === 'upsert' ? { code: '57014', message: 'canceling statement due to statement timeout' } : null);
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders': page([single(1001, 44, '2026-10-21T09:00:00'), single(1002, 44, '2026-10-21T09:10:00')]) }, fail: down });
  const { res, body } = await call(deps, { action: 'orders' });
  assertEquals([res.status, body.error, body.failed], [500, 'sync_failed', ['orders']]);
  assertEquals(db.writes('orders').length, 1);
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result, r.detail.error]), [['orders', 'error', 'DbError: orders: canceling statement due to statement timeout']]);
});

Deno.test('a multi-vendor parent whose lines carry no _dokan_vendor_id → each line linked to its sub-order by product id and given its maker', async () => {
  const parent = wooOrder({ id: 1005, number: '1005', date_modified_gmt: '2026-10-21T09:00:00', meta_data: [], line_items: [
    { id: 51, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [] },
    { id: 52, product_id: 502, variation_id: 7001, name: 'شنطة', quantity: 1, total: '250', meta_data: [] },
  ] });
  const subA = wooSub(2051, 1005, 44, { line_items: [{ id: 510, product_id: 501, quantity: 1, meta_data: [] }] });
  const subB = wooSub(2052, 1005, 2376, { line_items: [{ id: 520, product_id: 502, variation_id: 7001, quantity: 1, meta_data: [] }] });
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders': page([parent, subA, subB]) } });
  assertEquals((await call(deps, { action: 'orders' })).res.status, 200);
  const sub = (id: number) => db.row('sub_orders', id, 'woo_order_id');
  assertEquals(db.rows('order_items').map((i: any) => [i.id, i.vendor_id, i.sub_order_id]), [[51, vendorId(44), sub(2051).id], [52, vendorId(2376), sub(2052).id]]);
  assertEquals(db.rows('woo_sync_log').filter((r: any) => r.result !== 'ok').length, 0);
});

// ---------------------------------------------------------------- probe_store

Deno.test('probe_store: the field names of one store and nothing else — no value leaves; auth says whether the WordPress password is set; the admin may call it, ops may not', async () => {
  const store = wooStore(44, { phone: '01000000999', email: 'x.dev@ibtekr.local', show_email: false, address: { street_1: 'شارع', city: 'القاهرة', country: 'EG' }, social: { fb: 'https://fb.test/x' } });
  const { woo, deps } = setup({ routes: { 'GET dokan/v1/stores': page([store]), 'GET dokan/v1/stores/44': { body: store } } });
  const { res, body } = await call(deps, { action: 'probe_store' }, { jwt: 'jwt-admin' });
  assertEquals(res.status, 200);
  assertEquals([body.store_id, body.auth, body.address_keys, body.has, body.show_email], [44, false, ['city', 'country', 'street_1'], { phone: true, email: true, address: true, banner: false, social: true, payment: false }, false]);
  assert(body.keys.includes('store_name') && body.keys.includes('phone'));
  assertEquals([body.shapes.address, body.shapes.social, body.commission.type], [{ city: 'string:filled', country: 'string:filled', street_1: 'string:filled' }, { fb: 'string:filled' }, 'undefined']); // shapes, never values
  assertFalse(JSON.stringify(body).includes('01000000999') || JSON.stringify(body).includes('ibtekr.local') || JSON.stringify(body).includes('القاهرة'));
  assertEquals([woo.calls[0].path, woo.calls[0].query], ['dokan/v1/stores', { per_page: '1', page: '1' }]);
  // with the WordPress password: Basic on dokan/ and auth true; store_id picks the single-store route
  const w2 = setup({ env: { WOO_WP_USER: 'admin', WOO_WP_APP_PASSWORD: 'abcd efgh' }, routes: { 'GET dokan/v1/stores/44': { body: store } } });
  const r2 = await call(w2.deps, { action: 'probe_store', store_id: 44 }, { jwt: 'jwt-admin' });
  assertEquals([r2.body.auth, w2.woo.calls[0].path, w2.woo.calls[0].headers.authorization], [true, 'dokan/v1/stores/44', 'Basic ' + btoa('admin:abcd efgh')]);
  const r3 = await call(deps, { action: 'probe_store' }, { jwt: 'jwt-ops' });
  assertEquals(r3.res.status, 401);
});

Deno.test('probe_dokan: shapes of the named dokan/ GET paths only — route names for an index, no value, bad paths dropped; admin only', async () => {
  const wd = { id: 7, amount: '1500.00', method: 'bank', note: 'سحب', user: { id: 44, store_name: 'متجر' } };
  const { woo, deps } = setup({ routes: { 'GET dokan/v1': { body: { namespace: 'dokan/v1', routes: { '/dokan/v1/withdraw': {}, '/dokan/v1/stores': {} } } }, 'GET dokan/v1/withdraw': page([wd]) } });
  const { res, body } = await call(deps, { action: 'probe_dokan', paths: ['dokan/v1', 'dokan/v1/withdraw', 'wc/v3/orders', 'dokan/v1/../x', 'dokan/v1/missing'] }, { jwt: 'jwt-admin' });
  assertEquals(res.status, 200);
  assertEquals(Object.keys(body.paths), ['dokan/v1', 'dokan/v1/withdraw', 'dokan/v1/missing']); // wc/ and dot segments dropped
  assertEquals(body.paths['dokan/v1'], { status: 200, routes: ['/dokan/v1/stores', '/dokan/v1/withdraw'] });
  assertEquals(body.paths['dokan/v1/withdraw'].shape, { array: 1, item: { amount: 'string:filled', id: 'number', method: 'string:filled', note: 'string:filled', user: { id: 'number', store_name: 'string:filled' } } });
  assertEquals(body.paths['dokan/v1/missing'].status, 404);
  assertFalse(JSON.stringify(body).includes('1500') || JSON.stringify(body).includes('متجر') || JSON.stringify(body).includes('سحب'));
  assert(woo.calls.every((c) => c.method === 'GET'));
  // `query`: the allowed filters only (a bad value or another key is dropped)
  await call(deps, { action: 'probe_dokan', paths: ['dokan/v1/withdraw'], query: { vendor_id: '44', start_date: '2026-10-01', end_date: 'x', search: 'a', status: 'pending' } }, { jwt: 'jwt-admin' });
  assertEquals(woo.calls.at(-1)?.query, { vendor_id: '44', start_date: '2026-10-01', status: 'pending', per_page: '1', page: '1' });
  assertEquals((await call(deps, { action: 'probe_dokan', paths: ['wc/v3/orders'] }, { jwt: 'jwt-admin' })).res.status, 400);
  assertEquals((await call(deps, { action: 'probe_dokan', paths: ['dokan/v1'] }, { jwt: 'jwt-ops' })).res.status, 401);
});

Deno.test('probe_dokan { options: true }: each route\'s schema names / types / readonly and methods — OPTIONS only, no value; admin only', async () => {
  const routes = { 'OPTIONS dokan/v1/products/501': { body: { endpoints: [{ methods: ['GET'] }, { methods: ['POST', 'PUT', 'PATCH'] }], schema: { properties: { name: { type: 'string', default: 'Secret' }, store_id: { type: 'integer' }, id: { type: 'integer', readonly: true } } } } } };
  const { woo, deps } = setup({ routes });
  const { body } = await call(deps, { action: 'probe_dokan', paths: ['dokan/v1/products/501'], options: true }, { jwt: 'jwt-admin' });
  assertEquals(body.paths['dokan/v1/products/501'], { status: 200, methods: ['GET', 'PATCH', 'POST', 'PUT'], schema: { id: 'integer:readonly', name: 'string', store_id: 'integer' } });
  assertFalse(JSON.stringify(body).includes('Secret'));
  assert(woo.calls.every((c) => c.method === 'OPTIONS'));
});

Deno.test('probe_dokan { earning }: Dokan\'s own commission for one product at a price — seller and admin as numbers, GET only; bad input 400; admin only', async () => {
  const routes = { 'GET dokan/v1/commission': (c: any) => ({ body: c.query.context === 'seller' ? '11375' : 6125 }) };
  const { woo, deps } = setup({ routes });
  const { body } = await call(deps, { action: 'probe_dokan', earning: { product_id: 181912, amount: '17500' } }, { jwt: 'jwt-admin' });
  assertEquals(body.earning, { product_id: 181912, amount: 17500, seller: 11375, admin: 6125 });
  assertEquals(woo.calls.map((c) => [c.method, c.query.product_id, c.query.amount, c.query.context]), [['GET', '181912', '17500', 'seller'], ['GET', '181912', '17500', 'admin']]);
  assertEquals((await call(deps, { action: 'probe_dokan', earning: { product_id: 'x', amount: 1 } }, { jwt: 'jwt-admin' })).res.status, 400);
  assertEquals((await call(deps, { action: 'probe_dokan', earning: { product_id: 1, amount: -5 } }, { jwt: 'jwt-admin' })).res.status, 400);
  assertEquals((await call(deps, { action: 'probe_dokan', earning: { product_id: 1, amount: 1 } }, { jwt: 'jwt-ops' })).res.status, 401);
});

// ---------------------------------------------------------------- accounts / statement (phase 4)

Deno.test('accounts: every withdraw request (status=all) → dokan_withdrawals without the bank details, IP or note; the next batch of makers → dokan_balances; GET only; admin / system only', async () => {
  const wd = (id: number, store: number, status: string) => ({ id, user: { id: store, store_name: 'متجر', phone: '01000000777' }, amount: 1500, charge: 15, receivable: 1485, status, method: 'bank',
    created: '2026-10-20 14:05:00', ip: '10.0.0.9', note: 'رقم 01000000777', details: { bank: { ac_name: 'اسم', ac_number: '123456789012', iban: 'EG000000000000000000000000001' } } });
  const routes = {
    'GET dokan/v1/withdraw': (c: any) => (c.query.status === 'all' ? page([wd(7, 44, 'pending'), wd(8, 2376, 'approved'), wd(9, 999, 'cancelled'), { id: 'x' }]) : page([])),
    'GET dokan/v1/stores/44/stats': { body: { others: { balance: 2500.5, commission_rate: '20', commission_type: 'fixed', additional_fee: '', reviews: 0 }, revenue: { earning: 9000, orders: 12, sales: 11000 }, products: { sold: 3, total: 9, visitor: 4 } } },
    'GET dokan/v1/stores/2376/stats': { status: 404, body: { code: 'rest_no_store' } },
  };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'accounts' });
  assertEquals(res.status, 200);
  assertEquals(body.counts, { withdrawals: 3, skipped: 1, settled: 0, pages: 1, done: true, balances: 1, missing: 1, failed: 0, failed_rows: 0, offset: 0, next: 0 }); // 0078: an approved request from before 11 Nov settles nothing
  assertEquals(db.rows('dokan_withdrawals').map((r: any) => [r.id, r.woo_vendor_id, r.vendor_id, r.amount, r.charge, r.receivable, r.status, r.method, r.requested_at]),
    [[7, 44, vendorId(44), 1500, 15, 1485, 'pending', 'bank', '2026-10-20 14:05:00'], [8, 2376, vendorId(2376), 1500, 15, 1485, 'approved', 'bank', '2026-10-20 14:05:00'], [9, 999, null, 1500, 15, 1485, 'cancelled', 'bank', '2026-10-20 14:05:00']]);
  assertEquals(db.rows('dokan_balances').map((r: any) => [r.vendor_id, r.woo_vendor_id, r.balance, r.earning, r.sales, r.orders]), [[vendorId(44), 44, 2500.5, 9000, 11000, 12]]);
  assertEquals(db.row('sync_state', 'accounts', 'key').value.offset, 0);
  const written = JSON.stringify([db.rows('dokan_withdrawals'), db.rows('dokan_balances'), db.rows('woo_sync_log')]);
  for (const secret of ['123456789012', 'EG000000000000000000000000001', '10.0.0.9', '01000000777', 'رقم']) assertFalse(written.includes(secret), `never stored: ${secret}`);
  assert(woo.calls.every((c) => c.method === 'GET'), 'nothing is written to Dokan');
  assertEquals(db.rows('woo_sync_log').at(-1).entity, 'accounts');
  assertEquals((await call(deps, { action: 'accounts' }, { jwt: 'jwt-acct' })).res.status, 401, 'a member who is not admin cannot run the part');
});

Deno.test('accounts: the balances go round the makers ACCOUNTS_BATCH at a time (sync_state offset)', async () => {
  const vendors = Array.from({ length: 52 }, (_, i) => vendorRow(1000 + i));
  const routes: Record<string, any> = { 'GET dokan/v1/withdraw': page([]) };
  for (let i = 0; i < 52; i++) routes[`GET dokan/v1/stores/${1000 + i}/stats`] = { body: { others: { balance: i }, revenue: {} } };
  const { db, deps } = setup({ seed: { vendors }, routes });
  const first = (await call(deps, { action: 'accounts' })).body.counts;
  assertEquals([first.balances, first.offset, first.next], [50, 0, 50]);
  const second = (await call(deps, { action: 'accounts' })).body.counts;
  assertEquals([second.balances, second.offset, second.next], [2, 50, 0]);
  assertEquals(db.rows('dokan_balances').length, 52);
});

Deno.test('statement: the maker\'s Dokan statement for a range, read-only and not stored; accounts.view <> N; a bad range → 400', async () => {
  const routes = { 'GET dokan/v1/vendor/reports/statement': (c: any) => (c.query.vendor_id === '44' && c.query.start_date === '2026-10-01' && c.query.end_date === '2026-10-27'
    ? page([{ id: 1, vendor_id: 44, trn_id: null, trn_type: 'opening_balance', perticulars: 'Opening Balance', debit: 0, credit: 0, balance: 300, trn_date: '', balance_date: '2026-10-01', status: '', trn_title: 'Opening', url: '' },
      { id: 2, vendor_id: 44, trn_id: 55, trn_type: 'dokan_orders', perticulars: 'Order #55 للعميل 01000000777', debit: 500, credit: 0, balance: 800, trn_date: '2026-10-05 10:00:00', balance_date: '2026-10-05', status: 'wc-completed', trn_title: 'Order', url: '' }])
    : page([])) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'statement', vendor_id: vendorId(44), from: '2026-10-01', to: '2026-10-27' }, { jwt: 'jwt-acct' });
  assertEquals(res.status, 200);
  assertEquals(body.rows.map((r: any) => [r.date, r.type, r.debit, r.credit, r.balance, r.ref]), [['2026-10-01', 'opening_balance', 0, 0, 300, null], ['2026-10-05 10:00:00', 'dokan_orders', 500, 0, 800, 55]]);
  assertFalse(JSON.stringify(body).includes('01000000777'), 'the title is scrubbed');
  assertEquals(db.writes().length, 0, 'nothing is stored');
  assert(woo.calls.every((c) => c.method === 'GET'));
  assertEquals((await call(deps, { action: 'statement', vendor_id: vendorId(44), from: '2026-10-01', to: '2026-10-27' }, { jwt: 'jwt-ops' })).res.status, 401, 'accounts.view N');
  assertEquals((await call(deps, { action: 'statement', vendor_id: vendorId(44), from: '2026-10-27', to: '2026-10-01' }, { jwt: 'jwt-acct' })).res.status, 400);
  assertEquals((await call(deps, { action: 'statement', vendor_id: vendorId(44), from: '2024-01-01', to: '2026-10-01' }, { jwt: 'jwt-acct' })).res.status, 400, 'over 400 days');
});

// ---------------------------------------------------------------- withdraw_approve (phase 4.1)

const wdSeed = (status: string) => ({ dokan_withdrawals: [{ id: 7, woo_vendor_id: 44, vendor_id: vendorId(44), amount: 1500, charge: 15, receivable: 1485, status, method: 'bank', requested_at: '2026-10-20 14:05:00' }] });
const wdDokan = (status: string) => ({ id: 7, user: { id: 44 }, amount: '1500.00', status, method: 'bank', ip: '10.0.0.9', note: 'x', details: { bank: { ac_number: '123456789012', iban: 'EG000000000000000000000000001' } } });

Deno.test('withdraw_approve: a pending request → GET then PUT dokan/v1/withdraw/{id} { status: approved }; the mirror and the balance follow; nothing of the bank details logged', async () => {
  const routes = {
    'GET dokan/v1/withdraw/7': { body: wdDokan('pending') },
    'PUT dokan/v1/withdraw/7': (c: any) => ({ body: wdDokan(c.body.status) }),
    'GET dokan/v1/stores/44/stats': { body: { others: { balance: 1000 }, revenue: { earning: 9000, orders: 12, sales: 11000 } } },
  };
  const settles: any[] = [];
  const rpc = { acc_settle_withdrawal: (a: any) => { settles.push(a); return { withdraw_id: 7, amount: 1500, moves_net: 500, carry_in: 0, consumed: 500, carry_out: 0, cash: 1000, moves: 2 }; } };
  const { db, woo, deps } = setup({ seed: wdSeed('pending'), routes, env: PUSH_ON, rpc });
  const { res, body } = await call(deps, { action: 'withdraw_approve', id: 7, amount: 1, status: 'cancelled' }, { jwt: 'jwt-approver' });
  assertEquals(res.status, 200);
  // 0078: the maker's open moves settle against it, by whoever approved — what it covered and the cash to transfer come back
  assertEquals(body, { action: 'withdraw_approve', result: 'ok', status: 'approved', settlement: { amount: 1500, consumed: 500, cash: 1000, carry_out: 0, moves: 2 } });
  assertEquals(settles, [{ p_withdraw: 7, p_source: 'system', p_by: 'uid-jwt-approver' }]);
  assertEquals(woo.calls.map((c: any) => [c.method, c.path, c.body ?? null]), [['GET', 'dokan/v1/withdraw/7', null], ['PUT', 'dokan/v1/withdraw/7', { status: 'approved' }], ['GET', 'dokan/v1/stores/44/stats', null]]);
  assertEquals(db.row('dokan_withdrawals', 7).status, 'approved');
  assertEquals(db.row('dokan_balances', vendorId(44), 'vendor_id').balance, 1000);
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.action, log.result, log.detail], ['push', 'out', 'dokan_withdrawals', '7', 'withdraw_approve', 'ok', { status: 'approved', amount: 1500, settled: 2 }]);
  const written = JSON.stringify([db.rows('dokan_withdrawals'), db.rows('woo_sync_log')]);
  for (const secret of ['123456789012', 'EG000000000000000000000000001', '10.0.0.9']) assertFalse(written.includes(secret), `never stored: ${secret}`);
});

Deno.test('withdraw_approve: the admin or accounts.approve = F only; never the sync secret; a bad id → 400; unknown → 404', async () => {
  const { woo, deps } = setup({ seed: wdSeed('pending'), env: PUSH_ON });
  assertEquals((await call(deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-acct' })).res.status, 401, 'accounts.view P, approve N');
  assertEquals((await call(deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-ops' })).res.status, 401);
  assertEquals((await call(deps, { action: 'withdraw_approve', id: 7 })).res.status, 401, 'the sync secret never approves');
  assertEquals(woo.calls.length, 0);
  assertEquals((await call(deps, { action: 'withdraw_approve', id: 'x' }, { jwt: 'jwt-admin' })).res.status, 400);
  assertEquals((await call(deps, { action: 'withdraw_approve', id: 99 }, { jwt: 'jwt-admin' })).res.status, 404);
  assertEquals(woo.calls.length, 0);
});

Deno.test('withdraw_approve: WOO_PUSH_ENABLED off → skipped/push_disabled before any Dokan call; not pending here → skipped/not_pending', async () => {
  const off = setup({ seed: wdSeed('pending') });
  const a = await call(off.deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-approver' });
  assertEquals([a.body.result, a.body.reason], ['skipped', 'push_disabled']);
  assertEquals(off.woo.calls.length, 0);
  assertEquals(off.db.row('dokan_withdrawals', 7).status, 'pending');
  const done = setup({ seed: wdSeed('approved'), env: PUSH_ON });
  const b = await call(done.deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-approver' });
  assertEquals([b.body.result, b.body.reason], ['skipped', 'not_pending']);
  assertEquals(done.woo.calls.length, 0);
});

Deno.test('withdraw_approve: no longer pending on Dokan → skipped/stale, no PUT, the mirror corrected', async () => {
  const { db, woo, deps } = setup({ seed: wdSeed('pending'), routes: { 'GET dokan/v1/withdraw/7': { body: wdDokan('cancelled') } }, env: PUSH_ON });
  const { body } = await call(deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.reason, body.status], ['skipped', 'stale', 'cancelled']);
  assert(woo.calls.every((c: any) => c.method === 'GET'));
  assertEquals(db.row('dokan_withdrawals', 7).status, 'cancelled');
});

Deno.test('withdraw_approve: Dokan refuses the PUT → 502 woo_error, logged as a push error, the mirror unchanged', async () => {
  const routes = { 'GET dokan/v1/withdraw/7': { body: wdDokan('pending') }, 'PUT dokan/v1/withdraw/7': { status: 400, body: { code: 'dokan_rest_invalid_status', message: 'no' } } };
  const { db, deps } = setup({ seed: wdSeed('pending'), routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'withdraw_approve', id: 7 }, { jwt: 'jwt-approver' });
  assertEquals([res.status, body.error], [502, 'woo_error']);
  assertEquals(db.row('dokan_withdrawals', 7).status, 'pending');
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.kind, log.entity, log.entity_id, log.result], ['push', 'dokan_withdrawals', '7', 'error']);
});

Deno.test('withdrawals (phase 4.1, «تحديث من Dokan»): the requests only, GET only, no balances; accounts.view <> N; the sync log row', async () => {
  const wd = (id: number, store: number, status: string) => ({ id, user: { id: store }, amount: 900, charge: 0, receivable: 900, status, method: 'bank', created: '2026-10-28 09:00:00', ip: '10.0.0.9', details: { bank: { ac_number: '123456789012' } } });
  const routes = { 'GET dokan/v1/withdraw': (c: any) => (c.query.status === 'all' ? page([wd(201, 44, 'pending'), wd(7, 2376, 'approved')]) : page([])) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'withdrawals' }, { jwt: 'jwt-acct' });
  assertEquals(res.status, 200);
  assertEquals(body.counts, { withdrawals: 2, skipped: 0, failed_rows: 0, settled: 0, pages: 1, done: true });
  assertEquals(db.rows('dokan_withdrawals').map((r: any) => [r.id, r.vendor_id, r.status]), [[201, vendorId(44), 'pending'], [7, vendorId(2376), 'approved']]);
  assertEquals(woo.calls.map((c: any) => [c.method, c.path]), [['GET', 'dokan/v1/withdraw']], 'no stats requests');
  assertEquals(db.rows('dokan_balances').length, 0);
  assertFalse(JSON.stringify(db.rows('dokan_withdrawals')).includes('123456789012'));
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.entity, log.action, log.result], ['dokan_withdrawals', 'refresh', 'ok']);
  assertEquals((await call(deps, { action: 'withdrawals' }, { jwt: 'jwt-ops' })).res.status, 401, 'accounts.view N');
});

// ---------------------------------------------------------------- vendors / products / all

Deno.test('vendors: a new store is inserted whole (the phase-3.3 columns, its first snapshot, the site\'s rate as a vendor_rates row); an existing one goes through the store sync — the team\'s aliases / category / rate stay; no Authorization on dokan/', async () => {
  const seed = { vendors: [vendorRow(44, { name: 'اسم الفريق', status: 'inactive', phone: '01000000044', aliases: ['قديم'], commission_pct: 12.5, category: 'هدايا',
    joined_at: '2024-12-31', raw: { id: 44, store_name: 'Old 44' }, woo_snapshot: { name: 'اسم الفريق', phone: '01000000044', email: null, contact_name: null, address_parts: null, social: null, status: 'inactive', rate: { rate: 12.5, flat: null }, category_rates: [] } })],
    vendor_rates: [{ vendor_id: vendorId(44), rate: 12.5, since: '2026-10-01', set_by: 'x' }] };
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStore(44, { enabled: false, store_name: 'Store 44 renamed', phone: '01000000999' }), wooStoreFull(900)]) } });
  const { body } = await call(deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.counts.vendors], ['ok', { vendors: 2, from_site: 1, conflicts: 0, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0, removed: 0, back: 0, pages: 1, done: true }]);
  assertEquals([woo.calls[0].path, woo.calls[0].query], ['dokan/v1/stores', { per_page: '100', page: '1' }]);
  assertFalse('authorization' in woo.calls[0].headers);
  assertEquals(woo.calls.length, 1, 'nothing is written to the site');
  const v44 = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v44.id, v44.name, v44.status, v44.phone, v44.aliases, v44.commission_pct, v44.category, v44.joined_at],
    [vendorId(44), 'Store 44 renamed', 'inactive', '01000000999', ['قديم'], 12.5, 'هدايا', '2024-12-31'], 'the site changed name / phone since the snapshot → written here; the team columns stay');
  assertEquals(v44.raw, { id: 44, store_name: 'Store 44 renamed', shop_url: 'https://woo.test/store/44/', enabled: false, registered: '2025-01-02 10:00:00' }, 'raw follows the site');
  assertEquals([v44.woo_snapshot.name, v44.woo_snapshot.phone, v44.woo_synced_at, v44.push_pending], ['Store 44 renamed', '01000000999', NOW, null]);
  assertEquals(db.rows('vendor_rates').filter((r: any) => r.vendor_id === vendorId(44)).length, 1, 'the site has no rate (public shape): no rate row for 44');
  const v900 = db.row('vendors', 900, 'woo_vendor_id');
  assertEquals([v900.name, v900.status, v900.phone, v900.email, v900.joined_at, v900.aliases, v900.commission_pct, v900.lead_days, v900.contact_name, v900.address, v900.logo_url, v900.banner_url, v900.woo_payment_methods, v900.woo_synced_at],
    ['Store 900', 'active', '01000000000', 'store@example.test', '2025-01-02', [], null, 7, 'Maker Owner 900', 'شارع 900، القاهرة، EG-01', 'https://woo.test/g/900.jpg', 'https://woo.test/b/900.jpg', ['bank'], NOW], 'a new store: the full mapStore row, the team columns at their defaults');
  assertEquals(v900.address_parts, { street_1: 'شارع 900', street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG' });
  assertEquals(v900.social.fb, 'https://fb.test/900');
  assertEquals(v900.woo_snapshot.rate, { type: 'fixed', rate: 30, flat: null });
  assertEquals(db.rows('vendor_rates').filter((r: any) => r.vendor_id === v900.id).map((r: any) => [r.rate, r.flat, r.since, r.set_by]), [[30, null, NOW.slice(0, 10), 'الموقع']], 'the site\'s commission of a new store → its first rate row');
  const writes = db.writes('vendors').map((w: any) => [w.op, w.onConflict ?? null, w.rows ? w.rows.map((r: any) => Object.keys(r).sort()) : Object.keys(w.patch).sort(), w.filters]);
  assertEquals(writes, [['upsert', 'woo_vendor_id', [['address', 'address_parts', 'banner_url', 'contact_name', 'email', 'joined_at', 'logo_url', 'name', 'phone', 'raw', 'social', 'status', 'woo_payment_methods', 'woo_snapshot', 'woo_synced_at', 'woo_vendor_id']], []],
    ['update', null, ['banner_url', 'email', 'logo_url', 'name', 'phone', 'push_pending', 'raw', 'woo_payment_methods', 'woo_snapshot', 'woo_synced_at'], [['eq', 'woo_vendor_id', 44]]]], 'new: the full row upserted (never aliases / commission_pct); existing: one update by woo_vendor_id with the mirrors + the fields the site changed');
  assertEquals(db.rows('activity_log').map((r: any) => [r.action, r.entity, r.entity_id, r.new_value]), [['vendor.sync', 'vendor', vendorId(44), 'name, phone, email']], 'one activity row per changed store: the field names only');
  assertFalse(JSON.stringify(db.rows('activity_log')).includes('01000000999'), 'no phone in activity_log');
  assertEquals(db.rows('woo_sync_log').at(-1).kind, 'manual');
});

Deno.test('vendors (the owner, 2 Nov): a store gone from the site marks its maker (site_removed_at, inactive) after a complete run — never deletes it; back on the site, the mark lifts; a run that saw no store marks no one', async () => {
  const seed = { vendors: [vendorRow(44), vendorRow(2376, { status: 'active' }), vendorRow(0, { woo_vendor_id: null, name: 'بدون متجر' })] };
  const gone = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStore(44)]) } });
  const r1 = await call(gone.deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([r1.body.counts.vendors.removed, r1.body.counts.vendors.back], [1, 0]);
  const v = gone.db.row('vendors', 2376, 'woo_vendor_id');
  assertEquals([v.site_removed_at, v.status, gone.db.rows('vendors').length], [NOW, 'inactive', 3], 'marked and kept, not deleted');
  assertEquals([gone.db.row('vendors', 44, 'woo_vendor_id').site_removed_at ?? null, gone.db.row('vendors', 0, 'woo_vendor_id')?.site_removed_at ?? null], [null, null], 'the store still there and a maker without a store: untouched');
  // a second run with the store still gone: marked once, counted no more
  const again = await call(gone.deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([again.body.counts.vendors.removed, again.body.counts.vendors.back], [0, 0]);
  // back on the site → the mark lifts (the status is the team's to set again)
  const back = setup({ seed: { vendors: [vendorRow(44), vendorRow(2376, { status: 'inactive', site_removed_at: '2026-10-30T10:00:00Z' })] }, routes: { 'GET dokan/v1/stores': page([wooStore(44), wooStore(2376)]) } });
  const r3 = await call(back.deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([r3.body.counts.vendors.back, r3.body.counts.vendors.removed, back.db.row('vendors', 2376, 'woo_vendor_id').site_removed_at ?? null], [1, 0, null]);
  // the site answering no store at all: nothing marked
  const empty = setup({ seed, routes: { 'GET dokan/v1/stores': page([]) } });
  const r4 = await call(empty.deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([r4.body.counts.vendors.removed, empty.db.rows('vendors').filter((x: any) => x.site_removed_at).length], [0, 0]);
});

Deno.test('vendors: a second run over the same stores with no change on either side writes the mirrors only (no activity row); the team\'s rename stays and is not pushed when nothing is pending', async () => {
  const { db, deps } = setup({ seed: { vendors: [] }, routes: { 'GET dokan/v1/stores': page([wooStore(44), wooStore(900)]) } });
  await call(deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals(db.rows('vendors').map((v: any) => [v.woo_vendor_id, v.name, v.joined_at]), [[44, 'Store 44', '2025-01-02'], [900, 'Store 900', '2025-01-02']]);
  // the same page again: nothing changed on the site, nothing changed here
  const { body } = await call(deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals(body.counts.vendors.vendors, 2);
  assertEquals(db.writes('vendors').slice(1).map((w: any) => [w.op, Object.keys(w.patch).sort(), w.filters]),
    [['update', ['banner_url', 'logo_url', 'push_pending', 'raw', 'woo_payment_methods', 'woo_snapshot', 'woo_synced_at'], [['eq', 'woo_vendor_id', 44]]], ['update', ['banner_url', 'logo_url', 'push_pending', 'raw', 'woo_payment_methods', 'woo_snapshot', 'woo_synced_at'], [['eq', 'woo_vendor_id', 900]]]]);
  assertEquals(db.rows('activity_log'), []);
  // the team renamed one in between (the adapter's push is a separate call; here it is not pending), the site renamed the other
  const snap = (id: number) => db.row('vendors', id, 'woo_vendor_id').woo_snapshot;
  const { db: db2, woo: woo2, deps: deps2 } = setup({ seed: { vendors: [vendorRow(44, { name: 'اسم الفريق', woo_snapshot: snap(44) }), vendorRow(900, { name: 'Store 900', woo_snapshot: snap(900) })] },
    routes: { 'GET dokan/v1/stores': page([wooStore(44), wooStore(900, { store_name: 'Site 900' })]) }, env: PUSH_ON });
  const r2 = await call(deps2, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([r2.body.counts.vendors.vendors, r2.body.counts.vendors.from_site, r2.body.counts.vendors.pushed], [2, 1, 0]);
  assertEquals(db2.rows('vendors').map((v: any) => [v.woo_vendor_id, v.name, v.raw.store_name]), [[44, 'اسم الفريق', 'Store 44'], [900, 'Site 900', 'Site 900']]);
  assertEquals(woo2.calls.filter((c) => c.method === 'PUT').length, 0, 'a system-side change that is not pending is left alone');
  assertEquals(db2.rows('activity_log').map((r: any) => [r.entity_id, r.new_value]), [[vendorId(900), 'name']]);
  assertEquals(db2.rows('woo_sync_log').filter((r: any) => r.result !== 'ok').length, 0, 'no error row: the write is an update, never a partial upsert');
});

Deno.test('products: pulled with the cursor params and upserted (image_url = images[0].src, maker linked or null, permalink https only)', async () => {
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/products': page([wooProduct(501, 44), wooProduct(502, null, { images: [], permalink: 'http://woo.test/p/502' })]) } });
  const { body } = await call(deps, { action: 'products' });
  assertEquals(body.counts.products.products, 2);
  assertEquals(woo.calls[0].query, { dates_are_gmt: 'true', orderby: 'modified', order: 'asc', per_page: '100', page: '1' });
  assertEquals(db.rows('products').map((p: any) => [p.id, p.vendor_id, p.image_url, p.permalink]),
    [[501, vendorId(44), 'https://woo.test/img/501-a.jpg', 'https://woo.test/p/501'], [502, null, null, null]]);
  assertEquals(db.row('sync_state', 'products', 'key').value.cursor, '2026-10-21T08:59:00Z');
});

Deno.test('all → states, then vendors, then orders, then products (one request for the names first; the orders before the ~40 product pages)', async () => {
  const routes = { [STATES]: country([{ code: 'EG-01', name: 'محافظة 1' }]), [CATS]: page([{ id: 15, name: 'هدايا', slug: 'gifts', parent: 0 }]), 'GET dokan/v1/stores': page([wooStore(44, { store_name: 'متجر 44' })]), 'GET wc/v3/products': page([wooProduct(501, 44)]),
    'GET wc/v3/orders': page([single(1002, 44, '2026-10-21T09:30:00')]) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals(res.status, 200);
  assertEquals(woo.calls.map((c) => c.path), ALL_PATHS);
  assertEquals(Object.keys(body.counts), ['states', 'categories', 'vendors', 'orders', 'products']);
  assertEquals(body.counts.states, { states: 1, skipped: 0, failed: 0 });
  assertEquals(body.counts.categories, { categories: 1, skipped: 0, failed: 0, brands: 0, pages: 1, done: true }); // brands: 404 (no route) = none
  assertEquals(body.counts.products, { products: 1, failed: 0, pages: 1, done: true, ar: 1, ar_done: true, trash: 1 });
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result]), [['states', 'ok'], ['categories', 'ok'], ['vendors', 'ok'], ['orders', 'ok'], ['products', 'ok']]);
});

Deno.test('all keeps going when one part fails, answers 502 naming it, and the log holds neither the keys nor a phone', async () => {
  const echo = `{"code":"invalid_username","message":"bad ${ENV.WOO_CK}:${ENV.WOO_CS} for ${PHONE}","data":{"billing_phone":"${PHONE}"}}`;
  const routes = { [STATES]: country([]), [CATS]: page([]), 'GET dokan/v1/stores': { status: 401, text: echo }, 'GET wc/v3/products': page([]), 'GET wc/v3/orders': page([]) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals(res.status, 502);
  assertEquals([body.error, body.failed], ['sync_failed', ['vendors']]);
  assertEquals(woo.calls.map((c) => c.path), ALL_PATHS);
  const err = db.rows('woo_sync_log').find((r: any) => r.result === 'error')!;
  assertEquals([err.entity, err.kind], ['vendors', 'cron']);
  for (const s of [PHONE, ENV.WOO_CK, ENV.WOO_CS]) assertFalse(writtenText(db).includes(s), `leaked ${s}`);
});

// ---------------------------------------------------------------- products (phase 5)

const prodSeed = { products: [
  { id: 501, name: 'Lamp', status: 'publish', lang: 'en', translation_ids: { ar: 601, en: 501 } },
  { id: 502, name: 'Vase', status: 'draft', lang: 'en', translation_ids: { en: 502 } },
] };

Deno.test('products: the default language, then lang=ar, then the trash (status=trash, every language), each with its own cursor', async () => {
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/products': (c: any) => page([wooProduct(c.query.lang === 'ar' ? 601 : c.query.status === 'trash' ? 700 : 501, 44, { lang: c.query.lang === 'ar' ? 'ar' : 'en', status: c.query.status === 'trash' ? 'trash' : 'publish' })]) } });
  const { body } = await call(deps, { action: 'products' });
  assertEquals(woo.calls.map((c) => [c.query.lang ?? '', c.query.status ?? '']), [['', ''], ['ar', ''], ['all', 'trash']]);
  assertEquals([body.counts.products.products, body.counts.products.ar, body.counts.products.trash], [1, 1, 1]);
  assertEquals(db.rows('products').map((p: any) => [p.id, p.lang, p.status, p.trashed_at]), [[501, 'en', 'publish', null], [601, 'ar', 'publish', null], [700, 'en', 'trash', '2026-10-21T09:00:00Z']]);
  assertEquals(['products', 'products_ar', 'products_trash'].map((k) => typeof db.row('sync_state', k, 'key')?.value.cursor), ['string', 'string', 'string']);
});

Deno.test('products: the product\'s own Dokan commission → product_commissions (rate null when not set)', async () => {
  const withComm = wooProduct(501, 44, { meta_data: [{ key: '_per_product_admin_commission', value: '20' }, { key: '_per_product_admin_commission_type', value: 'percentage' }, { key: '_wc_cog_cost', value: '999' }] });
  const { db, deps } = setup({ routes: { 'GET wc/v3/products': (c: any) => (c.query.lang || c.query.status ? page([]) : page([withComm, wooProduct(502, 44)])) } });
  await call(deps, { action: 'products' });
  assertEquals(db.rows('product_commissions').map((r: any) => [r.product_id, r.rate, r.type, r.fee]), [[501, 20, 'percentage', null], [502, null, null, null]]);
  assertFalse(JSON.stringify(db.rows('product_commissions')).includes('999'));
});

Deno.test('products { full: true }: every product of both languages by id, page by page from sync_state products_full (resumes, then back to page 1); delta cursors untouched', async () => {
  const routes = { 'GET wc/v3/products': (c: any) => (c.query.lang === 'ar' ? page([wooProduct(601, 44, { lang: 'ar' })]) : c.query.page === '3' ? page([wooProduct(503, 44)]) : page([])) };
  const { db, woo, deps } = setup({ routes, seed: { sync_state: [{ key: 'products_full', value: { lang: 'en', page: 3 } }, { key: 'products', value: { cursor: '2026-10-01T00:00:00Z' } }] } });
  const { res, body } = await call(deps, { action: 'products', full: true });
  assertEquals(res.status, 200);
  assertEquals(woo.calls.map((c) => [c.query.lang, c.query.page, c.query.orderby, c.query.status]), [['en', '3', 'id', 'any'], ['ar', '1', 'id', 'any']]);
  assertEquals(body.counts, { products: 2, failed: 0, lang: 'ar', done: true });
  assertEquals([db.row('sync_state', 'products_full', 'key').value.lang, db.row('sync_state', 'products_full', 'key').value.page], ['en', 1]);
  assertEquals(db.row('sync_state', 'products', 'key').value.cursor, '2026-10-01T00:00:00Z');
});

Deno.test('product_get: the product live (allow-listed: no meta, no store address), its Arabic name / descriptions, its variations; products.view <> N; never the secret', async () => {
  const en = wooProduct(501, 44, { type: 'variable', lang: 'en', translations: { ar: 601, en: 501 }, meta_data: [{ key: '_wc_cog_cost', value: '999' }], purchase_note: 'سر', short_description: 'short', categories: [{ id: 15, name: 'Decor' }], brands: [{ id: 3, name: 'B' }] });
  const routes = { 'GET wc/v3/products/501': { body: en }, 'GET wc/v3/products/601': { body: wooProduct(601, 44, { name: 'لمبة', lang: 'ar', short_description: 'وصف' }) },
    'GET wc/v3/products/501/variations': page([{ id: 9001, sku: 'V1', attributes: [{ name: 'Color', option: 'Red' }], regular_price: '200', sale_price: '', stock_quantity: 3, manage_stock: true, meta_data: [{ key: 'x', value: 'y' }] }]) };
  const { db, woo, deps } = setup({ routes });
  assertEquals((await call(deps, { action: 'product_get', id: 501 })).res.status, 401, 'the sync secret');
  assertEquals((await call(deps, { action: 'product_get', id: 501 }, { jwt: 'jwt-acct' })).res.status, 401, 'products.view N');
  const { res, body } = await call(deps, { action: 'product_get', id: 501 }, { jwt: 'jwt-pview' });
  assertEquals(res.status, 200);
  assertEquals([body.product.id, body.product.type, body.product.categories, body.product.brands, body.product.store], [501, 'variable', [{ id: 15, name: 'Decor' }], [{ id: 3, name: 'B' }], { id: 44, shop_name: 'Store 44' }]);
  assertEquals(body.ar, { id: 601, name: 'لمبة', short_description: 'وصف', description: '', seo_title: '', seo_description: '', status: 'publish' });
  assertEquals(body.variations.map((v: any) => [v.id, v.attributes, v.regular_price, v.stock_quantity]), [[9001, [{ name: 'Color', option: 'Red' }], '200', 3]]);
  for (const secret of ['999', 'سر', 'street_1', 'Owner Name', '_wc_cog_cost']) assertFalse(JSON.stringify(body).includes(secret), secret);
  assert(woo.calls.every((c) => c.method === 'GET'));
  assertEquals(db.rows('products').map((p: any) => p.id), [501, 601], 'the mirror refreshed on the way');
});

Deno.test('product_save: push disabled → skipped with no call; a field outside the list / a bad value / sale above regular → 400 with no call; products.edit = F only', async () => {
  const { db, woo, deps } = setup({ seed: prodSeed });
  const r0 = await call(deps, { action: 'product_save', id: 501, fields: { regular_price: '100' } }, { jwt: 'jwt-pedit' });
  assertEquals([r0.res.status, r0.body.result, r0.body.reason], [200, 'skipped', 'push_disabled']);
  assertEquals(db.rows('woo_sync_log').at(-1).detail, { reason: 'push_disabled', fields: ['regular_price'], ar: [], variations: 0 });
  const { deps: d2, woo: w2 } = setup({ seed: prodSeed, env: PUSH_ON });
  for (const [fields, field] of [[{ meta_data: [] }, 'meta_data'], [{ regular_price: '-1' }, 'regular_price'], [{ status: 'trash' }, 'status'], [{ stock_quantity: 1.5 }, 'stock_quantity'],
    [{ description: '<p onclick="x()">a</p>' }, 'description'], [{ short_description: '<script>x</script>' }, 'short_description'],
    [{ description: '<svg/onload=alert(1)>' }, 'description'], [{ description: '<a href="java&#115;cript:x">a</a>' }, 'description'], [{ description: '<a href="https://x" onclick="y">a</a>' }, 'description'],
    [{ description: '<p>ok<img src=x onerror=y' }, 'description'], [{ description: '<!-- x -->' }, 'description'], [{ name: '<b>x</b>' }, 'name'], [{ regular_price: '100', sale_price: '120' }, 'sale_price'], [{ store: { id: 1 } }, 'store']] as const) {
    const r = await call(d2, { action: 'product_save', id: 501, fields }, { jwt: 'jwt-pedit' });
    assertEquals([r.res.status, r.body.field], [400, field], JSON.stringify(fields));
  }
  assertEquals((await call(d2, { action: 'product_save', id: 501, fields: { name: 'x' } }, { jwt: 'jwt-pview' })).res.status, 401, 'products.edit N');
  assertEquals((await call(d2, { action: 'product_save', id: 501, fields: { name: 'x' } })).res.status, 401, 'the sync secret');
  assertEquals(woo.calls.length + w2.calls.length, 0);
});

Deno.test('product_save: PUT the product, the Arabic translation (its name + the shared status / price / stock), the variations by batch update; mirror from the answers; the log names fields only', async () => {
  const routes = {
    'PUT wc/v3/products/501': (c: any) => ({ body: wooProduct(501, 44, { ...c.body, lang: 'en', translations: { ar: 601, en: 501 } }) }),
    'PUT wc/v3/products/601': (c: any) => ({ body: wooProduct(601, 44, { ...c.body, lang: 'ar' }) }),
    'PUT wc/v3/products/502': (c: any) => ({ body: wooProduct(502, 44, { ...c.body, lang: 'en' }) }),
    'POST wc/v3/products/501/variations/batch': { body: { update: [{ id: 9001 }, { id: 9002, error: { code: 'x' } }] } },
  };
  const { db, woo, deps } = setup({ seed: prodSeed, routes, env: PUSH_ON });
  const safe = '<p>Hand <strong>made</strong><br/>by <a href="https://ibtekr.club/x">us</a></p><ul><li>a</li></ul> 5 > 3';
  assertEquals((await call(deps, { action: 'product_save', id: 502, fields: { description: safe } }, { jwt: 'jwt-pedit' })).res.status, 200, 'the allowed tags pass');
  const { res, body } = await call(deps, { action: 'product_save', id: 501, fields: { name: ' Lamp 2 ', regular_price: '1500', sale_price: '1200', categories: [15, 15, 16], status: 'publish' },
    ar: { name: 'لمبة 2' }, variations: [{ id: 9001, regular_price: '300' }, { id: 9002, stock_quantity: 4, manage_stock: true }] }, { jwt: 'jwt-pedit' });
  assertEquals(res.status, 200);
  assertEquals(body.counts, { saved: 2, variations: 1, variations_failed: 1 });
  const put = woo.calls.filter((c) => c.method === 'PUT' && c.path !== 'wc/v3/products/502');
  assertEquals(put.map((c) => [c.path, c.body]), [
    ['wc/v3/products/501', { name: 'Lamp 2', regular_price: '1500', sale_price: '1200', categories: [{ id: 15 }, { id: 16 }], status: 'publish' }],
    ['wc/v3/products/601', { regular_price: '1500', sale_price: '1200', status: 'publish', name: 'لمبة 2' }],
  ]);
  assertEquals(woo.calls.find((c) => c.method === 'POST')?.body, { update: [{ id: 9001, regular_price: '300' }, { id: 9002, stock_quantity: 4, manage_stock: true }] });
  assertEquals(db.rows('products').find((p: any) => p.id === 501).sale_price, 1200);
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.entity, log.entity_id, log.action, log.result], ['products', '501', 'product_save', 'error']);
  assertFalse(JSON.stringify(log.detail).includes('1500'), 'no price in the log');
  // no translation for an Arabic field → 409, nothing written to the translation
  const r2 = await call(deps, { action: 'product_save', id: 502, ar: { name: 'x' } }, { jwt: 'jwt-pedit' });
  assertEquals([r2.res.status, r2.body.error], [409, 'no_translation']);
});

Deno.test('SEO (phase 5.1): product_get reads the two Rank Math keys only; product_save writes them as meta_data on the product and on its Arabic translation; tags and Rank Math variables outside SEO_VARS refused', async () => {
  const en = wooProduct(501, 44, { lang: 'en', translations: { ar: 601, en: 501 }, meta_data: [{ key: 'rank_math_title', value: 'Lamp | Ibtekr' }, { key: 'rank_math_description', value: 'A lamp' }, { key: 'rank_math_focus_keyword', value: 'secret-kw' }, { key: '_wc_cog_cost', value: '999' }] });
  const routes = { 'GET wc/v3/products/501': { body: en }, 'GET wc/v3/products/601': { body: wooProduct(601, 44, { lang: 'ar', meta_data: [{ key: 'rank_math_title', value: 'لمبة' }] }) },
    'PUT wc/v3/products/501': (c: any) => ({ body: wooProduct(501, 44, { lang: 'en', translations: { ar: 601, en: 501 } }) }), 'PUT wc/v3/products/601': (c: any) => ({ body: wooProduct(601, 44, { lang: 'ar' }) }) };
  const { woo, deps } = setup({ seed: prodSeed, routes, env: PUSH_ON });
  const g = await call(deps, { action: 'product_get', id: 501 }, { jwt: 'jwt-pview' });
  assertEquals([g.body.product.seo_title, g.body.product.seo_description, g.body.ar.seo_title, g.body.ar.seo_description], ['Lamp | Ibtekr', 'A lamp', 'لمبة', '']);
  for (const secret of ['secret-kw', '999']) assertFalse(JSON.stringify(g.body).includes(secret), secret);
  for (const [fields, field] of [[{ seo_title: '<b>x</b>' }, 'seo_title'], [{ seo_description: 'x'.repeat(501) }, 'seo_description'],
    [{ seo_title: '%customfield(_wc_cog_cost)%' }, 'seo_title'], [{ seo_description: 'Lamp %post_author%' }, 'seo_description'], [{ seo_title: '%title%%cf_x%' }, 'seo_title'],
    [{ seo_title: '%customfield( _wc_cog_cost)%' }, 'seo_title'], [{ seo_title: 'x %customfield(_wc_cog_cost )%' }, 'seo_title'], [{ seo_description: '20%off' }, 'seo_description']] as const) {
    assertEquals((await call(deps, { action: 'product_save', id: 501, fields }, { jwt: 'jwt-pedit' })).body.field, field);
  }
  const r = await call(deps, { action: 'product_save', id: 501, fields: { seo_title: ' %title% %sep% %sitename% — 20% off ', seo_description: '' }, ar: { seo_title: 'لمبة — إبتكر' } }, { jwt: 'jwt-pedit' });
  assertEquals(r.res.status, 200);
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body]), [
    ['wc/v3/products/501', { meta_data: [{ key: 'rank_math_title', value: '%title% %sep% %sitename% — 20% off' }, { key: 'rank_math_description', value: '' }] }],
    ['wc/v3/products/601', { meta_data: [{ key: 'rank_math_title', value: 'لمبة — إبتكر' }] }],
  ]);
});

Deno.test('products_vendor (the owner, 1 Nov): the products\' maker on the site — Dokan\'s PUT post_author on each product and its translation, the answer checked; the mirror follows the ones that took it; a maker without a store 409; products.bulk; the gate', async () => {
  const puts: [number, unknown][] = [];
  const routes = {
    'PUT dokan/v1/products/501': (c: any) => { puts.push([501, c.body]); return { body: { id: 501, post_author: String(c.body.post_author) } }; },
    'PUT dokan/v1/products/601': (c: any) => { puts.push([601, c.body]); return { body: { id: 601, post_author: c.body.post_author } }; },
    'PUT dokan/v1/products/502': (c: any) => { puts.push([502, c.body]); return { body: { id: 502, post_author: 1 } }; }, // Dokan kept the caller: not moved
  };
  const { db, woo, deps } = setup({ seed: { ...prodSeed, vendors: [vendorRow(44), vendorRow(2376), vendorRow(900, { woo_vendor_id: null })] }, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'products_vendor', ids: [501, 502, 502], vendor_id: vendorId(2376) }, { jwt: 'jwt-pedit' });
  assertEquals(res.status, 200);
  assertEquals([body.counts, body.failed_ids], [{ moved: 1, failed: 1 }, [502]]);
  assertEquals(puts, [[501, { post_author: 2376 }], [601, { post_author: 2376 }], [502, { post_author: 2376 }]], 'the product, then its translation; each id once');
  assertEquals(db.rows('products').map((p: any) => [p.id, p.vendor_id ?? null]), [[501, vendorId(2376)], [502, null]], 'the mirror follows the one that took it');
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.action, log.result, log.detail.moved, log.detail.failed, log.detail.vendor_id], ['products_vendor', 'error', 1, 1, vendorId(2376)]);
  assertEquals((await call(deps, { action: 'products_vendor', ids: [501], vendor_id: vendorId(900) }, { jwt: 'jwt-pedit' })).res.status, 409, 'no store on the site');
  assertEquals((await call(deps, { action: 'products_vendor', ids: [501], vendor_id: vendorId(7) }, { jwt: 'jwt-pedit' })).res.status, 404, 'no such maker');
  assertEquals((await call(deps, { action: 'products_vendor', ids: [], vendor_id: vendorId(44) }, { jwt: 'jwt-pedit' })).body.field, 'ids');
  assertEquals((await call(deps, { action: 'products_vendor', ids: [501], vendor_id: '44' }, { jwt: 'jwt-pedit' })).body.field, 'vendor_id');
  assertEquals((await call(deps, { action: 'products_vendor', ids: [501], vendor_id: vendorId(44) }, { jwt: 'jwt-pone' })).res.status, 401, 'products.edit F without products.bulk');
  const off = setup({ seed: { ...prodSeed }, routes });
  const sk = await call(off.deps, { action: 'products_vendor', ids: [501], vendor_id: vendorId(44) }, { jwt: 'jwt-pedit' });
  assertEquals([sk.body.result, sk.body.reason, off.woo.calls.length], ['skipped', 'push_disabled', 0], 'the push gate');
  assertFalse(woo.calls.some((c) => c.method === 'DELETE'));
});

Deno.test('products_batch: wc/v3/products/batch with `update` only (never `delete`), the translations get the shared fields only; failed ids answered', async () => {
  const routes = { 'POST wc/v3/products/batch': (c: any) => ({ body: { update: c.body.update.map((u: any) => (u.id === 502 ? { id: 502, error: { code: 'woocommerce_rest_product_invalid_id' } } : wooProduct(u.id, 44, { ...u, categories: undefined, translations: u.id === 501 ? { ar: 601, en: 501 } : undefined }))) } }) };
  const { woo, deps } = setup({ seed: prodSeed, routes, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'products_batch', update: [{ id: 501, status: 'draft' }], delete: [501] }, { jwt: 'jwt-pedit' })).res.status, 200);
  assertFalse(woo.calls.some((c) => 'delete' in (c.body ?? {})), 'a batch never carries delete');
  const { res, body } = await call(deps, { action: 'products_batch', update: [{ id: 501, regular_price: '900', categories: [20] }, { id: 502, status: 'publish' }] }, { jwt: 'jwt-pedit' });
  assertEquals(res.status, 200);
  assertEquals([body.counts, body.failed_ids], [{ updated: 1, failed: 1, translations: 1 }, [502]]);
  const batches = woo.calls.filter((c) => c.path === 'wc/v3/products/batch').slice(-2).map((c) => c.body);
  assertEquals(batches, [{ update: [{ id: 501, regular_price: '900', categories: [{ id: 20 }] }, { id: 502, status: 'publish' }] }, { update: [{ id: 601, regular_price: '900' }] }]);
  for (const bad of [{ update: [] }, { update: [{ id: 501 }] }, { update: [{ id: 501, name: 'x' }] }, { update: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, status: 'draft' })) }]) {
    assertEquals((await call(deps, { action: 'products_batch', ...bad }, { jwt: 'jwt-pedit' })).res.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assertEquals((await call(deps, { action: 'products_batch', update: [{ id: 501, status: 'draft' }] }, { jwt: 'jwt-ptrash' })).res.status, 401, 'products.bulk N');
  assertEquals((await call(deps, { action: 'products_batch', update: [{ id: 501, status: 'draft' }] }, { jwt: 'jwt-pone' })).res.status, 401, 'products.edit F without products.bulk');
});

Deno.test('products_trash / products_restore: DELETE with no query at all (never force) on the product and its translation; restore = draft; products.trash = F only', async () => {
  const tr = { translations: { ar: 601, en: 501 } };
  const routes = { 'DELETE wc/v3/products/501': { body: wooProduct(501, 44, { status: 'trash', ...tr }) }, 'DELETE wc/v3/products/601': { body: wooProduct(601, 44, { status: 'trash', lang: 'ar' }) },
    'DELETE wc/v3/products/502': { status: 500, body: { code: 'x' } },
    'PUT wc/v3/products/501': (c: any) => ({ body: wooProduct(501, 44, { ...c.body, ...tr }) }), 'PUT wc/v3/products/601': (c: any) => ({ body: wooProduct(601, 44, c.body) }) };
  const { db, woo, deps } = setup({ seed: prodSeed, routes, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'products_trash', ids: [501] }, { jwt: 'jwt-pedit' })).res.status, 401, 'products.trash N');
  const { res, body } = await call(deps, { action: 'products_trash', ids: [501, 502] }, { jwt: 'jwt-ptrash' });
  assertEquals([res.status, body.counts, body.failed_ids], [200, { done: 1, failed: 1 }, [502]]);
  const dels = woo.calls.filter((c) => c.method === 'DELETE');
  assertEquals(dels.map((c) => [c.path, c.query]), [['wc/v3/products/501', {}], ['wc/v3/products/601', {}], ['wc/v3/products/502', {}]]);
  assertEquals(db.rows('products').find((p: any) => p.id === 501).status, 'trash');
  const back = await call(deps, { action: 'products_restore', ids: [501] }, { jwt: 'jwt-ptrash' });
  assertEquals(back.body.counts, { done: 1, failed: 0 });
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body]), [['wc/v3/products/501', { status: 'draft' }], ['wc/v3/products/601', { status: 'draft' }]]);
  assertEquals(db.rows('products').find((p: any) => p.id === 501).status, 'draft');
  const { woo: w2, deps: d2 } = setup({ seed: prodSeed, routes });
  assertEquals((await call(d2, { action: 'products_trash', ids: [501] }, { jwt: 'jwt-ptrash' })).body.reason, 'push_disabled');
  assertEquals(w2.calls.length, 0);
});

// ---------------------------------------------------------------- product_duplicate (phase 12 T2, decision 9)

Deno.test('product_duplicate: products.add only; the copy posted as a draft with the source\'s data, media ids, categories, brands and attributes under a new studio SKU (the serial from the member\'s sku_serial_take); the maker before the variations; the variations under their SKUs; the Arabic translation linked; the mirror; the gate', async () => {
  const src = wooProduct(501, 44, { sku: 'IBTAR0999', type: 'variable', lang: 'en', translations: { en: 501, ar: 601 }, description: '<p>d</p>', short_description: 's', regular_price: '', sale_price: '', manage_stock: false, stock_status: 'instock',
    categories: [{ id: 20, name: 'Lamps' }], brands: [{ id: 7, name: 'Art Craft' }], tags: [], attributes: [{ id: 12, name: 'Color', position: 0, visible: true, variation: true, options: ['Beige', 'Black'] }], weight: '1', dimensions: { length: '10', width: '', height: '' } });
  const posts: any[] = []; const puts: any[] = [];
  const routes = {
    'GET wc/v3/products/501': { body: src },
    'GET wc/v3/products/501/variations': { body: [{ id: 5011, sku: 'IBTARBE0999', regular_price: '150', sale_price: '120', manage_stock: true, stock_quantity: 3, attributes: [{ id: 12, name: 'Color', option: 'Beige' }], image: { id: 2, src: 'x' } }, { id: 5012, sku: 'IBTARBK0999', regular_price: '150', sale_price: '120', manage_stock: false, stock_status: 'onbackorder', attributes: [{ id: 12, name: 'Color', option: 'Black' }] }] },
    'GET wc/v3/products/601': { body: wooProduct(601, 44, { lang: 'ar', name: 'لمبة بوهو', sku: 'IBTAR0999', description: '<p>وصف</p>', attributes: [{ id: 12, name: 'اللون', position: 0, visible: true, variation: true, options: ['بيج', 'أسود'] }], translations: { en: 501, ar: 601 } }) },
    'POST wc/v3/products': (c: any) => { posts.push(c.body); return c.body.wpml_language === 'ar' ? { body: { id: 901, lang: 'ar', translations: { en: 900, ar: 901 } } } : { body: wooProduct(900, 44, { sku: c.body.sku, type: 'variable', status: 'draft' }) }; },
    'PUT dokan/v1/products/900': (c: any) => { puts.push([900, c.body]); return { body: { id: 900, post_author: String(c.body.post_author) } }; },
    'PUT dokan/v1/products/901': (c: any) => { puts.push([901, c.body]); return { body: { id: 901, post_author: c.body.post_author } }; },
    'POST wc/v3/products/900/variations/batch': (c: any) => ({ body: { create: c.body.create.map((_: any, i: number) => ({ id: 9100 + i })) } }),
    'GET wc/v3/products/900': { body: wooProduct(900, 44, { sku: 'IBTAR1234', type: 'variable', status: 'draft', lang: 'en', translations: { en: 900, ar: 901 } }) },
    'GET wc/v3/products/901': { body: wooProduct(901, 44, { sku: 'IBTAR1234', type: 'variable', status: 'draft', lang: 'ar', translations: { en: 900, ar: 901 } }) },
  };
  const { db, woo, members, deps } = setup({ seed: prodSeed, routes, env: WP_ENV });
  assertEquals((await call(deps, { action: 'product_duplicate', id: 501 }, { jwt: 'jwt-pedit' })).res.status, 401, 'products.edit is not products.add');
  assertEquals((await call(deps, { action: 'product_duplicate', id: 501 })).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { action: 'product_duplicate', id: 'x' }, { jwt: 'jwt-padd' })).body.field, 'id');
  const { res, body } = await call(deps, { action: 'product_duplicate', id: 501 }, { jwt: 'jwt-padd' });
  assertEquals([res.status, body.result, body.id, body.sku, body.variations, body.ar, body.author], [200, 'ok', 900, 'IBTAR1234', { done: 2, failed: 0 }, 901, 'ok'], JSON.stringify(body));
  // the serial came from the member's own client (the RPC checks products.add), one number
  const padd = members.filter((m) => m.jwt === 'jwt-padd').at(-1).client;
  assertEquals(padd.calls.filter((c: any) => c.op === 'rpc' && c.name === 'sku_serial_take').map((c: any) => c.args), [{ n: 1 }]);
  // the copy: a draft with the source's data and the same media, under the new SKU; nothing of its identity
  assertEquals(posts[0], { name: 'منتج 501 (نسخة)', type: 'variable', status: 'draft', description: '<p>d</p>', short_description: 's', manage_stock: false, stock_status: 'instock', weight: '1', categories: [{ id: 20 }], tags: [], images: [{ id: 1 }, { id: 2 }],
    attributes: [{ id: 12, name: 'Color', position: 0, visible: true, variation: true, options: ['Beige', 'Black'] }], lang: 'en', wpml_language: 'en', brands: [{ id: 7 }], dimensions: { length: '10' }, sku: 'IBTAR1234' });
  // the Arabic copy linked to the new product, no SKU of its own
  assertEquals(posts[1], { name: 'لمبة بوهو (نسخة)', description: '<p>وصف</p>', short_description: '', attributes: [{ id: 12, name: 'اللون', position: 0, visible: true, variation: true, options: ['بيج', 'أسود'] }], type: 'variable', status: 'draft', lang: 'ar', wpml_language: 'ar', translation_of: 900 });
  const vars = woo.calls.find((c) => c.path === 'wc/v3/products/900/variations/batch')!.body.create;
  assertEquals(vars.map((v: any) => [v.sku, v.image?.id ?? null, v.manage_stock, v.stock_quantity ?? null, v.attributes]), [['IBTARBE1234', 2, true, 3, [{ id: 12, name: 'Color', option: 'Beige' }]], ['IBTARBK1234', null, false, null, [{ id: 12, name: 'Color', option: 'Black' }]]]);
  assertEquals(puts, [[900, { post_author: 44 }], [901, { post_author: 44 }]]);
  const order = woo.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
  assertEquals(order, ['POST wc/v3/products', 'PUT dokan/v1/products/900', 'POST wc/v3/products/900/variations/batch', 'POST wc/v3/products', 'PUT dokan/v1/products/901'], 'the maker before the variations');
  assert(db.rows('products').some((p: any) => p.id === 900) && db.rows('products').some((p: any) => p.id === 901), 'the mirror takes both rows');
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.action, log.result, log.entity_id, log.detail.source, log.detail.sku, log.detail.variations, log.detail.ar], ['product_duplicate', 'ok', '900', 501, 'IBTAR1234', { done: 2, failed: 0 }, 901]);
  assertFalse(woo.calls.some((c) => c.method === 'DELETE'));
  // the gate
  const off = setup({ seed: prodSeed, routes });
  const sk = await call(off.deps, { action: 'product_duplicate', id: 501 }, { jwt: 'jwt-padd' });
  assertEquals([sk.body.result, sk.body.reason, off.woo.calls.length], ['skipped', 'push_disabled', 0]);
});

Deno.test('product_duplicate: the Arabic row sent → copied from its English product; an unlinked Arabic answer is trashed (never force) and said; a simple product has no variations call; a refused product is 502 with a log row', async () => {
  const posts: any[] = [];
  const routes = {
    'GET wc/v3/products/601': { body: wooProduct(601, 44, { lang: 'ar', name: 'كوباية', sku: 'MUG-1', type: 'simple', translations: { en: 501, ar: 601 } }) },
    'GET wc/v3/products/501': { body: wooProduct(501, 44, { lang: 'en', name: 'Mug', sku: 'MUG-1', type: 'simple', regular_price: '100', sale_price: '80', manage_stock: true, stock_quantity: 5, translations: { en: 501, ar: 601 } }) },
    'POST wc/v3/products': (c: any) => { posts.push(c.body); return c.body.wpml_language === 'ar' ? { body: { id: 901, lang: 'ar', translations: { ar: 901 } } } : { body: wooProduct(900, 44, { sku: c.body.sku, type: 'simple', status: 'draft' }) }; },
    'PUT dokan/v1/products/900': (c: any) => ({ body: { id: 900, post_author: String(c.body.post_author) } }),
    'DELETE wc/v3/products/901': { body: { id: 901, status: 'trash' } },
    'GET wc/v3/products/900': { body: wooProduct(900, 44, { sku: 'MUG-1-1234', type: 'simple', status: 'draft', lang: 'en' }) },
  };
  const { woo, deps } = setup({ seed: prodSeed, routes, env: WP_ENV });
  const { res, body } = await call(deps, { action: 'product_duplicate', id: 601 }, { jwt: 'jwt-padd' });
  assertEquals([res.status, body.id, body.sku, body.variations, body.ar, body.ar_code, body.author], [200, 900, 'MUG-1-1234', null, null, 'not_linked', 'ok']);
  assertEquals([posts[0].name, posts[0].sku, posts[0].regular_price, posts[0].stock_quantity, posts[1].translation_of], ['Mug (نسخة)', 'MUG-1-1234', '100', 5, 900]);
  const del = woo.calls.filter((c) => c.method === 'DELETE'); assertEquals(del.map((c) => [c.path, c.query]), [['wc/v3/products/901', {}]], 'the orphan translation to the trash, never force');
  assertFalse(woo.calls.some((c) => c.path.endsWith('/variations')));
  // a refused product
  const r2 = setup({ seed: prodSeed, routes: { 'GET wc/v3/products/501': routes['GET wc/v3/products/501'], 'POST wc/v3/products': { status: 400, body: { code: 'product_invalid_sku', message: 'x' } } }, env: WP_ENV });
  const bad = await call(r2.deps, { action: 'product_duplicate', id: 501 }, { jwt: 'jwt-padd' });
  assertEquals([bad.res.status, bad.body.result, bad.body.error], [502, 'error', 'product_invalid_sku']);
  assertEquals(r2.db.rows('woo_sync_log').at(-1).result, 'error');
});

// ---------------------------------------------------------------- states (the site's governorate names)

Deno.test('states: GET wc/v3/data/countries/EG with the WC keys → woo_states upserted on code (trimmed, last name wins), malformed items skipped, nothing deleted, logged ok', async () => {
  const seed = { woo_states: [{ code: 'EG-01', name: 'اسم قديم', updated_at: '2026-10-01T00:00:00Z' }, { code: 'EG-25', name: 'محافظة اتشالت', updated_at: '2026-10-01T00:00:00Z' }] };
  const states = [
    { code: 'EG-01', name: 'محافظة 1' }, { code: ' EG-02 ', name: ' محافظة 2 ' }, { code: 'EG-03', name: 'محافظة 3 قديمة' }, { code: 'EG-03', name: 'محافظة 3' },
    { code: '', name: 'من غير كود' }, { code: 'EG-04', name: '  ' }, { code: 5, name: 'كود رقم' }, { code: 'EG-06' }, { name: 'اسم بس' },
    { code: 'EG-07', name: { ar: 'كائن' } }, null, 'EG-08', ['EG-09', 'x'],
  ];
  const { db, woo, deps } = setup({ seed, routes: { [STATES]: country(states) } });
  assertEquals((await call(deps, { action: 'states' }, { jwt: 'jwt-ops' })).res.status, 401, 'a member who is not admin');
  assertEquals(woo.calls.length, 0);

  const { res, body } = await call(deps, { action: 'states' }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body.action, body.result], [200, 'states', 'ok']);
  assertEquals(body.counts, { states: { states: 3, skipped: 9, failed: 0 } });
  assertEquals(woo.calls.map((c) => [c.method, c.path, c.query, c.headers.authorization]), [['GET', 'wc/v3/data/countries/EG', {}, WC_AUTH]]);
  assertEquals(db.rows('woo_states').map((r: any) => [r.code, r.name, r.updated_at]), [
    ['EG-01', 'محافظة 1', NOW], ['EG-25', 'محافظة اتشالت', '2026-10-01T00:00:00Z'], ['EG-02', 'محافظة 2', NOW], ['EG-03', 'محافظة 3', NOW]]);
  assertEquals(db.writes('woo_states').map((w: any) => [w.op, w.onConflict, w.rows.map((r: any) => Object.keys(r).sort().join(','))]),
    [['upsert', 'code', ['code,name,updated_at', 'code,name,updated_at', 'code,name,updated_at']]], 'one upsert on code, these three columns only');
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.kind, r.direction, r.entity, r.action, r.result, r.detail]),
    [['manual', 'in', 'states', 'sync', 'ok', { states: 3, skipped: 9, failed: 0 }]]);
});

Deno.test('states: no endpoint on the site (404) or an answer without a states array → an error row for the part, woo_states untouched, 502', async () => {
  const replies = [undefined, { body: { code: 'EG', name: 'Egypt' } }, { body: [{ code: 'EG-01', name: 'محافظة 1' }] }, country({ 'EG-01': 'محافظة 1' }), { body: null }];
  for (const reply of replies) {
    const seed = { woo_states: [{ code: 'EG-01', name: 'محافظة 1', updated_at: '2026-10-01T00:00:00Z' }] };
    const { db, deps } = setup({ seed, routes: reply ? { [STATES]: reply } : {} });
    const { res, body } = await call(deps, { action: 'states' });
    assertEquals([res.status, body.error, body.failed], [502, 'sync_failed', ['states']], JSON.stringify(reply));
    assertEquals(db.writes('woo_states').length, 0);
    assertEquals(db.rows('woo_states').map((r: any) => [r.code, r.updated_at]), [['EG-01', '2026-10-01T00:00:00Z']]);
    const log = db.rows('woo_sync_log');
    assertEquals(log.map((r: any) => [r.kind, r.entity, r.action, r.result]), [['cron', 'states', 'sync', 'error']]);
    assert(/^WooError: GET wc\/v3\/data\/countries\/EG → HTTP (404|200)/.test(log[0].detail.error), log[0].detail.error);
  }
});

Deno.test('all: the states part failing (403) logs its error; vendors, orders and products still run and write', async () => {
  const routes = {
    [STATES]: { status: 403, text: '{"code":"woocommerce_rest_cannot_view","message":"Sorry, you cannot list resources.","data":{"status":403}}' },
    [CATS]: page([]), 'GET dokan/v1/stores': page([wooStore(44, { store_name: 'متجر 44' })]), 'GET wc/v3/products': page([wooProduct(501, 44)]), 'GET wc/v3/orders': page([single(1002, 44, '2026-10-21T09:30:00')]),
  };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals([res.status, body.error, body.failed], [502, 'sync_failed', ['states']]);
  assertEquals(woo.calls.map((c) => c.path), ALL_PATHS);
  assertEquals(Object.keys(body.counts), ['categories', 'vendors', 'orders', 'products']);
  assertEquals([db.rows('orders').map((o: any) => o.id), db.rows('products').map((p: any) => p.id), db.rows('woo_states').length], [[1002], [501], 0]);
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result]), [['states', 'error'], ['categories', 'ok'], ['vendors', 'ok'], ['orders', 'ok'], ['products', 'ok']]);
  assert(db.rows('woo_sync_log')[0].detail.error.includes('HTTP 403'));
});

Deno.test('states: a name refused with a data error (22xxx) → that code gets one error row, the others are written', async () => {
  const bad = (c: any) => c.table === 'woo_states' && c.op === 'upsert' && c.rows.some((r: any) => r.code === 'EG-02')
    ? { code: '22001', message: 'value too long for type character varying(10)' } : null;
  const states = [{ code: 'EG-01', name: 'محافظة 1' }, { code: 'EG-02', name: 'محافظة 2' }, { code: 'EG-03', name: 'محافظة 3' }];
  const { db, deps } = setup({ routes: { [STATES]: country(states) }, fail: bad });
  const { res, body } = await call(deps, { action: 'states' });
  assertEquals([res.status, body.result, body.counts.states], [200, 'ok', { states: 2, skipped: 0, failed: 1 }]);
  assertEquals(db.rows('woo_states').map((r: any) => r.code), ['EG-01', 'EG-03']);
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.kind, r.direction, r.entity, r.entity_id, r.action, r.result]),
    [['sync', 'in', 'woo_states', 'EG-02', 'upsert', 'error'], ['cron', 'in', 'states', null, 'sync', 'ok']]);
});

// ---------------------------------------------------------------- push_status

Deno.test('push_status without WOO_PUSH_ENABLED = 1 (the default; also "true", "0", "yes", "") → skipped/push_disabled, no Woo call', async () => {
  for (const value of [undefined, 'true', '0', 'yes', '', '11']) {
    const env: Record<string, string> = value === undefined ? {} : { WOO_PUSH_ENABLED: value };
    const { db, woo, deps } = setup({ seed: pushSeed, env });
    const { res, body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
    assertEquals([res.status, body], [200, { action: 'push_status', result: 'skipped', reason: 'push_disabled', counts: { pushed: 0 } }], `WOO_PUSH_ENABLED=${value}`);
    assertEquals(woo.calls.length, 0);
    assertEquals(db.writes('orders').length, 0);
    assertFalse(db.calls.some((c: any) => c.table === 'status_map'), 'nothing is prepared for a push that will not happen');
    const log = db.rows('woo_sync_log');
    assertEquals(log.map((r: any) => [r.kind, r.direction, r.entity, r.entity_id, r.result, r.detail]), [['push', 'out', 'order', '1001', 'skipped', { status: 'جاهز للشحن', reason: 'push_disabled' }]]);
  }
});

Deno.test('push_status with WOO_PUSH_ENABLED = "1" (trimmed) pushes; the stale check still comes first', async () => {
  const routes = {
    'GET wc/v3/orders/1001': { body: { id: 1001, status: 'processing', date_modified_gmt: '2026-10-20T11:00:00' } },
    'PUT wc/v3/orders/1001': { body: { id: 1001, status: 'ready-shipping', date_modified_gmt: '2026-10-25T12:00:01' } },
  };
  const { db, woo, deps } = setup({ seed: pushSeed, routes, env: { WOO_PUSH_ENABLED: ' 1 ' } });
  const { body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
  assertEquals([body.result, body.counts], ['ok', { pushed: 1 }]);
  assertEquals(woo.calls.map((c) => c.method), ['GET', 'PUT']);
  const stale = await call(deps, { action: 'push_status', order_id: 1001, status: 'مكتمل' }, { jwt: 'jwt-ops' });
  assertEquals([stale.body.result, stale.body.reason], ['skipped', 'stale']);
  assertEquals(db.row('orders', 1001).woo_status, 'ready-shipping');
});

Deno.test('push_status by a member with orders.status = F → PUT wc/v3/orders/{id} {status}; woo_status / woo_updated_at updated; push logged ok', async () => {
  const routes = {
    'GET wc/v3/orders/1001': { body: { id: 1001, status: 'processing', date_modified_gmt: '2026-10-20T11:00:00' } },
    'PUT wc/v3/orders/1001': (c: any) => ({ body: { id: 1001, status: c.body.status, date_modified_gmt: '2026-10-25T12:00:01' } }),
  };
  const { db, woo, deps } = setup({ seed: pushSeed, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'push_status', result: 'ok', conflict: false, counts: { pushed: 1 } });
  const put = woo.calls.find((c) => c.method === 'PUT')!;
  assertEquals([put.path, put.body, put.headers.authorization, put.headers['content-type']], ['wc/v3/orders/1001', { status: 'ready-shipping' }, WC_AUTH, 'application/json']);
  const o = db.row('orders', 1001);
  assertEquals([o.woo_status, o.woo_updated_at, o.status], ['ready-shipping', '2026-10-25T12:00:01Z', 'جاهز للشحن']);
  assertEquals(Object.keys(db.writes('orders')[0].patch).sort(), ['woo_status', 'woo_updated_at']);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.result], ['push', 'out', 'order', '1001', 'ok']);
});

Deno.test('push_status «فشل» (0009: failed / from_woo) → skipped no_woo_status, no Woo call (never pushed to the site)', async () => {
  const routes = {
    'GET wc/v3/orders/1001': { body: { id: 1001, status: 'processing', date_modified_gmt: '2026-10-20T11:00:00' } },
    'PUT wc/v3/orders/1001': (c: any) => ({ body: { id: 1001, status: c.body.status, date_modified_gmt: '2026-10-25T12:00:01' } }),
  };
  const { db, woo, deps } = setup({ seed: { orders: [{ ...pushSeed.orders[0], status: 'فشل' }] }, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'فشل' }, { jwt: 'jwt-ops' });
  assertEquals([body.result, body.reason, body.counts], ['skipped', 'no_woo_status', { pushed: 0 }]);
  assertEquals(woo.calls.length, 0);
  assertEquals([db.row('orders', 1001).status, db.row('orders', 1001).woo_status], ['فشل', pushSeed.orders[0].woo_status]);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.direction, log.result, log.detail.reason], ['push', 'out', 'skipped', 'no_woo_status']);
});

Deno.test('push_status for a status with no Woo slug (a from_system row; none today) → skipped, no Woo call', async () => {
  const teamOnly = { id: 10, system_status: 'حالة داخلية', woo_status: null, direction: 'from_system', sort: 11 };
  const { db, woo, deps } = setup({ seed: { status_map: [...STATUS_MAP, teamOnly], orders: [{ ...pushSeed.orders[0], status: teamOnly.system_status }] }, env: PUSH_ON });
  const { body } = await call(deps, { action: 'push_status', order_id: 1001, status: teamOnly.system_status }, { jwt: 'jwt-ops' });
  assertEquals([body.action, body.result, body.reason], ['push_status', 'skipped', 'no_woo_status']);
  assertEquals(woo.calls.length, 0);
  assertEquals(db.writes('orders').length, 0);
  assertEquals(db.rows('woo_sync_log')[0].result, 'skipped');
});

Deno.test('push_status with a status that is not the stored one (a stale page) → skipped/stale, no Woo call', async () => {
  const { db, woo, deps } = setup({ seed: pushSeed });
  const { res, body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'مكتمل' }, { jwt: 'jwt-ops' });
  assertEquals([res.status, body.result, body.reason], [200, 'skipped', 'stale']);
  assertEquals(woo.calls.length, 0);
  assertEquals(db.writes('orders').length, 0);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.result, log.detail], ['push', 'skipped', { status: 'مكتمل', reason: 'stale', current: 'جاهز للشحن' }]);
});

Deno.test('push_status when WooCommerce changed the status since our last sync → still pushed (system wins), conflict logged', async () => {
  const routes = {
    'GET wc/v3/orders/1001': { body: { id: 1001, status: 'on-hold', date_modified_gmt: '2026-10-22T00:00:00' } },
    'PUT wc/v3/orders/1001': { body: { id: 1001, status: 'ready-shipping', date_modified_gmt: '2026-10-25T12:00:01' } },
  };
  const { db, woo, deps } = setup({ seed: pushSeed, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'push_status', order_id: 1001, status: 'جاهز للشحن' }, { secret: SYNC_SECRET });
  assertEquals([body.result, body.conflict], ['ok', true]);
  assertEquals(woo.calls.map((c) => c.method), ['GET', 'PUT']);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.result, log.detail.woo_before, log.detail.woo_status], ['conflict', 'on-hold', 'ready-shipping']);
  assertEquals(db.row('orders', 1001).woo_status, 'ready-shipping');
});

Deno.test('push_status for an unknown order → 404; with a bad body → 400; no Woo call', async () => {
  const { woo, deps } = setup({ seed: pushSeed });
  assertEquals((await call(deps, { action: 'push_status', order_id: 4242, status: 'مكتمل' })).res.status, 404);
  assertEquals((await call(deps, { action: 'push_status', order_id: 'x', status: 'مكتمل' })).res.status, 400);
  assertEquals((await call(deps, { action: 'push_status', order_id: 1001 })).res.status, 400);
  assertEquals(woo.calls.length, 0);
});

// the owner 11 Nov («زي الـ automation»): Dokan recreates the sub-orders of a multi-vendor parent updated through the API (PR #3454)
const multiSeed = () => {
  const b = subSeed();
  return { ...b, orders: b.orders.map((o: any) => (o.id === 3001 ? { ...o, status: 'جاهز للشحن' } : o)),
    sub_orders: [...b.sub_orders.map((s: any) => (s.id === 11 || s.id === 12 ? { ...s, woo_status: 'processing' } : s)),
      { id: 14, order_id: 3001, vendor_id: null, woo_order_id: 3009, woo_status: 'processing' }, // left behind by an earlier re-split: no live line points to it
      { id: 15, order_id: 3001, vendor_id: null, woo_order_id: 3010, woo_status: 'trash' }] };
};
Deno.test('push_status on an order with Dokan sub-orders → PUT {status} on each current sub-order, never the parent; sub_orders.woo_status from the answers; orders.woo_status untouched', async () => {
  const puts: any[] = [];
  const answer = (id: number) => (c: any) => { puts.push([id, c.body]); return { body: { id, status: c.body.status } }; };
  const { db, woo, deps } = setup({ seed: multiSeed(), routes: { 'PUT wc/v3/orders/3002': answer(3002), 'PUT wc/v3/orders/3003': answer(3003) }, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'push_status', order_id: 3001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'push_status', result: 'ok', conflict: false, subs: [3002, 3003], woo_status: 'ready-shipping', counts: { pushed: 2 } });
  assertEquals(woo.calls.map((c) => [c.method, c.path]), [['PUT', 'wc/v3/orders/3002'], ['PUT', 'wc/v3/orders/3003']], 'never the parent 3001, nor the stale 3009, nor the trashed 3010');
  assertEquals(puts, [[3002, { status: 'ready-shipping' }], [3003, { status: 'ready-shipping' }]]);
  const subs = new Map(db.rows('sub_orders').map((s: any) => [s.woo_order_id, s.woo_status]));
  assertEquals([subs.get(3002), subs.get(3003), subs.get(3009), subs.get(3010)], ['ready-shipping', 'ready-shipping', 'processing', 'trash']);
  assertEquals(db.row('orders', 3001).woo_status, 'processing', 'the site\'s parent was not written');
  assertEquals(db.writes('orders').length, 0);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.entity_id, log.result, log.detail], ['3001', 'ok', { status: 'جاهز للشحن', woo_status: 'ready-shipping', subs: [3002, 3003] }]);
});

Deno.test('push_status on sub-orders: a refusal → 502 after the rest (counted, logged); a sub-order gone from the site (404) is no failure; no live line → every sub-order row', async () => {
  const routes = { 'PUT wc/v3/orders/3002': { status: 500, body: { code: 'x' } }, 'PUT wc/v3/orders/3003': (c: any) => ({ body: { id: 3003, status: c.body.status } }) };
  const { db, woo, deps } = setup({ seed: multiSeed(), routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'push_status', order_id: 3001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
  assertEquals([res.status, body], [502, { error: 'woo_error', subs: [3003], failed: [3002] }]);
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/orders/3002', 'wc/v3/orders/3003']);
  assertEquals(db.rows('sub_orders').find((s: any) => s.woo_order_id === 3003).woo_status, 'ready-shipping');
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.result, log.detail.subs, log.detail.failed], ['error', [3003], [3002]]);
  // 404 = gone; and the lines point to no sub-order → every row of the order that is not trashed
  const loose = { ...multiSeed(), order_items: multiSeed().order_items.map((i: any) => ({ ...i, sub_order_id: i.order_id === 3001 ? null : i.sub_order_id })) };
  const g = setup({ seed: loose, routes: { 'PUT wc/v3/orders/3002': { status: 404, body: { code: 'woocommerce_rest_shop_order_invalid_id' } }, 'PUT wc/v3/orders/3003': (c: any) => ({ body: { id: 3003, status: c.body.status } }), 'PUT wc/v3/orders/3009': (c: any) => ({ body: { id: 3009, status: c.body.status } }) }, env: PUSH_ON });
  const r = await call(g.deps, { action: 'push_status', order_id: 3001, status: 'جاهز للشحن' }, { jwt: 'jwt-ops' });
  assertEquals([r.res.status, r.body.subs], [200, [3003, 3009]]);
  assertEquals(g.woo.calls.map((c) => c.path), ['wc/v3/orders/3002', 'wc/v3/orders/3003', 'wc/v3/orders/3009']);
  assertEquals(g.db.rows('woo_sync_log')[0].detail.gone, 1);
});

// ---------------------------------------------------------------- register_webhooks

Deno.test('register_webhooks creates ours next to the n8n ones, re-activates ours, never touches a foreign webhook', async () => {
  const list = [
    { id: 66, name: 'Send Order - Air table', topic: 'order.created', status: 'active', delivery_url: 'https://x.app.n8n.cloud/webhook/abc' },
    { id: 75, name: 'n8n', topic: 'order.updated', status: 'disabled', delivery_url: 'https://x.app.n8n.cloud/webhook/def' },
    { id: 80, name: 'ibtekr-ops:order.updated', topic: 'order.updated', status: 'active', delivery_url: 'https://elsewhere.test/hook' },
    { id: 81, name: 'ibtekr-ops:order.created', topic: 'order.created', status: 'disabled', delivery_url: OURS },
    { id: '1/../2', name: 'ibtekr-ops:product.created', topic: 'product.created', status: 'disabled', delivery_url: OURS },
  ];
  let next = 100;
  const routes = {
    'GET wc/v3/webhooks': page(list),
    'POST wc/v3/webhooks': (c: any) => ({ status: 201, body: { id: next++, name: c.body.name, topic: c.body.topic, status: c.body.status, delivery_url: c.body.delivery_url, secret: c.body.secret } }),
    'PUT wc/v3/webhooks/81': (c: any) => ({ body: { ...list[3], status: c.body.status } }),
  };
  const { woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'register_webhooks', delivery_url: OURS }, { jwt: 'jwt-admin' });
  assertEquals(res.status, 200);

  const writes = woo.calls.filter((c) => c.method !== 'GET');
  assertEquals(writes.map((c) => `${c.method} ${c.path}`), ['PUT wc/v3/webhooks/81', 'POST wc/v3/webhooks', 'POST wc/v3/webhooks', 'POST wc/v3/webhooks']);
  assertEquals(writes[0].body, { status: 'active', secret: ENV.WOO_WEBHOOK_SECRET });
  assertEquals(writes.slice(1).map((c) => c.body), ['order.updated', 'product.created', 'product.updated'].map((topic) =>
    ({ name: `ibtekr-ops:${topic}`, topic, delivery_url: OURS, secret: ENV.WOO_WEBHOOK_SECRET, status: 'active' })));
  assert(woo.calls.every((c) => c.headers.authorization === WC_AUTH));
  assertFalse(woo.calls.some((c) => /\/(66|75|80)$/.test(c.path)), 'foreign webhooks untouched');
  assert(writes.every((c) => /^wc\/v3\/webhooks(\/\d+)?$/.test(c.path)), 'a webhook id that is not an integer is never put in a path');

  assertEquals(body.counts, { created: 3, updated: 1, unchanged: 0 });
  assertEquals(body.webhooks.map((h: any) => [h.id, h.topic, h.status]), [[81, 'order.created', 'active'], [100, 'order.updated', 'active'], [101, 'product.created', 'active'], [102, 'product.updated', 'active']]);
  assertFalse(JSON.stringify(body).includes(ENV.WOO_WEBHOOK_SECRET), 'the secret is never returned');
});

Deno.test('register_webhooks refuses a delivery_url that is not our woo-webhook function', async () => {
  const { woo, deps } = setup();
  const { res, body } = await call(deps, { action: 'register_webhooks', delivery_url: 'https://evil.test/hook' }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body], [400, { error: 'delivery_url_mismatch' }]);
  assertEquals(woo.calls.length, 0);
});

// ---------------------------------------------------------------- store sync (phase 3.3, decisions 3 / 4 a)

// A full-payload store and a vendors row that match it, with the snapshot of a previous run (every value made up).
// the digest of wooStoreFull's payment.bank (phase 3.5): a snapshot that already knows the site's bank
const SITE_BANK = { ac_name: 'x', ac_number: '1', ac_type: '', bank_name: '', bank_addr: '', iban: 'EG00TEST', swift: '', routing_number: '' };
const BANK_KEY = await bankDigest(SITE_BANK);
const SNAP44 = { name: 'Store 44', phone: '01000000000', email: 'store@example.test', contact_name: 'Maker Owner 44', status: 'active', bank: BANK_KEY,
  address_parts: { street_1: 'شارع 44', street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG' },
  social: { fb: 'https://fb.test/44', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' },
  rate: { rate: 30, flat: null }, category_rates: [] };
const synced44 = (extra: any = {}) => vendorRow(44, { ...SNAP44, rate: undefined, category_rates: undefined, woo_snapshot: SNAP44, address: 'شارع 44، القاهرة، EG-01', ...extra });
const rate44 = (rate: number, since = '2026-10-01', extra: any = {}) => ({ vendor_id: vendorId(44), rate, since, set_by: 'x', ...extra });
const activity = (db: any) => db.rows('activity_log').map((r: any) => [r.action, r.entity_id, r.new_value]);
const conflictRows = (db: any) => db.rows('woo_sync_log').filter((r: any) => r.result === 'conflict').map((r: any) => [r.entity, r.entity_id, r.detail.fields, r.detail.first_run]);

Deno.test('store sync — the four cases of decision 3: site only → written here + vendor.sync; system only (not pending) → left alone; both → the site wins + conflict rows; same → nothing', async () => {
  // site only: phone; system only (not pending): contact_name; both: name; same: the rest
  const seed = { vendors: [synced44({ name: 'اسم الفريق', contact_name: 'صاحب من الفريق' })], vendor_rates: [rate44(30)] };
  const store = wooStoreFull(44, { store_name: 'Site 44', phone: '01000000011' });
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([store]) }, env: PUSH_ON });
  const { body } = await call(deps, { action: 'vendors' });
  assertEquals(body.counts.vendors, { vendors: 1, from_site: 1, conflicts: 1, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0, removed: 0, back: 0, pages: 1, done: true });
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.name, v.phone, v.contact_name, v.status, v.push_pending], ['Site 44', '01000000011', 'صاحب من الفريق', 'active', null]);
  assertEquals([v.woo_snapshot.name, v.woo_snapshot.phone, v.woo_snapshot.contact_name], ['Site 44', '01000000011', 'Maker Owner 44'], 'the snapshot is the site as of this run');
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').length, 0, 'a system-only change that is not pending is never pushed by the sync');
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'name, phone'], ['vendor.sync.conflict', vendorId(44), 'name']]);
  assertEquals(conflictRows(db), [['vendor', '44', ['name'], false]]);
  assertEquals(db.rows('vendor_rates').length, 1, 'the rate is the same on both sides: no new row');
  const text = writtenText(db) + JSON.stringify(db.rows('activity_log'));
  assertFalse(text.includes('01000000011') || text.includes('اسم الفريق') || text.includes('Site 44'), 'the logs carry field names, never a value');
});

Deno.test('store sync — pending push: a system-only field in push_pending is PUT to the site in the same run (those fields only, from the row), the snapshot takes the answer and push_pending is cleared; a 4xx keeps it pending with an error row', async () => {
  const seed = { vendors: [synced44({ phone: '01000000022', contact_name: 'Maker Owner 44 Jr', push_pending: ['phone', 'contact_name', 'name'] })], vendor_rates: [rate44(30)] };
  const store = wooStoreFull(44);
  const routes = { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, phone: c.body.phone, first_name: c.body.first_name, last_name: c.body.last_name } }) };
  const { db, woo, deps } = setup({ seed, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'vendors' });
  assertEquals([body.counts.vendors.pushed, body.counts.vendors.from_site], [1, 0]);
  const put = woo.calls.find((c) => c.method === 'PUT')!;
  assertEquals([put.path, put.body, 'authorization' in put.headers], ['dokan/v1/stores/44', { phone: '01000000022', first_name: 'Maker', last_name: 'Owner 44 Jr' }, false], 'the pending fields only; name is not pending-and-changed, so it is not sent');
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.phone, v.contact_name, v.push_pending, v.woo_snapshot.phone, v.woo_snapshot.contact_name], ['01000000022', 'Maker Owner 44 Jr', null, '01000000022', 'Maker Owner 44 Jr']);
  const out = db.rows('woo_sync_log').find((r: any) => r.direction === 'out')!;
  assertEquals([out.kind, out.entity, out.entity_id, out.result, out.detail.fields, out.detail.accepted, out.detail.refused], ['push', 'vendor', '44', 'ok', ['phone', 'contact_name'], ['phone', 'contact_name'], []]);
  assertEquals(activity(db), [], 'a push is not a site-side change');
  // the same with the site down (500) → pending stays, an error row without the phone, the run goes on
  const w2 = setup({ seed, routes: { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': { status: 500, text: `{"code":"internal_server_error","message":"boom ${PHONE}"}` } }, env: PUSH_ON });
  const r2 = await call(w2.deps, { action: 'vendors' });
  assertEquals([r2.res.status, r2.body.counts.vendors.push_failed, r2.body.counts.vendors.push_refused, r2.body.counts.vendors.pushed], [200, 1, 0, 0]);
  const v2 = w2.db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v2.push_pending, v2.woo_snapshot.phone], [['phone', 'contact_name'], '01000000000'], 'still pending (name dropped: not a change); the snapshot keeps the site\'s value');
  const err = w2.db.rows('woo_sync_log').find((r: any) => r.result === 'error')!;
  assertEquals([err.direction, err.entity, err.detail.fields], ['out', 'vendor', ['phone', 'contact_name']]);
  assertFalse(writtenText(w2.db).includes(PHONE));
  assertEquals(activity(w2.db), []);
  // the site refusing the values (400 — review I-3): the fields leave push_pending, one skipped/refused row (not error), one activity row
  // with the names only; a second run sends nothing
  const w3 = setup({ seed, routes: { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': { status: 400, text: `{"code":"rest_invalid_param","message":"bad ${PHONE}"}` } }, env: PUSH_ON });
  const r3 = await call(w3.deps, { action: 'vendors' });
  assertEquals([r3.res.status, r3.body.counts.vendors.push_failed, r3.body.counts.vendors.push_refused, r3.body.counts.vendors.pushed], [200, 0, 1, 0]);
  const v3 = w3.db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v3.push_pending, v3.woo_snapshot.phone, v3.phone], [null, '01000000000', '01000000022'], 'nothing pending any more; the snapshot and our row are untouched');
  const ref = w3.db.rows('woo_sync_log').find((r: any) => r.direction === 'out')!;
  assertEquals([ref.result, ref.detail.reason, ref.detail.fields, ref.detail.error.includes('HTTP 400')], ['skipped', 'refused', ['phone', 'contact_name'], true]);
  assertEquals(w3.db.rows('woo_sync_log').filter((r: any) => r.result === 'error').length, 0);
  assertEquals(activity(w3.db), [['vendor.sync.refused', vendorId(44), 'phone, contact_name']]);
  assertFalse(writtenText(w3.db).includes(PHONE));
  w3.woo.calls.length = 0;
  await call(w3.deps, { action: 'vendors' });
  assertEquals(w3.woo.calls.filter((c) => c.method === 'PUT').length, 0, 'not retried');
});
Deno.test('store sync — a future-dated rate (review I-2) is held: pending `rate` is not pushed while the newest row is after today, stays pending, and goes on its day with that row\'s figure', async () => {
  const store = wooStoreFull(44);
  const routes = { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) };
  const seed = { vendors: [synced44({ push_pending: ['rate'] })], vendor_rates: [rate44(30), rate44(50, '2026-10-26')] };
  const { db, woo, deps } = setup({ seed, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'vendors' });
  assertEquals([body.counts.vendors.pushed, body.counts.vendors.push_held, woo.calls.filter((c) => c.method === 'PUT').length], [0, 1, 0]);
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').push_pending, ['rate'], 'kept for its day');
  // Cairo's calendar: 22:30 UTC on the 25th is already the 26th in Cairo → the row applies, the push goes
  const late = { ...deps, now: () => '2026-10-25T22:30:00.000Z' };
  const r2 = await call(late, { action: 'vendors' });
  const put = woo.calls.find((c) => c.method === 'PUT')!;
  assertEquals([r2.body.counts.vendors.pushed, r2.body.counts.vendors.push_held, put.body], [1, 0, { admin_commission_type: 'fixed', admin_commission: '50' }]);
  assertEquals([db.row('vendors', 44, 'woo_vendor_id').push_pending, db.row('vendors', 44, 'woo_vendor_id').woo_snapshot.rate], [null, { type: 'fixed', rate: 50, flat: null }]);
});
Deno.test('cairoDate: the team\'s day is Cairo\'s (UTC+3 in October, UTC+2 in December); a bad value falls back to its first ten characters', () => {
  assertEquals([cairoDate('2026-10-25T22:30:00.000Z'), cairoDate('2026-10-25T12:00:00.000Z'), cairoDate('2026-12-01T22:30:00Z'), cairoDate('2026-12-01T21:30:00Z'), cairoDate('2026-13-99')],
    ['2026-10-26', '2026-10-25', '2026-12-02', '2026-12-01', '2026-13-99']);
});

Deno.test('store sync — the gate: with WOO_PUSH_ENABLED unset the pending fields are not pushed (no PUT), stay pending, and the site\'s own changes are still written', async () => {
  const seed = { vendors: [synced44({ phone: '01000000022', push_pending: ['phone'] })], vendor_rates: [rate44(30)] };
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44, { store_name: 'Site 44' })]) } });
  await call(deps, { action: 'vendors' });
  assertEquals(woo.calls.map((c) => c.method), ['GET']);
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.name, v.phone, v.push_pending], ['Site 44', '01000000022', ['phone']]);
});

Deno.test('store sync — both sides changed the same pending field → the site wins, it leaves push_pending, conflict rows', async () => {
  const seed = { vendors: [synced44({ phone: '01000000022', push_pending: ['phone'] })], vendor_rates: [rate44(30)] };
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44, { phone: '01000000033' })]) }, env: PUSH_ON });
  await call(deps, { action: 'vendors' });
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').length, 0);
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.phone, v.push_pending], ['01000000033', null]);
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'phone'], ['vendor.sync.conflict', vendorId(44), 'phone']]);
  assertEquals(conflictRows(db), [['vendor', '44', ['phone'], false]]);
});

Deno.test('store sync — the first run (no snapshot): empty fields are filled from the site, filled and equal stay, filled and different stay with a conflict row (first_run true), nothing is pushed even when pending; status follows enabled', async () => {
  const seed = { vendors: [vendorRow(44, { name: 'ورشة الفريق', phone: null, email: null, contact_name: null, address_parts: null, social: null, address: null, status: 'active', push_pending: ['name'] })] };
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44, { enabled: false })]) }, env: PUSH_ON });
  const { body } = await call(deps, { action: 'vendors' });
  assertEquals([body.counts.vendors.from_site, body.counts.vendors.conflicts, body.counts.vendors.pushed], [1, 1, 0]);
  assertEquals(woo.calls.map((c) => c.method), ['GET'], 'no PUT on a first run');
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.name, v.phone, v.contact_name, v.address, v.status, v.push_pending], ['ورشة الفريق', '01000000000', 'Maker Owner 44', 'شارع 44، القاهرة، EG-01', 'inactive', ['name']], 'name stays (ours, filled, pending for the next run); the rest filled; enabled false → inactive');
  assertEquals(v.address_parts, SNAP44.address_parts);
  assertEquals(v.woo_snapshot.name, 'Store 44', 'the snapshot is the site: the next run sees our name as a system-side change');
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'phone, email, contact_name, address_parts, social, status, rate, bank'], ['vendor.sync.conflict', vendorId(44), 'name']]);
  assertEquals(db.rows('vendor_bank').map((r: any) => [r.holder, r.account_number, r.iban, r.method, r.updated_by]), [['x', '1', 'EG00TEST', 'bank', 'الموقع']], 'phase 3.5: the site\'s bank written on the first run');
  assertEquals(conflictRows(db), [['vendor', '44', ['name'], true]]);
  assertEquals(db.rows('vendor_rates').map((r: any) => [r.rate, r.flat, r.since, r.set_by]), [[30, null, NOW.slice(0, 10), 'الموقع']], 'the rate was empty here: filled from the site');
  // the second run: our pending name is pushed now
  const store = wooStoreFull(44, { enabled: false });
  const w2 = setup({ seed: { vendors: [db.row('vendors', 44, 'woo_vendor_id')], vendor_rates: db.rows('vendor_rates') }, routes: { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, store_name: c.body.store_name } }) }, env: PUSH_ON });
  await call(w2.deps, { action: 'vendors' });
  assertEquals(w2.woo.calls.find((c) => c.method === 'PUT')!.body, { store_name: 'ورشة الفريق' });
  assertEquals([w2.db.row('vendors', 44, 'woo_vendor_id').push_pending, w2.db.row('vendors', 44, 'woo_vendor_id').woo_snapshot.name], [null, 'ورشة الفريق']);
});

Deno.test('store sync — status: enabled false → inactive; enabled true keeps «في إجازة» (leave) and reactivates an inactive row; a site name that is a #placeholder never overwrites ours', async () => {
  const snap900 = { ...SNAP44, name: 'Store 900', status: 'inactive', contact_name: 'Maker Owner 900', address_parts: { ...SNAP44.address_parts, street_1: 'شارع 900' }, social: { ...SNAP44.social, fb: 'https://fb.test/900' } };
  const row900 = vendorRow(900, { ...snap900, rate: undefined, category_rates: undefined, name: 'اسم عندنا', woo_snapshot: snap900 });
  const seed = { vendors: [synced44({ status: 'leave' }), row900], vendor_rates: [rate44(30), { vendor_id: vendorId(900), rate: 30, since: '2026-10-01' }] };
  const { db, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44, { enabled: true }), wooStoreFull(900, { enabled: true, store_name: '' })]) } });
  await call(deps, { action: 'vendors' });
  assertEquals([db.row('vendors', 44, 'woo_vendor_id').status, db.row('vendors', 900, 'woo_vendor_id').status, db.row('vendors', 900, 'woo_vendor_id').name], ['leave', 'active', 'اسم عندنا']);
  assertEquals(activity(db), [['vendor.sync', vendorId(900), 'status']], 'leave is no change; 900 reactivated; the #900 name is ignored');
  // enabled false on the leave row → inactive
  const w2 = setup({ seed: { vendors: [synced44({ status: 'leave' })] }, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44, { enabled: false })]) } });
  await call(w2.deps, { action: 'vendors' });
  assertEquals(w2.db.row('vendors', 44, 'woo_vendor_id').status, 'inactive');
});

Deno.test('store sync — the commission (decision 2): a site-side change of the effective percentage → one vendor_rates row (today, «الموقع», flat kept) and commission_pct; the next run writes nothing more; category items → vendor_category_rates rows, a dropped category → rate null', async () => {
  const seed = { vendors: [synced44()], vendor_rates: [rate44(30)] };
  const store = wooStoreFull(44, { admin_commission_type: 'category_based', admin_commission: '30', admin_additional_fee: '5',
    admin_category_commission: { all: { flat: '5', percentage: '35' }, items: { '15': { flat: '0', percentage: '20' }, '16': { flat: '', percentage: '25' }, 'x': { percentage: '1' } } } });
  const { db, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([store]) } });
  await call(deps, { action: 'vendors' });
  const today = NOW.slice(0, 10);
  assertEquals(db.rows('vendor_rates').map((r: any) => [r.rate, r.flat, r.since, r.set_by, r.commission_type ?? 'fixed']), [[30, null, '2026-10-01', 'x', 'fixed'], [35, 5, today, 'الموقع', 'category_based']]);
  assertEquals(db.rows('vendor_category_rates').map((r: any) => [r.woo_category_id, r.rate, r.flat, r.since, r.set_by]), [[15, 20, 0, today, 'الموقع'], [16, 25, null, today, 'الموقع']]);
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.commission_pct, v.woo_snapshot.rate, v.woo_snapshot.category_rates], [35, { type: 'category_based', rate: 35, flat: 5 }, [{ woo_category_id: 15, rate: 20, flat: 0 }, { woo_category_id: 16, rate: 25, flat: null }]]);
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'rate, category_rates']]);
  // the same payload again: nothing changed since the snapshot → no new rows, no activity
  const w2 = setup({ seed: { vendors: [v], vendor_rates: db.rows('vendor_rates'), vendor_category_rates: db.rows('vendor_category_rates') }, routes: { 'GET dokan/v1/stores': page([store]) } });
  await call(w2.deps, { action: 'vendors' });
  assertEquals([w2.db.rows('vendor_rates').length, w2.db.rows('vendor_category_rates').length, activity(w2.db)], [2, 2, []]);
  // the site goes back to fixed 30: a fixed 30 row for today (replacing today's 35: last change wins); our hand-set category rows stay
  // (plan 3.4, decision 4: a site on `fixed` leaves them alone — a later switch back to category_based finds them)
  const w3 = setup({ seed: { vendors: [v], vendor_rates: db.rows('vendor_rates'), vendor_category_rates: db.rows('vendor_category_rates') }, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44)]) } });
  await call(w3.deps, { action: 'vendors' });
  assertEquals(w3.db.rows('vendor_rates').map((r: any) => [r.rate, r.flat, r.since, r.commission_type ?? 'fixed']), [[30, null, '2026-10-01', 'fixed'], [30, null, today, 'fixed']]);
  assertEquals(w3.db.rows('vendor_category_rates').map((r: any) => [r.woo_category_id, r.rate]), [[15, 20], [16, 25]]);
  assertEquals(w3.db.row('vendors', 44, 'woo_vendor_id').commission_pct, 30);
  assertFalse(JSON.stringify(w3.db.rows('activity_log')).includes('30'), 'no figure in activity_log');
});

Deno.test('plan 3.4 — category_based on the tree: the push sends every category with its figure (a parent\'s figure inherited by its children, a hand-set child kept, the rest the default); the pull reads inherited items back as inherited (no rows), a hand-set child as hand-set', async () => {
  // the tree: 100 → 110 → 111, 100 → 120; 200 alone
  const cats = [{ id: 100, name: 'A', parent_id: null }, { id: 110, name: 'A1', parent_id: 100 }, { id: 111, name: 'A11', parent_id: 110 }, { id: 120, name: 'A2', parent_id: 100 }, { id: 200, name: 'B', parent_id: null }];
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) };
  const seed = { vendors: [PUSH_ROW], woo_categories: cats, vendor_rates: [rate44(40, '2026-10-20', { commission_type: 'category_based' })],
    vendor_category_rates: [{ vendor_id: vendorId(44), woo_category_id: 100, rate: 30, flat: 0, since: '2026-10-21' }, { vendor_id: vendorId(44), woo_category_id: 111, rate: 20, flat: 0, since: '2026-10-21' }] };
  const { woo, deps, db } = setup({ seed, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate', 'category_rates'] }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.accepted], ['ok', ['rate', 'category_rates']]);
  const fig = (p: string, f = '0') => ({ percentage: p, flat: f });
  assertEquals(woo.calls[0].body.admin_category_commission, { all: { percentage: '40', flat: '' }, items: { '100': fig('30'), '110': fig('30'), '111': fig('20'), '120': fig('30'), '200': { percentage: '40', flat: '' } } },
    'A and its children 30 (inherited), A11 20 (by hand), B the default');
  // the pull of the same items: nothing changes (the meaning is the same), no rows, no activity
  const pulled = wooStoreFull(44, { admin_commission_type: 'category_based', admin_commission: '40', admin_category_commission: woo.calls[0].body.admin_category_commission });
  const w2 = setup({ seed: { vendors: [db.row('vendors', 44, 'woo_vendor_id')], woo_categories: cats, vendor_rates: seed.vendor_rates, vendor_category_rates: seed.vendor_category_rates },
    routes: { 'GET dokan/v1/stores': page([pulled]) } });
  await call(w2.deps, { action: 'vendors' });
  assertEquals([w2.db.rows('vendor_rates').length, w2.db.rows('vendor_category_rates').length, activity(w2.db)], [1, 2, []]);
  // the site changes A to 35 and sets A2 to 10: A becomes 35 (by hand), A1 inherits (no row), A11 stays 20, A2 10 by hand
  const changed = structuredClone(pulled);
  Object.assign(changed.admin_category_commission.items, { '100': fig('35'), '110': fig('35'), '120': fig('10') });
  const w3 = setup({ seed: { vendors: [db.row('vendors', 44, 'woo_vendor_id')], woo_categories: cats, vendor_rates: seed.vendor_rates, vendor_category_rates: seed.vendor_category_rates },
    routes: { 'GET dokan/v1/stores': page([changed]) } });
  await call(w3.deps, { action: 'vendors' });
  const today = NOW.slice(0, 10);
  assertEquals(w3.db.rows('vendor_category_rates').filter((r: any) => r.since === today).map((r: any) => [r.woo_category_id, r.rate]), [[100, 35], [120, 10]]);
  assertEquals(activity(w3.db), [['vendor.sync', vendorId(44), 'category_rates']]);
});
Deno.test('store sync — the site\'s commission figure missing (the public shape) says nothing: our rate stays, no row, no conflict', async () => {
  const seed = { vendors: [vendorRow(44, { name: 'Store 44' })], vendor_rates: [rate44(30)] };
  const { db, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStore(44)]) } });
  await call(deps, { action: 'vendors' });
  assertEquals([db.rows('vendor_rates').length, conflictRows(db).length, activity(db).map((a: any) => a[2])], [1, 0, ['phone, email']], 'the phone is filled (first run); the rate is not touched or reported');
});

// ---------------------------------------------------------------- push_vendor (phase 3.3, decision 4 b)

const PUSH_ROW = synced44({ name: 'ورشة الفريق', phone: '01000000022', social: { ...SNAP44.social, instagram: 'https://instagram.test/x' } });

Deno.test('push_vendor by a vendors follow-up member (vendors.edit F): the row\'s values (never the body\'s) → one PUT dokan/v1/stores/{id} with the asked fields only; snapshot + woo_synced_at updated, push_pending minus them; accepted / refused from the answer', async () => {
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, store_name: c.body.store_name, phone: c.body.phone, social: { ...store.social, ...c.body.social, instagram: '' } } }) };
  const { db, woo, deps } = setup({ seed: { vendors: [{ ...PUSH_ROW, push_pending: ['phone', 'email'] }] }, routes, env: { ...PUSH_ON, WOO_WP_USER: 'admin', WOO_WP_APP_PASSWORD: 'abcd efgh' } });
  const { res, body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['name', 'phone', 'social'], name: 'من الجسم', phone: '01099999999' }, { jwt: 'jwt-vf' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'push_vendor', result: 'ok', fields: ['name', 'phone', 'social'], accepted: ['name', 'phone'], refused: ['social'], dropped: [], held: [], counts: { pushed: 1 } });
  assertEquals(woo.calls.map((c) => c.method), ['PUT']);
  const put = woo.calls[0];
  assertEquals([put.path, put.body, put.headers.authorization], ['dokan/v1/stores/44', { store_name: 'ورشة الفريق', phone: '01000000022', social: PUSH_ROW.social }, 'Basic ' + btoa('admin:abcd efgh')]);
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.woo_snapshot.name, v.woo_snapshot.phone, v.woo_snapshot.social.instagram, v.woo_synced_at, v.push_pending], ['ورشة الفريق', '01000000022', '', NOW, ['email']], 'the snapshot takes the site\'s answer (instagram refused there), email stays pending');
  assertEquals([v.name, v.phone], ['ورشة الفريق', '01000000022'], 'the row itself is untouched');
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.result, log.detail], ['push', 'out', 'vendor', '44', 'ok', { vendor_id: vendorId(44), fields: ['name', 'phone', 'social'], accepted: ['name', 'phone'], refused: ['social'], dropped: [] }]);
  assertFalse(writtenText(db).includes('01000000022'));
});

Deno.test('push_vendor: the commission fields need sensitive.commission = F (the admin passes); the PUT carries toDokanCommission of the effective rows', async () => {
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) };
  const seed = { vendors: [PUSH_ROW], vendor_rates: [rate44(30), rate44(40, '2026-10-20', { flat: 2, commission_type: 'category_based' })],
    vendor_category_rates: [{ vendor_id: vendorId(44), woo_category_id: 15, rate: 20, flat: null, since: '2026-10-02' }, { vendor_id: vendorId(44), woo_category_id: 15, rate: 22, flat: 1, since: '2026-10-21' }, { vendor_id: vendorId(44), woo_category_id: 16, rate: null, since: '2026-10-21' }] };
  const { woo, deps, db } = setup({ seed, routes, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate'] }, { jwt: 'jwt-vf' })).res.status, 401, 'vendors.edit F without sensitive.commission');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'category_rates'] }, { jwt: 'jwt-vf' })).res.status, 401);
  // ops (vendors.edit P): the contact fields it may edit pass; name, status or a rate field do not; an empty list is 400 after a pass
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['name'] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: name is not a contact field');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'status'] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: status needs F');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'rate'] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: a rate field needs F + commission');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: [] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: nothing to push is not a contact push');
  const opsPush = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'social'] }, { jwt: 'jwt-ops' });
  assertEquals([opsPush.res.status, opsPush.body.result], [200, 'ok'], 'ops: the contact fields push');
  woo.calls.length = 0;
  const { res, body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate', 'category_rates'] }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body.result, body.accepted], [200, 'ok', ['rate', 'category_rates']]);
  assertEquals(woo.calls[0].body, { admin_commission_type: 'category_based', admin_category_commission: { all: { percentage: '40', flat: '2' }, items: { '15': { percentage: '22', flat: '1' } } } }, 'the effective rows today: 40 / 2, category 15 at 22 (16 removed)');
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').woo_snapshot.rate, { type: 'category_based', rate: 40, flat: 2 });
  // without category rates: fixed
  const w2 = setup({ seed: { vendors: [PUSH_ROW], vendor_rates: [rate44(30)] }, routes, env: PUSH_ON });
  await call(w2.deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate'] }, { jwt: 'jwt-admin' });
  assertEquals(w2.woo.calls[0].body, { admin_commission_type: 'fixed', admin_commission: '30' });
  // no rate at all → placeholder-like skip (nothing to send)
  const w3 = setup({ seed: { vendors: [PUSH_ROW] }, routes, env: PUSH_ON });
  const r3 = await call(w3.deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate'] }, { jwt: 'jwt-admin' });
  assertEquals([r3.body.result, r3.body.reason, w3.woo.calls.length], ['skipped', 'placeholder', 0]);
});

Deno.test('push_vendor: a #placeholder name is never sent (dropped; alone → skipped/placeholder, no Woo call)', async () => {
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) };
  const { db, woo, deps } = setup({ seed: { vendors: [{ ...PUSH_ROW, name: '#44', push_pending: ['name'] }] }, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['name'] }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.reason, woo.calls.length], ['skipped', 'placeholder', 0]);
  assertEquals(db.rows('woo_sync_log')[0].detail, { vendor_id: vendorId(44), fields: ['name'], reason: 'placeholder' });
  const r2 = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['name', 'phone'] }, { jwt: 'jwt-admin' });
  assertEquals([r2.body.result, r2.body.fields, r2.body.dropped, woo.calls[0].body], ['ok', ['phone'], ['name'], { phone: '01000000022' }]);
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').push_pending, null, 'a dropped placeholder leaves push_pending too');
});

Deno.test('push_vendor: WOO_PUSH_ENABLED unset → skipped/push_disabled before any Woo call, the fields join push_pending', async () => {
  const { db, woo, deps } = setup({ seed: { vendors: [{ ...PUSH_ROW, push_pending: ['email'] }] } });
  const { res, body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'phone'] }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body], [200, { action: 'push_vendor', result: 'skipped', reason: 'push_disabled', fields: ['phone'], counts: { pushed: 0 } }]);
  assertEquals(woo.calls.length, 0);
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').push_pending, ['email', 'phone']);
  assertEquals([db.rows('woo_sync_log')[0].result, db.rows('woo_sync_log')[0].detail.reason], ['skipped', 'push_disabled']);
});

Deno.test('push_vendor: a retryable failure from Dokan (403 here; 5xx, 401, 408, 429 too) → 502 woo_error pending:true, the fields join push_pending, one out/vendor error row without the phone', async () => {
  const routes = { 'PUT dokan/v1/stores/44': { status: 403, text: `{"code":"dokan_rest_cannot_edit","message":"no ${PHONE}"}` } };
  const { db, deps } = setup({ seed: { vendors: [PUSH_ROW] }, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone'] }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body], [502, { error: 'woo_error', action: 'push_vendor', fields: ['phone'], pending: true }]);
  const v = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.push_pending, v.woo_snapshot.phone], [['phone'], '01000000000']);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.result, log.detail.fields], ['push', 'out', 'vendor', '44', 'error', ['phone']]);
  assert(log.detail.error.includes('HTTP 403'));
  assertFalse(writtenText(db).includes(PHONE));
  assertEquals(activity(db), []);
  // the site's final answer (422 — review I-3): nothing pending, a refused row, an activity row with the names only
  const w2 = setup({ seed: { vendors: [{ ...PUSH_ROW, push_pending: ['email'] }] }, routes: { 'PUT dokan/v1/stores/44': { status: 422, text: `{"code":"rest_invalid_param","message":"bad ${PHONE}"}` } }, env: PUSH_ON });
  const r2 = await call(w2.deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone'] }, { jwt: 'jwt-admin' });
  assertEquals([r2.res.status, r2.body], [502, { error: 'woo_error', action: 'push_vendor', fields: ['phone'], pending: false }]);
  assertEquals(w2.db.row('vendors', 44, 'woo_vendor_id').push_pending, ['email'], 'the earlier pending field stays; the refused one is not added');
  const ref = w2.db.rows('woo_sync_log')[0];
  assertEquals([ref.result, ref.detail.reason, ref.detail.fields, ref.detail.error.includes('HTTP 422')], ['skipped', 'refused', ['phone'], true]);
  assertEquals(activity(w2.db), [['vendor.sync.refused', vendorId(44), 'phone']]);
  assertFalse(writtenText(w2.db).includes(PHONE));
});
Deno.test('push_vendor: a future-dated rate (review I-2) is held — alone → skipped/future with `rate` pending and no PUT; with a contact field → that field goes, `rate` is held pending', async () => {
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) };
  const { db, woo, deps } = setup({ seed: { vendors: [PUSH_ROW], vendor_rates: [rate44(30), rate44(50, '2099-01-01')] }, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['rate'] }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body, woo.calls.length], [200, { action: 'push_vendor', result: 'skipped', reason: 'future', fields: ['rate'], counts: { pushed: 0 } }, 0]);
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').push_pending, ['rate']);
  const r2 = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone', 'rate'] }, { jwt: 'jwt-admin' });
  assertEquals([r2.body.result, r2.body.fields, r2.body.held, woo.calls.length, woo.calls[0].body], ['ok', ['phone'], ['rate'], 1, { phone: '01000000022' }]);
  assertEquals(db.row('vendors', 44, 'woo_vendor_id').push_pending, ['rate'], 'still waiting for its day');
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.result, r.detail.reason ?? null]), [['skipped', 'future'], ['ok', null]]);
});

Deno.test('push_vendor: a maker without a store → skipped/no_store (nothing pending); unknown maker → 404; bad body (no fields, a field outside the list, a bad uuid) → 400; no Woo call', async () => {
  const { db, woo, deps } = setup({ seed: { vendors: [vendorRow(44), { id: '00000000-0000-4000-8000-00000000aaaa', name: 'يدوي', woo_vendor_id: null }] }, env: PUSH_ON });
  const r = await call(deps, { action: 'push_vendor', vendor_id: '00000000-0000-4000-8000-00000000aaaa', fields: ['phone'] }, { jwt: 'jwt-admin' });
  assertEquals([r.res.status, r.body.result, r.body.reason], [200, 'skipped', 'no_store']);
  assertEquals(db.row('vendors', '00000000-0000-4000-8000-00000000aaaa').push_pending, null);
  assertEquals(db.rows('woo_sync_log')[0].entity_id, '00000000-0000-4000-8000-00000000aaaa');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: '00000000-0000-4000-8000-00000000bbbb', fields: ['phone'] }, { jwt: 'jwt-admin' })).res.status, 404);
  for (const bad of [{ vendor_id: vendorId(44) }, { vendor_id: vendorId(44), fields: [] }, { vendor_id: vendorId(44), fields: ['raw'] }, { vendor_id: 44, fields: ['phone'] }, { vendor_id: "x' or 1=1", fields: ['phone'] }]) {
    assertEquals((await call(deps, { action: 'push_vendor', ...bad }, { jwt: 'jwt-admin' })).res.status, 400, JSON.stringify(bad));
  }
  assertEquals(woo.calls.length, 0);
});

Deno.test('push_vendor: accounts, a truthy-but-wrong admin and nobody are refused with 401 and nothing is read; ops (vendors.edit P) only for a name / status field; the cron secret may push', async () => {
  const store = wooStoreFull(44);
  const { db, woo, deps } = setup({ seed: { vendors: [PUSH_ROW] }, routes: { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, ...c.body } }) }, env: PUSH_ON });
  for (const jwt of ['jwt-acct', 'jwt-admin-text', 'jwt-nobody']) {
    assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone'] }, { jwt })).res.status, 401, jwt);
  }
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['name'] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: name');
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['status'] }, { jwt: 'jwt-ops' })).res.status, 401, 'ops: status');
  assertEquals([db.writes().length, woo.calls.length], [0, 0]);
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['phone'] })).body.result, 'ok');
});

// ---------------------------------------------------------------- categories (phase 3.3)

Deno.test('categories: GET wc/v3/products/categories with the WC keys, page by page → woo_categories upserted on id (parent 0 → null, malformed items skipped, nothing deleted), logged ok', async () => {
  const seed = { woo_categories: [{ id: 15, name: 'اسم قديم', slug: 'old', parent_id: null, updated_at: '2026-10-01T00:00:00Z' }, { id: 99, name: 'فئة اتشالت', updated_at: '2026-10-01T00:00:00Z' }] };
  const items = [{ id: 15, name: ' هدايا ', slug: 'gifts', parent: 0, count: 12, description: 'x', image: null, _links: {} }, { id: 16, name: 'شموع', slug: 'candles', parent: 15 },
    { id: 'x', name: 'بدون رقم' }, { id: 17, name: '  ' }, { id: 18 }, { id: 16, name: 'شموع معطرة', parent: 15 }];
  const { db, woo, deps } = setup({ seed, routes: { [CATS]: page(items), 'GET wc/v3/products/brands': page([{ id: 3, name: ' Lusso ', slug: 'lusso', parent: 0, count: 4 }, { id: 'x' }]) } });
  const { res, body } = await call(deps, { action: 'categories' }, { jwt: 'jwt-admin' });
  assertEquals([res.status, body.result, body.counts.categories], [200, 'ok', { categories: 2, skipped: 3, failed: 0, brands: 1, pages: 1, done: true }]);
  assertEquals(db.rows('woo_brands').map((b: any) => [b.id, b.name, b.slug, b.parent_id]), [[3, 'Lusso', 'lusso', null]], 'phase 5: the site\'s brands too');
  assertEquals([woo.calls[0].path, woo.calls[0].query, woo.calls[0].headers.authorization], ['wc/v3/products/categories', { per_page: '100', page: '1' }, WC_AUTH]);
  assertEquals(db.rows('woo_categories').map((c: any) => [c.id, c.name, c.slug, c.parent_id, c.updated_at]),
    [[15, 'هدايا', 'gifts', null, NOW], [99, 'فئة اتشالت', null, null, '2026-10-01T00:00:00Z'], [16, 'شموع معطرة', null, 15, NOW]]);
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result]), [['categories', 'ok']]);
  assertEquals((await call(deps, { action: 'categories' }, { jwt: 'jwt-ops' })).res.status, 401);
});

// ---------------------------------------------------------------- phase 3.5: the bank two-way

const { bank: _b, ...SNAP44_OLD } = SNAP44; // a snapshot from before phase 3.5 (no `bank` key)
const OUR_BANK = { vendor_id: vendorId(44), method: 'wallet', wallet: '01000000044', holder: 'Our Holder', account_number: '999', account_type: 'personal', bank_name: 'Our Bank', bank_address: '', routing_number: '', iban: '', swift: 'OURBEGCX', updated_by: 'x' };

Deno.test('bank (3.5) — the first run of the field: the site\'s bank wins over ours (method / wallet kept); a site without a bank keeps ours and nothing is pushed; the snapshot holds the digest only', async () => {
  const { db, woo, deps } = setup({ seed: { vendors: [synced44({ woo_snapshot: SNAP44_OLD })], vendor_bank: [OUR_BANK] }, routes: { 'GET dokan/v1/stores': page([wooStoreFull(44)]) }, env: PUSH_ON });
  await call(deps, { action: 'vendors' });
  const b = db.rows('vendor_bank')[0];
  assertEquals([b.holder, b.account_number, b.account_type, b.bank_name, b.iban, b.swift, b.method, b.wallet, b.updated_by], ['x', '1', null, null, 'EG00TEST', null, 'wallet', '01000000044', 'الموقع']);
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'bank']]);
  const snap = db.row('vendors', 44, 'woo_vendor_id').woo_snapshot;
  assertEquals(snap.bank, BANK_KEY);
  assertFalse(JSON.stringify(snap).includes('EG00TEST'), 'no bank value in the snapshot');
  assertFalse(JSON.stringify(db.rows('woo_sync_log')).includes('EG00TEST') || JSON.stringify(db.rows('activity_log')).includes('EG00TEST'), 'nor in a log');
  assertEquals(woo.calls.map((c) => c.method), ['GET']);
  // the site without a bank: ours stays, no PUT, no activity
  const empty = wooStoreFull(44, { payment: { bank: { ac_name: '', ac_number: '' }, paypal: { email: '' } } });
  const w2 = setup({ seed: { vendors: [synced44({ woo_snapshot: SNAP44_OLD })], vendor_bank: [OUR_BANK] }, routes: { 'GET dokan/v1/stores': page([empty]) }, env: PUSH_ON });
  await call(w2.deps, { action: 'vendors' });
  assertEquals([w2.db.rows('vendor_bank')[0].account_number, activity(w2.db), w2.woo.calls.map((c) => c.method)], ['999', [], ['GET']]);
});

Deno.test('bank (3.5) — a change on the site is written to vendor_bank; ours pending is PUT as payment.bank alone (never paypal) and the snapshot takes the answer\'s digest; an empty bank of ours is never sent', async () => {
  // the site changed its bank since the snapshot; ours did not move
  const site = wooStoreFull(44, { payment: { bank: { ...SITE_BANK, ac_number: '2' }, paypal: { email: 'p@example.test' } } });
  const theirs = { vendor_id: vendorId(44), holder: 'x', account_number: '1', iban: 'EG00TEST', updated_by: 'x' };
  const { db, deps } = setup({ seed: { vendors: [synced44()], vendor_bank: [theirs] }, routes: { 'GET dokan/v1/stores': page([site]) }, env: PUSH_ON });
  await call(deps, { action: 'vendors' });
  assertEquals([db.rows('vendor_bank')[0].account_number, db.rows('vendor_bank')[0].updated_by], ['2', 'الموقع']);
  assertEquals(activity(db), [['vendor.sync', vendorId(44), 'bank']]);
  // ours changed and pending → PUT { payment: { bank } } only
  const store = wooStoreFull(44);
  const w2 = setup({ seed: { vendors: [synced44({ push_pending: ['bank'] })], vendor_bank: [OUR_BANK] }, env: PUSH_ON,
    routes: { 'GET dokan/v1/stores': page([store]), 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, payment: { ...store.payment, bank: c.body.payment.bank } } }) } });
  await call(w2.deps, { action: 'vendors' });
  const put = w2.woo.calls.find((c) => c.method === 'PUT')!;
  assertEquals(put.body, { payment: { bank: { ac_name: 'Our Holder', ac_number: '999', ac_type: 'personal', bank_name: 'Our Bank', bank_addr: '', routing_number: '', iban: '', swift: 'OURBEGCX' } } });
  const v = w2.db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v.push_pending, v.woo_snapshot.bank === await bankDigest(put.body.payment.bank)], [null, true]);
  const ok = w2.db.rows('woo_sync_log').find((r: any) => r.kind === 'push');
  assertEquals([ok.result, ok.detail.fields, ok.detail.accepted], ['ok', ['bank'], ['bank']]);
  assertFalse(JSON.stringify(w2.db.rows('woo_sync_log')).includes('999'), 'no value in the log');
  // push_vendor ['bank'] with no bank row of ours: dropped, nothing sent
  const w3 = setup({ seed: { vendors: [synced44()] }, env: PUSH_ON, routes: { 'PUT dokan/v1/stores/44': () => ({ body: store }) } });
  const { body } = await call(w3.deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['bank'] }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.reason], ['skipped', 'placeholder']);
  assertEquals(w3.woo.calls.filter((c) => c.method === 'PUT').length, 0);
});

Deno.test('bank (3.5) — push_vendor: `bank` needs sensitive.vendor_bank = F (accounts with vendors.edit = N may push it alone; with a store field it needs vendors.edit too); ops and vendors.edit = F without the key get 401', async () => {
  const store = wooStoreFull(44);
  const routes = { 'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...store, payment: { ...store.payment, bank: c.body.payment?.bank ?? store.payment.bank }, store_name: c.body.store_name ?? store.store_name } }) };
  const { deps, woo } = setup({ seed: { vendors: [synced44()], vendor_bank: [OUR_BANK] }, routes, env: PUSH_ON });
  const ok = await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['bank'] }, { jwt: 'jwt-bank' });
  assertEquals([ok.res.status, ok.body.result, ok.body.accepted], [200, 'ok', ['bank']]);
  assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['bank', 'name'] }, { jwt: 'jwt-bank' })).res.status, 401);
  for (const jwt of ['jwt-ops', 'jwt-vf']) assertEquals((await call(deps, { action: 'push_vendor', vendor_id: vendorId(44), fields: ['bank'] }, { jwt })).res.status, 401, jwt);
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').length, 1);
});


// ---------------------------------------------------------------- the product studio (phase 5.2)

const SB = '0b6f2f5e-1d2c-4a8b-9e3f-1234567890ab';
const BRAND = '00000000-0000-4000-8000-00000000b001';
const studioItem = { nameEn: 'Boho Cushion', nameAr: 'مخدة بوهيمي', serial: 999, colors: ['BE', 'BK'], sizes: [], material: 'Cotton', categories: [20],
  images: [`${SB}/1-1.webp`], variations: [{ color: 'BE', sale: 1200, regular: 1500, stock: 3, image: `${SB}/1-be.webp` }, { color: 'BK', sale: 1200, regular: 1500, onDemand: true }] };
const studioSeed = (item: any = studioItem) => ({
  brands: [{ id: BRAND, name: 'Art Craft', code: 'A' }], sku_colors: [{ id: 1, name_en: 'Beige', name_ar: 'بيج', code: 'BE' }, { id: 2, name_en: 'Black', name_ar: 'أسود', code: 'BK' }],
  studio_batches: [{ id: SB, title: 'دفعة', brand_id: BRAND, vendor_id: vendorId(44), type: 'Variable', state: { items: [item] }, step: 8, status: 'draft' }],
});
const STUDIO_FILES = { [`studio/${SB}/1-1.webp`]: new Uint8Array([1, 2, 3]), [`studio/${SB}/1-be.webp`]: new Uint8Array([4, 5]) };
const WP_ENV = { ...PUSH_ON, WOO_WP_USER: 'wp-user', WOO_WP_APP_PASSWORD: 'wp app pass' };
// the attribute terms the site has, both languages (the fake ignores the query: a search answers the whole list) — the Arabic
// terms exist, so the standard upload makes none (the owner, 2 Nov)
const TERMS: Record<number, any[]> = {
  12: [{ id: 26, name: 'Beige' }, { id: 27, name: 'Black' }, { id: 201, name: 'بيج' }, { id: 202, name: 'أسود' }],
  3: [{ id: 351, name: '40*50 Cm' }, { id: 409, name: '40*50 سم' }],
  15: [{ id: 601, name: 'Cotton' }, { id: 602, name: 'Linen' }],
  13: [{ id: 3055, name: 'Art Craft' }, { id: 3056, name: '@Art-craft' }],
};
function studioRoutes(over: Record<string, any> = {}) {
  let media = 7000;
  return {
    'GET wc/v3/products/attributes': { body: [{ id: 12, slug: 'pa_color' }, { id: 3, slug: 'pa_size' }, { id: 15, slug: 'pa_material' }, { id: 13, slug: 'pa_brand' }] },
    ...Object.fromEntries(Object.entries(TERMS).map(([id, list]) => [`GET wc/v3/products/attributes/${id}/terms`, { body: list }])),
    'POST wp/v2/media': () => ({ body: { id: ++media } }),
    'POST wc/v3/products': (c: any) => (c.body.wpml_language === 'ar' ? { body: { id: 901, lang: 'ar', translations: { en: 900, ar: 901 } } } : { body: wooProduct(900, 44, { type: 'variable', sku: c.body.sku }) }),
    'POST wc/v3/products/900/variations/batch': (c: any) => ({ body: { create: c.body.create.map((_: any, i: number) => ({ id: 9100 + i })) } }),
    'PUT dokan/v1/products/900': (c: any) => ({ body: { id: 900, post_author: String(c.body.post_author), store: { id: c.body.post_author } } }),
    'PUT dokan/v1/products/901': (c: any) => ({ body: { id: 901, post_author: String(c.body.post_author), store: { id: c.body.post_author } } }),
    'GET wc/v3/products/900': { body: wooProduct(900, 44, { type: 'variable', sku: 'IBTAR0999', status: 'draft', lang: 'en', translations: { en: 900, ar: 901 } }) },
    'GET wc/v3/products/901': { body: wooProduct(901, 44, { type: 'variable', status: 'draft', lang: 'ar', translations: { en: 900, ar: 901 } }) },
    ...over,
  };
}

Deno.test('studio_upload (phase 5.2): products.add only; images to the media library, the draft product with its SKU, the variations, the Arabic translation, the maker as author, the mirror; the result on the batch; a retry repeats nothing', async () => {
  const { woo, db, deps } = setup({ seed: studioSeed(), routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  assertEquals((await call(deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-pedit' })).res.status, 401, 'products.edit is not products.add');
  assertEquals((await call(deps, { action: 'studio_upload', batch_id: SB, index: 0 })).res.status, 401, 'never the sync secret');
  const { res, body } = await call(deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([res.status, body.result], [200, 'ok']);
  const media = woo.calls.filter((c) => c.path === 'wp/v2/media');
  assertEquals(media.map((c) => c.headers['content-disposition']), ['attachment; filename="Boho-Cushion-01-IBTAR0999.webp"', 'attachment; filename="Boho-Cushion-01-IBTARBE0999.webp"']);
  assertEquals(media.map((c) => [c.headers['content-type'], c.headers.authorization, c.body]), [['image/webp', 'Basic ' + btoa('wp-user:wp app pass'), { bytes: 3 }], ['image/webp', 'Basic ' + btoa('wp-user:wp app pass'), { bytes: 2 }]]);
  const [en, ar] = woo.calls.filter((c) => c.method === 'POST' && c.path === 'wc/v3/products');
  assertEquals([en.body.status, en.body.type, en.body.sku, en.body.wpml_language, en.body.images, en.body.categories], ['draft', 'variable', 'IBTAR0999', 'en', [{ id: 7001 }], [{ id: 20 }]]);
  assertEquals(en.body.attributes.slice(0, 2), [{ id: 12, visible: true, variation: true, options: ['Beige', 'Black'] }, { id: 15, visible: true, variation: false, options: ['Cotton'] }]);
  assertEquals(en.headers.authorization, WC_AUTH);
  assertEquals([ar.body.lang, ar.body.wpml_language, ar.body.translation_of, ar.body.name, ar.body.status, ar.body.sku], ['ar', 'ar', 900, 'مخدة بوهيمي', 'draft', undefined]);
  // the owner (2 Nov): the translation carries the attributes with the Arabic terms (the color from sku_colors), the same ids
  assertEquals(ar.body.attributes.slice(0, 2), [{ id: 12, visible: true, variation: true, options: ['بيج', 'أسود'] }, { id: 15, visible: true, variation: false, options: ['Cotton'] }]);
  assertEquals(body.item.arAttrs, 'ok');
  assertEquals(en.body.lang, 'en');
  const vars = woo.calls.find((c) => c.path === 'wc/v3/products/900/variations/batch')!.body.create;
  assertEquals(vars.map((v: any) => [v.sku, v.image?.id ?? null, v.manage_stock, v.stock_status ?? null]), [['IBTARBE0999', 7002, true, null], ['IBTARBK0999', null, false, 'onbackorder']]);
  const order = woo.calls.filter((c) => c.method !== 'GET' && c.path !== 'wp/v2/media').map((c) => `${c.method} ${c.path}`);
  assertEquals(order, ['POST wc/v3/products', 'PUT dokan/v1/products/900', 'POST wc/v3/products/900/variations/batch', 'POST wc/v3/products', 'PUT dokan/v1/products/901'], 'the maker before the variations (a new variation takes its product\'s vendor)');
  const authors = woo.calls.filter((c) => c.method === 'PUT' && c.path.startsWith('dokan/v1/products/'));
  assertEquals(authors.map((c) => [c.path, c.body, c.headers.authorization]), [['dokan/v1/products/900', { post_author: 44 }, 'Basic ' + btoa('wp-user:wp app pass')], ['dokan/v1/products/901', { post_author: 44 }, 'Basic ' + btoa('wp-user:wp app pass')]], 'the product and its translation, by Dokan with the Application Password');
  const batch = db.row('studio_batches', SB);
  assertEquals(batch.status, 'done');
  assertEquals([batch.result.items[0].productId, batch.result.items[0].arId, batch.result.items[0].author, batch.result.items[0].variations, batch.result.items[0].sku], [900, 901, 'ok', { done: 2, failed: 0 }, 'IBTAR0999']);
  assert(db.rows('products').some((p) => p.id === 900), 'the mirror');
  const n = woo.calls.length;
  await call(deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertFalse(woo.calls.slice(n).some((c) => c.method === 'POST' || c.method === 'PUT'), 'a retry writes nothing again');
});

Deno.test('studio_upload: the push gate before any call; an item refused before the site; a duplicate SKU recorded as the reason; an Arabic answer not linked to the product is trashed (never force); no Application Password = the images refused', async () => {
  const off = setup({ seed: studioSeed(), routes: studioRoutes(), env: {}, storage: STUDIO_FILES });
  assertEquals((await call(off.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' })).body.reason, 'push_disabled');
  assertEquals(off.woo.calls.length, 0);
  const bad = setup({ seed: studioSeed({ ...studioItem, colors: ['ZZ'] }), routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  const r = await call(bad.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([r.res.status, r.body.field, bad.woo.calls.length], [400, 'colors', 0]);
  assertEquals((await call(bad.deps, { action: 'studio_upload', batch_id: SB, index: 3 }, { jwt: 'jwt-padd' })).res.status, 404);
  const dup = setup({ seed: studioSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'POST wc/v3/products': { status: 400, body: { code: 'product_invalid_sku', message: 'Invalid or duplicated SKU.' } } }) });
  const d = await call(dup.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([d.body.result, d.body.item.error], ['error', 'product_invalid_sku']);
  assertEquals(dup.db.row('studio_batches', SB).status, 'uploading');
  const loose = setup({ seed: studioSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({
    'POST wc/v3/products': (c: any) => ({ body: c.body.wpml_language === 'ar' ? { id: 951, lang: 'ar' } : wooProduct(900, 44, { type: 'variable' }) }), 'DELETE wc/v3/products/951': { body: { id: 951, status: 'trash' } } }) });
  const l = await call(loose.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([l.body.item.arId, l.body.item.arNote], [null, 'not_linked']);
  const del = loose.woo.calls.find((c) => c.method === 'DELETE')!;
  assertEquals([del.path, del.query], ['wc/v3/products/951', {}]);
  // the site refusing the translation (the live 422 of 29 / 31 Oct): the product stays, the code and the scrubbed answer are in
  // the item and in the log row (ar_code / ar_error — never a key named note, which redactPII masks)
  let arActive = false;
  const refused = setup({ seed: studioSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({
    'POST wc/v3/products': (c: any) => (c.body.lang !== 'ar' ? { body: wooProduct(900, 44, { type: 'variable' }) } : arActive ? { body: { ...wooProduct(901, 44, { type: 'variable' }), translations: { en: 900 } } } : { status: 422, body: { code: 'wcml_invalid_language', message: 'Language ar is not active.', data: { status: 422 } } }),
    // the product was published from the product page before the retry: the translation takes that status
    'GET wc/v3/products/900': () => ({ body: wooProduct(900, 44, { type: 'variable', sku: 'IBTAR0999', status: arActive ? 'publish' : 'draft', lang: 'en', translations: arActive ? { en: 900, ar: 901 } : { en: 900 } }) }) }) });
  const rf = await call(refused.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([rf.body.result, rf.body.item.productId, rf.body.item.arId, rf.body.item.arNote], ['ok', 900, null, 'wcml_invalid_language']);
  assert(String(rf.body.item.arError).includes('Language ar is not active'), rf.body.item.arError);
  const rlog = refused.db.rows('woo_sync_log').find((r: any) => r.action === 'studio_upload')!;
  assertEquals([rlog.detail.ar, rlog.detail.ar_code, 'ar_note' in rlog.detail, String(rlog.detail.ar_error).includes('wcml_invalid_language')], [null, 'wcml_invalid_language', false, true]);
  // a retry asks for the translation again and nothing else (the product, its variations and its brand are not sent twice)
  arActive = true;
  const rn = refused.woo.calls.length;
  const rr = await call(refused.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([rr.body.result, rr.body.item.productId, rr.body.item.arId, 'arNote' in rr.body.item, 'arError' in rr.body.item, rr.body.item.author], ['ok', 900, 901, false, false, 'ok']);
  assertEquals(refused.woo.calls.slice(rn).filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path} ${c.body?.lang ?? ''}`.trim()), ['POST wc/v3/products ar', 'PUT dokan/v1/products/901'], 'the translation and its maker only');
  const arPosts = refused.woo.calls.filter((c) => c.method === 'POST' && c.path === 'wc/v3/products' && c.body?.lang === 'ar').map((c) => c.body.status);
  assertEquals(arPosts, ['draft', 'publish'], 'a translation made with the product is a draft; one added after the product was published is published');
  assertEquals(refused.db.row('studio_batches', SB).result.items[0].arId, 901);
  const nowp = setup({ seed: studioSeed(), routes: studioRoutes(), env: PUSH_ON, storage: STUDIO_FILES });
  const w = await call(nowp.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([w.body.result, w.body.item.error, nowp.woo.calls.some((c) => c.method === 'POST')], ['error', 'config', false]);
  // Dokan writes the caller when the maker cannot dokan_add_product: the answer is checked → author_failed, and the
  // variations and the translation wait (a variation keeps the author it is created with); a retry asks again and goes on
  let dokanAnswer = '1';
  const admin = setup({ seed: studioSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'PUT dokan/v1/products/900': () => ({ body: { id: 900, post_author: dokanAnswer } }) }) });
  const x = await call(admin.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([x.body.result, x.body.item.error, x.body.item.productId, x.body.item.author], ['error', 'author_failed', 900, 'failed']);
  assertFalse(admin.woo.calls.some((c) => c.path === 'wc/v3/products/900/variations/batch' || c.body?.wpml_language === 'ar'), 'no variation and no translation before the maker');
  assertEquals(admin.db.row('studio_batches', SB).status, 'uploading');
  let m = admin.woo.calls.length;
  await call(admin.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals(admin.woo.calls.slice(m).filter((c) => c.method !== 'GET').map((c) => c.path), ['dokan/v1/products/900'], 'the product is not created again');
  dokanAnswer = '44';
  m = admin.woo.calls.length;
  const y = await call(admin.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([y.body.result, y.body.item.author, y.body.item.authorIds], ['ok', 'ok', [900, 901]]);
  assertEquals(admin.woo.calls.slice(m).filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`),
    ['PUT dokan/v1/products/900', 'POST wc/v3/products/900/variations/batch', 'POST wc/v3/products', 'PUT dokan/v1/products/901'], 'the maker, then the variations, the translation and its maker');
  const nostore = setup({ seed: { ...studioSeed(), studio_batches: [{ ...studioSeed().studio_batches[0], vendor_id: null }] }, env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes() });
  const ns = await call(nostore.deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });
  assertEquals([ns.body.item.author, nostore.woo.calls.some((c) => c.path.startsWith('dokan/'))], ['no_store', false]);
});

const studioSimple = { nameEn: 'Linen Lamp', nameAr: 'أباجورة كتان', serial: 1000, colors: ['BE'], sizes: [], material: 'Linen', categories: [20], images: [`${SB}/1-1.webp`], sale: 900, regular: 1100, stock: 2 };
const simpleSeed = (result: any = null) => { const s = studioSeed(studioSimple); return { ...s, studio_batches: [{ ...s.studio_batches[0], type: 'Simple', result }] }; };
// the batch's maker as the page changes it (studio_batches.vendor_id; null = no maker)
const setMaker = (db: any, woo: number | null) => db.from('studio_batches').update({ vendor_id: woo === null ? null : vendorId(woo) }).eq('id', SB);
// what a run wrote on the site, in order (a maker PUT with the post_author it asked for)
const siteWrites = (woo: any, from: number) => woo.calls.slice(from).filter((c: any) => c.method !== 'GET').map((c: any) => `${c.method} ${c.path}${c.path.startsWith('dokan/') ? ` → ${c.body.post_author}` : ''}`);
const upload = (deps: any) => call(deps, { action: 'studio_upload', batch_id: SB, index: 0 }, { jwt: 'jwt-padd' });

Deno.test('studio_upload: the maker stays on the result with the ids it took (authorOwner); the batch\'s maker changed with no variation made → a retry asks Dokan again for the new maker, on the product and its translation; a result from before authorOwner counts as the batch\'s maker', async () => {
  const { woo, db, deps } = setup({ seed: simpleSeed(), routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  const first = await upload(deps);
  assertEquals([first.body.item.author, first.body.item.authorOwner, first.body.item.authorIds], ['ok', 44, [900, 901]]);
  await setMaker(db, 2376);
  let n = woo.calls.length;
  const moved = await upload(deps);
  assertEquals(siteWrites(woo, n), ['PUT dokan/v1/products/900 → 2376', 'PUT dokan/v1/products/901 → 2376'], 'nothing made again; the new maker on both');
  assertEquals([moved.body.result, moved.body.item.author, moved.body.item.authorOwner, moved.body.item.authorIds], ['ok', 'ok', 2376, [900, 901]]);
  assertEquals([db.row('studio_batches', SB).status, db.row('studio_batches', SB).result.items[0].authorOwner], ['done', 2376]);
  n = woo.calls.length;
  await upload(deps);
  assertEquals(siteWrites(woo, n), [], 'the same maker: a retry writes nothing');
  // woo-sync v32 kept the ids without their maker: they count as the batch's maker (nothing asked again), and it is written
  const old = simpleSeed({ items: [{ sku: 'IBTARBE1000', productId: 900, arId: 901, media: { [`${SB}/1-1.webp`]: 7001 }, authorIds: [900, 901], author: 'ok', arAttrs: 'ok', error: null }] });
  const v32 = setup({ seed: old, routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  const l = await upload(v32.deps);
  assertEquals([siteWrites(v32.woo, 0), l.body.item.author, l.body.item.authorOwner], [[], 'ok', 44]);
});

Deno.test('studio_upload: the batch\'s maker changed after the variations were made → maker_changed and nothing written (Dokan cannot move a variation: the product stays whole on its maker), the record kept until the maker is back; a maker with no store keeps it too', async () => {
  const { woo, db, deps } = setup({ seed: studioSeed(), routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  assertEquals((await upload(deps)).body.item.variations, { done: 2, failed: 0 });
  await setMaker(db, 2376);
  let n = woo.calls.length;
  const x = await upload(deps);
  assertEquals(siteWrites(woo, n), [], 'no maker PUT, nothing made again');
  assertEquals([x.body.result, x.body.item.error, x.body.item.author, x.body.item.authorOwner, x.body.item.authorIds, x.body.item.productId], ['error', 'maker_changed', 'failed', 44, [900, 901], 900], 'never author ok; the record is the site\'s');
  assertEquals(db.row('studio_batches', SB).status, 'uploading');
  n = woo.calls.length;
  assertEquals([(await upload(deps)).body.item.error, siteWrites(woo, n)], ['maker_changed', []], 'asked again: the same answer, the record not overwritten');
  await setMaker(db, null);
  const ns = await upload(deps);
  assertEquals([ns.body.item.author, ns.body.item.error, ns.body.item.authorOwner], ['no_store', null, 44]);
  await setMaker(db, 44);
  n = woo.calls.length;
  const back = await upload(deps);
  assertEquals([siteWrites(woo, n), back.body.result, back.body.item.author, back.body.item.error], [[], 'ok', 'ok', null], 'the maker back: whole again, nothing written');
  assertEquals(db.row('studio_batches', SB).status, 'done');
  // variations made while the product had no maker (it did not stick, then a maker with no store): theirs is none, so a
  // maker set afterwards is maker_changed too — never a product moved away from its variations
  let answer = '1';
  const z = setup({ seed: studioSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'PUT dokan/v1/products/900': () => ({ body: { id: 900, post_author: answer } }) }) });
  assertEquals([(await upload(z.deps)).body.item.error, z.db.row('studio_batches', SB).result.items[0].authorOwner], ['author_failed', 44]);
  await setMaker(z.db, null);
  const ns2 = await upload(z.deps);
  assertEquals([ns2.body.item.author, ns2.body.item.variations, ns2.body.item.authorOwner, ns2.body.item.authorIds], ['no_store', { done: 2, failed: 0 }, null, []]);
  await setMaker(z.db, 44); answer = '44';
  n = z.woo.calls.length;
  const late = await upload(z.deps);
  assertEquals([late.body.item.error, late.body.item.author, siteWrites(z.woo, n)], ['maker_changed', 'failed', []]);
});

// the SKU (decision 2): fixed with the product. The batch's brand as the page (or a member's direct write) changes it, a brand
// renamed on the vendors page, and the item as the page saves it.
const BRAND_B = '00000000-0000-4000-8000-00000000b002';
const twoBrands = (s: any) => ({ ...s, brands: [...s.brands, { id: BRAND_B, name: 'Bian eg', code: 'B' }] });
const setBrand = (db: any, id: string) => db.from('studio_batches').update({ brand_id: id }).eq('id', SB);
const renameBrand = (db: any, name: string) => db.from('brands').update({ name }).eq('id', BRAND);
const setItem = (db: any, item: any) => db.from('studio_batches').update({ state: { items: [item] } }).eq('id', SB);

Deno.test('studio_upload: the SKU stays the one the product was made with — the batch\'s brand changed (another brand, or its name to other letters) → brand_changed and nothing written while the variations wait, the record\'s SKU kept; the same letters → the retry goes on, the variations with the product\'s SKU', async () => {
  let answer = '1';
  const { woo, db, deps } = setup({ seed: twoBrands(studioSeed()), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'PUT dokan/v1/products/900': () => ({ body: { id: 900, post_author: answer } }) }) });
  const first = await upload(deps);
  assertEquals([first.body.item.error, first.body.item.sku, first.body.item.variations], ['author_failed', 'IBTAR0999', undefined], 'the product made, its variations wait for the maker');
  await setBrand(db, BRAND_B); answer = '44';
  let n = woo.calls.length;
  const x = await upload(deps);
  assertEquals(siteWrites(woo, n), [], 'no image, no maker, no variation, no translation');
  assertEquals([x.body.result, x.body.item.error, x.body.item.sku, x.body.item.productId, x.body.item.variations], ['error', 'brand_changed', 'IBTAR0999', 900, undefined]);
  assertEquals([db.row('studio_batches', SB).status, db.row('studio_batches', SB).result.items[0].sku], ['uploading', 'IBTAR0999'], 'the site\'s SKU stays on the record (never IBTBI0999)');
  await setBrand(db, BRAND); await renameBrand(db, 'Crafty Art'); // the same brand, renamed: CR
  n = woo.calls.length;
  assertEquals([(await upload(deps)).body.item.error, siteWrites(woo, n)], ['brand_changed', []]);
  await renameBrand(db, 'ART & Craft Studio'); // renamed again, the same letters
  n = woo.calls.length;
  const back = await upload(deps);
  assertEquals([back.body.result, back.body.item.error, back.body.item.author, back.body.item.sku], ['ok', null, 'ok', 'IBTAR0999']);
  assertEquals(siteWrites(woo, n), ['PUT dokan/v1/products/900 → 44', 'POST wc/v3/products/900/variations/batch', 'POST wc/v3/products', 'PUT dokan/v1/products/901 → 44']);
  assertEquals(woo.calls.find((c) => c.path === 'wc/v3/products/900/variations/batch')!.body.create.map((v: any) => v.sku), ['IBTARBE0999', 'IBTARBK0999'], 'the variations under their product\'s SKU');
  assertEquals(db.row('studio_batches', SB).status, 'done');
  // a product made on v33 (no wooBrand on its result yet) whose batch went to another brand: refused before the WooCommerce
  // brand a retry would add (decision 5) — never the new brand's on a product made with the old one's SKU
  const old = simpleSeed({ items: [{ sku: 'IBTARBE1000', productId: 900, arId: 901, media: { [`${SB}/1-1.webp`]: 7001 }, authorIds: [900, 901], authorOwner: 44, author: 'ok', arAttrs: 'ok', error: null }] });
  const v33 = setup({ seed: { ...twoBrands(old), woo_brands: [{ id: 77, name: 'Bian eg', slug: 'bian-eg' }] }, routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  await setBrand(v33.db, BRAND_B);
  const r = await upload(v33.deps);
  assertEquals([r.body.item.error, r.body.item.sku, r.body.item.wooBrand, siteWrites(v33.woo, 0)], ['brand_changed', 'IBTARBE1000', undefined, []], 'no brands PUT either');
});

Deno.test('studio_upload: once the product is made, an item that builds another SKU for the rest (a Simple\'s color, the serial) → sku_changed and nothing written, until it builds the product\'s again; before the product is made a retry builds it from the batch as it is (another brand\'s letters)', async () => {
  let answer = '1';
  const { woo, db, deps } = setup({ seed: simpleSeed(), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'PUT dokan/v1/products/900': () => ({ body: { id: 900, post_author: answer } }) }) });
  assertEquals([(await upload(deps)).body.item.error, db.row('studio_batches', SB).result.items[0].sku], ['author_failed', 'IBTARBE1000']);
  answer = '44';
  for (const [patch, sku] of [[{ colors: ['BK'] }, 'IBTARBK1000'], [{ serial: 1005 }, 'IBTARBE1005']] as const) {
    await setItem(db, { ...studioSimple, ...patch });
    const n = woo.calls.length;
    const r = await upload(deps);
    assertEquals([r.body.item.error, r.body.item.sku, siteWrites(woo, n)], ['sku_changed', 'IBTARBE1000', []], `the item builds ${sku}`);
  }
  await setItem(db, studioSimple);
  const n = woo.calls.length;
  const ok = await upload(deps);
  assertEquals([ok.body.result, ok.body.item.author, siteWrites(woo, n)], ['ok', 'ok', ['PUT dokan/v1/products/900 → 44', 'POST wc/v3/products', 'PUT dokan/v1/products/901 → 44']]);
  // the site refused the product (no productId): the SKU is not the site's yet
  let refuse = true;
  const en = (c: any) => (c.body.wpml_language === 'ar' ? { body: { id: 901, lang: 'ar', translations: { en: 900, ar: 901 } } } : { body: wooProduct(900, 44, { sku: c.body.sku }) });
  const nm = setup({ seed: twoBrands(simpleSeed()), env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({
    'POST wc/v3/products': (c: any) => (refuse ? { status: 400, body: { code: 'product_invalid_sku', message: 'Invalid or duplicated SKU.' } } : en(c)) }) });
  assertEquals((await upload(nm.deps)).body.item.error, 'product_invalid_sku');
  await setBrand(nm.db, BRAND_B); refuse = false;
  const made = await upload(nm.deps);
  assertEquals([made.body.result, made.body.item.sku, nm.db.row('studio_batches', SB).result.items[0].sku], ['ok', 'IBTBIBE1000', 'IBTBIBE1000']);
  assertEquals(nm.woo.calls.filter((c) => c.method === 'POST' && c.path === 'wc/v3/products' && c.body.wpml_language === 'en').map((c) => c.body.sku), ['IBTARBE1000', 'IBTBIBE1000']);
});

Deno.test('studio_upload (decision 5): the site\'s WooCommerce brand named like the batch\'s («@Art-craft» = «Art Craft») goes with the product, not its translation; none → no brands field and wooBrand null; a product made before (woo-sync v33) gets it on a retry, once', async () => {
  const seed = { ...studioSeed(), brands: [{ id: BRAND, name: '@Art-craft', code: 'A' }], woo_brands: [{ id: 4363, name: 'Art Craft', slug: 'art-craft' }, { id: 5, name: 'Lusso', slug: 'lusso' }] };
  const { woo, deps } = setup({ seed, routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  const r = await upload(deps);
  const [en, ar] = woo.calls.filter((c) => c.method === 'POST' && c.path === 'wc/v3/products');
  assertEquals([en.body.brands, ar.body.brands, r.body.item.wooBrand, r.body.result], [[{ id: 4363 }], undefined, 4363, 'ok']);
  const none = setup({ seed: { ...studioSeed(), woo_brands: [{ id: 5, name: 'Lusso', slug: 'lusso' }] }, routes: studioRoutes(), env: WP_ENV, storage: STUDIO_FILES });
  const n = await upload(none.deps);
  const enN = none.woo.calls.find((c) => c.method === 'POST' && c.path === 'wc/v3/products')!;
  assertEquals(['brands' in enN.body, n.body.item.wooBrand, n.body.result], [false, null, 'ok'], 'the pa_brand attribute only; the report says so');
  const old = simpleSeed({ items: [{ sku: 'IBTARBE1000', productId: 900, arId: 901, media: { [`${SB}/1-1.webp`]: 7001 }, authorIds: [900, 901], authorOwner: 44, author: 'ok', arAttrs: 'ok', error: null }] });
  const v33 = setup({ seed: { ...old, woo_brands: [{ id: 4363, name: 'Art Craft', slug: 'art-craft' }] }, env: WP_ENV, storage: STUDIO_FILES,
    routes: studioRoutes({ 'PUT wc/v3/products/900': (c: any) => ({ body: { id: 900, brands: c.body.brands } }) }) });
  const l = await upload(v33.deps);
  assertEquals([siteWrites(v33.woo, 0), v33.woo.calls.find((c) => c.method === 'PUT')!.body, l.body.item.wooBrand], [['PUT wc/v3/products/900'], { brands: [{ id: 4363 }] }, 4363]);
  const m = v33.woo.calls.length;
  await upload(v33.deps);
  assertEquals(siteWrites(v33.woo, m), [], 'once');
});

Deno.test('studio_upload (the owner, 2 Nov): a size typed as numbers gets «cm» / «سم»; an Arabic term the site lacks is made as the English term\'s translation (lang ar + translation_of) before the translation is posted; a translation made before this gets its attributes on a retry (the terms, one PUT), once; a term the site refuses → arAttrs partial, never the item\'s error', async () => {
  const posts: any[] = [];
  const made = { 3: [] as any[], 13: [] as any[] };
  // the site answers by language (lang=ar): the Arabic size and brand terms are missing, the English ones are there
  const routes = studioRoutes({
    'GET wc/v3/products/attributes/3/terms': (c: any) => ({ body: c.query.lang === 'ar' ? [TERMS[3][1], ...made[3]] : [TERMS[3][0], { id: 5635, name: '40×50 cm' }] }),
    'GET wc/v3/products/attributes/13/terms': (c: any) => ({ body: c.query.lang === 'ar' ? made[13] : [TERMS[13][0]] }),
    'POST wc/v3/products/attributes/3/terms': (c: any) => { posts.push([3, c.body]); const t = { id: 5700, name: c.body.name }; made[3].push(t); return { body: t }; },
    'POST wc/v3/products/attributes/13/terms': (c: any) => { posts.push([13, c.body]); const t = { id: 5701, name: c.body.name }; made[13].push(t); return { body: t }; },
  });
  const sized = studioSeed({ ...studioSimple, sizes: ['40×50'] });
  const { woo, deps } = setup({ seed: { ...sized, studio_batches: [{ ...sized.studio_batches[0], type: 'Simple' }] }, routes, env: WP_ENV, storage: STUDIO_FILES });
  const r = await upload(deps);
  assertEquals(r.body.result, 'ok');
  const [en, ar] = woo.calls.filter((c) => c.method === 'POST' && c.path === 'wc/v3/products');
  assertEquals(en.body.attributes.find((a: any) => a.id === 3).options, ['40×50 cm'], 'the English size with cm');
  assertEquals(ar.body.attributes.map((a: any) => [a.id, a.options]), [[12, ['بيج']], [3, ['40×50 سم']], [15, ['Linen']], [13, ['Art Craft']]], 'the Arabic size with سم, the color in Arabic, the rest as typed');
  // the Arabic terms made: the size (its English term 5635 found by name) and the brand (3055) — the color and the material had theirs
  assertEquals(posts, [[3, { name: '40×50 سم', lang: 'ar', translation_of: 5635 }], [13, { name: 'Art Craft', lang: 'ar', translation_of: 3055 }]]);
  assertEquals(r.body.item.arAttrs, 'ok');
  const termsBefore = woo.calls.findIndex((c) => c.method === 'POST' && c.path.endsWith('/terms')) < woo.calls.indexOf(ar);
  assert(termsBefore, 'the terms before the translation is posted');
  // a translation from before this (no arAttrs on the result): the terms, then the attributes on the translation; a second retry writes nothing
  const old = simpleSeed({ items: [{ sku: 'IBTARBE1000', productId: 900, arId: 901, media: { [`${SB}/1-1.webp`]: 7001 }, authorIds: [900, 901], authorOwner: 44, author: 'ok', wooBrand: null, error: null }] });
  const prior = setup({ seed: old, env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({ 'PUT wc/v3/products/901': (c: any) => ({ body: { id: 901, attributes: c.body.attributes } }) }) });
  const p = await upload(prior.deps);
  assertEquals([siteWrites(prior.woo, 0), p.body.item.arAttrs], [['PUT wc/v3/products/901'], 'ok']);
  assertEquals(prior.woo.calls.find((c) => c.method === 'PUT' && c.path === 'wc/v3/products/901')!.body, { attributes: [{ id: 12, visible: true, variation: false, options: ['بيج'] }, { id: 15, visible: true, variation: false, options: ['Linen'] }, { id: 13, visible: true, variation: false, options: ['Art Craft'] }] });
  const m = prior.woo.calls.length;
  await upload(prior.deps);
  assertEquals(siteWrites(prior.woo, m), [], 'once');
  // the site refusing a term: the translation still gets its attributes, arAttrs says partial, the item is ok
  const refused = setup({ seed: old, env: WP_ENV, storage: STUDIO_FILES, routes: studioRoutes({
    'GET wc/v3/products/attributes/13/terms': (c: any) => ({ body: c.query.lang === 'ar' ? [] : [TERMS[13][0]] }),
    'POST wc/v3/products/attributes/13/terms': { status: 400, body: { code: 'rest_invalid_param', message: 'Invalid parameter(s): lang' } },
    'PUT wc/v3/products/901': (c: any) => ({ body: { id: 901, attributes: c.body.attributes } }) }) });
  const rf = await upload(refused.deps);
  assertEquals([rf.body.result, rf.body.item.error, rf.body.item.arAttrs, siteWrites(refused.woo, 0)], ['ok', null, 'partial', ['POST wc/v3/products/attributes/13/terms', 'PUT wc/v3/products/901']]);
});

Deno.test('category_create (phase 5.2): products.add; the English category then its Arabic translation; woo_categories written; names with tags refused', async () => {
  const routes = { 'POST wc/v3/products/categories': (c: any) => ({ body: c.body.wpml_language === 'ar' ? { id: 81, name: c.body.name, slug: 'ar-81', parent: 0 } : { id: 80, name: c.body.name, slug: 'lamps', parent: c.body.parent } }) };
  const { woo, db, deps } = setup({ routes, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'category_create', name_en: 'Lamps' }, { jwt: 'jwt-pedit' })).res.status, 401);
  assertEquals((await call(deps, { action: 'category_create', name_en: '<b>x</b>' }, { jwt: 'jwt-padd' })).res.status, 400);
  const { body } = await call(deps, { action: 'category_create', name_en: 'Lamps', name_ar: 'أباجورات', parent: 15 }, { jwt: 'jwt-padd' });
  assertEquals([body.result, body.id, body.ar_id], ['ok', 80, 81]);
  assertEquals(woo.calls.filter((c) => c.method === 'POST').map((c) => c.body), [{ name: 'Lamps', parent: 15, lang: 'en', wpml_language: 'en' }, { name: 'أباجورات', lang: 'ar', wpml_language: 'ar', translation_of: 80 }]); // the parent says no translation: WPML places it
  assertEquals(db.rows('woo_categories').map((c) => c.id), [80], 'B4: the English term only — the mirror is the default language\'s list');
  // decision 56: a sub-category's Arabic translation goes under the parent's Arabic translation
  const sub = setup({ routes: { ...routes, 'GET wc/v3/products/categories/15': { body: { id: 15, name: 'Home', parent: 0, translations: { en: 15, ar: 16 } } } }, env: PUSH_ON });
  await call(sub.deps, { action: 'category_create', name_en: 'Lamps', name_ar: 'أباجورات', parent: 15 }, { jwt: 'jwt-padd' });
  assertEquals(sub.woo.calls.map((c) => [c.method, c.path]), [['POST', 'wc/v3/products/categories'], ['GET', 'wc/v3/products/categories/15'], ['POST', 'wc/v3/products/categories']]);
  assertEquals(sub.woo.calls[2].body, { name: 'أباجورات', lang: 'ar', wpml_language: 'ar', translation_of: 80, parent: 16 });
  // a top category: no read of a parent
  const top = setup({ routes, env: PUSH_ON });
  await call(top.deps, { action: 'category_create', name_en: 'Gifts', name_ar: 'هدايا' }, { jwt: 'jwt-padd' });
  assertEquals(top.woo.calls.map((c) => c.method), ['POST', 'POST']);
});

// ---------------------------------------------------------------- B4: the categories tab (the owner, 11 Nov)

// a WebP's first bytes (RIFF....WEBP) and anything else, as the page sends them (base64)
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3, 4]);
const NOT_IMAGE = b64([...new TextEncoder().encode('<svg onload=alert(1)>')]);
const catEn = (extra: any = {}) => ({ id: 80, name: 'Lamps', slug: 'lamps', parent: 15, count: 0, image: null, translations: { en: 80, ar: 81 }, ...extra });
const catAr = (extra: any = {}) => ({ id: 81, name: 'أباجورات', slug: 'ar-81', parent: 16, count: 0, image: null, translations: { en: 80, ar: 81 }, ...extra });
// WPML answers the Arabic term only when asked in Arabic (else it hands the English one back — never written on then)
const arRoute = (ar: any) => (c: any) => ({ body: c.query.lang === 'ar' ? ar : catEn() });
const wooWrites = (woo: any) => woo.calls.filter((c: any) => c.method !== 'GET').map((c: any) => `${c.method} ${c.path}${Object.keys(c.query).length ? '?' + new URLSearchParams(c.query) : ''}`);

Deno.test('B4 category_create: a square image (base64, checked by its bytes) → wp/v2/media → `image: { id }` on the English term and its translation; not an image → 400 before any call; no Application Password → media_refused, no category', async () => {
  const routes = { 'POST wp/v2/media': { body: { id: 700, source_url: 'https://woo.test/cat.webp' } },
    'POST wc/v3/products/categories': (c: any) => ({ body: c.body.wpml_language === 'ar' ? { id: 81, name: c.body.name, parent: 0 } : { id: 80, name: c.body.name, slug: 'decor', parent: 0, image: { id: 700, src: 'https://woo.test/cat.webp' } } }) };
  const bad = setup({ routes, env: WP_ENV });
  const r400 = await call(bad.deps, { action: 'category_create', name_en: 'Decor', image: { data: NOT_IMAGE } }, { jwt: 'jwt-padd' });
  assertEquals([r400.res.status, r400.body.field, bad.woo.calls.length], [400, 'image', 0]);
  assertEquals((await call(bad.deps, { action: 'category_create', name_en: 'Decor', image: 'x' }, { jwt: 'jwt-padd' })).res.status, 400);
  const { woo, db, deps } = setup({ routes, env: WP_ENV });
  const { body } = await call(deps, { action: 'category_create', name_en: 'Decor', name_ar: 'ديكور', image: { data: WEBP } }, { jwt: 'jwt-padd' });
  assertEquals([body.result, body.id, body.ar_id, body.image], ['ok', 80, 81, 'https://woo.test/cat.webp']);
  assertEquals(woo.calls.map((c) => `${c.method} ${c.path}`), ['POST wp/v2/media', 'POST wc/v3/products/categories', 'POST wc/v3/products/categories']);
  assertEquals([woo.calls[0].body, woo.calls[0].headers['content-type'], /^attachment; filename="category-Decor-\d+\.webp"$/.test(woo.calls[0].headers['content-disposition'])], [{ bytes: 20 }, 'image/webp', true]);
  assertEquals([woo.calls[1].body.image, woo.calls[2].body.image], [{ id: 700 }, { id: 700 }]);
  assertEquals(db.rows('woo_categories').map((c) => c.id), [80]);
  assertEquals(db.rows('woo_sync_log').at(-1).detail, { ar: 81, image: true });
  const noPass = setup({ routes, env: PUSH_ON });
  const np = await call(noPass.deps, { action: 'category_create', name_en: 'Decor', image: { data: WEBP } }, { jwt: 'jwt-padd' });
  assertEquals([np.body.result, np.body.reason, noPass.woo.calls.length, noPass.db.rows('woo_categories').length], ['error', 'media_refused', 0, 0]);
});

Deno.test('B4 category_get: products.add (never products.edit or the sync secret); the English term and its Arabic translation read with lang=ar — names, parent, count, the https image only; a translation that is not linked → ar null; 404 → not_found; nothing written', async () => {
  const routes = { 'GET wc/v3/products/categories/80': { body: catEn({ count: 3, image: { id: 700, src: 'https://woo.test/lamps.webp', name: 'x' }, description: 'kept out' }) }, 'GET wc/v3/products/categories/81': arRoute(catAr({ image: { src: 'http://woo.test/plain.webp' } })) };
  const { woo, db, deps } = setup({ routes });
  assertEquals((await call(deps, { action: 'category_get', id: 80 }, { jwt: 'jwt-pedit' })).res.status, 401);
  assertEquals((await call(deps, { action: 'category_get', id: 80 })).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { action: 'category_get', id: 'x' }, { jwt: 'jwt-padd' })).res.status, 400);
  const { body } = await call(deps, { action: 'category_get', id: 80 }, { jwt: 'jwt-padd' });
  assertEquals(body, { action: 'category_get', result: 'ok', category: { id: 80, name: 'Lamps', parent: 15, count: 3, image: 'https://woo.test/lamps.webp' }, ar: { id: 81, name: 'أباجورات', parent: 16, count: 0, image: null } });
  assertEquals(woo.calls.map((c) => [c.path, c.query]), [['wc/v3/products/categories/80', {}], ['wc/v3/products/categories/81', { lang: 'ar' }]]);
  const loose = setup({ routes: { ...routes, 'GET wc/v3/products/categories/81': { body: catEn() } } });
  assertEquals((await call(loose.deps, { action: 'category_get', id: 80 }, { jwt: 'jwt-padd' })).body.ar, null, 'WPML handed the English term back: no translation');
  const gone = setup({ routes: {} });
  assertEquals((await call(gone.deps, { action: 'category_get', id: 80 }, { jwt: 'jwt-padd' })).res.status, 404);
  assertEquals([db.writes().length, db.rows('woo_sync_log').length], [0, 0]);
});

Deno.test('B4 category_update: the English name and image, then the linked Arabic translation (lang=ar) — only what changed; a translation not linked is never written; none yet → made under the parent\'s translation; the switch off → skipped with no call', async () => {
  const seed = { woo_categories: [{ id: 80, name: 'Lamps', slug: 'lamps', parent_id: 15 }] };
  const routes = { 'GET wc/v3/products/categories/80': { body: catEn() }, 'GET wc/v3/products/categories/81': arRoute(catAr()),
    'POST wp/v2/media': { body: { id: 701 } },
    'PUT wc/v3/products/categories/80': (c: any) => ({ body: catEn({ ...c.body, image: c.body.image ? { id: 701, src: 'https://woo.test/n.webp' } : null }) }),
    'PUT wc/v3/products/categories/81': (c: any) => ({ body: catAr(c.body) }) };
  const off = setup({ seed, routes });
  assertEquals([(await call(off.deps, { action: 'category_update', id: 80, name_en: 'Lights' }, { jwt: 'jwt-padd' })).body.reason, off.woo.calls.length], ['push_disabled', 0]);
  const { woo, db, deps } = setup({ seed, routes, env: WP_ENV });
  assertEquals((await call(deps, { action: 'category_update', id: 80 }, { jwt: 'jwt-padd' })).body.field, 'nothing');
  assertEquals((await call(deps, { action: 'category_update', id: 80, name_en: 'a<b' }, { jwt: 'jwt-padd' })).res.status, 400);
  assertEquals((await call(deps, { action: 'category_update', id: 80, image: { data: NOT_IMAGE } }, { jwt: 'jwt-padd' })).body.field, 'image');
  assertEquals((await call(deps, { action: 'category_update', id: 80, name_en: 'Lights' }, { jwt: 'jwt-pedit' })).res.status, 401);
  assertEquals(woo.calls.length, 0);
  const { body } = await call(deps, { action: 'category_update', id: 80, name_en: 'Lights', name_ar: 'إضاءة', image: { data: WEBP } }, { jwt: 'jwt-padd' });
  assertEquals([body.result, body.ar, body.image], ['ok', 'ok', 'https://woo.test/n.webp']);
  assertEquals(wooWrites(woo), ['POST wp/v2/media', 'PUT wc/v3/products/categories/80', 'PUT wc/v3/products/categories/81?lang=ar']);
  assertEquals([woo.calls.find((c) => c.path.endsWith('/80') && c.method === 'PUT')!.body, woo.calls.find((c) => c.path.endsWith('/81') && c.method === 'PUT')!.body], [{ name: 'Lights', image: { id: 701 } }, { name: 'إضاءة', image: { id: 701 } }]);
  assertEquals(db.rows('woo_categories').map((c) => [c.id, c.name]), [[80, 'Lights']]);
  assertEquals(db.rows('woo_sync_log').at(-1).detail, { name: true, slug: false, parent: false, image: true, ar: 'ok' });
  assertEquals(db.rows('woo_categories')[0].image_url, 'https://woo.test/n.webp', 'decision 9 (0088): the image goes to the mirror');
  // the same names: nothing sent but the reads
  const same = setup({ seed, routes, env: PUSH_ON });
  assertEquals([(await call(same.deps, { action: 'category_update', id: 80, name_en: 'Lamps', name_ar: 'أباجورات' }, { jwt: 'jwt-padd' })).body.ar, wooWrites(same.woo)], ['ok', []]);
  // WPML hands the English term back for the Arabic id: the translation is left alone
  const loose = setup({ seed, routes: { ...routes, 'GET wc/v3/products/categories/81': { body: catEn() } }, env: PUSH_ON });
  assertEquals([(await call(loose.deps, { action: 'category_update', id: 80, name_ar: 'إضاءة' }, { jwt: 'jwt-padd' })).body.ar, wooWrites(loose.woo)], ['not_linked', []]);
  // no translation yet: made like category_create's, under the parent's Arabic term
  const none = setup({ seed, routes: { ...routes, 'GET wc/v3/products/categories/80': { body: catEn({ translations: { en: 80 } }) }, 'GET wc/v3/products/categories/15': { body: { id: 15, name: 'Home', parent: 0, translations: { en: 15, ar: 16 } } }, 'POST wc/v3/products/categories': { body: catAr({ id: 82 }) } }, env: PUSH_ON });
  assertEquals((await call(none.deps, { action: 'category_update', id: 80, name_ar: 'إضاءة' }, { jwt: 'jwt-padd' })).body.ar, 'made');
  assertEquals(none.woo.calls.find((c) => c.method === 'POST')!.body, { name: 'إضاءة', lang: 'ar', wpml_language: 'ar', translation_of: 80, parent: 16 });
  // the Arabic PUT answered by the English term (WPML mapped the id): its English name goes straight back, the answer says so
  const mapped = setup({ seed, routes: { ...routes, 'PUT wc/v3/products/categories/81': (c: any) => ({ body: catEn(c.body) }) }, env: PUSH_ON });
  assertEquals((await call(mapped.deps, { action: 'category_update', id: 80, name_ar: 'إضاءة' }, { jwt: 'jwt-padd' })).body.ar, 'mismatch');
  assertEquals(mapped.woo.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body]), [['wc/v3/products/categories/81', { name: 'إضاءة' }], ['wc/v3/products/categories/80', { name: 'Lamps' }]]);
  // a category the site no longer has
  const gone = setup({ seed, routes: {}, env: PUSH_ON });
  assertEquals((await call(gone.deps, { action: 'category_update', id: 80, name_en: 'Lights' }, { jwt: 'jwt-padd' })).res.status, 404);
});

Deno.test('B4 category_delete: refused (409, nothing on the site) while a product (any status), a sub-category, a maker\'s main category or the site\'s count uses it; then DELETE force=true on the term and its Arabic translation, and both leave the mirror', async () => {
  const mirror = [{ id: 80, name: 'Lamps', slug: 'lamps', parent_id: 15 }, { id: 15, name: 'Home', slug: 'home', parent_id: null }];
  const routes = { 'GET wc/v3/products/categories/80': { body: catEn() }, 'GET wc/v3/products/categories/81': arRoute(catAr()), [CATS]: page([]),
    'DELETE wc/v3/products/categories/80': { body: { deleted: true } }, 'DELETE wc/v3/products/categories/81': { body: { deleted: true } } };
  const used = async (seed: any, routeOver: any = {}) => { const s = setup({ seed: { woo_categories: mirror, ...seed }, routes: { ...routes, ...routeOver }, env: PUSH_ON }); const r = await call(s.deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' }); return [r.res.status, r.body.error, r.body.count, wooWrites(s.woo).length, s.db.rows('woo_categories').length]; };
  assertEquals(await used({ products: [{ id: 9, name: 'Desk lamp', status: 'draft', category_ids: [15, 80] }] }), [409, 'has_products', 1, 0, 2]);
  assertEquals(await used({ products: [{ id: 9, name: 'Desk lamp', status: 'trash', category_ids: [80], trashed_at: NOW }] }), [409, 'has_products', 1, 0, 2], 'the trash too');
  assertEquals(await used({ woo_categories: [...mirror, { id: 90, name: 'Desk', slug: 'desk', parent_id: 80 }] }), [409, 'has_children', 1, 0, 3]);
  assertEquals(await used({ vendors: [{ ...vendorRow(44), main_categories: [80] }] }), [409, 'has_makers', 1, 0, 2]);
  assertEquals(await used({}, { 'GET wc/v3/products/categories/80': { body: catEn({ count: 4 }) } }), [409, 'has_products', 4, 0, 2], 'the site counts products we do not mirror');
  assertEquals(await used({}, { [CATS]: (c: any) => (c.query.parent === '80' ? page([{ id: 91, name: 'Shades', parent: 80 }]) : page([])) }), [409, 'has_children', 1, 0, 2]);
  assertEquals(await used({}, { 'GET wc/v3/products/categories/81': arRoute(catAr({ count: 2 })) }), [409, 'has_products', 2, 0, 2]);
  assertEquals((await call(setup({ routes }).deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-pedit' })).res.status, 401);
  const off = setup({ seed: { woo_categories: mirror }, routes });
  assertEquals([(await call(off.deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' })).body.reason, off.woo.calls.length], ['push_disabled', 0]);
  const { woo, db, deps } = setup({ seed: { woo_categories: mirror, products: [{ id: 9, name: 'Desk lamp', status: 'publish', category_ids: [15] }] }, routes, env: PUSH_ON });
  const { body } = await call(deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' });
  assertEquals([body.result, body.ar], ['ok', 'ok']);
  assertEquals(wooWrites(woo), ['DELETE wc/v3/products/categories/80?force=true', 'DELETE wc/v3/products/categories/81?force=true&lang=ar']);
  assertEquals(woo.calls.find((c) => c.path === CATS.slice(4))!.query, { parent: '80', per_page: '1' });
  assertEquals(db.rows('woo_categories').map((c) => c.id), [15]);
  assertEquals(db.rows('woo_sync_log').at(-1).detail, { ar: 'ok' });
  // gone from the site already: it leaves the mirror, nothing deleted there
  const gone = setup({ seed: { woo_categories: mirror }, routes: {}, env: PUSH_ON });
  assertEquals([(await call(gone.deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' })).body.gone, gone.db.rows('woo_categories').map((c) => c.id)], [true, [15]]);
  // the translation could not be read (the site errs): nothing deleted anywhere
  const arDown = setup({ seed: { woo_categories: mirror }, routes: { ...routes, 'GET wc/v3/products/categories/81': { status: 500, body: { code: 'internal_server_error' } } }, env: PUSH_ON });
  const ad = await call(arDown.deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' });
  assertEquals([ad.body.result, wooWrites(arDown.woo), arDown.db.rows('woo_categories').length], ['error', [], 2]);
  // the site refuses the delete: the mirror keeps it
  const refused = setup({ seed: { woo_categories: mirror }, routes: { ...routes, 'DELETE wc/v3/products/categories/80': { status: 500, body: { code: 'term_delete_failed', message: 'x' } } }, env: PUSH_ON });
  const rr = await call(refused.deps, { action: 'category_delete', id: 80 }, { jwt: 'jwt-padd' });
  assertEquals([rr.body.result, rr.body.reason, refused.db.rows('woo_categories').length, wooWrites(refused.woo)], ['error', 'term_delete_failed', 2, ['DELETE wc/v3/products/categories/80?force=true']]);
});

Deno.test('B4 woo-api: delCategory sends force=true on a category\'s own route only (and lang=ar for its translation); del stays without a query; put carries a query', async () => {
  const woo = fakeWoo({ 'DELETE wc/v3/products/categories/5': { body: {} }, 'DELETE wc/v3/products/7': { body: {} }, 'PUT wc/v3/products/categories/6': { body: {} } });
  const api = wooApi(ENV, woo.fetch);
  await api.delCategory(5); await api.delCategory('5', 'ar'); await api.del('wc/v3/products/7'); await api.put('wc/v3/products/categories/6', { name: 'x' }, { lang: 'ar' });
  assertEquals(woo.calls.map((c) => [c.method, c.path, c.query]), [['DELETE', 'wc/v3/products/categories/5', { force: 'true' }], ['DELETE', 'wc/v3/products/categories/5', { force: 'true', lang: 'ar' }], ['DELETE', 'wc/v3/products/7', {}], ['PUT', 'wc/v3/products/categories/6', { lang: 'ar' }]]);
  for (const bad of ['x', 0, -1, 1.5, '5/../products/9']) { let err: unknown = null; try { await api.delCategory(bad); } catch (e) { err = e; } assert(err instanceof ConfigError, String(bad)); }
  assertEquals(woo.calls.length, 4);
});

Deno.test('studio_sheet (decision 13): products.add only, never the sync secret; the CSV of a published Google Sheet through its redirect, built from the link\'s id; a link that is not a sheet → 400 before any call; a sheet that is not published → not_published; nothing written', async () => {
  const PUB = '2PACX-1vTq3x9Abc_def-GHIjkLMNopQRstuVWxyz0123456789';
  const link = `https://docs.google.com/spreadsheets/d/e/${PUB}/pubhtml?gid=7&single=true`;
  const { woo, db, deps } = setup({ routes: {
    [`GET /spreadsheets/d/e/${PUB}/pub`]: { status: 307, headers: { location: `https://doc-0k-3g-sheets.googleusercontent.com/pub/x/y/1/${PUB}?gid=7&single=true&output=csv` } },
    [`GET /pub/x/y/1/${PUB}`]: { text: 'Name EN,Vendor Price\nStudio Test,500\n', headers: { 'content-type': 'text/csv' } },
  } });
  assertEquals((await call(deps, { action: 'studio_sheet', url: link })).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { action: 'studio_sheet', url: link }, { jwt: 'jwt-pedit' })).res.status, 401, 'products.edit is not products.add');
  assertEquals(woo.calls.length, 0);
  const { res, body } = await call(deps, { action: 'studio_sheet', url: link }, { jwt: 'jwt-padd' });
  assertEquals([res.status, body], [200, { action: 'studio_sheet', result: 'ok', csv: 'Name EN,Vendor Price\nStudio Test,500\n' }]);
  assertEquals(woo.calls.map((c) => [c.path, c.query, c.redirect, 'authorization' in c.headers]), [
    [`/spreadsheets/d/e/${PUB}/pub`, { output: 'csv', gid: '7', single: 'true' }, 'manual', false],
    [`/pub/x/y/1/${PUB}`, { gid: '7', single: 'true', output: 'csv' }, 'manual', false]], 'the built URL, then Google\'s redirect — no key ever sent');
  const bad = await call(deps, { action: 'studio_sheet', url: 'https://evil.example/a.csv' }, { jwt: 'jwt-padd' });
  assertEquals([bad.res.status, bad.body.error, woo.calls.length], [400, 'bad_link', 2]);
  const closed = setup({ routes: { [`GET /spreadsheets/d/e/${PUB}/pub`]: { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } } } });
  assertEquals((await call(closed.deps, { action: 'studio_sheet', url: link }, { jwt: 'jwt-padd' })).body, { action: 'studio_sheet', result: 'error', reason: 'not_published' });
  assertEquals(db.rows('woo_sync_log').length, 0, 'a read: nothing logged or written');
});

Deno.test('woo-api (phase 5.2): of WordPress only wp/v2/media, with the Application Password; any other wp/ path refused; without the password a ConfigError, no call', async () => {
  const woo = fakeWoo({ 'POST wp/v2/media': { body: { id: 1 } } });
  const api = wooApi({ ...ENV, WOO_WP_USER: 'u', WOO_WP_APP_PASSWORD: 'p w' }, woo.fetch);
  for (const path of ['wp/v2/users', 'wp/v2/product', 'wp/v2/product/1', 'wp/v2/posts/1', 'wp/v2/media/5', 'wp/v2/product/1/revisions']) {
    let err: unknown = null; try { await api.post(path, {}); } catch (e) { err = e; }
    assert(err instanceof ConfigError, path);
  }
  assertEquals((await api.upload('wp/v2/media', new Uint8Array([1]), 'a b/../c.webp', 'image/webp')).data, { id: 1 });
  assertEquals(woo.calls[0].headers['content-disposition'], 'attachment; filename="a-b-..-c.webp"');
  const bare = wooApi(ENV, woo.fetch);
  let err: unknown = null; try { await bare.upload('wp/v2/media', new Uint8Array([1]), 'x.webp', 'image/webp'); } catch (e) { err = e; }
  assert(err instanceof ConfigError);
  assertEquals(woo.calls.length, 1);
});

// ---------------------------------------------------------------- product_images_add (phase 5.4 T8)

Deno.test('vendor_photo (phase 13 decision 51): the uploaded photo is recorded on the maker; with a store and the switch on it goes to wp/v2/media and becomes the Dokan store photo (gravatar_id), logo_url follows; no store / switch off → recorded only; vendors.edit F, never the secret; a path outside the maker\'s folder → 400', async () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 9, 9]);
  const V = vendorId(44); const path = `${V}/1700-logo.png`;
  const routes = {
    'POST wp/v2/media': () => ({ body: { id: 777, source_url: 'https://woo.test/up/logo.png' } }),
    'PUT dokan/v1/stores/44': (c: any) => ({ body: { ...wooStoreFull(44), gravatar: c.body.gravatar_id === 777 ? 'https://woo.test/up/logo-150.png' : null } }),
  };
  const { db, woo, deps } = setup({ seed: { vendors: [{ ...PUSH_ROW }] }, routes, env: WP_ENV, storage: { [`vendor-photos/${path}`]: PNG } });
  assertEquals((await call(deps, { action: 'vendor_photo', vendor_id: V, path })).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { action: 'vendor_photo', vendor_id: V, path }, { jwt: 'jwt-bank' })).res.status, 401, 'vendors.edit N');
  assertEquals((await call(deps, { action: 'vendor_photo', vendor_id: V, path: `${vendorId(45)}/x.png` }, { jwt: 'jwt-vf' })).body.field, 'path');
  assertEquals((await call(deps, { action: 'vendor_photo', vendor_id: V, path: `${V}/x.gif` }, { jwt: 'jwt-vf' })).body.field, 'path');
  const miss = await call(deps, { action: 'vendor_photo', vendor_id: V, path: `${V}/gone.png` }, { jwt: 'jwt-vf' });
  assertEquals([miss.res.status, woo.calls.length], [404, 0]);
  const { res, body } = await call(deps, { action: 'vendor_photo', vendor_id: V, path }, { jwt: 'jwt-vf' });
  assertEquals([res.status, body.result, body.site, body.media], [200, 'ok', 'ok', 777]);
  assertEquals(woo.calls.filter((c: any) => c.method === 'PUT').map((c: any) => [c.path, c.body]), [['dokan/v1/stores/44', { gravatar_id: 777 }]]);
  const row = db.rows('vendors').find((v: any) => v.id === V);
  assertEquals([row.photo_path, row.logo_url], [path, 'https://woo.test/up/logo-150.png']);
  // the switch off: recorded, nothing sent
  const off = setup({ seed: { vendors: [{ ...PUSH_ROW }] }, routes, env: {}, storage: { [`vendor-photos/${path}`]: PNG } });
  const r2 = await call(off.deps, { action: 'vendor_photo', vendor_id: V, path }, { jwt: 'jwt-vf' });
  assertEquals([r2.body.result, r2.body.site, r2.body.reason, off.woo.calls.length], ['ok', 'skipped', 'push_disabled', 0]);
  assertEquals(off.db.rows('vendors').find((v: any) => v.id === V).photo_path, path);
  // no store on the site: recorded only
  const ns = setup({ seed: { vendors: [{ ...PUSH_ROW, woo_vendor_id: null }] }, routes, env: WP_ENV, storage: { [`vendor-photos/${path}`]: PNG } });
  const r3 = await call(ns.deps, { action: 'vendor_photo', vendor_id: V, path }, { jwt: 'jwt-vf' });
  assertEquals([r3.body.site, r3.body.reason, ns.woo.calls.length], ['skipped', 'no_store', 0]);
  // the bytes decide, not the name or the declared type: a non-image named .png → 400, nothing kept, nothing sent
  const fake = setup({ seed: { vendors: [{ ...PUSH_ROW }] }, routes, env: WP_ENV, storage: { [`vendor-photos/${path}`]: new TextEncoder().encode('<svg onload=alert(1)></svg>') } });
  const r4 = await call(fake.deps, { action: 'vendor_photo', vendor_id: V, path }, { jwt: 'jwt-vf' });
  assertEquals([r4.res.status, r4.body.error, fake.woo.calls.length, fake.db.rows('vendors')[0].photo_path ?? null], [400, 'bad_type', 0, null]);
});

// ---------------------------------------------------------------- vendor_store (the owner, 11 Nov — «إضافة مبتكر» on the site)

const NEW_V = vendorId(901);
const NEW_ROW = { id: NEW_V, woo_vendor_id: null, name: 'ورشة جديدة', phone: '01011112222', email: 'new@maker.test', contact_name: 'سلمى علي', status: 'active', woo_snapshot: null, push_pending: null, photo_path: null,
  address_parts: { street_1: 'شارع 9', street_2: '', city: 'الجيزة', state: 'EG-21', zip: '', country: 'EG' }, social: { fb: 'https://fb.test/new', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' } };
const NEW_SEED = () => ({ vendors: [{ ...NEW_ROW }], vendor_logins: [{ vendor_id: NEW_V, username: 'warsha.new', email: 'new@maker.test' }],
  vendor_rates: [{ id: 1, vendor_id: NEW_V, rate: 25, flat: 5, since: '2026-10-01', commission_type: 'fixed' }], vendor_bank: [{ vendor_id: NEW_V, holder: 'سلمى علي', account_number: '1234567890', iban: '', bank_name: 'NBE' }],
  brands: [{ id: 'b1', name: 'ورشة جديدة', origin_vendor_id: NEW_V, created_by: 'system', store_vendor_id: null }, { id: 'b2', name: 'براند تاني', origin_vendor_id: NEW_V, created_by: 'سارة', store_vendor_id: null }] });
const PW = 'Temp1234pw';
const storeRoutes = (posted: any[], extra: Record<string, any> = {}) => ({
  'POST dokan/v1/stores': (c: any) => { posted.push(c.body); return { body: wooStoreFull(901, { store_name: c.body.store_name, email: c.body.email, phone: c.body.phone, admin_commission: c.body.admin_commission ?? '', admin_additional_fee: c.body.admin_additional_fee ?? '', shop_url: `https://woo.test/store/${c.body.user_nicename}/`, payment: { bank: c.body.payment?.bank ?? {} } }) }; },
  ...extra,
});

Deno.test('vendor_store: a maker without a store → one POST dokan/v1/stores (his portal login, the typed password, the shop URL, the row\'s store fields); the row is linked (woo_vendor_id, snapshot, nothing pending), his automatic brand tied; the password never kept nor logged; vendors.edit F, never the secret', async () => {
  const posted: any[] = [];
  const { db, woo, deps } = setup({ seed: NEW_SEED(), routes: storeRoutes(posted), env: WP_ENV });
  assertEquals((await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW })).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-bank' })).res.status, 401, 'vendors.edit N');
  for (const pw of ['short1', 'no digits here', 'with space 12', 'x'.repeat(64) + '1', 12345678]) assertEquals((await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: pw }, { jwt: 'jwt-vf' })).body.field, 'password', String(pw));
  assertEquals((await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW, shop_url: 'Bad URL!' }, { jwt: 'jwt-vf' })).body.field, 'shop_url');
  assertEquals((await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW, trusted: 'yes' }, { jwt: 'jwt-vf' })).body.field, 'toggles');
  assertEquals(woo.calls.length, 0);
  // vendors.edit F without sensitive.commission / vendor_bank: the store without the commission and the bank
  const { res, body } = await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW, trusted: true }, { jwt: 'jwt-vf' });
  assertEquals([res.status, body.result, body.store, body.adopted, body.commission, body.bank, body.shop_url], [200, 'ok', 901, false, false, false, 'https://woo.test/store/warsha-new/']);
  const p = posted[0];
  assertEquals([p.user_login, p.email, p.user_pass, p.user_nicename, p.store_name, p.phone, p.first_name, p.last_name, p.enabled, p.notify_vendor, p.trusted, p.featured],
    ['warsha.new', 'new@maker.test', PW, 'warsha-new', 'ورشة جديدة', '01011112222', 'سلمى', 'علي', true, true, true, false]);
  assertEquals([p.address.city, p.address.state, p.social.fb, 'admin_commission' in p, 'payment' in p], ['الجيزة', 'EG-21', 'https://fb.test/new', false, false]);
  const linked = db.rows('vendors').find((v: any) => v.id === NEW_V);
  assertEquals([linked.woo_vendor_id, linked.push_pending, linked.woo_snapshot.name, linked.woo_snapshot.phone, linked.woo_synced_at, linked.raw.id], [901, null, 'ورشة جديدة', '01011112222', NOW, 901]);
  assertEquals(db.rows('brands').map((b: any) => [b.id, b.store_vendor_id]), [['b1', NEW_V], ['b2', null]], 'the automatic brand only');
  assertEquals(db.rows('activity_log').map((a: any) => [a.action, a.entity_id, a.new_value]), [['vendor.store.create', NEW_V, '#901']]);
  const logs = db.rows('woo_sync_log').filter((l: any) => l.action === 'vendor_store');
  assertEquals(logs.at(-1).result, 'ok');
  const kept = writtenText(db) + JSON.stringify(db.rows('activity_log')) + JSON.stringify(db.rows('vendors'));
  assert(!kept.includes(PW), 'the password is never kept or logged');
  // a second call: the maker has a store now — nothing sent
  const again = await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([again.res.status, again.body.error, posted.length], [409, 'has_store', 1]);
});

Deno.test('vendor_store: the admin\'s store carries the commission and the bank (Dokan keys); notify off and the shop URL as asked; switch off → skipped, nothing sent; no login → 409', async () => {
  const posted: any[] = [];
  const { db, deps } = setup({ seed: NEW_SEED(), routes: storeRoutes(posted), env: WP_ENV });
  const r = await call(deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW, notify: false, shop_url: 'my-shop', featured: true }, { jwt: 'jwt-admin' });
  assertEquals([r.body.result, r.body.commission, r.body.bank], ['ok', true, true]);
  const p = posted[0];
  assertEquals([p.admin_commission_type, p.admin_commission, p.admin_additional_fee, p.payment.bank.ac_number, p.payment.bank.bank_name, p.notify_vendor, p.user_nicename, p.featured, p.trusted],
    ['fixed', '25', '5', '1234567890', 'NBE', false, 'my-shop', true, false]);
  const snap = db.rows('vendors').find((v: any) => v.id === NEW_V).woo_snapshot;
  assertEquals([snap.rate.rate, snap.rate.flat, snap.bank.length], [25, 5, 64], 'the bank as its digest only');
  assert(!JSON.stringify(db.rows('vendors')).includes('1234567890') && !writtenText(db).includes('1234567890'), 'no account number kept outside vendor_bank');
  // the switch off: skipped, nothing sent, the maker as he was
  const off = setup({ seed: NEW_SEED(), routes: storeRoutes([]), env: {} });
  const r2 = await call(off.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-admin' });
  assertEquals([r2.body.result, r2.body.reason, off.woo.calls.length, off.db.rows('vendors')[0].woo_vendor_id], ['skipped', 'push_disabled', 0, null]);
  // no portal login (and no e-mail of his own) → 409, nothing sent
  const nl = setup({ seed: { ...NEW_SEED(), vendor_logins: [], vendors: [{ ...NEW_ROW, email: null }] }, routes: storeRoutes([]), env: WP_ENV });
  const r3 = await call(nl.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-admin' });
  assertEquals([r3.res.status, r3.body.error, nl.woo.calls.length], [409, 'no_login', 0]);
});

Deno.test('vendor_store: the site\'s login / e-mail taken → the Dokan store with that e-mail is linked when no maker of ours has it (adopted, nothing written on the site), else 409; a taken shop URL → 409; a failure on the way → 502 and the maker stays without a store', async () => {
  const taken = (code: string) => ({ status: 400, body: { code, message: 'Sorry, that username already exists!', data: null } });
  const REG = '2026-10-25 11:59:40'; // WordPress's user_registered (GMT): the store made 20 s before NOW
  const found = (reg = REG) => [wooStoreFull(901, { email: 'NEW@maker.test', registered: reg }), wooStoreFull(902, { email: 'other@maker.test', registered: '2026-01-01 10:00:00' })];
  const byEmail = (reg = REG) => ({ 'POST dokan/v1/stores': () => taken('existing_user_login'), 'GET dokan/v1/stores': (c: any) => ({ body: c.query.search === 'new@maker.test' ? found(reg) : [] }) });
  // our own try that timed out after Dokan made the store: the first call fails on the way (an error row bound to the account by a
  // digest — no e-mail in the log), the retry meets the taken login → the store with his e-mail, registered around that try, is
  // linked — for vendors.edit F too
  let first = true;
  const a = setup({ seed: NEW_SEED(), env: WP_ENV, routes: { ...byEmail(), 'POST dokan/v1/stores': () => (first ? (first = false, { status: 504, text: 'Gateway Timeout' }) : taken('existing_user_login')) } });
  const r0 = await call(a.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([r0.res.status, r0.body.error, a.db.rows('vendors')[0].woo_vendor_id], [502, 'woo_error', null]);
  const tryRow = a.db.rows('woo_sync_log').filter((l: any) => l.action === 'vendor_store').at(-1);
  assertEquals([tryRow.result, tryRow.at, /^[0-9a-f]{64}$/.test(tryRow.detail.attempt), JSON.stringify(tryRow).includes('new@maker.test')], ['error', NOW, true, false]);
  const r = await call(a.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([r.body.result, r.body.store, r.body.adopted, r.body.commission], ['ok', 901, true, false]);
  assertEquals(a.woo.calls.filter((c: any) => c.method !== 'GET').map((c: any) => c.method + ' ' + c.path), ['POST dokan/v1/stores', 'POST dokan/v1/stores'], 'nothing else written on the site');
  assertEquals([a.db.rows('vendors').find((v: any) => v.id === NEW_V).woo_vendor_id, a.db.rows('activity_log').map((x: any) => x.action)], [901, ['vendor.store.link']]);
  // (security review) not ours → 409 store_unlinked, nothing linked, for a member: no earlier try; an earlier try for another
  // account (the login's e-mail changed after it); an earlier try for this account but the store registered long before it
  const tryOf = (attempt: string) => ({ id: 1, at: NOW, kind: 'push', direction: 'out', entity: 'vendor', entity_id: NEW_V, action: 'vendor_store', result: 'error', detail: { vendor_id: NEW_V, attempt, error: 'WooError: 504' } });
  const f = setup({ seed: NEW_SEED(), env: WP_ENV, routes: byEmail() });
  const h = setup({ seed: { ...NEW_SEED(), woo_sync_log: [tryOf('0'.repeat(64))] }, env: WP_ENV, routes: byEmail() });
  const i = setup({ seed: { ...NEW_SEED(), woo_sync_log: [tryOf(tryRow.detail.attempt)] }, env: WP_ENV, routes: byEmail('2026-09-01 10:00:00') });
  for (const w of [f, h, i]) {
    const rw = await call(w.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
    assertEquals([rw.res.status, rw.body.error, w.db.rows('vendors')[0].woo_vendor_id, w.db.rows('activity_log').length], [409, 'store_unlinked', null, 0]);
  }
  // … and the admin links it (a store made by hand on the site)
  const g = setup({ seed: NEW_SEED(), env: WP_ENV, routes: byEmail('2026-09-01 10:00:00') });
  const rg = await call(g.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-admin' });
  assertEquals([rg.body.result, rg.body.store, rg.body.adopted, g.db.rows('vendors')[0].woo_vendor_id], ['ok', 901, true, 901]);
  // the store with that e-mail is already one of our makers → 409 with its name
  const b = setup({ seed: { ...NEW_SEED(), vendors: [{ ...NEW_ROW }, { id: vendorId(950), woo_vendor_id: 901, name: 'مبتكر قديم' }] }, env: WP_ENV, routes: { 'POST dokan/v1/stores': () => taken('existing_user_email'), 'GET dokan/v1/stores': () => ({ body: [wooStoreFull(901, { email: 'new@maker.test' })] }) } });
  const r2 = await call(b.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([r2.res.status, r2.body.error, r2.body.name, b.db.rows('vendors').find((v: any) => v.id === NEW_V).woo_vendor_id], [409, 'exists_store', 'مبتكر قديم', null]);
  // no store with that e-mail (a customer's WordPress account) → 409 email_taken
  const c = setup({ seed: NEW_SEED(), env: WP_ENV, routes: { 'POST dokan/v1/stores': () => taken('existing_user_email'), 'GET dokan/v1/stores': () => ({ body: [] }) } });
  assertEquals((await call(c.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' })).body.error, 'email_taken');
  // a shop URL another store has
  const d = setup({ seed: NEW_SEED(), env: WP_ENV, routes: { 'POST dokan/v1/stores': () => ({ status: 400, body: { code: 'shop-url-error', message: 'Shop URL is not available' } }) } });
  const r4 = await call(d.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([r4.res.status, r4.body.error], [409, 'shop_url_taken']);
  // a 500 on the way: maybe made — 502, the maker stays without a store (a retry links it); an answer that echoes the request
  // (a proxy's error page) never puts the password in the log
  const e = setup({ seed: NEW_SEED(), env: WP_ENV, routes: { 'POST dokan/v1/stores': () => ({ status: 500, text: `<html><body>Bad gateway — the request was: warsha.new ${PW}</body></html>` }) } });
  const r5 = await call(e.deps, { action: 'vendor_store', vendor_id: NEW_V, password: PW }, { jwt: 'jwt-vf' });
  assertEquals([r5.res.status, r5.body.error, e.db.rows('vendors')[0].woo_vendor_id], [502, 'woo_error', null]);
  for (const w of [a, b, c, d, e, f, g, h, i]) assert(!writtenText(w.db).includes(PW), 'never the password in a log');
});

Deno.test('product_images_add: the member\'s own ai-images paths onto a product — each to wp/v2/media, one PUT with the current images + the new ones (first → ahead); products.edit = F, never the secret; another member\'s folder → 401; a missing object → 404 before any upload; push disabled → skipped; the log counts only', async () => {
  const UID = '00000000-0000-4000-8000-0000000000e1', OTHER = '00000000-0000-4000-8000-0000000000e2';
  const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const storage = { [`ai-images/${UID}/abc-1.webp`]: PNG, [`ai-images/${UID}/abc-2.png`]: PNG, [`ai-images/${OTHER}/x.webp`]: PNG };
  let media = 900;
  const routes = {
    'GET wc/v3/products/501': () => ({ body: wooProduct(501, 44, { name: 'Boho Lamp', images: [{ id: 7, src: 'https://woo.test/img/7.jpg' }] }) }),
    'POST wp/v2/media': () => ({ body: { id: ++media } }),
    'PUT wc/v3/products/501': (c: any) => ({ body: wooProduct(501, 44, { name: 'Boho Lamp', images: c.body.images.map((i: any) => ({ id: i.id, src: `https://woo.test/img/${i.id}.jpg` })) }) }),
  };
  const userId = async (jwt: string) => (jwt === 'jwt-pedit' ? UID : jwt === 'jwt-admin' ? '00000000-0000-4000-8000-0000000000a1' : null);
  const { db, woo, deps } = setup({ seed: prodSeed, routes, env: WP_ENV, storage });
  const d = { ...deps, userId };
  const paths = [`${UID}/abc-1.webp`, `${UID}/abc-2.png`];
  assertEquals((await call(d, { action: 'product_images_add', id: 501, paths }, { jwt: 'jwt-pview' })).res.status, 401, 'products.view alone');
  assertEquals((await call(d, { action: 'product_images_add', id: 501, paths })).res.status, 401, 'never the sync secret');
  assertEquals((await call(d, { action: 'product_images_add', id: 501, paths: [`${OTHER}/x.webp`] }, { jwt: 'jwt-pedit' })).res.status, 401, 'another member\'s folder');
  assertEquals((await call(d, { action: 'product_images_add', id: 501, paths: ['loose.webp'] }, { jwt: 'jwt-pedit' })).body.field, 'paths');
  assertEquals((await call(d, { action: 'product_images_add', id: 501, paths: [] }, { jwt: 'jwt-pedit' })).body.field, 'paths');
  assertEquals((await call(d, { action: 'product_images_add', id: 'x', paths }, { jwt: 'jwt-pedit' })).body.field, 'id');
  const miss = await call(d, { action: 'product_images_add', id: 501, paths: [paths[0], `${UID}/gone.webp`] }, { jwt: 'jwt-pedit' });
  assertEquals([miss.res.status, miss.body.error], [404, 'not_found']);
  assertEquals(woo.calls.length, 0, 'nothing sent so far');
  const { res, body } = await call(d, { action: 'product_images_add', id: 501, paths }, { jwt: 'jwt-pedit' });
  assertEquals([res.status, body.result, body.media, body.count, body.images], [200, 'ok', [901, 902], 2, 3]);
  const up = woo.calls.filter((c) => c.path === 'wp/v2/media');
  assertEquals(up.length, 2);
  assert(/^attachment; filename="Boho-Lamp-ai-\d{10}-01\.webp"$/.test(up[0].headers['content-disposition']), up[0].headers['content-disposition']);
  assertEquals([up[1].headers['content-type'], up[1].headers.authorization, up[1].body], ['image/png', 'Basic ' + btoa('wp-user:wp app pass'), { bytes: 7 }]);
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body]), [['wc/v3/products/501', { images: [{ id: 7 }, { id: 901 }, { id: 902 }] }]]);
  assertEquals(db.rows('products').find((p: any) => p.id === 501).image_url, 'https://woo.test/img/7.jpg', 'the mirror follows the answer');
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.entity, log.entity_id, log.action, log.result, log.detail], ['products', '501', 'product_images_add', 'ok', { count: 2, first: false, media: 2, images: 3 }]);
  assertFalse(JSON.stringify(log).includes('abc-1'), 'no path in the log');
  // first → the new ones ahead; the admin may send any folder
  const r2 = await call(d, { action: 'product_images_add', id: 501, paths: [`${OTHER}/x.webp`], first: true }, { jwt: 'jwt-admin' });
  assertEquals([r2.res.status, r2.body.media], [200, [903]]);
  assertEquals(woo.calls.filter((c) => c.method === 'PUT').at(-1)?.body, { images: [{ id: 903 }, { id: 7 }] });
  // the gate
  const off = setup({ seed: prodSeed, routes, storage });
  const r3 = await call({ ...off.deps, userId }, { action: 'product_images_add', id: 501, paths }, { jwt: 'jwt-pedit' });
  assertEquals([r3.body.result, r3.body.reason, off.woo.calls.length], ['skipped', 'push_disabled', 0]);
});

// ---------------------------------------------------------------- order_trash (phase 5.5 decision 10)

const trashSeed = {
  orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'ملغي', woo_status: 'cancelled', placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' },
    { id: 1003, number: '1003', customer_name: 'y', status: 'جاري التنفيذ', woo_status: 'processing', placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' }],
  sub_orders: [{ id: 1, order_id: 1001, vendor_id: vendorId(44), woo_order_id: 1002, woo_status: 'cancelled' }, { id: 2, order_id: 1001, vendor_id: vendorId(2376), woo_order_id: 1004, woo_status: 'cancelled' }],
};

Deno.test('order_trash: orders.status = F only, never the sync secret; a bad id → 400; unknown → 404; nothing on Woo', async () => {
  const { woo, deps } = setup({ seed: trashSeed, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-acct' })).res.status, 401, 'orders.status P');
  assertEquals((await call(deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-noview' })).res.status, 401, 'orders.view N (the same two checks as order_delete)');
  assertEquals((await call(deps, { action: 'order_trash', order_id: 1001 })).res.status, 401, 'the sync secret never deletes an order');
  assertEquals((await call(deps, { action: 'order_trash', order_id: 'x' }, { jwt: 'jwt-ops' })).res.status, 400);
  assertEquals((await call(deps, { action: 'order_trash', order_id: 99 }, { jwt: 'jwt-ops' })).res.status, 404);
  const gone = setup({ seed: { ...trashSeed, orders: [{ ...trashSeed.orders[0], deleted_at: '2026-11-02T10:00:00Z' }] }, env: PUSH_ON });
  assertEquals((await call(gone.deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-ops' })).res.status, 404, 'already marked deleted');
  assertEquals(woo.calls.length + gone.woo.calls.length, 0);
});

Deno.test('order_trash: an order that is not «ملغي» → skipped/not_cancelled; WOO_PUSH_ENABLED off → skipped/push_disabled; no Woo call either way', async () => {
  const { db, woo, deps } = setup({ seed: trashSeed, env: PUSH_ON });
  const { body } = await call(deps, { action: 'order_trash', order_id: 1003 }, { jwt: 'jwt-ops' });
  assertEquals(body, { action: 'order_trash', result: 'skipped', reason: 'not_cancelled', counts: { trashed: 0, already: 0 } });
  const off = setup({ seed: trashSeed });
  const r = await call(off.deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-ops' });
  assertEquals([r.body.result, r.body.reason], ['skipped', 'push_disabled']);
  assertEquals(woo.calls.length + off.woo.calls.length, 0);
  assertEquals(db.rows('woo_sync_log').map((x: any) => [x.kind, x.direction, x.entity, x.entity_id, x.action, x.result, x.detail]), [['push', 'out', 'order', '1003', 'trash', 'skipped', { reason: 'not_cancelled', current: 'جاري التنفيذ' }]]);
});

Deno.test('order_trash: DELETE wc/v3/orders/{sub} for each Dokan sub-order, then the parent, never `force`; 410 (already trashed) counts as done; logged ok', async () => {
  const routes = {
    'DELETE wc/v3/orders/1002': { body: { id: 1002, status: 'trash' } },
    'DELETE wc/v3/orders/1004': { status: 410, body: { code: 'woocommerce_rest_already_trashed', message: 'The order has already been deleted.' } },
    'DELETE wc/v3/orders/1001': { body: { id: 1001, status: 'trash' } },
  };
  const { db, woo, deps } = setup({ seed: trashSeed, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-ops' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'order_trash', result: 'ok', counts: { trashed: 2, already: 1 } });
  assertEquals(woo.calls.map((c) => [c.method, c.path, c.headers.authorization]), [['DELETE', 'wc/v3/orders/1002', WC_AUTH], ['DELETE', 'wc/v3/orders/1004', WC_AUTH], ['DELETE', 'wc/v3/orders/1001', WC_AUTH]]);
  assert(woo.calls.every((c) => !JSON.stringify(c.query ?? null).includes('force')), 'never force');
  assertEquals(db.writes('orders').length, 0); // the mark is the adapter's RPC, not this action
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.action, log.result, log.detail], ['push', 'out', 'order', '1001', 'trash', 'ok', { trashed: 2, already: 1, sub_orders: 2 }]);
});

Deno.test('order_trash: a Woo failure (500) → 502 woo_error, an error row, the parent not touched after a failed sub-order', async () => {
  const routes = { 'DELETE wc/v3/orders/1002': { status: 500, body: { code: 'x' } } };
  const { db, woo, deps } = setup({ seed: trashSeed, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'order_trash', order_id: 1001 }, { jwt: 'jwt-ops' });
  assertEquals([res.status, body], [502, { error: 'woo_error' }]);
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/orders/1002']);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.kind, log.entity, log.entity_id, log.action, log.result], ['push', 'order', '1001', 'order_trash', 'error']);
});

// ---------------------------------------------------------------- suborder_trash (phase 13 decision 54)
const subSeed = () => ({
  orders: [{ id: 3001, number: '3001', customer_name: 'x', status: 'جاري التنفيذ', woo_status: 'processing', total: 300, placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' },
    { id: 3101, number: '3101', customer_name: 'y', status: 'مكتمل', woo_status: 'completed', placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' }],
  sub_orders: [{ id: 11, order_id: 3001, vendor_id: vendorId(44), woo_order_id: 3002 }, { id: 12, order_id: 3001, vendor_id: vendorId(2376), woo_order_id: 3003 },
    { id: 13, order_id: 3101, vendor_id: vendorId(44), woo_order_id: 3102 }],
  order_items: [{ id: 30010, order_id: 3001, sub_order_id: 11, name: 'a', qty: 1, total: 100, removed: false, pulled: true, sku: 'IBT-A' },
    { id: 30011, order_id: 3001, sub_order_id: 11, name: 'b', qty: 1, total: 50, removed: false, pulled: false },
    { id: 30020, order_id: 3001, sub_order_id: 12, name: 'c', qty: 1, total: 150, removed: false, pulled: false },
    { id: 31010, order_id: 3101, sub_order_id: 13, name: 'd', qty: 1, total: 10, removed: false, pulled: false }],
  inv_lots: [{ id: 'lt1', sku: 'IBT-A', name: 'a', reason: 'متاح للبيع', status: 'محجوز لأوردر', closed_at: null }],
  inv_moves: [{ id: 1, lot_id: 'lt1', type: 'in', qty: 1, ref: null, note: null }, { id: 2, lot_id: 'lt1', type: 'reserve', qty: 1, ref: 'IB-3001', note: 'سحب تلقائي · سطر #30010' }],
});
const parentAfter = wooOrder({ id: 3001, number: '3001', status: 'processing', total: '150.00', date_modified_gmt: '2026-11-10T10:00:00', meta_data: [],
  line_items: [{ id: 30020, product_id: 9, name: 'c', quantity: 1, total: '150', meta_data: [{ key: '_dokan_vendor_id', value: '2376' }] }] });

Deno.test('suborder_trash: orders.status = F only, never the sync secret; bad input → 400; a completed order → 409 closed; the only sub-order → 409 only_sub; push off → skipped, no Woo call', async () => {
  const { woo, deps } = setup({ seed: subSeed(), env: PUSH_ON });
  const a = { action: 'suborder_trash', order_id: 3001, sub_id: 3002, reason: 'أوردر مكرر' };
  assertEquals((await call(deps, a, { jwt: 'jwt-acct' })).res.status, 401, 'orders.status P');
  assertEquals((await call(deps, a)).res.status, 401, 'the sync secret never deletes');
  assertEquals((await call(deps, { ...a, reason: ' ' }, { jwt: 'jwt-ops' })).res.status, 400, 'a reason is required');
  assertEquals((await call(deps, { ...a, sub_id: 'x' }, { jwt: 'jwt-ops' })).res.status, 400);
  assertEquals((await call(deps, { ...a, sub_id: 9999 }, { jwt: 'jwt-ops' })).res.status, 404, 'not a sub-order of this order');
  const closed = await call(deps, { ...a, order_id: 3101, sub_id: 3102 }, { jwt: 'jwt-ops' });
  assertEquals([closed.res.status, closed.body.error], [409, 'closed']);
  const one = setup({ seed: { ...subSeed(), order_items: subSeed().order_items.filter((i) => i.sub_order_id !== 12) }, env: PUSH_ON });
  const only = await call(one.deps, a, { jwt: 'jwt-ops' });
  assertEquals([only.res.status, only.body.error], [409, 'only_sub']);
  const off = setup({ seed: subSeed() });
  const r = await call(off.deps, a, { jwt: 'jwt-ops' });
  assertEquals([r.body.result, r.body.reason], ['skipped', 'push_disabled']);
  assertEquals(woo.calls.length + one.woo.calls.length + off.woo.calls.length, 0);
  assertEquals(off.db.rows('order_items').filter((i: any) => i.removed).length, 0, 'nothing changes here either');
});

Deno.test('suborder_trash: DELETE the sub-order (never force) and nothing else on the site — the parent is never written (Dokan PR #3454); its lines flagged here (removed + dropped_at), the sub-order trashed, the hub reservation released', async () => {
  const routes = { 'DELETE wc/v3/orders/3002': { body: { id: 3002, status: 'trash' } } };
  const { db, woo, deps } = setup({ seed: subSeed(), routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'suborder_trash', order_id: 3001, sub_id: 3002, reason: 'أوردر مكرر' }, { jwt: 'jwt-ops' });
  assertEquals(res.status, 200);
  assertEquals([body.result, body.lines, body.already, body.released, body.total], ['ok', 2, false, 1, null]);
  assertEquals(woo.calls.map((c) => [c.method, c.path]), [['DELETE', 'wc/v3/orders/3002']], 'the parent 3001 is never written');
  assert(woo.calls.every((c) => !JSON.stringify(c.query ?? null).includes('force')), 'never force');
  const items = new Map(db.rows('order_items').map((i: any) => [i.id, i]));
  assertEquals([items.get(30010).removed, items.get(30011).removed, items.get(30020).removed], [true, true, false]);
  assertEquals([items.get(30010).dropped_at, items.get(30011).dropped_at, items.get(30020).dropped_at], [NOW, NOW, null], 'dropped here: the sync cannot bring them back (0079)');
  assertEquals(items.get(30010).pulled, false);
  assertEquals(db.rows('sub_orders').find((x: any) => x.woo_order_id === 3002).woo_status, 'trash');
  assertEquals(Number(db.rows('orders').find((o: any) => o.id === 3001).total), 300, 'the order keeps the site\'s total');
  const rel = db.rows('inv_moves').filter((m: any) => m.type === 'release');
  assertEquals(rel.map((m: any) => [m.lot_id, m.qty, m.ref, m.note, m.by]), [['lt1', 1, 'IB-3001', 'سحب تلقائي · سطر #30010', null]]);
  assertEquals(db.rows('inv_lots')[0].status, 'متاح');
  const log = db.rows('woo_sync_log').find((x: any) => x.action === 'suborder_trash');
  assertEquals([log.result, log.detail], ['ok', { sub: 3002, lines: 2, already: false, released: 1 }]);
  // again (a retry): the lines are gone → 404, nothing sent
  const again = await call(deps, { action: 'suborder_trash', order_id: 3001, sub_id: 3002, reason: 'أوردر مكرر' }, { jwt: 'jwt-ops' });
  assertEquals(again.res.status, 404);
  assertEquals(woo.calls.length, 1);
});

Deno.test('suborder_trash: the trash fails → 502, nothing flagged; already trashed (410) → done, the lines flagged all the same', async () => {
  const bad = setup({ seed: subSeed(), routes: { 'DELETE wc/v3/orders/3002': { status: 500, body: { code: 'x' } } }, env: PUSH_ON });
  const r = await call(bad.deps, { action: 'suborder_trash', order_id: 3001, sub_id: 3002, reason: 'x' }, { jwt: 'jwt-ops' });
  assertEquals([r.res.status, r.body], [502, { error: 'woo_error', step: 'trash' }]);
  assertEquals(bad.woo.calls.map((c) => c.method), ['DELETE']);
  assertEquals(bad.db.rows('order_items').filter((i: any) => i.removed || i.dropped_at).length, 0);
  const k = setup({ seed: subSeed(), routes: { 'DELETE wc/v3/orders/3002': { status: 410, body: { code: 'woocommerce_rest_already_trashed' } } }, env: PUSH_ON });
  const r2 = await call(k.deps, { action: 'suborder_trash', order_id: 3001, sub_id: 3002, reason: 'x' }, { jwt: 'jwt-ops' });
  assertEquals([r2.res.status, r2.body.result, r2.body.already], [200, 'ok', true]);
  assertEquals(k.woo.calls.map((c) => c.method), ['DELETE']);
  assertEquals(k.db.rows('order_items').filter((i: any) => i.removed).map((i: any) => i.id).sort(), [30010, 30011]);
});

// ---------------------------------------------------------------- line_trash / suborder_status (the owner 11 Nov)
const lineSeed = () => { const b = subSeed();
  return { ...b, status_map: [{ system_status: 'جاري التنفيذ', woo_status: 'processing', direction: 'both', sort: 2 }, { system_status: 'جاهز للشحن', woo_status: 'ready-shipping', direction: 'both', sort: 4 }, { system_status: 'تم RTC', woo_status: null, direction: 'from_system', sort: 6 }],
    order_items: b.order_items.map((i: any) => ({ ...i, product_id: i.id === 30010 ? 77 : i.id === 30011 ? 78 : 79 })) }; };
const subOrder3002 = { id: 3002, status: 'processing', line_items: [{ id: 9001, product_id: 77, variation_id: 0, quantity: 1, total: '100' }, { id: 9002, product_id: 78, variation_id: 0, quantity: 1, total: '50' }] };
const parentWithout30010 = wooOrder({ id: 3001, number: '3001', status: 'processing', total: '200.00', date_modified_gmt: '2026-11-11T10:00:00', meta_data: [],
  line_items: [{ id: 30011, product_id: 78, name: 'b', quantity: 1, total: '50', meta_data: [{ key: '_dokan_vendor_id', value: '44' }] }, { id: 30020, product_id: 79, name: 'c', quantity: 1, total: '150', meta_data: [{ key: '_dokan_vendor_id', value: '2376' }] }] });

Deno.test('line_trash: orders.status = F only, never the sync secret; bad input → 400; closed → 409; the last line of its sub-order → 409 only_in_sub; the order\'s last line → 409 only_line; push off → skipped', async () => {
  const { woo, deps } = setup({ seed: lineSeed(), env: PUSH_ON });
  const a = { action: 'line_trash', order_id: 3001, item_id: 30010, reason: 'العميل لغى المنتج' };
  assertEquals((await call(deps, a, { jwt: 'jwt-acct' })).res.status, 401);
  assertEquals((await call(deps, a)).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { ...a, reason: '' }, { jwt: 'jwt-ops' })).res.status, 400);
  assertEquals((await call(deps, { ...a, item_id: 99999 }, { jwt: 'jwt-ops' })).res.status, 404);
  const cl = await call(deps, { ...a, order_id: 3101, item_id: 31010 }, { jwt: 'jwt-ops' });
  assertEquals([cl.res.status, cl.body.error], [409, 'closed']);
  const sub = await call(deps, { ...a, item_id: 30020 }, { jwt: 'jwt-ops' });
  assertEquals([sub.res.status, sub.body.error, sub.body.sub], [409, 'only_in_sub', 3003]);
  const one = setup({ seed: { ...lineSeed(), order_items: lineSeed().order_items.filter((i: any) => i.id === 30010 || i.id === 31010) }, env: PUSH_ON });
  const only = await call(one.deps, a, { jwt: 'jwt-ops' });
  assertEquals([only.res.status, only.body.error], [409, 'only_line']);
  const off = setup({ seed: lineSeed() });
  const r = await call(off.deps, a, { jwt: 'jwt-ops' });
  assertEquals([r.body.result, r.body.reason], ['skipped', 'push_disabled']);
  assertEquals(woo.calls.length + one.woo.calls.length + off.woo.calls.length, 0);
});

Deno.test('line_trash: the line off the maker\'s sub-order (found by product) and nothing else on the site — the parent is never written (Dokan PR #3454); flagged here (removed + dropped_at), the hub hold released; an unclear sub-order line → 409 sub_line and nothing written', async () => {
  const puts: any[] = [];
  const routes = { 'GET wc/v3/orders/3002': { body: subOrder3002 }, 'PUT wc/v3/orders/3002': (c: any) => { puts.push(['sub', c.body]); return { body: { ...subOrder3002, line_items: [subOrder3002.line_items[1]] } }; } };
  const { db, woo, deps } = setup({ seed: lineSeed(), routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'line_trash', order_id: 3001, item_id: 30010, reason: 'العميل لغى المنتج' }, { jwt: 'jwt-ops' });
  assertEquals(res.status, 200);
  assertEquals([body.result, body.sub, body.released, body.total], ['ok', 3002, 1, null]);
  assertEquals(woo.calls.map((c) => [c.method, c.path]), [['GET', 'wc/v3/orders/3002'], ['PUT', 'wc/v3/orders/3002']], 'the parent 3001 is never written');
  assertEquals(puts, [['sub', { line_items: [{ id: 9001, product_id: null }] }]]);
  const items = new Map(db.rows('order_items').map((i: any) => [i.id, i]));
  assertEquals([items.get(30010).removed, items.get(30011).removed, items.get(30020).removed], [true, false, false]);
  assertEquals([items.get(30010).dropped_at, items.get(30011).dropped_at], [NOW, null]);
  assertEquals(Number(db.rows('orders').find((o: any) => o.id === 3001).total), 300, 'the order keeps the site\'s total');
  assertEquals(db.rows('inv_moves').filter((m: any) => m.type === 'release').map((m: any) => m.note), ['سحب تلقائي · سطر #30010']);
  // two lines of the same product on the sub-order, neither matching the quantity and total → refused, nothing written
  const twin = { ...subOrder3002, line_items: [{ id: 9001, product_id: 77, quantity: 2, total: '200' }, { id: 9003, product_id: 77, quantity: 3, total: '300' }, subOrder3002.line_items[1]] };
  const t = setup({ seed: lineSeed(), routes: { 'GET wc/v3/orders/3002': { body: twin } }, env: PUSH_ON });
  const r = await call(t.deps, { action: 'line_trash', order_id: 3001, item_id: 30010, reason: 'x' }, { jwt: 'jwt-ops' });
  assertEquals([r.res.status, r.body.error, r.body.matches], [409, 'sub_line', 0]);
  assertEquals(t.woo.calls.map((c) => c.method), ['GET']);
  assertEquals(t.db.rows('order_items').filter((i: any) => i.removed).length, 0);
});

Deno.test('line_trash: an order of one maker (no sub-order) → off the order itself (PUT, mirrored, its total); a line of an order with sub-orders that points to none → 409 sub_line, no Woo call', async () => {
  const one = { ...lineSeed(), orders: [...lineSeed().orders, { id: 3201, number: '3201', customer_name: 'z', status: 'جاري التنفيذ', woo_status: 'processing', total: 300, placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-20T11:00:00Z' }],
    order_items: [...lineSeed().order_items, { id: 32010, order_id: 3201, name: 'e', qty: 1, total: 100, removed: false, pulled: false, product_id: 80 }, { id: 32011, order_id: 3201, name: 'f', qty: 1, total: 200, removed: false, pulled: false, product_id: 81 }] };
  const after = wooOrder({ id: 3201, number: '3201', status: 'processing', total: '200.00', date_modified_gmt: '2026-11-11T10:00:00', meta_data: [{ key: '_dokan_vendor_id', value: '44' }],
    line_items: [{ id: 32011, product_id: 81, name: 'f', quantity: 1, total: '200', meta_data: [] }] });
  const puts: any[] = [];
  const { db, woo, deps } = setup({ seed: one, routes: { 'PUT wc/v3/orders/3201': (c: any) => { puts.push(c.body); return { body: after }; } }, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'line_trash', order_id: 3201, item_id: 32010, reason: 'x' }, { jwt: 'jwt-ops' });
  assertEquals([res.status, body.result, body.sub, body.total], [200, 'ok', null, '200.00']);
  assertEquals(woo.calls.map((c) => [c.method, c.path]), [['PUT', 'wc/v3/orders/3201']]);
  assertEquals(puts, [{ line_items: [{ id: 32010, product_id: null }] }]);
  assertEquals(db.rows('order_items').find((i: any) => i.id === 32010).removed, true);
  assertEquals(Number(db.rows('orders').find((o: any) => o.id === 3201).total), 200);
  // order 3001 has sub-orders: a line that points to none cannot be taken off the site safely
  const loose = { ...lineSeed(), order_items: lineSeed().order_items.map((i: any) => (i.id === 30011 ? { ...i, sub_order_id: null } : i)) };
  const l = setup({ seed: loose, env: PUSH_ON });
  const r = await call(l.deps, { action: 'line_trash', order_id: 3001, item_id: 30011, reason: 'x' }, { jwt: 'jwt-ops' });
  assertEquals([r.res.status, r.body.error], [409, 'sub_line']);
  assertEquals(l.woo.calls.length, 0);
  assertEquals(l.db.rows('order_items').filter((i: any) => i.removed).length, 0);
});

Deno.test('suborder_status: the site status of a sub-order (a status_map slug), kept from WooCommerce\'s answer; unknown slug / the order itself / no sub → 400 / 404; push off → skipped; the site keeps another status → 502', async () => {
  const puts: any[] = [];
  const routes = { 'PUT wc/v3/orders/3002': (c: any) => { puts.push(c.body); return { body: { id: 3002, status: c.body.status } }; } };
  const { db, woo, deps } = setup({ seed: lineSeed(), routes, env: PUSH_ON });
  const a = { action: 'suborder_status', order_id: 3001, sub_id: 3002, status: 'ready-shipping' };
  assertEquals((await call(deps, a, { jwt: 'jwt-acct' })).res.status, 401);
  assertEquals((await call(deps, a)).res.status, 401, 'never the sync secret');
  assertEquals((await call(deps, { ...a, status: 'trash' }, { jwt: 'jwt-ops' })).body.error, 'bad_status', 'only what status_map knows');
  assertEquals((await call(deps, { ...a, status: 'Bad Slug' }, { jwt: 'jwt-ops' })).res.status, 400);
  assertEquals((await call(deps, { ...a, sub_id: 3001 }, { jwt: 'jwt-ops' })).res.status, 400, 'the order itself is not a sub-order');
  assertEquals((await call(deps, { ...a, sub_id: 9999 }, { jwt: 'jwt-ops' })).res.status, 404);
  const { res, body } = await call(deps, a, { jwt: 'jwt-ops' });
  assertEquals([res.status, body.result, body.status], [200, 'ok', 'ready-shipping']);
  assertEquals(puts, [{ status: 'ready-shipping' }]);
  assertEquals(woo.calls.map((c) => [c.method, c.path]), [['PUT', 'wc/v3/orders/3002']]);
  assertEquals(db.rows('sub_orders').find((x: any) => x.woo_order_id === 3002).woo_status, 'ready-shipping');
  assertEquals(db.rows('order_items').find((i: any) => i.id === 30010).status || '', '', 'the team\'s line status is untouched');
  const off = setup({ seed: lineSeed() });
  assertEquals((await call(off.deps, a, { jwt: 'jwt-ops' })).body.reason, 'push_disabled');
  assertEquals(off.woo.calls.length, 0);
  const kept = setup({ seed: lineSeed(), routes: { 'PUT wc/v3/orders/3002': { body: { id: 3002, status: 'processing' } } }, env: PUSH_ON });
  const k = await call(kept.deps, a, { jwt: 'jwt-ops' });
  assertEquals([k.res.status, k.body.error], [502, 'woo_kept_status']);
  assertEquals(kept.db.rows('sub_orders').find((x: any) => x.woo_order_id === 3002).woo_status ?? null, null);
});

// ---------------------------------------------------------------- phase 7 (decision 1 c): the site quantity from the hub
const invLot = (id: string, sku: string, o: Record<string, unknown> = {}) => ({ id, sku, name: sku, reason: 'متاح للبيع', status: 'متاح', mode: 'ملك ابتكر', cost: 0, since: '2026-11-01', closed_at: null, ...o });
const invSeed = {
  products: [{ id: 501, sku: 'IBT-OWN', name: 'Lamp', status: 'publish', lang: 'en', translation_ids: { ar: 601, en: 501 } }, { id: 601, sku: 'IBT-OWN', name: 'لمبة', status: 'publish', lang: 'ar', translation_ids: { ar: 601, en: 501 } },
    { id: 502, sku: 'IBT-AM', name: 'Vase', status: 'publish', lang: 'en', translation_ids: { en: 502 } }],
  inv_lots: [invLot('l1', 'IBT-OWN'), invLot('l2', 'IBT-AM', { mode: 'أمانة' }), invLot('l3', 'IBT-GONE')],
  inv_moves: [{ id: 1, lot_id: 'l1', type: 'in', qty: 4 }, { id: 2, lot_id: 'l1', type: 'reserve', qty: 1 }, { id: 3, lot_id: 'l2', type: 'in', qty: 9 }, { id: 4, lot_id: 'l3', type: 'in', qty: 2 }],
  settings: [{ section: 'inventory', data: { wooSync: true } }],
};

// ---------------------------------------------------------------- carts (phase 12 T7, decisions 7 / 13)

Deno.test('carts: the site snippet\'s rows → cs_carts on cart_id (phone, name, total, items, status, the recovery link on the site only — no contents); the snippet missing (404) → installed false and no log row; the cron or the admin only', async () => {
  const feed = [
    { id: 41, email: 'noha@example.test', phone: '+20 101 234 5678', name: 'نهى عبد الرحمن', total: 1250.5, items: 2, status: 'normal', unsubscribed: false, updated_at: '2026-10-25T08:00:00+00:00', url: 'https://woo.test/checkout/?wcf_ac_token=abc', cart_contents: 'never read' },
    { id: 42, email: '', phone: '01099999999', name: '', total: 300, items: 1, status: 'completed', unsubscribed: true, updated_at: '2026-10-25T07:00:00+00:00', url: 'https://evil.test/checkout/' },
    { id: 'x' },
  ];
  const { db, woo, deps } = setup({ routes: { 'GET ibtekr/v1/carts': (c: any) => (c.query.probe === '1' ? { body: { tables: [{ table: 'wp_woodmart_abandoned_carts', columns: ['ID', 'email'], rows: 3 }], woodmart: true } } : c.query.hours === '48' ? { body: feed } : { status: 400, body: {} }) } });
  const { res, body } = await call(deps, { action: 'carts' });
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.counts, { installed: true, carts: 2, bad: 1, failed_rows: 0 });
  assertEquals(db.rows('cs_carts').map((r: any) => [r.cart_id, r.email, r.phone, r.name, r.total, r.items, r.status, r.unsubscribed, r.url, r.site_updated_at]),
    [[41, 'noha@example.test', '+201012345678', 'نهى عبد الرحمن', 1250.5, 2, 'normal', false, 'https://woo.test/checkout/?wcf_ac_token=abc', '2026-10-25T08:00:00.000Z'],
     [42, '', '01099999999', '', 300, 1, 'completed', true, '', '2026-10-25T07:00:00.000Z']]);
  assertFalse(JSON.stringify(db.rows('cs_carts')).includes('never read'), 'the cart contents never land');
  assert(woo.calls.every((c) => c.method === 'GET' && c.path === 'ibtekr/v1/carts'), 'one read-only route');
  assertEquals(woo.calls[0].headers.authorization, WC_AUTH, 'the WooCommerce keys');
  assertEquals([db.rows('woo_sync_log').at(-1).entity, db.rows('woo_sync_log').at(-1).result], ['cs_carts', 'ok']);
  // the admin by hand; a member who is not admin cannot; the snippet missing = skipped, not an error
  assertEquals((await call(deps, { action: 'carts' }, { jwt: 'jwt-admin' })).res.status, 200);
  assertEquals((await call(deps, { action: 'carts' }, { jwt: 'jwt-ops' })).res.status, 401);
  // the probe: the admin reads what the site has (tables + columns, no rows); the cron cannot
  const pr = await call(deps, { action: 'carts', probe: true }, { jwt: 'jwt-admin' });
  assertEquals([pr.res.status, pr.body.installed], [200, true]); assertEquals(woo.calls.at(-1)!.query.probe, '1');
  assertEquals((await call(deps, { action: 'carts', probe: true })).res.status, 401, 'the sync secret cannot probe');
  const none = setup();
  const r2 = await call(none.deps, { action: 'carts' });
  assertEquals([r2.res.status, r2.body.counts], [200, { installed: false, carts: 0, bad: 0, failed_rows: 0 }]);
  assertEquals(none.db.rows('woo_sync_log').filter((r: any) => r.entity === 'cs_carts').length, 0, 'no log row while the snippet is not on the site'); assertEquals(none.db.rows('cs_carts').length, 0);
  // the live site without the snippet (9–14 Nov): WordPress answers the unknown route with 401 invalid_username (it reads the WC keys as
  // an application password) — the same «not installed», for the pull and the probe; any other 401 is still a failure
  const wp401 = { status: 401, body: { code: 'invalid_username', message: 'Unknown username.', data: { status: 401 } } };
  const off = setup({ routes: { 'GET ibtekr/v1/carts': wp401 } });
  const r3 = await call(off.deps, { action: 'carts' });
  assertEquals([r3.res.status, r3.body.counts], [200, { installed: false, carts: 0, bad: 0, failed_rows: 0 }]);
  assertEquals(off.db.rows('woo_sync_log').filter((r: any) => r.entity === 'cs_carts' || r.result === 'error').length, 0, 'no error row');
  const p3 = await call(off.deps, { action: 'carts', probe: true }, { jwt: 'jwt-admin' });
  assertEquals([p3.res.status, p3.body.installed], [200, false]);
  const bad = setup({ routes: { 'GET ibtekr/v1/carts': { status: 401, body: { code: 'woocommerce_rest_cannot_view', message: 'no' } } } });
  assert((await call(bad.deps, { action: 'carts' })).res.status >= 500, 'a refusal of the keys by the snippet itself stays a failure');
});

Deno.test('inventory_push: the owned SKUs\' available pieces onto the product and its translation (manage_stock + stock_quantity), the mirror follows; a «أمانة» SKU untouched; a SKU not on the site counted missing; inventory.edit + products.edit; never the sync secret', async () => {
  const puts: [string, unknown][] = [];
  const routes = { 'PUT wc/v3/products/501': (c: any) => { puts.push(['501', c.body]); return { body: { id: 501 } }; }, 'PUT wc/v3/products/601': (c: any) => { puts.push(['601', c.body]); return { body: { id: 601 } }; } };
  const { db, deps } = setup({ seed: invSeed, routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'inventory_push' }, { jwt: 'jwt-inv' });
  assertEquals(res.status, 200);
  assertEquals([body.counts, body.missing], [{ pushed: 1, missing: 1, failed: 0 }, ['IBT-GONE']]);
  assertEquals(puts, [['501', { manage_stock: true, stock_quantity: 3 }], ['601', { manage_stock: true, stock_quantity: 3 }]], '4 in − 1 reserved; the Arabic translation too; IBT-AM (أمانة) never');
  assertEquals(db.rows('products').map((p: any) => [p.id, p.stock_quantity ?? null]), [[501, 3], [601, 3], [502, null]]);
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.action, log.result, log.detail.pushed, log.detail.missing], ['inventory_push', 'ok', 1, 1]);
  assertEquals((await call(deps, { action: 'inventory_push', skus: ['IBT-AM'] }, { jwt: 'jwt-inv' })).body.counts, { pushed: 0, missing: 0, failed: 0 }, 'a maker\'s SKU is not followed');
  assertEquals((await call(deps, { action: 'inventory_push', skus: 'IBT-OWN' }, { jwt: 'jwt-inv' })).body.field, 'skus');
  assertEquals((await call(deps, { action: 'inventory_push' }, { jwt: 'jwt-pedit' })).res.status, 401, 'products.edit is not inventory.edit');
  assertEquals((await call(deps, { action: 'inventory_push' }, { jwt: 'jwt-invonly' })).res.status, 401, 'inventory.edit alone cannot set a product\'s stock (the lot\'s mode and SKU are the member\'s input)');
  assertEquals((await call(deps, { action: 'inventory_push' })).res.status, 401, 'never the sync secret');
  assertEquals(puts.length, 2);
});

Deno.test('inventory_push is off by default (wooSync not set) and gated by WOO_PUSH_ENABLED', async () => {
  const off = setup({ seed: { ...invSeed, settings: [] }, env: PUSH_ON });
  assertEquals((await call(off.deps, { action: 'inventory_push' }, { jwt: 'jwt-inv' })).body, { action: 'inventory_push', result: 'skipped', reason: 'off' });
  const gate = setup({ seed: invSeed });
  assertEquals((await call(gate.deps, { action: 'inventory_push' }, { jwt: 'jwt-admin' })).body, { action: 'inventory_push', result: 'skipped', reason: 'push_disabled' });
  assertEquals([...off.woo.calls, ...gate.woo.calls].length, 0);
});

// ---------------------------------------------------------------- an order from the chat (phase 13 T3, decision 7)
Deno.test('order_create: orders.status = F (a person, never the sync secret); the customer from our row, the lines from the mirror; POST wc/v3/orders pending / unpaid; mirrored at once; the pay link; a trashed product → 400; order_pay_link for a pending order of that customer only', async () => {
  const CUST = '00000000-0000-4000-8000-00000000c0b1';
  const posts: any[] = [];
  const woo = { id: 7001, number: '7001', status: 'pending', total: '1500.00', order_key: 'wc_order_AbC123xyz', payment_url: 'https://shop.test/checkout/order-pay/7001/?pay_for_order=true&key=wc_order_AbC123xyz', date_created_gmt: '2026-11-09T12:00:00', date_modified_gmt: '2026-11-09T12:00:00', created_via: 'ibtekr-ops', billing: { first_name: 'نهى', last_name: 'ع', phone: '01012345678', city: 'القاهرة', address_1: 'شارع 9' }, shipping: {}, meta_data: [], line_items: [{ id: 70010, product_id: 9001, name: 'Cushion', quantity: 2, total: '1500', meta_data: [] }] };
  const { db, deps } = setup({ env: { WOO_PUSH_ENABLED: '1', WOO_URL: 'https://shop.test' }, seed: { cs_customers: [{ id: CUST, name: 'نهى عبد الرحمن', phone: '01012345678', city: 'القاهرة', address: 'شارع 9' }], products: [{ id: 9001, sku: 'S1', name: 'Cushion', vendor_id: vendorId(44) }, { id: 9002, sku: 'S2', name: 'Gone', vendor_id: vendorId(44), trashed_at: NOW }] },
    routes: { 'POST wc/v3/orders': (c: any) => { posts.push(c.body); return { body: woo }; }, 'GET wc/v3/orders': (c: any) => (c.query.parent ? { body: [] } : undefined), 'GET wc/v3/orders/7001': { body: woo } } });
  assertEquals((await call(deps, { action: 'order_create', customer_id: CUST, items: [{ product_id: 9001, qty: 2 }] })).res.status, 401, 'the sync secret never makes an order');
  assertEquals((await call(deps, { action: 'order_create', customer_id: CUST, items: [{ product_id: 9001, qty: 2 }] }, { jwt: 'jwt-acct' })).res.status, 401, 'orders.status P');
  assertEquals((await call(deps, { action: 'order_create', customer_id: CUST, items: [{ product_id: 9002 }] }, { jwt: 'jwt-ops' })).body, { error: 'bad_request', field: 'product', product_id: 9002 });
  const r = await call(deps, { action: 'order_create', customer_id: CUST, items: [{ product_id: 9001, qty: 2 }], note: 'بعد 5 م', conversation_id: '00000000-0000-4000-8000-00000000d0d1' }, { jwt: 'jwt-ops' });
  assertEquals(r.body, { action: 'order_create', result: 'ok', id: 7001, number: '7001', payment_url: 'https://shop.test/checkout/order-pay/7001/?pay_for_order=true&key=wc_order_AbC123xyz' });
  assertEquals([posts[0].status, posts[0].set_paid, posts[0].billing.phone, posts[0].billing.first_name, posts[0].line_items, posts[0].customer_note], ['pending', false, '01012345678', 'نهى', [{ product_id: 9001, quantity: 2 }], 'بعد 5 م']);
  assertEquals(db.row('orders', 7001)?.status, 'قيد الانتظار', 'mirrored at once');
  assertFalse(JSON.stringify(db.row('orders', 7001).raw).includes('wc_order_'), 'the order key never sits in the mirror');
  assertEquals(db.rows('woo_sync_log').filter((l: any) => l.action === 'create').map((l: any) => [l.result, l.detail.lines]), [['ok', 1]]);
  // the pay link of that order for that customer; another customer / a completed order / the sync secret: no
  const p = await call(deps, { action: 'order_pay_link', order_id: 7001, customer_id: CUST }, { jwt: 'jwt-ops' });
  assertEquals(p.body, { action: 'order_pay_link', result: 'ok', id: 7001, number: '7001', url: 'https://shop.test/checkout/order-pay/7001/?pay_for_order=true&key=wc_order_AbC123xyz' });
  assertEquals((await call(deps, { action: 'order_pay_link', order_id: 7001, customer_id: '00000000-0000-4000-8000-00000000c0b9' }, { jwt: 'jwt-ops' })).res.status, 404);
  await db.from('orders').update({ status: 'مكتمل' }).eq('id', 7001);
  assertEquals((await call(deps, { action: 'order_pay_link', order_id: 7001 }, { jwt: 'jwt-ops' })).body.error, 'not_payable');
  assertEquals((await call(deps, { action: 'order_pay_link', order_id: 7001 })).res.status, 401);
  // the gate off: nothing posted
  const off = setup({ env: { WOO_URL: 'https://shop.test' }, seed: { cs_customers: [{ id: CUST, name: 'نهى', phone: '01012345678' }], products: [{ id: 9001, sku: 'S1', name: 'C', vendor_id: vendorId(44) }] } });
  assertEquals((await call(off.deps, { action: 'order_create', customer_id: CUST, items: [{ product_id: 9001 }] }, { jwt: 'jwt-ops' })).body.reason, 'push_disabled');
});

// ---------------------------------------------------------------- 0078: the settlement and «تسوية دلوقتي» (withdraw_create)

Deno.test('0078 withdrawals: a request that turned approved on Dokan (pending here before, or new and asked from 11 Nov) settles the maker; the history and an already-approved one never', async () => {
  const wd = (id: number, status: string, created: string) => ({ id, user: { id: 44 }, amount: '900.00', status, method: 'bank', created });
  const seed = { dokan_withdrawals: [
    { id: 1, woo_vendor_id: 44, vendor_id: vendorId(44), amount: 900, status: 'pending', method: 'bank', requested_at: '2026-10-28 10:00:00' },
    { id: 2, woo_vendor_id: 44, vendor_id: vendorId(44), amount: 900, status: 'approved', method: 'bank', requested_at: '2026-11-12 10:00:00' }] };
  const routes = { 'GET dokan/v1/withdraw': page([wd(1, 'approved', '2026-10-28 10:00:00'), wd(2, 'approved', '2026-11-12 10:00:00'), wd(3, 'approved', '2026-11-12 11:00:00'), wd(4, 'approved', '2026-09-01 10:00:00'), wd(5, 'pending', '2026-11-12 12:00:00')]),
    'GET dokan/v1/stores/44/stats': { body: { others: { balance: 120 }, revenue: { earning: 5000, sales: 7000, orders: 9 } } } };
  const settles: any[] = [];
  const { db, woo, deps } = setup({ seed, routes, rpc: { acc_settle_withdrawal: (a: any) => { settles.push(a); return { amount: 900, consumed: 0, cash: 900, carry_out: 0, moves: 0 }; } } });
  const { body } = await call(deps, { action: 'withdrawals' }, { jwt: 'jwt-acct' });
  assertEquals(body.counts.settled, 2);
  assertEquals(settles, [{ p_withdraw: 1, p_source: 'dokan', p_by: null }, { p_withdraw: 3, p_source: 'dokan', p_by: null }]);
  // the settled maker's Dokan balance is read again at once (the request lowered it) — the net never counts the request twice
  assertEquals(woo.calls.filter((c: any) => c.method === 'GET' && c.path === 'dokan/v1/stores/44/stats').length, 1);
  const bal = db.rows('dokan_balances').find((r: any) => r.vendor_id === vendorId(44));
  assertEquals([bal.balance, bal.earning, bal.sales, bal.orders], [120, 5000, 7000, 9]);
  assertEquals(woo.calls.filter((c: any) => c.path === 'dokan/v1/stores/2376/stats').length, 0, 'no other maker read');
});

Deno.test('0078 withdrawals: a settlement the database refuses is logged with its code only and the pull goes on', async () => {
  const routes = { 'GET dokan/v1/withdraw': page([{ id: 3, user: { id: 44 }, amount: '900.00', status: 'approved', method: 'bank', created: '2026-11-12 11:00:00' }]) };
  const { db, deps } = setup({ routes, rpc: { acc_settle_withdrawal: () => { throw Object.assign(new Error('nope'), { code: '22023' }); } } });
  const { res, body } = await call(deps, { action: 'withdrawals' }, { jwt: 'jwt-acct' });
  assertEquals([res.status, body.counts.withdrawals, body.counts.settled], [200, 1, 0]);
  const log = db.rows('woo_sync_log').find((r: any) => r.entity === 'acc_vendor_settlements');
  assertEquals([log.entity_id, log.action, log.result, log.detail], ['3', 'settle', 'error', { code: '22023' }]);
});

Deno.test('0078 withdraw_create: the admin or accounts.approve = F only (never the sync secret); a request for the maker\'s whole Dokan balance by bank, pending, mirrored at once', async () => {
  const routes = {
    'GET dokan/v1/stores/44/stats': { body: { others: { balance: 25000 }, revenue: { earning: 30000 } } },
    'POST dokan/v1/withdraw': (c: any) => ({ status: 201, body: { id: 77, user: { id: c.body.user_id }, amount: String(c.body.amount), status: 'pending', method: c.body.method, created: '2026-11-11 15:00:00', note: c.body.note, details: { bank: { ac_number: '123456789012' } } } }),
  };
  const { db, woo, deps } = setup({ routes, env: PUSH_ON });
  assertEquals((await call(deps, { action: 'withdraw_create', vendor_id: vendorId(44) })).res.status, 401, 'the sync secret never asks');
  assertEquals((await call(deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-acct' })).res.status, 401, 'accounts.approve N');
  assertEquals(woo.calls.length, 0);
  const { res, body } = await call(deps, { action: 'withdraw_create', vendor_id: vendorId(44), amount: 1, user_id: 2376 }, { jwt: 'jwt-approver' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'withdraw_create', result: 'ok', id: 77, amount: 25000, status: 'pending' });
  assertEquals(woo.calls.map((c: any) => [c.method, c.path, c.body ?? null]), [['GET', 'dokan/v1/stores/44/stats', null], ['POST', 'dokan/v1/withdraw', { user_id: 44, amount: 25000, method: 'bank', note: 'تسوية من سيستم إبتكر' }]]);
  const row = db.row('dokan_withdrawals', 77);
  assertEquals([row.woo_vendor_id, row.vendor_id, row.amount, row.status, row.method], [44, vendorId(44), 25000, 'pending', 'bank']);
  assertFalse(JSON.stringify(db.rows('dokan_withdrawals')).includes('123456789012'), 'never the bank details');
  // a second ask while it is pending → skipped, no call
  const again = await call(deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-admin' });
  assertEquals([again.body.result, again.body.reason, again.body.id], ['skipped', 'pending_exists', 77]);
  assertEquals(woo.calls.length, 2);
});

Deno.test('0078 withdraw_create: WOO_PUSH_ENABLED off, no balance, no store, a bad id — and Dokan\'s refusal comes back with its code', async () => {
  const off = setup({ routes: { 'GET dokan/v1/stores/44/stats': { body: { others: { balance: 100 } } } } });
  const a = await call(off.deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-admin' });
  assertEquals([a.body.result, a.body.reason], ['skipped', 'push_disabled']);
  assertEquals(off.woo.calls.length, 0);
  const empty = setup({ routes: { 'GET dokan/v1/stores/44/stats': { body: { others: { balance: 0 } } } }, env: PUSH_ON });
  const b = await call(empty.deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-admin' });
  assertEquals([b.body.result, b.body.reason], ['skipped', 'no_balance']);
  assert(empty.woo.calls.every((c: any) => c.method === 'GET'));
  const none = setup({ seed: { vendors: [{ ...vendorRow(44), woo_vendor_id: null }] }, env: PUSH_ON });
  assertEquals((await call(none.deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-admin' })).res.status, 409);
  assertEquals((await call(none.deps, { action: 'withdraw_create', vendor_id: 'x' }, { jwt: 'jwt-admin' })).res.status, 400);
  const refused = setup({ routes: { 'GET dokan/v1/stores/44/stats': { body: { others: { balance: 300 } } }, 'POST dokan/v1/withdraw': { status: 400, body: { code: 'dokan_rest_withdraw_error', message: 'Withdraw amount must be greater than 500' } } }, env: PUSH_ON });
  const c = await call(refused.deps, { action: 'withdraw_create', vendor_id: vendorId(44) }, { jwt: 'jwt-admin' });
  assertEquals([c.res.status, c.body.result, c.body.reason], [409, 'refused', 'dokan_rest_withdraw_error']);
  assertEquals(refused.db.rows('dokan_withdrawals').length, 0);
});

Deno.test('owner batch 14 Nov (decision 9): category_create / category_update take a slug (small letters, digits, «-»); category_update moves a category under another parent — never itself or one under it — and its Arabic translation under that parent\'s', async () => {
  const seed = { woo_categories: [{ id: 15, name: 'Home', slug: 'home', parent_id: 0 }, { id: 80, name: 'Lamps', slug: 'lamps', parent_id: 15 }, { id: 90, name: 'Desk', slug: 'desk', parent_id: 80 }, { id: 20, name: 'Gifts', slug: 'gifts', parent_id: 0 }] };
  const routes = { 'POST wc/v3/products/categories': (c: any) => ({ body: { id: 99, name: c.body.name, slug: c.body.slug ?? 'x', parent: c.body.parent ?? 0 } }),
    'GET wc/v3/products/categories/80': { body: catEn() }, 'GET wc/v3/products/categories/81': arRoute(catAr()),
    'GET wc/v3/products/categories/20': { body: { id: 20, name: 'Gifts', parent: 0, translations: { en: 20, ar: 21 } } },
    'PUT wc/v3/products/categories/80': (c: any) => ({ body: catEn(c.body) }), 'PUT wc/v3/products/categories/81': (c: any) => ({ body: catAr(c.body) }) };
  const { woo, db, deps } = setup({ seed, routes, env: PUSH_ON });
  for (const bad of ['Lamps', 'a b', 'a--b', '-a', 'ل']) assertEquals((await call(deps, { action: 'category_create', name_en: 'X', slug: bad }, { jwt: 'jwt-padd' })).body.field, 'slug', bad);
  assertEquals(woo.calls.length, 0);
  await call(deps, { action: 'category_create', name_en: 'Desk Lamps', slug: 'desk-lamps-2' }, { jwt: 'jwt-padd' });
  assertEquals(woo.calls.at(-1)!.body.slug, 'desk-lamps-2');
  // the parent: itself / a category under it → 400 before any call
  const n0 = woo.calls.length;
  assertEquals((await call(deps, { action: 'category_update', id: 80, parent: 80 }, { jwt: 'jwt-padd' })).body.field, 'parent');
  assertEquals((await call(deps, { action: 'category_update', id: 80, parent: 90 }, { jwt: 'jwt-padd' })).body.field, 'parent');
  assertEquals(woo.calls.length, n0);
  const { body } = await call(deps, { action: 'category_update', id: 80, parent: 20, slug: 'lights' }, { jwt: 'jwt-padd' });
  assertEquals(body.result, 'ok');
  const puts = woo.calls.filter((c) => c.method === 'PUT');
  assertEquals(puts.map((c) => [c.path, c.body]), [['wc/v3/products/categories/80', { slug: 'lights', parent: 20 }], ['wc/v3/products/categories/81', { parent: 21 }]]);
  assertEquals(db.rows('woo_categories').find((c) => c.id === 80)!.parent_id, 20);
  // back to a main category (0): the translation goes to the top too
  const top = setup({ seed, routes, env: PUSH_ON });
  await call(top.deps, { action: 'category_update', id: 80, parent: 0 }, { jwt: 'jwt-padd' });
  assertEquals(top.woo.calls.filter((c) => c.method === 'PUT').map((c) => c.body), [{ parent: 0 }, { parent: 0 }]);
});
