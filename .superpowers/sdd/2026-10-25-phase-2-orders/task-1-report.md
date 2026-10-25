# Task 1 report — staging probe (read-only, redacted)

**Status:** DONE_WITH_CONCERNS (all built and tested offline; the concerns are about the live run, which only the controller can do)
**Commit:** `72a89c1` chore(woo): staging probe workflow (redacted shape of orders, sub-orders, stores, statuses) — on `main-gha10e`, not pushed.

## What was implemented

### `tools/woo-probe.mjs` (Node 22 ESM, no dependencies)
- Env: `WOO_URL`, `WOO_CK`, `WOO_CS` (values trimmed). Missing → stderr names the missing ones, **exit 2**. Bad URL or non-`https:` → **exit 2** (the keys travel in the Basic auth header, so plain http is refused). No env value is ever printed.
- Requests: `GET` only, `Authorization: Basic base64(ck:cs)`, `Accept: application/json`, 30 s `AbortSignal.timeout` each, run one after another. Keys never go in the URL.
- Output: one line per section on stdout, `SECTION {json}`, in this order:
  | Section | Request | Payload |
  |---|---|---|
  | `statuses` | `wc/v3/reports/orders/totals` | `{count, items:[{slug,name,total}]}` |
  | `orders_since` | `wc/v3/orders?after=2026-10-01T00:00:00&per_page=1&_fields=id` | `{after, total}` (from `X-WP-Total`) |
  | `parents_sample` / `subs_sample` | `wc/v3/orders?after=…&per_page=20&_fields=<order fields>`, plus `&page=2` when page 1 has < 3 sub-orders and more pages exist (`X-WP-TotalPages > 1`, or a full page if that header is missing) | `{scanned, found, items:[≤3 summaries]}`; split by `parent_id === 0` vs `> 0` in code (no `parent` param sent) |
  | `stores` | `dokan/v1/stores?per_page=100&_fields=id,store_name,enabled,registered` | `{total, count, items:[{id,store_name,enabled,registered}]}` |
  | `products_total` | `wc/v3/products?per_page=1&_fields=id` | `{total}` |
  | `webhooks` | `wc/v3/webhooks?per_page=50&_fields=id,name,topic,status,delivery_url` | `{total, count, items:[{id,name,topic,status,delivery_url}]}` |
