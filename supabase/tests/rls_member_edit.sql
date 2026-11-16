-- Tests for 0111_member_edit (the owner 16 Nov — the admin or the direct manager edits any member's data and access; the pay stays the
-- admin's; a manager gives nothing above his own). Depends on 0001 … 0111. One transaction, rolled back; NOTICE 'rls_member_edit: ok'
-- only if every case passed. Live-safe: made-up roles and members.

begin;

insert into public.roles (id, name, permissions, level_perms) values
  ('me_mgr111', 'دور مدير الاختبار', '{"hr.view":"P","orders.view":"F","orders.status":"P"}', '{}'),
  ('me_low111', 'دور موظف الاختبار', '{"orders.view":"P"}', '{"manager":{"orders.view":"F","accounts.view":"F"}}'),
  ('me_big111', 'دور كبير', '{"accounts.view":"F"}', '{}');
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000111a1', 'me-adm.dev@ibtekr.local', '01000111001'),
  ('00000000-0000-4000-8000-0000000111a2', 'me-mgr.dev@ibtekr.local', '01000111002'),
  ('00000000-0000-4000-8000-0000000111a3', 'me-x.dev@ibtekr.local', '01000111003'),
  ('00000000-0000-4000-8000-0000000111a4', 'me-y.dev@ibtekr.local', '01000111004'),
  ('00000000-0000-4000-8000-0000000111a5', 'me-adm2.dev@ibtekr.local', '01000111005');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000111a1', 'أدمن التعديل', 'me-adm.dev@ibtekr.local', '01000111001', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000111a2', 'مدير مباشر', 'me-mgr.dev@ibtekr.local', '01000111002', 'me_mgr111', 'active'),
  ('00000000-0000-4000-8000-0000000111a3', 'عضو تحته', 'me-x.dev@ibtekr.local', '01000111003', 'me_low111', 'active'),
  ('00000000-0000-4000-8000-0000000111a4', 'عضو مش تحته', 'me-y.dev@ibtekr.local', '01000111004', 'me_low111', 'active'),
  ('00000000-0000-4000-8000-0000000111a5', 'أدمن تحته', 'me-adm2.dev@ibtekr.local', '01000111005', 'admin', 'active');
update public.profiles set manager_id = '00000000-0000-4000-8000-0000000111a2', manager_fixed = true
 where id in ('00000000-0000-4000-8000-0000000111a3', '00000000-0000-4000-8000-0000000111a5');
update public.profiles set manager_id = '00000000-0000-4000-8000-0000000111a1', manager_fixed = true where id = '00000000-0000-4000-8000-0000000111a4';

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create or replace function pg_temp.fails(p_sql text, p_code text) returns boolean language plpgsql as $$
begin
  execute p_sql; return false;
exception when others then
  if p_code is not null and sqlstate <> p_code and sqlerrm not like p_code then raise exception 'expected % got % (%)', p_code, sqlstate, sqlerrm; end if;
  return true;
end $$;

-- the grants
do $$ begin
  if has_function_privilege('anon', 'public.member_info_set(uuid, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.member_job_set(uuid, text, text, date, numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.member_can_edit(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.perms_within_mine(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.caller_aal_ok()', 'EXECUTE') then
    raise exception 'case the grants failed';
  end if;
  if not has_function_privilege('authenticated', 'public.member_info_set(uuid, text, text, text)', 'EXECUTE') then raise exception 'case members may call failed'; end if;
end $$;

