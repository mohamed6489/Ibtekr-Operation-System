# Task 7 report: real TOTP 2FA, aal2 inside has_perm/is_admin, Vault + pg_cron (0008_mfa_cron)

Status: DONE_WITH_CONCERNS. Branch `main-gha10e`, base e465c69, commit 6c1f228.

## What was built

### SQL: `supabase/migrations/0008_mfa_cron.sql` (new)
- **`is_admin()` and `has_perm(key)`** are redefined with `create or replace`. Signatures, `stable`, `security definer` and `set search_path = public` are unchanged, and the grants from 0001 are restated as they were. The only new branch: when `coalesce(p.twofa,false)` is true and `coalesce(auth.jwt()->>'aal','aal1') <> 'aal2'`, `has_perm` returns `'N'` and `is_admin` returns `false`. This check comes after the `status <> 'active'` check and before the admin/custom/role branches.
- **`mark_twofa_enrolled()`** (plpgsql, volatile, definer, `search_path = public`). It requires `auth.uid()`, `aal = 'aal2'`, and a `verified` row in `auth.mfa_factors` for `auth.uid()`. Otherwise it raises `aal2_required` with errcode `42501`. It updates `profiles.twofa = true` for the caller only.
- **`mark_twofa_disabled()`**: requires aal2, else `42501 aal2_required`. It sets `twofa = false` for the caller.
- Execute on both is granted to `authenticated` only. It is revoked from public, anon and service_role, because the default privileges hand it to all API roles.
- **`sync_secret_matches(candidate text) returns boolean`** (plpgsql, stable, definer, `search_path = public`). Execute is granted to `service_role` only.
  - It returns `false` when the candidate is null or empty, when `to_regclass('vault.decrypted_secrets')` is null (the local stub), or when there is no secret.
  - Otherwise it compares `sha256(candidate)` with `sha256(secret)` over all 32 bytes, using an XOR/OR accumulator. There is no early exit and no plain `=` on the secret.
- **Vault + cron**, in a guarded `do` block. It runs only when `pg_cron`, `pg_net` and `supabase_vault` are all in `pg_available_extensions`; otherwise it raises a notice and skips. The steps:
  - `create extension if not exists pg_cron with schema pg_catalog; … pg_net with schema extensions; … supabase_vault with schema vault`.
  - `vault.create_secret(encode(<pgcrypto schema>.gen_random_bytes(32),'hex'), 'sync_secret', …)`, only if `vault.secrets` has no `sync_secret`. The pgcrypto schema is looked up in `pg_proc`; live it is `extensions`.
  - `cron.schedule('woo-sync-backup', '*/15 * * * *', $cron$ select net.http_post(url := current_setting('app.functions_url') || '/woo-sync', headers := jsonb_build_object('Content-Type','application/json','X-Sync-Secret',(select decrypted_secret from vault.decrypted_secrets where name='sync_secret')), body := '{"action":"all"}'::jsonb, timeout_milliseconds := 150000) $cron$)`.
  - With an existing job name, `cron.schedule` updates that job (pg_cron ≥ 1.4; live has 1.6.4). A re-run therefore keeps one job, and no unschedule is needed.
- **`app.functions_url`** is set with `alter database postgres set app.functions_url = 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1'`. This runs only when `current_database() = 'postgres'`, inside `begin … exception when others then raise notice … end`.
- The file has no `drop`/`delete`/`truncate`, and no secret value. All objects are created with `create or replace` or `if not exists`.

### SQL tests: `supabase/tests/rls_mfa.sql` (new)
It follows the harness pattern: one transaction, rollback, `NOTICE 'rls_mfa: ok'`, and no statement that removes rows. The `auth.mfa_factors` inserts carry every NOT NULL column of the live table, so the script can also run live through execute_sql. Cases:
- **ops with twofa:**
  - aal1 → `has_perm('orders.view')='N'`, `settings.view='N'`, `is_admin()=false`, and only its own profile row (the rule reaches policies through has_perm).
  - No `aal` claim → `'N'`.
  - aal2 → `'F'`, `settings.view='P'`, and every profile.
