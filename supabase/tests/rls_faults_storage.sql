-- Tests for 0173 («الأعطال» / «مساحة التخزين» — Safwat 28 Nov): storage_usage() is the server's only (a member and anon are refused)
-- and returns the database's and the files' bytes; the default rules (when the sections exist) sit under «السيستم» for the admin and the
-- developer. Depends on 0001 … 0173. One transaction, rolled back; NOTICE 'rls_faults_storage: ok' only if every case passed.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000173a01', 'fs-ops.dev@ibtekr.local', '0100173a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-000000173a01', 'عمليات الأعطال', 'fs-ops.dev@ibtekr.local', '0100173a01', 'ops', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000173a01","role":"authenticated"}';
do $$ begin
  begin perform public.storage_usage(); raise exception 'case a member reads the space failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$
declare u jsonb := public.storage_usage();
begin
  if (u->>'db_bytes')::bigint <= 0 then raise exception 'case the database size failed: %', u; end if;
  if (u->>'files_bytes') is null or (u->>'files') is null then raise exception 'case the files total failed: %', u; end if;
end $$;
reset role;

do $$
declare r record;
begin
  -- a database with the sections (the live one): the two rules under «السيستم», the admin's and the developer's teams
  if exists (select 1 from public.notif_sections) then
    for r in select n.element, n.state, n.roles, n.show, n.param, p.name as main from public.notif_rules n
      join public.notif_sections s on s.id = n.section_id join public.notif_sections p on p.id = s.parent_id where n.element in ('faults', 'storage') loop
      if r.main <> 'السيستم' then raise exception 'case the rule sits under السيستم failed: %', r.main; end if;
      if not ('admin' = any (r.roles)) then raise exception 'case the admin receives it failed'; end if;
      if exists (select 1 from public.roles where id = 'developer') and not ('developer' = any (r.roles)) then raise exception 'case the developer receives it failed'; end if;
      if r.element = 'faults' and (r.show, r.state) is distinct from ('fixed', 'found') then raise exception 'case the fault is an event shown 72h failed'; end if;
      if r.element = 'storage' and (r.show, r.param) is distinct from ('until_state', 80::numeric) then raise exception 'case the space at 80%% till it is under failed'; end if;
    end loop;
  end if;
  raise notice 'rls_faults_storage: ok';
end $$;

rollback;
