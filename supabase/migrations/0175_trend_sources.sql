-- 0175 — the trends from free sources (Safwat 28 Nov — «حط للمساعد مصادر للتريندات تكون مجانية بس عايزة اكونت» · «اعمل كل حاجة و
-- خليهم واقفين علي اني اضيف حساب» · «كل يوم الصبح في الجرس» · «في الجرس تنبيهات الترندات بتيجي في المساعدين و نضيفها في التنبهات زي
-- ما السيستم»; docs/superpowers/plans/2026-11-28-trends-free.md):
-- * two keys in «الربط بالمنصات» like the others (Vault app_<name>): youtube (a Google Cloud key for the YouTube Data API) and serpapi
--   (SerpApi — Google Trends now, the competitors' ads and Google Lens next) → YOUTUBE_API_KEY / SERPAPI_API_KEY in app_secret_env,
--   and gone while the card is paused or unlinked (integration_paused — 0099 / 0139) like every key.
-- * mkt_trends takes YouTube's videos (platform youtube) and Google Trends' searches (platform google, kind search).
-- * the cron mkt-trends-daily (hourly): mkt-publish `trends_daily` reads the free sources once a day from 9 Cairo time.
-- * «آخر التريندات» for the media buyer too (ai › buyer › trends) — one default rule beside its others, as the designer's (0157).
-- Re-runnable.

create or replace function public.app_secret_name_ok(p_name text) returns boolean
language sql immutable set search_path = public as $$
  select p_name in ('woo', 'anthropic', 'openai', 'gemini', 'elevenlabs', 'higgsfield', 'magnific_api', 'resend',
                    'airtable', 'sheets', 'paymob', 'bosta', 'n8n', 'github', 'figma', 'shopify', 'youtube', 'serpapi')
      or p_name ~ '^(mcp|custom)_[a-z0-9][a-z0-9_]{0,39}$'
$$;
revoke execute on function public.app_secret_name_ok(text) from public, anon;

-- ---------------------------------------------------------------- app_secret_env (0099) + YouTube and SerpApi
create or replace function public.app_secret_env() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_out jsonb := '{}'::jsonb;
  r record;
  v jsonb;
  v_unset text[] := '{}';
  m record;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    for r in select s.name, s.decrypted_secret from vault.decrypted_secrets s where s.name like 'app\_%' loop
      begin v := r.decrypted_secret::jsonb; exception when others then v := null; end;
      if v is null or jsonb_typeof(v) <> 'object' then continue; end if;
      case r.name
        when 'app_woo' then
          v_out := v_out || jsonb_strip_nulls(jsonb_build_object('WOO_URL', v ->> 'url', 'WOO_CK', v ->> 'ck', 'WOO_CS', v ->> 'cs',
                     'WOO_WP_USER', v ->> 'wp_user', 'WOO_WP_APP_PASSWORD', v ->> 'wp_app_password',
                     'WOO_PUSH_ENABLED', case when v ? 'push' then case when (v ->> 'push') in ('1', 'true') then '1' else '0' end end));
        when 'app_anthropic' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('ANTHROPIC_API_KEY', v ->> 'key'));
        when 'app_openai' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('OPENAI_API_KEY', v ->> 'key'));
        when 'app_gemini' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('GEMINI_API_KEY', v ->> 'key'));
        when 'app_elevenlabs' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('ELEVENLABS_API_KEY', v ->> 'key'));
        when 'app_higgsfield' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('HIGGSFIELD_API_KEY', v ->> 'key', 'HIGGSFIELD_API_SECRET', v ->> 'secret'));
        when 'app_magnific_api' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('MAGNIFIC_API_KEY', v ->> 'key'));
        when 'app_resend' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('RESEND_API_KEY', v ->> 'key', 'RESEND_FROM', v ->> 'from'));
        when 'app_youtube' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('YOUTUBE_API_KEY', v ->> 'key'));
        when 'app_serpapi' then v_out := v_out || jsonb_strip_nulls(jsonb_build_object('SERPAPI_API_KEY', v ->> 'key'));
        else null;
      end case;
    end loop;
  end if;
  -- a paused (or unlinked — 0139) platform has no key at all: the Vault one is dropped and the Supabase secret of the same name is unset
  for m in select * from (values
      ('woo', array['WOO_URL', 'WOO_CK', 'WOO_CS', 'WOO_WP_USER', 'WOO_WP_APP_PASSWORD']),
      ('anthropic', array['ANTHROPIC_API_KEY']), ('openai', array['OPENAI_API_KEY']), ('gemini', array['GEMINI_API_KEY']),
      ('elevenlabs', array['ELEVENLABS_API_KEY']), ('higgsfield', array['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET']),
      ('magnific', array['MAGNIFIC_API_KEY']), ('resend', array['RESEND_API_KEY']),
      ('youtube', array['YOUTUBE_API_KEY']), ('serpapi', array['SERPAPI_API_KEY'])) as x(k, envs) loop
    if public.integration_paused(m.k) then
      v_out := v_out - m.envs; v_unset := v_unset || m.envs;
      if m.k = 'woo' then v_out := v_out || '{"WOO_PUSH_ENABLED":"0"}'::jsonb; end if;
    end if;
  end loop;
  if cardinality(v_unset) > 0 then v_out := v_out || jsonb_build_object('__unset', to_jsonb(v_unset)); end if;
  return v_out;
