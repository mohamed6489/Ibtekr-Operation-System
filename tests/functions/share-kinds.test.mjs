// The kinds of the system's data an outside AI may be given by the member's approval (0150): the consent card names every kind the
// server may ask about — one list on the server (DATA_KINDS + SHARE_MORE), the same on the page (IBBrainShare.KINDS) and in the
// assistants' adapter (SHARE_KINDS). A kind the page does not know would be dropped from the question, and never approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA_KINDS, SHARE_MORE, shareKinds } from '../../supabase/functions/_shared/ai-assistant.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the consent card knows every kind the server may ask about, and no other', () => {
  const src = read('app/js/pages/brain-share.js'); const body = src.slice(src.indexOf('const KINDS = {'), src.indexOf('};', src.indexOf('const KINDS = {')));
  const page = [...body.matchAll(/^\s{4}([a-z]+): D\(/gm)].map((m) => m[1]);
  assert.deepEqual(page.slice().sort(), DATA_KINDS.concat(SHARE_MORE).sort());
});

test('the assistants\' adapter passes on the kinds an assistant\'s chat may be given (the header assistant\'s own three stay out)', () => {
  const src = read('app/js/adapter/marketing.js'); const m = /const SHARE_KINDS = \[([^\]]+)\]/.exec(src); assert.ok(m);
  const list = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(list.slice().sort(), DATA_KINDS.filter((k) => !['summary', 'vendor', 'files'].includes(k)).concat(SHARE_MORE).sort());
});

test('shareKinds: the known kinds of a list, once each — the extra two only where they are allowed', () => {
  assert.deepEqual(shareKinds(['orders', 'orders', 'ads', 'nope', 5, 'hr']), ['orders', 'hr']);
  assert.deepEqual(shareKinds(['orders', 'ads', 'site'], SHARE_MORE), ['orders', 'ads', 'site']);
  assert.deepEqual(shareKinds(null), []); assert.deepEqual(shareKinds('orders'), []);
});
