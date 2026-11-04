// Phase 6 decision 26: the WhatsApp 1 sign-in (Embedded Signup, the WhatsApp Business app option — «coexistence»). Meta answers the
// plain dialog url with a 500 for Embedded Signup (seen live 4 Nov), so this page loads Meta's JavaScript SDK and calls FB.login
// with the configuration cs-whatsapp hands it (connect_start: the public app id + config id, the extras, a state «wa_…» kept ten
// minutes). The SDK's code — and the session info Meta posts to this window (the WABA and phone number ids, a hint only) — go to
// cs-whatsapp connect_callback { sdk: true }, which exchanges the code on the server and links the number. Nothing is stored or
// logged here; the admin only (the server checks).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const title = $('wc-title'), text = $('wc-text'), go = $('wc-go'), back = $('wc-back'), steps = $('wc-steps');
  const show = (t, msg, bad) => { title.textContent = t; text.textContent = msg; text.classList.toggle('err', !!bad); back.hidden = false; go.hidden = true; steps.hidden = true; };
  const cl = window.IBSupabase && window.IBSupabase.client;
  if (!cl) { show('السيستم مش متوصّل', 'الإعدادات ناقصة في config.js.', true); return; }
  const bodyOf = async (error) => { try { return error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { return null; } };
  const why = (b) => (b && b.error === 'no_account' ? 'Meta مارجّعتش حساب WhatsApp Business — اختار «Connect your existing WhatsApp Business app» وكمّل لحد ما الموبايل يأكد.'
    : b && b.error === 'no_number' ? 'الحساب اتربط بس من غير رقم — كمّل خطوة التأكيد من الموبايل وجرّب تاني.'
    : b && b.field === 'state' ? 'انتهت صلاحية الربط (10 دقايق) — افتح الصفحة تاني.'
    : b && b.error === 'unauthorized' ? 'الأدمن بس يقدر يربط القنوات.' : b && b.error === 'not_configured' ? 'ربط واتساب لسه مش متظبط على السيرفر (META_WA_CONFIG_ID ناقص).'
    : b && /^graph_/.test(String(b.error || '')) ? 'Meta رفضت الربط (' + b.error + ') — جرّب تاني.' : 'الربط ماكملش — جرّب تاني.');
  let start = null; const info = { waba: null, phone: null, cancel: null, error: null };
  // the session info: Meta's popup posts { type: 'WA_EMBEDDED_SIGNUP', event, data } to this window (facebook.com origins only)
  window.addEventListener('message', (e) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(String(e.origin || ''))) return;
    let d = null; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
    if (!d || d.type !== 'WA_EMBEDDED_SIGNUP') return;
    const x = d.data || {};
    if (/^FINISH/.test(String(d.event || ''))) { if (/^\d{5,30}$/.test(String(x.waba_id || ''))) info.waba = String(x.waba_id); if (/^\d{5,30}$/.test(String(x.phone_number_id || ''))) info.phone = String(x.phone_number_id); }
    else if (d.event === 'CANCEL') info.cancel = String(x.current_step || 'cancel').slice(0, 60);
    else if (d.event === 'ERROR') info.error = String(x.error_message || 'error').slice(0, 200);
  });
  const finish = async (code) => {
    title.textContent = 'بنربط واتساب…'; text.textContent = 'لحظة واحدة.'; go.hidden = true; steps.hidden = true;
    await new Promise((r) => setTimeout(r, 1200)); // the session info usually lands right after the code
    try {
      const { data: out, error } = await cl.functions.invoke('cs-whatsapp', { body: { action: 'connect_callback', code, state: start.state, sdk: true, waba_id: info.waba || undefined, phone_id: info.phone || undefined } });
      if (error || !out || !out.linked) { show('الربط ماكملش', why(await bodyOf(error)), true); return; }
      show('اتربط واتساب ' + (out.number && out.number.display ? out.number.display : '') + ' ✓', 'الرسايل الجديدة وردودك من الموبايل بقت توصل صندوق الرسايل. ' + (out.sync && out.sync.history === 'requested' ? 'المحادثات القديمة (آخر 6 شهور) بتتسحب دلوقتي، وممكن تاخد شوية وقت.' : 'سحب المحادثات القديمة ماتطلبش — اطلبه من تاب «القنوات» في خلال 24 ساعة.'), false);
    } catch (e) { show('الربط ماكملش', 'في مشكلة في الاتصال — جرّب تاني.', true); }
  };
  go.addEventListener('click', () => {
    if (!start || !window.FB) return;
    if (Date.now() - start.at > 9 * 60000) { location.reload(); return; } // the state lives ten minutes
    go.disabled = true;
    window.FB.login(function (res) { // a plain function: the SDK refuses an async one
      const code = res && res.authResponse && res.authResponse.code;
      if (code) { finish(String(code)); return; }
      go.disabled = false;
      text.textContent = info.error ? 'Meta: ' + info.error : info.cancel ? 'الربط اتلغى قبل ما يكمل (' + info.cancel + ') — دوس «ابدأ الربط» تاني.' : 'النافذة اتقفلت من غير ربط — دوس «ابدأ الربط» تاني.';
      text.classList.add('err');
    }, { config_id: start.sdk.config_id, response_type: 'code', override_default_response_type: true, extras: start.sdk.extras });
  });
  cl.auth.getSession().then(async ({ data }) => {
    if (!data || !data.session) { show('سجّل دخولك الأول', 'افتح السيستم وسجّل دخولك كأدمن، وبعدها افتح الربط من «القنوات».', true); return; }
    const { data: out, error } = await cl.functions.invoke('cs-whatsapp', { body: { action: 'connect_start' } });
    if (error || !out || !out.sdk || !out.state) { show('مش جاهز للربط', why(await bodyOf(error)), true); return; }
    start = { state: String(out.state), sdk: out.sdk, at: Date.now() };
    window.fbAsyncInit = function () {
      window.FB.init({ appId: String(start.sdk.app_id), autoLogAppEvents: true, xfbml: false, version: String(start.sdk.version || 'v25.0') });
      text.textContent = 'كل حاجة جاهزة.'; steps.hidden = false; go.hidden = false; go.disabled = false;
    };
    const s = document.createElement('script'); s.async = true; s.defer = true; s.crossOrigin = 'anonymous'; s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.onerror = () => show('مكتبة Meta ماتحمّلتش', 'اتأكد من النت أو إن مانع الإعلانات مش بيقفل facebook.net، وجرّب تاني.', true);
    document.head.appendChild(s);
  });
})();
