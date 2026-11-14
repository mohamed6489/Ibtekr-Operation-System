-- 0099 — owner batch 2 decisions 11 and 12 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): an integration can be paused for a
-- while from «الإعدادات › الربط بالمنصات» (ساعة / يوم / أسبوع / لحد تاريخ) and the server treats it as not linked until then.
-- * The admin writes the settings row «integrations» { paused: { <key>: <ISO time until> } } (the admin's settings policies, 0002).
-- * integration_paused(key): that time is still ahead (a bad value = not paused).
-- * app_secret_env (0056): the env keys of a paused platform are listed in «__unset» (vaultEnv deletes them, so a Supabase secret of
--   the same name does not stand in either) — WooCommerce paused = no URL / keys and WOO_PUSH_ENABLED 0: no sync and no write.
-- * cs_secret_get / mkt_secret_get / magnific_secret_get: a paused channel reads as no secret — the Meta page (meta), WhatsApp 1 (wa1),
--   the ad accounts (ads_meta / ads_tiktok / ads_google), the Magnific bridge (magnific). The originals stay as *_vault.
-- Keys: woo · anthropic · openai · gemini · elevenlabs · higgsfield · magnific (the API key and the bridge) · resend · meta · wa1 ·
-- ads_meta · ads_tiktok · ads_google.

create or replace function public.integration_paused(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text; t timestamptz;
begin
  select s.data -> 'paused' ->> p_key into v from public.settings s where s.section = 'integrations';
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}' then return false; end if;
  begin t := v::timestamptz; exception when others then return false; end;
  return t > now();
end $$;
revoke execute on function public.integration_paused(text) from public, anon;
grant execute on function public.integration_paused(text) to authenticated, service_role;

-- ---------------------------------------------------------------- app_secret_env (0056) + the paused keys
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
        else null;
      end case;
    end loop;
  end if;
  -- decision 11: a paused platform has no key at all (the Vault one is dropped and the Supabase secret of the same name is unset)
  for m in select * from (values
      ('woo', array['WOO_URL', 'WOO_CK', 'WOO_CS', 'WOO_WP_USER', 'WOO_WP_APP_PASSWORD']),
      ('anthropic', array['ANTHROPIC_API_KEY']), ('openai', array['OPENAI_API_KEY']), ('gemini', array['GEMINI_API_KEY']),
      ('elevenlabs', array['ELEVENLABS_API_KEY']), ('higgsfield', array['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET']),
      ('magnific', array['MAGNIFIC_API_KEY']), ('resend', array['RESEND_API_KEY'])) as x(k, envs) loop
    if public.integration_paused(m.k) then
      v_out := v_out - m.envs; v_unset := v_unset || m.envs;
      if m.k = 'woo' then v_out := v_out || '{"WOO_PUSH_ENABLED":"0"}'::jsonb; end if;
    end if;
  end loop;
  if cardinality(v_unset) > 0 then v_out := v_out || jsonb_build_object('__unset', to_jsonb(v_unset)); end if;
  return v_out;
end
$$;

-- ---------------------------------------------------------------- the channel secrets: paused = none
do $$ begin
  if to_regprocedure('public.cs_secret_get_vault(text)') is null then alter function public.cs_secret_get(text) rename to cs_secret_get_vault; end if;
  if to_regprocedure('public.mkt_secret_get_vault(text)') is null then alter function public.mkt_secret_get(text) rename to mkt_secret_get_vault; end if;
  if to_regprocedure('public.magnific_secret_get_vault(text)') is null then alter function public.magnific_secret_get(text) rename to magnific_secret_get_vault; end if;
end $$;

create or replace function public.cs_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  if public.integration_paused(case p_name when 'meta_pages' then 'meta' when 'meta_wa' then 'wa1' else p_name end) then return null; end if;
  return public.cs_secret_get_vault(p_name);
end $$;
create or replace function public.mkt_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  if public.integration_paused(p_name) then return null; end if; -- ads_meta / ads_tiktok / ads_google
  return public.mkt_secret_get_vault(p_name);
end $$;
create or replace function public.magnific_secret_get(p_name text) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  if public.integration_paused('magnific') then return null; end if;
  return public.magnific_secret_get_vault(p_name);
end $$;
revoke execute on function public.cs_secret_get(text), public.mkt_secret_get(text), public.magnific_secret_get(text),
  public.cs_secret_get_vault(text), public.mkt_secret_get_vault(text), public.magnific_secret_get_vault(text) from public, anon, authenticated;
grant execute on function public.cs_secret_get(text), public.mkt_secret_get(text), public.magnific_secret_get(text),
  public.cs_secret_get_vault(text), public.mkt_secret_get_vault(text), public.magnific_secret_get_vault(text) to service_role;
