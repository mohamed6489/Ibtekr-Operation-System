-- 0047: a confirmed email change in Auth moves the profile's email; a member changes their own phone (not another's, not their
-- role); a taken phone is refused (unique). Run inside a transaction and rolled back.
begin;
insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000047a1', 'pe-one.dev@ibtekr.local', '0100004701'),
  ('00000000-0000-4000-8000-0000000047a2', 'pe-two.dev@ibtekr.local', '0100004702');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000047a1', 'عضو أول', 'pe-one.dev@ibtekr.local', '01000047011', 'cs', 'active'),
  ('00000000-0000-4000-8000-0000000047a2', 'عضو تاني', 'pe-two.dev@ibtekr.local', '01000047022', 'cs', 'active');
-- Auth confirms the new address (GoTrue updates auth.users): the profile follows, lower-cased
update auth.users set email = 'PE-New.dev@ibtekr.local' where id = '00000000-0000-4000-8000-0000000047a1';
do $$
begin
  if (select email from public.profiles where id = '00000000-0000-4000-8000-0000000047a1') <> 'pe-new.dev@ibtekr.local' then
    raise exception 'case a confirmed email change moves the profile failed';
  end if;
  if (select email from public.profiles where id = '00000000-0000-4000-8000-0000000047a2') <> 'pe-two.dev@ibtekr.local' then
    raise exception 'case another profile stays failed';
  end if;
end $$;
-- the member's own phone
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000047a1","role":"authenticated"}', true);
do $$
begin
  update public.profiles set phone = '01000047099' where id = '00000000-0000-4000-8000-0000000047a1';
  if (select phone from public.profiles where id = '00000000-0000-4000-8000-0000000047a1') <> '01000047099' then raise exception 'case a member changes their own phone failed'; end if;
  begin update public.profiles set phone = '01000047022' where id = '00000000-0000-4000-8000-0000000047a1'; raise exception 'case a taken phone is refused failed';
  exception when unique_violation then null; end;
  begin update public.profiles set role_id = 'admin' where id = '00000000-0000-4000-8000-0000000047a1'; raise exception 'case a member cannot change their role failed';
  exception when insufficient_privilege then null; end;
  update public.profiles set phone = '01000047088' where id = '00000000-0000-4000-8000-0000000047a2';
end $$;
reset role;
do $$
begin
  if (select phone from public.profiles where id = '00000000-0000-4000-8000-0000000047a2') <> '01000047022' then raise exception 'case a member cannot change another''s phone failed'; end if;
  raise notice 'rls_profile_email: ok';
end $$;
rollback;
