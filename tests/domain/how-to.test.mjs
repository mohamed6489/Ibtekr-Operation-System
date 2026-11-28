// «إزاي…» (app/js/pages/how-to.js — docs/superpowers/plans/2026-11-28-faults-howto.md, phase B, Safwat 28 Nov): a «how do I» is a ready
// answer — numbered steps with the system's screens — for every add / edit / delete × element of the request popup, «أحاسب مبتكر» and
// «أعمل تصميم جديد» (the campaign); every screen it names is in app/img/howto and every guide has its screens' recipe.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { loadUmd } from '../helpers/load-umd.mjs';
const HT = loadUmd(new URL('../../app/js/pages/how-to.js', import.meta.url));
const RQ = loadUmd(new URL('../../app/js/pages/request-ask.js', import.meta.url));
const { RECIPES } = await import('../../tools/howto/recipes.mjs');

test('every add / edit / delete × element of the request popup has a guide, + «أحاسب مبتكر»', () => {
  for (const [v] of RQ.VERBS) for (const [e] of RQ.ELEMENTS) assert.ok(HT.GUIDES[v + '.' + e], v + '.' + e);
  assert.ok(HT.GUIDES['settle.maker']);
  // the menu shows each guide once
  const shown = HT.GROUPS.flatMap(([, l]) => l); assert.deepEqual([...shown].sort(), HT.ids().sort());
});

test('detect: the «how» with its verb and element; «أحاسب مبتكر»; «تصميم جديد» = the campaign; a «how» it doesn\'t know = the menu; no «how» = nothing', () => {
  const cases = { 'إزاي أضيف مبتكر': 'add.maker', 'ازاي اعدل منتج؟': 'edit.product', 'إزاي أمسح أوردر فرعي': 'delete.sub', 'ازاي امسح اوردر': 'delete.order',
    'إزاي أحاسب مبتكر': 'settle.maker', 'إزاي أعمل تصميم جديد': 'add.design', 'ازاي اعمل كامبين': 'add.design', 'إزاي أسجل مصروف': 'add.money', 'ازاي اضيف قسم': 'add.category',
    'اشرحلي ازاي اضيف موظف': 'add.member', 'خطوات تعديل بيانات موظف': 'edit.member', 'إزاي أعمل أوردر جديد': 'add.order', 'ازاي منتج': 'add.product',
    'إزاي أستخدم السيستم': 'menu', 'ازاي': 'menu',
    // «إجراءات ذكية» — the elements added (2026-11-28-smart-actions.md)
    'إزاي أضيف عميل': 'add.customer', 'ازاي ادمج عميل مكرر': 'delete.customer', 'ازاي الغي طلب اجازه': 'delete.hr', 'إزاي أقدم على سلفة': 'add.hr',
    'إزاي أستلم قطعة في المخزن': 'add.lot', 'ازاي اشيل قطعه من المخزن': 'delete.lot', 'ازاي اعدل براند': 'edit.brand', 'إزاي أضيف براند للمبتكر': 'add.brand' };
  for (const [q, id] of Object.entries(cases)) assert.equal(HT.detect(q), id, q);
  for (const q of ['ضيف مبتكر', 'امسح الأوردر 123', 'كام أوردر متأخر', '', 'عايز تقرير المبتكرين']) assert.equal(HT.detect(q), '', q);
});

test('every screen a guide names is in app/img/howto (a WebP, not empty) and every guide\'s screens have a recipe', () => {
  for (const [id, g] of Object.entries(HT.GUIDES)) {
    assert.ok(g.title && g.steps.length, id);
    for (const s of g.steps) {
      assert.ok(s.text && !/[<>]/.test(s.text), id);
      if (!s.img) continue;
      const m = /^img\/howto\/([a-zA-Z.]+)-(\d+)\.webp$/.exec(s.img); assert.ok(m, s.img);
      const f = new URL('../../app/' + s.img, import.meta.url); assert.ok(existsSync(f) && statSync(f).size > 1000, s.img);
      assert.ok(RECIPES[m[1]] && RECIPES[m[1]].length >= Number(m[2]), 'recipe for ' + s.img);
    }
  }
});
