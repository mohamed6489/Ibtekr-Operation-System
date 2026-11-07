// The pure notifications engine (phase 11, decision 16): the v6 type rows → rules; the role matrix gated by the permissions;
// first send at once, repeats by the cadence at the Cairo clock time, the calendar cadences on their day; the quiet hours
// hold the external channels only; the WhatsApp cap; the escalation after the time with no action; resolution; digests.
import test from 'node:test'; import assert from 'node:assert/strict';
import { SOURCES, accessOf, calendarDue, digestPlan, escalationFor, parseAt, parseRule, plan, quietNow, receivers, roleIndex, ruleFor, sendDue, typeRules, waCap } from '../../supabase/functions/_shared/notify.js';

const ROLES = [
  { id: 'admin', name: 'أدمن', permissions: {}, sort: 1 },
  { id: 'ops', name: 'عمليات', permissions: { 'orders.view': 'F', 'vendors.view': 'F', 'inventory.view': 'F', 'tickets.view': 'F' }, sort: 2 },
  { id: 'cs', name: 'خدمة العملاء', permissions: { 'orders.view': 'F', 'cs.view': 'F', 'tickets.view': 'F' }, sort: 3 },
  { id: 'accounts', name: 'حسابات', permissions: { 'accounts.view': 'F', 'vendors.view': 'P', 'tickets.view': 'P' }, sort: 4 },
  { id: 'vendors_followup', name: 'متابعة المبتكرين', permissions: { 'orders.view': 'F', 'vendors.view': 'F', 'tickets.view': 'P' }, sort: 5 },
  { id: 'viewer', name: 'مشاهد', permissions: { 'orders.view': 'P' }, sort: 6 },
];
const MEMBERS = [
  { id: 'u-admin', name: 'أدمن', role_id: 'admin', status: 'active', email: 'a@x.test', phone: '01000000001' },
  { id: 'u-cs', name: 'سارة', role_id: 'cs', status: 'active', email: 'cs@x.test', phone: '01000000002' },
  { id: 'u-cs2', name: 'مريم', role_id: 'cs', status: 'suspended', email: 'cs2@x.test', phone: '01000000003' },
  { id: 'u-ops', name: 'علي', role_id: 'ops', status: 'active', email: 'ops@x.test', phone: null, manager_id: 'u-admin' },
];
// Cairo = UTC+2 in November: 2026-11-08 is a Sunday; 10:00 Cairo = 08:00Z
const NOW = '2026-11-08T08:00:00.000Z'; const CAIRO = { day: '2026-11-08', time: '10:00' };
const NOTIF = { notif: [['عملاء', [['أوردر متأخر — محتاج متابعة مع العميل', 'حتى الإغلاق', 'داخل السيستم + واتساب', 'خدمة العملاء', true, 'لحد ما يتحل', 'كل 24 ساعة'], ['غير مؤكد من العميل', '3 أيام', 'داخل السيستم', 'خدمة العملاء', true]]],
  ['المبتكرين', [['التقرير الأسبوعي للمبتكر', '7 أيام', 'داخل السيستم + واتساب', 'متابعة المبتكرين + المبتكر (واتساب)', true, 'مرة واحدة', 'أسبوعيًا', '10:00 ص', null, 'الأحد']]],
  ['مهام', [['تذكرة عاجلة / عالية', 'حتى الحل', 'داخل السيستم + واتساب', 'المسؤول عن التذكرة', true, 'لحد ما يتحل', 'كل 4 ساعات']]]],
  escalations: [{ type: 'غير مؤكد من العميل', after: '24 ساعة', to: ['مدير خدمة العملاء'], ch: 'داخل السيستم', on: true }, { type: 'تذكرة عاجلة بدون رد', after: '4 ساعات', to: ['دور أدمن'], ch: 'واتساب', on: true }],
  quiet: { days: 'الجمعة', hours: 'من 11:00 م إلى 9:00 ص', waMax: 'رسالتان في اليوم' }, alertRoles: {}, alertOverrides: {} };

