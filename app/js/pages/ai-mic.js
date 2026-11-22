/* The header's assistant takes dictation, as the other assistants do (the owner 22 Nov — «خليني اقدر اكلم المدير الايه اي اللي في
   الهيدر من المايك زي المساعدين التانيين»): a microphone beside the box to type in. A press starts listening — what is said is
   written into the box as it is heard (Egyptian Arabic, the browser's own speech-to-text through IBChatFiles.dictation, the
   same one the assistants' chat uses) — another press stops; the member reads it, changes it if he likes, and sends it
   himself. Nothing is sent by voice alone. The panel is drawn by the shell (block 28), which this file does not touch: the
   button is added to the panel's form once it is on the page. Listening stops when the message is sent or the panel closes. */
(function () {
  'use strict';
  var rec = null; var btn = null;
  var SAY = 'اتكلم'; var HINT = 'اتكلم والكلام يتكتب'; var STOP = 'وقّف التسجيل'; // the assistants' chat says the same (pages/marketing.js)
  function paint() {
    if (!btn) return; var on = !!rec;
    btn.classList.toggle('on', on); btn.setAttribute('data-ai-mic', on ? 'on' : 'off'); btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? STOP : HINT; btn.setAttribute('aria-label', on ? STOP : SAY);
  }
  function stop() { var r = rec; rec = null; if (r) r.stop(); paint(); }
  function toast(m) { var K = window.IBKit; if (K && K.toast) K.toast(m, 'error'); }
  function start(input) {
    var F = window.IBChatFiles;
    if (!F || !F.supportsVoice || !F.supportsVoice()) { toast('المتصفح ده مابيكتبش بالصوت — جرّب Chrome أو Edge أو Safari'); return; }
    var max = Number(input.getAttribute('maxlength')) || 200;
    var r = F.dictation({ onText: function (t) { if (rec !== r) return; input.value = String(t || '').slice(0, max); input.dispatchEvent(new Event('input', { bubbles: true })); },
      onError: function (m) { toast(m); }, onEnd: function () { if (rec === r) { rec = null; paint(); } } });
    if (!r) return; rec = r; r.start(String(input.value || '').trim()); paint();
  }
  function put() {
    var form = document.querySelector('.ai-panel .ai-form'); if (!form) return false;
    if (form.querySelector('[data-ai-mic]')) return true;
    var input = form.querySelector('.ai-input'); var send = form.querySelector('.ai-send'); if (!input || !send) return false;
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'icon-btn ai-mic';
    var U = window.IBUI; if (U && U.Icon) btn.appendChild(U.Icon('mic', 'sm'));
    btn.addEventListener('click', function () { if (rec) stop(); else start(input); });
    form.insertBefore(btn, send); paint();
    form.addEventListener('submit', stop, true); // the words go as they are; the box is not filled again after it is cleared
    var panel = form.closest('.ai-panel'); if (panel) new MutationObserver(function () { if (panel.hidden) stop(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    return true;
  }
  function watch() {
    if (put()) return;
    var mo = new MutationObserver(function () { if (put()) mo.disconnect(); });
    mo.observe(document.body, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
