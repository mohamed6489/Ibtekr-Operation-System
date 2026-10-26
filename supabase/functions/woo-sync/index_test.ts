// deno-lint-ignore-file no-explicit-any
// woo-sync handler tests: fake Woo fetch + in-memory Supabase clients (service and per-member) from ../_test/fakes.ts.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import { ENV, NOW, PHONE, STATUS_MAP, WC_AUTH, fakeDb, fakeWoo, vendorId, vendorRow, wooOrder, wooProduct, wooStore, wooSub, writtenText } from '../_test/fakes.ts';

const SYNC_SECRET = 'sync-test-secret';
const OURS = `${ENV.SUPABASE_URL}/functions/v1/woo-webhook`;
// Member tokens → what has_perm('orders.status') / is_admin() answer for them.
// (the last three answer "truthy" values that are not the exact true / 'F' the function requires).
const MEMBERS: Record<string, { perm: unknown; admin: unknown }> = {
  'jwt-admin': { perm: 'F', admin: true }, 'jwt-ops': { perm: 'F', admin: false }, 'jwt-acct': { perm: 'P', admin: false },
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
    const client = fakeDb({}, { rpc: m ? { has_perm: ({ key }: any) => (key === 'orders.status' ? m.perm : 'N'), is_admin: () => m.admin } : {} });
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

// ---------------------------------------------------------------- vendors / products / all

Deno.test('vendors: every Dokan store upserted on woo_vendor_id, aliases / commission_pct untouched, no Authorization on dokan/', async () => {
  const seed = { vendors: [vendorRow(44, { aliases: ['قديم'], commission_pct: 12.5 })] };
  const { db, woo, deps } = setup({ seed, routes: { 'GET dokan/v1/stores': page([wooStore(44, { enabled: false }), wooStore(900)]) } });
  const { body } = await call(deps, { action: 'vendors' }, { jwt: 'jwt-admin' });
  assertEquals([body.result, body.counts.vendors.vendors], ['ok', 2]);
  assertEquals([woo.calls[0].path, woo.calls[0].query], ['dokan/v1/stores', { per_page: '100', page: '1' }]);
  assertFalse('authorization' in woo.calls[0].headers);
  const v44 = db.row('vendors', 44, 'woo_vendor_id');
  assertEquals([v44.id, v44.status, v44.aliases, v44.commission_pct, v44.name], [vendorId(44), 'inactive', ['قديم'], 12.5, 'Store 44']);
  assertEquals(db.row('vendors', 900, 'woo_vendor_id').status, 'active');
  const cols = Object.keys(db.writes('vendors')[0].rows[0]).sort();
  assertEquals(cols, ['email', 'name', 'phone', 'raw', 'status', 'woo_vendor_id']);
  assertEquals(db.rows('woo_sync_log').at(-1).kind, 'manual');
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
  const routes = { [STATES]: country([{ code: 'EG-01', name: 'محافظة 1' }]), 'GET dokan/v1/stores': page([wooStore(44)]), 'GET wc/v3/products': page([wooProduct(501, 44)]),
    'GET wc/v3/orders': page([single(1002, 44, '2026-10-21T09:30:00')]) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals(res.status, 200);
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/data/countries/EG', 'dokan/v1/stores', 'wc/v3/orders', 'wc/v3/products']);
  assertEquals(Object.keys(body.counts), ['states', 'vendors', 'orders', 'products']);
  assertEquals(body.counts.states, { states: 1, skipped: 0, failed: 0 });
  assertEquals(body.counts.products, { products: 1, failed: 0, pages: 1, done: true });
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result]), [['states', 'ok'], ['vendors', 'ok'], ['orders', 'ok'], ['products', 'ok']]);
});

Deno.test('all keeps going when one part fails, answers 502 naming it, and the log holds neither the keys nor a phone', async () => {
  const echo = `{"code":"invalid_username","message":"bad ${ENV.WOO_CK}:${ENV.WOO_CS} for ${PHONE}","data":{"billing_phone":"${PHONE}"}}`;
  const routes = { [STATES]: country([]), 'GET dokan/v1/stores': { status: 401, text: echo }, 'GET wc/v3/products': page([]), 'GET wc/v3/orders': page([]) };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals(res.status, 502);
  assertEquals([body.error, body.failed], ['sync_failed', ['vendors']]);
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/data/countries/EG', 'dokan/v1/stores', 'wc/v3/orders', 'wc/v3/products']);
  const err = db.rows('woo_sync_log').find((r: any) => r.result === 'error')!;
  assertEquals([err.entity, err.kind], ['vendors', 'cron']);
  for (const s of [PHONE, ENV.WOO_CK, ENV.WOO_CS]) assertFalse(writtenText(db).includes(s), `leaked ${s}`);
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
    'GET dokan/v1/stores': page([wooStore(44)]), 'GET wc/v3/products': page([wooProduct(501, 44)]), 'GET wc/v3/orders': page([single(1002, 44, '2026-10-21T09:30:00')]),
  };
  const { db, woo, deps } = setup({ routes });
  const { res, body } = await call(deps, { action: 'all' });
  assertEquals([res.status, body.error, body.failed], [502, 'sync_failed', ['states']]);
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/data/countries/EG', 'dokan/v1/stores', 'wc/v3/orders', 'wc/v3/products']);
  assertEquals(Object.keys(body.counts), ['vendors', 'orders', 'products']);
  assertEquals([db.rows('orders').map((o: any) => o.id), db.rows('products').map((p: any) => p.id), db.rows('woo_states').length], [[1002], [501], 0]);
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.entity, r.result]), [['states', 'error'], ['vendors', 'ok'], ['orders', 'ok'], ['products', 'ok']]);
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
