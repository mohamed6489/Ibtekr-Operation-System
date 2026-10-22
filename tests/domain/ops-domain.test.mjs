import { test } from 'node:test'; import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
const O = loadUmd(new URL('../../app/js/blocks/12-ops-domain.js', import.meta.url));
test('AUTH constants match the spec', () => assert.deepEqual(O.AUTH, { maxTries: 5, lockMinutes: 15, idleMinutes: 480, warnSeconds: 60, linkMinutes: 30, inviteDays: 7, rememberDays: 30 }));
test('5 failures lock for 15 minutes', () => { let a = O.loginInit(); for (let i = 0; i < 5; i++) a = O.loginFail(a, 0); assert.equal(O.isLocked(a, 14 * 60 * 1000), true); assert.equal(O.isLocked(a, 15 * 60 * 1000 + 1), false); });
test('identifierKind: email, 11-digit phone, arabic digits, junk', () => { assert.equal(O.identifierKind('a@b.co'), 'email'); assert.equal(O.identifierKind('01012345678'), 'phone'); assert.equal(O.identifierKind(O.toLatin('٠١٠١٢٣٤٥٦٧٨')), 'phone'); assert.equal(O.identifierKind('abc'), null); });
test('idleState thresholds', () => { assert.equal(O.idleState(0), 'active'); assert.equal(O.idleState(28800 - 30), 'warn'); assert.equal(O.idleState(28800), 'expired'); });
