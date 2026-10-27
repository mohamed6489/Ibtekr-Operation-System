# Task A report — phase 3.3 backend (branch `p33-a`)

**Status: DONE_WITH_CONCERNS** (everything in the brief is implemented and green locally; the concerns are design points the reviewer / owner should confirm, listed below).

## Commits on `p33-a` (on top of 350012a)
| sha | what |
|---|---|
| `98117ce` | feat(woo-sync): full `mapStore`, `SYNC_FIELDS` / `storeSnapshot` / `diffStore` / `commissionOf` / `toDokanCommission` / `toDokanStore` / `addressText` / `sameField` in woo-core; the store sync in woo-write (`saveVendors` by snapshot, `effectiveRates`, `pushStoreFields`, `applyPushResult`, `markPushPending`, `writeCategories`); `push_vendor`, pull `categories`, `all` in woo-sync; Deno + Node tests; fakes know 0014 |
| `5955c8f` | fix(woo-core): every social link `https://` or `''` (row, snapshot, comparison, PUT body) — the security-review finding; Node test |
| `47314d5` | feat(db): `0014_vendor_sync.sql`, `rls_vendor_sync.sql`, `migrate_0014.sql`, `rls_vendors.sql` counts the new columns, RLS-live workflow default includes `rls_vendor_sync` |
| `98f2155` | docs: `tools/deploy.md` (§2.1 0014 before/after, §2.6, §2.7 intro + phase-3.3 order, §2.7.2, §2.7.3, §2.7.7, §2.7.8, new §2.7.11 with the acceptance-check recipe + table to fill), `CLAUDE.md` (Dokan paragraph amended + phase-3.3 note) |

## What each file does
- `supabase/functions/_shared/woo-core.js` (pure): `mapStore` reads the whole payload (decision 1) and returns the row + a non-column `commission` (`commissionOf`); `SYNC_FIELDS`, `ADDRESS_KEYS`, `SOCIAL_KEYS`; `storeSnapshot(mapped)`; `diffStore(snapshot, site, system)`; `sameField`; `commissionOf`; `toDokanCommission`; `toDokanStore(row, fields, rates)` → `{ body, sent, dropped }` (never a `#` name); `addressText(parts)`. Social links and logo / banner are `https://` or empty.
- `supabase/functions/_shared/woo-write.js`: `saveVendors` — new store = full row + first snapshot + the site's commission as the first `vendor_rates` / `vendor_category_rates` rows; existing store = `syncVendor` (the four cases + first run, mirrors always, status from `enabled` with `leave` kept, one `activity_log` row per changed store, conflict rows, the pending push behind `ctx.pushEnabled`, one UPDATE by `woo_vendor_id`). `effectiveRates`, `systemSnapshot`, `pushStoreFields`, `applyPushResult`, `markPushPending`, `writeCategories`, `VENDOR_SYNC_COLUMNS`, `SET_BY_SITE`. `writeContext` takes `pushEnabled` (woo-webhook never passes it → never pushes).
- `supabase/functions/woo-sync/index.ts`: `push_vendor`, pull `categories` (`wc/v3/products/categories`), `all` = states, categories, vendors, orders, products; `authorize` takes the body (the rate-field rule); `probe_store` kept; the gate `pushEnabled(env)` shared by `push_status` / `push_vendor` / the sync.
- `supabase/functions/_test/fakes.ts`: the 0014 columns / tables, `vendor_rates`, `activity_log`, `leave`, numeric range checks, `wooStoreFull` fixture.
- `supabase/migrations/0014_vendor_sync.sql`: decision 7 — see the header; re-runnable; no drop / delete / truncate.
- `supabase/tests/rls_vendor_sync.sql` (live-safe, rollback, own rows only: stores 9941/9942, categories 9900001/9900002, users …71–…76), `supabase/tests/migrate_0014.sql` (local: applied twice more, fingerprint unchanged, no backfill, no activity).
- `supabase/tests/rls_vendors.sql`: two pinned assertions updated (`vendor_rates` columns + `flat`; members read 30 vendors columns).
- `tools/rls-live.sh` / `.github/workflows/rls-live.yml`: default list + `rls_vendor_sync`.

