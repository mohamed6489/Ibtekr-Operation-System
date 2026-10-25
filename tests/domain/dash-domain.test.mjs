import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const DD = loadUmd(new URL('../../app/js/blocks/24-dash-domain.js', import.meta.url));

test('roleOf falls back to viewer for unknown and custom roles', () => {
  assert.equal(DD.roleOf('مراجعة جودة'), 'مشاهد');
  assert.equal(DD.roleOf(undefined), 'مشاهد');
  assert.equal(DD.roleOf('أدمن'), 'أدمن');
});

test('cardsFor marks need as locked', () => {
  const cards = DD.cardsFor('مشاهد');
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.id), ['kpis', 'daily', 'need', 'activity']);
  assert.deepEqual(cards.filter((c) => c.locked).map((c) => c.id), ['need']);
});

test('layout keeps the saved order, drops unknown ids, appends new cards, never hides need', () => {
  const l = DD.layout('أدمن', { order: ['team', 'kpis', 'statements'], hidden: ['need', 'team'] });
  assert.deepEqual(l.map((c) => c.id), ['team', 'kpis', 'daily', 'need', 'weeks', 'health', 'money', 'vendors', 'system', 'activity']);
  assert.equal(l.some((c) => c.id === 'statements'), false);
  assert.equal(l.find((c) => c.id === 'team').hidden, true);
  assert.equal(l.find((c) => c.id === 'need').hidden, false);
  assert.equal(l.length, 10);
});

test('layout with no prefs = default order, nothing hidden', () => {
  const l = DD.layout('حسابات', null);
  assert.deepEqual(l.map((c) => c.id), ['kpis', 'daily', 'need', 'expByType', 'money', 'statements', 'activity']);
  assert.deepEqual(l.map((c) => c.hidden), [false, false, false, false, false, false, false]);
});

test('kpisFor per role and MONEY_KPIS', () => {
  assert.deepEqual(DD.kpisFor('عمليات'), ['open', 'ready', 'consLate', 'returns', 'late']);
  assert.deepEqual(DD.kpisFor('مشاهد'), ['myTasks', 'mentions', 'photo']);
  assert.equal(DD.MONEY_KPIS.includes('sales'), true);
  assert.equal(DD.MONEY_KPIS.includes('payroll'), true);
  assert.equal(DD.MONEY_KPIS.includes('open'), false);
});

test('topNeed ranks error < orange < warning < other, skips muted, keeps source order inside a rank', () => {
  const sections = [
    { label: 'النظام', tabs: [['all', 'الكل', [{ title: 'w1', tone: 'warning' }, { title: 'e1', tone: 'error' }, { title: 'm', tone: 'error', muted: true }]]] },
    { label: 'عملاء', tabs: [['all', 'الكل', [{ title: 'o1', tone: 'orange' }, { title: 'n1' }, { title: 'e2', tone: 'error' }]]] },
  ];
  const top5 = DD.topNeed(sections, 5);
  assert.deepEqual(top5.items.map((i) => i.title), ['e1', 'e2', 'o1', 'w1', 'n1']);
  assert.equal(top5.total, 5);
  assert.equal(top5.items[0].section, 'النظام');
  const top2 = DD.topNeed(sections, 2);
  assert.equal(top2.items.length, 2);
  assert.equal(top2.total, 5);
  assert.deepEqual(DD.topNeed([], 5), { items: [], total: 0 });
});

test('health counts open orders by state with shares', () => {
  const h = DD.health([
    { status: 'جاري التنفيذ' }, { status: 'قيد الشحن' }, { status: 'جاهز للشحن' }, { status: 'مكتمل' },
    { status: 'معلّق', confirm: 'غير مؤكد', delivery: 'late' }, { status: 'ملغي' },
  ]);
  assert.equal(h.open, 4);
  assert.deepEqual(h.rows.map((r) => [r.key, r.count]), [['progress', 1], ['shipping', 2], ['unconf', 1], ['risk', 0], ['late', 1]]);
  assert.equal(h.rows[1].pct, 0.5);
  const empty = DD.health([]);
  assert.equal(empty.open, 0);
  assert.equal(empty.rows[0].pct, 0);
});

test('greeting switches at noon', () => {
  assert.equal(DD.greeting(11 * 60 + 59), 'صباح الخير');
  assert.equal(DD.greeting(12 * 60), 'مساء الخير');
});

test('countDelta tone follows the good direction', () => {
  assert.deepEqual(DD.countDelta(5, 3, 'up'), { text: '+2', tone: 'positive' });
  assert.equal(DD.countDelta(3, 5, 'up').tone, 'negative');
  const down = DD.countDelta(3, 5, 'down');
  assert.equal(down.tone, 'positive');
  assert.equal(down.text, '-2');
  assert.deepEqual(DD.countDelta(4, 4, 'up'), { text: '0', tone: 'neutral' });
});

test('countIn is inclusive on both ends', () => {
  const orders = [{ date: '2026-10-01' }, { date: '2026-10-05' }, { date: '2026-10-06' }];
  assert.equal(DD.countIn(orders, { from: '2026-10-01', to: '2026-10-05' }), 2);
});

test('quickActions per role', () => {
  assert.deepEqual(DD.quickActions('مشاهد').map((a) => a.id), ['clock', 'leave', 'notifs']);
  const acc = DD.quickActions('حسابات').map((a) => a.id);
  assert.equal(acc.includes('expense'), true);
  assert.equal(acc.includes('vendorMove'), true);
  assert.equal(acc.includes('vendor'), false);
  assert.deepEqual(DD.quickActions('دور مجهول'), DD.quickActions('مشاهد'));
});

test('nextMonthDay: today counts, last day, rollover, clamp', () => {
  assert.equal(DD.nextMonthDay('2026-10-16', [16, 'last']), '2026-10-16');
  assert.equal(DD.nextMonthDay('2026-10-17', [16, 'last']), '2026-10-31');
  assert.equal(DD.nextMonthDay('2026-10-31', [16]), '2026-11-16');
  assert.equal(DD.nextMonthDay('2026-02-10', [30]), '2026-02-28');
  assert.equal(DD.nextMonthDay('2026-12-20', [5]), '2027-01-05');
  assert.equal(DD.nextMonthDay('2026-10-01', []), null);
});

test('packRows fills 12 columns and stretches the last card of each row', () => {
  assert.deepEqual(DD.packRows(['daily', 'need', 'weeks', 'health']), [['daily', 4], ['need', 8], ['weeks', 7], ['health', 5]]);
  assert.deepEqual(DD.packRows(['weeks', 'team']), [['weeks', 7], ['team', 5]]);
  assert.deepEqual(DD.packRows(['money']), [['money', 12]]);
  assert.deepEqual(DD.packRows([]), []);
});
