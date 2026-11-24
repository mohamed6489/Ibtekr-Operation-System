// The notifications' new structure (Safwat 24 Nov — 0157), emulated for the stand-in (not a test file itself): the tables notif_sections /
// notif_rules (every active member reads; the admin writes through notif_section_save / _delete / _order and notif_rule_save / _delete),
// and the alerts with their rule / sub-section / hide_at (the bell reads the ones still showing). On only when the install asks for it
// (opts.notifTree), so every other spec keeps the old bell and the old settings tabs.
export function notifState(opts) {
  if (!opts.notifTree) return null;
  const t = opts.notifTree === true ? {} : opts.notifTree;
  return { sections: (t.sections || []).map((x) => ({ icon: null, ...x })), rules: (t.rules || []).map((x) => ({ sub: null, param: null, days: [], channels: ['bell'], template: null, active: true, sort: 0, ...x })), alerts: t.alerts || [], seq: 1 };
}
const COLS = ['id', 'at', 'kind', 'title', 'body', 'role_id', 'user_id', 'entity', 'entity_id', 'read_at', 'rule_id', 'section_id', 'hide_at', 'meta']; // 0161 meta (the bell's redesign)
export function notifRoute(c) {
  const { method, path, url, u, isAdmin, json, mock } = c; const N = mock.notif;
  // without the opt-in the tables are missing, as on a project before 0157 (the old bell and settings tabs then)
  if (!N) return /^\/rest\/v1\/(notif_sections|notif_rules)$/.test(path) || /^\/rest\/v1\/rpc\/notif_/.test(path) ? json(404, { code: 'PGRST205', details: null, hint: null, message: 'Could not find the table in the schema cache' }) : null;
  const rpc = /^\/rest\/v1\/rpc\/(notif_section_save|notif_section_delete|notif_section_order|notif_rule_save|notif_rule_delete)$/.exec(path);
  const tbl = method === 'GET' && /^\/rest\/v1\/(notif_sections|notif_rules|alerts)$/.exec(path);
  if (!rpc && !tbl) return null;
  const refuse = (status, code, message) => json(status, { code, details: null, hint: null, message });
  if (!u || u.status !== 'active') return refuse(401, '42501', 'permission denied');
  if (tbl) {
    const t = tbl[1]; const sel = (url.searchParams.get('select') || '*').split(',').map((s) => s.trim());
    const pick = (r) => (sel[0] === '*' ? r : Object.fromEntries(sel.map((k) => [k, r[k] === undefined ? null : r[k]])));
    const lim = Number(url.searchParams.get('limit')) || Infinity;
    if (t === 'alerts') {
      if (sel.some((k) => k !== '*' && !COLS.includes(k))) return refuse(400, '42703', 'column does not exist');
      const or = url.searchParams.get('or'); const at = or ? /hide_at\.gt\.([^,)]+)/.exec(or) : null; const now = at ? at[1] : null;
      const rows = mock.alerts.filter((a) => (a.user_id === u.id || a.role_id === u.role_id) && (!now || !a.hide_at || a.hide_at > now)).sort((a, b) => (a.at < b.at ? 1 : -1));
      return json(200, rows.slice(0, lim).map(pick));
    }
    const rows = (t === 'notif_sections' ? N.sections : N.rules).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    return json(200, rows.slice(0, lim).map(pick));
  }
  if (!isAdmin(u)) return refuse(403, '42501', 'forbidden');
  const name = rpc[1]; const b = c.body() || {}; const p = b.p || {};
  const id = () => '00000000-0000-4000-8000-' + String(900000000000 + N.seq++);
  if (name === 'notif_section_save') {
    const nm = String(p.name || '').trim(); if (!nm || nm.length > 40 || /[<>]/.test(nm)) return refuse(400, '22023', 'invalid: name');
    if (p.id) { const s = N.sections.find((x) => x.id === p.id); if (!s) return refuse(404, 'P0002', 'not found'); s.name = nm; return json(200, s.id); }
    const sib = N.sections.filter((x) => (x.parent_id || null) === (p.parent_id || null)); const s = { id: id(), parent_id: p.parent_id || null, name: nm, icon: null, sort: sib.length };
    N.sections.push(s); return json(200, s.id);
  }
  if (name === 'notif_section_delete') { const gone = new Set([b.p_id].concat(N.sections.filter((x) => x.parent_id === b.p_id).map((x) => x.id))); N.sections = N.sections.filter((x) => !gone.has(x.id)); N.rules = N.rules.filter((r) => !gone.has(r.section_id)); return json(200, null); }
  if (name === 'notif_section_order') { (b.p_ids || []).forEach((x, i) => { const s = N.sections.find((y) => y.id === x); if (s) s.sort = i; }); return json(200, null); }
  if (name === 'notif_rule_save') {
    if (!N.sections.some((s) => s.id === p.section_id && s.parent_id)) return refuse(400, '22023', 'invalid: section');
    if (!p.name || !Array.isArray(p.roles) || !p.roles.length) return refuse(400, '22023', 'invalid: rule');
    if (p.id) { const r = N.rules.find((x) => x.id === p.id); if (!r) return refuse(404, 'P0002', 'not found'); Object.assign(r, p); return json(200, r.id); }
    const r = { ...p, id: id(), sort: N.rules.filter((x) => x.section_id === p.section_id).length }; N.rules.push(r); return json(200, r.id);
  }
  if (name === 'notif_rule_delete') { N.rules = N.rules.filter((r) => r.id !== b.p_id); return json(200, null); }
  return null;
}
