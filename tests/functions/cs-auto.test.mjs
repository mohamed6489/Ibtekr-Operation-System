// The pure auto-reply engine (phase 6.5): the settings over their defaults, Cairo's hours, the events out of our tables, the
// conditions and the rules, the variables, the text-or-template choice by the 24-hour window, what to do with a fired rule,
// the silent follow-ups. No I/O.
import test from 'node:test'; import assert from 'node:assert/strict';
import { DEFAULTS, STATUS_CODES, afterHoursEntity, cairoClock, cartEvents, condOk, decide, dueAfter, entityFor, failCode, fill, guestCartEvents, inHours, nextOpenAt, orderEvents, paceGap, ruleFires, sendMode, settingsOf, silentFollowups, statusTo, subEvents, templateBody, templateVars, transferEvents, varsFor, windowOpen, withOptOut } from '../../supabase/functions/_shared/cs-auto.js';

// Sunday 8 Nov 2026 — Cairo is UTC+2 in November: 08:00Z = 10:00 Cairo
const NOW = Date.parse('2026-11-08T08:00:00Z');
const NIGHT = Date.parse('2026-11-08T21:30:00Z'); // 23:30 Cairo
const LIVE = settingsOf({ live: true });

test('settingsOf: the defaults, the admin row over them, bad numbers ignored', () => {
  assert.deepEqual(settingsOf(null), { ...DEFAULTS, hours: { from: 9, to: 22 }, daily: { wa1: 250, wa2: 150 }, cart: { afterMin: 60 } });
  const s = settingsOf({ live: true, hours: { from: 10, to: 23 }, delayMin: 5, delayMax: 30, daily: { wa1: 300, wa2: 'x' }, afterHoursText: ' نرد بكرة ', cart: { afterMin: 120 }, waLang: 'ar_EG' });
  assert.equal(s.live, true); assert.deepEqual(s.hours, { from: 10, to: 23 }); assert.equal(s.delayMin, 20, 'under 20 s is refused (block 19 validateDelay)'); assert.equal(s.delayMax, 30);
  assert.deepEqual(s.daily, { wa1: 300, wa2: 150 }); assert.equal(s.afterHoursText, 'نرد بكرة'); assert.equal(s.cart.afterMin, 120); assert.equal(s.waLang, 'ar_EG');
  assert.equal(settingsOf({ live: 'yes' }).live, false, 'live is a real boolean only');
});

test('Cairo clock, the hours, the next opening', () => {
  assert.deepEqual([cairoClock(NOW).day, cairoClock(NOW).hour], ['2026-11-08', 10]);
  assert.equal(inHours(LIVE, NOW), true); assert.equal(inHours(LIVE, NIGHT), false);
  assert.equal(nextOpenAt(LIVE, NIGHT), '2026-11-09T07:00:00.000Z', 'tomorrow 9:00 Cairo');
  assert.equal(nextOpenAt(LIVE, Date.parse('2026-11-08T05:00:00Z')), '2026-11-08T07:00:00.000Z', 'today 9:00 Cairo when it is 7:00');
  const wrap = settingsOf({ hours: { from: 22, to: 2 } });
  assert.equal(inHours(wrap, NIGHT), true); assert.equal(inHours(wrap, NOW), false);
});

test('the 24-hour window', () => {
  assert.equal(windowOpen('2026-11-07T09:00:00Z', NOW), true);
  assert.equal(windowOpen('2026-11-07T07:59:00Z', NOW), false);
  assert.equal(windowOpen(null, NOW), false);
});

