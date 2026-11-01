-- RLS / permission tests for 0025_ai_images (ai_runs action 'image' + credits, the bucket ai-images). Depends on 0001_identity …
-- 0025_ai_images. Runs in one transaction and rolls back; prints NOTICE 'rls_ai_images: ok' only if every case passed.
-- Live-safe: its rows (three runs of two made-up members) are rolled back; nothing live is counted.

begin;

-- Test users (fixed UUIDs …91–…92): a member with products.add F, one with products.edit F.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000091', 'img-a.dev@ibtekr.local', '01000000091'),
  ('00000000-0000-4000-8000-000000000092', 'img-b.dev@ibtekr.local', '01000000092');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000091', 'صور أ', 'img-a.dev@ibtekr.local', '01000000091', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-000000000092', 'صور ب', 'img-b.dev@ibtekr.local', '01000000092', 'viewer', 'active', '{"products.view":"F","products.edit":"F"}');

-- ================================================================ the server's rows (service_role writes; here the owner)

do $$ begin
  insert into public.ai_runs (created_by, action, source, label, model, credits, cost_usd, status) values
    ('00000000-0000-4000-8000-000000000091', 'image', 'studio', 'Kilim Pouf · 1', 'seedream-5-pro', 75, 0.15, 'ok'),
    ('00000000-0000-4000-8000-000000000091', 'image', 'tool', 'Mug', 'seedream-5-lite', 50, 0.10, 'ok'),
    ('00000000-0000-4000-8000-000000000092', 'image', 'edit', 'Tote', 'seedream-5-pro', 75, 0.15, 'error');
  begin
    insert into public.ai_runs (action, status) values ('chat', 'ok');
    raise exception 'case an action outside the list is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_runs (action, source, status) values ('image', 'camera', 'ok');
    raise exception 'case a source outside the list is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_runs (action, source, status, credits) values ('image', 'tool', 'ok', -1);
    raise exception 'case negative credits are refused failed';
  exception when check_violation then null;
  end;
  if (select credits from public.ai_runs where label = 'Mug') <> 50 then raise exception 'case credits stored failed'; end if;
  if (select credits from public.ai_runs where action = 'write' limit 1) is not null
     and exists (select 1 from public.ai_runs where action = 'write' and credits <> 0) then raise exception 'case the old rows default to 0 credits failed'; end if;
end $$;

-- ================================================================ member A: their own image rows, still no writes

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated"}';
do $$ declare n int; c int; begin
  select count(*), coalesce(sum(credits), 0) into n, c from public.ai_runs where action = 'image';
  if n <> 2 or c <> 125 then raise exception 'case a member reads their own image runs and credits failed (% rows, % credits)', n, c; end if;
  if exists (select 1 from public.ai_runs where label = 'Tote') then raise exception 'case a member does not read another''s image run failed'; end if;
  if public.ai_month_credits() <> 125 then raise exception 'case a member''s month credits are their own image rows failed (%)', public.ai_month_credits(); end if;
  begin
    insert into public.ai_runs (created_by, action, source, status) values ('00000000-0000-4000-8000-000000000091', 'image', 'tool', 'ok');
    raise exception 'case a member may not add an image run failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_image_run_start('{"created_by":"00000000-0000-4000-8000-000000000091","source":"tool"}', null, 75, 0.15, 60, 10);
    raise exception 'case a member may not reserve an image run failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ ai_image_run_start: the server reserves an image run before the call

reset role;
do $$ declare r jsonb; n int; spent bigint; begin
  if has_function_privilege('authenticated', 'public.ai_image_run_start(jsonb, int, int, numeric, int, int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ai_image_run_start(jsonb, int, int, numeric, int, int)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ai_image_run_start(jsonb, int, int, numeric, int, int)', 'EXECUTE') then
    raise exception 'case ai_image_run_start is the server''s only failed';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_month_credits()', 'EXECUTE') or has_function_privilege('anon', 'public.ai_month_credits()', 'EXECUTE') then
    raise exception 'case ai_month_credits is for members and the server failed';
  end if;
  spent := public.ai_month_credits(); -- the owner reads every row: the 200 of this test, plus whatever the live project made this month
  if spent < 200 then raise exception 'case the month credits count every image row failed (%)', spent; end if;
  -- the cap: this month's credits + the planned credits over the cap → a cap row at 0 credits, no reservation
  r := public.ai_image_run_start('{"created_by":"00000000-0000-4000-8000-000000000092","source":"studio","label":"Pouf","batch_id":null,"item_index":2,"model":"seedream-5-pro"}', (spent + 74)::int, 75, 0.15, 60, 10);
  if r ->> 'result' <> 'cap' or not exists (select 1 from public.ai_runs where id = (r ->> 'id')::bigint and status = 'cap' and error = 'ai_cap' and credits = 0 and cost_usd = 0
       and action = 'image' and source = 'studio' and item_index = 2 and created_by = '00000000-0000-4000-8000-000000000092') then
    raise exception 'case the credit cap refuses a run that could pass it failed (%)', r;
  end if;
  if public.ai_month_credits() <> spent then raise exception 'case a cap row adds no credits failed'; end if;
  -- within the cap: a pending row holding the planned credits and the USD estimate; it counts in the month at once
  r := public.ai_image_run_start('{"created_by":"00000000-0000-4000-8000-000000000092","source":"studio","label":"Pouf","item_index":2,"model":"seedream-5-pro"}', (spent + 75)::int, 75, 0.15, 60, 10);
  if r ->> 'result' <> 'ok' or not exists (select 1 from public.ai_runs where id = (r ->> 'id')::bigint and status = 'pending' and credits = 75 and cost_usd = 0.15 and action = 'image') then
    raise exception 'case a run within the credit cap is reserved failed (%)', r;
  end if;
  if public.ai_month_credits() <> spent + 75 then raise exception 'case a pending run counts at its planned credits failed (%)', public.ai_month_credits(); end if;
  -- no cap → reserved whatever the month; the throttle counts every run of the member (member B has 3 now: a throttle of 3 → busy, no row)
  r := public.ai_image_run_start('{"created_by":"00000000-0000-4000-8000-000000000092","source":"tool"}', null, 50, 0.10, 100, 10);
  if r ->> 'result' <> 'ok' then raise exception 'case no cap reserves failed (%)', r; end if;
  select count(*) into n from public.ai_runs;
  r := public.ai_image_run_start('{"created_by":"00000000-0000-4000-8000-000000000092","source":"tool"}', null, 50, 0.10, 3, 10);
  if r ->> 'result' <> 'busy' or (select count(*) from public.ai_runs) <> n then raise exception 'case the throttle answers busy with no row failed (%)', r; end if;
end $$;

-- ================================================================ the bucket (when the storage schema is there)

reset role;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    if not exists (select 1 from storage.buckets where id = 'ai-images' and public = false) then raise exception 'case bucket ai-images private failed'; end if;
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('ai_images_select', 'ai_images_delete')) <> 2 then
      raise exception 'case bucket ai-images policies failed';
    end if;
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'ai_images_%' and cmd in ('INSERT', 'UPDATE')) then
      raise exception 'case members never write bucket ai-images failed';
    end if;
  end if;
end $$;

do $$ begin raise notice 'rls_ai_images: ok'; end $$;
rollback;
