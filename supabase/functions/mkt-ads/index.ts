// mkt-ads: Meta Ads' own numbers, read-only — phase 9.5.3, decisions 43 / 48 of docs/superpowers/plans/2026-11-06-phase-9-5-marketing.md.
// Deployed with verify_jwt false; it authenticates each request itself. Nothing here writes on Meta.
//   POST { action: 'sync' } with X-Sync-Secret (the sync secret of 0008, the cron mkt-ads-sync of 0052) and no Authorization:
//     the ad account (name, currency, status), its campaigns and ads (name, status, the creative's thumbnail) and the daily insights
//     per campaign and per ad of the last 3 days (90 on the first run, with no numbers yet) → mkt_ad_objects / mkt_ad_stats.
//   POST { action, … } with a member's Authorization: Bearer <jwt>:
//     status (marketing.view) → { configured, account: { name, currency, status } | null, synced_at, checked_at, error }.
//     sync   (the admin) { days? } → the same run now (1–400 days) + activity_log mkt.ads.sync (the counts only).
//   9.5.4 (decisions 49–52): after every sync the buyer's suggestions are recomputed (mkt_suggestions — one open a kind × campaign);
//     rules (marketing.view) / rules_set + live (the admin, settings «marketing».buyer); decide { id, decision, value } (the admin —
//     money): stop → the campaign PAUSED, budget_* → the daily budgets by the step (≤ 30%, the account's daily total ≤ the cap),
//     creative → a designer request, tracking → reviewed; nothing is written on Meta while the switch `live` is off. The cron
//     `report` (hourly) sends the day's report to the bell once, at the rule's hour. Every write on Meta is a POST to the object's own
//     node with the token in the header.
// Secrets (the owner's): META_ADS_TOKEN — a System User token of the Business Manager with ads_read (it never expires and never
// reaches a row, a log or an answer) — and META_AD_ACCOUNT_ID («act_…» or the digits). Without them: 503 not_configured.
// A failed run keeps the last numbers and the last success and says our code (token / permission / rate / timeout / graph_N) on
// the account row; the page says it in words.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { CHUNK_DAYS, FIRST_DAYS, MAX_DAYS, MAX_PAGES, SUGGEST_DAYS, SYNC_DAYS, accountDaily, accountOf, accountRowOf, budgetPlan, buyerRules, nextOf, objectRowOf, path, reportText, rulesPatch, statRowOf, suggestionKey, suggestionsOf, windowChunks, windowOf } from '../_shared/mkt-ads.js';
import { cairoParts } from '../_shared/mkt-publish.js';
import { graphErrorCode } from '../_shared/cs-channel.js';
import { ourCode } from '../_shared/mkt-publish.js';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Deps = {
  env: Record<string, string | undefined>; db: Db; now: () => string;
  userDb?: (jwt: string) => Db; userId?: (jwt: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

const ACTIONS = ['status', 'sync', 'rules', 'rules_set', 'live', 'decide'];
const CRON_ACTIONS = ['sync', 'report'];
const GRAPH_MS = 30_000;
const CHUNK = 500;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const quiet = (e: unknown) => String((e as Error)?.message ?? 'error').replace(/[^\w: .-]/g, '').slice(0, 200);
const configOf = (env: Deps['env']) => {
  const token = (env.META_ADS_TOKEN ?? '').trim(); const account = accountOf(env.META_AD_ACCOUNT_ID);
  return token.length >= 20 && account ? { token, account } : null;
};

// ---------------------------------------------------------------- Graph (GET only)

// text: Meta's own words of the refusal (letters, digits and plain punctuation only, 200 characters) — never a token, shown to the admin
class GraphError extends Error { constructor(public code: string, public text: string | null = null) { super(code); this.name = 'GraphError'; } }
const graphText = (out: unknown) => { const m = isObj(out) && isObj(out.error) ? out.error.message : null; return typeof m === 'string' ? m.replace(/[^\w .,:;()#'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null : null; };
async function get(deps: Deps, url: string, token: string): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  let res: Response;
  try { res = await f(url, { method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer ' + token }, signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out), graphText(out));
  return isObj(out) ? out : {};
}
// a write on an object's own node (a decision): form fields, the token in the header
async function post(deps: Deps, url: string, token: string, form: Record<string, string>): Promise<Json> {
  const f = deps.fetch ?? fetch; const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), GRAPH_MS);
  let res: Response;
  try { res = await f(url, { method: 'POST', headers: { accept: 'application/json', authorization: 'Bearer ' + token, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: ctl.signal, redirect: 'manual' }); }
  catch (e) { throw new GraphError((e as Error)?.name === 'AbortError' ? 'graph_timeout' : 'graph_network'); }
  finally { clearTimeout(timer); }
  let out: unknown = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) throw new GraphError(graphErrorCode(out), graphText(out));
  return isObj(out) ? out : {};
}
// a list with its pages (Meta's own next links), MAX_PAGES at most
async function list(deps: Deps, url: string, token: string): Promise<Json[]> {
  const out: Json[] = []; let next: string | null = url;
  for (let i = 0; next && i < MAX_PAGES; i += 1) {
    const page = await get(deps, next, token);
    if (Array.isArray(page.data)) out.push(...page.data.filter(isObj));
    next = nextOf(page);
  }
  return out;
}

// ---------------------------------------------------------------- the members

type Who = { uid: string; admin: boolean; view: boolean };
async function whoIs(req: Request, deps: Deps): Promise<Who | null> {
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || !deps.userDb || !deps.userId) return null;
  const member = deps.userDb(jwt);
  const { data: adminData, error: adminErr } = await member.rpc('is_admin');
  const admin = !adminErr && adminData === true;
  const uid = await deps.userId(jwt);
  if (!uid) return null;
  let view = admin;
  if (!view) { const { data, error } = await member.rpc('has_perm', { key: 'marketing.view' }); view = !error && String(data ?? 'N') !== 'N'; }
  return { uid, admin, view };
}
async function syncAllowed(deps: Deps, secret: string) {
  const { data, error } = await deps.db.rpc('sync_secret_matches', { candidate: secret });
  return !error && data === true;
}

// ---------------------------------------------------------------- the run (decision 43)

async function accountRow(deps: Deps, id: string): Promise<Json | null> {
  const { data } = await deps.db.from('mkt_ad_objects').select('platform, kind, id, name, status, meta').eq('platform', 'meta').eq('kind', 'account').eq('id', id).maybeSingle();
  return isObj(data) ? data : null;
}
async function upsertAll(deps: Deps, table: string, rows: Json[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await deps.db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error('db ' + table + ' ' + (error.code ?? ''));
  }
}
async function run(deps: Deps, daysArg: number | null): Promise<Response> {
  const cfg = configOf(deps.env); if (!cfg) return json(503, { error: 'not_configured', configured: false });
  const at = deps.now(); const nowMs = Date.parse(at); const prev = await accountRow(deps, cfg.account);
  let days = daysArg;
  if (!days) { const { data } = await deps.db.from('mkt_ad_stats').select('day').eq('platform', 'meta').limit(1); days = Array.isArray(data) && data.length ? SYNC_DAYS : FIRST_DAYS; }
  const w = windowOf(nowMs, days);
  try {
    const acct = await get(deps, path.account(cfg.account), cfg.token);
    const camps = await list(deps, path.campaigns(cfg.account), cfg.token);
    const ads = await list(deps, path.ads(cfg.account), cfg.token);
    // a week at a time (Meta refuses a long range over every ad as too much data)
    const cStats: Json[] = []; const aStats: Json[] = [];
    for (const ch of windowChunks(w.since, w.until, CHUNK_DAYS)) {
      cStats.push(...await list(deps, path.insights(cfg.account, 'campaign', ch.since, ch.until), cfg.token));
      aStats.push(...await list(deps, path.insights(cfg.account, 'ad', ch.since, ch.until), cfg.token));
    }
    // one row a key (a page or a chunk answering a row twice would make the upsert refuse the whole batch — 21000)
    const unique = (rows: (Json | null)[], key: (r: Json) => string) => [...new Map(rows.filter(isObj).map((r) => [key(r), { ...r, updated_at: at }])).values()];
    const objects = unique([...camps.map((c) => objectRowOf('campaign', c, cfg.account)), ...ads.map((a) => objectRowOf('ad', a, null))], (r) => r.platform + '|' + r.kind + '|' + r.id);
    const stats = unique([...cStats.map((x) => statRowOf(x, 'campaign')), ...aStats.map((x) => statRowOf(x, 'ad'))], (r) => r.platform + '|' + r.level + '|' + r.object_id + '|' + r.day);
    await upsertAll(deps, 'mkt_ad_objects', objects, 'platform,kind,id');
    await upsertAll(deps, 'mkt_ad_stats', stats, 'platform,level,object_id,day');
    await upsertAll(deps, 'mkt_ad_objects', [{ ...accountRowOf(cfg.account, acct, at, null, prev), updated_at: at }], 'platform,kind,id'); // last: the success mark
    let suggestions = 0;
    try { suggestions = await suggest(deps, cfg, at); } catch (e) { console.error('mkt-ads suggest: ' + quiet(e)); }
    return json(200, { result: 'ok', days: w.days, since: w.since, until: w.until, campaigns: camps.length, ads: ads.length, stats: stats.length, suggestions });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    const row: Json = accountRowOf(cfg.account, null, at, code, prev); row.meta = { ...row.meta, error_text: e.text };
    await upsertAll(deps, 'mkt_ad_objects', [{ ...row, updated_at: at }], 'platform,kind,id');
    return json(502, { error: code, text: e.text });
  }
}

// ---------------------------------------------------------------- 9.5.4: the media buyer (decisions 49–52)

// the rules as the server reads them: settings «marketing».buyer over the defaults
async function rulesOf(deps: Deps) {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'marketing').maybeSingle();
  return buyerRules(isObj(data) && isObj(data.data) ? data.data.buyer : null);
}
async function rulesWrite(deps: Deps, patch: Json, at: string) {
  const { data } = await deps.db.from('settings').select('data').eq('section', 'marketing').maybeSingle();
  const cur = isObj(data) && isObj(data.data) ? data.data : {}; const buyer = { ...(isObj(cur.buyer) ? cur.buyer : {}), ...patch };
  const { error } = await deps.db.from('settings').upsert({ section: 'marketing', data: { ...cur, buyer }, updated_at: at }, { onConflict: 'section' });
  if (error) throw new Error('db settings ' + (error.code ?? ''));
  return buyerRules(buyer);
}
const log = async (deps: Deps, uid: string | null, action: string, entityId: string, value: string) => {
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: uid, action, entity: 'mkt_ads', entity_id: entityId, new_value: value.slice(0, 200) }); } catch { /* the log never blocks */ }
};
// the Woo ad orders of the last days for the rules: { day, campaign, sold, sales } (the order's own total — the lines are the report's)
async function adOrdersSince(deps: Deps, sinceDay: string): Promise<Json[]> {
  const { data } = await deps.db.from('orders').select('utm_campaign, placed_at, status, total, deleted_at').eq('ad_platform', 'meta').gte('placed_at', sinceDay + 'T00:00:00+02:00').limit(5000);
  return (Array.isArray(data) ? data : []).filter((o: Json) => isObj(o) && !o.deleted_at && typeof o.utm_campaign === 'string').map((o: Json) => ({
    day: cairoParts(Date.parse(o.placed_at)).day, campaign: o.utm_campaign, sold: !['ملغي', 'استرجاع', 'فشل'].includes(String(o.status)), sales: Number(o.total) || 0 }));
}
// after a sync: the suggestions of today — the open ones kept (their numbers refreshed) or expired, the new ones inserted; autoStop «auto» acts at once
async function suggest(deps: Deps, cfg: { token: string; account: string }, at: string): Promise<number> {
  const today = cairoParts(Date.parse(at)).day; const since = windowOf(Date.parse(at), SUGGEST_DAYS * 2).since;
  const [{ data: objects }, { data: stats }, orders, rules, { data: open }] = await Promise.all([
    deps.db.from('mkt_ad_objects').select('kind, id, name, status, meta').eq('platform', 'meta').limit(5000),
    deps.db.from('mkt_ad_stats').select('level, object_id, campaign_id, day, spend, impressions, clicks, link_clicks, frequency, purchases, purchase_value').eq('platform', 'meta').gte('day', since).limit(20000),
    adOrdersSince(deps, since), rulesOf(deps),
    deps.db.from('mkt_suggestions').select('id, kind, campaign_id, ad_id').eq('status', 'pending').limit(1000),
  ]);
  const wanted = suggestionsOf({ objects: objects ?? [], stats: stats ?? [], orders, today, rules });
  const have = new Map((Array.isArray(open) ? open : []).map((r: Json) => [suggestionKey(r), r]));
  const fresh: Json[] = [];
  for (const s of wanted) {
    const row = have.get(suggestionKey(s));
    if (row) { have.delete(suggestionKey(s)); await deps.db.from('mkt_suggestions').update({ sub: s.sub, why: s.why, impact: s.impact, pct: s.pct, data: s.data, campaign_name: s.campaign_name, checked_at: at }).eq('id', row.id); }
    else fresh.push({ ...s, platform: 'meta', status: 'pending', created_at: at, checked_at: at });
  }
  if (have.size) await deps.db.from('mkt_suggestions').update({ status: 'expired', checked_at: at }).in('id', [...have.values()].map((r: Json) => r.id));
  const { data: inserted, error } = fresh.length ? await deps.db.from('mkt_suggestions').insert(fresh).select('id, kind, campaign_id, campaign_name') : { data: [], error: null };
  if (error) throw new Error('db mkt_suggestions ' + (error.code ?? ''));
  // autoStop «auto» (the owner's own rule): a new stop is carried out now and the bell told — only with the switch on
  if (rules.autoStopMode === 'auto' && rules.live) {
    for (const s of (Array.isArray(inserted) ? inserted : []).filter((r: Json) => r.kind === 'stop')) {
      try {
        await post(deps, path.node(s.campaign_id), cfg.token, { status: 'PAUSED' });
        await deps.db.from('mkt_suggestions').update({ status: 'done', decided_at: at, note: 'تلقائي', result: { status: 'PAUSED', auto: true } }).eq('id', s.id);
        await deps.db.from('alerts').insert(['admin', 'ops'].map((role) => ({ at, kind: 'marketing', title: 'الميديا باير وقّف «' + (s.campaign_name ?? s.campaign_id) + '»', body: 'صرفت ' + rules.autoStop + ' ج.م أو أكتر من غير أوردر — اتوقفت تلقائي بقاعدتك. تقدر تشغّلها تاني من مدير إعلانات ميتا.', role_id: role, entity: 'marketing-ai', entity_id: String(s.id) })));
        await log(deps, null, 'mkt.buyer.decide', String(s.id), 'stop · auto · ' + s.campaign_id + ' · ok');
      } catch (e) {
        const code = e instanceof GraphError ? ourCode(e.code) : 'failed';
        await deps.db.from('mkt_suggestions').update({ status: 'failed', decided_at: at, note: 'تلقائي', error: code }).eq('id', s.id);
        await log(deps, null, 'mkt.buyer.decide', String(s.id), 'stop · auto · ' + s.campaign_id + ' · ' + code);
      }
    }
  }
  return wanted.length;
}
async function rulesGet(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  return json(200, { rules: await rulesOf(deps) });
}
async function rulesSet(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const p = rulesPatch(args.rules);
  if ('error' in p) return json(400, { error: 'bad_request', field: p.error });
  const rules = await rulesWrite(deps, p.patch, deps.now());
  await log(deps, who.uid, 'mkt.buyer.rules', 'buyer', Object.keys(p.patch).join(', '));
  return json(200, { rules });
}
async function liveSet(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  if (typeof args.on !== 'boolean') return json(400, { error: 'bad_request', field: 'on' });
  const rules = await rulesWrite(deps, { live: args.on }, deps.now());
  await log(deps, who.uid, 'mkt.buyer.live', 'buyer', args.on ? 'on' : 'off');
  return json(200, { rules });
}
// the admin's decision on a suggestion (decision 50)
async function decide(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const id = Number(args.id); const decision = args.decision;
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: 'bad_request', field: 'id' });
  if (!['approve', 'edit', 'reject'].includes(decision)) return json(400, { error: 'bad_request', field: 'decision' });
  const { data: s } = await deps.db.from('mkt_suggestions').select('id, kind, campaign_id, campaign_name, ad_id, title, pct, data, status').eq('id', id).maybeSingle();
  if (!isObj(s)) return json(404, { error: 'not_found' });
  if (s.status !== 'pending') return json(409, { error: 'decided' });
  const at = deps.now(); const note = typeof args.note === 'string' ? args.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || null : null;
  const base = { decided_by: who.uid, decided_at: at, note };
  if (decision === 'reject') {
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'rejected' }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · reject · ' + s.campaign_id);
    return json(200, { result: 'ok', status: 'rejected' });
  }
  let pct: number | null = null;
  if (s.kind === 'budget_up' || s.kind === 'budget_down') {
    pct = decision === 'edit' ? Number(args.value) : Number(s.pct);
    if (!Number.isFinite(pct) || !Number.isInteger(pct) || pct === 0 || Math.sign(pct) !== Math.sign(Number(s.pct))) return json(400, { error: 'bad_request', field: 'value' });
  } else if (decision === 'edit') return json(400, { error: 'bad_request', field: 'decision' });
  const status = decision === 'edit' ? 'edited' : 'approved';
  // the ones with no money: a designer request / reviewed
  if (s.kind === 'creative') {
    const { error } = await deps.db.from('mkt_requests').insert({ kind: 'designer', title: 'نسخة جديدة لإعلان «' + (s.title ?? '').replace(/^إعلان «|» الناس زهقت منه$/g, '') + '»', details: 'الميديا باير: ' + (s.title ?? '') + (note ? ' — ' + note : ''), project: s.campaign_name ?? null, status: 'جديد', created_by: who.uid, created_at: at, updated_by: who.uid, updated_at: at });
    if (error) return json(500, { error: 'failed' });
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', result: { request: true } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), 'creative · approve · ' + s.campaign_id + ' · request');
    return json(200, { result: 'ok', status: 'done', request: true });
  }
  if (s.kind === 'tracking') {
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', result: { reviewed: true } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), 'tracking · approve · ' + s.campaign_id);
    return json(200, { result: 'ok', status: 'done' });
  }
  // money: stop / budget — the switch first
  const rules = await rulesOf(deps); const cfg = configOf(deps.env);
  if (!rules.live || !cfg) {
    await deps.db.from('mkt_suggestions').update({ ...base, status, value: pct, result: { live: false } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · live_off');
    return json(200, { result: 'ok', status, live: false });
  }
  try {
    let result: Json;
    if (s.kind === 'stop') {
      await post(deps, path.node(s.campaign_id), cfg.token, { status: 'PAUSED' });
      result = { status: 'PAUSED' };
    } else {
      const [camp, adsets, allCamps, allAdsets] = await Promise.all([
        get(deps, path.node(s.campaign_id) + '?fields=' + encodeURIComponent('id,daily_budget,lifetime_budget,effective_status'), cfg.token),
        list(deps, path.campaignAdsets(s.campaign_id), cfg.token),
        list(deps, path.campaigns(cfg.account), cfg.token), list(deps, path.accountAdsets(cfg.account), cfg.token)]);
      const plan = budgetPlan({ campaign: camp, adsets }, pct, rules, accountDaily(allCamps, allAdsets, s.campaign_id));
      if ('error' in plan) {
        await deps.db.from('mkt_suggestions').update({ ...base, status: 'failed', value: pct, error: plan.error, result: plan }).eq('id', id);
        await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ' + plan.error);
        return json(409, { error: plan.error, max: plan.max ?? null, cap: plan.cap ?? null, after: plan.after ?? null });
      }
      for (const u of plan.updates) await post(deps, path.node(u.id), cfg.token, { daily_budget: String(u.daily_budget) });
      result = { pct, before: plan.before, after: plan.after, updates: plan.updates.length };
    }
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'done', value: pct, result }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ok');
    return json(200, { ...result, result: 'ok', status: 'done' }); // the stored result (before / after / updates) beside ours
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const code = ourCode(e.code);
    await deps.db.from('mkt_suggestions').update({ ...base, status: 'failed', value: pct, error: code, result: { text: e.text } }).eq('id', id);
    await log(deps, who.uid, 'mkt.buyer.decide', String(id), s.kind + ' · ' + decision + ' · ' + s.campaign_id + ' · ' + code);
    return json(502, { error: code, text: e.text });
  }
}
// the daily report (decision 52): once a day at the rule's Cairo hour, to the bell of the admin and ops roles
async function report(deps: Deps): Promise<Response> {
  const at = deps.now(); const nowMs = Date.parse(at); const p = cairoParts(nowMs); const rules = await rulesOf(deps);
  if (Number(p.time.slice(0, 2)) !== rules.reportHour) return json(200, { result: 'skipped', reason: 'hour' });
  const { data: sent } = await deps.db.from('alerts').select('id').eq('kind', 'marketing').eq('entity', 'marketing-ai').eq('entity_id', 'report:' + p.day).limit(1);
  if (Array.isArray(sent) && sent.length) return json(200, { result: 'skipped', reason: 'sent' });
  const y = cairoParts(nowMs - 86400_000).day;
  const [{ data: st }, orders, { data: pending }] = await Promise.all([
    deps.db.from('mkt_ad_stats').select('spend').eq('platform', 'meta').eq('level', 'campaign').eq('day', y).limit(5000),
    adOrdersSince(deps, y), deps.db.from('mkt_suggestions').select('id').eq('status', 'pending').limit(1000)]);
  const spend = (Array.isArray(st) ? st : []).reduce((s: number, r: Json) => s + (Number(r.spend) || 0), 0);
  const sold = orders.filter((o) => o.day === y && o.sold);
  const t = reportText({ day: y, spend, orders: sold.length, sales: sold.reduce((s, o) => s + o.sales, 0), pending: Array.isArray(pending) ? pending.length : 0 });
  const { error } = await deps.db.from('alerts').insert(['admin', 'ops'].map((role) => ({ at, kind: 'marketing', title: t.title, body: t.body, role_id: role, entity: 'marketing-ai', entity_id: 'report:' + p.day })));
  if (error) throw new Error('db alerts ' + (error.code ?? ''));
  return json(200, { result: 'ok', day: y });
}

