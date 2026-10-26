import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient, opsOf } from './stub-supabase.mjs';
// orders.js against a stub IBSupabase: orders_v (last 12 months) + order_items + sub_orders + vendors + products + status_map
// + woo_states → block 29's screen shape (with each line's link to its product on the website and the governorate's name from
// the website's list); write-through updates (named, granted
// columns, no .select()), the woo-sync push, Realtime refetch.
const src = readFileSync(new URL('../../app/js/adapter/orders.js', import.meta.url), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const V1 = 'a0000000-0000-4000-8000-000000000001', V2 = 'a0000000-0000-4000-8000-000000000002';
// multi-maker: two lines in two Dokan sub-orders; single-maker: one line, no sub-order (+ one removed line)
const O1 = { id: 181668, customer_name: 'سلوى زيتوني', customer_phone: '012••••7052', customer_state: 'EG-01', customer_city: 'القاهرة', customer_address: 'مدينة نصر', payment_method: 'cod', payment_title: 'الدفع عند الاستلام', status: 'جاري التنفيذ', woo_status: 'processing', confirm: 'غير مؤكد', confirm_at: null, deposit: 0, total: 3541, note: null, customer_note: 'اتصلوا قبل التوصيل\nالدور التالت', placed_at: '2026-10-19T12:00:00+00:00', cancel: null, ret: null };
const O2 = { id: 180686, customer_name: 'هدير عميل', customer_phone: '01000007030', customer_state: null, customer_city: null, customer_address: null, payment_method: 'cod', payment_title: null, status: 'معلّق', woo_status: 'on-hold', confirm: 'مؤكد بعربون', confirm_at: '2026-10-18', deposit: '300.00', total: '1002.00', note: 'تبع اوردر 180668', placed_at: '2026-10-17T12:00:00+00:00', cancel: null, ret: { reason: 'x' } };
const SUBS = [{ id: 1, order_id: 181668, vendor_id: V1, woo_order_id: 181669, woo_status: 'processing' }, { id: 2, order_id: 181668, vendor_id: V2, woo_order_id: 181670, woo_status: 'on-hold' }];
const item = (o) => ({ sub_order_id: null, product_id: null, sku: null, qty: 1, total: 0, vendor_id: null, status: '', expected_at: null, comment: null, ready_at: null, waybill: null, pulled: false, ret: null, store: null, removed: false, commission_rate: null, commission_fee: null, ...o });
const ITEMS = [
  item({ id: 5002, order_id: 181668, sub_order_id: 2, product_id: 9002, sku: 'IBTAMCTOWM200X10014', name: 'Macrame Curtain', qty: 1, total: '2539.00', vendor_id: V2, status: 'مؤكد', expected_at: '2026-10-20', comment: 'تم تبليغ المورد', commission_rate: '40.00', commission_fee: '10.00' }),
  item({ id: 5001, order_id: 181668, sub_order_id: 1, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002, vendor_id: V1, commission_rate: 35, commission_fee: 0 }),
  item({ id: 5003, order_id: 180686, product_id: 9001, sku: 'IBTA4040PAHC000013', name: 'Cushion', qty: 2, total: 1002 }),
  item({ id: 5004, order_id: 180686, sku: 'IBTK5050MRHC000010', name: 'Cushion Cover', removed: true }),
];
const VENDORS = [{ id: V2, name: 'Antikiano' }, { id: V1, name: 'Art Craft' }];
const SITE = 'https://stage.ibtekr.test'; // a fake staging host
const PRODUCTS = [{ sku: 'IBTA4040PAHC000013', image_url: 'https://stage.ibtekr.club/cushion.jpg', permalink: SITE + '/product/cushion/' }, { sku: 'IBTAMCTOWM200X10014', image_url: null, permalink: null }];
const STATES = [{ code: 'EG-02', name: 'الجيزة' }, { code: 'EG-01', name: 'القاهرة' }]; // woo_states: the website's list (0010)
const STATUSES = [{ system_status: 'قيد الانتظار', woo_status: 'pending', direction: 'both', sort: 1 }, { system_status: 'فشل', woo_status: 'failed', direction: 'from_woo', sort: 10 }];
const ok = (data) => ({ data, error: null });
// the granted columns the adapter names (0007 grants: no raw, no customer_phone on orders — the view masks it)
const COLS = { order: 'id, customer_name, customer_phone, customer_state, customer_city, customer_address, payment_method, payment_title, status, woo_status, confirm, confirm_at, deposit, total, note, customer_note, placed_at, cancel, ret',
  item: 'id, order_id, sub_order_id, product_id, sku, name, qty, total, vendor_id, status, expected_at, comment, ready_at, waybill, pulled, ret, store, removed, commission_rate, commission_fee', sub: 'id, order_id, vendor_id, woo_order_id, woo_status' };
const seed = () => ({ orders_v: ok([O1, O2]), order_items: ok(ITEMS), sub_orders: ok(SUBS), vendors: ok(VENDORS), products: ok(PRODUCTS), status_map: ok(STATUSES), woo_states: ok(STATES), 'fn:woo-sync': ok({ action: 'push_status', result: 'ok', counts: { pushed: 1 } }) });
// the adapter's clock: local 2026-10-25 12:00 unless a test asks for the real one (now: null)
const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const clockAt = (t) => class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
function load({ responses = seed(), client = true, config = { supabaseUrl: 'https://proj.supabase.co' }, app = null, signedIn = true, channelThrows = false, now = NOW } = {}) {
  const stub = stubClient({ responses, channelThrows }); const events = []; const logs = [];
  const window = { IBSupabase: { client: client ? stub.client : null }, IBAuth: { session: () => (signedIn ? { user: { id: 'u1' } } : null) }, IB_CONFIG: config,
    IBKit: { TODAY: '2026-10-21', logEvent: (action, detail) => { logs.push([action, detail]); return Promise.resolve(); } } };
  if (app) window.OrdersApp = app;
  const ctx = { window, document: { dispatchEvent(e) { events.push(e.type); } }, Event };
  if (now !== null) ctx.Date = clockAt(now);
  runInNewContext(src, ctx);
  return { O: window.IBOrders, window, calls: stub.calls, responses: stub.responses, emitChange: stub.emitChange, emitStatus: stub.emitStatus, events, logs };
}
const selectOf = (calls, table) => opsOf(calls, table).filter((c) => c.op === 'select').map((c) => c.args[0]);
const invokes = (calls) => calls.filter((c) => c.op === 'invoke').map((c) => c.args);
const ymdLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const stampLocal = (d) => ymdLocal(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

test('load names every column (no *, removed included) and asks for the last 12 months, newest first, by pages of 1000', async () => {
  const { O, calls } = load();
  await O.load();
  for (const t of ['orders_v', 'order_items', 'sub_orders', 'vendors', 'products', 'status_map', 'woo_states']) for (const s of selectOf(calls, t)) assert.doesNotMatch(s, /\*/, t);
  assert.deepEqual(selectOf(calls, 'orders_v'), [COLS.order]);
  assert.deepEqual(selectOf(calls, 'order_items'), [COLS.item]);
  assert.match(COLS.item, /\bremoved\b/);
  assert.match(COLS.item, /\bproduct_id\b/); // the ?p= fallback of a line without a known permalink
  assert.deepEqual(selectOf(calls, 'sub_orders'), [COLS.sub]);
  assert.deepEqual(selectOf(calls, 'vendors'), ['id, name']);
  assert.deepEqual(selectOf(calls, 'products'), ['sku, image_url, permalink']);
  assert.deepEqual(selectOf(calls, 'status_map'), ['system_status, woo_status, direction, sort']);
  assert.match(COLS.order, /\bcustomer_state\b/); // the governorate's code (0010)
  assert.deepEqual(selectOf(calls, 'woo_states'), ['code, name']); // once per load, no filter
  assert.deepEqual(opsOf(calls, 'woo_states').filter((c) => c.op !== 'select' && c.op !== 'order'), []);
  const ov = opsOf(calls, 'orders_v');
  const gte = ov.find((c) => c.op === 'gte'); assert.equal(gte.args[0], 'placed_at');
  assert.equal(gte.args[1], new Date(2025, 9, 25, 12, 0).toISOString()); // 12 months before the adapter's clock
  assert.deepEqual(ov.filter((c) => c.op === 'order'), [{ op: 'order', args: ['placed_at', { ascending: false }] }, { op: 'order', args: ['id', { ascending: false }] }]);
  assert.deepEqual(ov.filter((c) => c.op === 'range'), [{ op: 'range', args: [0, 999] }]);
  assert.deepEqual(opsOf(calls, 'order_items').filter((c) => c.op === 'in'), [{ op: 'in', args: ['order_id', [181668, 180686]] }]);
  assert.deepEqual(opsOf(calls, 'sub_orders').filter((c) => c.op === 'in'), [{ op: 'in', args: ['order_id', [181668, 180686]] }]);
  assert.deepEqual(opsOf(calls, 'products').filter((c) => c.op === 'in'), [{ op: 'in', args: ['sku', ['IBTAMCTOWM200X10014', 'IBTA4040PAHC000013']] }]); // the skus of the shown lines only
  assert.equal(calls.some((c) => c.table === 'orders'), false); // the base table is never read (orders_v masks the phone)
});

test('load builds the screen shape: multi-maker sid/raw from the Dokan sub-order, ages from K.TODAY, images, links, vendors, statuses', async () => {
  const hydrated = [];
  const { O, events } = load({ app: { hydrate: (d) => hydrated.push(d) } });
  assert.equal(O.data(), null);
  await O.load();
  const d = plain(O.data());
  assert.deepEqual(d.orders.map((o) => o.id), ['181668', '180686']);
  assert.deepEqual(d.orders[0], { id: '181668', name: 'سلوى زيتوني', phone: '012••••7052', pay: 'الدفع عند الاستلام', date: '2026-10-19', st: 'جاري التنفيذ', cf: 'غير مؤكد', dep: 0, tot: 3541, age: 6, note: '', cnote: 'اتصلوا قبل التوصيل\nالدور التالت', cdate: '', confAt: '', state: 'EG-01', stateName: 'القاهرة', city: 'القاهرة', addr: 'مدينة نصر', cancel: null, ret: null,
    subs: [
      { n: 5001, itemId: '5001', sid: '181669', oid: '181668', prod: 'Cushion', qty: 2, tot: 1002, raw: 'processing', vendor: 'Art Craft', cm: '', ss: '', exp: '', sku: 'IBTA4040PAHC000013', link: SITE + '/product/cushion/', readyAt: '', waybill: null, pulled: false, ret: null, store: null, rate: 35, fee: 0 }, // the website's commission on the line (phase 3)
      { n: 5002, itemId: '5002', sid: '181670', oid: '181668', prod: 'Macrame Curtain', qty: 1, tot: 2539, raw: 'on-hold', vendor: 'Antikiano', cm: 'تم تبليغ المورد', ss: 'مؤكد', exp: '2026-10-20', sku: 'IBTAMCTOWM200X10014', link: SITE + '/?p=9002', readyAt: '', waybill: null, pulled: false, ret: null, store: null, rate: 40, fee: 10 }, // no permalink: the site's ?p=
    ] });
  assert.deepEqual(d.images, { IBTA4040PAHC000013: 'https://stage.ibtekr.club/cushion.jpg' }); // no image_url → no entry
  assert.deepEqual(d.links, { IBTA4040PAHC000013: SITE + '/product/cushion/' }); // no permalink → no entry
  assert.deepEqual(d.vendors, ['Antikiano', 'Art Craft']);
  assert.deepEqual(d.statuses, STATUSES);
  assert.equal(hydrated.length, 1);
  assert.deepEqual(plain(hydrated[0]), d);
  assert.ok(events.includes('ib:notify'));
});

test('toScreen, single maker without a sub-order: sid = the parent order id (the website\'s number, as the n8n → Airtable automation sends it), raw = orders.woo_status; removed lines are skipped', async () => {
  const { O } = load();
  const [o] = plain(O.toScreen([O2], ITEMS, SUBS, VENDORS, { today: '2026-10-25' }));
  assert.equal(o.age, 8);
  assert.deepEqual({ pay: o.pay, dep: o.dep, tot: o.tot, note: o.note, cnote: o.cnote, cdate: o.cdate, confAt: o.confAt, state: o.state, stateName: o.stateName, city: o.city, addr: o.addr, ret: o.ret }, { pay: 'cod', dep: 300, tot: 1002, note: 'تبع اوردر 180668', cnote: '', cdate: '2026-10-18', confAt: '2026-10-18', state: '', stateName: '', city: '', addr: '', ret: { reason: 'x' } });
  assert.deepEqual(o.subs, [{ n: 5003, itemId: '5003', sid: '180686', oid: '180686', prod: 'Cushion', qty: 2, tot: 1002, raw: 'on-hold', vendor: '', cm: '', ss: '', exp: '', sku: 'IBTA4040PAHC000013', link: '', readyAt: '', waybill: null, pulled: false, ret: null, store: null, rate: null, fee: null }]); // no opts.links: no link; no commission: null
});

test('toScreen links: the sku\'s permalink (https only), else <origin>/?p=<product_id> (a positive integer) with the origin of any known permalink, else none', async () => {
  const { O } = load();
  const line = (id, sku, product_id) => item({ id, order_id: 181668, sku, product_id, name: 'p' + id });
  const links = { A: 'https://site.test/product/a/', H: 'http://site.test/product/h/', J: 'javascript:alert(1)' };
  const frozen = JSON.stringify(links);
  const its = [line(1, 'A', 11), line(2, 'B', 77), line(3, 'B', '88'), line(4, 'B', null), line(5, null, 99), line(6, 'H', 12), line(7, 'J', 13),
    line(8, 'B', 0), line(9, 'B', -1), line(10, 'B', 1.5), line(11, 'B', '12abc'), line(12, 'constructor', null), line(13, '__proto__', 14)];
  const got = (lk) => plain(O.toScreen([O1], its, [], [], { today: '2026-10-25', links: lk })[0].subs.map((x) => x.link));
  assert.deepEqual(got(links), ['https://site.test/product/a/', 'https://site.test/?p=77', 'https://site.test/?p=88', '', 'https://site.test/?p=99',
    'https://site.test/?p=12', 'https://site.test/?p=13', '', '', '', '', '', 'https://site.test/?p=14']); // http: / javascript: are never a link
  assert.equal(JSON.stringify(links), frozen); // pure: the map is not changed
  assert.deepEqual(got(links), got(links));
  assert.deepEqual(got({ H: 'http://site.test/h', J: 'javascript:alert(1)' }), Array(13).fill('')); // no https permalink: no origin, no link
  assert.deepEqual(got({}), Array(13).fill(''));
  // the origin of the first permalink with a plain host (and port)
  assert.deepEqual(got({ X: 'https://user@evil.test/x', A: 'https://site.test:8443/product/a' }).slice(0, 2), ['https://site.test:8443/product/a', 'https://site.test:8443/?p=77']);
});

test('toScreen governorate: state = the code (trimmed) or \'\', stateName = its name from opts.states (a Map or woo_states rows), else the code, else \'\'', async () => {
  const { O } = load();
  const rows = [{ ...O1, id: 1, customer_state: 'EG-01' }, { ...O1, id: 2, customer_state: 'EG-14' }, { ...O1, id: 3, customer_state: null }, { ...O1, id: 4, customer_state: ' ' },
    { ...O1, id: 5, customer_state: ' EG-02 ' }, { ...O1, id: 6, customer_state: 'EG-03' }, { ...O1, id: 7, customer_state: 'constructor' }, { ...O1, id: 8, customer_state: '__proto__' }];
  const got = (states) => plain(O.toScreen(rows, [], [], [], { today: '2026-10-25', states }).map((o) => [o.state, o.stateName]));
  const map = new Map([['EG-01', 'القاهرة'], ['EG-02', 'الجيزة'], ['EG-03', ' ']]);
  const frozen = JSON.stringify([...map]);
  const want = [['EG-01', 'القاهرة'], ['EG-14', 'EG-14'], ['', ''], ['', ''], ['EG-02', 'الجيزة'], ['EG-03', 'EG-03'], ['constructor', 'constructor'], ['__proto__', '__proto__']]; // an unknown code / a blank name: the code
  assert.deepEqual(got(map), want);
  assert.equal(JSON.stringify([...map]), frozen); // pure: the map is not changed
  assert.deepEqual(got([{ code: 'EG-01', name: 'القاهرة' }, { code: 'EG-02', name: 'الجيزة' }, { code: 'EG-03', name: null }, { code: null, name: 'x' }]), want); // woo_states rows
  const none = want.map(([c]) => [c, c]);
  assert.deepEqual(got(undefined), none); // no list: the codes
  assert.deepEqual(got([]), none);
  assert.deepEqual(got({ 'EG-01': 'القاهرة' }), none); // neither a Map nor rows
});

test('load: woo_states empty or refused is no error — the codes show; a refused one keeps the last good list', async () => {
  const { O, responses } = load();
  responses.woo_states = ok([]);
  await O.load();
  assert.equal(O.state(), 'ready');
  assert.deepEqual(plain(O.data().orders.map((o) => [o.state, o.stateName])), [['EG-01', 'EG-01'], ['', '']]);
  responses.woo_states = ok(STATES);
  await O.load();
  assert.equal(O.data().orders[0].stateName, 'القاهرة');
  responses.woo_states = { data: null, error: { code: '42501', message: 'permission denied for table woo_states' } };
  await O.load();
  assert.equal(O.state(), 'ready');
  assert.equal(O.data().orders[0].stateName, 'القاهرة'); // the last list stays
  const fresh = load({ responses: { ...seed(), woo_states: { data: null, error: { code: '42P01', message: 'relation "public.woo_states" does not exist' } } } });
  await fresh.O.load();
  assert.equal(fresh.O.state(), 'ready');
  assert.deepEqual(plain(fresh.O.data().orders.map((o) => o.stateName)), ['EG-01', '']);
});

test('toScreen: age counts whole days from the order date to today, never below 0; ready_at shows as the local clock', async () => {
  const { O } = load();
  const at = new Date(2026, 9, 20, 11, 5);
  const [o] = plain(O.toScreen([{ ...O1, placed_at: '2026-10-13T12:00:00Z' }], [item({ id: 7, order_id: 181668, name: 'x', ready_at: at.toISOString(), waybill: { no: 'B1' }, pulled: true, store: { reason: 'r' } })], [], [], { today: '2026-10-25' }));
  assert.equal(o.age, 12);
  assert.deepEqual({ readyAt: o.subs[0].readyAt, waybill: o.subs[0].waybill, pulled: o.subs[0].pulled, store: o.subs[0].store }, { readyAt: stampLocal(at), waybill: { no: 'B1' }, pulled: true, store: { reason: 'r' } });
  assert.equal(O.toScreen([{ ...O1, placed_at: '2026-10-28T12:00:00Z' }], [], [], [], { today: '2026-10-25' })[0].age, 0);
  assert.equal(O.toScreen([{ ...O1, placed_at: '2026-10-19T12:00:00Z' }], [], [], [], { today: '2026-10-25' })[0].date, ymdLocal(new Date('2026-10-19T12:00:00Z')));
  assert.equal(O.toScreen([O1], [], [], [], { today: '2026-10-31' })[0].age, 12);
});

test('today() is the real local date and the default of toScreen — never IBKit.TODAY (the prototype\'s fixed 2026-10-21)', async () => {
  const { O, window } = load();
  assert.equal(window.IBKit.TODAY, '2026-10-21');
  assert.equal(O.today(), '2026-10-25'); // the adapter's clock
  assert.equal(O.toScreen([O1], [], [], [])[0].age, 6); // 19 → 25 October; IBKit.TODAY would give 2
  assert.equal(O.toScreen([O1], [], [], [], {})[0].age, 6);
  const later = load({ now: new Date(2026, 10, 3, 9, 0).getTime() }); // after IBKit.TODAY + 11 days: no clamp to 0
  assert.equal(later.O.today(), '2026-11-03');
  await later.O.load();
  assert.equal(later.O.data().orders[0].age, 15);
  const real = load({ now: null });
  const before = ymdLocal(new Date()); const got = real.O.today(); const after = ymdLocal(new Date());
  assert.ok(got === before || got === after, got);
});

test('long lists: orders_v paged (cap 5000), in() lists chunked by 200 ids and 100 skus', async () => {
  const many = (from, n) => Array.from({ length: n }, (_, i) => ({ ...O1, id: from + i }));
  const responses = { ...seed(), orders_v: (ops) => { const r = ops.find((c) => c.op === 'range').args[0]; return ok(r === 0 ? many(1, 1000) : r === 1000 ? many(1001, 450) : []); },
    order_items: (ops) => ok(ops.find((c) => c.op === 'in').args[1].map((id) => item({ id: id * 10, order_id: id, sku: 'S' + id, name: 'p' }))) };
  const { O, calls } = load({ responses });
  await O.load();
  assert.deepEqual(opsOf(calls, 'orders_v').filter((c) => c.op === 'range').map((c) => c.args), [[0, 999], [1000, 1999]]);
  const lens = (t, col) => opsOf(calls, t).filter((c) => c.op === 'in' && c.args[0] === col).map((c) => c.args[1].length);
  assert.deepEqual(lens('order_items', 'order_id'), [200, 200, 200, 200, 200, 200, 200, 50]);
  assert.deepEqual(lens('sub_orders', 'order_id'), [200, 200, 200, 200, 200, 200, 200, 50]);
  assert.deepEqual(lens('products', 'sku'), Array(14).fill(100).concat([50]));
  assert.equal(O.data().orders.length, 1450);
  assert.equal(O.data().orders[1449].subs[0].sid, '1450'); // no Dokan sub-order → the parent order id, never the line id (14500)
  const capped = load({ responses: { ...seed(), orders_v: (ops) => ok(many(ops.find((c) => c.op === 'range').args[0] + 1, 1000)) } });
  await capped.O.load();
  assert.deepEqual(opsOf(capped.calls, 'orders_v').filter((c) => c.op === 'range').map((c) => c.args[0]), [0, 1000, 2000, 3000, 4000]);
  assert.equal(capped.O.data().orders.length, 5000);
});

test('a row repeated across two pages (an order placed while paging) is kept once', async () => {
  const many = (from, n) => Array.from({ length: n }, (_, i) => ({ ...O1, id: from + i }));
  const responses = { ...seed(), order_items: ok([]), orders_v: (ops) => ok(ops.find((c) => c.op === 'range').args[0] === 0 ? many(1, 1000) : many(1000, 11)) }; // 1000 is on both pages
  const { O, calls } = load({ responses });
  await O.load();
  assert.equal(O.data().orders.length, 1010);
  assert.equal(new Set(O.data().orders.map((o) => o.id)).size, 1010);
  assert.equal(opsOf(calls, 'order_items').filter((c) => c.op === 'in').flatMap((c) => c.args[1]).length, 1010); // each id asked once
});

test('state(): idle → loading → ready; a failed load → error (load() again retries); clear → idle; each change dispatches ib:orders', async () => {
  const { O, responses, events } = load();
  assert.equal(O.state(), 'idle');
  const pending = O.load();
  assert.equal(O.state(), 'loading');
  await pending;
  assert.equal(O.state(), 'ready');
  assert.equal(events.filter((e) => e === 'ib:orders').length, 2);
  responses.orders_v = { data: null, error: { code: 'PGRST000', message: 'down' } };
  await O.load();
  assert.equal(O.state(), 'error');
  assert.equal(O.data().orders.length, 2); // the last good load stays
  responses.orders_v = ok([O1, O2]);
  await O.load();
  assert.equal(O.state(), 'ready');
  O.clear();
  assert.equal(O.state(), 'idle');
  const abandoned = O.load(); O.clear(); await abandoned;
  assert.equal(O.state(), 'idle'); // cleared mid-load: never 'error'
  const first = load({ responses: { ...seed(), order_items: { data: null, error: { message: 'x' } } } });
  await first.O.load();
  assert.deepEqual([first.O.state(), first.O.data()], ['error', null]);
  const none = load({ client: false });
  await none.O.load();
  assert.equal(none.O.state(), 'idle');
});

test('a failed read keeps data() as it was and never throws', async () => {
  const { O, responses } = load();
  responses.order_items = { data: null, error: { code: 'PGRST000', message: 'down' } };
  await O.load();
  assert.equal(O.data(), null);
  responses.order_items = ok(ITEMS); await O.load();
  assert.equal(O.data().orders.length, 2);
  responses.orders_v = { data: null, error: { code: '42501', message: 'permission denied' } }; await O.load();
  assert.equal(O.data().orders.length, 2);
});

test('setOrderStatus updates orders (status only, no .select()) then pushes it through woo-sync', async () => {
  const { O, calls, logs } = load();
  await O.load(); calls.length = 0;
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'قيد الشحن', {})), { ok: true, push: 'ok' });
  assert.deepEqual(opsOf(calls, 'orders'), [{ op: 'update', args: [{ status: 'قيد الشحن' }] }, { op: 'eq', args: ['id', '181668'] }]);
  assert.deepEqual(invokes(calls), [['woo-sync', { body: { action: 'push_status', order_id: 181668, status: 'قيد الشحن' } }]]);
  assert.ok(calls.findIndex((c) => c.op === 'invoke') > calls.findIndex((c) => c.op === 'update')); // the row first: woo-sync refuses a stale status
  assert.deepEqual(logs, [['order.status', 'IB-181668 · قيد الشحن']]);
});

