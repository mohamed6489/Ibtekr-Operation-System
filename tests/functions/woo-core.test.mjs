import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  START_DATE, OPEN_WOO, WOO_FALLBACK, META_KEEP,
  verifySignature, isSubOrder, normalizePhone, redactPII,
  incomingStatus, outgoingWooStatus, mapOrder, mapSubOrder, mapStore, nextCursor,
} from '../../supabase/functions/_shared/woo-core.js';
// supabase/functions/_shared/woo-core.js: the pure sync core shared by the woo-webhook / woo-sync Edge Functions.
// Fixtures follow the staging shapes from the Task 1 probe; every name, phone, email and address here is made up.

const SRC = new URL('../../supabase/functions/_shared/woo-core.js', import.meta.url);
const MIGRATION = new URL('../../supabase/migrations/0007_orders.sql', import.meta.url);
const R = '<redacted>';
const U77 = '00000000-0000-4000-8000-000000000077';
const U2376 = '00000000-0000-4000-8000-000000002376';
const VENDORS = { 77: U77, 2376: U2376 };
const NOW = '2026-10-25T08:00:00.000Z';

// status_map exactly as 0007_orders.sql leaves it (order = sort).
const MAP = [
  { system_status: 'قيد الانتظار', woo_status: 'pending', direction: 'both' },
  { system_status: 'جاري التنفيذ', woo_status: 'processing', direction: 'both' },
  { system_status: 'معلّق', woo_status: 'on-hold', direction: 'both' },
  { system_status: 'جاهز للشحن', woo_status: 'ready-shipping', direction: 'both' },
  { system_status: 'قيد الشحن', woo_status: 'in-shipping', direction: 'both' },
  { system_status: 'تم RTC', woo_status: null, direction: 'from_system' },
  { system_status: 'مكتمل', woo_status: 'completed', direction: 'both' },
  { system_status: 'استرجاع', woo_status: 'refunded', direction: 'both' },
  { system_status: 'ملغي', woo_status: 'cancelled', direction: 'both' },
];

const PHONE = '+201200007052', EMAIL = 'rasha.test@example.com', STREET = 'شارع التجربة 12', FLAT = 'الدور الثالث';
const BOSTA_PHONE = '01009998877', FB_ID = 'fbp.1.1700000000000.123456789', UA = 'Mozilla/5.0 (TestPhone) Safari/1.0';
const PII = [PHONE, '1200007052', EMAIL, 'زيتوني', STREET, FLAT, BOSTA_PHONE, FB_ID, UA, '198.51.100.7', 'wc_order_TESTKEY', 'اتصلي قبل التوصيل', 'إلى سلوى مع الحب'];

const parent = (over = {}) => ({
  id: 181668, parent_id: 0, number: '181668', status: 'processing', currency: 'EGP', created_via: 'checkout',
  date_created: '2026-10-19T12:12:00', date_created_gmt: '2026-10-19T09:12:00',
  date_modified: '2026-10-19T13:00:00', date_modified_gmt: '2026-10-19T10:00:00',
  total: '1052.00', customer_id: 0, order_key: 'wc_order_TESTKEY', customer_ip_address: '198.51.100.7', customer_user_agent: UA,
  customer_note: 'اتصلي قبل التوصيل', payment_method: 'cod', payment_method_title: 'الدفع عند الاستلام',
  payment_url: 'https://stage.example.test/checkout/order-pay/181668/?pay_for_order=true&key=wc_order_TESTKEY',
  billing: { first_name: 'سلوى', last_name: 'زيتوني', company: '', address_1: STREET, address_2: FLAT, city: 'القاهرة', state: 'EGC', postcode: '', country: 'EG', email: EMAIL, phone: PHONE },
  shipping: { first_name: 'سلوى', last_name: 'زيتوني', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'EG', phone: '' },
  line_items: [{
    id: 9001, name: 'شمعة معطرة', product_id: 501, variation_id: 0, quantity: 2, subtotal: '1002.00', total: '1002.00', sku: 'SC-12', price: 501,
    meta_data: [{ id: 1, key: '_dokan_vendor_id', value: '77' }, { id: 2, key: 'gift_message', value: 'إلى سلوى مع الحب' }, { id: 3, key: '_reduced_stock', value: '2' }],
  }],
  shipping_lines: [{ id: 9100, method_title: 'شحن', total: '50.00' }],
  meta_data: [
    { id: 11, key: 'bosta_delivery_id', value: 'BD-TEST-1' },
    { id: 12, key: 'bosta_tracking_number', value: '7000000001' },
    { id: 13, key: 'bosta_status', value: 'created' },
    { id: 14, key: 'bosta_sync_status', value: 'synced' },
    { id: 15, key: 'bosta_customer_phone', value: BOSTA_PHONE },
    { id: 16, key: 'wpml_language', value: 'ar' },
    { id: 17, key: '_wc_order_attribution_source_type', value: 'utm' },
    { id: 18, key: '_wc_order_attribution_utm_source', value: 'facebook' },
    { id: 19, key: '_wc_order_attribution_utm_medium', value: 'paid' },
    { id: 20, key: '_wc_order_attribution_utm_campaign', value: 'oct' },
    { id: 21, key: '_wc_order_attribution_user_agent', value: UA },
    { id: 22, key: 'facebook_user_identifiers_1374412550868003', value: { fbp: FB_ID } },
    { id: 23, key: 'pmw_ssp_session_id', value: 'sess-test-1' },
    { id: 24, key: '_billing_address_index', value: `سلوى زيتوني ${STREET} ${PHONE}` },
  ],
  ...over,
});