async function status(deps: Deps, who: Who): Promise<Response> {
  if (!who.view) return json(401, { error: 'unauthorized' });
  const cfg = configOf(deps.env);
  const row = cfg ? await accountRow(deps, cfg.account) : null; const m = row && isObj(row.meta) ? row.meta : {};
  return json(200, { configured: !!cfg, account: row ? { name: row.name ?? null, currency: m.currency ?? null, status: row.status ?? null } : null,
    synced_at: m.synced_at ?? null, checked_at: m.checked_at ?? null, error: m.error ?? null, text: m.error ? m.error_text ?? null : null });
}
async function syncByHand(deps: Deps, who: Who, args: Json): Promise<Response> {
  if (!who.admin) return json(401, { error: 'unauthorized' });
  const d = args.days == null ? null : Number(args.days);
  if (d != null && !(Number.isInteger(d) && d >= 1 && d <= MAX_DAYS)) return json(400, { error: 'bad_request', field: 'days' });
  const res = await run(deps, d);
  const b = await res.clone().json().catch(() => ({}));
  const value = res.ok ? [b.days, b.campaigns, b.ads, b.stats].join(' · ') : String(b.error ?? res.status);
  try { await deps.db.from('activity_log').insert({ at: deps.now(), actor: who.uid, action: 'mkt.ads.sync', entity: 'mkt_ads', entity_id: 'meta', new_value: value }); } catch { /* the log never blocks */ }
  return res;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let parsed: unknown;
  try { parsed = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const args: Json = isObj(parsed) ? parsed : {};
  const action = typeof args.action === 'string' ? args.action : '';
  // the cron: the sync secret of 0008, `sync` only — never a member's action
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && !req.headers.get('authorization')) {
    if (!CRON_ACTIONS.includes(action) || !(await syncAllowed(deps, syncSecret))) return json(401, { error: 'unauthorized' });
    try { return action === 'report' ? await report(deps) : await run(deps, null); } catch (e) { console.error('mkt-ads ' + action + ': ' + quiet(e)); return json(500, { error: 'failed' }); }
  }
  const who = await whoIs(req, deps);
  if (!who) return json(401, { error: 'unauthorized' });
  if (!ACTIONS.includes(action)) return json(400, { error: 'unknown_action' });
  try {
    return action === 'status' ? await status(deps, who) : action === 'rules' ? await rulesGet(deps, who) : action === 'rules_set' ? await rulesSet(deps, who, args)
      : action === 'live' ? await liveSet(deps, who, args) : action === 'decide' ? await decide(deps, who, args) : await syncByHand(deps, who, args);
  } catch (e) {
    console.error('mkt-ads ' + action + ': ' + quiet(e));
    return json(500, { error: 'failed' });
  }
}

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let service: Db = null;
function realDeps(): Deps {
  const env = Deno.env.toObject();
  service ??= createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', NO_SESSION);
  return {
    env, db: service, now: () => new Date().toISOString(),
    userDb: (jwt) => createClient(env.SUPABASE_URL ?? '', env.SUPABASE_ANON_KEY ?? '', { ...NO_SESSION, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
    userId: async (jwt) => { const { data, error } = await service.auth.getUser(jwt); return error ? null : data?.user?.id ?? null; },
  };
}

if (import.meta.main || 'EdgeRuntime' in globalThis) Deno.serve((req) => handler(req, realDeps()));
