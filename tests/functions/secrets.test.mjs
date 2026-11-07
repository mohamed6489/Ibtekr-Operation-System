import test from 'node:test'; import assert from 'node:assert/strict';
import { vaultEnv, secretOf, secretSet, tailOf, withVault } from '../../supabase/functions/_shared/secrets.js';
const db = (rpc) => ({ rpc });
test('vaultEnv overlays the Vault map over the env and ignores empties / errors', async () => {
  assert.deepEqual(await vaultEnv(db(async () => ({ data: { WOO_URL: 'https://live', OPENAI_API_KEY: ' ' }, error: null })), { WOO_URL: 'https://stage', X: '1' }), { WOO_URL: 'https://live', X: '1' });
  assert.deepEqual(await vaultEnv(db(async () => ({ data: null, error: { code: '0A000' } })), { A: '1' }), { A: '1' });
  assert.deepEqual(await vaultEnv(db(async () => { throw new Error('x'); }), { A: '1' }), { A: '1' });
  const d = await withVault({ db: db(async () => ({ data: { K: 'v' } })), env: { A: '1' }, other: 2 });
  assert.deepEqual(d.env, { A: '1', K: 'v' }); assert.equal(d.other, 2);
});
test('secretOf parses the JSON object only; secretSet maps the codes', async () => {
  assert.deepEqual(await secretOf(db(async () => ({ data: '{"key":"k"}' })), 'openai'), { key: 'k' });
  assert.equal(await secretOf(db(async () => ({ data: '[1]' })), 'openai'), null);
  assert.equal(await secretOf(db(async () => ({ data: null })), 'openai'), null);
  assert.deepEqual(await secretSet(db(async () => ({ error: null })), 'openai', { key: 'k' }), { ok: true });
  assert.deepEqual(await secretSet(db(async () => ({ error: { code: '0A000' } })), 'openai', null), { ok: false, error: 'no_vault' });
  assert.deepEqual(await secretSet(db(async () => ({ error: { code: '22023' } })), 'zzz', {}), { ok: false, error: 'unknown_secret' });
  assert.equal(tailOf('sk-abcdefgh1234'), '••••1234'); assert.equal(tailOf('abc'), '••••'); assert.equal(tailOf(''), '');
});
