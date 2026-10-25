
/* Ibtekr ops — لوحة التحكم (owner 22 Oct). Figma 526:35690: role frames, popups, states. Desktop first; mobile later.
   Data comes from window.IBDashData (app.js), the bell (IBNotifRoles), HR, CS, inventory and kit stores. Rules live in dashdomain.js. */
(function () {
  'use strict';
  const K = window.IBKit, U = window.IBUI, DD = window.IbtekrDash;
  const { h, Icon, Button, num } = U;
  const st = { viewAs: null, updated: null, loading: false, error: false, last: null, timer: null };
  const DATA = () => window.IBDashData;
  const NR = () => window.IBNotifRoles;
  const money = (v) => K.money(v);
  const me = () => K.member(st.viewAs || K.ME);
  const role = () => (me() ? me().role : 'مشاهد');
  const isAdminReal = () => K.member(K.ME).role === 'أدمن';
  const prefsOf = (id) => ((K.store.dashPrefs = K.store.dashPrefs || {})[id] || {});
  const pages = () => window.IBPages.all();
  const hrApi = () => (pages().hr ? pages().hr.api : null);
  const csData = () => (pages().cs && pages().cs.api ? pages().cs.api.data : { convs: [], customers: [], channels: {} });
  const go = (hash) => { location.hash = hash; };
  const shell = () => { const s = window.IBShell && window.IBShell.state; return (typeof s === 'function' ? s() : s) || {}; };
  const daysAgo = (d) => (d ? K.daysBetween(d, K.TODAY) : 0);

  // ---------- data snapshot (one per render) ----------
  function snapshot() {
    const D = DATA(); if (!D) throw new Error('no data');
    const rows = D.rows(); const r = D.range(); const al = D.alerts();
    const end = r.to; const start = addDays(end, -34); // last 5 Saturday weeks ending at the period end
    const rep = D.report({ from: start, to: end }); const conf = D.report({ from: addDays(K.TODAY, -29), to: K.TODAY });
    const sections = NR() ? NR().viewSections(true) : [];
    const canMoney = !['مشاهد'].includes(DD.roleOf(role()));
    return { rows, range: r, al, rep, conf, sections, health: DD.health(rows), money: canMoney ? D.money() : null, full: D.full() };
  }
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  // ---------- KPIs ----------
  function kpi(key, S) {
    const rows = S.rows; const open = S.health.open; const O = window.OrdersApp;
    const late = rows.filter((x) => x.delivery === 'late'), risk = rows.filter((x) => x.delivery === 'risk');
    const orderRows = (list) => list.map((x) => ['IB-' + x.id, x.customer, x.delivery === 'late' ? 'متأخر' : x.delivery === 'risk' ? 'قابل للتأخير' : x.status, x.ageDays + ' يوم', (x.vendors || []).join('، ')]);
    const orderDetails = (title, list) => () => ({ title, sub: list.length + ' أوردر', headers: ['الأوردر', 'العميل', 'الحالة', 'العمر', 'الموردين'], rows: orderRows(list), onRow: (i) => O.details(list[i].id), actions: [{ label: 'فتح في الأوردرات', onClick: () => go('orders') }] });
    const M = S.money; const D = DATA();
    switch (key) {
      case 'sales': { const c = M.salesRows[0]; return { label: 'مبيعات سبتمبر', value: money(c.sales), unit: 'ج.م', note: c.orders + ' أوردر مكتمل · آخر شهر مقفول في الحسابات', details: () => ({ title: 'مبيعات سبتمبر 2026', headers: ['الحالة', 'الأوردرات', 'المبيعات', 'حصة إبتكر'], rows: M.salesRows.map((x) => [x.label, String(x.orders), money(x.sales), money(x.share)]), total: ['الإجمالي', String(M.sales.orders), money(M.sales.sales), money(M.sales.share)], source: 'شيت الحسابات — Monthly Performance', actions: [{ label: 'فتح المبيعات', onClick: () => go('sales') }] }) }; }
      case 'net': { const net = Math.round((M.sales.share - M.expSept.total) * 100) / 100; return { label: 'صافي سبتمبر', value: money(net), unit: 'ج.م', compare: net < 0 ? 'negative' : 'positive', delta: { text: net < 0 ? 'خسارة' : 'ربح', caption: 'حصة إبتكر − المصروفات' }, note: 'حصة إبتكر ' + money(M.sales.share) + ' − مصروفات ' + money(M.expSept.total), details: () => ({ title: 'صافي سبتمبر — ' + money(net) + ' ج.م', summary: [{ label: 'حصة إبتكر', value: money(M.sales.share) + ' ج.م' }, { label: 'المصروفات', value: money(M.expSept.total) + ' ج.م' }], headers: ['نوع المصروف', 'المبلغ'], rows: Object.keys(M.expSept.byCategory).map((c) => [c, money(M.expSept.byCategory[c].amount)]), actions: [{ label: 'فتح المصروفات', onClick: () => go('expenses') }] }) }; }
      case 'open': { const r = S.range; const prev = { from: addDays(r.from, -(K.daysBetween(r.from, r.to) + 1)), to: addDays(r.from, -1) }; const cur = DD.countIn(S.full, r), was = DD.countIn(S.full, prev); const d = DD.countDelta(cur, was, 'up');
        return { label: 'أوردرات مفتوحة', value: String(open), unit: 'أوردر', compare: d.tone, delta: { text: d.text, caption: cur + ' جديد في الفترة · ' + was + ' قبلها' }, note: S.health.rows[1].count + ' قيد الشحن · ' + (S.rows.filter((x) => x.status === 'معلّق').length) + ' معلّق', details: orderDetails('الأوردرات المفتوحة', rows.filter((x) => !['مكتمل', 'ملغي', 'استرجاع', 'تم RTC'].includes(x.status))) }; }
      case 'late': { const vn = new Set(late.concat(risk).flatMap((x) => x.vendors || [])); return { label: 'متأخرة / قابلة للتأخير', value: late.length + ' / ' + risk.length, unit: 'أوردر', compare: late.length ? 'negative' : 'neutral', delta: { text: late.length ? 'محتاج تدخّل' : 'تمام', caption: 'من ' + vn.size + ' موردين' }, note: 'التأخير بعد 11 يوم · قابل للتأخير من يوم 9', details: orderDetails('متأخرة / قابلة للتأخير', late.concat(risk)) }; }
      case 'actual': return { label: 'الحساب الفعلي', value: money(M.actual), unit: 'ج.م', note: 'بنك + بوسطة + باي موب', details: () => ({ title: 'الحساب الفعلي — ' + money(M.actual) + ' ج.م', headers: ['الحساب', 'الرصيد'], rows: Object.keys(M.acc).map((a) => [a, money(M.acc[a])]), actions: [{ label: 'فتح الحساب الفعلي', onClick: () => go('actual') }] }) };
      case 'ready': { const l = rows.filter((x) => x.status === 'جاهز للشحن' || x.status === 'قيد الشحن'); return { label: 'جاهز / قيد الشحن', value: String(l.length), unit: 'أوردر', note: 'جاهز للشحن ' + rows.filter((x) => x.status === 'جاهز للشحن').length + ' · قيد الشحن ' + rows.filter((x) => x.status === 'قيد الشحن').length, details: orderDetails('جاهز / قيد الشحن', l) }; }
      case 'consLate': { const l = (K.store.consolidations || []).filter((c) => daysAgo(c.since) >= 5); return { label: 'تجميع متأخر', value: String(l.length), unit: 'أوردر', compare: l.length ? 'negative' : 'neutral', delta: { text: l.length ? 'عدّى 5 أيام' : 'تمام', caption: 'في المخزن' }, note: (K.store.consolidations || []).length + ' تجميع مفتوح', details: () => ({ title: 'تجميع متأخر', headers: ['الأوردر', 'العميل', 'من', 'الأيام'], rows: l.map((c) => ['IB-' + c.order, c.customer, K.dlabel ? K.dlabel(c.since) : c.since, String(daysAgo(c.since))]), actions: [{ label: 'فتح التجميع', onClick: () => go('inventory-consolidate') }] }) }; }
      case 'returns': { const l = (K.store.returns || []).filter((x) => x.status === 'بانتظار الفحص'); return { label: 'مرتجعات بانتظار الفحص', value: String(l.length), unit: 'منتج', note: 'افحصها قبل ما ترجع المتاح', details: () => ({ title: 'مرتجعات بانتظار الفحص', headers: ['المنتج', 'المورد', 'السبب', 'وصل'], rows: l.map((x) => [x.name, x.vendor, x.reason, x.at]), actions: [{ label: 'فتح المرتجعات', onClick: () => go('inventory-returns') }] }) }; }
      case 'convWaiting': { const l = csData().convs.filter((c) => c.status === 'مستنية ردنا'); const over = l.filter((c) => c.waiting > 15).length; return { label: 'محادثات مستنية رد', value: String(l.length), unit: 'محادثة', compare: over ? 'negative' : 'neutral', delta: { text: over + ' عدّت الهدف', caption: 'الهدف 15 دقيقة' }, note: 'العملاء والمبتكرين والتعليقات', details: () => ({ title: 'محادثات مستنية رد', headers: ['المحادثة', 'مستنية من', 'المسؤول'], rows: l.map((c) => [c.who + ' · ' + c.platform, c.waiting + ' دقيقة', c.assignee || 'غير معيّنة']), actions: [{ label: 'فتح الرسايل', onClick: () => go('cs-inbox') }] }) }; }
      case 'firstReply': { const l = csData().convs.filter((c) => c.status === 'مستنية ردنا'); const avg = l.length ? Math.round(l.reduce((t, c) => t + c.waiting, 0) / l.length) : 0; return { label: 'متوسط الانتظار الحالي', value: String(avg), unit: 'دقيقة', compare: avg > 15 ? 'negative' : 'positive', delta: { text: avg > 15 ? '+' + (avg - 15) + ' د' : 'تمام', caption: 'عن هدف 15 دقيقة' }, note: 'للمحادثات المستنية دلوقتي' }; }
      case 'unconf': { const l = rows.filter((x) => x.confirm === 'غير مؤكد' && !['مكتمل', 'ملغي', 'استرجاع'].includes(x.status)); return { label: 'غير مؤكد', value: String(l.length), unit: 'أوردر', note: 'أوردرات مفتوحة محتاجة تأكيد', details: orderDetails('أوردرات غير مؤكدة', l) }; }
      case 'lateOrders': return { label: 'أوردرات متأخرة', value: String(late.length), unit: 'أوردر', compare: late.length ? 'negative' : 'neutral', delta: { text: late.length ? 'كلّم العميل' : 'تمام', caption: risk.length + ' قابل للتأخير' }, details: orderDetails('أوردرات متأخرة', late) };
      case 'rating': { const CS = window.IbtekrCS; const rated = csData().customers.map((c) => ({ c, r: c.manualRating ? { value: c.manualRating } : (CS ? CS.customerRating(c) : null) })).filter((x) => x.r); const avg = rated.length ? Math.round(rated.reduce((t, x) => t + x.r.value, 0) / rated.length * 10) / 10 : 0; const low = rated.filter((x) => x.r.value < 3);
        return { label: 'تقييم العملاء', value: String(avg), unit: 'من 5', compare: low.length ? 'negative' : 'neutral', delta: { text: low.length + ' أقل من 3', caption: 'محتاجين اهتمام' }, note: rated.length + ' عميل متقيّم تلقائي من أوردراتهم', details: () => ({ title: 'تقييم العملاء — متوسط ' + avg + ' من 5', headers: ['العميل', 'التقييم', 'أوردرات', 'مرتجع / رفض'], rows: rated.sort((a, b) => a.r.value - b.r.value).map((x) => [x.c.name, String(x.r.value), String(x.c.orders), (x.c.returned || 0) + ' / ' + (x.c.refused || 0)]), actions: [{ label: 'فتح العملاء', onClick: () => go('cs-customers') }] }) }; }
      case 'expenses': { const now = M.expNow.total > 0; const E = now ? M.expNow : M.expSept; const mon = now ? 'أكتوبر' : 'سبتمبر'; // the current month until it has entries, else the last closed month
        return { label: 'مصروفات ' + mon, value: money(E.total), unit: 'ج.م', note: now ? 'سبتمبر: ' + money(M.expSept.total) + ' ج.م' : 'أكتوبر لسه مفيش مصروفات متسجّلة', details: () => ({ title: 'مصروفات ' + mon, headers: ['النوع', 'المبلغ'], rows: Object.keys(E.byCategory).map((c) => [c, money(E.byCategory[c].amount)]), total: ['الإجمالي', money(E.total)], actions: [{ label: 'فتح المصروفات', onClick: () => go('expenses') }] }) }; }
      case 'vendorBal': return { label: 'رصيد الموردين (ليهم)', value: money(M.vs.positive), unit: 'ج.م', note: M.vs.positiveCount + ' ليهم · عند ' + M.vs.negativeCount + ' موردين ' + money(Math.abs(M.vs.negative)) + ' ج.م', details: () => ({ title: 'رصيد الموردين', headers: ['المورد', 'الرصيد'], rows: M.vendors.filter((v) => v.balance).sort((a, b) => b.balance - a.balance).map((v) => [v.name, money(v.balance)]), onRow: (i) => D.openVendorStatement(M.vendors.filter((v) => v.balance).sort((a, b) => b.balance - a.balance)[i].name) }) };
      case 'deposits': return { label: 'عرابين معلّقة', value: money(M.vs.deposits), unit: 'ج.م', note: 'مدفوعة للموردين ولسه الأوردر ماخلصش', details: () => ({ title: 'عرابين معلّقة', headers: ['المورد', 'العربون'], rows: M.vendors.filter((v) => v.deposits).map((v) => [v.name, money(v.deposits)]) }) };
      case 'payroll': { const p = M.payroll; return { label: 'المرتبات الجاية', value: p ? money(p.net) : '—', unit: 'ج.م', note: p ? (p.due && p.due.date ? 'يوم الصرف ' + p.due.date.split('-').reverse().join('/') + ' · ' : '') + 'الكشف «' + p.status + '»' : '', details: p ? () => ({ title: 'المرتبات الجاية — ' + money(p.net) + ' ج.م', sub: 'الكشف «' + p.status + '»', headers: ['الموظف', 'الدور', 'الصافي'], rows: p.slips.map((x) => [x.m.name, x.m.role, money(x.s.net)]), total: ['الإجمالي', '', money(p.net)], actions: [{ label: 'فتح كشف المرتبات', onClick: () => D.openPayrollAlert() }] }) : null }; }
      case 'vendorsLate': return { label: 'موردين متأخرين', value: String(S.al.lateVendors.length), unit: 'مورد', compare: S.al.lateVendors.length ? 'negative' : 'neutral', delta: { text: S.al.lateVendors.reduce((t, v) => t + v.count, 0) + ' أوردر', caption: 'متأخر عن مدة التصنيع' }, details: () => ({ title: 'موردين متأخرين', headers: ['المورد', 'أوردرات متأخرة'], rows: S.al.lateVendors.map((v) => [v.vendor, String(v.count)]), onRow: (i) => D.openVendorLate(S.al.lateVendors[i].vendor, 'late') }) };
      case 'vendorsRisk': return { label: 'موردين قابلين للتأخير', value: String(S.al.riskVendors.length), unit: 'مورد', note: S.al.riskVendors.reduce((t, v) => t + v.count, 0) + ' أوردر فرعي', details: () => ({ title: 'موردين قابلين للتأخير', headers: ['المورد', 'أوردرات'], rows: S.al.riskVendors.map((v) => [v.vendor, String(v.count)]), onRow: (i) => D.openVendorLate(S.al.riskVendors[i].vendor, 'risk') }) };
      case 'subsUnnotified': { const l = S.full.flatMap((o) => o.subs.filter((s) => s.open && !s.ss).map((s) => [o, s])); return { label: 'فرعي لسه متبلّغش', value: String(l.length), unit: 'أوردر فرعي', note: 'حالة الأوردر الفرعي فاضية', details: () => ({ title: 'أوردرات فرعية لسه متبلّغتش للمورد', headers: ['الأوردر', 'الفرعي', 'المنتج', 'المورد'], rows: l.map(([o, s]) => ['IB-' + o.id, '#' + s.sid, s.prod, s.vendor]), onRow: (i) => window.OrdersApp.details(l[i][0].id) }) }; }
      case 'contracts': { const all = D.contracts(); const bad = all.filter((c) => c.status === 'expiring' || c.status === 'expired'); const miss = all.filter((c) => c.status === 'missing'); const lab = { expiring: 'بيخلص قريب', expired: 'خلص', missing: 'مش مرفوع', uploaded: 'سليم' };
        return { label: 'عقود محتاجة متابعة', value: String(bad.length), unit: 'عقد', compare: bad.length ? 'negative' : 'neutral', delta: { text: bad.length ? 'جدّد' : 'تمام', caption: 'بتخلص خلال 30 يوم أو خلصت' }, note: miss.length + ' مورد من غير عقد مرفوع', details: () => ({ title: 'عقود الموردين', headers: ['المورد', 'العقد', 'ينتهي'], rows: bad.concat(miss).map((c) => [c.name, lab[c.status], c.expires ? K.dlabel(c.expires) : '—']), onRow: (i) => D.openVendor(bad.concat(miss)[i].name) }) }; }
      case 'nextStatement': { const nx = nextStatement(); return { label: 'كشف الحساب الجاي', value: nx ? K.dlabel(nx) : '—', note: (M.cycle || 'كل أسبوعين') + (nx ? ' · فاضل ' + K.daysBetween(K.TODAY, nx) + ' يوم' : ''), details: () => ({ title: 'كشوف حساب الموردين', sub: 'الكشف الجاي ' + (nx ? K.dlabel(nx) : '—'), headers: ['المورد', 'الرصيد'], rows: M.vendors.filter((v) => v.balance).map((v) => [v.name, money(v.balance)]), onRow: (i) => D.openVendorStatement(M.vendors.filter((v) => v.balance)[i].name) }) }; }
      case 'myTasks': { const l = myTasks(); return { label: 'مهامي', value: String(l.filter((t) => !t.done).length), unit: 'مهمة', note: l.filter((t) => t.done).length + ' خلصت النهارده' }; }
      case 'mentions': { const s = S.sections.find((x) => x.id === 'messages'); const n = s ? (s.tabs.find((t) => t[0] === 'mention') || [0, 0, []])[2].length : 0; return { label: 'منشن', value: String(n), unit: 'رسالة', note: 'من الرسايل والتذاكر' }; }
      case 'photo': { const l = K.stockNow().filter((x) => /تصوير/.test(x.reason + ' ' + x.status)); return { label: 'منتجات في التصوير', value: String(l.length), unit: 'منتج', note: 'في مخزن إبتكر' }; }
    }
    return null;
  }
  const nextStatement = () => { const a = K.store.accAlerts || {}; return a.cycle === 'monthDays' ? DD.nextMonthDay(K.TODAY, a.days || []) : null; };
  const myTasks = () => (K.store.tasks || []).filter((t) => t.member === me().id);

  // ---------- cards ----------
  const card = (id, title, sub, body, foot, cls) => h('section', { class: 'card dash-card dc-' + id + (cls ? ' ' + cls : ''), 'aria-labelledby': 'dh-' + id, 'data-card': id },
    h('div', { class: 'dash-h' }, h('h2', { class: 't-h5', id: 'dh-' + id }, title), sub ? h('span', { class: 't-small' }, sub) : null), h('div', { class: 'dash-b' }, body), foot ? h('div', { class: 'dash-f t-small' }, foot) : null);
  const kv = (pairs) => h('dl', { class: 'dash-kv' }, pairs.filter(Boolean).map(([k, v, cls]) => h('div', { class: 'dkv' + (cls ? ' ' + cls : '') }, h('dt', { class: 't-small' }, k), h('dd', null, v))));
  const nameBtn = (label, run, aria) => h('button', { type: 'button', class: 'dash-name', onClick: run, 'aria-label': aria || label }, label);
  const link = (label, run) => h('button', { type: 'button', class: 'dash-link', onClick: run }, label, Icon('chevL', 'sm'));
  const TONE_IC = { error: 'alert', orange: 'clock', warning: 'clock', info: 'bell' };

  function daily() {
    const m = me(); const hs = hrApi() && hrApi().status ? hrApi().status(m) : null; const sh = shell(); const ro = !!st.viewAs;
    const tasks = myTasks();
    return card('daily', 'يومي', 'دوامي ومهامي', [
      h('div', { class: 'dash-shift' }, Icon('clock', 'sm'), h('span', null, hs ? K.Tag(hs[1], hs[0]) : null), !ro && m.id === K.ME ? Button({ size: 'sm', label: sh.state === 'in' ? 'إنهاء الدوام' : 'ابدأ الدوام', onClick: () => { if (sh.state === 'in') window.IBShell.endShift(); else window.IBShell.clockIn(); setTimeout(render, 50); } }) : null),
      tasks.length ? h('div', { class: 'dash-tasks' }, tasks.slice(0, 5).map((t) => K.Checkbox({ label: t.title, checked: !!t.done, disabled: ro, onChange: (v) => { t.done = v; K.logEvent('task.' + (v ? 'done' : 'undo'), t.title); render(); } }))) : K.Empty('مفيش مهام النهارده', 'ضيف مهمة من «ملفي»')],
      link('مهامي كلها في «ملفي»', () => go('profile-tasks')));
  }
  function need(S) {
    const r = DD.topNeed(S.sections, 5);
    const body = r.total ? h('div', { class: 'dash-need' }, r.items.map((it) => h('button', { type: 'button', class: 'dn-item tone-' + (it.tone || 'info'), onClick: () => { if (it.run) it.run(); else document.querySelector('.notif-btn') && document.querySelector('.notif-btn').click(); } },
      h('span', { class: 'dn-ic' }, Icon(TONE_IC[it.tone] || 'bell', 'sm')), h('span', { class: 'dn-txt' }, h('b', null, it.title), h('small', { class: 't-small' }, it.sub || '')), h('span', { class: 'dn-sec t-small' }, it.section))))
      : K.Empty('كله تمام', 'مفيش حاجة محتاجة منك دلوقتي — التنبيهات بتظهر هنا أول ما تحصل.');
    return card('need', 'محتاج منك دلوقتي', 'أهم ' + Math.min(5, r.total) + ' تنبيهات من اللي دورك بيستلمها — بالأولوية', body, r.total ? link('عرض كل التنبيهات (' + r.total + ')', () => { const b = document.querySelector('.notif-btn'); if (b) b.click(); }) : null);
  }
  function weeks(S) {
    const w = S.rep.weekly.slice(-5); const max = Math.max(1, ...w.map((x) => x.count));
    return card('weeks', 'الأوردرات آخر 5 أسابيع', 'عدد الأوردرات · الأسبوع يبدأ السبت', h('div', { class: 'cols', role: 'img', 'aria-label': w.map((x) => x.label + ': ' + x.count).join('، ') }, w.map((x) => h('div', { class: 'col' + (x.count === max ? ' hi' : '') }, h('span', { class: 't-label' }, num(String(x.count))), h('i', { style: 'height:' + Math.max(6, Math.round(x.count / max * 140)) + 'px' }), h('span', { class: 't-small' }, num(x.label))))),
      'الأحدث على اليسار · الأسبوع الأعلى بالأخضر · بتتغيّر مع «الفترة»');
  }
  function health(S) {
    const H = S.health; const F = { progress: { st: 'جاري التنفيذ' }, shipping: { st: 'قيد الشحن' }, unconf: { conf: 'غير مؤكد' }, risk: { deliv: 'risk' }, late: { deliv: 'late' } };
    return card('health', 'صحة العمليات النهارده', H.open + ' أوردر مفتوح', h('div', { class: 'dash-bars' }, H.rows.map((r) => h('button', { type: 'button', class: 'dash-barbtn', 'aria-label': r.label + ': ' + r.count + ' — فتح في الأوردرات', onClick: () => DATA().showOrders(F[r.key]) }, U.BarRow({ tone: r.tone, label: r.label, value: r.key === 'progress' || r.key === 'shipping' ? String(r.count) : r.count + ' (' + Math.round(r.pct * 100) + '%)', pct: r.pct })))),
      'كل سطر بيفتح الأوردرات متفلترة بالحالة دي');
  }
  function confirmCard(S) { const n = S.conf.count || 1; return card('confirm', 'حالة التأكيد', 'أوردرات آخر 30 يوم', h('div', { class: 'dash-bars' }, S.conf.byConfirm.map(([l, c], i) => U.BarRow({ tone: ['brand', 'gold', 'goldlight', 'neutral'][i] || 'neutral', label: l, value: c + ' (' + Math.round(c / n * 100) + '%)', pct: c / n }))), link('فتح غير المؤكد', () => DATA().showOrders({ conf: 'غير مؤكد' }))); }
  function followCustomers(S) { const s = S.sections.find((x) => x.id === 'customers'); const items = s ? s.tabs[0][2].filter((x) => !x.muted).slice(0, 5) : [];
    return card('followCustomers', 'عملاء محتاجين متابعة', 'متأخرة · معلّقة · مستنية ردهم', items.length ? h('div', { class: 'dash-need' }, items.map((it) => h('button', { type: 'button', class: 'dn-item tone-' + (it.tone || 'info'), onClick: () => it.run && it.run() }, h('span', { class: 'dn-ic' }, Icon('users', 'sm')), h('span', { class: 'dn-txt' }, h('b', null, it.title), h('small', { class: 't-small' }, it.sub || ''))))) : K.Empty('مفيش عملاء محتاجين متابعة', 'تمام كده')); }
  function stockToday() { const S2 = K.stockNow(); const cons = K.store.consolidations || []; const ret = (K.store.returns || []).filter((x) => x.status === 'بانتظار الفحص');
    return card('stockToday', 'المخزن النهارده', 'مخزن إبتكر المؤقت', kv([['في المخزن', num(String(S2.length)) ], ['تجميع مفتوح', num(String(cons.length))], ['تجميع عدّى 5 أيام', num(String(cons.filter((c) => daysAgo(c.since) >= 5).length)), 'warn'], ['مرتجعات بانتظار الفحص', num(String(ret.length))], ['تصوير', num(String(S2.filter((x) => /تصوير/.test(x.reason + ' ' + x.status)).length))]]), link('فتح المخزن', () => go('inventory-now'))); }
  function moneyCard(S) { const M = S.money; const p = M.payroll;
    return card('money', 'الفلوس', 'الأرصدة لحظة بلحظة · للأدمن والحسابات بس', kv([['الحساب الفعلي', num(money(M.actual) + ' ج.م')], ['رصيد الموردين (ليهم)', num(money(M.vs.positive) + ' ج.م')], ['رصيد عند الموردين (عليهم)', num(money(M.vs.negative) + ' ج.م'), 'neg'], ['عرابين معلّقة', num(money(M.vs.deposits) + ' ج.م')], ['المواصلات (موردين + تشغيل)', num(money(M.transport.total) + ' ج.م')], ['المرتبات الجاية', p ? h('span', null, p.due && p.due.date ? num(p.due.date.slice(8) + '/' + p.due.date.slice(5, 7)) : null, p.due && p.due.date ? ' · ' : null, num(money(p.net) + ' ج.م'), ' · ' + p.status) : '—']]),
      link('فتح الحساب الفعلي', () => go('actual'))); }
  function expByType(S) { const E = S.money.expSept; const tot = E.total || 1; const cats = Object.keys(E.byCategory);
    return card('expByType', 'مصروفات الشهر حسب النوع', 'سبتمبر 2026 · ' + money(E.total) + ' ج.م', h('div', { class: 'dash-bars' }, cats.map((c, i) => U.BarRow({ tone: ['brand', 'gold', 'goldlight', 'neutral'][i] || 'neutral', label: c, value: money(E.byCategory[c].amount), pct: E.byCategory[c].amount / tot }))), link('فتح المصروفات', () => go('expenses'))); }
  function vendorsCard(S) { const m = new Map(); S.al.lateVendors.forEach((v) => m.set(v.vendor, { late: v.count, risk: 0 })); S.al.riskVendors.forEach((v) => { const x = m.get(v.vendor) || { late: 0, risk: 0 }; x.risk = v.count; m.set(v.vendor, x); });
    const list = [...m.entries()].sort((a, b) => b[1].late - a[1].late || b[1].risk - a[1].risk).slice(0, 6);
    const lab = { expiring: 'بيخلص قريب', expired: 'خلص' }; const cons = DATA().contracts().filter((c) => c.status === 'expiring' || c.status === 'expired').slice(0, 2);
    const contractRows = cons.map((c) => { const d = c.expires ? K.daysBetween(K.TODAY, c.expires) : null; return h('button', { type: 'button', class: 'dn-item tone-' + (c.status === 'expired' ? 'error' : 'warning'), onClick: () => DATA().openVendor(c.name) }, h('span', { class: 'dn-ic' }, Icon('clock', 'sm')), h('span', { class: 'dn-txt' }, h('b', null, 'عقد ' + c.name + ' ' + (c.status === 'expired' ? 'خلص' : d != null ? 'بيخلص خلال ' + d + ' يوم' : lab[c.status])), h('small', { class: 't-small' }, 'جدّد العقد أو غيّر الحالة')), h('span', { class: 'dn-sec t-small' }, 'عقود')); });
    return card('vendors', 'الموردين المحتاجين متابعة', 'الأكتر تأخيرًا + عقود بتخلص', list.length || contractRows.length ? h('div', { class: 'dash-vend' }, list.length ? U.Table({ headers: ['المورد', 'متأخر', 'قابل للتأخير'], rows: list.map(([n, x]) => [nameBtn(n, () => DATA().openVendorLate(n, 'all'), 'أوردرات ' + n + ' المتأخرة والقابلة للتأخير'), num(String(x.late)), num(String(x.risk))]) }) : null, contractRows.length ? h('div', { class: 'dash-need' }, contractRows) : null) : K.Empty('مفيش موردين متأخرين', 'كل الموردين في المعاد والعقود سليمة'), link('صفحة المبتكرين', () => go('makers'))); }
  function statements(S) { const M = S.money; const list = M.vendors.filter((v) => v.balance).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 5);
    const nx = nextStatement(); return card('statements', 'كشوف حساب الموردين', (nx ? 'الكشف الجاي ' + K.dlabel(nx) + ' · ' : '') + (M.cycle || ''), U.Table({ headers: ['المورد', 'الرصيد (ج.م)'], rows: list.map((v) => [nameBtn(v.name, () => DATA().openVendorStatement(v.name), 'كشف حساب ' + v.name), h('span', { class: v.balance < 0 ? 'neg' : 'pos' }, num(money(v.balance)))]) }), link('حسابات الموردين', () => go('vendors'))); }
  function team() { const hr = hrApi(); const list = K.team().filter((m) => m.id !== K.ME); const pend = (K.store.requests || []).filter((r) => r.status === 'جديد').length;
    return card('team', 'الفريق دلوقتي', 'مين في الدوام + الطلبات المستنية', h('div', { class: 'dash-team' }, list.map((m) => { const s = hr && hr.status ? hr.status(m) : ['—', 'neutral']; return h('div', { class: 'dt-row' }, U.Avatar(m.name), h('span', { class: 'dt-name' }, h('b', null, m.name), h('small', { class: 't-small' }, m.role)), K.Tag(s[1], s[0])); })),
      link(pend + ' طلبات مستنية ردك', () => go('hr-requests'))); }
  function system() { const ch = csData().channels || {}; const ints = pages().settings && pages().settings.api.integrations ? pages().settings.api.integrations() : [];
    const never = (x) => /مش مربوط|لم يتم الربط/.test(x || '');
    const items = Object.keys(ch).filter((k) => ch[k].status !== 'connected' && !never(ch[k].last)).map((k) => ({ tone: ch[k].status === 'error' ? 'error' : 'warning', title: ch[k].name + (ch[k].status === 'error' ? ' — فصل' : ' — مفصول'), sub: ch[k].last, run: () => go('cs-channels') }))
      .concat(ints.filter((i) => i.status && i.status !== 'متصل' && !never(i.last) && !/واتساب|WhatsApp|Meta|Instagram|TikTok/i.test(i.name)).map((i) => ({ tone: /خطأ/.test(i.status) ? 'error' : 'warning', title: i.name + ' — ' + i.status, sub: i.last, run: () => go('settings-integrations') })))
      .concat(ints.filter((i) => i.status === 'متصل' && /WooCommerce|Airtable/.test(i.name)).map((i) => ({ tone: 'ok', title: i.name + ' — متزامن', sub: i.last, run: () => go('settings-integrations') })));
    const bk = pages().settings && pages().settings.api.backup ? pages().settings.api.backup() : null;
    items.push(bk && bk.daily ? { tone: 'ok', title: 'نسخة احتياطية', sub: 'اليوم 03:00 · نجحت', run: () => go('settings-data') } : { tone: 'warning', title: 'النسخ الاحتياطي اليومي مقفول', sub: 'شغّله من الإعدادات › البيانات', run: () => go('settings-data') });
    return card('system', 'تنبيهات النظام', 'الربط والقنوات', items.length ? h('div', { class: 'dash-need' }, items.slice(0, 5).map((it) => h('button', { type: 'button', class: 'dn-item tone-' + it.tone, onClick: it.run }, h('span', { class: 'dn-ic' }, Icon(it.tone === 'error' ? 'alert' : it.tone === 'ok' ? 'check' : 'link', 'sm')), h('span', { class: 'dn-txt' }, h('b', null, it.title), h('small', { class: 't-small' }, it.sub || ''))))) : K.Empty('كل الربط شغال', 'الأوردرات والقنوات متزامنة'), link('الإعدادات › الربط بالمنصات', () => go('settings-integrations'))); }
  // a server timestamp in local time: the same day → «اليوم HH:MM», the day before → «أمس HH:MM», else «DD/MM HH:MM»
  const fmtAt = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const t = new Date(); const hm = p(d.getHours()) + ':' + p(d.getMinutes()); return day(d) === day(t) ? 'اليوم ' + hm : day(d) === new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1).getTime() ? 'أمس ' + hm : p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + hm; };
  function activity() {
    const ACT = { 'dashboard.viewAs': 'عرض لوحة موظف', 'dashboard.customize': 'تخصيص اللوحة', 'task.done': 'خلّص مهمة', 'task.undo': 'رجّع مهمة', 'auth.signin': 'سجّل دخول', 'auth.signout': 'سجّل خروج', 'auth.2fa': 'تحقق بخطوتين', 'auth.password.set': 'غيّر كلمة المرور', 'auth.signoutAll': 'خروج من كل الأجهزة' };
    const now = (K.store.activity || []).map((a) => ({ who: a.actor, what: (ACT[a.action] || a.action) + (a.detail ? ' — ' + a.detail : ''), at: 'اليوم ' + String(a.at || '').slice(-5) }));
    const seed = (pages().settings && pages().settings.api.activityLog ? pages().settings.api.activityLog() : []).map((r) => ({ who: r[1], what: r[3] + (r[4] ? ' — ' + (typeof r[4] === 'string' ? r[4] : '') : ''), at: r[0] }));
    const mine = role() === 'أدمن' ? null : me().name; // admin sees everyone; every other role sees its own actions
    // signed in (IBActivity.cached() not null): the server log only, newest first, under the same own-actions rule. Otherwise the prototype's events
    const srv = window.IBActivity ? window.IBActivity.cached() : null;
    const rows = srv ? srv.map((r) => ({ who: r.actor, what: (ACT[r.action] || r.action) + (r.detail ? ' — ' + r.detail : ''), at: fmtAt(r.at) })) : now.concat(seed);
    const list = rows.filter((a) => !mine || a.who === mine).slice(0, 5);
    return card('activity', 'آخر نشاط', mine ? 'آخر 5 حاجات عملتها' : 'آخر 5 حركات في السيستم', list.length ? h('div', { class: 'dash-act' }, list.map((a) => h('div', { class: 'da-row' }, h('small', { class: 't-small' }, a.who + ' · ' + a.at), h('span', null, a.what)))) : K.Empty('لسه مفيش نشاط النهارده', 'أي تعديل في السيستم هيظهر هنا'), link('سجل النشاط كامل', () => go('settings-activity'))); }
  const CARDS = { daily, need, weeks, health, confirm: confirmCard, followCustomers, stockToday, money: moneyCard, expByType, vendors: vendorsCard, statements, team, system, activity };

  // ---------- header controls ----------
  function quickActions() {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = Button({ type: 'brand', label: '+ إجراء سريع', attrs: { 'aria-haspopup': 'menu', 'data-qa': '' } });
    const D = DATA(); const run = { expense: D.addExpense, vendorMove: D.addVendorMove, vendor: D.addVendor, ticket: () => D.newTicket(), vendorReport: vendorReportPick, clock: () => { const s = shell(); if (s.state === 'in') window.IBShell.endShift(); else window.IBShell.clockIn(); setTimeout(render, 50); }, leave: () => hrApi() && hrApi().leaveRequest(K.member(K.ME)), notifs: () => { const b = document.querySelector('.notif-btn'); if (b) b.click(); } };
    const acts = DD.quickActions(K.member(K.ME).role);
    const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: acts.map((a) => ({ value: a.id, label: a.label, icon: a.icon })), onSelect: (v) => { close(); setTimeout(() => run[v] && run[v]()); } }));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  function vendorReportPick() { K.form({ title: 'تقرير مورد', values: {}, fields: (f, e, set) => [K.field.select('v', 'المورد', DATA().vendorNames(), f, e, set, { required: true })], validate: (f) => K.req(f, ['v']), submitLabel: 'فتح التقرير', submit: (f) => { setTimeout(() => DATA().openVendorReport(f.v)); } }); }
  function viewAsSelect() {
    const list = K.team().filter((m) => m.status === 'active' || !m.status);
    return h('div', { class: 'inline-sel dash-viewas' }, U.Select({ id: 'dash-viewas', label: '', options: [{ value: K.ME, label: 'عرض كـ: ' + K.member(K.ME).name + ' — أدمن' }].concat(list.filter((m) => m.id !== K.ME).map((m) => ({ value: m.id, label: m.name + ' — ' + m.role }))), value: st.viewAs || K.ME, onChange: (v) => setView(v === K.ME ? null : v) }));
  }
  function setView(id) { st.viewAs = id; if (NR()) NR().setViewer(id || K.ME); render(); document.dispatchEvent(new Event('ib:notify')); } // read-only view: not a data change, so not in the activity log
  function customize() {
    const owner = K.ME; const L = DD.layout(K.member(owner).role, prefsOf(owner));
    // saved per user on the server (IBPrefs → user_prefs, owner-only RLS); a refused write keeps the change on this device
    const synced = (r) => { if (!r.ok) K.toast('اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر', 'error'); };
    K.form({ title: 'تخصيص اللوحة', wide: true, values: { list: L.map((c) => ({ id: c.id, label: c.label, locked: c.locked, hidden: c.hidden })) },
      note: U.InlineNote({ children: 'اختار الكروت اللي تظهر ورتّبها بالأسهم. «محتاج منك دلوقتي» مايتشالش. التخصيص بيتحفظ ليك انت بس.' }),
      fields: (f, e, set) => [h('div', { class: 'dash-cust', role: 'list' }, f.list.map((c, i) => h('div', { class: 'dc-row', role: 'listitem' },
        h('span', { class: 'dc-ord' }, Button({ type: 'text', size: 'sm', label: '↑', disabled: i === 0, attrs: { 'aria-label': 'لفوق — ' + c.label }, onClick: () => { const l = f.list.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; set('list', l, true); } }), Button({ type: 'text', size: 'sm', label: '↓', disabled: i === f.list.length - 1, attrs: { 'aria-label': 'لتحت — ' + c.label }, onClick: () => { const l = f.list.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; set('list', l, true); } })),
        h('span', { class: 'dc-l' }, h('b', null, c.label), c.locked ? h('small', { class: 't-small help' }, 'مقفول — دايمًا ظاهر') : null),
        K.Switch({ id: 'dc-' + c.id, label: c.label, checked: !c.hidden, disabled: c.locked, onChange: (v) => { c.hidden = !v; set('list', f.list.slice(), true); } }))))],
      extraFooter: (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'text', label: 'رجوع للافتراضي', onClick: () => { delete K.store.dashPrefs[owner]; if (window.IBPrefs) window.IBPrefs.remove('dashboard').then(synced); K.toast('رجعت اللوحة للافتراضي'); m.close(); render(); } })),
      submitLabel: 'حفظ', submit: (f) => { K.store.dashPrefs = K.store.dashPrefs || {}; K.store.dashPrefs[owner] = { order: f.list.map((c) => c.id), hidden: f.list.filter((c) => c.hidden).map((c) => c.id) }; if (window.IBPrefs) window.IBPrefs.set('dashboard', K.store.dashPrefs[owner]).then(synced); K.logEvent('dashboard.customize', f.list.filter((c) => !c.hidden).length + ' كارت'); K.toast('اتحفظ تخصيص اللوحة', 'success'); render(); } });
  }

  // ---------- view ----------
  function render() { if (window.IBPages.current === 'dashboard') window.IBPages.render('dashboard'); }
  function refresh() { st.loading = true; render(); setTimeout(() => { st.loading = false; st.updated = K.clockNow(); render(); }, 500); }
  function skeleton() { return h('div', { class: 'dash-skel', 'aria-busy': 'true', 'aria-label': 'بيحمّل' }, h('div', { class: 'dash-kpis' }, [1, 2, 3, 4, 5].map(() => h('div', { class: 'card sk sk-kpi' }))), h('div', { class: 'dash-grid' }, [1, 2, 3, 4].map(() => h('div', { class: 'card sk sk-card' })))); }
  function view() {
    const m = me(); const r = role(); const D = DATA(); st.updated = st.updated || K.clockNow();
    const min = new Date().getHours() * 60 + new Date().getMinutes();
    const head = h('div', { class: 'page-head row dash-head' }, h('div', null, h('h1', { class: 't-h3' }, 'لوحة التحكم'),
        h('p', { class: 't-small dash-hi' }, Icon('clock', 'sm'), DD.greeting(min) + ' يا ' + K.member(K.ME).name.split(' ')[0] + ' · ' + K.dayName(K.TODAY) + ' ' + K.dlabel(K.TODAY) + ' · ', h('span', { 'aria-live': 'polite' }, 'آخر تحديث ' + st.updated), ' — بيتحدّث كل 5 دقايق ', h('button', { type: 'button', class: 'dash-link', onClick: refresh, 'aria-label': 'تحديث دلوقتي' }, Icon('refresh', 'sm'), 'تحديث'))),
      h('div', { class: 'actions' }, quickActions(), Button({ label: 'تخصيص اللوحة', icon: 'sliders', onClick: customize, disabled: !!st.viewAs, attrs: st.viewAs ? { title: 'رجّع للوحتك الأول عشان تخصصها' } : null }), h('div', { class: 'dash-period' }, D.DateRangeField()), isAdminReal() ? viewAsSelect() : null));
    const out = [head];
    if (st.viewAs) out.push(h('div', { class: 'dash-viewing', role: 'status' }, Icon('eye', 'sm'), h('span', null, 'بتشوف لوحة ', h('b', null, m.name), ' (' + m.role + ') — للقراءة بس، والجرس كمان بعينه'), Button({ size: 'sm', label: 'رجوع للوحتي', onClick: () => setView(null) })));
    if (st.loading) { out.push(skeleton()); return out; }
    let S;
    try { if (st.error) throw new Error('sim'); S = snapshot(); st.last = S; }
    catch (e) { out.push(U.InlineNote({ kind: 'error', children: 'معرفناش نحدّث البيانات — بنعرض آخر بيانات اتحدثت الساعة ' + st.updated + '.' }), Button({ label: 'إعادة المحاولة', onClick: () => { st.error = false; refresh(); } })); S = st.last; if (!S) return out; }
    const prefsOwner = st.viewAs || K.ME; const L = DD.layout(r, prefsOf(prefsOwner)).filter((c) => !c.hidden);
    const grid = h('div', { class: 'dash-grid' }); const ids = [];
    L.forEach((c) => {
      if (c.id === 'kpis') { const tiles = DD.kpisFor(r).filter((k) => !(DD.MONEY_KPIS.includes(k) && !S.money)); out.push(h('div', { class: 'dash-kpis', role: 'region', 'aria-label': 'المؤشرات', style: '--n:' + Math.max(3, tiles.length) }, DD.kpisFor(r).map((k) => { if (DD.MONEY_KPIS.includes(k) && !S.money) return null; const p = kpi(k, S); return p ? U.KpiTile(p) : null; }).filter(Boolean))); return; }
      if (['money', 'expByType', 'statements'].includes(c.id) && !S.money) return;
      if (CARDS[c.id]) ids.push(c.id);
    });
    DD.packRows(ids).forEach(([id, span]) => { const el = CARDS[id](S); el.style.setProperty('--span', span); grid.append(el); });
    out.push(grid, h('p', { class: 't-small dash-src' }, 'المصادر: الأوردرات (Airtable) · الحسابات (شيت Monthly Performance) · المبتكرين · الموارد البشرية · خدمة العملاء · المخزن — الأرقام بتتحدّث كل 5 دقايق · كل كارت قابل للضغط'));
    return out;
  }
  // the server log changed (IBActivity.refresh): redraw «آخر نشاط», unless an overlay is open (the 5-minute refresh's guard; the AI
  // panel is a [role=dialog] that stays in the DOM while closed, hence :not([hidden]))
  document.addEventListener('ib:activity', () => { if (!document.querySelector('.scrim,.menu,[role=dialog]:not([hidden])')) render(); });
  // server alerts changed (IBAlerts load / mark read / Realtime insert): redraw «محتاج منك دلوقتي», same guard
  document.addEventListener('ib:notify', () => { if (!document.querySelector('.scrim,.menu,[role=dialog]:not([hidden])')) render(); });
  // auto refresh every 5 minutes while the dashboard is open
  setInterval(() => { if (window.IBPages.current === 'dashboard' && !document.querySelector('.scrim,.menu,[role=dialog]:not([hidden])')) { st.updated = K.clockNow(); render(); } }, 5 * 60 * 1000);
  window.IBPages.register('dashboard', { title: 'لوحة التحكم', hash: (hs) => /^(dashboard)?$/.test(hs), defaultHash: () => 'dashboard', view, canLeave: (proceed) => { if (st.viewAs) { st.viewAs = null; if (NR()) NR().setViewer(K.ME); } proceed(); },
    api: { setView, refresh, simulateError: (on) => { st.error = !!on; render(); }, state: st, customize } });
})();