## Test results
- `npm test`: 230 pass, 0 fail.
- `DENO_CERT=… npm run deno:check`: both functions check.
- `DENO_CERT=… npm run deno:test`: 91 pass, 0 fail (woo-sync + woo-webhook).
- `npm run db:test` (local Postgres 16 on 54329, `--stub`): all 15 files `ok` incl. `migrate_0014` and `rls_vendor_sync`.
- `npm run semgrep`: the registry (`p/javascript`, `p/secrets`) is unreachable through the sandbox proxy (403); the same scan with the locally cached `semgrep-rules` folders (javascript + typescript + generic/secrets, severity ERROR) ran 92 rules on 37 files: 0 findings — CI runs the real gate.
- `npm run e2e`: not run — nothing under `app/` changed in Task A (Task B owns the mock and the specs).

## Under-specified points and my choice
1. **A `system` field that is not in `push_pending`** (the team's value from before the snapshot existed, or a first-run conflict): left alone on both sides, no log, no push. Decision 3 ties the same-run push to `push_pending`; pushing every system-side difference would also push first-run conflicts (the six no-name stores, question 2 to the owner) without a request.
2. **First-run `status`**: always the site's (`'fill'` even when different) — decision 4 a says `enabled: false → inactive` fixes the wrong statuses; `leave` is kept when the site says enabled.
3. **A site name that is a `#id` placeholder** (no name on the site) never overwrites ours, in any run.
4. **A site without a commission figure** (the public payload shape, or no rate set) says nothing about the rate: the two rate fields are neither written nor reported as conflicts.
5. **The commission "once per change"**: the comparison is with the snapshot (`rate` = `{ rate, flat }`, `category_rates` = the items), so a difference between the site and our effective rate is written once. A second site change on the same day replaces that day's row (upsert on `(vendor_id, since)`); `commission_pct` is set in the same vendors UPDATE because the 0011 trigger fires on insert only.
6. **`push_disabled` adds the fields to `push_pending`** (both in `push_vendor` and implicitly in the sync, which keeps them pending without a PUT): when the gate opens, the next run sends them. `no_store` and `placeholder` do not.
7. **The snapshot after a push** takes Dokan's answer (mapStore form) for the sent fields, so a field Dokan silently kept (`refused`) leaves a stable `system` difference instead of being overwritten on the next pull. A row with no snapshot yet (before the first pull) keeps none — the first-run rule still applies.
8. **E-mail**: read from the site only when `show_email` is on (brief: "as today"). The acceptance check compares the pushed e-mail against the raw answer, so it is not reported `refused` when hidden. Consequence: with `show_email` off the e-mail flows system → site only.
9. `since` of a site rate = the UTC date of the run (`ctx.now()`); the adapter uses the browser's local date for its own rows.
10. `activity_log.new_value` is written as a JSON string (`"name, phone"`), `actor` null (the 0002 trigger sets `auth.uid()`, none for the service client); `entity_id` = the maker's uuid. `woo_sync_log.entity_id` for a vendor row = the Dokan store id as text (uuid only for a maker without a store), `detail.vendor_id` = the uuid.

## Concerns for the reviewer
- **First-run conflicts on the live 55 stores**: names (6 placeholders on the site vs filled here) and any phone/e-mail the team typed differently will be logged as `conflict` once and then sit as silent `system` differences (point 1). The owner's answer to question 2 decides whether to push them (the adapter can call `push_vendor` with `fields: ['name']` for those).
- **`push_pending` on the first run** is honoured on the *second* run (the first never PUTs); a pending `name` that is a placeholder is dropped from pending without a push.
- **Same-day rate overwrite** (point 5) loses the earlier row of that day; the members' insert path is unaffected (unique key → 23505 for them).
- Dokan's `PUT dokan/v1/stores/{id}` acceptance per field is unverified until the staging check (§2.7.11 table to fill); `toDokanCommission` sends numeric strings in Dokan's own format and `admin_additional_fee` only when a flat fee is known.
- `semgrep` could not fetch the registry here (local cached rules: 0 findings); CI is the gate.

## Contract notes for Task B
**vendors columns (members `select` by name; `select=*` refused):** `contact_name text`, `address_parts jsonb` `{street_1, street_2, city, state, zip, country}` (strings, '' when empty), `social jsonb` `{fb, instagram, twitter, youtube, linkedin, pinterest, threads, flickr}` (each an `https://` URL or `''` — the server blanks anything else; the UI may trust them to be https or empty and must still render them as text / `href` only), `logo_url text` (https or null), `banner_url text`, `woo_payment_methods text[]`, `push_pending jsonb` (array of field names or null), `woo_synced_at timestamptz`. `woo_snapshot` is **not readable** (service_role only). Members may `insert` / `update` `contact_name`, `address_parts`, `social` (and `address`) under the contact rule (`vendors.edit` F or P; accounts → 42501 "vendors.edit (F or P)…"); any other new column → 42501. `vendors.address` text = `addressText(parts)`: the filled `street_1`, `street_2`, `city`, `state` joined by `'، '` (null when none) — the adapter must write `address` together with `address_parts`. `status`: `inactive` ↔ site disabled; `leave` is ours (the sync keeps it).

**vendor_rates:** `+ flat numeric(10,2)` nullable ≥ 0 (members insert it with the rate; display only). Rows from the site: `set_by = 'الموقع'`.

**vendor_category_rates:** `id bigserial, vendor_id uuid, woo_category_id int (>0), rate numeric(5,2) (null = removed from that date, else 0–65), flat numeric(10,2) (null or ≥ 0), since date, set_by text, created_at`; unique `(vendor_id, woo_category_id, since)` → 23505; checks → 23514; RLS select/insert `sensitive.commission = F` (zero rows otherwise, insert → 42501 "policy"); members insert `(vendor_id, woo_category_id, rate, flat, since, set_by)` only; no update / delete. Effective row per category on a date = last `since <=` date.

**woo_categories:** `id int pk, name text, slug text, parent_id int (no FK), updated_at`; select with `vendors.view <> N` (`select=*` fine); never written by members; filled by pull `categories` (part of `all`).

**`push_vendor` body:** `{ action: 'push_vendor', vendor_id: '<uuid>', fields: [...] }`, `fields ⊆ ['name','phone','email','contact_name','address_parts','social','status','rate','category_rates']` (non-empty; anything else → 400 `bad_request`; a non-uuid → 400). Auth: admin, or `vendors.edit = F` (+ `sensitive.commission = F` when fields include `rate` / `category_rates`) → else 401 `unauthorized`. Answers: 200 `{ action, result: 'ok', fields: [sent], accepted: [...], refused: [...], dropped: [...], counts: { pushed: 1 } }`; 200 `{ result: 'skipped', reason: 'no_store' | 'push_disabled' | 'placeholder', fields, counts: { pushed: 0 } }` (`push_disabled` → the fields are now in `push_pending`); 404 `{ error: 'vendor_not_found' }`; 502 `{ error: 'woo_error', action: 'push_vendor', fields }` (fields now in `push_pending`); 500 `{ error: 'failed' | 'not_configured' }`. After `ok` the row's `woo_synced_at` = now and `push_pending` minus the sent + dropped fields (re-read the row for `pushPending` / `wooSyncedAt`). The adapter writes the row first, then invokes; the values pushed are the database row's, never the request's.

**Activity actions (server-written, `actor` null, `entity 'vendor'`, `entity_id` = the maker's uuid, `old_value` null):** `vendor.sync` — `new_value` = the changed field names joined by `', '` as a JSON string, e.g. `"name, phone"` (field names from the list above; `rate` / `category_rates` included); `vendor.sync.conflict` — the same, the fields where the site won (or, on the first run, where ours stayed). Suggested rendering: «اتعدل من الموقع: …» / «تعارض: الموقع كسب في …» (map the names to Arabic labels). Note `activity_log_select` (0006): a member sees the server's rows only with `settings.view <> N` (actor is null) — the drawer's activity list may need `settings.view`, or Task B reads `woo_sync_log`-free counts; flag if a policy change is wanted (not in this task).

**woo_sync_log rows for a vendor:** `entity 'vendor'`, `entity_id` = Dokan store id text, `action 'sync'` + `result 'conflict'` `{ vendor_id, fields, first_run }`; `kind 'push', direction 'out', action 'vendor'` with `result 'ok'` `{ vendor_id, fields, accepted, refused, dropped }` / `'error'` `{ vendor_id, fields, error }` / `'skipped'` `{ vendor_id, fields, reason }`. Pull counts for `vendors`: `{ vendors, from_site, conflicts, pushed, push_failed, pages, done }`.

**Error codes seen by the adapter:** 42501 (column grant or guard, message names the rule), 23505 (duplicate `(vendor_id, woo_category_id, since)` / `(vendor_id, since)`), 23514 (rate / flat / category id checks), 23503 (unknown vendor), PGRST (unknown column when selecting `woo_snapshot`).

**Mock guidance for `tests/e2e/supabase-mock.mjs`:** `functions.invoke('woo-sync', { body })` → `{ data, error }` with the answers above; the `vendors` rows carry the new columns; `vendor_category_rates` / `woo_categories` tables; `activity_log` rows with `actor null` and `new_value` a string.
