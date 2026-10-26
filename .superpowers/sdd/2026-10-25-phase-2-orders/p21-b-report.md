# Phase 2.1 — task B report (front end)

Status: DONE_WITH_CONCERNS (the first concern is a deploy-order rule; see the end). One code commit `b3f9b01` on the worktree
branch `worktree-agent-a7e6c6120133bd243`. The worktree was at 5573e07; it was fast-forwarded first to `main-gha10e` f2b501c
(the plan commit with «المرحلة 2.1»).

Files:
- Blocks 24, 25, 28 and 29.
- `app/js/adapter/orders.js`.
- `tests/adapter/orders.test.mjs`, `tests/domain/dash-domain.test.mjs`.
- `tests/e2e/{supabase-mock.mjs,orders.spec.mjs,dashboard.spec.mjs}`.
- `tests/split.test.mjs` (24 added to `EDITED`), `tools/blocks.lock.json` (`npm run lock`), `CLAUDE.md` rule 2.

Nothing in `supabase/`, `tests/functions/`, `tools/deploy.md`, the plan or the ledger was touched.

Tests:
- `npm test`: 157/157. There were 156 before; one adapter test was added.
- `node --test tests/split.test.mjs`: 5/5.
- `npm run e2e` (mocked): 87/87. There were 83 before; 4 were added:
  - orders: «فشل» (the old RTC case became two cases);
  - orders: the address;
  - orders: the product links;
  - dashboard: «فشل» is not open.
- Port 4173 was free before each run and free after it. The temporary screenshot spec was deleted.
- `tests/functions/woo-core.test.mjs` still uses «تم RTC» in its synthetic map. It is task A's file and still passes.

Semgrep:
- `npm run semgrep` cannot fetch the registry packs: `semgrep.dev` answers 403 through the proxy.
- I ran the same scan with a local clone of the semgrep-rules repo instead:
  - rules: `javascript/` and `generic/secrets/`;
  - same options: `--severity ERROR --error`, excluding `app/js/blocks` and `app/js/vendor`;
  - result: 0 findings, 86 rules, 109 targets.
- Those directories are not exactly the `p/javascript` / `p/secrets` packs, so CI stays the gate.
- I also ran the javascript rules on block 29 directly (CI excludes it). They report only the block's existing `innerHTML` sites,
  each moved down 5 lines. My changes add no new sink.

## 1. «فشل» replaces «تم RTC» (plan item 1, front-end half)
- **Block 29.**
  - `ST` = `… مكتمل، استرجاع، ملغي، فشل`.
  - `STC` = `… معلّق، استرجاع، ملغي، فشل`.
  - `OSTY['فشل'] = ['err','xc']`: the same tone and icon as «ملغي». «تم RTC» is gone from all three.
  - The filter builder's status enum (`FB_FIELDS`) and `OrdersApp.statuses()` read `ST`, so they follow.
- **Block 24.** `DONE` = `مكتمل، ملغي، استرجاع، فشل`. This is the plan's written decision for block 24.
- **What `grep RTC` found in 25 and 28:**
  - Block 25, line 49: the «أوردرات مفتوحة» details list filters `!['مكتمل','ملغي','استرجاع','تم RTC']`. It is a status list, so
    «فشل» replaces «تم RTC». It now matches block 24's `DONE`.
  - Block 28, line 752: the AI assistant's prompt lists «حالات الأوردر». It is a status list, so «تم RTC» was removed and «فشل»
    added at the end, in the `STC` order.
  - No sample or demo data in 25 or 28 mentions RTC.
  - Block 27 (line 101, the alias `'تم rtc' → 'تم RTC'`) was not touched, as instructed.
- **Block 24 is now an edited block.** It was added to `EDITED` (array and test name) and to the header comment of
  `tests/split.test.mjs`. `npm run lock` was run. CLAUDE.md rule 2 now reads «… 21 و24 و25 …» with
  «المرحلة 2.1: 24 وإضافات صغيرة في 25 و28 و29».
- **Tests.**
  - Domain test (`health`): «مكتمل/ملغي/استرجاع/فشل» are not open; «تم RTC» and «جاري التنفيذ» count as open.
  - e2e, «فشل» case:
    - the chip `[data-sc="فشل"]` exists and `[data-sc="تم RTC"]` does not;
    - no «RTC» text appears on the page;
    - the order's status options are exactly the nine in `ST` order;
    - choosing «فشل» writes `status: 'فشل'`, and the push answers `ok` with `woo_status` set to `failed`;
    - the dropdown has class `s-err` and the `xc` icon;
    - the chip's count is 1.
  - e2e, skip path: the «no Woo slug» case is kept. The spec blanks the mock's «فشل» slug (no 0009 row lacks one), so the
    `skipped / no_woo_status` path, which shows no toast, stays covered.
  - Dashboard e2e (mock): 181668 is set to «فشل». Then:
    - the snapshot has 3 rows and `health.open` 2;
    - the «أوردرات مفتوحة» tile shows 2;
    - its details list 180686 and 180656, not 181668.

