// bosta: an order of ours → a Bosta delivery, the way the site's own Bosta plugin sends one — bosta-woocommerce 4.5.7 (the copy
// on the site, the owner 19 Nov), «Send To Bosta» / auto sync: POST {BOSTA_API}/deliveries/bulk { deliveries: [one], deleteFailedDeliveries:
// false } with the key in the `authorization` header (bosta_send_api_request), then POST {BOSTA_API}/deliveries/woocommerce-data
// { deliveriesIds } for the tracking number and state (bosta_get_woocommerce_deliveries_data). The delivery (bosta_format_order_payload):
// type 10, the customer note, uniqueBusinessReference «WC_<order>» (Bosta refuses the same order twice — the plugin and the system
// share it), businessReference «Woocommerce_<order>», the package's items count and «name x qty» description, the receiver from the
// billing first (and the second phone of _billing_phone_2), the drop-off address's first / second line, the governorate as Bosta names
// it and the district the customer picked at checkout (_billing_area), the cash to collect and the goods' value. No webhook: its secret
// lives in the plugin's options on the site, and Bosta's status reaches our order through the sync like any order meta.
// Pure — no I/O; woo-sync action `bosta_send` does the reading and the calls. The cash differs from the plugin on purpose (the owner,
// 19 Nov: «اللي باقي على العميل») — the total minus the deposit for cash on delivery.

export const BOSTA_API = 'https://app.bosta.co/api/v2';
export const BOSTA_MAX = 50; // orders in one call

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : typeof v === 'number' ? String(v).slice(0, n) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

// the key the admin saved in «الإعدادات › الربط بالمنصات › بوسطة» (Vault app_bosta = { key })
export function bostaKey(stored) {
  const k = isObj(stored) ? stored.key : null;
  return typeof k === 'string' && /^[A-Za-z0-9._-]{20,400}$/.test(k.trim()) ? k.trim() : null;
}

// a meta value of the Woo order (raw.meta_data — [{ key, value }])
export function metaOf(raw, key) {
  const m = isObj(raw) && Array.isArray(raw.meta_data) ? raw.meta_data.find((x) => isObj(x) && x.key === key) : null;
  return m ? str(m.value, 80) : '';
}

// the cash Bosta collects: cash on delivery → the total minus the deposit (never below 0); a paid order (a card, a wallet, …) → 0
export function codOf(order) {
  if (!isObj(order) || order.payment_method !== 'cod') return 0;
  return Math.max(0, round2(num(order.total) - num(order.deposit)));
}

// an Egyptian mobile as Bosta wants it (01xxxxxxxxx); +20 / 0020 / 20 taken off; anything else → null
export function phoneOf(raw) {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  d = d.replace(/^\+?0*20(?=1\d{9}$)/, '0').replace(/^\+/, '');
  if (/^1\d{9}$/.test(d)) d = '0' + d;
  return /^01\d{9}$/.test(d) ? d : null;
}

// the governorate as Bosta names it: the site's state name (woo_states — the plugin gives the site Bosta's names) or a name already
// written on the order; a code without a name → '' (the district alone then)
export function cityOf(state, names) {
  const s = str(state, 60);
  if (!s) return '';
  if (/^EG-\d+$/i.test(s)) return isObj(names) ? str(names[s.toUpperCase()], 60) : '';
  return s;
}

// «name x qty, name x qty» — the plugin's new description format (products by name), 500 characters at most
export function describe(items) {
  const d = (Array.isArray(items) ? items : []).filter(isObj).map((i) => str(i.name, 120) + ' x ' + (Math.max(1, Math.trunc(num(i.qty)) || 1))).join(', ');
  return d.length > 500 ? d.slice(0, 497) + '...' : d;
}

