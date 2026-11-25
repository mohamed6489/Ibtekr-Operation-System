// notif-engine — the pure part of the notifications' new structure (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-notifications.md,
// 0157). notify/rules.ts reads the rules, the entities each rule's element › type › state names now (or since its last run) and the
// alerts it wrote before; this module decides what to write: who receives (the rule's roles — primary or extra — whose members can
// see the element), which alerts are new (a state rule renews its alert per entity on each run; an event / a due date is written once
// per entity), and when an alert leaves the bell («تفاصيل الظهور»: a fixed time from its writing · the entity left the state + its
// hours · read + its hours). Nothing here reads a table or knows a phone number, an address or a message's text beyond its line.
import './notif-catalog.js';

// deno-lint-ignore no-explicit-any
const C = /** @type {any} */ (globalThis).IBNotifCatalog;
export const catalogue = C;
const H = 3600_000;
const RANK = { N: 0, P: 1, F: 2 };

// a member's permission: the admin F; the member's own setting first; else the best of the primary role (at the member's level —
// 0096) and the extra roles (their «employee» set — 0081)
export function permOf(member, roles, key) {
  if (!key) return 'F';
  if (!member) return 'N';
  if (member.role_id === 'admin') return 'F';
  const own = member.custom_perms && typeof member.custom_perms === 'object' ? member.custom_perms[key] : null;
  if (own === 'F' || own === 'P' || own === 'N') return own;
  const byId = new Map((roles || []).map((r) => [r.id, r]));
  const setOf = (role, level) => {
    if (!role) return null;
    const lv = level && level !== 'employee' && role.level_perms && typeof role.level_perms[level] === 'object' ? role.level_perms[level] : null;
    return lv || (role.permissions && typeof role.permissions === 'object' ? role.permissions : null);
  };
  let best = 'N';
  const take = (set) => { const v = set ? set[key] : null; if ((v === 'F' || v === 'P') && RANK[v] > RANK[best]) best = v; };
  take(setOf(byId.get(member.role_id), member.level));
  for (const r of Array.isArray(member.extra_roles) ? member.extra_roles : []) take(setOf(byId.get(r), 'employee'));
  return best;
}
export const rolesOf = (member) => [member.role_id].concat(Array.isArray(member.extra_roles) ? member.extra_roles : []).filter(Boolean);

// the members a rule writes to: active, in one of its roles, and the element's page not closed to them
export function recipients(rule, members, roles) {
  const el = C.el(rule.element); const perm = el ? el.perm : null;
  const want = new Set(Array.isArray(rule.roles) ? rule.roles : []);
  return (members || []).filter((m) => m && m.status === 'active' && rolesOf(m).some((r) => want.has(r)) && permOf(m, roles, perm) !== 'N');
}

// the rows to write for a rule that runs now. ents: [{ id, name, ref, state, line, entity, users?, perm? }] — `users` narrows the
// receivers to those ids (a request's team, a conversation's assignee …), `perm` [key, 'F'|'P'] asks one more permission of them.
// existing: the rule's alerts [{ id, entity_id, user_id, hide_at }]. A «state» rule renews its alert per (entity, member) — the old
// one leaves the bell (`retire` — hidden now, never deleted) and a new one comes with the green dot: the renewal is the repeat; an
// «event» / a «due» one never writes the same (entity, member) twice. The admin sees every entity of his rules (`users` narrows the rest).
export function writePlan({ rule, ents, existing, members, roles, now, lineFor }) {
  const kind = C.kindOf(rule); const to = recipients(rule, members, roles); const elPerm = (C.el(rule.element) || {}).perm || null;
  const had = new Map(); for (const a of existing || []) { const k = a.entity_id + '|' + a.user_id; const l = had.get(k) || []; l.push(a); had.set(k, l); }
  const inserts = []; const retire = [];
  const hide = rule.show === 'fixed' ? new Date(Date.parse(now) + Number(rule.hours) * H).toISOString() : null;
  for (const e of ents || []) {
    for (const m of to) {
      // a member with the element's page partly (P — his own / his team's only) gets an entity only when it names him (`users`:
      // the member it concerns and his manager, the request's team, the conversation's assignee …); the page whole (F) gets all
      // an element with no page of its own (the daily report, the assistants) is «whole» for the admin only — its entities name their
      // members (`users`), or say nothing of anyone's records (the daily report's line is per member)
      const whole = elPerm ? permOf(m, roles, elPerm) === 'F' : (m.role_id === 'admin' || !Array.isArray(e.users));
      // `only`: the named members (and the admin) and no one else — a request reaches the team it is for and its opener, not every
      // member who may read all the requests
      if (e.only ? !(m.role_id === 'admin' || (e.users || []).includes(m.id)) : Array.isArray(e.users) ? !(whole || e.users.includes(m.id)) : !whole) continue;
      if (e.perm && RANK[permOf(m, roles, e.perm[0])] < RANK[e.perm[1] || 'P']) continue;
      const k = e.id + '|' + m.id; const prev = had.get(k);
      if (prev && kind !== 'state') continue;
      if (prev) retire.push(...prev.filter((a) => !a.hide_at).map((a) => a.id));
      const line = typeof lineFor === 'function' ? lineFor(e, m) : e.line;
      if (line === null) continue; // nothing for this member (a daily summary with nothing he can see)
      const msg = C.render(rule, { ...e, line });
      inserts.push({ at: now, kind: 'rule:' + rule.element + '.' + rule.type, title: msg.title, body: msg.body || null, user_id: m.id,
        entity: e.entity || null, entity_id: e.id, rule_id: rule.id, section_id: rule.section_id, hide_at: hide, meta: metaOf(rule, e) });
    }
  }
  return { inserts, retire };
}

