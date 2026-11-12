// Phase 11 (0056): the settings page's server side, emulated for supabase-mock.mjs (not a test file itself) — the team RPCs
// (role_perms_set / role_create / role_update / role_delete / member_role_set / member_perms_set), my sessions, settings_public, the
// Edge Functions settings-admin (the platform keys in a fake Vault: a secret never comes back, its tail only; the probes answer ok)
// and notify (status / tick), company_docs + the bucket company-docs, the bucket settings (the logos), and activity_log with the
// filters the page sends (eq / like / gte / lte, offset/limit or Range pages). settingsState(opts) seeds (opts.roles → the roles copy, opts.vault,
// opts.companyDocs, opts.sessions); settingsRoute(c) answers a request of those paths or returns null. Every RPC / function call
// lands in st.calls, every write in st.writes.
import { CARDS, SECRET_NAMES, fieldsOf, nameOk, parseSecret, secretPublic } from '../../supabase/functions/_shared/settings-link.js';
import { SOURCES } from '../../supabase/functions/_shared/notify.js';

const PERM_KEY = /^[a-z_]+\.[a-z_0-9]+$/;
const ROLE_ID = /^[a-z][a-z0-9_]{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_COLS = ['id', 'name', 'type', 'doc_no', 'issued', 'expires', 'path', 'size', 'mime', 'notes', 'created_by', 'created_at', 'updated_at'];
const copy = (l) => (l || []).map((x) => JSON.parse(JSON.stringify(x)));

export function settingsState(opts = {}, roles) {
  return {
    roles: copy(roles).map((r) => ({ hidden: false, ...r })),
    vault: { ...(opts.vault || {}) }, // name → JSON string (the fake Vault)
    docs: copy(opts.companyDocs).map((x, i) => ({ id: 'd0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), doc_no: null, issued: null, expires: null, size: 100, mime: 'application/pdf', notes: null, created_by: null, created_at: '2026-11-01T08:00:00Z', updated_at: null, ...x })),
    objects: new Map(Object.entries(opts.settingsObjects || {})), // 'bucket/path' → { type }
    sessions: copy(opts.sessions || [{ id: 'b0000000-0000-4000-8000-000000000001', created_at: '2026-11-01T08:00:00Z', refreshed_at: '2026-11-07T09:00:00Z', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', ip: '41.1.1.1', aal: 'aal1', current: true },
      { id: 'b0000000-0000-4000-8000-000000000002', created_at: '2026-11-05T08:00:00Z', refreshed_at: '2026-11-06T09:00:00Z', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', ip: '41.1.1.2', aal: 'aal1', current: false }]),
    notifyRuns: [], calls: [], writes: [], probeOk: opts.probeOk !== false, seq: 0,
  };
}

export function settingsRoute(c) {
  const { method, path, url, hd, u, hasPerm, isAdmin, json, mock } = c; const S = mock.st; if (!S) return null;
  const rpc = /^\/rest\/v1\/rpc\/(role_perms_set|role_create|role_update|role_delete|member_role_set|member_roles_set|member_perms_set|member_status_set|my_sessions|my_session_revoke|settings_public)$/.exec(path);
  const fn = method === 'POST' && (path === '/functions/v1/settings-admin' || path === '/functions/v1/notify');
  const docs = path === '/rest/v1/company_docs'; const sto = /^\/storage\/v1\/object\/(sign\/)?(company-docs|settings)\/(.+)$/.exec(path);
  const act = method === 'GET' && path === '/rest/v1/activity_log' && [...url.searchParams].some(([k, v]) => k === 'action' && v.startsWith('like.') || (k === 'at' && /^(lte|gte)\./.test(v))) || (method === 'GET' && path === '/rest/v1/activity_log' && (hd.range || url.searchParams.has('offset')));
  if (!rpc && !fn && !docs && !sto && !act) return null;
  const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
  const now = new Date().toISOString(); const body = c.body();
  // a signed URL opened with no key (a new tab)
  if (sto && sto[1] && method === 'GET' && !u) { const key = sto[2] + '/' + decodeURIComponent(sto[3]); const obj = S.objects.get(key); return obj ? c.route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': obj.type || 'application/pdf' }, body: Buffer.from('%PDF-1.4 mock') }) : json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' }); }
  if (!u) return fn ? json(401, { error: 'unauthorized' }) : refuse(401, '42501', 'permission denied');
  const admin = isAdmin(u); const active = u.status === 'active';
  const logRow = (action, entity, entityId, oldV, newV) => { mock.activityRows.push({ id: 100000 + mock.activityRows.length, at: now, actor: u.id, action, entity, entity_id: entityId, old_value: oldV ?? null, new_value: newV ?? null }); };
  const alertAdmins = (title, entityId) => { const a = mock.settings.find((x) => x.section === 'activity'); if (a && a.data && a.data.permAlert === false) return; mock.alerts.unshift({ id: 900000 + mock.alerts.length, at: now, kind: 'settings.perm', title, body: null, role_id: 'admin', user_id: null, entity: 'settings-team', entity_id: entityId }); };
  const permsOk = (p) => p && typeof p === 'object' && !Array.isArray(p) && Object.entries(p).every(([k, v]) => PERM_KEY.test(k) && ['F', 'P', 'N'].includes(v));

  // ---------------------------------------------------------------- the RPCs
  if (rpc) {
    const name = rpc[1]; S.calls.push({ rpc: name, args: body });
    if (name === 'settings_public') {
      if (!active) return refuse(401, '42501', 'not allowed');
      const sec = (s) => (mock.settings.find((x) => x.section === s) || {}).data || {};
      const g = sec('general'), se = sec('security'), n = sec('notif'), li = sec('lists');
      const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
      return json(200, { brand: sec('brand'), quick: sec('quick'), lists: strip({ cancel: li.cancel, returns: li.returns }), general: strip({ company: g.company, site: g.site, tz: g.tz, week: g.week, compact: g.compact, thumbs: g.thumbs, rememberFilters: g.rememberFilters, hidePhones: g.hidePhones }),
        security: strip({ force2fa: se.force2fa, idle: se.idle, idleDesktop: se.idleDesktop, idleMobile: se.idleMobile, pwMin: se.pwMin }), notif: strip({ alertRoles: n.alertRoles || {}, myOverride: (n.alertOverrides || {})[u.id] || {}, whatsappTemplate: n.whatsappTemplate }) });
    }
    if (name === 'my_sessions') { if (!active) return refuse(401, '42501', 'not allowed'); return json(200, S.sessions.map((s) => ({ ...s }))); }
    if (name === 'my_session_revoke') {
      const i = S.sessions.findIndex((s) => s.id === body.p_id); if (i >= 0 && S.sessions[i].current) return refuse(400, '22023', 'invalid: current');
      if (i >= 0) { S.sessions.splice(i, 1); logRow('settings.session.revoke', 'profile', u.id); } return json(200, i >= 0);
    }
    if (!admin) return refuse(401, '42501', 'admin only');
    const role = (id) => S.roles.find((r) => r.id === id);
    if (name === 'role_perms_set') {
      if (body.p_role === 'admin') return refuse(400, '22023', 'the admin role has every permission'); if (!permsOk(body.p_perms)) return refuse(400, '22023', 'invalid: perms');
      const r = role(body.p_role); if (!r) return refuse(404, 'P0002', 'no such role');
      const changed = [...new Set(Object.keys(body.p_perms).filter((k) => (r.permissions[k] || 'N') !== body.p_perms[k]).concat(Object.keys(r.permissions).filter((k) => !(k in body.p_perms) && r.permissions[k] !== 'N')))].sort();
      r.permissions = { ...body.p_perms }; S.writes.push({ table: 'roles', op: 'perms', id: r.id, changed });
      logRow('settings.role.perms', 'role', r.id, changed, body.p_perms); if (changed.length) alertAdmins('اتغيّرت صلاحيات دور «' + r.name + '» (' + changed.length + ')', r.id);
      return json(204, null);
    }
    if (name === 'role_create') {
      if (!ROLE_ID.test(String(body.p_id))) return refuse(400, '22023', 'invalid: id'); const nm = String(body.p_name || '').trim(); if (!nm || nm.length > 40) return refuse(400, '22023', 'invalid: name');
      if (S.roles.some((r) => r.id === body.p_id || r.name.trim().toLowerCase() === nm.toLowerCase())) return refuse(409, '23505', 'exists');
      const base = role(body.p_base); if (!base || base.hidden) return refuse(400, '22023', 'invalid: base');
      const r = { id: body.p_id, name: nm, description: String(body.p_desc || '').trim() || null, is_system: false, permissions: base.id === 'admin' ? {} : { ...base.permissions }, sort: Math.max(0, ...S.roles.map((x) => x.sort || 0)) + 1, hidden: false };
      S.roles.push(r); S.writes.push({ table: 'roles', op: 'insert', id: r.id }); logRow('settings.role.create', 'role', r.id, null, { name: nm, base: body.p_base }); alertAdmins('اتعمل دور جديد «' + nm + '»', r.id);
      return json(200, r.id);
    }
    if (name === 'role_update') {
      const r = role(body.p_role); if (!r) return refuse(404, 'P0002', 'no such role');
      if (body.p_name != null && String(body.p_name).trim() !== r.name) { if (r.is_system) return refuse(400, '22023', 'invalid: name'); const nm = String(body.p_name).trim(); if (!nm || nm.length > 40) return refuse(400, '22023', 'invalid: name'); if (S.roles.some((x) => x.id !== r.id && x.name.trim().toLowerCase() === nm.toLowerCase())) return refuse(409, '23505', 'exists'); r.name = nm; }
      r.description = String(body.p_desc || '').trim() || null; S.writes.push({ table: 'roles', op: 'update', id: r.id }); logRow('settings.role.update', 'role', r.id, null, { name: r.name }); return json(204, null);
    }
    if (name === 'role_delete') {
      if (body.p_role === 'admin') return refuse(400, '22023', 'the admin role cannot be deleted'); const r = role(body.p_role); if (!r) return refuse(404, 'P0002', 'no such role');
      const moves = body.p_moves || {}; const moved = [];
      for (const p of mock.profiles.filter((x) => x.role_id === r.id)) { const to = moves[p.id] || moves['*']; if (!to || to === r.id || !S.roles.some((x) => x.id === to && !x.hidden)) return refuse(400, '22023', 'invalid: moves'); p.role_id = to; p.extra_roles = (p.extra_roles || []).filter((x) => x !== to); moved.push({ member: p.id, to }); }
      mock.profiles.forEach((p) => { if ((p.extra_roles || []).includes(r.id)) p.extra_roles = p.extra_roles.filter((x) => x !== r.id); }); // 0081: the extras lose it
      if (r.is_system) r.hidden = true; else S.roles.splice(S.roles.indexOf(r), 1);
      S.writes.push({ table: 'roles', op: 'delete', id: r.id, moved }); logRow('settings.role.delete', 'role', r.id, { name: r.name }, moved); alertAdmins('اتحذف دور «' + r.name + '»', r.id); return json(204, null);
    }
    if (name === 'member_role_set') {
      const p = mock.profiles.find((x) => x.id === body.p_member); if (!p) return refuse(404, 'P0002', 'no such member'); const to = role(body.p_role); if (!to || to.hidden) return refuse(400, '22023', 'invalid: role');
      if (p.role_id === 'admin' && to.id !== 'admin' && !mock.profiles.some((x) => x.id !== p.id && x.role_id === 'admin' && x.status === 'active')) return refuse(400, '22023', 'last admin');
      const old = p.role_id; p.role_id = to.id; p.extra_roles = to.id === 'admin' ? [] : (p.extra_roles || []).filter((x) => x !== to.id); S.writes.push({ table: 'profiles', op: 'role', id: p.id, from: old, to: to.id }); logRow('settings.member.role', 'profile', p.id, old, to.id); return json(204, null);
    }
    // 0081: a member's extra roles — existing, not hidden, never «أدمن», never the main role, 6 at most
    if (name === 'member_roles_set') {
      const p = mock.profiles.find((x) => x.id === body.p_member); if (!p) return refuse(404, 'P0002', 'no such member'); if (p.role_id === 'admin') return refuse(400, '22023', 'invalid: admin');
      const list = [...new Set((Array.isArray(body.p_roles) ? body.p_roles : []).filter((x) => typeof x === 'string' && x.trim()))].sort();
      if (list.length > 6 || list.some((id) => id === 'admin' || id === p.role_id || !S.roles.some((x) => x.id === id && !x.hidden))) return refuse(400, '22023', 'invalid: roles');
      const old = (p.extra_roles || []).slice(); p.extra_roles = list; S.writes.push({ table: 'profiles', op: 'roles', id: p.id, roles: list }); logRow('settings.member.roles', 'profile', p.id, old, list);
      alertAdmins('اتغيّرت الأدوار الإضافية لعضو (' + list.length + ')', p.id); return json(204, null);
    }
    if (name === 'member_perms_set') {
      if (!permsOk(body.p_perms)) return refuse(400, '22023', 'invalid: perms'); const p = mock.profiles.find((x) => x.id === body.p_member); if (!p) return refuse(404, 'P0002', 'no such member'); if (p.role_id === 'admin') return refuse(400, '22023', 'invalid: admin');
      p.custom_perms = { ...body.p_perms }; S.writes.push({ table: 'profiles', op: 'perms', id: p.id, keys: Object.keys(body.p_perms).sort() }); logRow('settings.member.perms', 'profile', p.id, null, Object.keys(body.p_perms).sort()); alertAdmins('اتغيّرت الصلاحيات المخصصة لعضو (' + Object.keys(body.p_perms).length + ')', p.id); return json(204, null);
    }
    if (name === 'member_status_set') return memberStatus(body.p_member, body.p_status, body.p_reason);
  }
  function memberStatus(id, status, reason) {
    if (!['active', 'suspended'].includes(status)) return refuse(400, '22023', 'invalid: status'); if (id === u.id) return refuse(400, '22023', 'invalid: self');
    const p = mock.profiles.find((x) => x.id === id); if (!p) return refuse(404, 'P0002', 'no such member'); if (p.status === status) return json(204, null);
    if (status === 'suspended' && !String(reason || '').trim()) return refuse(400, '22023', 'invalid: reason');
    if (status === 'suspended' && p.role_id === 'admin' && !mock.profiles.some((x) => x.id !== p.id && x.role_id === 'admin' && x.status === 'active')) return refuse(400, '22023', 'last admin');
    const old = p.status; p.status = status; S.writes.push({ table: 'profiles', op: 'status', id: p.id, status }); logRow('settings.member.' + (status === 'suspended' ? 'suspend' : 'reactivate'), 'profile', p.id, old, { status, reason: String(reason || '').trim().slice(0, 300) || undefined }); return json(204, null);
  }

  // ---------------------------------------------------------------- the Edge Functions
  if (fn) {
    const action = String(body.action || ''); S.calls.push({ fn: path.split('/').pop(), action, body: { ...body, fields: body.fields ? Object.keys(body.fields) : undefined } });
    if (!admin) return json(401, { error: 'unauthorized' });
    if (path === '/functions/v1/notify') {
      if (action === 'status') return json(200, { result: 'ok', last: S.notifyRuns.at(-1) || null, email: { ready: !!S.vault.resend, from: 'alerts@ibtekr.club' }, whatsapp: { ready: false, template: 'ibtekr_alert' }, sources: SOURCES.map((s) => s.key) });
      if (action === 'tick') { const run = { at: now, items: 3, alerts: body.dry ? 2 : 2, digests: 0, external: 0, resolved: 0, by: { 'customers.late': 2, 'team.req': 1 }, sent: { email: 0, whatsapp: 0, failed: 0, not_linked: 0 } }; if (!body.dry) S.notifyRuns.push(run); return json(200, { result: body.dry ? 'dry' : 'ok', ...run, ...(body.dry ? { preview: [] } : {}) }); }
      return json(400, { error: 'unknown_action' });
    }
    const meta = () => ((mock.settings.find((x) => x.section === 'integrations') || {}).data || {}).meta || {};
    const metaPut = (name, v) => { let row = mock.settings.find((x) => x.section === 'integrations'); if (!row) { row = { section: 'integrations', data: {}, updated_at: now, updated_by: u.id }; mock.settings.push(row); } row.data = { ...row.data, meta: { ...(row.data.meta || {}), [name]: v === null ? undefined : { ...(row.data.meta || {})[name], ...v } } }; if (v === null) delete row.data.meta[name]; };
    const stored = (name) => { try { return S.vault[name] ? JSON.parse(S.vault[name]) : null; } catch { return null; } };
    const test = (name, link) => (S.probeOk ? { ok: true, account: name === 'woo' ? 'ibtekr.club · 12 طلب' : name === 'openai' ? '2 موديل متاح' : 'تمام', at: now } : { ok: false, error: 'probe_failed', at: now });
    if (action === 'status') { const links = {}; for (const n of [...new Set([...SECRET_NAMES, ...Object.keys(meta()).filter((x) => nameOk(x))])]) { const s = stored(n); if (!s && !meta()[n]) continue; links[n] = secretPublic(n, s, meta()[n]); } return json(200, { links, cards: CARDS, now }); }
    if (action === 'secret_set' || action === 'woo_set') {
      const name = action === 'woo_set' ? 'woo' : String(body.name || ''); if (!nameOk(name) || !fieldsOf(name)) return json(400, { error: 'unknown_secret' }); if (action === 'secret_set' && name === 'woo') return json(400, { error: 'invalid', field: 'name' });
      const parsed = parseSecret(name, body.fields, stored(name)); if (parsed.error) return json(400, { error: parsed.error, field: parsed.field });
      const t = test(name, parsed.link);
      if (action === 'woo_set' && body.confirm !== true) return t.ok ? json(200, { probe: t, pending: true }) : json(409, { error: 'probe_failed', probe: t });
      if (action === 'woo_set' && !t.ok) return json(409, { error: 'probe_failed', probe: t });
      S.vault[name] = JSON.stringify(parsed.link); metaPut(name, { linked_at: now, linked_by: u.id, test: t }); S.writes.push({ table: 'vault', op: 'set', name, keys: Object.keys(body.fields || {}).sort() });
      logRow('settings.integration.set', 'integration', name, null, { keys: Object.keys(body.fields || {}).sort(), test: t.ok ? 'ok' : t.error });
      return json(200, { link: secretPublic(name, parsed.link, meta()[name]), test: t });
    }
    if (action === 'secret_test') { const name = String(body.name || ''); const s = stored(name); if (!s) return json(404, { error: 'not_linked' }); const t = test(name, s); metaPut(name, { test: t }); logRow('settings.integration.test', 'integration', name, null, { test: t.ok ? 'ok' : t.error }); return json(200, { test: t }); }
    if (action === 'secret_unlink') { const name = String(body.name || ''); if (!nameOk(name)) return json(400, { error: 'unknown_secret' }); delete S.vault[name]; metaPut(name, null); S.writes.push({ table: 'vault', op: 'unlink', name }); logRow('settings.integration.unlink', 'integration', name, null, null); return json(200, { ok: true }); }
    if (action === 'member_status') { const r = memberStatus(body.member_id, body.status, body.reason); return r; }
    return json(400, { error: 'unknown_action' });
  }

  // ---------------------------------------------------------------- the papers and the buckets (the admin)
  if (docs) {
    if (!admin) return method === 'GET' ? json(200, []) : refuse(401, '42501', 'new row violates row-level security policy for table "company_docs"');
    const idEq = (url.searchParams.get('id') || '').replace(/^eq\./, ''); const single = /vnd\.pgrst\.object\+json/.test(hd.accept || '');
    const pick = (r) => { const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim()); return cols.includes('*') ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])); };
    if (method === 'GET') { const rows = S.docs.filter((d) => !idEq || d.id === idEq).map(pick); return json(200, single ? rows[0] || null : rows); }
    if (method === 'POST') { const b = body; if (!b.name || !b.type || !/^docs\/[A-Za-z0-9._-]{1,160}$/.test(String(b.path))) return refuse(400, '23514', 'violates check constraint'); S.seq += 1; const row = { ...Object.fromEntries(DOC_COLS.map((k) => [k, null])), ...b, id: 'd0000000-0000-4000-8000-' + String(900 + S.seq).padStart(12, '0'), created_by: u.id, created_at: now }; S.docs.push(row); S.writes.push({ table: 'company_docs', op: 'insert', id: row.id, type: row.type }); return json(201, single ? pick(row) : [pick(row)]); }
    if (method === 'PATCH') { const row = S.docs.find((d) => d.id === idEq); if (!row) return json(200, []); Object.assign(row, body, { updated_at: now }); S.writes.push({ table: 'company_docs', op: 'update', id: row.id, keys: Object.keys(body).sort() }); return json(200, [pick(row)]); }
    if (method === 'DELETE') { const i = S.docs.findIndex((d) => d.id === idEq); if (i >= 0) { S.writes.push({ table: 'company_docs', op: 'delete', id: S.docs[i].id }); S.docs.splice(i, 1); } return json(200, []); }
  }
  if (sto) {
    const bucket = sto[2]; const key = bucket + '/' + decodeURIComponent(sto[3]);
    if (sto[1]) { // a signed link: the admin for the papers; every active member for the logos
      if (!active || (bucket === 'company-docs' && !admin) || !S.objects.has(key)) return json(400, { statusCode: '400', error: 'not_found', message: 'Object not found' });
      S.calls.push({ sign: key }); return json(200, { signedURL: '/object/sign/' + key + '?token=st-' + (++S.seq) });
    }
    if (method === 'DELETE') { if (!admin) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'rls' }); for (const p of body.prefixes || []) S.objects.delete(bucket + '/' + p); return json(200, []); }
    if (!admin) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (S.objects.has(key) && !/true/i.test(hd['x-upsert'] || '')) return json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    const type = (hd['content-type'] || '').split(';')[0]; const allowed = bucket === 'company-docs' ? ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] : ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'];
    if (type && !allowed.includes(type) && !type.startsWith('multipart/')) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type not supported' });
    S.objects.set(key, { type }); S.writes.push({ table: 'storage', op: 'upload', key }); return json(200, { Key: key });
  }

  // ---------------------------------------------------------------- activity_log with the page's filters (RLS as 0006 / 0046)
  if (act) {
    const canAll = hasPerm(u, 'settings.view') !== 'N';
    let rows = mock.activityRows.filter((r) => ((canAll && (r.entity !== 'hr' || hasPerm(u, 'hr.view') === 'F')) || (active && r.actor === u.id)));
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('like.')) { const re = new RegExp('^' + v.slice(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); rows = rows.filter((r) => re.test(String(r[k] ?? ''))); }
      else if (v.startsWith('gte.')) rows = rows.filter((r) => Date.parse(r[k]) >= Date.parse(v.slice(4)));
      else if (v.startsWith('lte.')) rows = rows.filter((r) => Date.parse(r[k]) <= Date.parse(v.slice(4)));
      else return refuse(400, 'PGRST100', 'settings-mock: unsupported filter ' + k + '=' + v);
    }
    const [col, dir] = (url.searchParams.get('order') || 'at.desc').split('.'); rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    const m = /^(\d+)-(\d+)$/.exec(hd.range || ''); const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
    const page = m ? rows.slice(Number(m[1]), Number(m[2]) + 1) : rows.slice(off, off + lim);
    const cols = String(url.searchParams.get('select') || '*').split(',').map((x) => x.trim());
    return json(200, page.map((r) => (cols.includes('*') ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])))));
  }
  return null;
}
