// cs-auto: the auto-reply engine's function (phase 6.5, docs/superpowers/plans/2026-11-08-phase-6-5-autoreply.md decision 7).
// Deployed with verify_jwt false; it authenticates each request itself:
//   POST { action: 'tick' } with X-Sync-Secret (the sync secret of 0008; cron cs-auto-tick every 5 minutes, 0058) and no
//     Authorization: the enabled rules × the events of our tables since the last tick → _shared/cs-auto-run.ts tick(): the sends
//     (WhatsApp 1 text / template, Messenger / Instagram, WhatsApp 2 queued for the bridge), the holds whose time came, the
//     «no answer in 24 hours» tickets; the memory in sync_state «cs-auto». While settings «cs».auto.live is off every fired rule is
//     recorded skipped/off and nothing goes out.
//   POST { action } with a member's Authorization: Bearer <jwt>:
//     status  (cs.view ≠ N) → the last tick, live, the channels' readiness (WhatsApp 1 / the page linked).
//     tick    (the admin, by hand) → the same as the cron; { dry: true } → the plan without any write or send (a preview).
// The inbound rules (a first message, outside the hours) run inside cs-channel / cs-whatsapp through the same shared module.
// Nothing here logs a token, a phone number or a message's text.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { type Deps as RunDeps, autoSettings, linksOf, quiet, tick } from '../_shared/cs-auto-run.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = RunDeps & { userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null> };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

type Who = { uid: string; admin: boolean; view: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const { data: adminData, error: adminErr } = await member.rpc('is_admin'); const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt); if (!uid) return null;
  if (admin) return { uid, admin, view: true };
  const { data, error } = await member.rpc('has_perm', { key: 'cs.view' });
  return { uid, admin: false, view: !error && String(data ?? 'N') !== 'N' };
}
async function syncAllowed(deps: Deps, secret: string) { const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret }); return !error && data === true; }

async function status(deps: Deps): Promise<Response> {
  const [{ data: last }, { settings }, links] = await Promise.all([deps.db.from('sync_state').select('value, updated_at').eq('key', 'cs-auto').maybeSingle(), autoSettings(deps), linksOf(deps)]);
  const { data: rules } = await deps.db.from('cs_auto_rules').select('id, enabled').limit(500);
  const list = Array.isArray(rules) ? rules : [];
  return json(200, { result: 'ok', live: settings.live, hours: settings.hours, daily: settings.daily, last: isObj(last) ? last.value ?? null : null, rules: { total: list.length, enabled: list.filter((r: Json) => r.enabled).length },
    channels: { wa1: !!links.wa, page: !!links.page } });
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let parsed: unknown; try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {}; const action = typeof args.action === 'string' ? args.action : '';
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (action !== 'tick' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return json(200, await tick(deps)); } catch (e) { console.error('cs-auto tick: ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps); if (!who) return json(401, { error: 'unauthorized' });
  if (action !== 'tick' && action !== 'status') return json(400, { error: 'unknown_action' });
  if (action === 'status' && !who.view) return json(401, { error: 'unauthorized' });
  if (action === 'tick' && !who.admin) return json(401, { error: 'unauthorized' });
  try { return action === 'status' ? await status(deps) : json(200, await tick(deps, { dry: args.dry === true })); }
  catch (e) { console.error('cs-auto ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(), fetch: globalThis.fetch,
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
