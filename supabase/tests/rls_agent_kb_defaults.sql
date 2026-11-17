-- RLS tests for 0125_agent_kb_defaults (the owner 17 Nov — «املا قواعد و اسكيلز مساعدين الذكاء الاصطناعي» و«ريسيت او مسح لاكتر من قاعدة او
-- اسكيلز»): the system's items are in the live list with their keys, a save keeps a key, a reset brings a default back with its text (one, or
-- all — and the admin's own rows only when asked), and only the admin resets. One transaction rolled back; prints NOTICE
-- 'rls_agent_kb_defaults: ok'. Live-safe.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000125a1', 'kbd-admin.dev@ibtekr.local', '01000125a01'),
  ('00000000-0000-4000-8000-0000000125a2', 'kbd-ops.dev@ibtekr.local', '01000125a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000125a1', 'أدمن القواعد', 'kbd-admin.dev@ibtekr.local', '01000125a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000125a2', 'عمليات القواعد', 'kbd-ops.dev@ibtekr.local', '01000125a02', 'ops', 'active');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000125a1","role":"authenticated","aal":"aal2"}', true);
do $$
declare L jsonb; n int; edited jsonb;
begin
  -- the defaults are in the list with their keys
  L := public.ai_agent_kb_list();
  if not exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.truth' and x ->> 'kind' = 'rules') then raise exception 'case the defaults are seeded failed'; end if;
  if not exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'buyer.structure' and x -> 'agents' = '["buyer"]'::jsonb) then raise exception 'case a default keeps its assistant failed'; end if;
  -- the admin edits a default (its key comes back), drops another, adds his own
  select jsonb_agg(case when x ->> 'key' = 'team.style' then jsonb_set(x, '{text}', '"كلام تاني"') else x end) into edited
  from jsonb_array_elements(L) x where x ->> 'kind' = 'rules' and coalesce(x ->> 'key', '') <> 'team.notes';
  edited := edited || jsonb_build_array(jsonb_build_object('section', 'قسمي', 'title', 'قاعدة بتاعتي', 'text', 'نص', 'agents', '[]'::jsonb));
  n := public.ai_agent_kb_set('rules', edited);
  L := public.ai_agent_kb_list();
  if not exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.style' and x ->> 'text' = 'كلام تاني' and (x ->> 'changed')::boolean) then raise exception 'case the edit keeps the key and shows changed failed'; end if;
  if exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.notes') then raise exception 'case a dropped default is gone failed'; end if;
  -- reset one: team.style back to its text, in its place; the others untouched
  n := public.ai_agent_kb_reset('rules', array['team.style']);
  L := public.ai_agent_kb_list();
  if n <> 1 or not exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.style' and not (x ->> 'changed')::boolean) then raise exception 'case reset one failed'; end if;
  if exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.notes') then raise exception 'case reset one leaves the others failed'; end if;
  -- reset all: the dropped default is back, the admin's own row stays …
  n := public.ai_agent_kb_reset('rules');
  L := public.ai_agent_kb_list();
  if not exists (select 1 from jsonb_array_elements(L) x where x ->> 'key' = 'team.notes') or not exists (select 1 from jsonb_array_elements(L) x where x ->> 'title' = 'قاعدة بتاعتي') then raise exception 'case reset all keeps the admin''s own failed'; end if;
  -- … unless asked
  n := public.ai_agent_kb_reset('rules', null, true);
  L := public.ai_agent_kb_list();
  if exists (select 1 from jsonb_array_elements(L) x where x ->> 'title' = 'قاعدة بتاعتي') then raise exception 'case reset all with drop_added failed'; end if;
  if exists (select 1 from jsonb_array_elements(L) x where x ->> 'kind' = 'skills' and x ->> 'key' is null and x ->> 'title' = 'قاعدة بتاعتي') then raise exception 'case the other kind is untouched failed'; end if;
  -- a made-up key is the admin's own row
  n := public.ai_agent_kb_set('skills', (select jsonb_agg(x) from jsonb_array_elements(public.ai_agent_kb_list()) x where x ->> 'kind' = 'skills') || jsonb_build_array(jsonb_build_object('section', 'س', 'title', 'مفتاح وهمي', 'text', '', 'key', 'team.truth')));
  if exists (select 1 from jsonb_array_elements(public.ai_agent_kb_list()) x where x ->> 'title' = 'مفتاح وهمي' and x ->> 'key' is not null) then raise exception 'case a key of another kind is not taken failed'; end if;
end $$;

-- a member resets nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000125a2","role":"authenticated"}', true);
do $$
begin
  begin perform public.ai_agent_kb_reset('rules'); raise exception 'case a member resets nothing failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_agent_kb_defaults: ok'; end $$;
rollback;
