-- RLS / permission tests for 0026_image_imports (the Magnific import queue + ai_runs source 'import'). Depends on 0001_identity …
-- 0026_image_imports. Runs in one transaction and rolls back; prints NOTICE 'rls_image_imports: ok' only if every case passed.
-- Live-safe: its rows (two made-up members, their queue rows) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000093', 'imp-a.dev@ibtekr.local', '01000000093'),
  ('00000000-0000-4000-8000-000000000094', 'imp-b.dev@ibtekr.local', '01000000094');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000094');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000093', 'وارد أ', 'imp-a.dev@ibtekr.local', '01000000093', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-000000000094', 'وارد ب', 'imp-b.dev@ibtekr.local', '01000000094', 'admin', 'active', '{}');

-- ================================================================ the queue rows (the bridge writes as postgres; here the owner)

do $$ begin
  insert into public.image_imports (created_by, folder, label, product_id, urls, refs) values
    ('00000000-0000-4000-8000-000000000093', 'ابتكر', 'Boho Cushion', 4001, '["https://pikaso.cdnpk.net/private/a.jpg", "https://pikaso.cdnpk.net/private/b.jpg"]', '["9ZhsKbKNYZ", "UPd5EfIwny"]'),
    ('00000000-0000-4000-8000-000000000094', 'ابتكر', 'Mug', null, '["https://pikaso.cdnpk.net/private/c.jpg"]', '["AAA"]');
  begin
    insert into public.image_imports (created_by, urls) values ('00000000-0000-4000-8000-000000000093', '[]');
    raise exception 'case an empty set is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_imports (created_by, urls, status) values ('00000000-0000-4000-8000-000000000093', '["https://x"]', 'done');
    raise exception 'case a status outside the list is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_imports (created_by, urls, source) values ('00000000-0000-4000-8000-000000000093', '["https://x"]', 'dropbox');
    raise exception 'case a source outside the list is refused failed';
  exception when check_violation then null;
  end;
  -- ai_runs takes source 'import' since 0026
  insert into public.ai_runs (created_by, action, source, label, credits, cost_usd, status) values
    ('00000000-0000-4000-8000-000000000093', 'image', 'import', 'Boho Cushion', 0, 0, 'ok');
  if (select count(*) from public.image_imports where refs ?| array['UPd5EfIwny']) <> 1 then raise exception 'case refs are searchable (dedupe) failed'; end if;
end $$;

-- ================================================================ member A (products.add F): own rows only, no writes

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000093","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from public.image_imports) <> 1 then raise exception 'case a member reads own rows only failed'; end if;
  if (select label from public.image_imports) <> 'Boho Cushion' then raise exception 'case the own row is the one read failed'; end if;
  begin
    insert into public.image_imports (created_by, urls) values ('00000000-0000-4000-8000-000000000093', '["https://pikaso.cdnpk.net/private/z.jpg"]');
    raise exception 'case a member cannot insert failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.image_imports set status = 'ok' where label = 'Boho Cushion';
    raise exception 'case a member cannot update failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.image_imports where label = 'Boho Cushion';
    raise exception 'case a member cannot delete failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ member B (the admin): every row, still no writes

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000094","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from public.image_imports) <> 2 then raise exception 'case the admin reads every row failed'; end if;
  begin
    update public.image_imports set status = 'ok';
    raise exception 'case the admin cannot update either failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ anon: nothing

set local role anon;
do $$ begin
  begin
    perform count(*) from public.image_imports;
    raise exception 'case anon reads nothing failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_image_imports: ok'; end $$;
rollback;
