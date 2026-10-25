# Task 4 report — dashboard wiring (A): saved customization, «آخر نشاط» from the server log, full wipe on sign-out

Status: DONE_WITH_CONCERNS (concerns are about the brief's wording; nothing is blocked)
Commit: 0fbcc8e feat(dashboard): customization saved per user, activity card from the server log, full wipe on sign-out (base 33442b8, branch main-gha10e, not pushed)

## What I implemented, per file

### `app/js/blocks/25-page-dashboard.js` (edits limited to `customize`, `activity`, a new `ib:activity` listener)
- `customize()`: a local `synced(r)` shows `K.toast('اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر', 'error')` only when `!r.ok`.
  - submit: after `K.store.dashPrefs[owner] = { order, hidden }` → `if (window.IBPrefs) window.IBPrefs.set('dashboard', K.store.dashPrefs[owner]).then(synced)`.
  - «رجوع للافتراضي»: after `delete K.store.dashPrefs[owner]` → `if (window.IBPrefs) window.IBPrefs.remove('dashboard').then(synced)`.
  - «عرض كـ»: no code change needed. `view()` already reads `prefsOf(st.viewAs || K.ME)`. Nothing ever fills another member's `dashPrefs` (IBPrefs mirrors only `K.ME`, and the prototype seeds none), so the viewed member gets their role frame in the default order. An e2e test covers it.
- `fmtAt(iso)` (local const just above `activity()`), in local time: same calendar day → `اليوم HH:MM`, the day before → `أمس HH:MM`, otherwise `DD/MM HH:MM`. An invalid date gives `''`.
- `activity()`: `ACT` gains the five `auth.*` labels from the brief. `const srv = window.IBActivity ? window.IBActivity.cached() : null`. When `srv` is non-null (`[]` included, which shows the empty state), the list is `srv.slice(0, 5)` mapped to `{ who: r.actor, what: (ACT[r.action] || r.action) + (r.detail ? ' — ' + r.detail : ''), at: fmtAt(r.at) }`. When it is null, the prototype behaviour is unchanged. The subtitle is unchanged.
- `document.addEventListener('ib:activity', render);` placed before the 5-minute interval.

### `app/js/blocks/21-shell.js` (only `signOut`)
- After `await window.IBAuth.signOut('local').catch(() => {})`: `try { sessionStorage.setItem('ib.loginView', reason === 'idle' ? 'expired' : 'login'); } catch (e) {}`, then `location.reload()`. The comment explains why. `doReset` and `signOutAll` are untouched.

### `app/js/blocks/28-app.js` (only the session gate)
- Before `view` is computed: the brief's `stored` IIFE (read `ib.loginView`, then remove it). `if (!A.session()) return stored === 'expired' ? 'expired' : 'login';`. Everything else in the gate is unchanged. One clause added to the gate's header comment.

### `tests/split.test.mjs`, `tools/blocks.lock.json`
- `EDITED = ['14-kit.js', '21-shell.js', '25-page-dashboard.js', '28-app.js']`. The test title now reads «only blocks 14, 21, 25 and 28 differ from the prototype», and the header comment mentions 25. `npm run lock` output: "29 blocks, edited since the split: 14-kit.js, 21-shell.js, 25-page-dashboard.js, 28-app.js".

### `tests/e2e/supabase-mock.mjs`
- The Task 3 stub now answers only `GET alerts|alert_reads` → `200 []` (left for Task 5). `realtime: false` in `IB_CONFIG` was already in place.
- `mock.prefs` holds `{ user_id, key, data }`.
  - `GET /rest/v1/user_prefs` returns the rows of `u.id`, active users only (RLS `user_prefs_owner`), with `eq.` filters applied and the `select` projected.
  - `POST` is an upsert on `(user_id, key)`. If any row has `user_id !== u.id` or `u.status !== 'active'` → `401 {code:'42501'}`. Without `Prefer: resolution=merge-duplicates`, an existing key → `409 23505`. Otherwise it upserts and returns `201 []`.
  - `DELETE` removes the rows of `u.id` that match the `eq.` filters → `204`.
- `mock.activityRows`: each `log_activity` call also pushes `{ id, at: new Date().toISOString(), actor: u.id, action, new_value }` (next to `mock.activity`, which is unchanged).
  - `GET /rest/v1/activity_log` returns every row when `has_perm('settings.view') !== 'N'`, otherwise the user's own rows if active (RLS 0006). It honours `order=<col>.<asc|desc>` and `limit`, and embeds `actor:profiles(name)` from `USERS`.
- Strictness is kept: `select` is checked against new `COLUMNS` entries (user_prefs and activity_log from 0006/0002). An embed is allowed only along `activity_log.actor → profiles`. A non-`eq.` filter → 400.
- One extra knob, `mock.prefsDown` (every user_prefs write answers 503), to test the error toast. It is documented in the mock's field comment.

### `tests/e2e/dashboard.spec.mjs` (new)
Same `beforeEach`/`afterEach`/`mockOnly` as `auth.spec.mjs`; LIVE works with E2E_ADMIN_EMAIL/E2E_ADMIN_PW/E2E_OPS_PW. Tests:
1. `dashboard greets the signed-in admin with the admin frame`: h1, `يا صفوت`, 5 `.dash-kpis .kpi`, `[data-card="money"]`, `#dash-viewas`.
2. `ops gets the ops frame: no money, no view-as`: `جاهز / قيد الشحن`, no money card, no view-as.
3. `customization is saved to the server and survives a reload` (mockOnly): exactly the brief's flow and assertions (`hidden: ['team']`, 10 ids, `user_id` = ADMIN_ID, reload keeps it, «رجوع للافتراضي» → `mock.prefs` = `[]`, `dashboard.customize` logged).
4. Extra: `«عرض كـ» another member shows their role frame in its default order, not my customization` (mockOnly). The admin hides team, then views as سارة: the cards are exactly the ops default `daily, need, weeks, health, stockToday, vendors, team, activity`.
5. Extra: `a customization the server refused stays on this device and says so` (mockOnly, `prefsDown`). The card stays hidden, the error toast text and class `error` show, and `mock.prefs` is `[]`.
6. `the activity card shows server rows with Arabic labels` (mockOnly): `سجّل دخول` and `صفوت كمال`.
7. Extra: `the activity card lists the newest 5 server rows: today, yesterday, then DD/MM` (mockOnly). It seeds 6 older rows, then checks the 5 rows exactly: `صفوت كمال · اليوم HH:MM` / `سجّل دخول — صفوت كمال`, `أمس 09:05` / `تحقق بخطوتين`, `05/01 08:07` / `غيّر كلمة المرور — reset`, `04/01` / `سجّل دخول — سارة أحمد`, `03/01` / `خروج من كل الأجهزة — سارة أحمد`. It also checks the admin subtitle. This covers every `fmtAt` rule, the limit, the order and the `ACT` labels.
8. `describe('sign-out leaves no member data in memory and keeps the expired message')`, the brief's title, with its two cases:
   - `from the account menu: the members are gone and the page reloaded`: clock installed; dev members are present, then after sign-out they are gone (`expect.poll`). A window marker proves the reload happened, `K.store.activity` no longer holds `auth.signin`, the login view is up, and `mock.afterLogout === 0` after `clock.runFor('00:30')`.
   - `after 8 h idle: «الجلسة خلصت» is still up once the page reloaded`: `fastForward('08:00:30')` → title `الجلسة خلصت`; the reload is confirmed by the marker; the title is still `الجلسة خلصت`; `ib.loginView` was consumed (null). After `clock.runFor('00:30')` the title is still the same, `logoutScopes` = `['local']`, and `afterLogout` = 0.

### Deviations from the brief's test text (selectors only, same assertions)
- The switch is `getByRole('dialog').getByRole('switch', { name: 'الفريق دلوقتي', exact: true })`, not `getByLabel('الفريق دلوقتي')`. I checked with a throwaway spec, since deleted: `getByLabel` matches 4 elements (the ↑/↓ buttons' `aria-label` «لفوق — الفريق دلوقتي», and the card `aria-labelledby` behind the dialog), and with `exact` still 2. That is a strict-mode violation.
- `h1` is `getByRole('heading', { level: 1 })`, because the document has 4 `h1` (other pages' hidden heads).
- The brief's sign-out test has two parts («اختبار تاني»). They are two tests inside a `describe` that carries the brief's title.
- I did not use a one-second `expect.poll` for "the text stays". Instead the test proves the reload happened (marker), re-checks the title, then lets the clock run 30 s (two idle checks) and checks it again.
- The polled `page.evaluate` helpers wrap `.catch(() => null)`, because `expect.poll` does not retry when the context is destroyed mid-reload.

## TDD evidence

### RED (spec + mock written, blocks untouched)
Command: `npx playwright test -c tests/playwright.config.mjs tests/e2e/dashboard.spec.mjs` (the 8 tests that existed at that point)
```
  ✓  1 [chromium] › tests/e2e/dashboard.spec.mjs:43:1 › dashboard greets the signed-in admin with the admin frame (1.6s)
  ✓  2 [chromium] › tests/e2e/dashboard.spec.mjs:52:1 › ops gets the ops frame: no money, no view-as (1.3s)
  ✘  3 [chromium] › tests/e2e/dashboard.spec.mjs:59:1 › customization is saved to the server and survives a reload (6.5s)
  ✘  4 [chromium] › tests/e2e/dashboard.spec.mjs:80:1 › a customization the server refused stays on this device and says so (6.8s)
  ✘  5 [chromium] › tests/e2e/dashboard.spec.mjs:93:1 › the activity card shows server rows with Arabic labels (6.5s)
  ✘  6 [chromium] › tests/e2e/dashboard.spec.mjs:100:1 › the activity card lists the newest 5 server rows: today, yesterday, then DD/MM (6.5s)
  ✘  7 [chromium] › tests/e2e/dashboard.spec.mjs:119:1 › sign-out leaves no member data in memory and keeps the expired message (6.8s)
  ✘  8 [chromium] › tests/e2e/dashboard.spec.mjs:137:1 › an idle sign-out reloads the page and still says «الجلسة خلصت» (11.5s)
    Received string:    "آخر نشاطآخر 5 حركات في السيستمصفوت كمال · اليوم 11:00auth.signin — صفوت كمالسارة أحمد · اليوم 13:40تغيير حالة IB-181668 — جاري التنفيذ ← قيد الشحنصفوت كمال · اليوم 13:12تعديل صلاحية دور «عمليات» — تصدير: ☐ ← ✓محمد علي · اليوم 12:50حل تذكرة TKT-0012 — جاري العمل ← تم الحلالنظام (n8n) · اليوم 12:10فشل إرسال واتساب IB-181652 — التوكن منتهيسجل النشاط كامل"
           - unexpected value "آخر نشاطآخر 5 حركات في السيستمصفوت كمال · اليوم 11:00auth.signin — صفوت كمالسارة أحمد · اليوم 13:40تغيير حالة IB-181668 — جاري التنفيذ ← قيد الشحنصفوت كمال · اليوم 13:12تعديل صلاحية دور «عمليات» — تصدير: ☐ ← ✓محمد علي · اليوم 12:50حل تذكرة TKT-0012 — جاري العمل ← تم الحلالنظام (n8n) · اليوم 12:10فشل إرسال واتساب IB-181652 — التوكن منتهيسجل النشاط كامل"
  customization:     Expected 1 row { cards: 10, hidden: ['team'], key: 'dashboard', user_id: …0001 } — Received []   (nothing sent to user_prefs)
  refused save:      Expected "اتحفظ على الجهاز بس — معرفناش نحفظه على السيرفر" — Received "اتحفظ تخصيص اللوحة"
  activity labels:   Expected substring "سجّل دخول" — Received "…صفوت كمال · اليوم 11:00auth.signin — صفوت كمالسارة أحمد · اليوم 13:40تغيير حالة IB-181668…" (sample data + raw action)
  activity dated:    Expected "سجّل دخول — صفوت كمال" — Received "صفوت كمال · اليوم 11:00auth.signin — صفوت كمال"
  sign-out (menu):   reloaded(page) Expected true, Received false (no reload: the page's memory survives the sign-out)
  sign-out (idle):   reloaded(page) Expected true, Received false
  6 failed, 2 passed
```
Why this is expected: customize wrote only to memory, the card showed prototype data with raw action names, and sign-out never reloaded. The two frame tests describe behaviour that already existed (role frames come from phase 0 / Task 2), so they pass from the start. The `members` part of the sign-out test was already green, because Task 3's `IBDirectory.clear()` empties the array; the reload marker and `store.activity` checks are what turn that test red. The view-as test was added after GREEN to document the brief's view-as decision. It needs no code, so it is a characterization test.

Mutation check: with the gate line put back to `return 'login'`, the new idle test fails (`#lg-title` reads «تسجيل الدخول» after the reload). auth.spec's «8h idle…» still passes, because its title assertion matches before the reload happens. So the new dashboard test is the one that guards the gate edit. I restored the file afterwards, and `npm test` passed against the lock.

### GREEN
`npm test`:
```
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 253.108078
```
`npm run e2e` (full suite, 2 workers):
```
  ✓   1 [chromium] › tests/e2e/auth.spec.mjs:33:1 › signs in and lands on dashboard (1.7s)
  ✓   2 [chromium] › tests/e2e/dashboard.spec.mjs:45:1 › dashboard greets the signed-in admin with the admin frame (1.7s)
  ✓   3 [chromium] › tests/e2e/auth.spec.mjs:42:1 › arabic-digit phone identifier works (1.5s)
  ✓   4 [chromium] › tests/e2e/dashboard.spec.mjs:54:1 › ops gets the ops frame: no money, no view-as (1.4s)
  ✓   5 [chromium] › tests/e2e/auth.spec.mjs:50:1 › session survives a reload (2.0s)
  ✓   6 [chromium] › tests/e2e/dashboard.spec.mjs:61:1 › customization is saved to the server and survives a reload (2.8s)
  ✓   7 [chromium] › tests/e2e/auth.spec.mjs:61:1 › suspended account is refused (phone: no password sent, no session stored) (1.3s)
  ✓   9 [chromium] › tests/e2e/auth.spec.mjs:69:1 › suspended account is refused (email: signed in by GoTrue, then signed out by the profile check) (1.3s)
  ✓   8 [chromium] › tests/e2e/dashboard.spec.mjs:82:1 › «عرض كـ» another member shows their role frame in its default order, not my customization (2.2s)
  ✓  10 [chromium] › tests/e2e/auth.spec.mjs:78:1 › wrong password shows remaining attempts (1.1s)
  ✓  11 [chromium] › tests/e2e/dashboard.spec.mjs:97:1 › a customization the server refused stays on this device and says so (1.9s)
  ✓  12 [chromium] › tests/e2e/auth.spec.mjs:84:1 › logout returns to login (1.7s)
  ✓  13 [chromium] › tests/e2e/dashboard.spec.mjs:110:1 › the activity card shows server rows with Arabic labels (1.4s)
  ✓  14 [chromium] › tests/e2e/auth.spec.mjs:95:1 › 8h idle signs out of Supabase and shows the expired view (1.5s)
  ✓  15 [chromium] › tests/e2e/dashboard.spec.mjs:117:1 › the activity card lists the newest 5 server rows: today, yesterday, then DD/MM (1.5s)
  ✓  16 [chromium] › tests/e2e/auth.spec.mjs:108:1 › idle counts activity in any tab: an active second tab keeps the first one signed in (2.3s)
  ✓  17 [chromium] › tests/e2e/dashboard.spec.mjs:137:3 › sign-out leaves no member data in memory and keeps the expired message › from the account menu: the members are gone and the page reloaded (2.4s)
  ✓  18 [chromium] › tests/e2e/auth.spec.mjs:125:1 › «خروج من كل الأجهزة» ends the other sessions only (1.4s)
  ✓  19 [chromium] › tests/e2e/dashboard.spec.mjs:155:3 › sign-out leaves no member data in memory and keeps the expired message › after 8 h idle: «الجلسة خلصت» is still up once the page reloaded (2.1s)
  ✓  21 [chromium] › tests/e2e/login.spec.mjs:8:1 › login screen renders in Arabic RTL (883ms)
  ✓  20 [chromium] › tests/e2e/auth.spec.mjs:137:1 › a stalled activity log does not hold the screen: login shows at once, the logout follows (5.6s)
  ✓  22 [chromium] › tests/e2e/auth.spec.mjs:149:1 › «ابعت تاني» on the sent view sends the reset link again; no demo link button (1.1s)
  ✓  23 [chromium] › tests/e2e/auth.spec.mjs:163:1 › rate-limited lookup asks to wait a minute (1.1s)
  ✓  24 [chromium] › tests/e2e/auth.spec.mjs:171:1 › missing anon key says the system is not connected (1.2s)
  ✓  25 [chromium] › tests/e2e/auth.spec.mjs:182:1 › 2FA: wrong code is refused, the right one opens the app (1.3s)
  ✓  26 [chromium] › tests/e2e/auth.spec.mjs:197:1 › 2FA: reloading on the code screen does not skip it (1.5s)
  ✓  27 [chromium] › tests/e2e/auth.spec.mjs:207:1 › password recovery link shows the reset form, then the login view (1.2s)
  ✓  28 [chromium] › tests/e2e/auth.spec.mjs:221:1 › idle for 8h+ across a reload ends the session (1.5s)
  ✓  29 [chromium] › tests/e2e/auth.spec.mjs:232:1 › remember-me off keeps the session in sessionStorage only (1.7s)
  ✓  30 [chromium] › tests/e2e/auth.spec.mjs:242:1 › remember-me on keeps the session in localStorage (1.0s)
  ✓  31 [chromium] › tests/e2e/auth.spec.mjs:253:1 › typed #type=recovery on a stale stored session → session ended, no reset form (1.5s)
  ✓  32 [chromium] › tests/e2e/auth.spec.mjs:265:1 › typed #type=recovery on an active stored session → the app, never the reset form (1.4s)
  ✓  33 [chromium] › tests/e2e/auth.spec.mjs:275:1 › typed #type=recovery on an aal1 2FA session → still the 2FA view (1.5s)
  ✓  34 [chromium] › tests/e2e/auth.spec.mjs:284:1 › #login-reset on an everyday session cannot change the password (1.3s)
  ✓  35 [chromium] › tests/e2e/auth.spec.mjs:297:1 › unreadable assurance level fails closed (login, #root hidden) (1.5s)
  35 passed (43.1s)
```
The output is clean: no ✘, no flaky, no warnings, no page errors, and `mock.unhandled` was empty in every test (afterEach). Stability run: `--repeat-each 4 -g "logout|idle|sign-out|stalled|خروج|customization|activity"` → 48 passed.

## Adjustments to existing tests
None. All of `auth.spec.mjs` passes unchanged with the reload: «logout returns to login», «8h idle signs out of Supabase and shows the expired view» (`#lg-title` = «الجلسة خلصت», `afterLogout === 0`), the two-tab idle test, «خروج من كل الأجهزة», and «a stalled activity log does not hold the screen» (the held `log_activity` request outlives the reload; the mock's existing `.catch` absorbs it).

## Files changed
- app/js/blocks/21-shell.js
- app/js/blocks/25-page-dashboard.js
- app/js/blocks/28-app.js
- tests/e2e/dashboard.spec.mjs (new)
- tests/e2e/supabase-mock.mjs
- tests/split.test.mjs
- tools/blocks.lock.json

## Self-review
- Block edits are limited to the named functions: 25 (`customize`, `activity` plus its local `fmtAt`, the `ib:activity` listener), 21 (`signOut` and its comment), 28 (the gate IIFE and its header comment). `doReset` and `signOutAll` are untouched. The prototype's one-line style is kept, and comments are in English.
- The Arabic strings were copied verbatim from the brief: the error toast and the five ACT labels.
- The error toast fires only on `{ ok:false }`, for both set and remove. The success and «رجعت…» toasts are unchanged and come first; a failure replaces them asynchronously.
- The activity card uses server rows only when `cached()` is non-null; `[]` gives the empty state.
- `fmtAt` compares calendar days in local time (month and year boundaries handled by `new Date(y, m, d - 1)`), shows Latin digits padded to 2, and uses DD/MM for anything older.
- The reload happens only in block 21's `signOut`. The gate reads the key once and removes it, and only `!session && stored === 'expired'` changes the view.
- `EDITED` and the lock are updated, and `npm test` is green against them.
- Every e2e case in the brief is present, plus 3 extras (view-as default, refused save, fmtAt / limit / order).
- Rule 8: semgrep is not installed in this sandbox, so it was not run. This task does not push; the controller should run it before the push.

## Concerns (for the controller)
1. **Subtitle vs RLS for ops.** The brief says the subtitle stays («آخر 5 حاجات عملتها» for non-admins) and "RLS بتضمن ده". But RLS 0006 returns every row when `settings.view <> 'N'`, and ops has `P`. So ops (and every role with P) sees everyone's last 5 under a subtitle that says "what you did". Only N-roles really get their own rows. I followed the brief and did not filter. Possible fixes: filter client-side by `K.member(K.ME).name` for non-admins, or change the subtitle.
2. **View-as with the activity card.** When the admin views as سارة, the card shows the admin's server rows (all rows) under «آخر 5 حاجات عملتها». The brief says server rows only, so I left it unfiltered. The old prototype filtered by the viewed member's name.
3. **The `ib:activity` listener redraws without the guard the 5-minute refresh uses** (`.scrim,.menu,[role=dialog]`). An open quick-action menu or date popover inside the dashboard could be redrawn away if a forwarded log lands at that moment. `ib:activity` fires only at sign-in and after `auth.*` / `dashboard.*` logs, so this is rare. I kept the brief's literal `document.addEventListener('ib:activity', render)`.
4. I checked a suspected risk and it does not apply: supabase-js 2.118 `_signOut` removes the local session even when the logout request fails (except for scope `others`). So the reload after a failed or offline logout does not bring the user back in.
5. auth.spec's «8h idle…» test cannot tell whether the reload kept «الجلسة خلصت», because it asserts before the reload. The new dashboard idle test covers that (mutation-checked). auth.spec was left as is, since no adjustment was needed.

---

# Fix round 1 (pre-review, coordinator rulings on concerns 1–3)

Commit: 3a30390 fix(dashboard): non-admin activity card shows own actions only; guarded redraw (on main-gha10e, not pushed)

## What changed
### `app/js/blocks/25-page-dashboard.js`
1. **Own-actions rule on the server rows (ruling 1).** `activity()` maps the server rows (or, with no client, the prototype's events) into `rows`. Then `list = rows.filter((a) => !mine || a.who === mine).slice(0, 5)`, where `mine = role() === 'أدمن' ? null : me().name` (the prototype's line, unchanged) and `who = r.actor`.
   - The admin sees everyone.
   - Every other viewer sees only rows whose actor is that member's name. This includes a member the admin views as, because `me()` follows `st.viewAs`.
   - The subtitles are unchanged.
2. **Guarded redraw (ruling 2), with one deviation from the ruling's literal code.** The listener is `document.addEventListener('ib:activity', () => { if (!document.querySelector('.scrim,.menu,[role=dialog]:not([hidden])')) render(); });`.
   - **Why `:not([hidden])`:** the AI panel (`<section class="ai-panel" role="dialog" hidden>`) stays in the DOM after sign-in even when closed. I checked this with a throwaway probe spec, since deleted. So the literal selector `.scrim,.menu,[role=dialog]` *always* matches, and the listener would never redraw.
   - **Evidence for the literal selector:** with it, 4 dashboard tests fail. «the activity card shows server rows…», «a non-admin sees only…», «…under an open menu» and «…newest 5…» all show «لسه مفيش نشاط النهارده». That is because the first refresh (inside `IBDirectory.load`) runs before `auth.signin` is logged, and the follow-up `ib:activity` is always skipped.
   - **The intent is kept:** an open menu, scrim or visible dialog, including an opened AI panel, blocks the redraw.

### `tests/e2e/dashboard.spec.mjs`
- Two module-level helpers: `at(daysBack, hh, mm)` and `row(id, when, actor, action, value)`. The dated-rows test now uses them; its assertions are unchanged.
- New test `a non-admin sees only their own actions in «آخر نشاط»` (mockOnly). It seeds an ops sign-out from 2 days ago plus two admin rows from yesterday, then signs in as `ops.dev@ibtekr.local`. Expected: exactly 2 rows (her sign-in now, her sign-out), the first being «سجّل دخول — سارة أحمد»; the card contains «سارة أحمد», does not contain «صفوت كمال», and shows «آخر 5 حاجات عملتها».
- The view-as test is extended and renamed (`… not my customization, and only their actions`). It seeds an ops row from yesterday, and the admin's card shows «سارة أحمد · أمس 09:05». After viewing as سارة, the card shows «آخر 5 حاجات عملتها», exactly 1 row «سارة أحمد · أمس 09:05», and no «صفوت كمال».
- New test `a server-log update does not redraw the dashboard under an open menu` (mockOnly). It opens «+ إجراء سريع» and dispatches `ib:activity`: the menu is still visible. After Escape, a second `ib:activity` redraws the card normally.

### `tools/blocks.lock.json`
`npm run lock` → "29 blocks, edited since the split: 14-kit.js, 21-shell.js, 25-page-dashboard.js, 28-app.js".

## TDD evidence
- **RED, ruling 1:** the dashboard spec run against commit 0fbcc8e's block 25 (`git show HEAD:… > file`, restored afterwards):
  - «عرض كـ … only their actions»: `.da-row` count Expected 1, Received 3.
  - «a non-admin sees only their own actions»: Expected 2, Received 4.
  - Result: 2 failed, 8 passed.
- **RED, ruling 2:** the same spec with the unguarded `document.addEventListener('ib:activity', render)`. «a server-log update does not redraw the dashboard under an open menu» fails: `expect(menu).toBeVisible()` → element(s) not found (the redraw dropped the open menu).
- **GREEN:** `npx playwright test -c tests/playwright.config.mjs tests/e2e/dashboard.spec.mjs` → 11 passed.
```
  ✓   2 [chromium] › tests/e2e/dashboard.spec.mjs:48:1 › dashboard greets the signed-in admin with the admin frame (1.9s)
  ✓   4 [chromium] › tests/e2e/dashboard.spec.mjs:57:1 › ops gets the ops frame: no money, no view-as (1.5s)
  ✓   6 [chromium] › tests/e2e/dashboard.spec.mjs:64:1 › customization is saved to the server and survives a reload (2.5s)
  ✓   8 [chromium] › tests/e2e/dashboard.spec.mjs:85:1 › «عرض كـ» another member shows their role frame in its default order, not my customization, and only their actions (2.1s)
  ✓  11 [chromium] › tests/e2e/dashboard.spec.mjs:108:1 › a customization the server refused stays on this device and says so (1.7s)
  ✓  13 [chromium] › tests/e2e/dashboard.spec.mjs:121:1 › the activity card shows server rows with Arabic labels (1.2s)
  ✓  15 [chromium] › tests/e2e/dashboard.spec.mjs:128:1 › a non-admin sees only their own actions in «آخر نشاط» (1.6s)
  ✓  17 [chromium] › tests/e2e/dashboard.spec.mjs:142:1 › a server-log update does not redraw the dashboard under an open menu (1.9s)
  ✓  19 [chromium] › tests/e2e/dashboard.spec.mjs:157:1 › the activity card lists the newest 5 server rows: today, yesterday, then DD/MM (1.7s)
  ✓  21 [chromium] › tests/e2e/dashboard.spec.mjs:176:3 › sign-out leaves no member data in memory and keeps the expired message › from the account menu: the members are gone and the page reloaded (2.1s)
  ✓  22 [chromium] › tests/e2e/dashboard.spec.mjs:194:3 › sign-out leaves no member data in memory and keeps the expired message › after 8 h idle: «الجلسة خلصت» is still up once the page reloaded (1.9s)
```
`npm test`:
```
1..52
# tests 52
# suites 0
# pass 52
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 231.403929
```
`npm run e2e` (full suite):
```
  37 passed (43.0s)
```
There are no ✘, no flaky tests, and no page errors, and `mock.unhandled` is empty. `node --test` was not run separately (no adapter or unit code changed); `npm test` was run once, as above.

## Concerns after the fix round
1. **The 5-minute auto-refresh in block 25 has never fired.** Its guard `!document.querySelector('.scrim,.menu,[role=dialog]')` always matches the hidden AI panel. This is prototype code that I did not touch; it needs a ruling (the fix would be the same `:not([hidden])`).
2. **Own-actions filter over a 5-row cache.** `IBActivity.refresh()` caches only the newest 5 rows the server returns. For a non-admin with `settings.view` P, such as ops, those 5 are everyone's newest, and the filter can leave their own older actions out, or empty the card, when others were busy. The same applies to the admin viewing as a member. Fixing this needs an adapter change, for example `refresh()` reading `.eq('actor', uid)` for non-admins or a larger limit, which is outside this task.
3. semgrep was still not run (not installed in this sandbox).