test('the type rows become rules; the built-in rules fill the sources the v6 has no row for; parseAt reads the Arabic clock', () => {
  const r = parseRule(['x', 'حتى الإغلاق', 'داخل السيستم + واتساب + إيميل', 'متابعة المبتكرين + المبتكر (واتساب)', true, '3 مرات', 'كل 4 ساعات', '10:00 ص']);
  assert.deepEqual([r.on, r.channels, r.vendorWa, r.count, r.every, r.at], [true, { system: true, email: true, whatsapp: true }, true, 3, 'كل 4 ساعات', 10]);
  assert.equal(parseRule(['x', '', 'داخل السيستم', 'أدمن', false]).on, false);
  assert.equal(parseRule(['x', '', 'داخل السيستم', 'أدمن', true, 'لحد ما يتحل']).count, Infinity);
  assert.deepEqual([parseAt('12:00 ص'), parseAt('12:00 م'), parseAt('9:30 ص'), parseAt('11:00 م'), parseAt('')], [0, 12, 9, 23, 0]);
  assert.equal(ruleFor(NOTIF, 'customers.late').count, Infinity); assert.equal(ruleFor(NOTIF, 'vendors.late').at, 10, 'built-in'); assert.equal(ruleFor({}, 'messages.late').every, 'كل ساعة');
  assert.equal(typeRules({ notif: 'junk' }).size > 0, true); assert.equal(ruleFor(NOTIF, 'nope'), null);
  assert.equal(SOURCES.every((s) => ruleFor(NOTIF, s.key) !== null), true, 'every source has a rule (v6 defaults or built-in)');
});

test('the matrix: the block-23 defaults, the permission gate, the admin never N, a member override; custom roles take the next columns', () => {
  assert.deepEqual(receivers(NOTIF, ROLES, 'customers.late'), ['admin', 'ops', 'cs'], 'RRRNSN — accounts N, the follow-up S, the viewer N');
  assert.equal(accessOf(NOTIF, ROLES, 'customers.late', 'vendors_followup'), 'S'); assert.equal(accessOf(NOTIF, ROLES, 'customers.late', 'viewer'), 'N');
  assert.equal(accessOf({ alertRoles: { 'customers.late': 'RNNNNN' } }, ROLES, 'customers.late', 'ops'), 'N', 'the settings matrix wins');
  assert.equal(accessOf({ alertRoles: { 'accounts.payroll': 'RRRRRR' } }, ROLES, 'accounts.payroll', 'cs'), 'N', 'accounts.view F is required whatever the matrix says');
  assert.equal(accessOf({ alertRoles: { 'customers.late': 'NNNNNN' } }, ROLES, 'customers.late', 'admin'), 'S', 'the admin at least sees');
  assert.equal(accessOf(NOTIF, ROLES, 'customers.late', 'cs', 'N'), 'N', 'a member override removes');
  assert.equal(accessOf(NOTIF, ROLES, 'customers.late', 'accounts', 'R'), 'N', 'an override never passes the permission gate');
  const custom = ROLES.concat([{ id: 'content', name: 'محتوى', permissions: { 'orders.view': 'F' }, sort: 9 }]);
  assert.equal(roleIndex(custom).content, 6);
  assert.equal(accessOf({ alertRoles: { 'customers.late': 'RRRNSNR' } }, custom, 'customers.late', 'content'), 'R');
  assert.equal(accessOf(NOTIF, custom, 'customers.late', 'content'), 'N', 'no column → N');
});

