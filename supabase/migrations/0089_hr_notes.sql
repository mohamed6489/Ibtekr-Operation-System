-- 0089_hr_notes.sql — owner batch 14 Nov decision 13 (docs/superpowers/plans/2026-11-14-owner-batch.md, the owner: «⋮ في جدول التقييم» —
-- «تقييم قليل: ميتنج + إنذار · تقييم قليل: خطة تحسين · تقييم عالي: شكر + مكافأة»). Re-runnable.
-- * hr_notes_log: a note on a member about an evaluation period — kind meeting | warning | plan | thanks; period YYYY-MM (a month row) or
--   YYYY-Qn (a quarter row); body (the warning's reason / the plan's goals / the meeting's agenda / the thanks, ≤ 1000); due_at (the
--   meeting's time, required — the plan's review day, optional); ticket_id (the meeting's team request); by_id + at. Added only: nobody
--   updates or deletes a note (a mistake gets a new one), and it goes with the member (cascade — member_delete counts it as a record).
-- * Seen by the member themself and whoever sees their HR rows (hr_can_see); written only by hr_member_note_add.
-- * hr_member_note_add(member, kind, period, body, due_at): the admin, hr.edit F or the direct manager — never on oneself. A meeting
--   opens a team request (internal, to the member's role, opened by the writer) whose title and text carry the time only — no rating,
--   no agenda (a role's tickets are seen by the whole role; the HR detail stays in this table). Every note rings the member's bell
--   (kind «hr.note»; the meeting → its request, the rest → «ملفي › أدائي»). activity_log «hr.note.add» with the kind and the period only.
-- * «أضف مكافأة» on a high row is the payroll bonus popup (hr_adjustments, sensitive.salaries) — nothing new here.

create table if not exists public.hr_notes_log (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('meeting', 'warning', 'plan', 'thanks')),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2]|Q[1-4])$'),
  body text check (body is null or char_length(body) between 1 and 1000),
  due_at timestamptz,
  ticket_id bigint references public.tickets on delete set null,
  by_id uuid not null references public.profiles default auth.uid(),
  at timestamptz not null default now(),
  check (kind <> 'meeting' or due_at is not null),
  check (kind in ('meeting', 'plan') or due_at is null)
);
create index if not exists hr_notes_log_member_idx on public.hr_notes_log (member_id, at desc);

alter table public.hr_notes_log enable row level security;
drop policy if exists hr_notes_log_select on public.hr_notes_log;
create policy hr_notes_log_select on public.hr_notes_log for select to authenticated using (public.hr_can_see(member_id));
revoke all on public.hr_notes_log from public, anon, authenticated;
grant select on public.hr_notes_log to authenticated;
grant all on public.hr_notes_log to service_role;

-- the page refreshes on the «hr» broadcast like the other HR tables
drop trigger if exists hr_notes_log_notify on public.hr_notes_log;
create trigger hr_notes_log_notify after insert or update or delete on public.hr_notes_log for each statement execute function public.hr_notify();

create or replace function public.hr_member_note_add(p_member uuid, p_kind text, p_period text, p_body text default null, p_due timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_p public.profiles; v_me public.profiles; v_body text := nullif(btrim(coalesce(p_body, '')), ''); v_id bigint; v_t bigint;
  v_cur text := to_char(public.hr_today(), 'YYYY-MM'); v_cur_q text; v_role text; v_name text; v_when text; v_title text; v_entity text;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_p from public.profiles where id = p_member;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_member = auth.uid() or not (public.is_admin() or public.hr_editor() or public.hr_is_manager_of(p_member)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_p.status <> 'active' then raise exception 'invalid: member' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('meeting', 'warning', 'plan', 'thanks') then raise exception 'invalid: kind' using errcode = '22023'; end if;
  v_cur_q := to_char(public.hr_today(), 'YYYY') || '-Q' || to_char(public.hr_today(), 'Q');
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2]|Q[1-4])$'
     or (p_period ~ 'Q' and p_period > v_cur_q) or (p_period !~ 'Q' and p_period > v_cur) then
    raise exception 'invalid: period' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 1000 then raise exception 'invalid: body' using errcode = '22023'; end if;
  if p_kind in ('warning', 'plan') and v_body is null then raise exception 'invalid: body' using errcode = '22023'; end if;
  if p_kind = 'meeting' and (p_due is null or p_due < now() - interval '10 minutes' or p_due > now() + interval '90 days') then
    raise exception 'invalid: due' using errcode = '22023';
  end if;
  if p_kind = 'plan' and p_due is not null and ((p_due at time zone 'Africa/Cairo')::date < public.hr_today() or p_due > now() + interval '366 days') then
    raise exception 'invalid: due' using errcode = '22023';
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  v_name := left(coalesce(nullif(btrim(v_p.name), ''), 'عضو'), 60);
  if p_kind = 'meeting' then
    v_when := to_char(p_due at time zone 'Africa/Cairo', 'DD/MM') || ' الساعة ' || to_char(p_due at time zone 'Africa/Cairo', 'HH24:MI');
    v_role := coalesce((public.ticket_role_labels(v_p.role_id))[1], 'مدير النظام');
    insert into public.tickets (type, title, description, priority, assignee_role, status, follow_up, created_by, created_by_name, created_by_role)
    values ('internal', left('ميتنج فردي — ' || v_name || ' · ' || v_when, 80),
      'ميتنج فردي بين ' || v_name || ' و' || left(coalesce(v_me.name, 'المدير'), 60) || ' يوم ' || v_when || '. التفاصيل عند الموارد البشرية.',
      'normal', v_role, 'open', (p_due at time zone 'Africa/Cairo')::date, auth.uid(), left(coalesce(v_me.name, 'عضو'), 120),
      left(coalesce((public.ticket_role_labels(v_me.role_id))[1], 'عضو'), 60))
    returning id into v_t;
    insert into public.ticket_events (ticket_id, kind, actor, actor_name, actor_role, text, new_value)
    values (v_t, 'event', auth.uid(), left(coalesce(v_me.name, 'عضو'), 120), left(coalesce((public.ticket_role_labels(v_me.role_id))[1], 'عضو'), 60), 'فتح التذكرة', 'open');
  end if;
  insert into public.hr_notes_log (member_id, kind, period, body, due_at, ticket_id, by_id)
  values (p_member, p_kind, p_period, v_body, case when p_kind in ('meeting', 'plan') then p_due end, v_t, auth.uid())
  returning id into v_id;
  v_title := case p_kind
    when 'meeting' then 'عندك ميتنج فردي يوم ' || v_when
    when 'warning' then 'وصلك إنذار'
    when 'plan' then 'اتعملك خطة تحسين'
    else 'وصلك شكر على شغلك' end;
  v_entity := case when v_t is not null then 'tickets/TKT-' || lpad(v_t::text, 4, '0') else 'profile-performance' end;
  insert into public.alerts (kind, title, body, user_id, entity, entity_id)
  values ('hr.note', v_title, 'من ' || left(coalesce(v_me.name, 'المدير'), 60) || ' — التفاصيل في «ملفي › أدائي»', p_member, v_entity, 'note:' || v_id);
  perform public.log_activity('hr.note.add', 'hr', p_member::text, null, to_jsonb(p_kind || ' ' || p_period)); -- no text in the log
  return jsonb_build_object('id', v_id, 'ticket', v_t);
end $$;
revoke execute on function public.hr_member_note_add(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.hr_member_note_add(uuid, text, text, text, timestamptz) to authenticated, service_role;
