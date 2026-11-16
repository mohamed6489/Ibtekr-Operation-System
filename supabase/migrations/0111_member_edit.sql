-- 0111_member_edit — the owner 16 Nov: «عايز امكانية للمدير المباشر او الادمن يقدر يعدل اي بيانات لاي فرد في الفريق و الصلاحيات»,
-- and his two answers: «المرتب للأدمن بس» and «لحد صلاحياته هو بس».
--
-- Who edits a member: the admin (any member) or the member's direct manager (profiles.manager_id = me) — never one's own row (one's
-- own data stays «ملفي › تعديل بياناتي») and never an admin's row unless the caller is an admin (member_can_edit).
--   * the data: the name, the mobile and the job title (member_info_set — the email goes through team-admin member_email, an Auth
--     change); the shift, the hire date and the yearly leave days (member_job_set — hr.edit F keeps its own path on hr_members);
--   * the access: the main role, the extra roles, the level, the custom permissions and the status (member_role_set /
--     member_roles_set / member_level_set / member_perms_set / member_status_set now let the direct manager in) — a manager gives
--     nothing above his own: every permission the change would hand over is checked against the manager's own (perms_within_mine),
--     and a manager never makes anyone «أدمن».
--   * the pay stays sensitive.salaries (the admin) — hr_pay is untouched here.
-- Every write is logged (hr.member.info / hr.member.job with field names only; the settings.member.* actions as before) and the
-- permission writes keep their alert for the admins. Re-runnable; no data dropped.

