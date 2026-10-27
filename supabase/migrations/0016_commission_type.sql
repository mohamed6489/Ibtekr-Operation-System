-- 0016_commission_type: the maker's commission type, like Dokan's — `fixed` (one rate + flat fee) or `category_based`
-- (a rate per site category, a child inheriting its parent's figure unless set by hand) — and one RPC that writes the
-- whole commission at once. Uses has_perm / is_admin (0001), profiles, vendors / vendor_rates (0011),
-- vendor_category_rates (0014), vendor_rate_set (0015). The plan: docs/superpowers/plans/2026-10-27-phase-3-4-commission-type.md.
--
-- Decision (plan 3.4, decision 1): vendor_rates.commission_type ('fixed' | 'category_based', default 'fixed') on the same
--   row as rate / flat: with 'fixed' they are the rate; with 'category_based' they are the default (Dokan's `all`) for a
--   category with no figure. vendor_category_rates keeps the figures set by hand only (a parent or a child); rate null =
--   the category inherits again. A category's figure = the nearest hand-set figure on it or its ancestors, else the default.
-- Decision (decision 2): vendor_commission_set(p_vendor, p_type, p_rate, p_flat, p_categories jsonb) — security definer,
--   admin or sensitive.commission = F, rows dated today (Cairo), a same-day change replacing the day's row (decision 12
--   of 3.3); p_categories = [{ "id": <woo category id>, "rate": <0–65 | null>, "flat": <≥ 0 | null> }] (the categories
--   changed; null rate = back to inheriting), at most 1000. vendor_rate_set (0015) now keeps the maker's current type.
--
-- Notes for readers:
-- * 22023: a type outside the two, a rate outside 0–65 (or null), a flat below 0, p_categories not an array / an item
--   without a positive integer id / a rate or flat out of range / more than 1000 items; 42501 outside the rule; P0002 an
--   unknown maker. → the rows' `since` (today, Cairo).
-- * The tables stay add-only for the API roles (no update grant); vendor_rates' table-level grants of 0011 cover the
--   new column (members read it; the RPC writes it).
-- * Re-runnable (add column if not exists, create or replace, grant / revoke). No drop / delete / truncate.

alter table public.vendor_rates add column if not exists commission_type text not null default 'fixed'
  constraint vendor_rates_commission_type_check check (commission_type in ('fixed', 'category_based'));

create or replace function public.vendor_commission_set(p_vendor uuid, p_type text, p_rate numeric, p_flat numeric default null,
                                                         p_categories jsonb default '[]'::jsonb) returns date
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today constant date := (now() at time zone 'Africa/Cairo')::date;
  v_by text;
  v_item jsonb;
  v_id numeric;
  v_rate numeric;
  v_flat numeric;
begin
  if not (public.is_admin() or public.has_perm('sensitive.commission') = 'F') then
    raise exception 'sensitive.commission = F is required to set a maker commission' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('fixed', 'category_based') then
    raise exception 'the commission type must be fixed or category_based' using errcode = '22023';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 65 then
    raise exception 'the rate must be between 0 and 65' using errcode = '22023';
  end if;
  if p_flat is not null and p_flat < 0 then
    raise exception 'the flat fee must be 0 or more' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_categories, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_categories, '[]'::jsonb)) > 1000 then
    raise exception 'the categories must be an array of at most 1000 items' using errcode = '22023';
  end if;
  -- every item checked before any write
  for v_item in select value from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'id') <> 'number' then
      raise exception 'a category item needs a numeric id' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'id')::numeric;
    if v_id <= 0 or v_id <> trunc(v_id) or v_id > 2147483647 then
      raise exception 'a category id must be a positive integer' using errcode = '22023';
    end if;
    if (v_item ? 'rate') and jsonb_typeof(v_item -> 'rate') not in ('number', 'null') then
      raise exception 'a category rate must be a number or null' using errcode = '22023';
    end if;
    if (v_item ? 'flat') and jsonb_typeof(v_item -> 'flat') not in ('number', 'null') then
      raise exception 'a category flat fee must be a number or null' using errcode = '22023';
    end if;
    v_rate := (v_item ->> 'rate')::numeric;
    v_flat := (v_item ->> 'flat')::numeric;
    if v_rate is not null and (v_rate < 0 or v_rate > 65) then
      raise exception 'a category rate must be between 0 and 65' using errcode = '22023';
    end if;
    if v_flat is not null and v_flat < 0 then
      raise exception 'a category flat fee must be 0 or more' using errcode = '22023';
    end if;
  end loop;
  if p_vendor is null or not exists (select 1 from public.vendors v where v.id = p_vendor) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  select p.name into v_by from public.profiles p where p.id = (select auth.uid());

  insert into public.vendor_rates (vendor_id, rate, flat, since, set_by, commission_type)
  values (p_vendor, p_rate, p_flat, v_today, v_by, p_type)
  on conflict (vendor_id, since) do update
    set rate = excluded.rate, flat = excluded.flat, set_by = excluded.set_by, commission_type = excluded.commission_type;

  for v_item in select value from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, flat, since, set_by)
    values (p_vendor, (v_item ->> 'id')::int, (v_item ->> 'rate')::numeric, (v_item ->> 'flat')::numeric, v_today, v_by)
    on conflict (vendor_id, woo_category_id, since) do update set rate = excluded.rate, flat = excluded.flat, set_by = excluded.set_by;
  end loop;

  update public.vendors v
  set commission_pct = (select r.rate from public.vendor_rates r
                        where r.vendor_id = p_vendor and r.since <= v_today
                        order by r.since desc, r.id desc limit 1)
  where v.id = p_vendor;
  return v_today;
end $$;

-- 0015's vendor_rate_set, now keeping the maker's current type on a new day's row (decision 2)
create or replace function public.vendor_rate_set(p_vendor uuid, p_rate numeric, p_flat numeric default null) returns date
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today constant date := (now() at time zone 'Africa/Cairo')::date;
  v_by text;
  v_type text;
begin
  if not (public.is_admin() or public.has_perm('sensitive.commission') = 'F') then
    raise exception 'sensitive.commission = F is required to set a maker rate' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 65 then
    raise exception 'the rate must be between 0 and 65' using errcode = '22023';
  end if;
  if p_flat is not null and p_flat < 0 then
    raise exception 'the flat fee must be 0 or more' using errcode = '22023';
  end if;
  if p_vendor is null or not exists (select 1 from public.vendors v where v.id = p_vendor) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  select p.name into v_by from public.profiles p where p.id = (select auth.uid());
  select r.commission_type into v_type from public.vendor_rates r
  where r.vendor_id = p_vendor and r.since <= v_today order by r.since desc, r.id desc limit 1;
  insert into public.vendor_rates (vendor_id, rate, flat, since, set_by, commission_type)
  values (p_vendor, p_rate, p_flat, v_today, v_by, coalesce(v_type, 'fixed'))
  on conflict (vendor_id, since) do update set rate = excluded.rate, flat = excluded.flat, set_by = excluded.set_by;
  update public.vendors v
  set commission_pct = (select r.rate from public.vendor_rates r
                        where r.vendor_id = p_vendor and r.since <= v_today
                        order by r.since desc, r.id desc limit 1)
  where v.id = p_vendor;
  return v_today;
end $$;

revoke execute on function public.vendor_commission_set(uuid, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.vendor_commission_set(uuid, text, numeric, numeric, jsonb) to authenticated, service_role;
revoke execute on function public.vendor_rate_set(uuid, numeric, numeric) from public, anon;
grant execute on function public.vendor_rate_set(uuid, numeric, numeric) to authenticated, service_role;
