import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
// activity.js against a stub IBSupabase: only auth.* actions reach rpc('log_activity') until a page is wired to real data.
const src = readFileSync(new URL('../../app/js/adapter/activity.js', import.meta.url), 'utf8');
function load({ signedIn = true } = {}) {
  const calls = [];
  const client = { rpc: (fn, args) => { calls.push(JSON.parse(JSON.stringify({ fn, args }))); /* plain objects of this realm */ return Promise.resolve({ data: null, error: null }); } };
  const window = { IBSupabase: { client }, IBAuth: { session: () => (signedIn ? { access_token: 't' } : null) } };
  runInNewContext(src, { window });
  return { log: window.IBActivity.log, calls };
}

test('auth.signin is sent to log_activity', async () => {
  const { log, calls } = load();
  await log('auth.signin', 'صفوت كمال');
  assert.deepEqual(calls, [{ fn: 'log_activity', args: { action: 'auth.signin', entity: null, entity_id: null, old_value: null, new_value: 'صفوت كمال' } }]);
});

test('a demo-page action (hr.payroll.approve) is not sent', async () => {
  const { log, calls } = load();
  await log('hr.payroll.approve', { month: 10 });
  await log('shift.start', 'x');
  assert.deepEqual(calls, []);
});

test('nothing is sent while signed out', async () => {
  const { log, calls } = load({ signedIn: false });
  await log('auth.signout', 'يدوي');
  assert.deepEqual(calls, []);
});
