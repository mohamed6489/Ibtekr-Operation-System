-- RLS / permission tests for 0024_ai (ai_runs, ai_month_cost). Depends on 0001_identity … 0024_ai. Runs in one transaction
-- and rolls back; prints NOTICE 'rls_ai: ok' only if every case passed. Live-safe: its rows (five runs of three made-up
-- members) are rolled back; the admin case only checks it sees the test rows, never a live total.

begin;

-- Test users (fixed UUIDs …81–…83): two members with products.add F, one admin.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000081', 'ai-a.dev@ibtekr.local', '01000000081'),
  ('00000000-0000-4000-8000-000000000082', 'ai-b.dev@ibtekr.local', '01000000082'),
  ('00000000-0000-4000-8000-000000000083', 'ai-admin.dev@ibtekr.local', '01000000083');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000082',
                                 '00000000-0000-4000-8000-000000000083');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000081', 'محتوى أ', 'ai-a.dev@ibtekr.local', '01000000081', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-000000000082', 'محتوى ب', 'ai-b.dev@ibtekr.local', '01000000082', 'viewer', 'active', '{"products.view":"F","products.edit":"F"}'),
  ('00000000-0000-4000-8000-000000000083', 'أدمن محتوى', 'ai-admin.dev@ibtekr.local', '01000000083', 'admin', 'active', '{}');

do $$ begin
  if has_table_privilege('anon', 'public.ai_runs', 'SELECT') or has_table_privilege('authenticated', 'public.ai_runs', 'INSERT')
     or has_table_privilege('authenticated', 'public.ai_runs', 'UPDATE') or has_table_privilege('authenticated', 'public.ai_runs', 'DELETE')
     or not has_table_privilege('authenticated', 'public.ai_runs', 'SELECT') or not has_table_privilege('service_role', 'public.ai_runs', 'INSERT')
     or has_function_privilege('anon', 'public.ai_month_cost()', 'EXECUTE') then
    raise exception 'case ai grants failed';
  end if;
end $$;

-- ================================================================ the server's rows (service_role writes; here the owner,
-- since the local stub's service_role has no BYPASSRLS — the grants case above covers service_role's insert)

do $$ declare m timestamptz := date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'; begin
  insert into public.ai_runs (created_by, action, source, label, product_id, model, input_tokens, output_tokens, cost_usd, status, output) values
    ('00000000-0000-4000-8000-000000000081', 'write', 'product', 'Kilim Pouf', 4001, 'claude-opus-5-5', 3000, 2000, 0.052, 'ok', '{"en":{"name":"Kilim Pouf"}}'),
    ('00000000-0000-4000-8000-000000000082', 'write', 'data', 'Desk Lamp', null, 'claude-opus-5-5', 2500, 1500, 0.040, 'ok', '{"ar":{"name":"أباجورة"}}');
  -- Cairo's month: a run half an hour after the month began there (still last month in UTC) counts; one an hour before does not
  insert into public.ai_runs (created_at, created_by, action, source, model, cost_usd, status) values
    (m + interval '30 minutes', '00000000-0000-4000-8000-000000000081', 'write', 'image', 'claude-opus-5-5', 0.010, 'ok'),
    (m - interval '1 hour', '00000000-0000-4000-8000-000000000081', 'write', 'data', 'claude-opus-5-5', 1.000, 'ok');
  insert into public.ai_runs (created_by, action, status, error) values
    ('00000000-0000-4000-8000-000000000081', 'studio', 'error', 'not_configured');
  begin
    insert into public.ai_runs (action, status) values ('write', 'done');
    raise exception 'case a status outside the list is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_runs (action, status, error) values ('write', 'error', 'Key sk-ant-123 is wrong');
    raise exception 'case the error is a code only failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_runs (action, status) values ('chat', 'ok');
    raise exception 'case an action outside the list is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ member A: their own rows only, no writes

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000081","role":"authenticated"}';
do $$ declare n int; c numeric; begin
  select count(*) into n from public.ai_runs;
  if n <> 4 then raise exception 'case a member reads their own runs only failed (% rows)', n; end if;
  if exists (select 1 from public.ai_runs where label = 'Desk Lamp') then raise exception 'case a member does not read another''s run failed'; end if;
  c := public.ai_month_cost();
  if c <> 0.062 then raise exception 'case ai_month_cost sums this Cairo month of their own rows failed (%)', c; end if;
  begin
    insert into public.ai_runs (created_by, action, status) values ('00000000-0000-4000-8000-000000000081', 'write', 'ok');
    raise exception 'case a member may not add a run failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_runs set cost_usd = 0 where label = 'Kilim Pouf';
    raise exception 'case a member may not change a run failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ai_runs where label = 'Kilim Pouf';
    raise exception 'case a member may not delete a run failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ member B: their one row

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000082","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.ai_runs) <> 1 or not exists (select 1 from public.ai_runs where label = 'Desk Lamp') then
    raise exception 'case member B reads their one run failed';
  end if;
  if public.ai_month_cost() <> 0.040 then raise exception 'case member B''s month cost failed'; end if;
end $$;

-- ================================================================ the admin: every row

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000083","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.ai_runs where created_by in ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000082')) <> 5 then
    raise exception 'case the admin reads every run failed';
  end if;
  if public.ai_month_cost() < 0.102 then raise exception 'case the admin''s month cost covers every member failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_ai: ok'; end $$;
rollback;
