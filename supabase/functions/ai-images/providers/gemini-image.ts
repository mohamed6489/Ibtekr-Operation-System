// Gemini's image models, direct (phase 11, decision 15: Nano Banana with the admin's own Google AI Studio key, beside Magnific).
// The same Provider shape as providers/magnific.ts: generate (text + reference images as inlineData → generateContent with an
// IMAGE response), edit (one image + an instruction, the same way), probe (the models list). The key goes in the x-goog-api-key
// header only; the inlineData of the answer becomes bytes; nothing is logged. Costs are counted in USD on the content cap by
// index.ts (IMAGE_USD), never in Magnific credits.
import { ProviderError, type EditReq, type GenerateReq, type Out, type Provider } from './magnific.ts';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 150_000;
export const GEMINI_IMAGE_MODELS = ['gemini-3-pro-image', 'gemini-2.5-flash-image'];

// Gemini takes an aspect ratio from a fixed list: the nearest to the asked frame
export function geminiAspect(w: number, h: number): string {
  const r = w / h; const list: [string, number][] = [['1:1', 1], ['3:4', 0.75], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9], ['2:3', 2 / 3], ['3:2', 1.5], ['4:5', 0.8], ['5:4', 1.25], ['21:9', 21 / 9]];
  return list.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
}
const codeOf = (status: number) => (status === 401 || status === 403 ? 'not_configured' : status === 429 || status >= 500 ? 'busy' : 'ai_error');
const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function detailOf(j: unknown): string | null {
  const o = (j && typeof j === 'object' ? j : {}) as Json; const e = o.error && typeof o.error === 'object' ? o.error : {};
  return [e.status, typeof e.message === 'string' ? e.message.slice(0, 160) : null].filter(Boolean).join(' · ') || null;
}
function imagesOf(j: Json): Out {
  const c = Array.isArray(j.candidates) && j.candidates[0] && typeof j.candidates[0] === 'object' ? j.candidates[0] : null;
  const fin = c ? String(c.finishReason ?? '') : (j.promptFeedback && j.promptFeedback.blockReason ? 'SAFETY' : '');
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'IMAGE_SAFETY'].includes(fin)) throw new ProviderError('refused', 200, fin);
  const parts = c && c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
  const images = parts.filter((p: Json) => p && p.inlineData && typeof p.inlineData.data === 'string').map((p: Json) => ({ bytes: b64bytes(p.inlineData.data), mime: typeof p.inlineData.mimeType === 'string' ? p.inlineData.mimeType : 'image/png' }));
  if (!images.length) throw new ProviderError('ai_error', null, 'no image in the answer' + (fin ? ' (' + fin + ')' : ''));
  return { images, credits: null };
}

export function geminiImage(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Provider {
  const key = (env.GEMINI_API_KEY ?? '').trim();
  async function generate(model: string, prompt: string, refs: { bytes: Uint8Array; mime: string }[], aspect: string): Promise<Out> {
    if (!key) throw new ProviderError('not_configured');
    const parts: Json[] = refs.slice(0, 6).map((r) => ({ inlineData: { mimeType: r.mime, data: b64(r.bytes) } }));
    parts.push({ text: prompt });
    const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } };
    let res: Response;
    try { res = await fetchFn(API + '/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
    let j: unknown = null; try { j = await res.json(); } catch { j = null; }
    if (!res.ok) throw new ProviderError(codeOf(res.status), res.status, detailOf(j));
    return imagesOf((j && typeof j === 'object' ? j : {}) as Json);
  }
  return {
    async generate(req: GenerateReq): Promise<Out> {
      const model = GEMINI_IMAGE_MODELS.includes(req.model) ? req.model : GEMINI_IMAGE_MODELS[0];
      const n = Math.max(1, Math.min(4, req.count || 1)); const out: Out = { images: [], credits: null };
      for (let i = 0; i < n; i++) { const one = await generate(model, req.prompt, req.references, geminiAspect(req.width, req.height)); out.images.push(...one.images); }
      return out;
    },
    async edit(req: EditReq): Promise<Out> {
      const model = GEMINI_IMAGE_MODELS.includes(req.model) ? req.model : GEMINI_IMAGE_MODELS[0];
      const prompt = req.op === 'remove_bg' ? 'Remove the background completely; keep the product exactly as it is on a clean white background.' : req.op === 'upscale' ? 'Recreate this image at the highest detail and sharpness without changing anything in it.' : req.op === 'relight' ? 'Keep everything identical and improve the lighting: soft, natural, balanced. ' + req.prompt : req.prompt;
      return await generate(model, prompt, [req.image], '1:1');
    },
    async probe(): Promise<Json> {
      if (!key) throw new ProviderError('not_configured');
      const res = await fetchFn(API + '/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new ProviderError(codeOf(res.status), res.status);
      return (await res.json()) as Json;
    },
  };
}