-- ---------------------------------------------------------------- who may edit whom
create or replace function public.member_can_edit(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and p_member is not null and p_member <> auth.uid()
     and exists (select 1 from public.profiles p where p.id = p_member
                  and (public.is_admin() or (p.manager_id = auth.uid() and p.role_id <> 'admin')))
$$;
revoke execute on function public.member_can_edit(uuid) from public, anon;
grant execute on function public.member_can_edit(uuid) to authenticated, service_role;

-- a permission's weight: F 2 · P 1 · anything else 0
create or replace function public.perm_rank(p_value text) returns int
language sql immutable set search_path = public as $$
  select case p_value when 'F' then 2 when 'P' then 1 else 0 end
$$;
revoke execute on function public.perm_rank(text) from public, anon;
grant execute on function public.perm_rank(text) to authenticated, service_role;

-- every permission in the set is at most what the caller has himself (the admin: always)
create or replace function public.perms_within_mine(p_perms jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    p_perms is not null and jsonb_typeof(p_perms) = 'object'
    and not exists (select 1 from jsonb_each_text(p_perms) e
                     where public.perm_rank(e.value) > public.perm_rank(public.member_perm(auth.uid(), e.key))))
$$;
revoke execute on function public.perms_within_mine(jsonb) from public, anon;
grant execute on function public.perms_within_mine(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the data
-- the name (2–80), the mobile (an Egyptian mobile, unique — 23505 «taken»), the job title (up to 80, may be empty); null = unchanged
create or replace function public.member_info_set(p_member uuid, p_name text, p_phone text, p_title text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old public.profiles%rowtype; v_name text; v_phone text; v_title text; v_changed text[] := '{}';
begin
  if not public.member_can_edit(p_member) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_old from public.profiles where id = p_member for update;
  if not found then raise exception 'no such member' using errcode = 'P0002'; end if;
  v_name := case when p_name is null then v_old.name else regexp_replace(btrim(p_name), '\s+', ' ', 'g') end;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name ~ '[<>]' then raise exception 'invalid: name' using errcode = '22023'; end if;
  v_phone := case when p_phone is null then v_old.phone else translate(btrim(p_phone), '٠١٢٣٤٥٦٧٨٩', '0123456789') end;
  if v_phone is distinct from v_old.phone and (v_phone is null or v_phone !~ '^01[0-9]{9}$') then raise exception 'invalid: phone' using errcode = '22023'; end if;
  v_title := case when p_title is null then v_old.title else nullif(regexp_replace(btrim(p_title), '\s+', ' ', 'g'), '') end;
  if v_title is not null and (char_length(v_title) > 80 or v_title ~ '[<>]') then raise exception 'invalid: title' using errcode = '22023'; end if;
  if v_phone is distinct from v_old.phone and exists (select 1 from public.profiles where phone = v_phone and id <> p_member) then
    raise exception 'taken: phone' using errcode = '23505';
  end if;
  if v_name is distinct from v_old.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_phone is distinct from v_old.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if v_title is distinct from v_old.title then v_changed := array_append(v_changed, 'title'); end if;
  if cardinality(v_changed) = 0 then return jsonb_build_object('changed', '[]'::jsonb); end if;
  update public.profiles set name = v_name, phone = v_phone, title = v_title where id = p_member;
  perform public.log_activity('hr.member.info', 'profile', p_member::text, null, to_jsonb(v_changed));
  return jsonb_build_object('changed', to_jsonb(v_changed));
end
$$;
revoke execute on function public.member_info_set(uuid, text, text, text) from public, anon;
grant execute on function public.member_info_set(uuid, text, text, text) to authenticated, service_role;

-- the shift (HH:MM), the hire date, the yearly leave days (0–60); null = unchanged. The admin, hr.edit F (not on oneself) or the
-- direct manager.
create or replace function public.member_job_set(p_member uuid, p_shift_start text, p_shift_end text, p_hire date, p_leave numeric) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if not (public.member_can_edit(p_member) or (public.hr_editor() and p_member <> auth.uid())) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'no such member' using errcode = 'P0002'; end if;
  if (p_shift_start is not null and p_shift_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'invalid: shift_start' using errcode = '22023'; end if;
  if (p_shift_end is not null and p_shift_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'invalid: shift_end' using errcode = '22023'; end if;
  if p_leave is not null and (p_leave < 0 or p_leave > 60) then raise exception 'invalid: leave' using errcode = '22023'; end if;
  if p_hire is not null and p_hire > (now() at time zone 'Africa/Cairo')::date + 366 then raise exception 'invalid: hire' using errcode = '22023'; end if;
  insert into public.hr_members (member_id) values (p_member) on conflict (member_id) do nothing;
  update public.hr_members set
    shift_start = coalesce(p_shift_start::time, shift_start),
    shift_end = coalesce(p_shift_end::time, shift_end),
    hire_date = coalesce(p_hire, hire_date),
    leave_days = coalesce(p_leave, leave_days)
  where member_id = p_member;
  if p_shift_start is not null or p_shift_end is not null then v_changed := array_append(v_changed, 'shift'); end if;
  if p_hire is not null then v_changed := array_append(v_changed, 'hire'); end if;
  if p_leave is not null then v_changed := array_append(v_changed, 'leave'); end if;
  perform public.log_activity('hr.member.job', 'profile', p_member::text, null, to_jsonb(v_changed));
end
$$;
revoke execute on function public.member_job_set(uuid, text, text, date, numeric) from public, anon;
grant execute on function public.member_job_set(uuid, text, text, date, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------- the access (the admin, or the direct manager up to his own)
create or replace function public.member_perms_set(p_member uuid, p_perms jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_role text;
begin
  if not (public.is_admin() or public.member_can_edit(p_member)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.perms_ok(p_perms) then raise exception 'invalid: perms' using errcode = '22023'; end if;
  if not public.perms_within_mine(p_perms) then raise exception 'invalid: above' using errcode = '22023'; end if;
  select role_id into v_role from public.profiles where id = p_member for update;
  if v_role is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  update public.profiles set custom_perms = p_perms where id = p_member;
  perform public.log_activity('settings.member.perms', 'profile', p_member::text, null, to_jsonb((select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_perms) k)));
  perform public.perm_change_alert('اتغيّرت الصلاحيات المخصصة لعضو (' || (select count(*) from jsonb_object_keys(p_perms)) || ')', p_member::text);
end
$$;
revoke execute on function public.member_perms_set(uuid, jsonb) from public, anon;
grant execute on function public.member_perms_set(uuid, jsonb) to authenticated, service_role;

create or replace function public.member_level_set(p_member uuid, p_level text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text; v_role text;
begin
  if not (public.is_admin() or public.member_can_edit(p_member)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_level is null or p_level not in ('manager', 'employee', 'viewer') then raise exception 'invalid: level' using errcode = '22023'; end if;
  select level, role_id into v_old, v_role from public.profiles where id = p_member for update;
  if v_role is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  if v_old = p_level then return; end if;
  if not public.perms_within_mine((select public.role_level_perms(r, p_level) from public.roles r where r.id = v_role)) then
    raise exception 'invalid: above' using errcode = '22023';
  end if;
  update public.profiles set level = p_level where id = p_member;
  perform public.log_activity('settings.member.level', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_level));
  perform public.perm_change_alert('اتغيّر مستوى عضو في دوره', p_member::text);
end
$$;
revoke execute on function public.member_level_set(uuid, text) from public, anon;
grant execute on function public.member_level_set(uuid, text) to authenticated, service_role;

create or replace function public.member_role_set(p_member uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text;
begin
  if not (public.is_admin() or public.member_can_edit(p_member)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.roles where id = p_role and not hidden) then raise exception 'invalid: role' using errcode = '22023'; end if;
  if not public.is_admin() then
    -- a manager never makes anyone an admin, and the new role (at «موظف», where a new role starts) is within his own permissions
    if p_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
    if not public.perms_within_mine((select r.permissions from public.roles r where r.id = p_role)) then raise exception 'invalid: above' using errcode = '22023'; end if;
  end if;
  select role_id into v_old from public.profiles where id = p_member for update;
  if v_old is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_old = p_role then return; end if;
  if v_old = 'admin' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  -- the new main role leaves the extras; an admin has none
  update public.profiles set role_id = p_role,
         extra_roles = case when p_role = 'admin' then '{}'::text[] else array_remove(extra_roles, p_role) end
   where id = p_member;
  perform public.log_activity('settings.member.role', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_role));
  perform public.perm_change_alert('اتغيّر دور عضو: ' || v_old || ' ← ' || p_role, p_member::text);
end
$$;
revoke execute on function public.member_role_set(uuid, text) from public, anon;
grant execute on function public.member_role_set(uuid, text) to authenticated, service_role;

create or replace function public.member_roles_set(p_member uuid, p_roles text[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_main text; v_old text[]; v_new text[];
begin
  if not (public.is_admin() or public.member_can_edit(p_member)) then raise exception 'not allowed' using errcode = '42501'; end if;
  select role_id, extra_roles into v_main, v_old from public.profiles where id = p_member for update;
  if not found then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_main = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  v_new := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_roles, '{}'::text[])) x where x is not null and btrim(x) <> ''), '{}'::text[]);
  if v_new is not distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(v_old) x) then return; end if;
  -- an extra role works at «موظف» (0096): each new one within the manager's own permissions
  if not public.is_admin() and exists (select 1 from public.roles r where r.id = any (v_new) and not (r.id = any (coalesce(v_old, '{}'::text[])))
                                        and not public.perms_within_mine(r.permissions)) then
    raise exception 'invalid: above' using errcode = '22023';
  end if;
  update public.profiles set extra_roles = v_new where id = p_member; -- the guard checks every role
  perform public.log_activity('settings.member.roles', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(v_new));
  perform public.perm_change_alert('اتغيّرت الأدوار الإضافية لعضو (' || cardinality(v_new) || ')', p_member::text);
end
$$;
revoke execute on function public.member_roles_set(uuid, text[]) from public, anon;
grant execute on function public.member_roles_set(uuid, text[]) to authenticated, service_role;

create or replace function public.member_status_set(p_member uuid, p_status text, p_reason text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old record;
begin
  if not (public.is_admin() or public.member_can_edit(p_member)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'invalid: status' using errcode = '22023'; end if;
  if p_member = auth.uid() then raise exception 'invalid: self' using errcode = '22023'; end if;
  select status, role_id, name into v_old from public.profiles where id = p_member for update;
  if v_old.status is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_old.status = p_status then return; end if;
  if p_status = 'suspended' and coalesce(btrim(p_reason), '') = '' then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if p_status = 'suspended' and v_old.role_id = 'admin' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last admin' using errcode = '22023';
  end if;
  update public.profiles set status = p_status where id = p_member;
  if p_status = 'suspended' then delete from auth.sessions s where s.user_id = p_member; end if;
  perform public.log_activity('settings.member.' || case when p_status = 'suspended' then 'suspend' else 'reactivate' end, 'profile', p_member::text,
    to_jsonb(v_old.status), jsonb_strip_nulls(jsonb_build_object('status', p_status, 'reason', nullif(left(btrim(coalesce(p_reason, '')), 300), ''))));
end
$$;
revoke execute on function public.member_status_set(uuid, text, text) from public, anon;
grant execute on function public.member_status_set(uuid, text, text) to authenticated, service_role;
