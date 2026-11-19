// _shared/bosta.js — the order → a Bosta delivery the way the site's Bosta plugin builds it (the owner 19 Nov, «ابعت لبوسطة»)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bostaKey, codOf, phoneOf, cityOf, deliveryOf, resultOf, splitName } from '../../supabase/functions/_shared/bosta.js';

const NAMES = { 'EG-01': 'Cairo', 'EG-25': 'Giza', 'EG-06': 'El Kalioubia' };

test('the key from the settings (Vault app_bosta = { key })', () => {
  assert.equal(bostaKey({ key: ' abcdefghijklmnopqrstu ' }), 'abcdefghijklmnopqrstu');
  assert.equal(bostaKey({ key: 'short' }), null);
  assert.equal(bostaKey(null), null);
});

test('the cash: cash on delivery = the total minus the deposit; a paid order 0', () => {
  assert.equal(codOf({ payment_method: 'cod', total: 1500, deposit: 500 }), 1000);
  assert.equal(codOf({ payment_method: 'cod', total: 300, deposit: 500 }), 0);
  assert.equal(codOf({ payment_method: 'paymob-5394505-migs-online-vpc-egp', total: 1500, deposit: 0 }), 0);
});

test('the phone, the city, the names', () => {
  assert.equal(phoneOf('+201001234567'), '01001234567');
  assert.equal(phoneOf('1001234567'), '01001234567');
  assert.equal(phoneOf('0020 100 123 4567'), '01001234567');
  assert.equal(phoneOf('12345'), null);
  assert.equal(cityOf('EG-06', NAMES), 'El Kalioubia');
  assert.equal(cityOf('Giza', NAMES), 'Giza');
  assert.equal(cityOf('EG-99', NAMES), null);
  assert.deepEqual(splitName('سارة أحمد علي'), { firstName: 'سارة', lastName: 'أحمد علي' });
  assert.deepEqual(splitName('منى'), { firstName: 'منى', lastName: 'منى' });
});

test('the delivery body like the plugin: type 10, the receiver, the drop-off address, the items, the cash', () => {
  const order = { id: 180686, customer_name: 'منى عادل', state: 'EG-25', payment_method: 'cod', total: 1200, deposit: 200, customer_note: 'اتصل قبلها',
    shipping: { first_name: 'منى', last_name: 'عادل', address_1: '12 شارع الهرم', address_2: 'الدور 3', phone: '' }, billing: { phone: '01001234567' } };
  const { body, error } = deliveryOf(order, [{ name: 'Lamp', qty: 2 }, { name: 'Vase', qty: 1 }], NAMES);
  assert.equal(error, undefined);
  assert.deepEqual(body, { type: 10, specs: { packageDetails: { itemsCount: 3, description: 'Products: Lamp(2) Vase(1)' } },
    receiver: { firstName: 'منى', lastName: 'عادل', phone: '01001234567' }, dropOffAddress: { firstLine: '12 شارع الهرم', city: 'Giza', secondLine: 'الدور 3' },
    businessReference: 'IB-180686', cod: 1000, notes: 'اتصل قبلها' });
  assert.equal(deliveryOf({ ...order, billing: {}, shipping: { address_1: 'x' } }, [], NAMES).error, 'no_phone');
  assert.equal(deliveryOf({ ...order, shipping: { phone: '01001234567' }, billing: {} }, [], NAMES).error, 'no_address');
  assert.equal(deliveryOf({ ...order, state: 'EG-99' }, [], NAMES).error, 'no_city');
});

test('Bosta\'s answer', () => {
  assert.deepEqual(resultOf(201, { _id: 'd1', trackingNumber: 7012345, state: { value: 'Pickup requested' } }), { tracking: '7012345', state: 'Pickup requested', id: 'd1' });
  assert.deepEqual(resultOf(201, { data: { _id: 'd2', trackingNumber: '70', state: { value: 'Created' } } }), { tracking: '70', state: 'Created', id: 'd2' });
  assert.deepEqual(resultOf(401, { message: 'Unauthorized' }), { error: 'bad_key', message: 'Unauthorized' });
  assert.deepEqual(resultOf(400, [{ message: 'City is not valid' }]), { error: 'refused', message: 'City is not valid' });
  assert.deepEqual(resultOf(201, {}), { error: 'bad_answer' });
});
