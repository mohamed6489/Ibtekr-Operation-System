-- Tests for 0114_settings_public_clock: settings_public hands every active member the clock (12 / 24) and the date format — the known
-- values only. One transaction, rolled back; NOTICE 'rls_settings_clock: ok' only if every case passed.
begin;
insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000114a01', 'clk.dev@ibtekr.local', '0100000114a1');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-000000114a01', 'مشاهد الساعة', 'clk.dev@ibtekr.local', '0100000114a1', 'viewer', 'active', '{}', '{}');
insert into public.settings (section, data) values ('general', '{"clock":"24","dateFmt":"ymd","week":"الأحد"}')
  on conflict (section) do update set data = public.settings.data || excluded.data;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000114a01', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ declare g jsonb := public.settings_public() -> 'general'; begin
  if g ->> 'clock' <> '24' or g ->> 'dateFmt' <> 'ymd' then raise exception 'case the clock and the date format reach a member failed'; end if;
end $$;
reset role;
update public.settings set data = data || '{"clock":"13","dateFmt":"<b>"}' where section = 'general';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000114a01', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ declare g jsonb := public.settings_public() -> 'general'; begin
  if g ? 'clock' or g ? 'dateFmt' then raise exception 'case an unknown value is left out failed'; end if;
end $$;
reset role;
do $$ begin raise notice 'rls_settings_clock: ok'; end $$;
rollback;