test('setOrderStatus carries cancel / ret when given; the push result is answered, a push failure never fails the write', async () => {
  const { O, calls, responses } = load();
  await O.load(); calls.length = 0;
  const cancel = { reason: 'العميل لغى', note: '', date: '2026-10-25' };
  responses['fn:woo-sync'] = ok({ action: 'push_status', result: 'skipped', reason: 'no_woo_status' });
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'ملغي', { cancel })), { ok: true, push: 'skipped' });
  assert.deepEqual(opsOf(calls, 'orders')[0], { op: 'update', args: [{ status: 'ملغي', cancel }] });
  calls.length = 0;
  responses['fn:woo-sync'] = { data: null, error: { name: 'FunctionsHttpError', context: { status: 502 } } };
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'استرجاع', { ret: { reason: 'تالف' } })), { ok: true, push: 'error' });
  assert.deepEqual(opsOf(calls, 'orders')[0], { op: 'update', args: [{ status: 'استرجاع', ret: { reason: 'تالف' } }] });
  responses['fn:woo-sync'] = () => { throw new Error('offline'); };
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'مكتمل')), { ok: true, push: 'error' });
});

test('a refused write (42501) answers forbidden: no push, no log; any other error answers network', async () => {
  const { O, calls, responses, logs } = load();
  await O.load(); calls.length = 0;
  responses.orders = { data: null, error: { code: '42501', message: 'orders.status = F is required to change an order status or confirmation' } };
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'قيد الشحن', {})), { ok: false, reason: 'forbidden' });
  assert.deepEqual(invokes(calls), []);
  responses.orders = { data: null, error: { code: 'PGRST000', message: 'down' } };
  assert.deepEqual(plain(await O.setOrderStatus('181668', 'قيد الشحن', {})), { ok: false, reason: 'network' });
  assert.deepEqual(plain(await O.setConfirm('181668', 'مؤكد بعربون', {})), { ok: false, reason: 'network' });
  responses.order_items = () => { throw new Error('offline'); };
  assert.deepEqual(plain(await O.setItemStatus('5001', 'مؤكد')), { ok: false, reason: 'network' });
  responses.order_items = { data: null, error: { code: '42501', message: 'x' } };
  assert.deepEqual(plain(await O.setWaybill('5001', null)), { ok: false, reason: 'forbidden' });
  assert.deepEqual(logs, []);
  assert.deepEqual(invokes(calls), []);
});

