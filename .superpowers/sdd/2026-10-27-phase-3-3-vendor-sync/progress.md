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
- **Owner's answers (27 Oct):** the acceptance test store on staging is «Art Craft»; a name the team types for one of the six unnamed stores is pushed to the site (only the `#<id>` placeholder is never pushed). Task A (Fable, high) started on worktree p33-a from 350012a.
- **Task A** (Fable, high, worktree, alone): DONE_WITH_CONCERNS → `p33-a-report.md`; 5 commits cherry-picked (728f501…9ac32f1). Unit 230, Deno 91, deno:check ok, local db:test 15 files ok. The automated security review's finding (social links not https-checked) was sent to the implementer and fixed (7e112b4). **Ruling on its concern (sync rows with `actor` null):** `activity_log_select` (0006) shows a member their own rows, and everything to `settings.view <> N` — the drawer's log is already admin-wide and own-rows for others; the sync rows follow the same rule. Later: a policy branch for `entity = 'vendor'` rows under `vendors.view` (needs the owner's call on who sees the team's maker edits).
- **Task B** (Fable, high, worktree, after A): DONE_WITH_CONCERNS → `p33-b-report.md`; 5 commits cherry-picked (bda1f46…f3c6deb → 3ad57c1…). On the merged branch: unit 243, split 5, e2e 132. The automated security review's finding (a member-logged `vendor.sync` row rendered as the site's) was sent to the implementer and fixed (18c30fd).
- **Controller fixes before the review (in-session):** (1) B's concern 1 — `push_vendor` admitted `vendors.edit = F` only, so ops' contact edits never reached the site: the function, the adapter (`canPush(fields)`), the mock and the tests now admit `P` for the contact fields alone (phone, email, contact_name, address_parts, social — the guard's own contact rule); name / status / the rates still need F (+ commission). Plan decision 4 (b) amended. (2) B's concern 2 — `0014` now narrows `activity_log_insert` with `action not like 'vendor.sync%'` (the server's rows alone; service_role bypasses RLS), covered in `rls_vendor_sync.sql`; plan decision 8 amended.
- **Review** (Fable, high, one reviewer for A + B) started on worktree p33-review from 185215e. Staging «before» checks (read-only, 27 Oct): tables absent, 0 new columns, 55 stores / 0 inactive / 6 placeholders, 2 vendor_rates rows, 54 without phone, 55 without e-mail; Art Craft = store 2025.
- **Review verdict:** approve with fixes (no Critical). Important: I-1 (non-502 push failures not marked pending though the toast promises a retry), I-2 (a future-dated rate pushed as current / dropped as «same»; UTC vs Cairo "today"), I-3 (a deterministic Dokan 4xx on a pending field retried every 15 min for ever). Minors recorded in the plan's Later list. Review file: `review.md` (cherry-picked e76133b).
- **Fixes in-session (no agents), plan decision 11:** `0014` gains the RPC `vendor_push_pending` (security definer, the push rule; RLS cases added to `rls_vendor_sync.sql` — db:test 16 files ok); `woo-write.js`: `cairoDate`, `retryablePush`, `effectiveRates().future`, held rate fields in `pushStoreFields` / `applyPushResult`, the sync loop keeps future fields pending and unpends final refusals (`skipped`/`refused` log + `vendor.sync.refused` activity; `push_refused` / `push_held` counters); `woo-sync/index.ts`: `push_vendor` → 502 `{ pending }`, `skipped/future`, `held` in the ok answer; adapter: the RPC on any failure that never reached the site, `woo_refused`, messages `push_lost` / `push_refused`, the event text «الموقع رفض التعديل في: …»; block 28: the three notes (lock run); mock: the RPC, `wooRefuses`, `functionsDown`; tests: Deno 94, unit 243, split 5, e2e vendors specs 28 (one new). Decision kept: the `woo_sync_log.result` check constraint stays (no drop) — refusals are `skipped` with `detail.reason = 'refused'`.
