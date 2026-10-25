# Task 9 report — docs (Step 1–3 only; the live steps are the controller's)

Status: DONE_WITH_CONCERNS. Commit `c1c8e52` `docs: phase 2 orders — migrations order, edge functions, secrets and webhooks runbook`
on `main-gha10e` (base 7b885b3). Files: `tools/deploy.md`, `CLAUDE.md`, `README.md` only. No code or tests touched.
`npm test` 152/152 before the commit (docs-only change; e2e/db/deno not re-run). Code fences balanced (deploy.md 40).

## What I wrote

### `tools/deploy.md`
- **MCP note (top):** `rls_orders.sql` and `rls_mfa.sql` have no `delete`, so they run live as is (checked by grep).
- **§2.1:**
  - The table gains `orders` → `0007_orders.sql` and `mfa_cron` → `0008_mfa_cron.sql`.
  - The test list goes from three to five: `rls_orders`, `rls_mfa` (it writes test factors into `auth.mfa_factors` with every NOT NULL column, all rolled back). Note that `rls_system` expects 9 `status_map` rows from phase 2 on.
  - Realtime check now lists the four tables.
  - New block «`0007_orders` — اللي يتأكد منه على الحي»: the 9 `status_map` rows with their probe slugs; the 10 tables + `orders_v`; a `column_privileges` query (24 columns, no `customer_phone`/`raw`).
  - New block «`0008_mfa_cron` — قبل التطبيق وبعده», written as a numbered checklist:
    1. Before: the `pg_available_extensions` query, with the versions seen live.
    2. Apply as `mfa_cron`, plus two fallbacks: the plain `create extension` form (changed in the file through a ledger ruling), and `grant usage on schema cron to postgres`.
    3. After: `has_schema_privilege('postgres','cron','usage')`; one `pg_proc` query listing `cron.schedule`/`unschedule`/`net.http_post` with their argument lists and `has_function_privilege` (written without exact arg types on purpose); `cron.job` has one active row; `vault.secrets` is read by name only, with the warning never to select `decrypted_secret`/`secret`.
    4. `rls_mfa` live + advisors.
    5. First run: `cron.job_run_details` (succeeded = queued only) and `net._http_response` (200; 401 means a secret mismatch or the gateway asking for a JWT). The 404/500 `not_configured` runs before the deploy/secrets are expected.
