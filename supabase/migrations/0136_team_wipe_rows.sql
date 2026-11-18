-- 0136 — team_wipe (0134 / 0135) on the live data: hr_documents' guard keeps created_by / voided_by (stamped rows), so emptying them is
-- refused. A column its table will not let go of now takes the row instead (and only a row that will not go either blocks); and the
-- members' papers (hr_documents) all go with the team — their files are in hr-docs, which «الملفات المرفوعة» empties. As 0135
-- otherwise. Re-runnable.

create or replace function public.team_wipe(p_confirm text default null, p_dry boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_keep uuid[]; v_gone uuid[]; v_roles text[]; v_names text[]; v_admin text; v_files bigint; r record; v_blocked text[] := '{}';
begin
  if v_me is null or not public.is_admin() or not public.caller_aal_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  select array_agg(id) into v_keep from public.profiles where id = v_me or member_code = 'M01';
  select coalesce(array_agg(id), '{}') into v_gone from public.profiles where not id = any (v_keep);
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(name), '{}') into v_roles, v_names from public.roles where not coalesce(is_system, false);
  v_files := public.wipe_files_count();
  if p_dry then
    return jsonb_build_object('dry', true, 'members', cardinality(v_gone), 'kept', cardinality(v_keep), 'roles', cardinality(v_roles), 'files', v_files);
  end if;
  if coalesce(btrim(p_confirm), '') <> 'حذف الداتا من السيستم بشكل نهائي' then raise exception 'invalid: confirm' using errcode = '22023'; end if;
  -- what still points at a leaving member: empty the column when it may be, else the row goes (cascading keys go with the profile)
  -- the members' papers (0046 hr_documents): their files go with «الملفات المرفوعة» (hr-docs), so their rows go too — the kept ones' as well
  delete from public.hr_documents;
  if cardinality(v_gone) > 0 then
    for r in select c.conrelid::regclass rel, a.attname col, a.attnotnull nn
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype <> 'c' and cardinality(c.conkey) = 1 loop
      begin
        if r.nn then execute format('delete from %s where %I = any ($1)', r.rel, r.col) using v_gone;
        else execute format('update %s set %I = null where %I = any ($1)', r.rel, r.col, r.col) using v_gone; end if;
      exception when others then
        -- the table's rule keeps the column (stamped rows): the rows go instead, else the table blocks
        begin execute format('delete from %s where %I = any ($1)', r.rel, r.col) using v_gone;
        exception when others then v_blocked := array_append(v_blocked, replace(r.rel::text, 'public.', ''));
        end;
      end;
    end loop;
    -- a row its table's own rule keeps (a locked payroll sheet …) = the data is not wiped yet: nothing goes, the run says which
    if cardinality(v_blocked) > 0 then raise exception 'blocked: %', array_to_string(v_blocked, ', ') using errcode = '22023'; end if;
    delete from auth.users where id = any (v_gone);
  end if;
  -- the added roles: off the kept members (a kept member on one moves to «مشاهد»), their rules to the admin team, then gone
  if cardinality(v_roles) > 0 then
    update public.profiles set extra_roles = (select coalesce(array_agg(x), '{}') from unnest(extra_roles) x where not x = any (v_roles))
     where extra_roles && v_roles;
    update public.profiles set role_id = 'viewer' where role_id = any (v_roles);
    select name into v_admin from public.roles where id = 'admin';
    update public.cs_auto_rules set role_id = 'admin' where role_id = any (v_roles);
    delete from public.alerts where role_id = any (v_roles);
    update public.ai_agents set role = v_admin where role = any (v_names);
    update public.tickets set assignee_role = v_admin where assignee_role = any (v_names);
    delete from public.invites where role_id = any (v_roles);
    delete from public.roles where id = any (v_roles);
  end if;
  delete from public.invites;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (v_me, 'settings.team.wipe', 'settings', null, jsonb_build_object('members', cardinality(v_gone), 'roles', cardinality(v_roles)));
  return jsonb_build_object('dry', false, 'members', cardinality(v_gone), 'kept', cardinality(v_keep), 'roles', cardinality(v_roles), 'files', v_files);
end
$$;
revoke execute on function public.team_wipe(text, boolean) from public, anon;
grant execute on function public.team_wipe(text, boolean) to authenticated, service_role;