- Order summary (`summarizeOrder`): exactly `id, number, status, created_via, date_created, date_modified, parent_id, payment_method, payment_method_title, total, currency, line_items_count, meta_keys, billing_keys, shipping_keys`; absent fields come out as `null`. Sub-orders (`parent_id > 0`) add `dokan_meta`: every `meta_data` entry whose key starts with `_dokan` → value, objects/arrays shown as `"<object>"`/`"<array>"`. Line items are only counted; billing/shipping only contribute key names; `customer_note` is not in the allow-list.
- `_fields` was added to every list call and keeps every field the brief lists (it is WP core's global response filter, so it also applies to the Dokan route).
- Redaction: one print function, `print(section, obj) → out(section + ' ' + JSON.stringify(redact(obj)))`; every stdout line (data and ERROR) goes through it. `redact` is a recursive, non-mutating copy that replaces the value of any key matching `(^|_)(first_name|last_name|email|phone|company|note|address)(_\w+)?$` (case-insensitive) with `"<redacted>"`. That covers the brief's list (`first_name|last_name|email|phone|address_1|address_2|company|customer_note|note`) and, on purpose, a few more: suffixes (`billing_email`, `customer_ip_address`), a whole `address` object (Dokan stores), `phone_number`. `name`/`store_name` are kept (the brief's test: the product name stays).
- Failure contract: any non-2xx, a 2xx whose body is not JSON (or is not the expected array), or a thrown fetch (status 0, `name: message: cause.code`, so no hostname) → `ERROR {"section","status","body"}`. The body is passed through `redact` first when it is JSON, then cut to 200 characters. The remaining sections still run; **exit 1** at the end. The one orders listing feeds both sample sections, so if it fails each of them gets an ERROR line. Invariant: each of the 7 sections prints exactly one line, data or ERROR.
- Exports for the offline tests: `redact`, `summarizeOrder`, `summarizeStore`, `summarizeWebhook`, `maskUrl`, `pickSample`, `run({env, fetch, out, err}) → exit code`, `SINCE`.
- CLI guard: `realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))` (the phase-0 ledger's robust form; works through a symlink, which I checked). Then `process.exitCode = await run()` (not `process.exit`, so stdout is flushed). Importing the module sends no request.

### `.github/workflows/staging-probe.yml`
`on: workflow_dispatch` only, `permissions: contents: read`, `timeout-minutes: 10`. Steps: `actions/checkout@v4` (`persist-credentials: false`), `actions/setup-node@v4` with node 22, then one step `node tools/woo-probe.mjs` whose step-level `env` maps `WOO_URL/WOO_CK/WOO_CS` from `secrets.STAGING_WOO_URL/CK/CS`. Actions pinned to major tags like `ci.yml`. No `npm ci`, because the script has no dependencies.

### `tests/tools/woo-probe.test.mjs` (node:test, 11 tests, no network)
- `redact`: `billing.phone`, nested `shipping.address_1`, `customer_note` → `<redacted>`; `line_items[0].quantity`, `line_items[0].name`, `id`, `billing.city` kept; all 7 billing PII keys; nested arrays, suffix keys, `address` object, `note`; input not mutated.
- `summarizeOrder`: exact key list, `line_items_count`, `meta_keys`, `billing_keys`/`shipping_keys`, no `dokan_meta` on a parent, no PII string in the output; sub-order `dokan_meta` (`_dokan*` only, `<object>`/`<array>`); empty-order defaults.
- `summarizeStore` / `summarizeWebhook` allow-lists; `delivery_url` with `user:pass@` and `?token=` → `https://hook.example.com/in?<redacted>`.
- `pickSample`: at most n, keeps order, `[]` for empty/non-array input.
- `run` with a stub `fetch`: the 7 sections in order, one line each, no PII string anywhere in stdout (names, emails, phones, address, note, IP, the `_billing_address_index` value, vendor email/phone, webhook token); Basic auth header; https `/wp-json/(wc/v3|dokan/v1)/` URLs with no keys in them; `after=2026-10-01T00:00:00`, `per_page` 1/20/100/50, no `parent` param; page 2 read when page 1 has 1 sub-order, and only one page read when it already has 3.
- Failure: a 401 JSON body (with an email inside) and a 502 HTML body → two ERROR lines (status, body ≤ 200, email absent), the other sections still print, exit 1; a 500 on the orders listing → ERROR for both sample sections; a thrown fetch → status 0; missing/empty/non-https/invalid env → exit 2, no request, no stdout, no key in stderr; a fresh `import()` with a throwing global `fetch` → no request.

## TDD evidence
- RED: `node --test tests/tools/woo-probe.test.mjs` → `# tests 1 / # fail 1`, `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/Ibtekr-Operation-System/tools/woo-probe.mjs'`.
- GREEN: `node --test tests/tools/woo-probe.test.mjs` → `# tests 11 / # pass 11 / # fail 0`.
- Full suite: `npm test` → `# tests 70 / # pass 70 / # fail 0` (59 before + 11 new).
- CLI by hand: no env → stderr message, exit 2; `WOO_URL=http://…` → exit 2; `WOO_URL=https://127.0.0.1:1` → 7 `ERROR {…,"status":0,"body":"TypeError: fetch failed"}` lines, exit 1; run through a symlink → the guard fires (exit 2 on missing env); plain `import()` → exports listed, nothing run.

## Files changed
- `/home/user/Ibtekr-Operation-System/tools/woo-probe.mjs` (new)
- `/home/user/Ibtekr-Operation-System/.github/workflows/staging-probe.yml` (new)
- `/home/user/Ibtekr-Operation-System/tests/tools/woo-probe.test.mjs` (new)
- No block, adapter or lock file touched. The uncommitted one-line ruling in `progress.md` is the controller's and was left out of the commit.

## Self-review
- Redaction before every print: the only stdout path is `print()` → `redact()`. stderr carries only three fixed messages that hold no env values. Orders, stores and webhooks are also cut to allow-lists before redaction, so redaction is the second safeguard, not the only one. The no-PII run test checks the real stdout.
- No network at import: the top level only defines things, behind the realpath main guard, and a test checks it.
- Exit codes: 0 / 1 (after all sections) / 2 (before any request), all tested; `process.exitCode` is used so stdout is not cut off.
- Read-only: `GET` only (asserted). The workflow has `contents: read`, the secrets reach the probe step only, and checkout does not persist credentials.
- Semgrep: installed, but every ruleset needs `semgrep.dev`, which the sandbox proxy refuses, so it could not run here. The plan adds semgrep to CI later.

## Concerns / for the live run
1. **Deviation (security), `delivery_url`:** printed as origin + path; a query string or fragment becomes `?<redacted>`, and `user:pass@` is dropped. Webhook URLs often carry a token, and Actions logs are readable by anyone who can read the repo. The host and path are enough to tell where each webhook points. If you need the full URL, it is a one-line change in `maskUrl`.
2. **`redact` is broader than the brief's list** (suffix keys, `address`, `*_number` and similar qualifiers). It only adds redaction, and no field in the allow-listed output is affected.
3. **Auth on the Dokan route:** WC consumer keys authenticate `dokan/v1/*` only if Dokan opts into WC's REST auth. If they don't, `stores` comes back as the public list (maybe enabled stores only), and T4's "disabled → inactive" mirror would need another source. Compare `stores.total` with the store count in wp-admin.
4. **Authorization header stripping:** some shared hosts (CGI/FastCGI) drop the `Authorization` header, and WC then answers 401 `woocommerce_rest_cannot_view`. The fallback would be `consumer_key`/`consumer_secret` in the query string, which puts the keys in server access logs. I deliberately did not do that; decide if it shows up.
5. **Sub-order visibility:** if Dokan hides sub-orders from the REST list, `subs_sample.found` will be 0 even though parents have `has_sub_order` in `meta_keys`. The next probe would then use `wc/v3/orders?parent=<id>`. Not built, to stay inside the brief.
6. `dokan_meta` is printed for sub-orders only, as the brief says. Single-vendor parents that carry `_dokan_vendor_id` still show it in `meta_keys` (key only).
7. If the staging site prints PHP notices before the JSON (WP_DEBUG display), a section fails with `not JSON: …`. That is a real finding about staging, not a probe bug.
