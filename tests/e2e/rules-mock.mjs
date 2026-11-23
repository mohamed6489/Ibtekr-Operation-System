// The assistants' own rules, emulated for the stand-in (not a test file itself) — what the scheduled check does on the server (0150,
// supabase/functions/notify): it counts the numbers from the tables with the server's own rule (_shared/agent-facts.js), runs the
// rules of the row «ai» (_shared/agent-rules.js) and writes or clears the notes of «rule:…» in ai_agent_notes (runRules). On only
// when the install asks for it (opts.agentRules), so the notes of every other test stay as seeded. rulesStatus is what notify's
// action `rules` gives the admin's card; agentFacts is ai_agent_facts() — a member's assistants, each with the numbers of the pages
// that member reads in full.
import { countFacts, singleOf as storeSingle } from '../../supabase/functions/_shared/agent-facts.js';
import { evaluate, factsOf, statusOf } from '../../supabase/functions/_shared/agent-rules.js';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const cairoDay = (d) => fmt.format(d);
const dataOf = (mock, section) => ((mock.settings || []).find((x) => x.section === section) || {}).data || {};
const liveAgents = (mock) => ((mock.mkt && mock.mkt.aiAgents) || []).filter((a) => !a.archived_at);
const singleOf = (mock) => storeSingle(dataOf(mock, 'store'));

/** Every number counted from the stand-in's rows now (null = its table is not there). */
export function ruleFacts(mock, at = new Date()) {
  const H = mock.mkt || {}; const acc = mock.acc; const hr = mock.hr; const design = liveAgents(mock).find((a) => a.id === 'designer');
  const bank = new Set((mock.vendorBank || []).map((b) => b.vendor_id));
  return countFacts({
    delay: (dataOf(mock, 'makers') || {}).delay,
    orders: (mock.orders || []).filter((o) => !o.deleted_at), items: mock.orderItems || [], vendors: mock.vendors || [], productLead: {},
    bankless: (mock.vendors || []).filter((v) => v.status === 'active' && !v.archived_at && !bank.has(v.id)).length,
    lots: mock.inv && mock.inv.inv_lots ? mock.inv.inv_lots : null, tickets: mock.tickets || [], designRole: design ? design.role || '' : '',
    convs: mock.cs && mock.cs.conversations ? mock.cs.conversations : null,
    withdrawals: acc && acc.dokan_withdrawals ? acc.dokan_withdrawals : null, subs: acc && acc.acc_expenses ? acc.acc_expenses : [],
    hrRequests: hr && hr.requests ? hr.requests : null, overtime: hr && hr.overtime ? hr.overtime : null,
    suggestions: H.suggestions || [], adStats: H.adStats || [], posts: H.posts || [], checks: H.siteChecks || [],
  }, cairoDay(at), at.getTime());
}

/** The check itself: the notes of the rules that hold are written (one a rule, the same row while it holds — unread again
 *  when its number moved), and the note of a rule that stopped holding, was switched off or deleted goes. */
export function runRules(mock, at = new Date()) {
  const H = mock.mkt; if (!H || !H.rulesOn || !Array.isArray(H.agentNotes)) return null;
  const { notes, keep } = evaluate(dataOf(mock, 'ai'), liveAgents(mock), ruleFacts(mock, at), { single: singleOf(mock) });
  const want = new Map(notes.map((n) => [n.ref, n])); const now = at.toISOString();
  H.agentNotes = H.agentNotes.filter((n) => { if (!n.ref || !String(n.ref).startsWith('rule:') || want.has(n.ref) || keep.includes(n.ref)) return true;
    H.agentNoteReads = H.agentNoteReads.filter((r) => r.note_id !== n.id); return false; });
  for (const n of notes) { const old = H.agentNotes.find((x) => x.ref === n.ref);
    if (!old) { H.agentNotes.push({ id: H.agentNotes.reduce((m, x) => Math.max(m, x.id), 0) + 1, agent: n.agent, kind: n.kind, title: n.title, body: n.body, link: null, ref: n.ref, created_at: now, val: n.value, perm: n.perm || null }); continue; }
    if (old.val !== n.value) { old.created_at = now; H.agentNoteReads = H.agentNoteReads.filter((r) => r.note_id !== old.id); }
    Object.assign(old, { kind: n.kind, title: n.title, body: n.body, val: n.value, perm: n.perm || null }); }
  return notes.length;
}

/** notify `rules` (the admin): every assistant's rules in force with the number now and whether each holds, and the metrics it may watch. */
export function rulesStatus(mock, at = new Date()) {
  return statusOf(dataOf(mock, 'ai'), (mock.mkt && mock.mkt.aiAgents) || [], ruleFacts(mock, at), { single: singleOf(mock) }, at.toISOString());
}

/** ai_agent_facts() (a member): for each assistant the member sees (`can`) — the numbers it watches now of the pages the member reads
 *  in full (`full(perm)`), the words each is asked about with, what to do about it, and the rule on it that holds. */
export function agentFacts(mock, can, full, at = new Date()) {
  const all = factsOf(dataOf(mock, 'ai'), liveAgents(mock), ruleFacts(mock, at), { single: singleOf(mock) }, at.toISOString()); const agents = {};
  for (const [id, a] of Object.entries(all.agents)) { if (!can(id)) continue;
    agents[id] = { name: a.name, metrics: a.metrics.filter((m) => m.perm && full(m.perm)).map(({ perm: _p, ...m }) => m) }; }
  return { at: all.at, agents };
}
