-- Tests for 0175_trend_sources (docs/superpowers/plans/2026-11-28-trends-free.md — the trends from free sources).
-- One transaction, rolled back; NOTICE 'rls_trend_sources: ok' only if every case passed. Live-safe: everything is rolled back.
-- * youtube / serpapi are secret names; any other new name is still refused
-- * app_secret_env: a paused YouTube or SerpApi card lists its key in __unset (the Supabase secret of the same name does not stand in)
-- * mkt_trends takes YouTube's videos and Google Trends' searches; a made-up platform or kind is refused
-- * the media buyer has «آخر التريندات» once, beside its other rules (when the sections are there)

begin;

do $$ begin
  if not public.app_secret_name_ok('youtube') or not public.app_secret_name_ok('serpapi') then raise exception 'case the two names are secrets failed'; end if;
  if public.app_secret_name_ok('serp') or public.app_secret_name_ok('youtube_api') then raise exception 'case any other name is refused failed'; end if;
  if not public.app_secret_name_ok('woo') or not public.app_secret_name_ok('custom_x') then raise exception 'case the old names stay failed'; end if;
end $$;

delete from public.settings where section = 'integrations';
insert into public.settings (section, data) values ('integrations', jsonb_build_object('paused', jsonb_build_object(
  'youtube', to_char(now() + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'off', jsonb_build_object('serpapi', true)));
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ declare v jsonb; begin
  v := public.app_secret_env();
  if not (v -> '__unset' ? 'YOUTUBE_API_KEY') then raise exception 'case a paused YouTube lists its key in __unset failed'; end if;
  if not (v -> '__unset' ? 'SERPAPI_API_KEY') then raise exception 'case an unlinked SerpApi lists its key in __unset failed'; end if;
  if v ? 'YOUTUBE_API_KEY' or v ? 'SERPAPI_API_KEY' then raise exception 'case a paused key is never given failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$ begin
  perform public.app_secret_env();
  raise exception 'case app_secret_env stays service_role only failed';
exception when insufficient_privilege then null;
end $$;

do $$ declare v_batch uuid := gen_random_uuid(); begin
  insert into public.mkt_trends (batch, title, source, url, kind, platform, external_id) values
    (v_batch, 'فيديو', 'YouTube', 'https://www.youtube.com/watch?v=AAAAAAAAAA1', 'video', 'youtube', 'AAAAAAAAAA1'),
    (v_batch, 'مكرمية حائط', 'Google Trends', 'https://trends.google.com/trends/explore?q=x', 'search', 'google', 'gt-2026-11-28-0a1b2c3d');
  begin
    insert into public.mkt_trends (batch, title, source, url, kind, platform) values (v_batch, 'x', 'x', 'https://x.example/', 'video', 'snapchat');
    raise exception 'case a made-up platform is refused failed';
  exception when check_violation then null; end;
  begin
    insert into public.mkt_trends (batch, title, source, url, kind, platform) values (v_batch, 'x', 'x', 'https://x.example/', 'audio', 'web');
    raise exception 'case a made-up kind is refused failed';
  exception when check_violation then null; end;
end $$;

do $$ begin
  if exists (select 1 from public.notif_sections) and exists (select 1 from public.notif_rules where element = 'ai' and type = 'buyer') then
    if (select count(*) from public.notif_rules where element = 'ai' and type = 'buyer' and state = 'trends') <> 1 then raise exception 'case the media buyer has «آخر التريندات» once failed'; end if;
    if (select section_id from public.notif_rules where element = 'ai' and type = 'buyer' and state = 'trends')
       is distinct from (select section_id from public.notif_rules where element = 'ai' and type = 'buyer' and state <> 'trends' order by created_at limit 1) then
      raise exception 'case it sits beside the media buyer''s other rules failed';
    end if;
  end if;
end $$;

do $$ begin raise notice 'rls_trend_sources: ok'; end $$;
rollback;
