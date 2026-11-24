// The bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md): every state has a level (critical / important /
// info) that sets a new rule's «تفاصيل الظهور» and the bell's order; the engine writes who an alert is about and its counts (meta); an
// info alert leaves the bell 24 hours after it was written at the latest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogue as C, hidePlan, metaOf, partKey, partOfKey, reportPlan, REPORT_MAX } from '../../supabase/functions/_shared/notif-engine.js';

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

// 0162 — several elements in one alert, «فردي / تقرير» (Safwat 24 Nov — the bell's redesign decision 8)
const BASE = { id: 'r', section_id: 's', name: 'الشغل المتأخر', element: 'subs', type: 'delay', state: 'late', at: '09:00', repeat: '24h', show: 'until_state', hours: 0, roles: ['admin'], channels: ['bell'] };
test('0162 the parts: the rule\'s own element first, each extra one as the same rule on its element; the level = the highest', () => {
  const r = { ...BASE, element: 'daily', type: 'summary', state: 'day', conds: [{ element: 'subs', type: 'delay', state: 'late' }] };
  const P = C.partsOf(r); assert.equal(P.length, 2); assert.deepEqual(P.map((p) => [p.part, p.element, p.name]), [[0, 'daily', 'الشغل المتأخر'], [1, 'subs', 'الشغل المتأخر']]);
  assert.equal(C.levelOf(r), 'info'); assert.equal(C.levelOfAll(r), 'critical');
  assert.equal(C.partLabel(P[1], {}), 'المبتكرين › أوردرات متأخرة'.replace('المبتكرين', C.el('subs').label).replace('أوردرات متأخرة', C.stateOf('subs', 'delay', 'late', {}).label));
  assert.equal(partKey(0, 'o:1'), 'o:1'); assert.equal(partKey(2, 'o:1'), 'x2|o:1'); assert.equal(partOfKey('x2|o:1'), 2); assert.equal(partOfKey('o:1'), 0);
});
test('0162 the rule\'s checks: each extra element named, 5 at most, a known mode', () => {
  assert.equal(C.ruleError({ ...BASE, conds: [{ element: 'orders', type: 'delay' }] }, {}), 'اختار الوضع (العنصر 2)');
  assert.equal(C.ruleError({ ...BASE, conds: [{ element: 'nope' }] }, {}), 'اختار العنصر (العنصر 2)');
  assert.match(C.ruleError({ ...BASE, conds: Array.from({ length: 6 }, () => ({ element: 'orders', type: 'delay', state: 'late' })) }, {}), /لحد 5/);
  assert.match(C.ruleError({ ...BASE, mode: 'both' }, {}), /فردي \/ تقرير/);
  assert.equal(C.ruleError({ ...BASE, mode: 'report', conds: [{ element: 'orders', type: 'delay', state: 'late' }] }, {}), null);
});
test('0162 «تقرير»: one alert per member with every part\'s things (the same receivers as «فردي»), counted per element, capped', () => {
  const rule = { ...BASE, mode: 'report', conds: [{ element: 'orders', type: 'delay', state: 'late' }] };
  const [p0, p1] = C.partsOf(rule);
  const members = [{ id: 'a', role_id: 'admin', status: 'active' }, { id: 'b', role_id: 'cs', status: 'active' }];
  const ent = (id, extra) => ({ id, name: id, ref: 'IB-' + id, line: 'سطر ' + id, entity: 'orders/' + id, ...extra });
  const out = reportPlan({ rule, parts: [{ rule: p0, ents: [ent('1', { group: { g: 'vendor', id: 'v', name: 'Art Craft' } }), ent('2')] }, { rule: p1, ents: [ent('3')] }], members, roles: [], now: '2026-11-24T10:00:00.000Z' });
  assert.equal(out.length, 1, 'cs is not in the rule\'s roles'); const a = out[0];
  assert.equal(a.user_id, 'a'); assert.equal(a.entity_id, 'report'); assert.equal(a.kind, 'rule:report'); assert.equal(a.title, 'الشغل المتأخر — 3');
  assert.equal(a.meta.report, true); assert.equal(a.meta.n, 3); assert.equal(a.meta.lv, 'critical');
  assert.deepEqual(a.meta.items.map((x) => [x.e, x.g]), [['orders/1', 'Art Craft'], ['orders/2', null], ['orders/3', null]]);
  assert.match(a.body, /^2 .+ · 1 .+$/);
  const many = reportPlan({ rule, parts: [{ rule: p0, ents: Array.from({ length: REPORT_MAX + 5 }, (_, i) => ent(String(i))) }], members, roles: [], now: '2026-11-24T10:00:00.000Z' });
  assert.equal(many[0].meta.items.length, REPORT_MAX); assert.equal(many[0].meta.n, REPORT_MAX + 5);
  assert.deepEqual(reportPlan({ rule, parts: [{ rule: p0, ents: [] }], members, roles: [], now: '2026-11-24T10:00:00.000Z' }), [], 'nothing found = no alert');
});

// 0165 (Safwat 24 Nov — «المستخدم يقدر يختار … حرج و تحتيها مهم و تحتيها عادي و تحتيها للمعرفة»): four levels, the admin's pick first
test('the admin\'s level: four of them in order; a rule\'s own level wins over its state\'s, for every part and in meta; «عادي» has its show', () => {
  assert.deepEqual(C.LEVELS.map((x) => x[0]), ['critical', 'important', 'normal', 'info']);
  assert.deepEqual(C.LEVELS.map((x) => x[1]), ['حرج', 'مهم', 'عادي', 'للمعرفة']);
  const r = { element: 'subs', type: 'delay', state: 'late', conds: [{ element: 'orders', type: 'update', state: 'new' }] };
  assert.equal(C.levelOfAll(r), 'critical'); // the state's own, the highest part
  assert.equal(C.levelOf({ ...r, level: 'normal' }), 'normal'); assert.equal(C.levelOfAll({ ...r, level: 'info' }), 'info');
  assert.deepEqual(C.partsOf({ ...r, level: 'normal' }).map(C.levelOf), ['normal', 'normal']);
  assert.equal(metaOf({ ...r, level: 'normal' }, { id: 'x' }).lv, 'normal');
  assert.equal(C.levelOf({ ...r, level: 'urgent' }), 'critical', 'an unknown level = the state\'s own');
  assert.deepEqual(C.showOf('normal', 'state'), { show: 'until_state', hours: 0 });
  assert.deepEqual(C.showOf('normal', 'event'), { show: 'until_read', hours: 2 });
  for (const k of ['critical', 'important', 'normal', 'info']) for (const kind of ['state', 'event', 'due']) {
    const s = C.showOf(k, kind); assert.ok(C.SHOW_HOURS[s.show].includes(s.hours), k + '/' + kind + ' — a value the form offers');
  }
});
