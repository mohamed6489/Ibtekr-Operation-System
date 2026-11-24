import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md, 0157): the catalogue (element ›
// type › state) is one file for the page and the engine; the rule's checks, the timing (state / event / due), and the engine's pure part
// (who receives, the renewal, the visibility).
const page = new URL('../../app/js/pages/notif-catalog.js', import.meta.url); const server = new URL('../../supabase/functions/_shared/notif-catalog.js', import.meta.url);
await import(page.href); const C = globalThis.IBNotifCatalog;
const E = await import(new URL('../../supabase/functions/_shared/notif-engine.js', import.meta.url).href);
const J = (v) => JSON.parse(JSON.stringify(v));

test('the page and the engine read the same catalogue, byte for byte', () => {
  assert.equal(readFileSync(page, 'utf8'), readFileSync(server, 'utf8'));
});

test('the catalogue: every element has types and states; a state\'s kind; a `dyn` type reads the system\'s list', () => {
  for (const e of C.ELEMENTS) { assert.ok(e.types.length, e.id); for (const t of e.types) assert.ok(t.states.length, e.id + '.' + t.id); }
  assert.equal(C.kindOf({ element: 'orders', type: 'confirm', state: 'غير مؤكد' }), 'state');
  assert.equal(C.kindOf({ element: 'orders', type: 'update', state: 'new' }), 'event');
  assert.equal(C.kindOf({ element: 'accounts', type: 'payroll', state: 'due' }), 'due');
  assert.equal(C.kindOf({ element: 'ai', type: 'any', state: 'notes' }), 'event');
  assert.deepEqual(J(C.statesOf('orders', 'status', { order: ['جاري التنفيذ', 'حالة مضافة'] }).map((s) => s.id)), ['جاري التنفيذ', 'حالة مضافة'], 'the added statuses are states too');
  assert.equal(C.elementOfKind('hr.overtime'), 'team'); assert.equal(C.elementOfKind('marketing'), 'ai'); assert.equal(C.elementOfKind('xyz'), null);
});

test('ruleError: the form\'s checks in Arabic (the server checks the shape again)', () => {
  const ok = { name: 'أوردر غير مؤكد', element: 'orders', type: 'confirm', state: 'غير مؤكد', at: '09:00', repeat: '24h', days: [], show: 'until_state', hours: 0, roles: ['cs'], channels: ['bell'], template: '' };
  assert.equal(C.ruleError(ok), null);
  assert.equal(C.ruleError({ ...ok, name: '' }), 'اكتب اسم التنبيه');
  assert.equal(C.ruleError({ ...ok, element: 'nope' }), 'اختار العنصر');
  assert.equal(C.ruleError({ ...ok, state: 'x' }), 'اختار الوضع');
  assert.equal(C.ruleError({ ...ok, repeat: 'days', days: [] }), 'اختار أيام الشهر');
  assert.equal(C.ruleError({ ...ok, show: 'fixed', hours: 5 }), 'اختار المدة');
  assert.equal(C.ruleError({ ...ok, roles: [] }), 'اختار المستلم (دور واحد على الأقل)');
  assert.equal(C.ruleError({ ...ok, template: '<b>' }), 'قالب الرسالة لحد 500 حرف من غير < >');
  assert.deepEqual(J(C.render({ name: 'تنبيه', template: '{الرقم} — {التفاصيل}' }, { ref: 'IB-1', line: 'متأخر' })), { title: 'تنبيه — IB-1', body: 'IB-1 — متأخر' });
});

test('the timing: a state / due rule by its time and its repeat; an event rule every tick from its time (on its days)', () => {
  const st = { element: 'orders', type: 'confirm', state: 'غير مؤكد', at: '09:00', repeat: '24h' };
  assert.equal(C.runs(st, { day: '2026-11-24', min: 8 * 60 }, null), false, 'before its time');
  assert.equal(C.runs(st, { day: '2026-11-24', min: 9 * 60 }, null), true);
  assert.equal(C.runs(st, { day: '2026-11-24', min: 10 * 60 }, '2026-11-24T07:00:00Z'), false, 'ran today');
  assert.equal(C.runs({ ...st, repeat: '48h' }, { day: '2026-11-25', min: 600 }, '2026-11-24T07:00:00Z'), false);
  assert.equal(C.runs({ ...st, repeat: 'once' }, { day: '2026-12-24', min: 600 }, '2026-11-24T07:00:00Z'), false);
  assert.equal(C.runs({ ...st, repeat: 'monthly' }, { day: '2026-12-01', min: 600 }, '2026-11-24T07:00:00Z'), true);
  const ev = { element: 'orders', type: 'update', state: 'new', at: '08:00', repeat: '24h' };
  assert.equal(C.runs(ev, { day: '2026-11-24', min: 9 * 60 }, '2026-11-24T06:45:00Z'), true, 'every tick');
  assert.equal(C.runs({ ...ev, repeat: 'days', days: [1, 15] }, { day: '2026-11-24', min: 600 }, null), false, 'not one of its days');
});

const roles = [{ id: 'admin', permissions: {} }, { id: 'cs', permissions: { 'orders.view': 'F', 'hr.view': 'P' } }, { id: 'ops', permissions: { 'orders.view': 'P' } }];
const M = (id, role, x = {}) => ({ id, name: id, role_id: role, status: 'active', ...x });
test('permOf: the admin F, the member\'s own setting first, the best of the primary role (its level) and the extra roles', () => {
  assert.equal(E.permOf(M('a', 'admin'), roles, 'orders.view'), 'F');
  assert.equal(E.permOf(M('c', 'cs'), roles, 'orders.view'), 'F');
  assert.equal(E.permOf(M('o', 'ops'), roles, 'orders.view'), 'P');
  assert.equal(E.permOf(M('o', 'ops', { extra_roles: ['cs'] }), roles, 'orders.view'), 'F');
  assert.equal(E.permOf(M('o', 'ops', { custom_perms: { 'orders.view': 'N' } }), roles, 'orders.view'), 'N');
});

test('writePlan: the rule\'s roles who see the page whole; a partial page only for the entities that name him; a state renews, an event never twice', () => {
  const rule = { id: 'r', section_id: 's', name: 'أوردر', element: 'orders', type: 'confirm', state: 'غير مؤكد', roles: ['cs', 'ops', 'admin'], show: 'until_state', hours: 0 };
  const members = [M('a', 'admin'), M('c', 'cs'), M('o', 'ops'), M('x', 'cs', { status: 'suspended' })];
  const p = E.writePlan({ rule, ents: [{ id: 'o:1', line: 'x' }, { id: 'o:2', line: 'y', users: ['o'] }], existing: [{ id: 9, entity_id: 'o:1', user_id: 'c', hide_at: null }], members, roles, now: '2026-11-24T08:00:00Z' });
  assert.deepEqual(J(p.inserts.map((r) => r.entity_id + '|' + r.user_id).sort()), ['o:1|a', 'o:1|c', 'o:2|a', 'o:2|c', 'o:2|o'].sort(), 'ops (P) gets o:2 that names him only');
  assert.deepEqual(J(p.retire), [9], 'the state renews: the old row leaves the bell');
  const ev = E.writePlan({ rule: { ...rule, type: 'update', state: 'new' }, ents: [{ id: 'n:1', line: 'x' }], existing: [{ id: 5, entity_id: 'n:1', user_id: 'c', hide_at: null }], members, roles, now: '2026-11-24T08:00:00Z' });
  assert.deepEqual(J(ev.inserts.map((r) => r.user_id)), ['a'], 'an event is written once per member');
  const fixed = E.writePlan({ rule: { ...rule, show: 'fixed', hours: 12, roles: ['admin'] }, ents: [{ id: 'o:1' }], existing: [], members, roles, now: '2026-11-24T08:00:00Z' });
  assert.equal(fixed.inserts[0].hide_at, '2026-11-24T20:00:00.000Z');
  const only = E.writePlan({ rule: { ...rule, element: 'tickets', type: 'type', state: 'new', roles: ['cs', 'admin'] }, ents: [{ id: 't:1', users: ['z'], only: true }], existing: [], members, roles, now: '2026-11-24T08:00:00Z' });
  assert.deepEqual(J(only.inserts.map((r) => r.user_id)), ['a'], '`only`: the named members and the admin');
  const ai = E.writePlan({ rule: { ...rule, element: 'ai', type: 'any', state: 'notes', roles: ['cs', 'ops', 'admin'] }, ents: [{ id: 'note:1', users: ['o'] }], existing: [], members, roles, now: '2026-11-24T08:00:00Z' });
  assert.deepEqual(J(ai.inserts.map((r) => r.user_id).sort()), ['a', 'o'], 'an element with no page: its users and the admin only');
});

test('hidePlan: until the state changes (+ its hours) · until read (+ its hours) · an inactive rule now; an event\'s «until the state» = until read', () => {
  const now = '2026-11-24T10:00:00.000Z'; const base = { id: 'r', element: 'orders', type: 'confirm', state: 'غير مؤكد', show: 'until_state', hours: 4, active: true };
  const A = [{ id: 1, entity_id: 'o:1', at: '2026-11-24T08:00:00Z', hide_at: null }, { id: 2, entity_id: 'o:2', at: '2026-11-24T08:00:00Z', hide_at: null }];
  assert.deepEqual(J(E.hidePlan({ rule: base, alerts: A, inState: new Set(['o:1']), reads: new Map(), now })), [{ id: 2, hide_at: '2026-11-24T14:00:00.000Z' }]);
  assert.deepEqual(J(E.hidePlan({ rule: { ...base, show: 'until_read', hours: 2 }, alerts: A, inState: null, reads: new Map([['1', '2026-11-24T09:00:00Z']]), now })), [{ id: 1, hide_at: '2026-11-24T11:00:00.000Z' }]);
  assert.equal(E.hidePlan({ rule: { ...base, active: false }, alerts: A, inState: null, reads: new Map(), now }).length, 2);
  assert.deepEqual(J(E.hidePlan({ rule: { ...base, type: 'update', state: 'new', hours: 0 }, alerts: A, inState: null, reads: new Map([['2', '2026-11-24T09:30:00Z']]), now })), [{ id: 2, hide_at: '2026-11-24T09:30:00.000Z' }]);
});
