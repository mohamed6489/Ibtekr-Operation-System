-- 0134 — «امسح كل حاجة» takes the team too (docs/superpowers/plans/2026-11-18-data-real.md decision 6 — the owner 18 Nov: «التصفير يبقي
-- فيه كل حاجة ف السيستم ك بيانات حتي الادوار و اعضاء الفريق ك ايميلات و بياناتهم و ملفاتهم انما الادوار الثابتة ف هيا زي ما هيا», and the
-- settings and integrations «تفضل زي ما هي»). Re-runnable.
--   team_wipe(p_confirm, p_dry) — the admin (aal2 when 2FA is forced), the same phrase as data_wipe: every member goes (auth.users → the
--     profile and the member's own rows cascade) except the admin running it and the owner M01; a column of another table that points at
--     a leaving member is emptied when it may be, else its row goes (notification_prefs, payroll lines, the marketing requests / video jobs
--     / competitors a member made, the HR notes they wrote); the roles the admin added (is_system false) go — the fixed teams stay, hidden
--     or not; invites go. The dry run counts the members, the added roles and the files. One activity_log row (counts only).
--   wipe_files_plan(p_limit) — service_role only: the next files of the data buckets (team-admin files_wipe removes them through the
--     Storage API — Supabase refuses a delete on storage.objects from SQL). The settings bucket (logos, fonts, loader) and company-docs stay,
--     and marketing/templates/ (the design templates stay with their rows).

create or replace function public.wipe_file_buckets() returns text[]
language sql immutable set search_path = public as $$
  select array['hr-docs', 'tickets', 'cs-media', 'studio', 'ai-images', 'marketing', 'vendor-photos', 'vendor-contracts']::text[]
$$;
revoke execute on function public.wipe_file_buckets() from public, anon;
grant execute on function public.wipe_file_buckets() to authenticated, service_role;

create or replace function public.wipe_files_count() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_n bigint := 0;
begin
  if to_regclass('storage.objects') is null then return 0; end if;
  execute 'select count(*) from storage.objects where bucket_id = any ($1) and not (bucket_id = ''marketing'' and name like ''templates/%'')'
    into v_n using public.wipe_file_buckets();
  return v_n;
end
$$;
revoke execute on function public.wipe_files_count() from public, anon, authenticated;
grant execute on function public.wipe_files_count() to service_role;

create or replace function public.wipe_files_plan(p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  if to_regclass('storage.objects') is null then return v_out; end if;
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''bucket'', o.bucket_id, ''name'', o.name)), ''[]''::jsonb) from (select bucket_id, name from storage.objects
             where bucket_id = any ($1) and not (bucket_id = ''marketing'' and name like ''templates/%'') order by bucket_id, name limit $2) o'
    into v_out using public.wipe_file_buckets(), greatest(1, least(coalesce(p_limit, 500), 1000));
  return v_out;
end
$$;
revoke execute on function public.wipe_files_plan(int) from public, anon, authenticated;
grant execute on function public.wipe_files_plan(int) to service_role;

create or replace function public.team_wipe(p_confirm text default null, p_dry boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_keep uuid[]; v_gone uuid[]; v_roles text[]; v_names text[]; v_admin text; v_files bigint; r record;
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
  if cardinality(v_gone) > 0 then
    for r in select c.conrelid::regclass rel, a.attname col, a.attnotnull nn
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.confdeltype <> 'c' and cardinality(c.conkey) = 1 loop
      if r.nn then execute format('delete from %s where %I = any ($1)', r.rel, r.col) using v_gone;
      else execute format('update %s set %I = null where %I = any ($1)', r.rel, r.col, r.col) using v_gone; end if;
    end loop;
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
