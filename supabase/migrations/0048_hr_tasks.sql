-- 0048_hr_tasks — «ملفي › مهامي» on the server (phase 10 decision 25, the owner 6 Nov: «اعمل مهامى»). The v5 tab as it is: a
-- member's own tasks (type and Enter), six statuses (لسه · جاري · متوقفة with a reason · جاهزة للمراجعة with a reviewer · خلصت ·
-- اتأجلت to a day or with no day), «النهارده» / «المؤجل» / «خلصت» with what was not finished yesterday carried «من امبارح» (block 12's
-- rollover, on the page), and «جاهزة للمراجعة» showing at the reviewer as an automatic task.
-- * Who reads a member's tasks: hr_can_see (me · the members I manage with hr.view P · everyone with F — the HR rule); the reviewer
--   reads a task while it waits for them (the owner's name through hr_task_people()).
-- * Who adds a task / changes its status: the member, their direct manager, hr.edit F on the members they see (the admin) — the
--   v5's «المهام» on an opened member's file. «حذف» marks the task (deleted_at — nothing is deleted); a member does not remove a
--   task someone else put on them (the admin does).
-- * The review: the reviewer «تمام — خلصت» (status خلصت) or «رجّعها» with a note (back to جاري, the note shows at the owner).
-- * No direct write for the members: the five functions below (security definer); the table is read under RLS.
-- * Live: a statement trigger sends the private broadcast «hr» / «tasks» ({ at } only) — hr_receive (0046) lets the active members
--   receive it; the page reloads the tasks alone.
-- Re-runnable; no drop / delete / truncate of data.

create table if not exists public.hr_tasks (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'لسه' check (status in ('لسه', 'جاري', 'متوقفة', 'جاهزة للمراجعة', 'خلصت', 'اتأجلت')),
  day date not null default public.hr_today(),
  reason text check (reason is null or char_length(reason) <= 300),
  reviewer_id uuid references public.profiles on delete set null,
  until date,
  review_note text check (review_note is null or char_length(review_note) <= 300),
  done_at timestamptz,
  created_by uuid references public.profiles on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles on delete set null
);
create index if not exists hr_tasks_member_idx on public.hr_tasks (member_id, status) where deleted_at is null;
create index if not exists hr_tasks_reviewer_idx on public.hr_tasks (reviewer_id) where deleted_at is null and status = 'جاهزة للمراجعة';

alter table public.hr_tasks enable row level security;
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_tasks' and policyname = 'hr_tasks_select') then
    create policy hr_tasks_select on public.hr_tasks for select to authenticated
      using (deleted_at is null and (public.hr_can_see(member_id)
        or (reviewer_id = (select auth.uid()) and status = 'جاهزة للمراجعة' and (select public.hr_active()))));
  end if;
end $pol$;
revoke all on public.hr_tasks from anon, authenticated;
grant select on public.hr_tasks to authenticated;
grant all on public.hr_tasks to service_role;

-- ---------------------------------------------------------------- who writes a member's tasks

create or replace function public.hr_task_writer(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and p_member is not null
    and (p_member = auth.uid() or public.hr_is_manager_of(p_member) or (public.hr_editor() and public.hr_can_see(p_member)))
$$;

-- the names of the active team: «مين هيراجع» and the names on the tasks (who put it, who reviews) — names and codes only, the
-- profiles stay settings.view's (0001)
create or replace function public.hr_task_people()
returns table (id uuid, member_code text, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.member_code, p.name from public.profiles p where public.hr_active() and p.status = 'active' order by p.member_code
$$;

-- ---------------------------------------------------------------- the writes

-- «ضيف مهمة واضغط Enter»: a task for today (p_member null = mine); at most 300 open tasks on a member
create or replace function public.hr_task_add(p_member uuid, p_title text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := coalesce(p_member, auth.uid());
  v_title text := btrim(regexp_replace(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  v_id bigint;
begin
  if not public.hr_task_writer(v_member) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_title = '' or char_length(v_title) > 200 then raise exception 'invalid: title' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_member and p.status = 'active') then raise exception 'not found' using errcode = 'P0002'; end if;
  if (select count(*) from public.hr_tasks t where t.member_id = v_member and t.deleted_at is null and t.status <> 'خلصت') >= 300 then
    raise exception 'invalid: count' using errcode = '22023';
  end if;
  insert into public.hr_tasks (member_id, title, created_by, updated_by) values (v_member, v_title, auth.uid(), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- a status (the v5's dropdown and the checkbox): متوقفة needs a reason, جاهزة للمراجعة an active reviewer who is not the member,
-- اتأجلت a day from today on ({ until }) or { indefinite: true }. A task touched today is today's (the day moves up to today); the
-- reason / reviewer / day are kept for their own status only, and a reviewer's note goes with the next change.
create or replace function public.hr_task_set(p_id bigint, p_status text, p_args jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v public.hr_tasks; a jsonb := coalesce(p_args, '{}'::jsonb); v_today date := public.hr_today();
  v_reason text := nullif(btrim(regexp_replace(coalesce(a ->> 'reason', ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_reviewer uuid; v_until date; v_never boolean := false;
begin
  if jsonb_typeof(a) <> 'object' then raise exception 'invalid: args' using errcode = '22023'; end if;
  select * into v from public.hr_tasks t where t.id = p_id and t.deleted_at is null for update;
  if not found or not public.hr_can_see(v.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_task_writer(v.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('لسه', 'جاري', 'متوقفة', 'جاهزة للمراجعة', 'خلصت', 'اتأجلت') then raise exception 'invalid: status' using errcode = '22023'; end if;
  if p_status = 'متوقفة' and (v_reason is null or char_length(v_reason) > 300) then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if p_status = 'جاهزة للمراجعة' then
    begin v_reviewer := nullif(a ->> 'reviewer', '')::uuid; exception when others then v_reviewer := null; end;
    if v_reviewer is null or v_reviewer = v.member_id
       or not exists (select 1 from public.profiles p where p.id = v_reviewer and p.status = 'active') then
      raise exception 'invalid: reviewer' using errcode = '22023';
    end if;
  end if;
  if p_status = 'اتأجلت' then
    begin v_never := coalesce((a ->> 'indefinite')::boolean, false); exception when others then v_never := false; end;
    if not v_never then
      begin v_until := nullif(a ->> 'until', '')::date; exception when others then v_until := null; end;
      if v_until is null or v_until < v_today then raise exception 'invalid: until' using errcode = '22023'; end if;
    end if;
  end if;
  update public.hr_tasks set status = p_status,
      reason = case when p_status = 'متوقفة' then v_reason end,
      reviewer_id = case when p_status = 'جاهزة للمراجعة' then v_reviewer end,
      until = case when p_status = 'اتأجلت' then v_until end,
      review_note = null,
      done_at = case when p_status = 'خلصت' then coalesce(case when v.status = 'خلصت' then v.done_at end, now()) end,
      day = greatest(v.day, v_today),
      updated_by = auth.uid(), updated_at = now()
    where id = p_id;
  return p_status;
end $$;

-- «حذف»: marks the task; the member does not remove a task someone else put on them (the admin does)
create or replace function public.hr_task_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.hr_tasks;
begin
  select * into v from public.hr_tasks t where t.id = p_id and t.deleted_at is null for update;
  if not found or not public.hr_can_see(v.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_task_writer(v.member_id)
     or (v.member_id = auth.uid() and v.created_by is distinct from auth.uid() and not public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.hr_tasks set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid(), updated_at = now() where id = p_id;
end $$;

-- the reviewer: «تمام — خلصت» (p_ok) or «رجّعها» with a note (back to جاري; the note shows at the owner)
create or replace function public.hr_task_review(p_id bigint, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v public.hr_tasks; v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v from public.hr_tasks t
    where t.id = p_id and t.deleted_at is null and t.status = 'جاهزة للمراجعة' and t.reviewer_id = auth.uid() for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_ok is null then raise exception 'invalid: decision' using errcode = '22023'; end if;
  if (not p_ok and v_note is null) or char_length(coalesce(v_note, '')) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  update public.hr_tasks set status = case when p_ok then 'خلصت' else 'جاري' end,
      done_at = case when p_ok then now() end,
      review_note = case when p_ok then null else v_note end,
      day = greatest(v.day, public.hr_today()),
      updated_by = auth.uid(), updated_at = now()
    where id = p_id;
  return case when p_ok then 'خلصت' else 'جاري' end;
end $$;

revoke execute on function public.hr_task_writer(uuid), public.hr_task_people(), public.hr_task_add(uuid, text),
  public.hr_task_set(bigint, text, jsonb), public.hr_task_delete(bigint), public.hr_task_review(bigint, boolean, text) from public, anon;
grant execute on function public.hr_task_writer(uuid), public.hr_task_people(), public.hr_task_add(uuid, text),
  public.hr_task_set(bigint, text, jsonb), public.hr_task_delete(bigint), public.hr_task_review(bigint, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------- live line: private broadcast «hr» / «tasks», { at } only

create or replace function public.hr_tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    begin
      execute 'select realtime.send($1, $2, $3, $4)' using jsonb_build_object('at', now()), 'tasks', 'hr', true;
    exception when others then null;
    end;
  end if;
  return null;
end $$;
revoke execute on function public.hr_tasks_notify() from public, anon, authenticated;
drop trigger if exists hr_tasks_notify on public.hr_tasks;
create trigger hr_tasks_notify after insert or update or delete on public.hr_tasks for each statement execute function public.hr_tasks_notify();
