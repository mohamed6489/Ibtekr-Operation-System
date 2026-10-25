# Phase 1: final fix wave report

Branch `main-gha10e`, base `cf8074c`. Five commits, not pushed. Status: **DONE**. Every item A–F is applied as written; nothing was skipped.

| Commit | Items | Subject |
|---|---|---|
| `7e4d2a1` | A + C | fix(auth): a cross-tab SIGNED_OUT clears this tab's stored session; no refresh after auth.signout; markRead no-op when read |
| `b310020` | B | fix(alerts): read marks only for the loaded alert ids (bounded by the alerts limit) |
| `12dcbaa` | D | test(db): rls_dashboard runs the statements the app sends |
| `fc68193` | E | fix(dashboard): failed-save toast says the change applies here only (block 25 + lock) |
| `996652f` | F | docs: MCP hold note matches what was observed; leaked-password path; README names the need card |

Baseline before the wave: `npm test` 52/52, `npm run e2e` 46/46, `npm run db:test` 3 × ok.
I did not commit `progress.md`: the controller had uncommitted ledger edits in it during this run. I also left this report uncommitted, as with earlier reports.

## A. Security: remember-me OFF + duplicated tab (Important 1)
- `app/js/adapter/auth.js:11-13`: a new one-line `forget()` runs `try { const k = c().auth.storageKey; sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* storage blocked */ }`. A one-line comment above it says a SIGNED_OUT from another tab must not leave this tab's copy behind. The `onAuthStateChange` handler calls `forget()` when `event === 'SIGNED_OUT'`, before the `subs` callbacks run.
- `storageKey` check: the vendored client has it as a public property. GoTrueClient's constructor runs `this.storageKey=r.storageKey`, and SupabaseClient passes `storageKey: sb-${hostname.split('.')[0]}-auth-token` (seen with grep in `app/js/vendor/supabase.js`). So `c().auth.storageKey` is used and no fallback was needed. The same grep shows the cross-tab handler only calls `_notifyAllSubscribers(event, session, false)` and never touches storage, which is the root cause.
- Unit test: new file `tests/adapter/auth.test.mjs` with 3 tests. It runs the shared stub in `node:vm` with in-memory local and session storage:
  - `:22`: SIGNED_OUT removes the key from both storages before the listener runs. The listener sees `null`/`null`, `ib.remember` is untouched, and `session()` is `null`.
  - `:33`: other events (TOKEN_REFRESHED) leave both copies alone.
  - `:43`: with storage blocked, SIGNED_OUT still reaches every listener and nothing throws.
  - Red/green check: with `auth.js` stashed, test 1 fails (1 of 3). With the fix, 3/3 pass.
- Stub: `tests/adapter/stub-supabase.mjs:6,27-33` gives the client an `auth` object (`storageKey`, `getSession` with nothing stored, `onAuthStateChange`) and adds `emitAuth(event, session)`. `:7` adds `in` to the recorded builder ops (for B).
- E2E (mockOnly), `tests/e2e/dashboard.spec.mjs:349` «remember-me off, duplicated tab…»:
  - Context clock installed. Tab A signs in with `{ remember: false }`; `signIn` gained the option at `:27`, same as in auth.spec.
  - Tab A's `sb-*` sessionStorage entries are copied into tab B with `tabB.evaluate` after its first `goto('/')`. Then `tabB.goto('/')` shows `#root`, and `hasDevMembers` is true.
  - Tab A signs out from its account menu. `expect.poll(reloaded(tabB))`, then B shows `#login` with `#lg-title` «تسجيل الدخول», `#root` hidden, `hasDevMembers(tabB)` false, and no `sb-*` key in either storage.
  - After `tabB.clock.runFor('00:30')`, `#root` is still hidden, `mock.afterLogout === 0`, `logoutScopes` is `['local']`, and tab B had no page errors.
  - Red/green check: without the fix the test fails on `afterLogout` (Expected 0, Received 3). B reloaded, found the copied session and called the server with it. With the fix it passes. `--repeat-each 5` on this test, the two-tab test and the 23505 test: 15/15 passed.
