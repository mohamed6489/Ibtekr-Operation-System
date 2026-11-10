
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
  // ---- تقييم الفريق للعميل بعد «مكتمل» (owner 27 Oct): رضا · أخلاق · احترام — كل واحد نجوم 1–5
  const RATE_KEYS = [['sat', 'رضا العميل'], ['manners', 'أخلاق العميل']]; // الاحترام اتشال (owner 27 Oct 05:56)
  const okStar = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
  function validateTeamRating(r) { const e = {}; RATE_KEYS.forEach(([k, l]) => { if (!okStar(r && r[k])) e[k] = 'اختار ' + l + ' من 1 لـ 5'; }); return e; }
  const rt1 = (x) => Math.round(x * 10) / 10;
  function teamRatingSummary(list) {
    const L = (list || []).filter((x) => RATE_KEYS.every(([k]) => okStar(x[k]))); if (!L.length) return { count: 0, avg: null, overall: null, last: null };
    const avg = {}; RATE_KEYS.forEach(([k]) => { avg[k] = rt1(L.reduce((a, x) => a + x[k], 0) / L.length); });
    return { count: L.length, avg, overall: rt1(RATE_KEYS.reduce((a, [k]) => a + avg[k], 0) / RATE_KEYS.length), last: L[0] };
  }
  // ---- شرايح العملاء (owner 27 Oct): اسم + إجمالي شراء ≥ قيمة + عدد أوردرات ≥ + مدى لكل تقييم (1–5)
  const FULL = [1, 5];
  const rangeOf = (seg, k) => (seg.ranges && seg.ranges[k]) || FULL;
  const isFull = (r) => r[0] === 1 && r[1] === 5;
  // عضوية يدوية فوق الشروط (owner 28 Oct): add = اتضافوا بالإيد، remove = اتشالوا بالإيد
  const inList = (l, id) => Array.isArray(l) && l.indexOf(id) > -1;
  // حالة العميل + تاريخ آخر أوردر (owner 1 Nov)
  const LAST = { in7: ['خلال آخر 7 أيام', 0, 7], in30: ['خلال آخر 30 يوم', 0, 30], in90: ['خلال آخر 90 يوم', 0, 90], gt30: ['مااشتروش من 30 يوم أو أكتر', 30, Infinity], gt60: ['مااشتروش من 60 يوم أو أكتر', 60, Infinity], gt90: ['مااشتروش من 90 يوم أو أكتر', 90, Infinity] };
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
  function lastOrderOk(cu, seg, today) {
    if (!seg.last) return true;
    const d = cu.lastOrderDays; if (d == null) return false;
    if (seg.last === 'range') { const t = today || '2026-10-21'; const from = seg.lastFrom ? dayDiff(t, seg.lastFrom) : Infinity, to = seg.lastTo ? dayDiff(t, seg.lastTo) : 0; return d <= from && d >= to; }
    const L = LAST[seg.last]; return !!L && d >= L[1] && d <= L[2];
  }
  const moodOfCu = (cu) => cu.mood || 'متوسط';
  function segmentMatch(cu, seg, summary, today) {
    if (inList(seg.remove, cu.id)) return false;
    if (inList(seg.add, cu.id)) return true;
    if (!hasRules(seg)) return false;
    if (Array.isArray(seg.moods) && seg.moods.length && seg.moods.indexOf(moodOfCu(cu)) < 0) return false;
    if (!lastOrderOk(cu, seg, today)) return false;
    if (seg.minTotal != null && seg.minTotal !== '' && !((cu.total || 0) >= Number(seg.minTotal))) return false;
    if (seg.minOrders != null && seg.minOrders !== '' && !((cu.orders || 0) >= Number(seg.minOrders))) return false;
    const limited = RATE_KEYS.filter(([k]) => !isFull(rangeOf(seg, k)));
    if (!limited.length) return true;
    if (!summary || !summary.count) return !!seg.includeUnrated;
    return limited.every(([k]) => { const r = rangeOf(seg, k); const v = Math.round(summary.avg[k]); return v >= r[0] && v <= r[1]; });
  }
  const hasRules = (seg) => (Array.isArray(seg.moods) && seg.moods.length > 0) || !!seg.last || (seg.minTotal !== '' && seg.minTotal != null) || (seg.minOrders !== '' && seg.minOrders != null) || RATE_KEYS.some(([k]) => !isFull(rangeOf(seg, k)));
  function validateSegment(seg, names) {
    const e = {}; const n = String(seg.name || '').trim();
    if (!n) e.name = 'اكتب اسم الشريحة'; else if ((names || []).some((x) => String(x).trim().toLowerCase() === n.toLowerCase())) e.name = 'فيه شريحة بنفس الاسم';
    ['minTotal', 'minOrders'].forEach((k) => { const v = seg[k]; if (v !== '' && v != null && !(Number(v) >= 0 && isFinite(Number(v)))) e[k] = 'اكتب رقم صحيح'; });
    RATE_KEYS.forEach(([k, l]) => { const r = rangeOf(seg, k); if (!(okStar(r[0]) && okStar(r[1]))) e[k] = 'من 1 لـ 5'; else if (r[0] > r[1]) e[k] = '«من» لازم تكون أقل من أو تساوي «لحد»'; });
    if (seg.last === 'range') { if (!seg.lastFrom && !seg.lastTo) e.last = 'اختار تاريخ «من» أو «لحد»'; else if (seg.lastFrom && seg.lastTo && seg.lastFrom > seg.lastTo) e.last = '«من» لازم يكون قبل «لحد»'; }
    const any = hasRules(seg) || (Array.isArray(seg.add) && seg.add.length);
    if (!any && !e.name) e.rules = 'حط شرط واحد على الأقل (حالة العميل أو آخر أوردر أو قيمة شراء أو عدد أوردرات أو تقييم) أو ضيف عملاء بالإيد';
    return e;
  }
  function segmentLabel(seg) {
    const p = [];
    if (Array.isArray(seg.moods) && seg.moods.length) p.push('الحالة: ' + seg.moods.join(' أو '));
    if (seg.last === 'range') p.push('آخر أوردر ' + (seg.lastFrom ? 'من ' + seg.lastFrom.split('-').reverse().join('/') : '') + (seg.lastTo ? ' لـ ' + seg.lastTo.split('-').reverse().join('/') : ''));
    else if (seg.last && LAST[seg.last]) p.push('آخر أوردر ' + LAST[seg.last][0].replace('مااشتروش', 'من غير شراء'));
    if (seg.minTotal !== '' && seg.minTotal != null) p.push('إجمالي الشراء ≥ ' + Number(seg.minTotal).toLocaleString('en-US') + ' ج.م');
    if (seg.minOrders !== '' && seg.minOrders != null) p.push('الأوردرات ≥ ' + seg.minOrders);
    RATE_KEYS.forEach(([k, l]) => { const r = rangeOf(seg, k); if (!isFull(r)) p.push(l.replace(' العميل', '') + ' ' + (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]) + '★'); });
    if (RATE_KEYS.some(([k]) => !isFull(rangeOf(seg, k)))) p.push(seg.includeUnrated ? '+ اللي لسه ما اتقيّموش' : 'المتقيّمين بس');
    if (Array.isArray(seg.add) && seg.add.length) p.push('+ ' + seg.add.length + ' عميل متضافين بالإيد');
    if (Array.isArray(seg.remove) && seg.remove.length) p.push('− ' + seg.remove.length + ' متشالين بالإيد');
    return p.join(' · ');
  }
  // ---- اختيار عملاء من شيت (owner 27 Oct): بندوّر على عمود الموبايل ونطابق بالرقم
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  function normPhone(v) { let d = String(v == null ? '' : v).replace(/[٠-٩]/g, (c) => String(AR_DIG.indexOf(c))).replace(/\D/g, ''); if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2); if (d.length === 10 && d[0] === '1') d = '0' + d; return d; }
  const isPhone = (v) => /^01[0125]\d{8}$/.test(normPhone(v));
  function phoneColumn(headers, rows) {
    const byName = headers.findIndex((x) => /موبايل|موبيل|تليفون|هاتف|رقم|phone|mobile|whatsapp|واتساب/i.test(x)); if (byName >= 0) return byName;
    let best = -1, n = 0; headers.forEach((_, i) => { const c = rows.filter((r) => isPhone(r[i])).length; if (c > n) { n = c; best = i; } }); return best;
  }
  function matchSheet(parsed, customers) {
    const col = phoneColumn(parsed.headers || [], parsed.rows || []); if (col < 0) return { col: -1, error: 'مش لاقيين عمود فيه أرقام موبايل — سمّي العمود «الموبايل»', matched: [], missing: [], invalid: 0, total: (parsed.rows || []).length };
    const idx = new Map(); customers.forEach((c) => { const k = normPhone(c.phone); if (k) idx.set(k, c.id); });
    const matched = [], missing = [], newRows = []; let invalid = 0; const seen = new Set();
    const nameCol = (parsed.headers || []).findIndex((x, i) => i !== col && /اسم|name/i.test(String(x || '')));
    parsed.rows.forEach((r) => { const raw = r[col]; const k = normPhone(raw); if (!isPhone(k)) { if (String(raw || '').trim()) invalid++; return; } if (seen.has(k)) return; seen.add(k); const id = idx.get(k); if (id) matched.push(id); else { missing.push(k); newRows.push({ phone: k, name: nameCol > -1 ? String(r[nameCol] || '').trim() : '' }); } });
    return { col, header: parsed.headers[col], matched, missing, newRows, invalid, total: parsed.rows.length };
  }

  // ---- امتى يتبعت القالب (owner 28 Oct): لكل تصنيف مشغّلاته، واختيار من متعدد
  const TRIGGERS = {
    'حالة الأوردر': { label: 'يتبعت لما الأوردر يبقى', opts: ['جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن', 'مكتمل', 'معلق', 'ملغي', 'مرتجع'] },
    'متابعة': { label: 'يتبعت عند', opts: ['بعد التسليم بيوم', 'ترك السلة', 'قبل ميعاد الشحن بيوم', 'الأوردر بقى قابل للتأخير', 'عميل ما اشتراش من 30 يوم'] },
    'شكاوى': { label: 'يتبعت عند', opts: ['تذكرة جديدة', 'تقييم أقل من 3 نجوم', 'شكوى اتسجلت', 'تأخير عدّى 11 يوم'] },
    'تسويق': { label: 'يتبعت في', opts: ['حملات بس', 'إطلاق منتج جديد', 'عرض موسمي', 'عملاء شريحة محددة'] },
    'أوردرات فرعية': { label: 'يتبعت لما الأوردر الفرعي يبقى', opts: ['أوردر فرعي جديد', 'متأكد من المبتكر', 'قبل التسليم بيومين', 'جاهز للتسليم', 'اتسلم', 'اتلغى'] },
    'تأخير': { label: 'يتبعت عند', opts: ['قابل للتأخير (9–11 يوم من التأكيد)', 'متأخر (أكتر من 11 يوم من التأكيد)', 'عدّى ميعاد التسليم', 'مفيش رد من المبتكر 24 ساعة'] },
    'تحويلات': { label: 'يتبعت عند', opts: ['تحويل اتسجل', 'كشف حساب اتقفل', 'طلب سحب اتوافق عليه'] },
    'جودة': { label: 'يتبعت عند', opts: ['قبل التسليم بيوم', 'مرتجع من العميل', 'تقييم المبتكر أقل من 3', 'طلب صور قبل الشحن'] },
  };
  const TRIG_WHEN = ['فورًا', 'بعد ساعة', 'بعد 3 ساعات', 'بعد يوم', 'بعد يومين'];
  function triggerText(t) {
    if (!t || t.trigKind === 'manual') return 'يدوي من الشات';
    if (t.trigKind === 'campaign') return 'حملات بس';
    const on = Array.isArray(t.trigOn) ? t.trigOn : [];
    if (!on.length) return 'تلقائي — لسه ما اتحددش المشغّل';
    const head = (TRIGGERS[t.cat] || { label: 'يتبعت عند' }).label;
    const when = t.trigWhen && t.trigWhen !== 'فورًا' ? ' · ' + t.trigWhen : '';
    return 'تلقائي: ' + head + ' ' + on.map((x) => '«' + x + '»').join(' أو ') + when;
  }
  function validateTrigger(t) {
    const e = {};
    if (t.trigKind === 'auto' && !(Array.isArray(t.trigOn) && t.trigOn.length)) e.trigOn = 'اختار مشغّل واحد على الأقل';
    const opts = (TRIGGERS[t.cat] || { opts: [] }).opts;
    if (t.trigKind === 'auto' && Array.isArray(t.trigOn) && t.trigOn.some((x) => opts.indexOf(x) < 0)) e.trigOn = 'فيه مشغّل مش من التصنيف ده';
    return e;
  }
  const api = { SLA, slaLevel, nextStatus, windowOpen, templateVars, fillTemplate, withOptOut, OPT_OUT, customerStage, customerRating, validateRatingOverride, audience, batches, validateDelay, autoStop, STOP_RATE, canCampaignFrom, assignNext, mergeProfiles, quickReplies, unreadBy, ruleMatches, sendTime, PLATFORMS, RATE_KEYS, validateTeamRating, teamRatingSummary, segmentMatch, validateSegment, segmentLabel, SEG_LAST: LAST, segmentHasRules: hasRules, TRIGGERS, TRIG_WHEN, triggerText, validateTrigger, normPhone, phoneColumn, matchSheet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrCS = api;
})(typeof window !== 'undefined' ? window : globalThis);

