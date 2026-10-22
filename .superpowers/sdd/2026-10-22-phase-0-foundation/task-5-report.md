# Task 5 report: wire the UI to Supabase

**Status:** DONE. Commit `2e70cfe` feat(auth): real sign-in via Supabase, member directory and activity log behind the existing login screen. Not pushed.

## What was implemented (per file)

| File | What |
|---|---|
| `app/config.js` | `window.IB_CONFIG = window.IB_CONFIG \|\| { supabaseUrl: 'https://fsynculhaupcktzkfkdd.supabase.co', supabaseAnonKey: '' }`. A comment says where the key comes from (dashboard › Settings › API › anon public key, or MCP `get_publishable_keys`). |
| `app/js/vendor/supabase.js` | UMD build of `@supabase/supabase-js@2.118.0`, copied unchanged. sha256 `ee3be8de192b97cb…`, byte-identical to `node_modules/@supabase/supabase-js/dist/umd/supabase.js`. |
| `app/js/vendor/README.md` | Two lines: which version this is and how to refresh it. |
| `app/js/adapter/supabase-client.js` | `window.IBSupabase = { client }`. `client` is `null` when the anon key is empty (not configured), so `createClient` never throws. |
| `app/js/adapter/auth.js` | `window.IBAuth = { signIn, verifyTotp, needsTotp, signOut, session, onChange, resetPassword, updatePassword, ready }`. `session()` is synchronous: a variable fed by the initial `getSession()` and by `onAuthStateChange`. `ready()` is the initial `getSession()` promise, which the boot awaits once. |
| `app/js/adapter/directory.js` | `window.IBDirectory = { load, me, members }`. `load()` reads `profiles` + `roles`, fills `IBKit.store.members` in place in the prototype member shape, calls `K.setMe(member_code)` and dispatches `ib:directory`. |
| `app/js/adapter/activity.js` | `window.IBActivity = { log(action, detail) }`. Calls `rpc('log_activity', { action, entity: null, entity_id: null, old_value: null, new_value: detail })` and returns a promise. It does nothing when there is no client or no session (anon cannot run `log_activity`). |
| `tools/seed-dev-users.sql` | Dev-only seed: `auth.users` + `auth.identities` + `profiles` for M01 admin, M02 ops and M99 viewer (suspended). Fixed UUIDs, `on conflict do nothing`, and the password is in the header. **Not run: no MCP or credentials in this session.** |
| `tools/lock-blocks.mjs` + `tools/blocks.lock.json` | `npm run lock` writes `{ file: { prototype, current } }` (sha256) for all 29 blocks and prints which blocks were edited (14, 21, 28). |
| `tools/split-prototype.mjs` | `npm run split` refuses to write while `tools/blocks.lock.json` exists, unless `--force` is passed. It prints a one-line Arabic/English hint and exits 1. |
| `tests/split.test.mjs` | Replaces the `join(split)===src` test with: (a) 29 blocks in order, and the lock keys follow the same order; (b) unedited blocks are byte-identical to the prototype; (c) the edited blocks' `prototype` hash equals the prototype block and their `current` hash equals the file on disk; (d) `index.html` lists the blocks in `tools/blocks.json` order. One extra check: exactly 14, 21 and 28 differ. |
| `tests/helpers/load-umd.mjs` | Shared vm loader (uses `fileURLToPath`). `tests/domain/ops-domain.test.mjs` now imports it. |
| `tests/e2e/supabase-mock.mjs` | One data-driven `page.route` mock. It covers token (password + refresh_token), `GET /auth/v1/user`, `POST /auth/v1/logout`, the `email_for_identifier` RPC (with a `rate_limited` toggle), `profiles` with RLS emulation (settings.view ≠ N and active → all rows, otherwise only the user's own row), `roles`, and the `log_activity` RPC (recorded). It also answers CORS preflights. It presets `IB_CONFIG` with a fake key, records unmocked calls and uses the seed's users and password. |
| `tests/e2e/auth.spec.mjs` | The brief's 5 cases, plus: idle sign-out, rate-limited, not-configured message, session survives reload, header shows the signed-in member. Every test also checks for no `pageerror` and no unmocked request. With `E2E_SUPABASE_LIVE=1` it skips without `E2E_ADMIN_EMAIL/E2E_ADMIN_PW/E2E_OPS_PW/E2E_VIEWER_PW`, and the mock-only cases skip. |
| `tests/e2e/login.spec.mjs` | Now loads `/` (session gating) and installs the mock unless running live. |
| `package.json` / lock | `"dependencies": { "@supabase/supabase-js": "2.118.0" }` (exact), and a `"lock"` script. |

## Exact block edits

**14-kit.js:**
- `const ME` → `let ME`, plus `setMe(code)`, which sets both the closure variable and `window.IBKit.ME`. `setMe` is exported in `window.IBKit`.
- `logEvent`: behaviour unchanged, and it now also calls `window.IBActivity.log(action, detail).catch(() => {})`.

**21-shell.js:**
- Removed: `DEMO_PW`, `findMember` (now unused), and the demo-hint line under «دخول» (it showed the old fake credentials).
- `ls.channel` now defaults to `'تطبيق Authenticator'`.
- New helpers: `TOTP_CH`, `SOON`, and `netErr()`. `netErr()` returns «النظام مش متوصّل بقاعدة البيانات — راجع config.js» when not configured, otherwise «مشكلة في الاتصال — جرّب تاني».
- `drawLogin` 2fa view:
  - The واتساب/إيميل options are labelled «… — متاح بعد تشغيل جسر واتساب».
  - Choosing one only shows that text as a toast. Help text is under the select.
  - The subtitle reads «اكتب الكود من 6 أرقام اللي في تطبيق Authenticator» for the live channel.
- `doLogin`: now async, and has a `busy` guard against double submits. It maps the result:
  - `suspended` → the suspended view.
  - `bad` → `O.loginFail` + the same «فاضل N محاولات» text.
  - `rate_limited` → «محاولات كتير — استنى دقيقة وجرّب تاني».
  - anything else → `netErr()`.
  - ok → if `needsTotp() && !ls.trusted`, the 2fa view; otherwise `logEvent('auth.signin')` and `enterApp()`.
  - The local lock (`auth` / `O.isLocked`) is unchanged.
- `do2fa` → `IBAuth.verifyTotp`.
- `doForgot` → `IBAuth.resetPassword`. The "sent" text is unchanged.
- `doReset` → `O.validatePassword` first, then `IBAuth.updatePassword`.
- `signOut(reason)`: now async. It returns early if already logged out, sets `loggedOut = true`, logs `auth.signout`, awaits `IBAuth.signOut()` (errors swallowed), then shows the login or expired view. `logout()` reaches it on every path.
- `enterApp` and `routeLogin` are untouched.

**28-app.js** (the final `boot();` only):
- `boot()` still runs synchronously.
- An async session gate follows it:
  - Hides `#root` (unless `routeLogin` already put up a login view), then awaits `IBAuth.ready()`.
  - With a session: `IBDirectory.load()`, then it requires `me()` to be active. Otherwise it calls `IBAuth.signOut()` and shows the login screen.
  - Registers `IBAuth.onChange`: on `SIGNED_OUT`, if not already logged out, `showLogin('login')`.
  - When the session is good: shows `#root` and re-renders through `hashchange`.
- A listener on `ib:directory` swaps the topbar's AccountMenu for one built for the signed-in member.

## Tests (RED → GREEN)

- **e2e RED** (before adapters/edits): 9/9 failed (`#login` not found; `login.spec` title mismatch at `/`, because there was no gating yet).
- **e2e GREEN:** 10/10 passed, three consecutive runs, clean output. `E2E_SUPABASE_LIVE=1` without creds: 9 skipped, 1 passed.
- **npm test RED:** `tests/split.test.mjs` failed with `ENOENT tools/blocks.lock.json` (4/5 files ok).
- **npm test GREEN:** 9/9 pass. `npm run split` without `--force` → exit 1 with the hint.
- **`npm run db:test`:** untouched, still "all passed".

## Decisions and deviations

1. **`boot()` stays synchronous.** Ruling 11's sketch awaits before `boot()`, but block 29 (the next script) does `document.getElementById('orders').attachShadow(...)` at load time, and `boot()` creates `#orders`. Deferring `boot()` would crash the orders block. So boot runs as before, and `#root` is hidden until the session is known; the gate then shows it, or the login screen. Same user-visible result.
2. **The header follows the signed-in member** through an `ib:directory` event from `IBDirectory.load()`. Without this, AccountMenu, which is built in `boot()`, would keep showing the seed M01 after an ops user signs in.
3. **`signOut` logs `auth.signout` before awaiting `IBAuth.signOut()`.** Ruling 8 says to call `IBAuth.signOut()` before the current behaviour. Logging first means the server log still receives the event while the session is valid, and the e2e asserts it. Sign-out still finishes before the login or expired view is shown. Separately, `loggedOut = true` is set first, so the idle timer and the `SIGNED_OUT` listener don't repaint over the «الجلسة خلصت» view.
4. **Idle e2e uses `page.clock.install()` + `fastForward('08:00:30')`.** This drives the real idle path. `signOutAll` exists but is "sign out other devices" with a confirm, not the idle path, so I did not export anything new from block 21. The mock also answers `grant_type=refresh_token`, because after an 8-hour jump supabase-js refreshes before logging out.
5. **The 2FA selector's disabled options are emulated.** `U.DropdownMenu` (block 10, off-limits) has no disabled option. The two options carry the «متاح بعد تشغيل جسر واتساب» label, selecting them only toasts that text, and the same text is help under the select.
6. **The demo-hint line was removed.** It printed the old fake credentials and `DEMO_PW`. This is the only visible change to the login card besides the 2FA selector labels.
7. **`'locked'` is never returned by `IBAuth.signIn`.** Locking stays local (`O.isLocked`), as the brief requires. Other mappings: GoTrue 429 → `rate_limited`, `user_banned` → `suspended`, 400/`invalid_credentials` → `bad`, everything else → `network`. If the directory load fails after a successful password check, `signIn` signs out and returns `network`.
8. **`resetPassword` returns `{ok:true}` for an unknown phone,** so the "sent" view never reveals whether an account exists. `doReset` shows «معرفناش نحفظ كلمة المرور — افتح اللينك من الإيميل تاني وجرّب» when `updateUser` fails (for example, no recovery session).
9. **`IBAuth.ready()`** was added to the interface (ruling 11 needs a single awaited initial `getSession()`). `onChange` is a plain subscribe.
10. **The `join(split)===src` test was replaced as ruled.** `tools/join-prototype.mjs` stays but is no longer used by tests.

## Self-review

- **Login card:** same layout and texts, except the removed demo hint and the 2FA selector labels. Error strings for bad, locked and suspended are unchanged.
- **Secrets:** none. The anon key is empty, the mock uses the fake `mock-anon-key`, and the dev password is in `tools/seed-dev-users.sql` (and in the mock, which must match), as the brief asks.
- **Adapters:** 9–60 lines each, one job each, no UI code.
- **Not configured:** the whole app loads with no page errors; sign-in shows the config message (e2e).
- **Edit scope:** no `supabase/` edits, no blocks other than 14, 21 and 28, and `test-results/` was not committed.

## Concerns

- **`seed-dev-users.sql` was not executed or validated against a real Supabase `auth` schema** (no MCP here). The column set follows current GoTrue, and the token columns are `''`, not NULL.
- **Other modules still refer to seed member ids.** Once the directory is loaded, `store.members` holds only real profiles (M01/M02/M99 in dev). Other modules still use those ids (M03–M08 in HR/attendance seeds, `K.team()`), and block 20 captures `ME_NAME` at load. The dashboard renders without errors for admin and ops (e2e), but HR, profile and CS pages can show «—» or behave oddly until the HR phase. I did not exercise every page.
- **The password-recovery redirect is not covered.** `redirectTo` is `…#login-reset`. With the implicit flow, Supabase appends tokens to the URL, and whether the `#login-reset` route survives was not verified live. No `PASSWORD_RECOVERY` handling was added (beyond the rulings).
- **The "remember this device 30 days" flag (`ls.trusted`) is untouched,** as ruled. When the flag is set, a TOTP user can skip the 2FA screen and stay at aal1. Nothing server-side requires aal2 yet.

## Live checklist

1. Put the anon public key in `app/config.js` → `supabaseAnonKey` (dashboard › Settings › API, or MCP `get_publishable_keys`).
2. Run `tools/seed-dev-users.sql` once on the dev project (MCP `execute_sql`). Never on production.
3. Run `E2E_SUPABASE_LIVE=1 E2E_ADMIN_EMAIL=admin.dev@ibtekr.local E2E_ADMIN_PW=IbtekrDev-2026 E2E_OPS_PW=IbtekrDev-2026 E2E_VIEWER_PW=IbtekrDev-2026 npm run e2e`.
4. Supabase Auth settings:
   - Email provider on (sign-ups can stay off).
   - MFA → TOTP enabled.
   - URL configuration: Site URL and Redirect URLs include the app origin and path, plus `#login-reset` (for example `http://localhost:4173/**` and the production origin).
   - Rate limits at defaults.
