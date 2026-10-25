import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { stubClient } from './stub-supabase.mjs';
// auth.js against a stub IBSupabase: a SIGNED_OUT (supabase-js relays one from another tab to the listeners only) removes the
// stored session from both storages before the IBAuth.onChange listeners run, so the reload they start finds nothing to sign
// back in with — a duplicated tab (remember-me off) holds its own copy in sessionStorage.
const src = readFileSync(new URL('../../app/js/adapter/auth.js', import.meta.url), 'utf8');
function memoryStorage(state) {
  const m = new Map(); const guard = () => { if (state.blocked) throw new Error('SecurityError: storage blocked'); };
  return { getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { guard(); m.set(k, String(v)); }, removeItem: (k) => { guard(); m.delete(k); } };
}
const AR = '٠١٢٣٤٥٦٧٨٩';
function load({ responses = {}, twofa = false } = {}) {
  const stub = stubClient({ responses }); const state = { blocked: false };
  const localStorage = memoryStorage(state); const sessionStorage = memoryStorage(state);
  // the directory's signed-in row and member card (same objects the pages read), the kit's event log, ib:* events
  const meRow = { id: 'u2', member_code: 'M02', name: 'سارة أحمد', twofa }; const members = [{ id: 'M01', twofa: false }, { id: 'M02', twofa }];
  const logs = []; const events = [];
  const window = { IBSupabase: { client: stub.client, recoveryHint: false },
    IbtekrOps: { toLatin: (x) => String(x).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))) },
    IBDirectory: { me: () => meRow, members: () => members },
    IBKit: { logEvent: (action, detail) => { logs.push([action, detail]); return Promise.resolve(); } } };
  const document = { dispatchEvent(e) { events.push(e.type); return true; } };
  runInNewContext(src, { window, document, Event, localStorage, sessionStorage, location: { origin: 'http://localhost:4173', pathname: '/', hash: '' }, setTimeout });
  const key = stub.client.auth.storageKey;
  localStorage.setItem(key, '{"access_token":"remembered"}'); sessionStorage.setItem(key, '{"access_token":"this-tab"}'); localStorage.setItem('ib.remember', '0');
  // mfa.* and rpc calls in order, as [op, args]
  const mfaCalls = () => stub.calls.filter((c) => c.op === 'rpc' || c.op.startsWith('mfa.')).map((c) => [c.op, ...c.args]);
  return { A: window.IBAuth, emitAuth: stub.emitAuth, key, localStorage, sessionStorage, state, responses, meRow, members, logs, events, mfaCalls };
}
// load() + an aal1 session of u2 (as after the password step)
async function signedIn(opts) {
  const t = load(opts); await t.A.ready();
  t.emitAuth('SIGNED_IN', { access_token: 'aal1-token', user: { id: 'u2' } });
  return t;
}

test('a SIGNED_OUT removes the stored session from both storages before the listeners run', async () => {
  const { A, emitAuth, key, localStorage, sessionStorage } = load();
  await A.ready();
  const seen = [];
  A.onChange((event) => { seen.push([event, localStorage.getItem(key), sessionStorage.getItem(key)]); });
  emitAuth('SIGNED_OUT', null);
  assert.deepEqual(seen, [['SIGNED_OUT', null, null]]);
  assert.equal(localStorage.getItem('ib.remember'), '0'); // only the session key goes
  assert.equal(A.session(), null);
});

test('any other auth event leaves the stored session alone', async () => {
  const { A, emitAuth, key, localStorage, sessionStorage } = load();
  await A.ready();
  const s = { access_token: 't2', user: { id: 'u1' } };
  emitAuth('TOKEN_REFRESHED', s);
  assert.equal(localStorage.getItem(key), '{"access_token":"remembered"}');
  assert.equal(sessionStorage.getItem(key), '{"access_token":"this-tab"}');
  assert.equal(A.session(), s);
});

test('blocked storage: the SIGNED_OUT still reaches every listener', async () => {
  const { A, emitAuth, state } = load();
  await A.ready();
  const seen = [];
  A.onChange((event) => { seen.push(event); });
  state.blocked = true;
  assert.doesNotThrow(() => emitAuth('SIGNED_OUT', null));
  assert.deepEqual(seen, ['SIGNED_OUT']);
  assert.equal(A.session(), null);
});

