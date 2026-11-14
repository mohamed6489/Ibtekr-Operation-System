import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
// owner batch 14 Nov (decision 11): an icon name the kit does not know draws nothing (ICONS[name] → d="undefined") — the CS
// «ملف العميل» toggle was invisible that way. Every Icon('x') / icon: 'x' in the blocks and the pages must be in block 10's ICONS.
const root = new URL('../../app/js/', import.meta.url);
const kit = readFileSync(new URL('blocks/10-ui-kit.js', root), 'utf8');
const body = kit.slice(kit.indexOf('const ICONS = {'), kit.indexOf('};', kit.indexOf('const ICONS = {')));
const names = new Set([...body.matchAll(/(?:^|[\s,{])([A-Za-z][A-Za-z0-9]*)\s*:\s*'/g)].map((m) => m[1]));
test('every icon the pages name exists in the kit', () => {
  const missing = [];
  for (const dir of ['blocks', 'pages']) {
    for (const f of readdirSync(new URL(dir + '/', root)).filter((x) => x.endsWith('.js'))) {
      const t = readFileSync(new URL(dir + '/' + f, root), 'utf8');
      for (const m of t.matchAll(/(?:Icon\(|icon:\s*)'([A-Za-z][A-Za-z0-9]*)'/g)) if (!names.has(m[1])) missing.push(m[1] + ' in ' + f);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(names.has('panel') && names.has('upload'), 'the names added on 14 Nov');
});
