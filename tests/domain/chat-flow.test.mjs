// «خطوات الاختيارات» (app/js/pages/chat-flow.js — chat-flows phase 4, Safwat 25 Nov): an add / edit / delete the system knows, asked
// without what its popup needs, becomes that popup's questions in the chat; an ask that already carries it is left to the system's
// engine (it opens the popup as before); the last step names the system's own popup, filled — nothing is written from the chat.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const F = loadUmd(new URL('../../app/js/pages/chat-flow.js', import.meta.url));
const KINDS = ['المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات'];
const d = (t) => F.detect(t, { kinds: KINDS });

test('detect: an add / edit / delete without what its popup needs is a flow, with what was said already answered', () => {
  assert.deepEqual(d('ضيف مصروف'), { id: 'expense', pre: { direction: 'withdraw' } });
  assert.deepEqual(d('عايز أضيف مصروف'), { id: 'expense', pre: { direction: 'withdraw' } });
  assert.deepEqual(d('ضيف مصروف اعلانات'), { id: 'expense', pre: { direction: 'withdraw', category: 'الإعلانات' } }); // a kind said, with or without «ال»
  assert.deepEqual(d('ضيف إيداع مصروف'), { id: 'expense', pre: { direction: 'deposit' } });
  assert.deepEqual(d('اعمل بوست جديد'), { id: 'post', pre: { kind: 'post' } });
  assert.deepEqual(d('اعمل كاروسيل عن الخصم'), { id: 'post', pre: { kind: 'carousel', idea: 'الخصم' } });
  assert.deepEqual(d('عايز ريل'), { id: 'post', pre: { kind: 'video' } });
  assert.deepEqual(d('افتح طلب'), { id: 'request', pre: {} });
  assert.deepEqual(d('عايز أفتح طلب لعميل'), { id: 'request', pre: { type: 'customer' } });
  assert.deepEqual(d('ضيف مبتكر'), { id: 'maker', pre: {} });
  assert.deepEqual(d('عايز أضيف مبتكر جديد'), { id: 'maker', pre: {} });
  assert.deepEqual(d('عدل الاوردر 1234'), { id: 'order', pre: { order: '1234' } });
  assert.deepEqual(d('اكد الاوردر 1234'), { id: 'order', pre: { order: '1234', what: 'confirm' } });
  assert.deepEqual(d('امسح منتج'), { id: 'trash', pre: {} });
  assert.deepEqual(d('احذف منتج كرسي خشب'), { id: 'trash', pre: { q: 'كرسي خشب' } });
  assert.deepEqual(d('امسح منتج Macrame Curtain'), { id: 'trash', pre: { q: 'Macrame Curtain' } }); // the name as it was written
  assert.deepEqual(d('ضيف مصروف صيانة التكييف'), { id: 'expense', pre: { direction: 'withdraw', details: 'صيانة التكييف' } }); // a few words = what it was for
  assert.deepEqual(d('ضيف مصروف للمبتكر'), { id: 'expense', pre: { direction: 'withdraw' } });
  assert.deepEqual(d('افتح طلب عاجل لعميل'), { id: 'request', pre: { type: 'customer', priority: 'urgent' } });
  assert.deepEqual(d('اعمل بوست عن الخصم الجديد على الكراسي'), { id: 'post', pre: { kind: 'post', idea: 'الخصم الجديد على الكراسي' } });
  // part 2 (26 Nov): a maker's money — «عربون / مواصلات» off his net, «إيداع / تصحيح» on it; a number said is answered too
  assert.deepEqual(d('عربون للمبتكر'), { id: 'makerMove', pre: { direction: 'withdraw', type: 'عربون' } });
  assert.deepEqual(d('ضيف مواصلات لمبتكر'), { id: 'makerMove', pre: { direction: 'withdraw', type: 'مواصلات' } });
  assert.deepEqual(d('سجل عربون ٣٠٠'), { id: 'makerMove', pre: { direction: 'withdraw', type: 'عربون', amount: '300' } });
  assert.deepEqual(d('اخصم من المبتكر'), { id: 'makerMove', pre: { direction: 'withdraw' } });
  assert.deepEqual(d('تصحيح رصيد المبتكر'), { id: 'makerMove', pre: { direction: 'deposit' } }); // «رصيد» here is the edit, not a read
  assert.deepEqual(d('ايداع خارجي للمبتكر'), { id: 'makerMove', pre: { direction: 'deposit' } });
  // one product's edit: the name to search, and what was said picked when that product allows it (state.want)
  assert.deepEqual(d('عدل منتج'), { id: 'productEdit', pre: {} });
  assert.deepEqual(d('غير سعر منتج Macrame Curtain'), { id: 'productEdit', pre: { q: 'Macrame Curtain', want: { what: 'price' } } });
  assert.deepEqual(d('انقل المنتج Cushion لبراند تاني'), { id: 'productEdit', pre: { q: 'Cushion', want: { what: 'brand' } } });
  assert.deepEqual(d('انشر المنتج Cushion'), { id: 'productEdit', pre: { q: 'Cushion', want: { what: 'publish' } } });
});

