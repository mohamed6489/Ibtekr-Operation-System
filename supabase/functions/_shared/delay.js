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

// Owner batch 2 decision 17 (14 Nov — «نقطة بداية حساب الأيام … قابل للتأخير قبل انتهاء أطول مدة تصنيع بيومين، ومتأخر عند انتهاء مدة
// التصنيع وعدم تحويلها للشحن … الأوردر الفرعي متأخر في حالة مرور مدة التصنيع»): the rules from settings «makers».delay, the same in
// block 12 (IbtekrOps.delayRules / orderDelayOf / lineDelayOf — tests/functions/delay.test.mjs compares them):
// * start: 'confirm' (default — the order from its confirmation, none while not confirmed; a line from the maker's notify date, else
//   the order's start) · 'order' (the order from its own date; a line from its notify date, else the order's date) · 'notify' (a line
//   from its notify date only — none without it; the order from its confirmation).
// * the order: against the longest making days of its open lines — «قابل للتأخير» from orderRisk (2) days before they end, «متأخر» once
//   they are past; an order in a stop status (stop — default قيد الشحن · مكتمل · ملغي · استرجاع · فشل; the base status) never counts.
// * a line: against its own making days (product, else maker, else lead — 7), «قابل للتأخير» from subRisk (2) days before.
export const START_POINTS = ['confirm', 'order', 'notify'];
export const DELAY_STOP = ['قيد الشحن', 'مكتمل', 'ملغي', 'استرجاع', 'فشل'];
export const DELAY_DEFAULTS = Object.freeze({ start: 'confirm', orderRisk: 2, subRisk: 2, lead: LEAD_DEFAULT, stop: DELAY_STOP });
const intIn = (v, lo, hi, d) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
/** settings «makers».delay (anything) → { start, orderRisk, subRisk, lead, stop } with the defaults */
export function delayRules(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const stop = Array.isArray(d.stop) ? [...new Set(d.stop.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))].slice(0, 20) : DELAY_STOP.slice();
  return { start: START_POINTS.includes(d.start) ? d.start : 'confirm', orderRisk: intIn(d.orderRisk, 0, 30, 2), subRisk: intIn(d.subRisk, 0, 30, 2), lead: intIn(d.lead, 1, 90, LEAD_DEFAULT), stop };
}
/** the making days of a line under the rules: the product's own, else the maker's, else the rules' default */
export function leadBy(productDays, makerDays, rules) {
  const p = Number(productDays); if (Number.isInteger(p) && p >= 1 && p <= 90) return p;
  const m = Number(makerDays); if (Number.isInteger(m) && m >= 1 && m <= 90) return m;
  return (rules && rules.lead) || LEAD_DEFAULT;
}
/** the days counted on the order: from its own date (start 'order') or its confirmation (else; null while not confirmed) */
export function orderElapsed({ confirm, confirmAt, placedAt }, today, rules) {
  if (rules && rules.start === 'order') return daysFrom(placedAt, today);
  return confirmAge({ confirm, confirmAt, placedAt }, today);
}
/** the days counted on a line: from its notify date; without it the order's start (start 'notify': none) */
export function lineElapsed({ notifiedAt, confirm, confirmAt, placedAt }, today, rules) {
  if (DAY_RE.test(String(notifiedAt ?? ''))) return daysFrom(notifiedAt, today);
  if (rules && rules.start === 'notify') return null;
  return orderElapsed({ confirm, confirmAt, placedAt }, today, rules);
}
/** elapsed days against a making time: 'late' once past it, 'risk' from `risk` days before its end, else 'ok' */
export function delayAgainst(elapsed, lead, risk) {
  if (elapsed == null || !Number.isFinite(elapsed)) return 'ok';
  return elapsed > lead ? 'late' : elapsed >= lead - risk ? 'risk' : 'ok';
}
/** the order: status (its base), elapsed (orderElapsed), maxLead (the longest making days of its open lines; null = none open) */
export function orderDelayOf({ status, elapsed, maxLead }, rules) {
  const r = rules || DELAY_DEFAULTS;
  if (maxLead == null || (r.stop || []).includes(String(status ?? ''))) return 'ok';
  return delayAgainst(elapsed, leadBy(maxLead, null, r), r.orderRisk);
}
/** a line: elapsed (lineElapsed), its making days, open (a closed line is never late) */
export function lineDelayOf(elapsed, lead, open, rules) {
  const r = rules || DELAY_DEFAULTS;
  if (open === false) return 'ok';
  return delayAgainst(elapsed, leadBy(lead, null, r), r.subRisk);
}