test('orderEvents: a changed status since the tick, the at-risk and late orders by their days since the confirmation (none while not confirmed), deleted and cart orders left out', () => {
  const orders = [
    { id: 1, status: 'جاهز للشحن', updated_at: '2026-11-08T07:50:00Z', placed_at: '2026-11-05T10:00:00Z' },
    { id: 2, status: 'جاري التنفيذ', confirm: 'مؤكد بعربون', confirm_at: '2026-10-29', updated_at: '2026-11-01T07:50:00Z', placed_at: '2026-10-20T10:00:00Z' }, // 10 days from the confirmation → at risk (decision 52)
    { id: 3, status: 'جاري التنفيذ', confirm: 'مؤكد بدون عربون', confirm_at: null, updated_at: '2026-11-01T07:50:00Z', placed_at: '2026-10-20T10:00:00Z' }, // confirmed, no date: 19 days from the order → late
    { id: 6, status: 'جاري التنفيذ', confirm: 'غير مؤكد', updated_at: '2026-11-01T07:50:00Z', placed_at: '2026-09-01T10:00:00Z' }, // not confirmed: never late
    { id: 4, status: 'مكتمل', updated_at: '2026-11-08T07:55:00Z', placed_at: '2026-10-20T10:00:00Z', deleted_at: '2026-11-08T07:56:00Z' },
    { id: 5, status: 'قيد الانتظار', updated_at: '2026-11-08T07:55:00Z', placed_at: '2026-11-08T06:00:00Z' },
  ];
  const ev = orderEvents(orders, { sinceIso: '2026-11-08T07:45:00Z', today: '2026-11-08' });
  assert.deepEqual(ev.map((e) => [e.entity, e.to, e.suffix]), [['order:1', 'جاهز للشحن', 's2'], ['order:2', 'قابل للتأخير', 'risk'], ['order:3', 'متأخر', 'late']]);
  assert.equal(STATUS_CODES[2], 'جاهز للشحن');
  assert.equal(orderEvents(orders, { sinceIso: null, today: '2026-11-08' }).length, 6, 'no since = every non-cart order changes (the unconfirmed one: its status only)');
});

test('cartEvents: pending / failed older than afterMin, unless the same number ordered again after', () => {
  const orders = [
    { id: 10, status: 'قيد الانتظار', customer_phone: '01012345678', placed_at: '2026-11-08T06:00:00Z' }, // 2 h → cart
    { id: 11, status: 'فشل', customer_phone: '01099999999', placed_at: '2026-11-08T06:00:00Z' },
    { id: 12, status: 'جاري التنفيذ', customer_phone: '+20 109 999 9999', placed_at: '2026-11-08T07:00:00Z' }, // the same number ordered after → 11 is not abandoned
    { id: 13, status: 'قيد الانتظار', customer_phone: '01055555555', placed_at: '2026-11-08T07:30:00Z' }, // 30 min → not yet
    { id: 14, status: 'قيد الانتظار', customer_phone: null, placed_at: '2026-11-07T06:00:00Z', deleted_at: '2026-11-08T00:00:00Z' },
  ];
  assert.deepEqual(cartEvents(orders, { nowMs: NOW, afterMin: 60 }).map((e) => e.entity), ['cart:10']);
  assert.deepEqual(cartEvents(orders, { nowMs: NOW, afterMin: 20 }).map((e) => e.entity), ['cart:10', 'cart:13']);
});

test('guestCartEvents (phase 12 T7): a normal, not unsubscribed cart with a phone, older than afterMin, and no order from that number after it; the variables take the cart\'s name, total and recovery link', () => {
  const carts = [
    { cart_id: 7, phone: '+201012345678', name: 'نهى عبد الرحمن', total: 1250, status: 'normal', unsubscribed: false, url: 'https://staging.ibtekr.club/checkout/?wcf_ac_token=a', site_updated_at: '2026-11-08T06:00:00Z' }, // 2 h → cart
    { cart_id: 8, phone: '01099999999', status: 'normal', unsubscribed: false, site_updated_at: '2026-11-08T06:00:00Z' }, // ordered after → not a guest cart
    { cart_id: 9, phone: '01055555555', status: 'normal', unsubscribed: false, site_updated_at: '2026-11-08T07:30:00Z' }, // 30 min → not yet
    { cart_id: 10, phone: '', email: 'x@y.test', status: 'normal', unsubscribed: false, site_updated_at: '2026-11-08T06:00:00Z' }, // no phone: nothing to send to
    { cart_id: 11, phone: '01044444444', status: 'completed', unsubscribed: false, site_updated_at: '2026-11-08T06:00:00Z' },
    { cart_id: 12, phone: '01033333333', status: 'normal', unsubscribed: true, site_updated_at: '2026-11-08T06:00:00Z' },
    { cart_id: 6, phone: '0101 234 5678', name: 'نهى', total: 400, status: 'normal', unsubscribed: false, site_updated_at: '2026-11-08T05:00:00Z' }, // the same number's older cart: one event, the latest cart
  ];
  const orders = [{ id: 1, status: 'جاري التنفيذ', customer_phone: '+20 109 999 9999', placed_at: '2026-11-08T07:00:00Z' }];
  const ev = guestCartEvents(carts, orders, { nowMs: NOW, afterMin: 60 });
  assert.deepEqual(ev.map((e) => [e.type, e.entity, e.phone]), [['cart', 'cart:c7', '01012345678']], 'one event a number — the latest cart');
  assert.deepEqual(guestCartEvents(carts, orders, { nowMs: NOW, afterMin: 20 }).map((e) => e.entity), ['cart:c7', 'cart:c9']);
  const vars = varsFor(ev[0], { cartUrl: ev[0].cart.url });
  assert.deepEqual([vars['اسم_العميل'], vars['الإجمالي'], vars['رابط_السلة'], vars['رقم_الأوردر']], ['نهى', '1,250 ج.م', 'https://staging.ibtekr.club/checkout/?wcf_ac_token=a', '']);
  assert.deepEqual(guestCartEvents(null, null, { nowMs: NOW }), []);
});

