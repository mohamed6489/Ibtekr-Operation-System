
/* Profile «ملفي» — Figma page 382:12596. 10 tabs. Admin opening a member (#member-Mxx) sees the SAME page + admin-only beige cards. */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U; const S = K.store;
  const TABS = [['overview', 'نظرة عامة'], ['tasks', 'مهامي'], ['hours', 'ساعات العمل'], ['requests', 'طلباتي'], ['performance', 'أدائي'], ['achievements', 'إنجازاتي'], ['salary', 'مرتبي'], ['docs', 'العقود والمستندات'], ['security', 'الحساب والأمان'], ['alerts', 'تنبيهاتي'], ['prefs', 'التفضيلات']];
  const st = { tab: 'overview', who: K.ME, taskSub: 'today', reqSub: 'mine', showPay: false, newTask: '', prefs: { landing: 'الأوردرات', sound: true, digest: true, whatsapp: false, density: 'مضغوط' }, notes: {}, perfQ: null, slips: {} };
  const rerender = () => window.IBPages.render('profile');
  const isAdminView = () => st.who !== K.ME;
  const HR = () => window.IBPages.all().hr.api;
  const label = (id) => (isAdminView() ? { tasks: 'المهام', requests: 'الطلبات', performance: 'الأداء', achievements: 'الإنجازات', salary: 'المرتب' }[id] : null) || TABS.find((t) => t[0] === id)[1];
  // phase 10 T7: the HR tabs read IBHR (app/js/adapter/hr.js) — the server's rows under RLS (mine with hr.view N, my team's with P, all
  // with F) and the money mine or sensitive.salaries'; the alerts and the prefs stay as they were; the tasks are IBHR's too (decision 25)
  const IH = () => window.IBHR;
  const HD = () => (IH() ? IH().data : K.store);
  const can = () => (IH() ? IH().can() : { view: 'N', edit: false, approve: false, salaries: false, admin: false });
  // the member: the HR numbers from IBHR, who they are (name, contact, 2FA, role, status) from the directory's live object — IBAuth flips
  // its twofa at once; a member only hr_team() shows (a manager's team) comes from IBHR alone
  const ID_KEYS = ['name', 'email', 'phone', 'twofa', 'status', 'role', 'title', 'dept', 'manager'];
  const HM = (id) => { const d = K.member(id); const r = IH() && IH().member(id); if (!r) return d; if (!d || !d.id) return r; const m = Object.assign({}, r); ID_KEYS.forEach((k) => { if (d[k] !== undefined) m[k] = d[k]; }); return m; };
  const seesMoney = (m) => !!(m && m.id) && (m.id === K.ME || can().salaries);
  const tdy = () => (IH() ? IH().today() : K.TODAY); const thisMonth = () => tdy().slice(0, 7);
  const monName = (k) => K.AR_MON[Number(String(k).slice(5, 7)) - 1] || ''; const monLabel = (k) => monName(k) + ' ' + String(k).slice(0, 4);
  const QN = ['الأول', 'التاني', 'التالت', 'الرابع'];
  const qOf = (k) => (IH() ? IH().quarterOf(k) : k.slice(0, 4) + '-Q' + (Math.floor((Number(k.slice(5, 7)) - 1) / 3) + 1));
  const qMonths = (q) => { const y = q.slice(0, 4); const n = Number(q.slice(-1)); return [1, 2, 3].map((i) => y + '-' + String((n - 1) * 3 + i).padStart(2, '0')); };
  const qLabel = (q) => 'الربع ' + QN[Number(q.slice(-1)) - 1] + ' ' + q.slice(0, 4); const qShort = (q) => 'Q' + q.slice(-1);
  // a text field in the page being typed in: the live redraws wait (a modal's fields are not the page's)
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !(a.closest && a.closest('.modal')); };
  // the payslips of a member (IBHR.slips), fetched once per HR load
  let slipGen = 0;
  function slipsOf(m) {
    if (!seesMoney(m) || !IH()) return { status: 'ok', list: [] };
    const c = st.slips[m.id]; if (c && c.gen === slipGen) return c;
    const gen = slipGen; st.slips[m.id] = { gen, status: 'loading', list: c ? c.list : [] };
    IH().slips(m.id).then((r) => { if (slipGen !== gen) return; st.slips[m.id] = { gen, status: r.ok ? 'ok' : 'error', list: r.ok ? r.list : [] }; if (window.IBPages.current === 'profile' && !typing()) rerender(); });
    return st.slips[m.id];
  }
  document.addEventListener('ib:hr', () => { slipGen += 1; if (window.IBPages.current === 'profile' && !typing()) rerender(); });

  function view() {
    const m = HM(st.who); const ad = isAdminView();
    if (!m.id) return [K.Section('', K.Empty('الملف ده مش ظاهر ليك', 'افتح ملفات الفريق من «الموارد البشرية › الفريق».'))];
    const sh = window.IBShell ? window.IBShell.state() : { state: 'out' };
    const sub = [m.title, m.dept].filter(Boolean).join(' · ') + (m.manager ? ' · المدير المباشر: ' + HM(m.manager).name : '');
    const head = h('div', { class: 'card prof-head' }, h('span', { class: 'avatar xl', 'aria-hidden': 'true' }, m.name.charAt(0)),
      h('div', { class: 'grow' }, h('h1', { class: 't-h3' }, m.name), h('div', { class: 't-small help' }, sub || '—'), h('div', { class: 'acts-inline' }, m.role ? K.Tag('brand', m.role) : null, m.status === 'suspended' ? K.Tag('error', 'موقوف') : K.Tag('success', 'نشط'), !ad ? K.Tag(sh.state === 'out' ? 'neutral' : sh.state === 'overtime' ? 'orange' : 'success', sh.state === 'out' ? (sh.ended ? 'خلص الدوام' : 'خارج الدوام') : sh.state === 'overtime' ? 'وقت إضافي' : 'على الدوام') : K.Tag(HR().status(m)[1], HR().status(m)[0]))),
      h('div', { class: 'acts-inline' }, ad ? Button({ label: 'رجوع للفريق', onClick: () => { location.hash = 'hr-team'; } }) : Button({ label: 'تعديل بياناتي', onClick: () => editInfo(m) })));
    const tabs = K.MainTabs({ items: TABS.map(([id]) => ({ id, label: label(id) })), active: st.tab, onChange: (id) => { st.tab = id; setHash(); rerender(); }, label: 'أقسام الملف' });
    const body = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...tab(m));
    return [ad ? U.InlineNote({ kind: 'warning', children: 'بتشوف ملف ' + m.name + (can().admin ? ' كأدمن' : '') + ' — الكروت البيج ظاهرة ليك بس.' }) : null, head, tabs, body];
  }
  const setHash = () => { try { history.replaceState(null, '', isAdminView() ? '#member-' + st.who : '#profile' + (st.tab === 'overview' ? '' : '-' + st.tab)); } catch (e) { /* */ } };

  function tab(m) {
    switch (st.tab) {
      case 'overview': return overview(m);
      case 'tasks': return tasks(m);
      case 'hours': return hours(m);
      case 'requests': return requests(m);
      case 'performance': return performance(m);
      case 'achievements': return achievements(m);
      case 'salary': return salary(m);
      case 'docs': return docs(m);
      case 'security': return security(m);
      case 'alerts': return alertsTab(m);
      default: return prefs(m);
    }
  }


  // ---------- تنبيهاتي (owner 22 Oct): personal prefs inside what the role allows ----------
  function alertsTab(m) {
    const NR = window.IbtekrNotifRoles, NRV = window.IBNotifRoles; if (!NR || !NRV) return [];
    const P = (S.notifPrefs[m.id] = S.notifPrefs[m.id] || { mute: [], ch: 'زي إعدادات الشركة', quiet: 'زي إعدادات الشركة', digestAt: '' });
    const ci = NRV.roleIdx(m); const perms = window.IBPages.all().settings.api.perms(); const ov = S.alertOverrides[m.id] || {};
    const rows = NR.SOURCES.map((src) => ({ src, base: NR.access(S.alertRoles, perms, src.key, ci, ov[src.key]) })).filter((x) => x.base !== 'N');
    const save = (msg) => { K.logEvent('profile.alerts', m.name + ': ' + msg); K.toast('اتحفظ'); rerender(); document.dispatchEvent(new Event('ib:notify')); };
    const sel = (id, label, val, opts, on, help) => h('div', null, U.Select({ id, label, options: opts.map((x) => ({ value: x, label: x })), value: val, onChange: (v) => { on(v); save(label + ' = ' + v); } }), help ? h('div', { class: 't-small help' }, help) : null);
    return [K.Section('اللي بستلمه', [K.Kv ? null : null,
      rows.length ? U.Table({ cls: 'mini-table', headers: ['التنبيه', 'القسم', 'الحالة', 'كتم'], rows: rows.map(({ src, base }) => { const muted = P.mute.includes(src.key);
        return [src.label, src.section, K.Tag(base === 'R' && !muted ? 'success' : 'neutral', base === 'R' ? (muted ? 'مكتوم (للعلم)' : 'بستلمه') : 'للعلم'), base === 'R' ? h('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(muted), 'aria-label': 'كتم ' + src.label, onClick: () => { P.mute = muted ? P.mute.filter((k) => k !== src.key) : P.mute.concat(src.key); save((muted ? 'إلغاء كتم ' : 'كتم ') + src.label); } }, h('i')) : h('span', { class: 't-small help' }, '—')]; }) }) : K.Empty('مفيش تنبيهات لدورك', 'الأدمن يقدر يضيفلك من الإعدادات › التنبيهات حسب الدور')], null, { sub: rows.filter((x) => x.base === 'R' && !P.mute.includes(x.src.key)).length + ' بستلمه · ' + rows.filter((x) => x.base === 'S' || P.mute.includes(x.src.key)).length + ' للعلم — حسب دورك «' + m.role + '»' + (Object.keys(ov).length ? ' + ' + Object.keys(ov).length + ' تجاوز من الأدمن' : '') + '. الكتم بيخلّي التنبيه يظهرلك باهت «للعلم» من غير رقم ولا إشعار.' }),
      K.Section('طريقة الإرسال ليّا', [K.two(sel('np-ch', 'القنوات', P.ch, ['زي إعدادات الشركة', 'داخل السيستم بس', 'داخل السيستم + واتساب', 'داخل السيستم + إيميل', 'داخل السيستم + واتساب + إيميل'], (v) => { P.ch = v; }, 'داخل السيستم دايمًا شغال · واتساب/إيميل بس لو التنبيه نفسه مسموح له بيهم'),
        sel('np-q', 'ساعات الهدوء بتاعتي', P.quiet, ['زي إعدادات الشركة', 'من 10:00 م إلى 8:00 ص', 'من 11:00 م إلى 9:00 ص', 'من 12:00 ص إلى 10:00 ص', 'مفيش'], (v) => { P.quiet = v; }, 'التنبيهات العاجلة (تصعيد / عاجل) بتوصل حتى في الهدوء')),
        sel('np-dg', 'ميعاد ملخصي اليومي', P.digestAt || 'زي ميعاد الدور', ['زي ميعاد الدور'].concat(O.NOTIF_TIMES), (v) => { P.digestAt = v === 'زي ميعاد الدور' ? '' : v; }, 'الملخص اليومي لدور «' + m.role + '» من الإعدادات › تقارير المهام')], null, { sub: 'في حدود اللي الأدمن سامح بيه' })];
  }

  // ---------- نظرة عامة: simple summary ----------
  const lastScore = (id) => { const sc = HD().scores[id] || {}; const k = Object.keys(sc).filter((x) => sc[x] != null).sort().pop(); return k ? { k, v: sc[k] } : null; };
  const achievementsOf = (id) => (HD().achievements || []).filter((a) => a.member === id);
  function overview(m) {
    const r = O.rollover(tasksOf(m.id), tdy()); const open = r.today.length + autoOf(m).length; const D = HD(); const mk = thisMonth();
    const myReq = D.requests.filter((x) => x.member === m.id); const need = isAdminView() ? 0 : needFromMe().length; const isP = HR().isPending;
    const days = D.attendance.filter((a) => a.member === m.id && a.date.startsWith(mk) && a.in != null).length;
    const sc = lastScore(m.id); const qs = HR().qScore(m.id); const money = seesMoney(m); const slip = money && m.salary > 0 ? slipsOf(m).list[0] : null;
    const year = tdy().slice(0, 4);
    const tile = (t, v, sub, go) => h('button', { type: 'button', class: 'card sum-tile', onClick: () => { st.tab = go; setHash(); rerender(); } }, h('span', { class: 'kpi-label t-label' }, t), h('span', { class: 't-h3' }, K.Num(String(v))), h('span', { class: 't-small help' }, sub), h('span', { class: 'more t-small' }, 'التفاصيل ', Icon('chevL', 'sm')));
    return [h('div', { class: 'cards' }, tile('مهام النهارده', open, r.today.filter((t) => t.carried).length + ' من امبارح', 'tasks'), tile('ساعات ' + monName(mk), K.hm(m.monthMin || 0), days + ' يوم حضور', 'hours'), tile('رصيد الإجازات', (m.leave || 0) - (m.used || 0), 'من ' + (m.leave || 0) + ' يوم', 'requests'), isAdminView() || need === 0 ? tile(isAdminView() ? 'طلباته' : 'طلباتي', myReq.filter(isP).length, 'مستنية قرار', 'requests') : tile('محتاجة منك', need, 'طلبات فريقك', 'requests')),
      h('div', { class: 'cards' }, tile(sc ? 'أداء ' + monName(sc.k) : 'الأداء', sc ? sc.v + '%' : '—', sc ? O.rating(sc.v) + (qs != null ? ' · الربع ' + qs + '%' : '') : 'لسه مفيش تقييم', 'performance'), tile('إنجازات', achievementsOf(m.id).filter((a) => a.month.slice(0, 4) === year).length, 'مكافآت السنة دي', 'achievements'),
        tile('آخر مرتب', slip ? K.money(slip.net) : '—', !money ? 'المرتبات للأدمن بس' : !(m.salary > 0) ? 'مفيش مرتب مسجل' : slip ? 'صافي ' + monName(slip.month) : 'القسيمة بتظهر بعد اعتماد الكشف', 'salary'), tile('المستندات', m.contract === 'missing' ? 'ناقص' : 'تمام', m.contract === 'expiring' ? 'العقد بيخلص قريب' : 'العقد والمستندات', 'docs')),
      isAdminView() ? adminCards(m) : null];
  }
  // the beige cards when another member's file is open: each by what the viewer may do (the server decides again)
  function adminCards(m) {
    const c = can(); const kv = (k, v) => [k, v];
    const job = c.salaries || c.edit ? h('section', { class: 'card admin' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'الوظيفة والمرتب'), Button({ size: 'sm', label: 'تعديل', onClick: () => editJob(m) })),
      K.Kv([kv('الوظيفة', m.title || '—'), kv('الدور', m.role || '—'), kv('المرتب', c.salaries ? K.money(m.salary || 0) + ' ج.م' : '••••'), kv('الحجز للبونص', c.salaries ? K.money(m.holdback || 0) + ' ج.م' : '••••'), kv('سعر اليوم والساعة', c.salaries && m.salary ? 'اليوم ' + K.money(O.rates(m.salary).daily) + ' · الساعة ' + K.money(O.rates(m.salary).hourly) : '—'), kv('الشيفت', m.shift.join(' – ')), kv('تاريخ التعيين', m.hire ? K.dlabel(m.hire) : '—'), kv('الإجازة السنوية', (m.leave || 0) + ' يوم')])) : null;
    const notes = c.edit ? h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'ملاحظات داخلية'), (() => { const ta = h('textarea', { class: 'textarea', rows: 4, 'aria-label': 'ملاحظات داخلية', placeholder: 'مش ظاهرة للعضو' }); ta.value = m.hrNotes || '';
      ta.addEventListener('change', () => { IH().memberUpdate(m.id, { notes: ta.value }).then((r) => K.toast(r.ok ? 'اتحفظت الملاحظة' : r.message || 'معرفناش نحفظها — جرّب تاني', r.ok ? 'success' : 'error')); }); return ta; })()) : null;
    const quick = c.edit || c.salaries ? h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'إجراءات سريعة'), h('div', { class: 'quick' }, c.edit ? Button({ label: 'تسجيل حضور يدوي', icon: 'clock', onClick: () => HR().manualAtt(m) }) : null, c.edit ? Button({ label: 'رفع عقد', icon: 'attach', onClick: () => HR().uploadContract(m) }) : null, c.edit ? Button({ label: 'تحديد ميتنج', icon: 'cal', onClick: () => HR().scheduleMeeting(m) }) : null, c.salaries ? Button({ label: 'قسيمة المرتب', icon: 'wallet', onClick: () => HR().payslipModal(m) }) : null)) : null;
    const sec = c.admin ? h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'الأمان'), K.Kv([kv('الإيميل', m.email || '—'), kv('الموبايل', m.phone ? h('span', { dir: 'ltr' }, m.phone) : '—'), kv('التحقق بخطوتين', m.twofa ? 'مفعّل' : 'مش مفعّل')]),
      h('div', { class: 'quick' }, Button({ size: 'sm', label: 'باسورد مؤقت جديد', onClick: () => HR().newPassword(m) })), h('div', { class: 't-small help' }, 'إيقاف الحساب والخروج من كل الأجهزة لعضو تاني مع صفحة الإعدادات — لحد وقتها من لوحة Supabase.')) : null;
    return h('div', { class: 'admin-cards' }, job, notes, quick, sec);
  }

  // ---------- مهامي (phase 10 decision 25: IBHR.data.tasks — hr_tasks on the server, 0048) ----------
  // the member's own tasks, the v5's tab as it is: the add box, the six statuses, «النهارده» / «المؤجل» / «خلصت» with block 12's rollover on
  // Cairo's today; another member's file shows «المهام» to who may write them (the direct manager, hr.edit F — the server decides again)
  const TD = () => (IH() ? IH().data.tasks || [] : []);
  const tasksOf = (id) => TD().filter((t) => t.member === id);
  const canT = (id) => !!(IH() && IH().canTask && IH().canTask(id));
  const perm = (k) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(k) : 'N');
  const T_TONE = { 'لسه': 'neutral', 'جاري': 'gold', 'متوقفة': 'orange', 'جاهزة للمراجعة': 'info', 'خلصت': 'success', 'اتأجلت': 'neutral' };
  const T_EN = { 'لسه': 'To do', 'جاري': 'In progress', 'متوقفة': 'Hold', 'جاهزة للمراجعة': 'Ready for review', 'خلصت': 'Complete', 'اتأجلت': 'Postponed' };
  // a count in Egyptian Arabic: 1 · 2 · 3–10 · 11+
  const cnt = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? n + ' ' + few : n + ' ' + many);
  const CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل']; const TK_OPEN = ['open', 'in_progress'];
  // «تلقائية من السيستم»: what waits for the member right now, read from the live data — it goes by itself once it is handled. Mine: the
  // reviews waiting for me (a click reviews), my team's requests / overtime waiting for my decision, my role's open tickets (each urgent one,
  // then the count), the open orders not confirmed yet (orders.status F); another member's file: the reviews waiting for them
  function autoOf(m) {
    const out = []; const mine = m.id === K.ME;
    TD().filter((t) => t.status === 'جاهزة للمراجعة' && t.reviewerUid && t.reviewerUid === m.uid)
      .forEach((t) => out.push({ key: 'rv' + t.id, title: 'راجع: ' + t.title + ' — ' + (t.memberName || '—'), run: mine ? () => review(t) : null }));
    if (!mine) return out;
    const toReq = () => { st.tab = 'requests'; st.reqSub = 'need'; setHash(); rerender(); };
    needFromMe().forEach((x) => out.push(x.kind === 'req' ? { key: 'rq' + x.r.id, title: 'مراجعة طلب ' + x.r.type + ' — ' + (HM(x.r.member).name || '—'), run: toReq }
      : { key: 'ot' + x.o.id, title: 'تأكيد وقت إضافي — ' + (HM(x.o.member).name || '—'), run: toReq }));
    const TA = window.IBTickets;
    if (TA && TA.can && TA.can().view && TA.state && TA.state() === 'ready') {
      const open = TA.all().filter((t) => TK_OPEN.includes(t.status) && TA.isMine(t)); const urgent = open.filter((t) => t.priority === 'urgent');
      urgent.forEach((t) => out.push({ key: 'tk' + t.id, title: 'الرد على تذكرة ' + t.id + ' (عاجل)', href: '#tickets/' + t.id }));
      const rest = open.length - urgent.length;
      if (rest > 0) out.push({ key: 'tk', title: 'الرد على ' + cnt(rest, 'تذكرة مفتوحة', 'تذكرتين مفتوحين', 'تذاكر مفتوحة', 'تذكرة مفتوحة'), href: '#tickets' });
    }
    const DD = window.IBDashData;
    if (DD && DD.rows && perm('orders.view') !== 'N' && perm('orders.status') === 'F') {
      const n = DD.rows().filter((x) => x.confirm === 'غير مؤكد' && !CLOSED.includes(x.status)).length;
      if (n) out.push({ key: 'or', title: 'تأكيد ' + cnt(n, 'أوردر غير مؤكد', 'أوردرين غير مؤكدين', 'أوردرات غير مؤكدة', 'أوردر غير مؤكد'), href: '#orders' });
    }
    return out;
  }
  const autoRow = (t) => h('div', { class: 'task auto', 'data-auto': t.key }, Icon('sparkle', 'sm'),
    t.run ? h('a', { href: '#profile-tasks', role: 'button', onClick: (e) => { e.preventDefault(); t.run(); } }, t.title) : t.href ? h('a', { href: t.href }, t.title) : h('span', null, t.title),
    h('span', { class: 't-small help' }, 'بتختفي لوحدها لما تتحل'));
  const failed = (r) => { if (r && !r.ok && r.reason !== 'stale') { K.toast(r.message || 'معرفناش نحفظ — جرّب تاني', 'error'); if (window.IBPages.current === 'profile') rerender(); } };
  function tasks(m) {
    const r = O.rollover(tasksOf(m.id), tdy()); const auto = autoOf(m); const w = canT(m.id);
    const subs = [{ id: 'today', label: 'النهارده', count: r.today.length + auto.length }, { id: 'later', label: 'المؤجل', count: r.later.length + r.scheduled.length }, { id: 'done', label: 'خلصت', count: r.done.length }];
    const add = h('input', { class: 'task-add', placeholder: 'ضيف مهمة واضغط Enter', 'aria-label': 'مهمة جديدة', value: st.newTask, maxlength: '200' });
    add.addEventListener('input', () => { st.newTask = add.value; });
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && add.value.trim()) { const p = IH().taskAdd(st.who, add.value.trim()); st.newTask = ''; rerender(); setTimeout(() => { const n = document.querySelector('.task-add'); if (n) n.focus(); }); p.then(failed); } });
    const list = st.taskSub === 'today' ? r.today : st.taskSub === 'later' ? r.later.concat(r.scheduled) : r.done.slice().sort((a, b) => (String(a.doneAt || '') < String(b.doneAt || '') ? 1 : -1));
    return [K.SubTabs({ items: subs, active: st.taskSub, onChange: (id) => { st.taskSub = id; rerender(); }, label: 'المهام' }),
      st.taskSub === 'today' ? K.Section('تلقائية من السيستم', auto.length ? auto.map(autoRow) : isAdminView() ? K.Empty('مفيش مراجعات مستنياه', '') : K.Empty('مفيش حاجة مستنياك', 'المراجعات والطلبات والتذاكر والأوردرات اللي محتاجاك بتظهر هنا لوحدها.'), null, { sub: auto.length + ' مهمة' }) : null,
      K.Section(st.taskSub === 'today' ? (isAdminView() ? 'مهامه النهارده' : 'مهامي النهارده') : st.taskSub === 'later' ? 'المؤجل' : 'خلصت', [st.taskSub === 'today' && w ? h('label', { class: 'task-add-wrap' }, Icon('plus', 'sm'), add) : null, list.length ? list.map((t) => taskRow(t, w)) : K.Empty(st.taskSub === 'later' ? 'مفيش مهام مؤجلة' : st.taskSub === 'done' ? 'لسه مفيش مهام خلصت' : 'مفيش مهام', st.taskSub === 'today' && w ? 'اكتب مهمة فوق واضغط Enter.' : '')], null, { sub: st.taskSub === 'today' ? 'اللي ما خلصش بينتقل لبكره «من امبارح»' : st.taskSub === 'later' ? 'تذكير أسبوعي لو المؤجل لأجل غير مسمى عدّى 30 يوم' : 'آخر 90 يوم' })];
  }
  function taskRow(t, w) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'tstat-btn', 'aria-haspopup': 'listbox', 'aria-label': 'حالة المهمة: ' + t.status, disabled: w ? false : '' }, K.Tag(T_TONE[t.status], t.status), w ? Icon('chevD', 'sm') : null);
    if (w) { const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: O.TASK_STATUSES.map((s) => ({ value: s, label: s + ' · ' + T_EN[s] })), value: t.status, onSelect: (v) => { close(); changeStatus(t, v); } })); btn.addEventListener('click', pop.toggle); }
    wrap.append(btn);
    const meta = [t.status === 'متوقفة' && t.reason ? 'السبب: ' + t.reason : t.status === 'جاهزة للمراجعة' ? 'المراجع: ' + (t.reviewer || '—') : t.status === 'اتأجلت' ? (t.until ? 'لـ ' + K.dshort(t.until) : 'لأجل غير مسمى')
      : t.status === 'جاري' && t.reviewNote ? 'رجعت من ' + (t.reviewer || 'المراجع') + ': ' + t.reviewNote : t.status === 'خلصت' && t.reviewer ? 'اتراجعت من ' + t.reviewer : '',
    t.byUid && t.byUid !== t.memberUid && t.by ? 'من ' + t.by : ''].filter(Boolean).join(' · ');
    const del = IH() && IH().canDeleteTask && IH().canDeleteTask(t);
    return h('div', { class: 'task' + (t.status === 'خلصت' ? ' done' : ''), 'data-task': String(t.id) }, K.Checkbox({ label: '', checked: t.status === 'خلصت', disabled: !w, onChange: (v) => changeStatus(t, v ? 'خلصت' : 'لسه') }),
      h('span', { class: 'grow' }, t.title, t.carried ? h('span', { class: 'carried' }, K.Tag('orange', 'من امبارح')) : null, meta ? h('small', { class: 't-small help' }, ' · ' + meta) : null), wrap,
      del ? K.RowMenu([{ label: 'حذف', icon: 'close', danger: true, run: () => { IH().taskDelete(t.id).then(failed); rerender(); } }], 'إجراءات ' + t.title) : null);
  }
  // «مين هيراجع»: the active team (hr_task_people) but the task's own member; the member's direct manager first
  function reviewers(t) {
    const P = IH() ? IH().people() : []; const owner = HM(t.member) || {}; const mgr = owner.manager ? HM(owner.manager) : null;
    const l = P.filter((p) => p.uid !== t.memberUid); const first = mgr && l.find((p) => p.code === mgr.id);
    return { list: first ? [first].concat(l.filter((p) => p !== first)) : l, def: first ? first.uid : '' };
  }
  function changeStatus(t, s) {
    if (s === 'متوقفة' || s === 'جاهزة للمراجعة' || s === 'اتأجلت') {
      const R = s === 'جاهزة للمراجعة' ? reviewers(t) : { list: [], def: '' };
      return K.form({ title: s === 'متوقفة' ? 'وقّف المهمة' : s === 'جاهزة للمراجعة' ? 'جاهزة للمراجعة' : 'أجّل المهمة', values: { reviewer: R.def, when: 'day', until: O.addDays(tdy(), 1) }, note: h('b', null, t.title),
        fields: (f, e, set) => s === 'متوقفة' ? [K.field.area('reason', 'سبب التوقف', f, e, set, { required: true })] : s === 'جاهزة للمراجعة' ? [K.field.select('reviewer', 'مين هيراجع', R.list.map((p) => ({ value: p.uid, label: p.name })), f, e, set, { required: true, help: 'هتظهر عنده مهمة تلقائية' })]
          : [K.Radios({ label: 'لإمتى', value: f.when, onChange: (v) => set('when', v, true), options: [{ value: 'day', label: 'ليوم معين — تظهر تلقائي في اليوم ده' }, { value: 'never', label: 'لأجل غير مسمى — تتحط في «المؤجل»' }] }), f.when === 'day' ? K.field.date('until', 'اليوم', f, e, set, { required: true, today: tdy() }) : null],
        validate: (f) => { const err = O.validateTaskStatus(s, { reason: f.reason, reviewer: f.reviewer, until: f.when === 'day' ? f.until : null, indefinite: f.when === 'never' }) || (s === 'اتأجلت' && f.when === 'day' && f.until < tdy() ? 'اختار يوم من النهارده أو بعده' : null); if (!err) return {}; return { [s === 'متوقفة' ? 'reason' : s === 'جاهزة للمراجعة' ? 'reviewer' : 'until']: err }; },
        submitLabel: 'حفظ', submit: (f) => { const p = IH().taskSet(t.id, s, { reason: f.reason, reviewer: f.reviewer, until: f.when === 'day' ? f.until : null, indefinite: f.when === 'never' }); K.toast('المهمة بقت «' + s + '»'); rerender(); p.then(failed); } });
    }
    const p = IH().taskSet(t.id, s); rerender(); p.then(failed);
  }
  // the reviewer: «تمام — خلصت» or «رجّعها» with a note the owner reads
  function review(t) {
    K.form({ title: 'مراجعة مهمة', note: h('div', null, h('b', null, t.title), h('div', { class: 't-small help' }, 'من ' + (t.memberName || '—'))), values: { decision: 'ok', note: '' },
      fields: (f, e, set) => [K.Radios({ label: 'المراجعة', value: f.decision, onChange: (v) => set('decision', v, true), options: [{ value: 'ok', label: 'تمام — خلصت' }, { value: 'back', label: 'رجّعها — محتاجة تعديل' }] }),
        f.decision === 'back' ? K.field.area('note', 'ملاحظتك', f, e, set, { required: true, help: 'هتظهر عند ' + (t.memberName || 'صاحب المهمة') }) : null],
      validate: (f) => (f.decision === 'back' && !String(f.note || '').trim() ? { note: 'اكتب ملاحظتك' } : {}),
      submitLabel: 'حفظ', submit: (f, mo) => { IH().taskReview(t.id, f.decision === 'ok', f.note).then((r) => { if (!r.ok) return failed(r); mo.close(); K.toast(f.decision === 'ok' ? 'المهمة خلصت' : 'رجعت لـ ' + (t.memberName || 'صاحبها'), 'success'); if (window.IBPages.current === 'profile') rerender(); }); return false; } });
  }
  // the auto tasks read the tickets and the orders too
  ['ib:tickets', 'ib:orders-ready'].forEach((ev) => document.addEventListener(ev, () => { if (window.IBPages.current === 'profile' && (st.tab === 'tasks' || st.tab === 'overview') && !typing()) rerender(); }));

  // ---------- ساعات العمل (this month's days from the server's attendance) ----------
  function hours(m) {
    const D = HD(); const mk = thisMonth(); const mon = monName(mk); const who = m.name; const t = tdy();
    const att = D.attendance.filter((a) => a.member === m.id && a.date.startsWith(mk) && a.in != null).sort((x, y) => (x.date < y.date ? 1 : -1));
    const done = att.filter((a) => a.out != null); const worked = done.reduce((s, a) => s + (a.out - a.in), 0);
    const ot = D.overtime.filter((o) => o.member === m.id).sort((x, y) => (x.date < y.date ? 1 : -1));
    const otOk = ot.filter((o) => o.status === 'اتضاف' && o.kind !== 'rest_day' && o.date.startsWith(mk)); const otPend = ot.filter((o) => o.status === 'مستني');
    const sh = !isAdminView() && window.IBShell ? window.IBShell.state() : null;
    const lates = att.filter((a) => a.late); const okMin = otOk.reduce((x, o) => x + o.paid, 0);
    const outTxt = (a) => (a.out != null ? K.hm(a.out) : a.date === t ? 'لسه شغال' : 'ناقص');
    const attRow = (a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.hm(a.in), outTxt(a), a.out != null ? K.hm(a.out - a.in) : '—', a.late ? 'متأخر ' + a.late + ' د' : 'في الميعاد'];
    const otTag = (o) => K.Tag(o.status === 'مستني' ? 'orange' : o.status === 'اتضاف' ? 'success' : 'error', o.status === 'اتضاف' ? 'اتضاف ' + (o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(o.paid)) : o.status === 'مستني' ? 'مستني تأكيد' : o.status);
    const dToday = () => ({ title: 'النهارده — ' + who, sub: sh ? (sh.state === 'out' ? (sh.ended ? 'خلص الدوام النهارده' : 'خارج الدوام دلوقتي') : 'الدوام شغال من ' + sh.startLabel) : 'حالته النهارده: ' + HR().status(m)[0], summary: [{ label: 'الحالة', value: !sh ? HR().status(m)[0] : sh.state === 'out' ? (sh.ended ? 'خلص الدوام' : 'خارج الدوام') : sh.state === 'overtime' ? 'وقت إضافي' : 'في الدوام' }, { label: 'اشتغلت', value: sh && sh.state !== 'out' ? K.hm(sh.worked) + ' ساعة' : sh && sh.ended ? K.hm(sh.endedMin) + ' ساعة' : '—' }, { label: 'بداية الدوام', value: sh && sh.startLabel || '—' }], headers: [], rows: [], note: 'الساعات بتتحسب من «ابدأ الدوام» لحد «إنهاء الدوام» على ساعة السيرفر.', source: 'تسجيل الدوام' });
    const dMonth = () => ({ title: 'ساعات ' + mon + ' — ' + who, sub: att.length + ' يوم حضور', summary: [{ label: 'إجمالي الساعات', value: K.hm(worked) }, { label: 'أيام', value: String(att.length) }, { label: 'متوسط اليوم', value: done.length ? K.hm(worked / done.length) : '—' }], headers: ['اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الالتزام'], rows: att.map(attRow), source: 'سجل الحضور' });
    const dLate = () => ({ title: 'مرات التأخير — ' + who, sub: lates.length + ' مرة في ' + mon, summary: [{ label: 'مرات', value: String(lates.length) }, { label: 'إجمالي التأخير', value: lates.reduce((x, a) => x + a.late, 0) + ' د' }], headers: ['اليوم', 'الحضور', 'التأخير'], rows: lates.map((a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.hm(a.in), a.late + ' دقيقة']), empty: 'مفيش تأخير — ملتزم بالمواعيد.', source: 'سجل الحضور' });
    const dOt = () => ({ title: 'الوقت الإضافي — ' + who, sub: otOk.length + ' متأكد في ' + mon + ' · ' + otPend.length + ' مستني تأكيد', summary: [{ label: 'متأكد', value: K.hm(okMin) + ' ساعة' }, { label: 'مستني', value: String(otPend.length) }], headers: ['اليوم', 'المدة', 'المحسوب', 'اشتغلت على إيه', 'الحالة'], rows: ot.map((o) => [K.dshort(o.date), o.kind === 'rest_day' ? 'يوم راحة' : K.hrs(o.minutes), o.status === 'اتضاف' ? (o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(o.paid)) : '—', o.note || '—', o.status]), empty: 'مفيش وقت إضافي مسجّل.', note: 'الوقت الإضافي بيتحسب بس بعد ما المدير يأكده.', source: 'الوقت الإضافي' });
    const now = sh && sh.state !== 'out' ? K.hm(sh.worked) : sh && sh.ended ? K.hm(sh.endedMin) : '—';
    const btn = !sh ? null : sh.state === 'out' ? (sh.ended ? Button({ label: 'خلص الدوام النهارده', disabled: true }) : Button({ type: 'primary', label: 'ابدأ الدوام', icon: 'clock', onClick: () => window.IBShell.clockIn() })) : Button({ label: 'إنهاء الدوام', onClick: () => window.IBShell.endShift() });
    return [h('div', { class: 'cards' }, K.Stat('النهارده', now, '', sh ? (sh.state === 'out' ? (sh.ended ? 'خلص الدوام' : 'خارج الدوام') : 'من ' + sh.startLabel) : HR().status(m)[0], undefined, dToday), K.Stat('ساعات ' + mon, K.hm(worked), 'ساعة', att.length + ' يوم حضور', undefined, dMonth), K.Stat('مرات التأخير', lates.length, 'مرة', mon, undefined, dLate), K.Stat('وقت إضافي متأكد', K.hm(okMin), 'ساعة', otPend.length + ' مستني تأكيد', undefined, dOt)),
      btn ? h('div', { class: 'toolbar' }, btn) : null,
      K.Section('سجل الحضور — ' + monLabel(mk), att.length ? U.Table({ headers: ['اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الالتزام', 'وقت إضافي'], rows: att.map((a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.Num(K.hm(a.in)), a.out != null ? K.Num(K.hm(a.out)) : a.date === t ? K.Tag('success', 'لسه شغال') : K.Tag('error', 'ناقص'), a.out != null ? K.Num(K.hm(a.out - a.in)) : '—', a.late ? K.Tag('orange', 'متأخر ' + a.late + ' د') : K.Tag('success', 'في الميعاد'), a.ot ? K.Tag('gold', K.hrs(a.ot)) : '—']) }) : K.Empty('لسه مفيش حضور الشهر ده', isAdminView() ? '' : '«ابدأ الدوام» من فوق بيسجّل اليوم.')),
      ot.length ? K.Section('الوقت الإضافي', U.Table({ headers: ['اليوم', 'المدة', 'اشتغلت على إيه', 'الحالة'], rows: ot.map((o) => [K.dshort(o.date), o.kind === 'rest_day' ? 'يوم راحة' : K.hrs(o.minutes), h('span', { class: 'wrap' }, o.note || '—'), otTag(o)]) })) : null];
  }
  // ---------- طلباتي ----------
  // what waits for me: the pending requests and overtime of others that RLS shows me (my team; the server decides who may decide)
  function needFromMe() { const D = HD(); const isP = HR().isPending; return D.requests.filter((r) => r.member !== K.ME && isP(r)).map((r) => ({ kind: 'req', r })).concat(D.overtime.filter((o) => o.member !== K.ME && o.status === 'مستني').map((o) => ({ kind: 'ot', o }))); }
  function requests(m) {
    const D = HD(); const own = !isAdminView(); const isP = HR().isPending;
    const need = own ? needFromMe() : []; const canApprove = own && (need.length > 0 || can().edit || D.team.some((x) => x.manager === K.ME));
    if (!canApprove && st.reqSub === 'need') st.reqSub = 'mine';
    const mine = D.requests.filter((r) => r.member === m.id).sort((a, b) => (a.atIso < b.atIso ? 1 : -1));
    const subs = (canApprove ? [{ id: 'need', label: 'محتاجة منك', count: need.length }] : []).concat([{ id: 'mine', label: own ? 'طلباتي' : 'طلباته', count: mine.length }]);
    const files = own || can().edit; // filing for another member is hr.edit F's
    const out = [h('div', { class: 'toolbar' }, K.SubTabs({ items: subs, active: st.reqSub, onChange: (id) => { st.reqSub = id; rerender(); }, label: 'الطلبات' }), h('span', { class: 'grow' }), files ? Button({ label: 'طلب سُلفة', onClick: () => HR().advanceRequest(own ? null : m) }) : null, files ? Button({ type: 'primary', label: 'طلب إجازة', icon: 'plus', onClick: () => HR().leaveRequest(own ? null : m) }) : null)];
    if (st.reqSub === 'need') out.push(K.Section('محتاجة منك', need.length ? U.Table({ headers: ['العضو', 'الطلب', 'التفاصيل', 'اتقدم', ''], rows: need.map((x) => x.kind === 'req' ? [HM(x.r.member).name, x.r.type, HR().reqPeriod(x.r), x.r.at, h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'موافقة', onClick: () => HR().decide(x.r, 'موافق') }), Button({ size: 'sm', label: 'رفض', onClick: () => HR().rejectReq(x.r) }), Button({ type: 'text', size: 'sm', label: 'التفاصيل', onClick: () => HR().reqDetails(x.r) }))]
      : [HM(x.o.member).name, x.o.kind === 'rest_day' ? 'شغل يوم راحة' : 'وقت إضافي', (x.o.kind === 'rest_day' ? 'يوم × 2' : K.hrs(x.o.minutes)) + (x.o.note ? ' · ' + x.o.note : ''), K.dshort(x.o.date) + (x.o.waitedHours >= 24 ? ' (اتصعّد)' : ''), h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'ضيفه', onClick: () => HR().otAdd(x.o) }), Button({ size: 'sm', label: 'متضيفهوش', onClick: () => HR().otReject(x.o) }))]) }) : K.Empty('مفيش حاجة مستنياك', 'كل طلبات الفريق اتردّ عليها.'), null, { sub: 'طلبات الإجازة والسُلف والوقت الإضافي لفريقك' }));
    else out.push(K.Section('', mine.length ? U.Table({ headers: ['رقم', 'النوع', 'التفاصيل', 'اتقدم', 'الحالة', ''], rows: mine.map((r) => [K.Num(r.id), r.type, HR().reqPeriod(r), r.at, K.Tag(isP(r) ? 'orange' : r.status === 'موافق' ? 'success' : r.status === 'اتلغى' ? 'neutral' : 'error', r.status + (r.reason ? ' — ' + r.reason : '')), own && isP(r) ? Button({ type: 'text', size: 'sm', label: 'إلغاء الطلب', onClick: () => HR().cancelReq(r) }) : '']) }) : K.Empty('مفيش طلبات', own ? 'قدّم طلب إجازة أو سُلفة من الأزرار فوق.' : '')));
    return out;
  }
  // ---------- أدائي (by the quarter picked; the scores the manager rated, the KPIs set in HR) ----------
  function performance(m) {
    const D = HD(); const sc = D.scores[m.id] || {}; const kpis = D.kpis[m.id] || [];
    if (!kpis.length && !Object.keys(sc).length) return [K.Section('', K.Empty('لسه مفيش تقييم', 'المؤشرات بتتحط من «الموارد البشرية › الأداء والـ KPI»، والتقييم كل شهر.'))];
    const cur = qOf(thisMonth()); const quarters = [...new Set([cur].concat(Object.keys(sc).map(qOf)))].sort().reverse();
    const q = st.perfQ && quarters.includes(st.perfQ) ? st.perfQ : cur; const months = qMonths(q);
    const rated = months.filter((k) => sc[k] != null); const vals = rated.map((k) => sc[k]); const last = rated.length ? rated[rated.length - 1] : null; const lv = last ? sc[last] : null;
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
    const money = seesMoney(m); const hb = m.holdback || 0;
    const qRows = () => months.map((k) => [monName(k), sc[k] != null ? sc[k] + '%' : 'لسه', sc[k] != null ? O.rating(sc[k]) : '—', money ? (sc[k] != null ? K.money(O.monthBonus(hb, sc[k])) + ' ج.م' : '—') : '••••']);
    const qHead = ['الشهر', 'السكور', 'التقييم', 'الحافز المستحق'];
    const kpiRows = () => kpis.map((k) => [k.name, k.src || 'يدوي', k.weight + '%', K.Num(String(k.target)) ]);
    const dScore = () => ({ title: 'سكور ' + monName(last) + ' — ' + m.name, sub: 'التقييم: ' + O.rating(lv) + ' · ممتاز ≥ 100% · جيد 85–99% · محتاج تحسين 70–84% · إنذار < 70%', summary: [{ label: 'السكور', value: lv + '%' }, { label: 'التقييم', value: O.rating(lv) }], headers: ['المؤشر', 'المصدر', 'الوزن', 'الهدف'], rows: kpiRows(), note: 'السكور = مجموع المؤشرات بأوزانها، والمدير بيقيّم الشهر بالفعلي.', source: 'مؤشرات الأداء' });
    const dAvg = () => ({ title: 'متوسط ' + qLabel(q) + ' — ' + m.name, sub: vals.length ? (O.quarterBad(vals) ? 'ربع سيئ (متوسط < 70% أو شهرين تحت 70%) — في ميتنج فردي' : 'الربع تمام') : 'لسه مفيش شهور متقيّمة', summary: vals.length ? [{ label: 'المتوسط', value: avg + '%' }, { label: 'أعلى شهر', value: Math.max(...vals) + '%' }, { label: 'أقل شهر', value: Math.min(...vals) + '%' }] : [], headers: qHead, rows: qRows(), source: 'التقييم الشهري' });
    const dQb = () => ({ title: 'بونص ' + qLabel(q) + ' — ' + m.name, sub: 'الحافز المحجوز ' + K.money(hb) + ' ج.م كل شهر — بيتصرف بنسبة السكور (بحد أقصى 100%)، والشهر اللي تحت 70% حافزه 0', summary: [{ label: 'البونص', value: K.money(O.quarterBonus(hb, vals)) + ' ج.م' }, { label: 'من المحجوز', value: K.money(hb * 3) + ' ج.م' }], headers: qHead, rows: qRows(), note: vals.length < 3 ? 'بالشهور اللي اتقيّمت لحد دلوقتي.' : '', source: 'التقييم الشهري + الحافز المحجوز' });
    const dMb = () => ({ title: 'حافز ' + monName(last) + ' — ' + m.name, sub: 'بيتصرف مع حافز الربع', summary: [{ label: 'الحافز', value: K.money(O.monthBonus(hb, lv)) + ' ج.م' }, { label: 'المحجوز', value: K.money(hb) + ' ج.م' }, { label: 'السكور', value: lv + '%' }], headers: ['البند', 'القيمة'], rows: [['الحافز المحجوز', K.money(hb) + ' ج.م'], ['سكور ' + monName(last), lv + '%'], ['النسبة المحسوبة', Math.min(lv, 100) + '%' + (lv < 70 ? ' (تحت 70% = 0)' : '')], ['الحافز المستحق', K.money(O.monthBonus(hb, lv)) + ' ج.م']], source: 'التقييم الشهري' });
    const pickQ = U.Select({ id: 'pf-q', label: '', options: quarters.map((x) => ({ value: x, label: qLabel(x) })), value: q, onChange: (v) => { st.perfQ = v; rerender(); } });
    return [h('div', { class: 'toolbar' }, pickQ),
      h('div', { class: 'cards' }, K.Stat('سكور ' + (last ? monName(last) : 'الشهر'), lv != null ? lv + '%' : '—', '', lv != null ? O.rating(lv) : 'لسه مااتقيّمش', undefined, last ? dScore : undefined), K.Stat('متوسط ' + qShort(q), avg != null ? avg + '%' : '—', '', vals.length ? (O.quarterBad(vals) ? 'ربع سيئ — في ميتنج' : 'تمام') : 'لسه', undefined, dAvg), K.Stat('بونص ' + qShort(q), money ? K.money(O.quarterBonus(hb, vals)) : '••••', 'ج.م', money ? 'من ' + K.money(hb * 3) : 'للأدمن بس', undefined, money ? dQb : undefined), K.Stat('حافز ' + (last ? monName(last) : 'الشهر'), money && lv != null ? K.money(O.monthBonus(hb, lv)) : '—', 'ج.م', 'بيتصرف مع حافز الربع', undefined, money && last ? dMb : undefined)),
      K.Section('التقييم الشهري — ' + qLabel(q), h('div', { class: 'cols' }, months.map((k) => h('div', { class: 'col' + (k === last ? ' hi' : '') }, h('span', { class: 't-label' }, sc[k] != null ? sc[k] + '%' : '—'), h('i', { style: 'height:' + (sc[k] != null ? Math.round(Math.min(sc[k], 120) * 1.4) : 4) + 'px' }), sc[k] != null ? K.Tag(O.RATING_TONE[O.rating(sc[k])], O.rating(sc[k])) : K.Tag('neutral', 'لسه'), h('span', { class: 't-small' }, monName(k))))), null, { sub: 'ممتاز ≥ 100% · جيد 85–99% · محتاج تحسين 70–84% · إنذار < 70% (حافز الشهر = 0)' }),
      K.Section('المؤشرات', kpis.length ? U.Table({ headers: ['المؤشر', 'المصدر', 'الوزن', 'الهدف'], rows: kpis.map((k) => [k.name, k.src || 'يدوي', k.weight + '%', K.Num(String(k.target)) + (k.inverse ? ' (الأقل أحسن)' : '')]) }) : K.Empty('لسه مفيش مؤشرات', 'بتتحط من «الموارد البشرية › الأداء والـ KPI».'), null, { sub: 'المدير بيقيّم كل شهر بالفعلي' })];
  }
  function achievements(m) { const a = achievementsOf(m.id).slice().sort((x, y) => (x.month < y.month ? 1 : -1)); const money = seesMoney(m); return [K.Section('الإنجازات والمكافآت', a.length ? U.Table({ headers: ['الإنجاز', 'المكافأة', 'الشهر', 'الحالة'], rows: a.map((x) => [x.title, money ? K.Num(K.money(x.amount) + ' ج.م') : '••••', monLabel(x.month), K.Tag(x.status === 'اتصرفت' ? 'success' : 'info', x.status)]) }) : K.Empty('لسه مفيش إنجازات مسجلة', 'المكافأة بتتضاف لما الأدمن يسجل إنجاز.'))]; }
  // ---------- مرتبي (decision 2: my own payslips once the sheet is approved; another member's for sensitive.salaries) ----------
  function salary(m) {
    if (!seesMoney(m)) return [K.Section('', K.Empty('المرتبات للأدمن بس', 'كل عضو بيشوف قسيمته هو بس في «ملفي».'))];
    if (!(m.salary > 0)) return [K.Section('', K.Empty('مفيش مرتب مسجل', 'المرتب بيتسجل من الموارد البشرية.'))];
    const C = slipsOf(m); const list = C.list; const p = list[0] || null; const show = st.showPay || isAdminView(); const v = (n) => (show ? K.money(n) : '••••'); const rt = O.rates(m.salary); const mk = thisMonth();
    const stTag = (s) => K.Tag(s === 'مدفوع' ? 'success' : s === 'معتمد' ? 'info' : 'orange', s === 'مدفوع' ? 'اتصرف' : s === 'معتمد' ? 'اتعتمد' : s);
    const dNet = () => ({ title: 'صافي ' + monName(p.month) + ' — ' + m.name, sub: 'القسيمة: ' + (p.status === 'مدفوع' ? 'اتصرفت' : 'اتعتمدت') + (show ? '' : ' · المبالغ مخفية — اضغط «إظهار»'), summary: [{ label: 'الصافي', value: v(p.net) + ' ج.م' }], headers: ['البند', 'المبلغ'], rows: [['المرتب بعد الحافز المحجوز', v(p.paid)], ['وقت إضافي (' + K.hrs(p.otMin) + ')', v(p.otPay)], ['أيام راحة اشتغلها (' + p.rest + ')', v(p.restPay)], ['بدلات ومكافآت', v(p.allow)], ['خصومات', p.ded ? '−' + v(p.ded) : v(0)], ['سُلف', p.advance ? '−' + v(p.advance) : v(0)], ['إجازة بدون أجر', p.unpaidCut ? '−' + v(p.unpaidCut) : v(0)], ['حافز الربع', v(p.quarterBonus)], ['الصافي', v(p.net)]], source: 'كشف مرتبات ' + monLabel(p.month) });
    const qm = qMonths(qOf(mk));
    const dHold = () => ({ title: 'الحافز المحجوز — ' + m.name, sub: 'بيتحجز كل شهر وبيتصرف آخر الربع بنسبة السكور', summary: [{ label: 'محجوز الشهر', value: v(m.holdback) + ' ج.م' }, { label: 'محجوز ' + qShort(qOf(mk)), value: v(m.holdback * 3) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: qm.map((k) => [monName(k), v(m.holdback) + (k < mk ? ' — اتحجز' : k === mk ? ' — بيتحدد بتقييم ' + monName(k) : ' — لسه')]).concat([['ميعاد الصرف', monLabel(qm[2]) + ' مع حافز الربع']]), note: 'الشهر اللي سكوره أقل من 70% حافزه 0.', source: 'سياسة الحوافز' });
    const otNow = Math.round((m.otMonth || 0) / 60 * rt.hourly);
    const rows = list.map((s) => [monLabel(s.month), K.Num(v(s.net)), stTag(s.status), Button({ type: 'text', size: 'sm', label: 'عرض', disabled: !show, onClick: () => HR().slipModal(s, s.month, s.status) })]);
    const open = isAdminView() && can().salaries && !list.some((s) => s.month === mk) ? [[monLabel(mk) + ' (الشهر المفتوح)', '—', stTag((HD().sheets[mk] || {}).status || 'مسودة'), Button({ type: 'text', size: 'sm', label: 'عرض', onClick: () => HR().payslipModal(m) })]] : [];
    return [h('div', { class: 'toolbar' }, !isAdminView() ? Button({ label: show ? 'إخفاء المبالغ' : 'إظهار', attrs: { 'aria-pressed': String(show) }, onClick: () => { st.showPay = !st.showPay; rerender(); } }) : null),
      // details respect «إظهار»: amounts stay masked (••••) until shown.
      h('div', { class: 'cards' }, K.Stat(p ? 'صافي ' + monName(p.month) : 'آخر قسيمة', p ? v(p.net) : '—', p ? 'ج.م' : '', p ? (p.status === 'مدفوع' ? 'اتصرف' : 'اتعتمد — لسه ما اتصرفش') : C.status === 'loading' ? 'بيحمّل…' : 'بتظهر بعد اعتماد الكشف', undefined, p ? dNet : undefined),
        K.Stat('الحافز المحجوز الشهر ده', v(m.holdback), 'ج.م', 'بيتحدد بتقييم ' + monName(mk) + ' · يتصرف ' + monName(qm[2]), undefined, dHold),
        K.Stat('اليومية', v(rt.daily), 'ج.م', undefined, undefined, () => ({ title: 'اليومية — ' + m.name, summary: [{ label: 'اليومية', value: v(rt.daily) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: [['المرتب الأساسي', v(m.salary)], ['أيام الشغل في الشهر', String(O.HR.workDays)], ['اليومية = المرتب ÷ أيام الشغل', v(rt.daily)], ['يوم راحة اشتغلته', v(O.overtimePay(m.salary, { offDays: 1 })) + ' (يومية × 2)']], source: 'إعدادات الموارد البشرية' })),
        K.Stat('سعر الساعة', v(rt.hourly), 'ج.م', 'نفس سعر الوقت الإضافي', undefined, () => ({ title: 'سعر الساعة — ' + m.name, summary: [{ label: 'سعر الساعة', value: v(rt.hourly) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: [['اليومية', v(rt.daily)], ['ساعات الوردية', String(O.HR.shiftHours)], ['سعر الساعة = اليومية ÷ ساعات الوردية', v(rt.hourly)], ['الوقت الإضافي المتأكد الشهر ده', K.hrs(m.otMonth || 0) + ' = ' + v(otNow)]], source: 'إعدادات الموارد البشرية' }))),
      C.status === 'error' ? U.InlineNote({ kind: 'error', children: 'معرفناش نجيب القسايم — جرّب تاني كمان شوية.' }) : null,
      K.Section('القسايم', rows.length || open.length ? U.Table({ headers: ['الشهر', 'الصافي', 'الحالة', ''], rows: open.concat(rows) }) : K.Empty(C.status === 'loading' ? 'بيحمّل القسايم…' : 'لسه مفيش قسايم', 'القسيمة بتظهر هنا بعد ما كشف الشهر يتعتمد.'))];
  }
  // ---------- العقود والمستندات (the member's documents in «hr-docs»: hr.edit F uploads, the member reads their own) ----------
  function docs(m) {
    const edit = can().edit; const list = (m.docs || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1)); const contract = list.find((d) => d.kind === 'عقد عمل') || null;
    const openDoc = (d) => { if (!d) return; IH().fileUrl(d.path).then((u) => { if (!u) { K.toast('معرفناش نفتح الملف — جرّب تاني', 'error'); return; } window.open(u, '_blank', 'noopener'); }); };
    const sub = !contract ? 'لسه ما اترفعش' : m.contractEnd ? (m.contract === 'expiring' ? 'بيخلص ' : 'ساري لحد ') + K.dlabel(m.contractEnd) : 'اترفع ' + K.dlabel(String(contract.at || '').slice(0, 10));
    const others = list.filter((d) => d !== contract);
    return [K.Section('العقود والمستندات', [U.ContractCard({ status: m.contract || 'missing', title: 'عقد العمل', sub, canManage: edit, onView: () => openDoc(contract), onDownload: () => openDoc(contract), onUpload: () => HR().uploadContract(m), onTemplate: () => K.toast('قالب العقد لسه مااترفعش — اطلبه من الأدمن', 'info') }),
      others.length ? U.Table({ headers: ['المستند', 'الملف', 'من', 'لحد', ''], rows: others.map((d) => [d.kind, h('span', { class: 'wrap' }, d.name), d.start ? K.dshort(d.start) : '—', d.end ? K.dshort(d.end) : '—', Button({ type: 'text', size: 'sm', label: 'عرض', onClick: () => openDoc(d) })]) }) : h('div', { class: 't-small help' }, 'مفيش مستندات تانية.')], edit ? [Button({ label: 'رفع مستند', icon: 'attach', onClick: () => HR().uploadContract(m) })] : null)];
  }
  // ---------- الحساب والأمان ----------
  function security(m) {
    const ad = isAdminView();
    return [K.Section('بيانات الدخول', K.Kv([['الإيميل', m.email || '—'], ['الموبايل', m.phone ? h('span', { dir: 'ltr' }, m.phone) : '—']]), ad ? null : [Button({ label: 'تعديل بياناتي', onClick: () => editInfo(m) }), Button({ type: 'primary', label: 'تغيير كلمة المرور', onClick: () => changePassword() })]),
      K.Section('التحقق بخطوتين', [h('div', { class: 'set-row' }, h('div', null, h('b', null, m.twofa ? 'مفعّل — تطبيق Authenticator' : 'مش مفعّل'), h('div', { class: 't-small help' }, ad ? 'العضو بيفعّله أو يوقفه من ملفه' : 'اختياري للكل · تطبيق Authenticator (واتساب وإيميل ' + SOON_2FA + ')')), ad ? null : m.twofa ? Button({ label: 'إيقاف', onClick: () => K.confirm({ title: 'إيقاف التحقق بخطوتين', text: 'حسابك هيبقى محمي بكلمة المرور بس.', okType: 'danger', okLabel: 'إيقاف', onOk: disable2fa }) }) : Button({ type: 'primary', label: 'تفعيل', onClick: () => enable2fa(m) }))]),
      ad ? null : K.Section('الأجهزة', h('p', { class: 't-small help', style: 'margin:0' }, 'لو حاسس إن حد تاني داخل بحسابك: غيّر كلمة المرور أو اعمل خروج من كل الأجهزة — الجهاز ده بيفضل داخل.'), [Button({ label: 'خروج من كل الأجهزة', onClick: () => window.IBShell.signOutAll() })])];
  }
  function prefs() {
    const p = st.prefs; const save = (k) => (v) => { p[k] = v; K.toast('اتحفظ'); rerender(); };
    return [K.Section('التفضيلات', [U.Select({ id: 'pf-land', label: 'الصفحة اللي تفتح أول ما أدخل', options: ['الأوردرات', 'ملفي', 'خدمة العملاء', 'تذاكر الفريق', 'المخزن'].map((x) => ({ value: x, label: x })), value: p.landing, onChange: save('landing') }), U.Select({ id: 'pf-den', label: 'كثافة الجداول', options: ['مضغوط', 'مريح'].map((x) => ({ value: x, label: x })), value: p.density, onChange: save('density') }),
      K.Switch({ id: 'pf-sound', label: 'صوت للتنبيهات العاجلة', checked: p.sound, onChange: save('sound') }), K.Switch({ id: 'pf-dig', label: 'ملخص يومي على الإيميل', help: 'الساعة 9 الصبح', checked: p.digest, onChange: save('digest') }), K.Switch({ id: 'pf-wa', label: 'تنبيهات واتساب', help: 'للعاجل بس', checked: p.whatsapp, onChange: save('whatsapp') })])];
  }

  // ---------- popups ----------
  // «تعديل بياناتي» (the owner 5 Nov: «دلوقتي»): the mobile on my profile (IBDirectory.updatePhone — taken = refused), the email
  // through Supabase's confirmation link (IBAuth.changeEmail; the profile follows once it is confirmed — 0047). Neither is logged.
  const INFO_MSG = { taken: 'الرقم ده مسجّل لعضو تاني', invalid: 'رقم موبايل مصري صحيح', forbidden: 'مش مسموح تغيّر الرقم ده', network: 'مشكلة في الاتصال — جرّب تاني', server: 'معرفناش نحفظ الموبايل — جرّب تاني' };
  const MAIL_MSG = { taken: 'الإيميل ده مستخدم لحساب تاني', invalid: 'إيميل صحيح', same: 'ده نفس إيميلك', rate_limited: 'محاولات كتير — استنى شوية وجرّب تاني', network: 'مشكلة في الاتصال — جرّب تاني', server: 'معرفناش نبعت لينك التأكيد — جرّب تاني' };
  function editInfo(m) {
    K.form({ title: 'تعديل بياناتي', values: { phone: m.phone, email: m.email }, fields: (f, e, set) => [K.field.text('phone', 'الموبايل', f, e, set, { required: true, inputmode: 'tel' }), K.field.text('email', 'الإيميل', f, e, set, { required: true, help: 'تغيير الإيميل محتاج تأكيد من اللينك اللي هيوصلك' })],
      validate: (f) => { const e = {}; if (O.identifierKind(f.phone) !== 'phone') e.phone = 'رقم موبايل مصري صحيح'; if (O.identifierKind(f.email) !== 'email') e.email = 'إيميل صحيح'; return e; },
      submitLabel: 'حفظ', submit: (f, md) => {
        if (md._busy) return false; md._busy = true;
        (async () => {
          const out = { phone: false, email: '' }; const phone = O.toLatin(String(f.phone || '')).trim(); const email = String(f.email || '').trim().toLowerCase();
          if (phone !== String(m.phone || '')) { const r = await window.IBDirectory.updatePhone(phone); if (!r.ok) return { ok: false, message: INFO_MSG[r.reason], out }; out.phone = !r.same; }
          if (email !== String(m.email || '').toLowerCase()) { const r = await window.IBAuth.changeEmail(email); if (!r.ok) return { ok: false, message: MAIL_MSG[r.reason], out }; out.email = email; }
          return { ok: true, out };
        })().then((r) => {
          md._busy = false; const o = r.out;
          if (o.phone || o.email) K.logEvent('profile.edit', m.name);
          if (!r.ok) { K.toast((o.phone ? 'اتحفظ الموبايل · ' : '') + (r.message || 'حصلت مشكلة — جرّب تاني'), 'error'); if (o.phone) rerender(); return; }
          md.close(); K.toast(o.email ? 'اتبعت لينك تأكيد على ' + o.email + ' — الإيميل بيتغيّر بعد ما تضغطه' + (o.phone ? ' · واتحفظ الموبايل' : '') : o.phone ? 'اتحفظ الموبايل' : 'مفيش حاجة اتغيّرت', o.phone || o.email ? 'success' : undefined); rerender();
        });
        return false;
      } });
  }
  // the job and the pay (phase 10 T7): the shift, the hire date and the leave days through IBHR.memberUpdate (hr.edit F), the pay through
  // IBHR.payUpdate (sensitive.salaries F) — each part only for who may write it; the title and the role stay the settings page's
  function editJob(m) {
    const c = can(); const time = /^\d{1,2}:\d{2}$/;
    K.form({ title: 'تعديل الوظيفة والمرتب — ' + m.name, values: { salary: String(m.salary || 0), holdback: String(m.holdback || 0), allow: String(m.allow || 0), s0: m.shift[0], s1: m.shift[1], hire: m.hire || '', leave: String(m.leave == null ? 21 : m.leave) },
      fields: (f, e, set) => [c.salaries ? K.two(K.field.text('salary', 'المرتب', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), K.field.text('holdback', 'الحجز للبونص', f, e, set, { inputmode: 'decimal', suffix: 'ج.م' })) : null,
        c.salaries ? K.field.text('allow', 'البدلات الثابتة', f, e, set, { inputmode: 'decimal', suffix: 'ج.م' }) : null,
        c.edit ? K.two(K.field.text('s0', 'بداية الشيفت', f, e, set, { required: true, placeholder: '09:00' }), K.field.text('s1', 'نهاية الشيفت', f, e, set, { required: true, placeholder: '17:00' })) : null,
        c.edit ? K.two(K.field.date('hire', 'تاريخ التعيين', f, e, set), K.field.text('leave', 'أيام الإجازة السنوية', f, e, set, { inputmode: 'numeric' })) : null,
        U.InlineNote({ children: (c.salaries ? 'المرتب الجديد بيدخل كشف الشهر المفتوح. ' : '') + 'الوظيفة والدور بيتغيروا من صفحة الإعدادات.' })],
      validate: (f) => { const e = {};
        if (c.salaries) { if (f.salary === '' || !(Number(f.salary) >= 0)) e.salary = 'اكتب المرتب'; if (f.holdback !== '' && !(Number(f.holdback) >= 0)) e.holdback = 'رقم صحيح'; else if (Number(f.holdback) > Number(f.salary)) e.holdback = 'الحجز لازم أقل من المرتب'; if (f.allow !== '' && !(Number(f.allow) >= 0)) e.allow = 'رقم صحيح'; }
        if (c.edit) { if (!time.test(f.s0 || '')) e.s0 = 'اكتب الوقت كده 09:00'; if (!time.test(f.s1 || '')) e.s1 = 'اكتب الوقت كده 17:00'; if (f.leave !== '' && !(Number.isInteger(Number(f.leave)) && Number(f.leave) >= 0 && Number(f.leave) <= 60)) e.leave = 'من 0 لـ 60 يوم'; }
        return e; },
      submitLabel: 'حفظ', submit: (f, md) => {
        if (md._busy) return false; md._busy = true;
        (async () => {
          if (c.edit) { const r = await IH().memberUpdate(m.id, { shift: [f.s0.padStart(5, '0'), f.s1.padStart(5, '0')], hire: f.hire || null, leave: f.leave === '' ? undefined : Number(f.leave) }); if (!r.ok) return r; }
          if (c.salaries) { const r = await IH().payUpdate(m.id, { salary: Number(f.salary), holdback: Number(f.holdback) || 0, allow: Number(f.allow) || 0 }); if (!r.ok) return r; }
          return { ok: true };
        })().then((r) => { md._busy = false; if (r.ok) { md.close(); K.toast('اتحفظ', 'success'); } else K.toast(r.message || 'حصلت مشكلة — جرّب تاني', 'error'); });
        return false;
      } });
  }
  // «تغيير كلمة المرور» (decision 6: the member replaces the temporary password): IBAuth.changePassword checks the current one first
  const PW_MSG = { current: 'كلمة المرور الحالية غلط', same: 'كلمة المرور الجديدة لازم تختلف عن الحالية', weak: 'كلمة المرور دي ضعيفة — خليها أطول وفيها حروف وأرقام', rate_limited: 'محاولات كتير — استنى شوية وجرّب تاني', network: 'مشكلة في الاتصال — جرّب تاني' };
  function changePassword() {
    K.form({ title: 'تغيير كلمة المرور', values: {}, fields: (f, e, set) => [K.field.text('cur', 'كلمة المرور الحالية', f, e, set, { required: true }), K.field.text('p1', 'كلمة المرور الجديدة', f, e, set, { required: true, help: '8 حروف على الأقل فيها حرف ورقم' }), K.field.text('p2', 'أكّد كلمة المرور', f, e, set, { required: true })],
      validate: (f) => { const e = K.req(f, ['cur']); const p = O.validatePassword(f.p1 || '', f.p2 || ''); if (p) e[p.includes('مش زي') ? 'p2' : 'p1'] = p; return e; },
      submitLabel: 'تغيير', submit: (f, md) => {
        if (md._busy) return false; md._busy = true;
        window.IBAuth.changePassword(f.cur, f.p1).then((r) => { md._busy = false;
          if (r.ok) { md.close(); K.logEvent('profile.password', K.member(K.ME).name); K.toast('اتغيرت كلمة المرور — الأجهزة التانية هتخرج', 'success'); } else K.toast(PW_MSG[r.reason] || 'معرفناش نغيّرها — جرّب تاني', 'error'); });
        return false;
      } });
    setTimeout(() => document.querySelectorAll('.modal-b input').forEach((i) => { i.type = 'password'; i.autocomplete = i.id === 'cur' ? 'current-password' : 'new-password'; }));
  }
  // التحقق بخطوتين (phase 2 Task 7, decision): the Authenticator app is the only live channel (واتساب / إيميل wait for the WhatsApp
  // bridge). 1 channel → 2 QR + key (IBAuth.enrollTotp) → 3 the first 6-digit code (IBAuth.verifyEnroll) → done. m.twofa is the
  // directory's copy of the server's profiles.twofa (IBAuth updates it); this dialog never sets it.
  const SOON_2FA = 'بعد تشغيل جسر واتساب';
  const RECOVERY_2FA = 'لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية';
  const netMsg = (r) => (r.reason === 'network' ? 'مشكلة في الاتصال — جرّب تاني' : 'معرفناش نكمّل من السيرفر — جرّب تاني');
  function enable2fa(m) {
    let step = 1; let code = ''; let err = ''; let busy = false; let f = null;
    const md = U.Modal({ title: 'تفعيل التحقق بخطوتين', body: [], onClose: () => { if (step === 4) rerender(); } });
    const opt = (label, hint, on) => h('button', { type: 'button', role: 'radio', class: 'radio', 'aria-checked': String(on), disabled: !on }, h('i'), h('span', null, label), h('small', { class: 't-small help' }, hint));
    const channels = () => h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'هيوصلك الكود فين'), h('div', { class: 'radios', role: 'radiogroup', 'aria-label': 'هيوصلك الكود فين' },
      opt('واتساب على ' + m.phone, SOON_2FA, false), opt('إيميل على ' + m.email, SOON_2FA, false), opt('تطبيق Authenticator', 'Google Authenticator أو Microsoft Authenticator أو أي تطبيق زيهم', true)));
    // the QR only as a data:image URI from Supabase; the key as plain text (both are set through the DOM, never as markup)
    const qr = () => (f && /^data:image\//.test(f.qr) ? h('img', { src: f.qr, alt: 'كود QR لتطبيق Authenticator', width: 180, height: 180, style: 'display:block;margin:8px auto;background:#fff;padding:8px;border-radius:8px' }) : null);
    const copyKey = () => { try { navigator.clipboard.writeText(f.secret).then(() => K.toast('اتنسخ المفتاح'), () => K.toast('حدد المفتاح وانسخه')); } catch (e) { K.toast('حدد المفتاح وانسخه'); } };
    const note = () => (err ? U.InlineNote({ kind: 'error', children: err }) : null);
    async function start() {
      if (busy) return; busy = true; err = ''; draw();
      const r = await window.IBAuth.enrollTotp(); busy = false;
      if (!r.ok) { err = netMsg(r); return draw(); }
      f = r; step = 2; draw();
    }
    async function confirmCode() {
      if (busy) return; busy = true; err = ''; draw();
      const r = await window.IBAuth.verifyEnroll(f.factorId, code); busy = false;
      if (r.ok) { step = 4; return draw(); }
      code = '';
      if (r.reason === 'code') err = 'الكود غلط — جرّب تاني';
      else if (r.reason === 'server') { err = 'السيرفر ماأكدش التفعيل — ابدأ من الأول'; step = 1; f = null; } // the factor was removed again
      else err = netMsg(r);
      draw();
    }
    const draw = () => {
      md.setBody(...[note()].concat(step === 1 ? [channels()]
        : step === 2 ? [h('p', { style: 'margin:0' }, 'افتح التطبيق وامسح الكود ده. لو مش عارف تمسحه، اكتب المفتاح بإيدك:'), qr(), h('div', { class: 'codes', dir: 'ltr' }, h('code', { style: 'user-select:all;word-break:break-all' }, f.secret))]
          : step === 3 ? [h('p', { style: 'margin:0' }, 'اكتب الـ 6 أرقام اللي ظاهرة في التطبيق دلوقتي.'), U.TextInput({ id: 'tfa-code', label: 'الكود', value: code, inputmode: 'numeric', maxlength: 6, onInput: (v) => { code = v; } })]
            : [U.InlineNote({ kind: 'success', children: 'اتفعّل التحقق بخطوتين. من المرة الجاية هنطلب الكود بعد كلمة المرور.' }), h('p', { class: 't-small', style: 'margin:0' }, RECOVERY_2FA)]).filter(Boolean));
      const cancel = Button({ label: 'إلغاء', onClick: () => md.close() });
      md.setFooter(...(step === 1 ? [cancel, Button({ type: 'primary', label: 'كمّل', disabled: busy, onClick: start })]
        : step === 2 ? [Button({ label: 'نسخ المفتاح', icon: 'copy', onClick: copyKey }), cancel, Button({ type: 'primary', label: 'كمّل', onClick: () => { step = 3; err = ''; draw(); } })]
          : step === 3 ? [Button({ label: 'رجوع', onClick: () => { step = 2; err = ''; draw(); } }), cancel, Button({ type: 'primary', label: 'تأكيد', disabled: busy, onClick: confirmCode })]
            : [Button({ type: 'primary', label: 'خلصت', onClick: () => md.close() })]));
      if (step === 3) setTimeout(() => { const i = md.el.querySelector('#tfa-code'); if (i) i.focus(); });
    };
    draw();
  }
  // «إيقاف»: only on a session signed in with the code (aal2); IBAuth clears the server flag, then the factor
  async function disable2fa() {
    const r = await window.IBAuth.unenrollTotp();
    if (!r.ok) return K.toast(r.reason === 'aal1' ? 'سجّل دخول بالكود الأول' : netMsg(r), 'error');
    K.toast('اتوقف التحقق بخطوتين', 'success'); rerender();
  }

  window.IBPages.register('profile', { title: 'ملفي', hash: (hs) => { let m = /^profile(?:-([a-z]+))?$/.exec(hs); if (m) { st.who = K.ME; st.tab = m[1] && TABS.some((t) => t[0] === m[1]) ? m[1] : 'overview'; if (m[1] === 'requests' && K.member(K.ME).role === 'أدمن') st.reqSub = 'need'; return true; } m = /^member-(M\d{2,4})$/.exec(hs); if (m && (S.members.some((x) => x.id === m[1]) || (window.IBHR && window.IBHR.member(m[1])))) { if (st.who !== m[1]) st.tab = 'overview'; st.who = m[1] === K.ME ? K.ME : m[1]; return true; } return false; },
    defaultHash: () => (isAdminView() ? 'member-' + st.who : 'profile' + (st.tab === 'overview' ? '' : '-' + st.tab)), view, navPage: () => (isAdminView() ? 'hr' : null),
    api: { autoTasks: () => { const m = HM(K.ME); return m && m.id ? autoOf(m) : []; } } });
})();

