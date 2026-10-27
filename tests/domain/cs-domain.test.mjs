import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const CS = loadUmd(new URL('../../app/js/blocks/19-cs-domain.js', import.meta.url));

test('the customer rating after «مكتمل» has two figures: رضا and أخلاق (phase 3.6)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CS.RATE_KEYS)), [['sat', 'رضا العميل'], ['manners', 'أخلاق العميل']]);
});

test('validateTeamRating wants a whole 1–5 for each figure and names the missing one', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CS.validateTeamRating({ sat: 5, manners: 1 }))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(CS.validateTeamRating({ sat: 0, manners: 3 }))), { sat: 'اختار رضا العميل من 1 لـ 5' });
  assert.deepEqual(Object.keys(CS.validateTeamRating({ sat: 6, manners: 2.5 })), ['sat', 'manners']);
  assert.deepEqual(Object.keys(CS.validateTeamRating(null)), ['sat', 'manners']);
});
