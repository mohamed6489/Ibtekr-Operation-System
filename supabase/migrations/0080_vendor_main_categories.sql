-- 0080 — «الفئة الأساسية» of a maker = the site's main categories, several, kept in the system only (the owner, 11 Nov — B2 in
-- docs/superpowers/plans/2026-11-11-owner-batch.md: «في اضافة مبتكر الاقسام الاساسية اللي هي ال MAIN CATEGRIES اختار منهم مع
-- امكانية اختيار متعدد و دي هتبقي علي السيستم مش هتسمع في الويب سايت»).
--
-- * vendors.main_categories int[] — ids of woo_categories rows without a parent (the site's main categories), in the order picked.
--   Never sent to the site (push_vendor's fields are unchanged). Members read it; the only write is the RPC
--   vendor_main_categories_set(p_vendor, p_ids) — the admin or vendors.edit = F (the old category's rule): a newly picked id must be
--   a main category of the site (22023 invalid: main_categories), 20 at most, a repeat kept once; an id already on the row stays even
--   if the category later moves or leaves the site, so it never blocks another edit. The same call writes vendors.category = the
--   picked categories' names («Decor، FURNITURE») for whatever reads the text (the assistant's vendors data); none = null.
-- * vendors.category stops being one of the prototype's seven names: the old check becomes a length check (≤ 300).
-- * The old texts that match a main category's name are linked to it (re-runnable).
-- The column guard of 0014 (vendors_guard_update) is untouched: the RPC writes as its owner. Idempotent.

alter table public.vendors add column if not exists main_categories int[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_main_categories_check') then
    alter table public.vendors add constraint vendors_main_categories_check
      check (cardinality(main_categories) <= 20 and array_position(main_categories, null) is null);
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_category_check') then
    alter table public.vendors drop constraint vendors_category_check;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_category_len') then
    alter table public.vendors add constraint vendors_category_len check (category is null or char_length(category) <= 300);
  end if;
end $$;

grant select (main_categories) on public.vendors to authenticated;

-- ---------------------------------------------------------------- the write: vendor_main_categories_set

create or replace function public.vendor_main_categories_set(p_vendor uuid, p_ids int[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur int[];
  ids int[];
  bad int;
  names text;
begin
  if not (public.is_admin() or public.has_perm('vendors.edit') = 'F') then
    raise exception 'vendors.edit = F is required to change a maker''s main categories' using errcode = '42501';
  end if;
  select main_categories into cur from public.vendors where id = p_vendor for update;
  if not found then
    raise exception 'maker not found' using errcode = 'P0002';
  end if;
  -- a repeat kept once, in the order picked
  ids := array(select x from unnest(coalesce(p_ids, '{}'::int[])) with ordinality as t (x, n) where x is not null group by x order by min(n));
  if cardinality(ids) > 20 then
    raise exception 'invalid: main_categories' using errcode = '22023';
  end if;
  select x into bad
    from unnest(ids) as x
   where not (x = any (cur))
     and not exists (select 1 from public.woo_categories c where c.id = x and coalesce(c.parent_id, 0) = 0)
   limit 1;
  if bad is not null then
    raise exception 'invalid: main_categories' using errcode = '22023';
  end if;
  select string_agg(c.name, '، ' order by t.n) into names
    from unnest(ids) with ordinality as t (x, n) join public.woo_categories c on c.id = t.x;
  update public.vendors set main_categories = ids, category = nullif(left(coalesce(names, ''), 300), '') where id = p_vendor;
  return jsonb_build_object('main_categories', to_jsonb(ids), 'category', nullif(left(coalesce(names, ''), 300), ''));
end
$$;

revoke execute on function public.vendor_main_categories_set(uuid, int[]) from public, anon;
grant execute on function public.vendor_main_categories_set(uuid, int[]) to authenticated, service_role;

-- ---------------------------------------------------------------- the old texts that name a main category, linked (re-runnable)

update public.vendors v
   set main_categories = array[c.id]
  from public.woo_categories c
 where coalesce(c.parent_id, 0) = 0
   and v.category is not null
   and lower(btrim(c.name)) = lower(btrim(v.category))
   and v.main_categories = '{}';
