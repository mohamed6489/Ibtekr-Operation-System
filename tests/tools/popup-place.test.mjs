import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// The owner 16 Nov («ال dropdowns بتبعد لما بدوس علي 3 نقط وانا عامل scroll لتحت»): on the desktop <body> is the page's scroller
// (page-scroll.js), so a popup placed at page coordinates — its button's box «+ window.scrollY / scrollX / pageYOffset» — lands as far
// off as the page was scrolled. Every popup sits on the screen (position:fixed at the button's box, like floatOver in block 10).
const ROOT = new URL('../../app/js/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'vendor' ? [] : files(p)) : p.endsWith('.js') ? [p] : []; });
test('no popup is placed at page coordinates (style.top / left with scrollY / scrollX / pageYOffset)', () => {
  const bad = [];
  for (const p of files(ROOT)) {
    if (p.endsWith('page-scroll.js')) continue;
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/style\.(top|left|right|bottom)\s*=[^;]*(scroll[XY]|page[XY]Offset)/.test(l)) bad.push(p.slice(ROOT.length) + ':' + (i + 1)); });
  }
  assert.deepEqual(bad, []);
});
