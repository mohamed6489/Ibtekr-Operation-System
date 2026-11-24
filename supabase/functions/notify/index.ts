// notify: the notifications engine (phase 11, decision 16 of docs/superpowers/plans/2026-11-07-phase-11-settings.md). Deployed with
// verify_jwt false; it authenticates each request itself.
//   POST { action: 'tick' } with X-Sync-Secret (the sync secret of 0008; cron notify-tick every 15 minutes, 0056) and no Authorization:
//     the live tables → the engine's items (the orders late / pending / unconfirmed / waiting, the makers late / at risk / their daily
//     and weekly reports / a contract ending, the payroll before its pay day, the makers' statements on their days, the subscriptions
//     ending / ended, the urgent and high tickets and the late follow-ups, the conversations waiting for us / late, a channel in
//     error, the team's requests / overtime / meetings, the stock (a consolidation / a photo lot / a return waiting), the waybills
//     needed / late / the daily summary, the company papers ending) → _shared/notify.js plan() with the settings row «notif», the
//     roles, the active members and alert_state → `alerts` rows (one per source × entity × role or member, in the bell at once),
//     alert_state upserts, the external sends (e-mail by Resend with the Vault key app_resend, WhatsApp by the linked WhatsApp 1
//     number — Vault meta_wa of cs-whatsapp — with the approved template named in the settings) and the digests. Each external
//     send is a line in alert_state.channel_log (channel, target label, status, code) — never a text, a number or an address.
//   POST { action } with a member's Authorization: Bearer <jwt>:
//     status  (the admin) → the last tick (sync_state «notify»), the channels' readiness (Resend key / WhatsApp link / template).
//     tick    (the admin, by hand) → the same as the cron; { dry: true } → the plan without any write or send (a preview).
//     rules   (the admin) → the assistants' own rules as they stand this moment: every assistant's rules in force, the number each
//             counts now and whether it holds (the settings card under «المساعدين») — read only, nothing written.
//   The tick also runs the assistants' own rules (the owner 22 Nov — 0150, _shared/agent-rules.js on the numbers of
//   _shared/agent-facts.js): a rule that holds is a note of its assistant in the bell (ref «rule:<assistant>:<rule>»), a rule that
//   stopped holding takes its note, and the numbers are kept in ai_agent_state for the assistants' chats (ai_agent_facts()).
//   The same tick, once every 48 hours, runs the automatic clean-up (the owner 18 Nov — 0132, _shared/cleanup.js): the old logs, the
//   expired links, the read alerts, the deleted chats and the old files go; sync_state «cleanup» keeps the last run's counts.
// Nothing here logs a token, a phone number, an e-mail address or a message text.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { vaultEnv } from '../_shared/secrets.js';
import { cairoParts } from '../_shared/mkt-publish.js';
import { runRules } from './rules.ts';
import { LIVE_FROM } from '../_shared/legacy.js'; // phase 9: the imported old orders count in no assistant's rule
import { OPEN as TEAM_OPEN, teamNotes } from '../_shared/agent-team.js';
import { csLateNotes } from '../_shared/agent-actions.js';
import { DEV_PREFIX, devDue, devNotes } from '../_shared/dev-check.js';
import { OTHER_PROVIDERS, otherNews } from '../_shared/ai-routing.js';
import { CLEANUP_LIMIT, chunks, cleanupDue, cleanupIds, cleanupWork } from '../_shared/cleanup.js';
import { evaluate, factsOf, statusOf } from '../_shared/agent-rules.js';
import { ORDER_CLOSED, countFacts, singleOf } from '../_shared/agent-facts.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string; fetch?: typeof fetch;
  models?: (key: string) => Promise<string[]>; // the model ids Anthropic serves this key (the developer's check — read only)
  otherModels?: (provider: string, key: string) => Promise<string[]>; // the same of OpenAI / Gemini (model-routing decision 11)
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const D = 86400_000; const H = 3600_000;
const rows = (r: { data?: unknown }) => (Array.isArray(r?.data) ? r.data as Json[] : []);
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * D).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / D);
const num = (n: number) => String(n);
const LIMIT = 2000;