- **admin with twofa:** aal1 → `is_admin()=false` and `'N'`. At aal1 it **cannot clear its own twofa** (`42501` from `profiles_guard_update`). aal2 → `true` and `'F'`.
- **Without twofa:** an ops user at aal1 gets `'F'` / `sensitive.commission='N'`, and an admin at aal1 has `is_admin()=true`.
- **`mark_twofa_enrolled`** raises `42501 aal2_required` (exact message checked):
  - at aal1;
  - at aal2 with no factor;
  - at aal2 with only an `unverified` factor;
  - at aal2 when only another user's factor is `verified`. After these refusals `twofa` is still false.
  - At aal2 with its own verified factor, `twofa = true`, and only the caller's row changes.
- **Once enrolled:** aal1 gets `'N'`. `mark_twofa_disabled` at aal1 raises `42501 aal2_required` and twofa stays true. At aal2 it sets `twofa = false`.
- **anon:** `mark_twofa_enrolled` fails with `42501`.
- **`sync_secret_matches`:** from `authenticated` it fails with `42501` (no execute). From `service_role`, a wrong, empty or null candidate returns `false`.
- **Grants and attributes:**
  - `has_function_privilege` for has_perm/is_admin: anon none; authenticated and service_role have execute.
  - The 2FA RPCs: authenticated only.
  - sync_secret_matches: service_role only.
  - `prosecdef` and `search_path=public` on all five functions.
  - Return types and `stable` volatility of has_perm/is_admin are unchanged.

### Local stub: `supabase/tests/_local_auth_stub.sql` (extended)
Adds `auth.mfa_factors (id uuid pk, user_id uuid not null → auth.users on delete cascade, friendly_name, factor_type text, status text, created_at/updated_at not null)`. Live uses enums for type and status; the literals compare the same on both. `auth.jwt()` already read `request.jwt.claims`, so `"aal"` needed no change.

### Adapter: `app/js/adapter/auth.js`
- **`enrollTotp()`** → `{ ok, factorId, qr, secret, uri }`.
  - It first unenrolls any **unverified** TOTP factor from `listFactors().all`, because GoTrue refuses a second factor with the friendly name "Authenticator". It then calls `mfa.enroll({ factorType:'totp', friendlyName:'Authenticator' })`.
  - About `qr`: supabase-js prefixes GoTrue's raw SVG unencoded (`data:image/svg+xml;utf-8,<svg…`). The adapter percent-encodes it (`data:image/svg+xml;charset=utf-8,` + `encodeURIComponent`), so a `#` cannot end the URI. A `data:image/…` value passes through unchanged; anything else becomes `''`.
- **`verifyEnroll(factorId, code)`** reads Arabic digits. Anything other than 6 digits → `{ok:false, reason:'code'}` with no request. Otherwise `challengeAndVerify` runs:
  - error → `'code'` (`'network'` on status 0);
  - then `rpc('mark_twofa_enrolled')`; on error → `mfa.unenroll({factorId})` and `{ok:false, reason:'server'}`;
  - on success the directory is updated and `profile.2fa.enable` is logged.
- **`unenrollTotp()`** reads `getAuthenticatorAssuranceLevel`:
  - `currentLevel !== 'aal2'` → `{ok:false, reason:'aal1'}`, with no server call;
  - otherwise `listFactors` → `rpc('mark_twofa_disabled')` (an `aal2_required` error maps to `'aal1'`, any other error to `'server'`) → `unenroll` of each verified TOTP factor. If an unenroll fails, `mark_twofa_enrolled` puts the flag back and the result is `'server'`;
  - on success the directory is updated and `profile.2fa.disable` is logged.
- **Directory update:** `IBDirectory.me().twofa` and the matching member card in `IBDirectory.members()` are set, then `ib:directory` is dispatched. This happens only after the server accepted the change. The log detail is always just `'Authenticator'`: no code, no key.
- **Sign-in second step:** already present since phase 0. `checkTotp()` / `needsTotp()` / `verifyTotp()` in auth.js, with the 2FA view in block 21 and the gate in block 28, already do what the dispatch calls `secondFactorNeeded` / `verifySecondFactor`. I added no duplicate names. **No login block was touched.** The new e2e signs in with the code after a real enrolment.

