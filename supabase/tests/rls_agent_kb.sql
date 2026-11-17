-- RLS / rule tests for 0118_agent_kb_trend_tags (ش39 / ش40): the assistants' rules and skills and the designer's trend tags are
-- the admin's to write (sections of items within their limits, merged per assistant and kind, the row's other keys kept), read with
-- marketing.view; a trend row's picture source is the server's only. Depends on 0001 … 0118. One transaction rolled back; prints
-- NOTICE 'rls_agent_kb: ok' only if every case passed. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000118a1', 'kb-adm.dev@ibtekr.local', '01000118a01'),
  ('00000000-0000-4000-8000-0000000118a2', 'kb-ops.dev@ibtekr.local', '01000118a02'),
  ('00000000-0000-4000-8000-0000000118a3', 'kb-acc.dev@ibtekr.local', '01000118a03');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'kb-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000118a1', 'أدمن القواعد', 'kb-adm.dev@ibtekr.local', '01000118a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000118a2', 'محتوى القواعد', 'kb-ops.dev@ibtekr.local', '01000118a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000118a3', 'حسابات القواعد', 'kb-acc.dev@ibtekr.local', '01000118a03', 'accounts', 'active');
insert into public.settings (section, data) values ('marketing', '{"autopublish": true}')
  on conflict (section) do update set data = public.settings.data || '{"autopublish": true}';

-- a trend post: one row per post on a platform; the picture path is under trends/
insert into public.mkt_trends (batch, title, source, url, kind, platform, tag, external_id, thumb_src)
  values (gen_random_uuid(), 'ريل مكرمية', 'Instagram', 'https://www.instagram.com/reel/AbC123/', 'video', 'instagram', 'macrame', '17890001', 'https://scontent.cdninstagram.com/x.jpg');
do $$ begin
  begin insert into public.mkt_trends (batch, title, source, url, kind, platform, external_id) values (gen_random_uuid(), 'تاني', 'Instagram', 'https://www.instagram.com/p/x/', 'image', 'instagram', '17890001');
    raise exception 'case one row per post failed'; exception when unique_violation then null; end;
  begin insert into public.mkt_trends (batch, title, source, url, kind, platform) values (gen_random_uuid(), 'x', 's', 'https://a.example/x', 'image', 'myspace');
    raise exception 'case a known platform failed'; exception when check_violation then null; end;
  begin insert into public.mkt_trends (batch, title, source, url, kind, thumb) values (gen_random_uuid(), 'x', 's', 'https://a.example/x', 'image', '../agents/x.png');
    raise exception 'case the picture is under trends/ failed'; exception when check_violation then null; end;
  insert into public.mkt_trends (batch, title, source, url, kind, thumb) values (gen_random_uuid(), 'بصورة', 's', 'https://a.example/y', 'image', 'trends/2026-11/12.jpg');
  -- two web pages without an id are never the same post
  insert into public.mkt_trends (batch, title, source, url, kind) values (gen_random_uuid(), 'صفحة 1', 's', 'https://a.example/1', 'image'), (gen_random_uuid(), 'صفحة 2', 's', 'https://a.example/2', 'image');
  if has_function_privilege('anon', 'public.mkt_ad_tags_set(jsonb)', 'execute') or has_function_privilege('anon', 'public.mkt_agent_kb_set(text, text, jsonb)', 'execute') or has_function_privilege('anon', 'public.mkt_trend_settings()', 'execute')
    or has_function_privilege('anon', 'public.mkt_trend_settings_set(jsonb, jsonb)', 'execute') then raise exception 'case the functions are closed to anon failed'; end if;
end $$;

set local role authenticated;

