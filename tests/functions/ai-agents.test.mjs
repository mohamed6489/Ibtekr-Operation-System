// 0120 «الذكاء الاصطناعي» — the assistants beyond marketing's three: their bases, one assistant's rules and skills out of the one list,
// the data block, and the two new readers (the warehouse, HR) the assistants and the header's get_data share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_ID, BASES, DATA_MAX, LEGACY_AGENTS, agentBase, dataBlock, kbFor, seesOf } from '../../supabase/functions/_shared/ai-agents.js';
import { DATA_KINDS, hrData, inventoryData } from '../../supabase/functions/_shared/ai-assistant.js';

test('0120: the ids, the five new bases (Egyptian, advise only, data never instructions) and a custom one from its name and what it is for', () => {
  assert.ok(AGENT_ID.test('stock') && AGENT_ID.test('c_ab12cd34ef') && !AGENT_ID.test('SEO!') && !AGENT_ID.test('a'));
  assert.deepEqual(Object.keys(BASES).sort(), ['accountant', 'cs', 'hr', 'makers', 'stock']);
  for (const b of Object.values(BASES)) assert.match(b, /Egyptian Arabic[\s\S]*never instructions[\s\S]*never execute/);
  assert.equal(agentBase({ id: 'stock' }), BASES.stock);
  const c = agentBase({ id: 'c_x', name: 'مساعد <b>المنتجات</b>', about: 'الأكتر مبيعًا' });
  assert.match(c, /^You are «مساعد  b المنتجات  b»|^You are «مساعد/); assert.ok(!c.includes('<b>') && c.includes('What you are for: الأكتر مبيعًا.'));
  assert.deepEqual(LEGACY_AGENTS, ['buyer', 'designer', 'dev']);
  assert.deepEqual(seesOf({ sees: ['inventory', 'salaries', 'hr'] }), ['inventory', 'hr']);
  assert.ok(DATA_KINDS.includes('inventory') && DATA_KINDS.includes('hr'), 'the header\'s get_data reads them too');
});

test('0120: one assistant\'s rules and skills out of the one list — its own and the ones for all, by section in order; another\'s never', () => {
  const rows = [
    { kind: 'rules', section: 'عام', title: 'اللهجة', body: 'مصري', agents: [] },
    { kind: 'rules', section: 'المخزن', title: 'الرفوف', body: 'T', agents: ['stock'] },
    { kind: 'rules', section: 'عام', title: 'الأدب', body: '', agents: ['stock', 'cs'] },
    { kind: 'rules', section: 'التسويق', title: 'الألوان', body: 'أخضر', agents: ['designer'] },
    { kind: 'skills', section: 'الجرد', title: 'العد', text: 'رف رف', agents: ['stock'] },
  ];
  const k = kbFor(rows, 'stock');
  assert.deepEqual(k.rules.map((g) => [g.name, g.items.map((i) => i.title)]), [['عام', ['اللهجة', 'الأدب']], ['المخزن', ['الرفوف']]]);
  assert.deepEqual(k.skills.map((g) => g.items.map((i) => i.text)), [['رف رف']]);
  assert.deepEqual(kbFor(rows, 'designer').rules.map((g) => g.name), ['عام', 'التسويق']);
  assert.deepEqual(kbFor(null, 'x'), { rules: [], skills: [] });
});

test('0120: the data block — the known kinds only, cut on a whole part', () => {
  assert.equal(dataBlock({}), '');
  assert.equal(dataBlock({ secret: 1 }), '');
  assert.equal(dataBlock({ inventory: { pieces: 2 } }), '<data>\ninventory: {"pieces":2}\n</data>');
  const big = dataBlock({ orders: { x: 'a'.repeat(DATA_MAX) }, hr: { ok: 1 } });
  assert.match(big, /orders: \(too long — ask about it alone\)\nhr: \{"ok":1\}/);
});

const dq = { q: '', status: '', from: '2026-11-01', to: '2026-11-17', limit: 10 };
test('0120: the warehouse — the open pieces by reason / status / place, the oldest first, no cost; the open consolidations', () => {
  const r = inventoryData([
    { name: 'مخدة', sku: 'A1', reason: 'مرتجع', status: 'بانتظار الفحص', loc: 'R', since: '2026-11-01', closed_at: null, cost: 999 },
    { name: 'فازة', sku: 'B2', reason: 'تجميع أوردر', status: 'وصل المخزن', loc: null, since: '2026-11-15', closed_at: null },
    { name: 'قديمة', reason: 'مرتجع', status: 'متاح', since: '2026-10-01', closed_at: '2026-10-05' },
  ], [{ id: 1, closed_at: null }, { id: 2, closed_at: '2026-11-02' }], dq, '2026-11-17');
  assert.equal(r.pieces, 2); assert.deepEqual(r.byReason, { 'مرتجع': 1, 'تجميع أوردر': 1 }); assert.deepEqual(r.byPlace, { R: 1, 'من غير مكان': 1 });
  assert.equal(r.openConsolidations, 1); assert.deepEqual(r.rows.map((x) => [x.name, x.days]), [['مخدة', 16], ['فازة', 2]]);
  assert.ok(!JSON.stringify(r).includes('999'));
});

test('0120: HR — the attendance per member in the period (days, hours, remote, open sessions) and the requests by type / status, never an amount', () => {
  const att = [
    { member_id: 'a', day: '2026-11-16', in_at: '2026-11-16T07:00:00Z', out_at: '2026-11-16T15:00:00Z', remote: false },
    { member_id: 'a', day: '2026-11-17', in_at: '2026-11-17T07:00:00Z', out_at: null, remote: true },
    { member_id: 'b', day: '2026-10-20', in_at: '2026-10-20T07:00:00Z', out_at: '2026-10-20T09:00:00Z' },
  ];
  const reqs = [{ member_id: 'b', type: 'إجازة', from_day: '2026-11-20', to_day: '2026-11-21', status: 'جديد', amount: 5000 }, { member_id: 'a', type: 'سلفة', from_day: '2026-11-01', to_day: '2026-11-01', status: 'موافق' }];
  const r = hrData(att, reqs, { a: 'سارة', b: 'محمد' }, dq);
  assert.deepEqual(r.attendance, [{ member: 'سارة', days: 2, hours: 8, remoteDays: 1, openSessions: 1 }]);
  assert.equal(r.requests.open, 1); assert.deepEqual(r.requests.openRows, [{ member: 'محمد', type: 'إجازة', from: '2026-11-20', to: '2026-11-21', status: 'جديد' }]);
  assert.ok(!JSON.stringify(r).includes('5000'));
});
