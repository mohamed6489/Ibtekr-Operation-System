
/* Shell additions: clock widget + overtime flow (Figma Clock widget 360:2538, OT popups 380:*), account menu, logout on shift,
   session timeout, and the login screen (option B: green background, centered beige card 440, radius 12 — Figma 406:3456…). */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit, L = window.IBLogo;
  const { h, Icon, Button } = U; const S = K.store;

  // ================= shift / overtime =================
  const sh = { state: 'out', start: 0, sim: 0, otStart: null, prompted: 0, endAsked: false, presence: null, note: '' };
  const now = () => Date.now();
  const worked = () => (sh.state === 'out' ? 0 : (now() - sh.start) / 60000 + sh.sim);
  const otMin = () => (sh.otStart == null ? 0 : worked() - sh.otStart);
  const clockLabel = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const realOf = (min) => sh.start + (min - sh.sim) * 60000; // wall-clock time when `min` worked minutes were reached
  let widget = null;
  function state() { return { state: sh.state, worked: worked(), startLabel: sh.start ? clockLabel(sh.start) : '' }; }
  function clockIn() { sh.state = 'in'; sh.start = now(); sh.sim = 0; sh.otStart = null; sh.prompted = 0; sh.endAsked = false; S.today[K.ME] = { in: new Date().getHours() * 60 + new Date().getMinutes(), out: null }; K.logEvent('shift.start', K.member(K.ME).name); K.toast('بدأ الدوام — بالتوفيق', 'success'); paint(); refreshPages(); }
  function finish(endMinWorked, note, auto) {
    const ot = sh.otStart != null ? Math.max(0, Math.round(endMinWorked - sh.otStart)) : 0;
    if (ot > 0) { const id = 'OT-' + (312 + S.overtime.length); const st = clockLabel(realOf(sh.otStart)); const en = clockLabel(realOf(endMinWorked));
      S.overtime.unshift({ id, member: K.ME, date: K.TODAY, start: st, end: en, minutes: ot, note, status: 'مستني', waitedHours: 0 });
      K.notify({ title: 'وقت إضافي محتاج تأكيد — ' + K.member(K.ME).name + ' (' + K.hrs(ot) + ')', link: '#hr-requests', kind: 'ot' }); K.logEvent(auto ? 'shift.autoEnd' : 'shift.overtime.end', id + ' ' + ot + 'د'); }
    else K.logEvent('shift.end', K.member(K.ME).name);
    const t = S.today[K.ME]; if (t) t.out = t.in + Math.round(endMinWorked);
    sh.state = 'out'; sh.otStart = null; sh.sim = 0; closePresence(); paint(); refreshPages();
    K.toast(auto ? 'الدوام خلص تلقائي من وقت ظهور «لسه شغال؟»' + (ot ? ' — الوقت الإضافي اتبعت للتأكيد' : '') : ot ? 'انتهى الدوام — اتبعت ' + K.hrs(ot) + ' وقت إضافي لمديرك للتأكيد' : 'انتهى الدوام', auto ? '' : 'success');
  }
  // «إنهاء الدوام»: plain confirm while in; overtime needs the note of what was worked on
  function endShift(after) {
    if (sh.state === 'overtime') return endOvertime(after);
    K.confirm({ title: 'إنهاء الدوام', text: 'اشتغلت ' + K.hrs(worked()) + ' النهارده. هينتهي الدوام دلوقتي.', okLabel: 'إنهاء الدوام', onOk: () => { finish(worked(), '', false); after && after(); } });
  }
  function endOvertime(after) {
    const end = worked();
    K.form({ title: 'إنهاء الوقت الإضافي', values: {}, note: U.InlineNote({ children: 'اشتغلت ' + K.hrs(end - sh.otStart) + ' وقت إضافي (من ' + clockLabel(realOf(sh.otStart)) + '). هيتبعت لمديرك المباشر يأكده — ولو عدّى 24 ساعة بيروح للأدمن.' }),
      fields: (f, e, set) => [K.field.area('note', 'اشتغلت على إيه في الوقت ده؟', f, e, set, { required: true, placeholder: 'مثلاً: جهزت 14 أوردر لشحنة أرامكس' })],
      validate: (f) => { const err = O.validateOtEnd(f.note); return err ? { note: err } : {}; }, submitLabel: 'إنهاء الدوام وإرسال للتأكيد', submit: (f) => { finish(end, f.note.trim(), false); after && after(); } });
  }
  function shiftOver() {
    sh.endAsked = true;
    const m = U.Modal({ title: 'ساعات العمل خلصت', body: [h('p', { style: 'margin:0' }, 'كمّلت 8 ساعات النهارده (من ' + clockLabel(sh.start) + '). تحب تنهي الدوام ولا لسه شغال وقت إضافي؟'), (() => { const t = U.Textarea({ id: 'ot-note', label: 'ملاحظة (اختياري)', value: sh.note, placeholder: 'هتشتغل على إيه؟', onInput: (v) => { sh.note = v; } }); return t; })(), h('p', { class: 't-small help', style: 'margin:0' }, 'الوقت الإضافي بيتحسب بنفس سعر الساعة بعد ما مديرك يأكده. هنسألك «لسه شغال؟» كل ' + S.hrSettings.presenceEvery / 60 + ' ساعة.')],
      footer: [Button({ label: 'لسه — وقت إضافي', onClick: () => { m.close(); sh.state = 'overtime'; sh.otStart = 480; sh.prompted = 0; K.logEvent('shift.overtime.start', sh.note || ''); K.toast('بدأ الوقت الإضافي'); paint(); } }), Button({ type: 'primary', label: 'إنهاء الدوام', onClick: () => { m.close(); finish(Math.min(worked(), 480), '', false); } })] });
  }
  function closePresence() { if (sh.presence) { clearInterval(sh.presence.t); sh.presence.modal.close(); sh.presence = null; } }
  function presencePrompt() {
    const shownAt = now(); const shownWorked = worked(); let left = O.HR.presenceTimeoutSec;
    const count = h('b', { class: 'num', 'aria-live': 'polite' }, '1:00');
    const modal = U.Modal({ title: 'لسه شغال؟', body: [h('p', { style: 'margin:0' }, 'بقالك ' + K.hrs(otMin()) + ' وقت إضافي. لو مردتش خلال دقيقة الدوام هيخلص تلقائي من دلوقتي (' + clockLabel(shownAt) + ').'), h('div', { class: 'countdown' }, Icon('clock', 'sm'), count)],
      footer: [Button({ label: 'لا — أنهي الدوام', onClick: () => { sh.presence && clearInterval(sh.presence.t); sh.presence = null; modal.close(); endOvertime(); } }), Button({ type: 'primary', label: 'أيوه لسه شغال', onClick: () => { const r = O.presenceOutcome({ shownAt, repliedAt: now(), now: now() }); clearInterval(sh.presence.t); sh.presence = null; modal.close(); if (r === 'continue') K.toast('تمام — كمّل'); } })], onClose: () => {} });
    const t = setInterval(() => { left -= 1; count.textContent = '0:' + String(Math.max(0, left)).padStart(2, '0'); if (O.presenceOutcome({ shownAt, repliedAt: null, now: now() }) === 'ended') { clearInterval(t); sh.presence = null; modal.close(); finish(shownWorked, 'انتهى تلقائي — مفيش رد على «لسه شغال؟»', true); } }, 1000);
    sh.presence = { t, modal };
  }
  function tick() {
    if (sh.state === 'out') return;
    const w = worked();
    if (sh.state === 'in' && O.shiftState(w) === 'overtime' && !sh.endAsked && S.hrSettings.shiftEnd && !document.querySelector('.scrim')) shiftOver();
    if (sh.state === 'overtime' && S.hrSettings.presence && !sh.presence) { const n = Math.floor(otMin() / S.hrSettings.presenceEvery); if (n > sh.prompted) { sh.prompted = n; presencePrompt(); } }
    paintTimer();
  }
  setInterval(tick, 1000);
  function refreshPages() { const c = window.IBPages.current; if (c === 'profile' || c === 'hr') window.IBPages.render(c); }

  // Clock widget (State=Out/In/Overtime + Timer)
  let timerEl = null;
  function paintTimer() { if (timerEl) timerEl.textContent = K.hm(worked()) + (sh.state === 'overtime' ? ' · +' + K.hm(otMin()) : ''); }
  function paint() { if (!widget) return; widget.replaceChildren(...clockInner()); }
  function clockInner() {
    if (sh.state === 'out') { timerEl = null; return [Button({ type: 'primary', size: 'sm', label: 'ابدأ الدوام', icon: 'clock', onClick: clockIn })]; }
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    timerEl = h('span', { class: 'num' });
    const trig = h('button', { type: 'button', class: 'clock clock-' + sh.state, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': sh.state === 'overtime' ? 'وقت إضافي — تفاصيل الدوام' : 'على الدوام — تفاصيل الدوام' }, h('i', { class: 'dot' }), h('span', { class: 'lbl' }, sh.state === 'overtime' ? 'وقت إضافي' : 'على الدوام'), timerEl);
    const pop = U.popover(wrap, trig, (close) => h('div', { class: 'menu end clock-pop', role: 'dialog', 'aria-label': 'الدوام', 'data-popover-root': '' },
      K.Kv([['بدأت', clockLabel(sh.start)], ['اشتغلت', K.hrs(worked())], ['الشيفت', '8 ساعات'], sh.state === 'overtime' ? ['وقت إضافي', K.hrs(otMin())] : ['فاضل', K.hrs(Math.max(0, 480 - worked()))]]),
      Button({ type: 'primary', label: sh.state === 'overtime' ? 'إنهاء الوقت الإضافي' : 'إنهاء الدوام', onClick: () => { close(); endShift(); } }),
      h('div', { class: 'demo' }, h('span', { class: 't-small help' }, 'للتجربة فقط:'), Button({ type: 'text', size: 'sm', label: 'قدّم الوقت ساعة', onClick: () => { sh.sim += 60; close(); tick(); paintTimer(); } }), Button({ type: 'text', size: 'sm', label: 'قدّم ساعتين', onClick: () => { sh.sim += 120; close(); tick(); paintTimer(); } }))));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); paintTimer(); return [wrap];
  }
  function ClockWidget() { widget = h('div', { class: 'clock-widget' }); paint(); return widget; }

  // ================= account menu / logout =================
  function AccountMenu(go) {
    const me = K.member(K.ME);
    const wrap = h('div', { class: 'pop-anchor user', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'user-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'حسابي — ' + me.name }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, me.name.charAt(0)), h('span', { class: 't-label nm' }, me.name), Icon('chevD', 'sm'));
    const items = [['users', 'ملفي', () => go('profile')], ['send', 'طلباتي', () => { location.hash = 'profile-requests'; }], ['clock', 'ساعات العمل', () => { location.hash = 'profile-hours'; }], me.role === 'أدمن' ? ['gear', 'الإعدادات', () => go('settings')] : null, ['external', 'تسجيل الخروج', logout, true]].filter(Boolean);
    const pop = U.popover(wrap, trig, (close) => { const menu = h('div', { class: 'menu end acct', role: 'menu', 'data-popover-root': '' }, h('div', { class: 'acct-h' }, h('b', null, me.name), h('small', { dir: 'ltr' }, me.email)), items.map(([ic, lb, run, danger]) => h('button', { type: 'button', role: 'menuitem', class: 'opt' + (danger ? ' danger' : ''), onClick: () => { close(); run(); } }, Icon(ic, 'sm'), lb))); return menu; });
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  function logout() {
    if (sh.state === 'out') return signOut();
    const m = U.Modal({ title: 'إنت لسه على الدوام', body: [h('p', { style: 'margin:0' }, 'بقالك ' + K.hrs(worked()) + (sh.state === 'overtime' ? ' (منهم ' + K.hrs(otMin()) + ' وقت إضافي)' : '') + '. تحب تنهي الدوام قبل ما تخرج؟'), h('p', { class: 't-small help', style: 'margin:0' }, '«أخرج بس» بيسيب الدوام شغال — تقدر تنهيه من أي جهاز.')],
      footer: [Button({ label: 'أخرج بس', onClick: () => { m.close(); signOut(); } }), Button({ type: 'primary', label: 'أنهي الدوام وأخرج', onClick: () => { m.close(); endShift(signOut); } })] });
  }
  function signOut(reason) { U.closePopover(); K.logEvent('auth.signout', reason || 'يدوي'); showLogin(reason === 'idle' ? 'expired' : 'login'); }
  function signOutAll() { K.confirm({ title: 'خروج من كل الأجهزة', text: 'هيتعمل خروج من كل الأجهزة التانية. الجهاز ده هيفضل داخل.', okLabel: 'خروج من الكل', onOk: () => { K.logEvent('auth.signoutAll', K.member(K.ME).name); K.toast('اتعمل خروج من الأجهزة التانية', 'success'); } }); }

  // ================= session timeout: 8h idle, 1-minute warning =================
  let lastAct = now(); let warnOpen = null;
  ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach((e) => document.addEventListener(e, () => { if (!warnOpen) lastAct = now(); }, { passive: true }));
  setInterval(() => { if (loggedOut) return; const s = O.idleState((now() - lastAct) / 1000); if (s === 'warn' && !warnOpen) sessionWarning(); if (s === 'expired') { if (warnOpen) warnOpen.close(); signOut('idle'); } }, 15000);
  function sessionWarning() {
    let left = 60; const c = h('b', { class: 'num' }, '1:00');
    const m = U.Modal({ title: 'الجلسة هتخلص', body: [h('p', { style: 'margin:0' }, 'مفيش نشاط من فترة. هنعمل تسجيل خروج تلقائي خلال:'), h('div', { class: 'countdown' }, Icon('clock', 'sm'), c)], footer: [Button({ label: 'اخرج', onClick: () => { m.close(); signOut(); } }), Button({ type: 'primary', label: 'كمّل', onClick: () => { lastAct = now(); m.close(); } })], onClose: () => { clearInterval(t); warnOpen = null; } });
    warnOpen = m; const t = setInterval(() => { left--; c.textContent = '0:' + String(Math.max(0, left)).padStart(2, '0'); if (left <= 0) { clearInterval(t); m.close(); signOut('idle'); } }, 1000);
  }

  // ================= login (option B) =================
  let loggedOut = false; let auth = O.loginInit(); let ls = { view: 'login', id: '', pw: '', err: '', code: '', channel: 'واتساب', remember: true, p1: '', p2: '', show: false, sentTo: '' };
  const DEMO_PW = 'Ibtekr2026';
  function findMember(id) { const x = O.toLatin(id).toLowerCase(); return S.members.find((m) => m.email.toLowerCase() === x || m.phone === x); }
  function showLogin(view) { loggedOut = true; ls = Object.assign(ls, { view: view || 'login', err: '', pw: '', code: '' }); document.getElementById('root').hidden = true; let el = document.getElementById('login'); if (!el) { el = h('div', { id: 'login', dir: 'rtl', lang: 'ar' }); document.body.append(el); } el.hidden = false; drawLogin(); document.title = 'تسجيل الدخول — نظام إبتكر'; }
  function enterApp() { loggedOut = false; lastAct = now(); const el = document.getElementById('login'); if (el) el.hidden = true; document.getElementById('root').hidden = false; try { history.replaceState(null, '', '#dashboard'); } catch (e) { /* */ } window.dispatchEvent(new HashChangeEvent('hashchange')); K.toast('أهلاً ' + K.member(K.ME).name.split(' ')[0]); }
  function drawLogin() {
    const el = document.getElementById('login'); const v = ls.view;
    const field = (id, label, key, type, extra = {}) => { const inp = h('input', Object.assign({ id, type, value: ls[key], autocomplete: extra.ac || 'off', 'aria-invalid': ls.err && extra.errKey === key ? 'true' : false }, extra.attrs || {})); inp.addEventListener('input', () => { ls[key] = inp.value; }); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') extra.onEnter && extra.onEnter(); });
      return h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input' + (ls.err && extra.errKey === key ? ' err' : '') }, inp, extra.toggle ? h('button', { type: 'button', class: 'icb t-small', 'aria-pressed': String(ls.show), onClick: () => { ls.show = !ls.show; drawLogin(); } }, ls.show ? 'إخفاء' : 'إظهار') : null), extra.help ? h('div', { class: 'help' }, extra.help) : null); };
    const err = ls.err ? U.InlineNote({ kind: 'error', children: ls.err }) : null;
    let title = '', sub = '', body = [];
    if (v === 'login') {
      const locked = O.isLocked(auth, now());
      title = 'تسجيل الدخول'; sub = 'أهلاً بيك تاني';
      body = [locked ? U.InlineNote({ kind: 'error', children: 'الحساب اتقفل مؤقتًا بعد 5 محاولات غلط. جرّب تاني بعد ' + Math.ceil((auth.lockedUntil - now()) / 60000) + ' دقيقة أو غيّر كلمة المرور.' }) : err,
        field('lg-id', 'الإيميل أو رقم الموبايل', 'id', 'text', { ac: 'username', errKey: 'id', onEnter: doLogin, attrs: { dir: 'ltr', inputmode: 'email' } }), field('lg-pw', 'كلمة المرور', 'pw', ls.show ? 'text' : 'password', { ac: 'current-password', errKey: 'pw', toggle: true, onEnter: doLogin }),
        h('div', { class: 'lg-row' }, K.Checkbox({ label: 'افتكرني على الجهاز ده', checked: ls.remember, onChange: (x) => { ls.remember = x; drawLogin(); } }), Button({ type: 'text', size: 'sm', label: 'نسيت كلمة المرور؟', onClick: () => { ls.view = 'forgot'; ls.err = ''; drawLogin(); } })),
        Button({ type: 'primary', size: 'lg', label: 'دخول', disabled: locked, onClick: doLogin, attrs: { class: 'btn btn-primary lg block' } }),
        h('p', { class: 't-small help demo-hint' }, 'للتجربة: safwat@ibtekr.club أو 01001234567 · كلمة المرور ' + DEMO_PW + ' · كود التحقق 123456')];
    } else if (v === '2fa') {
      title = 'التحقق بخطوتين'; sub = 'بعتنالك كود من 6 أرقام على ' + ls.channel;
      body = [err, U.Select({ id: 'lg-ch', label: 'ابعت الكود على', options: ['واتساب', 'إيميل', 'تطبيق Authenticator'].map((x) => ({ value: x, label: x })), value: ls.channel, onChange: (x) => { ls.channel = x; K.toast('اتبعت كود جديد على ' + x); drawLogin(); } }), field('lg-code', 'الكود', 'code', 'text', { ac: 'one-time-code', errKey: 'code', onEnter: do2fa, attrs: { inputmode: 'numeric', maxlength: 6, dir: 'ltr' } }),
        K.Checkbox({ label: 'افتكر الجهاز ده 30 يوم', checked: ls.remember, onChange: (x) => { ls.remember = x; drawLogin(); } }), Button({ type: 'primary', size: 'lg', label: 'تأكيد', onClick: do2fa, attrs: { class: 'btn btn-primary lg block' } }), h('div', { class: 'lg-row' }, Button({ type: 'text', size: 'sm', label: 'ابعت الكود تاني', onClick: () => K.toast('اتبعت كود جديد') }), Button({ type: 'text', size: 'sm', label: 'استخدم كود احتياطي', onClick: () => { ls.err = ''; K.toast('اكتب أي كود من الـ 10 الاحتياطيين في نفس الخانة'); } }))];
    } else if (v === 'forgot') {
      title = 'نسيت كلمة المرور'; sub = 'اكتب الإيميل أو الموبايل وهنبعتلك لينك';
      body = [err, field('lg-fid', 'الإيميل أو رقم الموبايل', 'id', 'text', { errKey: 'id', onEnter: doForgot, attrs: { dir: 'ltr' } }), Button({ type: 'primary', size: 'lg', label: 'ابعت اللينك', onClick: doForgot, attrs: { class: 'btn btn-primary lg block' } }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; ls.err = ''; drawLogin(); } })];
    } else if (v === 'sent') {
      title = 'اللينك اتبعت'; sub = '';
      body = [U.InlineNote({ kind: 'success', children: 'لو الحساب موجود هيوصلك لينك على ' + ls.sentTo + '. اللينك صالح 30 دقيقة.' }), Button({ type: 'primary', size: 'lg', label: 'فتح اللينك (تجربة)', onClick: () => { ls.view = 'reset'; drawLogin(); }, attrs: { class: 'btn btn-primary lg block' } }), Button({ type: 'text', label: 'ابعت تاني', onClick: () => K.toast('اتبعت تاني') }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'reset' || v === 'invite') {
      title = v === 'invite' ? 'أهلاً بيك في فريق ابتكر' : 'كلمة مرور جديدة'; sub = v === 'invite' ? 'سارة عادل دعتك — اعمل كلمة المرور عشان تبدأ (الدعوة صالحة 7 أيام)' : 'اختار كلمة مرور جديدة';
      body = [err, v === 'invite' ? K.Kv([['الإيميل', 'new.member@ibtekr.club'], ['الدور', 'خدمة عملاء']]) : null, field('lg-p1', 'كلمة المرور', 'p1', ls.show ? 'text' : 'password', { errKey: 'p1', toggle: true, ac: 'new-password', help: '8 حروف على الأقل فيها حرف ورقم' }), field('lg-p2', 'أكّد كلمة المرور', 'p2', ls.show ? 'text' : 'password', { errKey: 'p2', ac: 'new-password', onEnter: doReset }),
        Button({ type: 'primary', size: 'lg', label: v === 'invite' ? 'ابدأ' : 'حفظ ودخول', onClick: doReset, attrs: { class: 'btn btn-primary lg block' } })];
    } else if (v === 'suspended') {
      title = 'الحساب موقوف'; body = [U.InlineNote({ kind: 'error', children: 'الحساب ده اتوقف من الأدمن. لو ده غلط كلّم صفوت كمال.' }), Button({ type: 'text', label: 'رجوع', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'expiredInvite') {
      title = 'الدعوة انتهت'; body = [U.InlineNote({ kind: 'warning', children: 'لينك الدعوة صالح 7 أيام بس وانتهى. اطلب من الأدمن يبعته تاني.' }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ls.view = 'login'; drawLogin(); } })];
    } else if (v === 'expired') {
      title = 'الجلسة خلصت'; sub = 'اتعمل خروج تلقائي بعد 8 ساعات من غير نشاط'; body = [Button({ type: 'primary', size: 'lg', label: 'سجّل دخول تاني', onClick: () => { ls.view = 'login'; drawLogin(); }, attrs: { class: 'btn btn-primary lg block' } })];
    }
    el.replaceChildren(h('main', { class: 'login-wrap' }, h('div', { class: 'login-brand' }, L.Logo({ tone: 'reversed', width: 200 }), h('div', { class: 'tagline' }, L.TAGLINE)),
      h('section', { class: 'login-card', 'aria-labelledby': 'lg-title' }, h('h1', { class: 't-h4', id: 'lg-title' }, title), sub ? h('p', { class: 't-small help' }, sub) : null, ...[].concat(body).filter(Boolean)),
      h('p', { class: 'login-foot t-small' }, '© 2026 إبتكر كلوب · ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); K.toast('محتاج مساعدة؟ كلّم الأدمن'); } }, 'مساعدة'))));
    setTimeout(() => { const f = el.querySelector('[aria-invalid=true]') || el.querySelector('input'); if (f) f.focus(); });
  }
  function doLogin() {
    if (O.isLocked(auth, now())) return drawLogin();
    if (!O.identifierKind(ls.id)) { ls.err = 'اكتب إيميل صحيح أو رقم موبايل من 11 رقم'; return drawLogin(); }
    const m = findMember(ls.id);
    if (m && m.status === 'suspended') { ls.view = 'suspended'; return drawLogin(); }
    if (!m || ls.pw !== DEMO_PW) { auth = O.loginFail(auth, now()); K.logEvent('auth.fail', O.toLatin(ls.id)); ls.err = O.isLocked(auth, now()) ? '' : 'الإيميل/الموبايل أو كلمة المرور غلط. فاضل ' + auth.left + ' محاولات قبل ما الحساب يتقفل 15 دقيقة.'; ls.pw = ''; return drawLogin(); }
    auth = O.loginInit(); ls.err = '';
    if (m.twofa && !ls.trusted) { ls.view = '2fa'; return drawLogin(); }
    K.logEvent('auth.signin', m.name); enterApp();
  }
  function do2fa() { const c = O.toLatin(ls.code); if (c !== '123456' && !/^\d{4}-?\d{4}$/.test(c)) { ls.err = 'الكود غلط أو انتهى — جرّب تاني'; ls.code = ''; return drawLogin(); } if (ls.remember) ls.trusted = true; K.logEvent('auth.2fa', ls.channel); ls.err = ''; enterApp(); }
  function doForgot() { if (!O.identifierKind(ls.id)) { ls.err = 'اكتب إيميل صحيح أو رقم موبايل من 11 رقم'; return drawLogin(); } ls.sentTo = O.identifierKind(ls.id) === 'email' ? O.toLatin(ls.id) : 'واتساب ' + O.toLatin(ls.id); ls.err = ''; ls.view = 'sent'; drawLogin(); }
  function doReset() { const e = O.validatePassword(ls.p1, ls.p2); if (e) { ls.err = e; return drawLogin(); } K.logEvent('auth.password.set', ls.view); ls.err = ''; ls.p1 = ls.p2 = ''; if (ls.view === 'invite') return enterApp(); ls.view = 'login'; drawLogin(); K.toast('اتحفظت كلمة المرور — سجّل دخول', 'success'); }
  function routeLogin(hs) { const map = { login: 'login', 'login-2fa': '2fa', 'login-forgot': 'forgot', 'login-reset': 'reset', invite: 'invite', 'invite-expired': 'expiredInvite', 'login-suspended': 'suspended', 'login-locked': 'login' }; if (!(hs in map)) return false; if (hs === 'login-locked') auth = { fails: 0, left: 5, lockedUntil: now() + 15 * 60000 }; showLogin(map[hs]); return true; }

  window.IBShell = { ClockWidget, AccountMenu, state, clockIn, endShift, sessionWarning, signOutAll, showLogin, routeLogin, isLoggedOut: () => loggedOut };
})();