test('detect: an ask that says more than the steps understand is read whole by the engine or the assistant itself', () => {
  for (const t of ['عايز أسجل مصروف الكهربا زي الشهر اللي فات', 'اعملي فيديو ريل 15 ثانية لفازة المكرمية الجديدة', 'اعملي فيديو للفازة', 'عدل الاوردر 1234 وخلي العميل يستلم بكرة الصبح'])
    assert.equal(d(t), null, t);
});

test('detect: an ask that carries what its popup needs stays with the engine; a read, a report or a maker\'s money is not a flow', () => {
  for (const t of ['مصروف 500 كهربا', 'سجل مصروف 1500', 'ضيف مبتكر احمد', 'افتح طلب التوصيل اتأخر', 'غير حالة الاوردر 1234 مكتمل', 'اكد الاوردر 1234 بعربون',
    'عايز اجازة', 'افتح طلب اجازة', 'اعمل طلب سحب', 'عربون 300 لاحمد', 'رصيد المبتكر كام', 'مصروف مواصلات', 'ضيف منتج', 'اعرض المصروفات', 'كام مصروف النهارده', 'اعمل تقرير عن المصروفات', 'البوست ده', 'الطلب ده اتأخر', 'المصروفات', 'حساب المبتكر احمد', ''])
    assert.equal(d(t), null, t);
});

test('the steps: one at a time, the said ones skipped, a choice / a number / a word checked, the optional skipped, then the popup filled', () => {
  const s = F.create('expense', { direction: 'withdraw' });
  assert.equal(F.current(s).key, 'category');
  assert.equal(F.answer(s, 'category', 'المصروفات'), '');
  assert.equal(F.current(s).key, 'amount');
  assert.equal(F.openSpec(s), null); // not before every step
  assert.match(F.answer(s, 'amount', 'كتير'), /رقم/); assert.match(F.answer(s, 'amount', '0'), /رقم/);
  assert.equal(F.answer(s, 'amount', '٢٬٥٠٠'), ''); assert.equal(s.values.amount, '2500'); // Arabic digits and the thousands mark
  assert.equal(F.current(s).key, 'details');
  assert.equal(F.skip(s, 'details'), true); assert.equal(F.current(s), null);
  assert.deepEqual(F.openSpec(s), { form: 'expense_add', values: { direction: 'withdraw', category: 'المصروفات', amount: '2500', details: '' } });
  F.back(s, 'amount'); assert.equal(F.current(s).key, 'amount'); // «غيّر»
  assert.equal(F.skip(s, 'amount'), false); // a required step cannot be skipped
});

test('a request: its type decides the next steps; changing the type drops the steps that no longer apply', () => {
  const s = F.create('request', {});
  assert.equal(F.current(s).key, 'type');
  F.answer(s, 'type', 'vendor'); assert.equal(F.current(s).key, 'vendor');
  F.answer(s, 'vendor', 'Art Craft'); assert.equal(F.current(s).key, 'title');
  assert.match(F.answer(s, 'title', '  <>  '), /اكتب/); // nothing left after the marks
  F.answer(s, 'title', 'التوصيل اتأخر'); F.answer(s, 'priority', 'urgent');
  assert.deepEqual(F.openSpec(s), { form: 'ticket_new', values: { type: 'vendor', title: 'التوصيل اتأخر', priority: 'urgent', orderId: '', vendor: 'Art Craft' } });
  F.back(s, 'type'); F.answer(s, 'type', 'hr_advance'); // the ticket's steps go
  assert.deepEqual(Object.keys(s.values), ['type']); assert.equal(F.current(s).key, 'amount');
  F.skip(s, 'amount'); assert.deepEqual(F.openSpec(s), { form: 'hr_advance', values: {} });
  const c = F.create('request', { type: 'customer' }); assert.equal(F.current(c).key, 'orderId');
  assert.match(F.answer(c, 'orderId', 'مش رقم'), /أرقام/); assert.equal(F.answer(c, 'orderId', '#١٨٠٦٥٦'), ''); assert.equal(c.values.orderId, '180656');
});

