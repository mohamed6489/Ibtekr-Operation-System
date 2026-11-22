// Which Claude model runs which command (the owner 22 Nov — «امتا يستخدم كل موديل و في اي امر … بيناء علي احدث الموديلز»;
// docs/superpowers/plans/2026-11-22-model-routing.md). Pure: no network, no clock.
//
// Every command of ai-content has a level — light / mid / heavy — and each level is one model of Anthropic's current
// generation. Out of the box the system routes by itself (the owner: «تلقائي»); the admin may move a command to another
// level, or go back to one model for everything, from the settings row «ai» (key `routing`) — no migration.
// The page's copy of the table (app/js/pages/ai-routing.js) is kept in step by tests/functions/ai-routing.test.mjs.
//
// The model list and the prices are Anthropic's published ones on LIST_DATE. The developer's daily check (dev-check.js)
// compares them with what the linked key is served and tells the team when the list moves; the update itself is a code
// change here (the ids, the prices of ai-content.js, the recommendations below).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const LIST_DATE = '2026-11-03';
export const TIERS = Object.freeze(['light', 'mid', 'heavy']);
/** The model of each level: the current Haiku, Sonnet and Opus. */
export const TIER_MODEL = Object.freeze({ light: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5', heavy: 'claude-opus-5-5' });
/** USD per million tokens [input, output] of each level's model (the short-prompt card for Haiku — ai-content.js prices the long one). */
export const TIER_USD = Object.freeze({ light: [0.1, 0.5], mid: [2, 10], heavy: [4, 20] });
/**
 * Every Claude model this system knows on LIST_DATE (Anthropic's model ids, with no date suffix): the three it routes to, the
 * ones a refusal may fall back to, and the rest of the list — so the daily check tells a new model from one it has seen.
 */
export const KNOWN_MODELS = Object.freeze(['claude-fable-5-2', 'claude-mythos-5-2', 'claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5',
  'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-5-5', 'claude-haiku-4-5']);

/**
 * The commands, in the order the settings card lists them: the recommended level, and the lowest one a command can run on
 * (`min` — the web search tool is not served on the light model).
 *   light — mechanical: a short, checkable answer from what is on the screen
 *   mid   — writing in the house voice from the product's data or the campaign's brief
 *   heavy — several steps with tools, reading screenshots into a sheet, numbers that decide money
 */
export const COMMANDS = Object.freeze({
  filter: { tier: 'light' }, rewrite: { tier: 'light' }, translate: { tier: 'light' }, kb: { tier: 'light' },
  write: { tier: 'mid' }, studio: { tier: 'mid' }, prompts: { tier: 'mid' }, marketing: { tier: 'mid' }, scenes: { tier: 'mid' }, agent: { tier: 'mid' },
  assistant: { tier: 'heavy' }, extract: { tier: 'heavy' }, buyer: { tier: 'heavy' }, research: { tier: 'heavy', min: 'mid' },
});
export const COMMAND_KEYS = Object.freeze(Object.keys(COMMANDS));

const rank = (t) => TIERS.indexOf(t);
/** A level a command may run on: the asked one, lifted to the command's lowest; an unknown one = the recommendation. */
export function tierFor(command, asked) {
  const c = COMMANDS[command]; if (!c) return 'mid';
  const t = TIERS.includes(asked) ? asked : c.tier;
  return c.min && rank(t) < rank(c.min) ? c.min : t;
}

/**
 * The row «ai» → { mode: 'auto' | 'single', tiers: { command: tier } } — only what differs from the recommendation is kept.
 * No `routing` key = auto with the recommendations (the owner: the routing is on by itself).
 */
export function routingOf(aiRow) {
  const r = isObj(aiRow) && isObj(aiRow.routing) ? aiRow.routing : {};
  const tiers = {};
  if (isObj(r.tiers)) for (const k of COMMAND_KEYS) { const t = str(r.tiers[k]); if (TIERS.includes(t) && tierFor(k, t) === t && t !== COMMANDS[k].tier) tiers[k] = t; }
  return { mode: str(r.mode) === 'single' ? 'single' : 'auto', tiers };
}
/** What the settings page may write under `routing` (the same cleaning — an unknown command or level is dropped). */
export const cleanRouting = (patch) => routingOf({ routing: patch });

/**
 * The model and effort of one command.
 *   base = { model, effort } — the admin's one model and effort (aiSettings of ai-content.js)
 *   single mode, or a command this table does not know → base as it is
 *   auto → the level's model; a light command runs at `low` effort, the others at the admin's effort
 */
export function routeOf(aiRow, command, base) {
  const b = { model: str(base && base.model) || TIER_MODEL.heavy, effort: str(base && base.effort) || 'medium' };
  const r = routingOf(aiRow);
  if (r.mode === 'single' || !COMMANDS[command]) return { ...b, tier: null };
  const tier = tierFor(command, r.tiers[command]);
  return { model: TIER_MODEL[tier], effort: tier === 'light' ? 'low' : b.effort, tier };
}

const family = (model, name) => { const id = str(model).toLowerCase(); return id === name || id.startsWith(name + '-'); };
/** The light model has no server-side fallback after a decline — the parameter (and its beta) is left out of its requests. */
export const hasFallback = (model) => !family(model, 'claude-haiku-5-5');
/** A forced tool call (`tool_choice` any / tool) is accepted by the light model only; the others answer 400. */
export const forcedToolOk = (model) => family(model, 'claude-haiku-5-5');
/** The request as its model accepts it (the fallback parameter off for the light model; nothing else is touched). */
export function claudeParams(params) {
  if (!isObj(params) || hasFallback(params.model) || !('fallbacks' in params)) return params;
  const { fallbacks: _f, betas, ...rest } = params;
  const left = Array.isArray(betas) ? betas.filter((b) => !/^server-side-fallback-/.test(String(b))) : [];
  return left.length ? { ...rest, betas: left } : rest;
}

/**
 * Anthropic's served list against this file's — for the developer's daily check.
 *   served = the model ids of GET /v1/models (strings); anything that is not a `claude-…` id is ignored
 *   → { fresh: ids served that this system does not know (the newest first as served),
 *       gone: the models it routes to that are no longer served }
 * A dated id counts as its family (claude-opus-5-5-20260901 = claude-opus-5-5).
 */
export function modelNews(served) {
  const ids = (Array.isArray(served) ? served : []).map((s) => str(s).toLowerCase()).filter((s) => /^claude-[a-z0-9.-]{3,60}$/.test(s));
  const same = (id, k) => id === k || (id.startsWith(k + '-') && /^\d{8}$/.test(id.slice(k.length + 1))); // claude-opus-5-6 is not claude-opus-5
  const fresh = [...new Set(ids.filter((id) => !KNOWN_MODELS.some((k) => same(id, k))))].slice(0, 10);
  const gone = ids.length ? [...new Set(Object.values(TIER_MODEL))].filter((m) => !ids.some((id) => same(id, m))) : [];
  return { fresh, gone };
}
