// The assistants' own rules (mock/shared/agent-rules.js): a metric against a limit → a note in the bell, never an action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, cleanRule, evaluate, holds, metricsFor, rulesOf, say, sentence, shippedRules } from '../../supabase/functions/_shared/agent-rules.js';
import { ruleFacts, runRules, rulesStatus } from '../e2e/rules-mock.mjs';

const AGENTS = ['manager', 'stock', 'cs', 'makers', 'accountant', 'hr', 'buyer', 'designer', 'dev'];

test('every built-in assistant ships rules on its own metrics, each a whole limit and both languages', () => {
  for (const id of AGENTS) { const r = shippedRules(id); assert.ok(r.length >= 2, id + ' ships at least two rules');
    for (const x of r) { assert.equal(METRICS[x.metric].agent, id); assert.equal(x.on, true); assert.deepEqual(cleanRule(x, metricsFor({ id })), x); } }
  for (const [k, m] of Object.entries(METRICS)) { assert.ok(m.ar && m.en && m.doAr && m.doEn, k + ' is named in both languages'); assert.ok(!/[؀-ۿ]/.test(m.en + m.doEn), k + ' — no Arabic in the English'); }
});

test('a rule holds on its side of the limit only, and a number that was not read never holds', () => {
  assert.equal(holds({ op: 'gte', value: 3 }, 3), true); assert.equal(holds({ op: 'gte', value: 3 }, 2), false);
  assert.equal(holds({ op: 'lte', value: 50 }, 41), true); assert.equal(holds({ op: 'lte', value: 50 }, 51), false);
  assert.equal(holds({ op: 'gte', value: 0 }, null), false); assert.equal(holds({ op: 'lte', value: 9 }, undefined), false);
});

test('the admin’s list replaces the shipped one: cleaned, another assistant’s metric and a broken limit are dropped', () => {
  const row = { agents: { stock: { rules: [{ id: 'a1', metric: 'orders_late', op: 'gte', value: 2, kind: 'problem', on: false }, { id: 'a2', metric: 'cs_waiting', op: 'gte', value: 1 },
    { id: 'a3', metric: 'orders_risk', value: 1.5 }, { id: 'a1', metric: 'orders_risk', value: 4 }, { id: 'BAD ID', metric: 'orders_risk', value: 4 }, { id: 'a4', metric: 'returns_waiting', op: 'nope', value: '5', kind: 'x' }] } } };
  const r = rulesOf(row, { id: 'stock' }); assert.equal(r.own, true);
  assert.deepEqual(r.rules, [{ id: 'a1', metric: 'orders_late', op: 'gte', value: 2, kind: 'problem', on: false }, { id: 'a4', metric: 'returns_waiting', op: 'gte', value: 5, kind: 'alert', on: true }]);
  assert.equal(rulesOf({}, { id: 'stock' }).own, false); assert.deepEqual(rulesOf({ agents: { stock: { rules: [] } } }, { id: 'stock' }), { own: true, rules: [] });
  // an assistant the admin added watches the metrics of the data it reads, and ships none
  assert.deepEqual(metricsFor({ id: 'x9', sees: ['inventory'] }), ['returns_waiting']); assert.deepEqual(shippedRules('x9'), []);
});

test('evaluate: one note a rule that holds — its number in the title, the rule and what to do in the body; off and unread rules write none', () => {
  const row = { agents: { dev: { rules: [{ id: 'speed', metric: 'site_speed', op: 'lte', value: 50, kind: 'problem', on: true }, { id: 'upd', metric: 'site_updates', op: 'gte', value: 1, kind: 'alert', on: false }] } } };
  const out = evaluate(row, [{ id: 'dev' }, { id: 'cs' }, { id: 'hr' }], { site_speed: 41, site_updates: 4, cs_waiting: 1, cs_waiting_minutes: 75, hr_requests_pending: null, overtime_pending: 0 });
  assert.deepEqual(out.notes.map((n) => n.ref), ['rule:dev:speed', 'rule:cs:cs_waiting_minutes']);
  assert.equal(out.notes[0].title, 'درجة سرعة الموقع على الموبايل: 41 من 100'); assert.equal(out.notes[0].kind, 'problem'); assert.equal(out.notes[0].value, 41);
  assert.match(out.notes[0].body, /^القاعدة: درجة سرعة الموقع على الموبايل — 50 من 100 أو أقل\.\nافتح فحص السرعة/);
  assert.deepEqual(out.keep, ['rule:hr:hr_requests_pending']); // its table was not read: the note it has stays
  const en = evaluate(row, [{ id: 'dev' }], { site_speed: 41 }, { en: true }); assert.equal(en.notes[0].title, 'The site’s speed score on mobile: 41 of 100'); assert.ok(!/[؀-ۿ]/.test(en.notes[0].title + en.notes[0].body));
  assert.equal(say(35000, 'egp'), '35,000 ج.م'); assert.equal(sentence({ metric: 'cs_waiting_minutes', op: 'gte', value: 60 }, true), 'The oldest conversation waiting for our reply — 60 min or more');
});

