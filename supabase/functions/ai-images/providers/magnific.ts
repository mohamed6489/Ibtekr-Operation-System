// The Magnific API layer of ai-images (phase 5.4 decision 1): the only file that knows the provider's HTTP shape. Pinned on
// 31 Oct (T2) against the public reference at docs.magnific.com (read through web search; the host itself is blocked in the
// sandbox): the key goes in the header `x-magnific-api-key`; the base is https://api.magnific.com/v1/ai (MAGNIFIC_API_URL moves
// it); every model is its own route — text-to-image `POST /text-to-image/<slug>`, with reference images `POST
// /text-to-image/<slug>-edit` (Gemini 2.5 Flash has one route for both); the answer is a task `{ data: { task_id, status,
// generated } }`, polled at `GET <same route>/{task_id}` until status COMPLETED (CREATED / IN_PROGRESS / FAILED); the
// upscaler `POST /image-upscaler` (async, the same way), relight `POST /image-relight` (async), and the background cutout
// `POST /beta/remove-background { image_url }` (synchronous: `url` / `high_resolution`, links good for five minutes). Reference
// images go as raw base64 strings; the cutout needs a URL (the handler signs one). The provider's answers carry no credit
// figure, so the listed estimates stand. Nothing here is logged with the prompt, an image or the key.

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Ref = { bytes: Uint8Array; mime: string };
export type Out = { images: { bytes: Uint8Array; mime: string }[]; credits: number | null };
export type GenerateReq = { model: string; prompt: string; width: number; height: number; count: number; references: Ref[] };
export type EditReq = { model: string; op: 'instruction' | 'remove_bg' | 'upscale' | 'relight'; prompt: string; image: Ref; imageUrl?: string | null; options: Json };
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

const DEFAULT_URL = 'https://api.magnific.com/v1/ai';
const POLL_EVERY_MS = 2500;
const POLL_MAX_MS = 150_000;
const MAX_IMAGE_BYTES = 20_000_000;
// our model ids → the provider's routes: `text` makes an image from words, `edit` from reference images (null = the same route
// takes both, Gemini's way), `ratio` says whether the route takes Freepik's aspect_ratio enum + resolution tier (Seedream)
const ROUTES: Record<string, { text: string; edit: string | null; ratio: boolean }> = {
  'seedream-5-pro': { text: '/text-to-image/seedream-v5-pro', edit: '/text-to-image/seedream-v5-pro-edit', ratio: true },
  'seedream-5-lite': { text: '/text-to-image/seedream-v5-lite', edit: '/text-to-image/seedream-v5-lite-edit', ratio: true },
  'gemini-2-5-flash': { text: '/gemini-2-5-flash-image-preview', edit: null, ratio: false },
  'gpt-image-2': { text: '/text-to-image/gpt-image-2', edit: '/text-to-image/gpt-image-2-edit', ratio: false },
};
const PROBE_PATH = '/text-to-image/seedream-v5-pro'; // the list of our tasks: a GET that costs nothing

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Freepik's aspect_ratio enum for a width × height, and the Seedream resolution tier (2k when a side passes 1500 px). */
export function aspectOf(w: number, h: number) {
  const r = w / h;
  if (r > 0.95 && r < 1.05) return 'square_1_1';
  if (r >= 1.05) return 'widescreen_16_9';
  return r <= 0.6 ? 'social_story_9_16' : 'portrait_2_3';
}
const tierOf = (w: number, h: number) => (Math.max(w, h) > 1500 ? '2k' : '1.5k');

