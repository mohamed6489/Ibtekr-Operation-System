-- 0112_maker_store_archive — the owner 16 Nov (docs/superpowers/plans/2026-11-16-maker-add-delete.md decisions 4 and 7).
--
-- * vendors.store_error / store_try_at: woo-sync vendor_store writes the code of a failed try (and when) and clears it when the store is
--   made — the maker's file shows «جرّب عمل المتجر تاني» only for such a maker (the «اعمل متجر على الموقع» button is gone). Written by
--   the server only (no update grant).
-- * vendors.archived_at / archived_by / archive_reason: «حذف المبتكر» of a maker with orders or account moves (they point at him) keeps
--   the row, archived: gone from the lists and the pickers, his orders and accounts keep his name. Written by the server only (woo-sync
--   vendor_delete, after the store is gone from the site); the reason up to 300 characters, never shown outside the system.
-- Re-runnable; nothing dropped.

alter table public.vendors add column if not exists store_error text check (store_error is null or char_length(store_error) <= 60);
alter table public.vendors add column if not exists store_try_at timestamptz;
alter table public.vendors add column if not exists archived_at timestamptz;
alter table public.vendors add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.vendors add column if not exists archive_reason text check (archive_reason is null or char_length(archive_reason) <= 300);
grant select (store_error, store_try_at, archived_at, archived_by, archive_reason) on public.vendors to authenticated;
grant select, update (store_error, store_try_at, archived_at, archived_by, archive_reason) on public.vendors to service_role;

-- an archived maker is no member's to change: the row's member writes (the contact fields, the main categories RPC) refuse it
create or replace function public.vendors_archived_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- the caller's own role (a member through an RPC too); the server (service_role) and the migrations (no JWT) pass
  if old.archived_at is not null and coalesce(auth.jwt() ->> 'role', '') = 'authenticated' then
    raise exception 'archived' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.vendors_archived_guard() from public, anon;
drop trigger if exists vendors_archived_guard on public.vendors;
create trigger vendors_archived_guard before update on public.vendors for each row execute function public.vendors_archived_guard();
