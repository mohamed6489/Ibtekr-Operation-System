-- 0067_member_delete_guard — phase 13 decision 15, security review of 0066: two more refusals in member_delete.
-- * The owner (member_code M01) is never deleted, by anyone → 22023 «owner».
-- * HR and other history that cascades from profiles (attendance, overtime, requests, adjustments, extras, scores, meetings,
--   documents, tasks, …) counts as a trace too → 23503 «has_records» with the table; only a short allowlist of truly personal
--   setup rows (hr_members, hr_pay, hr_kpis, user_prefs, alert_reads, notification_prefs, the OAuth states and the image queues)
--   is allowed to go with the member. So a member with a document in hr-docs is refused — no orphan files.

create or replace function public.member_delete(p_member uuid, p_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text; v_role text; v_status text; v_code text; v_fk record; v_found boolean;
  v_personal constant text[] := array['hr_members', 'hr_pay', 'hr_kpis', 'user_prefs', 'alert_reads', 'notification_prefs', 'image_imports', 'image_shares', 'magnific_oauth_states', 'cs_oauth_states'];
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  select name, role_id, status, member_code into v_name, v_role, v_status, v_code from public.profiles where id = p_member for update;
  if v_name is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if p_actor is not null and p_actor = p_member then raise exception 'own account' using errcode = '22023'; end if;
  if v_code = 'M01' then raise exception 'owner' using errcode = '22023'; end if;
  if v_role = 'admin' and v_status = 'active' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last_admin' using errcode = '22023';
  end if;
  -- any trace: a row in a table whose key to profiles does not cascade, or one that cascades but is not personal setup
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
      and not (c.confdeltype = 'c' and replace(c.conrelid::regclass::text, 'public.', '') = any (v_personal))
    order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col) into v_found using p_member;
    if v_found then
      raise exception 'has_records' using errcode = '23503', hint = replace(v_fk.tbl::text, 'public.', '');
    end if;
  end loop;
  delete from auth.users where id = p_member; -- profiles and the personal setup rows cascade
  insert into public.activity_log (at, actor, action, entity, entity_id, new_value) values (now(), p_actor, 'hr.member.delete', 'profile', p_member::text, to_jsonb(v_name));
  return jsonb_build_object('ok', true, 'id', p_member, 'name', v_name);
end
$$;
revoke execute on function public.member_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_delete(uuid, uuid) to service_role;
