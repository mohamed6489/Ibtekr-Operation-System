-- Tests for 0075_vendor_photo (phase 13 decision 51 — the maker's photo from «إضافة مبتكر», kept in the system and made the Dokan
-- store photo by woo-sync vendor_photo). Depends on 0001_identity … 0075. Runs in one transaction and rolls back; prints NOTICE
-- 'rls_vendor_photo: ok' only if every case passed. Live-safe: its made-up members and maker are rolled back.
-- * vendors.photo_path: readable by the members, never written by them (the server records it after the upload)
-- * vendor_photo_writer(name) — the insert rule of the bucket vendor-photos: the admin or vendors.edit F, an existing maker's folder,
--   <uuid>/<name>.png|jpg|jpeg|webp; anyone else / another path / an unknown maker → false
-- * the bucket is private, 5 MB, PNG / JPEG / WebP; the function is closed to anon

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000075a1', 'vp-admin.dev@ibtekr.local', '010000075a1'),
  ('00000000-0000-4000-8000-0000000075a2', 'vp-vf.dev@ibtekr.local',    '010000075a2'),
  ('00000000-0000-4000-8000-0000000075a3', 'vp-ops.dev@ibtekr.local',   '010000075a3'),
  ('00000000-0000-4000-8000-0000000075a4', 'vp-cs.dev@ibtekr.local',    '010000075a4');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'vp-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000075a1', 'أدمن الصورة',   'vp-admin.dev@ibtekr.local', '010000075a1', 'admin',            'active', '{}'),
  ('00000000-0000-4000-8000-0000000075a2', 'متابعة الصورة', 'vp-vf.dev@ibtekr.local',    '010000075a2', 'vendors_followup', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000075a3', 'عمليات الصورة', 'vp-ops.dev@ibtekr.local',   '010000075a3', 'ops',              'active', '{}'),
  ('00000000-0000-4000-8000-0000000075a4', 'خدمة الصورة',   'vp-cs.dev@ibtekr.local',    '010000075a4', 'cs',               'active', '{}');
insert into public.vendors (id, name, category, status, lead_days, joined_at) values
  ('00000000-0000-4000-8000-0000000075d1', 'ورشة الصورة', 'هدايا', 'active', 7, '2026-11-10');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

-- ================================================================ the path rule and who may upload

select pg_temp.as_member('00000000-0000-4000-8000-0000000075a2'); -- vendors.edit F
do $$
declare d text := '00000000-0000-4000-8000-0000000075d1';
begin
  if not public.vendor_photo_writer(d || '/1731280000000.png') then raise exception 'case vendors.edit F uploads a png failed'; end if;
  if not public.vendor_photo_writer(d || '/1731280000000.webp') or not public.vendor_photo_writer(d || '/a.jpeg') then raise exception 'case webp / jpeg failed'; end if;
  if public.vendor_photo_writer(d || '/x.gif') then raise exception 'case a gif is refused failed'; end if;
  if public.vendor_photo_writer(d || '/../x.png') or public.vendor_photo_writer(d || '/sub/x.png') then raise exception 'case a path outside the folder failed'; end if;
  if public.vendor_photo_writer('00000000-0000-4000-8000-0000000075ff/x.png') then raise exception 'case an unknown maker failed'; end if;
  -- the member reads the column, never writes it
  perform photo_path from public.vendors where id = d::uuid;
  begin update public.vendors set photo_path = d || '/x.png' where id = d::uuid; raise exception 'case a member writes photo_path failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000075a1'); -- the admin
do $$ begin
  if not public.vendor_photo_writer('00000000-0000-4000-8000-0000000075d1/p.jpg') then raise exception 'case the admin uploads failed'; end if;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000075a3'); -- ops: vendors.edit P
do $$ begin
  if public.vendor_photo_writer('00000000-0000-4000-8000-0000000075d1/p.png') then raise exception 'case vendors.edit P is refused failed'; end if;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000075a4'); -- cs
do $$ begin
  if public.vendor_photo_writer('00000000-0000-4000-8000-0000000075d1/p.png') then raise exception 'case cs is refused failed'; end if;
end $$;
reset role;

-- ================================================================ the column's check, the bucket, the grants

do $$ begin
  begin update public.vendors set photo_path = 'not a path' where id = '00000000-0000-4000-8000-0000000075d1'; raise exception 'case the column check failed';
  exception when check_violation then null; end;
  update public.vendors set photo_path = '00000000-0000-4000-8000-0000000075d1/1731280000000.png' where id = '00000000-0000-4000-8000-0000000075d1'; -- the server's write
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    if not exists (select 1 from storage.buckets where id = 'vendor-photos' and public = false and file_size_limit = 5242880 and allowed_mime_types @> '{image/png,image/jpeg,image/webp}') then
      raise exception 'case the private bucket failed';
    end if;
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('vendor_photos_select', 'vendor_photos_insert')) <> 2 then
      raise exception 'case the bucket policies failed';
    end if;
  end if;
  if has_function_privilege('anon', 'public.vendor_photo_writer(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.vendor_photo_writer(text)', 'execute') then
    raise exception 'case the grants of 0075 failed';
  end if;
  if has_column_privilege('authenticated', 'public.vendors', 'photo_path', 'update') or not has_column_privilege('authenticated', 'public.vendors', 'photo_path', 'select') then
    raise exception 'case the column grants failed';
  end if;
  raise notice 'rls_vendor_photo: ok';
end $$;
rollback;
