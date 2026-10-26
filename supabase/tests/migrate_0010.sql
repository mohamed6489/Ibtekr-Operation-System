-- Tests for the data statement of 0010_state_names on rows that predate it. Orders as the 2.1 sync wrote them
-- (customer_state null, the site's governorate code only in raw) are inserted, the migration file itself is applied
-- again with \ir, then once more to prove that a re-run changes nothing.
-- LOCAL ONLY (psql): \ir is a psql command, so this file does not run through the Supabase MCP's execute_sql; on the
-- live project 0010 is checked with the queries in tools/deploy.md §2.1. The schema side of 0010 (customer_state
-- grants and orders_v, woo_states RLS and grants) is in rls_orders.sql.
-- Runs in one transaction and rolls back; prints NOTICE 'migrate_0010: ok' only if every case passed.
-- As the runner (postgres, no auth.uid()): the trusted sync and the migrations both write this way.
-- No statement here removes rows or objects.

begin;
-- the re-runs print "column … already exists, skipping" / "relation … already exists, skipping"
set local client_min_messages = warning;
set local request.jwt.claims = '';

-- ---------------------------------------------------------------- the state before 0010

-- raw as woo-core's cleanRaw keeps it (billing / shipping cut to city / state / postcode / country); codes made up.
insert into public.orders (id, number, customer_name, status, placed_at, customer_state, raw) values
  (990201, '990201', 'عميلة تجربة 1', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"city":"","state":"EG-01"},"billing":{"city":"","state":"EG-02"}}'),
  (990202, '990202', 'عميلة تجربة 2', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"state":""},"billing":{"state":"EG-03"}}'),
  (990203, '990203', 'عميلة تجربة 3', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"billing":{"state":"EG-04","country":"EG"}}'),
  (990204, '990204', 'عميلة تجربة 4', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"state":" EG-05 "},"billing":{"state":"EG-06"}}'),
  (990205, '990205', 'عميلة تجربة 5', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"state":"  "},"billing":{"state":"EG-07"}}'),
  (990206, '990206', 'عميلة تجربة 6', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"state":""},"billing":{"state":""}}'),
  (990207, '990207', 'عميلة تجربة 7', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null,
   '{"shipping":{"city":"x"},"billing":{"city":"y"}}'),
  (990208, '990208', 'عميلة تجربة 8', 'جاري التنفيذ', '2026-10-20T10:00:00Z', null, null),
  (990209, '990209', 'عميلة تجربة 9', 'جاري التنفيذ', '2026-10-20T10:00:00Z', 'EG-09',
   '{"shipping":{"state":"EG-10"},"billing":{"state":"EG-10"}}');

-- A name the sync already wrote: the re-run of `create table if not exists` must keep it.
insert into public.woo_states (code, name, updated_at) values ('EG-01', 'محافظة تجربة', '2026-10-26T12:00:00Z');

do $$ begin
  perform set_config('migrate_0010.events', (select count(*)::text from public.order_events), true);
end $$;

-- ---------------------------------------------------------------- 0010 on that state

\ir ../migrations/0010_state_names.sql

do $$ begin
  if not ((select string_agg(id || '=' || coalesce(customer_state, '∅'), ',' order by id) from public.orders where id between 990201 and 990209)
          = '990201=EG-01,990202=EG-03,990203=EG-04,990204=EG-05,990205=EG-07,990206=∅,990207=∅,990208=∅,990209=EG-09') then
    raise exception 'case customer_state backfilled from raw (shipping, else billing; trimmed, blank = missing; an existing value kept) failed';
  end if;
  if not ((select count(*) from public.order_events)::text = current_setting('migrate_0010.events')) then
    raise exception 'case the backfill writes no order_events rows (customer_state is not tracked) failed';
  end if;
  if not ((select customer_state from public.orders_v where id = 990201) = 'EG-01') then
    raise exception 'case orders_v carries the backfilled customer_state failed';
  end if;
  if not ((select string_agg(code || '=' || name || '@' || to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), ',') from public.woo_states)
          = 'EG-01=محافظة تجربة@2026-10-26T12:00') then
    raise exception 'case woo_states keeps the rows it has failed';
  end if;
end $$;

-- ---------------------------------------------------------------- a re-run changes nothing

do $$ begin
  perform set_config('migrate_0010.before', concat_ws('|',
    (select string_agg(id || coalesce(customer_state, '∅'), ',' order by id) from public.orders),
    (select string_agg(code || name || updated_at, ',' order by code) from public.woo_states),
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
     where table_schema = 'public' and table_name = 'orders_v'),
    (select string_agg(policyname || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'woo_states'),
    (select string_agg(grantee || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants
     where table_schema = 'public' and table_name in ('woo_states', 'orders_v')),
    (select string_agg(grantee || privilege_type, ',' order by grantee, privilege_type) from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_state'),
    (select count(*) from public.order_events)), true);
end $$;

\ir ../migrations/0010_state_names.sql

do $$ begin
  if not (current_setting('migrate_0010.before')
          = concat_ws('|',
              (select string_agg(id || coalesce(customer_state, '∅'), ',' order by id) from public.orders),
              (select string_agg(code || name || updated_at, ',' order by code) from public.woo_states),
              (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
               where table_schema = 'public' and table_name = 'orders_v'),
              (select string_agg(policyname || cmd, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'woo_states'),
              (select string_agg(grantee || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants
               where table_schema = 'public' and table_name in ('woo_states', 'orders_v')),
              (select string_agg(grantee || privilege_type, ',' order by grantee, privilege_type) from information_schema.column_privileges
               where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_state'),
              (select count(*) from public.order_events))) then
    raise exception 'case 0010 applied a second time changes nothing (customer_state, woo_states, orders_v, policy, grants, order_events) failed';
  end if;
  if not ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'woo_states') = 1) then
    raise exception 'case the woo_states policy exists once after three runs failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'migrate_0010: ok'; end $$;
