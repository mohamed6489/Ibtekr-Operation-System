# Task 1 report — staging probe (read-only, redacted)

**Status:** DONE (fix wave applied; the remaining notes are about the live run, which only the controller can do)
**Commits on `main-gha10e` (not pushed):**
- `72a89c1` chore(woo): staging probe workflow (redacted shape of orders, sub-orders, stores, statuses)
- `6b0e418` fix(woo-probe): never echo 2xx bodies, origin-only webhook targets, reject userinfo URLs
- fix wave 2: fix(woo-probe): scrub own credentials and host from error text, strip script/style, Arabic digits (hash in the hand-back)

## What was implemented

### `tools/woo-probe.mjs` (Node 22 ESM, no dependencies)
- Env: `WOO_URL`, `WOO_CK`, `WOO_CS` (values trimmed). The probe exits 2 before any request when an env value is missing (stderr names it), when `WOO_URL` is not a valid URL, when it is not `https:`, or when it carries `user:pass@`. No env value is ever printed. The base is `origin + path + /wp-json/`, so any query or fragment in `WOO_URL` is dropped.
- Requests: `GET` only, `Authorization: Basic base64(ck:cs)`, `Accept: application/json`, 30 s `AbortSignal.timeout` each, run one after another. Keys never go in the URL.
- Output: one line per section on stdout, `SECTION {json}`, in this order:
  | Section | Request | Payload |
  |---|---|---|
  | `statuses` | `wc/v3/reports/orders/totals` (no `_fields`) | `{count, items:[{slug,name,total}]}` |
  | `orders_since` | `wc/v3/orders?after=2026-10-01T00:00:00&per_page=1&_fields=id` | `{after, total}` from `X-WP-Total`; a missing header is an ERROR |
  | `parents_sample` / `subs_sample` | `wc/v3/orders?after=…&per_page=20&_fields=<order fields>`, plus `&page=2` when page 1 has < 3 sub-orders and more pages exist (`X-WP-TotalPages > 1`, or a full page if that header is missing) | `{scanned, found, items:[≤3 summaries]}`; split by `parent_id === 0` vs `> 0` in code (no `parent` param sent) |
  | `stores` | `dokan/v1/stores?per_page=100&_fields=id,store_name,enabled,registered` | `{total, count, items:[{id,store_name,enabled,registered}]}` |
  | `products_total` | `wc/v3/products?per_page=1&_fields=id` | `{total}` from `X-WP-Total`; a missing header is an ERROR |
  | `webhooks` | `wc/v3/webhooks?per_page=50&_fields=id,name,topic,status,delivery_url` | `{total, count, items:[{id,name,topic,status,delivery_url}]}` |
