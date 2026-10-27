import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  START_DATE, OPEN_WOO, WOO_FALLBACK, META_KEEP,
  verifySignature, isSubOrder, normalizePhone, redactPII,
  incomingStatus, outgoingWooStatus, mapOrder, mapSubOrder, mapStore, nextCursor,
  SYNC_FIELDS, ADDRESS_KEYS, SOCIAL_KEYS, addressText, storeSnapshot, diffStore, sameField, commissionOf, toDokanCommission, toDokanStore,
} from '../../supabase/functions/_shared/woo-core.js';
import { mapProduct } from '../../supabase/functions/_shared/woo-write.js';
// supabase/functions/_shared/woo-core.js: the pure sync core shared by the woo-webhook / woo-sync Edge Functions
// (mapProduct, the one pure mapper in woo-write.js, is tested here too).
// Fixtures follow the staging shapes from the Task 1 probe; every name, phone, email and address here is made up.

const SRC = new URL('../../supabase/functions/_shared/woo-core.js', import.meta.url);
const MIGRATION = new URL('../../supabase/migrations/0007_orders.sql', import.meta.url);
const MIGRATION_0009 = new URL('../../supabase/migrations/0009_failed_note_permalink.sql', import.meta.url);
const R = '<redacted>';
const U77 = '00000000-0000-4000-8000-000000000077';
const U2376 = '00000000-0000-4000-8000-000000002376';
const VENDORS = { 77: U77, 2376: U2376 };
const NOW = '2026-10-25T08:00:00.000Z';

// status_map exactly as 0007_orders.sql + 0009_failed_note_permalink.sql leave it (order = sort; 0009 turned «تم RTC»
// into «فشل», sort 10).
const MAP = [
  { system_status: 'قيد الانتظار', woo_status: 'pending', direction: 'both' },
  { system_status: 'جاري التنفيذ', woo_status: 'processing', direction: 'both' },
  { system_status: 'معلّق', woo_status: 'on-hold', direction: 'both' },
  { system_status: 'جاهز للشحن', woo_status: 'ready-shipping', direction: 'both' },
  { system_status: 'قيد الشحن', woo_status: 'in-shipping', direction: 'both' },
  { system_status: 'مكتمل', woo_status: 'completed', direction: 'both' },
  { system_status: 'استرجاع', woo_status: 'refunded', direction: 'both' },
  { system_status: 'ملغي', woo_status: 'cancelled', direction: 'both' },
  { system_status: 'فشل', woo_status: 'failed', direction: 'from_woo' },
];
// No row is from_system today: the rule is tested on a synthetic team-only status with no Woo slug.
const TEAM = 'حالة داخلية';
const TEAM_MAP = [...MAP, { system_status: TEAM, woo_status: null, direction: 'from_system' }];

const PHONE = '+201200007052', EMAIL = 'rasha.test@example.com', STREET = 'شارع التجربة 12', FLAT = 'الدور الثالث';
const BOSTA_PHONE = '01009998877', FB_ID = 'fbp.1.1700000000000.123456789', UA = 'Mozilla/5.0 (TestPhone) Safari/1.0';
// Markers in places nobody listed (nested line meta, fee names, refund reasons, an unexpected billing key): raw is an
// allow-list, so none of them may reach it.
const SHIP_MARK = 'MARK-SHIP-META', FEE_MARK = 'MARK-FEE-NAME', COUPON_MARK = 'MARK-COUPON-META', REFUND_MARK = 'MARK-REFUND-REASON', WA_MARK = '01055554444';
const LINE_MARK = 'MARK-LINE-EXTRA', META_MARK = 'MARK-META-NOTE', META_PHONE = '01077776666', META_EMAIL = 'meta.mark@example.com';
const PII = [PHONE, '1200007052', EMAIL, 'زيتوني', STREET, FLAT, BOSTA_PHONE, FB_ID, UA, '198.51.100.7', 'wc_order_TESTKEY', 'اتصلي قبل التوصيل', 'إلى سلوى مع الحب',
  SHIP_MARK, FEE_MARK, COUPON_MARK, REFUND_MARK, WA_MARK, LINE_MARK, META_MARK, META_PHONE, META_EMAIL];

const parent = (over = {}) => ({
  id: 181668, parent_id: 0, number: '181668', status: 'processing', currency: 'EGP', created_via: 'checkout',
  date_created: '2026-10-19T12:12:00', date_created_gmt: '2026-10-19T09:12:00',
  date_modified: '2026-10-19T13:00:00', date_modified_gmt: '2026-10-19T10:00:00',
  total: '1052.00', customer_id: 0, order_key: 'wc_order_TESTKEY', customer_ip_address: '198.51.100.7', customer_user_agent: UA,
  customer_note: 'اتصلي قبل التوصيل', payment_method: 'cod', payment_method_title: 'الدفع عند الاستلام',
  payment_url: 'https://stage.example.test/checkout/order-pay/181668/?pay_for_order=true&key=wc_order_TESTKEY',
  billing: { first_name: 'سلوى', last_name: 'زيتوني', company: '', address_1: STREET, address_2: FLAT, city: 'القاهرة', state: 'EGC', postcode: '11511', country: 'EG', email: EMAIL, phone: PHONE, whatsapp: WA_MARK },
  shipping: { first_name: 'سلوى', last_name: 'زيتوني', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'EG', phone: '' },
  line_items: [{
    id: 9001, name: 'شمعة معطرة', product_id: 501, variation_id: 0, quantity: 2, subtotal: '1002.00', total: '1002.00', sku: 'SC-12', price: 501,
    personalization: `اسم على الشمعة ${LINE_MARK}`, image: { id: 77, src: 'https://stage.example.test/candle.jpg' },
    meta_data: [{ id: 1, key: '_dokan_vendor_id', value: '77' }, { id: 2, key: 'gift_message', value: 'إلى سلوى مع الحب' }, { id: 3, key: '_reduced_stock', value: '2' }],
  }],
  shipping_lines: [{ id: 9100, method_id: 'flat_rate', method_title: 'شحن', total: '50.00', meta_data: [{ id: 70, key: 'Items', value: `شمعة معطرة × 2 ${SHIP_MARK}` }] }],
  fee_lines: [{ id: 9200, name: `رسوم ${FEE_MARK}`, total: '10.00', meta_data: [] }],
  coupon_lines: [{ id: 9300, code: 'oct10', discount: '10.00', meta_data: [{ id: 71, key: 'coupon_info', value: COUPON_MARK }] }],
  tax_lines: [{ id: 9400, rate_code: 'EG-VAT-1', label: 'VAT', tax_total: '0.00' }],
  refunds: [{ id: 9500, reason: `العميلة سلوى ${REFUND_MARK}`, total: '-10.00' }],
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
  assert.deepEqual(WOO_FALLBACK, {});
  for (const k of ['_dokan_*', 'bosta_delivery_id', 'bosta_tracking_number', 'bosta_status', 'bosta_sync_status', 'wpml_language',
    '_wc_order_attribution_source_type', '_wc_order_attribution_utm_source', '_wc_order_attribution_utm_medium', '_wc_order_attribution_utm_campaign']) {
    assert.ok(META_KEEP.includes(k), k);
  }
  assert.equal(META_KEEP.length, 10);
});

