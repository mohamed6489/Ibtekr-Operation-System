import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
// The meeting of 23 Nov (docs/superpowers/plans/2026-11-23-meeting.md phase 1): every table filter follows its columns [#1, #3, #10] and
// the total row sums the rows shown [#2] — the pure rules in app/js/pages/table-rules.js.
const W = {}; runInNewContext(readFileSync(new URL('../../app/js/pages/table-rules.js', import.meta.url), 'utf8'), { window: W });
const R = W.IBTableRules;

test('[#1] the five number choices — no number typed', () => {
  assert.equal(JSON.stringify(R.NUM_OPTS.map((o) => o[1])), JSON.stringify(['يوجد', 'لا يوجد', 'أعلى من صفر', 'أقل من صفر', 'يساوي صفر']));
  const pass = (v, p) => R.numPass(v, [p]);
  assert.equal(pass('1,250 ج.م', 'has'), true); assert.equal(pass('-300', 'has'), true); assert.equal(pass('0', 'has'), false); assert.equal(pass('—', 'has'), false);
  assert.equal(pass('0', 'none'), true); assert.equal(pass('', 'none'), true); assert.equal(pass('—', 'none'), true); assert.equal(pass('5', 'none'), false);
  assert.equal(pass('12%', 'pos'), true); assert.equal(pass('-1', 'pos'), false);
  assert.equal(pass('-1', 'neg'), true); assert.equal(pass('0', 'neg'), false);
  assert.equal(pass('0 ج.م', 'zero'), true); assert.equal(pass('', 'zero'), false);
  assert.equal(R.numPass('5', []), true, 'none picked = every row');
  assert.equal(R.numPass('-5', ['pos', 'zero']), false); assert.equal(R.numPass('0', ['pos', 'zero']), true, 'OR between the choices');
  assert.equal(R.numPass(7, ['pos']), true, 'a number as it is');
});

test('[#1] a column\'s kind from its values: numbers, dates, a few repeating values, free text', () => {
  assert.equal(R.colKind(['1,200 ج.م', '0', '—', '-30']), 'num');
  assert.equal(R.colKind(['23/11/2026', '2026-11-01', '5 نوفمبر 2026']), 'date');
  assert.equal(R.colKind(['منشور', 'مسودة', 'منشور', 'مسودة', 'منشور', 'مسودة'], 6), 'cat');
  assert.equal(R.colKind(['أحمد', 'سارة', 'منى', 'علي', 'هدى', 'كريم'], 6), 'text', 'every value once in more than 5 rows: the search covers it');
  assert.equal(R.colKind(Array.from({ length: 41 }, (_, i) => 'قيمة ' + i + ' x').concat(['قيمة 1 x']), 42), 'text', 'more than 40 values');
  assert.equal(R.colKind(['—', '', '-']), null);
});

test('[#1] dates in the shapes the tables show, and a period with an open end', () => {
  assert.equal(R.dateOf('23/11/2026'), '2026-11-23');
  assert.equal(R.dateOf('2026-11-05T10:00:00Z'), '2026-11-05');
  assert.equal(R.dateOf('5 نوفمبر 2026'), '2026-11-05');
  assert.equal(R.dateOf('٢٣/١١/٢٠٢٦'), '2026-11-23');
  assert.equal(R.dateOf('أحمد'), null);
  assert.equal(R.datePass('2026-11-10', ['2026-11-01', '2026-11-30']), true);
  assert.equal(R.datePass('2026-10-31', ['2026-11-01', '2026-11-30']), false);
  assert.equal(R.datePass('2026-12-01', ['2026-11-01', '']), true, 'no end');
  assert.equal(R.datePass('anything', null), true);
});

test('[#2] the total of the shown rows keeps the original\'s decimals', () => {
  assert.equal(R.sumShown(['1,200', '300', '—'], 0), '1,500');
  assert.equal(R.sumShown(['10.5', '0.25'], 2), '10.75');
  assert.equal(R.TOTAL_LABEL, 'إجمالي النتايج');
});
