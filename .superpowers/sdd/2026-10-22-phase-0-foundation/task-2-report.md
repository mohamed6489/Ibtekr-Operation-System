# Task 2 report: domain-rule tests for auth/idle + Playwright login smoke test

**Status:** DONE_WITH_CONCERNS
**Commit:** `7fe3fa9 test: domain rules for auth/idle and a Playwright login-screen smoke test` (not pushed)

## What I implemented
- `tests/domain/ops-domain.test.mjs`: the brief's 4 tests, with values exactly as written (AUTH constants, a 5-failure lock for 15 minutes, identifierKind, idleState thresholds).
- `tests/playwright.config.mjs`: `testDir: 'e2e'`, `reporter: 'list'`, `webServer { command: 'npm run serve', url: 'http://localhost:4173', reuseExistingServer: true }`, `use { baseURL, locale: 'ar-EG' }`, and a chromium project only.
- `tests/e2e/login.spec.mjs`: the brief's test, but it navigates to `/#login` (per the ruling).
- `.gitattributes`: `* text=auto eol=lf` (per the ruling). Adding it left no tracked file showing as modified.

## Facts checked against the code
- In block 12, `identifierKind` returns `'email'`, `'phone'` (matches `/^01[0125]\d{8}$/`) or `null`. These match the brief, so the expectations are unchanged.
- In block 21, `showLogin` sets `document.title = 'تسجيل الدخول — نظام إبتكر'`, creates `#login` with `dir: 'rtl'`, and sets `#root.hidden = true`. All of this matches the brief, so the assertions are unchanged.

## Deviations from the brief and why
1. **I load block 12 with `vm` instead of `createRequire`.** The root `package.json` has `"type": "module"`, so Node 22 treats `12-ops-domain.js` as ESM. Inside it, `module` is undefined, so the UMD wrapper falls back to `globalThis.IbtekrOps`, and `require()` silently returns an empty namespace. RED evidence: `O.AUTH` was `undefined` and `O.loginInit is not a function`. On Node < 22.12 the call would throw `ERR_REQUIRE_ESM` instead. Block files may not be edited, so the test reads the file and runs it inside `(function (module) {…})` with `vm.runInThisContext`. That runs the real `module.exports = api` branch, in the same realm, so `deepStrictEqual` works. The Task 1 note that "createRequire works" is wrong for this repo. Later tasks that load blocks in Node need the same approach, or an `app/js/blocks/package.json` with `{"type":"commonjs"}` (I did not add one because it is outside this task).
2. **Chromium `executablePath`, the last resort.** Playwright 1.64.1 expects `chromium_headless_shell-1248`, but `/opt/pw-browsers` only has build 1194. The config sets `launchOptions.executablePath = '/opt/pw-browsers/chromium'` only when that path exists. On the user's Windows machine it does not exist, so Playwright's own browser is used there. I did not run `npx playwright install`.
3. **I silenced the DEP0066 warning for the web server.** http-server 14.1.1 prints `[DEP0066] OutgoingMessage.prototype._headers is deprecated` on every run. The config passes `NODE_OPTIONS=<existing> --disable-warning=DEP0066` to the webServer only, so the output stays clean. `--disable-warning` needs Node >= 21.3.

## TDD evidence
RED (before the files existed):
```
$ node --test tests/domain/ops-domain.test.mjs
Could not find 'tests/domain/ops-domain.test.mjs'
$ npm run e2e
Error: /home/user/Ibtekr-Operation-System/tests/playwright.config.mjs does not exist
```
RED (first draft using `createRequire`): 4 domain tests failed (`+ undefined` vs the AUTH object; `O.loginInit is not a function`, …).
RED (e2e before the executablePath fix): `browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1248/...`.

GREEN:
```
$ npm test
ok 1 - AUTH constants match the spec
ok 2 - 5 failures lock for 15 minutes
ok 3 - identifierKind: email, 11-digit phone, arabic digits, junk
ok 4 - idleState thresholds
ok 5 - split yields 29 blocks in order
ok 6 - join(split(x)) === x byte for byte
# tests 6  # pass 6  # fail 0
$ npm run e2e
Running 1 test using 1 worker
  ✓  1 [chromium] › tests/e2e/login.spec.mjs:2:1 › login screen renders in Arabic RTL (1.6s)
  1 passed (4.6s)
```
The output has no warnings. Test discovery stays separate: the node glob `tests/**/*.test.mjs` does not match `*.spec.mjs`, and Playwright's `testDir` is `tests/e2e`.

## Files changed
- /home/user/Ibtekr-Operation-System/.gitattributes
- /home/user/Ibtekr-Operation-System/tests/domain/ops-domain.test.mjs
- /home/user/Ibtekr-Operation-System/tests/playwright.config.mjs
- /home/user/Ibtekr-Operation-System/tests/e2e/login.spec.mjs

## Self-review
- I completed every brief step except `playwright install`, which the ruling skips. No block files were touched.
- The tests assert real behaviour taken from block 12 and block 21.

## Concerns
- The `createRequire` problem (deviation 1) will affect any later task that requires block files in Node.
- Playwright writes `test-results/` at the repo root, and `.gitignore` does not ignore it. I deleted it before committing. Consider adding `/test-results/` to `.gitignore` in a later task.
- The sandbox runs Playwright 1.64.1 against Chromium 1194, an older build. The smoke test passes, but the versions do not match.
