// IBChatAsk — how every assistant asks the member (the owner 18 Nov: «كل المساعدين يتعاملوا بنفس الطريقة … لو محتاجين بيانات معينة
// يديني بوباب املاه و لو عايزني اختار حاجة يجيبها جوه الشات»). Not a block.
//   card(ask, { onSend(text), used, key }) → the element under an answer: ask.options as buttons inside the chat (the pressed one is sent
//     as the member's next message), ask.fields as a link «املا البيانات» that opens a popup of those fields (the answers go as the next
//     message, one «label: value» line each). Nothing runs from it — it only writes the member's message for them.
//   popup(ask, onSend) → opens the fields popup by itself.
// ask = { question, options: [string], fields: [{ label, kind: text | long | number | date }] } as the server cleaned it (cleanAsk).
(function () {
  'use strict';
  const U = () => window.IBUI; const K = () => window.IBKit;
  const h = (...a) => U().h(...a);
  const used = new Set(); // the asks already answered in this session (a button pressed once)

  function popup(ask, onSend) {
    const fields = (ask && Array.isArray(ask.fields) ? ask.fields : []).slice(0, 8); if (!fields.length) return null;
    const vals = fields.map(() => ''); let err = ''; let m = null;
    const draw = () => m.setBody(...[
      ask.question ? h('p', { class: 'help' }, ask.question) : null,
      fields.map((f, i) => {
        const id = 'ib-ask-' + i; const on = (v) => { vals[i] = v == null ? '' : String(v); };
        if (f.kind === 'long') return U().Textarea({ id, label: f.label, value: vals[i], onInput: on });
        if (f.kind === 'date') return U().DateField({ id, label: f.label, value: vals[i] || null, onChange: (iso) => { vals[i] = iso || ''; } });
        return U().TextInput({ id, label: f.label, value: vals[i], inputmode: f.kind === 'number' ? 'decimal' : undefined, onInput: on });
      }),
      err ? U().InlineNote({ kind: 'error', children: err }) : U().InlineNote({ children: 'اللي هتكتبه هيتبعت للمساعد رسالة منك — مفيش حاجة بتتسجّل في السيستم من هنا.' })].flat().filter(Boolean)); // setBody takes nodes, not arrays or nulls
    m = U().Modal({ title: ask.question ? 'املا البيانات' : 'البيانات المطلوبة', body: [], footer: [
      U().Button({ type: 'primary', icon: 'send', label: 'ابعت للمساعد', attrs: { 'data-ib-ask-send': '' }, onClick: () => {
        const lines = fields.map((f, i) => [f.label, String(vals[i] || '').trim()]).filter(([, v]) => v);
        if (!lines.length) { err = 'اكتب خانة واحدة على الأقل'; draw(); return; }
        m.close(); onSend(lines.map(([l, v]) => l + ': ' + v).join('\n'));
      } }),
      U().Button({ label: 'إلغاء', onClick: () => m.close() })] });
    m.el.setAttribute('data-ib-ask-popup', '');
    draw();
    return m;
  }

  function card(ask, o) {
    const opt = o || {}; if (!ask) return null;
    const key = opt.key || ''; const done = !!opt.used || (key && used.has(key));
    const send = (text) => { if (key) used.add(key); opt.onSend(text); };
    const options = Array.isArray(ask.options) ? ask.options : []; const fields = Array.isArray(ask.fields) ? ask.fields : [];
    return h('div', { class: 'ib-ask', 'data-ib-ask': key || '' },
      ask.question ? h('small', { class: 'help' }, ask.question) : null,
      options.length ? h('div', { class: 'ib-ask-opts' }, options.map((x) => h('button', { type: 'button', class: 'chip ib-ask-opt', disabled: done, 'data-ib-ask-opt': x, onClick: () => send(x) }, x))) : null,
      fields.length ? U().Button({ size: 'sm', type: 'primary', icon: 'edit', label: 'املا البيانات (' + K().n0(fields.length) + ')', disabled: done, attrs: { 'data-ib-ask-form': '' }, onClick: () => popup(ask, send) }) : null);
  }

  window.IBChatAsk = { card, popup };
})();
