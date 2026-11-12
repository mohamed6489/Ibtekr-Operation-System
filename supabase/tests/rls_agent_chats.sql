-- Tests for 0084_agent_chats (the owner, 12 Nov — the assistants' chats like Claude's: a history per member, rename, delete; the
-- assistants' settings). Depends on 0001_identity … 0084. Runs in one transaction and rolls back; prints NOTICE 'rls_agent_chats: ok'
-- only if every case passed. Live-safe: its made-up members, chats and settings are rolled back.
-- * a member reads their own chats and turns only (marketing.view ≠ N); never inserts a chat or a turn; renames their own (the title)
--   and deletes it through mkt_agent_chat_delete (final, gone from the list); the owner / the assistant / the dates stay the server's; another member's chat is
--   invisible and untouched; no marketing.view = nothing
-- * mkt_agent_settings(): marketing.view; mkt_agent_settings_set(): the admin only, the three keys, their limits, merged per assistant
--   without touching the row's other keys

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000083a1', 'ac-adm.dev@ibtekr.local', '010000083a1'),
  ('00000000-0000-4000-8000-0000000083a2', 'ac-ops.dev@ibtekr.local', '010000083a2'),
  ('00000000-0000-4000-8000-0000000083a3', 'ac-des.dev@ibtekr.local', '010000083a3'),
  ('00000000-0000-4000-8000-0000000083a4', 'ac-acc.dev@ibtekr.local', '010000083a4');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ac-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000083a1', 'أدمن الشات',   'ac-adm.dev@ibtekr.local', '010000083a1', 'admin',    'active', '{}'),
  ('00000000-0000-4000-8000-0000000083a2', 'عمليات الشات', 'ac-ops.dev@ibtekr.local', '010000083a2', 'ops',      'active', '{}'),
  ('00000000-0000-4000-8000-0000000083a3', 'ديزاينر الشات', 'ac-des.dev@ibtekr.local', '010000083a3', 'designer', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000083a4', 'حسابات الشات', 'ac-acc.dev@ibtekr.local', '010000083a4', 'accounts', 'active', '{}');

-- the server's chats and turns (runner = the service role's path)
insert into public.mkt_agent_chats (id, member_id, agent, title, updated_at) values
  ('00000000-0000-4000-8000-0000000083c1', '00000000-0000-4000-8000-0000000083a2', 'buyer',    'حلل آخر أسبوع', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000083c2', '00000000-0000-4000-8000-0000000083a2', 'designer', 'بوست الشتا',    now()),
  ('00000000-0000-4000-8000-0000000083c3', '00000000-0000-4000-8000-0000000083a3', 'designer', 'شات الديزاينر', now());
insert into public.mkt_agent_messages (chat_id, role, text) values
  ('00000000-0000-4000-8000-0000000083c1', 'user', 'إيه أحسن حملة؟'), ('00000000-0000-4000-8000-0000000083c1', 'assistant', 'Macrame'),
  ('00000000-0000-4000-8000-0000000083c3', 'user', 'سر الديزاينر');
insert into public.settings (section, data) values ('marketing', '{"autopublish": true}')
  on conflict (section) do update set data = (public.settings.data - 'agents') || '{"autopublish": true}'; -- live-safe: no agents' settings yet

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

do $$ begin
  if has_table_privilege('authenticated', 'public.mkt_agent_chats', 'INSERT') or has_table_privilege('authenticated', 'public.mkt_agent_messages', 'INSERT')
     or has_table_privilege('authenticated', 'public.mkt_agent_messages', 'UPDATE') or has_table_privilege('authenticated', 'public.mkt_agent_chats', 'DELETE')
     or has_table_privilege('anon', 'public.mkt_agent_chats', 'SELECT') then
    raise exception 'case only the server writes the chats and the turns failed';
  end if;
  if has_column_privilege('authenticated', 'public.mkt_agent_chats', 'member_id', 'UPDATE') or has_column_privilege('authenticated', 'public.mkt_agent_chats', 'deleted_at', 'UPDATE') or not has_column_privilege('authenticated', 'public.mkt_agent_chats', 'title', 'UPDATE') then
    raise exception 'case a member updates the title only failed';
  end if;
  if has_function_privilege('anon', 'public.mkt_agent_settings_set(text, jsonb)', 'execute') or has_function_privilege('anon', 'public.mkt_agent_settings()', 'execute') then
    raise exception 'case the settings functions are closed to anon failed';
  end if;
  -- decision 6: the bucket marketing keeps a chat's images (agents/<member>/…) to their member (where Storage exists — the live project)
  if to_regclass('storage.objects') is not null and not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'marketing_files_select' and qual like '%agents%' and qual like '%auth.uid()%') then
    raise exception 'case a chat''s images are their member''s only failed';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_runs_source_check' and pg_get_constraintdef(oid) like '%agent%') then raise exception 'case ai_runs takes source agent failed'; end if;
end $$;

-- ops: their own two chats, newest first; the turns of their own only; renames; deletes; never another's
select pg_temp.as_member('00000000-0000-4000-8000-0000000083a2');
do $$ begin
  if (select array_agg(title order by updated_at desc) from public.mkt_agent_chats) <> array['بوست الشتا', 'حلل آخر أسبوع'] then raise exception 'case a member sees their own chats only failed'; end if;
  if (select count(*) from public.mkt_agent_messages) <> 2 then raise exception 'case a member reads the turns of their own chats only failed'; end if;
  begin update public.mkt_agent_chats set member_id = '00000000-0000-4000-8000-0000000083a3' where id = '00000000-0000-4000-8000-0000000083c1'; raise exception 'case a member never moves a chat failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_agent_chats set agent = 'dev' where id = '00000000-0000-4000-8000-0000000083c1'; raise exception 'case a member never changes the assistant failed';
  exception when insufficient_privilege then null; end;
  update public.mkt_agent_chats set title = '  حملات   الأسبوع ' where id = '00000000-0000-4000-8000-0000000083c1';
  if (select title || '|' || agent || '|' || member_id::text from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000083c1') <> 'حملات   الأسبوع|buyer|00000000-0000-4000-8000-0000000083a2' then
    raise exception 'case a rename keeps the owner and the assistant failed';
  end if;
  begin update public.mkt_agent_chats set title = '   ' where id = '00000000-0000-4000-8000-0000000083c1'; raise exception 'case an empty title failed';
  exception when invalid_parameter_value then null; end;
  update public.mkt_agent_chats set title = 'مسروق' where id = '00000000-0000-4000-8000-0000000083c3';
  begin update public.mkt_agent_chats set deleted_at = now() where id = '00000000-0000-4000-8000-0000000083c2'; raise exception 'case a member deletes through the function only failed';
  exception when insufficient_privilege then null; end;
  begin perform public.mkt_agent_chat_delete('00000000-0000-4000-8000-0000000083c3'); raise exception 'case someone else''s chat is never deleted failed';
  exception when no_data_found then null; end;
  perform public.mkt_agent_chat_delete('00000000-0000-4000-8000-0000000083c2');
  begin perform public.mkt_agent_chat_delete('00000000-0000-4000-8000-0000000083c2'); raise exception 'case a deleted chat is final failed';
  exception when no_data_found then null; end;
  if exists (select 1 from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000083c2') then raise exception 'case a deleted chat leaves the list failed'; end if;
  begin insert into public.mkt_agent_chats (member_id, agent) values ('00000000-0000-4000-8000-0000000083a2', 'buyer'); raise exception 'case a member never makes a chat failed';
  exception when insufficient_privilege then null; end;
  begin insert into public.mkt_agent_messages (chat_id, role, text) values ('00000000-0000-4000-8000-0000000083c1', 'assistant', 'مزوّر'); raise exception 'case a member never writes a turn failed';
  exception when insufficient_privilege then null; end;
  if public.mkt_agent_settings() <> '{}'::jsonb then raise exception 'case no settings yet = {} failed'; end if;
  begin perform public.mkt_agent_settings_set('buyer', '{"intro":"x"}'); raise exception 'case a member never sets the assistants failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  if (select title from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000083c3') <> 'شات الديزاينر' then raise exception 'case another member''s chat is untouched failed'; end if;
  if (select deleted_at from public.mkt_agent_chats where id = '00000000-0000-4000-8000-0000000083c2') < now() - interval '1 minute' then raise exception 'case the deletion is stamped by the server failed'; end if;
end $$;

-- the accounts member (no marketing.view): nothing
select pg_temp.as_member('00000000-0000-4000-8000-0000000083a4');
do $$ begin
  if exists (select 1 from public.mkt_agent_chats) or exists (select 1 from public.mkt_agent_messages) then raise exception 'case no marketing.view = no chats failed'; end if;
end $$;
reset role;

-- the admin: the settings, merged per assistant, the row's other keys kept, the limits
select pg_temp.as_member('00000000-0000-4000-8000-0000000083a1');
do $$
declare r jsonb;
begin
  r := public.mkt_agent_settings_set('designer', '{"intro":"أنا الديزاينر","instructions":"الألوان بيج وأخضر","suggestions":["بوست جديد","  ستوري  "]}');
  if r <> '{"intro":"أنا الديزاينر","instructions":"الألوان بيج وأخضر","suggestions":["بوست جديد","ستوري"]}'::jsonb then raise exception 'case the settings are saved cleaned failed (%)', r; end if;
  perform public.mkt_agent_settings_set('designer', '{"instructions":"من غير أسود"}');
  if (select data -> 'agents' -> 'designer' ->> 'intro' from public.settings where section = 'marketing') <> 'أنا الديزاينر'
     or (select data ->> 'autopublish' from public.settings where section = 'marketing') <> 'true' then raise exception 'case a save merges the keys sent only failed'; end if;
  begin perform public.mkt_agent_settings_set('seo', '{}'); raise exception 'case an unknown assistant failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_settings_set('dev', '{"model":"x"}'); raise exception 'case an unknown key failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_settings_set('dev', '{"instructions":"<script>"}'); raise exception 'case < > failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_settings_set('dev', jsonb_build_object('suggestions', to_jsonb(array['1','2','3','4','5','6','7','8','9']))); raise exception 'case 8 suggestions at most failed'; exception when invalid_parameter_value then null; end;
  begin perform public.mkt_agent_settings_set('dev', jsonb_build_object('instructions', repeat('x', 4001))); raise exception 'case the instructions limit failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

select pg_temp.as_member('00000000-0000-4000-8000-0000000083a3');
do $$ begin
  if public.mkt_agent_settings() -> 'designer' ->> 'instructions' <> 'من غير أسود' then raise exception 'case a member with marketing.view reads the settings failed'; end if;
  raise notice 'rls_agent_chats: ok';
end $$;
reset role;

rollback;