- `_fields` is on every call except `statuses`, and it keeps every field the brief lists. It is WP core's global response filter, so it also applies to the Dokan route.
- Order summary (`summarizeOrder`): exactly `id, number, status, created_via, date_created, date_modified, parent_id, payment_method, payment_method_title, total, currency, line_items_count, meta_keys, billing_keys, shipping_keys`; absent fields come out as `null`. Sub-orders (`parent_id > 0`) add `dokan_meta`: every `meta_data` entry whose key starts with `_dokan` → value, objects/arrays shown as `"<object>"`/`"<array>"`. Line items are only counted; billing/shipping only contribute key names; `customer_note` is not in the allow-list.
- Webhook target (`maskUrl`): the scheme plus the registrable host. That is the last two labels, or three after a short second-level label such as `com.eg`; extra labels become `<redacted>.`, IP literals stay, and the port is kept. A non-root path becomes `/<redacted>`. A query, fragment or `user:pass@` adds `?<redacted>`. Example: `https://hooks.zapier.com/hooks/catch/123/abcSECRET/` → `https://<redacted>.zapier.com/<redacted>`.
- Redaction:
  - Every stdout line (data, WARN and ERROR) goes through one function: `print(section, obj) → out(section + ' ' + JSON.stringify(redact(obj)))`.
  - `redact` is a recursive, non-mutating copy. It replaces the value of any key matching `(^|_)(first_name|last_name|email|phone|company|note|address)(_\w+)?$` (the brief's list, plus suffixes like `billing_email` and `customer_ip_address`, a whole `address` object, `phone_number`) or `(^|_)(secret|token|password|signature|key)$` (credentials in an error body).
  - `scrubText` is the string mode. It masks `Basic`/`Bearer` credentials, query-like credentials (`token=`, `key=`, `secret=`, `sig=`, `auth=`, `pass=`…), `consumer_*` values, WC `ck_`/`cs_` keys, anything containing an `@`, and phone-like runs of 7+ digits (ASCII, Arabic-Indic `٠-٩` and Persian `۰-۹`).
  - The probe's own values are masked first. In `run()`, the exact values `[base64(ck:cs), ck, cs, WOO_URL hostname]` (≥4 chars, longest first) are replaced with `<redacted>` by split/join, not regex, in every free-text path: `errorText`, `thrownText`, and the 2xx `prefix`. The `prefix` gets this before the 80-character cut, so a key split by the cut is still caught. Only then does the generic `scrubText` run.
- Body handling:
  - A **2xx body is never echoed**.
  - If it is JSON, it is used.
  - If it is JSON with junk around it (a PHP notice, a BOM), meaning it parses after trimming to the first `[`/`{` and its matching last `]`/`}`, the data is used normally. A `WARN {"section","issue":"junk around JSON","prefix_len","suffix_len"}` line is printed before the section, and the exit code stays 0.
  - Otherwise: `ERROR {"section","status","body":"not JSON","length","prefix","suffix_len"}`. `prefix` is the text before the first `[`/`{`, cut to 80 characters (a word split by the cut is dropped), tag-stripped and scrubbed. Nothing after those 80 characters can appear.
  - A non-2xx JSON body is key-redacted. Any other non-2xx body is tag-stripped, and `<script>`/`<style>` blocks go with their contents. Both are then masked of the probe's own values, scrubbed and cut to 200 characters.
  - A thrown fetch prints status 0 and `name: message: cause.code`, scrubbed.
- Failure contract: after an ERROR the remaining sections still run, and the probe exits 1 at the end. The orders listing feeds both sample sections, so if it fails each of them gets an ERROR line. Each section prints its WARN lines, if any, then exactly one data or ERROR line.
- Exports for the offline tests: `redact`, `scrubText`, `maskUrl`, `summarizeOrder`, `summarizeStore`, `summarizeWebhook`, `pickSample`, `run({env, fetch, out, err}) → exit code`, `SINCE`.
- CLI guard: `realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))`, which also works through a symlink. Then `process.exitCode = await run()`. Importing the module sends no request and sets no exit code.

### `.github/workflows/staging-probe.yml`
`on: workflow_dispatch` only, `permissions: contents: read`, `timeout-minutes: 10`. Steps: `actions/checkout@v4` (`persist-credentials: false`), `actions/setup-node@v4` with node 22, then one step `node tools/woo-probe.mjs` whose step-level `env` maps `WOO_URL/WOO_CK/WOO_CS` from `secrets.STAGING_WOO_URL/CK/CS`. Unchanged in the fix wave.

### `tests/tools/woo-probe.test.mjs` (node:test, 16 tests, no network)
- `redact`: `billing.phone`, nested `shipping.address_1`, `customer_note` → `<redacted>`; `line_items[0].quantity`, `line_items[0].name`, `id` kept; the brief's keys, suffix keys, `address` object, `note`, credential keys; input not mutated.
- `scrubText`: emails, `+20 100 000 0001` and `01000000001`, `consumer_key=`/`consumer_secret=`/`token=`/`api_key=`, JSON `"consumer_key":"ck_…"`; short numbers (`line 12`, `HTTP 401`) left alone.
- `summarizeOrder`: exact keys, counts, key names, sub-order `dokan_meta`, defaults. `summarizeStore`: allow-list.
- `maskUrl`: userinfo + query, a Zapier path (`abcSECRET` and `/hooks/catch/123` never appear), a Pipedream subdomain, a bare domain, `com.eg`, an IP:port, a non-URL, a missing value.
- `pickSample`.
- `run` with a stub fetch: the happy path (7 sections in order, no PII, Basic auth, URLs/params, page 2 logic), the one-page case, non-2xx JSON and HTML, a failing orders listing, a thrown fetch.
- **New in the fix wave:**
  - (a) A webhooks 2xx with `?token=SECRET-TOKEN`, with a PHP notice after and then before the JSON: WARN plus the section, exit 0, and neither the token nor the notice in stdout. A version still unparseable after trimming gives ERROR `not JSON` with `prefix: ''` and no token or host.
  - (b) A pure-HTML 2xx: ERROR with `length` and `prefix: 'Contact <redacted> / <redacted>'`. Nothing from after character 80 appears (token, marker, second email, filler), and no tags appear.
  - A non-2xx HTML page is tag-stripped and scrubbed (email, phone, ck_ key, token).
  - A missing `X-WP-Total` on `orders_since` and `products_total` → ERROR, exit 1.
  - A `user:pass@` `WOO_URL` → exit 2, and the password is not in stderr.
  - The import test also asserts that `process.exitCode` is undefined or 0.
- **New in fix wave 2:**
  - The own-credentials test: a 400 text echo of `Authorization: Basic base64('ck_test:cs_test')` plus the host and raw keys, a 2xx not-JSON prefix, a 401 JSON message, and a thrown fetch message. stdout holds none of the base64, `ck_test`, `cs_test` or `stage.example.com`; the 400 body reads `…Authorization: Basic <redacted>; Host: <redacted>; keys <redacted> <redacted>`.
  - `scrubText`: `Basic …`/`bearer …` and Arabic-Indic/Persian phone runs.
  - A 403 WAF page with `<style>`/`<script>` → body `Blocked by firewall`.
  - `maskUrl(12345)`/`maskUrl({…})` → `<redacted>`.
  - `WOO_URL=https://stage.example.com/shop//?x#y`: every request starts with `https://stage.example.com/shop/wp-json/`, with no `#`, no `//wp-json` and no `x` param. The stub fetch now routes on the path after `/wp-json/`.

## TDD evidence
- Original RED: `node --test tests/tools/woo-probe.test.mjs` → `# fail 1`, `ERR_MODULE_NOT_FOUND … tools/woo-probe.mjs`. Original GREEN: 11/11.
- Fix wave: the new tests first failed against the first rewrite on two real bugs. The `consumer_` rule masked a value that was already masked (`<redacted><redacted>`), and redact masked the WARN's `note` field, because `note` is one of the brief's redacted keys. Both were fixed, and the field is now named `issue`.
- Mutation checks:
  - Making the main guard always fire → `not ok 16 - importing the module makes no request and sets no exit code`.
  - Echoing the raw 2xx body in the not-JSON error → `not ok 11` and `not ok 12`.
  - The file was restored byte-identical (`cmp`).
- Fix wave 2 mutation check: with the exact-value mask turned off (`own = (s) => String(s)`), only the new test fails (`not ok 15 - the probe masks its own header, keys and host in every free-text path`). The generic `Basic` rule alone does not catch the raw `ck_test` or the host. The file was restored byte-identical.
- GREEN: `node --test tests/tools/woo-probe.test.mjs` → `# tests 19 / # pass 19 / # fail 0`; `npm test` → `# tests 78 / # pass 78 / # fail 0`.
- CLI by hand: `WOO_URL=https://admin:pw@127.0.0.1` → the user:pass message, exit 2; an unreachable host → `ERROR {"section":"statuses","status":0,"body":"TypeError: fetch failed: ENOTFOUND"}` … exit 1.

## Files changed
- `/home/user/Ibtekr-Operation-System/tools/woo-probe.mjs`
- `/home/user/Ibtekr-Operation-System/tests/tools/woo-probe.test.mjs`
- `/home/user/Ibtekr-Operation-System/.github/workflows/staging-probe.yml` (first commit only)
- No block, adapter or lock file touched.

## Self-review
- Redaction before every print: the only stdout path is `print()` → `redact()`. stderr carries only fixed messages with no env values. No raw 2xx body text can reach stdout: a 2xx contributes parsed, allow-listed fields, lengths, or an 80-character tag-stripped, scrubbed prefix. Non-2xx text and thrown messages are scrubbed, and the probe's own header, keys and host are masked by exact value in every free-text path. Tests (a) and (b) check the real stdout, and a mutation shows they catch a body echo.
- No network at import, and no exit code at import: tested, and mutation-checked.
- Exit codes: 0 (WARN allowed) / 1 (after all sections) / 2 (before any request).
- Read-only: `GET` only. The workflow has `contents: read`, the secrets reach the probe step only, and checkout does not persist credentials.
- Semgrep could not run here, because the sandbox proxy refuses semgrep.dev for every ruleset.

## Deviations from the review instructions
1. **WARN field `issue` instead of `note`:** `note` is a redacted key in the brief's own list, so keeping it would have printed `"note":"<redacted>"` unless WARN skipped `redact()`. I renamed the field and kept the single choke point.
2. **Host masked beyond "origin only":** webhook services also put endpoint ids in subdomains (`xyz.m.pipedream.net`), so only the registrable host is kept. The service still shows (`<redacted>.zapier.com`, `<redacted>.supabase.co`). If the full origin is needed, drop `maskHost`.
3. **Commit trailer:** the commit uses the session's attribution line, `Co-Authored-By: Claude Opus 5.5`, not the `Claude Fable 5.1` the message suggested, because the attribution guidance I was given names Opus 5.5 and that is the model doing the work. The `Claude-Session` line is as given.

## Notes for the live run (unchanged)
1. WC consumer keys may not authenticate on `dokan/v1/*`. If they don't, `stores` is the public list (maybe enabled stores only); compare `stores.total` with wp-admin.
2. The host may strip the `Authorization` header and return 401 `woocommerce_rest_cannot_view`. I deliberately did not add the fallback of keys in the query string.
3. If Dokan hides sub-orders from the REST list, `subs_sample.found` will be 0 while parents show `has_sub_order` in `meta_keys`. The next probe would then use `wc/v3/orders?parent=<id>`.
4. `dokan_meta` is printed for sub-orders only (parents show `_dokan_vendor_id` in `meta_keys`, key only). Nested values are collapsed to their type, as the controller ruled.
5. Webhook `name` and `store_name` are free text and printed as-is (the brief lists them).
