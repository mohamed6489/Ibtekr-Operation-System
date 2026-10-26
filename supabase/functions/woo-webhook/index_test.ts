// deno-lint-ignore-file no-explicit-any
// woo-webhook handler tests: fake Woo fetch + in-memory Supabase client (../_test/fakes.ts); every case asserts the
// recorded writes / calls, not only the status code.
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { handler } from './index.ts';
import {
  ENV, NOW, PHONE, STATUS_MAP, WC_AUTH, fakeDb, fakeWoo, sign, vendorId, vendorRow, wooOrder, wooProduct, wooStore, wooSub, writtenText,
} from '../_test/fakes.ts';

type Opts = { seed?: Record<string, any[]>; routes?: Record<string, any>; env?: Record<string, string>; fail?: (c: any) => any };

function setup({ seed = {}, routes = {}, env = {}, fail }: Opts = {}) {
  const db = fakeDb({ status_map: STATUS_MAP, vendors: [vendorRow(44), vendorRow(2376)], ...seed }, { fail });
  const woo = fakeWoo(routes);
  return { db, woo, deps: { env: { ...ENV, ...env }, fetch: woo.fetch, db, now: () => NOW } };
}

type Delivery = { topic?: string | null; id?: string | null; signature?: string | null; secret?: string; contentType?: string };
async function deliver(deps: any, payload: unknown, o: Delivery = {}) {
  const body = (payload instanceof Uint8Array || typeof payload === 'string' ? payload : JSON.stringify(payload)) as string | Uint8Array<ArrayBuffer>;
  const headers: Record<string, string> = { 'content-type': o.contentType ?? 'application/json', 'x-wc-webhook-id': '901' };
  const topic = o.topic === undefined ? 'order.updated' : o.topic;
  if (topic) headers['x-wc-webhook-topic'] = topic;
  const id = o.id === undefined ? 'd-1' : o.id;
  if (id) headers['x-wc-webhook-delivery-id'] = id;
  const signature = o.signature === undefined ? await sign(body, o.secret ?? ENV.WOO_WEBHOOK_SECRET) : o.signature;
  if (signature) headers['x-wc-webhook-signature'] = signature;
  const res = await handler(new Request('https://fn.test/woo-webhook', { method: 'POST', headers, body }), deps);
  return { res, body: await res.json() };
}

// The woo_webhook_events.delivery_id a delivery is deduplicated on: `<delivery id>:<signature>`.
const keyOf = async (payload: unknown, id = 'd-1') => `${id}:${await sign(JSON.stringify(payload), ENV.WOO_WEBHOOK_SECRET)}`;
const subsRoute = (subs: any[]) => ({ 'GET wc/v3/orders': (c: any) => (c.query.parent ? { body: subs } : undefined) });
const ops = (db: any) => db.writes().filter((w: any) => !w.error).map((w: any) => `${w.op} ${w.table}`);

// ---------------------------------------------------------------- authentication

Deno.test('a bad signature → 401, one woo_sync_log error row, nothing else read from Woo or written', async () => {
  const { db, woo, deps } = setup();
  const { res, body } = await deliver(deps, wooOrder(), { signature: 'bm90LXRoZS1zaWduYXR1cmU=' });
  assertEquals(res.status, 401);
  assertEquals(body, { error: 'bad_signature' });
  assertEquals(ops(db), ['insert woo_sync_log']);
  const [log] = db.rows('woo_sync_log');
  assertEquals([log.kind, log.direction, log.result, log.detail], ['webhook', 'in', 'error', { error: 'bad_signature' }]);
  assertEquals(woo.calls.length, 0);
});

Deno.test('a missing signature or one made with another secret → 401', async () => {
  for (const o of [{ signature: null }, { secret: 'another-secret' }]) {
    const { db, deps } = setup();
    const { res } = await deliver(deps, wooOrder(), o);
    assertEquals(res.status, 401);
    assertEquals(db.rows('orders').length, 0);
    assertEquals(db.rows('woo_webhook_events').length, 0);
  }
});

Deno.test('WOO_WEBHOOK_SECRET not set → 500, nothing processed (never "allow"), even for a body "signed" with an empty secret', async () => {
  const { db, woo, deps } = setup({ env: { WOO_WEBHOOK_SECRET: '' } });
  const { res, body } = await deliver(deps, wooOrder(), { secret: 'x' });
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'not_configured' });
  assertEquals(ops(db), ['insert woo_sync_log']);
  assertEquals(db.rows('woo_webhook_events').length + db.rows('orders').length, 0);
  assertEquals(woo.calls.length, 0);
});

Deno.test('a WooCommerce ping (no topic header, body webhook_id=N) → 200 ignored with no read or write', async () => {
  for (const payload of ['webhook_id=901', '{"webhook_id":901}']) {
    const { db, woo, deps } = setup();
    const { res, body } = await deliver(deps, payload, { topic: null, signature: null, id: null, contentType: 'application/x-www-form-urlencoded' });
    assertEquals(res.status, 200);
    assertEquals(body, { status: 'ignored' });
    assertEquals(db.calls.length, 0);
    assertEquals(woo.calls.length, 0);
  }
});