// ---------------------------------------------------------------- the settings and the people

type Ctx = { now: string; nowMs: number; cairo: { day: string; time: string }; notif: Json; roles: Json[]; members: Json[]; settings: Record<string, Json> };
async function context(deps: Deps): Promise<Ctx> {
  const now = deps.now(); const nowMs = Date.parse(now); const cairo = cairoParts(nowMs);
  const [st, roles, members] = await Promise.all([
    deps.db.from('settings').select('section, data').in('section', ['notif', 'inventory', 'cs', 'makers']),
    deps.db.from('roles').select('id, name, permissions, level_perms, sort').limit(200),
    deps.db.from('profiles').select('id, name, role_id, level, manager_id, status, email, phone').eq('status', 'active').limit(500), // 0096: level
  ]);
  const settings: Record<string, Json> = {}; for (const r of rows(st)) settings[String(r.section)] = isObj(r.data) ? r.data : {};
  return { now, nowMs, cairo, notif: settings.notif ?? {}, roles: rows(roles), members: rows(members), settings };
}

// ---------------------------------------------------------------- the tick

export async function tick(deps: Deps, opts: { dry?: boolean } = {}): Promise<Response> {
  const ctx = await context(deps);
  // the notifications' new structure (Safwat 24 Nov — 0157): the admin's rules → the bell's rows (rules.ts); the old types, roles'
  // matrix, escalation, quiet hours and digests are no longer read
  const rules = await runRules(deps.db, { now: ctx.now, nowMs: ctx.nowMs, cairo: ctx.cairo }, opts);
  if (opts.dry) return json(200, { result: 'dry', at: ctx.now, ...rules });
  const team = await teamAgentNotes(deps, ctx); // decision 10: each team's assistant — its daily summary and what is late
  const ready = await readyActionNotes(deps, ctx, ctx.nowMs); // decision 7 / T7: the assistant prepares the action (a late reply written)
  const dev = await devCheckNotes(deps, ctx).catch((e) => { console.error('notify dev check: ' + quiet(e)); return null; }); // decision 5 «طريقة أ»: the developer's daily check — a note per problem with its fix
  const clean = await autoCleanup(deps, ctx).catch((e) => { console.error('notify cleanup: ' + quiet(e)); return null; }); // the owner 18 Nov: the clean-up every 48 hours (0132)
  const agentRules = await agentRuleNotes(deps, ctx).catch((e) => { console.error('notify rules: ' + quiet(e)); return null; }); // the owner 22 Nov: the assistants' own rules (0150)
  // the assistants' notes written this tick become the bell's rows on the next one (their rules — «ai» elements — read them since)
  const value = { at: ctx.now, notif: rules, team, ready, ...(dev ? { dev } : {}), ...(clean ? { clean } : {}), ...(agentRules ? { rules: agentRules } : {}) };
  await deps.db.from('sync_state').upsert({ key: 'notify', value, updated_at: ctx.now }, { onConflict: 'key' });
  return json(200, { result: 'ok', ...value });
}
// the owner 22 Nov («السيستم لوحدوا يقدر يبعت تنبيهات … بناء علي القواعد … اللي مكاتبها لكل مساعد» — 0150): the numbers the assistants
// watch, counted from the live tables (a table that did not answer leaves its numbers unread = its rules' notes stay as they are);
// no bank account, phone number or text is read for it — the makers without an account come counted from the database
type RuleRead = { facts: Json; agents: Json[]; ai: Json; single: boolean };
async function ruleRead(deps: Deps, ctx: Ctx): Promise<RuleRead | null> {
  const got = async (q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Json[] | null> => { try { const r = await q; return r.error || !Array.isArray(r.data) ? null : r.data as Json[]; } catch { return null; } };
  const agents = await got(deps.db.from('ai_agents').select('id, name, sees, role, archived_at').limit(200));
  if (!agents || !agents.length) return null; // before 0120: no registry = no rules
  const closed = '(' + (ORDER_CLOSED as string[]).map((x) => '"' + x + '"').join(',') + ')';
  const weekAgo = addDays(ctx.cairo.day, -6);
  const [st, orders, vendors, bank, lots, tickets, convs, wd, subs, hrq, ot, sg, ads, posts, checks] = await Promise.all([
    got(deps.db.from('settings').select('section, data').in('section', ['ai', 'store'])),
    got(deps.db.from('orders').select('id, status, confirm, confirm_at, placed_at').not('status', 'in', closed).is('deleted_at', null).gte('placed_at', LIVE_FROM).limit(LIMIT)),
    got(deps.db.from('vendors').select('id, status, lead_days').limit(LIMIT)),
    (async () => { try { const r = await deps.db.rpc('ai_agent_bankless'); return r.error || typeof r.data !== 'number' ? null : r.data as number; } catch { return null; } })(),
    got(deps.db.from('inv_lots').select('id, reason, status, closed_at').eq('reason', 'مرتجع').is('closed_at', null).limit(LIMIT)),
    got(deps.db.from('tickets').select('id, status, priority, follow_up, assignee_role').in('status', ['open', 'in_progress', 'waiting']).limit(LIMIT)),
    got(deps.db.from('cs_conversations').select('id, seg, status, waiting_since').eq('status', 'مستنية ردنا').limit(LIMIT)),
    got(deps.db.from('dokan_withdrawals').select('id, status').eq('status', 'pending').limit(LIMIT)),
    got(deps.db.from('acc_expenses').select('id, sub_ends, voided_at').eq('category', 'الاشتراكات').is('voided_at', null).gte('sub_ends', ctx.cairo.day).limit(LIMIT)),
    got(deps.db.from('hr_requests').select('id, status').in('status', ['جديد', 'قيد المراجعة']).limit(LIMIT)),
    got(deps.db.from('hr_overtime').select('id, status').eq('status', 'مستني').limit(LIMIT)),
    got(deps.db.from('mkt_suggestions').select('id, status').eq('status', 'pending').limit(LIMIT)),
    got(deps.db.from('mkt_ad_stats').select('level, day, spend').eq('level', 'campaign').gte('day', weekAgo).limit(10_000)),
    got(deps.db.from('mkt_posts').select('id, status, deleted_at').eq('status', 'فشل').limit(LIMIT)),
    got(deps.db.from('site_checks').select('kind, data').in('kind', ['pagespeed', 'wp_updates'])),
  ]);
  const O = orders ?? [];
  const items = orders ? (O.length ? await got(deps.db.from('order_items').select('order_id, vendor_id, product_id, status, removed, expected_at').in('order_id', O.map((o) => o.id)).eq('removed', false).limit(10_000)) : []) : null;
  const productLead: Record<string, number> = {};
  const pids = [...new Set((items ?? []).map((it) => it.product_id).filter((x) => x != null))];
  for (let i = 0; i < pids.length; i += 500) { const r = await got(deps.db.from('product_lead_days').select('product_id, days').in('product_id', pids.slice(i, i + 500))); for (const x of r ?? []) productLead[String(x.product_id)] = Number(x.days); }
  const sec: Record<string, Json> = {}; for (const r of st ?? []) sec[String(r.section)] = isObj(r.data) ? r.data : {};
  const single = singleOf(sec.store) as boolean;
  const design = agents.find((a) => a.id === 'designer' && !a.archived_at);
  const facts = countFacts({ delay: (ctx.settings.makers ?? {}).delay, orders, items, vendors, productLead, bankless: bank, lots, tickets, designRole: design ? String(design.role ?? '') : '',
    convs, withdrawals: wd, subs, hrRequests: hrq, overtime: ot, suggestions: sg, adStats: ads, posts, checks }, ctx.cairo.day, ctx.nowMs) as Json;
  // the settings row did not answer = the admin's own rules are not known: nothing is judged this time
  return st ? { facts, agents, ai: sec.ai ?? {}, single } : null;
}
// the rules that hold → one note each for its assistant (the same row while it keeps holding, its number in the title); a rule that
// stopped holding, was switched off or deleted → its note goes; the numbers are kept for the assistants' chats. Nothing is executed.
async function agentRuleNotes(deps: Deps, ctx: Ctx): Promise<Json | null> {
  const r = await ruleRead(deps, ctx); if (!r) return null;
  const live = r.agents.filter((a) => !a.archived_at);
  const { notes, keep } = evaluate(r.ai, live, r.facts, { single: r.single }) as { notes: Json[]; keep: string[] };
  let n = 0;
  for (const x of notes) {
    const { error } = await deps.db.rpc('ai_agent_note_add', { p_agent: x.agent, p_kind: x.kind, p_title: x.title, p_body: x.body, p_ref: x.ref, p_link: null, p_perm: x.perm || null }); // the note is seen with its number's page in full
    if (!error) n++;
  }
  let cleared = 0;
  for (const a of live) {
    const mine = 'rule:' + String(a.id) + ':'; const stay = notes.filter((x) => x.agent === a.id).map((x) => String(x.ref)).concat(keep.filter((k) => k.startsWith(mine)));
    try { const { data: c, error } = await deps.db.rpc('ai_agent_note_clear', { p_agent: a.id, p_prefix: 'rule:', p_keep: stay }); if (!error && typeof c === 'number') cleared += c; } catch { /* before 0130: nothing cleared */ }
  }
  // before 0150 the table is not there: the notes above still went out
  const snap = factsOf(r.ai, live, r.facts, { single: r.single }, ctx.now) as Json;
  try { await deps.db.from('ai_agent_state').upsert({ id: true, facts: snap, at: ctx.now }, { onConflict: 'id' }); } catch { /* not there yet */ }
  return { notes: n, cleared, unread: keep.length };
}
// the admin's card: the same numbers and rules as they stand this moment (nothing written)
async function rulesStatus(deps: Deps): Promise<Response> {
  const ctx = await context(deps); const r = await ruleRead(deps, ctx);
  if (!r) return json(200, { result: 'ok', at: ctx.now, on: false, agents: {} });
  return json(200, { result: 'ok', ...(statusOf(r.ai, r.agents, r.facts, { single: r.single }, ctx.now) as Json) });
}
// agents-brain decision 10: the assistants with a team (ai_agents.role) write that team a daily summary and a late alert in the bell
// (ai_agent_note_add — one row per day each, updated through the day); before 0120 there is no registry = nothing
async function teamAgentNotes(deps: Deps, ctx: Ctx): Promise<number> {
  const ag = rows(await deps.db.from('ai_agents').select('id, role, archived_at').limit(200));
  if (!ag.length) return 0;
  const tk = rows(await deps.db.from('tickets').select('id, title, priority, status, follow_up, created_at, last_update, assignee_member, assignee_member_name, assignee_role').in('status', TEAM_OPEN).limit(LIMIT));
  const byTeam: Record<string, Json[]> = {};
  for (const r of ctx.roles) byTeam[String(r.name)] = ctx.members.filter((m) => m.role_id === r.id).map((m) => ({ id: m.id, name: m.name }));
  let n = 0;
  for (const x of teamNotes(ag, tk, byTeam, ctx.cairo) as Json[]) {
    const { error } = await deps.db.rpc('ai_agent_note_add', { p_agent: x.agent, p_kind: x.kind, p_title: x.title, p_body: x.body, p_ref: x.ref, p_link: x.link });
    if (!error) n++;
  }
  return n;
}
// agents-brain decision 7 / T7: the customer-service assistant writes a ready reply for every customer conversation waiting for us past the
// SLA (the setting «sla_late_min», 60 by default) — the bell's click opens the conversation with the reply in its box; nothing is sent
async function readyActionNotes(deps: Deps, ctx: Ctx, now: number): Promise<number> {
  const ag = rows(await deps.db.from('ai_agents').select('id, archived_at').eq('id', 'cs').limit(1));
  if (!ag.length || ag[0].archived_at) return 0;
  const convs = rows(await deps.db.from('cs_conversations').select('id, seg, status, handle, platform, customer_id, waiting_since, snoozed_until').eq('status', 'مستنية ردنا').eq('seg', 'customers').limit(LIMIT));
  const ids = [...new Set(convs.map((c) => c.customer_id).filter((x) => typeof x === 'string'))];
  const names: Record<string, string> = {};
  if (ids.length) for (const c of rows(await deps.db.from('cs_customers').select('id, name').in('id', ids.slice(0, 200)))) names[String(c.id)] = String(c.name ?? '');
  let n = 0;
  for (const x of csLateNotes(convs, names, now, Number((ctx.settings.cs ?? {}).sla_late_min) || 60) as Json[]) {
    const { error } = await deps.db.rpc('ai_agent_note_add', { p_agent: x.agent, p_kind: x.kind, p_title: x.title, p_body: x.body, p_ref: x.ref, p_link: x.link });
    if (!error) n++;
  }
  return n;
}
// agents-brain decision 5, «طريقة أ» (the owner 18 Nov): once a day from 9 Cairo the developer assistant reads the system's health — the
// screen's errors, the sync with the site, the scheduled jobs, the site's speed and updates, the links — and writes a note per problem
// (_shared/dev-check.js); a problem gone loses its note. Nothing is fixed here: the code fixes go to the Claude Code session by hand.
async function devCheckNotes(deps: Deps, ctx: Ctx): Promise<Json | null> {
  const last = await deps.db.from('sync_state').select('value').eq('key', 'dev_check').maybeSingle();
  const lastDay = isObj(last?.data) && isObj(last.data.value) ? last.data.value.day : null;
  if (!devDue(ctx.cairo, lastDay)) return null;
  const ag = rows(await deps.db.from('ai_agents').select('id, archived_at').eq('id', 'dev').limit(1));
  if (!ag.length || ag[0].archived_at) return null;
  const since = new Date(ctx.nowMs - D).toISOString();
  const got = async (q: PromiseLike<{ data: unknown; error: unknown }>) => { try { const r = await q; return r.error ? null : r.data; } catch { return null; } };
  // the owner 22 Nov: Claude's served models against the list the routing knows (ids only; no key = not linked = nothing to say;
  // a read that failed = null, so yesterday's notes stay)
  const served = async (): Promise<string[] | null> => {
    try {
      const key = String((await vaultEnv(deps.db, deps.env)).ANTHROPIC_API_KEY ?? '').trim();
      if (!key) return [];
      return deps.models ? await deps.models(key) : null;
    } catch { return null; }
  };
  // decision 11: the other linked text companies' lists the same way, each against its first read (sync_state «dev_models»)
  const OTHER_ENV: Record<string, string> = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
  const others = async (): Promise<{ seen: Json; lists: Json }> => {
    const kept = await got(deps.db.from('sync_state').select('value').eq('key', 'dev_models').maybeSingle());
    const seen: Json = isObj(kept) && isObj((kept as Json).value) ? (kept as Json).value : {};
    const lists: Json = {};
    let env: Record<string, string | undefined> | null = null;
    try { env = await vaultEnv(deps.db, deps.env); } catch { env = null; }
    for (const p of OTHER_PROVIDERS as readonly string[]) {
      const key = env ? String(env[OTHER_ENV[p]] ?? '').trim() : '';
      let served: string[] | null = null;
      if (env && !key) served = []; // not linked: nothing to say, and its notes go
      else if (key && deps.otherModels) { try { served = await deps.otherModels(p, key); } catch { served = null; } }
      lists[p] = { served, baseline: Array.isArray(seen[p]) ? seen[p] : null };
    }
    return { seen, lists };
  };
  const [crashes, sync, cron, checks, channels, ads, models, other] = await Promise.all([
    got(deps.db.from('activity_log').select('at, actor, new_value').eq('action', 'app.crash').gte('at', since).limit(LIMIT)),
    got(deps.db.from('woo_sync_log').select('at, kind, direction, entity, action, detail').eq('result', 'error').gte('at', since).order('at', { ascending: true }).limit(LIMIT)),
    got(deps.db.rpc('dev_cron_health', { p_hours: 24 })),
    got(deps.db.from('site_checks').select('kind, data, checked_at').in('kind', ['pagespeed', 'wp_updates'])),
    got(deps.db.from('cs_channels').select('id, name, kind, status')),
    got(deps.db.from('mkt_ad_objects').select('platform, id, name, status, meta').eq('kind', 'account').limit(50)),
    served(), others(),
  ]);
  const byKind: Record<string, Json> = {}; for (const r of Array.isArray(checks) ? checks as Json[] : []) byKind[String(r.kind)] = r;
  const r = devNotes({ now: ctx.nowMs, crashes: Array.isArray(crashes) ? crashes : null, sync: Array.isArray(sync) ? sync : null, cron: isObj(cron) ? cron : null,
    checks: Array.isArray(checks) ? byKind : null, channels: Array.isArray(channels) ? channels : null, ads: Array.isArray(ads) ? ads : null, models, others: other.lists }) as unknown as { notes: Json[]; refs: string[]; keep: string[] };
  // a company's first read becomes its baseline (text model ids only — nothing else is kept)
  const first: Json = {};
  for (const p of OTHER_PROVIDERS as readonly string[]) { const o = other.lists[p]; if (Array.isArray(o.served) && o.served.length && !Array.isArray(o.baseline)) { const b = otherNews(p, o.served, null).baseline; if (Array.isArray(b) && b.length) first[p] = b; } }
  if (Object.keys(first).length) await deps.db.from('sync_state').upsert({ key: 'dev_models', value: { ...other.seen, ...first }, updated_at: ctx.now }, { onConflict: 'key' });
  let n = 0;
  for (const x of r.notes) {
    const { error } = await deps.db.rpc('ai_agent_note_add', { p_agent: 'dev', p_kind: x.kind, p_title: x.title, p_body: x.body, p_ref: x.ref, p_link: x.link });
    if (!error) n++;
  }
  // a problem gone takes its note (a source not read keeps its notes; before 0130 the clear is missing = nothing cleared)
  let cleared = 0;
  const held = rows(await deps.db.from('ai_agent_notes').select('ref').eq('agent', 'dev').like('ref', DEV_PREFIX + '%').limit(500)).map((x) => String(x.ref))
    .filter((ref) => r.keep.some((k) => ref.startsWith(k)));
  const { data: c, error: ce } = await deps.db.rpc('ai_agent_note_clear', { p_agent: 'dev', p_prefix: DEV_PREFIX, p_keep: r.refs.concat(held) });
  if (!ce && typeof c === 'number') cleared = c;
  const value = { day: ctx.cairo.day, notes: n, cleared, unread_sources: r.keep };
  await deps.db.from('sync_state').upsert({ key: 'dev_check', value, updated_at: ctx.now }, { onConflict: 'key' });
  return value;
}
// the owner 18 Nov («تنظيف اتوماتيك للdatabase كل 48 ساعة للحاجة اللي ملهاش لازمة»): once every 48 hours the old logs, the expired
// links, the read alerts, the assistants' old notes, the deleted chats, the archived studio batches, the images tool's old files and
// the finished video jobs go (supabase/migrations/0132_auto_cleanup.sql has the rules). The files first through the Storage API, then
// the rows whose files went (data_cleanup checks each one again); a run that hit the limit goes on at the next tick. Before 0132 = nothing.
async function autoCleanup(deps: Deps, ctx: Ctx): Promise<Json | null> {
  const last = await deps.db.from('sync_state').select('value').eq('key', 'cleanup').maybeSingle();
  if (!cleanupDue(ctx.nowMs, isObj(last?.data) ? last.data.value : null)) return null;
  const { data: plan, error } = await deps.db.rpc('cleanup_plan', { p_limit: CLEANUP_LIMIT });
  if (error) return null; // 0132 not applied yet
  const work = cleanupWork(plan, CLEANUP_LIMIT) as unknown as { buckets: Record<string, string[]>; rows: Json[]; full: boolean };
  const failed = new Set<string>(); let files = 0;
  for (const [bucket, list] of Object.entries(work.buckets)) {
    for (const part of chunks(list)) {
      try {
        const { error: re } = await deps.db.storage.from(bucket).remove(part);
        if (re) part.forEach((f: string) => failed.add(bucket + '/' + f)); else files += part.length;
      } catch { part.forEach((f: string) => failed.add(bucket + '/' + f)); }
    }
  }
  const ids = cleanupIds(work.rows, failed) as unknown as { studio: string[]; jobs: number[]; chats: string[] };
  const { data: counts, error: de } = await deps.db.rpc('data_cleanup', { p_studio: ids.studio, p_jobs: ids.jobs, p_chats: ids.chats });
  if (de) throw new Error('db data_cleanup ' + (de.code ?? ''));
  const value = { last_at: ctx.now, more: work.full, files, files_failed: failed.size, rows: isObj(counts) ? counts : {} };
  await deps.db.from('sync_state').upsert({ key: 'cleanup', value, updated_at: ctx.now }, { onConflict: 'key' });
  return value;
}
// the admin's status: the last tick's counts and the rules' catalogue (the channels: the bell only for now — Safwat 24 Nov)
async function status(deps: Deps): Promise<Response> {
  const last = await deps.db.from('sync_state').select('value, updated_at').eq('key', 'notify').maybeSingle();
  return json(200, { result: 'ok', last: isObj(last?.data) ? last.data.value ?? null : null, channels: ['bell'] });
}

// ---------------------------------------------------------------- auth + handler

async function adminOf(req: Request, deps: Deps): Promise<string | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const { data, error } = await deps.userDb(jwt).rpc('is_admin'); if (error || data !== true) return null;
  return await deps.userId(jwt);
}
async function syncAllowed(deps: Deps, secret: string) { const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret }); return !error && data === true; }

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let parsed: unknown; try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {}; const action = typeof args.action === 'string' ? args.action : '';
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (action !== 'tick' || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return await tick(deps); } catch (e) { console.error('notify tick: ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const admin = await adminOf(req, deps); if (!admin) return json(401, { error: 'unauthorized' });
  if (action !== 'tick' && action !== 'status' && action !== 'rules') return json(400, { error: 'unknown_action' });
  try { return action === 'status' ? await status(deps) : action === 'rules' ? await rulesStatus(deps) : await tick(deps, { dry: args.dry === true }); }
  catch (e) { console.error('notify ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(), fetch: globalThis.fetch,
    // GET /v1/models with the linked key, every page (the SDK's list iterates them) — ids only, nothing is written anywhere
    models: async (key) => { const ids: string[] = []; for await (const m of new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 }).models.list({ limit: 100 })) ids.push(String(m.id)); return ids; },
    // the same of OpenAI (GET /v1/models) and Gemini (GET v1beta/models) — the key in a header, ids only, nothing written anywhere
    otherModels: async (provider, key) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
      try {
        const res = provider === 'openai' ? await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: ctl.signal })
          : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal: ctl.signal });
        if (!res.ok) throw new Error('http ' + res.status);
        const j = await res.json();
        const list = provider === 'openai' ? j?.data : j?.models;
        return (Array.isArray(list) ? list : []).map((m: Json) => String(provider === 'openai' ? m?.id ?? '' : m?.name ?? '')).filter(Boolean);
      } finally { clearTimeout(t); }
    },
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}
if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
