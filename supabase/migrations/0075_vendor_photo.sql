-- 0075 — phase 13 decision 51 (owner 10 Nov — «إمكانية لإضافة صورة المبتكر من البوب أب»، and the reply «System + Dokan store»):
-- the maker's photo is chosen in «إضافة مبتكر» / «تعديل» and kept in the system; woo-sync `vendor_photo` (the server, after the upload)
-- records it and, when the maker has a store on the site and WOO_PUSH_ENABLED = 1, sends it to wp/v2/media and sets it as the store's
-- photo (Dokan gravatar). Re-runnable.
-- * vendors.photo_path — the object in the bucket vendor-photos (`<vendor uuid>/<name>.png|jpg|webp`); readable by the members with the
--   vendor columns, written by the server only (no update grant: the column list of 0011 / 0014 stays as it is).
-- * bucket vendor-photos — private, 5 MB, PNG / JPEG / WebP; a member with vendors.edit = F (or the admin) uploads into an existing
--   maker's folder; vendors.view <> N reads (the photo is shown through a signed URL).

alter table public.vendors add column if not exists photo_path text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$');
grant select (photo_path) on public.vendors to authenticated;

-- may the caller put a photo for this maker (the admin or vendors.edit F, and the folder is an existing maker's id)
create or replace function public.vendor_photo_writer(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.is_admin() or public.has_perm('vendors.edit') = 'F')
    and p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|webp)$'
    and exists (select 1 from public.vendors v where v.id::text = split_part(p_name, '/', 1))
$$;
revoke execute on function public.vendor_photo_writer(text) from public, anon;
grant execute on function public.vendor_photo_writer(text) to authenticated, service_role;

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('vendor-photos', 'vendor-photos', false, 5242880, '{image/png,image/jpeg,image/webp}')
               on conflict (id) do nothing$s$;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_photos_select') then
      execute $s$create policy vendor_photos_select on storage.objects for select to authenticated
                 using (bucket_id = 'vendor-photos' and (select public.has_perm('vendors.view')) <> 'N')$s$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_photos_insert') then
      execute $s$create policy vendor_photos_insert on storage.objects for insert to authenticated
                 with check (bucket_id = 'vendor-photos' and public.vendor_photo_writer(name))$s$;
    end if;
  end if;
end $storage$;
