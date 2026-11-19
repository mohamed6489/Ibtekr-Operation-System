// _shared/bosta.js — the order → a Bosta delivery the way the site's Bosta plugin (bosta-woocommerce 4.5.7) builds it (the owner
// 19 Nov, «ابعت لبوسطة» — «سيبها بالمفتاح» with the plugin's own request)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bostaKey, codOf, phoneOf, cityOf, describe, metaOf, deliveryOf, createdOf, foundOf, trackingOf, zonesOf, addressInputOf, siteAddressOf, BOSTA_API } from '../../supabase/functions/_shared/bosta.js';

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
  // the created ids as data itself (the plugin's `?? $data` — a pickup's warehouse waybill came back like this live, 19 Nov)
  assert.deepEqual(createdOf(200, { data: ['dA'] }), { id: 'dA' });
  assert.deepEqual(createdOf(200, { data: [{ _id: 'dB' }] }), { id: 'dB' });
  assert.deepEqual(createdOf(200, { data: {} }), { error: 'bad_answer' });
  // the lookup by businessReference when the answer could not be read
  const found = { data: { count: 2, deliveries: [{ _id: 'x1', businessReference: 'Ibtekr_pickup_4-1', trackingNumber: 3880002744, state: { value: 'Pickup requested' } }, { _id: 'x2', businessReference: 'Woocommerce_9' }] } };
  assert.deepEqual(foundOf(found, 'Ibtekr_pickup_4-1'), { id: 'x1', tracking: '3880002744', state: 'Pickup requested' });
  assert.deepEqual(foundOf(found, 'Woocommerce_9'), { id: 'x2', tracking: null, state: null });
  assert.equal(foundOf(found, 'Ibtekr_pickup_5-1'), null);
  assert.equal(foundOf(null, 'x'), null);
  assert.deepEqual(createdOf(200, { data: { createdDeliveriesIds: [], failedDeliveries: [{ errors: [{ message: 'District is not valid' }] }] } }), { error: 'refused', message: 'District is not valid' });
  assert.deepEqual(createdOf(401, { message: 'Unauthorized' }), { error: 'bad_key', message: 'Unauthorized' });
  assert.deepEqual(createdOf(400, [{ message: 'Bad body' }]), { error: 'refused', message: 'Bad body' });
  assert.deepEqual(createdOf(200, {}), { error: 'bad_answer' });
  assert.deepEqual(trackingOf({ data: [{ _id: 'd1', trackingNumber: 7012345, state: { value: 'Pickup requested' } }] }, 'd1'), { tracking: '7012345', state: 'Pickup requested' });
  assert.equal(trackingOf({ data: [] }, 'd1'), null);
});

// ---- 0144: the cash follows the deposit, the waybill printed here, a pickup from the maker ----
import { updateOf, editedOf, awbPath, awbOf, locationsOf, addressOf, pickupInputOf, pickupDeliveryOf, pickupBodyOf, pickupMadeOf, orderIdsOf, SLOTS } from '../../supabase/functions/_shared/bosta.js';

test('the edit of a delivery = the plugin\'s update with the cash (from the same body)', () => {
  const order = { id: 9, customer_name: 'منى عادل', state: 'EG-25', payment_method: 'cod', total: 1200, deposit: 500,
    raw: { billing: { first_name: 'منى', last_name: 'عادل', address_1: '12 شارع الهرم الرئيسي', phone: '01001234567' }, meta_data: [{ key: '_billing_phone_2', value: '01112223334' }] } };
  const u = updateOf(deliveryOf(order, [{ name: 'Lamp', qty: 1, amount: 1200 }], NAMES).body);
  assert.deepEqual(u.receiver, { fullName: 'منى عادل', phone: '01001234567', secondPhone: '01112223334' });
  assert.equal(u.cod, 700);
  assert.equal(u.dropOffAddress.city, 'Giza');
  assert.equal('uniqueBusinessReference' in u, false);
  assert.deepEqual(editedOf(200, { success: true }), { ok: true });
  assert.deepEqual(editedOf(400, { success: false, message: 'Delivery can not be updated in its current state' }), { error: 'refused', message: 'Delivery can not be updated in its current state' });
  assert.equal(editedOf(401, {}).error, 'bad_key');
  assert.equal(editedOf(404, {}).error, 'gone');
});

test('the waybill: mass-awb of the delivery ids, the PDF in base64', () => {
  assert.equal(awbPath(['a1', 'b_2', 'a1', 'bad id', 7]), '/deliveries/mass-awb?ids=a1,b_2&lang=ar');
  assert.equal(awbPath([]), null);
  assert.deepEqual(awbOf(200, { data: 'JVBERi0xLjQK' }), { pdf: 'JVBERi0xLjQK' });
  assert.deepEqual(awbOf(200, { data: '<html>' }), { error: 'bad_answer' });
  assert.equal(awbOf(401, {}).error, 'bad_key');
});

