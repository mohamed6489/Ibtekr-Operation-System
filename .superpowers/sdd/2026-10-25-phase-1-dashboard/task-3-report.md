# Task 3 report — adapters IBPrefs, IBAlerts, IBActivity / IBDirectory extensions

**Status:** DONE_WITH_CONCERNS (all concerns are hand-offs/notes, nothing blocking)
**Commit:** `6b40b52` feat(adapters): user prefs, server alerts with per-user reads and realtime, recent activity; session data cleared on sign-out (base `7d50bf1`, branch `main-gha10e`, not pushed)

## What was implemented (per file)

- `app/js/adapter/prefs.js` (new) — `window.IBPrefs = { load, get, set, remove, clear }`.
  `load()`: `from('user_prefs').select('key, data').eq('user_id', uid)` → cache (Map) → `K.store.dashPrefs = K.store.dashPrefs || {}; K.store.dashPrefs[K.ME] = get('dashboard') || {}`. Error / no client / signed out → no-op (defaults kept), never throws.
  `set(key, data)`: cache + mirror (for `'dashboard'`) **before** the request, then `upsert({ user_id, key, data }, { onConflict: 'user_id,key' })` (built synchronously, before the first await) → `{ ok }`.
  `remove(key)`: cache + mirror first, then `delete().match({ user_id, key })` → `{ ok }`. Any error or throw → `{ ok:false }`.
  `clear()`: empties the cache **and** deletes `K.store.dashPrefs[K.ME]` (addition, see self-review).
- `app/js/adapter/alerts.js` (new) — `window.IBAlerts = { load, list, unread, markRead, markAllRead, subscribe, unsubscribe, clear, section, toneOf, relTime }`.
  `load()`: `alerts.select('id, at, kind, title, body, entity, entity_id').order('at', { ascending:false }).limit(200)` + `alert_reads.select('alert_id').eq('user_id', uid)` in parallel → `Alert = { id, at, kind, title, body, entity, entityId, read }` newest first; then dispatches `ib:notify` (addition: the bell is drawn before the alerts arrive, see concerns). Failed load leaves the previous state (`null` after `clear()`).
  `markRead(id)`: cache first, then `insert({ alert_id, user_id })`; `23505` = success; other error → `{ ok:false }` (mark stays local); then `ib:notify`.
  `markAllRead()`: only the unread ids, cache first, then `upsert(rows, { onConflict: 'alert_id,user_id', ignoreDuplicates: true })` (= `insert … on conflict do nothing`; no request when nothing is unread); then `ib:notify`.
  `subscribe()`: no-op without client / session / with `IB_CONFIG.realtime === false` / when already subscribed; else `channel('alerts').on('postgres_changes', { event:'INSERT', schema:'public', table:'alerts' }, …).subscribe()` — a new row goes first in the cache (dedup by id, cap 200) + `ib:notify`; a throw is swallowed. `unsubscribe()` → `removeChannel` (rejection swallowed). `clear()` → back to "not loaded".
  `toneOf`, `relTime` exactly per brief (`relTime` on an unparsable date → `''`, future → `'دلوقتي'`). `section()` → `null` before load, else the block-28-shaped section from the brief verbatim (`id 'server'`, `label 'النظام'`, `received: unread()`, `all: markAllRead`, tabs all/unread/read, items `sa:<id>`, `muted: read`, `run` = `markRead` + `window.location.hash = entity` only when it matches `/^[a-z][a-z0-9-]*(\/[\w-]+)?$/`).
