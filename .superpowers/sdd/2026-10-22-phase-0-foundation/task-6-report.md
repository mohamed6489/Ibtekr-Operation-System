# Task 6 report — repo context, plugin pins, CI

Status: DONE. Commit `02f0efd chore: project context for any Claude session, plugin pins and CI` (not pushed).

## What I wrote
- `CLAUDE.md` (40 lines, Egyptian-dialect Arabic prose): the spec, plans and `.superpowers/sdd/<plan>/progress.md` ledger (read it first when continuing a plan); Supabase ref `fsynculhaupcktzkfkdd` (eu-central-1); `app/config.js` holds only the public anon key; the ten rules from the brief (rule 2 also requires `npm run lock` after an approved block edit; rule 3 points to `app/js/adapter/`; rule 5 says secrets live in `.env` / GitHub Secrets); the run commands `npm install / serve / test / e2e / db:test / lock`; `npm run split -- --force` only for an intentional regeneration from the prototype; `main` as the integration branch.
- `.claude/settings.json`: `extraKnownMarketplaces` with `claude-plugins-official` (github `anthropics/claude-plugins-official`) and `trailofbits` (github `trailofbits/skills`). `enabledPlugins` has the brief's 10 plugins `@claude-plugins-official` and 3 `@trailofbits`. `permissions.allow` is limited to the 4 project-local commands from the ruling.
- `.github/workflows/ci.yml`: runs on push and pull_request, with `permissions: contents: read`. It has two jobs.
  - `test`: Node 22 with npm cache, then `npm ci`, `npm test`, `npx playwright install --with-deps chromium`, and `npm run e2e` (mocked Supabase, no secrets). An optional live `npm run e2e` with `E2E_SUPABASE_LIVE=1` runs only under `if: env.E2E_ADMIN_EMAIL != ''`, and the four `E2E_*` secrets are mapped through the job-level `env`. On failure, `tests/test-results/` is uploaded as an artifact.
  - `db`: a `postgres:17` service (trust auth, `pg_isready` health check, port 5432), then `postgresql-client` is installed and `DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run db:test` runs.
- `README.md` (~10 lines, Arabic): what the project is, how to run it locally (Node 22+), how to test it, where the docs are, and how the branches work.
- `.gitignore`: adds `test-results/` and `playwright-report/`. `package.json`: adds `"engines": { "node": ">=22" }`.

## CI ↔ local scripts
| CI step | local |
|---|---|
| `npm test` | `npm test` (node:test, 9 tests) |
| `npm run e2e` (mock) | `npm run e2e` |
| live e2e step | `E2E_SUPABASE_LIVE=1 E2E_ADMIN_EMAIL=… E2E_ADMIN_PW=… E2E_OPS_PW=… E2E_VIEWER_PW=… npm run e2e` |
| `db` job | `DATABASE_URL=… npm run db:test` (`tools/db-test.sh --stub`) |

## Deviations / decisions
- **Artifact path is `tests/test-results/`, not `test-results/`.** Playwright's default `outputDir` is relative to the config file (`tests/playwright.config.mjs`), so its output lands in `tests/test-results/`. The unanchored `.gitignore` patterns cover both locations (checked with `git check-ignore`).
- **`npm run split -- --force` instead of `npm run split --force`.** Without the `--`, npm takes `--force` as its own flag and the script never receives it (`split-prototype.mjs` checks `process.argv`).
- **`npm run split` dropped from the main command list.** The brief's Step 1 lists it as a regular command, but the lock now makes it refuse to run. It appears only as the intentional `-- --force` regeneration, per the ruling.
- **Workflow-level `permissions: contents: read` added.** This is least-privilege hardening and was not in the ruling.
- **The skip uses a separate live step instead of skipping the e2e step.** The brief says to skip e2e with an `if` when the secrets are missing. Per the ruling, the mocked e2e always runs and only the live step is skipped.
- `package-lock.json` was not touched: `npm ci` checks only that dependencies are in sync, not `engines`.
- I did not stage the existing unstaged change to `progress.md`; it is the controller's.

## Verification
- `npm test`: 9/9 passed.
- The YAML parses with PyYAML (jobs: `test`, `db`), and the JSON parses.
- I did not run the workflow; it has not been pushed (Step 5 is the controller's).

## Self-review
- No secrets: only `${{ secrets.* }}` references in the workflow. Nothing in `app/`, `supabase/`, `tests/` or `tools/` changed. The Arabic reads naturally, in Egyptian dialect.

## Concerns
- **Plugin marketplace ids are unverified.** The brief's plugin names are pinned exactly as given. I can't confirm from here that every one exists in `claude-plugins-official` (for example `superpowers`, `hostinger`, `semgrep`, `supabase` may live in other marketplaces or have other ids), or that the three trailofbits plugins use exactly those ids in `trailofbits/skills`. Claude Code will report any unknown plugin when the session loads; check that on first use.
- **The live e2e step is untested.** It needs the dev users seeded in the live project. If the secrets exist but the users don't, the live step will fail CI.
- **The `db` job is unproven.** It assumes `_local_auth_stub.sql` works on a stock `postgres:17` image, the same as in the local runs. The first CI run will confirm it.