- **§2.2 advisors:** the expected items now include `has_perm`/`is_admin` definer (pre-existing, by design), `order_customer_phone` (after 0007) and `mark_twofa_*` (after 0008). `sync_secret_matches` is service_role-only, so it should not show up.
- **§2.3:** TOTP is now in real use; points to §2.7.9 for recovery.
- **§2.6:** a phase-2 status line. 0007 was applied early and verified. Everything else is listed as Task 9 live steps, to be recorded there and in the ledger. **The controller should update this line after the live steps.**
- **New §2.7 «Edge Functions والأسرار والـ webhooks»** (10 subsections). It opens with an intro, the order of the live steps and the «Dokan قراءة بس» rule.
  - **2.7.1 deploy:**
    - Pass `verify_jwt: false` explicitly, because the MCP tool's default is `true` (from the tool schema). It is also set in `config.toml`.
    - Files: `index.ts` + `deno.json` + the four `_shared/*.js` at `../_shared/`; never `index_test.ts` or `_test/`.
    - supabase-js is pinned at 2.118.0.
    - The env vars are injected by Supabase, with the `SUPABASE_ANON_KEY` legacy-keys caveat.
    - A post-deploy curl check that tells our JSON (`bad_signature`/`unauthorized`) apart from a gateway 401.
    - CSP: `functions/v1` is already covered by `connect-src`.
  - **2.7.2 secrets:** the owner enters them in the dashboard or through `create_edge_function_secret` (`replace: true` for a re-entry within 10 minutes). Table:
    - `WOO_URL`: origin only, https, no `/wp-json`, no userinfo.
    - `WOO_CK`/`WOO_CS`: Read/Write.
    - `WOO_WEBHOOK_SECRET`: alphanumeric because of `wp_specialchars_decode`; e.g. `openssl rand -hex 32`; `register_webhooks` sets it in Woo.
    - Optional `WOO_WP_USER`/`WOO_WP_APP_PASSWORD`.
    - `sync_secret` is separate (Vault).
  - **2.7.3 auth rule:**
    - Woo: WC Basic on `wc/` only; `dokan/` gets no header unless the WP pair is set; any other namespace is refused; 30 s timeout; no redirects.
    - woo-sync: `X-Sync-Secret` → `sync_secret_matches` → `cron`; or a member JWT (`push_status` needs `has_perm orders.status = 'F'`, every other action `is_admin`) → `manual`. aal2 is required for members who enrolled in 2FA.
    - woo-webhook: HMAC over the raw bytes; the unsigned ping is the only exception.
  - **2.7.4 webhooks:**
    - Four topics, the name `ibtekr-ops:<topic>`, our URL.
    - Create, re-activate or leave alone; the ownership rule (name prefix AND exact `delivery_url`); n8n webhooks untouched; 400 on a foreign `delivery_url`.
    - Two ways to run it: browser console `IBOrders.registerWebhooks()` as admin (aal2), or `net.http_post` with the Vault subquery and then a `net._http_response` read. Warning not to read `net.http_request_queue`.
    - The ping.
    - **Rotating the secret on the same site:** disable our hooks in Woo, then `register_webhooks`. The secret is only resent on re-activation (woo-sync `registerWebhooks`: active hooks are `unchanged`).
  - **2.7.5 first sync:**
    - `all` = vendors, then products, then orders; the «مزامنة» button / `IBOrders.syncNow()` or `net.http_post`.
    - The exact list query; 100 per page, 50 pages per run; the cursor saved per page (re-run on `done:false`); drafts and orders before 1 October skipped.
    - A count query, `sync_state`, and `woo_sync_log` grouped by entity/result.
    - Expectations:
      - **`orders` + `sub_orders` ≈ 190**: the probe's 190 includes the sub-orders (ledger, Task 1 result). I did not write "orders ≈ 190" as the dispatch put it.
      - `vendors` ≈ the Dokan store count; `products` ≈ 3991.
    - The carried T2 check: Realtime `orders` payloads carry no `customer_phone`/`raw`, and a Realtime filter on `customer_phone` reveals nothing.
  - **2.7.6 backup cron:**
    - Every 15 minutes, `all`, 150 s timeout; the URL is inline in 0008.
    - WooCommerce never retries a failed delivery and disables a webhook after 5 failures in a row; `register_webhooks` re-activates it.
    - The dedupe key `<Delivery-ID>:<Signature>`, with the reason; a missing id → null; a failed delivery that arrives again is reprocessed.
    - The two-updates-in-one-second staging check.
  - **2.7.7 reading the logs:** two queries. The column meanings, and what the usual `error`/`skipped`/`conflict` rows mean (verify, vendor, parent_missing, no_woo_status/stale, unmapped status, push conflict `woo_before`, parent_list). What the `woo_webhook_events` statuses mean (`ignored` cases, `in progress` prefix). `raw` is service_role-only.
  - **2.7.8 staging → production:** described, nothing scripted that deletes:
    - the four secrets, with a NEW webhook secret;
    - disable our hooks on staging by hand;
    - `register_webhooks` on production;
    - reset the `orders`/`products` cursors (the one-line `update … set value = '{}'` is an update, not a delete);
    - staging rows left in the tables are a written decision at that time;
    - then `all`.
  - **2.7.9 2FA recovery:**
    - Lost device: remove the factor in Auth › Users AND `update profiles set twofa = false` (why both).
    - The double-failure stuck state (verified factor + `twofa=false`): remove the factor.
    - A check query with named columns only (`auth.mfa_factors.secret` exists).
  - **2.7.10 workflows:**
    - `staging-probe.yml`: inputs, secrets, sections; its stores section 401 → exit 1; last run 40204355895.
    - `vendor-fetch.yml`: inputs `version`/`branch`/`sha256`; then the README update; html2canvas via `npm pack`.
    - The four CI jobs.
- **§4:** `supabase/` is not uploaded (the functions deploy to Supabase, §2.7).
- **§5:** new check 7: orders page on real data, the sync toast, 2FA enrolment from «ملفي».
- **§6.2:** the semgrep step now runs `npm run semgrep` (the CI gate) instead of the old `p/javascript p/sql` command.
- **§6.3:** the stale cdnjs/`0.18.5` note is replaced by the current CSP: `script-src 'self'`, the vendored libraries with their versions (README holds the sha256), and `img-src … blob:` with its reason.
- **§6.4:** the history grep adds `ck_[0-9a-f]{40}|cs_[0-9a-f]{40}`. I ran it over `git log -p --all` and got no hit; the test fakes (`ck_test_0001`) are noted as fake.
- **§7:** the project ref is also in the 0008 cron URL; WooCommerce is never a browser origin.

### `CLAUDE.md`
- References: the phase-2 plan and ledger, plus a pointer to deploy.md §2.1/§2.7.
- Rule 2: the edited blocks are 10, 11, 14, 17, 18, 21, 25, 28, 29, with the phase per block (phase 0: 14/21/28; phase 1: 25 + small 21/28; phase 2: 10/11/17/18/29 + small 25/28). Matches `EDITED` in `tests/split.test.mjs` and `git log 1bffead..HEAD -- app/js/blocks/`.
- Rule 4: the latest example is now `0007_orders.sql` (column-level grants). The `alert_reads` note is kept.
- `LOGGED_PREFIXES` → `auth.`, `dashboard.`, `order.`, `suborder.`, `profile.2fa.`. Matches `app/js/adapter/activity.js:14`.
- New paragraph «Dokan قراءة بس». It also names our webhooks as the only other thing written to Woo.
- New note: `raw` is service_role-only, `customer_phone` only through `orders_v`, the front end names its columns, and the sync writes the tables with service_role.
- Commands: `deno:check` (with the sandbox `DENO_CERT` hint from the ledger), `deno:test`, `semgrep`.

