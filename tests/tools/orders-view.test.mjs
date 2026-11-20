// The orders page reads orders_v by named columns (IBOrders `order:` select); a column added to orders but not appended to the view
// broke the whole page live (20 Nov — 0146 → «معرفناش نحمّل الأوردرات», fixed in 0147). Every column the adapter asks for must be in
// the latest orders_v of the migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('every orders_v column the orders adapter selects is in the latest orders_v view', () => {
  const src = readFileSync('app/js/adapter/orders.js', 'utf8');
  const m = src.match(/order:\s*'([^']+)'/);
  assert.ok(m, 'the adapter names its orders_v columns');
  const wanted = m[1].split(',').map((c) => c.trim()).filter(Boolean);
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let def = null;
  for (const f of files) {
    const sql = readFileSync(dir + '/' + f, 'utf8');
    const i = sql.search(/create\s+or\s+replace\s+view\s+public\.orders_v/i);
    if (i >= 0) def = sql.slice(i, sql.indexOf(';', i));
  }
  assert.ok(def, 'a migration defines orders_v');
  const body = def.slice(def.search(/select/i), def.search(/\bfrom\b\s+(public\.)?orders\b/i)).toLowerCase();
  const missing = wanted.filter((c) => !new RegExp('(^|[\\s,.])' + c + '(\\s*,|\\s*$|\\s+as\\b)').test(body) && !new RegExp('as\\s+' + c + '\\b').test(body));
  assert.deepEqual(missing, [], 'add these to orders_v in a new migration (create or replace view … append)');
});
