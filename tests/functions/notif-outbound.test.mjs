// The outbound channels of the admin's rules (Safwat 24 Nov — «الايميل ممكن تشغلوا و الواتساب … يبقا واقف علي تشغيل ال API»): a rule
// naming e-mail / WhatsApp sends one message per member and rule this tick, only while that channel's switch is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUT_MAX, outboundPlan } from '../../supabase/functions/_shared/notif-engine.js';

const R1 = { id: 'r1', name: 'أوردر غير مؤكد', channels: ['bell', 'email', 'whatsapp'], active: true };
const R2 = { id: 'r2', name: 'جرس بس', channels: ['bell'], active: true };
const row = (rule, user, title, body = '') => ({ rule_id: rule, user_id: user, title, body });

test('one message per member and rule, behind each switch; a bell-only rule sends nothing', () => {
  const inserts = [row('r1', 'a', 'IB-1 لسه ما اتأكدش', 'عمره يومين'), row('r1', 'a', 'IB-2 لسه ما اتأكدش'), row('r1', 'b', 'IB-1 لسه ما اتأكدش', 'عمره يومين'), row('r2', 'a', 'x')];
  const out = outboundPlan({ rules: [R1, R2], inserts, gates: { email: true, whatsapp: false } });
  assert.deepEqual(out.map((x) => [x.ch, x.member, x.rule, x.count]), [['email', 'a', 'r1', 2], ['email', 'b', 'r1', 1]]);
  assert.equal(out[0].title, 'أوردر غير مؤكد (2)'); assert.equal(out[0].body, 'IB-1 لسه ما اتأكدش · IB-2 لسه ما اتأكدش');
  assert.equal(out[1].title, 'IB-1 لسه ما اتأكدش'); assert.equal(out[1].body, 'عمره يومين');
  assert.deepEqual(outboundPlan({ rules: [R1], inserts, gates: {} }), [], 'both switches off = nothing');
  assert.deepEqual(outboundPlan({ rules: [R1, R2], inserts, gates: { email: true, whatsapp: true } }).map((x) => x.ch), ['email', 'whatsapp', 'email', 'whatsapp']);
  assert.deepEqual(outboundPlan({ rules: [{ ...R1, active: false }], inserts, gates: { email: true } }), [], 'a stopped rule sends nothing');
});

test('a long list is cut to eight lines and «وكمان N»; at most OUT_MAX messages a tick', () => {
  const many = Array.from({ length: 11 }, (_, i) => row('r1', 'a', 'IB-' + i));
  const [m] = outboundPlan({ rules: [R1], inserts: many, gates: { email: true } });
  assert.equal(m.count, 11); assert.match(m.body, / · وكمان 3$/);
  const lots = Array.from({ length: OUT_MAX + 20 }, (_, i) => row('r1', 'u' + i, 'x'));
  assert.equal(outboundPlan({ rules: [R1], inserts: lots, gates: { email: true } }).length, OUT_MAX);
});
