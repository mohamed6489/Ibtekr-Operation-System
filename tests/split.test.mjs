import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
import { split } from '../tools/split-prototype.mjs';
// The split ran once; blocks 14, 21 and 28 have been edited since (phase 0 Task 5), 25 (phase 1 Task 4), 11 and 29 (phase 2 Task 6), 18 (phase 2 Task 7),
// 10 and 17 (phase 2 Task 8: vendored export libraries), 24 (phase 2.1: «فشل» in DONE). tools/blocks.lock.json records,
// per block, the sha256 of the prototype's block and of the file on disk (npm run lock regenerates it).
const SRC = 'Prototype file/نظام إبتكر.html';
const EDITED = ['10-ui-kit.js', '11-seed-product-images.js', '14-kit.js', '17-page-settings.js', '18-page-profile.js', '21-shell.js', '24-dash-domain.js', '25-page-dashboard.js', '28-app.js', '29-orders-app.js'];
const sha = (text) => createHash('sha256').update(text).digest('hex');
const parts = split(readFileSync(SRC, 'utf8'));
const lock = JSON.parse(readFileSync('tools/blocks.lock.json', 'utf8'));
const onDisk = (file) => readFileSync('app/js/blocks/' + file, 'utf8');
test('split yields 29 blocks in order', () => {
  assert.equal(parts.blocks.length, 29);
  assert.equal(parts.blocks[0].file, '01-dataio.js');
  assert.equal(parts.blocks[28].file, '29-orders-app.js');
  assert.match(parts.blocks[20].code, /window\.IBShell = /);
  assert.deepEqual(Object.keys(lock), parts.blocks.map((b) => b.file));
});
test('only blocks 10, 11, 14, 17, 18, 21, 24, 25, 28 and 29 differ from the prototype', () => {
  assert.deepEqual(Object.keys(lock).filter((f) => lock[f].prototype !== lock[f].current), EDITED);
});
test('unedited blocks are byte-identical to the prototype', () => {
  for (const b of parts.blocks.filter((x) => !EDITED.includes(x.file))) assert.equal(onDisk(b.file), b.code, b.file);
});
test('edited blocks match their lock entry', () => {
  for (const b of parts.blocks.filter((x) => EDITED.includes(x.file))) {
    assert.equal(lock[b.file].prototype, sha(b.code), b.file + ': prototype hash');
    assert.equal(sha(onDisk(b.file)), lock[b.file].current, b.file + ': changed since `npm run lock`');
  }
});
test('index.html loads the 29 blocks in tools/blocks.json order', () => {
  const order = JSON.parse(readFileSync('tools/blocks.json', 'utf8')).map((b) => b.file);
  const listed = [...readFileSync('app/index.html', 'utf8').matchAll(/<script src="js\/blocks\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(listed, order);
});
