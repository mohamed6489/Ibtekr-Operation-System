// Decision 10 in the agents-brain plan (the owner 17 Nov — «كل فريق قدامه مساعد … يساعده في تاسكاته و ينظمها»): each team's assistant
// orders the team's open requests, says who carries what, and writes the bell a daily summary and a late alert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_HOUR, TEAM_RULE, teamBlock, teamNotes, teamSummary } from '../../supabase/functions/_shared/agent-team.js';

const T = (o) => ({ id: 1, title: 'x', priority: 'normal', status: 'open', follow_up: null, created_at: '2026-11-10T08:00:00Z', last_update: '2026-11-17T08:00:00Z', assignee_member: null, assignee_member_name: null, assignee_role: 'العمليات والشحن', ...o });
const TODAY = '2026-11-18';
const ROWS = [
  T({ id: 1, title: 'تغليف', priority: 'low' }),
  T({ id: 2, title: 'شحنة متأخرة', priority: 'normal', follow_up: '2026-11-15', assignee_member: 'u1', assignee_member_name: 'علي' }),
  T({ id: 3, title: 'عميل غضبان', priority: 'urgent' }),
  T({ id: 4, title: 'مقفول', status: 'resolved' }),
  T({ id: 5, title: 'واقف', priority: 'high', last_update: '2026-11-10T08:00:00Z', assignee_member: 'u2', assignee_member_name: 'منى' }),
];

test('team summary: open only, ordered by priority then late, the counts, and each member\'s load lightest first', () => {
  const s = teamSummary(ROWS, [{ id: 'u1', name: 'علي' }, { id: 'u2', name: 'منى' }, { id: 'u3', name: 'سارة' }], TODAY);
  assert.equal(s.open, 4); assert.equal(s.urgent, 2); assert.equal(s.late, 1); assert.equal(s.stale, 1); assert.equal(s.unassigned, 2);
  assert.deepEqual(s.top.map((t) => t.code), ['TKT-0003', 'TKT-0005', 'TKT-0002', 'TKT-0001']);
  assert.equal(s.top[2].late, true); assert.equal(s.top[2].who, 'علي');
  assert.deepEqual(s.load.map((m) => [m.name, m.open]), [['سارة', 0], ['علي', 1], ['منى', 1]]);
});

test('team block: data for the chat with the codes and the members; the rule says it never assigns', () => {
  const b = teamBlock('العمليات والشحن', teamSummary(ROWS, [{ id: 'u3', name: 'سارة' }], TODAY));
  assert.match(b, /^<team_requests>[\s\S]*TKT-0003 \| عميل غضبان \| عاجل[\s\S]*سارة 0[\s\S]*<\/team_requests>$/);
  assert.match(b, /4 open request\(s\)/);
  assert.equal(teamBlock('', null), '');
  assert.match(TEAM_RULE, /never assign/);
  assert.doesNotMatch(teamBlock('<x>', teamSummary([T({ title: '<script>' })], [], TODAY)), /<script>|«<x>»/);
});

test('team notes: from the report hour on, a daily summary and a late alert per team with open work; one row per day (ref)', () => {
  const agents = [{ id: 'stock', role: 'العمليات والشحن' }, { id: 'hr', role: 'الموارد البشرية' }, { id: 'old', role: 'العمليات والشحن', archived_at: '2026-11-01' }, { id: 'x', role: null }];
  assert.deepEqual(teamNotes(agents, ROWS, {}, { day: TODAY, time: String(REPORT_HOUR - 1).padStart(2, '0') + ':59' }), []);
  const n = teamNotes(agents, ROWS, { 'العمليات والشحن': [] }, { day: TODAY, time: '09:15' });
  assert.deepEqual(n.map((x) => [x.agent, x.kind, x.ref, x.link]), [['stock', 'report', 'team:' + TODAY, 'tickets'], ['stock', 'alert', 'late:' + TODAY, 'tickets']]);
  assert.match(n[0].title, /4 طلب مفتوح/); assert.match(n[0].body, /TKT-0003/);
  assert.match(n[1].body, /TKT-0003 — عميل غضبان · عاجل ومحدش ماسكه/); assert.match(n[1].body, /TKT-0002 — شحنة متأخرة · عدّى ميعاد المتابعة 2026-11-15/);
  // nothing late or urgent-unassigned → the summary only
  assert.deepEqual(teamNotes(agents, [T({ id: 9 })], {}, { day: TODAY, time: '10:00' }).map((x) => x.kind), ['report']);
});
