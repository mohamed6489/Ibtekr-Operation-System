# Phase 3.6 — the orders page additions of the new prototype; the menu with «soon»

Plan: `docs/superpowers/plans/2026-10-27-phase-3-6-orders-prototype.md` (decisions 1–8).
Branch: main-gha10e; `main` after the staging live sequence (decision 8).
Owner (27 Oct): take the additions of the orders page from the prototype session «تطوير ابتكر» (artifact «نظام إبتكر», version of 27 Oct) — add the new only, change or remove nothing of ours; add the new menu pages without starting them; «soon» on every page not started. Answers: soon pages closed; «المورد» → «المبتكر»; the rating stored as proposed (a table).
In-session, sequential, no agents.

## Facts
- The new prototype has 33 scripts (ours: 29). Orders page = its 33 (our 29), orders ops = its 25 (our 22). New there: products domain/page, marketing page, maker portal (out of scope).
- Orders page differences: «المورد» → «المبتكر» everywhere; «مكتمل» → ratePopup (رضا · أخلاق); OrdersApp.getFilters/setFilters (for «إجراءات سريعة», a top-bar feature managed in Settings — out of scope, decision 6).
- Staging: 0 order_items rows with an «المورد» status (rename safe).

## Progress (controller)
- **DB (da3317b):** 0018 + rls_customer_ratings; rls_orders on the new name. db:test 19 files ok.
- **Orders page (6c8555f):** blocks 29/22 renamed (every phrase checked against the prototype text), ratePopup (22), StarPicker (14), RATE_KEYS / validateTeamRating (19), adapter completeOrder via order_complete, activity order.rating; mock + tests.
- **Menu:** block 28 NAV (+ المنتجات, التسويق), SOON list closed in the sidebar, the mobile bar and its sheet, goNow and hashchange guards (→ dashboard + note); block 10 `package` icon; CSS.
- Tests: unit 258, e2e 138, db:test 19. semgrep blocked in this sandbox (CI's gate).

## Live (staging, 27 Oct)
- 0018 applied (`orders_maker_rating`): the check names «المبتكر» and no «المورد»; 0 order_items rows with an old name; customer_ratings RLS on, policies insert / select; authenticated has no update; anon has no select and no execute on order_complete; the trigger has «مرتجع للمبتكر».
- RLS live run 11 (`rls_customer_ratings rls_orders`): rls_customer_ratings **ok** (statuses, the returns row of «مرتجع للمبتكر», ratings, order_complete, grants); rls_orders failed before its first case — its fixture inserts store woo_vendor_id 77, which exists on staging (23505): the file was written for CI's empty database and was never live-safe (not run live before). Its one change here (the status name) is covered on CI and by rls_customer_ratings live. Making it live-safe is left for the orders follow-up.
