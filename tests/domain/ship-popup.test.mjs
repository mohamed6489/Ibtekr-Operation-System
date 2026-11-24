import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
// The meeting of 23 Nov [#15] — «تم الشحن» (app/js/pages/ship-popup.js): the shapes of each way, and which of them move money.
const W = {}; runInNewContext(readFileSync(new URL('../../app/js/pages/ship-popup.js', import.meta.url), 'utf8'), { window: W, setTimeout });
const S = W.IBShip;
const keys = (o) => Object.keys(o).sort().join(',');

test('[#15] to the warehouse: a ride needs its app, its amount and the account; Bosta its pickup amount; the maker / our courier nothing', () => {
  assert.equal(keys(S.validate({ leg: 'warehouse', method: '' })), 'method');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'ride', app: '', amount: '' })), 'account,amount,app');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'ride', app: 'أوبر', amount: '80', account: 'حساب البنك' })), '');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'ride', app: '<b>', amount: '80', account: 'x' })), 'app');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'bosta', amount: '' })), 'account,amount');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'maker' })), '');
  assert.equal(keys(S.validate({ leg: 'warehouse', method: 'courier' })), '');
  assert.equal(S.money({ leg: 'warehouse', method: 'ride' }), true, 'on the maker as «مواصلات»');
  assert.equal(S.money({ leg: 'warehouse', method: 'bosta' }), true, 'the pickup asked every time (Safwat)');
  assert.equal(S.money({ leg: 'warehouse', method: 'maker' }), false);
  assert.equal(S.RIDE_APP, 'أوبر', 'the default app');
});

test('[#15] to the customer: Bosta is recorded only; a ride asks who pays — the company is an expense, the customer is the order\'s', () => {
  assert.equal(keys(S.validate({ leg: 'customer', method: 'bosta' })), '');
  assert.equal(S.money({ leg: 'customer', method: 'bosta' }), false);
  assert.equal(keys(S.validate({ leg: 'customer', method: 'ride', app: 'أوبر', amount: '60' })), 'payer');
  assert.equal(keys(S.validate({ leg: 'customer', method: 'ride', app: 'أوبر', amount: '60', payer: 'company' })), 'account');
  assert.equal(keys(S.validate({ leg: 'customer', method: 'ride', app: 'أوبر', amount: '60', payer: 'customer' })), '', 'no account: no money moves');
  assert.equal(S.money({ leg: 'customer', method: 'ride', payer: 'company' }), true);
  assert.equal(S.money({ leg: 'customer', method: 'ride', payer: 'customer' }), false);
});