### Block 18 (`app/js/blocks/18-page-profile.js`, decision in the plan; `EDITED` + `npm run lock`)
- **Section text:** status «مفعّل — تطبيق Authenticator» or «مش مفعّل»; help «اختياري للكل · تطبيق Authenticator (واتساب وإيميل بعد تشغيل جسر واتساب)».
- **In admin view (`#member-Mxx`):** the state is shown with «العضو بيفعّله أو يوقفه من ملفه», and **no buttons**. IBAuth always acts on the signed-in account, so an admin pressing «تفعيل» there would have enrolled their own account.
- **Dialog:**
  1. Radios: واتساب and إيميل are `disabled`, with «بعد تشغيل جسر واتساب»; «تطبيق Authenticator» is checked. «كمّل» calls `enrollTotp`.
  2. The QR is shown as `<img>` only when `qr` starts with `data:image/`. The key is shown as text in `<code>` (DOM text node) with «نسخ المفتاح».
  3. Six-digit code → `verifyEnroll`. A wrong code shows «الكود غلط — جرّب تاني» and the dialog stays. `'server'` sends the user back to step 1 («السيرفر ماأكدش التفعيل — ابدأ من الأول»).
  4. «اتفعّل التحقق بخطوتين…», then «لو ضيّعت التطبيق، الأدمن يقدر يشيل التحقق من لوحة Supabase لحد ما نضيف أكواد احتياطية», then «خلصت».
- **«إيقاف»** → confirm → `unenrollTotp`. For `aal1` it toasts «سجّل دخول بالكود الأول»; on success «اتوقف التحقق بخطوتين».
- **Removed:** the demo code `123456`, the 10 fake backup codes, and every local `m.twofa = …`. `m.twofa` now comes only from the directory.
- The input id is `tfa-code` (the old `2fa-code` is not a valid CSS id selector).

### Activity prefix (outside the hard file list; see concerns)
`IBActivity.LOGGED_PREFIXES` now also has `'profile.2fa.'`, as the plan's Global Constraints say («تزيد `order.` و`suborder.` و`profile.2fa.` (وبس)»; Task 5 added only the first two). It is `profile.2fa.` and not `profile.`, so the sample-data events of «ملفي» (`profile.edit`, `profile.salary`, …) still do not reach `activity_log`. `tests/adapter/activity.test.mjs` pins the list, so that assertion was updated and one case was added.

### Tests
- **`tests/adapter/stub-supabase.mjs`:** `rpc(fn,args)` → `responses['rpc:'+fn]`; `auth.mfa.<method>` → `responses['mfa:'+method]`. Both are recorded in order.
- **`tests/adapter/auth.test.mjs`:** 10 new cases.
  - enroll: unverified factor cleaned first, exact enroll args, encoded QR without `#`;
  - QR allow-list: png data passes, `javascript:` / https / null become `''`;
  - signed out / refused / offline;
  - verify: Arabic digits, call order, directory and member card, `ib:directory`, log without code;
  - wrong code and malformed codes (no request);
  - RPC refusal → unenroll;
  - disable at aal1 (only the AAL read);
  - disable at aal2 (order: AAL → listFactors → RPC → unenroll);
  - RPC `aal2_required` → `'aal1'`, other error → `'server'`, no unenroll in either case;
  - unenroll failure → `mark_twofa_enrolled` restore.
- **`tests/e2e/supabase-mock.mjs`:**
  - Per-install `mock.profiles` (a copy of USERS; the RPCs change `twofa` there) and `mock.factors`, seeded with M03's verified `f-M03`.
  - `POST /auth/v1/factors`: totp only, name-conflict 422, raw-SVG `qr_code` containing a `#`, fake base32 `TOTP_SECRET`, `otpauth://` uri.
  - challenge/verify on the caller's own factor: code `123456` → factor `verified` plus an aal2 session; a wrong code → 422.
  - `DELETE /auth/v1/factors/{id}`: a verified factor needs aal2, else 403 `insufficient_aal`.
  - `POST /rest/v1/rpc/mark_twofa_enrolled|disabled`: aal2 (plus a verified factor for enrolled), else 403 `42501 aal2_required`; 204 on success.
  - `hasPerm` / `isAdmin` / `viewPerm` mirror the 0008 rule: `twofa && aal !== 'aal2'` → N/false. This flows through profiles RLS, the orders tables and woo-sync's admin check.
  - `tokenUser()` returns a snapshot of the profile plus the token's `aal`.
  - Recorders: `enrolls`, `unenrolls`, `twofaCalls`.
