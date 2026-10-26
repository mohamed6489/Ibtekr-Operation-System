# Phase 2.2 — task B report (front end)

Status: DONE_WITH_CONCERNS (the first concern is the deploy order; see the end). One code commit `92c16f8` on the worktree
branch `worktree-agent-a4009cae6faaffa8f`. The worktree was at 6983f07. It was fast-forwarded first to `main-gha10e` 049d628
(the plan commit with «المرحلة 2.2»).

Files:
- Block 29 (`app/js/blocks/29-orders-app.js`) and `tools/blocks.lock.json` (`npm run lock`).
  - Block 29 was already in `EDITED`, so `tests/split.test.mjs` is unchanged.
- `app/js/adapter/orders.js`.
- `tests/adapter/orders.test.mjs`.
- `tests/e2e/supabase-mock.mjs` and `tests/e2e/orders.spec.mjs`.

I did not touch `supabase/`, `tests/functions/`, `tools/deploy.md`, the plan, the ledger or `CLAUDE.md`.

Tests:
- `npm test`: 161/161. There were 159 before; I added two adapter tests.
- `node --test tests/split.test.mjs` (after `npm run lock`): 5/5.
- `npm run e2e` (mocked): 89/89. There were 87 before; I added 2:
  - the website note in full;
  - the governorate in the details popup.
  - The address case was rewritten in place for the new row, so it does not add to the count.
- Port 4173 was free before each run and after it. The throwaway screenshot and probe specs were deleted and never committed.

Semgrep:
- `npm run semgrep` cannot fetch the registry packs: `semgrep.dev` answers 403 through the proxy, as in 2.1.
- I ran the same scan with a local clone of the semgrep-rules repo instead:
  - rules: `javascript/` and `generic/secrets/`;
  - same options: `--severity ERROR --error`, excluding `app/js/blocks` and `app/js/vendor`;
  - result: 0 findings, 86 rules, 112 targets.
- I also ran the javascript rules directly on block 29 (CI excludes it), on the base and the new version. Both give 38
  findings: the block's existing `innerHTML` sites, moved down 4–6 lines. My change adds no new sink.

## 1. The website note in full (plan item 1)
- **Shared markup.** A new `webNote(o)` builds `.note.web` once:
  - the heading «ملاحظة العميل من الموقع» (kept);
  - `<p class="wn">` with `cnote(o)`;
  - the «من الموقع (Website order note)» line.
  - It is used by the desktop / tablet `notes(o)` and the mobile `notesM(o)`.
- **`cnote(o)`.** It trims the note, which still goes through `esc()`. A blank note shows «مفيش ملاحظة من العميل».
  - The trim matters because `pre-wrap` would otherwise show a trailing newline as an empty line, which would take one of
    the 3 lines.
