import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
// The meeting of 23 Nov #39 — «فقد» (app/js/pages/lost-ui.js; Safwat 24 Nov): the decision's rules — the shapes acc_bad_debt_add (0154) takes.
const W = {}; runInNewContext(readFileSync(new URL('../../app/js/pages/lost-ui.js', import.meta.url), 'utf8'), { window: W });
const U = W.IBLostUI; const R = ['فقد المنتج', 'تلف المنتج في المخزن', 'أخرى'];
const keys = (o) => Object.keys(o).sort().join(',');

test('[#39] the decision: where it goes, a positive amount, a reason of the three, «أخرى» with its text, no html', () => {
  assert.equal(keys(U.validate({}, R)), 'amount,kind,reason');
  assert.equal(keys(U.validate({ kind: 'deposit', amount: '300', reason: 'فقد المنتج' }, R)), '');
  assert.equal(keys(U.validate({ kind: 'writeoff', amount: '٣٠٠', reason: 'تلف المنتج في المخزن' }, R)), '', 'Arabic digits');
  assert.equal(keys(U.validate({ kind: 'writeoff', amount: '0', reason: 'فقد المنتج' }, R)), 'amount');
  assert.equal(keys(U.validate({ kind: 'writeoff', amount: '50', reason: 'أخرى', note: ' ' }, R)), 'note');
  assert.equal(keys(U.validate({ kind: 'writeoff', amount: '50', reason: 'أخرى', note: 'اتسرق' }, R)), '');
  assert.equal(keys(U.validate({ kind: 'deposit', amount: '50', reason: 'فقد المنتج', note: '<b>' }, R)), 'note');
  assert.equal(keys(U.validate({ kind: 'deposit', amount: '50', reason: 'غلط' }, R)), 'reason');
});

test('[#39] the names (Safwat 24 Nov): «حوّلها لحساب المبتكر» / «حوّلها مفقودات»', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(U.KINDS)), [['deposit', 'حوّلها لحساب المبتكر'], ['writeoff', 'حوّلها مفقودات']]);
});
