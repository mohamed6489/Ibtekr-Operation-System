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
