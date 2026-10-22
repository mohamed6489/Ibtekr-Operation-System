# Task 7 report: deploy runbook and .htaccess (deploy itself blocked on owner inputs)

**Status:** DONE_WITH_CONCERNS
**Commit:** `646ad2f chore: deploy runbook and .htaccess for the Hostinger subdomain` (not pushed)

## What I wrote

### `tools/deploy.md` (191 lines, Egyptian Arabic prose, commands in English)
The seven sections are in the order the ruling set:
1. **اللي محتاجينه منك**: the subdomain (`<subdomain>`), Hostinger access (the `hostinger` plugin via `/mcp`, or FTP credentials kept in `.env` or the terminal and never in git), and the owner's email, name and phone for M01.
2. **Supabase قبل النشر**:
   - `apply_migration` for `identity`, `system` and `seed_roles`, in that order, using the exact file names; then `execute_sql` for `rls_identity.sql` and `rls_system.sql`, expecting the two `ok` notices. It warns never to apply `_local_auth_stub.sql`.
   - `get_advisors` (security and performance), listing the expected warnings: `login_lookups` has RLS with no policies, and `email_for_identifier` is a definer function anon can call (the 60-per-minute throttle is explained). It also lists what is not acceptable.
   - Auth settings: Email provider on with sign-ups off; Confirm email is the owner's choice; MFA TOTP on; Site URL and Redirect URLs (`https://<subdomain>.ibtekr.club/**`, `http://localhost:4173/**`); Secure password change recommended on.
   - The anon key goes in `app/config.js`, with a snippet and a warning never to commit the service_role key.
   - Dev users are for dev or staging only, with the reason (a known admin password would be a backdoor).
3. **أول حساب أدمن**: Invite, or Create user with Auto Confirm. Then a profiles `insert … select … from auth.users where email = lower('<owner-email>')`, so nobody has to copy the UUID by hand. It sets M01, admin, active, name and phone, and a follow-up select checks the result. It also notes that the invite view cannot set a password yet (Task 5 concern) and gives two workarounds.
4. **رفع الملفات**:
   - Upload the contents of `app/`, including `.htaccess`, to the subdomain's document root; no build step.
   - Do not upload: `node_modules`, `tests`, `tools`, `supabase`, `docs`, `Prototype file`, `.env`, `.git`.
   - hPanel prerequisites: create the subdomain, turn on SSL, and force HTTPS.
   - Preferred path: the `hostinger:hosting-deploy-static-site` skill. Fallback: `lftp --env-password … mirror -R app/ /`, with a caution about `--delete`.
5. **التحقق بعد النشر**:
   - The page title must be `تسجيل الدخول — نظام إبتكر`, and the admin signs in.
   - An `activity_log` query joins to profiles and expects a recent `auth.signin` row for M01.
   - Check DevTools for CSP errors and for the response headers.
   - The live e2e command runs against **staging**. config.js is swapped temporarily and then restored with `git checkout`. The runbook explains why not production: it needs known-password accounts, it writes rows to activity_log, and it can hit the global lookup throttle.
6. **فحص أمني قبل الإعلان**:
   - `/differential-review`.
   - The semgrep command as ruled, with a `p/secrets` fallback in case `p/sql` is missing from the registry.
   - `get_advisors`.
   - A `git log -p` secret grep that excludes `app/js/vendor`, plus how to read the anon JWT.
7. **بعد كده**:
   - SQL to update `settings.general.site`.
   - `main` stays the integration branch.
   - Redeploy cache behaviour.
   - The CSP is tied to the project ref, and new external origins must be added to it.

### `app/.htaccess` (37 lines, English comments)
- General: `Options -Indexes`, `DirectoryIndex index.html`, UTF-8 default charset, `FileETag None`.
- Under `mod_headers` (with `always`): nosniff, `Referrer-Policy strict-origin-when-cross-origin`, `X-Frame-Options SAMEORIGIN`, and the CSP below.
- Under `mod_expires`: css, js and woff/woff2 get 7 days.
- A `FilesMatch` on `index.html` and `config.js` turns Expires off, sets `Cache-Control: no-cache` and unsets `Expires`.

## CSP decision and evidence