// ---------------------------------------------------------------- 2FA enrolment («ملفي»), phase 2 Task 7

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><path d="M0 0h2v2H0z" fill="#000"/></svg>';
const enrolled = { data: { id: 'f-new', type: 'totp', friendly_name: 'Authenticator', totp: { qr_code: 'data:image/svg+xml;utf-8,' + SVG, secret: 'MOCKTOTPSECRET', uri: 'otpauth://totp/Ibtekr:ops?secret=MOCKTOTPSECRET' } }, error: null };
const NO_FACTORS = { data: { all: [], totp: [] }, error: null };

test('enrollTotp: removes an unfinished TOTP enrolment, enrolls «Authenticator», returns an encoded QR, the key and the uri', async () => {
  const { A, mfaCalls } = await signedIn({ responses: {
    'mfa:listFactors': { data: { all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }, { id: 'ph', factor_type: 'phone', status: 'unverified' }, { id: 'v', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'v' }] }, error: null },
    'mfa:enroll': enrolled } });
  const r = await A.enrollTotp();
  assert.deepEqual({ ...r }, { ok: true, factorId: 'f-new', qr: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVG), secret: 'MOCKTOTPSECRET', uri: 'otpauth://totp/Ibtekr:ops?secret=MOCKTOTPSECRET' });
  assert.ok(!r.qr.includes('#'), 'the raw SVG is percent-encoded');
  assert.deepEqual(mfaCalls(), [['mfa.listFactors'], ['mfa.unenroll', { factorId: 'old' }], ['mfa.enroll', { factorType: 'totp', friendlyName: 'Authenticator' }]]);
});

test('enrollTotp: only a data:image QR is handed to the page (a base64 one as is, anything else → \'\')', async () => {
  for (const [qr, want] of [['data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo='], ['javascript:alert(1)', ''], ['https://evil.example/qr.svg', ''], [null, '']]) {
    const { A } = await signedIn({ responses: { 'mfa:listFactors': NO_FACTORS, 'mfa:enroll': { data: { id: 'f', type: 'totp', totp: { qr_code: qr, secret: 'K', uri: 'u' } }, error: null } } });
    assert.equal((await A.enrollTotp()).qr, want, String(qr));
  }
});

test('enrollTotp: signed out → network, nothing asked; a refused enroll → server, an unanswered one → network', async () => {
  const out = load(); await out.A.ready();
  assert.deepEqual({ ...(await out.A.enrollTotp()) }, { ok: false, reason: 'network' });
  assert.deepEqual(out.mfaCalls(), []);
  const refused = await signedIn({ responses: { 'mfa:listFactors': NO_FACTORS, 'mfa:enroll': { data: null, error: { status: 422, message: 'factor name conflict' } } } });
  assert.deepEqual({ ...(await refused.A.enrollTotp()) }, { ok: false, reason: 'server' });
  const offline = await signedIn({ responses: { 'mfa:listFactors': { data: null, error: { status: 0, message: 'Failed to fetch' } } } });
  assert.deepEqual({ ...(await offline.A.enrollTotp()) }, { ok: false, reason: 'network' });
  assert.deepEqual(offline.mfaCalls(), [['mfa.listFactors']]);
});

test('verifyEnroll: challengeAndVerify with the code (Arabic digits read), then mark_twofa_enrolled; the directory follows, the log has no code', async () => {
  const { A, mfaCalls, meRow, members, logs, events } = await signedIn();
  assert.deepEqual({ ...(await A.verifyEnroll('f-new', ' ١٢٣٤٥٦ ')) }, { ok: true });
  assert.deepEqual(mfaCalls(), [['mfa.challengeAndVerify', { factorId: 'f-new', code: '123456' }], ['rpc', 'mark_twofa_enrolled', null]]);
  assert.equal(meRow.twofa, true);
  assert.deepEqual(members.map((m) => m.twofa), [false, true]); // M02's card only
  assert.ok(events.includes('ib:directory'));
  assert.deepEqual(logs, [['profile.2fa.enable', 'Authenticator']]);
});

test('verifyEnroll: a wrong code → code (no server flag, nothing changes); not six digits → code without a request', async () => {
  const wrong = await signedIn({ responses: { 'mfa:challengeAndVerify': { data: null, error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } } } });
  assert.deepEqual({ ...(await wrong.A.verifyEnroll('f-new', '000000')) }, { ok: false, reason: 'code' });
  assert.deepEqual(wrong.mfaCalls(), [['mfa.challengeAndVerify', { factorId: 'f-new', code: '000000' }]]);
  assert.equal(wrong.meRow.twofa, false); assert.deepEqual(wrong.logs, []);
  const short = await signedIn();
  for (const code of ['12345', '1234567', 'abcdef', '', null]) assert.deepEqual({ ...(await short.A.verifyEnroll('f-new', code)) }, { ok: false, reason: 'code' }, String(code));
  assert.deepEqual(short.mfaCalls(), []);
  const offline = await signedIn({ responses: { 'mfa:challengeAndVerify': { data: null, error: { status: 0, message: 'Failed to fetch' } } } });
  assert.deepEqual({ ...(await offline.A.verifyEnroll('f-new', '123456')) }, { ok: false, reason: 'network' });
});

