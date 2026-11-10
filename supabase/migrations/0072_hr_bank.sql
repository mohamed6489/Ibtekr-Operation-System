-- 0072 — phase 13 decision 39 (owner 10 Nov — «بيانات الحساب» in «ملفي» with «رقم الحساب البنكي»; the reply «تمام» to: the member
-- types their own bank account, it shows masked, the admin reveals it and the reveal is logged):
-- * hr_bank — one row per member (the bank, the holder's name, the account number, an optional IBAN). Closed to the members: RLS on
--   with no policy and no grant to authenticated — everything goes through the three RPCs below (rule 4: the table's grant is the
--   service_role's only, on purpose, like hr_requests).
-- * hr_bank_get(member) — masked («•••• 1234»): my own, or anyone's for an admin / sensitive.salaries (the payroll's people).
-- * hr_bank_set(input) — my own only; the number digits only (spaces and dashes dropped), the IBAN letters and digits upper-cased.
--   activity_log 'hr.bank.set' with no value.
-- * hr_bank_reveal(member) — the full number: my own, or anyone's for an admin / sensitive.salaries; every call logged
--   'hr.bank.reveal' with the member's id only (never the number).
-- * member_delete (0067) — hr_bank is a personal setup row: it goes with the member (added to the allowlist).
-- * Security review: a stolen password alone never reads or moves where the salary goes — the three RPCs need an aal2 session when the
--   caller is enrolled in 2FA or the company forces it (hr_bank_session; the readers' path is aal2-gated by is_admin / has_perm already,
--   0008 / 0056), else 42501 'aal2_required'; and a change rings the member and the admins (kind 'hr.bank', no number in it).

create table if not exists public.hr_bank (
  member_id uuid primary key references public.profiles on delete cascade,
  bank_name text not null check (char_length(btrim(bank_name)) between 1 and 80),
  holder text not null check (char_length(btrim(holder)) between 1 and 120),
  account_number text not null check (account_number ~ '^[0-9]{6,30}$'),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  updated_at timestamptz not null default now()
);
alter table public.hr_bank enable row level security;
revoke all on public.hr_bank from public, anon, authenticated;
grant select, insert, update, delete on public.hr_bank to service_role;

-- the session may touch a bank account: aal2 when the caller is enrolled in 2FA or the company forces 2FA (security review)
create or replace function public.hr_bank_session() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not ((coalesce((select p.twofa from public.profiles p where p.id = auth.uid()), false) or public.force2fa_on())
    and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2')
$$;

-- who may read another member's bank account: an admin or the payroll's people (sensitive.salaries F)
create or replace function public.hr_bank_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and (public.is_admin() or public.hr_salaries())
$$;

create or replace function public.hr_bank_get(p_member uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_m uuid := coalesce(p_member, auth.uid()); v_b public.hr_bank;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.hr_bank_session() then raise exception 'aal2_required' using errcode = '42501'; end if;
  if v_m is distinct from auth.uid() and not public.hr_bank_reader() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from public.hr_bank where member_id = v_m;
  if not found then return null; end if;
  return jsonb_build_object('bank_name', v_b.bank_name, 'holder', v_b.holder, 'account', '•••• ' || right(v_b.account_number, 4),
    'iban', case when v_b.iban is null then null else left(v_b.iban, 2) || ' •••• ' || right(v_b.iban, 4) end, 'updated_at', v_b.updated_at);
end $$;

create or replace function public.hr_bank_set(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bank text := btrim(coalesce(p_input ->> 'bank_name', ''));
  v_holder text := btrim(coalesce(p_input ->> 'holder', ''));
  v_num text := regexp_replace(coalesce(p_input ->> 'account_number', ''), '[\s-]', '', 'g');
  v_iban text := nullif(upper(regexp_replace(coalesce(p_input ->> 'iban', ''), '[\s-]', '', 'g')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.hr_bank_session() then raise exception 'aal2_required' using errcode = '42501'; end if;
  if char_length(v_bank) not between 1 and 80 then raise exception 'invalid: bank' using errcode = '22023'; end if;
  if char_length(v_holder) not between 1 and 120 then raise exception 'invalid: holder' using errcode = '22023'; end if;
  if v_num !~ '^[0-9]{6,30}$' then raise exception 'invalid: number' using errcode = '22023'; end if;
  if v_iban is not null and v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then raise exception 'invalid: iban' using errcode = '22023'; end if;
  insert into public.hr_bank (member_id, bank_name, holder, account_number, iban, updated_at)
  values (auth.uid(), v_bank, v_holder, v_num, v_iban, now())
  on conflict (member_id) do update set bank_name = excluded.bank_name, holder = excluded.holder, account_number = excluded.account_number,
    iban = excluded.iban, updated_at = excluded.updated_at;
  insert into public.activity_log (action, entity, entity_id) values ('hr.bank.set', 'hr_bank', auth.uid()::text);
  -- the member and the admins hear of every change (a takeover is seen at once); the name only, never a number
  insert into public.alerts (kind, title, body, user_id, entity, entity_id)
  values ('hr.bank', 'اتغيّر حسابك البنكي', 'لو مش إنت اللي غيّرته كلّم الأدمن فورًا', auth.uid(), 'profile-security', 'bank:' || auth.uid() || ':' || extract(epoch from now())::bigint);
  insert into public.alerts (kind, title, body, role_id, entity, entity_id)
  select 'hr.bank', left(coalesce(p.name, 'عضو'), 60) || ' غيّر حسابه البنكي', 'المرتب الجاي بيتحوّل على الحساب الجديد', 'admin',
    coalesce('member-' || p.member_code, 'hr-team'), 'bank:' || auth.uid() || ':' || extract(epoch from now())::bigint
  from public.profiles p where p.id = auth.uid();
  return public.hr_bank_get(auth.uid());
end $$;

create or replace function public.hr_bank_reveal(p_member uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m uuid := coalesce(p_member, auth.uid()); v_b public.hr_bank;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.hr_bank_session() then raise exception 'aal2_required' using errcode = '42501'; end if;
  if v_m is distinct from auth.uid() and not public.hr_bank_reader() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_b from public.hr_bank where member_id = v_m;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  insert into public.activity_log (action, entity, entity_id) values ('hr.bank.reveal', 'hr_bank', v_m::text);
  return jsonb_build_object('bank_name', v_b.bank_name, 'holder', v_b.holder, 'account_number', v_b.account_number, 'iban', v_b.iban);
end $$;

revoke execute on function public.hr_bank_session(), public.hr_bank_reader(), public.hr_bank_get(uuid), public.hr_bank_set(jsonb), public.hr_bank_reveal(uuid) from public, anon;
grant execute on function public.hr_bank_session(), public.hr_bank_reader(), public.hr_bank_get(uuid), public.hr_bank_set(jsonb), public.hr_bank_reveal(uuid) to authenticated, service_role;

-- 0067 + hr_bank in the personal setup rows that go with the member
create or replace function public.member_delete(p_member uuid, p_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text; v_role text; v_status text; v_code text; v_fk record; v_found boolean;
  v_personal constant text[] := array['hr_members', 'hr_pay', 'hr_kpis', 'hr_bank', 'user_prefs', 'alert_reads', 'notification_prefs', 'image_imports', 'image_shares', 'magnific_oauth_states', 'cs_oauth_states'];
begin
  if coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;
  select name, role_id, status, member_code into v_name, v_role, v_status, v_code from public.profiles where id = p_member for update;
  if v_name is null then raise exception 'no such member' using errcode = 'P0002'; end if;
  if p_actor is not null and p_actor = p_member then raise exception 'own account' using errcode = '22023'; end if;
  if v_code = 'M01' then raise exception 'owner' using errcode = '22023'; end if;
  if v_role = 'admin' and v_status = 'active' and (select count(*) from public.profiles where role_id = 'admin' and status = 'active' and id <> p_member) = 0 then
    raise exception 'last_admin' using errcode = '22023';
  end if;
  -- any trace: a row in a table whose key to profiles does not cascade, or one that cascades but is not personal setup
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
      and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
      and not (c.confdeltype = 'c' and replace(c.conrelid::regclass::text, 'public.', '') = any (v_personal))
    order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col) into v_found using p_member;
    if v_found then
      raise exception 'has_records' using errcode = '23503', hint = replace(v_fk.tbl::text, 'public.', '');
    end if;
  end loop;
  delete from auth.users where id = p_member; -- profiles and the personal setup rows cascade
  insert into public.activity_log (at, actor, action, entity, entity_id, new_value) values (now(), p_actor, 'hr.member.delete', 'profile', p_member::text, to_jsonb(v_name));
  return jsonb_build_object('ok', true, 'id', p_member, 'name', v_name);
end
$$;
revoke execute on function public.member_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.member_delete(uuid, uuid) to service_role;