test('setConfirm and patchOrder write only the granted orders columns they were given', async () => {
  const { O, calls, logs } = load();
  await O.load(); calls.length = 0;
  assert.deepEqual(plain(await O.setConfirm('181668', 'مؤكد بعربون', { confAt: '2026-10-25', note: 'كلمناها' })), { ok: true });
  assert.deepEqual(plain(await O.setConfirm('181668', 'غير مؤكد', { confAt: '' })), { ok: true });
  assert.deepEqual(plain(await O.patchOrder('180686', { note: 'اتصل بعد 5', city: 'الجيزة', addr: 'الدقي', dep: '500' })), { ok: true });
  assert.deepEqual(plain(await O.patchOrder('180686', { dep: 0 })), { ok: true });
  assert.deepEqual(opsOf(calls, 'orders').filter((c) => c.op === 'update').map((c) => c.args[0]), [
    { confirm: 'مؤكد بعربون', confirm_at: '2026-10-25', confirm_note: 'كلمناها' }, { confirm: 'غير مؤكد', confirm_at: null },
    { note: 'اتصل بعد 5', customer_city: 'الجيزة', customer_address: 'الدقي', deposit: 500 }, { deposit: 0 }]);
  calls.length = 0;
  assert.deepEqual(plain(await O.patchOrder('180686', {})), { ok: true }); // nothing to write: no request
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, [['order.confirm', 'IB-181668 · مؤكد بعربون'], ['order.confirm', 'IB-181668 · غير مؤكد'], ['order.patch', 'IB-180686 · note, city, addr, dep'], ['order.patch', 'IB-180686 · dep']]);
});

