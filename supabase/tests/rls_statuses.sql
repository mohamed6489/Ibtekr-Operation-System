-- Tests for 0095_statuses_editable (docs/superpowers/plans/2026-11-14-owner-batch-2.md decision 22): an added order status «بتتحسب زي»
-- its base (orders.status keeps the base, orders.status_custom the added one), the admin RPCs, the guards, and the added confirmation /
-- product statuses from the settings row «lists». One transaction, rolled back; NOTICE 'rls_statuses: ok' only if every case passed.
-- Live-safe: a made-up order (99_095_…), made-up members and statuses; the settings row «lists» is restored by the rollback.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000095a1', 'st-admin.dev@ibtekr.local', '010000095a1'),
  ('00000000-0000-4000-8000-0000000095a2', 'st-ops.dev@ibtekr.local', '010000095a2'),
  ('00000000-0000-4000-8000-0000000095a3', 'st-view.dev@ibtekr.local', '010000095a3');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000095a1', 'أدمن الحالات', 'st-admin.dev@ibtekr.local', '010000095a1', 'admin', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000095a2', 'عمليات الحالات', 'st-ops.dev@ibtekr.local', '010000095a2', 'ops', 'active', '{"orders.view":"F","orders.status":"F"}'),
  ('00000000-0000-4000-8000-0000000095a3', 'مشاهد الحالات', 'st-view.dev@ibtekr.local', '010000095a3', 'viewer', 'active', '{"orders.view":"F","orders.status":"N"}');
insert into public.orders (id, number, customer_name, customer_phone, status, woo_status, total, placed_at) values
  (99095001, '99095001', 'عميل الحالات', '01000095001', 'جاري التنفيذ', 'processing', 500, '2026-11-14T10:00:00Z');
insert into public.order_items (id, order_id, name, qty, total, removed, status) values (99095101, 99095001, 'منتج', 1, 500, false, 'مؤكد');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;

-- grants: the helpers closed to anon; the guard functions closed to members
do $$ begin
  if has_function_privilege('anon', 'public.order_status_add(text, text, text)', 'EXECUTE') or has_function_privilege('anon', 'public.status_base(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.status_map_guard()', 'EXECUTE') or has_function_privilege('authenticated', 'public.orders_status_custom()', 'EXECUTE') then
    raise exception 'case the functions are closed failed';
  end if;
end $$;

-- the admin adds «متابعة» (counts as «جاري التنفيذ», no slug of its own); ops cannot; a duplicate / a wrong base is refused
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a2');
do $$ begin
  begin perform public.order_status_add('ممنوع', 'جاري التنفيذ', null); raise exception 'case only the admin adds a status failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a1');
do $$ begin
  perform public.order_status_add('متابعة', 'جاري التنفيذ', null);
  if (select base from public.status_map where system_status = 'متابعة') <> 'جاري التنفيذ' then raise exception 'case the added status keeps its base failed'; end if;
  if public.status_base('متابعة') <> 'جاري التنفيذ' or public.status_base('مكتمل') <> 'مكتمل' then raise exception 'case status_base failed'; end if;
  begin perform public.order_status_add('متابعة', 'جاري التنفيذ', null); raise exception 'case a duplicate name is refused failed'; exception when unique_violation then null; end;
  begin perform public.order_status_add('حالة غلط', 'مش موجودة', null); raise exception 'case a wrong base is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.order_status_add('حالة "x"', 'جاري التنفيذ', null); raise exception 'case a name with a quote is refused failed'; exception when check_violation then null; end;
  begin perform public.order_status_add('حالة & x', 'جاري التنفيذ', null); raise exception 'case a name with & is refused failed'; exception when check_violation then null; end;
  begin perform public.order_status_slug('متابعة', 'Bad Slug'); raise exception 'case a bad slug is refused failed'; exception when check_violation then null; end;
  perform public.order_status_slug('متابعة', 'follow-up');
  perform public.order_status_add('اتسلّم', 'مكتمل', null);
  if (select woo_status from public.status_map where system_status = 'متابعة') <> 'follow-up' then raise exception 'case the slug is set failed'; end if;
  -- a base row is never renamed nor deleted
  begin update public.status_map set system_status = 'مكتمل جدًا' where system_status = 'مكتمل'; raise exception 'case a base status is not renamed failed'; exception when invalid_parameter_value then null; end;
  begin perform public.order_status_delete('مكتمل'); raise exception 'case a base status is not deleted failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ops puts the order in «متابعة»: the base stays in status; a mismatched base is refused; the viewer cannot
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a2');
do $$ begin
  update public.orders set status_custom = 'متابعة' where id = 99095001;
  if (select status_custom from public.orders where id = 99095001) <> 'متابعة' or (select status from public.orders where id = 99095001) <> 'جاري التنفيذ' then raise exception 'case the order takes the added status failed'; end if;
  begin update public.orders set status_custom = 'اتسلّم' where id = 99095001; raise exception 'case a mismatched base is refused failed'; exception when check_violation then null; end;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a3');