- **`tests/e2e/twofa.spec.mjs`** (new, mock only), 7 cases:
  1. **Enrol with the app** (ops M02): QR `src` is `data:image/svg+xml…` and it **decodes** (`naturalWidth > 0`); key text equals `TOTP_SECRET`; code → «اتفعّل» plus the recovery text, and no backup-codes text; `mock.profiles` M02 `twofa === true`; `twofaCalls` = one aal2 `mark_twofa_enrolled`; the factor is verified; the section shows «مفعّل — تطبيق Authenticator»; `profile.2fa.enable` logged at aal2 with detail `Authenticator`. Then sign out (waits for the reload), password → **the code screen**, with no profiles request before aal2 → `123456` → the dashboard (10 nav items, header M02).
  2. **WhatsApp/email disabled:** 3 radios; the first two disabled, «بعد تشغيل جسر واتساب», unchecked; Authenticator enabled and checked; nothing enrolled before «كمّل».
  3. **Wrong code keeps the dialog:** error text; input still there; twofa false; no RPC call; factor still unverified. The right code then works.
  4. **Unfinished enrolment replaced:** cancel at step 2 and start again → the first unverified factor is unenrolled before the second enroll.
  5. **Disable needs aal2:** M03 with its factor gone (the admin-recovery state) signs in at aal1 → «إيقاف» → «سجّل دخول بالكود الأول»; twofa still true; no RPC; no unenroll.
  6. **Disable at aal2:** M03 signs in with the code → «إيقاف» → twofa false; one aal2 `mark_twofa_disabled`; `f-M03` unenrolled at aal2; «مش مفعّل»; `profile.2fa.disable` logged.
  7. **Admin on `#member-M03` › الحساب والأمان:** state shown, no «إيقاف» or «تفعيل» in the card.
  - `afterEach` checks: no page errors, no unhandled requests, and `mock.activity` never contains the code or the key.
- **`tests/split.test.mjs`:** `EDITED` now includes `18-page-profile.js`. `tools/blocks.lock.json` was regenerated by `npm run lock`; only block 18's `current` changed.

## RED / GREEN evidence
- **db:test RED** (`rls_mfa.sql` written, no 0008): `psql:supabase/tests/rls_mfa.sql:43: ERROR:  case twofa ops at aal1: has_perm(orders.view) = N failed`.
- **db:test GREEN:**
  - `0008_mfa_cron: pg_cron / pg_net / supabase_vault not available — Vault secret and backup sync skipped`
  - `rls_dashboard: ok`, `rls_identity: ok`, `rls_mfa: ok`, `rls_orders: ok`, `rls_system: ok`, `db-test: all passed`
- **Scratch check** (throwaway DB, not committed), with a fake `vault.decrypted_secrets` view holding `abc123def`:
  - `sync_secret_matches` returned exact `t`, one char different `f`, shorter `f`, longer `f`.
  - Applying 0008 twice in a row raised no error (idempotent).
- **e2e RED** (spec and mock extension, no adapter or block changes): `7 failed` (all of twofa.spec), `67 passed`. The mock changes did not break any existing case.
- **e2e GREEN:**
  - `74 passed (1.3m)` for the full suite.
  - twofa.spec ran 3× in a row, `7 passed` each time.
  - The first full run hit a race: `page.goto` while sign-out's `location.reload()` was in flight (ERR_ABORTED). The helper now waits for the `load` event of the reload.
- **Mutation check:** I made the adapter pass the raw SVG through unencoded and re-ran the enrol case. It failed (`naturalWidth` expected > 0, received 0); I then restored the code. The encoding is load-bearing and tested.
- **npm test:** `# tests 152 # pass 152 # fail 0` (was 141: +10 auth, +1 activity).
- **semgrep** (local OSS rules; the registry is blocked by the proxy) on the 10 changed/new files: `Ran 394 rules on 10 files: 0 findings.`
- **Live read (read-only, Supabase MCP `list_extensions`):** `supabase_vault 0.3.1` installed (schema `vault`); `pgcrypto` in `extensions`; `pg_cron 1.6.4` and `pg_net 0.20.4` available but **not installed**. The first apply of 0008 will install both.