-- the direct manager
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin
  if not public.member_can_edit('00000000-0000-4000-8000-0000000111a3') then raise exception 'case manager edits his report failed'; end if;
  if public.member_can_edit('00000000-0000-4000-8000-0000000111a4') then raise exception 'case manager edits another team failed'; end if;
  if public.member_can_edit('00000000-0000-4000-8000-0000000111a2') then raise exception 'case manager edits himself failed'; end if;
  if public.member_can_edit('00000000-0000-4000-8000-0000000111a5') then raise exception 'case manager edits an admin under him failed'; end if;
  -- the data
  perform public.member_info_set('00000000-0000-4000-8000-0000000111a3', '  عضو   جديد ', '٠١٠٠٠١١١٠٩٩', 'مصمم');
  if not pg_temp.fails($q$select public.member_info_set('00000000-0000-4000-8000-0000000111a4', 'س', null, null)$q$, '42501') then raise exception 'case another team info failed'; end if;
  if not pg_temp.fails($q$select public.member_info_set('00000000-0000-4000-8000-0000000111a3', null, '123', null)$q$, '22023') then raise exception 'case bad phone failed'; end if;
  if not pg_temp.fails($q$select public.member_info_set('00000000-0000-4000-8000-0000000111a3', null, '01000111004', null)$q$, '23505') then raise exception 'case taken phone failed'; end if;
  if not pg_temp.fails($q$select public.member_info_set('00000000-0000-4000-8000-0000000111a3', '<b>x</b>', null, null)$q$, '22023') then raise exception 'case bad name failed'; end if;
  perform public.member_job_set('00000000-0000-4000-8000-0000000111a3', '10:00', '18:00', date '2026-01-01', 25);
  if not pg_temp.fails($q$select public.member_job_set('00000000-0000-4000-8000-0000000111a4', '10:00', null, null, null)$q$, '42501') then raise exception 'case another team job failed'; end if;
  -- the access, up to his own
  perform public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"orders.view":"F","orders.status":"P"}');
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"accounts.view":"P"}')$q$, 'invalid: above') then raise exception 'case perms above failed'; end if;
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"orders.status":"F"}')$q$, 'invalid: above') then raise exception 'case perms F over P failed'; end if;
  if not pg_temp.fails($q$select public.member_level_set('00000000-0000-4000-8000-0000000111a3', 'manager')$q$, 'invalid: above') then raise exception 'case level above failed'; end if;
  perform public.member_level_set('00000000-0000-4000-8000-0000000111a3', 'viewer');
  if not pg_temp.fails($q$select public.member_role_set('00000000-0000-4000-8000-0000000111a3', 'me_big111')$q$, 'invalid: above') then raise exception 'case role above failed'; end if;
  if not pg_temp.fails($q$select public.member_role_set('00000000-0000-4000-8000-0000000111a3', 'admin')$q$, 'invalid: admin') then raise exception 'case manager makes admin failed'; end if;
  if not pg_temp.fails($q$select public.member_roles_set('00000000-0000-4000-8000-0000000111a3', array['me_big111'])$q$, 'invalid: above') then raise exception 'case extra role above failed'; end if;
  perform public.member_status_set('00000000-0000-4000-8000-0000000111a3', 'suspended', 'اختبار');
  perform public.member_status_set('00000000-0000-4000-8000-0000000111a3', 'active', null);
  if not pg_temp.fails($q$select public.member_status_set('00000000-0000-4000-8000-0000000111a4', 'suspended', 'x')$q$, '42501') then raise exception 'case another team status failed'; end if;
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a5', '{}')$q$, '42501') then raise exception 'case manager touches an admin failed'; end if;
end $$;
reset role;
-- an override that holds the role's F back: taking it off hands the F over — refused for a manager without it
update public.roles set permissions = permissions || '{"accounts.view":"F"}' where id = 'me_low111';
update public.profiles set custom_perms = '{"accounts.view":"N"}', level = 'employee' where id = '00000000-0000-4000-8000-0000000111a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{}')$q$, 'invalid: above') then raise exception 'case removing an override above failed'; end if;
  perform public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"accounts.view":"N","orders.view":"F"}');
end $$;
reset role;
update public.roles set permissions = '{"orders.view":"P"}' where id = 'me_low111';
update public.profiles set custom_perms = '{"orders.view":"F","orders.status":"P"}', level = 'viewer' where id = '00000000-0000-4000-8000-0000000111a3';
-- a role change starts the member at «موظف» (0096): a role whose «موظف» set is within the manager's own goes through even for a member
-- who was «مدير»
update public.roles set level_perms = '{"manager":{"accounts.view":"F"}}', permissions = '{"orders.view":"P"}' where id = 'me_big111';
update public.profiles set level = 'manager', custom_perms = '{}' where id = '00000000-0000-4000-8000-0000000111a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin perform public.member_role_set('00000000-0000-4000-8000-0000000111a3', 'me_big111'); end $$;
reset role;
do $$ begin
  if (select level from public.profiles where id = '00000000-0000-4000-8000-0000000111a3') <> 'employee' then raise exception 'case level reset on role failed'; end if;
