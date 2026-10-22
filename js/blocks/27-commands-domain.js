
/* Ibtekr command parser — pure: text -> structured intent. No DOM, no I/O.
   The UI (app.js) decides what to run; every write still goes through validation + the adapter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrCommands = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const digits = (s) => String(s).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/٬/g, ',').replace(/٫/g, '.');
  const norm = (s) => digits(s).toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
  const pad = (n) => String(n).padStart(2, '0');
  const has = (t, ...words) => words.some((w) => t.includes(w));

  function findVendor(t, vendors) {
    const list = (vendors || []).map((v) => ({ v, n: norm(v) })).sort((a, b) => b.n.length - a.n.length);
    const hit = list.find((x) => t.includes(x.n));
    return hit ? hit.v : '';
  }
  function amountOf(text) { const m = /(\d[\d,]*(?:\.\d+)?)/.exec(digits(text)); return m ? m[1].replace(/,/g, '') : ''; }
  const ORDER_STATUS = [['جاري التنفيذ', 'جاري التنفيذ'], ['قيد الانتظار', 'قيد الانتظار'], ['جاهز للشحن', 'جاهز للشحن'], ['جاهزه للشحن', 'جاهز للشحن'], ['قيد الشحن', 'قيد الشحن'], ['ملغي', 'ملغي'], ['ملغيه', 'ملغي'], ['ملغيات', 'ملغي'], ['مكتمل', 'مكتمل'], ['استرجاع', 'استرجاع'], ['معلق', 'معلّق']];

  const CAT = (h) => (has(h, 'مرتبات') ? 'المرتبات' : has(h, 'اشتراكات') ? 'الاشتراكات' : has(h, 'اعلانات') ? 'الإعلانات' : /(نوع|فئه|بند) مصروفات|مصروفات عامه|^مصروفات$/.test(h) ? 'المصروفات' : '');
  function parseCommand(text, ctx) {
    const raw = digits(text == null ? '' : text).trim();
    const t = norm(raw);
    if (!t) return { type: 'unknown' };
    const vendors = (ctx && ctx.vendors) || [];
    const year = Number(((ctx && ctx.today) || '2026-01-01').slice(0, 4));

    if (/(امسح|الغي|ازل|شيل).*(الفلاتر|الفلتر)/.test(t)) return { type: 'ordersClear' };

    // ---- money movements ----
    const dir = has(t, 'اسحب', 'سحب') ? 'withdraw' : has(t, 'ايداع', 'اودع', 'ودع') ? 'deposit' : null;
    if (dir && /^(سجل|اضف|ضيف|ايداع|اودع|اسحب|سحب|عايز|عاوز)/.test(t)) {
      const accounts = [['حساب البنك', /بنك/], ['حساب بوسطه'.replace('بوسطه', 'بوسطة'), /بوسط/], ['حساب باي موب', /باي موب|paymob|باي ?موب/], ['محفظة إلكترونية', /محفظ/]];
      const acc = accounts.find(([, re]) => re.test(t));
      if (acc) { const amount = amountOf(raw); return { type: 'addAccountMove', direction: dir, amount, account: acc[0], missing: amount ? [] : ['amount'] }; }
      if (has(t, 'مورد', 'عربون')) {
        const amount = amountOf(raw); const vendor = findVendor(t, vendors);
        const vendorType = has(t, 'مواصلات', 'اوبر') ? 'مواصلات' : 'عربون';
        return { type: 'addVendorMove', direction: dir, amount, vendorType, otherName: '', vendor, missing: [...(amount ? [] : ['amount']), ...(vendor ? [] : ['vendor'])] };
      }
      // expense: split off the beneficiary clause first so its words don't leak into the category
      let head = raw, beneficiary = '', otherName = '';
      const bm = /(?:للمستفيد|المستفيد|لصالح)\s+(.+)$/.exec(raw);
      if (bm) {
        head = raw.slice(0, bm.index);
        const name = bm[1].trim(); const v = findVendor(norm(name), vendors);
        if (v && norm(name) === norm(v)) beneficiary = v; else { beneficiary = 'آخر'; otherName = name; }
      }
      const h = norm(head); const amount = amountOf(head);
      const category = CAT(h);
      return { type: 'addExpense', direction: dir, amount, category, beneficiary, otherName, missing: [...(amount ? [] : ['amount']), ...(category ? [] : ['category'])] };
    }

    if (/(رتب|ترتيب)/.test(t) && has(t, 'مورد')) return { type: 'sortVendors', sort: (has(t, 'عربون') ? 'deposits' : 'balance') + ':' + (has(t, 'اقل') ? 'asc' : 'desc') };

    // ---- orders filters ----
    const sm = /(?:ابحث عن|ابحث|دور على)\s+(.+)$/.exec(raw);
    if (sm) return { type: 'ordersFilter', filter: { q: sm[1].trim() } };
    if (has(t, 'اوردر')) {
      const filter = {};
      if (has(t, 'قابل') && has(t, 'للتاخير')) filter.deliv = 'risk';
      else if (has(t, 'متاخر')) filter.deliv = 'late';
      const st = ORDER_STATUS.find(([k]) => t.includes(k)); if (st) filter.st = st[1];
      const v = has(t, 'مورد') ? findVendor(t, vendors) : ''; if (v) filter.vendor = v;
      if (Object.keys(filter).length) return { type: 'ordersFilter', filter };
    }

    // ---- period ----
    const mi = MONTHS.findIndex((m) => t.includes(m));
    if (mi >= 0) { const last = new Date(Date.UTC(year, mi + 1, 0)).getUTCDate(); return { type: 'setRange', range: { from: year + '-' + pad(mi + 1) + '-01', to: year + '-' + pad(mi + 1) + '-' + pad(last) } }; }
    const lastN = /اخر (7|14|28|30) ?(?:يوم|ايام)/.exec(t); if (lastN) return { type: 'setRange', preset: 'last' + lastN[1] };
    if (has(t, 'الشهر الماضي')) return { type: 'setRange', preset: 'lastMonth' };
    if (has(t, 'هذا الشهر', 'الشهر ده', 'الشهر الحالي')) return { type: 'setRange', preset: 'thisMonth' };
    if (has(t, 'الاسبوع الماضي')) return { type: 'setRange', preset: 'lastWeek' };
    if (has(t, 'هذا الاسبوع', 'الاسبوع ده')) return { type: 'setRange', preset: 'thisWeek' };

    // ---- navigation ----
    if (has(t, 'حسابات الموردين') || (has(t, 'الموردين') && !has(t, 'اوردر'))) return { type: 'navigate', page: 'accounts', tab: 'vendors' };
    if (has(t, 'الحساب الفعلي')) return { type: 'navigate', page: 'accounts', tab: 'actual' };
    if (has(t, 'المبيعات')) return { type: 'navigate', page: 'accounts', tab: 'sales' };
    if (has(t, 'المصروفات')) return { type: 'navigate', page: 'accounts', tab: 'expenses' };
    if (has(t, 'الحسابات')) return { type: 'navigate', page: 'accounts', tab: 'expenses' };
    if (has(t, 'اوردر')) return { type: 'navigate', page: 'orders' };
    return { type: 'unknown' };
  }
  // Complete a pending write command with the user's follow-up reply (only the fields still missing).
  function fillMissing(cmd, text, ctx) {
    const next = { ...cmd }; const t = norm(text);
    if (next.missing.includes('amount')) next.amount = amountOf(text);
    if (next.missing.includes('category')) next.category = CAT(t);
    if (next.missing.includes('vendor')) next.vendor = findVendor(t, (ctx && ctx.vendors) || []);
    next.missing = next.missing.filter((k) => !next[k]);
    return next;
  }
  // ---- natural language -> filter builder conditions (orders page "describe how to filter") ----
  const DELIV = [['متاخر', 'متأخر'], ['قابل للتاخير', 'قابل للتأخير'], ['غير متاخر', 'غير متأخر'], ['في الموعد', 'غير متأخر']];
  const CONF = [['في انتظار الرد', 'في انتظار الرد'], ['انتظار الرد', 'في انتظار الرد'], ['مستني الرد', 'في انتظار الرد'], ['غير مؤكد', 'غير مؤكد'], ['غير موكد', 'غير مؤكد'], ['مش مؤكد', 'غير مؤكد'], ['مش موكد', 'غير مؤكد'], ['بدون عربون', 'مؤكد بدون عربون'], ['بعربون', 'مؤكد بعربون'], ['مؤكد', 'مؤكد بعربون'], ['موكد', 'مؤكد بعربون']];
  const STATUS = [['جاري التنفيذ', 'جاري التنفيذ'], ['قيد التنفيذ', 'جاري التنفيذ'], ['قيد الانتظار', 'قيد الانتظار'], ['جاهز للشحن', 'جاهز للشحن'], ['قيد الشحن', 'قيد الشحن'], ['تم rtc', 'تم RTC'], ['مكتمل', 'مكتمل'], ['استرجاع', 'استرجاع'], ['مرتجع', 'استرجاع'], ['ملغي', 'ملغي'], ['معلق', 'معلّق']];
  function parseFilter(text, ctx) {
    const raw = digits(text == null ? '' : text).trim(); let t = norm(raw); const items = [];
    if (!t) return { op: 'and', items };
    const op = /(^|\s)(او|أو)(\s|$)/.test(t) && !/\sو(\s|$)/.test(' ' + t + ' ') ? 'or' : (/(^|\s)(او|أو)(\s|$)/.test(t) ? 'or' : 'and');
    const take = (re) => { const m = re.exec(t); if (m) t = t.replace(m[0], ' '); return m; };
    let m;
    // delivery states (before status words so "متأخر" is not eaten)
    for (const [k, v] of DELIV) if (t.includes(k)) { items.push({ f: 'deliv', op: 'eq', v }); t = t.split(k).join(' '); break; }
    // confirmation
    for (const [k, v] of CONF) if (t.includes(k)) { items.push({ f: 'cf', op: 'eq', v }); t = t.split(k).join(' '); break; }
    // statuses (can be several with أو)
    for (const [k, v] of STATUS) if (t.includes(k)) { items.push({ f: 'st', op: 'eq', v }); t = t.split(k).join(' '); }
    // vendor
    const vendor = findVendor(t, (ctx && ctx.vendors) || []); if (vendor) { items.push({ f: 'vendor', op: 'eq', v: vendor }); t = t.replace(norm(vendor), ' '); }
    // customer name / order id
    if ((m = take(/(?:العميل|العميله|الاسم|اسمه|اسمها|باسم)\s*(?:اسمه|اسمها)?\s*([a-z0-9_.\u0600-\u06ff]+)/))) items.push({ f: 'name', op: 'has', v: m[1] });
    if ((m = take(/(?:رقم|اوردر|ib-?)\s*#?(\d{5,})/))) items.push({ f: 'id', op: 'has', v: m[1] });
    // age
    if ((m = take(/عمر[\u0600-\u06ff]*\s*(?:اكتر|اكبر|فوق)\s*(?:من)?\s*(\d+)/))) items.push({ f: 'age', op: 'gt', v: m[1] });
    else if ((m = take(/عمر[\u0600-\u06ff]*\s*(?:اقل|اصغر|تحت)\s*(?:من)?\s*(\d+)/))) items.push({ f: 'age', op: 'lt', v: m[1] });
    // amounts
    if ((m = take(/(?:اكتر|اكبر|فوق)\s*(?:من)?\s*(\d[\d,]*)/))) items.push({ f: 'tot', op: 'gt', v: m[1].replace(/,/g, '') });
    if ((m = take(/(?:اقل|اصغر|تحت)\s*(?:من)?\s*(\d[\d,]*)/))) items.push({ f: 'tot', op: 'lt', v: m[1].replace(/,/g, '') });
    // sort: deliv, vendor, tot, age keep insertion order except move 'age' after tot? keep as built but ensure tot before age
    const order = { deliv: 0, cf: 1, st: 2, vendor: 3, name: 4, id: 5, tot: 6, age: 7 };
    items.sort((a, b) => order[a.f] - order[b.f]);
    return { op: items.length > 1 ? op : 'and', items };
  }
  return Object.freeze({ parseCommand, fillMissing, parseFilter, norm });
});