do $$ begin
  begin update public.orders set status_custom = null where id = 99095001; raise exception 'case the viewer cannot change it failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- in use: not deleted; the base changes by itself → the added status no longer holds; then it can go
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a1');
do $$ begin
  begin perform public.order_status_delete('متابعة'); raise exception 'case a status in use is not deleted failed'; exception when foreign_key_violation then null; end;
end $$;
reset role;
set local role service_role;
update public.orders set status = 'قيد الشحن' where id = 99095001;
reset role;
do $$ begin
  if (select status_custom from public.orders where id = 99095001) is not null then raise exception 'case a base change clears the added status failed'; end if;
end $$;
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a1');
do $$ declare v text[]; begin
  -- the order of the list: all of them, once
  select array_agg(system_status order by sort desc) into v from public.status_map;
  perform public.order_status_order(v);
  if (select system_status from public.status_map order by sort limit 1) <> v[1] then raise exception 'case the order is saved failed'; end if;
  begin perform public.order_status_order(v[1:2]); raise exception 'case a partial order is refused failed'; exception when invalid_parameter_value then null; end;
  perform public.order_status_delete('متابعة');
  if exists (select 1 from public.status_map where system_status = 'متابعة') then raise exception 'case an unused added status is deleted failed'; end if;
end $$;
reset role;

-- confirmation and product statuses: the base list or the admin's added ones
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a2');
do $$ begin
  begin update public.orders set confirm = 'بيفكر' where id = 99095001; raise exception 'case an unknown confirmation is refused failed'; exception when check_violation then null; end;
  begin update public.order_items set status = 'في التغليف' where id = 99095101; raise exception 'case an unknown product status is refused failed'; exception when check_violation then null; end;
end $$;
reset role;
insert into public.settings (section, data) values ('lists', '{}') on conflict (section) do nothing;
update public.settings set data = data || '{"statusAdded":{"confirm":["بيفكر"],"sub":["في التغليف"]},"statusOrder":{"sub":["في التغليف","مؤكد"]}}' where section = 'lists';
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a2');
do $$ begin
  update public.orders set confirm = 'بيفكر' where id = 99095001;
  update public.order_items set status = 'في التغليف' where id = 99095101;
  if (select status from public.order_items where id = 99095101) <> 'في التغليف' then raise exception 'case an added product status is accepted failed'; end if;
  if (public.settings_public() -> 'lists' -> 'statusAdded' -> 'sub') <> '["في التغليف"]'::jsonb then raise exception 'case settings_public hands the added statuses failed'; end if;
end $$;
reset role;
-- removed from the list later: the row keeps it (only a new value is checked)
update public.settings set data = data - 'statusAdded' where section = 'lists';
select pg_temp.as_member('00000000-0000-4000-8000-0000000095a2');
do $$ begin
  update public.order_items set comment = 'ملاحظة' where id = 99095101;
  if (select status from public.order_items where id = 99095101) <> 'في التغليف' then raise exception 'case a row keeps a removed status failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_statuses: ok'; end $$;
rollback;
