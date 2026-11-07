-- RLS / permission tests for 0053_marketing_buyer (phase 9.5.4: the buyer's suggestions — the server's rows, read with
-- marketing.view, never written by a member —, the designer / developer requests, the rules function). Depends on 0001 … 0053.
-- One transaction rolled back; prints NOTICE 'rls_marketing_buyer: ok' only if every case passed. Live-safe.

begin;

insert into public.roles (id, name, description, is_system, permissions, sort) values
  ('mkb_only', 'تسويق عرض بس (اختبار)', 'test', false, '{"marketing.view": "F", "marketing.create": "N"}'::jsonb, 99);
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000053a1', 'mb-adm.dev@ibtekr.local', '01000053a01'),
  ('00000000-0000-4000-8000-0000000053a2', 'mb-ops.dev@ibtekr.local', '01000053a02'),
  ('00000000-0000-4000-8000-0000000053a3', 'mb-cs.dev@ibtekr.local', '01000053a03'),
  ('00000000-0000-4000-8000-0000000053a4', 'mb-view.dev@ibtekr.local', '01000053a04');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'mb-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000053a1', 'أدمن المساعدين', 'mb-adm.dev@ibtekr.local', '01000053a01', 'admin', 'active'),
  ('00000000-0000-4000-8000-0000000053a2', 'محتوى المساعدين', 'mb-ops.dev@ibtekr.local', '01000053a02', 'ops', 'active'),
  ('00000000-0000-4000-8000-0000000053a3', 'خدمة عملاء', 'mb-cs.dev@ibtekr.local', '01000053a03', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000053a4', 'عرض بس', 'mb-view.dev@ibtekr.local', '01000053a04', 'mkb_only', 'active');

-- the server's rows: two open suggestions, one decided; a second open row of the same kind × campaign is refused (one open at a time)
insert into public.mkt_suggestions (kind, campaign_id, campaign_name, title, sub, why, impact, pct, data) values
  ('stop', '120251977233530228', 'Lamps — Broad', 'وقّف «Lamps — Broad»', 'صرفت 1,700 ج.م · ولا أوردر من 5 أيام', 'ميتا بتحسب 10 مشتريات بس مفيش أوردر', 'توفير ~340 ج.م/يوم', null, '{"spend": 1700, "orders": 0}'),
  ('budget_up', '120252323303340228', 'Macrame — Retargeting', 'زوّد «Macrame — Retargeting» 20%', 'العائد الحقيقي 5.00×', 'أعلى عائد', 'متوقع +2 أوردر/أسبوع', 20, '{"mer": 5, "orders": 5, "daily_budget": 300}');
insert into public.mkt_suggestions (kind, campaign_id, title, status, decided_by, decided_at) values
  ('tracking', '120252323303340228', 'راجع التتبع', 'rejected', '00000000-0000-4000-8000-0000000053a1', now());
do $$ begin
  begin
    insert into public.mkt_suggestions (kind, campaign_id, title) values ('stop', '120251977233530228', 'تاني');
    raise exception 'case one open suggestion a kind and campaign failed';
  exception when unique_violation then null; end;
  -- the same kind × campaign is fine once the first is decided
  insert into public.mkt_suggestions (kind, campaign_id, title) values ('tracking', '120252323303340228', 'تاني');
end $$;

-- the rules: the defaults, then the admin's settings row over them
do $$ begin
  if (select public.mkt_buyer_rules()) <> '{"dailyCap": 5000, "maxCpa": 450, "autoStop": 1500, "autoStopMode": "suggest", "reportHour": 9, "live": false}'::jsonb then
    raise exception 'case the default rules failed: %', public.mkt_buyer_rules();
  end if;
end $$;
insert into public.settings (section, data) values ('marketing', '{"autopublish": false, "buyer": {"dailyCap": 8000, "live": true}}')
  on conflict (section) do update set data = public.settings.data || excluded.data;
do $$ begin
  if (select public.mkt_buyer_rules() ->> 'dailyCap') <> '8000' or (select public.mkt_buyer_rules() ->> 'live') <> 'true' or (select public.mkt_buyer_rules() ->> 'maxCpa') <> '450' then
    raise exception 'case the settings row over the defaults failed: %', public.mkt_buyer_rules();
  end if;
end $$;

set local role authenticated;
-- ops (marketing F/F): reads the suggestions, never writes them; adds a designer request and edits its own text while new;
-- cannot change a status; reads the rules
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000053a2","role":"authenticated"}', true);
do $$
declare rid bigint;
begin
  if (select count(*) from public.mkt_suggestions) <> 4 or (select count(*) from public.mkt_suggestions where status = 'pending') <> 3 then raise exception 'case ops reads the suggestions failed'; end if;
  begin insert into public.mkt_suggestions (kind, campaign_id, title) values ('stop', '1', 'x'); raise exception 'case a member writes a suggestion failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_suggestions set status = 'approved' where kind = 'stop'; raise exception 'case a member decides on a suggestion failed';
  exception when insufficient_privilege then null; end;
  insert into public.mkt_requests (kind, title, details, project) values ('designer', 'فيديو للمخدة', '15 ثانية 9:16', null) returning id into rid;
  if (select (created_by, status) from public.mkt_requests where id = rid) is distinct from ('00000000-0000-4000-8000-0000000053a2'::uuid, 'جديد'::text) then raise exception 'case the request''s author and status are the server''s failed'; end if;
  update public.mkt_requests set title = 'فيديو للمخدة — 9:16' where id = rid;
  if (select title from public.mkt_requests where id = rid) <> 'فيديو للمخدة — 9:16' then raise exception 'case the author edits a new request failed'; end if;
  begin update public.mkt_requests set status = 'خلص' where id = rid; raise exception 'case a member changes a request status failed';
  exception when insufficient_privilege then null; end;
  if (select public.mkt_buyer_rules() ->> 'dailyCap') <> '8000' then raise exception 'case a member reads the rules failed'; end if;
  insert into public.mkt_requests (kind, title) values ('dev', 'صفحة هبوط');
end $$;

-- the admin: changes a status (done_at set, then cleared), edits any text
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000053a1","role":"authenticated"}', true);
do $$
declare rid bigint;
begin
  select id into rid from public.mkt_requests where kind = 'dev';
  update public.mkt_requests set status = 'بيتعمل' where id = rid;
  update public.mkt_requests set status = 'خلص' where id = rid;
  if (select done_at from public.mkt_requests where id = rid) is null then raise exception 'case done_at on خلص failed'; end if;
  update public.mkt_requests set status = 'جاهز للمراجعة', title = 'صفحة هبوط — رمضان' where id = rid;
  if (select (done_at, title, updated_by) from public.mkt_requests where id = rid) is distinct from (null::timestamptz, 'صفحة هبوط — رمضان'::text, '00000000-0000-4000-8000-0000000053a1'::uuid) then raise exception 'case the admin edits a request failed'; end if;
  begin update public.mkt_requests set created_by = '00000000-0000-4000-8000-0000000053a1' where id = rid; raise exception 'case the author never changes failed';
  exception when insufficient_privilege then null; end;
end $$;

-- view-only (marketing.view F, create N): reads, cannot add a request nor edit one
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000053a4","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_requests) <> 2 then raise exception 'case view-only reads the requests failed'; end if;
  begin insert into public.mkt_requests (kind, title) values ('dev', 'x'); raise exception 'case view-only adds a request failed';
  exception when insufficient_privilege then null; end;
  update public.mkt_requests set title = 'y' where kind = 'designer';
  if (select count(*) from public.mkt_requests where title = 'y') <> 0 then raise exception 'case view-only edits another''s request failed'; end if;
end $$;

-- cs (marketing N): nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000053a3","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.mkt_suggestions) <> 0 or (select count(*) from public.mkt_requests) <> 0 then raise exception 'case cs sees nothing failed'; end if;
end $$;

-- anon: nothing
set local role anon;
do $$ begin
  begin perform count(*) from public.mkt_suggestions; raise exception 'case anon on mkt_suggestions failed';
  exception when insufficient_privilege then null; end;
  begin perform public.mkt_buyer_rules(); raise exception 'case anon on mkt_buyer_rules failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_marketing_buyer: ok'; end $$;
rollback;
