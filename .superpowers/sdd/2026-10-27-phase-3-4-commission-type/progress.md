# Phase 3.4 — the commission type (fixed / by category) on the category tree; the brand special rate retired

Plan: `docs/superpowers/plans/2026-10-27-phase-3-4-commission-type.md` (decisions 1–8).
Branch: main-gha10e; `main` after the staging live sequence (decision 8).
Owner's request (27 Oct, two Dokan screenshots): no brand special rate; the rate is the maker's, fixed or category based; the type picker; the site's
top-level categories with «+» for the children; a parent's figure flows to its children; a child set by hand keeps its own (even when the parent
changes later); switching to category based fills the table with the fixed rate; no «Apply Parent Category Commission to All Subcategories»
toggle; every category from WooCommerce (new ones appear — pulled every 15 minutes already).
In-session, sequential, no agents (owner, 26 Oct). Cost at the start ≈ $851.6 (the 3.3 close) + decision 12 of 3.3 (0015) in between.

## Progress (controller)
- **DB:** `0016_commission_type.sql` (the column with a check, `vendor_commission_set`, `vendor_rate_set` keeping the type); `rls_commission_type.sql`;
  `rls_vendors` column assertion extended. db:test 17 files ok.
- **Sync:** `woo-core.js` (`commissionType`, `categoryTree`, `canonicalCategories`, `explicitCategories`, `toDokanCommission` with type + tree;
  the normField / snapshot rate carries the type); `woo-write.js` (`loadTree`, `canon`, `writeSiteRates` writes the type and the inferred hand-set
  rows on category_based only, the push expands to the tree, the diff compares by meaning). Node + Deno tests (Deno 95).
- **Front end:** adapter `setCommission` → `vendor_commission_set` then `push_vendor ['rate','category_rates']`; brand_rates never read, `rateFor` =
  the owner's rate, `setBrandRate` gone; block 06 `categoryTree` / `categoryFigures`; block 28: «نوع العمولة», the tree editor (placeholders show the
  inherited figure, `is-own` on hand-set rows), the drawer's category block display-only, the brand rate column / menu / field removed (lock run).
  Mock: the RPC, the tree (ديكور → إضاءة → أباجورات, هدايا). Unit 249, e2e 133 (vendors-sync's category test rewritten for the tree; the brand
  special-rate test replaced by «retired: a brand_rates row changes nothing»).
- semgrep: not runnable in this sandbox (semgrep.dev blocked by the proxy) — CI's gate.
