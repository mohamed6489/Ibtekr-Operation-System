// The owner 17 Nov — the warehouse assistant's products plan: «هات الكراسي من مبتكر معين و حطهم في قسم معين و هات حاجة تانية من مبتكر تاني
// وحطهم في نفس القسم», each step with its count, resolved by sound in both languages; nothing runs from here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, planProducts, resolvePlan, PLAN_RULE, PLAN_SCHEMA } from '../../supabase/functions/_shared/product-plan.js';

const DATA = {
  vendors: [{ id: 'v1', name: 'Art Craft' }, { id: 'v2', name: 'Woodish' }],
  products: planProducts([
    { id: 1, name: 'Wooden Chair', sku: 'IBTWOD0999', vendor_id: 'v2', category_ids: [10], status: 'publish', lang: 'en', translation_ids: { ar: 2 } },
    { id: 2, name: 'كرسي خشب', vendor_id: 'v2', category_ids: [10], status: 'publish', lang: 'ar', translation_ids: { en: 1 } },
    { id: 3, name: 'Side Table', vendor_id: 'v2', category_ids: [11], status: 'publish', lang: 'en' },
    { id: 4, name: 'Macrame Lamp', vendor_id: 'v1', category_ids: [12], status: 'publish', lang: 'en' },
    { id: 5, name: 'Old', vendor_id: 'v1', category_ids: [], status: 'trash', lang: 'en' }]),
  categories: [{ id: 10, name: 'Chairs', nameAr: '', parentId: null }, { id: 11, name: 'Tables', nameAr: '', parentId: null }, { id: 12, name: 'Lighting', nameAr: '', parentId: null }],
};

test('plan: the mirror read as products with their Arabic names (the trash out)', () => {
  assert.deepEqual(DATA.products.map((p) => [p.id, p.nameAr]), [[1, 'كرسي خشب'], [3, ''], [4, '']]);
});

test('plan: a new category, then the chairs of one maker and the lamps of another into it — by sound, in Arabic', () => {
  const steps = cleanPlan([
    { op: 'category_create', new_en: 'Living Room', new_ar: 'الليفنج', parent: '' },
    { op: 'category_add', maker: 'وودش', query: ['chair', 'كرسي'], category: 'Living Room' },
    { op: 'category_add', maker: 'ارت كرافت', query: ['lamp'], category: 'Living Room' },
    { op: 'move_maker', maker: 'وودش', query: ['table'], to_maker: 'Art Craft' },
    { op: 'status', maker: 'Woodish', query: [], status: 'draft' },
    { op: 'category_remove', maker: 'Nobody', query: ['x'], category: 'Chairs' },
    { op: 'hack', maker: 'x' }]);
  assert.equal(steps.length, 6, 'an unknown op is dropped');
  const r = resolvePlan(steps, DATA);
  assert.match(r[0].label, /قسم جديد «Living Room \/ الليفنج» رئيسي/);
  assert.deepEqual([r[1].ids, r[1].maker.name, r[1].category.new, r[1].mode], [[1], 'Woodish', true, 'add']);
  assert.match(r[1].label, /ضيف 1 منتج من Woodish لـ «Living Room»/);
  assert.deepEqual([r[2].ids, r[2].maker.name], [[4], 'Art Craft']);
  assert.deepEqual([r[3].ids, r[3].toMaker.name], [[3], 'Art Craft']);
  assert.deepEqual(r[4].ids.sort(), [1, 3]); assert.match(r[4].label, /«مسودة»/);
  assert.match(r[5].problem, /مش لاقي المبتكر «Nobody»/);
});

test('plan: the rule and the schema for the answer', () => {
  assert.match(PLAN_RULE, /waits for the member's button/); assert.deepEqual(PLAN_SCHEMA().items.required.slice(0, 3), ['op', 'maker', 'query']);
});
