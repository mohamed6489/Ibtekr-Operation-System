# Phase 1 — final fix wave (single dispatch)

Branch `main-gha10e`, work from `/home/user/Ibtekr-Operation-System`. Commit per logical group (3–5 commits), do NOT push. Every item below is a controller ruling on the final whole-branch review + the docs review; apply all of them. Keep the prototype's one-line style in block edits; English header comments in adapters; Arabic (Egyptian) UI copy.

## A. Security — remember-me OFF + duplicated tab (Important 1)
With remember-me off the session lives in each tab's own `sessionStorage` (see `app/js/adapter/supabase-client.js`). A duplicated tab keeps a copy; supabase-js's cross-tab `SIGNED_OUT` only notifies listeners, so after our reload the gate finds the copied session and signs tab B straight back in (JWT valid ~1 h).
- Fix in `app/js/adapter/auth.js`: in the `onAuthStateChange` handler, when `event === 'SIGNED_OUT'`, remove the stored session from BOTH storages before the `subs` callbacks run: `try { const k = c().auth.storageKey; sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) { /* storage blocked */ }` (one line, comment: a SIGNED_OUT from another tab must not leave this tab's copy behind). If `storageKey` is not a public property of the vendored client, derive the key the same way supabase-js does (`'sb-' + <project ref> + '-auth-token'`) from `window.IB_CONFIG.supabaseUrl` and say so in the report.
- Unit test in `tests/adapter/` (extend the auth coverage or add `auth.test.mjs` with the shared stub): a SIGNED_OUT emitted by the stub client removes the key from both storages.
- E2E (mockOnly) in `tests/e2e/dashboard.spec.mjs`: sign in tab A with remember-me UNTICKED (`signIn(page, …, { remember: false })`), copy tab A's `sessionStorage` entries whose key starts with `sb-` into tab B (`tabB.evaluate` with the values read from tab A), `tabB.goto('/')` → `#root` visible in B; sign out from A's account menu → B shows `#login` and STAYS there after its reload (`#lg-title` = «تسجيل الدخول», `#root` hidden, `expect.poll` on `reloaded(tabB)`), `hasDevMembers(tabB)` false, and `mock.afterLogout === 0` after `tabB.clock`/a short `expect.poll` window. Also add the missing `expect(mock.afterLogout).toBe(0)` to the existing two-tab test, and remove the doubled blank line at the end of the spec.

## B. Bounded read-marks query (Important 2)
`app/js/adapter/alerts.js` loads `alert_reads` with `select('alert_id').eq('user_id', id)` — unbounded (PostgREST max_rows 1000). Fix: run the alerts query first, then load marks only for the loaded ids: `.select('alert_id').eq('user_id', uid).in('alert_id', ids)` (skip the marks query when there are no alerts). Update `tests/adapter/alerts.test.mjs` to pin the new chain (`in` with the loaded ids; no marks request when alerts are empty) and `tests/e2e/supabase-mock.mjs` to honour `alert_id=in.(1,2,…)` on `GET /rest/v1/alert_reads` (PostgREST syntax `in.(a,b)`), rejecting other filters as the mock does elsewhere.

## C. Adapter one-liners (Minors 4, 5)
- `app/js/adapter/activity.js`: `log()` must not call `refresh()` after `auth.signout` (the page is about to reload; it wastes a GET inside the 3 s sign-out window). Unit test: `log('auth.signout', …)` sends the RPC but no `activity_log` GET.
- `app/js/adapter/alerts.js`: `markRead(id)` is a no-op (resolves `{ ok: true }`, no request, no `ib:notify`) when the alert is already read. Unit test.

## D. SQL test covers the statements the app really sends (Minor 1)
Extend `supabase/tests/rls_dashboard.sql` (NO `delete`/`drop`/`truncate` words anywhere — it runs live unchanged): as ops — the prefs upsert `insert … on conflict (user_id, key) do update set data = excluded.data` run twice leaves one row with the new data; the read-mark `insert … on conflict (alert_id, user_id) do nothing` run twice leaves one row (`row_count` 0 on the second); a duplicate plain insert raises `23505`; a forged `updated_at` on INSERT is stamped (`>= now()`). Also fix the header comment to list 0005/0006 among the dependencies. Run `npm run db:test` (local Postgres 127.0.0.1:54329 is up) → all three `ok`.

## E. Copy ruling (Minor 2) — block 25 + lock
The failed-save toast in `app/js/blocks/25-page-dashboard.js` currently says «اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر» (plan text; wrong: the change lives in memory only). Replace with exactly: «اتطبّق دلوقتي بس — معرفناش نحفظه على السيرفر، جرّب تاني». Update the e2e that asserts the toast text. Run `npm run lock`.

## F. Docs (docs review Important + minors)
- `tools/deploy.md` MCP note (around line 21): replace the "statements vs words" explanation with what was actually observed: «اللي اتحجز فعلًا: جمل `delete from` في اختبارات RLS لما بتتشغّل عبر `execute_sql`؛ `apply_migration` عمره ما حجز حاجة (ولا حتى `delete from` جوّه `email_for_identifier` في `0001`، ولا `on delete cascade`/`for delete`/`grant … delete`). `drop` اتجنّبناه من الأول (`0005` بـ `alter policy`). `rls_dashboard.sql` مافيهوش `delete` خالص فبيتشغّل حي زي ما هو.»
- `tools/deploy.md` §2.2: the leaked-password toggle path → keep only «Authentication › Attack Protection» (drop «Policies»).
- `README.md`: the dashboard line also names «محتاج منك دلوقتي» as a consumer of server alerts.
- `supabase/migrations/0005_advisors.sql` line 3 comment and the comments at `supabase/tests/rls_identity.sql:178` / `rls_system.sql:107`: reword to match the deploy.md note (execute_sql holds `delete from` statements in test scripts; migrations never held). Comment-only edits; `npm run db:test` must stay green.

## Verification before each commit
`npm test` (unit), `npm run e2e` (full; Chromium installed), `npm run db:test`. Report exact counts. Append a fix report to `.superpowers/sdd/2026-10-25-phase-1-dashboard/final-fix-wave-report.md`: per item what changed, covering tests, command, output. Reply with the short contract (status, commits, test summary, concerns, report path). No subagents.
