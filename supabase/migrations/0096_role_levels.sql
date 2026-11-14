-- 0096 — owner batch 2 decisions 2 and 4 (docs/superpowers/plans/2026-11-14-owner-batch-2.md): a role has three permission groups —
-- مدير / موظف / مشاهد — and a member has a role and a level.
-- * roles.permissions stays the «موظف» group (every existing rule, RPC and reader keeps working); roles.level_perms holds the
--   «manager» and «viewer» groups ({ manager: {...}, viewer: {...} }); a level with no group of its own = the «موظف» group (so a role
--   starts with the same permissions on its three levels — «أول تطبيق: صلاحيات كل دور الحالية بتتنسخ للتلات مستويات»).
-- * profiles.level: manager | employee (default) | viewer. Changed by the admin only (member_level_set) — it changes what a member
--   may do; profiles_guard_update (0001) already refuses any column but name / phone to a non-admin.
-- * has_perm: the main role with the member's level group, the extra roles with their «موظف» group (the owner's answer), custom_perms
--   over everything and the admin F, as before.
-- * The current role managers (roles.manager_id, 0092) are «مدير» on their role.

-- ---------------------------------------------------------------- the columns
alter table public.roles add column if not exists level_perms jsonb not null default '{}'::jsonb;
alter table public.roles drop constraint if exists roles_level_perms_check;
alter table public.roles add constraint roles_level_perms_check check (jsonb_typeof(level_perms) = 'object' and not (level_perms ? 'employee'));
alter table public.profiles add column if not exists level text not null default 'employee';
alter table public.profiles drop constraint if exists profiles_level_check;
alter table public.profiles add constraint profiles_level_check check (level in ('manager', 'employee', 'viewer'));

update public.profiles p set level = 'manager'
 where p.role_id <> 'admin' and p.level = 'employee'
   and exists (select 1 from public.roles r where r.manager_id = p.id and r.id = p.role_id);

-- the permission group of a role at a level (the «موظف» group when the level has none of its own)
create or replace function public.role_level_perms(p_role public.roles, p_level text) returns jsonb
language sql stable set search_path = public as $$
  select case when p_level in ('manager', 'viewer') and jsonb_typeof(p_role.level_perms -> p_level) = 'object'
              then p_role.level_perms -> p_level else p_role.permissions end
$$;
revoke execute on function public.role_level_perms(public.roles, text) from public, anon;
grant execute on function public.role_level_perms(public.roles, text) to authenticated, service_role;

-- ---------------------------------------------------------------- has_perm with the level
create or replace function public.has_perm(key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when (coalesce(p.twofa, false) or public.force2fa_on()) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else (select case max(case (case when r.id = p.role_id then public.role_level_perms(r, p.level) else r.permissions end) ->> key
                                 when 'F' then 2 when 'P' then 1 else 0 end) when 2 then 'F' when 1 then 'P' else 'N' end
              from public.roles r
             where r.id = p.role_id or (r.id = any (coalesce(p.extra_roles, '{}'::text[])) and not r.hidden and r.id <> 'admin'))
    end
    from public.profiles p
    where p.id = auth.uid()
  ), 'N')
$$;

-- security review: the permission of ANOTHER member (the same rule as has_perm, without the session's 2FA check) — for the server
-- code that picks who gets an alert (hr_overtime_request below read roles.permissions directly and missed the level). Server only.
create or replace function public.member_perm(p_member uuid, key text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.status <> 'active' then 'N'
      when p.role_id = 'admin' then 'F'
      when p.custom_perms ? key then p.custom_perms ->> key
      else (select case max(case (case when r.id = p.role_id then public.role_level_perms(r, p.level) else r.permissions end) ->> key
                                 when 'F' then 2 when 'P' then 1 else 0 end) when 2 then 'F' when 1 then 'P' else 'N' end
              from public.roles r
             where r.id = p.role_id or (r.id = any (coalesce(p.extra_roles, '{}'::text[])) and not r.hidden and r.id <> 'admin'))
    end
    from public.profiles p
    where p.id = p_member
  ), 'N')