## Files
- **New:** `supabase/migrations/0008_mfa_cron.sql`, `supabase/tests/rls_mfa.sql`, `tests/e2e/twofa.spec.mjs`
- **Modified:**
  - `supabase/tests/_local_auth_stub.sql`
  - `app/js/adapter/auth.js`
  - `app/js/blocks/18-page-profile.js`
  - `tests/adapter/auth.test.mjs`, `tests/adapter/stub-supabase.mjs`
  - `tests/e2e/supabase-mock.mjs`
  - `tests/split.test.mjs`, `tools/blocks.lock.json`
- **Outside the hard list** (plan Global Constraint; see concern 2): `app/js/adapter/activity.js`, `tests/adapter/activity.test.mjs`
- **Blocks touched:** 18 only.

## Self-review
- **Completeness:**
  - Every brief function, RPC and grant is in place. All 8 brief SQL cases are in rls_mfa, plus extras: the no-claim case, the admin twofa guard, another user's factor, an unverified factor, RLS reach, grants and attributes.
  - Block 18 texts follow the brief; the demo code is gone.
  - All 4 brief e2e cases are present, plus 3 more.
- **Quality:**
  - `has_perm(text) returns text` and `is_admin() returns boolean` stay `stable security definer set search_path = public`, with the same grants. The test checks this through `pg_proc` / `has_function_privilege`.
  - All five functions are definer with `search_path=public`; vault, auth and cron objects are schema-qualified.
- **Discipline:**
  - No secret in code or tests: the mock's `TOTP_SECRET` is an obvious fake, and the Vault secret is generated in Postgres.
  - No drop/delete/truncate. The only "delete" is `splice` on the mock's in-memory factor list (GoTrue's DELETE).
  - Nothing outside the list except activity.js and its test (concern 2).
- **Testing:**
  - aal1 vs aal2 really assert `'N'` vs `'F'` and `false` vs `true`, plus `42501` with message `aal2_required`.
  - The e2e asserts `mock.profiles` M02 `twofa === true` and the full sign-in-with-code path after a real enrolment.

## Concerns (for the controller)
1. **Block 21's 2FA sign-in view still carries prototype leftovers.** I did not touch it: the second-factor step already existed and works, and the block is not in my list.
   - «ابعت الكود تاني» toasts «اتبعت كود جديد».
   - «استخدم كود احتياطي» toasts «اكتب أي كود من الـ 10 الاحتياطيين في نفس الخانة». There are no backup codes now.
   - There is no «رجوع»/cancel (one that signs out). A user stuck on that view can only reload, which brings the same view back.
   - Suggest the final fix wave remove the two buttons and add «رجوع» → `IBAuth.signOut()` + login view.
2. **`activity.js` + `activity.test.mjs` were edited outside the hard file list** to add `'profile.2fa.'`. The plan's Global Constraints list that prefix, and the dispatch made it conditional on the plan. Without it, enable/disable would never reach `activity_log`. Please confirm or revert.
3. **Some policies do not go through has_perm/is_admin:** `alerts_select`, `alert_reads_*`, `user_prefs_owner`, the activity_log own-row read, and `log_activity` (invoker). They check `profiles.status` directly. An enrolled member at aal1 (old token or the recovery path) can therefore still read their own and their role's alerts, their prefs and their own activity, and can write activity rows. This follows the plan's "one place" decision; it is recorded here to carry or rule.
4. **Recovery path:** an admin who removes a factor in the dashboard must also set `profiles.twofa = false`. Until then the member signs in at aal1, gets `'N'` everywhere, and «إيقاف» answers «سجّل دخول بالكود الأول», which they cannot do. The 0008 header says this; the T9 runbook should say it too.
5. **Cron body deviation:** I added `timeout_milliseconds := 150000` to `net.http_post`. pg_net's default (5 s) would cut off woo-sync `all`, which pages through vendors, products and orders, and every run would show as a timeout in `net._http_response`.
6. **Extension schemas:**
   - The migration uses `pg_cron with schema pg_catalog` and `pg_net with schema extensions` (the Supabase docs convention). Live has neither installed yet. If Supabase rejects an explicit schema, the apply fails loudly; nothing is swallowed.
   - No `grant usage on schema cron to postgres` was added: on Supabase the after-create scripts are expected to handle it. If `cron.schedule` is refused at apply, that grant is the fix.