test('patchOrder refuses a deposit that is not a finite number and writes nothing (never a silent 0)', async () => {
  const { O, calls, logs } = load();
  await O.load(); calls.length = 0;
  for (const dep of ['abc', '', ' ', '12abc', null, NaN, Infinity, {}]) assert.deepEqual(plain(await O.patchOrder('180686', { note: 'x', dep })), { ok: false, reason: 'invalid' }, String(dep));
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, []);
  assert.deepEqual(plain(await O.patchOrder('180686', { dep: ' 250 ' })), { ok: true });
  assert.deepEqual(opsOf(calls, 'orders')[0], { op: 'update', args: [{ deposit: 250 }] });
});

test('setItemStatus writes status + extras on order_items; setWaybill / setPulled their one column', async () => {
  const { O, calls, logs } = load();
  await O.load(); calls.length = 0;
  const ret = { reason: 'مقاس غلط', note: '' };
  assert.deepEqual(plain(await O.setItemStatus('5001', 'مرتجع للمخزن', { ret })), { ok: true });
  assert.deepEqual(opsOf(calls, 'order_items'), [{ op: 'update', args: [{ status: 'مرتجع للمخزن', ret }] }, { op: 'eq', args: ['id', '5001'] }]);
  calls.length = 0;
  assert.deepEqual(plain(await O.setItemStatus(5002, 'جاهز للشحن من المورد للعميل', { exp: '', cm: 'هيتسلم بكرة', store: { reason: 'تجميع' }, readyAt: '2026-10-20 11:00' })), { ok: true });
  await O.setItemStatus(5002, undefined, { cm: 'تعليق بس' });
  await O.setWaybill(5002, { no: 'BST-1', at: '2026-10-25' });
  await O.setPulled(5003, true);
  assert.deepEqual(opsOf(calls, 'order_items').filter((c) => c.op === 'update').map((c) => c.args[0]), [
    { status: 'جاهز للشحن من المورد للعميل', expected_at: null, comment: 'هيتسلم بكرة', store: { reason: 'تجميع' }, ready_at: new Date(2026, 9, 20, 11, 0).toISOString() },
    { comment: 'تعليق بس' }, { waybill: { no: 'BST-1', at: '2026-10-25' } }, { pulled: true }]);
  assert.deepEqual(logs, [['suborder.status', 'IB-181668 · #5001 · مرتجع للمخزن'], ['suborder.status', 'IB-181668 · #5002 · جاهز للشحن من المورد للعميل'], ['suborder.status', 'IB-181668 · #5002'], ['suborder.waybill', 'IB-181668 · #5002'], ['suborder.pulled', 'IB-180686 · #5003 · سحب من المتاح']]);
  for (const [, d] of logs) assert.doesNotMatch(d, /سلوى|هدير|01\d|القاهرة|مقاس|تعليق|هيتسلم/); // ids and statuses only
});

