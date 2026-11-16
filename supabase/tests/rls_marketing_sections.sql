-- RLS / rule tests for 0109_marketing_sections (comments decisions 69–71): the designer's trends and the last site check are the
-- server's rows (read with marketing.view, never written by a member); the media buyer's competitors are added, edited and
-- archived with marketing.create, their author and date the server's, an archived one final. Depends on 0001 … 0109.
-- One transaction rolled back; prints NOTICE 'rls_marketing_sections: ok' only if every case passed. Live-safe.

begin;

insert into public.roles (id, name, description, is_system, permissions, sort) values
  ('mks_view', 'تسويق عرض بس (اختبار الأقسام)', 'test', false, '{"marketing.view": "F", "marketing.create": "N"}'::jsonb, 99);
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000109a1', 'ms-adm.dev@ibtekr.local', '01000109a01'),
  ('00000000-0000-4000-8000-0000000109a2', 'ms-ops.dev@ibtekr.local', '01000109a02'),
  ('00000000-0000-4000-8000-0000000109a3', 'ms-acc.dev@ibtekr.local', '01000109a03'),
  ('00000000-0000-4000-8000-0000000109a4', 'ms-view.dev@ibtekr.local', '01000109a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'ms-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000109a1', 'أدمن الأقسام', 'ms-adm.dev@ibtekr.local', '01000109a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000109a2', 'محتوى الأقسام', 'ms-ops.dev@ibtekr.local', '01000109a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000109a3', 'حسابات', 'ms-acc.dev@ibtekr.local', '01000109a03', 'accounts', 'active'),
  ('00000000-0000-4000-8000-0000000109a4', 'عرض بس', 'ms-view.dev@ibtekr.local', '01000109a04', 'mks_view', 'active');

-- the server's rows
insert into public.mkt_trends (batch, title, summary, source, url, kind) values
  ('b0000000-0000-4000-8000-000000000109', 'ريلز الورشة', 'لقطات من التصنيع', 'Later', 'https://later.com/blog/trends/', 'video');
insert into public.site_checks (kind, data) values ('wp_updates', '{"core": {"version": "6.8"}}'::jsonb)
  on conflict (kind) do update set data = excluded.data;
do $$ begin
  -- the checks of a trend row: an https link, a known kind, a title
  begin insert into public.mkt_trends (batch, title, source, url, kind) values (gen_random_uuid(), 'x', 's', 'http://plain.example/x', 'image'); raise exception 'case a trend needs an https link failed'; exception when check_violation then null; end;
  begin insert into public.mkt_trends (batch, title, source, url, kind) values (gen_random_uuid(), 'x', 's', 'https://a.example/x', 'gif'); raise exception 'case a trend''s kind failed'; exception when check_violation then null; end;
  begin insert into public.mkt_trends (batch, title, source, url, kind) values (gen_random_uuid(), '  ', 's', 'https://a.example/x', 'image'); raise exception 'case a trend needs a title failed'; exception when check_violation then null; end;
  -- a refresh's run row is accepted
  insert into public.ai_runs (created_by, action, source, label, status) values ('00000000-0000-4000-8000-0000000109a1', 'marketing', 'trends', 'trends', 'ok');
end $$;

set local role authenticated;

-- ================================================================ ops (marketing.view + create F)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000109a2","role":"authenticated"}', true);
do $$
declare n bigint; c bigint;
begin
  if (select count(*) from public.mkt_trends where source = 'Later') <> 1 then raise exception 'case ops reads the trends failed'; end if;
  if (select count(*) from public.site_checks where kind = 'wp_updates') <> 1 then raise exception 'case ops reads the site check failed'; end if;
  -- never written by a member
  begin insert into public.mkt_trends (batch, title, source, url, kind) values (gen_random_uuid(), 'من عضو', 's', 'https://a.example/x', 'image'); raise exception 'case a member writes no trend failed'; exception when insufficient_privilege then null; end;
  begin update public.mkt_trends set title = 'غيّرته'; raise exception 'case a member edits no trend failed'; exception when insufficient_privilege then null; end;
  begin delete from public.mkt_trends; raise exception 'case a member deletes no trend failed'; exception when insufficient_privilege then null; end;
  begin update public.site_checks set data = '{}'::jsonb; raise exception 'case a member writes no site check failed'; exception when insufficient_privilege then null; end;
  -- a competitor: added with the page's number; who and when are the server's
  insert into public.mkt_competitors (name, page_id, page_url, keyword, note) values ('محل منافس', '123456789012', 'https://www.facebook.com/somepage', 'مكرمية', 'بيعلن كتير') returning id into n;
  if (select created_by from public.mkt_competitors where id = n) <> '00000000-0000-4000-8000-0000000109a2' then raise exception 'case the competitor''s author is the server''s failed'; end if;
  -- its columns' checks
  begin insert into public.mkt_competitors (name, page_id) values ('x', 'abc'); raise exception 'case the page id is digits failed'; exception when check_violation then null; end;
  begin insert into public.mkt_competitors (name, page_url) values ('x', 'https://evil.example/page'); raise exception 'case the page link is facebook or instagram failed'; exception when check_violation then null; end;
  begin insert into public.mkt_competitors (name) values ('اسم <b>'); raise exception 'case a name without tags failed'; exception when check_violation then null; end;
  -- the author column is not the member's to send
  begin insert into public.mkt_competitors (name, created_by) values ('x', '00000000-0000-4000-8000-0000000109a1'); raise exception 'case created_by is not granted failed'; exception when insufficient_privilege then null; end;
  -- edited, then archived: the stamp is the server's time; an archived row is final; no delete
  update public.mkt_competitors set note = 'ملاحظة جديدة' where id = n;
  if (select updated_by from public.mkt_competitors where id = n) <> '00000000-0000-4000-8000-0000000109a2' then raise exception 'case the edit is stamped failed'; end if;
  update public.mkt_competitors set archived_at = '2020-01-01' where id = n;
  if (select archived_at from public.mkt_competitors where id = n) < now() - interval '1 minute' then raise exception 'case the archive is stamped with the server''s time failed'; end if;
  begin update public.mkt_competitors set name = 'رجع' where id = n; raise exception 'case an archived competitor is final failed'; exception when insufficient_privilege then null; end;
  begin delete from public.mkt_competitors where id = n; raise exception 'case no competitor is deleted failed'; exception when insufficient_privilege then null; end;
  insert into public.mkt_competitors (name) values ('منافس تاني') returning id into c;
  perform set_config('test.competitor', c::text, true);
end $$;

-- ================================================================ view only: reads, writes nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000109a4","role":"authenticated"}', true);
do $$
declare c bigint := current_setting('test.competitor')::bigint; n int;
begin
  if (select count(*) from public.mkt_trends) < 1 or (select count(*) from public.mkt_competitors where id = c) <> 1 then raise exception 'case a viewer reads failed'; end if;
  begin insert into public.mkt_competitors (name) values ('من مشاهد'); raise exception 'case a viewer adds no competitor failed'; exception when insufficient_privilege then null; end;
  update public.mkt_competitors set note = 'x' where id = c; get diagnostics n = row_count;
  if n <> 0 then raise exception 'case a viewer edits no competitor failed'; end if;
end $$;

-- ================================================================ accounts (marketing.view N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000109a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_trends) <> 0 or (select count(*) from public.mkt_competitors) <> 0 or (select count(*) from public.site_checks) <> 0 then raise exception 'case no marketing.view reads nothing failed'; end if;
end $$;

-- ================================================================ anon: nothing at all
reset role; set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin perform 1 from public.mkt_trends; raise exception 'case anon reads no trend failed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.mkt_competitors; raise exception 'case anon reads no competitor failed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.site_checks; raise exception 'case anon reads no site check failed'; exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_marketing_sections: ok'; end $$;
rollback;
