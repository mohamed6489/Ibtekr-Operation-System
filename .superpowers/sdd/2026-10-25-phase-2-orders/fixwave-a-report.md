# Fix wave A (backend) — report

Status: DONE_WITH_CONCERNS (all 8 items done; the deviations and concerns are listed below)
Commit: cdf7222 on `main-gha10e`, base 25f6b0d. Not pushed.
Files: `supabase/functions/_shared/{db,woo-core,woo-write}.js`, `supabase/functions/woo-{sync,webhook}/index.ts` + `index_test.ts`, `tests/functions/woo-core.test.mjs`, `tools/deploy.md`, `.github/workflows/vendor-fetch.yml`. No other file was touched. No root `deno.lock` was created.

## Tests
- `npm test`: 154/154 (152 before, +2 woo-core tests).
- `npm run deno:check`: exit 0 (both entry points).
- `npm run deno:test`: 64/64 (54 before, +10 new cases, 9 existing cases updated).
- Mutation checks: with the product link removed, both multi-vendor tests fail. With null-vendor lines upserted with `vendor_id` again, the re-delivery test fails.
- semgrep: did not run to completion in the sandbox (the registry packs cannot be reached, as in T8). CI runs it.

## Items
1. **Multi-vendor lines by product (Critical).** `writeSubOrders` now upserts `sub_orders` returning `id, order_id, vendor_id, woo_order_id`. It pairs each saved row with its payload by `woo_order_id`, then calls `linkLines`, which runs two updates:
   - (a) `order_items set sub_order_id = s.id, vendor_id = s.vendor_id where order_id = s.order_id and product_id in (line_items[*].product_id ∪ variation_id) and vendor_id is null`. Setting `vendor_id` on rows that are null is the same as `coalesce(vendor_id, s.vendor_id)`.
   - (b) the existing link by maker (`vendor_id = s.vendor_id`). It also covers the `vendor_id = s.vendor_id` half of the `.or()`.

   Tests:
   - sync: a parent with no meta + two sub-orders, one of them with a variation → each line gets its `sub_order_id` and `vendor_id`.
   - webhook: the same case with three lines.
   - webhook: a line of another maker is never re-linked by product.
2. **`WOO_PUSH_ENABLED` guard (Critical).** In `pushStatus`, the guard comes **after the stale check**, before the `status_map` read, any Woo client and any Woo call. It is closed unless the trimmed value is `'1'`. When closed it answers `200 { action:'push_status', result:'skipped', reason:'push_disabled', counts:{pushed:0} }` and logs a `skipped` row with `detail { status, reason:'push_disabled' }`.

   Tests:
   - closed when the variable is unset and for `'true'`, `'0'`, `'yes'`, `''` and `'11'`: no Woo call and no `status_map` read.
   - open for `' 1 '`, and the stale check still runs first.
   - the three existing push tests now set `WOO_PUSH_ENABLED: '1'`.
3. **Team status kept when Woo is unchanged (Important).** `incomingStatus(wooStatus, current, map, currentWooStatus = null)` returns `{ status: current, result: 'unchanged' }` when `current` is set, the stored slug is non-empty, and the trimmed incoming slug equals it. The check runs after the `from_system` rule and before the map rules. Without a 4th argument the function behaves exactly as before. `writeOrders` now selects `woo_status` and passes `currentWooStatus`.

   Tests:
   - node: incomingStatus cases plus a mapOrder ctx case.
   - deno (webhook): an order stored as «جاهز للشحن» with `woo_status 'processing'`. A `processing` delivery keeps «جاهز للشحن» and logs no row. A `completed` delivery gives «مكتمل».
4. **City/address written on insert only.** `writeOrders` splits the upsert. Ids not yet stored get all `ORDER_COLUMNS`. Stored ids get `ORDER_UPDATE_COLUMNS`, which leaves out `customer_city` and `customer_address`.

   Tests:
   - the deno test checks both cases.
   - the expected column list in the existing "own columns" test is updated.