test('sendDue: the first time at once, repeats at the cadence / the Cairo clock, the count, the calendar cadences on their day', () => {
  const daily = ruleFor(NOTIF, 'customers.late'); const nowMs = Date.parse(NOW);
  assert.equal(sendDue(daily, null, CAIRO, nowMs), true, 'first');
  assert.equal(sendDue(daily, { sent_count: 1, last_sent_at: '2026-11-08T05:00:00Z' }, CAIRO, nowMs), false, 'sent today already');
  assert.equal(sendDue(daily, { sent_count: 1, last_sent_at: '2026-11-07T20:00:00Z' }, CAIRO, nowMs), true, 'yesterday, the hour (12:00 ص default) passed');
  assert.equal(sendDue(daily, { sent_count: 1, last_sent_at: '2026-11-07T22:30:00Z' }, CAIRO, nowMs), false, '22:30Z = 00:30 Cairo today');
  assert.equal(sendDue(daily, { sent_count: 1, last_sent_at: '2026-11-07T20:00:00Z', resolved_at: '2026-11-07T21:00:00Z' }, CAIRO, nowMs), true, 'a resolved row starts over');
  const once = ruleFor(NOTIF, 'customers.unconf'); assert.equal(sendDue(once, { sent_count: 1, last_sent_at: '2026-11-01T00:00:00Z' }, CAIRO, nowMs), false, 'once only');
  const hourly = ruleFor(NOTIF, 'tasks.urgent');
  assert.equal(sendDue(hourly, { sent_count: 2, last_sent_at: '2026-11-08T04:30:00Z' }, CAIRO, nowMs), false, '3.5 h < 4 h');
  assert.equal(sendDue(hourly, { sent_count: 2, last_sent_at: '2026-11-08T03:59:00Z' }, CAIRO, nowMs), true);
  const weekly = ruleFor(NOTIF, 'vendors.weekly');
  assert.equal(sendDue(weekly, null, CAIRO, nowMs), true, 'Sunday 10:00');
  assert.equal(sendDue(weekly, null, { day: '2026-11-08', time: '09:00' }, nowMs - 3600_000), false, 'before the hour');
  assert.equal(sendDue(weekly, null, { day: '2026-11-09', time: '10:00' }, nowMs + 86400_000), false, 'Monday');
  assert.equal(sendDue(weekly, { sent_count: 1, last_sent_at: '2026-11-08T08:05:00Z' }, CAIRO, nowMs + 600_000), false, 'sent this Sunday');
  assert.equal(calendarDue({ every: 'أيام محددة من الشهر', days: [16, 'last'] }, '2026-11-30'), true); assert.equal(calendarDue({ every: 'أيام محددة من الشهر', days: [16, 'last'] }, '2026-11-17'), false);
  assert.equal(calendarDue({ every: 'أيام محددة من الشهر', days: [31] }, '2026-11-30'), true, 'a day past the month end → its last day');
  assert.equal(sendDue({ ...daily, on: false }, null, CAIRO, nowMs), false);
});

test('quiet hours and days, the WhatsApp cap, the escalation rules', () => {
  assert.equal(quietNow(NOTIF.quiet, CAIRO), false);
  assert.equal(quietNow(NOTIF.quiet, { day: '2026-11-08', time: '23:30' }), true); assert.equal(quietNow(NOTIF.quiet, { day: '2026-11-08', time: '08:59' }), true); assert.equal(quietNow(NOTIF.quiet, { day: '2026-11-08', time: '09:00' }), false);
  assert.equal(quietNow(NOTIF.quiet, { day: '2026-11-06', time: '12:00' }), true, 'Friday'); assert.equal(quietNow({ days: 'الجمعة والسبت' }, { day: '2026-11-07', time: '12:00' }), true); assert.equal(quietNow({ days: 'لا يوجد', hours: 'من 1:00 ص إلى 2:00 ص' }, { day: '2026-11-06', time: '12:00' }), false);
  assert.deepEqual([waCap('رسالتان في اليوم'), waCap('رسالة واحدة في اليوم'), waCap('من غير حد'), waCap(undefined)], [2, 1, Infinity, 2]);
  const e = escalationFor(NOTIF, 'customers.unconf'); assert.deepEqual([e.afterMs, e.roles, e.manager, e.channels.whatsapp], [24 * 3600_000, ['cs'], false, false]);
  assert.deepEqual(escalationFor(NOTIF, 'tasks.urgent').roles, ['admin']); assert.equal(escalationFor(NOTIF, 'customers.late'), null, 'no rule for the type');
  assert.equal(escalationFor({ escalations: [{ type: 'غير مؤكد من العميل', after: '30 دقيقة', to: ['دور أدمن'], on: false }] }, 'customers.unconf'), null, 'off');
  assert.equal(escalationFor({ escalations: [{ type: 'غير مؤكد من العميل', after: '30 دقيقة', to: ['دور أدمن', 'المدير المباشر'], ch: 'إيميل' }] }, 'customers.unconf').afterMs, 1800_000);
});

