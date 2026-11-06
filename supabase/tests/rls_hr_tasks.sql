-- RLS / permission tests for 0048_hr_tasks (phase 10 decision 25 «ملفي › مهامي»: a member's tasks, their manager and the admin,
-- the review, the marked delete). Depends on 0001_identity … 0048_hr_tasks. Runs in one transaction and rolls back; prints
-- NOTICE 'rls_hr_tasks: ok' only if every case passed. Live-safe: its made-up members and rows are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000048a1', 'tk-adm.dev@ibtekr.local', '01000048a01'),
  ('00000000-0000-4000-8000-0000000048a2', 'tk-mgr.dev@ibtekr.local', '01000048a02'),
  ('00000000-0000-4000-8000-0000000048a3', 'tk-rep.dev@ibtekr.local', '01000048a03'),
  ('00000000-0000-4000-8000-0000000048a4', 'tk-other.dev@ibtekr.local', '01000048a04'),
  ('00000000-0000-4000-8000-0000000048a5', 'tk-view.dev@ibtekr.local', '01000048a05'),
  ('00000000-0000-4000-8000-0000000048a6', 'tk-off.dev@ibtekr.local', '01000048a06');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'tk-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, manager_id) values
  ('00000000-0000-4000-8000-0000000048a1', 'أدمن المهام', 'tk-adm.dev@ibtekr.local', '01000048a01', 'admin', 'active', null),
  ('00000000-0000-4000-8000-0000000048a2', 'مدير المهام', 'tk-mgr.dev@ibtekr.local', '01000048a02', 'ops', 'active', null),
  ('00000000-0000-4000-8000-0000000048a3', 'عضو تحت المدير', 'tk-rep.dev@ibtekr.local', '01000048a03', 'cs', 'active', '00000000-0000-4000-8000-0000000048a2'),
  ('00000000-0000-4000-8000-0000000048a4', 'زميل', 'tk-other.dev@ibtekr.local', '01000048a04', 'cs', 'active', null),
  ('00000000-0000-4000-8000-0000000048a5', 'مشاهد المهام', 'tk-view.dev@ibtekr.local', '01000048a05', 'viewer', 'active', null),
  ('00000000-0000-4000-8000-0000000048a6', 'موقوف', 'tk-off.dev@ibtekr.local', '01000048a06', 'cs', 'suspended', null);

create temp table tk_ids (k text primary key, tid bigint) on commit drop;
grant all on tk_ids to authenticated;

-- ================================================================ the member: their own tasks

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a3","role":"authenticated"}', true);
insert into tk_ids values ('own', public.hr_task_add(null, '  تجهيز   عرض' || chr(9) || 'المبتكرين  '));
insert into tk_ids values ('own2', public.hr_task_add('00000000-0000-4000-8000-0000000048a3', 'مكالمة شركة الشحن'));
do $$
declare v public.hr_tasks;
begin
  select * into v from public.hr_tasks where id = (select tid from tk_ids where k = 'own');
  if v.title <> 'تجهيز عرض المبتكرين' then raise exception 'case the title is trimmed and its spaces folded failed: %', v.title; end if;
  if v.status <> 'لسه' or v.day <> public.hr_today() or v.created_by <> '00000000-0000-4000-8000-0000000048a3'
     or v.member_id <> '00000000-0000-4000-8000-0000000048a3' then
    raise exception 'case a new task is the member''s, «لسه», for today failed';
  end if;
  if (select count(*) from public.hr_tasks) <> 2 then raise exception 'case the member reads their own tasks failed'; end if;
  begin perform public.hr_task_add(null, '   '); raise exception 'case an empty title is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_add(null, repeat('م', 201)); raise exception 'case a title over 200 is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_add('00000000-0000-4000-8000-0000000048a4', 'لزميل'); raise exception 'case a member adds no task for a colleague failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_task_add('00000000-0000-4000-8000-0000000048a2', 'لمديري'); raise exception 'case a member adds no task for their manager failed';
  exception when insufficient_privilege then null; end;
  -- no direct write on the table
  begin insert into public.hr_tasks (member_id, title) values ('00000000-0000-4000-8000-0000000048a3', 'مباشر'); raise exception 'case no direct insert failed';
  exception when insufficient_privilege then null; end;
  begin update public.hr_tasks set status = 'خلصت'; raise exception 'case no direct update failed';
  exception when insufficient_privilege then null; end;
  begin delete from public.hr_tasks; raise exception 'case no direct delete failed';
  exception when insufficient_privilege then null; end;
end $$;

