// Decision 5 in the agents-brain plan, «طريقة أ» (the owner 18 Nov — «المبرمج يكتشف المشكلة ويشرحها ويقولك الحل، والتصليح نفسه بيتعمل
// هنا معايا»): the developer's daily check turns the system's health into a note per problem, with its fix and a technical summary to
// copy to the Claude Code session; a problem gone loses its note, a source not read keeps its notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEV_MAX, DEV_PREFIX, SESSION_MARK, SPEED_MIN, devDue, devNotes, sessionOf } from '../../supabase/functions/_shared/dev-check.js';

const NOW = Date.parse('2026-11-18T08:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const empty = { now: NOW, crashes: [], sync: [], cron: { jobs: [], http: { failed: 0 } }, checks: {}, channels: [], ads: [] };
const run = (o) => devNotes({ ...empty, ...o });

test('the check runs once a day from 9 Cairo', () => {
  assert.equal(devDue({ day: '2026-11-18', time: '08:59' }, null), false);
  assert.equal(devDue({ day: '2026-11-18', time: '09:00' }, null), true);
  assert.equal(devDue({ day: '2026-11-18', time: '15:30' }, '2026-11-18'), false);
  assert.equal(devDue({ day: '2026-11-18', time: '09:15' }, '2026-11-17'), true);
});

test('a healthy system = no notes, nothing kept', () => {
  const r = run({});
  assert.deepEqual(r.notes, []); assert.deepEqual(r.refs, []); assert.deepEqual(r.keep, []);
});

test('the screen errors: one note per kind and place, with the count, the people and the code path', () => {
  const r = run({ crashes: [
    { at: ago(300), actor: 'a', new_value: { kind: 'TypeError', at: 'products-flow.js:812:9' } },
    { at: ago(30), actor: 'b', new_value: { kind: 'TypeError', at: 'products-flow.js:812:14' } },
    { at: ago(10), actor: 'a', new_value: { kind: 'blank', at: '' } },
  ] });
  assert.equal(r.notes.length, 2);
  const t = r.notes.find((n) => n.ref.includes('TypeError'));
  assert.equal(t.agent, 'dev'); assert.equal(t.kind, 'problem'); assert.equal(t.link, null);
  assert.ok(t.ref.startsWith(DEV_PREFIX + 'crash:'));
  assert.match(t.title, /products-flow\.js/); assert.match(t.title, /مرتين/);
  assert.match(t.body, /لـ 2 من الفريق/);
  assert.match(t.body, /انسخ للجلسة/);
  const tech = sessionOf(t.body);
  assert.match(tech, /TypeError at products-flow\.js:812 · 2x · 2 member/);
  assert.ok(r.notes.some((n) => /صفحة فضيت/.test(n.title)));
});

test('the sync: a failed write is a problem at once, a failed pull from 3; keys = an owner action, 5xx = the hosting', () => {
  const pull = (min, err) => ({ at: ago(min), kind: 'cron', direction: 'in', entity: 'order', action: 'sync', detail: { error: err } });
  let r = run({ sync: [pull(60, 'HTTP 502'), pull(30, 'HTTP 502')] });
  assert.equal(r.notes.length, 0, 'two failed pulls are not a problem yet');
  r = run({ sync: [pull(90, 'x'), pull(60, 'HTTP 401 woocommerce_rest_cannot_view'), pull(30, 'HTTP 401 woocommerce_rest_cannot_view')] });
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0].body, /مفاتيح الموقع/); assert.match(r.notes[0].body, /دي حاجة تعملها إنت: الإعدادات › الربط بالمنصات/);
  assert.doesNotMatch(r.notes[0].body, /محتاج تعديل في الكود/);
  r = run({ sync: [{ at: ago(5), kind: 'push', direction: 'out', entity: 'product', action: 'save', detail: { error: 'HTTP 400 rest_invalid_param', step: 'put' } }] });
  assert.equal(r.notes.length, 1); assert.match(r.notes[0].title, /كتابة على الموقع فشلت — المنتجات/);
  assert.match(r.notes[0].body, /محتاج تعديل في الكود/); assert.match(sessionOf(r.notes[0].body), /step put/);
});

test('the scheduled jobs and the scheduler calls', () => {
  const r = run({ cron: { jobs: [{ name: 'woo-sync-hourly', runs: 24, failed: 3, last_failed_at: ago(20), msg: 'ERROR: function x does not exist' }], http: { failed: 7, codes: { 500: 6, network: 1 }, msg: 'Timeout' } } });
  assert.equal(r.notes.length, 2);
  assert.ok(r.notes.some((n) => n.ref === DEV_PREFIX + 'cron:woo-sync-hourly' && /3 مرات/.test(n.title) && /3\/24/.test(sessionOf(n.body))));
  assert.ok(r.notes.some((n) => n.ref === DEV_PREFIX + 'http:functions' && /500×6/.test(n.body)));
  assert.equal(run({ cron: { jobs: [], http: { failed: 4 } } }).notes.length, 0, 'a few failed calls are noise');
});

