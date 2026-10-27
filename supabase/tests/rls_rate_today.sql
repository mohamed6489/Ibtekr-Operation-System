-- RLS / permission tests for 0015_rate_today (vendor_rate_set / vendor_category_rate_set: the rate and the category
-- commission set without an effective date — today in Cairo, a same-day change replaces the day's row).
-- Depends on 0001_identity … 0015_rate_today.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_rate_today: ok' only if every case passed.
-- Live-safe: every count is scoped to the rows this file writes. Every name, phone and figure is made up.

begin;

-- Test users (fixed UUIDs …91–…94): admin, a member with sensitive.commission = F by custom_perms (accounts role),
-- ops (commission N), a suspended admin-like viewer.
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000091', 'rt-admin.dev@ibtekr.local', '01000000091'),
  ('00000000-0000-4000-8000-000000000092', 'rt-acc.dev@ibtekr.local',   '01000000092'),
  ('00000000-0000-4000-8000-000000000093', 'rt-ops.dev@ibtekr.local',   '01000000093'),
  ('00000000-0000-4000-8000-000000000094', 'rt-susp.dev@ibtekr.local',  '01000000094');

insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000092',
               '00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000094');

insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000091', 'أدمن النسبة',   'rt-admin.dev@ibtekr.local', '01000000091', 'admin',    'active',    '{}'),
  ('00000000-0000-4000-8000-000000000092', 'حسابات النسبة', 'rt-acc.dev@ibtekr.local',   '01000000092', 'accounts', 'active',    '{"sensitive.commission":"F"}'),
  ('00000000-0000-4000-8000-000000000093', 'عمليات النسبة', 'rt-ops.dev@ibtekr.local',   '01000000093', 'ops',      'active',    '{}'),
  ('00000000-0000-4000-8000-000000000094', 'موقوف النسبة',  'rt-susp.dev@ibtekr.local',  '01000000094', 'admin',    'suspended', '{}');

insert into public.vendors (id, woo_vendor_id, name, status) values
  ('00000000-0000-4000-8000-0000000000e1', 9951, 'ورشة النسبة', 'active');
insert into public.vendor_rates (vendor_id, rate, since, set_by) values
  ('00000000-0000-4000-8000-0000000000e1', 30, '2026-01-01', 'الموقع');

-- ================================================================ admin: today's row, then a same-day replace

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000091","role":"authenticated"}';
do $$ declare d date; t constant date := (now() at time zone 'Africa/Cairo')::date; begin
  d := public.vendor_rate_set('00000000-0000-4000-8000-0000000000e1', 40, null);
  if d <> t then raise exception 'case admin vendor_rate_set returns today (Cairo) failed: %', d; end if;
  d := public.vendor_rate_set('00000000-0000-4000-8000-0000000000e1', 45, 2);
  if not ((select count(*) from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1') = 2
          and (select rate || '/' || flat || '/' || set_by from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1' and since = t) = '45.00/2.00/أدمن النسبة') then
    raise exception 'case admin: a second change the same day replaces the day''s row (rate, flat, set_by from the profile) failed';
  end if;
  d := public.vendor_category_rate_set('00000000-0000-4000-8000-0000000000e1', 77, 20, null);
  d := public.vendor_category_rate_set('00000000-0000-4000-8000-0000000000e1', 77, null, null);
  if not ((select count(*) from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1') = 1
          and (select rate from public.vendor_category_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1' and woo_category_id = 77) is null) then
    raise exception 'case admin: the category rate set then removed the same day is one row with rate null failed';
  end if;
end $$;

-- refusals: range, flat, category id, unknown maker
do $$ declare stmt text; code text; begin
  for stmt, code in values
    ('select public.vendor_rate_set(''00000000-0000-4000-8000-0000000000e1'', 70, null)', '22023'),
    ('select public.vendor_rate_set(''00000000-0000-4000-8000-0000000000e1'', null, null)', '22023'),
    ('select public.vendor_rate_set(''00000000-0000-4000-8000-0000000000e1'', 30, -1)', '22023'),
    ('select public.vendor_rate_set(''00000000-0000-4000-8000-0000000000ff'', 30, null)', 'P0002'),
    ('select public.vendor_category_rate_set(''00000000-0000-4000-8000-0000000000e1'', 0, 10, null)', '22023'),
    ('select public.vendor_category_rate_set(''00000000-0000-4000-8000-0000000000e1'', 77, 66, null)', '22023'),
    ('select public.vendor_category_rate_set(''00000000-0000-4000-8000-0000000000ff'', 77, 10, null)', 'P0002')
  loop
    begin
      execute stmt;
      raise exception 'case admin must error failed: %', stmt;
    exception when others then
      if sqlstate <> code then raise exception 'case admin: expected % got % (%) for %', code, sqlstate, sqlerrm, stmt; end if;
    end;
  end loop;
end $$;

-- ================================================================ a member with sensitive.commission = F (custom_perms)

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000092","role":"authenticated"}';
do $$ begin
  perform public.vendor_rate_set('00000000-0000-4000-8000-0000000000e1', 35, null);
  if not ((select set_by || '/' || rate from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1'
           and since = (now() at time zone 'Africa/Cairo')::date) = 'حسابات النسبة/35.00') then
    raise exception 'case commission F: sets the rate under its own name failed';
  end if;
  -- the tables stay add-only for the members: no update grant
  begin
    update public.vendor_rates set rate = 1 where vendor_id = '00000000-0000-4000-8000-0000000000e1';
    raise exception 'case commission F: a direct update of vendor_rates must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ ops (commission N), suspended: 42501; anon: no execute

reset role;
set local role authenticated;
do $$ declare who text; begin
  foreach who in array array['93', '94'] loop
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000' || who || '","role":"authenticated"}', true);
    begin
      perform public.vendor_rate_set('00000000-0000-4000-8000-0000000000e1', 10, null);
      raise exception 'case user …% vendor_rate_set must error failed', who;
    exception when others then
      if sqlstate <> '42501' then raise exception 'case user …%: expected 42501, got % (%)', who, sqlstate, sqlerrm; end if;
    end;
    begin
      perform public.vendor_category_rate_set('00000000-0000-4000-8000-0000000000e1', 77, 10, null);
      raise exception 'case user …% vendor_category_rate_set must error failed', who;
    exception when others then
      if sqlstate <> '42501' then raise exception 'case user …% (category): expected 42501, got % (%)', who, sqlstate, sqlerrm; end if;
    end;
  end loop;
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.vendor_rate_set('00000000-0000-4000-8000-0000000000e1', 10, null);
    raise exception 'case anon vendor_rate_set must error failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ runner: the copy of the rate in force

reset role;
set local request.jwt.claims = '';
do $$ begin
  if not ((select commission_pct from public.vendors where id = '00000000-0000-4000-8000-0000000000e1') = 35
          and (select count(*) from public.vendor_rates where vendor_id = '00000000-0000-4000-8000-0000000000e1') = 2) then
    raise exception 'case vendors.commission_pct follows the same-day replace (35) and the history keeps two rows failed';
  end if;
end $$;

rollback;

do $$ begin raise notice 'rls_rate_today: ok'; end $$;
