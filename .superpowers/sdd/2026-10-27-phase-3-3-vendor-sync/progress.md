# SDD ledger — plan: docs/superpowers/plans/2026-10-27-phase-3-3-vendor-sync.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (§4.3 Dokan read-only — amended by the owner for store data, 27 Oct; §4.2 sensitive columns; §4.6 security). Carried musts: no secrets in chat/code, no PII in logs/fixtures, no delete/truncate, blocks by written decision + lock, sequential agents at effort high, staging first.
Branch: main-gha10e; `main` after the reviewed live (staging) sequence.
Owner's requests (27 Oct): full vendor data from the website, two-way; our rate = Dokan's vendor commission; category commissions; payment data read-only; last-write-wins; 15-minute comparison; e-mails and Bosta off on staging; `WOO_PUSH_ENABLED = 1` set by the owner on staging.
Cost reading at the start: see the phase-3.2 ledger close ($762.64) — this phase starts after the probes (~$10 of probing and docs).

## Facts gathered before the plan (controller)
- `woo-sync` v11/v15 `probe_store`: with `WOO_WP_USER` / `WOO_WP_APP_PASSWORD` the store payload carries 37 fields (listed in the plan's facts); commission types seen: `fixed` (store 2376) and `category_based` (store 44, one category item); address six keys; social eight keys; payment bank/paypal (not stored).
- The owner first saved the secrets under `DOKAN_ADMIN_*` (my first message's names) — renamed; `auth: true` since.
- Dokan returns no modification time for a store → the conflict rule became "push at save time; the pull compares with a snapshot; both changed → the site wins, logged".

## Pre-flight conflict scan
| Pair | Produces vs consumes | Finding |
|---|---|---|
| A ↔ B | 0014 columns, `push_vendor` body / answers, `vendor_category_rates`, `woo_categories` | Decisions 2, 4, 5, 7 name them; A's report carries the contract. |
| A ↔ phase 3 decision 2 | existing stores: raw only → snapshot comparison | Written in decision 4 (a); the first run backfills empty fields only, never writes the site. |
| A ↔ 0011 guard | `vendors_guard_update` widened for the new columns | Task A edits the guard in 0014 (create or replace). |
| B ↔ block 28 | contact popup, agreement section, drawer header | Decision 6, then lock. |

Rulings: the plan's decisions 1–10.

## Progress (controller)