test('the speed under the line and the WordPress updates are things the owner does', () => {
  const r = run({ checks: {
    pagespeed: { checked_at: ago(120), data: { score: SPEED_MIN - 12, pages: [{ kind: 'home', path: '/', mobile: { score: SPEED_MIN - 12, opps: [{ title: 'Reduce unused JavaScript', ms: 2100 }] } }] } },
    wp_updates: { checked_at: ago(200), data: { updates: 2, core: { update: false }, theme: null, plugins: [{ name: 'WooCommerce', version: '9.1', latest: '9.2', update: true }, { name: 'Dokan', version: '3.9', latest: '3.10', update: true }] } },
  } });
  assert.equal(r.notes.length, 2);
  const sp = r.notes.find((n) => n.ref === DEV_PREFIX + 'speed:mobile'); assert.match(sp.body, /Reduce unused JavaScript/); assert.match(sp.body, /دي حاجة تعملها إنت/);
  const wp = r.notes.find((n) => n.ref === DEV_PREFIX + 'wp:updates'); assert.equal(wp.kind, 'update'); assert.match(wp.body, /WooCommerce 9\.1 ← 9\.2/); assert.match(wp.body, /نسخة احتياطية/);
  assert.equal(run({ checks: { pagespeed: { data: { score: SPEED_MIN } } } }).notes.length, 0);
  assert.equal(run({ checks: { pagespeed: { data: { score: null } } } }).notes.length, 0, 'no answer is no score');
});

test('the links that fell: a channel in error, an ad account with an error or stopped', () => {
  const r = run({ channels: [{ id: 'messenger', name: 'ماسنجر', kind: 'meta', status: 'error' }, { id: 'wa1', name: 'واتساب 1', kind: 'meta', status: 'connected' }],
    ads: [{ platform: 'meta', id: '123', name: 'إبتكر', status: 'ACTIVE', meta: { error: 'token_expired', synced_at: ago(3000) } }, { platform: 'tiktok', id: '9', name: 'TT', status: 'DISABLED', meta: {} }, { platform: 'google', id: '5', status: 'ACTIVE', meta: {} }] });
  assert.equal(r.notes.length, 3);
  assert.ok(r.notes.some((n) => n.ref === DEV_PREFIX + 'link:messenger' && /اربط صفحة الفيسبوك تاني/.test(n.body)));
  assert.ok(r.notes.some((n) => /token_expired/.test(n.body) && /اربط الحساب تاني/.test(n.body)));
  assert.ok(r.notes.some((n) => /تيك توك: الحساب متوقف من المنصة/.test(n.title)));
});

test('a source not read keeps its notes; the worst first and DEV_MAX at most; the refs cover all', () => {
  const r = devNotes({ now: NOW, crashes: null, sync: null, cron: null, checks: null, channels: null, ads: null });
  assert.deepEqual(r.keep, ['dev:crash:', 'dev:sync:', 'dev:cron:', 'dev:http:', 'dev:speed:', 'dev:wp:', 'dev:link:', 'dev:ads:']);
  const many = Array.from({ length: 20 }, (_, i) => ({ at: ago(i + 1), actor: 'a', new_value: { kind: 'TypeError', at: 'f' + i + '.js:1:1' } }));
  const m = run({ crashes: many, cron: { jobs: [{ name: 'notify-tick', runs: 96, failed: 2 }] } });
  assert.equal(m.notes.length, DEV_MAX); assert.equal(m.refs.length, 21);
  assert.equal(m.notes[0].ref, DEV_PREFIX + 'cron:notify-tick', 'a failing job before one screen error');
});

test('a note fits ai_agent_notes: title ≤ 120 without <>, body ≤ 4000, the technical part after the mark', () => {
  const r = run({ crashes: [{ at: ago(1), actor: 'a', new_value: { kind: '<script>'.repeat(20), at: 'x'.repeat(300) + '.js:1:1' } }] });
  const n = r.notes[0];
  assert.ok(n.title.length <= 120 && !/[<>]/.test(n.title)); assert.ok(n.body.length <= 4000); assert.ok(n.ref.length <= 120);
  assert.equal(n.body.split(SESSION_MARK).length, 2);
  assert.equal(sessionOf('no mark'), '');
});

test('notify runs it after the other notes and clears the refs it did not write (0130)', () => {
  const src = readFileSync(new URL('../../supabase/functions/notify/index.ts', import.meta.url), 'utf8');
  assert.match(src, /devCheckNotes\(deps, ctx\)/);
  assert.match(src, /ai_agent_note_clear/);
  const sql = readFileSync(new URL('../../supabase/migrations/0130_dev_check.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke execute on function public\.dev_cron_health\(int\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.ai_agent_note_clear\(text, text, text\[\]\) from public, anon, authenticated/);
});

test('the chat\'s copy button reads the same mark', () => {
  const src = readFileSync(new URL('../../app/js/pages/marketing.js', import.meta.url), 'utf8');
  assert.match(src, new RegExp("const SESSION_MARK = '" + SESSION_MARK + "'"));
});
