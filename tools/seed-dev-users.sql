-- seed-dev-users: three DEV-ONLY accounts for the e2e suite (tests/e2e/auth.spec.mjs with E2E_SUPABASE_LIVE=1).
-- Run ONCE on the dev Supabase project via Supabase MCP execute_sql (or the SQL editor). NEVER on production.
-- Idempotent: fixed UUIDs + on conflict do nothing.
--
--   M01  admin.dev@ibtekr.local    01000000001  admin            active
--   M02  ops.dev@ibtekr.local      01000000002  ops              active
--   M99  viewer.dev@ibtekr.local   01000000099  viewer           suspended
--   password (all three, dev only): IbtekrDev-2026
--
-- The token columns are '' rather than NULL: GoTrue cannot scan NULL there and sign-in would fail.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('IbtekrDev-2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'admin.dev@ibtekr.local'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'ops.dev@ibtekr.local'),
  ('00000000-0000-4000-8000-000000000099'::uuid, 'viewer.dev@ibtekr.local')
) as u (id, email)
on conflict do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select u.id, u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email), now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000099')
on conflict do nothing;

insert into public.profiles (id, member_code, name, email, phone, role_id, title, dept, manager_id, status, twofa) values
  ('00000000-0000-4000-8000-000000000001', 'M01', 'صفوت كمال', 'admin.dev@ibtekr.local', '01000000001', 'admin', 'المؤسس والمدير العام', 'الإدارة', null, 'active', false),
  ('00000000-0000-4000-8000-000000000002', 'M02', 'سارة أحمد', 'ops.dev@ibtekr.local', '01000000002', 'ops', 'مديرة العمليات', 'العمليات', '00000000-0000-4000-8000-000000000001', 'active', false),
  ('00000000-0000-4000-8000-000000000099', 'M99', 'مشاهد تجريبي', 'viewer.dev@ibtekr.local', '01000000099', 'viewer', 'مشاهد', 'الإدارة', '00000000-0000-4000-8000-000000000001', 'suspended', false)
on conflict do nothing;