## 2. The address on the card (plan item 3)
- `addrText(o)` = `[o.city, o.addr]`, each trimmed, empty parts dropped, joined with ` · `, then passed through `esc()`. With
  both empty it shows «—», the convention of the card's other empty fields (payment, dates).
- **Desktop band.** A new `<span class="inf adr"><small>العنوان:</small><b>…</b></span>` sits between the phone and the payment.
  - The band's items are `nowrap`. The new `.inf.adr{flex:1 1 240px;white-space:normal;min-width:0}` lets a long address wrap
    inside the band instead of pushing it wider.
  - I checked this with screenshots at 1400 and 1250 px. A long address wraps to 2–4 lines and a short one stays on one line.
- **Tablet / mobile.** The customer section (`custSec`) gets `<div class="inf2"><small>العنوان</small><b>…</b></div>` in the same
  place. Checked at 800 and 375 px.
- The line is read-only. Editing stays where it was.
- **e2e:**
  - 181668 shows «القاهرة · مدينة نصر»; 180686 shows «—»;
  - the line has no control;
  - `city: ' '` with `addr: 'الدقي'` shows «الدقي»;
  - the tablet and mobile section shows the same text.
  - The «every site string renders as text» case already sets `city`/`addr` to the breakout string, and it stays inert.

## 3. Product links (plan item 4, front-end half)
### Adapter (`orders.js`)
- **Columns read.**
  - `COLS.item` now includes `product_id`. 0007 grants it to members, and the mock's column list already had it.
  - Products are read as `'sku, image_url, permalink'`, both in `load()` and in the late fetch for unknown SKUs (`fill`).
- **Maps.**
  - One `keep(p)` fills `images` (as before) and `links[sku]`. A permalink is kept only when it is a string matching
    `/^https:\/\//`.
  - `data()` returns `{ orders, vendors, images, links, statuses }`.
  - `load()` and `clear()` reset `links`.
- **Where the link lives.** Each line of the screen shape has `link`: always present, `''` when there is none.
  - `toScreen(rows, items, subs, vendors, { today, links })` works out `origin` from `opts.links` and hands it to `sub()`.
  - `toScreen` stays pure: same input, same output, and the map is never changed.
  - `load()` and the Realtime `refresh()` both pass `{ links }`.
- **The link rule** (`linkOf`):
  1. The SKU's permalink, read back with `typeof === 'string'` and an https check. A `constructor` or `__proto__` SKU never picks
     up a prototype value.
  2. Else `origin + '/?p=' + product_id`, when an origin is known and `product_id` (a number or a numeric string, since bigint
     may come as text) matches `/^[1-9]\d{0,15}$/`.
  3. Else `''`.
- **The origin** comes from the first permalink matching `^https://[a-z0-9.-]+(:port)?` followed by `/ ? #` or the end.
  - A regex is used, not `URL`, so the vm test context needs no extra global.
  - A permalink with userinfo (`https://user@host`) never yields an origin.
- **Tests.**
  - The load selects (`products`: `sku, image_url, permalink`; `order_items` with `product_id`).
  - The full screen shape:
    - 5001 gets its permalink;
    - 5002's product has `permalink: null`, so it gets `SITE/?p=9002`;
    - `d.links` holds only the https entry;
    - `toScreen` without `links` gives `link: ''`.
  - A new pure test over 13 lines:
    - a permalink;
    - `?p=` from a number and from a numeric string;
    - a null id gives no link;
    - an http: or javascript: permalink falls back to `?p=`, and with no https permalink at all there is no origin and no link;
    - ids 0, −1, 1.5 and `12abc` give no link;
    - a `constructor` or `__proto__` SKU never uses a prototype value;
    - an origin with a port, and a userinfo URL skipped;
    - purity.
  - Realtime: the late fetch selects the permalink, and the new line gets it in `applyOrder`. A refetched order keeps the
    load's links and `?p=` fallback.

### Block 29
- `plink(s, inner, attrs)` wraps `inner` in `<a class="plink" href="esc(s.link)" target="_blank" rel="noopener noreferrer">` only
  when `s.link` is a string matching `/^https:\/\//`. Otherwise it returns `inner` unchanged, so the markup is exactly as before
  (`.prod > .th`, `<b>name × qty</b>`).
- `pthumb(s)` wraps `thumbHtml(s.sku)`. Its link gets `tabindex="-1" aria-hidden="true"`: it would otherwise be an unnamed second
  link to the same page. The name's link is the one the keyboard and a screen reader get.
- `pname(s)` wraps `esc(s.prod)` only, with `title="افتح المنتج على الموقع"`. ` × qty` stays outside the link.
- Both are used in the desktop sub-row (`subrow`) and the tablet/mobile sub-card (`subcard`). The details popup's «الأوردرات
  الفرعية» tab reuses these, so it gets the links too.
- CSS: `.plink{flex:none;color:inherit;text-decoration:none}`, an underline on hover, and an inset `:focus-visible` outline
  (`.pt b` clips anything outside it).
- **Click handling.** The delegated click handler only reacts to `[data-more]`, `[data-tg]`, `[data-sc]` and the like, and there
  is no whole-card click. A link click therefore matches nothing and the browser opens the tab. The fold still works only from
  its button.
