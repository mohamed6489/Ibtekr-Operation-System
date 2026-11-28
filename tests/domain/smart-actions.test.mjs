// «إجراءات ذكية» (app/js/pages/smart-actions.js — docs/superpowers/plans/2026-11-28-smart-actions.md, Safwat 28 Nov): the assistant
// chat's menu shows the five requests and reports this member asks this assistant the most, the assistant's own five filling the
// rest — what he may only; every item is a request the system runs or a report it reads.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const w = globalThis;
w.IBNotifCatalog = loadUmd(new URL('../../app/js/pages/notif-catalog.js', import.meta.url));
w.IBAgentReady = loadUmd(new URL('../../app/js/pages/agent-ready.js', import.meta.url));
w.IBRequestAsk = loadUmd(new URL('../../app/js/pages/request-ask.js', import.meta.url));
const S = loadUmd(new URL('../../app/js/pages/smart-actions.js', import.meta.url));
const RQ = w.IBRequestAsk; const AR = w.IBAgentReady;

test('each assistant\'s own five are real: a request the system has a way for, a report with a list behind it', () => {
  for (const [agent, list] of Object.entries(S.DEFAULTS)) {
    assert.ok(list.length >= 1 && list.length <= 5, agent);
    for (const it of list) {
      if (it.kind === 'request') assert.ok(RQ.route(it), agent + ' ' + S.keyOf(it));
      else for (const p of it.parts) for (const st of p.states) assert.ok(AR.reportable(p.element, p.type, st), agent + ' ' + S.keyOf(it));
      assert.ok(S.labelOf(it), agent + ' ' + S.keyOf(it));
    }
  }
  // his example: «التشغيل يبقا في اجراءاته الذكية إضافة منتج ، إضافة مبتكر ، مبتكرين متأخرين»
  assert.deepEqual(S.DEFAULTS.stock.slice(0, 3).map(S.labelOf), ['إضافة منتج', 'إضافة مبتكر', 'مبتكرين متأخرين']);
  // an assistant the admin added: from the data it reads
  assert.deepEqual(S.defaultsOf('x-new', ['orders', 'hr', 'nothing']).map(S.labelOf), ['أوردرات متأخرة', 'طلبات إجازة مستنية']);
  assert.deepEqual(S.defaultsOf('x-new', []), []);
});

test('top: his most used first (the count, then the latest), the assistant\'s own after them, five at most, what he may only', () => {
  const rp = (e, t, s) => ({ kind: 'report', parts: [{ element: e, type: t, states: [s], items: [] }] });
  let used = {};
  used = S.record(used, 'stock', rp('products', 'stock', 'out'), '2026-11-28T10:00:00Z');
  used = S.record(used, 'stock', { kind: 'request', verb: 'edit', element: 'order' }, '2026-11-28T09:00:00Z');
  used = S.record(used, 'stock', { kind: 'request', verb: 'edit', element: 'order' }, '2026-11-28T09:30:00Z');
  const five = S.top('stock', used);
  assert.deepEqual(five.map(S.labelOf), ['تعديل أوردر رئيسي', 'منتجات نفدت', 'إضافة منتج', 'إضافة مبتكر', 'مبتكرين متأخرين']);
  // one already in the five is not repeated; another assistant's use is not his
  used = S.record(used, 'stock', { kind: 'request', verb: 'add', element: 'maker' }, '2026-11-28T11:00:00Z');
  used = S.record(used, 'cs', { kind: 'request', verb: 'add', element: 'product' }, '2026-11-28T11:00:00Z');
  assert.deepEqual(S.top('stock', used).map(S.labelOf), ['تعديل أوردر رئيسي', 'إضافة مبتكر', 'منتجات نفدت', 'إضافة منتج', 'مبتكرين متأخرين']);
  // what he may not do is left out — the next one comes up
  const may = (it) => !(it.kind === 'request' && it.element === 'maker');
  assert.deepEqual(S.top('stock', used, { may }).map(S.labelOf), ['تعديل أوردر رئيسي', 'منتجات نفدت', 'إضافة منتج', 'مبتكرين متأخرين', 'أوردرات متأخرة']);
  // a may that throws = not shown; nothing usable = an empty menu part
  assert.deepEqual(S.top('stock', used, { may: () => { throw new Error('x'); } }), []);
});

