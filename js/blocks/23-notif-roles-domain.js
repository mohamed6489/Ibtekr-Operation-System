
/* Ibtekr — alerts by role (owner 22 Oct). Pure, no DOM. UMD.
   Every bell tab is an alert source. Each role gets one code per source:
   R = يستلم (bell + count + channels) · S = يشوف بس (in the panel, muted, not counted) · N = لا.
   A role can never receive a source whose data its permissions hide; a member override works inside that gate. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IbtekrNotifRoles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // columns follow settings ROLES: أدمن · عمليات · خدمة العملاء · حسابات · متابعة الموردين · مشاهد
  const ROLES = Object.freeze(['أدمن', 'عمليات', 'خدمة العملاء', 'حسابات', 'متابعة الموردين', 'مشاهد']);
  const P = (g, r, need) => ({ g, r, need });
  const SOURCES = Object.freeze([
    { key: 'customers.late', section: 'عملاء', label: 'أوردرات متأخرة — محتاج متابعة', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'customers.follow', section: 'عملاء', label: 'أوردرات معلّقة — متابعة', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'customers.unconf', section: 'عملاء', label: 'غير مؤكد', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'customers.waiting', section: 'عملاء', label: 'في انتظار رد العميل', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'vendors.late', section: 'الموردين', label: 'مورد متأخر', perm: P('المبتكرين', 'عرض', 'P') },
    { key: 'vendors.risk', section: 'الموردين', label: 'مورد قابل للتأخير', perm: P('المبتكرين', 'عرض', 'P') },
    { key: 'vendors.daily', section: 'الموردين', label: 'المتابعة اليومية للمورد', perm: P('المبتكرين', 'عرض', 'P') },
    { key: 'vendors.weekly', section: 'الموردين', label: 'التقرير الأسبوعي للمورد', perm: P('المبتكرين', 'عرض', 'P') },
    { key: 'accounts.payroll', section: 'الحسابات', label: 'مرتبات الموظفين', perm: P('الحسابات', 'عرض', 'F') },
    { key: 'accounts.vendors', section: 'الحسابات', label: 'كشوف حساب الموردين', perm: P('المبتكرين', 'عرض', 'P') },
    { key: 'tasks.urgent', section: 'مهام', label: 'مهام عاجلة', perm: P('تذاكر الفريق', 'عرض', 'P') },
    { key: 'tasks.high', section: 'مهام', label: 'مهام عالية', perm: P('تذاكر الفريق', 'عرض', 'P') },
    { key: 'tasks.normal', section: 'مهام', label: 'مهام عادية', perm: P('تذاكر الفريق', 'عرض', 'P') },
    { key: 'tasks.low', section: 'مهام', label: 'مهام منخفضة', perm: P('تذاكر الفريق', 'عرض', 'P') },
    { key: 'messages.waiting', section: 'رسايل', label: 'مستنية ردنا', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'messages.late', section: 'رسايل', label: 'متأخرة عن الرد', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'messages.mention', section: 'رسايل', label: 'منشن', perm: null },
    { key: 'messages.channels', section: 'رسايل', label: 'القنوات (فصل / خطأ)', perm: null },
    { key: 'messages.upset', section: 'رسايل', label: 'تعليقات سلبية', perm: null },
    { key: 'messages.camps', section: 'رسايل', label: 'حملات (بتتبعت / اتوقفت)', perm: null },
    { key: 'team.ot', section: 'الفريق', label: 'وقت إضافي محتاج تأكيد', perm: null },
    { key: 'team.req', section: 'الفريق', label: 'طلبات (إجازة / سُلفة / تصحيح)', perm: null },
    { key: 'team.meet', section: 'الفريق', label: 'ميتنجات فردية', perm: null },
    { key: 'stock.cons', section: 'المخزن', label: 'تجميع متأخر', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'stock.photo', section: 'المخزن', label: 'تصوير متأخر', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'stock.ret', section: 'المخزن', label: 'مرتجعات بانتظار الفحص', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'stock.pull', section: 'المخزن', label: 'سحب تلقائي من المتاح', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'delivery.waybills', section: 'التوصيل', label: 'بوالص بوسطة مطلوبة', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'delivery.late', section: 'التوصيل', label: 'بوليصة متأخرة (+24 ساعة)', perm: P('الأوردرات', 'عرض', 'P') },
    { key: 'delivery.daily', section: 'التوصيل', label: 'ملخص التوصيل اليومي', perm: P('الأوردرات', 'عرض', 'P') }]);
  const DEFAULTS = Object.freeze({
    'customers.late': 'RRRNSN', 'customers.follow': 'RRRNNN', 'customers.unconf': 'RRRNNN', 'customers.waiting': 'RSRNNN',
    'vendors.late': 'RRSNRN', 'vendors.risk': 'RSNNRN', 'vendors.daily': 'RSNNRN', 'vendors.weekly': 'RSNSRN',
    'accounts.payroll': 'RNNRNN', 'accounts.vendors': 'RSNRRN',
    'tasks.urgent': 'RRRRRS', 'tasks.high': 'RRRRRS', 'tasks.normal': 'RSSSSN', 'tasks.low': 'SSSSSN',
    'messages.waiting': 'RSRNNN', 'messages.late': 'RRRNNN', 'messages.mention': 'RRRRRR', 'messages.channels': 'RRRNNN', 'messages.upset': 'RSRNNN', 'messages.camps': 'RSRNNN',
    'team.ot': 'RRNNNN', 'team.req': 'RRNNNN', 'team.meet': 'RRNNNN',
    'stock.cons': 'RRNNNN', 'stock.photo': 'RRNNNN', 'stock.ret': 'RRNNSN', 'stock.pull': 'RSNNNN' , 'delivery.waybills': 'RRNNNN', 'delivery.late': 'RRNNNN', 'delivery.daily': 'RRNNNN'});
  const CODES = Object.freeze({ R: 'يستلم', S: 'يشوف بس', N: 'لا' });
  const RANK = { N: 0, P: 1, F: 2 };

  function permLevel(perms, g, r, ci) { const grp = (perms || []).find((x) => x[0] === g); const row = grp && grp[1].find((x) => x[0] === r); return row ? (row[1][ci] || 'N') : 'N'; }
  function canSee(perms, src, ci) { if (!src || !src.perm) return true; if (ci === 0) return true; return RANK[permLevel(perms, src.perm.g, src.perm.r, ci)] >= RANK[src.perm.need]; }
  function access(matrix, perms, key, ci, override) {
    const src = SOURCES.find((s) => s.key === key); if (!canSee(perms, src, ci)) return 'N';
    let c = override && override !== 'role' ? override : ((matrix && matrix[key]) || DEFAULTS[key] || 'N'.repeat(ROLES.length))[ci] || 'N';
    if (ci === 0 && c === 'N') c = 'S';
    return c;
  }
  const nextCode = (c, ci) => (c === 'R' ? 'S' : c === 'S' ? (ci === 0 ? 'R' : 'N') : 'R');
  const normRole = (r) => String(r || '').trim().replace(/^ال/, '');
  function isMine(item, me) {
    const o = item && item.own; if (!o || !me) return false;
    return (!!o.member && (o.member === me.name || o.member === me.id)) || (!!o.role && normRole(o.role) === normRole(me.role)) || (!!o.manager && o.manager === me.id);
  }
  // sections: [{ id, label, tabs: [[id, label, items], …] }] · acc(key) → R|S|N · opts.scope 'mine' keeps own items only
  function filterSections(sections, acc, opts) {
    const o = opts || {}; const out = [];
    for (const sec of sections || []) {
      const tabs = sec.tabs.filter((t) => t[0] !== 'all').map((t) => { const code = acc(sec.id + '.' + t[0]); if (code === 'N') return null;
        let items = t[2].map((it) => (code === 'S' ? Object.assign({}, it, { muted: true }) : it)); if (o.scope === 'mine') items = items.filter((it) => isMine(it, o.me));
        return [t[0], t[1], items, code]; }).filter(Boolean);
      if (!tabs.length) continue;
      const all = tabs.reduce((a, t) => a.concat(t[2]), []);
      out.push(Object.assign({}, sec, { tabs: [['all', 'الكل', all]].concat(tabs), received: all.filter((x) => !x.muted).length }));
    }
    return out;
  }
  const roleDigestKeys = (matrix, perms, ci) => SOURCES.map((s) => s.key).filter((k) => access(matrix, perms, k, ci) === 'R');
  // role columns (owner 22 Oct: role popup — create copies the base role, delete drops the column)
  const colSet = (str, ci, c) => { const v = String(str || '').padEnd(ci + 1, 'N'); return v.slice(0, ci) + c + v.slice(ci + 1); };
  const colDrop = (str, ci) => { const v = String(str || ''); return ci < v.length ? v.slice(0, ci) + v.slice(ci + 1) : v; };
  function matrixCopyCol(matrix, from, to) { const out = Object.assign({}, matrix || {}); for (const s of SOURCES) { const base = out[s.key] || DEFAULTS[s.key]; out[s.key] = colSet(base, to, base[from] || 'N'); } return out; }
  function matrixDropCol(matrix, ci) { const out = {}; for (const k of Object.keys(matrix || {})) out[k] = colDrop(matrix[k], ci); return out; }
  const permsDropCol = (perms, ci) => (perms || []).map(([g, rows]) => [g, rows.map((r) => [r[0], colDrop(r[1], ci)].concat(r.slice(2)))]);
  return Object.freeze({ ROLES, SOURCES, DEFAULTS, CODES, permLevel, canSee, access, nextCode, isMine, normRole, filterSections, roleDigestKeys, colSet, colDrop, matrixCopyCol, matrixDropCol, permsDropCol });
});

