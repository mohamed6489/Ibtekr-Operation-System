# Review — Phase 3.1 Task A (`main-gha10e`, c4800e4..fadb057: 43da0ae, 403a9f0, 59ae8c5, fadb057)

Reviewer: independent, adversarial, read-only (no tracked file touched, nothing committed or pushed).
Files under review: `supabase/migrations/0012_vendor_logins.sql`, `supabase/tests/rls_vendor_logins.sql`,
`supabase/tests/migrate_0012.sql`, `tools/deploy.md` (+78/−2), `CLAUDE.md` (+2), the report
`.superpowers/sdd/2026-10-26-phase-3-1-add-maker/p31-a-report.md`. The diff touches nothing else (`git diff --stat`: 6 files).

## Verdict: **needs fixes** (one Important test change + one Important runbook pre-check; the migration itself is sound)

No Critical finding. `0012_vendor_logins.sql` implements decisions 3, 4 and 6 as written; every client path to
`secret_id` / the Vault value I could think of is closed; the guard, the RLS and the grants match the role matrix; the
file is re-runnable and CI-compatible. The two Important findings are (I1) the live test counts `activity_log` rows
globally and will go red on the live project the first time it is re-run after a real password set / reveal, and (I2)
the real `supabase_vault` path (`vault.update_secret` as `postgres`) has never run and the runbook has no pre-check for
it. Both are small, neither touches the migration's behaviour.

## What I ran

| Run | Result |
|---|---|
| `npm test` | 189 / 189 pass |
| `npm run db:test` (local cluster on 54329, Postgres 16, no Vault, `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres`) | 12 migrations apply, 11 test files `ok` incl. `migrate_0012: ok`, `rls_vendor_logins: ok`, `rls_vendors: ok` — this fresh database also exercised the **drop path** of decision 6 (0007 → 0012), and the "one status check" assertion of `rls_vendor_logins.sql:63-71` held afterwards |
| Scratch db `ibtekr_review31a` (auth stub + the implementer's `p31a-vault-stub.sql` + all migrations), `rls_vendor_logins.sql` | `ok` on the **with-Vault** branch; `vault.secrets` has 0 `vendor-login:%` rows after the rollback (reproduces the report's claim) |
| 40 adversarial probes as `authenticated` (admin / ops / a custom-perms member), `anon`, `service_role`, the runner — scripts in `/tmp/claude-0/-home-user-Ibtekr-Operation-System/b7ebe23b-85b1-5309-bb27-b4b93f177587/scratchpad/review-31a/probes-*.sql` | results cited below; scratch db dropped afterwards, `ibtekr_test` left as `db:test` leaves it |
| `to_regclass('vault.decrypted_secrets')` as `authenticated` on the stub db | `ERROR: permission denied for schema vault` — the implementer's choice 10 (decide Vault presence as the runner) is correct |
| One committed `vendor.login.reveal` row planted in the scratch db, then `rls_vendor_logins.sql` again | **fails** at `rls_vendor_logins.sql:417` ("case the RPCs write one activity_log row per call … failed") — evidence for I1 |

Not run: `npm run e2e` (nothing of Task A reaches the UI), semgrep (SQL/Markdown only; the report's offline run is plausible), anything on the live project (the plan reserves live SQL for the owner's go-ahead; the one read-only query I would want is in I2).

## Findings

### Important

**I1 — `rls_vendor_logins.sql` is not re-runnable on the live project once real `vendor.login.*` rows exist** (Q6, Q7).
`rls_vendor_logins.sql:395` asserts `(select count(*) from public.activity_log where action like 'vendor.login.%') = 5`,
`:411` `= 0` (no-Vault branch), and `:669-671` `= 7` / `= 2` for actor …52 — all unscoped to the test's own rows.
The runbook (`tools/deploy.md` §2.1) re-runs the seven live tests on every phase deploy, and Task B's UI will write
`vendor.login.password` / `vendor.login.reveal` rows from day one, so the second live run of this file is guaranteed red
(reproduced: one planted row → failure at line 417, the diagnostic lists the foreign row first). The sibling tests
`rls_system.sql:354` / `rls_dashboard.sql:305` have the same shape, but on an action prefix nothing else writes yet;
here the prefix is exactly what the new feature writes.
*Minimal fix:* scope the four counts to the test's own rows, e.g. `and entity_id in ('…00d1','…00d2','…00d3')`
(or `and actor in ('…51','…52')`), and the `like any (array['%Test1234%','%Test5678%'])` grep at `:378-382` to
`entity_id in (…)` as well. No migration change.

