-- 0046_hr — phase 10 «الموارد البشرية» on real data (docs/superpowers/plans/2026-11-05-phase-10-hr.md).
-- The prototype's HR page (block 15), the header clock (block 21) and the profile («ملفي», block 18) read and write here.
-- * Permissions (decision 11): hr.view F = every member · P = me + the members I manage (profiles.manager_id) · N = me only;
--   hr.edit F = manual attendance, the members' HR data (not the pay), the lists, the KPIs, the meetings; hr.approve F = decide
--   any request / overtime (a direct manager decides for their own team without it); sensitive.salaries F = the pay, the
--   adjustments, the extras, the payroll and everyone's payslip (decision 2: the admin only; a member reads their own pay and
--   payslip). Admin F/F/F/F; ops, cs, vendors_followup, accounts P/N/N/N; viewer N.
-- * The clock (decision 10): hr_clock_in / hr_clock_out write the member's own day with the server's time (Cairo days);
--   hr_shift_now gives the open shift back after a refresh or on another device. Overtime is recorded at the end of the shift
--   when the member says what they worked on, and waits for the direct manager (then the admin after 24 hours — decision 9);
--   a rest day / holiday worked (×2) is recorded the same way (kind rest_day) and waits for the same approval.
-- * Requests: hr_request_create (my own, or anyone's with hr.edit F) / hr_request_decide / hr_request_cancel; the money of an
--   advance is masked in hr_requests_v unless sensitive.salaries F or it is mine.
-- * Payroll (decisions 3 / 8 / 14): one sheet per month, opened by itself (pg_cron, daily, idempotent) — مسودة → مراجعة →
--   معتمد (the lines are snapshotted from hr_payroll_calc) → مدفوع (hr_payroll_pay: an «المرتبات» expense per member at the
--   net + one withdrawal of the total from the account picked, in the same transaction).
-- * Decision 16 (T4): the documents in hr_documents + the private bucket «hr-docs» (the member's folder; hr.edit F writes, the
--   member reads their own), a leave's report on the request (doc_path — required when the type's «مرفق» is not «—»),
--   «مكافأة إنجاز» = an adjustment of kind achievement, «ضيفه» again on a refused overtime as its meeting's result (hr.edit F, the
--   meeting closed with it), hr_settings() for every active member, hr_team() (the names of the members I see in HR — the profiles
--   themselves stay settings.view's), and a late approval paid with the next open sheet (hr_overtime.pay_month).
-- * The rules are block 12's (IbtekrOps): the day = salary ÷ 24, the hour = the day ÷ 8, overtime at the hour, a rest day /
--   holiday worked ×2, the month's incentive = holdback × min(score, 100)% (0 under 70), paid with the quarter's third month.
-- Re-runnable; no drop / delete / truncate of data.

update public.roles r set permissions = r.permissions || d.perms
from (values
  ('admin',            '{"hr.view":"F","hr.edit":"F","hr.approve":"F","sensitive.salaries":"F"}'::jsonb),
  ('ops',              '{"hr.view":"P","hr.edit":"N","hr.approve":"N","sensitive.salaries":"N"}'::jsonb),
  ('cs',               '{"hr.view":"P","hr.edit":"N","hr.approve":"N","sensitive.salaries":"N"}'::jsonb),
  ('vendors_followup', '{"hr.view":"P","hr.edit":"N","hr.approve":"N","sensitive.salaries":"N"}'::jsonb),
  ('accounts',         '{"hr.view":"P","hr.edit":"N","hr.approve":"N","sensitive.salaries":"N"}'::jsonb),
  ('viewer',           '{"hr.view":"N","hr.edit":"N","hr.approve":"N","sensitive.salaries":"N"}'::jsonb)
) as d(id, perms)
where r.id = d.id and not (r.permissions ?& array['hr.view', 'hr.edit', 'hr.approve', 'sensitive.salaries']);

-- ---------------------------------------------------------------- helpers

create or replace function public.hr_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Africa/Cairo')::date $$;

create or replace function public.hr_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
$$;

create or replace function public.hr_is_manager_of(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and exists (select 1 from public.profiles p where p.id = p_member and p.manager_id = auth.uid())
$$;

-- who sees a member's HR rows: me always; hr.view F everyone; P the members I manage
create or replace function public.hr_can_see(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.hr_active() then false
    when p_member = auth.uid() then true
    when public.has_perm('hr.view') = 'F' then true
    when public.has_perm('hr.view') = 'P' then public.hr_is_manager_of(p_member)
    else false end
$$;

-- deciding a member's request / overtime: the admin, hr.approve F, or their direct manager — never one's own (but the admin)
create or replace function public.hr_can_decide(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and (public.is_admin()
    or (p_member is distinct from auth.uid() and (public.has_perm('hr.approve') = 'F' or public.hr_is_manager_of(p_member))))
$$;

create or replace function public.hr_salaries() returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and public.has_perm('sensitive.salaries') = 'F'
$$;

create or replace function public.hr_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.hr_active() and public.has_perm('hr.edit') = 'F'
$$;

-- a Cairo local time on a day → timestamptz
create or replace function public.hr_at(p_day date, p_time time) returns timestamptz
language sql immutable set search_path = public as $$ select (p_day + p_time) at time zone 'Africa/Cairo' $$;

-- ---------------------------------------------------------------- the members' HR data (not the pay)

create table if not exists public.hr_members (
  member_id uuid primary key references public.profiles on delete cascade,
  shift_start time not null default '09:00',
  shift_end time not null default '17:00',
  hire_date date,
  leave_days numeric(5,1) not null default 21 check (leave_days >= 0 and leave_days <= 365),
  notes text check (notes is null or char_length(notes) <= 500),
  updated_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);

-- the pay: sensitive.salaries only (and the member's own row)
create table if not exists public.hr_pay (
  member_id uuid primary key references public.profiles on delete cascade,
  salary numeric(12,2) not null default 0 check (salary >= 0 and salary <= 10000000),
  holdback numeric(12,2) not null default 0 check (holdback >= 0),
  allowances numeric(12,2) not null default 0 check (allowances >= 0 and allowances <= 10000000),
  updated_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  check (holdback <= salary)
);

-- ---------------------------------------------------------------- attendance + overtime (written through the RPCs only)

create table if not exists public.hr_attendance (
  id bigserial primary key,
  member_id uuid not null references public.profiles on delete cascade,
  day date not null,
  in_at timestamptz not null,
  out_at timestamptz check (out_at is null or out_at >= in_at),
  remote boolean not null default false,
  source text not null default 'clock' check (source in ('clock', 'manual', 'fix')),
  note text check (note is null or char_length(note) <= 300),
  by_id uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);
create index if not exists hr_attendance_day_idx on public.hr_attendance (day);

create table if not exists public.hr_overtime (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  day date not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  minutes int not null check (minutes > 0 and minutes <= 1440),
  kind text not null default 'hours' check (kind in ('hours', 'rest_day')),
  note text not null check (char_length(btrim(note)) between 1 and 300),
  status text not null default 'مستني' check (status in ('مستني', 'اتضاف', 'اترفض')),
  paid_minutes int not null default 0 check (paid_minutes >= 0 and paid_minutes <= minutes),
  decided_by uuid references public.profiles,
  decided_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists hr_overtime_member_idx on public.hr_overtime (member_id, day);
-- a rest day / holiday worked (×2) waits for the same approval as overtime (the security review: no self-service pay)
alter table public.hr_overtime add column if not exists kind text not null default 'hours' check (kind in ('hours', 'rest_day'));
create unique index if not exists hr_overtime_rest_day_idx on public.hr_overtime (member_id, day) where kind = 'rest_day';
-- the sheet that pays it (set by «ضيفه»): the month of the day worked, or — approved after that sheet was approved / paid — the first
-- sheet still open, so a late approval is never lost
alter table public.hr_overtime add column if not exists pay_month date check (pay_month is null or extract(day from pay_month) = 1);


-- ---------------------------------------------------------------- requests

create table if not exists public.hr_requests (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  type text not null check (char_length(type) between 1 and 40),
  from_day date not null,
  to_day date not null,
  at_time time,
  hours numeric(4,1) check (hours is null or (hours > 0 and hours <= 12)),
  amount numeric(12,2) check (amount is null or (amount > 0 and amount <= 10000000)),
  months int check (months is null or months between 1 and 24),
  note text check (note is null or char_length(note) <= 500),
  doc_path text check (doc_path is null or char_length(doc_path) <= 300),  -- a sick leave's medical report (bucket «hr-docs», the member's folder)
  status text not null default 'جديد' check (status in ('جديد', 'قيد المراجعة', 'موافق', 'مرفوض', 'اتلغى')),
  decided_by uuid references public.profiles,
  decided_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 300),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists hr_requests_member_idx on public.hr_requests (member_id, from_day);

-- ---------------------------------------------------------------- the lists (settings › الموارد البشرية)

create table if not exists public.hr_holidays (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  day date not null,
  days int not null default 1 check (days between 1 and 14),
  kind text not null default 'رسمية' check (char_length(kind) <= 40),
  status text not null default 'مؤكد' check (status in ('مؤكد', 'متوقع')),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  unique (day, name)
);

create table if not exists public.hr_leave_types (
  name text primary key check (char_length(btrim(name)) between 1 and 40),
  days text not null default '—' check (char_length(days) <= 40),
  paid text not null default 'نعم' check (char_length(paid) <= 40),
  doc text not null default '—' check (char_length(doc) <= 60),
  carry text not null default '—' check (char_length(carry) <= 40),
  approval text not null default 'المدير المباشر' check (char_length(approval) <= 40),
  deducts boolean not null default false,  -- from the annual balance
  unpaid boolean not null default false,   -- a day = salary ÷ 24 off the sheet
  sort int not null default 100,
  created_at timestamptz not null default now()
);
insert into public.hr_leave_types (name, days, paid, doc, carry, approval, deducts, unpaid, sort) values
  ('إجازة سنوية', '21 يوم', 'نعم', '—', 'لحد 5 أيام', 'المدير المباشر', true, false, 1),
  ('إجازة عارضة', '6 أيام (من السنوية)', 'نعم', '—', '—', 'المدير المباشر', true, false, 2),
  ('إجازة مرضية', 'حسب التقرير', 'نعم', 'تقرير طبي إلزامي', '—', 'الأدمن', false, false, 3),
  ('إجازة بدون أجر', '—', 'لا (يوم = ÷ 24)', '—', '—', 'المالك', false, true, 4)
on conflict (name) do nothing;

create table if not exists public.hr_bonus_rules (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  cond text not null check (char_length(btrim(cond)) between 1 and 200),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.hr_bonus_rules (name, cond, amount) values
  ('مكافأة تفوق', 'سكور الربع ≥ 110%', 500), ('مكافأة تفوق عالي', 'سكور الربع ≥ 120%', 1000),
  ('ربع بدون أوردر متأخر', '0 متأخرات في مسؤوليته', 300), ('أعلى تقييم خدمة عملاء', 'أعلى CSAT في الربع ≥ 4.8', 300)
on conflict (name) do nothing;

create table if not exists public.hr_ot_periods (
  id bigint generated always as identity primary key,
  range_text text not null check (char_length(btrim(range_text)) between 1 and 80),
  scope text not null default 'كل الفريق' check (char_length(scope) <= 80),
  counts boolean not null default true,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- performance (decision 4: KPIs by hand first)

create table if not exists public.hr_kpis (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  src text not null default 'يدوي' check (char_length(src) <= 60),
  weight numeric(5,2) not null check (weight > 0 and weight <= 100),
  target numeric(14,2) not null check (target > 0),
  inverse boolean not null default false,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists hr_kpis_member_idx on public.hr_kpis (member_id);

create table if not exists public.hr_scores (
  member_id uuid not null references public.profiles on delete cascade,
  month date not null check (extract(day from month) = 1),
  score numeric(6,2) not null check (score >= 0 and score <= 200),
  actuals jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 500),
  rated_by uuid references public.profiles default auth.uid(),
  rated_at timestamptz not null default now(),
  primary key (member_id, month)
);

create table if not exists public.hr_extras (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  quarter text not null check (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  rule text not null check (char_length(btrim(rule)) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  status text not null default 'مقترحة' check (status in ('مقترحة', 'معتمدة', 'مرفوضة')),
  decided_by uuid references public.profiles,
  decided_at timestamptz,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.hr_meetings (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  status text not null default 'مطلوب' check (status in ('مطلوب', 'اتحدد ميعاد', 'خطة شغالة', 'اتقفلت')),
  day date,
  time_text text check (time_text is null or char_length(time_text) <= 20),
  place text check (place is null or char_length(place) <= 80),
  outcome text check (outcome is null or char_length(outcome) <= 80),
  plan text check (plan is null or char_length(plan) <= 200),
  goals jsonb not null default '[]'::jsonb check (jsonb_typeof(goals) = 'array'),
  support text check (support is null or char_length(support) <= 300),
  review_on date,
  progress int check (progress is null or progress between 0 and 100),
  notes text check (notes is null or char_length(notes) <= 1000),
  ref text check (ref is null or char_length(ref) <= 40),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- the money

create table if not exists public.hr_adjustments (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount numeric(12,2) not null check (amount <> 0 and abs(amount) <= 10000000),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  note text check (note is null or char_length(note) <= 300),
  -- «مكافأة إنجاز» (the prototype's achievements) is an addition paid with that month's salary
  kind text not null default 'adjust' check (kind in ('adjust', 'achievement')),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles,
  voided_at timestamptz,
  check (kind = 'adjust' or amount > 0)
);

-- the members' documents (the contract, the ID card …): the files in the private bucket «hr-docs» under the member's folder
create table if not exists public.hr_documents (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('عقد عمل', 'ملحق عقد', 'بطاقة رقم قومي', 'شهادة تخرج', 'أخرى')),
  path text not null unique check (char_length(path) between 3 and 300),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  start_on date,
  end_on date,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles,
  voided_at timestamptz,
  check (end_on is null or start_on is null or end_on >= start_on),
  check (path like member_id::text || '/%')
);
create index if not exists hr_documents_member_idx on public.hr_documents (member_id);

create table if not exists public.hr_payroll (
  month date primary key check (extract(day from month) = 1),
  status text not null default 'مسودة' check (status in ('مسودة', 'مراجعة', 'معتمد', 'مدفوع')),
  opened_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles, reviewed_at timestamptz,
  approved_by uuid references public.profiles, approved_at timestamptz,
  paid_by uuid references public.profiles, paid_at timestamptz,
  paid_account text check (paid_account is null or paid_account in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية')),
  total numeric(14,2)
);

create table if not exists public.hr_payroll_lines (
  month date not null references public.hr_payroll on delete cascade,
  member_id uuid not null references public.profiles,
  name text not null,
  salary numeric(12,2) not null,
  holdback numeric(12,2) not null,
  paid numeric(12,2) not null,
  ot_minutes int not null default 0,
  ot_pay numeric(12,2) not null default 0,
  rest_days int not null default 0,
  rest_pay numeric(12,2) not null default 0,
  unpaid_days numeric(5,1) not null default 0,
  unpaid_cut numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  advance numeric(12,2) not null default 0,
  quarter_bonus numeric(12,2) not null default 0,
  net numeric(12,2) not null,
  primary key (month, member_id)
);

-- ---------------------------------------------------------------- guards

-- an adjustment never changes after it is written but its void; none on a sheet already approved / paid
create or replace function public.hr_adjustments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.hr_payroll p where p.month = new.month and p.status in ('معتمد', 'مدفوع')) then
    raise exception 'sheet locked' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if (new.member_id, new.month, new.amount, new.label, new.note, new.kind, new.created_by, new.created_at)
       is distinct from (old.member_id, old.month, old.amount, old.label, old.note, old.kind, old.created_by, old.created_at)
       or old.voided_at is not null or new.voided_at is null then
      raise exception 'only a void' using errcode = '22023';
    end if;
    new.voided_by := auth.uid(); new.voided_at := now();
  else
    new.created_by := auth.uid(); new.created_at := now(); new.voided_by := null; new.voided_at := null;
  end if;
  return new;
end $$;
drop trigger if exists hr_adjustments_guard on public.hr_adjustments;
create trigger hr_adjustments_guard before insert or update on public.hr_adjustments for each row execute function public.hr_adjustments_guard();

-- a document never changes after it is written but its void
create or replace function public.hr_documents_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.member_id, new.kind, new.path, new.name, new.start_on, new.end_on, new.created_by, new.created_at)
       is distinct from (old.member_id, old.kind, old.path, old.name, old.start_on, old.end_on, old.created_by, old.created_at)
       or old.voided_at is not null or new.voided_at is null then
      raise exception 'only a void' using errcode = '22023';
    end if;
    new.voided_by := auth.uid(); new.voided_at := now();
  else
    new.created_by := auth.uid(); new.created_at := now(); new.voided_by := null; new.voided_at := null;
  end if;
  return new;
end $$;
drop trigger if exists hr_documents_guard on public.hr_documents;
create trigger hr_documents_guard before insert or update on public.hr_documents for each row execute function public.hr_documents_guard();

create or replace function public.hr_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid(); new.updated_at := now(); return new;
end $$;
drop trigger if exists hr_members_stamp on public.hr_members;
create trigger hr_members_stamp before insert or update on public.hr_members for each row execute function public.hr_stamp();
drop trigger if exists hr_pay_stamp on public.hr_pay;
create trigger hr_pay_stamp before insert or update on public.hr_pay for each row execute function public.hr_stamp();

create or replace function public.hr_meetings_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.member_id := old.member_id; new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists hr_meetings_stamp on public.hr_meetings;
create trigger hr_meetings_stamp before insert or update on public.hr_meetings for each row execute function public.hr_meetings_stamp();

-- ---------------------------------------------------------------- RLS

alter table public.hr_members enable row level security;
alter table public.hr_pay enable row level security;
alter table public.hr_attendance enable row level security;
alter table public.hr_overtime enable row level security;
alter table public.hr_requests enable row level security;
alter table public.hr_holidays enable row level security;
alter table public.hr_leave_types enable row level security;
alter table public.hr_bonus_rules enable row level security;
alter table public.hr_ot_periods enable row level security;
alter table public.hr_kpis enable row level security;
alter table public.hr_scores enable row level security;
alter table public.hr_extras enable row level security;
alter table public.hr_meetings enable row level security;
alter table public.hr_adjustments enable row level security;
alter table public.hr_payroll enable row level security;
alter table public.hr_payroll_lines enable row level security;
alter table public.hr_documents enable row level security;

do $pol$
declare t text;
begin
  -- the members' data: seen by hr_can_see, written with hr.edit F
  if not exists (select 1 from pg_policies where tablename = 'hr_members' and policyname = 'hr_members_select') then
    create policy hr_members_select on public.hr_members for select to authenticated using (public.hr_can_see(member_id));
    create policy hr_members_insert on public.hr_members for insert to authenticated with check (public.hr_editor());
    create policy hr_members_update on public.hr_members for update to authenticated using (public.hr_editor()) with check (public.hr_editor());
  end if;
  -- the pay: sensitive.salaries F, and a member's own row
  if not exists (select 1 from pg_policies where tablename = 'hr_pay' and policyname = 'hr_pay_select') then
    create policy hr_pay_select on public.hr_pay for select to authenticated using (public.hr_salaries() or (member_id = auth.uid() and public.hr_active()));
    create policy hr_pay_insert on public.hr_pay for insert to authenticated with check (public.hr_salaries());
    create policy hr_pay_update on public.hr_pay for update to authenticated using (public.hr_salaries()) with check (public.hr_salaries());
  end if;
  foreach t in array array['hr_attendance', 'hr_overtime', 'hr_kpis', 'hr_scores', 'hr_meetings'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.hr_can_see(member_id))', t || '_select', t);
    end if;
  end loop;
  -- requests are read through hr_requests_v (the advance's amount masked); the table itself is not granted to members
  if not exists (select 1 from pg_policies where tablename = 'hr_requests' and policyname = 'hr_requests_select') then
    create policy hr_requests_select on public.hr_requests for select to authenticated using (public.hr_can_see(member_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hr_kpis' and policyname = 'hr_kpis_write') then
    create policy hr_kpis_write on public.hr_kpis for insert to authenticated with check (public.hr_editor());
    create policy hr_kpis_update on public.hr_kpis for update to authenticated using (public.hr_editor()) with check (public.hr_editor());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hr_meetings' and policyname = 'hr_meetings_insert') then
    create policy hr_meetings_insert on public.hr_meetings for insert to authenticated with check (public.hr_editor());
    create policy hr_meetings_update on public.hr_meetings for update to authenticated using (public.hr_editor()) with check (public.hr_editor());
  end if;
  -- the lists: every active member reads (leave days, holidays), hr.edit F writes
  foreach t in array array['hr_holidays', 'hr_leave_types', 'hr_bonus_rules', 'hr_ot_periods'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.hr_active())', t || '_select', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.hr_editor())', t || '_insert', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.hr_editor()) with check (public.hr_editor())', t || '_update', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'hr_holidays' and policyname = 'hr_holidays_delete') then
    create policy hr_holidays_delete on public.hr_holidays for delete to authenticated using (public.hr_editor());
    create policy hr_ot_periods_delete on public.hr_ot_periods for delete to authenticated using (public.hr_editor());
  end if;
  -- the money: sensitive.salaries F; a member reads their own extras / adjustments / payslip
  if not exists (select 1 from pg_policies where tablename = 'hr_extras' and policyname = 'hr_extras_select') then
    create policy hr_extras_select on public.hr_extras for select to authenticated using (public.hr_salaries() or (member_id = auth.uid() and public.hr_active()));
    create policy hr_extras_insert on public.hr_extras for insert to authenticated with check (public.hr_salaries());
    create policy hr_extras_update on public.hr_extras for update to authenticated using (public.hr_salaries()) with check (public.hr_salaries());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hr_adjustments' and policyname = 'hr_adjustments_select') then
    create policy hr_adjustments_select on public.hr_adjustments for select to authenticated
      using (public.hr_salaries() or (member_id = auth.uid() and voided_at is null and public.hr_active()));
    create policy hr_adjustments_insert on public.hr_adjustments for insert to authenticated with check (public.hr_salaries());
    create policy hr_adjustments_update on public.hr_adjustments for update to authenticated using (public.hr_salaries()) with check (public.hr_salaries());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hr_payroll' and policyname = 'hr_payroll_select') then
    create policy hr_payroll_select on public.hr_payroll for select to authenticated using (public.hr_salaries());
    create policy hr_payroll_lines_select on public.hr_payroll_lines for select to authenticated
      using (public.hr_salaries() or (member_id = auth.uid() and public.hr_active()));
  end if;
  -- the documents: hr.edit F, and a member's own
  if not exists (select 1 from pg_policies where tablename = 'hr_documents' and policyname = 'hr_documents_select') then
    create policy hr_documents_select on public.hr_documents for select to authenticated using (public.hr_editor() or (member_id = auth.uid() and public.hr_active()));
    create policy hr_documents_insert on public.hr_documents for insert to authenticated with check (public.hr_editor());
    create policy hr_documents_update on public.hr_documents for update to authenticated using (public.hr_editor()) with check (public.hr_editor());
  end if;
end $pol$;
-- the profiles stay settings.view's (0001): a direct manager reads their team's names through hr_team() below (the security
-- review: no email / phone / custom_perms / twofa through HR)
drop policy if exists profiles_select_hr on public.profiles;

-- the requests as members read them: an advance's amount for sensitive.salaries F or its own member only
create or replace view public.hr_requests_v with (security_barrier = true) as
  select r.id, 'HR-' || lpad(r.id::text, 4, '0') as code, r.member_id, r.type, r.from_day, r.to_day, r.at_time, r.hours,
    case when public.hr_salaries() or r.member_id = auth.uid() then r.amount end as amount, r.months, r.note, r.status,
    r.decided_by, r.decided_at, r.reason, r.created_by, r.created_at, r.doc_path
  from public.hr_requests r
  where public.hr_can_see(r.member_id);

-- the members I see in HR (hr_can_see) with what the team page shows of them — names, never contact details or permissions
create or replace function public.hr_team()
returns table (id uuid, member_code text, name text, title text, dept text, manager_id uuid, status text, role_id text)
language sql stable security definer set search_path = public as $$
  select p.id, p.member_code, p.name, p.title, p.dept, p.manager_id, p.status, p.role_id
  from public.profiles p where public.hr_can_see(p.id) order by p.member_code
$$;

-- the settings row «hr» (the clock's end-of-shift / presence rules, the late grace …) for every active member — settings.view
-- reads the table itself, and most roles have none
create or replace function public.hr_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.hr_active() then coalesce((select s.data from public.settings s where s.section = 'hr'), '{}'::jsonb) end
$$;

-- a file of the bucket «hr-docs»: the member's own folder, hr.edit F, or whoever decides the request it is attached to
create or replace function public.hr_doc_visible(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_member uuid;
begin
  if not public.hr_active() then return false; end if;
  begin v_member := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  if v_member = auth.uid() or public.hr_editor() then return true; end if;
  return exists (select 1 from public.hr_requests r where r.doc_path = p_name and public.hr_can_decide(r.member_id));
end $$;

-- a Friday / Saturday or a confirmed holiday (block 12: HR.offDays + the holidays)
create or replace function public.hr_rest_day(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_day) in (5, 6)
    or exists (select 1 from public.hr_holidays h where h.status = 'مؤكد' and p_day between h.day and h.day + (h.days - 1))
$$;

-- ---------------------------------------------------------------- the clock (decision 10)

-- my open shift (a refresh or another device picks it up): the latest row of mine without an out, within 20 hours
create or replace function public.hr_shift_now() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.hr_active() then null else (
    select jsonb_build_object('id', a.id, 'day', a.day, 'in_at', a.in_at, 'out_at', a.out_at, 'remote', a.remote)
    from public.hr_attendance a
    where a.member_id = auth.uid() and (a.out_at is null and a.in_at > now() - interval '20 hours' or a.day = public.hr_today())
    order by (a.out_at is null) desc, a.in_at desc limit 1) end
$$;

create or replace function public.hr_clock_in(p_remote boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.hr_attendance where member_id = auth.uid() and out_at is null and in_at > now() - interval '20 hours'
    order by in_at desc limit 1;
  if found then return public.hr_shift_now(); end if;                    -- already in (another tab / device)
  if exists (select 1 from public.hr_attendance where member_id = auth.uid() and day = public.hr_today()) then
    raise exception 'invalid: ended' using errcode = '22023';          -- one shift a day; a fix goes through a request
  end if;
  insert into public.hr_attendance (member_id, day, in_at, remote, source) values (auth.uid(), public.hr_today(), now(), coalesce(p_remote, false), 'clock');
  return public.hr_shift_now();
end $$;

-- the end of my shift: now (or p_at — the time «لسه شغال؟» was shown, for an end by itself), and the overtime past 8 hours
-- when I said what I worked on (block 12: validateOtEnd); returns the minutes worked and the overtime written
create or replace function public.hr_clock_out(p_ot_note text default null, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_out timestamptz; v_worked int; v_shift int := 480; v_ot bigint; v_note text := nullif(btrim(coalesce(p_ot_note, '')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.hr_attendance where member_id = auth.uid() and out_at is null and in_at > now() - interval '20 hours'
    order by in_at desc limit 1 for update;
  if not found then raise exception 'invalid: no open shift' using errcode = '22023'; end if;
  v_out := least(now(), coalesce(p_at, now()));
  if v_out < v_row.in_at then raise exception 'invalid: at' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  update public.hr_attendance set out_at = v_out, updated_at = now() where id = v_row.id;
  v_worked := floor(extract(epoch from (v_out - v_row.in_at)) / 60);
  if public.hr_rest_day(v_row.day) then
    -- the whole day counts ×2 once approved (no separate hours row)
    if v_worked > 0 then
      insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note)
      values (auth.uid(), v_row.day, v_row.in_at, v_out, least(v_worked, 1440), 'rest_day', coalesce(v_note, 'شغل يوم راحة / عطلة'))
      on conflict (member_id, day) where kind = 'rest_day' do nothing returning id into v_ot;
    end if;
    return jsonb_build_object('worked', v_worked, 'overtime_id', v_ot, 'overtime', 0, 'rest_day', true);
  end if;
  if v_note is not null and v_worked > v_shift then
    insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, note)
    values (auth.uid(), v_row.day, v_row.in_at + make_interval(mins => v_shift), v_out, v_worked - v_shift, v_note)
    returning id into v_ot;
  end if;
  return jsonb_build_object('worked', v_worked, 'overtime_id', v_ot, 'overtime', greatest(v_worked - v_shift, 0) * (v_ot is not null)::int);
end $$;

-- hr.edit F: a member's day by hand (Cairo times; out may be empty); a fix of a missing end keeps the start
create or replace function public.hr_attendance_set(p_member uuid, p_day date, p_in time, p_out time default null, p_remote boolean default false, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_in timestamptz; v_out timestamptz;
begin
  if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_member is null or p_day is null or p_in is null or p_day > public.hr_today() then raise exception 'invalid: day' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'not found' using errcode = 'P0002'; end if;
  v_in := public.hr_at(p_day, p_in);
  v_out := case when p_out is null then null when p_out < p_in then public.hr_at(p_day + 1, p_out) else public.hr_at(p_day, p_out) end;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  insert into public.hr_attendance as a (member_id, day, in_at, out_at, remote, source, note, by_id)
  values (p_member, p_day, v_in, v_out, coalesce(p_remote, false), 'manual', nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (member_id, day) do update set in_at = excluded.in_at, out_at = excluded.out_at, remote = excluded.remote,
    source = case when a.source = 'clock' and a.out_at is null then 'fix' else 'manual' end, note = excluded.note, by_id = auth.uid(), updated_at = now()
  returning a.id into v_id;
  if v_out is not null and v_out > v_in and public.hr_rest_day(p_day) then
    insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note)
    values (p_member, p_day, v_in, v_out, least(floor(extract(epoch from (v_out - v_in)) / 60)::int, 1440), 'rest_day', 'شغل يوم راحة / عطلة (يدوي)')
    on conflict (member_id, day) where kind = 'rest_day' do nothing;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- requests

create or replace function public.hr_request_types() returns text[]
language sql stable security definer set search_path = public as $$
  select array_cat(coalesce((select array_agg(t.name order by t.sort, t.name) from public.hr_leave_types t), '{}'::text[]),
    array['شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف', 'سُلفة'])
$$;

create or replace function public.hr_request_create(p_input jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_member uuid := coalesce(nullif(p_input ->> 'member', '')::uuid, auth.uid()); v_type text := btrim(coalesce(p_input ->> 'type', ''));
  v_from date; v_to date; v_at time; v_hours numeric; v_amount numeric; v_months int; v_note text := nullif(btrim(coalesce(p_input ->> 'note', '')), ''); v_id bigint;
  v_doc text := nullif(btrim(coalesce(p_input ->> 'doc', '')), '');
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_member <> auth.uid() and not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_member and status = 'active') then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (v_type = any (public.hr_request_types())) then raise exception 'invalid: type' using errcode = '22023'; end if;
  begin
    v_from := coalesce(nullif(p_input ->> 'from', '')::date, public.hr_today());
    v_to := coalesce(nullif(p_input ->> 'to', '')::date, v_from);
    v_at := nullif(p_input ->> 'time', '')::time;
    v_hours := nullif(p_input ->> 'hours', '')::numeric;
    v_amount := nullif(p_input ->> 'amount', '')::numeric;
    v_months := nullif(p_input ->> 'months', '')::int;
  exception when others then raise exception 'invalid: value' using errcode = '22023';
  end;
  if v_to < v_from then raise exception 'invalid: to' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid: note' using errcode = '22023'; end if;
  if v_type = 'سُلفة' then
    if v_amount is null or v_amount <= 0 or v_amount > 10000000 or v_months is null or v_months not between 1 and 24 then raise exception 'invalid: amount' using errcode = '22023'; end if;
    v_from := public.hr_today(); v_to := v_from; v_at := null; v_hours := null;
  elsif v_type in ('إذن انصراف مبكر', 'تصحيح انصراف') then
    if v_at is null then raise exception 'invalid: time' using errcode = '22023'; end if;
    v_to := v_from; v_amount := null; v_months := null;
    if v_type = 'تصحيح انصراف' and (v_from > public.hr_today() or not exists (select 1 from public.hr_attendance where member_id = v_member and day = v_from)) then
      raise exception 'invalid: day' using errcode = '22023';
    end if;
    if v_type = 'إذن انصراف مبكر' and (v_hours is null or v_hours <= 0 or v_hours > 12) then v_hours := 2; end if;
  else
    v_at := null; v_hours := null; v_amount := null; v_months := null;
    if v_to - v_from > 60 then raise exception 'invalid: to' using errcode = '22023'; end if;
  end if;
  -- a leave's attachment (the medical report of «إجازة مرضية»: its type's «مرفق» is not «—»), in the member's own folder
  if not exists (select 1 from public.hr_leave_types t where t.name = v_type) then v_doc := null; end if;
  if v_doc is not null and (char_length(v_doc) > 300 or v_doc not like v_member::text || '/%' or v_doc like '%..%') then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  if v_doc is null and exists (select 1 from public.hr_leave_types t where t.name = v_type and btrim(t.doc) not in ('', '—', '-')) then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  insert into public.hr_requests (member_id, type, from_day, to_day, at_time, hours, amount, months, note, doc_path)
  values (v_member, v_type, v_from, v_to, v_at, v_hours, v_amount, v_months, v_note, v_doc) returning id into v_id;
  return v_id;
end $$;

-- موافق / مرفوض (a reason) / قيد المراجعة; an approved «تصحيح انصراف» closes that day at its time
create or replace function public.hr_request_decide(p_id bigint, p_decision text, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_r public.hr_requests; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_r from public.hr_requests where id = p_id for update;
  if not found or not public.hr_can_see(v_r.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_can_decide(v_r.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_r.status not in ('جديد', 'قيد المراجعة') then raise exception 'invalid: status' using errcode = '22023'; end if;
  if p_decision not in ('موافق', 'مرفوض', 'قيد المراجعة') then raise exception 'invalid: decision' using errcode = '22023'; end if;
  if p_decision = 'مرفوض' and v_reason is null then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  update public.hr_requests set status = p_decision, reason = v_reason,
    decided_by = case when p_decision = 'قيد المراجعة' then null else auth.uid() end,
    decided_at = case when p_decision = 'قيد المراجعة' then null else now() end
  where id = p_id;
  if p_decision = 'موافق' and v_r.type = 'تصحيح انصراف' then
    update public.hr_attendance set out_at = greatest(in_at, public.hr_at(v_r.from_day, v_r.at_time)), source = 'fix', updated_at = now()
    where member_id = v_r.member_id and day = v_r.from_day;
  end if;
  return p_decision;
end $$;

create or replace function public.hr_request_cancel(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.hr_requests set status = 'اتلغى' where id = p_id and member_id = auth.uid() and status in ('جديد', 'قيد المراجعة');
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  return 'اتلغى';
end $$;

-- ---------------------------------------------------------------- overtime (decision 9)

-- «ضيفه» (add — all of it or fewer minutes) / «متضيفهوش» (reject — a reason, and a one-to-one meeting is opened)
create or replace function public.hr_overtime_decide(p_id bigint, p_decision text, p_minutes int default null, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.hr_overtime; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_min int; v_pm date;
begin
  select * into v_o from public.hr_overtime where id = p_id for update;
  if not found or not public.hr_can_see(v_o.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not public.hr_can_decide(v_o.member_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  -- «ضيفه» / «متضيفهوش» on a waiting one; a refused one comes back only as the result of its own one-to-one meeting («الوقت يتضاف
  -- بعد التوضيح»): hr.edit F (who records meetings), the meeting still open — and it is closed with that outcome here (the security review)
  if not (v_o.status = 'مستني' or (v_o.status = 'اترفض' and p_decision = 'add')) then raise exception 'invalid: status' using errcode = '22023'; end if;
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'invalid: reason' using errcode = '22023'; end if;
  if v_o.status = 'اترفض' then
    if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
    update public.hr_meetings set status = 'اتقفلت', outcome = 'اتضاف الوقت'
    where member_id = v_o.member_id and ref = 'OT-' || p_id and status <> 'اتقفلت';
    if not found then raise exception 'invalid: meeting' using errcode = '22023'; end if;
  end if;
  if p_decision = 'add' then
    v_min := case when v_o.kind = 'rest_day' then v_o.minutes else coalesce(p_minutes, v_o.minutes) end;
    if v_min <= 0 or v_min > v_o.minutes then raise exception 'invalid: minutes' using errcode = '22023'; end if;
    v_pm := date_trunc('month', v_o.day)::date;
    while exists (select 1 from public.hr_payroll p where p.month = v_pm and p.status in ('معتمد', 'مدفوع')) loop
      v_pm := (v_pm + interval '1 month')::date;
    end loop;
    update public.hr_overtime set status = 'اتضاف', paid_minutes = v_min, pay_month = v_pm, decided_by = auth.uid(), decided_at = now(), reason = v_reason where id = p_id;
    return 'اتضاف';
  elsif p_decision = 'reject' then
    if v_reason is null then raise exception 'invalid: reason' using errcode = '22023'; end if;
    update public.hr_overtime set status = 'اترفض', paid_minutes = 0, pay_month = null, decided_by = auth.uid(), decided_at = now(), reason = v_reason where id = p_id;
    insert into public.hr_meetings (member_id, reason, ref, created_by) values (v_o.member_id, 'وقت إضافي اترفض — نعرف كان بيعمل إيه', 'OT-' || p_id, auth.uid());
    return 'اترفض';
  end if;
  raise exception 'invalid: decision' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------- the month's rating (decision 4)

-- hr.edit F: the actuals of the member's active KPIs (weights adding to 100) → the score = Σ min(achievement, 120) × weight;
-- achievement = actual ÷ target (target ÷ actual for an inverse KPI) × 100. Two warnings (< 70) in a quarter, or a full quarter
-- under 70 on average, opens a one-to-one meeting (once per quarter).
create or replace function public.hr_rate_month(p_member uuid, p_month date, p_actuals jsonb, p_note text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_sum numeric; v_score numeric := 0; k record; v_act numeric; v_ach numeric;
  v_q date := date_trunc('quarter', p_month)::date; v_ref text; v_low int; v_n int; v_avg numeric;
begin
  if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_month > date_trunc('month', public.hr_today())::date then raise exception 'invalid: month' using errcode = '22023'; end if;
  if p_actuals is null or jsonb_typeof(p_actuals) <> 'object' then raise exception 'invalid: actuals' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'invalid: note' using errcode = '22023'; end if;
  select sum(weight) into v_sum from public.hr_kpis where member_id = p_member and active;
  if v_sum is null or abs(v_sum - 100) > 0.01 then raise exception 'invalid: weights' using errcode = '22023'; end if;
  for k in select * from public.hr_kpis where member_id = p_member and active loop
    begin v_act := (p_actuals ->> k.id::text)::numeric; exception when others then raise exception 'invalid: actual' using errcode = '22023'; end;
    if v_act is null or v_act < 0 then raise exception 'invalid: actual' using errcode = '22023'; end if;
    v_ach := case when k.inverse then (case when v_act = 0 then 120 else k.target / v_act * 100 end) else v_act / k.target * 100 end;
    v_score := v_score + least(v_ach, 120) * k.weight / 100;
  end loop;
  v_score := round(v_score, 1);
  insert into public.hr_scores (member_id, month, score, actuals, note, rated_by, rated_at)
  values (p_member, v_month, v_score, p_actuals, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (member_id, month) do update set score = excluded.score, actuals = excluded.actuals, note = excluded.note, rated_by = auth.uid(), rated_at = now();
  v_ref := to_char(v_q, 'YYYY') || '-Q' || extract(quarter from v_q)::int;
  select count(*) filter (where score < 70), count(*), avg(score) into v_low, v_n, v_avg
    from public.hr_scores where member_id = p_member and month >= v_q and month < (v_q + interval '3 months')::date;
  if (v_low >= 2 or (v_n = 3 and v_avg < 70)) and not exists (select 1 from public.hr_meetings where member_id = p_member and ref = v_ref) then
    insert into public.hr_meetings (member_id, reason, ref, created_by) values (p_member, case when v_low >= 2 then 'إنذارين في نفس الربع' else 'ربع سيئ — السكور أقل من 70%' end, v_ref, auth.uid());
  end if;
  return v_score;
end $$;

-- ---------------------------------------------------------------- payroll (decisions 3 / 8 / 14)

-- the month's lines from the live data (the draft / review); approval snapshots them into hr_payroll_lines
create or replace function public.hr_payroll_calc(p_month date)
returns table (member_id uuid, name text, salary numeric, holdback numeric, paid numeric, ot_minutes int, ot_pay numeric, rest_days int,
  rest_pay numeric, unpaid_days numeric, unpaid_cut numeric, allowances numeric, deductions numeric, advance numeric, quarter_bonus numeric,
  net numeric, missing_scores int)
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
  q0 date := date_trunc('quarter', p_month)::date; q_end boolean := extract(month from p_month)::int % 3 = 0;
  q_ref text := to_char(date_trunc('quarter', p_month), 'YYYY') || '-Q' || extract(quarter from p_month)::int;
begin
  -- the cron / service_role carry no member (anon has no execute)
  if not (public.hr_salaries() or auth.uid() is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with mem as (
    select p.id, p.name, pay.salary s, pay.holdback hb, pay.allowances al
    from public.profiles p join public.hr_pay pay on pay.member_id = p.id
    where p.status = 'active' and pay.salary > 0
  ), hol as (
    select (h.day + g.i) as d from public.hr_holidays h cross join lateral generate_series(0, h.days - 1) g(i) where h.status = 'مؤكد'
  ), ot as (
    select o.member_id mid, sum(o.paid_minutes)::int mins from public.hr_overtime o
    where o.kind = 'hours' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), rest as (
    select o.member_id mid, count(*)::int n from public.hr_overtime o
    where o.kind = 'rest_day' and o.status = 'اتضاف' and o.pay_month = m0 group by o.member_id
  ), unpaid as (
    select r.member_id mid, count(*)::numeric n
    from public.hr_requests r join public.hr_leave_types t on t.name = r.type and t.unpaid
    cross join lateral generate_series(greatest(r.from_day, m0), least(r.to_day, m1 - 1), interval '1 day') g(d)
    where r.status = 'موافق' and extract(isodow from g.d) not in (5, 6) and g.d::date not in (select d from hol)
    group by r.member_id
  ), adj as (
    select j.member_id mid, sum(greatest(j.amount, 0)) plus, sum(greatest(-j.amount, 0)) minus
    from public.hr_adjustments j where j.month = m0 and j.voided_at is null group by j.member_id
  ), adv as (
    select r.member_id mid, sum(round(r.amount / r.months, 2)) per from public.hr_requests r
    where r.type = 'سُلفة' and r.status = 'موافق' and r.decided_at is not null
      and m0 >= (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + interval '1 month')::date
      and m0 < (date_trunc('month', r.decided_at at time zone 'Africa/Cairo') + make_interval(months => 1 + r.months))::date
    group by r.member_id
  ), sc as (
    select s.member_id mid, count(*)::int n, array_agg(s.score) scores from public.hr_scores s
    where s.month >= q0 and s.month < (q0 + interval '3 months')::date group by s.member_id
  ), ex as (
    select e.member_id mid, sum(e.amount) amt from public.hr_extras e where e.quarter = q_ref and e.status = 'معتمدة' group by e.member_id
  ), base as (
    select m.id, m.name, m.s, m.hb, round(m.s - m.hb, 2) as paid0,
      coalesce(ot.mins, 0) as otm, round(m.s / 24 / 8 * coalesce(ot.mins, 0) / 60, 2) as otp,
      coalesce(rest.n, 0) as rd, round(m.s / 24 * 2 * coalesce(rest.n, 0), 2) as rp,
      coalesce(unpaid.n, 0) as ud, round(m.s / 24 * coalesce(unpaid.n, 0), 2) as uc,
      round(m.al + coalesce(adj.plus, 0), 2) as al2, round(coalesce(adj.minus, 0), 2) as ded, round(coalesce(adv.per, 0), 2) as adv2,
      case when q_end then round(coalesce((select sum(case when x < 70 then 0 else m.hb * least(x, 100) / 100 end) from unnest(sc.scores) x), 0)
        + coalesce(ex.amt, 0), 2) else 0 end as qb,
      case when q_end then 3 - coalesce(sc.n, 0) else 0 end as miss
    from mem m
    left join ot on ot.mid = m.id left join rest on rest.mid = m.id left join unpaid on unpaid.mid = m.id
    left join adj on adj.mid = m.id left join adv on adv.mid = m.id left join sc on sc.mid = m.id left join ex on ex.mid = m.id
  )
  select b.id, b.name, b.s, b.hb, b.paid0, b.otm, b.otp, b.rd, b.rp, b.ud, b.uc, b.al2, b.ded, b.adv2, b.qb,
    round(b.paid0 + b.otp + b.rp + b.al2 - b.ded - b.adv2 - b.uc + b.qb, 2), b.miss
  from base b order by b.name;
end $$;

-- the month's sheet exists (pg_cron daily, the admin too); idempotent
create or replace function public.hr_payroll_open(p_month date default null) returns date
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, public.hr_today()))::date;
begin
  -- the cron / service_role carry no member (anon has no execute)
  if not (public.hr_salaries() or auth.uid() is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.hr_payroll (month) values (v_month) on conflict (month) do nothing;
  return v_month;
end $$;

-- مسودة ⇄ مراجعة → معتمد (the lines snapshotted) → back to مراجعة before it is paid (the lines dropped)
create or replace function public.hr_payroll_step(p_month date, p_step text) returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.hr_payroll; v_month date := date_trunc('month', p_month)::date;
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_p from public.hr_payroll where month = v_month for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not ((v_p.status = 'مسودة' and p_step = 'مراجعة') or (v_p.status = 'مراجعة' and p_step in ('مسودة', 'معتمد')) or (v_p.status = 'معتمد' and p_step = 'مراجعة')) then
    raise exception 'invalid: step' using errcode = '22023';
  end if;
  if p_step = 'معتمد' then
    delete from public.hr_payroll_lines where month = v_month;
    insert into public.hr_payroll_lines (month, member_id, name, salary, holdback, paid, ot_minutes, ot_pay, rest_days, rest_pay, unpaid_days, unpaid_cut,
      allowances, deductions, advance, quarter_bonus, net)
    select v_month, c.member_id, c.name, c.salary, c.holdback, c.paid, c.ot_minutes, c.ot_pay, c.rest_days, c.rest_pay, c.unpaid_days, c.unpaid_cut,
      c.allowances, c.deductions, c.advance, c.quarter_bonus, c.net from public.hr_payroll_calc(v_month) c;
    update public.hr_payroll set status = 'معتمد', approved_by = auth.uid(), approved_at = now(),
      total = (select coalesce(sum(net), 0) from public.hr_payroll_lines where month = v_month) where month = v_month;
  elsif p_step = 'مراجعة' then
    delete from public.hr_payroll_lines where month = v_month;
    update public.hr_payroll set status = 'مراجعة', reviewed_by = auth.uid(), reviewed_at = now(), approved_by = null, approved_at = null, total = null where month = v_month;
  else
    update public.hr_payroll set status = 'مسودة', reviewed_by = null, reviewed_at = null where month = v_month;
  end if;
  return p_step;
end $$;

-- مدفوع (decision 3): an «المرتبات» expense per member at the net + one withdrawal of the total from the account picked
create or replace function public.hr_payroll_pay(p_month date, p_account text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_p public.hr_payroll; v_month date := date_trunc('month', p_month)::date; v_total numeric; v_label text := to_char(date_trunc('month', p_month), 'YYYY-MM');
begin
  if not public.hr_salaries() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_account not in ('حساب البنك', 'حساب بوسطة', 'حساب باي موب', 'محفظة إلكترونية') then raise exception 'invalid: account' using errcode = '22023'; end if;
  select * into v_p from public.hr_payroll where month = v_month for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_p.status <> 'معتمد' then raise exception 'invalid: status' using errcode = '22023'; end if;
  select coalesce(sum(net), 0) into v_total from public.hr_payroll_lines where month = v_month and net > 0;
  insert into public.acc_expenses (on_date, direction, category, beneficiary, beneficiary_other, amount, note)
  select public.hr_today(), 'withdraw', 'المرتبات', left(l.name, 80), false, l.net, 'مرتب ' || v_label
  from public.hr_payroll_lines l where l.month = v_month and l.net > 0;
  if v_total > 0 then
    insert into public.acc_account_moves (account, on_date, direction, amount, note) values (p_account, public.hr_today(), 'withdraw', v_total, 'مرتبات ' || v_label);
  end if;
  update public.hr_payroll set status = 'مدفوع', paid_by = auth.uid(), paid_at = now(), paid_account = p_account, total = v_total where month = v_month;
  return v_total;
end $$;

-- ---------------------------------------------------------------- grants (rule 4)

grant select, insert, update on public.hr_members to authenticated;
grant select, insert, update on public.hr_pay to authenticated;
grant select on public.hr_attendance, public.hr_overtime, public.hr_scores, public.hr_payroll, public.hr_payroll_lines to authenticated;
grant select, insert, update on public.hr_holidays, public.hr_leave_types, public.hr_bonus_rules, public.hr_ot_periods, public.hr_kpis, public.hr_meetings,
  public.hr_extras to authenticated;
grant delete on public.hr_holidays, public.hr_ot_periods to authenticated;
grant select, insert on public.hr_adjustments to authenticated;
grant update (voided_at) on public.hr_adjustments to authenticated;
grant select, insert on public.hr_documents to authenticated;
grant update (voided_at) on public.hr_documents to authenticated;
revoke all on public.hr_requests from authenticated, anon;
grant select on public.hr_requests_v to authenticated;
grant all on public.hr_members, public.hr_pay, public.hr_attendance, public.hr_overtime, public.hr_requests, public.hr_holidays, public.hr_leave_types,
  public.hr_bonus_rules, public.hr_ot_periods, public.hr_kpis, public.hr_scores, public.hr_extras, public.hr_meetings, public.hr_adjustments,
  public.hr_payroll, public.hr_payroll_lines, public.hr_documents to service_role;
grant select on public.hr_requests_v to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

revoke execute on function public.hr_stamp(), public.hr_meetings_stamp(), public.hr_adjustments_guard(), public.hr_documents_guard() from public, anon, authenticated;
revoke execute on function public.hr_settings(), public.hr_doc_visible(text), public.hr_team() from public, anon;
grant execute on function public.hr_settings(), public.hr_doc_visible(text), public.hr_team() to authenticated, service_role;
revoke execute on function public.hr_payroll_calc(date), public.hr_payroll_open(date) from public, anon;
grant execute on function public.hr_rest_day(date), public.hr_today(), public.hr_active(), public.hr_is_manager_of(uuid), public.hr_can_see(uuid), public.hr_can_decide(uuid),
  public.hr_salaries(), public.hr_editor(), public.hr_at(date, time), public.hr_shift_now(), public.hr_clock_in(boolean), public.hr_clock_out(text, timestamptz),
  public.hr_attendance_set(uuid, date, time, time, boolean, text), public.hr_request_types(), public.hr_request_create(jsonb),
  public.hr_request_decide(bigint, text, text), public.hr_request_cancel(bigint), public.hr_overtime_decide(bigint, text, int, text),
  public.hr_rate_month(uuid, date, jsonb, text), public.hr_payroll_calc(date), public.hr_payroll_open(date), public.hr_payroll_step(date, text),
  public.hr_payroll_pay(date, text) to authenticated, service_role;

-- ---------------------------------------------------------------- live line: private broadcast «hr» / «changed», { at } only

create or replace function public.hr_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    begin
      execute 'select realtime.send($1, $2, $3, $4)' using jsonb_build_object('at', now()), 'changed', 'hr', true;
    exception when others then null;
    end;
  end if;
  return null;
end $$;
revoke execute on function public.hr_notify() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hr_attendance', 'hr_overtime', 'hr_requests', 'hr_meetings', 'hr_payroll', 'hr_scores'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_notify', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.hr_notify()', t || '_notify', t);
  end loop;
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute 'drop policy if exists hr_receive on realtime.messages';
    execute $p$create policy hr_receive on realtime.messages for select to authenticated
      using (realtime.topic() = 'hr' and extension = 'broadcast' and (select public.hr_active()))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- Storage: bucket «hr-docs» (the documents + a leave's report; guarded)
-- a file lands under the member's folder (<member uuid>/…): hr.edit F writes into any member's folder (the contract), a member
-- into their own (a medical report); nobody updates or deletes (a document is voided in hr_documents)

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and to_regclass('storage.buckets') is not null then
    execute $s$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('hr-docs', 'hr-docs', false, 10485760, '{image/png,image/jpeg,image/webp,application/pdf}')
               on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
    execute $s$drop policy if exists hr_docs_select on storage.objects$s$;
    execute $s$create policy hr_docs_select on storage.objects for select to authenticated
               using (bucket_id = 'hr-docs' and public.hr_doc_visible(name))$s$;
    execute $s$drop policy if exists hr_docs_insert on storage.objects$s$;
    execute $s$create policy hr_docs_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'hr-docs' and ((select public.hr_editor())
                 or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.hr_active()))))$s$;
  end if;
end $storage$;

-- ---------------------------------------------------------------- the month's sheet opens by itself (decision 8; guarded like 0008)

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0046_hr: pg_cron not installed — the payroll job skipped';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'hr-payroll-open') then perform cron.unschedule('hr-payroll-open'); end if;
  perform cron.schedule('hr-payroll-open', '5 22 * * *', $cron$ select public.hr_payroll_open(public.hr_today()) $cron$); -- 00:05 / 01:05 Cairo
end $$;