- **CSS (`.note.web .nb .wn`, `#cdlg .wn`):**
  - `white-space:pre-wrap` and `overflow-wrap:anywhere`: the note's own newlines are its lines. The «\n → · » replacement
    is gone.
  - `line-height:20px` and `max-height:64px`, with `padding-bottom:4px`. The extra 4px exists because Cairo's content
    area (26px at 14px, 24px at 13px) runs 2–3px past a 20px line. With `max-height:60px` alone, a 3-line note scrolled by
    2px; I measured this in Chromium. The 4px keeps a 3-line note scroll-free.
  - `overflow-y:auto`, `overflow-x:hidden` and `overscroll-behavior:contain`.
  - A visible `--action` scrollbar thumb on `.wn`. The default thumb (#C9BFAE) is nearly invisible on the note's
    `--acc200` box.
  - `.note.web .nb` gets `height:auto; min-height:64px`. It used to be a fixed 64px with `overflow:hidden`, which was the
    clipping.
- **Mobile.** The website note is no longer a `<details>` accordion whose `<summary>` showed the note cut with «…» and
  « · ». It is the same `.note.web` block, always shown, in `<div class="acc wacc">` (the accordion's divider, 8px top
  padding). The team's comment keeps its accordion.
- **Details / edit popup (`orderInfoHtml`).** The note was a 36px `.ro`, so a long note spilled over the next row. It is now
  `<div class="ro wnb"><p class="wn">…</p></div>`: the box grows (`height:auto; min-height:36px`) and the text block is the
  same 3-line one.
- The note is still read-only. No control is added.

## 2. The address on its own row (plan item 2)
- `addrText(o)` = `[o.stateName, o.city, o.addr]`:
  - each part is trimmed;
  - empty parts and repeated parts are dropped (see the rulings);
  - the parts are joined with « · » and passed through `esc()`;
  - «—» when nothing is left.
- **Desktop.** The `.inf.adr` span left the band (its CSS rule is removed). A new `arow(o)` row
  `<div class="arow"><small>العنوان:</small><b>…</b></div>` comes directly after `.band`:
  - same brand background;
  - padding `0 16px 12px`, or `0 12px 10px` in the ≤1300 px scale where the band is `10px 12px`. It reads as the band's
    second line, the band's padding apart;
  - `b{overflow-wrap:anywhere;min-width:0}`, so a long address wraps.
- **Tablet / mobile.** The «العنوان» `.inf2` left `.crow`. A full-width `<div class="inf2 adr"><small>العنوان</small><b>…</b></div>`
  comes right after `.crow`, inside `.sec.cust`:
  - it uses the section's own label-above-value convention, with no colon, like its other fields;
  - it uses the section's 8px gap;
  - `b{display:block;overflow-wrap:anywhere}`.
- Checked at 1400, 1250, 800 and 375 px (screenshots below), both with the seed and with a 130-character address.

## 3. The governorate (plan item 3, front-end half)
### Adapter (`orders.js`)
- **Columns read.**
  - `COLS.order` now includes `customer_state`. The load and the Realtime row refetch both read `orders_v` with
    `COLS.order`.
  - `load()` reads `woo_states` (`select('code, name').order('code')`) once, in the same `Promise.all` as vendors and
    status_map.
- **The map.** `stateMap(rows)` turns the rows into a `Map` from code to name. Codes and names are trimmed, and a row
  without either is skipped.
  - An empty table gives an empty map.
  - On a refused or failed read (42501, a missing table, network), `states` keeps the last good list. Without one, the codes
    show. The load does not fail.
  - `clear()` resets the map. `data()` is unchanged: the names are on the orders.
- **`toScreen(…, { links, states })`** stays pure. `opts.states` is a `Map`, or `woo_states` rows, mirroring `vendors`. The
  map is never changed. Each order gets:
  - `state` = the trimmed `customer_state`, or `''`;
  - `stateName` = its name, else the code, else `''`. A `Map` lookup means a `constructor` or `__proto__` code never picks
    up a prototype value.
- `load()` and the Realtime `refresh()` both pass `{ links, states }`. A refetched order keeps the names, and `woo_states` is
  not asked again per event.
- **Tests:**
  - The load selects: `customer_state` in `COLS.order`; `woo_states` asks `code, name` with no filter.
  - The full screen shape for 181668 has `state: 'EG-01'` and `stateName: 'القاهرة'`. O2 has `''` / `''`.
  - New pure test over 8 rows:
    - a name;
    - an unknown code gives the code;
    - null and blank give `''`;
    - a padded code is trimmed;
    - a blank name gives the code;
    - `constructor` and `__proto__` give the code;
    - it works with a `Map` and with rows, and the map stays unchanged;
    - no list, `[]`, or a plain object gives the codes.
  - New load test: an empty table shows codes and stays `ready`. After a good list, a refused one (42501) keeps it. A first
    load with a missing table (42P01) shows codes.
  - Realtime: the refetched order has `['EG-01', 'القاهرة']`, and no `woo_states` call is made.
  - The clear test allows `woo_states` among the first batch.

### Block 29
- The address row uses `o.stateName` (see 2).
- **Details / edit popup.** A new `g2` row in «معلومات العميل», right after name / phone: «المحافظة» and «المدينة», as
  read-only `.ro` divs (`esc()`, «—» when empty).
  - The popup showed no city before. The plan places the governorate «جنب المدينة», so the city is shown read-only beside
    it. Editing the city stays where it was (block 28's waybill form).

### Mock
- `COLUMNS.orders_v` has `customer_state`, and every order row defaults it to null.
- `COLUMNS.woo_states` = `code, name, updated_at`, and the route answers GET on `woo_states`. RLS: any signed-in member (my
  reading of the plan's «أي عضو مسجّل»). Anonymous callers get 401, as for every other table.
- Seed:
  - `wooStates` = EG-01 القاهرة, EG-02 الجيزة, EG-03 الإسكندرية;
  - 181668: EG-01, city «مدينة نصر», address «شارع عباس العقاد», and a 3-line `customer_note`
    («اتصلوا قبل التوصيل\nالدور التالت\nالشقة 12»);
  - 180656: EG-14 (no name in the list) with address «ش التحرير»;
  - 180686: nothing.
  - 181668's city and address changed from «القاهرة» / «مدينة نصر», so that all three parts show. Only the address case
    asserted them.

### e2e
- **Address** (rewritten case):
  - the band has no «العنوان»;
  - `.arow` shows «العنوان:» and «القاهرة · مدينة نصر · شارع عباس العقاد»;
  - 180656 shows «EG-14 · ش التحرير»; 180686 shows «—»;
  - the row has no control or link;
  - `.arow` is `.band`'s next sibling, and its box starts at or below the band's bottom;
  - its `b` has `overflow-wrap:anywhere`;
  - city = «القاهرة» shows «القاهرة · شارع عباس العقاد»; `city: ' '` with an address shows the address.
  - At 800 and 375 px:
    - `.crow` has no «العنوان»;
    - `.inf2.adr` is `.crow`'s next sibling and below it;
    - the same three texts show;
    - «—» once the address is cleared.
- **Website note** (new case):
  - 181668's `.wn` text is the 3 lines exactly, with no « · »;
  - computed `white-space:pre-wrap`, `overflow-wrap:anywhere`, `overflow-y:auto`, `max-height:64px`, `line-height:20px`;
  - `clientHeight` 64 with `scrollHeight ≤ clientHeight` (no scroll), in the card and the popup;
  - heading kept; no control.
  - Then a 5-line note (181668) and one long wrapping line (180686), at 1400, 800 and 375 px: `clientHeight` 64 and
    `scrollHeight > clientHeight`. The text is kept as is, and `scrollTop` moves.
  - On mobile, no `summary` holds the note, the block is visible, and the team's comment keeps its accordion.
  - In the popup, the 5-line note scrolls, and 180686's note shows.
  - A blank note (`'  \n '`) shows «مفيش ملاحظة من العميل».
- **Governorate** (new case):
  - the details popup for 181668 / 180656 / 180686 shows «القاهرة» / «EG-14» / «—», with the city beside it
    («مدينة نصر» / «—» / «—»);
  - it has no input, and the next `.fd` is «المدينة»;
  - the edit popup shows the same;
  - nothing is written.
- **«every site string»:** `state` and `stateName` are set to the breakout string too. The edit popup's governorate shows it
  as text, and everything stays inert.

## Screenshots
All are under `/tmp/claude-0/-home-user-Ibtekr-Operation-System/b7ebe23b-85b1-5309-bb27-b4b93f177587/scratchpad/shots/`.
Each width is 1400, 1250, 800 or 375:
- `<w>-seed-181668.png`: the seed (3-line note, all three address parts);
- `<w>-seed-180686.png`: «—» and no note;
- `<w>-long-181668.png`: a 5-line note and a 130-character address;
- `<w>-long-180686.png`: one long wrapping line;
- `<w>-details-181668.png`: the details popup.

Headless Chromium hides scrollbars, so the screenshots show the 3 visible lines but not the thumb.

## Security self-review
- Every new value that reaches HTML goes through `esc()`: the governorate name or code, the city, the address, and the note.
  The attribute strings and the labels are fixed literals.
- There is no new `innerHTML` site, no inline handler and no inline style. The old `style="white-space:pre-line"` attributes
  are gone.
- Nothing new is written. `customer_state` and `woo_states` are only read, and `patchOrder`'s fields are unchanged.
- `woo_states` names come from the website. They are text in the DOM, never markup, and they are read through a `Map`.

## Rulings I made
- **Repeated parts show once.** «القاهرة · القاهرة» becomes «القاهرة».
  - Block 28's waybill form labels `customer_city` as «المحافظة», so the team may type the governorate there. The live
    `customer_city` is empty today. Without this, the row would repeat the name.
  - This goes beyond the plan's «empty parts dropped», but costs one `indexOf`.
- **Each template keeps its own label form.** Desktop shows «العنوان:» inline on a brand-green row under the band.
  Tablet and mobile show a full-width `inf2` with the label above the value, like the section's other fields.
- **The note is always shown on mobile.** It used to be an accordion. A tap inside a `<summary>` toggles it, and a body
  under it would repeat the text.
- **The 3 lines are 64px.** That is 3 × 20px plus 4px for descenders, measured in Chromium. With exactly 60px, a 3-line
  note would scroll by 2px.
- The note's scrollbar thumb uses `--action`.
- **No `tabindex` on the note.** Chromium focuses a scrollable block by keyboard by itself. A `tabindex="0"` would add a tab
  stop per card even when nothing scrolls.
- The popup shows the city read-only next to the governorate (see 3).
- A refused or failed `woo_states` read keeps the last list and never fails the load. The plan says codes show when names
  are missing.
- **Commit trailer.** The brief asked for «Claude Fable 5.1». This session's harness attribution asks for
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (same `Claude-Session` line), and that is the model that wrote
  the change. I used the harness line in both commits. If the repo's «Fable 5.1» line is wanted, an amend before merging is
  a one-liner.

## Concerns
1. **Deploy order (important).** The adapter now selects `orders_v.customer_state`. Against a database without 0010,
   PostgREST answers 42703 and `load()` fails. The orders page then shows its error state, and nothing that reads
   IBOrders, the dashboard included, gets orders.
   - So 0010 must be live before `main` is pushed. That is the plan's order («0010 على الحي» → functions → `main`), the same
     as 0009 in 2.1.
   - `woo_states` alone would not break the load: an error there is tolerated.
2. **Block 28's waybill form** labels `customer_city` as «المحافظة» and edits it, and the waybill text has no site
   governorate. Including `stateName` in the waybill, or relabelling that field «المدينة», would need a written decision for
   block 28. Not done.
3. **`CLAUDE.md` rule 2** lists by phase which phase edited which block. 2.2 edits only 29, which is already listed. I did not
   add «المرحلة 2.2: 29» there, to stay out of task A's way. A one-line follow-up if wanted.
4. **Safari** does not make a scrollable block keyboard-focusable by itself, so a keyboard-only Safari user cannot scroll a
   long note. Chromium and Firefox can. The full note is also in the details popup, with the same limit.
5. **The real list's names are unknown here.** The mock uses EG-01 → القاهرة and so on; the site's `EG-xx` list is its own.
   Until the sync fills `woo_states`, the cards show codes, which is the plan's accepted fallback.
