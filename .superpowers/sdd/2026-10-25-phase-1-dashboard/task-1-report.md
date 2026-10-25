# Task 1 report: 0006_dashboard.sql + rls_dashboard.sql

Status: DONE_WITH_CONCERNS (one wording concern, see Concerns)
Commit: f964713 feat(db): user_prefs, alert_reads, own rows in activity_log and realtime on alerts, with RLS tests
(only `supabase/` staged; not pushed)

## What was implemented

`supabase/migrations/0006_dashboard.sql`, in the brief's order:
- `public.user_prefs (user_id → profiles on delete cascade, key with the `^[a-z][a-z0-9_.-]{0,63}$` check, data jsonb not null default '{}', updated_at not null default now(), pk (user_id, key))`.
- `public.alert_reads (alert_id → alerts on delete cascade, user_id → profiles on delete cascade, read_at not null default now(), pk (alert_id, user_id))` + `alert_reads_user_id_idx (user_id)`.
- RLS enabled on both.
- `public.user_prefs_stamp()` (plpgsql, `set search_path = public`, `new.updated_at := now()`) + trigger `user_prefs_stamp` before insert or update; execute revoked from `public, anon, authenticated`.
- Policies: `user_prefs_owner for all to authenticated` (owner + active profile, using and with check); `alert_reads_select` (own rows); `alert_reads_insert` (own user_id + `exists` on alerts under the caller's `alerts_select`).
- Grants: user_prefs `select, insert, update, delete`; alert_reads `select, insert`; both to `authenticated, service_role`. `revoke truncate, references, trigger` on both tables from `anon, authenticated, service_role`.
- `alter policy activity_log_select` with the brief's exact expression (own rows while active, or settings.view <> 'N').
- Realtime guard: the brief's `do $$ … $$` verbatim (only line-wrapped).
- English header comment: purpose of each object and the alert_reads decision (why / cost if wrong).

Two cosmetic choices: references are schema-qualified (`public.profiles`, `public.alerts`, project style), and the
`alert_reads_insert` subquery says `a.id = alert_reads.alert_id` instead of bare `alert_id` (guards against column capture if
alerts ever gains an `alert_id`; Postgres stores the identical qual either way).

`supabase/tests/rls_dashboard.sql`: same shape as rls_identity.sql (begin, `set local role` + jwt claims per case,
`do $$ … raise exception 'case … failed' $$`, 42501 asserted via `sqlstate` with re-raise naming the case, `reset role; rollback;`
then `raise notice 'rls_dashboard: ok'`). Fixtures: users 1 admin / 2 ops / 3 suspended viewer / 4 cs with rls_identity's exact
values and emails; the three alerts exactly as the brief; alert ids stored with `set_config('t.a_ops' | 't.a_cs' | 't.a_admin', …, true)`
from a runner `do` block (no psql output). Every case in the brief is present:
- user_prefs: ops insert → 1; ops count = 1 (admin row written by runner hidden); ops update → 1 and `updated_at >= now()`;
  ops insert for admin → 42501; suspended insert → 42501; suspended read → 0.
- alert_reads: ops sees 1 alert (the ops one); ops marks ops alert → 1; cs alert → 42501; ops alert for admin → 42501;
  ops reads 1; admin reads 0; suspended viewer, each of the three alerts → 42501.
- activity_log: cs logs twice, ops once; cs reads = 2, all actor = cs; ops (P) >= 3; admin >= 3; runner suspends cs → cs reads 0.

Small additions beyond the listed cases (each tests a rule this migration introduces; CLAUDE.md rule 7):
1. Runner also writes a prefs row for the suspended viewer, so "suspended reads 0" is not vacuous.
2. The ops update passes a forged `updated_at = '2000-01-01'`, so `updated_at >= now()` proves the trigger stamps it.
3. Key format check: ops inserts key `'Dash board'` → 23514.
4. alert_reads has no update grant: ops update → 42501.
5. After cs is suspended, cs marking its own role alert read → 42501. The suspended viewer case alone is vacuous here
   (no fixture alert targets the viewer role or user 3), so this one isolates "suspended fails the same alerts_select policy".

## TDD evidence

RED (test written, migration absent): `npm run db:test`
```
db-test: migrate supabase/migrations/0005_advisors.sql
db-test: test supabase/tests/rls_dashboard.sql
psql:supabase/tests/rls_dashboard.sql:33: ERROR:  relation "public.user_prefs" does not exist
LINE 1: insert into public.user_prefs (user_id, key, data) values
```
Expected: the brief's Step 2 failure (first reference to the new table is the runner fixture insert).

GREEN: `npm run db:test`
```
db-test: migrate supabase/migrations/0006_dashboard.sql
db-test: test supabase/tests/rls_dashboard.sql
psql:supabase/tests/rls_dashboard.sql:277: NOTICE:  rls_dashboard: ok
db-test: test supabase/tests/rls_identity.sql
psql:supabase/tests/rls_identity.sql:210: NOTICE:  rls_identity: ok
db-test: test supabase/tests/rls_system.sql
psql:supabase/tests/rls_system.sql:361: NOTICE:  rls_system: ok
db-test: all passed
```
Output pristine: only the three `ok` notices plus db-test's echo lines.

`npm test`: 12/12 pass (untouched).

Extra verification (scratch databases only, nothing committed):
- Mutation run, each mutant applied in place of 0006 and caught by the intended case:
  no alerts `exists` in alert_reads_insert → "ops marks the cs alert read must error"; no alter policy → "cs reads own activity_log rows (2)";
  no trigger → "updated_at stamped by the trigger"; user_prefs without active check → "suspended viewer inserts own user_prefs must error";
  update granted on alert_reads → "ops updates alert_reads must error"; alert_reads_select `using (true)` → "admin reads zero alert_reads";
  activity_log own rows without active check → "suspended cs reads zero activity_log rows"; no key check → "key format check must error".
- Realtime guard on a DB with `create publication supabase_realtime`: after all migrations the publication holds exactly
  `public.alerts`; re-running the guard is a no-op (still 1 table).
- Grants as built: authenticated/service_role = DELETE,INSERT,SELECT,UPDATE on user_prefs and INSERT,SELECT on alert_reads; anon none;
  no TRUNCATE/REFERENCES/TRIGGER for API roles; `user_prefs_stamp()` not executable by anon/authenticated.

## Files changed
- /home/user/Ibtekr-Operation-System/supabase/migrations/0006_dashboard.sql (new, 95 lines)
- /home/user/Ibtekr-Operation-System/supabase/tests/rls_dashboard.sql (new, 277 lines)

## Self-review
- Completeness against the brief: every table, column, check, index, RLS enable, trigger + revoke, the three policies,
  grants, revokes, the alter policy and the Realtime guard are present; every listed test case is present with its exact
  expected outcome and error code.
- Conventions: lowercase SQL, `to authenticated`, `(select auth.uid())` / `(select public.has_perm(...))` inside policies,
  trigger function with `set search_path = public`, comment style of 0002.
- Test file has no `delete`, `drop` or `truncate` anywhere (comments included).
- No changes outside `supabase/`.

## Concerns
1. The controller's prompt says "no delete anywhere in the migration". The brief's verbatim DDL requires the word
   `delete` four times in 0006: `on delete cascade` (user_prefs.user_id, alert_reads.alert_id, alert_reads.user_id) and
   `grant select, insert, update, delete on public.user_prefs` (needed for `IBPrefs.remove` in Task 3). I followed the brief:
   there is no DELETE or DROP *statement*; the comments avoid both words. The phase-0 migrations 0001/0002/0004 have the same
   kinds of occurrence (`on delete cascade`, `grant … delete`, `for delete` policies) and were applied live. If
   `apply_migration` does hold 0006 on these words, the fallback is the phase-0 trick: apply the four clauses through
   `execute` with the keyword split across string literals. That is a live-apply change, not something to commit here.
2. `alert_reads_select` (verbatim from the brief) has no active-profile check, so a suspended user can still read their own
   read marks. This is harmless (their own rows only, and they see no alerts), but it differs from the other own-row policies.
