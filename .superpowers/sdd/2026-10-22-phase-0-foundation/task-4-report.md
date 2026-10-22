# Task 4 report: system tables (migration 0002)

**Status:** DONE_WITH_CONCERNS (minor, see Concerns)
**Commit:** `8edab23 feat(db): settings, status map, activity log and alerts with RLS tests`

## What I built

`supabase/migrations/0002_system.sql`:
- Tables exactly as the brief lists them: `settings`, `status_map`, `activity_log`, `alerts`, `notification_prefs`. Two additions: a `unique` on `status_map.system_status` (the ruling asks for it so `on conflict` works), and four indexes (`activity_log(at desc)`, plus `activity_log.actor`, `alerts.role_id`, `alerts.user_id`, which keeps the advisor's unindexed-FK check quiet). No other tables or columns.
- RLS is on for all five tables.
- Triggers. All of them `set search_path = public`, and execute is revoked from public, anon and authenticated:
  - `settings_stamp` runs before insert/update and sets `updated_at = now()` and `updated_by = auth.uid()`.
  - `activity_log_actor` runs before insert and sets `actor = auth.uid()`, whatever the caller passed.
  - `alerts_guard_update` runs before update. For the API roles (anon, authenticated) it raises 42501 when any column other than `read_at` changes, using the same pattern as `profiles_guard_update`. postgres and service_role are trusted.
- `log_activity(action, entity, entity_id, old_value, new_value) returns void`: SQL, `security invoker`, `search_path = public`. It inserts through RLS. Execute is revoked from public and anon and granted to authenticated and service_role. No new definer functions.
- Policies. Every one is `to authenticated`. Initplans are wrapped as `(select …)`.
  - **settings**: select needs `has_perm('settings.view') <> 'N'`. Insert and update (both `using` and `with check`): for `team`, `integrations` or `security` it needs `has_perm('settings.team') = 'F'`; for any other section it needs `is_admin()`. Because the `with check` applies the rule to the new row, moving a row into an admin-only section is refused. Delete needs `is_admin()`.
  - **status_map**: select needs `has_perm('orders.view') <> 'N'`. Insert, update and delete need `is_admin()`.
  - **activity_log**: insert needs the caller's profile to be active (an `exists` on `profiles`). Select needs `has_perm('settings.view') <> 'N'`. There is no update or delete policy.
  - **alerts**: select and update need an active caller profile where `user_id = p.id or role_id = p.role_id`. The update column limit comes from the trigger. Insert and delete need `is_admin()`.
  - **notification_prefs**: one `for all` policy. `user_id = auth.uid()` plus an active profile, in both `using` and `with check`.
- Seeds use `on conflict do nothing`:
  - The ten `settings` sections. `general` is `C.general` from block 17, line 25, copied verbatim, all 16 keys. The other nine are `'{}'`.
  - Six `status_map` rows in `STATUS_ORDER` order, with the brief's `woo_status` values, `direction = 'both'` and `sort` 1..6.
  - Nothing that references `roles`.

## Tests: `supabase/tests/rls_system.sql` (Task 3 style)

There are five users: an admin, ops, an active viewer, a suspended viewer, and a team manager (ops role with custom `settings.team = F`). The tests cover:
- **Seeds:** the ten sections; every key of `general`; the `status_map` order and mapping; `direction = 'both'` on every row.
- **Admin:** updates `general`, with `updated_by`/`updated_at` set by the trigger. Inserts and deletes another section. Updates `status_map`. Inserts alerts.
- **Ops:** reads all 10 sections and `general`. Updates to `general` and `team` and to `status_map` affect 0 rows, and inserting a section raises 42501.
  - `log_activity('test','x','1',null,'{"a":1}')` writes a row whose `actor` is ops.
  - An inserted `actor` that points at the admin is overwritten with ops.
  - Update and delete on `activity_log` affect 0 rows.
- **Team manager:** updates `team`, `integrations` and `security` (3 rows, `updated_by` set). Updating `general` affects 0 rows. Moving `team` to `misc` raises 42501 (from the `with check`).
- **Active viewer:**
  - Reads 0 settings and 0 activity rows, and all 6 `status_map` rows.
  - Sees the alert for its own role and the one addressed to it, but not the ops alert. Marking its own-role alert read affects 1 row; marking the ops alert affects 0 rows; delete affects 0 rows. Changing an alert's `title` raises 42501, and inserting an alert raises 42501.
  - Can call `log_activity`.
  - Prefs: sees only its own; updating another user's prefs affects 0 rows; inserting prefs for another user raises 42501.
  - Inserting into `status_map` raises 42501.
- **Suspended viewer:** sees 0 alerts even though an alert targets the viewer role. Sees 0 prefs (a row exists), 0 `status_map` rows and 0 settings. `log_activity` raises 42501.
- **anon:** gets 0 rows from all five tables. A 42501 would also be accepted, but the test fails if the error text mentions a function, which is what an execute-denied error inside a policy would say. anon calling `log_activity` raises 42501.
- **Runner:** at the end exactly 3 `activity_log` rows exist, and the viewer's row has `actor = viewer`.

Mutation checks I ran by hand on `ibtekr_test`, each caught by a named case:
- removing the `status='active'` check from `alerts_select`
- dropping the actor trigger
- dropping the alerts guard trigger

## RED / GREEN

RED (test written, no 0002):
```
db-test: migrate supabase/migrations/0001_identity.sql
db-test: migrate supabase/migrations/0003_seed_roles.sql
db-test: test supabase/tests/rls_identity.sql
psql:supabase/tests/rls_identity.sql:138: NOTICE:  rls_identity: ok
db-test: test supabase/tests/rls_system.sql
psql:supabase/tests/rls_system.sql:35: ERROR:  relation "public.notification_prefs" does not exist
```
GREEN:
```
db-test: migrate supabase/migrations/0001_identity.sql
db-test: migrate supabase/migrations/0002_system.sql
db-test: migrate supabase/migrations/0003_seed_roles.sql
db-test: test supabase/tests/rls_identity.sql
psql:supabase/tests/rls_identity.sql:138: NOTICE:  rls_identity: ok
db-test: test supabase/tests/rls_system.sql
psql:supabase/tests/rls_system.sql:315: NOTICE:  rls_system: ok
db-test: all passed
```
`npm test`: 6 tests, 6 pass, 0 fail.

## Files

- `supabase/migrations/0002_system.sql` (new)
- `supabase/tests/rls_system.sql` (new)

## Decisions / deviations

- The Step 2 MCP calls are replaced by the local `npm run db:test`, per the ruling.
- I did not add a check constraint that limits `settings.section` to the ten names. The write rule "every other section → admin" implies other sections can exist.
- `activity_log` insert is allowed for any **active** user, not "any registered" user, so that suspension blocks it as the ruling requires. `actor` is forced on every insert, including service_role inserts, where it becomes null.
- `alerts` update is limited to the owner/role condition. Admins get no extra update right (the brief does not grant one), and the guard applies to admins too.
- `notification_prefs` uses one `for all` policy instead of four separate ones. It has the same effect and avoids the advisor's multiple-permissive-policies warning.

## Self-review

- Every policy is `to authenticated`. Verified: `pg_policies` has no `public` policy without `authenticated` in its roles.
- RLS is enabled on all tables in `public` (checked in `pg_tables`).
- No definer functions were added. All new functions pin `search_path`.
- The `log_activity` grants match the Task 3 pattern.
- No extra tables or columns.

## Concerns

1. Performance advisor, `auth_rls_initplan`: `0001`'s `profiles_select`/`profiles_update` call `auth.uid()` per row without `(select …)`, so the live advisor will probably report WARN-level lints for them. 0002 avoids this. I did not change 0001; a one-line follow-up there would fix it.
2. `0001` does not index `profiles.role_id`/`manager_id` or `invites.role_id`, so the advisor's INFO-level unindexed-FK lint may list them. They belong to 0001, so I left them alone.
3. The `alerts` and `notification_prefs` policies run a subquery on `profiles`, which is itself under RLS: the caller's own row is visible through `id = auth.uid()`. This works, but it means the `profiles_select` policy is evaluated too. It is cheap at this scale.

## Live apply checklist

1. `apply_migration` with name `system` and the contents of `supabase/migrations/0002_system.sql`. 0003 has already been applied live, and 0002 does not depend on its rows.
2. `execute_sql` with the contents of `supabase/tests/rls_system.sql`. Expect `NOTICE rls_system: ok` and no ERROR. It rolls back.
3. `get_advisors` with type `security`: should show nothing new from 0002. Then type `performance`: only the 0001 items from Concerns 1 and 2 are expected.
4. Spot check: `select section from settings order by 1` gives 10 rows, and `select * from status_map order by sort` gives 6 rows.

---

## Fix round 1

Commit: `fix(db): activity_log id/at forced by trigger, role alerts read-only for members` (SHA in the reply / `git log`).

### Finding 1: `activity_log` forgery and jamming
- `activity_log_actor` (before insert) now also sets `new.at := now()` and `new.id := nextval(pg_get_serial_sequence('public.activity_log', 'id'))`. A client-supplied `id` or `at` is discarded, so rows cannot be backdated and no one can plant ids ahead of the sequence.
- `revoke update, delete, truncate on public.activity_log from anon, authenticated, service_role`. "No update/delete" now holds at the grant level as well as in RLS, and the RLS is unchanged.
- Tests:
  - New: ops inserts with `id = 999999` and `at = '2000-01-01'`. The returned `id` is not 999999 and equals `currval` of the sequence, and `at` falls within the last minute.
  - Changed: the ops `update` and `delete` cases on `activity_log` used to expect 0 rows. They now expect 42501.
  - Changed: the final row count went from 3 to 4, because of the new forged-insert case.
- Side effect: when the client omits `id`, the column default calls `nextval` and the trigger calls it again, so each insert uses two sequence numbers. There are gaps but no collisions. This is harmless, and it is what the ruling asked for.

### Finding 2: role-wide `read_at` was shared
- `alerts_update` (`using` and `with check`) is now `user_id = auth.uid()` plus the active-profile check. Role-wide alerts can still be selected by the role but members cannot update them. A one-line comment above the policy records that per-user read state for role alerts comes in phase 1 as `alert_reads`. `alerts_select` is unchanged.
- Tests:
  - The viewer marks its user-targeted alert read: 1 row.
  - The viewer's update on the role-wide alert affects 0 rows (the RLS `using` filters it out), and its `read_at` stays null.
  - The guard case (changing `title` raises 42501) now targets the user alert, since the role alert is no longer updatable.

### Evidence
- `npm run db:test`: `rls_identity: ok`, `rls_system: ok`, "db-test: all passed", and no ERROR or WARNING lines.
- `npm test`: 6/6.
- Mutation checks, each caught by the named case:
  - the old trigger (actor only) → "id forced to the sequence"
  - `grant update` restored → "update denied (42501)"
  - `alerts_update` set to `using (true)` → "cannot mark a role-wide alert read"

### Concerns
No new concerns from this round. The 0001 advisor items listed earlier still stand.
