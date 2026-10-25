# Task 8 report — vendored export libraries, script-src 'self', semgrep + Deno in CI, activity refresh

Status: DONE_WITH_CONCERNS. Commit `16bcfb5` on `main-gha10e` (base `ca07c7e`; the controller's `1d72aee`/`ca07c7e`
vendor-fetch commits landed while I worked, I did not touch that workflow).

## What
1. **Vendored libraries** (`app/js/vendor/`, entries in `README.md` in the supabase.js style):
   | file | version (verified) | sha256 | source / how fetched |
   |---|---|---|---|
   | `xlsx.full.min.js` (unchanged, commit 83d6029) | SheetJS CE **0.20.3** — `XLSX.version` after loading the file in a `vm` context in Node (the `1.15.0` in the commit title is the codepage table's `cptable.version`) | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` (recomputed, matches; also the committed blob) | `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`, `.github/workflows/vendor-fetch.yml` run 40229718748 |
   | `html2canvas.min.js` (new) | **1.4.1** — header `/*! html2canvas 1.4.1 <https://html2canvas.hertzen.com>`, UMD global `html2canvas`, `package.json` version 1.4.1 | `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb` | `https://registry.npmjs.org/html2canvas/-/html2canvas-1.4.1.tgz` via `npm pack` (the tarball already in the scratchpad); tarball sha1 `7cef1888…a543` and sha512 = the registry's `dist.shasum` / `dist.integrity`; extracted only `package/dist/html2canvas.min.js` into a fresh scratch dir, copied that one file |
   Neither bundle contains `eval(` / `new Function` (grep), so `script-src 'self'` without `'unsafe-eval'` holds.
2. **Blocks 10, 17, 28**: only the CDN strings → `js/vendor/html2canvas.min.js` (10 ×1, 28 ×2) and `js/vendor/xlsx.full.min.js`
   (17 ×1). Proof: reverse-substituting the two URLs on the new files gives byte-identical HEAD files (`cmp`), with one extra
   word: block 17's comment `SheetJS (cdnjs)` → `SheetJS (js/vendor)` — required by "no cdnjs left under app/" (deviation, see below).
   Block 28 loads only html2canvas (xlsx is loaded by 17 alone).
3. **Block 25**: the 5-minute timer now does, inside its existing guard and before `render()`:
   `try { const p = window.IBActivity && window.IBActivity.refresh(); if (p && p.catch) p.catch(() => {}); } catch (e) {} render();`
   — not awaited; `refresh()` keeps its rows on a failed read and dispatches `ib:activity`, whose listener redraws the card.
4. **`app/.htaccess`**: `script-src 'self'` (both cdnjs sources removed); every other directive byte-identical; the comment above
   it rewritten (it said "vendor them later"). `app/index.html` has no inline `<script>` and no `on*=` attribute; no
   preload / dns-prefetch / preconnect hints anywhere in `app/`. `grep -rn cdnjs app/` → nothing.
5. **`tests/split.test.mjs`**: `EDITED` + `10-ui-kit.js`, `17-page-settings.js` (comment and test title updated); `npm run lock`.
6. **`package.json`**: `deno:check`, `deno:test` (both `--node-modules-dir=none --no-lock`: npm:/jsr: imports come from Deno's
   cache as on Supabase, so they work from the root with or without `npm ci`, and no root `deno.lock` is written), `semgrep`
   (the brief's command verbatim).
7. **`.github/workflows/ci.yml`**: job `semgrep` (checkout → `actions/setup-python@v5` 3.12 → `pip install semgrep` →
   `npm run semgrep`) and job `functions` (checkout → `denoland/setup-deno@v2` `deno-version: v2.x` → `npm run deno:check` →
   `npm run deno:test`; no setup-node/npm ci needed thanks to `--node-modules-dir=none`; `npm run` uses the runner's Node).
   `permissions: contents: read` kept; `test` and `db` jobs untouched.
8. **e2e** (`tests/e2e/dashboard.spec.mjs`, two new mock-only tests):
   - *the 5-minute refresh re-reads «آخر نشاط» from the server log; a failed read keeps what the card shows*: a row seeded after
     sign-in is absent at 4:30, present after the tick; then activity_log GETs answer 503 (supabase-js retries them), the tick
     still redraws, `ib:activity` fires once, the card keeps its rows, no page error. Fails without the block-25 change (checked
     by restoring HEAD's block 25: "Expected substring: سارة أحمد").
   - *under the production CSP the dashboard loads with nothing refused, and both export libraries load from js/vendor*:
     `npm run serve` (http-server) does **not** apply `.htaccess`, so the test reads the CSP header out of `app/.htaccess` and
     puts it on the document response (`page.route` + `route.fetch`); signs in, loads both vendored scripts the way the blocks'
     loaders do (`XLSX.version === '0.20.3'`, `typeof html2canvas === 'function'`), renders the activity card with html2canvas,
     asserts no console message matching `Refused to|Content Security Policy`; control: a script from the old cdnjs URL raises
     `securitypolicyviolation` `script-src-elem` and exactly one refusal message (so the policy really is enforced in the test).

## Tests (local)
- `npm test` → 152/152 pass.
- `npm run e2e` (mocked) → 77 passed (1.4m).
- `npm run deno:check` → exit 0 (`Check supabase/functions/woo-webhook/index.ts`, `…/woo-sync/index.ts`; also with a fresh
  empty `DENO_DIR`); `npm run deno:test` → `ok | 54 passed | 0 failed`. Sandbox only: `DENO_CERT=/root/.ccr/ca-bundle.crt`.
  No `deno.lock` created.
- semgrep 1.182.1: `npm run semgrep` (registry packs) cannot run here — `ProxyError … semgrep.dev … /c/p/javascript (Tunnel
  connection failed: 403 Forbidden)`. Ran the same flags with the local community rules instead:
  `semgrep scan --metrics=off --config /tmp/semgrep-rules/javascript --config /tmp/semgrep-rules/generic/secrets --severity ERROR --error --exclude app/js/blocks --exclude app/js/vendor .`
  → `Ran 86 rules on 104 files: 0 findings.` exit 0 (adding `/tmp/semgrep-rules/typescript`: 92 rules, 0 findings).
- `npm run db:test` not run (no change to migrations).

## Files
`app/js/vendor/html2canvas.min.js` (new), `app/js/vendor/README.md`, `app/js/blocks/10-ui-kit.js`, `17-page-settings.js`,
`25-page-dashboard.js`, `28-app.js`, `app/.htaccess`, `.github/workflows/ci.yml`, `package.json`, `tests/split.test.mjs`,
`tests/e2e/dashboard.spec.mjs`, `tools/blocks.lock.json`. `app/js/vendor/xlsx.full.min.js` untouched.

## Self-review
- Completeness: both libs vendored with version + source + sha256; no CDN reference left in `app/`; CSP `script-src 'self'`;
  both CI jobs; three scripts; activity refresh with a test; lock regenerated (edited: 10, 11, 14, 17, 18, 21, 25, 28, 29).
- Discipline: 10/17/28 differ only by the URL strings (+ the one-word comment in 17); no `'unsafe-inline'` / `'unsafe-eval'`
  added; other CSP directives unchanged; staged files explicitly (not `git add .github` wholesale, since the controller was
  editing `vendor-fetch.yml` in the same tree at the time).
- Security: the downloaded archive was treated as data (fresh dir, one file copied, hashes checked against the registry); the
  only code executed from a vendored file was `xlsx.full.min.js` inside a Node `vm` context to read `XLSX.version`, as asked.

## Concerns / for the controller
1. **CSP gap found (pre-existing, not fixed — "keep every other directive exactly")**: the share-as-image fallback in block 10
   (`shareVia`, and the same pattern in block 28) shows the image as `<img src="blob:…">` when `navigator.clipboard.write` fails
   (e.g. Firefox without ClipboardItem, or a denied permission). `img-src 'self' data: https:` refuses blob: — verified in
   Chromium under the header: `Refused to load the image 'blob:http://localhost:4173/…' because it violates … "img-src 'self' data: https:"`.
   Fix if you want it: add `blob:` to `img-src` (a decision for the plan, not taken here).
2. CI's registry packs (`p/javascript`, `p/secrets`) are not identical to the local community rule folders; the first CI run of
   job `semgrep` is the real gate and could surface an ERROR the local run cannot see (e.g. a p/secrets rule on the public
   anon key in `app/config.js`). `pip install semgrep` is unpinned, as the brief specifies.
3. The `functions` job, `actions/setup-python@v5` and `denoland/setup-deno@v2` have not run anywhere yet (no workflow runs from
   the sandbox); the YAML parses (4 jobs, `permissions: {contents: read}`).
4. Block 17's comment word change is outside "URL strings only" (needed for the grep rule); CLAUDE.md rule 2 still lists only
   14/21/25/28 as edited — now 10, 11, 14, 17, 18, 21, 25, 28, 29 (CLAUDE.md is not in my file list).
5. The vendored libs get the generic `no-cache` revalidation from `.htaccess` (only `supabase.js` has the 7-day rule); left as is.

## Fix report (review of 16bcfb5) — commit `4720091` (base `47bb16a`, no amend)
1. **Ruling — `img-src 'self' data: blob: https:`** in `app/.htaccess`; every other directive unchanged; one comment line says
   why (the share-as-image fallback of blocks 10/28 shows `URL.createObjectURL(blob)`; only our own scripts can mint one).
   The CSP e2e now drives the real flow under the production header: `navigator.clipboard.write` stubbed to reject
   (`NotAllowedError`), `html2canvas` checked absent first, then dashboard KPI «التفاصيل» (`.dash-kpis .kpi-details`) →
   DetailsModal → `[data-share]` → menuitem «إيميل…» → block 10's `shareVia` loads `js/vendor/html2canvas.min.js` through its
   own loader (exactly one such `<script>` afterwards) → fallback `img.share-img` with `src` `blob:http://localhost:4173/…`,
   `complete && naturalWidth > 0`, toast «…الصورة جاهزة في النافذة», no `Refused to`/`Content Security Policy` console line;
   the mailto: popup is closed. SheetJS is still checked via a `<script src="js/vendor/xlsx.full.min.js">` (`0.20.3`), then the
   cdnjs control (one refusal). Red before the fix: with the old `img-src` the test failed at `naturalWidth` (received 0).
2. **Minor — instant retry**: the mocked 503 now sends `Retry-After: 0` plus `Access-Control-Expose-Headers: retry-after`
   (the header is not CORS-safelisted, so without the expose postgrest-js reads null and backs off). Measured: the 4 GETs
   (1 + 3 retries) now land within ~45 ms; the poll's 15 s timeout went back to the default.
3. **Minor — semgrep**: `npm run semgrep` has `--metrics=off` (semgrep only refuses that with `--config auto`); CI pins
   `pip install semgrep==1.182.1` (the local version; it requires Python >=3.10, CI uses 3.12).
- No block changed (lock untouched; split test 5/5).
- Tests: `npm test` 152/152; `npm run e2e` 77 passed (1.3m); local-rules semgrep (same flags, `--metrics=off`) `Ran 86 rules
  on 105 files: 0 findings.` exit 0.
