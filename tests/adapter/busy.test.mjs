import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
// busy.js (the owner, 11 Nov — «اي اكشن ف السيستم بيتعمله تحميل … يظهرلي popup notification يعرفني اي اللي بيحصل»): the label of each
// Edge Function action, the calls that never show a pill, and the wrapping of supabase-js's prototypes — a pill only for a call the
// member started, after the delay, one per label for calls in flight together, none while a page shows its own, the answer untouched.
const src = readFileSync(new URL('../../app/js/adapter/busy.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load({ busyCount = null } = {}) {
  const listeners = {}; const pills = [];
  const document = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  class FC { constructor(answer) { this.answer = answer; } invoke(name, opts) { return wait(30).then(() => ({ data: { fn: name, action: opts && opts.body && opts.body.action }, error: null })); } }
  class FileApi { upload(path) { return wait(30).then(() => ({ data: { path }, error: null })); } }
  const client = { get functions() { return new FC(); }, storage: { from: () => new FileApi() } };
  const IBKit = { busy: (text) => { const p = { text, closed: false, sets: 0, close() { p.closed = true; }, set() { p.sets += 1; } }; pills.push(p); return p; } };
  if (busyCount) IBKit.busyCount = busyCount; else IBKit.busyCount = () => pills.filter((p) => !p.closed).length;
  const window = { IBSupabase: { client }, IBKit };
  runInNewContext(src, { window, document, Date, Promise, setTimeout, clearTimeout, Object, Map, Set, Math, Number, String });
  const gesture = () => (listeners.click || []).forEach((fn) => fn({}));
  return { B: window.IBBusy, client, pills, gesture, window };
}

test('labelOf: the line for each action, a default per function, nothing for the status reads, the polls and the chat panels', () => {
  const { B } = load();
  assert.equal(B.labelOf('woo-sync', { action: 'withdraw_create' }), 'بنعمل طلب السحب على Dokan…');
  assert.equal(B.labelOf('woo-sync', { action: 'withdraw_approve' }), 'بنوافق على طلب السحب على Dokan…');
  assert.equal(B.labelOf('woo-sync', { action: 'push_status' }), 'بنحدّث حالة الأوردر على الموقع…');
  assert.equal(B.labelOf('woo-sync', { action: 'something_new' }), 'بنكلّم الموقع…');
  assert.equal(B.labelOf('ai-images', { action: 'generate' }), 'بنعمل الصورة…');
  assert.equal(B.labelOf('team-admin', { action: 'member_create' }), 'بنعمل حساب العضو…');
  assert.equal(B.labelOf('mkt-publish', { action: 'publish_now' }), 'بننشر البوست…');
  for (const [fn, action] of [['cs-channel', 'status'], ['cs-wa', 'wa_status'], ['ai-images', 'bridge_status'], ['ai-images', 'video_poll'], ['ai-content', 'assistant'], ['ai-content', 'buyer']]) {
    assert.equal(B.labelOf(fn, { action }), null, fn + ' ' + action + ' shows nothing');
  }
  assert.equal(B.labelOf('unknown-fn', { action: 'x' }), null);
  assert.equal(B.labelOf('woo-sync', null), 'بنكلّم الموقع…');
});

test('the wrap: a call the member started shows one pill after the delay and closes it; the answer passes through; a background call shows none', async () => {
  const { B, client, pills, gesture } = load();
  assert.deepEqual({ ...B.wrapped }, { functions: true, storage: true });
  B.setDelay(0);
  // background (no gesture): no pill
  const bg = await client.functions.invoke('woo-sync', { body: { action: 'withdrawals' } });
  assert.deepEqual({ ...bg.data }, { fn: 'woo-sync', action: 'withdrawals' });
  assert.equal(pills.length, 0);
  await wait(2600); // past the gesture window and the chain after the last call
  // the member clicks: a pill with the action's line, closed once answered
  gesture();
  const r = await client.functions.invoke('woo-sync', { body: { action: 'withdraw_create', vendor_id: 'v' } });
  assert.deepEqual({ ...r.data }, { fn: 'woo-sync', action: 'withdraw_create' }, 'the answer is untouched');
  assert.deepEqual(pills.map((p) => p.text), ['بنعمل طلب السحب على Dokan…']);
  await wait(350);
  assert.equal(pills[0].closed, true);
  // several calls in flight under one label share one pill; an upload has its own
  gesture();
  await Promise.all([client.functions.invoke('woo-sync', { body: { action: 'products_batch' } }), client.functions.invoke('woo-sync', { body: { action: 'products_batch' } }), client.storage.from('studio').upload('a/b.png', 'x')]);
  assert.deepEqual(pills.slice(1).map((p) => p.text).sort(), ['بنحدّث المنتجات على الموقع…', 'بنرفع الملف…'].sort());
  // a status read never shows one, even right after a click
  gesture();
  await client.functions.invoke('cs-channel', { body: { action: 'status' } });
  assert.equal(pills.length, 3);
});

test('a quick answer shows nothing (the delay); a page showing its own pill keeps the automatic one away', async () => {
  const { B, client, pills, gesture } = load();
  B.setDelay(200);
  gesture();
  await client.functions.invoke('woo-sync', { body: { action: 'push_status' } }); // answered in 30 ms
  await wait(250);
  assert.equal(pills.length, 0, 'answered before the delay');
  const own = load({ busyCount: () => 1 }); // the page's own pill is running
  own.B.setDelay(0); own.gesture();
  await own.client.functions.invoke('woo-sync', { body: { action: 'withdraw_create' } });
  assert.equal(own.pills.length, 0);
});

test('a call joining a shown pill keeps it alive (one pill, refreshed) — a long batch is never left without its pill', async () => {
  const { B, client, pills, gesture } = load();
  B.setDelay(0); gesture();
  const first = client.functions.invoke('woo-sync', { body: { action: 'studio_upload', index: 0 } });
  await wait(10); // the pill is shown
  assert.equal(pills.length, 1);
  const second = client.functions.invoke('woo-sync', { body: { action: 'studio_upload', index: 1 } });
  await Promise.all([first, second]);
  assert.equal(pills.length, 1, 'still one pill');
  assert.equal(pills[0].sets, 1, 'refreshed by the call that joined it');
  await wait(350);
  assert.equal(pills[0].closed, true);
});
