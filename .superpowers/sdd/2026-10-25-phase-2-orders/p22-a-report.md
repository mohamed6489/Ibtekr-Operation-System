# Phase 2.2 — task A (backend) — report

Status: DONE_WITH_CONCERNS. The backend halves of plan items 3 and 4 are done. Rulings and concerns are below.

Commits are on `worktree-agent-a09b12c2a7ec74a1b`, base 049d628 (`main-gha10e`, fast-forwarded from 6983f07). They are not pushed.
- 96b3525 `feat(db)`: the migration and its SQL tests.
- 566a095 `feat(sync)`: the functions and their tests.
- 96f6f3a `docs(deploy)`: the runbook.
- This report.

Files:
- New: `supabase/migrations/0010_state_names.sql`, `supabase/tests/migrate_0010.sql`.
- Changed: `supabase/tests/rls_orders.sql`, `supabase/functions/_shared/{woo-core,woo-write}.js`, `supabase/functions/_test/fakes.ts`, `supabase/functions/woo-sync/{index,index_test}.ts`, `supabase/functions/woo-webhook/index_test.ts`, `tests/functions/woo-core.test.mjs`, `tools/deploy.md`.
- Not touched: anything under `app/`, `tests/adapter/`, `tests/domain/`, `tests/e2e/`, plus `tests/split.test.mjs`, `tools/blocks.lock.json`, `CLAUDE.md`, the plan and the ledger.

## Tests
- `npm test`: 160/160. That is 159 before, plus 1 new mapOrder `customer_state` test; the keys test was updated.
- `npm run db:test` (local Postgres 16, `--stub`): all passed. That covers `migrate_0009`, `migrate_0010` (new), `rls_dashboard`, `rls_identity`, `rls_mfa`, `rls_orders` and `rls_system`.
- Idempotence:
  - 0010 was applied 3 times on the local `ibtekr_test`: once by the runner, then twice by hand with `psql -f`. There were no errors, only the two "already exists, skipping" notices.
  - After that, `orders_v` had 26 columns ending in `customer_state`, and authenticated had 25 SELECT columns on `orders`.
  - Grants on `woo_states` after the runs:
    - authenticated: `SELECT` only.
    - service_role: `SELECT, INSERT, UPDATE, DELETE`.
    - anon: nothing.
  - `woo_states` had one policy.
  - `migrate_0010.sql` also re-applies the file twice inside its transaction on every `db:test` run.
- `DENO_CERT=/root/.ccr/ca-bundle.crt npm run deno:test`: 71/71. That is 67 before, plus 4 new woo-sync tests; 2 woo-sync tests and 1 woo-webhook test were updated.
- `npm run deno:check`: exit 0.
- `npm run e2e`: 87/87, with nothing else on port 4173 at the time. No file the e2e loads was changed.
- Mutation checks: each change below made the suite fail, and the files were restored afterwards.
  - Migration:
    - Backfill without `btrim`, backfill with billing first, or backfill without the `customer_state is null` guard → `migrate_0010` fails.
    - `update (customer_state)` granted to authenticated, or no `select (customer_state)` → `rls_orders` fails.
    - `insert` granted on `woo_states` to authenticated, or the truncate revoke removed → `rls_orders` fails.
    - The policy without its guard → the re-run errors.
    - The policy as `for all`, or RLS off → `rls_orders` fails.
    - The view without `customer_state` → `migrate_0010` fails.
  - Sync:
    - mapOrder with billing first, or shipping only → node and Deno tests fail.
    - `customer_state` dropped from `TEAM_EDITED` or from `ORDER_COLUMNS` → Deno tests fail.
    - writeStates without the name trim, accepting a non-string code, or letting the first name win → Deno tests fail.
    - `states` moved to the end of `PULLS`, or no states-array check → Deno tests fail.
  - Before the fakes knew `orders.customer_state`, 20+ Deno tests failed. That is what PostgREST does before 0010 (see the deploy order).
- semgrep: did not run. `semgrep.dev` is refused by the proxy (403, as in 2.1). CI runs it.

