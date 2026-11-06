-- 0050: the live Security Advisor's findings stay closed — every view in public runs with its reader's rights (security_invoker),
-- no security definer function in public is callable by anon but the login lookup (email_for_identifier, 0001), and every function
-- in public sets its search_path. Catalog checks and an anonymous read only — live-safe; run inside a transaction and rolled back.
-- (The requests' rows and the masked advance through hr_requests_v are rls_hr's.)
begin;
do $$
declare v text;
begin
  if not exists (select 1 from pg_class c where c.oid = 'public.hr_requests_v'::regclass
                 and ('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions))) then
    raise exception 'case hr_requests_v runs with the reader''s rights failed';
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false);
  if v is not null then raise exception 'case every view in public is security_invoker failed: %', v; end if;
  select string_agg(p.proname, ', ' order by p.proname) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'email_for_identifier'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v is not null then raise exception 'case anon executes no security definer function but the login lookup failed: %', v; end if;
  select string_agg(p.proname, ', ' order by p.proname) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v is not null then raise exception 'case every function in public sets its search_path failed: %', v; end if;
  if not has_function_privilege('authenticated', 'public.hr_requests_list()', 'execute')
     or not has_function_privilege('authenticated', 'public.hr_clock_in()', 'execute')
     or not has_table_privilege('authenticated', 'public.hr_requests_v', 'select') then
    raise exception 'case the members keep the HR requests and the clock failed';
  end if;
  if has_table_privilege('authenticated', 'public.hr_requests', 'select') then
    raise exception 'case the requests table stays closed to the members failed';
  end if;
end $$;
-- a caller who is not signed in reads no HR request and calls no HR RPC
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin perform 1 from public.hr_requests_v; raise exception 'case anon reads no HR request failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_requests_list(); raise exception 'case anon calls no hr_requests_list failed';
  exception when insufficient_privilege then null; end;
  begin perform public.hr_clock_in(); raise exception 'case anon calls no hr_clock_in failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin raise notice 'rls_security_advisor: ok'; end $$;
rollback;
