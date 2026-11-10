// Phase 13 decision 52 (owner 10 Nov — «التأخير يتحسب من تاريخ التأكيد … والأوردر الفرعي من تاريخ إبلاغ المبتكر + أيام التصنيع للمنتج»;
// the answers «No delay until confirmed» and «Maker + product override»). The same rule as block 12's IbtekrOps.orderDelay /
// subDelay (tests/functions/delay.test.mjs compares them case by case):
// * the order: its days count from the confirmation date (confirm_at; a confirmed order without one = its own date); an order not
//   confirmed has no delay at all. «قابل للتأخير» from riskFrom (9) days, «متأخر» from lateFrom (12) — settings «makers».
// * the sub-order (a maker's line): its days count from «تاريخ تبليغ المبتكر» (order_items.expected_at); without it, from the
//   order's confirmation (and nothing while the order is not confirmed). Against the making days = the product's own
//   (product_lead_days) else the maker's «مدة التجهيز» (vendors.lead_days) else 7: «قابل للتأخير» in the last 3 days,
//   «متأخر» once they are past. A closed line is never late.
export const RISK_FROM = 9; export const LATE_FROM = 12; export const LEAD_DEFAULT = 7; export const RISK_WINDOW = 3;

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;
/** whole days from the day `from` to the day `to` ('YYYY-MM-DD…'), never negative; null when either is not a date */
export function daysFrom(from, to) {
  if (!DAY_RE.test(String(from ?? '')) || !DAY_RE.test(String(to ?? ''))) return null;
  const a = Date.parse(String(from).slice(0, 10) + 'T00:00:00Z'), b = Date.parse(String(to).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}
export const isConfirmed = (cf) => /^مؤكد/.test(String(cf ?? ''));
/** the days since the order was confirmed, or null while it is not */
export function confirmAge({ confirm, confirmAt, placedAt }, today) {
  if (!isConfirmed(confirm)) return null;
  return daysFrom(confirmAt || placedAt, today);
}
/** the order's delay from its confirmation age: 'ok' | 'risk' | 'late' */
export function orderDelay(age, { riskFrom = RISK_FROM, lateFrom = LATE_FROM } = {}) {
  if (age == null || !Number.isFinite(age)) return 'ok';
  return age >= lateFrom ? 'late' : age >= riskFrom ? 'risk' : 'ok';
}
/** the making days of a line: the product's own, else the maker's, else 7 */
export function leadOf(productDays, makerDays) {
  const p = Number(productDays); if (Number.isInteger(p) && p >= 1 && p <= 90) return p;
  const m = Number(makerDays); if (Number.isInteger(m) && m >= 1 && m <= 90) return m;
  return LEAD_DEFAULT;
}
/** the days counted on a line: from the maker's notify date, else from the order's confirmation, else null */
export function subElapsed({ notifiedAt, confirm, confirmAt, placedAt }, today) {
  if (DAY_RE.test(String(notifiedAt ?? ''))) return daysFrom(notifiedAt, today);
  return confirmAge({ confirm, confirmAt, placedAt }, today);
}
/** the line's delay: 'ok' | 'risk' (the last RISK_WINDOW making days) | 'late' (past them); a closed line → 'ok' */
export function subDelay(elapsed, lead, open = true) {
  if (!open || elapsed == null || !Number.isFinite(elapsed)) return 'ok';
  const n = leadOf(lead, null);
  return elapsed > n ? 'late' : elapsed >= n - (RISK_WINDOW - 1) ? 'risk' : 'ok';
}
