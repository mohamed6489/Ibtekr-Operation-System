# Task B report — phase 3 front end: `IBVendors`, block 28 on real vendors, mock, e2e

**Status: DONE_WITH_CONCERNS** (everything in the brief is implemented and green; the concerns below are interpretation
choices and prototype leftovers the reviewer should confirm, none blocks the live sequence).

Branch `worktree-agent-a059aa1d918316c25` (cut from `main-gha10e` at a90f847), worktree
`/home/user/Ibtekr-Operation-System/.claude/worktrees/agent-a059aa1d918316c25`. Nothing pushed; `supabase/` untouched; no
live-project call.

## Commits
| hash | subject |
|---|---|
| 6b4275c | feat(adapter): IBVendors — the vendors registry on real data (phase 3 Task B) |
| b843a5a | feat(adapter): IBDirectory.perm, order lines' commission rate/fee, vendor.* activity events |
| 0d5640b | feat(vendors): block 28 — the vendors page on IBVendors (the 12 decisions of Task B) + lock |
| 983c55a | test(e2e): the mock emulates 0011 — vendors columns, vendor_rates, vendor_bank, the contracts bucket |
| 599f77b | fix(adapter): a vendor.reveal is logged once per drawer open — the events refresh after a write no longer resets it |
| 6a6dd30 | test(e2e): vendors.spec — the vendors page on the mock (19 cases) |
| (this) | docs(sdd): Task B report |

