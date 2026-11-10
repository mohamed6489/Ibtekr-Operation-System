-- 0066_member_delete — phase 13 decision 15 (the owner, 10 Nov: «زودلي زرار لمسح الـ user نهائي»): a team member deleted for good, from
-- the Edge Function team-admin only (the admin's JWT checked there; never one's own account).
--
-- member_delete(p_member, p_actor): service_role only. Refuses a member who left any trace: a row in any table whose foreign key to
-- profiles is NOT «on delete cascade» (activity_log.actor, the orders / accounts / CS / inventory / tickets / marketing rows a member
-- wrote, the people they manage, …) → 23503 «has_records» with the table in the hint; the last active admin → 22023 «last_admin»;
-- an unknown member → P0002. A member with no trace is removed from auth.users (profiles and the member's own rows — hr_members,
-- hr_pay, user_prefs, alert_reads, … — follow by cascade) and one activity_log row hr.member.delete carries the name only.
-- So a member who ever signed in or did anything stays: «إيقاف» is the door for those.

create or replace function public.member_delete(p_member uuid, p_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text; v_role text; v_status text; v_fk record; v_found boolean;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  select name, role_id, status into v_name, v_role, v_status from public.profiles where id = p_member for update;
  if v_name is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if p_actor is not null and p_actor = p_member then raise exception 'own account' using errcode = '22023'; end if;
  if v_role = 'admin' and v_status = 'active' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last_admin' using errcode = '22023';
  end if;
  -- any trace in a table whose key to profiles does not cascade
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype <> 'c'
      and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
    order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col) into v_found using p_member;
    if v_found then
      raise exception 'has_records' using errcode = '23503', hint = replace(v_fk.tbl::text, 'public.', '');
    end if;
  end loop;
  delete from auth.users where id = p_member; -- profiles and the member's own rows cascade
  insert into public.activity_log (at, actor, action, entity, entity_id, new_value) values (now(), p_actor, 'hr.member.delete', 'profile', p_member::text, to_jsonb(v_name));
  return jsonb_build_object('ok', true, 'id', p_member, 'name', v_name);
end
$$;
revoke execute on function public.member_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_delete(uuid, uuid) to service_role;
