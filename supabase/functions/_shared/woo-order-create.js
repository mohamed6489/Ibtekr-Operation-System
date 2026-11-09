// An order made from the customer-service chat (phase 13 T3, docs/superpowers/plans/2026-11-09-phase-13-leftovers.md decision 7): the
// pure part of woo-sync's order_create / order_pay_link — the request checked, the WooCommerce order body (pending, unpaid, the
// customer from our row, the lines by product id), the pay link of a pending order. No I/O; tested from node
// (tests/functions/woo-order-create.test.mjs). Nothing here ever holds a phone longer than the call.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const posInt = (v, max) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= max ? n : null; };
export const MAX_LINES = 20;
export const MAX_QTY = 50;
export const CREATED_VIA = 'ibtekr-ops';
export const CONV_META = '_ibtekr_cs_conversation';
// the statuses a pay link makes sense for (the order waits for its payment)
export const PAY_STATUSES = ['قيد الانتظار', 'فشل', 'معلّق'];

/** { customer_id, items: [{ product_id, variation_id?, qty }], note?, conversation_id? } → the checked input, or { error, field } */
export function orderCreateInput(args) {
  const a = isObj(args) ? args : {};
  if (typeof a.customer_id !== 'string' || !UUID.test(a.customer_id)) return { error: 'bad_request', field: 'customer_id' };
  if (!Array.isArray(a.items) || !a.items.length || a.items.length > MAX_LINES) return { error: 'bad_request', field: 'items' };
  const items = [];
  for (const it of a.items) {
    if (!isObj(it)) return { error: 'bad_request', field: 'items' };
    const product_id = posInt(it.product_id, 2_000_000_000); const qty = posInt(it.qty ?? 1, MAX_QTY);
    const variation_id = it.variation_id == null || it.variation_id === 0 ? null : posInt(it.variation_id, 2_000_000_000);
    if (!product_id || !qty || (it.variation_id != null && it.variation_id !== 0 && !variation_id)) return { error: 'bad_request', field: 'items' };
    items.push({ product_id, variation_id, qty });
  }
  const note = typeof a.note === 'string' ? a.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500) : '';
  const conversation_id = typeof a.conversation_id === 'string' && UUID.test(a.conversation_id) ? a.conversation_id : null;
  return { customer_id: a.customer_id, items, note, conversation_id };
}

const splitName = (name) => { const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean); return { first: parts[0] || 'عميل', last: parts.slice(1).join(' ') }; };
/** the WooCommerce order body: pending and unpaid (the customer pays through the link), the customer's row as billing / shipping */
export function wooOrderBody({ customer, items, note, conversationId }) {
  const c = isObj(customer) ? customer : {}; const { first, last } = splitName(c.name);
  const address = { first_name: first, last_name: last, phone: String(c.phone ?? '').trim(), city: String(c.city ?? '').trim(), state: String(c.province ?? '').trim(), address_1: String(c.address ?? '').trim(), address_2: String(c.address2 ?? '').trim(), country: 'EG' };
  return {
    status: 'pending', set_paid: false, created_via: CREATED_VIA, customer_note: note || '',
    billing: address, shipping: { ...address },
    line_items: items.map((it) => ({ product_id: it.product_id, ...(it.variation_id ? { variation_id: it.variation_id } : {}), quantity: it.qty })),
    meta_data: [{ key: '_created_by_system', value: 'ibtekr-ops' }, ...(conversationId ? [{ key: CONV_META, value: conversationId }] : [])],
  };
}
/** the pay link of an order: WooCommerce's own payment_url when it answers one, else built from the order key on the shop's host */
export function payUrl(siteUrl, order) {
  const o = isObj(order) ? order : {};
  const site = String(siteUrl ?? '').trim().replace(/\/+$/, '');
  if (typeof o.payment_url === 'string' && /^https:\/\//.test(o.payment_url)) { try { if (new URL(o.payment_url).host === new URL(site).host) return o.payment_url; } catch { /* fall through */ } }
  const key = typeof o.order_key === 'string' && /^wc_order_[A-Za-z0-9]{6,40}$/.test(o.order_key) ? o.order_key : null;
  const id = posInt(o.id, 2_000_000_000);
  if (!site || !key || !id) return null;
  return site + '/checkout/order-pay/' + id + '/?pay_for_order=true&key=' + key;
}
export const orderPayable = (status) => PAY_STATUSES.includes(String(status ?? ''));
