-- 0014_vendor_sync: phase 3.3 (store data two-way with Dokan, the commission per category): the synced-store columns
-- on vendors (contact_name, address_parts, social, the read-only mirrors logo_url / banner_url / woo_payment_methods,
-- the sync's own woo_snapshot / push_pending / woo_synced_at) with their column-list grants and the widened guard
-- vendors_guard_update, vendor_rates.flat (the site's flat fee, display only), the two new tables
-- vendor_category_rates (the per-category commission, with an effective date) and woo_categories (the site's product
-- category names, written by the sync).
-- Uses has_perm / is_admin (0001), the role matrix (0003: vendors.view / vendors.edit / vendors.toggle /
-- sensitive.commission — no new key), vendors and its guard (0007 / 0011 / 0012), vendor_rates (0011), the grant rules
-- (0004). The plan: docs/superpowers/plans/2026-10-27-phase-3-3-vendor-sync.md.
--
-- Decision (plan, decision 1): the fields synced in both directions are name, phone, email, contact_name (new ↔
--   first_name + last_name), address_parts (new jsonb with the six Dokan keys street_1 / street_2 / city / state /
--   zip / country ↔ address; the existing text column `address` = the filled parts joined «شارع 1، شارع 2، المدينة،
--   المحافظة», written with every change of the parts by the adapter and by the sync), social (new jsonb with the eight
--   keys fb / instagram / twitter / youtube / linkedin / pinterest / threads / flickr ↔ social) and status (↔ enabled:
--   inactive ↔ false; active / leave ↔ true — `leave` is ours alone). Read-only from the site: logo_url (gravatar),
--   banner_url (banner), woo_payment_methods (the keys of active_payment_methods). Never stored: payment (bank / PayPal
--   data), location, store_toc, switch_url, _links. Cost if wrong: a field more or less is a written decision.
-- Decision (decision 2): the maker's rate here (vendor_rates, effective today) = Dokan's effective percentage
--   (admin_commission with type fixed, admin_category_commission.all.percentage with category_based). The flat fee
--   (admin_additional_fee / all.flat) is stored for display in vendor_rates.flat (new, nullable, ≥ 0) and takes no
--   part in the share arithmetic (the line's own commission wins when present, decision 4 of phase 3). The per-category
--   commission lives in vendor_category_rates: id, vendor_id, woo_category_id (the WooCommerce category id), rate
--   (0–65, or null = removed from that date on), flat (≥ 0), since, set_by, created_at; unique (vendor_id,
--   woo_category_id, since); rows are only added, like vendor_rates; read / written with sensitive.commission = F; the
--   effective row on a date is the last `since` not after it. The category names come from the site: woo_categories
--   (id, name, slug, parent_id, updated_at), filled by the new sync part `categories` (wc/v3/products/categories),
--   readable with vendors.view <> N, never deleted (a rate may still name a category the site dropped).
-- Decision (decision 3): the conflict rule needs a snapshot — vendors.woo_snapshot (jsonb, service_role only like raw:
--   the synced fields as the site had them at the last run or push, the e-mail and phone among them), push_pending
--   (jsonb: the field names whose push to the site failed or waited for WOO_PUSH_ENABLED — names only, readable by
--   the members so the screen can say «في انتظار الإرسال»), woo_synced_at (the last run or push that touched the row).
-- Decision (decision 7): the grants by column. Members: SELECT on every new column but woo_snapshot; INSERT and
--   UPDATE on contact_name, address_parts, social (and `address`, already granted) under the contact rule of the
--   guard (vendors.edit in (F, P)); logo_url, banner_url, woo_payment_methods, woo_snapshot, push_pending,
--   woo_synced_at belong to the server (the sync, push_vendor) → the guard refuses them with 42501 for the API roles,
--   and no insert / update grant exists on them. service_role keeps its table-level grants (they cover new columns).
--   vendor_rates.flat is covered by the table-level grants of 0011 (members select + insert).
-- Decision (this file): no backfill. address_parts / social / contact_name of the 55 stores are filled by the first
--   `vendors` run after the deploy (the first-run rule of decision 4 a: an empty field here takes the site's value, a
--   filled one stays), not by SQL — the values live on the site, not in raw. The existing `address` text of a maker
--   is replaced by the joined parts only when the parts change (the sync or the adapter writes both together).
-- Decision (this file): woo_categories.parent_id carries no foreign key — the site's pages arrive in any order, and a
--   parent may be dropped there while children stay. The screen uses the names only.
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (add column if not exists / create table if not exists / a pg_policies
--   check) or re-runnable (create or replace, grant / revoke); a second run changes nothing. No drop / delete /
--   truncate statements in this file.
-- * The widened guard keeps the 0011 rules and messages: status ← vendors.toggle = F; contract ← sensitive.vendor_bank
--   = F; name / legal_name / category / aliases / lead_days / deposit_policy / joined_at ← vendors.edit = F; phone /
--   alt_phone / email / address / address_parts / contact_name / social / instagram / store_url / notes ← vendors.edit
--   in (F, P); every other column → 42501 (the message now names the phase-3.3 server columns). It still bumps
--   updated_at for every writer.
-- * vendor_category_rates: select / insert policies with sensitive.commission = F (the admin only in the built-in
--   matrix of 0003); no update / delete policy and no such grant for the members; the insert grant is a column list
--   (vendor_id, woo_category_id, rate, flat, since, set_by) so id / created_at cannot be planted. unique (vendor_id,
--   woo_category_id, since) also indexes the foreign key.
-- * woo_categories: RLS on; one select policy for authenticated (vendors.view <> N); no insert / update / delete policy
--   or grant for the members; the sync writes as service_role (bypasses RLS on Supabase).
-- * rule 4: explicit grants; sequences usable by the writers; no truncate / references / trigger for any API role on
--   the new tables; nothing for anon.

-- ---------------------------------------------------------------- vendors: the synced-store columns (decisions 1 / 3)

alter table public.vendors add column if not exists contact_name text;
alter table public.vendors add column if not exists address_parts jsonb;
alter table public.vendors add column if not exists social jsonb;
alter table public.vendors add column if not exists logo_url text;
alter table public.vendors add column if not exists banner_url text;
alter table public.vendors add column if not exists woo_payment_methods text[];
alter table public.vendors add column if not exists woo_snapshot jsonb;
alter table public.vendors add column if not exists push_pending jsonb;
alter table public.vendors add column if not exists woo_synced_at timestamptz;

-- ---------------------------------------------------------------- vendor_rates.flat (decision 2)

alter table public.vendor_rates add column if not exists flat numeric(10,2)
  constraint vendor_rates_flat_check check (flat is null or flat >= 0);

-- ---------------------------------------------------------------- vendor_category_rates (decision 2)

create table if not exists public.vendor_category_rates (
  id bigserial primary key,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  woo_category_id int not null check (woo_category_id > 0),
  rate numeric(5,2) check (rate is null or rate between 0 and 65),
  flat numeric(10,2) check (flat is null or flat >= 0),
  since date not null,
  set_by text,
  created_at timestamptz not null default now(),
  unique (vendor_id, woo_category_id, since)
);

alter table public.vendor_category_rates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_category_rates' and policyname = 'vendor_category_rates_select') then
    create policy vendor_category_rates_select on public.vendor_category_rates for select to authenticated
      using ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_category_rates' and policyname = 'vendor_category_rates_insert') then
    create policy vendor_category_rates_insert on public.vendor_category_rates for insert to authenticated
      with check ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
end $$;

-- ---------------------------------------------------------------- woo_categories (decision 2)

create table if not exists public.woo_categories (
  id int primary key,
  name text not null,
  slug text,
  parent_id int,
  updated_at timestamptz not null default now()
);

alter table public.woo_categories enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'woo_categories' and policyname = 'woo_categories_select') then
    create policy woo_categories_select on public.woo_categories for select to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N');
  end if;
end $$;

-- ---------------------------------------------------------------- grants (rule 4; see the header)

-- vendors: the members read every new column but the snapshot and write the three contact columns; the server owns
-- the rest. service_role's table-level grants of 0011 cover the new columns.
grant select (contact_name, address_parts, social, logo_url, banner_url, woo_payment_methods, push_pending, woo_synced_at)
  on public.vendors to authenticated;
grant insert (contact_name, address_parts, social) on public.vendors to authenticated;
grant update (contact_name, address_parts, social) on public.vendors to authenticated;

grant select on public.vendor_category_rates to authenticated;
grant insert (vendor_id, woo_category_id, rate, flat, since, set_by) on public.vendor_category_rates to authenticated;
grant select, insert, update, delete on public.vendor_category_rates to service_role;
grant usage, select on sequence public.vendor_category_rates_id_seq to authenticated, service_role;

grant select on public.woo_categories to authenticated;
grant select, insert, update, delete on public.woo_categories to service_role;

revoke truncate, references, trigger on public.vendor_category_rates, public.woo_categories from anon, authenticated, service_role;

-- ---------------------------------------------------------------- vendors: the column guard, widened (decision 7)

-- API roles: status needs vendors.toggle = F; contract needs sensitive.vendor_bank = F; name / legal_name / category /
-- aliases / lead_days / deposit_policy / joined_at need vendors.edit = F; phone / alt_phone / email / address /
-- address_parts / contact_name / social / instagram / store_url / notes need vendors.edit in (F, P); every other
-- column (woo_vendor_id, commission_pct, raw, opening_balance, logo_url, banner_url, woo_payment_methods,
-- woo_snapshot, push_pending, woo_synced_at, …) is the sync's or the server's → 42501. One clear message per rule.
create or replace function public.vendors_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare
  status_cols constant text[] := array['status'];
  contract_cols constant text[] := array['contract'];
  edit_cols constant text[] := array['name', 'legal_name', 'category', 'aliases', 'lead_days', 'deposit_policy', 'joined_at'];
  contact_cols constant text[] := array['phone', 'alt_phone', 'email', 'address', 'address_parts', 'contact_name', 'social', 'instagram', 'store_url', 'notes'];
  n jsonb;
  o jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    n := to_jsonb(new);
    o := to_jsonb(old);
    if (n - status_cols - contract_cols - edit_cols - contact_cols) is distinct from (o - status_cols - contract_cols - edit_cols - contact_cols) then
      raise exception 'vendor columns owned by the sync or the server (woo_vendor_id, commission_pct, raw, opening_balance, logo_url, banner_url, woo_payment_methods, woo_snapshot, push_pending, woo_synced_at) cannot be changed here' using errcode = '42501';
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
      raise exception 'vendors.edit (F or P) is required to change a vendor phone, e-mail, address, contact name, social links, instagram, store URL or notes' using errcode = '42501';
    end if;
  end if;
  -- Every row write bumps updated_at (a BEFORE trigger may set a column the caller cannot update): members' edits and
  -- the sync's writes alike; after the comparisons above, so rule 1 still sees the stored value.
  new.updated_at := now();
  return new;
end
$$;

-- the trigger of 0011 keeps pointing at the replaced function; re-created here so a fresh database gets it too
create or replace trigger vendors_guard_update before update on public.vendors
  for each row execute function public.vendors_guard_update();

revoke execute on function public.vendors_guard_update() from public, anon, authenticated;
