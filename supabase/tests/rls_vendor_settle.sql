-- RLS / permission tests for 0078_vendor_settlements (a deposit is a correction, the settled moves, acc_settle_withdrawal).
-- Depends on 0001 … 0078. Runs in one transaction and rolls back; prints NOTICE 'rls_vendor_settle: ok' only if every case passed.
-- Live-safe: every row it reads or writes belongs to the two makers it creates. Every name and number is made up.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000078e1', 'settle-ap.dev@ibtekr.local', '010000078e1'),
  ('00000000-0000-4000-8000-0000000078e2', 'settle-n.dev@ibtekr.local', '010000078e2');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-0000000078e1', '00000000-0000-4000-8000-0000000078e2');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000078e1', 'حسابات تسوية', 'settle-ap.dev@ibtekr.local', '010000078e1', 'ops', 'active', '{"accounts.view":"F","accounts.add":"F","accounts.approve":"F"}'),
  ('00000000-0000-4000-8000-0000000078e2', 'من غير حسابات', 'settle-n.dev@ibtekr.local', '010000078e2', 'ops', 'active', '{"accounts.view":"N","accounts.add":"N","accounts.approve":"N"}');

insert into public.vendors (id, name) values
  ('00000000-0000-4000-8000-0000000078a1', 'مبتكر تسوية تجريبي 0078'),
  ('00000000-0000-4000-8000-0000000078a2', 'مبتكر تصحيح تجريبي 0078');

-- ================================================================ the grants and the function's privileges

do $$ begin
  if has_table_privilege('authenticated', 'public.acc_vendor_settlements', 'INSERT') or has_table_privilege('authenticated', 'public.acc_vendor_settlements', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.acc_vendor_settlements', 'SELECT') or has_table_privilege('anon', 'public.acc_vendor_settlements', 'SELECT') then
    raise exception 'case settlements grants (members read only, anon nothing) failed';
  end if;
  if has_function_privilege('authenticated', 'public.acc_settle_withdrawal(bigint, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.acc_settle_withdrawal(bigint, text, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.acc_settle_withdrawal(bigint, text, uuid)', 'execute') then
    raise exception 'case acc_settle_withdrawal is the server''s only failed';
  end if;
end $$;

-- ================================================================ the accountant records the moves (decision 1)

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000078e1","role":"authenticated"}';
do $$ declare mid bigint; begin
  -- «سحب»: عربون 4,000 + مواصلات 1,000 (an attempt to mark it settled from the page is dropped)
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount, settled_by, settled_at)
  values ('00000000-0000-4000-8000-0000000078a1', '2001-01-05', 'withdraw', 'عربون', 4000, 77, now()) returning id into mid;
  if (select settled_by from public.acc_vendor_moves where id = mid) is not null then raise exception 'case a member cannot settle a move on insert failed'; end if;
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000078a1', '2001-01-06', 'withdraw', 'مواصلات', 1000);
  update public.acc_vendor_moves set settled_by = 77 where id = mid;
  if (select settled_by from public.acc_vendor_moves where id = mid) is not null then raise exception 'case a member cannot settle a move on update failed'; end if;
  -- «إيداع» is a correction only: «أخرى» with its title; any other kind is refused
  begin
    insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, amount) values ('00000000-0000-4000-8000-0000000078a1', '2001-01-06', 'deposit', 'عربون', 10);
    raise exception 'case a deposit is a correction (kind أخرى) failed';
  exception when check_violation then null; end;
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount, note) values ('00000000-0000-4000-8000-0000000078a2', '2001-01-07', 'deposit', 'أخرى', 'فرق مقاس مخصص', 1000, 'العميل طلب مقاس أكبر');
  -- the page never settles a request
  begin
    perform public.acc_settle_withdrawal(99978001, 'system', null);
    raise exception 'case a member cannot call acc_settle_withdrawal failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ================================================================ the server settles (decision 2)

insert into public.dokan_withdrawals (id, woo_vendor_id, vendor_id, amount, status) values
  (99978001, 99978001, '00000000-0000-4000-8000-0000000078a1', 25000, 'approved'),
  (99978002, 99978001, '00000000-0000-4000-8000-0000000078a1', 3000, 'approved'),
  (99978003, 99978001, '00000000-0000-4000-8000-0000000078a1', 500, 'pending'),
  (99978004, 99978002, '00000000-0000-4000-8000-0000000078a2', 500, 'approved');