$$;
revoke execute on function public.member_perm(uuid, text) from public, anon, authenticated;
grant execute on function public.member_perm(uuid, text) to service_role;

-- security review: a level belongs to the main role it was given on — a new main role starts at «موظف» (an admin sets it again)
create or replace function public.profiles_level_on_role() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role_id is distinct from old.role_id and new.level is not distinct from old.level then new.level := 'employee'; end if;
  return new;
end $$;
revoke execute on function public.profiles_level_on_role() from public, anon;
drop trigger if exists profiles_level_on_role on public.profiles;
create trigger profiles_level_on_role before update of role_id on public.profiles for each row execute function public.profiles_level_on_role();

-- ---------------------------------------------------------------- the writes (the admin only)
-- a role's permissions at a level — employee = roles.permissions (role_perms_set), manager / viewer = roles.level_perms
create or replace function public.role_level_perms_set(p_role text, p_level text, p_perms jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old jsonb; v_changed text[]; v_name text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_level = 'employee' then perform public.role_perms_set(p_role, p_perms); return; end if;
  if p_level is null or p_level not in ('manager', 'viewer') then raise exception 'invalid: level' using errcode = '22023'; end if;
  if p_role = 'admin' then raise exception 'the admin role has every permission' using errcode = '22023'; end if;
  if not public.perms_ok(p_perms) then raise exception 'invalid: perms' using errcode = '22023'; end if;
  select public.role_level_perms(r, p_level), r.name into v_old, v_name from public.roles r where r.id = p_role for update;
  if v_name is null then raise exception 'no such role' using errcode = 'P0002'; end if;
  select coalesce(array_agg(k order by k), '{}') into v_changed
    from (select e.key as k from jsonb_each_text(p_perms) e where coalesce(v_old ->> e.key, 'N') is distinct from e.value
          union select e.key from jsonb_each_text(v_old) e where not (p_perms ? e.key) and e.value <> 'N') c;
  update public.roles set level_perms = jsonb_set(level_perms, array[p_level], p_perms, true) where id = p_role;
  perform public.log_activity('settings.role.perms', 'role', p_role, to_jsonb(v_changed), jsonb_build_object('level', p_level));
  if coalesce(array_length(v_changed, 1), 0) > 0 then
    perform public.perm_change_alert('اتغيّرت صلاحيات «' || case p_level when 'manager' then 'المدير' else 'المشاهد' end || '» في دور «' || v_name || '» (' || array_length(v_changed, 1) || ')', p_role);
  end if;
end
$$;
revoke execute on function public.role_level_perms_set(text, text, jsonb) from public, anon;
grant execute on function public.role_level_perms_set(text, text, jsonb) to authenticated, service_role;

-- a member's level on his main role
create or replace function public.member_level_set(p_member uuid, p_level text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text; v_role text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_level is null or p_level not in ('manager', 'employee', 'viewer') then raise exception 'invalid: level' using errcode = '22023'; end if;
  select level, role_id into v_old, v_role from public.profiles where id = p_member for update;
  if v_role is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'invalid: admin' using errcode = '22023'; end if;
  if v_old = p_level then return; end if;
  update public.profiles set level = p_level where id = p_member;
  perform public.log_activity('settings.member.level', 'profile', p_member::text, to_jsonb(v_old), to_jsonb(p_level));
  perform public.perm_change_alert('اتغيّر مستوى عضو في دوره', p_member::text);
end
$$;
revoke execute on function public.member_level_set(uuid, text) from public, anon;
grant execute on function public.member_level_set(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- security review: hr_overtime_request (0074) picks the approvers by
-- member_perm (the level and the extra roles count), not roles.permissions. The body is 0074's with 0083's event text; only the
-- two permission lines change.
create or replace function public.hr_overtime_request(p_day date, p_from text, p_to text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_note, '')); v_from time; v_to time; v_start timestamptz; v_end timestamptz; v_min int;
  v_rest boolean; v_t bigint; v_id bigint; v_name text; v_mgr uuid;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day is null or p_day > public.hr_today() or p_day < public.hr_today() - 31 then raise exception 'invalid: day' using errcode = '22023'; end if;
  if coalesce(p_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid: from' using errcode = '22023'; end if;
  if coalesce(p_to, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid: to' using errcode = '22023'; end if;
  if char_length(v_note) not between 1 and 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  v_from := p_from::time; v_to := p_to::time;
  v_start := (p_day + v_from) at time zone 'Africa/Cairo'; v_end := (p_day + v_to) at time zone 'Africa/Cairo';
  v_min := floor(extract(epoch from (v_end - v_start)) / 60);
  if v_min < 15 or v_min > 720 then raise exception 'invalid: minutes' using errcode = '22023'; end if;
  if v_end > now() then raise exception 'invalid: to' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = auth.uid() for update; -- one request at a time per member (the overlap check below)
  -- security review: a refused row counts too (a refusal can be turned into «اتضاف» after its meeting — 0046), so the same time is never
  -- asked for twice
  if exists (select 1 from public.hr_overtime o where o.member_id = auth.uid()
             and tstzrange(o.start_at, o.end_at) && tstzrange(v_start, v_end)) then
    raise exception 'invalid: overlap' using errcode = '22023';
  end if;
  -- and never while a shift that covers that time is still open: its clock-out writes the overtime of that time itself (0069)
  if exists (select 1 from public.hr_attendance a where a.member_id = auth.uid() and a.out_at is null and a.in_at < v_end) then
    raise exception 'invalid: open_shift' using errcode = '22023';
  end if;
  v_rest := public.hr_rest_day(p_day);
  -- a rest day has one row a day (hr_overtime_rest_day_idx, any status): a second ask for it is the same overlap
  if v_rest and exists (select 1 from public.hr_overtime o where o.member_id = auth.uid() and o.day = p_day and o.kind = 'rest_day') then
    raise exception 'invalid: overlap' using errcode = '22023';
  end if;
  v_t := public.hr_ot_ticket(auth.uid(), p_day, v_rest);
  update public.alerts set title = replace(replace(title, ' بدأ وقت إضافي', ' طلب وقت إضافي'), ' بيشتغل يوم راحة/عطلة', ' طلب يوم راحة/عطلة اشتغله')
  where entity_id = 'ot:' || v_t;
  insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note, ticket_id)
  values (auth.uid(), p_day, v_start, v_end, v_min, case when v_rest then 'rest_day' else 'hours' end, v_note, v_t)
  returning id into v_id;
  perform public.hr_ot_event(v_t, 'طلب وقت إضافي: ' || v_min || ' دقيقة — مستني الموافقة (التفاصيل في كارت الطلب هنا)');
  if not v_rest then
    select left(coalesce(nullif(btrim(p.name), ''), 'عضو'), 60), p.manager_id into v_name, v_mgr from public.profiles p where p.id = auth.uid();
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    select 'hr.overtime', v_name || ' طلب وقت إضافي', 'محتاج موافقة', p.id, 'hr-requests', 'ot:' || v_t
    from public.profiles p
    where p.status = 'active' and p.id <> auth.uid() and p.role_id is distinct from 'admin' and p.id is distinct from v_mgr
      and public.member_perm(p.id, 'hr.approve') = 'F'
      and public.member_perm(p.id, 'hr.view') = 'F';
  end if;
  return jsonb_build_object('id', v_id, 'ticket', v_t, 'minutes', v_min, 'rest_day', v_rest);
end $$;
revoke execute on function public.hr_overtime_request(date, text, text, text) from public, anon;
grant execute on function public.hr_overtime_request(date, text, text, text) to authenticated, service_role;
