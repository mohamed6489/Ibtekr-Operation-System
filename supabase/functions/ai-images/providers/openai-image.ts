// OpenAI's image model, direct (phase 11, decision 15: a provider the admin may pick beside Magnific for the studio, the campaign
// images or the tool). The same Provider shape as providers/magnific.ts: generate (text + reference images → /v1/images/edits when
// references are given, else /v1/images/generations), edit (one image + an instruction → /v1/images/edits), probe (/v1/models).
// The key goes in the Authorization header only; the answer's base64 becomes bytes; nothing is logged. Costs are counted in USD
// on the content cap by index.ts (IMAGE_USD), never in Magnific credits.
import { ProviderError, type EditReq, type GenerateReq, type Out, type Provider } from './magnific.ts';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const API = 'https://api.openai.com/v1';
const TIMEOUT_MS = 150_000;
export const OPENAI_IMAGE_MODELS = ['gpt-image-2'];

// OpenAI takes 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape) or auto: the nearest to the asked frame
export function openaiSize(w: number, h: number): string {
  const r = w / h;
  return r < 0.85 ? '1024x1536' : r > 1.18 ? '1536x1024' : '1024x1024';
}
const codeOf = (status: number) => (status === 401 || status === 403 ? 'not_configured' : status === 429 || status >= 500 ? 'busy' : 'ai_error');
function detailOf(j: unknown): string | null {
  const o = (j && typeof j === 'object' ? j : {}) as Json; const e = o.error && typeof o.error === 'object' ? o.error : {};
  return [e.code, e.type, typeof e.message === 'string' ? e.message.slice(0, 160) : null].filter(Boolean).join(' · ') || null;
}
const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function imagesOf(j: Json): Out {
  const list = Array.isArray(j.data) ? j.data : [];
  const images = list.filter((d: Json) => d && typeof d.b64_json === 'string').map((d: Json) => ({ bytes: b64bytes(d.b64_json), mime: 'image/png' }));
  if (!images.length) throw new ProviderError('ai_error', null, 'no image in the answer');
  return { images, credits: null };
}

export function openaiImage(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch): Provider {
  const key = (env.OPENAI_API_KEY ?? '').trim();
  async function call(path: string, body: FormData | Json): Promise<Json> {
    if (!key) throw new ProviderError('not_configured');
    const form = body instanceof FormData;
    let res: Response;
    try { res = await fetchFn(API + path, { method: 'POST', headers: form ? { Authorization: 'Bearer ' + key } : { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: form ? body : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new ProviderError('busy', null, (e as Error)?.name === 'AbortError' ? 'timeout' : 'network'); }
    let j: unknown = null; try { j = await res.json(); } catch { j = null; }
    if (!res.ok) {
      const d = detailOf(j);
      if (res.status === 400 && /safety|moderation|content_policy|rejected/i.test(d ?? '')) throw new ProviderError('refused', res.status, d);
      throw new ProviderError(codeOf(res.status), res.status, d);
    }
    return (j && typeof j === 'object' ? j : {}) as Json;
  }
  const edits = (model: string, prompt: string, images: { bytes: Uint8Array; mime: string }[], size: string, n: number) => {
    const fd = new FormData();
    fd.set('model', model); fd.set('prompt', prompt); fd.set('size', size); fd.set('n', String(n)); fd.set('output_format', 'png');
    images.slice(0, 8).forEach((im, i) => fd.append('image[]', new Blob([im.bytes as BlobPart], { type: im.mime }), 'ref-' + (i + 1) + (im.mime === 'image/png' ? '.png' : im.mime === 'image/webp' ? '.webp' : '.jpg')));
    return call('/images/edits', fd);
  };
  return {
    async generate(req: GenerateReq): Promise<Out> {
      const model = OPENAI_IMAGE_MODELS.includes(req.model) ? req.model : OPENAI_IMAGE_MODELS[0];
      const size = openaiSize(req.width, req.height); const n = Math.max(1, Math.min(4, req.count || 1));
      if (req.references.length) return imagesOf(await edits(model, req.prompt, req.references, size, n));
      return imagesOf(await call('/images/generations', { model, prompt: req.prompt, size, n, output_format: 'png', quality: 'high' }));
    },
    async edit(req: EditReq): Promise<Out> {
      const model = OPENAI_IMAGE_MODELS.includes(req.model) ? req.model : OPENAI_IMAGE_MODELS[0];
      const prompt = req.op === 'remove_bg' ? 'Remove the background completely; keep the product exactly as it is on a clean white background.' : req.op === 'upscale' ? 'Recreate this image at the highest detail and sharpness without changing anything in it.' : req.op === 'relight' ? 'Keep everything identical and improve the lighting: soft, natural, balanced. ' + req.prompt : req.prompt;
      return imagesOf(await edits(model, prompt, [req.image], '1024x1024', 1));
    },
    async probe(): Promise<Json> {
      if (!key) throw new ProviderError('not_configured');
      const res = await fetchFn(API + '/models/gpt-image-2', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new ProviderError(codeOf(res.status), res.status);
      return (await res.json()) as Json;
    },
  };
}
