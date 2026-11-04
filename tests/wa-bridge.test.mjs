import { test } from 'node:test'; import assert from 'node:assert/strict';
import { contentOf, inboundOf, receiptOf, phoneOfUser, api, nextCampaignDelay } from '../services/wa-bridge/src/logic.js';
// The wa-bridge service's pure part (phase 6.4): Baileys messages → cs-wa bodies, receipts, the API client, the campaign pacing.

test('a WhatsApp message → its text and kind (wrapped ones unwrapped; protocol messages dropped)', () => {
  assert.deepEqual(contentOf({ conversation: 'بكام؟' }), { kind: 'text', text: 'بكام؟' });
  assert.deepEqual(contentOf({ extendedTextMessage: { text: 'رد' } }), { kind: 'text', text: 'رد' });
  assert.deepEqual(contentOf({ imageMessage: { caption: 'ده' } }), { kind: 'image', text: 'ده' });
  assert.deepEqual(contentOf({ ephemeralMessage: { message: { conversation: 'مؤقتة' } } }), { kind: 'text', text: 'مؤقتة' });
  assert.deepEqual(contentOf({ audioMessage: {} }), { kind: 'audio', text: '' });
  assert.equal(contentOf({ protocolMessage: { type: 0 } }), null);
  assert.equal(contentOf({ reactionMessage: { text: '👍' } }), null);
});

test('inbound bodies: a person only (no groups / status), the push name on incoming only, the timestamp', () => {
  const b = inboundOf('wa1', { key: { remoteJid: '201012345678@s.whatsapp.net', id: '3EB0A1', fromMe: false }, pushName: 'نهى', messageTimestamp: 1762000000, message: { conversation: 'أهلا' } });
  assert.deepEqual(b, { action: 'inbound', channel: 'wa1', jid: '201012345678@s.whatsapp.net', id: '3EB0A1', fromMe: false, name: 'نهى', kind: 'text', text: 'أهلا', at: 1762000000 });
  assert.equal(inboundOf('wa1', { key: { remoteJid: '1203630@g.us', id: 'x' }, message: { conversation: 'x' } }), null);
  assert.equal(inboundOf('wa1', { key: { remoteJid: 'status@broadcast', id: 'x' }, message: { conversation: 'x' } }), null);
  assert.equal(inboundOf('wa2', { key: { remoteJid: '201012345678@s.whatsapp.net', id: 'x', fromMe: true }, pushName: 'me', message: { conversation: 'x' } }).name, null);
  assert.equal(inboundOf('wa2', { key: { remoteJid: '201012345678@s.whatsapp.net', id: 'x' }, messageTimestamp: { low: 1762000001, high: 0 }, message: { conversation: 'x' } }).at, 1762000001);
});

test('receipts and the linked number', () => {
  assert.equal(receiptOf(2), null); assert.equal(receiptOf(3), 'delivered'); assert.equal(receiptOf(4), 'read'); assert.equal(receiptOf(5), 'read');
  assert.equal(phoneOfUser('201012345678:12@s.whatsapp.net'), '201012345678');
});

test('the API client: https only, a 32+ secret, the secret in the header (never the body), errors carry the status', async () => {
  assert.throws(() => api({ url: 'http://evil.example', secret: 'x'.repeat(40) }));
  assert.throws(() => api({ url: 'https://p.supabase.co/functions/v1/cs-wa', secret: 'short' }));
  const calls = [];
  const call = api({ url: 'https://p.supabase.co/functions/v1/cs-wa', secret: 's'.repeat(40), fetch: async (u, o) => { calls.push(o); return { ok: o.body.includes('outbox'), status: o.body.includes('outbox') ? 200 : 401, json: async () => ({ items: [], error: 'unauthorized' }) }; } });
  assert.deepEqual(await call('outbox', { channel: 'wa1' }), { items: [], error: 'unauthorized' });
  assert.equal(calls[0].headers['x-bridge-secret'], 's'.repeat(40));
  assert.ok(!calls[0].body.includes('s'.repeat(40)));
  await assert.rejects(call('state', { channel: 'wa1' }), (e) => e.status === 401);
});

test('the campaign loop pause follows cs-wa (bounded)', () => {
  assert.equal(nextCampaignDelay({ items: [{}] }), 5000);
  assert.equal(nextCampaignDelay({ items: [], wait_ms: 500 }), 2000);
  assert.equal(nextCampaignDelay({ items: [], wait_ms: 999999 }), 60000);
  assert.equal(nextCampaignDelay({ items: [], wait_ms: 12000 }), 12000);
  assert.equal(nextCampaignDelay({ items: [] }), 15000);
});