- `app/js/adapter/activity.js` — `LOGGED_PREFIXES = ['auth.', 'dashboard.']`; `recent(limit = 5)` → `select('id, at, action, new_value, actor:profiles(name)').order('at', { ascending:false }).limit(limit)` → `Row = { id, at, actor ('—' when no name), action, detail (string as is, else JSON.stringify, null → '') }`, `[]` on error/signed out; `cached()` (`null` until the first refresh); `refresh()` → newest 5 into the cache (a failed read keeps the old cache, or `[]`), dispatches `ib:activity`, no-op when signed out / no client; `log()` → after a forwarded RPC without error → `refresh()` (awaited, so a caller's `logWithin` sees it finish before the sign-out request); `clear()`.
- `app/js/adapter/directory.js` — `load()` ends with `await Promise.allSettled([IBPrefs.load(), IBAlerts.load(), IBActivity.refresh()])` then `IBAlerts.subscribe()` (each only if present; a subscribe throw is swallowed) — **only when the signed-in row exists and is `active`** (addition, see self-review). New `clear()`: `K.store.members.length = 0` (same array), `meRow = null`, then `IBPrefs.clear()`, `IBAlerts.unsubscribe()`, `IBAlerts.clear()`, `IBActivity.clear()` (each guarded).
- `app/js/adapter/auth.js` — `signOut(scope)` calls `IBDirectory.clear()` (guarded) before `auth.signOut`.
- `app/index.html` — `<script src="js/adapter/prefs.js"></script><script src="js/adapter/alerts.js"></script>` right after `activity.js`, before the blocks.
- `tests/adapter/stub-supabase.mjs` (new, shared helper, not a `*.test.mjs`) — chainable stub client: `table(name)` (= `client.from`) whose `select/eq/order/limit/upsert/insert/delete/match` record a plain-cloned call and return the query; awaiting gives `responses[name]` (read at await time so a test can switch it); `channel()` → `{ on, subscribe }` or throws (`channelThrows`); `removeChannel`; `emit(row)` plays a Realtime INSERT; `opsOf(calls, table)`. **Choice:** shared helper, placed in `tests/adapter/` (not `tests/helpers/`) so the commit stays within the brief's Step 5 paths.
- `tests/adapter/prefs.test.mjs` (new, 7 tests), `tests/adapter/alerts.test.mjs` (new, 16 tests), `tests/adapter/activity.test.mjs` (3 old tests unchanged in body; helper extended with `from` + `document` + `Event`; 4 new tests).
- `tests/e2e/supabase-mock.mjs` — only the minimal stubs: `GET /rest/v1/(user_prefs|alerts|alert_reads|activity_log)` → `200 []` for a signed-in user (after the existing 401-for-anon check), and `realtime: false` in the `IB_CONFIG` injected by `attach` (covers `mock.attach(tabB)` too).

All brief test cases are present with the exact names and assertions. Extras: prefs — dashPrefs created when absent, no-client no-op; alerts — non-23505 error → `{ ok:false }`, `markAllRead` (only unread, ignore-duplicates, no request when none), non-hash entity not navigated (`javascript:` / `https://`), Realtime insert first + dedup + `unsubscribe`, `clear` / failed load → `null`, no-client no-throw; activity — forwarded log refreshes + `recent(20)`, signed out → `[]` and no query.

## TDD evidence

**RED** — `npm test` (after writing the three test files, before any adapter code):
```
not ok 2 - tests/adapter/alerts.test.mjs   # Error: ENOENT: no such file or directory, open '…/app/js/adapter/alerts.js'
not ok 3 - tests/adapter/prefs.test.mjs    # Error: ENOENT: no such file or directory, open '…/app/js/adapter/prefs.js'
not ok 4 - dashboard.customize is sent     # Expected values to be strictly deep-equal: + actual [] (prefix not forwarded)
not ok 5 - recent maps the embed and refresh dispatches ib:activity            error: 'A.cached is not a function'
not ok 6 - a forwarded log refreshes the cache; recent(limit) asks for that many error: 'A.cached is not a function'
not ok 7 - signed out: recent is empty and refresh asks nothing                  error: 'A.recent is not a function'
# tests 31  # pass 25  # fail 6
```
Expected: the two adapter files did not exist; `activity.js` had no `dashboard.` prefix and no `recent/cached/refresh`. The 3 old activity tests still passed.

**GREEN** — `npm test`:
```
# tests 52  # pass 52  # fail 0     (exit 0; no output besides TAP)
```
Focused: `node --test tests/adapter/*.test.mjs` → 30/30.

**GREEN** — `npm run e2e`:
```
Running 26 tests using 2 workers
  ✓ 1–26 (login.spec 1, auth.spec 25) …
  26 passed (45.2s)          (exit 0; afterEach asserts pageErrors == [] and mock.unhandled == [])
```

**Extra verification (not committed):**
- Throwaway browser probe (spec created, run, deleted): after admin sign-in the requests were `token, profiles, roles, user_prefs, alerts, alert_reads, activity_log, rpc/log_activity, activity_log, …`; state `{ me:'M01', dashPrefs:{ M01:{} }, section: non-null, activity: [], members: 4 }`; after «تسجيل الخروج»: `{ dashPrefs:{}, section:null, activity:null, members:0, me:null }`, `unhandled: []`, no page errors; the post-signout `GET activity_log` lands **before** `POST /auth/v1/logout`.
- `alert_reads` semantics on the real migrations (pre-installed local PG 16 cluster started, throwaway DB with `_local_auth_stub.sql` + 0001–0006, dropped afterwards, cluster stopped again): as `authenticated` (ops) — second plain insert → `23505`; `insert … select id from alerts on conflict (alert_id,user_id) do nothing` → `INSERT 0 1`, 2 reads, RLS hid the cs alert; `… on conflict do update` → `42501`. Confirms `markAllRead`'s ignore-duplicates upsert works with select+insert grants and a merging upsert would not.
- Mutation check 7/7 caught: markRead cache after the request (3 fails), `ignoreDuplicates:false`, 23505 not accepted, hash regex dropped, prefs set without write-through (3 fails), log without refresh, `'—'` fallback dropped.

## Files changed
`app/index.html`, `app/js/adapter/activity.js`, `app/js/adapter/alerts.js` (new), `app/js/adapter/auth.js`, `app/js/adapter/directory.js`, `app/js/adapter/prefs.js` (new), `tests/adapter/activity.test.mjs`, `tests/adapter/alerts.test.mjs` (new), `tests/adapter/prefs.test.mjs` (new), `tests/adapter/stub-supabase.mjs` (new), `tests/e2e/supabase-mock.mjs`. No file under `app/js/blocks/` touched (split/lock tests green).

## Self-review findings
- Every Produces name/signature exists; write-through order verified by tests (cache asserted before awaiting); every adapter call catches and answers `{ ok:false }` / `[]` / no-op; `IBDirectory.load()` ends with `allSettled` + `subscribe()`; `clear()` chain complete; English IIFE headers in the existing style.
- Deliberate deviations / additions (small, each with a reason):
  1. `IBDirectory.load()` skips the follow-up loads unless `meRow` exists and is `active` — otherwise `IBPrefs.load()` would write `K.store.dashPrefs[K.ME]` under a stale `K.ME` (no `setMe` without `meRow`) and a suspended member would open a Realtime channel before being signed out.
  2. `IBAlerts.load()` dispatches `ib:notify` — the bell (block 28) refreshes only on `window.load` and `ib:notify`, and the alerts arrive after both the gate and the sign-in path have drawn it; without it Task 5's "badge shows 1 after sign-in" would not hold. The `markRead` unit test resets `events` after `load()` so its `ib:notify` assertion still proves `markRead` dispatches.
  3. Realtime filter uses `event: 'INSERT'` (the supabase-js enum / documented form) instead of the brief's lowercase `'insert'`; realtime-js matches case-insensitively, the server-side form is the uppercase one.
  4. `IBPrefs.clear()` also deletes `K.store.dashPrefs[K.ME]`, so a later sign-in in the same page cannot show the previous member's layout (e.g. via «عرض كـ»).
  5. `IBActivity.refresh()` on a failed read keeps the previous cache or sets `[]` (so `cached() === null` keeps meaning "no client / never refreshed", which is what Task 4's fallback keys on); `log()` awaits the refresh.
  6. `IBAlerts.subscribe()` also requires a session (no anon channel).
- `npm test` output pristine; e2e no page errors, `mock.unhandled` empty.

## Concerns / hand-offs
- **Task 5 mock:** `markAllRead` sends ONE `POST /rest/v1/alert_reads?on_conflict=alert_id,user_id` with an **array** body and `Prefer: resolution=ignore-duplicates` (supabase-js upsert). The Task 5 brief's mock (`body.user_id !== u.id → 401`, duplicate → `409 23505`) assumes a single-object body; the Task 5 mock must accept an array (check each row; skip duplicates, answer `201`) — otherwise "mark all read" will get 401 and `alertReads` stays empty.
- Small race (pre-existing shape of `IBAuth.signOut`): `current` is nulled only after `auth.signOut` resolves, so a log RPC that resolves during that window can re-fill `IBActivity`'s cache after `clear()`. Harmless now and moot once Task 4 reloads the page after sign-out.
- semgrep is not installed in this sandbox (rule 8 applies before pushing; nothing was pushed).
- The local Postgres cluster used for the probe was down before and was stopped again; the throwaway database was dropped.
