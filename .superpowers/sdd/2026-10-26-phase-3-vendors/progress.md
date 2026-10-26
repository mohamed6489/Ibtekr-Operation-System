# SDD ledger — plan: docs/superpowers/plans/2026-10-26-phase-3-vendors.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (§4.2 vendors tables + sensitive columns rule + rate-with-effective-date rule; §4.3 Dokan read-only; §5 row 3). Carried musts: phase-2 ledger («the sync rewrites status on every run → team-owned after insert», «Sticky maker»), phase-2.2 Later list; the owner's standing rules (no secrets / PII in chat, tests or logs; migrations without drop/delete; blocks edited by written decision + lock; Dokan read-only; every subagent on Fable).
Branch: main-gha10e (cloud session), fast-forwarded to main after the reviewed live sequence (owner's standing permission).
Owner's note at start (chat, 26 Oct): start phase 3; they will redesign «إضافة مبتكر جديد» themselves after the phase — the add-vendor modal is wired as it is, not redesigned.
Cost reading at the start of the phase: $504.61 (get_session).

## Facts gathered before the plan (controller, live project + repo)
- `vendors` live: 55 rows all `active`, phone/email null everywhere, `commission_pct` null, raw = {id, store_name, shop_url, registered, featured, trusted, rating}; 20 vendors referenced by `order_items`, 18 by `sub_orders`.
- `sub_orders.dokan_earning` / `commission` null on all 88 rows; `order_items.raw.meta_data` carries `_dokan_commission_rate` on all 210 lines (35×115, 40×72, 30×7, 50×6, 45×5, 25×3, 33, 28), `_dokan_commission_type` fixed×163 / category_based×47, `_dokan_commission_source` vendor×209 / global×1, `_dokan_additional_fee` '' or 0.
- Role matrix (0003): vendors.view F admin/ops/accounts/vendors_followup, P cs/viewer; vendors.edit F admin/vendors_followup, P ops; vendors.toggle F admin only; sensitive.vendor_bank F admin/accounts; sensitive.commission F admin only.
- Block 06's role-name checks (`'مدير النظام'`, `'الحسابات'`) do not match the roles table names («أدمن», «حسابات») → permissions come from the adapter (`IBDirectory.perm`), block 06 untouched.
- No Storage bucket exists; block 28 runs vendors as a fixed admin `ME`; `log.append` reaches `IBActivity` through `K.logEvent` by prefix.

## Pre-flight conflict scan (2026-10-26)
| Pair | Produces vs consumes | Finding |
|---|---|---|
| A ↔ B | table/column names (`vendors.*` new columns, `vendor_rates`, `vendor_bank`, `order_items.commission_rate/fee`), bucket `vendor-contracts`, error codes (42501 guard, 23503 delete with orders) | Both written in the plan verbatim; B's mock emulates the plan, not A's file. Watch: PostgREST column-list grants → the adapter never selects `*` on `vendors`. |
| A ↔ live sync | `saveVendors` existing rows get `raw` only | `resolveVendors` already `selectIn`s by woo_vendor_id; `pullVendors` writes the full list → it must split too. Covered in A's brief. |
| A ↔ 0007 tests | `rls_orders.sql` asserts vendors readable by the sync and members | A updates the test if the select grant becomes a column list. |
| B ↔ block 29 | sub shape gains `rate`/`fee` from `IBOrders.toScreen` | Block 29 ignores unknown fields; block 29 is not edited. |
| B ↔ dashboard/orders e2e | `IBDirectory.load` also loads vendors; `roles` select adds `permissions` | The mock serves `roles.permissions` already (COLUMNS has it); orders/dashboard specs don't count vendor rows. Watch item: full suite in B. |
| B ↔ block 26 import/export | uses `vstore` API | Same API kept; async writes mean the import's `undo` may race — out of scope, noted for phase 4's import work. |

Rulings: see the plan's «القرارات المكتوبة» 1–12 (each with why / cost if wrong). Added here: the share of a line is the website's own commission on that line (orders.view), while the agreement (rate history, the list column) stays behind sensitive.commission — why: accounts must know what to pay without seeing the agreement; cost: a member with orders.view can infer a maker's rate from one order (accepted, those roles run orders/accounts anyway).
