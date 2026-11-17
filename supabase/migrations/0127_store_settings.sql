-- 0127 — the store: which platform and how the business sells (docs/superpowers/plans/2026-11-17-stores-single.md T1 — the owner 17 Nov:
-- «لو فصلتوا من ووكوميرس اقدر اربطوا ب شوبيفاي او ايزياوردر» و«تفعيل البيع الفردي بيلغي المبتكرين و الاوردرات الفرعية»).
-- * The row «store» in settings (the admin writes it under 0002's policies): { platform: woo | shopify | easyorders, mode: marketplace |
--   single, dokan: bool, margin: % } — no row = WooCommerce + Dokan, as the system has always worked.
-- * store_cfg(): the effective values (the same rules as _shared/store/index.js storeOf — any platform without Dokan sells single) for
--   the server's own rules (triggers, RPCs) — every member and the server may read it.
-- * settings_public() hands it out as `store` (platform, mode, dokan, margin). As 0123 otherwise. Re-runnable.

create or replace function public.store_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select coalesce((select data from public.settings where section = 'store'), '{}'::jsonb) as d),
  p as (select case when d ->> 'platform' in ('woo', 'shopify', 'easyorders') then d ->> 'platform' else 'woo' end as platform, d from r),
  k as (select platform, d, platform = 'woo' and coalesce(d ->> 'dokan', 'true') <> 'false' as dokan from p)
  select jsonb_build_object(
    'platform', platform,
    'dokan', dokan,
    'mode', case when dokan and coalesce(d ->> 'mode', '') <> 'single' then 'marketplace' else 'single' end,
    'margin', case when jsonb_typeof(d -> 'margin') = 'number' and (d ->> 'margin')::numeric between 0 and 500 then round((d ->> 'margin')::numeric, 2) else 30 end)
  from k
$$;
revoke execute on function public.store_cfg() from public, anon;
grant execute on function public.store_cfg() to authenticated, service_role;

create or replace function public.store_single() returns boolean
language sql stable security definer set search_path = public as $$
  select public.store_cfg() ->> 'mode' = 'single'
$$;
revoke execute on function public.store_single() from public, anon;
grant execute on function public.store_single() to authenticated, service_role;

create or replace function public.settings_public() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_general jsonb; v_security jsonb; v_notif jsonb; v_lists jsonb; v_makers jsonb; v_rules jsonb; v_ai jsonb; v_img jsonb;
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
  select data -> 'providers' into v_ai from public.settings where section = 'ai';
  v_img := case when jsonb_typeof(v_ai -> 'image') = 'object' then v_ai -> 'image' else '{}'::jsonb end;
  return jsonb_build_object(
    -- 0127: the store's platform and how the business sells (effective values — store_cfg)
    'store', public.store_cfg(),
    'makers', jsonb_build_object('delay', coalesce(v_makers -> 'delay', '{}'::jsonb))
              || case when jsonb_typeof(v_makers -> 'fake' -> 'tiers') = 'array' then jsonb_build_object('fake', jsonb_build_object('tiers', v_makers -> 'fake' -> 'tiers')) else '{}'::jsonb end,
    'aiTemplates', coalesce((select jsonb_object_agg(t.key, (select coalesce(jsonb_agg(jsonb_build_object('id', left(x ->> 'id', 40), 'name', left(coalesce(x ->> 'name', ''), 60),
                       'prompt', left(coalesce(x ->> 'prompt', ''), 1200))), '[]'::jsonb)
                     from jsonb_array_elements(case when jsonb_typeof(t.value) = 'array' then t.value else '[]'::jsonb end) x
                    where jsonb_typeof(x) = 'object' and coalesce(x ->> 'id', '') <> ''))
                  from jsonb_each(case when jsonb_typeof(v_rules -> 'sections') = 'object' then v_rules -> 'sections' else '{}'::jsonb end) t
                 where t.key in ('img', 'vid', 'txt')), '{}'::jsonb),
    'ai', jsonb_build_object('image', jsonb_build_object(
      'default', case when v_img ->> 'default' in ('magnific', 'openai', 'gemini') then v_img ->> 'default' else 'magnific' end,
      'tools', (select jsonb_object_agg(t, case when v_img -> 'tools' ->> t in ('magnific', 'openai', 'gemini') then v_img -> 'tools' ->> t
                                               when v_img ->> 'default' in ('magnific', 'openai', 'gemini') then v_img ->> 'default' else 'magnific' end)
                  from unnest(array['studio', 'campaign', 'tool']) t))),
    'brand', coalesce((select data from public.settings where section = 'brand'), '{}'::jsonb),
    'quick', coalesce((select data from public.settings where section = 'quick'), '{}'::jsonb),
    'lists', jsonb_strip_nulls(jsonb_build_object('cancel', v_lists -> 'cancel', 'returns', v_lists -> 'returns',
                 'stop', v_lists -> 'stop', 'shipping', v_lists -> 'shipping', 'labels', v_lists -> 'labels',
                 'expenseKinds', v_lists -> 'expenseKinds', 'statusAdded', v_lists -> 'statusAdded', 'statusOrder', v_lists -> 'statusOrder')),
    'general', jsonb_strip_nulls(jsonb_build_object('company', v_general ->> 'company', 'site', v_general ->> 'site', 'tz', v_general ->> 'tz',
                 'week', v_general ->> 'week', 'compact', v_general -> 'compact', 'thumbs', v_general -> 'thumbs',
                 'rememberFilters', v_general -> 'rememberFilters', 'hidePhones', v_general -> 'hidePhones',
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
