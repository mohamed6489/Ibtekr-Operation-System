-- 0095_statuses_editable: the statuses in «الإعدادات › القوائم والحالات» — add, delete, order, rename (shown name) and the
-- WooCommerce mapping (the owner, 14 Nov 2026 — docs/superpowers/plans/2026-11-14-owner-batch-2.md decision 22; his answer: a new
-- order status «بتتحسب زي» a base status). Uses 0002 (status_map), 0007 (orders / order_items, the guards), 0018 / 0094 (the
-- product statuses), 0033 (orders_v), 0093 (settings_public).
--
-- * Order statuses: the nine base ones stay the values every report, account, delay rule and automation reads. A new status is a
--   status_map row with `base` (one of the nine) and its own WooCommerce slug (optional — none = its base's slug). An order in it
--   keeps the base in orders.status and the new one in orders.status_custom, so everything keyed on orders.status treats it as its
--   base («بتتحسب زي»), and the sync / push map it by its own row. A base row is never deleted nor renamed; an added one is deleted
--   only when no order carries it. Every write goes through the admin RPCs below (the guard refuses the rest).
-- * Confirmation and product statuses: the base lists stay; the admin adds his own in the settings row «lists» (`statusAdded`
--   { confirm, sub }), and the fixed checks become guards that accept the base list or the added one (a row keeps a value that is
--   later removed — like 0093's expense types). `statusOrder` keeps the admin's order of every list (display only).
-- Re-runnable.

-- 1. status_map: the base of an added status, the slug's shape
alter table public.status_map add column if not exists base text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'status_map_base_check') then
    alter table public.status_map add constraint status_map_base_check
      check (base is null or base in ('معلّق', 'قيد الانتظار', 'جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن', 'مكتمل', 'استرجاع', 'ملغي', 'فشل'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'status_map_slug_check') then
    alter table public.status_map add constraint status_map_slug_check check (woo_status is null or woo_status ~ '^[a-z0-9][a-z0-9-]{0,39}$');
  end if;
end $$;

create or replace function public.status_base(p_status text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select m.base from public.status_map m where m.system_status = p_status and m.base is not null), p_status)
$$;
revoke execute on function public.status_base(text) from public, anon;
grant execute on function public.status_base(text) to authenticated, service_role;

-- the guard on a member's direct write (the admin may write status_map under its 0002 policies): a base row (base null) is never
-- deleted or renamed and never gets a base; an added row is never renamed and is deleted only when no order carries it. Like the
-- 0007 guards it binds anon / authenticated only — the migrations and the RPCs below (which check the same) write as the owner.
create or replace function public.status_map_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') or not public.is_admin() then return coalesce(new, old); end if; -- a non-admin is refused by the 0002 policies
  if tg_op = 'DELETE' then
    if old.base is null then raise exception 'invalid: base status' using errcode = '22023'; end if;
    if exists (select 1 from public.orders where status_custom = old.system_status) then raise exception 'in_use' using errcode = '23503'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.system_status is distinct from old.system_status then raise exception 'invalid: rename' using errcode = '22023'; end if;
    if new.base is distinct from old.base then raise exception 'invalid: base' using errcode = '22023'; end if;
  end if;
  if tg_op = 'INSERT' and (new.base is null or length(btrim(new.system_status)) < 2 or length(new.system_status) > 30 or new.system_status ~ '[<>]') then
    raise exception 'invalid: name' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.status_map_guard() from public, anon, authenticated;
drop trigger if exists status_map_guard on public.status_map;
create trigger status_map_guard before insert or update or delete on public.status_map
  for each row execute function public.status_map_guard();

-- 2. orders.status_custom: the added status an order is in (its base in orders.status)
alter table public.orders add column if not exists status_custom text;
grant select (status_custom), update (status_custom) on public.orders to authenticated;

create or replace function public.orders_status_custom() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status_custom is not null then
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status_custom is not distinct from old.status_custom then
      new.status_custom := null; -- the base changed by itself (the sync, a plain status): the added one no longer holds
    elsif not exists (select 1 from public.status_map m where m.system_status = new.status_custom and m.base = new.status) then
      raise exception 'invalid: status_custom' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.orders_status_custom() from public, anon, authenticated;
drop trigger if exists orders_status_custom on public.orders;
create trigger orders_status_custom before insert or update of status, status_custom on public.orders
  for each row execute function public.orders_status_custom();

-- the member guard (0007): status_custom is one of the status columns (orders.status = F)
create or replace function public.orders_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare
  status_cols constant text[] := array['status', 'status_custom', 'confirm', 'confirm_at', 'confirm_note', 'cancel', 'ret'];
  edit_cols constant text[] := array['note', 'customer_city', 'customer_address', 'deposit'];
  n jsonb;
  o jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    n := to_jsonb(new);
    o := to_jsonb(old);
    if (n - status_cols - edit_cols) is distinct from (o - status_cols - edit_cols) then
      raise exception 'order columns synced from WooCommerce cannot be changed here' using errcode = '42501';
    end if;
    if (n - edit_cols) is distinct from (o - edit_cols) and public.has_perm('orders.status') <> 'F' then
      raise exception 'orders.status = F is required to change an order status or confirmation' using errcode = '42501';
    end if;
    if (n - status_cols) is distinct from (o - status_cols) and public.has_perm('orders.edit') = 'N' then
      raise exception 'orders.edit is required to change an order note, address or deposit' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- orders_v stays as it is (0010 / 0033 re-run in the migrate tests with its 26 columns): the members read status_custom from orders
-- itself (the column grant above, under the orders RLS).

-- 3. the admin's order statuses (RPCs; the admin only)
create or replace function public.order_status_add(p_name text, p_base text, p_slug text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if length(v_name) < 2 or length(v_name) > 30 or v_name ~ '[<>]' then raise exception 'invalid: name' using errcode = '23514'; end if;
  if exists (select 1 from public.status_map where system_status = v_name) then raise exception 'invalid: exists' using errcode = '23505'; end if;
  if p_base is null or p_base not in ('معلّق', 'قيد الانتظار', 'جاري التنفيذ', 'جاهز للشحن', 'قيد الشحن', 'مكتمل', 'استرجاع', 'ملغي', 'فشل') then raise exception 'invalid: base' using errcode = '22023'; end if;
  insert into public.status_map (system_status, woo_status, direction, sort, base)
  values (v_name, v_slug, 'both', coalesce((select max(sort) from public.status_map), 0) + 1, p_base);
  perform public.log_activity('settings.status.add', 'status_map', v_name, null, jsonb_build_object('base', p_base, 'slug', v_slug));
end $$;
revoke execute on function public.order_status_add(text, text, text) from public, anon;
grant execute on function public.order_status_add(text, text, text) to authenticated, service_role;

create or replace function public.order_status_slug(p_name text, p_slug text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_slug text := nullif(btrim(coalesce(p_slug, '')), ''); v_old text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select woo_status into v_old from public.status_map where system_status = p_name for update;
  if not found then raise exception 'no such status' using errcode = 'P0002'; end if;
  update public.status_map set woo_status = v_slug where system_status = p_name;
  perform public.log_activity('settings.status.slug', 'status_map', p_name, to_jsonb(v_old), to_jsonb(v_slug));
end $$;
revoke execute on function public.order_status_slug(text, text) from public, anon;
grant execute on function public.order_status_slug(text, text) to authenticated, service_role;

create or replace function public.order_status_delete(p_name text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.status_map where system_status = p_name) then raise exception 'no such status' using errcode = 'P0002'; end if;
  if exists (select 1 from public.status_map where system_status = p_name and base is null) then raise exception 'invalid: base status' using errcode = '22023'; end if;
  if exists (select 1 from public.orders where status_custom = p_name) then raise exception 'in_use' using errcode = '23503'; end if;
  delete from public.status_map where system_status = p_name;
  perform public.log_activity('settings.status.delete', 'status_map', p_name, null, null);
end $$;
revoke execute on function public.order_status_delete(text) from public, anon;
grant execute on function public.order_status_delete(text) to authenticated, service_role;

create or replace function public.order_status_order(p_names text[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare i int := 0; v text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_names is null or cardinality(p_names) <> (select count(*) from public.status_map) or exists (select 1 from unnest(p_names) x where x not in (select system_status from public.status_map)) then
    raise exception 'invalid: names' using errcode = '22023';
  end if;
  foreach v in array p_names loop i := i + 1; update public.status_map set sort = i where system_status = v; end loop;
  perform public.log_activity('settings.status.order', 'status_map', null, null, to_jsonb(cardinality(p_names)));
end $$;
revoke execute on function public.order_status_order(text[]) from public, anon;
grant execute on function public.order_status_order(text[]) to authenticated, service_role;

-- 4. the confirmation and product statuses: the base list or the admin's added ones (settings «lists».statusAdded)
create or replace function public.status_added_ok(p_kind text, p_value text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_typeof(data -> 'statusAdded' -> p_kind) = 'array' and (data -> 'statusAdded' -> p_kind) ? p_value
                   from public.settings where section = 'lists'), false)
$$;
revoke execute on function public.status_added_ok(text, text) from public, anon;
grant execute on function public.status_added_ok(text, text) to authenticated, service_role;

alter table public.orders drop constraint if exists orders_confirm_check;
create or replace function public.orders_confirm_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.confirm is not distinct from old.confirm then return new; end if;
  if new.confirm is not null and new.confirm not in ('مؤكد بعربون', 'مؤكد بدون عربون', 'غير مؤكد', 'في انتظار الرد') and not public.status_added_ok('confirm', new.confirm) then
    raise exception 'invalid: confirm' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.orders_confirm_guard() from public, anon, authenticated;
drop trigger if exists orders_confirm_guard on public.orders;
create trigger orders_confirm_guard before insert or update of confirm on public.orders
  for each row execute function public.orders_confirm_guard();

alter table public.order_items drop constraint if exists order_items_status_check;
create or replace function public.order_items_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status not in ('', 'غير مؤكد', 'مؤكد', 'قيد التنفيذ', 'جاهز للشحن من المبتكر للعميل', 'جاهز للشحن من المخزن للعميل', 'جاهز للشحن من المبتكر للمخزن',
                        'تم الشحن للمخزن', 'وصل المخزن', 'تم الشحن للعميل', 'مرتجع للمخزن', 'مرتجع للمبتكر', 'ملغي')
     and not public.status_added_ok('sub', new.status) then
    raise exception 'invalid: status' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.order_items_status_guard() from public, anon, authenticated;
drop trigger if exists order_items_status_guard on public.order_items;
create trigger order_items_status_guard before insert or update of status on public.order_items
  for each row execute function public.order_items_status_guard();

-- 5. settings_public hands the added statuses and the order to every active member (the body of 0093 plus the two keys)
create or replace function public.settings_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_general jsonb; v_security jsonb; v_notif jsonb; v_lists jsonb;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select data into v_general from public.settings where section = 'general';
  select data into v_security from public.settings where section = 'security';
  select data into v_notif from public.settings where section = 'notif';
  select data into v_lists from public.settings where section = 'lists';
  return jsonb_build_object(
    'brand', coalesce((select data from public.settings where section = 'brand'), '{}'::jsonb),
    'quick', coalesce((select data from public.settings where section = 'quick'), '{}'::jsonb),
    'lists', jsonb_strip_nulls(jsonb_build_object('cancel', v_lists -> 'cancel', 'returns', v_lists -> 'returns',
                 'stop', v_lists -> 'stop', 'shipping', v_lists -> 'shipping', 'labels', v_lists -> 'labels',
                 'expenseKinds', v_lists -> 'expenseKinds', 'statusAdded', v_lists -> 'statusAdded', 'statusOrder', v_lists -> 'statusOrder')),
    'general', jsonb_strip_nulls(jsonb_build_object('company', v_general ->> 'company', 'site', v_general ->> 'site', 'tz', v_general ->> 'tz',
                 'week', v_general ->> 'week', 'compact', v_general -> 'compact', 'thumbs', v_general -> 'thumbs',
                 'rememberFilters', v_general -> 'rememberFilters', 'hidePhones', v_general -> 'hidePhones')),
    'security', jsonb_strip_nulls(jsonb_build_object('force2fa', v_security -> 'force2fa', 'idle', v_security -> 'idle',
                 'idleDesktop', v_security ->> 'idleDesktop', 'idleMobile', v_security ->> 'idleMobile', 'pwMin', v_security ->> 'pwMin')),
    'notif', jsonb_strip_nulls(jsonb_build_object('alertRoles', coalesce(v_notif -> 'alertRoles', '{}'::jsonb),
                 'myOverride', coalesce(v_notif -> 'alertOverrides' -> v_uid::text, '{}'::jsonb),
                 'whatsappTemplate', v_notif ->> 'whatsappTemplate')));
end
$$;
revoke execute on function public.settings_public() from public, anon;
grant execute on function public.settings_public() to authenticated, service_role;