test('the test status map matches the 0007 reseed and the 0009 rename (names, slugs, directions)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const sql9 = readFileSync(MIGRATION_0009, 'utf8');
  for (const r of MAP.filter((m) => m.system_status !== 'فشل')) {
    const slug = r.woo_status === null ? 'null' : `'${r.woo_status}'`;
    assert.match(sql, new RegExp(`\\('${r.system_status}',\\s*${slug},\\s*'${r.direction}'`), r.system_status);
  }
  // 0009: the «تم RTC» row of 0007 becomes («فشل», failed, from_woo, 10) in place — from_woo: never pushed to the site
  assert.match(sql, /\('تم RTC',\s*null,\s*'from_system',\s*6\)/);
  assert.match(sql9, /update public\.status_map\s+set system_status = 'فشل', woo_status = 'failed', direction = 'from_woo', sort = 10\s+where system_status = 'تم RTC'/);
  assert.deepEqual(MAP.filter((m) => m.direction !== 'both').map((m) => m.system_status), ['فشل']);
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
  assert.equal(normalizePhone('2012345'), '2012345'); // a bare "20" counts only on a 12-digit number
  assert.equal(normalizePhone('201012345678'), '01012345678');
  assert.equal(normalizePhone('2001200007052'), '2001200007052');
  assert.equal(normalizePhone('+20 2 2345 6789'), '0223456789'); // an explicit +20 / 0020 / 00 20 is stripped whatever follows (landline)
  assert.equal(normalizePhone('0020 2 2345 6789'), '0223456789');
  assert.equal(normalizePhone('00 20 120 000 7052'), '01200007052');
  assert.equal(normalizePhone('(+20) 120 000 7052'), '01200007052');
  assert.equal(normalizePhone('+٢٠ ١٢٠ ٠٠٠ ٧٠٥٢'), '01200007052');
  assert.equal(normalizePhone('+20'), null);
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

test('incomingStatus: failed → فشل (its own row since 0009); without that row it is unknown (no fallback any more)', () => {
  assert.deepEqual(incomingStatus('failed', null, MAP), { status: 'فشل', result: 'ok' });
  assert.deepEqual(incomingStatus('failed', 'جاري التنفيذ', MAP), { status: 'فشل', result: 'ok' });
  const noFailed = MAP.filter((r) => r.woo_status !== 'failed');
  assert.deepEqual(incomingStatus('failed', 'جاري التنفيذ', noFailed), { status: 'جاري التنفيذ', result: 'conflict' });
  assert.deepEqual(incomingStatus('failed', null, noFailed), { status: 'قيد الانتظار', result: 'conflict' });
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
  // the team set a from_system status: whatever Woo sends next does not overwrite it
  assert.deepEqual(incomingStatus('in-shipping', TEAM, TEAM_MAP), { status: TEAM, result: 'unchanged' });
  assert.deepEqual(incomingStatus('completed', TEAM, TEAM_MAP), { status: TEAM, result: 'unchanged' });
  assert.deepEqual(incomingStatus('failed', TEAM, TEAM_MAP), { status: TEAM, result: 'unchanged' });
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

test('incomingStatus: Woo’s slug equal to the stored woo_status (Woo did not change it) keeps the current status → unchanged', () => {
  // the team set «جاهز للشحن» while Woo still says processing: a delivery about anything else does not revert it
  assert.deepEqual(incomingStatus('processing', 'جاهز للشحن', MAP, 'processing'), { status: 'جاهز للشحن', result: 'unchanged' });
  assert.deepEqual(incomingStatus(' processing ', 'جاهز للشحن', MAP, 'processing'), { status: 'جاهز للشحن', result: 'unchanged' });
  assert.deepEqual(incomingStatus('weird', 'قيد الشحن', MAP, 'weird'), { status: 'قيد الشحن', result: 'unchanged' }, 'an unknown slug Woo keeps sending is not a new conflict');
  // a real change in Woo still applies
  assert.deepEqual(incomingStatus('completed', 'جاهز للشحن', MAP, 'processing'), { status: 'مكتمل', result: 'ok' });
  assert.deepEqual(incomingStatus('failed', 'جاهز للشحن', MAP, 'processing'), { status: 'فشل', result: 'ok' });
  // no current status (a new order) → the map decides
  assert.deepEqual(incomingStatus('processing', null, MAP, 'processing'), { status: 'جاري التنفيذ', result: 'ok' });
  // no stored slug (the 4th argument omitted, null or empty) → the rules as before
  assert.deepEqual(incomingStatus('processing', 'جاهز للشحن', MAP), { status: 'جاري التنفيذ', result: 'ok' });
  assert.deepEqual(incomingStatus('processing', 'جاهز للشحن', MAP, null), { status: 'جاري التنفيذ', result: 'ok' });
  assert.deepEqual(incomingStatus('', 'قيد الشحن', MAP, ''), { status: 'قيد الشحن', result: 'conflict' }, 'two empty slugs are not "unchanged"');
  // from_system still wins
  assert.deepEqual(incomingStatus('completed', TEAM, TEAM_MAP, 'processing'), { status: TEAM, result: 'unchanged' });
});

test('mapOrder: ctx.currentWooStatus = the incoming slug → the stored status stays (unchanged)', () => {
  const ctx = { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW, currentStatus: 'جاهز للشحن' };
  let r = mapOrder(parent({ status: 'processing' }), { ...ctx, currentWooStatus: 'processing' });
  assert.deepEqual([r.order.status, r.order.woo_status, r.statusResult], ['جاهز للشحن', 'processing', 'unchanged']);
  r = mapOrder(parent({ status: 'completed' }), { ...ctx, currentWooStatus: 'processing' });
  assert.deepEqual([r.order.status, r.order.woo_status, r.statusResult], ['مكتمل', 'completed', 'ok']);
  r = mapOrder(parent({ status: 'processing' }), ctx);
  assert.deepEqual([r.order.status, r.statusResult], ['جاري التنفيذ', 'ok'], 'without currentWooStatus: as before');
});

test('outgoingWooStatus: slug for both / from_system rows with a slug, else null', () => {
  assert.equal(outgoingWooStatus(TEAM, TEAM_MAP), null);
  assert.equal(outgoingWooStatus('فشل', MAP), null); // from_woo: a «فشل» set in the system is never pushed
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
  assert.deepEqual(Object.keys(r.order).sort(), ['currency', 'customer_address', 'customer_city', 'customer_name', 'customer_note', 'customer_phone', 'customer_state', 'id', 'note',
    'number', 'payment_method', 'payment_title', 'placed_at', 'raw', 'status', 'synced_at', 'total', 'woo_status', 'woo_updated_at']);
  const { raw, ...row } = r.order;
  assert.deepEqual(row, {
    id: 181668, number: '181668', customer_name: 'سلوى زيتوني', customer_phone: '01200007052', customer_city: 'القاهرة',
    customer_address: `${STREET} ${FLAT}`, customer_state: 'EGC', payment_method: 'cod', payment_title: 'الدفع عند الاستلام', status: 'جاري التنفيذ',
    woo_status: 'processing', total: 1052, currency: 'EGP', customer_note: 'اتصلي قبل التوصيل', note: 'اتصلي قبل التوصيل',
    placed_at: '2026-10-19T09:12:00Z', woo_updated_at: '2026-10-19T10:00:00Z', synced_at: NOW,
  });
  assert.equal(r.statusResult, 'ok');
  assert.deepEqual(r.unknownVendorIds, []);
  assert.deepEqual(input, before);
});

test('mapOrder: raw is an allow-list — listed scalars, place fields of billing/shipping, fixed line fields', () => {
  const input = parent();
  const { order, items } = mapOrder(input, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  const raw = order.raw;
  assert.deepEqual(Object.keys(raw).sort(), ['billing', 'coupon_lines', 'created_via', 'currency', 'customer_id', 'date_created_gmt', 'date_modified_gmt', 'fee_lines',
    'id', 'line_items', 'meta_data', 'number', 'parent_id', 'payment_method', 'payment_method_title', 'refunds', 'shipping', 'shipping_lines', 'status', 'tax_lines', 'total']);
  const place = ({ city, state, postcode, country }) => ({ city, state, postcode, country });
  assert.deepEqual(raw.billing, place(input.billing));
  assert.deepEqual(raw.shipping, place(input.shipping));
  assert.deepEqual(raw.shipping_lines, [{ id: 9100, method_id: 'flat_rate', method_title: 'شحن', total: '50.00' }]);
  assert.equal(raw.shipping_lines[0].method_title, 'شحن');
  assert.deepEqual(raw.fee_lines, [{ id: 9200, total: '10.00' }]);
  assert.deepEqual(raw.coupon_lines, [{ id: 9300, code: 'oct10', discount: '10.00' }]);
  assert.deepEqual(raw.tax_lines, [{ id: 9400, rate_code: 'EG-VAT-1', tax_total: '0.00' }]);
  assert.deepEqual(raw.refunds, [{ id: 9500, total: '-10.00' }]);
  assert.equal(raw.id, 181668);
  assert.equal(raw.status, 'processing');
  noPII(raw, 'order.raw');
  for (const i of items) noPII(i.raw, 'item.raw');
});

test('mapOrder: an unexpected object under a listed key is not copied; nothing aliases the input', () => {
  const input = parent({ cart_hash: { phone: PHONE }, total_tax: '0.00' });
  const { order, items } = mapOrder(input, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal('cart_hash' in order.raw, false);
  assert.equal(order.raw.total_tax, '0.00');
  order.raw.meta_data[0].value = 'changed'; items[0].raw.meta_data[0].value = 'changed';
  assert.equal(input.meta_data[0].value, 'BD-TEST-1');
  assert.equal(input.line_items[0].meta_data[0].value, '77');
  // a kept meta value that is an object is a copy, not the input's object
  const deep = parent();
  deep.meta_data.push({ id: 80, key: '_dokan_shipping_info', value: { zone: 'cairo' } });
  const kept = mapOrder(deep, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW }).order.raw.meta_data.find((m) => m.key === '_dokan_shipping_info');
  kept.value.zone = 'changed';
  assert.equal(deep.meta_data.at(-1).value.zone, 'cairo');
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

test('mapOrder / mapSubOrder: an object value under a kept meta key is PII-redacted; scalars stay as they are', () => {
  const objMeta = (id) => ({ id, key: '_dokan_commission_meta', value: { note: META_MARK, rate: 40, nested: { phone: META_PHONE }, list: [{ email: META_EMAIL, n: 1 }] } });
  const redacted = { note: R, rate: 40, nested: { phone: R }, list: [{ email: R, n: 1 }] };
  const p = singleVendor();
  p.meta_data.push(objMeta(90));
  p.line_items[0].meta_data = [{ id: 91, key: '_dokan_vendor_id', value: '2376' }, objMeta(92)];
  const before = structuredClone(p);
  const { order, items } = mapOrder(p, { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  const kept = order.raw.meta_data.find((m) => m.key === '_dokan_commission_meta');
  assert.deepEqual(kept, { id: 90, key: '_dokan_commission_meta', value: redacted });
  assert.equal(kept.value.rate, 40);
  assert.deepEqual(order.raw.meta_data.find((m) => m.key === '_dokan_vendor_id'), { id: 30, key: '_dokan_vendor_id', value: '2376' });
  assert.equal(order.raw.meta_data.find((m) => m.key === 'bosta_tracking_number').value, '7000000001');
  assert.deepEqual(order.raw.line_items[0].meta_data, [{ id: 91, key: '_dokan_vendor_id', value: '2376' }, { id: 92, key: '_dokan_commission_meta', value: redacted }]);
  assert.deepEqual(items[0].raw.meta_data, [{ id: 91, key: '_dokan_vendor_id', value: '2376' }, { id: 92, key: '_dokan_commission_meta', value: redacted }]);
  noPII(order.raw, 'order.raw');
  for (const i of items) noPII(i.raw, 'item.raw');
  const s = mapSubOrder(sub([objMeta(93)]), { vendorsByWooId: VENDORS }).sub;
  assert.deepEqual(s.raw.meta_data.find((m) => m.key === '_dokan_commission_meta').value, redacted);
  assert.deepEqual(s.raw.meta_data.find((m) => m.key === '_dokan_vendor_id'), { id: 40, key: '_dokan_vendor_id', value: '77' });
  noPII(s.raw, 'sub.raw');
  assert.deepEqual(p, before);
});

test('mapOrder: raw.line_items keep only the line id and its _dokan_* meta', () => {
  const { order } = mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.deepEqual(order.raw.line_items, [{ id: 9001, meta_data: [{ id: 1, key: '_dokan_vendor_id', value: '77' }] }]);
});

test('mapOrder: line items → order_items rows (vendor from the line meta)', () => {
  const r = mapOrder(parent(), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW });
  assert.equal(r.items.length, 1);
  const { raw, ...item } = r.items[0];
  assert.deepEqual(item, { id: 9001, order_id: 181668, product_id: 501, sku: 'SC-12', name: 'شمعة معطرة', qty: 2, total: 1002, vendor_id: VENDORS[77],
    commission_rate: null, commission_fee: null });
  assert.deepEqual(raw, { id: 9001, product_id: 501, variation_id: 0, name: 'شمعة معطرة', sku: 'SC-12', quantity: 2, price: 501, subtotal: '1002.00', total: '1002.00',
    meta_data: [{ id: 1, key: '_dokan_vendor_id', value: '77' }] });
  noPII(raw, 'item.raw');
});

test('mapOrder: commission_rate / commission_fee = the line\'s _dokan_commission_rate / _dokan_additional_fee as numbers; \'\' or absent → null (0011)', () => {
  const withMeta = (meta) => { const p = parent(); p.line_items[0].meta_data = [{ id: 1, key: '_dokan_vendor_id', value: '77' }, ...meta]; return p; };
  const fields = (meta) => {
    const { commission_rate, commission_fee } = mapOrder(withMeta(meta), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW }).items[0];
    return [commission_rate, commission_fee];
  };
  // the live shapes (26 Oct): rate '35' … '50' as strings, the fee '' or 0
  assert.deepEqual(fields([{ id: 2, key: '_dokan_commission_rate', value: '35' }, { id: 3, key: '_dokan_additional_fee', value: '' }]), [35, null]);
  assert.deepEqual(fields([{ id: 2, key: '_dokan_commission_rate', value: '40' }, { id: 3, key: '_dokan_additional_fee', value: '10' }]), [40, 10]);
  assert.deepEqual(fields([{ id: 2, key: '_dokan_commission_rate', value: 45.5 }, { id: 3, key: '_dokan_additional_fee', value: 0 }]), [45.5, 0]);
  assert.deepEqual(fields([{ id: 2, key: '_dokan_commission_rate', value: 'n/a' }, { id: 3, key: '_dokan_additional_fee', value: ' ' }]), [null, null]);
  assert.deepEqual(fields([{ id: 2, key: '_dokan_commission_type', value: 'fixed' }]), [null, null]);
  assert.deepEqual(fields([]), [null, null]);
  // the meta stays in raw as well (the backfill of 0011 reads it there for older lines)
  const { raw } = mapOrder(withMeta([{ id: 2, key: '_dokan_commission_rate', value: '35' }]), { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW }).items[0];
  assert.deepEqual(raw.meta_data.map((m) => m.key), ['_dokan_vendor_id', '_dokan_commission_rate']);
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
  assert.equal(rb.order.note, null, 'no website note → no comment');
  assert.equal(mapOrder(parent({ customer_note: '  رني قبل ما تيجي  ' }), { statusMap: MAP, now: NOW }).order.note, 'رني قبل ما تيجي', 'trimmed like customer_note');
  const empty = mapOrder(parent({ billing: {}, shipping: {} }), { statusMap: MAP, now: NOW }).order;
  assert.equal(empty.customer_name, '');
  assert.equal(empty.customer_phone, null);
});

test('mapOrder: customer_state = the site\'s governorate code, shipping first then billing (like city / address), trimmed, else null', () => {
  const at = (billing, shipping) => mapOrder(parent({ billing, shipping }), { statusMap: MAP, now: NOW }).order.customer_state;
  assert.equal(at({ state: 'EG-02' }, { state: 'EG-01' }), 'EG-01', 'shipping wins');
  assert.equal(at({ state: 'EG-02' }, { state: '' }), 'EG-02', 'empty shipping → billing');
  assert.equal(at({ state: 'EG-02' }, { state: '   ' }), 'EG-02', 'blank shipping → billing');
  assert.equal(at({ state: 'EG-02' }, {}), 'EG-02', 'no shipping state → billing');
  assert.equal(at({ state: ' EG-03 ' }, null), 'EG-03', 'no shipping object; trimmed');
  assert.equal(at({ state: '' }, { state: '' }), null);
  assert.equal(at({}, {}), null);
  assert.equal(at({ state: null }, { state: undefined }), null);
  assert.equal(at({ state: { code: 'EG-01' } }, { state: ['EG-01'] }), null, 'an object / array is not a code');
  assert.equal(mapOrder(parent({ billing: undefined, shipping: undefined }), { statusMap: MAP, now: NOW }).order.customer_state, null);
  // raw keeps both codes as before (RAW_ADDRESS): the 0010 backfill reads them there.
  const { raw } = mapOrder(parent({ billing: { state: 'EG-02' }, shipping: { state: 'EG-01' } }), { statusMap: MAP, now: NOW }).order;
  assert.deepEqual([raw.shipping.state, raw.billing.state], ['EG-01', 'EG-02']);
});

test('mapOrder: the status goes through incomingStatus with the current DB status', () => {
  const ctx = { statusMap: MAP, vendorsByWooId: VENDORS, now: NOW };
  let r = mapOrder(parent({ status: 'on-hold' }), { ...ctx, currentStatus: 'جاري التنفيذ' });
  assert.equal(r.order.status, 'معلّق'); assert.equal(r.statusResult, 'ok'); assert.equal(r.order.woo_status, 'on-hold');
  r = mapOrder(parent({ status: 'processing' }), { ...ctx, statusMap: TEAM_MAP, currentStatus: TEAM });
  assert.equal(r.order.status, TEAM); assert.equal(r.statusResult, 'unchanged');
  r = mapOrder(parent({ status: 'weird' }), { ...ctx, currentStatus: 'قيد الشحن' });
  assert.equal(r.order.status, 'قيد الشحن'); assert.equal(r.statusResult, 'conflict');
  r = mapOrder(parent({ status: 'failed' }), ctx);
  assert.equal(r.order.status, 'فشل'); assert.equal(r.statusResult, 'ok');
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

test('mapOrder: invalid payloads skip; a null ctx is {}', () => {
  const invalid = { skipped: 'invalid', order: null, items: [], unknownVendorIds: [], statusResult: null };
  assert.deepEqual(mapOrder(undefined), invalid);
  assert.deepEqual(mapOrder({}), invalid);
  assert.deepEqual(mapOrder('{"id":1}', {}), invalid);
  assert.deepEqual(mapOrder(parent({ id: 'abc' }), { statusMap: MAP }), invalid);
  assert.deepEqual(mapOrder(parent({ date_created_gmt: null }), { statusMap: MAP }), invalid);
  assert.deepEqual(mapOrder(parent({ date_created_gmt: 'yesterday' }), { statusMap: MAP }), invalid);
  const r = mapOrder(parent(), null);
  assert.equal(r.skipped, undefined);
  assert.equal(r.order.status, 'قيد الانتظار'); // empty map: no row for 'processing' → the default, as a conflict
  assert.equal(r.statusResult, 'conflict');
  assert.equal(r.items[0].vendor_id, null);
  assert.deepEqual(r.unknownVendorIds, [77]);
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
  assert.deepEqual(raw.billing, { city: 'القاهرة', state: 'EGC', postcode: '11511', country: 'EG' });
  assert.deepEqual(raw.refunds, [{ id: 9500, total: '-10.00' }]);
  assert.equal(raw.parent_id, 181668);
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

test('mapSubOrder: invalid payloads skip; a null ctx is {}', () => {
  const invalid = { skipped: 'invalid', sub: null, unknownVendorIds: [] };
  assert.deepEqual(mapSubOrder(undefined), invalid);
  assert.deepEqual(mapSubOrder({}), invalid);
  assert.deepEqual(mapSubOrder(sub([], { parent_id: 0 }), { vendorsByWooId: VENDORS }), invalid);
  assert.deepEqual(mapSubOrder(sub([], { id: null }), { vendorsByWooId: VENDORS }), invalid);
  const r = mapSubOrder(sub(), null);
  assert.equal(r.skipped, undefined);
  assert.equal(r.sub.woo_order_id, 181700);
  assert.deepEqual(r.unknownVendorIds, [77]);
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
  assert.deepEqual(Object.keys(v).sort(), ['address', 'address_parts', 'banner_url', 'commission', 'contact_name', 'email', 'joined_at', 'logo_url', 'name', 'phone', 'raw', 'social', 'status', 'woo_payment_methods', 'woo_vendor_id']);
  assert.deepEqual({ ...v, raw: undefined }, {
    woo_vendor_id: 2376, name: 'ورشة التجربة', phone: '01111111111', email: null, status: 'active', joined_at: '2025-01-02', raw: undefined,
    contact_name: 'منى تجربة', address_parts: { street_1: 'شارع الورشة 7', street_2: '', city: 'القاهرة', state: 'EGC', zip: '', country: 'EG' }, address: 'شارع الورشة 7، القاهرة، EGC',
    social: { fb: 'https://facebook.example/maker', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' },
    logo_url: 'https://stage.example.test/g.jpg', banner_url: 'https://stage.example.test/banner.jpg', woo_payment_methods: [],
    commission: { type: null, rate: null, flat: null, categories: [] },
  });
  assert.deepEqual(v.raw, { id: 2376, store_name: 'ورشة التجربة', shop_url: 'https://stage.example.test/store/test/', rating: { rating: '4.5', count: 2 },
    enabled: true, registered: '2025-01-02 10:00:00', featured: false, trusted: true });
  const s = JSON.stringify(v.raw);
  for (const pii of ['maker.test@example.com', '01111111111', 'شارع الورشة 7', '000111222', 'منى', 'facebook.example', 'banner.jpg', 'g.jpg']) assert.ok(!s.includes(pii), pii);
  assert.ok(!JSON.stringify(v).includes('000111222') && !JSON.stringify(v).includes('ac_name'), 'payment (bank account) is never read');
  assert.deepEqual(input, before);
});

test('mapStore: enabled:false → inactive, enabled absent / null → active (Dokan\'s public REST omits it); email only when shown', () => {
  assert.equal(mapStore(store({ enabled: false })).status, 'inactive');
  for (const off of ['0', 'no', 0, false, '', 'false']) {
    assert.equal(mapStore(store({ enabled: off })).status, 'inactive', String(off));
    assert.equal(mapStore(store({ show_email: off })).email, null, String(off));
  }
  for (const unknown of [undefined, null]) {
    assert.equal(mapStore(store({ enabled: unknown })).status, 'active', String(unknown));
    assert.equal(mapStore(store({ show_email: unknown })).email, null, String(unknown));
  }
  const { enabled: _omitted, ...noFlag } = store();
  assert.equal(mapStore(noFlag).status, 'active', 'no enabled key at all');
  assert.ok(!('enabled' in mapStore(noFlag).raw), 'raw carries no enabled when Dokan sent none');
  for (const on of [true, 1, '1', 'yes', 'true']) {
    assert.equal(mapStore(store({ enabled: on })).status, 'active', String(on));
    assert.equal(mapStore(store({ show_email: on })).email, 'maker.test@example.com', String(on));
  }
  assert.deepEqual(mapStore(store({ rating: { rating: '5', count: 1, reviewer: { email: 'x@example.com' } } })).raw.rating, { rating: '5', count: 1 });
  assert.equal(mapStore(store({ show_email: true })).email, 'maker.test@example.com');
  assert.equal(mapStore(store({ show_email: true, email: '' })).email, null);
  assert.equal(mapStore(store({ phone: '' })).phone, null);
  assert.equal(mapStore(store({ id: '77', store_name: '' })).woo_vendor_id, 77);
  assert.equal(mapStore(store({ id: '77', store_name: '  ' })).name, '#77'); // vendors.name is not null
});

test('mapStore: joined_at = the date part of `registered` (a local datetime, never shifted by a zone); absent / blank / not a real date → null (0011)', () => {
  assert.equal(mapStore(store()).joined_at, '2025-01-02');
  assert.equal(mapStore(store({ registered: '2025-01-02 23:59:59' })).joined_at, '2025-01-02');
  assert.equal(mapStore(store({ registered: '2025-03-04T08:00:00' })).joined_at, '2025-03-04');
  assert.equal(mapStore(store({ registered: '2025-03-04' })).joined_at, '2025-03-04');
  assert.equal(mapStore(store({ registered: '2024-02-29 00:00:00' })).joined_at, '2024-02-29');
  for (const bad of ['', '  ', null, undefined, 'yesterday', '2025-02-30 10:00:00', '2025-13-01', '25-01-02', '2025-01-0210:00:00', 20250102, { date: '2025-01-02' }]) {
    assert.equal(mapStore(store({ registered: bad })).joined_at, null, String(bad));
  }
  const { registered: _omitted, ...noDate } = store();
  assert.equal(mapStore(noDate).joined_at, null, 'no registered key at all');
  assert.ok(!('registered' in mapStore(noDate).raw), 'raw carries no registered when Dokan sent none');
});

// ---------------------------------------------------------------- mapProduct (woo-write.js)

const product = (over = {}) => ({
  id: 501, name: 'شمعة معطرة', sku: 'SC-12', status: 'publish', price: '501', permalink: 'https://stage.example.test/product/sc-12/',
  images: [{ id: 1, src: 'https://stage.example.test/sc-12.jpg' }], store: { id: 77, shop_name: 'متجر التجربة', name: 'منى تجربة' },
  ...over,
});

test('mapProduct: the products row carries permalink (the product page on the site); raw keeps it too', () => {
  const r = mapProduct(product(), new Map([[77, U77]]));
  assert.deepEqual(Object.keys(r.product).sort(), ['id', 'image_url', 'name', 'permalink', 'price', 'raw', 'sku', 'status', 'vendor_id']);
  assert.deepEqual({ ...r.product, raw: undefined }, { id: 501, sku: 'SC-12', name: 'شمعة معطرة', image_url: 'https://stage.example.test/sc-12.jpg',
    permalink: 'https://stage.example.test/product/sc-12/', vendor_id: U77, price: 501, status: 'publish', raw: undefined });
  assert.equal(r.product.raw.permalink, 'https://stage.example.test/product/sc-12/');
});

test('mapProduct: permalink only when it is an https:// URL (trimmed), else null', () => {
  const link = (permalink) => mapProduct(product({ permalink }), new Map()).product.permalink;
  assert.equal(link('  https://stage.example.test/product/sc-12/ '), 'https://stage.example.test/product/sc-12/');
  assert.equal(link('https://stage.example.test/?p=501'), 'https://stage.example.test/?p=501');
  for (const bad of ['http://stage.example.test/product/sc-12/', 'javascript:alert(1)', '//stage.example.test/product/sc-12/', '/product/sc-12/',
    'HTTPS://stage.example.test/product/sc-12/', ' ', '', null, undefined, 501, { href: 'https://stage.example.test/' }, ['https://stage.example.test/']]) {
    assert.equal(link(bad), null, JSON.stringify(bad) ?? String(bad));
  }
  const { permalink: _none, ...noLink } = product();
  assert.equal(mapProduct(noLink, new Map()).product.permalink, null, 'no permalink key at all');
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

test('nextCursor: no usable dates → the previous cursor, in the same UTC form', () => {
  assert.equal(nextCursor('2026-10-18T00:00:00Z', []), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00Z', undefined), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00Z', [{ date_modified_gmt: null }, { date_modified_gmt: 'not a date' }, {}]), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00', []), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T03:00:00+03:00', []), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-18T00:00:00.000Z', []), '2026-10-18T00:00:00Z');
  assert.equal(nextCursor('2026-10-21T03:00:00+03:00', [{ date_modified_gmt: '2026-10-20T08:30:15' }]), '2026-10-21T00:00:00Z');
  assert.equal(nextCursor('garbage', []), null);
  assert.equal(nextCursor(null, []), null);
});

// ---------------------------------------------------------------- phase 3.3: the full store, the snapshot, the diff, the commission

const fullStore = (over = {}) => store({
  first_name: ' منى ', last_name: 'تجربة ', show_email: true, address: { street_1: ' شارع الورشة 7 ', street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG', extra: 'x' },
  social: { fb: 'https://facebook.example/maker', instagram: 'https://instagram.example/maker', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '', tiktok: 'https://tiktok.example/nope' },
  gravatar: 'https://stage.example.test/g.jpg', banner: 'http://stage.example.test/banner.jpg', active_payment_methods: { bank: { ac_name: 'منى' }, paypal: { email: 'p@example.com' } },
  admin_commission_type: 'fixed', admin_commission: '30', admin_additional_fee: '', admin_category_commission: [],
  ...over,
});

test('mapStore (3.3): contact_name, the six address keys, the eight social keys, https-only logo / banner, the payment method names, the commission; nothing of `payment` / `location`', () => {
  const v = mapStore(fullStore());
  assert.equal(v.contact_name, 'منى تجربة');
  assert.equal(v.email, 'maker.test@example.com');
  assert.deepEqual(v.address_parts, { street_1: 'شارع الورشة 7', street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG' });
  assert.equal(v.address, 'شارع الورشة 7، القاهرة، EG-01');
  assert.deepEqual(Object.keys(v.social), SOCIAL_KEYS);
  assert.deepEqual([v.social.fb, v.social.instagram, 'tiktok' in v.social], ['https://facebook.example/maker', 'https://instagram.example/maker', false]);
  assert.deepEqual([v.logo_url, v.banner_url], ['https://stage.example.test/g.jpg', null]);
  assert.deepEqual(v.woo_payment_methods, ['bank', 'paypal']);
  assert.deepEqual(v.commission, { type: 'fixed', rate: 30, flat: null, categories: [] });
  assert.ok(!JSON.stringify(v).includes('ac_name') && !JSON.stringify(v).includes('p@example.com'), 'bank / PayPal data never leaves the payload');
  assert.deepEqual(ADDRESS_KEYS, ['street_1', 'street_2', 'city', 'state', 'zip', 'country']);
  // absent / odd shapes: '' keys, null name, arrays
  const bare = mapStore({ id: 7, store_name: 'x', address: 'not an object', social: null, active_payment_methods: ['bank', '', 3] });
  assert.deepEqual([bare.contact_name, bare.address, bare.woo_payment_methods, bare.logo_url], [null, null, ['bank'], null]);
  assert.deepEqual(Object.values(bare.address_parts), ['', '', '', '', '', '']);
  assert.deepEqual(mapStore({ id: 7, active_payment_methods: [] }).woo_payment_methods, []);
});

test('mapStore / storeSnapshot / toDokanStore (3.3): a social value is kept only as an https:// URL — javascript:, http://, a bare handle → \'\' (the row, the snapshot, the comparison and the PUT body alike); logo / banner the same', () => {
  const social = { fb: 'https://facebook.example/maker', instagram: 'javascript:alert(1)', twitter: 'http://twitter.example/x', youtube: ' maker.yt ', linkedin: 'HTTPS://linkedin.example/in/x', pinterest: 'https://', threads: 'data:text/html,x', flickr: '' };
  const v = mapStore(fullStore({ social, gravatar: 'javascript:alert(1)', banner: 'https://stage.example.test/b.jpg' }));
  assert.deepEqual(v.social, { fb: 'https://facebook.example/maker', instagram: '', twitter: '', youtube: '', linkedin: 'HTTPS://linkedin.example/in/x', pinterest: '', threads: '', flickr: '' });
  assert.deepEqual([v.logo_url, v.banner_url], [null, 'https://stage.example.test/b.jpg']);
  assert.deepEqual(storeSnapshot(v).social, v.social);
  assert.ok(!JSON.stringify(v).includes('javascript:') && !JSON.stringify(v).includes('http://twitter'));
  assert.deepEqual(toDokanStore({ social }, ['social']).body.social, v.social, 'a row holding a bad link never pushes it');
  assert.ok(sameField('social', { fb: 'javascript:x' }, null), 'a non-https value compares as empty');
});

test('addressText: the filled parts of street 1, street 2, city, state joined by «، » (zip / country left out); null when none', () => {
  assert.equal(addressText({ street_1: 'شارع 1', street_2: 'شقة 3', city: 'القاهرة', state: 'EG-01', zip: '11511', country: 'EG' }), 'شارع 1، شقة 3، القاهرة، EG-01');
  assert.equal(addressText({ street_1: '', city: ' الجيزة ' }), 'الجيزة');
  assert.equal(addressText({ zip: '1', country: 'EG' }), null);
  assert.equal(addressText(null), null);
});

test('storeSnapshot: the SYNC_FIELDS of a mapped store, rate = { rate, flat }, category_rates = the site\'s items; a deep copy', () => {
  assert.deepEqual(SYNC_FIELDS, ['name', 'phone', 'email', 'contact_name', 'address_parts', 'social', 'status', 'rate', 'category_rates']);
  const m = mapStore(fullStore({ admin_commission_type: 'category_based', admin_category_commission: { all: { percentage: '35', flat: '5' }, items: { 15: { percentage: '20', flat: '' } } } }));
  const snap = storeSnapshot(m);
  assert.deepEqual(Object.keys(snap), SYNC_FIELDS);
  assert.deepEqual([snap.name, snap.phone, snap.status, snap.rate, snap.category_rates], ['ورشة التجربة', '01111111111', 'active', { rate: 35, flat: 5 }, [{ woo_category_id: 15, rate: 20, flat: null }]]);
  snap.address_parts.city = 'changed';
  assert.equal(m.address_parts.city, 'القاهرة', 'no aliasing');
  assert.deepEqual(storeSnapshot(null).rate, { rate: null, flat: null });
});

test('sameField: trimmed strings with \'\' = null, keyed objects, leave = active, rate with no flat = 0, category lists in any order without the removed ones', () => {
  assert.ok(sameField('name', ' x ', 'x') && sameField('phone', '', null) && !sameField('name', 'x', 'y'));
  assert.ok(sameField('address_parts', { city: 'a' }, { city: 'a', zip: '', junk: 1 }) && !sameField('address_parts', { city: 'a' }, { city: 'b' }));
  assert.ok(sameField('social', null, { fb: '' }) && !sameField('social', { fb: 'https://fb.example/x' }, null));
  assert.ok(sameField('status', 'leave', 'active') && !sameField('status', 'inactive', 'leave') && sameField('status', null, 'active'));
  assert.ok(sameField('rate', { rate: 30, flat: null }, { rate: 30, flat: 0 }) && !sameField('rate', { rate: 30 }, { rate: 31 }) && !sameField('rate', { rate: 30 }, { rate: 30, flat: 2 }));
  assert.ok(sameField('category_rates', [{ woo_category_id: 2, rate: 1 }, { woo_category_id: 1, rate: 5, flat: 0 }], [{ woo_category_id: 1, rate: 5 }, { woo_category_id: 2, rate: 1 }, { woo_category_id: 3, rate: null }]));
  assert.ok(!sameField('category_rates', [{ woo_category_id: 1, rate: 5 }], []));
});

test('diffStore: the four cases of decision 3 per field, and `same` when both sides now agree whoever moved', () => {
  const snap = { name: 'A', phone: '1', email: null, contact_name: 'c', address_parts: { city: 'x' }, social: { fb: 'f' }, status: 'active', rate: { rate: 30, flat: null }, category_rates: [] };
  const site = { ...snap, name: 'A2', email: 'e@x.test', status: 'inactive', rate: { rate: 31, flat: null } };
  const system = { ...snap, phone: '2', email: 'e@x.test', status: 'leave', rate: { rate: 32, flat: null }, category_rates: [{ woo_category_id: 1, rate: 5 }] };
  // status: leave counts as active, so only the site moved (two states cannot make a `both`)
  assert.deepEqual(diffStore(snap, site, system), { name: 'site', phone: 'system', email: 'same', contact_name: 'same', address_parts: 'same', social: 'same', status: 'site', rate: 'both', category_rates: 'system' });
  // a field missing from an older snapshot reads as empty
  assert.equal(diffStore({ ...snap, phone: undefined }, { ...snap, phone: '1' }, { ...snap, phone: '1' }).phone, 'same');
  assert.equal(diffStore({ ...snap, phone: undefined }, { ...snap, phone: '1' }, { ...snap, phone: null }).phone, 'site');
});

test('diffStore: the first run (no snapshot) → fill when ours is empty, keep when equal, conflict when filled and different; status always takes the site', () => {
  const site = { name: 'A', phone: '1', email: null, contact_name: 'c', address_parts: { city: 'x' }, social: { fb: 'https://fb.example/f' }, status: 'inactive', rate: { rate: 30, flat: null }, category_rates: [{ woo_category_id: 1, rate: 5 }] };
  const system = { name: 'B', phone: '', email: null, contact_name: 'c', address_parts: null, social: { fb: 'https://fb.example/g' }, status: 'active', rate: { rate: null, flat: null }, category_rates: [] };
  assert.deepEqual(diffStore(null, site, system), { name: 'conflict', phone: 'fill', email: 'keep', contact_name: 'keep', address_parts: 'fill', social: 'conflict', status: 'fill', rate: 'fill', category_rates: 'fill' });
  assert.equal(diffStore(undefined, { ...site, status: 'active' }, { ...system, status: 'leave' }).status, 'keep');
  assert.equal(diffStore('not an object', site, {}).name, 'fill');
});

test('commissionOf: fixed / category_based (all + items, ids as integers, strings → numbers, \'\' → null) / legacy flat, percentage, combine / unknown', () => {
  assert.deepEqual(commissionOf({ admin_commission_type: 'fixed', admin_commission: '30', admin_additional_fee: '2.5' }), { type: 'fixed', rate: 30, flat: 2.5, categories: [] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'fixed', admin_commission: '', admin_additional_fee: '' }), { type: 'fixed', rate: null, flat: null, categories: [] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'category_based', admin_commission: '30', admin_category_commission: { all: { flat: '0', percentage: '35' }, items: { '16': { flat: '', percentage: '25' }, '15': { flat: '1', percentage: '20' }, 'x': { percentage: '9' }, '0': { percentage: '9' }, '17': 'junk' } } }),
    { type: 'category_based', rate: 35, flat: 0, categories: [{ woo_category_id: 15, rate: 20, flat: 1 }, { woo_category_id: 16, rate: 25, flat: null }, { woo_category_id: 17, rate: null, flat: null }] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'category_based', admin_category_commission: [] }), { type: 'category_based', rate: null, flat: null, categories: [] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'flat', admin_commission: '15' }), { type: 'flat', rate: null, flat: 15, categories: [] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'percentage', admin_commission: '15' }), { type: 'percentage', rate: 15, flat: null, categories: [] });
  assert.deepEqual(commissionOf({ admin_commission_type: 'combine', admin_commission: '15', admin_additional_fee: '3' }), { type: 'combine', rate: 15, flat: 3, categories: [] });
  assert.deepEqual(commissionOf({}), { type: null, rate: null, flat: null, categories: [] });
  assert.deepEqual(commissionOf(null), { type: null, rate: null, flat: null, categories: [] });
});

test('toDokanCommission: category rates → category_based (all + items as numeric strings, removed ones left out); none → fixed with admin_commission (+ admin_additional_fee when known); no rate → null', () => {
  assert.deepEqual(toDokanCommission({ rate: 35, flat: 5, categoryRates: [{ woo_category_id: 16, rate: 25, flat: null }, { woo_category_id: 15, rate: 20, flat: 1 }, { woo_category_id: 17, rate: null }] }),
    { admin_commission_type: 'category_based', admin_category_commission: { all: { percentage: '35', flat: '5' }, items: { 15: { percentage: '20', flat: '1' }, 16: { percentage: '25', flat: '' } } } });
  assert.deepEqual(toDokanCommission({ rate: 30 }), { admin_commission_type: 'fixed', admin_commission: '30' });
  assert.deepEqual(toDokanCommission({ rate: '30.5', flat: 0 }), { admin_commission_type: 'fixed', admin_commission: '30.5', admin_additional_fee: '0' });
  assert.equal(toDokanCommission({ rate: null, categoryRates: [{ woo_category_id: 1, rate: null }] }), null);
  assert.equal(toDokanCommission(), null);
});

test('toDokanStore: the PUT body from the row for the asked fields only; a #placeholder name is dropped; contact_name splits on the first space; status → enabled; unknown fields ignored', () => {
  const row = { name: '#2376', phone: ' 01111111111 ', email: 'm.test@example.com', contact_name: 'منى محمد تجربة', address_parts: { street_1: 'ش', city: 'القاهرة' }, social: { fb: 'https://fb.example/f', tiktok: 'https://x.example' }, status: 'leave', raw: { secret: 1 } };
  assert.deepEqual(toDokanStore(row, ['name', 'phone', 'raw', 'contact_name', 'status', 'phone']), {
    body: { phone: '01111111111', first_name: 'منى', last_name: 'محمد تجربة', enabled: true }, sent: ['phone', 'contact_name', 'status'], dropped: ['name'] });
  assert.deepEqual(toDokanStore({ ...row, name: ' ورشة ' }, ['name', 'email', 'address_parts', 'social']).body,
    { store_name: 'ورشة', email: 'm.test@example.com', address: { street_1: 'ش', street_2: '', city: 'القاهرة', state: '', zip: '', country: '' }, social: { fb: 'https://fb.example/f', instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' } });
  assert.deepEqual(toDokanStore({ status: 'inactive', contact_name: null }, ['status', 'contact_name']).body, { enabled: false, first_name: '', last_name: '' });
  assert.deepEqual(toDokanStore(row, ['rate', 'category_rates'], { rate: 30, flat: null, categoryRates: [] }), { body: { admin_commission_type: 'fixed', admin_commission: '30' }, sent: ['rate', 'category_rates'], dropped: [] });
  assert.deepEqual(toDokanStore(row, ['name'], null), { body: null, sent: [], dropped: ['name'] });
  // an empty e-mail is never sent (Dokan writes it on the WordPress user — the maker's login); alone → nothing
  assert.deepEqual(toDokanStore({ ...row, email: null }, ['email']), { body: null, sent: [], dropped: ['email'] });
  assert.deepEqual(toDokanStore({ ...row, email: '  ' }, ['email', 'phone']), { body: { phone: '01111111111' }, sent: ['phone'], dropped: ['email'] });
  assert.deepEqual(toDokanStore(null, 'phone'), { body: null, sent: [], dropped: [] });
  const before = structuredClone(row);
  toDokanStore(row, SYNC_FIELDS, { rate: 1 });
  assert.deepEqual(row, before, 'input untouched');
});
