// The owner 17 Nov — «لو كتبتلوا اسم فيندور مثلا بالعربي و هو مكتوب بالانجليزي يقدر يعرفوا … ليهم كلهم و كمان المدير»: names matched by
// their sound — Arabic letters for a Latin name, a missing hamza, one word of the name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_RULE, bestName, fold, nameHas, nameMatches, nameScore, skeleton } from '../../supabase/functions/_shared/names.js';

const V = ['Art Craft', 'Glastora', 'Macrame Studio', 'Woodish', 'Noor Handmade', 'Crafty Corner', 'أحمد للخزف'];

test('names: the same skeleton written either way', () => {
  assert.equal(skeleton('Art Craft'), skeleton('ارت كرافت'));
  assert.equal(skeleton('Glastora'), skeleton('جلاستورا'));
  assert.equal(fold('أحمـد'), 'احمد');
  assert.equal(nameScore('glastora', 'Glastora'), 1);
});

test('names: the one clearly meant, the near ones when not, a word of the name', () => {
  assert.equal(bestName('ارت كرافت', V), 'Art Craft');
  assert.equal(bestName('جلاستورا', V), 'Glastora');
  assert.equal(bestName('ماكرامي', V), 'Macrame Studio');
  assert.equal(bestName('نور', V), 'Noor Handmade');
  assert.equal(bestName('احمد للخزف', V), 'أحمد للخزف');
  assert.equal(bestName('كرافتي', V), null); // two are close — ask
  assert.deepEqual(nameMatches('كرافتي', V).map((m) => m.item).slice(0, 2).sort(), ['Art Craft', 'Crafty Corner']);
  assert.equal(bestName('xyz', V), null);
  assert.equal(nameHas('ارت كرافت', 'Order 12', 'Art Craft'), true);
  assert.equal(nameHas('ارت كرافت', 'Glastora'), false);
});

test('names: the rule every assistant reads', () => { assert.match(NAME_RULE, /didYouMean/); assert.match(NAME_RULE, /Art Craft/); });
