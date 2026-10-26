# Review B — phase 3 Task B (front end), range 7a617d6..0177ca9 on `main-gha10e`

Read-only review; no tracked file edited, nothing committed; scratch under `…/scratchpad/review-b/` (probes in `probe/`). Nothing left listening on 4173/4190 (`ss -ltnp` empty on 41xx; `git status` clean).

## Commands run
| command | result |
|---|---|
| `npm test` | 188 / 188 (report says 186: Task A's two SQL-side node tests landed on the branch since) |
| `node --test tests/split.test.mjs` | 5 / 5 (block 28 re-locked; `EDITED` unchanged) |
| `npm run e2e` run 1 (port 4173 free at start) | 55 passed, then 53 failures, all `net::ERR_CONNECTION_REFUSED http://localhost:4173/` from test #55 on — the http-server Playwright had started was killed under the run (the other 4173 process the brief warned about). Environmental, not the code. |
| `npm run e2e` run 2 (4173 free again) | **108 / 108, exit 0** (auth / twofa / login / dashboard / orders / vendors) |
| `npm run semgrep` | cannot run in this sandbox: `semgrep.dev/c/p/javascript` → proxy 403 (rules registry unreachable). Same as the implementer (not run). |
| probes (own Playwright config on 4190, mock) | `probe/probe.log`, `probe/probe2.log` — results cited below |

## Verified claims (by reading + running)
- **Adapter reads name their columns**: `COLS.vendor/rate/bank/event` at vendors.js:27-32; no `*`, never `commission_pct`; IBOrders reads vendors as `id, name` (orders.js:138, :247). Mock refuses `*`/`commission_pct` on vendors like the 0011 column-list grant.
- **Writes**: updates send the changed columns only, no `.select()` (vendors.js:222, :237, :246, :273, :299); insert `.select('id').single()` (:310); delete `.select('id')` (:289 — `returning id`, granted by 0011's select list; the mock allows it) and treats 0 rows as `forbidden`.
- **42501 → revert + `forbidden`**: `reasonOf` :169, `write()` :183-193 (identity check so a row the reload replaced is not reverted); unit tests + e2e 4 + probe P8 (ops: legal-name change → «مش من صلاحياتك», `legalName` back to null, no write; a direct status write by ops → server 42501 → status back to `active`).
- **stats() math** (:74-79, :334-354): share = total − (total×rate/100 + fee); unit tests 1000@35/0→650, @40/10→590, @35/10→640; e2e 12: 1002@35/0 → 651.30, 2539@40/10 → 1513.40; a line without a rate → `rateAt(v, o.date)` when `ratesVisible`, else full + `noRate` (ops sees «1 سطر بدون نسبة»). `o.date` is the order's local `YYYY-MM-DD`; removed lines are excluded from `subs`; `OrdersApp.query({},10000)` resets every filter (all loaded orders).
- **setContract**: path `<uuid>/<Date.now()>-<safeName>` with `upsert: false` and the extension's MIME (:266-269); e2e 9 asserts `^V1/\d{13}-____Art_Craft_2026\.pdf$`, `x-upsert: false`; `contractUrl` = `createSignedUrl(path, 60)` (:281, `SIGN_SECONDS = 60`), opened with `window.open(url, '_blank', 'noopener')` (28-app.js:1728; e2e 11 asserts).
- **No PII in `new_value`**: field names / status / `40% من <date>` / bank method / `IBAN`|`wallet` / `PDF · 2.0 ميجا · حتى <date>` / `contract (restore)`; the display name only on `vendor.create` / `vendor.remove`. e2e asserts `0482` never appears in the activity bodies. `events(id)` = `activity_log` with `entity = 'vendor'`, `entity_id` (:326). No block calls `K.logEvent('vendor.…')`, so the new `'vendor.'` prefix forwards only the adapter's events (block 28's `log.append` is the in-memory `D.createEventLog`).
- **`IBActivity.log(action, detail, meta)`** keeps 0002's RPC: `log_activity(action, entity, entity_id, old_value, new_value)`; `entity`/`entity_id` null for every other caller.
- **`IBDirectory.perm`** (directory.js:44-51) = has_perm's rule (inactive → N; admin → F; `custom_perms[key]` when present, even N; role matrix; N). `profiles.custom_perms` and `roles.permissions` are readable live (0004 grants are table-level, no later column revoke).
- **IBOrders**: `item` select + `commission_rate, commission_fee`; each sub gets `rate`/`fee` (null when absent); block 29 untouched (its `get()` maps subs by name, so nothing leaks into its DOM); orders.spec 108-run green.
- **Block 28**: only the listed decisions plus two small necessities (the `ib:vendors`/`ib:notify` listeners the write-through needs; the «متجر #id / بدون متجر على الموقع» badge, decision 1). No `innerHTML` in block 28 or the adapter; the UI kit is textContent-only. `openAddVendor` unchanged except the awaited submit. Accounts tab in the phase-3 shape (tiles, by-status table, «الحركات المالية» one-liner, bank section on `canBank`). `npm run lock` done (split 5/5).
- **Redraw rules**: `ib:vendors` ignores `loading`; `ib:notify` redraws only on the vendors page and not under an open menu; both only call the drawer's `draw()` while it is open. Probe P5: an edit modal with typed text survives both events; dashboard/orders specs green.
- **Review Focus 5**: HTML in name / alias / note is inert in the list, the search, the drawer (e2e 14) and — probes P4/P4b — in the KPI details popups («مبتكرين نشطين», «إجمالي مستحقات»), the vendor-orders popup and «تقرير المورد» (0 `img[src=x]`, `window.__xss` undefined).
- **Review Focus 3**: e2e 4 + probe P8 (phone ok; name / legal name refused with revert; status only via admin).
- **Security**: nothing writes `commission_pct` / `raw` / `woo_vendor_id` / `opening_balance` (`COL` map :38; `create` row :307-309); viewer (`vendors.view = P`) reads the list and the drawer with no edit / toggle / rate / bank (e2e 16); deep link `#makers/<uuid>` after a cold reload opens the drawer (probe P6); sign-out clears the store (e2e 19).
- **Mock vs 0011** (what matters for "e2e passes, live fails"): column-list grants, `vendors_update` using/with-check incl. the amended `sensitive.vendor_bank = F`, the guard's four rules and their order (guard before with-check), 42501 codes, `updated_at` bumped on every write, `vendor_rates` select/insert on `sensitive.commission` (`[]` for the others), `vendor_bank` on `sensitive.vendor_bank`, rate trigger → `commission_pct`, delete admin-only + 23503, storage select/insert/update on F with no delete, 10 MB / MIME → all consistent with the migration. Divergences are listed under Minor (none hides a live failure).

## Findings

### Critical
**C1. The agreement's effective date is the prototype's fixed clock (2026-10-20), so a rate "from today" cannot be set from the form and the second one is refused — and the e2e asserts the fixed date.**
- `app/js/blocks/28-app.js:7` `const TODAY = '2026-10-20'`; `:1624` `editGroup` prefills `since: TODAY`; `:1635` `U.DateField({ … today: TODAY })` so the picker's «اليوم الحالي» button also yields 20 Oct; `:1663` the contract-expiry `DateField` likewise.
- Probe P2/P3 (today 2026-10-26, admin, Art Craft): `#g-since` = `20/10/2026`; first save writes `vendor_rates (40, since 2026-10-20)` — six days in the past, permanent (members have no update/delete on `vendor_rates`); the next change with the default date → `unique (vendor_id, since)` → 23505 → the page says «الشبكة مش متاحة — التغيير ما اتحفظش، جرّب تاني» and reverts. Decision 3 (rate with an effective date, new orders only) is therefore wrong by default on the live site from day one and misreported from the second change on.
- `tests/e2e/vendors.spec.mjs:174-176` cements it (`since: '2026-10-20'` with the comment "the form's date (today)"); `:122` asserts the contract status "within 30 days of the prototype's fixed date".
- Smallest fix (needs a one-line written amendment to decision 2, since block 28 is edit-by-decision): in the vendors section use the real local date — `const VTODAY = () => (window.IBVendors ? window.IBVendors.today() : TODAY)`; `since: VTODAY()` at :1624; `today: VTODAY()` in the two DateFields (:1635, :1663); then in the spec compute `since` from the clock. Pair it with I3 so a same-day duplicate reads as a duplicate.

### Important
**I1. «آخر أوردر» dates and the contract status are computed against the fixed 20 Oct, not the clock.**
- `28-app.js:1487` `ageLabel` → `R.orderDate({ ageDays }, TODAY)` while `ageDays` comes from IBOrders' real clock: probe P1 shows the list cell «14 أكتوبر 2026» for an order placed 2026-10-20 (also the «المبتكرين النشطين» details popup). The gap grows one day per day.
- `:1486` `vendorTasks`, `:1523` `filterVendors(… TODAY)`, `:1720` `contractStatus(v, TODAY)`: Antikiano's contract (15 Nov) will still read «بينتهي خلال 30 يوم» in December, never «منتهي»; the dashboard need-card and the contract filter follow the same frozen date.
- Fix: the same `VTODAY()` as C1 at these four sites (the implementer listed this under concerns but left it).

**I2. «تقرير المورد» and the fifth KPI show the prototype's accounts sheet for real makers.**
- `28-app.js:61-67` `openVendorReport` takes `seed.balance` / `seed.transport` from `vendorsNow()` (block 03's `IB_SEED.vendors`, keyed by the real store names: e.g. `Bian eg` balance −12,000 with 12,000 deposits; `Art Craft` 5 completed orders / 9,579) and prints «الرصيد من شيت Balances_Payouts»; probe P4b confirms the line in the popup. The button sits in the accounts tab next to tiles that say «رصيده عندنا 0.00» and «العربون —» (decision 5) — two contradictory balances in one drawer. `:1564` the page KPI «مواصلات المبتكرين» reads the transport seed («من البداية»).
- Fix (within decisions 4/5): `openVendorReport` takes `IBVendors.stats()[v.id]` (`balance`, transport «—») and the source line «الأوردرات المكتملة من 1 أكتوبر…», or the button gets the same «من مرحلة 4» treatment; the KPI tile → «—» «من مرحلة 4».

**I3. A duplicate effective date (23505) is reported as a network failure.**
- `app/js/adapter/vendors.js:169` `reasonOf` maps 23505 → `network` → «الشبكة مش متاحة — التغيير ما اتحفظش، جرّب تاني» (retrying can never work; the mock emulates 23505, the e2e never sends a duplicate). Fix: `e.code === '23505' → 'duplicate'`, `MESSAGES.duplicate = 'فيه نسبة متسجلة بنفس تاريخ السريان — اختار تاريخ تاني'`; `setRate` :233 should also not replace a same-date row locally (`filter((x) => x.since !== since)`), since the server never will.

### Minor
- **M1.** `contractUrl` (vendors.js:278-283) for a member without the key — «عرض / تحميل» is visible to ops — answers `network` → «الشبكة مش متاحة — التغيير ما اتحفظش» on a read action (e2e 11 asserts that text). Fix: `if (!canBank()) return fail('forbidden')` first (no request, «مش من صلاحياتك»).
- **M2.** `create()` (vendors.js:304-305) only checks `canEdit()` (≠ N), so ops' «إضافة مبتكر» is enabled, the insert is sent and refused (deviation 7). Acceptable for the edit buttons (Review Focus 3 needs them), but the insert rule is `admin or vendors.edit = F`: add `if (!(isAdmin() || perm('vendors.edit') === 'F')) throw noPerm()` so the form says it without a round trip; same one-liner for `update()` when the patch is `status` and `!canToggle()`.
- **M3.** `IBDirectory.perm` ignores 0008's aal rule (`twofa && aal ≠ aal2 → 'N'`); the mock's `hasPerm` applies it. No divergence today because the TOTP gate precedes every page, but a stale aal1 session would show F/P buttons the server refuses. Fix: `if (meRow.twofa && (session aal) !== 'aal2') return 'N'`.
- **M4.** Decision 5's «من 1 أكتوبر» is a label, not a rule: `stats()` has no date cutoff; it holds only because woo-core `START_DATE = '2026-10-01'` and IBOrders' 12-month window (probe P9: a completed order placed 400 days ago is simply not loaded). When phase 4 imports older orders the number drifts. Either filter `o.date >= '2026-10-01'` in `stats()` or document the dependency.
- **M5.** Vendor timeline under 0006's RLS: members without `settings.view` (accounts, viewer) see only their own rows — probe P7: ops' phone change is invisible to accounts, visible to admin. Decision 10 reads as "the vendor's history"; for those roles it is "my rows on this vendor". Plan-level (Task A: a policy on `entity = 'vendor'` with `vendors.view`, or accept and say so in the drawer).
- **M6.** Mock ≠ migration, none hides a live failure: (a) guard messages differ in wording (mock :429 «…name, category, aliases or terms» vs 0011 «…name, legal name, category, aliases, lead days, deposit policy or joining date») and `vendors.spec.mjs:262` asserts the mock's text; (b) the mock enforces the key layout `<uuid>/<13 digits>-<safe>` + a known maker (:508, 400 `InvalidKey`) — the live policies only check `bucket_id` and the key, so e2e 10's "a key outside the layout is refused by the server" is a guarantee the live project does not give (Review Focus 4 expects it: a Task A gap to report upward); (c) `vendor_bank` PATCH without F: mock 42501 (:399), live 0 rows silently — reachable only by a tampered client; (d) storage sign without F → mock 400 `not_found` (:499): plausible for Storage, unverified live.
- **M7.** `ib:vendors` → `renderVendors(true)` (28-app.js:1476) runs `U.closePopover()` on every reload-ready with no open-menu guard (the `ib:notify` path has one): a «المزيد» menu or the filter popover opened in the gap between a write and its reload closes.
- **M8.** Block 26 import (decision 12, out of scope, flagged): `vstore.create` now returns a promise, so `done.created` holds no ids (undo cannot remove created makers) and a refused create inside the `apply` loop is an unhandled rejection. Record for phase 4.
- **M9.** `tests/e2e/vendors.spec.mjs:122/:174` comments present the fixed date as "today" (see C1).

## Deviations (implementer's list) — judgement
1. `IBActivity.log(action, detail, meta)` — correct and necessary; RPC signature intact. Accept.
2. Decision 7 in the adapter (orders reload after the server took the name) — correct (avoids re-reading before the PATCH lands). Accept.
3. `create()` asynchronous — necessary (the id is the server's); the block-26 cost is acceptable under decision 12 but must stay recorded (M8). Accept.
4. The File on `f.file` — necessary for decision 10. Accept.
5. Extra reasons `in_use` / `too_large` / `bad_type` — fine; add `duplicate` (I3).
6. `ratesVisible` = read not refused **and** `canRate()` — the right reading (the literal rule would hide the first-rate field from the admin on an empty table). Accept.
7. `canEdit() = edit ≠ N` — required by Review Focus 3 for the edit buttons; the add-button consequence is M2. Accept.
8. Reveal logged once per field per drawer open (reset by `loadEvents`) — reasonable given the prototype re-calls `reveal` on every draw; hide→show again within one open is not a second event, acceptable. Accept.
9. Mock with-check admits `sensitive.vendor_bank = F` — matches the amended decision 8 and 0011. Accept.
10. Viewer activated in the spec's own install — mock-only, fine. Accept.
11. Display name in `new_value` on create/remove — a store name, not PII. Accept.
12. `single` in the shared stub — fine. Accept.
Shared-scratchpad note: the eight commit subjects are intact; no code impact.

## Verdict
**Needs fixes.** The adapter, the mock and the permission model are sound and the whole suite is green, but the vendors page still runs its clock on the prototype's fixed 20 Oct: the agreement date written to `vendor_rates` is wrong by default and the second change fails with a misleading message (C1 + I3), the «آخر أوردر» dates and contract statuses drift (I1), and «تقرير المورد» shows the seed sheet's balances for real makers (I2). All four are small, local changes in the vendors section of block 28 / `reasonOf`, plus a written amendment and the two spec assertions. M1–M3 are one-liners worth taking in the same pass.
