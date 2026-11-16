// deno-lint-ignore-file no-explicit-any
// share-mail handler tests (the owner 16 Nov — «الايميل يتبعت من السيستم»): an active member only; one plain address; the file of
// its kind by its first bytes and ≤ 8 MB; the html escaped; reply-to the member; 30 an hour; the log has the kind only.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handler, mailHtml, mailInput, PER_HOUR } from './index.ts';
import { NOW, fakeDb } from '../_test/fakes.ts';

const ME = '00000000-0000-4000-8000-0000000000a1';
const OFF = '00000000-0000-4000-8000-0000000000a2';
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const XLSX = b64([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
const PDF = b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
function setup(opts: { key?: boolean; status?: number; log?: any[]; logFails?: boolean } = {}) {
  const db = fakeDb({ profiles: [{ id: ME, name: 'صفوت', email: 'owner@ibtekr.club', status: 'active' }, { id: OFF, name: 'موقوف', email: 'off@ibtekr.club', status: 'inactive' }], activity_log: opts.log ?? [] });
  const sent: any[] = [];
  const deps = { env: opts.key === false ? {} : { RESEND_API_KEY: 're_test' }, db, now: () => NOW,
    userId: async (jwt: string) => (jwt === 'jwt-me' ? ME : jwt === 'jwt-off' ? OFF : null),
    // the member's own client: 0002's trigger stamps actor = auth.uid() and at = now(), whatever was passed
    userDb: (jwt: string) => ({ from: (t: string) => ({ insert: async (row: any) => (opts.logFails ? { error: { code: '42501', message: 'rls' } } : db.from(t).insert({ ...row, actor: jwt === 'jwt-me' ? ME : null, at: NOW })) }) }),
    fetch: (async (url: string, init: any) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response('{}', { status: opts.status ?? 200 }); }) as any };
  return { db, sent, deps };
}
const call = (deps: any, body: any, jwt = 'jwt-me') => handler(new Request('http://x/share-mail', { method: 'POST', headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps).then(async (r) => ({ res: r, body: await r.json() }));
const GOOD = { to: 'Maker@Example.com', subject: 'تقرير مختصر — Kemet', text: 'تقرير مختصر — Kemet\nصافي الرصيد: 0.00 ج.م', file: { name: 'تقرير Kemet.xlsx', kind: 'xlsx', data: XLSX } };

Deno.test('share-mail: an active member sends one mail with the file to the address typed, reply-to himself; the log keeps the kind only', async () => {
  const { db, sent, deps } = setup();
  const { res, body } = await call(deps, GOOD);
  assertEquals([res.status, body], [200, { ok: true }]);
  assertEquals(sent.length, 1);
  const m = sent[0].body;
  assertEquals([sent[0].url, sent[0].auth, m.to, m.reply_to, m.subject], ['https://api.resend.com/emails', 'Bearer re_test', ['maker@example.com'], 'owner@ibtekr.club', 'تقرير مختصر — Kemet']);
  assertEquals(m.attachments, [{ filename: 'تقرير Kemet.xlsx', content: XLSX }]);
  assert(m.html.includes('white-space:pre-line') && m.html.includes('صافي الرصيد: 0.00 ج.م'));
  const log = db.rows('activity_log');
  assertEquals(log.map((r: any) => [r.actor, r.action, r.entity_id, r.new_value]), [[ME, 'share.email', 'xlsx', null]]);
  assertFalse(JSON.stringify(log).includes('example.com'), 'never the address');
  // a PDF, and a mail with no file
  assertEquals((await call(deps, { ...GOOD, file: { name: 'x', kind: 'pdf', data: PDF } })).body, { ok: true });
  assertEquals(sent.at(-1).body.attachments[0].filename, 'x.pdf');
  assertEquals((await call(deps, { to: 'a@b.co', subject: 'لينك', text: 'https://x.y' })).body, { ok: true });
  assertEquals(sent.at(-1).body.attachments, undefined);
  assertEquals(db.rows('activity_log').map((r: any) => [r.actor, r.entity_id]), [[ME, 'xlsx'], [ME, 'pdf'], [ME, 'text']], 'each try under the member, written before the send');
});

Deno.test('share-mail: no JWT / a stranger / a suspended member → 401; a bad address, subject, file kind or bytes → 400 before Resend', async () => {
  const { sent, deps } = setup();
  assertEquals((await call(deps, GOOD, 'nope')).res.status, 401);
  assertEquals((await call(deps, GOOD, 'jwt-off')).res.status, 401);
  for (const to of ['', 'a', 'a@b', 'a@b.c', 'x@y.com,z@w.com', 'x@y.com; z@w.com', '<x@y.com>', 'x y@z.com']) assertEquals((await call(deps, { ...GOOD, to })).body.field, 'to', to);
  assertEquals((await call(deps, { ...GOOD, subject: '' })).body.field, 'subject');
  assertEquals((await call(deps, { ...GOOD, file: { name: 'a', kind: 'exe', data: XLSX } })).body.field, 'file');
  assertEquals((await call(deps, { ...GOOD, file: { name: 'a', kind: 'pdf', data: XLSX } })).body.field, 'file', 'a zip named pdf');
  assertEquals((await call(deps, { ...GOOD, file: { name: 'a', kind: 'xlsx', data: 'not base64!' } })).body.field, 'file');
  assertEquals((await call(deps, { ...GOOD, file: { name: 'a', kind: 'xlsx', data: 'A'.repeat(12 * 1024 * 1024) } })).body.field, 'file', 'too big');
  assertEquals(sent.length, 0);
});

Deno.test('share-mail: no Resend → 503; Resend refuses → 502 and nothing logged; 30 an hour → 429', async () => {
  const none = setup({ key: false });
  assertEquals([(await call(none.deps, GOOD)).res.status, none.sent.length], [503, 0]);
  const refused = setup({ status: 422 });
  const r = await call(refused.deps, GOOD);
  assertEquals([r.res.status, r.body.error, refused.db.rows('activity_log').length], [502, 'refused', 1], 'a try counts');
  const at = new Date(Date.parse(NOW) - 600_000).toISOString();
  const full = setup({ log: Array.from({ length: PER_HOUR }, (_, i) => ({ id: i + 1, at, actor: ME, action: 'share.email', entity: 'share', entity_id: 'pdf' })) });
  assertEquals([(await call(full.deps, GOOD)).res.status, full.sent.length], [429, 0]);
  // the hour's limit counts every try, one after the other: 30 go, the 31st does not
  const run = setup();
  for (let i = 0; i < PER_HOUR; i++) assertEquals((await call(run.deps, GOOD)).res.status, 200, 'try ' + (i + 1));
  assertEquals([(await call(run.deps, GOOD)).res.status, run.sent.length], [429, PER_HOUR]);
  // a try that cannot be written is not sent (fail closed)
  const closed = setup({ logFails: true });
  assertEquals([(await call(closed.deps, GOOD)).res.status, closed.sent.length], [503, 0]);
});

Deno.test('share-mail: mailInput cleans the subject and text (no < >), keeps the lines; mailHtml escapes', () => {
  const v = mailInput({ to: 'a@b.co', subject: '<b>x</b>', text: 'سطر 1\r\nسطر <2>\n\n\n\nسطر 3' }) as any;
  assert(v.ok); assertEquals(v.v.subject, 'b x /b'); assertEquals(v.v.text, 'سطر 1\nسطر 2\n\nسطر 3');
  assert(mailHtml('a & "b"', 'c', 'د').includes('a &amp; &quot;b&quot;'));
});
