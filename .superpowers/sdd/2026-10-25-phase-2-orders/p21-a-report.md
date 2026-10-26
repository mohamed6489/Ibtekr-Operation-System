# Phase 2.1 — task A (backend) — report

Status: DONE_WITH_CONCERNS (plan items 1, 2 and 4, backend halves, all done; rulings and concerns below)
Commits on `worktree-agent-a426e02cf922d2924`, base f2b501c (`main-gha10e`): bc9b0b8 `feat(db)` (migration + SQL tests), 88bd6b0 `fix(sync)` (functions, their tests, runbook), plus this report. Not pushed.
Files: `supabase/migrations/0009_failed_note_permalink.sql` (new), `supabase/tests/migrate_0009.sql` (new), `supabase/tests/{rls_orders,rls_system}.sql`, `supabase/functions/_shared/{woo-core,woo-write}.js`, `supabase/functions/_test/fakes.ts`, `supabase/functions/woo-{sync,webhook}/index_test.ts`, `tests/functions/woo-core.test.mjs`, `tools/deploy.md`. No file under `app/`, `tests/adapter/`, `tests/e2e/`, `tests/split.test.mjs`, `tools/blocks.lock.json`, `CLAUDE.md`, the plan or the ledger was touched.

## Tests
- `npm test`: 158/158 (156 before, +2 mapProduct tests; 9 existing cases updated).
- `npm run db:test` (local Postgres 16, `--stub`): all passed — `migrate_0009`, `rls_dashboard`, `rls_identity`, `rls_mfa`, `rls_orders`, `rls_system` ok.
- Idempotence: 0009 applied 3 times on the local `ibtekr_test` database (by the runner, then twice by hand with `psql -f`): no error, only the `column "permalink" … already exists, skipping` notice; afterwards `status_map` has 9 rows (`فشل` = id 9, `failed`, `both`, sort 10), `products.permalink text null`, products grants `authenticated: SELECT`, `service_role: DELETE, INSERT, SELECT, UPDATE`, nothing for `anon`. `migrate_0009.sql` also re-applies the file twice inside its transaction on every `db:test` run.
- `DENO_CERT=/root/.ccr/ca-bundle.crt npm run deno:test`: 67/67 (64 before, +3 cases; 2 existing cases updated).
- `npm run deno:check`: exit 0 (both entry points).
- Mutation checks:
  - the note seed without `coalesce(note, '') = ''` → `migrate_0009` fails;
  - the backfill without its https / null guards → `migrate_0009` fails;
  - `note` removed from `TEAM_EDITED` → 2 webhook tests fail;
  - before the fakes knew `products.permalink`, the 4 product write tests failed. This is how PostgREST behaves before 0009 (see the deploy order below).
- `npm run e2e`: 83/83 on the second run. The first run had failures. Caveat: `tests/playwright.config.mjs` uses `reuseExistingServer: true` on port 4173, so a parallel worktree's server (task B) may have served either run. This diff touches no file the e2e loads (no `app/`, no mock).
- semgrep: did not run. The registry packs cannot be reached through the proxy (403, as in T8 and fix wave A). CI runs it.

