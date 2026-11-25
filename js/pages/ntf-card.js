/* An alert's card in the bell, drawn from its rule's template (Safwat 25 Nov — «خليه قوالب التنبيهات ذكية بنفس الشكل اللي ظاهر
   عشان المستخدم لو عايز يعدل يقدر يعدل»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 17). Not a block.
     IBNtfCard.el(cust) → the lines under the alert's title: cust = { lines: IBNotifCatalog.cardLines(…), phone, dial, wa, dl }
       a «phone» part = the number with «نسخ» and WhatsApp (a masked one — no rights to the phone — as it is, no buttons);
       «follow» = the red (late) / yellow (about to be) chip; «chip» = a neutral chip; «text» = small text.
     IBNtfCard.preview(rule, stateLabel) → the rule's card on a sample alert of its element, for its form (the settings) — every
       template works the same way (Safwat 25 Nov — «قوالب الرسايل كلها تشتغل بنفس الطريقة») */
(function () {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit;
  const stop = (e) => e.stopPropagation();
  function copy(e, p) {
    e.stopPropagation();
    try { navigator.clipboard.writeText(p).then(() => K().toast('اتنسخ الرقم', 'success'), () => K().toast('ماقدرتش أنسخ', 'error')); } catch (x) { K().toast('ماقدرتش أنسخ', 'error'); }
  }
  function part(p, c) {
    const { h, Icon } = U();
    if (p.kind === 'phone') return h('span', { class: 'ntf-ph' }, h('bdi', { dir: 'ltr', 'data-ntf-phone': '' }, p.text),
      c.dial ? h('button', { type: 'button', class: 'icon-btn sm', title: 'نسخ الرقم', 'aria-label': 'نسخ الرقم', 'data-ntf-copy': '', onClick: (e) => copy(e, c.phone) }, Icon('copy', 'sm')) : null,
      c.wa ? h('a', { class: 'icon-btn sm ntf-wa', href: c.wa, target: '_blank', rel: 'noopener', title: 'واتساب', 'aria-label': 'واتساب', 'data-ntf-wa': '', onClick: stop }, Icon('whatsapp', 'sm')) : null);
    if (p.kind === 'follow') return h('span', { class: 'ntf-chip ' + (c.dl === 'late' ? 'error' : 'warning'), 'data-ntf-follow': c.dl }, p.text);
    if (p.kind === 'chip') return h('span', { class: 'ntf-chip neutral', 'data-ntf-chip': '' }, p.text);
    return h('small', { class: 'ntf-late', 'data-ntf-text': '' }, p.text);
  }
  function el(c) {
    const { h } = U();
    return h('span', { class: 'ntf-cust', 'data-ntf-cust': '' }, (c.lines || []).map((L) => {
      const textOnly = L.every((p) => p.kind === 'text');
      return textOnly ? h('small', { class: 'ntf-late', 'data-ntf-line': '' }, L.map((p) => p.text).join(' · '))
        : h('span', { class: L.some((p) => p.kind === 'phone') ? 'ntf-line ph' : 'ntf-chips', 'data-ntf-line': '' }, L.map((p) => part(p, c)));
    }));
  }
  // the rule's card on a sample alert of its element (an order's facts for an order rule), for its form in the settings
  function preview(rule, stateLabel) {
    const C = window.IBNotifCatalog; const { h } = U(); if (!C || !C.cardLines) return null;
    const order = C.isOrderRule(rule); const phone = order ? '01012345678' : '';
    const c = { lines: C.cardLines(C.templateOf(rule), C.sampleVars(rule, stateLabel)), phone, dial: order, wa: order ? 'https://wa.me/201012345678' : null, dl: 'late' };
    return h('div', { class: 'nr-card-prev', 'data-nr-card-prev': '' }, h('span', { class: 't-small sub' }, 'شكله في الجرس (تنبيه مثال):'),
      h('div', { class: 'ntf-item cust prev' }, h('span', { class: 'av letter customer', 'aria-hidden': 'true' }, order ? 'م' : '؟'),
        h('span', { class: 'txt' }, h('b', null, h('span', { class: 'tt' }, String((rule && rule.name) || 'اسم التنبيه') + ' — IB-1001')), el(c))));
  }
  window.IBNtfCard = { el, preview };
})();
