import { test } from 'node:test'; import assert from 'node:assert/strict';
import { phoneOfWaId, waIdOfPhone, waAuthUrl, EXTRAS, wabaIdsOf, phonesOf, textOf, parseWaWebhook, textBody, sentIdOf, syncBody, STATE_PREFIX } from '../../supabase/functions/_shared/cs-whatsapp.js';
// WhatsApp 1 on the Cloud API by coexistence (phase 6, decision 26): the pure part of cs-whatsapp.

const WABA = '1029384756'; const PHONE = '5566778899';
const env = (field, value) => ({ object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '201000000001', phone_number_id: PHONE }, ...value } }] }] });

test('the phone of a wa_id and back: Egypt local ↔ international, a foreign number keeps its digits', () => {
  assert.equal(phoneOfWaId('201012345678'), '01012345678');
  assert.equal(phoneOfWaId('966501234567'), '966501234567');
  assert.equal(phoneOfWaId('12'), null);
  assert.equal(waIdOfPhone('01012345678'), '201012345678');
  assert.equal(waIdOfPhone('966501234567'), '966501234567');
  assert.equal(waIdOfPhone('abc'), null);
});

test('the Embedded Signup dialog: config_id, code, the WhatsApp Business app option; the state prefix routes the callback', () => {
  const u = new URL(waAuthUrl('1234567890', 'https://x.example/meta-callback.html', STATE_PREFIX + 'abc', '998877'));
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v25.0/dialog/oauth');
  assert.equal(u.searchParams.get('config_id'), '998877');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('override_default_response_type'), 'true');
  assert.deepEqual(JSON.parse(u.searchParams.get('extras')), EXTRAS);
  assert.equal(EXTRAS.featureType, 'whatsapp_business_app_onboarding');
  assert.equal(EXTRAS.version, 'v4', 'v2 / v3 are deprecated');
  assert.ok(u.searchParams.get('state').startsWith('wa_'));
});

test('the WABA from debug_token and its numbers (the coexistence one first)', () => {
  assert.deepEqual(wabaIdsOf({ data: { granular_scopes: [{ scope: 'business_management', target_ids: ['111111'] }, { scope: 'whatsapp_business_management', target_ids: [WABA, 'x'] }, { scope: 'whatsapp_business_messaging', target_ids: [WABA] }] } }), [WABA]);
  assert.deepEqual(wabaIdsOf({}), []);
  const p = phonesOf({ data: [{ id: '111222', display_phone_number: '+20 10 1', is_on_biz_app: false }, { id: PHONE, display_phone_number: '+20 100 000 0001', verified_name: 'Ibtekr', is_on_biz_app: true, platform_type: 'CLOUD_API' }, { id: 'bad' }] });
  assert.deepEqual(p.map((x) => x.id), [PHONE, '111222']);
  assert.equal(p[0].biz_app, true);
});

test('a message\'s text: the text, the media as a label + caption, the location, a button reply; reactions / edits are not messages', () => {
  assert.equal(textOf({ type: 'text', text: { body: ' أهلا ' } }), 'أهلا');
  assert.equal(textOf({ type: 'image', image: { caption: 'ده المقاس' } }), '[صورة] ده المقاس');
  assert.equal(textOf({ type: 'audio', audio: { voice: true } }), '[فويس]');
  assert.equal(textOf({ type: 'document', document: { filename: 'invoice.pdf' } }), '[ملف] invoice.pdf');
  assert.equal(textOf({ type: 'location', location: { name: 'المعادي' } }), '[موقع] المعادي');
  assert.equal(textOf({ type: 'interactive', interactive: { button_reply: { title: 'أيوه' } } }), 'أيوه');
  assert.equal(textOf({ type: 'reaction', reaction: { emoji: '👍' } }), null);
  assert.equal(textOf({ type: 'edit' }), null);
  assert.equal(textOf({ type: 'weird' }), '[رسالة مش مدعومة]');
  assert.equal(Array.from(textOf({ type: 'text', text: { body: 'x'.repeat(5000) } })).length, 4000);
});

test('the webhook: a customer\'s message with the profile name, a status of ours, an echo from the phone', () => {
  const m = parseWaWebhook(env('messages', { contacts: [{ wa_id: '201012345678', profile: { name: 'منى' } }], messages: [{ from: '201012345678', id: 'wamid.AAA', timestamp: '1762250000', type: 'text', text: { body: 'السلام عليكم' }, context: { id: 'wamid.ZZZ' } }, { from: '201012345678', id: 'wamid.R', type: 'reaction', reaction: {} }], statuses: [{ id: 'wamid.OUT', status: 'failed', timestamp: '1762250001', recipient_id: '201012345678', errors: [{ code: 131047 }] }, { id: 'wamid.OUT2', status: 'deleted' }] }));
  assert.equal(m.entries[0].id, WABA); assert.equal(m.entries[0].phoneId, PHONE);
  const [inn, react, st] = m.entries[0].events;
  assert.deepEqual(inn, { type: 'in', waId: '201012345678', name: 'منى', id: 'wamid.AAA', at: 1762250000000, text: 'السلام عليكم', kind: 'text', replyTo: 'wamid.ZZZ', media: null });
  assert.deepEqual(react, { type: 'other', field: 'messages_reaction' });
  assert.deepEqual(st, { type: 'status', id: 'wamid.OUT', status: 'failed', at: 1762250001000, waId: '201012345678', error: 'wa_131047' });
  assert.equal(m.entries[0].events.length, 3, 'an unknown status is dropped');
  const e = parseWaWebhook(env('smb_message_echoes', { message_echoes: [{ from: '201000000001', to: '201012345678', id: 'wamid.E', timestamp: '1762250100', type: 'text', text: { body: 'تمام' } }] }));
  assert.deepEqual(e.entries[0].events[0], { type: 'echo', waId: '201012345678', id: 'wamid.E', at: 1762250100000, text: 'تمام', kind: 'text' });
});

