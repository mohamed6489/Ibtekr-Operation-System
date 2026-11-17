// ش45 decisions 3 and 4 — the filled campaign (the designer and the header's assistant) and «اسأل المساعد المختص»: the limits match the
// page's (marketing-domain.js), the tools are offered only to whoever may use them, the designer's schema and rule carry the campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUmd } from '../helpers/load-umd.mjs';
import { DRAFT_GOALS, DRAFT_MAX, DRAFT_DUR, agentAsk, campaignDraft } from '../../supabase/functions/_shared/campaign-draft.js';
import { CLIENT_TOOLS, assistantRequest, cleanAction, toolsOf } from '../../supabase/functions/_shared/ai-assistant.js';
import { agentRequest, cleanAgent } from '../../supabase/functions/_shared/marketing.js';
const W = loadUmd(new URL('../../app/js/pages/marketing-domain.js', import.meta.url));

test('ش45: a draft within the limits — goal fallback, counts capped, slides only with a carousel, the video length only with a video; nothing to make = null', () => {
  assert.deepEqual(campaignDraft({ goal: 'عرض / خصم', idea: ' خصم <b>20%</b>\n على المكرمية ', post: 3.4, carousel: 1, slides: 50, video: 0, dur: 99 }),
    { goal: 'عرض / خصم', idea: 'خصم b 20% /b على المكرمية', post: 3, carousel: 1, video: 0, slides: DRAFT_MAX });
  assert.deepEqual(campaignDraft({ goal: 'x', idea: 'ريل', video: 2, dur: 2 }), { goal: DRAFT_GOALS[0], idea: 'ريل', post: 0, carousel: 0, video: 2, dur: DRAFT_DUR[0] });
  assert.equal(campaignDraft({ idea: '', post: 2 }), null);
  assert.equal(campaignDraft({ idea: 'فكرة', post: 0, carousel: 0, video: 0 }), null);
  assert.equal(campaignDraft(null), null);
  assert.equal(campaignDraft({ idea: 'x', post: 40 }).post, DRAFT_MAX);
});

test('ش45: the page\'s draftOf agrees — the same goals and limits, the details of «كامبين جديدة»', () => {
  assert.deepEqual(DRAFT_GOALS, [...W.GOALS]);
  assert.equal(DRAFT_MAX, W.MAX.count); assert.equal(DRAFT_DUR[1], W.VIDEO_MAX);
  const w = W.draftOf({ goal: 'عرض / خصم', idea: 'عرض', post: 2, carousel: 1, slides: 5, video: 1, dur: 20 });
  assert.equal(w.goal, 'عرض / خصم'); assert.equal(w.idea, 'عرض');
  assert.deepEqual([w.media.post.count, w.media.carousel.count, w.media.carousel.slides, w.media.video.count, w.media.video.dur, w.mediaTab], [2, 1, 5, 1, 20, 'post']);
  assert.equal(W.draftOf({ idea: 'x' }), null);
  assert.equal(W.draftOf({ idea: 'x', video: 1 }).mediaTab, 'video');
});

test('ش45: ask_agent and open_campaign — offered only with marketing.view / marketing.create; cleaned', () => {
  assert.ok(CLIENT_TOOLS.includes('ask_agent') && CLIENT_TOOLS.includes('open_campaign'));
  const names = (mkt) => toolsOf('chat', mkt).map((t) => t.name);
  assert.equal(names(undefined).includes('ask_agent'), false);
  assert.equal(names({ view: true, create: false }).includes('ask_agent'), true);
  assert.equal(names({ view: true, create: false }).includes('open_campaign'), false);
  assert.equal(names({ view: true, create: true }).includes('open_campaign'), true);
  assert.deepEqual(toolsOf('filter', { view: true, create: true }).map((t) => t.name), ['set_filter']);
  const req = { mode: 'chat', turns: [{ role: 'user', text: 'x' }], context: {} };
  assert.equal(assistantRequest(req, { model: 'm', effort: 'low', today: '2026-11-17', mkt: { view: true, create: true } }).tools.some((t) => t.name === 'open_campaign'), true);
  assert.match(assistantRequest(req, { model: 'm', effort: 'low', today: '2026-11-17' }).system[0].text, /إنت المدير/);
  assert.deepEqual(cleanAction('ask_agent', { agent: 'dev', question: ' الموقع بطيء ' }), { name: 'ask_agent', input: { agent: 'dev', question: 'الموقع بطيء' } });
  assert.equal(cleanAction('ask_agent', { agent: 'hr', question: 'x' }), null);
  assert.equal(cleanAction('ask_agent', { agent: 'dev', question: '' }), null);
  assert.equal(agentAsk({ agent: 'buyer', question: 'x'.repeat(1500) }).question.length, 1000);
  assert.deepEqual(cleanAction('open_campaign', { idea: 'عرض', post: 2 }).input, { goal: DRAFT_GOALS[0], idea: 'عرض', post: 2, carousel: 0, video: 0 });
  assert.equal(cleanAction('open_campaign', { idea: '' }), null);
});

test('ش45: the designer\'s answer carries the campaign (its schema and rule); the others do not', () => {
  const d = agentRequest({ agent: 'designer', question: 'عايز محتوى' }, { model: 'm', effort: 'low', history: [], cfg: {} });
  assert.ok(d.output_config.format.schema.properties.campaign);
  assert.match(d.system[0].text, /trusted with content tasks/);
  const dev = agentRequest({ agent: 'dev', question: 'x' }, { model: 'm', effort: 'low', history: [], cfg: {} });
  assert.equal(dev.output_config.format.schema.properties.campaign, undefined);
  assert.deepEqual(cleanAgent({ text: 'تمام', image_prompt: '', request: { title: '' }, campaign: { goal: 'منتج جديد', idea: 'فازة', post: 1 } }, 'designer').campaign, { goal: 'منتج جديد', idea: 'فازة', post: 1, carousel: 0, video: 0 });
  assert.equal(cleanAgent({ text: 'سؤال؟', campaign: { idea: '', post: 0 } }, 'designer').campaign, null);
  assert.equal('campaign' in cleanAgent({ text: 'x', campaign: { idea: 'y', post: 1 } }, 'dev'), false);
});
