import { test } from 'node:test'; import assert from 'node:assert/strict';
import {
  parseAssistant, assistantRequest, readTurn, toolResults, cleanAction, dataQuery, ordersData, vendorsData, customersData, ticketsData, tasksData, expensesData, salesData, summaryData, cleanAnswer,
  toolsOf, reportOf, REPORT_MAX, ASSISTANT_TURNS, Q_MAX, ANSWER_MAX, PAGES, deliveryOf, ageDays, amountsIn,
  FORMS, AI_ORDER_STATUSES,
} from '../../supabase/functions/_shared/ai-assistant.js';
// The header's assistant (phase 12 T1, decision 8): the body checks, Claude's tools and request, reading a turn, the client
// actions' cleaning and the data shaping with the member's rows — never a phone or an address.

const TODAY = '2026-11-08';
const CTX = { model: 'claude-opus-5-5', effort: 'medium', today: TODAY, actor: 'منى', role: 'خدمة العملاء' };
const body = (extra = {}) => ({ turns: [{ role: 'user', text: 'كام أوردر متأخر؟' }], context: { page: 'orders' }, ...extra });

test('parseAssistant: the turns (the last one the user\'s, at most 12, each cut to Q_MAX), the mode, the screen context; bad shapes name their field', () => {
  const r = parseAssistant(body({ context: { page: 'accounts', tab: 'expenses', period: { from: '2026-11-01', to: '2026-11-08' }, vendors: ['Art Craft', 'Art Craft', '<b>x</b>'], statuses: ['مكتمل'] } }));
  assert.deepEqual(r.req.context, { page: 'accounts', tab: 'expenses', period: { from: '2026-11-01', to: '2026-11-08' }, vendors: ['Art Craft', 'x'], statuses: ['مكتمل'] });
  assert.equal(r.req.mode, 'chat'); assert.equal(r.req.question, 'كام أوردر متأخر؟');
  const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i }));
  assert.equal(parseAssistant(body({ turns: many.concat([{ role: 'user', text: 'x' }]) })).req.turns.length, ASSISTANT_TURNS);
  assert.equal(parseAssistant(body({ turns: [{ role: 'user', text: 'a'.repeat(Q_MAX + 50) }] })).req.question.length, Q_MAX);
  assert.deepEqual(parseAssistant(body({ turns: [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }] })), { error: 'bad_request', field: 'turns' }, 'the last turn is the user\'s');
  assert.deepEqual(parseAssistant(body({ turns: [{ role: 'system', text: 'x' }] })), { error: 'bad_request', field: 'turns' });
  assert.deepEqual(parseAssistant(body({ turns: [] })), { error: 'bad_request', field: 'turns' });
  assert.deepEqual(parseAssistant(body({ mode: 'sql' })), { error: 'bad_request', field: 'mode' });
  assert.deepEqual(parseAssistant('x'), { error: 'bad_request', field: 'body' });
  // an unknown page, a bad period and a bad tab are dropped, not refused
  assert.deepEqual(parseAssistant(body({ context: { page: 'admin', period: { from: '2026-11-09', to: '2026-11-01' }, tab: 7 } })).req.context, { page: '', tab: '', period: null, vendors: [], statuses: [] });
  assert.equal(parseAssistant(body({ mode: 'filter' })).req.mode, 'filter');
});

