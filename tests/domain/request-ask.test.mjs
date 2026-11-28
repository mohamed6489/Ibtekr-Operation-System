// «املا البيانات دي من اللينك ده» (app/js/pages/request-ask.js — docs/superpowers/plans/2026-11-28-ask-popups.md, phase B, Safwat 28 Nov):
// an add / edit / delete in a few words is a popup of the request's kind and its element; every pick has its way in the system — the
// chat's steps, the system's own popup, or its page behind a link.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const RQ = loadUmd(new URL('../../app/js/pages/request-ask.js', import.meta.url));

test('detect / preOf: the kind and the element said; a read, a report or a long ask is not one', () => {
  for (const t of ['عايز أضيف حاجة', 'عايز أعدّل', 'امسح', 'امسح مبتكر', 'عدّل قسم', 'ضيف موظف']) assert.equal(RQ.detect(t), true, t);
  for (const t of ['كام أوردر متأخر', 'عايز تقرير', 'إيه الأخبار', '', 'عايز أضيف منتج جديد للمبتكر اللي كلمني امبارح وقالي هيبعت الصور بكرة الصبح']) assert.equal(RQ.detect(t), false, t);
  assert.deepEqual(RQ.preOf('امسح مبتكر'), { verb: 'delete', element: 'maker' });
  assert.deepEqual(RQ.preOf('عدّل أوردر فرعي'), { verb: 'edit', element: 'sub' });
  assert.deepEqual(RQ.preOf('عايز أضيف حاجة'), { verb: 'add', element: '' });
  // both said = runs with no popup; a money add asks its kind first
  assert.equal(RQ.complete(RQ.preOf('ضيف منتجات')), true); assert.equal(RQ.complete(RQ.preOf('عايز أعدّل')), false);
  assert.equal(RQ.complete({ verb: 'add', element: 'money' }), false); assert.equal(RQ.complete({ verb: 'add', element: 'money', sub: 'expense' }), true);
});

test('route: every kind × element has its way — the steps where they exist, else the system popup or the page', () => {
  for (const [v] of RQ.VERBS) for (const [e] of RQ.ELEMENTS) assert.ok(RQ.route({ verb: v, element: e }), v + '.' + e);
  assert.deepEqual(RQ.route({ verb: 'edit', element: 'product' }), { flow: 'productEdit' });
  assert.deepEqual(RQ.route({ verb: 'delete', element: 'product' }), { flow: 'trash' });
  assert.deepEqual(RQ.route({ verb: 'add', element: 'money', sub: 'makerMove' }), { flow: 'makerMove' });
  assert.deepEqual(RQ.route({ verb: 'add', element: 'money', sub: 'expense' }), { flow: 'expense' });
  assert.deepEqual(RQ.route({ verb: 'add', element: 'member' }), { form: 'member_add', values: {} });
  assert.equal(RQ.route({ verb: 'delete', element: 'category' }).page.hash, 'products-cats');
  assert.equal(RQ.summary({ verb: 'add', element: 'money', sub: 'makerMove' }), 'طلب: إضافة رقم مالي — حركة على حساب مبتكر');
});

test('detect: an ask with details of its own («زي الشهر اللي فات», a name) goes its old way — the bare ask only', () => {
  for (const t of ['عايز أسجل مصروف الكهربا زي الشهر اللي فات', 'ضيف منتج للمبتكر أنتيكيانو بسعر 500']) assert.equal(RQ.detect(t), false, t);
  for (const t of ['عايز أضيف منتجات', 'محتاج أمسح أوردر فرعي', 'ممكن أعدّل موظف']) assert.equal(RQ.detect(t), true, t);
});