## Test counts
- `npm test`: 186 / 186 (new: `tests/adapter/vendors.test.mjs` 20, `tests/adapter/directory.test.mjs` 3, +1 in activity, orders updated).
- `node --test tests/split.test.mjs`: 5 / 5 (block 28 re-locked; `EDITED` unchanged — 28 was already in it).
- `npm run e2e` (whole suite): 108 / 108, no skips (vendors.spec 19; auth / twofa / login / dashboard / orders all still green). Port 4173 free before and after.
- Not run here: `npm run semgrep` (not in the brief's list; no new dependency, no secret, no `innerHTML`).

## What changed, per file
- `app/js/adapter/vendors.js` (new) — `window.IBVendors`: `load/state/data/clear`; `store` = the prototype's vstore API (`get, all, events, update, setRate, setBank, reveal, setContract, findByName, remove, restoreMoney, create`) + `canEdit/canBank/canToggle/canRate/actor`; `loadEvents(id)/events(id)`; `setContract`; `contractUrl(id)` (signed URL, 60 s); `stats()`; pure exports `toVendor, lineShare, rateAt, safeName, norm`; `MESSAGES` (the Arabic reasons the page shows). Reads name their columns (never `*`, never `commission_pct`); vendors paged by 1000, ordered by name. Writes: the insert with `.select('id').single()`, every update without `.select()` and with the changed columns only (the guard checks per column), the delete with `.select('id')` so a 0-row delete (not admin on the server) reads as forbidden. Write-through: local change → `ib:vendors {id, changed}` → server → on failure the old row back + `ib:vendors {id, reason}` (`forbidden` on 42501/403, `in_use` on 23503, `too_large`/`bad_type` on Storage 413/415, else `network`); on success the `vendor.*` log (entity `vendor`, entity_id = uuid, `new_value` without PII: field names, a status, `40% من 2026-10-20`, the bank method, `PDF · 2.0 ميجا`; the display name only on create/remove) and a reload (the server's row is the truth: timestamps, the rate trigger). Rates: `rateHistory` ascending by `since`, `rate`/`rateSince` = the row effective today (the earliest when none has started, the prototype's `rateAt`); `ratesVisible` = the read was not refused **and** `canRate()`. Bank: null for anyone without the row. Contract: `vendors.contract` jsonb ↔ `{fileName, size, expires, uploadedBy, uploadedAt, path}`. `stats()` per vendor: `orders` (block 29's query rows + `sales`/`share` for that maker), `open`, `late`, `lastAge`, `sales`, `earned`, `ibtekrShare`, `pending`, `pendingSales`, `noRate`, `openingBalance`, `balance = opening + earned`, `deposits: 0`, `transport: {total:0,trips:0,last:null}`, `tickets: []`, `seed: null`, `byStatus {c,p,x: [n, sales, share]}`. Line share = `total − (total × rate/100 + fee)`; a line without a rate uses our rate on the order date when visible, else the full total and `noRate`.
- `app/js/adapter/directory.js` — `perm(key)` (active admin → F; `custom_perms[key]` when present, even N; else the role's `permissions[key]`; else N); `roles (id, name, permissions)` and `profiles … custom_perms` read; `IBVendors.load()` with the session, `clear()` on sign-out.
- `app/js/adapter/orders.js` — item select + `commission_rate, commission_fee`; each sub gets `rate`/`fee` (null when absent).
- `app/js/adapter/activity.js` — `LOGGED_PREFIXES` + `'vendor.'`; `log(action, detail, meta)` with optional `{entity, entity_id}` (see deviations).
- `app/index.html` — loads `js/adapter/vendors.js` after `orders.js`.
- `app/js/blocks/28-app.js` — the 12 decisions (below); `tools/blocks.lock.json` regenerated.
- `tests/e2e/supabase-mock.mjs` — the vendors tables of 0011 as the plan writes them (see the commit message), the contracts bucket (upload / sign / signed GET without api key), `order_items.commission_rate/fee` (5001 35/0, 5002 40/10, the rest null), the role matrix keys of 0003, `log_activity` keeps `entity`/`entity_id`; the three vendors gain the team columns (rates for Art Craft 35 and Antikiano 40→45, a stored contract for Antikiano, a bank row with the fake IBAN for Bian eg); records `vendorWrites`, `uploads`, `signs`, `signed`, `objects`; flag `vendorsDown`.
- `tests/e2e/vendors.spec.mjs` (new, 19 cases) — the plan's list; `tests/adapter/vendors.test.mjs`, `tests/adapter/directory.test.mjs` (new); `tests/adapter/orders.test.mjs`, `tests/adapter/activity.test.mjs` updated; `tests/adapter/stub-supabase.mjs` gains `single` in its chainable ops.

## Block 28 — the 12 decisions, where
1. `const vstore = window.IBVendors ? window.IBVendors.store : VD.createStore()` (l. 1467); `seedVendors` and `vseedClock` removed with their calls; the `ib:vendors` listener (l. 1472: a reason → `vnote` «مش من صلاحياتك» …, then `renderVendors(true)` and the open drawer's `draw()`) and the `ib:notify` redraw (l. 1480, not while a menu / the filter is open).
2. `vstore.canEdit()` on «إضافة مبتكر» (l. 1556) and `editBtn` (l. 1651); `canBank()`/`canRate()` in `draw()` (l. 1720); the status option of «المزيد» only with `canToggle()`, «تغيير النسبة» only with `canRate()` (l. 1614); the terms form shows the rate + date fields and the warning only with `canRate()` (l. 1635), `save()` reads the rate only then and treats an empty field as «no change» (l. 1643); the agreement row says «—» without the permission, «لسه مفيش نسبة متسجلة» with it and no rate; the header «نسبة إبتكر —» and the list column «—» likewise; the rate history row only with `canRate()`.
3. Every `vstore.*` call passes `vstore.actor()` (l. 114–116, 194–198 import; 1596, 1598, 1616, 1646, 1658, 1664, 1729).
4. `vendorStats()` = `IBVendors.stats()` (l. 1485); the list cells «العربون» / «المواصلات» → «—» titled «من مرحلة 4», «تذاكر مفتوحة» → «—» «من مرحلة 7» (l. 1548), the header «مستحقاته (من 1 أكتوبر)»; the KPI notes and the page source say the money comes from the completed orders at the website's rate per line (opening / deposits from phase 4); the active-makers details show «—» for a hidden rate; «حصته» in the vendor-orders popup (l. 1677) and the drawer's orders table use the per-line share from the stats instead of `total × (1 − rate)` (which would be NaN with a hidden rate).
5. The accounts tab (l. 1766–): tiles «رصيده عندنا» (opening + earned, note on the opening), «حقه من المكتملة», «هيستحق بعد التنفيذ», «حصة إبتكر من المكتملة» (canRate only), «العربون» / «المواصلات» «—» «من مرحلة الحسابات»; a «N سطر بدون نسبة» note; «ملخص حسابه معانا» (sales, Ibtekr's share with `(X% دلوقتي)` only with canRate, earned, «—» rows, «مستحقاته (من 1 أكتوبر)» with له/عليه/متصفّي); «حسب حالة الأوردر» from `stats.byStatus` (the Ibtekr-share column only with canRate); «الحركات المالية» = one line «بتتسجل من مرحلة الحسابات»; «الحساب البنكي» as it was on `canBank()`.
6. «سجل النشاط»: `IBVendors.loadEvents(id).then(draw)` once per open (l. 1802), the section reads `vstore.events(id)` (l. 1738) with an empty state.
7. A rename reloads the orders — implemented in the adapter after the server took the name (deviation below), so the drawer's stats and the orders page see the new name; e2e «a rename reloads the orders».
8. `vendorOf` matches `#makers/<uuid>` (l. 303).
9. `openAddVendor` untouched except its submit (l. 1598): `vstore.create` is awaited (the id comes from the server), the reason shows in the form on failure.
10. `openContract` (l. 1728) → `IBVendors.contractUrl(id)` → `window.open(url, '_blank', 'noopener')`, the reason on failure; `onTemplate` toast as it was; the contract form also keeps the chosen File on `f.file` (l. 1662) — the upload needs it.
11. `vendorTasks`, `vendorDailies/Weeklies`, waybills: untouched.
12. Block 26's import/export: untouched, not tested (see concerns).

## Review Focus → tests
1. ops opens Bian eg → «مخفي», `vendor_bank` asked and answered `[]`, no page error; accounts reveals → one `vendor.reveal` (entity vendor) — e2e 6, 7; unit «reveal».
2. (Task A's sync.)
3. ops changes the phone → written; the name → 42501 → old name back + «مش من صلاحياتك»; admin toggles status and sets a dated rate — e2e 4, 5; unit «update refused», «setRate».
4. 2 MB PDF accepted at `<uuid>/<ms>-<safe>`; `.exe` / 11 MB / a key outside the layout refused by the mock (415/413/400); ops gets 403 on upload and nothing on sign — e2e 9, 10, 11; unit «setContract», «contractUrl».
5. HTML in a name, an alias and a note stays text (list, search, drawer, orders tab) — e2e 14 (`inert`).
6. 1000@35/0 → 650, @35/10 → 640, @40/10 → 590 (the coordinator's corrected numbers; the brief's «560» was a slip); a line without a rate → ours on the order date when visible, else full + «بدون نسبة»; a non-completed order is in «هيستحق بعد التنفيذ», not in the earned — unit «lineShare», «stats»; e2e 12 (admin and ops).
7. A maker added from the form shows after the reload, with its first rate; delete refused with orders («ماينفعش يتمسح — عليه أوردرات», restored), done without — e2e 17, 18; unit «remove», «create».
8. Rename → the orders page shows the new name after the reload, the drawer still finds its orders — e2e 13; unit «update validates … a rename reloads the orders».

## Deviations (each the smallest faithful alternative; please confirm)
1. **`IBActivity.log(action, detail, meta)`** — the plan lists only the prefix for activity.js, but it also asks the events to carry `entity: 'vendor', entity_id`; `log` did not take them, so an optional third argument fills the row's entity columns (unchanged for every other caller; tested).
2. **Decision 7 lives in the adapter**: `IBOrders.load()` runs after the server accepted the `name` patch. Calling it from block 28 right after `vstore.update` would re-read `vendors.name` before the PATCH landed (a race the write-through order makes certain).
3. **`create()` is asynchronous** (returns a promise of the vendor; rejects with the reason's message). A local-first create has no id to open the drawer on. `openAddVendor`'s submit awaits it (the only change to the form). Consequence for block 26 (decision 12, out of scope): the import's `vstore.create` now gets a promise, so `done.created` holds no ids and the import's undo cannot remove created makers (updates still undo); flagged for phase 4's import work.
4. **The contract form passes the File** (`f.file`) to `setContract` — without it there is nothing to upload; `setContract` without a file but with a stored contract only changes the expiry (the import's path).
5. **Extra failure reasons** beyond `forbidden`/`network`: `in_use` (23503, «ماينفعش يتمسح — عليه أوردرات»), `too_large` (413), `bad_type` (415) — the plan wants a clear message for a refused delete and the server-side size/type checks; `IBVendors.MESSAGES` holds the Arabic text and block 28 reads it.
6. **`ratesVisible`** = the `vendor_rates` read was not refused **and** `canRate()`. Read literally, «42501 or empty → not visible» would hide the rate field from an admin on an empty table (the live project has no rates yet) and nobody could ever set the first one; with this rule the admin sees «لسه مفيش نسبة متسجلة» and the field.
7. **`canEdit()` is `vendors.edit ≠ N`** (F or P): ops must see the «تعديل» buttons for the server to decide per column (Review Focus 3). Hence «إضافة مبتكر» is enabled for ops (P) and the insert is refused by the server with «مش من صلاحياتك» in the form (tested); a `canCreate` helper was not added to keep the store API as the plan lists it.
8. **Reveal logging**: once per field per drawer open (`loadEvents` resets it; a redraw while the field stays shown — the prototype re-calls `reveal` on every draw — is not a second event). First attempt logged twice because the events refresh after the write reset it; fixed in 599f77b.
9. **The mock's `vendors_update` with check** also admits `sensitive.vendor_bank = F` (not only admin / `vendors.edit ≠ N`), so accounts (`vendors.edit = N`) can write `contract` as decision 7 intends — the same interpretation Task A's commit message records; the reviewer should confirm both sides agree (otherwise the accounts contract upload fails live with 42501 and the page says so).
10. **Viewer in e2e**: `viewer.dev` is suspended in the mock (auth.spec relies on it), so vendors.spec activates M99 in its own install before signing in.
11. `new_value` carries the vendor's display name on `vendor.create` / `vendor.remove` (a store name; the row without it would be meaningless on the dashboard's «آخر نشاط»); never a phone or an IBAN (asserted).
12. `tests/adapter/stub-supabase.mjs`: `single` added to the chainable ops (shared stub; harmless).

## Concerns for the reviewer
- **Prototype leftovers inside the vendors page that the decisions did not cover**: `contractStatus` / `vendorTasks` / the «آخر أوردر» label / `fmtTime` use the prototype's fixed `TODAY` (2026-10-20), so «بينتهي خلال 30 يوم» and the contract alerts are judged against that date, not the clock; the fifth KPI tile «مواصلات المبتكرين» still reads the transport sheet seed (accounts domain, phase 4); «تقرير المورد», the statements and the weekly / daily reports keep `vendorsNow()` (the accounts seed) for balances; block 06's `orderCounts` does not know «استرجاع» / «فشل», so the orders tab's «قيد التنفيذ» tile counts them while `stats()` classifies them as cancelled (the accounts tab and the KPIs use `stats()`).
- A member without `sensitive.vendor_bank` still sees «عرض / تحميل» on a stored contract (ContractCard's `canManage` gates upload / replace only); the server hides the object, and the page then says «الشبكة مش متاحة — التغيير ما اتحفظش» (the Storage answer is 400 not_found, not 403). Cosmetic; a `canView` on the card would need a block change outside the decisions.
- The page re-renders on every `ib:vendors` and on `ib:notify` (orders load / Realtime burst, skipped while a menu is open); a redraw closes popovers — acceptable for a page this size, mentioned in case a reviewer sees a flicker.
- After every successful write the adapter reloads the three tables; two quick edits in a row may briefly show the first's reload before the second's lands. No data loss (the server is the truth), noted for completeness.
- The scratchpad directory is shared with the sibling (Task A) session: its commit-message files overwrote mine after my first two commits had been made (verified intact); later files were given a `taskb-` prefix.
- `package-lock.json`: `npm install` added an `engines` entry; reverted, not committed.

## Later (recorded)
- Block 26 import: `create` is asynchronous (undo of created makers), `restoreMoney` restores bank / contract metadata / a new dated rate best-effort — to be revisited with phase 4's import.
- A `canView` for the contract card; a vendors Realtime channel if the team ever edits concurrently; the fixed `TODAY` in the vendors section's contract-expiry and date labels.