test('assistantRequest: the cached base + the screen block, the turns as messages, the tools (server get_data + the five client tools); the filter mode forces set_filter alone', () => {
  const req = parseAssistant(body({ turns: [{ role: 'user', text: 'أهلًا' }, { role: 'assistant', text: 'أهلًا بيك' }, { role: 'user', text: 'افتح الأوردرات' }], context: { page: 'accounts', tab: 'expenses', period: { from: '2026-11-01', to: '2026-11-08' } } })).req;
  const p = assistantRequest(req, CTX);
  assert.equal(p.model, 'claude-opus-5-5'); assert.equal(p.fallbacks, 'default'); assert.deepEqual(p.output_config, { effort: 'medium' });
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' }); assert.match(p.system[0].text, /get_data/); assert.match(p.system[0].text, /propose_entry/); assert.match(p.system[0].text, /متعرضش أرقام تليفونات/);
  assert.equal(p.system[1].text, 'النهارده (القاهرة): 2026-11-08\nالمستخدم: منى (خدمة العملاء)\nالصفحة المفتوحة: الحسابات / expenses\nالفترة المعروضة: 2026-11-01 → 2026-11-08');
  assert.deepEqual(p.messages.map((m) => [m.role, m.content[0].text]), [['user', 'أهلًا'], ['assistant', 'أهلًا بيك'], ['user', 'افتح الأوردرات']]);
  assert.deepEqual(p.tools.map((t) => t.name), ['get_data', 'navigate', 'filter_orders', 'set_period', 'sort_vendors', 'propose_entry', 'open_form']);
  assert.equal(p.tool_choice, undefined);
  assert.deepEqual(p.tools[1].input_schema.properties.page.enum, PAGES);
  const f = assistantRequest(parseAssistant({ mode: 'filter', turns: [{ role: 'user', text: 'المتأخر بتاع Art Craft' }], context: { vendors: ['Art Craft'], statuses: ['مكتمل', 'ملغي'] } }).req, CTX);
  assert.deepEqual(f.tools.map((t) => t.name), ['set_filter']); assert.deepEqual(f.tool_choice, { type: 'tool', name: 'set_filter' });
  assert.equal(f.system[1].text, 'المبتكرين المتاحين: Art Craft\nحالات الأوردر: مكتمل، ملغي');
  assert.deepEqual(toolsOf('chat').length, 7); // + open_form (phase 13 decision 36)
});

test('readTurn: text, tool uses (ids kept for the results), a refusal, a cut-off without text; toolResults shapes the next user message', () => {
  const msg = { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ثواني' }, { type: 'tool_use', id: 'tu_1', name: 'get_data', input: { kind: 'orders' } }, { type: 'tool_use', id: 'tu_2', name: 'navigate', input: { page: 'orders' } }] };
  assert.deepEqual(readTurn(msg), { stop: 'tools', text: 'ثواني', uses: [{ id: 'tu_1', name: 'get_data', input: { kind: 'orders' } }, { id: 'tu_2', name: 'navigate', input: { page: 'orders' } }] });
  assert.deepEqual(readTurn({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'فيه 3 أوردرات متأخرة.' }] }), { stop: 'end', text: 'فيه 3 أوردرات متأخرة.', uses: [] });
  assert.equal(readTurn({ stop_reason: 'refusal', content: [] }).stop, 'refused');
  assert.equal(readTurn({ stop_reason: 'max_tokens', content: [] }).stop, 'error');
  assert.equal(readTurn({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'نص' }] }).stop, 'end', 'a cut-off with text is still an answer');
  assert.equal(readTurn(null).stop, 'error');
  // a data result travels inside the <data> block the system prompt marks as untrusted (security review: names and notes in our tables are not instructions)
  assert.deepEqual(toolResults([{ id: 'tu_1', content: { total: 3 } }, { id: 'tu_2', content: 'done', error: true }]),
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '<data>\n{"total":3}\n</data>' }, { type: 'tool_result', tool_use_id: 'tu_2', content: 'done', is_error: true }] });
  assert.match(assistantRequest(parseAssistant(body()).req, CTX).system[0].text, /<data>/);
  // the amounts the member typed: Arabic digits and separators too; a propose_entry on another amount is refused by the server
  assert.deepEqual(amountsIn('سجل سحب مرتبات ٥٬٠٠٠ وعربون 1,200.50 لأحمد'), [5000, 1200.5]);
  assert.deepEqual(amountsIn('افتح الأوردرات'), []);
});

