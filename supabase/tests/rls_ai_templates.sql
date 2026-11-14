-- Tests for 0100_ai_templates_public (owner batch 2 decisions 14 and 15): settings_public hands every active member the instruction
-- templates (id, name, text) and nothing else of the row «ai_rules». One transaction, rolled back; NOTICE 'rls_ai_templates: ok'.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000100a1', 'tpl-ops.dev@ibtekr.local', '01000100a01');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000100a1', 'عمليات القوالب', 'tpl-ops.dev@ibtekr.local', '01000100a01', 'ops', 'active', '{}');
delete from public.settings where section = 'ai_rules';
insert into public.settings (section, data) values ('ai_rules', jsonb_build_object('style', 'سر الستايل', 'patImg', 'data:image/png;base64,AAAA',
  'sections', jsonb_build_object(
    'img', jsonb_build_array(jsonb_build_object('id', 'post', 'name', 'البوست', 'prompt', 'خلفية بألوان إبتكر', 'size', '1080 × 1080', 'no', jsonb_build_array('نص')),
                             jsonb_build_object('id', 'c1', 'name', 'الستوري', 'prompt', repeat('ا', 1500)), jsonb_build_object('name', 'من غير id')),
    'vid', jsonb_build_array(jsonb_build_object('id', 'post', 'name', 'الريلز', 'prompt', 'hook في أول ثانيتين')),
    'other', jsonb_build_array(jsonb_build_object('id', 'x', 'name', 'مش نوع')))));

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000100a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ declare t jsonb := public.settings_public() -> 'aiTemplates'; begin
  if jsonb_array_length(t -> 'img') <> 2 then raise exception 'case the img templates with an id failed: %', t -> 'img'; end if;
  if (t -> 'img' -> 0) <> jsonb_build_object('id', 'post', 'name', 'البوست', 'prompt', 'خلفية بألوان إبتكر') then raise exception 'case id / name / text only failed'; end if;
  if char_length(t -> 'img' -> 1 ->> 'prompt') <> 1200 then raise exception 'case the text is cut at 1200 failed'; end if;
  if t ? 'other' then raise exception 'case only img / vid / txt failed'; end if;
  if (t -> 'vid' -> 0 ->> 'name') <> 'الريلز' then raise exception 'case the video templates failed'; end if;
  if position('سر الستايل' in public.settings_public()::text) > 0 or position('base64' in public.settings_public()::text) > 0 then raise exception 'case nothing else of ai_rules failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_ai_templates: ok'; end $$;
rollback;