Final policy:
```
default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com;
connect-src 'self' https://fsynculhaupcktzkfkdd.supabase.co wss://fsynculhaupcktzkfkdd.supabase.co;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

**Inline-script check: none found, so scripts do not get `'unsafe-inline'`.** Commands, run in the repo root:
- `grep -c "<script>" app/index.html` → 0. All 36 `<script>` tags have `src`.
- `grep -cE "<script[^>]*>[^<]" app/index.html` → 0.
- `grep -nE "\son[a-z]+=" app/index.html | wc -l` → 0.
- `grep -nE "\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['\"\`]|setInterval\s*\(\s*['\"\`]" -r app/js | grep -v vendor | wc -l` → 0.
- `grep -nE "\beval\s*\(|new Function\s*\(" app/js/vendor/supabase.js` → 0, and `grep -c "Function(" app/js/vendor/supabase.js` → 0.
- `innerHTML`, `insertAdjacentHTML` and similar: 21 uses, all in `29-orders-app.js`. `grep -noE "\son[a-z]+=['\"\\\\]" -r app/js | grep -v vendor | wc -l` → 0, so the HTML strings carry no `on*=` handlers. One of them injects a `<style>`, which `style-src 'unsafe-inline'` covers.
- `h()` in block 10 attaches `on*` attributes with `addEventListener`, never as attribute strings. `grep "javascript:"` → 0.

**Deviation from the ruled `script-src 'self'`:** I added `https://cdnjs.cloudflare.com`. Blocks 10, 17 and 28 load `xlsx@0.18.5` and `html2canvas@1.4.1` on demand from cdnjs (`17-page-settings.js:455`, `10-ui-kit.js:279`, `28-app.js:671,1719`). Without that origin, export-to-Excel and screenshot export would break in production. It is a single trusted origin with pinned versions, not `'unsafe-inline'`. I also added `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'self'`.

**Runtime evidence.** http-server does not read `.htaccess`, so I tested the policy separately:
- A temporary Playwright spec, deleted afterwards, injected the exact CSP string parsed from `app/.htaccess` into every response from localhost:4173. It used the Supabase mock, signed in as the dev admin and clicked all 10 sidebar items. Zero `securitypolicyviolation` events, zero page errors, and the test passed.
- The page loaded without signing in also showed zero violations, with the title `تسجيل الدخول — نظام إبتكر`.
- Negative control: the same harness with `style-src 'self'` reported 224 violations (style-src-elem, style-src-attr, img-src), so the detector works.

Not exercised: the cdnjs exports themselves (the sandbox proxy may block cdnjs), and Realtime/wss. supabase-js can create a `blob:` worker only when the `worker` option is set; the app does not set it.

## Tests
- `npm test`: 9/9 pass.
- `npm run e2e`: 21 passed (38.3s). This is a regression check only, since `.htaccess` is not served by http-server.
- `npm run db:test` was not run; no SQL changed.

## Files changed
- `app/.htaccess` (new)
- `tools/deploy.md` (new)
- This report

## Deviations
1. `script-src` includes `https://cdnjs.cloudflare.com` (reason above).
2. Extra hardening directives in the CSP, plus `DirectoryIndex` and `AddCharset`.
3. The commit message follows the ruling (runbook instead of "first deploy"). Brief Steps 1–3 and the push were not done, also per the ruling.
4. The section 6 secret grep is narrower than a bare `password` match. A bare match produced noise from code (`password:` in auth calls) and from the minified vendor bundle, so the vendor directory is excluded.

## Self-review
- **Paths and names:** checked against the repo. Migration names match the Task 3/4 checklists; the `auth.signin` action string comes from `21-shell.js:165`; the title string comes from `21-shell.js:114`; profiles columns come from `0001_identity.sql` (`email` is NOT NULL and unique, and the insert takes it from `auth.users`); the `settings` `general.site` key and its current value `https://ibtekr.club` come from `0002_system.sql`.
- **Live e2e:** it reads `app/config.js`, because the local server serves it. So the runbook says to point config.js at staging temporarily and restore it afterwards. Otherwise the "staging" run would actually hit production.
- **`.htaccess` caching:** `mod_expires` runs in fixup, while `Header set` runs as an output filter, so the `no-cache` override on `index.html`/`config.js` wins. `/` is served through `DirectoryIndex`, and `FilesMatch` applies to the mapped `index.html`. I reasoned this through but did not check it on a real Apache, since none is installed in the sandbox.
- **Secrets:** none in either file. The FTP password goes through `LFTP_PASSWORD` with `--env-password`.

