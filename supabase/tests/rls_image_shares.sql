-- RLS / permission tests for 0028_image_shares (the photos sent to the Magnific site + image_imports target 'batch'). Depends on
-- 0001_identity … 0028_image_shares. Runs in one transaction and rolls back; prints NOTICE 'rls_image_shares: ok' only if every case passed.
-- Live-safe: its rows (two made-up members, a batch, their share rows) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000095', 'shr-a.dev@ibtekr.local', '01000000095'),
  ('00000000-0000-4000-8000-000000000096', 'shr-b.dev@ibtekr.local', '01000000096');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-000000000095', '00000000-0000-4000-8000-000000000096');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000095', 'شير أ', 'shr-a.dev@ibtekr.local', '01000000095', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-000000000096', 'شير ب', 'shr-b.dev@ibtekr.local', '01000000096', 'admin', 'active', '{}');
insert into public.studio_batches (id, title, type, state, step, created_by) values
  ('0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 'دفعة أ', 'Simple', '{"items":[]}', 2, '00000000-0000-4000-8000-000000000095');

-- ================================================================ the server's rows (service_role writes; here the owner)

do $$ begin
  insert into public.image_shares (created_by, batch_id, item_index, item_key, name, path, url, expires_at) values
    ('00000000-0000-4000-8000-000000000095', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 0, 'k1', 'Boho Cushion.jpg', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95/row1-main-x.jpg', 'https://x.supabase.co/storage/v1/object/sign/studio/a?token=t', now() + interval '7 days'),
    ('00000000-0000-4000-8000-000000000096', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 1, 'k2', 'Mug.jpg', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95/row2-main-x.jpg', 'https://x.supabase.co/storage/v1/object/sign/studio/b?token=t', now() + interval '7 days');
  begin
    insert into public.image_shares (created_by, batch_id, item_index, name, path, url, expires_at) values ('00000000-0000-4000-8000-000000000095', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 0, 'x.jpg', 'p', 'http://plain', now());
    raise exception 'case a plain http link is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_shares (created_by, batch_id, item_index, name, path, url, expires_at, status) values ('00000000-0000-4000-8000-000000000095', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 0, 'x.jpg', 'p', 'https://ok', now(), 'done');
    raise exception 'case a status outside the list is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_shares (created_by, batch_id, item_index, name, path, url, expires_at, creation_ref) values ('00000000-0000-4000-8000-000000000095', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 0, 'x.jpg', 'p', 'https://ok', now(), 'bad ref!');
    raise exception 'case a creation ref outside the shape is refused failed';
  exception when check_violation then null;
  end;
  -- the bridge marks a row sent
  update public.image_shares set status = 'sent', creation_ref = '9ZhsKbKNYZ', sent_at = now() where name = 'Boho Cushion.jpg';
  -- image_imports takes target 'batch' since 0028
  insert into public.image_imports (created_by, urls, target, batch_id, items) values ('00000000-0000-4000-8000-000000000095', '["https://pikaso.cdnpk.net/private/r.jpg"]', 'batch', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', '[{"index":0,"images":[0]}]');
  begin
    insert into public.image_imports (created_by, urls, target) values ('00000000-0000-4000-8000-000000000095', '["https://x"]', 'site');
    raise exception 'case a target outside the list is refused failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ member A (products.add F): own rows only, no writes

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000095","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from public.image_shares) <> 1 then raise exception 'case a member reads own share rows only failed'; end if;
  if (select status from public.image_shares) <> 'sent' then raise exception 'case the bridge''s mark is read failed'; end if;
  begin
    insert into public.image_shares (created_by, batch_id, item_index, name, path, url, expires_at) values ('00000000-0000-4000-8000-000000000095', '0b6f2f5e-1d2c-4a8b-9e3f-00000000aa95', 2, 'z.jpg', 'p', 'https://ok', now());
    raise exception 'case a member cannot insert failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.image_shares set status = 'pending';
    raise exception 'case a member cannot update failed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.image_shares;
    raise exception 'case a member cannot delete failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ member B (the admin): every row, still no writes

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000096","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.image_shares) <> 2 then raise exception 'case the admin reads every share row failed'; end if;
  begin
    update public.image_shares set status = 'error';
    raise exception 'case the admin cannot update either failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ anon: nothing

set local role anon;
do $$ begin
  begin
    perform count(*) from public.image_shares;
    raise exception 'case anon reads nothing failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_image_shares: ok'; end $$;
rollback;