test('nothing to write → { ok:true } without a request; setConfirm with a date only leaves confirm alone', async () => {
  const { O, calls, logs } = load();
  await O.load(); calls.length = 0;
  assert.deepEqual(plain(await O.setItemStatus('5001', undefined, {})), { ok: true });
  assert.deepEqual(plain(await O.setConfirm('181668', undefined, {})), { ok: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(plain(await O.setConfirm('181668', undefined, { confAt: '2026-10-24' })), { ok: true });
  assert.deepEqual(opsOf(calls, 'orders')[0], { op: 'update', args: [{ confirm_at: '2026-10-24' }] });
  assert.deepEqual(logs, [['order.confirm', 'IB-181668']]);
});

test('a throwing OrdersApp hook does not stop the load or ib:notify, and is re-thrown later (not hidden)', async () => {
  const later = [];
  const { O, window, events, emitChange } = load({ app: { hydrate() { throw new Error('hydrate bug'); }, applyOrder() { throw new Error('applyOrder bug'); } } });
  window.setTimeout = (fn) => { later.push(fn); };
  await O.load();
  assert.equal(O.data().orders.length, 2);
  assert.ok(events.includes('ib:notify'));
  O.subscribe(); events.length = 0;
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 181668 } });
  assert.equal(later.length, 3); // the two re-throws, then the burst's ib:notify timer
  assert.throws(later[0], /hydrate bug/);
  assert.throws(later[1], /applyOrder bug/);
  assert.equal(events.includes('ib:notify'), false);
  later[2]();
  assert.ok(events.includes('ib:notify'));
});

