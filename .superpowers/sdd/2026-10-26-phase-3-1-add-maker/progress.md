# SDD ledger — plan: docs/superpowers/plans/2026-10-26-phase-3-1-add-maker.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (§4.2 sensitive columns rule; §4.3 Dokan read-only; §4.6 security). Carried musts: phase-3 ledger (Later list), the owner's standing rules (no secrets / PII in chat, tests or logs; migrations without delete/truncate — one written `drop constraint` exception in decision 6; blocks edited by written decision + lock; Dokan read-only; every subagent on Fable).
Branch: main-gha10e (cloud session); `main` after the reviewed live sequence.
Owner's request (chat, 26 Oct, with the prototype `Prototype file/2026-10-26-add-maker.html`): build the new «إضافة مبتكر» popup; fields that do not exist in Dokan are stored in the system only, nothing goes to the website; makers already on Dokan link as before.
Cost reading at the start of the phase: $576.11 (get_session, end of phase 3's ledger entry).

## Facts gathered before the plan (controller)
- The prototype's domain layer adds a portal-login simulation (hash / vault / authenticate) and a brands model; the popup itself uses only validateLogin / validateBank / passwordIssues / genPassword / suggestUsername and the new status `leave`. Brands are not in the request → question 1 of the plan.
- UI kit diff vs block 10: TextInput `type/autocomplete/dir/trail`, VendorStatus `leave`, `floatOver` for popovers (owner 26 Oct), html2canvas CDN (ours stays vendored). Icons eye/eyeoff/sparkle/copy exist.
- CSS additions: `.form-sec`, `.pw-acts`, `.pw-rules`, `.pw-cell`, `.pw-val`, `.floating[data-dir=up]`.
- Live: `vendors.status` check is ('active','inactive'); Vault in use since 0008 with a local-Postgres guard; `activity_log.actor uuid`.
- Phase 3's three SQL steps (rls_vendors live, backfill re-run, vendors-run verification) still wait on the owner's approval of SQL execution from the session.

## Pre-flight conflict scan
| Pair | Produces vs consumes | Finding |
|---|---|---|
| A ↔ B | `vendor_logins` columns, the two RPC names and error codes, the `leave` status | Written verbatim in decisions 3, 4, 6; B's mock follows the plan. |
| A ↔ 0011 guard | `vendors.status` gains `leave`; `vendors_guard_update` rule 1 (toggle) unchanged | A only replaces the check constraint. |
| B ↔ block 29 / orders | vendor status `leave` reaches `vendorOf` / waybill forms through `vstore` | Block 29 shows the name only; no status logic there. |
| B ↔ existing e2e | `floatOver` changes every popover's placement | The whole suite must stay green (Review Focus 8). |
| B ↔ phase-3 fix wave | `VTODAY()`, duplicate rate, canLogin alongside canEdit/canBank/… | B builds on 900cc18. |

Rulings: the plan's decisions 1–13; the written `drop constraint` exception (decision 6); the Vault password store follows the owner's own prototype comment.

## Progress (controller)
- **Task A** (Fable, worktree): DONE_WITH_CONCERNS → `p31-a-report.md`; 4 commits cherry-picked (43da0ae…fadb057). Its contract notes went to B: no PostgREST upsert on `vendor_logins` (insert-or-PATCH), `email` not null, P0002 without a login row, a 128-char password cap.
- **Review A** (Fable) → `review-a.md`: no Critical; I1 (the live test counted every maker's activity rows — scoped to its three makers), I2 (the real `vault.update_secret` path never ran — the runbook's "before" block now checks postgres' execute on both Vault functions; checked live 26 Oct: true / true), M2 (NBSP), M4 (the RPCs also need `vendors.view <> N`) → 60210fd; M7 (`created_by` = the member's name) → B (adeac0e). M1 (orphan Vault secrets after a cascade delete), M5 (the client may move active → invited), M6, M11 (service_role gets 42501 from the RPCs: a future portal function needs a member JWT or a written branch) → Later.
- **Security review (automated, CWE-338):** the prototype's `genPassword` on `Math.random` → decision 7 amended (CSPRNG + rejection sampling + Fisher–Yates), B implemented it (bec3208).
- **Task B** (Fable, worktree): DONE_WITH_CONCERNS → `p31-b-report.md`; 9 commits cherry-picked (87a0f4c…d6562e6 → adeac0e). Merged branch: unit 205, split 5, e2e 118; CI green through 60210fd.
- **Live pre-checks (read-only, 26 Oct 17:30Z):** `vendors_status_check` = active/inactive, `vendor_logins` absent, 0 `vendor-login:%` secrets, 55 makers all active, postgres may call `vault.create_secret` / `vault.update_secret`.
- **Side finding while verifying phase 3's vendors run:** the v8 `saveVendors` partial upsert failed on every store (see phase 3's ledger) → fixed in 7bd0589, functions v9, verified at 17:45Z.