// «تقرير» (Safwat 24 Nov — the bell's redesign decision 8, 0162): a rule with several elements in report mode writes one alert per member
// and run, holding everything each of its parts would have written to him (the same receivers and permissions as «فردي» — writePlan
// per part with nothing «existing»), as `meta.items` [{ p: the part's «العنصر › الوضع», t: the line's title, b: its body, e: its page
// link, g: its owner's name }] (REPORT_MAX at most — `n` counts them all). parts: [{ rule: the part (partsOf), ents, lineFor }].
export const REPORT_MAX = 300;
export function reportPlan({ rule, parts, members, roles, now, lists }) {
  const by = new Map(); const per = new Map();
  for (const x of parts || []) {
    const label = C.partLabel(x.rule, lists || {});
    const plan = writePlan({ rule: x.rule, ents: x.ents, existing: [], members, roles, now, lineFor: x.lineFor });
    for (const a of plan.inserts) {
      const l = by.get(a.user_id) || []; l.push({ p: label, t: a.title, b: a.body || '', e: a.entity || null, g: a.meta && a.meta.gname ? a.meta.gname : null }); by.set(a.user_id, l);
      const c = per.get(a.user_id) || new Map(); c.set(label, (c.get(label) || 0) + 1); per.set(a.user_id, c);
    }
  }
  const hide = rule.show === 'fixed' ? new Date(Date.parse(now) + Number(rule.hours) * H).toISOString() : null;
  const name = String(rule.name || '').slice(0, 100);
  return [...by.entries()].map(([uid, items]) => ({ at: now, kind: 'rule:report', title: name + ' — ' + items.length, user_id: uid,
    body: [...per.get(uid).entries()].map(([k, n]) => n + ' ' + k).join(' · ').slice(0, 300), entity: null, entity_id: 'report',
    rule_id: rule.id, section_id: rule.section_id, hide_at: hide, meta: { lv: C.levelOfAll(rule), report: true, n: items.length, items: items.slice(0, REPORT_MAX) } }));
}
// a «فردي» rule's extra part keeps its alerts apart from the rule's own: its entity ids carry «x<part>|» (part 0 — the rule's own
// element — as before)
export const partKey = (part, id) => (part ? 'x' + part + '|' + id : String(id));
export const partOfKey = (id) => { const m = /^x(\d)\|/.exec(String(id)); return m ? Number(m[1]) : 0; };

// the bell's redesign (Safwat 24 Nov — docs/superpowers/plans/2026-11-24-bell-redesign.md decisions 1–3): what the bell needs to draw
// and group an alert — its level, who it is about (`group`: { g: vendor | member | agent | customer, id, name }) and the counts the
// entity carries (orders `n`, pieces `pcs`, the delay `st`). Names and numbers only — never a phone or a message's text.
const G_KINDS = ['vendor', 'member', 'agent', 'customer'];
export function metaOf(rule, e) {
  const m = { lv: C.levelOf(rule) };
  const g = e && e.group;
  if (g && G_KINDS.includes(g.g) && g.id != null) { m.g = g.g; m.gid = String(g.id).slice(0, 64); m.gname = String(g.name || '').slice(0, 80); }
  if (e && Number.isFinite(Number(e.n)) && e.n != null) m.n = Number(e.n);
  if (e && Number.isFinite(Number(e.pcs)) && e.pcs != null) m.pcs = Number(e.pcs);
  if (e && (e.st === 'late' || e.st === 'risk')) m.st = e.st;
  // an order's facts (customer service — Safwat 25 Nov): its status, delay, sub-orders and late makers' names — never a phone
  const o = e && e.o;
  if (o && typeof o === 'object') {
    const nm = (L) => (Array.isArray(L) ? L.slice(0, 5).map((x) => String(x || '').slice(0, 40)).filter(Boolean) : []);
    m.ost = String(o.status || '').slice(0, 40); m.dl = o.dl === 'late' || o.dl === 'risk' ? o.dl : 'ok';
    if (Number.isFinite(Number(o.subs))) m.subs = Number(o.subs);
    m.lm = nm(o.late); m.rm = nm(o.risk);
  }
  return m;
}

