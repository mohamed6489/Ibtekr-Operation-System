# Task 2 report: dashboard domain tests (block 24)

**Status:** DONE
**Commit:** `557929d` test(dashboard): rules of the dashboard domain block (layout, ranking, health, packing)

## What I implemented
New file `tests/domain/dash-domain.test.mjs`. It has 13 `test(...)` cases, one for each bullet of the brief, and each test is named exactly like its bullet. The block is loaded with `loadUmd(new URL('../../app/js/blocks/24-dash-domain.js', import.meta.url))`, the same way `ops-domain.test.mjs` loads its block. Assertions use `node:assert/strict`: `deepEqual` for arrays and objects, `equal` for scalars. Every value in the brief is used as written.

Tests by function: roleOf, cardsFor (locked = only `need`), layout with saved prefs, layout with no prefs, kpisFor plus MONEY_KPIS, topNeed (ranking, muted items, source order, limit, empty input), health (counts, shares, empty input), greeting, countDelta, countIn, quickActions, nextMonthDay, packRows.

How some brief items are asserted:
- "layout ... ids start with ['team','kpis'] then the rest of the admin cards in default order": checked with one exact `deepEqual` on the full list, `['team','kpis','daily','need','weeks','health','money','vendors','system','activity']`. The brief's separate checks are also there: `statements` is absent, `team.hidden === true`, `need.hidden === false`, and the length is 10.
- "layout ... every hidden === false": `deepEqual` against an array of 7 `false` values.
- "cardsFor ... only need locked": `deepEqual(cards.filter(c => c.locked).map(c => c.id), ['need'])`.
- "health rows in order progress 1, shipping 2, unconf 1, risk 0, late 1": `deepEqual` on `[key, count]` pairs, so both the order and the counts are checked.
- "quickActions('دور مجهول') = same as viewer": `deepEqual` against `quickActions('مشاهد')`.

## Test results
- `node --test tests/domain/dash-domain.test.mjs`: 13 tests, 13 pass, 0 fail.
- `npm test` (the whole suite): 25 tests, 25 pass, 0 fail. This includes `split.test.mjs`, so block 24 is still byte-identical to the prototype. The output has nothing besides the npm header and TAP lines.
- Mutation check (outside the repo: I made scratch copies of the block, changed one rule in each, and ran a copy of the test file against them). Each of these 6 mutations makes exactly 1 test fail:
  - `x >= d` → `x > d` (nextMonthDay "today counts")
  - swap orange and warning ranks (topNeed)
  - drop `!c.locked &&` (layout never hides need)
  - `<= r.to` → `< r.to` (countIn inclusive)
  - `min < 12*60` → `<=` (greeting at noon)
  - remove the stretch of the last card in a row (packRows)

## Expectations changed to match the code
None. I traced every value in the brief against `app/js/blocks/24-dash-domain.js` before running the tests, and they all held. For example, `RANK = { error: 0, orange: 1, warning: 2 }` with `?? 3` as the fallback gives the order e1, e2, o1, w1, n1. `Date.UTC(yy, mm, 0)` gives 28 for February 2026, so day 30 is clamped to 2026-02-28.

## Files changed
- `tests/domain/dash-domain.test.mjs` (new, 111 lines). Nothing else was changed, and the block was not edited.

## Self-review
- Every bullet has its own test with the bullet's exact name. There are no placeholder assertions, and every check compares against an exact value.
- Nothing was added beyond the brief, and the output is clean.
- The commit contains only the test file, with the message from Step 3 plus the session attribution lines.

## Concerns
None.