test('subEvents / transferEvents: since the tick, approved only, with the maker', () => {
  assert.deepEqual(subEvents([{ id: 7, vendor_id: 'v1', updated_at: '2026-11-08T07:50:00Z' }, { id: 8, vendor_id: null, updated_at: '2026-11-08T07:50:00Z' }, { id: 9, vendor_id: 'v1', updated_at: '2026-11-07T07:50:00Z' }], '2026-11-08T07:45:00Z').map((e) => [e.entity, e.vendorId]), [['sub:7', 'v1']]);
  assert.deepEqual(transferEvents([{ id: 3, vendor_id: 'v1', status: 'approved', synced_at: '2026-11-08T07:50:00Z', amount: 1200 }, { id: 4, vendor_id: 'v1', status: 'pending', synced_at: '2026-11-08T07:50:00Z' }], '2026-11-08T07:45:00Z').map((e) => e.entity), ['transfer:3']);
});

test('condOk: the prototype operators; an unknown one never passes', () => {
  const ctx = { 'القناة': 'واتساب 1', 'الدفع': 'كاش', 'التقييم': 4, consents: ['auto'], has: ['تذكرة مفتوحة'] };
  assert.equal(condOk(['القناة', '=', 'واتساب 1'], ctx), true);
  assert.equal(condOk(['القناة', '!=', 'واتساب 1'], ctx), false);
  assert.equal(condOk(['التقييم', 'أكبر من أو يساوي', '3'], ctx), true);
  assert.equal(condOk(['التقييم', 'أقل من', '3'], ctx), false);
  assert.equal(condOk(['العميل', 'موافق على', 'الرد الآلي'], ctx), true);
  assert.equal(condOk(['العميل', 'موافق على', 'التسويق'], ctx), false);
  assert.equal(condOk(['الأوردر', 'مفيهوش', 'تذكرة مفتوحة'], ctx), false);
  assert.equal(condOk(['الأوردر', 'فيه', 'تذكرة مفتوحة'], ctx), true);
  assert.equal(condOk(['الدفع', 'is', 'كاش'], ctx), false);
  assert.equal(condOk('bad', ctx), false);
});

test('ruleFires + entityFor: the event, the status alias, the conditions, once vs every change', () => {
  const rule = { enabled: true, event: 'status', event_to: 'قيد التنفيذ', conds: [['القناة', '=', 'واتساب 1']], once: true };
  const ev = { type: 'status', to: 'جاري التنفيذ', entity: 'order:1', suffix: 's0' };
  assert.equal(statusTo('قيد التنفيذ'), 'جاري التنفيذ');
  assert.equal(ruleFires(rule, ev, { 'القناة': 'واتساب 1' }), true);
  assert.equal(ruleFires(rule, ev, { 'القناة': 'ماسنجر' }), false);
  assert.equal(ruleFires({ ...rule, enabled: false }, ev, { 'القناة': 'واتساب 1' }), false);
  assert.equal(ruleFires({ ...rule, event_to: 'مكتمل' }, ev, { 'القناة': 'واتساب 1' }), false);
  assert.equal(ruleFires({ enabled: true, event: 'first', conds: [] }, { type: 'first', entity: 'conv:a' }, {}), true);
  assert.equal(entityFor(rule, ev), 'order:1'); assert.equal(entityFor({ ...rule, once: false }, ev), 'order:1-s0');
});

