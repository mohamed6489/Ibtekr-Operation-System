# Fix wave B follow-up report — I1 + M1 (block 29)

Status: DONE. One fix commit `ae7b687` on the worktree branch `worktree-agent-acf81a584bdba715d`. The branch was
fast-forwarded first from 9036dc4 to `main-gha10e` 468a161 (fix wave B = 91573a8). Files:
- `app/js/blocks/29-orders-app.js`;
- `tests/e2e/orders.spec.mjs`;
- `tools/blocks.lock.json` (`npm run lock`);
- one line in `docs/superpowers/plans/2026-10-25-phase-2-orders.md`.

`tests/split.test.mjs` is unchanged, because 29 was already in `EDITED`. M2, M3, M4 and M5 were not touched (deferred by decision).

Tests:
- `npm test`: 156/156.
- `node --test tests/split.test.mjs`: 5/5.
- `npm run e2e` (mocked): 83/83 (81 before, plus 2).

The e2e ran against an `http-server` started from this worktree on :4173. `reuseExistingServer` would otherwise reuse any
server on that port. A `cmp` confirmed that the served block 29 was the worktree's own file.

Semgrep: the sandbox proxy blocks `semgrep.dev` (403), same as in Task 8 and wave B. The gate also excludes `app/js/blocks`.

## The cause (from the review)
- The held full redraw (`FULL`) was flushed on the focusout of the field, in `setTimeout(0)`.
- That focusout fires on the mousedown of the next click. So the timer runs between mousedown and mouseup.
- Chromium focuses the pressed button. A BUTTON does not make `listBusy()` true, so `draw(1)` replaced the button under the
  pointer and the click was lost: no write, no toast, the draft still there.
- Playwright's default 0 ms click hides this.
- M1: the date picker closed by an outside click (`dpClose(0)` in the capture handler) flushed nothing, so `#cn` said 4
  while 3 cards were drawn.

## What changed in block 29
1. **focusout:** no flush when `e.relatedTarget` is inside `#list`. The focus has moved to a control of the list, so the list
   waits for that control's click. The per-card `PEND` pass still runs: `cardBusy` already holds the card that has the focus.
2. **The delegated click handler:** its first statement is `setTimeout(flush,0)`, so every click flushes after its handler
   ran, whatever branch returns. Branches that draw anyway (save, fold, page…) make it a no-op.
3. **`dpClose`:** `setTimeout(flush,0)`. This fixes M1. When `dpClose` is called inside `dpOpen`, `mpOpen` or `fbOpen`, the
   flush still sees the new `DP` / `MP` (busy), or there is nothing to hold.
4. **`listBusy()`:** two more conditions.
   - `MP`: the «more» menu is open. Otherwise the list was redrawn under an open menu, `MP.btn` was detached and the menu ended
     up beside another card. `mpClose` flushes (`setTimeout(flush,0)`), as the reviewer suggested.
   - `PRESS`: a primary mouse/pen/touch press is under way. `pointerdown` (capture, on the shadow root) sets it;
     `pointerup` / `pointercancel` on `document` (capture) clear it. Pointer events precede the click, so the click's flush
     sees `PRESS` false again.
5. Comments above `listBusy` / `flush` / the focusout handler now say the rule.

No HTML template was added or changed, and no new value reaches HTML. The busy rule stays the field rule. `cardBusy` is
unchanged and still used by `redrawCard` only.

## Plan line
One sub-bullet under the block 29 item of «موجة الإصلاح الختامية»: the held full redraw is flushed after a click on the list
or when the date picker / «المزيد» menu closes. It never runs on a focusout into the list, or while the mouse is still pressed.

