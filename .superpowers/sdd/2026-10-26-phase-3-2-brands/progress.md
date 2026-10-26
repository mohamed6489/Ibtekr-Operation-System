# SDD ledger — plan: docs/superpowers/plans/2026-10-26-phase-3-2-brands.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (§4.2 sensitive columns; §4.3 Dokan read-only; §4.6 security). Carried musts: the phase-3 / 3.1 Later lists; the owner's standing rules (no secrets in chat or code, no delete/truncate, blocks by written decision + lock, Dokan read-only, no PII in fixtures).
Branch: main-gha10e (cloud session); `main` after the reviewed live sequence.
Owner's request (chat, 26 Oct evening): «ابدأ مرحلة 3.2 البراندات» + «استبدل fable extra ب high» (agents at effort high) + «اشتغل التاسكات على التوالي مش التوازي» + «حاول تقتصد في استخدام fable».
Cost reading at the start of the phase: $718.60 (get_session; phase 3.1 closed at $663.83 — the link withdrawal and the process notes in between).

## Facts gathered before the plan (controller)
- The prototype carries a brands *domain* only (store functions; no screen); CSS `.brands-table` / `.brand-cell` is there. `create` auto-adds a brand named after the maker.
- Live (read-only, 20:40Z): 56 vendors (55 stores + 1 hand-added), distinct names, joined_at set on all; 88 sub_orders from 18 stores, no orphan sub.
- Orders carry the store's vendor_id; `IBVendors.stats()` matches sub-orders by store name; `orders.js` maps vendor_id → name (the id is not on the sub shape yet).

## Pre-flight conflict scan
| Pair | Produces vs consumes | Finding |
|---|---|---|
| A ↔ B | tables / columns / guards / the two SQL functions / error codes | Written verbatim in decision 2; B's mock follows the plan. |
| A trigger ↔ woo-sync | `vendors_brand_after_insert` fires on the sync's inserts (service_role) | No function change; the trigger is definer-owned so grants do not matter. |
| B ↔ orders.js | `vendorId` added to the sub shape | Block 29 ignores unknown fields; block 28 waybills still use the store name. |
| B ↔ stats | attribution by `storeOwnerAt` | Without a transfer the numbers are unchanged (a test asserts it). |

Rulings: the plan's decisions 1–10. Sequential agents at effort high (owner).

## Progress (controller)
- **Automated security review on 0013 (while Task A was writing it):** (1) backdated transfers redirect past payouts — accepted by design (the owner's definition: a brand moves «من تاريخ معيّن»; rows are append-only with `created_at` / `set_by`, two activity rows with `actor = auth.uid()`, and the same permission as rates and bank). A lock on closed payout periods is phase 4's (Later). (2) `created_by` / `set_by` in the insert grants — the display-name pattern of `vendor_rates.set_by` / `vendor_bank.updated_by` / `vendor_logins.created_by` (phase 3.1 review A); the audit identity is `activity_log.actor`, server-set. No change.
