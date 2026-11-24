-- Tests for 0158 (the media buyer's brain — docs/superpowers/plans/2026-11-24-buyer-brain.md): the buyer's skills are there once, for
-- the buyer only; a competitor's research brief is the server's to write — a member who keeps the competitors (marketing.create F)
-- reads it with the row and edits its note, never the brief. Depends on 0001 … 0158. One transaction, rolled back; NOTICE
-- 'rls_buyer_brain: ok' only if every case passed. Live-safe: made-up rows far from the live ids.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-000000158a01', 'buyer-brain.dev@ibtekr.local', '0100158a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-000000158a01', 'ميديا باير التجربة', 'buyer-brain.dev@ibtekr.local', '0100158a01', 'ops', 'active', '{"marketing.view":"F","marketing.create":"F"}');
insert into public.mkt_competitors (name, keyword, note, created_by, brief, brief_at)
values ('منافس التجربة 158', 'ماكرامية', 'إعلان الريل شغال من شهرين', '00000000-0000-4000-8000-000000158a01',
        '{"text":"بيركز على الهدايا","sources":[{"url":"https://example.com/a","title":"a"}]}', now());

do $$ begin
  if (select count(*) from public.ai_agent_kb where kind = 'skills' and 'buyer' = any(agents) and title in
      ('حساب بسيط مجمّع', 'التعلّم والتعديلات', 'إمتى أكبّر وإمتى أوقف', 'اختبار الكريتيف', 'الكريتيف اللي بيبيع', 'العائد الحقيقي قبل أرقام ميتا', 'التتبع', 'أقوى إعلانات المنافس')) <> 8
    then raise exception 'case the buyer''s eight skills failed'; end if;
  if exists (select 1 from public.ai_agent_kb where kind = 'skills' and title = 'اختبار الكريتيف' and agents <> array['buyer']) then raise exception 'case the skills are the buyer''s only failed'; end if;
  if (select count(*) from public.ai_agent_kb where kind = 'skills' and title = 'حساب بسيط مجمّع') <> 1 then raise exception 'case added once failed'; end if;
  begin update public.mkt_competitors set brief = '[]' where name = 'منافس التجربة 158'; raise exception 'case the brief is an object failed';
  exception when check_violation then null; end;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000158a01","role":"authenticated"}';
do $$ begin
  if (select brief->>'text' from public.mkt_competitors where name = 'منافس التجربة 158') is distinct from 'بيركز على الهدايا' then raise exception 'case a member reads the brief failed'; end if;
  update public.mkt_competitors set note = 'إعلانين شغالين من شهرين' where name = 'منافس التجربة 158';
  if (select note from public.mkt_competitors where name = 'منافس التجربة 158') is distinct from 'إعلانين شغالين من شهرين' then raise exception 'case the member edits the note failed'; end if;
  begin update public.mkt_competitors set brief = '{"text":"مزوّر"}' where name = 'منافس التجربة 158'; raise exception 'case only the server writes the brief failed';
  exception when insufficient_privilege then null; end;
  begin update public.mkt_competitors set brief_at = now() where name = 'منافس التجربة 158'; raise exception 'case only the server writes brief_at failed';
  exception when insufficient_privilege then null; end;
end $$;

do $$ begin raise notice 'rls_buyer_brain: ok'; end $$;
rollback;
