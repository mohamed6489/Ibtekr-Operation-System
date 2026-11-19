// _shared/bosta.js — the order → a Bosta delivery the way the site's Bosta plugin (bosta-woocommerce 4.5.7) builds it (the owner
// 19 Nov, «ابعت لبوسطة» — «سيبها بالمفتاح» with the plugin's own request)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bostaKey, codOf, phoneOf, cityOf, describe, metaOf, deliveryOf, createdOf, trackingOf, BOSTA_API } from '../../supabase/functions/_shared/bosta.js';

const NAMES = { 'EG-01': 'Cairo', 'EG-25': 'Giza', 'EG-06': 'El Kalioubia' };

test('the key from the settings (Vault app_bosta = { key }); the v2 API like the plugin', () => {
  assert.equal(bostaKey({ key: ' abcdefghijklmnopqrstu ' }), 'abcdefghijklmnopqrstu');
  assert.equal(bostaKey({ key: 'short' }), null);
  assert.equal(bostaKey(null), null);
  assert.equal(BOSTA_API, 'https://app.bosta.co/api/v2');
});

test('the cash: cash on delivery = the total minus the deposit (the owner\'s rule); a paid order 0', () => {
  assert.equal(codOf({ payment_method: 'cod', total: 1500, deposit: 500 }), 1000);
  assert.equal(codOf({ payment_method: 'cod', total: 300, deposit: 500 }), 0);
  assert.equal(codOf({ payment_method: 'paymob-5394505-migs-online-vpc-egp', total: 1500, deposit: 0 }), 0);
});

test('the phone, the city, the description, the order meta', () => {
  assert.equal(phoneOf('+201001234567'), '01001234567');
  assert.equal(phoneOf('1001234567'), '01001234567');
  assert.equal(phoneOf('0020 100 123 4567'), '01001234567');
  assert.equal(phoneOf('12345'), null);
  assert.equal(cityOf('EG-06', NAMES), 'El Kalioubia');
  assert.equal(cityOf('Giza', NAMES), 'Giza');
  assert.equal(cityOf('EG-99', NAMES), '');
  assert.equal(describe([{ name: 'Lamp', qty: 2 }, { name: 'Vase', qty: 1 }]), 'Lamp x 2, Vase x 1');
  assert.equal(describe([{ name: 'x'.repeat(120), qty: 1 }, ...Array(10).fill({ name: 'y'.repeat(120), qty: 1 })]).length, 500);
  assert.equal(metaOf({ meta_data: [{ key: '_billing_area', value: 'dst-1' }] }, '_billing_area'), 'dst-1');
  assert.equal(metaOf({}, '_billing_area'), '');
});

test('the delivery body like the plugin (bosta_format_order_payload): WC_ reference, receiver from billing, district, goods value', () => {
  const order = { id: 180686, customer_name: 'منى عادل', state: 'EG-25', payment_method: 'cod', total: 1200, deposit: 200, customer_note: 'اتصل قبلها',
    raw: { billing: { first_name: 'منى', last_name: 'عادل', address_1: '12 شارع الهرم الرئيسي', address_2: 'الدور 3', phone: '01001234567', state: 'EG-25' },
      meta_data: [{ key: '_billing_area', value: 'dst-77' }, { key: '_billing_phone_2', value: '01112223334' }] } };
  const { body, error } = deliveryOf(order, [{ name: 'Lamp', qty: 2, amount: 800 }, { name: 'Vase', qty: 1, amount: 400 }], NAMES);
  assert.equal(error, undefined);
  assert.deepEqual(body, { id: 180686, type: 10, notes: 'اتصل قبلها', uniqueBusinessReference: 'WC_180686', businessReference: 'Woocommerce_180686',
    specs: { packageDetails: { itemsCount: 3, description: 'Lamp x 2, Vase x 1' } },
    receiver: { firstName: 'منى', lastName: 'عادل', phone: '01001234567', secondPhone: '01112223334' },
    dropOffAddress: { firstLine: '12 شارع الهرم الرئيسي', secondLine: 'الدور 3', city: 'Giza', districtId: 'dst-77' }, cod: 1000, goodsInfo: { amount: 1200 } });
  // the plugin's own checks (bosta_validate_order_fields)
  assert.equal(deliveryOf({ ...order, raw: { billing: { first_name: 'منى', address_1: '12 شارع الهرم الرئيسي' } } }, [], NAMES).error, 'no_phone');
  assert.equal(deliveryOf({ ...order, raw: { billing: { first_name: 'منى', phone: '01001234567' } } }, [], NAMES).error, 'no_address');
  assert.equal(deliveryOf({ ...order, raw: { billing: { first_name: 'منى', phone: '01001234567', address_1: 'قصير' } } }, [], NAMES).error, 'short_address');
  assert.equal(deliveryOf({ ...order, state: 'EG-99', raw: { billing: { first_name: 'منى', phone: '01001234567', address_1: '12 شارع الهرم الرئيسي' } } }, [], NAMES).error, 'no_city');
  // a district alone is enough (the governorate code without a name)
  assert.equal(deliveryOf({ ...order, state: 'EG-99', raw: { ...order.raw, billing: { ...order.raw.billing, state: 'EG-99' } } }, [], NAMES).body.dropOffAddress.districtId, 'dst-77');
});

test('Bosta\'s answers: the bulk create, then the tracking number', () => {
  assert.deepEqual(createdOf(200, { data: { createdDeliveriesIds: ['d1'], failedDeliveries: [] } }), { id: 'd1' });
  assert.deepEqual(createdOf(200, { data: { createdDeliveriesIds: [], failedDeliveries: [{ errors: [{ message: 'District is not valid' }] }] } }), { error: 'refused', message: 'District is not valid' });
  assert.deepEqual(createdOf(401, { message: 'Unauthorized' }), { error: 'bad_key', message: 'Unauthorized' });
  assert.deepEqual(createdOf(400, [{ message: 'Bad body' }]), { error: 'refused', message: 'Bad body' });
  assert.deepEqual(createdOf(200, {}), { error: 'bad_answer' });
  assert.deepEqual(trackingOf({ data: [{ _id: 'd1', trackingNumber: 7012345, state: { value: 'Pickup requested' } }] }, 'd1'), { tracking: '7012345', state: 'Pickup requested' });
  assert.equal(trackingOf({ data: [] }, 'd1'), null);
});