test('plan: a row per receiving role (and the manager for the team), the state counted, the external sends to active members with a contact, the vendor WhatsApp once, the cap, nothing twice', () => {
  const items = [
    { key: 'customers.late', entityId: '1001', title: 'IB-1001 متأخر', body: 'عمره 13 يوم', entity: 'orders' },
    { key: 'customers.unconf', entityId: '1002', title: 'IB-1002 غير مؤكد' },
    { key: 'vendors.weekly', entityId: 'v-1', title: 'التقرير الأسبوعي — آرت كرافت', vendorId: 'v-1', vendorPhone: '01099999999' },
    { key: 'team.req', entityId: 'rq-5', title: 'إجازة — علي', own: { manager: 'u-admin' } },
  ];
  const out = plan({ now: NOW, cairo: CAIRO, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: [], acted: new Set() });
  const by = (k) => out.alerts.filter((a) => a.source_key === k).map((a) => a.role_id || a.user_id).sort();
  assert.deepEqual(by('customers.late'), ['admin', 'cs', 'ops']); assert.deepEqual(by('customers.unconf'), ['admin', 'cs', 'ops']);
  assert.deepEqual(by('vendors.weekly'), ['admin', 'vendors_followup'], 'RSNSRN');
  assert.deepEqual(by('team.req'), ['admin', 'ops', 'u-admin'], 'the matrix roles + the manager as a user');
  const a = out.alerts.find((x) => x.source_key === 'customers.late' && x.role_id === 'cs');
  assert.deepEqual([a.kind, a.title, a.body, a.entity, a.entity_id, a.at], ['customers', 'IB-1001 متأخر', 'عمره 13 يوم', 'orders', '1001', NOW]);
  assert.equal(out.state.length, out.alerts.length); assert.equal(out.state.every((s) => s.sent_count === 1 && s.last_sent_at === NOW && s.first_at === NOW), true);
  // external: customers.late is «داخل السيستم + واتساب» → WhatsApp to the active cs member (u-cs) and the admin; u-cs2 suspended; ops has no phone
  const wa = out.external.filter((x) => x.ch === 'whatsapp');
  assert.deepEqual(wa.filter((x) => x.key === 'customers.late').map((x) => x.to.member).sort(), ['u-admin', 'u-cs']);
  assert.equal(wa.filter((x) => x.key === 'customers.unconf').length, 0, 'system only');
  const vendorWa = wa.filter((x) => x.to.vendor); assert.equal(vendorWa.length, 1); assert.deepEqual([vendorWa[0].to.vendor, vendorWa[0].to.contact], ['v-1', '01099999999']);
  assert.deepEqual(wa.filter((x) => x.key === 'vendors.weekly' && x.to.member).map((x) => x.to.member), ['u-admin'], 'the admin on WhatsApp too (no follow-up member in the team)');
  const opsState = out.state.find((s) => s.source_key === 'customers.late' && s.target === 'role:ops');
  assert.deepEqual(opsState.channel_log.map((l) => [l.to, l.status]), [['m:u-ops', 'no_contact']], 'no phone → logged, no number anywhere');
  assert.equal(JSON.stringify(out.state).includes('0100000000'), false, 'no phone number in the state');
  // the same tick again with the state → nothing new (sent today, once-only, weekly sent)
  const again = plan({ now: '2026-11-08T08:30:00.000Z', cairo: { day: '2026-11-08', time: '10:30' }, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: out.state, acted: new Set() });
  assert.deepEqual([again.alerts.length, again.external.length], [0, 0]);
  // tomorrow at the clock time: the daily «لحد ما يتحل» one repeats; the once-only (unconf, team.req) and the weekly do not
  const tmrw = plan({ now: '2026-11-09T07:00:00.000Z', cairo: { day: '2026-11-09', time: '09:00' }, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: out.state, acted: new Set() });
  assert.deepEqual([...new Set(tmrw.alerts.map((x) => x.source_key))].sort(), ['customers.late']);
  assert.equal(tmrw.state.find((s) => s.source_key === 'customers.late' && s.target === 'role:cs').sent_count, 2);
  // the WhatsApp cap: two sends to a member today, the third is capped
  const many = [1, 2, 3].map((i) => ({ key: 'customers.late', entityId: String(2000 + i), title: 'IB-' + i }));
  const capped = plan({ now: NOW, cairo: CAIRO, notif: NOTIF, roles: ROLES, members: MEMBERS.filter((m) => m.id === 'u-cs'), items: many, state: [], acted: new Set() });
  assert.equal(capped.external.filter((x) => x.to.member === 'u-cs').length, 2);
  assert.equal(capped.state.flatMap((s) => s.channel_log).filter((l) => l.status === 'capped').length, 1);
});

