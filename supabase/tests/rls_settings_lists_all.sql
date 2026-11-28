-- Tests for 0174_settings_lists_all (docs/superpowers/plans/2026-11-28-settings-lists-2.md): settings_public() hands every active member
-- the new keys of the «lists» row — csTags, invRemove, materials, groups — and still the old ones; never anon. Runs in one
-- transaction and rolls back; prints NOTICE 'rls_settings_lists_all: ok' only if every case passed. Live-safe: names «… 0174 تجريبي».

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000174a1', 'sl174.dev@ibtekr.local', '01000174a01');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.id = '00000000-0000-4000-8000-0000000174a1';
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000174a1', 'عضو 0174 تجريبي', 'sl174.dev@ibtekr.local', '01000174a01', 'viewer', 'active');

insert into public.settings (section, data) values ('lists', '{}'::jsonb) on conflict (section) do nothing;
update public.settings set data = data || '{"csTags":["تاج 0174 تجريبي"],"invRemove":["سبب 0174 تجريبي"],"materials":[["Oak 0174","بلوط 0174"]],"groups":{"cs":"العملاء 0174 تجريبي"},"labels":{"mood":{"متضايق":"زعلان 0174"}}}'::jsonb
 where section = 'lists';

do $$ begin
  if has_function_privilege('anon', 'public.settings_public()', 'EXECUTE') then raise exception 'case settings_public never anon failed'; end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000174a1","role":"authenticated"}';
do $$ declare l jsonb := public.settings_public() -> 'lists'; begin
  if not ((l -> 'csTags') ? 'تاج 0174 تجريبي') then raise exception 'case csTags failed'; end if;
  if not ((l -> 'invRemove') ? 'سبب 0174 تجريبي') then raise exception 'case invRemove failed'; end if;
  if (l -> 'materials' -> 0 ->> 1) <> 'بلوط 0174' then raise exception 'case materials failed'; end if;
  if (l -> 'groups' ->> 'cs') <> 'العملاء 0174 تجريبي' then raise exception 'case groups failed'; end if;
  if (l -> 'labels' -> 'mood' ->> 'متضايق') <> 'زعلان 0174' then raise exception 'case the labels still ride failed'; end if;
  raise notice 'rls_settings_lists_all: ok';
end $$;

rollback;