// a fake window timer: the scheduled { fn, ms } in order; run(i) fires one; cleared ones are marked
const timers = (window) => {
  const list = [];
  window.setTimeout = (fn, ms) => { list.push({ fn, ms, cleared: false }); return list.length; };
  window.clearTimeout = (id) => { if (list[id - 1]) list[id - 1].cleared = true; };
  return list;
};
const flush = () => new Promise((r) => setImmediate(r)); // every pending microtask (the stub answers with promises)

test('Realtime: a burst of refetches dispatches one ib:notify, 250 ms after the first; clear() drops a pending one', async () => {
  const applied = [];
  const { O, window, responses, emitChange, events } = load({ app: { applyOrder: (o) => applied.push(o.id) } });
  await O.load(); O.subscribe();
  const t = timers(window); events.length = 0;
  responses.orders_v = (ops) => ok([O1, O2].filter((o) => String(o.id) === String(ops.find((c) => c.op === 'eq').args[1])));
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 181668 } });
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 180686 } });
  await emitChange({ table: 'order_items', eventType: 'UPDATE', new: { id: 5001, order_id: 181668 } });
  assert.deepEqual(applied, ['181668', '180686', '181668']); // every order is still drawn at once
  assert.deepEqual(t.map((x) => x.ms), [250]); // one timer for the burst
  assert.equal(events.includes('ib:notify'), false);
  t[0].fn();
  assert.deepEqual(events.filter((e) => e === 'ib:notify'), ['ib:notify']);
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 180686 } }); // a later change: a new burst
  assert.equal(t.length, 2);
  O.clear();
  assert.equal(t[1].cleared, true);
  assert.deepEqual(events.filter((e) => e === 'ib:notify'), ['ib:notify']);
});