- **Focus trap.** I added one selector token to `dlgKeys` (the trap of the order popups): `a[href]:not([tabindex="-1"])`.
  - Without it, Shift+Tab from a product link in the details popup jumped to the dialog's last button, because the link was not
    in the trap's list and `i = -1` counted as "first".
  - The new e2e check fails without this token (verified by reverting it once).
- **e2e:**
  - 5001 and 5005 have two links each (thumbnail, then name) to their permalink.
  - Two lines are added in the spec:
    - 5007, an unknown SKU with `product_id` 9100: both links are `SITE/?p=9100`;
    - 5008, with no SKU and no id: no link, `.prod > .th` as before, `<b>` reads «Custom piece × 1».
  - The links have `target="_blank"` and `rel="noopener noreferrer"`. The thumbnail's link holds the image and has
    `tabindex=-1`. The name's link reads «Cushion».
  - Clicking the name link and then the thumbnail link opens new tabs at the expected URLs. `SITE` is answered by a context
    route; the page never reaches the network.
  - After the clicks, the card stays open and nothing is written. The fold button still folds the card.
  - In the details popup the same href shows, and Shift+Tab from the name link lands on the active tab.
  - In the «every site string» case:
    - a link `https://x.test/` + the breakout string appears verbatim as the `href` and stays inert;
    - a `javascript:` link produces no anchor.

### Mock
- `COLUMNS.products` has `permalink`, so the select it accepts includes it.
- Every product row has `permalink = SITE + '/product/<slug>/'`, with `SITE = 'https://ibtekr.stage.test'` (exported).
- The `status_map` row with id 6 becomes `('فشل', 'failed', 'both', sort 10)`. That is the shape of 0009's in-place `update`;
  the other ids and sorts are unchanged.
- The header and woo-sync comments now name 0009.

## Security self-review
- Every new value that reaches HTML goes through `esc()`: the address, the link's href, and the product name inside the link.
  The attribute strings are fixed literals.
- An `href` is written only for `^https://`. `javascript:`, `data:` and `http:` never become a link (tested at both the adapter
  and the block).
- There is no new `innerHTML` site and no inline handler.
- `rel="noopener noreferrer"` on every product link: the site gets no `window.opener` and no referrer from the internal app.
- CSP: links do not load anything, so no change is needed (as in the plan). Thumbnails keep the `img-src` rule (`imgUrl`).
- No new write and no new column written. `product_id` and `permalink` are read only.

## Rulings I made
- «فشل» uses the same icon as «ملغي» (`xc`). It comes right after «ملغي» in `ST` and `STC`, and last in block 28's prompt list.
- The empty address is «—». It sits between the phone and the payment, and gets a 240 px flexible basis on desktop.
- `link` is always on a line (`''` when none), so the screen shape is stable, and it is computed in `sub()` inside the pure
  `toScreen`.
- The thumbnail's link is hidden from the keyboard and screen readers, and the name's link carries a `title`.
- The extra focus-trap token, which was not in the brief (see 3).
- The «no Woo slug» e2e case is kept with a blanked map row.
- Commit trailer: «Claude Fable 5.1», as the brief asked. The repository's history uses the same line.

## Concerns
1. **Deploy order (important).** The adapter now selects `products.permalink`. Against a database without 0009, PostgREST
   answers 42703. `load()` then fails, and the orders page shows its error state with no orders at all.
   - A push to `main` that touches `app/` publishes within a minute (`deploy.yml` → `deploy` branch → Hostinger).
   - So 0009 must be live before `main` is pushed. That is the plan's order («0009 على الحي» … «دفع main»).
   - The same holds for `E2E_SUPABASE_LIVE=1` against staging.
   - If this order cannot be guaranteed, a fallback (retry `sku, image_url` on 42703) is a few lines. I did not add it because
     the plan fixes the order.
2. **Block 29's own `DONE`** (`['مكتمل','ملغي','استرجاع']`, used for late / at-risk and `OrdersApp.alerts()`) is unchanged. It
   never held RTC, and the plan's decision for block 29 names only `ST`/`STC`/`OSTY`.
   - Effect: a «فشل» order whose lines are still open and older than 11 days can show as «متأخر» on the orders page and in the
     alerts.
   - Adding «فشل» there would be a one-word change, but it needs a written decision.
3. **Block 25's «غير مؤكد» KPI** (`unconf`, line 57) excludes `مكتمل/ملغي/استرجاع` but not «فشل». It had no RTC, so it is left
   as it was. A failed, unconfirmed order counts there.
4. **Block 27** still maps «تم rtc» to «تم RTC». A typed command or filter with it will match no order. This is for phase 9, as
   the plan says.
5. **`?p=` fallback.** It relies on WordPress redirecting `?p=<id>` to the product, as the plan decided. A product removed from
   the site gives a 404, which the plan accepts.
   - The origin is the first well-formed permalink. Until 0009's backfill and the re-deployed sync fill `permalink`, there is
     no origin. Lines then show no link, which is today's markup.