-- the statuses and their fields
do $$
declare k bigint := (select tid from tk_ids where k = 'own'); v public.hr_tasks;
begin
  if public.hr_task_set(k, 'جاري', '{}') <> 'جاري' then raise exception 'case a status is set failed'; end if;
  perform public.hr_task_set(k, 'خلصت', null);
  select * into v from public.hr_tasks where id = k;
  if v.status <> 'خلصت' or v.done_at is null then raise exception 'case «خلصت» stamps done_at failed'; end if;
  perform public.hr_task_set(k, 'لسه', '{}');
  if (select done_at from public.hr_tasks where id = k) is not null then raise exception 'case undoing «خلصت» clears done_at failed'; end if;
  begin perform public.hr_task_set(k, 'مش حالة', '{}'); raise exception 'case an unknown status is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'جاري', '[]'); raise exception 'case the args are an object failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'متوقفة', '{"reason":"  "}'); raise exception 'case «متوقفة» needs a reason failed';
  exception when invalid_parameter_value then null; end;
  perform public.hr_task_set(k, 'متوقفة', '{"reason":"مستني رد المحامي"}');
  if (select reason from public.hr_tasks where id = k) <> 'مستني رد المحامي' then raise exception 'case the reason is kept with «متوقفة» failed'; end if;
  perform public.hr_task_set(k, 'جاري', '{}');
  if (select reason from public.hr_tasks where id = k) is not null then raise exception 'case the reason goes with the next status failed'; end if;
  begin perform public.hr_task_set(k, 'جاهزة للمراجعة', '{"reviewer":"00000000-0000-4000-8000-0000000048a3"}'); raise exception 'case the member does not review their own task failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'جاهزة للمراجعة', '{"reviewer":"00000000-0000-4000-8000-0000000048a6"}'); raise exception 'case a suspended reviewer is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'جاهزة للمراجعة', '{"reviewer":"مش uuid"}'); raise exception 'case a garbled reviewer is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'اتأجلت', jsonb_build_object('until', (public.hr_today() - 1)::text)); raise exception 'case a past day is refused failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.hr_task_set(k, 'اتأجلت', '{}'); raise exception 'case «اتأجلت» needs a day or «لأجل غير مسمى» failed';
  exception when invalid_parameter_value then null; end;
  perform public.hr_task_set(k, 'اتأجلت', jsonb_build_object('until', (public.hr_today() + 2)::text));
  if (select until from public.hr_tasks where id = k) <> public.hr_today() + 2 then raise exception 'case «اتأجلت» keeps its day failed'; end if;
  perform public.hr_task_set(k, 'اتأجلت', '{"indefinite":true}');
  if (select until from public.hr_tasks where id = k) is not null then raise exception 'case «لأجل غير مسمى» has no day failed'; end if;
end $$;

-- ================================================================ the manager (hr.view P): their report's tasks

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a2","role":"authenticated"}', true);
insert into tk_ids values ('mgr', public.hr_task_add('00000000-0000-4000-8000-0000000048a3', 'مراجعة صور W&R'));
do $$
begin
  if (select count(*) from public.hr_tasks where member_id = '00000000-0000-4000-8000-0000000048a3') <> 3 then raise exception 'case the manager reads their report''s tasks failed'; end if;
  if (select created_by from public.hr_tasks where id = (select tid from tk_ids where k = 'mgr')) <> '00000000-0000-4000-8000-0000000048a2' then
    raise exception 'case the task is stamped with who put it failed';
  end if;
  perform public.hr_task_set((select tid from tk_ids where k = 'own2'), 'جاري', '{}');
  begin perform public.hr_task_add('00000000-0000-4000-8000-0000000048a4', 'برّه فريقي'); raise exception 'case a manager adds no task outside their team failed';
  exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ a colleague sees none of it

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a4","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.hr_tasks) <> 0 then raise exception 'case a colleague reads none of the member''s tasks failed'; end if;
  begin perform public.hr_task_set((select tid from tk_ids where k = 'own2'), 'خلصت', '{}'); raise exception 'case a colleague changes none of them failed';
  exception when no_data_found then null; end;
  begin perform public.hr_task_delete((select tid from tk_ids where k = 'own2')); raise exception 'case a colleague deletes none of them failed';
  exception when no_data_found then null; end;
  if (select count(*) from public.hr_task_people() p where p.id::text like '00000000-0000-4000-8000-0000000048a%') <> 5
     or exists (select 1 from public.hr_task_people() p where p.id = '00000000-0000-4000-8000-0000000048a6') then
    raise exception 'case the active team''s names are read (not the suspended) failed';
  end if;
end $$;

-- ================================================================ the review

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a3","role":"authenticated"}', true);
select public.hr_task_set((select tid from tk_ids where k = 'own2'), 'جاهزة للمراجعة', '{"reviewer":"00000000-0000-4000-8000-0000000048a4"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a4","role":"authenticated"}', true);
do $$
declare k bigint := (select tid from tk_ids where k = 'own2');
begin
  if (select count(*) from public.hr_tasks) <> 1 or (select id from public.hr_tasks) <> k then raise exception 'case the reviewer reads the task waiting for them (only it) failed'; end if;
  begin perform public.hr_task_set(k, 'خلصت', '{}'); raise exception 'case the reviewer does not set its status failed';
  exception when no_data_found then null; end;
  begin perform public.hr_task_review(k, false, '  '); raise exception 'case «رجّعها» needs a note failed';
  exception when invalid_parameter_value then null; end;
  if public.hr_task_review(k, false, 'ناقص صورة المقاس') <> 'جاري' then raise exception 'case «رجّعها» puts it back to جاري failed'; end if;
  if (select count(*) from public.hr_tasks) <> 0 then raise exception 'case the reviewer stops reading it once it left the review failed'; end if;
  begin perform public.hr_task_review(k, true, null); raise exception 'case a task not waiting for review is not reviewed failed';
  exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a3","role":"authenticated"}', true);
