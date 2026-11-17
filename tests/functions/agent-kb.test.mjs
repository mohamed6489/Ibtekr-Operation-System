// ش40 — the assistants' rules and skills (0118): the cleaning, the admin's checks (0118's limits) and the prompt text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KB_ITEMS, KB_PROMPT, KB_SECTIONS, kbBlocks, kbCheck, kbOf, kbText } from '../../supabase/functions/_shared/agent-kb.js';
import { agentRequest, buyerRequest } from '../../supabase/functions/_shared/marketing.js';

test('ش40: the stored sections are cleaned — names and titles one line, no < >, ids kept or given, the limits', () => {
  const g = kbOf([{ id: 'brand', name: ' البراند ', items: [{ id: 'r1', title: ' الألوان ', text: 'أخضر\r\nودهبي <b>' }, { title: '', text: 'x' }, { title: 'اللوجو' }] }, { name: '', items: [] }, 'x', { name: 'تاني' }]);
  assert.deepEqual(g, [
    { id: 'brand', name: 'البراند', items: [{ id: 'r1', title: 'الألوان', text: 'أخضر\nودهبي b' }, { id: 'i1_2', title: 'اللوجو', text: '' }] },
    { id: 'g2', name: 'تاني', items: [] }]);
  assert.equal(kbOf(Array.from({ length: 20 }, (_, i) => ({ name: 's' + i }))).length, KB_SECTIONS);
  assert.equal(kbOf([{ name: 's', items: Array.from({ length: 40 }, (_, i) => ({ title: 't' + i })) }])[0].items.length, KB_ITEMS);
  assert.deepEqual(kbOf(null), []);
});

test('ش40: the admin\'s checks say which field is wrong (0118\'s)', () => {
  assert.deepEqual(kbCheck('x'), { error: 'groups' });
  assert.deepEqual(kbCheck([{ name: '' }]), { error: 'name' });
  assert.deepEqual(kbCheck([{ name: 'a'.repeat(61) }]), { error: 'name' });
  assert.deepEqual(kbCheck([{ name: 'x', items: [{ title: '<b>' }] }]), { error: 'title' });
  assert.deepEqual(kbCheck([{ name: 'x', items: [{ title: 't', text: 'a'.repeat(1501) }] }]), { error: 'text' });
  assert.deepEqual(kbCheck(Array.from({ length: 13 }, () => ({ name: 'x' }))), { error: 'groups' });
  assert.deepEqual(kbCheck(Array.from({ length: 12 }, () => ({ name: 'x', items: Array.from({ length: 2 }, () => ({ title: 't', text: 'a'.repeat(1000) })) }))), { error: 'size' });
  assert.equal(kbCheck([{ name: 'x', items: [{ title: 't', text: 'ok' }] }]).groups.length, 1);
});

test('ش40: the prompt text — the head, a section per heading, an item per line; empty sections left out; cut on a whole item', () => {
  const cfg = { rules: [{ name: 'البراند', items: [{ title: 'الألوان', text: 'أخضر\nودهبي' }, { title: 'اللوجو', text: '' }] }, { name: 'فاضي', items: [] }], skills: [] };
  const t = kbText(cfg, 'rules');
  assert.match(t, /^The admin's rules for you/);
  assert.match(t, /## البراند\n- الألوان: أخضر \/ ودهبي\n- اللوجو$/);
  assert.doesNotMatch(t, /فاضي/);
  assert.equal(kbText(cfg, 'skills'), '');
  assert.equal(kbText(null, 'rules'), '');
  const big = { rules: Array.from({ length: 12 }, (_, i) => ({ name: 'قسم ' + i, items: Array.from({ length: 2 }, (_, j) => ({ title: 't' + j, text: 'a'.repeat(1400) })) })) };
  assert.ok(kbText(big, 'rules').length <= KB_PROMPT);
  assert.deepEqual(kbBlocks(cfg).length, 1);
});

test('ش40: the chats carry the assistant\'s rules and skills after the admin\'s instructions; the buyer\'s chat too', () => {
  const cfg = { instructions: 'خليك مختصر', rules: [{ name: 'عام', items: [{ title: 'اللغة', text: 'مصري' }] }], skills: [{ name: 'الريلز', items: [{ title: 'Hook', text: 'أول ثانيتين' }] }] };
  const r = agentRequest({ agent: 'designer', question: 'إيه الجديد؟' }, { model: 'm', effort: 'low', history: [], cfg });
  assert.equal(r.system.length, 5); assert.match(r.system[4].text, /^Actions in the system/); // agents-brain T3: the popups / the page last
  assert.match(r.system[1].text, /خليك مختصر/);
  assert.match(r.system[2].text, /^The admin's rules[\s\S]*- اللغة: مصري/);
  assert.match(r.system[3].text, /^Your skills[\s\S]*- Hook: أول ثانيتين/);
  const b = buyerRequest({ question: 'ازاي؟', history: [] }, { model: 'm', effort: 'low', data: {}, cfg: { rules: cfg.rules } });
  assert.equal(b.system.length, 2);
  assert.equal(buyerRequest({ question: 'ازاي؟', history: [] }, { model: 'm', effort: 'low', data: {} }).system.length, 1);
});
