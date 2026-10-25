// woo-webhook: WooCommerce → Postgres deliveries (deployed with verify_jwt false: the HMAC signature authenticates).
// Flow: POST only → WOO_WEBHOOK_SECRET must be set (500 otherwise, never "allow") → WooCommerce's activation ping (no
// topic header, body `webhook_id=N`, sent unsigned) gets 200 ignored with no read or write → X-WC-Webhook-Signature
// over the raw body bytes (bad or missing → 401 + a woo_sync_log error row) → JSON → idempotency: the delivery is
// claimed by inserting the woo_webhook_events row whose unique delivery_id is the key
// `<X-WC-Webhook-Delivery-ID>:<X-WC-Webhook-Signature>` — WooCommerce builds the delivery id from the webhook id and
// the current second, so two deliveries of one webhook within a second share it; the signature (the body's HMAC)
// keeps them apart while an exact replay stays a duplicate. The row starts as 'error'/'in progress' so a delivery
// that never finished can be redelivered; a duplicate of any other delivery → 200 duplicate, nothing else written; a
// duplicate whose earlier row cannot be read back → error (500); no delivery id → processed, delivery_id null (no
// dedupe) → dispatch by X-WC-Webhook-Topic: order.* (a sub-order → sub_orders only, recorded 'ignored'; a parent →
// orders + lines, then its Dokan sub-orders from wc/v3/orders?parent={id}), product.* → products, anything else
// 'ignored' → the event row gets its status → 200 { status, id }. Headers are not signed, so the body must look like
// the topic's resource. Any thrown error: the event is marked 'error' (scrubbed text), a woo_sync_log error row is added, 500.
// woo_webhook_events.payload keeps { id, number, status, parent_id, date_modified_gmt, topic } only (no PII).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { isSubOrder, redactPII, verifySignature } from '../_shared/woo-core.js';
import { logSync } from '../_shared/db.js';
import { errorText, makeScrubber, wooApi } from '../_shared/woo-api.js';
import { wooId, writeContext, writeOrders, writeProducts, writeSubOrders } from '../_shared/woo-write.js';

// deno-lint-ignore no-explicit-any
type Db = any;
export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: Db; now: () => string };
type Body = Record<string, unknown>;
type Status = 'ok' | 'ignored';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Body => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown) => (typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'string' ? v.slice(0, 64) : null);
const header = (req: Request, name: string, max: number) => (req.headers.get(name) ?? '').trim().slice(0, max) || null;

// WooCommerce's ping when a webhook is saved: `webhook_id=123` (form-encoded), or the same as JSON, nothing else.
function isPing(raw: string): boolean {
  if (/^webhook_id=\d+$/.test(raw.trim())) return true;
  try {
    const body = JSON.parse(raw);
    return isObj(body) && Object.keys(body).length === 1 && 'webhook_id' in body;
  } catch {
    return false;
  }
}

const verifyFailed = (db: Db, error: string) =>
  logSync(db, { kind: 'webhook', direction: 'in', entity: 'webhook', action: 'verify', result: 'error', detail: { error } });

type Claim = { id: number } | { duplicate: true };

// Inserts the event row; on a duplicate delivery id, takes the row back only when its last attempt failed.
async function claimDelivery(db: Db, row: Body): Promise<Claim> {
  const start = { ...row, status: 'error', error: 'in progress' };
  const ins = await db.from('woo_webhook_events').insert(start).select('id').single();
  if (!ins.error) return { id: ins.data.id };
  if (ins.error.code !== '23505') throw new Error(`woo_webhook_events: ${ins.error.message}`);
  const prev = await db.from('woo_webhook_events').select('id, status').eq('delivery_id', row.delivery_id).maybeSingle();
  if (prev.error || !prev.data) throw new Error(`woo_webhook_events: duplicate delivery key, earlier row unreadable${prev.error ? ` (${prev.error.message})` : ''}`);
  if (prev.data.status !== 'error') return { duplicate: true };
  const again = await db.from('woo_webhook_events').update({ error: 'in progress (redelivery)' }).eq('id', prev.data.id);
  if (again.error) throw new Error(`woo_webhook_events: ${again.error.message}`);
  return { id: prev.data.id };
}