set local role service_role;
do $$ declare s record; t record; begin
  -- the owner's example: a request of 25,000 = net 20,000 + عربون 4,000 + مواصلات 1,000 → transfer 20,000
  select * into s from public.acc_settle_withdrawal(99978001, 'system', '00000000-0000-4000-8000-0000000078e1');
  if s.moves_net <> 5000 or s.consumed <> 5000 or s.carry_in <> 0 or s.carry_out <> 0 or s.cash <> 20000 or s.moves <> 2 or s.source <> 'system' then
    raise exception 'case the owner''s example (25,000 → transfer 20,000) failed: %', row_to_json(s);
  end if;
  if exists (select 1 from public.acc_vendor_moves where vendor_id = '00000000-0000-4000-8000-0000000078a1' and settled_by is distinct from 99978001) then
    raise exception 'case the settled moves carry the request failed';
  end if;
  -- a second call is the same row
  select * into t from public.acc_settle_withdrawal(99978001, 'dokan', null);
  if t.id <> s.id or t.source <> 'system' then raise exception 'case one settlement per request failed'; end if;
  if (select count(*) from public.acc_vendor_settlements where withdraw_id = 99978001) <> 1 then raise exception 'case unique settlement failed'; end if;
  -- a request smaller than the deductions: nothing transferred, the rest stays on the maker
  insert into public.acc_vendor_moves (vendor_id, on_date, direction, kind, kind_name, amount) values ('00000000-0000-4000-8000-0000000078a1', '2001-02-01', 'withdraw', 'أخرى', 'خامات اتشرت له', 5000);
  select * into s from public.acc_settle_withdrawal(99978002, 'dokan', null);
  if s.consumed <> 3000 or s.carry_out <> 2000 or s.cash <> 0 or s.moves <> 1 then raise exception 'case a smaller request carries the rest failed: %', row_to_json(s); end if;
  -- not approved (or unknown) → refused
  begin perform public.acc_settle_withdrawal(99978003, 'dokan', null); raise exception 'case a pending request is not settled failed';
  exception when invalid_parameter_value then null; end;
  begin perform public.acc_settle_withdrawal(99978999, 'dokan', null); raise exception 'case an unknown request failed';
  exception when no_data_found then null; end;
  begin perform public.acc_settle_withdrawal(99978001, 'other', null); raise exception 'case a bad source failed';
  exception when invalid_parameter_value then null; end;
  -- a correction larger than the deductions is paid with the request: transfer 500 + 1,000
  select * into s from public.acc_settle_withdrawal(99978004, 'dokan', null);
  if s.moves_net <> -1000 or s.consumed <> -1000 or s.carry_out <> 0 or s.cash <> 1500 then raise exception 'case a credit is paid with the request failed: %', row_to_json(s); end if;
end $$;
reset role;

-- the next settlement starts from the carry
update public.dokan_withdrawals set status = 'approved', amount = 2500 where id = 99978003;
set local role service_role;
do $$ declare s record; begin
  select * into s from public.acc_settle_withdrawal(99978003, 'dokan', null);
  if s.carry_in <> 2000 or s.moves_net <> 0 or s.consumed <> 2000 or s.carry_out <> 0 or s.cash <> 500 then raise exception 'case the carry is settled next failed: %', row_to_json(s); end if;
end $$;
reset role;

-- ================================================================ a settled move is final for members; who reads the settlements

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000078e1","role":"authenticated"}';
do $$ declare mid bigint; begin
  select id into mid from public.acc_vendor_moves where vendor_id = '00000000-0000-4000-8000-0000000078a1' and kind = 'عربون';
  begin update public.acc_vendor_moves set amount = 1 where id = mid; raise exception 'case a settled move cannot be edited failed';
  exception when insufficient_privilege then null; end;
  begin update public.acc_vendor_moves set voided_at = now() where id = mid; raise exception 'case a settled move cannot be voided failed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.acc_vendor_settlements where vendor_id in ('00000000-0000-4000-8000-0000000078a1', '00000000-0000-4000-8000-0000000078a2')) <> 4 then
    raise exception 'case accounts.view reads the settlements failed';
  end if;
  begin insert into public.acc_vendor_settlements (withdraw_id, vendor_id, amount, consumed, cash, source, settled_on) values (99978099, '00000000-0000-4000-8000-0000000078a1', 1, 0, 1, 'system', '2001-01-01');
    raise exception 'case members cannot write a settlement failed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000078e2","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.acc_vendor_settlements where vendor_id = '00000000-0000-4000-8000-0000000078a1') <> 0 then
    raise exception 'case accounts.view = N reads no settlement failed';
  end if;
  raise notice 'rls_vendor_settle: ok';
end $$;
reset role;

rollback;