Deno.test('a ping-shaped body WITH a topic header still needs the signature (401 unsigned)', async () => {
  const { db, deps } = setup();
  const { res } = await deliver(deps, 'webhook_id=901', { topic: 'order.updated', signature: null });
  assertEquals(res.status, 401);
  assertEquals(ops(db), ['insert woo_sync_log']);
});

Deno.test('GET → 405', async () => {
  const { deps } = setup();
  const res = await handler(new Request('https://fn.test/woo-webhook'), deps as any);
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

// ---------------------------------------------------------------- idempotency

Deno.test('a duplicate delivery (same delivery id, same signed body) → 200 duplicate and no further writes or Woo calls', async () => {
  const { db, woo, deps } = setup({ seed: { woo_webhook_events: [{ id: 1, delivery_id: await keyOf(wooOrder()), topic: 'order.updated', status: 'ok' }] } });
  const { res, body } = await deliver(deps, wooOrder());
  assertEquals(res.status, 200);
  assertEquals(body, { status: 'duplicate' });
  assertEquals(ops(db), []);
  assertEquals(db.writes().map((w: any) => [w.op, w.table, w.error?.code]), [['insert', 'woo_webhook_events', '23505']]);
  assertEquals(db.rows('orders').length, 0);
  assertEquals(db.row('woo_webhook_events', 1).status, 'ok');
  assertEquals(woo.calls.length, 0);
});

Deno.test('a redelivery of a delivery that failed is processed again on the same event row', async () => {
  const { db, deps } = setup({ seed: { woo_webhook_events: [{ id: 1, delivery_id: await keyOf(wooOrder()), topic: 'order.updated', status: 'error', error: 'boom' }] }, routes: subsRoute([]) });
  const { body } = await deliver(deps, wooOrder());
  assertEquals(body, { status: 'ok', id: 1001 });
  assertEquals(db.rows('woo_webhook_events').length, 1);
  assertEquals([db.row('woo_webhook_events', 1).status, db.row('woo_webhook_events', 1).error], ['ok', null]);
  assertEquals(db.rows('orders').length, 1);
});

Deno.test('two deliveries sharing a delivery id (one webhook, same second) with different bodies → both processed; the same body again → duplicate', async () => {
  const { db, deps } = setup({ routes: subsRoute([]) });
  const later = wooOrder({ status: 'completed', date_modified_gmt: '2026-10-20T11:00:01' });
  assertEquals((await deliver(deps, wooOrder())).body, { status: 'ok', id: 1001 });
  assertEquals((await deliver(deps, later)).body, { status: 'ok', id: 1001 });
  assertEquals(db.row('orders', 1001).status, 'مكتمل');
  assertEquals((await deliver(deps, later)).body, { status: 'duplicate' });
  assertEquals(db.rows('woo_webhook_events').map((e: any) => [e.delivery_id, e.status]), [[await keyOf(wooOrder()), 'ok'], [await keyOf(later), 'ok']]);
});

Deno.test('after a duplicate key, an earlier event row that cannot be read back (read error, or no row) → 500 and an error row, not "duplicate"', async () => {
  const readFails = (c: any) => (c.table === 'woo_webhook_events' && c.op === 'select' ? { code: 'XX000', message: 'read failed' } : null);
  const insertCollides = (c: any) => (c.table === 'woo_webhook_events' && c.op === 'insert' ? { code: '23505', message: 'duplicate key value' } : null);
  const seeded = { woo_webhook_events: [{ id: 1, delivery_id: await keyOf(wooOrder()), topic: 'order.updated', status: 'ok' }] };
  for (const [seed, fail] of [[seeded, readFails], [{}, insertCollides]] as const) {
    const { db, woo, deps } = setup({ seed, fail });
    const { res, body } = await deliver(deps, wooOrder());
    assertEquals([res.status, body], [500, { error: 'processing_failed' }]);
    assertEquals(db.rows('woo_sync_log').map((r: any) => [r.kind, r.result]), [['webhook', 'error']]);
    assertEquals(db.rows('orders').length + woo.calls.length, 0);
  }
});

Deno.test('the signature covers the raw body bytes (a body that is not valid UTF-8 still verifies)', async () => {
  const enc = new TextEncoder();
  const bytes = new Uint8Array([...enc.encode('{"id":501,"name":"منتج","status":"publish","description":"'), 0xff, ...enc.encode('"}')]);
  const { db, deps } = setup();
  const { res, body } = await deliver(deps, bytes, { topic: 'product.updated' });
  assertEquals([res.status, body], [200, { status: 'ok', id: 501 }]);
  assertEquals(db.row('products', 501).name, 'منتج');
});

Deno.test('a delivery without a delivery id is processed and stored with delivery_id null', async () => {
  const { db, deps } = setup({ routes: subsRoute([]) });
  const { body } = await deliver(deps, wooOrder(), { id: null });
  assertEquals(body.status, 'ok');
  assertEquals(db.rows('woo_webhook_events')[0].delivery_id, null);
});

// ---------------------------------------------------------------- orders

Deno.test('a parent order → orders + lines upserted, ?parent= fetched, sub_orders upserted and lines linked by maker', async () => {
  const { db, woo, deps } = setup({ routes: subsRoute([wooSub(2001, 1001, 44), wooSub(2002, 1001, 2376)]) });
  const { res, body } = await deliver(deps, wooOrder());
  assertEquals(res.status, 200);
  assertEquals(body, { status: 'ok', id: 1001 });

  const o = db.row('orders', 1001);
  assertEquals([o.number, o.customer_name, o.customer_phone, o.status, o.woo_status, o.total, o.placed_at, o.woo_updated_at, o.synced_at],
    ['1001', 'سلوى زيتوني', PHONE, 'جاري التنفيذ', 'processing', 450, '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z', NOW]);
  assertFalse(JSON.stringify(o.raw).includes(PHONE), 'raw carries no phone');

  const subs = db.rows('sub_orders');
  assertEquals(subs.map((s: any) => [s.woo_order_id, s.order_id, s.vendor_id, s.woo_status]), [[2001, 1001, vendorId(44), 'processing'], [2002, 1001, vendorId(2376), 'processing']]);
  const items = db.rows('order_items');
  assertEquals(items.map((i: any) => [i.id, i.order_id, i.vendor_id, i.removed, i.status]), [[1, 1001, vendorId(44), false, ''], [2, 1001, vendorId(2376), false, '']]);
  assertEquals(items.map((i: any) => i.sub_order_id), subs.map((s: any) => s.id), 'each line points at its maker’s sub-order');

  assertEquals(woo.calls.map((c) => [c.method, c.path, c.query]), [['GET', 'wc/v3/orders', { parent: '1001', per_page: '100' }]]);
  assertEquals(woo.calls[0].headers.authorization, WC_AUTH);
  assert(woo.calls[0].timed, 'Woo requests carry a timeout signal');
  assertEquals(woo.calls[0].redirect, 'error', 'the Basic header never follows a redirect');

  const ev = db.rows('woo_webhook_events')[0];
  assertEquals([ev.delivery_id, ev.webhook_id, ev.topic, ev.resource_id, ev.status, ev.error], [await keyOf(wooOrder()), '901', 'order.updated', 1001, 'ok', null]);
  assertEquals(Object.keys(ev.payload).sort(), ['date_modified_gmt', 'id', 'number', 'parent_id', 'status', 'topic']);
  assertFalse(writtenText(db).includes(PHONE));
});

Deno.test('the sync writes only its own columns: an existing order and its lines keep the team’s values', async () => {
  const seed = {
    orders: [{ id: 1001, number: '1001', customer_name: 'old', status: 'جاهز للشحن', woo_status: 'ready-shipping', placed_at: '2026-10-20T10:00:00Z',
      woo_updated_at: '2026-10-20T10:30:00Z', confirm: 'مؤكد بعربون', confirm_at: '2026-10-21', confirm_note: 'كلمتها', deposit: 50, note: 'اتصل بعد 5', cancel: null, ret: null }],
    order_items: [{ id: 1, order_id: 1001, name: 'old', status: 'مؤكد', expected_at: '2026-10-28', comment: 'تمام', ready_at: '2026-10-22T09:00:00Z',
      waybill: { no: 'W1' }, pulled: true, ret: null, store: { at: 'x' }, sub_order_id: null }],
  };
  const { db, deps } = setup({ seed, routes: subsRoute([]) });
  await deliver(deps, wooOrder({ status: 'ready-shipping' }));
  const o = db.row('orders', 1001);
  assertEquals([o.confirm, o.confirm_at, o.confirm_note, o.deposit, o.note, o.status, o.customer_name], ['مؤكد بعربون', '2026-10-21', 'كلمتها', 50, 'اتصل بعد 5', 'جاهز للشحن', 'سلوى زيتوني']);
  const i = db.row('order_items', 1);
  assertEquals([i.status, i.expected_at, i.comment, i.ready_at, i.waybill, i.pulled, i.store, i.name], ['مؤكد', '2026-10-28', 'تمام', '2026-10-22T09:00:00Z', { no: 'W1' }, true, { at: 'x' }, 'كوباية']);

  const cols = (t: string) => Object.keys(db.writes(t).find((w: any) => w.op === 'upsert').rows[0]).sort();
  assertEquals(cols('orders'), ['currency', 'customer_name', 'customer_note', 'customer_phone', 'id', 'number',
    'payment_method', 'payment_title', 'placed_at', 'raw', 'status', 'synced_at', 'total', 'woo_status', 'woo_updated_at'], 'an existing order: no city / address');
  assertEquals(cols('order_items'), ['id', 'name', 'order_id', 'product_id', 'qty', 'raw', 'removed', 'sku', 'total', 'vendor_id']);
});

Deno.test('customer_city / customer_address: written when the order is new, never on an existing order (the team edits them)', async () => {
  const fresh = setup({ routes: subsRoute([]) });
  await deliver(fresh.deps, wooOrder());
  const o = fresh.db.row('orders', 1001);
  assertEquals([o.customer_city, o.customer_address], ['القاهرة', 'شارع 9']);
  assertEquals(fresh.db.writes('orders').map((w: any) => ['customer_city', 'customer_address'].every((c) => c in w.rows[0])), [true]);

  const seed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', woo_status: 'processing', placed_at: '2026-10-20T10:00:00Z',
    woo_updated_at: '2026-10-20T10:30:00Z', customer_city: 'الجيزة', customer_address: 'عنوان صحّحه الفريق' }] };
  const { db, deps } = setup({ seed, routes: subsRoute([]) });
  await deliver(deps, wooOrder({ shipping: { first_name: 'سلوى', last_name: 'زيتوني', city: 'طنطا', address_1: 'عنوان جديد في Woo' } }));
  const kept = db.row('orders', 1001);
  assertEquals([kept.customer_city, kept.customer_address, kept.customer_name], ['الجيزة', 'عنوان صحّحه الفريق', 'سلوى زيتوني']);
  assertFalse(db.writes('orders').some((w: any) => w.rows.some((r: any) => 'customer_city' in r || 'customer_address' in r)));
});

