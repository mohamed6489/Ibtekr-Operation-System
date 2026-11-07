// The non-Claude text providers of ai-content (phase 11, decision 15): OpenAI chat completions and Gemini generateContent, called
// with our Claude-shaped request translated by _shared/ai-providers.js and answered back in the Claude message shape. Errors carry
// `status` like the Anthropic SDK's, so ask() in index.ts treats every provider the same (401/403 → not_configured, 429/5xx → a
// retry then busy). The key goes in a header only; nothing is logged.
import { fromGemini, fromOpenAI, toGemini, toOpenAI } from '../../_shared/ai-providers.js';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 120_000;

export class TextError extends Error {
  status: number | null;
  constructor(status: number | null, message = 'provider') { super(message); this.status = status; }
}

async function post(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: Json): Promise<Json> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try { res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal }); } catch (e) { clearTimeout(t); throw new TextError(null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
  clearTimeout(t);
  let j: unknown = null; try { j = await res.json(); } catch { j = null; }
  if (!res.ok) throw new TextError(res.status, 'http ' + res.status);
  return (j && typeof j === 'object' ? j : {}) as Json;
}

/** One completion on OpenAI or Gemini; the env holds the keys (Vault over the Supabase secrets). */
export async function completeText(provider: string, env: Record<string, string | undefined>, params: Json, fetchFn: typeof fetch = fetch): Promise<Json> {
  if (provider === 'openai') {
    const key = (env.OPENAI_API_KEY ?? '').trim(); if (!key) throw new TextError(401, 'not_configured');
    return fromOpenAI(await post(fetchFn, OPENAI_URL, { Authorization: 'Bearer ' + key }, toOpenAI(params)));
  }
  if (provider === 'gemini') {
    const key = (env.GEMINI_API_KEY ?? '').trim(); if (!key) throw new TextError(401, 'not_configured');
    const { model, body } = toGemini(params);
    return fromGemini(await post(fetchFn, GEMINI_URL + '/' + encodeURIComponent(String(model)) + ':generateContent', { 'x-goog-api-key': key }, body), String(model));
  }
  throw new TextError(400, 'unknown provider');
}