end
$$;
revoke execute on function public.app_secret_env() from public, anon, authenticated;
grant execute on function public.app_secret_env() to service_role;

-- ---------------------------------------------------------------- mkt_trends: YouTube's videos and Google Trends' searches
alter table public.mkt_trends drop constraint if exists mkt_trends_platform_check;
alter table public.mkt_trends add constraint mkt_trends_platform_check check (platform in ('tiktok', 'instagram', 'facebook', 'youtube', 'google', 'web'));
alter table public.mkt_trends drop constraint if exists mkt_trends_kind_check;
alter table public.mkt_trends add constraint mkt_trends_kind_check check (kind in ('image', 'video', 'search'));

-- ---------------------------------------------------------------- the daily run (guarded like 0053; the sync secret of 0008)
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0175: pg_cron / pg_net / Vault not here — the daily trends cron is not scheduled';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mkt-trends-daily') then perform cron.unschedule('mkt-trends-daily'); end if;
  -- hourly at :17; the function reads once a day, from 9 Cairo time
  perform cron.schedule('mkt-trends-daily', '17 * * * *', $cron$
    select net.http_post(
      url := 'https://fsynculhaupcktzkfkdd.supabase.co/functions/v1/mkt-publish',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'X-Sync-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"action":"trends_daily"}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$);
end $$;

-- ---------------------------------------------------------------- «آخر التريندات» for the media buyer (beside its other rules)
do $$
declare v_sec uuid; v_main uuid;
begin
  if not exists (select 1 from public.notif_sections) then return; end if; -- the sections are the admin's (as 0161 / 0173)
  if exists (select 1 from public.notif_rules where element = 'ai' and type = 'buyer' and state = 'trends') then return; end if;
  select section_id into v_sec from public.notif_rules where element = 'ai' and type = 'buyer' and section_id is not null order by created_at limit 1;
  if v_sec is null then
    select id into v_main from public.notif_sections where parent_id is null and name = 'مساعدين الذكاء الاصطناعي';
    if v_main is null then return; end if;
    select id into v_sec from public.notif_sections where parent_id = v_main and name = 'الميديا باير';
    if v_sec is null then
      insert into public.notif_sections (parent_id, name, sort) values (v_main, 'الميديا باير', coalesce((select max(sort) + 1 from public.notif_sections where parent_id = v_main), 0)) returning id into v_sec;
    end if;
  end if;
  insert into public.notif_rules (section_id, name, element, type, state, param, at, repeat, show, hours, roles, sort, created_by)
  values (v_sec, 'آخر التريندات', 'ai', 'buyer', 'trends', null, '00:00', '24h', 'until_read', 6,
    array(select r from unnest(array['admin', 'media_buyer']) r where exists (select 1 from public.roles x where x.id = r)),
    coalesce((select max(sort) + 1 from public.notif_rules where section_id = v_sec), 0), null);
end $$;
