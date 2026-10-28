-- 0023_studio: the product studio, no AI (phase 5.2). Uses roles (0001/0003), has_perm / is_admin (0008), brands (0013),
-- vendors (0011). The plan: docs/superpowers/plans/2026-10-28-phase-5-2-studio.md.
--
-- Decision 12: products.add — the studio and «+ دفعة منتجات جديدة» (admin and ops F, the rest N; merged only when absent).
-- Decision 3: sku_colors — the colors list (EN name = the pa_color term, AR name, a two-letter SKU code, a hex to show);
--   read with products.view <> N, added with products.add = F (no update / delete for members). Seeded with the site's
--   colors, every code unique.
-- Decision 2: sku_serial — one site-wide serial for the SKU, first 0999; sku_serial_take(n) reserves n numbers at once
--   (products.add = F) and returns the first.
-- Decision 10: studio_batches — a batch's state (its products, settings and image paths in the bucket; nothing personal),
--   read and written with products.add = F; members write title / brand / vendor / type / state / step / archived_at only
--   (status / result are the server's, woo-sync studio_upload); no delete («حذف» = archived_at).
-- Decision 6: the bucket studio — private, 20 MB, WebP / PNG / JPEG, products.add = F (select / insert / update / delete:
--   an image taken out of a batch goes away).
--
-- Notes for readers:
-- * Re-runnable: create if not exists, on conflict do nothing, policies dropped and created again, the storage block guarded.
-- * rule 4: grants by column for authenticated, everything for service_role, nothing for anon.

-- ---------------------------------------------------------------- products.add (decision 12)

update public.roles r set permissions = d.perms || r.permissions
from (values
  ('ops',              '{"products.add":"F"}'::jsonb),
  ('cs',               '{"products.add":"N"}'::jsonb),
  ('accounts',         '{"products.add":"N"}'::jsonb),
  ('vendors_followup', '{"products.add":"N"}'::jsonb),
  ('viewer',           '{"products.add":"N"}'::jsonb),
  ('admin',            '{"products.add":"F"}'::jsonb)
) as d(id, perms)
where r.id = d.id;

-- ---------------------------------------------------------------- sku_colors (decision 3)

create table if not exists public.sku_colors (
  id serial primary key,
  name_en text not null check (name_en ~ '^[A-Za-z][A-Za-z &-]{1,39}$'),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 40),
  code text not null unique check (code ~ '^[A-Z]{2}$'),
  hex text check (hex is null or hex ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists sku_colors_name_en_key on public.sku_colors (lower(name_en));
alter table public.sku_colors enable row level security;

drop policy if exists sku_colors_select on public.sku_colors;
create policy sku_colors_select on public.sku_colors for select to authenticated
  using ((select public.has_perm('products.view')) <> 'N');
drop policy if exists sku_colors_insert on public.sku_colors;
create policy sku_colors_insert on public.sku_colors for insert to authenticated
  with check ((select public.has_perm('products.add')) = 'F');

revoke all on public.sku_colors from anon, authenticated;
grant select on public.sku_colors to authenticated;
grant insert (name_en, name_ar, code, hex) on public.sku_colors to authenticated;
grant usage on sequence public.sku_colors_id_seq to authenticated;
grant all on public.sku_colors to service_role;
grant all on sequence public.sku_colors_id_seq to service_role;

insert into public.sku_colors (name_en, name_ar, code, hex, created_by) values
  ('Baby blue', 'لبني', 'BB', '#a7c7e7', null), ('Beige', 'بيج', 'BE', '#d9c3a0', null), ('Black', 'أسود', 'BK', '#1d1d1b', null),
  ('Blue', 'أزرق', 'BL', '#2f5d9b', null), ('Brown', 'بني', 'BR', '#7a4e2d', null), ('Burgundy', 'نبيتي', 'BU', '#7a1f2b', null),
  ('Camel', 'جملي', 'CM', '#c19a6b', null), ('Dark Brown', 'بني غامق', 'DB', '#4a2c1a', null), ('Gold', 'دهبي', 'GD', '#b8943f', null),
  ('Green', 'أخضر', 'GN', '#4f6b3a', null), ('Grey', 'رمادي', 'GY', '#8c8c8c', null), ('Marble Effect', 'رخامي', 'ME', null, null),
  ('Multicolor', 'ملون', 'MC', null, null), ('Mustard', 'مستردة', 'MS', '#c9a227', null), ('Natural', 'طبيعي (خام)', 'NA', '#e6d5b8', null),
  ('Natural Wood', 'خشب طبيعي', 'NW', '#b08d57', null), ('Navy', 'كحلي', 'NV', '#1f2c4c', null), ('Off White', 'أوف وايت', 'OW', '#f3ede1', null),
  ('Olive', 'زيتي', 'OL', '#6b6b2a', null), ('Orange', 'برتقالي', 'OR', '#e07b24', null), ('Pink', 'بينك', 'PK', '#e8a0b4', null),
  ('Purple', 'بنفسجي', 'PU', '#6e4a8e', null), ('Red', 'أحمر', 'RD', '#b3261e', null), ('Sage Green', 'أخضر زرعي', 'SG', '#9caf88', null),
  ('Silver', 'فضي', 'SV', '#c0c0c0', null), ('Terracotta', 'تيراكوتا', 'TC', '#c46a4a', null), ('White', 'أبيض', 'WH', '#ffffff', null),
  ('Yellow', 'أصفر', 'YL', '#e8c33a', null)
on conflict do nothing;

-- ---------------------------------------------------------------- sku_serial (decision 2)

create table if not exists public.sku_serial (
  id int primary key default 1 check (id = 1),
  next bigint not null default 999 check (next >= 0)
);
alter table public.sku_serial enable row level security;
drop policy if exists sku_serial_select on public.sku_serial;
create policy sku_serial_select on public.sku_serial for select to authenticated
  using ((select public.has_perm('products.view')) <> 'N');
revoke all on public.sku_serial from anon, authenticated;
grant select on public.sku_serial to authenticated;
grant all on public.sku_serial to service_role;
insert into public.sku_serial (id, next) values (1, 999) on conflict (id) do nothing;

-- n numbers in a row for one upload; returns the first (the caller pads it to 4 digits)
create or replace function public.sku_serial_take(n int)
returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v bigint;
begin
  if not (public.is_admin() or coalesce(public.has_perm('products.add'), 'N') = 'F') then
    raise exception 'products.add is needed' using errcode = '42501';
  end if;
  if n is null or n < 1 or n > 200 then
    raise exception 'n is 1..200' using errcode = '22023';
  end if;
  update public.sku_serial set next = next + n where id = 1 returning next - n into v;
  if v is null then
    insert into public.sku_serial (id, next) values (1, 999 + n) on conflict (id) do update set next = public.sku_serial.next + n
      returning next - n into v;
  end if;
  return v;
end $$;
revoke execute on function public.sku_serial_take(int) from public, anon;
grant execute on function public.sku_serial_take(int) to authenticated, service_role;

-- ---------------------------------------------------------------- studio_batches (decision 10)

create table if not exists public.studio_batches (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  brand_id uuid references public.brands on delete set null,
  vendor_id uuid references public.vendors on delete set null,
  type text not null default 'Simple' check (type in ('Simple', 'Variable')),
  state jsonb not null default '{}' check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 2000000),
  step int not null default 1 check (step between 1 and 8),
  status text not null default 'draft' check (status in ('draft', 'uploading', 'done')),
  result jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists studio_batches_updated_idx on public.studio_batches (updated_at desc);
alter table public.studio_batches enable row level security;

create or replace function public.studio_batches_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.studio_batches_touch() from public, anon, authenticated;
drop trigger if exists studio_batches_touch on public.studio_batches;
create trigger studio_batches_touch before update on public.studio_batches for each row execute function public.studio_batches_touch();

drop policy if exists studio_batches_select on public.studio_batches;
create policy studio_batches_select on public.studio_batches for select to authenticated
  using ((select public.has_perm('products.add')) = 'F');
drop policy if exists studio_batches_insert on public.studio_batches;
create policy studio_batches_insert on public.studio_batches for insert to authenticated
  with check ((select public.has_perm('products.add')) = 'F' and status = 'draft' and result is null);
drop policy if exists studio_batches_update on public.studio_batches;
create policy studio_batches_update on public.studio_batches for update to authenticated
  using ((select public.has_perm('products.add')) = 'F')
  with check ((select public.has_perm('products.add')) = 'F');

revoke all on public.studio_batches from anon, authenticated;
grant select on public.studio_batches to authenticated;
grant insert (title, brand_id, vendor_id, type, state, step) on public.studio_batches to authenticated;
grant update (title, brand_id, vendor_id, type, state, step, archived_at) on public.studio_batches to authenticated;
grant all on public.studio_batches to service_role;

-- ---------------------------------------------------------------- Storage: bucket studio + policies (decision 6, guarded)

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('studio', 'studio', false, 20971520, '{image/webp,image/png,image/jpeg}')
               on conflict (id) do nothing$s$;
    execute $s$drop policy if exists studio_select on storage.objects$s$;
    execute $s$create policy studio_select on storage.objects for select to authenticated
               using (bucket_id = 'studio' and (select public.has_perm('products.add')) = 'F')$s$;
    execute $s$drop policy if exists studio_insert on storage.objects$s$;
    execute $s$create policy studio_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'studio' and (select public.has_perm('products.add')) = 'F')$s$;
    execute $s$drop policy if exists studio_update on storage.objects$s$;
    execute $s$create policy studio_update on storage.objects for update to authenticated
               using (bucket_id = 'studio' and (select public.has_perm('products.add')) = 'F')
               with check (bucket_id = 'studio' and (select public.has_perm('products.add')) = 'F')$s$;
    execute $s$drop policy if exists studio_delete on storage.objects$s$;
    execute $s$create policy studio_delete on storage.objects for delete to authenticated
               using (bucket_id = 'studio' and (select public.has_perm('products.add')) = 'F')$s$;
  end if;
end $storage$;
