# Task 5 report: server alerts in the bell and in «محتاج منك دلوقتي» + e2e

Status: DONE_WITH_CONCERNS (one brief/code conflict in the test assertions, resolved by keeping the intent; see Concerns 1)
Commit: 686431f feat(dashboard): server alerts in the bell and the need card with per-user read state (base c6b1e14)

## What I implemented (per file)

- `app/js/blocks/28-app.js` (`viewSections`, +2 lines): after `NR.filterSections(raw, accFor(m), {})` and before `digestSection(m)`:
  `if (window.IBAlerts && (ntfState.viewer || window.IBKit.ME) === window.IBKit.ME) { const s = window.IBAlerts.section(); if (s) secs = [s].concat(secs); }`
  The section is prepended (so it is first in the nav and its items come first in `topNeed`). It never goes through `notifSections()` or `filterSections`, so digests (`digestSources()` → `notifSections()`) leave it out, and the `server.*` keys cannot drop or mute it. It is shown only when the bell viewer is the real signed-in member.
- `app/js/blocks/25-page-dashboard.js` (+3/−1):
  - `ib:notify` listener next to `ib:activity`, with the same guard (ruling 1):
    `document.addEventListener('ib:notify', () => { if (!document.querySelector('.scrim,.menu,[role=dialog]:not([hidden])')) render(); });`
  - 5-minute auto-refresh guard (ruling 2): `[role=dialog]` → `[role=dialog]:not([hidden])`. Nothing else on that line changed.
- `app/js/adapter/activity.js` (ruling 3): `refresh()` reads `read(25)` (was 5). `recent(limit = 5)` is unchanged. Header comment updated: newest 25, the card shows 5 after its own-actions filter.
- `tests/adapter/activity.test.mjs`: the `refresh()` query-chain pin is now `{ op: 'limit', args: [25] }` (test renamed "…refresh (newest 25)…"). The `recent(20)` check is kept.
- `tools/blocks.lock.json`: regenerated with `npm run lock` (25 and 28 were already in `EDITED`).
- `tests/e2e/supabase-mock.mjs`:
  - `COLUMNS.alerts` = `id, at, kind, title, body, role_id, user_id, entity, entity_id, read_at`; `COLUMNS.alert_reads` = `alert_id, user_id, read_at`. `select` is validated like the other tables.
  - `mock.alerts` = the brief's two seed rows (a fresh copy per test). `mock.alertReads = []`.
  - The `[]` stubs for `GET alerts` / `GET alert_reads` are gone. Both tables now go through the shared emulated branch, and the order/limit/select code is factored into `answer(rows)`, which activity_log uses too.
  - `GET alerts` returns rows where `u.status === 'active' && (user_id === u.id || role_id === u.role_id)`.
  - `GET alert_reads` returns the caller's own rows (eq filters honoured).
  - `POST alert_reads` takes a single object or an array:
    - any row with `user_id !== u.id`, or for an alert the caller cannot see → `401 {code:'42501'}` for the whole request;
    - a duplicate (already stored, or repeated inside the body) → `409 {code:'23505', message:'duplicate key value violates unique constraint "alert_reads_pkey"'}`, unless `Prefer` contains `resolution=ignore-duplicates`, in which case existing rows are skipped;
    - otherwise all rows are pushed → `201 []`.
    - The request is all-or-nothing. An `on_conflict` other than `alert_id,user_id` → `400 42P10`, kept strict like PostgREST.
- `tests/e2e/dashboard.spec.mjs`: helpers `bell`, `bellSection`, `bellItem`, `bellCount`, `alertsLoaded`, plus 8 new `mockOnly` cases:
  1. `the activity card finds her rows behind newer rows of others (newest 25 read)`: ruling 3. Seeds 2 ops rows and 6 newer admin rows; signed in as ops, the card shows 3 rows (her sign-in now + her 2 seeded rows, both «سارة أحمد») and no «صفوت كمال».
  2. `a role alert from the server reaches the bell and the need card`: the brief's case.
  3. `ops sees only alerts addressed to them`: the brief's case. Also checks the admin alert is not in her need card.
  4. `a mark the server refuses fails; one it already has (23505) counts as done`: drives the mock's 401 and 409 paths through the real supabase-js client.
  5. `mark all read from the section header`: the brief's case. Also checks exactly one `POST /rest/v1/alert_reads`, the need card redraw, and persistence across a reload.
  6. `an alert that arrives later redraws «محتاج منك دلوقتي», not under an open menu`: pins the `ib:notify` listener and its guard.
  7. `the dashboard redraws itself every 5 minutes while nothing is open`: pins ruling 2 with `page.clock`.
  8. `«عرض كـ» another member leaves my server alerts out`: pins the viewer condition.
  - "no page errors with realtime disabled" is covered implicitly: `afterEach` asserts `pageErrors` and `mock.unhandled` are empty in every case, and the mock's `IB_CONFIG.realtime` is `false`.

## TDD evidence

