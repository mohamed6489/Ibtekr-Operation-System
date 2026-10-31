// The Magnific API layer of ai-images (phase 5.4 decision 1): the only file that knows the provider's HTTP shape. The owner
// has a Magnific API key (secret MAGNIFIC_API_KEY); the request shape below is the working assumption of 31 Oct (a task is
// created, polled until it completes, its images downloaded) and is confirmed / corrected in T2 against the provider's own
// reference — the base URL and the paths can be moved by the secret MAGNIFIC_API_URL meanwhile, and the handler's `probe` action
// returns the shape of the provider's first answer (keys only) so the layer can be pinned on the live key without guessing.
// Nothing here is logged with the prompt, an image or the key.

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Ref = { bytes: Uint8Array; mime: string };
export type Out = { images: { bytes: Uint8Array; mime: string }[]; credits: number | null };
export type GenerateReq = { model: string; prompt: string; width: number; height: number; count: number; references: Ref[] };
export type EditReq = { model: string; op: 'instruction' | 'remove_bg' | 'upscale' | 'relight'; prompt: string; image: Ref; options: Json };
export type Provider = {
  generate: (req: GenerateReq) => Promise<Out>;
  edit: (req: EditReq) => Promise<Out>;
  probe: () => Promise<Json>;
};
export class ProviderError extends Error {
  kind: 'not_configured' | 'busy' | 'ai_error' | 'refused';
  status: number | null;
  constructor(kind: ProviderError['kind'], status: number | null = null) { super(kind); this.kind = kind; this.status = status; }
}

const DEFAULT_URL = 'https://api.magnific.com/v1';
const POLL_EVERY_MS = 2500;
const POLL_MAX_MS = 120_000;
const MAX_IMAGE_BYTES = 20_000_000;

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const dataUrl = (r: Ref) => `data:${r.mime};base64,${b64(r.bytes)}`;
// the provider's op names (assumed; T2 pins them)
const OPS: Record<EditReq['op'], string> = { instruction: 'edit', remove_bg: 'remove_background', upscale: 'upscale', relight: 'relight' };

export function magnific(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Provider {
  const key = (env.MAGNIFIC_API_KEY ?? '').trim();
  const base = (env.MAGNIFIC_API_URL ?? DEFAULT_URL).replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-api-key': key });

  async function call(method: string, path: string, body?: Json): Promise<Json> {
    if (!key) throw new ProviderError('not_configured');
    let res: Response;
    try { res = await fetchFn(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new ProviderError('busy'); }
    if (res.status === 401 || res.status === 403) throw new ProviderError('not_configured', res.status);
    if (res.status === 429 || res.status >= 500) throw new ProviderError('busy', res.status);
    if (res.status === 402) throw new ProviderError('ai_error', res.status); // the provider's own credits ran out
    let json: Json = {};
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) throw new ProviderError(res.status === 422 || res.status === 400 ? 'refused' : 'ai_error', res.status);
    return json;
  }
  const idOf = (j: Json) => (typeof j.id === 'string' ? j.id : typeof j.task_id === 'string' ? j.task_id : typeof j.data?.task_id === 'string' ? j.data.task_id : null);
  const statusOf = (j: Json) => String(j.status ?? j.data?.status ?? '').toLowerCase();
  const urlsOf = (j: Json): string[] => {
    const list = j.images ?? j.output ?? j.data?.generated ?? j.data?.images ?? [];
    return (Array.isArray(list) ? list : []).map((x: Json) => (typeof x === 'string' ? x : x?.url ?? x?.image_url ?? null)).filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u));
  };
  const creditsOf = (j: Json) => { const n = Number(j.credits_used ?? j.credits ?? j.data?.credits_used ?? j.data?.credits); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

  // create the task, poll it, download its images
  async function task(path: string, body: Json): Promise<Out> {
    const first = await call('POST', path, body);
    const id = idOf(first);
    let last = first;
    const done = (st: string) => st === 'completed' || st === 'succeeded' || st === 'done';
    const failed = (st: string) => st === 'failed' || st === 'error' || st === 'cancelled';
    // a task the provider's safety rules stopped is a refusal (the row says so at no cost); any other failure is ai_error
    const fail = (j: Json): never => { throw new ProviderError(/safety|policy|nsfw|moderation/i.test(JSON.stringify(j.error ?? j.message ?? '')) ? 'refused' : 'ai_error'); };
    if (failed(statusOf(first))) fail(first);
    if (!done(statusOf(first))) {
      if (!id) throw new ProviderError('ai_error');
      const started = Date.now();
      for (;;) {
        await sleep(POLL_EVERY_MS);
        last = await call('GET', `/tasks/${encodeURIComponent(id)}`);
        const st = statusOf(last);
        if (done(st)) break;
        if (failed(st)) fail(last);
        if (Date.now() - started > POLL_MAX_MS) throw new ProviderError('busy');
      }
    }
    const urls = urlsOf(last);
    if (!urls.length) throw new ProviderError('ai_error');
    const images: Out['images'] = [];
    for (const u of urls) {
      let r: Response;
      try { r = await fetchFn(u); } catch { throw new ProviderError('busy'); }
      if (!r.ok) throw new ProviderError('ai_error', r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ProviderError('ai_error');
      const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      images.push({ bytes, mime: ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' ? ct : u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
    }
    return { images, credits: creditsOf(last) };
  }

  return {
    generate: (req) => task('/images/generations', {
      model: req.model, prompt: req.prompt, width: req.width, height: req.height, num_images: req.count,
      reference_images: req.references.map(dataUrl),
    }),
    edit: (req) => task('/images/edits', { model: req.model, operation: OPS[req.op], prompt: req.prompt || undefined, image: dataUrl(req.image), ...req.options }),
    // the account answer as it came (the handler keeps its shape only — keys and types — for the admin, T2)
    probe: () => call('GET', '/account'),
  };
}

/** The keys and value types of a JSON answer, two levels deep — no values. */
export function shape(v: unknown, depth = 0): Json | string {
  if (Array.isArray(v)) return depth > 1 ? 'array' : { array: v.length ? shape(v[0], depth + 1) : 'empty' };
  if (v !== null && typeof v === 'object') return depth > 1 ? 'object' : Object.fromEntries(Object.entries(v as Json).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v;
}
