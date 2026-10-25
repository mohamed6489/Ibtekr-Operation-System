# SDD ledger — plan: docs/superpowers/plans/2026-10-25-phase-2-orders.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (read; binding) + carried musts from the phase-0/phase-1 ledgers. Dokan Lite 5.1.2 / Pro 5.0.9 source read in the scratchpad (not in the repo): sub-orders are WC orders with parent_id, created_via 'dokan', meta _dokan_vendor_id; parent status cascades to sub-orders through a transition whitelist; all-subs-completed completes the parent; commission in _dokan_commission_rate/_type/_dokan_admin_fee/_dokan_additional_fee; dokan/v1/orders returns `earning`; no Dokan webhook topics (WC's order.* fire for sub-orders too).
Branch: main-gha10e (cloud session), fast-forwarded to main after each reviewed task (owner's standing permission). Staging: https://stage.ibtekr.club (full copy of the live site; owner confirms the WhatsApp plugin is off there). Secrets STAGING_WOO_URL/CK/CS are GitHub Secrets (owner).

## Pre-flight conflict scan (2026-10-25)

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T2 ↔ T3 | `status_map` rows `{system_status, woo_status, direction}`; `order_items.status` check list | `incomingStatus/outgoingWooStatus` read exactly those columns; the 11 sub-statuses + '' come from block 29 `SS`+`RET`. Consistent. |
| T2 ↔ T4 | Upsert keys: `orders(id)`, `order_items(id)`, `sub_orders(woo_order_id)` + `unique(order_id, vendor_id)`; `products(id)`; `vendors(woo_vendor_id)` | Single-vendor orders have no Dokan sub-order → no `sub_orders` row; T5 `toScreen` falls back to `orders.woo_status`. Removed Woo lines are flagged (`raw.removed`), never deleted (no-DELETE rule). Consistent. |
| T2 ↔ T5 | `orders_v` columns; PATCH on `orders`/`order_items`; trigger column rules vs `patchOrder` fields (note/city/addr/dep) | Adapter reads the view, writes the tables; `deposit` under `orders.edit`, statuses under `orders.status`. Consistent. |
| T4 ↔ T7 | `public.sync_secret_matches(text)` defined in T7, called by `woo-sync` (T4) | T4 tests inject the RPC; the live function is deployed in T9 after T7. Consistent (runtime dependency only). |
| T4 ↔ T9 | Both functions `verify_jwt: false`; functions URL `…/functions/v1/{name}`; secrets names `WOO_URL/WOO_CK/WOO_CS/WOO_WEBHOOK_SECRET` | Same names in T4 env reads, T7 cron body and T9 runbook. Consistent. |
| T5 ↔ T6 | `OrdersApp.hydrate({orders, vendors, images, statuses})`, `applyOrder(o)`; `window.IBOrdersStore.{setOrderStatus,setConfirm,patchOrder,setItemStatus,setWaybill,setPulled,syncNow}` | Same names in both tasks; screen shape spelled out once in the plan header. Consistent. |
| T5 ↔ existing e2e | `IBDirectory.load()` now also loads orders at sign-in | T5 extends the mock with the orders tables first (same pattern as phase 1 Task 3). Consistent. |
| T6 ↔ dashboard e2e | Dashboard KPIs/cards read `OrdersApp.query` → now the 3 mock orders | Assertions in dashboard.spec do not depend on order counts; T6 Step 4 runs the full suite. Watch item. |
| T7 ↔ 0001 / phase-0 tests | `has_perm`/`is_admin` redefined with `create or replace` (aal2 rule) | Signatures and grants unchanged; `rls_identity` fixtures have `twofa=false`. Consistent. |
| T6 ↔ T8 | Both edit blocks (29/11 vs 10/17/28/25) and the lock | Sequential; `EDITED` ends as 10,11,14,17,18,21,25,28,29. Consistent. |
| T2 self | trigger guards vs tests | Guards apply to `current_user in ('anon','authenticated')` only (phase-0 pattern), so the "postgres updates woo_status → source 'woo'" case holds. `status_map` reseed by update+insert (rename `مرتجع`→`استرجاع` before any order exists). Consistent. |
| T1 self | probe output vs PII rule | `redact()` tested without network; the workflow only prints JSON lines. Consistent. |
| Global "no DELETE/DROP" | T2/T7 migrations and all SQL tests | update/insert/on-conflict only; guarded `create extension`. Consistent. |

Ruling: all implementer/reviewer subagents run on `opus` — why: the owner requires the strongest model (phase-0/1 ruling) — cost if wrong: token spend.
Ruling: workspace text artifacts committed with `git add -f`, review packages ignored — why: recovery map (phase-0 ruling) — cost if wrong: small files in history.
Ruling: execution starts now — why: the owner answered «كله تمام» to «تحب أبدأ؟» and the plan is pushed for reading/stopping — cost if wrong: rework of what they would change.
Ruling: Task 1 (staging probe) runs first and its findings may amend the status_map seed and meta keys of T2/T3 before those tasks are dispatched; amendments are recorded here as rulings — why: the prototype's map ('shipping', 'ready-for-shipping', 'تم RTC' with no slug) must match the real site — cost if wrong: one more migration later.
Ruling (owner question «الـ vendors هيزيدوا»): vendors are a live mirror of Dokan stores — `woo-sync` upserts every store on each run (new → insert; disabled → status 'inactive', never deleted); `mapOrder`/`mapSubOrder` return `unknownVendorIds` and `woo-webhook` fetches `dokan/v1/stores/{id}` for each and upserts the vendor BEFORE linking the order; sync never touches owner-maintained columns (aliases, commission_pct, phase-3 contracts) — why: new makers join continuously and their first order must not land vendor-less — cost if wrong: one extra Dokan request per new vendor. Carried into the T3/T4 dispatches.
Task 1: implementer DONE_WITH_CONCERNS, commit 72a89c1 (base 1bffead). 11 new tests, npm test 70/70. Deviations: webhook delivery_url printed as origin+path (query/userinfo redacted); redact() broader than the brief. Live-run concerns (resolved by running): Dokan stores auth, Authorization header stripping, sub-orders hidden from the list.

### Task 1 — review outcome (controller)
- Review 1 (72a89c1): spec-compliant; 1 Important (2xx non-JSON body echoed raw → bypassed redact) + security scan (delivery_url path may carry a token) + 3 minors → fixed in 6b0e418.
- Review 2 (6b0e418): all closed, no regressions; 1 Important (own ck/cs/base64/host not scrubbed from error text) + 4 cheap minors → fixed in 23bdbd1. Controller hostile-body check: a 500 page echoing the Basic header, keys, host, ASCII+Arabic phones, an email and a <script> block printed only `<redacted>` tokens.
- Deferred (accepted consciously): the ≤80-char scrubbed `prefix` of a non-JSON 2xx body is raw text (tag-stripped, scrubbed, own-values masked); junk-recovery heuristic accepts any parseable slice; date/IP false positives of the scrub; camelCase credential keys; HTML/percent-encoded emails; maskHost best-effort on 3-label hosts such as `*.n8n.cloud`.
- Tests: tests/tools/woo-probe.test.mjs 19/19, npm test 78/78.
- Next: push both branches (the workflow must exist on `main` to be dispatchable), run `staging-probe.yml` from MCP, read the log, record the rulings below.
