-- 0086 — owner batch 14 Nov (docs/superpowers/plans/2026-11-14-owner-batch.md, decisions 4 and 8): more saved lists.
-- The settings row «lists» (the admin writes it — the 0002 policies) gains three keys the pages read with the sign-in:
--   stop     — the makers' stop reasons («أخرى» added last by the reader)
--   shipping — the shipping companies (the inventory ship popup and «التوصيل» read them)
--   labels   — the shown name of an order / confirmation / sub-order status ({ order: { value: shown }, confirm: {…}, sub: {…} });
--              the value in the database, status_map and every report stays the same — only what the pages show changes.
-- settings_public() hands them to every active member (the same body as 0060 plus the three keys). Re-runnable: create or replace.

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
                 'stop', v_lists -> 'stop', 'shipping', v_lists -> 'shipping', 'labels', v_lists -> 'labels')),
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
