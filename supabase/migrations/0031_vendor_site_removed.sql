-- 0031_vendor_site_removed — the owner (2 Nov): «أنا حذفت مبتكرين من الموقع ومااتحذفوش من السيستم». A store gone from the site
-- is never deleted here by the sync (orders, the accounts and the brands' history point at it); it is marked instead:
-- vendors.site_removed_at (set by woo-sync's vendors pull after a complete run, the status turned inactive; lifted when the store
-- is back). The vendors page shows «اتحذف من الموقع» and the admin removes the maker from the drawer (the existing delete).
-- rule 4: the members read the column (the column-list grant pattern of 0014); service_role's table grants of 0011 cover it.
-- Re-runnable.

alter table public.vendors add column if not exists site_removed_at timestamptz;
grant select (site_removed_at) on public.vendors to authenticated;
