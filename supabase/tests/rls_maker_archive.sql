-- Tests for 0112_maker_store_archive (the owner 16 Nov — the store's failure on the row, an archived maker). One transaction, rolled
-- back; NOTICE 'rls_maker_archive: ok' only if every case passed. Live-safe: a made-up maker and member.
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000112a1', 'ma-adm.dev@ibtekr.local');
insert into public.profiles (id, name, email, role_id, status) values ('00000000-0000-4000-8000-0000000112a1', 'أدمن الأرشيف', 'ma-adm.dev@ibtekr.local', 'admin', 'active');
insert into public.vendors (id, name, phone, status) values ('00000000-0000-4000-8000-0000000112b1', 'مبتكر أرشيف الاختبار', '01000112001', 'active');

do $$ begin
  if not has_column_privilege('authenticated', 'public.vendors', 'store_error', 'SELECT') or has_column_privilege('authenticated', 'public.vendors', 'store_error', 'UPDATE')
     or has_column_privilege('authenticated', 'public.vendors', 'archived_at', 'UPDATE') then
    raise exception 'case the column grants failed';
  end if;
end $$;

-- the server writes them; a member edits a live maker as before
update public.vendors set store_error = 'shop_url_taken', store_try_at = now() where id = '00000000-0000-4000-8000-0000000112b1';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000112a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
update public.vendors set address = 'عنوان قبل الأرشيف' where id = '00000000-0000-4000-8000-0000000112b1';
reset role;

-- archived (the server): no member writes it any more, the server still does
update public.vendors set archived_at = now(), archive_reason = 'اختبار', status = 'inactive' where id = '00000000-0000-4000-8000-0000000112b1';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000112a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ begin
  begin
    update public.vendors set address = 'بعد الأرشيف' where id = '00000000-0000-4000-8000-0000000112b1';
    raise exception 'case an archived maker refused a member failed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
update public.vendors set store_error = null where id = '00000000-0000-4000-8000-0000000112b1';
do $$ begin
  if (select address from public.vendors where id = '00000000-0000-4000-8000-0000000112b1') <> 'عنوان قبل الأرشيف' then raise exception 'case the member edit before failed'; end if;
end $$;

do $$ begin raise notice 'rls_maker_archive: ok'; end $$;
rollback;
