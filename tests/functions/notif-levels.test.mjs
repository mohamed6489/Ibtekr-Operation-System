// The bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): every state has a level (critical / important /
// info) that sets a new rule's «تفاصيل الظهور» and the bell's order; the engine writes who an alert is about and its counts (meta); an
// info alert leaves the bell 24 hours after it was written at the latest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogue as C, hidePlan, metaOf } from '../../supabase/functions/_shared/notif-engine.js';

test('levels: critical for what is late or broken, info for summaries and events, important otherwise', () => {
  const lv = (element, type, state) => C.levelOf({ element, type, state });
  assert.equal(lv('subs', 'delay', 'late'), 'critical'); assert.equal(lv('subs', 'delay', 'risk'), 'important');
  assert.equal(lv('orders', 'confirm', 'غير مؤكد'), 'important'); assert.equal(lv('daily', 'summary', 'day'), 'info');
  assert.equal(lv('orders', 'update', 'new'), 'info'); assert.equal(lv('makers', 'accounts', 'withdraw'), 'important');
  for (const [e, t, s] of [['orders', 'shipping', 'cod_error'], ['inventory', 'lost', 'new'], ['accounts', 'real', 'negative'], ['system', 'links', 'down'], ['messages', 'ratings', 'low'], ['inventory', 'consolidation', 'late']])
    assert.equal(lv(e, t, s), 'critical', e + '.' + t + '.' + s);
  assert.equal(lv('orders', 'shipping', 'no_bosta'), 'important'); assert.equal(lv('makers', 'accounts', 'withdraw_wait'), 'important');
});

test('showOf: the level\'s «تفاصيل الظهور» — every value a rule may hold', () => {
  assert.deepEqual(C.showOf('critical', 'state'), { show: 'until_state', hours: 0 });
  assert.deepEqual(C.showOf('critical', 'event'), { show: 'fixed', hours: 72 });
  assert.deepEqual(C.showOf('important', 'event'), { show: 'until_read', hours: 6 });
  assert.deepEqual(C.showOf('info', 'event'), { show: 'until_read', hours: 2 });
  for (const e of C.ELEMENTS) for (const t of e.types) for (const s of C.statesOf(e.id, t.id, null)) {
    const r = { element: e.id, type: t.id, state: s.id }; const v = C.showOf(C.levelOf(r), C.kindOf(r));
    assert.ok(C.SHOW_HOURS[v.show].includes(v.hours), e.id + '.' + t.id + '.' + s.id);
  }
});

test('every built-in assistant has its own type with the three states', () => {
  const ai = C.el('ai').types.map((t) => t.id);
  for (const [id] of C.AGENTS) assert.ok(ai.includes(id), id);
  assert.deepEqual(C.typeOf('ai', 'stock').states.map((s) => s.id), ['summary', 'late', 'rules']);
});

test('metaOf: the level, who it is about and the counts — and nothing else', () => {
  const rule = { element: 'subs', type: 'delay', state: 'late' };
  assert.deepEqual(metaOf(rule, { id: 's:1', group: { g: 'vendor', id: 'v1', name: 'Art Craft' }, n: 1, pcs: 4, st: 'late', line: 'x', users: ['a'] }),
    { lv: 'critical', g: 'vendor', gid: 'v1', gname: 'Art Craft', n: 1, pcs: 4, st: 'late' });
  assert.deepEqual(metaOf({ element: 'daily', type: 'summary', state: 'day' }, { id: 'd' }), { lv: 'info' });
  assert.deepEqual(metaOf(rule, { id: 'x', group: { g: 'phone', id: '010' } }), { lv: 'critical' }, 'an unknown owner kind is dropped');
});

test('hidePlan: an info alert leaves 24 hours after it was written, read or not; a critical one stays', () => {
  const now = '2026-11-25T12:00:00Z';
  const old = { id: 1, entity_id: 'a', at: '2026-11-24T10:00:00Z', hide_at: null }; const fresh = { id: 2, entity_id: 'b', at: '2026-11-25T10:00:00Z', hide_at: null };
  const info = { element: 'orders', type: 'update', state: 'new', show: 'until_read', hours: 2, active: true };
  assert.deepEqual(hidePlan({ rule: info, alerts: [old, fresh], inState: null, reads: new Map(), now }), [{ id: 1, hide_at: '2026-11-25T10:00:00.000Z' }]);
  const crit = { element: 'subs', type: 'delay', state: 'late', show: 'until_state', hours: 0, active: true };
  assert.deepEqual(hidePlan({ rule: crit, alerts: [old], inState: new Set(['a']), reads: new Map([['1', now]]), now }), []);
});
