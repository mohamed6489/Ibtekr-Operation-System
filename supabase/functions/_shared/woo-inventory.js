// Phase 7 (docs/superpowers/plans/2026-11-04-phase-7-inventory.md, decision 1 c): the site quantity = the hub's available pieces.
// Pure functions for woo-sync's inventory_push (node tests in tests/functions/woo-inventory.test.mjs).
// * The site follows only the SKUs Ibtekr owns: a SKU with at least one «ملك ابتكر» lot (any reason, open or closed) — a maker's
//   «أمانة» piece or a SKU the hub never held keeps the quantity the maker keeps on the site.
// * Its quantity = Σ over its open «ملك ابتكر» lots held «متاح للبيع» of on hand (in + adjust − out − ship) − reserved
//   (reserve − release), never below 0 — a piece in a consolidation, a return or a photo shoot is not for sale.
export const OWNED = 'ملك ابتكر';
export const FOR_SALE = 'متاح للبيع';
export const INVENTORY_PUSH_MAX = 50;

const SIGN = { in: 1, adjust: 1, out: -1, ship: -1 };
const RES = { reserve: 1, release: -1 };

export function siteQuantities(lots, moves) {
  const owned = (Array.isArray(lots) ? lots : []).filter((l) => l && l.mode === OWNED && typeof l.sku === 'string' && l.sku.trim());
  const sale = new Map(owned.filter((l) => l.reason === FOR_SALE && !l.closed_at).map((l) => [String(l.id), l.sku.trim()]));
  const out = new Map(owned.map((l) => [l.sku.trim(), 0]));
  const hand = new Map(); const held = new Map();
  for (const m of Array.isArray(moves) ? moves : []) {
    const id = m && String(m.lot_id); if (!sale.has(id)) continue;
    const q = Math.trunc(Number(m.qty)) || 0;
    if (SIGN[m.type]) hand.set(id, (hand.get(id) || 0) + SIGN[m.type] * q);
    if (RES[m.type]) held.set(id, (held.get(id) || 0) + RES[m.type] * q);
  }
  for (const [id, sku] of sale) out.set(sku, out.get(sku) + Math.max(0, (hand.get(id) || 0) - Math.max(0, held.get(id) || 0)));
  return out;
}

// the SKUs asked for: strings, trimmed, unique, 1..max of them (else null); none asked = every owned SKU (undefined)
export function skuList(v, max = INVENTORY_PUSH_MAX) {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return null;
  const l = [...new Set(v.filter((s) => typeof s === 'string').map((s) => s.trim()).filter((s) => s && s.length <= 80))];
  return l.length && l.length <= max ? l : null;
}

// ---------------------------------------------------------------- the automatic pull («المخزن الأول» — phase 13 T2, decision 5)
// A new order's lines whose SKU sits «متاح للبيع» in the hub with enough available pieces are reserved on arrival (the sync, not
// the browser): one lot a line (the one with the most available pieces), a running count so two lines of one SKU never book
// the same piece, the lot flagged `exhausted` when nothing stays available. Lines without a SKU or quantity are left alone.
// → [{ itemId, orderId, orderNumber, lotId, sku, name, qty, exhausted }]
export const AUTOPULL_LABEL = 'حجز لأوردر';
export const AUTOPULL_NOTE = 'سحب تلقائي';
export const RESERVED_STATUS = 'محجوز لأوردر';
export function lotAvailability(lots, moves) {
  const open = new Map((Array.isArray(lots) ? lots : []).filter((l) => l && l.reason === FOR_SALE && !l.closed_at && typeof l.sku === 'string' && l.sku.trim()).map((l) => [String(l.id), { lot: l, hand: 0, held: 0 }]));
  for (const m of Array.isArray(moves) ? moves : []) {
    const e = open.get(m && String(m.lot_id)); if (!e) continue;
    const q = Math.trunc(Number(m.qty)) || 0;
    if (SIGN[m.type]) e.hand += SIGN[m.type] * q;
    if (RES[m.type]) e.held += RES[m.type] * q;
  }
  return [...open.values()].map((e) => ({ lot: e.lot, available: Math.max(0, e.hand - Math.max(0, e.held)) }));
}
export function autoPullPlan({ items, lots, moves }) {
  const avail = lotAvailability(lots, moves).filter((a) => a.available > 0);
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const sku = typeof it?.sku === 'string' ? it.sku.trim() : ''; const qty = Math.trunc(Number(it?.qty)) || 0;
    if (!sku || qty <= 0 || it.id == null) continue;
    const pick = avail.filter((a) => a.lot.sku.trim() === sku && a.available >= qty).sort((a, b) => b.available - a.available)[0];
    if (!pick) continue;
    pick.available -= qty;
    out.push({ itemId: it.id, orderId: it.order_id, orderNumber: it.order_number ?? null, lotId: pick.lot.id, sku, name: String(pick.lot.name ?? it.name ?? sku), qty, exhausted: pick.available <= 0 });
  }
  return out;
}