// the delivery; { error } when the plugin would refuse it too (bosta_validate_order_fields): no_name / no_phone / no_address /
// short_address (under 10 characters) / no_city (no governorate and no district)
export function deliveryOf(order, items, names) {
  if (!isObj(order)) return { error: 'missing' };
  const raw = isObj(order.raw) ? order.raw : {};
  const bill = isObj(raw.billing) ? raw.billing : {}; const ship = isObj(raw.shipping) ? raw.shipping : {};
  const first = str(bill.first_name, 60) || str(ship.first_name, 60) || str(order.customer_name, 60).split(' ')[0] || '';
  if (!first) return { error: 'no_name' };
  const phone = phoneOf(bill.phone) || phoneOf(ship.phone) || phoneOf(order.phone);
  if (!phone) return { error: 'no_phone' };
  const line1 = str(bill.address_1, 200) || str(ship.address_1, 200) || str(order.address, 200);
  if (!line1) return { error: 'no_address' };
  if (line1.length < 10) return { error: 'short_address' };
  const city = cityOf(str(bill.state, 20) || str(ship.state, 20) || order.state, names);
  const district = metaOf(raw, '_billing_area');
  if (!city && !district) return { error: 'no_city' };
  const last = str(bill.last_name, 60) || str(ship.last_name, 60) || str(order.customer_name, 120).split(' ').slice(1).join(' ');
  const L = (Array.isArray(items) ? items : []).filter(isObj);
  const ref = String(order.id ?? '').replace(/\D/g, '').slice(0, 20);
  const body = {
    id: Number(ref) || ref,
    type: 10,
    notes: str(order.customer_note, 300),
    uniqueBusinessReference: 'WC_' + ref,
    businessReference: 'Woocommerce_' + ref,
    specs: { packageDetails: { itemsCount: L.reduce((n, i) => n + (Math.max(1, Math.trunc(num(i.qty)) || 1)), 0) || 1, description: describe(L) } },
    receiver: { firstName: first.slice(0, 50), lastName: last, phone },
    dropOffAddress: { firstLine: line1, secondLine: str(bill.address_2, 200) || str(ship.address_2, 200) },
    cod: codOf(order),
    goodsInfo: { amount: round2(L.reduce((n, i) => n + num(i.amount), 0)) },
  };
  if (city) body.dropOffAddress.city = city;
  if (district) body.dropOffAddress.districtId = district;
  const second = phoneOf(metaOf(raw, '_billing_phone_2'));
  if (second) body.receiver.secondPhone = second;
  return { body };
}

// the bulk answer: 2xx → { id } (the created delivery) or { error: 'refused', message } (Bosta's failedDeliveries — it names the
// field); 401 / 403 → bad_key; else refused with Bosta's message cut short (no customer data is in it)
export function createdOf(status, data) {
  const msgOf = (x) => (isObj(x) && typeof x.message === 'string' ? x.message.replace(/\s+/g, ' ').slice(0, 160) : isObj(x) && typeof x.error === 'string' ? x.error.slice(0, 160) : '');
  if (status === 401 || status === 403) return { error: 'bad_key', message: msgOf(Array.isArray(data) ? data[0] : data) || null };
  if (status < 200 || status >= 300) return { error: 'refused', message: msgOf(Array.isArray(data) ? data[0] : data) || null };
  const d = isObj(data) && isObj(data.data) ? data.data : null;
  if (!d) return { error: 'bad_answer' };
  const failed = Array.isArray(d.failedDeliveries) ? d.failedDeliveries : [];
  if (failed.length) { const f = failed[0]; const e = isObj(f) && Array.isArray(f.errors) ? f.errors[0] : f; return { error: 'refused', message: msgOf(e) || msgOf(f) || null }; }
  const ids = Array.isArray(d.createdDeliveriesIds) ? d.createdDeliveriesIds : Array.isArray(d) ? d : [];
  const id = ids.map((x) => (isObj(x) ? x._id : x)).find((x) => typeof x === 'string' && x);
  return id ? { id: id.slice(0, 60) } : { error: 'bad_answer' };
}

// the woocommerce-data answer for the delivery: { tracking, state } or null
export function trackingOf(data, deliveryId) {
  const list = isObj(data) && Array.isArray(data.data) ? data.data : [];
  const d = list.find((x) => isObj(x) && x._id === deliveryId) || list.find(isObj);
  if (!d || d.trackingNumber == null) return null;
  return { tracking: String(d.trackingNumber).slice(0, 40), state: isObj(d.state) && typeof d.state.value === 'string' ? d.state.value.slice(0, 60) : null };
}

// ---- part 2 (0144 — the owner 19 Nov: the cash follows the deposit, the waybill printed here, a pickup from the maker) ----

