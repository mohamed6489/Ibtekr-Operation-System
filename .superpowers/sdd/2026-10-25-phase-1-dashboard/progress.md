# SDD ledger — plan: docs/superpowers/plans/2026-10-25-phase-1-dashboard.md

Spec: docs/superpowers/specs/2026-10-22-ibtekr-operation-system-design.md (read; binding authority) + phase-0 ledger carried musts.
Branch: main-gha10e (cloud session), fast-forwarded to main after each pushed task (owner's standing permission). BASE before Task 1: 332f2e6.

## Pre-flight conflict scan (2026-10-25)

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 ↔ T3 | T1 tables `user_prefs(user_id,key,data)`, `alert_reads(alert_id,user_id)`, `alerts` columns, `activity_log` + FK `actor → profiles` (0002) | T3 selects/embeds (`actor:profiles(name)`) match; FK exists so the PostgREST embed resolves. Consistent. |
| T1 ↔ T5 (mock) | RLS: alerts visible by `user_id`/`role_id` + active; `alert_reads` insert only for a visible alert | Mock semantics in T4/T5 mirror these. Consistent. |
| T3 ↔ T4 | `IBPrefs.set/remove → {ok}`, `IBActivity.cached() → Row[]`, `IBDirectory.clear()` from `IBAuth.signOut()` | Block 25/21 edits consume the same names; reload happens after `IBAuth.signOut('local')`. Consistent. |
| T3 ↔ T5 | `IBAlerts.section()` shape vs block 28 bell (`received`, `tabs[0][2]`, `icon/label/unit/all/allLabel/empty`, items `key/title/sub/meta/tone/icon/muted/run`) and block 24 `topNeed` (`muted`, `tone`, `s.label`) | Same shape as the prototype sections; `digestSources()` iterates `notifSections()` so the server section never enters digests. Consistent. |
| T3 ↔ existing e2e | `IBDirectory.load()` now also loads prefs/alerts/activity at sign-in | Mock returns 404 → `mock.unhandled` would fail auth.spec; T3 Step 4 mandates the empty-array stubs + `realtime:false`. Consistent. |
| T4 ↔ auth.spec (logout/idle/two tabs) | Reload after sign-out | After reload with no stored session supabase-js makes no request (`afterLogout` stays 0); `expired` view restored from `sessionStorage['ib.loginView']`; tab B unaffected. Consistent; T4 Step 4 allows minimal test adjustments. |
| T4 ↔ T5 | Both edit blocks 25/28 and the lock | Sequential tasks; each runs `npm run lock`. Consistent. |
| T2 self-consistency | Expected values vs block 24 code | Every assertion re-derived by hand from 24-dash-domain.js (layout, topNeed order e1,e2,o1,w1,n1, health 4 open / shipping 2 / pct 0.5, nextMonthDay incl. 2027-01-05 and Feb clamp, packRows stretch). Consistent. |
| T1 self-consistency | Test cases vs policies | with-check violations surface as 42501; `updated_at >= now()` holds inside one transaction; no DELETE anywhere (MCP constraint). Consistent. |
| T4 e2e selectors | `.dash-kpis .kpi` (KpiTile root is `card kpi`), `[data-card=…]`, `#dash-viewas`, `.dash-hi` verified in blocks 10/25; `getByLabel('الفريق دلوقتي')` depends on `K.Switch` markup | Not a defect: the implementer verifies the Switch selector (fallback: `#dc-team`). |
| Global constraint "no DELETE/DROP for the MCP" | T1 migration uses `alter policy`; tests use no delete | Consistent. |

Ruling: all implementer/reviewer subagents run on `opus` — why: the owner requires the strongest model for every phase (memory: strongest-model-always); same ruling as phase 0 — cost if wrong: token spend only.
Ruling: this plan's workspace text artifacts (progress.md, briefs, reports) are committed with `git add -f`; review packages (*.diff) stay ignored — why: the ledger is the recovery map across cloud sessions (phase-0 ruling) — cost if wrong: small text files in history.
Ruling: execution starts without a plan-review pause — why: the owner said «ابدأ المرحلة 1», chose subagent-driven execution in phase 0, and the plan is pushed to main-gha10e/main so they can read or stop it at any time — cost if wrong: rework of whatever they would have changed in the plan.
Task 1: implementer DONE_WITH_CONCERNS, commit f964713 (base dfeffaa). Concerns: (1) the word 'delete' appears in 0006 only as 'on delete cascade' ×3 and 'grant … delete' (same as 0001/0002/0004, applied live in phase 0) — to check at live apply; (2) alert_reads_select has no active-profile check (brief text) — left for review. Test extras: suspended prefs row, forged updated_at, bad key 23514, alert_reads update 42501, suspended cs cannot mark read.