test('the pickup locations, the warehouse address, the pickup input', () => {
  const locs = locationsOf({ data: { total: 1, list: [{ _id: 'LpEaJKhS9', locationName: 'مكتب فيصل', isDefault: true,
    address: { city: { name: 'Giza', nameAr: 'الجيزه' }, district: { _id: 'xU1', name: 'Tawabek', nameAr: 'طوابق' }, firstLine: 'طلعت عبد الدايم - فيصل', secondLine: 'امام جزارة', buildingNumber: '10', floor: '1', apartment: '1' },
    contactPerson: { name: 'أحمد', phone: '+201001112223' } }, { _id: 'bad id' }] } });
  assert.equal(locs.length, 1);
  assert.deepEqual(locs[0], { id: 'LpEaJKhS9', name: 'مكتب فيصل', city: 'الجيزه', cityEn: 'Giza', district: 'طوابق', districtId: 'xU1', firstLine: 'طلعت عبد الدايم - فيصل', secondLine: 'امام جزارة', building: '10', floor: '1', apartment: '1', contact: 'أحمد', phone: '01001112223', isDefault: true });
  assert.deepEqual(addressOf(locs[0]), { firstLine: 'طلعت عبد الدايم - فيصل', secondLine: 'امام جزارة', city: 'Giza', districtId: 'xU1', buildingNumber: '10', floor: '1', apartment: '1' });
  const ok = { location: 'Zaan01', date: '2026-11-20', slot: SLOTS[0], receiver: 'مدير التشغيل', phone: '01001112223', note: 'كرتونتين', parcels: 2 };
  // the old one-row shape = one warehouse row
  assert.deepEqual(pickupInputOf(ok, '2026-11-19').ok, { location: 'Zaan01', date: '2026-11-20', slot: SLOTS[0], receiver: 'مدير التشغيل', phone: '01001112223', rows: [{ note: 'كرتونتين', parcels: 2 }], orders: [] });
  assert.equal(pickupInputOf({ ...ok, date: '2026-11-18' }, '2026-11-19').error, 'date');
  assert.equal(pickupInputOf({ ...ok, date: '2027-01-30' }, '2026-11-19').error, 'date');
  assert.equal(pickupInputOf({ ...ok, slot: '9 to 5' }, '2026-11-19').error, 'slot');
  assert.equal(pickupInputOf({ ...ok, phone: '123' }, '2026-11-19').error, 'phone');
  assert.equal(pickupInputOf({ ...ok, note: '<b>' }, '2026-11-19').error, 'note');
  assert.equal(pickupInputOf({ ...ok, location: '' }, '2026-11-19').error, 'location');
  // 0145: several warehouse waybills + orders to their customers by their numbers; the receiver only when a warehouse row is there
  const many = { location: 'Zaan01', date: '2026-11-20', slot: SLOTS[1], receiver: 'محمد هشام', phone: '01102189189', warehouse: [{ note: '1001 1002', parcels: 2 }, { note: '1003', parcels: 1 }], orders: 'IB-1004، ١٠٠٥ 1004' };
  assert.deepEqual(pickupInputOf(many, '2026-11-19').ok.rows, [{ note: '1001 1002', parcels: 2 }, { note: '1003', parcels: 1 }]);
  assert.deepEqual(pickupInputOf(many, '2026-11-19').ok.orders, [1004, 1005]);
  assert.deepEqual(pickupInputOf({ ...many, warehouse: [], receiver: '', phone: '' }, '2026-11-19').ok.orders, [1004, 1005]);
  assert.equal(pickupInputOf({ ...many, warehouse: [], orders: '' }, '2026-11-19').error, 'empty');
  assert.equal(pickupInputOf({ ...many, warehouse: Array(11).fill({ parcels: 1 }) }, '2026-11-19').error, 'warehouse');
  assert.equal(pickupInputOf({ ...many, warehouse: [{ note: '', parcels: 0 }] }, '2026-11-19').error, 'parcels');
  assert.deepEqual(orderIdsOf(['181668', 'x 180686']), [181668, 180686]);
  const input = pickupInputOf(many, '2026-11-19').ok;
  const d = pickupDeliveryOf(input.rows[0], input, locs[0], '15-1', 'Zaan').body;
  assert.equal(d.businessLocationId, 'Zaan01');
  assert.equal(d.uniqueBusinessReference, 'IBP_15_1');
  assert.equal(d.notes, '1001 1002');
  assert.equal(d.cod, 0);
  assert.deepEqual(d.receiver, { firstName: 'محمد', lastName: 'هشام', phone: '01102189189' });
  assert.equal(d.dropOffAddress.districtId, 'xU1');
  assert.equal(d.specs.packageDetails.itemsCount, 2);
  assert.equal(d.specs.packageDetails.description, 'استلام من Zaan — 1001 1002');
  assert.equal(pickupDeliveryOf(input.rows[0], input, null, '1-1', 'x').error, 'no_warehouse');
  assert.deepEqual(pickupBodyOf(ok), { scheduledDate: '2026-11-20', scheduledTimeSlot: SLOTS[0], businessLocationId: 'Zaan01' });
  assert.deepEqual(pickupMadeOf(200, { success: true, message: { _id: 'pk1' } }), { id: 'pk1' });
  assert.deepEqual(pickupMadeOf(200, { data: { _id: 'pk2' } }), { id: 'pk2' });
  assert.equal(pickupMadeOf(400, { success: false, message: 'No slots' }).error, 'refused');
});