**I2 — The real `supabase_vault` path has never run; the runbook has no pre-check for it** (Q2, Q7; the report's concern 1).
`0012_vendor_logins.sql:209` calls `vault.create_secret(text, text, text)` (0008 proved `postgres` may call it on the
live project) and `:211` calls `vault.update_secret(uuid, text)`, which nothing in this project has ever executed as
`postgres`; the reveal (`:249`) reads `vault.decrypted_secrets`, which 0008's `sync_secret_matches` already does live.
The stub mirrors the 0.3.x signatures correctly (`create_secret(new_secret, new_name, new_description, new_key_id)`,
`update_secret(secret_id, new_secret, …)` with coalesce semantics, a unique `name`), so the only open question is the
EXECUTE privilege of `postgres` on `vault.update_secret` on the live project. If it is missing, the second
`set_password` in the admin block (`rls_vendor_logins.sql:355`) fails with 42501 inside the rollback — safe, but then the
migration's "update, never recreate" design (`:208-212`) needs a decision, not a test re-run.
*Minimal fix:* add one read-only line to `tools/deploy.md` §2.1 "قبل" (`+314-326`):
`select has_function_privilege('postgres', 'vault.create_secret(text,text,text,uuid)', 'execute'), has_function_privilege('postgres', 'vault.update_secret(uuid,text,text,text,uuid)', 'execute'); -- true / true`
and keep the plan's order (0012 live → `rls_vendor_logins` live → `main`) as the gate; nothing of Task B should reach
`main` before that live `ok`.

### Minor

**M1 — Orphan Vault secrets after a maker delete** (Q2; the report's concern 2). Confirmed on the scratch db: deleting
the maker cascades the `vendor_logins` row and leaves `vault.secrets` row `vendor-login:<uuid>` behind (probe V1). The
migration says so (`0012:58-60`) and the plan lists it as Later. Harmless for access (only Vault readers see it) but it
keeps a plaintext-recoverable temporary password forever. When the owner decides: an `after delete` trigger on
`vendor_logins` running `delete from vault.secrets where id = old.secret_id` as a definer function — a written exception
to the no-delete rule, like decision 6's drop.

**M2 — NBSP passes the server's "no spaces" rule, the client refuses it** (Q2). `0012:191` uses `[[:space:]]`, which on
glibc does not match U+00A0; probe P20 (`'Test' || chr(160) || '1234'`) got past the 22023 checks to `0A000`, i.e. the
password was accepted. Task B's `passwordIssues` (`06-vendors-domain.js:29`, `/\s/`) rejects it, so the client is
stricter — no security impact, a consistency gap. *Fix:* `if p_password ~ ('[[:space:]' || chr(160) || ']') then …`.

**M3 — `vendor_login_reveal` logs a row for any uuid, maker or not** (Q2). `0012:242-243` writes the activity row before
looking the row up; probe V3: `reveal('…ffff')` → null and one `vendor.login.reveal` row with that entity_id. By design
("every call is on record", `0012:55-57`) and only admins / `vendors.edit = F` can do it; just noting that an admin can
stuff `activity_log` with junk entity ids. Acceptable.

**M4 — A custom-perms member with `vendors.edit = F` and `vendors.view = N` can set / reveal a password for a row they
cannot read** (Q2). Probe V4: 0 visible `vendor_logins` rows, `reveal` returns the password. The RPCs check only
`is_admin() or has_perm('vendors.edit') = 'F'` (`0012:176`, `:235`), exactly as decision 4 says; the matrix of 0003 never
produces edit F without view F, so this needs a hand-edited `custom_perms`. Optional hardening: add
`and has_perm('vendors.view') <> 'N'` to both checks.

**M5 — The guard lets the client move `active` → `invited`** (Q3). Probe P13 (`update … set status = 'invited'` on a
server-set `active` row) succeeds: `0012:147` only refuses a change *to* `active`, which is what decision 3 says ("the
client may set invited or disabled"). It silently undoes a portal activation. A design question for the owner (should an
`active` login only go to `disabled`?), not a defect against the plan.

**M6 — The case-insensitive duplicate path is unreachable through the API** (Q6). The username check (`0012:87`) refuses
uppercase before the index on `lower(username)` (`0012:101`) can see it: probe P19 (`'REVIEW.TWO2'`) → 23514, probe P18b
(same case, fresh maker) → 23505 on `vendor_logins_username_key`. The test covers the same-case 23505
(`rls_vendor_logins.sql:424-434`); the brief's "case-insensitive → 23505" cannot be demonstrated and the index is
defensive only (the report's choice 2 says so). Fine as is.

**M7 — Cross-task: `created_by` is documented as the member's display name, Task B writes the auth user id.**
`0012:36-37` and `tools/deploy.md +310` say "اسم العضو، زي `set_by`"; the Task B worktree's adapter writes
`created_by: uid()` (`app/js/adapter/vendors.js:412`, `uid()` at `:56` = `session.user.id`) while it writes
`set_by` / `updated_by` as `actor.name` (`:257`, `:261`). One side should change (likely B, to `actor.name`); a text
column takes either, so nothing breaks — but the drawer would show a uuid where the other tables show a name.

**M8 — `app/js/adapter/vendors.js:94` on this branch maps every status but `inactive` to `active`**, so until Task B
lands a maker put on `leave` (by SQL or by B's UI against an old client) shows as active in the list. Ordering note for
the controller: apply 0012 live together with B, as the plan's §13 already says.

**M9 — `supabase/functions/_test/fakes.ts:52` still lists `vendors.status: ['active','inactive']`.** The sync never
writes `leave` (`woo-core.js:292`, `saveVendors` updates `raw` only on an existing store — decision 6 kept), so nothing
fails; the fake just no longer mirrors the live check. Cosmetic, Task B / later.

**M10 — Test UUIDs …51–…56 are shared with `rls_mfa.sql` (…51–…55).** Each file rolls back its own rows and the two
never run in one transaction; harmless (the report's choice 11). The maker ids …d1–…d3 and the vendors' …b1/…b2 of
`rls_vendors.sql` do not overlap.

**M11 — `service_role` without a member JWT gets 42501 from both RPCs** (probe P53: "vendors.edit = F (or admin) is
required …"). The plan grants execute to `service_role` and the runbook says this (`tools/deploy.md +311`); a future
portal Edge Function will need either a member JWT or a written `current_user = 'service_role'` branch. Informational.

## Answers to the eight questions (with evidence)

**Q1 — Can any client role read `secret_id` or the Vault value?** No path found.
- Column grant without `secret_id` (`0012:125-127`); `has_column_privilege(authenticated, secret_id, SELECT) = false`
  and exactly 11 SELECT columns asserted (`rls_vendor_logins.sql:129-150`); no table-level SELECT (`:142`).
- Probes as admin: `where secret_id …` (P01), `order by secret_id` (P02), `exists(… secret_id …)` (P03), whole-row
  `to_jsonb(l)` (P04), `l.*` in a join (P05), `insert … returning secret_id` (P06), `returning *` (P07),
  `update … where secret_id is not null` (P15) — every one `42501 permission denied for table vendor_logins`.
  `returning vendor_id` works (P08), so the adapter's writes are fine.
- PostgREST embedding `vendors?select=…,vendor_logins(*)` expands to the same column list and is refused the same way;
  there is no view over `vendor_logins` and no function returns the row (grep).
- The Vault value is reachable only through `vendor_login_reveal` by admin / `vendors.edit = F` (by design, logged).
- `anon`: no grant on the table (P40 → 42501), no execute on the RPCs (P41 → "permission denied for function"), no
  execute on `has_perm` (P42); the test covers it (`:606-629`).
- `service_role`: `grant all` minus truncate / references / trigger (`0012:130-131`; test `:163-176`; P52 reads
  `secret_id`, P54 truncate → 42501).

**Q2 — The two RPCs.** Order of checks in `set_password`: permission (`0012:176-178`) → rules (`:179-193`) → login row
(`:194-196`, P0002) → Vault (`:197-199`, 0A000); in `reveal`: permission (`:235-237`) → Vault (`:238-240`) → log
(`:242-243`) → read (`:245-250`). Permission first, so an unauthorised caller learns nothing about the rules or the row
(ops / accounts / cs / suspended / anon all 42501 in the test `:498-629`). Server-side rules: 8+, letter, digit, no
whitespace, ≤128 (`:179-193`; test `:313-337` incl. tab, null, 136 chars; P21 Arabic-only letters → 22023; P22 newline →
22023; NBSP gap = M2). Exactly one `activity_log` row per successful call, `actor` stamped by `activity_log_actor`
(`0002:82-93`, `new.actor := auth.uid()` — the caller's JWT, not the owner), `old_value`/`new_value` null, entity_id the
uuid (`0012:219-220`, `:242-243`; test with Vault `:383-398` counts 2 + 2 + 1 with actor = the admin, `:669-671` with
actor = vendors follow-up); the password text appears in no column (`:378-382` grep over `old_value || new_value ||
action || entity_id`). Log nothing / twice: a refused call raises before the insert (no row — test `:411`); a failure
after the insert rolls the statement back; the insert runs once per call. Writing for an invisible maker: only via
inconsistent custom perms (M4). `vault.update_secret` is used for a re-set (`:211`), the secret row is reused (test
`:400-408`: one `vault.secrets` row, `secret_id` = its id after the replacement), a dangling `secret_id` or a same-named
secret without an id is handled (`:202-207`; probe V2). Without Vault: fail closed with 0A000 before any write
(`:197-199`, `:238-240`; test `:361-371`, `:478-492`; nothing written `:410-414`). Orphans on delete: M1.

**Q3 — The guard.** `before update` on anon / authenticated only (`0012:143`, `:158-159`; `tgtype 19` asserted
`:179-190`). Through PATCH: `status = 'active'` → 42501 "portal" (test `:285`, `:462`); `must_change` /
`invite_sent_at` / `password_set_at` / `secret_id` / `vendor_id` / `created_by` / `updated_at` → 42501 from the column
grant before the guard (`:286-292`); on insert `status` / `must_change` / `secret_id` / `password_set_at` → 42501
(`:293-296`). Upsert with `on_conflict`: the PostgREST shape (`vendor_id` in `DO UPDATE SET`) → 42501 (P09, as the
migration header `0012:49-51` predicts); a hand-written upsert with client columns only succeeds (P10) but the guard
still applies to the DO UPDATE path — `status = 'active'` → 42501 "portal" (P11b), `must_change` → 42501 (P11c).
`updated_at` moves on every write: client PATCH (P25: `updated_at = now()` true; test `:447-452` from 2020-01-01),
server write (P50: status active + must_change false, bumped), and inside the definer RPCs (`:151-154`). Skipped for
`service_role` / `postgres` as intended (`:143`; P50 as the runner sets `active` + `must_change = false`).

**Q4 — RLS vs the matrix** (0003: admin F/F, ops view F / edit P, cs view P, accounts view F / edit N, vendors_followup
view F / edit F, viewer view P). Select `vendors.view <> 'N'` (`0012:107-108`): admin, vendors follow-up, ops, accounts
read 3 rows, cs reads 3 (view P), suspended reads 0, anon none (test `:244-253`, `:420-422`, `:501-505`, `:535-537`,
`:561-565`, `:585-587`, `:610-615`). Insert / update `is_admin() or vendors.edit = 'F'` (`:111-112`, `:117-119`, the
0011 `using`/`with check` split): admin and vendors follow-up write; ops → 42501 "policy" (`:508-513`); accounts, cs,
suspended → 42501 (`:540-553`, `:567-579`, `:589-602`). Delete: no policy, no grant (`:123-131`; `:154-157`; P16);
`service_role` keeps delete. Cascade: `on delete cascade` (`:86`), `confdeltype = 'c'` asserted (`:85-94`), and the real
cascade removed the login row in probe V1 (the file itself does not delete — the standing rule — which is the right
call).

**Q5 — The `vendors.status` check** (decision 6). One DO block (`0012:67-81`): the drop runs only when
`vendors_status_check` exists and its definition lacks `leave` (`:73-77`); the re-add is in the same block (`:78-80`),
same name, three values. Re-run: `migrate_0012.sql:76-80` asserts the oid is unchanged after `\ir` (no drop) and
`:85-133` a full before/after snapshot after a third run. First-run drop path: exercised by my `db:test` run (fresh db,
0007 then 0012) and by CI's migration loop. `vendors_guard_update` (0011:244-280) still asks `vendors.toggle = F` for
any status change — `leave` by admin ok, by vendors follow-up / ops 42501 (test `:272-276`, `:465-466`, `:518`); a fourth
value still 23514 (`:224`, `migrate_0012.sql:54-60`). The sync writes `active`/`inactive` on a new store only
(`woo-core.js:292`; existing stores: `raw` only), nothing else in `supabase/` or `app/js` (outside blocks) hard-codes the
pair except M8 / M9. The runbook's "قبل" query (`deploy.md +316-317`) confirms the live constraint carries the 0007
default name before the block looks for it — if it did not, the block would add a second check and the old one would
still refuse `leave`; the test's "the one status check" (`:63-71`) and the runbook's "صف واحد" (`+334`) would catch it.

**Q6 — The tests.** One transaction (`rls_vendor_logins.sql:15` … `:676 rollback`), no delete / truncate executed (the
one `delete` is text in the must-error loop, `:299`, refused 42501, and `:633-640` checks nothing vanished); made-up
e-mails `vl-*.dev@ibtekr.local`, phones `010000000xx`, Arabic made-up names, makers without `woo_vendor_id` (`:20-53`);
the only password values are the fixed `Test1234` / `Test5678`, never in a NOTICE on success (the failure messages echo
the statement text, which carries the dummy value only). Vault switch: decided as the runner into a transaction-scoped
setting (`:55-59`), correct — as `authenticated` the same call raises 42501 (verified), and via the MCP's `execute_sql`
the runner is `postgres` with USAGE on `vault`, so the live run takes the with-Vault branch; a plain local / CI Postgres
takes the other (my `db:test`). Both branches pass (`db:test` without Vault, the stub db with Vault). 23505: same-case
duplicate `nour.store` (`:424-434`), row unchanged (`:435-439`) — M6 for the case-insensitive variant. Must-error loops
compare `sqlstate` and a message needle (`:302-308`, `:468-474`, `:519-525`); the accounts / cs / suspended / vendors
follow-up-no-Vault loops check the code only (`:545-551`, `:573-577`, `:596-600`, `:487-490`) — acceptable. A statement
that unexpectedly succeeds raises P0001 inside the block and is reported as "expected X, got P0001 (case … must error
failed)" — still a failure, slightly confusing text, same pattern as `rls_vendors.sql`. Live re-runnability: I1.

**Q7 — Re-runnability / CI.** `create table if not exists` (`:85`), `create unique index if not exists` (`:101`),
`pg_policies` guards (`:105-121`), idempotent grant / revoke (`:125-131`, `:254-257`), `create or replace function` /
`create or replace trigger` (PG14+; live PG15+, CI PG17) (`:138`, `:158`, `:169`, `:229`), the conditional DO block
(`:67-81`). Three applications on one db leave no diff (`migrate_0012.sql`), confirmed in my run. CI (`ci.yml:46-66`,
Postgres 17, `--stub`): `0008` skips Vault, `0012` needs nothing from Vault at apply time (`to_regclass` is evaluated at
call time), the test takes the 0A000 branch; `[[:space:]]`, `to_regprocedure`, `tgtype`, `jsonb - text[]` are the same
on 17.

**Q8 — CLAUDE.md / plan.** Rule 4: explicit grants by column list, `revoke truncate, references, trigger` for the three
API roles, nothing for anon (`0012:123-131`). Rule 5: no secret in the files (the only "password" is the dummy test
value). No delete / truncate in the migration; the one drop is decision 6's. Dokan read-only: nothing touches Woo or the
Edge Functions (no redeploy, `deploy.md +440`). Names match the Task B contract (table, columns, the two RPCs,
42501 / 23505 / 22023 / 0A000; P0002 is an extra code the adapter treats as a generic refusal). The runbook block
(`deploy.md +307-375`) is accurate against the local catalog (I re-ran its "بعد" queries' shape through the test's
assertions); the advisors line (`+385`) and the §2.6 / §2.7 lines are consistent with the plan's §13 order. The
CLAUDE.md note (`+35`) is correct. The report's 13 choices hold as described; its 7 concerns: 1 → I2, 2 → M1,
3 → confirmed (P09) and already handled on the B side (insert when no row, PATCH otherwise, `vendors.js:350`),
4 → confirmed (P30: ops gets the "portal" message before the policy — harmless), 5 → the drop path is covered by the
fresh-db migration loop, 6 → confirmed, 7 → no issue.

## Minimal fixes, in order
1. **I1** — `rls_vendor_logins.sql:378-382, :395, :411, :669-671`: add `and entity_id in ('00000000-0000-4000-8000-0000000000d1','…d2','…d3')` to each `activity_log` count / grep (test only).
2. **I2** — `tools/deploy.md` §2.1 "قبل" block: the two `has_function_privilege('postgres', 'vault.…', 'execute')` lines (expected `true / true`); run `rls_vendor_logins` live before anything of 3.1 reaches `main`.
3. **M2** (optional, one line) — `0012:191`: `p_password ~ ('[[:space:]' || chr(160) || ']')`.
4. **M7** — tell Task B: `created_by` = `actor.name`, like `set_by` / `updated_by` (or change the two doc lines to say "auth user id").
5. M1 / M4 / M5 are decisions for the owner's ledger, not blockers.
