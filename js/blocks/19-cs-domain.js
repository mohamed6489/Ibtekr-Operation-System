
/* Customer service domain rules (Figma page «خدمة العملاء» 422:28384): conversation status + SLA, WhatsApp 24h window,
   templates + variables, customer stage + rating, campaign audience / batches / safety, assignment, merge, quick replies,
   per-platform unread counts, automation rule matching, quiet hours. Pure functions — tested in csdomain.test.js. */
(function (root) {
  'use strict';
  const SLA = { warn: 10, late: 15 };
  const WAITING = ['جديدة', 'مستنية ردنا'];
  function slaLevel(status, waitingMin) { if (!WAITING.includes(status)) return 'none'; return waitingMin >= SLA.late ? 'late' : waitingMin >= SLA.warn ? 'warn' : 'none'; }
  function nextStatus(status, ev) {
    if (ev === 'note') return status;
    if (ev === 'in') return status == null ? 'جديدة' : 'مستنية ردنا';
    if (ev === 'out') return 'مستنية العميل';
    if (ev === 'resolve') return 'اتحلت';
    if (ev === 'snooze') return 'مؤجلة';
    if (ev === 'wake') return 'مستنية ردنا';
    return status;
  }
  const DAY = 24 * 3600e3;
  const windowOpen = (lastIn, now) => lastIn != null && now - lastIn < DAY;
  const VAR = /\{([^{}]+)\}/g;
  function templateVars(text) { const out = []; String(text).replace(VAR, (_, k) => { if (!out.includes(k)) out.push(k); return _; }); return out; }
  function fillTemplate(text, vars) { const missing = []; const t = String(text).replace(VAR, (m, k) => { const v = vars && vars[k]; if (v == null || v === '') { if (!missing.includes(k)) missing.push(k); return m; } return String(v); }); return { text: t, missing }; }
  const OPT_OUT = 'اكتب «إيقاف» لو مش عايز رسايل عروض.';
  const withOptOut = (t) => (/إيقاف/.test(t) ? t : String(t).trim() + '\n\n' + OPT_OUT);
  function customerStage({ orders = 0, total = 0, conversations = 1 }) {
    if (orders >= 10 || total >= 10000) return 'VIP';
    if (orders >= 2) return 'عميل متكرر';
    if (orders === 1) return 'عميل';
    return conversations >= 2 ? 'مهتم' : 'استفسار';
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  function customerRating({ orders = 0, refused = 0, returned = 0, openComplaints = 0, lateOpen = 0 }) {
    if (!orders) return null;
    const parts = [{ key: 'refused', label: 'رفض استلام', count: refused, delta: -1 * refused }, { key: 'returned', label: 'مرتجع', count: returned, delta: r1(-0.4 * returned) }, { key: 'complaints', label: 'شكاوى مفتوحة', count: openComplaints, delta: r1(-0.2 * openComplaints) }, { key: 'late', label: 'أوردر مفتوح متأخر', count: lateOpen, delta: r1(-0.2 * lateOpen) }];
    const value = r1(Math.min(5, Math.max(1, 5 + parts.reduce((a, p) => a + p.delta, 0))));
    return { value, stars: Math.round(value), parts: parts.map((p) => Object.assign(p, { delta: p.delta === 0 ? 0 : p.delta })) };
  }
  function validateRatingOverride(stars, reason) { if (!(stars >= 1 && stars <= 5)) return 'اختار تقييم من 1 لـ 5'; if (!reason || !String(reason).trim()) return 'سبب التعديل مطلوب'; return null; }
  function audience(list, f, ex) {
    const matched = list.filter((c) => (!f.stages || f.stages.includes(c.stage)) && (f.lastOrderWithin == null || (c.lastOrderDays != null && c.lastOrderDays <= f.lastOrderWithin)) && (f.minRating == null || (c.rating || 0) >= f.minRating) && (!f.channel || c.channel === f.channel));
    const excluded = { consent: 0, blocked: 0, complaint: 0, late: 0, recent: 0 }; const recipients = [];
    for (const c of matched) {
      if (!c.consent) { excluded.consent++; continue; }
      if (c.blocked) { excluded.blocked++; continue; }
      if (ex.complaint && c.openComplaint) { excluded.complaint++; continue; }
      if (ex.late && c.lateOrder) { excluded.late++; continue; }
      if (ex.recent && c.lastCampaignDays != null && c.lastCampaignDays <= 7) { excluded.recent++; continue; }
      recipients.push(c);
    }
    return { matched: matched.length, excluded, recipients };
  }
  function batches(total, cap, leftToday) { const out = []; let rest = total; const first = Math.min(rest, cap, Math.max(0, leftToday)); out.push(first); rest -= first; while (rest > 0) { const b = Math.min(rest, cap); out.push(b); rest -= b; } return out; }
  const validateDelay = (s) => (s < 20 ? 'أقل فاصل 20 ثانية' : null);
  const STOP_RATE = 0.02;
  const autoStop = ({ sent, blocked = 0, reported = 0 }) => sent > 0 && (blocked + reported) / sent > STOP_RATE;
  const canCampaignFrom = (ch) => ch === 'wa1';
  function assignNext(agents) { const on = agents.filter((a) => a.online); if (!on.length) return null; return on.reduce((b, a) => (a.open < b.open ? a : b)).id; }
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  function mergeProfiles(a, b) {
    return Object.assign({}, b, a, { channels: uniq([].concat(a.channels || [], b.channels || [])), tags: uniq([].concat(a.tags || [], b.tags || [])), orders: (a.orders || 0) + (b.orders || 0), total: (a.total || 0) + (b.total || 0),
      conversations: [].concat(a.conversations || [], b.conversations || []).sort((x, y) => x.at - y.at), mergedFrom: [].concat(a.mergedFrom || [], [b.id]) });
  }
  const quickReplies = (list, q) => (q && q[0] === '/' ? list.filter((x) => x.key.startsWith(q)) : []);
  const PLATFORMS = ['whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook'];
  function unreadBy(convs, seg) { const o = { all: 0 }; PLATFORMS.forEach((p) => { o[p] = 0; }); convs.filter((c) => c.seg === seg).forEach((c) => { o.all += c.unread || 0; o[c.platform] = (o[c.platform] || 0) + (c.unread || 0); }); return o; }
  function ruleMatches(rule, ev, firedFor) {
    if (!rule.on || rule.event !== ev.type) return false;
    if (rule.to && rule.to !== ev.to) return false;
    if (rule.once && ev.order && (firedFor || []).includes(ev.order)) return false;
    return (rule.conds || []).every((c) => (c.op === '=' ? ev.ctx[c.field] === c.value : c.op === '!=' ? ev.ctx[c.field] !== c.value : true));
  }
  const QUIET = { from: 22 * 60, to: 9 * 60 };
  function sendTime(min) { if (min >= QUIET.from) return QUIET.to + 24 * 60; if (min < QUIET.to) return QUIET.to; return min; }
  const api = { SLA, slaLevel, nextStatus, windowOpen, templateVars, fillTemplate, withOptOut, OPT_OUT, customerStage, customerRating, validateRatingOverride, audience, batches, validateDelay, autoStop, STOP_RATE, canCampaignFrom, assignNext, mergeProfiles, quickReplies, unreadBy, ruleMatches, sendTime, PLATFORMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrCS = api;
})(typeof window !== 'undefined' ? window : globalThis);

