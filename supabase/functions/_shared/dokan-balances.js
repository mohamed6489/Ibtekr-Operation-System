// The makers' Dokan balances (dokan/v1/stores/{id}/stats, GET only) → dokan_balances. Shared by woo-sync (the hourly accounts run,
// «تحديث من Dokan», after an approve / a reject) and woo-webhook (a maker's order closed — the owner 18 Nov: «راجع حساب المبتكر
// antekama»: two orders completed after the hourly read left the page an hour behind Dokan). Nothing is written to Dokan.
import { logSync, upsertRows } from './db.js';
import { WooError, errorText } from './woo-api.js';

const numOrNull = (v) => { const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''; return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null; };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// the Woo order statuses that move a maker's Dokan balance once the order has them (Dokan counts «completed» and takes it back
// on a refund or a cancel) — an order event with one of these reads its makers' balances right away
export const BALANCE_STATUSES = ['completed', 'refunded', 'cancelled', 'failed'];

/**
 * Reads each maker's Dokan balance now. `makers` = [{ id, woo_vendor_id }]; a 404 is a store gone (missing); any other Dokan
 * failure is counted and the first one logged (the error text scrubbed); a maker that failed keeps its last numbers.
 * `ctx` = { db, woo, kind, now: string, scrub, limit? } — `limit` reads that many at a time (default 1).
 */
export async function readBalances(ctx, makers) {
  const { db, woo, kind, now, scrub } = ctx;
  let missing = 0, failed = 0;
  const rows = [];
  const one = async (v) => {
    try {
      const { data } = await woo.get(`dokan/v1/stores/${Number(v.woo_vendor_id)}/stats`);
      const others = isObj(data) && isObj(data.others) ? data.others : {};
      const revenue = isObj(data) && isObj(data.revenue) ? data.revenue : {};
      rows.push({ vendor_id: v.id, woo_vendor_id: Number(v.woo_vendor_id), balance: numOrNull(others.balance), earning: numOrNull(revenue.earning), sales: numOrNull(revenue.sales),
        orders: Number.isInteger(numOrNull(revenue.orders)) ? numOrNull(revenue.orders) : null, synced_at: now });
    } catch (e) {
      if (e instanceof WooError && e.status === 404) { missing++; return; }
      if (!(e instanceof WooError)) throw e;
      failed++;
      if (failed === 1) await logSync(db, { kind, direction: 'in', entity: 'dokan_balances', entity_id: String(v.woo_vendor_id), action: 'stats', result: 'error', detail: { error: errorText(e, scrub) } });
    }
  };
  const step = Math.max(1, Math.min(8, Number(ctx.limit) || 1));
  for (let i = 0; i < makers.length; i += step) await Promise.all(makers.slice(i, i + step).map(one));
  const { bad } = rows.length ? await upsertRows(db, 'dokan_balances', rows, 'vendor_id') : { bad: [] };
  return { balances: rows.length - bad.length, missing, failed, failedRows: bad.length };
}

/** The makers (with a store) of a Woo order: a sub-order's own maker, else the makers of the parent's lines. */
export async function makersOfOrder(db, wooOrderId) {
  const ids = new Set();
  const sub = await db.from('sub_orders').select('vendor_id').eq('woo_order_id', wooOrderId);
  for (const r of sub.data ?? []) if (r.vendor_id) ids.add(r.vendor_id);
  if (!ids.size) { // a parent (orders.id is Woo's own id): its lines' makers
    const lines = await db.from('order_items').select('vendor_id').eq('order_id', wooOrderId);
    for (const r of lines.data ?? []) if (r.vendor_id) ids.add(r.vendor_id);
  }
  if (!ids.size) return [];
  const { data } = await db.from('vendors').select('id, woo_vendor_id').in('id', [...ids]);
  return (data ?? []).filter((v) => Number.isInteger(Number(v.woo_vendor_id)) && Number(v.woo_vendor_id) > 0);
}