end $$;
-- a suspended member: taking off an override that holds the role's F back is refused all the same (status-blind)
update public.roles set permissions = '{"orders.view":"P","accounts.view":"F"}', level_perms = '{}' where id = 'me_low111';
update public.profiles set role_id = 'me_low111', level = 'employee', custom_perms = '{"accounts.view":"N"}', status = 'suspended' where id = '00000000-0000-4000-8000-0000000111a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{}')$q$, 'invalid: above') then raise exception 'case suspended override removal failed'; end if;
  -- reactivating hands everything back: refused while the member has a permission above the manager's
  perform public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"accounts.view":"N"}');
end $$;
reset role;
update public.profiles set custom_perms = '{}' where id = '00000000-0000-4000-8000-0000000111a3';
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin
  if not pg_temp.fails($q$select public.member_status_set('00000000-0000-4000-8000-0000000111a3', 'active', null)$q$, 'invalid: above') then raise exception 'case reactivation above failed'; end if;
end $$;
reset role;
update public.roles set permissions = '{"orders.view":"P"}' where id = 'me_low111';
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a2');
do $$ begin perform public.member_status_set('00000000-0000-4000-8000-0000000111a3', 'active', null); end $$;
reset role;
update public.profiles set role_id = 'me_low111', level = 'viewer', custom_perms = '{"orders.view":"F","orders.status":"P"}' where id = '00000000-0000-4000-8000-0000000111a3';
update public.roles set permissions = '{"accounts.view":"F"}', level_perms = '{}' where id = 'me_big111';
-- a manager behind 2FA on an aal1 session edits nobody
update public.profiles set twofa = true where id = '00000000-0000-4000-8000-0000000111a2';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000111a2', 'role', 'authenticated', 'aal', 'aal1')::text, true);
do $$ begin
  if public.member_can_edit('00000000-0000-4000-8000-0000000111a3') then raise exception 'case aal1 manager edits failed'; end if;
  if public.perms_within_mine('{}') then raise exception 'case aal1 within mine failed'; end if;
end $$;
reset role;
update public.profiles set twofa = false where id = '00000000-0000-4000-8000-0000000111a2';
do $$ declare p record; j record; begin
  select name, phone, title, level, custom_perms into p from public.profiles where id = '00000000-0000-4000-8000-0000000111a3';
  if p.name <> 'عضو جديد' or p.phone <> '01000111099' or p.title <> 'مصمم' then raise exception 'case info written failed: %', row_to_json(p); end if;
  if p.level <> 'viewer' or p.custom_perms <> '{"orders.view":"F","orders.status":"P"}'::jsonb then raise exception 'case access written failed: %', row_to_json(p); end if;
  select shift_start, hire_date, leave_days into j from public.hr_members where member_id = '00000000-0000-4000-8000-0000000111a3';
  if j.shift_start <> '10:00'::time or j.hire_date <> date '2026-01-01' or j.leave_days <> 25 then raise exception 'case job written failed'; end if;
  if not exists (select 1 from public.activity_log where action = 'hr.member.info' and entity_id = '00000000-0000-4000-8000-0000000111a3' and new_value = '["name","phone","title"]'::jsonb) then
    raise exception 'case info logged by field names failed';
  end if;
end $$;

-- the member himself is not his own editor here, nor his manager's
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a3');
do $$ begin
  if not pg_temp.fails($q$select public.member_info_set('00000000-0000-4000-8000-0000000111a2', 'x x', null, null)$q$, '42501') then raise exception 'case report edits manager failed'; end if;
  if not pg_temp.fails($q$select public.member_perms_set('00000000-0000-4000-8000-0000000111a3', '{"orders.view":"F"}')$q$, '42501') then raise exception 'case self perms failed'; end if;
end $$;
reset role;

-- the admin: anyone (not himself through member_info_set), any permission
select pg_temp.as_member('00000000-0000-4000-8000-0000000111a1');
do $$ begin
  perform public.member_info_set('00000000-0000-4000-8000-0000000111a4', 'عضو بعد الأدمن', null, 'محاسب');
  perform public.member_perms_set('00000000-0000-4000-8000-0000000111a4', '{"accounts.view":"F"}');
  perform public.member_role_set('00000000-0000-4000-8000-0000000111a4', 'me_big111');
  perform public.member_info_set('00000000-0000-4000-8000-0000000111a5', 'أدمن معدّل', null, null);
end $$;
reset role;

do $$ begin raise notice 'rls_member_edit: ok'; end $$;
rollback;
