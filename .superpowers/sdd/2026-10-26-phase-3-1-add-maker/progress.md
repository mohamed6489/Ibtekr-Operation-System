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