Deno.test('note (the team’s comment) = the website note on a new order only; an existing order keeps its comment while customer_note follows Woo', async () => {
  const fresh = setup({ routes: subsRoute([]) });
  await deliver(fresh.deps, wooOrder({ customer_note: '  رن قبل ما تيجي ' }));
  const o = fresh.db.row('orders', 1001);
  assertEquals([o.note, o.customer_note], ['رن قبل ما تيجي', 'رن قبل ما تيجي']);
  const none = setup({ routes: subsRoute([]) });
  await deliver(none.deps, wooOrder());
  assertEquals([none.db.row('orders', 1001).note, none.db.row('orders', 1001).customer_note], [null, null], 'no website note → no comment');

  const seed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', woo_status: 'processing', placed_at: '2026-10-20T10:00:00Z',
    woo_updated_at: '2026-10-20T10:30:00Z', note: 'تعليق خدمة العملاء', customer_note: 'رن قبل ما تيجي' }] };
  const { db, deps } = setup({ seed, routes: subsRoute([]) });
  await deliver(deps, wooOrder({ customer_note: 'ملاحظة اتعدّلت على الموقع' }));
  const kept = db.row('orders', 1001);
  assertEquals([kept.note, kept.customer_note], ['تعليق خدمة العملاء', 'ملاحظة اتعدّلت على الموقع']);
  assertFalse(db.writes('orders').some((w: any) => w.rows.some((r: any) => 'note' in r)));
});

