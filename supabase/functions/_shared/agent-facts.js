// The numbers the assistants' rules watch, counted from the system's own rows (the owner 22 Nov — docs/superpowers/plans/
// 2026-11-22-system-brain.md). Pure: no database and no network — the scheduled check (notify) reads the rows and hands them here,
// and the tests' stand-in hands its own. A part that was not read (null) leaves its numbers null: the rule on it keeps its note as
// it is instead of clearing it on a failed read. One key a metric of _shared/agent-rules.js (METRICS).
import { DELAY_STOP, delayRules, isConfirmed, leadBy, lineDelayOf, lineElapsed, orderDelayOf, orderElapsed } from './delay.js';

/** The order statuses that are over — everything else is open. */
export const ORDER_CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
/** A request still on someone's desk. */
export const TICKET_OPEN = ['open', 'in_progress', 'waiting', 'reopened'];
/** A team request for a decision that was not taken yet. */
export const HR_WAITING = ['جديد', 'قيد المراجعة'];
const D = 86400000;
const list = (v) => (Array.isArray(v) ? v : null);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * d = {
 *   delay,                       the settings' delay rules (makers.delay)
 *   orders   [{ id, status, confirm, confirm_at, placed_at }]      open orders, not removed
 *   items    [{ order_id, vendor_id, product_id, status, removed, expected_at }]
 *   vendors  [{ id, status, lead_days, archived_at }]
 *   productLead { <product id>: days }
 *   bankless number              active makers with no bank account kept (counted by the database — no account ever read here)
 *   lots     [{ reason, status, closed_at }]
 *   tickets  [{ status, priority, follow_up, assignee_role }]
 *   designRole string            the name of the designer assistant's team
 *   convs    [{ seg, status, waiting_since }]
 *   withdrawals [{ status }]
 *   subs     [{ sub_ends, voided_at }]
 *   hrRequests [{ status }], overtime [{ status }]
 *   suggestions [{ status }], adStats [{ level, day, spend }], posts [{ status, deleted_at }]
 *   checks   [{ kind, data }]
 * } — any part null / absent = not read.
 * today = the Cairo day (YYYY-MM-DD), nowMs = the moment.
 */
export function countFacts(d, today, nowMs) {
  const f = {}; const x = d || {}; const rules = delayRules(x.delay);
  const orders = list(x.orders); const items = list(x.items); const vendors = list(x.vendors);
  if (orders) {
    const open = orders.filter((o) => !ORDER_CLOSED.includes(str(o.status)));
    f.orders_unconfirmed = open.filter((o) => !isConfirmed(o.confirm)).length;
    if (items) {
      const vend = new Map((vendors || []).map((v) => [str(v.id), v])); const PL = x.productLead || {};
      const byOrder = new Map(); for (const l of items) { if (l.removed || str(l.status) === 'ملغي') continue; const k = str(l.order_id); if (!byOrder.has(k)) byOrder.set(k, []); byOrder.get(k).push(l); }
      const leadOf = (l) => leadBy(l.product_id != null ? PL[str(l.product_id)] : null, (vend.get(str(l.vendor_id)) || {}).lead_days, rules);
      let late = 0; let risk = 0; const lateMakers = new Set();
      for (const o of open) {
        const start = { confirm: o.confirm, confirmAt: o.confirm_at, placedAt: o.placed_at }; const ls = byOrder.get(str(o.id)) || []; const leads = ls.map(leadOf);
        const s = orderDelayOf({ status: o.status, elapsed: orderElapsed(start, today, rules), maxLead: leads.length ? Math.max(...leads) : rules.lead }, rules);
        if (s === 'late') late++; else if (s === 'risk') risk++;
        if (!DELAY_STOP.includes(str(o.status))) ls.forEach((l, i) => { if (l.vendor_id && lineDelayOf(lineElapsed({ notifiedAt: l.expected_at, ...start }, today, rules), leads[i], true, rules, o.status) === 'late') lateMakers.add(str(l.vendor_id)); });
      }
      f.orders_late = late; f.orders_risk = risk; f.makers_late = lateMakers.size;
    } else { f.orders_late = null; f.orders_risk = null; f.makers_late = null; }
  } else { f.orders_unconfirmed = null; f.orders_late = null; f.orders_risk = null; f.makers_late = null; }
  f.makers_no_bank = Number.isInteger(x.bankless) && x.bankless >= 0 ? x.bankless : null;
  const lots = list(x.lots); f.returns_waiting = lots ? lots.filter((l) => !l.closed_at && l.reason === 'مرتجع' && l.status === 'بانتظار الفحص').length : null;
  const tk = list(x.tickets) ? x.tickets.filter((t) => TICKET_OPEN.includes(str(t.status))) : null;
  f.tickets_urgent = tk ? tk.filter((t) => t.priority === 'urgent').length : null;
  f.tickets_overdue = tk ? tk.filter((t) => t.follow_up && str(t.follow_up).slice(0, 10) < today).length : null;
  f.design_requests = tk ? (x.designRole ? tk.filter((t) => t.assignee_role === x.designRole).length : 0) : null;
  const cv = list(x.convs);
  if (cv) { const w = cv.filter((c) => c.seg === 'customers' && c.status === 'مستنية ردنا'); f.cs_waiting = w.length;
    const since = w.map((c) => Date.parse(c.waiting_since)).filter(Number.isFinite); f.cs_waiting_minutes = since.length ? Math.max(0, Math.floor((nowMs - Math.min(...since)) / 60000)) : 0;
  } else { f.cs_waiting = null; f.cs_waiting_minutes = null; }
  const wd = list(x.withdrawals); f.withdraw_pending = wd ? wd.filter((w) => w.status === 'pending').length : null;
  const subs = list(x.subs); const ends = subs ? subs.filter((e) => !e.voided_at && e.sub_ends && str(e.sub_ends).slice(0, 10) >= today).map((e) => Math.round((Date.parse(str(e.sub_ends).slice(0, 10) + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / D)) : [];
  f.sub_days_left = ends.length ? Math.min(...ends) : null;
  const hr = list(x.hrRequests); f.hr_requests_pending = hr ? hr.filter((r) => HR_WAITING.includes(str(r.status))).length : null;
  const ot = list(x.overtime); f.overtime_pending = ot ? ot.filter((r) => r.status === 'مستني').length : null;
  const sg = list(x.suggestions); f.ads_suggestions = sg ? sg.filter((s) => s.status === 'pending').length : null;
  const from = new Date(Date.parse(today + 'T00:00:00Z') - 6 * D).toISOString().slice(0, 10);
  const st = list(x.adStats); f.ads_spend_week = st ? Math.round(st.filter((s) => s.level === 'campaign' && str(s.day) >= from && str(s.day) <= today).reduce((n, s) => n + (Number(s.spend) || 0), 0)) : null;
  const ps = list(x.posts); f.posts_failed = ps ? ps.filter((p) => p.status === 'فشل' && !p.deleted_at).length : null;
  const ck = list(x.checks); const check = (kind) => (ck || []).find((c) => c.kind === kind); const sp = check('pagespeed'); const wp = check('wp_updates');
  f.site_speed = sp && sp.data && Number.isFinite(sp.data.score) ? sp.data.score : null;
  f.site_updates = wp && wp.data && Number.isFinite(wp.data.updates) ? wp.data.updates : null;
  return f;
}

/** The store of the row «store» (0127): a platform without Dokan, or the single-seller mode = no makers. */
export const singleOf = (st) => { const s = st && typeof st === 'object' ? st : {}; return s.mode === 'single' || s.dokan === false || s.dokan === 'false' || (!!s.platform && s.platform !== 'woo'); };
