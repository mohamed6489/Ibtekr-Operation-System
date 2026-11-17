-- 0118 — the assistants' rules and skills, and the designer's trends by the team's tags (docs/superpowers/plans/2026-11-15-comments.md ش39 / ش40).
-- The owner 17 Nov: «اعملي في السيتينج في قسم الذكاء الاصطناعي المساعدين و قسمها المصمم الاصطناعي و المبرمج الاصطناعي و الميديا باير الاصطناعي
-- و حط لكل واحد فيهم قواعد و سكيلز … و خلي القواعد اقدر اعملها قسم و الاسكيلز نفس الكلام» · «عايز اجيب الفيديوهات التيرندس و يبقا ليها
-- علاقة بالمجال بتاعي و اقدر اضيف تاجز … من تريندات التيكتوك و الانستجرام و الفيسبوك» · «ياريت الستسنج دي تيبقا موجودة في المصمم الاصطناعي».
--   * settings.marketing.agents.<agent>.rules / .skills — named sections of items ({ id, name, items: [{ id, title, text }] }), written
--     by the admin only through mkt_agent_kb_set; read with mkt_agent_settings() (0084, marketing.view) and by the server, which puts
--     them in the assistant's prompt (ai-content `agent`, `buyer`, `trends`) as the team's guidance — they never let it execute anything.
--   * settings.marketing.trends.tags / .sources — the designer's trend tags (what the search and Instagram's hashtags look for) and the
--     preferred sites; the admin writes them with mkt_trend_settings_set, marketing.view reads them with mkt_trend_settings().
--   * mkt_trends gets the post's platform, the tag it came from, its picture (a path in the bucket «marketing» under trends/), its
--     author and numbers when the platform says them, and the post's id on the platform (one row per post). The picture's source
--     link (thumb_src) and its tries are the server's only — the members read the table by a column list.
-- Explicit grants; re-runnable.

-- ---------------------------------------------------------------- mkt_trends: the post, its platform and its picture

alter table public.mkt_trends add column if not exists platform text not null default 'web';
alter table public.mkt_trends drop constraint if exists mkt_trends_platform_check;
alter table public.mkt_trends add constraint mkt_trends_platform_check check (platform in ('tiktok', 'instagram', 'facebook', 'web'));
alter table public.mkt_trends add column if not exists tag text check (tag is null or (char_length(tag) between 1 and 40 and tag !~ '[<>]'));
alter table public.mkt_trends add column if not exists thumb text check (thumb is null or thumb ~ '^trends/[0-9]{4}-[0-9]{2}/[0-9]+\.(png|jpg|webp)$');
alter table public.mkt_trends add column if not exists thumb_src text check (thumb_src is null or (char_length(thumb_src) <= 2000 and thumb_src ~ '^https://[^\s<>"]+$'));
alter table public.mkt_trends add column if not exists thumb_tries smallint not null default 0;
alter table public.mkt_trends add column if not exists author text check (author is null or (char_length(author) <= 80 and author !~ '[<>]'));
alter table public.mkt_trends add column if not exists views bigint check (views is null or views >= 0);
alter table public.mkt_trends add column if not exists likes bigint check (likes is null or likes >= 0);
alter table public.mkt_trends add column if not exists comments bigint check (comments is null or comments >= 0);
alter table public.mkt_trends add column if not exists posted_at timestamptz;
alter table public.mkt_trends add column if not exists external_id text check (external_id is null or external_id ~ '^[A-Za-z0-9_.:-]{1,80}$');
-- one row per post on a platform (a refresh that meets it again skips it); rows without an id (a web page) are never one another
create unique index if not exists mkt_trends_post_uq on public.mkt_trends (platform, external_id);
create index if not exists mkt_trends_nothumb_idx on public.mkt_trends (found_at desc) where thumb is null;

-- the members read by a column list: the picture's source link and its tries stay the server's
revoke all on public.mkt_trends from anon, authenticated;
grant select (id, batch, title, summary, source, url, kind, found_at, created_by, platform, tag, thumb, author, views, likes, comments, posted_at, external_id)
  on public.mkt_trends to authenticated;
grant all on public.mkt_trends to service_role;

-- ---------------------------------------------------------------- the assistants' rules and skills (ش40)

