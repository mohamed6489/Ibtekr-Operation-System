/* «إزاي…» — ready answers with the system's own screens, in every assistant and the header one (Safwat 28 Nov — «امكانية سؤالهم علي
   خطوات و يبقا عندهم ردود جاهزة باسكرين شوتس من السيستم … كل طلب مع عنصر يكون ليه اجابة واضحة … و نضيف عليهم ازاي احاسب مبتكر و ازاي
   اعمل تصميم جديد»; docs/superpowers/plans/2026-11-28-faults-howto.md, phase B). Not a block. The steps are numbered and each has its
   screen from the demo copy (made-up data — tools/howto takes them: `node tools/howto/run.mjs`), every member sees them all.
     IBHowTo.detect(text)        → a guide's id («add.maker» …), 'menu' (a «how» with nothing the guides know), or ''
     IBHowTo.GUIDES / ids()      → the guides — a new one gets its steps here and its screens in tools/howto/recipes.mjs
     IBHowTo.card(id, o)         → the answer in the chat (browser only): the steps, a picture under each, a click opens it big
     IBHowTo.menu(onPick)        → the guides to pick from (browser only) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBHowTo = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[؟?!.,،:;()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const pad = (t) => ' ' + t + ' ';
  const IMG = (id, n) => 'img/howto/' + id + '-' + n + '.webp';
  const S = (text, img) => ({ text, img: img || null });

  // the elements the request popup knows (IBRequestAsk.ELEMENTS) × add / edit / delete, + «أحاسب مبتكر»; «تصميم جديد» = the campaign
  const GUIDES = {
    'add.product': { title: 'إزاي أضيف منتجات', steps: [
      S('من القايمة الجانبية افتح «المنتجات» واضغط «+ دفعة منتجات جديدة».', IMG('add.product', 1)),
      S('اختار حالة البيانات اللي معاك (شيت جاهز من المبتكر · داتا على الواتساب · صور وعايز شيت) ونوع المنتجات (Simple أو Variable)، واضغط «ابدأ».', IMG('add.product', 2)),
      S('كمّل الخطوات: البيانات · الأسعار · الصور — والـ AI بيملا الناقص وانت بتراجع.'),
      S('في الآخر «ارفع على الموقع» — المنتجات بتتعمل على الموقع مسودة لحد ما تنشرها.')] },
    'edit.product': { title: 'إزاي أعدّل منتج', steps: [
      S('افتح «المنتجات» › تاب «سجل المنتجات»، ودوّر على المنتج واضغط «⋮» على صفه.', IMG('edit.product', 1)),
      S('اختار «تعديل».', IMG('edit.product', 2)),
      S('صفحة المنتج بتفتح بتاباتها (البيانات · الأسعار · الصور · الأوصاف …) — عدّل اللي محتاجه واضغط «احفظ على الموقع».', IMG('edit.product', 3))] },
    'delete.product': { title: 'إزاي أمسح منتج', steps: [
      S('افتح «المنتجات» › «سجل المنتجات» واضغط «⋮» على المنتج.', IMG('delete.product', 1)),
      S('اختار «مسح».', IMG('delete.product', 2)),
      S('أكّد — المنتج بيروح مهملات الموقع (مش مسح نهائي) وتقدر ترجّعه.', IMG('delete.product', 3))] },
    'add.maker': { title: 'إزاي أضيف مبتكر', steps: [
      S('افتح «المبتكرين» واضغط «+ إضافة مبتكر».', IMG('add.maker', 1)),
      S('املا المراحل الأربعة (بيانات المبتكر · بيانات الدخول · بيانات المتجر والعمولة · الحساب البنكي والعقد) بـ «التالي»، وفي الآخر «إضافة المبتكر».', IMG('add.maker', 2)),
      S('متجره على الموقع وبراند باسمه بيتعملوا معاه — ولو حاجة فشلت، ملفه فيه «جرّب عمل المتجر تاني».')] },
    'edit.maker': { title: 'إزاي أعدّل بيانات مبتكر', steps: [
      S('افتح «المبتكرين» › «سجل المبتكرين» واضغط على اسم المبتكر.', IMG('edit.maker', 1)),
      S('ملفه بيفتح — اضغط «تعديل» جنب القسم اللي عايزه (الهوية · التواصل · الاتفاق التجاري · الحساب البنكي)، واحفظ.', IMG('edit.maker', 2)),
      S('الحاجات اللي ليها نسخة على الموقع (الاسم والتليفون والعمولة والبنك …) بتتبعت لمتجره على Dokan لوحدها.')] },
    'delete.maker': { title: 'إزاي أمسح مبتكر', steps: [
      S('افتح ملف المبتكر من «سجل المبتكرين» واضغط «⋮» فوق.', IMG('delete.maker', 1)),
      S('اختار «حذف المبتكر» واكتب السبب — للأدمن بس.', IMG('delete.maker', 2)),
      S('متجره بيتمسح من الموقع ومنتجاته بتتنقل ومابتتمسحش؛ ولو ليه أوردرات أو حسابات بيتأرشف هنا بدل ما يتمسح.')] },
    'add.money': { title: 'إزاي أسجّل رقم مالي', steps: [
      S('مصروف أو إيداع على حسابات الشركة: افتح «الحسابات» › «المصروفات» واضغط «+ إضافة مصروفات».', IMG('add.money', 1)),
      S('اختار «سحب» أو «إيداع».', IMG('add.money', 2)),
      S('املا الحساب والمبلغ والتاريخ والنوع والمستفيد، واضغط «حفظ» — حركة الحساب بتتسجل معاه.', IMG('add.money', 3)),
      S('حركة على حساب مبتكر (عربون · مواصلات · تصحيح رصيد): «المبتكرين» › «حسابات المبتكرين» › «+ إضافة مبلغ».', IMG('add.makerMove', 1)),
      S('اختار «سحب» (بيتخصم من صافيه) أو «إيداع خارجي»، واملا البوب أب.', IMG('add.makerMove', 2))] },
    'edit.money': { title: 'إزاي أعدّل رقم مالي', steps: [
      S('افتح «الحسابات» › «المصروفات»، وفي «سجل المصروفات التفصيلي» اضغط «⋮» على الحركة.', IMG('edit.money', 1)),
      S('اختار «تعديل».', IMG('edit.money', 2)),
      S('نفس البوب أب بيفتح متملّي — عدّل واحفظ. صرف منصات الإعلانات اليومي بيتقري لوحده ومابيتعدّلش.', IMG('edit.money', 3))] },
    'delete.money': { title: 'إزاي أمسح رقم مالي', steps: [
      S('من «⋮» على الحركة في «الحسابات» اختار «حذف».', IMG('delete.money', 1)),
      S('الحركة بتتلغي نهائي (بتفضل في السجل ملغية ومش محسوبة) — والحركة المتصفّية في تسوية مبتكر مابتتلغيش.')] },
    'add.category': { title: 'إزاي أضيف قسم', steps: [
      S('افتح «المنتجات» › تاب «الأقسام» واضغط «قسم رئيسي جديد» — أو «⋮» على قسم › «إضافة قسم فرعي».', IMG('add.category', 1)),
      S('اكتب الاسم بالإنجليزي والعربي وارفع صورة مربعة لو عايز، واضغط «اعمل القسم» — بيتعمل على الموقع بترجمته.', IMG('add.category', 2))] },
    'edit.category': { title: 'إزاي أعدّل قسم', steps: [
      S('في «المنتجات» › «الأقسام» اضغط «⋮» على القسم.', IMG('edit.category', 1)),
      S('اختار «تعديل» — الاسمين والـ Slug والصورة؛ والترتيب بالسحب من الست نقط.', IMG('edit.category', 2))] },
    'delete.category': { title: 'إزاي أمسح قسم', steps: [
      S('في «الأقسام» اضغط «⋮» على القسم واختار «حذف».', IMG('delete.category', 1)),
      S('القسم اللي فيه منتجات أو أقسام فرعية أو فئة أساسية لمبتكر مابيتمسحش — انقلهم الأول.')] },
    'add.member': { title: 'إزاي أضيف موظف', steps: [
      S('افتح «الموارد البشرية» › «الفريق والحضور» واضغط «+ إضافة عضو».', IMG('add.member', 1)),
      S('املا بياناته والوظيفة والدور والمرتب، واضغط «إضافة وعمل الحساب» — بيوصله إيميل يعمل منه الباسورد.', IMG('add.member', 2))] },
    'edit.member': { title: 'إزاي أعدّل بيانات موظف', steps: [
      S('في «الموارد البشرية» › «الفريق والحضور» اضغط «⋮» على صف الموظف.', IMG('edit.member', 1)),
      S('اختار «فتح الملف».', IMG('edit.member', 2)),
      S('في كارت «بيانات العضو والصلاحيات»: «تعديل البيانات» أو «الدور والصلاحيات» — للأدمن أو المدير المباشر.', IMG('edit.member', 3))] },
    'delete.member': { title: 'إزاي أمسح موظف', steps: [
      S('من «⋮» على صف الموظف اختار «حذف العضو نهائي».', IMG('delete.member', 1)),
      S('لو ليه سجلات (حضور · أوردرات · حسابات …) مش هيتمسح — اوقفه من «الإعدادات › الفريق» بدل ما تمسحه.')] },
    'add.order': { title: 'إزاي أعمل أوردر جديد', steps: [
      S('الأوردر بيتعمل من محادثة العميل: افتح «خدمة العملاء» › «الرسايل» واختار المحادثة، وفي ملف العميل «إجراءات سريعة» › «إنشاء أوردر».', IMG('add.order', 1)),
      S('اختار المنتجات والكمية واضغط «اعمل الأوردر» — بيتعمل على الموقع مستني الدفع، وتقدر تبعت «لينك دفع».', IMG('add.order', 2))] },
    'edit.order': { title: 'إزاي أعدّل أوردر', steps: [
      S('في «الأوردرات» اضغط «⋮» على الأوردر.', IMG('edit.order', 1)),
      S('اختار «تعديل».', IMG('edit.order', 2)),
      S('البوب أب فيه «بيانات الأوردر» (العميل والتفاصيل والعنوان) و«الأوردرات الفرعية» — عدّل واحفظ. الحالة والتأكيد كمان من الكارت نفسه.', IMG('edit.order', 3))] },
    'delete.order': { title: 'إزاي أمسح أوردر', steps: [
      S('في «الأوردرات» اضغط «⋮» على الأوردر واختار «مسح».', IMG('delete.order', 1)),
      S('اكتب السبب — الأوردر بيتلغي الأول لو مش ملغي، وبيروح مهملات الموقع. المكتمل والمسترجع مابيتمسحوش.')] },
    'add.sub': { title: 'إزاي أضيف منتج لأوردر فرعي', steps: [
      S('«⋮» على الأوردر › «تعديل» › تاب «الأوردرات الفرعية»، واضغط «+ إضافة منتج» تحت الأوردر الفرعي.', IMG('add.sub', 1)),
      S('اختار المنتج (من منتجات نفس المبتكر) والكمية والسعر — بيتضاف للأوردر الفرعي على الموقع.')] },
    'edit.sub': { title: 'إزاي أعدّل أوردر فرعي', steps: [
      S('«⋮» على الأوردر › «تعديل» › «الأوردرات الفرعية»: «تعديل الحالة على الموقع» للأوردر الفرعي، و«حالة المنتج» لكل منتج.', IMG('edit.sub', 1)),
      S('والكمية والتفاصيل من «⋮» على المنتج في كارت الأوردر › «تعديل».')] },
    'delete.sub': { title: 'إزاي أمسح من أوردر فرعي', steps: [
      S('«⋮» على الأوردر › «تعديل» › «الأوردرات الفرعية» › «مسح المنتج».', IMG('delete.sub', 1)),
      S('آخر منتج في الأوردر الفرعي = «مسح الأوردر الفرعي» (مهملات الموقع). الأوردر الأصلي على الموقع بيفضل بإجماليه لو فيه أكتر من مبتكر.')] },
    'add.design': { title: 'إزاي أعمل تصميم جديد', steps: [
      S('التصميم = كامبين: افتح «التسويق» › تاب «إنشاء» واضغط «ابدأ كامبين».', IMG('add.design', 1)),
      S('أربع خطوات: التفاصيل (الفكرة والمنتجات والمنصات) · البناء (الصور والفيديو بالـ AI أو «ارفع صورة») · المراجعة · النشر والتحميل.', IMG('add.design', 2))] },
    'edit.design': { title: 'إزاي أعدّل تصميم', steps: [
      S('في «التسويق» › «إنشاء»، جدول «آخر الشغل»: اضغط «افتح» على الكامبين.', IMG('edit.design', 1)),
      S('بتفتح على خطوتها — عدّل القطع واحفظ، والمنشور ليه «سجل النشر».', IMG('edit.design', 2))] },
    'delete.design': { title: 'إزاي أمسح تصميم', steps: [
      S('في «آخر الشغل» اضغط «⋮» على الكامبين واختار «احذف الكامبين».', IMG('delete.design', 1))] },
    'settle.maker': { title: 'إزاي أحاسب مبتكر', steps: [
      S('افتح «المبتكرين» › «حسابات المبتكرين» واضغط «⋮» على المبتكر.', IMG('settle.maker', 1)),
      S('اختار «تسوية دلوقتي (تقفيل الحساب)».', IMG('settle.maker', 2)),
      S('التقرير بيقول رصيد Dokan والخصومات (العرابين والمواصلات) والصافي — «اعمل طلب سحب على Dokan» بالمبلغ.', IMG('settle.maker', 3)),
      S('الطلب بيستنى الموافقة في صندوق «طلب السحب» («موافقة» / «رفض الطلب»)، والتسوية بتتقفل لوحدها لما يتوافق عليه.')] },
  };
  const ids = () => Object.keys(GUIDES);

  const HOW = /\s(ازاي|ازاى|إزاي|كيف|ازي|طريقه|خطوات|اعمل ايه عشان|اعمل اي عشان|علمني|اشرحلي|اشرح لي|how)\s/;
  const VERB = [['add', /\s(اضيف|ضيف|اضف|اسجل|سجل|اعمل|انشئ|اضافه|add)\s/], ['edit', /\s(اعدل|عدل|تعديل|اغير|غير|edit|change)\s/], ['delete', /\s(امسح|مسح|احذف|حذف|اشيل|شيل|delete|remove)\s/]];
  const EL = [['sub', /اوردر(ات)? فرعي|فرعيه/], ['order', /اوردر|order/], ['product', /منتج|product/], ['maker', /مبتكر|maker|vendor/], ['money', /مصروف|فلوس|رقم مالي|حركه ماليه|عربون|مواصلات|money/],
    ['category', /قسم|اقسام|category/], ['member', /موظف|عضو|member|employee/], ['design', /تصميم|بوست|كامبين|design|post|campaign/]];
  /** «إزاي أضيف مبتكر» → 'add.maker'; «إزاي أحاسب مبتكر» → 'settle.maker'; «إزاي أعمل تصميم جديد» → 'add.design'; a «how» with
   *  nothing the guides know → 'menu'; anything else (no «how») → ''. */
  function detect(text) {
    const t = norm(text); const p = pad(t); if (!t || !HOW.test(p)) return '';
    if (/احاسب|حساب(ات)? (ال)?مبتكر|تسويه|اقفل حساب|تقفيل/.test(t) && /مبتكر|maker|vendor/.test(t)) return 'settle.maker';
    const el = (EL.find(([, re]) => re.test(t)) || [])[0]; const vb = (VERB.find(([, re]) => re.test(p)) || [])[0];
    if (el === 'design' && (!vb || vb === 'add')) return 'add.design';
    if (el && vb && GUIDES[vb + '.' + el]) return vb + '.' + el;
    if (el && !vb && GUIDES['add.' + el]) return 'add.' + el;
    return 'menu';
  }

  // ---- the browser
  const U = () => w.IBUI;
  function zoom(src, title) {
    const u = U(); if (!u || !u.Modal) return;
    u.Modal({ title, size: 'lg', body: [u.h('img', { src, alt: title, class: 'ht-big', 'data-ht-big': '' })] });
  }
  /** The answer: its title, the numbered steps, the screen under each (a click opens it big). */
  function card(id) {
    const u = U(); const g = GUIDES[id]; if (!u || !g) return null; const { h } = u;
    return h('div', { class: 'ht-card', 'data-howto': id },
      h('p', { class: 'ht-title' }, g.title),
      h('ol', { class: 'ht-steps' }, g.steps.map((s, i) => h('li', { 'data-ht-step': String(i + 1) },
        h('span', { class: 'ht-n' }, String(i + 1)),
        h('div', { class: 'ht-body' }, h('p', null, s.text),
          s.img ? h('button', { type: 'button', class: 'ht-shot', 'aria-label': 'كبّر صورة الخطوة ' + (i + 1), onClick: () => zoom(s.img, g.title + ' — ' + (i + 1)) },
            h('img', { src: s.img, alt: 'الخطوة ' + (i + 1) + ' — ' + g.title, loading: 'lazy' })) : null)))),
      h('p', { class: 't-small help ht-note' }, 'الصور من نسخة التجربة (داتا وهمية) — اللي قدامك هيبقى بياناتك، وبعض الأزرار بتظهر بصلاحيتها بس.'));
  }
  const GROUPS = [['المنتجات', ['add.product', 'edit.product', 'delete.product']], ['المبتكرين', ['add.maker', 'edit.maker', 'delete.maker', 'settle.maker']],
    ['الأرقام المالية', ['add.money', 'edit.money', 'delete.money']], ['الأقسام', ['add.category', 'edit.category', 'delete.category']],
    ['الموظفين', ['add.member', 'edit.member', 'delete.member']], ['الأوردرات', ['add.order', 'edit.order', 'delete.order']],
    ['الأوردرات الفرعية', ['add.sub', 'edit.sub', 'delete.sub']], ['التصميم', ['add.design', 'edit.design', 'delete.design']]];
  /** A «how» the guides don't name: every guide as a chip under its element. */
  function menu(onPick) {
    const u = U(); if (!u) return null; const { h } = u;
    return h('div', { class: 'ht-menu', 'data-howto-menu': '' }, GROUPS.map(([lbl, list]) => h('div', { class: 'ht-grp' }, h('b', null, lbl),
      h('div', { class: 'ht-chips' }, list.map((gid) => h('button', { type: 'button', class: 'chip', 'data-ht-pick': gid, onClick: () => onPick(gid) }, GUIDES[gid].title))))));
  }
  return Object.freeze({ GUIDES, GROUPS, ids, detect, card, menu });
});