do $$
declare k bigint := (select tid from tk_ids where k = 'own2'); v public.hr_tasks;
begin
  select * into v from public.hr_tasks where id = k;
  if v.status <> 'جاري' or v.review_note <> 'ناقص صورة المقاس' or v.reviewer_id <> '00000000-0000-4000-8000-0000000048a4' then
    raise exception 'case the owner reads the reviewer''s note and who sent it back failed';
  end if;
  perform public.hr_task_set(k, 'جاهزة للمراجعة', '{"reviewer":"00000000-0000-4000-8000-0000000048a4"}');
  if (select review_note from public.hr_tasks where id = k) is not null then raise exception 'case the note goes with the next change failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a5","role":"authenticated"}', true);
do $$
begin
  begin perform public.hr_task_review((select tid from tk_ids where k = 'own2'), true, null); raise exception 'case only the reviewer reviews failed';
  exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a4","role":"authenticated"}', true);
do $$
declare k bigint := (select tid from tk_ids where k = 'own2');
begin
  if public.hr_task_review(k, true, null) <> 'خلصت' then raise exception 'case «تمام — خلصت» failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a3","role":"authenticated"}', true);
do $$
begin
  if (select done_at from public.hr_tasks where id = (select tid from tk_ids where k = 'own2')) is null then raise exception 'case the reviewed task is done failed'; end if;
end $$;

-- ================================================================ the delete (marked) and who may

do $$
declare v_id bigint;
begin
  begin perform public.hr_task_delete((select tid from tk_ids where k = 'mgr')); raise exception 'case a member does not remove a task their manager put failed';
  exception when insufficient_privilege then null; end;
  perform public.hr_task_delete((select tid from tk_ids where k = 'own'));
  if exists (select 1 from public.hr_tasks where id = (select tid from tk_ids where k = 'own')) then raise exception 'case a deleted task is not read failed'; end if;
  begin perform public.hr_task_set((select tid from tk_ids where k = 'own'), 'جاري', '{}'); raise exception 'case a deleted task is not changed failed';
  exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a2","role":"authenticated"}', true);
select public.hr_task_delete((select tid from tk_ids where k = 'mgr'));

-- ================================================================ the admin, the suspended member, a viewer

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a1","role":"authenticated"}', true);
insert into tk_ids values ('adm', public.hr_task_add('00000000-0000-4000-8000-0000000048a4', 'تقرير شكاوى سبتمبر'));
do $$
begin
  if (select count(*) from public.hr_tasks where member_id::text like '00000000-0000-4000-8000-0000000048a%') <> 2 then
    raise exception 'case the admin reads every member''s (live) tasks failed';
  end if;
  begin perform public.hr_task_add('00000000-0000-4000-8000-0000000048a6', 'لموقوف'); raise exception 'case no task for a suspended member failed';
  exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a6","role":"authenticated"}', true);
do $$
begin
  begin perform public.hr_task_add(null, 'وأنا موقوف'); raise exception 'case a suspended member adds nothing failed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.hr_task_people()) <> 0 then raise exception 'case a suspended member reads no names failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a5","role":"authenticated"}', true);
insert into tk_ids values ('view', public.hr_task_add(null, 'مهمة المشاهد'));
do $$
begin
  if (select count(*) from public.hr_tasks) <> 1 then raise exception 'case hr.view N reads their own tasks only failed'; end if;
end $$;

-- ================================================================ a task left from an earlier day comes up to today when touched; the cap

reset role;
insert into public.hr_tasks (member_id, title, day, created_by) values ('00000000-0000-4000-8000-0000000048a4', 'من امبارح', public.hr_today() - 3, '00000000-0000-4000-8000-0000000048a4');
insert into public.hr_tasks (member_id, title, created_by)
  select '00000000-0000-4000-8000-0000000048a5', 'كتير ' || g, '00000000-0000-4000-8000-0000000048a5' from generate_series(1, 299) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a4","role":"authenticated"}', true);
do $$
declare k bigint := (select id from public.hr_tasks where title = 'من امبارح');
begin
  perform public.hr_task_set(k, 'جاري', '{}');
  if (select day from public.hr_tasks where id = k) <> public.hr_today() then raise exception 'case a task touched today is today''s failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000048a5","role":"authenticated"}', true);
do $$
begin
  begin perform public.hr_task_add(null, 'رقم 301'); raise exception 'case at most 300 open tasks on a member failed';
  exception when invalid_parameter_value then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_hr_tasks: ok'; end $$;
rollback;
