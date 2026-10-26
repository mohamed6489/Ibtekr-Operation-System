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
- **Review B** (Fable) → `review-b.md`: approve; I1 (the copied login promised a link to a temp-mode maker when the member cannot reveal), M1 (the mock's reveal without a row: null + a log row, as 0012), M2 (pwShown cleared on drawer close), M4 (the duplicate-name refusal names the maker) → 838d008; M3 (the temp password in the input's value attribute while the popup is open), M5 (mock nits), M6 (re-enable → invited; review A M5), M7, M8 (a vendors.edit = F member without the commission key types a rate that is skipped silently), M9 → Later.
- **Live:** `0012` applied 17:52Z (`20261026175216 vendor_logins`); post-checks matched the runbook (see §2.6). No function change. Pending the owner's approval of SQL writes from the session: `rls_vendor_logins` live (the first real exercise of the Vault path) and phase 3's `rls_vendors` live.
- **Live test:** `rls_vendor_logins.sql` ran live 17:58Z through execute_sql and passed (`ok`, rolled back) — the real Vault path (create_secret, update_secret, decrypted_secrets as postgres) and the activity rows verified. CI 172 / 173 green; full e2e 118 on the final branch. `main` fast-forwarded (both phases).
- **Deploy:** `main` at 2128fb7 → Deploy run 23 green (18:03Z): the front end of phases 3 and 3.1 is on Hostinger.
- **Cost:** start $576.11 → $663.83 at the close (≈ $87.70 for phase 3.1; ≈ $159.20 for phases 3 + 3.1 together since $504.61).
- **Owner's open questions (plan):** brands as a phase 3.2; the maker portal's shape (where the invite e-mail and the login live); a daily cap on password reveals.
- **RLS live workflow (19:12Z):** `.github/workflows/rls-live.yml` + `tools/rls-live.sh` run the live-safe files from the `SUPABASE_DB_URL` secret; run 4 passed `rls_vendors` and `rls_vendor_logins` on the live project. The path for every file the MCP tool holds from now on.
- **Amendment (owner, 26 Oct evening — «الغي ان ابعتله لينك يعمل باسورد بنفسه»): decision 5 withdrawn.** The link chips are gone from `loginFields`; «إضافة مبتكر» requires the temporary password (the field and the generator shown from the start, `pw_mode: 'temp'` always, the RPC right after the login insert); the drawer's «إضافة بيانات الدخول» for a maker without a row takes the password too through the new `IBVendors.addLogin(id, { username, email, password })` (the insert, then the RPC — a refused password leaves the row and is named in `missing`, as `create` does), and `setLogin` now patches an existing row only (`no_login` without one). Every «لينك التفعيل» text went (the e-mail's help: recovery from the maker portal); the drawer's password line says «باسورد مؤقت — لسه ماتعملش» until the RPC succeeds. **The DB is untouched:** `0012`'s `pw_mode` column, its check (`link`|`temp`) and its default `'link'` stay — no migration for cosmetics; the column's fate is the portal phase's call; the only live row is `temp` with a password (checked read-only). Done in-session without subagents (owner: economise on Fable). Tests: unit 206 (the link create became a temp create; an `addLogin` case), split 5, e2e 118 (the two vendor specs rewritten for the single mode); semgrep: the rule registry is unreachable from the sandbox (proxy 403) — CI's semgrep job is the gate. The plan (decisions 5, 9, review focus 9, Task B), `CLAUDE.md` and `tools/deploy.md` §2.6 carry the amendment.