-- p_groups: [{ id?, name, items: [{ id?, title, text }] }] — at most 12 sections of at most 30 items; a section's name 1–60, an item's
-- title 1–80 and its text up to 1500, no < or > anywhere; the whole kind up to 20000 characters. The list replaces the stored one.
create or replace function public.mkt_agent_kb_set(p_agent text, p_kind text, p_groups jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb; g jsonb; it jsonb; v_items jsonb; v_name text; v_title text; v_text text; v_id text; v_total int := 0; gi int := 0; ii int;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_agent is null or p_agent not in ('buyer', 'designer', 'dev') then raise exception 'invalid: agent' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('rules', 'skills') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 12 then raise exception 'invalid: groups' using errcode = '22023'; end if;
  for g in select * from jsonb_array_elements(p_groups) loop
    gi := gi + 1;
    if jsonb_typeof(g) <> 'object' then raise exception 'invalid: groups' using errcode = '22023'; end if;
    v_name := btrim(coalesce(g ->> 'name', ''));
    if v_name = '' or char_length(v_name) > 60 or v_name ~ '[<>]' then raise exception 'invalid: name' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(g -> 'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(g -> 'items', '[]'::jsonb)) > 30 then raise exception 'invalid: items' using errcode = '22023'; end if;
    v_items := '[]'::jsonb; ii := 0;
    for it in select * from jsonb_array_elements(coalesce(g -> 'items', '[]'::jsonb)) loop
      ii := ii + 1;
      if jsonb_typeof(it) <> 'object' then raise exception 'invalid: items' using errcode = '22023'; end if;
      v_title := btrim(coalesce(it ->> 'title', '')); v_text := btrim(regexp_replace(coalesce(it ->> 'text', ''), E'\r\n?', E'\n', 'g'));
      if v_title = '' or char_length(v_title) > 80 or v_title ~ '[<>]' then raise exception 'invalid: title' using errcode = '22023'; end if;
      if char_length(v_text) > 1500 or v_text ~ '[<>]' then raise exception 'invalid: text' using errcode = '22023'; end if;
      v_id := coalesce(nullif(it ->> 'id', ''), 'i' || gi || '_' || ii);
      if v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'invalid: id' using errcode = '22023'; end if;
      v_total := v_total + char_length(v_title) + char_length(v_text);
      v_items := v_items || jsonb_build_object('id', v_id, 'title', v_title, 'text', v_text);
    end loop;
    v_id := coalesce(nullif(g ->> 'id', ''), 'g' || gi);
    if v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'invalid: id' using errcode = '22023'; end if;
    v_total := v_total + char_length(v_name);
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_name, 'items', v_items);
  end loop;
  if v_total > 20000 then raise exception 'invalid: size' using errcode = '22023'; end if;
  insert into public.settings (section, data) values ('marketing', jsonb_build_object('agents', jsonb_build_object(p_agent, jsonb_build_object(p_kind, v_out))))
  on conflict (section) do update set data = jsonb_set(coalesce(public.settings.data, '{}'::jsonb), '{agents}',
    coalesce(public.settings.data -> 'agents', '{}'::jsonb)
      || jsonb_build_object(p_agent, coalesce(public.settings.data -> 'agents' -> p_agent, '{}'::jsonb) || jsonb_build_object(p_kind, v_out)));
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'mkt.agent.kb', 'settings', p_agent, jsonb_build_object('kind', p_kind, 'sections', jsonb_array_length(v_out), 'items', (select count(*) from jsonb_array_elements(v_out) x, jsonb_array_elements(x -> 'items'))));
  return v_out;
