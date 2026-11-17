-- RLS tests for 0123_public_image_provider (the owner 17 Nov — the Magnific buttons follow the image provider): settings_public hands
-- every active member the image provider per tool — the known ids only, the default where a tool has none, Magnific as shipped — and
-- nothing else of the row «ai». One transaction rolled back; prints NOTICE 'rls_public_image_provider: ok'. Live-safe.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000123a1', 'pip-ops.dev@ibtekr.local', '01000123a01');
insert into public.profiles (id, name, email, phone, role_id, status) values
  ('00000000-0000-4000-8000-0000000123a1', 'محتوى المزوّد', 'pip-ops.dev@ibtekr.local', '01000123a01', 'ops', 'active');

create temp table pip_saved on commit drop as select data from public.settings where section = 'ai';
delete from public.settings where section = 'ai';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000123a1","role":"authenticated"}';
do $$
declare d jsonb := public.settings_public() -> 'ai' -> 'image';
begin
  -- no row: Magnific everywhere (as shipped)
  if d ->> 'default' <> 'magnific' or d -> 'tools' <> '{"studio":"magnific","campaign":"magnific","tool":"magnific"}'::jsonb then raise exception 'case shipped Magnific failed: %', d; end if;
end $$;

reset role;
insert into public.settings (section, data) values ('ai', '{"model":"claude-opus-5-5","monthly_limit_usd":50,"providers":{"image":{"default":"gemini","tools":{"campaign":"openai","tool":"evil<script>"},"models":{"gemini":"x"}}}}'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000123a1","role":"authenticated"}';
do $$
declare p jsonb := public.settings_public(); d jsonb := p -> 'ai' -> 'image';
begin
  if d ->> 'default' <> 'gemini' then raise exception 'case the default failed: %', d; end if;
  if d -> 'tools' <> '{"studio":"gemini","campaign":"openai","tool":"gemini"}'::jsonb then raise exception 'case the tools (an unknown id = the default) failed: %', d; end if;
  if (p -> 'ai') ? 'model' or (p -> 'ai' -> 'image') ? 'models' or p::text like '%monthly_limit%' or p::text like '%evil%' then raise exception 'case nothing else of the row failed'; end if;
end $$;

reset role;
do $$ begin raise notice 'rls_public_image_provider: ok'; end $$;
rollback;