test('the text: variables, filling, the missing ones, the opt-out line once', () => {
  assert.deepEqual(templateVars('أهلاً {اسم_العميل} أوردرك {رقم_الأوردر} {اسم_العميل}'), ['اسم_العميل', 'رقم_الأوردر']);
  const vars = varsFor({ type: 'status', order: { number: '177702', total: 1050.4, customer_name: 'نهى عبد الرحمن' } }, { trackingUrl: 'https://bosta.co/t/1' });
  assert.equal(vars['اسم_العميل'], 'نهى'); assert.equal(vars['رقم_الأوردر'], '177702'); assert.equal(vars['الإجمالي'], '1,050 ج.م'); assert.equal(vars['رابط_التتبع'], 'https://bosta.co/t/1'); assert.equal(vars['ميعاد_الشحن'], '');
  assert.deepEqual(fill('أوردرك {رقم_الأوردر} بإجمالي {الإجمالي} — {ميعاد_الشحن}', vars), { text: 'أوردرك 177702 بإجمالي 1,050 ج.م — {ميعاد_الشحن}', missing: ['ميعاد_الشحن'] });
  assert.equal(withOptOut('عرض').endsWith('اكتب «إيقاف» لو مش عايز رسايل عروض.'), true);
  assert.equal(withOptOut('عرض — اكتب إيقاف'), 'عرض — اكتب إيقاف');
});

test('sendMode: wa1 text in the window else the template; Messenger in the window only; wa2 always', () => {
  const tpl = { wa_template: 'order_confirmed_v1' };
  assert.equal(sendMode({ channel: 'wa1', lastInAt: '2026-11-08T07:00:00Z', template: tpl, nowMs: NOW }), 'text');
  assert.equal(sendMode({ channel: 'wa1', lastInAt: null, template: tpl, nowMs: NOW }), 'template');
  assert.equal(sendMode({ channel: 'wa1', lastInAt: null, template: {}, nowMs: NOW }), null);
  assert.equal(sendMode({ channel: 'messenger', lastInAt: '2026-11-08T07:00:00Z', template: tpl, nowMs: NOW }), 'text');
  assert.equal(sendMode({ channel: 'instagram', lastInAt: null, template: tpl, nowMs: NOW }), null);
  assert.equal(sendMode({ channel: 'wa2', lastInAt: null, template: {}, nowMs: NOW }), 'text');
  assert.deepEqual(templateBody('201012345678', 'order_confirmed_v1', 'ar', ['نهى', '177702']), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '201012345678', type: 'template',
    template: { name: 'order_confirmed_v1', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'نهى' }, { type: 'text', text: '177702' }] }] } });
  assert.deepEqual(templateBody('2', 'hello', 'ar', []).template.components, []);
});

