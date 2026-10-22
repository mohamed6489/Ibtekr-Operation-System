import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { split } from '../tools/split-prototype.mjs'; import { join } from '../tools/join-prototype.mjs';
const SRC = 'Prototype file/نظام إبتكر.html';
test('split yields 29 blocks in order', () => {
  const p = split(readFileSync(SRC, 'utf8'));
  assert.equal(p.blocks.length, 29);
  assert.equal(p.blocks[0].file, '01-dataio.js');
  assert.equal(p.blocks[28].file, '29-orders-app.js');
  assert.match(p.blocks[20].code, /window\.IBShell = /);
});
test('join(split(x)) === x byte for byte', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.equal(join(split(src)), src);
});
