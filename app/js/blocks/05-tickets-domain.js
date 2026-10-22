
/* Ibtekr Tickets — domain layer for the customer-service page. Pure: no DOM, no I/O.
   Statuses, priorities, permissions (creator / admin / assignee role), transitions, timeline = event log. UMD. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrTickets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = Object.freeze([['customer', 'مشكلة عميل'], ['vendor', 'مشكلة مورد'], ['internal', 'تعليق داخلي']]);
  const STATUSES = Object.freeze([['open', 'مفتوح'], ['in_progress', 'جاري العمل'], ['waiting', 'بانتظار الرد'], ['resolved', 'تم الحل'], ['closed', 'مغلق']]);
  const PRIORITIES = Object.freeze([['urgent', 'عاجل'], ['high', 'عالي'], ['normal', 'عادي'], ['low', 'منخفض']]);
  const ROLES = Object.freeze(['مدير النظام', 'خدمة العملاء', 'متابعة الموردين', 'الحسابات', 'اللوجستيك والشحن', 'المحتوى والتصوير']);
  const ADMIN_ROLE = ROLES[0];
  const CUSTOMER_REASONS = Object.freeze(['تأخير في التسليم', 'منتج تالف', 'منتج مختلف عن الطلب', 'مشكلة دفع أو استرجاع', 'العميل مش بيرد', 'أخرى']);
  const VENDOR_REASONS = Object.freeze(['تأخير تسليم', 'جودة', 'خامة ناقصة', 'خلاف على الحساب أو العمولة', 'مش بيرد', 'أخرى']);
  const OUTCOMES = Object.freeze(['اتحلت المشكلة', 'مش مشكلة', 'مكرر', 'العميل / المورد ما ردش']);
  const OPEN = new Set(['open', 'in_progress', 'waiting']);
  const WORK_STATUSES = new Set(['in_progress', 'waiting']);
  const label = (list, key) => { const f = list.find((x) => x[0] === key); return f ? f[1] : key; };
  const PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
  const TITLE_MAX = 80;

  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const isIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3]; };

  function validateTicket(input) {
    const e = {};
    if (!TYPES.some((t) => t[0] === input.type)) e.type = 'اختار نوع التذكرة';
    const title = clean(input.title, 1000);
    if (!title) e.title = 'اكتب عنوان للتذكرة'; else if (title.length > TITLE_MAX) e.title = 'العنوان أقصاه ' + TITLE_MAX + ' حرف';
    if (!clean(input.description, 5000)) e.description = 'اكتب إيه اللي حصل وإيه المطلوب';
    if (!PRIORITIES.some((p) => p[0] === input.priority)) e.priority = 'اختار الأولوية';
    if (!ROLES.includes(input.assigneeRole)) e.assigneeRole = 'اختار الدور المسؤول';
    if (input.type === 'customer') { if (!clean(input.orderId, 20)) e.orderId = 'اكتب رقم الأوردر'; if (!CUSTOMER_REASONS.includes(input.reason)) e.reason = 'اختار سبب المشكلة'; }
    if (input.type === 'vendor') { if (!clean(input.vendor, 80)) e.vendor = 'اختار المورد'; if (!VENDOR_REASONS.includes(input.reason)) e.reason = 'اختار سبب المشكلة'; }
    if (input.followUp && !isIso(input.followUp)) e.followUp = 'اكتب التاريخ بالشكل يوم/شهر/سنة';
    return e;
  }

  const isAdmin = (actor) => actor && actor.role === ADMIN_ROLE;
  const isCreator = (t, actor) => actor && t.createdBy && t.createdBy.name === actor.name;
  const canWork = (t, actor) => !!actor && (isAdmin(actor) || actor.role === t.assigneeRole);
  const canClose = (t, actor) => !!actor && (isAdmin(actor) || isCreator(t, actor));
  const canReopen = canClose;
  const noPerm = () => new Error('مفيش صلاحية للإجراء ده');

  function createStore({ now, seed } = {}) {
    const clock = now || (() => new Date().toISOString());
    const tickets = new Map(); const timeline = new Map(); let seq = 0;
    const pad = (n) => 'TKT-' + String(n).padStart(4, '0');
    const push = (id, item) => { timeline.get(id).push(Object.freeze(item)); const t = tickets.get(id); t.lastUpdate = item.at; return item; };
    const event = (id, text, actor, extra) => push(id, Object.assign({ kind: 'event', at: clock(), text, actor }, extra || {}));
    function create(input, actor) {
      const errs = validateTicket(input); const bad = Object.keys(errs); if (bad.length) throw new Error('invalid ticket: ' + bad.join(','));
      seq += 1; const id = pad(seq); const at = clock();
      const t = { id, type: input.type, title: clean(input.title, TITLE_MAX), description: clean(input.description, 5000), priority: input.priority, assigneeRole: input.assigneeRole,
        orderId: clean(input.orderId, 20) || null, customer: clean(input.customer, 80) || null, vendor: clean(input.vendor, 80) || null, reason: input.reason || null, followUp: input.followUp || null, attachments: (input.attachments || []).slice(0, 10),
        status: 'open', createdBy: { name: actor.name, role: actor.role }, createdAt: at, lastUpdate: at, reopenCount: 0, resolution: null, closedBy: null, closedAt: null };
      tickets.set(id, t); timeline.set(id, []);
      event(id, actor.name + ' أنشأ التذكرة وعيّنها لدور «' + t.assigneeRole + '»', actor);
      push(id, { kind: 'message', at, author: { name: actor.name, role: actor.role }, text: t.description });
      return get(id);
    }
    const get = (id) => { const t = tickets.get(id); return t ? Object.assign({}, t) : null; };
    const must = (id) => { const t = tickets.get(id); if (!t) throw new Error('ticket not found: ' + id); return t; };
    function setStatus(id, status, actor) {
      const t = must(id);
      if (!STATUSES.some((s) => s[0] === status)) throw new Error('bad status');
      if (status === 'closed' || status === 'open') throw noPerm(); // closing/reopening go through close()/reopen()
      if (!canWork(t, actor)) throw noPerm();
      if (t.status === 'closed') throw new Error('التذكرة مغلقة — أعد فتحها الأول');
      const old = t.status; t.status = status;
      event(id, actor.name + ' غيّر الحالة من «' + label(STATUSES, old) + '» إلى «' + label(STATUSES, status) + '»', actor, { oldValue: old, newValue: status });
    }
    function resolve(id, { outcome, note }, actor) {
      const t = must(id); if (!canWork(t, actor)) throw noPerm(); if (!OUTCOMES.includes(outcome)) throw new Error('outcome required');
      if (t.status === 'closed') throw new Error('التذكرة مغلقة');
      const old = t.status; t.status = 'resolved'; t.resolution = { outcome, note: clean(note, 1000), by: actor.name, at: clock() };
      event(id, actor.name + ' حوّل التذكرة إلى «تم الحل» — ' + outcome + (t.resolution.note ? ' · ' + t.resolution.note : ''), actor, { oldValue: old, newValue: 'resolved' });
    }
    function close(id, actor) {
      const t = must(id); if (!canClose(t, actor)) throw noPerm(); if (t.status === 'closed') return;
      const old = t.status; t.status = 'closed'; t.closedBy = actor.name; t.closedAt = clock();
      event(id, actor.name + ' قفل التذكرة نهائيًا', actor, { oldValue: old, newValue: 'closed' });
    }
    function reopen(id, { reason }, actor) {
      const t = must(id); const r = clean(reason, 1000); if (!r) throw new Error('reason required'); if (!canReopen(t, actor)) throw noPerm();
      const old = t.status; t.status = 'open'; t.reopenCount += 1; t.closedBy = null; t.closedAt = null; t.resolution = null;
      event(id, actor.name + ' أُعيد فتحه (×' + t.reopenCount + ') — السبب: ' + r + ' · رجع لدور «' + t.assigneeRole + '»', actor, { oldValue: old, newValue: 'open' });
    }
    function reply(id, text, actor) {
      const t = must(id); const s = clean(text, 5000); if (!s) throw new Error('text required'); if (t.status === 'closed') throw new Error('التذكرة مغلقة — أعد فتحها عشان ترد');
      return push(id, { kind: 'message', at: clock(), author: { name: actor.name, role: actor.role }, text: s });
    }
    function update(id, patch, actor) {
      const t = must(id); if (!canWork(t, actor) && !canClose(t, actor)) throw noPerm();
      for (const k of ['assigneeRole', 'priority', 'followUp']) { if (patch[k] !== undefined && patch[k] !== t[k]) { const old = t[k]; t[k] = patch[k];
        const lab = k === 'priority' ? (v) => label(PRIORITIES, v) : (v) => (v || '—');
        event(id, actor.name + ' غيّر ' + (k === 'assigneeRole' ? 'المسؤول' : k === 'priority' ? 'الأولوية' : 'تاريخ المتابعة') + ' من «' + lab(old) + '» إلى «' + lab(t[k]) + '»', actor, { oldValue: old, newValue: t[k] }); } }
    }
    const all = () => [...tickets.values()].map((t) => Object.assign({}, t));
    const events = (id) => (timeline.get(id) || []).slice();
    function remove(id, actor) { if (!isAdmin(actor)) throw new Error('admin only'); tickets.delete(id); timeline.delete(id); }
    const api = { create, get, all, events, setStatus, resolve, close, reopen, reply, update, remove };
    if (seed) seed(api);
    return api;
  }

  const DAY = 86400000;
  function summary(list, today) {
    const open = list.filter((t) => OPEN.has(t.status));
    const overdue = open.filter((t) => t.followUp && t.followUp < today).length;
    const weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 7 * DAY).toISOString();
    const reopened = list.filter((t) => t.reopenCount > 0 && t.lastUpdate >= weekAgo).length;
    const done = list.filter((t) => t.resolution && t.resolution.at);
    const avgDays = done.length ? Math.round(done.reduce((s, t) => s + (Date.parse(t.resolution.at) - Date.parse(t.createdAt)) / DAY, 0) / done.length * 10) / 10 : 0;
    return { open: open.length, overdue, reopened, avgDays, resolvedCount: done.length };
  }
  // rows behind the tickets KPIs (details popups) — same rules as summary()
  function summaryDetails(list, today) {
    const open = list.filter((t) => OPEN.has(t.status));
    const weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 7 * DAY).toISOString();
    const resolved = list.filter((t) => t.resolution && t.resolution.at).map((t) => Object.assign({}, t, { days: Math.round((Date.parse(t.resolution.at) - Date.parse(t.createdAt)) / DAY * 10) / 10 })).sort((a, b) => b.days - a.days);
    return { open, overdue: open.filter((t) => t.followUp && t.followUp < today), reopened: list.filter((t) => t.reopenCount > 0 && t.lastUpdate >= weekAgo), resolved };
  }
  function filterTickets(list, f = {}) {
    const q = clean(f.q, 80).toLowerCase();
    return list.filter((t) => {
      if (f.status === 'open_any') { if (!OPEN.has(t.status)) return false; } else if (f.status && f.status !== 'all' && t.status !== f.status) return false;
      if (f.type && f.type !== 'all' && t.type !== f.type) return false;
      if (f.priority && f.priority !== 'all' && t.priority !== f.priority) return false;
      if (f.role && f.role !== 'all' && t.assigneeRole !== f.role) return false;
      if (q && ![t.id, t.title, t.orderId, t.vendor, t.customer].some((v) => v && String(v).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (b.lastUpdate < a.lastUpdate ? -1 : b.lastUpdate > a.lastUpdate ? 1 : 0));
  }

  return Object.freeze({ TYPES, STATUSES, PRIORITIES, ROLES, ADMIN_ROLE, CUSTOMER_REASONS, VENDOR_REASONS, OUTCOMES, OPEN, WORK_STATUSES, TITLE_MAX, label, validateTicket, createStore, canWork, canClose, canReopen, isAdmin, summary, summaryDetails, filterTickets });
});

