# Task 6 report: the orders page (block 29) on real data

**Status:** DONE_WITH_CONCERNS
**Commit:** `920da13` on `main-gha10e` (base `11d8e09`). Message as in Step 5. The trailer is `Co-Authored-By: Claude Opus 5.5`, from this session's system attribution and the same as the earlier implementer commit `a7a3142`. The brief asked for "Claude Fable 5.1".
**Files changed:** `app/js/blocks/29-orders-app.js`, `app/js/blocks/11-seed-product-images.js`, `tests/split.test.mjs` (`EDITED` plus the test name and comment), `tools/blocks.lock.json` (from `npm run lock`), `tests/e2e/orders.spec.mjs` (new). I did not touch the mock or any other file. This report is not committed; the controller adds it with `-f`.

## What was done

- **Data source.** Removed:
  - the `RAW` and `RS` seeds;
  - the seed parser and the code maps it used (`SM`, `CM`);
  - `opsLink()` and the readyAt IIFE that faked "ready to ship" stamps (see concern 3).

  `O`, `OM` and `V` now start empty, with a flag `HYD` (hydrated at least once). New functions:
  - `hydrate(d)` (line 64): copies the order list from `d.orders`, rebuilds `OM`, sets `V` from `d.vendors` (unique and sorted with the block's comparator), and sets `IMG` from `d.images` or `{}`. On the first hydrate it opens the two newest cards, as the prototype did, then calls `draw()`.
  - `applyOrder(o)` (line 67): replaces the order by id or adds it first, updates `OM`, adds any new maker names to `V`, then calls `draw(1)`.
  - Both are on `window.OrdersApp` (line 596). No other new globals: everything else stays inside the block's IIFE.
  - At mount (line 594) the page hydrates from `IBOrders.data()` if the load already finished; otherwise it calls `draw()`.
- **Images.** `imgUrl(sku)` (line 58) reads `IMG[sku]`, then `window.IB_PRODUCT_IMG[sku]`. Only URLs starting with `https:`, `http:` or `data:image/` are used; anything else gives no image. `thumbHtml(sku)` (line 59) escapes the URL in the attribute. `OrdersApp.thumb` uses `imgUrl`.
- **Empty and load states.** `emptyMsg()` (line 220):
  - before the first hydrate, it follows `IBOrders.state()`: «بيحمّل الأوردرات…» for idle or loading; for error, «معرفناش نحمّل الأوردرات — جرّب تاني» plus an «إعادة المحاولة» button that calls `IBOrders.load()` (handler at line 487);
  - once hydrated with no orders: «مافيش أوردرات في آخر 12 شهر».

  The `ib:orders` listener (line 593) redraws these states. When `clear()` runs on sign-out (state `idle` and `data()` null after a hydrate), it also drops `O`, `OM`, `V`, `IMG` and `S.open`. `OrdersApp.query`, `alerts` and the others work on an empty `O` (tested).
- **Write-through** (lines 249–266). Each write point takes a snapshot, makes the prototype's local change, then compares and writes:
  - `ordW(o, b)`:
    - a status change goes to `setOrderStatus(id, st, {cancel?, ret?})`, which the adapter pushes to the site;
    - confirmation or date changes go to `setConfirm(id, cf|null, {confAt})`;
    - note, city, address and deposit go to `patchOrder(id, {...})`. A cleared deposit is sent as `dep: 0`.
  - `subW(s, b)`: status, date, comment, `readyAt`, `ret` and `store` go to `setItemStatus(itemId, ss|null, {...})`. A waybill cleared by `shipReady` goes to `setWaybill(itemId, null)`. A `pulled` change goes to `setPulled`. Line writes are never pushed.
  - `wt(p, undo)`: on `{ok:false}` it calls `undo`, redraws with `draw()`, and toasts «مش من صلاحياتك» for `forbidden` or «معرفناش نحفظ — جرّب تاني» otherwise.
  - `rv(...)`: the undo puts the old values back only if the object still holds the written values, and each field group is undone separately.
  - If there is no store, the local change stays and nothing crashes.
  - Date stamps use `IBOrders.today()` when the adapter is there, else `K.TODAY`: `readyAt` (line 238) and `confAt` (line 241).
  - The existing `IbtekrApp.logEvent` calls are unchanged.
- **«مزامنة»** (line 485). Calls `syncNow()`. It toasts «بنزامن مع الموقع…», then «تمت المزامنة · N أوردر · N منتج · N مبتكر». The counts are read from `counts.<part>.<part>` (the real woo-sync shape) or `counts.<part>.upserted` (the mock). On failure it toasts «مش من صلاحياتك» or «معرفناش نعمل مزامنة — جرّب تاني». The button label is now «مزامنة مع الموقع» instead of «مزامنة مع Airtable».
- **Seeds and demo text.** Block 11 is now `window.IB_PRODUCT_IMG = {};` only. Removed the header note «نفس بيانات Airtable بعرض أوضح · آخر مزامنة قبل 3 دقائق» and every «(تجريبي…)» toast:
  - edit order (line 390) and details (line 412) now say «تم حفظ … تعديل» or «تم حفظ التعديلات»;
  - edit sub (line 451) says «تم حفظ … تعديل»;
  - the comment saves (lines 481, 482) say «تم حفظ التعليق»;
  - delete (line 470) says «اتشال من القايمة · السبب: …»;
  - the sync toast is replaced as above.
  - `DEL_REASONS` still has the delete reason «أوردر تجريبي» ("test order"). That is a real reason, not demo wording.
- **Changes needed so the edit dialogs work on real data** (fields are unchanged):
  - The site's payment title is kept as the selected option. Otherwise saving would quietly turn it into `C`.
  - A phone that was not edited is not re-validated (line 371). This includes a masked one; otherwise every save fails for a role that sees the masked phone.
  - In the sub edit dialog, a line with no maker keeps its empty maker option (line 431).
- **Unchanged:** filters, sorting, card and dialog layout, `late`/`risk`, `OPEN`, the shadow DOM, block 22.

## Escaped sinks (line numbers in the committed file)

The block has 20 `innerHTML` sinks: lines 6, 206, 210, 212, 213, 214, 216, 227, 232, 287, 323, 347, 380, 398, 402 (×2), 421, 425, 454, 536, 543. Every site or user string that reaches them goes through `esc()`. `esc()` already escaped `& < > "`, and every attribute in the block is double-quoted.

**Newly escaped by this task:**
- `opts()` option text (line 93): maker names in `#fv` (line 212), confirmation and status lists.
- `sdd()` status label (line 96): `o.st` and `s.ss` come from the database.
- `dfield()` `value=` (line 97): confirmation date and line date.
- `o.cf` label in the desktop header and the tablet/mobile confirmation section (lines 106, 157).
- Phone text in the band and the customer section (lines 118, 165). The `tel:` and `wa.me` links are drawn only for an 8–15 digit number (`dial()`, line 60), so a masked phone gets no link.
- Payment title `esc(payName(o))` (lines 119, 166).
- Product image `src` through `thumbHtml` (lines 130, 177).
- Edit dialog extra payment option (line 361) and maker option (line 431).

**Already escaped in the prototype, checked:**
- `o.name` (band 117, `titleBlock` 147, `custSec` 164, `orderInfoHtml`, edit sub, details title 398);
- `o.note` (`notes` 121–123, `notesM` 168–172, `orderInfoHtml`);
- `s.prod`, `s.sku` (`subrow` 130, `subcard` 178);
- `s.vendor` (`vcell` 268, `subcard` chip and title, edit sub);
- `s.cm` (`subrow` and `subcard` `data-orig` and textarea);
- `orderInfoHtml` lines 356–369, edit sub 422–436, delete label 454;
- the filter dialog: `fbRow` enum options and input value (316–321), `fbRender` AI text and message (323);
- `confirmUnsaved` (347), `consBar` zone (270).

**Never rendered by block 29:** `o.city`, `o.addr`, `cancel`, `ret`. They only reach `OrdersApp.get`, `query` and `alerts` as data. The search text is written back only through `.value` (lines 590–591), which is safe.

**Left raw (block constants or numbers):** ids, `sid`, quantities, money, `STC`/`ST`/`SS`/`CF`/`PAYN` labels, `ic()`, `dt(o.date)` (built by the adapter as `YYYY-MM-DD`). There is no `eval`, `new Function` or `javascript:`.

## Hooked write points (line numbers)

| Write point | Line | Store call |
|---|---|---|
| `orderStatus`: plain path, and the cancel/refund reason popup | 273–274 | `setOrderStatus` (+ cancel/ret) |
| `subStatus`: arrival popup, return popup, plain path (with `shipReady` `readyAt` and waybill reset) | 275–278 | `setItemStatus` (+store / ret / readyAt), `setWaybill(null)` |
| `setCf`: lines it auto-confirms or unconfirms | 242 | `setItemStatus` per line |
| `data-cf` change (confirmation) | 494 | `setConfirm` (+ confirm_at stamped today when the date is empty) |
| `data-dep` change (deposit) | 498 | `patchOrder({dep})` |
| `data-ns` order note save | 481 | `patchOrder({note})` |
| `data-cs` line comment save | 482 | `setItemStatus(null, {cm})` |
| Date picker set (`dpSet`), clear (`data-dx`), and the dead `data-cd`/`data-ex` handlers | 548, 555, 495, 497 | `setConfirm({confAt})` / `setItemStatus({exp})` |
| Edit order and details "info" save (`applyOrderInfo`) | 370–376 | status / confirmation / date / deposit / note |
| Details popup «ليس الآن» (`discard`), which puts the lines back | 413 | `setItemStatus` |
| Edit sub save | 449–451 | `setItemStatus` (status / date / comment) |
| `OrdersApp.patch` (data import, waybill dialog city/address) | 596 | `ordW` |
| `OrdersApp.patchSub` (data import) | 596 | `subW` |
| `OrdersApp.waybill` | 596 | `setWaybill` |
| `window.OrdersSetSub` (inventory page) | 279 | `setItemStatus` |
| «سحب من المتاح» | none in block 29 | `subW` writes `setPulled` if anything sets `pulled`. Only `opsLink` did, and it is removed (concern 2). |

## Tests: RED and GREEN

- **RED** (spec written before the block change): `npx playwright test orders.spec.mjs` → **14 failed**. The page still drew 10 seed cards and had no hydrate, states or write-through.
- **GREEN:**
  - `npm test`: **141/141 pass**. This includes `split.test.mjs` with `EDITED = 11, 14, 21, 25, 28, 29` and the regenerated lock.
  - `npm run e2e`: **63 passed (1.2m)**. That is the 47 existing tests (dashboard, auth, login) plus 16 new ones.
- **The 16 new cases in `tests/e2e/orders.spec.mjs`.** All are mock only (`test.skip(LIVE)`). They assert `pageErrors` and `mock.unhandled` are empty.
  1. Real orders and no seed: 3 cards and `#cn` = 3; «سلوى زيتوني» shown; full phone «0120 000 7052» with a `wa.me/201200007052` link; the site's payment title; no «Customer 48», no IB-150001, no «Airtable»; `get('180492')` is null; `vendors()` lists only the makers with loaded lines; the removed line of 180686 is not shown.
  2. HTML customer name is inert: shown literally in the band, the search box value and the details title; no `img[src=x]`; `window.__xss` is undefined.
  3. Every site string renders as text: name, phone, payment, note, city, address, `st`, `cf`, product, SKU, maker, comment, `ss` and date set to `"><img src=x onerror=…>` and hydrated. Checked on desktop, tablet (800) and mobile (375) cards, the maker filter options, the edit order, edit sub and details (lines tab) dialogs, and an unsafe image URL.
  4. A status change writes and pushes: `mock.patches == [{table:'orders', id:180656, status:'جاري التنفيذ'}]` and `mock.pushes == [{action:'push_status', order_id:180656, status, result:'ok'}]`.
  5. «تم RTC» is patched; the push answers `skipped` with `no_woo_status`; `woo_status` is unchanged.
  6. A forbidden status change (accounts user) reverts: toast «مش من صلاحياتك», the select and label back to «معلّق», no patches, no pushes.
  7. Masked phone for the accounts user: «012••••7052», no full number, no WhatsApp link.
  8. A line status is written to its line only: `[{table:'order_items', id:5001, status:'مؤكد'}]`, no pushes, no `/functions/` requests.
  9. Product image from `products`: `src` equals the mock's `image_url` for 5001 and 5002; the box icon for a product with no image; `thumb()`; a `javascript:` URL gives no image.
  10. Confirmation, deposit and note:
      - `{confirm, confirm_at: today}` plus the auto-confirmed line 5001;
      - `{deposit:500}`, then `{deposit:0}` when cleared;
      - `{note}`;
      - with `ordersDown`, «معرفناش نحفظ — جرّب تاني» and the textarea back to the saved note.
  11. Line comment, date (`expected_at '2026-10-20'`) and waybill patches.
  12. «مزامنة» as admin: `syncs == [{action:'all'}]` and the toast with the counts.
  13. «مزامنة» as ops (not admin): «مش من صلاحياتك».
  14. Before load: signed out, «بيحمّل الأوردرات…» with `data()` null and `query`/`alerts` empty. Then with `ordersDown`: the error text plus the retry button, and retry gives 3 cards.
  15. Empty 12-month window: «مافيش أوردرات في آخر 12 شهر», `#cn` = 0, state `ready`.
  16. `IBOrders.clear()` leaves no order, maker or image on the page.
- **semgrep** with the local OSS rules (registry blocked by the proxy): 394 rules on the spec, `split.test.mjs` and block 11 → 0 findings. On block 29: 36 findings, all the same kinds the base file already had (37 there): the `innerHTML`/`insecure-document-method` pairs on the 17 template sinks listed above, the prototype's `IBOrdersOps[…]()` call (line 295) and `old[k]=` in `OrdersApp.patch`/`patchSub` (line 596). No new kind.
- **Manual check** (scratchpad, not committed): the inventory and consolidation pages render with no page errors now that `opsLink` is gone.

## Self-review

- **Completeness:** every write point in the brief is hooked, plus the ones I found: `patchSub`, `OrdersSetSub`, details discard, the date picker set/clear, and the dead `data-cd`/`data-ex` handlers. Every sink is escaped. The seeds, seed maps, opsLink and demo stamps are gone. All the empty and load states are drawn. The lock is updated.
- **Quality:** the edits are surgical, applied by a script that checked each match count. Names are unchanged and the file was not reformatted. It went from 774 lines to 599, almost all of that the seeds.
- **Discipline:** only the five allowed files changed, the mock was not edited, and the only new public functions are `hydrate`/`applyOrder` on `OrdersApp`. No PII in toasts or logs.
- **Testing:** the e2e asserts the mock's recorded writes and the DOM. The full suites are green.

## Concerns

1. **Edits with no store method stay local and are lost on reload.** There is no adapter method or grant for these, so they are not saved:
   - customer name, phone and payment method in «تعديل الأوردر» (0007 grants none of them; they come from the site);
   - maker, quantity and total of a line in «تعديل الأوردر الفرعي»;
   - «مسح» of an order or line (the no-DELETE rule). The toast now says «اتشال من القايمة · السبب: …».

   This needs a ruling: make these fields read-only or hide «مسح» in a later task.
2. **No «سحب من المتاح» write point is left in block 29.** Only `opsLink` set `pulled`, and it used demo stock. `subW` writes `setPulled` if anything sets `pulled` later; `setPulled` has no UI caller until phase 5.
3. **`opsLink()` and the readyAt IIFE are removed.** They wrote demo line statuses, `pulled` and maker «مخزن ابتكر» onto the first real multi-maker orders. As a result, block 14's demo `K.store.consolidations` are no longer linked:
   - entry 0 keeps `order: '180662'`. If the real 12-month window holds order 180662, it gets a demo consolidation bar and «شحن كامل من المخزن»;
   - entries 1 and 2 have `order: ''`, so the inventory page shows empty «IB-» rows;
   - this is block 14 / phase 5's to clear.
4. **Sign-in waits about 7 s when the orders tables answer 503.** postgrest-js retries a GET on 503 three times (1 + 2 + 4 s), and sign-in awaits the orders load. Test 14 has to use a 20 s timeout because of this. This feeds the T9 / phase-10 lazy-load note.
5. **The push result is not shown.** `setOrderStatus` returning `push: 'error'` means the status is saved but WooCommerce was not updated, and the page says nothing about it. No UI text was decided for this.
6. **Realtime replaces the order object** (`applyOrder`). An open details dialog for that order keeps editing the old object until it is reopened. Also, `draw(1)` (as the brief says) leaves the status chip counts stale until the next full draw.
7. **One database column holds the confirmation date.** `cdate` and `confAt` are both `confirm_at`. Confirming an order whose date is empty writes today's date. A date the user typed is kept.
8. **«مزامنة» does not reload the orders.** After a sync the page relies on Realtime or the next load.

---

## Fix report (review of 920da13): commit `32e003d`

**Status:** DONE. One new commit on `main-gha10e`, on top of the coordinator's `3295e47` and `e8ad867`; nothing was amended. Line numbers below are from `app/js/blocks/29-orders-app.js` at `32e003d` (589 lines).

**Files changed:**
- `app/js/blocks/29-orders-app.js` and `tools/blocks.lock.json` (from `npm run lock`);
- `app/js/adapter/orders.js` and `tests/adapter/orders.test.mjs` (item 7 only);
- `tests/e2e/orders.spec.mjs`;
- `tests/e2e/supabase-mock.mjs` (item 9).

Block 11 and `tests/split.test.mjs` needed no change.

**Trailer:** `Co-Authored-By: Claude Opus 5.5`, from this session's system attribution, again. The brief asked for Fable 5.1.

| # | Item | What changed (line) | e2e |
|---|---|---|---|
| 1 | Details popup tab switch | Leaving the info tab only stores the form's enabled fields in `stash` (`formVals` 409; click switch 428, arrow-key switch 426). Nothing is applied locally and nothing is written. `render` (411) puts the stashed values back into the info tab. `save` (418) applies `applyOrderInfo(w, o, stash)` from either tab; if the stashed values are invalid it switches to the info tab to show the error. «ليس الآن» (`discard`, 422) and close drop the stash. `applyOrderInfo(w, o, vals)` (378) reads `vals` or the enabled fields only. | «details popup: a tab switch keeps the typed info without writing it…»: type, switch tabs, the value is still there but not applied; «ليس الآن» → no `mock.patches` and the card note is unchanged. A later write proves nothing was sent before it. Saving from the lines tab writes `{note}`. |
| 2 | Realtime redraw per card, never over typing | `applyOrder` (69) updates `O`/`OM`/`V`, then calls `redrawCard(id)` and `refreshCounts()`. Before the first hydrate it does a full `draw()`. `redrawCard` (75) replaces only that card in place, or does nothing if the card is not on the current page. If `cardBusy` (74) finds a focused field, the open date picker, or a `[data-orig]` comment that differs from its saved text, the card waits in `PEND` (73). The waiting card is drawn on focusout (560) once it is no longer busy, or by the full `draw` that a save or revert already does (`draw` resets `PEND`, 232). `refreshCounts` (77) updates `#cn`, the chips (`drawChips` split out of `drawFilters`, 218) and the `#fv` maker options (left alone while focused). | «a Realtime order redraws its own card only…»: typing in another card survives three updates and keeps focus; the changed card shows the new status; chips 1/1 and `#cn` = 3; a new maker appears in `#fv`. A focused card is drawn only on blur. A card with an unsaved comment is still not drawn after blur; the save draws it. Only the note is written. |
| 3 | WooCommerce-owned fields are read-only | `woo()` hint (62). Order form: name, phone and payment are `disabled` inputs with «بيتعدّل من WooCommerce», not validated or applied; focus opens on the status field. Line form: maker, quantity and total `disabled` with the same hint (440, 442), no qty/total validation, not applied. The lead text now reads «بيانات العميل بتتعدّل من WooCommerce.» (438). `subSnap` and `discard` cover only status, date and comment. «مسح» is gone from the menu (296), with `mpAct`'s `del` branch, `confirmDelete` and `DEL_REASONS`. | «WooCommerce owns name, phone, payment, maker, quantity and total…»: all six fields `toBeDisabled`, the hint is shown, no `del` item and no «مسح» in either menu; only the `{note}` and `{comment}` patches go out, with no customer, quantity, total or maker column. |
| 4 | A failed push is shown | `wt(p, undo, ok)` (260). The `setOrderStatus` callback (265) toasts «اتحفظت هنا، بس ماوصلتش لـ WooCommerce — المزامنة هتحاول تاني» on `push: 'error'`; the local change stays. `skipped` stays silent. | «a status saved while WooCommerce is unreachable says so and stays» (`mock.wooDown` → 502): toast shown, the patch is there, no push, the status stays. The «تم RTC» case now also asserts the toast is hidden. |
| 5 | Confirmation date fills at once | `setCf` (251) fills `o.cdate` with `confAt` when it is empty; a date the user typed is kept. `applyOrderInfo` now applies the date before the confirmation, so an empty form date does not wipe what `setCf` filled. | The confirmation case asserts `get('181668').cdate === today` and the date field is not empty. |
| 6 | Minor fixes | `esc` maps `'` → `&#39;` (57). `invalid` → «القيمة مش صح» (260). Images: `https:` / `data:image/` only (58). Removed the dead load-time `sorted(O).slice(0,2)`. «مفيش أوردرات في آخر 12 شهر». | Image case: `javascript:` and `http:` both give no image. Empty-window case uses the new text. `invalid` cannot be reached from the block (it always sends numbers), so it has no e2e. |
| 7 | Customer note from the data | Adapter: `customer_note` added to the `orders_v` select (granted in 0007), mapped to `cnote`, header comment added. Block: `cnote()` (63) shows the note in the desktop panel (133), the mobile panel and its summary (182) and the edit dialog (368), with `pre-line`; «مفيش ملاحظة من العميل» only when empty. The mobile comment preview falls back to the confirmation state (180); the «آخر تعديل» part is gone. | Adapter tests: `COLS.order` includes `customer_note`; `cnote` is mapped (multi-line on O1, `''` on O2). e2e: 181668 shows «اتصلوا قبل التوصيل», 180686 shows «مفيش ملاحظة من العميل», the edit dialog shows the note, and the injection case covers `cnote`. |
| 8 | Sign-out clears search and filters | The `clear()` branch (584) also resets `S.q`, every filter, `S.fb`, the page, `S.edit` and the `#oq` value. | The clear case types «0122» and sets a confirmation filter; after `clear()` both are empty. |
| 9 | Mock answers `all` like woo-sync | `counts: { vendors: { vendors, pages, done }, products: { products, pages, done }, orders: { orders, sub_orders, skipped, conflicts, pages, done } }`: the keys of `pull()`, `cursorPull`, `pullVendors` and `writeOrderPage`. The block's `upserted` fallback stays. | The sync case passes through the real path: «تمت المزامنة · 4 أوردر · 4 منتج · 3 مبتكر». |

**Tests:**
- `npm test`: **141/141 pass**. The adapter assertions were extended, not added as new tests.
- `npm run e2e`: **67 passed (1.3m)**: 47 existing plus 20 orders cases (4 new).
- semgrep with the local OSS rules on the changed files: the same rule kinds as before; nothing in the adapter, spec or mock. Block 29 has 18 `innerHTML` pairs instead of 17: `redrawCard`'s card markup and `refreshCounts`' escaped options were added, and `confirmDelete` was removed.

**Notes:**
- Saving a comment in one card still does the prototype's full `draw(1)`, which redraws every card and so drops unsaved text typed in another card. The ruling covers Realtime, and Realtime never does this. The e2e checks the other card's text before that save.
- The `.danger` and `.dgr` CSS rules are now unused; I left them in the block's CSS string.