## Items
1. **Migration `0010_state_names.sql`.**
   - `orders.customer_state text` (`add column if not exists`).
   - Backfill: `coalesce(nullif(btrim(raw->'shipping'->>'state'),''), nullif(btrim(raw->'billing'->>'state'),''))`, only where the column is null and raw is not null.
   - Grants on the new column:
     - authenticated: `select (customer_state)` only, no UPDATE. 0007 grants a column list, so nothing else reaches the column.
     - service_role: column-level `select/insert/update`. This is a no-op on top of 0007's table-wide grant, written out for rule 4.
   - The guard trigger needs no change: a column outside its lists is already sync-only for API roles.
   - `orders_v` is re-created with `create or replace view … with (security_invoker = true)`. It keeps the same 25 columns in the same order, the masked phone is untouched, and `customer_state` is appended. The grant is restated.
   - `woo_states (code text primary key, name text not null, updated_at timestamptz not null default now())`:
     - RLS on.
     - `woo_states_select` for select to authenticated using (true). It is created inside a `pg_policies` guard; there is no drop.
     - Grants: select to authenticated; select/insert/update/delete to service_role.
     - truncate/references/trigger revoked from anon, authenticated and service_role.
   - The file has no drop, delete or truncate statement.
2. **SQL tests.**
   - `migrate_0010.sql` (local only, `\ir`) uses 9 pre-0010 order shapes:
     - shipping wins;
     - empty shipping → billing;
     - no shipping → billing;
     - a padded value is trimmed;
     - blank shipping → billing;
     - both empty → null;
     - no state key → null;
     - raw null → null;
     - an existing value is kept.
   - It also checks that the backfill writes no `order_events` rows, that `orders_v` carries the value, and that an existing `woo_states` row survives. A re-run changes nothing: customer_state, woo_states, the orders_v columns, the policy, the grants and the event count are all compared.
   - `rls_orders.sql`, schema checks: column type, grants (members select only, service_role S/I/U, anon none), the 25 member columns with neither phone nor raw, the exact `orders_v` column list, `security_invoker`, the `woo_states` columns, default and primary key, RLS, the single policy, and grants (no truncate).
   - `rls_orders.sql`, behaviour:
     - accounts reads `customer_state` from `orders_v` and from `orders`, and the code-to-name lookup returns the name.
     - accounts cannot insert, update or delete `woo_states` (42501).
     - ops (orders.edit P) cannot set `customer_state`, either to a new value or to its current one (42501).
     - admin cannot insert into `woo_states`.
     - a suspended viewer can read the names (using true).
     - anon gets zero rows or "permission denied" on `woo_states`.
     - the runner (as the sync) upserts on code, and writing `customer_state` adds no event.
   - Test codes are `TS-01..03`, so they cannot collide with the site's `EG-xx`.
3. **Sync.**
   - `mapOrder`: `customer_state: orNull(s.state) ?? orNull(b.state)`.
   - `woo-write`:
     - `ORDER_COLUMNS` and `TEAM_EDITED` both gain `customer_state`, so the sync writes it on insert only.
     - New `writeStates(ctx, states)`: it upserts `{ code, name, updated_at: ctx.now() }` on `code` for items whose code and name are non-empty strings after trimming. The last name wins for a duplicate code, and nothing is deleted. It goes through `save`, so a refused row gets one `woo_sync_log` error row (entity `woo_states`, entity_id = the code). It returns `{ written: [codes], skipped, failed }`.
   - `woo-sync`:
     - action `states`: `GET wc/v3/data/countries/EG`. This is a `wc/` path, so it is sent with the WC Basic header.
     - The answer's `states` array goes to `writeStates`. An answer that is not an object with a `states` array throws a `WooError` and writes nothing.
     - `states` is in `ACTIONS` and is the first entry of `PULLS`, so `all` = states, vendors, orders, products.
     - The part logs its own row (`entity 'states'`, counts `{ states, skipped, failed }`), and a failure does not stop the next parts (existing `pull()`).
     - The header comment is updated.
   - Deno tests (new):
     - `states` end to end: a non-admin gets 401; the WC header is sent; the upsert is on code with three columns; names are trimmed and the last one wins; 9 malformed items are skipped; an existing row is updated; a code the site no longer lists is kept; the log row is right.
     - 404, a missing `states`, an array body, a `states` object and a null body → 502, an error row, nothing written.
     - `all` with the states part failing (403) → vendors, orders and products still run and write; 502 `failed: ['states']`.
     - A refused name → one error row, the others written.
   - Deno tests (updated):
     - The `all` order test.
     - The "one part fails" test, which now has a states route.
     - Webhook: `customer_state` is written on insert (shipping first, billing fallback trimmed, null when absent) and never on an existing order.
