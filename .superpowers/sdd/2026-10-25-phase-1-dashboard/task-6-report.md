# Task 6 report (Steps 1–3, docs only) — implementer

Status: DONE_WITH_CONCERNS (concerns are scope notes, not defects)
Branch: main-gha10e. Commit: 9a0139d `docs: phase 1 dashboard — edited blocks, migration order, realtime note` (only CLAUDE.md, tools/deploy.md, README.md; 21 insertions, 4 deletions). Not pushed. Step 4 skipped (controller).

## What changed

### CLAUDE.md
- «المراجع»: new line — phase-1 plan `docs/superpowers/plans/2026-10-25-phase-1-dashboard.md` and its ledger `.superpowers/sdd/2026-10-25-phase-1-dashboard/progress.md`.
- Rule 2: edited blocks so far are 14, 21, 25, 28 (phase 0: 14/21/28; phase 1: 25 + small additions in 21 and 28), each by a written plan decision; `EDITED` in `tests/split.test.mjs` with `tools/blocks.lock.json` catch any edit outside that list. Wording is «إضافات صغيرة» rather than «سطر واحد»: the phase-1 diff (332f2e6..HEAD) is +2/-1 lines in 21 (signOut reload, bell server section) and a few lines in 28 (SIGNED_OUT reload, stored login view), so "one-line" would be inexact.
- Rule 4: `0006_dashboard.sql` named next to `0004_grants.sql` as the latest example; `alert_reads` gets `select, insert` only on purpose.
- New «ملحوظة» under the settings-page note: `IBActivity.LOGGED_PREFIXES` in `app/js/adapter/activity.js` decides which `K.logEvent` actions reach `activity_log` (now `auth.` and `dashboard.`); each phase that wires a page to real data adds its prefix there.

### tools/deploy.md
- MCP note (before §2): the hold is for `delete from …` / `drop …` statements; the words in `on delete cascade` / `grant … delete` never caused a hold (`0001`/`0002`/`0004`/`0006` applied without one); the dynamic-SQL rewrite is for `rls_identity`/`rls_system`; `rls_dashboard.sql` has no `delete` and runs live unchanged.
- §2.1 table: the table only listed identity, system, seed_roles (NOT grants/advisors as the dispatch assumed). Added `grants` → 0004, `advisors` → 0005, `dashboard` → 0006 after the existing rows, existing rows untouched. Names match the live apply (phase-0 ledger: identity, seed_roles, system, grants, advisors; phase-1 ledger: dashboard).
- §2.1 tests: «الاختبارين» → «الاختبارات التلاتة» and added `rls_dashboard.sql` → `NOTICE: rls_dashboard: ok`.
- §2.1 Realtime note: `0006` adds `alerts` to `supabase_realtime` in a guarded `do $$` block (local stub has no publication); live check `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` → `alerts`; `wss://<ref>.supabase.co` already in `connect-src` of `app/.htaccess` (verified: `wss://fsynculhaupcktzkfkdd.supabase.co` is there).
- §2.2: two bullets — after 0006 the only addition is INFO «unused index» on the new tables (expected until the app writes to them); WARN «Leaked Password Protection Disabled» is an Auth dashboard setting for the owner (Authentication › Policies / Attack protection), not a migration.
- New §2.6 «الحالة على المشروع الحي» at the end of §2 (the file had no live-state part for the DB; §4.3's «الحالة الحالية» is about Git deploy): phase 0 (2026-10-22) migrations 0001–0005 applied, rls_identity/rls_system green; phase 1 (2026-10-25) `dashboard` (0006) applied, `rls_dashboard` green. The phase-0 line is from the phase-0 ledger (line 133); phase 0's live order was identity, seed_roles, system, so the line says «0001–0005» without implying order.
- §4 untouched.

### README.md
- One line under the description: «اللوحة (المرحلة 1)» runs on the real user — role frame from the profile, customization per user (`user_prefs`), server alerts in the bell with per-user read state (`alerts` + `alert_reads`), activity card from `activity_log`; KPIs and the other cards stay on prototype data until their pages are wired (phases 2–9).

## Suites (run after the edits, before the commit)
- `npm test`: `# tests 52 / # pass 52 / # fail 0`
- `npm run e2e`: `46 passed (46.4s)` (Chromium)
- `npm run db:test`: exit 0, 0 ERROR lines, `NOTICE: rls_dashboard: ok`, `NOTICE: rls_identity: ok`, `NOTICE: rls_system: ok`, `db-test: all passed`

## Self-review
- Every dispatch point present (CLAUDE.md ×4, deploy.md ×5, README ×1).
- Arabic in the same Egyptian register as the surrounding text; English only as identifiers, advisor titles («unused index», «Leaked Password Protection Disabled»), dashboard menu paths and the product name Realtime — same convention as existing lines (e.g. «Authentication › SMTP Settings»).
- No stale statements left: the old «أي نص فيه كلمة DELETE أو DROP» wording replaced; «الاختبارين» updated to three.
- Only the three files changed; §4 and everything else untouched.

## Concerns
1. Scope additions beyond the literal dispatch (for the controller to accept or trim): `grants`/`advisors` rows in the §2.1 table (missing, needed for a correct order), `rls_dashboard` in the §2.1 test list, and the phase-0 line in the new §2.6.
2. Rule 2 says «إضافات صغيرة» in 21 and 28 instead of "one-line additions" (see above).