// A single-vendor parent as on staging: the parent itself carries _dokan_vendor_id, the lines carry no meta.
const singleVendor = (over = {}) => {
  const p = parent(over);
  p.meta_data = [{ id: 30, key: '_dokan_vendor_id', value: '2376' }, ...p.meta_data];
  p.line_items = [
    { id: 9101, name: 'طبق خزف', product_id: 601, quantity: 1, total: '400.00', sku: 'PL-1', meta_data: [] },
    { id: 9102, name: 'كوب خزف', product_id: 602, quantity: 3, total: '600.00', sku: '', meta_data: [{ id: 4, key: '_reduced_stock', value: '3' }] },
  ];
  return p;
};

// A Dokan sub-order as on staging: created_via 'dokan', parent_id > 0, meta only _dokan_vendor_id.
const sub = (meta = [], over = {}) => ({
  ...parent(), id: 181700, parent_id: 181668, number: '181700', created_via: 'dokan', total: '1002.00',
  meta_data: [{ id: 40, key: '_dokan_vendor_id', value: '77' }, { id: 41, key: 'bosta_customer_phone', value: BOSTA_PHONE }, ...meta],
  ...over,
});

const keysOfMeta = (m) => m.map((e) => e.key);
const noPII = (value, label) => { const s = JSON.stringify(value); for (const v of PII) assert.ok(!s.includes(v), `${label}: ${v}`); };

// ---------------------------------------------------------------- module contract

test('module is pure: no imports, no environment globals, no clock', () => {
  // comments out first: the header names Deno and Node on purpose
  const src = readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bimport\s*\(/);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /\b(Deno|process|Buffer)\b/);
  assert.doesNotMatch(src, /Date\.now|new Date\(\s*\)|Math\.random|\bfetch\s*\(/);
});

test('constants', () => {
  assert.equal(START_DATE, '2026-10-01');
  assert.deepEqual(OPEN_WOO, ['processing', 'pending', 'on-hold']);
  assert.deepEqual(WOO_FALLBACK, { failed: 'ملغي' });
  for (const k of ['_dokan_*', 'bosta_delivery_id', 'bosta_tracking_number', 'bosta_status', 'bosta_sync_status', 'wpml_language',
    '_wc_order_attribution_source_type', '_wc_order_attribution_utm_source', '_wc_order_attribution_utm_medium', '_wc_order_attribution_utm_campaign']) {
    assert.ok(META_KEEP.includes(k), k);
  }
  assert.equal(META_KEEP.length, 10);
});

test('the test status map matches the 0007 reseed (names, slugs, directions)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  for (const r of MAP) {
    const slug = r.woo_status === null ? 'null' : `'${r.woo_status}'`;
    assert.match(sql, new RegExp(`\\('${r.system_status}',\\s*${slug},\\s*'${r.direction}'`), r.system_status);
  }
});

// ---------------------------------------------------------------- verifySignature

const sign = async (body, secret) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...mac));
};

