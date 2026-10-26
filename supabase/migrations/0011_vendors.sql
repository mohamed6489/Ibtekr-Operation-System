-- 0011_vendors: phase 3 (the makers on real data): the team's columns on vendors (+ backfills from raw),
-- order_items.commission_rate / commission_fee (the site's own commission on every line, backfilled from raw), the two
-- sensitive tables vendor_rates (the agreement, with an effective date) and vendor_bank (one row per maker), the
-- column-list grants on vendors, the update / delete policies, the column guard vendors_guard_update, and the private
-- Storage bucket vendor-contracts with its policies.
-- Uses has_perm / is_admin (0001), the role matrix (0003: vendors.view / vendors.edit / vendors.toggle,
-- sensitive.vendor_bank, sensitive.commission, orders.view — no new key), vendors / order_items and their grants (0007),
-- the grant rules (0004).
--
-- Decision (plan, decision 1): the registry is the sync's vendors table itself — the 55 stores Dokan listed are the
--   makers and the team completes their data; a maker without a store (woo_vendor_id null) may be added from the
--   screen. Cost if wrong: a hand-added maker links to no order until a store exists.
-- Decision (decision 2): after the first insert the team owns name / status / phone / email and the columns added
--   here; the sync updates raw (and woo_vendor_id) only on an existing store — that rule lives in woo-write
--   (saveVendors), this file only adds the columns.
-- Decision (decision 3): the rate is vendor_rates (one row per change, `since` = the effective date), read and written
--   with sensitive.commission = F; vendors.commission_pct is a computed copy of the rate effective today, refreshed by
--   an after-insert trigger, and readable by service_role only — members read vendor_rates.
-- Decision (decision 4): order_items.commission_rate / commission_fee are the site's commission on that line when the
--   order was placed (_dokan_commission_rate / _dokan_additional_fee), sync-owned, readable with orders.view: the
--   maker's share of a line = total − (total × rate / 100 + fee). sensitive.commission protects the agreement (the
--   rate history), not the arithmetic of one order.
-- Decision (decisions 6 / 7): vendor_bank and the contract file (bucket vendor-contracts, metadata in
--   vendors.contract) are behind sensitive.vendor_bank = F; nothing is ever deleted from the bucket (a replacement is a
--   new file, the old one stays).
-- Decision (decision 8): permissions by column, on the server (vendors_guard_update): status ← vendors.toggle = F;
--   contract ← sensitive.vendor_bank = F; name / legal_name / category / aliases / lead_days / deposit_policy /
--   joined_at ← vendors.edit = F; phone / alt_phone / email / address / instagram / store_url / notes ← vendors.edit
--   in (F, P); every other column (id, woo_vendor_id, commission_pct, raw, opening_balance, created_at, updated_at)
--   belongs to the sync or the server. Insert: admin or vendors.edit = F (0007's policy, unchanged). Delete: admin
--   only, and refused (23503) while lines / sub-orders / products reference the maker.
-- Decision (this file; the plan wrote the with check as `is_admin() or vendors.edit <> 'N'`): the with check of
--   vendors_update also admits sensitive.vendor_bank = F, so that accounts (vendors.edit = N) can record a contract
--   (decision 7 gives the contract to admin + accounts); the guard then lets them change the contract column alone.
--   Cost if wrong: none for the other columns — the guard refuses them with 42501.
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (if not exists / where … is null / a pg_policies check / on conflict do
--   nothing) or re-runnable (create or replace, alter policy, grant / revoke); a second run changes nothing. No drop /
--   delete / truncate statements in this file (the two 0007 policies are changed with `alter policy`).
-- * Column-level grants on vendors for authenticated (0007 gave the whole table; the table-level grants are revoked
--   first, which also clears any column grant, then the lists are granted): SELECT on every column but commission_pct
--   (raw stays readable — the public store fields only, see woo-core's RAW_STORE); INSERT and UPDATE on the team's
--   columns only, so woo_vendor_id, commission_pct, raw and opening_balance (phase 4's import writes it as
--   service_role) cannot be written from the API with any value, whatever the policies say; DELETE on the table (the
--   policy makes it admin only). PostgREST `select=*` on vendors is therefore refused for members, like orders: the
--   adapter names its columns. `returning *` on a write is refused too (writers ask for id).
-- * The guard applies to anon / authenticated only (phase-0 pattern): postgres / service_role (the sync, this file)
--   pass. The commission_pct refresh runs inside a security definer function, i.e. as its owner (the migration runner,
--   postgres), so the guard lets it through and authenticated needs no privilege on commission_pct.
-- * vendor_rates: select / insert with sensitive.commission = F (admin only in the matrix of 0003); no update / delete
--   policy and no such grant, so a rate is never edited, only superseded by a row with a later `since`.
--   unique (vendor_id, since) also covers the foreign key (advisor 0001_unindexed_foreign_keys).
-- * vendor_bank: select / insert / update with sensitive.vendor_bank = F (admin + accounts); no delete. A member
--   without the key gets zero rows (RLS), not an error — the screen shows «مخفي». The primary key covers the key.
-- * Both reference vendors (id) on delete cascade: the sensitive rows mean nothing without the maker, and an admin may
--   delete a maker without orders who already has a rate or a bank row. The cascade is an integrity action (it
--   bypasses RLS by design) and only the admin's delete reaches it; a maker with lines is refused before it.
-- * Backfills, on rows whose column is still null (a value the new sync wrote is never overwritten): vendors.joined_at
--   from raw.registered (Dokan: 'YYYY-MM-DD HH:MM:SS' local — the date part; a value that does not start with a date
--   → created_at); vendors.store_url from raw.shop_url when it starts with https://; order_items.commission_rate /
--   commission_fee from the _dokan_commission_rate / _dokan_additional_fee entries of raw.meta_data (a blank value =
--   null; only a plain non-negative decimal is cast, so nothing malformed can stop the file). The file runs as
--   postgres, so the guards pass; order_items_log_events tracks neither column, so no order_events row is written.
-- * Storage: the bucket and the storage.objects policies are created inside a DO block guarded by the existence of the
--   storage schema (a plain local Postgres has none), with dynamic SQL so the block parses there too. Policies for
--   authenticated only, select / insert / update on bucket_id = 'vendor-contracts' with sensitive.vendor_bank = F; no
--   delete policy. The bucket is private (public = false), 10 MB, PDF / PNG / JPEG; the screen reads a file through a
--   60-second signed URL (the adapter). Objects are named <vendor uuid>/<unix ms>-<safe name> by the adapter.
-- * rule 4: explicit grants; no truncate / references / trigger for any API role on the new tables; nothing for anon.

-- ---------------------------------------------------------------- vendors: the team's columns

alter table public.vendors add column if not exists legal_name text;
alter table public.vendors add column if not exists category text
  check (category is null or category in ('ديكور منزلي', 'إكسسوارات ومجوهرات', 'ملابس ومنسوجات', 'فنون ولوحات',
                                           'هدايا', 'مستلزمات حرف', 'أطعمة وحلويات'));
alter table public.vendors add column if not exists alt_phone text;
alter table public.vendors add column if not exists address text;
alter table public.vendors add column if not exists instagram text;
alter table public.vendors add column if not exists store_url text;
alter table public.vendors add column if not exists lead_days int not null default 7 check (lead_days between 1 and 60);
alter table public.vendors add column if not exists deposit_policy text;
alter table public.vendors add column if not exists notes text;
alter table public.vendors add column if not exists joined_at date;
alter table public.vendors add column if not exists contract jsonb;
alter table public.vendors add column if not exists opening_balance numeric(12,2) not null default 0;

-- joined_at: the date part of Dokan's `registered` ('2025-01-02 10:00:00'), else the day the sync first saw the store.
update public.vendors
set joined_at = coalesce(
      case when (raw ->> 'registered') ~ '^\d{4}-\d{2}-\d{2}' then left(raw ->> 'registered', 10)::date end,
      created_at::date)
where joined_at is null;

-- store_url: the store page on the site, https only (the screen links to it).
update public.vendors
set store_url = btrim(raw ->> 'shop_url')
where store_url is null and btrim(raw ->> 'shop_url') like 'https://%';

-- ---------------------------------------------------------------- order_items: the site's commission on the line

alter table public.order_items add column if not exists commission_rate numeric(5,2);
alter table public.order_items add column if not exists commission_fee numeric(10,2);

-- From the line's _dokan_* meta kept in raw (woo-core): a blank value is null, only a plain decimal is cast.
update public.order_items i
set commission_rate = coalesce(i.commission_rate, case when m.rate ~ '^\d{1,3}(\.\d+)?$' then m.rate::numeric end),
    commission_fee = coalesce(i.commission_fee, case when m.fee ~ '^\d{1,8}(\.\d+)?$' then m.fee::numeric end)
from (
  select id,
         btrim((select e ->> 'value' from jsonb_array_elements(raw -> 'meta_data') e
                where e ->> 'key' = '_dokan_commission_rate' limit 1)) as rate,
         btrim((select e ->> 'value' from jsonb_array_elements(raw -> 'meta_data') e
                where e ->> 'key' = '_dokan_additional_fee' limit 1)) as fee
  from public.order_items
  where jsonb_typeof(raw -> 'meta_data') = 'array'
) m
where m.id = i.id and (i.commission_rate is null or i.commission_fee is null);

-- rule 4: members read both with the rest of the line (orders.view); the sync owns them.
grant select (commission_rate, commission_fee) on public.order_items to authenticated;
grant select (commission_rate, commission_fee), insert (commission_rate, commission_fee), update (commission_rate, commission_fee)
  on public.order_items to service_role;

-- ---------------------------------------------------------------- vendor_rates: the agreement, with an effective date

create table if not exists public.vendor_rates (
  id bigserial primary key,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  rate numeric(5,2) not null check (rate between 0 and 65),
  since date not null,
  set_by text,
  created_at timestamptz not null default now(),
  unique (vendor_id, since)
);

alter table public.vendor_rates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_rates' and policyname = 'vendor_rates_select') then
    create policy vendor_rates_select on public.vendor_rates for select to authenticated
      using ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_rates' and policyname = 'vendor_rates_insert') then
    create policy vendor_rates_insert on public.vendor_rates for insert to authenticated
      with check ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
end $$;

-- vendors.commission_pct = the rate effective on current_date (the latest `since` not after today; null while every
-- rate is still future-dated). Refreshed on insert only: a rate dated tomorrow reaches the copy on the next insert —
-- the screen reads vendor_rates itself (decision 3). Definer (owner: the migration runner, postgres): authenticated
-- has no update on commission_pct, and vendors_guard_update sees the owner, not the member.
create or replace function public.vendor_rates_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.vendors v
  set commission_pct = (select r.rate from public.vendor_rates r
                        where r.vendor_id = new.vendor_id and r.since <= current_date
                        order by r.since desc, r.id desc limit 1)
  where v.id = new.vendor_id;
  return null;
end
$$;

create or replace trigger vendor_rates_apply after insert on public.vendor_rates
  for each row execute function public.vendor_rates_apply();

revoke execute on function public.vendor_rates_apply() from public, anon, authenticated;

grant select, insert on public.vendor_rates to authenticated;
grant select, insert, update, delete on public.vendor_rates to service_role;
grant usage, select on sequence public.vendor_rates_id_seq to authenticated, service_role;

-- ---------------------------------------------------------------- vendor_bank: one row per maker

create table if not exists public.vendor_bank (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  method text not null default 'bank' check (method in ('bank', 'instapay', 'wallet', 'cash')),
  bank_name text,
  holder text,
  iban text,
  wallet text,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.vendor_bank enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_bank' and policyname = 'vendor_bank_select') then
    create policy vendor_bank_select on public.vendor_bank for select to authenticated
      using ((select public.has_perm('sensitive.vendor_bank')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_bank' and policyname = 'vendor_bank_insert') then
    create policy vendor_bank_insert on public.vendor_bank for insert to authenticated
      with check ((select public.has_perm('sensitive.vendor_bank')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_bank' and policyname = 'vendor_bank_update') then
    create policy vendor_bank_update on public.vendor_bank for update to authenticated
      using ((select public.has_perm('sensitive.vendor_bank')) = 'F')
      with check ((select public.has_perm('sensitive.vendor_bank')) = 'F');
  end if;
end $$;

grant select, insert, update on public.vendor_bank to authenticated;
grant select, insert, update, delete on public.vendor_bank to service_role;

revoke truncate, references, trigger on public.vendor_rates, public.vendor_bank from anon, authenticated, service_role;

-- ---------------------------------------------------------------- vendors: grants by column list (see the header)

revoke select, insert, update, delete on public.vendors from authenticated;
grant select (id, woo_vendor_id, name, aliases, phone, email, status, raw, created_at, updated_at, legal_name, category,
              alt_phone, address, instagram, store_url, lead_days, deposit_policy, notes, joined_at, contract, opening_balance)
  on public.vendors to authenticated;
grant insert (name, aliases, phone, email, status, legal_name, category, alt_phone, address, instagram, store_url,
              lead_days, deposit_policy, notes, joined_at)
  on public.vendors to authenticated;
grant update (name, aliases, phone, email, status, legal_name, category, alt_phone, address, instagram, store_url,
              lead_days, deposit_policy, notes, joined_at, contract)
  on public.vendors to authenticated;
-- the policy decides (admin only); 23503 while lines / sub-orders / products reference the maker.
grant delete on public.vendors to authenticated;
grant select, insert, update, delete on public.vendors to service_role;

-- ---------------------------------------------------------------- vendors: policies (0007's, changed in place)

-- A member who may see a row but may not change it gets 42501 (with check or the guard), never a silent "0 rows".
alter policy vendors_update on public.vendors
  using ((select public.has_perm('vendors.view')) <> 'N')
  with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) <> 'N'
              or (select public.has_perm('sensitive.vendor_bank')) = 'F');
alter policy vendors_delete on public.vendors
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- vendors: the column guard (decision 8)

-- API roles: status needs vendors.toggle = F; contract needs sensitive.vendor_bank = F; name / legal_name / category /
-- aliases / lead_days / deposit_policy / joined_at need vendors.edit = F; phone / alt_phone / email / address /
-- instagram / store_url / notes need vendors.edit in (F, P); every other column (woo_vendor_id, commission_pct, raw,
-- opening_balance, …) is the sync's or the server's → 42501. One clear message per rule, in this order.
create or replace function public.vendors_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare
  status_cols constant text[] := array['status'];
  contract_cols constant text[] := array['contract'];
  edit_cols constant text[] := array['name', 'legal_name', 'category', 'aliases', 'lead_days', 'deposit_policy', 'joined_at'];
  contact_cols constant text[] := array['phone', 'alt_phone', 'email', 'address', 'instagram', 'store_url', 'notes'];
  n jsonb;
  o jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    n := to_jsonb(new);
    o := to_jsonb(old);
    if (n - status_cols - contract_cols - edit_cols - contact_cols) is distinct from (o - status_cols - contract_cols - edit_cols - contact_cols) then
      raise exception 'vendor columns owned by the sync or the server (woo_vendor_id, commission_pct, raw, opening_balance) cannot be changed here' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and public.has_perm('vendors.toggle') <> 'F' then
      raise exception 'vendors.toggle = F is required to change a vendor status' using errcode = '42501';
    end if;
    if new.contract is distinct from old.contract and public.has_perm('sensitive.vendor_bank') <> 'F' then
      raise exception 'sensitive.vendor_bank = F is required to change a vendor contract' using errcode = '42501';
    end if;
    if (n - status_cols - contract_cols - contact_cols) is distinct from (o - status_cols - contract_cols - contact_cols)
       and public.has_perm('vendors.edit') <> 'F' then
      raise exception 'vendors.edit = F is required to change a vendor name, legal name, category, aliases, lead days, deposit policy or joining date' using errcode = '42501';
    end if;
    if (n - status_cols - contract_cols - edit_cols) is distinct from (o - status_cols - contract_cols - edit_cols)
       and public.has_perm('vendors.edit') = 'N' then
      raise exception 'vendors.edit (F or P) is required to change a vendor phone, e-mail, address, instagram, store URL or notes' using errcode = '42501';
    end if;
  end if;
  -- Every row write bumps updated_at (a BEFORE trigger may set a column the caller cannot update): members' edits and
  -- the sync's raw-only upsert alike; after the comparisons above, so rule 1 still sees the stored value.
  new.updated_at := now();
  return new;
end
$$;

create or replace trigger vendors_guard_update before update on public.vendors
  for each row execute function public.vendors_guard_update();

revoke execute on function public.vendors_guard_update() from public, anon, authenticated;

-- ---------------------------------------------------------------- Storage: bucket vendor-contracts + policies (guarded)

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('vendor-contracts', 'vendor-contracts', false, 10485760, '{application/pdf,image/png,image/jpeg}')
               on conflict (id) do nothing$s$;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_contracts_select') then
      execute $s$create policy vendor_contracts_select on storage.objects for select to authenticated
                 using (bucket_id = 'vendor-contracts' and (select public.has_perm('sensitive.vendor_bank')) = 'F')$s$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_contracts_insert') then
      execute $s$create policy vendor_contracts_insert on storage.objects for insert to authenticated
                 with check (bucket_id = 'vendor-contracts' and (select public.has_perm('sensitive.vendor_bank')) = 'F')$s$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_contracts_update') then
      execute $s$create policy vendor_contracts_update on storage.objects for update to authenticated
                 using (bucket_id = 'vendor-contracts' and (select public.has_perm('sensitive.vendor_bank')) = 'F')
                 with check (bucket_id = 'vendor-contracts' and (select public.has_perm('sensitive.vendor_bank')) = 'F')$s$;
    end if;
  end if;
end $storage$;
