// ai-providers: the AI providers the admin picks from «الإعدادات» (phase 11, decision 15) — pure, no I/O, shared by ai-content /
// ai-images and the page. A default provider per section (text · image · voice · video) and one per tool over it, a fixed model list
// per provider, the prices of the non-Claude text models (USD per million tokens: input, output, cached input — estimates kept
// conservative, the cap counts them), and the translation of our Claude-shaped request (system blocks, content blocks, a JSON schema
// answer) to OpenAI's chat completions and Gemini's generateContent, with their answers read back into the Claude message shape so
// readAnswer / usageOf / costOf stay one path. Nothing here calls the network.

export const TEXT_PROVIDERS = Object.freeze({
  claude: { name: 'Claude (Anthropic)', env: 'ANTHROPIC_API_KEY', secret: 'anthropic', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
  openai: { name: 'ChatGPT (OpenAI)', env: 'OPENAI_API_KEY', secret: 'openai', models: ['gpt-5.2', 'gpt-5.2-mini'] },
  gemini: { name: 'Gemini (Google)', env: 'GEMINI_API_KEY', secret: 'gemini', models: ['gemini-3-pro', 'gemini-3-flash'] },
});
export const IMAGE_PROVIDERS = Object.freeze({
  magnific: { name: 'Magnific', env: 'MAGNIFIC_API_KEY', secret: 'magnific_api', models: ['seedream-5-pro', 'seedream-5-lite', 'gemini-2-5-flash', 'gpt-image-2'], unit: 'credits' },
  openai: { name: 'OpenAI gpt-image', env: 'OPENAI_API_KEY', secret: 'openai', models: ['gpt-image-2'], unit: 'usd' },
  gemini: { name: 'Gemini (Nano Banana)', env: 'GEMINI_API_KEY', secret: 'gemini', models: ['gemini-3-pro-image', 'gemini-2.5-flash-image'], unit: 'usd' },
});
export const VOICE_PROVIDERS = Object.freeze({
  magnific: { name: 'Magnific (ElevenLabs عبر الجسر)', env: null, secret: null },
  elevenlabs: { name: 'ElevenLabs مباشر', env: 'ELEVENLABS_API_KEY', secret: 'elevenlabs', models: ['eleven_v3', 'eleven_multilingual_v2'] },
});
export const VIDEO_PROVIDERS = Object.freeze({
  magnific: { name: 'Magnific (Seedance / Kling / MiniMax عبر الجسر)', env: null, secret: null },
  higgsfield: { name: 'Higgsfield (عبر MCP)', env: null, secret: 'mcp_higgsfield', models: ['seedance_2_5', 'kling3_0', 'minimax_h3', 'marketing_studio_video'] },
  veo: { name: 'Google Veo (بمفتاح Gemini)', env: 'GEMINI_API_KEY', secret: 'gemini', models: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview'] },
});
export const TEXT_TOOLS = Object.freeze(['products', 'marketing', 'buyer']);
export const IMAGE_TOOLS = Object.freeze(['studio', 'campaign', 'tool']);
// the tool a function action belongs to
export const TEXT_TOOL_OF = Object.freeze({ write: 'products', studio: 'products', prompts: 'products', marketing: 'marketing', scenes: 'marketing', buyer: 'buyer' });
export const IMAGE_TOOL_OF = Object.freeze({ generate: 'studio', edit: 'studio', create: 'tool', campaign: 'campaign', campaign_edit: 'campaign' });

// the non-Claude text prices (USD / 1M tokens: input, output, cached input)
export const TEXT_PRICES = Object.freeze({ 'gpt-5.2': [1.25, 10, 0.125], 'gpt-5.2-mini': [0.25, 2, 0.025], 'gemini-3-pro': [2, 12, 0.2], 'gemini-3-flash': [0.3, 2.5, 0.03] });
// a direct image (USD each, by provider and model — conservative)
export const IMAGE_USD = Object.freeze({ 'gpt-image-2': 0.17, 'gemini-3-pro-image': 0.13, 'gemini-2.5-flash-image': 0.04 });
export const VOICE_USD_PER_1K = 0.3; // ElevenLabs ≈ $0.30 per 1,000 characters on the creator tiers
export const VEO_USD_PER_SECOND = Object.freeze({ 'veo-3.1-generate-preview': 0.4, 'veo-3.1-fast-generate-preview': 0.15 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The providers block of the settings row «ai», normalised: every section with a valid default and models. */
export function providersOf(aiRow) {
  const p = isObj(aiRow) && isObj(aiRow.providers) ? aiRow.providers : {};
  const sec = (key, CAT, tools, def) => {
    const s = isObj(p[key]) ? p[key] : {};
    const d = CAT[str(s.default)] ? str(s.default) : def;
    const models = {};
    for (const [id, c] of Object.entries(CAT)) { const m = str(isObj(s.models) ? s.models[id] : ''); models[id] = c.models && c.models.includes(m) ? m : (c.models ? c.models[0] : null); }
    const out = { default: d, models };
    if (tools) { out.tools = {}; for (const t of tools) { const v = str(isObj(s.tools) ? s.tools[t] : ''); out.tools[t] = CAT[v] ? v : d; } }
    return out;
  };
  return {
    text: sec('text', TEXT_PROVIDERS, TEXT_TOOLS, 'claude'),
    image: sec('image', IMAGE_PROVIDERS, IMAGE_TOOLS, 'magnific'),
    voice: sec('voice', VOICE_PROVIDERS, null, 'magnific'),
    video: sec('video', VIDEO_PROVIDERS, null, 'magnific'),
  };
}
/** The text provider and model of a tool. The Claude model stays the row's `model` (decision 8 of 5.3) when given. */
export function textPick(aiRow, tool) {
  const P = providersOf(aiRow).text; const provider = P.tools[tool] ?? P.default;
  let model = P.models[provider];
  if (provider === 'claude' && TEXT_PROVIDERS.claude.models.includes(str(aiRow && aiRow.model))) model = str(aiRow.model);
  return { provider, model };
}
/** The image provider and model of a tool (Magnific keeps the model the page asked for). */
export function imagePick(aiRow, tool) {
  const P = providersOf(aiRow).image; const provider = P.tools[tool] ?? P.default;
  return { provider, model: P.models[provider] };
}
export const voicePick = (aiRow) => { const P = providersOf(aiRow).voice; return { provider: P.default, model: P.models[P.default] }; };
export const videoPick = (aiRow) => { const P = providersOf(aiRow).video; return { provider: P.default, model: P.models[P.default] }; };

/** The patch the page sends → the providers block to store (unknown providers / tools / models dropped). */
export function cleanProviders(patch) {
  return providersOf({ providers: isObj(patch) ? patch : {} });
}

// ---------------------------------------------------------------- the Claude-shaped request → OpenAI / Gemini

const systemText = (p) => (Array.isArray(p.system) ? p.system : typeof p.system === 'string' ? [{ type: 'text', text: p.system }] : []).filter((b) => isObj(b) && typeof b.text === 'string').map((b) => b.text).join('\n\n');
const schemaOf = (p) => (isObj(p.output_config) && isObj(p.output_config.format) && isObj(p.output_config.format.schema) ? p.output_config.format.schema : null);
const effortOf = (p) => (isObj(p.output_config) && ['low', 'medium', 'high'].includes(p.output_config.effort) ? p.output_config.effort : 'medium');
const blocks = (m) => (Array.isArray(m.content) ? m.content : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []).filter(isObj);

/** OpenAI chat completions body: the system blocks as one system message, images as image_url (a data URL or the https URL), the schema as response_format. */
export function toOpenAI(p) {
  const messages = [];
  const sys = systemText(p); if (sys) messages.push({ role: 'system', content: sys });
  for (const m of Array.isArray(p.messages) ? p.messages : []) {
    const parts = [];
    for (const b of blocks(m)) {
      if (b.type === 'text' && typeof b.text === 'string') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image' && isObj(b.source)) {
        if (b.source.type === 'base64' && b.source.data) parts.push({ type: 'image_url', image_url: { url: 'data:' + (b.source.media_type || 'image/jpeg') + ';base64,' + b.source.data } });
        else if (b.source.type === 'url' && typeof b.source.url === 'string') parts.push({ type: 'image_url', image_url: { url: b.source.url } });
      }
    }
    if (parts.length) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
  }
  const schema = schemaOf(p);
  const body = { model: p.model, messages, max_completion_tokens: Number.isInteger(p.max_tokens) ? p.max_tokens : 4000, reasoning_effort: effortOf(p) };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema, strict: false } };
  return body;
}
/** OpenAI's answer → the Claude message shape (one text block, stop_reason, usage). */
export function fromOpenAI(j) {
  const c = isObj(j) && Array.isArray(j.choices) && isObj(j.choices[0]) ? j.choices[0] : null;
  const msg = c && isObj(c.message) ? c.message : {};
  const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).join('') : '';
  const fin = c ? c.finish_reason : null;
  const stop = fin === 'length' ? 'max_tokens' : fin === 'content_filter' || (msg.refusal && !text) ? 'refusal' : 'end_turn';
  const u = isObj(j) && isObj(j.usage) ? j.usage : {};
  const cached = isObj(u.prompt_tokens_details) ? Number(u.prompt_tokens_details.cached_tokens) || 0 : 0;
  return { id: j && j.id, type: 'message', role: 'assistant', model: (isObj(j) && j.model) || null, stop_reason: stop, content: text ? [{ type: 'text', text }] : [],
    usage: { input_tokens: Math.max(0, (Number(u.prompt_tokens) || 0) - cached), output_tokens: Number(u.completion_tokens) || 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
}

// Gemini's schema dialect: additionalProperties is not accepted; everything else of our small schemas (object / array / string / number / enum / required) is
const geminiSchema = (s) => {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!isObj(s)) return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) { if (k === 'additionalProperties') continue; out[k] = geminiSchema(v); }
  return out;
};
/** Gemini generateContent body: systemInstruction, contents with inlineData images (an https image is left out — Gemini reads no outside URL), a JSON answer by schema. */
export function toGemini(p) {
  const contents = [];
  for (const m of Array.isArray(p.messages) ? p.messages : []) {
    const parts = [];
    for (const b of blocks(m)) {
      if (b.type === 'text' && typeof b.text === 'string') parts.push({ text: b.text });
      else if (b.type === 'image' && isObj(b.source) && b.source.type === 'base64' && b.source.data) parts.push({ inlineData: { mimeType: b.source.media_type || 'image/jpeg', data: b.source.data } });
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  const schema = schemaOf(p); const sys = systemText(p);
  const generationConfig = { maxOutputTokens: Number.isInteger(p.max_tokens) ? p.max_tokens : 4000, thinkingConfig: { thinkingLevel: effortOf(p) } };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = geminiSchema(schema); }
  const body = { contents, generationConfig };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  return { model: p.model, body };
}
/** Gemini's answer → the Claude message shape. */
export function fromGemini(j, model) {
  const c = isObj(j) && Array.isArray(j.candidates) && isObj(j.candidates[0]) ? j.candidates[0] : null;
  const parts = c && isObj(c.content) && Array.isArray(c.content.parts) ? c.content.parts : [];
  const text = parts.filter((x) => isObj(x) && typeof x.text === 'string' && !x.thought).map((x) => x.text).join('');
  const fin = c ? String(c.finishReason || '') : (isObj(j) && isObj(j.promptFeedback) && j.promptFeedback.blockReason ? 'SAFETY' : '');
  const stop = fin === 'MAX_TOKENS' ? 'max_tokens' : ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION'].includes(fin) || (!c && fin === 'SAFETY') ? 'refusal' : 'end_turn';
  const u = isObj(j) && isObj(j.usageMetadata) ? j.usageMetadata : {};
  const cached = Number(u.cachedContentTokenCount) || 0;
  return { id: isObj(j) ? j.responseId ?? null : null, type: 'message', role: 'assistant', model: (isObj(j) && j.modelVersion) || model || null, stop_reason: stop, content: text ? [{ type: 'text', text }] : [],
    usage: { input_tokens: Math.max(0, (Number(u.promptTokenCount) || 0) - cached), output_tokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0), cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
}

// ---------------------------------------------------------------- the house style (decision 14: the AI instructions of the settings page)

const words = (v, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, max) : []);
const clip = (v, max) => str(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
/**
 * The writing rules of «تعليمات الذكاء الاصطناعي › المحتوى» as one system block for the text calls, or '' when the row says
 * nothing. section: 'products' (the default) or a custom section id → its own prompt / tone / tags / forbidden words on top.
 */
export function houseStyle(rules, section) {
  const r = isObj(rules) ? rules : {};
  const lines = [];
  const lang = clip(r.lang, 60), tone = clip(r.tone, 40), voice = clip(r.voice, 600), fixed = clip(r.rules, 800), tags = clip(r.tags, 200);
  if (lang) lines.push('Primary language setting: ' + lang + '.');
  if (tone) lines.push('House tone: ' + tone + '.');
  if (voice) lines.push('Brand voice: ' + voice);
  if (fixed) lines.push('Fixed rules: ' + fixed);
  const banned = words(r.words, 30);
  if (banned.length) lines.push('Never use these words or claims: ' + banned.join(' · ') + '.');
  if (tags) lines.push('Fixed hashtags (social captions only): ' + tags);
  const sec = section && section !== 'products' && isObj(r.sections) && Array.isArray(r.sections.txt) ? r.sections.txt.find((x) => isObj(x) && x.id === section) : null;
  if (sec) {
    const p = clip(sec.prompt, 800); if (p) lines.push('Section «' + clip(sec.name, 60) + '»: ' + p);
    const t = clip(sec.tone, 40); if (t) lines.push('Section tone: ' + t + '.');
    const l = clip(sec.len, 40); if (l) lines.push('Section length: ' + l + '.');
    const st = clip(sec.tags, 200); if (st) lines.push('Section hashtags: ' + st);
    const no = words(sec.no, 20); if (no.length) lines.push('Never in this section: ' + no.join(' · ') + '.');
  }
  if (!lines.length) return '';
  return 'House style set by the team in the system settings (it refines the rules above and never overrides the facts, format or safety rules):\n- ' + lines.join('\n- ');
}
/** The image rules of the settings («الصور»): the style line, the forbidden list and a section's prompt → a prompt suffix or ''. */
export function imageStyle(rules, section) {
  const r = isObj(rules) ? rules : {};
  const parts = [];
  const style = clip(r.style, 400); if (style) parts.push('Style: ' + style);
  const no = words(r.imgNo, 20); if (no.length) parts.push('Never: ' + no.join(', '));
  const sec = section && section !== 'products' && isObj(r.sections) && Array.isArray(r.sections.img) ? r.sections.img.find((x) => isObj(x) && x.id === section) : null;
  if (sec) { const p = clip(sec.prompt, 600); if (p) parts.push(p); const sn = words(sec.no, 20); if (sn.length) parts.push('Never: ' + sn.join(', ')); }
  return parts.join('. ');
}