5. **`all` order.** `PULLS` now runs vendors → orders → products. The header comment and both `all` tests are updated, and `deploy.md` §2.7.5 documents the order and the gateway-timeout fallback.
6. **Row-by-row fallback.** `upsertRows` now returns `{ rows, bad }`. A batch that fails with SQLSTATE `22xxx`/`23xxx` is retried one row at a time (a batch of one is not retried). Any other error still throws. `bad` = `[{ key, row, error: DbError }]`.

   In `woo-write`, a `save()` wrapper logs one row per bad key: `entity` = the table, `entity_id` = the conflict key, `action 'upsert'`, `result 'error'`, `detail.error` = `errorText(DbError, scrub)`. The row kind is the write context's (`sync` / `webhook`), the same as the existing vendor error rows.

   A refused order also drops its lines, so they do not produce FK error rows. `failed` counts are added to `writeOrders`, `writeSubOrders`, `writeProducts` and `writeOrderPage`, and to the sync counts (`counts.orders.failed`, `counts.products.failed`).

   Tests:
   - one bad row in a batch of three → the other two are written, one error row, the cursor moves on.
   - a 57014 error still stops the part with 500 `sync_failed` and no retry.
7. **Docs (`tools/deploy.md`).**
   - §2.6: the status line.
   - §2.7.1: the MCP bundle layout table and why.
   - §2.7.2: a `WOO_PUSH_ENABLED` row with the staging precondition (Emails / Bosta / status-hooked plugins off or in sandbox). It is normally `1` on production.
   - §2.7 Dokan paragraph: the push depends on the flag.
   - §2.7.5: the `all` order, the timeout fallback (`IBSupabase.client.functions.invoke('woo-sync', { body: { action: 'orders' } })` or `net.http_post`), the unlinked-lines check (→ 0), and the Realtime filter check marked as verified live.
   - §2.7.7: the `push_disabled` reason and the per-row `upsert` error rows.
   - §2.7.8: `WOO_PUSH_ENABLED = 1` at the production switch.
   - §2.7.10: `vendor-fetch` refuses `main`.
8. **`vendor-fetch.yml`.** A new first step (before checkout) refuses `main`, `heads/main` and `refs/heads/main`. It reuses the branch-name regex. `sha256` stays optional. Checked locally (bash): `main-gha10e`, `feature/main` and `maintenance` pass.

## Deviations / additions (please rule)
- **The sync no longer overwrites `vendor_id` with null.** `writeOrders` upserts lines whose maker is unknown in the payload *without* the `vendor_id` column. Why: without this, any later delivery of a multi-vendor parent (no line meta) would set back to null the maker that item 1 just gave the line. Cost if wrong: a line whose maker really disappeared in Woo keeps the old maker.
- **The webhook marks a delivery `error` when its own row is refused** (parent order, sub-order or product): it throws after the per-row log, so the event reads `error` (WooCommerce never re-sends a failed delivery; the backup sync picks the object up again when it changes or the cursor is reset). Before, the event would have read `ignored`. This means two `woo_sync_log` rows for one delivery: the row-level `upsert` row and the delivery-level row. The "PostgREST details" test now covers both paths (23514 → refused; 57014 → thrown as before).
- **`fetchParent`:** a parent row refused by the database now reports the sub-order as `parent_fetch_failed` with "parent row refused by the database", instead of `parent_missing`.
- **Side effect of item 3:** an unknown slug that Woo keeps sending is logged as `conflict` only on the delivery that changed `woo_status`. Later deliveries with the same slug are `unchanged`, which means less log flooding. This follows from the stated rule; tested.
- The commit trailer is the one you gave (`Claude Fable 5.1`); the session's attribution reminder named Opus 5.5.

## Concerns
- `upsertRows`' return type changed from an array to `{ rows, bad }`. Every caller is in `supabase/functions/**` and has been updated. No other module imports it.
- When a batch has a data error, the retry costs up to 200 single-row statements (BATCH = 200). This is acceptable for the rare bad page.
- `linkLines` does not chunk the `in('product_id', …)` list (a Dokan sub-order with hundreds of distinct products is not realistic).
- The functions are not redeployed. The live v1 still has the old code, so a redeploy is needed (the §2.7.1 bundle layout, both functions, since `_shared` changed).
