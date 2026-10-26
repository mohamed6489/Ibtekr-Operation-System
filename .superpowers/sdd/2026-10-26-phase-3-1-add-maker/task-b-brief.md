# Task B brief — phase 3.1 front end: the new «إضافة مبتكر» popup, login section, `leave`, mock, e2e

You are the implementer of **Task B** of `docs/superpowers/plans/2026-10-26-phase-3-1-add-maker.md`. Read the plan first (facts, decisions 1–13 — 7, 8, 9, 10, 11, 12 are yours and binding —, Global Constraints, Review Focus), then `CLAUDE.md`, then the owner's prototype `Prototype file/2026-10-26-add-maker.html` (the last `<script>` block is the popup: `loginFields`, `bankFields`, `openAddVendor`; the vendors-domain block holds the functions decision 7 ports; the UI-kit block holds decision 8's changes; the `<style>` holds the CSS classes to add), then `app/js/adapter/vendors.js`, `app/js/blocks/06-vendors-domain.js`, `app/js/blocks/10-ui-kit.js`, the vendors section of `app/js/blocks/28-app.js` (`openAddVendor` ≈ l. 1577, the drawer ≈ l. 1720–1810, `VTODAY`, `vendorTasks`, the filter), `tests/e2e/supabase-mock.mjs`, `tests/e2e/vendors.spec.mjs`, `tests/adapter/vendors.test.mjs`. Work only in your worktree on the branch you are given. Commit per step; every commit message ends with the two trailer lines the controller gave you. Do not push. Do not touch `supabase/` (Task A); the mock emulates the plan's contract (table, columns, the two RPC names, error codes 42501 / 23505 / 22023 / 0A000), not Task A's file.

## Deliverables
1. Block 06 — decision 7 (port list; nothing else; `npm run lock` at the end).
2. Block 10 — decision 8 (`TextInput` options, `VendorStatus('leave')`, `floatOver` + CSS `.floating`); `app/css/app.css` gains the prototype's `.form-sec`, `.pw-acts`, `.pw-rules`, `.pw-cell`, `.pw-val`, `.floating` rules.
3. Block 28 — decision 9 (a)–(e): the popup exactly as the prototype (same ids `v-name`, `v-cat`, `v-phone`, `v-rate`, `v-lead`, `v-status`, `v-aliases`, `v-login-user`, `v-login-email`, `v-login-pwmode`, `v-login-pw`, `v-bank-method`, …), the drawer's «بيانات الدخول» section and its popup, «ناقص» in the drawer header, `leave` everywhere, the duplicate-name refusal. Keep every data string out of `innerHTML` (the block builds DOM with `h()`).
4. `app/js/adapter/vendors.js` — decision 10 (the `login` shape, the create sequence with `{ vendor, missing }`, `setLogin`, `setLoginPassword`, `revealPassword`, `setLoginStatus`, `usernameTaken`, `canLogin`, `missing`; `vendor_logins` read by column list without `secret_id`; 23505 → `duplicate`; the password never logged, never kept after the call).
5. `tests/e2e/supabase-mock.mjs` — decision 11; add a `vf.dev@ibtekr.local` (`vendors_followup`) user if the specs need one. Every existing spec must keep passing (the popover change touches all menus).
6. `tests/e2e/vendors-add.spec.mjs` (new) + additions to `vendors.spec.mjs` — decision 11's cases. Compute dates from the clock as `vendors.spec.mjs` does.
7. `tests/domain/vendors-domain.test.mjs` (new; follow `tests/domain/ops-domain.test.mjs`'s loading pattern) for the ported functions; `tests/adapter/vendors.test.mjs` for the adapter additions (the password appears in no call but the RPC; a refused login / bank step leaves the vendor and reports `missing`).
8. Run: `npm test`, `node --test tests/split.test.mjs`, `npm run e2e` (the whole suite; port 4173 free before/after).

## Rules
- Plain JS, no build, no new libraries. Arabic RTL, Egyptian dialect; keep the prototype's wording. Honesty rule (decision 5 / Review Focus 9): nothing says an e-mail or password was sent.
- Any data write goes through the adapter. Blocks 06, 10, 28 only, by the listed decisions; then `npm run lock`.
- No PII / secrets in fixtures or logs; the test password is `Test1234`; fake phones `0100000000x`.
- If something in the plan cannot work as written, choose the smallest faithful alternative, do it, and record it under «deviations».

## Report
Write `.superpowers/sdd/2026-10-26-phase-3-1-add-maker/p31-b-report.md` (commit with `git add -f`): status, commits, what changed per file, the decisions implemented (7–12, where), test counts, deviations, concerns for the reviewer. Then hand back with a short summary (report path + status).
