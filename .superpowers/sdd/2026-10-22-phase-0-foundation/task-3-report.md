# Task 3 report: Supabase identity, `has_perm`, role seed, RLS tests

Status: DONE_WITH_CONCERNS (verified against local Postgres 16, not yet applied to the live project, as the ruling requires)
Commit: `22410c4 feat(db): identity, data-driven permissions (has_perm) and role seed with RLS tests`

## What was implemented

| File | Purpose |
|---|---|
| `supabase/config.toml` | `project_id = "fsynculhaupcktzkfkdd"` only |
| `supabase/migrations/0001_identity.sql` | tables `roles`, `profiles`, `invites` (schemas exactly as in the brief); `is_admin()`, `has_perm(key)`, `email_for_identifier(ident)`; the update-guard trigger `profiles_guard_update`; function grants; RLS policies |
| `supabase/migrations/0003_seed_roles.sql` | the six system roles (`admin, ops, cs, accounts, vendors_followup, viewer`), Arabic names and `ROLE_DESC` copied verbatim from block 17, `is_system = true`, `sort` 1..6, full 19-key matrix; `insert … on conflict (id) do update` |
| `supabase/tests/rls_identity.sql` | the transactional RLS test (rolls back, then prints `NOTICE: rls_identity: ok`) |
| `supabase/tests/_local_auth_stub.sql` | local-only stand-in for Supabase's `anon/authenticated/service_role`, `auth.users`, `auth.identities`, `auth.uid()/role()/jwt()` and default grants (header: never run on Supabase) |
| `tools/db-test.sh` | recreates `ibtekr_test`, applies the stub (with `--stub`), the migrations in order, then each non-`_` test; stops on the first failure |
| `package.json` | `"db:test": "bash tools/db-test.sh --stub"` |

The seed was generated from the brief's matrix with a one-off script, then read back from the database and checked row by row against the brief (output below).

`has_perm(key)` works like this: no profile → `'N'`; `role_id = 'admin'` → `'F'`; `custom_perms ? key` (the key exists, so an override of `'N'` beats the role) → `custom_perms->>key`; otherwise `roles.permissions->>key`; anything missing → `'N'`.

`email_for_identifier(ident)` lower-cases the input and strips whitespace and `-`. If the result contains `@`, it does an exact match on `lower(email)`. If it is exactly 11 digits, it does an exact match on `phone`. Anything else returns 0 rows. It returns only `(email, status)` and at most one row. It never uses `LIKE`: I checked that `%` and `%@%` return 0 rows.

## How each security requirement is met (in place of `get_advisors`)

All functions are owned by the migration role (`postgres`) and have `search_path = public` (checked through `pg_proc.proconfig`). Every reference inside them also uses a schema name (`public.` / `auth.`).

