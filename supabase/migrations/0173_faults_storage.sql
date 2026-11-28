-- 0173 — «الأعطال» and «مساحة التخزين» in the notifications (Safwat 28 Nov: «ضيف في تنبيهات السيستم … الاعطال … وجود عطل … حتي لو
-- اتحل … و كمان ضيف عنصر مساحة التخزين و وضع التخزين امتلأ … بالمساحة اللي محطوط عليها السيستم»; his answers: the Free plan, each
-- its own element, to the admin, the developer and the management).
-- * storage_usage(): the project's database size and its uploaded files' total — the system lives on Supabase (Hostinger serves the
--   page's own files only, which do not grow). service_role only (the notify engine); bytes only, no names.
-- * the default rules, once each, under «السيستم»: «وجود عطل» (an event, shown 72 hours) and «التخزين امتلأ» at 80% (a state, till it
--   is under) for the admin's and the developer's teams. The limits are the Free plan's unless settings «system».storage says otherwise.
-- Re-runnable.

create or replace function public.storage_usage()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_files bigint := 0; v_n bigint := 0;
begin
  -- a database without Supabase Storage (the tests' local one): the files count as none
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum((metadata->>'size')::bigint), 0), count(*) from storage.objects$q$ into v_files, v_n;
  end if;
  return jsonb_build_object('db_bytes', pg_database_size(current_database()), 'files_bytes', v_files, 'files', v_n);
end
$$;
revoke execute on function public.storage_usage() from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;

create or replace function pg_temp.sec(p_main text, p_sub text) returns uuid language plpgsql as $$
declare m uuid; s uuid;
begin
  select id into m from public.notif_sections where parent_id is null and name = p_main;
  if m is null then insert into public.notif_sections (name, icon, sort) values (p_main, 'gear', coalesce((select max(sort) + 1 from public.notif_sections where parent_id is null), 0)) returning id into m; end if;
  select id into s from public.notif_sections where parent_id = m and name = p_sub;
  if s is null then insert into public.notif_sections (parent_id, name, sort) values (m, p_sub, coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m), 0)) returning id into s; end if;
  return s;
end $$;

create or replace function pg_temp.rule(p_sub text, p_name text, p_el text, p_type text, p_state text, p_show text, p_hours int, p_at text, p_param numeric) returns void language plpgsql as $$
declare v_sec uuid;
begin
  if exists (select 1 from public.notif_rules where element = p_el and type = p_type and state = p_state) then return; end if;
  v_sec := pg_temp.sec('السيستم', p_sub);
  insert into public.notif_rules (section_id, name, element, type, state, param, at, repeat, show, hours, roles, sort, created_by)
  values (v_sec, p_name, p_el, p_type, p_state, p_param, p_at, '24h', p_show, p_hours,
    array(select r from unnest(array['admin', 'developer']) r where exists (select 1 from public.roles x where x.id = r)),
    coalesce((select max(sort) + 1 from public.notif_rules where section_id = v_sec), 0), null);
end $$;

do $$
begin
  -- the sections are the admin's: a fresh database without them gets nothing here (as in 0161)
  if not exists (select 1 from public.notif_sections) then return; end if;
  perform pg_temp.rule('الأعطال', 'وجود عطل', 'faults', 'fault', 'found', 'fixed', 72, '00:00', null);
  perform pg_temp.rule('مساحة التخزين', 'التخزين امتلأ', 'storage', 'space', 'full', 'until_state', 0, '09:00', 80);
end $$;
