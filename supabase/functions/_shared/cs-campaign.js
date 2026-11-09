// Campaigns on WhatsApp 1 through Meta's Cloud API (phase 13 T1, docs/superpowers/plans/2026-11-09-phase-13-leftovers.md decisions
// 1–4): the pure part cs-whatsapp's campaign_tick / campaign_test use — how many sends a tick may make, the approved template's
// parameters for one customer, the text we keep on the message row, the campaign's figures and its next status. No I/O; tested from
// node (tests/functions/cs-campaign.test.mjs). The bridge path (cs-wa, the QR numbers) keeps its own helpers in cs-wa.js.
import { shouldStop } from './cs-wa.js';
import { fill } from './cs-auto.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const MAX_PER_TICK = 3; // the cron fires every minute: at most three template sends a campaign a tick, spaced by min_delay_s
export const TICK_BUDGET_MS = 45_000; // the function stops opening new sends past this (the cron's own timeout is 60 s)
export const DONE_STATUSES = ['sent', 'delivered', 'read', 'replied', 'ordered', 'failed'];
export const REPLY_WINDOW_DAYS = 3; // a customer's message within three days of a campaign send counts as its reply (as the bridge does)
export const SAMPLE_VARS = Object.freeze({ 'اسم_العميل': 'نهى', 'كود_الخصم': 'TEST10' }); // what a test send puts in the template

// how many sends this tick may open for a campaign (one a minute at least, three at most, by its own pause)
export const perTick = (minDelayS) => Math.max(1, Math.min(MAX_PER_TICK, Math.floor(60 / Math.max(1, Number(minDelayS) || 20))));

// the template's body parameters for one customer, in wa_vars order: {اسم_العميل} = the first name (a nameless customer gets
// «عميلنا» — Meta refuses an empty parameter), {كود_الخصم} = the campaign's code; any other variable has no value in a campaign →
// listed in `missing` (the recipient fails with missing_var, nothing is sent)
export function campaignParams(template, { name, code } = {}) {
  const vars = isObj(template) && Array.isArray(template.wa_vars) ? template.wa_vars : [];
  const first = String(name ?? '').trim().split(/\s+/)[0] || '';
  const missing = [];
  const params = vars.map((k) => { const v = k === 'اسم_العميل' ? first || 'عميلنا' : k === 'كود_الخصم' ? String(code ?? '').trim() : ''; if (!v) missing.push(k); return v; });
  return { params, missing };
}
// the text kept on the message row: the template's body with the same values (what the customer sees, as far as we know it)
export function campaignPreview(template, { name, code } = {}) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || 'عميلنا';
  return fill(isObj(template) ? String(template.body ?? '') : '', { 'اسم_العميل': first, 'كود_الخصم': String(code ?? '').trim() }).text.trim() || (isObj(template) ? String(template.name ?? '') : '');
}
// the recipients' statuses → the campaign's figures (the same shape the bridge writes in cs-wa)
export function campaignStats(statuses) {
  const counts = {}; for (const s of Array.isArray(statuses) ? statuses : []) counts[s] = (counts[s] ?? 0) + 1;
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.replied ?? 0) + (counts.ordered ?? 0);
  return { sent, delivered: (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.replied ?? 0), read: (counts.read ?? 0) + (counts.replied ?? 0), replies: counts.replied ?? 0, failed: counts.failed ?? 0, opted_out: counts.opted_out ?? 0, queued: counts.queued ?? 0 };
}
// a running campaign's next status from its figures: paused over the failure rate, finished when nothing is queued, else unchanged
export const nextStatus = (stats) => (shouldStop({ sent: stats.sent, failed: stats.failed }) ? 'متوقفة' : !stats.queued ? 'خلصت' : null);
// a delivery receipt on a campaign message → the recipient's status, never backwards (sent → delivered → read; failed only before read)
const RANK = { queued: 0, sent: 1, delivered: 2, read: 3, replied: 4, ordered: 5 };
export function recipientAfter(current, delivery) {
  if (delivery === 'failed') return RANK[current] >= RANK.read ? null : 'failed';
  if (!(delivery in RANK) || !(current in RANK)) return null;
  return RANK[delivery] > RANK[current] ? delivery : null;
}
// a campaign row is sendable on Meta only with a template that carries an approved Meta template name
export const templateOk = (t) => isObj(t) && typeof t.wa_template === 'string' && /^[a-z0-9_]{1,120}$/.test(t.wa_template) && t.active !== false;
