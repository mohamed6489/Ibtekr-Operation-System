import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
// Phase 8 (docs/superpowers/plans/2026-11-05-phase-8-tickets.md, decision 6): block 05 = the v2 tickets domain verbatim. The server
// (0045 ticket_create / ticket_act, supabase/tests/rls_tickets.sql) applies the same rules; these pin the domain the page uses.
const TK = loadUmd(new URL('../../app/js/blocks/05-tickets-domain.js', import.meta.url));
const json = (x) => JSON.parse(JSON.stringify(x));

const CS = { name: 'سارة', role: 'خدمة العملاء' }; const ACC = { name: 'هبة', role: 'الحسابات' }; const ADM = { name: 'مدير', role: TK.ADMIN_ROLE };
const base = { type: 'customer', title: 'فرق شحن', description: 'اتحاسب 100', priority: 'high', assigneeRole: 'الحسابات', orderId: '177611', reason: 'مشكلة دفع أو استرجاع' };
const clockAt = () => { let t = Date.parse('2026-11-05T09:00:00Z'); return () => new Date((t += 60000)).toISOString(); };

test('the v2 lists: «المبتكر» in the type, the role and the outcome; the roles and statuses the server checks (0045)', () => {
  assert.deepEqual(json(TK.TYPES), [['customer', 'مشكلة عميل'], ['vendor', 'مشكلة مبتكر'], ['internal', 'تعليق داخلي']]);
  assert.deepEqual(json(TK.ROLES), ['مدير النظام', 'خدمة العملاء', 'متابعة المبتكرين', 'الحسابات', 'اللوجستيك والشحن', 'المحتوى والتصوير']);
  assert.deepEqual(json(TK.OUTCOMES), ['اتحلت المشكلة', 'مش مشكلة', 'مكرر', 'العميل / المبتكر ما ردش']);
  assert.deepEqual(json(TK.STATUSES).map((s) => s[0]), ['open', 'in_progress', 'waiting', 'resolved', 'closed']);
  assert.deepEqual(json(TK.PRIORITIES).map((s) => s[0]), ['urgent', 'high', 'normal', 'low']);
  assert.ok(TK.CUSTOMER_REASONS.includes('أخرى') && TK.VENDOR_REASONS.includes('أخرى')); // decision 15
  assert.equal(TK.TITLE_MAX, 80);
});

test('validateTicket: the fields a ticket needs by its type', () => {
  assert.deepEqual(TK.validateTicket(base), {});
  const e = TK.validateTicket({ type: 'vendor', title: 'x'.repeat(81), description: ' ', priority: 'x', assigneeRole: 'الأمن', reason: 'تأخير في التسليم', followUp: '2026-02-30' });
  assert.deepEqual(Object.keys(e).sort(), ['assigneeRole', 'description', 'followUp', 'priority', 'reason', 'title', 'vendor']);
  assert.equal(e.vendor, 'اختار المبتكر');
  assert.deepEqual(Object.keys(TK.validateTicket({ ...base, orderId: '' })), ['orderId']);
  assert.deepEqual(TK.validateTicket({ ...base, type: 'internal', orderId: '', reason: '' }), {});
});

test('working on a ticket = the admin or its role; closing / reopening = the admin or its opener', () => {
  const s = TK.createStore({ now: clockAt() });
  const t = s.create(base, CS);
  assert.equal(t.id, 'TKT-0001'); assert.equal(t.status, 'open');
  assert.deepEqual(s.events(t.id).map((e) => e.kind), ['event', 'message']);
  assert.throws(() => s.setStatus(t.id, 'in_progress', CS), /صلاحية/);
  s.setStatus(t.id, 'in_progress', ACC);
  assert.throws(() => s.setStatus(t.id, 'closed', ACC), /صلاحية/);
  assert.throws(() => s.resolve(t.id, { outcome: 'خلصت' }, ACC), /outcome/);
  s.resolve(t.id, { outcome: 'اتحلت المشكلة', note: 'على المحفظة' }, ACC);
  assert.equal(s.get(t.id).resolution.outcome, 'اتحلت المشكلة');
  assert.throws(() => s.close(t.id, ACC), /صلاحية/);
  s.close(t.id, CS);
  assert.throws(() => s.reply(t.id, 'x', ACC), /مغلقة/);
  assert.throws(() => s.reopen(t.id, { reason: ' ' }, CS), /reason/);
  s.reopen(t.id, { reason: 'ماوصلش' }, CS);
  const r = s.get(t.id);
  assert.equal(r.status, 'open'); assert.equal(r.reopenCount, 1); assert.equal(r.resolution, null); assert.equal(r.closedAt, null);
  assert.match(s.events(t.id).at(-1).text, /رجع لدور «الحسابات»/);
  s.update(t.id, { priority: 'urgent' }, CS); // the opener may update
  assert.equal(s.get(t.id).priority, 'urgent');
  assert.throws(() => s.update(t.id, { priority: 'low' }, { name: 'غريب', role: 'خدمة العملاء' }), /صلاحية/);
  s.close(t.id, ADM);
  assert.equal(s.get(t.id).status, 'closed');
});

test('summary and filterTickets: open / overdue / reopened, the v2 order (priority, then the last update)', () => {
  const s = TK.createStore({ now: clockAt() });
  const a = s.create({ ...base, priority: 'low', followUp: '2026-11-01' }, CS);
  const b = s.create({ ...base, priority: 'urgent' }, CS);
  s.resolve(b.id, { outcome: 'مكرر' }, ACC);
  const all = s.all();
  const sum = TK.summary(all, '2026-11-05');
  assert.equal(sum.open, 1); assert.equal(sum.overdue, 1); assert.equal(sum.resolvedCount, 1);
  assert.deepEqual(TK.filterTickets(all, { status: 'open_any' }).map((t) => t.id), [a.id]);
  assert.deepEqual(TK.filterTickets(all).map((t) => t.id), [b.id, a.id]);
  assert.deepEqual(TK.filterTickets(all, { q: '177611' }).length, 2);
});

// 0081 (the owner 12 Nov): a request goes to any role of the team — setRoles() adds the server's list (ticket_roles()) after the six;
// the six never leave; validateTicket follows the list
test('setRoles: the team\'s roles after the six (cleaned, once); validateTicket accepts them; the six stay', () => {
  const T = loadUmd(new URL('../../app/js/blocks/05-tickets-domain.js', import.meta.url));
  const input = { type: 'internal', title: 'بوست العروض', description: '3 بوستات', priority: 'normal', assigneeRole: 'ديزاينر' };
  assert.equal(T.validateTicket(input).assigneeRole, 'اختار الدور المسؤول'); // not on the list yet
  T.setRoles(['مدير النظام', ' ديزاينر ', 'ديزاينر', 'ميديا باير', '', null]);
  assert.deepEqual(json(T.ROLES), ['مدير النظام', 'خدمة العملاء', 'متابعة المبتكرين', 'الحسابات', 'اللوجستيك والشحن', 'المحتوى والتصوير', 'ديزاينر', 'ميديا باير']);
  assert.deepEqual(T.validateTicket(input), {});
  T.setRoles([]); assert.deepEqual(json(T.ROLES), json(T.BASE_ROLES)); // a refetch with only the six
  assert.equal(T.validateTicket(input).assigneeRole, 'اختار الدور المسؤول');
});