Deno.test('a failed Woo order arrives as «فشل» (its status_map row since 0009), not «ملغي»', async () => {
  const { db, deps } = setup({ routes: subsRoute([]) });
  const { body } = await deliver(deps, wooOrder({ status: 'failed' }));
  assertEquals(body.status, 'ok');
  assertEquals([db.row('orders', 1001).status, db.row('orders', 1001).woo_status], ['فشل', 'failed']);
  assertEquals(db.rows('woo_sync_log').length, 0, 'no conflict row');
});

Deno.test('Woo’s status unchanged (incoming slug = stored woo_status) → the team’s status stays; a real Woo change still applies', async () => {
  const seed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاهز للشحن', woo_status: 'processing', placed_at: '2026-10-20T10:00:00Z',
    woo_updated_at: '2026-10-20T10:30:00Z' }] };
  const { db, deps } = setup({ seed, routes: subsRoute([]) });
  const first = await deliver(deps, wooOrder({ status: 'processing', customer_note: 'ملاحظة جديدة' }), { id: 'd-1' });
  assertEquals(first.body.status, 'ok');
  assertEquals([db.row('orders', 1001).status, db.row('orders', 1001).woo_status], ['جاهز للشحن', 'processing']);
  assertEquals(db.rows('woo_sync_log').length, 0, 'unchanged is not a conflict');

  await deliver(deps, wooOrder({ status: 'completed', date_modified_gmt: '2026-10-21T08:00:00' }), { id: 'd-2' });
  assertEquals([db.row('orders', 1001).status, db.row('orders', 1001).woo_status], ['مكتمل', 'completed']);
});

Deno.test('a line that disappeared from WooCommerce is flagged removed (never deleted); a line that came back is unflagged', async () => {
  const seed = {
    orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', placed_at: '2026-10-20T10:00:00Z' }],
    order_items: [{ id: 9, order_id: 1001, name: 'gone', status: 'مؤكد' }, { id: 2, order_id: 1001, name: 'back', removed: true }],
  };
  const { db, deps } = setup({ seed, routes: subsRoute([]) });
  await deliver(deps, wooOrder());
  assertEquals(db.rows('order_items').map((i: any) => [i.id, i.removed, i.status]).sort(), [[1, false, ''], [2, false, ''], [9, true, 'مؤكد']]);
  assertFalse(db.calls.some((c: any) => c.op === 'delete'));
});