end
$$;
revoke execute on function public.mkt_agent_kb_set(text, text, jsonb) from public, anon;
grant execute on function public.mkt_agent_kb_set(text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the designer's trend tags and sites (ش39)

create or replace function public.mkt_trend_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_perm('marketing.view') <> 'N' or public.is_admin()
    then jsonb_build_object(
      'tags', coalesce((select data -> 'trends' -> 'tags' from public.settings where section = 'marketing'), '[]'::jsonb),
      'sources', coalesce((select data -> 'trends' -> 'sources' from public.settings where section = 'marketing'), '[]'::jsonb),
      'adTags', coalesce((select data -> 'trends' -> 'adTags' from public.settings where section = 'marketing'), '[]'::jsonb))
    else jsonb_build_object('tags', '[]'::jsonb, 'sources', '[]'::jsonb, 'adTags', '[]'::jsonb) end
$$;
revoke execute on function public.mkt_trend_settings() from public, anon;
grant execute on function public.mkt_trend_settings() to authenticated, service_role;

-- p_tags: up to 30 words (a hashtag without its #: English or Arabic letters, digits and _ — what Instagram's hashtag search takes);
-- p_sources: up to 15 plain host names. Duplicates are kept once; the admin only.
create or replace function public.mkt_trend_settings_set(p_tags jsonb, p_sources jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_tags jsonb := '[]'::jsonb; v_src jsonb := '[]'::jsonb; x jsonb; t text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' or jsonb_array_length(p_tags) > 30 then raise exception 'invalid: tags' using errcode = '22023'; end if;
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) > 15 then raise exception 'invalid: sources' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_tags) loop
    t := lower(btrim(regexp_replace(coalesce(x #>> '{}', ''), '^#+', '')));
    if jsonb_typeof(x) <> 'string' or t !~ '^[A-Za-z0-9_\u0621-\u064A\u0660-\u0669\u0671-\u06D3]{1,40}$' then raise exception 'invalid: tags' using errcode = '22023'; end if;
    if not v_tags @> to_jsonb(t) then v_tags := v_tags || to_jsonb(t); end if;
  end loop;
  for x in select * from jsonb_array_elements(p_sources) loop
    t := lower(btrim(coalesce(x #>> '{}', '')));
    if jsonb_typeof(x) <> 'string' or t !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' or char_length(t) > 100 then raise exception 'invalid: sources' using errcode = '22023'; end if;
    if not v_src @> to_jsonb(t) then v_src := v_src || to_jsonb(t); end if;
  end loop;
  insert into public.settings (section, data) values ('marketing', jsonb_build_object('trends', jsonb_build_object('tags', v_tags, 'sources', v_src)))
  on conflict (section) do update set data = jsonb_set(coalesce(public.settings.data, '{}'::jsonb), '{trends}',
    coalesce(public.settings.data -> 'trends', '{}'::jsonb) || jsonb_build_object('tags', v_tags, 'sources', v_src));
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'mkt.trends.settings', 'settings', 'trends', jsonb_build_object('tags', jsonb_array_length(v_tags), 'sources', jsonb_array_length(v_src)));
  return jsonb_build_object('tags', v_tags, 'sources', v_src);
end
$$;
revoke execute on function public.mkt_trend_settings_set(jsonb, jsonb) from public, anon;
grant execute on function public.mkt_trend_settings_set(jsonb, jsonb) to authenticated, service_role;

-- ش44 (the owner 17 Nov — «ضيفلي في الستينج بتاعة الميديا باير اني اضيف اسماء المنافسين و الاعلانات الاكثر قوة بناء علي التاجز اللي اضيفها
-- هناك»): the media buyer's ad tags — each opens Meta's Ad Library on that word (the library's own pages; no ad is pulled). Up to 30 words
-- (spaces allowed — a search, not a hashtag), 1–40 characters, no < >; the admin only. Kept in settings.marketing.trends.adTags.
create or replace function public.mkt_ad_tags_set(p_tags jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_tags jsonb := '[]'::jsonb; x jsonb; t text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' or jsonb_array_length(p_tags) > 30 then raise exception 'invalid: tags' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_tags) loop
    t := btrim(regexp_replace(regexp_replace(coalesce(x #>> '{}', ''), '^#+', ''), '\s+', ' ', 'g'));
    if jsonb_typeof(x) <> 'string' or t = '' or char_length(t) > 40 or t ~ '[<>]' then raise exception 'invalid: tags' using errcode = '22023'; end if;
    if not v_tags @> to_jsonb(t) then v_tags := v_tags || to_jsonb(t); end if;
  end loop;
  insert into public.settings (section, data) values ('marketing', jsonb_build_object('trends', jsonb_build_object('adTags', v_tags)))
  on conflict (section) do update set data = jsonb_set(coalesce(public.settings.data, '{}'::jsonb), '{trends}',
    coalesce(public.settings.data -> 'trends', '{}'::jsonb) || jsonb_build_object('adTags', v_tags));
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'mkt.ads.tags', 'settings', 'trends', jsonb_build_object('tags', jsonb_array_length(v_tags)));
  return v_tags;
end
$$;
revoke execute on function public.mkt_ad_tags_set(jsonb) from public, anon;
grant execute on function public.mkt_ad_tags_set(jsonb) to authenticated, service_role;