async function finishEvent(db: Db, id: number, patch: Body) {
  const { error } = await db.from('woo_webhook_events').update(patch).eq('id', id);
  if (error) throw new Error(`woo_webhook_events: ${error.message}`);
}

async function orderDelivery(o: Body, deps: Deps): Promise<Status> {
  const ctx = await writeContext({ db: deps.db, woo: wooApi(deps.env, deps.fetch), kind: 'webhook', now: deps.now });
  if (isSubOrder(o)) {
    await writeSubOrders(ctx, [o]);
    return 'ignored'; // the maker's sub-order is mirrored; no operational status changes
  }
  if (!(await writeOrders(ctx, [o])).written.length) return 'ignored';
  const { data } = await ctx.woo.get('wc/v3/orders', { parent: wooId(o.id), per_page: 100 });
  await writeSubOrders(ctx, Array.isArray(data) ? data : []);
  return 'ok';
}

async function productDelivery(p: Body, deps: Deps): Promise<Status> {
  const ctx = await writeContext({ db: deps.db, woo: wooApi(deps.env, deps.fetch), kind: 'webhook', now: deps.now });
  return (await writeProducts(ctx, [p])).written.length ? 'ok' : 'ignored';
}

function dispatch(topic: string, body: unknown, deps: Deps): Promise<Status> {
  const [resource, event] = topic.split('.');
  if (!isObj(body) || wooId(body.id) === null) return Promise.resolve('ignored');
  if (resource === 'order' && Array.isArray(body.line_items)) return orderDelivery(body, deps);
  if (resource === 'product' && event !== 'deleted' && !('line_items' in body) && typeof body.name === 'string') return productDelivery(body, deps);
  return Promise.resolve('ignored');
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const secret = deps.env.WOO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    await verifyFailed(deps.db, 'not_configured');
    return json(500, { error: 'not_configured' });
  }
  const bytes = new Uint8Array(await req.arrayBuffer()); // the HMAC covers these exact bytes
  const raw = new TextDecoder().decode(bytes);
  const topic = header(req, 'x-wc-webhook-topic', 64) ?? '';
  if (!topic && isPing(raw)) return json(200, { status: 'ignored' });
  const signature = (req.headers.get('x-wc-webhook-signature') ?? '').trim();
  if (!(await verifySignature(bytes, signature, secret))) {
    await verifyFailed(deps.db, 'bad_signature');
    return json(401, { error: 'bad_signature' });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    await logSync(deps.db, { kind: 'webhook', direction: 'in', entity: 'webhook', action: topic || null, result: 'error', detail: { error: 'bad_json' } });
    return json(400, { error: 'bad_json' });
  }
  const b = isObj(body) ? body : {};
  const resourceId = wooId(b.id);
  const payload = redactPII({ id: scalar(b.id), number: scalar(b.number), status: scalar(b.status), parent_id: scalar(b.parent_id), date_modified_gmt: scalar(b.date_modified_gmt), topic: topic || null });
  const deliveryId = header(req, 'x-wc-webhook-delivery-id', 128);
  let eventId: number | null = null;
  try {
    const claim = await claimDelivery(deps.db, {
      delivery_id: deliveryId ? `${deliveryId}:${signature}` : null, webhook_id: header(req, 'x-wc-webhook-id', 32), topic: topic || 'unknown', resource_id: resourceId, payload,
    });
    if ('duplicate' in claim) return json(200, { status: 'duplicate' });
    eventId = claim.id;
    const status = await dispatch(topic, body, deps);
    await finishEvent(deps.db, eventId, { status, resource_id: resourceId, error: null });
    return json(200, { status, id: resourceId });
  } catch (e) {
    const message = errorText(e, makeScrubber(deps.env));
    if (eventId !== null) await finishEvent(deps.db, eventId, { status: 'error', error: message }).catch(() => {});
    await logSync(deps.db, { kind: 'webhook', direction: 'in', entity: topic.split('.')[0] || null, entity_id: resourceId === null ? null : String(resourceId), action: topic || null, result: 'error', detail: { error: message } });
    return json(500, { error: 'processing_failed' });
  }
}

// ---------------------------------------------------------------- runtime wiring

let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
  return { env, fetch: globalThis.fetch, db: service, now: () => new Date().toISOString() };
}

// Serve only as the entry point (the Supabase Edge Runtime defines EdgeRuntime); importing the module (tests) does not.
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