// when the rule's alerts leave the bell: alerts [{ id, entity_id, user_id, at, hide_at }] still showing (hide_at null); inState =
// the entity ids in the state now (a «state» rule — null when not read this tick: nothing hides by it); reads: alert id → read_at.
// «حتى تغيير الوضع» on an event / a due date = «حتى التحوّل لمقروء». An inactive rule hides all its alerts now.
export function hidePlan({ rule, alerts, inState, reads, now }) {
  const out = []; const nowMs = Date.parse(now); const kind = C.kindOf(rule);
  const mode = rule.show === 'until_state' && kind !== 'state' ? 'until_read' : rule.show;
  const at = (ms) => new Date(ms).toISOString();
  for (const a of alerts || []) {
    if (a.hide_at) continue;
    if (rule.active === false) { out.push({ id: a.id, hide_at: at(nowMs) }); continue; }
    if (mode === 'until_state' && inState && !inState.has(String(a.entity_id))) out.push({ id: a.id, hide_at: at(nowMs + Number(rule.hours) * H) });
    else if (mode === 'until_read') { const r = reads && reads.get(String(a.id)); if (r) out.push({ id: a.id, hide_at: at(Date.parse(r) + Number(rule.hours) * H) }); }
    else if (mode === 'fixed') out.push({ id: a.id, hide_at: at(Date.parse(a.at) + Number(rule.hours) * H) });
    // an «info» alert never outstays INFO_MAX_H, read or not (the bell's redesign decision 1)
    if (C.levelOf(rule) === 'info' && !out.some((x) => x.id === a.id)) { const cap = Date.parse(a.at) + C.INFO_MAX_H * H; if (cap <= nowMs) out.push({ id: a.id, hide_at: at(cap) }); }
  }
  return out;
}

// Cairo's day and minute of the day from { day, time: 'HH:MM' }
export const nowOf = (cairo) => ({ day: cairo.day, min: Number(String(cairo.time).slice(0, 2)) * 60 + Number(String(cairo.time).slice(3, 5)) });
// does the rule run on this tick (its time, its repeat — catalogue.runs) and is it on
export const runsNow = (rule, cairo) => rule && rule.active !== false && C.runs(rule, nowOf(cairo), rule.last_run || null);

// the outbound channels (Safwat 24 Nov: «الايميل ممكن تشغلوا و الواتساب … يبقا واقف علي تشغيل ال API»): a rule that names e-mail or
// WhatsApp sends — besides its bell rows — one message per member and rule this tick (its new rows in it), and only while the admin's
// switch of that channel is on (settings «notif».channels — e-mail on, WhatsApp off until its API is turned on). → [{ ch, member, rule,
// title, body, count }] (at most OUT_MAX a tick; a member is named by id — the sender reads the address).
export const OUT_MAX = 80; const OUT_LINES = 8;
export function outboundPlan({ rules, inserts, gates }) {
  const rmap = new Map((rules || []).map((r) => [String(r.id), r])); const by = new Map();
  for (const a of inserts || []) {
    const r = rmap.get(String(a.rule_id)); if (!r || r.active === false || !a.user_id) continue;
    const chs = Array.isArray(r.channels) ? r.channels : [];
    for (const ch of ['email', 'whatsapp']) {
      if (!chs.includes(ch) || !(gates && gates[ch] === true)) continue;
      const k = ch + '|' + a.user_id + '|' + r.id;
      const g = by.get(k) || { ch, member: String(a.user_id), rule: String(r.id), name: String(r.name || ''), items: [] };
      g.items.push({ title: String(a.title || ''), body: a.body ? String(a.body) : '' }); by.set(k, g);
    }
  }
  return [...by.values()].slice(0, OUT_MAX).map((g) => {
    const one = g.items.length === 1;
    const title = one ? g.items[0].title : g.name + ' (' + g.items.length + ')';
    const lines = one ? (g.items[0].body ? [g.items[0].body] : []) : g.items.slice(0, OUT_LINES).map((x) => x.title).concat(g.items.length > OUT_LINES ? ['وكمان ' + (g.items.length - OUT_LINES)] : []);
    return { ch: g.ch, member: g.member, rule: g.rule, title: title.slice(0, 150), body: lines.join(' · ').slice(0, 900), count: g.items.length };
  });
}