4. **Runbook (`tools/deploy.md`).**
   - §2.1:
     - the `state_names` row;
     - `rls_orders` now expects 0010;
     - `migrate_0010` is local only;
     - 0007's `cols = 24` check notes 25 from 0010;
     - a 0010 block. Before: 104 / 104 / 14, no table, no column. After: the same counts, `has_column_privilege` SELECT true and UPDATE false, `woo_states` read but not written, anon nothing, `orders_v` has the column, RLS with its single policy, 0 names until the first `states` run. Then the redeploy after 0010 and why, the backfill statement once more, and the first `states` run with `woo_states > 0`, codes mapped to names and the `woo_sync_log` rows.
   - §2.6: "0010 pending live apply (controller)", functions still v5.
   - §2.7:
     - `states` in the action list, and the phase 2.2 order: 0010 → redeploy both functions → backfill again → `states` → `main`.
     - §2.7.1: redeploy both after 0010.
     - §2.7.5: `all` starts with `states`, plus a bullet on what the part does.
     - §2.7.7: how to read a `states` error, and `woo_states` in the upsert-error list.

## Rulings I made (please confirm)
- **`btrim` in the backfill.**
  - The brief's statement has `nullif(raw->'shipping'->>'state', '')` without a trim. I used `nullif(btrim(…), '')` so the backfill equals `mapOrder`, which trims through `orNull`: a blank shipping state falls back to billing in both.
  - Codes from a select list never carry spaces, so on live data both forms give the same result. `migrate_0010` asserts the trimmed rule.
- **The view's column order.** `customer_state` is the 26th column, not next to the city. `create or replace view` can only append columns, and dropping the view was not allowed. PostgREST and the adapter name their columns, so the order does not matter.
- **`writeStates` returns `{ written: [codes], skipped, failed }`.** The brief says `{ written, failed }`. I added `skipped` for malformed items, and `written` is a list, as in `writeProducts`. The pull's counts are `{ states: n, skipped, failed }`, so the UI's `n('states')` pattern would work if B wants it.
- **A malformed answer is an error, not "ok, 0".** An answer without a `states` array → `WooError(200, …)` → the part's error row and a 502. Without this, a site that changed its answer would look healthy while no names arrive.
- **Policy idempotence.** PG16 has no `create policy if not exists`, and the brief allows no drop. The policy is therefore created inside a `pg_policies` existence check.
- **`woo_states` revokes truncate/references/trigger**, as 0004 and 0007 do. The live defaults hand those out on a new table.
- **The service_role upsert is tested as the runner, plus privilege checks.** The local stub's `service_role` has no BYPASSRLS (live has it). `woo_states` has no write policy, so an upsert run as `service_role` locally would be refused by RLS. `rls_orders` already plays the sync as the runner.
- **The suspended viewer reads `woo_states`.** This follows from `using (true)` as written in the plan and brief. I assert it so the rule is visible. If you want members gated by `orders.view`, it is a one-line policy change.
- **Runbook: the backfill once more after the redeploy.** `customer_state` is insert-only, so an order the old code created between the apply and the redeploy would stay null forever. The statement is idempotent and is written out in §2.1.
- **Commits.**
  - Trailer: I used the session's attribution lines (`Co-Authored-By: Claude Opus 5.5`), not the brief's `Claude Fable 5.1`. That matches the 2.1 A ruling: the harness attribution rule outranks an agent's brief unless the user says otherwise. Amend if you want the brief's line.
  - The runbook is a separate `docs(deploy)` commit.

## Concerns
- **The live endpoint was not probed.** I did not call the site or the live DB.
  - `wc/v3/data/countries/EG` needs a store-manager key. To my knowledge `wc_rest_check_manager_permissions('settings', 'read')` maps to `manage_woocommerce`, the same as the webhooks endpoint that `register_webhooks` already used live, so it should pass. This is from memory, not verified.
  - If it is refused, every `all` (cron and the «مزامنة» button) answers 502 `failed: ['states']`, and a `woo_sync_log` error row is written every 15 minutes, while the other parts still sync. That is the existing `pull()` behaviour. If it happens, either fix the key's role or decide to make `states` soft.
- **HTML entities.** WooCommerce returns state names as the site defines them, with no decoding. If the site's list carries entities (`&amp;`), the card shows them literally after `esc()`. I did not decode them, to keep the change minimal.
- **`customer_state` is insert-only** (written decision). A governorate changed on the site after an order was created does not follow. This is the cost stated in the migration header.
- **`tests/e2e/supabase-mock.mjs`** (task B / controller): its `all` answer has no `states` counts. That is harmless today, since block 29's toast reads orders, products and vendors only. The mock also needs a `woo_states` route once the adapter reads it.
- **`rls_orders` on live** is fragile, as already recorded. My additions are scoped to test ids and codes and add no dependence on live data.
- 0010 is not applied live, and the functions are not redeployed (controller).
