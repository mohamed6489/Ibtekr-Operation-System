-- Tests for 0106_settings_public_fake (docs/superpowers/plans/2026-11-15-fake-discount.md decision 2): settings_public hands every
-- active member the default fake-discount tiers of the row «makers» — the tiers only — beside the delay rules, and the templates of
-- 0100 are still there. One transaction, rolled back; NOTICE 'rls_fake_discount: ok'. Live-safe: the row is put back by the rollback.

begin;

insert into auth.users (id, email, phone) values ('00000000-0000-4000-8000-0000000106a1', 'fake-ops.dev@ibtekr.local', '01000001061');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000106a1', 'عمليات الخصم', 'fake-ops.dev@ibtekr.local', '01000001061', 'ops', 'active', '{}');
delete from public.settings where section = 'makers';
insert into public.settings (section, data) values ('makers', jsonb_build_object('rate', '40%', 'delay', jsonb_build_object('lead', 9),
  'fake', jsonb_build_object('note', 'مش للأعضاء', 'tiers', jsonb_build_array(
    jsonb_build_object('to', 1000, 'type', 'amount', 'value', 500), jsonb_build_object('to', null, 'type', 'percent', 'value', 20)))));

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000106a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$ declare p jsonb := public.settings_public(); m jsonb := p -> 'makers'; begin
  if (m -> 'fake') <> jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('to', 1000, 'type', 'amount', 'value', 500), jsonb_build_object('to', null, 'type', 'percent', 'value', 20))) then
    raise exception 'case the tiers reach a member failed: %', m -> 'fake';
  end if;
  if (m -> 'delay' ->> 'lead') <> '9' then raise exception 'case the delay rules are still there failed'; end if;
  if m ? 'rate' or position('مش للأعضاء' in p::text) > 0 then raise exception 'case nothing else of the row failed'; end if;
  if not (p ? 'aiTemplates' and p ? 'lists' and p ? 'general' and p ? 'security' and p ? 'notif' and p ? 'brand') then raise exception 'case the rest of the public settings failed'; end if;
  -- a member cannot write the row (the admin's — 0002)
  begin
    update public.settings set data = '{}'::jsonb where section = 'makers';
    if found then raise exception 'case a member wrote the settings row failed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- no tiers saved (or not a list): the key is not there
update public.settings set data = data - 'fake' where section = 'makers';
set local role authenticated;
do $$ begin
  if public.settings_public() -> 'makers' ? 'fake' then raise exception 'case no rule, no key failed'; end if;
end $$;
reset role;
update public.settings set data = data || '{"fake": {"tiers": "x"}}'::jsonb where section = 'makers';
set local role authenticated;
do $$ begin
  if public.settings_public() -> 'makers' ? 'fake' then raise exception 'case tiers that are not a list failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_fake_discount: ok'; end $$;
rollback;
