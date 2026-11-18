-- 0137 — «امسح كل حاجة» stopped at «طلبات الفريق» with «حصل خطأ في السيرفر» (the owner 18 Nov, screenshot): a request through the API
-- runs with pg_safeupdate, which refuses a DELETE (or UPDATE) without a WHERE clause even inside a function — «DELETE requires a WHERE
-- clause» in the logs. data_wipe (0133) deleted each table with `delete from <table>`, team_wipe (0136) the papers and the invites the
-- same way; now `where true`. Nothing was deleted by the failed run (the call is one transaction). As 0133 / 0136 otherwise. Re-runnable.
-- tests/tools/safeupdate.test.mjs keeps every function's latest definition off an unconditional DELETE / UPDATE.

create or replace function public.data_wipe(p_sections text[], p_confirm text default null, p_dry boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_known text[] := array(select distinct m.section from public.data_wipe_map() m);
  v_s text; v_n bigint; v_total bigint := 0; v_out jsonb := '[]'::jsonb; v_blocked text[] := '{}';
  v_chosen oid[]; v_left oid[]; v_rel oid; v_done boolean; v_owner text; r record;
begin
  if auth.uid() is null or not public.is_admin() or not public.caller_aal_ok() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_sections is null or cardinality(p_sections) = 0 then raise exception 'invalid: sections' using errcode = '22023'; end if;
  foreach v_s in array p_sections loop if not v_s = any (v_known) then raise exception 'invalid: section %', v_s using errcode = '22023'; end if; end loop;
  select coalesce(array_agg(to_regclass('public.' || m.tbl)::oid), '{}') into v_chosen from public.data_wipe_map() m where m.section = any (p_sections) and to_regclass('public.' || m.tbl) is not null;
  -- the chosen tables and their rows
  for r in select m.section, m.tbl, to_regclass('public.' || m.tbl) rel from public.data_wipe_map() m where m.section = any (p_sections) and to_regclass('public.' || m.tbl) is not null loop
    execute format('select count(*) from %s', r.rel) into v_n; v_total := v_total + v_n;
    v_out := v_out || jsonb_build_object('section', r.section, 'table', r.tbl, 'rows', v_n, 'kind', 'wipe');
  end loop;
  -- the tables outside the choice that point at it, by their key's rule (the first column of the key)
  for r in select c.conrelid::regclass rel, (select cl.relname from pg_class cl where cl.oid = c.conrelid) tname, c.confdeltype,
                  (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) col
             from pg_constraint c where c.contype = 'f' and c.confrelid = any (v_chosen) and not c.conrelid = any (v_chosen) loop
    execute format('select count(*) from %s where %I is not null', r.rel, r.col) into v_n;
    continue when v_n = 0;
    select m.section into v_owner from public.data_wipe_map() m where m.tbl = r.tname limit 1;
    if r.confdeltype in ('a', 'r') or (r.confdeltype = 'c' and v_owner is null) then v_blocked := v_blocked || r.tname; end if;
    v_out := v_out || jsonb_build_object('section', coalesce(v_owner, ''), 'table', r.tname, 'rows', v_n,
      'kind', case when r.confdeltype in ('a', 'r') or (r.confdeltype = 'c' and v_owner is null) then 'blocked' when r.confdeltype = 'c' then 'cascade' else 'unlink' end);
  end loop;
  if p_dry then return jsonb_build_object('dry', true, 'tables', v_out, 'rows', v_total, 'blocked', to_jsonb(v_blocked)); end if;
  if cardinality(v_blocked) > 0 then raise exception 'blocked: %', array_to_string(v_blocked, ', ') using errcode = '22023'; end if;
  if coalesce(btrim(p_confirm), '') <> 'حذف الداتا من السيستم بشكل نهائي' then raise exception 'invalid: confirm' using errcode = '22023'; end if;
  -- delete table by table; a table still pointed at by a chosen one that is not empty yet waits for the next pass
  v_left := v_chosen;
  loop
    exit when cardinality(v_left) = 0; v_done := false;
    foreach v_rel in array v_left loop
      begin execute format('delete from %s where true', v_rel::regclass); v_left := array_remove(v_left, v_rel); v_done := true;
      exception when foreign_key_violation then null; end;
    end loop;
    if not v_done then raise exception 'blocked: %', (select string_agg(x::regclass::text, ', ') from unnest(v_left) x) using errcode = '22023'; end if;
  end loop;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), 'settings.data.wipe', 'settings', null, jsonb_build_object('sections', to_jsonb(p_sections), 'rows', v_total));
  return jsonb_build_object('dry', false, 'tables', v_out, 'rows', v_total, 'blocked', '[]'::jsonb);
end
$$;
revoke execute on function public.data_wipe(text[], text, boolean) from public, anon;
grant execute on function public.data_wipe(text[], text, boolean) to authenticated, service_role;

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
  delete from public.hr_documents where true;
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
  delete from public.invites where true;
  insert into public.activity_log (actor, action, entity, entity_id, new_value)
    values (v_me, 'settings.team.wipe', 'settings', null, jsonb_build_object('members', cardinality(v_gone), 'roles', cardinality(v_roles)));
  return jsonb_build_object('dry', false, 'members', cardinality(v_gone), 'kept', cardinality(v_keep), 'roles', cardinality(v_roles), 'files', v_files);
end
$$;
revoke execute on function public.team_wipe(text, boolean) from public, anon;
grant execute on function public.team_wipe(text, boolean) to authenticated, service_role;