test('decide: off, the actions, the consent and channel guards, the window, the cap, the hours, the delay, a send', () => {
  const tpl = { lib: 'customers', active: true, body: 'أهلاً {اسم_العميل} أوردرك {رقم_الأوردر}', wa_template: 'order_confirmed_v1', wa_vars: ['اسم_العميل', 'رقم_الأوردر'] };
  const rule = { action: 'send', delay_min: 0, once: true };
  const ev = { type: 'status', to: 'جاري التنفيذ', entity: 'order:1' };
  const vars = { 'اسم_العميل': 'نهى', 'رقم_الأوردر': '177702' };
  const base = { channel: 'wa1', lastInAt: '2026-11-08T07:00:00Z', customer: { autoConsent: true, consent: true }, vars, sentToday: 3, cap: 250 };
  assert.deepEqual(decide({ rule, template: tpl, ev, ctx: base, settings: settingsOf({}), nowMs: NOW }), { result: 'skipped', code: 'off' });
  assert.deepEqual(decide({ rule: { action: 'ticket' }, template: null, ev, ctx: base, settings: LIVE, nowMs: NOW }), { result: 'ticket', code: null });
  assert.deepEqual(decide({ rule: { action: 'assign' }, template: null, ev, ctx: base, settings: LIVE, nowMs: NOW }), { result: 'skipped', code: 'no_role' });
  assert.deepEqual(decide({ rule: { action: 'tag', tag: 'VIP' }, template: null, ev, ctx: base, settings: LIVE, nowMs: NOW }), { result: 'tagged', code: null });
  assert.equal(decide({ rule, template: null, ev, ctx: base, settings: LIVE, nowMs: NOW }).code, 'no_template');
  assert.equal(decide({ rule, template: { ...tpl, active: false }, ev, ctx: base, settings: LIVE, nowMs: NOW }).code, 'inactive');
  assert.equal(decide({ rule, template: tpl, ev, ctx: { ...base, customer: { blocked: true } }, settings: LIVE, nowMs: NOW }).code, 'blocked');
  assert.equal(decide({ rule, template: tpl, ev, ctx: { ...base, customer: { autoConsent: false } }, settings: LIVE, nowMs: NOW }).code, 'consent');
  assert.equal(decide({ rule, template: tpl, ev: { ...ev, type: 'cart' }, ctx: { ...base, customer: { autoConsent: true, consent: false } }, settings: LIVE, nowMs: NOW }).code, 'consent', 'a cart message needs the marketing consent too');
  assert.equal(decide({ rule, template: tpl, ev, ctx: { ...base, channel: 'wa2' }, settings: LIVE, nowMs: NOW }).code, 'channel', 'a customers template never goes on the makers number');
  assert.equal(decide({ rule, template: { ...tpl, lib: 'vendors' }, ev, ctx: base, settings: LIVE, nowMs: NOW }).code, 'channel', 'a makers template goes on wa2 only');
  assert.equal(decide({ rule, template: tpl, ev, ctx: { ...base, vars: { 'اسم_العميل': 'نهى' } }, settings: LIVE, nowMs: NOW }).code, 'missing_var');
  assert.equal(decide({ rule, template: { ...tpl, wa_template: null }, ev, ctx: { ...base, lastInAt: null }, settings: LIVE, nowMs: NOW }).code, 'window');
  const held = decide({ rule, template: tpl, ev, ctx: { ...base, sentToday: 250 }, settings: LIVE, nowMs: NOW });
  assert.deepEqual([held.result, held.code, held.dueAt], ['held', 'cap', '2026-11-09T07:00:00.000Z']);
  const night = decide({ rule, template: tpl, ev, ctx: base, settings: LIVE, nowMs: NIGHT });
  assert.deepEqual([night.result, night.code, night.dueAt], ['held', 'hours', '2026-11-09T07:00:00.000Z']);
  const later = decide({ rule: { ...rule, delay_min: 60 }, template: tpl, ev, ctx: base, settings: LIVE, nowMs: NOW });
  assert.deepEqual([later.result, later.code, later.dueAt], ['held', 'delay', '2026-11-08T09:00:00.000Z']);
  const now = decide({ rule, template: tpl, ev, ctx: base, settings: LIVE, nowMs: NOW });
  assert.deepEqual(now, { result: 'sent', code: 'text', text: 'أهلاً نهى أوردرك 177702', mode: 'text', params: [] });
  const viaTpl = decide({ rule, template: tpl, ev, ctx: { ...base, lastInAt: null }, settings: LIVE, nowMs: NOW });
  assert.deepEqual([viaTpl.mode, viaTpl.params], ['template', ['نهى', '177702']]);
  const cart = decide({ rule, template: { ...tpl, wa_template: null }, ev: { ...ev, type: 'cart' }, ctx: base, settings: LIVE, nowMs: NOW });
  assert.equal(cart.text.endsWith('اكتب «إيقاف» لو مش عايز رسايل عروض.'), true, 'a cart message carries the opt-out line');
  assert.equal(dueAfter({ delay_min: 5 }, LIVE, NOW), '2026-11-08T08:05:00.000Z');
  assert.equal(paceGap(LIVE, 0), 20_000); assert.equal(paceGap(LIVE, 1), 60_000);
});

test('silentFollowups: a sent run older than a day with no customer message after it, on a rule that asks for a ticket', () => {
  const rules = { r1: { id: 'r1', ticket_if_silent: true }, r2: { id: 'r2', ticket_if_silent: false } };
  const convs = { c1: { last_in_at: '2026-11-06T10:00:00Z' }, c2: { last_in_at: '2026-11-07T12:00:00Z' } };
  const runs = [
    { rule_id: 'r1', entity: 'order:1', result: 'sent', conversation_id: 'c1', at: '2026-11-07T06:00:00Z' }, // 26 h, no answer → ticket
    { rule_id: 'r1', entity: 'order:2', result: 'sent', conversation_id: 'c2', at: '2026-11-07T06:00:00Z' }, // answered after → no
    { rule_id: 'r1', entity: 'order:3', result: 'sent', conversation_id: 'c1', at: '2026-11-08T06:00:00Z' }, // 2 h → not yet
    { rule_id: 'r2', entity: 'order:4', result: 'sent', conversation_id: 'c1', at: '2026-11-07T06:00:00Z' }, // the rule does not ask
    { rule_id: 'r1', entity: 'order:5', result: 'held', conversation_id: 'c1', at: '2026-11-07T06:00:00Z' },
  ];
  assert.deepEqual(silentFollowups(runs, rules, convs, NOW).map((x) => x.entity), ['order:1-silent']);
  assert.equal(afterHoursEntity('3f2a', '2026-11-08'), 'conv:3f2a-20261108');
  assert.equal(failCode({ code: 'graph_timeout' }), 'graph_timeout'); assert.equal(failCode(new TypeError('x y')), 'typeerror'); assert.equal(failCode(null), 'failed');
});
