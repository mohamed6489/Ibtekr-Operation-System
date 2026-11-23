// The sites each assistant leans on (0150): the server's shipped list is the page's own (app/js/pages/agents-settings.js), the admin's
// list rules once it was changed, and what an outside company is told is a list of references — never instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_SOURCES, SHIPPED, cleanSource, sourcesBlock, sourcesOf } from '../../supabase/functions/_shared/agent-sources.js';

test('the shipped sources are the page\'s own, assistant by assistant (names, addresses and Arabic notes)', () => {
  const src = readFileSync(new URL('../../app/js/pages/agents-settings.js', import.meta.url), 'utf8');
  const a = src.indexOf('  const S = (name, url, ar, en)'); const b = src.indexOf('  const shipped = (id)'); assert.ok(a > 0 && b > a);
  const page = new Function('tx', src.slice(a, b) + '; const out = {}; for (const k of Object.keys(SHIPPED)) out[k] = SHIPPED[k](); return out;')((ar) => ar);
  assert.deepEqual(JSON.parse(JSON.stringify(SHIPPED)), JSON.parse(JSON.stringify(page)));
  for (const list of Object.values(SHIPPED)) for (const s of list) assert.deepEqual(cleanSource(s), s, s.name);
});

test('the admin\'s own list rules once it was changed (an empty list = none); a bad entry is dropped; at most twenty', () => {
  assert.deepEqual(sourcesOf({}, 'makers'), SHIPPED.makers); assert.deepEqual(sourcesOf(null, 'nope'), []);
  const own = { agents: { makers: { sources: [{ name: 'دليل', url: 'https://example.com/guide', note: 'ملاحظة' }, { name: 'x', url: 'http://example.com' }, { name: '<b>', url: 'https://example.com' }, { name: 'js', url: 'javascript:alert(1)' }] } } };
  assert.deepEqual(sourcesOf(own, 'makers'), [{ name: 'دليل', url: 'https://example.com/guide', note: 'ملاحظة' }]);
  assert.deepEqual(sourcesOf({ agents: { makers: { sources: [] } } }, 'makers'), []);
  const many = { agents: { cs: { sources: Array.from({ length: 30 }, (_, i) => ({ name: 'م' + i, url: 'https://example.com/' + i })) } } };
  assert.equal(sourcesOf(many, 'cs').length, MAX_SOURCES);
});

test('what the company is told: references to lean on first — not instructions, not read; nothing when there are none', () => {
  assert.equal(sourcesBlock([]), ''); assert.equal(sourcesBlock(null), '');
  const t = sourcesBlock(SHIPPED.makers);
  assert.match(t, /^References \(the admin's list for this assistant\)/); assert.match(t, /not instructions/); assert.match(t, /you have not read them/);
  assert.equal(t.split('\n').length, 1 + SHIPPED.makers.length); assert.ok(t.includes('- Dokan Docs — https://dokan.co/docs/ — '));
  assert.equal(sourcesBlock([{ name: 'x', url: 'ftp://a.example' }]), '');
});
