// Phase 9.5.6 decision 68: TikTok's / Google's sign-in comes back to ads-callback.html with ?code=…&state=… (or ?auth_code= for
// TikTok) — the redirect URI the owner registered on the TikTok app and the Google OAuth client. This page hands both to mkt-ads action
// link_callback as the signed-in admin (the same Supabase session as the app, same origin — the CSP allows no inline script, hence this
// file); the server spends the state, exchanges the code, reads the account(s) and links the one account (or lists several to pick from
// here → link_pick). Nothing is stored or logged here, and the query is wiped from the address bar once read.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const title = document.getElementById('cb-title'), text = document.getElementById('cb-text'), back = document.getElementById('cb-back'), list = document.getElementById('cb-accounts');
  const show = (t, msg, bad) => { title.textContent = t; text.textContent = msg; text.classList.toggle('err', !!bad); back.hidden = false; try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ } };
  const code = q.get('code') || q.get('auth_code') || '', state = q.get('state') || '';
  if (q.get('error')) { show('المنصة ماوافقتش', 'الرد: ' + String(q.get('error_description') || q.get('error')).slice(0, 200), true); return; }
  if (!code || !state) { show('مفيش كود ربط', 'افتح الربط من «التسويق › نظرة عامة › حالة الربط».', true); return; }
  const cl = window.IBSupabase && window.IBSupabase.client;
  if (!cl) { show('السيستم مش متوصّل', 'الإعدادات ناقصة في config.js.', true); return; }
  const NAME = { tiktok: 'تيك توك', google: 'جوجل' };
  const why = (b) => (b && b.field === 'state' ? 'انتهت صلاحية الربط (10 دقايق) أو اتستخدم قبل كده — جرّب تاني من «حالة الربط».'
    : b && b.field === 'oauth' ? 'بيانات التطبيق ناقصة — اكتب App ID والـ Secret (أو Client ID والـ Secret) في «حالة الربط» الأول.'
    : b && b.error === 'unauthorized' ? 'الأدمن بس يقدر يربط حسابات الإعلانات.'
    : b && b.error === 'no_refresh_token' ? 'جوجل ماادّاش مفتاح تجديد — شيل التطبيق من حساب جوجل (myaccount.google.com › الأمان › تطبيقات الطرف الثالث) واربط تاني.'
    : b && b.error === 'no_account' ? 'الحساب اللي سجّلت بيه مالوش حساب إعلانات متاح — سجّل بالحساب اللي بيدير الإعلانات.'
    : b && b.error === 'permission' ? 'المنصة رفضت القراية (الصلاحيات أو الـ developer token) — راجع إعدادات التطبيق وجرّب تاني.'
    : b && b.error === 'token' ? 'المنصة رفضت الكود — جرّب الربط تاني من الأول.'
    : b && typeof b.error === 'string' ? 'المنصة رفضت الربط (' + b.error + ')' + (b.text ? ' — ' + String(b.text).slice(0, 200) : '') : 'الربط ماكملش — جرّب تاني.');
  const bodyOf = async (error) => { try { return error && error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { return null; } };
  const linked = (out) => show('اتربط حساب ' + (NAME[out.platform] || 'الإعلانات') + ' ✓', 'الأرقام هتبدأ تتسحب في المزامنة الجاية (كل ساعة) — أو اضغط «مزامنة دلوقتي» في «نظرة عامة».' + (out.account && out.account.id ? ' الحساب: ' + out.account.id : ''), false);
  const pick = async (platform, a) => {
    title.textContent = 'بنربط ' + (a.name || a.id) + '…'; list.hidden = true;
    const { data: out, error } = await cl.functions.invoke('mkt-ads', { body: { action: 'link_pick', platform, account: a.id } });
    if (error || !out || !out.linked) { show('الربط ماكملش', why(await bodyOf(error)), true); return; }
    linked(out);
  };
  cl.auth.getSession().then(async ({ data }) => {
    if (!data || !data.session) { show('سجّل دخولك الأول', 'افتح السيستم وسجّل دخولك كأدمن، وبعدها اربط الحساب تاني من «حالة الربط».', true); return; }
    try {
      const { data: out, error } = await cl.functions.invoke('mkt-ads', { body: { action: 'link_callback', code, state } });
      if (error || !out) { show('الربط ماكملش', why(await bodyOf(error)), true); return; }
      if (out.result === 'choose' && Array.isArray(out.accounts)) {
        title.textContent = 'اختار حساب الإعلانات'; text.textContent = 'الحساب بيدير أكتر من حساب إعلانات — اختار حساب إبتكر:'; try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ }
        list.textContent = ''; out.accounts.forEach((a) => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'pick'; b.setAttribute('data-pick-account', String(a.id)); b.textContent = (a.name ? a.name + ' · ' : '') + a.id; b.addEventListener('click', () => pick(out.platform, a)); li.appendChild(b); list.appendChild(li); });
        list.hidden = false; return;
      }
      if (!out.linked) { show('الربط ماكملش', 'جرّب تاني من «حالة الربط».', true); return; }
      linked(out);
    } catch (e) { show('الربط ماكملش', 'في مشكلة في الاتصال — جرّب تاني.', true); }
  });
})();
