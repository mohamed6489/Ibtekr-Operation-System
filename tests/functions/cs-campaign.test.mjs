import { test } from 'node:test'; import assert from 'node:assert/strict';
import { MAX_PER_TICK, SAMPLE_VARS, campaignParams, campaignPreview, campaignStats, nextStatus, perTick, recipientAfter, templateOk } from '../../supabase/functions/_shared/cs-campaign.js';
// campaigns on WhatsApp 1 through Meta (phase 13 T1): the pure part of cs-whatsapp's campaign_tick

const TPL = { name: 'عرض الجمعة', body: 'أهلاً {اسم_العميل} 👋 خصم بكود {كود_الخصم} لحد الخميس.', wa_template: 'ibtekr_offer_v1', wa_vars: ['اسم_العميل', 'كود_الخصم'], active: true };

test('perTick: one a minute at least, three at most, by the campaign\'s pause', () => {
  assert.equal(perTick(20), 3); assert.equal(perTick(30), 2); assert.equal(perTick(45), 1); assert.equal(perTick(120), 1); assert.equal(perTick(0), MAX_PER_TICK);
});

test('campaignParams: wa_vars in order — the first name (or «عميلنا»), the code; an unknown variable is missing', () => {
  assert.deepEqual(campaignParams(TPL, { name: 'نهى عبد الرحمن', code: 'EID20' }), { params: ['نهى', 'EID20'], missing: [] });
  assert.deepEqual(campaignParams(TPL, { name: '', code: 'EID20' }), { params: ['عميلنا', 'EID20'], missing: [] });
  assert.deepEqual(campaignParams(TPL, { name: 'نهى' }), { params: ['نهى', ''], missing: ['كود_الخصم'] }, 'no code on the campaign');
  assert.deepEqual(campaignParams({ wa_vars: ['رقم_الأوردر'] }, { name: 'نهى' }), { params: [''], missing: ['رقم_الأوردر'] });
  assert.deepEqual(campaignParams({ wa_vars: [] }, {}), { params: [], missing: [] }); assert.deepEqual(campaignParams(null, {}), { params: [], missing: [] });
  assert.equal(Object.keys(SAMPLE_VARS).length, 2);
});

test('campaignPreview: the template body with the values (the message row\'s text); a bodyless template falls back to its name', () => {
  assert.equal(campaignPreview(TPL, { name: 'نهى عبد الرحمن', code: 'EID20' }), 'أهلاً نهى 👋 خصم بكود EID20 لحد الخميس.');
  assert.equal(campaignPreview(TPL, { name: '', code: 'EID20' }), 'أهلاً عميلنا 👋 خصم بكود EID20 لحد الخميس.');
  assert.equal(campaignPreview({ name: 'x', body: '' }, {}), 'x');
});

test('campaignStats + nextStatus: the bridge\'s shape; paused over 2% failures after 20 sends, finished with nothing queued', () => {
  const s = campaignStats(['sent', 'delivered', 'read', 'read', 'replied', 'failed', 'opted_out', 'queued', 'queued']);
  assert.deepEqual(s, { sent: 5, delivered: 4, read: 3, replies: 1, failed: 1, opted_out: 1, queued: 2 });
  assert.equal(nextStatus(s), null, 'under 20 sends: nothing decided');
  assert.equal(nextStatus(campaignStats(Array(25).fill('sent').concat(['queued']))), null);
  assert.equal(nextStatus(campaignStats(Array(25).fill('sent').concat(['failed', 'queued']))), 'متوقفة', '1/26 > 2%');
  assert.equal(nextStatus(campaignStats(Array(25).fill('sent'))), 'خلصت');
  assert.equal(nextStatus(campaignStats([])), 'خلصت', 'an empty audience finishes');
});

test('recipientAfter: forward only; a failure before read', () => {
  assert.equal(recipientAfter('sent', 'delivered'), 'delivered'); assert.equal(recipientAfter('delivered', 'read'), 'read'); assert.equal(recipientAfter('read', 'delivered'), null);
  assert.equal(recipientAfter('replied', 'read'), null, 'a reply already counted stays'); assert.equal(recipientAfter('sent', 'failed'), 'failed'); assert.equal(recipientAfter('read', 'failed'), null);
  assert.equal(recipientAfter('queued', 'bogus'), null);
});

test('templateOk: an active template with a Meta template name', () => {
  assert.equal(templateOk(TPL), true); assert.equal(templateOk({ ...TPL, active: false }), false); assert.equal(templateOk({ ...TPL, wa_template: null }), false); assert.equal(templateOk({ ...TPL, wa_template: 'Bad Name' }), false); assert.equal(templateOk(null), false);
});
