-- RLS / permission tests for 0016_commission_type (vendor_rates.commission_type and vendor_commission_set — the whole
-- commission of a maker in one call: the type, the default rate / flat, the hand-set category figures).
-- Depends on 0001_identity … 0016_commission_type.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_commission_type: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes. Every name, phone and figure is made up.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000000a1', 'ct-admin.dev@ibtekr.local', '010000000a1'),
  ('00000000-0000-4000-8000-0000000000a2', 'ct-acc.dev@ibtekr.local',   '010000000a2'),
  ('00000000-0000-4000-8000-0000000000a3', 'ct-ops.dev@ibtekr.local',   '010000000a3');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000000a1', 'أدمن العمولة',   'ct-admin.dev@ibtekr.local', '010000000a1', 'admin',    'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a2', 'حسابات العمولة', 'ct-acc.dev@ibtekr.local',   '010000000a2', 'accounts', 'active', '{"sensitive.commission":"F"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'عمليات العمولة', 'ct-ops.dev@ibtekr.local',   '010000000a3', 'ops',      'active', '{}');

insert into public.vendors (id, woo_vendor_id, name, status) values
  ('00000000-0000-4000-8000-0000000000d1', 9961, 'ورشة العمولة', 'active');
insert into public.vendor_rates (vendor_id, rate, since, set_by) values
  ('00000000-0000-4000-8000-0000000000d1', 30, '2026-01-01', 'الموقع');

-- ================================================================ runner: the column

do $$ begin
  if not ((select data_type || ':' || is_nullable || ':' || column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'vendor_rates' and column_name = 'commission_type') = 'text:NO:''fixed''::text'
          and (select commission_type from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 'fixed') then
    raise exception 'case vendor_rates.commission_type (text, not null, default fixed) failed';
  end if;
  begin
    insert into public.vendor_rates (vendor_id, rate, since, commission_type) values ('00000000-0000-4000-8000-0000000000d1', 30, '2026-01-02', 'brand');
    raise exception 'case commission_type check must error failed';
  exception when check_violation then null;
  end;
end $$;

-- ================================================================ admin: category_based with hand-set figures, then a same-day change

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
do $$ declare d date; t constant date := (now() at time zone 'Africa/Cairo')::date; begin
  d := public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'category_based', 40, null,
         '[{"id": 9001, "rate": 35, "flat": 0}, {"id": 9002, "rate": 20, "flat": 5}]');
  if d <> t then raise exception 'case admin returns today (Cairo) failed: %', d; end if;
  if not ((select commission_type || '/' || rate || '/' || set_by from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1' and since = t) = 'category_based/40.00/أدمن العمولة'
          and (select count(*) from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 2) then
    raise exception 'case admin: the type, the default and two hand-set categories written failed';
  end if;
  -- the same day again: 9002 back to inheriting (null), 9003 set, the type back to fixed — replaced, not added
  perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'fixed', 45, 3, '[{"id": 9002, "rate": null, "flat": null}, {"id": 9003, "rate": 50}]');
  if not ((select count(*) from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 2
          and (select commission_type || '/' || rate || '/' || flat from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1' and since = t) = 'fixed/45.00/3.00'
          and (select count(*) from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 3
          and (select rate from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1' and woo_category_id = 9002) is null) then
    raise exception 'case admin: a same-day change replaces the rows (type, rate, flat; a category back to null) failed';
  end if;
  -- vendor_rate_set keeps the type of the day
  perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'category_based', 45, 3, '[]');
  perform public.vendor_rate_set('00000000-0000-4000-8000-0000000000d1', 41, null);
  if not ((select commission_type || '/' || rate from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1' and since = t) = 'category_based/41.00') then
    raise exception 'case vendor_rate_set keeps the type failed';
  end if;
end $$;

-- refusals before any write
do $$ declare stmt text; begin
  foreach stmt in array array[
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''percentage'', 30, null, ''[]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''fixed'', 66, null, ''[]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''fixed'', 30, -1, ''[]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''{"id": 1}'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": 0, "rate": 10}]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": 1.5, "rate": 10}]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": "x", "rate": 10}]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": 9001, "rate": 70}]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": 9001, "rate": "10"}]'')',
    'select public.vendor_commission_set(''00000000-0000-4000-8000-0000000000d1'', ''category_based'', 30, null, ''[{"id": 9001, "rate": 10, "flat": -2}]'')'
  ] loop
    begin
      execute stmt;
      raise exception 'case admin must error failed: %', stmt;
    exception when others then
      if sqlstate <> '22023' then raise exception 'case admin: expected 22023 got % (%) for %', sqlstate, sqlerrm, stmt; end if;
    end;
  end loop;
  begin
    perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000ff', 'fixed', 30, null, '[]');
    raise exception 'case unknown maker must error failed';
  exception when others then
    if sqlstate <> 'P0002' then raise exception 'case unknown maker: expected P0002 got %', sqlstate; end if;
  end;
end $$;

-- ================================================================ commission F by custom_perms: allowed; ops: 42501; anon: no execute

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'fixed', 33, null, '[]');
  if not ((select set_by from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1' and since = (now() at time zone 'Africa/Cairo')::date) = 'حسابات العمولة') then
    raise exception 'case commission F: writes under its own name failed';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
do $$ begin
  begin
    perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'fixed', 10, null, '[]');
    raise exception 'case ops must error failed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'case ops: expected 42501 got % (%)', sqlstate, sqlerrm; end if;
  end;
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.vendor_commission_set('00000000-0000-4000-8000-0000000000d1', 'fixed', 10, null, '[]');
    raise exception 'case anon must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ runner: the copy and the counts

reset role;
set local request.jwt.claims = '';
do $$ begin
  if not ((select commission_pct from public.vendors where id = '00000000-0000-4000-8000-0000000000d1') = 33
          and (select count(*) from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 2
          and (select count(*) from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000d1') = 3) then
    raise exception 'case commission_pct = 33 and the history counts (2 rates, 3 category rows) failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_commission_type: ok'; end $$;