test('cleanAction: each client tool to what the page executes — unknown pages, bad sorts, non-positive amounts and unknown tools are null', () => {
  assert.deepEqual(cleanAction('navigate', { page: 'accounts', tab: 'vendors' }), { name: 'navigate', input: { page: 'accounts', tab: 'vendors' } });
  assert.deepEqual(cleanAction('navigate', { page: 'hr' }), { name: 'navigate', input: { page: 'hr' } });
  assert.equal(cleanAction('navigate', { page: 'admin' }), null);
  assert.deepEqual(cleanAction('filter_orders', { clear: true, st: 'جاري التنفيذ', deliv: 'late', vendor: 'Art Craft', bogus: 1, q: '' }), { name: 'filter_orders', input: { clear: true, st: 'جاري التنفيذ', vendor: 'Art Craft', deliv: 'late' } });
  assert.equal(cleanAction('filter_orders', { deliv: 'soon' }), null);
  assert.deepEqual(cleanAction('set_period', { preset: 'last7' }), { name: 'set_period', input: { preset: 'last7' } });
  assert.deepEqual(cleanAction('set_period', { from: '2026-10-01', to: '2026-10-31' }), { name: 'set_period', input: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(cleanAction('set_period', { from: '2026-10-31', to: '2026-10-01' }), null); assert.equal(cleanAction('set_period', { preset: 'max' }), null);
  assert.deepEqual(cleanAction('sort_vendors', { sort: 'deposits:asc' }), { name: 'sort_vendors', input: { sort: 'deposits:asc' } }); assert.equal(cleanAction('sort_vendors', { sort: 'name' }), null);
  assert.deepEqual(cleanAction('propose_entry', { kind: 'expense', direction: 'withdraw', amount: '5000', category: 'المرتبات', beneficiary: 'أحمد', account: 'x' }), { name: 'propose_entry', input: { kind: 'expense', direction: 'withdraw', amount: 5000, category: 'المرتبات', beneficiary: 'أحمد' } });
  assert.deepEqual(cleanAction('propose_entry', { kind: 'vendor', direction: 'deposit', amount: 300.456, vendor: 'Art Craft', vendorType: 'عربون' }), { name: 'propose_entry', input: { kind: 'vendor', direction: 'deposit', amount: 300.46, vendor: 'Art Craft', vendorType: 'عربون' } });
  assert.equal(cleanAction('propose_entry', { kind: 'account', direction: 'withdraw', amount: 0 }), null); assert.equal(cleanAction('propose_entry', { kind: 'gift', direction: 'withdraw', amount: 5 }), null);
  assert.deepEqual(cleanAction('set_filter', { op: 'or', items: [{ f: 'st', op: 'eq', v: 'مكتمل' }, { f: 'x', op: 'eq', v: 1 }, { f: 'age', op: 'gt', v: 10 }] }), { name: 'set_filter', input: { op: 'or', items: [{ f: 'st', op: 'eq', v: 'مكتمل' }, { f: 'age', op: 'gt', v: '10' }] } });
  assert.equal(cleanAction('set_filter', { items: [] }), null);
  assert.equal(cleanAction('get_data', { kind: 'orders' }), null, 'the server tool is not a client action');
});

test('dataQuery: the kind, the period (the input\'s, else the screen\'s, else this month), the limit capped at 20; an unknown kind is an error the model reads', () => {
  const ctx = { today: TODAY, period: { from: '2026-10-01', to: '2026-10-31' } };
  assert.deepEqual(dataQuery({ kind: 'orders', q: ' Art ', limit: 99, status: 'مكتمل' }, ctx), { kind: 'orders', q: 'art', status: 'مكتمل', delivery: '', from: '2026-10-01', to: '2026-10-31', limit: 20, all: false });
  assert.deepEqual(dataQuery({ kind: 'expenses' }, { today: TODAY, period: null }).from, '2026-11-01');
  assert.deepEqual([dataQuery({ kind: 'sales', from: '2026-11-05', to: '2026-11-01' }, ctx).from, dataQuery({ kind: 'sales', from: '2026-11-05', to: '2026-11-01' }, ctx).to], ['2026-11-01', '2026-11-05']);
  assert.deepEqual([dataQuery({ kind: 'sales', from: '2026-11-05' }, ctx).from, dataQuery({ kind: 'sales', from: '2026-11-05' }, ctx).to], ['2026-11-05', TODAY]);
  assert.equal(dataQuery({ kind: 'tasks', all: true }, ctx).all, true); assert.equal(dataQuery({ kind: 'tasks', limit: -1 }, ctx).limit, 10);
  assert.match(dataQuery({ kind: 'secrets' }, ctx).error, /unknown kind/);
});

const ORDERS = [
  { id: 1, number: '177701', customer_name: 'منى سعيد', customer_city: 'القاهرة', status: 'جاري التنفيذ', confirm: 'غير مؤكد', deposit: 0, total: 900, placed_at: '2026-10-25T10:00:00+02:00', customer_phone: '0100***' },
  { id: 2, number: '177702', customer_name: 'أحمد', customer_city: 'الجيزة', status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', deposit: 200, total: 1500, placed_at: '2026-11-05T10:00:00+02:00' },
  { id: 3, number: '177703', customer_name: 'سارة', customer_city: 'القاهرة', status: 'مكتمل', confirm: 'مؤكد بعربون', deposit: 100, total: 600, placed_at: '2026-10-20T10:00:00+02:00' },
  { id: 4, number: '177704', customer_name: 'علي', customer_city: 'القاهرة', status: 'قيد الشحن', confirm: 'مؤكد بدون عربون', deposit: 0, total: 400, placed_at: '2026-10-29T10:00:00+02:00' },
];
test('ordersData: the age makes risk (9+) and late (12+) on open orders; status / delivery / q / period filters; the rows carry no phone', () => {
  assert.equal(deliveryOf('مكتمل', 40), 'done'); assert.equal(deliveryOf('جاري التنفيذ', 12), 'late'); assert.equal(deliveryOf('جاري التنفيذ', 9), 'risk'); assert.equal(deliveryOf('جاري التنفيذ', 8), 'ok');
  assert.equal(ageDays('2026-10-25T10:00:00+02:00', TODAY), 13);
  const dq = dataQuery({ kind: 'orders' }, { today: TODAY, period: { from: '2026-10-01', to: '2026-11-30' } });
  const d = ordersData(ORDERS, dq, TODAY);
  assert.equal(d.total, 4); assert.equal(d.totalEgp, 3400);
  assert.deepEqual(d.byStatus, { 'جاري التنفيذ': 2, 'مكتمل': 1, 'قيد الشحن': 1 });
  assert.deepEqual(d.delivery, { late: 1, ok: 1, risk: 1 }); assert.deepEqual(d.byConfirm, { 'غير مؤكد': 1, 'مؤكد بعربون': 1, 'مؤكد بدون عربون': 1 });
  assert.deepEqual(Object.keys(d.rows[0]).sort(), ['ageDays', 'city', 'confirm', 'customer', 'delivery', 'deposit', 'id', 'number', 'placed_at', 'status', 'total']);
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', delivery: 'late' }, { today: TODAY, period: dq }), TODAY).rows.map((o) => o.number).join(), '177701');
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', status: 'متأخر' }, { today: TODAY, period: dq }), TODAY).total, 1, 'a status word that is a delivery state');
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', status: 'قيد التنفيذ' }, { today: TODAY, period: dq }), TODAY).total, 2, 'the prototype alias');
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', q: 'سارة' }, { today: TODAY, period: dq }), TODAY).rows[0].id, 3);
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', from: '2026-11-01', to: '2026-11-08' }, { today: TODAY }), TODAY).total, 1);
  assert.equal(ordersData(ORDERS, dataQuery({ kind: 'orders', limit: 2 }, { today: TODAY, period: dq }), TODAY).rows.length, 2);
});

test('vendorsData / customersData / ticketsData / tasksData: the filters, the counts, no phone or address, the open ones by default', () => {
  const v = vendorsData([{ id: 'a', name: 'Art Craft', status: 'active', category: 'ديكور', lead_days: 7, phone: '0100' }, { id: 'b', name: 'Beads', status: 'leave', category: null }], dataQuery({ kind: 'vendors' }, { today: TODAY }));
  assert.deepEqual(v, { total: 2, byStatus: { active: 1, leave: 1 }, rows: [{ id: 'a', name: 'Art Craft', status: 'active', category: 'ديكور', leadDays: 7, joined: null }, { id: 'b', name: 'Beads', status: 'leave', category: '', leadDays: null, joined: null }] });
  assert.equal(vendorsData([{ id: 'a', name: 'Art Craft', status: 'active' }], dataQuery({ kind: 'vendors', q: 'bead' }, { today: TODAY })).total, 0);
  const c = customersData([{ id: 'c1', phone: '01000000001', name: 'منى', city: 'القاهرة', address: 'شارع', orders: 3, total: '2500.5', last_order_at: '2026-11-01T10:00:00Z', mood: 'راضي', tags: ['vip'], open_complaints: 0 }, { id: 'c2', name: 'مدمج', orders: 1, merged_into: 'c1' }, { id: 'c3', name: 'أحمد', orders: 5, blocked_at: '2026-11-01' }], dataQuery({ kind: 'customers' }, { today: TODAY }));
  assert.equal(c.total, 2); assert.equal(c.rows[0].name, 'أحمد'); assert.equal(c.rows[0].blocked, true);
  assert.deepEqual(c.rows[1], { id: 'c1', name: 'منى', city: 'القاهرة', orders: 3, total: 2500.5, lastOrder: '2026-11-01', mood: 'راضي', tags: ['vip'], openComplaints: 0, blocked: false });
  assert.ok(!JSON.stringify(c).includes('0100') && !JSON.stringify(c).includes('شارع'));
  const T = [{ id: 7, type: 'customer', title: 'تأخير', priority: 'high', assignee_role: 'اللوجستيك والشحن', status: 'open', order_number: '177701', created_at: '2026-11-01T10:00:00Z', last_update: '2026-11-02T10:00:00Z' }, { id: 8, type: 'internal', title: 'x', priority: 'low', assignee_role: 'الحسابات', status: 'closed', created_at: '2026-10-01', last_update: '2026-10-02' }];
  const t = ticketsData(T, dataQuery({ kind: 'tickets' }, { today: TODAY }));
  assert.equal(t.total, 1); assert.equal(t.rows[0].no, 'TKT-0007'); assert.deepEqual(t.byRole, { 'اللوجستيك والشحن': 1 });
  assert.equal(ticketsData(T, dataQuery({ kind: 'tickets', status: 'all' }, { today: TODAY })).total, 2); assert.equal(ticketsData(T, dataQuery({ kind: 'tickets', status: 'closed' }, { today: TODAY })).total, 1);
  const K = [{ id: 1, member_id: 'me', title: 'تقرير', status: 'لسه', day: '2026-11-08' }, { id: 2, member_id: 'other', title: 'y', status: 'جاري', day: '2026-11-08' }, { id: 3, member_id: 'me', title: 'z', status: 'خلصت', day: '2026-11-07' }, { id: 4, member_id: 'me', title: 'w', status: 'لسه', day: '2026-11-07', deleted_at: '2026-11-08' }];
  assert.deepEqual(tasksData(K, dataQuery({ kind: 'tasks' }, { today: TODAY }), 'me'), { total: 1, byStatus: { 'لسه': 1 }, rows: [{ id: 1, title: 'تقرير', status: 'لسه', day: '2026-11-08', until: null, mine: true }] });
  assert.equal(tasksData(K, dataQuery({ kind: 'tasks', all: true }, { today: TODAY }), 'me').total, 2);
  assert.equal(tasksData(K, dataQuery({ kind: 'tasks', status: 'all' }, { today: TODAY }), 'me').total, 2, 'the deleted one never');
});

test('expensesData / salesData / summaryData: the period totals by category, the sales groups with ibtekr\'s share (null when hidden), the summary assembled with forbidden parts', () => {
  const E = [{ on_date: '2026-11-02', direction: 'withdraw', category: 'المرتبات', beneficiary: 'أحمد', amount: '5000', note: 'سري' }, { on_date: '2026-11-03', direction: 'withdraw', category: 'الإعلانات', amount: 1200.5 }, { on_date: '2026-11-04', direction: 'deposit', category: 'المصروفات', amount: 300 }, { on_date: '2026-10-04', direction: 'withdraw', category: 'المصروفات', amount: 99 }, { on_date: '2026-11-05', direction: 'withdraw', category: 'المصروفات', amount: 50, voided_at: '2026-11-06' }];
  const dq = dataQuery({ kind: 'expenses' }, { today: TODAY });
  const e = expensesData(E, dq);
  assert.deepEqual([e.withdrawn, e.deposited, e.byCategory, e.count], [6200.5, 300, { 'المرتبات': 5000, 'الإعلانات': 1200.5 }, 3]);
  assert.equal(e.rows[0].date, '2026-11-04'); assert.ok(!JSON.stringify(e).includes('سري'));
  const s = salesData([{ vendor_id: null, grp: 'مكتمل', orders: 12, sales: '18000', share: '3600', is_total: true }, { vendor_id: null, grp: 'تحت التنفيذ', orders: 4, sales: 5000, share: null, is_total: true }, { vendor_id: 'a', grp: 'مكتمل', orders: 7, sales: 10000, share: 2000, is_total: false }, { vendor_id: 'b', grp: 'مكتمل', orders: 5, sales: 8000, share: 1600, is_total: false }, { vendor_id: 'a', grp: 'تحت التنفيذ', orders: 4, sales: 5000, share: null, is_total: false }], { a: 'Art Craft' }, dq);
  assert.deepEqual(s.byGroup, { 'مكتمل': { orders: 12, sales: 18000, ibtekrShare: 3600 }, 'تحت التنفيذ': { orders: 4, sales: 5000, ibtekrShare: null } });
  assert.deepEqual(s.topMakers, [{ vendor: 'Art Craft', orders: 7, sales: 10000, ibtekrShare: 2000 }, { vendor: 'b', orders: 5, sales: 8000, ibtekrShare: 1600 }]);
  const sum = summaryData({ orders: ordersData(ORDERS, dataQuery({ kind: 'orders' }, { today: TODAY, period: { from: '2026-10-01', to: '2026-11-30' } }), TODAY), tickets: { forbidden: true }, conversations: { open: 4 }, tasks: { total: 1, byStatus: { 'لسه': 1 } }, expenses: e, sales: { forbidden: true } }, dq);
  assert.deepEqual(sum.orders, { open: { 'جاري التنفيذ': 2, 'قيد الشحن': 1 }, delivery: { late: 1, ok: 1, risk: 1 }, unconfirmed: 1, waiting: 0, inPeriod: 4, inPeriodEgp: 3400 });
  assert.deepEqual(sum.tickets, { forbidden: true }); assert.deepEqual(sum.sales, { forbidden: true }); assert.deepEqual(sum.conversations, { open: 4 }); assert.deepEqual(sum.myTasks, { open: 1, byStatus: { 'لسه': 1 } });
  assert.deepEqual(sum.expenses, { withdrawn: 6200.5, byCategory: { 'المرتبات': 5000, 'الإعلانات': 1200.5 } });
});

test('cleanAnswer: plain text to ANSWER_MAX, the actions in order (at most 10), the data kinds once each', () => {
  const a = cleanAnswer('<b>فيه</b> 3 أوردرات\n\n\nمتأخرة', [{ name: 'navigate', input: { page: 'orders' } }, null], ['orders', 'orders', 'summary']);
  assert.deepEqual(a, { text: 'فيه 3 أوردرات\n\nمتأخرة', actions: [{ name: 'navigate', input: { page: 'orders' } }], tools: ['orders', 'summary'] });
  assert.equal(cleanAnswer('x'.repeat(ANSWER_MAX + 10), [], []).text.length, ANSWER_MAX);
});


// phase 13 decision 23: the reads as the page's «تفاصيل» report — forbidden reads out, strings / lists / depth clamped, the whole bounded
test('reportOf: forbidden and malformed reads out, strings ≤ 200 and lists ≤ 50 and depth ≤ 4, the last reads dropped past REPORT_MAX', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ number: 1000 + i, customer: 'x'.repeat(300), deep: { a: { b: { c: { d: 1 } } } } }));
  const r = reportOf([{ kind: 'orders', data: { total: 80, rows } }, { kind: 'tickets', data: { forbidden: true } }, { kind: 3, data: {} }, null]);
  assert.equal(r.length, 1); assert.equal(r[0].kind, 'orders'); assert.equal(r[0].data.total, 80);
  assert.equal(r[0].data.rows.length, 50); assert.equal(r[0].data.rows[0].customer.length, 200);
  assert.deepEqual(r[0].data.rows[0].deep, { a: null }); // the report at depth 0, rows 1, a row 2, deep 3 — deeper is null
  const big = Array.from({ length: 5 }, (_, i) => ({ kind: 'k' + i, data: { rows: Array.from({ length: 50 }, () => ({ t: 'y'.repeat(200), u: 'z'.repeat(200), v: 'w'.repeat(200) })) } })); // ≈ 150 KB before the cap
  const b = reportOf(big); assert.ok(b.length < 5 && b.length > 0); assert.ok(JSON.stringify(b).length <= REPORT_MAX);
  assert.deepEqual(reportOf(undefined), []);
});


