-- Tests for 0126_pixel_check (the owner 17 Nov): site_checks takes 'pixel' beside the others; read with marketing.view, written by the
-- server only; an unknown kind refused. One transaction, rolled back; NOTICE 'rls_pixel_check: ok' only if every case passed. Live-safe.
begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000126a1', 'px-ops.dev@ibtekr.local', '01000126a01'),
  ('00000000-0000-4000-8000-0000000126a2', 'px-acc.dev@ibtekr.local', '01000126a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000126a1', 'محتوى البيكسل', 'px-ops.dev@ibtekr.local', '01000126a01', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000126a2', 'حسابات البيكسل', 'px-acc.dev@ibtekr.local', '01000126a02', 'accounts', 'active');

insert into public.site_checks (kind, data) values ('pixel', '{"orders": 61, "issues": []}'::jsonb)
  on conflict (kind) do update set data = excluded.data;
do $$ begin
  begin insert into public.site_checks (kind, data) values ('lighthouse', '{}'); raise exception 'case a known kind failed'; exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000126a1","role":"authenticated"}', true);
do $$ begin
  if (select (data ->> 'orders')::int from public.site_checks where kind = 'pixel') <> 61 then raise exception 'case marketing.view reads the pixel failed'; end if;
  begin update public.site_checks set data = '{}'::jsonb where kind = 'pixel'; raise exception 'case a member writes no pixel failed'; exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000126a2","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.site_checks where kind = 'pixel') then raise exception 'case no marketing.view reads no pixel failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_pixel_check: ok'; end $$;
rollback;