test('verifySignature: a correct WooCommerce signature over an Arabic body is accepted', async () => {
  const body = JSON.stringify(parent());
  const secret = 'test-webhook-secret-سر';
  const sig = await sign(body, secret);
  assert.equal(sig, createHmac('sha256', secret).update(body, 'utf8').digest('base64')); // PHP base64_encode(hash_hmac(..., true))
  assert.equal(await verifySignature(body, sig, secret), true);
  assert.equal(await verifySignature(new TextEncoder().encode(body), sig, secret), true); // raw bytes work too
});

test('verifySignature: known-answer vector', async () => {
  assert.equal(await verifySignature('The quick brown fox jumps over the lazy dog', '97yD9DBThCSxMpjmqm+xQ+9NWaFJRhdZl0edvC0aPNg=', 'key'), true);
});

test('verifySignature: one changed character, another body, another secret, wrong length → false', async () => {
  const body = JSON.stringify(parent()), secret = 'test-webhook-secret';
  const sig = await sign(body, secret);
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  assert.equal(await verifySignature(body, flip(sig, 0), secret), false);
  assert.equal(await verifySignature(body, flip(sig, 20), secret), false);
  assert.equal(await verifySignature(body.replace('سلوى', 'رشى'), sig, secret), false);
  assert.equal(await verifySignature(body, sig, secret + 'x'), false);
  assert.equal(await verifySignature(body, sig.slice(0, -1), secret), false);
  assert.equal(await verifySignature(body, sig + 'A', secret), false);
});

test('verifySignature: empty or missing inputs → false, never throws', async () => {
  const body = '{"id":1}', secret = 's3cret';
  const sig = await sign(body, secret);
  assert.equal(await verifySignature(body, sig, ''), false);
  assert.equal(await verifySignature(body, '', secret), false);
  assert.equal(await verifySignature('', await sign('', secret), secret), false);
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(await verifySignature(bad, sig, secret), false);
    assert.equal(await verifySignature(body, bad, secret), false);
    assert.equal(await verifySignature(body, sig, bad), false);
  }
});

// ---------------------------------------------------------------- isSubOrder / normalizePhone / redactPII

test('isSubOrder: parent_id > 0', () => {
  assert.equal(isSubOrder({ parent_id: 0 }), false);
  assert.equal(isSubOrder({ parent_id: 181700 }), true);
  assert.equal(isSubOrder({ parent_id: '181700' }), true);
  assert.equal(isSubOrder({}), false);
  assert.equal(isSubOrder(null), false);
});

test('normalizePhone: digits only, Egyptian country code → leading 0', () => {
  assert.equal(normalizePhone('+20 120-000-7052'), '01200007052');
  assert.equal(normalizePhone('+201200007052'), '01200007052');
  assert.equal(normalizePhone('00201200007052'), '01200007052');
  assert.equal(normalizePhone('201200007052'), '01200007052');
  assert.equal(normalizePhone('+20 01200007052'), '01200007052');
  assert.equal(normalizePhone('0120 000 7052'), '01200007052');
  assert.equal(normalizePhone('٠١٢٠٠٠٠٧٠٥٢'), '01200007052'); // Arabic-Indic digits typed at checkout
  assert.equal(normalizePhone('۰۱۲۰۰۰۰۷۰۵۲'), '01200007052'); // Persian digits
  assert.equal(normalizePhone('+971 50 123 4567'), '971501234567'); // other countries: digits only
  assert.equal(normalizePhone('2012345'), '2012345'); // "20" not followed by 10 digits is not a country code
  for (const empty of ['', '   ', '---', null, undefined]) assert.equal(normalizePhone(empty), null);
  assert.equal(normalizePhone(1200007052), '1200007052');
});

test('redactPII: personal keys at any depth (the Task 1 rule), input untouched', () => {
  const input = { a: [{ note: 'x', b: { billing_email: 'y', customer_ip_address: 'z', phone_number: 'p', address: { street_1: 's' } } }], billing: { first_name: 'f', last_name: 'l', company: 'c', address_1: 'a1', address_2: 'a2', city: 'Cairo', email: 'e', phone: 'p' }, customer_note: 'n', notes: 'kept', n: null, q: 1 };
  const before = structuredClone(input);
  assert.deepEqual(redactPII(input), {
    a: [{ note: R, b: { billing_email: R, customer_ip_address: R, phone_number: R, address: R } }],
    billing: { first_name: R, last_name: R, company: R, address_1: R, address_2: R, city: 'Cairo', email: R, phone: R },
    customer_note: R, notes: 'kept', n: null, q: 1,
  });
  assert.deepEqual(input, before);
  assert.equal(redactPII('text'), 'text');
  assert.equal(redactPII(null), null);
});

