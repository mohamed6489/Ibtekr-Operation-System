-- 0015_rate_today: the maker's rate and the per-category commission are set without an effective date (owner, 27 Oct:
-- "the rate changes like on Dokan — it applies to the new orders, no date"). Two RPCs write the row dated today (Cairo)
-- and replace today's row when one exists, so a second change on the same day is the new figure, not a refusal.
-- Uses has_perm / is_admin (0001), profiles (0001), vendors / vendor_rates (0011, its after-insert trigger
-- vendor_rates_apply), vendor_category_rates (0014). The plan: docs/superpowers/plans/2026-10-27-phase-3-3-vendor-sync.md,
-- decision 12.
--
-- Decision (plan, decision 12): the screen no longer asks for «سارية من». The history stays (one row per day a rate was
--   set, `since` = that day in Cairo), the share arithmetic keeps reading it by date, and the site's own rows (the sync,
--   set_by «الموقع») already replace the day's row the same way. Cost if wrong: an order placed earlier the same day is
--   counted with the later figure when its line carries no commission of its own (the line's commission wins, phase 3).
-- Decision (this file): RPCs, not an update grant — vendor_rates / vendor_category_rates stay add-only for the API roles
--   (no update policy, no update grant); the functions are security definer, check the same rule as the insert policies
--   (sensitive.commission = F; the admin passes), take set_by from the caller's profile (never from the client), and set
--   vendors.commission_pct themselves (the 0011 trigger runs on insert only).
--
-- Notes for readers:
-- * vendor_rate_set(p_vendor uuid, p_rate numeric, p_flat numeric default null) → the row's `since` (today, Cairo).
--   22023: rate outside 0–65 / flat below 0; 42501: not admin and sensitive.commission <> F; P0002: unknown maker.
-- * vendor_category_rate_set(p_vendor uuid, p_category int, p_rate numeric, p_flat numeric default null) → `since`.
--   p_rate null = the category goes back to the maker's rate from today. 22023: a category id that is not positive, a
--   rate outside 0–65, a flat below 0; 42501 / P0002 as above.
-- * Re-runnable (create or replace, grant / revoke). No drop / delete / truncate.

create or replace function public.vendor_rate_set(p_vendor uuid, p_rate numeric, p_flat numeric default null) returns date
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today constant date := (now() at time zone 'Africa/Cairo')::date;
  v_by text;
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
  insert into public.vendor_rates (vendor_id, rate, flat, since, set_by)
  values (p_vendor, p_rate, p_flat, v_today, v_by)
  on conflict (vendor_id, since) do update set rate = excluded.rate, flat = excluded.flat, set_by = excluded.set_by;
  -- the copy of the rate in force (the 0011 trigger runs on insert only; a same-day replace is an update)
  update public.vendors v
  set commission_pct = (select r.rate from public.vendor_rates r
                        where r.vendor_id = p_vendor and r.since <= v_today
                        order by r.since desc, r.id desc limit 1)
  where v.id = p_vendor;
  return v_today;
end $$;

create or replace function public.vendor_category_rate_set(p_vendor uuid, p_category int, p_rate numeric, p_flat numeric default null) returns date
language plpgsql volatile security definer set search_path = public as $$
declare
  v_today constant date := (now() at time zone 'Africa/Cairo')::date;
  v_by text;
begin
  if not (public.is_admin() or public.has_perm('sensitive.commission') = 'F') then
    raise exception 'sensitive.commission = F is required to set a category rate' using errcode = '42501';
  end if;
  if p_category is null or p_category <= 0 then
    raise exception 'the category id must be a positive integer' using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 65) then
    raise exception 'the rate must be between 0 and 65' using errcode = '22023';
  end if;
  if p_flat is not null and p_flat < 0 then
    raise exception 'the flat fee must be 0 or more' using errcode = '22023';
  end if;
  if p_vendor is null or not exists (select 1 from public.vendors v where v.id = p_vendor) then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;
  select p.name into v_by from public.profiles p where p.id = (select auth.uid());
  insert into public.vendor_category_rates (vendor_id, woo_category_id, rate, flat, since, set_by)
  values (p_vendor, p_category, p_rate, p_flat, v_today, v_by)
  on conflict (vendor_id, woo_category_id, since) do update set rate = excluded.rate, flat = excluded.flat, set_by = excluded.set_by;
  return v_today;
end $$;

revoke execute on function public.vendor_rate_set(uuid, numeric, numeric) from public, anon;
revoke execute on function public.vendor_category_rate_set(uuid, int, numeric, numeric) from public, anon;
grant execute on function public.vendor_rate_set(uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.vendor_category_rate_set(uuid, int, numeric, numeric) to authenticated, service_role;
