-- 0060 — phase 12 T3 (docs/superpowers/plans/2026-11-08-phase-12-followups.md, decisions 3 and 10): the saved lists of the settings page.
-- The admin keeps the cancel / return reasons in the settings row «lists» ({ cancel: [...], returns: [...] } — the 0002 policies:
-- the admin writes, settings.view reads), and settings_public() hands that row to every active member with the sign-in, so the
-- orders page's cancel / return popups offer the saved reasons (the defaults of block 12 when the row is empty).
-- The order statuses stay the system's (status_map keys are read by name in accounts_sales, products_report, order_delete, the
-- auto-reply engine and the reports): no rename from the page (decision 10 amended — the owner is told).
-- Re-runnable: create or replace.

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
    'lists', jsonb_strip_nulls(jsonb_build_object('cancel', v_lists -> 'cancel', 'returns', v_lists -> 'returns')),
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