test('the history: the progress, each past message in or out with its original time; a declined share is an error code', () => {
  const h = parseWaWebhook(env('history', { history: [{ metadata: { phase: 1, chunk_order: 2, progress: 40 }, threads: [{ id: '201012345678', messages: [{ from: '201012345678', id: 'wamid.H1', timestamp: '1750000000', type: 'text', text: { body: 'عندكم مقاس كبير؟' } }, { from: '201000000001', to: '201012345678', id: 'wamid.H2', timestamp: '1750000060', type: 'image', image: {} }] }] }] }));
  const ev = h.entries[0].events;
  assert.deepEqual(ev[0], { type: 'history_meta', phase: 1, chunk: 2, progress: 40 });
  assert.deepEqual([ev[1].type, ev[1].out, ev[1].text, ev[1].at], ['history', false, 'عندكم مقاس كبير؟', 1750000000000]);
  assert.deepEqual([ev[2].type, ev[2].out, ev[2].text, ev[2].waId], ['history', true, '[صورة]', '201012345678']);
  const d = parseWaWebhook(env('history', { history: [{ errors: [{ code: 2593109, title: 'declined' }] }] }));
  assert.deepEqual(d.entries[0].events[0], { type: 'history_meta', error: 'wa_2593109' });
});

test('the contacts sync, another field, another object', () => {
  const c = parseWaWebhook(env('smb_app_state_sync', { state_sync: [{ type: 'contact', contact: { full_name: 'أحمد علي', phone_number: '+20 101 234 5678' }, action: 'add', metadata: { timestamp: '1' } }] }));
  assert.deepEqual(c.entries[0].events[0], { type: 'contact', waId: '201012345678', name: 'أحمد علي', action: 'add' });
  assert.deepEqual(parseWaWebhook(env('account_update', {})).entries[0].events[0], { type: 'other', field: 'account_update' });
  assert.equal(parseWaWebhook({ object: 'page', entry: [] }), null);
});

test('the send body and its answer; the sync bodies', () => {
  assert.deepEqual(textBody('201012345678', 'أهلا'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '201012345678', type: 'text', text: { preview_url: false, body: 'أهلا' } });
  assert.equal(sentIdOf({ messages: [{ id: 'wamid.S' }] }), 'wamid.S');
  assert.equal(sentIdOf({}), null);
  assert.deepEqual(syncBody('history'), { messaging_product: 'whatsapp', sync_type: 'history' });
  assert.deepEqual(syncBody('contacts'), { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' });
});

// phase 13 T3 (decision 6): our attachment by a signed link; the media id of a customer's media message
import { MEDIA_MIME, mediaBody, mediaOf } from '../../supabase/functions/_shared/cs-whatsapp.js';
test('mediaBody: an image with its caption, a PDF as a document with its filename; mediaOf keeps the id and mime of an incoming media', () => {
  assert.deepEqual(mediaBody('201012345678', { type: 'image/jpeg', name: 'a.jpg' }, 'https://s.test/x?token=1', 'شوفي دي'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '201012345678', type: 'image', image: { link: 'https://s.test/x?token=1', caption: 'شوفي دي' } });
  assert.deepEqual(mediaBody('201012345678', { type: 'application/pdf', name: 'فاتورة.pdf' }, 'https://s.test/y', ''), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '201012345678', type: 'document', document: { link: 'https://s.test/y', filename: 'فاتورة.pdf' } });
  assert.equal(Object.keys(MEDIA_MIME).length, 5);
  assert.deepEqual(mediaOf({ type: 'image', image: { id: '1234567890', mime_type: 'image/jpeg', sha256: 'x' } }), { media_id: '1234567890', mime: 'image/jpeg', kind: 'image' });
  assert.deepEqual(mediaOf({ type: 'document', document: { id: '99999', mime_type: 'application/pdf', filename: 'a.pdf' } }), { media_id: '99999', mime: 'application/pdf', kind: 'document' });
  assert.equal(mediaOf({ type: 'text', text: { body: 'x' } }), null); assert.equal(mediaOf({ type: 'image', image: { id: 'bad id' } }), null);
});
