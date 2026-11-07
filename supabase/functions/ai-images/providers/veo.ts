// Google Veo through the Gemini API key (phase 11, decision 15: a video clip provider beside the Magnific bridge). The call is
// long-running: start (predictLongRunning) → an operation name the job keeps → poll (GET the operation) → the finished sample's
// uri downloaded with the key. The key goes in the x-goog-api-key header only; nothing is logged. The cost is counted in USD on
// the content cap by index.ts (VEO_USD_PER_SECOND × seconds).
import { ProviderError } from './magnific.ts';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 120 * 1024 * 1024;
export const VEO_MODELS = ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview'];
const OP_NAME = /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/;

// Veo takes 4, 6 or 8 seconds and 16:9 / 9:16: the nearest to the scene
export const veoSeconds = (s: number) => (s <= 5 ? 4 : s <= 7 ? 6 : 8);
export const veoAspect = (size: string) => (/^(9:16|4:5|1:1|3:4)$/.test(String(size)) ? '9:16' : '16:9');
const codeOf = (status: number) => (status === 401 || status === 403 ? 'not_configured' : status === 429 || status >= 500 ? 'busy' : 'ai_error');
const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const keyOf = (env: Record<string, string | undefined>) => { const k = (env.GEMINI_API_KEY ?? '').trim(); if (!k) throw new ProviderError('not_configured'); return k; };
async function parse(res: Response): Promise<Json> {
  let j: unknown = null; try { j = await res.json(); } catch { j = null; }
  if (!res.ok) { const e = (j as Json)?.error ?? {}; throw new ProviderError(codeOf(res.status), res.status, [e.status, typeof e.message === 'string' ? e.message.slice(0, 160) : null].filter(Boolean).join(' · ') || null); }
  return (j && typeof j === 'object' ? j : {}) as Json;
}

/** Start a clip: the prompt, the key frame (bytes) as the first image, the aspect and the seconds → the operation name. */
export async function veoStart(env: Record<string, string | undefined>, req: { model: string; prompt: string; image: { bytes: Uint8Array; mime: string } | null; aspect: string; seconds: number }, fetchFn: typeof fetch = fetch): Promise<string> {
  const key = keyOf(env);
  const model = VEO_MODELS.includes(req.model) ? req.model : VEO_MODELS[0];
  const instance: Json = { prompt: req.prompt };
  if (req.image) instance.image = { bytesBase64Encoded: b64(req.image.bytes), mimeType: req.image.mime };
  const body = { instances: [instance], parameters: { aspectRatio: veoAspect(req.aspect), durationSeconds: veoSeconds(req.seconds), resolution: '720p', personGeneration: 'allow_adult' } };
  let res: Response;
  try { res = await fetchFn(API + '/models/' + encodeURIComponent(model) + ':predictLongRunning', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
  const j = await parse(res);
  if (typeof j.name !== 'string' || !OP_NAME.test(j.name)) throw new ProviderError('ai_error', res.status, 'no operation');
  return j.name;
}
/** The operation's state: { done: false } | { done: true, uri } | { done: true, error }. */
export async function veoPoll(env: Record<string, string | undefined>, op: string, fetchFn: typeof fetch = fetch): Promise<{ done: boolean; uri?: string; error?: string }> {
  const key = keyOf(env);
  if (!OP_NAME.test(op)) throw new ProviderError('ai_error', null, 'bad operation');
  let res: Response;
  try { res = await fetchFn(API + '/' + op, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
  const j = await parse(res);
  if (j.done !== true) return { done: false };
  if (j.error) return { done: true, error: String(j.error.status ?? j.error.message ?? 'failed').slice(0, 80) };
  const r = j.response ?? {};
  const samples = r.generateVideoResponse?.generatedSamples ?? r.generatedSamples ?? [];
  const uri = Array.isArray(samples) && samples[0]?.video?.uri ? String(samples[0].video.uri) : null;
  if (!uri || !/^https:\/\/generativelanguage\.googleapis\.com\//.test(uri)) return { done: true, error: r.raiMediaFilteredCount ? 'filtered' : 'no video' };
  return { done: true, uri };
}
/** The finished video's bytes (the uri answers with the key; a redirect to Google's storage is followed). */
export async function veoDownload(env: Record<string, string | undefined>, uri: string, fetchFn: typeof fetch = fetch): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = keyOf(env);
  if (!/^https:\/\/generativelanguage\.googleapis\.com\//.test(uri)) throw new ProviderError('ai_error', null, 'bad uri');
  let res: Response;
  try { res = await fetchFn(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow', signal: AbortSignal.timeout(180_000) }); } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
  if (!res.ok) throw new ProviderError(codeOf(res.status), res.status, 'download');
  const declared = Number(res.headers.get('content-length')); if (Number.isFinite(declared) && declared > MAX_BYTES) throw new ProviderError('ai_error', null, 'too big');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ProviderError('ai_error', null, 'size');
  return { bytes, mime: 'video/mp4' };
}