test('plan: the quiet hours hold the external channels only; the escalation after the time with no action, once; a read is an action; resolution', () => {
  const items = [{ key: 'customers.unconf', entityId: '1002', title: 'IB-1002 غير مؤكد' }, { key: 'customers.late', entityId: '1001', title: 'IB-1001' }];
  const night = plan({ now: '2026-11-08T21:30:00.000Z', cairo: { day: '2026-11-08', time: '23:30' }, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: [], acted: new Set() });
  assert.equal(night.alerts.length, 6, 'the bell rows go out'); assert.equal(night.external.length, 0, 'held');
  assert.equal(night.state.find((s) => s.target === 'role:cs' && s.source_key === 'customers.late').channel_log.every((l) => l.status === 'held'), true);
  // 25 hours later nobody read the unconfirmed alert → escalation to cs (the rule) once; the late order has no rule
  const later = '2026-11-09T22:30:00.000Z'; const cairo = { day: '2026-11-10', time: '00:30' };
  const esc = plan({ now: later, cairo, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: night.state, acted: new Set() });
  const escRows = esc.alerts.filter((a) => a.source_key === 'customers.unconf.esc');
  assert.equal(escRows.length, 1); assert.deepEqual([escRows[0].role_id, escRows[0].title], ['cs', 'تصعيد: IB-1002 غير مؤكد']); assert.match(escRows[0].body, /من غير إجراء من 25 ساعة/);
  assert.equal(esc.state.filter((s) => s.source_key === 'customers.unconf').every((s) => s.escalated_at === later), true);
  assert.equal(esc.alerts.filter((a) => a.source_key === 'customers.late.esc').length, 0);
  const esc2 = plan({ now: '2026-11-10T02:00:00.000Z', cairo: { day: '2026-11-10', time: '04:00' }, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: esc.state, acted: new Set() });
  assert.equal(esc2.alerts.filter((a) => a.source_key.endsWith('.esc')).length, 0, 'escalated once');
  // a read on the alert is an action → no escalation
  const read = plan({ now: later, cairo, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: night.state, acted: new Set(['customers.unconf|1002']) });
  assert.equal(read.alerts.filter((a) => a.source_key.endsWith('.esc')).length, 0);
  // the entity gone → resolved; back again → a fresh first send
  const gone = plan({ now: later, cairo, notif: NOTIF, roles: ROLES, members: MEMBERS, items: [items[1]], state: esc.state, acted: new Set() });
  assert.deepEqual([...new Set(gone.resolved.map((r) => r.entity_id))], ['1002']); assert.equal(gone.state.filter((s) => s.entity_id === '1002').every((s) => s.resolved_at === later), true);
  const back = plan({ now: '2026-11-11T08:00:00.000Z', cairo: { day: '2026-11-11', time: '10:00' }, notif: NOTIF, roles: ROLES, members: MEMBERS, items, state: gone.state, acted: new Set() });
  const b = back.state.find((s) => s.entity_id === '1002' && s.target === 'role:cs'); assert.deepEqual([b.sent_count, b.resolved_at, b.escalated_at, b.first_at], [1, null, null, '2026-11-11T08:00:00.000Z']);
});

