// Phase 5.4 decision 11: Magnific's OAuth comes back to magnific-callback.html with ?code=…&state=… (the redirect URI the system
// registered). This page hands both to ai-images action bridge_callback as the signed-in admin (the same Supabase session as the
// app, same origin — the CSP allows no inline script, hence this file); the server spends the state, exchanges the code and keeps
// the tokens in Vault. Nothing is stored or logged here, and the query is wiped from the address bar once read.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const title = document.getElementById('cb-title'), text = document.getElementById('cb-text'), back = document.getElementById('cb-back');
  const show = (t, msg, bad) => { title.textContent = t; text.textContent = msg; text.classList.toggle('err', !!bad); back.hidden = false; try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ } };
  const code = q.get('code') || '', state = q.get('state') || '';
  if (q.get('error')) { show('Magnific ماوافقش', 'الرد: ' + String(q.get('error_description') || q.get('error')).slice(0, 200), true); return; }
  if (!code || !state) { show('مفيش كود ربط', 'افتح الربط من «إعدادات الصور» في المنتجات.', true); return; }
  const cl = window.IBSupabase && window.IBSupabase.client;
  if (!cl) { show('السيستم مش متوصّل', 'الإعدادات ناقصة في config.js.', true); return; }
  cl.auth.getSession().then(async ({ data }) => {
    if (!data || !data.session) { show('سجّل دخولك الأول', 'افتح السيستم وسجّل دخولك كأدمن، وبعدها اربط Magnific تاني من «إعدادات الصور».', true); return; }
    try {
      const { data: out, error } = await cl.functions.invoke('ai-images', { body: { action: 'bridge_callback', code, state } });
      if (error || !out || !out.linked) {
        let b = null; try { b = error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; }
        const why = b && b.error === 'refused' ? 'Magnific رفض كود الربط — جرّب تاني من «إعدادات الصور».' : b && b.field === 'state' ? 'انتهت صلاحية الربط (10 دقايق) أو اتستخدم قبل كده — جرّب تاني.' : b && b.error === 'unauthorized' ? 'الأدمن بس يقدر يربط الحساب.' : 'الربط ماكملش — جرّب تاني.';
        show('الربط ماكملش', why, true); return;
      }
      show('اتربط حساب Magnific ✓', out.account ? 'الحساب: ' + out.account + ' — الصور بقت بتترفع وترجع من السيستم مباشرة.' : 'الصور بقت بتترفع وترجع من السيستم مباشرة.', false);
    } catch (e) { show('الربط ماكملش', 'في مشكلة في الاتصال — جرّب تاني.', true); }
  });
})();