### `README.md`
- A phase-2 paragraph:
  - orders on real Woo data from 1 October (staging until the switch), with Dokan sub-orders, products and makers;
  - signed and deduped webhooks, plus the 15-minute backup cron;
  - status push through the map; Dokan read-only;
  - 2FA with aal2 enforced server-side;
  - vendored libraries with `script-src 'self'`; semgrep and Deno in CI;
  - a pointer to §2.7.
- The test line adds `deno:check`, `deno:test` and `semgrep`.

## Sources (non-obvious facts)
- 0007 live state (status_map 9 rows with probe slugs, 10 tables, `orders_v`, Realtime on 3 tables, 24 SELECT columns without phone/raw, advisors only `order_customer_phone` new): ledger «Live apply — 0007». I also counted the 24 columns in the `grant select (...)` at `0007_orders.sql:511-514`.
- 0008 checklist (extension schema fallback, cron privileges, `cron.job`, `net.http_post` signature, `vault.secrets` by name, first-run tables, 401 meaning, `mark_twofa_*` advisors): ledger «T9 live-apply checklist for 0008». The `rolsuper = false` ruling: ledger T7 review. Extension versions: task-7-report «Live read». The `grant usage on schema cron` fallback: task-7-report concern 6.
- `verify_jwt` default `true` in `deploy_edge_function` and `replace` in `create_edge_function_secret`: the Supabase MCP tool schemas (loaded, not called).
- Auth rule, dedupe key, ownership rule, no-retry/5-failures, alphanumeric secret, unsigned-POST check, two-updates-in-a-second check: ledger (T1 probe rulings, T4 review rulings, «T9 runbook notes») and task-4-report. The behavior is also confirmed in `woo-sync/index.ts` (`authorize`, `registerWebhooks`, `pull`) and the `woo-webhook/index.ts` header.
- The secret is resent only on re-activation: `registerWebhooks` in `woo-sync/index.ts` (active hooks count as `unchanged`), and task-4-report deviation 11.
- `WOO_URL` origin only (the code adds `/wp-json/`, https only, no userinfo): `_shared/woo-api.js:73-76`.
- WP app password is used on `dokan/v1/stores` only; earnings come from meta `_dokan_vendor_earning` / `o.earning`: grep of `supabase/functions` (`woo-core.js:245`, `woo-write.js:68`, `woo-sync/index.ts:91`).
- 2FA recovery and the double-failure state: ledger (T7 concern 4 and Deferred); the 0008 header; `profiles_guard_update` limited to `anon`/`authenticated` (`0001_identity.sql:116`).
- 190 includes sub-orders; 3991 products; the n8n hooks: ledger «Task 1 — probe result».
- CSP: `app/.htaccess` (current header); vendored versions and hashes: `app/js/vendor/README.md`.
- Workflows: `.github/workflows/{staging-probe,vendor-fetch,ci}.yml`.
- UI sync button: `29-orders-app.js:475-476` (`#sync` → `syncNow`). `registerWebhooks` has no button; it is called from the console (`orders.js:202`).

## Unsure / for the controller
1. **MCP file names for `_shared`:** I wrote «بنفس المسار النسبي اللي الـ imports بتستخدمه (`../_shared/…`)». I could not confirm how `deploy_edge_function` wants files outside the function folder to be named; check on the first deploy.
2. **The gateway's 401 text** (`Missing authorization header`) is given as an example («زي»), from general knowledge rather than a repo source.
3. **`net.http_request_queue` holds the headers until the request is sent**: from my knowledge of pg_net, not from the repo. It is phrased as a caution.
4. **2.7.8 point 5** is my own reasoning, not in the ledger. Staging-only orders and lines may share ids with later production orders: the operational columns would stick to them, and the stale-payload rule could skip a production update. I left the cleanup as an owner decision with no script.
5. **`WOO_CK`/`WOO_CS` «Read/Write»** is inferred: `push_status` does a PUT and `register_webhooks` a POST/PUT.
6. **Dispatch vs ledger:** the dispatch said «`orders` count vs the probe's 190». The ledger says the 190 includes sub-orders, so the runbook compares `orders` + `sub_orders`.
7. **The optional WP pair:** the plan says it is "for `dokan/v1` earnings", but the current functions never call `dokan/v1/orders`. The doc says so, so that setting it now changes only the stores calls.
8. **Commit trailer:** `Co-Authored-By: Claude Opus 5.5` (this session's attribution reminder), not the dispatch's «Claude Fable 5.1», the same as Tasks 4 and 7.
9. **§2.6 phase-2 line:** it describes the live steps as pending. Update it, and the §2.1 "seen" notes, with the live results.
10. Grep for stale text:
    - `cdnjs`: none left.
    - `0.18.5`: one deliberate mention in §2.7.10 (why SheetJS is fetched from cdn.sheetjs.com).
    - Old prefix and block lists: replaced.
