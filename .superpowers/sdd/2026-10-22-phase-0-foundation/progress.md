# SDD ledger — plan: docs/superpowers/plans/2026-10-22-phase-0-foundation.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (read; binding authority).
Branch: main (user chose "current branch" via propose_branch on 2026-10-22). BASE before Task 1: cb774b7.

## Pre-flight conflict scan (2026-10-22)

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ T2 | T1 writes `app/js/blocks/12-ops-domain.js`; T2 `require()`s it as UMD | Block 12 UMD-ness unverified (only blocks 1,2,4,5,6 confirmed). Ruling below. |
| T1 ↔ T5 | T1 test = byte-exact round trip; T5 edits blocks 14/21/28 | T5 explicitly replaces the test with a lock/snapshot (`tools/blocks.lock.json`). Consistent. |
| T1 index.html ↔ T5 adapters | T1 template references config/vendor/adapter files T5 creates | T1 Step 8 accepts 404s until T5. Consistent. |
| T3 ↔ T4 | T4 policies use `has_perm()` from T3 | Same name/signature. Consistent. |
| T3 ↔ T5 | `email_for_identifier(ident) → (email, status)` | Same in both. Consistent. |
| T4 ↔ T5 | `log_activity(action, entity, entity_id, old_value, new_value)` | Same in both. Consistent. |
| T5 ↔ Global constraint "only block 21 + K.logEvent/K.ME may change" | T5 also edits block 28 `boot()` | Constraint says "اللي الخطة بتسمّيها"; T5 names block 28. Consistent. |
| T6 ↔ T1 | CLAUDE.md documents `npm run split/serve/test/e2e` | Scripts defined in T1 Step 1. Consistent. |
| T7 | needs subdomain name + Hostinger auth (user inputs) | Not a plan defect; may block at T7. |
| Each task self-consistency | tests vs code vs files | T1–T6 internally consistent; no asserting-nothing tests; no verbatim duplication mandated. |

