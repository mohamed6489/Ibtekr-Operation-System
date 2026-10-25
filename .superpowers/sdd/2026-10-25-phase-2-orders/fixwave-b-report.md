# Fix wave B report — front end (whole-branch review)

Status: DONE_WITH_CONCERNS (the concerns are small; see the end). One commit on the worktree branch
`worktree-agent-aebca22507233a916`, fast-forwarded first from 9036dc4 to `main-gha10e` 322b222 (the plan's «موجة الإصلاح
الختامية»). Files: blocks 21, 25, 28 and 29, `adapter/orders.js`, `adapter/activity.js`, `tests/adapter/{activity,orders}.test.mjs`,
`tests/adapter/stub-supabase.mjs`, `tests/e2e/{orders,twofa,dashboard}.spec.mjs`, `tools/blocks.lock.json` (`npm run lock`).
`tests/split.test.mjs` is unchanged: 21/25/28/29 were already in `EDITED`. Nothing in `supabase/functions/**`,
`tests/functions/**`, `tools/deploy.md` or `.github/` was touched.

Tests: `npm test` 154/154 (152 before, plus 2 adapter tests). `npm run e2e` (mocked) 81/81 (77 before, plus 4).
Semgrep: the sandbox proxy blocks the registry packs (`semgrep.dev` 403, as recorded in Task 8), so CI is the gate for that.
Security self-review below.

## 1. Block 29: new Realtime orders are drawn (Important)
- `applyOrder` now works out `moved` *before* it replaces the order. `moved` is true when:
  - the order is new and matches the filters, or
  - `match()` gives a different answer for the old copy and the new one, or
  - the order matches and its sort key changed (`skey`: date for new/old, total for value, late flag plus age for late).
- `moved` → `full()`. Anything else → `redrawCard(id)` + `refreshCounts()`, as before.
- `full()` runs `draw(1)` + `refreshCounts()` at once, unless `listBusy()` is true. In that case it only sets `FULL` and refreshes
  the counts and chips (`#cn` follows at once).
- `listBusy()` is true when any of these holds:
  - a focused INPUT / TEXTAREA / SELECT is inside `#list`;
  - the date picker is open (`DP`);
  - the details popup is open (`DET`). Its subs tab is re-rendered by `draw()` through `DET.refresh`.
- `flush()` does the pending redraw once the list is free. It is called from:
  - the existing focusout handler, before the per-card `PEND` pass;
  - the details popup's `close()`. Removing a focused node fires no focusout.
- `draw()` resets `FULL` (alongside `PEND`). It also keeps unsaved comments:
  - Before `#list` is replaced, every `textarea[data-orig]` whose trimmed value differs from `data-orig` is remembered by its
    `data-ne` / `data-ce`.
  - After the redraw, the remembered text is put back, unless the new field already holds that text (a save sets `data-orig`).
    Its «حفظ» button is shown.
  - Effect on save and revert:
    - A save, and a refused save's revert (`wt` → undo → `draw()`), behave as before. The test «a network failure puts the old
      value back» still passes.
    - Escape on a sub-order comment used to rely on `draw(1)` throwing the text away. It now resets the field to `data-orig`
      first, so the old behaviour stays. New e2e case for this.
- `hydrate()` on a page that already has orders now goes through `full()` instead of a bare `draw()`. A reload (retry,
  «مزامنة», and the new Realtime reconnect reload of item 5) therefore never redraws over a field in use. The first hydrate is
  unchanged.
- `redrawCard` uses `cssEsc()` → `window.CSS.escape` (the block-local `CSS` is the style string).
- e2e `a new Realtime order (or one that leaves the filters) redraws the list, never over a field in use; unsaved comments
  survive` covers:
  - a new order → a 4th card, first in the list; `#cn` and the «الكل» chip become 4;
  - a focused textarea in another card → `#cn` 5 but no new card, the focus kept; on blur → the card appears, first;
  - a typed, unsaved comment survives four full redraws (a new order, a sort change, a card folded, a status chip), with
    «حفظ» visible;
  - an order that leaves the chip filter → its card goes and the counts follow;
  - saving writes exactly that comment, and nothing from Realtime is written back.

## 2. Block 21: the code screen (Important)
- Removed:
  - «افتكر الجهاز ده 30 يوم» (and the dead `ls.trusted` it set; nothing read it);
  - «ابعت الكود تاني» (a fake toast);
  - «استخدم كود احتياطي».
- Added:
  - the recovery text as a local `RECOVERY_2FA`, the same string block 18 uses (block 18 does not export its constant);
  - «رجوع لتسجيل الدخول» → `back2fa()`:
    - waits for `IBAuth.signOut('local')`, with `ls.busy` holding a sign-in meanwhile;
    - then shows the login view.
    - The SIGNED_OUT listener of block 28 stands down here, because `isLoggedOut()` is already true. Nothing reloads, and the
      directory is cleared by `IBAuth.signOut`.
- e2e (twofa) `the code screen: …` covers:
  - the recovery text is shown; the two buttons and any checkbox are absent;
  - the back link → `logoutScopes ['local']`, login view, `#root` hidden;
  - a reload → still the login view (the remembered aal1 session is gone);
  - the next sign-in asks for the code again.