7. **`app.functions_url`:** `alter database postgres set …` by the `postgres` role may be refused on PG17. That only produces a notice. Then every cron run fails visibly in `cron.job_run_details` (`current_setting` without missing_ok), so look for the notice at apply time.
8. **Supabase CLI local stack:** a local stack (DB named `postgres` with pg_cron and Vault) would also schedule the job against the production functions URL. Its local secret makes woo-sync answer 401: harmless but noisy.
9. **Abandoned enrolments:** an enrolment cancelled after step 1 leaves an unverified factor in Supabase until the next `enrollTotp` removes it. Not cleaning it on dialog close was deliberate, to avoid one more API surface.
10. **Sign-in names:** `secondFactorNeeded` / `verifySecondFactor` were not added, because phase 0's `checkTotp` / `needsTotp` / `verifyTotp` already are that step.
11. **Commit attribution:** the commit trailer uses this session's attribution line (`Co-Authored-By: Claude Opus 5.5`, plus the `Claude-Session` line) instead of the dispatch's "Claude Fable 5.1". The session's harness sets that line, and it names the model that wrote the commit.

---

## Fix report: review of 6c1f228 ("Needs fixes"), commit 114cc05 (on 5e0280d, no amend)

Status: DONE.

1. **IMPORTANT, `app.functions_url`.** Fixed as the controller ruled.
   - The `alter database … set app.functions_url` block and its `exception when others` handler are gone.
   - The cron command now posts to the public URL written inline: `url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/woo-sync'`. The secret is still read from `vault.decrypted_secrets` at run time.
   - Unchanged: job name `woo-sync-backup`, schedule `*/15 * * * *`, `timeout_milliseconds := 150000`, and the extension guards.
   - Idempotency is now an explicit unschedule-if-exists (`if exists (select 1 from cron.job where jobname = 'woo-sync-backup') then perform cron.unschedule(…)`) before `cron.schedule`.
   - The header comment now records the ruling. `rls_mfa` never asserted the setting, so it needed no change for this item.
   - Checked in a throwaway DB: the guarded block body ran twice against fake `cron`/`vault` schemas plus real pgcrypto. Result: one `woo-sync-backup` job with the inline URL, no `current_setting` in the command, and one 64-hex `sync_secret`.
2. **MINOR, TOTP only.** `mark_twofa_enrolled` now requires `f.factor_type = 'totp' and f.status = 'verified'`. New rls_mfa case: a verified `phone` factor only → `42501 aal2_required`. Mutation check: without the `factor_type` filter, db:test fails at that case (`…with a verified phone factor only must error failed`). The mock's RPC mirrors the TOTP-only rule.
3. **MINOR, pgcrypto lookup.**
   - It is now `gen_random_bytes(integer)` (`proargtypes = '23'::oidvector`), restricted to the schema pgcrypto is installed in (join `pg_extension`), preferring `extensions`. Checked in a throwaway DB: the lookup returns `extensions`, and the bytes encode to 64 hex chars.
   - The only `exception when others` in 0008 was the removed alter-database handler, so none remain. The rls test handlers already re-raise anything but the expected SQLSTATE.
4. **MINOR, split test.** The header comment adds "18 (phase 2 Task 7)", and the test name reads «only blocks 11, 14, 18, 21, 25, 28 and 29 differ from the prototype».
5. **MINOR, e2e gap.**
   - The mock has a new flag, `mock.twofaRefused`: both 2FA RPCs answer 403 `42501 aal2_required`.
   - New case «the server refuses the flag: the new factor is removed again and the dialog starts over»:
     - the code is accepted, then the dialog shows «السيرفر ماأكدش التفعيل — ابدأ من الأول» and is back on step 1 (3 radios);
     - `twofaCalls` is `[{ fn:'mark_twofa_enrolled', aal:'aal2', result:'aal2_required' }]`;
     - `unenrolls` records the new factor's id at aal2, and the user has no factors left;
     - M02 `twofa` stays false, the card shows «مش مفعّل», and no `profile.2fa.enable` was logged.

Block 18 was not changed, so `npm run lock` was not needed and the lock is unchanged.

**Tests**
- db:test: `rls_dashboard/identity/mfa/orders/system: ok`, `db-test: all passed`.
- npm test: 152/152.
- e2e: `75 passed` (twofa 8).
- semgrep with the local rules on the 5 changed files: 0 findings.
- No drop/delete/truncate statements.

**Trailer:** I again used this session's attribution line (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus the `Claude-Session` line), not "Claude Fable 5.1". The harness sets that line, and it names the model that wrote the commit.