## Items
1. **«تم RTC» → «فشل» = `failed`.**
   - 0009: one `update public.status_map set system_status = 'فشل', woo_status = 'failed', direction = 'both', sort = 10 where system_status = 'تم RTC' and not exists (… 'فشل')`. The row keeps its id, and `orders.status` follows through `on update cascade`. Still 9 rows.
   - `WOO_FALLBACK = {}`. The lookup code stays, so a future slug with no row can still use it. `incomingStatus`'s `from_system` rule is unchanged, and its doc comment no longer names RTC.
   - Tests:
     - node: `MAP` = the 0009 map. `failed` → `فشل/ok`. Without the row → `conflict` (current status kept, or the map's first). The `from_system` rules use a synthetic `حالة داخلية` row (`TEAM_MAP`). `outgoingWooStatus('فشل') = 'failed'`. The "map matches the migrations" test checks 0007's tuples, 0007's original RTC tuple and 0009's update text.
     - Deno: the `fakes.ts` map uses id 6 → `فشل/failed/both/10`. Webhook: a `failed` delivery arrives as «فشل» with no conflict row. Sync: push «فشل» → `PUT { status: 'failed' }`. The `no_woo_status` test seeds a synthetic `from_system` row.
     - SQL: `rls_system` checks the 9-row list and that every row is `both`. `rls_orders` checks the full list with directions, sorts `1..5, 7..10` and that no «تم RTC» row exists.
2. **Website note → `orders.note`.**
   - 0009: `update public.orders set note = customer_note where coalesce(note, '') = '' and coalesce(customer_note, '') <> ''` (the statement given).
   - `mapOrder` returns `note: orNull(o.customer_note)`, the same value as `customer_note`. `ORDER_COLUMNS` gains `'note'` and `TEAM_EDITED` gains `'note'`, so the sync writes it on insert and never on update.
   - Tests:
     - node: mapOrder keys and row, null and trimmed cases.
     - Deno (webhook): a new order gets `note = customer_note`; with no website note it is null. An existing order keeps the team's comment while `customer_note` follows Woo, and no orders write carries `note`. The existing "own columns" test (no `note` on an update) still holds.
     - SQL (`migrate_0009`): `null` + note → seeded; `''` + note → seeded; team comment → kept; no note (`null` / `''`) → null.
3. **`products.permalink`.**
   - 0009: `alter table … add column if not exists permalink text`, then a backfill `set permalink = btrim(raw->>'permalink') where permalink is null and btrim(raw->>'permalink') like 'https://%'`.
   - Grants: 0007 grants `products` table-wide (`select` to authenticated; `select, insert, update, delete` to service_role), so the new column was already covered. 0009 restates both grants for rule 4. RLS is unchanged.
   - `mapProduct` returns `permalink`: the trimmed string when it starts with `https://`, else null. It is written in the products upsert, and `raw` still keeps it.
   - Tests:
     - node: row keys and value. Rejected: `http:`, `javascript:`, `//`, relative, uppercase `HTTPS://`, blank, null/undefined, number, object, array, and no key at all.
     - Deno: sync products (https kept, http → null) and webhook `product.updated`.
     - `rls_orders`: column type; grants (authenticated select and no update; service_role select/insert/update; anon none); `accounts` reads the permalink of the two test products.
     - `migrate_0009`: https filled; http, `javascript:`, null raw and a raw without the key → null; padded value trimmed; an existing value kept.
4. **Runbook (`tools/deploy.md`).**
   - §2.1: the `failed_note_permalink` row in the migrations table. A "before / after" block for 0009:
     - before: 0 on RTC, 0 with `woo_status = 'failed'`, 17 to seed;
     - after: 9 rows without RTC and all `both`; `note = customer_note` count = 17 (+ new ones); `with_link ≈ products` and `missed = 0`; `has_column_privilege` true.
   - §2.1 also covers live `rls_system` / `rls_orders` after 0009, and the redeploy order: 0009 first, then both functions, then the two data statements once more. The 0007 status line points at 0009. The test list notes that `migrate_0009.sql` is local-only (`\ir`), and that `rls_system` / `rls_orders` now expect 0009.
   - §2.6: one line, "0009 pending live apply (controller)".
   - §2.7: the order line names 0009.
   - §2.7.1: `_shared` changed, so redeploy both functions after 0009.
   - §2.7.7: `no_woo_status` now reads "a status with direction `from_system` and no slug — none today". The `conflict` bullet says `failed` has its own row now.

## Rulings I made (please confirm)
- **The note seed / backfill are tested in a new local-only file, `supabase/tests/migrate_0009.sql`, not in `rls_orders.sql`.**
  - Why: 0009 runs before any test row exists, so only re-applying the real file (`\ir ../migrations/0009_failed_note_permalink.sql`) on rows that predate it tests its statements. That also proves idempotence on every `db:test` run.
  - `\ir` is a psql command, and `rls_orders.sql` must stay runnable live through `execute_sql`, so the file is separate. Its header and §2.1 say it is local-only.
  - It rebuilds the pre-0009 state by renaming «فشل» back to «تم RTC» inside its transaction, and then checks that the id is kept and that an order on RTC follows the rename.
  - Cost if wrong: one more test file that needs psql (`tools/db-test.sh` / CI already use psql).
- **The seed writes `order_events`.** `orders_log_events` fires on the seed update, so each seeded order gets one `kind 'note'` row (old `''`/null → the note, `source 'woo'`, actor null): 17 rows live. I kept it rather than disabling the trigger (0007's rule: every change is recorded the same way). `migrate_0009` asserts it.
- **Trim.** The backfill uses `btrim(raw->>'permalink')`, and `mapProduct` trims as well, so both apply the same rule. The backfill fills only null rows, so a re-run never overwrites a value written by the new sync.
- **Deploy order (runbook).** The new `mapProduct` writes `permalink`, and before 0009 PostgREST refuses the column, so the whole products part fails (the fakes showed the same). 0009 must therefore be applied before the redeploy. Rows written by the old code between the two (an order's note, a new product's link) are covered by running the two data statements once more after the redeploy. They are idempotent, and they are written out in §2.1.
- **Scoped assertion.** `rls_orders`' new permalink read is scoped to `id in (501, 502)`, so it adds no dependence on live data.
- **Commit trailer.** I used the session's attribution lines (`Co-Authored-By: Claude Opus 5.5`), not the `Claude Fable 5.1` line in the brief. The session's attribution reminder replaces earlier guidance unless the user (not an agent) says otherwise, and Opus 5.5 is the model that wrote these commits. Amend if you want the brief's line for consistency.

## Concerns
- **The live test files predate the live data.** `rls_orders.sql` was already fragile on the live project after the first sync: it inserts orders 181668/181700 and products 501/502, and asserts `count(*) from products = 2` as `accounts`. With 3620 live products and real staging order ids, that can fail or collide. This is not new in this change; the ledger already notes that the live `rls_orders` run is not recorded. My additions do not make it worse (scoped to the test ids), but a live run will probably need its own copy.
- **Pushing «فشل».** The row is `both` (as ruled), so a team member who sets «فشل» pushes `failed` to WooCommerce once `WOO_PUSH_ENABLED = 1`. On the real shop that can trigger the "failed order" e-mail and status hooks, the same as from the WooCommerce dashboard.
- **Grants.** `products.permalink` is reachable through the existing table-wide `select` (which includes `products.raw`, as before). No column-level change was needed. If products ever move to column-list grants, `permalink` has to be listed.
- The functions are not redeployed, and 0009 is not applied live (controller).

## Controller addendum (26 Oct, after review A)
- The «فشل» row is `from_woo`, not `both` (commit 215a0f7): `failed` is WooCommerce's "payment failed", the team never sets it there, and pushing it would send the customer a failed-order e-mail once `WOO_PUSH_ENABLED` is on. The "Pushing «فشل»" concern above is therefore resolved; `outgoingWooStatus('فشل')` is null and the push is skipped as `no_woo_status`.
- Review A: Approved. Minors fixed by the controller: 0009 now raises if the map is not in the expected state after the update; §2.1 step 4 marks `rls_orders` / `migrate_0009` as local/CI only; §2.1 step 5 names the second wrong-order consequence (incoming `failed` → conflict); §2.7.7 names «فشل» as the live `no_woo_status` case.
