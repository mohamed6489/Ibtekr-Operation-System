# Final fix wave — report

Base: a3a31ad (+ controller's 6410caa). Commits (not pushed):

| SHA | Group | Subject |
|---|---|---|
| 4549a0e | A | fix(auth): local sign-out scope, cross-tab idle, screen locks before network |
| b8b8cd4 | B | fix(auth): email signs in directly; lookup RPC is phone-only |
| 60c3d30 | C | fix(ci): live e2e only against an injected staging project |
| 08d788f | D | fix(db): twofa admin-only; spec-4.2 permission cases; settings/status_map coverage |
| 7b4328e | E | fix: activity log forwards only auth.* events; runbook SMTP/HSTS/team-actions notes |

Final verification (HEAD 7b4328e): `npm test` 12/12 pass; `npm run e2e` three runs in a row: `26 passed (46.7s)`, `26 passed (46.1s)`, `26 passed (47.3s)` (a fourth, full-output run: `26 passed (45.4s)`, no other lines); `npm run db:test`: `rls_identity: ok`, `rls_system: ok`, `all passed` (the only other line is the script's existing stub WARNING). `E2E_SUPABASE_LIVE=1` without URL/key: `26 skipped`. `git status` clean, no `test-results/`.

## A. Auth path

**A1** — `app/js/adapter/auth.js`: `signOut(scope = 'local')` passes `{ scope }` to `auth.signOut`; new `signOutOthers()` (`{ scope: 'others' }`, returns `{ ok }`, leaves `current`/totp untouched since supabase-js keeps the local session for `others`). Every error path (`loadMember`, `signIn` catch) and the gate in 28-app.js (unchanged; calls `A.signOut()`) now get `local`. Block 21: `signOut(reason)` → `IBAuth.signOut('local')`; `doReset` → `IBAuth.signOut('global')`. Idle: new `idleSec()` = `now() - max(lastAct, Number(localStorage['ib.lastAct']))`; `touch()` writes `ib.lastAct` at most once per 5 s (`lastWrite`). Mock (`tests/e2e/supabase-mock.mjs`): `/auth/v1/logout` honours `?scope=` (local = this token, others = the user's other tokens, global = all of the user's) and records `mock.logoutScopes`.
Tests: `logout returns to login` → `logoutScopes == ['local']`; `8h idle signs out…` → `['local']`; new `idle counts activity in any tab…` (two pages in one context, shared fake clock; mock shared through new `mock.attach(page)`; tab A's in-memory lastAct 9 h back via `clock.setSystemTime`, tab B writes `ib.lastAct = now`, `runFor('01:00')` → tab A stays in, 0 logouts). Verified this test FAILS with the old idle formula, passes with the fix. Recovery test now asserts `['global']`. All pass.
Small addition beyond the letter of the ruling (same idle mechanism, block 21 only): the interval closes an open warning when the shared clock says `active`, and the warning's 60 s countdown signs out only if the shared idle state is not `active` — otherwise a tab whose warning was already up would still sign out after the other tab became active.

**A2** — block 21 `signOutAll`: on confirm, `await IBAuth.signOutOthers()` (errors → `{ok:false}`); failure → error toast «معرفناش نعمل خروج من الأجهزة التانية — جرّب تاني»; success → the existing log + success toast. Test: `«خروج من كل الأجهزة» ends the other sessions only` (profile › الأمان) → `logoutScopes == ['others']`, toast text, app still visible. Pass.

**A3** — block 21: `signOut(reason)` calls `showLogin(...)` (hides `#root`) first, then `logWithin('auth.signout', …)` = `Promise.race([K.logEvent(...), 3 s timeout])`, then the local sign-out. `logout()` only delegates to `signOut`, so it is covered. `doReset`: invite path logs (raced) then `enterApp`; reset path draws the login view and the toast first, holds sign-in (`ls.busy = true`, so `doLogin` ignores clicks) while the raced log and the global sign-out run, then releases. Mock: `mock.activityDelayMs`. Test: `a stalled activity log does not hold the screen…` (10 s delay) → `#login` visible and `#root` hidden within 1 s; `logoutScopes == ['local']` within 6 s. Pass.

**A4** — block 21 "sent" view: «فتح اللينك (تجربة)» removed; «ابعت تاني» awaits `IBAuth.resetPassword(ls.id)` and toasts «اتبعت تاني» (success) or the network error. Mock now answers `POST /auth/v1/recover` (records `mock.recovers`). Test: `«ابعت تاني» on the sent view…` → demo button count 0, two recover calls, toast. Pass.

**A5** — suspended e2e (phone identifier, see B): no `POST /auth/v1/token`, no `sb-*` key in local/sessionStorage. Idle e2e: mock counts `afterLogout` (requests reaching the origin after the first logout); after `clock.runFor('02:00')` it is 0. Pass.

## B. Lookup RPC

**B1** (a) `auth.js signIn`: email (`identifierKind === 'email'`, after `toLatin`/trim, lowercased) → `signInWithPassword` directly; phone → lookup as before. (b) `0001_identity.sql email_for_identifier`: only `^[0-9]{11}$` after stripping spaces/hyphens returns a row; anything else zero rows; comment rewritten (no oracle; flood degrades phone sign-in only). (c) `rls_identity.sql`: emails (suspended viewer, hyphenated admin) → 0 rows; suspended viewer by phone `'010-0000 0003'` → suspended; 10 digits → 0 rows; phone/unknown/throttle cases kept. (d) mock RPC phone-only + `mock.lookups`; e2e: email sign-in `lookups == []`; Arabic-digit phone `lookups == ['01000000002']`; new email-suspended test (signed in by GoTrue, then `local` sign-out by the profile check, `suspended` view, no `sb-*` keys); rate-limit test now uses the phone identifier. (e) runbook §2.2 bullet on `email_for_identifier`: phone-only, global 60/min, a flood degrades phone sign-in only. Tests: db:test ok, e2e pass.
Note: A5 asks the suspended e2e to assert no token POST, but after B1 an email sign-in must POST the token. Resolved by splitting: the phone case asserts no token POST + no `sb-*`; the email case asserts suspended view + local logout + no `sb-*`.

## C. CI

**C1** — `supabase-mock.mjs`: `LIVE_MISSING` (set when LIVE and `E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY` missing) and `installLiveConfig(page)` (addInitScript → `window.IB_CONFIG`). `auth.spec.mjs` and `login.spec.mjs` skip LIVE when missing, else inject. `ci.yml`: job-level env is only `HAS_LIVE: ${{ secrets.E2E_SUPABASE_URL != '' }}`; the live step has `if: env.HAS_LIVE == 'true'` and maps the six secrets at step level. Runbook §5.5 uses the env set (no more editing `config.js`/`git checkout`), lists the six secrets; §2.4's sentence updated to match. Checks: `E2E_SUPABASE_LIVE=1 npm run e2e` → 26 skipped; with a fake staging URL/key the login spec runs (1 passed) against the injected config.

## D. SQL

**D1** — `profiles_guard_update`: non-admins may change only `name`, `phone`; comment explains twofa. Test: ops `update … set twofa = true` → sqlstate 42501. Pass.

**D2** — `rls_identity.sql`: users for cs / accounts / vendors_followup (cs: tickets.view F, vendors.view P, orders.edit N; accounts: accounts.add F, tickets.view N, orders.edit N; vendors_followup: vendors.edit F, tickets.view P, accounts.view N); custom role `custom_qa` `{"orders.view":"P"}` (is_system false) on a 7th user → P / orders.edit N; ops `custom_perms {"orders.edit":"F","orders.status":"N"}` → orders.status N over role F; admin `custom_perms {"orders.edit":"N"}` → still F; role escalation asserts `sqlstate = '42501'` specifically. Pass.

**D3** — `rls_system.sql`: team manager's settings update with `updated_by` spoofed to the admin id → all three rows carry the caller (trigger override). Non-admin (ops) `delete` on settings and status_map.
**Deviation:** the ruling says "fails with 42501", but those tables have DELETE grants (Supabase default privileges; the local stub mirrors them) and the admin-only RLS `using` silently filters rows — Postgres raises no error for a filtered DELETE. Closest safe variant without changing the migration: assert 0 rows deleted on each table and that all 10 settings / 6 status_map rows remain. Getting a literal 42501 would need a new BEFORE DELETE trigger in 0002 (behaviour change outside the brief) — left for the controller to rule on.

## E. Adapter scope and runbook

**E1** — `app/js/adapter/activity.js`: `LOGGED_PREFIXES = ['auth.']` with the per-phase comment; `log()` forwards only matching actions (exported on `IBActivity` for visibility); `store.activity` in 14-kit untouched. Test: new `tests/adapter/activity.test.mjs` (vm context, stub `IBSupabase`/`IBAuth`): `auth.signin` sent with the exact RPC args; `hr.payroll.approve` and `shift.start` not sent; nothing while signed out. Pass; e2e unaffected (auth.signin / auth.signout still logged).

**E2** — `tools/deploy.md` §7 and `CLAUDE.md` (under the rules): «لحد صفحة الإعدادات (المرحلة 10): إيقاف عضو / تغيير دور / دعوة بتتعمل من SQL أو لوحة Supabase، الشاشة بتعرض بس». No block-17 edit.

**E3** — `tools/deploy.md` §2.3: Custom SMTP bullet (reason: built-in mailer rate-limited and restricted to project team addresses; `system@ibtekr.club`, sender name «نظام إبتكر», `smtp.hostinger.com:465` SSL, user = mailbox, password only in the Supabase dashboard); «Secure password change» now **شغّال**. §5 step 6: recovery-email check (arrives from system@, link opens the reset form; Logs if not). §5 step 4 header list includes `Strict-Transport-Security`. `app/.htaccess`: `Header always set Strict-Transport-Security "max-age=31536000"` inside the `mod_headers` guard, no includeSubDomains. (No test covers .htaccess; checked by §5.4 after deploy.)

## Concerns
- D3 42501 deviation above (needs a ruling if a hard error is required).
- Hostinger SMTP host/port (`smtp.hostinger.com`, 465 SSL) are Hostinger's documented defaults; confirm in hPanel › Emails when the mailbox is created.
- A3 reset path: sign-in is held (`ls.busy`) for up to ~3 s + the global logout call; a click on «دخول» in that window is silently ignored (avoids a new session being killed by the global logout).
- Block edits: only 21-shell.js (lock updated via `npm run lock`); 28-app.js not changed.
