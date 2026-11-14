-- Tests for 0098_quick_actions (owner batch 2 decision 16): the quick actions by visibility (كل الفريق / دور معين / أنا بس) and state.
-- One transaction, rolled back; NOTICE 'rls_quick_actions: ok' only if every case passed. Live-safe: made-up members, rows rolled back.
-- * «كل الفريق»: the admin writes, everyone reads · «دور معين»: the admin or the role's manager writes, the role reads (main or extra)
-- * «أنا بس»: the owner only · the table is select-only for members · reorder moves only what the member may edit

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000098a1', 'qa-adm.dev@ibtekr.local', '010000098a1'),
  ('00000000-0000-4000-8000-0000000098a2', 'qa-mgr.dev@ibtekr.local', '010000098a2'),
  ('00000000-0000-4000-8000-0000000098a3', 'qa-ops.dev@ibtekr.local', '010000098a3'),
  ('00000000-0000-4000-8000-0000000098a4', 'qa-cs.dev@ibtekr.local', '010000098a4'),
  ('00000000-0000-4000-8000-0000000098a5', 'qa-ext.dev@ibtekr.local', '010000098a5');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles, level) values
  ('00000000-0000-4000-8000-0000000098a1', 'أدمن', 'qa-adm.dev@ibtekr.local', '010000098a1', 'admin', 'active', '{}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000098a2', 'مدير العمليات', 'qa-mgr.dev@ibtekr.local', '010000098a2', 'ops', 'active', '{}', '{}', 'manager'),
  ('00000000-0000-4000-8000-0000000098a3', 'موظف عمليات', 'qa-ops.dev@ibtekr.local', '010000098a3', 'ops', 'active', '{}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000098a4', 'خدمة عملاء', 'qa-cs.dev@ibtekr.local', '010000098a4', 'cs', 'active', '{}', '{}', 'employee'),
  ('00000000-0000-4000-8000-0000000098a5', 'إضافي عمليات', 'qa-ext.dev@ibtekr.local', '010000098a5', 'cs', 'active', '{}', '{ops}', 'employee');
delete from public.quick_actions;

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create temp table qa_ids (k text primary key, id uuid);
grant all on qa_ids to authenticated;

-- the admin: all + a role row
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a1');
do $$ begin
  insert into qa_ids values ('all', public.quick_action_save('{"name":"أوردرات النهارده","link":"#orders?st=x","scope":"all"}'));
  insert into qa_ids values ('cs', public.quick_action_save('{"name":"عملاء","link":"#cs","scope":"role","role":"cs"}'));
  begin perform public.quick_action_save('{"name":"<b>","link":"#orders","scope":"all"}'); raise exception 'case a name with <> is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.quick_action_save('{"name":"x","link":"https://evil.example","scope":"all"}'); raise exception 'case a link outside the system is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.quick_action_save('{"name":"x","link":"#orders","scope":"role","role":"admin"}'); raise exception 'case the admin role is refused failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- the ops manager: a row for ops, never «كل الفريق», never another role
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a2');
do $$ begin
  insert into qa_ids values ('ops', public.quick_action_save('{"name":"تجميع","link":"#inventory","scope":"role","role":"ops"}'));
  begin perform public.quick_action_save('{"name":"x","link":"#orders","scope":"all"}'); raise exception 'case a manager writes no all row failed'; exception when insufficient_privilege then null; end;
  begin perform public.quick_action_save('{"name":"x","link":"#orders","scope":"role","role":"cs"}'); raise exception 'case a manager writes no other role failed'; exception when insufficient_privilege then null; end;
  begin perform public.quick_action_delete((select id from qa_ids where k = 'all')); raise exception 'case a manager deletes no all row failed'; exception when no_data_found then null; end;
end $$;
reset role;

-- an ops employee: reads all + ops, writes «أنا بس» only, cannot touch the ops row; the table is not writable directly
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a3');
do $$ declare n int; begin
  insert into qa_ids values ('mine', public.quick_action_save('{"name":"تذاكري","link":"#tickets","scope":"me"}'));
  select count(*) into n from public.quick_actions_list();
  if n <> 3 then raise exception 'case an ops employee sees all + ops + his own (3) failed: %', n; end if;
  if (select can_edit from public.quick_actions_list() where id = (select id from qa_ids where k = 'ops')) then raise exception 'case an employee cannot edit the role row failed'; end if;
  begin perform public.quick_action_save(jsonb_build_object('id', (select id from qa_ids where k = 'ops'), 'name', 'x', 'link', '#orders', 'scope', 'role', 'role', 'ops'));
    raise exception 'case an employee edits no role row failed'; exception when insufficient_privilege then null; end;
  begin insert into public.quick_actions (name, link, scope) values ('x', '#orders', 'all'); raise exception 'case no direct insert failed'; exception when insufficient_privilege then null; end;
  begin update public.quick_actions set name = 'x'; raise exception 'case no direct update failed'; exception when insufficient_privilege then null; end;
  -- reorder: his own row moves, the others keep their place
  perform public.quick_action_order(array[(select id from qa_ids where k = 'mine'), (select id from qa_ids where k = 'all')]);
  if (select sort from public.quick_actions where id = (select id from qa_ids where k = 'mine')) <> 0 then raise exception 'case reorder moves my row failed'; end if;
  if (select sort from public.quick_actions where id = (select id from qa_ids where k = 'all')) <> 0 then raise exception 'case reorder keeps a row I cannot edit failed'; end if;
  -- «موقوف»
  perform public.quick_action_save(jsonb_build_object('id', (select id from qa_ids where k = 'mine'), 'name', 'تذاكري', 'link', '#tickets', 'scope', 'me', 'active', false));
  if (select active from public.quick_actions_list() where id = (select id from qa_ids where k = 'mine')) then raise exception 'case a row can be stopped failed'; end if;
end $$;
reset role;

-- cs: all + cs, nothing of ops nor the ops employee's own; an extra ops role sees the ops row
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a4');
do $$ begin
  if (select count(*) from public.quick_actions) <> 2 or exists (select 1 from public.quick_actions where scope = 'me') then raise exception 'case cs sees all + cs only failed'; end if;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a5');
do $$ begin
  if not exists (select 1 from public.quick_actions_list() where id = (select id from qa_ids where k = 'ops')) then raise exception 'case an extra role sees its role rows failed'; end if;
end $$;
reset role;
-- the admin sees no member's own row
select pg_temp.as_member('00000000-0000-4000-8000-0000000098a1');
do $$ begin
  if exists (select 1 from public.quick_actions_list() where scope = 'me') then raise exception 'case a personal row stays personal failed'; end if;
  if has_function_privilege('anon', 'public.quick_action_save(jsonb)', 'EXECUTE') then raise exception 'case closed to anon failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_quick_actions: ok'; end $$;
rollback;
