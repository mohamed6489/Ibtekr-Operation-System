// bosta: an order of ours → a Bosta delivery, the way the site's own Bosta plugin sends one (bosta-woocommerce 3.0.12,
// «Send To Bosta»: POST {BOSTA_API}/deliveries with the key in the `authorization` header, type 10, the receiver's names and
// phone, the drop-off address's first / second line and city, the package's items count and description, the customer note,
// and the cash to collect). Pure — no I/O; woo-sync action `bosta_send` does the reading and the calls (the owner 19 Nov:
// «ابعت لبوسطة» in the orders' bulk bar only — the whole order, the status as it is, the cash = what is left on the customer).

export const BOSTA_API = 'https://app.bosta.co/api/v0';
export const BOSTA_MAX = 50; // orders in one call
export const BOSTA_DEFAULT_COUNTRY = '60e4482c7cb7d4bc4849c4d5'; // Egypt — the plugin's fallback when the business info is not read

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

// the key the admin saved in «الإعدادات › الربط بالمنصات › بوسطة» (Vault app_bosta = { key })
export function bostaKey(stored) {
  const k = isObj(stored) ? stored.key : null;
  return typeof k === 'string' && /^[A-Za-z0-9._-]{20,400}$/.test(k.trim()) ? k.trim() : null;
}

export function splitName(full) {
  const parts = str(full, 120).split(' ').filter(Boolean);
  if (!parts.length) return { firstName: 'عميل', lastName: 'إبتكر' };
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(' ') : parts[0] };
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

// the governorate as Bosta names its cities: the site's state name (woo_states — EG-01 «Cairo» …, the names the Bosta plugin
// gave the site) or a name already written on the order («Cairo» / «Giza»); a code without a name → null (not sent)
export function cityOf(state, names) {
  const s = str(state, 60);
  if (!s) return null;
  if (/^EG-\d+$/i.test(s)) { const n = isObj(names) ? str(names[s.toUpperCase()], 60) : ''; return n || null; }
  return s;
}

// one line of the description per product, like the plugin's «Products: name(qty) …» — 500 characters at most
export function describe(items) {
  const L = (Array.isArray(items) ? items : []).filter(isObj).map((i) => str(i.name, 80) + '(' + Math.max(1, Math.trunc(num(i.qty)) || 1) + ')');
  return ('Products: ' + L.join(' ')).slice(0, 500);
}

// the delivery body; { error } when the order cannot go (no phone / no address / no city)
export function deliveryOf(order, items, names) {
  if (!isObj(order)) return { error: 'missing' };
  const ship = isObj(order.shipping) ? order.shipping : {}; const bill = isObj(order.billing) ? order.billing : {};
  const phone = phoneOf(ship.phone) || phoneOf(bill.phone) || phoneOf(order.phone);
  if (!phone) return { error: 'no_phone' };
  const first = str(ship.address_1, 200) || str(bill.address_1, 200) || str(order.address, 200);
  if (!first) return { error: 'no_address' };
  const city = cityOf(order.state || ship.state || bill.state, names);
  if (!city) return { error: 'no_city' };
  const who = splitName([str(ship.first_name, 60) || str(bill.first_name, 60), str(ship.last_name, 60) || str(bill.last_name, 60)].join(' ').trim() || order.customer_name);
  const L = (Array.isArray(items) ? items : []).filter(isObj);
  const count = L.reduce((n, i) => n + (Math.max(1, Math.trunc(num(i.qty)) || 1)), 0) || 1;
  const body = {
    type: 10,
    specs: { packageDetails: { itemsCount: count, description: describe(L) } },
    receiver: { firstName: who.firstName, lastName: who.lastName, phone },
    dropOffAddress: { firstLine: first, city },
    businessReference: 'IB-' + String(order.id ?? order.number ?? '').replace(/[^\dA-Za-z-]/g, '').slice(0, 40),
    cod: codOf(order),
  };
  const second = str(ship.address_2, 200) || str(bill.address_2, 200);
  if (second) body.dropOffAddress.secondLine = second;
  const note = str(order.customer_note, 300);
  if (note) body.notes = note;
  return { body };
}

// Bosta's answer: 201 → { tracking, state, id }; anything else → { error } with Bosta's own message cut short (no customer data
// is in it — it names the field that failed)
export function resultOf(status, data) {
  if (status === 201 || status === 200) {
    const d = isObj(data) && isObj(data.data) ? data.data : data;
    const tracking = isObj(d) && d.trackingNumber != null ? String(d.trackingNumber).slice(0, 40) : null;
    if (!tracking) return { error: 'bad_answer' };
    const state = isObj(d) && isObj(d.state) && typeof d.state.value === 'string' ? d.state.value.slice(0, 60) : null;
    return { tracking, state, id: isObj(d) && typeof d._id === 'string' ? d._id.slice(0, 60) : null };
  }
  const first = Array.isArray(data) ? data[0] : data;
  const msg = isObj(first) && typeof first.message === 'string' ? first.message.replace(/\s+/g, ' ').slice(0, 160) : '';
  return { error: status === 401 || status === 403 ? 'bad_key' : 'refused', message: msg || null };
}