test('a maker, an order, a post and a product: their popups', () => {
  const m = F.create('maker', {}); F.answer(m, 'name', 'Glody');
  assert.match(F.answer(m, 'phone', '12'), /الرقم/); assert.equal(F.answer(m, 'phone', '٠١٠٠٠٠٠٠٠٠٣'), ''); assert.equal(m.values.phone, '01000000003');
  assert.match(F.answer(m, 'email', 'x@'), /الإيميل/); F.skip(m, 'email');
  assert.deepEqual(F.openSpec(m), { form: 'vendor_add', values: { name: 'Glody', phone: '01000000003', email: '' } });
  const o = F.create('order', { order: '1234' }); assert.equal(F.current(o).key, 'what');
  F.answer(o, 'what', 'status'); assert.ok(F.current(o).note); // cancelling has its own popup with a reason
  assert.ok(!F.FLOWS.order.steps.find((x) => x.key === 'status').options({}, {}).some(([v]) => ['ملغي', 'استرجاع', 'فشل'].includes(v)));
  F.answer(o, 'status', 'جاهز للشحن'); assert.deepEqual(F.openSpec(o), { form: 'order_update', values: { order: '1234', status: 'جاهز للشحن' } });
  const p = F.create('post', { kind: 'carousel', idea: 'الخصم' }); F.answer(p, 'goal', 'عرض / خصم');
  assert.deepEqual(F.openSpec(p), { draft: { goal: 'عرض / خصم', idea: 'الخصم', post: 0, carousel: 1, video: 0 } });
  const t = F.create('trash', { q: 'كرسي' }); assert.equal(t.q, 'كرسي'); assert.equal(F.current(t).key, 'product');
  F.answer(t, 'product', { id: 5, name: 'Chair', sku: 'IBTABC0999' }); assert.deepEqual(F.openSpec(t), { trash: { id: 5, name: 'Chair', sku: 'IBTABC0999' } });
  assert.equal(F.shown(t, F.FLOWS.trash.steps[0]), 'Chair · IBTABC0999');
});

test('a maker\'s money: «سحب» asks its kind (and «أخرى» its name), «إيداع» a title; the accounts\' maker popup filled', () => {
  const s = F.create('makerMove', { direction: 'withdraw', type: 'عربون' });
  assert.equal(F.current(s).key, 'vendor'); F.answer(s, 'vendor', 'Art Craft');
  assert.equal(F.current(s).key, 'amount'); F.answer(s, 'amount', '300'); F.skip(s, 'note');
  assert.deepEqual(F.openSpec(s), { form: 'vendor_move', values: { direction: 'withdraw', vendor: 'Art Craft', type: 'عربون', otherName: '', amount: '300', note: '' } });
  F.back(s, 'type'); F.answer(s, 'type', 'أخرى'); assert.equal(F.current(s).key, 'otherName'); // «أخرى»: its name, like the popup's «اكتب النوع»
  F.answer(s, 'otherName', 'شحن عينة'); assert.equal(F.openSpec(s).values.otherName, 'شحن عينة');
  const dp = F.create('makerMove', { direction: 'deposit' }); F.answer(dp, 'vendor', 'Glody'); assert.equal(F.current(dp).key, 'title'); // no kind on a deposit
  F.answer(dp, 'title', 'فرق سعر'); F.answer(dp, 'amount', '50'); F.answer(dp, 'note', 'مقاس مخصص');
  assert.deepEqual(F.openSpec(dp), { form: 'vendor_move', values: { direction: 'deposit', vendor: 'Glody', type: '', otherName: 'فرق سعر', amount: '50', note: 'مقاس مخصص' } });
  F.back(dp, 'direction'); F.answer(dp, 'direction', 'withdraw'); assert.ok(!('title' in dp.values)); assert.equal(F.current(dp).key, 'type'); // the deposit's title goes with it
});