test('Realtime: subscribed again after the socket was down → one load(); a first SUBSCRIBED or an old channel → nothing', async () => {
  const hydrated = [];
  const { O, calls, emitStatus } = load({ app: { hydrate: (d) => hydrated.push(d.orders.length) } });
  await O.load(); O.subscribe(); calls.length = 0; hydrated.length = 0;
  const loads = () => opsOf(calls, 'orders_v').filter((c) => c.op === 'gte').length;
  emitStatus('SUBSCRIBED'); await flush(); // the first join: nothing was missed
  assert.equal(loads(), 0);
  emitStatus('CHANNEL_ERROR'); await flush();
  assert.equal(loads(), 0); // down: nothing to read yet
  emitStatus('SUBSCRIBED'); await flush();
  assert.equal(loads(), 1);
  assert.deepEqual(hydrated, [2]);
  emitStatus('SUBSCRIBED'); await flush(); // once per drop
  assert.equal(loads(), 1);
  emitStatus('TIMED_OUT'); emitStatus('CLOSED'); emitStatus('SUBSCRIBED'); await flush();
  assert.equal(loads(), 2);
  O.unsubscribe(); // the channel this adapter let go of: its CLOSED / SUBSCRIBED are not a drop
  emitStatus('CLOSED'); emitStatus('SUBSCRIBED'); await flush();
  assert.equal(loads(), 2);
});

test('syncNow and registerWebhooks call woo-sync; a refusal answers forbidden', async () => {
  const { O, calls, responses } = load();
  responses['fn:woo-sync'] = (opts) => ok(opts.body.action === 'all' ? { action: 'all', result: 'ok', counts: { orders: { upserted: 3 } } } : { action: 'register_webhooks', result: 'ok', counts: { created: 4 }, webhooks: [{ id: 81, topic: 'order.updated' }] });
  assert.deepEqual(plain(await O.syncNow()), { ok: true, counts: { orders: { upserted: 3 } } });
  assert.deepEqual(plain(await O.registerWebhooks()), { ok: true, list: [{ id: 81, topic: 'order.updated' }] });
  assert.deepEqual(invokes(calls), [['woo-sync', { body: { action: 'all' } }], ['woo-sync', { body: { action: 'register_webhooks', delivery_url: 'https://proj.supabase.co/functions/v1/woo-webhook' } }]]);
  responses['fn:woo-sync'] = { data: null, error: { name: 'FunctionsHttpError', context: { status: 401 } } };
  assert.deepEqual(plain(await O.syncNow()), { ok: false, reason: 'forbidden' });
  responses['fn:woo-sync'] = { data: null, error: { name: 'FunctionsFetchError', context: {} } };
  assert.deepEqual(plain(await O.registerWebhooks()), { ok: false, reason: 'network' });
});

test('Realtime: INSERT/UPDATE on the three tables re-read that order from orders_v and hand it to OrdersApp.applyOrder', async () => {
  const applied = [];
  const { O, calls, responses, emitChange, events } = load({ app: { hydrate() {}, applyOrder: (o) => applied.push(plain(o)) } });
  await O.load(); O.subscribe();
  assert.ok(calls.some((c) => c.op === 'channel' && c.args[0] === 'orders'));
  assert.deepEqual(calls.filter((c) => c.op === 'on').map((c) => c.args), ['orders', 'order_items', 'sub_orders'].flatMap((table) => ['INSERT', 'UPDATE'].map((event) => ['postgres_changes', { event, schema: 'public', table }])));
  calls.length = 0; events.length = 0;
  responses.orders_v = (ops) => ok([O1, O2].filter((o) => String(o.id) === String(ops.find((c) => c.op === 'eq').args[1])).map((o) => ({ ...o, status: 'قيد الشحن' })));
  responses.order_items = (ops) => ok(ITEMS.filter((i) => String(i.order_id) === String(ops.find((c) => c.op === 'eq').args[1])).map((i) => ({ ...i, comment: 'اتحدث' })));
  responses.sub_orders = (ops) => ok(SUBS.filter((s) => String(s.order_id) === String(ops.find((c) => c.op === 'eq').args[1])));
  await emitChange({ table: 'order_items', eventType: 'UPDATE', new: { id: 5001, order_id: 181668, status: 'مؤكد' } });
  assert.deepEqual(opsOf(calls, 'orders_v'), [{ op: 'select', args: [COLS.order] }, { op: 'eq', args: ['id', '181668'] }]); // the payload is not used
  assert.deepEqual(opsOf(calls, 'order_items'), [{ op: 'select', args: [COLS.item] }, { op: 'eq', args: ['order_id', '181668'] }]);
  assert.deepEqual(opsOf(calls, 'sub_orders'), [{ op: 'select', args: [COLS.sub] }, { op: 'eq', args: ['order_id', '181668'] }]);
  assert.equal(applied.length, 1);
  assert.deepEqual({ id: applied[0].id, st: applied[0].st, phone: applied[0].phone, cms: applied[0].subs.map((s) => s.cm), sids: applied[0].subs.map((s) => s.sid) }, { id: '181668', st: 'قيد الشحن', phone: '012••••7052', cms: ['اتحدث', 'اتحدث'], sids: ['181669', '181670'] });
  assert.deepEqual(applied[0].subs.map((s) => s.link), [SITE + '/product/cushion/', SITE + '/?p=9002']); // the load's links (and their origin) still apply
  assert.deepEqual([applied[0].state, applied[0].stateName], ['EG-01', 'القاهرة']); // customer_state re-read; the load's names still apply
  assert.equal(calls.some((c) => c.table === 'woo_states'), false); // not asked again per event
  assert.equal(O.data().orders[0].st, 'قيد الشحن'); // the cache follows
  assert.ok(events.includes('ib:notify'));
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 180686, status: 'مكتمل' } }); // an orders payload: its own id
  assert.equal(applied[1].id, '180686');
  await emitChange({ table: 'sub_orders', eventType: 'INSERT', new: { id: 3, order_id: 181668 } });
  assert.equal(applied[2].id, '181668');
  assert.equal(O.data().orders.length, 2);
});