// ---- the stand-in's check: the numbers from the rows, the notes written and cleared
const at = new Date('2026-11-22T12:00:00Z'); const V = (n) => 'v' + n;
function install() {
  return { settings: [], vendors: [{ id: V(1), status: 'active', lead_days: 7 }, { id: V(2), status: 'active', lead_days: 7 }, { id: V(3), status: 'inactive', lead_days: 7 }], vendorBank: [{ vendor_id: V(2) }],
    orders: [{ id: 1, status: 'جاري التنفيذ', confirm: 'غير مؤكد', confirm_at: null, placed_at: '2026-11-16T10:00:00Z' }, { id: 2, status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', confirm_at: '2026-11-05', placed_at: '2026-11-04T10:00:00Z' },
      { id: 3, status: 'جاهز للشحن', confirm: 'مؤكد بدون عربون', confirm_at: '2026-11-17', placed_at: '2026-11-16T10:00:00Z' }, { id: 4, status: 'مكتمل', confirm: 'غير مؤكد', confirm_at: null, placed_at: '2026-10-01T10:00:00Z' },
      { id: 5, status: 'قيد الانتظار', confirm: 'غير مؤكد', confirm_at: null, placed_at: '2026-11-22T10:00:00Z', deleted_at: '2026-11-22T11:00:00Z' }],
    orderItems: [{ id: 1, order_id: 2, vendor_id: V(1), removed: false, status: '' }, { id: 2, order_id: 3, vendor_id: V(2), removed: false, status: '' }, { id: 3, order_id: 2, vendor_id: V(2), removed: true, status: '' }],
    tickets: [{ status: 'open', priority: 'urgent', follow_up: '2026-11-21', assignee_role: 'التصميم' }, { status: 'resolved', priority: 'urgent', follow_up: '2026-11-01' }, { status: 'waiting', priority: 'normal', follow_up: '2026-11-30' }],
    cs: { conversations: [{ seg: 'customers', status: 'مستنية ردنا', waiting_since: '2026-11-22T10:30:00Z' }, { seg: 'comments', status: 'مستنية ردنا', waiting_since: '2026-11-22T08:00:00Z' }, { seg: 'customers', status: 'اتحلت', waiting_since: null }] },
    inv: { inv_lots: [{ reason: 'مرتجع', status: 'بانتظار الفحص', closed_at: null }, { reason: 'مرتجع', status: 'بانتظار الفحص', closed_at: '2026-11-20' }, { reason: 'متاح للبيع', status: 'متاح', closed_at: null }] },
    acc: { dokan_withdrawals: [{ status: 'pending' }, { status: 'approved' }], acc_expenses: [{ sub_ends: '2026-12-12', voided_at: null }, { sub_ends: '2026-11-25', voided_at: '2026-11-20' }, { sub_ends: '2026-11-01', voided_at: null }] },
    hr: { requests: [], overtime: [{ status: 'مستني' }, { status: 'موافق' }] },
    mkt: { rulesOn: true, aiAgents: [{ id: 'manager' }, { id: 'stock' }, { id: 'cs' }, { id: 'makers' }, { id: 'accountant' }, { id: 'hr' }, { id: 'buyer' }, { id: 'designer', role: 'التصميم' }, { id: 'dev' }, { id: 'old', archived_at: '2026-11-01' }],
      agentNotes: [{ id: 1, agent: 'dev', kind: 'update', title: 'ملاحظة قديمة', body: '', link: null, ref: null, created_at: '2026-11-20T00:00:00Z' }], agentNoteReads: [],
      suggestions: [{ status: 'pending' }, { status: 'approved' }], adStats: [{ level: 'campaign', day: '2026-11-20', spend: 400 }, { level: 'ad', day: '2026-11-20', spend: 400 }, { level: 'campaign', day: '2026-11-10', spend: 900 }],
      posts: [{ status: 'فشل' }, { status: 'اتنشر' }], siteChecks: [{ kind: 'pagespeed', data: { score: 41 } }, { kind: 'wp_updates', data: { updates: 4 } }] } };
}

test('the numbers are counted from the rows: open, live and of today only', () => {
  const f = ruleFacts(install(), at);
  assert.deepEqual(f, { orders_unconfirmed: 1, orders_late: 1, orders_risk: 1, makers_late: 1, makers_no_bank: 1, returns_waiting: 1, tickets_urgent: 1, tickets_overdue: 1, design_requests: 1,
    cs_waiting: 1, cs_waiting_minutes: 90, withdraw_pending: 1, sub_days_left: 20, hr_requests_pending: 0, overtime_pending: 1, ads_suggestions: 1, ads_spend_week: 400, posts_failed: 1, site_speed: 41, site_updates: 4 });
  assert.deepEqual(Object.keys(f).sort(), Object.keys(METRICS).sort()); // every metric is counted
});

test('the check writes one note a rule that holds, keeps the row while it holds, and clears it once it does not', () => {
  const mock = install(); const n = runRules(mock, at); const refs = () => mock.mkt.agentNotes.map((x) => x.ref);
  assert.equal(n, mock.mkt.agentNotes.length - 1); assert.ok(refs().includes('rule:stock:orders_late')); assert.ok(refs().includes(null), 'a note that is not a rule’s stays');
  assert.ok(!refs().includes('rule:accountant:sub_days_left'), '20 days left is not within 7'); assert.ok(!refs().includes('rule:cs:cs_waiting'), 'one waiting is under three');
  const late = mock.mkt.agentNotes.find((x) => x.ref === 'rule:stock:orders_late'); mock.mkt.agentNoteReads.push({ note_id: late.id, member_id: 'm1' });
  runRules(mock, new Date(at.getTime() + 60000)); assert.equal(mock.mkt.agentNotes.find((x) => x.ref === 'rule:stock:orders_late').id, late.id); assert.equal(mock.mkt.agentNoteReads.length, 1, 'the same number: still read');
  mock.orders.push({ id: 9, status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', confirm_at: '2026-11-01', placed_at: '2026-11-01T10:00:00Z' }); runRules(mock, at);
  assert.equal(mock.mkt.agentNotes.find((x) => x.ref === 'rule:stock:orders_late').title, 'أوردرات متأخرة: 2'); assert.equal(mock.mkt.agentNoteReads.length, 0, 'the number moved: unread again');
  mock.orders.forEach((o) => { o.status = 'مكتمل'; }); runRules(mock, at); assert.ok(!refs().includes('rule:stock:orders_late'));
  // a rule switched off writes no note; the status names each rule's number and whether it holds
  mock.settings.push({ section: 'ai', data: { agents: { dev: { rules: [{ id: 'speed', metric: 'site_speed', op: 'lte', value: 50, kind: 'problem', on: false }] } } } }); runRules(mock, at);
  assert.ok(!refs().some((r) => r && r.startsWith('rule:dev:')));
  const st = rulesStatus(mock, at); assert.equal(st.agents.dev.own, true); assert.deepEqual(st.agents.dev.rules.map((r) => [r.id, r.now, r.firing]), [['speed', 41, false]]);
  assert.deepEqual(st.agents.accountant.rules.map((r) => [r.metric, r.now, r.firing]), [['withdraw_pending', 1, true], ['sub_days_left', 20, false]]); assert.equal(st.agents.accountant.own, false);
  // a seller without makers: nothing about them is counted into a note, and their assistant has no rule
  const one = install(); one.settings.push({ section: 'store', data: { platform: 'woo', mode: 'single' } }); runRules(one, at);
  assert.ok(!one.mkt.agentNotes.some((n) => String(n.ref).startsWith('rule:makers:'))); assert.ok(one.mkt.agentNotes.some((n) => n.ref === 'rule:stock:orders_late'));
  assert.deepEqual(rulesStatus(one, at).agents.makers, { own: false, metrics: [], rules: [] });
  for (const m of Object.values(METRICS)) if (m.data !== 'vendors') assert.ok(!/مبتكر|maker/i.test(m.ar + m.en + m.doAr + m.doEn), 'only the makers’ own metrics name them');
  // off for an install that did not ask for it
  const quiet = install(); quiet.mkt.rulesOn = false; assert.equal(runRules(quiet, at), null); assert.equal(quiet.mkt.agentNotes.length, 1);
});