// ---------------------------------------------------------------- incomingStatus / outgoingWooStatus

test('incomingStatus: the map rows (both / from_woo) decide', () => {
  assert.deepEqual(incomingStatus('on-hold', 'جاري التنفيذ', MAP), { status: 'معلّق', result: 'ok' });
  assert.deepEqual(incomingStatus('processing', null, MAP), { status: 'جاري التنفيذ', result: 'ok' });
  assert.deepEqual(incomingStatus('in-shipping', 'جاهز للشحن', MAP), { status: 'قيد الشحن', result: 'ok' });
  const fromWoo = [...MAP, { system_status: 'مدفوع', woo_status: 'paid', direction: 'from_woo' }];
  assert.deepEqual(incomingStatus('paid', 'قيد الانتظار', fromWoo), { status: 'مدفوع', result: 'ok' });
});

test('incomingStatus: failed → ملغي (WOO_FALLBACK)', () => {
  assert.deepEqual(incomingStatus('failed', null, MAP), { status: 'ملغي', result: 'ok' });
  assert.deepEqual(incomingStatus('failed', 'جاري التنفيذ', MAP), { status: 'ملغي', result: 'ok' });
});

test('incomingStatus: unknown Woo status → keep the current one (or the first map status) as a conflict', () => {
  assert.deepEqual(incomingStatus('weird', 'قيد الشحن', MAP), { status: 'قيد الشحن', result: 'conflict' });
  assert.deepEqual(incomingStatus('weird', null, MAP), { status: 'قيد الانتظار', result: 'conflict' });
  assert.deepEqual(incomingStatus(undefined, null, MAP), { status: 'قيد الانتظار', result: 'conflict' });
  assert.deepEqual(incomingStatus('weird', null, []), { status: 'قيد الانتظار', result: 'conflict' });
  // the first status follows the sort column when the rows carry one
  const sorted = MAP.map((r, i) => ({ ...r, sort: i + 1 })).reverse();
  assert.deepEqual(incomingStatus('weird', null, sorted), { status: 'قيد الانتظار', result: 'conflict' });
});

test('incomingStatus: from_system never takes an incoming status → unchanged', () => {
  // the team set «تم RTC» (from_system): whatever Woo sends next does not overwrite it
  assert.deepEqual(incomingStatus('in-shipping', 'تم RTC', MAP), { status: 'تم RTC', result: 'unchanged' });
  assert.deepEqual(incomingStatus('completed', 'تم RTC', MAP), { status: 'تم RTC', result: 'unchanged' });
  assert.deepEqual(incomingStatus('failed', 'تم RTC', MAP), { status: 'تم RTC', result: 'unchanged' });
  // a slug whose only row is from_system is not taken from Woo either
  const pushOnly = [...MAP, { system_status: 'مؤرشف', woo_status: 'archived', direction: 'from_system' }];
  assert.deepEqual(incomingStatus('archived', 'مكتمل', pushOnly), { status: 'مكتمل', result: 'unchanged' });
  assert.deepEqual(incomingStatus('archived', null, pushOnly), { status: 'قيد الانتظار', result: 'unchanged' });
});

test('incomingStatus: two system statuses on one slug keep the current one', () => {
  const shared = [...MAP, { system_status: 'جاري التغليف', woo_status: 'processing', direction: 'both' }];
  assert.deepEqual(incomingStatus('processing', 'جاري التغليف', shared), { status: 'جاري التغليف', result: 'ok' });
  assert.deepEqual(incomingStatus('processing', 'قيد الانتظار', shared), { status: 'جاري التنفيذ', result: 'ok' });
});

test('outgoingWooStatus: slug for both / from_system rows with a slug, else null', () => {
  assert.equal(outgoingWooStatus('تم RTC', MAP), null);
  assert.equal(outgoingWooStatus('مكتمل', MAP), 'completed');
  assert.equal(outgoingWooStatus('جاهز للشحن', MAP), 'ready-shipping');
  assert.equal(outgoingWooStatus('ملغي', MAP), 'cancelled');
  assert.equal(outgoingWooStatus('غير موجود', MAP), null);
  assert.equal(outgoingWooStatus('مدفوع', [...MAP, { system_status: 'مدفوع', woo_status: 'paid', direction: 'from_woo' }]), null);
  assert.equal(outgoingWooStatus('مؤرشف', [...MAP, { system_status: 'مؤرشف', woo_status: 'archived', direction: 'from_system' }]), 'archived');
  assert.equal(outgoingWooStatus('مكتمل', undefined), null);
});