Deno.test('an unknown maker → dokan/v1/stores/{id} fetched WITHOUT an Authorization header and upserted before the lines', async () => {
  const order = wooOrder({ line_items: [{ id: 1, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [{ key: '_dokan_vendor_id', value: '777' }] }] });
  const { db, woo, deps } = setup({ routes: { 'GET dokan/v1/stores/777': { body: wooStore(777) }, ...subsRoute([]) } });
  const { body } = await deliver(deps, order);
  assertEquals(body.status, 'ok');

  const dokan = woo.calls.find((c) => c.path === 'dokan/v1/stores/777')!;
  assertEquals(dokan.method, 'GET');
  assertFalse('authorization' in dokan.headers, 'dokan/ requests carry no WC key header');
  assertEquals(woo.calls.find((c) => c.path === 'wc/v3/orders')!.headers.authorization, WC_AUTH);

  const v = db.row('vendors', 777, 'woo_vendor_id');
  assertEquals([v.name, v.status, v.email, v.aliases], ['Store 777', 'active', null, []]);
  assertEquals(db.row('order_items', 1).vendor_id, v.id);
  const order_ = ops(db);
  assert(order_.indexOf('upsert vendors') < order_.indexOf('upsert order_items'), order_.join(' → '));
  const vendorCols = Object.keys(db.writes('vendors')[0].rows[0]);
  assertFalse(vendorCols.includes('aliases') || vendorCols.includes('commission_pct'), vendorCols.join(','));
});

Deno.test('a store Dokan does not know (404) → a skipped log row and the line keeps vendor_id null', async () => {
  const order = wooOrder({ line_items: [{ id: 1, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [{ key: '_dokan_vendor_id', value: '777' }] }] });
  const { db, deps } = setup({ routes: { 'GET dokan/v1/stores/777': { status: 404, body: { code: 'no_store_found' } }, ...subsRoute([]) } });
  const { body } = await deliver(deps, order);
  assertEquals(body.status, 'ok');
  assertEquals(db.row('order_items', 1).vendor_id, null);
  const log = db.rows('woo_sync_log').find((r: any) => r.entity === 'vendor')!;
  assertEquals([log.kind, log.entity_id, log.result], ['webhook', '777', 'skipped']);
  assertEquals(db.rows('vendors').length, 2);
});

Deno.test('a Dokan store error other than 404 (500) → order, line and sub-order written with vendor_id null, the store asked once, one error row, 200', async () => {
  const order = wooOrder({ line_items: [{ id: 1, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [{ key: '_dokan_vendor_id', value: '777' }] }] });
  const { db, woo, deps } = setup({ routes: { 'GET dokan/v1/stores/777': { status: 500, text: `<b>fatal</b> for ${PHONE}` }, ...subsRoute([wooSub(2001, 1001, 777)]) } });
  const { res, body } = await deliver(deps, order);
  assertEquals([res.status, body], [200, { status: 'ok', id: 1001 }]);
  assertEquals(woo.calls.filter((c) => c.path === 'dokan/v1/stores/777').length, 1, 'lines and sub-order share one attempt per delivery');
  assertEquals(db.rows('orders').length, 1);
  assertEquals(db.row('order_items', 1).vendor_id, null);
  assertEquals(db.row('sub_orders', 2001, 'woo_order_id').vendor_id, null);
  const rows = db.rows('woo_sync_log').filter((r: any) => r.entity === 'vendor');
  assertEquals(rows.map((r: any) => [r.kind, r.entity_id, r.action, r.result]), [['webhook', '777', 'fetch', 'error']]);
  assertStringIncludes(rows[0].detail.error, 'HTTP 500');
  assertFalse(writtenText(db).includes(PHONE));
  assertEquals(db.rows('woo_webhook_events')[0].status, 'ok');
});

Deno.test('a non-integer _dokan_vendor_id ("../../x") → no Woo fetch for it, the line keeps vendor_id null', async () => {
  const order = wooOrder({ line_items: [{ id: 1, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [{ key: '_dokan_vendor_id', value: '../../x' }] }] });
  const { db, woo, deps } = setup({ routes: subsRoute([]) });
  assertEquals((await deliver(deps, order)).body.status, 'ok');
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/orders']);
  assertEquals(db.row('order_items', 1).vendor_id, null);
});

Deno.test('a sub-order whose parent is unknown to WooCommerce (404) → a skipped row, nothing written', async () => {
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders/1001': { status: 404, body: { code: 'woocommerce_rest_shop_order_invalid_id' } } } });
  const { body } = await deliver(deps, wooSub(2001, 1001, 44));
  assertEquals(body, { status: 'ignored', id: 2001 });
  assertEquals(db.rows('sub_orders').length + db.rows('orders').length, 0);
  const log = db.rows('woo_sync_log')[0];
  assertEquals([log.entity, log.entity_id, log.result, log.detail], ['sub_order', '2001', 'skipped', { reason: 'parent_missing', parent_id: 1001 }]);
});

