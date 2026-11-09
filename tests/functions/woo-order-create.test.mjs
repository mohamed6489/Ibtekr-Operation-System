import { test } from 'node:test'; import assert from 'node:assert/strict';
import { CONV_META, MAX_LINES, PAY_STATUSES, orderCreateInput, orderPayable, payUrl, wooOrderBody } from '../../supabase/functions/_shared/woo-order-create.js';
// an order from the customer-service chat (phase 13 T3): the pure part of woo-sync's order_create / order_pay_link

const CUST = '00000000-0000-4000-8000-00000000c0b1'; const CONV = '00000000-0000-4000-8000-00000000d0d1';

test('orderCreateInput: the customer, 1–20 lines by product id (a variation optional), quantities 1–50, the note cut, the conversation optional', () => {
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: [{ product_id: 9001, qty: 2 }, { product_id: 9002, variation_id: 9003, qty: '1' }], note: ' يتسلم بعد 5 م \u0000 ', conversation_id: CONV }),
    { customer_id: CUST, items: [{ product_id: 9001, variation_id: null, qty: 2 }, { product_id: 9002, variation_id: 9003, qty: 1 }], note: 'يتسلم بعد 5 م', conversation_id: CONV });
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: [{ product_id: 9001 }] }).items, [{ product_id: 9001, variation_id: null, qty: 1 }], 'no quantity = 1');
  assert.deepEqual(orderCreateInput({ customer_id: 'x', items: [{ product_id: 1 }] }), { error: 'bad_request', field: 'customer_id' });
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: [] }), { error: 'bad_request', field: 'items' });
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: [{ product_id: 0 }] }), { error: 'bad_request', field: 'items' });
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: [{ product_id: 1, qty: 51 }] }), { error: 'bad_request', field: 'items' });
  assert.deepEqual(orderCreateInput({ customer_id: CUST, items: Array.from({ length: MAX_LINES + 1 }, () => ({ product_id: 1 })) }), { error: 'bad_request', field: 'items' });
  assert.equal(orderCreateInput({ customer_id: CUST, items: [{ product_id: 1 }], conversation_id: 'nope' }).conversation_id, null);
});

test('wooOrderBody: pending and unpaid, the customer as billing / shipping, the lines, the marks', () => {
  const b = wooOrderBody({ customer: { name: 'نهى عبد الرحمن', phone: '01012345678', city: 'القاهرة', address: 'شارع 9' }, items: [{ product_id: 9001, variation_id: null, qty: 2 }, { product_id: 9002, variation_id: 9003, qty: 1 }], note: 'بعد 5 م', conversationId: CONV });
  assert.deepEqual([b.status, b.set_paid, b.created_via, b.customer_note], ['pending', false, 'ibtekr-ops', 'بعد 5 م']);
  assert.deepEqual(b.billing, { first_name: 'نهى', last_name: 'عبد الرحمن', phone: '01012345678', city: 'القاهرة', state: '', address_1: 'شارع 9', address_2: '', country: 'EG' });
  assert.deepEqual(b.shipping, b.billing);
  assert.deepEqual(b.line_items, [{ product_id: 9001, quantity: 2 }, { product_id: 9002, variation_id: 9003, quantity: 1 }]);
  assert.deepEqual(b.meta_data, [{ key: '_created_by_system', value: 'ibtekr-ops' }, { key: CONV_META, value: CONV }]);
  assert.equal(wooOrderBody({ customer: { name: '' }, items: [], note: '' }).billing.first_name, 'عميل');
});

test('payUrl: WooCommerce\'s payment_url on the shop\'s host, else built from the order key; nothing without a key', () => {
  const site = 'https://staging.ibtekr.club';
  assert.equal(payUrl(site, { id: 5001, payment_url: 'https://staging.ibtekr.club/checkout/order-pay/5001/?pay_for_order=true&key=wc_order_abc123' }), 'https://staging.ibtekr.club/checkout/order-pay/5001/?pay_for_order=true&key=wc_order_abc123');
  assert.equal(payUrl(site, { id: 5001, payment_url: 'https://evil.test/pay', order_key: 'wc_order_abc123' }), 'https://staging.ibtekr.club/checkout/order-pay/5001/?pay_for_order=true&key=wc_order_abc123', 'a link off the host is rebuilt');
  assert.equal(payUrl(site, { id: 5001, order_key: 'bad key' }), null); assert.equal(payUrl('', { id: 5001, order_key: 'wc_order_abc123' }), null);
  assert.deepEqual(PAY_STATUSES, ['قيد الانتظار', 'فشل', 'معلّق']); assert.equal(orderPayable('قيد الانتظار'), true); assert.equal(orderPayable('مكتمل'), false);
});