// ---------------------------------------------------------------- mapOrder

test('mapOrder: a parent order → the orders row', () => {
  const input = parent();
  const before = structuredClone(input);
  const r = mapOrder(input, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal(r.skipped, undefined);
  assert.equal('skipped' in r, false);
  assert.deepEqual(Object.keys(r.order).sort(), ['currency', 'customer_address', 'customer_city', 'customer_name', 'customer_note', 'customer_phone', 'id', 'number',
    'payment_method', 'payment_title', 'placed_at', 'raw', 'status', 'synced_at', 'total', 'woo_status', 'woo_updated_at']);
  const { raw, ...row } = r.order;
  assert.deepEqual(row, {
    id: 181668, number: '181668', customer_name: 'سلوى زيتوني', customer_phone: '01200007052', customer_city: 'القاهرة',
    customer_address: `${STREET} ${FLAT}`, payment_method: 'cod', payment_title: 'الدفع عند الاستلام', status: 'جاري التنفيذ',
    woo_status: 'processing', total: 1052, currency: 'EGP', customer_note: 'اتصلي قبل التوصيل',
    placed_at: '2026-10-19T09:12:00Z', woo_updated_at: '2026-10-19T10:00:00Z', synced_at: NOW,
  });
  assert.equal(r.statusResult, 'ok');
  assert.deepEqual(r.unknownVendorIds, []);
  assert.deepEqual(input, before);
});

test('mapOrder: raw keeps the payload with billing/shipping redacted and the PII fields out', () => {
  const { order } = mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  const raw = order.raw;
  for (const k of ['first_name', 'last_name', 'email', 'phone', 'address_1', 'address_2']) assert.equal(raw.billing[k], R, k);
  assert.equal(raw.billing.city, 'القاهرة');
  assert.equal(raw.shipping.first_name, R);
  for (const k of ['customer_note', 'customer_ip_address', 'customer_user_agent', 'order_key', 'payment_url']) assert.equal(k in raw, false, k);
  assert.equal(raw.id, 181668);
  assert.equal(raw.status, 'processing');
  assert.equal(raw.shipping_lines[0].method_title, 'شحن');
  noPII(raw, 'order.raw');
});

test('mapOrder: raw.meta_data keeps the allow-list only (removed, not redacted)', () => {
  const { order } = mapOrder(singleVendor(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.deepEqual(keysOfMeta(order.raw.meta_data), ['_dokan_vendor_id', 'bosta_delivery_id', 'bosta_tracking_number', 'bosta_status', 'bosta_sync_status', 'wpml_language',
    '_wc_order_attribution_source_type', '_wc_order_attribution_utm_source', '_wc_order_attribution_utm_medium', '_wc_order_attribution_utm_campaign']);
  assert.equal(order.raw.meta_data.find((m) => m.key === 'bosta_tracking_number').value, '7000000001');
  for (const k of ['bosta_customer_phone', 'facebook_user_identifiers_1374412550868003', '_wc_order_attribution_user_agent', 'pmw_ssp_session_id', '_billing_address_index']) {
    assert.ok(!keysOfMeta(order.raw.meta_data).includes(k), k);
  }
  noPII(order.raw, 'order.raw');
});

test('mapOrder: raw.line_items keep only the line id and its _dokan_* meta', () => {
  const { order } = mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.deepEqual(order.raw.line_items, [{ id: 9001, meta_data: [{ id: 1, key: '_dokan_vendor_id', value: '77' }] }]);
});

test('mapOrder: line items → order_items rows (vendor from the line meta)', () => {
  const r = mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal(r.items.length, 1);
  const { raw, ...item } = r.items[0];
  assert.deepEqual(item, { id: 9001, order_id: 181668, product_id: 501, sku: 'SC-12', name: 'شمعة معطرة', qty: 2, total: 1002, vendor_id: VENDORS[77] });
  assert.deepEqual(raw.meta_data, [{ id: 1, key: '_dokan_vendor_id', value: '77' }]);
  assert.equal(raw.price, 501);
  noPII(raw, 'item.raw');
});

test('mapOrder: a single-vendor parent gives its _dokan_vendor_id to lines without one', () => {
  const r = mapOrder(singleVendor(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.deepEqual(r.items.map((i) => i.vendor_id), [U2376, U2376]);
  assert.deepEqual(r.items.map((i) => i.sku), ['PL-1', null]);
  assert.deepEqual(r.items[1].raw.meta_data, []);
  for (const i of r.items) assert.ok(i.raw.meta_data.every((m) => m.key.startsWith('_dokan_')));
  assert.deepEqual(r.unknownVendorIds, []);
  // a line's own vendor wins over the parent's
  const mixed = singleVendor();
  mixed.line_items[0].meta_data = [{ id: 5, key: '_dokan_vendor_id', value: 77 }];
  assert.deepEqual(mapOrder(mixed, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW }).items.map((i) => i.vendor_id), [U77, U2376]);
});

test('mapOrder: unknown Dokan vendors are listed once and leave vendor_id null', () => {
  const r = mapOrder(singleVendor(), { statusMap: MAP, vendorsByWooId: {}, now: NOW });
  assert.deepEqual(r.unknownVendorIds, [2376]);
  assert.deepEqual(r.items.map((i) => i.vendor_id), [null, null]);
  const two = singleVendor();
  two.line_items.forEach((li) => { li.meta_data = [{ id: 6, key: '_dokan_vendor_id', value: '77' }]; });
  assert.deepEqual(mapOrder(two, { statusMap: MAP, vendorsByWooId: { 2376: U2376 }, now: NOW }).unknownVendorIds, [77]);
  assert.deepEqual(mapOrder(two, { statusMap: MAP, now: NOW }).unknownVendorIds, [2376, 77]);
  assert.deepEqual(mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW }).unknownVendorIds, []);
  // no vendor meta anywhere: nothing unknown, vendor_id null
  const none = parent(); none.line_items[0].meta_data = [];
  const rn = mapOrder(none, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.deepEqual(rn.unknownVendorIds, []);
  assert.equal(rn.items[0].vendor_id, null);
});

test('mapOrder: vendorsByWooId may be an object or a Map, keyed by number or string', () => {
  for (const vendors of [{ '2376': U2376 }, new Map([[2376, U2376]]), new Map([['2376', U2376]])]) {
    const r = mapOrder(singleVendor(), { statusMap: MAP, vendorsByWooId: vendors, now: NOW });
    assert.deepEqual(r.items.map((i) => i.vendor_id), [U2376, U2376]);
    assert.deepEqual(r.unknownVendorIds, []);
  }
});

test('mapOrder: customer fields fall back sensibly', () => {
  const p = parent();
  p.shipping = { first_name: '', last_name: '', address_1: 'شارع الشحن 5', address_2: '', city: 'الجيزة', phone: '' };
  const r = mapOrder(p, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal(r.order.customer_city, 'الجيزة');
  assert.equal(r.order.customer_address, 'شارع الشحن 5');
  const bare = parent({ billing: { first_name: '  ', last_name: '', phone: '', city: '' }, shipping: { first_name: 'سما', last_name: 'تجربة', phone: '٠١٠٠٠٠٠٠٠٠١', city: '' }, customer_note: '' });
  const rb = mapOrder(bare, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal(rb.order.customer_name, 'سما تجربة');
  assert.equal(rb.order.customer_phone, '01000000001');
  assert.equal(rb.order.customer_city, null);
  assert.equal(rb.order.customer_address, null);
  assert.equal(rb.order.customer_note, null);
  const empty = mapOrder(parent({ billing: {}, shipping: {} }), { statusMap: MAP, now: NOW }).order;
  assert.equal(empty.customer_name, '');
  assert.equal(empty.customer_phone, null);
});

test('mapOrder: the status goes through incomingStatus with the current DB status', () => {
  const ctx = { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW };
  let r = mapOrder(parent({ status: 'on-hold' }), { ...ctx, currentStatus: 'جاري التنفيذ' });
  assert.equal(r.order.status, 'معلّق'); assert.equal(r.statusResult, 'ok'); assert.equal(r.order.woo_status, 'on-hold');
  r = mapOrder(parent({ status: 'processing' }), { ...ctx, currentStatus: 'تم RTC' });
  assert.equal(r.order.status, 'تم RTC'); assert.equal(r.statusResult, 'unchanged');
  r = mapOrder(parent({ status: 'weird' }), { ...ctx, currentStatus: 'قيد الشحن' });
  assert.equal(r.order.status, 'قيد الشحن'); assert.equal(r.statusResult, 'conflict');
  r = mapOrder(parent({ status: 'failed' }), ctx);
  assert.equal(r.order.status, 'ملغي'); assert.equal(r.statusResult, 'ok');
  r = mapOrder(parent({ status: 'ready-shipping' }), ctx);
  assert.equal(r.order.status, 'جاهز للشحن');
});

test('mapOrder: skipped before START_DATE and for drafts (nothing to write)', () => {
  const ctx = { statusMap: MAP, vendorsByWooId: {}, now: NOW };
  const early = mapOrder(singleVendor({ date_created_gmt: '2026-09-30T23:59:00' }), ctx);
  assert.deepEqual(early, { skipped: 'before_start', order: null, items: [], unknownVendorIds: [], statusResult: null });
  assert.equal(mapOrder(parent({ date_created_gmt: '2026-10-01T00:00:00' }), ctx).skipped, undefined);
  assert.equal(mapOrder(parent({ status: 'checkout-draft' }), ctx).skipped, 'draft');
  assert.equal(mapOrder(parent({ status: 'trash' }), ctx).skipped, 'draft');
  assert.equal(mapOrder(parent({ status: 'checkout-draft' }), ctx).order, null);
});

test('mapOrder: dates with a zone are not given a second one; now as a Date', () => {
  const r = mapOrder(parent({ date_created_gmt: '2026-10-19T09:12:00Z', date_modified_gmt: null }), { statusMap: MAP, now: new Date(NOW) });
  assert.equal(r.order.placed_at, '2026-10-19T09:12:00Z');
  assert.equal(r.order.woo_updated_at, null);
  assert.equal(r.order.synced_at, NOW);
  assert.equal(mapOrder(parent(), { statusMap: MAP }).order.synced_at, null);
});

// ---------------------------------------------------------------- mapSubOrder

test('mapSubOrder: a staging sub-order (only _dokan_vendor_id) → earning and commission null', () => {
  const input = sub();
  const before = structuredClone(input);
  const r = mapSubOrder(input, { vendorsByWooId: VENDORS });
  assert.deepEqual(Object.keys(r.sub).sort(), ['commission', 'dokan_earning', 'order_id', 'raw', 'total', 'vendor_id', 'woo_order_id', 'woo_status']);
  const { raw, ...row } = r.sub;
  assert.deepEqual(row, { order_id: 181668, vendor_id: U77, woo_order_id: 181700, woo_status: 'processing', total: 1002, dokan_earning: null, commission: null });
  assert.deepEqual(r.unknownVendorIds, []);
  assert.deepEqual(keysOfMeta(raw.meta_data), ['_dokan_vendor_id']);
  assert.equal(raw.billing.phone, R);
  noPII(raw, 'sub.raw');
  assert.deepEqual(input, before);
});

test('mapSubOrder: Dokan commission meta and earning are converted to numbers', () => {
  const r = mapSubOrder(sub([
    { id: 50, key: '_dokan_commission_rate', value: '40' }, { id: 51, key: '_dokan_commission_type', value: 'percentage' },
    { id: 52, key: '_dokan_admin_fee', value: '400.80' }, { id: 53, key: '_dokan_vendor_earning', value: '601.20' },
  ]), { vendorsByWooId: VENDORS });
  assert.equal(r.sub.commission.rate, 40);
  assert.deepEqual(r.sub.commission, { rate: 40, type: 'percentage', admin_fee: 400.8, additional_fee: null });
  assert.equal(r.sub.dokan_earning, 601.2);
  assert.equal(typeof r.sub.dokan_earning, 'number');
  // dokan/v1/orders carries `earning` as a field instead of meta
  const v1 = mapSubOrder(sub([], { earning: '550.5' }), { vendorsByWooId: VENDORS });
  assert.equal(v1.sub.dokan_earning, 550.5);
  assert.equal(v1.sub.commission, null);
  // one commission key is enough for the object; an unusable value stays null
  assert.deepEqual(mapSubOrder(sub([{ id: 54, key: '_dokan_additional_fee', value: 'n/a' }]), { vendorsByWooId: VENDORS }).sub.commission,
    { rate: null, type: null, admin_fee: null, additional_fee: null });
});

test('mapSubOrder: unknown vendor → unknownVendorIds and vendor_id null', () => {
  const r = mapSubOrder(sub(), { vendorsByWooId: {} });
  assert.deepEqual(r.unknownVendorIds, [77]);
  assert.equal(r.sub.vendor_id, null);
  assert.deepEqual(mapSubOrder(sub(), {}).unknownVendorIds, [77]);
  assert.deepEqual(mapSubOrder(sub(), { vendorsByWooId: new Map([['77', U77]]) }).sub.vendor_id, U77);
});

// ---------------------------------------------------------------- mapStore

const store = (over = {}) => ({
  id: 2376, store_name: 'ورشة التجربة', first_name: 'منى', last_name: 'تجربة', email: 'maker.test@example.com', social: { fb: 'https://facebook.example/maker' },
  phone: '01111111111', show_email: false, address: { street_1: 'شارع الورشة 7', street_2: '', city: 'القاهرة', zip: '', country: 'EG', state: 'EGC' },
  location: '', banner: 'https://stage.example.test/banner.jpg', gravatar: 'https://stage.example.test/g.jpg', shop_url: 'https://stage.example.test/store/test/',
  products_per_page: 12, show_more_product_tab: true, toc_enabled: false, store_toc: '', featured: false, rating: { rating: '4.5', count: 2 },
  enabled: true, registered: '2025-01-02 10:00:00', payment: { bank: { ac_name: 'منى تجربة', ac_number: '000111222' } }, trusted: true,
  ...over,
});

test('mapStore: Dokan store → vendors row with a lean raw', () => {
  const input = store();
  const before = structuredClone(input);
  const v = mapStore(input);
  assert.deepEqual(Object.keys(v).sort(), ['email', 'name', 'phone', 'raw', 'status', 'woo_vendor_id']);
  assert.deepEqual({ ...v, raw: undefined }, { woo_vendor_id: 2376, name: 'ورشة التجربة', phone: '01111111111', email: null, status: 'active', raw: undefined });
  assert.deepEqual(v.raw, { id: 2376, store_name: 'ورشة التجربة', shop_url: 'https://stage.example.test/store/test/', rating: { rating: '4.5', count: 2 },
    enabled: true, registered: '2025-01-02 10:00:00', featured: false, trusted: true });
  const s = JSON.stringify(v.raw);
  for (const pii of ['maker.test@example.com', '01111111111', 'شارع الورشة 7', '000111222', 'منى', 'facebook.example', 'banner.jpg', 'g.jpg']) assert.ok(!s.includes(pii), pii);
  assert.deepEqual(input, before);
});

test('mapStore: enabled:false → inactive; email only when shown', () => {
  assert.equal(mapStore(store({ enabled: false })).status, 'inactive');
  assert.equal(mapStore(store({ show_email: true })).email, 'maker.test@example.com');
  assert.equal(mapStore(store({ show_email: true, email: '' })).email, null);
  assert.equal(mapStore(store({ phone: '' })).phone, null);
  assert.equal(mapStore(store({ id: '77', store_name: '' })).woo_vendor_id, 77);
  assert.equal(mapStore(store({ id: '77', store_name: '  ' })).name, '#77'); // vendors.name is not null
});

// ---------------------------------------------------------------- nextCursor

test('nextCursor: newest date_modified_gmt − 60 s, never before the previous cursor', () => {
  const orders = [{ date_modified_gmt: '2026-10-19T10:00:00' }, { date_modified_gmt: '2026-10-20T08:30:15' }, { date_modified_gmt: '2026-10-20T08:00:00' }];
  assert.equal(nextCursor('2026-10-18T00:00:00Z', orders), '2026-10-20T08:29:15Z');
  assert.equal(nextCursor(null, orders), '2026-10-20T08:29:15Z');
  assert.equal(nextCursor('2026-10-18T00:00:00', orders), '2026-10-20T08:29:15Z'); // a zone-less previous is GMT
  assert.equal(nextCursor('2026-10-20T08:29:40Z', orders), '2026-10-20T08:29:40Z'); // within the 60 s overlap: stay
  assert.equal(nextCursor('2026-10-21T00:00:00Z', orders), '2026-10-21T00:00:00Z');
});

test('nextCursor: no usable dates → the previous cursor as given', () => {
  assert.equal(nextCursor('2026-10-18T00:00:00Z', []), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00Z', undefined), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00Z', [{ date_modified_gmt: null }, { date_modified_gmt: 'not a date' }, {}]), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor(null, []), null);
});
