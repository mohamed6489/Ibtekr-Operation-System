-- Tests for 0119_site_speed (ش45 decision 1): site_checks takes 'pagespeed' beside 'wp_updates'; read with marketing.view, written by the
-- server only; an unknown kind refused. One transaction, rolled back; NOTICE 'rls_site_speed: ok' only if every case passed. Live-safe.
begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000119a1', 'sp-ops.dev@ibtekr.local', '01000119a01'),
  ('00000000-0000-4000-8000-0000000119a2', 'sp-acc.dev@ibtekr.local', '01000119a02');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000119a1', 'محتوى السرعة', 'sp-ops.dev@ibtekr.local', '01000119a01', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000119a2', 'حسابات السرعة', 'sp-acc.dev@ibtekr.local', '01000119a02', 'accounts', 'active');

insert into public.site_checks (kind, data) values ('pagespeed', '{"score": 61, "pages": []}'::jsonb)
  on conflict (kind) do update set data = excluded.data;
do $$ begin
  begin insert into public.site_checks (kind, data) values ('lighthouse', '{}'); raise exception 'case a known kind failed'; exception when check_violation then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000119a1","role":"authenticated"}', true);
do $$ begin
  if (select (data ->> 'score')::int from public.site_checks where kind = 'pagespeed') <> 61 then raise exception 'case marketing.view reads the speed failed'; end if;
  begin update public.site_checks set data = '{}'::jsonb where kind = 'pagespeed'; raise exception 'case a member writes no speed failed'; exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000119a2","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.site_checks where kind = 'pagespeed') then raise exception 'case no marketing.view reads no speed failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_site_speed: ok'; end $$;
rollback;
