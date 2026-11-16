// the owner 16 Nov: «لون الهوفر لاي background بيتعملها hover يبقي #F9F0E2» — every light hover background is the one token
// (--color-bg-hover in the CSS files, --bg-hover inside the orders page); only filled buttons, what is selected, the green headers'
// see-through shades and the scroll bar keep their own hover colour
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KEEP = [/--color-brand-(hover|default)/, /--color-action-(hover|default)/, /--color-selected-bg/, /--color-brand-subtle-bg\)/, /--color-text-on-brand/, /--color-text-primary/,
  /rgba\(255,\s*247,\s*239/, /transparent/, /--err-/, /--color-bg-hover\)/, /--bg-hover\)/];
const hovers = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes(':hover'))
  .flatMap((m) => [...m[2].matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)].map((b) => ({ sel: m[1].trim().slice(-80), v: b[1].trim() })));

test('the hover colour is #F9F0E2 and every light hover background uses it', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app/css/app.css'), 'utf8');
  assert.match(app, /:root\{--color-bg-hover:#F9F0E2\}/);
  const orders = fs.readFileSync(path.join(ROOT, 'app/js/blocks/29-orders-app.js'), 'utf8');
  assert.match(orders, /--bg-hover:#F9F0E2/);
  const css = fs.readdirSync(path.join(ROOT, 'app/css')).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(ROOT, 'app/css', f), 'utf8'));
  const ordersCss = orders.slice(orders.indexOf('var CSS="'), orders.indexOf('";', orders.indexOf('var CSS="'))).replace(/\\n/g, '\n');
  const odd = [...css, ordersCss].flatMap(hovers).filter((h) => !KEEP.some((r) => r.test(h.v)));
  assert.deepEqual(odd, []);
});
