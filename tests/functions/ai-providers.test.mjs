import { test } from 'node:test'; import assert from 'node:assert/strict';
import { IMAGE_PROVIDERS, TEXT_PRICES, TEXT_PROVIDERS, VIDEO_PROVIDERS, VOICE_PROVIDERS, cleanProviders, fromGemini, fromOpenAI, houseStyle, imagePick, imageStyle, providersOf, textPick, toGemini, toOpenAI, videoPick, voicePick } from '../../supabase/functions/_shared/ai-providers.js';
import { PRICES } from '../../supabase/functions/_shared/ai-content.js';

test('providersOf: defaults and validation; a tool may differ from the default; the Claude model of the row stays', () => {
  const P = providersOf(null);
  assert.deepEqual([P.text.default, P.image.default, P.voice.default, P.video.default], ['claude', 'magnific', 'magnific', 'magnific']);
  assert.deepEqual(P.text.tools, { products: 'claude', marketing: 'claude', buyer: 'claude' });
  const row = { model: 'claude-sonnet-5-5', providers: { text: { default: 'openai', tools: { marketing: 'gemini', buyer: 'nope' }, models: { openai: 'gpt-5.2-mini', gemini: 'gemini-9' } }, image: { default: 'gemini' }, voice: { default: 'elevenlabs' }, video: { default: 'veo', models: { veo: 'veo-3.1-fast-generate-preview' } } } };
  assert.deepEqual(textPick(row, 'products'), { provider: 'openai', model: 'gpt-5.2-mini' });
  assert.deepEqual(textPick(row, 'marketing'), { provider: 'gemini', model: 'gemini-3-pro' }, 'an unknown model falls to the provider default');
  assert.deepEqual(textPick(row, 'buyer'), { provider: 'openai', model: 'gpt-5.2-mini' }, 'an unknown tool provider falls to the section default');
  assert.deepEqual(textPick({ ...row, providers: { text: { default: 'claude' } } }, 'products'), { provider: 'claude', model: 'claude-sonnet-5-5' });
  assert.deepEqual(imagePick(row, 'studio'), { provider: 'gemini', model: 'gemini-3-pro-image' });
  assert.deepEqual(voicePick(row), { provider: 'elevenlabs', model: 'eleven_v3' });
  assert.deepEqual(videoPick(row), { provider: 'veo', model: 'veo-3.1-fast-generate-preview' });
  assert.deepEqual(cleanProviders({ text: { default: 'snap' }, bogus: 1 }).text.default, 'claude');
  Object.values(TEXT_PRICES).forEach((v) => assert.equal(v.length, 3));
  Object.keys(TEXT_PRICES).forEach((m) => assert.deepEqual(PRICES[m], TEXT_PRICES[m], m + ' priced the same in ai-content'));
  assert.ok(TEXT_PROVIDERS.openai.models.length && IMAGE_PROVIDERS.openai.models.length && VOICE_PROVIDERS.elevenlabs.models.length && VIDEO_PROVIDERS.veo.models.length);
});

const REQ = { model: 'gpt-5.2', max_tokens: 500, betas: ['x'], fallbacks: 'default', system: [{ type: 'text', text: 'Rules A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Rules B' }],
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'image', source: { type: 'url', url: 'https://site/p.jpg' } }, { type: 'text', text: 'Write it' }] }, { role: 'assistant', content: 'earlier answer' }],
  output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } };

test('toOpenAI: one system message, image parts (data URL and https), the schema as response_format, the effort', () => {
  const b = toOpenAI(REQ);
  assert.equal(b.model, 'gpt-5.2'); assert.equal(b.max_completion_tokens, 500); assert.equal(b.reasoning_effort, 'high');
  assert.deepEqual(b.messages[0], { role: 'system', content: 'Rules A\n\nRules B' });
  assert.deepEqual(b.messages[1].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'https://site/p.jpg' } }, { type: 'text', text: 'Write it' }]);
  assert.deepEqual(b.messages[2], { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] });
  assert.equal(b.response_format.json_schema.schema.required[0], 'name'); assert.equal(b.response_format.json_schema.strict, false);
  assert.equal('betas' in b, false);
  const m = fromOpenAI({ id: 'c1', model: 'gpt-5.2-2026-05', choices: [{ finish_reason: 'stop', message: { content: '{"name":"x"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } } });
  assert.deepEqual([m.stop_reason, m.content[0].text, m.usage], ['end_turn', '{"name":"x"}', { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 }]);
  assert.equal(fromOpenAI({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }).stop_reason, 'max_tokens');
  assert.equal(fromOpenAI({ choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: null } }] }).stop_reason, 'refusal');
  assert.deepEqual(fromOpenAI(null).content, []);
});

test('toGemini: systemInstruction, inlineData images (the https one left out), a JSON answer by schema without additionalProperties, thinking by effort', () => {
  const { model, body } = toGemini(REQ);
  assert.equal(model, 'gpt-5.2');
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Rules A\n\nRules B' }] });
  assert.deepEqual(body.contents[0], { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'Write it' }] });
  assert.deepEqual(body.contents[1], { role: 'model', parts: [{ text: 'earlier answer' }] });
  assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.equal(body.generationConfig.maxOutputTokens, 500);
  assert.equal('additionalProperties' in body.generationConfig.responseJsonSchema, false); assert.deepEqual(body.generationConfig.responseJsonSchema.required, ['name']);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'high' });
  const m = fromGemini({ responseId: 'r', modelVersion: 'gemini-3-pro-001', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'think', thought: true }, { text: '{"name":"y"}' }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, thoughtsTokenCount: 50, cachedContentTokenCount: 300 } }, 'gemini-3-pro');
  assert.deepEqual([m.model, m.stop_reason, m.content[0].text, m.usage], ['gemini-3-pro-001', 'end_turn', '{"name":"y"}', { input_tokens: 600, output_tokens: 150, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 }]);
  assert.equal(fromGemini({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, 'g').stop_reason, 'refusal');
  assert.equal(fromGemini({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }, 'g').stop_reason, 'max_tokens');
  assert.equal(fromGemini({ promptFeedback: { blockReason: 'SAFETY' } }, 'g').stop_reason, 'refusal');
});

test('houseStyle / imageStyle: the settings rules as one block, a custom section on top, empty when nothing is set', () => {
  assert.equal(houseStyle(null, 'products'), ''); assert.equal(houseStyle({ words: [] }, 'products'), '');
  const rules = { lang: 'عربي مصري + English', tone: 'دافي وبسيط', voice: 'بنتكلم مع الناس كأننا صحابهم.', rules: 'اسم البراند بالإنجليزي.', words: ['الأرخص', ' أصلي 100% ', 7], tags: '#إبتكر #هاندميد',
    sections: { txt: [{ id: 'post', name: 'البوست', prompt: 'كابشن قصير <b>', tone: 'حماسي', len: 'قصير — لحد 150 حرف', tags: '#x', no: ['عرض لفترة محدودة'] }] }, style: 'هاندميد دافي', imgNo: ['نصوص مكتوبة', 'علامات مائية'] };
  const s = houseStyle(rules, 'products');
  assert.match(s, /^House style set by the team/); assert.match(s, /Brand voice: بنتكلم/); assert.match(s, /Never use these words or claims: الأرخص · أصلي 100%\./); assert.equal(s.includes('Section'), false);
  const p = houseStyle(rules, 'post');
  assert.match(p, /Section «البوست»: كابشن قصير b/); assert.match(p, /Section tone: حماسي\./); assert.match(p, /Never in this section: عرض لفترة محدودة\./);
  assert.equal(imageStyle(null, 'products'), '');
  assert.equal(imageStyle(rules, 'products'), 'Style: هاندميد دافي. Never: نصوص مكتوبة, علامات مائية');
  assert.equal(imageStyle({ sections: { img: [{ id: 'post', prompt: 'بوست سوشيال', no: ['أسعار'] }] } }, 'post'), 'بوست سوشيال. Never: أسعار');
});
