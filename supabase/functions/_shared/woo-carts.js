// The visitor's abandoned carts (phase 12 T7, docs/superpowers/plans/2026-11-08-phase-12-followups.md decisions 7 and 13) — the pure
// part of woo-sync's part «carts»: the rows the site's snippet (tools/wp-snippets/ibtekr-carts.php, over CartFlows' table) answers →
// the cs_carts rows we keep. Nothing here reads or writes; no cart contents ever arrive.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max);
export const CART_PATH = 'ibtekr/v1/carts';
export const CART_HOURS = 48;
export const CART_STATUS = ['normal', 'completed', 'lost'];

/** A site row → a cs_carts row, or null when it is not a cart (no positive id or no time); a link off the site, or with no site known, is dropped. */
export function cartRow(r, { siteUrl, now } = {}) {
  if (!isObj(r)) return null;
  const id = Number(r.id); if (!Number.isInteger(id) || id <= 0) return null;
  const t = Date.parse(String(r.updated_at ?? '')); if (!Number.isFinite(t)) return null;
  const host = (() => { try { return new URL(String(siteUrl ?? '')).host; } catch { return ''; } })();
  // the recovery link is kept only when it is https on the shop's own host; no known host (WOO_URL unset) = no link (fails closed)
  let url = str(r.url, 500);
  try { const u = new URL(url); if (u.protocol !== 'https:' || !host || u.host !== host) url = ''; } catch { url = ''; }
  const total = Number(r.total); const items = Number(r.items);
  return {
    cart_id: id, email: str(r.email, 254), phone: str(r.phone, 32).replace(/[^\d+]/g, ''), name: str(r.name, 120),
    total: Number.isFinite(total) && total >= 0 ? Math.round(total * 100) / 100 : 0, items: Number.isInteger(items) && items >= 0 ? Math.min(items, 1000) : 0,
    status: CART_STATUS.includes(r.status) ? r.status : 'normal', unsubscribed: r.unsubscribed === true, url,
    site_updated_at: new Date(t).toISOString(), synced_at: now ?? new Date().toISOString(),
  };
}
/** The whole answer → the rows (bad rows counted, duplicates by id keep the latest). */
export function cartRows(data, opts = {}) {
  const byId = new Map(); let bad = 0;
  for (const r of Array.isArray(data) ? data : []) { const row = cartRow(r, opts); if (!row) { bad++; continue; } const prev = byId.get(row.cart_id); if (!prev || prev.site_updated_at < row.site_updated_at) byId.set(row.cart_id, row); }
  return { rows: [...byId.values()], bad };
}
