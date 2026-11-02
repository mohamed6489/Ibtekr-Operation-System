// Phase 6.2 decision 13: Facebook's sign-in comes back to meta-callback.html with ?code=…&state=… (the redirect URI registered on the
// Meta app). This page hands both to cs-channel action connect_callback as the signed-in admin (the same Supabase session as the
// app, same origin — the CSP allows no inline script, hence this file); the server spends the state, exchanges the code, reads the
// pages and links the one page (or lists several to pick from here → connect_pick). Nothing is stored or logged here, and the query
// is wiped from the address bar once read.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const title = document.getElementById('cb-title'), text = document.getElementById('cb-text'), back = document.getElementById('cb-back'), list = document.getElementById('cb-pages');
  const show = (t, msg, bad) => { title.textContent = t; text.textContent = msg; text.classList.toggle('err', !!bad); back.hidden = false; try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ } };
  const code = q.get('code') || '', state = q.get('state') || '';
  if (q.get('error')) { show('Meta ماوافقتش', 'الرد: ' + String(q.get('error_description') || q.get('error_reason') || q.get('error')).slice(0, 200), true); return; }
  if (!code || !state) { show('مفيش كود ربط', 'افتح الربط من تاب «القنوات» في خدمة العملاء.', true); return; }
  const cl = window.IBSupabase && window.IBSupabase.client;
  if (!cl) { show('السيستم مش متوصّل', 'الإعدادات ناقصة في config.js.', true); return; }
  const why = (b) => (b && b.error === 'no_pages' ? 'الحساب اللي سجّلت بيه مالوش صفحات فيسبوك بيديرها — سجّل بحساب أدمن صفحة Ibtekr Club.'
    : b && b.field === 'state' ? 'انتهت صلاحية الربط (10 دقايق) أو اتستخدم قبل كده — جرّب تاني من «القنوات».'
    : b && b.error === 'unauthorized' ? 'الأدمن بس يقدر يربط القنوات.' : b && b.error === 'not_configured' ? 'تطبيق Meta لسه مش متظبط على السيرفر (الأسرار ناقصة).'
    : b && /^graph_/.test(String(b.error || '')) ? 'Meta رفضت الربط (' + b.error + ') — اتأكد إن الصفحة في التطبيق وإنك Tester، وجرّب تاني.' : 'الربط ماكملش — جرّب تاني.');
  const bodyOf = async (error) => { try { return error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { return null; } };
  const linked = (out) => show('اتربطت صفحة ' + (out.page ? out.page.name : 'فيسبوك') + ' ✓', out.instagram ? 'ماسنجر وإنستجرام' + (out.page && out.page.ig && out.page.ig.username ? ' (@' + out.page.ig.username + ')' : '') + ' بقوا يوصلوا صندوق الرسايل.' : 'ماسنجر بقى يوصل صندوق الرسايل. الصفحة مالهاش حساب إنستجرام مربوط — اربطه من إعدادات الصفحة وبعدها اربط تاني.', false);
  const pick = async (p) => {
    title.textContent = 'بنربط ' + p.name + '…'; list.hidden = true;
    const { data: out, error } = await cl.functions.invoke('cs-channel', { body: { action: 'connect_pick', page_id: p.id } });
    if (error || !out || !out.linked) { show('الربط ماكملش', why(await bodyOf(error)), true); return; }
    linked(out);
  };
  cl.auth.getSession().then(async ({ data }) => {
    if (!data || !data.session) { show('سجّل دخولك الأول', 'افتح السيستم وسجّل دخولك كأدمن، وبعدها اربط فيسبوك تاني من «القنوات».', true); return; }
    try {
      const { data: out, error } = await cl.functions.invoke('cs-channel', { body: { action: 'connect_callback', code, state } });
      if (error || !out) { show('الربط ماكملش', why(await bodyOf(error)), true); return; }
      if (out.result === 'choose' && Array.isArray(out.pages)) {
        title.textContent = 'اختار الصفحة'; text.textContent = 'الحساب بيدير أكتر من صفحة — اختار صفحة Ibtekr Club:'; try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ }
        list.textContent = ''; out.pages.forEach((p) => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'pick'; b.setAttribute('data-pick-page', String(p.id)); b.textContent = p.name + (p.ig && p.ig.username ? ' · @' + p.ig.username : ''); b.addEventListener('click', () => pick(p)); li.appendChild(b); list.appendChild(li); });
        list.hidden = false; return;
      }
      if (!out.linked) { show('الربط ماكملش', 'جرّب تاني من «القنوات».', true); return; }
      linked(out);
    } catch (e) { show('الربط ماكملش', 'في مشكلة في الاتصال — جرّب تاني.', true); }
  });
})();