## Test first
New e2e cases in `orders.spec.mjs`, next to the «new Realtime order» case, with a module-level `arrive(page, id)` (the same
order shape as that case):
- **`a held full redraw never replaces the control being pressed: …`**
  - A comment is typed and still focused when a new order arrives: held. «حفظ» with `click({ delay: 50 })` → the patch is
    written, the toast shows, 4 cards with the new one first, «حفظ» hidden.
  - The fold button pressed in a browser that does not focus a pressed button: a one-shot mousedown listener does
    `preventDefault()` and `blur()`, so the field loses focus to nothing (relatedTarget null). Then `click({ delay: 50 })` →
    the card opens and the new order is drawn.
  - The keyboard: Tab from the comment to its «حفظ» → still held, focus on «حفظ». Enter → saved, then drawn.
- **`the date picker and the «more» menu hold a full redraw; closing them draws the list`**
  - The picker is open when an order arrives. A click inside it (next month) keeps it open and held. A click on the page title
    closes it → 4 cards (M1).
  - The «more» menu is open when an order arrives → held (`#cn` 5, 4 cards). Escape → 5 cards, the new one first.
  - Nothing is written.

Seen failing before the fix, for the right reasons:
- Before any change:
  - case 1 failed at the toast after the 50 ms «حفظ» press (empty; `mock.patches` = []);
  - case 2 failed at 3 cards after the picker was closed from outside.
- After the reviewer's three changes only (relatedTarget, click flush, `dpClose` flush):
  - the «حفظ» press and the picker steps passed;
  - the press that does not focus the button still lost the fold click (`aria-label` stayed «فتح»);
  - the open menu was still drawn under (5 cards where 4 were expected).
  - So `PRESS` and `MP` are each needed.
- With everything except the relatedTarget rule: the Tab to «حفظ» redrew the list at once (6 cards where 5 were expected). So
  that rule is needed for the keyboard.
- The reviewer's probes (`scratchpad/pw/probe.spec.mjs`, `probe2.spec.mjs`) now show:
  - the 30 ms and 100 ms saves written, 4 cards;
  - the fold toggled («فتح» → «طي»);
  - the picker closed with `#cn` 4 and 4 cards.

## Decisions I took on my own
- **`PRESS` (the press itself holds the redraw).** The reviewer's fix relies on `relatedTarget`.
  - Safari, and Firefox on macOS, do not focus a pressed button. The field just blurs (relatedTarget null), so the flush would
    still run between mousedown and mouseup there.
  - Holding while a press is under way covers those browsers. It also closes the small window where a Realtime `full()`
    arrives mid-press.
  - It only applies to a primary press (`isPrimary && button===0`), so a right-click context menu that swallows the release
    does not leave it set. Any later press clears it.
  - There is no flush on `pointerup`. For touch, the click comes after `pointerup`, so a flush there could redraw before the
    tap is hit-tested. The click flush is enough.
  - Even in the worst case, a press released without a click, the held redraw only waits for the next click, focusout or
    popup close.
- **`MP` counts as busy, and `mpClose` flushes.** The reviewer offered this as optional. I took it so the menu never floats
  beside the wrong card.
- **Escape on the «more» menu while a redraw is held.** The redraw runs on close and replaces the re-focused `[data-more]`
  button, so focus drops to body. The old code did the same: it had redrawn already, so `MP.btn.focus()` hit a detached
  button. This is M5 (deferred), not a regression.

## Seen, not fixed (outside I1/M1)
- **The date picker's blur-commit eats a slow click on a list button, with or without Realtime.**
  - When the date field is focused (picker open) and the next press is on another list button, the picker's focusout handler
    commits (`dpSet` → `draw(1)`) in `setTimeout(0)`, between mousedown and mouseup.
  - Probe `scratchpad/pw/probe4.spec.mjs`: the fold button toggles at 0 ms and does nothing at 50 ms. This is the same on the
    base block 29 (468a161, checked by putting it back temporarily), so it predates wave B.
  - A follow-up could defer that commit until after the click, the same way.
- **The per-card path in Safari.** A card held in `PEND` (its field focused when its own Realtime change came) and no draft can
  be redrawn by `redrawCard` when a button of that same card is pressed in a browser that does not focus buttons. In that
  case `cardBusy` sees no focus and no draft.
  - Chromium is fine (the pressed button has the focus).
  - Left as is: `cardBusy` was out of scope.