test('digests: the role summary at its hour once a day with the sources it receives; a custom report to roles / members on its cadence', () => {
  const items = [{ key: 'customers.late', entityId: '1' }, { key: 'customers.late', entityId: '2' }, { key: 'accounts.payroll', entityId: 'p' }, { key: 'team.req', entityId: 'r' }];
  const notif = { ...NOTIF, roleDigests: { ops: false }, roleDigestAt: { cs: '10:00 ص' }, digests: [{ id: 'd1', name: 'تقرير المرتبات', keys: ['accounts.payroll'], to: ['حسابات', 'سارة'], every: 'يوميًا', at: '10:00 ص', ch: 'إيميل', on: true }] };
  const out = digestPlan({ now: NOW, notif, roles: ROLES, members: MEMBERS, cairo: CAIRO, items, sentToday: new Set() });
  const role = out.filter((a) => a.source_key.startsWith('digest:role:'));
  assert.deepEqual(role.map((a) => a.role_id).sort(), ['admin', 'cs'], 'the admin at the default 9 (within its window at 10), cs at its own 10:00; ops off; roles without active members skipped');
  const cs = role.find((a) => a.role_id === 'cs'); assert.deepEqual([cs.title, cs.body, cs.kind, cs.entity_id, cs.email], ['الملخص اليومي — خدمة العملاء · 2 مهمة', 'أوردر متأخر — محتاج متابعة مع العميل 2', 'digest', 'digest:role:cs:2026-11-08', true]);
  assert.match(role.find((a) => a.role_id === 'admin').title, /4 مهمة/);
  const custom = out.filter((a) => a.source_key === 'digest:d1');
  assert.deepEqual(custom.map((a) => a.role_id || a.user_id).sort(), ['accounts', 'u-cs']); assert.deepEqual([custom[0].title, custom[0].email, custom[0].whatsapp], ['تقرير المرتبات · 1 مهمة', true, false]);
  assert.equal(digestPlan({ now: NOW, notif, roles: ROLES, members: MEMBERS, cairo: CAIRO, items, sentToday: new Set(['digest:role:cs', 'digest:d1']) }).map((a) => a.source_key).join(), 'digest:role:admin');
  assert.equal(digestPlan({ now: NOW, notif, roles: ROLES, members: MEMBERS, cairo: { day: '2026-11-08', time: '08:00' }, items, sentToday: new Set() }).length, 0, 'before the hours');
  assert.equal(digestPlan({ now: NOW, notif, roles: ROLES, members: MEMBERS, cairo: { day: '2026-11-08', time: '13:00' }, items, sentToday: new Set() }).length, 0, 'the window passed (a tick never comes back to it)');
  const weekly = { ...notif, digests: [{ id: 'w', name: 'أسبوعي', keys: ['customers.late'], to: ['أدمن'], every: 'أسبوعيًا', weekday: 'الأحد', at: '10:00 ص', ch: 'داخل السيستم' }] };
  assert.equal(digestPlan({ now: NOW, notif: weekly, roles: ROLES, members: MEMBERS, cairo: CAIRO, items, sentToday: new Set() }).filter((a) => a.source_key === 'digest:w').length, 1, 'Sunday');
  assert.equal(digestPlan({ now: NOW, notif: weekly, roles: ROLES, members: MEMBERS, cairo: { day: '2026-11-09', time: '10:00' }, items, sentToday: new Set() }).filter((a) => a.source_key === 'digest:w').length, 0, 'Monday');
});
