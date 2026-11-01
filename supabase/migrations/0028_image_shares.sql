-- 0028_image_shares — phase 5.4 decision 10 (b) and (c): the studio's photos go to the Magnific site, and the site's results come
-- back into the same batch.
-- (b) image_shares: one row per product photo the owner sends from a studio batch («ابعت الصور لـ Magnific»): ai-images action
--     'share' signs the photo (seven days) and inserts the row (pending); the bridge (a Claude session, through the Magnific MCP)
--     uploads it to the project «ابتكر» under the product's name and marks the row sent with the site's creation identifier.
-- (c) image_imports takes target 'batch': the site's results, matched by the bridge to the photo they were made from, land in
--     the product's image slots of that same batch (items: [{ index, images }]).
-- rule 4: select for authenticated (own rows, the admin all), everything for service_role, nothing for anon. Re-runnable.

create table if not exists public.image_shares (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles on delete cascade,
  batch_id uuid not null references public.studio_batches on delete cascade,
  item_index int not null check (item_index between 0 and 999),
  item_key text check (item_key is null or length(item_key) <= 60),
  name text not null check (length(btrim(name)) between 1 and 120 and name !~ '[/\\]' and name !~ '\.\.'), -- a strict file name: no path parts
  path text not null check (length(path) <= 300),
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'error')),
  creation_ref text check (creation_ref is null or creation_ref ~ '^[A-Za-z0-9_-]{1,80}$'),
  error text check (error is null or length(error) <= 200),
  sent_at timestamptz
);
create index if not exists image_shares_batch_idx on public.image_shares (batch_id, item_index);
create index if not exists image_shares_status_idx on public.image_shares (status, created_at);
alter table public.image_shares enable row level security;

drop policy if exists image_shares_select on public.image_shares;
create policy image_shares_select on public.image_shares for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

revoke all on public.image_shares from anon, authenticated;
grant select on public.image_shares to authenticated;
grant all on public.image_shares to service_role;
grant all on sequence public.image_shares_id_seq to service_role;

-- (c) the results come back to the batch they were made for
alter table public.image_imports drop constraint if exists image_imports_target_check;
alter table public.image_imports add constraint image_imports_target_check check (target in ('tool', 'studio', 'batch'));
