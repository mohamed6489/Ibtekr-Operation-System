/* «املا البيانات دي من اللينك ده» — an add / edit / delete asked of any assistant without saying what (Safwat 28 Nov;
   docs/superpowers/plans/2026-11-28-ask-popups.md, phase B). Not a block. The popup picks the kind of request (إضافة · تعديل · حذف) and
   the element (منتج · مبتكر · رقم مالي · قسم · موظف · أوردر رئيسي · أوردر فرعي · تصميم); the host then runs what that pick is in the
   system: the chat's steps (IBChatFlow) and the system's own popup filled at their end, the system's popup itself, or — where the
   system has no steps for it yet — its page behind a link popup. Nothing is written from here.
     IBRequestAsk.detect(text)      → an add / edit / delete asked without the element a flow knows
     IBRequestAsk.preOf(text)       → { verb, element } said in the words
     IBRequestAsk.route(pick)       → pure: { flow, pre } | { form, values } | { studio: true } | { page: { hash, label } }
     IBRequestAsk.summary(pick)     → the member's message line
     IBRequestAsk.complete(pre)     → the kind and the element both said — runs with no popup
     IBRequestAsk.open({ pre, onPick }) → the popup (browser only) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IBRequestAsk = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const w = root || {};
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[؟?!.,،:;()«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const pad = (t) => ' ' + t + ' ';

  const VERBS = [['add', 'إضافة'], ['edit', 'تعديل'], ['delete', 'حذف']];
  const ELEMENTS = [['product', 'منتج'], ['maker', 'مبتكر'], ['money', 'رقم مالي'], ['category', 'قسم'], ['member', 'موظف'], ['order', 'أوردر رئيسي'], ['sub', 'أوردر فرعي'], ['design', 'تصميم']];
  // «رقم مالي» to add: which of the accounts' moves (his answer — the accounts' own popups)
  const MONEY = [['expense', 'مصروف', 'سحب أو إيداع على حسابات الشركة'], ['makerMove', 'حركة على حساب مبتكر', 'عربون / مواصلات / تصحيح رصيد']];
  const label = (list, v) => (list.find((x) => x[0] === v) || [])[1] || v;

  const page = (hash, lbl, text) => ({ page: { hash, label: lbl, text } });
  /** What a pick is in the system — the chat's steps first, the system's own popup, else its page by a link. */
  function route(p) {
    const k = (p && p.verb) + '.' + (p && p.element);
    switch (k) {
      case 'add.product': return { studio: true };
      case 'edit.product': return { flow: 'productEdit' };
      case 'delete.product': return { flow: 'trash' };
      case 'add.maker': return { flow: 'maker' };
      case 'edit.maker': return { flow: 'makerEdit' };
      case 'add.money': return { flow: p.sub === 'makerMove' ? 'makerMove' : 'expense' };
      case 'edit.order': return { flow: 'order' };
      case 'add.design': return { flow: 'post' };
      case 'add.member': return { form: 'member_add', values: {} };
      case 'delete.maker': return page('makers', 'المبتكرين', '«حذف المبتكر» من قايمة «⋮» في ملفه — بسبب، والأدمن بس.');
      case 'edit.money': case 'delete.money': return page('moves-log', 'سجل الحركات', 'الحركة بتتعدّل أو بتتلغي من «⋮» على صفها في «سجل الحركات».');
      case 'add.category': case 'edit.category': case 'delete.category': return page('products-cats', 'أقسام المنتجات', 'الأقسام بتتضاف وتتعدّل وتتمسح من تاب «الأقسام» في المنتجات — والمسح للقسم اللي مفيهوش منتجات.');
      case 'edit.member': case 'delete.member': return page('hr-team', 'الفريق', 'بيانات العضو وإيقافه أو مسحه من «⋮» على صفه في «الموارد البشرية › الفريق والحضور».');
      case 'add.order': return page('cs-inbox', 'خدمة العملاء', '«أوردر جديد» بيتعمل من محادثة العميل في «خدمة العملاء» — بيتعمل على الموقع مستني الدفع.');
      case 'delete.order': return page('orders', 'الأوردرات', '«مسح» الأوردر من قايمة «⋮» على الأوردر — بسبب، وبيتلغي الأول لو مش ملغي.');
      case 'add.sub': case 'edit.sub': case 'delete.sub': return page('orders', 'الأوردرات', 'إضافة منتج جوه أوردر فرعي وتعديله ومسحه من «تعديل» الأوردر › «الأوردرات الفرعية».');
      case 'edit.design': case 'delete.design': return page('marketing-create', 'التسويق', 'الكامبين بتتعدّل أو بتتمسح من «آخر الشغل» في «التسويق › إنشاء».');
      default: return null;
    }
  }
  const summary = (p) => 'طلب: ' + label(VERBS, p.verb) + ' ' + label(ELEMENTS, p.element) + (p.verb === 'add' && p.element === 'money' && p.sub ? ' — ' + label(MONEY, p.sub) : '');

  const VERB_RE = [['add', /\s(ضيف|ضيفلي|اضيف|اضف|اضافه|سجل|اسجل|add)\s/], ['edit', /\s(عدل|اعدل|عدللي|تعديل|غير|اغير|edit|change)\s/], ['delete', /\s(امسح|مسح|احذف|حذف|اشيل|شيل|delete|remove)\s/]];
  const EL_RE = [['sub', /اوردر(ات)? فرعي|فرعيه/], ['order', /اوردر|order/], ['product', /منتج|product/], ['maker', /مبتكر|maker|vendor/], ['money', /مصروف|فلوس|رقم مالي|حركه ماليه|money/],
    ['category', /قسم|اقسام|category/], ['member', /موظف|عضو|member|employee/], ['design', /تصميم|بوست|كامبين|design|post|campaign/]];
  const READ = /\s(اعرف|اشوف|شوف|اعرض|وريني|كام|كم|ايه|مين|فين|ليه|تقرير|تقارير)\s/;
  function preOf(text) {
    const t = norm(text); const p = pad(t);
    return { verb: (VERB_RE.find(([, re]) => re.test(p)) || [])[0] || '', element: (EL_RE.find(([, re]) => re.test(t)) || [])[0] || '' };
  }
  /** An add / edit / delete said in a few words («عايز أضيف حاجة», «عايز أعدّل», «امسح») — the steps a flow knows were tried first. */
  function detect(text) {
    const t = norm(text); if (!t || t.split(' ').length > 8 || READ.test(pad(t))) return false;
    return !!preOf(text).verb;
  }

  // ---- the browser
  const U = () => w.IBUI;
  function open(o) {
    const u = U(); if (!u || !u.Modal) return null; const { h, Button } = u; const opt = o || {};
    const f = { verb: (opt.pre && opt.pre.verb) || '', element: (opt.pre && opt.pre.element) || '', sub: '' }; let err = ''; let m = null; const box = h('div', { 'data-rqq-form': '' });
    const chips = (key, list, val, on) => h('div', { class: 'sc-opts', role: 'radiogroup', 'data-rqq-group': key }, list.map(([v, l, d]) =>
      h('button', { type: 'button', class: 'sc-opt' + (val === v ? ' on' : ''), role: 'radio', 'aria-checked': String(val === v), 'data-rqq-opt': key + ':' + v, onClick: () => on(v) }, h('b', null, l), d ? h('small', null, d) : null)));
    const draw = () => {
      box.replaceChildren(...[h('p', { class: 't-small help', style: 'margin:0 0 10px' }, 'اختار نوع الطلب والعنصر، والمساعد هيسألك الباقي خطوة خطوة — وفي الآخر بوب أب السيستم نفسه متملّي والتأكيد منك.'),
        h('p', { class: 'sc-q' }, 'نوع الطلب'), chips('verb', VERBS, f.verb, (v) => { f.verb = v; f.sub = ''; err = ''; draw(); }),
        h('p', { class: 'sc-q' }, 'العنصر'), chips('element', ELEMENTS, f.element, (v) => { f.element = v; f.sub = ''; err = ''; draw(); }),
        f.verb === 'add' && f.element === 'money' ? h('p', { class: 'sc-q' }, 'نوع الحركة') : null,
        f.verb === 'add' && f.element === 'money' ? chips('sub', MONEY, f.sub, (v) => { f.sub = v; err = ''; draw(); }) : null,
        err ? u.InlineNote({ kind: 'error', children: err }) : null].filter(Boolean));
    };
    const go = () => {
      err = !f.verb ? 'اختار نوع الطلب' : !f.element ? 'اختار العنصر' : f.verb === 'add' && f.element === 'money' && !f.sub ? 'اختار نوع الحركة' : '';
      if (err) { draw(); return; }
      m.close(); if (typeof opt.onPick === 'function') opt.onPick({ verb: f.verb, element: f.element, sub: f.sub });
    };
    draw();
    m = u.Modal({ title: 'املا بيانات الطلب', body: [box], footer: [Button({ type: 'primary', icon: 'send', label: 'ابدأ', attrs: { 'data-rqq-go': '' }, onClick: go }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    if (m && m.el) m.el.setAttribute('data-rqq', '');
    return m;
  }
  /** Both said and nothing else to ask («ضيف منتجات», «امسح مبتكر») — runs with no popup; a money add asks its kind first. */
  const complete = (p) => !!(p && p.verb && p.element && !(p.verb === 'add' && p.element === 'money' && !p.sub));
  return Object.freeze({ VERBS, ELEMENTS, MONEY, detect, preOf, route, summary, complete, open });
});