Deno.test('with WOO_WP_USER + WOO_WP_APP_PASSWORD, dokan/ calls carry their Basic header (never the WC keys)', async () => {
  const order = wooOrder({ line_items: [{ id: 1, name: 'x', quantity: 1, total: '1', meta_data: [{ key: '_dokan_vendor_id', value: '777' }] }] });
  const { woo, deps } = setup({ env: { WOO_WP_USER: 'wp-admin', WOO_WP_APP_PASSWORD: 'app pass test' }, routes: { 'GET dokan/v1/stores/777': { body: wooStore(777) }, ...subsRoute([]) } });
  await deliver(deps, order);
  assertEquals(woo.calls.find((c) => c.path.startsWith('dokan/'))!.headers.authorization, 'Basic ' + btoa('wp-admin:app pass test'));
  assertEquals(woo.calls.find((c) => c.path.startsWith('wc/'))!.headers.authorization, WC_AUTH);
});

Deno.test('a sub-order delivery → sub_orders only (event ignored): no orders / order_items upsert, no Woo call', async () => {
  const seed = {
    orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', placed_at: '2026-10-20T10:00:00Z' }],
    order_items: [{ id: 1, order_id: 1001, name: 'a', vendor_id: vendorId(44), status: 'مؤكد' }, { id: 2, order_id: 1001, name: 'b', vendor_id: vendorId(2376) }],
  };
  const { db, woo, deps } = setup({ seed });
  const { body } = await deliver(deps, wooSub(2001, 1001, 44, { status: 'completed' }));
  assertEquals(body, { status: 'ignored', id: 2001 });
  assertEquals(ops(db).filter((o: string) => !o.endsWith('woo_webhook_events')), ['upsert sub_orders', 'update order_items', 'update order_items'], 'by product, then by maker');
  const sub = db.row('sub_orders', 2001, 'woo_order_id');
  assertEquals([sub.order_id, sub.vendor_id, sub.woo_status], [1001, vendorId(44), 'completed']);
  assertEquals(db.rows('order_items').map((i: any) => [i.id, i.sub_order_id, i.status]), [[1, sub.id, 'مؤكد'], [2, null, '']]);
  assertEquals(db.row('orders', 1001).status, 'جاري التنفيذ');
  assertEquals(woo.calls.length, 0);
  assertEquals(db.rows('woo_webhook_events')[0].status, 'ignored');
});

Deno.test('a multi-vendor parent whose lines carry no _dokan_vendor_id → every line gets its sub-order and maker from the sub-orders’ product ids', async () => {
  const parent = wooOrder({ meta_data: [], line_items: [
    { id: 1, product_id: 501, name: 'كوباية', quantity: 2, total: '200.00', meta_data: [] },
    { id: 2, product_id: 502, name: 'شنطة', quantity: 1, total: '250.00', meta_data: [] },
    { id: 3, product_id: 503, variation_id: 7003, name: 'شمعة', quantity: 1, total: '80.00', meta_data: [] },
  ] });
  const subs = [
    wooSub(2001, 1001, 44, { line_items: [{ id: 20010, product_id: 501, quantity: 2, meta_data: [] }] }),
    wooSub(2002, 1001, 2376, { line_items: [{ id: 20020, product_id: 502, quantity: 1, meta_data: [] }, { id: 20021, product_id: 503, variation_id: 7003, quantity: 1, meta_data: [] }] }),
  ];
  let lists = 0; // the ?parent= list answers the first delivery only, so the second one cannot relink anything
  const routes = { 'GET wc/v3/orders': (c: any) => (c.query.parent ? (lists++ === 0 ? { body: subs } : { status: 500, text: 'down' }) : undefined) };
  const { db, deps } = setup({ routes });
  assertEquals((await deliver(deps, parent)).body.status, 'ok');
  const sub = (id: number) => db.row('sub_orders', id, 'woo_order_id').id;
  const lines = () => db.rows('order_items').map((i: any) => [i.id, i.vendor_id, i.sub_order_id]);
  const linked = [[1, vendorId(44), sub(2001)], [2, vendorId(2376), sub(2002)], [3, vendorId(2376), sub(2002)]];
  assertEquals(lines(), linked);
  assertEquals(db.rows('sub_orders').map((s: any) => s.vendor_id), [vendorId(44), vendorId(2376)]);

  // The parent delivered again (still no line meta, e.g. a status change): the lines keep the makers their sub-orders gave them.
  assertEquals((await deliver(deps, wooOrder({ ...parent, status: 'on-hold', date_modified_gmt: '2026-10-21T08:00:00' }), { id: 'd-2' })).body.status, 'ok');
  assertEquals(lists, 2);
  assertEquals(lines(), linked);
  assertFalse(db.writes('order_items').some((w: any) => w.op === 'upsert' && w.rows.some((r: any) => 'vendor_id' in r)), 'an unknown maker is never written as null');
});

