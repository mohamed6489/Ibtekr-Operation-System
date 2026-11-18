-- Tests for 0099_integrations_pause (owner batch 2 decisions 11 and 12): a paused integration reads as not linked on the server.
-- One transaction, rolled back; NOTICE 'rls_integrations_pause: ok' only if every case passed. Live-safe: the settings row is rolled back.
-- * integration_paused: a time ahead = paused, a time gone or a bad value = not
-- * app_secret_env lists the env keys of a paused platform in __unset (WooCommerce: WOO_PUSH_ENABLED 0 too)
-- * cs_secret_get / mkt_secret_get / magnific_secret_get read nothing for a paused channel; all of them stay service_role only

begin;

delete from public.settings where section = 'integrations';
insert into public.settings (section, data) values ('integrations', jsonb_build_object('paused', jsonb_build_object(
  'woo', to_char(now() + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'anthropic', to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'openai', 'بكرة',
  'meta', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'ads_tiktok', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'magnific', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

do $$ begin
  if not public.integration_paused('woo') then raise exception 'case a time ahead is paused failed'; end if;
  if public.integration_paused('anthropic') then raise exception 'case a time gone is not paused failed'; end if;
  if public.integration_paused('openai') then raise exception 'case a bad value is not paused failed'; end if;
  if public.integration_paused('gemini') then raise exception 'case no entry is not paused failed'; end if;
  -- 0139: «فصل» on a link from the server's secrets = off for good (a pause that never ends)
  update public.settings set data = data || '{"off":{"gemini":true,"resend":false}}'::jsonb where section = 'integrations';
  if not public.integration_paused('gemini') then raise exception 'case off is paused failed'; end if;
  if public.integration_paused('resend') then raise exception 'case off false is not paused failed'; end if;
  update public.settings set data = data - 'off' where section = 'integrations';
  if has_function_privilege('anon', 'public.cs_secret_get(text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.cs_secret_get(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mkt_secret_get_vault(text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.magnific_secret_get(text)', 'EXECUTE') then
    raise exception 'case the secret getters stay service_role only failed';
  end if;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ declare v jsonb; begin
  v := public.app_secret_env();
  if not (v -> '__unset' ? 'WOO_URL' and v -> '__unset' ? 'WOO_CK') then raise exception 'case a paused WooCommerce lists its keys in __unset failed'; end if;
  if v ->> 'WOO_PUSH_ENABLED' is distinct from '0' then raise exception 'case a paused WooCommerce writes nothing failed'; end if;
  if v -> '__unset' ? 'ANTHROPIC_API_KEY' then raise exception 'case a pause that ended is gone failed'; end if;
  if public.cs_secret_get('meta_pages') is not null then raise exception 'case a paused Meta page reads no token failed'; end if;
  if public.mkt_secret_get('ads_tiktok') is not null then raise exception 'case a paused ad account reads no secret failed'; end if;
  if public.magnific_secret_get('magnific_mcp_tokens') is not null then raise exception 'case a paused Magnific bridge reads no token failed'; end if;
end $$;

do $$ begin raise notice 'rls_integrations_pause: ok'; end $$;
rollback;
