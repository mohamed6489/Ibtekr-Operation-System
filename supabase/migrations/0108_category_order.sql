-- 0108 — a category's place among its siblings (docs/superpowers/plans/2026-11-15-comments.md decision 56).
-- The owner 15 Nov: «اضافة الترتيب ال 6 نقط بتوع الترتيب في الكاتيجوري و يسمع علي الويبسايت ف الاقسام — سواء رئيسي او فرعي».
-- WooCommerce keeps a product category's order among its siblings as menu_order («Category order» on the shop). The mirror
-- takes it beside the name (the sync's `categories` part and woo-sync category_order write it — the server only); the page
-- sorts a parent's children by it, then by name. 0 = never ordered on the site. The table's grants (0014: select to
-- authenticated; select, insert, update, delete to service_role) and its RLS cover the column. Re-runnable.

alter table public.woo_categories add column if not exists menu_order integer not null default 0;