test('verifyEnroll: the server refuses the flag → the factor is removed again, reason server, twofa unchanged', async () => {
  const { A, mfaCalls, meRow, logs } = await signedIn({ responses: { 'rpc:mark_twofa_enrolled': { data: null, error: { code: '42501', message: 'aal2_required' } } } });
  assert.deepEqual({ ...(await A.verifyEnroll('f-new', '123456')) }, { ok: false, reason: 'server' });
  assert.deepEqual(mfaCalls(), [['mfa.challengeAndVerify', { factorId: 'f-new', code: '123456' }], ['rpc', 'mark_twofa_enrolled', null], ['mfa.unenroll', { factorId: 'f-new' }]]);
  assert.equal(meRow.twofa, false); assert.deepEqual(logs, []);
});

const AAL = (currentLevel) => ({ data: { currentLevel, nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null });
const VERIFIED = { data: { all: [{ id: 'f1', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] }, error: null };

test('unenrollTotp on an aal1 session → aal1, before any server call', async () => {
  const { A, mfaCalls, meRow, logs } = await signedIn({ twofa: true, responses: { 'mfa:getAuthenticatorAssuranceLevel': AAL('aal1') } });
  assert.deepEqual({ ...(await A.unenrollTotp()) }, { ok: false, reason: 'aal1' });
  assert.deepEqual(mfaCalls(), [['mfa.getAuthenticatorAssuranceLevel']]);
  assert.equal(meRow.twofa, true); assert.deepEqual(logs, []);
});

test('unenrollTotp on aal2: mark_twofa_disabled first, then the verified factor goes; the directory follows', async () => {
  const { A, mfaCalls, meRow, members, logs } = await signedIn({ twofa: true, responses: { 'mfa:getAuthenticatorAssuranceLevel': AAL('aal2'), 'mfa:listFactors': VERIFIED } });
  assert.deepEqual({ ...(await A.unenrollTotp()) }, { ok: true });
  assert.deepEqual(mfaCalls(), [['mfa.getAuthenticatorAssuranceLevel'], ['mfa.listFactors'], ['rpc', 'mark_twofa_disabled', null], ['mfa.unenroll', { factorId: 'f1' }]]);
  assert.equal(meRow.twofa, false); assert.deepEqual(members.map((m) => m.twofa), [false, false]);
  assert.deepEqual(logs, [['profile.2fa.disable', 'Authenticator']]);
});

test('unenrollTotp: the server says aal2_required → aal1; another refusal → server; the factor stays either way', async () => {
  for (const [error, reason] of [[{ code: '42501', message: 'aal2_required' }, 'aal1'], [{ code: 'PGRST000', message: 'down' }, 'server']]) {
    const { A, mfaCalls, meRow } = await signedIn({ twofa: true, responses: { 'mfa:getAuthenticatorAssuranceLevel': AAL('aal2'), 'mfa:listFactors': VERIFIED, 'rpc:mark_twofa_disabled': { data: null, error } } });
    assert.deepEqual({ ...(await A.unenrollTotp()) }, { ok: false, reason });
    assert.ok(!mfaCalls().some((c) => c[0] === 'mfa.unenroll'));
    assert.equal(meRow.twofa, true);
  }
});

test('unenrollTotp: a factor that will not go puts the flag back (mark_twofa_enrolled) and nothing changes here', async () => {
  const { A, mfaCalls, meRow, logs } = await signedIn({ twofa: true, responses: { 'mfa:getAuthenticatorAssuranceLevel': AAL('aal2'), 'mfa:listFactors': VERIFIED, 'mfa:unenroll': { data: null, error: { status: 403, code: 'insufficient_aal' } } } });
  assert.deepEqual({ ...(await A.unenrollTotp()) }, { ok: false, reason: 'server' });
  assert.deepEqual(mfaCalls().slice(2), [['rpc', 'mark_twofa_disabled', null], ['mfa.unenroll', { factorId: 'f1' }], ['rpc', 'mark_twofa_enrolled', null]]);
  assert.equal(meRow.twofa, true); assert.deepEqual(logs, []);
});