// phase 13 decision 36 (owner 10 Nov — «يقدر يضيف مبتكر أو موظف أو عميل… يفتحلي بيها بوب أب أملاها وبعد كده ياخد الأكشن»): open_form opens
// one of the system's own popups with the values the member said; unknown forms / fields are dropped; never a dangerous order status
test('open_form: the known forms and their fields only; dates, amounts and numbers checked; no cancel / return / fail for an order', () => {
  assert.deepEqual(cleanAction('open_form', { form: 'vendor_add', values: { name: ' خزف أسوان ', phone: '01012345678', bogus: 'x', storeUrl: 'https://x' } }),
    { name: 'open_form', input: { form: 'vendor_add', values: { name: 'خزف أسوان', phone: '01012345678', storeUrl: 'https://x' } } });
  assert.equal(cleanAction('open_form', { form: 'vendor_delete', values: { name: 'x' } }), null);
  assert.deepEqual(cleanAction('open_form', { form: 'member_add', values: { name: 'منى', hire: '2026-13-40', email: 'm@ibtekr.club' } }).input.values, { name: 'منى', email: 'm@ibtekr.club' });
  assert.deepEqual(cleanAction('open_form', { form: 'hr_advance', values: { amount: '3,000', months: '30' } }).input.values, { amount: '3000' }); // months > 24 dropped
  assert.deepEqual(cleanAction('open_form', { form: 'hr_leave', values: { kind: 'إجازة سنوية', from: '2026-12-01', to: 'بكرة' } }).input.values, { kind: 'إجازة سنوية', from: '2026-12-01' });
  assert.deepEqual(cleanAction('open_form', { form: 'ticket_new', values: { type: 'boss', priority: 'high', orderId: 'IB-181668', title: 'تأخير' } }).input.values, { priority: 'high', orderId: '181668', title: 'تأخير' });
  assert.deepEqual(cleanAction('open_form', { form: 'order_update', values: { order: 'IB-181668', status: 'جاهز للشحن' } }).input.values, { order: '181668', status: 'جاهز للشحن' });
  for (const st of ['ملغي', 'استرجاع', 'فشل']) { assert.ok(!AI_ORDER_STATUSES.includes(st)); assert.equal(cleanAction('open_form', { form: 'order_update', values: { order: '1', status: st } }), null); }
  assert.deepEqual(Object.keys(FORMS).sort(), ['customer_add', 'hr_advance', 'hr_leave', 'hr_remote', 'member_add', 'order_update', 'task_add', 'ticket_new', 'vendor_add']);
  assert.ok(toolsOf('chat').some((t) => t.name === 'open_form')); assert.ok(!toolsOf('filter').some((t) => t.name === 'open_form'));
});
