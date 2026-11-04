-- RLS / permission tests for 0041_cs_posts (the posts the comments are on). Depends on 0001_identity … 0041_cs_posts. Runs in
-- one transaction and rolls back; prints NOTICE 'rls_cs_posts: ok' only if every case passed. Live-safe: its rows (two made-up
-- members, one post) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000097', 'csp-a.dev@ibtekr.local', '01000000097'),
  ('00000000-0000-4000-8000-000000000098', 'csp-b.dev@ibtekr.local', '01000000098');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000097', '00000000-0000-4000-8000-000000000098');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000097', 'بوستات أ', 'csp-a.dev@ibtekr.local', '01000000097', 'cs', 'active', '{}'),
  ('00000000-0000-4000-8000-000000000098', 'بوستات ب', 'csp-b.dev@ibtekr.local', '01000000098', 'accounts', 'active', '{}');

-- ================================================================ the server's rows (service_role)

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$ begin
  insert into public.cs_posts (id, platform, caption, permalink, thumb, kind, posted_at) values
    ('222739967596902_122342756444234635', 'facebook', 'كرسي جديد', 'https://www.facebook.com/x/posts/1', 'https://scontent.xx.fbcdn.net/a.jpg', 'photo', now());
  update public.cs_posts set seen_at = now(), caption = 'كرسي جديد ✨' where id = '222739967596902_122342756444234635';
  begin
    insert into public.cs_posts (id, platform) values ('1/../2', 'facebook');
    raise exception 'case a post id outside digits and _ is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.cs_posts (id, platform, permalink) values ('18096287867161133', 'instagram', 'javascript:alert(1)');
    raise exception 'case a link that is not https is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.cs_posts (id, platform) values ('18096287867161134', 'tiktok');
    raise exception 'case a platform outside facebook / instagram is refused failed';
  exception when check_violation then null;
  end;
  begin
    delete from public.cs_posts;
    raise exception 'case service_role never deletes a post failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ a member with cs.view reads; never writes

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000097","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from public.cs_posts) <> 1 then raise exception 'case cs.view reads the posts failed'; end if;
  begin
    insert into public.cs_posts (id, platform) values ('123', 'facebook');
    raise exception 'case a member writes no post failed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.cs_posts set caption = 'x';
    raise exception 'case a member updates no post failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ cs.view = N (accounts): no rows

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000098","role":"authenticated"}', true);

do $$ begin
  if (select count(*) from public.cs_posts) <> 0 then raise exception 'case cs.view N reads no post failed'; end if;
end $$;

-- ================================================================ anon: nothing

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform count(*) from public.cs_posts;
    raise exception 'case anon reads no post failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_cs_posts: ok'; end $$;
rollback;