// 0146 «تعديل العنوان»: Bosta's own list (the plugin's getAllDistricts), the input rules, the site's shape, and the team's address wins
test('Bosta zones: only governorates and areas Bosta delivers to, the zone before the area\'s name', () => {
  const z = zonesOf({ data: [
    { cityCode: 'EG-01', cityName: 'Cairo', cityOtherName: 'القاهرة', dropOffAvailability: true, districts: [
      { districtId: 'a1', districtName: 'Nasr City', districtOtherName: 'مدينة نصر', zoneName: 'East', zoneOtherName: 'شرق', dropOffAvailability: true },
      { districtId: 'a2', districtOtherName: 'مقفولة', dropOffAvailability: false }] },
    { cityCode: 'EG-02', cityOtherName: 'مقفولة', dropOffAvailability: false, districts: [] }] });
  assert.deepEqual(z, [{ code: 'EG-01', name: 'القاهرة', en: 'Cairo', areas: [{ id: 'a1', name: 'شرق - مدينة نصر' }] }]);
  assert.deepEqual(zonesOf(null), []);
});
test('the address input: 10–200 letters, no <>, a governorate code and an area id', () => {
  const ok = addressInputOf({ address: '  15 شارع  عباس العقاد  ', state: 'EG-01', district: 'a1' });
  assert.equal(ok.ok.state, 'EG-01'); assert.equal(ok.ok.district, 'a1'); assert.ok(ok.ok.address.startsWith('15 شارع'));
  assert.deepEqual(addressInputOf({ address: 'قصير', state: 'EG-01', district: 'a1' }), { error: 'address' });
  assert.deepEqual(addressInputOf({ address: '15 شارع <b>عباس</b> العقاد', state: 'EG-01', district: 'a1' }), { error: 'address' });
  assert.deepEqual(addressInputOf({ address: '15 شارع عباس العقاد', state: 'EG 01', district: 'a1' }), { error: 'state' });
  assert.deepEqual(addressInputOf({ address: '15 شارع عباس العقاد', state: 'EG-01', district: '' }), { error: 'district' });
});
test('the site gets the address the way the plugin keeps it: billing + shipping + _billing_area', () => {
  assert.deepEqual(siteAddressOf({ address: '15 شارع عباس العقاد', state: 'EG-01', district: 'a1' }, 'شرق - مدينة نصر'), {
    billing: { address_1: '15 شارع عباس العقاد', address_2: '', state: 'EG-01', city: 'شرق - مدينة نصر' },
    shipping: { address_1: '15 شارع عباس العقاد', address_2: '', state: 'EG-01', city: 'شرق - مدينة نصر' },
    meta_data: [{ key: '_billing_area', value: 'a1' }] });
});
test('Bosta\'s delivery reads the team\'s address once it is set here, not the site\'s copy of the order', () => {
  const raw = { billing: { first_name: 'منى', phone: '01001234567', address_1: 'العنوان القديم في الجيزة', address_2: 'الدور 2', state: 'EG-25' }, meta_data: [{ key: '_billing_area', value: 'old' }] };
  const base = { id: 7, customer_name: 'منى', payment_method: 'cod', total: 500, deposit: 0, raw, address: '15 شارع عباس العقاد', state: 'EG-01', district: 'a1' };
  const own = deliveryOf({ ...base, address_set: true }, [], NAMES).body.dropOffAddress;
  assert.deepEqual(own, { firstLine: '15 شارع عباس العقاد', secondLine: '', city: 'Cairo', districtId: 'a1' });
  const site = deliveryOf(base, [], NAMES).body.dropOffAddress;
  assert.equal(site.firstLine, 'العنوان القديم في الجيزة'); assert.equal(site.districtId, 'old');
});
