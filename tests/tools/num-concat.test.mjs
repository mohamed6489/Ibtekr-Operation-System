import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs'; import { join } from 'node:path';
// U.num(...) returns an element: glued to a string it shows «[object HTMLSpanElement]» (owner 16 Nov — «قبل ← بعد[object HTMLSpanElement]»
// in «تعديل السعر»). Put the text inside U.num(...) or pass both as children instead.
const DIRS = ['app/js/pages', 'app/js/blocks'];
test('no string is glued to U.num(...) with +', () => {
  const bad = [];
  for (const d of DIRS) for (const f of readdirSync(d).filter((x) => x.endsWith('.js'))) {
    readFileSync(join(d, f), 'utf8').split('\n').forEach((line, i) => {
      if (/\+\s*(?:U|IBUI)\.num\(/.test(line) || /\+\s*\([^()]*\?\s*(?:U|IBUI)\.num\(/.test(line) || /(?:U|IBUI)\.num\((?:[^()]|\([^()]*\))*\)\s*\+(?!\+)/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