- The existing two-tab test now also asserts `expect(mock.afterLogout).toBe(0)` (`:345`). The doubled blank line between the describe's tests is gone.
- Note (a behaviour change, intended by the ruling): a sign-out in any tab now clears the stored session of every open tab of the origin, including a tab that signed in on its own with remember-me off. Before, that tab already reloaded on SIGNED_OUT (block 28) and would then have signed back in from its own copy.

## B. Bounded read-marks query (Important 2)
- `app/js/adapter/alerts.js:23-30`: the alerts query runs first. The marks are then asked only for the loaded ids with `.select('alert_id').eq('user_id', id).in('alert_id', ids)`, so at most LIMIT=200 rows. With no alerts there is no marks request. A failed marks read still leaves `items` null.
- The header comment (`:2-4`) explains the bound.
- Unit tests in `tests/adapter/alerts.test.mjs`:
  - `:19`: pins the chain `select → eq(user_id,'u2') → in('alert_id',[2,1])` and checks the marks request comes after the alerts request.
  - `:173`: with no alerts, no alert_reads request is made, the section is empty and `ib:notify` is still sent.
  - `:182`: a failed marks read leaves `section()` null.
- Mock, `tests/e2e/supabase-mock.mjs:63-70,161-162`: `readFilters(params, table)` accepts `in.(a,b,…)` (quoted values unquoted) only where `IN_FILTERS` allows it, which is `alert_reads.alert_id`. Any other non-`eq.` filter is still answered with 400 PGRST100.
- Red/green check: with the old mock, «a role alert from the server…» and «mark all read…» fail (the 400 means no «النظام» section). With the new mock, both pass. Those two tests reload and get the read state back from the server, so they cover the e2e side.

## C. Adapter one-liners (Minors 4, 5)
- `app/js/adapter/activity.js:38`: `.then((res) => ((res && res.error) || action === 'auth.signout' ? undefined : refresh()))`. The header comment at `:8-9` is updated.
  - Unit test `tests/adapter/activity.test.mjs:74`: `log('auth.signout','يدوي')` sends the RPC, makes no activity_log query, leaves `cached()` null and sends no `ib:activity`.
- `app/js/adapter/alerts.js:39-44`: `markRead` returns `{ ok: true }` when the cached alert is already read: no request, no `ib:notify`. The header comment at `:5-6` is updated.
  - Unit test `tests/adapter/alerts.test.mjs:41`: alert 1 (read at load) makes no call and sends no event. Alert 2 is written once; a second `markRead(2)` makes no call.
- Red/green check: with the two adapters stashed, these two tests fail (2 of 35 adapter tests). With the fix, 35/35 pass.
- Needed e2e update: `dashboard.spec.mjs:245`. The old second `markRead(2)` is now a no-op, so the 23505 path is reached on purpose:
  1. The test pushes the mark into `mock.alertReads` after load («read on another device»).
  2. `markRead(2)` then gets 409/23505, which counts as `{ ok: true }`.
  3. A third call sends no POST: the count stays at 2.

## D. SQL test covers the statements the app sends (Minor 1)
`supabase/tests/rls_dashboard.sql`:
- Header (`:2`) lists 0005_advisors and 0006_dashboard among the dependencies. `:5-7` says which app statements the file covers and that nothing in it removes rows or objects.
- Setup: a new alert addressed to the ops user (`:44`, `t.a_ops_user` at `:51`). The ops visibility case now expects 2 alerts (role + own). The ops read-mark count is now 2 rows (`:241`). The suspended viewer's loop also tries the new alert.
- As ops:
  - Prefs save: `insert … on conflict (user_id, key) do update set data = excluded.data`, run twice on a fresh key (`:80-101`). The first run inserts (row_count 1), the second updates (row_count 1), and one row is left with the newer data.
  - Forged `updated_at = '2000-01-01'` on INSERT: stamped `>= now()` (`:103-111`).
  - Duplicate plain read mark: `23505` (`:174-185`).
  - Mark-all: `insert … on conflict (alert_id, user_id) do nothing`, run twice (`:187-205`). row_count is 1, then 0, and one row is left.