RED (mock emulation + new cases written, app unchanged):
`npx playwright test -c tests/playwright.config.mjs tests/e2e/dashboard.spec.mjs` → 5 failed, 12 passed:
```
✘ the activity card finds her rows behind newer rows of others (newest 25 read)
    Expected: 3  Received: 1        (> await expect(act.locator('.da-row')).toHaveCount(3))
✘ a role alert from the server reaches the bell and the need card
    Expected substring: "فشل مزامنة WooCommerce"  Received string: "محتاج منك دلوقتي… IB-168559 — Customer 32… عرض كل التنبيهات (106)"
✘ ops sees only alerts addressed to them
    Expected substring: "تجميع متأخر IB-1042"  Received string: "محتاج منك دلوقتي… عرض كل التنبيهات (43)"
✘ mark all read from the section header          (same: alert absent from the need card)
✘ «عرض كـ» another member leaves my server alerts out   (same: precondition, alert absent)
```
These failures are the expected ones: with no server section in `viewSections`, the alert reaches neither the bell nor `topNeed`, and `refresh()` reads only 5 rows, so her rows sit behind the admin's.
(My first RED run used the brief's literal `.notif-badge` = `'1'` and got `Received: "99+"`; see Concerns 1.)

Mutation checks after GREEN. Each mutation was applied alone, the covering cases were run, and the file was restored:
| mutation | caught by |
|---|---|
| `ib:notify` listener removed | `arrives later` ✘, `mark all read` ✘ |
| listener without its guard (`() => render()`) | `arrives later` ✘ (the open menu closes) |
| 5-minute guard back to `[role=dialog]` | `every 5 minutes` ✘ |
| viewer condition removed | `«عرض كـ» … leaves my server alerts out` ✘ |
| section appended instead of prepended | `reaches the bell and the need card` ✘ (drops out of the top 5) |
| mock 409 code ≠ 23505 | `refuses … 23505 counts as done` ✘ |
| `read(5)` in refresh | unit `refresh (newest 25)` + e2e `newest 25 read` ✘ (the RED above) |

GREEN:
- `npm test` → `# tests 52 # pass 52 # fail 0`
- `npm run e2e` → `Running 46 tests using 2 workers … 46 passed (44.3s)`. Before this task: 38. Output is pristine: no warnings, no stray lines.
- Flake check: the new cases with `--repeat-each 5 --workers 3` → `35 passed`.

## Files changed

app/js/blocks/28-app.js, app/js/blocks/25-page-dashboard.js, app/js/adapter/activity.js, tests/adapter/activity.test.mjs, tests/e2e/dashboard.spec.mjs, tests/e2e/supabase-mock.mjs, tools/blocks.lock.json

## Self-review

- The section is prepended after the role filter, outside `notifSections()`, and only when `(ntfState.viewer || ME) === ME` ✔. The digest path is untouched ✔.
- Badge and nav counts come from `received` (`IBAlerts.unread()`). The total drops by exactly 1 when the alert is read ✔.
- «تعليم الكل كمقروء» sends one POST and persists across a reload («النظام» shows 0, the item is `muted`) ✔.
- The need card shows the unread error alert at the top and drops it once read, both after navigating back and after a reload ✔.
- Ops sees only her alert ✔.
- Both listeners use the `:not([hidden])` guard ✔. The 5-minute guard is fixed ✔. `recent(25)` is pinned in the unit test ✔.
- Every e2e case of the brief is present ✔. The lock is regenerated, and the split test passes ✔.
- Block diff: 28 +2 lines, 25 +2/±1 line, no other block lines touched ✔.
- Style matches: one-line prototype style, short English comments ✔.

## Concerns

1. **Brief/code conflict on the badge (assertions adapted, not the code).** The brief expects `.notif-badge` to read `'1'`, then be hidden after reading, and still hidden after a reload. On this app the badge totals every section, and the prototype's sample sections (customers, suppliers, delivery, …) still count for every member: the admin's badge reads «99+» (106 items in the need card's «عرض كل التنبيهات»). Those literal assertions cannot hold without hiding the sample sections, which no decision covers. I kept the intent. `bellCount` reads the uncapped total from the bell button's `aria-label` («الإشعارات — N تنبيه»), and the tests assert that the «النظام» count is `1`, that the bell total drops by exactly one once the alert is read, and that it stays dropped after a reload. If the controller wants the literal brief assertions, the sample sections would have to be emptied for signed-in members, which is a product decision for another task.
2. After a reload, the open bell does not redraw when `IBAlerts.load()` answers: block 28's `ib:notify` only refreshes the badge. So the tests wait with `alertsLoaded` (`IBAlerts.section() !== null`) before opening the bell. In the product, a bell opened in the first ~100 ms after sign-in shows no «النظام» section until it is reopened. This is prototype behaviour, and the decisions do not touch it.
3. The ruling 3 e2e case expects 3 rows, not 2. The ruling says "her 2 rows"; the case seeds her 2 rows, and her sign-in adds a third (the same as the existing non-admin case). It asserts both seeded rows by text and that «صفوت كمال» is absent.
4. Extra cases beyond the brief (4, 6, 7, 8 above) pin rulings 1–2 and the viewer condition. Without them, removing the `ib:notify` listener on first load is masked by the sign-in's `ib:activity` redraw.
5. Semgrep is not installed in this sandbox. It is a pre-push step (rule 8), and nothing was pushed.
