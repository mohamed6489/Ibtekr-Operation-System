
/* Accounts page — views, adapter (in-memory), event log. Business rules live in domain.js; widgets in ui.js. */
(function () {
  'use strict';
  const D = window.IbtekrDomain, U = window.IBUI;
  // phase 4 (plan decisions 4 / 7): the accounts read live numbers in the September seed's shape (block 02 liveSeed) — refreshed
  // before every render of the page from the makers (IBVendors), Dokan's balances and the range's sales (IBAccounts)
  const SEED = D.liveSeed();
  const { h, num, Button, IconButton, Icon } = U;
  // phase 4: the accounts read the clock (Cairo's calendar date); the prototype's fixed 2026-10-20 is gone
  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const TODAY_APP = TODAY;
  let ACTOR = 'صفوت كمال'; // the signed-in member's name once the directory loads (actorName)

  // ---------- adapter: the only place data is read/written — phase 4: write-through to IBAccounts (acc_* tables) ----------
  // The local copy changes first (the screen answers at once), the server write runs after; when it answers, the store is
  // the server's again (ib:accounts). A refused write puts a note on the page. «حذف» is the void of decision 2 (final on the
  // server), so its «تراجع» records the same move again.
  const log = D.createEventLog(() => new Date().toISOString());
  const store = { seq: 0, expenses: [], vendorMoves: [], accountMoves: [] };
  const ACC = () => window.IBAccounts || null;
  const WRITE_ERR = { forbidden: 'مالكش صلاحية على الحركة دي.', invalid: 'السيرفر رفض البيانات دي — راجع الحقول.', network: 'مقدرناش نحفظ دلوقتي — اتأكد من النت وجرّب تاني.' };
  function syncStore() { const A = ACC(); if (!A) return; store.expenses = A.rows('expenses'); store.vendorMoves = A.rows('vendorMoves'); store.accountMoves = A.rows('accountMoves'); }
  function settle(p) { p.then((r) => { syncStore(); if (r && !r.ok) setNote({ kind: 'error', text: WRITE_ERR[r.reason] || WRITE_ERR.network }); rerender(); }); }
  // a redraw for the server's answer keeps the note on screen (its «تراجع» included); a user's action clears it as before
  let shownNote = null;
  function rerender() { if (state.page === 'vendors' && state.vtab === 'accounts') { renderVendors(); return; } if (state.page !== 'accounts') return; if (!state.note && shownNote) state.note = shownNote; render(); }
  const canAdd = () => { const A = ACC(); return !A || A.can().add; };
  const canEditRec = (rec) => { if (rec && rec.settledBy != null) return false; const A = ACC(); return !A || A.canEdit(rec); }; // 0078: a settled move is final
  function refreshSeed() {
    const A = ACC(), V = window.IBVendors; if (!A || !V || !V.store) return;
    const makers = V.store.all().map((v) => ({ id: v.id, name: v.name, rate: v.rate == null ? null : v.rate }));
    Object.assign(SEED, D.liveSeed({ makers, balances: A.balances(), sales: A.sales(state.range.from, state.range.to) || [] }));
    const me = window.IBDirectory && window.IBDirectory.me && window.IBDirectory.me(); if (me && me.name) ACTOR = me.name;
  }
  const adapterLocal = {
    add(kind, value, actor = ACTOR) { const rec = Object.freeze({ id: ++store.seq, createdBy: actor, ...value }); store[kind] = [...store[kind], rec]; log.append({ action: kind + '.create', actor, newValue: rec }); return rec; },
    update(kind, id, value) { const old = store[kind].find((r) => r.id === id); const rec = Object.freeze({ ...old, ...value, id }); store[kind] = store[kind].map((r) => (r.id === id ? rec : r)); log.append({ action: kind + '.update', actor: ACTOR, oldValue: old, newValue: rec }); return rec; },
    remove(kind, id) { const old = store[kind].find((r) => r.id === id); store[kind] = store[kind].filter((r) => r.id !== id); log.append({ action: kind + '.delete', actor: ACTOR, oldValue: old }); return old; },
    restore(kind, rec) { store[kind] = [...store[kind], rec]; log.append({ action: kind + '.restore', actor: ACTOR, newValue: rec }); },
  };
  const adapter = {
    add(kind, value, actor = ACTOR) { const rec = adapterLocal.add(kind, value, actor); if (ACC()) settle(ACC().add(kind, value)); return rec; },
    update(kind, id, value) { const rec = adapterLocal.update(kind, id, value); if (ACC()) settle(ACC().update(kind, id, value)); return rec; },
    remove(kind, id) { const old = adapterLocal.remove(kind, id); if (ACC()) settle(ACC().remove(kind, id)); return old; },
    restore(kind, rec) { adapterLocal.restore(kind, rec); if (ACC()) settle(ACC().add(kind, rec)); },
  };
  document.addEventListener('ib:accounts', () => { syncStore(); rerender(); if (state.page === 'reports') renderReports(); });
  document.addEventListener('ib:vendors', () => { rerender(); });

  // ---------- transport (المواصلات): Logistics expenses sheet + «مواصلات» vendor moves recorded here ----------
  const TR = window.IbtekrTransport;
  const TR_SHEET = []; // phase 4: the Logistics sheet is not read any more — transport = the «مواصلات» moves recorded here
  const TR_SRC = 'شيت Logistics expenses (مشاوير المواصلات) + حركات «مواصلات» المتسجلة في السيستم';
  // 0078: open = only the «مواصلات» not settled by an approved withdraw request yet (what «الرصيد دلوقتي» deducts)
  const transportRows = (open) => TR_SHEET.concat(store.vendorMoves.filter((m) => m.type === 'مواصلات' && m.direction === 'withdraw' && (!open || m.settledBy == null)).map((m) => ({ date: m.date, dateFixed: false, raw: m.date, amount: m.amount, vendor: m.vendor, scope: 'vendor', payer: 'السيستم', note: m.note || '' })));
  const trAll = (open) => TR.totals(transportRows(open));
  const trVendor = (name, open) => TR.forVendor(transportRows(open), name);
  const trPeriod = (t) => (t.from ? D.formatDateNumeric(t.from) + ' – ' + D.formatDateNumeric(t.to) : 'مفيش مشاوير');
  const trNote = (rows) => (rows.some((r) => r.dateFixed) ? '* تاريخ متصحّح: الشيت كان فيه سنة أو شهر غلط في الصف ده، واتظبط حسب ترتيب الصفوف.' : '');
  const trDate = (r) => D.formatDateNumeric(r.date) + (r.dateFixed ? ' *' : '');
  // name: vendor name → that vendor's trips · '' → all vendors · null → everything (vendors + operations)
  function transportDetails(name, open) {
    const fmt = (n) => D.formatMoney(n); const all = trAll(open); const trVendor = (n) => TR.forVendor(transportRows(open), n);
    const openByName = (n) => { const v = vstore.findByName(n); if (v) { go('vendors'); openVendor(v.id); } };
    if (name) {
      const v = trVendor(name); const rows = v.rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      return { title: 'مواصلات ' + name + ' — ' + fmt(v.total) + ' ج.م', sub: v.trips ? v.trips + ' مشوار · من ' + D.formatDateNumeric(v.first) + ' لـ ' + D.formatDateNumeric(v.last) : 'مفيش مشاوير متسجلة للمبتكر ده',
        summary: [{ label: 'الإجمالي', value: fmt(v.total) + ' ج.م' }, { label: 'المشاوير', value: String(v.trips) }, { label: 'متوسط المشوار', value: v.trips ? fmt(v.total / v.trips) + ' ج.م' : '—' }],
        headers: ['التاريخ', 'المبلغ (ج.م)', 'الاسم', 'ملاحظات'], rows: rows.map((r) => [trDate(r), fmt(r.amount), r.payer || '—', r.note || '—']), total: v.trips ? ['الإجمالي', fmt(v.total), '', ''] : null,
        note: trNote(rows), source: TR_SRC, empty: 'مفيش مشاوير متسجلة.' };
    }
    const list = all.byVendor;
    if (name === '') return { title: 'مواصلات المبتكرين' + (open ? ' اللي لسه ماتصفّتش' : '') + ' — ' + fmt(all.vendors) + ' ج.م', sub: all.vendorTrips + ' مشوار لـ ' + all.vendorCount + ' مبتكرين · ' + trPeriod(all) + ' · اضغط على أي مبتكر يفتح ملفه',
      summary: [{ label: 'الإجمالي', value: fmt(all.vendors) + ' ج.م' }, { label: 'المشاوير', value: String(all.vendorTrips) }, { label: 'أعلى مبتكر', value: list.length ? list[0].name + ' — ' + fmt(list[0].total) : '—' }],
      headers: ['المبتكر', 'المواصلات (ج.م)', 'المشاوير', 'آخر مشوار', 'من الإجمالي'], rows: list.map((r) => [r.name, fmt(r.total), String(r.trips), D.formatDateNumeric(r.last), D.formatPct(all.vendors ? r.total / all.vendors : 0)]),
      total: ['الإجمالي', fmt(all.vendors), String(all.vendorTrips), '', '100%'], onRow: (i) => openByName(list[i].name), source: TR_SRC };
    return { title: 'المواصلات — ' + fmt(all.total) + ' ج.م', sub: all.trips + ' مشوار · ' + trPeriod(all),
      summary: [{ label: 'للمبتكرين', value: fmt(all.vendors) + ' ج.م' }, { label: 'تشغيل', value: fmt(all.ops) + ' ج.م' }, { label: 'المشاوير', value: String(all.trips) }],
      headers: ['البند', 'المبلغ (ج.م)', 'المشاوير', 'من الإجمالي'],
      rows: list.map((r) => ['مبتكر · ' + r.name, fmt(r.total), String(r.trips), D.formatPct(all.total ? r.total / all.total : 0)]).concat([['تشغيل (مشاوير مش لمبتكر معيّن)', fmt(all.ops), String(all.opsTrips), D.formatPct(all.total ? all.ops / all.total : 0)]]),
      total: ['الإجمالي', fmt(all.total), String(all.trips), '100%'],
      note: 'التشغيل = مشاوير الفريق (تجميع، استلام، استبدال) اللي مش متسجلة باسم مبتكر في الشيت. مشاوير المرتجعات مش محسوبة في المواصلات.', source: TR_SRC };
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
      onRow: (i) => showOrders({ q: r.rows[i].oid }), phone: v && v.phone, email: v && v.email, empty: 'مفيش أوردرات مكتملة أو ملغية للمبتكر ده.', note: brandNote(v) || null, source: 'الأوردرات (الموقع) + مستحقات المرحلة 3' }, { label: 'تقرير ' + name });
  }


  // ---------- data export / import (owner 22 Oct): one spec per group — fields, rows, and (for importable groups) how rows are written + undone ----------
  const IBData = (() => {
    const K = () => window.IBKit; const ST = () => ((window.OrdersApp && window.OrdersApp.statuses && window.OrdersApp.statuses()) || []);
    const VST = [['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط']]; const vst = (c) => (VST.find((x) => x[0] === c) || [, c])[1]; const vcode = (l) => (VST.find((x) => x[1] === l) || [l])[0];
    const SET = () => window.IBPages.all().settings; const sapi = () => (SET() && SET().api) || {};
    // helpers for the import groups (owner 22 Oct: everything can be imported and exported)
    const OPS = () => window.IbtekrOps; const DX = () => window.IbtekrDataX; const csData = () => window.IBPages.all().cs.api.data;
    const vnames = () => vendorsNow().map((v) => v.name);
    const POPUP_SS = ['وصل المخزن', 'مرتجع للمخزن', 'مرتجع للمبتكر'];
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
          { key: 'status', label: 'حالة الأوردر', en: 'Order status' }, { key: 'confirm', label: 'حالة التأكيد', en: 'Confirmation' }, { key: 'vendor', label: 'المبتكر', en: 'Vendor' }, { key: 'product', label: 'المنتج', en: 'Product' }, { key: 'sku', label: 'SKU', en: 'SKU' }, { key: 'qty', label: 'الكمية', en: 'Qty', type: 'number' }, { key: 'total', label: 'القيمة (ج.م)', en: 'Amount (EGP)', type: 'number' }, { key: 'subStatus', label: 'حالة الفرعي', en: 'Sub-order status' }],
        presets: { accountant: ['oid', 'date', 'status', 'vendor', 'total'], vendor: ['oid', 'sid', 'date', 'product', 'sku', 'qty', 'total', 'subStatus'] },
        rows: () => { const A = OA(); if (!A || !A.query) return []; return A.query({}, 10000).rows.map((r) => A.get(r.id)).filter(Boolean).flatMap((o) => o.subs.map((x) => ({ oid: o.id, sid: x.sid, date: o.date, customer: o.name, phone: o.phone, status: o.st, confirm: o.cf, vendor: x.vendor, product: x.prod, sku: x.sku, qty: x.qty, total: x.tot, subStatus: x.ss || '' }))); } },
      { id: 'vendors', label: 'المبتكرين والنسب', key: 'name', modes: ['add', 'update'], filter: { key: 'status', label: 'الحالة', options: () => VST.map((x) => x[1]) },
        fields: () => [{ key: 'name', label: 'اسم المبتكر', en: 'Vendor name', required: true }, { key: 'legalName', label: 'الاسم التجاري', en: 'Legal name' }, { key: 'category', label: 'الفئة', en: 'Category', type: 'enum', options: (vstore.mainCategories ? vstore.mainCategories() : []).map((c) => c.name), required: true } /* B2 (0080): one of the site's main categories by name */, { key: 'status', label: 'الحالة', en: 'Status', type: 'enum', options: VST.map((x) => x[1]), required: true },
          { key: 'phone', label: 'الموبايل (واتساب)', en: 'Phone', type: 'phone', required: true, sensitive: true }, { key: 'email', label: 'الإيميل', en: 'Email', type: 'email' }, { key: 'rate', label: 'نسبة إبتكر %', en: 'Ibtekr %', type: 'number', required: true, noUpdate: true }, { key: 'leadDays', label: 'مدة التجهيز (يوم)', en: 'Lead days', type: 'number', required: true }, { key: 'address', label: 'العنوان', en: 'Address' },
          { key: 'balance', label: 'الرصيد', en: 'Balance', type: 'number', readOnly: true }, { key: 'transport', label: 'المواصلات', en: 'Transport', type: 'number', readOnly: true }, { key: 'deposits', label: 'العرابين', en: 'Deposits', type: 'number', readOnly: true }],
        presets: { accountant: ['name', 'rate', 'balance', 'transport', 'deposits'], vendor: ['name', 'category', 'leadDays'] },
        rows: () => { const bal = vendorsNow(); return vstore.all().map((v) => { const b = bal.find((x) => VD.norm(x.name) === VD.norm(v.name)) || {}; return { name: v.name, legalName: v.legalName || '', category: v.category, status: vst(v.status), phone: v.phone, email: v.email || '', rate: v.rate, leadDays: v.leadDays, address: v.address || '', balance: b.balance || 0, transport: b.transport || 0, deposits: b.deposits || 0 }; }); },
        existing: () => vstore.all().map((v) => v.name),
        apply: (rows, onMatch) => { const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const ex = vstore.findByName(d.name);
            const input = { name: d.name, legalName: d.legalName, categories: vstore.mainCategoryIds ? vstore.mainCategoryIds(d.category) : [], status: vcode(d.status), phone: d.phone, email: d.email, rate: d.rate, leadDays: d.leadDays, address: d.address };
            if (ex && onMatch === 'تخطّي') continue;
            if (ex && onMatch !== 'إنشاء نسخة') { const patch = {}; ['legalName', 'categories', 'status', 'phone', 'email', 'leadDays', 'address'].forEach((k) => { if (input[k] !== undefined && input[k] !== '' && !(Array.isArray(input[k]) && !input[k].length)) patch[k] = input[k]; }); const old = {}; Object.keys(patch).forEach((k) => { old[k] = ex[k]; }); vstore.update(ex.id, patch, vstore.actor()); done.updated.push({ id: ex.id, old }); }
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
        fields: () => [{ key: 'sku', label: 'SKU', en: 'SKU', required: true }, { key: 'name', label: 'المنتج', en: 'Product', required: true }, { key: 'vendor', label: 'المبتكر', en: 'Vendor', type: 'enum', options: vnames(), required: true },
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
          { key: 'orderId', label: 'رقم الأوردر', en: 'Order #' }, { key: 'customer', label: 'العميل', en: 'Customer' }, { key: 'vendor', label: 'المبتكر', en: 'Vendor' }, { key: 'reason', label: 'السبب', en: 'Reason', type: 'enum', options: TK.CUSTOMER_REASONS.concat(TK.VENDOR_REASONS.filter((x) => !TK.CUSTOMER_REASONS.includes(x))) },
          { key: 'status', label: 'الحالة', en: 'Status', readOnly: true }, { key: 'created', label: 'تاريخ الإنشاء', en: 'Created', type: 'date', readOnly: true }],
        rows: () => tstore.all().map((t) => ({ id: t.id, type: TK.label(TK.TYPES, t.type), title: t.title, description: t.description, priority: TK.label(TK.PRIORITIES, t.priority), role: t.assigneeRole, orderId: t.orderId || '', customer: t.customer || '', vendor: t.vendor || '', reason: t.reason || '', status: t.status, created: String(t.createdAt || '').slice(0, 10) })),
        check: (d) => ({ errors: Object.values(TK.validateTicket(tkIn(d))) }),
        // phase 8: each row is a new ticket through IBTickets (ticket_create — the server's rules); no undo (decision 13: no delete)
        apply: (rows) => { const A = window.IBTickets; const done = { created: [], updated: [] }; const list = rows.map((r) => tkIn(r.data)).filter((d) => !Object.keys(TK.validateTicket(d)).length);
          if (A) list.reduce((p, d) => p.then(() => A.create(d)), Promise.resolve()).then(() => { const K = window.IBKit; if (K) K.toast('اتعمل ' + list.length + ' تذكرة من الاستيراد'); });
          list.forEach((d) => done.created.push(d.title));
          return { done, undo: () => { const K = window.IBKit; if (K) K.toast('التذاكر اتكتبت في السيستم — مافيش مسح، اقفل الغلط بنتيجة «مكرر»'); } }; } },
      { id: 'transport', label: 'المواصلات (المشاوير)', key: ['date', 'amount', 'vendor'], modes: ['add'], dateKey: 'date', filter: { key: 'vendor', label: 'المبتكر', options: () => [...new Set(transportRows().map((r) => r.vendor || 'تشغيل'))] },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'amount', label: 'المبلغ (ج.م)', en: 'Amount (EGP)', type: 'number', required: true }, { key: 'vendor', label: 'المبتكر (أو تشغيل)', en: 'Vendor (or ops)', type: 'enum', options: ['تشغيل'].concat(vnames()), required: true },
          { key: 'payer', label: 'دفع', en: 'Paid by' }, { key: 'note', label: 'ملاحظة / المكان', en: 'Note' }],
        rows: () => transportRows().map((r) => ({ date: r.date, amount: r.amount, vendor: r.vendor || 'تشغيل', payer: r.payer, note: r.note })),
        existing: () => transportRows().map((r) => DX().keyOf({ date: r.date, amount: r.amount, vendor: r.vendor || 'تشغيل' }, ['date', 'amount', 'vendor'])),
        apply: (rows) => { const made = [];
          for (const r of rows) { const d = r.data;
            if (d.vendor === 'تشغيل') { const t = { date: d.date, dateFixed: false, raw: d.date, amount: d.amount, vendor: null, scope: 'ops', payer: d.payer || '', note: d.note || '', place: d.note || '' }; TR_SHEET.push(t); made.push(['ops', t]); }
            else { const res = D.validateVendorMovement({ amount: String(d.amount), date: D.formatDateNumeric(d.date), direction: 'withdraw', type: 'مواصلات', vendor: d.vendor }); if (Object.keys(res.errors).length) continue; made.push(['v', adapter.add('vendorMoves', res.value).id]); } }
          return { done: { created: made, updated: [] }, undo: () => made.forEach(([k, x]) => { if (k === 'ops') { const i = TR_SHEET.indexOf(x); if (i >= 0) TR_SHEET.splice(i, 1); } else adapter.remove('vendorMoves', x); }) }; } },
      { id: 'vendorMoves', label: 'حركات المبتكرين (عربون / مواصلات / أخرى)', modes: ['add'], dateKey: 'date', filter: { key: 'type', label: 'النوع', options: () => D.VENDOR_TYPES.slice() },
        fields: () => [{ key: 'date', label: 'التاريخ', en: 'Date', type: 'date', required: true }, { key: 'vendor', label: 'المبتكر', en: 'Vendor', type: 'enum', options: vnames(), required: true }, { key: 'type', label: 'النوع', en: 'Type', type: 'enum', options: D.VENDOR_TYPES.slice(), required: true },
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
          { key: 'accountNumber', label: 'رقم الحساب', en: 'Account number', sensitive: true }, { key: 'iban', label: 'IBAN', en: 'IBAN', sensitive: true }, { key: 'wallet', label: 'رقم المحفظة', en: 'Wallet #', sensitive: true }, { key: 'contractExpires', label: 'العقد ينتهي في', en: 'Contract expires', type: 'date' },
          { key: 'rate', label: 'نسبة إبتكر الجديدة %', en: 'New Ibtekr %', type: 'number' }],
        rows: () => vstore.all().map((v) => ({ name: v.name, method: v.bank ? (VD.PAY_METHODS.find((x) => x[0] === v.bank.method) || [, ''])[1] : '', bankName: v.bank && v.bank.bankName || '', holder: v.bank && v.bank.holder || '', accountNumber: v.bank && v.bank.accountNumber || '', iban: v.bank && v.bank.iban || '', wallet: v.bank && v.bank.wallet || '', contractExpires: v.contract && v.contract.expires || '', rate: v.rate })),
        existing: () => vstore.all().map((v) => v.name),
        check: (d) => { const e = []; const v = vstore.findByName(d.name); if (d.rate !== undefined && d.rate !== '' && (d.rate < 0 || d.rate > 65)) e.push('النسبة لازم بين 0 و 65'); if (d.contractExpires && v && !(v.contract && v.contract.fileName)) e.push('مفيش عقد مرفوع للمبتكر ده — ارفعه الأول من ملفه'); return { errors: e }; },
        apply: (rows) => { const done = { created: [], updated: [] };
          for (const r of rows) { const d = r.data; const v = vstore.findByName(d.name); if (!v) continue; const u = { id: v.id, snap: vstore.get(v.id) };
            const bk = ['method', 'bankName', 'holder', 'accountNumber', 'iban', 'wallet'].filter((k) => d[k] !== undefined && d[k] !== '');
            if (bk.length) { const nb = Object.assign({}, v.bank || {}); bk.forEach((k) => { nb[k] = k === 'method' ? (VD.PAY_METHODS.find((x) => x[1] === d.method) || ['bank'])[0] : d[k]; }); vstore.setBank(v.id, nb, vstore.actor()); }
            if (d.contractExpires) vstore.setContract(v.id, Object.assign({}, v.contract, { expires: d.contractExpires }), vstore.actor());
            if (d.rate !== undefined && d.rate !== '') vstore.setRate(v.id, d.rate, null, vstore.actor());
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
      { id: 'subEdit', label: 'الأوردرات الفرعية — الحالة والميعاد وتعليق المبتكر', key: 'sid', modes: ['update'], note: 'تعديل بس. «وصل المخزن» و«مرتجع» بيتغيّروا من الأوردر نفسه عشان محتاجين بيانات إضافية.',
        fields: () => [{ key: 'sid', label: 'الأوردر الفرعي', en: 'Sub-order #', required: true }, { key: 'oid', label: 'رقم الأوردر', en: 'Order #', readOnly: true }, { key: 'product', label: 'المنتج', en: 'Product', readOnly: true }, { key: 'vendor', label: 'المبتكر', en: 'Vendor', readOnly: true },
          { key: 'subStatus', label: 'حالة الأوردر الفرعي', en: 'Sub-order status', type: 'enum', options: (OA() && OA().subStatuses ? OA().subStatuses() : []).filter((x) => !POPUP_SS.includes(x)) }, { key: 'expected', label: 'ميعاد التسليم المتوقع', en: 'Expected delivery', type: 'date' }, { key: 'vendorComment', label: 'تعليق المبتكر', en: 'Vendor comment' }],
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
      // phase 6: the customers live in cs_customers — the import writes through IBCS (a new phone = a lead, created_from import; a known
      // phone = the profile fields, cs.manage); templates / quick replies are postponed with «الرد الآلي» and are not imported
      { id: 'customers', label: 'العملاء (خدمة العملاء)', key: 'phone', modes: ['add', 'update'],
        fields: () => [{ key: 'name', label: 'الاسم', en: 'Name', required: true }, { key: 'phone', label: 'الموبايل', en: 'Phone', type: 'phone', required: true, sensitive: true }, { key: 'city', label: 'المدينة / المنطقة', en: 'City' }, { key: 'address', label: 'العنوان', en: 'Address', sensitive: true },
          { key: 'tags', label: 'التاجات (افصلهم بـ ،)', en: 'Tags' }, { key: 'consent', label: 'موافق على الرسايل التسويقية', en: 'Marketing consent', type: 'enum', options: ['نعم', 'لا'] }, { key: 'source', label: 'جه منين', en: 'Source' }],
        rows: () => csData().customers.map((c) => ({ name: c.name, phone: c.phone, city: c.city || '', address: c.address || '', tags: (c.tags || []).join('، '), consent: c.consent ? 'نعم' : 'لا', source: c.source || '' })),
        existing: () => csData().customers.map((c) => c.phone),
        apply: (rows, onMatch) => {
          const A = window.IBCS; const CSD = window.IbtekrCS; const list = csData().customers; const done = { created: [], updated: [] }; const adds = [];
          for (const r of rows) { const d = r.data; const ph = CSD && CSD.normPhone ? CSD.normPhone(d.phone) : d.phone; const ex = list.find((x) => x.phone === ph);
            if (ex) { if (onMatch === 'تخطّي') continue; const p = {}; ['name', 'city', 'address', 'source'].forEach((k) => { if (d[k]) p[k] = d[k]; }); if (d.tags) p.tags = splitTags(d.tags); if (d.consent) { p.consent = d.consent === 'نعم'; p.autoConsent = p.consent; } if (A) A.updateCustomer(ex.id, p); done.updated.push({ ex, old: {} }); }
            else { adds.push({ phone: ph, name: d.name, city: d.city, address: d.address, source: d.source || 'استيراد شيت', tags: splitTags(d.tags), consent: d.consent !== 'لا' }); done.created.push(d); } }
          if (A && adds.length) A.importCustomers(adds);
          return { done, undo: () => { const K = window.IBKit; if (K) K.toast('الاستيراد اتكتب في السيستم — مفيش تراجع تلقائي'); } };
        } },
      { id: 'delayRules', label: 'قواعد التأخير لكل مبتكر', key: 'maker', modes: ['add', 'update'],
        fields: () => [{ key: 'maker', label: 'المبتكر', en: 'Vendor', type: 'enum', options: vnames(), required: true }, { key: 'lead', label: 'مدة التصنيع (يوم)', en: 'Lead time (days)', required: true }, { key: 'risk', label: 'قابل للتأخير من يوم', en: 'At risk from day', type: 'number', required: true }, { key: 'late', label: 'متأخر بعد يوم', en: 'Late after day', type: 'number', required: true }],
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
  // phase 13 decision 61 (owner 11 Nov — «ضيف في الحسابات قسم نظرة عامة في الأول وتقارير في آخر قسم»): acc-overview first, acc-reports last
  const TABS = [{ id: 'acc-overview', label: 'نظرة عامة' }, { id: 'expenses', label: 'المصروفات' }, { id: 'subscriptions', label: 'الاشتراكات' }, { id: 'sales', label: 'المبيعات' }, { id: 'vendors', label: 'حسابات المبتكرين' }, { id: 'actual', label: 'الحساب الفعلي' }, { id: 'moves-log', label: 'سجل الحركات' }, { id: 'acc-reports', label: 'التقارير' }];
  const PRESETS = [['today', 'اليوم'], ['yesterday', 'أمس'], ['todayYesterday', 'اليوم وأمس'], ['last7', 'آخر 7 أيام'], ['last14', 'آخر 14 يومًا'], ['last28', 'آخر 28 يومًا'], ['last30', 'آخر 30 يومًا'], ['thisWeek', 'هذا الأسبوع'], ['lastWeek', 'الأسبوع الماضي'], ['thisMonth', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['max', 'أقصى فترة'], ['custom', 'مخصص']];
  const SORTS = [
    { value: 'balance:desc', label: 'الرصيد: من الأعلى للأقل', key: 'balance', dir: 'desc' }, { value: 'balance:asc', label: 'الرصيد: من الأقل للأعلى', key: 'balance', dir: 'asc' },
    { value: 'deposits:desc', label: 'العربون: من الأعلى للأقل', key: 'deposits', dir: 'desc' }, { value: 'deposits:asc', label: 'العربون: من الأقل للأعلى', key: 'deposits', dir: 'asc' }];
  // phase 4: the accounts range starts on the current month (Cairo); the September report is gone
  const state = { tab: 'expenses', range: { from: TODAY.slice(0, 8) + '01', to: TODAY, preset: 'custom' }, sort: 'balance:desc', note: null, mlog: 'expenses', mlogQ: '' };
  const hashTab = () => { const t = location.hash.slice(1); return TABS.some((x) => x.id === t) ? t : null; };
  state.tab = hashTab() || 'expenses';
  // phase 9 (docs/superpowers/plans/2026-11-05-phase-9-reports.md, decisions 4 / 6): the v2's nine tabs — a tab shows only with reports.view ≠ N
  // and its page's view permission; «الحملات الإعلانية» opened with the ads numbers (phase 9.5.3 decision 47: marketing.view) — «تقارير الموظفين» opened with HR (phase 10 T8). CSV and
  // «الإجراءات» need reports.export = F. The server stays the judge: every number is read under its table's RLS.
  const REPORT_TABS = [{ id: 'orders', label: 'تقارير الأوردرات', perm: 'orders.view' }, { id: 'vendors', label: 'تقارير المبتكرين', perm: 'vendors.view' }, { id: 'accounts', label: 'تقارير الحسابات', perm: 'accounts.view' }, { id: 'products', label: 'تقارير المنتجات', perm: 'products.view' },
    { id: 'staff', label: 'تقارير الموظفين', perm: 'hr.view' }, { id: 'campaigns', label: 'الحملات الإعلانية', perm: 'marketing.view' }, { id: 'inventory', label: 'تقارير المخزن', perm: 'inventory.view' }, { id: 'cs', label: 'تقارير خدمة العملاء', perm: 'cs.view' }, { id: 'tickets', label: 'تقارير التذاكر', perm: 'tickets.view' }];
  const reportTabOf = (hash) => { const m = /^reports(?:-(orders|vendors|accounts|products|staff|campaigns|inventory|cs|tickets))?$/.exec(hash); return m ? (m[1] || 'orders') : null; };
  const rperm = (k) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(k) : 'N');
  const reportTabs = () => (rperm('reports.view') === 'N' ? [] : REPORT_TABS.filter((t) => !t.perm || rperm(t.perm) !== 'N'));
  const rCanExport = () => rperm('reports.export') === 'F';
  state.rtab = reportTabOf(location.hash.slice(1)) || 'orders';
  state.rrange = Object.assign(D.presetRange('last30', TODAY), { preset: 'last30' });
  state.rcompare = false;
  const ticketOf = (hash) => { const m = /^tickets(?:\/(TKT-\d{4,}))?$/.exec(hash); return m ? (m[1] || '') : null; };
  const vendorOf = (hash) => { const m = /^makers(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new))?$/i.exec(hash); return m ? (m[1] || '') : null; }; // #makers/<vendor uuid> (phase 3) — '#vendors' stays the accounts tab; #makers/new = the add-maker popup (phase 13 decision 16: the quick action)
  const modPage = (hs) => (window.IBPages ? window.IBPages.match(hs) : null);
  const pageOfHash = (hs) => modPage(hs) || (hs === 'orders' ? 'orders' : reportTabOf(hs) ? 'reports' : ticketOf(hs) !== null ? 'tickets' : vendorOf(hs) !== null ? 'vendors' : 'accounts');
  // Phase 3.6 (plan decision 5): the pages not built on real data yet are closed — «soon» in the menus; any way in (a link, an
  // alert, a typed hash) lands on the dashboard with a note. Open: لوحة التحكم، الأوردرات، المبتكرين، and «ملفي» (account menu).
  // phase 5 (plan decision 2): «المنتجات» is open (app/js/pages/products.js) — the owner chose it before «المخزون»
  const SOON = []; // phase 11: «الإعدادات» opened (settings) — the whole page on IBSettings; phase 9.5.1: «التسويق» opened (marketing); phase 6: «خدمة العملاء» opened (cs); «الرد الآلي» stays postponed; phase 7: «المخزون» opened (inventory); phase 8: «تذاكر الفريق» opened (tickets); phase 9: «التقارير» opened (reports) phase 10: «الموارد البشرية» opened (hr).
  const isSoon = (page) => SOON.includes(page);
  const soonNote = () => { if (window.IBKit && window.IBKit.toast) window.IBKit.toast('الصفحة دي لسه — soon'); };
  state.page = pageOfHash(location.hash.slice(1));
  if (isSoon(state.page)) { state.page = 'dashboard'; try { history.replaceState(null, '', '#dashboard'); } catch (e) { /* sandboxed */ } }

  // ---------- derived helpers ----------
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function monthOfRange(r) { const [y, m] = r.from.split('-').map(Number); return r.from === y + '-' + String(m).padStart(2, '0') + '-01' && r.to === y + '-' + String(m).padStart(2, '0') + '-' + String(lastDay(y, m)).padStart(2, '0') ? { y, m } : null; }
  function seedKeysIn(r) { return Object.keys(SEED.expenseSeed).filter((k) => { const [y, m] = k.split('-').map(Number); return k + '-01' >= r.from && k + '-' + lastDay(y, m) <= r.to; }); }
  const inRange = (d) => d >= state.range.from && d <= state.range.to;
  // Owner (22 Oct): transport is deducted from the vendor balance. «مواصلات» moves count once, as transport (not as a deposit move).
  // phase 9: vendorsOf(list) is the same derivation for another seed's makers (the reports page's range — VendorsReportView)
  // 0078 (the owner, 11 Nov): «الصافي» = رصيد Dokan − the moves not settled yet (a «سحب» deducts even below zero, a «إيداع» corrects)
  // − what the last settlement left on the maker; a settled move was counted in the approved request (Dokan lowered its balance)
  const vendorsOf = (list) => { const by = {}; transportRows(true).forEach((r) => { if (r.vendor) by[r.vendor] = (by[r.vendor] || 0) + r.amount; });
    const open = store.vendorMoves.filter((m) => m.settledBy == null && !(m.type === 'مواصلات' && m.direction === 'withdraw'));
    return D.withCarry(D.deductTransport(D.deriveVendors(list.map((v) => ({ ...v })), open), by), ACC() && ACC().carryOf ? ACC().carryOf() : {}); };
  const vendorsNow = () => vendorsOf(SEED.vendors);
  const accountsNow = () => D.deriveAccounts(SEED.accounts, store.accountMoves);
  const setNote = (n) => { state.note = n; };

  // ---------- shell ----------
  const NAV = [['home', 'لوحة التحكم', 'dashboard'], ['box', 'الأوردرات', 'orders'], ['users', 'المبتكرين', 'vendors'], ['wallet', 'الحسابات', 'accounts'], ['tag', 'المخزون', 'inventory'], ['package', 'المنتجات', 'products'], ['headset', 'خدمة العملاء', 'cs'], ['bot', 'الرد الآلي', 'autoreply'], ['ticket', 'طلبات الفريق', 'tickets'], ['chart', 'التقارير', 'reports'], ['megaphone', 'التسويق', 'marketing'], ['briefcase', 'الموارد البشرية', 'hr'], ['gear', 'الإعدادات', 'settings']];
  const soonTag = () => h('span', { class: 'soon' }, 'soon');
  function Sidebar() {
    return h('nav', { class: 'sidebar', 'aria-label': 'القائمة الرئيسية' },
      h('a', { class: 'brand', href: '#dashboard', 'aria-label': 'إبتكر كلوب — بيت لكل مبتكر' }, window.IBLogo.Logo({ tone: 'reversed', width: 150 }), h('small', { class: 'tagline' }, window.IBLogo.TAGLINE)),
      NAV.map(([ic, lb, page]) => isSoon(page) ? h('button', { type: 'button', class: 'nav-item', 'data-page': page, 'data-soon': '', 'aria-disabled': 'true', title: lb + ' — soon', onClick: soonNote }, Icon(ic), h('span', null, lb), soonTag())
        : h('button', { type: 'button', class: 'nav-item', 'data-page': page || false, 'aria-disabled': page ? false : 'true', title: page ? lb : lb + ' — غير متاح في النموذج', onClick: page ? () => goHome(page) : null }, Icon(ic), h('span', null, lb))));
  }
  // Bottom nav (mobile <=767) — Figma: Bottom nav 266:478 / Bottom nav item 266:476. 5 items; «المزيد» opens a sheet with the rest of the menu.
  const BN = [['box', 'الأوردرات', 'orders'], ['users', 'المبتكرين', 'vendors'], ['wallet', 'الحسابات', 'accounts'], ['ticket', 'طلبات الفريق', 'tickets']];
  function BottomNav() {
    const item = (ic, lb, page, extra) => isSoon(page) ? h('button', { type: 'button', class: 'bn-item', 'data-page': page, 'data-soon': '', 'aria-disabled': 'true', title: lb + ' — soon', onClick: soonNote }, h('span', { class: 'pill' }, Icon(ic)), h('span', { class: 'bn-lbl' }, lb), soonTag())
      : h('button', Object.assign({ type: 'button', class: 'bn-item', 'data-page': page || false, onClick: page ? () => goHome(page) : null }, extra || {}), h('span', { class: 'pill' }, Icon(ic)), h('span', { class: 'bn-lbl' }, lb));
    const wrap = h('div', { class: 'pop-anchor bn-more', 'data-popover-root': '' });
    const more = item('more', 'المزيد', null, { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const pop = U.popover(wrap, more, (close) => h('div', { class: 'menu bn-sheet', role: 'dialog', 'aria-label': 'القائمة', 'data-popover-root': '' },
      h('div', { class: 't-label bn-sheet-h' }, 'القائمة'),
      NAV.map(([ic, lb, page]) => isSoon(page) ? h('button', { type: 'button', role: 'menuitem', class: 'opt bn-opt', 'data-page': page, 'data-soon': '', 'aria-disabled': 'true', onClick: soonNote }, Icon(ic), h('span', null, lb), h('small', null, 'soon'))
        : h('button', { type: 'button', role: 'menuitem', class: 'opt bn-opt', 'data-page': page || false, 'aria-disabled': page ? false : 'true', 'aria-current': page && page === state.page ? 'page' : false, onClick: page ? () => { close(); goHome(page); } : null }, Icon(ic), h('span', null, lb), page ? null : h('small', null, 'غير متاح في النموذج')))));
    more.addEventListener('click', () => pop.toggle()); wrap.append(more);
    return h('nav', { class: 'bottom-nav', 'aria-label': 'القائمة السفلية' }, BN.map(([ic, lb, page]) => item(ic, lb, page)), wrap);
  }
  // phase 13 decision 18 (owner 10 Nov — «لو اخترت حاجة من المقترحات يفتحلي النتيجة في popup من غير ما ينقلني»): a team member from the header
  // search in a popup over the current page — what the search row already shows plus the role, department and manager; «افتح الملف» goes to the full profile.
  function memberPeek(m) {
    const MB = (window.IBKit && window.IBKit.store.members) || []; const mgr = m.manager ? MB.find((x) => x.id === m.manager || x.uid === m.manager) : null;
    const rows = [['الكود', m.id], ['الدور', m.role], ['الوظيفة', m.title], ['القسم', m.dept], ['الموبايل', m.phone], ['الإيميل', m.email], ['المدير المباشر', mgr && mgr.name]].filter(([, v]) => v);
    const md = U.Modal({ title: m.name, body: [h('dl', { class: 'kv', 'data-member-peek': m.id }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]))],
      footer: [Button({ label: 'إغلاق', onClick: () => md.close() }), Button({ type: 'primary', icon: 'users', label: 'افتح الملف', attrs: { 'data-member-open': '' }, onClick: () => { md.close(); location.hash = 'member-' + m.id; } })] });
  }
  function TopHeader() {
    // بحث عام (phase 5.5 decision 7, owner 1 Nov): أوردرات + عملاء + مبتكرين + موظفين بالاسم أو الرقم أو الهاتف في قايمة نتايج؛ Enter = فلترة الأوردرات
    // («عملاء» — decision 14, 6 Nov: خدمة العملاء اتبنت — الـ v5 بالحرف: IBCS.data.customers عبر صفحة cs، والضغطة بتفتح ملف العميل)
    const q = h('input', { id: 'gq', type: 'search', placeholder: 'ابحث برقم الأوردر أو الاسم أو الهاتف', 'aria-label': 'بحث عام: أوردرات، عملاء، مبتكرين، موظفين', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'gq-res', 'aria-autocomplete': 'list' });
    const res = h('div', { id: 'gq-res', class: 'menu gq-res', 'aria-label': 'نتايج البحث', hidden: true }); // role=listbox only while open (a hidden listbox would still match the dropdown locators)
    const norm = (x) => String(x || '').toLowerCase().replace(/[\s\-+]/g, '').replace(/^ib-?/, '');
    const hit = (needle, ...fields) => fields.some((f) => norm(f).includes(needle));
    const closeRes = () => { res.hidden = true; res.removeAttribute('role'); q.setAttribute('aria-expanded', 'false'); };
    const toOrders = () => { closeRes(); if (state.page !== 'orders') go('orders'); if (window.OrdersApp) window.OrdersApp.setQuery(q.value); };
    const search = (raw) => {
      const n = norm(raw); if (n.length < 2) return [];
      const out = [];
      const OA = window.OrdersApp; if (OA && OA.query) { const r = OA.query({ q: raw.trim() }, 4); r.rows.forEach((o) => out.push({ g: 'أوردرات', t: 'IB-' + o.id + ' · ' + o.customer, s: o.status + ' · ' + D.formatMoney(o.total) + ' ج.م', run: () => { closeRes(); if (!(OA.peek && OA.peek(o.id))) OA.details(o.id); } })); if (r.total > 4) out.push({ g: 'أوردرات', t: 'كل الأوردرات المطابقة (' + r.total + ')', s: 'فلترة صفحة الأوردرات', run: toOrders }); }
      const cs = window.IBPages && window.IBPages.all().cs; const custs = cs && cs.api && cs.api.data && rperm('cs.view') !== 'N' ? cs.api.data.customers || [] : [];
      custs.filter((c) => hit(n, c.name, c.phone, c.ig, (c.orderList || []).map((o) => o[0]).join(' '))).slice(0, 4).forEach((c) => out.push({ g: 'عملاء', t: c.name, s: [c.phone || c.ig || '', (c.orders || 0) + ' أوردر'].filter(Boolean).join(' · '), run: () => { closeRes(); if (!(cs.api.peekCustomer && cs.api.peekCustomer(c.id))) cs.api.openCustomer(c.id); } }));
      vstore.all().filter((v) => hit(n, v.name, v.phone, v.altPhone, (v.aliases || []).join(' '), v.contactName)).slice(0, 4).forEach((v) => out.push({ g: 'مبتكرين', t: v.name, s: [v.phone, v.category].filter(Boolean).join(' · '), run: () => { closeRes(); if (state.page === 'vendors') openVendor(v.id); else openVendor(v.id, { inPlace: true }); } }));
      ((window.IBKit && window.IBKit.store.members) || []).filter((m) => m.status === 'active' && hit(n, m.name, m.phone, m.id, m.email)).slice(0, 4).forEach((m) => out.push({ g: 'موظفين', t: m.name, s: [m.title, m.phone].filter(Boolean).join(' · '), run: () => { closeRes(); memberPeek(m); } }));
      return out;
    };
    let items = []; let act = -1;
    const paint = () => { const L = search(q.value); items = L; act = -1;
      if (!q.value.trim() || norm(q.value).length < 2) { closeRes(); return; }
      const groups = [...new Set(L.map((x) => x.g))];
      res.replaceChildren(...(L.length ? groups.flatMap((g) => [h('div', { class: 'opt-group t-small', role: 'presentation' }, g)].concat(L.filter((x) => x.g === g).map((x) => { const b = h('button', { type: 'button', class: 'opt gq-opt', role: 'option', 'aria-selected': 'false', 'data-gq-group': g, onClick: () => x.run() }, h('b', null, x.t), h('small', { class: 't-small help' }, x.s)); b.addEventListener('mousedown', (e) => e.preventDefault()); x.el = b; return b; })))
        : [h('div', { class: 'gq-empty t-small' }, 'مفيش نتايج لـ «' + q.value.trim() + '» — جرّب رقم أوردر أو اسم أو رقم تليفون')]));
      res.hidden = false; res.setAttribute('role', 'listbox'); q.setAttribute('aria-expanded', 'true'); };
    const mark = (i) => { items.forEach((x, j) => x.el && x.el.setAttribute('aria-selected', String(j === i))); act = i; if (items[i] && items[i].el) items[i].el.scrollIntoView({ block: 'nearest' }); };
    let tmr = null;
    q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(paint, 150); if (state.page === 'orders' && window.OrdersApp) window.OrdersApp.setQuery(q.value); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); mark(Math.min(items.length - 1, act + 1)); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); mark(Math.max(0, act - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (act > -1 && items[act]) items[act].run(); else toOrders(); }
      else if (e.key === 'Escape') closeRes(); });
    q.addEventListener('blur', () => setTimeout(closeRes, 150));
    q.addEventListener('focus', () => { if (q.value.trim()) paint(); });
    return h('header', { class: 'topbar' },
      h('div', { class: 'gq-wrap' }, h('label', { class: 'search' }, Icon('search', 'sm'), q), res),
      AiButton(),
      window.IBQuick ? window.IBQuick.Menu() : null, // phase 11 (decision 23): the quick actions from the settings row «quick»
      NotificationsMenu(),
      window.IBShell.ClockWidget(),
      window.IBShell.AccountMenu(goHome)); // decision 21: «ملفي» / «الإعدادات» open their main view
  }
  function showPage() {
    document.getElementById('main').hidden = state.page !== 'accounts';
    const ordersHost = document.getElementById('orders'); if (state.page === 'orders') ordersHost.classList.remove('peek'); ordersHost.hidden = state.page !== 'orders' && !ordersHost.classList.contains('peek'); // decision 18: an order opened from the search keeps its popup
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
  // phase 13 decision 17 (owner 10 Nov — «لما ادوس علي اي صفحة يجيبلي الصفحة الرئيسية ليها»): a menu click always opens the page's main view.
  // Every page keeps where it was (a tab, a product being edited, a campaign step, another member's profile) and defaultHash() repeats it,
  // so the menu resets that state to the page's root hash first — the modular pages through their own hash parser, the block pages here.
  // The unsaved-changes guard runs even on the same page (a product edit, the settings draft). Internal callers that set a tab and
  // then go() (the bell, the search, the quick actions, the assistant, direct links) keep go().
  function goHome(page) {
    if (isSoon(page)) { goNow(page); return; }
    const mods = window.IBPages.all(); const cur = mods[state.page];
    const proceed = () => {
      const def = mods[page];
      if (def) def.hash(page); else if (page === 'accounts') state.tab = 'acc-overview'; else if (page === 'reports') state.rtab = 'orders';
      else if (page === 'vendors') state.vtab = 'overview'; else if (page === 'tickets') state.tsub = 'overview'; // their «نظرة عامة» (decisions 57 and B1) came after decision 17
      goNow(page);
    };
    if (cur && cur.canLeave) { cur.canLeave(proceed); return; }
    proceed();
  }
  function goNow(page) {
    if (isSoon(page)) { soonNote(); if (isSoon(state.page)) goNow('dashboard'); return; } // phase 3.6: closed pages
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
  // «مرتبات الموظفين» before payday (phase 10 T8, decision 20): the month being paid (payrollDue) — its sheet's status and lines from IBHR,
  // for sensitive.salaries only (the sheet and every amount are theirs, decision 2; «مدفوع» is theirs too); the payday settings stay accAlerts
  const payLines = { key: '', want: '', lines: [] };
  function payrollInfo() {
    const O = window.IbtekrOps; const H = window.IBHR; if (!O || !O.payrollDue || !H || H.state() !== 'ready' || !H.can().salaries) return null;
    const c = accCfg(); const t = H.today(); const base = O.payrollDue(t, { payDay: c.payDay, lead: c.lead, status: 'مسودة' }); const mk = base.month; const sh = H.data.sheets[mk];
    const status = sh ? sh.status : 'لسه ما اتفتحش'; const due = Object.assign({}, base, { show: base.show && status !== 'مدفوع' });
    const key = mk + '|' + status + '|' + H.data.requests.length + ':' + H.data.overtime.length + ':' + H.data.adjustments.length + ':' + H.data.team.length;
    if (sh && due.show && payLines.key !== key && payLines.want !== key) { payLines.want = key; H.sheetLines(mk).then((r) => { if (payLines.want !== key) return; payLines.key = key; payLines.lines = r.ok ? r.lines : []; document.dispatchEvent(new CustomEvent('ib:notify')); }); }
    const lines = payLines.key === key ? payLines.lines : []; const net = Math.round(lines.reduce((n, l) => n + (Number(l.net) || 0), 0) * 100) / 100;
    return { due, lines, net, status, month: mk, ready: !sh || payLines.key === key };
  }
  function openPayrollAlert() {
    const p = payrollInfo(); if (!p) return; const fmt = (n) => D.formatMoney(n); const plus = (l) => l.otPay + l.restPay + l.allow + l.quarterBonus; const minus = (l) => l.ded + l.advance + l.unpaidCut;
    U.DetailsModal({ title: 'مرتبات الموظفين — يوم الصرف ' + arDate(p.due.date), sub: 'فاضل ' + p.due.daysLeft + ' يوم · كشف ' + p.month + ' حالته «' + p.status + '» — راجعه واعتمده واعمله «مدفوع» قبل يوم الصرف',
      summary: [{ label: 'الموظفين', value: String(p.lines.length) }, { label: 'إجمالي الصافي', value: p.ready ? fmt(p.net) + ' ج.م' : '…' }, { label: 'حالة الكشف', value: p.status }, { label: 'يوم الصرف', value: arDate(p.due.date) }],
      headers: ['الموظف', 'المرتب بعد الحجز', 'إضافي + بدلات', 'خصومات', 'الصافي'],
      rows: p.lines.map((l) => [l.name, fmt(l.paid), fmt(plus(l)), fmt(minus(l)), fmt(l.net)]),
      total: p.lines.length ? ['الإجمالي', fmt(p.lines.reduce((t, l) => t + l.paid, 0)), fmt(p.lines.reduce((t, l) => t + plus(l), 0)), fmt(p.lines.reduce((t, l) => t + minus(l), 0)), fmt(p.net)] : null,
      empty: p.status === 'لسه ما اتفتحش' ? 'الكشف لسه ما اتفتحش — بيتفتح لوحده أول الشهر.' : 'بنحمّل سطور الكشف…',
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
      onRow: (i) => showOrders({ q: r.rows[i].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, empty: 'مفيش أوردرات ناجحة أو فاشلة في الفترة دي.', note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'العربون في الفترة = حركات «عربون» المسجّلة من السيستم بتاريخها (عرابين شيت Balances_Payouts مالهاش تاريخ فمش داخلة). المواصلات = مشاوير المبتكر في الفترة (من غير المرتجعات).', source: 'الأوردرات + الحركات المالية + شيت المواصلات' }, { label: 'كشف حساب ' + name });
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
    U.DetailsModal({ title: 'التقرير الأسبوعي — ' + name, sub: 'بيتبعت للمبتكر على واتساب كل ' + c.weekday + ' الساعة ' + c.at + ' · المكتملة من ' + arDate(per.from) + ' لـ ' + arDate(per.to) + ' · المتأخرة وقيد التنفيذ = المفتوح دلوقتي',
      summary: [{ label: 'متأخرة', value: String(r.late.length) + ' أوردر' }, { label: 'قيد التنفيذ', value: String(r.progress.length) + ' أوردر' }, { label: 'مكتملة في الأسبوع', value: String(r.completed.length) + ' أوردر' },
        { label: 'مستحقه من المكتملة', value: fmt(r.share) + ' ج.م' }, { label: 'خصم المواصلات', value: fmt(r.transport) + ' ج.م' }, { label: 'خصم العربون', value: fmt(r.deposits) + ' ج.م' }, { label: 'الحساب الفعلي', value: fmt(r.net) + ' ج.م' }],
      headers: ['المنتج', 'رقم الأوردر', 'الحالة', 'عمر الأوردر', 'القيمة (ج.م)'],
      rows: list.map(([o, k]) => [prodThumb(o.sku, o.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + o.oid)), kindOf(o, k), o.age + ' يوم', fmt(o.tot)]),
      total: r.completed.length ? ['قيمة المكتملة', String(r.completed.length) + ' أوردر', '', '', fmt(r.completedValue)] : null,
      onRow: (i) => showOrders({ q: list[i][0].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, shareText: VD.weeklyVendorText(name, r, per), empty: 'مفيش أوردرات للمبتكر ده الأسبوع ده.',
      note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'الحساب الفعلي = مستحق المبتكر من الأوردرات المكتملة في الأسبوع (بعد نسبة إبتكر على تاريخ كل أوردر) − المواصلات − العربون في نفس الأسبوع. رسالة المبتكر مفيهاش نسبة إبتكر.', source: 'الأوردرات + الحركات المالية + شيت المواصلات' }, { label: 'التقرير الأسبوعي ' + name });
  }
  // ---------- daily vendor follow-up (owner 22 Oct): replaces the daily late alert — late + at risk + confirmed since yesterday ----------
  function dailyRange() { const t = window.IBKit ? window.IBKit.TODAY : '2026-10-21'; const y = new Date(Date.parse(t + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); return { from: y, to: t }; }
  function dailyOf(name, orders) { const v = vstore.findByName(name); return { name, v, r: VD.dailyVendorReport(orders || allOrders(), v ? [v.name].concat(v.aliases || []) : [name], dailyRange()) }; }
  function vendorDailies() { const orders = allOrders(); const names = [...new Set(orders.flatMap((o) => o.subs.map((s) => { const v = vstore.findByName(s.vendor); return v ? v.name : s.vendor.trim(); })))];
    return names.map((n) => dailyOf(n, orders)).filter((x) => x.r.late.length || x.r.risk.length || x.r.confirmed.length).sort((a, b) => b.r.late.length - a.r.late.length || b.r.risk.length - a.r.risk.length || b.r.confirmed.length - a.r.confirmed.length); }
  function openVendorDaily(name) {
    const x = dailyOf(name); const r = x.r; const fmt = (n) => D.formatMoney(n); const rg = dailyRange();
    const list = r.late.map((o) => [o, 'متأخر']).concat(r.risk.map((o) => [o, 'قابل للتأخير']), r.confirmed.map((o) => [o, 'اتأكد — ابدأ']));
    U.DetailsModal({ title: 'المتابعة اليومية — ' + name, sub: 'بتتبعت للمبتكر على واتساب كل يوم الساعة 10:00 ص · المتأخرة والقابلة للتأخير = المفتوح دلوقتي · المؤكدة = اتأكدت من ' + arDate(rg.from) + ' لـ ' + arDate(rg.to),
      summary: [{ label: 'متأخرة', value: String(r.late.length) + ' أوردر' }, { label: 'قابلة للتأخير', value: String(r.risk.length) + ' أوردر' }, { label: 'اتأكدت — يبدأ فيها', value: String(r.confirmed.length) + ' أوردر' }],
      headers: ['المنتج', 'رقم الأوردر', 'الحالة', 'عمر الأوردر', 'القيمة (ج.م)'],
      rows: list.map(([o, k]) => [prodThumb(o.sku, o.prod), h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + o.oid)), k, o.age + ' يوم', fmt(o.tot)]),
      onRow: (i) => showOrders({ q: list[i][0].oid }), phone: x.v && x.v.phone, email: x.v && x.v.email, shareText: VD.dailyVendorText(name, r, rg.to), empty: 'مفيش حاجة للمبتكر ده النهارده.',
      note: bn(x.v).replace(/^ · /, '') + (bn(x.v) ? ' · ' : '') + 'بدل تنبيه «مبتكر متأخر» اليومي. الأوردرات الفرعية بتبقى «مؤكد» تلقائي أول ما الأوردر الرئيسي يتأكد.', source: 'الأوردرات' }, { label: 'المتابعة اليومية ' + name });
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
      editable ? K.two(K.field.text('city', 'المحافظة', f, e, set, { placeholder: 'مثلًا: الجيزة' }), K.field.text('addr', 'العنوان بالتفصيل', f, e, set, { required: true, placeholder: 'الشارع، الحي، علامة مميزة' })) : U.InfoRow({ label: 'العنوان', value: p.address || h('span', { class: 'wb-miss' }, 'ناقص — كمّله من ملف ' + (p.kind === 'vendor' ? 'المبتكر' : 'المخزن في الإعدادات')) }));
    const o0 = OA().get(w0.oid);
    K.form({ title: 'بوليصة ' + dcfg().company + ' — أوردر IB-' + w0.oid + ' · فرعي ' + w0.sid, wide: true, values: { city: o0.city || '', addr: o0.addr || '', no: '' },
      note: (f) => h('div', { class: 'wb-head' }, K.Tag('info', w0.route), h('span', { class: 't-small' }, w0.prod + ' × ' + w0.qty + (w0.readyAt ? ' · جاهز من ' + w0.readyAt : '') + ' · المسؤول: ' + (own ? own.name : '—'))),
      fields: (f, e, set) => { const toCust = w0.receiver.kind === 'customer' || w0.sender.kind === 'customer';
        const w = window.IbtekrOps.waybillFor(Object.assign({}, o0, { city: f.city, addr: f.addr }), OA().get(w0.oid).subs.find((x) => String(x.sid) === w0.sid), { name: w0.sender.kind === 'vendor' ? w0.sender.name : w0.receiver.name, phone: (w0.sender.kind === 'vendor' ? w0.sender : w0.receiver).phone, address: (w0.sender.kind === 'vendor' ? w0.sender : w0.receiver).address }, { name: dcfg().whName, phone: dcfg().whPhone, address: dcfg().whAddress });
        return [h('div', { class: 'wb-grid' }, party('المرسل — ' + ({ vendor: 'المبتكر', warehouse: 'المخزن', customer: 'العميل' })[w0.sender.kind], w0.sender, w0.sender.kind === 'customer', f, set, e), party('المستلم — ' + ({ vendor: 'المبتكر', warehouse: 'المخزن', customer: 'العميل' })[w0.receiver.kind], w0.receiver, w0.receiver.kind === 'customer', f, set, e)),
          h('div', { class: 'dt-sum' }, [['الإجمالي', w.total], ['العربون', w.deposit], ['المبلغ المتبقي', w.remaining], ['يتحصّل من العميل', w.collect]].map(([l, v]) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, l), h('b', null, fmt(v) + ' ج.م')))),
          toCust ? null : h('p', { class: 't-small help', style: 'margin:0' }, 'شحنة من المبتكر للمخزن — مفيش تحصيل.'),
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
    const pay = p && p.due.show ? [{ own: { role: 'الحسابات' }, key: 'pay:' + p.due.date, title: 'مرتبات الموظفين — يوم الصرف ' + arDate(p.due.date), sub: 'فاضل ' + p.due.daysLeft + ' يوم · ' + (p.ready && p.lines.length ? p.lines.length + ' موظف · صافي ' + D.formatMoney(p.net) + ' ج.م · ' : '') + 'الكشف «' + p.status + '»', meta: '', tone: p.due.daysLeft <= 3 ? 'error' : 'warning', icon: 'wallet', run: openPayrollAlert }] : [];
    const st = vendorStatements().map((x) => ({ own: { role: 'الحسابات' }, key: 'vs:' + x.name, title: 'كشف حساب ' + x.name, sub: 'الرصيد ' + D.formatMoney(x.r.balance) + ' ج.م · ناجحة ' + x.r.success + ' · فاشلة ' + x.r.failed + ' · عربون ' + D.formatMoney(x.mo.deposits) + ' · مواصلات ' + D.formatMoney(x.mo.transport), meta: 'من ' + per.from.slice(8) + '/' + per.from.slice(5, 7) + ' لـ ' + per.to.slice(8) + '/' + per.to.slice(5, 7), tone: x.r.balance < 0 ? 'orange' : 'neutral', icon: 'truck', run: () => openVendorStatement(x.name) }));
    return { id: 'accounts', label: 'الحسابات', icon: 'wallet', unit: 'تنبيه', all: () => go('accounts'), allLabel: 'عرض الكل في الحسابات', empty: 'مفيش تنبيهات حسابات.',
      tabs: [['all', 'الكل', pay.concat(st)], ['payroll', 'المرتبات', pay], ['vendors', 'كشوف المبتكرين', st]] };
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
    const risk = a.riskVendors.map((v) => ({ own: { role: 'متابعة الموردين' }, key: 'r:' + v.vendor, title: v.vendor, sub: v.count + ' أوردر قابل للتأخير (آخر 3 أيام من مدة التصنيع)', meta: '', tone: 'orange', icon: 'clockc', run: () => openVendorLate(v.vendor, 'risk') }));
    // phase 8 decision 9: the live tickets of the member (new for their role, replies / changes by others) first, then the v2's tasks
    const tkMe = TA() ? TA().actor().name : null;
    const tasks = (TA() ? TA().bell() : []).map((b) => ({ own: { member: tkMe }, key: 'tn:' + b.id + ':' + b.at, title: b.title, sub: b.sub, meta: b.kind === 'new' ? 'جديدة' : (b.count > 1 ? b.count + ' تحديث' : 'تحديث'), tone: b.kind === 'new' ? 'brand' : 'neutral', icon: 'ticket', prio: b.prio, run: () => { showTickets(); openTicket(b.id); } }))
      .concat(ticketTasks().map((t) => ({ own: TA() && TA().isMine(tstore.get(t.id)) ? { member: tkMe } : { role: t.role }, key: 't:' + t.id, title: t.id + ' — ' + t.title, sub: t.sub, meta: '', tone: t.prio === 'urgent' || t.prio === 'high' ? 'error' : 'neutral', icon: 'ticket', prio: t.prio, run: () => { showTickets(); openTicket(t.id); } })))
      .concat(vendorTasks().map((v) => ({ own: { role: 'متابعة الموردين' }, key: 'c:' + v.id, title: v.name, sub: v.sub, meta: '', tone: v.prio === 'urgent' ? 'error' : 'warning', icon: 'users', prio: v.prio, run: () => { if (state.page !== 'vendors') go('vendors'); openVendor(v.id); } })));
    const P = ['urgent', 'high', 'normal', 'low'];
    return [
      { id: 'customers', label: 'عملاء', icon: 'users', unit: 'تنبيه', all: () => showOrders({ st: 'معلّق' }), allLabel: 'عرض الكل في الأوردرات', empty: 'كله تمام مع العملاء.',
        tabs: [['all', 'الكل', lateC.concat(follow, unconf, waiting)], ['late', 'متأخرة — محتاج متابعة', lateC], ['follow', 'متابعة', follow], ['unconf', 'غير مؤكد', unconf], ['waiting', 'في انتظار الرد', waiting]] },
      { id: 'vendors', label: 'المبتكرين', icon: 'truck', unit: 'تنبيه', all: () => showOrders({ deliv: 'late' }), allLabel: 'عرض الكل في الأوردرات', empty: 'مفيش مبتكرين متأخرين.',
        tabs: [['all', 'الكل', late.concat(risk, dy, wk)], ['late', 'متأخر', late], ['risk', 'قابل للتأخير', risk], ['daily', 'المتابعة اليومية', dy], ['weekly', 'التقرير الأسبوعي', wk]] },
      accountsSection(), deliverySection(),
      { id: 'tasks', label: 'مهام', icon: 'checkCircle', unit: 'مهمة', all: () => showTickets(), allLabel: 'عرض الكل في طلبات الفريق', empty: 'مفيش مهام مستنياك.',
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
  // phase 8: «تذاكر الفريق — عرض» for the signed-in member is their real tickets.view (0045 decision 4) — the prototype's matrix said N
  // for «حسابات», so its tasks never reached the bell; the settings page (phase 11) owns the roles' permissions, this column stays the live one
  function tkPerms(perms, ci, m) {
    const D = window.IBDirectory; const me = D && D.me ? D.me() : null; if (!D || !me || !m || (m.uid || m.id) !== me.id && m.email !== me.email) return perms;
    const v = D.perm('tickets.view'); const col = (str) => String(str || '').padEnd(ci + 1, 'N').slice(0, ci) + v + String(str || '').slice(ci + 1);
    const list = (perms || []).map(([g, rows]) => (g !== 'تذاكر الفريق' ? [g, rows] : [g, rows.map((r) => (r[0] === 'عرض' ? [r[0], col(r[1])].concat(r.slice(2)) : r))]));
    if (!list.some(([g]) => g === 'تذاكر الفريق')) list.push(['تذاكر الفريق', [['عرض', col('')]]]); // a matrix without the group: add it
    return list;
  }
  function accFor(m) {
    const K = window.IBKit, NR = NRM(); const ci = roleIdx(m); const perms = tkPerms(sPerms(), ci, m); const ov = (K.store.alertOverrides || {})[m.id] || {}; const mute = ((K.store.notifPrefs || {})[m.id] || {}).mute || [];
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
    // phase 10: the team's requests / overtime / meetings from IBHR (the server's rows the member sees), the member's own ones left out
    const HRA = window.IBPages.all().hr.api; const HR = window.IBHR; const HD = HR ? HR.data : S; const Mm = (id) => (HR && HR.member(id)) || K.member(id); const meCode = K.ME;
    const reqs = HD.requests.filter((r) => HRA.isPending(r) && r.member !== meCode).map((r) => ({ own: { manager: Mm(r.member).manager }, key: 'rq:' + r.id, title: r.type + ' — ' + Mm(r.member).name, sub: HRA.reqPeriod(r), meta: r.at, tone: 'warning', icon: 'briefcase', run: goHash(r.ticket ? 'tickets/' + r.ticket : 'hr-requests') })); // decision 33: the request's ticket
    const esc = HR ? Number(HD.hrSettings.escalate) || 24 : 24;
    const ot = HD.overtime.filter((o) => o.status === 'مستني' && o.member !== meCode && (!HR || !HR.decidesOt || HR.decidesOt(o))).map((o) => ({ own: o.kind === 'rest_day' ? { role: 'أدمن' } : { manager: Mm(o.member).manager }, // decision 32: a rest day is the admins'
 key: 'ot:' + o.id, title: (o.kind === 'rest_day' ? 'شغل يوم راحة — ' : 'وقت إضافي ' + K.hrs(o.minutes) + ' — ') + Mm(o.member).name, sub: o.note + (o.waitedHours >= esc ? ' · اتصعّد للأدمن' : ' · ضيفه أو متضيفهوش'), meta: K.dshort(o.date), tone: o.waitedHours >= esc ? 'error' : 'warning', icon: 'clock', run: goHash('hr-requests') }));
    const meet = HD.meetings.filter((x) => (x.dbStatus || x.status) === 'مطلوب' || (x.dbStatus || x.status) === 'اتحدد ميعاد').map((x) => ({ own: { manager: Mm(x.member).manager }, key: 'mt:' + x.id, title: 'ميتنج 1:1 — ' + Mm(x.member).name, sub: x.reason, meta: x.date ? K.dshort(x.date) + (x.time ? ' ' + x.time : '') : 'لسه متحددش', tone: 'neutral', icon: 'cal', run: goHash('hr-payroll') }));
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
      h('thead', null, h('tr', null, ['رقم الأوردر'].concat(kind === 'all' ? ['التأخير'] : [], ['العميل', 'المنتج · SKU']).concat([ 'حالة الفرعي', 'تاريخ تبليغ المبتكر', 'عمر الأوردر']).map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { 'data-l': 'رقم الأوردر' }, h('button', { type: 'button', class: 'vlo-link', onClick: () => { m.close(); OA().details(r.id, r.sid ? 'subs' : 'info'); } }, 'IB-' + r.id, Icon('external', 'sm'))),
        kind === 'all' ? h('td', { 'data-l': 'التأخير' }, U.DelayBadge(r.state)) : null,
        h('td', { 'data-l': 'العميل' }, r.name),
        h('td', { 'data-l': 'المنتج · SKU' }, h('div', { class: 'vlo-prod' }, h('span', { class: 'th' }, OA().thumb(r.sku) ? h('img', { src: OA().thumb(r.sku), alt: '' }) : Icon('box', 'sm')), h('span', { class: 'tx' }, h('span', null, r.prod + ' × ' + r.qty), h('small', null, r.sku || '—')))),
        h('td', { 'data-l': 'حالة الفرعي' }, r.ss || '— اختر الحالة —'),
        h('td', { 'data-l': 'تاريخ تبليغ المبتكر' }, r.exp ? D.formatDateNumeric(r.exp) : 'أضف تاريخ الإبلاغ'),
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
      vnotify('success', 'اتفتح ' + (via === 'whatsapp' ? 'واتساب' : 'الإيميل') + ' للمبتكر. ' + note);
    }
  }

  // ---------- AI assistant (header button + panel). Phase 12 T1 (decision 8): a Claude conversation on the server (ai-content `assistant` via IBAI —
  // the data read with the member's own JWT, the client tools come back as actions executed here with the page functions below); the fixed-command
  // parser (commands.js) stays the fallback when the AI is not configured. Every write is confirmed, validated and goes through the adapter. ----------
  const C = window.IbtekrCommands;
  const AI_ACTOR = 'AI (بأمر ' + ACTOR + ')';
  const AI_EXAMPLES = ['افتح حسابات المبتكرين', 'اعرض الأوردرات المتأخرة', 'سجل سحب مرتبات 5000', 'رتب المبتكرين بالعربون'];
  const AI_HELP = 'مش فاهم الأمر ده. أقدر أفتح صفحة، أفلتر الأوردرات، أغيّر الفترة، أرتّب المبتكرين، أو أسجّل حركة مصروفات / مبتكر / حساب. جرّب واحد من الأمثلة.';
  const aiWelcome = () => { const me = window.IBDirectory && window.IBDirectory.me && window.IBDirectory.me(); return 'أهلاً يا ' + String((me && me.name) || ACTOR).split(' ')[0] + '. اسألني عن الأوردرات أو المبتكرين أو الأرقام، أو اطلب أفتح صفحة أو أسجّل حركة — أي تسجيل بيتأكد منك الأول.'; };
  const ai = { msgs: [{ role: 'ai', text: '', welcome: true }], pending: null, busy: false, turns: [] };
  let aiPanel = null, aiBtn = null, aiList = null, aiInput = null;
  const aiCtx = () => {
    const names = SEED.vendors.map((v) => v.name); const seen = new Set(names.map((n) => n.toLowerCase()));
    const orders = (window.OrdersApp && window.OrdersApp.vendors) ? window.OrdersApp.vendors() : [];
    return { vendors: names.concat(orders.filter((n) => !seen.has(n.toLowerCase()))), today: TODAY };
  };
  const AI_ASK = { amount: 'المبلغ كام؟', category: 'النوع إيه؟ (المرتبات، المصروفات، الاشتراكات، الإعلانات)', vendor: 'أنهي مبتكر؟' };
  const KIND_OF = { addExpense: 'expenses', addVendorMove: 'vendorMoves', addAccountMove: 'accountMoves' };
  const TAB_OF = { expenses: 'expenses', vendorMoves: 'vendors', accountMoves: 'actual' };
  function aiSay(text) { ai.msgs.push({ role: 'ai', text }); aiDraw(); }
  function aiSummary(cmd) {
    const dirWord = cmd.direction === 'deposit' ? 'إيداع' : 'سحب';
    const rows = [['العملية', dirWord + (cmd.type === 'addExpense' ? ' مصروفات' : cmd.type === 'addVendorMove' ? ' للمبتكر' : ' في حساب')], ['المبلغ (ج.م)', num(D.formatMoney(Number(cmd.amount)))]];
    if (cmd.type === 'addExpense') { rows.push(['النوع', cmd.category]); if (cmd.beneficiary) rows.push(['المستفيد', cmd.beneficiary === D.OTHER ? cmd.otherName : cmd.beneficiary]); }
    if (cmd.type === 'addVendorMove') rows.push(['المبتكر', cmd.vendor], ['النوع', cmd.vendorType]);
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
    if (aiServer !== false) ai.turns.push({ role: 'user', text: '[النظام: المستخدم أكّد وتم تسجيل الحركة الأخيرة.]' }, { role: 'assistant', text: 'تمام، اتسجّلت.' });
  }
  function aiExec(cmd) {
    switch (cmd.type) {
      case 'navigate': if (cmd.tab) state.tab = cmd.tab; go(cmd.page); aiSay(cmd.page === 'orders' ? 'فتحت الأوردرات.' : 'فتحت تاب ' + TABS.find((t) => t.id === state.tab).label + '.'); return;
      case 'ordersFilter': {
        if (state.page !== 'orders') go('orders'); window.OrdersApp.apply(cmd.filter);
        const gq = document.getElementById('gq'); if (gq && cmd.filter.q !== undefined) gq.value = cmd.filter.q;
        aiSay('فلترت الأوردرات: ' + Object.entries(cmd.filter).map(([k, v]) => ({ q: 'بحث', st: 'الحالة', deliv: 'التسليم', vendor: 'المبتكر' }[k]) + ' = ' + ({ late: 'متأخر', risk: 'قابل للتأخير', ok: 'غير متأخر' }[v] || v)).join('، ') + '.'); return;
      }
      case 'ordersClear': window.OrdersApp.clear(); { const gq = document.getElementById('gq'); if (gq) gq.value = ''; } aiSay('مسحت فلاتر الأوردرات.'); return;
      case 'setRange': { const r = cmd.range || D.presetRange(cmd.preset, TODAY); state.range = { from: r.from, to: r.to, preset: cmd.preset || 'custom' }; if (state.page !== 'accounts') go('accounts'); else render(); aiSay('غيّرت ' + D.rangeLabel(r.from, r.to) + '.'); return; }
      case 'sortVendors': state.sort = cmd.sort; state.tab = 'vendors'; go('accounts'); aiSay('رتّبت المبتكرين: ' + SORTS.find((x) => x.value === cmd.sort).label + '.'); return;
      case 'addExpense': case 'addVendorMove': case 'addAccountMove':
        if (cmd.missing.length) { ai.pending = cmd; aiSay(AI_ASK[cmd.missing[0]]); return; }
        ai.msgs.push({ role: 'ai', text: 'هسجّل الحركة دي — راجعها وأكّد:', confirm: cmd }); aiDraw(); return;
      default: aiSay(AI_HELP);
    }
  }
  // ---- the server conversation (phase 12 T1): IBAI.assistant → { text, actions }; the actions run here through the page functions in aiTools().
  // aiServer: null = not tried yet, true = Claude answers, false = the AI is not configured (not_configured / forbidden) → the fixed commands. ----
  let aiServer = null, aiCtl = null, aiNoteEl = null, aiSendBtn = null, aiStopBtn = null;
  function aiVendorName(n) { const l = String(n || '').trim().toLowerCase(); const hit = SEED.vendors.find((v) => v.name.toLowerCase() === l); return hit ? hit.name : ''; }
  const syncGq = (v) => { const gq = document.getElementById('gq'); if (gq) gq.value = v || ''; };
  const PAGE_IDS = NAV.map((n) => n[2]);
  // the client tools the server's Claude may call (their schemas live in supabase/functions/_shared/ai-assistant.js): name → execute(input)
  function aiTools() {
    const OA = window.OrdersApp;
    const pick = (i) => { const f = {}; for (const k of ['q', 'st', 'conf', 'vendor', 'deliv']) if (i[k]) f[k] = String(i[k]); return f; };
    return {
      navigate: (i) => { const page = PAGE_IDS.includes(i.page) ? i.page : 'dashboard'; if (page === 'accounts' && i.tab && TABS.some((t) => t.id === i.tab)) state.tab = i.tab; go(page); return 'opened ' + page; },
      filter_orders: (i) => { if (state.page !== 'orders') go('orders'); if (!OA) throw new Error('orders not ready'); if (i.clear) OA.clear(); const f = pick(i); if (f.vendor) { const hit = OA.vendors().find((v) => v.toLowerCase() === f.vendor.toLowerCase()); if (!hit) throw new Error('unknown vendor'); f.vendor = hit; } const n = OA.apply(f); syncGq(f.q !== undefined ? f.q : (i.clear ? '' : document.getElementById('gq') && document.getElementById('gq').value)); return { matching: n }; },
      set_period: (i) => { let r; if (i.preset) { r = D.presetRange(String(i.preset), TODAY); if (!r) throw new Error('unknown preset'); } else if (/^\d{4}-\d{2}-\d{2}$/.test(i.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(i.to || '') && i.from <= i.to) r = { from: i.from, to: i.to }; else throw new Error('need preset or valid from<=to'); state.range = { from: r.from, to: r.to, preset: i.preset || 'custom' }; if (state.page !== 'accounts') go('accounts'); else render(); return D.rangeLabel(r.from, r.to); },
      sort_vendors: (i) => { if (!SORTS.some((x) => x.value === i.sort)) throw new Error('bad sort'); state.sort = i.sort; state.tab = 'vendors'; go('accounts'); return 'sorted ' + i.sort; },
      // phase 13 decision 36 (owner 10 Nov — «يقدر يضيف مبتكر أو موظف أو عميل… يسألني على البيانات اللي محتاجها ويفتحلي بيها بوب أب
      // أملاها وبعد كده ياخد الأكشن»): the system's own popup opens with the values the member gave; nothing is written until the member
      // presses the popup's own button (the confirmation) — through the same adapter and the same server checks as by hand
      open_form: (i) => aiOpenForm(String(i.form || ''), i.values && typeof i.values === 'object' ? i.values : {}),
      propose_entry: (i) => {
        const base = { direction: i.direction, amount: String(i.amount) };
        let cmd;
        if (i.kind === 'expense') { let ben = '', other = ''; if (i.beneficiary) { const v = aiVendorName(i.beneficiary); if (v) ben = v; else { ben = D.OTHER; other = String(i.otherName || i.beneficiary); } } cmd = { type: 'addExpense', ...base, category: i.category || '', beneficiary: ben, otherName: other }; }
        else if (i.kind === 'vendor') { const v = aiVendorName(i.vendor); if (!v) throw new Error('unknown vendor'); cmd = { type: 'addVendorMove', ...base, vendor: v, vendorType: i.vendorType || 'عربون', otherName: '' }; }
        else cmd = { type: 'addAccountMove', ...base, account: i.account || '' };
        const b = aiBuild(cmd); if (b.error) throw new Error(b.error);
        ai.msgs.push({ role: 'ai', text: 'الـ AI جهّز الحركة دي من كلامك — راجعها وأكّد (مفيش حاجة اتسجلت لسه):', confirm: cmd }); aiDraw();
        return 'confirm card shown';
      },
    };
  }
  // decision 36: open_form → the popup; a missing permission or a page not ready is said in the panel
  function aiOpenForm(form, v) {
    const K = window.IBKit; const P = () => window.IBPages.all(); const can = (k) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(k) : 'N');
    const admin = () => K.member(K.ME).role === 'أدمن';
    const no = () => { throw new Error('الصلاحية دي مش معاك'); };
    const hrApi = () => { const a = P().hr && P().hr.api; if (!a || !window.IBHR) throw new Error('الموارد البشرية مش جاهزة'); return a; };
    switch (form) {
      case 'vendor_add': if (!admin() && can('vendors.edit') !== 'F') no(); if (state.page !== 'vendors') go('vendors'); setTimeout(() => openAddVendor(null, v), 60); return 'form vendor_add';
      case 'member_add': if (!admin()) no(); hrApi().addMember(Object.fromEntries(['name', 'title', 'email', 'phone', 'dept', 'hire'].filter((k) => v[k] != null && String(v[k]).trim()).map((k) => [k, String(v[k]).trim().slice(0, 200)]))); return 'form member_add';
      case 'customer_add': { const a = P().cs && P().cs.api; if (!a || !a.addCustomer || !a.addCustomer(v)) no(); return 'form customer_add'; }
      case 'ticket_new': { if (!tCanManage()) no(); const pre = {}; for (const k of ['title', 'description', 'reason']) if (v[k]) pre[k] = String(v[k]).slice(0, 1000); if (['customer', 'vendor', 'internal'].includes(v.type)) pre.type = v.type;
        if (['low', 'normal', 'high', 'urgent'].includes(v.priority)) pre.priority = v.priority; if (v.orderId) pre.orderId = String(v.orderId).replace(/\D/g, '').slice(0, 12); if (v.vendor) { const n = aiVendorName(v.vendor); if (n) pre.vendor = n; }
        if (state.page !== 'tickets') go('tickets'); setTimeout(() => openNewTicket(pre), 60); return 'form ticket_new'; }
      case 'hr_leave': hrApi().leaveRequest(null, v); return 'form hr_leave';
      case 'hr_advance': hrApi().advanceRequest(null, v); return 'form hr_advance';
      case 'hr_remote': hrApi().remoteRequest(null, v); return 'form hr_remote';
      case 'task_add': { if (!window.IBHR || !window.IBHR.taskAdd) throw new Error('المهام مش جاهزة');
        K.form({ title: 'إضافة مهمة', values: { title: String(v.title || '').slice(0, 200) }, fields: (f, e, set) => [K.field.text('title', 'المهمة', f, e, set, { required: true })], validate: (f) => K.req(f, ['title']), submitLabel: 'أكّد وسجّل',
          submit: (f, md) => window.IBHR.taskAdd(K.ME, f.title.trim()).then((r) => { if (r && r.ok) { md.close(); K.toast('اتضافت المهمة', 'success'); } else K.toast((r && r.message) || 'ما اتضافتش — جرّب تاني', 'error'); }) });
        return 'form task_add'; }
      case 'order_update': { const OA = window.OrdersApp; if (!OA || !OA.aiUpdate) throw new Error('الأوردرات مش جاهزة'); if (can('orders.status') !== 'F' && !admin()) no(); const r = OA.aiUpdate({ id: String(v.order || '').replace(/\D/g, ''), status: v.status || '', confirm: v.confirm || '' }); if (r === 'missing') throw new Error('الأوردر ده مش ظاهر عندي'); if (r === 'nothing') throw new Error('مفيش تغيير — الحالة دي مش من اللي المساعد يقدر يغيّرها أو هي نفسها'); return 'form order_update'; }
      // decision 40 (owner 10 Nov — «لما أسأل المساعد على إضافة مصروفات أو حسابات عامة يفتحلي بوب أب أحط فيه بياناتي بعد ما أحددله
      // إيداع ولا سحب»): the accounts page's own «سحب / إيداع» popup (openForm) filled with what was said; «حفظ» in it is the confirmation
      case 'expense_add': case 'account_move': case 'vendor_move': {
        if (!canAdd()) no();
        const dir = v.direction === 'deposit' || v.direction === 'withdraw' ? v.direction : null; if (!dir) throw new Error('قولّي إيداع ولا سحب الأول');
        const kind = { expense_add: 'expenses', account_move: 'accountMoves', vendor_move: 'vendorMoves' }[form]; const pre = {};
        const amt = Number(String(v.amount || '').replace(/[,٬]/g, '')); if (Number.isFinite(amt) && amt > 0) pre.amount = String(amt);
        if (kind === 'expenses') {
          if (D.CATEGORIES.includes(v.category)) pre.category = v.category;
          if (v.beneficiary) { const n = aiVendorName(v.beneficiary); if (n) pre.beneficiary = n; else { pre.beneficiary = D.OTHER; pre.otherName = String(v.beneficiary).slice(0, 80); } }
          for (const k of ['details', 'note', 'source']) if (v[k]) pre[k] = String(v[k]).slice(0, k === 'source' ? 80 : 500);
        } else if (kind === 'accountMoves') { if (D.ACCOUNTS.includes(v.account)) pre.account = v.account; }
        else { if (v.vendor) { const n = aiVendorName(v.vendor); if (n) pre.vendor = n; } if (dir === 'withdraw' && D.VENDOR_TYPES.includes(v.type)) pre.type = v.type; // 0078: a «إيداع» has no kind
          if (v.otherName) pre.otherName = String(v.otherName).slice(0, 80); if (v.note) pre.note = String(v.note).slice(0, 500); }
        state.tab = kind === 'expenses' ? 'expenses' : kind === 'accountMoves' ? 'actual' : 'vendors';
        if (state.page !== 'accounts') go('accounts'); else render();
        setTimeout(() => openForm(kind, dir, null, false, pre), 60); return 'form ' + form;
      }
      default: throw new Error('النوع ده مش من الإجراءات المتاحة');
    }
  }
  // the server's actions in order; a failing one is said in the panel (the model already answered)
  function aiExecActions(actions) {
    const tools = aiTools(); const failed = [];
    for (const a of actions || []) { const fn = tools[a.name]; if (!fn) continue; try { fn(a.input || {}); } catch (e) { failed.push(a.name === 'propose_entry' ? 'ما قدرتش أجهّز الحركة: ' + (e && e.message ? e.message : '') : a.name === 'open_form' ? 'ما قدرتش أفتح البوب أب: ' + (e && e.message ? e.message : '') : 'ما قدرتش أنفّذ ' + a.name + '.'); } }
    for (const f of failed) aiSay(f);
  }
  function aiBusy(b) { ai.busy = b; if (aiInput) aiInput.disabled = b; if (aiSendBtn) aiSendBtn.hidden = b; if (aiStopBtn) aiStopBtn.hidden = !b; if (!b && aiInput && aiPanel && !aiPanel.hidden) aiInput.focus(); }
  function aiModeNote() { if (aiNoteEl) aiNoteEl.textContent = aiServer === false ? 'الـ AI مش متظبط دلوقتي — بفهم صيغ أوامر محددة بس (افتح، اعرض، سجل، رتب).' : 'محادثة مع Claude على بياناتك بصلاحياتك. أي تسجيل بيطلب تأكيدك الأول.'; }
  const aiContext = () => ({ page: state.page, tab: state.page === 'accounts' ? state.tab : '', period: state.page === 'accounts' ? { from: state.range.from, to: state.range.to } : null });
  async function aiChat(text) {
    ai.turns.push({ role: 'user', text }); ai.turns = ai.turns.slice(-12);
    const m = { role: 'ai', text: '', live: true }; ai.msgs.push(m); aiBusy(true); aiDraw();
    aiCtl = new AbortController();
    const r = window.IBAI && window.IBAI.assistant ? await window.IBAI.assistant({ mode: 'chat', turns: ai.turns, context: aiContext(), signal: aiCtl.signal }) : { ok: false, reason: 'not_configured' };
    aiCtl = null; m.live = false;
    if (!r.ok) {
      ai.msgs = ai.msgs.filter((x) => x !== m); ai.turns.pop();
      if (r.reason === 'cancelled') aiSay('وقفت.');
      else if (r.reason === 'not_configured' || r.reason === 'forbidden') { aiServer = false; aiModeNote(); aiSay('المحادثة مع الـ AI مش متاحة دلوقتي (مفتاح الـ AI مش متظبط)، فهشتغل بالأوامر المحددة.'); aiBusy(false); aiLocal(text); return; }
      else if (r.reason === 'ai_cap') aiSay('سقف الـ AI الشهري خلص — الأدمن يزوّده من إعدادات الـ AI.');
      else if (r.reason === 'busy') aiSay('الاستخدام كتير دلوقتي، جرّب بعد شوية.');
      else aiSay('حصلت مشكلة في الاتصال، جرّب تاني.');
      aiBusy(false); return;
    }
    aiServer = true; aiModeNote();
    m.text = r.result === 'refused' ? 'مش هقدر أرد على ده.' : (r.text || (r.actions.length ? 'تمام.' : 'مفيش رد.'));
    m.report = r.result === 'refused' ? [] : (r.report || []); m.question = text; // decision 23: the reads behind the answer → «تفاصيل»
    ai.turns.push({ role: 'assistant', text: m.text });
    // decision 41 (owner 10 Nov — «يقولي حط المعلومات هنا ويديني لينك أفتح منه البوب أب… خلّي كل الأكشنز نفس الكلام»): an open_form is
    // a link under the answer, the popup opens when the member clicks it; the other actions run as before
    const acts = r.actions || []; m.forms = acts.filter((a) => a.name === 'open_form'); m.files = acts.filter((a) => a.name === 'offer_file').slice(0, 5);
    aiBusy(false); aiDraw();
    aiExecActions(acts.filter((a) => a.name !== 'open_form' && a.name !== 'offer_file'));
  }
  const AI_FORM_LABEL = { vendor_add: 'إضافة مبتكر', member_add: 'إضافة عضو', customer_add: 'إضافة عميل', ticket_new: 'تذكرة جديدة', hr_leave: 'طلب إجازة', hr_advance: 'طلب سُلفة', hr_remote: 'شغل عن بُعد',
    task_add: 'إضافة مهمة', order_update: 'تحديث الأوردر', expense_add: 'المصروفات', account_move: 'الحساب الفعلي', vendor_move: 'حركة المبتكر' };
  const aiFormLabel = (a) => { const v = (a.input && a.input.values) || {}; const dir = v.direction === 'deposit' ? 'إيداع — ' : v.direction === 'withdraw' ? 'سحب — ' : ''; return dir + (AI_FORM_LABEL[a.input && a.input.form] || 'البوب أب'); };
  function aiOpenLink(a) { try { aiTools().open_form(a.input || {}); } catch (e) { aiSay('ما قدرتش أفتح البوب أب: ' + (e && e.message ? e.message : '')); } }
  // ---- phase 13 decision 42: a file the assistant found → a download link; the page's own adapter signs it (the Storage policies decide)
  async function aiFile(a) {
    const i = a.input || {}; let url = null; let why = '';
    try {
      if (i.source === 'company' && window.IBSettings) { const r = await window.IBSettings.docUrl(i.ref); url = r && r.ok ? r.url : null; why = r && r.reason; }
      else if (i.source === 'contract' && window.IBVendors) { const r = await window.IBVendors.contractUrl(i.ref); url = r && r.ok ? r.url : null; why = r && r.reason; }
      else if (i.source === 'hr' && window.IBHR) url = await window.IBHR.fileUrl(i.ref);
      else if (i.source === 'ticket' && window.IBTickets) url = await window.IBTickets.fileUrl(i.ref);
    } catch (e) { url = null; }
    if (url && /^https:\/\//.test(url)) { window.open(url, '_blank', 'noopener'); return; }
    aiSay(why === 'forbidden' ? 'مالكش صلاحية تفتح الملف ده.' : 'ما قدرتش أجيب الملف — جرّب تاني.');
  }
  // ---- phase 13 decision 42: «تنزيل Excel» — the data the answer read (the same parts «تفاصيل» shows), one sheet, numbers as numbers
  function aiExcel(m) {
    const parts = (m.report || []).map((r) => airParts(r.data, AIR_KIND[r.kind] || r.kind));
    const cell = (c) => { const t = String(c); return /^-?\d[\d,]*(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, '')) : t; };
    const aoa = [['السؤال', m.question || ''], ['الرد', m.text || ''], []];
    const walk = (p) => { aoa.push([p.title + (p.sub ? ' — ' + p.sub : '')]); if (p.note) aoa.push([p.note]);
      p.chips.forEach(([a, b]) => aoa.push([a, cell(b)]));
      p.tables.forEach((t) => { aoa.push([], [t.title], t.headers); t.rows.forEach((r) => aoa.push(r.map(cell))); });
      aoa.push([]); p.subs.forEach(walk); };
    parts.forEach(walk);
    window.IBKit.xlsxExport('ibtekr-assistant-' + TODAY + '.xlsx', 'مساعد AI', aoa);
  }
  function aiRun(text) {
    const t = text.trim(); if (!t || ai.busy) return;
    ai.msgs.push({ role: 'user', text: t });
    if (aiServer !== false) { aiChat(t); return; }
    aiLocal(t);
  }
  // the fixed commands (commands.js) — the fallback without the AI
  function aiLocal(t) {
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
      const kids = [h('p', { class: 'ai-text' }, m.live && !m.text ? 'بفكّر…' : m.welcome ? aiWelcome() : m.text)];
      if (m.forms && m.forms.length && !m.live) kids.push(h('div', { class: 'ai-actions ai-forms' }, m.forms.map((a) => h('a', { href: '#', class: 'ai-form-link', 'data-ai-open': (a.input && a.input.form) || '',
        onClick: (e) => { e.preventDefault(); aiOpenLink(a); } }, Icon('plus', 'sm'), 'افتح بوب أب «' + aiFormLabel(a) + '» ↗'))));
      if (m.files && m.files.length && !m.live) kids.push(h('div', { class: 'ai-actions ai-forms' }, m.files.map((a) => h('a', { href: '#', class: 'ai-form-link', 'data-ai-file': (a.input && a.input.source) || '',
        onClick: (e) => { e.preventDefault(); aiFile(a); } }, Icon('download', 'sm'), 'تنزيل «' + String((a.input && a.input.name) || 'الملف') + '»'))));
      if (m.report && m.report.length && !m.live) kids.push(h('div', { class: 'ai-actions' }, Button({ size: 'sm', icon: 'file', label: 'تفاصيل', attrs: { 'data-ai-details': '' }, onClick: () => aiReport(m) }),
        Button({ size: 'sm', icon: 'download', label: 'تنزيل Excel', attrs: { 'data-ai-excel': '' }, onClick: () => aiExcel(m) })));
      if (m.confirm) {
        kids.push(h('dl', { class: 'kv' }, aiSummary(m.confirm).map(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
        kids.push(m.done ? h('p', { class: 'ai-done t-small' }, 'تمت المعالجة.') : h('div', { class: 'ai-actions' },
          Button({ type: 'primary', size: 'sm', label: 'تأكيد التسجيل', onClick: () => aiCommit(m) }), Button({ size: 'sm', label: 'إلغاء', onClick: () => { m.done = true; aiSay('تمام، ما سجّلتش حاجة.'); } })));
      }
      return h('div', { class: 'ai-msg ' + m.role }, kids);
    }));
    aiList.scrollTop = aiList.scrollHeight;
  }
  // ---- phase 13 decision 23 (owner 10 Nov): the answer is a short summary in the chat; «تفاصيل» opens the data the assistant read as a report
  // in a popup — chips for the totals, a table for each list — with «مشاركة» (WhatsApp / email: the report as text, nothing sent by us).
  const AIR_KIND = { summary: 'ملخص', orders: 'الأوردرات', vendors: 'المبتكرين', customers: 'العملاء', tickets: 'التذاكر', tasks: 'المهام', expenses: 'المصروفات', sales: 'المبيعات', vendor: 'حساب المبتكر', files: 'الملفات' };
  const AIR_KEY = { total: 'العدد', totalEgp: 'الإجمالي (ج.م)', count: 'العدد', number: 'رقم الأوردر', customer: 'العميل', city: 'المدينة', status: 'الحالة', confirm: 'التأكيد', deposit: 'العربون', placed_at: 'التاريخ', ageDays: 'العمر (يوم)', delivery: 'التسليم',
    name: 'الاسم', category: 'الفئة', lead_days: 'مدة التجهيز', joined_at: 'الانضمام', withdrawn: 'المسحوب (ج.م)', deposited: 'المودع (ج.م)', byStatus: 'حسب الحالة', byRole: 'حسب الدور', byConfirm: 'حسب التأكيد', byCategory: 'حسب النوع', byGroup: 'حسب المجموعة',
    delivery_: 'التسليم', topMakers: 'أعلى المبتكرين', orders: 'الأوردرات', sales: 'المبيعات (ج.م)', ibtekrShare: 'حصة إبتكر (ج.م)', vendor: 'المبتكر', date: 'التاريخ', direction: 'الاتجاه', beneficiary: 'المستفيد', amount: 'المبلغ (ج.م)', subscription: 'الاشتراك',
    title: 'العنوان', type: 'النوع', priority: 'الأولوية', role: 'الدور', reason: 'السبب', follow_up: 'المتابعة', created_at: 'اتفتحت', last_update: 'آخر تحديث', order_number: 'رقم الأوردر', open: 'مفتوح', unconfirmed: 'غير مؤكد', waiting: 'في انتظار الرد',
    inPeriod: 'في الفترة', inPeriodEgp: 'قيمة الفترة (ج.م)', dokanBalance: 'رصيد Dokan (ج.م)', deposits: 'العرابين (ج.م)', transport: 'المواصلات (ج.م)', otherMoves: 'حركات تانية (ج.م)', net: 'الصافي (ج.م)',
    dokanSynced: 'آخر مزامنة Dokan', movesInPeriod: 'حركات الفترة', lastWithdrawal: 'آخر طلب سحب', cancelled: 'ملغي', returned: 'استرجاع', late: 'متأخر', risk: 'قابل للتأخير', lines: 'السطور', lineStatus: 'حالة السطور',
    otherMatches: 'أسماء قريبة', account: 'الحساب', bySource: 'حسب المصدر', label: 'النوع', owner: 'صاحب الملف', source: 'المصدر', note: 'ملحوظة', found: 'لقيته', q: 'البحث', movesForbidden: 'حركاتنا', requested_at: 'التاريخ', myTasks: 'مهامي', tickets: 'التذاكر', conversations: 'المحادثات', expenses: 'المصروفات', day: 'اليوم', until: 'لحد', mood: 'المزاج', tags: 'التاجز', rows: 'التفاصيل', forbidden: 'الصلاحية' };
  const AIR_VAL = { late: 'متأخر', risk: 'قابل للتأخير', ok: 'في الميعاد', withdraw: 'سحب', deposit: 'إيداع', urgent: 'عاجل', high: 'عالي', normal: 'عادي', low: 'منخفض', open: 'مفتوحة', in_progress: 'جاري العمل', waiting: 'بانتظار الرد', resolved: 'تم الحل', closed: 'مغلقة', active: 'نشط', inactive: 'غير نشط', leave: 'في إجازة', company: 'ورق الشركة', contract: 'عقد مبتكر', hr: 'مستند موظف', ticket: 'مرفق تذكرة', pending: 'مستني', approved: 'اتوافق', cancelled: 'اتلغى' };
  const airKey = (k) => AIR_KEY[k] || k;
  const AIR_COL = { total: 'القيمة (ج.م)', count: 'العدد' }; // a list row's «total» is its amount, not a count
  const AIR_RAW = new Set(['number', 'order_number', 'customer_id', 'vendor_id']); // numbers shown as they are (an order number has no thousands comma)
  const airVal = (v, k) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'أيوه' : 'لأ') : typeof v === 'number' ? (AIR_RAW.has(k) ? String(v) : D.formatMoney(v).replace(/\.00$/, '')) : Array.isArray(v) ? v.join('، ') : typeof v === 'object' ? '…' : (AIR_VAL[v] || String(v)));
  const isPlain = (v) => v == null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object'));
  // one read → its parts: { chips: [[label, value]], tables: [{ title, headers, rows }], note, sub } — generic over the get_data shapes
  function airParts(data, title, depth = 0) {
    const out = { chips: [], tables: [], subs: [], sub: '' };
    if (!data || typeof data !== 'object') return out;
    if (data.forbidden) { out.note = 'مالكش صلاحية على البيانات دي.'; return out; }
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id') continue;
      if (k === 'period' && v && v.from) { out.sub = 'الفترة: ' + D.formatDateNumeric(v.from) + ' – ' + D.formatDateNumeric(v.to || v.from); continue; }
      if (isPlain(v)) { out.chips.push([airKey(k), airVal(v)]); continue; }
      if (Array.isArray(v)) { const objs = v.filter((x) => x && typeof x === 'object'); if (!objs.length) continue;
        const keys = [...new Set(objs.flatMap((x) => Object.keys(x)))].filter((c) => c !== 'id' && c !== 'ref' && objs.some((x) => isPlain(x[c]))).slice(0, 10);
        out.tables.push({ title: airKey(k), headers: keys.map((c) => AIR_COL[c] || airKey(c)), rows: objs.map((x) => keys.map((c) => airVal(x[c], c))) }); continue; }
      const vals = Object.values(v);
      if (vals.every(isPlain)) { if (vals.length) out.tables.push({ title: airKey(k), headers: ['البند', 'القيمة'], rows: Object.entries(v).map(([a, b]) => [AIR_VAL[a] || airKey(a), airVal(b)]) }); continue; }
      if (depth < 1) out.subs.push(airParts(v, airKey(k), depth + 1)); // the summary's sections (orders / tickets / …)
    }
    out.title = title; return out;
  }
  function airText(m, parts) {
    const lines = ['تقرير مساعد AI — ' + (m.question || ''), '', String(m.text || '')];
    const walk = (p) => { lines.push('', '— ' + p.title + (p.sub ? ' (' + p.sub + ')' : '')); if (p.note) lines.push(p.note);
      p.chips.forEach(([a, b]) => lines.push(a + ': ' + b));
      p.tables.forEach((t) => { lines.push(t.title + ':'); t.rows.slice(0, 30).forEach((r) => lines.push('• ' + r.map((c, i) => (t.headers.length > 2 ? t.headers[i] + ' ' : '') + c).join(' · '))); });
      p.subs.forEach(walk); };
    parts.forEach(walk); return lines.join('\n');
  }
  function aiReport(m) {
    const parts = (m.report || []).map((r) => airParts(r.data, AIR_KIND[r.kind] || r.kind));
    const sec = (p) => h('section', { class: 'air-sec' }, h('h3', { class: 't-h5' }, p.title), p.sub ? h('p', { class: 't-small help', style: 'margin:0' }, p.sub) : null,
      p.note ? h('p', { class: 't-small' }, p.note) : null,
      p.chips.length ? h('div', { class: 'dt-sum' }, p.chips.map(([a, b]) => h('div', { class: 'dt-chip' }, h('span', { class: 't-small' }, a), h('b', null, num(String(b)))))) : null,
      p.tables.map((t) => h('div', { class: 'air-tbl' }, h('div', { class: 't-label' }, t.title), h('div', { style: 'overflow-x:auto' }, h('table', { class: 'vlo-table dt-table' },
        h('thead', null, h('tr', null, t.headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, t.rows.map((r) => h('tr', null, r.map((c, j) => h('td', { 'data-l': t.headers[j] || '' }, num(String(c))))))))))),
      p.subs.map(sec));
    const body = h('div', { class: 'air-body', 'data-ai-report': '' }, h('p', { class: 'air-answer' }, m.text || ''), parts.map(sec));
    const title = 'تقرير: ' + (m.question || 'مساعد AI').slice(0, 60);
    const md = U.Modal({ title, body: [body], share: false, footer: [U.ShareButton({ get: () => ({ title, text: airText(m, parts) }) }), Button({ icon: 'download', label: 'تنزيل Excel', onClick: () => aiExcel(m) }), Button({ type: 'text', label: 'إغلاق', onClick: () => md.close() })] });
    md.el.classList.add('wide'); md.el.dataset.aiReport = '1';
  }
  // ---- phase 13 decision 23: the panel moves by its header and resizes from its corner; every open from the AI button puts it back to the
  // medium size right under the button (a phone keeps the full-width sheet of the CSS).
  const AIP_W = 420, AIP_H = 560;
  function aiPlace() {
    if (!aiPanel || !aiBtn) return;
    if (window.innerWidth <= 767) { aiPanel.style.cssText = ''; return; }
    const r = aiBtn.getBoundingClientRect(); const w = Math.min(AIP_W, window.innerWidth - 32); const hgt = Math.min(AIP_H, window.innerHeight - r.bottom - 24);
    const left = Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2));
    Object.assign(aiPanel.style, { left: left + 'px', top: (r.bottom + 8) + 'px', right: 'auto', width: w + 'px', height: Math.max(320, hgt) + 'px' });
  }
  function aiDrag(head) {
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || window.innerWidth <= 767) return;
      const b = aiPanel.getBoundingClientRect(); const dx = e.clientX - b.left; const dy = e.clientY - b.top;
      head.setPointerCapture(e.pointerId); aiPanel.classList.add('dragging');
      const move = (ev) => { const x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx)); const y = Math.max(0, Math.min(window.innerHeight - 48, ev.clientY - dy)); aiPanel.style.left = x + 'px'; aiPanel.style.top = y + 'px'; aiPanel.style.right = 'auto'; };
      const up = () => { aiPanel.classList.remove('dragging'); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    });
  }
  function aiToggle(open) {
    const show = open === undefined ? aiPanel.hidden : open;
    if (show && aiPanel.hidden) aiPlace(); // opened again → the medium size under the button
    aiPanel.hidden = !show; aiBtn.setAttribute('aria-expanded', String(show));
    if (show) { aiDraw(); aiInput.focus(); } else aiBtn.focus();
  }
  function AiButton() {
    aiBtn = h('button', { type: 'button', class: 'ai-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'مساعد AI', title: 'مساعد AI — نفّذ أوامرك' }, Icon('sparkle', 'sm'), h('span', null, 'AI'));
    aiBtn.addEventListener('click', () => aiToggle());
    return aiBtn;
  }
  function aiDragHead() { const head = h('div', { class: 'ai-head', title: 'اسحب من هنا عشان تحرّك المساعد — وكبّره أو صغّره من الركن' }, Icon('sparkle'), h('h2', { class: 't-h5' }, 'مساعد AI'), h('span', { class: 'grow' }), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => aiToggle(false) })); aiDrag(head); return head; }
  function AiPanel() {
    aiList = h('div', { class: 'ai-list', role: 'log', 'aria-live': 'polite' });
    aiInput = h('input', { class: 'ai-input', type: 'text', placeholder: 'اكتب أمرك… مثال: افتح الأوردرات', 'aria-label': 'أمر للمساعد', autocomplete: 'off', maxlength: '200' });
    aiSendBtn = h('button', { type: 'submit', class: 'icon-btn ai-send', 'aria-label': 'إرسال', title: 'إرسال' }, Icon('send'));
    aiStopBtn = Button({ size: 'sm', label: 'إيقاف', onClick: () => { if (aiCtl) aiCtl.abort(); } }); aiStopBtn.hidden = true;
    const form = h('form', { class: 'ai-form' }, aiInput, aiSendBtn, aiStopBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = aiInput.value; aiInput.value = ''; aiRun(v); aiInput.focus(); });
    aiPanel = h('section', { class: 'ai-panel', role: 'dialog', 'aria-label': 'مساعد AI' },
      aiDragHead(),
      aiList,
      h('div', { class: 'ai-chips' }, AI_EXAMPLES.map((x) => Button({ size: 'sm', label: x, onClick: () => aiRun(x) }))),
      form,
      (aiNoteEl = h('p', { class: 'ai-note t-small' }, 'محادثة مع Claude على بياناتك بصلاحياتك. أي تسجيل بيطلب تأكيدك الأول.')));
    aiPanel.hidden = true;
    aiPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); aiToggle(false); } });
    return aiPanel;
  }

  // ---------- date range picker ----------
  function DateRangeField(target = 'accounts') {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'date-field', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'اختيار الفترة' }, Icon('cal', 'sm'), h('span', { class: 'range-label' }, target === 'dash' ? dashRangeLabel(rangeOf(target)) : target === 'vledger' && !state.vlrange ? 'كل الفترات' : D.rangeLabel(rangeOf(target).from, rangeOf(target).to)), Icon('chevD', 'sm'));
    const pop = U.popover(wrap, trig, (close) => RangePicker(close, target));
    trig.addEventListener('click', pop.toggle);
    wrap.append(trig); return wrap;
  }
  // dashboard: the preset name + what it is compared with (Figma «الفترة: النهارده · مقارنة بإمبارح»)
  const dashRangeLabel = (r) => { const p = PRESETS.find((x) => x[0] === r.preset); if (!p || r.preset === 'custom') return D.rangeLabel(r.from, r.to) + ' · مقارنة بالفترة اللي قبلها'; return 'الفترة: ' + p[1] + ' · ' + (r.preset === 'today' ? 'مقارنة بأمس' : 'مقارنة بالفترة اللي قبلها'); };
  const rangeOf = (target) => (target === 'reports' ? state.rrange : target === 'dash' ? state.drange : target === 'mlog' ? (state.mrange = state.mrange || { from: '2026-09-01', to: TODAY, preset: 'custom' }) : target === 'plan' ? (state.prange = state.prange || planDefault()) : target === 'vledger' ? (state.vlrange || { from: TODAY.slice(0, 8) + '01', to: TODAY, preset: 'thisMonth' }) : state.range); // mlog (phase 5.5 decision 4, owner 1 Nov): the moves log's own period, wide by default
  // plan (phase 9.5.1 decision 16, the v5's): the marketing plan calendar's period — from last week's Saturday, three weeks
  function planDefault() { const W = window.IbtekrCampWiz; if (W && W.planDefault) return W.planDefault(TODAY); return { from: TODAY, to: TODAY, preset: 'custom' }; }
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
          Button({ type: 'primary', label: 'تحديث', disabled: !draft.from || !draft.to || !!err, onClick: () => { const nr = { from: draft.from, to: draft.to, preset: draft.preset }; if (target === 'reports') { state.rrange = nr; close(); renderReports(); if (window.IBPages && (window.IBPages.current === 'products' || window.IBPages.current === 'hr' || window.IBPages.current === 'marketing')) window.IBPages.render(window.IBPages.current); } else if (target === 'dash') { state.drange = nr; close(); window.IBPages.render('dashboard'); } else if (target === 'mlog') { state.mrange = nr; close(); render(); } else if (target === 'plan') { state.prange = nr; close(); window.IBPages.render('marketing'); } else if (target === 'vledger') { state.vlrange = nr; close(); render(); } else { state.range = nr; close(); render(); } } }))].filter(Boolean));
    }
    draw(); return dp;
  }

  // ---------- movement forms (expense / vendor / account) ----------
  const CATEGORY_OPTS = D.CATEGORIES.map((c) => ({ value: c, label: c }));
  function openForm(kind, direction, existing, readOnly, preset) {
    const f = { amount: existing ? String(existing.amount) : '', date: existing ? existing.date : TODAY, direction, category: existing ? existing.category : '', beneficiary: '', otherName: '', type: existing ? existing.type : '', vendor: existing ? existing.vendor : '', account: existing ? existing.account : '',
      subName: existing && existing.subName ? existing.subName : '', subEnds: existing && existing.subEnds ? existing.subEnds : '', subAlerts: existing && existing.subAlerts ? existing.subAlerts.slice() : ['month', 'week', 'day'], subNote: existing && existing.subNote ? existing.subNote : '',
      platform: existing && existing.platform ? existing.platform : '', details: existing && existing.details ? existing.details : '', note: existing && existing.note ? existing.note : '',
      staffKind: existing && existing.staffKind ? existing.staffKind : 'staff', source: existing && existing.source ? existing.source : '', reason: existing && existing.reason ? existing.reason : '' };
    if (existing && kind === 'expenses') { if (existing.beneficiaryIsOther) { f.beneficiary = D.OTHER; f.otherName = existing.beneficiaryName; } else f.beneficiary = existing.beneficiaryName; }
    if (existing && kind === 'vendorMoves' && existing.type === 'أخرى') f.otherName = existing.typeName;
    if (preset) Object.assign(f, preset);
    let errs = {}; let modal = null;
    const dirWord = direction === 'deposit' ? 'إيداع' : 'سحب';
    const titles = { expenses: dirWord + ' مصروفات', vendorMoves: direction === 'deposit' ? 'إيداع — تصحيح رصيد المبتكر' : 'سحب من رصيد المبتكر', accountMoves: direction === 'deposit' ? 'إيداع في الحساب' : 'سحب من الحساب' };
    const title = readOnly ? 'تفاصيل الحركة' : (existing ? 'تعديل — ' : '') + titles[kind];
    const vendorOpts = SEED.vendors.map((v) => ({ value: v.name, label: v.name }));
    const benefOpts = [...vendorOpts, { value: D.OTHER, label: D.OTHER }];
    const typeOpts = D.VENDOR_TYPES.map((t) => ({ value: t, label: t }));
    const accOpts = D.ACCOUNTS.map((a) => ({ value: a, label: a }));

    function body() {
      if (readOnly) {
        const rows = [['التاريخ', num(D.formatDateNumeric(existing.date))], ['العملية', existing.direction === 'deposit' ? 'إيداع' : 'سحب'], ['المبلغ (ج.م)', num(D.formatMoney(existing.amount))]];
        if (kind === 'expenses') { rows.push(['النوع', existing.category]);
          if (existing.category === SUBS_CAT && existing.direction !== 'deposit') rows.push(['الاشتراك', existing.subName || '—'], ['تاريخ الانتهاء', existing.subEnds ? num(D.formatDateNumeric(existing.subEnds)) : '—'],
            ['التنبيه قبل الانتهاء', (existing.subAlerts || []).map((k) => (D.SUB_ALERTS.find((a) => a[0] === k) || [, k])[1]).join(' · ') || '—'], ['ملاحظة', existing.subNote || '—']);
          else if (existing.direction === 'deposit') rows.push(['مصدر المبلغ', existing.beneficiaryName || '—'], ['سبب الإيداع', existing.reason || '—'], ['ملاحظات', existing.note || '—']);
          else if (existing.category === ADS_CAT) rows.push(['المنصة', existing.platform || '—'], ['تفاصيل', existing.details || '—'], ['ملاحظات', existing.note || '—']);
          else if (existing.category === PAY_CAT) rows.push(['المستفيد', existing.beneficiaryName || '—'], ['نوع التعاقد', existing.staffKind === 'freelance' ? 'فريلانس' : 'موظف'], ['ملاحظات', existing.note || '—']);
          else rows.push(['المستفيد', existing.beneficiaryName || '—'], ['تفاصيل المصروف', existing.details || '—'], ['ملاحظات', existing.note || '—']); }
        if (kind === 'accountMoves') rows.push(['نوع الحساب', existing.account]);
        if (kind === 'vendorMoves') { rows.push(['المبتكر', existing.vendor || '—'], [existing.direction === 'deposit' ? 'عنوان المعاملة' : 'النوع', existing.typeName || existing.type || '—'], [existing.direction === 'deposit' ? 'الوصف' : 'ملاحظات', existing.note || '—']);
          rows.push(['التسوية', existing.settledBy != null ? 'اتصفّت مع طلب السحب #' + existing.settledBy + ' — نهائية' : 'لسه ماتصفّتش (بتتخصم من الصافي)']); }
        rows.push(['سُجّل بواسطة', existing.createdBy]);
        return [h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))];
      }
      const fields = [];
      if (kind === 'vendorMoves') fields.push(U.Select({ id: 'f-vendor', label: 'المبتكر', required: true, options: vendorOpts, value: f.vendor, error: errs.vendor, placeholder: 'اختار المبتكر', onChange: (v) => { f.vendor = v; redraw(); } }));
      if (kind === 'accountMoves') fields.push(U.Select({ id: 'f-account', label: 'نوع الحساب', required: true, options: accOpts, value: f.account, error: errs.account, placeholder: 'اختار نوع الحساب', onChange: (v) => { f.account = v; redraw(); } }));
      fields.push(U.TextInput({ id: 'f-amount', label: 'المبلغ', required: true, value: f.amount, error: errs.amount, placeholder: '0.00', inputmode: 'decimal', suffix: 'ج.م', onInput: (v) => { f.amount = v; } }));
      // التاريخ بيتأكّد على blur: منعملش redraw كامل غير لو حالة الغلط اتغيرت، عشان الضغطة اللي بعده متضيعش
      fields.push(U.DateField({ id: 'f-date', label: direction === 'deposit' ? 'تاريخ الإيداع' : 'تاريخ السحب', required: true, value: f.date, error: errs.date, today: TODAY,
        onChange: (iso, e) => { const had = !!errs.date; if (!e) f.date = iso; errs.date = e || undefined; if (had !== !!e) redraw(); } }));
      if (kind === 'expenses') {
        fields.push(U.Select({ id: 'f-cat', label: 'النوع', required: true, options: CATEGORY_OPTS, value: f.category, error: errs.category, onChange: (v) => { f.category = v; redraw(); } }));
        fields.push(...expenseFields(f, errs, redraw, direction));
      }
      if (kind === 'vendorMoves' && direction === 'deposit') {
        // 0078: «إيداع» = a balance correction only — the transaction's title and its description (the kind is «أخرى» on the server)
        fields.push(U.TextInput({ id: 'f-other', label: 'عنوان المعاملة', required: true, value: f.otherName, error: errs.otherName, placeholder: 'مثلًا: فرق سعر مقاس مخصص', maxlength: 80, onInput: (v) => { f.otherName = v; } }));
        fields.push(U.Textarea({ id: 'f-note', label: 'الوصف', value: f.note, placeholder: 'اكتب سبب التصحيح (اختياري)', maxlength: 500, rows: 2, onInput: (v) => { f.note = v; } }));
        fields.push(U.InlineNote({ children: 'الإيداع لتصحيح رصيد المبتكر بس — المبلغ بيتضاف على الصافي. العربون والمواصلات وأي مبلغ اتدفع للمبتكر يتسجّلوا «سحب».' }));
      } else if (kind === 'vendorMoves') {
        fields.push(U.Select({ id: 'f-type', label: 'النوع', required: true, options: typeOpts, value: f.type, error: errs.type, onChange: (v) => { f.type = v; if (v !== 'أخرى') f.otherName = ''; redraw(); } }));
        if (f.type === 'أخرى') fields.push(U.TextInput({ id: 'f-other', label: 'اكتب النوع', required: true, value: f.otherName, error: errs.otherName, placeholder: 'اكتب النوع', maxlength: 80, onInput: (v) => { f.otherName = v; } }));
        fields.push(U.Textarea({ id: 'f-note', label: 'ملاحظات', value: f.note, placeholder: 'اختياري', maxlength: 500, rows: 2, onInput: (v) => { f.note = v; } }));
        fields.push(U.InlineNote({ children: 'السحب بيتخصم من صافي المبتكر حتى لو رصيده بقى بالسالب، ولما طلب سحب يتوافق عليه بيتصفّى منه.' }));
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
      if (kind === 'expenses') {
        const cres = D.validateExpenseCategory(Object.assign({}, f, { direction }));
        Object.assign(res.errors, cres.errors); if (!Object.keys(cres.errors).length) Object.assign(res.value, cres.value);
        if (direction !== 'deposit' && f.category === SUBS_CAT) { const sres = D.validateSubscription(f); Object.assign(res.errors, sres.errors); if (!Object.keys(sres.errors).length) Object.assign(res.value, sres.value); }
      }
      if (Object.keys(res.errors).length) { errs = res.errors; redraw(); return; }
      if (kind === 'accountMoves') {
        const others = existing ? store.accountMoves.filter((r) => r.id !== existing.id) : store.accountMoves;
        const chk = D.deriveAccounts(SEED.accounts, [...others, { ...res.value }]);
        if (!chk.ok) { errs = { _form: 'الرصيد مش كفاية في ' + chk.account + ' — العملية دي هتخليه بالسالب.' }; redraw(); return; }
      }
      if (existing) adapter.update(kind, existing.id, res.value); else adapter.add(kind, res.value);
      if (kind === 'expenses' && direction !== 'deposit' && f.category === PAY_CAT && res.value.beneficiaryIsOther && res.value.staffKind === 'staff') {
        window.IBKit.notify({ title: 'ضيف «' + res.value.beneficiaryName + '» في الموارد البشرية — اتصرفله مرتب وهو لسه مش في الفريق', link: '#hr-team' });
        window.IBKit.logEvent('expenses.newStaff', res.value.beneficiaryName);
      }
      const outOfRange = kind === 'expenses' && !inRange(res.value.date);
      setNote({ kind: 'success', text: existing ? 'اتحفظ التعديل.' : 'اتسجّلت الحركة.' + (outOfRange ? ' التاريخ (' + D.formatDateNumeric(res.value.date) + ') خارج الفترة المعروضة.' : ''),
        action: outOfRange ? { label: 'اعرضهالي', run: () => { const d = res.value.date; const [y, m] = d.split('-').map(Number);
          state.range = { from: d.slice(0, 8) + '01', to: d.slice(0, 8) + String(lastDay(y, m)).padStart(2, '0'), preset: 'custom' }; render(); } } : null });
      modal.close(); render();
    }
    modal = U.Modal({ title, body: [], footer: [] });
        modal.setBody(...body()); modal.setFooter(...footer());
    const first = modal.el.querySelector('input,.select'); if (first && !readOnly) first.focus();
  }

  // ---------- حقول المصروفات حسب النوع (owner 27 Oct) ----------
  // كل نوع مصروف ليه حقوله المنطقية: الاشتراكات (مفيش مستفيد) · المرتبات (الفريق) · المصروفات (تفاصيل) · الإعلانات (المنصة).
  const SUBS_CAT = 'الاشتراكات', PAY_CAT = 'المرتبات', ADS_CAT = 'الإعلانات', GEN_CAT = 'المصروفات';
  // قوايم قابلة للإضافة من البوب أب نفسه — phase 4.1 (decision 3): the defaults of block 02 + acc_list_items (IBAccounts.lists)
  const listWith = (key, base) => { const out = base.slice(); (AC() && AC().lists ? AC().lists(key) : []).forEach((n) => { if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n); }); return out; };
  const subsList = () => listWith('subs', D.SUB_NAMES.filter((n) => n !== D.OTHER && n !== 'أخرى'));
  const adPlatforms = () => listWith('ads', D.AD_PLATFORMS);
  const NEW_VAL = '__new__';
  const withNew = (list, label) => list.map((n) => ({ value: n, label: n })).concat([{ value: NEW_VAL, label: label, icon: 'plus' }]);
  // بوب أب صغير يضيف قيمة جديدة للقايمة ويختارها على طول
  function addToList(title, label, list, exists, done, key) {
    const K = window.IBKit;
    K.form({ title, values: { name: '' },
      fields: (ff, e, set) => [K.field.text('name', label, ff, e, set, { required: true, maxlength: 60, help: 'هيتضاف للقايمة وتقدر تختاره بعد كده' })],
      validate: (ff) => { const v = (ff.name || '').trim(); if (!v) return { name: 'اكتب الاسم' }; if (exists(v)) return { name: 'موجود في القايمة بالفعل' }; return {}; },
      submitLabel: 'إضافة', submit: (ff) => { const v = ff.name.trim(); list.push(v); if (AC() && AC().addListItem) settle(AC().addListItem(key, v)); K.logEvent('expenses.list.add', title + ' · ' + v); K.toast('اتضاف «' + v + '» للقايمة', 'success'); done(v); } });
  }
  // تاريخ التنبيه = تاريخ الانتهاء − أيام التنبيه
  const alertDate = (ends, key) => { if (!ends) return null; const t = Date.parse(ends + 'T00:00:00Z') - D.subAlertDays(key) * 86400000; return new Date(t).toISOString().slice(0, 10); };
  // الشيبس بتتبنى مرة واحدة وبتتحدّث في مكانها (مفيش إعادة إنشاء) عشان الضغطة متضيعش
  // لما الفيلد اللي قبلها يعمل blur ويحدّث التواريخ.
  function alertChips(f, errs) {
    const help = h('p', { class: 't-small help', id: 'f-subal-help', 'aria-live': 'polite' });
    const made = D.SUB_ALERTS.map(([k, lb]) => {
      const tick = h('span', { class: 'chip-tick', 'aria-hidden': 'true' }, Icon('check', 'sm'));
      const date = h('small', { class: 'chip-date' });
      const b = h('button', { type: 'button', class: 'chip alert-chip', role: 'checkbox', 'data-subal': k }, tick, h('span', null, lb), date);
      const toggle = () => { f.subAlerts = f.subAlerts.includes(k) ? f.subAlerts.filter((x) => x !== k) : f.subAlerts.concat([k]); sync(); };
      // بالماوس بنقلب على mousedown (من غير preventDefault عشان الفيلد اللي فوق يعمل blur ويحفظ قيمته):
      // لو استنينا الـ click، تحديث تواريخ التنبيه بيزحزح الصف والضغطة بتضيع.
      b.addEventListener('mousedown', () => toggle());
      b.addEventListener('click', (e) => e.preventDefault());
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return { k, lb, b, tick, date };
    });
    const row = h('div', { class: 'chips alert-chips', role: 'group', 'aria-label': 'التنبيه قبل الانتهاء', id: 'f-subal-chips' }, made.map((x) => x.b));
    function sync() {
      made.forEach((x) => { const on = f.subAlerts.includes(x.k); const d = alertDate(f.subEnds, x.k);
        x.b.setAttribute('aria-pressed', String(on)); x.b.setAttribute('aria-checked', String(on));
        x.tick.hidden = !on; x.date.textContent = d ? D.formatDateNumeric(d) : ''; x.date.hidden = !d; });
      const on = D.SUB_ALERTS.filter(([k]) => f.subAlerts.includes(k));
      help.textContent = !f.subEnds ? 'حدّد تاريخ الانتهاء الأول عشان نحسب تواريخ التنبيه.'
        : on.length ? 'هيوصلك تنبيه في: ' + on.map(([k, lb]) => lb + ' (' + D.formatDateNumeric(alertDate(f.subEnds, k)) + ')').join(' · ')
          : 'مفيش تنبيه متحدد — اختار واحد على الأقل.';
    }
    sync();
    const shell = U.FieldShell({ id: 'f-subal', label: 'تنبيه قبل الانتهاء', required: true, error: errs.subAlerts }, h('div', null, row, help));
    shell.__sync = sync;
    return shell;
  }
  function expenseFields(f, errs, redraw, direction) {
    const K = window.IBKit; const out = [];
    const txt = (id, key, label, opts) => U.TextInput(Object.assign({ id, label, value: f[key], error: errs[key], onInput: (v) => { f[key] = v; } }, opts || {}));
    const area = (id, key, label, opts) => U.Textarea(Object.assign({ id, label, value: f[key], error: errs[key], rows: 2, onInput: (v) => { f[key] = v; } }, opts || {}));
    // الإيداع في المصروفات = فلوس راجعة (استرجاع / إلغاء اشتراك / خصم) — مش نفس حقول السحب
    if (direction === 'deposit') {
      out.push(txt('f-src', 'source', 'مصدر المبلغ', { required: true, maxlength: 80, placeholder: 'مين رجّع الفلوس — مبتكر، منصة إعلانات، موظف…' }));
      out.push(U.Select({ id: 'f-reason', label: 'سبب الإيداع', required: true, options: D.REFUND_REASONS.map((r) => ({ value: r, label: r })), value: f.reason, error: errs.reason, placeholder: 'اختار السبب', onChange: (v) => { f.reason = v; redraw(); } }));
      out.push(area('f-note', 'note', 'ملاحظات', { placeholder: 'اختياري — رقم الفاتورة، المرجع، أي تفاصيل' }));
      return out;
    }
    if (f.category === SUBS_CAT) {
      const list = subsList();
      out.push(h('div', { class: 'form-sec' }, h('h3', { class: 't-label' }, 'بيانات الاشتراك'), h('p', { class: 't-small help' }, 'الاشتراك مش بيتربط بمبتكر — بيتربط بالخدمة نفسها وميعاد انتهائها.')));
      out.push(U.Select({ id: 'f-subname', label: 'اشتراك إيه', required: true, options: withNew(list, '+ إضافة اشتراك جديد'), value: f.subName, error: errs.subName, placeholder: 'اختار الاشتراك',
        onChange: (v) => { if (v === NEW_VAL) { addToList('إضافة اشتراك جديد', 'اسم الاشتراك', list, (x) => list.some((n) => n.toLowerCase() === x.toLowerCase()), (nv) => { f.subName = nv; redraw(); }, 'subs'); return; } f.subName = v; redraw(); } }));
      const chips = alertChips(f, errs);
      out.push(U.DateField({ id: 'f-subends', label: 'تاريخ الانتهاء', required: true, value: f.subEnds || null, error: errs.subEnds, today: TODAY,
        onChange: (iso, e) => { const had = !!errs.subEnds; if (!e) f.subEnds = iso || ''; errs.subEnds = e || undefined; if (had !== !!e) redraw(); else chips.__sync(); } }));
      out.push(chips);
      out.push(area('f-subnote', 'subNote', 'ملاحظة', { placeholder: 'اكتب أي حاجة — رقم الفاتورة، الكارت اللي بيتخصم منه، شهري ولا سنوي…' }));
      return out;
    }
    if (f.category === PAY_CAT) {
      const mem = K.team().concat([K.member(K.ME)]).filter(Boolean);
      const opts = mem.map((m) => ({ value: m.name, label: m.name + ' — ' + (m.title || m.role || '') })).concat([{ value: D.OTHER, label: D.OTHER + ' (حد من بره الفريق)' }]);
      out.push(U.Select({ id: 'f-ben', label: 'المستفيد', required: true, options: opts, value: f.beneficiary, error: errs.beneficiary, placeholder: 'اختار من الفريق',
        onChange: (v) => { f.beneficiary = v; if (v !== D.OTHER) f.otherName = ''; redraw(); } }));
      if (f.beneficiary === D.OTHER) {
        out.push(txt('f-other', 'otherName', 'اسم المستفيد', { required: true, maxlength: 80, placeholder: 'اكتب الاسم' }));
        out.push(K.Radios({ label: 'ده مين بالظبط؟', name: 'f-staffkind', value: f.staffKind,
          options: [{ value: 'staff', label: 'موظف جديد — ضيفه في الموارد البشرية' }, { value: 'freelance', label: 'فريلانس — شغل مرة واحدة وخلص' }],
          onChange: (v) => { f.staffKind = v; redraw(); } }));
        if (f.staffKind === 'staff') out.push(U.InlineNote({ children: 'هيتسجل كمصروف دلوقتي، وهنفكّرك تضيفه في «الموارد البشرية › الفريق» عشان مرتبه الجاي يتحسب تلقائي.' }));
      }
      out.push(area('f-note', 'note', 'ملاحظات', { placeholder: 'اختياري — شهر المرتب، مكافأة، سلفة…' }));
      return out;
    }
    if (f.category === ADS_CAT) {
      const list = adPlatforms();
      out.push(U.Select({ id: 'f-plat', label: 'المنصة', required: true, options: withNew(list, '+ إضافة منصة جديدة'), value: f.platform, error: errs.platform, placeholder: 'اختار المنصة',
        onChange: (v) => { if (v === NEW_VAL) { addToList('إضافة منصة إعلانات', 'اسم المنصة', list, (x) => list.some((n) => n.toLowerCase() === x.toLowerCase()), (nv) => { f.platform = nv; redraw(); }, 'ads'); return; } f.platform = v; redraw(); } }));
      out.push(area('f-details', 'details', 'تفاصيل المصروف', { placeholder: 'اسم الحملة أو الفترة — مثلاً: حملة «خريف 2026» من 1 لـ 15 أكتوبر' }));
      out.push(area('f-note', 'note', 'ملاحظات', { placeholder: 'اختياري' }));
      return out;
    }
    // المصروفات العامة
    out.push(U.Select({ id: 'f-ben', label: 'المستفيد', options: benefOptsFor(), value: f.beneficiary, error: errs.beneficiary, placeholder: 'اختار المستفيد (اختياري)',
      onChange: (v) => { f.beneficiary = v; if (v !== D.OTHER) f.otherName = ''; redraw(); } }));
    if (f.beneficiary === D.OTHER) out.push(txt('f-other', 'otherName', 'اسم المستفيد', { required: true, maxlength: 80, placeholder: 'اكتب الاسم' }));
    out.push(area('f-details', 'details', 'تفاصيل المصروف', { required: true, placeholder: 'اكتب المصروف ده إيه بالظبط — مثلاً: ورق طباعة وكراتين تغليف من مكتبة سمير' }));
    out.push(area('f-note', 'note', 'ملاحظات', { placeholder: 'اختياري — رقم الفاتورة، مين صرف، أي تفاصيل تانية' }));
    return out;
  }
  // «البيان» في السجل: السطر اللي يفهّمك الحركة دي كانت إيه حسب نوعها
  function expenseLine(e) {
    const bits = [];
    if (e.direction === 'deposit') { if (e.reason) bits.push(e.reason); }
    else if (e.category === SUBS_CAT) { if (e.subName) bits.push('اشتراك ' + e.subName); if (e.subEnds) bits.push('بينتهي ' + D.formatDateNumeric(e.subEnds)); }
    else if (e.category === ADS_CAT) { if (e.platform) bits.push(e.platform); if (e.details) bits.push(e.details); }
    else if (e.category === PAY_CAT) { if (e.beneficiaryIsOther) bits.push(e.staffKind === 'freelance' ? 'فريلانس' : 'موظف جديد'); }
    else if (e.details) bits.push(e.details);
    if (e.note || e.subNote) bits.push(e.note || e.subNote);
    return bits.length ? num(bits.join(' · ')) : '—';
  }
  const benefOptsFor = () => SEED.vendors.map((v) => ({ value: v.name, label: v.name })).concat([{ value: D.OTHER, label: D.OTHER }]);
  // phase 4.1: the latest withdraw of each subscription (a renewal is a new expense with a later end) — acc_expenses only
  const subsAll = () => { const last = new Map(); store.expenses.filter((e) => e.category === SUBS_CAT && e.direction !== 'deposit' && e.subEnds && e.subName).forEach((e) => {
    const k = e.subName.toLowerCase(); const o = last.get(k); if (!o || e.subEnds > o.subEnds) last.set(k, e); }); return [...last.values()]; };
  // تجديد اشتراك: بيفتح مصروف جديد متملّي ببيانات الاشتراك وتاريخ انتهاء بعد سنة
  const plusYear = (iso) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y + 1, m - 1, d)); return t.toISOString().slice(0, 10); };
  function renewSub(x) {
    const base = x.ends >= TODAY ? x.ends : TODAY;
    openForm('expenses', 'withdraw', null, false, { category: SUBS_CAT, subName: x.name, amount: x.amount ? String(x.amount) : '', subEnds: plusYear(base), subAlerts: (x.alerts || []).slice(), subNote: x.note || '' });
  }
  // الاشتراكات (phase 5.5 decision 4, owner 1 Nov): في «المصروفات» ملخص بس، والتفاصيل كلها في تاب «الاشتراكات» لوحدها (زي «المبيعات»)
  const subWord = (x) => (x.expired ? 'انتهى من ' + Math.abs(x.daysLeft) + ' يوم' : x.daysLeft === 0 ? 'بينتهي النهاردة' : 'باقي ' + x.daysLeft + ' يوم');
  const subTone = (x) => (x.expired ? 'error' : x.due ? 'orange' : 'success');
  const goSubs = () => { state.tab = 'subscriptions'; try { history.replaceState(null, '', '#subscriptions'); } catch (e) { /* sandboxed */ } render(); window.scrollTo(0, 0); };
  function subsSection() {
    const rows0 = D.subsDue(subsAll(), TODAY); if (!rows0.length) return null;
    const due = rows0.filter((x) => x.due); const next = rows0.filter((x) => !x.expired).sort((p, q) => (p.ends < q.ends ? -1 : 1))[0];
    const last = rows0.reduce((n, x) => n + (Number(x.amount) || 0), 0);
    return h('section', { class: 'card subs-sum', 'data-subs-summary': '' },
      h('div', { class: 'subs-sum-h' }, h('div', null, h('h2', { class: 't-h5' }, 'الاشتراكات'), h('div', { class: 't-small help' }, 'كل الاشتراكات · مش متأثرة بفترة الصفحة')),
        Button({ size: 'sm', label: 'كل تفاصيل الاشتراكات', icon: 'chevL', attrs: { 'data-go-subs': '' }, onClick: goSubs })),
      h('div', { class: 'subs-sum-b' },
        h('div', null, h('span', { class: 't-small help' }, 'اشتراكات نشطة'), h('b', { class: 't-h4' }, num(String(rows0.filter((x) => !x.expired).length)))),
        h('div', null, h('span', { class: 't-small help' }, 'محتاجة تجديد'), h('b', { class: 't-h4' + (due.length ? ' neg' : '') }, num(String(due.length)))),
        h('div', null, h('span', { class: 't-small help' }, 'أقرب تجديد'), next ? h('b', { class: 't-body' }, next.name + ' · ', h('span', { class: 'tg tg-' + subTone(next) }, subWord(next))) : h('b', null, '—')),
        h('div', null, h('span', { class: 't-small help' }, 'إجمالي آخر دفعات'), h('b', { class: 't-h4' }, num(D.formatMoney(last)), h('small', { class: 't-small help' }, ' ج.م')))),
      due.length ? U.InlineNote({ kind: due.some((x) => x.expired) ? 'error' : 'warning', children: ['محتاجة تجديد: ' + due.map((x) => x.name + ' (' + subWord(x) + ')').join(' · ')],
        action: Button({ type: 'text', size: 'sm', label: 'جدّد ' + due[0].name, attrs: { 'data-renew-first': '' }, onClick: () => renewSub(due[0]) }) }) : null);
  }
  function SubsView() {
    subsNotify();
    const rows0 = D.subsDue(subsAll(), TODAY);
    const AL = (k) => (D.SUB_ALERTS.find((a) => a[0] === k) || [, k])[1];
    const due = rows0.filter((x) => x.due), active = rows0.filter((x) => !x.expired);
    const pays = store.expenses.filter((e) => e.category === SUBS_CAT && e.direction !== 'deposit').slice().sort((p, q) => (p.date < q.date ? 1 : -1));
    const inPer = pays.filter((e) => inRange(e.date)); const perSum = inPer.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const per = 'من ' + D.formatDateNumeric(state.range.from) + ' لـ ' + D.formatDateNumeric(state.range.to);
    const lastPay = (name) => pays.find((e) => e.subName === name);
    const yearly = (x) => (/سنوي/.test(x.note || '') ? Number(x.amount) || 0 : /شهري/.test(x.note || '') ? (Number(x.amount) || 0) * 12 : Number(x.amount) || 0);
    const headers = ['الاشتراك', 'المستفيد', 'تاريخ التجديد', 'الحالة', 'آخر دفعة (ج.م)', 'تاريخ آخر دفعة', 'التكلفة السنوية (ج.م)', 'التنبيه قبل الانتهاء', 'ملاحظة', ''];
    const rows = rows0.map((x) => { const lp = lastPay(x.name) || {}; return [x.name, lp.beneficiaryName || '—', num(D.formatDateNumeric(x.ends)), h('span', { class: 'tg tg-' + subTone(x) }, subWord(x)), num(D.formatMoney(x.amount || 0)), lp.date ? num(D.formatDateNumeric(lp.date)) : '—', num(D.formatMoney(yearly(x))), (x.alerts || []).map(AL).join(' · ') || '—', x.note || '—',
      Button({ type: x.due ? 'primary' : 'text', size: 'sm', label: 'جدّد', attrs: { 'data-renew': x.name, 'aria-label': 'جدّد اشتراك ' + x.name }, onClick: () => renewSub(x) })]; });
    const payH = ['التاريخ', 'الاشتراك', 'المستفيد', 'المبلغ (ج.م)', 'ينتهي في', 'المصدر'];
    const payRows = inPer.map((e) => [num(D.formatDateNumeric(e.date)), e.subName || '—', e.beneficiaryName || '—', num(D.formatMoney(e.amount || 0)), e.subEnds ? num(D.formatDateNumeric(e.subEnds)) : '—', 'تسجيل يدوي']);
    const det = (title, list) => () => ({ title, sub: 'كل الاشتراكات · مش متأثرة بالفترة', headers: ['الاشتراك', 'تاريخ التجديد', 'الحالة', 'آخر دفعة'], rows: list.map((x) => [x.name, D.formatDateNumeric(x.ends), subWord(x), D.formatMoney(x.amount || 0)]), source: 'المصدر: سجل الاشتراكات (المصروفات المتسجلة في السيستم)' });
    return [
      h('div', { class: 'cards four' },
        U.KpiTile({ label: 'اشتراكات نشطة', value: String(active.length), unit: 'اشتراك', compare: 'off', note: 'من ' + rows0.length + ' مسجّل', details: det('الاشتراكات النشطة — ' + active.length, active) }),
        U.KpiTile({ label: 'محتاجة تجديد', value: String(due.length), unit: 'اشتراك', compare: due.length ? 'negative' : 'off', note: due.length ? due.map((x) => x.name).join(' · ') : 'كله ساري', details: det('محتاجة تجديد — ' + due.length, due) }),
        U.KpiTile({ label: 'التكلفة السنوية المتوقعة', value: D.formatMoney(rows0.reduce((n, x) => n + yearly(x), 0)), unit: 'ج.م', compare: 'off', note: 'الشهري × 12 + السنوي' }),
        U.KpiTile({ label: 'مدفوع في الفترة', value: D.formatMoney(perSum), unit: 'ج.م', compare: 'off', note: per + ' · ' + inPer.length + ' دفعة' })),
      due.length ? U.InlineNote({ kind: due.some((x) => x.expired) ? 'error' : 'warning', children: ['اشتراكات محتاجة تجديد: ' + due.map((x) => x.name + ' (' + subWord(x) + ')').join(' · ')],
        action: Button({ type: 'text', size: 'sm', label: 'جدّد ' + due[0].name, attrs: { 'data-renew-first': '' }, onClick: () => renewSub(due[0]) }) }) : null,
      TableCard({ title: 'الاشتراكات ومواعيد تجديدها', count: rows0.length + ' اشتراك' + (due.length ? ' · ' + due.length + ' محتاج تجديد' : '') + ' · كل الاشتراكات، مش متأثرة بفترة الصفحة',
        body: rows0.length ? U.Table({ cls: 'subs-tbl', headers, rows }) : U.EmptyState('مفيش اشتراكات', 'اضغط «إضافة اشتراك» وسجّل أول اشتراك وميعاد تجديده.') }),
      TableCard({ title: 'دفعات الاشتراكات في الفترة', count: per + ' · ' + inPer.length + ' دفعة · ' + D.formatMoney(perSum) + ' ج.م',
        body: inPer.length ? U.Table({ cls: 'subs-pay-tbl', headers: payH, rows: payRows, totalRow: ['الإجمالي', '', '', num(D.formatMoney(perSum)), '', inPer.length + ' دفعة'] }) : U.EmptyState('مفيش دفعات في الفترة دي', 'غيّر الفترة من فوق.') }),
      sourceNote('المصدر: سجل الاشتراكات (المصروفات المتسجلة في السيستم) · «جدّد» بتسجّل دفعة جديدة في المصروفات وبتحدّث ميعاد التجديد · التنبيه بيوصل على الجرس.')].filter(Boolean);
  }
  // تنبيه مرة واحدة لكل اشتراك مستحق (الجرس) — owner 27 Oct
  const subsNotified = {};
  function subsNotify() {
    const K = window.IBKit; if (!K || !K.notify) return;
    D.subsDue(subsAll(), TODAY).filter((x) => x.due).forEach((x) => { const key = x.name + '|' + x.ends; if (subsNotified[key]) return; subsNotified[key] = true;
      K.notify({ title: (x.expired ? 'اشتراك منتهي: ' : 'اشتراك قرب ينتهي: ') + x.name + ' — ' + (x.expired ? 'انتهى من ' + Math.abs(x.daysLeft) + ' يوم' : 'باقي ' + x.daysLeft + ' يوم'), link: '#subscriptions' });
      K.logEvent('subs.alert', x.name + ' · ' + x.ends); });
  }

  // add-button with deposit/withdraw dropdown
  function AddMenu(label, kind) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'btn btn-brand', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, Icon('plus', 'sm'), label, Icon('chevD', 'sm'));
    const opts = kind === 'vendorMoves' ? [{ value: 'withdraw', label: 'سحب — عربون · مواصلات · أخرى' }, { value: 'deposit', label: 'إيداع — تصحيح رصيد' }] : [{ value: 'withdraw', label: 'سحب' }, { value: 'deposit', label: 'إيداع' }];
    const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', options: opts, onSelect: (v) => { close(); openForm(kind, v); } }));
    trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
  }
  function RowActions(kind, rec, onDelete) {
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const trig = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'إجراءات الصف', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, Icon('more'));
    const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: [{ value: 'view', label: 'عرض' }].concat(canEditRec(rec) ? [{ value: 'edit', label: 'تعديل' }, { value: 'del', label: 'حذف', danger: true }] : []),
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
  // كل كارت جدول بياخد زرار «الأعمدة» تلقائي (4 أعمدة فأكتر) — إظهار/إخفاء وترتيب، محفوظ لكل مستخدم
  function TableCard({ title, count, action, body, cols, pre, cls }) {
    const card = h('section', { class: 'card table-card' + (cls ? ' ' + cls : '') }, h('div', { class: 'table-title' }, h('h2', { class: 't-h4' }, title), h('span', { class: 'count t-body' }, count || ''), action || null), pre || null, body);
    // the key leaves out « — <الفترة>» so a choice outlives the range picked (phase 4.1: the titles carry the period)
    return cols === false ? card : window.IBKit.withColumns(card, 'tbl:' + String(title).split(' — ')[0], title);
  }
  // phase 4: the numbers are live for the range picked (sales: our orders; makers: Dokan + the moves recorded here)
  const periodText = () => D.rangeLabel(state.range.from, state.range.to);
  const liveNote = () => { const A = window.IBAccounts; if (!A) return null;
    if (A.state() === 'error' || A.salesFailed(state.range.from, state.range.to)) return U.InlineNote({ kind: 'error', children: 'مقدرناش نحمّل بيانات الحسابات — جرّب تحدّث الصفحة.' });
    if (A.state() === 'loading' || A.sales(state.range.from, state.range.to) === null) return U.InlineNote({ children: 'بنحمّل أرقام الفترة…' });
    return null; };

  // ================= سجل الحركات (owner 27 Oct): تابس المصروفات · حسابات المبتكرين · الحساب الفعلي =================
  const MLOG_TABS = [{ id: 'expenses', label: 'المصروفات' }, { id: 'vendorMoves', label: 'حسابات المبتكرين' }, { id: 'accountMoves', label: 'الحساب الفعلي' }];
  function mlogData(kind) {
    // phase 4: the moves recorded here + Dokan's withdraw requests (read-only); no sheet rows, the opening balances are 0 until the import
    return D.movementLog(kind, { expenses: store.expenses, expenseSeed: {}, vendorMoves: store.vendorMoves.filter((m) => !(m.type === 'مواصلات' && m.direction === 'withdraw')),
      vendorSeed: [], seedDate: '', transport: transportRows(), withdrawals: dokanRequests(), accountMoves: store.accountMoves, accounts: {} });
  }
  function MovesLogView() {
    const kind = state.mlog; const r0 = mlogData(kind); const KK = window.IBKit;
    // الفترة (phase 5.5 decision 4, owner 1 Nov): فترة سجل الحركات لوحدها جنب البحث في التلات تابس — الأرصدة الافتتاحية (من غير تاريخ) بتفضل ظاهرة
    const MR = rangeOf('mlog'); const inPer = (x) => !x.date || (x.date >= MR.from && x.date <= MR.to);
    const perRows = r0.rows.filter(inPer); const sumK = (f) => D.round2(perRows.filter(f).reduce((n, x) => n + (Number(x.amount) || 0), 0));
    const r = { rows: perRows, count: perRows.length, inTotal: sumK((x) => x.kind === 'إيداع' || x.kind === 'رصيد افتتاحي'), outTotal: sumK((x) => x.kind === 'سحب'), requests: perRows.filter((x) => x.kind === 'طلب سحب').length };
    const q = (state.mlogQ || '').trim();
    const rows0 = q ? r.rows.filter((x) => (x.what + ' ' + x.who + ' ' + x.note + ' ' + x.ref).toLowerCase().includes(q.toLowerCase())) : r.rows;
    const tone = (k) => (k === 'إيداع' ? 'success' : k === 'سحب' ? 'neutral' : k === 'طلب سحب' ? 'orange' : 'goldlight');
    const headers = ['التاريخ', 'الحركة', 'البند', kind === 'vendorMoves' ? 'المبتكر' : kind === 'expenses' ? 'المستفيد' : 'الحساب', 'المبلغ (ج.م)', 'بواسطة', 'المصدر', 'المرجع', 'ملاحظة'];
    const flat = (x) => [x.date, x.kind, x.what, kind === 'accountMoves' ? x.what : x.who, x.amount, x.by, x.source, x.ref, x.note];
    const rid = (x, i) => kind + ':' + (x.id || x.ref || '') + ':' + i; const ids0 = rows0.map(rid);
    const pickRows = (ids) => rows0.filter((x, i) => ids.includes(ids0[i]));
    // التحديد الجماعي (owner 31 Oct): تصدير المحدد إكسل / CSV
    const LB = KK.Bulk({ key: 'mlog-' + kind, ids: ids0, noun: 'حركة', render, actions: [
      { id: 'xlsx', label: 'تصدير إكسل', icon: 'download', run: (ids, done) => { KK.xlsxExport('ibtekr-moves-' + kind + '-' + TODAY + '.xlsx', 'سجل الحركات', [headers].concat(pickRows(ids).map(flat))); done(); } },
      { id: 'csv', label: 'نسخ CSV', icon: 'copy', run: (ids, done) => { csvCopy(headers, pickRows(ids).map(flat), 'سجل الحركات (المحدد)'); done(); } }] });
    const rows = rows0.map((x, i) => [LB.box(ids0[i], x.what), num(x.date ? D.formatDateNumeric(x.date) : '—'), h('span', { class: 'tg tg-' + tone(x.kind) }, x.kind), x.what, kind === 'accountMoves' ? x.what : x.who, num(D.formatMoney(x.amount)), x.by, x.source, x.ref ? h('bdi', { dir: 'ltr' }, x.ref) : '—', x.note || '—']);
    const search = h('input', { type: 'search', class: 'input', placeholder: 'ابحث بالبند أو الاسم أو المرجع', 'aria-label': 'بحث في سجل الحركات', value: state.mlogQ || '', style: 'width:300px;max-width:100%' });
    search.addEventListener('input', () => { state.mlogQ = search.value; const p = search.selectionStart; render(); const n = document.querySelector('#panel input[type=search]'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
    return h('div', { style: 'display:flex;flex-direction:column;gap:24px;min-width:0' },
      KK.SubTabs ? KK.SubTabs({ items: MLOG_TABS, active: kind, label: 'أقسام سجل الحركات', onChange: (id) => { state.mlog = id; state.mlogQ = ''; render(); } }) : null,
      h('div', { class: 'cards four' },
        U.KpiTile({ label: 'عدد الحركات', value: String(r.count), unit: 'حركة', compare: 'off', note: (MLOG_TABS.find((t) => t.id === kind) || {}).label + ' · في الفترة المختارة' }),
        U.KpiTile({ label: 'داخل', value: D.formatMoney(r.inTotal), unit: 'ج.م', compare: 'off', note: kind === 'accountMoves' ? 'إيداعات + الرصيد الافتتاحي' : 'إيداعات وعرابين' }),
        U.KpiTile({ label: 'خارج', value: D.formatMoney(r.outTotal), unit: 'ج.م', compare: 'off', note: 'سحب ومصروفات ومواصلات' }),
        kind === 'vendorMoves' ? U.KpiTile({ label: 'طلبات سحب', value: String(r.requests), unit: 'طلب', compare: 'off', note: 'من المبتكرين على Dokan' })
          : U.KpiTile({ label: 'الصافي', value: D.formatMoney(D.round2(r.inTotal - r.outTotal)), unit: 'ج.م', compare: 'off', note: 'داخل − خارج' })),
      h('div', { class: 'toolbar mlog-bar' }, search, DateRangeField('mlog'), h('span', { class: 'grow' }), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, num(rows0.length + ' من ' + r.count + ' حركة في الفترة')),
        Button({ label: 'نسخ CSV', icon: 'download', attrs: { 'data-mlog-csv': '' }, onClick: () => csvCopy(headers, rows0.map(flat), 'سجل الحركات — ' + (MLOG_TABS.find((t) => t.id === kind) || {}).label) })),
      TableCard({ title: 'سجل الحركات — ' + (MLOG_TABS.find((t) => t.id === kind) || {}).label, count: rows0.length + ' حركة', pre: LB.bar(),
        body: rows0.length ? tableOrList(() => U.Table({ cls: 'mlog-table', headers: [LB.head()].concat(headers), rows }), () => CardList({ headers: [''].concat(headers), titleIndex: 3, rows })) : U.EmptyState('مفيش حركات', q ? 'مفيش نتيجة للبحث ده — امسح البحث.' : 'مفيش حركات في الفترة دي — غيّر الفترة من جنب البحث.') }),
      sourceNote('المصدر: الحركات المتسجلة في السيستم + طلبات السحب من Dokan (قراءة بس).'));
  }
  // تفاصيل المصروفات (phase 5.5 decision 4, owner 1 Nov): فلتر مقفول + ترتيب في راس الكارت، ونتيجة الفلتر شيبس تحت التايتل قبل راس الجدول
  const EXP_SORTS = [['default', 'الترتيب الافتراضي'], ['amt-desc', 'القيمة: الأعلى للأقل'], ['amt-asc', 'القيمة: الأقل للأعلى'], ['name', 'البند: أ ← ي']];
  function expDetailsCard(tot, srcFor) {
    const KK = window.IBKit; const f = (state.expF = state.expF || { cat: [] }); const sort = state.expSort || 'default';
    const all = D.CATEGORIES.map((c, i) => ({ c, i, amt: tot.byCategory[c].amount, share: tot.byCategory[c].share }));
    const ok = (x, d) => !(d.cat || []).length || d.cat.includes(x.c);
    let list = all.filter((x) => ok(x, f));
    if (sort === 'amt-desc') list = list.slice().sort((p, q) => q.amt - p.amt); else if (sort === 'amt-asc') list = list.slice().sort((p, q) => p.amt - q.amt); else if (sort === 'name') list = list.slice().sort((p, q) => p.c.localeCompare(q.c, 'ar'));
    const sum = list.reduce((n, x) => n + x.amt, 0);
    const chips = (f.cat || []).map((v) => ({ key: 'cat:' + v, label: 'البند: ' + v, count: all.filter((x) => x.c === v).length, remove: () => { f.cat = f.cat.filter((x) => x !== v); render(); } }));
    // the owner 12 Nov: «فلتر» back next to the sort in the header (B5 had it as a row under the title)
    const filters = KK.FilterMenu({ id: 'exp', label: 'فلتر تفاصيل المصروفات', noun: 'بند', value: f, groups: [{ key: 'cat', label: 'البند', options: D.CATEGORIES.map((c) => [c, c]) }], count: (d) => all.filter((x) => ok(x, d)).length, onApply: (d) => { state.expF = d; render(); } });
    const actions = h('span', { class: 'acts-inline' }, filters, KK.SortMenu({ id: 'exp', label: 'ترتيب تفاصيل المصروفات', options: EXP_SORTS, value: sort, onChange: (v) => { state.expSort = v; render(); } }));
    return TableCard({ title: 'تفاصيل المصروفات', cls: 'own-filter', count: chips.length ? list.length + ' من ' + all.length + ' بند' : '', action: actions,
      pre: KK.ActiveFilters({ id: 'exp', chips, total: list.length, noun: 'بند', onClear: () => { state.expF = { cat: [] }; render(); } }),
      body: list.length ? U.Table({ headers: ['البند', 'القيمة (ج.م)', 'النسبة', 'المصدر'], rows: list.map((x) => [x.c, num(D.formatMoney(x.amt)), num(D.formatPct(x.share)), srcFor(x.c, x.i)]),
        totalRow: chips.length ? ['إجمالي البنود المعروضة', num(D.formatMoney(sum)), num(D.formatPct(tot.total ? sum / tot.total : 0)), list.length + ' من ' + all.length + ' بند'] : ['إجمالي الأربع فئات', num(D.formatMoney(tot.total)), num(tot.total === 0 ? '0.0%' : '100.0%'), 'إجمالي المصروفات'] })
        : U.EmptyState('مفيش بنود بالفلتر ده', 'غيّر الفلتر أو امسحه.') });
  }
  // ---------- views ----------
  function ExpensesView() {
    subsNotify();
    const seedKeys = seedKeysIn(state.range);
    const entries = store.expenses.filter((e) => inRange(e.date)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, state.range.from, state.range.to);
    const full = monthOfRange(state.range);
    const monthTxt = full ? D.monthName(full.m) + ' ' + full.y : D.rangeLabel(state.range.from, state.range.to);
    const tones = { 'المرتبات': 'gold', 'المصروفات': 'neutral', 'الاشتراكات': 'goldlight', 'الإعلانات': 'brand' };
    const cells = ['M14', 'N14', 'O14', 'P14'];
    const srcFor = () => 'تسجيل يدوي';
    return [
      h('div', { class: 'cards' }, D.CATEGORIES.map((c, i) => U.CategoryCard({ tone: tones[c], name: c, value: tot.byCategory[c].amount, pct: tot.byCategory[c].share, caption: 'من الإجمالي', details: () => { const l = entries.filter((e) => e.category === c); const manual = l.reduce((x, e) => x + (e.direction === 'deposit' ? -e.amount : e.amount), 0); const sheet = Math.round((tot.byCategory[c].amount - manual) * 100) / 100;
        return { title: c + ' — ' + D.formatMoney(tot.byCategory[c].amount) + ' ج.م', sub: monthTxt + ' · ' + D.formatPct(tot.byCategory[c].share) + ' من إجمالي المصروفات', summary: [{ label: 'الإجمالي', value: D.formatMoney(tot.byCategory[c].amount) + ' ج.م' }, { label: 'من الشيت', value: D.formatMoney(seedKeys.length ? sheet : 0) + ' ج.م' }, { label: 'تسجيل يدوي', value: l.length + ' حركة' }], headers: ['التاريخ', 'البيان', 'المستفيد', 'العملية', 'المبلغ'], rows: (seedKeys.length ? [['—', 'من شيت Monthly Performance!' + cells[i], '—', 'سحب', D.formatMoney(sheet)]] : []).concat(l.map((e) => [num(D.formatDateNumeric(e.date)), 'تسجيل يدوي', e.beneficiaryName || '—', e.direction === 'deposit' ? 'إيداع' : 'سحب', D.formatMoney(e.amount)])), total: ['الإجمالي', '', '', '', D.formatMoney(tot.byCategory[c].amount)], source: srcFor(c, i) }; } }))),
      subsSection(),
      h('div', { class: 'card sum-card' }, h('div', null, h('div', { class: 'lab t-small' }, monthTxt), h('div', { class: 't-h5' }, full ? 'إجمالي مصروفات ' + D.monthName(full.m) : 'إجمالي المصروفات'),
          h('button', { type: 'button', class: 'kpi-more kpi-details', 'data-details': 'إجمالي المصروفات', 'aria-label': 'تفاصيل إجمالي المصروفات', onClick: () => U.DetailsModal(() => ({ title: 'إجمالي المصروفات — ' + D.formatMoney(tot.total) + ' ج.م', sub: monthTxt, summary: D.CATEGORIES.map((c) => ({ label: c, value: D.formatMoney(tot.byCategory[c].amount) })), headers: ['البند', 'القيمة', 'النسبة', 'المصدر'], rows: D.CATEGORIES.map((c, i) => [c, D.formatMoney(tot.byCategory[c].amount), D.formatPct(tot.byCategory[c].share), srcFor(c, i)]).concat(entries.map((e) => [e.category + ' · ' + D.formatDateNumeric(e.date), D.formatMoney(e.amount), '—', 'تسجيل يدوي — ' + (e.beneficiaryName || '—')])) }), { label: 'إجمالي المصروفات' }) }, 'التفاصيل', Icon('chevL', 'sm'))),
        h('div', { class: 'cat-val' }, h('span', { class: 'unit' }, 'ج.م'), h('span', { class: 't-h3' }, num(D.formatMoney(tot.total))))),
      expDetailsCard(tot, srcFor),
      TableCard({ title: 'سجل المصروفات التفصيلي', count: entries.length + ' مصروف مسجّل', body: entries.length === 0 ? U.EmptyState('لسه مفيش مصروفات مسجّلة', 'اضغط «إضافة مصروفات» وسجّل أول سحب أو إيداع، وهيظهر هنا.') :
        U.Table({ headers: ['التاريخ', 'النوع', 'اسم المستفيد', 'البيان', 'المبلغ (ج.م)', ''], rows: entries.map((e) => [num(D.formatDateNumeric(e.date)), e.category, e.beneficiaryName || '—', expenseLine(e),
          h('span', { class: e.direction === 'deposit' ? 'pos' : '' }, num((e.direction === 'deposit' ? '+' : '') + D.formatMoney(e.amount))), RowActions('expenses', e, (r) => deleteRec('expenses', r))]) }) }),
      sourceNote('المصدر: المصروفات المتسجلة في السيستم للفترة المحددة'),
    ].filter(Boolean);
  }

  function SalesView() {
    const S = SEED.sales, T = SEED.salesTotal; const tones = ['brand', 'gold', 'neutral'];
    const salesDet = (k, r) => { const vs = vendorsNow().map((v) => ({ v, c: k ? v[k] : [v.c[0] + v.p[0] + v.x[0], v.c[1] + v.p[1] + v.x[1], v.c[2] + v.p[2] + v.x[2]] })).filter((x) => x.c[0] > 0 || x.c[1] > 0).sort((a, b) => b.c[1] - a.c[1]);
      return { title: (k ? 'مبيعات ' + r.label : 'إجمالي المبيعات') + ' — ' + D.formatMoney(r.sales) + ' ج.م', sub: periodText() + ' · حسب المبتكر · العدد = أوردرات رئيسية مميزة لكل مبتكر وقد يتجاوز الإجمالي', summary: [{ label: 'الأوردرات', value: String(r.orders) }, { label: 'المبيعات', value: D.formatMoney(r.sales) + ' ج.م' }, { label: 'حصة إبتكر', value: D.formatMoney(r.share) + ' ج.م' }, { label: 'النسبة', value: r.pct }], headers: ['المبتكر', 'العمولة', 'الأوردرات', 'المبيعات', 'حصة إبتكر'], rows: vs.map((x) => [x.v.name, x.v.pct, String(x.c[0]), D.formatMoney(x.c[1]), D.formatMoney(x.c[2])]),
        total: (() => { const t = vs.reduce((a, x) => [a[0] + x.c[0], a[1] + x.c[1], a[2] + x.c[2]], [0, 0, 0]); return ['مجموع المبتكرين', '—', String(t[0]), D.formatMoney(t[1]), D.formatMoney(t[2])]; })(),
        note: (() => { const t = vs.reduce((a, x) => [a[0] + x.c[0], a[1] + x.c[1], a[2] + x.c[2]], [0, 0, 0]); const d = []; if (t[0] !== r.orders) d.push('عدد الأوردرات ' + t[0] + ' عند المبتكرين مقابل ' + r.orders + ' (الأوردر المشترك بيتحسب لكل مبتكر فيه)'); if (Math.abs(t[1] - r.sales) > 0.5) d.push('المبيعات ' + D.formatMoney(t[1]) + ' مقابل ' + D.formatMoney(r.sales)); if (Math.abs(t[2] - r.share) > 0.5) d.push('حصة إبتكر ' + D.formatMoney(t[2]) + ' في تاب حسابات المبتكرين مقابل ' + D.formatMoney(r.share) + ' في تاب المبيعات — فرق ' + D.formatMoney(Math.abs(t[2] - r.share)) + ' (الأوردر المشترك بيتقسم على مبتكرينه)'); return d.length ? 'فرق بين مجموع المبتكرين والإجمالي: ' + d.join(' · ') + '.' : 'مجموع المبتكرين مطابق لملخص المبيعات.'; })(),
        source: 'الأوردرات (السيستم) ← حسب حالة الأوردر وتاريخه' }; };
    return [liveNote(),
      h('div', { class: 'cards' }, [...S.map((r, i) => U.CategoryCard({ tone: tones[i], name: r.label, value: r.sales, pct: r.sales / T.sales, caption: 'من إجمالي المبيعات', details: () => salesDet(['c', 'p', 'x'][i], r) })), U.CategoryCard({ tone: 'goldlight', name: 'إجمالي المبيعات', value: T.sales, pct: 1, caption: 'من إجمالي المبيعات', details: () => salesDet(null, T) })]),
      // حصة المبتكرين = المبيعات − حصة إبتكر (owner 27 Oct: بدل «نسبة حصة إبتكر»)
      TableCard({ title: 'تفاصيل المبيعات حسب حالة الأوردر', body: U.Table({ headers: ['حالة الأوردر', 'عدد الأوردرات', 'إجمالي المبيعات (ج.م)', 'حصة إبتكر (ج.م)', 'حصة المبتكرين (ج.م)'],
        rows: S.map((r) => [r.label, num(String(r.orders)), num(D.formatMoney(r.sales)), num(D.formatMoney(r.share)), num(D.formatMoney(D.round2(r.sales - r.share)))]),
        totalRow: ['الإجمالي', num(String(T.orders)), num(D.formatMoney(T.sales)), num(D.formatMoney(T.share)), num(D.formatMoney(D.round2(T.sales - T.share)))] }) }),
      sourceNote('المصدر: الأوردرات (السيستم) للفترة المحددة · حصة إبتكر = قيمة السطر × نسبة الموقع على السطر (أو نسبتنا يومها) + الرسوم · «تحت التنفيذ» = جاري التنفيذ + جاهز للشحن + قيد الشحن · «مرتجع / ملغي» = ملغي + استرجاع + فشل · حصة المبتكرين = إجمالي المبيعات − حصة إبتكر')].filter(Boolean);
  }

  // plan 4.1 decision 13 (owner, 28 Oct): filter the makers' table to those with a Dokan withdraw request
  const WD_FILTERS = [{ value: 'all', label: 'طلبات السحب: الكل' }, { value: 'any', label: 'عندهم طلب سحب' }, { value: 'pending', label: 'مستني الموافقة بس' }];
  const wdFilterOk = (v) => { const f = state.wdFilter || 'all'; if (f === 'all') return true; const r = wdOf(v.name); return f === 'pending' ? !!r && r.status === 'pending' : !!r; };
  function WdFilterDropdown() {
    const cur = WD_FILTERS.find((x) => x.value === (state.wdFilter || 'all'));
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'sort-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-wd-filter': state.wdFilter || 'all' }, Icon('chevD', 'sm'), h('span', null, cur.label), Icon('download', 'sm'));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: WD_FILTERS, value: cur.value, onSelect: (v) => { close(); state.wdFilter = v; render(); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  function SortDropdown() {
    const sort = SORTS.find((x) => x.value === state.sort);
    const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
    const btn = h('button', { type: 'button', class: 'sort-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, Icon('chevD', 'sm'), h('span', null, sort.label), Icon('sliders', 'sm'));
    const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options: SORTS.map((x) => ({ value: x.value, label: x.label })), value: state.sort, onSelect: (v) => { close(); state.sort = v; render(); } }));
    btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap;
  }
  // ================= حسابات المبتكرين: تقرير مختصر · طلبات السحب · إظهار/إخفاء الأعمدة (owner 27 Oct) =================
  // phase 4 (decision 5): the withdraw requests are Dokan's (dokan_withdrawals, read-only) — approving one is done on Dokan
  const AC = () => window.IBAccounts;
  const makerId = (name) => { const v = vstore.findByName(name); return v ? v.id : null; };
  const wdOf = (name) => { const id = makerId(name); const r = id && AC() ? VD.openRequest(AC().withdrawals(), id) : null; return r ? Object.assign({}, r, { id: '#' + r.id, wid: r.id }) : null; };
  // the requests for the moves log: { at, vendor, amount, id, source, by, note }
  const dokanRequests = () => (AC() ? AC().withdrawals() : []).map((w) => { const v = w.vendorId && vstore.get ? vstore.get(w.vendorId) : null;
    return { at: w.at, vendor: v ? v.name : '#' + w.store, amount: w.amount, id: '#' + w.id, source: 'vendor', by: 'Dokan', note: VD.wdLabel(w.status) + (w.method ? ' · ' + w.method : '') }; });
  function vendorBriefData(name) {
    const OA = window.OrdersApp; const orders = OA ? OA.query({}, 10000).rows.map((r) => OA.get(r.id)).filter(Boolean) : [];
    const v = vstore.findByName(name); const seed = vendorsNow().find((x) => VD.norm(x.name) === VD.norm(name)) || { balance: 0, deposits: 0 };
    const rep = VD.vendorReport(orders, v && vstore.namesOf ? vstore.namesOf(v.id) : [name], seed.balance);
    // 0078: the deductions not settled yet (the transport too: seed.transport is the open «مواصلات»)
    return Object.assign(VD.accountBrief({ name, report: rep, deposits: seed.deposits || 0, transport: seed.transport || 0, balance: seed.balance || 0, request: wdOf(name) }),
      { dokanBalance: seed.dokanBalance == null ? null : seed.dokanBalance, vendorId: v ? v.id : null, hasStore: !!(v && v.wooVendorId), other: seed.other || 0, corrections: seed.corrections || 0, carry: seed.carry || 0, open: D.openOf(seed) });
  }
  // 0078: the chips of the open deductions — the ones that are not zero after the deposits and the transport
  const openChips = (b, fmt) => [{ label: 'رصيد Dokan', value: b.dokanBalance == null ? '—' : fmt(b.dokanBalance) + ' ج.م' }, { label: 'العرابين (اتخصمت)', value: fmt(b.deposits) + ' ج.م' }, { label: 'المواصلات (اتخصمت)', value: fmt(b.transport) + ' ج.م' }]
    .concat(b.other ? [{ label: 'خصومات تانية', value: fmt(b.other) + ' ج.م' }] : [], b.corrections ? [{ label: 'تصحيحات (اتضافت)', value: fmt(b.corrections) + ' ج.م' }] : [], b.carry ? [{ label: 'متبقي من آخر تسوية', value: fmt(b.carry) + ' ج.م' }] : [],
      [{ label: 'الصافي (بعد الخصومات)', value: fmt(b.balance) + ' ج.م' }]);
  const canSettle = (b) => !!(b.vendorId && b.hasStore && AC() && AC().can().approve && !(b.request && b.request.status === 'pending'));
  const briefRows = (b) => [['تقرير مختصر — ' + b.name], ['رصيد Dokan (ج.م)', b.dokanBalance == null ? '—' : b.dokanBalance], ['العرابين (ج.م)', b.deposits], ['المواصلات (ج.م)', b.transport], ['الصافي (ج.م)', b.balance],
    ['عدد الأوردرات', b.orders], ['قيمة الأوردرات (ج.م)', b.value], b.request ? ['طلب السحب', b.request.id + ' · ' + VD.wdLabel(b.request.status) + ' · ' + b.request.amount + ' ج.م'] : ['طلب السحب', 'لا يوجد'],
    [], ['رقم الأوردر', 'رقم الأوردر الفرعي', 'المنتج', 'القيمة (ج.م)', 'الحالة']].concat(b.rows.map((r) => [r.oid, r.sid, r.prod, r.tot, r.status]));
  // البوب أب الواحد للتقرير المختصر وطلب السحب (owner: «يفتح نفس بوب اب التقارير») — phase 4: read-only on the requests
  function openAccountBrief(name) {
    const b = vendorBriefData(name); const req = b.request; const fmt = (n) => D.formatMoney(n);
    const headers = ['رقم الأوردر', 'المنتج', 'القيمة (ج.م)', 'الحالة'];
    const rows = b.rows.map((x) => [h('span', { class: 'vr-oid' }, h('bdi', { dir: 'ltr' }, '#' + x.oid), x.sid !== x.oid ? h('small', null, ' · فرعي ', h('bdi', { dir: 'ltr' }, '#' + x.sid)) : null), x.prod, fmt(x.tot), x.status]);
    const actions = [{ label: 'التقرير الكامل', onClick: () => openVendorReport(name) }, { label: 'نسخ CSV', onClick: () => { const aoa = briefRows(b); csvCopy(aoa[9], aoa.slice(10), 'تقرير ' + name); } }];
    if (b.vendorId) actions.splice(1, 0, { label: 'كشف حساب Dokan', onClick: () => openStatement(name, b.vendorId) });
    // phase 4.1 (decision 1, owner 28 Oct): approve the pending request on Dokan itself; 0078: «تسوية دلوقتي» when there is none
    if (req && req.status === 'pending' && AC() && AC().can().approve) actions.unshift({ label: 'موافقة على طلب السحب (' + fmt(req.amount) + ' ج.م)', onClick: () => approveWithdraw(req, name) });
    else if (canSettle(b)) actions.unshift({ label: 'تسوية دلوقتي (تقفيل الحساب)', onClick: () => openSettle(name) });
    const plan = req && req.status === 'pending' ? D.settlePlan(req.amount, b.open) : null;
    const sub = [req ? 'طلب سحب ' + req.id + ' · ' + VD.wdLabel(req.status) + ' · ' + fmt(req.amount) + ' ج.م' : 'مفيش طلب سحب حالي',
      b.orders + ' أوردر (مكتمل ' + b.completed + ' · ملغي ' + b.cancelled + ')', 'اضغط على أي أوردر يفتحه'].join(' · ');
    U.DetailsModal({ title: 'تقرير مختصر — ' + name, sub,
      summary: openChips(b, fmt),
      headers, rows, total: rows.length ? ['الإجمالي', b.orders + ' أوردر', fmt(b.value), ''] : null,
      onRow: (i) => showOrders({ q: b.rows[i].oid }),
      note: [req ? (req.status === 'pending' ? 'الطلب مستني الموافقة — راجع الرصيد والأوردرات وبعدين وافق (الموافقة بتتكتب على Dokan نفسه). لما توافق: Dokan بيخصم ' + fmt(req.amount) + ' ج.م من رصيده'
            + (plan.consumed ? '، والخصومات المفتوحة بتتصفّى منه (' + fmt(plan.consumed) + ' ج.م)' : '') + '، واللي بيتحوّل للمبتكر ' + fmt(plan.cash) + ' ج.م' + (plan.carryOut > 0 ? ' وفاضل عليه ' + fmt(plan.carryOut) + ' ج.م' : '') + '.'
          : 'الطلب اتوافق عليه على Dokan واتخصم من رصيده هناك — فاضل التحويل للمبتكر.')
        : (b.payable > 0 ? 'المبتكر ليه رصيد صافي ' + fmt(b.payable) + ' ج.م ومفيش طلب سحب على Dokan' + (canSettle(b) ? ' — «تسوية دلوقتي» بتعمله بكل رصيد Dokan.' : '.') : 'مفيش رصيد مستحق للمبتكر.'),
        'العرابين والمواصلات وأي «سحب» متخصومين من الرصيد (إبتكر دفعتهم للمبتكر أو بدله) — ولو مفيش رصيد كفاية الصافي بيبقى بالسالب. Dokan مابيعرفهمش، فطلب السحب بيبقى بكل رصيد Dokan، ولما يتوافق عليه بيتصفّوا منه.'].join(' '),
      actions, empty: 'مفيش أوردرات مكتملة أو ملغية للمبتكر ده.',
      source: 'الأوردرات (السيستم) + رصيد Dokan وطلبات السحب (قراءة بس) + العرابين والمواصلات المتسجلة هنا' }, { label: 'تقرير مختصر ' + name });
  }
  // phase 4.1 (decision 1): approve a pending request on Dokan (woo-sync withdraw_approve) — no payout move here: Dokan lowers
  // the balance itself. The answer: ok | skipped (push_disabled / stale / not_pending) | an error.
  const WD_SKIP = { push_disabled: 'الكتابة على Dokan مقفولة دلوقتي — الطلب ما اتوافقش عليه.', stale: 'الطلب اتغيّر على Dokan قبل الموافقة — حدّثنا حالته عندنا.', not_pending: 'الطلب مش مستني الموافقة — حدّثنا حالته عندنا.' };
  function approveWithdraw(req, name) {
    const K = window.IBKit; const amount = D.formatMoney(req.amount); const fmt = (n) => D.formatMoney(n);
    // 0078: what the approval settles — the open deductions are covered by the request, the rest is transferred to the maker
    const seed = vendorsNow().find((x) => VD.norm(x.name) === VD.norm(name)) || {}; const p = D.settlePlan(req.amount, D.openOf(seed));
    const planText = p.open ? ' الخصومات المفتوحة (' + fmt(p.open) + ' ج.م) بتتصفّى منه، ' + (p.cash > 0 ? 'واللي بيتحوّل للمبتكر ' + fmt(p.cash) + ' ج.م' : 'ومفيش تحويل للمبتكر') + (p.carryOut > 0 ? ' وفاضل عليه ' + fmt(p.carryOut) + ' ج.م' : '') + '.' : ' مفيش خصومات مفتوحة — الطلب كله بيتحوّل للمبتكر.';
    K.confirm({ title: 'موافقة على طلب السحب ' + req.id + ' — ' + name,
      text: 'هتتوافق على الطلب على Dokan نفسه بمبلغ ' + amount + ' ج.م. Dokan بيخصمه من رصيد المبتكر على طول.' + planText + ' التحويل نفسه بيفضل عليك زي ما هو.',
      okLabel: 'وافق على Dokan',
      onOk: () => {
        const note = busyNote(K.busy ? K.busy('بنوافق على طلب السحب ' + req.id + ' على Dokan…') : null);
        AC().approveWithdraw(req.wid).then((r) => {
          const st = r.settlement;
          if (r.ok && r.result === 'ok' && st) note({ kind: 'success', text: 'اتوافق على طلب السحب ' + req.id + ' لـ ' + name + ' بمبلغ ' + amount + ' ج.م على Dokan' + (st.moves ? '، واتصفّى منه ' + fmt(st.consumed) + ' ج.م خصومات (' + st.moves + ' حركة)' : '')
            + ' — حوّل للمبتكر ' + fmt(st.cash) + ' ج.م' + (st.carry_out > 0 ? '، وفاضل عليه ' + fmt(st.carry_out) + ' ج.م لحد التسوية الجاية' : '') + '.' });
          else if (r.ok && r.result === 'ok') note({ kind: 'success', text: 'اتوافق على طلب السحب ' + req.id + ' لـ ' + name + ' بمبلغ ' + amount + ' ج.م على Dokan، واتخصم من رصيده هناك.' });
          else if (r.ok) note({ kind: 'warning', text: WD_SKIP[r.reason] || 'الطلب ما اتوافقش عليه.' });
          else note({ kind: 'error', text: r.reason === 'forbidden' ? 'مش مسموحلك توافق على طلبات السحب.' : 'مقدرناش نوافق على الطلب على Dokan دلوقتي — جرّب تاني.' });
          render();
        });
      } });
  }
  // the owner (11 Nov — «ال loading مش باين … خلي يبقي زي popup notification»): a Dokan call runs under the kit's busy pill (bottom
  // centre), which then shows the result for a moment; the result stays on the page as its note too
  const busyNote = (pill) => (n) => { setNote(n); if (pill) pill.done(n.text, n.kind); };
  // 0078 (the owner, 11 Nov — «تسوية دلوقتي / تقفيل حساب»): the maker's account up to today — the open deductions, the net, the orders —
  // and the request the system files on Dokan for his whole Dokan balance (= the net + the deductions Dokan does not count), pending
  // until it is approved like any other («يعمله ويستنى موافقتك»). Never with a pending request; the amount is Dokan's own, read then.
  const WC_SKIP = { pending_exists: 'فيه طلب سحب مستني الموافقة للمبتكر ده على Dokan بالفعل — راجعه ووافق عليه.', push_disabled: 'الكتابة على Dokan مقفولة دلوقتي — الطلب ما اتعملش.', no_balance: 'رصيد المبتكر على Dokan صفر — مفيش طلب يتعمل.', no_store: 'المبتكر ده مالوش متجر على Dokan.' };
  function openSettle(name) {
    const b = vendorBriefData(name); const fmt = (n) => D.formatMoney(n); const dokan = b.dokanBalance;
    const p = D.settlePlan(dokan == null ? 0 : dokan, b.open);
    const moves = store.vendorMoves.filter((m) => m.vendor === name && m.settledBy == null).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.id || 0) - (y.id || 0)));
    const rows = moves.map((m) => [num(D.formatDateNumeric(m.date)), m.direction === 'deposit' ? 'إيداع (تصحيح)' : 'سحب', m.typeName || m.type, (m.direction === 'deposit' ? '+' : '−') + fmt(m.amount)])
      .concat(b.carry ? [['—', 'متبقي', 'من آخر تسوية', '−' + fmt(b.carry)]] : []);
    const can = dokan != null && dokan > 0 && canSettle(b);
    const actions = [{ label: 'تقرير الأوردرات', onClick: () => openAccountBrief(name) }];
    if (can) actions.unshift({ label: 'اعمل طلب السحب على Dokan (' + fmt(dokan) + ' ج.م)', onClick: () => createWithdraw(name, b.vendorId, dokan) });
    const note = dokan == null ? 'رصيد Dokan للمبتكر ده لسه ماتقريش — جرّب «تحديث من Dokan» أو استنى المزامنة الجاية.'
      : dokan <= 0 ? 'مفيش رصيد على Dokan يتطلب دلوقتي — الخصومات المفتوحة بتفضل عليه لحد ما يبقى له رصيد.'
      : 'هيتعمل طلب سحب على Dokan بكل رصيده (' + fmt(dokan) + ' ج.م' + (p.open ? ' = الصافي ' + fmt(b.balance) + ' + الخصومات ' + fmt(p.open) : '') + ') ويفضل مستني موافقتك — مفيش فلوس بتتحرك قبلها. لما توافق: Dokan بيخصمه من رصيده'
        + (p.consumed ? '، والحركات دي بتتصفّى منه' : '') + '، واللي بيتحوّل للمبتكر ' + fmt(p.cash) + ' ج.م' + (p.carryOut > 0 ? ' — والخصومات أكبر من رصيده فبيفضل عليه ' + fmt(p.carryOut) + ' ج.م لحد التسوية الجاية' : '') + '.';
    U.DetailsModal({ title: 'تقفيل حساب — ' + name, sub: 'الحساب لحد النهارده · ' + b.orders + ' أوردر (مكتمل ' + b.completed + ' · ملغي ' + b.cancelled + ') بقيمة ' + fmt(b.value) + ' ج.م · ' + moves.length + ' حركة لسه ماتصفّتش',
      summary: openChips(b, fmt).concat(dokan != null && dokan > 0 ? [{ label: 'طلب السحب على Dokan', value: fmt(dokan) + ' ج.م' }, { label: 'هيتحوّل للمبتكر', value: fmt(p.cash) + ' ج.م' }] : []),
      headers: ['التاريخ', 'الحركة', 'البيان', 'المبلغ (ج.م)'], rows, total: rows.length ? ['الإجمالي', '', 'بيتصفّى من الطلب', (p.open >= 0 ? '−' : '+') + fmt(Math.abs(p.open))] : null,
      note, actions, empty: 'مفيش خصومات مفتوحة — الطلب كله بيتحوّل للمبتكر.',
      source: 'رصيد Dokan (قراءة) + الحركات المتسجلة هنا اللي لسه ماتصفّتش + الأوردرات (السيستم)' }, { label: 'تقفيل حساب ' + name });
  }
  function createWithdraw(name, vendorId, dokan) {
    const K = window.IBKit;
    K.confirm({ title: 'طلب سحب على Dokan — ' + name,
      text: 'هيتعمل طلب سحب على Dokan بكل رصيد المبتكر دلوقتي (حوالي ' + D.formatMoney(dokan) + ' ج.م — Dokan بيقرا الرصيد وقت الطلب) بالتحويل البنكي، ويفضل مستني موافقتك.',
      okLabel: 'اعمل الطلب على Dokan',
      onOk: () => {
        const note = busyNote(K.busy ? K.busy('بنعمل طلب السحب على Dokan لـ ' + name + '…') : null);
        AC().createWithdraw(vendorId).then((r) => {
          if (r.ok && r.result === 'ok') note({ kind: 'success', text: 'اتعمل طلب سحب #' + r.id + ' لـ ' + name + ' بمبلغ ' + D.formatMoney(r.amount) + ' ج.م على Dokan — مستني موافقتك.' });
          else if (r.ok && r.result === 'skipped') note({ kind: 'warning', text: WC_SKIP[r.reason] || 'الطلب ما اتعملش.' });
          else if (r.ok) note({ kind: 'error', text: r.reason === 'no_store' ? WC_SKIP.no_store : 'Dokan رفض الطلب (' + r.reason + ') — راجع حدود السحب على Dokan.' });
          else note({ kind: 'error', text: r.reason === 'forbidden' ? 'مش من صلاحياتك تعمل طلب سحب.' : r.reason === 'woo_down' ? 'Dokan مش بيرد دلوقتي — جرّب كمان شوية.' : 'مقدرناش نعمل الطلب على Dokan دلوقتي — جرّب تاني.' });
          render();
        });
      } });
  }
  // plan 4.1 decision 12 (owner, 28 Oct): «تحديث من Dokan» — the withdraw requests now instead of at the hourly run (read-only)
  function refreshDokanBtn() {
    if (!AC() || !AC().refreshWithdrawals) return null;
    const busy = AC().refreshing();
    return Button({ label: busy ? 'بنحدّث من Dokan…' : 'تحديث من Dokan', icon: 'refresh', disabled: busy, attrs: { 'data-dokan-refresh': '', 'aria-busy': busy ? 'true' : 'false', title: 'هات طلبات السحب الجديدة من Dokan دلوقتي' },
      onClick: () => {
        AC().refreshWithdrawals().then((r) => {
          if (r.reason === 'busy') return;
          if (r.ok) setNote({ kind: 'success', text: 'اتحدّثت طلبات السحب من Dokan — ' + (r.pending ? r.pending + ' طلب مستني الموافقة.' : 'مفيش طلبات مستنية الموافقة.') });
          else setNote({ kind: 'error', text: r.reason === 'woo_down' ? 'Dokan مش بيرد دلوقتي — جرّب كمان شوية.' : r.reason === 'forbidden' ? 'مش من صلاحياتك.' : 'مقدرناش نحدّث من Dokan — جرّب تاني.' });
          render();
        });
      } });
  }
  // كشف حساب المبتكر من Dokan للفترة المحددة (phase 4, decision 6): بيتجاب وقت الفتح ومابيتخزنش
  const STATEMENT_TYPES = { opening_balance: 'رصيد افتتاحي', dokan_orders: 'أوردر', dokan_withdraw: 'سحب', dokan_refund: 'مرتجع' };
  function openStatement(name, vendorId) {
    const from = state.range.from, to = state.range.to; const fmt = (n) => D.formatMoney(n);
    const K = window.IBKit; const pill = K && K.busy ? K.busy('بنجيب كشف حساب ' + name + ' من Dokan…') : null;
    AC().statement(vendorId, from, to).then((r) => {
      if (!r.ok) { busyNote(pill)({ kind: 'error', text: 'مقدرناش نجيب كشف الحساب من Dokan دلوقتي — جرّب تاني.' }); render(); return; }
      if (pill) pill.close();
      const rows = r.rows.map((x) => [num(x.date ? D.formatDateNumeric(String(x.date).slice(0, 10)) : '—'), STATEMENT_TYPES[x.type] || x.type || '—', x.title || '—', num(fmt(x.debit)), num(fmt(x.credit)), x.balance == null ? '—' : num(fmt(x.balance))]);
      const debit = r.rows.reduce((t, x) => t + (Number(x.debit) || 0), 0), credit = r.rows.reduce((t, x) => t + (Number(x.credit) || 0), 0);
      const last = r.rows.length ? r.rows[r.rows.length - 1].balance : null;
      U.DetailsModal({ title: 'كشف حساب Dokan — ' + name, sub: D.rangeLabel(from, to) + ' · ' + r.rows.length + ' حركة' + (r.done === false ? ' (أول 1000 بس)' : ''),
        summary: [{ label: 'مدين', value: fmt(debit) + ' ج.م' }, { label: 'دائن', value: fmt(credit) + ' ج.م' }, { label: 'الرصيد آخر الفترة', value: last == null ? '—' : fmt(last) + ' ج.م' }],
        headers: ['التاريخ', 'النوع', 'البيان', 'مدين', 'دائن', 'الرصيد'], rows, empty: r.noStore ? 'المبتكر ده مالوش متجر على Dokan.' : 'مفيش حركات على Dokan في الفترة دي.',
        source: 'Dokan ← كشف حساب المبتكر (قراءة بس، مابيتخزنش)' }, { label: 'كشف حساب ' + name });
    });
  }
  // أعمدة جدول حسابات المبتكرين — الإظهار/الإخفاء والترتيب بقوا من زرار «أعمدة الجدول» العام (kit: withColumns، phase 4.1)
  // 0078 (the owner, 11 Nov): «الرصيد دلوقتي» = the balance now, no period — each row chains to the net: رصيد Dokan − العرابين −
  // المواصلات − خصومات تانية + تصحيحات − متبقي من تسوية = الصافي (the three middle ones only when a maker has one); the request
  // column says what is open on Dokan («مستني الموافقة» + its amount); the orders by period live in «كشف بالفترة».
  const VCOLS = [['name', 'المبتكر'], ['pct', 'نسبة إبتكر'], ['dokan', 'رصيد Dokan'], ['dep', 'العرابين'], ['tr', 'المواصلات'], ['oth', 'خصومات تانية'], ['cor', 'تصحيحات'], ['carry', 'متبقي من تسوية'],
    ['bal', 'الصافي'], ['wd', 'طلب السحب'], ['last', 'آخر طلب سحب'], ['act', 'إجراءات']];
  // phase 5.5 decision 4 (owner 31 Oct 16:38): the maker's latest Dokan request (any status but rejected / cancelled) — the date and how many days ago
  const lastWd = (name) => { const id = makerId(name); if (!id || !AC()) return null;
    const c = AC().withdrawals().filter((w) => w.vendorId === id && w.status !== 'rejected' && w.status !== 'cancelled' && w.at).map((w) => ({ date: String(w.at).slice(0, 10), id: w.id, status: w.status, amount: w.amount })).sort((p, q) => (p.date < q.date ? 1 : p.date > q.date ? -1 : Number(q.id) - Number(p.id)));
    const x = c[0]; if (!x) return null; x.days = Math.max(0, Math.round((Date.parse(TODAY + 'T00:00:00Z') - Date.parse(x.date + 'T00:00:00Z')) / 864e5)); return x; };
  const lastCell = (v) => { const x = lastWd(v.name); if (!x) return h('span', { class: 'help', 'data-last': '' }, '—');
    return h('span', { class: 'last-wd', 'data-last': x.date, title: 'طلب #' + x.id + ' · ' + VD.wdLabel(x.status) + ' · ' + D.formatMoney(x.amount) + ' ج.م' }, num(D.formatDateNumeric(x.date)), h('span', { class: 't-small help' }, x.days === 0 ? 'اليوم الحالي' : num('من ' + x.days + ' يوم'))); };
  function VendorsView() {
    const list = vendorsNow(); const s = D.vendorSummary(list); const sort = SORTS.find((x) => x.value === state.sort);
    const sorted = D.sortVendors(list, sort.key, sort.dir).filter(wdFilterOk);
    const wdFiltered = (state.wdFilter || 'all') !== 'all';
    const fmt = (n) => D.formatMoney(n); const money = (n) => num(fmt(n));
    const bal = (n) => h('span', { class: n > 0 ? 'pos' : n < 0 ? 'neg' : '' }, num(D.formatMoney(n)));
    const vOpenName = (l) => (i) => { const v = vstore.findByName(l[i].name); if (v) openVendor(v.id, { inPlace: true }); };
    const accVDet = (k) => { const l = k === 'pos' ? sorted.filter((v) => v.balance > 0) : k === 'neg' ? sorted.filter((v) => v.balance < 0) : k === 'dep' ? sorted.filter((v) => v.deposits > 0) : sorted;
      const t = { all: 'المبتكرين — ' + s.count, pos: 'رصيد المبتكرين — ' + fmt(s.positive) + ' ج.م', neg: 'رصيد عند المبتكرين — ' + fmt(s.negative) + ' ج.م', dep: 'العرابين اللي لسه ماتصفّتش — ' + fmt(s.deposits) + ' ج.م' }[k];
      const sumK = (f) => fmt(D.round2(l.reduce((x, v) => x + (v[f] || 0), 0)));
      return { title: t, sub: 'الرصيد دلوقتي · اضغط على أي مبتكر يفتح ملفه', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'الصافي', value: sumK('balance') + ' ج.م' }, { label: 'العرابين', value: sumK('deposits') + ' ج.م' }],
        headers: ['المبتكر', 'رصيد Dokan', 'العرابين', 'المواصلات', 'الصافي'], rows: l.map((v) => [v.name, v.dokanBalance == null ? '—' : fmt(v.dokanBalance), fmt(v.deposits), fmt(v.transport || 0), fmt(v.balance)]),
        total: ['الإجمالي', sumK('dokanBalance'), sumK('deposits'), sumK('transport'), sumK('balance')], onRow: vOpenName(l), source: 'حسابات المبتكرين ← الرصيد دلوقتي' }; };
    const tA = trAll(true);
    return [liveNote(),
      h('div', { class: 'cards five' },
        U.CategoryCard({ tone: 'brand', name: 'عدد المبتكرين', value: s.count, unit: 'مبتكر', decimals: false, details: () => accVDet('all') }),
        U.CategoryCard({ tone: 'gold', name: 'رصيد المبتكرين', value: s.positive, sub: s.positiveCount + ' مبتكرين', details: () => accVDet('pos') }),
        U.CategoryCard({ tone: 'neutral', name: 'رصيد عند المبتكرين', value: s.negative, sub: s.negativeCount + ' مبتكرين', details: () => accVDet('neg') }),
        U.CategoryCard({ tone: 'goldlight', name: 'إجمالي العرابين', value: s.deposits, sub: h('span', null, 'صافي ', num(D.formatMoney(s.net))), details: () => accVDet('dep') }),
        U.CategoryCard({ tone: 'neutral', name: 'مواصلات المبتكرين', value: tA.vendors, sub: tA.vendorTrips + ' مشوار · ' + tA.vendorCount + ' مبتكرين · لسه ماتصفّتش', details: () => transportDetails('', true) })),
      (() => {
        // the request on Dokan now: «مستني الموافقة» + its amount, «اتوافق عليه» (the latest, with what was transferred when known)
        const setOf = (wid) => (AC() && AC().settlements ? AC().settlements().find((x) => x.withdrawId === wid) : null);
        const wdTag = (v) => { const r = wdOf(v.name); const st = r ? r.status : 'none'; const x = r && st === 'approved' ? setOf(r.wid) : null;
          return h('button', { type: 'button', class: 'tg tg-' + (st === 'pending' ? 'orange' : st === 'approved' ? 'success' : 'neutral') + ' wd-cell', 'data-wd': v.name, 'data-wd-status': st,
            'aria-label': 'طلب سحب ' + v.name + ': ' + (r ? VD.wdLabel(st) : 'لا يوجد'), title: r ? 'طلب ' + r.id + ' · ' + fmt(r.amount) + ' ج.م' + (x ? ' · اتحوّل للمبتكر ' + fmt(x.cash) + ' ج.م' : '') : '',
            onClick: (e) => { e.stopPropagation(); openAccountBrief(v.name); } }, r ? VD.wdLabel(st) : 'لا يوجد', r ? h('span', { class: 'wd-amt' }, ' · ', money(st === 'approved' && x ? x.cash : r.amount)) : null); };
        const rowMenu = (v) => { const r = wdOf(v.name); const KK = window.IBKit; const b = { vendorId: makerId(v.name), hasStore: !!((vstore.findByName(v.name) || {}).wooVendorId), request: r };
          const openFile = () => { const vv = vstore.findByName(v.name); if (vv) openVendor(vv.id, { inPlace: true }); else { setNote({ kind: 'warning', text: 'المبتكر ده مش مسجّل في صفحة المبتكرين.' }); render(); } };
          return KK.RowMenu([{ label: 'تقرير المبتكر', icon: 'chart', run: () => openAccountBrief(v.name) },
            r ? { label: 'طلب السحب (' + VD.wdLabel(r.status) + ')', icon: 'download', run: () => openAccountBrief(v.name) } : null,
            canSettle(b) ? { label: 'تسوية دلوقتي (تقفيل الحساب)', icon: 'wallet', run: () => openSettle(v.name) } : null,
            makerId(v.name) ? { label: 'كشف حساب Dokan', icon: 'file', run: () => openStatement(v.name, makerId(v.name)) } : null,
            { label: 'افتح ملف المبتكر', icon: 'users', run: openFile }].filter(Boolean), 'إجراءات ' + v.name);
        };
        // زرار «تقرير» اتشال من الخانة (owner 27 Oct) — الاسم نفسه بيفتح التقرير، وكمان من ⋯ › «تقرير المبتكر»
        const CELL = { name: (v) => h('span', { class: 'vname-cell' }, h('span', { class: 'vname-link', role: 'button', tabindex: '0', dir: 'auto', 'aria-label': 'تقرير ' + v.name, 'data-vreport': v.name,
          onClick: (e) => { e.stopPropagation(); openAccountBrief(v.name); },
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccountBrief(v.name); } } }, v.name)),
          pct: (v) => num(v.pct), dokan: (v) => (v.dokanBalance == null ? '—' : money(v.dokanBalance)), dep: (v) => money(v.deposits), tr: (v) => money(v.transport || 0),
          oth: (v) => money(v.other || 0), cor: (v) => money(v.corrections || 0), carry: (v) => money(v.carry || 0),
          wd: wdTag, last: lastCell, bal: (v) => h('b', { 'data-vbal': v.name }, bal(v.balance)), act: rowMenu };
        // filtered (decision 13): the total row is the shown makers' own sum
        const sT = wdFiltered ? D.vendorSummary(sorted) : s;
        const TOT = { name: 'الإجمالي', pct: '—', dokan: money(D.round2(sorted.reduce((t, v) => t + (v.dokanBalance || 0), 0))), dep: money(sT.deposits), tr: money(sT.transport), oth: money(sT.other), cor: money(sT.corrections), carry: money(sT.carry),
          wd: h('span', null, num(String(sorted.filter((v) => { const r = wdOf(v.name); return r && r.status === 'pending'; }).length)), ' مستني'), last: '', bal: bal(sT.net), act: '' };
        const some = (k) => list.some((v) => v[k]);
        const cols = VCOLS.filter(([k]) => (k === 'oth' ? some('other') : k === 'cor' ? some('corrections') : k === 'carry' ? some('carry') : true));
        const pend = sorted.filter((v) => { const r = wdOf(v.name); return r && r.status === 'pending'; }).length;
        return TableCard({ title: 'حسابات المبتكرين — الرصيد دلوقتي', count: sorted.length + ' مبتكر · ' + pend + ' طلب مستني الموافقة' + (wdFiltered ? ' · ' + (WD_FILTERS.find((x) => x.value === state.wdFilter) || {}).label : ''), action: refreshDokanBtn(),
          body: !sorted.length ? U.EmptyState(wdFiltered ? 'مفيش مبتكرين عندهم طلبات سحب' : 'مفيش مبتكرين', wdFiltered ? 'اضغط «تحديث من Dokan» تجيب الطلبات الجديدة، أو رجّع الفلتر لـ «الكل».' : '') : U.Table({ cls: 'vendors-table', headers: cols.map(([, lb]) => lb), rows: sorted.map((v) => cols.map(([k]) => CELL[k](v))), totalRow: cols.map(([k]) => TOT[k]) }) });
      })(),
      sourceNote('المصدر: رصيد Dokan وطلبات السحب (قراءة بس، بيتحدّث كل ساعة) + الحركات المتسجلة هنا اللي لسه ماتصفّتش · الصافي = رصيد Dokan − العرابين − المواصلات − الخصومات التانية + التصحيحات − المتبقي من آخر تسوية، وبيبقى بالسالب لو الخصومات أكبر · Dokan مابيعرفش الخصومات دي، فطلب السحب بيبقى بكل رصيد Dokan، ولما يتوافق عليه بتتصفّى منه واللي بيتحوّل للمبتكر = الطلب − الخصومات · الأوردرات بالفترة في «كشف بالفترة»'),
    ].filter(Boolean);
  }

  // ================= phase 5.5 decision 13 (owner 5 Nov): كشف المبتكرين بالفترة =================
  // The prototype's «حسابات المبتكرين بالفترة» (31 Oct) beside the balance now — an addition. The opening is the owner's answer:
  // Dokan's own balance on the first day (each maker's statement — woo-sync `statement`, read-only, never stored) less our moves
  // before it, as «الصافي» counts them; the period from the same statement (what Dokan credited for orders, its refunds and its
  // withdrawals) and our deposits / transport dated in it (D.makerLedger). The orders' sales and Ibtekr's share: our lines of the
  // orders Dokan credited (the statement row's ref → the sub-order in our mirror). No withdraw request is made from here.
  const LEDGER_MAX_DAYS = 400; // woo-sync's statement range
  const VSUBS = [{ id: 'now', label: 'الرصيد دلوقتي' }, { id: 'ledger', label: 'كشف بالفترة' }];
  let ledgerTimer = 0;
  document.addEventListener('ib:accounts-ledger', () => {
    const shown = (state.page === 'accounts' && state.tab === 'vendors') || (state.page === 'vendors' && state.vtab === 'accounts'); // decision 57: the makers page too
    if (!shown || state.vsub !== 'ledger' || ledgerTimer) return;
    ledgerTimer = setTimeout(() => { ledgerTimer = 0; rerender(); }, 150);
  });
  // 0078 (the owner, 11 Nov — «كشف بالفترة حسب الفلتر، ومن غير فلتر كل المبتكرين بشكل عام»): the ledger's own range; null = «كل الفترات»
  const ledgerRange = () => (state.vlrange ? { from: state.vlrange.from, to: state.vlrange.to > TODAY ? TODAY : state.vlrange.to } : null);
  function salesByRef() { // a Dokan order id (our sub-order's sid) → { maker name: our lines' total }
    const OA = window.OrdersApp; const m = new Map(); if (!OA || !OA.query) return m;
    for (const r of OA.query({}, 100000).rows) {
      const o = OA.get(r.id); if (!o) continue;
      for (const s of o.subs || []) { const k = String(s.sid); const e = m.get(k) || {}; e[s.vendor] = D.round2((e[s.vendor] || 0) + (Number(s.tot) || 0)); m.set(k, e); }
    }
    return m;
  }
  function ledgerRows(range, L) {
    const by = range ? salesByRef() : null; const A = AC();
    const sets = A && A.settlements ? A.settlements() : []; const wds = A ? A.withdrawals() : []; const bals = A ? A.balances() : [];
    return vendorsNow().map((v) => {
      const vv = v.id && vstore.get ? vstore.get(v.id) : null; const names = vv && vstore.namesOf ? vstore.namesOf(vv.id) : [v.name];
      const hasStore = !!(vv && vv.wooVendorId);
      const moves = store.vendorMoves.filter((m) => m.vendor === v.name); const settlements = sets.filter((x) => x.vendorId === v.id);
      if (!range) { // «كل الفترات»: Dokan's own totals for the store + every approved request + all our moves (no statement)
        const d = bals.find((b) => b.vendorId === v.id) || null;
        const l = D.lifetimeLedger({ dokan: d, withdrawals: wds.filter((w) => w.vendorId === v.id), moves, settlements });
        return Object.assign(l, { id: v.id, name: v.name, pct: v.pct, hasStore, dokan: !hasStore ? 'none' : d ? 'ok' : 'nobal', cut: false });
      }
      const st = hasStore && L ? L.by.get(v.id) : null;
      const salesOf = (ref) => { const e = by.get(String(ref)); if (!e) return null; let t = null; for (const n of names) if (e[n] != null) t = (t || 0) + e[n]; return t; };
      const l = D.makerLedger({ statement: st && st.status === 'ok' ? { rows: st.rows } : null, moves, settlements, from: range.from, to: range.to, salesOf });
      return Object.assign(l, { id: v.id, name: v.name, pct: v.pct, hasStore, dokan: !hasStore ? 'none' : st ? st.status : 'pending', cut: !!(st && st.status === 'ok' && st.done === false) });
    });
  }
  function VendorsTab() {
    const sub = state.vsub === 'ledger' ? 'ledger' : 'now';
    const tabs = window.IBKit.SubTabs({ items: VSUBS, active: sub, label: 'حسابات المبتكرين', onChange: (id) => { state.vsub = id; render(); } });
    return [tabs].concat(sub === 'ledger' ? LedgerView() : VendorsView());
  }
  function LedgerView() {
    const range = ledgerRange(); const all0 = !range; // 0078: no range = «كل الفترات»
    const A = AC(); if (!A || !A.loadLedger) return [U.InlineNote({ kind: 'error', children: 'الحسابات مش متحمّلة — جرّب تحدّث الصفحة.' })];
    let L = null, withStore = [];
    if (range) {
      const days = (Date.parse(range.to + 'T00:00:00Z') - Date.parse(range.from + 'T00:00:00Z')) / 864e5;
      if (!(days >= 0)) return [U.InlineNote({ kind: 'warning', children: 'الفترة بتبدأ بعد النهارده — اختار فترة فيها أيام فاتت.' })];
      if (days > LEDGER_MAX_DAYS) return [U.InlineNote({ kind: 'warning', children: 'الكشف بالفترة لحد 400 يوم (كشف حساب Dokan) — اختار فترة أقصر، أو «كل الفترات».' })];
      // every maker with a store has its statement asked once for the range (a new maker later too)
      withStore = vendorsNow().map((v) => (v.id && vstore.get ? vstore.get(v.id) : null)).filter((vv) => vv && vv.wooVendorId).map((vv) => vv.id);
      L = A.ledgerOf(range.from, range.to);
      const missing = withStore.filter((id) => !L || !L.by.has(id)); if (missing.length) L = A.loadLedger(range.from, range.to, missing);
    }
    const all = ledgerRows(range, L); const ready = (l) => l.dokan === 'ok' || l.dokan === 'none';
    const fmt = (n) => D.formatMoney(n); const money = (n) => num(fmt(n)); const bal = (n) => h('span', { class: n > 0 ? 'pos' : n < 0 ? 'neg' : '' }, money(n));
    const per = all0 ? 'كل الفترات' : D.formatDateNumeric(range.from) + ' – ' + D.formatDateNumeric(range.to);
    const sort = SORTS.find((x) => x.value === state.sort) || SORTS[0]; const key = sort.key === 'deposits' ? 'deposits' : 'closing';
    const sorted = all.slice().sort((a, b) => (ready(b) - ready(a)) || (sort.dir === 'asc' ? 1 : -1) * ((a[key] || 0) - (b[key] || 0)) || a.name.localeCompare(b.name));
    const moved = (l) => !ready(l) || l.opening || l.closing || l.completed.lines || l.deposits || l.transport || l.otherMoves || l.corrections || l.payouts || l.requested || l.refunds || l.other;
    const rows0 = state.vledgerAll ? sorted : sorted.filter(moved); const done = rows0.filter(ready); const T = D.ledgerTotals(done);
    const failed = all.filter((l) => l.dokan === 'error'); const pending = all.filter((l) => l.dokan === 'pending');
    const unmatched = done.some((l) => l.completed.matched < l.completed.lines); const showOther = done.some((l) => l.refunds || l.other);
    const showOM = done.some((l) => l.otherMoves); const showCor = done.some((l) => l.corrections);
    const ST = { owed: ['success', D.LEDGER_STATUS.owed], onThem: ['orange', D.LEDGER_STATUS.onThem], settled: ['neutral', D.LEDGER_STATUS.settled] };
    const wait = (l) => (l.dokan === 'pending' ? h('span', { class: 'help', 'data-ledger-wait': '' }, '…') : l.dokan === 'error' || l.dokan === 'nobal' ? h('span', { class: 'help' }, '—') : null);
    const cellOf = (f) => (l) => wait(l) || f(l);
    const rowMenu = (l) => window.IBKit.RowMenu([{ label: 'تقرير المبتكر', icon: 'chart', run: () => openAccountBrief(l.name) },
      l.hasStore ? { label: 'كشف حساب Dokan', icon: 'file', run: () => openStatement(l.name, l.id) } : null,
      { label: 'افتح ملف المبتكر', icon: 'users', run: () => { const vv = vstore.get && vstore.get(l.id); if (vv) openVendor(vv.id, { inPlace: true }); } }].filter(Boolean), 'إجراءات ' + l.name);
    const fileTag = all0 ? 'all' : range.from + '_' + range.to;
    const B = window.IBKit.Bulk({ key: 'vledger', ids: rows0.map((l) => l.id), noun: 'مبتكر', render,
      actions: [{ id: 'xlsx', label: 'كشف حساب إكسل', icon: 'download', run: (ids, fin) => {
        const l = rows0.filter((x) => ids.includes(x.id) && ready(x));
        if (!l.length) { window.IBKit.toast('مفيش حد من المحددين كشفه جاهز من Dokan', 'error'); return; }
        window.IBKit.xlsxExport('ibtekr-makers-' + fileTag + '.xlsx', 'حسابات المبتكرين ' + per,
          [['المبتكر', 'نسبة إبتكر', 'رصيد Dokan أول الفترة', 'رصيد أول الفترة', 'أوردرات مكتملة', 'مبيعات المكتمل', 'حصة إبتكر', 'حقه من المكتمل', 'العرابين', 'المواصلات', 'خصومات تانية', 'تصحيحات', 'طلبات السحب اللي اتوافق عليها', 'منها غطّت خصومات', 'اتحوّله', 'مرتجعات وحركات تانية', 'المستحق آخر الفترة', 'الحالة']]
            .concat(l.map((x) => [x.name, x.pct, x.dokanOpening, x.opening, x.completed.orders, x.completed.sales, x.completed.share, x.completed.earned, x.deposits, x.transport, x.otherMoves || 0, x.corrections || 0, x.requested || 0, x.consumed || 0, x.payouts, D.round2(x.other - x.refunds), x.closing, D.LEDGER_STATUS[x.status]])));
        fin('اتنزل كشف ' + l.length + ' مبتكر'); } }] });
    // 0078: «طلب سحب» left this table (the owner); «اتحوّله» = the approved requests less the deductions they covered
    const COLS = [['sel', B.head()], ['name', 'المبتكر'], ['pct', 'نسبة إبتكر'], ['last', 'آخر طلب سحب'], all0 ? null : ['open', 'رصيد أول الفترة'], ['cN', all0 ? 'أوردرات مكتملة' : 'مكتمل في الفترة — أوردرات'], ['sales', 'مبيعات المكتمل'], ['cV', 'حصة إبتكر'], ['earned', 'حقه من المكتمل'],
      ['dep', 'العرابين'], ['tr', 'المواصلات'], showOM ? ['om', 'خصومات تانية'] : null, showCor ? ['cor', 'تصحيحات'] : null, ['paid', 'اتحوّله'], showOther ? ['oth', 'مرتجعات وحركات تانية'] : null,
      ['bal', all0 ? 'المستحق دلوقتي' : 'المستحق آخر الفترة'], ['due', 'الحالة'], ['act', 'إجراءات']].filter(Boolean);
    const part = (l) => (l.completed.matched < l.completed.lines ? '*' : '');
    const paidTitle = (l) => (l.consumed ? 'طلبات اتوافق عليها ' + fmt(l.requested) + ' ج.م — منها ' + fmt(l.consumed) + ' غطّت عرابين ومواصلات وخصومات' : '');
    const CELL = { sel: (l) => B.box(l.id, l.name),
      name: (l) => h('span', { class: 'vname-cell' }, h('span', { class: 'vname-link', role: 'button', tabindex: '0', dir: 'auto', 'aria-label': 'تقرير ' + l.name, 'data-ledger-row': l.name, onClick: (e) => { e.stopPropagation(); openAccountBrief(l.name); }, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccountBrief(l.name); } } }, l.name),
        l.hasStore ? null : h('small', { class: 't-small help' }, ' · مالوش متجر'), l.cut ? h('small', { class: 't-small help' }, ' · أول 1000 حركة بس') : null,
        l.dokan === 'error' ? h('span', { class: 'tg tg-error', 'data-ledger-err': '' }, 'Dokan ماردش') : l.dokan === 'nobal' ? h('span', { class: 'tg tg-neutral', 'data-ledger-nobal': '' }, 'رصيد Dokan لسه ماتقريش') : null),
      pct: (l) => num(l.pct), last: lastCell, open: cellOf((l) => h('span', { title: 'رصيد Dokan يوم ' + D.formatDateNumeric(range.from) + ': ' + fmt(l.dokanOpening) + ' ج.م' }, bal(l.opening))),
      cN: cellOf((l) => num(String(l.completed.orders))), sales: cellOf((l) => h('span', null, money(l.completed.sales), part(l))), cV: cellOf((l) => h('span', null, money(l.completed.share), part(l))), earned: cellOf((l) => money(l.completed.earned)),
      dep: (l) => money(l.deposits), tr: (l) => money(l.transport), om: (l) => money(l.otherMoves || 0), cor: (l) => money(l.corrections || 0),
      paid: cellOf((l) => h('span', { title: paidTitle(l), 'data-ledger-paid': l.name }, money(l.payouts))), oth: cellOf((l) => bal(D.round2(l.other - l.refunds))),
      bal: cellOf((l) => h('b', { 'data-ledger-close': l.name }, bal(l.closing))), due: cellOf((l) => h('span', { class: 'tg tg-' + ST[l.status][0], 'data-due': l.status }, ST[l.status][1])), act: rowMenu };
    const TOT = { sel: '', name: 'الإجمالي', pct: '—', last: '', open: bal(T.opening), cN: num(String(T.orders)), sales: money(T.sales), cV: money(T.share), earned: money(T.earned), dep: money(T.deposits), tr: money(T.transport), om: money(T.otherMoves), cor: money(T.corrections), paid: money(T.payouts),
      oth: bal(D.round2(T.other - T.refunds)), bal: h('b', { 'data-ledger-total': '' }, bal(T.closing)), due: h('span', null, num(String(T.owedCount)), ' مستحق'), act: '' };
    const detL = (k) => { const l = k === 'owed' ? done.filter((x) => x.status === 'owed') : k === 'on' ? done.filter((x) => x.status === 'onThem') : k === 'earned' ? done.filter((x) => x.completed.lines) : k === 'dep' ? done.filter((x) => x.deposits || x.transport) : done;
      const ttl = { all: 'المبتكرين — ' + per + ' — ' + l.length, owed: 'مستحق للمبتكرين ' + (all0 ? 'دلوقتي' : 'آخر الفترة') + ' — ' + fmt(T.owed) + ' ج.م', on: 'عند المبتكرين — ' + fmt(T.onThem) + ' ج.م', earned: 'حقهم من الأوردرات المكتملة — ' + fmt(T.earned) + ' ج.م', dep: 'العرابين والمواصلات — ' + fmt(D.round2(T.deposits + T.transport)) + ' ج.م' }[k];
      return { title: ttl, sub: per + ' · اضغط على أي مبتكر يفتح تقريره', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'حقهم من المكتمل', value: fmt(D.round2(l.reduce((x, v) => x + v.completed.earned, 0))) + ' ج.م' }, { label: all0 ? 'المستحق دلوقتي' : 'المستحق آخر الفترة', value: fmt(D.round2(l.reduce((x, v) => x + v.closing, 0))) + ' ج.م' }],
        headers: ['المبتكر', 'رصيد أول الفترة', 'حقه من المكتمل', 'العرابين', 'المواصلات', 'اتحوّله', all0 ? 'المستحق دلوقتي' : 'المستحق آخر الفترة'], rows: l.map((v) => [v.name, fmt(v.opening), fmt(v.completed.earned), fmt(v.deposits), fmt(v.transport), fmt(v.payouts), fmt(v.closing)]),
        onRow: (i) => openAccountBrief(l[i].name), source: all0 ? 'أرقام Dokan الإجمالية لكل متجر + طلبات السحب + الحركات المتسجلة هنا' : 'كشف حساب Dokan لكل مبتكر في الفترة (رصيد أول يوم + اللي اتحط واتسحب) + الحركات المتسجلة هنا' }; };
    const refresh = () => { if (range) A.dropLedger(range.from, range.to); else if (A.refreshWithdrawals) { A.refreshWithdrawals().then(() => render()); } render(); };
    const progress = pending.length ? U.InlineNote({ children: h('span', { 'data-ledger-progress': '' }, 'بنجيب كشوف حساب المبتكرين من Dokan… ', num(String(withStore.length - pending.length)), ' من ', num(String(withStore.length))) }) : null;
    const failNote = !pending.length && failed.length ? U.InlineNote({ kind: 'error', children: 'Dokan مارجّعش كشف ' + failed.length + ' مبتكر — أرقامهم مش في الإجمالي.', action: Button({ type: 'text', size: 'sm', label: 'جرّب تاني', attrs: { 'data-ledger-retry': '' }, onClick: () => { A.loadLedger(range.from, range.to, failed.map((l) => l.id)); render(); } }) }) : null;
    const card = TableCard({ title: 'كشف المبتكرين — ' + per, count: rows0.length + ' مبتكر · ' + T.owedCount + ' ليهم رصيد', cols: false, cls: 'ledger-card own-filter', // its own sort + «اعرض كل المبتكرين» — the kit's auto filter leaves it
      action: h('span', { class: 'acts-inline' }, window.IBKit.Checkbox({ label: 'اعرض كل المبتكرين (حتى اللي مالهمش حركة)', checked: !!state.vledgerAll, onChange: (x) => { state.vledgerAll = x; render(); } }),
        Button({ label: pending.length ? 'بنجيب من Dokan…' : 'حدّث الكشف من Dokan', icon: 'refresh', disabled: !!pending.length, attrs: { 'data-ledger-refresh': '' }, onClick: refresh })),
      pre: B.bar(), body: !rows0.length ? U.EmptyState(all0 ? 'مفيش حركة للمبتكرين لسه' : 'مفيش حركة للمبتكرين في الفترة دي', 'علّم «اعرض كل المبتكرين» تشوفهم كلهم.') : U.Table({ cls: 'vendors-table ledger-table', headers: COLS.map(([, lb]) => lb), rows: rows0.map((l) => COLS.map(([k]) => CELL[k](l))), totalRow: COLS.map(([k]) => TOT[k]) }) });
    const formula = (all0 ? 'من أول المتجر: حقه من المكتمل' : 'الحساب = رصيد أول الفترة + حقه من المكتمل') + ' − العرابين − المواصلات' + (showOM ? ' − الخصومات التانية' : '') + (showCor ? ' + التصحيحات' : '') + ' − اللي اتحوّله' + (showOther ? ' ± المرتجعات والحركات التانية' : '') + ' = ' + (all0 ? 'المستحق دلوقتي (الصافي في «الرصيد دلوقتي»). ' : 'المستحق آخر الفترة. ');
    const src = all0 ? 'حقه من المكتمل والمبيعات والأوردرات من أرقام Dokan الإجمالية للمتجر (حصة إبتكر = المبيعات − حقه)، و«اتحوّله» = كل طلبات السحب اللي اتوافق عليها ناقص الخصومات اللي غطّتها (التسوية)، والعرابين والمواصلات وكل الحركات المتسجلة هنا.'
      : 'رصيد أول الفترة = رصيد Dokan يوم ' + D.formatDateNumeric(range.from) + ' (كشف حساب المبتكر — قراءة بس، مابيتخزنش) ناقص الحركات اللي كانت لسه ماتصفّتش قبله، زي «الصافي». «حقه من المكتمل» من كشف Dokan نفسه في الفترة، و«اتحوّله» = طلبات السحب اللي اتوافق عليها في الفترة ناقص الخصومات اللي غطّتها، والحركات المتسجلة هنا بتاريخها. مبيعات المكتمل وحصة إبتكر = سطور أوردراتنا للأوردرات اللي Dokan حطها في رصيده' + (unmatched ? ' (* فيه أوردرات مش عندنا — المبيعات والحصة ناقصينهم)' : '') + '.';
    return [progress, failNote,
      h('div', { class: 'cards five' },
        U.CategoryCard({ tone: 'brand', name: all0 ? 'المبتكرين' : 'المبتكرين في الفترة', value: rows0.length, unit: 'مبتكر', decimals: false, sub: num(T.orders + ' أوردر حطه Dokan في أرصدتهم'), details: () => detL('all') }),
        U.CategoryCard({ tone: 'gold', name: 'مستحق للمبتكرين', value: T.owed, sub: T.owedCount + ' مبتكرين · ' + (all0 ? 'دلوقتي' : 'آخر الفترة'), details: () => detL('owed') }),
        U.CategoryCard({ tone: 'neutral', name: 'رصيد عند المبتكرين', value: T.onThem, sub: T.onThemCount + ' مبتكرين (عرابين/مواصلات)', details: () => detL('on') }),
        U.CategoryCard({ tone: 'goldlight', name: 'حقهم من المكتمل', value: T.earned, sub: h('span', null, 'حصة إبتكر ', num(fmt(T.share))), details: () => detL('earned') }),
        U.CategoryCard({ tone: 'neutral', name: 'العرابين والمواصلات', value: D.round2(T.deposits + T.transport), sub: h('span', null, 'اتحوّلهم ', num(fmt(T.payouts))), details: () => detL('dep') })),
      window.IBKit.withColumns(card, 'tbl:vendor-ledger', 'كشف المبتكرين'),
      sourceNote(formula + src),
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
      (() => { // phase 5.5 decision 4 (owner 31 Oct): جوّه الرصيد الفعلي فلوس للمبتكرين هياخدوها — أرصدة Dokan الموجبة، ومنها اللي في طلبات سحب مفتوحة
        const A = AC(); const L = (A ? A.balances() : []).filter((b) => b.balance > 0).sort((p, q) => q.balance - p.balance); const owed = D.round2(L.reduce((t, b) => t + b.balance, 0));
        const open = A ? A.withdrawals().filter((w) => w.status === 'pending' || w.status === 'approved') : []; const openAmt = D.round2(open.reduce((t, w) => t + (w.amount || 0), 0)); const net = D.round2(totalActual - owed);
        const nameOf = (id) => { const v = vstore.get(id); return v ? v.name : '—'; }; const openOf = (id) => open.filter((w) => w.vendorId === id).reduce((t, w) => t + (w.amount || 0), 0);
        const owedDet = () => ({ title: 'مستحق للمبتكرين — ' + D.formatMoney(owed) + ' ج.م', sub: 'رصيد كل مبتكر على Dokan دلوقتي · منه ' + D.formatMoney(openAmt) + ' ج.م في ' + open.length + ' طلب سحب مفتوح', summary: [{ label: 'مبتكرين', value: String(L.length) }, { label: 'المستحق', value: D.formatMoney(owed) + ' ج.م' }, { label: 'في طلبات سحب', value: D.formatMoney(openAmt) + ' ج.م' }],
          headers: ['المبتكر', 'رصيد Dokan', 'في طلبات سحب مفتوحة'], rows: L.map((b) => [nameOf(b.vendorId), D.formatMoney(b.balance), D.formatMoney(openOf(b.vendorId))]), total: ['الإجمالي', D.formatMoney(owed), D.formatMoney(openAmt)], source: 'أرصدة Dokan وطلبات السحب (قراءة بس، بتتحدّث كل ساعة)' });
        return h('section', { class: 'card owed-card', 'data-owed': '' }, h('div', { class: 'table-title' }, h('h2', { class: 't-h4' }, 'رصيد إبتكر بعد حساب المبتكرين'), h('span', { class: 'count t-body' }, 'أرصدة Dokan دلوقتي')),
          h('div', { class: 'cards three owed-cards' },
            U.CategoryCard({ tone: 'goldlight', name: 'الرصيد الفعلي', value: totalActual, sub: 'كل الحسابات' }),
            U.CategoryCard({ tone: 'neutral', name: 'مستحق للمبتكرين', value: -owed, sub: h('span', { 'data-owed-wd': '' }, L.length + ' مبتكر · منه ', num(D.formatMoney(openAmt)), ' في ' + open.length + ' طلب سحب'), details: owedDet }),
            U.CategoryCard({ tone: 'brand', name: 'رصيد إبتكر الصافي', value: net, sub: 'الرصيد الفعلي − المستحق للمبتكرين' })),
          h('p', { class: 'source', style: 'margin:0;padding:0 16px 16px' }, 'المستحق = مجموع أرصدة المبتكرين الموجبة على Dokan (قراءة بس). لما طلب سحب يتوافق عليه على Dokan، الرصيد بينزل لوحده مع المزامنة.'));
      })(),
      TableCard({ title: 'الرصيد المتوقع', body: U.Table({ headers: ['البند', 'المبلغ (ج.م)', 'النسبة من المتوقع'],
        rows: [['الرصيد الفعلي', num(D.formatMoney(P.actual)), num(D.formatPct(P.shares.actual))], ['حصة إبتكر من الأوردرات قيد التنفيذ', num(D.formatMoney(P.inProgress)), num(D.formatPct(P.shares.inProgress))], ['العرابين المدفوعة للمبتكرين', num(D.formatMoney(P.deposits)), num(D.formatPct(P.shares.deposits))]],
        totalRow: ['الرصيد المتوقع', num(D.formatMoney(P.total)), num('100.0%')] }) }),
      TableCard({ title: 'سجل الحساب التفصيلي', count: moves.length + (moves.length === 1 ? ' حركة' : ' حركات') + (outside ? ' · ' + outside + ' خارج الفترة' : ''), body: moves.length === 0 ? U.EmptyState('لسه مفيش حركات مسجّلة', 'اضغط «إضافة مبلغ» وسجّل أول إيداع أو سحب، وهيظهر هنا.') :
        U.Table({ headers: ['التاريخ', 'نوع الحساب', 'العملية', 'المبلغ (ج.م)', ''], rows: moves.map((m) => [num(D.formatDateNumeric(m.date)), m.account, m.direction === 'deposit' ? 'إيداع' : 'سحب',
          h('span', { class: m.direction === 'deposit' ? 'pos' : 'neg' }, num((m.direction === 'deposit' ? '+' : '-') + D.formatMoney(m.amount))), RowActions('accountMoves', m, (r) => deleteRec('accountMoves', r))]) }) }),
      sourceNote('المصدر: حركات الحساب الفعلي المتسجلة في السيستم (الرصيد الافتتاحي صفر لحد الاستيراد) · الرصيد المتوقع = الرصيد الفعلي + حصة إبتكر من الأوردرات قيد التنفيذ + العرابين المدفوعة للمبتكرين'),
    ];
  }

  // ---------- render ----------
  const VIEWS = { 'acc-overview': AccountsOverview, 'acc-reports': () => AccountsReportView(), expenses: ExpensesView, subscriptions: SubsView, sales: SalesView, vendors: VendorsTab, actual: ActualView, 'moves-log': MovesLogView };
  let focusTab = false;
  // ---------- Reports page (Figma: التقارير — Desktop 1440 / Mobile 360) ----------
  const R = window.IbtekrReports;
  const ordersRows = () => (window.OrdersApp ? window.OrdersApp.query({}, 10000).rows : []);
  const tone4 = ['brand', 'gold', 'goldlight', 'neutral'];
  const kpiTone = (d) => (state.rcompare ? d.tone : 'off');
  const money = (n) => D.formatMoney(n);
  const pctText = (n, total) => (total ? Math.round(n / total * 100) : 0) + '%';
  // decision 9: «آخر تحديث» = the time of the last real orders load (IBOrders ready), in Cairo — the prototype's fixed 09:30 is gone
  let ordersAt = null;
  const cairoAt = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
  const RSRC = { orders: 'الأوردرات', vendors: 'الأوردرات + أرصدة Dokan + حركات الحسابات', accounts: 'الأوردرات والحسابات', products: 'الأوردرات + كتالوج ووكومرس', inventory: 'المخزن', cs: 'خدمة العملاء', tickets: 'تذاكر الفريق' };
  const freshness = () => { const src = RSRC[state.rtab]; const at = ordersAt ? cairoAt(ordersAt) : null;
    return (at ? 'آخر تحميل للأوردرات: ' + D.formatDateLong(at.day) + '، ' + at.hm + ' (توقيت القاهرة)' : 'بنحمّل الأوردرات…') + (src ? ' · المصدر: ' + src : ''); };
  // the page follows the data its tabs read: a load / a live change redraws the open tab (each adapter emits on a change only)
  const RP_ON = { 'ib:orders': ['orders', 'vendors', 'accounts', 'products'], 'ib:vendors': ['vendors'], 'ib:products': ['products'], 'ib:inventory': ['inventory'], 'ib:cs': ['cs'], 'ib:tickets': ['tickets'], 'ib:directory': null };
  // a popover open on the page (the range picker, «الإجراءات») is never closed under the member's hand: the redraw waits for it
  let rpTimer = null;
  const rpRedraw = (wait) => { clearTimeout(rpTimer); rpTimer = setTimeout(() => { if (state.page !== 'reports') return; if (document.querySelector('#reports [aria-expanded="true"]')) { rpRedraw(500); return; } renderReports(); }, wait || 50); };
  Object.keys(RP_ON).forEach((ev) => document.addEventListener(ev, () => {
    if (ev === 'ib:orders') { const O = window.IBOrders; if (!O || O.state() !== 'ready') return; ordersAt = new Date(); }
    if (state.page !== 'reports' || (RP_ON[ev] && !RP_ON[ev].includes(state.rtab))) return;
    rpRedraw();
  }));
  function barList(items, { max, fmt, tones }) {
    // items: [label, value, extraText?]; tones: fixed order (color follows the entity, never its rank)
    const top = max || Math.max(1, ...items.map((i) => i[1]));
    return items.map((it, i) => U.BarRow({ tone: (tones && tones[i]) || tone4[Math.min(i, 3)], label: it[0], value: it[2] || fmt(it[1]), pct: it[1] / top }));
  }
  // a text cell that starts like a formula (= + - @ tab CR) gets a leading apostrophe so a spreadsheet never runs it (CSV injection —
  // customer names and ticket titles come from outside, like the kit's xlsxExport); numbers stay numbers
  const csvSafe = (c) => (typeof c === 'string' && /^[=+\-@\t\r]/.test(c) ? "'" + c : c);
  function csvCopy(headers, rows, label) {
    const text = R.toCsv(headers.map(csvSafe), rows.map((r) => r.map(csvSafe)));
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
      if (k === 'count') return { title: 'أوردرات الفترة — ' + n, sub: per + ' · اضغط على أي أوردر يفتح تفاصيله', summary: [{ label: 'العدد', value: String(n) }, { label: 'إجمالي القيمة', value: money(rep.total) + ' ج.م' }, { label: 'الفترة السابقة', value: String(rep.prev.count) }], headers: oHead, rows: oRows(all), total: ['الإجمالي — ' + n + ' أوردر', '', '', '', '', '', money(rep.total)], onRow: oOpen(all), source: 'الأوردرات (السيستم) — من تاريخ الأوردر' };
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
        U.ChartCard({ title: 'حالة التسليم', subtitle: 'الأوردرات المفتوحة · من تاريخ التأكيد: 9 / 12 يوم', footnote: 'الحالة تُحسب من تاريخ تأكيد الأوردر (غير المؤكد مالوش تأخير)، لا تُكتب يدويًا', body: ['ok', 'risk', 'late'].map((k) => h('div', { class: 'deliv-row' }, U.DelayBadge(k), h('span', { class: 't-label' }, num(rep.byDelivery[k] + ' أوردر (' + pctText(rep.byDelivery[k], n) + ')')))) })),
      TableCard({ title: 'أوردرات تحتاج تدخّل — قابلة للتأخير أو غير مؤكدة', count: rep.actionRows.length + ' أوردر', action: Button({ type: 'text', size: 'sm', label: 'فتح في الأوردرات', onClick: () => showOrders({ deliv: 'risk' }) }),
        body: rep.actionRows.length === 0 ? U.EmptyState('كله تمام', 'مفيش أوردرات مفتوحة قابلة للتأخير أو غير مؤكدة في الفترة دي.') : tableOrList(
          () => U.Table({ headers, rows: rep.actionRows.map((r) => [num(r.id), r.customer, r.status, cfText(r.confirm), U.DelayBadge(r.delivery), num(String(r.ageDays)), num(money(r.total))]) }),
          () => CardList({ headers, titleIndex: 1, rows: rep.actionRows.map((r) => [num(r.id), r.customer, r.status, cfText(r.confirm), U.DelayBadge(r.delivery), num(String(r.ageDays)), num(money(r.total))]) })) }),
      h('p', { class: 'source' }, 'المصدر: الأوردرات (الموقع، متزامنة مع السيستم) · الفترة تُحسب من تاريخ الأوردر بتوقيت القاهرة · كل الأرقام مشتقة ولا تُكتب يدويًا')];
  }
  // decision 61: «نظرة عامة» — the period above (the accounts' own) in one look: the sales and Ibtekr's share from our orders, the
  // expenses by type, the net, the real accounts, the makers' balance; every tile opens its tab
  function AccountsOverview() {
    const r = state.range; const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, r.from, r.to);
    const byCat = {}; D.CATEGORIES.forEach((c) => { byCat[c] = tot.byCategory[c].amount; });
    const rep = R.accountsReport({ expenses: byCat, sales: SEED.sales || [], accounts: accountsNow().balances, inProgressShare: SEED.inProgressShare || 0, deposits: (SEED.vendorTotals && SEED.vendorTotals.dep) || 0 });
    const vs = vendorsNow(); const due = vs.reduce((a, v) => a + Math.max(0, Number(v.balance) || 0), 0);
    const open = (tab) => () => { state.tab = tab; try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed */ } render(); };
    const tile = (label, value, note, tab, tone) => h('div', { class: 'acc-ov-tile', 'data-acc-ov': tab }, U.KpiTile({ label, value, unit: 'ج.م', compare: tone || 'off', note }), Button({ type: 'text', size: 'sm', label: 'افتح ←', attrs: { 'aria-label': 'افتح ' + label }, onClick: open(tab) }));
    const pct = (x) => num(Math.round(x * 100) + '%');
    return [
      h('div', { class: 'cards five' },
        tile('المبيعات (مكتمل)', D.formatMoney(rep.salesTotal), num(rep.orders + ' أوردر في الفترة'), 'sales'),
        tile('حصة إبتكر', D.formatMoney(rep.share), num('من المبيعات ' + Math.round(rep.sharePct * 100) + '%'), 'sales'),
        tile('إجمالي المصروفات', D.formatMoney(rep.expensesTotal), 'المرتبات والمصروفات والاشتراكات والإعلانات', 'expenses'),
        tile('الصافي', D.formatMoney(rep.net), 'حصة إبتكر − المصروفات', 'acc-reports', rep.net < 0 ? 'negative' : rep.net > 0 ? 'positive' : 'off'),
        tile('الحساب الفعلي — الآن', D.formatMoney(rep.actual), 'مجموع الحسابات', 'actual'),
        tile('مستحقات المبتكرين — الآن', D.formatMoney(Math.round(due * 100) / 100), num(vs.filter((v) => Number(v.balance) > 0).length + ' مبتكر ليه رصيد'), 'vendors')),
      h('div', { class: 'grid2' },
        TableCard({ title: 'المصروفات حسب النوع', count: periodText(), body: U.Table({ cls: 'mini-table', headers: ['النوع', 'المبلغ', 'النسبة'], rows: rep.expenseRows.map(([k, v, p]) => [k, num(money(v)), pct(p)]) }) }),
        TableCard({ title: 'الحسابات الفعلية', count: 'الآن', body: rep.accountRows.length ? U.Table({ cls: 'mini-table', headers: ['الحساب', 'الرصيد', 'النسبة'], rows: rep.accountRows.map(([k, v, p]) => [k, num(money(v)), pct(p)]) }) : U.EmptyState('مفيش حسابات لسه', 'الحسابات بتتسجل من «الحساب الفعلي».') })),
      h('p', { class: 'source' }, 'المصدر: المبيعات وحصة إبتكر من أوردراتنا (accounts_sales) في الفترة، المصروفات من دفتر المصروفات، الحساب الفعلي من حركاته، ومستحقات المبتكرين من أرصدة Dokan.')];
  }
  function AccountsReportView() {
    // phase 5.5 decision 4 (owner 31 Oct 16:42): the report follows the period picked above (expenses + sales + net) instead of a fixed month; (owner 1 Nov): a month-by-month summary
    const rr = state.rrange; const PER = D.formatDateNumeric(rr.from) + ' – ' + D.formatDateNumeric(rr.to); const A = AC();
    const salesFor = (from, to) => { const rows = A ? A.sales(from, to) : []; return rows ? D.liveSeed({ makers: [], balances: [], sales: rows }) : null; };
    const repOf = (from, to) => { const tot = D.categoryTotals(SEED.expenseSeed, store.expenses, from, to); const byCat = {}; D.CATEGORIES.forEach((c) => { byCat[c] = tot.byCategory[c].amount; });
      const sv = salesFor(from, to); return { sv, loading: !sv, rep: R.accountsReport({ expenses: byCat, sales: sv ? sv.sales : [], accounts: accountsNow().balances, inProgressShare: sv ? sv.inProgressShare : 0, deposits: SEED.vendorTotals.dep }) }; };
    const { sv: SV, rep, loading } = repOf(rr.from, rr.to);
    const headers = ['الشهر', 'الأوردرات', 'المبيعات', 'حصة إبتكر', 'المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات', 'إجمالي المصروفات', 'الصافي', 'النتيجة', 'الحساب الفعلي (الآن)', 'الحساب المحتمل (الآن)'];
    const catOf = (x, c) => ((x.expenseRows.find((r) => r[0] === c) || [, 0])[1]) || 0;
    const resTag = (n) => h('span', { class: 'tg tg-' + (n < 0 ? 'error' : n > 0 ? 'success' : 'neutral') }, n < 0 ? 'خسارة' : n > 0 ? 'ربح' : 'تعادل');
    const months = []; let anyLoading = loading;
    { let [y, m] = rr.from.split('-').map(Number); for (;;) { const ym = y + '-' + String(m).padStart(2, '0'); if (ym + '-01' > rr.to) break; const a0 = ym + '-01' < rr.from ? rr.from : ym + '-01'; const e = ym + '-' + String(lastDay(y, m)).padStart(2, '0'); const b = e > rr.to ? rr.to : e;
      const x0 = repOf(a0, b); const x = x0.rep; anyLoading = anyLoading || x0.loading; const part = a0 !== ym + '-01' || b !== e;
      months.push([D.monthName(m) + ' ' + y + (part ? ' (' + Number(a0.slice(8)) + '–' + Number(b.slice(8)) + ')' : ''), x.orders, x.salesTotal, x.share, catOf(x, 'المرتبات'), catOf(x, 'المصروفات'), catOf(x, 'الاشتراكات'), catOf(x, 'الإعلانات'), x.expensesTotal, x.net]);
      m++; if (m > 12) { m = 1; y++; } if (months.length > 24) break; } }
    const rows = months;
    rExport = { label: 'ملخص الحسابات', headers, rows: rows.map((r) => r.concat([r[9] < 0 ? 'خسارة' : r[9] > 0 ? 'ربح' : 'تعادل', '', ''])).concat([['الإجمالي', rep.orders, rep.salesTotal, rep.share, catOf(rep, 'المرتبات'), catOf(rep, 'المصروفات'), catOf(rep, 'الاشتراكات'), catOf(rep, 'الإعلانات'), rep.expensesTotal, rep.net, rep.net < 0 ? 'خسارة' : 'ربح', rep.actual, rep.potential]]) };
    const netTone = rep.net < 0 ? 'negative' : 'positive';
    const pctRow = ([l, v, p]) => [l, money(v), D.formatPct(p)];
    const adet = (k) => {
      if (k === 'actual') return { title: 'الحساب الفعلي — ' + money(rep.actual) + ' ج.م', sub: 'الأرصدة الحالية · بتتدخل يدويًا في تاب «الحساب الفعلي» لحد الربط البنكي', summary: [{ label: 'الحساب الفعلي', value: money(rep.actual) + ' ج.م' }, { label: 'الرصيد المحتمل', value: money(rep.potential) + ' ج.م' }], headers: ['الحساب', 'الرصيد', 'النسبة'], rows: rep.accountRows.map(pctRow), total: ['الإجمالي', money(rep.actual), '100%'], note: 'الرصيد المحتمل = الحساب الفعلي + حصة إبتكر من أوردرات التنفيذ + العرابين المدفوعة: ' + rep.potentialParts.map(([l, v]) => l + ' ' + money(v)).join(' + '), actions: [{ label: 'فتح الحساب الفعلي', onClick: () => { state.tab = 'actual'; go('accounts'); } }] };
      if (k === 'share') return { title: 'حصة إبتكر من المبيعات — ' + money(rep.share) + ' ج.م', sub: PER + ' · حصة كل أوردر بنسبة المبتكر بتاعه', summary: [{ label: 'المبيعات', value: money(rep.salesTotal) + ' ج.م' }, { label: 'حصة إبتكر', value: money(rep.share) + ' ج.م' }, { label: 'متوسط العمولة', value: Math.round(rep.sharePct * 1000) / 10 + '%' }], headers: ['حالة الأوردر', 'الأوردرات', 'المبيعات', 'حصة إبتكر', 'النسبة'], rows: (SV ? SV.sales : []).map((x) => [x.label, String(x.orders), money(x.sales), money(x.share), x.sales ? D.formatPct(x.share / x.sales) : '—']), total: ['الإجمالي', String(rep.orders), money(rep.salesTotal), money(rep.share), rep.salesTotal ? D.formatPct(rep.share / rep.salesTotal) : '—'], actions: [{ label: 'فتح المبيعات', onClick: () => { state.tab = 'sales'; go('accounts'); } }] };
      if (k === 'exp') return { title: 'المصروفات — ' + money(rep.expensesTotal) + ' ج.م', sub: PER + ' · حسب الفئة', summary: [{ label: 'الإجمالي', value: money(rep.expensesTotal) + ' ج.م' }, { label: 'أكبر فئة', value: (rep.expenseRows.slice().sort((p, q) => q[1] - p[1])[0] || ['—'])[0] }], headers: ['الفئة', 'المبلغ', 'النسبة'], rows: rep.expenseRows.map(pctRow), total: ['الإجمالي', money(rep.expensesTotal), '100%'], actions: [{ label: 'فتح المصروفات', onClick: () => { state.tab = 'expenses'; go('accounts'); } }] };
      return { title: 'صافي الفترة — ' + money(rep.net) + ' ج.م (' + (rep.net < 0 ? 'خسارة' : 'ربح') + ')', sub: PER + ' · الصافي = حصة إبتكر − المصروفات', summary: [{ label: 'حصة إبتكر', value: money(rep.share) + ' ج.م' }, { label: 'المصروفات', value: money(rep.expensesTotal) + ' ج.م' }, { label: 'الصافي', value: money(rep.net) + ' ج.م' }], headers: ['البند', 'المبلغ'], rows: [['حصة إبتكر من المبيعات (+)', money(rep.share)]].concat(rep.expenseRows.map(([l, v]) => [l + ' (−)', money(v)])).concat([['الصافي', money(rep.net)]]) }; };
    const tA = trAll();
    return [
      anyLoading ? U.InlineNote({ children: 'بنحمّل أرقام الفترة…' }) : null,
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'الحساب الفعلي', value: money(rep.actual), unit: 'ج.م', compare: 'off', note: ['بنك + بوسطة + باي موب + محفظة · الرصيد المحتمل ', num(money(rep.potential))], details: () => adet('actual') }),
        U.KpiTile({ label: 'حصة إبتكر من المبيعات', value: money(rep.share), unit: 'ج.م', compare: 'off', note: ['من مبيعات ', num(money(rep.salesTotal)), ' · متوسط عمولة ', num(Math.round(rep.sharePct * 1000) / 10 + '%')], details: () => adet('share') }),
        U.KpiTile({ label: 'إجمالي المصروفات', value: money(rep.expensesTotal), unit: 'ج.م', compare: 'off', note: PER + ' · المرتبات · المصروفات · الاشتراكات · الإعلانات', details: () => adet('exp') }),
        U.KpiTile({ label: 'صافي الفترة (حصة إبتكر − المصروفات)', value: money(rep.net), unit: 'ج.م', compare: netTone, delta: { text: rep.net < 0 ? 'خسارة' : 'ربح', caption: PER }, note: [num(money(rep.share)), ' − ', num(money(rep.expensesTotal))], details: () => adet('net') }),
        U.KpiTile({ label: 'المواصلات', value: money(tA.total), unit: 'ج.م', compare: 'off', note: ['مبتكرين ', num(money(tA.vendors)), ' · تشغيل ', num(money(tA.ops)), ' · من البداية'], details: () => transportDetails(null) })),
      h('div', { class: 'charts' },
        U.ChartCard({ title: 'المصروفات حسب الفئة', subtitle: PER + ' · ' + money(rep.expensesTotal) + ' ج.م', footnote: 'نفس أرقام تاب «المصروفات» في الحسابات', body: barList(rep.expenseRows.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money }) }),
        U.ChartCard({ title: 'المبيعات حسب حالة الأوردر', subtitle: PER + ' · ' + rep.orders + ' أوردر', footnote: 'حصة إبتكر تُحسب بنسبة كل مبتكر', body: barList(rep.salesRows.map(([l, v, sh]) => [l, v, money(v) + ' · حصة ' + money(sh)]), { fmt: money, tones: ['brand', 'gold', 'neutral'] }) }),
        U.ChartCard({ title: 'توزيع الحساب الفعلي', subtitle: 'الأرصدة الحالية', footnote: 'تُدخل يدويًا في تاب «الحساب الفعلي» حتى يتم الربط البنكي', body: barList(rep.accountRows.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money }) }),
        U.ChartCard({ title: 'مكوّنات الرصيد المحتمل', subtitle: money(rep.potential) + ' ج.م', footnote: 'الرصيد المحتمل = الحساب الفعلي + حصة إبتكر من أوردرات التنفيذ + العرابين المدفوعة', body: barList(rep.potentialParts.map(([l, v, p]) => [l, v, money(v) + ' (' + D.formatPct(p) + ')']), { fmt: money, tones: ['brand', 'gold', 'goldlight'] }) })),
      TableCard({ title: 'ملخص الحسابات الشهري', count: PER + ' · الصافي ' + money(rep.net) + ' ج.م (' + (rep.net < 0 ? 'خسارة' : 'ربح') + ') · الحساب الفعلي ' + money(rep.actual) + ' · المحتمل ' + money(rep.potential),
        action: Button({ type: 'text', size: 'sm', label: 'فتح الحسابات', onClick: () => { state.tab = 'actual'; go('accounts'); } }),
        body: (() => { const tRows = rows.map((r) => r.map((c, i) => (i === 0 ? c : i === 1 ? num(String(c)) : i === 9 ? h('span', { class: c < 0 ? 'neg' : 'pos' }, num(money(c))) : num(money(c)))).concat([resTag(r[9]), '—', '—']));
          return tableOrList(() => U.Table({ cls: 'acc-month-tbl', headers, rows: tRows, totalRow: ['الإجمالي', num(String(rep.orders)), num(money(rep.salesTotal)), num(money(rep.share)), num(money(catOf(rep, 'المرتبات'))), num(money(catOf(rep, 'المصروفات'))), num(money(catOf(rep, 'الاشتراكات'))), num(money(catOf(rep, 'الإعلانات'))), num(money(rep.expensesTotal)), h('span', { class: rep.net < 0 ? 'neg' : 'pos' }, num(money(rep.net))), resTag(rep.net), num(money(rep.actual)), num(money(rep.potential))] }), () => CardList({ headers, titleIndex: 0, rows: tRows })); })() }),
      U.InlineNote({ kind: rep.net < 0 ? 'error' : 'success', children: h('span', null, 'الفترة ' + PER + ': حصة إبتكر ' + money(rep.share) + ' − المصروفات ' + money(rep.expensesTotal) + ' = ', h('b', null, money(rep.net) + ' ج.م ' + (rep.net < 0 ? 'خسارة' : 'ربح')), ' · الحساب الفعلي دلوقتي ' + money(rep.actual) + ' · الرصيد المحتمل ' + money(rep.potential) + ' (الفعلي + حصة إبتكر من أوردرات التنفيذ + العرابين)') }),
      h('p', { class: 'source' }, 'المصدر: الأوردرات (السيستم، حسب تاريخ الأوردر) والمصروفات المتسجلة في السيستم للفترة المختارة · الحساب الفعلي رصيد اللحظة الحالية · الصافي = حصة إبتكر − المصروفات')].filter(Boolean);
  }
  // ---------- phase 9 (docs/superpowers/plans/2026-11-05-phase-9-reports.md): the v2's other tabs on real data ----------
  const K0 = (n) => Number(n || 0).toLocaleString('en-US');
  const isoDay = (x) => (/^\d{4}-\d{2}-\d{2}/.test(String(x || '')) ? String(x).slice(0, 10) : null);
  const cairoDayOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? cairoAt(new Date(t)).day : ''; };
  // «تقارير المبتكرين» (decision 3): the orders and the delays from our orders in the range (R.vendorsReport); the completed share in the
  // range, the deposits and the transport from the accounts (accounts_sales + acc_vendor_moves — accounts.view ≠ N) and the balance from
  // Dokan (dokan_balances); the commission for sensitive.commission = F only (vendor_rates answers no rate to the rest — the column and the
  // card are not drawn). The «— الآن» cards are the makers page's own numbers (makerSummary).
  function VendorsReportView() {
    const money$ = rperm('accounts.view') !== 'N', rate$ = rperm('sensitive.commission') === 'F';
    const A = ACC(), V = window.IBVendors; const rr = state.rrange;
    const sales = money$ && A ? A.sales(rr.from, rr.to) : null;
    const failed = money$ && !!A && !sales && A.salesFailed(rr.from, rr.to); const loading = money$ && !!A && !sales && !failed;
    const makers = V && V.store ? V.store.all().map((v) => ({ id: v.id, name: v.name, rate: rate$ && v.rate != null ? v.rate : null })) : [];
    const seedV = D.liveSeed({ makers, balances: money$ && A ? A.balances() : [], sales: sales || [] }).vendors;
    const vs = money$ ? vendorsOf(seedV) : seedV;
    const rep = R.vendorsReport(ordersRows(), rr, TODAY, vs);
    rep.rows.forEach((r) => { r.transport = money$ ? trVendor(r.name).total : 0; });
    const trTot = Math.round(rep.rows.reduce((x, r) => x + r.transport, 0) * 100) / 100; const tA = trAll();
    const COLS = [{ h: 'المبتكر', v: (r) => r.name, t: (r) => r.name, tot: 'الإجمالي' }, { h: 'الأوردرات', v: (r) => r.orders, t: (r) => num(String(r.orders)), tot: num(String(rep.totals.orders)) }, { h: 'قابلة للتأخير', v: (r) => r.late, t: (r) => num(String(r.late)), tot: num(String(rep.totals.late)) }]
      .concat(rate$ ? [{ h: 'العمولة', v: (r) => r.pct, t: (r) => num(r.pct), tot: '—' }] : [])
      .concat(money$ ? [{ h: 'حصة إبتكر (مكتمل)', v: (r) => r.share, t: (r) => num(money(r.share)), tot: num(money(rep.totals.share)) }, { h: 'العرابين', v: (r) => r.deposits, t: (r) => num(money(r.deposits)), tot: num(money(rep.totals.deposits)) },
        { h: 'المواصلات', v: (r) => r.transport, t: (r) => num(money(r.transport)), tot: num(money(trTot)) }, { h: 'الرصيد الحالي', v: (r) => r.balance, t: (r) => num(money(r.balance)), tot: num(money(rep.totals.balance)) }] : []);
    const headers = COLS.map((c) => c.h); const vrow = (r) => COLS.map((c) => c.t(r));
    rExport = { label: 'جدول المبتكرين', headers, rows: rep.rows.map((r) => COLS.map((c) => c.v(r))) };
    const vOpen = (list) => (i) => { const v = vstore.findByName(list[i].name); if (v) openVendor(v.id, { inPlace: true }); };
    const avgPct = Math.round(rep.avgCommission * 1000) / 10 + '%';
    const vdet2 = (k) => {
      if (k === 'active') { const l = rep.rows.filter((r) => r.orders > 0); return { title: 'المبتكرين النشطين في الفترة — ' + l.length, sub: 'مبتكر له أوردر واحد على الأقل · الأوردر المشترك بيتحسب لكل مبتكر فيه · اضغط على أي صف يفتح ملفه', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'أوردرات', value: String(l.reduce((x, r) => x + r.orders, 0)) }], headers, rows: l.map(vrow), onRow: vOpen(l), empty: 'مفيش مبتكرين ليهم أوردرات في الفترة دي.' }; }
      if (k === 'pct') { const l = vs.filter((v) => /%/.test(v.pct)).sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct)); return { title: 'نسبة إبتكر لكل مبتكر — المتوسط ' + avgPct, sub: 'النسبة الحالية لكل مبتكر (من الموقع أو من «الاتفاق التجاري») · اضغط على أي صف يفتح ملفه', summary: [{ label: 'المتوسط', value: avgPct }, { label: 'أعلى', value: l.length ? l[0].name + ' ' + l[0].pct : '—' }, { label: 'أقل', value: l.length ? l[l.length - 1].name + ' ' + l[l.length - 1].pct : '—' }], headers: ['المبتكر', 'النسبة'].concat(money$ ? ['حصة إبتكر (مكتمل)'] : []), rows: l.map((v) => [v.name, num(v.pct)].concat(money$ ? [num(money(v.c[2]))] : [])), onRow: vOpen(l), empty: 'مفيش نسب متسجلة.' }; }
      if (k === 'dep') { const l = vs.filter((v) => v.deposits > 0).sort((a, b) => b.deposits - a.deposits); return { title: 'عرابين مدفوعة للمبتكرين — ' + money(rep.deposits) + ' ج.م', sub: 'بتتخصم من رصيد المبتكر · اضغط على أي صف يفتح ملفه', summary: [{ label: 'الإجمالي', value: money(rep.deposits) + ' ج.م' }, { label: 'مبتكرين', value: String(l.length) }], headers: ['المبتكر', 'العربون', 'الرصيد الحالي'], rows: l.map((v) => [v.name, num(money(v.deposits)), num(money(v.balance))]), total: l.length ? ['الإجمالي', num(money(l.reduce((x, v) => x + v.deposits, 0))), num(money(l.reduce((x, v) => x + v.balance, 0)))] : null, onRow: vOpen(l), empty: 'مفيش عرابين متسجلة.', source: 'حركات «عربون» في حسابات المبتكرين + أرصدة Dokan' }; }
      const l = rep.rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late); return { title: 'مبتكرين عندهم أوردرات قابلة للتأخير — ' + l.length, sub: 'من ' + rep.active + ' مبتكر نشط في الفترة · قاعدة 9 / 11 يوم', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'أوردرات قابلة للتأخير / متأخرة', value: String(l.reduce((x, r) => x + r.late, 0)) }], headers, rows: l.map(vrow), onRow: vOpen(l), empty: 'مفيش مبتكرين عندهم أوردرات قابلة للتأخير في الفترة دي.' }; };
    const ms = makerSummary({ inPlace: true });
    return [
      loading ? U.InlineNote({ children: 'بنحمّل أرقام الفترة…' }) : null,
      failed ? U.InlineNote({ kind: 'error', children: 'مقدرناش نحمّل مبيعات الفترة — حصة إبتكر في الجدول ناقصة. غيّر الفترة أو حدّث الصفحة.' }) : null,
      ((tiles) => h('div', { class: tiles.length % 4 === 0 ? 'cards four' : 'cards five' }, tiles))([
        U.KpiTile({ label: 'مبتكرين نشطين', value: String(rep.active), unit: 'مبتكر', compare: kpiTone(rep.deltas.active), delta: rep.deltas.active, note: 'مبتكر له أوردر واحد على الأقل في الفترة', details: () => vdet2('active') }),
        rate$ ? U.KpiTile({ label: 'متوسط عمولة إبتكر', value: avgPct, compare: 'off', note: 'متوسط النسبة الحالية على المبتكرين اللي ليهم نسبة', details: () => vdet2('pct') }) : null,
        money$ ? U.KpiTile({ label: 'عرابين مدفوعة للمبتكرين', value: money(rep.deposits), unit: 'ج.م', compare: 'off', note: 'من حركات حسابات المبتكرين · بتتخصم من رصيد المبتكر', details: () => vdet2('dep') }) : null,
        money$ ? U.KpiTile({ label: 'مواصلات المبتكرين', value: money(tA.vendors), unit: 'ج.م', compare: 'off', note: [num(String(tA.vendorTrips)), ' مشوار لـ ', num(String(tA.vendorCount)), ' مبتكرين · من البداية'], details: () => transportDetails('') }) : null,
        U.KpiTile({ label: 'إجمالي مستحقات المبتكرين — الآن', value: money(ms.sum.due), unit: 'ج.م', compare: 'off', note: 'نفس رقم صفحة المبتكرين (من الأوردرات المكتملة) · مش بالفترة', details: () => ms.vdet('due') }),
        U.KpiTile({ label: 'عندهم أوردرات قابلة للتأخير — الآن', value: String(ms.sum.withDelay), unit: 'مبتكرين', compare: ms.sum.withDelay ? 'negative' : 'off', delta: { text: 'متابعة', caption: 'نفس مصدر إشعار «مبتكرين متأخرين»' }, note: 'قاعدة 9 / 11 يوم على الأوردرات المفتوحة · مش بالفترة', details: () => ms.vdet('delay') }),
        U.KpiTile({ label: 'عندهم رصيد سالب (عرابين) — الآن', value: String(ms.sum.negative), unit: 'مبتكرين', compare: 'off', note: ['إجمالي ', num(money(ms.sum.negativeTotal)), ' ج.م مدفوعة مقدمًا'], details: () => ms.vdet('negative') }),
        U.KpiTile({ label: 'مبتكرين عندهم أوردرات قابلة للتأخير', value: String(rep.withDelay), unit: 'مبتكر', compare: kpiTone(rep.deltas.withDelay), delta: rep.deltas.withDelay, note: 'من ' + rep.active + ' مبتكر نشط في الفترة', details: () => vdet2('late') })].filter(Boolean)),
      h('div', { class: 'charts' },
        U.ChartCard({ title: 'أعلى المبتكرين بعدد الأوردرات', subtitle: 'الفترة المحددة · أوردرات فيها المبتكر', footnote: 'الأوردر المشترك يُحسب لكل مبتكر فيه', body: rep.topByOrders.length ? barList(rep.topByOrders, { fmt: String, tones: ['brand', 'brand', 'brand', 'goldlight', 'goldlight', 'neutral'] }) : U.EmptyState('مفيش بيانات', 'مفيش أوردرات في الفترة') }),
        U.ChartCard({ title: 'المبتكرون الأكثر تأخيرًا', subtitle: 'أوردرات مفتوحة قابلة للتأخير أو متأخرة', footnote: 'يُحسب من قاعدة 9 / 11 يوم · نفس مصدر إشعار «مبتكرين متأخرين»', body: rep.topLate.length ? barList(rep.topLate, { fmt: String, tones: ['gold', 'gold', 'goldlight', 'goldlight', 'goldlight', 'neutral'] }) : U.EmptyState('كله في الموعد', 'مفيش مبتكرين عندهم أوردرات قابلة للتأخير في الفترة') })),
      TableCard({ title: 'جدول المبتكرين — الفترة المحددة', count: rep.rows.length + ' مبتكر',
        body: rep.rows.length ? tableOrList(() => U.Table({ cls: 'vendors-table', headers, rows: rep.rows.map(vrow), totalRow: COLS.map((c) => c.tot) }), () => CardList({ headers, titleIndex: 0, rows: rep.rows.map(vrow) })) : U.EmptyState('مفيش مبتكرين في الفترة دي', 'مفيش أوردرات لأي مبتكر في الفترة — غيّر الفترة من فوق.') }),
      h('p', { class: 'source' }, 'المصدر: الأوردرات (السيستم، حسب تاريخ الأوردر)' + (money$ ? ' · حصة إبتكر من الأوردرات المكتملة في الفترة بنسبة الموقع على كل سطر · العرابين والمواصلات من حركات حسابات المبتكرين (من البداية) · الرصيد الحالي = رصيد Dokan − العرابين − المواصلات (زي تاب «حسابات المبتكرين»)' : '') + (rate$ ? ' · العمولة = النسبة الحالية لكل مبتكر' : '') + ' · كروت «— الآن» نفس أرقام صفحة المبتكرين.')].filter(Boolean);
  }
  // «تقارير المنتجات» (decision 7): the products page's own reports (products.js reportBlocks — products_report + the mirror) — one source
  let rpProdCtx = null;
  function ProductsReportView() {
    const pg = window.IBPages && window.IBPages.all().products; const api = pg && pg.api;
    if (!api || !api.reportBlocks) { rExport = null; rpProdCtx = null; return [U.EmptyState('تقارير المنتجات مش متاحة', 'صفحة المنتجات ماتحمّلتش — حدّث الصفحة.')]; }
    const b = api.reportBlocks(() => renderReports()); rExport = b.exp; rpProdCtx = b.ctx; return b.blocks;
  }
  // «تقارير الموظفين» (phase 10 T8, decision 20): the v5 cards on IBHR — the team hr.view shows (IBHR.team()); absence in the range from the
  // attendance (a work day — not Friday / Saturday / a holiday — from the hire date with no attendance and no approved leave; today once the
  // shift is over), the first reply from the customer service conversations of the range (cs.view), the monthly KPI scores of the last
  // three months up to the range's end; «المهام» = the team's open tasks now (hr_tasks — decision 25; a task postponed to today or earlier
  // is today's again, block 12's rollover)
  function staffData(rr) {
    const H = window.IBHR; const HD = H.data; const mem = H.team(); const t = H.today(); const hol = H.holidayDates();
    const loaded = H.addDays(t, -119); const from0 = rr.from < loaded ? loaded : rr.from; const to0 = rr.to < t ? rr.to : H.addDays(t, -1);
    const att = new Set(HD.attendance.map((a) => a.member + '|' + a.date));
    const first = {}; HD.attendance.forEach((a) => { if (!first[a.member] || a.date < first[a.member]) first[a.member] = a.date; });
    const onLeave = (code, d) => HD.requests.some((q) => q.member === code && H.isLeave(q.type) && q.status === 'موافق' && q.from <= d && q.to >= d);
    const absent = [];
    mem.forEach((m) => { const start = [from0, m.hire || first[m.id] || t].sort().pop(); for (let d = start, i = 0; d <= to0 && i < 400; d = H.addDays(d, 1), i++) { if (H.leaveDays(d, d, hol) !== 1 || att.has(m.id + '|' + d) || onLeave(m.id, d)) continue; absent.push({ member: m.id, date: d, status: 'غياب' }); } });
    const todayAbsent = rr.from <= t && rr.to >= t ? mem.filter((m) => (HD.today[m.id] || {}).kind === 'absent').map((m) => m.id) : [];
    const resp = {}; const CSD = window.IBCS && window.IBCS.data; const csOk = rperm('cs.view') !== 'N' && !!CSD;
    if (csOk) {
      const byName = {}; (CSD.convs || []).forEach((c) => { const at = String(c.createdAt || '').slice(0, 10); if (!c.assignee || at < rr.from || at > rr.to) return; const i = (c.msgs || []).find((x) => x.t === 'in'); const o = i && (c.msgs || []).find((x) => x.t === 'out' && x.at > i.at); if (o) (byName[c.assignee] = byName[c.assignee] || []).push((Date.parse(o.at) - Date.parse(i.at)) / 60000); });
      mem.forEach((m) => { const l = byName[m.name]; if (l && l.length) resp[m.id] = Math.max(0, Math.round(l.reduce((a, b) => a + b, 0) / l.length)); });
    }
    const end = rr.to.slice(0, 7); const keys = [0, 1, 2].map((n) => { const d = new Date(end + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); });
    const scores = {}; mem.forEach((m) => { const sc = HD.scores[m.id] || {}; const o = {}; keys.forEach((k) => { if (sc[k] != null) o[Number(k.replace('-', ''))] = sc[k]; }); scores[m.id] = o; });
    const codes = new Set(mem.map((m) => m.id));
    const tasks = (HD.tasks || []).filter((x) => codes.has(x.member)).map((x) => (x.status === 'اتأجلت' && x.until && x.until <= t ? Object.assign({}, x, { status: 'لسه' }) : x));
    return { mem, rep: R.staffReport({ members: mem, tasks, attendance: absent, todayAbsent, resp, scores, from: rr.from, to: rr.to }), clamped: rr.from < loaded, csOk };
  }
  function StaffReportView() {
    const H = window.IBHR;
    if (!H || H.state() !== 'ready') { rExport = null; return [U.InlineNote({ children: H && H.state() === 'error' ? 'مقدرناش نحمّل بيانات الفريق — حدّث الصفحة.' : 'بنحمّل بيانات الفريق…' })]; }
    const rr = state.rrange; const { mem, rep, clamped, csOk } = staffData(rr); const PER = D.formatDateNumeric(rr.from) + ' – ' + D.formatDateNumeric(rr.to);
    const MON = (n) => { const k = String(n); return (window.IBKit.AR_MON[Number(k.slice(4, 6)) - 1] || '') + ' ' + k.slice(0, 4); };
    const card = (title, sub, rows, val, unit, foot, tone, key, empty) => U.ChartCard({ title, subtitle: sub, footnote: foot, body: rows.length ? h('div', { class: 'staff-top', 'data-staff': key }, rows.map((x) => h('div', { class: 'st-row' }, h('span', { class: 'st-rank', 'aria-hidden': 'true' }, String(x.rank)), U.Avatar ? U.Avatar(x.name) : null, h('span', { class: 'st-who' }, h('b', null, x.name), h('small', { class: 't-small help' }, x.title || '')), h('span', { class: 'st-val ' + tone }, num(val(x)), h('small', { class: 't-small' }, ' ' + unit(x)))))) : U.EmptyState(empty ? empty[0] : 'مفيش بيانات', empty ? empty[1] : 'لسه مفيش تسجيلات في الفترة دي.') });
    rExport = { label: 'تقرير الموظفين', headers: ['التقرير', '#', 'الموظف', 'القيمة'], rows: [].concat(rep.tasks.map((x) => ['مهام مفتوحة', x.rank, x.name, x.open]), rep.absence.map((x) => ['غياب (يوم)', x.rank, x.name, x.days]), rep.fastest.map((x) => ['أسرع رد (دقيقة)', x.rank, x.name, x.minutes]), rep.rating.map((x) => ['تقييم الأداء %', x.rank, x.name, x.score])) };
    const NO_TASKS = ['مفيش مهام مفتوحة', 'كل مهام الفريق خلصت أو اتأجلت.'];
    return [
      h('div', { class: 'cards four', 'data-rgroup': 'kpis' },
        U.KpiTile({ label: 'مهام مفتوحة', value: String(rep.counts.openTasks), unit: 'مهمة', compare: 'off', note: 'على ' + mem.length + ' موظف · من «ملفي › مهامي»' }),
        U.KpiTile({ label: 'أيام غياب', value: String(rep.counts.absentDays), unit: 'يوم', compare: 'off', note: PER + ' · من غير إذن' + (clamped ? ' · آخر 120 يوم بس' : '') }),
        U.KpiTile({ label: 'أسرع رد', value: rep.fastest[0] ? String(rep.fastest[0].minutes) : '—', unit: 'دقيقة', compare: 'off', note: !csOk ? 'محتاج صلاحية خدمة العملاء' : rep.fastest[0] ? rep.fastest[0].name : 'مفيش ردود في الفترة' }),
        U.KpiTile({ label: 'أعلى تقييم أداء', value: rep.rating[0] ? rep.rating[0].score + '%' : '—', compare: 'off', note: rep.rating[0] ? rep.rating[0].name + ' · ' + MON(rep.rating[0].month) : 'لسه مفيش تقييم' })),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        card('أكتر 5 عندهم مهام', 'المهام المفتوحة (لسه · جاري · متوقفة · جاهزة للمراجعة)', rep.tasks, (x) => String(x.open), () => 'مهمة', 'من «ملفي › مهامي» لكل موظف — دلوقتي', 'neutral', 'tasks', NO_TASKS),
        card('أكتر 5 غياب', PER, rep.absence, (x) => String(x.days), () => 'يوم', 'من سجل الحضور: يوم شغل من غير حضور ولا إجازة متوافق عليها + غايب النهارده', 'bad', 'absence')),
      h('div', { class: 'charts', 'data-rgroup': 'charts2' },
        card('أسرع 5 في الرد', 'متوسط أول رد · ' + PER, rep.fastest, (x) => String(x.minutes), () => 'دقيقة', 'محادثات خدمة العملاء اللي اتفتحت في الفترة', 'good', 'fastest', csOk ? null : ['محتاج صلاحية خدمة العملاء', 'وقت الرد بيتحسب من محادثات خدمة العملاء.']),
        card('أعلى 5 تقييم', 'تقييم الأداء الشهري (KPI) · آخر 3 شهور لحد آخر الفترة', rep.rating, (x) => x.score + '%', (x) => MON(x.month) + ' · متوسط ' + Math.round(x.avg) + '%', 'من «الموارد البشرية › الأداء والـ KPI»', 'good', 'rating')),
      h('p', { class: 'source' }, 'المصدر: مهام الفريق («ملفي › مهامي») + سجل الحضور والإجازات والتقييم (الموارد البشرية — ' + mem.length + ' عضو ظاهرين ليك) + محادثات خدمة العملاء لوقت الرد.')];
  }
  // «الحملات الإعلانية» (phase 9.5.3 decision 47): the marketing page's own blocks (marketing.js reportBlocks — Meta Ads' numbers in mkt_ad_stats
  // + the ad orders of mkt_ads_orders) — one source; it draws again when its numbers come
  function CampaignsReportView() {
    const pg = window.IBPages && window.IBPages.all().marketing; const api = pg && pg.api;
    if (!api || !api.reportBlocks) { rExport = null; return [U.EmptyState('تقارير الحملات مش متاحة', 'صفحة التسويق ماتحمّلتش — حدّث الصفحة.')]; }
    const redraw = (n) => { if (state.page !== 'reports' || state.rtab !== 'campaigns') return; if (document.querySelector('.scrim')) { if (n < 30) setTimeout(() => redraw(n + 1), 1000); return; } renderReports(); }; // a popup open: draw once it closes
    const b = api.reportBlocks(() => redraw(0)); rExport = b.exp; return b.blocks;
  }
  // «تقارير المخزن»: IBInventory's hub in K.store (0044) — the same numbers as the stock page's own «التقارير» tab
  function InventoryReportView() {
    const KK = window.IBKit; const S2 = KK.store; const rr = state.rrange; const Inv = window.IBInventory;
    if (Inv && Inv.state() !== 'ready' && !(S2.stock || []).length) { rExport = null; return [U.InlineNote({ children: Inv.state() === 'error' ? 'مقدرناش نحمّل المخزن — حدّث الصفحة.' : 'بنحمّل المخزن…' })]; }
    const now = (KK.stockNow ? KK.stockNow() : []).filter((x) => x.onHand > 0);
    const rep = R.inventoryReport(now, S2.returns || [], (S2.ledger || []).filter((m) => { const d = String(m.at || '').slice(0, 10); return d >= rr.from && d <= rr.to; }));
    // «قطع في المخزن الآن» = the sum of the quantities, like the stock page's own tab (the v2 domain's pieces counts the lots)
    const pieces = now.reduce((n, x) => n + (Number(x.onHand) || 0), 0);
    const since = (x) => (x.since && KK.dshort ? KK.dshort(x.since) : (x.since || '—'));
    const rowsH = ['القطعة', 'المبتكر', 'سبب الدخول', 'الحالة', 'في المخزن', 'المتاح', 'التكلفة', 'من إمتى'];
    const rows = rep.rows.map((x) => [x.name, x.vendor, x.reason, h('span', { class: 'tg tg-neutral' }, x.status), num(String(x.onHand)), num(String(x.available)), num(money(x.cost)), since(x)]);
    rExport = { label: 'مخزن — أعلى قيمة', headers: rowsH, rows: rep.rows.map((x) => [x.name, x.vendor, x.reason, x.status, x.onHand, x.available, x.cost, isoDay(x.since) || x.since]) };
    const maxR = Math.max(1, ...rep.byReason.map((x) => x.count)), maxS = Math.max(1, ...rep.byStatus.map((x) => x.count));
    const bars = (list, max) => (list.length ? h('div', { class: 'bars' }, list.map((x, i) => U.BarRow({ tone: i === 0 ? 'brand' : i === 1 ? 'gold' : 'neutral', label: x.label, value: String(x.count), pct: x.count / max }))) : U.EmptyState('المخزن فاضي', 'مفيش قطع مسجلة.'));
    return [
      h('div', { class: 'cards four', 'data-rgroup': 'kpis' },
        U.KpiTile({ label: 'قطع في المخزن الآن', value: K0(pieces), unit: 'قطعة', compare: 'off', note: K0(now.length) + ' صنف · رصيد اللحظة الحالية — مش متأثر بالفترة', details: () => ({ title: 'قطع في المخزن', sub: 'أعلى 20 بالتكلفة', headers: rowsH, rows, empty: 'المخزن فاضي.' }) }),
        U.KpiTile({ label: 'قيمة المخزن', value: money(rep.value), unit: 'ج.م', compare: 'off', note: 'سعر المبتكر × الكمية' }),
        U.KpiTile({ label: 'مرتجعات مستنية الفحص', value: String(rep.waiting), unit: 'مرتجع', compare: 'off', note: 'من ' + rep.returns + ' مرتجع في السجل' }),
        U.KpiTile({ label: 'حركات المخزن في الفترة', value: K0(rep.moves), unit: 'حركة', compare: 'off', note: D.formatDateNumeric(rr.from) + ' – ' + D.formatDateNumeric(rr.to) + ' · دخول · خروج · نقل' })),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        U.ChartCard({ title: 'سبب دخول القطع', subtitle: 'عدد الأصناف', footnote: 'نفس أرقام «المخزن الآن»', body: bars(rep.byReason, maxR) }),
        U.ChartCard({ title: 'حالة القطع', subtitle: 'عدد الأصناف', footnote: 'الحالة بتتغير من «المخزن الآن» و«المرتجعات»', body: bars(rep.byStatus, maxS) })),
      TableCard({ title: 'أعلى 20 قطعة بالتكلفة', count: rep.rows.length + ' صف',
        body: rep.rows.length ? tableOrList(() => U.Table({ cls: 'rp-inv', headers: rowsH, rows }), () => CardList({ headers: rowsH, titleIndex: 0, rows })) : U.EmptyState('المخزن فاضي', 'أول ما قطعة تدخل المخزن هتظهر هنا.') }),
      h('p', { class: 'source' }, 'المصدر: مخزن إبتكر (الكميات من حركات الدخول والخروج) + سجل المرتجعات · القيمة = سعر المبتكر المسجّل على القطعة.')];
  }
  // «تقارير خدمة العملاء» (a snapshot, no range): IBCS's data — the customers' open conversations (the resolved ones of the last 90 days
  // the adapter keeps for the inbox are left out of the counts), the reply target from the cs settings, the customers from cs_customers_list
  function CsReportView() {
    const CS = window.IBCS; const S2 = CS && CS.data ? CS.data : { convs: [], customers: [], settings: {} };
    if (CS && CS.state() !== 'ready' && !(S2.convs || []).length) { rExport = null; return [U.InlineNote({ children: CS.state() === 'error' ? 'مقدرناش نحمّل خدمة العملاء — حدّث الصفحة.' : 'بنحمّل خدمة العملاء…' })]; }
    const sla = (S2.settings && Number(S2.settings.slaLate)) || 15;
    const rep = R.csReport((S2.convs || []).filter((c) => c.status !== 'اتحلت'), S2.customers || [], sla);
    const topH = ['#', 'العميل', 'الأوردرات', 'إجمالي الشراء', 'متوسط الأوردر'];
    const topRows = rep.top.map((x) => [num(String(x.rank)), x.name, num(String(x.orders)), num(money(x.total)), num(money(x.avg))]);
    rExport = { label: 'أعلى العملاء', headers: topH, rows: rep.top.map((x) => [x.rank, x.name, x.orders, x.total, x.avg]) };
    const probs = (S2.customers || []).filter((x) => x.lateOpen || x.openComplaints);
    const maxSt = Math.max(1, ...rep.byStatus.map((x) => x.count)), maxAg = Math.max(1, ...rep.byAgent.map((x) => x.count));
    return [
      h('div', { class: 'cards four', 'data-rgroup': 'kpis' },
        U.KpiTile({ label: 'محادثات عملاء مفتوحة', value: String(rep.open), unit: 'محادثة', compare: 'off', note: 'من غير محادثات المبتكرين واللي اتحلت' }),
        U.KpiTile({ label: 'مستنية ردنا', value: String(rep.waitingUs), unit: 'محادثة', compare: 'off', note: 'جديدة + مستنية ردنا' }),
        U.KpiTile({ label: 'عدّت هدف الرد', value: String(rep.late), unit: 'محادثة', compare: rep.late ? 'negative' : 'off', delta: rep.late ? { text: 'تحتاج رد', caption: 'عدّت ' + sla + ' دقيقة' } : null, note: 'هدف أول رد ' + sla + ' دقيقة' }),
        U.KpiTile({ label: 'عملاء محتاجين متابعة', value: String(rep.problems), unit: 'عميل', compare: 'off', note: 'أوردر متأخر أو شكوى مفتوحة · من ' + K0(rep.customers) + ' عميل', details: () => ({ title: 'عملاء محتاجين متابعة — ' + probs.length, sub: 'أوردر متأخر أو شكوى مفتوحة', headers: ['العميل', 'أوردرات متأخرة', 'شكاوى مفتوحة', 'الأوردرات'], rows: probs.map((x) => [x.name, num(String(x.lateOpen || 0)), num(String(x.openComplaints || 0)), num(String(x.orders || 0))]), empty: 'مفيش عملاء محتاجين متابعة.' }) })),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        U.ChartCard({ title: 'المحادثات حسب الحالة', subtitle: 'محادثات العملاء المفتوحة', footnote: 'نفس أرقام «الرسايل»', body: rep.byStatus.length ? h('div', { class: 'bars' }, rep.byStatus.map((x, i) => U.BarRow({ tone: /مستنية ردنا|جديدة/.test(x.label) ? 'gold' : i === 0 ? 'brand' : 'neutral', label: x.label, value: String(x.count), pct: x.count / maxSt }))) : U.EmptyState('مفيش محادثات مفتوحة', 'أول ما رسالة تيجي هتظهر هنا.') }),
        U.ChartCard({ title: 'التوزيع على الفريق', subtitle: 'المحادثات المفتوحة لكل موظف', footnote: 'من المسؤول عن كل محادثة في «الرسايل»', body: rep.byAgent.length ? h('div', { class: 'bars' }, rep.byAgent.map((x, i) => U.BarRow({ tone: i === 0 ? 'brand' : i === 1 ? 'gold' : 'neutral', label: x.label, value: String(x.count), pct: x.count / maxAg }))) : U.EmptyState('مفيش توزيع', 'لسه مفيش محادثات متوزعة.') })),
      TableCard({ title: 'أعلى 10 عملاء بالشراء', count: rep.top.length + ' عميل',
        body: rep.top.length ? tableOrList(() => U.Table({ cls: 'rp-cust', headers: topH, rows: topRows }), () => CardList({ headers: topH, titleIndex: 1, rows: topRows })) : U.EmptyState('مفيش عملاء', 'لسه مفيش عميل اشترى.') }),
      h('p', { class: 'source' }, 'المصدر: محادثات خدمة العملاء (المفتوحة دلوقتي) + ملفات العملاء في السيستم (من الأوردرات) · هدف أول رد من إعدادات خدمة العملاء.')];
  }
  // «تقارير التذاكر»: IBTickets (0045) — the tickets of the range by their creation day in Cairo + the v2's cards the member picks
  // (decision 8: up to 8, saved per member in user_prefs tickets.kpis); «عاجل» is the «urgent» priority
  const TK_KPI_MAX = 8, TK_KPI_DEF = ['open', 'urgent', 'overdue', 'avg', 'total', 'resolved', 'reopened', 'toprole'], TK_KPI_PREF = 'tickets.kpis';
  const TK_KPI = [
    { id: 'open', group: 'الحالة دلوقتي', label: 'تذاكر مفتوحة', hint: 'مفتوح + جاري العمل + بانتظار الرد', calc: (c) => ({ value: String(c.d.open.length), unit: 'تذكرة', note: 'كل التذاكر اللي لسه شغالة', details: () => ticketDetails('open') }) },
    { id: 'urgent', group: 'الحالة دلوقتي', label: 'تذاكر عاجلة', hint: 'مفتوحة وأولويتها عاجل', calc: (c) => { const l = c.d.open.filter((t) => t.priority === 'urgent'); return { value: String(l.length), unit: 'تذكرة', compare: l.length ? 'negative' : 'off', delta: l.length ? { text: 'عاجل', caption: 'مفتوحة وأولويتها عاجل' } : null, note: 'مفتوحة وأولويتها عاجل', details: () => ({ title: 'تذاكر عاجلة — ' + l.length, sub: 'مفتوحة وأولويتها عاجل · اضغط على أي تذكرة تفتحها', headers: c.tHead, rows: l.map(c.tRow), onRow: (i) => openTicket(l[i].id), empty: 'مفيش تذاكر عاجلة مفتوحة.' }) }; } },
    { id: 'overdue', group: 'الحالة دلوقتي', label: 'متأخرة عن موعد المتابعة', hint: 'عدّت تاريخ المتابعة ولسه مفتوحة', calc: (c) => ({ value: String(c.sm.overdue), unit: 'تذكرة', compare: c.sm.overdue ? 'negative' : 'off', delta: c.sm.overdue ? { text: 'تحتاج تدخّل', caption: 'عدّت تاريخ المتابعة' } : null, note: 'بتظهر كمان في الجرس', details: () => ticketDetails('overdue') }) },
    { id: 'waiting', group: 'الحالة دلوقتي', label: 'بانتظار الرد', hint: 'مستنية رد العميل أو المبتكر', calc: (c) => { const l = c.d.open.filter((t) => t.status === 'waiting'); return { value: String(l.length), unit: 'تذكرة', note: 'الكورة في ملعب الطرف التاني', details: () => ({ title: 'بانتظار الرد — ' + l.length, sub: 'مستنية رد', headers: c.tHead, rows: l.map(c.tRow), onRow: (i) => openTicket(l[i].id), empty: 'مفيش تذاكر بانتظار الرد.' }) }; } },
    { id: 'untouched', group: 'الحالة دلوقتي', label: 'لسه محدش اشتغل عليها', hint: 'حالتها «مفتوح» — مفيش حد بدأ', calc: (c) => { const l = c.d.open.filter((t) => t.status === 'open'); return { value: String(l.length), unit: 'تذكرة', compare: l.length ? 'negative' : 'off', delta: l.length ? { text: 'محتاجة حد', caption: 'حالتها مفتوح' } : null, note: 'محتاجة حد يمسكها', details: () => ({ title: 'لسه محدش اشتغل عليها — ' + l.length, sub: 'حالتها مفتوح', headers: c.tHead, rows: l.map(c.tRow), onRow: (i) => openTicket(l[i].id), empty: 'كل التذاكر المفتوحة حد ماسكها.' }) }; } },
    { id: 'total', group: 'في الفترة', label: 'تذاكر الفترة', hint: 'اتعملت في الفترة المختارة', calc: (c) => ({ value: String(c.per.length), unit: 'تذكرة', note: D.formatDateNumeric(c.rr.from) + ' – ' + D.formatDateNumeric(c.rr.to), details: () => ({ title: 'تذاكر الفترة — ' + c.per.length, sub: 'اتعملت في الفترة · اضغط على أي تذكرة تفتحها', headers: c.tHead, rows: c.per.map(c.tRow), onRow: (i) => openTicket(c.per[i].id), empty: 'مفيش تذاكر اتعملت في الفترة دي.' }) }) },
    { id: 'resolved', group: 'في الفترة', label: 'نسبة الحل', hint: 'كام تذكرة من تذاكر الفترة اتحلت', calc: (c) => { const n = c.per.filter((t) => t.resolution && t.resolution.at).length; return { value: c.per.length ? Math.round(n / c.per.length * 100) + '%' : '—', note: n + ' من ' + c.per.length + ' تذكرة اتحلت' }; } },
    { id: 'avg', group: 'في الفترة', label: 'متوسط وقت الحل', hint: 'من الإنشاء لـ «تم الحل»', calc: (c) => ({ value: String(c.sm.avgDays), unit: 'يوم', note: 'من ' + c.sm.resolvedCount + ' تذكرة اتحلت', details: () => ticketDetails('avg') }) },
    { id: 'reopened', group: 'في الفترة', label: 'أُعيد فتحها هذا الأسبوع', hint: 'مشكلة رجعت بعد الإغلاق', calc: (c) => ({ value: String(c.sm.reopened), unit: 'تذكرة', compare: c.sm.reopened ? 'negative' : 'off', delta: c.sm.reopened ? { text: 'راجع السبب', caption: 'رجعت بعد الإغلاق' } : null, note: 'إعادة الفتح بتحتاج سبب', details: () => ticketDetails('reopened') }) },
    { id: 'toprole', group: 'التوزيع', label: 'أكتر دور عليه تذاكر', hint: 'الدور المسؤول عن أكبر عدد في الفترة', calc: (c) => ({ value: c.rep.byRole[0] ? c.rep.byRole[0].label : '—', note: c.rep.byRole[0] ? c.rep.byRole[0].count + ' تذكرة' : 'مفيش تذاكر في الفترة' }) },
    { id: 'toptype', group: 'التوزيع', label: 'أكتر نوع', hint: 'عميل / مبتكر / داخلي', calc: (c) => ({ value: c.rep.byType[0] ? c.rep.byType[0].label : '—', note: c.rep.byType[0] ? c.rep.byType[0].count + ' تذكرة في الفترة' : 'مفيش تذاكر في الفترة' }) },
    { id: 'topreason', group: 'التوزيع', label: 'أكتر سبب', hint: 'السبب اللي بيتكرر أكتر', calc: (c) => { const m = {}; c.per.forEach((t) => { if (t.reason) m[t.reason] = (m[t.reason] || 0) + 1; }); const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return { value: top ? top[0] : '—', note: top ? top[1] + ' تذكرة في الفترة' : 'مفيش أسباب مسجلة' }; } },
  ];
  const tkKpiPicked = () => { const p = window.IBPrefs && window.IBPrefs.get(TK_KPI_PREF); const l = Array.isArray(p) ? p.filter((x) => TK_KPI.some((k) => k.id === x)) : []; return l.length ? l.slice(0, TK_KPI_MAX) : TK_KPI_DEF.slice(); };
  const tkPeriod = () => { const rr = state.rrange; return tstore.all().filter((t) => { const d = cairoDayOf(t.createdAt); return d >= rr.from && d <= rr.to; }); };
  const tkRepOf = (per) => R.ticketsReport(per.map((t) => ({ id: t.id, title: t.title, type: typeLabel(t.type), priority: TK.label(TK.PRIORITIES, t.priority), status: t.status, role: t.assigneeRole })));
  function tkKpiCtx(rep, per) {
    const all = tstore.all();
    const tHead = ['التذكرة', 'العنوان', 'النوع', 'الأولوية', 'الحالة', 'المسؤول'];
    const tRow = (t) => [num(t.id), t.title, typeLabel(t.type), U.PriorityTag(t.priority), U.TicketStatus(t.status), t.assigneeRole || '—'];
    return { rr: state.rrange, all, per, rep, sm: TK.summary(all, TODAY), d: TK.summaryDetails(all, TODAY), tHead, tRow };
  }
  // the card picker (the v2's KpiPickerModal): up to 8, each choice beside its value now; saved per member
  function tkKpiPicker(done) {
    const per = tkPeriod(); const ctx = tkKpiCtx(tkRepOf(per), per); const pv = {}; TK_KPI.forEach((k) => { try { const v = k.calc(ctx); pv[k.id] = (v.value || '') + (v.unit ? ' ' + v.unit : ''); } catch (e) { /* no preview */ } });
    const sel = tkKpiPicked(); let m = null;
    const draw = () => { const full = sel.length >= TK_KPI_MAX; const groups = [...new Set(TK_KPI.map((k) => k.group))];
      m.setBody(h('div', { class: 'kpi-pick', 'data-kpi-pick': 'tickets' },
        h('p', { class: 't-small help', style: 'margin:0' }, 'اختار لحد ' + TK_KPI_MAX + ' كروت — بتتعرض على سطرين بالترتيب اللي بتختاره. ', h('b', { 'data-kpi-count': String(sel.length) }, 'مختار ' + sel.length + ' من ' + TK_KPI_MAX)),
        groups.map((g) => h('fieldset', { class: 'blk' }, h('legend', null, g), h('div', { class: 'kpi-pick-grid' }, TK_KPI.filter((k) => k.group === g).map((k) => { const on = sel.includes(k.id); const dis = !on && full;
          return h('button', { type: 'button', role: 'checkbox', class: 'kpi-opt' + (on ? ' on' : ''), 'aria-checked': String(on), 'data-kpi': k.id, disabled: dis || null, onClick: () => { const i = sel.indexOf(k.id); if (i > -1) sel.splice(i, 1); else if (sel.length < TK_KPI_MAX) sel.push(k.id); draw(); } },
            h('span', { class: 'mchk', 'aria-hidden': 'true' }, on ? Icon('check', 'sm') : null), h('span', { class: 'kpi-opt-t' }, h('b', null, k.label, on ? h('small', { class: 'kpi-ord' }, ' #' + (sel.indexOf(k.id) + 1)) : null), h('span', { class: 't-small help' }, k.hint)), h('span', { class: 'kpi-opt-v' }, pv[k.id] || '')); }))))));
    };
    m = U.Modal({ title: 'تخصيص تقارير التذاكر', body: [], footer: [] }); m.el.classList.add('wide');
    m.setFooter(Button({ type: 'text', label: 'رجوع للافتراضي', attrs: { 'data-kpi-reset': '' }, onClick: () => { sel.splice(0, sel.length, ...TK_KPI_DEF); draw(); } }), h('span', { class: 'grow' }), Button({ label: 'إلغاء', onClick: () => m.close() }),
      Button({ type: 'primary', label: 'احفظ', attrs: { 'data-kpi-save': '' }, onClick: () => { if (!sel.length) { window.IBKit.toast('اختار كارت واحد على الأقل', 'error'); return; } if (window.IBPrefs) window.IBPrefs.set(TK_KPI_PREF, sel.slice()); m.close(); window.IBKit.toast('اتحفظ — ' + sel.length + ' كروت', 'success'); if (done) done(); } }));
    draw();
  }
  function TicketsReportView() {
    const T = TA(); if (T && T.state() !== 'ready' && !tstore.all().length) { rExport = null; return [U.InlineNote({ children: T.state() === 'error' ? 'مقدرناش نحمّل التذاكر — حدّث الصفحة.' : 'بنحمّل التذاكر…' })]; }
    const per = tkPeriod(); const rep = tkRepOf(per); const byId = new Map(per.map((t) => [t.id, t]));
    const rowsH = ['التذكرة', 'الموضوع', 'النوع', 'الأولوية', 'الحالة', 'الدور المسؤول'];
    const rows = rep.rows.map((x) => [h('span', { dir: 'ltr', class: 't-small' }, x.id), x.title, x.type, U.PriorityTag((byId.get(x.id) || {}).priority), U.TicketStatus(x.status), x.role]);
    rExport = { label: 'تذاكر مفتوحة', headers: rowsH, rows: rep.rows.map((x) => [x.id, x.title, x.type, x.priority, TK.label(TK.STATUSES, x.status), x.role]) };
    const maxT = Math.max(1, ...rep.byType.map((x) => x.count)), maxR = Math.max(1, ...rep.byRole.map((x) => x.count));
    const ctx = tkKpiCtx(rep, per); const picked = tkKpiPicked();
    return [
      h('div', { class: 'cards four', 'data-rgroup': 'kpis', 'data-tk-kpis': String(picked.length) }, picked.map((id) => { const k = TK_KPI.find((x) => x.id === id); let v = null; try { v = k && k.calc(ctx); } catch (e) { v = null; } return v ? U.KpiTile(Object.assign({ compare: 'off' }, v, { label: k.label })) : null; }).filter(Boolean)),
      h('div', { class: 'charts', 'data-rgroup': 'charts' },
        U.ChartCard({ title: 'التذاكر حسب النوع', subtitle: 'التذاكر اللي اتعملت في الفترة', footnote: 'عميل · مبتكر · داخلي', body: rep.byType.length ? h('div', { class: 'bars' }, rep.byType.map((x, i) => U.BarRow({ tone: i === 0 ? 'brand' : i === 1 ? 'gold' : 'neutral', label: x.label, value: String(x.count), pct: x.count / maxT }))) : U.EmptyState('مفيش تذاكر', 'مفيش تذاكر اتعملت في الفترة دي.') }),
        U.ChartCard({ title: 'التذاكر حسب الدور', subtitle: 'الدور المسؤول', footnote: 'من «تذاكر الفريق»', body: rep.byRole.length ? h('div', { class: 'bars' }, rep.byRole.map((x, i) => U.BarRow({ tone: i === 0 ? 'brand' : i === 1 ? 'gold' : 'neutral', label: x.label, value: String(x.count), pct: x.count / maxR }))) : U.EmptyState('مفيش تذاكر', 'مفيش تذاكر اتعملت في الفترة دي.') })),
      TableCard({ title: 'تذاكر مفتوحة', count: rep.rows.length + ' تذكرة · من تذاكر الفترة',
        body: rep.rows.length ? tableOrList(() => U.Table({ cls: 'rp-tk', headers: rowsH, rows }), () => CardList({ headers: rowsH, titleIndex: 1, rows })) : U.EmptyState('مفيش تذاكر مفتوحة', 'كل تذاكر الفترة اتحلت أو اتقفلت.') }),
      h('p', { class: 'source' }, 'المصدر: تذاكر الفريق في السيستم · «في الفترة» بتاريخ فتح التذكرة بتوقيت القاهرة · «الحالة دلوقتي» كل التذاكر اللي شايفها.')];
  }
  const RVIEWS = { orders: OrdersReportView, vendors: VendorsReportView, accounts: AccountsReportView, products: ProductsReportView, staff: StaffReportView, campaigns: CampaignsReportView, inventory: InventoryReportView, cs: CsReportView, tickets: TicketsReportView };
  // the reports that show the moment (no range — owner 31 Oct: a date filter has to change what is shown)
  const SNAP_TABS = { cs: 'أرقام المحادثات والعملاء دلوقتي — من غير فلتر تاريخ' };
  // «الإجراءات» offers the sheets of the pages the member sees (the rows come under their RLS anyway)
  const RSHEET_PERM = { orders: 'orders.view', vendors: 'vendors.view', expenses: 'accounts.view', transport: 'accounts.view' };
  const reportSheets = () => window.IBDataActions.PAGES.reports.filter((id) => !RSHEET_PERM[id] || rperm(RSHEET_PERM[id]) !== 'N');
  function renderReports() {
    if (state.page === 'vendors' && state.vtab === 'reports') { renderVendors(); return; } // phase 13 decision 57: the makers report inside the makers page
    if (state.page === 'accounts' && state.tab === 'acc-reports') { render(); return; } // phase 13 decision 61: the accounts report inside the accounts page
    U.closePopover();
    const main = document.getElementById('reports'); if (!main) return; const sc = window.scrollY;
    const note = state.rnote; state.rnote = null;
    const list = reportTabs();
    if (!list.length) { rExport = null; main.replaceChildren(h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'التقارير'))), U.EmptyState('مش مسموحلك تشوف التقارير', 'اطلب صلاحية «التقارير» من الأدمن.')); return; }
    if (!list.some((t) => t.id === state.rtab)) { state.rtab = list[0].id; try { history.replaceState(null, '', '#reports-' + state.rtab); } catch (e) { /* sandboxed */ } }
    const tab = list.find((t) => t.id === state.rtab); const soon = !!tab.soon; const snap = SNAP_TABS[state.rtab];
    const tabs = U.Tabs({ items: list.map((t) => ({ id: t.id, label: t.soon ? [t.label, ' ', h('span', { class: 'soon', 'data-soon': '' }, 'قريبًا')] : t.label })), active: state.rtab, onChange: (id, viaKey) => { state.rtab = id; try { history.replaceState(null, '', '#reports-' + id); } catch (e) { /* sandboxed */ } focusTab = !!viaKey; renderReports(); } });
    tabs.setAttribute('aria-label', 'أقسام التقارير');
    const body = RVIEWS[state.rtab]();
    const exp = rCanExport();
    const noteEl = note ? U.InlineNote({ kind: note.kind, children: note.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => { noteEl.remove(); } }) }) : null;
    const kpiCustom = state.rtab === 'tickets' ? () => tkKpiPicker(renderReports) : state.rtab === 'products' ? () => { const api = (window.IBPages.all().products || {}).api; if (rpProdCtx && api && api.kpiPicker) api.kpiPicker(rpProdCtx, renderReports); else window.IBKit.toast('استنى التقارير تتحسب الأول', 'error'); } : null;
    main.replaceChildren(...[
      h('div', { class: 'page-head row' },
        h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'التقارير'), U.FreshnessNote(freshness())),
        h('div', { class: 'actions' }, soon ? null : snap ? h('span', { class: 't-small help', 'data-snapshot': '' }, snap) : DateRangeField('reports'),
          exp && reportSheets().length ? window.IBDataActions.Menu(reportSheets(), () => ({ vendors: 'vendors', accounts: 'expenses' }[state.rtab] || 'orders')) : null,
          soon || snap ? null : Button({ type: state.rcompare ? 'primary' : 'default', label: 'مقارنة بالفترة السابقة', attrs: { 'aria-pressed': String(state.rcompare) }, onClick: () => { state.rcompare = !state.rcompare; renderReports(); } }),
          exp && !soon ? Button({ label: 'نسخ CSV', icon: 'download', disabled: !rExport, attrs: { 'data-rp-csv': '' }, onClick: () => rExport && csvCopy(rExport.headers, rExport.rows, rExport.label) }) : null,
          kpiCustom ? Button({ label: 'تخصيص اللوحة', icon: 'sliders', attrs: { 'data-kpi-custom': state.rtab }, onClick: kpiCustom }) : null,
          soon ? null : Button({ label: 'تخصيص التقارير', icon: 'sliders', attrs: { 'data-rp-custom': '' }, onClick: () => customizeReports() }))),
      tabs,
      noteEl,
      h('div', { id: 'rpanel', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.rtab, style: 'display:flex;flex-direction:column;gap:24px;min-width:0' }, body)].filter(Boolean));
    applyReportPrefs(main.querySelector('#rpanel'));
    window.IBKit.sweepColumns(main);
    window.scrollTo(0, sc);
    if (focusTab) { const t = main.querySelector('[role=tab][aria-selected=true]'); if (t) t.focus(); focusTab = false; }
  }

  // ---------- «تخصيص التقارير» (the v2's — like «تخصيص اللوحة»): per tab, which reports show and their order. Decision 8: saved per
  // member in user_prefs reports.prefs = { <tab>: { order: [titles], hidden: [titles] } } (never written at sign-in) ----------
  const RP_PREF = 'reports.prefs';
  const rpAll = () => { const p = window.IBPrefs && window.IBPrefs.get(RP_PREF); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; };
  const rpPrefs = (tab) => { const x = rpAll()[tab]; return x && Array.isArray(x.order) && Array.isArray(x.hidden) ? x : { order: [], hidden: [] }; };
  const rpSave = (tab, val) => { const all = Object.assign({}, rpAll()); if (val) all[tab] = val; else delete all[tab]; if (window.IBPrefs) window.IBPrefs.set(RP_PREF, all); };
  function reportItems(panel) {
    const out = [];
    [...panel.children].forEach((blk) => {
      if (blk.classList.contains('source') || blk.classList.contains('rp-allhidden') || blk.classList.contains('note')) return;
      // the id carries the kind: a card and a table may share a title («تذاكر مفتوحة», «منتجات نفد مخزونها») — one must not move or hide the other
      if (blk.classList.contains('cards') || blk.classList.contains('charts')) [...blk.children].forEach((c) => { const l = (c.querySelector('.kpi-label,.chart-head h2') || {}).textContent; const kind = c.classList.contains('kpi') ? 'رقم' : 'رسم'; if (l) out.push({ id: kind + ' · ' + l.trim(), label: l.trim(), kind, el: c, blk }); });
      else { const l = (blk.querySelector('.table-title h2,.sec-h h2') || {}).textContent; if (l) out.push({ id: 'جدول · ' + l.trim().split(' — ')[0], label: l.trim(), kind: 'جدول', el: blk, blk }); }
    });
    return out;
  }
  function applyReportPrefs(panel) {
    if (!panel) return; const p = rpPrefs(state.rtab); const items = reportItems(panel); if (!items.length) return;
    const idx = (id) => { const i = p.order.indexOf(id); return i < 0 ? 1000 + items.findIndex((x) => x.id === id) : i; };
    const blocks = [...new Set(items.map((x) => x.blk))];
    blocks.forEach((b) => { items.filter((x) => x.blk === b && x.el !== b).sort((a, c) => idx(a.id) - idx(c.id)).forEach((x) => b.append(x.el)); });
    const src = panel.querySelector(':scope > .source'); const minIdx = (b) => Math.min(...items.filter((x) => x.blk === b).map((x) => idx(x.id)));
    blocks.sort((a, b) => minIdx(a) - minIdx(b)).forEach((b) => panel.append(b)); if (src) panel.append(src);
    items.forEach((x) => { x.el.hidden = p.hidden.includes(x.id); });
    blocks.forEach((b) => { const kids = items.filter((x) => x.blk === b && x.el !== b); if (kids.length) b.hidden = kids.every((x) => x.el.hidden); });
    if (!items.some((x) => !x.el.hidden)) { const e = U.EmptyState('كل التقارير في التاب ده مخفية', 'افتح «تخصيص التقارير» واختار اللي يظهر.'); e.classList.add('rp-allhidden'); panel.prepend(e); }
  }
  function customizeReports() {
    const tab = state.rtab; const panel = document.querySelector('#reports #rpanel'); if (!panel) return; const p = rpPrefs(tab);
    const all = reportItems(panel); if (!all.length) { window.IBKit.toast('مفيش تقارير تتخصص في التاب ده لسه', 'error'); return; }
    const idx = (id) => { const i = p.order.indexOf(id); return i < 0 ? 1000 + all.findIndex((x) => x.id === id) : i; };
    const tabL = (REPORT_TABS.find((t) => t.id === tab) || {}).label;
    const list = all.slice().sort((a, b) => idx(a.id) - idx(b.id)).map((x) => ({ id: x.id, label: x.label, kind: x.kind, hidden: p.hidden.includes(x.id) }));
    const KK = window.IBKit;
    KK.form({ title: 'تخصيص التقارير — ' + tabL, wide: true, values: { list },
      note: U.InlineNote({ children: 'اختار التقارير اللي تظهر في «' + tabL + '» ورتّبها بالسحب من المسكة اللي جنب الاسم. التخصيص بيتحفظ ليك انت بس، ولكل تاب لوحده.' }),
      fields: (f, e, set) => { const wrap = h('div', { class: 'dash-cust', role: 'list' }, f.list.map((c, i) => h('div', { class: 'dc-row', role: 'listitem', 'data-rp-item': c.id },
        KK.Grip(c.label),
        h('span', { class: 'dc-l' }, h('b', null, c.label), h('small', { class: 't-small help' }, c.kind)),
        KK.Switch({ id: 'rpc-' + i, label: c.label, checked: !c.hidden, onChange: (v) => { c.hidden = !v; set('list', f.list.slice(), true); } }))));
        KK.sortableRows(wrap, 'data-rp-item', (ids) => set('list', ids.map((id) => f.list.find((x) => x.id === id)).filter(Boolean), true)); // the grips listen right away (phase 10 decision 22)
        return [wrap, e.list ? U.InlineNote({ kind: 'error', children: e.list }) : null]; },
      validate: (f) => (f.list.some((c) => !c.hidden) ? {} : { list: 'سيب تقرير واحد على الأقل ظاهر' }),
      extraFooter: (f, m) => h('span', { class: 'rp-del' }, Button({ type: 'text', label: 'رجوع للافتراضي', attrs: { 'data-rp-reset': '' }, onClick: () => { rpSave(tab, null); KK.toast('رجعت التقارير للافتراضي'); m.close(); renderReports(); } })),
      submitLabel: 'حفظ', submit: (f) => { rpSave(tab, { order: f.list.map((c) => c.id), hidden: f.list.filter((c) => c.hidden).map((c) => c.id) }); KK.logEvent('reports.customize', tabL + ' · ' + f.list.filter((c) => !c.hidden).length + ' تقرير'); KK.toast('اتحفظ تخصيص التقارير', 'success'); renderReports(); } });
  }

  // ---------- Team tickets «تذاكر الفريق» (Figma page 180:4669: تذاكر الفريق — Desktop 1440; Modal / New ticket; Drawer / Ticket; Resolve; Reopen) ----------
  // Phase 8 (docs/superpowers/plans/2026-11-05-phase-8-tickets.md, decision 6): the v2 page on real data — the tickets come from
  // IBTickets (app/js/adapter/tickets.js, 0045) in block 05's shapes; every change goes through its RPCs (the server applies the
  // domain's rules: the role works, the opener closes / reopens, a closed ticket takes no reply) and comes back as { ok, message }.
  // The buttons follow IBTickets.canWork / canClose (the member's ticket roles — ops holds «اللوجستيك والشحن» and «المحتوى والتصوير»).
  // Attachments (decision 2): images / PDF, ≤ 10, 10 MB each, uploaded into the bucket «tickets» before the ticket / reply is sent.
  // The reports tab is in the page (the v2 kit's reportTab / PanelButton are not in ours). No delete (decision 13).
  const TK = window.IbtekrTickets;
  const TA = () => window.IBTickets || null;
  const ME = { get name() { return TA() ? TA().actor().name : ACTOR; }, get role() { return TA() ? TA().actor().role : TK.ADMIN_ROLE; } };
  const tstore = { all: () => (TA() ? TA().all() : []), get: (id) => (TA() ? TA().get(id) : null), events: (id) => (TA() ? TA().events(id) : []) };
  const tCanWork = (t) => !!TA() && TA().canWork(t); const tCanClose = (t) => !!TA() && TA().canClose(t);
  const tCanManage = () => !!TA() && TA().can().manage;
  const csApi = () => { const p = window.IBPages && window.IBPages.all ? window.IBPages.all().cs : null; return p && p.api ? p.api : null; }; // decision 11: «فتح المحادثة»
  const offline = { ok: false, message: 'تعذّر الاتصال — جرّب تاني' };
  state.tfilter = { status: 'open_any', type: 'all', priority: 'all', role: 'all', mine: false, q: '' };
  // فلتر + ترتيب جنب زرار الأعمدة (owner 1 Nov) — اختيارات متعددة، والافتراضي «مفتوحة»
  state.tf = { status: ['open_any'], type: [], priority: [], role: [], mine: [] }; state.tsort = 'prio'; state.tsub = 'overview'; // the owner 11 Nov: «نظرة عامة» first
  const TSORTS = [['prio', 'الأولوية ثم آخر تحديث'], ['upd', 'آخر تحديث'], ['new', 'الأحدث إنشاءً'], ['old', 'الأقدم إنشاءً'], ['follow', 'أقرب موعد متابعة']];
  const tMatch = (t, f) => (!f.status.length || f.status.some((v) => (v === 'open_any' ? TK.OPEN.has(t.status) : t.status === v))) && (!f.type.length || f.type.includes(t.type)) && (!f.priority.length || f.priority.includes(t.priority)) && (!f.role.length || f.role.includes(t.assigneeRole)) && (!f.mine.length || (TA() && TA().isMine(t)));
  const tSort = (l) => { const k = state.tsort; const c = (x, y) => (x < y ? -1 : x > y ? 1 : 0); if (k === 'upd') return l.sort((a, b) => c(b.lastUpdate, a.lastUpdate)); if (k === 'new') return l.sort((a, b) => c(b.createdAt, a.createdAt)); if (k === 'old') return l.sort((a, b) => c(a.createdAt, b.createdAt)); if (k === 'follow') return l.sort((a, b) => c(a.followUp || '9999', b.followUp || '9999')); return l; };
  state.tpage = 1; const TPAGE = 8;
  const typeLabel = (t) => TK.label(TK.TYPES, t);
  const roleOpts = (allLabel) => [].concat(allLabel ? [{ value: 'all', label: allLabel }] : [], TK.ROLES.map((r) => ({ value: r, label: r })));
  const cairoParts = (iso) => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return null; const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute }; };
  const fmtTime = (iso) => { const p = cairoParts(iso); if (!p) return ''; return p.day === TODAY ? 'اليوم ' + p.hm : D.formatDateLong(p.day) + ' ' + p.hm; };
  const dayOf = (iso) => { const p = cairoParts(iso); return p ? p.day : ''; };
  const orderCtx = (id) => { if (!id || !window.OrdersApp || !window.OrdersApp.query) return null; try { const r = window.OrdersApp.query({ q: id }, 1).rows.find((x) => String(x.id) === String(id)); return r || null; } catch (e) { return null; } };
  function ticketTasks() { return TK.filterTickets(tstore.all(), { status: 'open_any' }).filter((t) => (t.followUp && t.followUp < TODAY) || t.reopenCount > 0).map((t) => ({ id: t.id, role: t.assigneeRole, title: t.title, prio: t.priority, sub: t.followUp && t.followUp < TODAY ? 'عدّى موعد المتابعة ' + D.formatDateNumeric(t.followUp) : 'أُعيد فتحه ×' + t.reopenCount })); }
  function showTickets() { if (state.page !== 'tickets') go('tickets'); }
  let tnote = null;
  const notify = (kind, text) => { tnote = { kind, text }; renderTickets(); };
  // the page follows the adapter: a load / a write / a live ping redraws it (and the open drawer)
  let drawerRedraw = null;
  document.addEventListener('ib:tickets', () => { if (state.page === 'tickets') renderTickets(); if (drawerRedraw) drawerRedraw(); document.dispatchEvent(new CustomEvent('ib:notify')); }); // decision 9: the bell recounts

  // ----- attachments (decision 2): a picker that uploads into the member's folder and keeps the files for the ticket / reply -----
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';
  const isImg = (f) => /^image\//.test(f.type || '');
  function openFile(f) { if (!TA()) return; TA().fileUrl(f.path).then((url) => { if (url) window.open(url, '_blank', 'noopener'); else notify('error', 'تعذّر فتح الملف.'); }); }
  function FileChips(files, onRemove) {
    return h('div', { class: 'tk-files' }, files.map((f, i) => {
      const chip = h('span', { class: 'chip tk-file', title: f.name }, Icon(isImg(f) ? 'image' : 'file', 'sm'), h('button', { type: 'button', class: 'linkish', onClick: () => openFile(f), 'aria-label': 'افتح ' + f.name }, f.name));
      if (onRemove) chip.append(IconButton({ icon: 'close', label: 'شيل ' + f.name, onClick: () => onRemove(i) }));
      return chip; }));
  }
  function Thumbs(files) {
    if (!files || !files.length) return null;
    return h('div', { class: 'tk-files' }, files.map((f) => {
      if (!isImg(f)) return h('button', { type: 'button', class: 'chip tk-file', onClick: () => openFile(f), title: f.name }, Icon('file', 'sm'), f.name);
      const img = h('img', { alt: f.name, class: 'tk-thumb', loading: 'lazy' });
      if (TA()) TA().fileUrl(f.path).then((url) => { if (url) img.src = url; });
      return h('button', { type: 'button', class: 'tk-thumb-btn', onClick: () => openFile(f), 'aria-label': 'افتح ' + f.name }, img); }));
  }
  // the picker: a hidden input, uploads one by one, reports what was refused; files = the caller's array (kept between redraws)
  function AttachPicker(files, redraw) {
    const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, 'data-tk-file': '' });
    const msg = h('span', { class: 't-small', 'aria-live': 'polite' });
    input.addEventListener('change', async () => {
      const list = [...(input.files || [])]; input.value = ''; if (!list.length || !TA()) return;
      const room = TA().MAX_FILES - files.length; if (room <= 0) { msg.textContent = 'أقصى عدد ' + TA().MAX_FILES + ' ملفات.'; return; }
      const bad = []; msg.textContent = 'بيترفع…';
      for (const file of list.slice(0, room)) { const r = await TA().upload(file); if (r.ok) files.push(r.file); else bad.push(file.name + ': ' + r.message); }
      if (list.length > room) bad.push('اتشال ' + (list.length - room) + ' — أقصى عدد ' + TA().MAX_FILES + ' ملفات');
      redraw(bad.length ? bad.join(' · ') : '');
    });
    const btn = Button({ label: 'إضافة صورة أو ملف', icon: 'attach', disabled: !tCanManage() || files.length >= ((TA() && TA().MAX_FILES) || 10), onClick: () => input.click() });
    return { el: h('div', { class: 'tk-attach' }, btn, input, files.length ? FileChips(files, (i) => { files.splice(i, 1); redraw(''); }) : null, msg), msg };
  }

  // ----- the reports tab (the v2's KPI tiles moved here) -----
  function ticketDetails(k) {
    const all = tstore.all(); const sum = TK.summary(all, TODAY); const d = TK.summaryDetails(all, TODAY); const oT = (l) => (i) => openTicket(l[i].id);
    const tHead = ['التذكرة', 'العنوان', 'النوع', 'الأولوية', 'الحالة', 'المسؤول', 'المتابعة'];
    const tRow = (t) => [num(t.id), t.title, typeLabel(t.type), U.PriorityTag(t.priority), U.TicketStatus(t.status), t.assigneeRole || '—', t.followUp ? num(D.formatDateNumeric(t.followUp)) : '—'];
    if (k === 'open') return { title: 'التذاكر المفتوحة — ' + d.open.length, sub: 'مفتوح + جاري العمل + بانتظار الرد · اضغط على أي تذكرة تفتحها', summary: TK.TYPES.map(([v, l]) => ({ label: l, value: String(d.open.filter((t) => t.type === v).length) })), headers: tHead, rows: d.open.map(tRow), onRow: oT(d.open) };
    if (k === 'overdue') return { title: 'تذاكر متأخرة عن موعد المتابعة — ' + d.overdue.length, sub: 'عدّت تاريخ المتابعة ولسه مفتوحة', summary: [{ label: 'متأخرة', value: String(d.overdue.length) }, { label: 'من المفتوحة', value: String(d.open.length) }], empty: 'مفيش تذاكر عدّت موعد المتابعة.', headers: tHead, rows: d.overdue.map(tRow), onRow: oT(d.overdue) };
    if (k === 'reopened') return { title: 'تذاكر اتفتحت تاني الأسبوع ده — ' + d.reopened.length, sub: 'مشكلة رجعت بعد الإغلاق — راجع السبب', summary: [{ label: 'اتفتحت تاني', value: String(d.reopened.length) }, { label: 'اتقفلت بالحل (الكل)', value: String(d.resolved.length) }], empty: 'مفيش تذاكر اتفتحت تاني الأسبوع ده.', headers: tHead.concat(['مرات الفتح']), rows: d.reopened.map((t) => tRow(t).concat([String(t.reopenCount)])), onRow: oT(d.reopened) };
    return { title: 'متوسط وقت الحل — ' + sum.avgDays + ' يوم', sub: 'من الإنشاء لـ «تم الحل» · ' + d.resolved.length + ' تذكرة', summary: [{ label: 'المتوسط', value: sum.avgDays + ' يوم' }, { label: 'أطول', value: d.resolved.length ? d.resolved[0].days + ' يوم' : '—' }], headers: ['التذكرة', 'العنوان', 'النوع', 'وقت الحل'], rows: d.resolved.map((t) => [num(t.id), t.title, typeLabel(t.type), num(t.days + ' يوم')]), onRow: oT(d.resolved) };
  }
  function TicketsReport() {
    const all = tstore.all(); const sum = TK.summary(all, TODAY); const open = all.filter((t) => TK.OPEN.has(t.status));
    const by = (key, keys, label) => { const rows = keys.map((k) => { const of = all.filter((t) => t[key] === k[0]); const o = of.filter((t) => TK.OPEN.has(t.status)); return [k[1], num(String(o.length)), num(String(o.filter((t) => t.followUp && t.followUp < TODAY).length)), num(String(of.filter((t) => t.status === 'resolved' || t.status === 'closed').length)), num(String(of.length))]; });
      return TableCard({ title: label, count: all.length + ' تذكرة', body: h('div', { class: 'scroll-x' }, h('table', { class: 'tickets-table' }, h('thead', null, h('tr', null, [label.replace('حسب ', ''), 'مفتوحة', 'متأخرة', 'اتحلت / اتقفلت', 'الكل'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))))) }); };
    return [
      h('div', { class: 'cards' },
        U.KpiTile({ label: 'تذاكر مفتوحة', value: String(sum.open), unit: 'تذكرة', compare: 'off', note: 'مفتوح + جاري العمل + بانتظار الرد', details: () => ticketDetails('open') }),
        U.KpiTile({ label: 'متأخرة عن موعد المتابعة', value: String(sum.overdue), unit: 'تذكرة', compare: sum.overdue ? 'negative' : 'off', delta: { text: 'تحتاج تدخّل', caption: 'عدّت تاريخ المتابعة ولسه مفتوحة' }, note: 'بتظهر كمان في الجرس', details: () => ticketDetails('overdue') }),
        U.KpiTile({ label: 'متوسط وقت الحل', value: String(sum.avgDays), unit: 'يوم', compare: 'off', note: 'من الإنشاء لـ «تم الحل» · ' + sum.resolvedCount + ' تذكرة', details: () => ticketDetails('avg') }),
        U.KpiTile({ label: 'أُعيد فتحها هذا الأسبوع', value: String(sum.reopened), unit: 'تذكرة', compare: sum.reopened ? 'negative' : 'off', delta: { text: 'راجع السبب', caption: 'مشكلة رجعت بعد الإغلاق' }, note: 'إعادة الفتح بتحتاج سبب وبترجع لنفس المسؤول', details: () => ticketDetails('reopened') })),
      by('assigneeRole', TK.ROLES.map((r) => [r, r]), 'حسب المسؤول'),
      by('type', TK.TYPES, 'حسب النوع'),
      open.length ? null : U.InlineNote({ children: 'مفيش تذاكر مفتوحة دلوقتي.' })];
  }

  // ----- «نظرة عامة» (the owner 11 Nov — «اضافة النظرة العامة ف طلبات الفريق و يبقي فيها عدد الطلبات و انواع الطلبات و مين اكتر حد ف الفريق
  // عنده شغل»): the counts, the requests by type and by status, and who carries the work — each active member with the open requests on
  // their role (a request goes to a role, phase 8 decision 3: the members of one role share its queue) and what they solved this month
  function TicketsOverview() {
    const K3 = window.IBKit; const all = tstore.all(); const open = all.filter((t) => TK.OPEN.has(t.status)); const sum = TK.summary(all, TODAY);
    const month = TODAY.slice(0, 7); const weekAgo = new Date(Date.parse(TODAY + 'T00:00:00Z') - 6 * 864e5).toISOString().slice(0, 10);
    const solvedAt = (t) => String((t.resolution && t.resolution.at) || t.closedAt || '');
    const newWeek = all.filter((t) => String(t.createdAt || '').slice(0, 10) >= weekAgo).length;
    const doneMonth = all.filter((t) => (t.status === 'resolved' || t.status === 'closed') && solvedAt(t).slice(0, 7) === month).length;
    // the kinds as «طلب جديد» names them (decision 66): the problems by type; an HR request's ticket by its title («طلب إجازة — …»,
    // «وقت إضافي — …» — 0071 / 0077 / 0069); any other internal one is «طلب خاص»
    const kindOf = (t) => { if (t.type === 'customer') return 'مشكلة عميل'; if (t.type === 'vendor') return 'مشكلة مبتكر';
      const p = String(t.title || '').split(' — ')[0].trim(); return p.length <= 30 && (/^طلب \S/.test(p) || p === 'وقت إضافي') ? p : 'طلب خاص'; };
    const kinds = new Map(); all.forEach((t) => { const k = kindOf(t); const r = kinds.get(k) || { l: k, open: 0, all: 0 }; r.all += 1; if (TK.OPEN.has(t.status)) r.open += 1; kinds.set(k, r); });
    const types = [...kinds.values()].sort((a, b) => b.open - a.open || b.all - a.all || a.l.localeCompare(b.l, 'ar'));
    const maxType = Math.max(1, ...types.map((x) => x.open));
    const sts = TK.STATUSES.map(([v, l]) => ({ l, n: all.filter((t) => t.status === v).length })); const maxSt = Math.max(1, ...sts.map((x) => x.n));
    const D = window.IBDirectory; const rolesOf = TA() && TA().rolesOf ? TA().rolesOf : () => [];
    const people = (D && D.members ? D.members() : []).filter((m) => m && m.status === 'active' && m.roleId).map((m) => { const roles = rolesOf(m.roleId);
      return { name: m.name, roles, open: open.filter((t) => roles.includes(t.assigneeRole)).length, done: all.filter((t) => t.resolution && t.resolution.by === m.name && solvedAt(t).slice(0, 7) === month).length }; })
      .filter((p) => p.roles.length).sort((a, b) => b.open - a.open || b.done - a.done || String(a.name).localeCompare(String(b.name), 'ar'));
    const maxP = Math.max(1, ...people.map((p) => p.open));
    const none = (t) => [h('div', { class: 't-small help' }, t)];
    return [
      h('div', { class: 'cards five', 'data-tk-ov': '' },
        K3.Stat('طلبات مفتوحة', String(open.length), 'طلب', 'مفتوح + جاري العمل + بانتظار الرد', 'off'),
        K3.Stat('متأخرة عن المتابعة', String(sum.overdue), 'طلب', 'عدّت تاريخ المتابعة ولسه مفتوحة', sum.overdue ? 'negative' : 'off'),
        K3.Stat('جديدة آخر 7 أيام', String(newWeek), 'طلب', 'اتفتحت الأسبوع ده', 'off'),
        K3.Stat('اتحلت الشهر ده', String(doneMonth), 'طلب', 'تم الحل أو اتقفلت', 'off'),
        K3.Stat('كل الطلبات', String(all.length), 'طلب', 'متوسط وقت الحل ' + sum.avgDays + ' يوم', 'off')),
      h('div', { class: 'grid3' },
        K3.Section('الطلبات حسب النوع', types.length ? types.map((x) => U.BarRow({ tone: 'brand', label: x.l, value: x.open + ' مفتوح · ' + x.all + ' الكل', pct: x.open / maxType })) : none('لسه مفيش طلبات'), null, { sub: 'المفتوح من كل نوع', cols: false }),
        K3.Section('الطلبات حسب الحالة', sts.map((x) => U.BarRow({ tone: 'brand', label: x.l, value: String(x.n), pct: x.n / maxSt })), null, { sub: all.length + ' طلب', cols: false }),
        K3.Section('مين عنده شغل', people.length ? people.map((p) => U.BarRow({ tone: 'brand', label: p.name, value: p.open + ' مفتوح لدوره · ' + p.done + ' حلّه الشهر ده', pct: p.open / maxP })) : none('مفيش أعضاء نشطين'), null, { sub: 'الأكتر شغل فوق — الطلب بيتوجّه للدور، واللي في نفس الدور بيشاركوا طلباته', cols: false, cls: 'tk-people' }))];
  }

  function TicketsView() {
    const all = tstore.all();
    const list = tSort(TK.filterTickets(all, { q: state.tfilter.q }).filter((t) => tMatch(t, state.tf)));
    const pages = Math.max(1, Math.ceil(list.length / TPAGE)); if (state.tpage > pages) state.tpage = pages;
    const slice = list.slice((state.tpage - 1) * TPAGE, state.tpage * TPAGE);
    const search = h('input', { type: 'search', class: 'input', placeholder: 'ابحث برقم التذكرة أو الأوردر أو اسم العميل', 'aria-label': 'بحث في التذاكر', value: state.tfilter.q, style: 'width:320px;max-width:100%' });
    search.addEventListener('input', () => { state.tfilter.q = search.value; state.tpage = 1; renderTickets(true); });
    // تحديد جماعي (owner 31 Oct): تغيير الحالة · الأولوية · المسؤول · إغلاق — one ticket at a time through the same RPC; refused ones counted
    const TBK = window.IBKit;
    const bulkTry = async (ids, fn, msg, done) => { let ok = 0, bad = 0; for (const id of ids) { const r = await Promise.resolve(fn(id)).catch(() => offline); if (r && r.ok) ok++; else bad++; } done(ok + ' تذكرة: ' + msg + (bad ? ' · ' + bad + ' مش مسموح' : '')); };
    const pickForm = (title, label, options, key, apply) => (ids, done) => TBK.form({ title: title + ' — ' + ids.length + ' تذكرة', values: { v: options[0][0] }, submitLabel: 'طبّق', fields: (f, e, set) => [TBK.field.select('v', label, options.map(([value, lb]) => ({ value, label: lb })), f, e, set, { required: true })], submit: (f) => bulkTry(ids, (id) => apply(id, f.v), label + ': ' + (options.find((o) => o[0] === f.v) || [0, f.v])[1], done) });
    const TB = TBK.Bulk({ key: 'tickets', ids: slice.map((t) => t.id), noun: 'تذكرة', render: () => renderTickets(), actions: tCanManage() ? [
      { id: 'status', label: 'تغيير الحالة', icon: 'edit', run: pickForm('تغيير الحالة', 'الحالة', [['in_progress', 'جاري العمل'], ['waiting', 'بانتظار الرد'], ['resolved', 'تم الحل']], 'status', (id, v) => (v === 'resolved' ? TA().resolve(id, { outcome: 'اتحلت المشكلة', note: 'تحديد جماعي' }) : TA().setStatus(id, v))) },
      { id: 'prio', label: 'الأولوية', icon: 'sliders', run: pickForm('تغيير الأولوية', 'الأولوية', TK.PRIORITIES.map((x) => [x[0], x[1]]), 'priority', (id, v) => TA().update(id, { priority: v })) },
      { id: 'role', label: 'المسؤول', icon: 'users', run: pickForm('تغيير المسؤول', 'المسؤول', TK.ROLES.map((x) => [x, x]), 'assigneeRole', (id, v) => TA().update(id, { assigneeRole: v })) },
      { id: 'close', label: 'إغلاق نهائي', icon: 'check', run: (ids, done) => TBK.confirm({ title: 'إغلاق ' + ids.length + ' تذكرة نهائيًا؟', text: 'تقدر تعيد فتح أي واحدة بعدين لو المشكلة رجعت.', okLabel: 'اقفلهم', onOk: () => bulkTry(ids, (id) => TA().close(id), 'اتقفلت', done) }) }] : [] });
    const headers = [TB.head(), 'الرقم', 'العنوان', 'النوع', 'العميل / المبتكر', 'الأوردر', 'الأولوية', 'الحالة', 'المسؤول', 'آخر تحديث'];
    const who = (t) => t.type === 'vendor' ? (t.vendor || '—') : t.type === 'customer' ? (t.customer || (orderCtx(t.orderId) || {}).customer || '—') : '—';
    const rowEl = (t) => { const tr = h('tr', { 'data-id': t.id, tabindex: '0', role: 'button', 'aria-label': 'فتح التذكرة ' + t.id }, [TB.box(t.id, t.id), num(t.id), t.title, typeLabel(t.type), who(t), t.orderId ? num(t.orderId) : '—', U.PriorityTag(t.priority), U.TicketStatus(t.status), t.assigneeRole, num(fmtTime(t.lastUpdate))].map((c, i) => h('td', { class: i === 2 ? 'ttl' : '' }, c)));
      tr.addEventListener('click', (e) => { if (e.target.closest('input,label,.sel-col')) return; openTicket(t.id); }); tr.addEventListener('keydown', (e) => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTicket(t.id); } }); return tr; };
    const table = h('div', { class: 'scroll-x' }, h('table', { class: 'tickets-table' }, h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, slice.map(rowEl))));
    const cards = h('div', { class: 'kv-list' }, slice.map((t) => { const c = h('div', { class: 'card list-card', tabindex: '0', role: 'button', 'aria-label': 'فتح التذكرة ' + t.id, 'data-id': t.id }, h('div', { class: 't-label title' }, t.title),
      [['الرقم', num(t.id)], ['النوع', typeLabel(t.type)], ['العميل / المبتكر', who(t)], ['الأولوية', U.PriorityTag(t.priority)], ['الحالة', U.TicketStatus(t.status)], ['المسؤول', t.assigneeRole], ['آخر تحديث', num(fmtTime(t.lastUpdate))]].map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 't-small' }, k), h('span', { class: 't-body' }, v))));
      c.addEventListener('click', () => openTicket(t.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTicket(t.id); }); return c; }));
    const pager = h('div', { class: 'pager' }, h('div', { class: 'pages' }, Button({ type: 'text', size: 'sm', label: 'السابق', disabled: state.tpage <= 1, onClick: () => { state.tpage--; renderTickets(); } }),
      Array.from({ length: pages }, (_, i) => Button({ type: i + 1 === state.tpage ? 'primary' : 'text', size: 'sm', label: String(i + 1), attrs: { 'aria-current': i + 1 === state.tpage ? 'page' : false }, onClick: () => { state.tpage = i + 1; renderTickets(); } })),
      Button({ type: 'text', size: 'sm', label: 'التالي', disabled: state.tpage >= pages, onClick: () => { state.tpage++; renderTickets(); } })), h('span', { class: 't-small' }, num(list.length ? 'عرض ' + ((state.tpage - 1) * TPAGE + 1) + '–' + Math.min(list.length, state.tpage * TPAGE) + ' من ' + list.length : '')));
    const K2 = window.IBKit;
    const tkHead = h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'طلبات الفريق'), h('p', { class: 't-small' }, 'طلبات الفريق: مشاكل العملاء، مشاكل المبتكرين، والتعليقات الداخلية — كل تحديث بيتسجل في السجل')),
      h('div', { class: 'actions' }, state.tsub === 'log' && K2.PanelButton ? K2.PanelButton('tickets', 'تذاكر الفريق', () => document.getElementById('tickets'), renderTickets) : null, window.IBDataActions.Menu(window.IBDataActions.PAGES.tickets),
        tCanManage() || hrCanFile() ? Button({ type: 'brand', icon: 'plus', label: 'فتح طلب', attrs: { 'data-req-new': '' }, onClick: () => openNewTicket() }) : null)); // decision 45
    const tkTabs = K2.SubTabs({ items: [{ id: 'overview', label: 'نظرة عامة' }, { id: 'log', label: 'السجل', count: all.filter((t) => TK.OPEN.has(t.status)).length }, { id: 'reports', label: 'التقارير' }], active: state.tsub, onChange: (id) => { state.tsub = id; renderTickets(); }, label: 'أقسام التذاكر' });
    if (state.tsub === 'overview') return [tkHead, tkTabs].concat(TicketsOverview()); // the owner 11 Nov: the first tab
    if (state.tsub === 'reports') return [tkHead, tkTabs].concat(TicketsReport());
    const TFG = [{ key: 'status', label: 'الحالة', options: [['open_any', 'مفتوحة (كل الحالات المفتوحة)']].concat(TK.STATUSES) }, { key: 'type', label: 'النوع', options: TK.TYPES }, { key: 'priority', label: 'الأولوية', options: TK.PRIORITIES.map((x) => [x[0], x[1]]) }, { key: 'role', label: 'المسؤول', options: TK.ROLES.map((r) => [r, r]) }, { key: 'mine', label: 'تذاكري', options: [['mine', 'تذاكر دوري بس']] }];
    const tCount = (f) => TK.filterTickets(all, { q: state.tfilter.q }).filter((t) => tMatch(t, f)).length;
    const tFM = K2.FilterMenu({ id: 'tickets', groups: TFG, value: state.tf, count: tCount, noun: 'تذكرة', label: 'فلتر التذاكر', onApply: (d) => { state.tf = d; state.tpage = 1; renderTickets(); } });
    const tSM = K2.SortMenu({ id: 'tickets', options: TSORTS, value: state.tsort, label: 'ترتيب التذاكر', onChange: (v) => { state.tsort = v; state.tpage = 1; renderTickets(); } });
    const tChips = []; const none = { status: [], type: [], priority: [], role: [], mine: [] };
    if (state.tfilter.q) tChips.push({ key: 'q', label: 'بحث: ' + state.tfilter.q, count: list.length, remove: () => { state.tfilter.q = ''; renderTickets(); } });
    TFG.forEach((g) => (state.tf[g.key] || []).forEach((v) => { const o = g.options.find((x) => x[0] === v); tChips.push({ key: g.key + ':' + v, label: (g.key === 'mine' ? '' : g.label + ': ') + (o ? o[1] : v).replace(' (كل الحالات المفتوحة)', ''), count: tCount(Object.assign({}, none, { [g.key]: [v] })), remove: () => { state.tf = Object.assign({}, state.tf, { [g.key]: state.tf[g.key].filter((x) => x !== v) }); state.tpage = 1; renderTickets(); } }); }));
    const tAF = K2.ActiveFilters({ id: 'tickets', chips: tChips, total: list.length, noun: 'تذكرة', onClear: () => { state.tf = Object.assign({}, none); state.tfilter.q = ''; state.tpage = 1; renderTickets(); } });
    const loading = TA() && TA().state() !== 'ready' && !all.length;
    return [
      tkHead, tkTabs,
      h('div', { class: 'toolbar' }, search),
      tnote ? (() => { const n = tnote; tnote = null; const el = U.InlineNote({ kind: n.kind, children: n.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => el.remove() }) }); return el; })() : null,
      TableCard({ title: 'التذاكر', cls: 'own-filter', count: list.length + ' تذكرة · مرتبة حسب ' + (TSORTS.find((x) => x[0] === state.tsort) || TSORTS[0])[1], action: h('div', { class: 'acts-inline tk-acts' }, tFM, tSM), pre: tAF, // the owner 12 Nov: «فلتر» next to the sort
        body: loading ? U.EmptyState('بنجيب التذاكر…', 'لحظة.') : list.length === 0 ? U.EmptyState('مفيش تذاكر مطابقة', tCanManage() ? 'غيّر الفلاتر، أو اضغط «إنشاء تذكرة» لو ظهرت مشكلة مع عميل أو مبتكر.' : 'غيّر الفلاتر.') : [TB.bar(), tableOrList(() => table, () => cards), pager] }),
      h('p', { class: 'source' }, 'المصدر: جدول التذاكر في السيستم · الأوردر والعميل بيتجابوا من الأوردرات · كل تغيير حالة أو رد بيتسجل في الخط الزمني وسجل النشاط')];
  }
  function renderTickets(keepFocus) {
    const main = document.getElementById('tickets'); if (!main || state.page !== 'tickets') return;
    U.closePopover();
    const sc = window.scrollY; const hadFocus = keepFocus && document.activeElement && document.activeElement.type === 'search';
    main.replaceChildren(...TicketsView().filter(Boolean));
    if (window.IBKit.applyPanelPrefs) window.IBKit.applyPanelPrefs('tickets', main); window.IBKit.sweepColumns(main);
    window.scrollTo(0, sc); if (hadFocus) { const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }

  // ----- new ticket modal (Figma: Modal / New ticket) — pre: { type, orderId, customer, vendor, vendorId, csConversationId, csCustomerId, title, description } -----
  // phase 13 decision 33 (owner 10 Nov — «تحويل طلباتي إلى تذاكر الفريق»): any member files an HR request from here (the HR page's own
  // forms) and it opens its team ticket (0071); the «طلباتي» tab in «ملفي» is gone
  /* phase 13 decision 66 (owner 11 Nov — «حوّل تذكرة جديدة إلى طلب جديد، وبدل إنشاء تذكرة إنشاء طلب، وأنواع الطلبات: مشكلة عميل، مشكلة
     مبتكر، طلب إجازة، طلب سلفة، طلب فترة راحة، طلب خاص — والجهات والخانات حسب النوع: الإجازة تاريخ بداية ونهاية، وفترة الراحة تاريخ
     وعدد ساعات ووقت بداية ونهاية»): one popup; the problems and «طلب خاص» (the old internal note) are team tickets as before; the leave,
     the advance and the rest period are HR requests (IBHR.request → hr_request_create) that open their team ticket to the direct manager
     (decision 33) — their own fields, no title / role / priority. */
  const hrCanFile = () => !!(window.IBHR && window.IBHR.request && window.IBDirectory && window.IBDirectory.me && window.IBDirectory.me());
  const REQ_TYPES = [['customer', 'مشكلة عميل'], ['vendor', 'مشكلة مبتكر'], ['leave', 'طلب إجازة'], ['advance', 'طلب سلفة'], ['rest', 'طلب فترة راحة'], ['internal', 'طلب خاص']];
  const HR_REQ = ['leave', 'advance', 'rest'];
  const minsOf = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function openNewTicket(pre) {
    const canT = tCanManage(), canH = hrCanFile();
    if (!canT && !canH) { notify('error', 'مفيش صلاحية تفتح طلبات.'); return; }
    const f = Object.assign({ type: canT ? 'customer' : 'leave', leaveKind: '', from: TODAY, to: TODAY, amount: '', months: '3', startAt: '', endAt: '', note: '', leaveDoc: null, title: '', description: '', priority: 'normal', assigneeRole: '', orderId: '', vendor: '', reason: '', followUp: '', attachments: [] }, pre || {});
    f.attachments = (f.attachments || []).slice();
    let errs = {}; let modal = null; let sending = false; let fileMsg = '';
    const vendorOpts = (typeof vstore !== 'undefined' && vstore.all ? vstore.all() : []).filter((v) => !v.siteRemoved).map((v) => ({ value: v.name, label: v.name }));
    // decision 19 (the owner, 5 Nov — «وهو بيكتب تظهرله خيارات الأوردرات الموجودة يختار منها»): «رقم الأوردر» searches the loaded
    // orders by number or customer as it is typed; a pick fills the number and the customer (a maker ticket: the maker too when the
    // order has one). Typing a number that is not in the list still works (the server keeps the typed number).
    function orderPicker(required) {
      const list = h('div', { class: 'tk-order-opts', role: 'listbox', 'aria-label': 'الأوردرات', hidden: true });
      const inp = h('input', { id: 't-order', class: 'input' + (errs.orderId ? ' err' : ''), type: 'search', autocomplete: 'off', inputmode: 'search', value: f.orderId || '',
        placeholder: required ? 'اكتب رقم الأوردر أو اسم العميل' : 'اختياري — رقم الأوردر أو اسم العميل', 'aria-autocomplete': 'list', 'aria-controls': 't-order-opts' });
      list.id = 't-order-opts';
      const hits = (q) => { const t = String(q || '').trim().replace(/^ib-?/i, ''); if (!t || !window.OrdersApp || !window.OrdersApp.query) return []; try { return window.OrdersApp.query({ q: t }, 8).rows; } catch (e) { return []; } };
      const pick = (o) => { f.orderId = String(o.id); f.customer = o.customer || ''; if (f.type === 'vendor' && !f.vendor && o.vendors && o.vendors.length === 1) { f.vendor = o.vendors[0]; f.vendorId = null; } errs.orderId = undefined; draw(); };
      const paint = () => {
        const rows = String(inp.value || '').trim() && String(inp.value).trim() !== String(f.picked || '') ? hits(inp.value) : [];
        list.hidden = !rows.length;
        list.replaceChildren(...rows.map((o) => { const b = h('button', { type: 'button', role: 'option', class: 'tk-order-opt', 'data-tk-pick': String(o.id) },
          h('b', null, 'IB-' + o.id), h('span', null, ' · ' + (o.customer || '—') + ' · ' + (o.status || '') + (o.vendors && o.vendors.length ? ' · ' + o.vendors.join('، ') : '')));
          b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => { f.picked = String(o.id); pick(o); }); return b; }));
      };
      inp.addEventListener('input', () => { f.orderId = inp.value; f.picked = null; paint(); });
      inp.addEventListener('focus', paint);
      inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); const first = list.querySelector('[data-tk-pick]'); if (first) first.click(); } });
      const ctx0 = f.orderId ? orderCtx(String(f.orderId).trim()) : null;
      return U.FieldShell({ id: 't-order', label: 'رقم الأوردر', required, error: errs.orderId, help: ctx0 ? null : 'اكتب الرقم أو اسم العميل واختار من القايمة — بيجيب العميل والمبتكر تلقائي' }, h('div', { class: 'tk-order' }, inp, list));
    }
    const typeOpts = REQ_TYPES.filter(([v]) => (HR_REQ.includes(v) ? canH : canT)).map(([v, l]) => ({ value: v, label: l }));
    const leaveTypes = () => ((window.IBHR && window.IBHR.data && window.IBHR.data.leaveTypes) || []);
    function hrFields() {
      const t = U.Select({ id: 't-type', label: 'النوع', required: true, options: typeOpts, value: f.type, error: errs.type, onChange: (v) => { f.type = v; errs = {}; draw(); } });
      const note = U.InlineNote({ children: 'الطلب بيروح لمديرك المباشر (وإلا مدير النظام) كطلب في «طلبات الفريق»، والقرار بيتاخد منه. التفاصيل بتفضل في «الموارد البشرية».' });
      if (f.type === 'leave') {
        const LT = leaveTypes(); if (!f.leaveKind && LT[0]) f.leaveKind = LT[0].name; const lt = LT.find((x) => x.name === f.leaveKind) || {}; const needDoc = !!lt.doc && !['', '—', '-'].includes(String(lt.doc).trim());
        const doc = h('input', { type: 'file', id: 't-ldoc', accept: 'image/*,application/pdf', onChange: (e) => { f.leaveDoc = e.target.files && e.target.files[0] ? e.target.files[0] : null; } });
        return [h('div', { class: 'row cols2' }, t, U.Select({ id: 't-lkind', label: 'نوع الإجازة', required: true, options: LT.map((x) => ({ value: x.name, label: x.name })), value: f.leaveKind, error: errs.leaveKind, onChange: (v) => { f.leaveKind = v; draw(); } })),
          h('div', { class: 'row cols2' }, U.DateField({ id: 't-from', label: 'تاريخ البداية', required: true, value: f.from || null, error: errs.from, today: TODAY, onChange: (iso) => { f.from = iso || ''; draw(); } }), U.DateField({ id: 't-to', label: 'تاريخ النهاية', required: true, value: f.to || null, error: errs.to, today: TODAY, onChange: (iso) => { f.to = iso || ''; draw(); } })),
          needDoc ? U.FieldShell({ id: 't-ldoc', label: lt.doc + ' (صورة أو PDF)', required: true, error: errs.leaveDoc }, doc) : null,
          U.Textarea({ id: 't-note', label: 'ملاحظة', value: f.note, placeholder: 'اختياري', onInput: (v) => { f.note = v; } }), note];
      }
      if (f.type === 'advance') return [h('div', { class: 'row cols2' }, t, U.TextInput({ id: 't-amount', label: 'المبلغ (ج.م)', required: true, inputmode: 'decimal', value: f.amount, error: errs.amount, onInput: (v) => { f.amount = v; } })),
        U.Select({ id: 't-months', label: 'التقسيط على', required: true, options: [1, 2, 3, 4, 6, 9, 12].map((n) => ({ value: String(n), label: n + (n === 1 ? ' شهر' : n === 2 ? ' شهرين' : ' شهور') })), value: f.months, onChange: (v) => { f.months = v; draw(); } }),
        U.Textarea({ id: 't-note', label: 'السبب', value: f.note, placeholder: 'اختياري', onInput: (v) => { f.note = v; } }), note];
      // rest: the day, the start and the end time — the hours from them
      const a = minsOf(f.startAt), b = minsOf(f.endAt); const hrs = a != null && b != null && b > a ? Math.round((b - a) / 30) / 2 : null;
      const tm = (id, label, key) => U.FieldShell({ id, label, required: true, error: errs[key] }, h('input', { id, type: 'time', class: 'input' + (errs[key] ? ' err' : ''), value: f[key] || '', step: 900, onChange: (e) => { f[key] = e.target.value; errs[key] = undefined; draw(); } }));
      return [h('div', { class: 'row cols2' }, t, U.DateField({ id: 't-from', label: 'التاريخ', required: true, value: f.from || null, error: errs.from, today: TODAY, onChange: (iso) => { f.from = iso || ''; draw(); } })),
        h('div', { class: 'row cols2' }, tm('t-start', 'من الساعة', 'startAt'), tm('t-end', 'لحد الساعة', 'endAt')),
        h('div', { class: 't-small', 'data-rest-hours': hrs == null ? '' : String(hrs) }, 'عدد الساعات: ' + (hrs == null ? '—' : num(String(hrs)) + (hrs === 1 ? ' ساعة' : hrs === 2 ? ' ساعتين' : ' ساعات'))),
        U.Textarea({ id: 't-note', label: 'السبب', value: f.note, placeholder: 'اختياري', onInput: (v) => { f.note = v; } }), note];
    }
    function hrValidate() {
      const e = {};
      if (f.type === 'leave') { const lt = leaveTypes().find((x) => x.name === f.leaveKind) || {}; const needDoc = !!lt.doc && !['', '—', '-'].includes(String(lt.doc).trim());
        if (!f.leaveKind) e.leaveKind = 'اختار نوع الإجازة'; if (!f.from) e.from = 'اختار البداية'; if (!f.to) e.to = 'اختار النهاية'; else if (f.from && f.to < f.from) e.to = 'النهاية لازم بعد البداية'; if (needDoc && !f.leaveDoc) e.leaveDoc = 'ارفع ' + lt.doc; }
      if (f.type === 'advance') { const n = Number(String(f.amount).replace(/[,٬]/g, '')); if (!(n > 0)) e.amount = 'اكتب مبلغ صحيح'; }
      if (f.type === 'rest') { const a = minsOf(f.startAt), b = minsOf(f.endAt); if (!f.from) e.from = 'اختار التاريخ'; if (a == null) e.startAt = 'اختار وقت البداية'; if (b == null) e.endAt = 'اختار وقت النهاية'; else if (a != null && b <= a) e.endAt = 'النهاية لازم بعد البداية'; else if (a != null && (b - a) / 60 > 12) e.endAt = 'فترة الراحة لحد 12 ساعة'; else if (a != null && (b - a) < 30) e.endAt = 'نص ساعة على الأقل'; }
      return e;
    }
    async function hrSubmit() {
      const H = window.IBHR; const me = window.IBDirectory.me() || {};
      let doc = null;
      if (f.type === 'leave' && f.leaveDoc) { const u = await H.upload(f.leaveDoc, me.member_code); if (!u.ok) return u; doc = u.path; }
      const a = minsOf(f.startAt), b = minsOf(f.endAt);
      const input = f.type === 'leave' ? { type: f.leaveKind, from: f.from, to: f.to, note: f.note || '', doc }
        : f.type === 'advance' ? { type: 'سُلفة', amount: Number(String(f.amount).replace(/[,٬]/g, '')), months: Number(f.months), note: f.note || '' }
          : { type: 'فترة راحة', from: f.from, to: f.from, time: f.startAt, hours: Math.round((b - a) / 30) / 2, note: f.note || '' };
      return H.request(input);
    }
    function draw() {
      if (HR_REQ.includes(f.type)) {
        modal.setBody(...hrFields().concat(errs._form ? [U.InlineNote({ kind: 'error', children: errs._form })] : []).filter(Boolean));
        modal.setFooter(Button({ type: 'primary', label: sending ? 'بيتبعت…' : 'إنشاء الطلب', disabled: sending, attrs: { 'data-req-submit': '' }, onClick: submit }), Button({ label: 'إلغاء', onClick: modal.close }));
        return;
      }
      const ctx = f.type === 'customer' && f.orderId ? orderCtx(String(f.orderId).trim()) : null;
      const pick = AttachPicker(f.attachments, (m) => { fileMsg = m; draw(); }); pick.msg.textContent = fileMsg;
      const linked = f.csConversationId ? U.InlineNote({ children: 'التذكرة هتتربط بمحادثة خدمة العملاء' + (f.customer ? ' مع ' + f.customer : '') + '.' }) : null;
      const fields = [
        linked,
        h('div', { class: 'row cols2' }, U.TextInput({ id: 't-title', label: 'العنوان', required: true, value: f.title, error: errs.title, placeholder: f.type === 'internal' ? 'سطر واحد يلخّص الطلب' : 'سطر واحد يلخّص المشكلة', maxlength: TK.TITLE_MAX, onInput: (v) => { f.title = v; } }),
          U.Select({ id: 't-type', label: 'النوع', required: true, options: typeOpts, value: f.type, error: errs.type, onChange: (v) => { f.type = v; f.reason = ''; errs = {}; draw(); } })),
        f.type === 'customer' ? orderPicker(true) : null,
        ctx ? h('div', { class: 'ctx-card', style: 'padding:8px 12px' }, h('div', { class: 'facts' }, U.DelayBadge(ctx.delivery), h('span', { class: 't-small' }, num(ctx.customer + ' · ' + (ctx.vendors || []).join('، ') + ' · ' + ctx.status + ' · ' + ctx.ageDays + ' يوم · ' + D.formatMoney(ctx.total) + ' ج.م')))) : null,
        f.type === 'customer' ? U.Select({ id: 't-reason', label: 'سبب المشكلة', required: true, options: TK.CUSTOMER_REASONS.map((r) => ({ value: r, label: r })), value: f.reason, error: errs.reason, onChange: (v) => { f.reason = v; draw(); } }) : null,
        f.type === 'vendor' ? U.Select({ id: 't-vendor', label: 'المبتكر', required: true, options: vendorOpts, value: f.vendor, error: errs.vendor, placeholder: 'اختار المبتكر', onChange: (v) => { f.vendor = v; f.vendorId = null; draw(); } }) : null,
        f.type === 'vendor' ? orderPicker(false) : null,
        f.type === 'vendor' ? U.Select({ id: 't-reason', label: 'سبب المشكلة', required: true, options: TK.VENDOR_REASONS.map((r) => ({ value: r, label: r })), value: f.reason, error: errs.reason, onChange: (v) => { f.reason = v; draw(); } }) : null,
        U.Textarea({ id: 't-desc', label: 'الوصف', required: true, value: f.description, error: errs.description, placeholder: 'إيه اللي حصل + إيه المطلوب من الفريق', onInput: (v) => { f.description = v; } }),
        h('div', { class: 'row cols2' }, U.Select({ id: 't-prio', label: 'الأولوية', required: true, options: TK.PRIORITIES.map(([v, l]) => ({ value: v, label: l })), value: f.priority, error: errs.priority, onChange: (v) => { f.priority = v; draw(); } }),
          U.Select({ id: 't-role', label: 'المسؤول (الدور)', required: true, options: roleOpts(), value: f.assigneeRole, error: errs.assigneeRole, placeholder: 'اختار الدور', onChange: (v) => { f.assigneeRole = v; draw(); } })),
        h('div', { class: 'row cols2' }, U.DateField({ id: 't-follow', label: 'تاريخ المتابعة', value: f.followUp || null, error: errs.followUp, today: TODAY, onChange: (iso, e) => { if (!e) f.followUp = iso || ''; errs.followUp = e || undefined; draw(); } }),
          U.FieldShell({ id: 't-att', label: 'مرفقات (صور أو PDF — لحد 10 ملفات، 10 ميجا للملف)' }, pick.el)),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'هتتسجل باسمك (' + ME.name + ' · ' + ME.role + ') وتاريخ النهارده، والحالة هتبدأ «مفتوح».' })].filter(Boolean);
      modal.setBody(...fields);
      modal.setFooter(Button({ type: 'primary', label: sending ? 'بيتبعت…' : 'إنشاء الطلب', disabled: sending, attrs: { 'data-req-submit': '' }, onClick: submit }), Button({ label: 'إلغاء', onClick: modal.close }));
    }
    async function submit() {
      if (sending) return;
      if (HR_REQ.includes(f.type)) {
        errs = hrValidate(); if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; draw(); return; }
        sending = true; draw(); const r = await hrSubmit().catch(() => ({ ok: false, message: 'مافيش اتصال — جرّب تاني' })); sending = false;
        if (!r || !r.ok) { errs = r && r.field && ['from', 'to', 'amount'].includes(r.field) ? { [r.field]: r.message } : {}; errs._form = (r && r.message) || 'تعذّر إنشاء الطلب'; draw(); return; }
        modal.close(); notify('success', 'اتقدم الطلب ' + r.id + (r.ticket ? ' — وصل لمديرك في ' + r.ticket : '') + '.'); if (r.ticket && tstore.get(r.ticket)) openTicket(r.ticket); return;
      }
      errs = TK.validateTicket(f); if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; draw(); return; }
      const c0 = f.type === 'customer' ? orderCtx(String(f.orderId).trim()) : null; if (c0 && !f.customer) f.customer = c0.customer;
      sending = true; draw();
      const r = await TA().create(f).catch(() => offline); sending = false;
      if (!r.ok) { errs = r.field && ['title', 'orderId', 'vendor', 'reason', 'followUp', 'description', 'priority', 'assigneeRole'].includes(r.field) ? { [r.field]: r.message } : {}; errs._form = r.message || 'تعذّر إنشاء الطلب'; draw(); return; }
      modal.close(); state.tf = Object.assign({}, state.tf, { status: ['open_any'] }); state.tpage = 1; notify('success', 'اتعمل الطلب ' + r.id + ' ووصل لدور «' + f.assigneeRole + '».'); openTicket(r.id);
    }
    modal = U.Modal({ title: 'طلب جديد', body: [], footer: [] }); draw();
    const first = modal.el.querySelector('#t-title') || modal.el.querySelector('#t-type'); if (first) first.focus();
  }

  // ----- ticket drawer (Figma: Drawer / Ticket) -----
  let drawerApi = null;
  function openTicket(id) {
    const t0 = tstore.get(id); if (!t0) { notify('error', 'التذكرة ' + id + ' مش موجودة أو مش متاحة ليك.'); return; }
    if (drawerApi) drawerApi.close();
    try { history.replaceState(null, '', '#tickets/' + id); } catch (e) { /* sandboxed */ }
    let busy = false; const replyFiles = []; let replyMsg = ''; let replyDraft = '';
    drawerApi = U.Drawer({ label: 'التذكرة ' + id, onClose: () => { drawerApi = null; drawerRedraw = null; try { history.replaceState(null, '', '#tickets'); } catch (e) { /* sandboxed */ } renderTickets(); } });
    // a write: one at a time; the drawer redraws from the adapter after it (ib:tickets), the note says how it went
    const act = (run, okMsg) => { if (busy || !TA()) return; busy = true; Promise.resolve().then(run).catch(() => offline).then((r) => { busy = false; if (r && r.ok === false) notify('error', r.message || 'تعذّر الحفظ'); else if (okMsg) notify('success', okMsg); if (drawerApi) draw(); }); };
    function moreMenu(t) {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' });
      const trig = IconButton({ icon: 'more', label: 'المزيد', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      const editable = (tCanWork(t) || tCanClose(t));
      const opts = [].concat(editable ? [{ value: 'role', label: 'تغيير المسؤول (الدور)' }, { value: 'prio', label: 'تغيير الأولوية' }, { value: 'follow', label: 'تغيير تاريخ المتابعة' }] : [], [{ value: 'copy', label: 'نسخ رابط التذكرة' }]);
      if (tCanClose(t) && t.status !== 'closed') opts.push({ value: 'close', label: 'إغلاق نهائي', danger: true });
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
      m = U.Modal({ title: which === 'role' ? 'تغيير المسؤول' : which === 'prio' ? 'تغيير الأولوية' : 'تغيير تاريخ المتابعة', body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: () => { if (err) return; m.close(); act(() => TA().update(id, which === 'role' ? { assigneeRole: f.assigneeRole } : which === 'prio' ? { priority: f.priority } : { followUp: f.followUp || null }), 'اتحفظ التغيير.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmResolve(t) {
      const f = { outcome: '', note: '' }; let errs = {}; let m = null;
      const body = () => [U.Select({ id: 'r-out', label: 'نتيجة الحل', required: true, options: TK.OUTCOMES.map((o) => ({ value: o, label: o })), value: f.outcome, error: errs.outcome, onChange: (v) => { f.outcome = v; errs = {}; m.setBody(...body()); } }),
        U.Textarea({ id: 'r-note', label: 'ملاحظة الإغلاق', value: f.note, placeholder: 'اكتب إيه اللي اتعمل بالظبط…', onInput: (v) => { f.note = v; } }),
        U.InlineNote({ children: 'هتتحول لـ «تم الحل» وصاحب التذكرة (' + t.createdBy.name + ') أو الأدمن يقدر يقفلها نهائي أو يرجّعها. مافيش قفل تلقائي.' })];
      m = U.Modal({ title: 'تم حل التذكرة؟', body: body(), footer: [Button({ type: 'primary', label: 'تأكيد الحل', onClick: () => { if (!f.outcome) { errs.outcome = 'اختار نتيجة الحل'; m.setBody(...body()); return; } m.close(); act(() => TA().resolve(id, f), 'التذكرة اتحوّلت لـ «تم الحل».'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmClose(t) {
      const m = U.Modal({ title: 'إغلاق نهائي', body: U.InlineNote({ kind: 'warning', children: 'هتتقفل التذكرة ' + t.id + ' نهائيًا. تقدر تعيد فتحها بعدين بسبب لو المشكلة رجعت.' }), footer: [Button({ type: 'danger', label: 'إغلاق نهائي', onClick: () => { m.close(); act(() => TA().close(id), 'التذكرة اتقفلت.'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function confirmReopen(t) {
      const f = { reason: '' }; let err = null; let m = null;
      const body = () => [U.Textarea({ id: 'o-reason', label: 'سبب إعادة الفتح', required: true, value: f.reason, error: err, placeholder: 'مثال: العميلة لسه ما استلمتش…', help: 'إجباري — بيظهر في الخط الزمني كحدث «أُعيد فتحه»', onInput: (v) => { f.reason = v; } }), U.InlineNote({ children: 'هترجع «مفتوح» لدور «' + t.assigneeRole + '» وهيوصله إشعار.' })];
      m = U.Modal({ title: 'إعادة فتح التذكرة', body: body(), footer: [Button({ type: 'brand', label: 'إعادة الفتح', onClick: () => { if (!f.reason.trim()) { err = 'اكتب سبب إعادة الفتح'; m.setBody(...body()); return; } m.close(); act(() => TA().reopen(id, f), 'التذكرة اتفتحت تاني ورجعت لدور «' + t.assigneeRole + '».'); } }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
    }
    function draw() {
      if (!drawerApi) return; let otCard = null;
      const t = tstore.get(id); if (!t) { drawerApi.close(); notify('error', 'التذكرة ' + id + ' مابقتش متاحة ليك.'); return; }
      const closed = t.status === 'closed'; const ctx = orderCtx(t.orderId);
      const canWork = tCanWork(t), canClose = tCanClose(t);
      const actions = [];
      if (closed) { if (canClose) actions.push(Button({ type: 'brand', size: 'sm', label: 'إعادة فتح', onClick: () => confirmReopen(t) })); }
      else if (canWork) {
        if (t.status !== 'resolved') actions.push(Button({ type: 'primary', size: 'sm', label: 'تم الحل', onClick: () => confirmResolve(t) }));
        if (t.status === 'open' || t.status === 'waiting') actions.push(Button({ size: 'sm', label: 'جاري العمل', onClick: () => act(() => TA().setStatus(id, 'in_progress')) }));
        if (t.status === 'open' || t.status === 'in_progress') actions.push(Button({ size: 'sm', label: 'بانتظار الرد', onClick: () => act(() => TA().setStatus(id, 'waiting')) }));
        if (t.status === 'resolved' && canClose) actions.push(Button({ type: 'primary', size: 'sm', label: 'إغلاق نهائي', onClick: () => confirmClose(t) }));
      }
      if (!closed && canClose && t.status === 'resolved') actions.push(Button({ type: 'brand', size: 'sm', label: 'إعادة فتح', onClick: () => confirmReopen(t) }));
      actions.push(moreMenu(t));
      const header = h('div', { class: 'drawer-h' },
        h('div', { class: 'row1' }, h('div', { class: 'ids' }, h('span', { class: 't-label', style: 'color:var(--color-text-secondary)' }, num(t.id)), h('span', { class: 'chip' }, typeLabel(t.type)), U.TicketStatus(t.status), U.PriorityTag(t.priority), t.reopenCount ? h('span', { class: 'chip' }, 'أُعيد فتحه ×' + t.reopenCount) : null), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => drawerApi.close() })),
        h('h2', { class: 't-h4' }, t.title),
        h('div', { class: 'meta t-small' }, h('span', null, 'المسؤول: ' + t.assigneeRole + ' · أنشأه ' + t.createdBy.role + ' (' + t.createdBy.name + ') · ' + D.formatDateLong(dayOf(t.createdAt)) + (t.followUp ? ' · متابعة ' + D.formatDateLong(t.followUp) : '')), h('div', { class: 'actions' }, actions)));
      const ctxCard = t.type === 'internal' && !t.csConversationId ? null : h('div', { class: 'ctx-card' },
        h('div', { class: 'head' }, h('span', { class: 't-label' }, t.type === 'customer' ? (ctx ? 'الأوردر ' + t.orderId + ' — ' + ctx.customer : 'الأوردر ' + t.orderId + (t.customer ? ' — ' + t.customer : ' — مش موجود في الأوردرات الحالية')) : t.type === 'vendor' ? 'المبتكر ' + t.vendor + (t.orderId ? ' — الأوردر ' + t.orderId : '') : 'محادثة خدمة العملاء'),
          h('div', { class: 'links' }, t.orderId ? Button({ type: 'text', size: 'sm', label: 'فتح الأوردر', onClick: () => { drawerApi.close(); showOrders({ q: t.orderId }); } }) : null,
            t.vendorId && typeof openVendor === 'function' ? Button({ type: 'text', size: 'sm', label: 'فتح المبتكر', onClick: () => { drawerApi.close(); go('vendors'); openVendor(t.vendorId); } }) : null,
            t.csConversationId && csApi() && csApi().openConversation ? Button({ type: 'text', size: 'sm', label: 'فتح المحادثة', onClick: () => { drawerApi.close(); csApi().openConversation(t.csConversationId); } }) : null)),
        ctx ? h('div', { class: 'facts t-small' }, U.DelayBadge(ctx.delivery), h('span', null, num((ctx.vendors || []).join('، ') + ' · ' + ctx.status + ' · ' + ctx.confirm + ' · الإجمالي ' + D.formatMoney(ctx.total) + ' · العمر ' + ctx.ageDays + ' يوم'))) : (t.reason ? h('div', { class: 'facts t-small' }, h('span', null, 'السبب: ' + t.reason)) : null));
      const items = tstore.events(id);
      const tl = h('div', { class: 'tl' }, h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'آخر التحديثات'),
        items.map((e) => e.kind === 'message' ? h('div', { class: 'tk-msg' }, U.TimelineMessage({ author: e.author.name, role: e.author.role, time: fmtTime(e.at), text: e.text }), Thumbs(e.attachments)) : U.TimelineEvent({ text: e.text, time: fmtTime(e.at) })));
      const own = t.attachments && t.attachments.length ? h('div', { class: 'tk-own' }, h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'مرفقات التذكرة'), Thumbs(t.attachments)) : null;
      const body = h('div', { class: 'drawer-b' }, closed ? U.InlineNote({ kind: 'warning', children: 'مغلق بواسطة ' + (t.closedBy || '—') + (t.closedAt ? ' · ' + D.formatDateLong(dayOf(t.closedAt)) : '') + (t.resolution ? ' · «' + t.resolution.outcome + '»' : '') + ' — لو المشكلة رجعت اضغط «إعادة فتح».' }) : null, ctxCard, own, tl);
      // phase 13 decision 25 (0069): an overtime request ticket — its waiting overtime decided here by whoever may (the direct manager,
      // hr.approve or the admin; the server checks), the same as «الموارد البشرية › الطلبات»; the decision closes the ticket
      const HRa = window.IBHR; const KK = window.IBKit; const OO = window.IbtekrOps; const otReq = HRa && HRa.data && (HRa.data.overtime || []).find((o) => o.ticket === t.id);
      if (otReq) {
        const mine = otReq.member === KK.ME; const waiting = otReq.status === 'مستني';
        const decideOt = (dec, minutes, reason) => act(() => HRa.overtimeDecide(otReq.id, dec, minutes, reason).then((r) => { if (r && r.ok && TA() && TA().load) return Promise.resolve(TA().load()).then(() => r); return r; }), dec === 'add' ? 'اتضاف الوقت الإضافي واتقفلت التذكرة' : 'اترفض الوقت الإضافي واتقفلت التذكرة');
        const okBtn = Button({ type: 'primary', size: 'sm', label: otReq.kind === 'rest_day' ? 'وافق على يوم الراحة' : 'وافق على الوقت الإضافي', attrs: { 'data-ot-approve': '' }, onClick: () => {
          if (otReq.kind === 'rest_day') return KK.confirm({ title: 'موافقة على يوم الراحة/العطلة', text: 'اليوم هيتحسب بيومين في المرتب.', okLabel: 'وافق', onOk: () => decideOt('add') });
          KK.form({ title: 'موافقة على الوقت الإضافي', values: { min: String(otReq.minutes) }, fields: (f, e, set) => [KK.field.text('min', 'الدقايق اللي هتتحسب (لحد ' + otReq.minutes + ')', f, e, set, { required: true })],
            validate: (f) => { const n = Number(OO.toLatin ? OO.toLatin(f.min) : f.min); return n > 0 && n <= otReq.minutes && Number.isInteger(n) ? {} : { min: 'رقم من 1 لحد ' + otReq.minutes }; },
            submitLabel: 'وافق', submit: (f) => decideOt('add', Number(OO.toLatin ? OO.toLatin(f.min) : f.min)) }); } });
        const noBtn = Button({ size: 'sm', label: 'ارفض', attrs: { 'data-ot-reject': '' }, onClick: () => KK.form({ title: 'رفض الوقت الإضافي', values: {}, fields: (f, e, set) => [KK.field.area('reason', 'السبب', f, e, set, { required: true })], validate: (f) => KK.req(f, ['reason']), submitLabel: 'ارفض', submit: (f) => decideOt('reject', null, f.reason.trim()) }) });
        otCard = h('div', { class: 'ctx-card tk-ot', 'data-ot-request': '' }, h('div', { class: 'head' }, h('span', { class: 't-label' }, otReq.kind === 'rest_day' ? 'طلب يوم راحة/عطلة اشتغله — اليوم بيومين' : 'طلب وقت إضافي — ' + KK.hrs(otReq.minutes)), KK.Tag(waiting ? 'orange' : otReq.status === 'اتضاف' ? 'success' : 'error', otReq.status)),
          h('div', { class: 'facts t-small' }, h('span', null, KK.dshort(otReq.date) + (otReq.start ? ' · ' + otReq.start + '–' + otReq.end : '') + (otReq.note ? ' · ' + otReq.note : ''))),
          // decision 32 (0070): a rest day / holiday worked waits for an admin, an ordinary overtime for the direct manager
          waiting && !mine && HRa.decidesOt(otReq) ? h('div', { class: 'links' }, okBtn, noBtn) : waiting ? h('p', { class: 't-small help', style: 'margin:0' }, otReq.kind === 'rest_day' ? 'مستني موافقة الأدمن — يوم الراحة/العطلة موافقته للأدمن بس.' : mine ? 'مستني موافقة مديرك المباشر.' : 'مستني موافقة المدير المباشر.') : null);
      }
      // phase 13 decision 33 (0071): an HR request's ticket — the request itself (its type, dates, amount, note) is read under the HR rules
      // (IBHR.data.requests: RLS hr_can_see; the ticket carries the family only) and decided here by whoever may (the server checks)
      const rqReq = HRa && HRa.data && (HRa.data.requests || []).find((r) => r.ticket === t.id); let rqCard = null;
      if (rqReq) {
        const HRP = window.IBPages.all().hr.api; const mineRq = rqReq.member === KK.ME; const pendingRq = HRP.isPending(rqReq);
        const reload = (p) => Promise.resolve(p).then(() => { if (TA() && TA().load) return TA().load(); }).then(() => draw());
        rqCard = h('div', { class: 'ctx-card tk-ot', 'data-hr-request': '' }, h('div', { class: 'head' }, h('span', { class: 't-label' }, rqReq.type + ' — ' + rqReq.id), KK.Tag(pendingRq ? 'orange' : rqReq.status === 'موافق' ? 'success' : rqReq.status === 'اتلغى' ? 'neutral' : 'error', rqReq.status)),
          h('div', { class: 'facts t-small' }, h('span', null, HRP.reqPeriod(rqReq) + (rqReq.type === 'سُلفة' && rqReq.amount != null ? ' · ' + KK.money(rqReq.amount) + ' ج على ' + rqReq.months + ' شهور' : '') + (rqReq.note ? ' · ' + rqReq.note : ''))),
          h('div', { class: 'links' },
            pendingRq && !mineRq ? Button({ type: 'primary', size: 'sm', label: 'موافقة', attrs: { 'data-rq-approve': '' }, onClick: () => reload(HRP.decide(rqReq, 'موافق')) }) : null,
            pendingRq && !mineRq ? Button({ size: 'sm', label: 'رفض', attrs: { 'data-rq-reject': '' }, onClick: () => HRP.rejectReq(rqReq) }) : null,
            pendingRq && mineRq ? Button({ size: 'sm', label: 'إلغاء الطلب', attrs: { 'data-rq-cancel': '' }, onClick: () => HRP.cancelReq(rqReq) }) : null,
            Button({ type: 'text', size: 'sm', label: 'التفاصيل', onClick: () => HRP.reqDetails(rqReq) })),
          pendingRq && mineRq ? h('p', { class: 't-small help', style: 'margin:0' }, 'مستني قرار مديرك المباشر.') : null);
      }
      let reply = null;
      if (!closed && tCanManage()) {
        const pick = AttachPicker(replyFiles, (m) => { replyMsg = m; draw(); }); pick.msg.textContent = replyMsg;
        const box = U.ReplyBox({ onSend: (text) => { replyDraft = ''; const files = replyFiles.slice(); act(() => TA().reply(id, text, files).then((r) => { if (r && r.ok) { replyFiles.length = 0; replyMsg = ''; } return r; })); } });
        const ta = box.querySelector('textarea'); if (ta) { ta.value = replyDraft; ta.addEventListener('input', () => { replyDraft = ta.value; }); }
        const dead = box.querySelector('.hint .icon-btn'); if (dead) dead.remove(); // the prototype's disabled «إضافة مرفق» — the picker above is the real one
        reply = h('div', { class: 'tk-reply' }, pick.el, box);
      }
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tk-reply textarea'); // a live redraw keeps the reply's focus (as decision 16 did for the inbox)
      if (otCard) body.prepend(otCard);
      if (rqCard) body.prepend(rqCard);
      drawerApi.set(header, body, reply);
      const b = drawerApi.el.querySelector('.drawer-b'); if (b) b.scrollTop = b.scrollHeight;
      if (typing) { const ta2 = drawerApi.el.querySelector('.tk-reply textarea'); if (ta2) { ta2.focus(); ta2.setSelectionRange(ta2.value.length, ta2.value.length); } }
      if (typeof seenNow === 'function') setTimeout(seenNow, 0);
    }
    drawerRedraw = draw;
    const seenNow = () => { if (TA()) TA().markSeen(id); }; // decision 9: what the member opened leaves the bell
    draw(); const c = drawerApi.el.querySelector('.icon-btn'); if (c) c.focus();
    if (TA()) TA().loadEvents(id); // the whole timeline (the list carries the last 30 days)
  }

  // ---------- Vendors / المبتكرين (Figma: المبتكرين — Desktop 1440; Modal / Add vendor; Drawer / Vendor Tab=Info/Orders) ----------
  const VD = window.IbtekrVendors;
  // «الفئة الأساسية» (the owner, 11 Nov — B2, 0080): the site's main categories, several, kept in the system only
  const mainCats = () => (vstore.mainCategories ? vstore.mainCategories() : []);
  const catPick = (fid, f, errs, help) => window.IBKit.MultiPick({ id: fid, field: true, required: true, label: 'الفئة الأساسية', options: mainCats().map((c) => [c.id, c.name]), value: f.categories, error: errs.categories,
    placeholder: mainCats().length ? 'اختار قسم أو أكتر' : 'أقسام الموقع لسه ماتزامنتش', help: help || 'الأقسام الرئيسية بتاعة الموقع — بتتحفظ في السيستم بس', onChange: (ids) => { f.categories = ids.map(Number); } });
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
  // phase 5.5 decision 3 (owner 1 Nov): the closed filter picks several values per group; «نشط» ticked by default. decision 3 (owner 31 Oct): the selection for the bulk actions
  const VF0 = () => ({ status: ['active'], category: [], balance: [], contract: [], other: [] }); state.vf = VF0(); state.vsel = new Set(); state.vtab = 'overview'; // phase 13 decision 57
  const PAPI = () => ((window.IBPages && window.IBPages.all().products) || {}).api || null;
  const prodCount = (ids) => { const a = PAPI(); return a ? a.makerItems(ids).length : 0; };
  // the actions on one or more makers (decision 3): their products through the products page's own popups; the rate through the store (vendor_rate_set + push)
  function makerAct(kind, ids, after) {
    const done = () => { if (after) after(); renderVendors(); };
    if (kind === 'rate') { rateForm(ids, done); return; }
    const a = PAPI(); if (!a) { vnotify('error', 'صفحة المنتجات مش متاحة.'); return; }
    a.ensure(); if (!a.ready()) { vnotify('warning', 'بنحمّل المنتجات — جرّب كمان ثانية.'); return; }
    if (kind === 'move') a.makerMove(ids, done); else a.makerPrice(ids);
  }
  function rateForm(ids, done) {
    if (!vstore.canRate()) { vnotify('error', 'مش من صلاحياتك'); return; }
    const vs = ids.map((i) => vstore.get(i)).filter(Boolean); const K = window.IBKit;
    K.form({ title: 'تعديل نسبة إبتكر — ' + (vs.length === 1 ? '«' + vs[0].name + '»' : vs.length + ' مبتكرين'), values: { rate: vs.length === 1 && vs[0].rate != null ? String(vs[0].rate) : '' }, submitLabel: 'غيّر النسبة',
      note: h('p', { class: 't-small help', style: 'margin:0' }, vs.map((v) => v.name + (v.rate != null ? ' (' + v.rate + '%)' : '')).join(' · ')),
      fields: (f, e, set) => [K.field.text('rate', 'نسبة إبتكر الجديدة (%)', f, e, set, { required: true, inputmode: 'decimal', help: 'من النهارده على الأوردرات الجديدة بس — القديمة زي ما هي. بتتبعت لمتجر المبتكر على الموقع.' }),
        U.InlineNote({ kind: 'warning', children: 'النسبة بتتغير على مستوى المبتكر (كل منتجاته)، مش لمنتج لوحده.' })],
      validate: (f) => { const r = Number(String(f.rate).trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))); return Number.isFinite(r) && r >= 0 && r <= 65 && String(f.rate).trim() !== '' ? {} : { rate: 'اكتب نسبة من 0 لـ 65' }; },
      submit: (f) => { const r = Number(String(f.rate).trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))); let n = 0;
        vs.forEach((v) => { try { vstore.setRate(v.id, r, null, vstore.actor()); n++; } catch (err) { vnotify('error', err.message); } });
        done(); if (n) vnotify('success', 'اتغيرت نسبة إبتكر لـ ' + n + (n === 1 ? ' مبتكر' : ' مبتكرين') + ' — ' + r + '% على الأوردرات الجديدة.'); } });
  }
  const makerMenuItems = (v) => [{ label: 'تعديل الأسعار', icon: 'edit', run: () => makerAct('price', [v.id]) }, vstore.canRate() ? { label: 'تعديل نسبة إبتكر', icon: 'sliders', run: () => makerAct('rate', [v.id]) } : null, { label: 'نقل المنتجات لمبتكر تاني', icon: 'users', run: () => makerAct('move', [v.id]) }, { label: 'منتجاته', icon: 'box', run: () => goMakerProducts(v) }, { label: 'أوردراته', icon: 'external', run: () => { if (vdrawer) vdrawer.close(); showOrders({ vendor: v.name }); } }];
  function goMakerProducts(v) { const a = PAPI(); if (vdrawer) vdrawer.close(); if (!a) return; go('products'); a.openRecords({ vendor: v.name }); }
  // the drawer's products tab follows the mirror (a load, a write); the makers list carries no product counts of its own
  document.addEventListener('ib:products', () => { if (vredraw && vtab === 'products') vredraw(); if (state.page === 'vendors' && state.vsel.size && !document.querySelector('.pop-anchor .menu, .modal[role=dialog]')) renderVendors(true); });
  let vnote = null; const vnotify = (kind, text) => { vnote = { kind, text }; renderVendors(); };
  // plan 3.4 decision 10 (owner, 27 Oct): «مزامنة دلوقتي» — the site's store changes now instead of at the next quarter-hour run (admin)
  function syncNowBtn() {
    if (!vstore.canSyncNow || !vstore.canSyncNow()) return null;
    const busy = vstore.syncing();
    return Button({ label: busy ? 'بيزامن مع الموقع…' : 'مزامنة دلوقتي', disabled: busy, attrs: { 'data-sync-now': '', 'aria-busy': busy ? 'true' : 'false', title: 'هات تعديلات المتاجر من الموقع دلوقتي' }, onClick: () => {
      vstore.syncNow().then((r) => {
        if (r.result === 'busy') return;
        if (r.result === 'ok') vnotify(r.conflicts ? 'warning' : 'success', r.fromSite ? 'اتزامن مع الموقع — اتحدّث ' + r.fromSite + ' مبتكر من الموقع' + (r.conflicts ? '، و' + r.conflicts + ' فيهم تعارض (الموقع كسب)' : '') + '.' : 'اتزامن مع الموقع — مفيش تعديلات جديدة.');
        else vnotify('error', r.reason === 'woo_down' ? 'الموقع مش بيرد دلوقتي — جرّب كمان شوية.' : r.reason === 'forbidden' ? 'مش من صلاحياتك' : 'المزامنة ماكملتش — جرّب تاني.');
      });
    } });
  }
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
  // the makers' numbers + their «التفاصيل» — shared by the makers page and the reports page's makers tab (phase 9: the v2's makerSummary);
  // opts.inPlace: a row opens the maker's drawer where you are (the reports page) instead of on the makers page
  function makerSummary(opts) {
    const all = vstore.all(); const stats = vendorStats(); const sum = VD.summary(all, stats);
    // «التفاصيل» on the 4 KPIs (owner, 22 Oct) — rows from VD.summaryDetails, a row opens the vendor file.
    const vdet = (kind) => { const d = VD.summaryDetails(all, stats); const money = (x) => D.formatMoney(x); const vstat = (v) => stats[v.id] || {};
      const open = (list) => (i) => openVendor(list[i].id, opts && opts.inPlace ? { inPlace: true } : undefined);
      if (kind === 'active') { const l = d.active.slice().sort((a, b) => (vstat(b).open || 0) - (vstat(a).open || 0)); return { title: 'المبتكرين النشطين — ' + l.length, sub: 'من ' + sum.total + ' مبتكر مسجّل · مرتبين بعدد الأوردرات المفتوحة · اضغط على أي صف يفتح ملفه', summary: [{ label: 'نشط', value: String(sum.active) }, { label: 'غير نشط', value: String(sum.total - sum.active) }, { label: 'أوردرات مفتوحة', value: String(l.reduce((x, v) => x + (vstat(v).open || 0), 0)) }], headers: ['المبتكر', 'الفئة', 'النسبة', 'أوردرات مفتوحة', 'قابلة للتأخير', 'مستحقاته', 'آخر أوردر'], rows: l.map((v) => [v.name, v.category || '—', v.rate == null ? '—' : v.rate + '%', String(vstat(v).open || 0), String(vstat(v).late || 0), money(vstat(v).balance || 0), ageLabel(vstat(v).lastAge)]), onRow: open(l), source: 'جدول المبتكرين + الأوردرات لايف' }; }
      if (kind === 'delay') { const l = d.delay; return { title: 'مبتكرين عندهم أوردرات قابلة للتأخير / متأخرة — ' + l.length, sub: 'قاعدة 9 / 11 يوم على الأوردرات المفتوحة · نفس مصدر إشعار «مبتكرين متأخرين»', summary: [{ label: 'مبتكرين', value: String(l.length) }, { label: 'قابل للتأخير', value: String(l.reduce((x, r) => x + r.risk, 0)) + ' أوردر' }, { label: 'متأخر', value: String(l.reduce((x, r) => x + r.late, 0)) + ' أوردر' }], headers: ['المبتكر', 'قابل للتأخير', 'متأخر', 'أوردرات مفتوحة', 'أقدم أوردر مفتوح', 'الموبايل'], rows: l.map((r) => { const v = all.find((x) => x.id === r.id); return [r.name, String(r.risk), String(r.late), String(r.open), r.oldest + ' يوم', v && v.phone || '—']; }), total: ['الإجمالي', String(l.reduce((x, r) => x + r.risk, 0)), String(l.reduce((x, r) => x + r.late, 0)), String(l.reduce((x, r) => x + r.open, 0)), '—', '—'], onRow: (i) => openVendorLate(l[i].name, 'all'), note: 'قابل للتأخير = عمر الأوردر 9–11 يوم · متأخر = أكتر من 11 يوم (مدة التسليم 12–15 يوم).', source: 'الأوردرات لايف' }; }
      if (kind === 'due') { const l = d.due; return { title: 'مستحقات المبتكرين — ' + money(sum.due) + ' ج.م', sub: l.length + ' مبتكر ليهم رصيد لصالحهم', summary: [{ label: 'الإجمالي', value: money(sum.due) + ' ج.م' }, { label: 'مبتكرين', value: String(l.length) }, { label: 'أكبر رصيد', value: l.length ? l[0].name + ' — ' + money(l[0].balance) : '—' }], headers: ['المبتكر', 'الرصيد (له)', 'من الإجمالي'], rows: l.map((r) => [r.name, money(r.balance), (sum.due ? Math.round(r.balance / sum.due * 100) : 0) + '%']), total: ['الإجمالي', money(l.reduce((x, r) => x + r.balance, 0)), '100%'], onRow: open(l), source: 'الأوردرات المكتملة من 1 أكتوبر بنسبة الموقع على كل سطر (الافتتاحي والعرابين من مرحلة الحسابات)' }; }
      const l = d.negative; return { title: 'مبتكرين عندهم رصيد سالب (عرابين / مواصلات) — ' + l.length, sub: 'عرابين اتدفعت لهم قبل ما الأوردرات تكتمل — بتتخصم من مستحقاتهم', summary: [{ label: 'إجمالي العرابين', value: money(sum.negativeTotal) + ' ج.م' }, { label: 'مبتكرين', value: String(l.length) }], headers: ['المبتكر', 'العربون', 'المواصلات', 'الرصيد (عليه)', 'أوردرات مفتوحة'], rows: l.map((r) => [r.name, money(r.deposits), money((vendorsNow().find((x) => x.name === r.name) || {}).transport || 0), money(r.balance), String((stats[r.id] || {}).open || 0)]), total: ['الإجمالي', money(l.reduce((x, r) => x + r.deposits, 0)), money(l.reduce((x, r) => x + ((vendorsNow().find((y) => y.name === r.name) || {}).transport || 0), 0)), money(l.reduce((x, r) => x + r.balance, 0)), String(l.reduce((x, r) => x + ((stats[r.id] || {}).open || 0), 0))], onRow: open(l), source: 'العرابين والمواصلات بيتسجلوا من مرحلة الحسابات' };
    };
    return { all, stats, sum, vdet };
  }
  function VendorsPageView() {
    const { all, stats, sum, vdet } = makerSummary();
    const vPass = (f) => (v) => ['status', 'category', 'balance', 'contract', 'other'].every((k) => !(f[k] || []).length || f[k].some((val) => VD.filterVendors([v], stats, k === 'other' ? { status: 'all', [val]: true } : { status: 'all', [k]: val }, VTODAY()).length));
    const base0 = vfilter(all, stats, { status: 'all', q: state.vfilter.q });
    const list = VD.sortVendors(base0.filter(vPass(state.vf)), stats, state.vsort);
    const pages = Math.max(1, Math.ceil(list.length / VPAGE)); if (state.vpage > pages) state.vpage = pages;
    const slice = list.slice((state.vpage - 1) * VPAGE, state.vpage * VPAGE);
    const setF = (k, v) => { state.vfilter[k] = v; state.vpage = 1; renderVendors(); };
    const sel = (label, options, value, key) => { const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '', style: 'display:block' }); const cur = options.find((o) => o.value === value);
      const btn = h('button', { type: 'button', class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label, style: 'width:auto;min-width:140px' }, Icon('chevD', 'sm'), h('span', { class: 'val' }, label + ': ' + (cur ? cur.label : '—')));
      const pop = U.popover(wrap, btn, (close) => U.DropdownMenu({ options, value, onSelect: (v) => { close(); setF(key, v); } })); btn.addEventListener('click', pop.toggle); wrap.append(btn); return wrap; };
    const search = h('input', { type: 'search', class: 'input', placeholder: 'ابحث بالاسم أو الهاتف أو الاسم البديل أو البراند', 'aria-label': 'بحث في المبتكرين', value: state.vfilter.q, style: 'width:320px;max-width:100%' });
    search.addEventListener('input', () => { state.vfilter.q = search.value; state.vpage = 1; renderVendors(true); });
    const check = (key, label) => h('label', { class: 'check', style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, (() => { const c = h('input', { type: 'checkbox', checked: state.vfilter[key] }); c.addEventListener('change', () => setF(key, c.checked)); return c; })(), label);
    // «فلتر» + «ترتيب» (phase 5.5 decision 3, owner 1 Nov): the kit's closed multi-value filter and sort next to the columns button, the picks as chips with their counts
    const VF = { status: [['active', 'نشط'], ['leave', 'في إجازة'], ['inactive', 'غير نشط']], balance: [['due', 'ليه رصيد'], ['negative', 'عليه (عربون / مواصلات)'], ['zero', 'متصفّي']], contract: [['uploaded', 'مرفوع وساري'], ['expiring', 'بينتهي خلال 30 يوم'], ['expired', 'منتهي'], ['missing', 'غير مرفوع']] };
    const VG = () => [{ key: 'status', label: 'الحالة', options: VF.status }, { key: 'category', label: 'الفئة', options: mainCats().map((c) => [String(c.id), c.name]) }, { key: 'balance', label: 'الرصيد', options: VF.balance }, { key: 'contract', label: 'العقد', options: VF.contract }, { key: 'other', label: 'المتابعة', options: [['late', 'عنده تأخير'], ['tickets', 'عليه تذاكر']] }];
    function vFilterBtn() {
      return window.IBKit.FilterMenu({ id: 'vendors', label: 'فلتر المبتكرين', noun: 'مبتكر', groups: VG(), value: state.vf, count: (d) => base0.filter(vPass(d)).length, onApply: (d) => { state.vf = d; state.vpage = 1; renderVendors(); } });
    }
    function vSortBtn() {
      return window.IBKit.SortMenu({ id: 'vendors', label: 'ترتيب المبتكرين', options: VD.VENDOR_SORTS.map((x) => [x.value, x.label]), value: state.vsort, onChange: (v) => { state.vsort = v; state.vpage = 1; renderVendors(); } });
    }
    function vChips() {
      const f = state.vf; const chips = [];
      VG().forEach((g) => (f[g.key] || []).forEach((val) => { const lbl = (g.options.find((o) => o[0] === val) || [, val])[1];
        chips.push({ key: g.key + ':' + val, label: (g.key === 'other' ? '' : g.label + ': ') + lbl, count: base0.filter(vPass({ [g.key]: [val] })).length, remove: () => { f[g.key] = f[g.key].filter((x) => x !== val); state.vpage = 1; renderVendors(); } }); }));
      return window.IBKit.ActiveFilters({ id: 'vendors', chips, total: list.length, noun: 'مبتكر', onClear: () => { state.vf = { status: [], category: [], balance: [], contract: [], other: [] }; state.vpage = 1; renderVendors(); } });
    }
    // the bulk selection (decision 3, owner 31 Oct): a checkbox per row, «حدد كل الصفحة», the bar with the three actions
    const VS = state.vsel; [...VS].forEach((i) => { if (!vstore.get(i)) VS.delete(i); });
    const KK = window.IBKit; const stop = (el) => { el.addEventListener('click', (e) => e.stopPropagation()); el.addEventListener('keydown', (e) => e.stopPropagation()); return el; };
    const selBox = (v) => { const c = KK.Checkbox({ label: '', checked: VS.has(v.id), onChange: (on) => { if (on) VS.add(v.id); else VS.delete(v.id); renderVendors(); } }); c.setAttribute('data-vsel', v.id); c.setAttribute('aria-label', 'حدد ' + v.name); return stop(c); };
    const rowMenu = (v) => stop(KK.RowMenu(makerMenuItems(v), 'إجراءات ' + v.name));
    const headers = ['المبتكر', 'الحالة', 'النسبة', 'أوردرات مفتوحة', 'قابلة للتأخير', 'العربون', 'المواصلات', 'مستحقاته (من 1 أكتوبر)', 'آخر أوردر', 'تذاكر مفتوحة'];
    const later = (phase) => h('span', { class: 't-small', style: 'color:var(--color-text-secondary)', title: 'من مرحلة ' + phase }, '—'); // decision 4: deposits / transport with phase 4, tickets with phase 7
    const cells = (v) => { const st = stats[v.id]; return [h('span', { class: 'vendor-cell' }, U.VendorLogo({ letter: v.logoLetter, size: 'sm' }), h('span', { class: 'vnames' }, h('span', { class: 't-label' }, v.name), brandLine(v))), v.siteRemovedAt ? h('span', { class: 'chips' }, U.VendorStatus(v.status), h('span', { class: 'tg tg-error', 'data-site-removed': '' }, 'اتحذف من الموقع')) : U.VendorStatus(v.status), v.rate == null ? '—' : num(v.rate + '%'), num(String(st.open)), num(String(st.late)), later(4), later(4), h('span', { class: st.balance < 0 ? 'bal-neg' : '' }, num(D.formatMoney(st.balance))), num(ageLabel(st.lastAge)), later(7)]; }; // مستحقاته = الافتتاحي + حقه من الأوردرات المكتملة
    const pageAll = slice.length > 0 && slice.every((v) => VS.has(v.id));
    const allBox = (() => { const c = KK.Checkbox({ label: '', checked: pageAll, onChange: (on) => { slice.forEach((v) => (on ? VS.add(v.id) : VS.delete(v.id))); renderVendors(); } }); c.setAttribute('aria-label', 'حدد كل الصفحة'); c.setAttribute('data-vsel-all', ''); if (!pageAll && slice.some((v) => VS.has(v.id))) c.setAttribute('aria-checked', 'mixed'); return c; })();
    const selIds = [...VS]; const selN = selIds.length;
    if (selN) { const pa = PAPI(); if (pa) pa.ensure(); } // the bar's product count needs the mirror
    const bulk = selN ? h('div', { class: 'bulk-bar', role: 'region', 'aria-label': 'إجراءات على المحدد', 'data-vbulk': '' }, h('b', null, 'محدد ' + selN + (selN === 1 ? ' مبتكر' : ' مبتكرين')), h('span', { class: 't-small help', 'data-vbulk-products': '' }, num(prodCount(selIds) + ' منتج')), h('span', { class: 'grow' }),
      Button({ size: 'sm', icon: 'users', label: 'نقل المنتجات لمبتكر تاني', attrs: { 'data-vbulk-move': '' }, onClick: () => makerAct('move', selIds, () => VS.clear()) }),
      Button({ size: 'sm', icon: 'edit', label: 'تعديل الأسعار', attrs: { 'data-vbulk-price': '' }, onClick: () => makerAct('price', selIds) }),
      vstore.canRate() ? Button({ size: 'sm', icon: 'sliders', label: 'تعديل نسبة إبتكر', attrs: { 'data-vbulk-rate': '' }, onClick: () => makerAct('rate', selIds, () => VS.clear()) }) : null,
      Button({ type: 'text', size: 'sm', label: 'إلغاء التحديد', attrs: { 'data-vbulk-clear': '' }, onClick: () => { VS.clear(); renderVendors(); } })) : null;
    const table = h('div', { class: 'scroll-x' }, h('table', { class: 'tickets-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'sel-col' }, allBox), headers.map((x) => h('th', { scope: 'col' }, x)), h('th', { scope: 'col', class: 'act-col' }, h('span', { class: 'sr-only' }, 'إجراءات')))), h('tbody', null, slice.map((v) => { const tr = h('tr', { 'data-id': v.id, tabindex: '0', role: 'button', 'aria-label': 'فتح ملف ' + v.name, class: VS.has(v.id) ? 'is-sel' : null }, h('td', { class: 'sel-col' }, selBox(v)), cells(v).map((c) => h('td', null, c)), h('td', { class: 'act-col' }, rowMenu(v))); tr.addEventListener('click', () => openVendor(v.id)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVendor(v.id); } }); return tr; }))));
    const cards = h('div', { class: 'kv-list' }, slice.map((v) => { const cs = cells(v); const c = h('div', { class: 'card list-card', tabindex: '0', role: 'button' }, h('div', { class: 'title vcard-title' }, selBox(v), cs[0], h('span', { class: 'grow' }), rowMenu(v)), headers.slice(1).map((k, i) => h('div', { class: 'kv' }, h('span', { class: 't-small' }, k), h('span', { class: 't-body' }, cs[i + 1])))); c.addEventListener('click', () => openVendor(v.id)); c.addEventListener('keydown', (e) => { if (e.key === 'Enter') openVendor(v.id); }); return c; }));
    const pager = h('div', { class: 'pager' }, h('div', { class: 'pages' }, Button({ type: 'text', size: 'sm', label: 'السابق', disabled: state.vpage <= 1, onClick: () => { state.vpage--; renderVendors(); } }), Array.from({ length: pages }, (_, i) => Button({ type: i + 1 === state.vpage ? 'primary' : 'text', size: 'sm', label: String(i + 1), onClick: () => { state.vpage = i + 1; renderVendors(); } })), Button({ type: 'text', size: 'sm', label: 'التالي', disabled: state.vpage >= pages, onClick: () => { state.vpage++; renderVendors(); } })),
      h('span', { class: 't-small' }, num(list.length ? 'عرض ' + ((state.vpage - 1) * VPAGE + 1) + '–' + Math.min(list.length, state.vpage * VPAGE) + ' من ' + list.length : '')));
    // phase 13 decision 57 (owner 11 Nov — «قسّم صفحة المبتكرين تابس: نظرة عامة، سجل المبتكرين، حسابات المبتكرين، سجل الحركات، التقارير»):
    // the cards on «نظرة عامة», the table (search, filter, bulk) on «سجل المبتكرين», the accounts page's own «حسابات المبتكرين» (it stays
    // there too), the makers' add / stop / activate / delete log, and the reports page's makers report — the tabs a member may see only
    const noteEl = () => (vnote ? (() => { const n = vnote; vnote = null; const el = U.InlineNote({ kind: n.kind, children: n.text, action: IconButton({ icon: 'close', label: 'إخفاء', onClick: () => el.remove() }) }); return el; })() : null);
    const vt = makerTabs(); if (!vt.some((t) => t.id === state.vtab)) state.vtab = vt[0].id;
    const tabsEl = U.Tabs({ items: vt, active: state.vtab, onChange: (id) => { state.vtab = id; renderVendors(); } }); tabsEl.setAttribute('aria-label', 'أقسام المبتكرين');
    const headEl =
      h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'المبتكرين'), h('p', { class: 't-small' }, 'ملف كل مبتكر: البيانات والعقد والحساب البنكي، وأوردراته ورصيده — المبتكر هو المرجع الأساسي للأوردرات والنسب')),
        h('div', { class: 'actions' }, (vpKey() ? window.IBKit.PanelButton(vpKey(), 'المبتكرين — ' + (MAKER_TABS.find((t) => t.id === state.vtab) || MAKER_TABS[0]).label, () => document.getElementById('vpanel'), renderVendors) : null), window.IBDataActions.Menu(window.IBDataActions.PAGES.vendors), syncNowBtn(), Button({ type: 'brand', icon: 'plus', label: 'إضافة مبتكر', disabled: !vstore.canEdit(), onClick: () => openAddVendor() })));
    const body = state.vtab === 'overview' ? [noteEl(),
      h('div', { class: 'cards five' },
        U.KpiTile({ label: 'مبتكرين نشطين', value: String(sum.active), unit: 'مبتكر', compare: 'off', note: 'من ' + sum.total + ' مبتكر مسجّل', details: () => vdet('active') }),
        U.KpiTile({ label: 'عندهم أوردرات قابلة للتأخير — الآن', value: String(sum.withDelay), unit: 'مبتكرين', compare: sum.withDelay ? 'negative' : 'off', delta: { text: 'متابعة', caption: 'نفس مصدر إشعار «مبتكرين متأخرين»' }, note: 'قاعدة 9 / 11 يوم على الأوردرات المفتوحة', details: () => vdet('delay') }),
        U.KpiTile({ label: 'إجمالي مستحقات المبتكرين — الآن', value: D.formatMoney(sum.due), unit: 'ج.م', compare: 'off', note: 'من الأوردرات المكتملة من 1 أكتوبر · الافتتاحي والعرابين من مرحلة 4', details: () => vdet('due') }),
        U.KpiTile({ label: 'عندهم رصيد سالب (عرابين) — الآن', value: String(sum.negative), unit: 'مبتكرين', compare: 'off', note: 'العرابين والمواصلات بيتسجلوا من مرحلة الحسابات', details: () => vdet('negative') }),
        U.KpiTile({ label: 'مواصلات المبتكرين', value: '—', compare: 'off', note: 'بتتسجل من مرحلة الحسابات (4)' })),
      h('p', { class: 'source' }, 'المصدر: جدول المبتكرين (متاجر الموقع من المزامنة + اللي الفريق بيكمّله) — الأسماء البديلة لتوحيد الأوردرات والشيت · المستحقات من الأوردرات المكتملة من 1 أكتوبر بنسبة الموقع على كل سطر · الأوردرات والتأخير لايف من الأوردرات')]
      : state.vtab === 'records' ? [
      h('div', { class: 'toolbar vtoolbar' }, search, h('span', { class: 'grow' }), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, num(list.length + ' مبتكر · ' + (VD.VENDOR_SORTS.find((x) => x.value === state.vsort) || {}).label))),
      noteEl(),
      TableCard({ title: 'المبتكرين', cls: 'own-filter', count: list.length + ' مبتكر · ' + ((VD.VENDOR_SORTS.find((x) => x.value === state.vsort) || {}).label || ''), action: h('span', { class: 'acts-inline' }, vFilterBtn(), vSortBtn()), pre: [vChips(), bulk], // the owner 12 Nov: «فلتر» next to the sort
        body: list.length === 0 ? U.EmptyState(state.vfilter.q ? 'مفيش مبتكر بالاسم ده' : 'مفيش مبتكر بالفلتر ده', 'جرّب اسم بديل أو رقم الهاتف، أو شيل اختيار من الفلتر، أو اضغط «إضافة مبتكر» لو جديد.') : [tableOrList(() => table, () => cards), pager] })]
      : state.vtab === 'accounts' ? makersAccountsTab() : state.vtab === 'log' ? makersLogTab() : makersReportsTab();
    return [headEl, tabsEl, h('div', { id: 'vpanel', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.vtab, style: 'display:flex;flex-direction:column;gap:24px;min-width:0' }, ...body.filter(Boolean))];
  }
  // phase 13 decision 57: the makers page's tabs — «حسابات المبتكرين» with accounts.view ≠ N, «التقارير» with the reports page's own
  // makers-tab rule (reports.view ≠ N and vendors.view ≠ N)
  const MAKER_TABS = [{ id: 'overview', label: 'نظرة عامة' }, { id: 'records', label: 'سجل المبتكرين' }, { id: 'accounts', label: 'حسابات المبتكرين' }, { id: 'log', label: 'سجل الحركات' }, { id: 'reports', label: 'التقارير' }];
  // «تخصيص اللوحة» per tab (decision 57): the cards keep the old key «makers», the register its own, the accounts tab the accounts page's
  const vpKey = () => ({ overview: 'makers', records: 'makers:records', accounts: 'accounts:vendors' }[state.vtab] || null);
  const makerTabs = () => MAKER_TABS.filter((t) => (t.id === 'accounts' ? rperm('accounts.view') !== 'N' : t.id === 'reports' ? reportTabs().some((x) => x.id === 'vendors') : true));
  // 0078 (the owner, 11 Nov): «الرصيد دلوقتي» is now — no period; «كشف بالفترة» has its own range, «كل الفترات» by default; «إجراء»
  function vendorsToolbar() {
    return h('div', { class: 'toolbar' }, state.vsub === 'ledger' ? DateRangeField('vledger') : null,
      state.vsub === 'ledger' && state.vlrange ? Button({ type: 'text', size: 'sm', label: 'كل الفترات', attrs: { 'data-vl-all': '' }, onClick: () => { state.vlrange = null; render(); } }) : null,
      SortDropdown(), state.vsub !== 'ledger' ? WdFilterDropdown() : null, h('span', { class: 'grow' }), canAdd() ? AddMenu('إضافة مبلغ', 'vendorMoves') : null); // the owner 12 Nov: «إضافة مبلغ» again (was «إجراء» from 0078)
  }
  function makersAccountsTab() {
    refreshSeed(); state.tab = 'vendors';
    const note = state.note; state.note = null; shownNote = note;
    const noteEl = note ? U.InlineNote({ kind: note.kind, children: note.text, action: note.undo ? Button({ type: 'text', size: 'sm', label: 'تراجع', onClick: note.undo }) : IconButton({ icon: 'close', label: 'إخفاء', onClick: () => { noteEl.remove(); } }) }) : null;
    return [vendorsToolbar(), noteEl].concat(VendorsTab());
  }
  function makersReportsTab() {
    return [h('div', { class: 'toolbar' }, DateRangeField('reports'), h('span', { class: 'grow' }), Button({ type: 'text', size: 'sm', label: 'افتح في صفحة التقارير', attrs: { 'data-vrep-page': '' }, onClick: () => { state.rtab = 'vendors'; state.vtab = 'overview'; go('reports'); } }))].concat(VendorsReportView());
  }
  // «سجل الحركات»: add / stop / activate / delete a maker (IBVendors.loadMakersLog — the server's activity_log). The owner (11 Nov — «اظبط
  // الفلتر يبقي اسهل»، picked «زرار فلتر واحد بس»): one «فلتر» (الحركة · المبتكر · بواسطة, several picks each) and its chips while one is
  // on — the kind chips, the kit's sort and the columns button are gone; the newest first, as the server sends it
  const LOG_KIND = { create: 'إضافة مبتكر', remove: 'مسح', active: 'تنشيط', inactive: 'توقيف', leave: 'إجازة', site: 'اتغيرت الحالة من الموقع' };
  const VLOG_F0 = () => ({ kind: [], maker: [], by: [] });
  let vlogAsked = false; state.vlogF = VLOG_F0();
  function makersLogTab() {
    const V = window.IBVendors;
    if (V && V.loadMakersLog && !vlogAsked) { vlogAsked = true; V.loadMakersLog().then(() => { if (state.page === 'vendors' && state.vtab === 'log') renderVendors(); }); }
    const raw = V && V.makersLog ? V.makersLog() : null;
    const kindOf = (e) => (e.kind === 'status' ? (e.action === 'vendor.sync' ? 'site' : ['active', 'inactive', 'leave'].includes(e.value) ? e.value : 'site') : e.kind);
    const nameOf = (e) => { const v = e.vendorId && vstore.get(e.vendorId); return v ? v.name : (e.kind === 'create' || e.kind === 'remove') && e.value ? e.value : '—'; };
    const byOf = (e) => (e.actor && e.actor.name) || (e.k === 'site' ? 'الموقع' : '—');
    const all = (raw || []).map((e) => Object.assign({}, e, { k: kindOf(e) })).map((e) => Object.assign(e, { maker: nameOf(e), by: byOf(e) }));
    const F = state.vlogF || VLOG_F0();
    const pass = (e, f, skip) => (skip === 'kind' || !f.kind.length || f.kind.includes(e.k)) && (skip === 'maker' || !f.maker.length || f.maker.includes(e.maker)) && (skip === 'by' || !f.by.length || f.by.includes(e.by));
    const rows = all.filter((e) => pass(e, F));
    const uniq = (f) => [...new Set(all.map(f))].sort((a, b) => a.localeCompare(b, 'ar'));
    const groups = [{ key: 'kind', label: 'الحركة', options: Object.keys(LOG_KIND).filter((k) => k !== 'site' || all.some((e) => e.k === 'site')).map((k) => [k, LOG_KIND[k]]) },
      { key: 'maker', label: 'المبتكر', options: uniq((e) => e.maker).map((n) => [n, n]) }, { key: 'by', label: 'بواسطة', options: uniq((e) => e.by).map((n) => [n, n]) }];
    const filterBtn = window.IBKit.FilterMenu({ id: 'vlog', groups, value: F, noun: 'حركة', label: 'فلتر سجل الحركات', count: (d) => all.filter((e) => pass(e, d)).length, onApply: (d) => { state.vlogF = d; renderVendors(); } });
    const chips = window.IBKit.ActiveFilters({ id: 'vlog', noun: 'حركة', total: rows.length, onClear: () => { state.vlogF = VLOG_F0(); renderVendors(); },
      chips: groups.flatMap((g) => (F[g.key] || []).map((v) => ({ key: g.key + ':' + v, label: (g.options.find((o) => o[0] === v) || [v, v])[1], count: all.filter((e) => pass(e, F, g.key) && (g.key === 'kind' ? e.k : e[g.key]) === v).length,
        remove: () => { state.vlogF = Object.assign({}, F, { [g.key]: F[g.key].filter((x) => x !== v) }); renderVendors(); } }))) });
    const tone = { create: 'success', remove: 'error', active: 'success', inactive: 'neutral', leave: 'gold', site: 'neutral' };
    const body = raw == null ? U.InlineNote({ children: 'بنحمّل سجل الحركات…' }) : rows.length ? U.Table({ cls: 'tickets-table', headers: ['التاريخ', 'المبتكر', 'الحركة', 'بواسطة'], rows: rows.map((e) => [fmtTime(e.at), (() => { const v = e.vendorId && vstore.get(e.vendorId); return v ? h('a', { href: '#makers/' + v.id, 'data-vlog-open': v.id, onClick: (ev) => { ev.preventDefault(); openVendor(v.id); } }, v.name) : e.maker; })(), h('span', { class: 'tg tg-' + (tone[e.k] || 'neutral'), 'data-vlog-row': e.k }, LOG_KIND[e.k] || e.k), e.by]) })
      : U.EmptyState(all.length ? 'مفيش حركات بالفلتر ده' : 'لسه مفيش حركات', all.length ? 'شيل اختيار من «فلتر» أو اضغط «مسح الكل».' : 'إضافة مبتكر وتوقيفه وتنشيطه ومسحه بيتسجلوا هنا.');
    const card = TableCard({ title: 'سجل الحركات', cols: false, cls: 'own-filter', count: raw == null ? '' : num(rows.length + ' حركة'), pre: chips, // the owner 12 Nov: «فلتر» back in the header
      action: h('span', { class: 'acts-inline' }, filterBtn, Button({ type: 'text', size: 'sm', icon: 'refresh', label: 'تحديث', attrs: { 'data-vlog-refresh': '' }, onClick: () => { vlogAsked = false; renderVendors(); } })), body });
    card.setAttribute('data-no-cols', ''); // one button only (the owner): the kit's sweep leaves this card without «أعمدة الجدول»
    return [card, h('p', { class: 'source' }, 'المصدر: سجل النشاط — إضافة مبتكر، تغيير حالته (نشط / غير نشط / في إجازة) من الفريق أو من الموقع، ومسحه من السيستم · آخر 200 حركة.')];
  }
  function renderVendors(keepFocus) {
    U.closePopover(); const main = document.getElementById('vendors'); if (!main) return; const sc = window.scrollY; const had = keepFocus && document.activeElement && document.activeElement.type === 'search';
    main.replaceChildren(...VendorsPageView().filter(Boolean)); if (vpKey()) window.IBKit.applyPanelPrefs(vpKey(), main.querySelector('#vpanel')); window.IBKit.sweepColumns(main); window.scrollTo(0, sc); if (had) { const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
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
  function bankFields(f, errs, redraw, px, optional) { // optional (phase 13 decision 51): «إضافة مبتكر» — the bank can wait
    const m = f.method; const t = (id, label, key, o = {}) => U.TextInput(Object.assign({ id: px + '-' + id, label, value: f[key], error: errs[key], onInput: (x) => { f[key] = x; } }, o));
    return [U.Select({ id: px + '-method', label: 'طريقة التحويل', required: !optional, options: (optional ? [{ value: '', label: 'من غير حساب دلوقتي' }] : []).concat(VD.PAY_METHODS.map(([k, l]) => ({ value: k, label: l }))), value: m, error: errs.method, placeholder: optional ? 'اختياري — تقدر تضيفه بعدين' : 'اختار الطريقة', help: optional ? 'اختياري — لو سيبته هيظهر «ناقص» في ملف المبتكر لحد ما يتكمّل' : undefined, onChange: (x) => { f.method = x; redraw(); } }),
      m && m !== 'cash' ? t('holder', 'اسم صاحب الحساب', 'holder', { required: true, help: 'زي ما هو مكتوب في البنك / المحفظة بالظبط' }) : null,
      // phase 3.5 (plan decision 6): every field of Dokan's «Payment Options» — the account number and the IBAN apart
      m === 'bank' ? h('div', { class: 'row cols2' }, t('bank', 'البنك', 'bankName', { required: true, placeholder: 'البنك الأهلي المصري' }), U.Select({ id: px + '-actype', label: 'نوع الحساب', options: VD.BANK_ACCOUNT_TYPES.concat(f.accountType && !VD.BANK_ACCOUNT_TYPES.some((x) => x[0] === f.accountType) ? [[f.accountType, f.accountType]] : []).map(([k, l]) => ({ value: k, label: l })), value: f.accountType || '', placeholder: 'اختار النوع', onChange: (x) => { f.accountType = x; } })) : null,
      m === 'bank' ? h('div', { class: 'row cols2' }, t('acno', 'رقم الحساب', 'accountNumber', { required: !f.iban, dir: 'ltr', inputmode: 'numeric', placeholder: '0000 0000 0000 0000', help: 'أو الـ IBAN — واحد منهم على الأقل' }), t('iban', 'IBAN', 'iban', { dir: 'ltr', placeholder: 'EG00 0000 0000 …', help: 'EG + 27 رقم (لو موجود)' })) : null,
      m === 'bank' ? h('div', { class: 'row cols2' }, t('swift', 'SWIFT', 'swift', { dir: 'ltr', placeholder: 'NBEGEGCX' }), t('routing', 'Routing Number', 'routingNumber', { dir: 'ltr', inputmode: 'numeric' })) : null,
      m === 'bank' ? t('baddr', 'عنوان البنك', 'bankAddress', { maxlength: 200 }) : null,
      m === 'instapay' ? t('wallet', 'رقم الموبايل أو عنوان إنستاباي', 'wallet', { required: true, dir: 'ltr', placeholder: '01xxxxxxxxx أو name@instapay' }) : null,
      m === 'wallet' ? t('wallet', 'رقم المحفظة', 'wallet', { required: true, dir: 'ltr', inputmode: 'tel', placeholder: '01xxxxxxxxx' }) : null,
      m === 'cash' ? U.InlineNote({ children: 'التحويل نقدي عند التسليم — مفيش بيانات بنكية مطلوبة.' }) : null].filter(Boolean);
  }

  // plan 3.4 (decision 6) — shared by «الاتفاق التجاري» and «إضافة مبتكر» (the owner, 11 Nov): the category tree of the commission on
  // f.rate / f.flat / f.cat ({ id: { rate, flat } } as typed), the open branches in `openCats`. → { editor, refresh }
  function catTreeKit(f, openCats) {
    const ctree = VD.categoryTree(vstore.categories ? vstore.categories() : []); let catWrap = null;
    const arN = (x) => String(x == null ? '' : x).trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
    const handSet = () => Object.fromEntries(Object.entries(f.cat).filter(([, c]) => arN(c.rate) !== '').map(([k, c]) => [k, { rate: arN(c.rate), flat: arN(c.flat) }]));
    function refreshCats() {
      if (!catWrap) return;
      const fig = VD.categoryFigures(ctree, handSet(), { rate: arN(f.rate) === '' ? null : Number(arN(f.rate)), flat: arN(f.flat) === '' ? null : Number(arN(f.flat)) });
      catWrap.querySelectorAll('[data-cat]').forEach((row) => { const g2 = fig[row.getAttribute('data-cat')]; if (!g2) return; const [ri, fi] = row.querySelectorAll('input');
        ri.placeholder = g2.rate == null ? '' : String(g2.rate); fi.placeholder = g2.flat == null ? '' : String(g2.flat); row.classList.toggle('is-own', !g2.inherited); });
    }
    function setCat(cid, key, val) { const c = Object.assign({ rate: '', flat: '' }, f.cat[cid], { [key]: val }); if (arN(c.rate) === '' && arN(c.flat) === '') delete f.cat[cid]; else f.cat[cid] = c; refreshCats(); }
    function catRows(nodes, depth) {
      const out = [];
      for (const n of nodes) {
        const own = f.cat[n.id] || {}; const open = openCats.has(n.id);
        const ri = h('input', { id: 'cr-' + n.id, inputmode: 'decimal', dir: 'ltr', value: own.rate || '', 'aria-label': 'نسبة ' + n.name });
        const fi = h('input', { id: 'cf-' + n.id, inputmode: 'decimal', dir: 'ltr', value: own.flat || '', 'aria-label': 'رسوم ثابتة ' + n.name });
        ri.addEventListener('input', () => setCat(n.id, 'rate', ri.value)); fi.addEventListener('input', () => setCat(n.id, 'flat', fi.value));
        const tog = n.children.length ? h('button', { type: 'button', class: 'cat-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-label': (open ? 'اقفل' : 'افتح') + ' فئات ' + n.name, 'data-cat-toggle': n.id,
          onClick: () => { if (open) openCats.delete(n.id); else openCats.add(n.id); drawCats(); const t = catWrap.querySelector('[data-cat-toggle="' + n.id + '"]'); if (t) t.focus(); } }, open ? '−' : '+') : h('span', { class: 'cat-toggle-sp' });
        out.push(h('div', { class: 'cat-row', 'data-cat': n.id, style: '--d:' + depth }, tog, h('span', { class: 'cat-name' }, n.name),
          h('div', { class: 'input cat-in' }, h('span', { class: 'help' }, '%'), ri), h('div', { class: 'input cat-in' }, h('span', { class: 'help' }, 'ج.م'), fi)));
        if (open) out.push(...catRows(n.children, depth + 1));
      }
      return out;
    }
    function drawCats() { catWrap.replaceChildren(...catRows(ctree, 0)); refreshCats(); }
    function catEditor() {
      catWrap = h('div', { class: 'cat-tree', 'data-cat-tree': '' });
      if (!ctree.length) { catWrap.append(h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'فئات الموقع لسه ماتزامنتش — بتتجاب كل ربع ساعة.')); return catWrap; }
      drawCats();
      return h('div', null, h('div', { class: 'cat-head t-small' }, h('span', null, 'الفئة'), h('span', null, 'النسبة'), h('span', null, 'رسوم ثابتة')), catWrap,
        U.InlineNote({ children: 'الرقم اللي تكتبه في فئة بيتحط لكل الفئات اللي تحتها، إلا اللي ليها رقم خاص. الخانة الفاضية بتاخد رقم اللي فوقها (الرقم الرمادي).' }));
    }
    return { editor: catEditor, refresh: refreshCats };
  }
  // ----- add vendor modal (Figma: Modal / Add vendor; the owner's prototype of 26 Oct — phase 3.1 decision 9) -----
  // Three sections for a new maker: the basics, «بيانات الدخول» (username, e-mail and the temporary password — required; the invite
  // link was withdrawn by the owner on 26 Oct) and «الحساب البنكي» (when the caller sees bank rows; required when it shows — no IBMakerDefaults).
  // The edit popup of an existing maker (openAddVendor(existing)) is unchanged. A name or alias already in the registry is refused
  // (decision 2: every Dokan store is already here) and the file is one click away.
  function openAddVendor(existing, pre) { // pre (phase 13 decision 36): the AI assistant's values for a new maker — the member reviews and saves
    const f = existing ? { name: existing.name, legalName: existing.legalName || '', categories: (existing.categories || []).slice(), phone: existing.phone, altPhone: existing.altPhone || '', email: existing.email || '', address: existing.address || '', instagram: existing.instagram || '', storeUrl: existing.storeUrl || '', rate: String(existing.rate), leadDays: String(existing.leadDays), status: existing.status, aliases: existing.aliases.join('، '), depositPolicy: existing.depositPolicy || '', notes: existing.notes || '' }
      : { name: '', legalName: '', categories: [], phone: '', altPhone: '', email: '', address: '', instagram: '', storeUrl: '', rate: '40', leadDays: '7', status: 'active', aliases: '', depositPolicy: '', notes: '', username: '', pwMode: 'temp', password: '', method: '', bankName: '', holder: '', iban: '', wallet: '', accountNumber: '', accountType: '', bankAddress: '', routingNumber: '', swift: '',
        // the owner, 11 Nov: the commission as on Dokan («Commission» tab) and the store on the site («General» tab)
        ctype: 'fixed', flat: '', cat: {}, mkStore: !!(vstore.canStore && vstore.canStore()), shopUrl: '', shopTouched: false, first: '', last: '', trusted: false, featured: false, notify: true, showSocial: false,
        addressParts: { street_1: '', street_2: '', city: '', state: '', zip: '', country: 'EG' }, social: Object.fromEntries(VD.SOCIAL_KEYS.map(([k]) => [k, ''])) };
    if (!existing && pre && typeof pre === 'object') ['name', 'legalName', 'phone', 'altPhone', 'email', 'address', 'instagram', 'storeUrl', 'notes'].forEach((k) => { if (pre[k] != null && String(pre[k]).trim()) f[k] = String(pre[k]).trim().slice(0, 300); });
    if (!existing && pre && pre.category && vstore.mainCategoryIds) f.categories = vstore.mainCategoryIds(pre.category); // the assistant's words → the main categories that match by name
    const canBank = vstore.canBank(); const bankReq = false; // phase 13 decision 51 (owner 10 Nov — «خلي الحساب البنكي إختياري»): validated only when a method is chosen
    const canStoreMk = !existing && !!(vstore.canStore && vstore.canStore()); // the owner, 11 Nov: the store on the site with the maker
    const ctk = existing ? null : catTreeKit(f, new Set());
    const shopOf = (u) => String(u || '').toLowerCase().replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const storeSection = () => {
      const KK = window.IBKit; const sub = (fid, label, obj, key, o = {}) => U.TextInput(Object.assign({ id: fid, label, value: f[obj][key] || '', error: errs[obj] && errs[obj][key], onInput: (x) => { f[obj][key] = x; } }, o));
      const shop = f.shopUrl || shopOf(f.username);
      return [fsec('المتجر على الموقع (Dokan)', 'زي «Add New Vendor» في Dokan — حسابه على الموقع بنفس اسم المستخدم والإيميل والباسورد المؤقت اللي فوق'),
        KK.Switch({ id: 'v-mkstore', label: 'اعمل له متجر على الموقع', help: f.mkStore ? 'المتجر بيتعمل على الموقع أول ما تضغط «إضافة المبتكر»' : 'هيتسجل هنا بس — تقدر تعمل متجره بعدين من ملفه', checked: f.mkStore, onChange: (x) => { f.mkStore = x; draw(); } }),
        f.mkStore ? [
          U.TextInput({ id: 'v-shop', label: 'رابط المتجر', dir: 'ltr', value: shop, error: errs.shopUrl, help: 'ibtekr.club/store/' + (shop || '…') + ' — حروف إنجليزي صغيرة وأرقام و -', onInput: (x) => { f.shopUrl = x.trim().toLowerCase(); f.shopTouched = true; } }),
          two(txt('v-first', 'الاسم الأول', 'first', { maxlength: 60 }), txt('v-last', 'الاسم الأخير', 'last', { maxlength: 60 })),
          h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'العنوان'),
          two(sub('v-street1', VD.label(VD.ADDRESS_LABELS, 'street_1'), 'addressParts', 'street_1', { maxlength: 120 }), sub('v-street2', VD.label(VD.ADDRESS_LABELS, 'street_2'), 'addressParts', 'street_2', { maxlength: 120 })),
          two(sub('v-city', VD.label(VD.ADDRESS_LABELS, 'city'), 'addressParts', 'city', { maxlength: 80 }), sub('v-state', VD.label(VD.ADDRESS_LABELS, 'state'), 'addressParts', 'state', { maxlength: 80 })),
          two(sub('v-zip', VD.label(VD.ADDRESS_LABELS, 'zip'), 'addressParts', 'zip', { maxlength: 20, dir: 'ltr' }), sub('v-country', VD.label(VD.ADDRESS_LABELS, 'country'), 'addressParts', 'country', { maxlength: 2, dir: 'ltr', placeholder: 'EG' })),
          f.showSocial ? [h('div', { class: 't-label', style: 'color:var(--color-text-secondary)' }, 'سوشيال (روابط تبدأ بـ https://)'),
            ...VD.SOCIAL_KEYS.reduce((rows, [k, label], i, all) => (i % 2 ? rows : rows.concat([two(sub('v-s-' + k, label, 'social', k, { dir: 'ltr', inputmode: 'url', placeholder: 'https://…' }), all[i + 1] ? sub('v-s-' + all[i + 1][0], all[i + 1][1], 'social', all[i + 1][0], { dir: 'ltr', inputmode: 'url', placeholder: 'https://…' }) : h('span'))])), [])]
            : Button({ type: 'text', size: 'sm', icon: 'plus', label: 'السوشيال (اختياري)', attrs: { 'data-v-social': '' }, onClick: () => { f.showSocial = true; draw(); } }),
          KK.Switch({ id: 'v-enabled', label: 'تفعيل البيع', help: 'بيتبع «الحالة» — غير نشط = البيع مقفول', checked: f.status !== 'inactive', onChange: (x) => { f.status = x ? 'active' : 'inactive'; draw(); } }),
          KK.Switch({ id: 'v-trusted', label: 'نشر المنتجات مباشرة', help: 'من غير مراجعة — مقفول = المنتجات بتستنى الموافقة', checked: f.trusted, onChange: (x) => { f.trusted = x; draw(); } }),
          KK.Switch({ id: 'v-featured', label: 'مبتكر مميز', checked: f.featured, onChange: (x) => { f.featured = x; draw(); } }),
          KK.Switch({ id: 'v-notify', label: 'ابعت إيميل للمبتكر بحسابه', help: 'إيميل الموقع نفسه (Dokan) ببيانات حسابه', checked: f.notify, onChange: (x) => { f.notify = x; draw(); } })] : null].flat().filter(Boolean);
    };
    // the commission as on Dokan's «Commission» tab: the type, the rate, the flat fee and — by category — the tree (plan 3.4)
    const commissionFields = () => (existing || !vstore.canRate() ? [] : [two(U.Select({ id: 'v-ctype', label: 'نوع العمولة', options: [{ value: 'fixed', label: 'نسبة ثابتة (Fixed)' }, { value: 'category_based', label: 'حسب الفئة (Category based)' }], value: f.ctype, onChange: (x) => { f.ctype = x; draw(); } }),
        txt('v-flat', 'رسوم ثابتة على كل أوردر (ج.م)', 'flat', { inputmode: 'decimal', error: errs.flat, help: 'اختياري — زي ما هي على الموقع', onInput: (x) => { f.flat = x; if (ctk) ctk.refresh(); } })),
      f.ctype === 'category_based' && ctk ? ctk.editor() : null].filter(Boolean));
    // the photo (decision 51 — «System + Dokan store») and the contract (canBank, like the drawer's) picked here; uploaded after the save
    const canPhoto = !!(vstore.setPhoto && vstore.canPhoto && vstore.canPhoto()); let photo = null; let photoPrev = null; let contract = null; let cExp = '';
    const photoBox = () => {
      const inp = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp', hidden: true, 'data-v-photo': '', 'aria-label': 'صورة المبتكر' });
      inp.addEventListener('change', () => { const file = inp.files && inp.files[0]; if (!file) return; const e = String(file.name).split('.').pop().toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'webp'].includes(e) || file.size > 5 * 1048576) { window.IBKit.toast('الصورة PNG أو JPG أو WebP ولحد 5 ميجا.', 'error'); return; }
        photo = file; try { if (photoPrev) URL.revokeObjectURL(photoPrev); photoPrev = URL.createObjectURL(file); } catch (x) { photoPrev = null; } draw(); });
      const cur = photoPrev || (existing && existing.logoUrl && /^https:\/\//.test(existing.logoUrl) ? existing.logoUrl : null);
      const pic = cur ? h('span', { class: 'vlogo vlogo-lg vlogo-img', 'data-v-photo-prev': '' }, h('img', { src: cur, alt: 'صورة المبتكر', referrerpolicy: 'no-referrer' })) : U.VendorLogo({ letter: f.name || '؟', size: 'lg' });
      return h('div', { style: 'flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px' }, pic,
        canPhoto ? [inp, Button({ type: 'text', size: 'sm', label: photo || (existing && existing.photoPath) ? 'غيّر الصورة' : 'ارفع صورة', attrs: { 'data-v-photo-pick': '' }, onClick: () => inp.click() }),
          h('span', { class: 't-small', style: 'color:var(--color-text-secondary);text-align:center;max-width:140px' }, photo ? photo.name : 'بتتحفظ هنا وبتبقى صورة متجره على الموقع')]
          : h('span', { class: 't-small', style: 'color:var(--color-text-secondary);text-align:center' }, 'الصورة بتيجي من متجره على الموقع'));
    };
    const contractBox = () => {
      const inp = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg', 'aria-label': 'ملف العقد', 'data-v-contract': '' });
      inp.addEventListener('change', () => { const file = inp.files && inp.files[0]; contract = file ? { fileName: file.name, size: file.size, file } : null; });
      return [fsec('العقد', 'اختياري — تقدر ترفعه بعدين من ملف المبتكر'), U.FieldShell({ id: 'v-contract', label: 'ملف العقد (PDF أو صورة، حتى 10 ميجا)' }, inp),
        U.DateField({ id: 'v-contract-exp', label: 'تاريخ انتهاء العقد', value: cExp || null, today: VTODAY(), help: 'هيوصلك تنبيه قبل الانتهاء بـ 30 يوم', onChange: (iso, e) => { if (!e) cExp = iso || ''; } })];
    };
    // after the maker is saved: the photo (system + store) and the contract — each told apart in the toast, never blocking the save
    const afterSave = async (id) => {
      const notes = [];
      if (photo && canPhoto) { const r = await vstore.setPhoto(id, { file: photo, name: photo.name, size: photo.size }).catch(() => ({ ok: false }));
        notes.push(!r.ok ? 'الصورة ماترفعتش' + (r.message ? ' (' + r.message + ')' : '') : r.site === 'ok' ? 'الصورة اتحفظت وبقت صورة متجره على الموقع' : r.site === 'failed' ? 'الصورة اتحفظت هنا بس — الموقع رفضها' : 'الصورة اتحفظت هنا' + (r.reason === 'no_store' ? ' (مالوش متجر على الموقع)' : r.reason === 'push_disabled' ? ' (الكتابة على الموقع مقفولة)' : '')); }
      if (contract && canBank) { try { vstore.setContract(id, Object.assign({}, contract, { expires: cExp || null }), vstore.actor()); notes.push('العقد بيترفع'); } catch (e) { notes.push('العقد ماترفعش (' + e.message + ')'); } }
      // a toast: the page note is consumed by the next render, and the uploads re-render the page as they land
      if (notes.length) window.IBKit.toast(notes.join(' · ') + '.', notes.some((x) => /ماترفع|رفضها/.test(x)) ? 'error' : 'success');
      return notes.length > 0;
    };
    let errs = {}; let modal = null; let dup = null;
    const txt = (id, label, key, opts = {}) => U.TextInput(Object.assign({ id, label, value: f[key], error: errs[key], onInput: (v) => { f[key] = v; } }, opts));
    const two = (a, b) => h('div', { class: 'row cols2' }, a, b);
    const statusOpts = VD.STATUSES.map(([value, label]) => ({ value, label }));
    function draw() {
      const fields = [
        h('div', { class: 'row cols2' }, h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:16px;min-width:0' }, txt('v-name', 'اسم المبتكر (المعروض)', 'name', { required: true, maxlength: 80, onInput: (v) => { f.name = v; if (!existing && !f.userTouched) { f.username = VD.suggestUsername(v, (u) => vstore.usernameTaken(u)); const el = document.getElementById('v-login-user'); if (el) el.value = f.username; } } }), catPick('v-cat', f, errs)),
          photoBox()), // phase 3.3 (decision 1): the logo was the site's gravatar only; phase 13 decision 51: a photo uploaded here becomes it
        two(txt('v-phone', 'الهاتف (واتساب)', 'phone', { required: true, inputmode: 'tel', placeholder: '01xxxxxxxxx' }), existing ? txt('v-alt', 'هاتف بديل', 'altPhone', { inputmode: 'tel' }) : txt('v-rate', f.ctype === 'category_based' ? 'نسبة الفئات اللي مالهاش رقم' : 'نسبة إبتكر', 'rate', { required: true, inputmode: 'decimal', suffix: '%', help: 'تنطبق على الأوردرات الجديدة من تاريخ الإضافة', onInput: (x) => { f.rate = x; if (ctk) ctk.refresh(); } })),
        ...commissionFields(),
        two(txt('v-lead', 'مدة التجهيز (أيام)', 'leadDays', { required: true, inputmode: 'numeric', help: 'بتغذي قاعدة التأخير بدل الرقم الثابت' }), U.Select({ id: 'v-status', label: 'الحالة', required: true, options: statusOpts, value: f.status, error: errs.status, onChange: (v) => { f.status = v; draw(); } })),
        txt('v-aliases', 'أسماء بديلة', 'aliases', { placeholder: 'W&R، WOOD & ROPE', help: 'لتوحيد الأسماء من الأوردرات والشيت — افصل بفاصلة' }),
        existing ? null : [fsec('بيانات الدخول', 'المبتكر بيدخل بيها على بوابته يتابع أوردراته وحسابه'), ...loginFields(f, errs, draw, 'v-login')],
        canStoreMk ? storeSection() : null,
        existing ? null : [fsec('الحساب البنكي', 'اختياري — عشان نحوّل له مستحقاته'), ...(canBank ? bankFields(f, errs, draw, 'v-bank', true) : [U.InlineNote({ children: 'البيانات البنكية بيكمّلها قسم الحسابات بس — هتظهر «ناقص» في ملف المبتكر لحد ما تتكمّل.' })])],
        existing || !canBank ? null : contractBox(),
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
        // the owner, 11 Nov: the commission's flat fee and figures, and the shop URL of the store on the site
        const arN = (x) => String(x == null ? '' : x).trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
        if (vstore.canRate() && arN(f.flat) !== '' && !(Number(arN(f.flat)) >= 0)) errs.flat = 'الرسوم الثابتة رقم من 0 أو أكتر';
        if (vstore.canRate() && f.ctype === 'category_based' && Object.values(f.cat).some((c) => (arN(c.rate) !== '' && !(Number(arN(c.rate)) >= 0 && Number(arN(c.rate)) <= 65)) || (arN(c.flat) !== '' && !(Number(arN(c.flat)) >= 0)))) errs._cats = 'نسبة أي فئة لازم من 0% لـ 65%، والرسوم من 0 أو أكتر';
        if (canStoreMk && f.mkStore) { const shop = f.shopUrl || shopOf(f.username); if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(shop)) errs.shopUrl = 'حروف إنجليزي صغيرة وأرقام و - بس (من غير - في الأول والآخر)'; }
        if (!errs.name) { dup = vstore.findByName(f.name) || VD.parseAliases(f.aliases).map((a) => vstore.findByName(a)).find(Boolean) || null; if (dup) errs.name = 'المبتكر ده موجود (' + dup.name + ') — افتح ملفه'; }
      }
      if (Object.keys(errs).length) { errs._form = dup ? 'المبتكر ده موجود — افتح ملفه' : errs._cats || 'راجع الحقول المعلّمة بالأحمر'; draw(); const bad = modal.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
      if (existing) { try { vstore.update(existing.id, f, vstore.actor()); log.append({ action: 'vendor.update', actor: ME.name, newValue: existing.id }); modal.close(); vnotify('success', 'اتحفظت بيانات ' + f.name + '.'); if (vdrawer) openVendor(existing.id); afterSave(existing.id).then((did) => { if (did && vredraw) vredraw(); }); } catch (e) { errs._form = e.message; draw(); } return; }
      // decision 10: the store's create runs the sequence (vendor → rate → login → password → bank); a step refused after the vendor's
      // insert leaves the vendor and is named here — the password travels inside `login` only and is dropped once the call is done
      const input = { name: f.name, legalName: f.legalName, categories: f.categories, phone: f.phone, altPhone: f.altPhone, email: f.email, address: f.address, instagram: f.instagram, storeUrl: f.storeUrl, rate: f.rate, leadDays: f.leadDays, status: f.status, aliases: f.aliases, depositPolicy: f.depositPolicy, notes: f.notes,
        login: { username: f.username, password: f.password }, bank: canBank && f.method ? { method: f.method, bankName: f.bankName, holder: f.holder, iban: f.iban, wallet: f.wallet, accountNumber: f.accountNumber, accountType: f.accountType, bankAddress: f.bankAddress, routingNumber: f.routingNumber, swift: f.swift } : null,
        // the owner, 11 Nov: the commission as on Dokan, and the store's fields (sent to the site with the store)
        commission: vstore.canRate() ? { type: f.ctype, flat: f.flat, categories: f.ctype === 'category_based' ? Object.entries(f.cat).map(([id, c]) => ({ id: Number(id), rate: c.rate, flat: c.flat })) : [] } : null,
        ...(canStoreMk && f.mkStore ? { contactName: [f.first, f.last].map((x) => String(x || '').trim()).filter(Boolean).join(' '),
          ...(Object.entries(f.addressParts).some(([k, x]) => k !== 'country' && String(x || '').trim()) ? { addressParts: Object.assign({}, f.addressParts) } : {}), // typed only (the country alone is the default)
          ...(Object.values(f.social).some((x) => String(x || '').trim()) ? { social: Object.assign({}, f.social) } : {}) } : {}) };
      const storeOpts = canStoreMk && f.mkStore ? { password: f.password, shopUrl: f.shopUrl || shopOf(f.username), notify: f.notify, trusted: f.trusted, featured: f.featured } : null;
      const STEP = { categories: 'الفئة الأساسية', rate: 'النسبة', login: 'بيانات الدخول', password: 'الباسورد المؤقت', bank: 'الحساب البنكي' };
      Promise.resolve().then(() => vstore.create(input, vstore.actor())).then(async (res) => {
        const v = res.vendor; const miss = (res.missing || []).map((k) => STEP[k] + (res.reasons && VMSG[res.reasons[k]] ? ' (' + VMSG[res.reasons[k]] + ')' : ''));
        input.login.password = ''; f.password = '';
        log.append({ action: 'vendor.create', actor: ME.name, newValue: v.id }); modal.close(); state.vfilter.q = '';
        // the owner, 11 Nov: the store on the site right after the maker (its login saved first); the password travels in this call only
        let storeNote = '';
        if (storeOpts && !(res.missing || []).some((k) => k === 'login' || k === 'password')) {
          const sr = await vstore.createStore(v.id, storeOpts).catch(() => ({ ok: false, message: 'الموقع ماردش.' }));
          storeOpts.password = '';
          storeNote = sr.ok ? (sr.adopted ? ' · اتربط بمتجره اللي على الموقع (#' + sr.store + ') — باسورد حسابه على الموقع زي ما كان.' : ' · واتعمل متجره على الموقع (#' + sr.store + ')' + (sr.commission ? ' بالعمولة' : '') + '.') : ' · المتجر على الموقع ماتعملش: ' + (sr.message || VMSG[sr.reason] || 'جرّب تاني') + ' — تقدر تعمله بعدين من ملفه.';
          if (!sr.ok) miss.push('المتجر على الموقع');
        } else if (storeOpts) { storeOpts.password = ''; storeNote = ' · المتجر على الموقع مستني بيانات الدخول — اعمله من ملفه بعد ما تكمّلها.'; }
        vnotify(miss.length ? 'warning' : 'success', 'اتضاف المبتكر ' + v.name + (miss.filter((x) => x !== 'المتجر على الموقع').length ? ' — ناقص: ' + miss.filter((x) => x !== 'المتجر على الموقع').join('، ') + '. كمّله من ملفه.' : ' · الباسورد المؤقت جاهز تبعته له.') + storeNote);
        openVendor(v.id);
        afterSave(v.id).then((did) => { if (did && vredraw) vredraw(); });
      }, (e) => { errs._form = e.message; draw(); });
    }
    modal = U.Modal({ title: existing ? 'تعديل بيانات ' + existing.name : 'إضافة مبتكر', body: [], footer: [] }); draw(); const first = modal.el.querySelector('#v-name'); if (first) first.focus();
  }

  // ----- vendor drawer (Figma: Drawer / Vendor, Tab=Info | Orders) -----
  let vdrawer = null; let vtab = 'info'; const shown = new Set(); let lastShare = null; window.__vLastShare = () => lastShare; let vpQ = '';
  let pwShown = null; // the temporary password revealed in the open drawer (decision 9 b) — forgotten when it closes
  // inPlace (owner 27 Oct): يفتح درج ملف المبتكر وانت مكانك — من غير ما ينقلك لصفحة المبتكرين
  function openVendor(id, opts) {
    const inPlace = !!(opts && opts.inPlace);
    const v0 = vstore.get(id); if (!v0) { vnotify('error', 'المبتكر ' + id + ' مش موجود.'); return; }
    if (vdrawer) vdrawer.close(); shown.clear(); pwShown = null;
    if (!inPlace) { try { history.replaceState(null, '', '#makers/' + id); } catch (e) { /* sandboxed */ } }
    vdrawer = U.Drawer({ label: 'ملف المبتكر ' + v0.name, onClose: () => { vdrawer = null; vredraw = null; pwShown = null;
      if (inPlace) { if (state.page === 'accounts') render(); return; } // decision 18: opened from the header search on any page
      try { history.replaceState(null, '', '#makers'); } catch (e) { /* sandboxed */ } renderVendors(); } });
    const act = (fn, ok) => { try { fn(); log.append({ action: 'vendor.update', actor: ME.name, newValue: id }); if (ok) vnotify('success', ok); draw(); } catch (e) { vnotify('error', e.message); draw(); } };
    const section = (title, action, ...kids) => h('section', { class: 'vsection' }, h('div', { class: 'head' }, h('h3', { class: 't-label' }, title), action || null), kids);
    function moreMenu(v) {
      const wrap = h('div', { class: 'pop-anchor', 'data-popover-root': '' }); const trig = IconButton({ icon: 'more', label: 'المزيد', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
      const MOVES = { active: [['leave', 'تحويل لـ «في إجازة»'], ['inactive', 'تحويل لغير نشط']], leave: [['active', 'تفعيل المبتكر'], ['inactive', 'تحويل لغير نشط']], inactive: [['active', 'تفعيل المبتكر'], ['leave', 'تحويل لـ «في إجازة»']] }; // decision 6: leave is a status like the others (vendors.toggle)
      const opts = (vstore.canToggle() ? (MOVES[v.status] || MOVES.active).map(([st, label]) => ({ value: 'status:' + st, label })) : []).concat([vstore.canRate() ? { value: 'rate', label: 'تغيير النسبة (الأوردرات الجديدة فقط)' } : null, { value: 'copy', label: 'نسخ رابط الملف' }, { value: 'ticket', label: 'إنشاء تذكرة على المبتكر' }, v.siteRemovedAt && vstore.canRemove && vstore.canRemove() ? { value: 'remove', label: 'احذف من السيستم', danger: true } : null].filter(Boolean));
      const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (val) => { close();
        if (val.startsWith('status:')) act(() => vstore.update(id, { status: val.slice(7) }, vstore.actor()), 'اتغيرت الحالة.');
        if (val === 'rate') editGroup(v, 'terms');
        if (val === 'copy') copyText(location.href.split('#')[0] + '#makers/' + id, 'رابط الملف');
        if (val === 'ticket') { vdrawer.close(); showTickets(); openNewTicket({ type: 'vendor', vendor: v.name, vendorId: v.id }); } // phase 8 decision 3
        // 0031 (the owner, 2 Nov): a maker whose store is gone from the site — the admin removes it here (the delete the server
        // allows: a maker with orders is refused by the database and the message says so)
        if (val === 'remove') window.IBKit.confirm({ title: 'حذف «' + v.name + '» من السيستم؟', text: 'متجره اتحذف من الموقع. الحذف هنا نهائي: براناته وبيانات دخوله بتتمسح معاه. مبتكر عليه أوردرات مابيتحذفش — يفضل «غير نشط» عشان الأوردرات والحسابات.', okLabel: 'احذف من السيستم', okType: 'danger',
          onOk: () => act(() => vstore.remove(id, vstore.actor()), 'اتحذف المبتكر من السيستم.') }); } }));
      trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
    }
    // the owner, 11 Nov: a maker without a store gets one on the site from his file — Dokan's «Add New Vendor» with his portal login (woo-sync
    // vendor_store); the store's fields, the commission and the bank come from the file on the server. The password is typed (or the
    // portal's temporary one, revealed — that reveal is logged) and sent once; it is cleared here after the call.
    function storePopup(v) {
      const L0 = v.login && v.login.username ? v.login : null; const KK = window.IBKit;
      const f = { password: '', shopUrl: String(L0 ? L0.username : '').toLowerCase().replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50), notify: true, trusted: false, featured: false, show: false };
      let m = null; let errs = {}; let busy = false;
      const redraw = () => m.setBody(...body());
      const body = () => (!L0 ? [U.InlineNote({ kind: 'warning', children: 'لازم «بيانات الدخول» الأول (اسم مستخدم وإيميل) — حسابه على الموقع بيتعمل بيها.' })] : [
        U.InfoRow({ label: 'اسم المستخدم', value: L0.username }), U.InfoRow({ label: 'الإيميل', value: L0.email || v.email || '—' }),
        U.TextInput({ id: 'st-pw', label: 'باسورد حساب الموقع', required: true, type: f.show ? 'text' : 'password', dir: 'ltr', autocomplete: 'new-password', value: f.password, error: errs.password, help: 'نفس الباسورد المؤقت بتاع البوابة لو لسه ماغيّرهوش', onInput: (x) => { f.password = x; } }),
        h('div', { class: 'acts-inline' }, Button({ size: 'sm', icon: 'sparkle', label: 'اقترح باسورد قوي', attrs: { 'data-st-gen': '' }, onClick: () => { f.password = VD.genPassword(); f.show = true; redraw(); } }),
          L0.hasPassword && vstore.canLogin() ? Button({ size: 'sm', label: 'استخدم الباسورد المؤقت', attrs: { 'data-st-temp': '' }, onClick: async () => { const pw = await vstore.revealPassword(v.id, vstore.actor()).catch(() => null); if (pw) { f.password = pw; f.show = false; redraw(); } else vnotify('error', 'مفيش باسورد مؤقت متسجل — اكتب باسورد جديد.'); } }) : null),
        U.TextInput({ id: 'st-shop', label: 'رابط المتجر', dir: 'ltr', value: f.shopUrl, error: errs.shopUrl, help: 'ibtekr.club/store/… — حروف إنجليزي صغيرة وأرقام و -', onInput: (x) => { f.shopUrl = x.trim().toLowerCase(); } }),
        KK.Switch({ id: 'st-trusted', label: 'نشر المنتجات مباشرة', checked: f.trusted, onChange: (x) => { f.trusted = x; redraw(); } }),
        KK.Switch({ id: 'st-featured', label: 'مبتكر مميز', checked: f.featured, onChange: (x) => { f.featured = x; redraw(); } }),
        KK.Switch({ id: 'st-notify', label: 'ابعت إيميل للمبتكر بحسابه', checked: f.notify, onChange: (x) => { f.notify = x; redraw(); } }),
        U.InlineNote({ children: 'اسم المتجر والتليفون واسم صاحب المتجر والعنوان والسوشيال والحالة بيتبعتوا من ملفه، والعمولة والحساب البنكي لو ليك صلاحيتهم.' }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : null]).filter(Boolean);
      async function save() {
        if (busy) return; errs = {};
        const iss = VD.passwordIssues(f.password); if (iss.length) errs.password = 'الباسورد لازم: ' + iss.join('، ');
        if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(f.shopUrl)) errs.shopUrl = 'حروف إنجليزي صغيرة وأرقام و - بس';
        if (Object.keys(errs).length) { redraw(); return; }
        busy = true; const r = await vstore.createStore(v.id, { password: f.password, shopUrl: f.shopUrl, notify: f.notify, trusted: f.trusted, featured: f.featured }).catch(() => ({ ok: false })); busy = false; f.password = '';
        if (!r.ok) { errs._form = r.message || VMSG[r.reason] || 'ماتعملش — جرّب تاني.'; redraw(); return; }
        m.close(); vnotify('success', r.adopted ? 'اتربط ' + v.name + ' بمتجره اللي على الموقع (#' + r.store + ') — باسورد حسابه على الموقع زي ما كان.' : 'اتعمل متجر ' + v.name + ' على الموقع (#' + r.store + ')' + (r.commission ? ' بالعمولة' : '') + '.'); draw();
      }
      m = U.Modal({ title: 'متجر على الموقع — ' + v.name, body: body(), footer: L0 ? [Button({ type: 'primary', label: 'اعمل المتجر', attrs: { 'data-st-save': '' }, onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] : [Button({ label: 'إغلاق', onClick: () => m.close() })] });
    }
    // Per-section edit (owner, 21 Oct): every data group has its own «تعديل» that opens a popup with that group's fields only (Figma: Modal / Vendor edit — Identity | Contact | Terms).
    // Phase 3.3 (decision 6 a / b): the contact popup carries the store owner's name, the six address parts and the eight social links
    // (instagram is social.instagram) — the synced fields go to the site right after the save; the terms popup takes the flat fee next to
    // the rate (shown with it, pushed as the maker's commission on the site).
    function editGroup(v, g) {
      const G = VD.EDIT_GROUPS[g]; const f = { name: v.name, legalName: v.legalName || '', categories: (v.categories || []).slice(), aliases: v.aliases.join('، '), status: v.status, phone: v.phone, altPhone: v.altPhone || '', email: v.email || '', contactName: v.contactName || '', addressParts: VD.cleanAddressParts(v.addressParts), social: Object.assign({}, VD.cleanSocial(v.social)), storeUrl: v.storeUrl || '', leadDays: String(v.leadDays), depositPolicy: v.depositPolicy || '', notes: v.notes || '', rate: v.rate == null ? '' : String(v.rate), flat: v.rateFlat == null ? '' : String(v.rateFlat), since: VTODAY(),
        // plan 3.4: the commission type and the figures set by hand per category ({ id: { rate, flat } } as typed)
        ctype: v.commissionType === 'category_based' ? 'category_based' : 'fixed', cat: Object.fromEntries((v.categoryRates || []).map((c) => [c.wooCategoryId, { rate: String(c.rate), flat: c.flat == null ? '' : String(c.flat) }])) };
      const catOrig = JSON.parse(JSON.stringify(f.cat)); const openCats = new Set();
      let errs = {}; let m = null;
      const txt = (fid, label, key, opts = {}) => U.TextInput(Object.assign({ id: fid, label, value: f[key], error: errs[key], onInput: (x) => { f[key] = x; } }, opts));
      const sub = (fid, label, obj, key, opts = {}) => U.TextInput(Object.assign({ id: fid, label, value: f[obj][key] || '', error: errs[obj] && errs[obj][key], onInput: (x) => { f[obj][key] = x; } }, opts)); // a key of addressParts / social
      const two = (a, b) => h('div', { class: 'row cols2' }, a, b);
      const synced = !!v.wooVendorId;
      // plan 3.4 (decision 6): the category tree — the site's top-level categories, «+» opens a category's children (every level);
      // each row a % and a ج.م box: empty = inherited (the placeholder shows the figure it takes), typed = set by hand. A figure typed
      // on a parent flows at once to its children that have none of their own; a child's own figure stays (owner, 27 Oct).
      const ctk = catTreeKit(f, openCats); const refreshCats = ctk.refresh; const catEditor = ctk.editor;
      const groups = {
        identity: () => [two(txt('g-name', 'اسم المبتكر (المعروض)', 'name', { required: true, maxlength: 80 }), txt('g-legal', 'الاسم التجاري / القانوني', 'legalName')),
          two(catPick('g-cat', f, errs), U.Select({ id: 'g-status', label: 'الحالة', required: true, options: VD.STATUSES.map(([value, label]) => ({ value, label })), value: f.status, error: errs.status, onChange: (x) => { f.status = x; m.setBody(...body()); } })),
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
        terms: () => [vstore.canRate() ? U.Select({ id: 'g-ctype', label: 'نوع العمولة', required: true, options: [{ value: 'fixed', label: 'نسبة ثابتة (Fixed)' }, { value: 'category_based', label: 'حسب الفئة (Category based)' }], value: f.ctype, onChange: (x) => { f.ctype = x; m.setBody(...body()); } }) : null,
          vstore.canRate() ? two(txt('g-rate', f.ctype === 'category_based' ? 'نسبة الفئات اللي مالهاش رقم' : 'نسبة إبتكر', 'rate', { inputmode: 'decimal', suffix: '%', help: v.rate == null ? 'لسه مفيش نسبة متسجلة' : f.ctype === 'category_based' ? 'وبتملا الجدول تحت لأي فئة فاضية' : undefined, onInput: (x) => { f.rate = x; refreshCats(); } }), txt('g-flat', 'رسوم ثابتة على كل أوردر (ج.م)', 'flat', { inputmode: 'decimal', error: errs.flat, help: 'زي ما هي على الموقع — للعرض بس، مش داخلة في حساب الحصة', onInput: (x) => { f.flat = x; refreshCats(); } })) : null,
          vstore.canRate() && f.ctype === 'category_based' ? catEditor() : null,
          vstore.canRate() ? U.InlineNote({ kind: 'warning', children: 'لو غيّرت العمولة: بتنطبق على الأوردرات الجديدة بس — الأوردرات القديمة بتفضل بنسبتها.' + (synced ? ' والعمولة بتتبعت للموقع مع الحفظ.' : '') }) : null,
          two(txt('g-lead', 'مدة التجهيز المتفق عليها (أيام)', 'leadDays', { required: true, inputmode: 'numeric', help: 'بتغذي قاعدة التأخير' }), txt('g-dep', 'سياسة العربون', 'depositPolicy')),
          U.Textarea({ id: 'g-notes', label: 'ملاحظات الاتفاق', value: f.notes, onInput: (x) => { f.notes = x; } })] };
      const body = () => groups[g]().filter(Boolean).concat(errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: 'التعديل بيتسجل في سجل النشاط باسمك.' }));
      function save() {
        errs = VD.validateGroup(g, Object.assign({}, v, { aliases: v.aliases.join('، ') }), f);
        let rateChanged = false; let flat = null; const cats = [];
        if (g === 'terms' && vstore.canRate()) {
          const ar = (s) => String(s).trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660));
          const raw = ar(f.rate); const fl = ar(f.flat);
          if (fl !== '') { const n = Number(fl); if (!(n >= 0)) errs.flat = 'الرسوم الثابتة رقم من 0 أو أكتر'; else flat = n; }
          if (raw === '') { if (v.rate != null || f.ctype === 'category_based') errs.rate = 'النسبة من 0% إلى 65%'; } else { const r = Number(raw); if (!(r >= 0 && r <= 65)) errs.rate = 'النسبة من 0% إلى 65%'; else rateChanged = r !== v.rate || flat !== (v.rateFlat == null ? null : v.rateFlat); }
          // plan 3.4: the type, and on category_based the categories whose hand-set figure changed (emptied = back to inheriting)
          if (f.ctype !== (v.commissionType === 'category_based' ? 'category_based' : 'fixed')) rateChanged = rateChanged || raw !== '';
          if (f.ctype === 'category_based') {
            const bad = [];
            for (const k of new Set(Object.keys(f.cat).concat(Object.keys(catOrig)))) {
              const now2 = f.cat[k] || { rate: '', flat: '' }; const was = catOrig[k] || { rate: '', flat: '' };
              const nr = ar(now2.rate); const nf = ar(now2.flat);
              if (nr !== '' && !(Number(nr) >= 0 && Number(nr) <= 65)) { bad.push(k); continue; }
              if (nf !== '' && !(Number(nf) >= 0)) { bad.push(k); continue; }
              if (nr === ar(was.rate) && nf === ar(was.flat)) continue;
              cats.push({ id: Number(k), rate: nr === '' ? null : Number(nr), flat: nr === '' || nf === '' ? null : Number(nf) });
            }
            if (bad.length) { const nm = (VD.categoryTree ? (vstore.categories ? vstore.categories() : []) : []).find((c) => String(c.id) === bad[0]); errs._cats = 'نسبة فئة «' + (nm ? nm.name : '#' + bad[0]) + '» لازم من 0% لـ 65%، والرسوم من 0 أو أكتر'; }
            if (cats.length) rateChanged = true;
          }
        }
        if (Object.keys(errs).length) { errs._form = errs._cats || 'راجع الحقول المعلّمة بالأحمر'; m.setBody(...body()); const bad = m.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
        m.close();
        act(() => { vstore.update(id, VD.groupPatch(g, f), vstore.actor()); if (rateChanged) vstore.setCommission(id, { type: f.ctype, rate: Number(f.rate.trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))), flat, categories: f.ctype === 'category_based' ? cats : [] }, vstore.actor()); }, 'اتحفظت ' + G.title + '.');
      }
      m = U.Modal({ title: G.title + ' — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    const editBtn = (v, g) => (vstore.canEdit() ? Button({ type: 'text', size: 'sm', label: 'تعديل', attrs: { 'aria-label': 'تعديل ' + VD.EDIT_GROUPS[g].title, 'data-edit': g }, onClick: () => editGroup(v, g) }) : null);
    // phase 3.5 (plan decision 6): every Dokan field; «حفظ» validates and opens a confirmation of its own — only «أيوه، غيّر الحساب
    // البنكي» writes the row and sends it to the maker's store on the site (a synced maker). «رجوع» brings the form back as typed.
    const BANK_FIELDS = [['method', 'طريقة الدفع المفضلة'], ['holder', 'اسم صاحب الحساب'], ['bankName', 'البنك'], ['accountNumber', 'رقم الحساب'], ['iban', 'IBAN'], ['accountType', 'نوع الحساب'],
      ['swift', 'SWIFT'], ['routingNumber', 'Routing Number'], ['bankAddress', 'عنوان البنك'], ['wallet', 'رقم المحفظة / إنستاباي']];
    const BANK_SECRET = ['accountNumber', 'iban', 'wallet']; // the old value stays masked in the confirmation (shown only by «إظهار», logged)
    const bankNorm = (k, x) => { const t = String(x == null ? '' : x).trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)); return k === 'accountNumber' || k === 'routingNumber' ? t.replace(/[\s-]/g, '') : k === 'iban' || k === 'swift' ? t.replace(/\s/g, '').toUpperCase() : k === 'wallet' ? t.replace(/\s/g, '') : t; };
    const bankShow = (k, x) => (k === 'method' ? VD.label(VD.PAY_METHODS, x) : k === 'accountType' ? VD.label(VD.BANK_ACCOUNT_TYPES, x) || x : x) || '—';
    function bankForm(v, typed) {
      const b = v.bank || {}; const f = typed || { method: b.method || 'bank', bankName: b.bankName || '', holder: b.holder || '', iban: b.iban || '', wallet: b.wallet || '', accountNumber: b.accountNumber || '', accountType: b.accountType || '', bankAddress: b.bankAddress || '', routingNumber: b.routingNumber || '', swift: b.swift || '' };
      let errs = {}; let m = null; const synced = !!v.wooVendorId;
      const redraw = () => m.setBody(...body());
      const body = () => bankFields(f, errs, redraw, 'b').concat(errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ kind: 'warning', children: 'بيانات حساسة — التعديل بيتسجل في السجل باسمك' + (synced ? '، وبعد التأكيد بيتبعت لمتجره على الموقع.' : '.') }));
      function save() {
        errs = VD.validateBank(f);
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); const bad = m.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
        const changes = BANK_FIELDS.filter(([k]) => bankNorm(k, f[k]) !== bankNorm(k, b[k]));
        m.close();
        if (!changes.length) { vnotify('success', 'مفيش تغيير في الحساب البنكي.'); return; }
        confirmBank(v, f, changes);
      }
      m = U.Modal({ title: 'بيانات الحساب البنكي — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: 'حفظ', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
      const first = m.el && m.el.querySelector('input'); if (first) first.focus();
    }
    function confirmBank(v, f, changes) {
      const b = v.bank || {}; let m = null;
      const rows = changes.map(([k, label]) => h('tr', { 'data-bank-change': k }, h('td', null, label), h('td', { dir: 'auto' }, BANK_SECRET.includes(k) && b[k] ? VD.mask(b[k]) : bankShow(k, b[k])), h('td', { dir: 'auto' }, h('b', null, bankShow(k, f[k])))));
      m = U.Modal({ title: 'تأكيد تغيير الحساب البنكي — ' + v.name,
        body: [h('p', { class: 't-body', style: 'margin:0' }, 'راجع التغيير كويس قبل التأكيد: مستحقات المبتكر بتتحوّل على البيانات دي.'),
          h('div', { class: 'scroll-x' }, h('table', { class: 'mini-table', 'data-bank-confirm-table': '' }, h('thead', null, h('tr', null, ['الخانة', 'قبل', 'بعد'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))),
          v.wooVendorId ? U.InlineNote({ kind: 'warning', children: 'بعد التأكيد البيانات دي بتتبعت لمتجره على الموقع (Dokan) وبتحل محل اللي هناك.' }) : null].filter(Boolean),
        footer: [Button({ type: 'primary', label: 'أيوه، غيّر الحساب البنكي', attrs: { 'data-bank-confirm': '' }, onClick: () => { m.close(); act(() => vstore.setBank(id, f, vstore.actor()), 'اتحفظ الحساب البنكي.'); } }),
          Button({ label: 'رجوع للتعديل', onClick: () => { m.close(); bankForm(v, f); } })] });
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
      const sub = h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, num(rows.length + ' أوردر · بقيمة ' + D.formatMoney(tot) + ' ج.م · حصته ' + D.formatMoney(hisShare) + ' ج.م' + (rows.length && (delay || kind === 'inProgress') ? ' · أقدمها ' + Math.max(...rows.map((o) => o.ageDays)) + ' يوم' : '') + (delay ? ' · بيتحسب من تاريخ تبليغ المبتكر على مدة التصنيع: قابل للتأخير في آخر 3 أيام، متأخر بعدها' : '')));
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
      const opts = [{ value: 'edit', label: 'تعديل' }, { value: 'transfer', label: 'نقل لمبتكر تاني' }, b.owner !== b.origin ? { value: 'return', label: 'رجوع لصاحبه' } : null].filter(Boolean);
      const pop = U.popover(wrap, trig, (close) => U.DropdownMenu({ role: 'menu', end: true, options: opts, onSelect: (val) => { close(); if (val === 'edit') brandForm(v, b); if (val === 'transfer') brandTransferForm(v, b); if (val === 'return') brandReturnForm(v, b); } }));
      trig.addEventListener('click', pop.toggle); wrap.append(trig); return wrap;
    }
    function brandsSection(v) {
      const edit = canBrands(); // plan 3.4 decision 5: no rate column — the brand has no rate of its own
      const head = ['البراند', 'منذ'].concat(edit ? [''] : []);
      const cell = (b) => h('td', null, h('span', { class: 'brand-cell' }, h('b', null, b.name), h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'الكود ', h('span', { dir: 'ltr' }, b.code), b.aliases.length ? ' · ' + b.aliases.join('، ') : ''), b.store ? h('span', null, h('span', { class: 'tg tg-neutral' }, 'متجر على الموقع')) : null));
      const rows = (v.brands || []).map((b) => h('tr', { 'data-brand': b.id }, cell(b),
        h('td', null, b.since ? dateCell(b.since) : '—', b.temp && b.returnOn ? h('span', { class: 't-small', style: 'display:block;color:var(--color-text-secondary)' }, num('مؤقت لحد ' + D.formatDateNumeric(b.returnOn))) : null),
        edit ? h('td', null, brandMenu(v, b)) : null));
      const ever = (v.brandsEver || []).map((b) => h('p', { class: 't-small brand-ever', style: 'margin:0;color:var(--color-text-secondary)' }, 'كان عنده: ', h('b', null, b.name), num(' لحد ' + (b.until ? D.formatDateNumeric(b.until) : '—') + ' → دلوقتي مع '), h('b', null, b.now)));
      return section('البراندات', edit ? Button({ type: 'text', size: 'sm', icon: 'plus', label: 'إضافة براند', attrs: { 'data-add-brand': '' }, onClick: () => brandForm(v, null) }) : null,
        rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'brands-table mini-table' }, h('thead', null, h('tr', null, head.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'مفيش براندات على المبتكر ده دلوقتي.'),
        ever, h('p', { class: 't-small help', style: 'margin:0' }, 'الأوردرات بتتحسب للي البراند كان تحته يوم الأوردر، والـ SKU مش بيتغير. النسبة = نسبة المبتكر.'));
    }
    // «إضافة براند» / «تعديل»: the name, the code (suggested from the name until it is typed), the aliases (no rate — plan 3.4
    // decision 5). A taken name (the store's brandByName) is refused here; the server's 23505 says the same.
    function brandForm(v, b) {
      const f = { name: b ? b.name : '', code: b ? b.code : '', aliases: b ? b.aliases.join('، ') : '', rate: '', codeTouched: !!b }; let errs = {}; let m = null;
      const redraw = () => m.setBody(...body());
      const body = () => [h('div', { class: 'row cols2' },
          U.TextInput({ id: 'br-name', label: 'اسم البراند', required: true, maxlength: 80, value: f.name, error: errs.name, help: 'الاسم اللي المنتجات بتتباع بيه', onInput: (x) => { f.name = x; if (!f.codeTouched) { f.code = VD.brandCode(x); const el = document.getElementById('br-code'); if (el) el.value = f.code; } } }),
          U.TextInput({ id: 'br-code', label: 'الكود', dir: 'ltr', maxlength: 3, value: f.code, error: errs.code, help: 'من 1 لـ 3 حروف إنجليزي كبيرة أو أرقام — معلوماتي، الـ SKU مش بيتغير', onInput: (x) => { f.code = x.toUpperCase(); f.codeTouched = true; } })),
        U.TextInput({ id: 'br-aliases', label: 'أسماء بديلة', value: f.aliases, placeholder: 'W&R، WOOD & ROPE', help: 'لتوحيد الأسماء من الأوردرات والشيت — افصل بفاصلة', onInput: (x) => { f.aliases = x; } }),
        errs._form ? U.InlineNote({ kind: 'error', children: errs._form }) : U.InlineNote({ children: b ? 'التعديل بيتسجل في سجل النشاط باسمك.' : 'البراند هيبقى على ' + v.name + ' من تاريخ انضمامه (' + D.formatDateNumeric(v.joinedAt) + ')، وبيتسجل في سجل النشاط باسمك.' })].filter(Boolean);
      function save() {
        errs = VD.validateBrand(f);
        if (!errs.name) { const dup = vstore.brandByName ? vstore.brandByName(f.name) : null; if (dup && (!b || dup.id !== b.id)) errs.name = 'فيه براند بنفس الاسم (' + dup.name + ') — اختار اسم تاني'; }
        if (Object.keys(errs).length) { errs._form = 'راجع الحقول المعلّمة بالأحمر'; redraw(); const bad = m.el.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
        if (b) { m.close(); act(() => vstore.updateBrand(b.id, { name: f.name, code: f.code, aliases: f.aliases }, vstore.actor()), 'اتحفظ البراند.'); return; }
        const STEP = { owner: 'صف الملكية' };
        Promise.resolve().then(() => vstore.addBrand(id, { name: f.name, code: f.code, aliases: f.aliases }, vstore.actor())).then((res) => {
          m.close(); log.append({ action: 'vendor.update', actor: ME.name, newValue: id });
          const miss = (res.missing || []).map((k) => (STEP[k] || k) + (res.reasons && VMSG[res.reasons[k]] ? ' (' + VMSG[res.reasons[k]] + ')' : ''));
          vnotify(miss.length ? 'warning' : 'success', 'اتضاف البراند ' + res.brand.name + (miss.length ? ' — ناقص: ' + miss.join('، ') + '.' : '.')); draw();
        }, (e) => { errs._form = e.message; redraw(); });
      }
      m = U.Modal({ title: b ? 'تعديل البراند — ' + b.name : 'إضافة براند — ' + v.name, body: body(), footer: [Button({ type: 'primary', label: b ? 'حفظ' : 'إضافة البراند', onClick: save }), Button({ label: 'إلغاء', onClick: () => m.close() })] });
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
    // phase 13 decision 51: no store image yet → the photo saved in the system (vendor-photos, a signed URL) replaces the letter
    const vendorLogo = (v) => { if (v.logoUrl && HTTPS.test(v.logoUrl)) return h('span', { class: 'vlogo vlogo-lg vlogo-img' }, h('img', { src: v.logoUrl, alt: 'لوجو ' + v.name, loading: 'lazy', referrerpolicy: 'no-referrer' }));
      const el = U.VendorLogo({ letter: v.logoLetter, size: 'lg' }); const V = window.IBVendors;
      if (v.photoPath && V && V.photoUrl) V.photoUrl(v.id).then((url) => { if (url && el.isConnected) el.replaceWith(h('span', { class: 'vlogo vlogo-lg vlogo-img', 'data-v-photo-img': '' }, h('img', { src: url, alt: 'صورة ' + v.name }))); }).catch(() => undefined);
      return el; };
    // (d) «موقوف على الموقع»: the maker is inactive here and has a store there (the sync mirrors enabled: false ↔ inactive)
    // 0031 (the owner, 2 Nov): a store gone from the site — the sync marks the maker (site_removed_at, inactive), never deletes it
    const siteOffTag = (v) => (v.siteRemovedAt ? h('span', { class: 'tg tg-error', 'data-site-removed': '' }, 'اتحذف من الموقع') : v.status === 'inactive' && v.wooVendorId ? h('span', { class: 'tg tg-error', 'data-site-off': '' }, 'موقوف على الموقع') : null);
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
    // (b) «عمولة حسب الفئة» (plan 3.4): for a maker on category_based, the figures set by hand (a parent's figure flows to its
    // children); the editing is in the terms popup. Nothing for a member without sensitive.commission or a maker on fixed.
    function categoryRatesBlock(v) {
      if (!vstore.canRate() || v.commissionType !== 'category_based') return v.wooVendorId && vstore.canRate() ? [U.InlineNote({ children: 'النسبة بتتبعت للموقع مع الحفظ.' })] : [];
      const cats = vstore.categories ? vstore.categories() : []; // plan 3.4 decision 9: a child category shows its path
      const rows = (v.categoryRates || []).map((c) => h('tr', { 'data-cat-rate': c.wooCategoryId }, h('td', { dir: 'auto' }, VD.categoryPath(cats, c.wooCategoryId) || c.name), h('td', null, num(c.rate + '%')), h('td', null, c.flat != null && c.flat > 0 ? num(D.formatMoney(c.flat)) : '—')));
      return [h('div', { class: 'head', style: 'margin-top:8px' }, h('h3', { class: 't-label' }, 'عمولة حسب الفئة')),
        rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'mini-table cat-rates-table' }, h('thead', null, h('tr', null, ['الفئة', 'النسبة', 'رسوم ثابتة'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows))) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)', 'data-no-cat-rates': '' }, 'مفيش فئة ليها رقم خاص — كل الفئات بنسبة الفئات اللي مالهاش رقم.'),
        h('p', { class: 't-small help', style: 'margin:0' }, 'الفئات الفرعية بتاخد رقم الفئة اللي فوقها إلا لو ليها رقم خاص. التعديل من «تعديل» في الاتفاق التجاري.'),
        v.wooVendorId ? U.InlineNote({ children: 'النسبة بتتبعت للموقع: نوع العمولة ونسب الفئات بتتسجل على متجره مع الحفظ.' }) : null];
    }
    function draw() {
      const v = vstore.get(id); if (!v) { if (vdrawer) vdrawer.close(); return; } const st = vendorStats()[v.id]; const canEdit = vstore.canEdit(), canBank = vstore.canBank(), canRate = vstore.canRate(), canLogin = !!(vstore.canLogin && vstore.canLogin()); const cstat = VD.contractStatus(v, VTODAY());
      // decision 9 c: what the maker still lacks (login / e-mail / bank), from the store
      const missingTag = () => { const miss = vstore.missing ? vstore.missing(id) : []; return miss.length ? h('span', { class: 'tg tg-orange', 'data-missing': '' }, 'ناقص: ' + miss.join(' / ')) : null; };
      const header = h('div', { class: 'drawer-h' },
        h('div', { class: 'row1' }, h('div', { class: 'vdrawer-id' }, vendorLogo(v), h('div', { class: 'names' }, h('div', { class: 'name-row' }, h('h2', { class: 't-h4' }, v.name), U.VendorStatus(v.status), siteOffTag(v)), h('span', { class: 't-small' }, num((v.category || 'بدون فئة') + ' · نسبة إبتكر ' + (canRate && v.rate != null ? v.rate + '%' : '—') + ' · مبتكر من ' + D.formatDateLong(v.joinedAt) + (v.wooVendorId ? ' · متجر #' + v.wooVendorId : ' · بدون متجر على الموقع'))), missingTag())),
          h('div', { class: 'actions' }, !v.wooVendorId && vstore.canStore && vstore.canStore() ? Button({ type: 'brand', size: 'sm', icon: 'plus', label: 'اعمل متجر على الموقع', attrs: { 'data-make-store': '' }, onClick: () => storePopup(v) }) : null, moreMenu(v), IconButton({ icon: 'close', label: 'إغلاق', onClick: () => vdrawer.close() }))),
        U.Tabs({ items: [{ id: 'info', label: 'معلومات المبتكر' }, { id: 'products', label: 'المنتجات' }, { id: 'orders', label: 'الأوردرات' }, { id: 'accounts', label: 'الحسابات' }], active: vtab, onChange: (t) => { vtab = t; if (t === 'products') { vpQ = ''; const a = PAPI(); if (a) a.ensure(); } draw(); } }));
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
          // phase 13 T4 (0065): once the maker set their own password in the portal the team is told so — no reveal (the server answers null anyway)
          const portalLink = location.origin + location.pathname.replace(/[^/]*$/, '') + 'portal.html';
          const pwCell = !L0 ? null : L0.ownPassword ? h('span', { class: 't-small', style: 'color:var(--color-text-secondary)', 'data-own-password': '' }, 'المبتكر عامل باسورده بنفسه — لو نسيه يستخدم «نسيت الباسورد؟» في البوابة، أو اعمله باسورد مؤقت جديد من «تعديل».')
            : !L0.hasPassword ? h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'باسورد مؤقت — لسه ماتعملش')
            : h('span', { class: 'pw-cell' }, h('span', { dir: 'ltr', class: 'pw-val' }, pwShown != null ? pwShown : '••••••••'),
              canLogin ? Button({ type: 'text', size: 'sm', label: pwShown != null ? 'إخفاء' : 'إظهار', attrs: { 'data-pw-reveal': '', 'aria-pressed': String(pwShown != null) }, onClick: () => { if (pwShown != null) { pwShown = null; draw(); return; } vstore.revealPassword(id, vstore.actor()).then((p) => { pwShown = p == null ? '—' : p; draw(); }, (e) => vnotify('error', e.message)); } }) : null);
          const copyLogin = () => { const lines = ['بوابة مبتكرين إبتكر: ' + portalLink, 'اسم المستخدم: ' + L0.username, 'الإيميل: ' + (email || '—')]; const done = (pw) => copyText(lines.concat([pw ? 'الباسورد المؤقت: ' + pw + ' (هيتطلب منك تغيّره أول ما تدخل)' : L0.ownPassword ? 'الباسورد: انت عامله بنفسك — لو نسيته دوس «نسيت الباسورد؟»' : L0.hasPassword ? 'الباسورد المؤقت: اطلبه من الأدمن أو متابعة المبتكرين' : 'الباسورد المؤقت: لسه ماتعملش']).join('\n'), 'بيانات الدخول');
            if (canLogin && L0.hasPassword && !L0.ownPassword) vstore.revealPassword(id, vstore.actor()).then(done, (e) => vnotify('error', e.message)); else done(null); };
          return section('بيانات الدخول', canLogin ? Button({ type: 'text', size: 'sm', label: L0 ? 'تعديل' : 'إضافة', attrs: { 'aria-label': (L0 ? 'تعديل' : 'إضافة') + ' بيانات الدخول', 'data-edit': 'login' }, onClick: () => loginForm(v) }) : null,
            U.InfoRow({ label: 'اسم المستخدم', value: L0 ? h('span', { dir: 'ltr' }, L0.username) : null, copy: !!L0, onCopy: () => copy(L0.username, 'اسم المستخدم') }),
            U.InfoRow({ label: 'الإيميل', value: email ? h('span', { dir: 'ltr' }, email) : null, copy: !!email, onCopy: () => copy(email, 'الإيميل') }),
            U.InfoRow({ label: 'حالة الحساب', value: h('span', { class: 'tg tg-' + (LTONE[ls] || 'neutral'), 'data-login-status': ls }, VD.label(VD.LOGIN_STATUS, ls)) }),
            U.InfoRow({ label: 'الباسورد', value: pwCell }),
            L0 ? U.InfoRow({ label: 'لينك البوابة', value: h('a', { href: portalLink, target: '_blank', rel: 'noopener', dir: 'ltr', 'data-portal-link': '' }, portalLink), copy: true, onCopy: () => copy(portalLink, 'لينك البوابة') }) : null,
            L0 && L0.lastLoginAt ? U.InfoRow({ label: 'آخر دخول', value: U.num(String(L0.lastLoginAt).slice(0, 10).split('-').reverse().join('/')) }) : null,
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
          section('الاتفاق التجاري', editBtn(v, 'terms'), U.InfoRow({ label: 'نسبة إبتكر', value: !canRate ? '—' : v.rate == null ? 'لسه مفيش نسبة متسجلة' : num((v.commissionType === 'category_based' ? 'حسب الفئة — الفئات اللي مالهاش رقم ' : '') + v.rate + '% (على الأوردرات الجديدة فقط)' + (v.rateFlat != null && v.rateFlat > 0 ? ' + ' + D.formatMoney(v.rateFlat) + ' ج.م رسوم ثابتة' : '')) }), U.InfoRow({ label: 'مدة التجهيز المتفق عليها', value: num(v.leadDays + ' أيام') }), U.InfoRow({ label: 'سياسة العربون', value: v.depositPolicy }), U.InfoRow({ label: 'ملاحظات الاتفاق', value: v.notes }), canRate && v.rateHistory.length > 1 ? U.InfoRow({ label: 'سجل النسبة', value: num(v.rateHistory.map((x) => x.rate + '% من ' + D.formatDateNumeric(x.since)).join(' ← ')) }) : null,
            ...categoryRatesBlock(v)),
          brandsSection(v),
          section('العقد', null, U.ContractCard({ status: cstat, title: cstat === 'missing' ? 'العقد غير مرفوع' : cstat === 'expired' ? 'العقد منتهي' : cstat === 'expiring' ? 'العقد بينتهي خلال 30 يوم' : 'عقد التعاون',
            sub: cstat === 'missing' ? 'ارفع نسخة موقّعة (PDF أو صورة، حتى 10 ميجا) أو حمّل قالب العقد وابعته للمبتكر' : (v.contract.expires ? (cstat === 'expired' ? 'انتهى ' : 'ساري حتى ') + D.formatDateLong(v.contract.expires) + ' · ' : '') + 'رفعه ' + (v.contract.uploadedBy || '—') + ' في ' + D.formatDateLong(v.contract.uploadedAt.slice(0, 10)) + ' · ' + v.contract.fileName.split('.').pop().toUpperCase() + ' ' + (v.contract.size / 1048576).toFixed(1) + ' ميجا',
            canManage: canBank, onUpload: () => contractForm(v), onTemplate: () => vnotify('success', 'قالب العقد هيتحمّل من السيرفر في النسخة الحقيقية.'), onView: openContract, onDownload: openContract })),
          section('سجل النشاط', null, h('div', { class: 'tl' }, (() => { const ev = vstore.events(id).slice().reverse().slice(0, 8); return ev.length ? ev.map((e) => U.TimelineEvent({ text: e.text, time: fmtTime(e.at) })) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'لسه مفيش نشاط متسجل على المبتكر ده.'); })())));
      } else if (vtab === 'products') {
        // phase 5.5 decision 3 (owner 31 Oct): his products from the mirror — search by name or SKU · copy the site link · a multi-select with the products page's actions
        const a = PAPI(); const KK = window.IBKit; const ALL = a && a.ready() ? a.makerItems([v.id]) : []; const m0 = (x) => num(D.formatMoney(x).replace(/\.00$/, ''));
        const q = vpQ.trim().toLowerCase(); const L = q ? ALL.filter((p) => (p.nameEn + ' ' + (p.nameAr || '') + ' ' + p.sku).toLowerCase().includes(q)) : ALL;
        const PB = KK.Bulk({ key: 'vprods:' + v.id, ids: L.map((p) => p.id), noun: 'منتج', render: draw, actions: !a ? [] : [
          { id: 'price', label: 'تعديل السعر', icon: 'edit', run: (ids, done) => { a.bulkPrice(ALL.filter((p) => ids.includes(String(p.id)))); done(); } },
          { id: 'link', label: 'نسخ الروابط', icon: 'link', run: (ids, done) => { a.copyLinks(ALL.filter((p) => ids.includes(String(p.id)))); done(); } },
          { id: 'draft', label: 'تحويل لمسودة', icon: 'eyeoff', run: (ids, done) => { const l = ALL.filter((p) => ids.includes(String(p.id)) && p.status === 'منشور'); if (!l.length) { KK.toast('كل المحدد مسودات أصلاً', 'error'); return; } a.toDraft(l); done(); } },
          { id: 'publish', label: 'نشر', icon: 'eye', run: (ids, done) => { const l = ALL.filter((p) => ids.includes(String(p.id)) && p.status !== 'منشور'); if (!l.length) { KK.toast('كل المحدد منشور أصلاً', 'error'); return; } a.publish(l); done(); } },
          { id: 'brand', label: 'نقل لبراند تاني', icon: 'sliders', run: (ids, done) => { a.moveBrand(ALL.filter((p) => ids.includes(String(p.id)))); done(); } },
          { id: 'del', label: 'مسح', icon: 'trash', danger: true, run: (ids, done) => { a.toTrash(ALL.filter((p) => ids.includes(String(p.id)))); done(); } }] });
        const row = (p) => h('div', { class: 'vprod-row' + (PB.has(p.id) ? ' is-sel' : ''), 'data-vprod': String(p.id) }, PB.box(p.id, p.nameEn || p.nameAr), a.thumb(p),
          h('div', { class: 'vp-name' }, h('b', null, p.nameEn || p.nameAr), h('small', { dir: 'ltr' }, p.sku), p.status !== 'منشور' ? h('span', null, h('span', { class: 'tg tg-orange' }, p.status)) : null),
          h('div', { class: 'vp-price' }, p.sale != null ? h('b', null, m0(p.sale), ' ج.م') : h('span', { class: 'help' }, '—'), p.regular != null && p.sale != null && p.regular > p.sale ? h('s', { 'aria-label': 'قبل الخصم' }, m0(p.regular)) : null),
          KK.RowMenu([{ label: 'تعديل المنتج', icon: 'edit', run: () => { vdrawer.close(); go('products'); a.openEdit(p.id); } }, p.permalink ? { label: 'نسخ رابط المنتج', icon: 'link', run: () => a.copyLinks([p]) } : null, p.status === 'منشور' ? { label: 'تحويل لمسودة', icon: 'eyeoff', run: () => a.toDraft([p]) } : { label: 'نشر على الموقع', icon: 'eye', run: () => a.publish([p]) }, { label: 'مسح', icon: 'trash', danger: true, run: () => a.toTrash([p]) }], 'إجراءات ' + (p.nameEn || p.nameAr)));
        const srch = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الـ SKU', 'aria-label': 'بحث في منتجات المبتكر', value: vpQ, 'data-vp-search': '' });
        srch.addEventListener('input', () => { vpQ = srch.value; const pos = srch.selectionStart; draw(); const n = document.querySelector('[data-vp-search]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* type=search */ } } });
        body = h('div', { class: 'drawer-b' },
          h('div', { class: 'vtab-go' }, Button({ icon: 'external', label: 'الذهاب لصفحة المنتجات', attrs: { 'data-vgo': 'products' }, onClick: () => goMakerProducts(v) })),
          section('منتجات المبتكر · ' + (q ? L.length + ' من ' + ALL.length : ALL.length), null,
            !a ? U.InlineNote({ kind: 'warning', children: 'صفحة المنتجات مش متاحة.' }) : !a.ready() ? U.InlineNote({ children: 'بنحمّل المنتجات من المرآة…' }) : null,
            ALL.length ? h('div', { class: 'vp-tools' }, h('label', { class: 'search-field' }, Icon('search', 'sm'), srch), L.length ? h('span', { class: 'vp-all' }, PB.head(), h('span', { class: 't-small' }, 'حدد الكل')) : null) : null,
            PB.bar(),
            L.length ? h('div', { class: 'vprod-list', 'data-vprods': '' }, L.map(row)) : ALL.length ? U.EmptyState('مفيش منتج بالاسم أو الـ SKU ده', 'جرّب جزء من الاسم أو الـ SKU.') : a && a.ready() ? U.EmptyState('مفيش منتجات للمبتكر ده', 'المنتجات بتتضاف من استوديو المنتجات، أو بتتنقل له من صفحة المنتجات.') : null));
      } else if (vtab === 'orders') {
        const cnt = VD.orderCounts(st.orders); const pf = VD.performance(st.orders, v.leadDays); const dc = VD.delayCounts(st.orders);
        const orders = st.orders.slice().sort((a, b) => a.ageDays - b.ageDays).slice(0, 8);
        const vtone = pf.verdict === 'محتاج متابعة' ? 'warning' : '';
        body = h('div', { class: 'drawer-b' },
          section('حالات التأخير — الأوردرات قيد التنفيذ', h('span', { class: 't-small', style: 'color:var(--color-text-secondary)' }, 'من تبليغ المبتكر · مدة التصنيع'),
            h('div', { class: 'cards delay-cards' },
              tileOpen(U.KpiTile({ label: 'قابل للتأخير', value: String(dc.risk), unit: 'أوردر', compare: 'off', note: [U.DelayBadge('risk'), ' آخر 3 أيام من مدة التصنيع'] }), v, 'risk', st.orders),
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
          section('التذاكر المفتوحة على المبتكر', Button({ type: 'text', size: 'sm', label: 'إنشاء طلب', onClick: () => { vdrawer.close(); showTickets(); openNewTicket({ type: 'vendor', vendor: v.name, vendorId: v.id }); } }), st.tickets.length ? st.tickets.map((t) => { const b = h('button', { type: 'button', class: 'opt', style: 'display:flex;justify-content:space-between;gap:8px;width:100%', onClick: () => { vdrawer.close(); showTickets(); openTicket(t.id); } }, h('span', null, num(t.id), ' — ' + t.title), h('span', { style: 'display:flex;gap:8px' }, U.TicketStatus(t.status), U.PriorityTag(t.priority))); return b; }) : h('p', { class: 't-small', style: 'margin:0;color:var(--color-text-secondary)' }, 'مفيش تذاكر مفتوحة على المبتكر ده.')));
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
          section('ملخص حسابه معانا', Button({ type: 'text', size: 'sm', icon: 'chart', label: 'تقرير المبتكر', attrs: { 'data-vreport': v.name }, onClick: () => openVendorReport(v.name) }),
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
            canBank ? [U.InfoRow({ label: 'طريقة الدفع المفضلة', value: bank ? VD.label(VD.PAY_METHODS, bank.method) : null }), U.InfoRow({ label: 'البنك', value: bank && bank.bankName }), U.InfoRow({ label: 'اسم صاحب الحساب', value: bank && bank.holder }),
              sec('accountNumber', 'رقم الحساب'), sec('iban', 'IBAN'), // phase 3.5: Dokan's fields
              U.InfoRow({ label: 'نوع الحساب', value: bank && bank.accountType ? VD.label(VD.BANK_ACCOUNT_TYPES, bank.accountType) || bank.accountType : null }), U.InfoRow({ label: 'SWIFT', value: bank && bank.swift }),
              bank && bank.routingNumber ? U.InfoRow({ label: 'Routing Number', value: bank.routingNumber }) : null, U.InfoRow({ label: 'عنوان البنك', value: bank && bank.bankAddress }),
              sec('wallet', 'رقم المحفظة / إنستاباي'), bank && bank.updatedBy === 'الموقع' ? h('p', { class: 't-small', 'data-bank-from-site': '', style: 'margin:0;color:var(--color-text-secondary)' }, 'آخر تعديل جه من الموقع (Dokan).') : null].filter(Boolean)
              : [U.SecureField({ label: 'رقم الحساب', state: 'hidden' }), U.SecureField({ label: 'IBAN', state: 'hidden' }), U.SecureField({ label: 'رقم المحفظة', state: 'hidden' })],
            U.InlineNote({ children: 'الإظهار والنسخ والتعديل متاحين للأدمن ودور الحسابات فقط، وكل إظهار أو تعديل بيتسجل في السجل.' })));
      }
      vdrawer.set(header, body);
    }
    draw(); vredraw = draw; const c = vdrawer.el.querySelector('.icon-btn'); if (c) c.focus();
    if (window.IBVendors) window.IBVendors.loadEvents(id).then(() => { if (vredraw === draw) draw(); }); // decision 6: the vendor's activity_log, once per open
  }

  function render() {
    if (state.page === 'vendors' && state.vtab === 'accounts') { renderVendors(); return; } // phase 13 decision 57: the makers page shows this tab too
    U.closePopover(); refreshSeed();
    const main = document.getElementById('main'); const sc = window.scrollY;
    const note = state.note; state.note = null; shownNote = note;
    const tabs = U.Tabs({ items: TABS, active: state.tab, onChange: (id, viaKey) => { state.tab = id; try { history.replaceState(null, '', '#' + id); } catch (e) { /* sandboxed */ } focusTab = !!viaKey; render(); } });
    const noteEl = note ? U.InlineNote({ kind: note.kind, children: note.text, action: note.undo ? Button({ type: 'text', size: 'sm', label: 'تراجع', onClick: note.undo })
      : note.action ? Button({ type: 'text', size: 'sm', label: note.action.label, attrs: { 'data-note-act': '' }, onClick: note.action.run }) : IconButton({ icon: 'close', label: 'إخفاء', onClick: () => { noteEl.remove(); } }) }) : null;
    main.replaceChildren(...[
      h('div', { class: 'page-head row' }, h('div', { class: 'title-block' }, h('h1', { class: 't-h3' }, 'الحسابات'), h('p', { class: 't-small' }, 'نظرة عامة · المصروفات · المبيعات · حسابات المبتكرين · الحساب الفعلي · سجل الحركات · التقارير')), h('div', { class: 'actions' }, state.tab === 'moves-log' ? null : window.IBKit.PanelButton('accounts:' + state.tab, 'الحسابات — ' + (TABS.find((t) => t.id === state.tab) || {}).label, () => document.getElementById('panel'), render), window.IBDataActions.Menu(window.IBDataActions.PAGES.accounts, () => ({ vendors: 'vendorMoves', actual: 'accountMoves' }[state.tab] || 'expenses')))),
      tabs,
      state.tab === 'moves-log' ? null : state.tab === 'acc-reports' ? h('div', { class: 'toolbar' }, DateRangeField('reports'), h('span', { class: 'grow' }), Button({ type: 'text', size: 'sm', label: 'افتح في صفحة التقارير', attrs: { 'data-accrep-page': '' }, onClick: () => { state.rtab = 'accounts'; go('reports'); } })) : state.tab === 'vendors' ? vendorsToolbar() : h('div', { class: 'toolbar' }, DateRangeField(), h('span', { class: 'grow' }), !canAdd() ? null : state.tab === 'expenses' ? AddMenu('إضافة مصروفات', 'expenses') : state.tab === 'subscriptions' ? Button({ type: 'brand', icon: 'plus', label: 'إضافة اشتراك', attrs: { 'data-add-sub': '' }, onClick: () => openForm('expenses', 'withdraw', null, false, { category: SUBS_CAT }) }) : state.tab === 'actual' ? AddMenu('إضافة مبلغ', 'accountMoves') : null),
      noteEl,
      h('div', { id: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + state.tab, style: 'display:flex;flex-direction:column;gap:24px;min-width:0' }, VIEWS[state.tab]())].filter(Boolean));
    // «تخصيص اللوحة» (phase 10 decision 22, as in the v5 prototype): every tab but the moves log
    if (state.tab !== 'moves-log') window.IBKit.applyPanelPrefs('accounts:' + state.tab, document.getElementById('panel'));
    window.IBKit.sweepColumns(document.getElementById('panel'));
    window.scrollTo(0, sc);
    if (focusTab) { const t = main.querySelector('[role=tab][aria-selected=true]'); if (t) t.focus(); focusTab = false; }
  }

  // phase 11 (decisions 16 / 19 / 21 / 23): the public settings every member gets with the sign-in — the brand (colors, fonts, the
  // uploaded logos), the quick actions, the bell's role matrix and this member's override, the security policy (idle, force 2FA)
  // the policy itself is enforced on the server (0056: has_perm / is_admin give nothing to a session that is not aal2 while
  // force2fa is on) — the redirect here is the experience: the member lands where enrolling happens
  let force2fa = false; let twofaToldAt = 0;
  const needs2fa = () => { if (!force2fa) return false; const me = window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null; return !!me && me.status === 'active' && !me.twofa; };
  const twofaNote = () => { if (Date.now() - twofaToldAt < 4000) return; twofaToldAt = Date.now(); window.IBKit.toast('الشركة ملزمة التحقق بخطوتين — فعّله الأول من «ملفي › بيانات الحساب»', 'error'); };
  function applyPublicSettings(pub) {
    const S0 = window.IBSettings, K = window.IBKit; if (!S0 || !K) return;
    if (!pub || typeof pub !== 'object') return;
    const r = document.documentElement.style; const b = pub.brand && typeof pub.brand === 'object' ? pub.brand : {};
    Object.entries(b.colors || {}).forEach(([k, v]) => { if (/^--color-[a-z0-9-]+$/.test(k) && /^#[0-9a-f]{6}$/i.test(String(v))) r.setProperty(k, String(v)); });
    const fonts = b.fonts && typeof b.fonts === 'object' ? b.fonts : {};
    const loadFont = (f) => { if (!f || f === 'Cairo' || !/^[A-Za-z ]{2,40}$/.test(f) || document.querySelector('link[data-font="' + f + '"]')) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.font = f; l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700&display=swap'; document.head.append(l); };
    if (typeof fonts.body === 'string' && fonts.body !== 'Cairo') { loadFont(fonts.body); r.setProperty('--font', "'" + fonts.body.replace(/[^A-Za-z ]/g, '') + "',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif"); }
    if (typeof fonts.head === 'string') { loadFont(fonts.head); r.setProperty('--font-head', "'" + fonts.head.replace(/[^A-Za-z ]/g, '') + "',var(--font)"); }
    const logos = b.logos && typeof b.logos === 'object' ? b.logos : {};
    if (window.IBLogo && window.IBLogo.set) Object.keys(logos).forEach((t) => { S0.logoUrl(logos[t]).then((u) => { if (u) window.IBLogo.set(t, u); }); });
    const q = pub.quick && typeof pub.quick === 'object' ? pub.quick : {};
    if (Array.isArray(q.list)) K.store.quickActions = q.list.filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && typeof x.link === 'string').map((x, i) => ({ id: String(x.id || 'qa-' + i), name: x.name.slice(0, 80), link: x.link.slice(0, 300), icon: typeof x.icon === 'string' ? x.icon : 'link' }));
    const n = pub.notif && typeof pub.notif === 'object' ? pub.notif : {};
    if (n.alertRoles && typeof n.alertRoles === 'object') { Object.keys(K.store.alertRoles).forEach((k) => delete K.store.alertRoles[k]); Object.assign(K.store.alertRoles, n.alertRoles); }
    if (n.myOverride && typeof n.myOverride === 'object' && K.ME) K.store.alertOverrides[K.ME] = n.myOverride;
    const sec = pub.security && typeof pub.security === 'object' ? pub.security : {};
    if (window.IBShell && window.IBShell.setIdle) window.IBShell.setIdle(sec);
    force2fa = sec.force2fa === true;
  }
  // IBSettings.loadPublic() runs inside IBDirectory.load() (the gate and the sign-in button alike) and announces ib:settings
  document.addEventListener('ib:settings', () => { const S0 = window.IBSettings; if (!S0 || !S0.public()) return; applyPublicSettings(S0.public()); if (needs2fa() && !/^(profile|login)/.test(location.hash.slice(1))) { twofaNote(); location.hash = 'profile-security'; } });
  function boot() {
    const root = document.getElementById('root');
    root.className = 'app';
    root.replaceChildren(Sidebar(), h('div', { class: 'main' }, TopHeader(), h('main', { class: 'content', id: 'main' }), h('main', { class: 'content', id: 'reports' }), h('main', { class: 'content', id: 'tickets' }), h('main', { class: 'content', id: 'vendors' }), Object.keys(window.IBPages.all()).map((id) => h('main', { class: 'content mod', id: 'pg-' + id, hidden: true })), h('div', { id: 'orders' })), BottomNav());
    U.setModalRoot(document.body); document.body.append(AiPanel());
    window.addEventListener('hashchange', () => { const hs = location.hash.slice(1); if (window.IBShell.routeLogin(hs)) return; if (needs2fa() && !/^(profile|login)/.test(hs)) { twofaNote(); location.hash = 'profile-security'; return; } if (isSoon(pageOfHash(hs))) { try { history.replaceState(null, '', '#dashboard'); } catch (e) { /* sandboxed */ } soonNote(); goNow('dashboard'); return; } const mp = modPage(hs); if (mp) { state.page = mp; showPage(); window.IBPages.render(mp, false); window.scrollTo(0, 0); return; } if (location.hash.slice(1) === 'orders') { if (state.page !== 'orders') go('orders'); return; } const rt = reportTabOf(location.hash.slice(1)); if (rt) { state.rtab = rt; if (state.page !== 'reports') { state.page = 'reports'; showPage(); } renderReports(); return; } const tk = ticketOf(location.hash.slice(1)); if (tk !== null) { if (state.page !== 'tickets') { state.page = 'tickets'; showPage(); } renderTickets(); if (tk) openTicket(tk); return; } const vd = vendorOf(location.hash.slice(1)); if (vd !== null) { if (state.page !== 'vendors') { state.page = 'vendors'; showPage(); } renderVendors(); if (vd === 'new') { try { history.replaceState(null, '', '#makers'); } catch (e) { /* sandboxed */ } if (vstore.canEdit()) openAddVendor(); else window.IBKit.toast('مفيش صلاحية إضافة مبتكر', 'error'); } else if (vd) openVendor(vd); return; } const t = hashTab(); if (t) { state.tab = t; if (state.page !== 'accounts') { state.page = 'accounts'; showPage(); } render(); } });
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
    const ctx = { vendors: (window.OrdersApp && window.OrdersApp.vendors) ? window.OrdersApp.vendors() : [], statuses: window.OrdersApp ? window.OrdersApp.statuses() : [] };
    const local = C.parseFilter(text, ctx);
    if (aiServer === false || !window.IBAI || !window.IBAI.assistant) return { filter: local, mode: 'local' };
    const r = await window.IBAI.assistant({ mode: 'filter', turns: [{ role: 'user', text }], context: ctx });
    if (!r.ok) { if (r.reason === 'not_configured' || r.reason === 'forbidden') { aiServer = false; aiModeNote(); } return { filter: local, mode: 'local' }; }
    const a = (r.actions || []).find((x) => x.name === 'set_filter');
    const out = a ? { op: a.input.op === 'or' ? 'or' : 'and', items: (a.input.items || []).filter((x) => FILTER_FIELDS.includes(x.f) && FILTER_OPS.includes(x.op)).map((x) => ({ f: x.f, op: x.op, v: x.v == null ? '' : String(x.v) })) } : null;
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
      // phase 5.5 decision 6 (owner 31 Oct 16:42): the sales / net / expenses of the dashboard's own period (accounts_sales is cached per range — null while loading)
      const dr = state.drange; const A = AC(); const srows = A ? A.sales(dr.from, dr.to) : []; const sv = srows ? D.liveSeed({ makers: [], balances: [], sales: srows }) : null;
      const per = { range: dr, label: D.formatDateNumeric(dr.from) + ' – ' + D.formatDateNumeric(dr.to), sales: sv ? { rows: sv.sales, total: sv.salesTotal } : null, loading: !sv, exp: D.categoryTotals(SEED.expenseSeed, store.expenses, dr.from, dr.to) };
      return { per, acc, actual: P.actual, vs, vendors: vendorsNow(), sales: SEED.salesTotal, salesRows: SEED.sales, expSept: D.categoryTotals(SEED.expenseSeed, store.expenses, '2026-09-01', '2026-09-30'), expNow: D.categoryTotals(SEED.expenseSeed, store.expenses, mon + '-01', mon + '-' + lastDay(yy, mm)), transport: trAll(), payroll: payrollInfo(), cycle: cycleLabel() }; },
    go, showOrders, openVendorLate, openVendorStatement, openVendorReport, openPayrollAlert, openVendor: (name) => { go('vendors'); const v = vstore.findByName ? vstore.findByName(name) : null; if (v) openVendor(v.id); },
    addExpense: () => openForm('expenses', 'withdraw'), addVendorMove: () => openForm('vendorMoves', 'withdraw'), addVendor: () => { go('vendors'); openAddVendor(); }, newTicket: (pre) => { showTickets(); openNewTicket(pre); },
    vendorNames: () => vendorsNow().map((v) => v.name),
    contracts: () => vstore.all().map((v) => ({ name: v.name, status: VD.contractStatus(v, DTODAY), expires: v.contract && v.contract.expires })),
  };
  // an order popup lives inside the orders page, so it is opened there (owner 22 Oct: before this, «فتح الأوردر» from other pages stayed hidden until you visited الأوردرات)
  // phase 5.1 (decision 20 in the phase 5 plan): the products page's «التقارير» tab shares the reports page's range (state.rrange)
  window.IBReportBlocks = { range: () => DateRangeField('reports'), get: () => state.rrange, staff: () => StaffReportView(), rangeField: (t) => DateRangeField(t), rangeOf: (t) => rangeOf(t) }; // rangeField / rangeOf: the v5's (phase 9.5.1 — the marketing plan's «plan») // staff: the HR page's own «التقارير» (phase 10 T8)
  window.IBShowOrders = () => { if (state.page !== 'orders') go('orders'); };
  window.IBOrdersHidden = () => state.page !== 'orders';
  // phase 8: «تذاكر الفريق» from the other pages — a new ticket with its context, the open tickets of an order (the search), one ticket
  const ticketsFor = (q) => { state.tfilter.q = String(q || ''); state.tf = Object.assign({}, state.tf, { status: ['open_any'] }); state.tpage = 1; state.tsub = 'log'; if (state.page !== 'tickets') go('tickets'); else renderTickets(); };
  window.IbtekrApp = Object.freeze({ eventLog: () => log.all(), aiRun, aiFilter, newTicket: (pre) => { showTickets(); openNewTicket(pre); }, ticketsFor, openTicket: (id) => { showTickets(); openTicket(id); }, logEvent: (ev) => log.append(Object.assign({ actor: ACTOR }, ev)) });
  boot(); // synchronous: the orders block (next script) mounts into #orders, which boot() creates
  // Session gate: #root stays hidden until the Supabase session is known. In order: a recovery link confirmed by supabase-js → reset form;
  // no session → login («الجلسة خلصت» again right after an idle sign-out reloaded the page: ib.loginView); idle ≥ AUTH.idleMinutes since ib.lastAct (any earlier page load) → sign out, «الجلسة خلصت»;
  // aal1 with a verified TOTP factor → 2FA view (the member is not loaded before aal2; an unreadable level fails closed: sign out,
  // login); no active profile → sign out, login. A typed #type=recovery is not a recovery: the stored session goes through every check.
  (async () => {
    const A = window.IBAuth, SH = window.IBShell, root = document.getElementById('root');
    document.addEventListener('ib:directory', () => { const old = root.querySelector('.topbar .user'); if (old) old.replaceWith(SH.AccountMenu(goHome)); }); // header shows the signed-in member
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
      root.hidden = false; if (needs2fa() && !/^(profile|login)/.test(location.hash.slice(1))) { twofaNote(); location.hash = 'profile-security'; } window.dispatchEvent(new HashChangeEvent('hashchange')); return;
    }
    if (view === 'login' && SH.isLoggedOut()) return;
    SH.showLogin(view);
  })();
})();