export function magnific(env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Provider {
  const key = (env.MAGNIFIC_API_KEY ?? '').trim();
  const base = (env.MAGNIFIC_API_URL ?? DEFAULT_URL).replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', 'x-magnific-api-key': key });

  async function call(method: string, path: string, body?: Json): Promise<Json> {
    if (!key) throw new ProviderError('not_configured');
    let res: Response;
    try { res = await fetchFn(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) }); }
    catch { throw new ProviderError('busy'); }
    if (res.status === 401 || res.status === 403) throw new ProviderError('not_configured', res.status);
    if (res.status === 429 || res.status >= 500) throw new ProviderError('busy', res.status);
    if (res.status === 402) throw new ProviderError('ai_error', res.status); // the provider's own credits ran out
    let json: Json = {};
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) throw new ProviderError(res.status === 422 ? 'refused' : 'ai_error', res.status);
    return json;
  }
  const data = (j: Json): Json => (j && typeof j.data === 'object' && j.data !== null && !Array.isArray(j.data) ? j.data : j);
  const idOf = (j: Json) => { const d = data(j); return typeof d.task_id === 'string' ? d.task_id : typeof d.id === 'string' ? d.id : null; };
  const statusOf = (j: Json) => String(data(j).status ?? '').toUpperCase();
  const urlsOf = (j: Json): string[] => {
    const d = data(j); const list = Array.isArray(d.generated) ? d.generated : Array.isArray(d.images) ? d.images : [];
    return list.map((x: Json) => (typeof x === 'string' ? x : x?.url ?? x?.image_url ?? null)).filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u));
  };
  // a task the provider's safety rules stopped is a refusal (the row says so at no cost); any other failure is ai_error
  const fail = (j: Json): never => { throw new ProviderError(/safety|policy|nsfw|moderation|flagged/i.test(JSON.stringify(data(j).error ?? data(j).message ?? data(j).reason ?? '')) ? 'refused' : 'ai_error'); };

  async function download(urls: string[]): Promise<Out['images']> {
    const images: Out['images'] = [];
    for (const u of urls) {
      let r: Response;
      try { r = await fetchFn(u, { signal: AbortSignal.timeout(60_000) }); } catch { throw new ProviderError('busy'); }
      if (!r.ok) throw new ProviderError('ai_error', r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ProviderError('ai_error');
      const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      images.push({ bytes, mime: ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' ? ct : /\.png(\?|$)/i.test(u) ? 'image/png' : /\.webp(\?|$)/i.test(u) ? 'image/webp' : 'image/jpeg' });
    }
    return images;
  }
  // create the task at `path`, poll it at `path/{task_id}` until COMPLETED, return its image urls
  async function task(path: string, body: Json): Promise<string[]> {
    const first = await call('POST', path, body);
    if (statusOf(first) === 'FAILED') fail(first);
    let last = first;
    if (statusOf(first) !== 'COMPLETED') {
      const id = idOf(first);
      if (!id) throw new ProviderError('ai_error');
      const started = Date.now();
      for (;;) {
        await sleep(POLL_EVERY_MS);
        last = await call('GET', `${path}/${encodeURIComponent(id)}`);
        const st = statusOf(last);
        if (st === 'COMPLETED') break;
        if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') fail(last);
        if (Date.now() - started > POLL_MAX_MS) throw new ProviderError('busy');
      }
    }
    const urls = urlsOf(last);
    if (!urls.length) throw new ProviderError('ai_error');
    return urls;
  }
  const route = (model: string) => ROUTES[model] ?? ROUTES['seedream-5-pro'];
  // one image from words or from reference images on the model's route (the routes make one image a task)
  function one(model: string, prompt: string, w: number, h: number, refs: Ref[]) {
    const r = route(model);
    const path = refs.length && r.edit ? r.edit : r.text;
    const body: Json = { prompt };
    if (refs.length) body.reference_images = refs.map((x) => b64(x.bytes));
    if (r.ratio) { body.aspect_ratio = aspectOf(w, h); body.resolution = tierOf(w, h); }
    return task(path, body);
  }

  return {
    generate: async (req) => {
      const n = Math.max(1, Math.min(4, req.count));
      const urls = (await Promise.all(Array.from({ length: n }, () => one(req.model, req.prompt, req.width, req.height, req.references)))).flat();
      return { images: await download(urls), credits: null };
    },
    edit: async (req) => {
      if (req.op === 'remove_bg') {
        if (!req.imageUrl) throw new ProviderError('ai_error');
        const j = await call('POST', '/beta/remove-background', { image_url: req.imageUrl });
        const u = [j.high_resolution, j.url, j.original].find((x) => typeof x === 'string' && /^https:\/\//.test(x));
        if (!u) throw new ProviderError('ai_error');
        return { images: await download([u]), credits: null };
      }
      if (req.op === 'upscale') return { images: await download(await task('/image-upscaler', { image: b64(req.image.bytes), scale_factor: (req.options.scale === 4 ? 4 : 2) + 'x' })), credits: null };
      if (req.op === 'relight') return { images: await download(await task('/image-relight', { image: b64(req.image.bytes), prompt: req.prompt })), credits: null };
      // an instruction: the model's edit route with the image as the reference
      return { images: await download(await one(req.model, req.prompt, 1, 1, [req.image])), credits: null };
    },
    // the account's task list (no credits spent) as it came — the handler keeps its shape only (keys and types)
    probe: () => call('GET', PROBE_PATH),
  };
}

/** The keys and value types of a JSON answer, two levels deep — no values. */
export function shape(v: unknown, depth = 0): Json | string {
  if (Array.isArray(v)) return depth > 1 ? 'array' : { array: v.length ? shape(v[0], depth + 1) : 'empty' };
  if (v !== null && typeof v === 'object') return depth > 1 ? 'object' : Object.fromEntries(Object.entries(v as Json).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v;
}
