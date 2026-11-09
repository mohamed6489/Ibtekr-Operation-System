/* Ibtekr maker portal (owner 26 Oct «بوابة المبتكر»; phase 13 T4, decision 10): block 32 of the prototype v6 on a real API —
   sign-in, first-login password, forgot / reset by link, then the maker's own view: his open lines and delays, his account, his data.
   Everything goes through window.IBPortalAPI (below): the Edge Function `portal` with the portal token in x-portal-token (sessionStorage
   only, 12 hours). The maker is not a Supabase Auth user; no supabase-js on this page. */
(function () {
  'use strict';
  const U = window.IBUI, VD = window.IbtekrVendors, L = window.IBLogo;
  const { h, Button } = U;
  // the pieces of IBKit the block used, without loading the kit (its store and prefs belong to the team app)
  let toastEl = null, toastT = 0;
  const K = {
    MainTabs: ({ items, active, onChange, label }) => { const t = U.Tabs({ items, active, onChange: (id) => onChange(id) }); t.setAttribute('aria-label', label || 'أقسام البوابة'); return t; },
    Tag: (tone, label) => h('span', { class: 'tg tg-' + tone }, label),
    toast: (msg, kind) => { if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); } toastEl.className = 'toast show ' + (kind || ''); toastEl.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.className = 'toast'; }, 3200); },
    money: (n) => new Intl.NumberFormat('en-EG', { maximumFractionDigits: 2 }).format(Number(n) || 0),
  };
  const money = K.money;

  // ---------- the API: the Edge Function portal ----------
  const cfg = window.IB_CONFIG || {}; const TOKEN_KEY = 'ib.portal.token';
  const token = { get: () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }, set: (t) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ } } };
  async function call(action, args) {
    if (!cfg.supabaseUrl) return { ok: false, status: 0, error: 'not_configured' };
    const headers = { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey || '' }; const t = token.get(); if (t) headers['x-portal-token'] = t;
    try {
      const res = await fetch(String(cfg.supabaseUrl).replace(/\/+$/, '') + '/functions/v1/portal', { method: 'POST', headers, body: JSON.stringify(Object.assign({ action }, args || {})) });
      let body = null; try { body = await res.json(); } catch (e) { body = null; }
      if (!res.ok) return { ok: false, status: res.status, error: (body && body.error) || 'failed', until: body && body.until, issues: body && body.issues };
      return Object.assign({ ok: true, status: res.status }, body || {});
    } catch (e) { return { ok: false, status: 0, error: 'network' }; }
  }
  const API = {
    login: (user, password) => call('login', { user, password }),
    setPassword: (password) => call('set_password', { password }),
    changePassword: (current, password) => call('change_password', { current, password }),
    resetRequest: (user) => call('reset_request', { user }),
    reset: (tok, password) => call('reset', { token: tok, password }),
    me: () => call('me'), orders: () => call('orders'), account: () => call('account'),
    bankRequest: (note) => call('bank_request', { note }),
    token,
  };
  window.IBPortalAPI = API;

  const ps = { view: 'login', user: '', pw: '', p1: '', p2: '', show: false, err: '', errKey: '', sentMode: '', tab: 'home', of: 'open', resetToken: '', busy: false, name: '', data: null, loading: false, loadErr: '' };
  let el = null;
  function host() { if (!el) { el = h('div', { id: 'portal', dir: 'rtl', lang: 'ar' }); document.body.append(el); } return el; }
  const setHash = (hs) => { try { history.replaceState(null, '', '#' + hs); } catch (e) { /* sandbox */ } };
  const go = (view, hs) => { ps.view = view; ps.err = ''; ps.errKey = ''; if (hs) setHash(hs); draw(); };
  // the server answers «wrong» for an unknown user, a wrong password, a disabled login and a login without a password alike (no account
  // enumeration); only the lock is named
  const WHY = { wrong: 'اسم المستخدم أو الباسورد غلط — لو لسه ما استلمتش باسورد مؤقت أو حسابك موقوف، كلّم فريق إبتكر.', locked: 'الحساب اتقفل 15 دقيقة بعد 5 محاولات غلط. استرجع الباسورد من «نسيت الباسورد؟» أو كلّم إبتكر يفكّه.',
    use_change_password: 'غيّر الباسورد من «بياناتي».', not_configured: 'البوابة لسه مش جاهزة على السيرفر — كلّم فريق إبتكر.', network: 'مفيش اتصال — جرّب تاني.', failed: 'حصلت مشكلة — جرّب تاني.', must_change: 'لازم تعمل باسورد جديد الأول.', unauthorized: 'انتهت الجلسة — سجّل دخول تاني.' };
  const why = (r) => WHY[r.error] || WHY.failed; // the server never says how many tries are left (an unknown user and a wrong password look the same)

  // ---------- auth screens (same shell as the team login) ----------
  function field(id, label, key, type, extra = {}) {
    const inp = h('input', Object.assign({ id, type, value: ps[key], autocomplete: extra.ac || 'off', dir: extra.dir || null, 'aria-invalid': ps.err && ps.errKey === key ? 'true' : false }, extra.attrs || {}));
    inp.addEventListener('input', () => { ps[key] = inp.value; if (extra.live) extra.live(inp.value); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && extra.onEnter) extra.onEnter(); });
    return h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'input' + (ps.err && ps.errKey === key ? ' err' : '') }, inp, extra.toggle ? h('button', { type: 'button', class: 'icb t-small', 'aria-pressed': String(ps.show), onClick: () => { ps.show = !ps.show; draw(); } }, ps.show ? 'إخفاء' : 'إظهار') : null), extra.help ? h('div', { class: 'help' }, extra.help) : null);
  }
  const rules = (pw) => { const iss = VD.passwordIssues(pw); return h('ul', { id: 'pt-rules', class: 'pw-rules', 'aria-live': 'polite' }, [['8 حروف على الأقل', '8 حروف على الأقل'], ['حرف إنجليزي', 'حرف إنجليزي'], ['رقم', 'رقم واحد على الأقل'], ['من غير مسافات', 'من غير مسافات']].map(([k, l]) => h('li', { class: iss.includes(k) ? '' : 'ok' }, l))); };
  function authScreen(title, sub, body) {
    return h('main', { class: 'login-wrap' }, h('div', { class: 'login-brand' }, L ? L.Logo({ tone: 'reversed', width: 200 }) : null, h('div', { class: 'tagline' }, 'بوابة المبتكر')),
      h('section', { class: 'login-card', 'aria-labelledby': 'pt-title' }, h('h1', { class: 't-h4', id: 'pt-title' }, title), sub ? h('p', { class: 't-small help' }, sub) : null, ...[].concat(body).filter(Boolean)),
      h('p', { class: 'login-foot t-small' }, '© 2026 إبتكر كلوب · ', h('a', { href: 'index.html' }, 'دخول فريق إبتكر')));
  }
  async function doLogin() {
    if (ps.busy) return;
    if (!ps.user.trim()) { ps.err = 'اكتب اسم المستخدم أو الإيميل'; ps.errKey = 'user'; return draw(); }
    if (!ps.pw) { ps.err = 'اكتب الباسورد'; ps.errKey = 'pw'; return draw(); }
    ps.busy = true; draw();
    const r = await API.login(ps.user, ps.pw); ps.pw = ''; ps.busy = false;
    if (r.ok) { token.set(r.token); ps.name = r.name || ''; ps.data = null; if (r.must_change) return go('first', 'portal-first'); ps.tab = 'home'; return enter(); }
    ps.err = why(r); ps.errKey = r.error === 'wrong' ? 'pw' : '';
    draw();
  }
  async function doSetPw() {
    if (ps.busy) return;
    const iss = VD.passwordIssues(ps.p1); if (iss.length) { ps.err = 'الباسورد لازم: ' + iss.join('، '); ps.errKey = 'p1'; return draw(); }
    if (ps.p1 !== ps.p2) { ps.err = 'الباسوردين مش زي بعض'; ps.errKey = 'p2'; return draw(); }
    ps.busy = true; draw();
    const r = ps.view === 'reset' ? await API.reset(ps.resetToken, ps.p1) : await API.setPassword(ps.p1); ps.busy = false;
    if (!r.ok) { ps.err = r.error === 'reset_invalid' ? 'اللينك ده مش صالح أو انتهى — اطلب لينك جديد من «نسيت الباسورد؟»' : r.error === 'weak_password' ? 'الباسورد لازم: ' + (r.issues || []).join('، ') : why(r); return draw(); }
    token.set(r.token); if (r.name) ps.name = r.name; ps.p1 = ps.p2 = ''; ps.resetToken = ''; ps.data = null;
    K.toast('اتحفظ الباسورد — أهلاً بيك في بوابة المبتكر', 'success'); ps.tab = 'home'; enter();
  }
  function setPwScreen(title, sub, note) {
    return authScreen(title, sub, [ps.err ? U.InlineNote({ kind: 'error', children: ps.err }) : null, note ? U.InlineNote({ children: note }) : null,
      field('pt-p1', 'الباسورد الجديد', 'p1', ps.show ? 'text' : 'password', { ac: 'new-password', dir: 'ltr', toggle: true, errKey: 'p1', live: (v) => { const x = document.getElementById('pt-rules'); if (x) x.replaceWith(rules(v)); } }), rules(ps.p1),
      field('pt-p2', 'اكتبه تاني', 'p2', ps.show ? 'text' : 'password', { ac: 'new-password', dir: 'ltr', errKey: 'p2', onEnter: doSetPw }),
      Button({ type: 'primary', size: 'lg', label: ps.busy ? 'لحظة…' : 'احفظ وادخل', onClick: doSetPw, attrs: { class: 'btn btn-primary lg block', 'data-pt-save': '', disabled: ps.busy ? '' : false } }),
      ps.view === 'reset' ? Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => { ps.resetToken = ''; ps.p1 = ps.p2 = ''; go('login', 'portal'); } }) : null]);
  }
  async function doForgot() {
    if (ps.busy) return;
    if (!ps.user.trim()) { ps.err = 'اكتب اسم المستخدم أو الإيميل'; ps.errKey = 'user'; return draw(); }
    ps.busy = true; draw(); const r = await API.resetRequest(ps.user); ps.busy = false;
    if (!r.ok) { ps.err = why(r); return draw(); }
    ps.sentMode = r.mode || 'team'; go('sent', 'portal-sent');
  }

  // ---------- the maker's own view (the server answers his rows only) ----------
  async function enter() {
    ps.view = 'home'; setHash('portal-' + ps.tab); ps.loading = true; ps.loadErr = ''; draw();
    const [me, orders, account] = await Promise.all([API.me(), API.orders(), API.account()]);
    ps.loading = false;
    if (!me.ok) { if (me.status === 401) { token.set(''); ps.data = null; ps.err = WHY.unauthorized; return go('login', 'portal'); } ps.loadErr = why(me); return draw(); }
    ps.data = { v: me.v, login: me.login, brands: me.brands || [], bank: me.bank, subs: orders.ok ? orders.rows || [] : [], ordersOk: orders.ok, led: account.ok ? account.ledger : null, dokan: account.ok ? account.dokan : false, withdrawals: account.ok ? account.withdrawals || [] : [], syncedAt: account.ok ? account.synced_at : null };
    ps.name = me.v.name; draw();
  }
  const kpi = (label, value, tone, note) => h('div', { class: 'pt-kpi' + (tone ? ' ' + tone : '') }, h('small', null, label), h('b', null, value), note ? h('span', { class: 't-small help' }, note) : null);
  const dayName = (iso) => (iso ? U.num(String(iso).slice(0, 10).split('-').reverse().join('/')) : '—');
  function homeTab(D) {
    const open = D.subs.filter((s) => s.open); const late = open.filter((s) => s.delivery === 'late'), risk = open.filter((s) => s.delivery === 'risk');
    const bal = D.led ? D.led.net : 0; const pos = bal > 0 ? 'ليك' : bal < 0 ? 'عليك' : 'متصفّي';
    return [h('div', { class: 'pt-kpis' }, kpi('قطع مفتوحة', U.num(String(open.length))), kpi('متأخر', U.num(String(late.length)), late.length ? 'bad' : null, 'بعد 11 يوم'), kpi('قابل للتأخير', U.num(String(risk.length)), risk.length ? 'warn' : null, 'من 9 لـ 11 يوم'), kpi('رصيدك', U.num(money(Math.abs(bal)) + ' ج.م'), bal < 0 ? 'bad' : null, D.led ? pos : 'لسه مش متزامن')),
      late.length || risk.length ? h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'محتاجين يخلصوا الأول')), h('div', { class: 'sec-b' }, subsTable(late.concat(risk))))
        : U.InlineNote({ kind: 'success', children: 'مفيش قطع متأخرة — شغل ممتاز 👏' }),
      U.InlineNote({ children: 'أي استفسار على أوردر أو تحويل كلّم فريق متابعة المبتكرين على واتساب إبتكر.' })];
  }
  function subsTable(rows) {
    if (!rows.length) return U.EmptyState('مفيش قطع هنا', 'جرّب فلتر تاني.');
    return U.Table({ cls: 'dt pt-table', headers: ['الأوردر', 'المنتج', 'الكمية', 'حالة القطعة', 'التسليم', 'من كام يوم', 'التسليم المتوقع'], rows: rows.map((s) => [U.num('#' + s.order + (s.n ? '-' + s.n : '')), s.prod || '—', U.num(String(s.qty || 1)), s.ss || s.status, s.open ? U.DelayBadge(s.delivery) : K.Tag('neutral', s.status), U.num(String(s.age) + ' يوم'), s.exp ? dayName(s.exp) : '—']) });
  }
  function ordersTab(D) {
    const F = { open: (s) => s.open, late: (s) => s.open && s.delivery !== 'ok', done: (s) => !s.open, all: () => true };
    const rows = D.subs.filter(F[ps.of]);
    return [h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'فلتر القطع' }, [['open', 'مفتوحة'], ['late', 'متأخرة وقابلة للتأخير'], ['done', 'خلصت'], ['all', 'الكل']].map(([k, l]) => h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(ps.of === k), 'aria-pressed': String(ps.of === k), onClick: () => { ps.of = k; draw(); } }, l + ' (' + D.subs.filter(F[k]).length + ')'))),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-b' }, D.ordersOk ? subsTable(rows) : U.InlineNote({ kind: 'warning', children: 'مقدرناش نقرا الأوردرات دلوقتي — جرّب تاني.' }))),
      h('p', { class: 't-small help', style: 'margin:0' }, 'أوردرات آخر 90 يوم. التأخير بيتحسب من يوم الأوردر: قابل للتأخير من 9 لـ 11 يوم، ومتأخر بعد 11 يوم.')];
  }
  function accountTab(D) {
    const l = D.led; const row = (k, v, cls) => h('div', { class: 'pt-row' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, U.num(money(v) + ' ج.م')));
    const WD = { pending: 'مستني', approved: 'اتحوّل', cancelled: 'اتلغى' };
    return [h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'حسابك معانا')), h('div', { class: 'sec-b pt-ledger' },
      !l ? U.InlineNote({ kind: 'warning', children: 'مقدرناش نقرا الحساب دلوقتي — جرّب تاني.' }) : [
        row('رصيدك على الموقع (Dokan)', l.dokan), row('عربون مستلم مقدّم', -l.deposits), row('مواصلات اتخصمت', -l.transport), l.other ? row('حركات تانية', l.other) : null,
        row(l.net >= 0 ? 'رصيدك الحالي — ليك' : 'رصيدك الحالي — عليك', Math.abs(l.net), 'total'),
        !D.dokan ? h('p', { class: 't-small help', style: 'margin:0' }, 'رصيد الموقع لسه ما اتزامنش — الأرقام هتتحدث مع أول مزامنة.') : D.syncedAt ? h('p', { class: 't-small help', style: 'margin:0' }, 'آخر تحديث من الموقع: ' + dayName(D.syncedAt)) : null])),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'آخر طلبات السحب')), h('div', { class: 'sec-b' },
        D.withdrawals.length ? U.Table({ cls: 'dt pt-table', headers: ['التاريخ', 'المبلغ', 'الحالة'], rows: D.withdrawals.map((w) => [dayName(w.at), U.num(money(w.amount) + ' ج.م'), K.Tag(w.status === 'approved' ? 'success' : w.status === 'pending' ? 'gold' : 'neutral', WD[w.status] || w.status)]) }) : U.EmptyState('مفيش طلبات سحب', 'طلبات السحب بتتعمل من حسابك على الموقع.'))),
      U.InlineNote({ children: 'التحويل بيتم على ' + (D.bank ? VD.label(VD.PAY_METHODS, D.bank.method) : 'الحساب اللي هتسجله في «بياناتي»') + '. الأرقام من حسابات إبتكر والموقع.' })];
  }
  function profileTab(D) {
    const v = D.v; const info = (k, val) => U.InfoRow({ label: k, value: val });
    const bank = D.bank; const ch = { pw0: '', pw1: '' };
    return [h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'بياناتك')), h('div', { class: 'sec-b' }, info('الاسم', v.name), info('البراندات', D.brands.map((b) => b.name).join('، ')), info('الموبايل', v.phone ? U.num(v.phone) : null), info('الإيميل', v.email), info('اسم المستخدم', D.login ? h('span', { dir: 'ltr' }, D.login.username) : null))),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'الحساب البنكي')), h('div', { class: 'sec-b' },
        bank ? [info('طريقة التحويل', VD.label(VD.PAY_METHODS, bank.method)), info('اسم صاحب الحساب', bank.holder), bank.bankName ? info('البنك', bank.bankName) : null, bank.iban ? info('IBAN', h('span', { dir: 'ltr' }, bank.iban)) : null, bank.account ? info('رقم الحساب', h('span', { dir: 'ltr' }, bank.account)) : null, bank.wallet ? info('رقم المحفظة / إنستاباي', h('span', { dir: 'ltr' }, bank.wallet)) : null] : U.InlineNote({ kind: 'warning', children: 'لسه مفيش حساب بنكي متسجل — ابعت بياناتك لفريق إبتكر عشان التحويل.' }),
        Button({ label: bank ? 'اطلب تعديل الحساب البنكي' : 'ابعت بيانات الحساب', attrs: { 'data-pt-bank': '' }, onClick: async () => { const r = await API.bankRequest(''); if (!r.ok) return K.toast(why(r), 'error'); K.toast(r.existing ? 'طلبك لسه مفتوح عند الحسابات — هيكلموك.' : 'اتبعت الطلب — الحسابات هتكلمك تأكد البيانات', 'success'); } }),
        h('p', { class: 't-small help', style: 'margin:0' }, 'عشان الأمان، تعديل الحساب البنكي بيتم من فريق الحسابات بعد ما يتأكد منك.'))),
      h('section', { class: 'card sec' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'غيّر الباسورد')), h('div', { class: 'sec-b' },
        U.TextInput({ id: 'pt-old', label: 'الباسورد الحالي', type: 'password', dir: 'ltr', autocomplete: 'current-password', onInput: (x) => { ch.pw0 = x; } }),
        U.TextInput({ id: 'pt-new', label: 'الباسورد الجديد', type: 'password', dir: 'ltr', autocomplete: 'new-password', help: '8 حروف على الأقل وفيه حرف ورقم', onInput: (x) => { ch.pw1 = x; } }),
        Button({ type: 'primary', label: 'غيّر الباسورد', attrs: { 'data-pt-chpw': '' }, onClick: async () => { const iss = VD.passwordIssues(ch.pw1); if (iss.length) return K.toast('الباسورد لازم: ' + iss.join('، '), 'error'); const r = await API.changePassword(ch.pw0, ch.pw1); if (!r.ok) return K.toast(r.error === 'wrong' ? 'الباسورد الحالي غلط' : r.error === 'locked' ? 'الحساب اتقفل — استرجع الباسورد' : why(r), 'error'); token.set(r.token); K.toast('اتغيّر الباسورد', 'success'); draw(); } })))];
  }
  function homeScreen() {
    const D = ps.data;
    const tabs = [['home', 'الرئيسية'], ['orders', 'أوردراتي'], ['account', 'حسابي'], ['profile', 'بياناتي']];
    const body = ps.loading ? [h('div', { class: 'pt-loading' }, 'بنحمّل بياناتك…')] : !D ? [U.InlineNote({ kind: 'error', children: ps.loadErr || WHY.failed, action: Button({ size: 'sm', label: 'جرّب تاني', onClick: enter }) })]
      : ps.tab === 'orders' ? ordersTab(D) : ps.tab === 'account' ? accountTab(D) : ps.tab === 'profile' ? profileTab(D) : homeTab(D);
    const name = D ? D.v.name : ps.name; const brands = D ? D.brands.map((b) => b.name).join(' · ') : '';
    return h('div', { class: 'pt-app' },
      h('header', { class: 'pt-top' }, L ? L.Logo({ tone: 'reversed', width: 120 }) : null, h('span', { class: 'pt-who' }, h('b', null, name), h('small', null, brands)), Button({ type: 'text', size: 'sm', label: 'خروج', attrs: { class: 'btn btn-text sm pt-out', 'data-pt-out': '' }, onClick: () => { token.set(''); ps.data = null; ps.name = ''; K.toast('اتعمل خروج'); go('login', 'portal'); } })),
      h('main', { class: 'pt-main' }, h('h1', { class: 't-h3' }, 'أهلاً ' + name), h('p', { class: 't-small help', style: 'margin:0' }, 'أوردراتك وحسابك مع إبتكر — بتتحدث أول بأول.'),
        K.MainTabs({ items: tabs.map(([id, label]) => ({ id, label })), active: ps.tab, onChange: (id) => { ps.tab = id; setHash('portal-' + id); draw(); }, label: 'أقسام البوابة' }), ...body));
  }

  function draw() {
    const v = ps.view; let node;
    if (v === 'home') node = homeScreen();
    else if (v === 'first') node = setPwScreen('اعمل الباسورد بتاعك', 'ده أول دخول — الباسورد المؤقت لازم يتغيّر.', null);
    else if (v === 'reset') node = setPwScreen('باسورد جديد', 'اختار باسورد جديد لحسابك', 'اللينك ده صالح 30 دقيقة ولمرة واحدة.');
    else if (v === 'forgot') node = authScreen('نسيت الباسورد', 'اكتب اسم المستخدم أو الإيميل وهنبعتلك لينك', [ps.err ? U.InlineNote({ kind: 'error', children: ps.err }) : null, field('pt-fuser', 'اسم المستخدم أو الإيميل', 'user', 'text', { dir: 'ltr', errKey: 'user', onEnter: doForgot }), Button({ type: 'primary', size: 'lg', label: ps.busy ? 'لحظة…' : 'ابعت اللينك', onClick: doForgot, attrs: { class: 'btn btn-primary lg block', 'data-pt-forgot': '', disabled: ps.busy ? '' : false } }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => go('login', 'portal') })]);
    else if (v === 'sent') node = authScreen('اتبعت الطلب', null, [U.InlineNote({ kind: ps.sentMode === 'email' ? 'success' : 'warning', children: ps.sentMode === 'email' ? 'لو الحساب موجود هيوصلك لينك على الإيميل المسجّل. صالح 30 دقيقة.' : 'استرجاع الباسورد بالإيميل لسه مش متفعّل — كلّم فريق إبتكر يعملك باسورد مؤقت جديد.' }), Button({ type: 'text', label: 'رجوع لتسجيل الدخول', onClick: () => go('login', 'portal') })]);
    else node = authScreen('دخول المبتكر', 'تابع أوردراتك وحسابك مع إبتكر', [ps.err ? U.InlineNote({ kind: 'error', children: ps.err }) : null,
      field('pt-user', 'اسم المستخدم أو الإيميل', 'user', 'text', { ac: 'username', dir: 'ltr', errKey: 'user', onEnter: doLogin }),
      field('pt-pw', 'الباسورد', 'pw', ps.show ? 'text' : 'password', { ac: 'current-password', dir: 'ltr', toggle: true, errKey: 'pw', onEnter: doLogin }),
      h('div', { class: 'lg-row' }, h('span'), Button({ type: 'text', size: 'sm', label: 'نسيت الباسورد؟', onClick: () => go('forgot', 'portal-forgot') })),
      Button({ type: 'primary', size: 'lg', label: ps.busy ? 'لحظة…' : 'دخول', onClick: doLogin, attrs: { class: 'btn btn-primary lg block', 'data-pt-login': '', disabled: ps.busy ? '' : false } })]);
    host().replaceChildren(node);
    setTimeout(() => { const f = el.querySelector('[aria-invalid=true]') || (v === 'home' ? null : el.querySelector('input:not([type=hidden])')); if (f && document.activeElement !== f && !ps.busy) f.focus(); });
  }

  // routes: #portal, #portal-forgot, #portal-reset/<token>, #portal-home|orders|account|profile (need a token)
  function route(hs) {
    let m;
    if ((m = /^portal-reset\/([0-9a-f]{64})$/.exec(hs))) { ps.resetToken = m[1]; ps.view = 'reset'; ps.err = ''; setHash('portal-reset'); draw(); return; }
    if (hs === 'portal-forgot') { ps.view = 'forgot'; draw(); return; }
    if ((m = /^portal-(home|orders|account|profile)$/.exec(hs))) { if (!token.get()) { ps.view = 'login'; ps.err = 'سجّل دخول الأول'; setHash('portal'); draw(); return; } ps.tab = m[1]; enter(); return; }
    if (token.get()) { ps.tab = 'home'; enter(); return; }
    ps.view = 'login'; draw();
  }
  window.IBPortal = { route, state: ps };
  window.addEventListener('hashchange', () => route(location.hash.slice(1))); // a reset link opened on an already open page
  route(location.hash.slice(1));
})();
