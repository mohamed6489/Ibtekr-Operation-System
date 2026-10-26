-- 0009_failed_note_permalink: phase 2.1 (the owner's requests after go-live): status_map «تم RTC» → «فشل» (failed);
-- orders.note seeded from the website note (customer_note); products.permalink (column, backfill from raw, grants).
-- Uses status_map (0002, reseeded by 0007), orders / products / orders_log_events (0007), the grant rules (0004).
--
-- Decision (plan, phase 2.1 item 1): the «تم RTC» row becomes ('فشل', 'failed', 'both', sort 10) with one update, so
--   its id stays. Why: «تم RTC» has no Woo status and no order uses it (checked live), while Woo's `failed` had no row
--   and fell back to «ملغي» (woo-core WOO_FALLBACK, now empty). orders.status references status_map(system_status)
--   on update cascade, so an order on «تم RTC» would follow the rename. Cost if wrong: a failed Woo order reads «فشل»
--   instead of «ملغي».
-- Decision (item 2): orders.note (the team's editable comment) starts as the website note. From now on the sync writes
--   it on a new order only (woo-write TEAM_EDITED, like customer_city / customer_address); here the existing orders
--   with a website note and an empty comment get it once. Cost if wrong: a later edit of the website note does not
--   reach the comment (accepted: the team owns the field after the first write).
-- Decision (item 4): products.permalink = the product page on the site (the orders screen links image and name to it),
--   https only (woo-write mapProduct gives null for anything else; the backfill below uses the same rule).
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (where … / if not exists) or re-runnable (grant); a second run changes
--   nothing. No drop / delete / truncate statements in this file.
-- * The note seed goes through orders_log_events (0007) like any sync write: one order_events row per seeded order
--   (kind 'note', old '' or null, source 'woo', actor null), so the history says where the comment came from.
-- * products is granted table-wide in 0007 (select to authenticated; select / insert / update / delete to
--   service_role), so the new column is covered already; the grants are restated here (rule 4). The RLS policies of
--   products filter rows, not columns: no change.
-- * The backfill reads raw->>'permalink' (woo-write has kept it in products.raw since 0007) and fills only rows whose
--   permalink is still null, so a value the new sync wrote is never overwritten.

-- ---------------------------------------------------------------- status_map: «تم RTC» → «فشل» (failed)

update public.status_map
set system_status = 'فشل', woo_status = 'failed', direction = 'both', sort = 10
where system_status = 'تم RTC'
  and not exists (select 1 from public.status_map where system_status = 'فشل');

-- ---------------------------------------------------------------- orders.note from the website note

update public.orders
set note = customer_note
where coalesce(note, '') = '' and coalesce(customer_note, '') <> '';

-- ---------------------------------------------------------------- products.permalink

alter table public.products add column if not exists permalink text;

update public.products
set permalink = btrim(raw ->> 'permalink')
where permalink is null and btrim(raw ->> 'permalink') like 'https://%';

-- rule 4: explicit grants (the same table-wide grants as 0007, which already cover the new column).
grant select on public.products to authenticated;
grant select, insert, update, delete on public.products to service_role;