-- ================================================================ ops (marketing.view F, not admin): reads, never writes the settings
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000118a2","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_trends where platform = 'instagram' and tag = 'macrame') <> 1 then raise exception 'case ops reads the trend post failed'; end if;
  begin perform thumb_src from public.mkt_trends; raise exception 'case the picture source is the server''s failed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.mkt_trends where thumb_tries > 0; raise exception 'case the tries are the server''s failed'; exception when insufficient_privilege then null; end;
  if public.mkt_trend_settings() <> '{"tags": [], "sources": [], "adTags": []}'::jsonb then raise exception 'case no tags yet failed'; end if;
  begin perform public.mkt_ad_tags_set('["x"]'); raise exception 'case a member never sets the ad tags failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_agent_kb_set('designer', 'rules', '[]'); raise exception 'case a member never sets the rules failed'; exception when insufficient_privilege then null; end;
  begin perform public.mkt_trend_settings_set('["x"]', '[]'); raise exception 'case a member never sets the tags failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ the admin: the rules, the skills, the tags
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000118a1","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.mkt_agent_kb_set('designer', 'rules', '[{"id":"brand","name":"البراند","items":[{"id":"r1","title":"الألوان","text":"أخضر غامق ودهبي"},{"title":"اللوجو","text":""}]},{"name":"ممنوعات","items":[]}]');
  if jsonb_array_length(r) <> 2 or r -> 0 ->> 'id' <> 'brand' or r -> 0 -> 'items' -> 1 ->> 'id' <> 'i1_2' or r -> 1 ->> 'id' <> 'g2' then raise exception 'case the rules are stored with their ids failed: %', r; end if;
  perform public.mkt_agent_kb_set('designer', 'skills', '[{"name":"الريلز","items":[{"title":"Hook","text":"أول ثانيتين"}]}]');
  perform public.mkt_agent_kb_set('buyer', 'rules', '[{"name":"الميزانية","items":[{"title":"سقف","text":"مش أكتر من 5000 في اليوم"}]}]');
  -- merged per assistant and kind; the row's other keys and the assistant's other settings kept
  perform public.mkt_agent_settings_set('designer', '{"intro":"أهلًا"}');
  perform public.mkt_agent_kb_set('designer', 'rules', '[{"name":"البراند","items":[{"title":"الألوان","text":"أخضر"}]}]');
  r := public.mkt_agent_settings();
  if r -> 'designer' ->> 'intro' <> 'أهلًا' or jsonb_array_length(r -> 'designer' -> 'skills') <> 1 or jsonb_array_length(r -> 'designer' -> 'rules') <> 1
    or jsonb_array_length(r -> 'buyer' -> 'rules') <> 1 then raise exception 'case merged per assistant and kind failed: %', r; end if;
  if (select data ->> 'autopublish' from public.settings where section = 'marketing') <> 'true' then raise exception 'case the row''s other keys kept failed'; end if;
  -- the limits
  begin perform public.mkt_agent_kb_set('robot', 'rules', '[]'); raise exception 'case a known assistant failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'notes', '[]'); raise exception 'case rules or skills failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'rules', '[{"name":"","items":[]}]'); raise exception 'case a section needs a name failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'rules', '[{"name":"x","items":[{"title":"<b>","text":""}]}]'); raise exception 'case no tags in a title failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'rules', jsonb_build_array(jsonb_build_object('name', 'x', 'items', jsonb_build_array(jsonb_build_object('title', 't', 'text', repeat('a', 1501))))));
    raise exception 'case an item''s text limit failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'rules', (select jsonb_agg(jsonb_build_object('name', 's' || g, 'items', '[]'::jsonb)) from generate_series(1, 13) g));
    raise exception 'case at most 12 sections failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_kb_set('dev', 'rules', '[{"id":"bad id!","name":"x","items":[]}]'); raise exception 'case a clean id failed'; exception when invalid_parameter_value then null; end;
  -- the tags: the # dropped, lowered, kept once; Arabic words; a host list
  r := public.mkt_trend_settings_set('["#Macrame", "macrame", "ديكور_منزلي"]', '["later.com", "Creative.TikTok.com"]');
  if r <> '{"tags": ["macrame", "ديكور_منزلي"], "sources": ["later.com", "creative.tiktok.com"]}'::jsonb then raise exception 'case the tags are cleaned failed: %', r; end if;
  if public.mkt_trend_settings() <> (r || '{"adTags": []}'::jsonb) then raise exception 'case the tags are read back failed'; end if;
  -- ش44: the buyer's ad tags — a search (spaces kept, collapsed), the # dropped, each once; kept beside the trend tags
  if public.mkt_ad_tags_set('["#مكرمية", "ديكور   منزلي", "مكرمية"]') <> '["مكرمية", "ديكور منزلي"]'::jsonb then raise exception 'case the ad tags are cleaned failed'; end if;
  if public.mkt_trend_settings() -> 'tags' <> '["macrame", "ديكور_منزلي"]'::jsonb or public.mkt_trend_settings() -> 'adTags' <> '["مكرمية", "ديكور منزلي"]'::jsonb then raise exception 'case the ad tags sit beside the trend tags failed'; end if;
  begin perform public.mkt_ad_tags_set('["<b>"]'); raise exception 'case an ad tag without tags failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_trend_settings_set('["two words"]', '[]'); raise exception 'case a tag is one word failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_trend_settings_set('[]', '["https://later.com/x"]'); raise exception 'case a site is a host failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_trend_settings_set((select jsonb_agg('t' || g) from generate_series(1, 31) g), '[]'); raise exception 'case at most 30 tags failed'; exception when invalid_parameter_value then null; end;
  if (select count(*) from public.activity_log where action in ('mkt.agent.kb', 'mkt.trends.settings', 'mkt.ads.tags') and actor = '00000000-0000-4000-8000-0000000118a1') < 5 then raise exception 'case the changes are logged failed'; end if;
end $$;

-- ================================================================ accounts (marketing.view N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000118a3","role":"authenticated"}', true);
do $$ begin
  if public.mkt_trend_settings() <> '{"tags": [], "sources": [], "adTags": []}'::jsonb then raise exception 'case no marketing.view reads no tags failed'; end if;
  if public.mkt_agent_settings() <> '{}'::jsonb then raise exception 'case no marketing.view reads no rules failed'; end if;
  if (select count(*) from public.mkt_trends) <> 0 then raise exception 'case no marketing.view reads no trend failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_agent_kb: ok'; end $$;
rollback;