// the edit of a delivery Bosta has (PUT {BOSTA_API}/deliveries/business/{delivery}) — the plugin's bosta_format_updated_order with the
// cash: the receiver as one full name, the drop-off address, the goods, the package, the note and the cash. From the body deliveryOf
// builds, so the two never differ.
export function updateOf(body) {
  if (!isObj(body)) return null;
  const r = isObj(body.receiver) ? body.receiver : {};
  const receiver = { fullName: [r.firstName, r.lastName].filter(Boolean).join(' ').slice(0, 50), phone: r.phone };
  if (r.secondPhone) receiver.secondPhone = r.secondPhone;
  return { notes: body.notes, receiver, dropOffAddress: body.dropOffAddress, goodsInfo: body.goodsInfo, specs: body.specs, cod: body.cod };
}

// Bosta's answer to an edit: ok, or why (the courier has the parcel already → refused with Bosta's message)
export function editedOf(status, data) {
  const msg = isObj(data) && typeof data.message === 'string' ? data.message.replace(/\s+/g, ' ').slice(0, 160) : null;
  if (status === 401 || status === 403) return { error: 'bad_key', message: msg };
  if (status === 404) return { error: 'gone', message: msg };
  if (status < 200 || status >= 300 || (isObj(data) && data.success === false)) return { error: 'refused', message: msg };
  return { ok: true };
}

// the waybills of deliveries (GET {BOSTA_API}/deliveries/mass-awb?ids=…&lang=ar → { data: base64 PDF }) — the plugin's print
export const AWB_MAX = 50;
export function awbPath(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)))].slice(0, AWB_MAX);
  return list.length ? '/deliveries/mass-awb?ids=' + list.join(',') + '&lang=ar' : null;
}
export function awbOf(status, data) {
  if (status === 401 || status === 403) return { error: 'bad_key' };
  if (status < 200 || status >= 300) return { error: 'refused', message: isObj(data) && typeof data.message === 'string' ? data.message.slice(0, 160) : null };
  const b64 = isObj(data) && typeof data.data === 'string' ? data.data.replace(/\s+/g, '') : '';
  // a PDF in base64 starts with «JVBER» (%PDF)
  return /^JVBER[A-Za-z0-9+/=]+$/.test(b64) ? { pdf: b64 } : { error: 'bad_answer' };
}

// the business's pickup locations (GET {BOSTA_API}/pickup-locations → data.list): id, name, city, district and the contact person
export function locationsOf(data) {
  const list = isObj(data) && isObj(data.data) && Array.isArray(data.data.list) ? data.data.list : isObj(data) && Array.isArray(data.data) ? data.data : [];
  return list.filter((x) => isObj(x) && typeof x._id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x._id)).map((x) => {
    const a = isObj(x.address) ? x.address : {};
    const c = isObj(x.contactPerson) ? x.contactPerson : {};
    return {
      id: x._id, name: str(x.locationName, 80) || str(x.name, 80) || x._id,
      city: isObj(a.city) ? str(a.city.nameAr, 40) || str(a.city.name, 40) : '',
      cityEn: isObj(a.city) ? str(a.city.name, 40) : '',
      district: isObj(a.district) ? str(a.district.nameAr, 60) || str(a.district.name, 60) : '',
      districtId: isObj(a.district) && typeof a.district._id === 'string' ? a.district._id.slice(0, 40) : '',
      firstLine: str(a.firstLine, 200), secondLine: str(a.secondLine, 200),
      building: str(a.buildingNumber, 20), floor: str(a.floor, 20), apartment: str(a.apartment, 20),
      contact: str(c.name, 60), phone: phoneOf(c.phone) || '',
      isDefault: x.isDefault === true,
    };
  });
}

// the warehouse as a drop-off address (a location of locationsOf)
export function addressOf(loc) {
  if (!isObj(loc) || !loc.firstLine) return null;
  const a = { firstLine: loc.firstLine, secondLine: loc.secondLine || '' };
  if (loc.cityEn) a.city = loc.cityEn;
  if (loc.districtId) a.districtId = loc.districtId;
  if (loc.building) a.buildingNumber = loc.building;
  if (loc.floor) a.floor = loc.floor;
  if (loc.apartment) a.apartment = loc.apartment;
  return a;
}

export const SLOTS = ['10:00 to 13:00', '13:00 to 16:00'];

