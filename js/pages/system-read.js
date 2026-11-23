/* The system's read-outs in the header assistant (the owner 22 Nov — «لو طلبت حساب مبتكر منتج او موظف او تقرير معين»). Not a block.
   The engine (system-brain.js) names the ask; this file reads what the page already holds — under the member's own rights —
   and says it: one sentence, and a part for «تفاصيل» / «تنزيل Excel». No model behind it, and no number of its own:
     IBSystemRead.run(cmd, d) → Promise<{ text, part?, pick? }>
       cmd: { type: 'readMaker', vendor } | { type: 'readPeriod', what: sales|expenses|orders|summary, preset }
          | { type: 'readProduct', q } | { type: 'readMember', q }
       d (given by the app): barred(page), single(), accReady() → Promise<bool> (the accounts' rows are in, false = not the
          member's), makers() (the rows of «حسابات المبتكرين»), withdrawalOf(name), orders() (the orders' rows),
          ordersReport(range), salesOf(from, to) → { loading, sv }, expenses(), range(preset), dateLong(iso), wait(fn, ms),
          norm(text)
   part: { title, sub, note, chips: [[label, value]], tables: [{ title, headers, rows }], subs: [] } — the shape the assistant's
   report popup and its Excel already draw. */
(function () {
  'use strict';
  const EN = window.IB_LANG === 'en'; const tx = (ar, en) => (EN ? en : ar);
  const money = (n) => (n == null || !isFinite(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-US') + tx(' ج.م', ' EGP'));
  const num = (n) => Math.round(Number(n) || 0);
  const part = (title, sub, chips, tables) => ({ title, sub: sub || '', note: '', chips: chips || [], tables: tables || [], subs: [] });
  const CLOSED = ['مكتمل', 'ملغي', 'استرجاع', 'فشل'];
  const DELIV = { late: tx('متأخر', 'Late'), risk: tx('قابل للتأخير', 'At risk'), ok: tx('في ميعاده', 'On time') };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  async function maker(cmd, d) {
    if (d.single()) return { text: tx('المتجر ده بيبيع لحسابه — مفيش حسابات مبتكرين.', 'This store sells on its own — there are no makers’ accounts.') };
    if (d.barred('vendors') && d.barred('accounts')) return { text: tx('بيانات المبتكرين مش من صلاحياتك.', 'The makers’ data is not within your permissions.') };
    const acc = await d.accReady(); const v = d.makers().find((x) => x.name === cmd.vendor) || (acc ? null : { name: cmd.vendor });
    if (!v) return { text: tx('مالقيتش المبتكر «' + cmd.vendor + '» في السيستم.', 'I couldn’t find the maker “' + cmd.vendor + '” in the system.') };
    const rows = d.barred('orders') ? [] : d.orders().filter((r) => (r.vendors || []).includes(v.name)); const open = rows.filter((r) => !CLOSED.includes(r.status)); const late = open.filter((r) => r.delivery === 'late').length;
    const chips = d.barred('orders') ? [] : [[tx('أوردرات مفتوحة', 'Open orders'), open.length], [tx('متأخرة', 'Late'), late], [tx('كل الأوردرات', 'All orders'), rows.length]]; let said = '';
    if (acc) {
      const owes = num((v.deposits || 0) + (v.transport || 0) + (v.other || 0) + (v.carry || 0) - (v.corrections || 0)); const wd = d.withdrawalOf(v.name);
      chips.unshift([tx('رصيد Dokan', 'Dokan balance'), v.dokanBalance == null ? '—' : money(v.dokanBalance)], [tx('عرابين', 'Deposits'), money(v.deposits || 0)], [tx('مواصلات', 'Transport'), money(v.transport || 0)], [tx('عليه', 'Deductions'), money(owes)], [tx('الصافي', 'Net'), money(v.balance)]);
      if (wd) chips.push([tx('طلب سحب مستني', 'Pending withdrawal'), money(wd.amount)]);
      said = (v.dokanBalance == null ? tx('مالوش رصيد مقري من Dokan', 'no balance read from Dokan') : tx('رصيد Dokan ', 'Dokan balance ') + money(v.dokanBalance))
        + (owes ? tx('، عليه ', ', deductions ') + money(owes) : tx('، مفيش عليه خصومات', ', no deductions')) + tx('، والصافي ', ', net ') + money(v.balance) + '.'
        + (wd ? tx(' وفيه طلب سحب مستني بـ ', ' A withdrawal request of ') + money(wd.amount) + tx('.', ' is pending.') : '') + ' ';
    }
    const ord = d.barred('orders') ? '' : tx('أوردراته المفتوحة ' + open.length + (late ? '، منهم ' + late + ' متأخر' : '') + '.', 'Open orders: ' + open.length + (late ? ', ' + late + ' late' : '') + '.');
    return { text: tx('حساب ' + v.name + ': ', v.name + '’s account: ') + said + ord,
      part: part(tx('حساب ' + v.name, v.name + '’s account'), tx('الأرقام دلوقتي', 'The numbers now'), chips, open.length ? [{ title: tx('الأوردرات المفتوحة', 'Open orders'), headers: [tx('رقم الأوردر', 'Order'), tx('الحالة', 'Status'), tx('التسليم', 'Delivery'), tx('الإجمالي', 'Total')], rows: open.slice(0, 30).map((r) => [String(r.id), r.status, DELIV[r.delivery] || '', num(r.total)]) }] : []) };
  }

  async function period(cmd, d) {
    const r = d.range(cmd.preset); const sub = r.from === r.to ? d.dateLong(r.from) : d.dateLong(r.from) + ' – ' + d.dateLong(r.to); const inP = (x) => x >= r.from && x <= r.to;
    const chips = [], lines = [], tables = []; const all = cmd.what === 'summary';
    const name = { sales: tx('مبيعات', 'Sales'), expenses: tx('مصروفات', 'Expenses'), orders: tx('أوردرات', 'Orders'), summary: tx('ملخص', 'Summary') }[cmd.what];
    const out = () => ({ text: name + ' ' + sub + ': ' + lines.join('. ') + '.', part: part(name, sub, chips, tables) });
    if (cmd.what === 'orders' || all) {
      if (d.barred('orders')) { if (!all) return { text: tx('الأوردرات مش من صلاحياتك.', 'Orders are not within your permissions.') }; }
      else { const o = d.ordersReport(r);
        lines.push(tx(o.count + ' أوردر بإجمالي ' + money(o.total) + ' — مكتمل ' + o.completed + '، ملغي ' + o.cancelled + '، محتاج إجراء ' + o.needAction, plural(o.count, 'order', 'orders') + ' totalling ' + money(o.total) + ' — ' + o.completed + ' completed, ' + o.cancelled + ' cancelled, ' + o.needAction + ' need action'));
        chips.push([tx('الأوردرات', 'Orders'), o.count], [tx('إجمالي الأوردرات', 'Orders total'), money(o.total)], [tx('مكتمل', 'Completed'), o.completed], [tx('ملغي', 'Cancelled'), o.cancelled], [tx('محتاج إجراء', 'Need action'), o.needAction]);
        if (!all && o.rows.length) tables.push({ title: tx('الأوردرات', 'Orders'), headers: [tx('رقم الأوردر', 'Order'), tx('الحالة', 'Status'), tx('التأكيد', 'Confirmation'), tx('الإجمالي', 'Total')], rows: o.rows.slice(0, 40).map((x) => [String(x.id), x.status, x.confirm || '', num(x.total)]) }); }
    }
    if (cmd.what !== 'orders') {
      if (!(await d.accReady())) return all && lines.length ? out() : { text: tx('الحسابات مش من صلاحياتك.', 'Accounts are not within your permissions.') };
      if (cmd.what === 'sales' || all) {
        const x = await d.wait(() => { const a = d.salesOf(r.from, r.to); return a.loading ? null : a; }, 6000);
        if (!x) return { text: tx('المبيعات لسه بتتحمّل — اسألني تاني بعد لحظة.', 'The sales are still loading — ask me again in a moment.') };
        const S = x.sv.sales; const g = (k) => S.find((y) => y.group === k) || { orders: 0, sales: 0, share: 0 }; const c = g('completed'), p = g('in_progress'), xx = g('cancelled');
        lines.push(tx('المبيعات المكتملة ' + money(c.sales) + ' من ' + c.orders + ' أوردر، وتحت التنفيذ ' + money(p.sales) + ' (' + p.orders + ')، ومرتجع وملغي ' + money(xx.sales) + ' (' + xx.orders + ')',
          'Completed sales ' + money(c.sales) + ' from ' + plural(c.orders, 'order', 'orders') + ', in progress ' + money(p.sales) + ' (' + p.orders + '), returned and cancelled ' + money(xx.sales) + ' (' + xx.orders + ')'));
        chips.push([tx('مبيعات مكتملة', 'Completed sales'), money(c.sales)], [tx('تحت التنفيذ', 'In progress'), money(p.sales)], [tx('مرتجع وملغي', 'Returned and cancelled'), money(xx.sales)]);
        if (!d.single()) chips.push([tx('حصة المنصة من المكتمل', 'The platform’s share of completed'), money(c.share)]);
        tables.push({ title: tx('المبيعات', 'Sales'), headers: [tx('الحالة', 'Status'), tx('عدد الأوردرات', 'Orders'), tx('المبيعات', 'Sales')].concat(d.single() ? [] : [tx('حصة المنصة', 'Platform share')]), rows: S.map((y) => [y.label, y.orders, num(y.sales)].concat(d.single() ? [] : [num(y.share)])) });
      }
      if (cmd.what === 'expenses' || all) {
        const L = d.expenses().filter((e) => e.direction !== 'deposit' && inP(e.date)); const tot = L.reduce((n, e) => n + (Number(e.amount) || 0), 0); const by = {}; L.forEach((e) => { by[e.category] = (by[e.category] || 0) + (Number(e.amount) || 0); });
        const kinds = Object.entries(by).map(([k, v]) => k + ' ' + money(v)).join(tx('، ', ', '));
        lines.push(tx('المصروفات ' + money(tot) + ' في ' + L.length + ' حركة', 'Expenses ' + money(tot) + ' in ' + plural(L.length, 'entry', 'entries')) + (kinds ? ' (' + kinds + ')' : ''));
        chips.push([tx('المصروفات', 'Expenses'), money(tot)], [tx('عدد الحركات', 'Entries'), L.length]);
        if (L.length) tables.push({ title: tx('المصروفات', 'Expenses'), headers: [tx('التاريخ', 'Date'), tx('النوع', 'Type'), tx('المستفيد', 'Beneficiary'), tx('المبلغ', 'Amount')], rows: L.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40).map((e) => [d.dateLong(e.date), e.category, e.beneficiary || '', num(e.amount)]) });
      }
    }
    return out();
  }

  async function product(cmd, d) {
    const P = window.IBProducts; if (!P || d.barred('products')) return { text: tx('المنتجات مش من صلاحياتك.', 'Products are not within your permissions.') };
    if (P.ensure) P.ensure(); await d.wait(() => P.state() === 'ready' || P.state() === 'error' || P.list().length, 6000);
    const fold = (x) => d.norm(String(x || '')); const ws = fold(cmd.q).split(' ').filter(Boolean); const all = P.list();
    const bySku = all.filter((x) => fold(x.sku) === fold(cmd.q)); const hit = bySku.length ? bySku : all.filter((x) => { const t = fold([x.nameEn, x.nameAr, x.sku].join(' ')); return ws.length && ws.every((w) => t.includes(w)); });
    const list = tx('اعرض المنتجات ', 'show the products ') + cmd.q;
    if (!hit.length) return { text: tx('مالقيتش منتج بـ «' + cmd.q + '». جرّب الاسم أو الـ SKU، أو: ' + list, 'I couldn’t find a product for “' + cmd.q + '”. Try its name or SKU, or: ' + list) };
    if (hit.length > 6) return { text: tx('لقيت ' + hit.length + ' منتج بـ «' + cmd.q + '» — حدّد أكتر، أو: ' + list, 'I found ' + hit.length + ' products for “' + cmd.q + '” — be more specific, or: ' + list) };
    if (hit.length > 1) return { text: tx('لقيت ' + hit.length + ' منتج بالكلام ده — تقصد أنهي؟', 'I found ' + hit.length + ' products for this — which one?'), pick: { options: hit.map((x) => (x.nameEn || x.nameAr) + ' — ' + x.sku), texts: hit.map((x) => tx('المنتج ', 'product ') + x.sku), done: '' } };
    const x = hit[0]; const nm = x.nameEn || x.nameAr; const stock = x.stock == null || x.stock === '' ? tx('حسب الطلب', 'made to order') : String(x.stock); const st = (P.STATUS && P.STATUS[x.status]) || x.status;
    const was = x.regular && x.sale && Number(x.regular) > Number(x.sale); const mk = x.vendor && !d.single();
    return { text: nm + ' (' + x.sku + '): ' + tx('السعر ', 'price ') + money(x.sale || x.regular) + (was ? tx(' بدل ', ', was ') + money(x.regular) : '') + tx('، المخزون ', ', stock ') + stock + tx('، الحالة ', ', status ') + st
        + (mk ? tx('، المبتكر ', ', maker ') + x.vendor : '') + (x.sales ? tx('، اتباع ' + x.sales + ' مرة', ', sold ' + plural(x.sales, 'time', 'times')) : '') + '.',
      part: part(nm, 'SKU ' + x.sku, [[tx('السعر', 'Price'), money(x.sale || x.regular)], [tx('قبل الخصم', 'Before discount'), money(x.regular)], [tx('المخزون', 'Stock'), stock], [tx('الحالة', 'Status'), st], [tx('مرات الشراء', 'Times bought'), x.sales || 0]].concat(mk ? [[tx('المبتكر', 'Maker'), x.vendor]] : []), []) };
  }

  async function member(cmd, d) {
    const H = window.IBHR; if (!H || !H.everyone) return { text: tx('بيانات الفريق مش متاحة دلوقتي.', 'The team’s data is not available now.') };
    const fold = (x) => d.norm(String(x || '')); const ws = fold(cmd.q).split(' ').filter(Boolean); const hit = H.everyone().filter((m) => { const t = fold(m.name); return ws.length && ws.every((w) => t.includes(w)); });
    if (!hit.length) return { text: tx('مالقيتش عضو في الفريق باسم «' + cmd.q + '» (أو مش من اللي بتشوفهم).', 'I couldn’t find a team member named “' + cmd.q + '” (or not one you can see).') };
    if (hit.length > 1) return { text: tx('لقيت ' + hit.length + ' أعضاء بالاسم ده — تقصد مين؟', 'I found ' + hit.length + ' members with this name — who do you mean?'), pick: { options: hit.slice(0, 6).map((m) => m.name), texts: hit.slice(0, 6).map((m) => tx('الموظف ', 'member ') + m.name), done: '' } };
    const m = hit[0]; const role = m.role || ''; const left = Math.max(0, (Number(m.leave) || 0) + (Number(m.carry) || 0) - (Number(m.used) || 0));
    const t12 = (x) => (window.IBKit && window.IBKit.t12 && x ? window.IBKit.t12(x) : x || '—'); const sh = Array.isArray(m.shift) ? m.shift : ['', ''];
    const st = m.status === 'active' || !m.status ? tx('نشط', 'active') : m.status === 'invited' ? tx('دعوة معلّقة', 'invite pending') : tx('موقوف', 'suspended');
    // today, by the rule of «الموارد البشرية» (block 15 `status`), and what is open on the member: HR requests waiting, team requests held
    const S = H.data || {}; const t = (S.today || {})[m.id]; const nowMin = H.nowMin ? H.nowMin() : 0; const dayMin = H.dayMinutes ? H.dayMinutes(m.uid) : 480;
    const today = m.status === 'suspended' ? '' : !t ? tx('مسجلش حضور', 'not clocked in') : t.kind === 'leave' ? (t.leaveType || tx('إجازة', 'on leave')) : t.kind === 'holiday' ? tx('عطلة رسمية', 'public holiday') : t.kind === 'off' ? tx('راحة أسبوعية', 'weekly rest')
      : t.kind === 'absent' ? tx('غائب', 'absent') : t.in == null ? tx('مسجلش حضور', 'not clocked in') : t.out != null ? tx('أنهى الدوام', 'shift ended') : t.remote ? tx('عن بُعد', 'remote') : nowMin - t.in >= dayMin ? tx('وقت إضافي', 'overtime') : tx('حاضر', 'present');
    const hrOpen = (S.requests || []).filter((r) => r.member === m.id && ['جديد', 'قيد المراجعة'].includes(r.status));
    const prio = (k) => { const P = window.IbtekrTickets && window.IbtekrTickets.PRIORITIES; const hit = P && P.find((x) => x[0] === k); return hit ? hit[1] : k || ''; };
    const T = window.IBTickets; const held = T && T.all && !d.barred('tickets') ? T.all().filter((x) => x.assigneeMember && x.assigneeMember === m.uid && !['resolved', 'closed'].includes(x.status)) : [];
    return { text: m.name + (m.title ? ' — ' + m.title : '') + ': ' + tx('الدور ', 'role ') + (role || '—') + tx('، الحالة ', ', status ') + st + tx('، الدوام ', ', shift ') + t12(sh[0]) + ' – ' + t12(sh[1]) + tx('، رصيد الإجازات ' + left + ' يوم', ', leave balance ' + plural(left, 'day', 'days'))
        + (today ? tx('. النهارده: ', '. Today: ') + today : '') + tx('. طلبات موارد بشرية مستنية: ' + hrOpen.length + '، طلبات فريق معاه: ' + held.length + '.', '. HR requests waiting: ' + hrOpen.length + ', team requests held: ' + held.length + '.'),
      part: part(m.name, m.title || '', [[tx('الدور', 'Role'), role || '—'], [tx('الحالة', 'Status'), st], [tx('بداية الدوام', 'Shift start'), t12(sh[0])], [tx('نهاية الدوام', 'Shift end'), t12(sh[1])], [tx('رصيد الإجازات (يوم)', 'Leave balance (days)'), left]].concat(today ? [[tx('النهارده', 'Today'), today]] : [], [[tx('طلبات موارد بشرية مستنية', 'HR requests waiting'), hrOpen.length], [tx('طلبات فريق معاه', 'Team requests held'), held.length]]),
        [].concat(hrOpen.length ? [{ title: tx('طلبات الموارد البشرية المستنية', 'HR requests waiting'), headers: [tx('النوع', 'Type'), tx('من', 'From'), tx('إلى', 'To'), tx('الحالة', 'Status')], rows: hrOpen.slice(0, 20).map((r) => [r.type || '', r.from || '', r.to || '', r.status]) }] : [],
          held.length ? [{ title: tx('طلبات الفريق اللي معاه', 'Team requests held'), headers: [tx('الرقم', 'No.'), tx('العنوان', 'Title'), tx('الأولوية', 'Priority')], rows: held.slice(0, 20).map((x) => [String(x.id), x.title || '', prio(x.priority)]) }] : [])) };
  }

  const RUN = { readMaker: maker, readPeriod: period, readProduct: product, readMember: member };
  window.IBSystemRead = { run: (cmd, d) => Promise.resolve().then(() => (RUN[cmd.type] ? RUN[cmd.type](cmd, d) : { text: tx('مش فاهم الطلب ده.', 'I don’t understand this request.') })) };
})();