| Object | Security definer | search_path | EXECUTE granted to |
|---|---|---|---|
| `is_admin()` | yes, `stable` | `public` | authenticated, service_role (revoked from public and anon) |
| `has_perm(text)` | yes, `stable` | `public` | authenticated, service_role (revoked from public and anon) |
| `email_for_identifier(text)` | yes, `stable` | `public` | anon, authenticated, service_role (revoked from public) |
| `profiles_guard_update()` (trigger) | no, invoker | `public` | service_role only (revoked from public, anon, authenticated; triggers don't need EXECUTE to fire) |

| Table | RLS | Policies (all `to authenticated`; anon has none, so anon sees and writes nothing even with Supabase's default table grants) |
|---|---|---|
| `profiles` | enabled | select: `id = auth.uid() or has_perm('settings.view') <> 'N'`; update: own row or `is_admin()` (using + with check), and the trigger blocks non-admins from changing any column except `name, phone, twofa`; insert and delete: `is_admin()` |
| `roles` | enabled | select: `true`; insert, update, delete: `is_admin()` |
| `invites` | enabled | `for all`: `is_admin()` (using + with check) |

Policies, not missing grants, protect the sensitive write paths. The stub reproduces Supabase's `grant all … to anon, authenticated` defaults, and the tests pass under them.

## Test results

### RED (only `0001_identity.sql` present)
```
$ bash tools/db-test.sh --stub
db-test: recreating database ibtekr_test
db-test: WARNING applying supabase/tests/_local_auth_stub.sql (local Postgres only, never on Supabase)
db-test: migrate supabase/migrations/0001_identity.sql
db-test: test supabase/tests/rls_identity.sql
psql:supabase/tests/rls_identity.sql:21: ERROR:  insert or update on table "profiles" violates foreign key constraint "profiles_role_id_fkey"
DETAIL:  Key (role_id)=(admin) is not present in table "roles".
exit=3
```
It fails because `roles` is empty, as the brief predicts.

### GREEN (after `0003_seed_roles.sql`)
```
$ npm run db:test
db-test: recreating database ibtekr_test
db-test: WARNING applying supabase/tests/_local_auth_stub.sql (local Postgres only, never on Supabase)
db-test: migrate supabase/migrations/0001_identity.sql
db-test: migrate supabase/migrations/0003_seed_roles.sql
db-test: test supabase/tests/rls_identity.sql
psql:supabase/tests/rls_identity.sql:85: NOTICE:  rls_identity: ok
db-test: all passed
exit=0
```
`npm test`: 6/6 pass.

### Cases asserted in `rls_identity.sql`
- admin `has_perm('orders.edit') = 'F'`
- ops `has_perm('orders.edit') = 'F'` (comes from the `custom_perms` override; the role value is `P`)
- ops `has_perm('sensitive.commission') = 'N'`
- ops `update profiles set role_id = 'admin'` on own row must error (nested exception block; raises if no error happens)
- ops can update their own `name` (row_count = 1), which shows the guard doesn't block allowed columns (extra)
- suspended viewer `has_perm('orders.edit') = 'N'`, and `count(*) from profiles = 1`
- as `anon`: `email_for_identifier('01000000002')` → ops email, `active`; the viewer's email → `suspended`; `'01099999999'` → 0 rows
- as `anon`: `count(*) from profiles = 0` (extra)

### Mutation checks (temporary edits to 0001, then reverted)
- ignore `custom_perms` → `ERROR: case ops orders.edit = F (override) failed`
- disable the guard trigger → `ERROR: case ops update own role_id must error failed`
- profiles select `using (true)` → `ERROR: case viewer reads only own profile failed`

### Ad-hoc checks (not committed)
- override `{"orders.view":"N"}` on an ops user → `has_perm('orders.view') = 'N'`, role keys still `F`, unknown key → `'N'`
- `' X.DEV@IBTEKR.LOCAL '` resolves to the account; `%` and `%@%` → 0 rows
- non-admin updating own `custom_perms` → `only an admin can change this profile field`; non-admin insert into `roles` → RLS violation

### Seed read-back (matches the brief's matrix)
```
admin|1|أدمن|all 19 keys = F
ops|2|عمليات|accounts.add=N accounts.approve=N accounts.view=P orders.edit=P orders.export=F orders.status=F orders.view=F reports.export=F reports.view=F sensitive.commission=N sensitive.customer_phone=F sensitive.vendor_bank=N settings.team=N settings.view=P tickets.manage=F tickets.view=F vendors.edit=P vendors.toggle=N vendors.view=F
cs|3|خدمة العملاء|accounts.*=N orders.edit=N orders.export=N orders.status=F orders.view=F reports.export=N reports.view=P sensitive.customer_phone=F (other sensitive N) settings.*=N tickets.manage=F tickets.view=F vendors.edit=N vendors.toggle=N vendors.view=P
accounts|4|حسابات|accounts.add=F accounts.approve=P accounts.view=F orders.edit=N orders.export=F orders.status=N orders.view=F reports.export=F reports.view=F sensitive.vendor_bank=F (other sensitive N) settings.*=N tickets.*=N vendors.edit=N vendors.toggle=N vendors.view=F
vendors_followup|5|متابعة الموردين|accounts.*=N orders.edit=N orders.export=N orders.status=F orders.view=F reports.export=N reports.view=P sensitive.*=N settings.*=N tickets.manage=N tickets.view=P vendors.edit=F vendors.toggle=N vendors.view=F
viewer|6|مشاهد|orders.view=P vendors.view=P tickets.view=P reports.view=P, everything else N
```

## Deviations and decisions
1. **Local Postgres instead of the Supabase MCP** (ruling). The stub and `tools/db-test.sh` replace `apply_migration`/`execute_sql`. The table above replaces `get_advisors`.
2. **Tests run with `psql -q`** (the ruling listed only `-v ON_ERROR_STOP=1`). This suppresses `BEGIN/INSERT/SET/DO` tags so the output stays clean; NOTICEs and errors still print. The drop/create step uses `client_min_messages=warning` to hide the "does not exist, skipping" notice.
3. **Update guard is written as a whitelist.** The brief says self-update is "name, phone, twofa only" and that role_id/status/custom_perms are admin-only. The trigger blocks a non-admin from changing every other column (including email, manager_id, title, dept, member_code), not just those three.
4. **The guard applies only when `current_user` is `anon` or `authenticated`**, so `postgres` and `service_role` (migrations, server jobs, future invite acceptance) can still write.
5. **Admins can update any profile row** (the update policy is own row or `is_admin()`). The brief implies this ("role_id/status/custom_perms … for the admin only") but doesn't spell it out.
6. **EXECUTE on `is_admin`/`has_perm` is revoked from anon** (not required by the brief; it removes anon's access to everything except the login RPC).
7. Two extra assertions in the test (ops self-update of `name` succeeds; anon reads 0 profiles), so the guard and the anon boundary each have a positive check.

## Self-review
- Completeness: every brief step was done in order (test → 0001 → RED → 0003 → GREEN → commit), and all 6×19 matrix cells were checked against the read-back.
- Security: RLS is on all 3 tables; every definer function has a pinned search_path and is owned by postgres; `email_for_identifier` returns only email and status, exact match, max 1 row; anon can execute only that function and has no policies.
- Discipline: no extra tables, columns or policies. The only extra function is the trigger function, which the brief's "via trigger" requires. `app/` and `tests/` are untouched.
- Testing: every case raises on failure; the success NOTICE comes after `ROLLBACK` in its own DO block; the mutation checks show the cases catch regressions.

## Concerns
- **Not yet applied to the live project.** Postgres 16 locally vs 17 on Supabase; nothing here depends on a version, but the live run below still has to happen.
- **Suspended users keep their permissions.** `is_admin()`/`has_perm()` don't look at `status`, per the brief, so a suspended admin with a still-valid JWT is still admin until the login flow (Task 5) or session revocation blocks them. Consider adding `and status = 'active'` in a later task.
- **`email_for_identifier` lets anon check whether an account exists** (the brief requires this for login). Rate-limiting or captcha belongs to Task 5 / the Supabase auth settings.
- **For Task 4:** policies that call `has_perm`/`is_admin` should be `to authenticated`. Because anon has no EXECUTE on them, a policy without a role would make anon queries fail with "permission denied for function" instead of returning nothing (still denied, but noisy).
- `invites.created_by` has no FK, as the brief specifies.

## Live apply checklist (for a session with the Supabase MCP, project `fsynculhaupcktzkfkdd`)
Never apply `supabase/tests/_local_auth_stub.sql` to Supabase.
1. `apply_migration` name `identity`, query = contents of `supabase/migrations/0001_identity.sql`.
2. (Optional, to repeat RED) `execute_sql` with `supabase/tests/rls_identity.sql` → expect the FK error on `profiles_role_id_fkey`.
3. `apply_migration` name `seed_roles`, query = contents of `supabase/migrations/0003_seed_roles.sql`.
4. `execute_sql` with the contents of `supabase/tests/rls_identity.sql` → expect `NOTICE: rls_identity: ok`. Because of the ROLLBACK it leaves nothing behind. If `set local role` is refused in the MCP context, run it through `psql` as `postgres`.
5. `get_advisors` type `security` → expect no RLS-disabled or function-search-path warnings for `roles`, `profiles`, `invites`, `is_admin`, `has_perm`, `email_for_identifier`, `profiles_guard_update`.
6. (Optional) `select id, sort, name from public.roles order by sort` → 6 rows.