Deno.test('a line of another maker is never re-linked by product id (only lines with no maker yet are)', async () => {
  const parent = wooOrder({ line_items: [{ id: 1, product_id: 501, name: 'كوباية', quantity: 1, total: '100', meta_data: [{ key: '_dokan_vendor_id', value: '2376' }] }] });
  const { db, deps } = setup({ routes: subsRoute([wooSub(2001, 1001, 44, { line_items: [{ id: 20010, product_id: 501, quantity: 1, meta_data: [] }] })]) });
  await deliver(deps, parent);
  assertEquals([db.row('order_items', 1).vendor_id, db.row('order_items', 1).sub_order_id], [vendorId(2376), null]);
});

Deno.test('a sub-order whose parent is not stored yet → the parent is fetched and written first', async () => {
  const { db, woo, deps } = setup({ routes: { 'GET wc/v3/orders/1001': { body: wooOrder() } } });
  const { body } = await deliver(deps, wooSub(2001, 1001, 44));
  assertEquals(body, { status: 'ignored', id: 2001 });
  assertEquals(woo.calls.map((c) => c.path), ['wc/v3/orders/1001']);
  assertEquals(db.rows('orders').length, 1);
  assertEquals(db.row('sub_orders', 2001, 'woo_order_id').order_id, 1001);
  assertEquals(db.row('order_items', 1).sub_order_id, db.row('sub_orders', 2001, 'woo_order_id').id);
});

Deno.test('an order before 2026-10-01, a checkout draft or an order.deleted body → ignored, nothing written', async () => {
  for (const [payload, topic] of [[wooOrder({ date_created_gmt: '2026-09-30T23:59:59' }), 'order.created'], [wooOrder({ status: 'checkout-draft' }), 'order.updated'], [{ id: 1001 }, 'order.deleted']] as const) {
    const { db, woo, deps } = setup();
    const { body } = await deliver(deps, payload, { topic });
    assertEquals(body, { status: 'ignored', id: 1001 });
    assertEquals(ops(db).filter((o: string) => !o.endsWith('woo_webhook_events')), []);
    assertEquals(db.rows('woo_webhook_events')[0].status, 'ignored');
    assertEquals(woo.calls.length, 0);
  }
});

Deno.test('an older payload than the stored one (out-of-order or replayed delivery) → ignored, the order is not reverted', async () => {
  const seed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'مكتمل', woo_status: 'completed', placed_at: '2026-10-20T10:00:00Z', woo_updated_at: '2026-10-22T08:00:00Z' }] };
  const { db, deps } = setup({ seed });
  const { body } = await deliver(deps, wooOrder({ status: 'processing', date_modified_gmt: '2026-10-21T08:00:00' }));
  assertEquals(body.status, 'ignored');
  assertEquals([db.row('orders', 1001).status, db.row('orders', 1001).woo_status], ['مكتمل', 'completed']);
  assertEquals(db.writes('orders').length, 0);
});

Deno.test('a Woo status missing from the map → stored with the raw woo_status, the default status and a conflict row', async () => {
  const { db, deps } = setup({ routes: subsRoute([]) });
  await deliver(deps, wooOrder({ status: 'custom-x' }));
  const o = db.row('orders', 1001);
  assertEquals([o.woo_status, o.status], ['custom-x', 'قيد الانتظار']);
  const log = db.rows('woo_sync_log').find((r: any) => r.result === 'conflict')!;
  assertEquals([log.kind, log.direction, log.entity, log.entity_id], ['webhook', 'in', 'order', '1001']);
});

Deno.test('a product body sent with an order topic (headers are not signed) → ignored', async () => {
  const { db, deps } = setup();
  const { body } = await deliver(deps, wooProduct(501, 44), { topic: 'order.updated' });
  assertEquals(body.status, 'ignored');
  assertEquals(db.rows('orders').length, 0);
});

// ---------------------------------------------------------------- products / other topics

Deno.test('product.updated → products upserted with image_url = images[0].src and the maker linked', async () => {
  const { db, woo, deps } = setup();
  const { body } = await deliver(deps, wooProduct(501, 44), { topic: 'product.updated' });
  assertEquals(body, { status: 'ok', id: 501 });
  const p = db.row('products', 501);
  assertEquals([p.name, p.sku, p.image_url, p.vendor_id, p.price, p.status], ['منتج 501', 'SKU-501', 'https://woo.test/img/501-a.jpg', vendorId(44), 120, 'publish']);
  assertEquals(p.permalink, 'https://woo.test/p/501');
  assertFalse(JSON.stringify(p.raw).includes('Owner Name'), 'raw keeps the shop name only');
  assertEquals(woo.calls.length, 0);
});

Deno.test('an unknown topic → ignored with the event recorded', async () => {
  const { db, deps } = setup();
  const { body } = await deliver(deps, { id: 5, foo: 1 }, { topic: 'coupon.updated' });
  assertEquals(body, { status: 'ignored', id: 5 });
  assertEquals(ops(db), ['insert woo_webhook_events', 'update woo_webhook_events']);
});

// ---------------------------------------------------------------- failures

