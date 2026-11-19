// The owner 19 Nov (screenshot «‹ 1 2 3 4 5 … 22 ›»): the orders pagination shows the first and the last page, the pages around
// this one and «…» for a gap — pageList in block 29 (read out of the block's source, it lives inside the page's shadow script).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/js/blocks/29-orders-app.js', import.meta.url), 'utf8');
const fn = src.match(/function pageList\(cur,n\)\{[^\n]*/)[0];
const pageList = new Function(fn + '; return pageList;')();

test('pageList: every page up to 7, then first · around · last with «…»', () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageList(1, 22), [1, 2, 3, 4, 5, '…', 22]);
  assert.deepEqual(pageList(4, 22), [1, 2, 3, 4, 5, '…', 22]);
  assert.deepEqual(pageList(12, 22), [1, '…', 11, 12, 13, '…', 22]);
  assert.deepEqual(pageList(22, 22), [1, '…', 18, 19, 20, 21, 22]);
});
