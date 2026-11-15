import { test } from 'node:test'; import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { dirname, join, normalize } from 'node:path';
import { build, mockFiles, FORBIDDEN, DEMO_HOST, DEMO_TITLE } from '../../tools/demo/build.mjs';
// «نسخة التعليقات» (the owner 15 Nov: «افتحلي السيستم من هنا هحط كومنتاتي عليه»): the copy of the app that runs inside an Artifact on the
// tests' stand-in backend. What must hold for every build: nothing real in it, every file it loads is in it, and an Artifact takes it.

const out = mkdtempSync(join(tmpdir(), 'ib-demo-')); const { files } = build(out);
const read = (f) => readFileSync(join(out, f), 'utf8');
test.after(() => rmSync(out, { recursive: true, force: true }));

test('the copy holds nothing real: no project address, no publishable key, no dev password — and the stand-in address never resolves', () => {
  for (const f of ['index.html', ...files]) for (const re of FORBIDDEN) assert.ok(!re.test(read(f)), f + ' holds ' + re);
  assert.match(DEMO_HOST, /\.invalid$/);
  const cfg = read('config.js'); assert.ok(cfg.includes(`supabaseUrl: 'https://${DEMO_HOST}'`)); assert.ok(cfg.includes('realtime: false')); // no socket either
  assert.ok(read('demo/tests/e2e/supabase-mock.js').includes(`SUPABASE_URL = 'https://${DEMO_HOST}'`)); // the handlers answer that same address
  assert.ok(!files.some((f) => /\.htaccess$|\.md$|\.html$/.test(f)), 'only styles and scripts are published next to the page');
});

test('the page: an Artifact wraps it, so no document tags; the shim and the stand-in load before config.js and the Supabase client', () => {
  const page = read('index.html');
  assert.ok(page.startsWith(`<title>${DEMO_TITLE}</title>`)); assert.ok(!/<!doctype|<html|<head|<body/i.test(page));
  const at = (s) => { const i = page.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('src="demo/shim.js"') < at('src="demo/boot.js"')); assert.ok(at('src="demo/boot.js"') < at('src="config.js"')); assert.ok(at('src="config.js"') < at('src="js/vendor/supabase.js"'));
  for (const m of page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"|<link\b[^>]*\bhref="([^"]+)"/g)) { const u = m[1] || m[2]; if (/^https:/.test(u)) { assert.match(u, /^https:\/\/fonts\.googleapis\.com\//); continue; } assert.ok(files.includes(u), u + ' is published'); }
  assert.deepEqual(JSON.parse(read('files.json')).map((x) => x.path), files);
});

test('the stand-in runs as browser modules: every import is relative, ends in .js and is in the copy', () => {
  const mods = mockFiles(); assert.ok(mods.includes('tests/e2e/supabase-mock.mjs')); assert.ok(mods.length > 10);
  for (const f of files.filter((x) => /^demo\//.test(x))) {
    for (const m of read(f).matchAll(/^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], /^\.{1,2}\/.*\.js$/, f + ' imports ' + m[1]);
      assert.ok(existsSync(join(out, normalize(join(dirname(f), m[1])))), f + ' → ' + m[1]);
    }
  }
});

test('an Artifact takes every file: valid UTF-8 without a raw control character or U+FFFD (the vendored libraries are escaped)', () => {
  for (const f of ['index.html', ...files]) {
    const bytes = readFileSync(join(out, f)); const s = bytes.toString('utf8');
    assert.ok(Buffer.compare(Buffer.from(s, 'utf8'), bytes) === 0, f + ' is UTF-8'); assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/.test(s), f + ' has no control character');
  }
  assert.ok(read('js/vendor/supabase.js').includes('\\x1f')); // the same string, written as its escape
});