## 3. Dashboard dates (Important)
- Block 28: `dashToday()` = `IBOrders.today()` (fallback K.TODAY, then the block's TODAY). It is used for:
  - the default `state.drange`;
  - the dashboard range picker's presets and calendar (`RangePicker` with target `dash`; it used `K.TODAY`);
  - `IBDashData.report` (`ordersReport` today, so dates = today − ageDays, the same today as the adapter's `age`).
- Block 28 also exposes `IBDashData.today()`, and `IBDashData.TODAY` is now a getter.
- `contracts` keeps `DTODAY` (K.TODAY): the contracts are sample data. So does `money()`'s month.
- Block 25: `today()` reads `IBDashData.today()`. It is used for the 30-day confirmation window and the greeting.
  `daysAgo` / `nextStatement` / contracts stay on K.TODAY, because they belong to the sample stores.
- No existing test assumed the prototype date: `dashboard.spec` and `tests/domain/*` were green unchanged.
- New e2e (in a `describe` with `timezoneId: 'UTC'` and `page.clock.setFixedTime(now)`, `now` being the moment the mock dates
  its orders). It re-dates 180686 to 31 days ago and 180656 to 29 days ago, then checks:
  - `IBOrders.today()` = `IBDashData.today()` = `.TODAY`;
  - the greeting shows that day;
  - the default range = today;
  - `report({from:d,to:d})` holds each order on its own placed date;
  - the rendered snapshot's confirmation window (`api.state.last.conf`) = 2 rows (`غير مؤكد` 1, `في انتظار الرد` 1).
- That last check fails on the old code: with 2026-10-20 − 29 the order falls outside the window. The clock is not moved off
  the real date, because the mock's JWTs carry Node's `iat`.

## 4. Activity allow-list (Important)
- `LOGGED_PREFIXES` = `['auth.', 'dashboard.', 'profile.2fa.']`.
- New `LOGGED_ACTIONS`, exported on `IBActivity` and matched by whole name = `order.status`, `order.confirm`, `order.patch`,
  `suborder.status`, `suborder.waybill`, `suborder.pulled`.
- Header comment updated.
- The test checks that the six are sent and that these are not: `order.consolidate`, `order.cancel`, `order.refund`,
  `order.edit`, `suborder.returnToStock`, `suborder.returnToVendor`, `suborder.autoconfirm`, `suborder.arrived`,
  `orders.export` and `order.status.extra`.

## 5. Orders adapter (Minor)
- (a) Reconnect reload. `subscribe()` passes a status callback.
  - `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` mark the channel lost. The next `SUBSCRIBED` runs `load()` once.
  - The first `SUBSCRIBED` does nothing.
  - A channel that `unsubscribe()` let go of is ignored (`channel !== mine`), so its own CLOSED never triggers a reload.
- (b) `notifySoon()`: Realtime refetches dispatch one `ib:notify` per burst, 250 ms after the first refetch.
  - It is a fixed window, not a sliding debounce, so a long bulk sync still notifies every 250 ms instead of never.
  - `load()` keeps its immediate notify.
  - `clear()` cancels a pending one.
  - With no `window.setTimeout` (a bare vm context), it fires at once.
- Stub: `subscribe(cb)` keeps `cb`, and a new `emitStatus(status)` plays a status to it.
- Tests:
  - burst → 3 `applyOrder`, one 250 ms timer, one `ib:notify`; a later change → a new timer, which `clear()` cancels;
  - first SUBSCRIBED → no load; after a drop → one load (with hydrate); a repeated SUBSCRIBED → none; another drop → one
    more; after unsubscribe → none.
- The «throwing hook» test now expects the notify timer as a third deferred callback.

## Security self-review
- No new HTML sink with outside data.
  - `restore()` writes `textarea.value`.
  - Selectors go through `CSS.escape`.
  - The code screen's new nodes are static text built with `h()`.
- The allow-list only narrows what reaches `activity_log`. Free-text cancel/refund reasons from block 22 no longer get there.
- The reconnect `load()` runs only with a client and a signed-in user. It reads the same named columns.

## Deviations / concerns
- **Busy rule for the full redraw.** Only a focused *field* in the list (or the date picker / details popup) holds the redraw.
  The per-card `cardBusy` rule (any focus, or an unsaved comment) would block it whenever a card button was last clicked, or a
  comment was left unsaved, so the new order would stay undrawn: the bug again. `draw()` keeps the unsaved comments instead.
  `redrawCard` keeps `cardBusy` unchanged.
- **Hydrate.** `hydrate()` on an already-hydrated page uses the same pending path (see 1). This was not in the brief, but it
  follows from the new reconnect reload.
- **Range picker.** It now uses the real today too, so presets match the default range.
- **CLAUDE.md is stale.** Its LOGGED_PREFIXES note still lists `order.` / `suborder.` as prefixes. CLAUDE.md was outside my
  file list; the controller should change it to the prefixes `auth.` / `dashboard.` / `profile.2fa.` plus `LOGGED_ACTIONS`
  (the six names).
- **Not covered by e2e.** The mock runs with `realtime: false`, so the reconnect reload and the debounce are covered by the
  adapter tests only.
