
/* Profile «ملفي» — Figma page 382:12596. 10 tabs. Admin opening a member (#member-Mxx) sees the SAME page + admin-only beige cards. */
(function () {
  'use strict';
  const U = window.IBUI, O = window.IbtekrOps, K = window.IBKit;
  const { h, Icon, Button } = U; const S = K.store;
  const TABS = [['overview', 'نظرة عامة'], ['tasks', 'مهامي'], ['hours', 'ساعات العمل'], ['requests', 'طلباتي'], ['performance', 'أدائي'], ['achievements', 'إنجازاتي'], ['salary', 'مرتبي'], ['docs', 'العقود والمستندات'], ['security', 'الحساب والأمان'], ['alerts', 'تنبيهاتي'], ['prefs', 'التفضيلات']];
  const st = { tab: 'overview', who: K.ME, taskSub: 'today', reqSub: 'mine', showPay: false, newTask: '', prefs: { landing: 'الأوردرات', sound: true, digest: true, whatsapp: false, density: 'مضغوط' }, notes: {} };
  const rerender = () => window.IBPages.render('profile');
  const isAdminView = () => st.who !== K.ME;
  const HR = () => window.IBPages.all().hr.api;
  const label = (id) => (isAdminView() ? { tasks: 'المهام', requests: 'الطلبات', performance: 'الأداء', achievements: 'الإنجازات', salary: 'المرتب' }[id] : null) || TABS.find((t) => t[0] === id)[1];

  function view() {
    const m = K.member(st.who); const ad = isAdminView();
    const sh = window.IBShell ? window.IBShell.state() : { state: 'out' };
    const head = h('div', { class: 'card prof-head' }, h('span', { class: 'avatar xl', 'aria-hidden': 'true' }, m.name.charAt(0)),
      h('div', { class: 'grow' }, h('h1', { class: 't-h3' }, m.name), h('div', { class: 't-small help' }, m.title + ' · ' + m.dept + (m.manager ? ' · المدير المباشر: ' + K.member(m.manager).name : '')), h('div', { class: 'acts-inline' }, K.Tag('brand', m.role), m.status === 'suspended' ? K.Tag('error', 'موقوف') : K.Tag('success', 'نشط'), !ad ? K.Tag(sh.state === 'out' ? 'neutral' : sh.state === 'overtime' ? 'orange' : 'success', sh.state === 'out' ? 'خارج الدوام' : sh.state === 'overtime' ? 'وقت إضافي' : 'على الدوام') : K.Tag(HR().status(m)[1], HR().status(m)[0]))),
      h('div', { class: 'acts-inline' }, ad ? Button({ label: 'رجوع للفريق', onClick: () => { location.hash = 'hr-team'; } }) : Button({ label: 'تعديل بياناتي', onClick: () => editInfo(m) })));
    const tabs = K.MainTabs({ items: TABS.map(([id]) => ({ id, label: label(id) })), active: st.tab, onChange: (id) => { st.tab = id; setHash(); rerender(); }, label: 'أقسام الملف' });
    const body = h('div', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + st.tab }, ...tab(m));
    return [ad ? U.InlineNote({ kind: 'warning', children: 'بتشوف ملف ' + m.name + ' كأدمن — الكروت البيج ظاهرة ليك بس.' }) : null, head, tabs, body];
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
  function overview(m) {
    const r = O.rollover(tasksOf(m.id), K.TODAY); const open = r.today.length + autoOf(m.id).length;
    const myReq = S.requests.filter((x) => x.member === m.id); const need = needFromMe().length; const sc = S.scores[m.id]; const isP = HR().isPending;
    const att = S.attendance.filter((a) => a.member === m.id && a.date.startsWith('2026-10')); const workedMin = att.reduce((s, a) => s + (a.out ? a.out - a.in : 0), 0);
    const tile = (t, v, sub, go) => h('button', { type: 'button', class: 'card sum-tile', onClick: () => { st.tab = go; setHash(); rerender(); } }, h('span', { class: 'kpi-label t-label' }, t), h('span', { class: 't-h3' }, K.Num(String(v))), h('span', { class: 't-small help' }, sub), h('span', { class: 'more t-small' }, 'التفاصيل ', Icon('chevL', 'sm')));
    return [h('div', { class: 'cards' }, tile('مهام النهارده', open, r.today.filter((t) => t.carried).length + ' من امبارح', 'tasks'), tile('ساعات أكتوبر', K.hm(workedMin), att.length + ' يوم حضور', 'hours'), tile('رصيد الإجازات', m.leave - m.used, 'من ' + m.leave + ' يوم', 'requests'), isAdminView() || need === 0 ? tile(isAdminView() ? 'طلباته' : 'طلباتي', myReq.filter(isP).length, 'مستنية قرار', 'requests') : tile('محتاجة منك', need, 'طلبات فريقك', 'requests')),
      h('div', { class: 'cards' }, tile('أداء سبتمبر', sc ? sc[9] + '%' : '—', sc ? O.rating(sc[9]) + ' · الربع ' + HR().qScore(m.id) + '%' : 'الأدمن مالوش KPI', 'performance'), tile('إنجازات', S.achievements.filter((a) => a.member === m.id).length, 'مكافآت السنة دي', 'achievements'), tile('آخر مرتب', m.salary ? K.money(HR().slipOf(m).net) : '—', m.salary ? 'صافي أكتوبر' : 'مفيش مرتب مسجل', 'salary'), tile('المستندات', m.contract === 'missing' ? 'ناقص' : 'تمام', m.contract === 'expiring' ? 'العقد بيخلص قريب' : 'العقد والمستندات', 'docs')),
      isAdminView() ? adminCards(m) : null];
  }
  // admin-only beige cards
  function adminCards(m) {
    const note = st.notes[m.id] || '';
    return h('div', { class: 'admin-cards' },
      h('section', { class: 'card admin' }, h('div', { class: 'sec-h' }, h('h2', { class: 't-h5' }, 'الوظيفة والمرتب'), Button({ size: 'sm', label: 'تعديل', onClick: () => editJob(m) })), K.Kv([['الوظيفة', m.title], ['الدور', m.role], ['المرتب', K.money(m.salary) + ' ج.م'], ['الحجز للبونص', K.money(m.holdback) + ' ج.م'], ['سعر اليوم والساعة', m.salary ? 'اليوم ' + K.money(O.rates(m.salary).daily) + ' · الساعة ' + K.money(O.rates(m.salary).hourly) : '—'], ['الشيفت', m.shift.join(' – ')], ['تاريخ التعيين', K.dlabel(m.hire)]])),
      h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'ملاحظات داخلية'), (() => { const ta = h('textarea', { class: 'textarea', rows: 4, 'aria-label': 'ملاحظات داخلية', placeholder: 'مش ظاهرة للعضو' }); ta.value = note; ta.addEventListener('change', () => { st.notes[m.id] = ta.value; K.logEvent('profile.note', m.name); K.toast('اتحفظت الملاحظة'); }); return ta; })()),
      h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'إجراءات سريعة'), h('div', { class: 'quick' }, Button({ label: 'تسجيل حضور يدوي', icon: 'clock', onClick: () => HR().manualAtt(m) }), Button({ label: 'رفع عقد', icon: 'attach', onClick: () => HR().uploadContract(m) }), Button({ label: 'تحديد ميتنج', icon: 'cal', onClick: () => HR().scheduleMeeting(m) }), Button({ label: 'قسيمة المرتب', icon: 'wallet', onClick: () => HR().payslipModal(m, HR().slipOf(m)) }))),
      h('section', { class: 'card admin' }, h('h2', { class: 't-h5' }, 'الأمان'), K.Kv([['الإيميل', m.email], ['الموبايل', h('span', { dir: 'ltr' }, m.phone)], ['التحقق بخطوتين', m.twofa ? 'مفعّل' : 'مش مفعّل']]), h('div', { class: 'quick' }, Button({ size: 'sm', label: 'إرسال لينك كلمة مرور جديدة', onClick: () => K.toast('اتبعت لينك لـ ' + m.email + ' (صالح 30 دقيقة)', 'success') }), Button({ size: 'sm', label: 'خروج من كل الأجهزة', onClick: () => K.confirm({ title: 'خروج ' + m.name + ' من كل الأجهزة', text: 'هيحتاج يسجل دخول تاني.', okLabel: 'خروج', onOk: () => { K.logEvent('profile.signoutAll', m.name); K.toast('اتعمل خروج'); } }) }), Button({ type: 'danger', size: 'sm', label: m.status === 'suspended' ? 'إعادة تفعيل' : 'إيقاف الحساب', onClick: () => { m.status = m.status === 'suspended' ? 'active' : 'suspended'; K.logEvent('profile.suspend', m.name + ' ' + m.status); rerender(); } }))));
  }

  // ---------- مهامي ----------
  const tasksOf = (id) => S.tasks.filter((t) => !t.auto && t.member === id);
  const autoOf = (id) => S.tasks.filter((t) => t.auto && t.member === id);
  const T_TONE = { 'لسه': 'neutral', 'جاري': 'gold', 'متوقفة': 'orange', 'جاهزة للمراجعة': 'info', 'خلصت': 'success', 'اتأجلت': 'neutral' };
  const T_EN = { 'لسه': 'To do', 'جاري': 'In progress', 'متوقفة': 'Hold', 'جاهزة للمراجعة': 'Ready for review', 'خلصت': 'Complete', 'اتأجلت': 'Postponed' };
  function tasks(m) {
    const r = O.rollover(tasksOf(m.id), K.TODAY); const auto = autoOf(m.id);
    const subs = [{ id: 'today', label: 'النهارده', count: r.today.length + auto.length }, { id: 'later', label: 'المؤجل', count: r.later.length + r.scheduled.length }, { id: 'done', label: 'خلصت', count: r.done.length }];
    const add = h('input', { class: 'task-add', placeholder: 'ضيف مهمة واضغط Enter', 'aria-label': 'مهمة جديدة', value: st.newTask });
    add.addEventListener('input', () => { st.newTask = add.value; });
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter' && add.value.trim()) { S.tasks.push({ id: Date.now(), title: add.value.trim(), status: 'لسه', day: K.TODAY, member: st.who }); st.newTask = ''; K.logEvent('task.create', add.value.trim()); rerender(); setTimeout(() => { const n = document.querySelector('.task-add'); if (n) n.focus(); }); } });
    const list = st.taskSub === 'today' ? r.today : st.taskSub === 'later' ? r.later.concat(r.scheduled) : r.done;
    return [K.SubTabs({ items: subs, active: st.taskSub, onChange: (id) => { st.taskSub = id; rerender(); }, label: 'المهام' }),
      st.taskSub === 'today' ? K.Section('تلقائية من السيستم', auto.map((t) => h('div', { class: 'task auto' }, Icon('sparkle', 'sm'), h('a', { href: t.link }, t.title), h('span', { class: 't-small help' }, 'بتختفي لوحدها لما تتحل'))), null, { sub: auto.length + ' مهمة' }) : null,
      K.Section(st.taskSub === 'today' ? 'مهامي النهارده' : st.taskSub === 'later' ? 'المؤجل' : 'خلصت', [st.taskSub === 'today' ? h('label', { class: 'task-add-wrap' }, Icon('plus', 'sm'), add) : null, list.length ? list.map(taskRow) : K.Empty(st.taskSub === 'later' ? 'مفيش مهام مؤجلة' : st.taskSub === 'done' ? 'لسه مفيش مهام خلصت' : 'مفيش مهام', st.taskSub === 'today' ? 'اكتب مهمة فوق واضغط Enter.' : '')], null, { sub: st.taskSub === 'today' ? 'اللي ما خلصش بينتقل لبكره «من امبارح»' : st.taskSub === 'later' ? 'تذكير أسبوعي لو المؤجل لأجل غير مسمى عدّى 30 يوم' : '' })];
  }
  function taskRow(t) {
    const real = S.tasks.find((x) => x.id === t.id);
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'tstat-btn', 'aria-haspopup': 'listbox', 'aria-label': 'حالة المهمة: ' + t.status }, K.Tag(T_TONE[t.status], t.status), Icon('chevD', 'sm'));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: O.TASK_STATUSES.map((s) => ({ value: s, label: s + ' · ' + T_EN[s] })), value: t.status, onSelect: (v) => { close(); changeStatus(real, v); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn);
    const meta = t.status === 'متوقفة' ? 'السبب: ' + t.reason : t.status === 'جاهزة للمراجعة' ? 'المراجع: ' + t.reviewer : t.status === 'اتأجلت' ? (t.until ? 'لـ ' + K.dshort(t.until) : 'لأجل غير مسمى') : '';
    return h('div', { class: 'task' + (t.status === 'خلصت' ? ' done' : '') }, K.Checkbox({ label: '', checked: t.status === 'خلصت', onChange: (v) => changeStatus(real, v ? 'خلصت' : 'لسه') }), h('span', { class: 'grow' }, t.title, t.carried ? h('span', { class: 'carried' }, K.Tag('orange', 'من امبارح')) : null, meta ? h('small', { class: 't-small help' }, ' · ' + meta) : null), wrap,
      K.RowMenu([{ label: 'حذف', icon: 'close', danger: true, run: () => { S.tasks = S.tasks.filter((x) => x !== real); K.logEvent('task.delete', t.title); rerender(); } }], 'إجراءات ' + t.title));
  }
  function changeStatus(t, s) {
    if (s === 'متوقفة' || s === 'جاهزة للمراجعة' || s === 'اتأجلت') {
      return K.form({ title: s === 'متوقفة' ? 'وقّف المهمة' : s === 'جاهزة للمراجعة' ? 'جاهزة للمراجعة' : 'أجّل المهمة', values: { reviewer: K.member(K.member(K.ME).manager || 'M02').name, when: 'day', until: O.addDays(K.TODAY, 1) }, note: h('b', null, t.title),
        fields: (f, e, set) => s === 'متوقفة' ? [K.field.area('reason', 'سبب التوقف', f, e, set, { required: true })] : s === 'جاهزة للمراجعة' ? [K.field.select('reviewer', 'مين هيراجع', K.team().map((m) => m.name), f, e, set, { required: true, help: 'هتظهر عنده مهمة تلقائية' })]
          : [K.Radios({ label: 'لإمتى', value: f.when, onChange: (v) => set('when', v, true), options: [{ value: 'day', label: 'ليوم معين — تظهر تلقائي في اليوم ده' }, { value: 'never', label: 'لأجل غير مسمى — تتحط في «المؤجل»' }] }), f.when === 'day' ? K.field.date('until', 'اليوم', f, e, set, { required: true }) : null],
        validate: (f) => { const err = O.validateTaskStatus(s, { reason: f.reason, reviewer: f.reviewer, until: f.when === 'day' ? f.until : null, indefinite: f.when === 'never' }); if (!err) return {}; return { [s === 'متوقفة' ? 'reason' : s === 'جاهزة للمراجعة' ? 'reviewer' : 'until']: err }; },
        submitLabel: 'حفظ', submit: (f) => { t.status = s; if (s === 'متوقفة') t.reason = f.reason; if (s === 'جاهزة للمراجعة') t.reviewer = f.reviewer; if (s === 'اتأجلت') { t.until = f.when === 'day' ? f.until : null; } K.logEvent('task.status', t.title + ' → ' + s); K.toast('المهمة بقت «' + s + '»'); rerender(); } });
    }
    t.status = s; if (t.day < K.TODAY) t.day = K.TODAY; K.logEvent('task.status', t.title + ' → ' + s); rerender();
  }

  // ---------- ساعات العمل ----------
  function hours(m) {
    const att = S.attendance.filter((a) => a.member === m.id); const worked = att.reduce((s, a) => s + (a.out ? a.out - a.in : 0), 0); const ot = S.overtime.filter((o) => o.member === m.id);
    const sh = !isAdminView() && window.IBShell ? window.IBShell.state() : null;
    // «التفاصيل» on each tile (owner, 22 Oct) — same rows as the tables below, filtered to what the number counts.
    const who = m.name; const lates = att.filter((a) => a.late); const otOk = ot.filter((o) => o.status === 'اتضاف');
    const attRow = (a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.hm(a.in), a.out ? K.hm(a.out) : 'ناقص', a.out ? K.hm(a.out - a.in) : '—', a.late ? 'متأخر ' + a.late + ' د' : 'في الميعاد'];
    const dToday = () => ({ title: 'النهارده — ' + who, sub: sh ? (sh.state === 'out' ? 'خارج الدوام دلوقتي' : 'الدوام شغال من ' + sh.startLabel) : 'العرض للأدمن — الدوام اللحظي بيظهر للعضو نفسه', summary: [{ label: 'الحالة', value: !sh ? '—' : sh.state === 'out' ? 'خارج الدوام' : sh.state === 'break' ? 'استراحة' : 'في الدوام' }, { label: 'اشتغلت', value: sh && sh.state !== 'out' ? K.hm(sh.worked) + ' ساعة' : '—' }, { label: 'بداية الدوام', value: sh && sh.startLabel || '—' }], headers: [], rows: [], note: 'الساعات بتتحسب من «ابدأ الدوام» لحد «إنهاء الدوام»، والاستراحات مش محسوبة.', source: 'تسجيل الدوام' });
    const dTen = () => ({ title: 'ساعات آخر 10 أيام — ' + who, sub: att.length + ' يوم مسجّل', summary: [{ label: 'إجمالي الساعات', value: K.hm(worked) }, { label: 'أيام', value: String(att.length) }, { label: 'متوسط اليوم', value: att.length ? K.hm(worked / att.filter((a) => a.out).length || 0) : '—' }], headers: ['اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الالتزام'], rows: att.map(attRow), source: 'سجل الحضور' });
    const dLate = () => ({ title: 'مرات التأخير — ' + who, sub: lates.length + ' مرة في آخر 10 أيام', summary: [{ label: 'مرات', value: String(lates.length) }, { label: 'إجمالي التأخير', value: lates.reduce((x, a) => x + a.late, 0) + ' د' }], headers: ['اليوم', 'الحضور', 'التأخير'], rows: lates.map((a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.hm(a.in), a.late + ' دقيقة']), empty: 'مفيش تأخير — ملتزم بالمواعيد.', source: 'سجل الحضور' });
    const dOt = () => ({ title: 'الوقت الإضافي — ' + who, sub: otOk.length + ' متأكد · ' + ot.filter((o) => o.status === 'مستني').length + ' مستني تأكيد', summary: [{ label: 'متأكد', value: K.hm(otOk.reduce((x, o) => x + o.paid, 0)) + ' ساعة' }, { label: 'مستني', value: String(ot.filter((o) => o.status === 'مستني').length) }], headers: ['اليوم', 'المدة', 'المحسوب', 'اشتغلت على إيه', 'الحالة'], rows: ot.map((o) => [K.dshort(o.date), K.hrs(o.minutes), o.status === 'اتضاف' ? K.hrs(o.paid) : '—', o.note, o.status]), empty: 'مفيش وقت إضافي مسجّل.', note: 'الوقت الإضافي بيتحسب بس بعد ما المدير يأكده.', source: 'طلبات الوقت الإضافي' });
    return [h('div', { class: 'cards' }, K.Stat('النهارده', sh && sh.state !== 'out' ? K.hm(sh.worked) : '—', '', sh ? (sh.state === 'out' ? 'خارج الدوام' : 'من ' + sh.startLabel) : '', undefined, dToday), K.Stat('آخر 10 أيام', K.hm(worked), 'ساعة', undefined, undefined, dTen), K.Stat('مرات التأخير', att.filter((a) => a.late).length, 'مرة', undefined, undefined, dLate), K.Stat('وقت إضافي متأكد', K.hm(ot.filter((o) => o.status === 'اتضاف').reduce((s, o) => s + o.paid, 0)), 'ساعة', ot.filter((o) => o.status === 'مستني').length + ' مستني تأكيد', undefined, dOt)),
      sh ? h('div', { class: 'toolbar' }, sh.state === 'out' ? Button({ type: 'primary', label: 'ابدأ الدوام', icon: 'clock', onClick: () => window.IBShell.clockIn() }) : Button({ label: 'إنهاء الدوام', onClick: () => window.IBShell.endShift() })) : null,
      K.Section('سجل الحضور', U.Table({ headers: ['اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الالتزام', 'وقت إضافي'], rows: att.map((a) => [K.dayName(a.date) + ' ' + K.dshort(a.date), K.Num(K.hm(a.in)), a.out ? K.Num(K.hm(a.out)) : K.Tag('error', 'ناقص'), a.out ? K.Num(K.hm(a.out - a.in)) : '—', a.late ? K.Tag('orange', 'متأخر ' + a.late + ' د') : K.Tag('success', 'في الميعاد'), a.ot ? K.Tag('gold', K.hrs(a.ot)) : '—']) })),
      ot.length ? K.Section('الوقت الإضافي', U.Table({ headers: ['اليوم', 'المدة', 'اشتغلت على إيه', 'الحالة'], rows: ot.map((o) => [K.dshort(o.date), K.hrs(o.minutes), h('span', { class: 'wrap' }, o.note), K.Tag(o.status === 'مستني' ? 'orange' : o.status === 'اتضاف' ? 'success' : 'error', o.status)]) })) : null];
  }
  // ---------- طلباتي ----------
  function needFromMe() { return S.requests.filter((r) => HR().isPending(r)).map((r) => ({ kind: 'req', r })).concat(S.overtime.filter((o) => o.status === 'مستني').map((o) => ({ kind: 'ot', o }))); }
  function requests(m) {
    const canApprove = !isAdminView() && (m.role === 'أدمن' || m.role === 'عمليات');
    if (!canApprove && st.reqSub === 'need') st.reqSub = 'mine';
    const need = needFromMe(); const mine = S.requests.filter((r) => r.member === m.id);
    const subs = (canApprove ? [{ id: 'need', label: 'محتاجة منك', count: need.length }] : []).concat([{ id: 'mine', label: isAdminView() ? 'طلباته' : 'طلباتي', count: mine.length }]);
    const out = [h('div', { class: 'toolbar' }, K.SubTabs({ items: subs, active: st.reqSub, onChange: (id) => { st.reqSub = id; rerender(); }, label: 'الطلبات' }), h('span', { class: 'grow' }), Button({ label: 'طلب سُلفة', onClick: () => HR().advanceRequest() }), Button({ type: 'primary', label: 'طلب إجازة', icon: 'plus', onClick: () => HR().leaveRequest(m.id === 'M01' ? null : m) }))];
    if (st.reqSub === 'need') out.push(K.Section('محتاجة منك', need.length ? U.Table({ headers: ['العضو', 'الطلب', 'التفاصيل', 'اتقدم', ''], rows: need.map((x) => x.kind === 'req' ? [K.member(x.r.member).name, x.r.type, HR().reqPeriod(x.r), x.r.at, h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'موافقة', onClick: () => HR().decide(x.r, 'موافق') }), Button({ size: 'sm', label: 'رفض', onClick: () => HR().rejectReq(x.r) }), Button({ type: 'text', size: 'sm', label: 'التفاصيل', onClick: () => HR().reqDetails(x.r) }))]
      : [K.member(x.o.member).name, 'وقت إضافي', K.hrs(x.o.minutes) + ' · ' + x.o.note, K.dshort(x.o.date) + (x.o.waitedHours >= 24 ? ' (اتصعّد)' : ''), h('div', { class: 'acts-inline' }, Button({ type: 'primary', size: 'sm', label: 'ضيفه', onClick: () => HR().otAdd(x.o) }), Button({ size: 'sm', label: 'متضيفهوش', onClick: () => HR().otReject(x.o) }))]) }) : K.Empty('مفيش حاجة مستنياك', 'كل طلبات الفريق اتردّ عليها.'), null, { sub: 'طلبات الإجازة والسُلف والوقت الإضافي لفريقك' }));
    else out.push(K.Section('', mine.length ? U.Table({ headers: ['رقم', 'النوع', 'التفاصيل', 'اتقدم', 'الحالة'], rows: mine.map((r) => [K.Num(r.id), r.type, HR().reqPeriod(r), r.at, K.Tag(HR().isPending(r) ? 'orange' : r.status === 'موافق' ? 'success' : 'error', r.status + (r.reason ? ' — ' + r.reason : ''))]) }) : K.Empty('مفيش طلبات', 'قدّم طلب إجازة أو سُلفة من الأزرار فوق.')));
    return out;
  }
  // ---------- أدائي ----------
  function performance(m) {
    const sc = S.scores[m.id]; if (!sc) return [K.Section('', K.Empty('مفيش تقييم', 'الأدمن مالوش مؤشرات KPI.'))];
    const q = [7, 8, 9].map((k) => sc[k]);
    const mon = (k) => K.AR_MON[k - 1]; const qRows = () => [7, 8, 9].map((k) => [mon(k), sc[k] + '%', O.rating(sc[k]), K.money(O.monthBonus(m.holdback, sc[k])) + ' ج.م']);
    const qHead = ['الشهر', 'السكور', 'التقييم', 'الحافز المستحق'];
    const dScore = () => ({ title: 'سكور سبتمبر — ' + m.name, sub: 'التقييم: ' + O.rating(sc[9]) + ' · ممتاز ≥ 100% · جيد 85–99% · محتاج تحسين 70–84% · إنذار < 70%', summary: [{ label: 'السكور', value: sc[9] + '%' }, { label: 'التقييم', value: O.rating(sc[9]) }], headers: ['المؤشر', 'المصدر', 'الوزن', 'الهدف'], rows: S.kpis.map((k) => [k.name, k.src, k.weight + '%', k.target]), note: 'السكور = مجموع المؤشرات بأوزانها؛ «تقييم المدير» بس يدوي.', source: 'مؤشرات الأداء' });
    const dAvg = () => ({ title: 'متوسط Q3 — ' + m.name, sub: O.quarterBad(q) ? 'ربع سيئ (متوسط < 70% أو شهرين تحت 70%) — في ميتنج فردي' : 'الربع تمام', summary: [{ label: 'المتوسط', value: (q.reduce((a, b) => a + b) / 3).toFixed(1) + '%' }, { label: 'أعلى شهر', value: Math.max(...q) + '%' }, { label: 'أقل شهر', value: Math.min(...q) + '%' }], headers: qHead, rows: qRows(), source: 'التقييم الشهري' });
    const dQb = () => ({ title: 'بونص Q3 — ' + m.name, sub: 'الحافز المحجوز ' + K.money(m.holdback) + ' ج.م كل شهر — بيتصرف بنسبة السكور (بحد أقصى 100%)، والشهر اللي تحت 70% حافزه 0', summary: [{ label: 'البونص', value: K.money(O.quarterBonus(m.holdback, q)) + ' ج.م' }, { label: 'من المحجوز', value: K.money(m.holdback * 3) + ' ج.م' }], headers: qHead, rows: qRows(), source: 'التقييم الشهري + الحافز المحجوز' });
    const dMb = () => ({ title: 'حافز سبتمبر — ' + m.name, sub: 'اتصرف مع حافز الربع', summary: [{ label: 'الحافز', value: K.money(O.monthBonus(m.holdback, sc[9])) + ' ج.م' }, { label: 'المحجوز', value: K.money(m.holdback) + ' ج.م' }, { label: 'السكور', value: sc[9] + '%' }], headers: ['البند', 'القيمة'], rows: [['الحافز المحجوز', K.money(m.holdback) + ' ج.م'], ['سكور سبتمبر', sc[9] + '%'], ['النسبة المحسوبة', Math.min(sc[9], 100) + '%' + (sc[9] < 70 ? ' (تحت 70% = 0)' : '')], ['الحافز المستحق', K.money(O.monthBonus(m.holdback, sc[9])) + ' ج.م']], source: 'التقييم الشهري' });
    return [h('div', { class: 'cards' }, K.Stat('سكور سبتمبر', sc[9] + '%', '', O.rating(sc[9]), undefined, dScore), K.Stat('متوسط Q3', (q.reduce((a, b) => a + b) / 3).toFixed(1) + '%', '', O.quarterBad(q) ? 'ربع سيئ — في ميتنج' : 'تمام', undefined, dAvg), K.Stat('بونص Q3', K.money(O.quarterBonus(m.holdback, q)), 'ج.م', 'من ' + K.money(m.holdback * 3), undefined, dQb), K.Stat('حافز سبتمبر', K.money(O.monthBonus(m.holdback, sc[9])), 'ج.م', 'اتصرف مع حافز الربع', undefined, dMb)),
      K.Section('التقييم الشهري', h('div', { class: 'cols' }, [7, 8, 9].map((k) => h('div', { class: 'col' + (k === 9 ? ' hi' : '') }, h('span', { class: 't-label' }, sc[k] + '%'), h('i', { style: 'height:' + Math.round(Math.min(sc[k], 120) * 1.4) + 'px' }), K.Tag(O.RATING_TONE[O.rating(sc[k])], O.rating(sc[k])), h('span', { class: 't-small' }, K.AR_MON[k - 1])))), null, { sub: 'ممتاز ≥ 100% · جيد 85–99% · محتاج تحسين 70–84% · إنذار < 70% (حافز الشهر = 0)' }),
      K.Section('المؤشرات', U.Table({ headers: ['المؤشر', 'المصدر', 'الوزن', 'الهدف'], rows: S.kpis.map((k) => [k.name, k.src, k.weight + '%', k.target]) }), null, { sub: 'أغلب المؤشرات بتتسحب تلقائي؛ «تقييم المدير» بس يدوي' })];
  }
  function achievements(m) { const a = S.achievements.filter((x) => x.member === m.id); return [K.Section('الإنجازات والمكافآت', a.length ? U.Table({ headers: ['الإنجاز', 'المكافأة', 'التاريخ', 'الحالة'], rows: a.map((x) => [x.title, K.Num(K.money(x.amount) + ' ج.م'), K.dshort(x.date), K.Tag('success', x.status)]) }) : K.Empty('لسه مفيش إنجازات مسجلة', 'المكافأة بتتضاف لما الأدمن يسجل إنجاز.'))]; }
  // ---------- مرتبي ----------
  function salary(m) {
    if (!m.salary) return [K.Section('', K.Empty('مفيش مرتب مسجل', 'المرتب بيتسجل من الموارد البشرية.'))];
    const p = HR().slipOf(m); const show = st.showPay || isAdminView(); const v = (n) => (show ? K.money(n) : '••••');
    return [h('div', { class: 'toolbar' }, !isAdminView() ? Button({ label: show ? 'إخفاء المبالغ' : 'إظهار', attrs: { 'aria-pressed': String(show) }, onClick: () => { st.showPay = !st.showPay; rerender(); } }) : null),
      // details respect «إظهار»: amounts stay masked (••••) until shown.
      h('div', { class: 'cards' }, K.Stat('صافي أكتوبر', v(p.net), 'ج.م', undefined, undefined, () => ({ title: 'صافي أكتوبر — ' + m.name, sub: 'القسيمة: ' + S.sheet.status + (show ? '' : ' · المبالغ مخفية — اضغط «إظهار»'), summary: [{ label: 'الصافي', value: v(p.net) + ' ج.م' }], headers: ['البند', 'المبلغ'], rows: [['المرتب بعد الحافز المحجوز', v(p.paid)], ['وقت إضافي (' + K.hrs(p.otMin) + ')', v(p.otPay)], ['أيام راحة اشتغلها (' + p.rest + ')', v(p.restPay)], ['بدلات ومكافآت', v(p.allow)], ['خصومات', p.ded ? '−' + v(p.ded) : v(0)], ['سُلف', p.advances ? '−' + v(p.advances) : v(0)], ['غياب', p.absence ? '−' + v(p.absence) : v(0)], ['الصافي', v(p.net)]], source: 'كشف مرتبات أكتوبر' })),
        K.Stat('الحافز المحجوز الشهر ده', v(m.holdback), 'ج.م', 'بيتحدد بتقييم أكتوبر · يتصرف ديسمبر', undefined, () => ({ title: 'الحافز المحجوز — ' + m.name, sub: 'بيتحجز كل شهر وبيتصرف آخر الربع بنسبة السكور', summary: [{ label: 'محجوز الشهر', value: v(m.holdback) + ' ج.م' }, { label: 'محجوز Q4', value: v(m.holdback * 3) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: [['أكتوبر', v(m.holdback) + ' — بيتحدد بتقييم أكتوبر'], ['نوفمبر', v(m.holdback) + ' — لسه'], ['ديسمبر', v(m.holdback) + ' — لسه'], ['ميعاد الصرف', 'ديسمبر 2026 مع حافز الربع']], note: 'الشهر اللي سكوره أقل من 70% حافزه 0.', source: 'سياسة الحوافز' })),
        K.Stat('اليومية', v(O.rates(m.salary).daily), 'ج.م', undefined, undefined, () => ({ title: 'اليومية — ' + m.name, summary: [{ label: 'اليومية', value: v(O.rates(m.salary).daily) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: [['المرتب الأساسي', v(m.salary)], ['أيام الشغل في الشهر', String(O.HR.workDays)], ['اليومية = المرتب ÷ أيام الشغل', v(O.rates(m.salary).daily)], ['يوم راحة اشتغلته', v(O.overtimePay(m.salary, { offDays: 1 })) + ' (يومية × 2)']], source: 'إعدادات الموارد البشرية' })),
        K.Stat('سعر الساعة', v(O.rates(m.salary).hourly), 'ج.م', 'نفس سعر الوقت الإضافي', undefined, () => ({ title: 'سعر الساعة — ' + m.name, summary: [{ label: 'سعر الساعة', value: v(O.rates(m.salary).hourly) + ' ج.م' }], headers: ['البند', 'القيمة'], rows: [['اليومية', v(O.rates(m.salary).daily)], ['ساعات الوردية', String(O.HR.shiftHours)], ['سعر الساعة = اليومية ÷ ساعات الوردية', v(O.rates(m.salary).hourly)], ['الوقت الإضافي هذا الشهر', K.hrs(p.otMin) + ' = ' + v(p.otPay)]], source: 'إعدادات الموارد البشرية' }))),
      K.Section('القسايم', U.Table({ headers: ['الشهر', 'الصافي', 'الحالة', ''], rows: [['أكتوبر 2026', p.net, S.sheet.status], ['سبتمبر 2026', p.paid + O.quarterBonus(m.holdback, [7, 8, 9].map((k) => S.scores[m.id][k])), 'اتصرف (مع بونص Q3)'], ['أغسطس 2026', p.paid, 'اتصرف']].map(([mo, n, s]) => [mo, K.Num(v(n)), K.Tag(s === 'مسودة' ? 'orange' : 'success', s), Button({ type: 'text', size: 'sm', label: 'عرض', disabled: !show, onClick: () => HR().payslipModal(m, p) })]) }))];
  }
  // ---------- العقود والمستندات ----------
  function docs(m) {
    const ad = isAdminView() || m.role === 'أدمن';
    return [K.Section('العقود والمستندات', [U.ContractCard({ status: m.contract, title: 'عقد العمل', sub: m.contract === 'missing' ? 'لسه ما اترفعش' : m.contract === 'expiring' ? 'بيخلص 15 نوفمبر 2026' : 'ساري لحد 31 ديسمبر 2026', canManage: ad, onView: () => K.toast('بيفتح العقد'), onDownload: () => K.toast('بيتحمل العقد'), onUpload: () => HR().uploadContract(m), onTemplate: () => K.toast('بيتحمل القالب') }),
      U.ContractCard({ status: 'uploaded', title: 'صورة البطاقة', sub: 'اترفعت ' + K.dlabel(m.hire), canManage: ad, onView: () => K.toast('بتفتح'), onDownload: () => K.toast('بتتحمل'), onUpload: () => HR().uploadContract(m) })], ad ? [Button({ label: 'رفع مستند', icon: 'attach', onClick: () => HR().uploadContract(m) })] : null)];
  }
  // ---------- الحساب والأمان ----------
  function security(m) {
    return [K.Section('بيانات الدخول', K.Kv([['الإيميل', m.email], ['الموبايل', h('span', { dir: 'ltr' }, m.phone)], ['آخر تغيير لكلمة المرور', '12 سبتمبر 2026']]), [Button({ label: 'تعديل بياناتي', onClick: () => editInfo(m) }), Button({ type: 'primary', label: 'تغيير كلمة المرور', onClick: () => changePassword() })]),
      K.Section('التحقق بخطوتين', [h('div', { class: 'set-row' }, h('div', null, h('b', null, m.twofa ? 'مفعّل — واتساب' : 'مش مفعّل'), h('div', { class: 't-small help' }, 'اختياري للكل · واتساب أو إيميل أو تطبيق Authenticator + 10 أكواد احتياطية')), m.twofa ? Button({ label: 'إيقاف', onClick: () => K.confirm({ title: 'إيقاف التحقق بخطوتين', text: 'حسابك هيبقى محمي بكلمة المرور بس.', okType: 'danger', okLabel: 'إيقاف', onOk: () => { m.twofa = false; rerender(); } }) }) : Button({ type: 'primary', label: 'تفعيل', onClick: () => enable2fa(m) }))]),
      K.Section('الأجهزة', U.Table({ headers: ['الجهاز', 'المكان', 'آخر نشاط'], rows: [['Chrome — Windows', 'القاهرة', 'دلوقتي (الجهاز ده)'], ['Safari — iPhone', 'القاهرة', 'من ساعتين']] }), [Button({ label: 'خروج من كل الأجهزة', onClick: () => window.IBShell.signOutAll() })])];
  }
  function prefs() {
    const p = st.prefs; const save = (k) => (v) => { p[k] = v; K.toast('اتحفظ'); rerender(); };
    return [K.Section('التفضيلات', [U.Select({ id: 'pf-land', label: 'الصفحة اللي تفتح أول ما أدخل', options: ['الأوردرات', 'ملفي', 'خدمة العملاء', 'تذاكر الفريق', 'المخزن'].map((x) => ({ value: x, label: x })), value: p.landing, onChange: save('landing') }), U.Select({ id: 'pf-den', label: 'كثافة الجداول', options: ['مضغوط', 'مريح'].map((x) => ({ value: x, label: x })), value: p.density, onChange: save('density') }),
      K.Switch({ id: 'pf-sound', label: 'صوت للتنبيهات العاجلة', checked: p.sound, onChange: save('sound') }), K.Switch({ id: 'pf-dig', label: 'ملخص يومي على الإيميل', help: 'الساعة 9 الصبح', checked: p.digest, onChange: save('digest') }), K.Switch({ id: 'pf-wa', label: 'تنبيهات واتساب', help: 'للعاجل بس', checked: p.whatsapp, onChange: save('whatsapp') })])];
  }

  // ---------- popups ----------
  function editInfo(m) { K.form({ title: 'تعديل بياناتي', values: { phone: m.phone, email: m.email }, fields: (f, e, set) => [K.field.text('phone', 'الموبايل', f, e, set, { required: true, inputmode: 'tel' }), K.field.text('email', 'الإيميل', f, e, set, { required: true, help: 'تغيير الإيميل محتاج تأكيد من اللينك اللي هيوصلك' })], validate: (f) => { const e = {}; if (O.identifierKind(f.phone) !== 'phone') e.phone = 'رقم موبايل مصري صحيح'; if (O.identifierKind(f.email) !== 'email') e.email = 'إيميل صحيح'; return e; }, submitLabel: 'حفظ', submit: (f) => { m.phone = O.toLatin(f.phone); if (f.email !== m.email) K.toast('اتبعت لينك تأكيد لـ ' + f.email); else K.toast('اتحفظ', 'success'); K.logEvent('profile.edit', m.name); rerender(); } }); }
  function editJob(m) { K.form({ title: 'تعديل الوظيفة والمرتب — ' + m.name, values: { title: m.title, salary: String(m.salary), holdback: String(m.holdback), from: '2026-11-01' }, fields: (f, e, set) => [K.field.text('title', 'الوظيفة', f, e, set, { required: true }), K.two(K.field.text('salary', 'المرتب', f, e, set, { required: true, inputmode: 'decimal', suffix: 'ج.م' }), K.field.text('holdback', 'الحجز للبونص', f, e, set, { inputmode: 'decimal', suffix: 'ج.م' })), K.field.date('from', 'يبدأ من', f, e, set, { required: true }), K.field.area('reason', 'السبب', f, e, set, { placeholder: 'مثلاً: زيادة سنوية' })], validate: (f) => { const e = K.req(f, ['title', 'salary', 'from']); if (Number(f.holdback) >= Number(f.salary)) e.holdback = 'الحجز لازم أقل من المرتب'; return e; }, submitLabel: 'حفظ', submit: (f) => { const old = m.salary; m.title = f.title; m.salary = Number(f.salary); m.holdback = Number(f.holdback) || 0; K.logEvent('profile.salary', m.name + ' ' + old + ' → ' + m.salary + ' من ' + f.from); K.toast('اتحفظ', 'success'); rerender(); } }); }
  function changePassword() { K.form({ title: 'تغيير كلمة المرور', values: {}, fields: (f, e, set) => [K.field.text('cur', 'كلمة المرور الحالية', f, e, set, { required: true }), K.field.text('p1', 'كلمة المرور الجديدة', f, e, set, { required: true, help: '8 حروف على الأقل فيها حرف ورقم' }), K.field.text('p2', 'أكّد كلمة المرور', f, e, set, { required: true })], validate: (f) => { const e = K.req(f, ['cur']); const p = O.validatePassword(f.p1 || '', f.p2 || ''); if (p) e[p.includes('مش زي') ? 'p2' : 'p1'] = p; return e; }, submitLabel: 'تغيير', submit: () => { K.logEvent('profile.password', K.member(K.ME).name); K.toast('اتغيرت كلمة المرور — الأجهزة التانية هتخرج', 'success'); } }); setTimeout(() => document.querySelectorAll('.modal-b input').forEach((i) => { i.type = 'password'; })); }
  function enable2fa(m) {
    let step = 1; let ch = 'واتساب'; let code = ''; let err = '';
    const md = U.Modal({ title: 'تفعيل التحقق بخطوتين', body: [] });
    const codes = ['4821-9930', '1174-5582', '8803-2241', '6620-1197', '3358-7740', '9012-4486', '2275-6613', '7741-0328', '5569-8812', '0934-2257'];
    const draw = () => { md.setBody(...(step === 1 ? [K.Radios({ label: 'هيوصلك الكود فين', value: ch, onChange: (v) => { ch = v; draw(); }, options: [{ value: 'واتساب', label: 'واتساب على ' + m.phone }, { value: 'إيميل', label: 'إيميل على ' + m.email }, { value: 'تطبيق', label: 'تطبيق Authenticator' }] })] : step === 2 ? [h('p', { style: 'margin:0' }, ch === 'تطبيق' ? 'امسح الكود من التطبيق واكتب الـ 6 أرقام.' : 'بعتنالك كود من 6 أرقام على ' + ch + '. (للتجربة: 123456)'), U.TextInput({ id: '2fa-code', label: 'الكود', value: code, inputmode: 'numeric', maxlength: 6, error: err, onInput: (v) => { code = v; } })] : [U.InlineNote({ kind: 'success', children: 'اتفعّل التحقق بخطوتين.' }), h('p', { class: 't-small', style: 'margin:0' }, 'احفظ الأكواد الاحتياطية في مكان آمن — كل كود يستخدم مرة واحدة:'), h('div', { class: 'codes', dir: 'ltr' }, codes.map((c) => h('code', null, c)))]));
      md.setFooter(...(step < 3 ? [Button({ label: 'إلغاء', onClick: () => md.close() }), Button({ type: 'primary', label: step === 1 ? 'ابعت الكود' : 'تأكيد', onClick: () => { if (step === 2) { if (O.toLatin(code) !== '123456') { err = 'الكود غلط — جرّب تاني'; return draw(); } m.twofa = true; K.logEvent('profile.2fa.enable', ch); } step++; err = ''; draw(); } })] : [Button({ label: 'نسخ الأكواد', icon: 'copy', onClick: () => { try { navigator.clipboard.writeText(codes.join('\n')).then(() => K.toast('اتنسخت'), () => K.toast('حدد الأكواد وانسخها')); } catch (e) { K.toast('حدد الأكواد وانسخها'); } } }), Button({ type: 'primary', label: 'خلصت', onClick: () => { md.close(); rerender(); } })])); };
    draw();
  }

  window.IBPages.register('profile', { title: 'ملفي', hash: (hs) => { let m = /^profile(?:-([a-z]+))?$/.exec(hs); if (m) { st.who = K.ME; st.tab = m[1] && TABS.some((t) => t[0] === m[1]) ? m[1] : 'overview'; if (m[1] === 'requests' && K.member(K.ME).role === 'أدمن') st.reqSub = 'need'; return true; } m = /^member-(M\d{2})$/.exec(hs); if (m && S.members.some((x) => x.id === m[1])) { if (st.who !== m[1]) st.tab = 'overview'; st.who = m[1] === K.ME ? K.ME : m[1]; return true; } return false; },
    defaultHash: () => (isAdminView() ? 'member-' + st.who : 'profile' + (st.tab === 'overview' ? '' : '-' + st.tab)), view, navPage: () => (isAdminView() ? 'hr' : null) });
})();