test('record: a new object, the count and the time; the 20 most used kept; junk is never kept', () => {
  const before = {}; const after = S.record(before, 'hr', { kind: 'request', verb: 'add', element: 'member' }, '2026-11-28T08:00:00Z');
  assert.deepEqual(before, {});
  assert.deepEqual(after.hr['rq:add.member'], { n: 1, at: '2026-11-28T08:00:00Z', item: { kind: 'request', verb: 'add', element: 'member', sub: '' } });
  assert.equal(S.record(after, 'hr', { kind: 'request', verb: 'add', element: 'member' }, '2026-11-28T09:00:00Z').hr['rq:add.member'].n, 2);
  let u = {};
  for (let i = 0; i < 25; i++) u = S.record(u, 'manager', { kind: 'report', parts: [{ element: 'orders', type: 'status', states: ['s' + i], items: [] }] }, '2026-11-28T08:' + String(i).padStart(2, '0') + ':00Z');
  assert.equal(Object.keys(u.manager).length, 20);
  for (const bad of [null, { kind: 'request', verb: 'fly', element: 'maker' }, { kind: 'request', verb: 'add', element: 'moon' }, { kind: 'report', parts: [] }, { kind: 'report', parts: [{ element: 'orders', type: 'delay', states: [] }] }, { kind: 'x' }])
    assert.deepEqual(S.record({}, 'hr', bad), {}, JSON.stringify(bad));
  assert.deepEqual(S.record({}, '', { kind: 'request', verb: 'add', element: 'member' }), {});
});

test('keyOf / labelOf: one report = one key whatever the order; the short names', () => {
  const a = { kind: 'report', parts: [{ element: 'orders', type: 'delay', states: ['risk', 'late'], items: ['ب', 'أ'] }] };
  const b = { kind: 'report', parts: [{ element: 'orders', type: 'delay', states: ['late', 'risk'], items: ['أ', 'ب'] }] };
  assert.equal(S.keyOf(a), S.keyOf(b));
  assert.equal(S.keyOf({ kind: 'request', verb: 'add', element: 'money', sub: 'expense' }), 'rq:add.money.expense');
  // a sub-kind belongs to an add only
  assert.equal(S.keyOf({ kind: 'request', verb: 'edit', element: 'money', sub: 'expense' }), 'rq:edit.money');
  assert.equal(S.labelOf({ kind: 'request', verb: 'add', element: 'money', sub: 'makerMove' }), 'إضافة حركة على حساب مبتكر');
  assert.equal(S.labelOf({ kind: 'report', parts: [{ element: 'makers', type: 'making', states: ['late'], items: ['أنتيكا', 'بيت', 'جملة'] }] }), 'مبتكرين متأخرين — أنتيكا، بيت…');
  assert.equal(S.labelOf({ kind: 'report', parts: [{ element: 'orders', type: 'delay', states: ['late'], items: [] }, { element: 'makers', type: 'accounts', states: ['withdraw_wait'], items: [] }] }),
    'أوردرات متأخرة + طلبات سحب مستنية'); // the elements in the order he picked them
  assert.ok(S.labelOf({ kind: 'report', parts: [{ element: 'orders', type: 'status', states: ['جاري التنفيذ'], items: [] }] }).startsWith('أوردرات '));
  assert.equal(S.iconOf({ kind: 'request', verb: 'delete', element: 'product' }), 'trash');
  assert.equal(S.iconOf({ kind: 'report', parts: [{ element: 'orders', type: 'delay', states: ['late'] }] }), 'chart');
});

test('fromFlow: a chat flow said in words is that request; the team request is not one of them', () => {
  assert.deepEqual(S.fromFlow('expense'), { kind: 'request', verb: 'add', element: 'money', sub: 'expense' });
  assert.equal(S.labelOf(S.fromFlow('makerEdit')), 'تعديل مبتكر');
  assert.equal(S.fromFlow('request'), null); assert.equal(S.fromFlow('nope'), null);
  for (const id of ['expense', 'makerMove', 'post', 'maker', 'makerEdit', 'productEdit', 'trash', 'order']) { const it = S.fromFlow(id); assert.equal(RQ.route(it).flow, id, id); }
});
