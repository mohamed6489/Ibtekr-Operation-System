-- 0093 — the settings lists all editable (docs/superpowers/plans/2026-11-14-settings-lists.md, decision 1):
-- the expense type is no longer a fixed check. The four base types keep their meaning (المرتبات hidden from accounts.view P,
-- الاشتراكات with its fields, الإعلانات with its platform, the payroll writes «المرتبات»); the admin adds types in the settings
-- row «lists» (`expenseKinds`, the 0002 policies). A type written now (an insert, or a changed category) must be a base type or
-- one of `expenseKinds` — 23514 otherwise; a row keeps its type when that type is later removed from the list.
-- settings_public() hands `expenseKinds` to every active member (the body of 0086 plus the key). Re-runnable.

alter table public.acc_expenses drop constraint if exists acc_expenses_category_check;

create or replace function public.acc_expense_kind_ok(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_kind in ('المرتبات', 'المصروفات', 'الاشتراكات', 'الإعلانات')
    or coalesce((select jsonb_typeof(data -> 'expenseKinds') = 'array' and (data -> 'expenseKinds') ? p_kind
                 from public.settings where section = 'lists'), false)
$$;
revoke execute on function public.acc_expense_kind_ok(text) from public, anon;
grant execute on function public.acc_expense_kind_ok(text) to authenticated, service_role;

create or replace function public.acc_expenses_category_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then return new; end if;
  if new.category is null or length(btrim(new.category)) < 2 or length(new.category) > 40 or not public.acc_expense_kind_ok(new.category) then
    raise exception 'invalid: category' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.acc_expenses_category_guard() from public, anon, authenticated;
drop trigger if exists acc_expenses_category_guard on public.acc_expenses;
create trigger acc_expenses_category_guard before insert or update of category on public.acc_expenses
  for each row execute function public.acc_expenses_category_guard();

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
                 'expenseKinds', v_lists -> 'expenseKinds')),
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
