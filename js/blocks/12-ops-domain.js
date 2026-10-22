
/* Ops business rules for HR, inventory hub, orders returns, tasks and login. Pure functions — no DOM. Tested in opsdomain.test.js. */
(function (root) {
  'use strict';
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // ---------- HR config (settings › الموارد البشرية) ----------
  const HR = { workDays: 24, shiftHours: 8, offDays: [5, 6] /* Fri, Sat */, presenceEvery: 120, presenceTimeoutSec: 60, escalateHours: 24, bonusFloor: 70 };

  function rates(salary) { const daily = r2(salary / HR.workDays); return { daily, hourly: r2(salary / HR.workDays / HR.shiftHours) }; }
  function overtimePay(salary, { hours = 0, offDays = 0 }) { const d = salary / HR.workDays; return r2(d / HR.shiftHours * hours + d * 2 * offDays); }
  const monthlyPaid = (salary, holdback) => r2(salary - holdback);
  function rating(score) { return score >= 100 ? 'ممتاز' : score >= 85 ? 'جيد' : score >= 70 ? 'محتاج تحسين' : 'إنذار'; }
  const RATING_TONE = { 'ممتاز': 'success', 'جيد': 'brand', 'محتاج تحسين': 'orange', 'إنذار': 'error' };
  function monthBonus(holdback, score) { return score < HR.bonusFloor ? 0 : r2(holdback * Math.min(score, 100) / 100); }
  const quarterBonus = (holdback, scores) => r2(scores.reduce((s, x) => s + monthBonus(holdback, x), 0));
  function quarterBad(scores) { const avg = scores.reduce((a, b) => a + b, 0) / scores.length; return avg < 70 || scores.filter((s) => s < 70).length >= 2; }
  const isoDay = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function leaveDays(from, to, holidays = []) {
    let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (!HR.offDays.includes(isoDay(d)) && !holidays.includes(d)) n++;
    return n;
  }
  function payslip({ salary, holdback = 0, otHours = 0, otOffDays = 0, bonus = 0, deductions = 0, advances = 0, absentDays = 0 }) {
    const paid = monthlyPaid(salary, holdback); const overtime = overtimePay(salary, { hours: otHours, offDays: otOffDays });
    const absence = r2(rates(salary).daily * absentDays);
    return { paid, overtime, bonus, deductions, advances, absence, net: r2(paid + overtime + bonus - deductions - advances - absence) };
  }

  // ---------- shift / overtime ----------
  function shiftState(minutes) { return minutes == null ? 'out' : minutes >= HR.shiftHours * 60 ? 'overtime' : 'in'; }
  const presenceDue = (otMinutes, every = HR.presenceEvery) => otMinutes > 0 && otMinutes % every === 0;
  function presenceOutcome({ shownAt, repliedAt, now }) {
    if (repliedAt != null && repliedAt - shownAt <= HR.presenceTimeoutSec * 1000) return 'continue';
    return now - shownAt > HR.presenceTimeoutSec * 1000 ? 'ended' : 'waiting';
  }
  function reviewOvertime({ minutes, salary }, { decision, minutes: chosen }) {
    if (decision === 'reject') return { status: 'وقت إضافي اترفض', paidMinutes: 0, pay: 0, meeting: true };
    const m = chosen == null ? minutes : chosen;
    if (m < 0 || m > minutes) throw new Error('لا يمكن إضافة وقت أكتر من المسجل');
    return { status: 'اتضاف', paidMinutes: m, pay: r2(salary / HR.workDays / HR.shiftHours * m / 60), meeting: false };
  }
  const otReviewer = (hoursWaiting) => (hoursWaiting >= HR.escalateHours ? 'الأدمن' : 'المدير المباشر');
  const validateOtEnd = (note) => (String(note || '').trim() ? null : 'اكتب اشتغلت على إيه في الوقت الإضافي');

  // ---------- inventory hub ----------
  const REASONS = ['تجميع أوردر', 'مرتجع', 'تصوير', 'متاح للبيع'];
  const STATUS_BY_REASON = { 'تجميع أوردر': ['وصل المخزن', 'جاهز يطلع كامل'], 'مرتجع': ['بانتظار الفحص', 'تالف', 'راجع للمبتكر'], 'تصوير': ['مستني تصوير', 'اتصور', 'راجع للمبتكر'], 'متاح للبيع': ['متاح', 'محجوز لأوردر'] };
  const INV = { consolidationAlertDays: 5, photoMaxDays: 14, reserveMinutes: 30 };
  function stockFromLedger(moves) {
    const out = {};
    for (const m of moves) {
      const s = out[m.sku] || (out[m.sku] = { onHand: 0, reserved: 0, available: 0 });
      if (m.type === 'in') s.onHand += m.qty;
      else if (m.type === 'out' || m.type === 'adjust') s.onHand += m.type === 'out' ? -m.qty : m.qty;
      else if (m.type === 'reserve') s.reserved += m.qty;
      else if (m.type === 'release') s.reserved -= m.qty;
      else if (m.type === 'ship') { s.onHand -= m.qty; s.reserved -= m.qty; }
    }
    for (const k in out) out[k].available = out[k].onHand - out[k].reserved;
    return out;
  }
  const canAutoPull = (item, qty) => item.reason === 'متاح للبيع' && item.available >= qty;
  // حالة المنتج when received as a return (owner, 22 Oct) — feeds the inspection default
  const RETURN_CONDITIONS = Object.freeze([
    { value: 'سليم', label: 'سليم', hint: 'زي ما اتباع — بالتغليف' }, { value: 'تغليف متضرر', label: 'التغليف متضرر', hint: 'المنتج سليم والتغليف محتاج يتغيّر' },
    { value: 'عيب بسيط', label: 'فيه عيب بسيط', hint: 'يتصلح أو يتباع بخصم' }, { value: 'ناقص', label: 'ناقص قطع / مش كامل', hint: 'لازم نكلّم العميل أو المبتكر' },
    { value: 'تالف', label: 'تالف', hint: 'مش هينفع يتباع' }]);
  const CONDITION_NEEDS_NOTE = ['عيب بسيط', 'ناقص', 'تالف'];
  function validateReceive({ sku, qty, reason, condition, conditionNote }) {
    const e = {}; if (!sku) e.sku = 'اختار المنتج'; if (!(Number(qty) >= 1)) e.qty = 'الكمية لازم تكون 1 أو أكتر'; if (!reason) e.reason = 'اختار سبب الاستلام';
    if (reason === 'مرتجع') { if (!condition) e.condition = 'اختار حالة المنتج'; else if (CONDITION_NEEDS_NOTE.includes(condition) && !String(conditionNote || '').trim()) e.conditionNote = 'اكتب وصف الحالة'; }
    return e;
  }
  // «وصل المخزن» chosen on a sub-order (owner 22 Oct): pick the storage reason from the warehouse reasons
  const arrivalReason = (inConsolidation) => (inConsolidation ? 'تجميع أوردر' : '');
  const ARRIVAL = { 'تجميع أوردر': ['دخول — تجميع', 'T'], 'مرتجع': ['دخول — مرتجع', 'R'], 'تصوير': ['دخول — تصوير', 'P'], 'متاح للبيع': ['دخول — للبيع', 'A'] };
  function arrivalStock({ reason, order, sid }) {
    if (!ARRIVAL[reason]) throw new Error('unknown storage reason: ' + reason);
    return { status: STATUS_BY_REASON[reason][0], ref: reason === 'تجميع أوردر' ? 'IB-' + order : '#' + sid, label: ARRIVAL[reason][0], zone: ARRIVAL[reason][1] };
  }
  const inspectDefault = (condition) => (!condition ? undefined : condition === 'تالف' ? 'تالف' : 'سليم');
  const consolidationLate = (days) => days >= INV.consolidationAlertDays;
  const photoOverdue = (days) => days >= INV.photoMaxDays;
  function consolidation(statuses) { const arrived = statuses.filter((s) => s === 'وصل المخزن').length; return { arrived, total: statuses.length, ready: arrived === statuses.length }; }
  function countDiff(lines) {
    const d = lines.filter((l) => l.counted !== l.system);
    return { items: d.length, units: d.reduce((s, l) => s + l.counted - l.system, 0), value: r2(d.reduce((s, l) => s + (l.counted - l.system) * l.cost, 0)) };
  }

  // ---------- orders: returns ----------
  const RETURN_REASONS = ['العميل رفض الاستلام', 'العميل غيّر رأيه', 'فيه عيب', 'مقاس/لون غلط', 'وصل متأخر', 'اتكسر في الشحن', 'أخرى'];
  // owner 22 Oct: a cancelled main order always records why (feeds the «أوردرات ملغية» report)
  // Owner (22 Oct): how many times an alert is re-sent and how many hours apart.
  const NOTIF_COUNTS = Object.freeze(['مرة واحدة', '2 مرات', '3 مرات', '5 مرات', 'لحد ما يتحل']);
  const NOTIF_EVERY = Object.freeze(['كل ساعة', 'كل 2 ساعة', 'كل 4 ساعات', 'كل 6 ساعات', 'كل 12 ساعة', 'كل 24 ساعة', 'أسبوعيًا', 'أيام محددة من الشهر']);
  const isOnce = (c) => !c || c === 'مرة واحدة';
  // Owner (22 Oct): a daily cadence (every 24h, or once) goes out at a chosen clock time — default 12:00 ص (midnight).
  const NOTIF_DEFAULT_AT = '12:00 ص';
  const NOTIF_TIMES = Object.freeze(Array.from({ length: 24 }, (_, h) => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'ص' : 'م')));
  const isDaily = (e) => (e || 'كل 24 ساعة') === 'كل 24 ساعة' || e === 'أيام محددة من الشهر' || e === 'أسبوعيًا';
  // Owner (22 Oct): weekly sends on a chosen weekday (vendor weekly report = Sunday). Index = JS getUTCDay order shifted to start Saturday.
  const WEEKDAYS = Object.freeze(['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']);
  const jsDay = (name) => (WEEKDAYS.indexOf(name) + 6) % 7; // السبت → 6, الأحد → 0
  function weeklyPeriod(today, weekday) {
    const t = Date.parse(today + 'T00:00:00Z'); const back = (new Date(t).getUTCDay() - jsDay(weekday || 'الأحد') + 7) % 7; const due = t - back * 86400000;
    const f = (ms) => new Date(ms).toISOString().slice(0, 10);
    return { from: f(due - 7 * 86400000), to: f(due - 86400000), due: f(due), next: f(due + 7 * 86400000) };
  }
  // Owner (22 Oct): send on chosen days of the month — numbers 1–28 and «آخر يوم» ('last').
  const MONTH_DAYS = Object.freeze(Array.from({ length: 28 }, (_, i) => i + 1).concat('last'));
  const sortDays = (days) => [...new Set(days || [])].sort((a, b) => (a === 'last' ? 99 : a) - (b === 'last' ? 99 : b));
  const monthDaysLabel = (days) => sortDays(days).map((d) => (d === 'last' ? 'آخر يوم في الشهر' : 'يوم ' + d)).join(' + ');
  const isoD = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const lastOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const addDay = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  function monthDaysPeriod(today, days) {
    const [y, m] = today.split('-').map(Number); const sends = [];
    for (let k = -3; k <= 2; k++) { const dt = new Date(Date.UTC(y, m - 1 + k, 1)); const Y = dt.getUTCFullYear(), M = dt.getUTCMonth() + 1, L = lastOf(Y, M);
      for (const d of sortDays(days)) sends.push({ date: isoD(Y, M, d === 'last' ? L : Math.min(d, L)), last: d === 'last' }); }
    const u = []; for (const x of sends.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) if (!u.length || u[u.length - 1].date !== x.date) u.push(x); else if (x.last) u[u.length - 1].last = true;
    // a numeric send the day after an «آخر يوم» send would cover nothing — drop it
    for (let j = u.length - 1; j > 0; j--) if (!u[j].last && u[j - 1].last && addDay(u[j - 1].date, 1) === u[j].date) u.splice(j, 1);
    let i = -1; u.forEach((x, j) => { if (x.date <= today) i = j; });
    const due = u[i], prev = u[i - 1], next = u[i + 1];
    return { from: prev.last ? addDay(prev.date, 1) : prev.date, to: due.last ? due.date : addDay(due.date, -1), due: due.date, next: next.date };
  }
  const notifRepeat = (count, every, at, days, weekday) => { if (every === 'أسبوعيًا') return 'كل أسبوع يوم ' + (weekday || 'الأحد') + ' · الساعة ' + (at || NOTIF_DEFAULT_AT);
    if (every === 'أيام محددة من الشهر') return (isOnce(count) ? 'مرة واحدة' : count) + ' · ' + (days && days.length ? monthDaysLabel(days) : 'اختار الأيام') + ' · الساعة ' + (at || NOTIF_DEFAULT_AT);
    const time = ' · الساعة ' + (at || NOTIF_DEFAULT_AT);
    if (isOnce(count)) return every && isDaily(every) ? 'مرة واحدة' + time : 'مرة واحدة';
    const e = every || 'كل 24 ساعة'; return count + ' · ' + e + (isDaily(e) ? time : ''); };
  const everyHours = (e) => (/كل ساعة/.test(e || '') ? 1 : parseInt(String(e || '').replace(/[^0-9]/g, ''), 10) || 24);
  function notifSchedule(count, every) {
    if (isOnce(count)) return [0];
    const n = /^\d+/.test(count) ? parseInt(count, 10) : 3; const g = everyHours(every);
    return Array.from({ length: n }, (_, i) => i * g);
  }
  const NOTIF_TEAMS = Object.freeze(['أدمن', 'خدمة العملاء', 'متابعة الموردين', 'العمليات', 'المخزن', 'الحسابات', 'المدير المباشر', 'المسؤول عن التذكرة', 'المسؤول عن التوصيل', 'المورد (واتساب)']);
  // Owner (22 Oct): vendors can receive alerts — always on WhatsApp, on the number in their profile.
  const VENDOR_RECIPIENT = 'المورد (واتساب)';
  const recipientChannels = (to, ch) => ({ team: ch, vendor: (to || []).includes(VENDOR_RECIPIENT) ? 'واتساب' : null });
  const splitRecipients = (s) => String(s || '').split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
  function joinRecipients(list) {
    const u = [...new Set(list || [])]; const rank = (x) => { const i = NOTIF_TEAMS.indexOf(x); return i < 0 ? 99 : i; };
    return u.sort((a, b) => rank(a) - rank(b)).join(' + ');
  }
  // Owner (22 Oct): delivery — «جاهز للشحن» split into three routes; each one needs a Bosta waybill (sender → receiver).
  const SHIP_READY = Object.freeze(['جاهز للشحن من المورد للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المورد للمخزن']);
  const ROUTES = { 'جاهز للشحن من المورد للعميل': ['vendor', 'customer'], 'جاهز للشحن من المخزن للعميل': ['warehouse', 'customer'], 'جاهز للشحن من المورد للمخزن': ['vendor', 'warehouse'] };
  const isShipReady = (ss) => SHIP_READY.includes(ss);
  const shipRoute = (ss) => (ROUTES[ss] ? { from: ROUTES[ss][0], to: ROUTES[ss][1], label: ss.replace('جاهز للشحن ', '') } : null);
  const PARTY = { customer: 'العميل', vendor: 'المورد', warehouse: 'المخزن' };
  const r2m = (n) => Math.round((Number(n) || 0) * 100) / 100;
  function waybillFor(order, sub, vendor, wh) {
    const rt = shipRoute(sub && sub.ss); if (!rt) return null;
    const party = (k) => (k === 'customer' ? { kind: k, name: order.name || '', phone: order.phone || '', address: [order.city, order.addr].filter(Boolean).join('، ') }
      : k === 'vendor' ? { kind: k, name: (vendor && vendor.name) || sub.vendor || '', phone: (vendor && vendor.phone) || '', address: (vendor && vendor.address) || '' }
        : { kind: k, name: (wh && wh.name) || 'المخزن', phone: (wh && wh.phone) || '', address: (wh && wh.address) || '' });
    const sender = party(rt.from), receiver = party(rt.to); const missing = [];
    for (const p of [sender, receiver]) for (const [f, l] of [['name', 'اسم'], ['phone', 'تليفون'], ['address', 'عنوان']]) if (!p[f]) missing.push(l + ' ' + PARTY[p.kind]);
    const total = r2m(order.tot), deposit = r2m(order.dep), remaining = r2m(Math.max(0, total - deposit));
    return { key: String(order.id) + '-' + String(sub.sid), oid: String(order.id), sid: String(sub.sid), prod: sub.prod, qty: sub.qty || 1, status: sub.ss, route: rt.label, sender, receiver, total, deposit, remaining, collect: rt.to === 'customer' ? remaining : 0, missing };
  }
  const m2 = (n) => r2m(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const partyLine = (p) => [p.name || '—', p.phone || '—', p.address || '—'].join(' · ');
  function waybillText(w) {
    return ['IB-' + w.oid + ' · #' + w.sid + ' · ' + w.prod + ' × ' + w.qty + ' · ' + w.route, 'المرسل: ' + partyLine(w.sender), 'المستلم: ' + partyLine(w.receiver),
      'الإجمالي ' + m2(w.total) + ' · العربون ' + m2(w.deposit) + ' · المتبقي ' + m2(w.remaining) + ' · يتحصّل ' + m2(w.collect)].concat(w.missing.length ? ['ناقص: ' + w.missing.join('، ')] : []).join('\n');
  }
  function deliveryDigestText(list, day) {
    return ['ملخص التوصيل — ' + day, (list || []).length + ' بوليصة'].concat((list || []).map((w, i) => '\n' + (i + 1) + ') ' + waybillText(w))).join('\n');
  }
  // Owner (22 Oct): confirming the main order confirms its open sub-orders automatically (and un-confirming reverts them).
  const isConfirmed = (cf) => /^مؤكد/.test(cf || '');
  function subsOnConfirm(subs, oldCf, newCf) {
    const a = isConfirmed(oldCf), b = isConfirmed(newCf); if (a === b) return [];
    return (subs || []).filter((s) => (b ? ['', 'غير مؤكد'].includes(s.ss || '') : s.ss === 'مؤكد')).map((s) => ({ sid: String(s.sid), from: s.ss || '', to: b ? 'مؤكد' : 'غير مؤكد' }));
  }
  // Owner (22 Oct): alert-types table — short readable cells; add / edit / delete types.
  function notifRepeatShort(count, every, at, days, weekday) {
    const t = at || NOTIF_DEFAULT_AT; const e = every || 'كل 24 ساعة'; const once = isOnce(count); const tillFix = count === 'لحد ما يتحل';
    if (e === 'أسبوعيًا') return 'كل ' + String(weekday || 'الأحد').replace(/^ال/, '') + ' · ' + t;
    if (e === 'أيام محددة من الشهر') return sortDays(days && days.length ? days : [16, 'last']).map((d) => (d === 'last' ? 'آخر الشهر' : 'يوم ' + d)).join(' + ') + ' · ' + t;
    if (e === 'كل 24 ساعة') return once ? 'مرة · ' + t : tillFix ? 'يوميًا لحد الحل · ' + t : count + ' يوميًا · ' + t;
    return once ? 'مرة فورًا' : tillFix ? e + ' لحد الحل' : count + ' · ' + e;
  }
  const channelsShort = (ch) => splitRecipients(ch).map((x) => (x === 'داخل السيستم' ? 'السيستم' : x)).join(' · ');
  function listShort(v, max) { const a = Array.isArray(v) ? v.slice() : splitRecipients(v); return { shown: a.slice(0, max), more: Math.max(0, a.length - max), all: a.join(' + ') }; }
  function validateNotifType(f, names, editing) {
    const e = {}; const n = String(f.name || '').trim();
    if (!n) e.name = 'اكتب اسم التنبيه'; else if (n !== editing && (names || []).includes(n)) e.name = 'فيه تنبيه بنفس الاسم';
    if (!(f.to || []).length) e.to = 'اختار قسم واحد على الأقل';
    return e;
  }
  // Owner (22 Oct): escalation rules — add / edit / delete; send to many people and/or roles.
  const ESC_AFTER = Object.freeze(['30 دقيقة', '1 ساعة', '2 ساعة', '4 ساعات', '12 ساعة', '24 ساعة', '48 ساعة', '72 ساعة']);
  const ESC_CHANNELS = Object.freeze(['داخل السيستم', 'واتساب', 'إيميل']);
  const ESC_MANAGER = 'المدير المباشر';
  function escalationTargets(roles, members) {
    return [{ value: ESC_MANAGER, label: ESC_MANAGER, kind: 'manager' }]
      .concat((roles || []).filter((r) => r !== 'مشاهد').map((r) => ({ value: 'دور ' + r, label: 'دور ' + r, kind: 'role' })),
        (members || []).map((m) => ({ value: m.name, label: m.name + ' — ' + m.role, kind: 'person' })));
  }
  function validateEscalation(f, list, editing) {
    const e = {};
    if (!f.type) e.type = 'اختار التنبيه';
    if (!(f.to || []).length) e.to = 'اختار شخص أو دور واحد على الأقل';
    if (!(f.ch || []).length) e.ch = 'اختار قناة واحدة على الأقل';
    if (f.type && (list || []).some((r, i) => i !== editing && r.type === f.type && r.after === f.after)) e.after = 'فيه قاعدة لنفس التنبيه بعد نفس المدة';
    return e;
  }
  const joinChannels = (ch) => [...new Set(ch || [])].sort((a, b) => ESC_CHANNELS.indexOf(a) - ESC_CHANNELS.indexOf(b)).join(' + ');
  const splitChannels = (s) => String(s || '').split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
  // Owner (22 Oct): payroll reminder — shows `lead` days before payday until the month's sheet is marked paid.
  function payrollDue(today, { payDay = 1, lead = 14, status = 'مسودة' } = {}) {
    const [y, m, d] = today.split('-').map(Number); let Y = y, M = m;
    if (d >= payDay && !(d === payDay)) { M = m + 1; if (M > 12) { M = 1; Y++; } }
    const last = new Date(Date.UTC(Y, M, 0)).getUTCDate(); const date = Y + '-' + String(M).padStart(2, '0') + '-' + String(Math.min(payDay, last)).padStart(2, '0');
    const daysLeft = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
    const pm = payDay === 1 ? (M === 1 ? (Y - 1) + '-12' : Y + '-' + String(M - 1).padStart(2, '0')) : Y + '-' + String(M).padStart(2, '0');
    return { date, daysLeft, month: pm, show: daysLeft <= lead && status !== 'مدفوع' };
  }
  // Owner (22 Oct): custom task report — gathers chosen alert sources into one grouped report.
  function digest(sources, keys) {
    const groups = (keys || []).map((k) => (sources || []).find((s) => s.key === k)).filter(Boolean).map((s) => ({ key: s.key, section: s.section, label: s.label, count: (s.items || []).length, items: s.items || [] }));
    return { groups, total: groups.reduce((t, g) => t + g.count, 0) };
  }
  const CANCEL_REASONS = Object.freeze(['العميل لغى الطلب', 'العميل مش بيرد / مش متاح', 'المبتكر مش هيقدر ينفذ', 'المنتج خلص / مش متاح', 'مصاريف الشحن عالية', 'أوردر مكرر', 'أخرى']);
  function validateCancel({ reason, other }) { if (!reason) return 'اختار سبب الإلغاء'; if (reason === 'أخرى' && !String(other || '').trim()) return 'اكتب السبب'; return null; }
  function validateReturn({ reason, other }) { if (!reason) return 'اختار سبب المرتجع'; if (reason === 'أخرى' && !String(other || '').trim()) return 'اكتب السبب'; return null; }

  // ---------- tasks ----------
  const TASK_STATUSES = ['لسه', 'جاري', 'متوقفة', 'جاهزة للمراجعة', 'خلصت', 'اتأجلت'];
  function rollover(tasks, today) {
    const res = { today: [], later: [], done: [], scheduled: [] };
    for (const t of tasks) {
      if (t.status === 'خلصت') res.done.push(t);
      else if (t.status === 'اتأجلت') {
        if (!t.until) res.later.push(t);
        else if (t.until <= today) res.today.push(Object.assign({}, t, { status: 'لسه', day: today, until: null, carried: false }));
        else res.scheduled.push(t);
      } else if (t.day < today) res.today.push(Object.assign({}, t, { day: today, carried: true }));
      else if (t.day === today) res.today.push(t);
      else res.scheduled.push(t);
    }
    return res;
  }
  function validateTaskStatus(status, { reason, reviewer, until, indefinite } = {}) {
    if (status === 'متوقفة' && !String(reason || '').trim()) return 'اكتب سبب التوقف';
    if (status === 'جاهزة للمراجعة' && !reviewer) return 'اختار مين هيراجع';
    if (status === 'اتأجلت' && !until && !indefinite) return 'اختار يوم أو «لأجل غير مسمى»';
    return null;
  }

  // ---------- login / session ----------
  const AUTH = { maxTries: 5, lockMinutes: 15, idleMinutes: 480, warnSeconds: 60, linkMinutes: 30, inviteDays: 7, rememberDays: 30 };
  const loginInit = () => ({ fails: 0, left: AUTH.maxTries, lockedUntil: 0 });
  function loginFail(s, now) { const fails = s.fails + 1; return fails >= AUTH.maxTries ? { fails: 0, left: AUTH.maxTries, lockedUntil: now + AUTH.lockMinutes * 60000 } : { fails, left: AUTH.maxTries - fails, lockedUntil: s.lockedUntil }; }
  const isLocked = (s, now) => now < s.lockedUntil;
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const toLatin = (v) => String(v || '').replace(/[٠-٩]/g, (c) => String(AR.indexOf(c))).trim();
  function identifierKind(v) { const x = toLatin(v); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) return 'email'; if (/^01[0125]\d{8}$/.test(x)) return 'phone'; return null; }
  function validatePassword(p, c) {
    if (String(p).length < 8) return 'كلمة المرور لازم 8 حروف على الأقل';
    if (!/[A-Za-z؀-ۿ]/.test(p) || !/\d/.test(p)) return 'لازم فيها حرف ورقم على الأقل';
    if (p !== c) return 'كلمتين المرور مش زي بعض';
    return null;
  }
  function idleState(sec) { const lim = AUTH.idleMinutes * 60; return sec >= lim ? 'expired' : sec > lim - AUTH.warnSeconds ? 'warn' : 'active'; }

  const api = { HR, INV, AUTH, rates, overtimePay, monthlyPaid, rating, RATING_TONE, monthBonus, quarterBonus, quarterBad, leaveDays, addDays, payslip,
    shiftState, presenceDue, presenceOutcome, reviewOvertime, otReviewer, validateOtEnd,
    REASONS, STATUS_BY_REASON, stockFromLedger, canAutoPull, validateReceive, CANCEL_REASONS, validateCancel, NOTIF_COUNTS, NOTIF_EVERY, notifRepeat, notifSchedule, NOTIF_DEFAULT_AT, NOTIF_TIMES, isDaily, SHIP_READY, isShipReady, shipRoute, waybillFor, waybillText, deliveryDigestText, isConfirmed, subsOnConfirm, notifRepeatShort, channelsShort, listShort, validateNotifType, ESC_AFTER, ESC_CHANNELS, ESC_MANAGER, escalationTargets, validateEscalation, joinChannels, splitChannels, WEEKDAYS, weeklyPeriod, MONTH_DAYS, monthDaysLabel, monthDaysPeriod, NOTIF_TEAMS, payrollDue, digest, VENDOR_RECIPIENT, recipientChannels, splitRecipients, joinRecipients, RETURN_CONDITIONS, inspectDefault, arrivalReason, arrivalStock, consolidationLate, photoOverdue, consolidation, countDiff,
    RETURN_REASONS, validateReturn, TASK_STATUSES, rollover, validateTaskStatus,
    loginInit, loginFail, isLocked, identifierKind, toLatin, validatePassword, idleState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IbtekrOps = api;
})(typeof window !== 'undefined' ? window : globalThis);

