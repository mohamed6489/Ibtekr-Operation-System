// 0137: a call through the API runs with pg_safeupdate — a DELETE or an UPDATE without a WHERE clause is refused («DELETE requires a WHERE
// clause»), even inside a security definer function. The latest definition of every function in the migrations must not have one
// (`where true` when a whole table is meant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../../supabase/migrations/', import.meta.url).pathname;

function latestBodies() {
  const out = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const re = /create\s+or\s+replace\s+function\s+(public\.[a-z0-9_]+)\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const open = sql.indexOf('$$', m.index);
      if (open < 0) continue;
      const close = sql.indexOf('$$', open + 2);
      if (close < 0) continue;
      out.set(m[1].toLowerCase(), { file: f, body: sql.slice(open + 2, close) });
    }
  }
  return out;
}

// each DELETE / UPDATE statement up to its «;» — dynamic ones inside format('…') too
function unguarded(body) {
  const code = body.replace(/--[^\n]*/g, '');
  const bad = [];
  const re = /\b(delete\s+from\s+[\w."%]+|update\s+(?!set\b)[\w."%]+\s+set\b)/gi;
  let m;
  while ((m = re.exec(code))) {
    const end = code.indexOf(';', m.index);
    const stmt = code.slice(m.index, end < 0 ? undefined : end);
    if (!/\bwhere\b/i.test(stmt)) bad.push(stmt.replace(/\s+/g, ' ').slice(0, 90));
  }
  return bad;
}

test('0137: no function (latest definition) runs a DELETE or UPDATE without WHERE — pg_safeupdate refuses it through the API', () => {
  const found = [];
  for (const [name, { file, body }] of latestBodies()) for (const s of unguarded(body)) found.push(`${name} (${file}): ${s}`);
  assert.deepEqual(found, []);
});

test('0137: the scan sees the old wipe statements', () => {
  assert.equal(unguarded("begin execute format('delete from %s', v_rel::regclass); end").length, 1);
  assert.equal(unguarded('delete from public.invites;').length, 1);
  assert.equal(unguarded('update public.x set a = 1;').length, 1);
  assert.equal(unguarded("execute format('delete from %s where true', r); delete from t where id = 1; insert into t values (1) on conflict (id) do update set a = 1;").length, 0);
});
