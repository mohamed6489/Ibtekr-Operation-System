// deno-lint-ignore-file no-explicit-any
// woo-sync handler tests: fake Woo fetch + in-memory Supabase clients (service and per-member) from ../_test/fakes.ts.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { cairoDate } from '../_shared/woo-write.js';
import { bankDigest } from '../_shared/woo-core.js';
import { ENV, NOW, PHONE, STATUS_MAP, WC_AUTH, fakeDb, fakeWoo, vendorId, vendorRow, wooOrder, wooProduct, wooStore, wooStoreFull, wooSub, writtenText } from '../_test/fakes.ts';

const SYNC_SECRET = 'sync-test-secret';
const OURS = `${ENV.SUPABASE_URL}/functions/v1/woo-webhook`;
// Member tokens → what has_perm('orders.status') / is_admin() answer for them, plus (phase 3.3) has_perm('vendors.edit') /
// has_perm('sensitive.commission') for push_vendor: ops = vendors.edit P, vf = vendors follow-up (vendors.edit F, commission N),
// acct = accounts (nothing). (the last three answer "truthy" values that are not the exact true / 'F' the function requires).
const MEMBERS: Record<string, { perm: unknown; admin: unknown; edit?: unknown; commission?: unknown; bank?: unknown; accounts?: unknown; approve?: unknown; pview?: unknown; pedit?: unknown; pbulk?: unknown; ptrash?: unknown }> = {
  'jwt-admin': { perm: 'F', admin: true }, 'jwt-ops': { perm: 'F', admin: false, edit: 'P' }, 'jwt-acct': { perm: 'P', admin: false, edit: 'N', accounts: 'P' },
  'jwt-vf': { perm: 'N', admin: false, edit: 'F', commission: 'N' },
  'jwt-bank': { perm: 'N', admin: false, edit: 'N', bank: 'F' }, // phase 3.5: accounts — sensitive.vendor_bank = F, vendors.edit = N
  'jwt-approver': { perm: 'N', admin: false, accounts: 'F', approve: 'F' }, // phase 4.1: accounts.approve = F
  // phase 5: products.view P (reads a product live), products.edit F, products.trash F
  'jwt-pview': { perm: 'N', admin: false, pview: 'P' }, 'jwt-pedit': { perm: 'N', admin: false, pview: 'F', pedit: 'F', pbulk: 'F' }, 'jwt-pone': { perm: 'N', admin: false, pview: 'F', pedit: 'F' },
  'jwt-ptrash': { perm: 'N', admin: false, pview: 'F', ptrash: 'F' },
  'jwt-admin-text': { perm: 'f', admin: 'true' }, 'jwt-admin-one': { perm: 'F ', admin: 1 },
};

type Opts = { seed?: Record<string, any[]>; routes?: Record<string, any>; env?: Record<string, string>; secretAnswer?: (ok: boolean) => unknown; fail?: (c: any) => any };
function setup({ seed = {}, routes = {}, env = {}, secretAnswer = (ok) => ok, fail }: Opts = {}) {
  const db = fakeDb({ status_map: STATUS_MAP, vendors: [vendorRow(44), vendorRow(2376)], ...seed }, {
    rpc: { sync_secret_matches: ({ candidate }: any) => secretAnswer(candidate === SYNC_SECRET) }, fail,
  });
  const woo = fakeWoo(routes);
  const members: any[] = [];
  const userDb = (jwt: string) => {
    const m = MEMBERS[jwt];
    const client = fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'orders.status' ? m.perm : key === 'vendors.edit' ? m.edit ?? 'N' : key === 'sensitive.commission' ? m.commission ?? 'N' : key === 'sensitive.vendor_bank' ? m.bank ?? 'N' : key === 'accounts.view' ? m.accounts ?? 'N' : key === 'accounts.approve' ? m.approve ?? 'N' : key === 'products.view' ? m.pview ?? 'N' : key === 'products.edit' ? m.pedit ?? 'N' : key === 'products.bulk' ? m.pbulk ?? 'N' : key === 'products.trash' ? m.ptrash ?? 'N' : 'N'), is_admin: () => m.admin } : {} });
    members.push({ jwt, client });
    return client;
  };
  return { db, woo, members, deps: { env: { ...ENV, ...env }, fetch: woo.fetch, db, now: () => NOW, userDb } };
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
  assertEquals(body.counts, { withdrawals: 3, skipped: 1, pages: 1, done: true, balances: 1, missing: 1, failed: 0, failed_rows: 0, offset: 0, next: 0 });
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
  assertEquals(body.rows.map((r: any) => [r.date, r.type, r.debit, r.credit, r.balance]), [['2026-10-01', 'opening_balance', 0, 0, 300], ['2026-10-05 10:00:00', 'dokan_orders', 500, 0, 800]]);
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
  const { db, woo, deps } = setup({ seed: wdSeed('pending'), routes, env: PUSH_ON });
  const { res, body } = await call(deps, { action: 'withdraw_approve', id: 7, amount: 1, status: 'cancelled' }, { jwt: 'jwt-approver' });
  assertEquals(res.status, 200);
  assertEquals(body, { action: 'withdraw_approve', result: 'ok', status: 'approved' });
  assertEquals(woo.calls.map((c: any) => [c.method, c.path, c.body ?? null]), [['GET', 'dokan/v1/withdraw/7', null], ['PUT', 'dokan/v1/withdraw/7', { status: 'approved' }], ['GET', 'dokan/v1/stores/44/stats', null]]);
  assertEquals(db.row('dokan_withdrawals', 7).status, 'approved');
  assertEquals(db.row('dokan_balances', vendorId(44), 'vendor_id').balance, 1000);
  const log = db.rows('woo_sync_log').at(-1);
  assertEquals([log.kind, log.direction, log.entity, log.entity_id, log.action, log.result, log.detail], ['push', 'out', 'dokan_withdrawals', '7', 'withdraw_approve', 'ok', { status: 'approved', amount: 1500 }]);
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
  assertEquals(body.counts, { withdrawals: 2, skipped: 0, failed_rows: 0, pages: 1, done: true });
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
  assertEquals([body.result, body.counts.vendors], ['ok', { vendors: 2, from_site: 1, conflicts: 0, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0, pages: 1, done: true }]);
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
  assertEquals(body.ar, { id: 601, name: 'لمبة', short_description: 'وصف', description: '' });
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
  assertEquals(body.counts.vendors, { vendors: 1, from_site: 1, conflicts: 1, pushed: 0, push_failed: 0, push_refused: 0, push_held: 0, pages: 1, done: true });
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