test('Realtime: a new order with an unknown maker and product asks for just those, then lands first', async () => {
  const applied = [];
  const { O, calls, responses, emitChange } = load({ app: { applyOrder: (o) => applied.push(plain(o)) } });
  await O.load(); O.subscribe(); calls.length = 0;
  const V3 = 'a0000000-0000-4000-8000-000000000003';
  responses.orders_v = ok([{ ...O1, id: 182000, customer_name: 'عميل جديد' }]);
  responses.order_items = ok([item({ id: 9100, order_id: 182000, sku: 'NEW-SKU', name: 'Pouf', vendor_id: V3 })]);
  responses.sub_orders = ok([]);
  responses.vendors = ok([{ id: V3, name: 'sala' }]);
  responses.products = ok([{ sku: 'NEW-SKU', image_url: 'https://stage.ibtekr.club/pouf.jpg', permalink: SITE + '/product/pouf/' }]);
  await emitChange({ table: 'orders', eventType: 'INSERT', new: { id: 182000 } });
  assert.deepEqual(opsOf(calls, 'vendors').filter((c) => c.op === 'in'), [{ op: 'in', args: ['id', [V3]] }]);
  assert.deepEqual(opsOf(calls, 'products').filter((c) => c.op === 'in'), [{ op: 'in', args: ['sku', ['NEW-SKU']] }]);
  assert.deepEqual(selectOf(calls, 'products'), ['sku, image_url, permalink']);
  assert.equal(applied[0].subs[0].vendor, 'sala');
  assert.equal(applied[0].subs[0].link, SITE + '/product/pouf/');
  assert.equal(O.data().orders[0].id, '182000');
  assert.equal(O.data().images['NEW-SKU'], 'https://stage.ibtekr.club/pouf.jpg');
  assert.equal(O.data().links['NEW-SKU'], SITE + '/product/pouf/');
  assert.deepEqual(plain(O.data().vendors), ['Antikiano', 'Art Craft', 'sala']);
});

test('Realtime: an order the screen does not have and placed before the 12-month window is left out', async () => {
  const applied = [];
  const { O, calls, responses, emitChange, events } = load({ app: { applyOrder: (o) => applied.push(plain(o)) } });
  await O.load(); O.subscribe(); calls.length = 0; events.length = 0;
  responses.orders_v = ok([{ ...O1, id: 150001, placed_at: '2025-10-20T12:00:00Z' }]); // before 2025-10-25 (12 months back)
  responses.order_items = ok([item({ id: 9200, order_id: 150001, sku: 'OLD-SKU', name: 'قديم', vendor_id: 'a0000000-0000-4000-8000-000000000009' })]);
  responses.sub_orders = ok([]);
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 150001 } });
  assert.deepEqual(plain(O.data().orders.map((o) => o.id)), ['181668', '180686']);
  assert.deepEqual(applied, []);
  assert.equal(events.includes('ib:notify'), false);
  assert.deepEqual(calls.filter((c) => c.table === 'vendors' || c.table === 'products'), []); // nothing asked for it
  responses.orders_v = ok([{ ...O2, placed_at: '2025-10-20T12:00:00Z', status: 'مكتمل' }]); // one the screen has: still followed
  responses.order_items = ok(ITEMS.filter((i) => i.order_id === 180686));
  await emitChange({ table: 'orders', eventType: 'UPDATE', new: { id: 180686 } });
  assert.equal(applied.length, 1);
  assert.equal(O.data().orders.find((o) => o.id === '180686').st, 'مكتمل');
});

test('subscribe: realtime:false → no channel; a throwing channel is swallowed; no client or signed out → nothing', async () => {
  const off = load({ config: { realtime: false } });
  await off.O.load(); off.O.subscribe();
  assert.equal(off.calls.some((c) => c.op === 'channel'), false);
  const bad = load({ channelThrows: true });
  assert.doesNotThrow(() => bad.O.subscribe());
  await bad.O.load();
  assert.equal(bad.O.data().orders.length, 2);
  const none = load({ client: false });
  await none.O.load(); none.O.subscribe();
  assert.equal(none.O.data(), null);
  assert.deepEqual(plain(await none.O.setOrderStatus('1', 'مكتمل')), { ok: false, reason: 'network' });
  assert.deepEqual(plain(await none.O.syncNow()), { ok: false, reason: 'network' });
  const out = load({ signedIn: false });
  await out.O.load(); out.O.subscribe();
  assert.deepEqual(out.calls, []);
});

test('clear unsubscribes and drops the data; a load still in flight is abandoned; IBOrdersStore is IBOrders', async () => {
  const hydrated = [];
  const { O, window, calls } = load({ app: { hydrate: (d) => hydrated.push(d) } });
  assert.equal(window.IBOrdersStore, O);
  await O.load(); O.subscribe(); hydrated.length = 0;
  O.clear();
  assert.equal(O.data(), null);
  assert.ok(calls.some((c) => c.op === 'removeChannel'));
  calls.length = 0;
  const pending = O.load(); O.clear(); await pending;
  assert.equal(O.data(), null);
  assert.deepEqual(hydrated, []);
  assert.deepEqual(calls.filter((c) => c.table && !['orders_v', 'vendors', 'status_map', 'woo_states'].includes(c.table)), []); // nothing asked after the clear
});