- `grep -ciE "delete|drop|truncate" supabase/tests/rls_dashboard.sql` returns 0.
- Mutation check: changing the expected second-run row_count to 1 makes the test fail with «case ops mark-all on conflict do nothing, second run row_count 0 failed». Changing the expected upsert data makes it fail with «case ops prefs upsert twice leaves one row with the new data failed». After restoring the file, all pass.
- `npm run db:test`: `rls_dashboard: ok` (now at line 348), `rls_identity: ok`, `rls_system: ok`, `db-test: all passed`.

## E. Copy ruling (Minor 2): block 25 + lock
- `app/js/blocks/25-page-dashboard.js:171`: the toast is now exactly «اتطبّق دلوقتي بس — معرفناش نحفظه على السيرفر، جرّب تاني».
- `tests/e2e/dashboard.spec.mjs:119,127`: the test title becomes «…applies to this page only and says so» and it asserts the new text.
- `npm run lock`: «tools/blocks.lock.json: 29 blocks, edited since the split: 14-kit.js, 21-shell.js, 25-page-dashboard.js, 28-app.js». Only the `current` hash of 25 changed. `tests/split.test.mjs` already lists 25 and passes.
- The old wording still appears in the plan (`docs/superpowers/plans/2026-10-25-phase-1-dashboard.md:186`) and in sdd history files. Those were left alone as records.

## F. Docs
- `tools/deploy.md:21`: the "statements vs words" explanation is replaced with the brief's text, word for word. The practical way to run `rls_identity`/`rls_system` through MCP (`execute 'del' || 'ete …'`) is kept after it.
- `tools/deploy.md:57`: the leaked-password path is «Authentication › Attack Protection» only.
- `README.md:5`: «وتنبيهات السيرفر في الجرس وفي «محتاج منك دلوقتي» بحالة قراءة لكل واحد».
- Comment-only edits:
  - `supabase/migrations/0005_advisors.sql:3-5`: drop was avoided from the start; the MCP held only `delete from` statements in the RLS test scripts run through execute_sql; apply_migration never held anything; see tools/deploy.md.
  - `supabase/tests/rls_identity.sql:178` and `supabase/tests/rls_system.sql:107`: «live: the Supabase MCP's execute_sql holds `delete from` in test scripts for a confirmation; run the execute 'del' || 'ete …' copy, see tools/deploy.md».
- `npm run db:test` stays green.
- A grep for the old wording (`بتحجز`, `holds any`, `bare DELETE`, `Authentication › Policies`) outside `.superpowers/` and `node_modules`: no hits.

## Final suites (run on 996652f's tree, before the last commit)
- `npm test`: tests 59, pass 59, fail 0, skipped 0. That is 52 before plus 7 new: auth ×3, activity ×1, alerts ×3.
- `npm run e2e`: 47 passed (46.8s). That is 46 before plus the duplicated-tab test.
- `npm run db:test`: `rls_dashboard: ok`, `rls_identity: ok`, `rls_system: ok`, `db-test: all passed`.
- Extra check: local semgrep (the javascript and generic/secrets rules in /tmp/semgrep-rules) on the changed adapter, test, mock, block 25 and SQL files. 2 findings, both from before this wave: `unsafe-dynamic-method` at block 25:159 (accepted in Task 6) and `detect-non-literal-regexp` in the test helper `bellSection` at dashboard.spec.mjs:51. No finding in the new code.

## Concerns
- None blocking.
- One behaviour note, under A: a sign-out in one tab now clears independent remember-me-off sessions in other tabs too.
