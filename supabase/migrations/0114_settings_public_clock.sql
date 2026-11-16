-- 0114 — «اللغة والمنطقة» بتتعدّل (the owner 16 Nov: «خلي الجزء ده قابل للتعديل و فورمات الوقت يبقي فيها اختيارات نظام ال12 ساعة و نظام
-- ال24 ساعة»). The admin keeps the choices in the settings row «general» (`clock`: '12' | '24', `dateFmt`: 'dmy' 20/10/2026 | 'ymd'
-- 2026-10-20); every member shows the times and the tables' dates by them, so settings_public (0106) hands them out — the two known values
-- only, nothing else. No new table, no new grant. Re-runnable. Plan: docs/superpowers/plans/2026-11-15-comments.md ش28.

create or replace function public.settings_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_general jsonb; v_security jsonb; v_notif jsonb; v_lists jsonb; v_makers jsonb; v_rules jsonb;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select data into v_general from public.settings where section = 'general';
  select data into v_security from public.settings where section = 'security';
  select data into v_notif from public.settings where section = 'notif';
  select data into v_lists from public.settings where section = 'lists';
  select data into v_makers from public.settings where section = 'makers';
  select data into v_rules from public.settings where section = 'ai_rules';
  return jsonb_build_object(
    -- 0106: the default fake-discount tiers (the row «makers», key `fake`) beside the delay rules — the tiers only
    'makers', jsonb_build_object('delay', coalesce(v_makers -> 'delay', '{}'::jsonb))
              || case when jsonb_typeof(v_makers -> 'fake' -> 'tiers') = 'array' then jsonb_build_object('fake', jsonb_build_object('tiers', v_makers -> 'fake' -> 'tiers')) else '{}'::jsonb end,
    -- owner batch 2 decisions 14 and 15: the instruction templates of «تعليمات الذكاء الاصطناعي» (img / vid / txt) — id, name and text only
    'aiTemplates', coalesce((select jsonb_object_agg(t.key, (select coalesce(jsonb_agg(jsonb_build_object('id', left(x ->> 'id', 40), 'name', left(coalesce(x ->> 'name', ''), 60),
                       'prompt', left(coalesce(x ->> 'prompt', ''), 1200))), '[]'::jsonb)
                     from jsonb_array_elements(case when jsonb_typeof(t.value) = 'array' then t.value else '[]'::jsonb end) x
                    where jsonb_typeof(x) = 'object' and coalesce(x ->> 'id', '') <> ''))
                  from jsonb_each(case when jsonb_typeof(v_rules -> 'sections') = 'object' then v_rules -> 'sections' else '{}'::jsonb end) t
                 where t.key in ('img', 'vid', 'txt')), '{}'::jsonb),
    'brand', coalesce((select data from public.settings where section = 'brand'), '{}'::jsonb),
    'quick', coalesce((select data from public.settings where section = 'quick'), '{}'::jsonb),
    'lists', jsonb_strip_nulls(jsonb_build_object('cancel', v_lists -> 'cancel', 'returns', v_lists -> 'returns',
                 'stop', v_lists -> 'stop', 'shipping', v_lists -> 'shipping', 'labels', v_lists -> 'labels',
                 'expenseKinds', v_lists -> 'expenseKinds', 'statusAdded', v_lists -> 'statusAdded', 'statusOrder', v_lists -> 'statusOrder')),
    'general', jsonb_strip_nulls(jsonb_build_object('company', v_general ->> 'company', 'site', v_general ->> 'site', 'tz', v_general ->> 'tz',
                 'week', v_general ->> 'week', 'compact', v_general -> 'compact', 'thumbs', v_general -> 'thumbs',
                 'rememberFilters', v_general -> 'rememberFilters', 'hidePhones', v_general -> 'hidePhones',
                 -- 0114: the clock (12 / 24) and the tables' date format — the known values only
                 'clock', case when v_general ->> 'clock' in ('12', '24') then v_general ->> 'clock' end,
                 'dateFmt', case when v_general ->> 'dateFmt' in ('dmy', 'ymd') then v_general ->> 'dateFmt' end)),
    'security', jsonb_strip_nulls(jsonb_build_object('force2fa', v_security -> 'force2fa', 'idle', v_security -> 'idle',
                 'idleDesktop', v_security ->> 'idleDesktop', 'idleMobile', v_security ->> 'idleMobile', 'pwMin', v_security ->> 'pwMin')),
    'notif', jsonb_strip_nulls(jsonb_build_object('alertRoles', coalesce(v_notif -> 'alertRoles', '{}'::jsonb),
                 'alertLevels', coalesce(v_notif -> 'alertLevels', '{}'::jsonb),
                 'myOverride', coalesce(v_notif -> 'alertOverrides' -> v_uid::text, '{}'::jsonb),
                 'whatsappTemplate', v_notif ->> 'whatsappTemplate')));
end
$$;