Deno.test('the ?parent= sub-order list failing (500) → 200 ok, parent + lines written, one error row with neither the secret, the keys nor a phone', async () => {
  const page = `<html><b>Fatal</b> for ${PHONE} / ٠١٠١٢٣٤٥٦٧٨ secret=test-secret key ck_test_0001 cs_test_0002 ${WC_AUTH} test-secret</html>`;
  const { db, deps } = setup({ routes: { 'GET wc/v3/orders': { status: 500, text: page } } });
  const { res, body } = await deliver(deps, wooOrder());
  assertEquals([res.status, body], [200, { status: 'ok', id: 1001 }]);
  assertEquals([db.rows('orders').length, db.rows('order_items').length, db.rows('sub_orders').length], [1, 2, 0]);
  assertEquals(db.rows('woo_webhook_events')[0].status, 'ok');
  const rows = db.rows('woo_sync_log');
  assertEquals(rows.map((r: any) => [r.kind, r.entity, r.entity_id, r.action, r.result]), [['webhook', 'sub_order', '1001', 'parent_list', 'error']]);
  assertStringIncludes(rows[0].detail.error, 'HTTP 500');
  const text = writtenText(db);
  for (const s of [PHONE, '٠١٠١٢٣٤٥٦٧٨', ENV.WOO_WEBHOOK_SECRET, ENV.WOO_CK, ENV.WOO_CS, WC_AUTH.slice(6)]) assertFalse(text.includes(s), `leaked ${s}`);
});

Deno.test('a sub-order or product delivery whose own row is refused (23505 / 22001) → event error, one row-level error row', async () => {
  const seed = { orders: [{ id: 1001, number: '1001', customer_name: 'x', status: 'جاري التنفيذ', placed_at: '2026-10-20T10:00:00Z' }] };
  const dup = (c: any) => (c.table === 'sub_orders' && c.op === 'upsert' ? { code: '23505', message: 'duplicate key value violates unique constraint "sub_orders_order_id_vendor_id_key"' } : null);
  const sub = setup({ seed, fail: dup });
  assertEquals((await deliver(sub.deps, wooSub(2001, 1001, 44))).res.status, 500);
  assertEquals(sub.db.rows('woo_webhook_events')[0].status, 'error');
  assertEquals(sub.db.rows('woo_sync_log').map((r: any) => [r.entity, r.entity_id, r.action, r.result]), [['sub_orders', '2001', 'upsert', 'error'], ['order', '2001', 'order.updated', 'error']]);
  assertFalse(sub.db.writes('order_items').length > 0, 'no line linked to a sub-order that was not written');

  const long = (c: any) => (c.table === 'products' && c.op === 'upsert' ? { code: '22001', message: 'value too long for type character varying(64)' } : null);
  const prod = setup({ fail: long });
  assertEquals((await deliver(prod.deps, wooProduct(501, 44), { topic: 'product.updated' })).res.status, 500);
  assertEquals(prod.db.rows('woo_sync_log')[0].entity, 'products');
  assertStringIncludes(prod.db.rows('woo_sync_log')[0].detail.error, 'value too long');
});

Deno.test('a database error never puts PostgREST details (the failing row, a phone) into the logs', async () => {
  // A data error (23514): the order row is refused (one row-level error row) and the delivery is an error.
  const check = (c: any) => (c.table === 'orders' && c.op === 'upsert' ? { code: '23514', message: 'new row for relation "orders" violates check constraint', details: `Failing row contains (1001, ${PHONE})` } : null);
  const refused = setup({ fail: check });
  assertEquals((await deliver(refused.deps, wooOrder())).res.status, 500);
  assertEquals(refused.db.rows('woo_webhook_events')[0].status, 'error');
  assertStringIncludes(refused.db.rows('woo_webhook_events')[0].error, 'refused');
  const rows = refused.db.rows('woo_sync_log');
  assertEquals(rows.map((r: any) => [r.kind, r.entity, r.entity_id, r.action, r.result]), [['webhook', 'orders', '1001', 'upsert', 'error'], ['webhook', 'order', '1001', 'order.updated', 'error']]);
  assertStringIncludes(rows[0].detail.error, 'violates check constraint');
  assertEquals(refused.db.writes('order_items').length, 0);
  assertFalse(writtenText(refused.db).includes(PHONE));

  // Any other error (a timeout) is thrown as before.
  const timeout = (c: any) => (c.table === 'orders' && c.op === 'upsert' ? { code: '57014', message: 'canceling statement due to statement timeout', details: `Failing row contains (1001, ${PHONE})` } : null);
  const { db, deps } = setup({ fail: timeout });
  assertEquals((await deliver(deps, wooOrder())).res.status, 500);
  assertStringIncludes(db.rows('woo_webhook_events')[0].error, 'statement timeout');
  assertEquals(db.rows('woo_sync_log').map((r: any) => [r.kind, r.entity, r.entity_id, r.action, r.result]), [['webhook', 'order', '1001', 'order.updated', 'error']]);
  assertFalse(writtenText(db).includes(PHONE));
});
