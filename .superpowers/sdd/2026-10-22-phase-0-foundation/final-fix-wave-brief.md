# Final fix wave — phase 0 (one dispatch, one scoped re-review)

Base for this wave: d5c3bda (head the final reviewer saw). Findings are quoted from the final whole-branch review; each carries the controller's ruling. Blocks 21 and 28 may be edited ONLY where a ruling below says so; run `npm run lock` after any block edit. Every fix needs its covering test named and run.

## A. Auth path (Important 1, 2, 10 + triage items)

**A1. Every sign-out is global and the idle timer only counts its own tab.** `app/js/adapter/auth.js:76` calls `auth.signOut()` whose default scope in supabase-js 2.118 is `global`; the prototype distinguishes «تسجيل الخروج» (this device) from «خروج من كل الأجهزة» (other devices). `21-shell.js:103` measures idle time from the in-memory `lastAct`, so a tab idle 8 h signs out every device while another tab is in active use.
Ruling: `IBAuth.signOut(scope = 'local')` — logout, idle expiry and every error-path sign-out use `local`; the reset-password path (`doReset`) uses `global`; add `IBAuth.signOutOthers()` = `signOut({ scope: 'others' })`. The idle interval compares against `max(lastAct in memory, Number(localStorage['ib.lastAct']))`. Throttle `touch()`'s localStorage write to at most once per 5 s. Mock: honour `?scope=` on `/auth/v1/logout` and record it so tests can assert the scope. Tests: logout e2e asserts `scope=local`; idle e2e asserts `scope=local`; a new e2e: two tabs (two pages in one context) — tab B active (write `ib.lastAct` = now), tab A with in-memory lastAct 9 h back → tab A must NOT sign out.

**A2. «خروج من كل الأجهزة» (`21-shell.js:97` `signOutAll`) only toasts.** Ruling: it calls `IBAuth.signOutOthers()` (await, swallow errors, toast on success, error toast on failure), then its current behaviour. Test: e2e asserts a logout request with `scope=others` and the toast text.

**A3. Logout can hang with the app on screen** (`21-shell.js:96` awaits `K.logEvent` before `showLogin`; same shape in `doReset`). Ruling: hide the app first — `showLogin(...)` (or `#root.hidden = true`) runs before the awaited log/sign-out in `signOut(reason)`, `logout()` and `doReset()`; the log is raced against a 3 s timeout (`Promise.race`) so a stalled network never blocks the screen lock. Test: e2e where the mock delays `/rest/v1/rpc/log_activity` by 10 s → the login/expired view appears within 1 s and the logout request still follows.

**A4. Demo controls in the reachable "sent" view** (block 21: «فتح اللينك (تجربة)» leads to a reset form that now always fails; «ابعت تاني» claims it resent). Ruling: remove the «فتح اللينك (تجربة)» button; «ابعت تاني» calls `IBAuth.resetPassword(ls.id)` again and toasts the real result. Test: e2e asserts the second `POST /auth/v1/recover` after clicking «ابعت تاني» and that the demo button is absent.

**A5. Review Focus e2e wording** (triage): the suspended e2e must also assert no `POST /auth/v1/token` was sent and no `sb-*` key exists in localStorage/sessionStorage afterwards; the idle e2e must assert no request to the Supabase origin after the logout request (give the mock a "requests after logout" counter).

## B. Lookup RPC (Important 5)

**B1. `email_for_identifier` also serves email logins** → an email-enumeration oracle (returns exists + suspended for any email) and a cheap team-wide lockout (1 anonymous call/s keeps the global 60/min cap full for everyone, email logins included).
Ruling: (a) `auth.js` `signIn`: for `identifierKind === 'email'` call `signInWithPassword({ email, password })` directly — no RPC; `loadMember` already turns a non-active profile into `'suspended'` + sign-out; (b) the RPC is phone-only: in `supabase/migrations/0001_identity.sql` rename nothing, but make `email_for_identifier` accept ONLY an 11-digit phone (after stripping spaces/hyphens) and return zero rows for anything else — update the function comment; (c) update `supabase/tests/rls_identity.sql` (email cases become "returns zero rows for an email", keep the phone/suspended/rate-limit cases); (d) update the mock + e2e (email sign-in makes no RPC call; phone sign-in still does); (e) runbook: one sentence under the security section that the phone lookup is globally rate-limited (60/min) and a sustained anonymous flood degrades phone sign-in only. Tests: `npm run db:test`, `npm run e2e`.