test('one product\'s edit: the edits its product allows and the member may, then that product\'s own popup; another product asks again', () => {
  const opts = (product, L) => F.FLOWS.productEdit.steps[1].options({ product }, L || {}).map(([v]) => v);
  assert.deepEqual(opts({ priced: true, live: true }), ['price', 'draft', 'brand', 'maker', 'page']);
  assert.deepEqual(opts({ priced: false, live: false }), ['publish', 'brand', 'maker', 'page']); // a Variable or no price: its page (the variations' prices)
  assert.deepEqual(opts({ priced: true, live: true }, { productMay: (w) => w !== 'maker' }), ['price', 'draft', 'brand', 'page']); // another store needs products.bulk
  const s = F.create('productEdit', { q: 'Cushion', want: { what: 'price' } }); assert.equal(s.q, 'Cushion'); assert.deepEqual(s.want, { what: 'price' });
  const cushion = { id: 9001, name: 'Cushion', sku: 'X', priced: true, live: true };
  F.answer(s, 'product', cushion); assert.equal(F.current(s).key, 'what');
  F.answer(s, 'what', 'brand'); assert.deepEqual(F.openSpec(s), { productEdit: { product: cushion, what: 'brand' } });
  assert.equal(F.shown(s, F.FLOWS.productEdit.steps[1], {}), 'البراند');
  F.back(s, 'product'); F.answer(s, 'product', { id: 9002, name: 'Curtain', sku: 'Y' }); assert.equal(F.current(s).key, 'what'); // its edits asked again
});

// part 2b (agent-chat-flows decision 5, Safwat 28 Nov — «كمل الباقي»): a maker's data, part by part — his file's own «تعديل» popup
test('a maker\'s data: the part said is picked, the rest of the words his name; not a read, not his money, not an order or a product', () => {
  assert.deepEqual(d('عدل بيانات المبتكر'), { id: 'makerEdit', pre: { want: {} } });
  assert.deepEqual(d('غير تليفون المبتكر Art Craft'), { id: 'makerEdit', pre: { want: { what: 'contact', vendor: 'Art Craft' } } });
  assert.deepEqual(d('عدل الحساب البنكي للمبتكر'), { id: 'makerEdit', pre: { want: { what: 'bank' } } }); // «حساب» here is his bank, not an account read
  assert.deepEqual(d('غير نسبة المبتكر Glody'), { id: 'makerEdit', pre: { want: { what: 'terms', vendor: 'Glody' } } });
  assert.deepEqual(d('عدل اسم المبتكر'), { id: 'makerEdit', pre: { want: { what: 'identity' } } });
  for (const t of ['رصيد المبتكر كام', 'عدل رصيد المبتكر', 'غير تليفون المبتكر 01001234567', 'انقل المنتج Cushion لمبتكر تاني', 'عدل الاوردر 1234 للمبتكر', 'بيانات المبتكر احمد ايه'])
    assert.notEqual((d(t) || {}).id, 'makerEdit', t);
});

test('a maker\'s data: the parts the member may, the maker said picked once the makers are there, then the file\'s popup', () => {
  const parts = (L) => F.FLOWS.makerEdit.steps[1].options({}, L || {}).map(([v]) => v);
  assert.deepEqual(parts(), ['identity', 'contact', 'terms', 'bank']);
  assert.deepEqual(parts({ makerMay: (w) => w !== 'bank' }), ['identity', 'contact', 'terms']); // no sensitive.vendor_bank: no bank
  const s = F.create('makerEdit', { want: { what: 'contact', vendor: 'art craft' } }); assert.equal(F.current(s).key, 'vendor');
  assert.equal(s.want.vendor, 'art craft'); // kept for the maker step: picked when the makers land (card)
  F.answer(s, 'vendor', 'Art Craft'); F.answer(s, 'what', 'contact');
  assert.deepEqual(F.openSpec(s), { form: 'vendor_edit', values: { vendor: 'Art Craft', what: 'contact' } });
});
