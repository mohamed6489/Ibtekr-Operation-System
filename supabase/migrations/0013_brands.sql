-- 0013_brands: phase 3.2 (brands): a maker may own several brands, a brand moves to another maker from a date
-- (temporarily, until a return date, or for good), and a brand may carry a special rate. Three tables — brands (the
-- name the products sell under; usually a Dokan store), brand_owners (the ownership history: one row per change, the
-- owner on a date D is the last row whose `since` is not after D) and brand_rates (the special rate, with an effective
-- date; null = no special rate from that date on) — with their column-list grants, their RLS, the two guards
-- brands_guard / brand_owners_guard, the after-insert trigger on vendors (vendors_brand_after_insert: every new maker
-- gets a brand named after them), the re-runnable backfill of the makers already in the table, and the two reporting
-- functions brand_owner_at / store_owner_at.
-- Uses has_perm / is_admin (0001), the role matrix (0003: vendors.view / vendors.edit / sensitive.commission — no new
-- key), vendors and its guard (0007 / 0011), the grant rules (0004).
--
-- Decision (plan, decision 1): the brand is the name the products sell under, i.e. mostly a Dokan store. Every vendors
--   row gets a brand of its own name: a store (woo_vendor_id not null) gets a brand tied to it (store_vendor_id = the
--   row's id) and the store's orders count for whoever owns that brand on the order's day; a hand-added maker gets a
--   brand without a store. The default owner is the maker. The maker who is paid = the brand's owner on the order
--   date. Dokan is read-only, the sub-order carries its store, so a transfer is recorded here only. Cost if wrong: a
--   wrong transfer is corrected by another transfer from a later date (the same date is refused, 23505).
-- Decision (decision 2): the tables, exactly as the plan writes them.
--   * brands: name 1–80 characters, unique on lower(btrim(name)) among brands (23505 → «الاسم ده مأخوذ»); code 1–3 of
--     A–Z / 0–9 (informational, the SKU stays the store's); aliases; store_vendor_id (unique, on delete cascade — the
--     server alone sets it: no insert / update grant on it for the members); origin_vendor_id (the maker the brand was
--     created for, on delete cascade); created_by; created_at / updated_at.
--   * brand_owners: brand_id (on delete cascade), vendor_id (NO cascade: a maker who holds somebody else's brand cannot
--     be deleted — 23503 → «عليه براندات»; their own brands go with them through brands.origin_vendor_id), since,
--     return_on (null or > since: 23514), reason (≤ 200: 23514), set_by, created_at; unique (brand_id, since). Rows
--     are only added (no update / delete grant or policy for the members): a transfer and a return are new rows.
--   * brand_rates: brand_id (on delete cascade), rate (null, or 0–65: 23514), since, set_by, created_at; unique
--     (brand_id, since); only added. RLS like vendor_rates: select / insert with sensitive.commission = F.
--   * RLS of brands / brand_owners: select with vendors.view <> N; insert (and update, brands only) as admin or
--     vendors.edit = F — the update policy's `using` is vendors.view (the 0011 / 0012 pattern) so a member who sees the
--     row but may not change it gets 42501, never a silent "0 rows". No delete for the members: the cascade only.
--   * Grants by column list: brands — select on every column, insert (name, code, aliases, origin_vendor_id,
--     created_by), update (name, code, aliases); brand_owners — select on every column, insert (brand_id, vendor_id,
--     since, return_on, reason, set_by); brand_rates — select on every column, insert (brand_id, rate, since, set_by);
--     service_role everything. No truncate / references / trigger for any API role; nothing for anon.
--   * Guards (anon / authenticated only, like 0011 / 0012): brands_guard (before update) refuses any column but
--     name / code / aliases with 42501 — a second layer under the column grants, which refuse first with "permission
--     denied for column" — and bumps updated_at for every writer; brand_owners_guard (before insert) refuses a `since`
--     older than the brand's last `since` (22023 'since before the last transfer') and a vendor_id equal to the
--     brand's current owner, i.e. the owner of the latest row (22023 'same vendor'). An equal `since` is the unique
--     key's 23505: the client transfers again from a later date.
--   * The trigger vendors_brand_after_insert (after insert on vendors, a security definer function owned by the
--     migration runner, postgres, search_path pinned): when no brand has the same name (lower / btrim) it inserts the
--     brand (name = the maker's name, code = the first Latin letter of the name upper-cased, else 'X', aliases = the
--     maker's aliases, store_vendor_id = the row's id when woo_vendor_id is not null, origin = the row's id,
--     created_by 'system') and the first brand_owners row (vendor_id = the maker, since = coalesce(joined_at,
--     current_date), set_by 'system'). It runs for the sync's inserts (service_role) and the popup's (authenticated)
--     alike, with no change to the Edge Functions or the adapter: the function runs as its owner, so the brand rows
--     pass RLS and the owners guard (which sees postgres, not the member). A taken name → no automatic brand (the team
--     adds one by hand).
--   * The backfill, in this file: the same logic (the same function) for every vendors row without a brand, guarded by
--     `not exists` so a re-run inserts nothing. Live: 56 rows → 56 brands + 56 owner rows (the names are distinct).
--   * brand_owner_at(p_brand uuid, p_date date) / store_owner_at(p_store uuid, p_date date): stable, security invoker
--     (RLS applies to the caller), execute for authenticated / service_role only. For the coming reports; the UI
--     computes locally.
-- Decision (this file): the trigger and the backfill share one function, vendor_brand_auto(uuid) → boolean (true when
--   a brand was made), definer like the trigger function, not executable by the API roles. It never raises for a name
--   it cannot use: a taken name, a blank name or one over 80 characters leave the maker without an automatic brand
--   (the maker's insert must never fail because of the brand — the sync writes new stores through this trigger), and
--   the brand insert is `on conflict do nothing` on the name index so two makers of the same name inserted at once
--   make one brand, not an error. The backfill walks the makers by created_at, id: when two existing rows share a
--   name, the older one gets the brand.
-- Decision (this file): brand_owners.set_by of the automatic row is 'system', like brands.created_by (the plan names
--   created_by only). An owner lookup with a null date reads as current_date. store_owner_at of a store without a
--   brand — a taken name, or a uuid that is no store at all — is the store itself.
--
-- Notes for readers:
-- * Idempotent: every statement is guarded (if not exists / a pg_policies check / not exists on the backfill) or
--   re-runnable (create or replace, grant / revoke); a second run changes nothing. No drop / delete / truncate
--   statements in this file.
-- * The select grants are table-level (every column is readable by whoever passes the policy: nothing sensitive sits
--   in these tables — the rate is behind its own policy), so PostgREST `select=*` works here; the adapter still names
--   its columns like it does for vendors. The insert / update grants are column lists: id, store_vendor_id,
--   created_at, updated_at (and origin_vendor_id / created_by on update) cannot be written from the API with any
--   value, whatever the policies say; brand_owners / brand_rates rows cannot be updated at all.
-- * The guards apply to anon / authenticated only (phase-0 pattern): postgres / service_role and the definer
--   functions pass them; brands_guard still bumps updated_at for them.
-- * The owner on a date: the last row with since <= the date (ties on `since` cannot exist: unique), else the first
--   row (a date before the first `since` — orders older than the brand's history — belong to the first owner).
--   return_on is a note for the screen («مؤقت لحد …»): the return itself is a new row the team adds (the plan's
--   Later list: ending a temporary transfer automatically on return_on).
-- * rule 4: explicit grants; sequences usable by the writers; nothing for anon.

-- ---------------------------------------------------------------- brands

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  code text not null check (code ~ '^[A-Z0-9]{1,3}$'),
  aliases text[] not null default '{}',
  store_vendor_id uuid unique references public.vendors (id) on delete cascade,
  origin_vendor_id uuid not null references public.vendors (id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one brand per name, whatever the case and the surrounding spaces (23505 on a duplicate)
create unique index if not exists brands_name_key on public.brands (lower(btrim(name)));
create index if not exists brands_origin_vendor_id_idx on public.brands (origin_vendor_id);

-- ---------------------------------------------------------------- brand_owners: the ownership history

create table if not exists public.brand_owners (
  id bigserial primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id),
  since date not null,
  return_on date check (return_on is null or return_on > since),
  reason text check (reason is null or length(reason) <= 200),
  set_by text,
  created_at timestamptz not null default now(),
  unique (brand_id, since)
);

create index if not exists brand_owners_vendor_id_idx on public.brand_owners (vendor_id);

-- ---------------------------------------------------------------- brand_rates: the special rate, with an effective date

create table if not exists public.brand_rates (
  id bigserial primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  rate numeric(5,2) check (rate is null or rate between 0 and 65),
  since date not null,
  set_by text,
  created_at timestamptz not null default now(),
  unique (brand_id, since)
);

-- ---------------------------------------------------------------- RLS

alter table public.brands enable row level security;
alter table public.brand_owners enable row level security;
alter table public.brand_rates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_select') then
    create policy brands_select on public.brands for select to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_insert') then
    create policy brands_insert on public.brands for insert to authenticated
      with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
  end if;
  -- using = who may see the row (vendors.view), with check = who may change it (the 0011 / 0012 pattern: 42501, not 0 rows)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brands' and policyname = 'brands_update') then
    create policy brands_update on public.brands for update to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N')
      with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brand_owners' and policyname = 'brand_owners_select') then
    create policy brand_owners_select on public.brand_owners for select to authenticated
      using ((select public.has_perm('vendors.view')) <> 'N');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brand_owners' and policyname = 'brand_owners_insert') then
    create policy brand_owners_insert on public.brand_owners for insert to authenticated
      with check ((select public.is_admin()) or (select public.has_perm('vendors.edit')) = 'F');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brand_rates' and policyname = 'brand_rates_select') then
    create policy brand_rates_select on public.brand_rates for select to authenticated
      using ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'brand_rates' and policyname = 'brand_rates_insert') then
    create policy brand_rates_insert on public.brand_rates for insert to authenticated
      with check ((select public.has_perm('sensitive.commission')) = 'F');
  end if;
end $$;

-- ---------------------------------------------------------------- grants (rule 4; see the header)

grant select on public.brands to authenticated;
grant insert (name, code, aliases, origin_vendor_id, created_by) on public.brands to authenticated;
grant update (name, code, aliases) on public.brands to authenticated;

grant select on public.brand_owners to authenticated;
grant insert (brand_id, vendor_id, since, return_on, reason, set_by) on public.brand_owners to authenticated;

grant select on public.brand_rates to authenticated;
grant insert (brand_id, rate, since, set_by) on public.brand_rates to authenticated;

grant select, insert, update, delete on public.brands, public.brand_owners, public.brand_rates to service_role;
grant usage, select on sequence public.brand_owners_id_seq, public.brand_rates_id_seq to authenticated, service_role;
revoke truncate, references, trigger on public.brands, public.brand_owners, public.brand_rates from anon, authenticated, service_role;

-- ---------------------------------------------------------------- brands_guard: the column guard (before update)

-- API roles: name / code / aliases may change; every other column (id, store_vendor_id, origin_vendor_id, created_by,
-- created_at, updated_at) is the server's → 42501. Every row write bumps updated_at (a BEFORE trigger may set a column
-- the caller cannot update), after the comparison, so the rule still sees the stored value.
create or replace function public.brands_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  client_cols constant text[] := array['name', 'code', 'aliases'];
begin
  if current_user in ('anon', 'authenticated') then
    if (to_jsonb(new) - client_cols) is distinct from (to_jsonb(old) - client_cols) then
      raise exception 'brand columns owned by the server (id, store_vendor_id, origin_vendor_id, created_by, created_at, updated_at) cannot be changed here' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace trigger brands_guard before update on public.brands
  for each row execute function public.brands_guard();

revoke execute on function public.brands_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- brand_owners_guard: the history rules (before insert)

-- API roles: a new row's `since` may not be older than the brand's last `since` (22023), and the new owner may not be
-- the current one — the owner of the latest row by (since, id) (22023). An equal `since` is left to the unique key
-- (23505). The server (the sync, the backfill, the definer functions) is trusted.
create or replace function public.brand_owners_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  last_row record;
begin
  if current_user in ('anon', 'authenticated') then
    select o.since, o.vendor_id into last_row
    from public.brand_owners o
    where o.brand_id = new.brand_id
    order by o.since desc, o.id desc
    limit 1;
    if found then
      if new.since < last_row.since then
        raise exception 'since before the last transfer' using errcode = '22023';
      end if;
      if new.vendor_id = last_row.vendor_id then
        raise exception 'same vendor' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end
$$;

create or replace trigger brand_owners_guard before insert on public.brand_owners
  for each row execute function public.brand_owners_guard();

revoke execute on function public.brand_owners_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- the automatic brand (the trigger and the backfill)

-- The brand of a maker's own name, with its first owner row. True when a brand was made; false when the maker already
-- has one, the name is taken (lower / btrim), blank or over 80 characters. Definer (owner: the migration runner,
-- postgres): the inserts pass RLS and the owners guard whoever inserted the maker. Never raises for a usable maker.
create or replace function public.vendor_brand_auto(p_vendor uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v public.vendors%rowtype;
  v_name text;
  v_brand uuid;
begin
  select * into v from public.vendors where id = p_vendor;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.brands b where b.origin_vendor_id = v.id or b.store_vendor_id = v.id) then
    return false;
  end if;
  v_name := btrim(v.name);
  if v_name is null or length(v_name) not between 1 and 80 then
    return false;
  end if;
  if exists (select 1 from public.brands b where lower(btrim(b.name)) = lower(v_name)) then
    return false;
  end if;
  insert into public.brands (name, code, aliases, store_vendor_id, origin_vendor_id, created_by)
  values (v_name,
          coalesce(upper(substring(v_name from '[A-Za-z]')), 'X'),
          coalesce(v.aliases, '{}'),
          case when v.woo_vendor_id is not null then v.id end,
          v.id,
          'system')
  on conflict (lower(btrim(name))) do nothing
  returning id into v_brand;
  if v_brand is null then
    return false; -- the same name landed first in a concurrent insert
  end if;
  insert into public.brand_owners (brand_id, vendor_id, since, set_by)
  values (v_brand, v.id, coalesce(v.joined_at, current_date), 'system');
  return true;
end
$$;

revoke execute on function public.vendor_brand_auto(uuid) from public, anon, authenticated;

create or replace function public.vendors_brand_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.vendor_brand_auto(new.id);
  return null;
end
$$;

create or replace trigger vendors_brand_after_insert after insert on public.vendors
  for each row execute function public.vendors_brand_after_insert();

revoke execute on function public.vendors_brand_after_insert() from public, anon, authenticated;

-- The backfill: every maker without a brand, oldest first (a re-run finds none). The function skips a taken name.
do $$
declare r record;
begin
  for r in
    select v.id from public.vendors v
    where not exists (select 1 from public.brands b where b.origin_vendor_id = v.id or b.store_vendor_id = v.id)
    order by v.created_at, v.id
  loop
    perform public.vendor_brand_auto(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------- the owner on a date (for the reports)

-- The maker who owned the brand on p_date (null → today): the last row with since <= p_date, else the first row; null
-- when the brand has no history the caller may see (RLS applies: security invoker).
create or replace function public.brand_owner_at(p_brand uuid, p_date date) returns uuid
language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select o.vendor_id from public.brand_owners o
     where o.brand_id = p_brand and o.since <= coalesce(p_date, current_date)
     order by o.since desc, o.id desc limit 1),
    (select o.vendor_id from public.brand_owners o
     where o.brand_id = p_brand
     order by o.since asc, o.id asc limit 1))
$$;

-- The maker paid for a store's sub-order on p_date: the owner of the store's brand that day, else the store itself
-- (a store without a brand, or a uuid that is no store).
create or replace function public.store_owner_at(p_store uuid, p_date date) returns uuid
language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select public.brand_owner_at(b.id, p_date) from public.brands b where b.store_vendor_id = p_store),
    p_store)
$$;

revoke execute on function public.brand_owner_at(uuid, date) from public, anon;
revoke execute on function public.store_owner_at(uuid, date) from public, anon;
grant execute on function public.brand_owner_at(uuid, date) to authenticated, service_role;
grant execute on function public.store_owner_at(uuid, date) to authenticated, service_role;