Ruling: Block 12 may not be loadable with `require()` in Node — if so, T2 loads it with `node:vm` (`runInNewContext` with a stub `window` object) and reads the exported `IbtekrOps` global; block 12 itself is not edited — why: Global Constraint forbids editing blocks; cost if wrong: a slightly uglier test loader.
Ruling: all implementer/reviewer subagents run on `opus` (not the cheaper tiers the skill suggests) — why: the user requires the strongest model for every phase of this sensitive project (memory: strongest-model-always), and `opus` preserves this session's Fable weekly cap — cost if wrong: higher token spend, no quality risk.
Note: block 12 IS UMD (`module.exports = api`), so the vm-loader ruling above is moot; T2 uses `createRequire`.
Task 1: implementer DONE_WITH_CONCERNS, commit 2ba48b3. Deviations accepted: test script `node --test "tests/**/*.test.mjs"` (Node 24), extra `headRest`/`gaps` fields on split(), package-lock.json committed.
Ruling: add `.gitattributes` with `* text=auto eol=lf` in Task 2 — why: `core.autocrlf=true` on this machine could make Task 5's per-block hashes differ between Windows checkouts and CI — cost if wrong: one extra file.
Ruling: Task 2's login e2e navigates to `/#login` (the prototype boots on the dashboard; the login screen only shows for `#login` until Task 5 adds session gating) — why: implementer observed it; plan assumed `/` — cost if wrong: Task 5 adjusts the test when `/` starts showing login.
Ruling: Task 5 must add a guard to `npm run split` so it refuses to overwrite `app/js/blocks/*` once `tools/blocks.lock.json` exists (unless `--force`) — why: re-running split would silently revert the Task 5 edits to blocks 14/21/28 — cost if wrong: a flag nobody uses.
Task 1: review clean (spec ✅, quality Approved; 0 Critical/Important). ⚠️ items resolved by controller: working tree clean after commit so committed blobs = verified files; `/` boots on dashboard — already ruled for T2.
Task 1: minor (deferred): CLI never validates the content index.html drops (gaps/rootDiv/tail) — assert gaps are whitespace before writing (tools/split-prototype.mjs:50-73).
Task 1: minor (deferred): CLI main-module guard fails through symlinks — compare realpathSync(process.argv[1]) (tools/split-prototype.mjs:75).
Task 1: minor (deferred): no test that app/index.html block order matches blocks.json / app files match split — add in Task 5's lock test.
Task 1: minor (deferred): add `"engines": {"node": ">=24"}` to package.json.
Ruling: keep `<html lang="ar" dir="rtl">` in app/index.html although the prototype's root is a bare `<html>` — why: correct for an Arabic app, body already RTL, overlays verified RTL by the reviewer; only the page scrollbar side may move — cost if wrong: drop two attributes from the template.
Task 1: complete (commits cb774b7..2ba48b3, review clean)
Ruling: the SDD workspace text artifacts (progress.md, task-*-brief.md, task-*-report.md) are committed to git; review packages (*.diff) stay ignored — why: the session moves to a cloud environment that only sees the repository, and the ledger is the recovery map — cost if wrong: a few small text files in git history.
Ruling: work lands on `main` directly, small commits per task, no PR — why: user chose the checked-out branch when asked; solo project — cost if wrong: no PR review surface; mitigated by per-task reviews and final review.
Session 2 (cloud, 2026-10-22): resumed at Task 2. BASE before Task 2: 0b09805.
Ruling: work lands on branch `main-gha10e` (not `main`) for this cloud session — why: the cloud harness designates `main-gha10e` as the only branch it may push; `main` ruling from session 1 stands for the user's local sessions — cost if wrong: the user merges `main-gha10e` into `main` (fast-forward; both were at 0b09805 at session start).
Ruling: the Supabase MCP and Hostinger MCP are not connected in this cloud session — Tasks 3/4 write migrations + SQL tests and verify them against a local Postgres 17 (Docker) with a minimal `auth` schema stub (`auth.users`, `auth.identities`, `auth.uid()`, roles anon/authenticated/service_role); applying to the live project `fsynculhaupcktzkfkdd` is deferred to a session with the MCP (or to the user) and recorded as a follow-up — why: no credentials in the environment and asking blocks the plan — cost if wrong: one re-apply round if the live project's auth schema differs from the stub.
Task 2: implementer DONE_WITH_CONCERNS, commit 7fe3fa9 (base 24be4ad; 24be4ad is a controller bookkeeping commit on top of 0b09805). Concerns: `createRequire` returns `{}` for block 12 because root package.json has `"type": "module"` (so .js = ESM) — the test loads block 12 through `node:vm` with a CommonJS `module` shim (this is the pre-flight fallback ruling, now in force; Task 5's lock test must load blocks the same way); Playwright config sets `executablePath` to /opt/pw-browsers/chromium only when that path exists; test server runs with `--no-deprecation`-style suppression of http-server's DEP0066; `test-results/` is not git-ignored (deferred to Task 6's .gitignore touch).
Task 2: minor (deferred): add `test-results/` and `playwright-report/` to .gitignore (Task 6).
Task 2: review clean (spec ✅, quality Approved; 0 Critical/Important). ⚠️ "e2e pass rests on the report" — accepted: the implementer's report shows the green run (1/1) and the controller ran `npm test` 6/6 itself.
Task 2: minor (deferred): `--disable-warning=DEP0066` in NODE_OPTIONS needs Node ≥21.3 — add `"engines": {"node": ">=22"}` to package.json (Task 6; joins the Task 1 deferred `engines` item).
Task 2: minor (deferred): sandbox-only chromium path in playwright config — could read `PW_CHROMIUM_PATH` env instead (tests/playwright.config.mjs:60-65).
Task 2: minor (deferred): `filename: url.pathname` in the vm loader garbles Windows stack traces — use `fileURLToPath` (tests/domain/ops-domain.test.mjs:5); move `loadUmd` to `tests/helpers/load-umd.mjs` when Task 5's lock test needs it.
Task 2: minor (deferred): exact boundaries untested (lockedUntil at 900000 ms; idleState(28740) → 'active').
Task 2: complete (commits 24be4ad..7fe3fa9, review clean)
BASE before Task 3: (HEAD after ledger commit; see git log)
BASE before Task 3: f0dcb0f. Task 3: implementer DONE_WITH_CONCERNS, commit 22410c4. Added by ruling: supabase/tests/_local_auth_stub.sql (local-only auth stand-in) + tools/db-test.sh (`npm run db:test`). Concerns to weigh in review: has_perm/is_admin ignore profiles.status; email_for_identifier is an enumeration oracle for anon (plan-mandated login path; rate limiting is a Task 5/Supabase concern); anon lost execute on has_perm/is_admin so Task 4 policies must be `to authenticated`; update guard limits non-admins to name/phone/twofa.