// the order numbers the member typed (spaces, commas, «IB-», Arabic digits) → unique ids, 30 at most
export function orderIdsOf(v) {
  const t = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  const ids = t.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d{3,12}/g) || [];
  return [...new Set(ids.map(Number))].slice(0, 30);
}

// the pickup's input checked (0145 — several waybills): the maker's location, a day from today (Cairo) to 30 days on, a slot; the
// warehouse waybills — rows { note (the order numbers coming, ≤ 300, no < >), parcels 1–99 }, up to 10 — with the receiver's name
// (2–60) and phone; the orders going to their customers straight from the maker, by their numbers. At least one waybill.
// → { ok: { location, date, slot, receiver, phone, rows, orders } } or { error: field }. The old one-row shape (note / parcels) is one row.
export function pickupInputOf(a, today) {
  if (!isObj(a)) return { error: 'input' };
  const loc = typeof a.location === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(a.location) ? a.location : null;
  if (!loc) return { error: 'location' };
  const date = typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : null;
  const max = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  if (!date || date < today || date > max) return { error: 'date' };
  if (!SLOTS.includes(a.slot)) return { error: 'slot' };
  const orders = orderIdsOf(a.orders);
  const raw = Array.isArray(a.warehouse) ? a.warehouse : (a.warehouse === undefined && !orders.length ? [{ note: a.note, parcels: a.parcels }] : []);
  if (raw.length > 10) return { error: 'warehouse' };
  const rows = [];
  for (const r of raw) {
    if (!isObj(r)) return { error: 'warehouse' };
    const note = str(r.note, 300);
    if (/[<>]/.test(note)) return { error: 'note' };
    const parcels = Math.trunc(Number(r.parcels ?? 1));
    if (!(parcels >= 1 && parcels <= 99)) return { error: 'parcels' };
    rows.push({ note, parcels });
  }
  if (!rows.length && !orders.length) return { error: 'empty' };
  let receiver = ''; let phone = '';
  if (rows.length) {
    receiver = str(a.receiver, 60);
    if (receiver.length < 2 || /[<>]/.test(receiver)) return { error: 'receiver' };
    phone = phoneOf(a.phone);
    if (!phone) return { error: 'phone' };
  }
  return { ok: { location: loc, date, slot: a.slot, receiver, phone, rows, orders } };
}

// one warehouse waybill of a maker pickup: from the maker's location (businessLocationId) to the warehouse, to the receiver, the
// row's note and cartons, cash 0; ref = «<pickup>-<row>» (Bosta's unique reference IBP_<pickup>_<row>)
export function pickupDeliveryOf(row, input, warehouse, ref, makerName) {
  const to = addressOf(warehouse);
  if (!to) return { error: 'no_warehouse' };
  const [first, ...rest] = String(input.receiver).split(' ');
  const r = String(ref).replace(/[^\d-]/g, '');
  return { body: {
    type: 10,
    businessLocationId: input.location,
    notes: row.note,
    uniqueBusinessReference: 'IBP_' + r.replace('-', '_'),
    businessReference: 'Ibtekr_pickup_' + r,
    specs: { packageDetails: { itemsCount: row.parcels, description: ('استلام من ' + str(makerName, 80) + (row.note ? ' — ' + row.note : '')).trim().slice(0, 500) } },
    receiver: { firstName: first.slice(0, 50), lastName: rest.join(' ').slice(0, 50), phone: input.phone },
    dropOffAddress: to,
    cod: 0,
  } };
}

// the courier's visit (POST {BOSTA_V0}/pickups — the plugin's own call) and the id of what was made
export const BOSTA_V0 = 'https://app.bosta.co/api/v0';
export function pickupBodyOf(input) { return { scheduledDate: input.date, scheduledTimeSlot: input.slot, businessLocationId: input.location }; }
export function pickupMadeOf(status, data) {
  const msg = isObj(data) && typeof data.message === 'string' ? data.message.slice(0, 160) : null;
  if (status === 401 || status === 403) return { error: 'bad_key', message: msg };
  if (status < 200 || status >= 300 || (isObj(data) && data.success === false)) return { error: 'refused', message: msg };
  const id = isObj(data) && isObj(data.message) ? data.message._id : isObj(data) && isObj(data.data) ? data.data._id : isObj(data) ? data._id : null;
  return typeof id === 'string' && id ? { id: id.slice(0, 40) } : { error: 'bad_answer' };
}
