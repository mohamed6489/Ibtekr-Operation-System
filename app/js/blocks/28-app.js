
/* Accounts page — views, adapter (in-memory), event log. Business rules live in domain.js; widgets in ui.js. */
(function () {
  'use strict';
  const D = window.IbtekrDomain, U = window.IBUI, SEED = window.IB_SEED;
  const { h, num, Button, IconButton, Icon } = U;
  const TODAY = '2026-10-20'; const TODAY_APP = TODAY; // fixed so the prototype is deterministic; the real app reads the clock
  const ACTOR = 'صفوت كمال';

  // ---------- adapter: the only place data is read/written (swap for Airtable/WooCommerce later) ----------
  const log = D.createEventLog(() => new Date().toISOString());
  const store = { seq: 0, expenses: [], vendorMoves: [], accountMoves: [] };
  const adapter = {
    add(kind, value, actor = ACTOR) { const rec = Object.freeze({ id: ++store.seq, createdBy: actor, ...value }); store[kind] = [...store[kind], rec]; log.append({ action: kind + '.create', actor, newValue: rec }); return rec; },
    update(kind, id, value) { const old = store[kind].find((r) => r.id === id); const rec = Object.freeze({ ...old, ...value, id }); store[kind] = store[kind].map((r) => (r.id === id ? rec : r)); log.append({ action: kind + '.update', actor: ACTOR, oldValue: old, newValue: rec }); return rec; },
    remove(kind, id) { const old = store[kind].find((r) => r.id === id); store[kind] = store[kind].filter((r) => r.id !== id); log.append({ action: kind + '.delete', actor: ACTOR, oldValue: old }); return old; },
    restore(kind, rec) { store[kind] = [...store[kind], rec]; log.append({ action: kind + '.restore', actor: ACTOR, newValue: rec }); },
  };

  // ---------- transport (المواصلات): Logistics expenses sheet + «مواصلات» vendor moves recorded here ----------
  const TR = window.IbtekrTransport;
  const TR_SHEET = TR.parseSheet(window.IB_TRANSPORT_ROWS || [], (SEED.vendors || []).map((v) => v.name));
  const TR_SRC = 'شيت Logistics expenses (مشاوير المواصلات) + حركات «مواصلات» المتسجلة في السيستم';
  const transportRows = () => TR_SHEET.concat(store.vendorMoves.filter((m) => m.type === 'مواصلات' && m.direction === 'withdraw').map((m) => ({ date: m.date, dateFixed: false, raw: m.date, amount: m.amount, vendor: m.vendor, scope: 'vendor', payer: 'السيستم', note: m.note || '' })));
  const trAll = () => TR.totals(transportRows());
  const trVendor = (name) => TR.forVendor(transportRows(), name);
  const trPeriod = (t) => (t.from ? D.formatDateNumeric(t.from) + ' – ' + D.formatDateNumeric(t.to) : 'مفيش مشاوير');
  const trNote = (rows) => (rows.some((r) => r.dateFixed) ? '* تاريخ متصحّح: الشيت كان فيه سنة أو شهر غلط في الصف ده، واتظبط حسب ترتيب الصفوف.' : '');
  const trDate = (r) => D.formatDateNumeric(r.date) + (r.dateFixed ? ' *' : '');
  // name: vendor name → that vendor's trips · '' → all vendors · null → everything (vendors + operations)
  function transportDetails(name) {
    const fmt = (n) => D.formatMoney(n); const all = trAll();
    const openByName = (n) => { const v = vstore.findByName(n); if (v) { go('vendors'); openVendor(v.id); } };
    if (name) {
      const v = trVendor(name); const rows = v.rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      return { title: 'مواصلات ' + name + ' — ' + fmt(v.total) + ' ج.م', sub: v.trips ? v.trips + ' مشوار · من ' + D.formatDateNumeric(v.first) + ' لـ ' + D.formatDateNumeric(v.last) : 'مفيش مشاوير متسجلة للمورد ده',
        summary: [{ label: 'الإجمالي', value: fmt(v.total) + ' ج.م' }, { label: 'المشاوير', value: String(v.trips) }, { label: 'متوسط المشوار', value: v.trips ? fmt(v.total / v.trips) + ' ج.م' : '—' }],
        headers: ['التاريخ', 'المبلغ (ج.م)', 'الاسم', 'ملاحظات'], rows: rows.map((r) => [trDate(r), fmt(r.amount), r.payer || '—', r.note || '—']), total: v.trips ? ['الإجمالي', fmt(v.total), '', ''] : null,
        note: trNote(rows), source: TR_SRC, empty: 'مفيش مشاوير متسجلة.' };
    }
    const list = all.byVendor;
    if (name === '') return { title: 'مواصلات الموردين — ' + fmt(all.vendors) + ' ج.م', sub: all.vendorTrips + ' مشوار لـ ' + all.vendorCount + ' موردين · ' + trPeriod(all) + ' · اضغط على أي مورد يفتح ملفه',
      summary: [{ label: 'الإجمالي', value: fmt(all.vendors) + ' ج.م' }, { label: 'المشاوير', value: String(all.vendorTrips) }, { label: 'أعلى مورد', value: list.length ? list[0].name + ' — ' + fmt(list[0].total) : '—' }],
      headers: ['المورد', 'المواصلات (ج.م)', 'المشاوير', 'آخر مشوار', 'من الإجمالي'], rows: list.map((r) => [r.name, fmt(r.total), String(r.trips), D.formatDateNumeric(r.last), D.formatPct(all.vendors ? r.total / all.vendors : 0)]),
      total: ['الإجمالي', fmt(all.vendors), String(all.vendorTrips), '', '100%'], onRow: (i) => openByName(list[i].name), source: TR_SRC };
    return { title: 'المواصلات — ' + fmt(all.total) + ' ج.م', sub: all.trips + ' مشوار · ' + trPeriod(all),
      summary: [{ label: 'للموردين', value: fmt(all.vendors) + ' ج.م' }, { label: 'تشغيل', value: fmt(all.ops) + ' ج.م' }, { label: 'المشاوير', value: String(all.trips) }],
      headers: ['البند', 'المبلغ (ج.م)', 'المشاوير', 'من الإجمالي'],
      rows: list.map((r) => ['مورد · ' + r.name, fmt(r.total), String(r.trips), D.formatPct(all.total ? r.total / all.total : 0)]).concat([['تشغيل (مشاوير مش لمورد معيّن)', fmt(all.ops), String(all.opsTrips), D.formatPct(all.total ? all.ops / all.total : 0)]]),
      total: ['الإجمالي', fmt(all.total), String(all.trips), '100%'],
      note: 'التشغيل = مشاوير الفريق (تجميع، استلام، استبدال) اللي مش متسجلة باسم مورد في الشيت. مشاوير المرتجعات مش محسوبة في المواصلات.', source: TR_SRC };
  }

  // owner 22 Oct: the confirmation state «غير مؤكد» is always written in red
  const cfText = (v) => (v === 'غير مؤكد' ? h('span', { class: 'unconf' }, v) : v);
  // ---------- vendor report popup (owner 22 Oct): balance + completed / cancelled + every order with photo, # , value, status. No Ibtekr share. ----------
  function prodThumb(sku, name) {
    const m = window.IB_PRODUCT_IMG || {}; const k = String(sku || '').trim();
    return h('span', { class: 'vr-prod' }, k && m[k] ? h('span', { class: 'thumb' }, h('img', { src: 'data:image/jpeg;base64,' + m[k], alt: name || '', loading: 'lazy' })) : h('span', { class: 'thumb', role: 'img', 'aria-label': 'مفيش صورة' }, Icon('box', 'sm')), h('span', null, name || '—'));
  }
  // review I3 (phase 3.2): the maker report, the period statement, the weekly / daily reports and the shared text still match sub-orders by
  // store name; only the balance and the drawer KPIs follow a brand transfer (IBVendors.stats). Until phase 4 moves the reports onto the
  // attribution, a maker touched by a transfer gets this line on each of them.
  const brandNote = (v) => (v && ((v.brandsEver && v.brandsEver.length) || (v.brands || []).some((b) => !b.origin)) ? 'ملحوظة: التقرير ده بيطابق الأوردرات باسم المتجر — نقل البراندات بيتحسب في رصيد المبتكر والـ KPIs في ملفه بس (التقارير بتاخد النقل في مرحلة الحسابات).' : '');
  const bn = (v) => (brandNote(v) ? ' · ' + brandNote(v) : '');
  function openVendorReport(name) {
    const OA = window.OrdersApp; const orders = OA ? OA.query({}, 10000).rows.map((r) => OA.get(r.id)).filter(Boolean) : [];
    const v = vstore.findByName(name); const st = (v && vendorStats()[v.id]) || { balance: 0 }; // phase 3: opening + completed shares (IBVendors.stats); deposits / transport from phase 4
    const r = VD.vendorReport(orders, v ? [v.name, ...v.aliases] : [name], st.balance); const fmt = (n) => D.formatMoney(n);
    U.DetailsModal({ title: 'تقرير ' + name, sub: 'الأوردرات المكتملة والملغية بس · ' + r.orders + ' أوردر · الرصيد = الافتتاحي + حقه من المكتملة من 1 أكتوبر · اضغط على أي أوردر يفتحه',
      summary: [{ label: 'الرصيد', value: fmt(r.balance) + ' ج.م' }, { label: 'منه مواصلات اتخصمت', value: '— (من مرحلة 4)' }, { label: 'مكتمل', value: String(r.completed) + ' أوردر' }, { label: 'ملغي', value: String(r.cancelled) + ' أوردر' }],
      headers: ['المنتج', 'رقم الأوردر', 'القيمة (ج.م)', 'حالة الأوردر'],
      rows: r.rows.map((x) => [prodThumb(x.sku, x.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + x.oid), x.sid !== x.oid ? h('small', null, ' · فرعي ', h('bdi', { dir: 'ltr' }, '#' + x.sid)) : null), fmt(x.tot), x.status]),
      total: r.rows.length ? ['الإجمالي', String(r.orders) + ' أوردر', fmt(r.value), ''] : null,
      onRow: (i) => showOrders({ q: r.rows[i].oid }), phone: v && v.phone, email: v && v.email, empty: 'مفيش أوردرات مكتملة أو ملغية للمورد ده.', note: brandNote(v) || null, source: 'الأوردرات (الموقع) + مستحقات المرحلة 3' }, { label: 'تقرير ' + name });
  }


  // ---------- data export / import (owner 22 Oct): one spec per group — fields, rows, and (for importable groups) how rows are written + undone ----------
  const IBData = (() => {
    const K = () => window.IBKit; const ST = () => ((window.OrdersApp && window.OrdersApp.statuses && window.OrdersApp.statuses()) || []);
    const VST = [['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط']]; const vst = (c) => (VST.find((x) => x[0] === c) || [, c])[1]; const vcode = (l) => (VST.find((x) => x[1] === l) || [l])[0];
    const SET = () => window.IBPages.all().settings; const sapi = () => (SET() && SET().api) || {};
    // helpers for the import groups (owner 22 Oct: everything can be imported and exported)
    const OPS = () => window.IbtekrOps; const DX = () => window.IbtekrDataX; const csData = () => window.IBPages.all().cs.api.data;
    const vnames = () => vendorsNow().map((v) => v.name);
    const POPUP_SS = ['وصل المخزن', 'مرتجع للمخزن', 'مرتجع للمورد'];
    const emailOf = (id) => { const m = K().store.members.find((x) => x.id === id); return m ? m.email : id; };
    const memberBy = (email) => K().store.members.find((x) => String(x.email).toLowerCase() === String(email || '').toLowerCase());
    const splitTags = (t) => String(t || '').split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    const mvIn = (d) => ({ amount: String(d.amount), date: D.formatDateNumeric(d.date), direction: d.direction === 'إيداع' ? 'deposit' : 'withdraw', type: d.type, otherName: d.typeName || '', vendor: d.vendor });
    const acIn = (d) => ({ amount: String(d.amount), date: D.formatDateNumeric(d.date), direction: d.direction === 'إيداع' ? 'deposit' : 'withdraw', account: d.account });
    const tkIn = (d) => ({ type: (TK.TYPES.find((x) => x[1] === d.type) || [d.type])[0], title: d.title, description: d.description, priority: (TK.PRIORITIES.find((x) => x[1] === d.priority) || [d.priority])[0], assigneeRole: d.role, orderId: d.orderId || '', customer: d.customer || '', vendor: d.vendor || '', reason: d.reason || null });
    // add new rows / patch matching ones (onMatch «تخطّي» = add-only) with undo
    function upsert(list, rows, onMatch, match, make, patchOf) {
      const done = { created: [], updated: [] };
      for (const r of rows) { const d = r.data; const ex = list.find((x) => match(x, d));
        if (ex) { if (onMatch === 'تخطّي') continue; const p = patchOf ? patchOf(d) : Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== undefined)); const old = {}; Object.keys(p).forEach((k) => { old[k] = ex[k]; ex[k] = p[k]; }); done.updated.push({ ex, old }); }
        else { const rec = make(d); list.push(rec); done.created.push(rec); } }
      return { done, undo: () => { done.created.forEach((rec) => { const i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); }); done.updated.forEach((u) => Object.assign(u.ex, u.old)); } };
    }
    const GROUPS = [
      { id: 'orders', label: 'الأوردرات والأوردرات الفرعية', dateKey: 'date', filter: { key: 'status', label: 'حالة الأوردر', options: () => ST() }, note: 'الأوردرات بتيجي من الموقع / Airtable — الاستيراد هنا مقفول عشان مايحصلش تعارض.',
        fields: () => [{ key: 'oid', label: 'رقم الأوردر', en: 'Order #' }, { key: 'sid', label: 'الأوردر الفرعي', en: 'Sub-order #' }, { key: 'date', label: 'التاريخ', en: 'Date', type: 'date' }, { key: 'customer', label: 'العميل', en: 'Customer' }, { key: 'phone', label: 'موبايل العميل', en: 'Customer phone', sensitive: true },
          { key: 'status', label: 'حالة الأوردر', en: 'Order status' }, { key: 'confirm', label: 'حالة التأكيد', en: 'Confirmation' }, { key: 'vendor', label: 'المورد', en: 'Vendor' }, { key: 'product', label: 'المنتج', en: 'Product' }, { key: 'sku', label: 'SKU', en: 'SKU' }, { key: 'qty', label: 'الكمية', en: 'Qty', type: 'number' }, { key: 'total', label: 'القيمة (ج.م)', en: 'Amount (EGP)', type: 'number' }, { key: 'subStatus', label: 'حالة الفرعي', en: 'Sub-order status' }],
        presets: { accountant: ['oid', 'date', 'status', 'vendor', 'total'], vendor: ['oid', 'sid', 'date', 'product', 'sku', 'qty', 'total', 'subStatus'] },
        rows: () => { const A = OA(); if (!A || !A.query) return []; return A.query({}, 10000).rows.map((r) => A.get(r.id)).filter(Boolean).flatMap((o) => o.subs.map((x) => ({ oid: o.id, sid: x.sid, date: o.date, customer: o.name, phone: o.phone, status: o.st, confirm: o.cf, vendor: x.vendor, product: x.prod, sku: x.sku, qty: x.qty, total: x.tot, subStatus: x.ss || '' }))); } },
      { id: 'vendors', label: 'المبتكرين والنسب', key: 'name', modes: ['add', 'update'], filter: { key: 'status', label: 'الحالة', options: () => VST.map((x) => x[1]) },
        fields: () => [{ key: 'name', label: 'اسم المبتكر', en: 'Vendor name', required: true }, { key: 'legalName', label: 'الاسم التجاري', en: 'Legal name' }, { key: 'category', label: 'الفئة', en: 'Category', type: 'enum', options: VD.CATEGORIES.slice(), required: true }, { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: VST.map((x) => x[1]), required: true },
          { key: 'phone', label: 'الموبايل (واتساب)', en: 'Phone', type: 'phone', required: true, sensitive: true }, { key: 'email', label: 'الإيميل', en: 'Email', type: 'email' }, { key: 'rate', label: 'نسبة إبتكر %', en: 'Ibtekr %', type: 'number', required: true, noUpdate: true }, { key: 'leadDays', label: 'مدة التجهيز (يوم)', en: 'Lead days', type: 'number', required: true }, { key: 'address', label: 'العنوان', en: 'Address' },
          { key: 'balance', label: 'الرصيد', en: 'Balance', type: 'number', readOnly: true }, { key: 'transport', label: 'المواصلات', en: 'Transport', type: 'number', readOnly: true }, { key: 'deposits', label: 'العرابين', en: 'Deposits', type: 'number', readOnly: true }],
        presets: { accountant: ['name', 'rate', 'balance', 'transport', 'deposits'], vendor: ['name', 'category', 'leadDays'] },
        rows: () => { const bal = vendorsNow(); return vstore.all().map((v) => { const b = bal.find((x) => VD.norm(x.name) === VD.norm(v.name)) || {}; return { name: v.name, legalName: v.legalName || '', category: v.category, status: vst(v.status), phone: v.phone, email: v.email || '', rate: v.rate, leadDays: v.leadDays, address: v.address || '', balance: b.balance || 0, transport: b.transport || 0, deposits: b.deposits || 0 }; }); },
        existing: () => vstore.all().map((v) => v.name),
        apply: (rows, onMatch) => { const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const ex = vstore.findByName(d.name);
            const input = { name: d.name, legalName: d.legalName, category: d.category, status: vcode(d.status), phone: d.phone, email: d.email, rate: d.rate, leadDays: d.leadDays, address: d.address };
            if (ex && onMatch === 'تخطّي') continue;
            if (ex && onMatch !== 'إنشاء نسخة') { const patch = {}; ['legalName', 'category', 'status', 'phone', 'email', 'leadDays', 'address'].forEach((k) => { if (input[k] !== undefined && input[k] !== '') patch[k] = input[k]; }); const old = {}; Object.keys(patch).forEach((k) => { old[k] = ex[k]; }); vstore.update(ex.id, patch, vstore.actor()); done.updated.push({ id: ex.id, old }); }
            else { const v = vstore.create(Object.assign({}, input, ex ? { name: d.name + ' (نسخة)' } : {}), vstore.actor()); done.created.push(v && v.id); } }
          return { done, undo: () => { done.created.forEach((id) => { try { if (id) vstore.remove(id, vstore.actor()); } catch (e) { /* already gone */ } }); done.updated.forEach((u) => { try { vstore.update(u.id, u.old, vstore.actor()); } catch (e) { /* skip */ } }); } }; } },
      { id: 'expenses', label: 'الحسابات (المصروفات)', modes: ['add'], dateKey: 'date', filter: { key: 'category', label: 'النوع', options: () => D.CATEGORIES.slice() },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'amount', label: 'المبلغ (ج.م)', en: 'Amount (EGP)', type: 'number', required: true }, { key: 'category', label: 'النوع', en: 'Category', type: 'enum', options: D.CATEGORIES.slice(), required: true }, { key: 'direction', label: 'إيداع / سحب', en: 'Direction', type: 'enum', options: ['سحب', 'إيداع'] }, { key: 'beneficiary', label: 'المستفيد', en: 'Beneficiary' }],
        presets: { accountant: ['date', 'amount', 'category', 'direction', 'beneficiary'] },
        rows: () => store.expenses.map((e) => ({ date: e.date, amount: e.amount, category: e.category, direction: e.direction === 'deposit' ? 'إيداع' : 'سحب', beneficiary: e.beneficiaryName || '' })),
        apply: (rows) => { const ids = [];
          for (const r of rows) { const d = r.data; const res = D.validateExpense({ amount: String(d.amount), date: D.formatDateNumeric(d.date), category: d.category, direction: d.direction === 'إيداع' ? 'deposit' : 'withdraw', beneficiary: d.beneficiary ? D.OTHER : '', otherName: d.beneficiary || '' });
            if (Object.keys(res.errors).length) continue; ids.push(adapter.add('expenses', res.value).id); }
          return { done: { created: ids, updated: [] }, undo: () => ids.forEach((id) => adapter.remove('expenses', id)) }; } },
      { id: 'team', label: 'الفريق والحضور والمرتبات', key: 'email', modes: ['add', 'update'], filter: { key: 'role', label: 'الدور', options: () => (sapi().roles ? sapi().roles() : []) },
        fields: () => [{ key: 'name', label: 'الاسم', en: 'Name', required: true }, { key: 'email', label: 'الإيميل', en: 'Email', type: 'email', required: true }, { key: 'role', label: 'الدور', en: 'Role', type: 'enum', options: sapi().roles ? sapi().roles() : [], required: true }, { key: 'title', label: 'المسمى', en: 'Title' }, { key: 'dept', label: 'القسم', en: 'Department' },
          { key: 'phone', label: 'الموبايل', en: 'Phone', type: 'phone', sensitive: true }, { key: 'hire', label: 'تاريخ التعيين', en: 'Hire date', type: 'date' }, { key: 'salary', label: 'المرتب', en: 'Salary', type: 'number', sensitive: true },
          { key: 'holdback', label: 'المحجوز للبونص (شهري)', en: 'Bonus holdback', type: 'number', sensitive: true }, { key: 'allow', label: 'البدلات', en: 'Allowances', type: 'number', sensitive: true }, { key: 'shiftStart', label: 'بداية الشيفت', en: 'Shift start', type: 'time' }, { key: 'shiftEnd', label: 'نهاية الشيفت', en: 'Shift end', type: 'time' },
          { key: 'leave', label: 'رصيد الإجازات السنوي (يوم)', en: 'Annual leave days', type: 'number' }, { key: 'used', label: 'الإجازات المستخدمة (يوم)', en: 'Leave used', type: 'number' }],
        presets: { accountant: ['name', 'dept', 'salary'] },
        rows: () => K().store.members.map((m) => ({ name: m.name, email: m.email, role: m.role, title: m.title, dept: m.dept, phone: m.phone, hire: m.hire, salary: m.salary, holdback: m.holdback, allow: m.allow, shiftStart: (m.shift || [])[0] || '', shiftEnd: (m.shift || [])[1] || '', leave: m.leave, used: m.used })),
        existing: () => K().store.members.map((m) => m.email),
        apply: (rows, onMatch) => { const M = K().store.members; const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const ex = M.find((m) => String(m.email).toLowerCase() === String(d.email).toLowerCase());
            if (ex && onMatch === 'تخطّي') continue;
            if (ex && onMatch !== 'إنشاء نسخة') { const old = {}; Object.keys(d).forEach((k) => { if (d[k] !== '' && k !== 'email' && k !== 'shiftStart' && k !== 'shiftEnd') { old[k] = ex[k]; ex[k] = d[k]; } }); if (d.shiftStart || d.shiftEnd) { old.shift = ex.shift; ex.shift = [d.shiftStart || (ex.shift || [])[0] || '09:00', d.shiftEnd || (ex.shift || [])[1] || '17:00']; } done.updated.push({ id: ex.id, old }); }
            else { const id = 'M' + String(M.length + 1).padStart(2, '0') + 'i'; M.push({ id, name: d.name, email: d.email, role: d.role, title: d.title || '', dept: d.dept || '', phone: d.phone || '', hire: d.hire || K().TODAY, salary: d.salary || 0, holdback: d.holdback || 0, allow: d.allow || 0, shift: [d.shiftStart || '09:00', d.shiftEnd || '17:00'], leave: d.leave === undefined || d.leave === '' ? 21 : d.leave, used: d.used || 0, manager: 'M01', status: 'invited', lastLogin: 'دعوة (استيراد)', twofa: false, contract: 'missing', monthMin: 0, otMonth: 0 }); done.created.push(id); } }
          return { done, undo: () => { done.created.forEach((id) => { const i = M.findIndex((m) => m.id === id); if (i >= 0) M.splice(i, 1); }); done.updated.forEach((u) => { const m = M.find((x) => x.id === u.id); if (m) Object.assign(m, u.old); }); } }; } },
      // ---- owner 22 Oct: every data set can be imported and exported ----
      { id: 'stock', label: 'المخزن', key: 'sku', modes: ['add', 'update'], dateKey: 'since', filter: { key: 'status', label: 'الحالة', options: () => [...new Set(K().stockNow().map((s) => s.status))] },
        fields: () => [{ key: 'sku', label: 'SKU', en: 'SKU', required: true }, { key: 'name', label: 'المنتج', en: 'Product', required: true }, { key: 'vendor', label: 'المورد', en: 'Vendor', type: 'enum', options: vnames(), required: true },
          { key: 'reason', label: 'سبب التخزين', en: 'Reason', type: 'enum', options: OPS().REASONS.slice(), required: true }, { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: [...new Set(Object.values(OPS().STATUS_BY_REASON).flat())] },
          { key: 'qty', label: 'الكمية', en: 'Qty', type: 'number', required: true, noUpdate: true }, { key: 'loc', label: 'المكان', en: 'Location' }, { key: 'cost', label: 'التكلفة (ج.م)', en: 'Cost (EGP)', type: 'number' }, { key: 'since', label: 'من تاريخ', en: 'Since', type: 'date' }],
        rows: () => K().stockNow().map((s) => ({ sku: s.sku, name: s.name, vendor: s.vendor, reason: s.reason, status: s.status, qty: s.onHand, loc: s.loc, cost: s.cost, since: s.since })),
        existing: () => K().stockNow().map((s) => s.sku),
        check: (d) => { const st = d.reason && OPS().STATUS_BY_REASON[d.reason]; return { errors: d.status && st && !st.includes(d.status) ? ['الحالة «' + d.status + '» مش مناسبة لسبب «' + d.reason + '» — المسموح: ' + st.join(' / ')] : [] }; },
        apply: (rows, onMatch) => { const S = K().store; const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const ex = S.stock.find((x) => VD.norm(x.sku) === VD.norm(d.sku));
            if (ex && onMatch !== 'تخطّي') { const old = {}; ['name', 'vendor', 'reason', 'status', 'loc', 'cost', 'since'].forEach((k) => { if (d[k] !== undefined && d[k] !== '') { old[k] = ex[k]; ex[k] = d[k]; } }); done.updated.push({ ex, old }); continue; }
            if (ex) continue;
            const key = 'L-IMP-' + (++store.seq); const reason = d.reason;
            S.stock.push({ key, sku: d.sku, name: d.name, vendor: d.vendor, reason, status: d.status || OPS().STATUS_BY_REASON[reason][0], ref: 'استيراد', sub: '', order: '', since: d.since || K().TODAY, loc: d.loc || '', cost: d.cost || 0 });
            S.ledger.unshift({ at: K().TODAY + ' ' + K().clockNow(), key, type: 'in', qty: d.qty, label: 'استلام (استيراد)', reason, ref: 'استيراد', by: K().member(K().ME).name, note: '' }); done.created.push(key); }
          return { done, undo: () => { const S2 = K().store; done.created.forEach((key) => { S2.stock = S2.stock.filter((x) => x.key !== key); S2.ledger = S2.ledger.filter((x) => x.key !== key); }); done.updated.forEach((u) => Object.assign(u.ex, u.old)); } }; } },
      { id: 'tickets', label: 'التذاكر', modes: ['add'], dateKey: 'created', filter: { key: 'status', label: 'الحالة', options: () => [...new Set(tstore.all().map((t) => t.status))] },
        fields: () => [{ key: 'id', label: 'رقم التذكرة', en: 'Ticket #', readOnly: true }, { key: 'type', label: 'النوع', en: 'Type', type: 'enum', options: TK.TYPES.map((x) => x[1]), required: true }, { key: 'title', label: 'العنوان', en: 'Title', required: true }, { key: 'description', label: 'التفاصيل', en: 'Description', required: true },
          { key: 'priority', label: 'الأولوية', en: 'Priority', type: 'enum', options: TK.PRIORITIES.map((x) => x[1]), required: true }, { key: 'role', label: 'الدور المسؤول', en: 'Owner role', type: 'enum', options: TK.ROLES.slice(), required: true },
          { key: 'orderId', label: 'رقم الأوردر', en: 'Order #' }, { key: 'customer', label: 'العميل', en: 'Customer' }, { key: 'vendor', label: 'المورد', en: 'Vendor' }, { key: 'reason', label: 'السبب', en: 'Reason', type: 'enum', options: TK.CUSTOMER_REASONS.concat(TK.VENDOR_REASONS.filter((x) => !TK.CUSTOMER_REASONS.includes(x))) },
          { key: 'status', label: 'الحالة', en: 'Status', readOnly: true }, { key: 'created', label: 'تاريخ الإنشاء', en: 'Created', type: 'date', readOnly: true }],
        rows: () => tstore.all().map((t) => ({ id: t.id, type: TK.label(TK.TYPES, t.type), title: t.title, description: t.description, priority: TK.label(TK.PRIORITIES, t.priority), role: t.assigneeRole, orderId: t.orderId || '', customer: t.customer || '', vendor: t.vendor || '', reason: t.reason || '', status: t.status, created: String(t.createdAt || '').slice(0, 10) })),
        check: (d) => ({ errors: Object.values(TK.validateTicket(tkIn(d))) }),
        apply: (rows) => { const ids = []; for (const r of rows) { try { ids.push(tstore.create(tkIn(r.data), ME).id); } catch (e) { /* invalid row */ } } return { done: { created: ids, updated: [] }, undo: () => ids.forEach((id) => { try { tstore.remove(id, ME); } catch (e) { /* gone */ } }) }; } },
      { id: 'transport', label: 'المواصلات (المشاوير)', key: ['date', 'amount', 'vendor'], modes: ['add'], dateKey: 'date', filter: { key: 'vendor', label: 'المورد', options: () => [...new Set(transportRows().map((r) => r.vendor || 'تشغيل'))] },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'amount', label: 'المبلغ (ج.م)', en: 'Amount (EGP)', type: 'number', required: true }, { key: 'vendor', label: 'المورد (أو تشغيل)', en: 'Vendor (or ops)', type: 'enum', options: ['تشغيل'].concat(vnames()), required: true },
          { key: 'payer', label: 'دفع', en: 'Paid by' }, { key: 'note', label: 'ملاحظة / المكان', en: 'Note' }],
        rows: () => transportRows().map((r) => ({ date: r.date, amount: r.amount, vendor: r.vendor || 'تشغيل', payer: r.payer, note: r.note })),
        existing: () => transportRows().map((r) => DX().keyOf({ date: r.date, amount: r.amount, vendor: r.vendor || 'تشغيل' }, ['date', 'amount', 'vendor'])),
        apply: (rows) => { const made = [];
          for (const r of rows) { const d = r.data;
            if (d.vendor === 'تشغيل') { const t = { date: d.date, dateFixed: false, raw: d.date, amount: d.amount, vendor: null, scope: 'ops', payer: d.payer || '', note: d.note || '', place: d.note || '' }; TR_SHEET.push(t); made.push(['ops', t]); }
            else { const res = D.validateVendorMovement({ amount: String(d.amount), date: D.formatDateNumeric(d.date), direction: 'withdraw', type: 'مواصلات', vendor: d.vendor }); if (Object.keys(res.errors).length) continue; made.push(['v', adapter.add('vendorMoves', res.value).id]); } }
          return { done: { created: made, updated: [] }, undo: () => made.forEach(([k, x]) => { if (k === 'ops') { const i = TR_SHEET.indexOf(x); if (i >= 0) TR_SHEET.splice(i, 1); } else adapter.remove('vendorMoves', x); }) }; } },
      { id: 'vendorMoves', label: 'حركات الموردين (عربون / مواصلات / أخرى)', modes: ['add'], dateKey: 'date', filter: { key: 'type', label: 'النوع', options: () => D.VENDOR_TYPES.slice() },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'vendor', label: 'المورد', en: 'Vendor', type: 'enum', options: vnames(), required: true }, { key: 'type', label: 'النوع', en: 'Type', type: 'enum', options: D.VENDOR_TYPES.slice(), required: true },
          { key: 'typeName', label: 'اسم النوع (لو «أخرى»)', en: 'Other type' }, { key: 'direction', label: 'إيداع / سحب', en: 'Direction', type: 'enum', options: ['سحب', 'إيداع'], required: true }, { key: 'amount', label: 'المبلغ (ج.م)', en: 'Amount (EGP)', type: 'number', required: true }],
        rows: () => store.vendorMoves.map((m) => ({ date: m.date, vendor: m.vendor, type: m.type, typeName: m.type === 'أخرى' ? m.typeName : '', direction: m.direction === 'deposit' ? 'إيداع' : 'سحب', amount: m.amount })),
        check: (d) => ({ errors: Object.values(D.validateVendorMovement(mvIn(d)).errors) }),
        apply: (rows) => { const ids = []; for (const r of rows) { const res = D.validateVendorMovement(mvIn(r.data)); if (Object.keys(res.errors).length) continue; ids.push(adapter.add('vendorMoves', res.value).id); } return { done: { created: ids, updated: [] }, undo: () => ids.forEach((id) => adapter.remove('vendorMoves', id)) }; } },
      { id: 'accountMoves', label: 'حركات الحسابات (البنك / بوسطة / باي موب / المحفظة)', modes: ['add'], dateKey: 'date', filter: { key: 'account', label: 'الحساب', options: () => D.ACCOUNTS.slice() },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'account', label: 'الحساب', en: 'Account', type: 'enum', options: D.ACCOUNTS.slice(), required: true }, { key: 'direction', label: 'إيداع / سحب', en: 'Direction', type: 'enum', options: ['إيداع', 'سحب'], required: true }, { key: 'amount', label: 'المبلغ (ج.م)', en: 'Amount (EGP)', type: 'number', required: true }],
        rows: () => store.accountMoves.map((m) => ({ date: m.date, account: m.account, direction: m.direction === 'deposit' ? 'إيداع' : 'سحب', amount: m.amount })),
        check: (d) => { const res = D.validateAccountMovement(acIn(d)); const errors = Object.values(res.errors); if (!errors.length) { try { D.applyAccountMovement(accountsNow().balances, res.value.account, res.value.direction, res.value.amount); } catch (e) { errors.push('الرصيد في «' + d.account + '» مش كفاية للسحب ده'); } } return { errors }; },
        apply: (rows) => { const ids = []; for (const r of rows) { const res = D.validateAccountMovement(acIn(r.data)); if (Object.keys(res.errors).length) continue; try { D.applyAccountMovement(accountsNow().balances, res.value.account, res.value.direction, res.value.amount); } catch (e) { continue; } ids.push(adapter.add('accountMoves', res.value).id); } return { done: { created: ids, updated: [] }, undo: () => ids.forEach((id) => adapter.remove('accountMoves', id)) }; } },
      { id: 'vendorSecure', label: 'بيانات المبتكرين الحساسة (البنك والعقد والنسبة)', key: 'name', modes: ['update'], sensitive: true, note: 'للأدمن والحسابات بس — كل تعديل بيتسجل في سجل نشاط المبتكر.',
        fields: () => [{ key: 'name', label: 'اسم المبتكر', en: 'Vendor name', required: true }, { key: 'method', label: 'طريقة التحويل', en: 'Payout method', type: 'enum', options: VD.PAY_METHODS.map((x) => x[1]) }, { key: 'bankName', label: 'البنك', en: 'Bank', sensitive: true }, { key: 'holder', label: 'صاحب الحساب', en: 'Account holder', sensitive: true },
          { key: 'iban', label: 'IBAN / رقم الحساب', en: 'IBAN', sensitive: true }, { key: 'wallet', label: 'رقم المحفظة', en: 'Wallet #', sensitive: true }, { key: 'contractExpires', label: 'العقد ينتهي في', en: 'Contract expires', type: 'date' },
          { key: 'rate', label: 'نسبة إبتكر الجديدة %', en: 'New Ibtekr %', type: 'number' }, { key: 'rateSince', label: 'النسبة تسري من', en: 'Rate effective from', type: 'date' }],
        rows: () => vstore.all().map((v) => ({ name: v.name, method: v.bank ? (VD.PAY_METHODS.find((x) => x[0] === v.bank.method) || [, ''])[1] : '', bankName: v.bank && v.bank.bankName || '', holder: v.bank && v.bank.holder || '', iban: v.bank && v.bank.iban || '', wallet: v.bank && v.bank.wallet || '', contractExpires: v.contract && v.contract.expires || '', rate: v.rate, rateSince: v.rateSince || '' })),
        existing: () => vstore.all().map((v) => v.name),
        check: (d) => { const e = []; const v = vstore.findByName(d.name); if (d.rate !== undefined && d.rate !== '' && !d.rateSince) e.push('اكتب «النسبة تسري من» — النسبة الجديدة بتطبق على الأوردرات الجديدة بس'); if (d.rate !== undefined && d.rate !== '' && (d.rate < 0 || d.rate > 65)) e.push('النسبة لازم بين 0 و 65'); if (d.contractExpires && v && !(v.contract && v.contract.fileName)) e.push('مفيش عقد مرفوع للمبتكر ده — ارفعه الأول من ملفه'); return { errors: e }; },
        apply: (rows) => { const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const v = vstore.findByName(d.name); if (!v) continue; const u = { id: v.id, snap: vstore.get(v.id) };
            const bk = ['method', 'bankName', 'holder', 'iban', 'wallet'].filter((k) => d[k] !== undefined && d[k] !== '');
            if (bk.length) { const nb = Object.assign({}, v.bank || {}); bk.forEach((k) => { nb[k] = k === 'method' ? (VD.PAY_METHODS.find((x) => x[1] === d.method) || ['bank'])[0] : d[k]; }); vstore.setBank(v.id, nb, vstore.actor()); }
            if (d.contractExpires) vstore.setContract(v.id, Object.assign({}, v.contract, { expires: d.contractExpires }), vstore.actor());
            if (d.rate !== undefined && d.rate !== '') vstore.setRate(v.id, d.rate, d.rateSince, vstore.actor());
            done.updated.push(u); }
          return { done, undo: () => done.updated.forEach((u) => { try { vstore.restoreMoney(u.id, u.snap, vstore.actor()); } catch (e) { /* skip */ } }) }; } },
      { id: 'orderEdit', label: 'الأوردرات — التأكيد والعربون والتعليق', key: 'oid', modes: ['update'], note: 'تعديل بس — الأوردرات الجديدة بتيجي من الموقع / Airtable.',
        fields: () => [{ key: 'oid', label: 'رقم الأوردر', en: 'Order #', required: true }, { key: 'customer', label: 'العميل', en: 'Customer', readOnly: true }, { key: 'confirm', label: 'حالة التأكيد', en: 'Confirmation', type: 'enum', options: OA() && OA().confirms ? OA().confirms() : [] },
          { key: 'cdate', label: 'تاريخ التأكيد', en: 'Confirmed on', type: 'date' }, { key: 'deposit', label: 'العربون (ج.م)', en: 'Deposit (EGP)', type: 'number' }, { key: 'note', label: 'تعليق مهم عن الأوردر', en: 'Order note' }],
        rows: () => allOrders().map((o) => ({ oid: o.id, customer: o.name, confirm: o.cf, cdate: o.cdate || '', deposit: o.dep, note: o.note || '' })),
        existing: () => allOrders().map((o) => o.id),
        apply: (rows) => { const done = { created: [], updated: [] }; const M = { confirm: 'cf', cdate: 'cdate', deposit: 'dep', note: 'note' };
          for (const r of rows) { const f = {}; Object.keys(M).forEach((k) => { if (r.data[k] !== undefined && r.data[k] !== '') f[M[k]] = r.data[k]; }); const old = OA().patch(r.data.oid, f); if (old) done.updated.push({ id: r.data.oid, old }); }
          return { done, undo: () => done.updated.forEach((u) => OA().patch(u.id, u.old)) }; } },
      { id: 'subEdit', label: 'الأوردرات الفرعية — الحالة والميعاد وتعليق المورد', key: 'sid', modes: ['update'], note: 'تعديل بس. «وصل المخزن» و«مرتجع» بيتغيّروا من الأوردر نفسه عشان محتاجين بيانات إضافية.',
        fields: () => [{ key: 'sid', label: 'الأوردر الفرعي', en: 'Sub-order #', required: true }, { key: 'oid', label: 'رقم الأوردر', en: 'Order #', readOnly: true }, { key: 'product', label: 'المنتج', en: 'Product', readOnly: true }, { key: 'vendor', label: 'المورد', en: 'Vendor', readOnly: true },
          { key: 'subStatus', label: 'حالة الأوردر الفرعي', en: 'Sub-order status', type: 'enum', options: (OA() && OA().subStatuses ? OA().subStatuses() : []).filter((x) => !POPUP_SS.includes(x)) }, { key: 'expected', label: 'ميعاد التسليم المتوقع', en: 'Expected delivery', type: 'date' }, { key: 'vendorComment', label: 'تعليق المورد', en: 'Vendor comment' }],
        rows: () => allOrders().flatMap((o) => o.subs.map((x) => ({ sid: x.sid, oid: o.id, product: x.prod, vendor: x.vendor, subStatus: x.ss || '', expected: x.exp || '', vendorComment: x.cm || '' }))),
        existing: () => allOrders().flatMap((o) => o.subs.map((x) => x.sid)),
        apply: (rows) => { const done = { created: [], updated: [] }; const M = { subStatus: 'ss', expected: 'exp', vendorComment: 'cm' };
          for (const r of rows) { const f = {}; Object.keys(M).forEach((k) => { if (r.data[k] !== undefined && r.data[k] !== '') f[M[k]] = r.data[k]; }); const old = OA().patchSub(r.data.sid, f); if (old) done.updated.push({ id: r.data.sid, old }); }
          return { done, undo: () => done.updated.forEach((u) => OA().patchSub(u.id, u.old)) }; } },
      { id: 'attendance', label: 'الحضور والانصراف', key: ['email', 'date'], modes: ['add', 'update'], dateKey: 'date',
        fields: () => [{ key: 'email', label: 'إيميل الموظف', en: 'Employee email', type: 'email', required: true }, { key: 'date', label: 'اليوم', en: 'Date', type: 'date', required: true }, { key: 'type', label: 'نوع اليوم', en: 'Day type', type: 'enum', options: ['يوم عمل', 'إجازة', 'عطلة رسمية', 'يوم راحة'] },
          { key: 'in', label: 'الحضور', en: 'In', type: 'time' }, { key: 'out', label: 'الانصراف', en: 'Out', type: 'time' }, { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: ['حاضر', 'غائب', 'إجازة', 'متأخر', 'انصراف ناقص'] }],
        rows: () => K().store.attendance.map((a) => ({ email: emailOf(a.member), date: a.date, type: a.type, in: a.in == null ? '' : K().hm(a.in), out: a.out == null ? '' : K().hm(a.out), status: a.status })),
        existing: () => K().store.attendance.map((a) => DX().keyOf({ email: emailOf(a.member), date: a.date }, ['email', 'date'])),
        check: (d) => ({ errors: d.email && !memberBy(d.email) ? ['مفيش موظف بالإيميل «' + d.email + '»'] : [] }),
        apply: (rows, onMatch) => { const A = K().store.attendance; const done = { created: [], updated: [] }; const mins = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
          for (const r of rows) { const d = r.data; const m = memberBy(d.email); if (!m) continue; const ex = A.find((a) => a.member === m.id && a.date === d.date);
            if (ex) { if (onMatch === 'تخطّي') continue; const old = {}; [['type', d.type], ['in', d.in ? mins(d.in) : undefined], ['out', d.out ? mins(d.out) : undefined], ['status', d.status]].forEach(([k, v]) => { if (v !== undefined && v !== '') { old[k] = ex[k]; ex[k] = v; } }); done.updated.push({ ex, old }); }
            else { const rec = { member: m.id, date: d.date, type: d.type || 'يوم عمل', in: mins(d.in), out: mins(d.out), ot: 0, late: 0, status: d.status || (d.in ? 'حاضر' : 'غائب'), src: 'استيراد' }; A.push(rec); done.created.push(rec); } }
          return { done, undo: () => { done.created.forEach((rec) => { const i = A.indexOf(rec); if (i >= 0) A.splice(i, 1); }); done.updated.forEach((u) => Object.assign(u.ex, u.old)); } }; } },
      { id: 'leaves', label: 'طلبات الإجازات', key: ['email', 'type', 'from'], modes: ['add'], dateKey: 'from',
        fields: () => [{ key: 'email', label: 'إيميل الموظف', en: 'Employee email', type: 'email', required: true }, { key: 'type', label: 'نوع الإجازة', en: 'Leave type', type: 'enum', options: K().store.leaveTypes.map((x) => x.name), required: true }, { key: 'from', label: 'من', en: 'From', type: 'date', required: true }, { key: 'to', label: 'لحد', en: 'To', type: 'date', required: true },
          { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: ['جديد', 'موافق', 'مرفوض'] }, { key: 'note', label: 'ملاحظة', en: 'Note' }],
        rows: () => K().store.requests.filter((q) => K().store.leaveTypes.some((t) => t.name === q.type)).map((q) => ({ email: emailOf(q.member), type: q.type, from: q.from, to: q.to, status: q.status, note: q.note || '' })),
        existing: () => K().store.requests.map((q) => DX().keyOf({ email: emailOf(q.member), type: q.type, from: q.from }, ['email', 'type', 'from'])),
        check: (d) => { const e = []; if (d.email && !memberBy(d.email)) e.push('مفيش موظف بالإيميل «' + d.email + '»'); if (d.from && d.to && d.to < d.from) e.push('«لحد» لازم يكون بعد «من»'); return { errors: e }; },
        apply: (rows) => { const Q = K().store.requests; const made = [];
          for (const r of rows) { const d = r.data; const m = memberBy(d.email); if (!m) continue; const rec = { id: 'HR-' + String(200 + (++store.seq)).padStart(4, '0'), type: d.type, member: m.id, from: d.from, to: d.to, note: d.note || '', status: d.status || 'جديد', at: 'استيراد' }; Q.push(rec); made.push(rec); }
          return { done: { created: made, updated: [] }, undo: () => made.forEach((rec) => { const i = Q.indexOf(rec); if (i >= 0) Q.splice(i, 1); }) }; } },
      { id: 'scores', label: 'تقييمات الأداء الشهرية (KPIs)', key: ['email', 'month'], modes: ['add', 'update'],
        fields: () => [{ key: 'email', label: 'إيميل الموظف', en: 'Employee email', type: 'email', required: true }, { key: 'month', label: 'الشهر (1–12)', en: 'Month (1-12)', type: 'number', required: true }, { key: 'score', label: 'التقييم %', en: 'Score %', type: 'number', required: true }],
        rows: () => { const S = K().store.scores || {}; return Object.keys(S).flatMap((id) => Object.keys(S[id]).map((mo) => ({ email: emailOf(id), month: Number(mo), score: S[id][mo] }))); },
        existing: () => { const S = K().store.scores || {}; return Object.keys(S).flatMap((id) => Object.keys(S[id]).map((mo) => DX().keyOf({ email: emailOf(id), month: Number(mo) }, ['email', 'month']))); },
        check: (d) => { const e = []; if (d.email && !memberBy(d.email)) e.push('مفيش موظف بالإيميل «' + d.email + '»'); if (d.month !== undefined && d.month !== '' && !(d.month >= 1 && d.month <= 12)) e.push('الشهر من 1 لـ 12'); if (d.score !== undefined && d.score !== '' && !(d.score >= 0 && d.score <= 200)) e.push('التقييم من 0 لـ 200%'); return { errors: e }; },
        apply: (rows, onMatch) => { const S = (K().store.scores = K().store.scores || {}); const done = { created: [], updated: [] };
          for (const r of rows) { const m = memberBy(r.data.email); if (!m) continue; const box = (S[m.id] = S[m.id] || {}); const mo = String(r.data.month); const had = mo in box; if (had && onMatch === 'تخطّي') continue; (had ? done.updated : done.created).push({ id: m.id, mo, old: box[mo], had }); box[mo] = r.data.score; }
          return { done, undo: () => done.created.concat(done.updated).forEach((u) => { if (u.had) S[u.id][u.mo] = u.old; else delete S[u.id][u.mo]; }) }; } },
      { id: 'holidays', label: 'العطلات الرسمية', key: 'date', modes: ['add', 'update'], dateKey: 'date',
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'name', label: 'المناسبة', en: 'Holiday', required: true }, { key: 'days', label: 'عدد الأيام', en: 'Days', type: 'number', required: true }, { key: 'kind', label: 'النوع', en: 'Kind', type: 'enum', options: ['ميلادي · سنوي', 'هجري'] }, { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: ['مؤكد', 'متوقع'] }],
        rows: () => K().store.holidays.map((x) => ({ date: x.date, name: x.name, days: x.days, kind: x.kind, status: x.status })),
        existing: () => K().store.holidays.map((x) => x.date),
        apply: (rows, onMatch) => upsert(K().store.holidays, rows, onMatch, (x, d) => x.date === d.date, (d) => ({ date: d.date, name: d.name, days: d.days, kind: d.kind || 'هجري', status: d.status || 'متوقع' })) },
      { id: 'customers', label: 'العملاء (خدمة العملاء)', key: 'phone', modes: ['add', 'update'],
        fields: () => [{ key: 'name', label: 'الاسم', en: 'Name', required: true }, { key: 'phone', label: 'الموبايل', en: 'Phone', type: 'phone', required: true, sensitive: true }, { key: 'city', label: 'المدينة / المنطقة', en: 'City' }, { key: 'address', label: 'العنوان', en: 'Address', sensitive: true },
          { key: 'tags', label: 'التاجات (افصلهم بـ ،)', en: 'Tags' }, { key: 'consent', label: 'موافق على الرسايل التسويقية', en: 'Marketing consent', type: 'enum', options: ['نعم', 'لا'] }, { key: 'source', label: 'جه منين', en: 'Source' }],
        rows: () => csData().customers.map((c) => ({ name: c.name, phone: c.phone, city: c.city || '', address: c.address || '', tags: (c.tags || []).join('، '), consent: c.consent ? 'نعم' : 'لا', source: c.source || '' })),
        existing: () => csData().customers.map((c) => c.phone),
        apply: (rows, onMatch) => upsert(csData().customers, rows, onMatch, (x, d) => x.phone === d.phone, (d) => ({ id: 'C' + (csData().customers.length + 1) + 'i', name: d.name, phone: d.phone, city: d.city || '', since: 'استيراد', address: d.address || '', channels: ['whatsapp'], tags: splitTags(d.tags), orders: 0, total: 0, lastOrderDays: null, refused: 0, returned: 0, openComplaints: 0, lateOpen: 0, consent: d.consent !== 'لا', autoConsent: d.consent !== 'لا', conversations: 0, source: d.source || 'استيراد', orderList: [], tickets: [], notes: [], lastActive: '—', province: '' }),
          (d) => { const p = {}; ['name', 'city', 'address', 'source'].forEach((k) => { if (d[k]) p[k] = d[k]; }); if (d.tags) p.tags = splitTags(d.tags); if (d.consent) { p.consent = d.consent === 'نعم'; p.autoConsent = p.consent; } return p; }) },
      { id: 'templates', label: 'قوالب الرسايل', key: 'name', modes: ['add', 'update'],
        fields: () => [{ key: 'lib', label: 'المكتبة', en: 'Library', type: 'enum', options: ['العملاء', 'المبتكرين'], required: true }, { key: 'name', label: 'اسم القالب', en: 'Template name', required: true }, { key: 'cat', label: 'التصنيف', en: 'Category' }, { key: 'body', label: 'النص (المتغيرات بين {})', en: 'Text', required: true }, { key: 'channels', label: 'القنوات', en: 'Channels' }],
        rows: () => csData().templates.map((t) => ({ lib: t.lib === 'vendors' ? 'المبتكرين' : 'العملاء', name: t.name, cat: t.cat || '', body: t.body, channels: t.channels || '' })),
        existing: () => csData().templates.map((t) => t.name),
        apply: (rows, onMatch) => upsert(csData().templates, rows, onMatch, (x, d) => VD.norm(x.name) === VD.norm(d.name), (d) => ({ id: 'T' + (csData().templates.length + 1) + 'i', lib: d.lib === 'المبتكرين' ? 'vendors' : 'customers', name: d.name, cat: d.cat || 'عام', tone: 'brand', body: d.body, trigger: 'يدوي', used: 0, channels: d.channels || 'كل القنوات', key: '' }),
          (d) => { const p = {}; if (d.lib) p.lib = d.lib === 'المبتكرين' ? 'vendors' : 'customers'; ['cat', 'body', 'channels'].forEach((k) => { if (d[k]) p[k] = d[k]; }); return p; }) },
      { id: 'quick', label: 'الردود السريعة', key: 'key', modes: ['add', 'update'],
        fields: () => [{ key: 'key', label: 'الاختصار (يبدأ بـ /)', en: 'Shortcut', required: true }, { key: 'label', label: 'الوصف', en: 'Label', required: true }, { key: 'text', label: 'نص الرد', en: 'Reply text', required: true }],
        rows: () => csData().quick.map((q) => ({ key: q.key, label: q.label, text: q.text })),
        existing: () => csData().quick.map((q) => q.key),
        check: (d) => ({ errors: d.key && !/^\//.test(d.key) ? ['الاختصار لازم يبدأ بـ / (مثلًا /شحن)'] : [] }),
        apply: (rows, onMatch) => upsert(csData().quick, rows, onMatch, (x, d) => x.key === d.key, (d) => ({ key: d.key, label: d.label, text: d.text })) },
      { id: 'delayRules', label: 'قواعد التأخير لكل مورد', key: 'maker', modes: ['add', 'update'],
        fields: () => [{ key: 'maker', label: 'المورد', en: 'Vendor', type: 'enum', options: vnames(), required: true }, { key: 'lead', label: 'مدة التصنيع (يوم)', en: 'Lead time (days)', required: true }, { key: 'risk', label: 'قابل للتأخير من يوم', en: 'At risk from day', type: 'number', required: true }, { key: 'late', label: 'متأخر بعد يوم', en: 'Late after day', type: 'number', required: true }],
        rows: () => (sapi().makerRules ? sapi().makerRules() : []).map((r) => ({ maker: r[0], lead: String(r[1]).replace(' يوم', ''), risk: Number(String(r[2]).replace(/\D/g, '')), late: Number(String(r[3]).replace(/\D/g, '')) })),
        existing: () => (sapi().makerRules ? sapi().makerRules() : []).map((r) => r[0]),
        check: (d) => ({ errors: d.risk !== undefined && d.late !== undefined && d.risk !== '' && d.late !== '' && !(d.risk < d.late) ? ['«قابل للتأخير» لازم قبل «متأخر»'] : [] }),
        apply: (rows, onMatch) => { const L = sapi().makerRules(); const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const ex = L.find((x) => VD.norm(x[0]) === VD.norm(d.maker));
            if (ex) { if (onMatch === 'تخطّي') continue; const old = ex.slice(); if (d.lead) ex[1] = d.lead + ' يوم'; if (d.risk !== undefined && d.risk !== '') ex[2] = 'يوم ' + d.risk; if (d.late !== undefined && d.late !== '') ex[3] = 'يوم ' + d.late; ex[4] = 'مدخل يدويًا'; done.updated.push({ ex, old }); }
            else { const nr = [d.maker, d.lead + ' يوم', 'يوم ' + d.risk, 'يوم ' + d.late, 'مدخل يدويًا', '—']; L.push(nr); done.created.push(nr); } }
          return { done, undo: () => { done.created.forEach((nr) => { const i = L.indexOf(nr); if (i >= 0) L.splice(i, 1); }); done.updated.forEach((u) => u.ex.splice(0, u.ex.length, ...u.old)); } }; } },
      { id: 'lists', label: 'القوائم والحالات', key: 'value', modes: ['add'], filter: { key: 'list', label: 'القائمة', options: () => Object.keys(sapi().lists ? sapi().lists() : {}) },
        fields: () => [{ key: 'list', label: 'القائمة', en: 'List', type: 'enum', options: Object.keys(sapi().lists ? sapi().lists() : {}), required: true }, { key: 'value', label: 'القيمة', en: 'Value', required: true }],
        rows: () => { const L = sapi().lists ? sapi().lists() : {}; return Object.keys(L).flatMap((k) => L[k].map((v) => ({ list: k, value: v }))); },
        existing: () => { const L = sapi().lists ? sapi().lists() : {}; return Object.keys(L).flatMap((k) => L[k]); },
        apply: (rows, onMatch) => { const added = [];
          for (const r of rows) { const L = sapi().lists(); const arr = L[r.data.list]; if (!arr) continue; if (arr.some((v) => VD.norm(v) === VD.norm(r.data.value))) continue; sapi().addListValue(r.data.list, r.data.value); added.push([r.data.list, r.data.value]); }
          return { done: { created: added, updated: [] }, undo: () => added.forEach(([l, v]) => sapi().removeListValue(l, v)) }; } }];
    return { groups: () => GROUPS, group: (id) => GROUPS.find((g) => g.id === id) };
  })();
  window.IBData = IBData;

  // ---------- state ----------
  const TABS = [{ id: 'expenses', label: 'المصروفات' }, { id: 'sales', label: 'المبيعات' }, { id: 'vendors', label: 'حسابات الموردين' }, { id: 'actual', label: 'الحساب الفعلي' }];
  const PRESETS = [['today', 'اليوم'], ['yesterday', 'أمس'], ['todayYesterday', 'اليوم وأمس'], ['last7', 'آخر 7 أيام'], ['last14', 'آخر 14 يومًا'], ['last28', 'آخر 28 يومًا'], ['last30', 'آخر 30 يومًا'], ['thisWeek', 'هذا الأسبوع'], ['lastWeek', 'الأسبوع الماضي'], ['thisMonth', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['max', 'أقصى فترة'], ['custom', 'مخصص']];
  const SORTS = [
    { value: 'balance:desc', label: 'الرصيد: من الأعلى للأقل', key: 'balance', dir: 'desc' }, { value: 'balance:asc', label: 'الرصيد: من الأقل للأعلى', key: 'balance', dir: 'asc' },
    { value: 'deposits:desc', label: 'العربون: من الأعلى للأقل', key: 'deposits', dir: 'desc' }, { value: 'deposits:asc', label: 'العربون: من الأقل للأعلى', key: 'deposits', dir: 'asc' }];
  const state = { tab: 'expenses', range: { from: '2026-09-01', to: '2026-09-30', preset: 'custom' }, sort: 'balance:desc', note: null };
  const hashTab = () => { const t = location.hash.slice(1); return TABS.some((x) => x.id === t) ? t : null; };
  state.tab = hashTab() || 'expenses';
  const REPORT_TABS = [{ id: 'orders', label: 'تقارير الأوردرات' }, { id: 'vendors', label: 'تقارير الموردين' }, { id: 'accounts', label: 'تقارير الحسابات' }];
  const reportTabOf = (hash) => { const m = /^reports(?:-(orders|vendors|accounts))?$/.exec(hash); return m ? (m[1] || 'orders') : null; };
  state.rtab = reportTabOf(location.hash.slice(1)) || 'orders';
  state.rrange = Object.assign(D.presetRange('last30', TODAY), { preset: 'last30' });
  state.rcompare = false;
  const ticketOf = (hash) => { const m = /^tickets(?:\/(TKT-\d{4}))?$/.exec(hash); return m ? (m[1] || '') : null; };
  const vendorOf = (hash) => { const m = /^makers(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i.exec(hash); return m ? (m[1] || '') : null; }; // #makers/<vendor uuid> (phase 3) — '#vendors' stays the accounts tab
  const modPage = (hs) => (window.IBPages ? window.IBPages.match(hs) : null);
  state.page = modPage(location.hash.slice(1)) || (location.hash.slice(1) === 'orders' ? 'orders' : reportTabOf(location.hash.slice(1)) ? 'reports' : ticketOf(location.hash.slice(1)) !== null ? 'tickets' : vendorOf(location.hash.slice(1)) !== null ? 'vendors' : 'accounts');

  // ---------- derived helpers ----------
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function monthOfRange(r) { const [y, m] = r.from.split('-').map(Number); return r.from === y + '-' + String(m).padStart(2, '0') + '-01' && r.to === y + '-' + String(m).padStart(2, '0') + '-' + String(lastDay(y, m)).padStart(2, '0') ? { y, m } : null; }
  function seedKeysIn(r) { return Object.keys(SEED.expenseSeed).filter((k) => { const [y, m] = k.split('-').map(Number); return k + '-01' >= r.from && k + '-' + lastDay(y, m) <= r.to; }); }
  const inRange = (d) => d >= state.range.from && d <= state.range.to;
  // Owner (22 Oct): transport is deducted from the vendor balance. «مواصلات» moves count once, as transport (not as a deposit move).
  const vendorsNow = () => { const by = {}; transportRows().forEach((r) => { if (r.vendor) by[r.vendor] = (by[r.vendor] || 0) + r.amount; });
    return D.deductTransport(D.deriveVendors(SEED.vendors.map((v) => ({ ...v })), store.vendorMoves.filter((m) => !(m.type === 'مواصلات' && m.direction === 'withdraw'))), by); };
  const accountsNow = () => D.deriveAccounts(SEED.accounts, store.accountMoves);
  const setNote = (n) => { state.note = n; };

  // ---------- shell ----------
  const NAV = [['home', 'لوحة التحكم', 'dashboard'], ['box', 'الأوردرات', 'orders'], ['users', 'المبتكرين', 'vendors'], ['wallet', 'الحسابات', 'accounts'], ['tag', 'المخزون', 'inventory'], ['headset', 'خدمة العملاء', 'cs'], ['ticket', 'تذاكر الفريق', 'tickets'], ['chart', 'التقارير', 'reports'], ['briefcase', 'الموارد البشرية', 'hr'], ['gear', 'الإعدادات', 'settings']];
  function Sidebar() {
    return h('nav', { class: 'sidebar', 'aria-label': 'القائمة الرئيسية' },
      h('a', { class: 'brand', href: '#dashboard', 'aria-label': 'إبتكر كلوب — بيت لكل مبتكر' }, window.IBLogo.Logo({ tone: 'reversed', width: 150 }), h('small', { class: 'tagline' }, window.IBLogo.TAGLINE)),
      NAV.map(([ic, lb, page]) => h('button', { type: 'button', class: 'nav-item', 'data-page': page || false, 'aria-disabled': page ? false : 'true', title: page ? lb : lb + ' — غير متاح في النموذج', onClick: page ? () => go(page) : null }, Icon(ic), h('span', null, lb))));
  }
  // Bottom nav (mobile <=767) — Figma: Bottom nav 266:478 / Bottom nav item 266:476. 5 items; «المزيد» opens a sheet with the rest of the menu.
  const BN = [['box', 'الأوردرات', 'orders'], ['users', 'المبتكرين', 'vendors'], ['wallet', 'الحسابات', 'accounts'], ['ticket', 'تذاكر الفريق', 'tickets']];
  function BottomNav() {
    const item = (ic, lb, page, extra) => h('button', Object.assign({ type: 'button', class: 'bn-item', 'data-page': page || false, onClick: page ? () => go(page) : null }, extra || {}), h('span', { class: 'pill' }, Icon(ic)), h('span', { class: 'bn-lbl' }, lb));
    const wrap = h('div', { class: 'pop-anchor bn-more', 'data-popover-root': '' });
    const more = item('more', 'المزيد', null, { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const pop = U.popover(wrap, more, (close) => h('div', { class: 'menu bn-sheet', role: 'dialog', 'aria-label': 'القائمة', 'data-popover-root': '' },
      h('div', { class: 't-label bn-sheet-h' }, 'القائمة'),
      NAV.map(([ic, lb, page]) => h('button', { type: 'button', role: 'menuitem', class: 'opt bn-opt', 'data-page': page || false, 'aria-disabled': page ? false : 'true', 'aria-current': page && page === state.page ? 'page' : false, onClick: page ? () => { close(); go(page); } : null }, Icon(ic), h('span', null, lb), page ? null : h('small', null, 'غير متاح في النموذج')))));
    more.addEventListener('click', () => pop.toggle()); wrap.append(more);
    return h('nav', { class: 'bottom-nav', 'aria-label': 'القائمة السفلية' }, BN.map(([ic, lb, page]) => item(ic, lb, page)), wrap);
  }
  function TopHeader() {
    const q = h('input', { id: 'gq', type: 'search', placeholder: 'ابحث برقم الأوردر أو اسم العميل أو الهاتف', 'aria-label': 'بحث عام', autocomplete: 'off' });
    q.addEventListener('input', () => { if (state.page !== 'orders') go('orders'); window.OrdersApp.setQuery(q.value); });
    return h('header', { class: 'topbar' },
      h('label', { class: 'search' }, Icon('search', 'sm'), q),
      AiButton(),
      NotificationsMenu(),
      window.IBShell.ClockWidget(),
      window.IBShell.AccountMenu(go));
  }
  function showPage() {
    document.getElementById('main').hidden = state.page !== 'accounts';
    document.getElementById('orders').hidden = state.page !== 'orders';
    document.getElementById('reports').hidden = state.page !== 'reports';
    document.getElementById('tickets').hidden = state.page !== 'tickets';
    document.getElementById('vendors').hidden = state.page !== 'vendors';
    const mods = window.IBPages.all(); Object.keys(mods).forEach((id) => { document.getElementById('pg-' + id).hidden = state.page !== id; }); window.IBPages.current = mods[state.page] ? state.page : null;
    const navPage = mods[state.page] && mods[state.page].navPage ? (mods[state.page].navPage() || state.page) : state.page;
    document.querySelectorAll('.nav-item[data-page],.bn-item[data-page]').forEach((b) => (b.dataset.page === navPage ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    const bmore = document.querySelector('.bn-more .bn-item'); if (bmore) { const inMore = !['orders', 'vendors', 'accounts', 'tickets'].includes(state.page); bmore.setAttribute('aria-current', inMore ? 'page' : 'false'); if (!inMore) bmore.removeAttribute('aria-current'); }
    if (mods[state.page]) { document.title = mods[state.page].title + ' — نظام إبتكر'; return; }
    document.title = state.page === 'orders' ? 'الأوردرات — نظام إبتكر' : state.page === 'reports' ? 'التقارير — نظام إبتكر' : state.page === 'tickets' ? 'تذاكر الفريق — نظام إبتكر' : state.page === 'vendors' ? 'المبتكرين — نظام إبتكر' : 'الحسابات — نظام إبتكر';
  }
  function go(page) {
    const mods = window.IBPages.all(); const cur = mods[state.page];
    if (cur && cur.canLeave && page !== state.page) { let ok = false; cur.canLeave(() => { ok = true; goNow(page); }); return; }
    goNow(page);
  }
  function goNow(page) {
    const mods = window.IBPages.all();
    if (mods[page]) { U.closePopover(); state.page = page; try { history.replaceState(null, '', '#' + mods[page].defaultHash()); } catch (e) { /* sandboxed */ } showPage(); window.IBPages.render(page, false); window.scrollTo(0, 0); return; }
    U.closePopover(); state.page = page;
    try { history.replaceState(null, '', '#' + (page === 'orders' ? 'orders' : page === 'reports' ? 'reports-' + state.rtab : page === 'tickets' ? 'tickets' : page === 'vendors' ? 'makers' : state.tab)); } catch (e) { /* sandboxed */ }
    showPage(); if (page === 'accounts') render(); if (page === 'reports') renderReports(); if (page === 'tickets') renderTickets(); if (page === 'vendors') renderVendors(); window.scrollTo(0, 0);
  }


  // ---------- notifications panel (header bell) — Figma: Notifications panel 242:390 ----------
  // nav sections on the left, tabs inside each section (first tab "الكل"), items open the right thing.
  const OA = () => window.OrdersApp;
  const alerts = () => (OA() && OA().alerts) ? OA().alerts() : { follow: [], unconfirmed: [], waiting: [], lateVendors: [], riskVendors: [] };
  const rel = (d) => (d == null ? '' : d === 0 ? 'اليوم' : d === 1 ? 'أمس' : 'منذ ' + d + ' أيام');
  const orderItem = (o, sub, tone) => { const full = OA().get ? OA().get(o.id) : null; return { own: { role: 'خدمة العملاء' }, key: 'o:' + o.id, title: 'IB-' + o.id + ' — ' + o.name, sub, meta: full ? rel(full.age) : '', tone, icon: 'users', run: () => OA().details(o.id) }; };

  // ---------- accounts alerts (owner 22 Oct): payroll before payday + biweekly vendor statements ----------
  const allOrders = () => { const A = OA(); return A && A.query ? A.query({}, 10000).rows.map((r) => A.get(r.id)).filter(Boolean) : []; };
  const accCfg = () => ((window.IBKit && window.IBKit.store.accAlerts) || { payDay: 1, lead: 14, anchor: '2026-09-05' });
  const arDate = (d) => D.formatDateNumeric(d);
  function payrollInfo() {
    const K = window.IBKit, O = window.IbtekrOps; if (!K || !O || !O.payrollDue) return null; const HRA = window.IBPages.all().hr.api; const c = accCfg();
    const due = O.payrollDue(K.TODAY, { payDay: c.payDay, lead: c.lead, status: K.store.sheet.status }); const team = K.team();
    const slips = team.map((m) => ({ m, s: HRA.slipOf(m) })); const net = Math.round(slips.reduce((t, x) => t + x.s.net, 0) * 100) / 100;
    return { due, slips, net, status: K.store.sheet.status, month: K.store.sheet.month };
  }
  function openPayrollAlert() {
    const p = payrollInfo(); if (!p) return; const fmt = (n) => D.formatMoney(n);
    U.DetailsModal({ title: 'مرتبات الموظفين — يوم الصرف ' + arDate(p.due.date), sub: 'فاضل ' + p.due.daysLeft + ' يوم · كشف ' + p.month + ' حالته «' + p.status + '» — راجعه واعتمده وحوّل قبل يوم الصرف',
      summary: [{ label: 'الموظفين', value: String(p.slips.length) }, { label: 'إجمالي الصافي', value: fmt(p.net) + ' ج.م' }, { label: 'حالة الكشف', value: p.status }, { label: 'يوم الصرف', value: arDate(p.due.date) }],
      headers: ['الموظف', 'المرتب المدفوع', 'إضافي + بدلات', 'خصومات', 'الصافي'],
      rows: p.slips.map((x) => [x.m.name, fmt(x.s.paid), fmt(x.s.overtime + x.s.bonus), fmt(x.s.deductions + x.s.advances + x.s.absence), fmt(x.s.net)]),
      total: ['الإجمالي', fmt(p.slips.reduce((t, x) => t + x.s.paid, 0)), fmt(p.slips.reduce((t, x) => t + x.s.overtime + x.s.bonus, 0)), fmt(p.slips.reduce((t, x) => t + x.s.deductions + x.s.advances + x.s.absence, 0)), fmt(p.net)],
      actions: [{ label: 'فتح كشف المرتبات', onClick: () => { location.hash = 'hr-payroll'; } }], source: 'الموارد البشرية › المرتبات والمكافآت' }, { label: 'مرتبات الموظفين' });
  }
  function statementPeriod() { const c = accCfg(); const t = window.IBKit ? window.IBKit.TODAY : '2026-10-21'; return c.cycle === 'monthDays' && window.IbtekrOps ? window.IbtekrOps.monthDaysPeriod(t, c.days) : VD.biweeklyPeriod(t, c.anchor); }
  const cycleLabel = () => { const c = accCfg(); return c.cycle === 'monthDays' && window.IbtekrOps ? window.IbtekrOps.monthDaysLabel(c.days) : 'كل أسبوعين'; };
  function vendorStatements() {
    const per = statementPeriod(); const orders = allOrders();
    return vendorsNow().map((sd) => { const v = vstore.findByName(sd.name); const r = VD.periodStatement(orders, v ? [v.name, ...v.aliases] : [sd.name], per, sd.balance); const mo = VD.periodMoney(store.vendorMoves, transportRows(), sd.name, per); return { name: sd.name, v, r, mo }; })
      .filter((x) => x.r.orders > 0 || x.r.balance !== 0 || x.mo.deposits > 0 || x.mo.transport > 0).sort((a, b) => b.r.orders - a.r.orders || Math.abs(b.r.balance) - Math.abs(a.r.balance));
  }
  function openVendorStatement(name) {
    const per = statementPeriod(); const x = vendorStatements().find((s) => s.name === name) || { name, v: vstore.findByName(name), r: VD.periodStatement([], [name], per, 0), mo: VD.periodMoney([], [], name, per) }; const r = x.r; const mo = x.mo; const fmt = (n) => D.formatMoney(n);
    U.DetailsModal({ title: 'كشف حساب ' + name + ' — ' + cycleLabel(), sub: 'من ' + arDate(per.from) + ' لـ ' + arDate(per.to) + ' · الناجحة = مكتمل · الفاشلة = ملغي + مرتجع · الرصيد بعد خصم المواصلات',
      summary: [{ label: 'الرصيد', value: fmt(r.balance) + ' ج.م' }, { label: 'ناجحة', value: String(r.success) + ' أوردر' }, { label: 'فاشلة', value: String(r.failed) + ' أوردر' }, { label: 'منها ملغي / مرتجع', value: r.cancelled + ' / ' + r.returned }, { label: 'العربون المستلم في الفترة', value: fmt(mo.deposits) + ' ج.م' }, { label: 'المواصلات في الفترة', value: fmt(mo.transport) + ' ج.م' + (mo.trips ? ' (' + mo.trips + ' مشوار)' : '') }],
      headers: ['المنتج', 'رقم الأوردر', 'التاريخ', 'القيمة (ج.م)', 'الحالة'],
      rows: r.rows.map((o) => [prodThumb(o.sku, o.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + o.oid)), arDate(o.date), fmt(o.tot), o.status]),
      total: r.rows.length ? ['الإجمالي', String(r.orders) + ' أوردر', '', fmt(r.value), ''] : null,
      onRow: (i) => showOrders({ q: r.rows[i].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, empty: 'مفيش أوردرات ناجحة أو فاشلة في الفترة دي.', note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'العربون في الفترة = حركات «عربون» المسجّلة من السيستم بتاريخها (عرابين شيت Balances_Payouts مالهاش تاريخ فمش داخلة). المواصلات = مشاوير المورد في الفترة (من غير المرتجعات).', source: 'الأوردرات + الحركات المالية + شيت المواصلات' }, { label: 'كشف حساب ' + name });
  }
  // ---------- weekly vendor report (owner 22 Oct): every Sunday on WhatsApp — late + in progress + completed in the week + actual account ----------
  const weeklyCfg = () => ((window.IBKit && window.IBKit.store.vendorWeekly) || { weekday: 'الأحد', at: '10:00 ص' });
  function weeklyPer() { const t = window.IBKit ? window.IBKit.TODAY : '2026-10-21'; return window.IbtekrOps.weeklyPeriod(t, weeklyCfg().weekday); }
  function weeklyOf(name, per, orders) {
    const v = vstore.findByName(name); const names = v ? [v.name].concat(v.aliases || []) : [name];
    const r = VD.weeklyVendorReport(orders || allOrders(), names, per, VD.periodMoney(store.vendorMoves, transportRows(), name, per), v ? Object.assign({ rateHistory: [] }, v) : null);
    return { name, v, r };
  }
  function vendorWeeklies() {
    const per = weeklyPer(); const orders = allOrders();
    return vendorsNow().map((sd) => weeklyOf(sd.name, per, orders)).filter((x) => x.r.late.length || x.r.progress.length || x.r.completed.length || x.r.transport || x.r.deposits)
      .sort((a, b) => b.r.late.length - a.r.late.length || b.r.progress.length - a.r.progress.length || b.r.completed.length - a.r.completed.length);
  }
  function openVendorWeekly(name) {
    const per = weeklyPer(); const x = weeklyOf(name, per); const r = x.r; const fmt = (n) => D.formatMoney(n); const c = weeklyCfg();
    const kindOf = (o, k) => (k === 'late' ? 'متأخر' : k === 'done' ? 'مكتمل' : o.delivery === 'risk' ? 'قابل للتأخير' : 'قيد التنفيذ');
    const list = r.late.map((o) => [o, 'late']).concat(r.progress.map((o) => [o, 'prog']), r.completed.map((o) => [o, 'done']));
    U.DetailsModal({ title: 'التقرير الأسبوعي — ' + name, sub: 'بيتبعت للمورد على واتساب كل ' + c.weekday + ' الساعة ' + c.at + ' · المكتملة من ' + arDate(per.from) + ' لـ ' + arDate(per.to) + ' · المتأخرة وقيد التنفيذ = المفتوح دلوقتي',
      summary: [{ label: 'متأخرة', value: String(r.late.length) + ' أوردر' }, { label: 'قيد التنفيذ', value: String(r.progress.length) + ' أوردر' }, { label: 'مكتملة في الأسبوع', value: String(r.completed.length) + ' أوردر' },
        { label: 'مستحقه من المكتملة', value: fmt(r.share) + ' ج.م' }, { label: 'خصم المواصلات', value: fmt(r.transport) + ' ج.م' }, { label: 'خصم العربون', value: fmt(r.deposits) + ' ج.م' }, { label: 'الحساب الفعلي', value: fmt(r.net) + ' ج.م' }],
      headers: ['المنتج', 'رقم الأوردر', 'الحالة', 'عمر الأوردر', 'القيمة (ج.م)'],
      rows: list.map(([o, k]) => [prodThumb(o.sku, o.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + o.oid)), kindOf(o, k), o.age + ' يوم', fmt(o.tot)]),
      total: r.completed.length ? ['قيمة المكتملة', String(r.completed.length) + ' أوردر', '', '', fmt(r.completedValue)] : null,
      onRow: (i) => showOrders({ q: list[i][0].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, shareText: VD.weeklyVendorText(name, r, per), empty: 'مفيش أوردرات للمورد ده الأسبوع ده.',
      note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'الحساب الفعلي = مستحق المورد من الأوردرات المكتملة في الأسبوع (بعد نسبة إبتكر على تاريخ كل أوردر) − المواصلات − العربون في نفس الأسبوع. رسالة المورد مفيهاش نسبة إبتكر.', source: 'الأوردرات + الحركات المالية + شيت المواصلات' }, { label: 'التقرير الأسبوعي ' + name });
  }
  // ---------- daily vendor follow-up (owner 22 Oct): replaces the daily late alert — late + at risk + confirmed since yesterday ----------
  function dailyRange() { const t = window.IBKit ? window.IBKit.TODAY : '2026-10-21'; const y = new Date(Date.parse(t + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); return { from: y, to: t }; }
  function dailyOf(name, orders) { const v = vstore.findByName(name); return { name, v, r: VD.dailyVendorReport(orders || allOrders(), v ? [v.name].concat(v.aliases || []) : [name], dailyRange()) }; }
  function vendorDailies() { const orders = allOrders(); const names = [...new Set(orders.flatMap((o) => o.subs.map((s) => { const v = vstore.findByName(s.vendor); return v ? v.name : s.vendor.trim(); })))];
    return names.map((n) => dailyOf(n, orders)).filter((x) => x.r.late.length || x.r.risk.length || x.r.confirmed.length).sort((a, b) => b.r.late.length - a.r.late.length || b.r.risk.length - a.r.risk.length || b.r.confirmed.length - a.r.confirmed.length); }
  function openVendorDaily(name) {
    const x = dailyOf(name); const r = x.r; const fmt = (n) => D.formatMoney(n); const rg = dailyRange();
    const list = r.late.map((o) => [o, 'متأخر']).concat(r.risk.map((o) => [o, 'قابل للتأخير']), r.confirmed.map((o) => [o, 'اتأكد — ابدأ']));
    U.DetailsModal({ title: 'المتابعة اليومية — ' + name, sub: 'بتتبعت للمورد على واتساب كل يوم الساعة 10:00 ص · المتأخرة والقابلة للتأخير = المفتوح دلوقتي · المؤكدة = اتأكدت من ' + arDate(rg.from) + ' لـ ' + arDate(rg.to),
      summary: [{ label: 'متأخرة', value: String(r.late.length) + ' أوردر' }, { label: 'قابلة للتأخير', value: String(r.risk.length) + ' أوردر' }, { label: 'اتأكدت — يبدأ فيها', value: String(r.confirmed.length) + ' أوردر' }],
      headers: ['المنتج', 'رقم الأوردر', 'الحالة', 'عمر الأوردر', 'القيمة (ج.م)'],
      rows: list.map(([o, k]) => [prodThumb(o.sku, o.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + o.oid)), k, o.age + ' يوم', fmt(o.tot)]),
      onRow: (i) => showOrders({ q: list[i][0].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, shareText: VD.dailyVendorText(name, r, rg.to), empty: 'مفيش حاجة للمورد ده النهارده.',
      note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'بدل تنبيه «مورد متأخر» اليومي. الأوردرات الفرعية بتبقى «مؤكد» تلقائي أول ما الأوردر الرئيسي يتأكد.', source: 'الأوردرات' }, { label: 'المتابعة اليومية ' + name });
  }
  // ---------- delivery (owner 22 Oct): a sub-order «جاهز للشحن من …» → Bosta waybill for the delivery owner (sender, receiver, total / deposit / remaining) ----------
  const dcfg = () => (window.IBKit && window.IBKit.store.delivery) || { company: 'بوسطة', owner: 'M07', whName: 'مخزن إبتكر', whAddress: '', whPhone: '' };
  const dOwner = () => { const K = window.IBKit; return K ? K.member(dcfg().owner) : null; };
  const waHref = (p, text) => 'https://wa.me/' + VD.waPhone(p) + (text ? '?text=' + encodeURIComponent(text) : '');
  const waLink = (p) => (p ? h('span', { class: 'wa-ph' }, h('bdi', { dir: 'ltr' }, p), h('a', { class: 'wa-a', href: waHref(p), target: '_blank', rel: 'noopener', 'aria-label': 'واتساب ' + p, title: 'فتح واتساب' }, Icon('whatsapp', 'sm'))) : '—');
  function waybills() {
    const O = window.IbtekrOps; const c = dcfg(); const wh = { name: c.whName, phone: c.whPhone, address: c.whAddress }; const out = [];
    for (const o of allOrders()) for (const s of o.subs) { if (!O.isShipReady(s.ss) || s.waybill) continue; const v = vstore.findByName(s.vendor);
      const w = O.waybillFor(o, s, v ? { name: v.name, phone: v.phone, address: v.address } : { name: s.vendor.trim() }, wh); w.readyAt = s.readyAt || ''; out.push(w); }
    return out.sort((a, b) => (a.readyAt < b.readyAt ? -1 : a.readyAt > b.readyAt ? 1 : 0));
  }
  const waitedH = (w) => { const K = window.IBKit; if (!w.readyAt || !K) return 0; const now = Date.parse(K.TODAY + 'T' + (K.clockNow ? K.clockNow() : '12:00') + ':00Z'); return Math.max(0, Math.round((now - Date.parse(w.readyAt.replace(' ', 'T') + ':00Z')) / 3600000)); };
  function openWaybill(key) {
    const K = window.IBKit;
    const w0 = waybills().find((x) => x.key === key); if (!w0) { window.IBKit.toast('البوليصة دي اتعملت خلاص', 'success'); return; } const fmt = (n) => D.formatMoney(n); const own = dOwner();
    const party = (title, p, editable, f, set, e) => h('div', { class: 'wb-party' }, h('b', { class: 't-label' }, title),
      U.InfoRow({ label: 'الاسم', value: p.name }), U.InfoRow({ label: 'التليفون', value: waLink(p.phone) }),
      editable ? K.two(K.field.text('city', 'المحافظة', f, e, set, { placeholder: 'مثلًا: الجيزة' }), K.field.text('addr', 'العنوان بالتفصيل', f, e, set, { required: true, placeholder: 'الشارع، الحي، علامة مميزة' })) : U.InfoRow({ label: 'العنوان', value: p.address || h('span', { class: 'wb-miss' }, 'ناقص — كمّله من ملف ' + (p.kind === 'vendor' ? 'المورد' : 'المخزن في الإعدادات')) }));
    const o0 = OA().get(w0.oid);
    K.form({ title: 'بوليصة ' + dcfg().company + ' — أوردر IB-' + w0.oid + ' · فرعي ' + w0.sid, wide: true, values: { city: o0.city || '', addr: o0.addr || '', no: '' },
      note: (f) => h('div', { class: 'wb-head' }, K.Tag('info', w0.route), h('span', { class: 't-small' }, w0.prod + ' × ' + w0.qty + (w0.readyAt ? ' · جاهز من ' + w0.readyAt : '') + ' · المسؤول: ' + (own ? own.name : '—'))),
      fields: (f, e, set) => { const toCust = w0.receiver.kind === 'customer' || w0.sender.kind === 'customer';
        const w = window.IbtekrOps.waybillFor(Object.assign({}, o0, { city: f.city, addr: f.addr }), OA().get(w0.oid).subs.find((x) => String(x.sid) === w0.sid), { name: w0.sender.kind === 'vendor' ? w0.sender.name : w0.receiver.name, phone: (w0.sender.kind === 'vendor' ? w0.sender : w0.receiver).phone, address: (w0.sender.kind === 'vendor' ? w0.sender : w0.receiver).address }, { name: dcfg().whName, phone: dcfg().whPhone, address: dcfg().whAddress });
        return [h('div', { class: 'wb-grid' }, party('المرسل — ' + ({ vendor: 'المورد', warehouse: 'المخزن', customer: 'العميل' })[w0.sender.kind], w0.sender, w0.sender.kind === 'customer', f, set, e), party('المستلم — ' + ({ vendor: 'المورد', warehouse: 'المخزن', customer: 'العميل' })[w0.receiver.kind], w0.receiver, w0.receiver.kind === 'customer', f, set, e)),
          h('div', { class: 'dt-sum' }, [['الإجمالي', w.total], ['العربون', w.deposit], ['المبلغ المتبقي', w.remaining], ['يتحصّل من العميل', w.collect]].map(([l, v]) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, l), h('b', null, fmt(v) + ' ج.م')))),
          toCust ? null : h('p', { class: 't-small help', style: 'margin:0' }, 'شحنة من المورد للمخزن — مفيش تحصيل.'),
          w.missing.length ? U.InlineNote({ kind: 'warning', children: 'ناقص: ' + w.missing.join('، ') }) : null,
          K.field.text('no', 'رقم بوليصة ' + dcfg().company, f, e, set, { required: true, placeholder: 'من لوحة ' + dcfg().company + ' بعد ما تعملها', help: 'لما تكتبه البوليصة بتتقفل وتختفي من التنبيهات' })]; },
      validate: (f) => { const e = {}; if (!String(f.no || '').trim()) e.no = 'اكتب رقم البوليصة'; if ((w0.receiver.kind === 'customer' || w0.sender.kind === 'customer') && !String(f.addr || '').trim()) e.addr = 'اكتب عنوان العميل'; return e; },
      extraFooter: (f) => h('div', { class: 'acts-inline' }, Button({ label: 'نسخ البيانات', icon: 'copy', onClick: () => { const t = window.IbtekrOps.waybillText(window.IbtekrOps.waybillFor(Object.assign({}, o0, { city: f.city, addr: f.addr }), OA().get(w0.oid).subs.find((x) => String(x.sid) === w0.sid), vstore.findByName(OA().get(w0.oid).subs.find((x) => String(x.sid) === w0.sid).vendor), { name: dcfg().whName, phone: dcfg().whPhone, address: dcfg().whAddress })); try { navigator.clipboard.writeText(t); } catch (er) { /* ignore */ } window.IBKit.toast('اتنسخت بيانات البوليصة', 'success'); } }),
        own && own.phone ? h('a', { class: 'btn btn-default', style: 'text-decoration:none', href: waHref(own.phone, window.IbtekrOps.waybillText(w0)), target: '_blank', rel: 'noopener' }, Icon('whatsapp', 'sm'), 'ابعت لـ' + own.name.split(' ')[0] + ' على واتساب') : null),
      submitLabel: 'اتعملت البوليصة',
      submit: (f) => { if (f.city !== (o0.city || '') || f.addr !== (o0.addr || '')) OA().patch(w0.oid, { city: f.city.trim(), addr: f.addr.trim() });
        OA().waybill(w0.oid, w0.sid, { no: f.no.trim(), company: dcfg().company, at: window.IBKit.TODAY, by: window.IBKit.ME });
        log.append({ action: 'delivery.waybill.done', actor: ACTOR, newValue: 'IB-' + w0.oid + ' · #' + w0.sid + ' · ' + dcfg().company + ' ' + f.no.trim() }); window.IBKit.toast('اتسجلت البوليصة ' + f.no.trim(), 'success'); document.dispatchEvent(new Event('ib:notify')); } });
  }
  function openDeliveryDigest() {
    const L = waybills(); const fmt = (n) => D.formatMoney(n); const own = dOwner(); const day = window.IBKit ? window.IBKit.TODAY : '';
    U.DetailsModal({ title: 'ملخص التوصيل اليومي — ' + arDate(day), sub: 'بيتبعت لـ' + (own ? own.name : 'المسؤول عن التوصيل') + ' الساعة 9:00 ص · كل البوالص اللي لسه ما اتعملتش · اضغط على أي صف تفتح البوليصة',
      summary: [{ label: 'بوالص', value: String(L.length) }, { label: 'متأخرة (+24 ساعة)', value: String(L.filter((w) => waitedH(w) >= 24).length) }, { label: 'يتحصّل من العملاء', value: fmt(L.reduce((t, w) => t + w.collect, 0)) + ' ج.م' }],
      headers: ['الأوردر', 'الشحنة', 'المرسل', 'المستلم', 'الإجمالي', 'العربون', 'المتبقي'],
      rows: L.map((w) => [h('bdi', { dir: 'ltr' }, 'IB-' + w.oid + ' · #' + w.sid), w.route, w.sender.name + ' · ' + (w.sender.phone || '—'), w.receiver.name + ' · ' + (w.receiver.phone || '—') + (w.receiver.address ? '' : ' · العنوان ناقص'), fmt(w.total), fmt(w.deposit), fmt(w.remaining)]),
      onRow: (i) => openWaybill(L[i].key), phone: own && own.phone, email: own && own.email, shareText: window.IbtekrOps.deliveryDigestText(L, day), empty: 'مفيش بوالص مطلوبة النهارده.', source: 'الأوردرات الفرعية «جاهز للشحن …»' }, { label: 'ملخص التوصيل' });
  }
  function deliverySection() {
    const L = waybills(); const own = dOwner();
    const item = (w, late) => ({ own: { role: 'عمليات' }, key: (late ? 'dl:' : 'dw:') + w.key, title: 'بوليصة ' + dcfg().company + ' — IB-' + w.oid + ' · ' + w.route, sub: w.sender.name + ' ← ' + w.receiver.name + ' · المتبقي ' + D.formatMoney(w.remaining) + ' ج.م' + (w.missing.length ? ' · ناقص ' + w.missing.length : '') + (late ? ' · مستنية ' + waitedH(w) + ' ساعة' : ''), meta: w.readyAt ? w.readyAt.slice(11) : '', tone: late ? 'error' : w.missing.length ? 'warning' : 'neutral', icon: 'truck', run: () => openWaybill(w.key) });
    const req = L.map((w) => item(w, false)); const late = L.filter((w) => waitedH(w) >= 24).map((w) => item(w, true));
    const daily = L.length ? [{ own: { role: 'عمليات' }, key: 'dd:' + (window.IBKit ? window.IBKit.TODAY : ''), title: 'ملخص التوصيل اليومي — ' + L.length + ' بوليصة', sub: 'لـ' + (own ? own.name : 'المسؤول عن التوصيل') + ' · المرسل والمستلم وبياناتهم + الإجمالي والعربون والمتبقي', meta: '9:00 ص', tone: 'neutral', icon: 'file', run: openDeliveryDigest }] : [];
    return { id: 'delivery', label: 'التوصيل', icon: 'truck', unit: 'بوليصة', all: () => showOrders({}), allLabel: 'عرض الأوردرات', empty: 'مفيش بوالص مطلوبة.',
      tabs: [['all', 'الكل', late.concat(req, daily)], ['waybills', 'بوالص مطلوبة', req], ['late', 'متأخرة', late], ['daily', 'الملخص اليومي', daily]] };
  }
  function accountsSection() {
    const p = payrollInfo(); const per = statementPeriod();
    const pay = p && p.due.show ? [{ own: { role: 'الحسابات' }, key: 'pay:' + p.due.date, title: 'مرتبات الموظفين — يوم الصرف ' + arDate(p.due.date), sub: 'فاضل ' + p.due.daysLeft + ' يوم · ' + p.slips.length + ' موظف · صافي ' + D.formatMoney(p.net) + ' ج.م · الكشف «' + p.status + '»', meta: '', tone: p.due.daysLeft <= 3 ? 'error' : 'warning', icon: 'wallet', run: openPayrollAlert }] : [];
    const st = vendorStatements().map((x) => ({ own: { role: 'الحسابات' }, key: 'vs:' + x.name, title: 'كشف حساب ' + x.name, sub: 'الرصيد ' + D.formatMoney(x.r.balance) + ' ج.م · ناجحة ' + x.r.success + ' · فاشلة ' + x.r.failed + ' · عربون ' + D.formatMoney(x.mo.deposits) + ' · مواصلات ' + D.formatMoney(x.mo.transport), meta: 'من ' + per.from.slice(8) + '/' + per.from.slice(5, 7) + ' لـ ' + per.to.slice(8) + '/' + per.to.slice(5, 7), tone: x.r.balance < 0 ? 'orange' : 'neutral', icon: 'truck', run: () => openVendorStatement(x.name) }));
    return { id: 'accounts', label: 'الحسابات', icon: 'wallet', unit: 'تنبيه', all: () => go('accounts'), allLabel: 'عرض الكل في الحسابات', empty: 'مفيش تنبيهات حسابات.',
      tabs: [['all', 'الكل', pay.concat(st)], ['payroll', 'المرتبات', pay], ['vendors', 'كشوف الموردين', st]] };
  }
  // ---------- custom task reports (owner 22 Oct): several alert sources grouped into one report for an employee / team ----------
  function digestSources() {
    return notifSections().flatMap((sec) => sec.tabs.filter((t) => t[0] !== 'all' || sec.tabs.length === 1).map((t) => ({ key: sec.id + '.' + t[0], section: sec.label, label: t[1], items: t[2] })));
  }
  function openDigest(d) {
    const O = window.IbtekrOps; const r = O.digest(digestSources(), d.keys); const flat = r.groups.flatMap((g) => g.items.map((it) => ({ g, it })));
    U.DetailsModal({ title: d.name, sub: 'تقرير مهام · ' + d.every + ' الساعة ' + d.at + ' · المستلم: ' + d.to.join(' + ') + ' · اضغط على أي مهمة تفتحها',
      summary: [{ label: 'إجمالي المهام', value: String(r.total) }].concat(r.groups.map((g) => ({ label: g.section + ' › ' + g.label, value: String(g.count) }))),
      headers: ['القسم', 'النوع', 'المهمة', 'التفاصيل'], rows: flat.map((x) => [x.g.section, x.g.label, x.it.title, x.it.sub || '']),
      onRow: (i) => flat[i].it.run && flat[i].it.run(), empty: 'مفيش مهام في التقرير ده دلوقتي — كله تمام.', source: 'نفس تنبيهات لوحة الإشعارات (لايف)' }, { label: d.name });
  }
  function digestSection() {
    const K = window.IBKit, O = window.IbtekrOps; if (!K || !K.store.digests) return []; const src = digestSources();
    const m = arguments[0] || viewer(); const NR = NRM(); const mine = (d) => !m || m.role === 'أدمن' || d.to.some((t) => t === m.name || (NR && NR.normRole(t) === NR.normRole(m.role)));
    const roleD = NR && m && K.store.roleDigests[m.role] !== false ? [{ id: 'RD-' + m.role, name: 'الملخص اليومي — ' + m.role, keys: NR.roleDigestKeys(K.store.alertRoles, sPerms(), roleIdx(m)), to: [m.role], every: 'يوميًا', at: ((K.store.notifPrefs || {})[m.id] || {}).digestAt || (K.store.roleDigestAt || {})[m.role] || '12:00 ص', on: true, auto: true }] : [];
    const items = roleD.concat(K.store.digests.filter((d) => d.on && mine(d))).map((d) => { const r = O.digest(src, d.keys); return { key: 'dg:' + d.id, title: d.name, sub: r.total + ' مهمة · ' + r.groups.filter((g) => g.count).map((g) => g.label + ' ' + g.count).join(' · '), meta: d.every + ' ' + d.at, tone: r.total ? 'warning' : 'neutral', icon: 'file', run: () => openDigest(d), n: r.total }; });
    return [{ id: 'digests', label: 'تقارير المهام', icon: 'file', unit: 'تقرير', all: () => { location.hash = 'settings-notifications'; }, allLabel: 'إدارة التقارير في الإعدادات', empty: 'مفيش تقارير مهام مفعّلة.', tabs: [['all', 'الكل', items]] }];
  }
  window.IBNotif = { sources: () => digestSources(), openDigest: (d) => openDigest(d), openVendorStatement, openVendorWeekly, vendorWeeklies, openVendorDaily, vendorDailies, waybills, openWaybill, openDeliveryDigest, openPayrollAlert };
  function notifSections(noDigest) {
    const a = alerts();
    const follow = a.follow.map((o) => orderItem(o, 'أوردر معلّق · محتاج متابعة', 'warning'));
    const unconf = a.unconfirmed.map((o) => orderItem(o, 'غير مؤكد · لسه ما اتأكدش من العميل', 'warning'));
    const waiting = a.waiting.map((o) => orderItem(o, 'في انتظار رد العميل', 'neutral'));
    // Owner (22 Oct): late orders also land under customers — the customer needs a follow-up call.
    const lateC = (a.lateOrders || []).map((o) => orderItem(o, 'أوردر متأخر · محتاج متابعة مع العميل · عمره ' + o.age + ' يوم', 'error'));
    const late = a.lateVendors.map((v) => ({ own: { role: 'متابعة الموردين' }, key: 'v:' + v.vendor, title: v.vendor, sub: v.count + ' أوردر متأخر عن مدة التصنيع', meta: '', tone: 'error', icon: 'truck', run: () => openVendorLate(v.vendor, 'late') }));
    const dy = vendorDailies().map((x) => ({ own: { role: 'متابعة الموردين' }, key: 'vd:' + x.name, title: 'المتابعة اليومية — ' + x.name, sub: 'متأخرة ' + x.r.late.length + ' · قابلة للتأخير ' + x.r.risk.length + ' · اتأكدت ' + x.r.confirmed.length, meta: 'يوميًا 10:00 ص', tone: x.r.late.length ? 'error' : x.r.risk.length ? 'orange' : 'neutral', icon: 'truck', run: () => openVendorDaily(x.name) }));
    const wk = vendorWeeklies().map((x) => ({ own: { role: 'متابعة الموردين' }, key: 'vw:' + x.name, title: 'التقرير الأسبوعي — ' + x.name, sub: 'متأخرة ' + x.r.late.length + ' · قيد التنفيذ ' + x.r.progress.length + ' · مكتملة ' + x.r.completed.length + ' · الحساب الفعلي ' + D.formatMoney(x.r.net) + ' ج.م', meta: 'كل ' + weeklyCfg().weekday, tone: x.r.late.length ? 'error' : 'neutral', icon: 'file', run: () => openVendorWeekly(x.name) }));
    const risk = a.riskVendors.map((v) => ({ own: { role: 'متابعة الموردين' }, key: 'r:' + v.vendor, title: v.vendor, sub: v.count + ' أوردر قابل للتأخير (9–11 يوم)', meta: '', tone: 'orange', icon: 'clockc', run: () => openVendorLate(v.vendor, 'risk') }));
    const tasks = ticketTasks().map((t) => ({ own: { role: t.role }, key: 't:' + t.id, title: t.id + ' — ' + t.title, sub: t.sub, meta: '', tone: t.prio === 'urgent' || t.prio === 'high' ? 'error' : 'neutral', icon: 'ticket', prio: t.prio, run: () => { showTickets(); openTicket(t.id); } }))
      .concat(vendorTasks().map((v) => ({ own: { role: 'متابعة الموردين' }, key: 'c:' + v.id, title: v.name, sub: v.sub, meta: '', tone: v.prio === 'urgent' ? 'error' : 'warning', icon: 'users', prio: v.prio, run: () => { if (state.page !== 'vendors') go('vendors'); openVendor(v.id); } })));
    const P = ['urgent', 'high', 'normal', 'low'];
    return [
      { id: 'customers', label: 'عملاء', icon: 'users', unit: 'تنبيه', all: () => showOrders({ st: 'معلّق' }), allLabel: 'عرض الكل في الأوردرات', empty: 'كله تمام مع العملاء.',
        tabs: [['all', 'الكل', lateC.concat(follow, unconf, waiting)], ['late', 'متأخرة — محتاج متابعة', lateC], ['follow', 'متابعة', follow], ['unconf', 'غير مؤكد', unconf], ['waiting', 'في انتظار الرد', waiting]] },
      { id: 'vendors', label: 'الموردين', icon: 'truck', unit: 'تنبيه', all: () => showOrders({ deliv: 'late' }), allLabel: 'عرض الكل في الأوردرات', empty: 'مفيش موردين متأخرين.',
        tabs: [['all', 'الكل', late.concat(risk, dy, wk)], ['late', 'متأخر', late], ['risk', 'قابل للتأخير', risk], ['daily', 'المتابعة اليومية', dy], ['weekly', 'التقرير الأسبوعي', wk]] },
      accountsSection(), deliverySection(),
      { id: 'tasks', label: 'مهام', icon: 'checkCircle', unit: 'مهمة', all: () => showTickets(), allLabel: 'عرض الكل في تذاكر الفريق', empty: 'مفيش مهام مستنياك.',
        tabs: [['all', 'الكل', tasks.slice().sort((x, y) => P.indexOf(x.prio) - P.indexOf(y.prio))]].concat(P.map((p) => [p, U.PRIORITY[p], tasks.filter((t) => t.prio === p)])) },
    ].concat(csSection(), opsSections());
  }
  // HR + inventory notifications (Figma: notifications sample 380:6178) — team requests, overtime to confirm, meetings, stock alerts
  // customer service inbox group «رسايل» (Figma 27 · Notifications panel nav after «مهام»)

  // ---------- alerts by role (owner 22 Oct): the bell shows what the viewer's role receives (R), what it may only see (S, muted), nothing else ----------
  const NRM = () => window.IbtekrNotifRoles;
  const sPerms = () => { const st = window.IBPages.all().settings; return st && st.api && st.api.perms ? st.api.perms() : []; };
  function viewer() { const K = window.IBKit; return K ? K.member(ntfState.viewer || K.ME) : null; }
  function roleIdx(m) { const st = window.IBPages.all().settings; if (st && st.api && st.api.roleIndex) return st.api.roleIndex(m && m.role); const i = NRM().ROLES.indexOf(m && m.role); return i < 0 ? NRM().ROLES.length - 1 : i; }
  function accFor(m) {
    const K = window.IBKit, NR = NRM(); const perms = sPerms(); const ci = roleIdx(m); const ov = (K.store.alertOverrides || {})[m.id] || {}; const mute = ((K.store.notifPrefs || {})[m.id] || {}).mute || [];
    return (k) => { let c = NR.access(K.store.alertRoles, perms, k, ci, ov[k]); if (c === 'R' && mute.includes(k)) c = 'S'; return c; };
  }
  function viewSections(noDigest) {
    const raw = notifSections(); const m = viewer(); const NR = NRM();
    let secs = NR && m ? NR.filterSections(raw, accFor(m), {}) : raw.map((s) => Object.assign({}, s, { received: s.tabs[0][2].length }));
    // server alerts (IBAlerts, already filtered by RLS) first, after the role filter; only for the signed-in member, never «عرض تنبيهات» another one
    if (window.IBAlerts && (ntfState.viewer || window.IBKit.ME) === window.IBKit.ME) { const s = window.IBAlerts.section(); if (s) secs = [s].concat(secs); }
    if (!noDigest) secs = secs.concat(digestSection(m)); return secs;
  }
  window.IBNotifRoles = { viewSections, accFor, roleIdx, viewer, setViewer: (id) => { ntfState.viewer = id; } };
  function csSection() { const cs = window.IBPages.all().cs; return cs && cs.api ? [cs.api.notifSection({ go })] : []; }
  function opsSections() {
    const K = window.IBKit, O = window.IbtekrOps; if (!K) return []; const S = K.store; const goHash = (hs) => () => { location.hash = hs; };
    const HRA = window.IBPages.all().hr.api; const reqs = S.requests.filter(HRA.isPending).map((r) => ({ own: { manager: K.member(r.member).manager }, key: 'rq:' + r.id, title: r.type + ' — ' + K.member(r.member).name, sub: HRA.reqPeriod(r), meta: r.at, tone: 'warning', icon: 'briefcase', run: goHash('profile-requests') }));
    const ot = S.overtime.filter((o) => o.status === 'مستني').map((o) => ({ own: { manager: K.member(o.member).manager }, key: 'ot:' + o.id, title: 'وقت إضافي ' + K.hrs(o.minutes) + ' — ' + K.member(o.member).name, sub: o.note + (o.waitedHours >= 24 ? ' · اتصعّد للأدمن' : ' · ضيفه أو متضيفهوش'), meta: K.dshort(o.date), tone: o.waitedHours >= 24 ? 'error' : 'warning', icon: 'clock', run: goHash('hr-requests') }));
    const meet = S.meetings.filter((x) => x.status === 'مطلوب' || x.status === 'اتحدد ميعاد').map((x) => ({ own: { manager: K.member(x.member).manager }, key: 'mt:' + x.id, title: 'ميتنج 1:1 — ' + K.member(x.member).name, sub: x.reason, meta: x.date ? K.dshort(x.date) + ' ' + x.time : 'لسه متحددش', tone: 'neutral', icon: 'cal', run: goHash('hr-payroll') }));
    const stock = K.stockNow(); const age = (s) => K.daysBetween(s.since, K.TODAY);
    const cons = S.consolidations.filter((c) => O.consolidationLate(K.daysBetween(c.since, K.TODAY)) && !O.consolidation(c.subs.map((x) => x[2])).ready).map((c) => ({ own: { role: 'عمليات' }, key: 'cn:' + c.order, title: 'تجميع IB-' + c.order + ' عدّى ' + K.daysBetween(c.since, K.TODAY) + ' أيام', sub: O.consolidation(c.subs.map((x) => x[2])).arrived + ' من ' + c.subs.length + ' وصلوا', meta: '', tone: 'error', icon: 'truck', run: goHash('inventory-consolidate') }));
    const photo = stock.filter((s) => s.reason === 'تصوير' && O.photoOverdue(age(s))).map((s) => ({ own: { role: 'عمليات' }, key: 'ph:' + s.sku, title: s.name + ' في التصوير بقاله ' + age(s) + ' يوم', sub: 'قاعدة أكتر من اللازم — يرجع للمبتكر أو يتحوّل للبيع', meta: '', tone: 'warning', icon: 'box', run: goHash('inventory-now') }));
    const pulls = S.notices.filter((n) => n.link === '#inventory-now').map((n, i) => ({ own: { role: 'عمليات' }, key: 'np:' + i, title: n.title, sub: 'سحب تلقائي من «متاح للبيع»', meta: n.at, tone: 'neutral', icon: 'tag', run: goHash('inventory-now') }));
    const insp = stock.filter((s) => s.status === 'بانتظار الفحص').map((s) => ({ own: { role: 'عمليات' }, key: 'in:' + s.sku, title: 'مرتجع بانتظار الفحص — ' + s.name, sub: s.ref || '', meta: '', tone: 'warning', icon: 'box', run: goHash('inventory-returns') }));
    return [
      { id: 'team', label: 'الفريق', icon: 'briefcase', unit: 'تنبيه', all: goHash('hr-requests'), allLabel: 'عرض الكل في الموارد البشرية', empty: 'مفيش طلبات مستنية.', tabs: [['all', 'الكل', ot.concat(reqs, meet)], ['ot', 'وقت إضافي', ot], ['req', 'طلبات', reqs], ['meet', 'ميتنجات', meet]] },
      { id: 'stock', label: 'المخزن', icon: 'tag', unit: 'تنبيه', all: goHash('inventory-now'), allLabel: 'عرض الكل في المخزن', empty: 'المخزن تمام.', tabs: [['all', 'الكل', cons.concat(photo, insp, pulls)], ['cons', 'تجميع', cons], ['photo', 'تصوير', photo], ['ret', 'مرتجعات', insp], ['pull', 'سحب تلقائي', pulls]] },
    ];
  }
  function showOrders(filter) {
    if (state.page !== 'orders') go('orders');
    window.OrdersApp.clear(); window.OrdersApp.apply(filter);
    const gq = document.getElementById('gq'); if (gq) gq.value = filter.q || '';
  }
  const ntfState = { section: 'customers', tab: 'all' };
  function NotificationsMenu() {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const badge = h('span', { class: 'notif-badge', hidden: true });
    const trig = h('button', { type: 'button', class: 'icon-btn notif-btn', 'aria-label': 'الإشعارات', title: 'الإشعارات', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, Icon('bell'), badge);
    const total = (secs) => secs.reduce((s, g) => s + (g.received != null ? g.received : g.tabs[0][2].length), 0);
    const refresh = () => { const n = total(viewSections(true)); badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = n === 0; trig.setAttribute('aria-label', n ? 'الإشعارات — ' + n + ' تنبيه' : 'الإشعارات'); };
    window.addEventListener('load', refresh); trig.addEventListener('ib:refresh', refresh);
    const pop = U.popover(wrap, trig, (close) => {
      const el = h('div', { class: 'menu notif', role: 'dialog', 'aria-label': 'الإشعارات', 'data-popover-root': '', 'data-focus': 'no' });
      const draw = () => {
        const secs = viewSections(); const sec = secs.find((s) => s.id === ntfState.section) || secs[0]; if (!sec) { el.replaceChildren(h('div', { class: 'ntf-main' }, U.EmptyState('مفيش تنبيهات لدورك', 'الأدمن يقدر يضيف تنبيهات لدورك من الإعدادات › التنبيهات حسب الدور'))); return; } if (!sec.tabs.some((t) => t[0] === ntfState.tab)) ntfState.tab = 'all';
        const K = window.IBKit; const me = K.member(K.ME); const vw = viewer();
        const tab = sec.tabs.find((t) => t[0] === ntfState.tab); const items = tab[2];
        const nav = h('nav', { class: 'ntf-nav', 'aria-label': 'أقسام الإشعارات' }, h('div', { class: 't-h5' }, 'الإشعارات'),
                    secs.map((s) => { const n = s.received != null ? s.received : s.tabs[0][2].length; return h('button', { type: 'button', class: 'ntf-nav-item', 'aria-current': String(s.id === sec.id), onClick: () => { ntfState.section = s.id; ntfState.tab = 'all'; draw(); } }, Icon(s.icon, 'sm'), h('span', { class: 'lbl' }, s.label), h('span', { class: 'cnt' + (n ? '' : ' zero') }, num(String(n)))); }),
          h('div', { class: 'foot' }, 'الأرقام بتتحدّث تلقائيًا من الأوردرات والتذاكر والعقود.'));
        const tabs = U.Tabs({ items: sec.tabs.map((t) => ({ id: t[0], label: t[1] + ' (' + t[2].length + ')' })), active: ntfState.tab, onChange: (id, viaKey) => { ntfState.tab = id; draw(); if (viaKey) { const b = el.querySelector('.tab[aria-selected=true]'); if (b) b.focus(); } } });
        tabs.setAttribute('aria-label', 'تابات ' + sec.label);
        const list = h('div', { class: 'ntf-list', role: 'list' }, items.length ? items.map((it) => h('button', { type: 'button', class: 'ntf-item' + (it.muted ? ' muted' : ''), role: 'listitem', onClick: () => { close(); it.run(); } },
          h('span', { class: 'av ' + it.tone, 'aria-hidden': 'true' }, Icon(it.icon, 'sm')), h('span', { class: 'txt' }, h('b', null, it.title, it.muted ? h('span', { class: 'ntf-fyi' }, 'للعلم') : null), h('small', null, it.sub)), it.meta ? h('span', { class: 'meta' }, it.meta) : null, h('span', { class: 'ext', 'aria-hidden': 'true' }, Icon('external', 'sm'))))
          : h('div', { class: 'ntf-empty' }, U.EmptyState('كله تمام هنا', sec.empty)));
        list.addEventListener('keydown', (e) => { const its = [...list.querySelectorAll('.ntf-item')]; const i = its.indexOf(document.activeElement); if (!its.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); its[(i + 1) % its.length].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); } });
        const main = h('div', { class: 'ntf-main' },
          (me.role === 'أدمن' ? h('div', { class: 'ntf-viewer' }, U.Select({ id: 'ntf-viewer', label: 'عرض تنبيهات', options: K.store.members.filter((x) => x.status !== 'invited').map((x) => ({ value: x.id, label: x.name + ' — ' + x.role })), value: vw.id, onChange: (v) => { ntfState.viewer = v; ntfState.section = 'customers'; ntfState.tab = 'all'; draw(); refresh(); } })) : null),
          h('div', { class: 'ntf-head' }, h('h3', { class: 't-h5' }, sec.label), h('span', { class: 'cnt' }, num(String(sec.received != null ? sec.received : sec.tabs[0][2].length)), ' ' + sec.unit, sec.received != null && sec.tabs[0][2].length > sec.received ? h('span', { class: 'fyi-c' }, ' · ', num(String(sec.tabs[0][2].length - sec.received)), ' للعلم') : null), h('span', { class: 'sp' }), Button({ type: 'text', size: 'sm', label: sec.allLabel, onClick: () => { close(); sec.all(); } })),
          tabs, list,
          h('div', { class: 'ntf-foot' }, h('span', null, '↑↓ للتنقل · Enter يفتح · Esc يقفل'), Button({ type: 'text', size: 'sm', label: 'تعليم القسم كمقروء', onClick: () => { ntfState.read = (ntfState.read || {}); items.forEach((it) => { ntfState.read[it.key] = true; }); } })));
        el.replaceChildren(main, nav);
      };
      draw(); setTimeout(() => { const f = el.querySelector('.ntf-nav-item[aria-current=true]'); if (f) f.focus(); }, 0);
      return el;
    });
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }

  // ---------- vendor late / at-risk orders popup — Figma: Modal / Vendor late orders 259:390 ----------
  function openVendorLate(vendor, kind) {
    const v = vstore.findByName ? vstore.findByName(vendor) : null;
    // kind: 'risk' | 'late' | 'all' (both — owner 22 Oct, from the «قابلة للتأخير / متأخرة» details rows); aliases too
    const seen = new Set(); const rows = [];
    for (const n of [vendor].concat(v ? [v.name].concat(v.aliases || []) : [])) for (const r of (OA().lateOrders ? OA().lateOrders(n, kind) : [])) { const k = r.id + '|' + r.sid; if (!seen.has(k)) { seen.add(k); rows.push(r); } }
    rows.sort((a, b) => (a.state === b.state ? 0 : a.state === 'late' ? -1 : 1) || b.age - a.age);
    const lateN = rows.filter((r) => r.state === 'late').length, riskN = rows.length - lateN;
    const oldest = rows.length ? Math.max(...rows.map((r) => r.age)) : 0;
    const title = (kind === 'all' ? 'أوردرات متأخرة وقابلة للتأخير — ' : kind === 'risk' ? 'أوردرات قابلة للتأخير — ' : 'أوردرات متأخرة — ') + vendor;
    let m = null;
    const table = h('table', { class: 'vlo-table' },
      h('thead', null, h('tr', null, ['رقم الأوردر'].concat(kind === 'all' ? ['التأخير'] : [], ['العميل', 'المنتج · SKU']).concat([ 'حالة الفرعي', 'تاريخ تبليغ المورد', 'عمر الأوردر']).map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { 'data-l': 'رقم الأوردر' }, h('button', { type: 'button', class: 'vlo-link', onClick: () => { m.close(); OA().details(r.id, r.sid ? 'subs' : 'info'); } }, 'IB-' + r.id, Icon('external', 'sm'))),
        kind === 'all' ? h('td', { 'data-l': 'التأخير' }, U.DelayBadge(r.state)) : null,
        h('td', { 'data-l': 'العميل' }, r.name),
        h('td', { 'data-l': 'المنتج · SKU' }, h('div', { class: 'vlo-prod' }, h('span', { class: 'th' }, OA().thumb(r.sku) ? h('img', { src: OA().thumb(r.sku), alt: '' }) : Icon('box', 'sm')), h('span', { class: 'tx' }, h('span', null, r.prod + ' × ' + r.qty), h('small', null, r.sku || '—')))),
        h('td', { 'data-l': 'حالة الفرعي' }, r.ss || '— اختر الحالة —'),
        h('td', { 'data-l': 'تاريخ تبليغ المورد' }, r.exp ? D.formatDateNumeric(r.exp) : 'أضف تاريخ الإبلاغ'),
        h('td', { 'data-l': 'عمر الأوردر' }, r.age + ' يوم')))));
    const sub = h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, String(rows.length) + (kind === 'all' ? ' أوردر — ' + lateN + ' متأخر · ' + riskN + ' قابل للتأخير' : kind === 'risk' ? ' أوردر قابل للتأخير' : ' أوردر متأخر') + (oldest ? ' · أقدمها ' + oldest + ' يوم' : '') + (v && v.phone ? ' · الموبايل ' + v.phone : '') + ' · «مشاركة» بتبعت البوب أب كصورة على واتساب أو إيميل');
    const shareWrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'position:relative' });
    const shareBtn = Button({ type: 'primary', label: 'مشاركة', onClick: () => sharePop.toggle() }); shareBtn.setAttribute('aria-haspopup', 'menu');
    const sharePop = U.popover(shareWrap, shareBtn, (close) => { const menu = h('div', { class: 'menu', role: 'menu', style: 'top:auto;bottom:calc(100% + 4px)' },
      h('button', { type: 'button', class: 'opt', role: 'menuitem', onClick: () => { close(); shareImage('whatsapp'); } }, Icon('whatsapp', 'sm'), 'واتساب'),
      h('button', { type: 'button', class: 'opt', role: 'menuitem', onClick: () => { close(); shareImage('email'); } }, Icon('mail', 'sm'), 'إيميل')); return menu; });
    shareWrap.append(shareBtn);
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, sub, h('div', { style: 'overflow-x:auto' }, table));
    m = U.Modal({ title, body, footer: [shareWrap, Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })] });
    m.el.classList.add('wide'); m.el.dataset.share = '1';
    async function shareImage(via) {
      const text = title + ' — ' + rows.map((r) => 'IB-' + r.id + ' (' + r.age + ' يوم)').join('، ');
      const phone = v && v.phone ? '20' + String(v.phone).replace(/^0/, '') : '';
      const href = via === 'whatsapp' ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : 'mailto:' + (v && v.email ? v.email : '') + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text);
      let note = '';
      try {
        if (!window.html2canvas) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/vendor/html2canvas.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
        const canvas = await window.html2canvas(m.el.querySelector('.modal-b'), { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 });
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); note = 'الصورة اتنسخت — الصقها في الرسالة.'; }
        catch (e) { const url = URL.createObjectURL(blob); const im = U.Modal({ title: 'صورة البوب أب', body: [h('p', { class: 't-small' }, 'المتصفح ما سمحش بنسخ الصورة تلقائي — اضغط عليها بزر الماوس اليمين وانسخها أو احفظها.'), h('img', { class: 'share-img', src: url, alt: title })], footer: [Button({ type: 'primary', label: 'تمام', onClick: () => im.close() })] }); note = 'الصورة جاهزة في النافذة.'; }
      } catch (e) { note = 'ما قدرتش أعمل الصورة — اتبعت النص بس.'; }
      log.append({ action: 'vendor.notify', actor: ACTOR, newValue: vendor + ' · ' + (via === 'whatsapp' ? 'واتساب' : 'إيميل') + ' · ' + rows.length + ' أوردر' });
      const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      vnotify('success', 'اتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + ' للمورد. ' + note);
    }
  }

  // ---------- AI assistant (header button + panel). Parsing is pure (commands.js); every write is confirmed, validated and goes through the adapter. ----------
  const C = window.IbtekrCommands;
  const AI_ACTOR = 'AI (بأمر ' + ACTOR + ')';
  const AI_EXAMPLES = ['افتح حسابات الموردين', 'اعرض الأوردرات المتأخرة', 'سجل سحب مرتبات 5000', 'رتب الموردين بالعربون'];
  const AI_HELP = 'مش فاهم الأمر ده. أقدر أفتح صفحة، أفلتر الأوردرات، أغيّر الفترة، أرتّب الموردين، أو أسجّل حركة مصروفات / مورد / حساب. جرّب واحد من الأمثلة.';
  const ai = { msgs: [{ role: 'ai', text: 'أهلاً يا صفوت. اكتب الأمر وأنا أنفذه. أي تسجيل بيتأكد منك الأول.' }], pending: null, busy: false, turns: [] };
  let aiPanel = null, aiBtn = null, aiList = null, aiInput = null;
  const aiCtx = () => {
    const names = SEED.vendors.map((v) => v.name); const seen = new Set(names.map((n) => n.toLowerCase()));
    const orders = (window.OrdersApp && window.OrdersApp.vendors) ? window.OrdersApp.vendors() : [];
    return { vendors: names.concat(orders.filter((n) => !seen.has(n.toLowerCase()))), today: TODAY };
  };
  const AI_ASK = { amount: 'المبلغ كام؟', category: 'النوع إيه؟ (المرتبات، المصروفات، الاشتراكات، الإعلانات)', vendor: 'أنهي مورد؟' };
  const KIND_OF = { addExpense: 'expenses', addVendorMove: 'vendorMoves', addAccountMove: 'accountMoves' };
  const TAB_OF = { expenses: 'expenses', vendorMoves: 'vendors', accountMoves: 'actual' };
  function aiSay(text) { ai.msgs.push({ role: 'ai', text }); aiDraw(); }
  function aiSummary(cmd) {
    const dirWord = cmd.direction === 'deposit' ? 'إيداع' : 'سحب';
    const rows = [['العملية', dirWord + (cmd.type === 'addExpense' ? ' مصروفات' : cmd.type === 'addVendorMove' ? ' للمورد' : ' في حساب')], ['المبلغ (ج.م)', num(D.formatMoney(Number(cmd.amount)))]];
    if (cmd.type === 'addExpense') { rows.push(['النوع', cmd.category]); if (cmd.beneficiary) rows.push(['المستفيد', cmd.beneficiary === D.OTHER ? cmd.otherName : cmd.beneficiary]); }
    if (cmd.type === 'addVendorMove') rows.push(['المورد', cmd.vendor], ['النوع', cmd.vendorType]);
    if (cmd.type === 'addAccountMove') rows.push(['نوع الحساب', cmd.account]);
    rows.push(['التاريخ', ['اليوم — ', num(D.formatDateNumeric(TODAY))]]);
    return rows;
  }
  function aiBuild(cmd) {
    const kind = KIND_OF[cmd.type]; const date = D.formatDateNumeric(TODAY);
    let res;
    if (kind === 'expenses') res = D.validateExpense({ amount: cmd.amount, date, direction: cmd.direction, category: cmd.category, beneficiary: cmd.beneficiary, otherName: cmd.otherName });
    else if (kind === 'vendorMoves') res = D.validateVendorMovement({ amount: cmd.amount, date, direction: cmd.direction, type: cmd.vendorType, vendor: cmd.vendor, otherName: '' });
    else res = D.validateAccountMovement({ amount: cmd.amount, date, direction: cmd.direction, account: cmd.account });
    if (Object.keys(res.errors).length) return { error: Object.values(res.errors)[0] };
    if (kind === 'accountMoves') { const chk = D.deriveAccounts(SEED.accounts, [...store.accountMoves, { ...res.value }]); if (!chk.ok) return { error: 'الرصيد مش كفاية في ' + chk.account + ' — العملية دي هتخليه بالسالب.' }; }
    return { kind, res };
  }
  function aiCommit(msg) {
    msg.done = true;
    const b = aiBuild(msg.confirm);
    if (b.error) { aiSay('ما قدرتش أسجّل: ' + b.error); return; }
    adapter.add(b.kind, b.res.value, AI_ACTOR);
    state.tab = TAB_OF[b.kind]; setNote({ kind: 'success', text: 'اتسجّلت الحركة بواسطة AI.' }); go('accounts');
    aiSay('اتسجّلت وفتحتلك التاب. ' + (b.kind === 'expenses' && !inRange(b.res.value.date) ? 'التاريخ خارج الفترة المعروضة — غيّر الفترة عشان تشوفها. ' : '') + 'الحركة متسجلة في سجل الأحداث باسم AI بأمرك.');
    if (aiSample) ai.turns.push({ role: 'user', content: '[النظام: المستخدم أكّد وتم تسجيل الحركة الأخيرة.]' }, { role: 'assistant', content: 'تمام، اتسجّلت.' });
  }
  function aiExec(cmd) {
    switch (cmd.type) {
      case 'navigate': if (cmd.tab) state.tab = cmd.tab; go(cmd.page); aiSay(cmd.page === 'orders' ? 'فتحت الأوردرات.' : 'فتحت تاب ' + TABS.find((t) => t.id === state.tab).label + '.'); return;
      case 'ordersFilter': {
        if (state.page !== 'orders') go('orders'); window.OrdersApp.apply(cmd.filter);
        const gq = document.getElementById('gq'); if (gq && cmd.filter.q !== undefined) gq.value = cmd.filter.q;
        aiSay('فلترت الأوردرات: ' + Object.entries(cmd.filter).map(([k, v]) => ({ q: 'بحث', st: 'الحالة', deliv: 'التسليم', vendor: 'المورد' }[k]) + ' = ' + ({ late: 'متأخر', risk: 'قابل للتأخير', ok: 'غير متأخر' }[v] || v)).join('، ') + '.'); return;
      }
      case 'ordersClear': window.OrdersApp.clear(); { const gq = document.getElementById('gq'); if (gq) gq.value = ''; } aiSay('مسحت فلاتر الأوردرات.'); return;
      case 'setRange': { const r = cmd.range || D.presetRange(cmd.preset, TODAY); state.range = { from: r.from, to: r.to, preset: cmd.preset || 'custom' }; if (state.page !== 'accounts') go('accounts'); else render(); aiSay('غيّرت ' + D.rangeLabel(r.from, r.to) + '.'); return; }
      case 'sortVendors': state.sort = cmd.sort; state.tab = 'vendors'; go('accounts'); aiSay('رتّبت الموردين: ' + SORTS.find((x) => x.value === cmd.sort).label + '.'); return;
      case 'addExpense': case 'addVendorMove': case 'addAccountMove':
        if (cmd.missing.length) { ai.pending = cmd; aiSay(AI_ASK[cmd.missing[0]]); return; }
        ai.msgs.push({ role: 'ai', text: 'هسجّل الحركة دي — راجعها وأكّد:', confirm: cmd }); aiDraw(); return;
      default: aiSay(AI_HELP);
    }
  }
  // ---- open conversation: Claude (viewer's account) drives the app through these page functions. Writes still need the viewer's confirm click. ----
  let aiSample = null, aiCtl = null, aiNoteEl = null, aiSendBtn = null, aiStopBtn = null;
  const FALLBACK_CODES = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable'];
  const aiRules = () => 'أنت "مساعد AI" جوه نظام إبتكر للأوبريشن (إبتكر كلوب — ماركت بليس هاند ميد). المستخدم صفوت كمال، المؤسس. اتكلم مصري مختصر ومباشر. النهارده ' + TODAY + '.\n'
    + 'تنفّذ طلبات المستخدم بالأدوات المتاحة: تفتح صفحات، تفلتر الأوردرات، تغيّر الفترة، ترتّب الموردين، وتجيب أرقام. لأي سؤال عن أرقام أو أوردرات استخدم get_summary أو get_orders ومتخترعش أرقام أبداً.\n'
    + 'التسجيل المالي (مصروفات / حركة مورد / حركة حساب) بيتم بأداة propose_entry بس. هي بتعرض كارت تأكيد للمستخدم وما بتسجّلش لوحدها، فمتقولش إن الحاجة اتسجّلت — قول إنك عرضت الكارت ومستني تأكيده. لو ناقص مبلغ أو نوع أو مورد اسأل الأول. التاريخ دايماً النهارده.\n'
    + 'قيم مسموحة. أنواع المصروفات: ' + D.CATEGORIES.join('، ') + '. أنواع الحساب: ' + D.ACCOUNTS.join('، ') + '. أنواع حركة المورد: ' + D.VENDOR_TYPES.join('، ') + '. حالات الأوردر: قيد الانتظار، جاري التنفيذ، جاهز للشحن، قيد الشحن، مكتمل، معلّق، استرجاع، ملغي، فشل. حالة التأكيد: مؤكد بعربون، مؤكد بدون عربون، غير مؤكد. التسليم: late = متأخر، risk = قابل للتأخير، ok = غير متأخر.\n'
    + 'إيداع للمورد = مدفوع للمورد (العربون يزيد والرصيد ينقص). متعرضش أرقام تليفونات العملاء. لو الطلب برة قدرات الأدوات قول كده بصراحة. رد قصير، من غير مقدمات.';
  function aiVendorName(n) { const l = String(n || '').trim().toLowerCase(); const hit = SEED.vendors.find((v) => v.name.toLowerCase() === l); return hit ? hit.name : ''; }
  const syncGq = (v) => { const gq = document.getElementById('gq'); if (gq) gq.value = v || ''; };
  function aiTools() {
    const OA = window.OrdersApp; const str = { type: 'string' };
    const ordFilter = { q: { ...str, description: 'بحث برقم الأوردر أو اسم العميل' }, st: str, conf: str, vendor: str, deliv: { type: 'string', enum: ['late', 'risk', 'ok'] } };
    const pick = (i) => { const f = {}; for (const k of ['q', 'st', 'conf', 'vendor', 'deliv']) if (i[k]) f[k] = String(i[k]); return f; };
    return [
      { name: 'navigate', description: 'افتح صفحة. page = orders أو accounts. لو accounts ممكن تحدد tab: expenses (المصروفات) / sales (المبيعات) / vendors (حسابات الموردين) / actual (الحساب الفعلي).', inputSchema: { type: 'object', properties: { page: { type: 'string', enum: ['orders', 'accounts'] }, tab: { type: 'string', enum: ['expenses', 'sales', 'vendors', 'actual'] } }, required: ['page'] },
        execute: (i) => { if (i.tab && TABS.some((t) => t.id === i.tab)) state.tab = i.tab; go(i.page === 'orders' ? 'orders' : 'accounts'); return 'opened ' + state.page + (state.page === 'accounts' ? '/' + state.tab : ''); } },
      { name: 'filter_orders', description: 'افتح الأوردرات وطبّق فلاتر على الشاشة (بتتجمع فوق الفلاتر الحالية إلا لو clear=true). بيرجّع عدد الأوردرات المطابقة.', inputSchema: { type: 'object', properties: { clear: { type: 'boolean' }, ...ordFilter } },
        execute: (i) => { if (state.page !== 'orders') go('orders'); if (i.clear) OA.clear(); const f = pick(i); if (f.vendor) { const hit = OA.vendors().find((v) => v.toLowerCase() === f.vendor.toLowerCase()); if (!hit) throw new Error('unknown vendor'); f.vendor = hit; } const n = OA.apply(f); syncGq(f.q !== undefined ? f.q : (i.clear ? '' : document.getElementById('gq') && document.getElementById('gq').value)); return { matching: n }; } },
      { name: 'get_orders', description: 'اقرا الأوردرات المطابقة للفلاتر من غير ما تغيّر الشاشة. بيرجّع total وتوزيع الحالات وحالات التسليم وأول limit أوردر (id, customer, status, confirm, ageDays, total, delivery, vendors).', inputSchema: { type: 'object', properties: { ...ordFilter, limit: { type: 'number' } } },
        execute: (i) => OA.query(pick(i), Math.min(Number(i.limit) || 10, 20)) },
      { name: 'set_period', description: 'غيّر الفترة في صفحة الحسابات. إمّا preset (today, yesterday, todayYesterday, last7, last14, last28, last30, thisWeek, lastWeek, thisMonth, lastMonth) أو from و to بصيغة YYYY-MM-DD.', inputSchema: { type: 'object', properties: { preset: str, from: str, to: str } },
        execute: (i) => { let r; if (i.preset) { r = D.presetRange(String(i.preset), TODAY); if (!r) throw new Error('unknown preset'); } else if (/^\d{4}-\d{2}-\d{2}$/.test(i.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(i.to || '') && i.from <= i.to) r = { from: i.from, to: i.to }; else throw new Error('need preset or valid from<=to'); state.range = { from: r.from, to: r.to, preset: i.preset || 'custom' }; if (state.page !== 'accounts') go('accounts'); else render(); return D.rangeLabel(r.from, r.to); } },
      { name: 'sort_vendors', description: 'رتّب حسابات الموردين. sort = balance:desc | balance:asc | deposits:desc | deposits:asc.', inputSchema: { type: 'object', properties: { sort: { type: 'string', enum: SORTS.map((x) => x.value) } }, required: ['sort'] },
        execute: (i) => { if (!SORTS.some((x) => x.value === i.sort)) throw new Error('bad sort'); state.sort = i.sort; state.tab = 'vendors'; go('accounts'); return 'sorted ' + i.sort; } },
      { name: 'get_summary', description: 'اقرا أرقام النظام الحالية: الفترة المعروضة، المصروفات حسب النوع، أرصدة الحسابات، ملخص الموردين وأعلى 5 أرصدة، وأعداد الأوردرات والتنبيهات. استخدمها قبل أي إجابة فيها أرقام.', inputSchema: { type: 'object', properties: {} },
        execute: () => {
          const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, state.range.from, state.range.to); const accs = D.deriveAccounts(SEED.accounts, store.accountMoves).balances; const vs = vendorsNow(); const o = OA.query({}, 0); const al = OA.alerts();
          return { today: TODAY, page: state.page, tab: state.tab, period: D.rangeLabel(state.range.from, state.range.to), expenseTotal: tot.total, expensesByCategory: Object.fromEntries(D.CATEGORIES.map((c) => [c, tot.byCategory[c].amount])), accounts: accs, vendors: D.vendorSummary(vs), topVendorsByBalance: [...vs].sort((a, b) => b.balance - a.balance).slice(0, 5).map((v) => ({ name: v.name, balance: v.balance, deposits: v.deposits })), orders: { total: o.total, byStatus: o.byStatus, delivery: o.delivery }, alerts: { followUp: al.follow.length, unconfirmed: al.unconfirmed.length, lateVendors: al.lateVendors.length } };
        } },
      { name: 'propose_entry', description: 'جهّز حركة مالية وورّي المستخدم كارت تأكيد. ما بتسجّلش لوحدها — لازم المستخدم يضغط تأكيد. kind: expense (مصروفات: category مطلوب، beneficiary اسم مورد أو "آخر" + otherName) | vendor (حركة مورد: vendor و vendorType) | account (حركة حساب: account). direction: withdraw أو deposit. amount رقم موجب.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['expense', 'vendor', 'account'] }, direction: { type: 'string', enum: ['withdraw', 'deposit'] }, amount: { type: 'number' }, category: { type: 'string', enum: [...D.CATEGORIES] }, beneficiary: str, otherName: str, vendor: str, vendorType: { type: 'string', enum: [...D.VENDOR_TYPES] }, account: { type: 'string', enum: [...D.ACCOUNTS] } }, required: ['kind', 'direction', 'amount'] },
        execute: (i) => {
          const base = { direction: i.direction, amount: String(i.amount) };
          let cmd;
          if (i.kind === 'expense') { let ben = '', other = ''; if (i.beneficiary) { const v = aiVendorName(i.beneficiary); if (v) ben = v; else { ben = D.OTHER; other = String(i.otherName || i.beneficiary); } } cmd = { type: 'addExpense', ...base, category: i.category || '', beneficiary: ben, otherName: other }; }
          else if (i.kind === 'vendor') { const v = aiVendorName(i.vendor); if (!v) throw new Error('unknown vendor; known: ' + SEED.vendors.map((x) => x.name).join(', ')); cmd = { type: 'addVendorMove', ...base, vendor: v, vendorType: i.vendorType || 'عربون', otherName: '' }; }
          else cmd = { type: 'addAccountMove', ...base, account: i.account || '' };
          const b = aiBuild(cmd); if (b.error) throw new Error(b.error);
          ai.msgs.push({ role: 'ai', text: 'راجع الحركة دي وأكّد:', confirm: cmd }); aiDraw();
          return 'تم عرض كارت التأكيد للمستخدم. لسه ما اتسجّلتش — مستني ضغطة تأكيد منه.';
        } },
    ];
  }
  function aiBusy(b) { ai.busy = b; if (aiInput) aiInput.disabled = b; if (aiSendBtn) aiSendBtn.hidden = b; if (aiStopBtn) aiStopBtn.hidden = !b; if (!b && aiInput && aiPanel && !aiPanel.hidden) aiInput.focus(); }
  function aiModeNote() { if (aiNoteEl) aiNoteEl.textContent = aiSample ? 'محادثة مفتوحة مع Claude بحسابك. أي تسجيل بيطلب تأكيدك الأول.' : 'نموذج تجريبي: بيفهم صيغ أوامر محددة، مش محادثة حرة.'; }
  async function aiInitChat() {
    try { const s = window.claude && window.claude.use ? await window.claude.use('sample') : null; if (!s) return; const lim = await s.limits(); if (lim && lim.tools) { aiSample = s; aiModeNote(); } } catch (e) { /* stays on fixed commands */ }
  }
  async function aiChat(text) {
    ai.turns.push({ role: 'user', content: text }); ai.turns = ai.turns.slice(-12);
    const m = { role: 'ai', text: '', live: true }; ai.msgs.push(m); aiBusy(true); aiDraw();
    aiCtl = new AbortController();
    try {
      const r = await aiSample([{ role: 'user', content: aiRules() }, ...ai.turns], { tools: aiTools(), modelTier: 'quick', signal: aiCtl.signal, onText: ({ text: t }) => { m.text = t; aiDraw(); } });
      m.text = r.text; ai.turns.push({ role: 'assistant', content: r.text });
    } catch (e) {
      const code = e && e.code;
      if (code === 'cancelled') m.text = (e.text || '') || 'وقفت.';
      else if (FALLBACK_CODES.includes(code)) { aiSample = null; aiModeNote(); ai.msgs = ai.msgs.filter((x) => x !== m); aiSay('المحادثة المفتوحة مش متاحة دلوقتي، فهشتغل بالأوامر المحددة. ' + AI_HELP); ai.turns.pop(); aiBusy(false); aiCtl = null; return; }
      else if (code === 'rate_limited') m.text = (e.text ? e.text + '\n' : '') + 'الاستخدام كتير دلوقتي، جرّب بعد شوية.';
      else m.text = (e && e.text ? e.text + '\n' : '') + 'حصلت مشكلة في الاتصال، جرّب تاني.';
    } finally { m.live = false; ai.msgs = ai.msgs.filter((x) => x !== m); ai.msgs.push(m); aiBusy(false); aiCtl = null; aiDraw(); }
  }
  function aiRun(text) {
    const t = text.trim(); if (!t || ai.busy) return;
    ai.msgs.push({ role: 'user', text: t });
    if (aiSample) { aiChat(t); return; }
    if (ai.pending) {
      if (/^(الغي|إلغاء|الغاء|لا|cancel)/i.test(C.norm(t))) { ai.pending = null; aiSay('تمام، لغيت الأمر.'); return; }
      const filled = C.fillMissing(ai.pending, t, aiCtx());
      if (filled.missing.length < ai.pending.missing.length) { ai.pending = null; aiExec(filled); return; }
      const fresh = C.parseCommand(t, aiCtx());
      if (fresh.type !== 'unknown') { ai.pending = null; aiExec(fresh); return; }
      aiSay(AI_ASK[ai.pending.missing[0]]); return;
    }
    aiExec(C.parseCommand(t, aiCtx()));
  }
  function aiDraw() {
    if (!aiList) return;
    aiList.replaceChildren(...ai.msgs.map((m) => {
      const kids = [h('p', { class: 'ai-text' }, m.live && !m.text ? 'بفكّر…' : m.text)];
      if (m.confirm) {
        kids.push(h('dl', { class: 'kv' }, aiSummary(m.confirm).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
        kids.push(m.done ? h('p', { class: 'ai-done t-small' }, 'تمت المعالجة.') : h('div', { class: 'ai-actions' },
          Button({ type: 'primary', size: 'sm', label: 'تأكيد التسجيل', onClick: () => aiCommit(m) }), Button({ size: 'sm', label: 'إلغاء', onClick: () => { m.done = true; aiSay('تمام، ما سجّلتش حاجة.'); } })));
      }
      return h('div', { class: 'ai-msg ' + m.role }, kids);
    }));
    aiList.scrollTop = aiList.scrollHeight;
  }
  function aiToggle(open) {
    const show = open === undefined ? aiPanel.hidden : open;
    aiPanel.hidden = !show; aiBtn.setAttribute('aria-expanded', String(show));
    if (show) { aiDraw(); aiInput.focus(); } else aiBtn.focus();
  }
  function AiButton() {
    aiBtn = h('button', { type: 'button', class: 'ai-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'مساعد AI', title: 'مساعد AI — نفّذ أوامرك' }, Icon('sparkle', 'sm'), h('span', null, 'AI'));
    aiBtn.addEventListener('click', () => aiToggle());
    return aiBtn;
  }
  function AiPanel() {
    aiList = h('div', { class: 'ai-list', role: 'log', 'aria-live': 'polite' });
    aiInput = h('input', { class: 'ai-input', type: 'text', placeholder: 'اكتب أمرك… مثال: افتح الأوردرات', 'aria-label': 'أمر للمساعد', autocomplete: 'off', maxlength: '200' });
    aiSendBtn = h('button', { type: 'submit', class: 'icon-btn ai-send', 'aria-label': 'إرسال', title: 'إرسال' }, Icon('send'));
    aiStopBtn = Button({ size: 'sm', label: 'إيقاف', onClick: () => { if (aiCtl) aiCtl.abort(); } }); aiStopBtn.hidden = true;
    const form = h('form', { class: 'ai-form' }, aiInput, aiSendBtn, aiStopBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = aiInput.value; aiInput.value = ''; aiRun(v); aiInput.focus(); });
    aiPanel = h('section', { class: 'ai-panel', role: 'dialog', 'aria-label': 'مساعد AI' },
      h('div', { class: 'ai-head' }, Icon('sparkle'), h('h2', { class: 't-h5' }, 'مساعد AI'), h('span', { class: 'grow' }), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => aiToggle(false) })),
      aiList,
      h('div', { class: 'ai-chips' }, AI_EXAMPLES.map((x) => Button({ size: 'sm', label: x, onClick: () => aiRun(x) }))),
      form,
      (aiNoteEl = h('p', { class: 'ai-note t-small' }, 'نموذج تجريبي: بيفهم صيغ أوامر محددة، مش محادثة حرة.')));
    aiPanel.hidden = true;
    aiPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); aiToggle(false); } });
    return aiPanel;
  }

  // ---------- date range picker ----------
  function DateRangeField(target = 'accounts') {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'date-field', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'اختيار الفترة' }, Icon('cal', 'sm'), h('span', { class: 'range-label' }, target === 'dash' ? dashRangeLabel(rangeOf(target)) : D.rangeLabel(rangeOf(target).from, rangeOf(target).to)), Icon('chevD', 'sm'));
    const pop = U.popover(wrap, trig, (close) => RangePicker(close, target));
    trig.addEventListener('click', pop.toggle);
    wrap.append(trig); return wrap;
  }
  // dashboard: the preset name + what it is compared with (Figma «الفترة: النهارده · مقارنة بإمبارح»)
  const dashRangeLabel = (r) => { const p = PRESETS.find((x) => x[0] === r.preset); if (!p || r.preset === 'custom') return D.rangeLabel(r.from, r.to) + ' · مقارنة بالفترة اللي قبلها'; return 'الفترة: ' + p[1] + ' · ' + (r.preset === 'today' ? 'مقارنة بأمس' : 'مقارنة بالفترة اللي قبلها'); };
  const rangeOf = (target) => (target === 'reports' ? state.rrange : target === 'dash' ? state.drange : state.range);
  function RangePicker(close, target = 'accounts') {
    const TODAY = target === 'dash' ? dashToday() : TODAY_APP; // the dashboard's presets / calendar follow its real today (dashToday)
    const cur = rangeOf(target); const draft = { from: cur.from, to: cur.to, preset: cur.preset };
    let [y, m] = draft.from.split('-').map(Number); let picking = false, hover = null, err = '';
    const dp = h('div', { class: 'dp range', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'اختيار الفترة', 'data-popover-root': '', 'data-focus': 'no' });
    function pick(iso) {
      if (!picking) { draft.from = iso; draft.to = null; picking = true; } else { draft.to = iso; if (draft.to < draft.from) [draft.from, draft.to] = [draft.to, draft.from]; picking = false; hover = null; }
      draft.preset = 'custom'; err = ''; draw();
    }
    function typed(which, value) {
      const iso = D.parseDate(value); if (!iso) { err = 'اكتب التاريخ بالشكل يوم/شهر/سنة'; draw(); return; }
      draft[which] = iso; draft.preset = 'custom'; if (draft.from && draft.to && draft.from > draft.to) err = 'تاريخ البداية لازم يكون قبل النهاية'; else err = ''; draw();
    }
    function draw() {
      const next = U.shiftMonth(y, m, 1);
      const dateInput = (which, label) => { const i = h('input', { type: 'text', dir: 'ltr', value: draft[which] ? D.formatDateNumeric(draft[which]) : '', placeholder: 'dd/mm/yyyy', 'aria-label': label, 'aria-invalid': err ? 'true' : false }); i.addEventListener('change', () => typed(which, i.value)); return h('div', { class: 'input' + (err ? ' err' : '') }, i); };
      dp.replaceChildren(...[
        h('div', { class: 'dp-body' },
          h('div', { class: 'presets', role: 'radiogroup', 'aria-label': 'فترات جاهزة' },
            PRESETS.map(([k, label]) => h('button', { type: 'button', class: 'radio', role: 'radio', 'aria-checked': String(draft.preset === k), onClick: () => { if (k === 'custom') { draft.preset = 'custom'; } else { const r = D.presetRange(k, TODAY); draft.from = r.from; draft.to = r.to; draft.preset = k; [y, m] = r.from.split('-').map(Number); } picking = false; err = ''; draw(); } }, h('i'), label))),
          h('div', { class: 'cals' },
            U.Calendar({ year: y, month: m, today: TODAY, from: draft.from, to: draft.to, hover: picking ? hover : null, onPick: pick, onHover: (i) => { if (picking && hover !== i) { hover = i; draw(); } }, onNav: (d) => { ({ year: y, month: m } = U.shiftMonth(y, m, d)); draw(); }, showPrev: false }),
            U.Calendar({ year: next.year, month: next.month, today: TODAY, from: draft.from, to: draft.to, hover: picking ? hover : null, onPick: pick, onHover: (i) => { if (picking && hover !== i) { hover = i; draw(); } }, onNav: (d) => { ({ year: y, month: m } = U.shiftMonth(y, m, d)); draw(); }, showNext: false }))),
        h('div', { class: 'range-row' }, h('div', { class: 'input', style: 'width:180px' }, h('input', { type: 'text', readonly: true, value: (PRESETS.find((p) => p[0] === draft.preset) || [0, 'مخصص'])[1], 'aria-label': 'الفترة الجاهزة', dir: 'rtl' })),
          dateInput('from', 'من تاريخ'), h('span', null, '–'), dateInput('to', 'إلى تاريخ'),
          h('span', { class: 'check', title: 'غير متاح في النموذج' }, h('i'), 'مقارنة بفترة سابقة')),
        err ? h('div', { class: 'err-msg', role: 'alert', style: 'padding:0 16px 8px' }, err) : null,
        h('div', { class: 'dp-foot' }, h('span', { class: 'tz' }, 'التواريخ بتوقيت القاهرة (GMT+3)'),
          Button({ label: 'إلغاء', onClick: close }),
          Button({ type: 'primary', label: 'تحديث', disabled: !draft.from || !draft.to || !!err, onClick: () => { const nr = { from: draft.from, to: draft.to, preset: draft.preset }; if (target === 'reports') { state.rrange = nr; close(); renderReports(); } else if (target === 'dash') { state.drange = nr; close(); window.IBPages.render('dashboard'); } else { state.range = nr; close(); render(); } } }))].filter(Boolean));
    }
    draw(); return dp;
  }

  // ---------- movement forms (expense / vendor / account) ----------
  const CATEGORY_OPTS = D.CATEGORIES.map((c) => ({ value: c, label: c }));
  function openForm(kind, direction, existing, readOnly, preset) {
    const f = { amount: existing ? String(existing.amount) : '', date: existing ? existing.date : TODAY, direction, category: existing ? existing.category : '', beneficiary: '', otherName: '', type: existing ? existing.type : '', vendor: existing ? existing.vendor : '', account: existing ? existing.account : '' };
    if (existing && kind === 'expenses') { if (existing.beneficiaryIsOther) { f.beneficiary = D.OTHER; f.otherName = existing.beneficiaryName; } else f.beneficiary = existing.beneficiaryName; }
    if (existing && kind === 'vendorMoves' && existing.type === 'أخرى') f.otherName = existing.typeName;
    if (preset) Object.assign(f, preset);
    let errs = {}; let modal = null;
    const dirWord = direction === 'deposit' ? 'إيداع' : 'سحب';
    const titles = { expenses: dirWord + ' مصروفات', vendorMoves: direction === 'deposit' ? 'إيداع للمورد' : 'سحب من المورد', accountMoves: direction === 'deposit' ? 'إيداع في الحساب' : 'سحب من الحساب' };
    const title = readOnly ? 'تفاصيل الحركة' : (existing ? 'تعديل — ' : '') + titles[kind];
    const vendorOpts = SEED.vendors.map((v) => ({ value: v.name, label: v.name }));
    const benefOpts = [...vendorOpts, { value: D.OTHER, label: D.OTHER }];
    const typeOpts = D.VENDOR_TYPES.map((t) => ({ value: t, label: t }));
    const accOpts = D.ACCOUNTS.map((a) => ({ value: a, label: a }));

    function body() {
      if (readOnly) {
        const rows = [['التاريخ', num(D.formatDateNumeric(existing.date))], ['العملية', existing.direction === 'deposit' ? 'إيداع' : 'سحب'], ['المبلغ (ج.م)', num(D.formatMoney(existing.amount))]];
        if (kind === 'expenses') rows.push(['النوع', existing.category], ['اسم المستفيد', existing.beneficiaryName || '—']);
        if (kind === 'accountMoves') rows.push(['نوع الحساب', existing.account]);
        rows.push(['سُجّل بواسطة', existing.createdBy]);
        return [h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))];
      }
      const fields = [];
      if (kind === 'vendorMoves') fields.push(U.Select({ id: 'f-vendor', label: 'المورد', required: true, options: vendorOpts, value: f.vendor, error: errs.vendor, placeholder: 'اختار المورد', onChange: (v) => { f.vendor = v; redraw(); } }));
      if (kind === 'accountMoves') fields.push(U.Select({ id: 'f-account', label: 'نوع الحساب', required: true, options: accOpts, value: f.account, error: errs.account, placeholder: 'اختار نوع الحساب', onChange: (v) => { f.account = v; redraw(); } }));
      fields.push(U.TextInput({ id: 'f-amount', label: 'المبلغ', required: true, value: f.amount, error: errs.amount, placeholder: '0.00', inputmode: 'decimal', suffix: 'ج.م', onInput: (v) => { f.amount = v; } }));
      fields.push(U.DateField({ id: 'f-date', label: direction === 'deposit' ? 'تاريخ الإيداع' : 'تاريخ السحب', required: true, value: f.date, error: errs.date, today: TODAY, onChange: (iso, e) => { if (!e) f.date = iso; errs.date = e || undefined; redraw(); } }));
      if (kind === 'expenses') {
        fields.push(U.Select({ id: 'f-cat', label: 'النوع', required: true, options: CATEGORY_OPTS, value: f.category, error: errs.category, onChange: (v) => { f.category = v; redraw(); } }));
        fields.push(U.Select({ id: 'f-ben', label: 'المستفيد', options: benefOpts, value: f.beneficiary, error: errs.beneficiary, placeholder: 'اختار المستفيد', onChange: (v) => { f.beneficiary = v; if (v !== D.OTHER) f.otherName = ''; redraw(); } }));
        if (f.beneficiary === D.OTHER) fields.push(U.TextInput({ id: 'f-other', label: 'اسم المستفيد', required: true, value: f.otherName, error: errs.otherName, placeholder: 'اكتب الاسم', maxlength: 80, onInput: (v) => { f.otherName = v; } }));
      }
      if (kind === 'vendorMoves') {
        fields.push(U.Select({ id: 'f-type', label: 'النوع', required: true, options: typeOpts, value: f.type, error: errs.type, onChange: (v) => { f.type = v; if (v !== 'أخرى') f.otherName = ''; redraw(); } }));
        if (f.type === 'أخرى') fields.push(U.TextInput({ id: 'f-other', label: 'اكتب النوع', required: true, value: f.otherName, error: errs.otherName, placeholder: 'اكتب النوع', maxlength: 80, onInput: (v) => { f.otherName = v; } }));
      }
      if (errs._form) fields.unshift(U.InlineNote({ kind: 'error', children: errs._form }));
      return fields;
    }
    function footer() {
      return readOnly ? [Button({ label: 'إغلاق', onClick: () => modal.close() })] : [Button({ label: 'إلغاء', onClick: () => modal.close() }), Button({ type: 'primary', label: 'حفظ', onClick: submit })];
    }
    function redraw() { modal.setBody(...body()); const bad = modal.el.querySelector('[aria-invalid=true]'); if (bad && Object.keys(errs).length) bad.focus(); }
    function submit() {
      errs = {};
      const raw = { ...f, date: f.date ? D.formatDateNumeric(f.date) : '' };
      let res;
      if (kind === 'expenses') res = D.validateExpense(raw);
      else if (kind === 'vendorMoves') res = D.validateVendorMovement(raw);
      else res = D.validateAccountMovement(raw);
      if (Object.keys(res.errors).length) { errs = res.errors; redraw(); return; }
      if (kind === 'accountMoves') {
        const others = existing ? store.accountMoves.filter((r) => r.id !== existing.id) : store.accountMoves;
        const chk = D.deriveAccounts(SEED.accounts, [...others, { ...res.value }]);
        if (!chk.ok) { errs = { _form: 'الرصيد مش كفاية في ' + chk.account + ' — العملية دي هتخليه بالسالب.' }; redraw(); return; }
      }
      if (existing) adapter.update(kind, existing.id, res.value); else adapter.add(kind, res.value);
      setNote({ kind: 'success', text: existing ? 'اتحفظ التعديل.' : 'اتسجّلت الحركة.' + (kind === 'expenses' && !inRange(res.value.date) ? ' التاريخ خارج الفترة المعروضة، غيّر الفترة عشان تشوفها.' : '') });
      modal.close(); render();
    }
    modal = U.Modal({ title, body: [], footer: [] });
        modal.setBody(...body()); modal.setFooter(...footer());
    const first = modal.el.querySelector('input,.select'); if (first && !readOnly) first.focus();
  }

  // add-button with deposit/withdraw dropdown
  function AddMenu(label, kind) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'btn btn-brand', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, Icon('plus', 'sm'), label, Icon('chevD', 'sm'));
    const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', options: [{ value: 'withdraw', label: 'سحب' }, { value: 'deposit', label: 'إيداع' }], onSelect: (v) => { close(); openForm(kind, v); } }));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  function RowActions(kind, rec, onDelete) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إجراءات الصف', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, Icon('more'));
    const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: [{ value: 'view', label: 'عرض' }, { value: 'edit', label: 'تعديل' }, { value: 'del', label: 'حذف', danger: true }],
      onSelect: (v) => { close(); if (v === 'view') openForm(kind, rec.direction, rec, true); if (v === 'edit') openForm(kind, rec.direction, rec); if (v === 'del') onDelete(rec); } }));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  function deleteRec(kind, rec) {
    if (kind === 'accountMoves') { const rest = store.accountMoves.filter((r) => r.id !== rec.id); if (!D.deriveAccounts(SEED.accounts, rest).ok) { setNote({ kind: 'error', text: 'مش هينفع تحذف الحركة دي لأن رصيد حساب هيبقى بالسالب.' }); render(); return; } }
    adapter.remove(kind, rec.id); setNote({ kind: 'success', text: 'اتحذفت الحركة.', undo: () => { adapter.restore(kind, rec); setNote({ kind: 'success', text: 'اترجّعت الحركة.' }); render(); } }); render();
  }

  // ---------- shared view pieces ----------
  const sourceNote = (t) => h('p', { class: 'source', style: 'margin:0' }, t);
  const pctTxt = (p) => num(p);
  function TableCard({ title, count, action, body }) {
    return h('section', { class: 'card table-card' }, h('div', { class: 'table-title' }, h('h2', { class: 't-h4' }, title), h('span', { class: 'count t-body' }, count || ''), action || null), body);
  }
  const notSeptNote = () => (seedKeysIn(state.range).includes('2026-09') ? null : U.InlineNote({ kind: 'warning', children: 'الأرقام دي تقرير سبتمبر 2026 — اختيار فترة تانية مش بيغيّرها.' }));

  // ---------- views ----------
  function ExpensesView() {
    const seedKeys = seedKeysIn(state.range);
    const entries = store.expenses.filter((e) => inRange(e.date)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, state.range.from, state.range.to);
    const full = monthOfRange(state.range);
    const monthTxt = full ? D.monthName(full.m) + ' ' + full.y : D.rangeLabel(state.range.from, state.range.to);
    const tones = { 'المرتبات': 'gold', 'المصروفات': 'neutral', 'الاشتراكات': 'goldlight', 'الإعلانات': 'brand' };
    const cells = ['M14', 'N14', 'O14', 'P14'];
    const srcFor = (c, i) => (seedKeys.length ? 'Monthly Performance!' + cells[i] + (entries.some((e) => e.category === c) ? ' + تسجيل يدوي' : '') : 'تسجيل يدوي');
    return [
      h('div', { class: 'card sum-card' }, h('div', null, h('div', { class: 'lab t-small' }, monthTxt), h('div', { class: 't-h5' }, full ? 'إجمالي مصروفات ' + D.monthName(full.m) : 'إجمالي المصروفات'),
          h('button', { type: 'button', class: 'kpi-more kpi-details', 'data-details': 'إجمالي المصروفات', 'aria-label': 'تفاصيل إجمالي المصروفات', onClick: () => U.DetailsModal(() => ({ title: 'إجمالي المصروفات — ' + D.formatMoney(tot.total) + ' ج.م', sub: monthTxt, summary: D.CATEGORIES.map((c) => ({ label: c, value: D.formatMoney(tot.byCategory[c].amount) })), headers: ['البند', 'القيمة', 'النسبة', 'المصدر'], rows: D.CATEGORIES.map((c, i) => [c, D.formatMoney(tot.byCategory[c].amount), D.formatPct(tot.byCategory[c].share), srcFor(c, i)]).concat(entries.map((e) => [e.category + ' · ' + D.formatDateNumeric(e.date), D.formatMoney(e.amount), '—', 'تسجيل يدوي — ' + (e.beneficiaryName || '—')])) }), { label: 'إجمالي المصروفات' }) }, 'التفاصيل', Icon('chevL', 'sm'))),
        h('div', { class: 'cat-val' }, h('span', { class: 'unit' }, 'ج.م'), h('span', { class: 't-h3' }, num(D.formatMoney(tot.total))))),
      h('div', { class: 'cards' }, D.CATEGORIES.map((c, i) => U.CategoryCard({ tone: tones[c], name: c, value: tot.byCategory[c].amount, pct: tot.byCategory[c].share, caption: 'من الإجمالي', details: () => { const l = entries.filter((e) => e.category === c); const manual = l.reduce((x, e) => x + (e.direction === 'deposit' ? -e.amount : e.amount), 0); const sheet = Math.round((tot.byCategory[c].amount - manual) * 100) / 100;
        return { title: c + ' — ' + D.formatMoney(tot.byCategory[c].amount) + ' ج.م', sub: monthTxt + ' · ' + D.formatPct(tot.byCategory[c].share) + ' من إجمالي المصروفات', summary: [{ label: 'الإجمالي', value: D.formatMoney(tot.byCategory[c].amount) + ' ج.م' }, { label: 'من الشيت', value: D.formatMoney(seedKeys.length ? sheet : 0) + ' ج.م' }, { label: 'تسجيل يدوي', value: l.length + ' حركة' }], headers: ['التاريخ', 'البيان', 'المستفيد', 'العملية', 'المبلغ'], rows: (seedKeys.length ? [['—', 'من شيت Monthly Performance!' + cells[i], '—', 'سحب', D.formatMoney(sheet)]] : []).concat(l.map((e) => [num(D.formatDateNumeric(e.date)), 'تسجيل يدوي', e.beneficiaryName || '—', e.direction === 'deposit' ? 'إيداع' : 'سحب', D.formatMoney(e.amount)])), total: ['الإجمالي', '', '', '', D.formatMoney(tot.byCategory[c].amount)], source: srcFor(c, i) }; } }))),
      TableCard({ title: 'تفاصيل المصروفات', body: U.Table({ headers: ['البند', 'القيمة (ج.م)', 'النسبة', 'المصدر'],
        rows: D.CATEGORIES.map((c, i) => [c, num(D.formatMoney(tot.byCategory[c].amount)), num(D.formatPct(tot.byCategory[c].share)), srcFor(c, i)]),
        totalRow: ['إجمالي الأربع فئات', num(D.formatMoney(tot.total)), num(tot.total === 0 ? '0.0%' : '100.0%'), 'إجمالي المصروفات'] }) }),
      TableCard({ title: 'سجل المصروفات التفصيلي', count: entries.length + ' مصروف مسجّل', body: entries.length === 0 ? U.EmptyState('لسه مفيش مصروفات مسجّلة', 'اضغط «إضافة مصروفات» وسجّل أول سحب أو إيداع، وهيظهر هنا.') :
        U.Table({ headers: ['التاريخ', 'النوع', 'اسم المستفيد', 'المبلغ (ج.م)', ''], rows: entries.map((e) => [num(D.formatDateNumeric(e.date)), e.category, e.beneficiaryName || '—',
          h('span', { class: e.direction === 'deposit' ? 'pos' : '' }, num((e.direction === 'deposit' ? '+' : '') + D.formatMoney(e.amount))), RowActions('expenses', e, (r) => deleteRec('expenses', r))]) }) }),
      sourceNote('المصدر: Vendors Orders mangment-Invoices ← Monthly Performance ← ' + (full ? full.y + '-' + String(full.m).padStart(2, '0') : 'الفترة المحددة')),
    ];
  }

  function SalesView() {
    const S = SEED.sales, T = SEED.salesTotal; const tones = ['brand', 'gold', 'neutral'];
    const salesDet = (k, r) => { const vs = vendorsNow().map((v) => ({ v, c: k ? v[k] : [v.c[0] + v.p[0] + v.x[0], v.c[1] + v.p[1] + v.x[1], v.c[2] + v.p[2] + v.x[2]] })).filter((x) => x.c[0] > 0 || x.c[1] > 0).sort((a, b) => b.c[1] - a.c[1]);
      return { title: (k ? 'مبيعات ' + r.label : 'إجمالي المبيعات') + ' — ' + D.formatMoney(r.sales) + ' ج.م', sub: 'سبتمبر 2026 · حسب المورد · العدد = أوردرات رئيسية مميزة لكل مورد وقد يتجاوز الإجمالي', summary: [{ label: 'الأوردرات', value: String(r.orders) }, { label: 'المبيعات', value: D.formatMoney(r.sales) + ' ج.م' }, { label: 'حصة إبتكر', value: D.formatMoney(r.share) + ' ج.م' }, { label: 'النسبة', value: r.pct }], headers: ['المورد', 'العمولة', 'الأوردرات', 'المبيعات', 'حصة إبتكر'], rows: vs.map((x) => [x.v.name, x.v.pct, String(x.c[0]), D.formatMoney(x.c[1]), D.formatMoney(x.c[2])]),
        total: (() => { const t = vs.reduce((a, x) => [a[0] + x.c[0], a[1] + x.c[1], a[2] + x.c[2]], [0, 0, 0]); return ['مجموع الموردين', '—', String(t[0]), D.formatMoney(t[1]), D.formatMoney(t[2])]; })(),
        note: (() => { const t = vs.reduce((a, x) => [a[0] + x.c[0], a[1] + x.c[1], a[2] + x.c[2]], [0, 0, 0]); const d = []; if (t[0] !== r.orders) d.push('عدد الأوردرات ' + t[0] + ' عند الموردين مقابل ' + r.orders + ' (الأوردر المشترك بيتحسب لكل مورد فيه)'); if (Math.abs(t[1] - r.sales) > 0.5) d.push('المبيعات ' + D.formatMoney(t[1]) + ' مقابل ' + D.formatMoney(r.sales)); if (Math.abs(t[2] - r.share) > 0.5) d.push('حصة إبتكر ' + D.formatMoney(t[2]) + ' في تاب حسابات الموردين مقابل ' + D.formatMoney(r.share) + ' في تاب المبيعات — فرق ' + D.formatMoney(Math.abs(t[2] - r.share)) + ' محتاج مراجعة في الشيت'); return d.length ? 'فرق بين الشيتين: ' + d.join(' · ') + '.' : 'مجموع الموردين مطابق لملخص المبيعات.'; })(),
        source: 'Ibtekr_Accounts_September_monthly_report ← تاب المبيعات + تاب حسابات الموردين' }; };
    return [notSeptNote(),
      h('div', { class: 'cards' }, [...S.map((r, i) => U.CategoryCard({ tone: tones[i], name: r.label, value: r.sales, pct: r.sales / T.sales, caption: 'من إجمالي المبيعات', details: () => salesDet(['c', 'p', 'x'][i], r) })), U.CategoryCard({ tone: 'goldlight', name: 'إجمالي المبيعات', value: T.sales, pct: 1, caption: 'من إجمالي المبيعات', details: () => salesDet(null, T) })]),
      TableCard({ title: 'تفاصيل المبيعات حسب حالة الأوردر', body: U.Table({ headers: ['حالة الأوردر', 'عدد الأوردرات', 'إجمالي المبيعات (ج.م)', 'حصة إبتكر (ج.م)', 'نسبة حصة إبتكر'],
        rows: S.map((r) => [r.label, num(String(r.orders)), num(D.formatMoney(r.sales)), num(D.formatMoney(r.share)), num(r.pct)]),
        totalRow: ['الإجمالي', num(String(T.orders)), num(D.formatMoney(T.sales)), num(D.formatMoney(T.share)), num(T.pct)] }) }),
      sourceNote('المصدر: Ibtekr_Accounts_September_monthly_report ← تاب المبيعات ← سبتمبر 2026')].filter(Boolean);
  }

  function SortDropdown() {
    const sort = SORTS.find((x) => x.value === state.sort);
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'sort-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, Icon('chevD', 'sm'), h('span', null, sort.label), Icon('sliders', 'sm'));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: SORTS.map((x) => ({ value: x.value, label: x.label })), value: state.sort, onSelect: (v) => { close(); state.sort = v; render(); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function VendorsView() {
    const list = vendorsNow(); const s = D.vendorSummary(list); const sort = SORTS.find((x) => x.value === state.sort);
    const sorted = D.sortVendors(list, sort.key, sort.dir); const T = SEED.vendorTotals;
    const bal = (n) => h('span', { class: n > 0 ? 'pos' : n < 0 ? 'neg' : '' }, num(D.formatMoney(n)));
    const vOpenName = (l) => (i) => { const v = vstore.findByName(l[i].name); if (v) { go('vendors'); openVendor(v.id); } };
    const accVDet = (k) => { const l = k === 'pos' ? sorted.filter((v) => v.balance > 0) : k === 'neg' ? sorted.filter((v) => v.balance < 0) : k === 'dep' ? sorted.filter((v) => v.deposits > 0) : sorted;
      const t = { all: 'الموردين — ' + s.count, pos: 'رصيد الموردين — ' + D.formatMoney(s.positive) + ' ج.م', neg: 'رصيد عند الموردين — ' + D.formatMoney(s.negative) + ' ج.م', dep: 'العرابين — ' + D.formatMoney(s.deposits) + ' ج.م' }[k];
      return { title: t, sub: 'سبتمبر 2026 · اضغط على أي مورد يفتح ملفه', summary: [{ label: 'موردين', value: String(l.length) }, { label: 'الرصيد', value: D.formatMoney(l.reduce((x, v) => x + v.balance, 0)) + ' ج.م' }, { label: 'العرابين', value: D.formatMoney(l.reduce((x, v) => x + v.deposits, 0)) + ' ج.م' }], headers: ['المورد', 'النسبة', 'مكتمل', 'قيد التنفيذ', 'ملغي', 'العرابين', 'الرصيد'], rows: l.map((v) => [v.name, v.pct, String(v.c[0]), String(v.p[0]), String(v.x[0]), D.formatMoney(v.deposits), D.formatMoney(v.balance)]), total: ['الإجمالي', '—', String(l.reduce((x, v) => x + v.c[0], 0)), String(l.reduce((x, v) => x + v.p[0], 0)), String(l.reduce((x, v) => x + v.x[0], 0)), D.formatMoney(l.reduce((x, v) => x + v.deposits, 0)), D.formatMoney(l.reduce((x, v) => x + v.balance, 0))], onRow: vOpenName(l), source: 'تاب حسابات الموردين ← سبتمبر 2026' }; };
    const tA = trAll(); const trOf = (n) => trVendor(n).total;
    return [notSeptNote(),
      h('div', { class: 'cards five' },
        U.CategoryCard({ tone: 'brand', name: 'عدد الموردين', value: s.count, unit: 'مورد', decimals: false, details: () => accVDet('all') }),
        U.CategoryCard({ tone: 'gold', name: 'رصيد الموردين', value: s.positive, sub: s.positiveCount + ' موردين', details: () => accVDet('pos') }),
        U.CategoryCard({ tone: 'neutral', name: 'رصيد عند الموردين', value: s.negative, sub: s.negativeCount + ' موردين', details: () => accVDet('neg') }),
        U.CategoryCard({ tone: 'goldlight', name: 'إجمالي العرابين', value: s.deposits, sub: h('span', null, 'صافي ', num(D.formatMoney(s.net))), details: () => accVDet('dep') }),
        U.CategoryCard({ tone: 'neutral', name: 'مواصلات الموردين', value: tA.vendors, sub: tA.vendorTrips + ' مشوار · ' + tA.vendorCount + ' موردين', details: () => transportDetails('') })),
      TableCard({ title: 'حسابات الموردين — سبتمبر 2026', body: U.Table({ cls: 'vendors-table',
        headers: ['المورد', 'نسبة إبتكر', 'مكتمل — عدد', 'مكتمل — حصة إبتكر', 'قيد التنفيذ — عدد', 'قيد التنفيذ — حصة إبتكر', 'ملغي — عدد', 'ملغي — حصة إبتكر', 'إجمالي العرابين', 'المواصلات', 'الرصيد الحالي'],
        rows: sorted.map((v) => [h('span', { class: 'vname-cell' }, h('span', { dir: 'auto' }, v.name), Button({ type: 'text', size: 'sm', icon: 'chart', label: 'تقرير', attrs: { 'aria-label': 'تقرير ' + v.name, 'data-vreport': v.name }, onClick: (e) => { e.stopPropagation(); openVendorReport(v.name); } })), num(v.pct), num(String(v.c[0])), num(D.formatMoney(v.c[2])), num(String(v.p[0])), num(D.formatMoney(v.p[2])), num(String(v.x[0])), num(D.formatMoney(v.x[2])), num(D.formatMoney(v.deposits)), num(D.formatMoney(trOf(v.name))), bal(v.balance)]),
        totalRow: ['الإجمالي', '—', num(String(T.c[0])), num(D.formatMoney(T.c[2])), num(String(T.p[0])), num(D.formatMoney(T.p[2])), num(String(T.x[0])), num(D.formatMoney(T.x[2])), num(D.formatMoney(s.deposits)), num(D.formatMoney(tA.vendors)), bal(s.net)] }) }),
      sourceNote('المصدر: Ibtekr_Accounts_September_monthly_report ← تاب حسابات الموردين ← سبتمبر 2026 · العدد = أوردرات رئيسية مميزة لكل مورد وقد يتجاوز الإجمالي · «قيد التنفيذ» = تحت التجهيز + في الشحن + جاهز للشحن · المواصلات = مشاوير كل مورد من البداية (شيت Logistics expenses، ' + trPeriod(tA) + ') ومش بتتخصم من الرصيد'),
    ].filter(Boolean);
  }

  function ActualView() {
    const acc = accountsNow().balances; const vs = D.vendorSummary(vendorsNow());
    const P = D.potential(acc, SEED.inProgressShare, vs.deposits); const totalActual = P.actual;
    const tones = { 'حساب البنك': 'brand', 'حساب بوسطة': 'gold', 'حساب باي موب': 'goldlight', 'محفظة إلكترونية': 'neutral' };
    const names = { 'حساب البنك': 'البنك', 'حساب بوسطة': 'حساب بوسطة', 'حساب باي موب': 'Paymob', 'محفظة إلكترونية': 'المحفظة الإلكترونية' };
    const moves = store.accountMoves.filter((m) => inRange(m.date)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const outside = store.accountMoves.length - moves.length;
    return [
      h('div', { class: 'cards five' }, U.CategoryCard({ tone: 'goldlight', name: 'إجمالي الرصيد الفعلي', value: totalActual, pct: totalActual === 0 ? 0 : 1, caption: 'من إجمالي الرصيد الفعلي', details: () => ({ title: 'إجمالي الرصيد الفعلي — ' + D.formatMoney(totalActual) + ' ج.م', sub: 'الأرصدة الحالية لكل حساب · الرصيد المتوقع ' + D.formatMoney(P.total) + ' ج.م', summary: [{ label: 'الفعلي', value: D.formatMoney(P.actual) + ' ج.م' }, { label: 'حصة إبتكر قيد التنفيذ', value: D.formatMoney(P.inProgress) + ' ج.م' }, { label: 'العرابين', value: D.formatMoney(P.deposits) + ' ج.م' }, { label: 'المتوقع', value: D.formatMoney(P.total) + ' ج.م' }], headers: ['الحساب', 'الرصيد', 'النسبة', 'حركات في الفترة'], rows: D.ACCOUNTS.map((a) => [names[a], D.formatMoney(acc[a]), D.formatPct(totalActual ? acc[a] / totalActual : 0), String(moves.filter((m) => m.account === a).length)]), total: ['الإجمالي', D.formatMoney(totalActual), '100.0%', String(moves.length)], source: 'تاب الحساب الفعلي' }) }),
        D.ACCOUNTS.map((a) => U.CategoryCard({ tone: tones[a], name: names[a], value: acc[a], pct: totalActual === 0 ? 0 : acc[a] / totalActual, caption: 'من إجمالي الرصيد الفعلي', details: () => { const l = moves.filter((m) => m.account === a); return { title: names[a] + ' — ' + D.formatMoney(acc[a]) + ' ج.م', sub: D.formatPct(totalActual ? acc[a] / totalActual : 0) + ' من إجمالي الرصيد الفعلي · حركات الفترة', summary: [{ label: 'الرصيد', value: D.formatMoney(acc[a]) + ' ج.م' }, { label: 'إيداع', value: D.formatMoney(l.filter((m) => m.direction === 'deposit').reduce((x, m) => x + m.amount, 0)) + ' ج.م' }, { label: 'سحب', value: D.formatMoney(l.filter((m) => m.direction !== 'deposit').reduce((x, m) => x + m.amount, 0)) + ' ج.م' }], headers: ['التاريخ', 'العملية', 'البيان', 'المبلغ'], rows: l.map((m) => [num(D.formatDateNumeric(m.date)), m.direction === 'deposit' ? 'إيداع' : 'سحب', m.note || m.typeName || '—', D.formatMoney(m.amount)]), empty: 'مفيش حركات مسجّلة على الحساب ده في الفترة — الرصيد من الشيت.', source: 'تاب الحساب الفعلي' }; } }))),
      TableCard({ title: 'الرصيد المتوقع', body: U.Table({ headers: ['البند', 'المبلغ (ج.م)', 'النسبة من المتوقع'],
        rows: [['الرصيد الفعلي', num(D.formatMoney(P.actual)), num(D.formatPct(P.shares.actual))], ['حصة إبتكر من الأوردرات قيد التنفيذ', num(D.formatMoney(P.inProgress)), num(D.formatPct(P.shares.inProgress))], ['العرابين المدفوعة للموردين', num(D.formatMoney(P.deposits)), num(D.formatPct(P.shares.deposits))]],
        totalRow: ['الرصيد المتوقع', num(D.formatMoney(P.total)), num('100.0%')] }) }),
      TableCard({ title: 'سجل الحساب التفصيلي', count: moves.length + (moves.length === 1 ? ' حركة' : ' حركات') + (outside ? ' · ' + outside + ' خارج الفترة' : ''), body: moves.length === 0 ? U.EmptyState('لسه مفيش حركات مسجّلة', 'اضغط «إضافة مبلغ» وسجّل أول إيداع أو سحب، وهيظهر هنا.') :
        U.Table({ headers: ['التاريخ', 'نوع الحساب', 'العملية', 'المبلغ (ج.م)', ''], rows: moves.map((m) => [num(D.formatDateNumeric(m.date)), m.account, m.direction === 'deposit' ? 'إيداع' : 'سحب',
          h('span', { class: m.direction === 'deposit' ? 'pos' : 'neg' }, num((m.direction === 'deposit' ? '+' : '-') + D.formatMoney(m.amount))), RowActions('accountMoves', m, (r) => deleteRec('accountMoves', r))]) }) }),
      sourceNote('المصدر: Ibtekr_Accounts_September_monthly_report ← تاب الحساب الفعلي ← الرصيد الحالي · الرصيد المتوقع = الرصيد الفعلي + حصة إبتكر من الأوردرات قيد التنفيذ + العرابين المدفوعة للموردين'),
    ];
  }

  // ---------- render ----------
  const VIEWS = { expenses: ExpensesView, sales: SalesView, vendors: VendorsView, actual: ActualView };
  let focusTab = false;
  // ---------- Reports page (Figma: التقارير — Desktop 1440 / Mobile 360) ----------
  const R = window.IbtekrReports;
  const ordersRows = () => (window.OrdersApp ? window.OrdersApp.query({}, 10000).rows : []);
  const tone4 = ['brand', 'gold', 'goldlight', 'neutral'];
  const kpiTone = (d) => (state.rcompare ? d.tone : 'off');
  const money = (n) => D.formatMoney(n);
  const pctText = (n, total) => (total ? Math.round(n / total * 100) : 0) + '%';
  const freshness = () => 'آخر تحديث: ' + D.formatDateLong(TODAY) + '، 09:30 (توقيت القاهرة) · المصدر: الأوردرات والحسابات';
  function barList(items, { max, fmt, tones }) {
    // items: [label, value, extraText?]; tones: fixed order (color follows the entity, never its rank)
    const top = max || Math.max(1, ...items.map((i) => i[1]));
    return items.map((it, i) => U.BarRow({ tone: (tones && tones[i]) || tone4[Math.min(i, 3)], label: it[0], value: it[2] || fmt(it[1]), pct: it[1] / top }));
  }
  function csvCopy(headers, rows, label) {
    const text = R.toCsv(headers, rows);
    const done = () => { state.rnote = { kind: 'success', text: 'تم نسخ ' + label + ' كـ CSV — الصقه في Excel أو Google Sheets.' }; renderReports(); };
    const fail = () => { state.rnote = { kind: 'error', text: 'تعذّر النسخ من المتصفح — جرّب تاني أو انسخ الجدول يدويًا.' }; renderReports(); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail); else fail(); } catch (e) { fail(); }
  }
  let rExport = null; // {headers, rows, label} of the current tab's table, set by each view
  const mobileMq = window.matchMedia ? window.matchMedia('(max-width: 1023px)') : { matches: false }; // <=1023: tables become Record cards (Figma 291:410 mobile / 291:446 tablet)
  const isMobile = () => mobileMq.matches;
  // Figma "Mobile 360": tables become a list of cards (title + key/value rows), first MOBILE_ROWS rows + the page link
  const MOBILE_ROWS = 5;
  function CardList({ headers, rows, titleIndex, more }) {
    return h('div', { class: 'card-list' },
      rows.slice(0, MOBILE_ROWS).map((r) => h('div', { class: 'card list-card' },
        h('div', { class: 't-label title' }, r[titleIndex]),
        r.map((c, i) => (i === titleIndex ? null : h('div', { class: 'kv' }, h('span', { class: 't-small' }, headers[i]), h('span', { class: 't-body' }, c)))))),
      rows.length > MOBILE_ROWS ? h('div', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'عرض ' + MOBILE_ROWS + ' من ' + rows.length) : null,
      more || null);
  }
  const tableOrList = (table, list) => (isMobile() ? list() : table());
  function OrdersReportView() {
    const rep = R.ordersReport(ordersRows(), state.rrange, TODAY);
    if (rep.count === 0) { rExport = null; return [U.EmptyState('مفيش أوردرات في الفترة دي', 'غيّر الفترة من أعلى الصفحة أو اختار «آخر 30 يوم» — التقرير بيتحسب من تاريخ الأوردر.')]; }
    const n = rep.count;
    const headers = ['رقم الأوردر', 'العميل', 'الحالة', 'التأكيد', 'التسليم', 'العمر (يوم)', 'الإجمالي'];
    const dl = { ok: 'غير متأخر', risk: 'قابل للتأخير', late: 'متأخر' };
    rExport = { label: 'أوردرات تحتاج تدخّل', headers, rows: rep.actionRows.map((r) => [r.id, r.customer, r.status, r.confirm, dl[r.delivery], r.ageDays, r.total]) };
    const maxW = Math.max(1, ...rep.weekly.map((w) => w.count));
    const oRows = (list) => list.map((r) => [num('IB-' + r.id), r.customer, num(D.formatDateNumeric(R.orderDate(r, TODAY))), r.status, cfText(r.confirm), R.OPEN_STATUSES && !R.OPEN_STATUSES.has(r.status) ? '—' : U.DelayBadge(r.delivery), num(money(r.total))]);
    const oHead = ['رقم الأوردر', 'العميل', 'التاريخ', 'الحالة', 'التأكيد', 'التسليم', 'الإجمالي'];
    const per = 'الفترة ' + D.formatDateNumeric(state.rrange.from) + ' – ' + D.formatDateNumeric(state.rrange.to);
    const oOpen = (list) => (i) => { if (OA() && OA().details) OA().details(list[i].id, 'info'); };
    // owner 22 Oct: cancelled orders + a report of the reasons entered in the cancel popup
    const cr = R.cancelReasons(rep.rows);
    const cancelOrders = (g) => ({ title: (g.reason === R.NO_REASON ? 'أوردرات ملغية من غير سبب مسجّل' : 'ملغية بسبب «' + g.reason + '»') + ' — ' + g.count, sub: per + ' · اضغط على أي أوردر يفتح تفاصيله',
      summary: [{ label: 'العدد', value: String(g.count) + ' أوردر' }, { label: 'القيمة', value: money(g.total) + ' ج.م' }],
      headers: ['رقم الأوردر', 'العميل', 'التاريخ', 'الإجمالي', 'ملاحظة الإلغاء'], rows: g.rows.map((r) => { const o = OA() && OA().get ? OA().get(r.id) : null; const c = o && o.cancel; return [num('IB-' + r.id), r.customer, num(D.formatDateNumeric(c && c.date || R.orderDate(r, TODAY))), money(r.total), (c && c.note) || '—']; }),
      total: ['الإجمالي', '', '', money(g.total), ''], onRow: (i) => { if (OA() && OA().details) OA().details(g.rows[i].id, 'info'); } });
    const cancelDetails = () => ({ title: 'أسباب إلغاء الأوردرات — ' + cr.count + ' أوردر', sub: per + ' · من السبب اللي بيتكتب في بوب «إلغاء» · اضغط على أي سبب يفتح أوردراته',
      summary: [{ label: 'أوردرات ملغية', value: String(cr.count) }, { label: 'قيمتها', value: money(cr.total) + ' ج.م' }, { label: 'نسبة الإلغاء', value: pctText(cr.count, n) }, { label: 'بسبب مسجّل', value: cr.recorded + ' من ' + cr.count }],
      headers: ['السبب', 'العدد', 'النسبة', 'القيمة (ج.م)'], rows: cr.byReason.map((g) => [g.reason, String(g.count), D.formatPct(g.pct), money(g.total)]),
      total: cr.count ? ['الإجمالي', String(cr.count), '100%', money(cr.total)] : null,
      onRow: (i) => U.DetailsModal(cancelOrders(cr.byReason[i])),
      note: cr.count > cr.recorded ? 'الأوردرات الملغية قبل إضافة بوب السبب بتظهر «غير مسجّل».' : '', empty: 'مفيش أوردرات ملغية في الفترة دي.', source: 'الأوردرات (حالة «ملغي» + سبب الإلغاء)' });
    const odet = (k) => { const all = rep.rows.slice().sort((a, b) => a.ageDays - b.ageDays);
      if (k === 'count') return { title: 'أوردرات الفترة — ' + n, sub: per + ' · اضغط على أي أوردر يفتح تفاصيله', summary: [{ label: 'العدد', value: String(n) }, { label: 'إجمالي القيمة', value: money(rep.total) + ' ج.م' }, { label: 'الفترة السابقة', value: String(rep.prev.count) }], headers: oHead, rows: oRows(all), total: ['الإجمالي — ' + n + ' أوردر', '', '', '', '', '', money(rep.total)], onRow: oOpen(all), source: 'الأوردرات (Airtable) — من تاريخ الأوردر' };
      if (k === 'done') { const l = all.filter((r) => r.status === 'مكتمل'); return { title: 'الأوردرات المكتملة — ' + l.length + ' من ' + n, sub: per, summary: [{ label: 'نسبة الإكمال', value: Math.round(rep.completionRate * 100) + '%' }, { label: 'مكتمل', value: String(l.length) }, { label: 'مش مكتمل', value: String(n - l.length) }, { label: 'الفترة السابقة', value: Math.round(rep.prev.completionRate * 100) + '%' }], headers: oHead, rows: oRows(l), onRow: oOpen(l) }; }
      if (k === 'avg') { const l = all.slice().sort((a, b) => b.total - a.total); return { title: 'متوسط قيمة الأوردر — ' + money(rep.avg) + ' ج.م', sub: per + ' · مرتبة من الأعلى قيمة', summary: [{ label: 'إجمالي المبيعات', value: money(rep.total) + ' ج.م' }, { label: 'عدد الأوردرات', value: String(n) }, { label: 'المتوسط', value: money(rep.avg) + ' ج.م' }, { label: 'الفترة السابقة', value: money(rep.prev.avg) + ' ج.م' }], headers: oHead, rows: oRows(l), onRow: oOpen(l), note: 'المتوسط = إجمالي المبيعات ÷ عدد الأوردرات.' }; }
      if (k === 'cancel') return cancelDetails();
      const l = rep.actionRows; return { title: 'أوردرات تحتاج تدخّل — ' + l.length, sub: per + ' · غير مؤكدة أو قابلة للتأخير وما زالت مفتوحة', summary: [{ label: 'غير مؤكدة', value: String(l.filter((r) => r.confirm !== 'مؤكد').length) }, { label: 'قابلة للتأخير / متأخرة', value: String(l.filter((r) => r.delivery !== 'ok').length) }], headers: oHead, rows: oRows(l), onRow: oOpen(l) }; };
    return [
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'إجمالي الأوردرات', value: String(n), unit: 'أوردر', compare: kpiTone(rep.deltas.count), delta: rep.deltas.count, note: ['إجمالي القيمة ', num(money(rep.total)), ' ج.م'], details: () => odet('count') }),
        U.KpiTile({ label: 'نسبة الإكمال', value: Math.round(rep.completionRate * 100) + '%', compare: kpiTone(rep.deltas.completionRate), delta: rep.deltas.completionRate, note: rep.completed + ' مكتمل من ' + n + ' في الفترة', details: () => odet('done') }),
        U.KpiTile({ label: 'متوسط قيمة الأوردر', value: money(rep.avg), unit: 'ج.م', compare: kpiTone(rep.deltas.avg), delta: rep.deltas.avg, note: 'إجمالي المبيعات ÷ عدد الأوردرات', details: () => odet('avg') }),
        U.KpiTile({ label: 'أوردرات تحتاج تدخّل', value: String(rep.needAction), unit: 'أوردر', compare: kpiTone(rep.deltas.needAction), delta: rep.deltas.needAction, note: 'غير مؤكدة أو قابلة للتأخير وما زالت مفتوحة', details: () => odet('action') }),
        U.KpiTile({ label: 'أوردرات ملغية', value: String(cr.count), unit: 'أوردر', compare: 'off', note: [num(pctText(cr.count, n)), ' من الأوردرات · ', num(money(cr.total)), ' ج.م · ', cr.byReason[0] && cr.byReason[0].reason !== R.NO_REASON ? 'أكتر سبب: ' + cr.byReason[0].reason : 'اضغط «التفاصيل» للأسباب'], details: () => odet('cancel') })),
      h('div', { class: 'charts' },
        U.ChartCard({ title: 'الأوردرات أسبوعيًا', subtitle: 'عدد الأوردرات · الأسبوع يبدأ السبت', footnote: 'الأحدث على اليسار · الأسبوع الأعلى بالأخضر', body: h('div', { class: 'cols', role: 'img', 'aria-label': rep.weekly.map((w) => w.label + ': ' + w.count).join('، ') },
          rep.weekly.map((w) => h('div', { class: 'col' + (w.count === maxW ? ' hi' : '') }, h('span', { class: 't-label' }, num(String(w.count))), h('i', { style: 'height:' + Math.max(6, Math.round(w.count / maxW * 140)) + 'px' }), h('span', { class: 't-small' }, num(w.label))))) }),
        U.ChartCard({ title: 'توزيع حالات الأوردرات', subtitle: 'الفترة المحددة · ' + n + ' أوردر', footnote: 'حسب حالة الأوردر الرئيسي · الشريط نسبي لأكبر حالة', body: barList(rep.byStatus.map(([l, c]) => [l, c, c + ' (' + pctText(c, n) + ')']), { fmt: String, tones: ['brand', 'gold', 'goldlight', 'neutral', 'neutral', 'neutral'] }) }),
        U.ChartCard({ title: 'حالة التأكيد', subtitle: 'كل أوردرات الفترة', footnote: 'غير المؤكد يظهر أيضًا في إشعار «عملاء لم تؤكد»', body: barList(rep.byConfirm.map(([l, c]) => [l, c, c + ' (' + pctText(c, n) + ')']), { fmt: String, tones: ['brand', 'gold', 'neutral'] }) }),
        U.ChartCard({ title: 'حالة التسليم', subtitle: 'الأوردرات المفتوحة · قاعدة 9 / 11 يوم', footnote: 'الحالة تُحسب من عمر الأوردر، لا تُكتب يدويًا', body: ['ok', 'risk', 'late'].map((k) => h('div', { class: 'deliv-row' }, U.DelayBadge(k), h('span', { class: 't-label' }, num(rep.byDelivery[k] + ' أوردر (' + pctText(rep.byDelivery[k], n) + ')')))) })),
      TableCard({ title: 'أوردرات تحتاج تدخّل — قابلة للتأخير أو غير مؤكدة', count: rep.actionRows.length + ' أوردر', action: Button({ type: 'text', size: 'sm', label: 'فتح في الأوردرات', onClick: () => showOrders({ deliv: 'risk' }) }),
        body: rep.actionRows.length === 0 ? U.EmptyState('كله تمام', 'مفيش أوردرات مفتوحة قابلة للتأخير أو غير مؤكدة في الفترة دي.') : tableOrList(
          () => U.Table({ headers, rows: rep.actionRows.map((r) => [num(r.id), r.customer, r.status, cfText(r.confirm), U.DelayBadge(r.delivery), num(String(r.ageDays)), num(money(r.total))]) }),
          () => CardList({ headers, titleIndex: 1, rows: rep.actionRows.map((r) => [num(r.id), r.customer, r.status, cfText(r.confirm), U.DelayBadge(r.delivery), num(String(r.ageDays)), num(money(r.total))]) })) }),
      h('p', { class: 'source' }, 'المصدر: الأوردرات (Airtable base appwlLhZ8JpVAgzgI) · الفترة تُحسب من تاريخ الأوردر · كل الأرقام مشتقة ولا تُكتب يدويًا')];
  }
  function VendorsReportView() {
    const rep = R.vendorsReport(ordersRows(), state.rrange, TODAY, vendorsNow());
    const tA = trAll(); rep.rows.forEach((r) => { r.transport = trVendor(r.name).total; }); const trTot = Math.round(rep.rows.reduce((x, r) => x + r.transport, 0) * 100) / 100;
    const headers = ['المورد', 'الأوردرات', 'قابلة للتأخير', 'العمولة', 'حصة إبتكر (مكتمل)', 'العرابين', 'المواصلات', 'الرصيد الحالي'];
    rExport = { label: 'جدول الموردين', headers, rows: rep.rows.map((r) => [r.name, r.orders, r.late, r.pct, r.share, r.deposits, r.transport, r.balance]) };
    const vs = vendorsNow(); const vOpen = (list) => (i) => { const v = vstore.findByName(list[i].name); if (v) { go('vendors'); openVendor(v.id); } };
    const vrow = (r) => [r.name, String(r.orders), String(r.late), r.pct, money(r.share), money(r.deposits), money(r.transport), money(r.balance)];
    const vdet2 = (k) => {
      if (k === 'active') { const l = rep.rows.filter((r) => r.orders > 0); return { title: 'الموردين النشطين في الفترة — ' + l.length, sub: 'مورد له أوردر واحد على الأقل · الأوردر المشترك بيتحسب لكل مورد فيه', summary: [{ label: 'موردين', value: String(l.length) }, { label: 'أوردرات', value: String(l.reduce((x, r) => x + r.orders, 0)) }], headers, rows: l.map(vrow), onRow: vOpen(l) }; }
      if (k === 'pct') { const l = vs.filter((v) => /%/.test(v.pct) && parseFloat(v.pct) < 100).sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct)); return { title: 'عمولة إبتكر لكل مورد — المتوسط ' + Math.round(rep.avgCommission * 100) + '%', sub: 'ثابتة حسب جدول الموردين · بتتراوح 30% – 65%', summary: [{ label: 'المتوسط', value: Math.round(rep.avgCommission * 100) + '%' }, { label: 'أعلى', value: l.length ? l[0].name + ' ' + l[0].pct : '—' }, { label: 'أقل', value: l.length ? l[l.length - 1].name + ' ' + l[l.length - 1].pct : '—' }], headers: ['المورد', 'العمولة', 'حصة إبتكر (مكتمل)'], rows: l.map((v) => [v.name, v.pct, money(v.c[2])]), onRow: vOpen(l), note: 'نسب Antikiano / Rufaida / HANDS بانتظار تأكيد المالك.' }; }
      if (k === 'dep') { const l = vs.filter((v) => v.deposits > 0).sort((a, b) => b.deposits - a.deposits); return { title: 'عرابين مدفوعة للموردين — ' + money(rep.deposits) + ' ج.م', sub: 'بتتخصم من رصيد المورد لما الأوردرات تكتمل', summary: [{ label: 'الإجمالي', value: money(rep.deposits) + ' ج.م' }, { label: 'موردين', value: String(l.length) }], headers: ['المورد', 'العربون', 'الرصيد الحالي'], rows: l.map((v) => [v.name, money(v.deposits), money(v.balance)]), total: ['الإجمالي', money(l.reduce((x, v) => x + v.deposits, 0)), money(l.reduce((x, v) => x + v.balance, 0))], onRow: vOpen(l), source: 'شيت Balances_Payouts + الحركات المالية' }; }
      const l = rep.rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late); return { title: 'موردين عندهم أوردرات قابلة للتأخير — ' + l.length, sub: 'من ' + rep.active + ' مورد نشط في الفترة · قاعدة 9 / 11 يوم', summary: [{ label: 'موردين', value: String(l.length) }, { label: 'أوردرات قابلة للتأخير / متأخرة', value: String(l.reduce((x, r) => x + r.late, 0)) }], headers, rows: l.map(vrow), onRow: vOpen(l) }; };
    return [
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'موردين نشطين', value: String(rep.active), unit: 'مورد', compare: kpiTone(rep.deltas.active), delta: rep.deltas.active, note: 'مورد له أوردر واحد على الأقل في الفترة', details: () => vdet2('active') }),
        U.KpiTile({ label: 'متوسط عمولة إبتكر', value: Math.round(rep.avgCommission * 100) + '%', compare: 'off', note: 'ثابتة حسب جدول الموردين · تتراوح 30% – 65%', details: () => vdet2('pct') }),
        U.KpiTile({ label: 'عرابين مدفوعة للموردين', value: money(rep.deposits), unit: 'ج.م', compare: 'off', note: 'حسب شيت الحسابات · تُخصم من رصيد المورد', details: () => vdet2('dep') }),
        U.KpiTile({ label: 'مواصلات الموردين', value: money(tA.vendors), unit: 'ج.م', compare: 'off', note: [num(String(tA.vendorTrips)), ' مشوار لـ ', num(String(tA.vendorCount)), ' موردين · من البداية'], details: () => transportDetails('') }),
        U.KpiTile({ label: 'موردين عندهم أوردرات قابلة للتأخير', value: String(rep.withDelay), unit: 'مورد', compare: kpiTone(rep.deltas.withDelay), delta: rep.deltas.withDelay, note: 'من ' + rep.active + ' مورد نشط في الفترة', details: () => vdet2('late') })),
      h('div', { class: 'charts' },
        U.ChartCard({ title: 'أعلى الموردين بعدد الأوردرات', subtitle: 'الفترة المحددة · أوردرات فيها المورد', footnote: 'الأوردر المشترك يُحسب لكل مورد فيه', body: rep.topByOrders.length ? barList(rep.topByOrders, { fmt: String, tones: ['brand', 'brand', 'brand', 'goldlight', 'goldlight', 'neutral'] }) : U.EmptyState('مفيش بيانات', 'لا توجد أوردرات في الفترة') }),
        U.ChartCard({ title: 'الموردون الأكثر تأخيرًا', subtitle: 'أوردرات مفتوحة قابلة للتأخير أو متأخرة', footnote: 'يُحسب من قاعدة 9 / 11 يوم · نفس مصدر إشعار «موردين متأخرين»', body: rep.topLate.length ? barList(rep.topLate, { fmt: String, tones: ['gold', 'gold', 'goldlight', 'goldlight', 'goldlight', 'neutral'] }) : U.EmptyState('كله في الموعد', 'مفيش موردين عندهم أوردرات قابلة للتأخير في الفترة') })),
      TableCard({ title: 'جدول الموردين — الفترة المحددة', count: rep.rows.length + ' مورد', action: Button({ type: 'text', size: 'sm', label: 'فتح حسابات الموردين', onClick: () => { state.tab = 'vendors'; go('accounts'); } }),
        body: tableOrList(() => U.Table({ cls: 'vendors-table', headers, rows: rep.rows.map((r) => [r.name, num(String(r.orders)), num(String(r.late)), num(r.pct), num(money(r.share)), num(money(r.deposits)), num(money(r.transport)), num(money(r.balance))]),
          totalRow: ['الإجمالي', num(String(rep.totals.orders)), num(String(rep.totals.late)), '—', num(money(rep.totals.share)), num(money(rep.totals.deposits)), num(money(trTot)), num(money(rep.totals.balance))] }),
          () => CardList({ headers, titleIndex: 0, rows: rep.rows.map((r) => [r.name, num(String(r.orders)), num(String(r.late)), num(r.pct), num(money(r.share)), num(money(r.deposits)), num(money(r.transport)), num(money(r.balance))]) })) }),
      h('p', { class: 'source' }, 'المصدر: الأوردرات (Airtable) + شيت Vendors Orders mangment-Invoices (Commissions, Balances_Payouts) · نسب Antikiano / Rufaida / HANDS بانتظار تأكيد المالك · المواصلات من شيت Logistics expenses (' + trPeriod(tA) + ') إجمالي من البداية مش الفترة')];
  }
  function AccountsReportView() {
    const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, '2026-09-01', '2026-09-30');
    const byCat = {}; D.CATEGORIES.forEach((c) => { byCat[c] = tot.byCategory[c].amount; });
    const rep = R.accountsReport({ expenses: byCat, sales: SEED.sales, accounts: accountsNow().balances, inProgressShare: SEED.inProgressShare, deposits: SEED.vendorTotals.dep });
    const headers = ['الشهر', 'الأوردرات', 'المبيعات', 'حصة إبتكر', 'المصروفات', 'الصافي'];
    const rows = [['سبتمبر 2026', rep.orders, rep.salesTotal, rep.share, rep.expensesTotal, rep.net]];
    rExport = { label: 'ملخص الحسابات', headers, rows };
    const netTone = rep.net < 0 ? 'negative' : 'positive';
    const pctRow = ([l, v, p]) => [l, money(v), D.formatPct(p)];
    const adet = (k) => {
      if (k === 'actual') return { title: 'الحساب الفعلي — ' + money(rep.actual) + ' ج.م', sub: 'الأرصدة الحالية · بتتدخل يدويًا في تاب «الحساب الفعلي» لحد الربط البنكي', summary: [{ label: 'الحساب الفعلي', value: money(rep.actual) + ' ج.م' }, { label: 'الرصيد المحتمل', value: money(rep.potential) + ' ج.م' }], headers: ['الحساب', 'الرصيد', 'النسبة'], rows: rep.accountRows.map(pctRow), total: ['الإجمالي', money(rep.actual), '100%'], note: 'الرصيد المحتمل = الحساب الفعلي + حصة إبتكر من أوردرات التنفيذ + العرابين المدفوعة: ' + rep.potentialParts.map(([l, v]) => l + ' ' + money(v)).join(' + '), actions: [{ label: 'فتح الحساب الفعلي', onClick: () => { state.tab = 'actual'; go('accounts'); } }] };
      if (k === 'share') return { title: 'حصة إبتكر من المبيعات — ' + money(rep.share) + ' ج.م', sub: 'سبتمبر 2026 · حصة كل أوردر بنسبة المورد بتاعه', summary: [{ label: 'المبيعات', value: money(rep.salesTotal) + ' ج.م' }, { label: 'حصة إبتكر', value: money(rep.share) + ' ج.م' }, { label: 'متوسط العمولة', value: Math.round(rep.sharePct * 1000) / 10 + '%' }], headers: ['حالة الأوردر', 'الأوردرات', 'المبيعات', 'حصة إبتكر', 'النسبة'], rows: SEED.sales.map((x) => [x.label, String(x.orders), money(x.sales), money(x.share), x.pct]), total: ['الإجمالي', String(SEED.salesTotal.orders), money(SEED.salesTotal.sales), money(SEED.salesTotal.share), SEED.salesTotal.pct], actions: [{ label: 'فتح المبيعات', onClick: () => { state.tab = 'sales'; go('accounts'); } }] };
      if (k === 'exp') return { title: 'المصروفات — ' + money(rep.expensesTotal) + ' ج.م', sub: 'سبتمبر 2026 حسب الفئة', summary: [{ label: 'الإجمالي', value: money(rep.expensesTotal) + ' ج.م' }, { label: 'أكبر فئة', value: rep.expenseRows.slice().sort((a, b) => b[1] - a[1])[0][0] }], headers: ['الفئة', 'المبلغ', 'النسبة'], rows: rep.expenseRows.map(pctRow), total: ['الإجمالي', money(rep.expensesTotal), '100%'], actions: [{ label: 'فتح المصروفات', onClick: () => { state.tab = 'expenses'; go('accounts'); } }] };
      return { title: 'صافي الشهر — ' + money(rep.net) + ' ج.م (' + (rep.net < 0 ? 'خسارة' : 'ربح') + ')', sub: 'سبتمبر 2026 · الصافي = حصة إبتكر − المصروفات', summary: [{ label: 'حصة إبتكر', value: money(rep.share) + ' ج.م' }, { label: 'المصروفات', value: money(rep.expensesTotal) + ' ج.م' }, { label: 'الصافي', value: money(rep.net) + ' ج.م' }], headers: ['البند', 'المبلغ'], rows: [['حصة إبتكر من المبيعات (+)', money(rep.share)]].concat(rep.expenseRows.map(([l, v]) => [l + ' (−)', money(v)])).concat([['الصافي', money(rep.net)]]) }; };
    const tA = trAll();
    return [
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'الحساب الفعلي', value: money(rep.actual), unit: 'ج.م', compare: 'off', note: ['بنك + بوسطة + باي موب + محفظة · الرصيد المحتمل ', num(money(rep.potential))], details: () => adet('actual') }),
        U.KpiTile({ label: 'حصة إبتكر من المبيعات', value: money(rep.share), unit: 'ج.م', compare: 'off', note: ['من مبيعات ', num(money(rep.salesTotal)), ' · متوسط عمولة ', num(Math.round(rep.sharePct * 1000) / 10 + '%')], details: () => adet('share') }),
        U.KpiTile({ label: 'إجمالي المصروفات', value: money(rep.expensesTotal), unit: 'ج.م', compare: 'off', note: 'سبتمبر 2026 · المرتبات · المصروفات · الاشتراكات · الإعلانات', details: () => adet('exp') }),
        U.KpiTile({ label: 'صافي الشهر (حصة إبتكر − المصروفات)', value: money(rep.net), unit: 'ج.م', compare: netTone, delta: { text: rep.net < 0 ? 'خسارة' : 'ربح', caption: 'سبتمبر 2026' }, note: [num(money(rep.share)), ' − ', num(money(rep.expensesTotal))], details: () => adet('net') }),
        U.KpiTile({ label: 'المواصلات', value: money(tA.total), unit: 'ج.م', compare: 'off', note: ['موردين ', num(money(tA.vendors)), ' · تشغيل ', num(money(tA.ops)), ' · من البداية'], details: () => transportDetails(null) })),
      h('div', { class: 'charts' },
        U.ChartCard({ title: 'المصروفات حسب الفئة', subtitle: 'سبتمبر 2026 · ' + money(rep.expensesTotal) + ' ج.م', footnote: 'نفس أرقام تاب «المصروفات» في الحسابات', body: barList(rep.expenseRows.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money }) }),
        U.ChartCard({ title: 'المبيعات حسب حالة الأوردر', subtitle: 'سبتمبر 2026 · ' + rep.orders + ' أوردر', footnote: 'حصة إبتكر تُحسب بنسبة كل مورد', body: barList(rep.salesRows.map(([l, v, sh]) => [l, v, money(v) + ' · حصة ' + money(sh)]), { fmt: money, tones: ['brand', 'gold', 'neutral'] }) }),
        U.ChartCard({ title: 'توزيع الحساب الفعلي', subtitle: 'الأرصدة الحالية', footnote: 'تُدخل يدويًا في تاب «الحساب الفعلي» حتى يتم الربط البنكي', body: barList(rep.accountRows.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money }) }),
        U.ChartCard({ title: 'مكوّنات الرصيد المحتمل', subtitle: money(rep.potential) + ' ج.م', footnote: 'الرصيد المحتمل = الحساب الفعلي + حصة إبتكر من أوردرات التنفيذ + العرابين المدفوعة', body: barList(rep.potentialParts.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money, tones: ['brand', 'gold', 'goldlight'] }) })),
      TableCard({ title: 'ملخص الحسابات الشهري', action: Button({ type: 'text', size: 'sm', label: 'فتح الحسابات', onClick: () => { state.tab = 'actual'; go('accounts'); } }),
        body: (() => { const tRows = [rows[0].map((c, i) => (i === 0 ? c : num(i === 1 ? String(c) : money(c)))), ['أكتوبر 2026 (حتى 20 أكتوبر) — المصروفات لم تُسجَّل بعد', num(String(R.ordersReport(ordersRows(), { from: '2026-10-01', to: TODAY }, TODAY).count)), '—', '—', '—', '—']];
          return tableOrList(() => U.Table({ headers, rows: tRows, totalRow: ['الإجمالي', num(String(rep.orders)), num(money(rep.salesTotal)), num(money(rep.share)), num(money(rep.expensesTotal)), num(money(rep.net))] }), () => CardList({ headers, titleIndex: 0, rows: tRows })); })() }),
      h('p', { class: 'source' }, 'المصدر: شيت الحسابات (المصروفات، المبيعات، حسابات الفيندورز، إجمالي الحساب الفعلي) · الصافي = حصة إبتكر − المصروفات · مبالغ المصروفات الفعلية تُقرأ من شيت Monthly Performance')];
  }
  const RVIEWS = { orders: OrdersReportView, vendors: VendorsReportView, accounts: AccountsReportView };
  function renderReports() {
    U.closePopover();
    const main = document.getElementById('reports'); if (!main) return; const sc = window.scrollY;
    const note = state.rnote; state.rnote = null;
    const tabs = U.Tabs({ items: REPORT_TABS, active: state.rtab, onChange: (id, viaKey) => { state.rtab = id; try { history.replaceState(null, '', '#reports-' + id); } catch (e) { /* sandboxed */ } focusTab = !!viaKey; renderReports(); } });
    tabs.setAttribute('aria-label', 'أقسام التقارير');
    const body = RVIEWS[state.rtab]();
    const noteEl = note ? U.InlineNote({ kind: note.kind, children: note.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => { noteEl.remove(); } }) }) : null;
    main.replaceChildren(...[
      h('div', { class: 'page-head row' },
        h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'التقارير'), U.FreshnessNote(freshness())),
        h('div', { class: 'actions' }, DateRangeField('reports'), window.IBDataActions.Menu(window.IBDataActions.PAGES.reports, () => ({ vendors: 'vendors', accounts: 'expenses' }[state.rtab] || 'orders')),
          Button({ type: state.rcompare ? 'primary' : 'default', label: 'مقارنة بالفترة السابقة', attrs: { 'aria-pressed': String(state.rcompare) }, onClick: () => { state.rcompare = !state.rcompare; renderReports(); } }),
          Button({ label: 'نسخ CSV', icon: 'download', disabled: !rExport, onClick: () => rExport && csvCopy(rExport.headers, rExport.rows, rExport.label) }))),
      tabs,
      noteEl,
      h('div', { id: 'rpanel', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.rtab, style: 'display:flex;flex-direction:column;gap:24px;min-width:0' }, body)].filter(Boolean));
    window.scrollTo(0, sc);
    if (focusTab) { const t = main.querySelector('[role=tab][aria-selected=true]'); if (t) t.focus(); focusTab = false; }
  }

  // ---------- Team tickets «تذاكر الفريق» (renamed from خدمة العملاء 21 Oct 2026; Figma page 180:4669: تذاكر الفريق — Desktop 1440; Modal / New ticket; Drawer / Ticket; Resolve; Reopen) ----------
  const TK = window.IbtekrTickets;
  const ME = Object.freeze({ name: ACTOR, role: TK.ADMIN_ROLE }); // the prototype runs as the system admin
  let seedClock = null; // seed data uses fixed past timestamps so the prototype is deterministic
  const tstore = TK.createStore({ now: () => seedClock || new Date().toISOString(), seed: seedTickets });
  function seedTickets(api) {
    // deterministic sample data built from real orders; timestamps are fixed so the prototype is stable
    let tick = Date.parse('2026-10-13T09:00:00Z'); const step = (h) => { tick += h * 3600000; seedClock = new Date(tick).toISOString(); };
    const mk = (input, by, hours) => { step(hours || 6); return api.create(input, by); };
    step(0);
    const S = { name: 'سارة أحمد', role: 'خدمة العملاء' }, M = { name: 'محمد علي', role: 'متابعة الموردين' }, H = { name: 'هبة سمير', role: 'الحسابات' };
    const t1 = mk({ type: 'customer', title: 'العميلة مستنية أوردر 177611 بقاله 11 يوم', description: 'العميلة اتصلت مرتين. المورد قال الشحنة هتخرج الخميس. محتاجين نأكد عليه ونبلغ العميلة بالموعد.', priority: 'high', assigneeRole: 'متابعة الموردين', orderId: '177611', customer: 'Customer 16', reason: 'تأخير في التسليم', followUp: '2026-10-22' }, S, 24 * 5);
    step(19); api.setStatus(t1.id, 'in_progress', M); step(0.1); api.reply(t1.id, 'كلمت Bian eg — الشحنة هتخرج الخميس 23 أكتوبر بعد الضهر. @خدمة العملاء بلّغوا العميلة.', M); step(25); api.reply(t1.id, 'بلّغت العميلة، موافقة على الخميس بعد 4 العصر.', S);
    const t2 = mk({ type: 'vendor', title: 'خلاف على عمولة سبتمبر — المورد بيقول 35% مش 40%', description: 'Antikiano بيقول إن نسبته في جدول الموردين 35% واتحسب 40% على أوردرات سبتمبر. محتاجين قرار المالك.', priority: 'urgent', assigneeRole: 'الحسابات', vendor: 'Antikiano', reason: 'خلاف على الحساب أو العمولة', followUp: '2026-10-19' }, H);
    const t3 = mk({ type: 'customer', title: 'العميلة مش بتأكد الأوردر — اتصلنا 3 مرات', description: 'أوردر 177902 غير مؤكد من 9 أيام. اتصلنا 3 مرات ومفيش رد. نبعت واتساب أخير قبل الإلغاء؟', priority: 'high', assigneeRole: 'خدمة العملاء', orderId: '177902', customer: 'Customer 01', reason: 'العميل مش بيرد', followUp: '2026-10-21' }, S, 20);
    api.setStatus(t3.id, 'waiting', S);
    const t4 = mk({ type: 'vendor', title: '4 أوردرات قابلة للتأخير عند rufaida — محتاج موعد تسليم', description: 'rufaida_store عندها 4 أوردرات عمرها 9–11 يوم. محتاجين موعد تسليم مؤكد لكل أوردر.', priority: 'normal', assigneeRole: 'متابعة الموردين', vendor: 'rufaida_store', reason: 'تأخير تسليم' }, M);
    api.setStatus(t4.id, 'waiting', M);
    mk({ type: 'internal', title: 'صور منتجات Art Craft الجديدة لسه ما اترفعتش', description: 'التصوير خلص الأسبوع اللي فات والصور لسه ما اترفعتش على المنتجات.', priority: 'normal', assigneeRole: 'المحتوى والتصوير' }, S);
    const t6 = mk({ type: 'customer', title: 'طلب تغيير عنوان الشحن قبل الخروج', description: 'العميلة عايزة تغيّر العنوان لمدينة نصر قبل ما الشحنة تخرج.', priority: 'normal', assigneeRole: 'اللوجستيك والشحن', orderId: '177573', customer: 'Customer 14', reason: 'أخرى' }, S, 12);
    api.setStatus(t6.id, 'in_progress', { name: 'كريم فوزي', role: 'اللوجستيك والشحن' });
    const t7 = mk({ type: 'customer', title: 'استرجاع فرق سعر الشحن 50 ج.م', description: 'العميل اتحاسب 100 شحن والصح 50.', priority: 'low', assigneeRole: 'الحسابات', orderId: '176513', customer: 'Customer 47', reason: 'مشكلة دفع أو استرجاع' }, S, 8);
    step(30); api.resolve(t7.id, { outcome: 'اتحلت المشكلة', note: 'اتحوّل الفرق على المحفظة' }, H);
    const t8 = mk({ type: 'customer', title: 'القطعة المفتوحة فقط يوم 6/10 — اتسلمت', description: 'العميلة طلبت القطعة المفتوحة بس يوم 6/10.', priority: 'low', assigneeRole: 'خدمة العملاء', orderId: '174354', customer: 'عميل 44', reason: 'أخرى' }, S, 5);
    step(50); api.resolve(t8.id, { outcome: 'اتحلت المشكلة' }, S); step(4); api.close(t8.id, S);
    seedClock = null;
  }
  state.tfilter = { status: 'open_any', type: 'all', priority: 'all', role: 'all', mine: false, q: '' };
  state.tpage = 1; const TPAGE = 8;
  const typeLabel = (t) => TK.label(TK.TYPES, t);
  const roleOpts = (allLabel) => [].concat(allLabel ? [{ value: 'all', label: allLabel }] : [], TK.ROLES.map((r) => ({ value: r, label: r })));
  const fmtTime = (iso) => { const d = new Date(iso); const local = d.toISOString().slice(0, 10); const hm = String(d.getUTCHours() + 3).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); return (local === TODAY ? 'اليوم ' + hm : local === D.formatDateNumeric ? '' : D.formatDateLong(local) + ' ' + hm); };
  const orderCtx = (id) => { if (!id || !window.OrdersApp) return null; const r = window.OrdersApp.query({ q: id }, 1).rows.find((x) => x.id === id); return r || null; };
  function ticketTasks() { return TK.filterTickets(tstore.all(), { status: 'open_any' }).filter((t) => (t.followUp && t.followUp < TODAY) || t.reopenCount > 0).map((t) => ({ id: t.id, role: t.assigneeRole, title: t.title, prio: t.priority, sub: t.followUp && t.followUp < TODAY ? 'عدّى موعد المتابعة ' + D.formatDateNumeric(t.followUp) : 'أُعيد فتحه ×' + t.reopenCount })); }
  function showTickets() { if (state.page !== 'tickets') go('tickets'); }
  let tnote = null;
  const notify = (kind, text) => { tnote = { kind, text }; renderTickets(); };

  function TicketsView() {
    const all = tstore.all(); const sum = TK.summary(all, TODAY);
    const f = Object.assign({}, state.tfilter, state.tfilter.mine ? { role: ME.role } : {});
    const list = TK.filterTickets(all, f);
    const pages = Math.max(1, Math.ceil(list.length / TPAGE)); if (state.tpage > pages) state.tpage = pages;
    const slice = list.slice((state.tpage - 1) * TPAGE, state.tpage * TPAGE);
    const setF = (k, v) => { state.tfilter[k] = v; state.tpage = 1; renderTickets(); };
    const sel = (id, label, options, value, key) => { const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' }); const cur = options.find((o) => o.value === value);
      const btn = h('button', { type: 'button', class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, style: 'width:auto;min-width:140px' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, label + ': ' + (cur ? cur.label : '—')));
      const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options, value, onSelect: (v) => { close(); setF(key, v); } })); btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap; };
    const search = h('input', { type: 'search', class: 'input', placeholder: 'ابحث برقم التذكرة أو الأوردر أو اسم العميل', 'aria-label': 'بحث في التذاكر', value: state.tfilter.q, style: 'width:320px;max-width:100%' });
    search.addEventListener('input', () => { state.tfilter.q = search.value; state.tpage = 1; renderTickets(true); });
    const mine = h('label', { class: 'check', style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, (() => { const c = h('input', { type: 'checkbox', checked: state.tfilter.mine }); c.addEventListener('change', () => setF('mine', c.checked)); return c; })(), 'تذاكر دوري بس');
    const headers = ['الرقم', 'العنوان', 'النوع', 'العميل / المورد', 'الأوردر', 'الأولوية', 'الحالة', 'المسؤول', 'آخر تحديث'];
    const who = (t) => t.type === 'vendor' ? (t.vendor || '—') : t.type === 'customer' ? (t.customer || (orderCtx(t.orderId) || {}).customer || '—') : '—';
    const rowEl = (t) => { const tr = h('tr', { 'data-id': t.id, tabindex: '0', role: 'button', 'aria-label': 'فتح التذكرة ' + t.id }, [num(t.id), t.title, typeLabel(t.type), who(t), t.orderId ? num(t.orderId) : '—', U.PriorityTag(t.priority), U.TicketStatus(t.status), t.assigneeRole, num(fmtTime(t.lastUpdate))].map((c, i) => h('td', { class: i === 1 ? 'ttl' : '' }, c)));
      tr.addEventListener('click', () => openTicket(t.id)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTicket(t.id); } }); return tr; };
    const table = h('div', { class: 'scroll-x' }, h('table', { class: 'tickets-table' }, h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, slice.map(rowEl))));
    const cards = h('div', { class: 'kv-list' }, slice.map((t) => { const c = h('div', { class: 'card list-card', tabindex: '0', role: 'button', 'aria-label': 'فتح التذكرة ' + t.id }, h('div', { class: 't-label title' }, t.title),
      [['الرقم', num(t.id)], ['النوع', typeLabel(t.type)], ['العميل / المورد', who(t)], ['الأولوية', U.PriorityTag(t.priority)], ['الحالة', U.TicketStatus(t.status)], ['المسؤول', t.assigneeRole], ['آخر تحديث', num(fmtTime(t.lastUpdate))]].map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 't-small' }, k), h('span', { class: 't-body' }, v))));
      c.addEventListener('click', () => openTicket(t.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTicket(t.id); }); return c; }));
    const pager = h('div', { class: 'pager' }, h('div', { class: 'pages' }, Button({ type: 'text', size: 'sm', label: 'السابق', disabled: state.tpage <= 1, onClick: () => { state.tpage--; renderTickets(); } }),
      Array.from({ length: pages }, (_, i) => Button({ type: i + 1 === state.tpage ? 'primary' : 'text', size: 'sm', label: String(i + 1), attrs: { 'aria-current': i + 1 === state.tpage ? 'page' : false }, onClick: () => { state.tpage = i + 1; renderTickets(); } })),
      Button({ type: 'text', size: 'sm', label: 'التالي', disabled: state.tpage >= pages, onClick: () => { state.tpage++; renderTickets(); } })), h('span', { class: 't-small' }, num(list.length ? 'عرض ' + ((state.tpage - 1) * TPAGE + 1) + '–' + Math.min(list.length, state.tpage * TPAGE) + ' من ' + list.length : '')));
    const tHead = ['التذكرة', 'العنوان', 'النوع', 'الأولوية', 'الحالة', 'المسؤول', 'المتابعة'];
    const tRow = (t) => [num(t.id), t.title, typeLabel(t.type), U.PriorityTag(t.priority), U.TicketStatus(t.status), t.assigneeRole || '—', t.followUp ? num(D.formatDateNumeric(t.followUp)) : '—'];
    const tdet = (k) => { const d = TK.summaryDetails(all, TODAY); const oT = (l) => (i) => openTicket(l[i].id);
      if (k === 'open') return { title: 'التذاكر المفتوحة — ' + d.open.length, sub: 'مفتوح + جاري العمل + بانتظار الرد · اضغط على أي تذكرة تفتحها', summary: TK.TYPES.map(([v, l]) => ({ label: l, value: String(d.open.filter((t) => t.type === v).length) })), headers: tHead, rows: d.open.map(tRow), onRow: oT(d.open) };
      if (k === 'overdue') return { title: 'تذاكر متأخرة عن موعد المتابعة — ' + d.overdue.length, sub: 'عدّت تاريخ المتابعة ولسه مفتوحة', summary: [{ label: 'متأخرة', value: String(d.overdue.length) }, { label: 'من المفتوحة', value: String(d.open.length) }], empty: 'مفيش تذاكر عدّت موعد المتابعة.', headers: tHead, rows: d.overdue.map(tRow), onRow: oT(d.overdue) };
      if (k === 'reopened') return { title: 'تذاكر اتفتحت تاني الأسبوع ده — ' + d.reopened.length, sub: 'مشكلة رجعت بعد الإغلاق — راجع السبب', summary: [{ label: 'اتفتحت تاني', value: String(d.reopened.length) }, { label: 'اتقفلت بالحل (الكل)', value: String(d.resolved.length) }], empty: 'مفيش تذاكر اتفتحت تاني الأسبوع ده.', headers: tHead.concat(['مرات الفتح']), rows: d.reopened.map((t) => tRow(t).concat([String(t.reopenCount)])), onRow: oT(d.reopened) };
      return { title: 'متوسط وقت الحل — ' + sum.avgDays + ' يوم', sub: 'من الإنشاء لـ «تم الحل» · ' + d.resolved.length + ' تذكرة', summary: [{ label: 'المتوسط', value: sum.avgDays + ' يوم' }, { label: 'أطول', value: d.resolved.length ? d.resolved[0].days + ' يوم' : '—' }], headers: ['التذكرة', 'العنوان', 'النوع', 'وقت الحل'], rows: d.resolved.map((t) => [num(t.id), t.title, typeLabel(t.type), num(t.days + ' يوم')]), onRow: oT(d.resolved) }; };
    return [
      h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'تذاكر الفريق'), h('p', { class: 't-small' }, 'تذاكر الفريق: مشاكل العملاء، مشاكل الموردين، والتعليقات الداخلية — كل تحديث بيتسجل في السجل')),
        h('div', { class: 'actions' }, window.IBDataActions.Menu(window.IBDataActions.PAGES.tickets), Button({ type: 'brand', icon: 'plus', label: 'إنشاء تذكرة', onClick: () => openNewTicket() }))),
      h('div', { class: 'toolbar' }, search, sel('f-st', 'الحالة', [{ value: 'open_any', label: 'مفتوحة' }, { value: 'all', label: 'الكل' }].concat(TK.STATUSES.map(([v, l]) => ({ value: v, label: l }))), state.tfilter.status, 'status'),
        sel('f-ty', 'النوع', [{ value: 'all', label: 'الكل' }].concat(TK.TYPES.map(([v, l]) => ({ value: v, label: l }))), state.tfilter.type, 'type'),
        sel('f-pr', 'الأولوية', [{ value: 'all', label: 'الكل' }].concat(TK.PRIORITIES.map(([v, l]) => ({ value: v, label: l }))), state.tfilter.priority, 'priority'),
        sel('f-ro', 'المسؤول', roleOpts('الكل'), state.tfilter.role, 'role'), h('span', { class: 'grow' }), mine),
      tnote ? (() => { const n = tnote; tnote = null; const el = U.InlineNote({ kind: n.kind, children: n.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => el.remove() }) }); return el; })() : null,
      h('div', { class: 'cards' },
        U.KpiTile({ label: 'تذاكر مفتوحة', value: String(sum.open), unit: 'تذكرة', compare: 'off', note: 'مفتوح + جاري العمل + بانتظار الرد', details: () => tdet('open') }),
        U.KpiTile({ label: 'متأخرة عن موعد المتابعة', value: String(sum.overdue), unit: 'تذكرة', compare: sum.overdue ? 'negative' : 'off', delta: { text: 'تحتاج تدخّل', caption: 'عدّت تاريخ المتابعة ولسه مفتوحة' }, note: 'بتظهر كمان في إشعار «مهام داخلية»', details: () => tdet('overdue') }),
        U.KpiTile({ label: 'متوسط وقت الحل', value: String(sum.avgDays), unit: 'يوم', compare: 'off', note: 'من الإنشاء لـ «تم الحل» · ' + sum.resolvedCount + ' تذكرة', details: () => tdet('avg') }),
        U.KpiTile({ label: 'أُعيد فتحها هذا الأسبوع', value: String(sum.reopened), unit: 'تذكرة', compare: sum.reopened ? 'negative' : 'off', delta: { text: 'راجع السبب', caption: 'مشكلة رجعت بعد الإغلاق' }, note: 'إعادة الفتح بتحتاج سبب وبترجع لنفس المسؤول', details: () => tdet('reopened') })),
      TableCard({ title: 'التذاكر', count: list.length + ' تذكرة · مرتبة بالأولوية ثم آخر تحديث', body: list.length === 0 ? U.EmptyState('مفيش تذاكر مطابقة', 'غيّر الفلاتر، أو اضغط «إنشاء تذكرة» لو ظهرت مشكلة مع عميل أو مورد.') : [tableOrList(() => table, () => cards), pager] }),
      h('p', { class: 'source' }, 'المصدر: جدول التذاكر في النظام (Airtable مؤقتًا) · الأوردر والعميل بيتجابوا لايف من الأوردرات · كل تغيير حالة أو رد بيتسجل في Event Log')];
  }
  function renderTickets(keepFocus) {
    U.closePopover();
    const main = document.getElementById('tickets'); if (!main) return; const sc = window.scrollY; const hadFocus = keepFocus && document.activeElement && document.activeElement.type === 'search';
    main.replaceChildren(...TicketsView().filter(Boolean));
    window.scrollTo(0, sc); if (hadFocus) { const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }

  // ----- new ticket modal (Figma: Modal / New ticket) -----
  function openNewTicket(pre) {
    const f = Object.assign({ type: 'customer', title: '', description: '', priority: 'normal', assigneeRole: '', orderId: '', vendor: '', reason: '', followUp: '' }, pre || {});
    let errs = {}; let modal = null;
    const vendorOpts = vendorsNow().map((v) => ({ value: v.name, label: v.name }));
    function draw() {
      const ctx = f.type === 'customer' && f.orderId ? orderCtx(f.orderId.trim()) : null;
      const fields = [
        h('div', { class: 'row cols2' }, U.TextInput({ id: 't-title', label: 'العنوان', required: true, value: f.title, error: errs.title, placeholder: 'سطر واحد يلخّص المشكلة', maxlength: TK.TITLE_MAX, onInput: (v) => { f.title = v; } }),
          U.Select({ id: 't-type', label: 'النوع', required: true, options: TK.TYPES.map(([v, l]) => ({ value: v, label: l })), value: f.type, error: errs.type, onChange: (v) => { f.type = v; f.reason = ''; errs = {}; draw(); } })),
        f.type === 'customer' ? U.TextInput({ id: 't-order', label: 'رقم الأوردر', required: true, value: f.orderId, error: errs.orderId, placeholder: 'مثال 177611', inputmode: 'numeric', help: ctx ? null : 'اختيار الأوردر بيجيب العميل والهاتف والمورد تلقائي', onInput: (v) => { f.orderId = v; const c = orderCtx(v.trim()); if (c) draw(); } }) : null,
        ctx ? h('div', { class: 'ctx-card', style: 'padding:8px 12px' }, h('div', { class: 'facts' }, U.DelayBadge(ctx.delivery), h('span', { class: 't-small' }, num(ctx.customer + ' · ' + (ctx.vendors || []).join('، ') + ' · ' + ctx.status + ' · ' + ctx.ageDays + ' يوم · ' + D.formatMoney(ctx.total) + ' ج.م')))) : null,
        f.type === 'customer' ? U.Select({ id: 't-reason', label: 'سبب المشكلة', required: true, options: TK.CUSTOMER_REASONS.map((r) => ({ value: r, label: r })), value: f.reason, error: errs.reason, onChange: (v) => { f.reason = v; draw(); } }) : null,
        f.type === 'vendor' ? U.Select({ id: 't-vendor', label: 'المورد', required: true, options: vendorOpts, value: f.vendor, error: errs.vendor, placeholder: 'اختار المورد', onChange: (v) => { f.vendor = v; draw(); } }) : null,
        f.type === 'vendor' ? U.TextInput({ id: 't-order', label: 'رقم الأوردر', value: f.orderId, error: errs.orderId, placeholder: 'اختياري', inputmode: 'numeric', onInput: (v) => { f.orderId = v; } }) : null,
        f.type === 'vendor' ? U.Select({ id: 't-reason', label: 'سبب المشكلة', required: true, options: TK.VENDOR_REASONS.map((r) => ({ value: r, label: r })), value: f.reason, error: errs.reason, onChange: (v) => { f.reason = v; draw(); } }) : null,
        U.Textarea({ id: 't-desc', label: 'الوصف', required: true, value: f.description, error: errs.description, placeholder: 'إيه اللي حصل + إيه المطلوب من الفريق', onInput: (v) => { f.description = v; } }),
        h('div', { class: 'row cols2' }, U.Select({ id: 't-prio', label: 'الأولوية', required: true, options: TK.PRIORITIES.map(([v, l]) => ({ value: v, label: l })), value: f.priority, error: errs.priority, onChange: (v) => { f.priority = v; draw(); } }),
          U.Select({ id: 't-role', label: 'المسؤول (الدور)', required: true, options: roleOpts(), value: f.assigneeRole, error: errs.assigneeRole, placeholder: 'اختار الدور', onChange: (v) => { f.assigneeRole = v; draw(); } })),
        h('div', { class: 'row cols2' }, U.DateField({ id: 't-follow', label: 'تاريخ المتابعة', value: f.followUp || null, error: errs.followUp, today: TODAY, onChange: (iso, e) => { if (!e) f.followUp = iso || ''; errs.followUp = e || undefined; draw(); } }),
          U.FieldShell({ id: 't-att', label: 'مرفقات' }, Button({ label: 'إضافة صورة أو ملف', icon: 'attach', disabled: true, attrs: { title: 'غير متاح في النموذج' } }))),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'هتتسجل باسمك (' + ME.name + ' · ' + ME.role + ') وتاريخ النهارده، والحالة هتبدأ «مفتوح».' })].filter(Boolean);
      modal.setBody(...fields);
      modal.setFooter(Button({ type: 'primary', label: 'إنشاء التذكرة', onClick: submit }), Button({ label: 'إلغاء', onClick: modal.close }));
    }
    function submit() {
      errs = TK.validateTicket(f); if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; draw(); return; }
      const c0 = f.type === 'customer' ? orderCtx(f.orderId.trim()) : null; if (c0) f.customer = c0.customer;
      const t = tstore.create(f, ME); log.append({ action: 'ticket.create', actor: ME.name, newValue: t.id });
      modal.close(); state.tfilter.status = 'open_any'; state.tpage = 1; notify('success', 'اتعملت التذكرة ' + t.id + ' ووصلت لدور «' + t.assigneeRole + '».'); openTicket(t.id);
    }
    modal = U.Modal({ title: 'تذكرة جديدة', body: [], footer: [] }); draw();
    const first = modal.el.querySelector('#t-title'); if (first) first.focus();
  }

  // ----- ticket drawer (Figma: Drawer / Ticket) -----
  let drawerApi = null;
  function openTicket(id) {
    const t0 = tstore.get(id); if (!t0) { notify('error', 'التذكرة ' + id + ' مش موجودة.'); return; }
    if (drawerApi) drawerApi.close();
    try { history.replaceState(null, '', '#tickets/' + id); } catch (e) { /* sandboxed */ }
    drawerApi = U.Drawer({ label: 'التذكرة ' + id, onClose: () => { drawerApi = null; try { history.replaceState(null, '', '#tickets'); } catch (e) { /* sandboxed */ } renderTickets(); } });
    const act = (fn, okMsg) => { try { fn(); log.append({ action: 'ticket.update', actor: ME.name, newValue: id }); if (okMsg) notify('success', okMsg); draw(); } catch (e) { notify('error', e.message); draw(); } };
    function moreMenu(t) {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
      const trig = IconButton({ icon: 'more', label: 'المزيد', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      const opts = [{ value: 'role', label: 'تغيير المسؤول (الدور)' }, { value: 'prio', label: 'تغيير الأولوية' }, { value: 'follow', label: 'تغيير تاريخ المتابعة' }, { value: 'copy', label: 'نسخ رابط التذكرة' }];
      if (TK.canClose(t, ME) && t.status !== 'closed') opts.push({ value: 'close', label: 'إغلاق نهائي', danger: true });
      const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (v) => { close();
        if (v === 'copy') { const link = location.href.split('#')[0] + '#tickets/' + id; try { navigator.clipboard.writeText(link).then(() => notify('success', 'اتنسخ رابط التذكرة.'), () => notify('error', 'تعذّر النسخ.')); } catch (e) { notify('error', 'تعذّر النسخ.'); } draw(); }
        if (v === 'close') confirmClose(t);
        if (v === 'role' || v === 'prio' || v === 'follow') editField(t, v); } }));
      trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
    }
    function editField(t, which) {
      const f = { assigneeRole: t.assigneeRole, priority: t.priority, followUp: t.followUp || '' }; let err = null; let m = null;
      const body = () => which === 'role' ? U.Select({ id: 'e-role', label: 'المسؤول (الدور)', required: true, options: roleOpts(), value: f.assigneeRole, onChange: (v) => { f.assigneeRole = v; m.setBody(body()); } })
        : which === 'prio' ? U.Select({ id: 'e-prio', label: 'الأولوية', required: true, options: TK.PRIORITIES.map(([v, l]) => ({ value: v, label: l })), value: f.priority, onChange: (v) => { f.priority = v; m.setBody(body()); } })
        : U.DateField({ id: 'e-follow', label: 'تاريخ المتابعة', value: f.followUp || null, error: err, today: TODAY, onChange: (iso, e) => { if (!e) f.followUp = iso || ''; err = e; m.setBody(body()); } });
      m = U.Modal({ title: which === 'role' ? 'تغيير المسؤول' : which === 'prio' ? 'تغيير الأولوية' : 'تغيير تاريخ المتابعة', body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: () => { if (err) return; m.close(); act(() => tstore.update(id, which === 'role' ? { assigneeRole: f.assigneeRole } : which === 'prio' ? { priority: f.priority } : { followUp: f.followUp || null }, ME), 'اتحفظ التغيير.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmResolve(t) {
      const f = { outcome: '', note: '' }; let errs = {}; let m = null;
      const body = () => [U.Select({ id: 'r-out', label: 'نتيجة الحل', required: true, options: TK.OUTCOMES.map((o) => ({ value: o, label: o })), value: f.outcome, error: errs.outcome, onChange: (v) => { f.outcome = v; errs = {}; m.setBody(...body()); } }),
        U.Textarea({ id: 'r-note', label: 'ملاحظة الإغلاق', value: f.note, placeholder: 'اكتب إيه اللي اتعمل بالظبط…', onInput: (v) => { f.note = v; } }),
        U.InlineNote({ children: 'هتتحول لـ «تم الحل» وصاحب التذكرة (' + t.createdBy.name + ') أو الأدمن يقدر يقفلها نهائي أو يرجّعها. لو مفيش رد خلال 3 أيام بتتقفل تلقائي.' })];
      m = U.Modal({ title: 'تم حل التذكرة؟', body: body(), footer: [Button({ type: 'primary', label: 'تأكيد الحل', onClick: () => { if (!f.outcome) { errs.outcome = 'اختار نتيجة الحل'; m.setBody(...body()); return; } m.close(); act(() => tstore.resolve(id, f, ME), 'التذكرة اتحوّلت لـ «تم الحل».'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmClose(t) {
      const m = U.Modal({ title: 'إغلاق نهائي', body: U.InlineNote({ kind: 'warning', children: 'هتتقفل التذكرة ' + t.id + ' نهائيًا. تقدر تعيد فتحها بعدين بسبب لو المشكلة رجعت.' }), footer: [Button({ type: 'danger', label: 'إغلاق نهائي', onClick: () => { m.close(); act(() => tstore.close(id, ME), 'التذكرة اتقفلت.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmReopen(t) {
      const f = { reason: '' }; let err = null; let m = null;
      const body = () => [U.Textarea({ id: 'o-reason', label: 'سبب إعادة الفتح', required: true, value: f.reason, error: err, placeholder: 'مثال: العميلة لسه ما استلمتش…', help: 'إجباري — بيظهر في الخط الزمني كحدث «أُعيد فتحه»', onInput: (v) => { f.reason = v; } }), U.InlineNote({ children: 'هترجع «مفتوح» لدور «' + t.assigneeRole + '» وهيوصله إشعار.' })];
      m = U.Modal({ title: 'إعادة فتح التذكرة', body: body(), footer: [Button({ type: 'brand', label: 'إعادة الفتح', onClick: () => { if (!f.reason.trim()) { err = 'اكتب سبب إعادة الفتح'; m.setBody(...body()); return; } m.close(); act(() => tstore.reopen(id, f, ME), 'التذكرة اتفتحت تاني ورجعت لدور «' + t.assigneeRole + '».'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function draw() {
      const t = tstore.get(id); const closed = t.status === 'closed'; const ctx = orderCtx(t.orderId);
      const canWork = TK.canWork(t, ME), canClose = TK.canClose(t, ME);
      const actions = [];
      if (closed) { if (TK.canReopen(t, ME)) actions.push(Button({ type: 'brand', size: 'sm', label: 'إعادة فتح', onClick: () => confirmReopen(t) })); }
      else if (canWork) {
        if (t.status !== 'resolved') actions.push(Button({ type: 'primary', size: 'sm', label: 'تم الحل', onClick: () => confirmResolve(t) }));
        if (t.status === 'open' || t.status === 'waiting') actions.push(Button({ size: 'sm', label: 'جاري العمل', onClick: () => act(() => tstore.setStatus(id, 'in_progress', ME)) }));
        if (t.status === 'open' || t.status === 'in_progress') actions.push(Button({ size: 'sm', label: 'بانتظار الرد', onClick: () => act(() => tstore.setStatus(id, 'waiting', ME)) }));
        if (t.status === 'resolved' && canClose) actions.push(Button({ type: 'primary', size: 'sm', label: 'إغلاق نهائي', onClick: () => confirmClose(t) }));
      }
      if (!closed && TK.canReopen(t, ME) && t.status === 'resolved' && !canWork) actions.push(Button({ type: 'brand', size: 'sm', label: 'إعادة فتح', onClick: () => confirmReopen(t) }));
      actions.push(moreMenu(t));
      const header = h('div', { class: 'drawer-h' },
        h('div', { class: 'row1' }, h('div', { class: 'ids' }, h('span', { class: 't-label', style: 'color:var(--color-text-secondary)' }, num(t.id)), h('span', { class: 'chip' }, typeLabel(t.type)), U.TicketStatus(t.status), U.PriorityTag(t.priority), t.reopenCount ? h('span', { class: 'chip' }, 'أُعيد فتحه ×' + t.reopenCount) : null), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => drawerApi.close() })),
        h('h2', { class: 't-h4' }, t.title),
        h('div', { class: 'meta t-small' }, h('span', null, 'المسؤول: ' + t.assigneeRole + ' · أنشأه ' + t.createdBy.role + ' (' + t.createdBy.name + ') · ' + D.formatDateLong(t.createdAt.slice(0, 10)) + (t.followUp ? ' · متابعة ' + D.formatDateLong(t.followUp) : '')), h('div', { class: 'actions' }, actions)));
      const ctxCard = t.type === 'internal' ? null : h('div', { class: 'ctx-card' },
        h('div', { class: 'head' }, h('span', { class: 't-label' }, t.type === 'customer' ? (ctx ? 'الأوردر ' + t.orderId + ' — ' + ctx.customer : 'الأوردر ' + t.orderId + ' — مش موجود في الأوردرات الحالية') : 'المورد ' + t.vendor + (t.orderId ? ' — الأوردر ' + t.orderId : '')),
          h('div', { class: 'links' }, t.orderId ? Button({ type: 'text', size: 'sm', label: 'فتح الأوردر', onClick: () => { drawerApi.close(); showOrders({ q: t.orderId }); } }) : null, (t.vendor || (ctx && ctx.vendors && ctx.vendors[0])) ? Button({ type: 'text', size: 'sm', label: 'فتح المورد', onClick: () => { drawerApi.close(); showOrders({ vendor: t.vendor || ctx.vendors[0] }); } }) : null, t.type === 'customer' ? Button({ type: 'text', size: 'sm', label: 'واتساب العميل', icon: 'whatsapp', disabled: !ctx, attrs: { title: 'بيفتح واتساب برقم العميل' } }) : null)),
        ctx ? h('div', { class: 'facts t-small' }, U.DelayBadge(ctx.delivery), h('span', null, num((ctx.vendors || []).join('، ') + ' · ' + ctx.status + ' · ' + ctx.confirm + ' · الإجمالي ' + D.formatMoney(ctx.total) + ' · العمر ' + ctx.ageDays + ' يوم'))) : (t.reason ? h('div', { class: 'facts t-small' }, h('span', null, 'السبب: ' + t.reason)) : null));
      const items = tstore.events(id);
      const tl = h('div', { class: 'tl' }, h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'آخر التحديثات'),
        items.map((e) => e.kind === 'message' ? U.TimelineMessage({ author: e.author.name, role: e.author.role, time: fmtTime(e.at), text: e.text }) : U.TimelineEvent({ text: e.text, time: fmtTime(e.at) })));
      const body = h('div', { class: 'drawer-b' }, closed ? U.InlineNote({ kind: 'warning', children: 'مغلق بواسطة ' + t.closedBy + ' · ' + D.formatDateLong(t.closedAt.slice(0, 10)) + (t.resolution ? ' · «' + t.resolution.outcome + '»' : '') + ' — لو المشكلة رجعت اضغط «إعادة فتح».' }) : null, ctxCard, tl);
      const reply = closed ? null : U.ReplyBox({ onSend: (text) => act(() => tstore.reply(id, text, ME)) });
      drawerApi.set(header, body, reply);
      const b = drawerApi.el.querySelector('.drawer-b'); if (b) b.scrollTop = b.scrollHeight;
    }
    draw(); const c = drawerApi.el.querySelector('.icon-btn'); if (c) c.focus();
  }

  // ---------- Vendors / المبتكرين (Figma: المبتكرين — Desktop 1440; Modal / Add vendor; Drawer / Vendor Tab=Info/Orders) ----------
  const VD = window.IbtekrVendors;
  const CATS = VD.CATEGORIES;
  // Phase 3 (decision 1): the registry is IBVendors.store — the sync's vendors table completed by the team, write-through — and
  // the prototype's seed is gone. Without the adapter (a bare prototype page) an empty in-memory store keeps the page alive.
  const vstore = window.IBVendors ? window.IBVendors.store : VD.createStore();
  const VMSG = (window.IBVendors && window.IBVendors.MESSAGES) || {};
  // the store announces ib:vendors: a load (state), a local change, a write the server took, or a refused write ({ reason } —
  // the adapter already put the old value back; the page says why) → the list and the open drawer redraw
  let vredraw = null; // the open drawer's draw()
  document.addEventListener('ib:vendors', (e) => {
    const d = (e && e.detail) || {};
    if (d.state === 'loading') return;
    if (d.reason) vnote = { kind: 'error', text: VMSG[d.reason] || 'التغيير ما اتحفظش.' };
    // phase 3.3 (decision 5): the row was taken and pushed to the site — a failed push (the fields wait in push_pending) or a member who
    // may not push says so; ok / skipped (no store, the push gate, a placeholder name) add nothing to the save's own note
    if (d.push && d.push.result === 'error') vnote = { kind: 'warning', text: d.push.reason === 'woo_refused' ? VMSG.push_refused : d.push.pending === false ? VMSG.push_lost : VMSG.push_failed };
    else if (d.push && d.push.result === 'skipped' && d.push.reason === 'no_permission') vnote = { kind: 'warning', text: VMSG.push_forbidden };
    if (state.page === 'vendors') renderVendors(true);
    if (vredraw) vredraw();
  });
  // the orders behind the stats changed (IBOrders: a load, a Realtime burst) — not while a menu or the filter is open
  document.addEventListener('ib:notify', () => { if (state.page === 'vendors' && !document.querySelector('.pop-anchor .menu, .pop-anchor [role=dialog]')) renderVendors(true); if (vredraw) vredraw(); });
  state.vfilter = { status: 'active', category: 'all', balance: 'all', contract: 'all', late: false, tickets: false, q: '' }; state.vsort = 'open'; state.vpage = 1; const VPAGE = 9;
  let vnote = null; const vnotify = (kind, text) => { vnote = { kind, text }; renderVendors(); };
  // live stats per vendor (decision 4 / 5): IBVendors.stats — the orders behind each maker with his shares (the website's rate on
  // each line), his balance in this phase (opening + completed shares); deposits / transport / tickets come with phases 4 and 7
  function vendorStats() { return window.IBVendors ? window.IBVendors.stats() : {}; }
  // the real clock for the vendors section (review B of phase 3): the agreement's «سارية من», the contract expiry, «آخر أوردر», the
  // contract statuses and the filter all read it; the prototype's fixed TODAY stays for the accounts pages until their phase
  const VTODAY = () => (window.IBVendors && window.IBVendors.today ? window.IBVendors.today() : TODAY);
  function vendorTasks() { return vstore.all().filter((v) => v.status === 'active').map((v) => ({ v, st: VD.contractStatus(v, VTODAY()) })).filter((x) => x.st === 'expiring' || x.st === 'expired').map((x) => ({ id: x.v.id, name: x.v.name, prio: x.st === 'expired' ? 'urgent' : 'high', sub: x.st === 'expired' ? 'العقد منتهي' : 'العقد بينتهي ' + D.formatDateLong(x.v.contract.expires) })); }
  const ageLabel = (a) => (a == null ? '—' : a === 0 ? 'اليوم' : a === 1 ? 'أمس' : D.formatDateLong(R.orderDate({ ageDays: a }, VTODAY())));
  function copyText(text, label) { const done = () => vnotify('success', 'اتنسخ ' + label + '.'); const fail = () => vnotify('error', 'تعذّر النسخ من المتصفح.'); try { navigator.clipboard.writeText(String(text)).then(done, fail); } catch (e) { fail(); } }

  // phase 3.2, decision 5 (c): the search also finds a maker by the names and aliases of the brands he holds or held (IBVendors
  // namesOf); the other filters stay VD.filterVendors'. The prototype's store (a bare page) has no brands: the base list alone.
  function vfilter(all, stats, f) {
    const base = VD.filterVendors(all, stats, f, VTODAY()); const q = VD.norm(f.q || '');
    if (!q || !vstore.namesOf) return base;
    const seen = new Set(base.map((v) => v.id)); const more = all.filter((v) => !seen.has(v.id) && vstore.namesOf(v.id).some((n) => VD.norm(n).includes(q)));
    return more.length ? base.concat(VD.filterVendors(more, stats, Object.assign({}, f, { q: '' }), VTODAY())) : base;
  }
  // decision 5 (d): under the maker's name, the brands he holds whose name is not his (after a transfer) — a grey line, text only
  const brandLine = (v) => { const names = (v.brands || []).map((b) => b.name).filter((n) => VD.norm(n) !== VD.norm(v.name)); return names.length ? h('span', { class: 't-small brand-line', 'data-brands': '' }, names.join(' · ')) : null; };
  function VendorsPageView() {
    const all = vstore.all(); const stats = vendorStats(); const sum = VD.summary(all, stats);
    // «التفاصيل» on the 4 KPIs (owner, 22 Oct) — rows from VD.summaryDetails, a row opens the vendor file.
    const vdet = (kind) => { const d = VD.summaryDetails(all, stats); const money = (x) => D.formatMoney(x); const vstat = (v) => stats[v.id] || {};
      const open = (list) => (i) => openVendor(list[i].id);
      if (kind === 'active') { const l = d.active.slice().sort((a, b) => (vstat(b).open || 0) - (vstat(a).open || 0)); return { title: 'المبتكرين النشطين — ' + l.length, sub: 'من ' + sum.total + ' مبتكر مسجّل · مرتبين بعدد الأوردرات المفتوحة · اضغط على أي صف يفتح ملفه', summary: [{ label: 'نشط', value: String(sum.active) }, { label: 'غير نشط', value: String(sum.total - sum.active) }, { label: 'أوردرات مفتوحة', value: String(l.reduce((x, v) => x + (vstat(v).open || 0), 0)) }], headers: ['المبتكر', 'الفئة', 'النسبة', 'أوردرات مفتوحة', 'قابلة للتأخير', 'مستحقاته', 'آخر أوردر'], rows: l.map((v) => [v.name, v.category || '—', v.rate == null ? '—' : v.rate + '%', String(vstat(v).open || 0), String(vstat(v).late || 0), money(vstat(v).balance || 0), ageLabel(vstat(v).lastAge)]), onRow: open(l), source: 'جدول المبتكرين + الأوردرات لايف' }; }
      if (kind === 'delay') { const l = d.delay; return { title: 'مبتكرين عندهم أوردرات قابلة للتأخير / متأخرة — ' + l.length, sub: 'قاعدة 9 / 11 يوم على الأوردرات المفتوحة · نفس مصدر إشعار «موردين متأخرين»', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'قابل للتأخير', value: String(l.reduce((x, r) => x + r.risk, 0)) + ' أوردر' }, { label: 'متأخر', value: String(l.reduce((x, r) => x + r.late, 0)) + ' أوردر' }], headers: ['المبتكر', 'قابل للتأخير', 'متأخر', 'أوردرات مفتوحة', 'أقدم أوردر مفتوح', 'الموبايل'], rows: l.map((r) => { const v = all.find((x) => x.id === r.id); return [r.name, String(r.risk), String(r.late), String(r.open), r.oldest + ' يوم', v && v.phone || '—']; }), total: ['الإجمالي', String(l.reduce((x, r) => x + r.risk, 0)), String(l.reduce((x, r) => x + r.late, 0)), String(l.reduce((x, r) => x + r.open, 0)), '—', '—'], onRow: (i) => openVendorLate(l[i].name, 'all'), note: 'قابل للتأخير = عمر الأوردر 9–11 يوم · متأخر = أكتر من 11 يوم (مدة التسليم 12–15 يوم).', source: 'الأوردرات لايف' }; }
      if (kind === 'due') { const l = d.due; return { title: 'مستحقات المبتكرين — ' + money(sum.due) + ' ج.م', sub: l.length + ' مبتكر ليهم رصيد لصالحهم', summary: [{ label: 'الإجمالي', value: money(sum.due) + ' ج.م' }, { label: 'مبتكرين', value: String(l.length) }, { label: 'أكبر رصيد', value: l.length ? l[0].name + ' — ' + money(l[0].balance) : '—' }], headers: ['المبتكر', 'الرصيد (له)', 'من الإجمالي'], rows: l.map((r) => [r.name, money(r.balance), (sum.due ? Math.round(r.balance / sum.due * 100) : 0) + '%']), total: ['الإجمالي', money(l.reduce((x, r) => x + r.balance, 0)), '100%'], onRow: open(l), source: 'الأوردرات المكتملة من 1 أكتوبر بنسبة الموقع على كل سطر (الافتتاحي والعرابين من مرحلة الحسابات)' }; }
      const l = d.negative; return { title: 'مبتكرين عندهم رصيد سالب (عرابين / مواصلات) — ' + l.length, sub: 'عرابين اتدفعت لهم قبل ما الأوردرات تكتمل — بتتخصم من مستحقاتهم', summary: [{ label: 'إجمالي العرابين', value: money(sum.negativeTotal) + ' ج.م' }, { label: 'مبتكرين', value: String(l.length) }], headers: ['المبتكر', 'العربون', 'المواصلات', 'الرصيد (عليه)', 'أوردرات مفتوحة'], rows: l.map((r) => [r.name, money(r.deposits), money((vendorsNow().find((x) => x.name === r.name) || {}).transport || 0), money(r.balance), String((stats[r.id] || {}).open || 0)]), total: ['الإجمالي', money(l.reduce((x, r) => x + r.deposits, 0)), money(l.reduce((x, r) => x + ((vendorsNow().find((y) => y.name === r.name) || {}).transport || 0), 0)), money(l.reduce((x, r) => x + r.balance, 0)), String(l.reduce((x, r) => x + ((stats[r.id] || {}).open || 0), 0))], onRow: open(l), source: 'العرابين والمواصلات بيتسجلوا من مرحلة الحسابات' };
    };
    const list = VD.sortVendors(vfilter(all, stats, state.vfilter), stats, state.vsort);
    const pages = Math.max(1, Math.ceil(list.length / VPAGE)); if (state.vpage > pages) state.vpage = pages;
    const slice = list.slice((state.vpage - 1) * VPAGE, state.vpage * VPAGE);
    const setF = (k, v) => { state.vfilter[k] = v; state.vpage = 1; renderVendors(); };
    const sel = (label, options, value, key) => { const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' }); const cur = options.find((o) => o.value === value);
      const btn = h('button', { type: 'button', class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, style: 'width:auto;min-width:140px' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, label + ': ' + (cur ? cur.label : '—')));
      const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options, value, onSelect: (v) => { close(); setF(key, v); } })); btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap; };
    const search = h('input', { type: 'search', class: 'input', placeholder: 'ابحث بالاسم أو الهاتف أو الاسم البديل أو البراند', 'aria-label': 'بحث في المبتكرين', value: state.vfilter.q, style: 'width:320px;max-width:100%' });
    search.addEventListener('input', () => { state.vfilter.q = search.value; state.vpage = 1; renderVendors(true); });
    const check = (key, label) => h('label', { class: 'check', style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, (() => { const c = h('input', { type: 'checkbox', checked: state.vfilter[key] }); c.addEventListener('change', () => setF(key, c.checked)); return c; })(), label);
    // «فلتر» + «ترتيب حسب» (owner, 22 Oct) — same pattern as the orders page header; active filters show as removable chips under the header.
    const VF = { status: [['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط'], ['all', 'الكل']], balance: [['all', 'الكل'], ['due', 'ليه رصيد'], ['negative', 'عليه (عربون / مواصلات)'], ['zero', 'متصفّي']], contract: [['all', 'الكل'], ['uploaded', 'مرفوع وساري'], ['expiring', 'بينتهي خلال 30 يوم'], ['expired', 'منتهي'], ['missing', 'غير مرفوع']] };
    const lab = (k, v) => (VF[k].find((x) => x[0] === v) || [, v])[1];
    function vFilterBtn() {
      const K = window.IBKit; const n = VD.activeFilterCount(state.vfilter);
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
      const btn = Button({ label: 'فلتر', icon: 'filter', attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-vfilter': '' } }); if (n) btn.append(h('span', { class: 'fcount' }, num(String(n))));
      const pop = U.popover(wrap, btn, (close) => { const d = Object.assign({}, state.vfilter); let el = null;
        const radio = (k, label) => K.Radios({ label, name: 'vf-' + k, value: d[k], options: VF[k].map(([value, l]) => ({ value, label: l })), onChange: (v) => { d[k] = v; draw(); } });
        const draw = () => { const body = [radio('status', 'الحالة'),
          h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'الفئة'), h('div', { class: 'chips' }, [['all', 'الكل']].concat(CATS.map((c) => [c, c])).map(([v, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(d.category === v), onClick: () => { d.category = v; draw(); } }, l)))),
          radio('balance', 'الرصيد'), radio('contract', 'العقد'),
          h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'المتابعة'), K.Checkbox({ label: 'عنده أوردرات قابلة للتأخير / متأخرة', checked: d.late, onChange: (v) => { d.late = v; draw(); } }), K.Checkbox({ label: 'عليه تذاكر مفتوحة', checked: d.tickets, onChange: (v) => { d.tickets = v; draw(); } }))];
          const preview = vfilter(all, stats, Object.assign({}, d, { q: state.vfilter.q })).length;
          el.replaceChildren(h('div', { class: 'vf-h' }, h('b', { class: 't-h5' }, 'فلتر المبتكرين'), IconButton({ icon: 'close', label: 'إغلاق', onClick: close })), h('div', { class: 'vf-b' }, ...body),
            h('div', { class: 'vf-f' }, Button({ type: 'primary', label: 'عرض ' + preview + ' مبتكر', attrs: { 'data-vapply': '' }, onClick: () => { Object.assign(state.vfilter, d, { negative: false }); state.vpage = 1; close(); renderVendors(); } }), Button({ type: 'text', label: 'مسح الكل', onClick: () => { Object.assign(d, { status: 'active', category: 'all', balance: 'all', contract: 'all', late: false, tickets: false }); draw(); } }))); };
        el = h('div', { class: 'menu vfilter-pop', role: 'dialog', 'aria-label': 'فلتر المبتكرين', 'data-focus': 'no' }); draw(); return el; });
      btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
    }
    function vSortBtn() {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const cur = VD.VENDOR_SORTS.find((x) => x.value === state.vsort);
      const btn = h('button', { type: 'button', class: 'sort-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-vsort': '' }, Icon('chevD', 'sm'), h('span', null, 'ترتيب حسب: ' + cur.label), Icon('sliders', 'sm'));
      const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: VD.VENDOR_SORTS.map((x) => ({ value: x.value, label: x.label })), value: state.vsort, onSelect: (v) => { close(); state.vsort = v; state.vpage = 1; renderVendors(); } }));
      btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
    }
    function vChips() {
      const f = state.vfilter; const chips = [];
      const chip = (text, reset) => chips.push(h('button', { type: 'button', class: 'chip fchip', 'aria-label': 'شيل الفلتر ' + text, onClick: () => { reset(); state.vpage = 1; renderVendors(); } }, text, Icon('close', 'sm')));
      if (f.status !== 'active') chip('الحالة: ' + lab('status', f.status), () => { f.status = 'active'; });
      if (f.category !== 'all') chip('الفئة: ' + f.category, () => { f.category = 'all'; });
      if (f.balance !== 'all') chip('الرصيد: ' + lab('balance', f.balance), () => { f.balance = 'all'; });
      if (f.contract !== 'all') chip('العقد: ' + lab('contract', f.contract), () => { f.contract = 'all'; });
      if (f.late) chip('عنده تأخير', () => { f.late = false; });
      if (f.tickets) chip('عليه تذاكر', () => { f.tickets = false; });
      if (chips.length > 1) chips.push(Button({ type: 'text', size: 'sm', label: 'مسح الكل', onClick: () => { Object.assign(f, { status: 'active', category: 'all', balance: 'all', contract: 'all', late: false, tickets: false }); state.vpage = 1; renderVendors(); } }));
      return chips.length ? h('div', { class: 'fchips' }, ...chips) : null;
    }
    const headers = ['المبتكر', 'الحالة', 'النسبة', 'أوردرات مفتوحة', 'قابلة للتأخير', 'العربون', 'المواصلات', 'مستحقاته (من 1 أكتوبر)', 'آخر أوردر', 'تذاكر مفتوحة'];
    const later = (phase) => h('span', { class: 't-small', style: 'color:var(--color-text-secondary)', title: 'من مرحلة ' + phase }, '—'); // decision 4: deposits / transport with phase 4, tickets with phase 7
    const cells = (v) => { const st = stats[v.id]; return [h('span', { class: 'vendor-cell' }, U.VendorLogo({ letter: v.logoLetter, size: 'sm' }), h('span', { class: 'vnames' }, h('span', { class: 't-label' }, v.name), brandLine(v))), U.VendorStatus(v.status), v.rate == null ? '—' : num(v.rate + '%'), num(String(st.open)), num(String(st.late)), later(4), later(4), h('span', { class: st.balance < 0 ? 'bal-neg' : '' }, num(D.formatMoney(st.balance))), num(ageLabel(st.lastAge)), later(7)]; }; // مستحقاته = الافتتاحي + حقه من الأوردرات المكتملة
    const table = h('div', { class: 'scroll-x' }, h('table', { class: 'tickets-table' }, h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, slice.map((v) => { const tr = h('tr', { 'data-id': v.id, tabindex: '0', role: 'button', 'aria-label': 'فتح ملف ' + v.name }, cells(v).map((c) => h('td', null, c))); tr.addEventListener('click', () => openVendor(v.id)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVendor(v.id); } }); return tr; }))));
    const cards = h('div', { class: 'kv-list' }, slice.map((v) => { const cs = cells(v); const c = h('div', { class: 'card list-card', tabindex: '0', role: 'button' }, h('div', { class: 'title' }, cs[0]), headers.slice(1).map((k, i) => h('div', { class: 'kv' }, h('span', { class: 't-small' }, k), h('span', { class: 't-body' }, cs[i + 1])))); c.addEventListener('click', () => openVendor(v.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openVendor(v.id); }); return c; }));
    const pager = h('div', { class: 'pager' }, h('div', { class: 'pages' }, Button({ type: 'text', size: 'sm', label: 'السابق', disabled: state.vpage <= 1, onClick: () => { state.vpage--; renderVendors(); } }), Array.from({ length: pages }, (_, i) => Button({ type: i + 1 === state.vpage ? 'primary' : 'text', size: 'sm', label: String(i + 1), onClick: () => { state.vpage = i + 1; renderVendors(); } })), Button({ type: 'text', size: 'sm', label: 'التالي', disabled: state.vpage >= pages, onClick: () => { state.vpage++; renderVendors(); } })),
      h('span', { class: 't-small' }, num(list.length ? 'عرض ' + ((state.vpage - 1) * VPAGE + 1) + '–' + Math.min(list.length, state.vpage * VPAGE) + ' من ' + list.length : '')));
    return [
      h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'المبتكرين'), h('p', { class: 't-small' }, 'ملف كل مبتكر: البيانات والعقد والحساب البنكي، وأوردراته ورصيده — المبتكر هو المرجع الأساسي للأوردرات والنسب')),
        h('div', { class: 'actions' }, vFilterBtn(), vSortBtn(), window.IBDataActions.Menu(window.IBDataActions.PAGES.vendors), Button({ type: 'brand', icon: 'plus', label: 'إضافة مبتكر', disabled: !vstore.canEdit(), onClick: () => openAddVendor() }))),
      h('div', { class: 'toolbar vtoolbar' }, search, vChips(), h('span', { class: 'grow' }), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, num(list.length + ' مبتكر · ' + (VD.VENDOR_SORTS.find((x) => x.value === state.vsort) || {}).label))),
      vnote ? (() => { const n = vnote; vnote = null; const el = U.InlineNote({ kind: n.kind, children: n.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => el.remove() }) }); return el; })() : null,
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'مبتكرين نشطين', value: String(sum.active), unit: 'مبتكر', compare: 'off', note: 'من ' + sum.total + ' مبتكر مسجّل', details: () => vdet('active') }),
        U.KpiTile({ label: 'عندهم أوردرات قابلة للتأخير', value: String(sum.withDelay), unit: 'مبتكرين', compare: sum.withDelay ? 'negative' : 'off', delta: { text: 'متابعة', caption: 'نفس مصدر إشعار «موردين متأخرين»' }, note: 'قاعدة 9 / 11 يوم على الأوردرات المفتوحة', details: () => vdet('delay') }),
        U.KpiTile({ label: 'إجمالي مستحقات المبتكرين', value: D.formatMoney(sum.due), unit: 'ج.م', compare: 'off', note: 'من الأوردرات المكتملة من 1 أكتوبر · الافتتاحي والعرابين من مرحلة 4', details: () => vdet('due') }),
        U.KpiTile({ label: 'عندهم رصيد سالب (عرابين)', value: String(sum.negative), unit: 'مبتكرين', compare: 'off', note: 'العرابين والمواصلات بيتسجلوا من مرحلة الحسابات', details: () => vdet('negative') }),
        U.KpiTile({ label: 'مواصلات المبتكرين', value: '—', compare: 'off', note: 'بتتسجل من مرحلة الحسابات (4)' })),
      TableCard({ title: 'المبتكرين', count: list.length + ' مبتكر · مرتبين بعدد الأوردرات المفتوحة', body: list.length === 0 ? U.EmptyState('مفيش مبتكر بالاسم ده', 'جرّب اسم بديل أو رقم الهاتف، أو اضغط «إضافة مبتكر» لو جديد.') : [tableOrList(() => table, () => cards), pager] }),
      h('p', { class: 'source' }, 'المصدر: جدول المبتكرين (متاجر الموقع من المزامنة + اللي الفريق بيكمّله) — الأسماء البديلة لتوحيد الأوردرات والشيت · المستحقات من الأوردرات المكتملة من 1 أكتوبر بنسبة الموقع على كل سطر · الأوردرات والتأخير لايف من الأوردرات')];
  }
  function renderVendors(keepFocus) {
    U.closePopover(); const main = document.getElementById('vendors'); if (!main) return; const sc = window.scrollY; const had = keepFocus && document.activeElement && document.activeElement.type === 'search';
    main.replaceChildren(...VendorsPageView().filter(Boolean)); window.scrollTo(0, sc); if (had) { const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }

  // ----- login + payout fields (owner 26 Oct, phase 3.1 decision 9): shared by «إضافة مبتكر» and the drawer's «بيانات الدخول» popup -----
  const fsec = (title, sub) => h('div', { class: 'form-sec' }, h('h3', { class: 't-label' }, title), sub ? h('p', { class: 't-small help' }, sub) : null);
  function loginFields(f, errs, redraw, px, opts = {}) {
    const rules = (pw) => { const iss = VD.passwordIssues(pw); return h('ul', { id: px + '-pw-rules', class: 'pw-rules', 'aria-live': 'polite' }, [['8 حروف على الأقل', '8 حروف على الأقل'], ['حرف إنجليزي', 'حرف إنجليزي'], ['رقم', 'رقم واحد على الأقل'], ['من غير مسافات', 'من غير مسافات']].map(([k, l]) => h('li', { class: iss.includes(k) ? '' : 'ok' }, l))); };
    const pwBox = () => { const show = !!f.showPw;
      const trail = h('span', { class: 'pw-acts' }, IconButton({ icon: show ? 'eyeoff' : 'eye', label: show ? 'إخفاء الباسورد' : 'إظهار الباسورد', onClick: () => { f.showPw = !show; redraw(); } }), IconButton({ icon: 'copy', label: 'نسخ الباسورد', onClick: () => copyText(f.password || '', 'الباسورد') }));
      return [U.TextInput({ id: px + '-pw', label: 'الباسورد المؤقت', required: true, type: show ? 'text' : 'password', autocomplete: 'new-password', dir: 'ltr', value: f.password, error: errs.password, trail, onInput: (x) => { f.password = x; const el = document.getElementById(px + '-pw-rules'); if (el) el.replaceWith(rules(x)); } }),
        rules(f.password), Button({ size: 'sm', icon: 'sparkle', label: 'اقترح باسورد قوي', attrs: { 'data-genpw': '' }, onClick: () => { f.password = VD.genPassword(); f.showPw = true; redraw(); } })]; };
    return [h('div', { class: 'row cols2' },
        U.TextInput({ id: px + '-user', label: 'اسم المستخدم', required: true, dir: 'ltr', autocomplete: 'off', value: f.username, error: errs.username, placeholder: 'wood.rope', help: 'للدخول على بوابة المبتكر — حروف إنجليزي صغيرة وأرقام و . _', onInput: (x) => { f.username = x.trim().toLowerCase(); f.userTouched = true; } }),
        U.TextInput({ id: px + '-email', label: 'الإيميل', required: true, dir: 'ltr', inputmode: 'email', autocomplete: 'off', value: f.email, error: errs.email, placeholder: 'name@example.com', help: 'لاسترجاع الباسورد من بوابة المبتكر', onInput: (x) => { f.email = x; } })),
      // owner 26 Oct (evening): no «ابعتله لينك يعمل الباسورد بنفسه» — the temporary password is the only way (decision 5 withdrawn)
      opts.noPassword ? null : pwBox(),
      opts.noPassword ? null : U.InlineNote({ children: 'الباسورد المؤقت بيتحفظ مشفّر عشان الدعم: الأدمن ومتابعة المبتكرين يقدروا يظهروه من ملف المبتكر (وكل إظهار بيتسجل). لما المبتكر يغيّره بنفسه مش بيتحفظ.' })].flat().filter(Boolean);
  }
  function bankFields(f, errs, redraw, px) {
    const m = f.method; const t = (id, label, key, o = {}) => U.TextInput(Object.assign({ id: px + '-' + id, label, value: f[key], error: errs[key], onInput: (x) => { f[key] = x; } }, o));
    return [U.Select({ id: px + '-method', label: 'طريقة التحويل', required: true, options: VD.PAY_METHODS.map(([k, l]) => ({ value: k, label: l })), value: m, error: errs.method, placeholder: 'اختار الطريقة', onChange: (x) => { f.method = x; redraw(); } }),
      m && m !== 'cash' ? t('holder', 'اسم صاحب الحساب', 'holder', { required: true, help: 'زي ما هو مكتوب في البنك / المحفظة بالظبط' }) : null,
      m === 'bank' ? h('div', { class: 'row cols2' }, t('bank', 'البنك', 'bankName', { required: true, placeholder: 'البنك الأهلي المصري' }), t('iban', 'IBAN / رقم الحساب', 'iban', { required: true, dir: 'ltr', placeholder: 'EG00 0000 0000 …', help: 'EG + 27 رقم، أو رقم الحساب' })) : null,
      m === 'instapay' ? t('wallet', 'رقم الموبايل أو عنوان إنستاباي', 'wallet', { required: true, dir: 'ltr', placeholder: '01xxxxxxxxx أو name@instapay' }) : null,
      m === 'wallet' ? t('wallet', 'رقم المحفظة', 'wallet', { required: true, dir: 'ltr', inputmode: 'tel', placeholder: '01xxxxxxxxx' }) : null,
      m === 'cash' ? U.InlineNote({ children: 'التحويل نقدي عند التسليم — مفيش بيانات بنكية مطلوبة.' }) : null].filter(Boolean);
  }

  // ----- add vendor modal (Figma: Modal / Add vendor; the owner's prototype of 26 Oct — phase 3.1 decision 9) -----
  // Three sections for a new maker: the basics, «بيانات الدخول» (username, e-mail and the temporary password — required; the invite
  // link was withdrawn by the owner on 26 Oct) and «الحساب البنكي» (when the caller sees bank rows; required when it shows — no IBMakerDefaults).
  // The edit popup of an existing maker (openAddVendor(existing)) is unchanged. A name or alias already in the registry is refused
  // (decision 2: every Dokan store is already here) and the file is one click away.
  function openAddVendor(existing) {
    const f = existing ? { name: existing.name, legalName: existing.legalName || '', category: existing.category, phone: existing.phone, altPhone: existing.altPhone || '', email: existing.email || '', address: existing.address || '', instagram: existing.instagram || '', storeUrl: existing.storeUrl || '', rate: String(existing.rate), leadDays: String(existing.leadDays), status: existing.status, aliases: existing.aliases.join('، '), depositPolicy: existing.depositPolicy || '', notes: existing.notes || '' }
      : { name: '', legalName: '', category: '', phone: '', altPhone: '', email: '', address: '', instagram: '', storeUrl: '', rate: '40', leadDays: '7', status: 'active', aliases: '', depositPolicy: '', notes: '', username: '', pwMode: 'temp', password: '', method: '', bankName: '', holder: '', iban: '', wallet: '' };
    const canBank = vstore.canBank(); const bankReq = true;
    let errs = {}; let modal = null; let dup = null;
    const txt = (id, label, key, opts = {}) => U.TextInput(Object.assign({ id, label, value: f[key], error: errs[key], onInput: (v) => { f[key] = v; } }, opts));
    const two = (a, b) => h('div', { class: 'row cols2' }, a, b);
    const statusOpts = VD.STATUSES.map(([value, label]) => ({ value, label }));
    function draw() {
      const fields = [
        h('div', { class: 'row cols2' }, h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:16px;min-width:0' }, txt('v-name', 'اسم المبتكر (المعروض)', 'name', { required: true, maxlength: 80, onInput: (v) => { f.name = v; if (!existing && !f.userTouched) { f.username = VD.suggestUsername(v, (u) => vstore.usernameTaken(u)); const el = document.getElementById('v-login-user'); if (el) el.value = f.username; } } }), U.Select({ id: 'v-cat', label: 'الفئة الأساسية', required: true, options: CATS.map((c) => ({ value: c, label: c })), value: f.category, error: errs.category, placeholder: 'اختار الفئة', onChange: (v) => { f.category = v; draw(); } })),
          h('div', { style: 'flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px' }, U.VendorLogo({ letter: f.name || '؟', size: 'lg' }), h('span', { class: 't-small', style: 'color:var(--color-text-secondary);text-align:center' }, 'الصورة بتيجي من متجره على الموقع'))), // phase 3.3 (decision 1): the logo is the site's gravatar, read-only — no upload here
        two(txt('v-phone', 'الهاتف (واتساب)', 'phone', { required: true, inputmode: 'tel', placeholder: '01xxxxxxxxx' }), existing ? txt('v-alt', 'هاتف بديل', 'altPhone', { inputmode: 'tel' }) : txt('v-rate', 'نسبة إبتكر', 'rate', { required: true, inputmode: 'decimal', suffix: '%', help: 'تنطبق على الأوردرات الجديدة من تاريخ الإضافة' })),
        two(txt('v-lead', 'مدة التجهيز (أيام)', 'leadDays', { required: true, inputmode: 'numeric', help: 'بتغذي قاعدة التأخير بدل الرقم الثابت' }), U.Select({ id: 'v-status', label: 'الحالة', required: true, options: statusOpts, value: f.status, error: errs.status, onChange: (v) => { f.status = v; draw(); } })),
        txt('v-aliases', 'أسماء بديلة', 'aliases', { placeholder: 'W&R، WOOD & ROPE', help: 'لتوحيد الأسماء من الأوردرات والشيت — افصل بفاصلة' }),
        existing ? null : [fsec('بيانات الدخول', 'المبتكر بيدخل بيها على بوابته يتابع أوردراته وحسابه'), ...loginFields(f, errs, draw, 'v-login')],
        existing ? null : [fsec('الحساب البنكي', 'عشان نحوّل له مستحقاته'), ...(canBank ? bankFields(f, errs, draw, 'v-bank') : [U.InlineNote({ children: 'البيانات البنكية بيكمّلها قسم الحسابات بس — هتظهر «ناقص» في ملف المبتكر لحد ما تتكمّل.' })])],
        existing ? two(txt('v-legal', 'الاسم التجاري / القانوني', 'legalName'), txt('v-email', 'الإيميل', 'email', { inputmode: 'email' })) : null,
        existing ? two(txt('v-addr', 'العنوان (الاستلام)', 'address'), txt('v-ig', 'إنستجرام', 'instagram', { placeholder: '@name' })) : null,
        existing ? two(txt('v-url', 'صفحة المتجر', 'storeUrl'), txt('v-dep', 'سياسة العربون', 'depositPolicy')) : null,
        existing ? U.Textarea({ id: 'v-notes', label: 'ملاحظات الاتفاق', value: f.notes, onInput: (v) => { f.notes = v; } }) : null,
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form, action: dup ? Button({ type: 'text', size: 'sm', label: 'افتح ملفه', attrs: { 'data-open-dup': '' }, onClick: () => { const d = dup; modal.close(); openVendor(d.id); } }) : null }) : U.InlineNote({ children: existing ? 'التعديل بيتسجل في سجل النشاط باسمك.' : 'هيتسجل بـ Vendor ID ثابت، والأوردرات هتربط بيه مش بالاسم.' })].flat().filter(Boolean);
      modal.setBody(...fields); modal.setFooter(Button({ type: 'primary', label: existing ? 'حفظ التعديلات' : 'إضافة المبتكر', onClick: submit }), Button({ label: 'إلغاء', onClick: modal.close }));
    }
    function submit() {
      errs = VD.validateVendor(f); dup = null;
      if (!existing) {
        Object.assign(errs, VD.validateLogin(f));
        if (!errs.username && vstore.usernameTaken(f.username)) errs.username = 'اسم المستخدم ده مستخدم قبل كده — جرّب ' + VD.suggestUsername(f.username, (u) => vstore.usernameTaken(u));
        if (canBank && (bankReq || f.method)) Object.assign(errs, VD.validateBank(f));
        if (!errs.name) { dup = vstore.findByName(f.name) || VD.parseAliases(f.aliases).map((a) => vstore.findByName(a)).find(Boolean) || null; if (dup) errs.name = 'المبتكر ده موجود (' + dup.name + ') — افتح ملفه'; }
      }
      if (Object.keys(errs).length) { errs._form = dup ? 'المبتكر ده موجود — افتح ملفه' : 'راجع الحقول المعلّمة بالأحمر'; draw(); const bad = modal.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
      if (existing) { try { vstore.update(existing.id, f, vstore.actor()); log.append({ action: 'vendor.update', actor: ME.name, newValue: existing.id }); modal.close(); vnotify('success', 'اتحفظت بيانات ' + f.name + '.'); if (vdrawer) openVendor(existing.id); } catch (e) { errs._form = e.message; draw(); } return; }
      // decision 10: the store's create runs the sequence (vendor → rate → login → password → bank); a step refused after the vendor's
      // insert leaves the vendor and is named here — the password travels inside `login` only and is dropped once the call is done
      const input = { name: f.name, legalName: f.legalName, category: f.category, phone: f.phone, altPhone: f.altPhone, email: f.email, address: f.address, instagram: f.instagram, storeUrl: f.storeUrl, rate: f.rate, leadDays: f.leadDays, status: f.status, aliases: f.aliases, depositPolicy: f.depositPolicy, notes: f.notes,
        login: { username: f.username, password: f.password }, bank: canBank && f.method ? { method: f.method, bankName: f.bankName, holder: f.holder, iban: f.iban, wallet: f.wallet } : null };
      const STEP = { rate: 'النسبة', login: 'بيانات الدخول', password: 'الباسورد المؤقت', bank: 'الحساب البنكي' };
      Promise.resolve().then(() => vstore.create(input, vstore.actor())).then((res) => {
        const v = res.vendor; const miss = (res.missing || []).map((k) => STEP[k] + (res.reasons && VMSG[res.reasons[k]] ? ' (' + VMSG[res.reasons[k]] + ')' : ''));
        input.login.password = ''; f.password = '';
        log.append({ action: 'vendor.create', actor: ME.name, newValue: v.id }); modal.close(); state.vfilter.q = '';
        vnotify(miss.length ? 'warning' : 'success', 'اتضاف المبتكر ' + v.name + (miss.length ? ' — ناقص: ' + miss.join('، ') + '. كمّله من ملفه.' : ' · الباسورد المؤقت جاهز تبعته له.'));
        openVendor(v.id);
      }, (e) => { errs._form = e.message; draw(); });
    }
    modal = U.Modal({ title: existing ? 'تعديل بيانات ' + existing.name : 'إضافة مبتكر', body: [], footer: [] }); draw(); const first = modal.el.querySelector('#v-name'); if (first) first.focus();
  }

  // ----- vendor drawer (Figma: Drawer / Vendor, Tab=Info | Orders) -----
  let vdrawer = null; let vtab = 'info'; const shown = new Set(); let lastShare = null; window.__vLastShare = () => lastShare;
  let pwShown = null; // the temporary password revealed in the open drawer (decision 9 b) — forgotten when it closes
  function openVendor(id) {
    const v0 = vstore.get(id); if (!v0) { vnotify('error', 'المبتكر ' + id + ' مش موجود.'); return; }
    if (vdrawer) vdrawer.close(); shown.clear(); pwShown = null;
    try { history.replaceState(null, '', '#makers/' + id); } catch (e) { /* sandboxed */ }
    vdrawer = U.Drawer({ label: 'ملف المبتكر ' + v0.name, onClose: () => { vdrawer = null; vredraw = null; pwShown = null; try { history.replaceState(null, '', '#makers'); } catch (e) { /* sandboxed */ } renderVendors(); } });
    const act = (fn, ok) => { try { fn(); log.append({ action: 'vendor.update', actor: ME.name, newValue: id }); if (ok) vnotify('success', ok); draw(); } catch (e) { vnotify('error', e.message); draw(); } };
    const section = (title, action, ...kids) => h('section', { class: 'vsection' }, h('div', { class: 'head' }, h('h3', { class: 't-label' }, title), action || null), kids);
    function moreMenu(v) {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const trig = IconButton({ icon: 'more', label: 'المزيد', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      const MOVES = { active: [['leave', 'تحويل لـ «في إجازة»'], ['inactive', 'تحويل لغير نشط']], leave: [['active', 'تفعيل المبتكر'], ['inactive', 'تحويل لغير نشط']], inactive: [['active', 'تفعيل المبتكر'], ['leave', 'تحويل لـ «في إجازة»']] }; // decision 6: leave is a status like the others (vendors.toggle)
      const opts = (vstore.canToggle() ? (MOVES[v.status] || MOVES.active).map(([st, label]) => ({ value: 'status:' + st, label })) : []).concat([vstore.canRate() ? { value: 'rate', label: 'تغيير النسبة (الأوردرات الجديدة فقط)' } : null, { value: 'copy', label: 'نسخ رابط الملف' }, { value: 'ticket', label: 'إنشاء تذكرة على المبتكر' }].filter(Boolean));
      const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (val) => { close();
        if (val.startsWith('status:')) act(() => vstore.update(id, { status: val.slice(7) }, vstore.actor()), 'اتغيرت الحالة.');
        if (val === 'rate') editGroup(v, 'terms');
        if (val === 'copy') copyText(location.href.split('#')[0] + '#makers/' + id, 'رابط الملف');
        if (val === 'ticket') { vdrawer.close(); showTickets(); openNewTicket(); } } }));
      trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
    }
    // Per-section edit (owner, 21 Oct): every data group has its own «تعديل» that opens a popup with that group's fields only (Figma: Modal / Vendor edit — Identity | Contact | Terms).
    // Phase 3.3 (decision 6 a / b): the contact popup carries the store owner's name, the six address parts and the eight social links
    // (instagram is social.instagram) — the synced fields go to the site right after the save; the terms popup takes the flat fee next to
    // the rate (shown with it, pushed as the maker's commission on the site).
    function editGroup(v, g) {
      const G = VD.EDIT_GROUPS[g]; const f = { name: v.name, legalName: v.legalName || '', category: v.category, aliases: v.aliases.join('، '), status: v.status, phone: v.phone, altPhone: v.altPhone || '', email: v.email || '', contactName: v.contactName || '', addressParts: VD.cleanAddressParts(v.addressParts), social: Object.assign({}, VD.cleanSocial(v.social)), storeUrl: v.storeUrl || '', leadDays: String(v.leadDays), depositPolicy: v.depositPolicy || '', notes: v.notes || '', rate: v.rate == null ? '' : String(v.rate), flat: v.rateFlat == null ? '' : String(v.rateFlat), since: VTODAY() };
      let errs = {}; let m = null;
      const txt = (fid, label, key, opts = {}) => U.TextInput(Object.assign({ id: fid, label, value: f[key], error: errs[key], onInput: (x) => { f[key] = x; } }, opts));
      const sub = (fid, label, obj, key, opts = {}) => U.TextInput(Object.assign({ id: fid, label, value: f[obj][key] || '', error: errs[obj] && errs[obj][key], onInput: (x) => { f[obj][key] = x; } }, opts)); // a key of addressParts / social
      const two = (a, b) => h('div', { class: 'row cols2' }, a, b);
      const synced = !!v.wooVendorId;
      const groups = {
        identity: () => [two(txt('g-name', 'اسم المبتكر (المعروض)', 'name', { required: true, maxlength: 80 }), txt('g-legal', 'الاسم التجاري / القانوني', 'legalName')),
          two(U.Select({ id: 'g-cat', label: 'الفئة الأساسية', required: true, options: CATS.map((c) => ({ value: c, label: c })), value: f.category, error: errs.category, onChange: (x) => { f.category = x; m.setBody(...body()); } }), U.Select({ id: 'g-status', label: 'الحالة', required: true, options: VD.STATUSES.map(([value, label]) => ({ value, label })), value: f.status, error: errs.status, onChange: (x) => { f.status = x; m.setBody(...body()); } })),
          txt('g-aliases', 'أسماء بديلة', 'aliases', { placeholder: 'W&R، WOOD & ROPE', help: 'لتوحيد الأسماء من الأوردرات والشيت — افصل بفاصلة' }),
          synced ? U.InlineNote({ children: 'الاسم والحالة بيتبعتوا لمتجره على الموقع مع الحفظ.' }) : null],
        contact: () => [two(txt('g-phone', 'الهاتف (واتساب)', 'phone', { required: true, inputmode: 'tel', placeholder: '01xxxxxxxxx' }), txt('g-alt', 'هاتف بديل', 'altPhone', { inputmode: 'tel', placeholder: '01xxxxxxxxx' })),
          two(txt('g-email', 'الإيميل', 'email', { inputmode: 'email' }), txt('g-contact', 'اسم صاحب المتجر', 'contactName', { maxlength: 120, help: 'زي ما هو على الموقع (الاسم الأول والأخير)' })),
          h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'العنوان (الاستلام)'),
          two(sub('g-street1', VD.label(VD.ADDRESS_LABELS, 'street_1'), 'addressParts', 'street_1', { maxlength: 120 }), sub('g-street2', VD.label(VD.ADDRESS_LABELS, 'street_2'), 'addressParts', 'street_2', { maxlength: 120 })),
          two(sub('g-city', VD.label(VD.ADDRESS_LABELS, 'city'), 'addressParts', 'city', { maxlength: 80 }), sub('g-state', VD.label(VD.ADDRESS_LABELS, 'state'), 'addressParts', 'state', { maxlength: 80 })),
          two(sub('g-zip', VD.label(VD.ADDRESS_LABELS, 'zip'), 'addressParts', 'zip', { maxlength: 20, dir: 'ltr' }), sub('g-country', VD.label(VD.ADDRESS_LABELS, 'country'), 'addressParts', 'country', { maxlength: 2, dir: 'ltr', placeholder: 'EG' })),
          h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'سوشيال (روابط تبدأ بـ https://)'),
          ...VD.SOCIAL_KEYS.reduce((rows, [k, label], i, all) => (i % 2 ? rows : rows.concat([two(sub('g-' + k, label, 'social', k, { dir: 'ltr', inputmode: 'url', placeholder: 'https://…' }), all[i + 1] ? sub('g-' + all[i + 1][0], all[i + 1][1], 'social', all[i + 1][0], { dir: 'ltr', inputmode: 'url', placeholder: 'https://…' }) : h('span'))])), []),
          txt('g-url', 'صفحة المتجر', 'storeUrl', { placeholder: 'https://ibtekr.club/…' }),
          synced ? U.InlineNote({ children: 'التليفون والإيميل واسم صاحب المتجر والعنوان والسوشيال بيتبعتوا لمتجره على الموقع مع الحفظ.' }) : null],
        terms: () => [vstore.canRate() ? two(txt('g-rate', 'نسبة إبتكر', 'rate', { inputmode: 'decimal', suffix: '%', help: v.rate == null ? 'لسه مفيش نسبة متسجلة' : undefined }), U.DateField({ id: 'g-since', label: 'النسبة الجديدة سارية من', required: true, value: f.since, error: errs.since, today: VTODAY(), onChange: (iso, e) => { if (!e) f.since = iso; errs.since = e || undefined; m.setBody(...body()); } })) : null,
          vstore.canRate() ? txt('g-flat', 'رسوم ثابتة على كل أوردر (ج.م)', 'flat', { inputmode: 'decimal', error: errs.flat, help: 'زي ما هي على الموقع — للعرض بس، مش داخلة في حساب الحصة' }) : null,
          vstore.canRate() ? U.InlineNote({ kind: 'warning', children: 'لو غيّرت النسبة: بتنطبق على الأوردرات الجديدة من التاريخ ده فقط — الأوردرات القديمة بتفضل بنسبتها ' + (v.rate == null ? '—' : v.rate + '%') + '.' + (synced ? ' والنسبة بتتبعت للموقع.' : '') }) : null,
          two(txt('g-lead', 'مدة التجهيز المتفق عليها (أيام)', 'leadDays', { required: true, inputmode: 'numeric', help: 'بتغذي قاعدة التأخير' }), txt('g-dep', 'سياسة العربون', 'depositPolicy')),
          U.Textarea({ id: 'g-notes', label: 'ملاحظات الاتفاق', value: f.notes, onInput: (x) => { f.notes = x; } })] };
      const body = () => groups[g]().filter(Boolean).concat(errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'التعديل بيتسجل في سجل النشاط باسمك.' }));
      function save() {
        errs = VD.validateGroup(g, Object.assign({}, v, { aliases: v.aliases.join('، ') }), f);
        let rateChanged = false; let flat = null;
        if (g === 'terms' && vstore.canRate()) {
          const ar = (s) => String(s).trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
          const raw = ar(f.rate); const fl = ar(f.flat);
          if (fl !== '') { const n = Number(fl); if (!(n >= 0)) errs.flat = 'الرسوم الثابتة رقم من 0 أو أكتر'; else flat = n; }
          if (raw === '') { if (v.rate != null) errs.rate = 'النسبة من 0% إلى 65%'; } else { const r = Number(raw); if (!(r >= 0 && r <= 65)) errs.rate = 'النسبة من 0% إلى 65%'; else rateChanged = r !== v.rate || flat !== (v.rateFlat == null ? null : v.rateFlat); if (rateChanged && !f.since) errs.since = 'اختار تاريخ سريان النسبة'; }
        }
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; m.setBody(...body()); const bad = m.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
        m.close();
        act(() => { vstore.update(id, VD.groupPatch(g, f), vstore.actor()); if (rateChanged) vstore.setRate(id, Number(f.rate.trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))), f.since, vstore.actor(), { flat }); }, 'اتحفظت ' + G.title + '.');
      }
      m = U.Modal({ title: G.title + ' — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    const editBtn = (v, g) => (vstore.canEdit() ? Button({ type: 'text', size: 'sm', label: 'تعديل', attrs: { 'aria-label': 'تعديل ' + VD.EDIT_GROUPS[g].title, 'data-edit': g }, onClick: () => editGroup(v, g) }) : null);
    function bankForm(v) {
      const b = v.bank || {}; const f = { method: b.method || 'bank', bankName: b.bankName || '', holder: b.holder || '', iban: b.iban || '', wallet: b.wallet || '' }; let m = null;
      const body = () => [U.Select({ id: 'b-method', label: 'طريقة الدفع المفضلة', required: true, options: VD.PAY_METHODS.map(([k, l]) => ({ value: k, label: l })), value: f.method, onChange: (x) => { f.method = x; m.setBody(...body()); } }),
        h('div', { class: 'row cols2' }, U.TextInput({ id: 'b-bank', label: 'البنك', value: f.bankName, onInput: (x) => { f.bankName = x; } }), U.TextInput({ id: 'b-holder', label: 'اسم صاحب الحساب', value: f.holder, onInput: (x) => { f.holder = x; } })),
        U.TextInput({ id: 'b-iban', label: 'IBAN / رقم الحساب', value: f.iban, placeholder: 'EG…', onInput: (x) => { f.iban = x; } }), U.TextInput({ id: 'b-wallet', label: 'رقم المحفظة / إنستاباي', value: f.wallet, inputmode: 'tel', onInput: (x) => { f.wallet = x; } }),
        U.InlineNote({ kind: 'warning', children: 'بيانات حساسة — التعديل بيتسجل في السجل باسمك.' })];
      m = U.Modal({ title: 'بيانات الحساب البنكي — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: () => { m.close(); act(() => vstore.setBank(id, f, vstore.actor()), 'اتحفظ الحساب البنكي.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    // «بيانات الدخول» popup (decision 9 b; owner 26 Oct: no invite link). A maker without a login row gets username + e-mail + the
    // temporary password together — vstore.addLogin (the row, then the RPC: it needs the row). An existing row edits username + e-mail
    // (setLogin); «اعمل باسورد مؤقت جديد» opens the password field with the generator (setLoginPassword).
    function loginForm(v) {
      const L0 = v.login || {}; const had = !!L0.username;
      const f = { username: L0.username || VD.suggestUsername(v.name, (u) => vstore.usernameTaken(u, id)), email: L0.email || v.email || '', pwMode: 'temp', password: '', showPw: false, newPw: !had }; let errs = {}; let m = null;
      const redraw = () => m.setBody(...body());
      const body = () => [loginFields(f, errs, redraw, 'l-login', { noPassword: !f.newPw }),
        had && !f.newPw ? Button({ size: 'sm', icon: 'sparkle', label: 'اعمل باسورد مؤقت جديد', attrs: { 'data-newpw': '' }, onClick: () => { f.newPw = true; f.password = VD.genPassword(); f.showPw = true; redraw(); } }) : null,
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: had ? 'التعديل بيتسجل في سجل النشاط باسمك.' : 'الإضافة بتتسجل في سجل النشاط باسمك.' })].flat().filter(Boolean);
      function save() {
        errs = VD.validateLogin(f.newPw ? { username: f.username, email: f.email, pwMode: 'temp', password: f.password } : { username: f.username, email: f.email });
        if (!errs.username && vstore.usernameTaken(f.username, id)) errs.username = 'اسم المستخدم ده مستخدم قبل كده — جرّب ' + VD.suggestUsername(f.username, (u) => vstore.usernameTaken(u, id));
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); return; }
        if (!had) { // the row and its password in one call; a refused insert keeps the popup open with the message (the password still typed)
          const pw = f.password;
          Promise.resolve().then(() => vstore.addLogin(id, { username: f.username, email: f.email, password: pw }, vstore.actor())).then((res) => {
            f.password = ''; m.close(); pwShown = null; log.append({ action: 'vendor.update', actor: ME.name, newValue: id });
            const miss = res.missing && res.missing.length;
            vnotify(miss ? 'warning' : 'success', 'اتحفظت بيانات الدخول' + (miss ? ' — ناقص: الباسورد المؤقت' + (res.reasons && VMSG[res.reasons.password] ? ' (' + VMSG[res.reasons.password] + ')' : '') + '. اعمله من «تعديل».' : ' والباسورد المؤقت جاهز تبعته له.')); draw();
          }, (e) => { errs._form = e.message; redraw(); });
          return;
        }
        try { vstore.setLogin(id, { username: f.username, email: f.email }, vstore.actor()); } catch (e) { errs._form = e.message; redraw(); return; }
        m.close(); log.append({ action: 'vendor.update', actor: ME.name, newValue: id });
        if (f.newPw) { const pw = f.password; f.password = ''; vstore.setLoginPassword(id, pw, vstore.actor()).then(() => { pwShown = null; vnotify('success', 'اتحفظت بيانات الدخول والباسورد المؤقت جاهز تبعته له.'); draw(); }, (e) => { vnotify('error', e.message); draw(); }); }
        else { vnotify('success', 'اتحفظت بيانات الدخول.'); draw(); }
      }
      m = U.Modal({ title: 'بيانات الدخول — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    function contractForm(v) {
      const f = { fileName: '', size: 0, expires: v.contract ? v.contract.expires : '' }; let err = null; let m = null;
      const input = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg', 'aria-label': 'ملف العقد' }); input.addEventListener('change', () => { const file = input.files && input.files[0]; if (file) { f.fileName = file.name; f.size = file.size; f.file = file; } });
      const body = () => [U.FieldShell({ id: 'c-file', label: 'ملف العقد (PDF أو صورة، حتى 10 ميجا)', required: true }, input), U.DateField({ id: 'c-exp', label: 'تاريخ انتهاء العقد', value: f.expires || null, error: err, today: VTODAY(), help: 'هيوصلك تنبيه قبل الانتهاء بـ 30 يوم', onChange: (iso, e) => { if (!e) f.expires = iso || ''; err = e; m.setBody(...body()); } })];
      m = U.Modal({ title: (v.contract ? 'استبدال' : 'رفع') + ' عقد التعاون — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'رفع العقد', onClick: () => { if (!f.fileName) { vnotify('error', 'اختار ملف العقد الأول.'); m.close(); return; } m.close(); act(() => vstore.setContract(id, f, vstore.actor()), 'اترفع العقد.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    // Every KPI tile in «الأوردرات» opens a popup with its orders (owner, 21 Oct). Figma: Modal / Vendor orders.
    function tileOpen(tile, v, kind, all) {
      const n = VD.ordersByKind(all, kind).length; tile.classList.add('kpi-click'); tile.setAttribute('role', 'button'); tile.setAttribute('tabindex', '0'); tile.setAttribute('data-kind', kind);
      tile.setAttribute('aria-label', 'عرض ' + VD.ORDER_KINDS[kind] + ' (' + n + ')');
      tile.append(h('span', { class: 'kpi-more t-small' }, 'عرض الأوردرات', Icon('chevL', 'sm')));
      const go = () => openVendorOrders(v, kind, all); tile.addEventListener('click', go); tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return tile;
    }
    function openVendorOrders(v, kind, all) {
      const delay = kind === 'risk' || kind === 'late' || kind === 'onTime';
      const rows = VD.ordersByKind(all, kind).slice().sort((a, b) => (delay || kind === 'inProgress' ? b.ageDays - a.ageDays : a.ageDays - b.ageDays));
      const tot = rows.reduce((x, o) => x + o.total, 0); const hisShare = rows.reduce((x, o) => x + (o.share || 0), 0); let m = null; // decision 4: his share per line
      const title = ({ risk: 'أوردرات قابلة للتأخير', late: 'أوردرات متأخرة', onTime: 'أوردرات غير متأخرة' }[kind] || VD.ORDER_KINDS[kind]) + ' — ' + v.name;
      const sub = h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, num(rows.length + ' أوردر · بقيمة ' + D.formatMoney(tot) + ' ج.م · حصته ' + D.formatMoney(hisShare) + ' ج.م' + (rows.length && (delay || kind === 'inProgress') ? ' · أقدمها ' + Math.max(...rows.map((o) => o.ageDays)) + ' يوم' : '') + (delay ? ' · قابل للتأخير 9–11 يوم، متأخر بعد 11 يوم (مدة التسليم 12–15)' : '')));
      const open = (o) => !(o.status === 'مكتمل' || ['ملغي', 'مرتجع', 'مسترد', 'ملغي / مرتجع'].includes(o.status));
      const table = h('table', { class: 'vlo-table' },
        h('thead', null, h('tr', null, ['رقم الأوردر', 'العميل', 'التاريخ', 'الحالة', 'حالة التأخير', 'عمر الأوردر', 'الإجمالي', 'حصته'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, rows.map((o) => h('tr', { 'data-id': o.id },
          h('td', { 'data-l': 'رقم الأوردر' }, h('button', { type: 'button', class: 'vlo-link', onClick: () => { m.close(); if (OA() && OA().details) OA().details(o.id, 'info'); } }, num('IB-' + o.id), Icon('external', 'sm'))),
          h('td', { 'data-l': 'العميل' }, o.customer),
          h('td', { 'data-l': 'التاريخ' }, num(D.formatDateNumeric(R.orderDate(o, VTODAY())))),
          h('td', { 'data-l': 'الحالة' }, o.status),
          h('td', { 'data-l': 'حالة التأخير' }, open(o) ? U.DelayBadge(o.delivery) : '—'),
          h('td', { 'data-l': 'عمر الأوردر' }, num(o.ageDays + ' يوم')),
          h('td', { 'data-l': 'الإجمالي' }, num(D.formatMoney(o.total))),
          h('td', { 'data-l': 'حصته' }, num(D.formatMoney(o.share || 0)))))));
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, sub, rows.length ? h('div', { style: 'overflow-x:auto' }, table) : U.EmptyState('مفيش أوردرات هنا', delay ? 'مفيش أوردرات مفتوحة في الحالة دي للمبتكر ده.' : 'مفيش أوردرات في الحالة دي للمبتكر ده.'));
      // «مشاركة» (owner, 22 Oct): WhatsApp to the vendor's number or email — same pattern as Modal / Vendor late orders.
      const shareWrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'position:relative' });
      const shareBtn = Button({ type: 'primary', label: 'مشاركة', disabled: !rows.length, onClick: () => sharePop.toggle(), attrs: { 'aria-haspopup': 'menu', 'data-share': '' } });
      const sharePop = U.popover(shareWrap, shareBtn, (close) => h('div', { class: 'menu', role: 'menu', style: 'top:auto;bottom:calc(100% + 4px)' },
        h('button', { type: 'button', class: 'opt', role: 'menuitem', 'data-via': 'whatsapp', onClick: () => { close(); share('whatsapp'); } }, Icon('whatsapp', 'sm'), 'واتساب' + (v.phone ? ' — ' + v.phone : '')),
        h('button', { type: 'button', class: 'opt', role: 'menuitem', 'data-via': 'email', onClick: () => { close(); share('email'); } }, Icon('mail', 'sm'), 'إيميل' + (v.email ? ' — ' + v.email : ''))));
      shareWrap.append(shareBtn);
      async function share(via) {
        const text = VD.shareText(title, rows) + (brandNote(v) ? '\n' + brandNote(v) : ''); const phone = VD.waPhone(v.phone);
        const href = via === 'whatsapp' ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text) : 'mailto:' + (v.email || '') + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text);
        let note = '';
        try {
          if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'js/vendor/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
          const canvas = await window.html2canvas(m.el.querySelector('.modal-b'), { backgroundColor: getComputedStyle(document.body).backgroundColor, scale: 2 });
          const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); note = 'صورة الجدول اتنسخت — الصقها في الرسالة.'; }
          catch (e) { const url = URL.createObjectURL(blob); const im = U.Modal({ title: 'صورة الأوردرات', body: [h('p', { class: 't-small' }, 'المتصفح ما سمحش بنسخ الصورة تلقائي — اضغط عليها بزر الماوس اليمين وانسخها أو احفظها.'), h('img', { class: 'share-img', src: url, alt: title })], footer: [Button({ type: 'primary', label: 'تمام', onClick: () => im.close() })] }); note = 'الصورة جاهزة في النافذة.'; }
        } catch (e) { note = 'اتبعت النص بس (الصورة ما اتعملتش).'; }
        log.append({ action: 'vendor.share', actor: ME.name, newValue: v.id + ' · ' + kind + ' · ' + (via === 'whatsapp' ? 'واتساب' : 'إيميل') + ' · ' + rows.length + ' أوردر' });
        const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
        lastShare = { via, href, text };
        vnotify('success', 'اتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + (via === 'whatsapp' ? (phone ? ' على رقم المبتكر' : ' — اختار الرقم من واتساب') : (v.email ? ' لإيميل المبتكر' : ' — اكتب الإيميل')) + '. ' + note);
      }
      m = U.Modal({ title, body, footer: [shareWrap, Button({ label: 'فتح في الأوردرات', onClick: () => { m.close(); vdrawer.close(); showOrders({ vendor: v.name }); } }), Button({ type: 'text', label: 'إغلاق', onClick: () => m.close() })] });
      m.el.classList.add('wide'); m.el.dataset.vorders = kind; m.el.dataset.share = '1';
    }
    // ----- brands (phase 3.2, decision 5 a / b): «البراندات» after the agreement — the brands the maker holds today (name, code, aliases,
    // «متجر على الموقع», the rate column with sensitive.commission, since / «مؤقت لحد»), the «كان عنده» lines, «إضافة براند» and the ⋮ menu
    // per brand (edit / special rate / transfer / return) for the admin and vendors.edit = F (the server's policy: vstore.canBrands).
    // Every popup refuses locally (block 06 validateBrand / validateTransfer, the store's own checks) before any request. A brand's
    // name / code / aliases / reason are text nodes everywhere: HTML in them stays text.
    const canBrands = () => !!(vstore.canBrands && vstore.canBrands());
    const dateCell = (iso) => num(D.formatDateNumeric(iso));
    function brandMenu(v, b) {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const trig = IconButton({ icon: 'more', label: 'خيارات البراند ' + b.name, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-brand-menu': b.id } });
      const opts = [{ value: 'edit', label: 'تعديل' }, vstore.canRate() ? { value: 'rate', label: 'النسبة الخاصة' } : null, { value: 'transfer', label: 'نقل لمبتكر تاني' }, b.owner !== b.origin ? { value: 'return', label: 'رجوع لصاحبه' } : null].filter(Boolean);
      const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (val) => { close(); if (val === 'edit') brandForm(v, b); if (val === 'rate') brandRateForm(v, b); if (val === 'transfer') brandTransferForm(v, b); if (val === 'return') brandReturnForm(v, b); } }));
      trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
    }
    function brandsSection(v) {
      const canRate = vstore.canRate(); const edit = canBrands();
      const head = ['البراند'].concat(canRate ? ['النسبة'] : [], ['منذ'], edit ? [''] : []);
      const cell = (b) => h('td', null, h('span', { class: 'brand-cell' }, h('b', null, b.name), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'الكود ', h('span', { dir: 'ltr' }, b.code), b.aliases.length ? ' · ' + b.aliases.join('، ') : ''), b.store ? h('span', null, h('span', { class: 'tg tg-neutral' }, 'متجر على الموقع')) : null));
      const rows = (v.brands || []).map((b) => h('tr', { 'data-brand': b.id }, cell(b),
        canRate ? h('td', { 'data-brand-rate': '' }, b.rate == null ? 'نسبة المبتكر' : num('خاصة ' + b.rate + '%')) : null,
        h('td', null, b.since ? dateCell(b.since) : '—', b.temp && b.returnOn ? h('span', { class: 't-small', style: 'display:block;color:var(--color-text-secondary)' }, num('مؤقت لحد ' + D.formatDateNumeric(b.returnOn))) : null),
        edit ? h('td', null, brandMenu(v, b)) : null));
      const ever = (v.brandsEver || []).map((b) => h('p', { class: 't-small brand-ever', style: 'margin:0;color:var(--color-text-secondary)' }, 'كان عنده: ', h('b', null, b.name), num(' لحد ' + (b.until ? D.formatDateNumeric(b.until) : '—') + ' → دلوقتي مع '), h('b', null, b.now)));
      return section('البراندات', edit ? Button({ type: 'text', size: 'sm', icon: 'plus', label: 'إضافة براند', attrs: { 'data-add-brand': '' }, onClick: () => brandForm(v, null) }) : null,
        rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'brands-table mini-table' }, h('thead', null, h('tr', null, head.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'مفيش براندات على المبتكر ده دلوقتي.'),
        ever, h('p', { class: 't-small help', style: 'margin:0' }, 'الأوردرات بتتحسب للي البراند كان تحته يوم الأوردر، والـ SKU مش بيتغير. النسبة = نسبة المبتكر إلا لو البراند ليه نسبة خاصة.'));
    }
    // «إضافة براند» / «تعديل»: the name, the code (suggested from the name until it is typed), the aliases, and — adding, with
    // sensitive.commission — a special rate. A taken name (the store's brandByName) is refused here; the server's 23505 says the same.
    function brandForm(v, b) {
      const f = { name: b ? b.name : '', code: b ? b.code : '', aliases: b ? b.aliases.join('، ') : '', rate: '', codeTouched: !!b }; let errs = {}; let m = null;
      const redraw = () => m.setBody(...body());
      const body = () => [h('div', { class: 'row cols2' },
          U.TextInput({ id: 'br-name', label: 'اسم البراند', required: true, maxlength: 80, value: f.name, error: errs.name, help: 'الاسم اللي المنتجات بتتباع بيه', onInput: (x) => { f.name = x; if (!f.codeTouched) { f.code = VD.brandCode(x); const el = document.getElementById('br-code'); if (el) el.value = f.code; } } }),
          U.TextInput({ id: 'br-code', label: 'الكود', dir: 'ltr', maxlength: 3, value: f.code, error: errs.code, help: 'من 1 لـ 3 حروف إنجليزي كبيرة أو أرقام — معلوماتي، الـ SKU مش بيتغير', onInput: (x) => { f.code = x.toUpperCase(); f.codeTouched = true; } })),
        U.TextInput({ id: 'br-aliases', label: 'أسماء بديلة', value: f.aliases, placeholder: 'W&R، WOOD & ROPE', help: 'لتوحيد الأسماء من الأوردرات والشيت — افصل بفاصلة', onInput: (x) => { f.aliases = x; } }),
        !b && vstore.canRate() ? U.TextInput({ id: 'br-rate', label: 'نسبة خاصة', inputmode: 'decimal', suffix: '%', value: f.rate, error: errs.rate, help: 'سيبها فاضية = نسبة المبتكر', onInput: (x) => { f.rate = x; } }) : null,
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: b ? 'التعديل بيتسجل في سجل النشاط باسمك.' : 'البراند هيبقى على ' + v.name + ' من تاريخ انضمامه (' + D.formatDateNumeric(v.joinedAt) + ')، وبيتسجل في سجل النشاط باسمك.' })].filter(Boolean);
      function save() {
        errs = VD.validateBrand(f);
        if (!errs.name) { const dup = vstore.brandByName ? vstore.brandByName(f.name) : null; if (dup && (!b || dup.id !== b.id)) errs.name = 'فيه براند بنفس الاسم (' + dup.name + ') — اختار اسم تاني'; }
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); const bad = m.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
        if (b) { m.close(); act(() => vstore.updateBrand(b.id, { name: f.name, code: f.code, aliases: f.aliases }, vstore.actor()), 'اتحفظ البراند.'); return; }
        const STEP = { owner: 'صف الملكية', rate: 'النسبة الخاصة' };
        Promise.resolve().then(() => vstore.addBrand(id, { name: f.name, code: f.code, aliases: f.aliases, rate: f.rate }, vstore.actor())).then((res) => {
          m.close(); log.append({ action: 'vendor.update', actor: ME.name, newValue: id });
          const miss = (res.missing || []).map((k) => (STEP[k] || k) + (res.reasons && VMSG[res.reasons[k]] ? ' (' + VMSG[res.reasons[k]] + ')' : ''));
          vnotify(miss.length ? 'warning' : 'success', 'اتضاف البراند ' + res.brand.name + (miss.length ? ' — ناقص: ' + miss.join('، ') + '.' : '.')); draw();
        }, (e) => { errs._form = e.message; redraw(); });
      }
      m = U.Modal({ title: b ? 'تعديل البراند — ' + b.name : 'إضافة براند — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: b ? 'حفظ' : 'إضافة البراند', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    // «النسبة الخاصة» (sensitive.commission): a dated row; blank = no special rate from that date (the maker's rate again)
    function brandRateForm(v, b) {
      const f = { rate: b.rate == null ? '' : String(b.rate), since: VTODAY() }; let errs = {}; let m = null; const redraw = () => m.setBody(...body());
      const body = () => [h('div', { class: 'row cols2' }, U.TextInput({ id: 'br-rate', label: 'النسبة الخاصة للبراند', inputmode: 'decimal', suffix: '%', value: f.rate, error: errs.rate, help: 'سيبها فاضية = من غير نسبة خاصة (نسبة المبتكر)', onInput: (x) => { f.rate = x; } }),
          U.DateField({ id: 'br-since', label: 'سارية من', required: true, value: f.since, error: errs.since, today: VTODAY(), onChange: (iso, e) => { if (!e) f.since = iso; errs.since = e || undefined; redraw(); } })),
        U.InlineNote({ kind: 'warning', children: 'النسبة الخاصة بتغلب نسبة المبتكر على أوردرات البراند من التاريخ ده — السطر اللي ليه نسبة من الموقع بيفضل بنسبته.' }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'بتتسجل في سجل النشاط باسمك.' })].filter(Boolean);
      function save() {
        errs = {}; const e = VD.validateBrand({ name: b.name, rate: f.rate }); if (e.rate) errs.rate = e.rate; if (!f.since) errs.since = 'اختار تاريخ السريان';
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); return; }
        m.close(); act(() => vstore.setBrandRate(b.id, f.rate, f.since, vstore.actor()), 'اتحفظت النسبة الخاصة للبراند ' + b.name + '.');
      }
      m = U.Modal({ title: 'النسبة الخاصة — ' + b.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    // «نقل لمبتكر تاني»: the receiving maker (not the holder), the start date (today by default; not before the last transfer), «نقل
    // مؤقت؟» → the return date (after the start), the reason. The local rules (block 06 validateTransfer) before any request.
    function brandTransferForm(v, b) {
      const K = window.IBKit; const makers = vstore.all().filter((x) => x.id !== b.owner).sort((a, c) => a.name.localeCompare(c.name, 'ar'));
      const f = { to: '', since: VTODAY(), temp: false, returnOn: '', reason: '' }; let errs = {}; let m = null; const redraw = () => m.setBody(...body());
      const body = () => [U.Select({ id: 'br-to', label: 'المبتكر المستلم', required: true, options: makers.map((x) => ({ value: x.id, label: x.name + (x.status !== 'active' ? ' (' + VD.label(VD.STATUSES, x.status) + ')' : '') })), value: f.to, error: errs.to, placeholder: 'اختار المبتكر', onChange: (x) => { f.to = x; redraw(); } }),
        U.DateField({ id: 'br-since', label: 'من تاريخ', required: true, value: f.since, error: errs.since, today: VTODAY(), help: 'الأوردرات من التاريخ ده بتتحسب للمستلم' + (b.lastSince ? ' — آخر نقل ' + D.formatDateNumeric(b.lastSince) : ''), onChange: (iso, e) => { if (!e) f.since = iso; errs.since = e || undefined; redraw(); } }),
        K.Checkbox({ label: 'نقل مؤقت؟', checked: f.temp, onChange: (x) => { f.temp = x; if (!x) f.returnOn = ''; redraw(); } }),
        f.temp ? U.DateField({ id: 'br-return', label: 'تاريخ الرجوع', required: true, value: f.returnOn || null, error: errs.returnOn, today: VTODAY(), help: 'للتذكير — الرجوع نفسه بيتعمل من «رجوع لصاحبه»', onChange: (iso, e) => { if (!e) f.returnOn = iso || ''; errs.returnOn = e || undefined; redraw(); } }) : null,
        U.TextInput({ id: 'br-reason', label: 'السبب', maxlength: 200, value: f.reason, onInput: (x) => { f.reason = x; } }),
        U.InlineNote({ children: 'الـ SKU وبيانات الشحن بتفضل بتاعة المتجر — اللي بيتغير هو مين بيتحاسب على أوردرات البراند من التاريخ ده. بيتسجل على المبتكرين الاتنين.' }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : null].filter(Boolean);
      function save() {
        errs = VD.validateTransfer({ since: f.since, lastSince: b.lastSince, returnOn: f.temp ? f.returnOn : null, toId: f.to, ownerId: b.owner });
        if (f.temp && !f.returnOn && !errs.returnOn) errs.returnOn = 'اكتب تاريخ الرجوع';
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); return; }
        const to = makers.find((x) => x.id === f.to); m.close();
        act(() => vstore.transferBrand(b.id, f.to, { since: f.since, returnOn: f.temp ? f.returnOn : null, reason: f.reason }, vstore.actor()), 'اتنقل البراند ' + b.name + ' لـ ' + (to ? to.name : '') + ' من ' + D.formatDateNumeric(f.since) + (f.temp ? ' (مؤقت لحد ' + D.formatDateNumeric(f.returnOn) + ')' : '') + '.');
      }
      m = U.Modal({ title: 'نقل البراند — ' + b.name, body: body(), footer: [Button({ type: 'primary', label: 'نقل البراند', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    // «رجوع لصاحبه»: to the maker before a temporary transfer, else the origin (the store's `back`); the date not before the last transfer
    function brandReturnForm(v, b) {
      const backV = vstore.get(b.back); const backName = backV ? backV.name : '—';
      const f = { since: VTODAY() }; let errs = {}; let m = null; const redraw = () => m.setBody(...body());
      const body = () => [U.InfoRow({ label: 'هيرجع لـ', value: backName }),
        U.DateField({ id: 'br-since', label: 'من تاريخ', required: true, value: f.since, error: errs.since, today: VTODAY(), help: 'الأوردرات من التاريخ ده بترجع تتحسب له' + (b.lastSince ? ' — آخر نقل ' + D.formatDateNumeric(b.lastSince) : ''), onChange: (iso, e) => { if (!e) f.since = iso; errs.since = e || undefined; redraw(); } }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'بيتسجل على المبتكرين الاتنين في سجل النشاط باسمك.' })].filter(Boolean);
      function save() {
        errs = VD.validateTransfer({ since: f.since, lastSince: b.lastSince, toId: b.back, ownerId: b.owner }); if (errs.to) errs._form = errs.to;
        if (Object.keys(errs).length) { errs._form = errs._form || 'راجع الحقول المعلّمة بالأحمر'; redraw(); return; }
        m.close(); act(() => vstore.returnBrand(b.id, { since: f.since }, vstore.actor()), 'رجع البراند ' + b.name + ' لـ ' + backName + ' من ' + D.formatDateNumeric(f.since) + '.');
      }
      m = U.Modal({ title: 'رجوع البراند لصاحبه — ' + b.name, body: body(), footer: [Button({ type: 'primary', label: 'رجوع', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    // ----- phase 3.3 (decision 6): the synced store data in the drawer. Every value from the site is a text node; an href or an <img src>
    // is made only from a value starting with https:// (the adapter keeps the links and the logo https:// or empty — checked here again).
    const HTTPS = /^https:\/\//;
    // the drawer header's picture: the site's logo when the maker has one, else the letter
    const vendorLogo = (v) => (v.logoUrl && HTTPS.test(v.logoUrl) ? h('span', { class: 'vlogo vlogo-lg vlogo-img' }, h('img', { src: v.logoUrl, alt: 'لوجو ' + v.name, loading: 'lazy', referrerpolicy: 'no-referrer' })) : U.VendorLogo({ letter: v.logoLetter, size: 'lg' }));
    // (d) «موقوف على الموقع»: the maker is inactive here and has a store there (the sync mirrors enabled: false ↔ inactive)
    const siteOffTag = (v) => (v.status === 'inactive' && v.wooVendorId ? h('span', { class: 'tg tg-error', 'data-site-off': '' }, 'موقوف على الموقع') : null);
    // the zip and the country (not part of the joined address text), when the parts carry them
    const addressExtra = (v) => { const p = v.addressParts || {}; return p.zip || p.country ? U.InfoRow({ label: 'الرمز البريدي / الدولة', value: h('span', { dir: 'ltr' }, [p.zip, p.country].filter(Boolean).join(' · ')) }) : null; };
    // the social row: one link per filled key, opening in a new tab; a value that is not https:// (never, after the adapter) shows as text
    function socialLinks(v) {
      const s = v.social || {}; const items = VD.SOCIAL_KEYS.filter(([k]) => s[k]).map(([k, label]) => (HTTPS.test(s[k]) ? h('a', { class: 'social-a', href: s[k], target: '_blank', rel: 'noopener noreferrer', title: s[k], 'data-social': k }, label) : h('span', { class: 'social-a', 'data-social': k }, label + ': ' + s[k])));
      return items.length ? h('span', { class: 'social-row' }, ...items) : null;
    }
    // «آخر مزامنة مع الموقع» and, when fields wait for the site, «في انتظار الإرسال: …» — for a maker with a store only
    function syncRows(v) {
      if (!v.wooVendorId) return [];
      const L = VD.SYNC_FIELD_LABELS;
      return [U.InfoRow({ label: 'آخر مزامنة مع الموقع', value: h('span', { 'data-synced-at': v.wooSyncedAt || '' }, v.wooSyncedAt ? fmtTime(v.wooSyncedAt) : 'لسه ماتزامنش') }),
        v.pushPending && v.pushPending.length ? U.InfoRow({ label: 'في انتظار الإرسال', value: h('span', { class: 'tg tg-orange', 'data-push-pending': v.pushPending.join(',') }, v.pushPending.map((f) => L[f] || f).join('، ')) }) : null];
    }
    // (b) «عمولة حسب الفئة» under the rate: the category rates in force (name, rate, flat fee, since) with «إضافة» / «تعديل» for
    // sensitive.commission; the note that the rate goes to the site. Nothing for a member without the key.
    function categoryRatesBlock(v) {
      if (!vstore.canRate()) return [];
      const rows = (v.categoryRates || []).map((c) => h('tr', { 'data-cat-rate': c.wooCategoryId }, h('td', null, c.name), h('td', null, num(c.rate + '%')), h('td', null, c.flat != null && c.flat > 0 ? num(D.formatMoney(c.flat)) : '—'), h('td', null, dateCell(c.since)),
        h('td', null, Button({ type: 'text', size: 'sm', label: 'تعديل', attrs: { 'aria-label': 'تعديل عمولة الفئة ' + c.name, 'data-edit-cat': c.wooCategoryId }, onClick: () => categoryRateForm(v, c) }))));
      return [h('div', { class: 'head', style: 'margin-top:8px' }, h('h3', { class: 't-label' }, 'عمولة حسب الفئة'), Button({ type: 'text', size: 'sm', icon: 'plus', label: 'إضافة', attrs: { 'aria-label': 'إضافة عمولة فئة', 'data-add-cat': '' }, onClick: () => categoryRateForm(v, null) })),
        rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'mini-table cat-rates-table' }, h('thead', null, h('tr', null, ['الفئة', 'النسبة', 'رسوم ثابتة', 'من تاريخ', ''].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)', 'data-no-cat-rates': '' }, 'مفيش عمولة خاصة بفئة — نسبة المبتكر على كل الفئات.'),
        v.wooVendorId ? U.InlineNote({ children: 'النسبة بتتبعت للموقع: نسبة المبتكر وعمولة الفئات بتتسجل على متجره مع الحفظ.' }) : null];
    }
    // the add / edit popup of one category rate: the category (the site's list), the rate (blank = no category rate from that date),
    // the flat fee, the date — a dated row, never a rewrite
    function categoryRateForm(v, c) {
      const cats = (vstore.categories ? vstore.categories() : []); const taken = new Set((v.categoryRates || []).map((x) => String(x.wooCategoryId)));
      const f = { wooCategoryId: c ? String(c.wooCategoryId) : '', rate: c ? String(c.rate) : '', flat: c && c.flat != null ? String(c.flat) : '', since: VTODAY() }; let errs = {}; let m = null; const redraw = () => m.setBody(...body());
      const opts = cats.filter((x) => c ? String(x.id) === String(c.wooCategoryId) : !taken.has(String(x.id))).map((x) => ({ value: String(x.id), label: x.name }));
      const body = () => [U.Select({ id: 'cr-cat', label: 'الفئة (من الموقع)', required: true, options: opts, value: f.wooCategoryId, error: errs.wooCategoryId, placeholder: cats.length ? 'اختار الفئة' : 'فئات الموقع لسه ماتزامنتش', disabled: !!c || !opts.length, onChange: (x) => { f.wooCategoryId = x; redraw(); } }),
        h('div', { class: 'row cols2' }, U.TextInput({ id: 'cr-rate', label: 'نسبة إبتكر على الفئة', inputmode: 'decimal', suffix: '%', value: f.rate, error: errs.rate, help: 'سيبها فاضية = الفئة ترجع لنسبة المبتكر من التاريخ ده', onInput: (x) => { f.rate = x; } }),
          U.TextInput({ id: 'cr-flat', label: 'رسوم ثابتة (ج.م)', inputmode: 'decimal', value: f.flat, error: errs.flat, help: 'للعرض — زي الموقع', onInput: (x) => { f.flat = x; } })),
        U.DateField({ id: 'cr-since', label: 'سارية من', required: true, value: f.since, error: errs.since, today: VTODAY(), onChange: (iso, e) => { if (!e) f.since = iso; errs.since = e || undefined; redraw(); } }),
        U.InlineNote({ kind: 'warning', children: 'بتنطبق على الأوردرات الجديدة من التاريخ ده' + (v.wooVendorId ? '، وبتتبعت لمتجره على الموقع مع الحفظ.' : '.') }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'بتتسجل في سجل النشاط باسمك.' })].filter(Boolean);
      function save() {
        errs = VD.validateCategoryRate(f); if (!f.since) errs.since = 'اختار تاريخ السريان';
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); return; }
        m.close(); const name = (cats.find((x) => String(x.id) === f.wooCategoryId) || {}).name || '';
        act(() => vstore.setCategoryRate(id, f.wooCategoryId, { rate: f.rate, flat: f.flat }, f.since, vstore.actor()), 'اتحفظت عمولة الفئة ' + name + '.');
      }
      m = U.Modal({ title: (c ? 'تعديل عمولة الفئة — ' + c.name : 'إضافة عمولة فئة') + ' · ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    function draw() {
      const v = vstore.get(id); if (!v) { vdrawer.close(); return; } const st = vendorStats()[v.id]; const canEdit = vstore.canEdit(), canBank = vstore.canBank(), canRate = vstore.canRate(), canLogin = !!(vstore.canLogin && vstore.canLogin()); const cstat = VD.contractStatus(v, VTODAY());
      // decision 9 c: what the maker still lacks (login / e-mail / bank), from the store
      const missingTag = () => { const miss = vstore.missing ? vstore.missing(id) : []; return miss.length ? h('span', { class: 'tg tg-orange', 'data-missing': '' }, 'ناقص: ' + miss.join(' / ')) : null; };
      const header = h('div', { class: 'drawer-h' },
        h('div', { class: 'row1' }, h('div', { class: 'vdrawer-id' }, vendorLogo(v), h('div', { class: 'names' }, h('div', { class: 'name-row' }, h('h2', { class: 't-h4' }, v.name), U.VendorStatus(v.status), siteOffTag(v)), h('span', { class: 't-small' }, num((v.category || 'بدون فئة') + ' · نسبة إبتكر ' + (canRate && v.rate != null ? v.rate + '%' : '—') + ' · مبتكر من ' + D.formatDateLong(v.joinedAt) + (v.wooVendorId ? ' · متجر #' + v.wooVendorId : ' · بدون متجر على الموقع'))), missingTag())),
          h('div', { class: 'actions' }, moreMenu(v), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => vdrawer.close() }))),
        U.Tabs({ items: [{ id: 'info', label: 'معلومات المورد' }, { id: 'orders', label: 'الأوردرات' }, { id: 'accounts', label: 'الحسابات' }], active: vtab, onChange: (t) => { vtab = t; draw(); } }));
      let body;
        const copy = (val, label) => copyText(val, label);
        // decision 10: «عرض / تحميل» = a signed URL (60 s) from the private bucket, opened in a new tab
        const openContract = () => { if (!window.IBVendors) return; window.IBVendors.contractUrl(id).then((r) => { if (r.ok) window.open(r.url, '_blank', 'noopener'); else vnotify('error', VMSG[r.reason] || 'تعذّر فتح العقد.'); }); };
        // decision 9 b: «بيانات الدخول» — the username, the e-mail, the login status, the temporary password behind «إظهار» (the server logs
        // every reveal), «انسخ بيانات الدخول للمبتكر» (the password fetched at copy time), «تعديل» and «وقف / شغّل حساب الدخول» for the
        // admin and vendors.edit = F. Nothing here says the password was sent: the member sends it to the maker himself (no invite link, 26 Oct).
        const loginSection = () => {
          const L0 = v.login && v.login.username ? v.login : null; const ls = L0 ? L0.status : 'none'; const email = (L0 && L0.email) || v.email || '';
          const LTONE = { none: 'neutral', invited: 'gold', active: 'success', disabled: 'error' };
          const pwCell = !L0 ? null : !L0.hasPassword ? h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'باسورد مؤقت — لسه ماتعملش')
            : h('span', { class: 'pw-cell' }, h('span', { dir: 'ltr', class: 'pw-val' }, pwShown != null ? pwShown : '••••••••'),
              canLogin ? Button({ type: 'text', size: 'sm', label: pwShown != null ? 'إخفاء' : 'إظهار', attrs: { 'data-pw-reveal': '', 'aria-pressed': String(pwShown != null) }, onClick: () => { if (pwShown != null) { pwShown = null; draw(); return; } vstore.revealPassword(id, vstore.actor()).then((p) => { pwShown = p == null ? '—' : p; draw(); }, (e) => vnotify('error', e.message)); } }) : null);
          const copyLogin = () => { const lines = ['اسم المستخدم: ' + L0.username, 'الإيميل: ' + (email || '—')]; const done = (pw) => copyText(lines.concat([pw ? 'الباسورد المؤقت: ' + pw : L0.hasPassword ? 'الباسورد المؤقت: اطلبه من الأدمن أو متابعة المبتكرين' : 'الباسورد المؤقت: لسه ماتعملش']).join('\n'), 'بيانات الدخول');
            if (canLogin && L0.hasPassword) vstore.revealPassword(id, vstore.actor()).then(done, (e) => vnotify('error', e.message)); else done(null); };
          return section('بيانات الدخول', canLogin ? Button({ type: 'text', size: 'sm', label: L0 ? 'تعديل' : 'إضافة', attrs: { 'aria-label': (L0 ? 'تعديل' : 'إضافة') + ' بيانات الدخول', 'data-edit': 'login' }, onClick: () => loginForm(v) }) : null,
            U.InfoRow({ label: 'اسم المستخدم', value: L0 ? h('span', { dir: 'ltr' }, L0.username) : null, copy: !!L0, onCopy: () => copy(L0.username, 'اسم المستخدم') }),
            U.InfoRow({ label: 'الإيميل', value: email ? h('span', { dir: 'ltr' }, email) : null, copy: !!email, onCopy: () => copy(email, 'الإيميل') }),
            U.InfoRow({ label: 'حالة الحساب', value: h('span', { class: 'tg tg-' + (LTONE[ls] || 'neutral'), 'data-login-status': ls }, VD.label(VD.LOGIN_STATUS, ls)) }),
            U.InfoRow({ label: 'الباسورد', value: pwCell }),
            L0 ? h('div', { class: 'acts-inline' }, Button({ size: 'sm', icon: 'copy', label: 'انسخ بيانات الدخول للمبتكر', attrs: { 'data-copy-login': '' }, onClick: copyLogin }),
              canLogin ? Button({ type: 'text', size: 'sm', label: ls === 'disabled' ? 'شغّل حساب الدخول' : 'وقف حساب الدخول', attrs: { 'data-login-toggle': '' }, onClick: () => act(() => vstore.setLoginStatus(id, ls === 'disabled' ? 'invited' : 'disabled', vstore.actor()), ls === 'disabled' ? 'اتشغّل حساب الدخول.' : 'اتوقف حساب الدخول.') }) : null) : null,
            U.InlineNote({ children: canLogin ? 'إظهار الباسورد ونسخه بيتسجلوا في السجل باسمك.' : 'بيانات الدخول بيديرها الأدمن ومتابعة المبتكرين.' }));
        };
        const bank = v.bank; const sec = (field, label) => U.SecureField({ label, masked: VD.mask(bank && bank[field]), value: shown.has(field) ? (vstore.reveal(id, field, vstore.actor()) || '—') : '', state: !canBank ? 'hidden' : shown.has(field) ? 'shown' : 'masked', onToggle: () => { if (shown.has(field)) shown.delete(field); else { shown.add(field); log.append({ action: 'vendor.reveal', actor: ME.name, newValue: id + ':' + field }); } draw(); }, onCopy: () => { const val = vstore.reveal(id, field, vstore.actor()); if (val) copy(val, label); } });
      if (vtab === 'info') {
        body = h('div', { class: 'drawer-b' },
          section('الهوية', editBtn(v, 'identity'), U.InfoRow({ label: 'الاسم المعروض', value: v.name }), U.InfoRow({ label: 'الاسم التجاري', value: v.legalName }), U.InfoRow({ label: 'الفئة الأساسية', value: v.category }), U.InfoRow({ label: 'الأسماء البديلة', value: v.aliases.join('، ') }), U.InfoRow({ label: 'تاريخ الانضمام', value: num(D.formatDateLong(v.joinedAt)) }), U.InfoRow({ label: 'الحالة', value: U.VendorStatus(v.status) })),
          section('التواصل', editBtn(v, 'contact'), U.InfoRow({ label: 'الهاتف (واتساب)', value: v.phone ? h('span', { class: 'wa-ph' }, num(v.phone), h('a', { class: 'wa-a', href: waHref(v.phone), target: '_blank', rel: 'noopener', 'aria-label': 'واتساب ' + v.name, title: 'فتح واتساب' }, Icon('whatsapp', 'sm'))) : null, copy: true, onCopy: () => copy(v.phone, 'الهاتف') }), U.InfoRow({ label: 'هاتف بديل', value: v.altPhone ? h('span', { class: 'wa-ph' }, num(v.altPhone), h('a', { class: 'wa-a', href: waHref(v.altPhone), target: '_blank', rel: 'noopener', 'aria-label': 'واتساب — هاتف بديل', title: 'فتح واتساب' }, Icon('whatsapp', 'sm'))) : null, copy: !!v.altPhone, onCopy: () => copy(v.altPhone, 'هاتف بديل') }), U.InfoRow({ label: 'الإيميل', value: v.email, copy: true, onCopy: copy }),
            // phase 3.3 (decision 6 a): the store owner's name, the address from its parts (the typed text of a maker without parts), the social links, the sync lines
            U.InfoRow({ label: 'اسم صاحب المتجر', value: v.contactName }), U.InfoRow({ label: 'العنوان (الاستلام)', value: VD.addressText(v.addressParts) || v.address }), addressExtra(v), U.InfoRow({ label: 'سوشيال', value: socialLinks(v) }), U.InfoRow({ label: 'صفحة المتجر', value: v.storeUrl, copy: true, onCopy: copy }), ...syncRows(v)),
          loginSection(),
          section('الاتفاق التجاري', editBtn(v, 'terms'), U.InfoRow({ label: 'نسبة إبتكر', value: !canRate ? '—' : v.rate == null ? 'لسه مفيش نسبة متسجلة' : num(v.rate + '% — سارية من ' + D.formatDateLong(v.rateSince) + ' (على الأوردرات الجديدة فقط)' + (v.rateFlat != null && v.rateFlat > 0 ? ' + ' + D.formatMoney(v.rateFlat) + ' ج.م رسوم ثابتة' : '')) }), U.InfoRow({ label: 'مدة التجهيز المتفق عليها', value: num(v.leadDays + ' أيام') }), U.InfoRow({ label: 'سياسة العربون', value: v.depositPolicy }), U.InfoRow({ label: 'ملاحظات الاتفاق', value: v.notes }), canRate && v.rateHistory.length > 1 ? U.InfoRow({ label: 'سجل النسبة', value: num(v.rateHistory.map((x) => x.rate + '% من ' + D.formatDateNumeric(x.since)).join(' ← ')) }) : null,
            ...categoryRatesBlock(v)),
          brandsSection(v),
          section('العقد', null, U.ContractCard({ status: cstat, title: cstat === 'missing' ? 'العقد غير مرفوع' : cstat === 'expired' ? 'العقد منتهي' : cstat === 'expiring' ? 'العقد بينتهي خلال 30 يوم' : 'عقد التعاون',
            sub: cstat === 'missing' ? 'ارفع نسخة موقّعة (PDF أو صورة، حتى 10 ميجا) أو حمّل قالب العقد وابعته للمبتكر' : (v.contract.expires ? (cstat === 'expired' ? 'انتهى ' : 'ساري حتى ') + D.formatDateLong(v.contract.expires) + ' · ' : '') + 'رفعه ' + (v.contract.uploadedBy || '—') + ' في ' + D.formatDateLong(v.contract.uploadedAt.slice(0, 10)) + ' · ' + v.contract.fileName.split('.').pop().toUpperCase() + ' ' + (v.contract.size / 1048576).toFixed(1) + ' ميجا',
            canManage: canBank, onUpload: () => contractForm(v), onTemplate: () => vnotify('success', 'قالب العقد هيتحمّل من السيرفر في النسخة الحقيقية.'), onView: openContract, onDownload: openContract })),
          section('سجل النشاط', null, h('div', { class: 'tl' }, (() => { const ev = vstore.events(id).slice().reverse().slice(0, 8); return ev.length ? ev.map((e) => U.TimelineEvent({ text: e.text, time: fmtTime(e.at) })) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'لسه مفيش نشاط متسجل على المبتكر ده.'); })())));
      } else if (vtab === 'orders') {
        const cnt = VD.orderCounts(st.orders); const pf = VD.performance(st.orders, v.leadDays); const dc = VD.delayCounts(st.orders);
        const orders = st.orders.slice().sort((a, b) => a.ageDays - b.ageDays).slice(0, 8);
        const vtone = pf.verdict === 'محتاج متابعة' ? 'warning' : '';
        body = h('div', { class: 'drawer-b' },
          section('حالات التأخير — الأوردرات قيد التنفيذ', h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'قاعدة 9 / 11 يوم'),
            h('div', { class: 'cards delay-cards' },
              tileOpen(U.KpiTile({ label: 'قابل للتأخير', value: String(dc.risk), unit: 'أوردر', compare: 'off', note: [U.DelayBadge('risk'), ' عمره 9–11 يوم'] }), v, 'risk', st.orders),
              tileOpen(U.KpiTile({ label: 'متأخر', value: String(dc.late), unit: 'أوردر', compare: 'off', note: [U.DelayBadge('late'), ' عدّى 11 يوم'] }), v, 'late', st.orders),
              tileOpen(U.KpiTile({ label: 'غير متأخر', value: String(dc.onTime), unit: 'أوردر', compare: 'off', note: [U.DelayBadge('ok'), ' في الموعد'] }), v, 'onTime', st.orders))),
          h('div', { class: 'cards', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' },
            tileOpen(U.KpiTile({ label: 'إجمالي الأوردرات', value: String(cnt.total), unit: 'أوردر', compare: 'off', note: ['بقيمة ', num(D.formatMoney(st.orders.reduce((x, o) => x + o.total, 0))), ' ج.م'] }), v, 'all', st.orders),
            tileOpen(U.KpiTile({ label: 'مكتمل', value: String(cnt.completed), unit: 'أوردر', compare: 'off', note: 'نسبة الإكمال ' + pf.completionPct + '%' }), v, 'completed', st.orders),
            tileOpen(U.KpiTile({ label: 'قيد التنفيذ', value: String(cnt.inProgress), unit: 'أوردر', compare: 'off', note: 'متوسط عمرها ' + pf.avgOpenAge + ' يوم' }), v, 'inProgress', st.orders),
            tileOpen(U.KpiTile({ label: 'ملغي / مرتجع', value: String(cnt.cancelled), unit: 'أوردر', compare: 'off', note: 'نسبة الإلغاء ' + pf.cancelPct + '%' }), v, 'cancelled', st.orders)),
          section('ملخص الأداء', h('span', { class: 'tg tg-' + ({ 'ممتاز': 'success', 'جيد': 'gold', 'محتاج متابعة': 'orange' }[pf.verdict] || 'neutral'), 'data-verdict': pf.verdict }, pf.verdict),
            U.BarRow({ tone: 'brand', label: 'أوردرات في الموعد', value: pf.onTimePct + '%', pct: pf.onTimePct / 100 }),
            U.BarRow({ tone: 'gold', label: 'نسبة الإكمال', value: pf.completionPct + '%', pct: pf.completionPct / 100 }),
            U.BarRow({ tone: 'neutral', label: 'نسبة الإلغاء / المرتجع', value: pf.cancelPct + '%', pct: pf.cancelPct / 100 }),
            U.InfoRow({ label: 'مدة التجهيز المتفق عليها', value: num(v.leadDays + ' أيام') }),
            U.InfoRow({ label: 'متوسط عمر الأوردرات المفتوحة', value: num(pf.avgOpenAge + ' يوم') }),
            U.InfoRow({ label: 'قابلة للتأخير / متأخرة دلوقتي', value: num(String(pf.late)) }),
            U.InfoRow({ label: 'تذاكر مفتوحة عليه', value: num(String(st.tickets.length)) }),
            U.InlineNote({ kind: vtone, children: pf.verdict === 'ممتاز' ? 'ملتزم بالمواعيد ومفيش تأخير ولا إلغاء ملحوظ.' : pf.verdict === 'جيد' ? 'أداء كويس — تابع الأوردرات القابلة للتأخير قبل ما تتأخر.' : pf.verdict === 'محتاج متابعة' ? 'نسبة الإلغاء أو التأخير عالية — اتواصل معاه وافتح تذكرة لو محتاج.' : 'هيظهر الملخص أول ما يبقى عنده أوردرات.' })),
          section('أوردرات المبتكر', Button({ type: 'text', size: 'sm', label: 'فتح في الأوردرات', onClick: () => { vdrawer.close(); showOrders({ vendor: v.name }); } }), orders.length ? U.Table({ cls: 'mini-table', headers: ['رقم الأوردر', 'العميل', 'الحالة', 'التسليم', 'الإجمالي', 'حصته'], rows: orders.map((o) => [num(o.id), o.customer, o.status, U.DelayBadge(o.delivery), num(D.formatMoney(o.total)), num(D.formatMoney(o.share || 0))]) }) : U.EmptyState('مفيش أوردرات', 'المبتكر ده ما عندوش أوردرات في الأوردرات الحالية.')),
          section('التذاكر المفتوحة على المبتكر', Button({ type: 'text', size: 'sm', label: 'إنشاء تذكرة', onClick: () => { vdrawer.close(); showTickets(); openNewTicket(); } }), st.tickets.length ? st.tickets.map((t) => { const b = h('button', { type: 'button', class: 'opt', style: 'display:flex;justify-content:space-between;gap:8px;width:100%', onClick: () => { vdrawer.close(); showTickets(); openTicket(t.id); } }, h('span', null, num(t.id) + ' — ' + t.title), h('span', { style: 'display:flex;gap:8px' }, U.TicketStatus(t.status), U.PriorityTag(t.priority))); return b; }) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'مفيش تذاكر مفتوحة على المبتكر ده.')));
      } else {
        // decision 5: this phase's numbers — his shares of the completed orders (decision 4) over the opening balance (0 until the
        // phase-4 import); deposits, transport and the money moves come with the accounts phase; the agreement (Ibtekr's share)
        // only with sensitive.commission
        const money = (x) => num(D.formatMoney(x)); const bs = st.byStatus; const tot = (i) => bs.c[i] + bs.p[i] + bs.x[i];
        const later = (note) => h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, note);
        const kindRows = (kind) => VD.ordersByKind(st.orders, kind).map((o) => [num('IB-' + o.id), o.customer, o.status, U.DelayBadge(o.delivery), D.formatMoney(o.sales || 0), D.formatMoney(o.share || 0)]);
        const openKind = (kind) => (i) => { const l = VD.ordersByKind(st.orders, kind); if (OA() && OA().details) OA().details(l[i].id, 'info'); };
        const adt = (k) => { const base = { phone: v.phone, email: v.email, headers: ['رقم الأوردر', 'العميل', 'الحالة', 'التسليم', 'مبيعاته', 'حصته'], source: 'الأوردرات — نسبة الموقع على كل سطر وقت الأوردر' };
          if (k === 'pend') return Object.assign(base, { title: v.name + ' هيستحق بعد التنفيذ — ' + D.formatMoney(st.pending) + ' ج.م', sub: 'حقه من الأوردرات اللي قيد التنفيذ دلوقتي', summary: [{ label: 'أوردرات مفتوحة', value: String(bs.p[0]) }, { label: 'مبيعاتها', value: D.formatMoney(st.pendingSales) + ' ج.م' }, { label: 'حصته منها', value: D.formatMoney(st.pending) + ' ج.م' }], rows: kindRows('inProgress'), onRow: openKind('inProgress'), empty: 'مفيش أوردرات قيد التنفيذ للمبتكر ده.' });
          return Object.assign(base, { title: 'مستحقات ' + v.name + ' (من 1 أكتوبر) — ' + D.formatMoney(st.balance) + ' ج.م', sub: 'الرصيد الافتتاحي + حقه من الأوردرات المكتملة · الافتتاحي والعرابين والمواصلات بيتضافوا من مرحلة الحسابات', summary: [{ label: 'الرصيد الافتتاحي', value: D.formatMoney(st.openingBalance) + ' ج.م' }, { label: 'حقه من المكتملة', value: D.formatMoney(st.earned) + ' ج.م' }, { label: 'أوردرات مكتملة', value: String(bs.c[0]) }], rows: kindRows('completed'), onRow: openKind('completed'), empty: 'مفيش أوردرات مكتملة للمبتكر ده.' }); };
        const tmap = { c: 'مكتمل', p: 'قيد التنفيذ', x: 'ملغي / مرتجع' };
        body = h('div', { class: 'drawer-b' },
          h('div', { class: 'cards', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' },
            U.KpiTile({ label: 'رصيده عندنا', value: D.formatMoney(st.balance), unit: 'ج.م', compare: st.balance > 0 ? 'positive' : st.balance < 0 ? 'negative' : 'off', delta: { text: st.balance > 0 ? 'له' : st.balance < 0 ? 'عليه' : 'متصفّي', caption: 'مستحقاته من 1 أكتوبر' }, note: ['الافتتاحي ', num(D.formatMoney(st.openingBalance)), ' + حقه من المكتملة · الافتتاحي من مرحلة 4'], details: () => adt('bal') }),
            U.KpiTile({ label: 'حقه من المكتملة', value: D.formatMoney(st.earned), unit: 'ج.م', compare: 'off', note: ['من ', num(String(bs.c[0])), ' أوردر مكتمل بمبيعات ', num(D.formatMoney(st.sales)), ' ج.م'], details: () => adt('bal') }),
            U.KpiTile({ label: 'هيستحق بعد التنفيذ', value: D.formatMoney(st.pending), unit: 'ج.م', compare: 'off', note: 'حقه من الأوردرات اللي قيد التنفيذ', details: () => adt('pend') }),
            canRate ? U.KpiTile({ label: 'حصة إبتكر من المكتملة', value: D.formatMoney(st.ibtekrShare), unit: 'ج.م', compare: 'off', note: 'نسبة الموقع على كل سطر وقت الأوردر' }) : null,
            U.KpiTile({ label: 'العربون', value: '—', compare: 'off', note: 'من مرحلة الحسابات' }),
            U.KpiTile({ label: 'المواصلات', value: '—', compare: 'off', note: 'من مرحلة الحسابات' })),
          st.noRate ? U.InlineNote({ kind: 'warning', children: num(st.noRate + ' سطر بدون نسبة — محسوب بالإجمالي لحد ما نسبة الموقع تتسجل عليه.') }) : null,
          section('ملخص حسابه معانا', Button({ type: 'text', size: 'sm', icon: 'chart', label: 'تقرير المورد', attrs: { 'data-vreport': v.name }, onClick: () => openVendorReport(v.name) }),
            U.InfoRow({ label: 'مبيعات الأوردرات المكتملة', value: money(st.sales) }),
            canRate ? U.InfoRow({ label: 'حصة إبتكر' + (v.rate != null ? ' (' + v.rate + '% دلوقتي)' : ''), value: money(st.ibtekrShare) }) : null,
            U.InfoRow({ label: 'حقه من الأوردرات المكتملة', value: money(st.earned) }),
            U.InfoRow({ label: 'العربون', value: later('من مرحلة الحسابات') }),
            U.InfoRow({ label: 'المواصلات', value: later('من مرحلة الحسابات') }),
            U.InfoRow({ label: 'مستحقاته (من 1 أكتوبر)', value: num(D.formatMoney(st.balance) + (st.balance > 0 ? ' (له)' : st.balance < 0 ? ' (عليه)' : ' (متصفّي)')) }),
            U.InlineNote({ children: 'حصة كل سطر = إجماليه − نسبة الموقع عليه وقت الأوردر (ورسمها الثابت). الرصيد الافتتاحي والعرابين والمواصلات بيتضافوا من مرحلة الحسابات.' })),
          section('حسب حالة الأوردر', null, U.Table({ cls: 'mini-table', headers: ['الحالة', 'العدد', 'المبيعات', 'حقه'].concat(canRate ? ['حصة إبتكر'] : []), rows: ['c', 'p', 'x'].map((k) => [tmap[k], num(String(bs[k][0])), money(bs[k][1]), money(bs[k][2])].concat(canRate ? [money(bs[k][1] - bs[k][2])] : [])), totalRow: ['الإجمالي', num(String(tot(0))), money(tot(1)), money(tot(2))].concat(canRate ? [money(tot(1) - tot(2))] : []) })),
          section('الحركات المالية', null, h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'بتتسجل من مرحلة الحسابات.')),
          section('الحساب البنكي', canBank ? Button({ type: 'text', size: 'sm', label: bank ? 'تعديل' : 'إضافة حساب', attrs: { 'aria-label': (bank ? 'تعديل' : 'إضافة') + ' بيانات الحساب البنكي', 'data-edit': 'bank' }, onClick: () => bankForm(v) }) : null,
            canBank ? [U.InfoRow({ label: 'طريقة الدفع المفضلة', value: bank ? VD.label(VD.PAY_METHODS, bank.method) : null }), U.InfoRow({ label: 'البنك', value: bank && bank.bankName }), U.InfoRow({ label: 'اسم صاحب الحساب', value: bank && bank.holder }), sec('iban', 'IBAN'), sec('wallet', 'رقم المحفظة / إنستاباي')] : [U.SecureField({ label: 'IBAN', state: 'hidden' }), U.SecureField({ label: 'رقم المحفظة', state: 'hidden' })],
            U.InlineNote({ children: 'الإظهار والنسخ والتعديل متاحين للأدمن ودور الحسابات فقط، وكل إظهار أو تعديل بيتسجل في السجل.' })));
      }
      vdrawer.set(header, body);
    }
    draw(); vredraw = draw; const c = vdrawer.el.querySelector('.icon-btn'); if (c) c.focus();
    if (window.IBVendors) window.IBVendors.loadEvents(id).then(() => { if (vredraw === draw) draw(); }); // decision 6: the vendor's activity_log, once per open
  }

  function render() {
    U.closePopover();
    const main = document.getElementById('main'); const sc = window.scrollY;
    const note = state.note; state.note = null;
    const tabs = U.Tabs({ items: TABS, active: state.tab, onChange: (id, viaKey) => { state.tab = id; try { history.replaceState(null, '', '#' + id); } catch (e) { /* sandboxed */ } focusTab = !!viaKey; render(); } });
    const noteEl = note ? U.InlineNote({ kind: note.kind, children: note.text, action: note.undo ? Button({ type: 'text', size: 'sm', label: 'تراجع', onClick: note.undo }) : IconButton({ icon: 'close', label: 'إخفاء', onClick: () => { noteEl.remove(); } }) }) : null;
    main.replaceChildren(...[
      h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'الحسابات'), h('p', { class: 't-small' }, 'المصروفات · المبيعات · حسابات الموردين · الحساب الفعلي')), h('div', { class: 'actions' }, window.IBDataActions.Menu(window.IBDataActions.PAGES.accounts, () => ({ vendors: 'vendorMoves', actual: 'accountMoves' }[state.tab] || 'expenses')))),
      tabs,
      h('div', { class: 'toolbar' }, DateRangeField(), state.tab === 'vendors' ? SortDropdown() : null, h('span', { class: 'grow' }), state.tab === 'expenses' ? AddMenu('إضافة مصروفات', 'expenses') : state.tab === 'vendors' ? AddMenu('إضافة مبلغ', 'vendorMoves') : state.tab === 'actual' ? AddMenu('إضافة مبلغ', 'accountMoves') : null),
      noteEl,
      h('div', { id: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.tab, style: 'display:flex;flex-direction:column;gap:24px;min-width:0' }, VIEWS[state.tab]())].filter(Boolean));
    window.scrollTo(0, sc);
    if (focusTab) { const t = main.querySelector('[role=tab][aria-selected=true]'); if (t) t.focus(); focusTab = false; }
  }

  function boot() {
    const root = document.getElementById('root');
    root.className = 'app';
    root.replaceChildren(Sidebar(), h('div', { class: 'main' }, TopHeader(), h('main', { class: 'content', id: 'main' }), h('main', { class: 'content', id: 'reports' }), h('main', { class: 'content', id: 'tickets' }), h('main', { class: 'content', id: 'vendors' }), Object.keys(window.IBPages.all()).map((id) => h('main', { class: 'content mod', id: 'pg-' + id, hidden: true })), h('div', { id: 'orders' })), BottomNav());
    U.setModalRoot(document.body); document.body.append(AiPanel()); aiInitChat();
    window.addEventListener('hashchange', () => { const hs = location.hash.slice(1); if (window.IBShell.routeLogin(hs)) return; const mp = modPage(hs); if (mp) { state.page = mp; showPage(); window.IBPages.render(mp, false); window.scrollTo(0, 0); return; } if (location.hash.slice(1) === 'orders') { if (state.page !== 'orders') go('orders'); return; } const rt = reportTabOf(location.hash.slice(1)); if (rt) { state.rtab = rt; if (state.page !== 'reports') { state.page = 'reports'; showPage(); } renderReports(); return; } const tk = ticketOf(location.hash.slice(1)); if (tk !== null) { if (state.page !== 'tickets') { state.page = 'tickets'; showPage(); } renderTickets(); if (tk) openTicket(tk); return; } const vd = vendorOf(location.hash.slice(1)); if (vd !== null) { if (state.page !== 'vendors') { state.page = 'vendors'; showPage(); } renderVendors(); if (vd) openVendor(vd); return; } const t = hashTab(); if (t) { state.tab = t; if (state.page !== 'accounts') { state.page = 'accounts'; showPage(); } render(); } });
    showPage(); render(); if (state.page === 'reports') renderReports(); if (state.page === 'tickets') { renderTickets(); const tk = ticketOf(location.hash.slice(1)); if (tk) openTicket(tk); }
    if (window.IBPages.all()[state.page]) window.IBPages.render(state.page, false);
    if (window.IBShell.routeLogin(location.hash.slice(1))) { /* login screen over the app */ }
    document.addEventListener('ib:notify', () => { const b = document.querySelector('.notif-btn'); if (b) b.dispatchEvent(new Event('ib:refresh')); });
    if (state.page === 'vendors') { renderVendors(); const vd = vendorOf(location.hash.slice(1)); if (vd) openVendor(vd); }
    window.addEventListener('load', () => { if (window.IBPages.all()[state.page]) window.IBPages.render(state.page, false); if (state.page === 'reports') renderReports(); if (state.page === 'tickets' && !drawerApi) renderTickets(); if (state.page === 'vendors' && !vdrawer) renderVendors(); }); // orders data script loads after the app
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', () => { if (state.page === 'reports') renderReports(); if (state.page === 'tickets') renderTickets(); if (state.page === 'vendors') renderVendors(); }); // table <-> record cards
  }
  // AI filter helper for the orders filter builder: describe the filter in Arabic -> {op, items}
  const FILTER_FIELDS = ['id', 'name', 'phone', 'st', 'cf', 'deliv', 'vendor', 'tot', 'dep', 'age', 'date', 'note'];
  const FILTER_OPS = ['has', 'not', 'eq', 'ne', 'empty', 'gt', 'lt', 'between', 'before', 'after'];
  async function aiFilter(text) {
    const ctx = { vendors: (window.OrdersApp && window.OrdersApp.vendors) ? window.OrdersApp.vendors() : [] };
    const local = C.parseFilter(text, ctx);
    if (!aiSample) return { filter: local, mode: 'local' };
    let out = null;
    const tool = { name: 'set_filter', description: 'حوّل وصف المستخدم إلى شروط فلتر للأوردرات. الحقول: id رقم الأوردر، name اسم العميل، phone، st حالة الأوردر، cf حالة التأكيد (مؤكد بعربون/مؤكد بدون عربون/غير مؤكد/في انتظار الرد)، deliv حالة التسليم (متأخر/قابل للتأخير/غير متأخر)، vendor المورد، tot إجمالي القيمة، dep العربون، age عمر الأوردر بالأيام، date تاريخ الأوردر، note التعليق. العمليات: has يحتوي، not لا يحتوي، eq يساوي، ne لا يساوي، empty فاضي، gt أكبر من، lt أقل من، before قبل، after بعد. op = and أو or بين الشروط.',
      inputSchema: { type: 'object', properties: { op: { type: 'string', enum: ['and', 'or'] }, items: { type: 'array', items: { type: 'object', properties: { f: { type: 'string', enum: FILTER_FIELDS }, op: { type: 'string', enum: FILTER_OPS }, v: { type: 'string' } }, required: ['f', 'op'] } } }, required: ['items'] },
      execute: (i) => { out = { op: i.op === 'or' ? 'or' : 'and', items: (i.items || []).filter((x) => FILTER_FIELDS.includes(x.f) && FILTER_OPS.includes(x.op)).map((x) => ({ f: x.f, op: x.op, v: x.v == null ? '' : String(x.v) })) }; return 'ok'; } };
    try {
      await aiSample([{ role: 'user', content: 'الموردين المتاحين: ' + ctx.vendors.join('، ') + '\nحالات الأوردر: ' + (window.OrdersApp ? window.OrdersApp.statuses().join('، ') : '') + '\nاستخدم أداة set_filter مرة واحدة ورد بجملة قصيرة.\n\nالوصف: ' + text }], { tools: [tool], modelTier: 'quick' });
    } catch (e) { out = null; }
    return out && out.items.length ? { filter: out, mode: 'ai' } : { filter: local, mode: 'local' };
  }
  // owner 22 Oct: dashboard (لوحة التحكم) reads everything through this — Figma 526:35690
  // the dashboard's one «النهارده»: the real local date the orders' ages count to (IBOrders.today), for the default range,
  // the range picker, ordersReport (dates = today − ageDays) and block 25's greeting / 30-day window. K.TODAY (the
  // prototype's fixed date) only without the orders adapter; the sample stores (contracts, money) keep their own date.
  function dashToday() { return window.IBOrders && window.IBOrders.today ? window.IBOrders.today() : window.IBKit ? window.IBKit.TODAY : TODAY; }
  const DTODAY = window.IBKit ? window.IBKit.TODAY : TODAY; const DT0 = dashToday(); state.drange = state.drange || { from: DT0, to: DT0, preset: 'today' };
  window.IBDashData = {
    get TODAY() { return dashToday(); }, today: dashToday, range: () => state.drange, DateRangeField: () => DateRangeField('dash'),
    rows: ordersRows, full: allOrders, alerts,
    report: (range) => R.ordersReport(ordersRows(), range, dashToday()),
    money: () => { const acc = accountsNow().balances; const vs = D.vendorSummary(vendorsNow()); const P = D.potential(acc, SEED.inProgressShare, vs.deposits);
      const mon = TODAY.slice(0, 7); const [yy, mm] = mon.split('-').map(Number);
      return { acc, actual: P.actual, vs, vendors: vendorsNow(), sales: SEED.salesTotal, salesRows: SEED.sales, expSept: D.categoryTotals(SEED.expenseSeed, store.expenses, '2026-09-01', '2026-09-30'), expNow: D.categoryTotals(SEED.expenseSeed, store.expenses, mon + '-01', mon + '-' + lastDay(yy, mm)), transport: trAll(), payroll: payrollInfo(), cycle: cycleLabel() }; },
    go, showOrders, openVendorLate, openVendorStatement, openVendorReport, openPayrollAlert, openVendor: (name) => { go('vendors'); const v = vstore.findByName ? vstore.findByName(name) : null; if (v) openVendor(v.id); },
    addExpense: () => openForm('expenses', 'withdraw'), addVendorMove: () => openForm('vendorMoves', 'withdraw'), addVendor: () => { go('vendors'); openAddVendor(); }, newTicket: (pre) => { showTickets(); openNewTicket(pre); },
    vendorNames: () => vendorsNow().map((v) => v.name),
    contracts: () => vstore.all().map((v) => ({ name: v.name, status: VD.contractStatus(v, DTODAY), expires: v.contract && v.contract.expires })),
  };
  // an order popup lives inside the orders page, so it is opened there (owner 22 Oct: before this, «فتح الأوردر» from other pages stayed hidden until you visited الأوردرات)
  window.IBShowOrders = () => { if (state.page !== 'orders') go('orders'); };
  window.IbtekrApp = Object.freeze({ eventLog: () => log.all(), aiRun, aiFilter, newTicket: (pre) => { showTickets(); openNewTicket(pre); }, logEvent: (ev) => log.append(Object.assign({ actor: ACTOR }, ev)) });
  boot(); // synchronous: the orders block (next script) mounts into #orders, which boot() creates
  // Session gate: #root stays hidden until the Supabase session is known. In order: a recovery link confirmed by supabase-js → reset form;
  // no session → login («الجلسة خلصت» again right after an idle sign-out reloaded the page: ib.loginView); idle ≥ AUTH.idleMinutes since ib.lastAct (any earlier page load) → sign out, «الجلسة خلصت»;
  // aal1 with a verified TOTP factor → 2FA view (the member is not loaded before aal2; an unreadable level fails closed: sign out,
  // login); no active profile → sign out, login. A typed #type=recovery is not a recovery: the stored session goes through every check.
  (async () => {
    const A = window.IBAuth, SH = window.IBShell, root = document.getElementById('root');
    document.addEventListener('ib:directory', () => { const old = root.querySelector('.topbar .user'); if (old) old.replaceWith(SH.AccountMenu(go)); }); // header shows the signed-in member
    if (!SH.isLoggedOut()) root.hidden = true;
    let gated = false;
    // a SIGNED_OUT this tab did not start (another tab signed out, or the server ended the session) must wipe memory too: reload as 21-shell.js signOut does
    A.onChange((event) => { if (event === 'PASSWORD_RECOVERY' && gated) SH.showLogin('reset'); else if (event === 'SIGNED_OUT' && gated && !SH.isLoggedOut()) { SH.showLogin('login'); try { sessionStorage.setItem('ib.loginView', 'login'); } catch (e) { /* storage blocked */ } location.reload(); } });
    await A.ready();
    const lastAct = (() => { try { return Number(localStorage.getItem('ib.lastAct')) || 0; } catch (e) { return 0; } })();
    // the view a sign-out put up before it reloaded the page (21-shell.js signOut); read once
    const stored = (() => { try { const v = sessionStorage.getItem('ib.loginView'); sessionStorage.removeItem('ib.loginView'); return v; } catch (e) { return null; } })();
    const view = await (async () => {
      if (await A.recovery()) return 'reset';
      if (!A.session()) return stored === 'expired' ? 'expired' : 'login';
      if (lastAct && (Date.now() - lastAct) / 60000 >= window.IbtekrOps.AUTH.idleMinutes) { await A.signOut(); return 'expired'; }
      try { if (await A.checkTotp()) return '2fa'; } catch (e) { await A.signOut(); return 'login'; }
      try { await window.IBDirectory.load(); const me = window.IBDirectory.me(); if (me && me.status === 'active') return null; } catch (e) { /* sign out below */ }
      await A.signOut(); return 'login';
    })();
    gated = true;
    if (view === null) {
      if (SH.isLoggedOut()) return; // routeLogin put a login view up (#login, #login-forgot, …)
      try { localStorage.setItem('ib.lastAct', String(Date.now())); } catch (e) { /* storage blocked */ }
      root.hidden = false; window.dispatchEvent(new HashChangeEvent('hashchange')); return;
    }
    if (view === 'login' && SH.isLoggedOut()) return;
    SH.showLogin(view);
  })();
})();

