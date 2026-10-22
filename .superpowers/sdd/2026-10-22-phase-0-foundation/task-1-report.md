# Task 1 report: deterministic, verifiable split of the prototype

**Status:** DONE_WITH_CONCERNS (all concerns are follow-up notes; nothing in this task is blocked)
**Commit:** `2ba48b3` feat: split the prototype into app/ with a byte-exact round-trip test (base `cb774b7`)

## What I implemented

- `package.json`: `private`, `type: module`; scripts `test`, `split`, `serve` and `e2e`. The `test` script differs from the brief (see Deviations). devDependencies are pinned exactly: `http-server` 14.1.1 and `@playwright/test` 1.64.1, both the latest at execution time. Installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, and `npx playwright install` was not run. The `package-lock.json` is committed.
- `tools/blocks.json`: the 29 `{n, file}` entries, in order, copied verbatim from the plan's "أسماء الكتل" list (`01-dataio.js` … `29-orders-app.js`).
- `tools/split-prototype.mjs`:
  - `export function split(src)` scans for the exact tags in source order: first `<style>…</style>` gives `baseCss`, the next gives `appCss`, then every `<script>…</script>` after that becomes a block.
  - It returns `{ head, baseCss, headRest, appCss, rootDiv, blocks: [{n, file, code}], gaps, tail }`. `head`, `rootDiv` and `tail` are the raw text before the base `<style>`, between the app `</style>` and the first `<script>`, and after the last `</script>`.
  - Two fields are extra beyond the brief's interface, because the raw bytes need a home: `headRest` (`</head><body>`, `<title>`, the claude meta and the Cairo link between the two styles) and `gaps` (the 28 separators between `</script>` and the next `<script>`; all are `"\n"` today, but they are stored, not assumed).
  - It throws if either style is missing, if a tag is unclosed, or if the script count does not equal `blocks.json`'s length.
  - The CLI is guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`. It resolves paths from the module location, so it works from any cwd. It writes `app/css/base.css`, `app/css/app.css`, `app/js/blocks/<file>` ×29, and `app/index.html` from the brief's template, with the ellipsis expanded to one `<script src>` per line in blocks.json order and a trailing newline.
- `tools/join-prototype.mjs`: `export function join(parts)` puts the literal tags back around each body and interleaves `headRest`, `rootDiv`, `gaps` and `tail`.
- `tests/split.test.mjs`: copied verbatim from the brief.
- `.gitignore`: added `/.superpowers/`.
- Generated output: `app/index.html`, `app/css/{base,app}.css`, and `app/js/blocks/01…29`.

## Deviations from the brief (and why)

1. **The `test` script is `node --test "tests/**/*.test.mjs"`, not `node --test tests/`.** On Node 24.18, `node --test tests/` does not expand a directory. It tries to load `tests` as a CJS module (`Error: Cannot find module 'E:\Ibtekr Operation System\tests'`), so RED failed for the wrong reason. The glob is quoted so that Node expands it, not the shell. That works under cmd.exe (npm on Windows) and sh (Linux CI, where an unquoted `**` without globstar would miss `tests/split.test.mjs`). The glob also picks up Task 2's `tests/domain/*.test.mjs` and leaves out Playwright's `*.spec.mjs`.
2. **`package-lock.json` is committed and `.gitignore` is in the commit.** The brief's `git add` list omits them. Task 6's CI runs `npm ci`, which needs the lockfile, and the controller asked for the `.gitignore` change in this commit.
3. **The commit trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`**, not the "Claude Fable 5.1" line in the dispatch. The harness's attribution reminder for this session gives the Opus 5.5 line, and this agent runs on Opus 5.5, so that attribution is accurate. If the controller wants the other line, amend the trailer.

## Testing and results

### TDD evidence

RED, after the test-script fix: `npm test`
```
> node --test "tests/**/*.test.mjs"
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'E:\Ibtekr Operation System\tools\split-prototype.mjs' imported from E:\Ibtekr Operation System\tests\split.test.mjs
✖ tests\split.test.mjs
ℹ tests 1  ℹ pass 0  ℹ fail 1
```
(The first RED attempt, with the brief's `node --test tests/`, failed with `Cannot find module 'E:\Ibtekr Operation System\tests'`. That led to deviation 1.)

GREEN: `npm test`
```
✔ split yields 29 blocks in order (5.4ms)
✔ join(split(x)) === x byte for byte (7.3ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0
```
The output has no warnings.

### Additional verification (ad hoc, not committed)

- **Parts match the doc comment.** `head` = doctype + metas. `headRest` = `</head><body>\n<title>…\n<meta claude…>\n<link Cairo…>\n`. `rootDiv` = `\n<div id="root" dir="rtl" lang="ar"></div>\n`. There are 28 gaps, all `"\n"`. `tail` = `\n\n</body></html>`. Block 21 contains `window.IBShell = `.
- **The test has teeth.** Dropping one gap makes `join(...) !== src`. A CRLF-converted copy of the prototype still round-trips. Removing one `<script>` makes `split` throw `expected 29 <script> blocks (tools/blocks.json), found 28`.
- **The files on disk rebuild the prototype exactly.** I joined the parts again, with `baseCss`, `appCss` and every block `code` re-read from the written `app/` files, and the result equals the prototype.
- **The split is reproducible.** I deleted `app/` and ran `npm test`, which did not recreate it (so importing the module has no side effects). I then ran the CLI from `tools/` as the cwd. The sha256 over all `app/` files was identical before and after (`6431bcac…`). `npm run split` from PowerShell also works and produces 29 block files.
- **`app/index.html`** matches the brief's template, line for line, in order.

### Step 8: served-app check
`npm run serve` on :4173:
- `GET /` returns 200 `text/html; charset=UTF-8` and is byte-identical to `app/index.html`.
- Every local `href`/`src` in index.html: 31 × 200 (2 css + 29 blocks) and 6 × 404 (`config.js`, `js/vendor/supabase.js`, the 4 `js/adapter/*.js`), which is expected until Task 5. `21-shell.js` is served byte-identical as `application/javascript; charset=UTF-8`.

Real browser (desktop app's built-in browser pane), comparing the split app on :4173 with the original prototype served as-is by http-server on :4174:
- **Console:** the split app's only console errors are the 6 expected 404s on each load, with no JS errors. The original prototype logs nothing.
- **`/` (default route):** both open on the dashboard ("لوحة التحكم — نظام إبتكر"), not on the login screen. The prototype does this by design: block 28 shows login only for `#login*` hashes via `IBShell.routeLogin`, or after sign-out. Rendered `innerText` is identical between the two (same length 3497 and same sha256 prefix, with clock times masked). Globals `IBShell`, `IBKit`, `IBPages` and `IbtekrOps` are present in both.
- **`#login`:** the Arabic login screen ("تسجيل الدخول", "أهلاً بيك تاني", email/mobile and password fields, the demo hint) renders RTL in the Cairo font. Its title, text and input list are identical to the original prototype's (screenshot taken).
- **Cleanup:** both servers were stopped. Stopping the background tasks left the `node http-server` children listening on Windows, so I confirmed the PIDs were my two http-server processes and ended them. Ports 4173 and 4174 are free.

## Files changed (commit 2ba48b3)

- `E:\Ibtekr Operation System\.gitignore` (modified)
- `E:\Ibtekr Operation System\package.json`
- `E:\Ibtekr Operation System\package-lock.json`
- `E:\Ibtekr Operation System\tools\blocks.json`
- `E:\Ibtekr Operation System\tools\split-prototype.mjs`
- `E:\Ibtekr Operation System\tools\join-prototype.mjs`
- `E:\Ibtekr Operation System\tests\split.test.mjs`
- `E:\Ibtekr Operation System\app\index.html`
- `E:\Ibtekr Operation System\app\css\base.css`
- `E:\Ibtekr Operation System\app\css\app.css`
- `E:\Ibtekr Operation System\app\js\blocks\01-dataio.js` … `29-orders-app.js` (29 files)

The prototype file is untouched. `git status` is clean after the commit, and `.superpowers/` and `node_modules/` are ignored.

## Self-review

- **Completeness:** all of Steps 1–9 are done. There are 29 block files, `index.html` follows the template, the round-trip test passes, and the browser check is done.
- **Quality:**
  - Each file has one job.
  - `split` and `join` are small, and the parsing logic is a single `nextElement` helper.
  - `split`'s doc comment documents every returned field.
  - The tags are matched as exact literals (`<style>`, `</style>`, `<script>`, `</script>`), so `join` can emit them as constants.
  - The `<style>` string inside block 29's JS (line 8221) is handled correctly, because by then the scanner is only looking for `</script>`.
- **Discipline:** nothing beyond the brief.
  - There is no join CLI, no stale-file deletion in `app/`, and no self-check in the split CLI.
  - The two extra returned fields (`headRest`, `gaps`) are the minimum needed to keep every byte, as the controller instructed.
- **Testing:** the two brief tests assert real behaviour (verified by the mutation checks above), and the output is clean.

## Concerns (for the controller)

1. **Line endings: `core.autocrlf=true` on this machine, and the repo has no `.gitattributes`.**
   - Today the working copy and the committed blobs are LF (`git ls-files --eol` shows `i/lf w/lf`), so nothing is wrong now.
   - `git add` printed "LF will be replaced by CRLF the next time Git touches it" for the app files.
   - If git ever re-checks-out these files on Windows, `app/js/blocks/*` and the prototype become CRLF, while CI on Linux gets LF.
   - The Task 1 round-trip still passes either way (verified with a CRLF copy). But Task 5's planned `tools/blocks.lock.json` hashes would then differ between Windows and CI.
   - Suggest that Task 5 (or a small chore commit) adds a `.gitattributes`, for example `* text=auto eol=lf`, before introducing hashes. I did not add it here because it is outside this brief.
2. **The brief's Step 8 wording ("login screen visible") does not match the prototype's default.** The prototype opens on the dashboard and shows login only at `#login`. The split reproduces exactly that (verified side by side). This is not a defect of the split, but Task 5's e2e should navigate to `#login`, or expect the dashboard at `/`.
3. **`npm install` printed a deprecation warning** for a transitive dependency of http-server (`whatwg-encoding@2.0.0`). It is harmless and not under our control.
4. **`npm run split` overwrites `app/js/blocks/*` with no guard.** Once Task 5 hand-edits blocks 14, 21 and 28, re-running `npm run split` would silently revert those edits. The plan already says Task 5 turns the round-trip test into a lock/snapshot; it may also want the CLI to refuse to overwrite edited blocks.
