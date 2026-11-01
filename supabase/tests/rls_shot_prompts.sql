-- RLS / permission tests for 0030_shot_prompts (the category prompts of the Magnific flows). Depends on 0001_identity … 0030.
-- Runs in one transaction and rolls back; prints NOTICE 'rls_shot_prompts: ok' only if every case passed. Live-safe: its rows
-- (two made-up members, their prompt rows) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000000098', 'shp-a.dev@ibtekr.local', '01000000098'),
  ('00000000-0000-4000-8000-000000000099', 'shp-b.dev@ibtekr.local', '01000000099');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email)
from auth.users u where u.id in ('00000000-0000-4000-8000-000000000098', '00000000-0000-4000-8000-000000000099');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000000098', 'برومبت أ', 'shp-a.dev@ibtekr.local', '01000000098', 'viewer', 'active', '{"products.view":"F","products.add":"F"}'),
  ('00000000-0000-4000-8000-000000000099', 'برومبت ب', 'shp-b.dev@ibtekr.local', '01000000099', 'admin', 'active', '{}');

-- ================================================================ the admin writes (as a member), the checks

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
do $$ begin
  insert into public.shot_prompts (category, shot, name, prompt, model, aspect, resolution) values
    ('كرسي-اختبار', 1, 'كرسي 1 — تركيز على المنتج', 'A professional product photograph…', 'imagen-nano-banana-2', '3:4', '1k'),
    ('كرسي-اختبار', 2, 'كرسي 2 — المنتج في بيئة محيطة', 'A lifestyle photograph…', 'imagen-nano-banana-2', '3:4', '1k');
  if (select updated_by from public.shot_prompts where category = 'كرسي-اختبار' and shot = 1) <> '00000000-0000-4000-8000-000000000099' then raise exception 'case updated_by is the writer failed'; end if;
  begin
    insert into public.shot_prompts (category, shot, prompt) values ('كرسي-اختبار', 1, 'again');
    raise exception 'case one row a category and shot failed';
  exception when unique_violation then null;
  end;
  begin
    insert into public.shot_prompts (category, shot, prompt) values ('كرسي-اختبار', 4, 'x');
    raise exception 'case a shot outside 1..3 is refused failed';
  exception when check_violation then null;
  end;
  begin
    insert into public.shot_prompts (category, shot, prompt, resolution) values ('x', 3, 'x', '8k');
    raise exception 'case a resolution outside the list is refused failed';
  exception when check_violation then null;
  end;
  update public.shot_prompts set prompt = 'A better prompt' where category = 'كرسي-اختبار' and shot = 1;
  begin
    delete from public.shot_prompts where category = 'كرسي-اختبار';
    raise exception 'case the admin cannot delete failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ================================================================ member A (products.view F, not admin): reads, never writes

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000098","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.shot_prompts where category = 'كرسي-اختبار') <> 2 then raise exception 'case a member reads the prompts failed'; end if;
  begin
    insert into public.shot_prompts (category, shot, prompt) values ('مرآة-اختبار', 1, 'x');
    raise exception 'case a member cannot insert failed';
  exception when insufficient_privilege then null;
  end;
  update public.shot_prompts set prompt = 'hacked' where category = 'كرسي-اختبار';
  if (select count(*) from public.shot_prompts where prompt = 'hacked') <> 0 then raise exception 'case a member cannot update failed'; end if;
end $$;

-- ================================================================ anon: nothing

set local role anon;
do $$ begin
  begin
    perform count(*) from public.shot_prompts;
    raise exception 'case anon reads nothing failed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin raise notice 'rls_shot_prompts: ok'; end $$;
rollback;
