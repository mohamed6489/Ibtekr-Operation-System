// «الإعدادات» (phase 11, 0056, docs/superpowers/plans/2026-11-07-phase-11-settings.md decision 25). Loaded when the page opens
// (ensure()); settings_public() alone is read with the sign-in (loadPublic — the brand, the quick actions, the security policy and the
// bell's matrix every member needs). What it holds, in the page's shapes (the v6 settings block):
//   sections()           { <section>: data }  — every settings row the member may read (settings.view ≠ N); the admin writes any of them,
//                        settings.team F writes team / integrations / security (RLS of 0002)
//   roles()              [{ id, name, description, isSystem, permissions, sort, hidden }] (hidden = a deleted system role)
//   PERMS                the permission dictionary of the matrix: [[group, [[label, key, sensitive]]]] — the real has_perm keys
// Writes (every one returns { ok, reason, field, message } and never throws): a section's data (save), the team through the 0056 RPCs
// (role_perms_set / role_create / role_update / role_delete / member_role_set / member_perms_set) and settings-admin member_status (the
// Auth ban beside the status), my sessions (my_sessions / my_session_revoke), the platform links through settings-admin (status /
// secret_set / woo_set — the probe first, confirm saves — / secret_test / secret_unlink: a secret leaves the server as its tail only),
// the engine (notify status / tick), the activity log with filters (actor, page prefix, action, period, pages of 100), the company
// papers (company_docs + bucket company-docs: a signed link of 60 seconds that is logged), the logos (bucket settings).
// activity_log settings.* carries section names, keys, platform names, role ids and member ids only — never a secret's value, an
// amount or a note (decision 25); the RPCs log their own rows.
(function () {
  'use strict';
  const LIMIT = 500; const PAGE = 100;
  const DOCS_BUCKET = 'company-docs'; const LOGO_BUCKET = 'settings';
  const DOC_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']; const DOC_MAX = 20 * 1024 * 1024;
  const LOGO_MIME = ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg']; const LOGO_MAX = 2 * 1024 * 1024;
  const TEAM_SECTIONS = ['team', 'integrations', 'security'];
  const c = () => (window.IBSupabase && window.IBSupabase.client) || null;
  const quiet = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  const perm = (key) => (window.IBDirectory && window.IBDirectory.perm ? window.IBDirectory.perm(key) : 'N');
  const me = () => (window.IBDirectory && window.IBDirectory.me ? window.IBDirectory.me() : null);
  const isAdmin = () => { const m = me(); return !!m && m.role_id === 'admin' && m.status === 'active'; };
  const can = () => ({ view: isAdmin() || perm('settings.view') !== 'N', team: isAdmin() || perm('settings.team') === 'F', admin: isAdmin() });
  const reasonOf = (err) => { const code = String((err && err.code) || ''); return code === '42501' ? 'forbidden' : code === 'P0002' || code === 'PGRST116' ? 'notfound' : code === '23505' ? 'exists' : code === '0A000' ? 'no_vault' : /^2[23]/.test(code) ? 'invalid' : 'server'; };
  const fieldOf = (err) => { const m = /invalid: (\w+)/.exec(String((err && err.message) || '')); return m ? m[1] : null; };
  const MESSAGES = { forbidden: 'مفيش صلاحية للإجراء ده', notfound: 'مش موجود أو اتحذف', network: 'تعذّر الاتصال — جرّب تاني', invalid: 'البيانات مش مقبولة', exists: 'الاسم ده موجود', server: 'حصل خطأ في السيرفر', no_vault: 'الخزنة (Vault) مش متاحة في المشروع', last_admin: 'لازم يفضل أدمن واحد نشط على الأقل' };
  const FIELD_MESSAGES = { id: 'معرّف الدور: حروف إنجليزية صغيرة وأرقام و _ بس', name: 'الاسم مطلوب (لحد 40 حرف) — اسم الدور الجاهز ثابت', base: 'اختار دور تبدأ منه', perms: 'الصلاحيات لازم تكون F أو P أو N', moves: 'كل عضو على الدور لازم يروح لدور تاني موجود', admin: 'الأدمن عنده كل الصلاحيات — مينفعش يتعدّل', self: 'مينفعش توقف نفسك', status: 'الحالة مش معروفة', reason: 'اكتب سبب الإيقاف', current: 'الجلسة الحالية بتتقفل بـ «تسجيل الخروج»', url: 'اكتب رابط الموقع كامل بـ https://', ck: 'Consumer key بيبدأ بـ ck_', cs: 'Consumer secret بيبدأ بـ cs_', key: 'المفتاح مش بالشكل المتوقع', token: 'التوكن مش بالشكل المتوقع', from: 'إيميل المرسل مش صحيح' };
  const fail = (err) => { const msg = String((err && err.message) || ''); const reason = /last admin/.test(msg) ? 'last_admin' : reasonOf(err); const field = reason === 'invalid' ? fieldOf(err) : null; return { ok: false, reason, field, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] || MESSAGES.server }; };
  const no = (reason, field) => ({ ok: false, reason, field: field || null, message: (field && FIELD_MESSAGES[field]) || MESSAGES[reason] || MESSAGES.server });
  const log = (action, detail, id) => { const L = window.IBActivity; if (L && L.log) quiet(() => L.log('settings.' + action, detail || '', { entity: 'settings', entity_id: id == null ? null : String(id) })); };
  const emit = () => quiet(() => document.dispatchEvent(new CustomEvent('ib:settings')));
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // the permission dictionary of the matrix (decision 12): the v6's groups with the real has_perm keys; the last group is sensitive
  const PERMS = Object.freeze([
    ['الأوردرات', [['عرض', 'orders.view'], ['تعديل الحالة والتأكيد', 'orders.status'], ['تعديل وحذف الأوردر', 'orders.edit']]],
    ['المبتكرين', [['عرض', 'vendors.view'], ['إضافة وتعديل', 'vendors.edit'], ['تنشيط / إيقاف', 'vendors.toggle']]],
    ['الحسابات', [['عرض', 'accounts.view'], ['إضافة مصروف / حركة', 'accounts.add'], ['الموافقة على التحويلات', 'accounts.approve']]],
    ['المنتجات', [['عرض', 'products.view'], ['تعديل', 'products.edit'], ['الاستوديو (إضافة منتجات)', 'products.add'], ['تعديل جماعي', 'products.bulk'], ['سلة المهملات', 'products.trash']]],
    ['خدمة العملاء', [['عرض', 'cs.view'], ['الرد والمحادثات', 'cs.reply'], ['العملاء والشرايح والحملات', 'cs.manage']]],
    ['المخزون', [['عرض', 'inventory.view'], ['الاستلام والحركات', 'inventory.edit'], ['التسوية واعتماد الجرد', 'inventory.approve']]],
    ['تذاكر الفريق', [['عرض', 'tickets.view'], ['إنشاء وحل التذاكر', 'tickets.manage']]],
    ['التقارير', [['عرض', 'reports.view'], ['تصدير CSV', 'reports.export']]],
    ['الموارد البشرية', [['عرض', 'hr.view'], ['الحضور وبيانات الأعضاء', 'hr.edit'], ['الموافقات', 'hr.approve']]],
    ['التسويق', [['عرض', 'marketing.view'], ['إنشاء الكامبينات', 'marketing.create'], ['النشر', 'marketing.publish']]],
    ['الإعدادات', [['عرض', 'settings.view'], ['تعديل الفريق والربط', 'settings.team']]],
    ['بيانات حساسة', [['رؤية أرقام هواتف العملاء', 'sensitive.customer_phone', 1], ['رؤية الحساب البنكي للمبتكر', 'sensitive.vendor_bank', 1], ['تعديل نسب العمولة', 'sensitive.commission', 1], ['المرتبات', 'sensitive.salaries', 1]]],
  ]);
  const PERM_KEYS = PERMS.flatMap(([, rows]) => rows.map((r) => r[1]));
  const LEVELS = ['F', 'P', 'N'];

  const data = { sections: {}, roles: [], loaded: false, public: null };
  let loading = null; let pub = null;
  const toRole = (r) => ({ id: r.id, name: r.name, description: r.description || '', isSystem: !!r.is_system, permissions: r.permissions && typeof r.permissions === 'object' ? r.permissions : {}, sort: Number(r.sort) || 0, hidden: !!r.hidden });

  // ---------- loading ----------
  async function load() {
    const cl = c(); if (!cl) return { ok: false, reason: 'network' };
    if (!can().view) { data.sections = {}; data.roles = []; data.loaded = true; emit(); return { ok: true }; }
    try {
      const [s, r] = await Promise.all([cl.from('settings').select('section, data, updated_at, updated_by').limit(LIMIT), cl.from('roles').select('id, name, description, is_system, permissions, sort, hidden').order('sort', { ascending: true }).limit(100)]);
      if (s.error) return fail(s.error);
      data.sections = Object.fromEntries((s.data || []).map((x) => [x.section, x.data && typeof x.data === 'object' ? x.data : {}]));
      data.meta = Object.fromEntries((s.data || []).map((x) => [x.section, { updatedAt: x.updated_at || null, updatedBy: x.updated_by || null }]));
      data.roles = r.error ? data.roles : (r.data || []).map(toRole);
      data.loaded = true; emit(); return { ok: true };
    } catch (e) { return { ok: false, reason: 'network', message: MESSAGES.network }; }
  }
  function ensure() { if (data.loaded) return Promise.resolve({ ok: true }); if (!loading) loading = load().finally(() => { loading = null; }); return loading; }
  // the public settings every member gets with the sign-in (brand / quick / general / security / the bell's matrix) — one RPC, cached
  async function loadPublic() {
    const cl = c(); if (!cl) return null;
    try { const { data: d, error } = await cl.rpc('settings_public'); if (error || !d || typeof d !== 'object') return pub; pub = d; data.public = d; emit(); return d; } catch (e) { return pub; }
  }
  const section = (name) => (data.sections && data.sections[name] && typeof data.sections[name] === 'object' ? data.sections[name] : {});
  const roles = () => data.roles.slice();
  const liveRoles = () => data.roles.filter((r) => !r.hidden);
  function clear() { data.sections = {}; data.roles = []; data.loaded = false; data.public = null; data.meta = {}; pub = null; }

  // ---------- a section's data (the admin; team / integrations / security with settings.team) ----------
  async function save(name, patch, opts) {
    const cl = c(); if (!cl) return no('network');
    const sec = clean(name, 40); if (!/^[a-z_]{1,40}$/.test(sec)) return no('invalid');
    if (!(TEAM_SECTIONS.includes(sec) ? can().team : can().admin)) return no('forbidden');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return no('invalid');
    const merge = !(opts && opts.merge === false); const next = merge ? Object.assign({}, section(sec), patch) : Object.assign({}, patch);
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
    try {
      const { error } = await cl.from('settings').upsert({ section: sec, data: next }, { onConflict: 'section' });
      if (error) return fail(error);
    } catch (e) { return no('network'); }
    data.sections[sec] = next; emit();
    log(sec + '.save', Object.keys(patch).sort().join(', '), sec);
    return { ok: true };
  }

  // ---------- the team (decision 12): the RPCs of 0056 ----------
  async function rpc(name, args) {
    const cl = c(); if (!cl) return no('network');
    try { const { data: d, error } = await cl.rpc(name, args); if (error) return fail(error); return { ok: true, data: d }; } catch (e) { return no('network'); }
  }
  const permsClean = (perms) => { const out = {}; for (const k of PERM_KEYS) { const v = perms && perms[k]; if (LEVELS.includes(v)) out[k] = v; } for (const [k, v] of Object.entries(perms || {})) if (!(k in out) && /^[a-z_]+\.[a-z_0-9]+$/.test(k) && LEVELS.includes(v)) out[k] = v; return out; };
  async function setRolePerms(role, perms) {
    if (!can().admin) return no('forbidden'); if (role === 'admin') return no('invalid', 'admin');
    const r = await rpc('role_perms_set', { p_role: String(role), p_perms: permsClean(perms) }); if (!r.ok) return r;
    await load(); if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }
  async function createRole(f) {
    if (!can().admin) return no('forbidden');
    const name = clean(f && f.name, 40); if (!name) return no('invalid', 'name');
    const id = clean(f && f.id, 32).toLowerCase() || slugOf(name); if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) return no('invalid', 'id');
    const r = await rpc('role_create', { p_id: id, p_name: name, p_desc: clean(f && f.desc, 200), p_base: String((f && f.base) || 'viewer') }); if (!r.ok) return r;
    await load(); return { ok: true, id: r.data || id };
  }
  const slugOf = (name) => { const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return !s ? 'r_' + Date.now().toString(36) : (/^[a-z]/.test(s) ? s : 'r_' + s).slice(0, 32); }; // an Arabic name → a generated id
  async function updateRole(role, f) {
    if (!can().admin) return no('forbidden');
    const r = await rpc('role_update', { p_role: String(role), p_name: f && f.name != null ? clean(f.name, 40) : null, p_desc: clean(f && f.desc, 200) }); if (!r.ok) return r;
    await load(); if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }
  async function deleteRole(role, moves) {
    if (!can().admin) return no('forbidden'); if (role === 'admin') return no('invalid', 'admin');
    const mv = {}; for (const [k, v] of Object.entries(moves || {})) if ((k === '*' || UUID.test(k)) && typeof v === 'string') mv[k] = v;
    const r = await rpc('role_delete', { p_role: String(role), p_moves: mv }); if (!r.ok) return r;
    await load(); if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }
  async function setMemberRole(uid, role) {
    if (!can().admin) return no('forbidden'); if (!UUID.test(String(uid))) return no('invalid');
    const r = await rpc('member_role_set', { p_member: uid, p_role: String(role) }); if (!r.ok) return r;
    if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }
  async function setMemberPerms(uid, perms) {
    if (!can().admin) return no('forbidden'); if (!UUID.test(String(uid))) return no('invalid');
    const r = await rpc('member_perms_set', { p_member: uid, p_perms: permsClean(perms) }); if (!r.ok) return r;
    if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }
  // suspend / reactivate: settings-admin (the RPC + the Auth ban); the reason is the admin's note, logged by the server
  async function setMemberStatus(uid, status, reason) {
    if (!can().admin) return no('forbidden'); if (!UUID.test(String(uid))) return no('invalid');
    const r = await invoke('settings-admin', { action: 'member_status', member_id: uid, status: String(status), reason: clean(reason, 300) }); if (!r.ok) return r;
    if (window.IBDirectory && window.IBDirectory.refresh) quiet(() => window.IBDirectory.refresh()); return { ok: true };
  }

  // ---------- my sessions (decision 19) ----------
  async function sessions() {
    const r = await rpc('my_sessions', {}); if (!r.ok) return r;
    const rows = Array.isArray(r.data) ? r.data : [];
    return { ok: true, sessions: rows.map((s) => ({ id: s.id, createdAt: s.created_at, refreshedAt: s.refreshed_at || s.created_at, device: deviceOf(s.user_agent), ip: s.ip || '', aal: s.aal || 'aal1', current: !!s.current })) };
  }
  function deviceOf(ua) {
    const u = String(ua || ''); const browser = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : /Firefox\//.test(u) ? 'Firefox' : 'متصفح';
    const os = /iPhone|iPad/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Mac OS X/.test(u) ? 'macOS' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '—';
    return browser + ' · ' + os;
  }
  async function revokeSession(id) { if (!UUID.test(String(id))) return no('invalid'); const r = await rpc('my_session_revoke', { p_id: id }); if (!r.ok) return r; return { ok: true, revoked: r.data === true }; }

  // ---------- the platform links (decisions 9 / 10 / 13): settings-admin ----------
  async function invoke(fn, body) {
    const cl = c(); if (!cl) return no('network');
    try {
      const { data: d, error } = await cl.functions.invoke(fn, { body });
      if (error) { let b = null; try { b = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) { b = null; } return fnFail(b, error); }
      if (d && typeof d === 'object' && d.error) return fnFail(d, null);
      return { ok: true, body: d };
    } catch (e) { return no('network'); }
  }
  const FN_MESSAGES = { unauthorized: 'مفيش صلاحية للإجراء ده', unknown_secret: 'المنصة دي مش معروفة', invalid: 'البيانات مش مقبولة', no_vault: 'الخزنة (Vault) مش متاحة في المشروع', not_linked: 'المنصة مش مربوطة', probe_failed: 'الاتصال بالمنصة فشل — راجع المفاتيح', busy: 'المنصة مشغولة — جرّب بعد شوية', failed: 'حصل خطأ في السيرفر', confirm: 'الاتصال نجح — أكّد الحفظ' };
  function fnFail(body, error) {
    const code = body && typeof body.error === 'string' ? body.error : (error && error.message === 'Failed to fetch' ? 'network' : 'failed');
    const field = body && typeof body.field === 'string' ? body.field : null;
    return { ok: false, reason: code, field, message: (field && FIELD_MESSAGES[field]) || FN_MESSAGES[code] || MESSAGES[code] || FN_MESSAGES.failed, body: body || null };
  }
  const fieldsClean = (fields) => { const out = {}; for (const [k, v] of Object.entries(fields || {})) if (/^[a-z_]{1,32}$/.test(k) && (typeof v === 'string' || typeof v === 'boolean')) out[k] = typeof v === 'string' ? v.trim() : v; return out; };
  async function links() { if (!can().admin) return no('forbidden'); const r = await invoke('settings-admin', { action: 'status' }); if (!r.ok) return r; return { ok: true, links: r.body.links || {}, cards: Array.isArray(r.body.cards) ? r.body.cards : [], now: r.body.now || null }; }
  async function setSecret(name, fields) { if (!can().admin) return no('forbidden'); const r = await invoke('settings-admin', { action: 'secret_set', name: clean(name, 48), fields: fieldsClean(fields) }); if (!r.ok) return r; return { ok: true, link: r.body.link, test: r.body.test || null }; } // the server logs settings.integration.set (the field names)
  // the site's keys: the probe first (confirm false → 200 { probe, pending: true } or the failure); confirm true → saved
  async function wooSet(fields, confirm) { if (!can().admin) return no('forbidden'); const r = await invoke('settings-admin', { action: 'woo_set', fields: fieldsClean(fields), confirm: confirm === true }); if (!r.ok) return r; return { ok: true, body: r.body }; }
  async function testSecret(name) { if (!can().admin) return no('forbidden'); const r = await invoke('settings-admin', { action: 'secret_test', name: clean(name, 48) }); if (!r.ok) return r; return { ok: true, test: r.body.test || r.body }; }
  async function unlink(name) { if (!can().admin) return no('forbidden'); const r = await invoke('settings-admin', { action: 'secret_unlink', name: clean(name, 48) }); if (!r.ok) return r; return { ok: true }; }
  // the other links the page shows beside the keys: each source asked on its own; a failure = «ماردش», never an error of the page
  async function connections() {
    const out = { settings: null, cs: null, wa: null, ads: null, magnific: null, notify: null };
    const ask = async (key, fn) => { try { const r = await fn(); out[key] = r && r.ok === false ? { down: true, reason: r.reason } : r; } catch (e) { out[key] = { down: true }; } };
    const CS = window.IBCS, M = window.IBMarketing, I = window.IBImages;
    await Promise.all([
      ask('settings', () => links()),
      CS && CS.channelStatus ? ask('cs', () => CS.channelStatus()) : Promise.resolve(),
      CS && CS.waStatus ? ask('wa', () => CS.waStatus()) : Promise.resolve(),
      M && M.adsStatus ? ask('ads', () => M.adsStatus()) : Promise.resolve(),
      I && I.bridgeStatus ? ask('magnific', () => I.bridgeStatus()) : Promise.resolve(),
      ask('notify', () => notifyStatus()),
    ]);
    return out;
  }
  // the engine (decision 16)
  async function notifyStatus() { if (!can().admin) return no('forbidden'); const r = await invoke('notify', { action: 'status' }); return r.ok ? { ok: true, ...r.body } : r; }
  async function notifyTick(dry) { if (!can().admin) return no('forbidden'); const r = await invoke('notify', { action: 'tick', dry: dry === true }); if (!r.ok) return r; if (dry !== true) log('notify.tick', '', null); return { ok: true, ...r.body }; }

  // ---------- the activity log with filters (decision 18): pages of 100, newest first ----------
  async function activity(f) {
    const cl = c(); if (!cl) return no('network'); if (!can().view) return no('forbidden');
    const o = f || {}; const page = Math.max(0, Number(o.page) || 0); const size = Math.min(PAGE, Math.max(1, Number(o.size) || PAGE));
    try {
      let q = cl.from('activity_log').select('id, at, actor, action, entity, entity_id, old_value, new_value').order('at', { ascending: false }).range(page * size, page * size + size);
      if (o.actor && UUID.test(String(o.actor))) q = q.eq('actor', o.actor);
      if (o.action) q = q.eq('action', clean(o.action, 60));
      else if (o.prefix && /^[a-z_]{1,30}$/.test(o.prefix)) q = q.like('action', o.prefix + '.%');
      if (o.from && /^\d{4}-\d{2}-\d{2}$/.test(o.from)) q = q.gte('at', o.from + 'T00:00:00Z');
      if (o.to && /^\d{4}-\d{2}-\d{2}$/.test(o.to)) q = q.lte('at', o.to + 'T23:59:59Z');
      const { data: rows, error } = await q; if (error) return fail(error);
      const list = Array.isArray(rows) ? rows : []; const more = list.length > size;
      const names = new Map((window.IBDirectory && window.IBDirectory.members ? window.IBDirectory.members() : []).map((m) => [m.uid, m.name]));
      return { ok: true, rows: list.slice(0, size).map((r) => ({ id: r.id, at: r.at, actor: r.actor || null, actorName: (r.actor && names.get(r.actor)) || (r.actor ? 'عضو' : 'السيستم'), action: r.action, page: pageOf(r.action), entity: r.entity || '', entityId: r.entity_id || '', oldValue: r.old_value, newValue: r.new_value })), more, page };
    } catch (e) { return no('network'); }
  }
  const PAGE_NAMES = { auth: 'الدخول', dashboard: 'لوحة التحكم', profile: 'ملفي', order: 'الأوردرات', suborder: 'الأوردرات', vendor: 'المبتكرين', accounts: 'الحسابات', product: 'المنتجات', cs: 'خدمة العملاء', inventory: 'المخزون', ticket: 'تذاكر الفريق', hr: 'الموارد البشرية', mkt: 'التسويق', settings: 'الإعدادات', delivery: 'التوصيل' };
  const pageOf = (action) => PAGE_NAMES[String(action || '').split('.')[0]] || 'أخرى';

  // ---------- the company papers (decision 20) ----------
  const toDoc = (r) => ({ id: r.id, name: r.name, type: r.type, docNo: r.doc_no || '', issued: r.issued || null, expires: r.expires || null, path: r.path, size: Number(r.size) || 0, mime: r.mime || '', notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at || null });
  async function docs() {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return { ok: true, docs: [] };
    try { const { data: rows, error } = await cl.from('company_docs').select('id, name, type, doc_no, issued, expires, path, size, mime, notes, created_by, created_at, updated_at').order('expires', { ascending: true, nullsFirst: false }).limit(LIMIT); if (error) return fail(error); return { ok: true, docs: (rows || []).map(toDoc) }; } catch (e) { return no('network'); }
  }
  const extOf = (file) => ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[file && file.type] || 'bin';
  const dateOk = (d) => d == null || d === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(d));
  async function addDoc(file, meta) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden');
    if (!file || !DOC_MIME.includes(file.type) || !(file.size > 0 && file.size <= DOC_MAX)) return no('invalid', 'file');
    const m = meta || {}; const name = clean(m.name, 120); const type = clean(m.type, 40); if (!name || !type) return no('invalid', 'name'); if (!dateOk(m.issued) || !dateOk(m.expires)) return no('invalid', 'expires');
    const path = 'docs/' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36)) + '.' + extOf(file);
    try {
      const up = await cl.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (up.error) return no('server');
      const { data: row, error } = await cl.from('company_docs').insert({ name, type, doc_no: clean(m.docNo, 60) || null, issued: m.issued || null, expires: m.expires || null, path, size: file.size, mime: file.type, notes: clean(m.notes, 1000) || null }).select('id, name, type, doc_no, issued, expires, path, size, mime, notes, created_at, updated_at').single();
      if (error) { quiet(() => cl.storage.from(DOCS_BUCKET).remove([path])); return fail(error); }
      log('doc.add', type, row.id); emit(); return { ok: true, doc: toDoc(row) };
    } catch (e) { return no('network'); }
  }
  async function updateDoc(id, meta) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden'); if (!UUID.test(String(id))) return no('invalid');
    const m = meta || {}; const patch = {}; if (m.name != null) patch.name = clean(m.name, 120); if (m.type != null) patch.type = clean(m.type, 40); if (m.docNo != null) patch.doc_no = clean(m.docNo, 60) || null; if (m.notes != null) patch.notes = clean(m.notes, 1000) || null;
    if (m.issued !== undefined) { if (!dateOk(m.issued)) return no('invalid', 'expires'); patch.issued = m.issued || null; } if (m.expires !== undefined) { if (!dateOk(m.expires)) return no('invalid', 'expires'); patch.expires = m.expires || null; }
    if (!Object.keys(patch).length) return { ok: true };
    try { const { error } = await cl.from('company_docs').update(patch).eq('id', id); if (error) return fail(error); log('doc.update', Object.keys(patch).sort().join(', '), id); emit(); return { ok: true }; } catch (e) { return no('network'); }
  }
  async function removeDoc(id) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden'); if (!UUID.test(String(id))) return no('invalid');
    try {
      const { data: row } = await cl.from('company_docs').select('id, path, type').eq('id', id).maybeSingle(); if (!row) return no('notfound');
      const { error } = await cl.from('company_docs').delete().eq('id', id); if (error) return fail(error);
      quiet(() => cl.storage.from(DOCS_BUCKET).remove([row.path])); log('doc.remove', row.type, id); emit(); return { ok: true };
    } catch (e) { return no('network'); }
  }
  // a signed link of 60 seconds (logged — «تسجيل العرض الحساس»)
  async function docUrl(id) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden'); if (!UUID.test(String(id))) return no('invalid');
    try {
      const { data: row } = await cl.from('company_docs').select('id, path, type').eq('id', id).maybeSingle(); if (!row) return no('notfound');
      const { data: s, error } = await cl.storage.from(DOCS_BUCKET).createSignedUrl(row.path, 60); if (error || !s || !s.signedUrl) return no('server');
      log('doc.view', row.type, id); return { ok: true, url: s.signedUrl };
    } catch (e) { return no('network'); }
  }

  // ---------- the brand's logos (decision 21): bucket settings, the admin writes, members read by a signed link ----------
  const LOGO_SLOTS = ['color', 'reversed', 'mark', 'pattern'];
  const logoCache = new Map();
  async function uploadLogo(slot, file) {
    const cl = c(); if (!cl) return no('network'); if (!can().admin) return no('forbidden');
    if (!LOGO_SLOTS.includes(slot)) return no('invalid'); if (!file || !LOGO_MIME.includes(file.type) || !(file.size > 0 && file.size <= LOGO_MAX)) return no('invalid', 'file');
    const path = 'brand/' + slot + '-' + Date.now().toString(36) + '.' + extOf(file);
    try {
      const up = await cl.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (up.error) return no('server');
      const logos = Object.assign({}, section('brand').logos || {}, { [slot]: path });
      const r = await save('brand', { logos }); if (!r.ok) return r;
      log('brand.logo', slot, null); return { ok: true, path };
    } catch (e) { return no('network'); }
  }
  async function logoUrl(path) {
    const cl = c(); if (!cl || typeof path !== 'string' || !/^brand\/[A-Za-z0-9._-]+$/.test(path)) return null;
    const hit = logoCache.get(path); if (hit && hit.until > Date.now()) return hit.url;
    try { const { data: s, error } = await cl.storage.from(LOGO_BUCKET).createSignedUrl(path, 7 * 86400); if (error || !s || !s.signedUrl) return null; logoCache.set(path, { url: s.signedUrl, until: Date.now() + 6 * 86400 * 1000 }); return s.signedUrl; } catch (e) { return null; }
  }

  window.IBSettings = { load, ensure, loadPublic, clear, data, section, sections: () => Object.assign({}, data.sections), roles, liveRoles, public: () => data.public, can, PERMS, PERM_KEYS,
    save, setRolePerms, createRole, updateRole, deleteRole, setMemberRole, setMemberPerms, setMemberStatus, sessions, revokeSession, deviceOf,
    links, setSecret, wooSet, testSecret, unlink, connections, notifyStatus, notifyTick, activity, pageOf, docs, addDoc, updateDoc, removeDoc, docUrl, uploadLogo, logoUrl, LOGO_SLOTS };
})();
