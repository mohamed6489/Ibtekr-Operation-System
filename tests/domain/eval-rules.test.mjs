import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
// the meeting of 23 Nov [#41 #42] (phase 7): the evaluation's rules on the page (app/js/pages/eval-rules.js) = 0155's on the server
const W = {}; runInNewContext(readFileSync(new URL('../../app/js/pages/eval-rules.js', import.meta.url), 'utf8'), { window: W });
const R = W.IBEvalRules;
const J = (x) => JSON.parse(JSON.stringify(x)); // the context's arrays are another realm's
const SQL = readFileSync(new URL('../../supabase/migrations/0155_hr_eval_weights.sql', import.meta.url), 'utf8');

test('the default rules are the server\'s (hr_eval_rules_default)', () => {
  const m = /select '(\{"items".*?\})'::jsonb/.exec(SQL); assert.ok(m, 'the default is in 0155');
  assert.deepEqual(JSON.parse(JSON.stringify(R.DEFAULT)), JSON.parse(m[1]));
});

test('the meeting\'s example: attendance 4, communication 5, performance 3 → 3.75 → 75% of the holdback', () => {
  const t = R.score({ comm: 5, perf: 3 }, 4, R.DEFAULT); assert.equal(t, 3.75); assert.equal(R.pct(t, R.DEFAULT), 75);
});

test('an item without a score leaves its weight; the attendance alone is no evaluation; never past 100%', () => {
  assert.equal(R.score({ comm: 5, perf: 3 }, null, R.DEFAULT), 3.6667);
  assert.equal(R.score({}, 4, R.DEFAULT), null);
  assert.equal(R.pct(5, { point: 20 }), 100); assert.equal(R.pct(5, { point: 30 }), 100); // a point past 20 is not a point: the default
  const zero = { items: [{ id: 'att', name: 'الحضور', weight: 0, auto: true }, { id: 'q', name: 'الجودة', weight: 60 }, { id: 's', name: 'السرعة', weight: 40 }] };
  assert.equal(R.score({ q: 5, s: 2 }, 1, zero), 3.8); // weight 0 = not counted
});

test('the bands (the default: under 2.5 warning + meeting · 2.5 note · 3.5 nothing · 4.5 reward)', () => {
  assert.deepEqual(J(R.kinds(2.49, R.DEFAULT)), ['warning', 'meeting']); assert.deepEqual(J(R.kinds(2.5, R.DEFAULT)), ['note']);
  assert.deepEqual(J(R.kinds(3.5, R.DEFAULT)), []); assert.deepEqual(J(R.kinds(4.49, R.DEFAULT)), []); assert.deepEqual(J(R.kinds(4.5, R.DEFAULT)), ['reward']);
  assert.equal(R.kindsText(['warning', 'meeting']), 'إنذار + ميتنج فردي');
});

test('the items\' shape: the weights sum to 100 (with the error line), only the attendance is automatic, one counted item', () => {
  assert.match(R.itemsError([{ id: 'att', name: 'الحضور', weight: 30, auto: true }, { id: 'perf', name: 'الأداء', weight: 60 }]), /100%.*90%/);
  assert.ok(R.itemsError([{ id: 'perf', name: 'الأداء', weight: 100, auto: true }]));
  assert.ok(R.itemsError([{ id: 'att', name: 'الحضور', weight: 100, auto: true }]));
  assert.ok(R.itemsError([{ id: 'perf', name: '', weight: 100 }]));
  assert.equal(R.itemsError(R.DEFAULT.items), null);
  assert.ok(R.actionsError([{ min: 1, kinds: [] }])); assert.ok(R.actionsError([{ min: 0, kinds: ['pay'] }])); assert.ok(R.actionsError([{ min: 0, kinds: [] }, { min: 0, kinds: [] }]));
  assert.equal(R.actionsError(R.DEFAULT.actions), null);
});

test('the rules of a role: its own list, else the team\'s, else the default; a bad shape → the default', () => {
  const ops = [{ id: 'att', name: 'الحضور', weight: 0, auto: true }, { id: 'quality', name: 'الجودة', weight: 100 }];
  const team = [{ id: 'att', name: 'الحضور', weight: 50, auto: true }, { id: 'perf', name: 'الأداء', weight: 50 }];
  assert.equal(R.rulesOf({ roles: { ops }, items: team }, 'ops').items[1].id, 'quality');
  assert.equal(R.rulesOf({ roles: { ops }, items: team }, 'cs').items[1].id, 'perf');
  assert.deepEqual(J(R.rulesOf({ items: [{ id: 'perf', name: 'الأداء', weight: 70 }] }, 'cs').items), J(R.DEFAULT.items));
  assert.equal(R.rulesOf({ point: 10 }, null).point, 10); assert.equal(R.rulesOf({ point: 40 }, null).point, 20);
  assert.deepEqual(J(R.scoresOf({ perf: 4, comm: 3 })), { perf: 4, comm: 3 }); assert.deepEqual(J(R.scoresOf({ scores: { q: 5 } })), { q: 5 });
});
