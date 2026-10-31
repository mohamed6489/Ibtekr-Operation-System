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
    ('00000000-0000-4000-8000-000000000091', 'image', 'tool', 'Mug', 'imagen-nano-banana-2-1', 50, 0.10, 'ok'),
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
  begin
    insert into public.ai_runs (created_by, action, source, status) values ('00000000-0000-4000-8000-000000000091', 'image', 'tool', 'ok');
    raise exception 'case a member may not add an image run failed';
  exception when insufficient_privilege then null;
  end;
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
