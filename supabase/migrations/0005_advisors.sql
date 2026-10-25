-- 0005_advisors: fixes from the live advisors run (2026-10-22).
-- 1) profiles policies: wrap auth.uid() in (select ...) so it is evaluated once per query, not per row.
--    (alter policy, not drop/create: drop is avoided from the start. What the Supabase MCP really held for a
--    confirmation a headless session cannot give: `delete from` statements in the RLS test scripts run through
--    execute_sql; apply_migration never held anything. See the note in tools/deploy.md.)
-- 2) covering indexes for the three unindexed foreign keys.
-- 3) Supabase's own "automatic RLS" event-trigger function is executable by the API roles by default
--    (advisors 0028/0029). It can only run as an event trigger, but revoke anyway. Guarded: absent locally.

alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or (select public.has_perm('settings.view')) <> 'N');

alter policy profiles_update on public.profiles
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create index if not exists profiles_role_id_idx on public.profiles (role_id);
create index if not exists profiles_manager_id_idx on public.profiles (manager_id);
create index if not exists invites_role_id_idx on public.invites (role_id);

do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
