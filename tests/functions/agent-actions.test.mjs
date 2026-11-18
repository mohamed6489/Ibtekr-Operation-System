// Decision 7 / T7 in the agents-brain plan (the owner 17 Nov — «بتاع خدمة العملاء يحضر رد تلقائي للعميل لو اتاخرنا في الرد»): the
// customer-service assistant writes a ready reply for a conversation waiting past the SLA; the bell opens it with the reply in the box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CS_LATE_MAX, DRAFT_MARK, csLateNotes, firstName, lateReply, waitLabel } from '../../supabase/functions/_shared/agent-actions.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const C = (o) => ({ id: id(1), seg: 'customers', status: 'مستنية ردنا', handle: 'عميل واتساب', platform: 'whatsapp', customer_id: 'c1', waiting_since: ago(90), snoozed_until: null, ...o });

test('late conversations only: customers, waiting for us past the SLA, not snoozed ahead; oldest first; one ref per wait', () => {
  const rows = [
    C({ id: id(1), waiting_since: ago(90) }),
    C({ id: id(2), waiting_since: ago(30) }), // within the SLA
    C({ id: id(3), waiting_since: ago(3000), customer_id: 'c3' }),
    C({ id: id(4), status: 'مستنية العميل' }),
    C({ id: id(5), seg: 'comments' }),
    C({ id: id(6), snoozed_until: new Date(NOW + 3_600_000).toISOString() }),
    C({ id: 'not-a-uuid' }),
  ];
  const n = csLateNotes(rows, { c1: 'منى أحمد', c3: '<b>كريم</b>' }, NOW, 60);
  assert.deepEqual(n.map((x) => x.link), ['cs/' + id(3), 'cs/' + id(1)]);
  assert.equal(n[0].agent, 'cs'); assert.equal(n[0].kind, 'alert');
  assert.equal(n[1].ref, 'cs-late:' + id(1) + ':' + ago(90).slice(0, 19));
  assert.match(n[1].title, /^رد جاهز لـ «منى أحمد» — مستني ردنا من 90 دقيقة$/);
  assert.doesNotMatch(n[0].title + n[0].body, /[<>]/);
  assert.match(n[1].body, new RegExp(DRAFT_MARK + '\\nأهلًا يا منى'));
  assert.match(n[0].body, /حقك علينا/); // a day or more: the longer apology
  assert.match(n[1].body, /على واتساب/);
  assert.equal(csLateNotes(Array.from({ length: 30 }, (_, i) => C({ id: id(i + 10) })), {}, NOW, 60).length, CS_LATE_MAX);
});

test('the reply: the first name, or a plain greeting for a placeholder handle; never a send', () => {
  assert.equal(firstName('منى أحمد'), 'منى'); assert.equal(firstName('عميل ماسنجر'), ''); assert.equal(firstName('زائر فيسبوك'), '');
  assert.match(lateReply('عميل إنستجرام', 10), /^أهلًا بيك/);
  assert.equal(waitLabel(45), '45 دقيقة'); assert.equal(waitLabel(150), '2 ساعة'); assert.equal(waitLabel(3000), 'يومين'); assert.equal(waitLabel(6000), '4 أيام');
});

test('the bell reads the reply after the same mark (alerts.js)', () => {
  const src = readFileSync(new URL('../../app/js/adapter/alerts.js', import.meta.url), 'utf8');
  assert.ok(src.includes("const DRAFT_MARK = '" + DRAFT_MARK + "'"));
});