## C. CI (Important 6 + Task 6 triage)

**C1. The CI live-e2e step runs against whatever `app/config.js` points at** (production, once the key is committed), contradicting the runbook. Ruling: LIVE mode requires `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY` (a staging project) and injects them through `page.addInitScript` as `window.IB_CONFIG` (the `||` in `config.js` already allows it); the spec skips LIVE when either is missing; the CI step maps the six secrets at STEP level (not job level) and is gated with a job-level `HAS_LIVE: ${{ secrets.E2E_SUPABASE_URL != '' }}` flag → `if: env.HAS_LIVE == 'true'`. Runbook §5 updated to the same env set.

## D. SQL hardening and tests (Important 8, 9 + Task 4 triage)

**D1. `twofa` is user-editable** (`profiles_guard_update` lets non-admins change `name, phone, twofa`), so a future "RLS requires aal2 for twofa profiles" rule could be switched off by the user at aal1. Ruling: non-admins may change only `name` and `phone`; `twofa` joins the admin-only set (the enrolment plan will set it from a verified factor). Update the migration comment and the test (ops changing own `twofa` → 42501).

**D2. Permission tests thinner than spec 4.2** ("six roles + a custom role + a member override"). Ruling: add to `rls_identity.sql`: `has_perm` for `cs`, `accounts`, `vendors_followup` on at least two keys each (one F/P and one N, from the seed matrix); a custom non-system role inserted in the test (e.g. `custom_qa` with `{"orders.view":"P"}`) assigned to a 4th test user → `has_perm('orders.view') = 'P'`, `has_perm('orders.edit') = 'N'`; an `'N'` override beating a role `F` (ops with `custom_perms {"orders.status":"N"}` → `'N'`); an admin with `custom_perms {"orders.edit":"N"}` still `'F'`; the role-escalation case asserts `sqlstate = '42501'` specifically.

**D3. Task 4 coverage (triage)**: add to `rls_system.sql`: a spoofed `updated_by` on a settings update is overridden by the trigger; a non-admin `delete` on `settings` and on `status_map` fails with 42501.

## E. Adapter scope and runbook (Important 3, 4, 7)

**E1. Audit log floods from demo pages** (`K.logEvent` → `IBActivity.log` fires for ~125 call sites in blocks 15–29 acting on sample data, attributed to the real user; `activity_log_select` lets ops at `settings.view = P` read them). Ruling (plan defect): `IBActivity.log` forwards only actions whose name starts with `auth.` until a page is wired to real data (an allow-list constant `LOGGED_PREFIXES = ['auth.']` in `activity.js`, with a comment that each phase extends it); `store.activity` keeps the full local behaviour. Test: a unit test (node:test, load `activity.js` with a stub `IBSupabase`) that `hr.payroll.approve` is not sent and `auth.signin` is; e2e unaffected.

**E2. Team screen actions don't persist** (Settings › الفريق shows real members; «إيقاف العضو»/role changes toast success but never write `profiles`). Ruling: no block-17 edit in phase 0; add a clear hand-off note to `tools/deploy.md` §7 ("لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس") and the same line in `CLAUDE.md` under the rules.

**E3. Runbook gaps**: add under §2 a step for custom SMTP (Authentication › SMTP Settings: the `system@ibtekr.club` mailbox from Hostinger, host/port/user, sender name) with the reason (built-in mailer is rate-limited and restricted), make "Secure password change" **on** (not "recommended"), add a recovery-email check to §5, and add a modest HSTS header (`Strict-Transport-Security: max-age=31536000` without includeSubDomains) to `.htaccess` inside the `mod_headers` guard.

## Not in this wave (ruled, recorded in the ledger)
- Explicit grants per table (Minor): verify at live apply; add if the Data API does not expose the tables.
- Users undeletable once they have activity; zero admins; GoTrue ban mirroring; wrong actor in the in-memory event log; `member_code` on invite; mock 401-vs-403: phase 9/10 items.

## Commit
One commit per group (A, B, C, D, E) is fine, or one commit total; each ends with the two trailer lines. `npm run lock` after block edits. Final: `npm test`, `npm run e2e` (3 runs), `npm run db:test` all green with pristine output. Do not push.
