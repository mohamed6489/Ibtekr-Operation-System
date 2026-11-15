// IBAIAsk — the instructions popup before an AI write / rewrite (the owner 15 Nov: «لما أدوس على أي حاجة في السيستم فيها إعادة كتابة
// بالـ AI يفتحلي بوب أب للتعليمات قبل التنفيذ، وفيه زرار ابدأ التوليد أو إغلاق»). Not a block: one shared popup the pages call before
// they ask the AI to write. The member's instructions are optional free text (cleaned here — no <>, one space, ≤ 500 — and again on the
// server, where they go into the prompt as the member's own notes); when the action has more than one way (fill the missing fields /
// rewrite), the popup asks which first. «ابدأ التوليد» → { notes, mode }; «إغلاق», ✕ or Esc → null (nothing is asked of the AI).
(function () {
  'use strict';
  const MAX = 500;
  const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX);

  /**
   * opts: { title, intro?, modes?: [{ value, label, hint? }], mode?, modesLabel?, placeholder?, go?, notes? }
   * → Promise<{ notes: string, mode: string|null } | null>
   */
  function ask(opts) {
    const U = window.IBUI; const K = window.IBKit; const o = opts || {};
    if (!U || !U.Modal) return Promise.resolve({ notes: '', mode: o.mode || (o.modes && o.modes[0] ? o.modes[0].value : null) });
    const { h, Button } = U;
    return new Promise((resolve) => {
      let notes = o.notes || ''; let done = false;
      let mode = o.modes && o.modes.length ? (o.mode && o.modes.some((x) => x.value === o.mode) ? o.mode : o.modes[0].value) : null;
      const end = (v) => { if (done) return; done = true; resolve(v); };
      const m = U.Modal({ title: o.title || 'اكتب بالـ AI', body: [], footer: [], onClose: () => end(null) });
      m.el.setAttribute('data-ai-ask', '');
      const draw = () => {
        m.setBody(...[
          o.intro ? h('p', { class: 't-body help', style: 'margin:0' }, o.intro) : null,
          o.modes && o.modes.length > 1 && K && K.Radios ? K.Radios({ label: o.modesLabel || 'هتعمل إيه؟', name: 'ai-ask-mode', value: mode, options: o.modes, onChange: (v) => { mode = v; draw(); } }) : null,
          U.Textarea({ id: 'ai-ask-notes', label: 'تعليمات للـ AI (اختياري)', rows: 4, maxlength: MAX, value: notes, placeholder: o.placeholder || 'مثال: خلّي الأسلوب أبسط، وركّز على الخامة والاستخدام', onInput: (v) => { notes = v; } }),
          h('small', { class: 'help' }, 'لحد ' + MAX + ' حرف. من غير تعليمات الـ AI بيكتب بالقواعد العادية.'),
        ].filter(Boolean));
        m.setFooter(Button({ label: 'إغلاق', attrs: { 'data-ai-close': '' }, onClick: () => m.close() }),
          Button({ type: 'primary', icon: 'sparkle', label: o.go || 'ابدأ التوليد', attrs: { 'data-ai-go': '' }, onClick: () => { end({ notes: clean(notes), mode }); m.close(); } }));
      };
      draw();
      setTimeout(() => { const t = m.el.querySelector('#ai-ask-notes'); if (t && t.focus) t.focus(); });
    });
  }
  window.IBAIAsk = Object.assign(ask, { clean, MAX });
})();