## Concerns
- **The `.htaccess` is untested on a real server.** If Hostinger's LiteSpeed ignores one of these directives, the page still works; only the header or cache behaviour would differ. Step 5.4 of the runbook checks the headers live.
- **The CSP hard-codes the project ref.** A staging project, or a future browser-side WooCommerce API call, needs `connect-src` updated.
- **Fonts and cdnjs were not loaded live under the CSP.** Network access to them is limited in this sandbox; the policy allows both origins.
- **The invite flow cannot set a password yet** (carried over from Task 5). The runbook's workaround is to use "Create user" with a password, or the "forgot password" link.
- **Upload scope:** `app/js/vendor/README.md` gets uploaded with `app/`. It is harmless (it only describes the vendored file).

## Blocked on owner inputs
1. The subdomain name: needed for the Site URL and Redirect URLs, the upload target and the `settings.general.site` update.
2. Hostinger access: plugin authorization via `/mcp`, or FTP host, user and password.
3. The owner's real admin email (plus name and phone) for the M01 account.
4. A session with the Supabase MCP or dashboard access, for:
   - applying 0001–0003 and running the RLS tests;
   - `get_advisors`;
   - the Auth settings;
   - the anon key in `app/config.js`;
   - creating the admin account.
5. Optional: a staging Supabase project for the live e2e run (it must not be production).
6. The owner's choice on "Confirm email".

---

# Fix round 1

**Status:** DONE_WITH_CONCERNS. The fixes are done; the deploy itself is still blocked on owner inputs. **Commit:** `06acfe0 fix(deploy): no-cache for unversioned js/css, path-scoped cdnjs in CSP`. Not pushed.

## Fixes
1. **Mixed versions after a redeploy.**
   - All `.html`, `.js` and `.css` files now get `Cache-Control: no-cache` and `Header unset Expires`, through `<FilesMatch "\.(html|js|css)$">`.
   - `FileETag None` is removed, so the browser's revalidation gets cheap 304s by ETag.
   - Only `js/vendor/supabase.js` keeps a 7-day cache, through `<Files "supabase.js">` with `Cache-Control: public, max-age=604800`. That filename is unique in `app/`. The `<Files>` section comes after the `FilesMatch`, so it overrides it.
   - The whole `mod_expires` block is gone, including the unused `font/woff*` lines. Caching is now done only with `mod_headers`.
   - Runbook §7: the "7 days, hard refresh" line now describes no-cache plus 304s, with supabase.js as the one exception (rename the file or wait a week after updating it).
2. **Path-scoped cdnjs.**
   - `script-src` is now `'self' https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/ https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/`.
   - I checked these paths with `grep -noE "cdnjs.cloudflare.com/[^'\"]+" -r app/js/blocks`. It found `xlsx/0.18.5/xlsx.full.min.js` at 17:455, and `html2canvas/1.4.1/html2canvas.min.js` at 10:279 and at 28:671 and 28:1719.
   - Runbook §6.3 has a note on the follow-up: vendor both libraries into `app/js/vendor/`, upgrade xlsx past CVE-2023-30533 / CVE-2024-22363, and go back to `script-src 'self'`.
3. **Minors.**
   - `lftp` now uses `set ftp:ssl-force true`.
   - Runbook §2.4 now says to commit `app/config.js` with the production anon key, so that the later `git checkout app/config.js` restores it.

## Checks
- `.htaccess` is 33 lines. Every `Header` directive sits inside `<IfModule mod_headers.c>`, and no `Expires*` directives are left.
- `npm test`: 9/9.
- I re-ran the temporary CSP Playwright spec with the new policy string, parsed from `.htaccess`, and deleted the spec afterwards. Signing in and visiting all 10 sidebar pages caused 0 violations.
- **Path scoping, positive check.** Loading `html2canvas/1.4.1/html2canvas.min.js` caused no CSP violation. Its `error` result came from the sandbox network, not from the CSP.
- **Path scoping, negative check.** `cdnjs …/angular.js/1.8.2/angular.min.js` was refused: "violates … script-src".

## Concerns
- Still not checked on a real Apache or LiteSpeed server. In particular I have not confirmed that `<Files>` overriding `<FilesMatch>` merges the same way on Hostinger's LiteSpeed. Runbook step 5.4 checks the headers live; also check that `supabase.js` comes back with `max-age=604800`.
- Every page load now sends about 36 conditional requests. With 304s this is cheap, and it is the trade-off the ruling chose.
