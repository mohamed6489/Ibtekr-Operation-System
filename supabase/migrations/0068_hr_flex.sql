-- 0068_hr_flex.sql — phase 13 decision 24 (the owner, 10 Nov: «يطلع زرار بدء الدوام من الأول بحيث إن المستخدم يقدر يبتدي وينهي ساعات
-- العمل أكتر من مرة في اليوم وكل مرة يتحسب عدد ساعات العمل بحيث يبقى flexibility في ساعات العمل» + «مع المرونة مفيش تأخير»): flexible hours.
-- A row of hr_attendance is a SESSION now — «ابدأ الدوام» after «خلص الدوام» opens another one the same day — and the day's hours are the sum
-- of its sessions. There is no lateness (the web drops it; the payroll never had it). Re-runnable.
-- * the one-row-a-day rule (unique (member_id, day)) goes; an index on (member_id, day) keeps the reads.
-- * hr_shift_now: the open session first, else today's latest — plus `done` (the minutes of that day's OTHER closed sessions) and `sessions`.
-- * hr_clock_in: a new session whenever none is open (no more «invalid: ended»).
-- * hr_clock_out: the overtime is what passes 8 hours of the DAY (its closed sessions + this one), only this session's part of it; a rest
--   day's single ×2 row grows with each session while it still waits for the manager.
-- * hr_attendance_set (hr.edit F, by hand): the day as one session — the hand entry replaces the day (its other sessions go), as it did.
-- * hr_attendance_close (new, hr.edit F): sets the end of ONE session — «إنهاء الدوام» for a member (an open one, now) and «تصحيح انصراف
--   ناقص» (the time typed, also after an approved request closed it at the request's time) — so the other sessions of the day keep their hours.
-- * hr_request_decide: an approved «تصحيح انصراف» closes that day's open session (else its latest), not every session of the day.

alter table public.hr_attendance drop constraint if exists hr_attendance_member_id_day_key;
create index if not exists hr_attendance_member_day_idx on public.hr_attendance (member_id, day);

-- the minutes of a member's closed sessions on a day, but one (the session being shown / closed)
create or replace function public.hr_day_done(p_member uuid, p_day date, p_except bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(floor(extract(epoch from (x.out_at - x.in_at)) / 60)), 0)::int
  from public.hr_attendance x
  where x.member_id = p_member and x.day = p_day and x.out_at is not null and x.id is distinct from p_except
$$;

-- my open session (a refresh or another device picks it up): the latest row of mine without an out within 20 hours, else today's latest
create or replace function public.hr_shift_now() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.hr_active() then null else (
    select jsonb_build_object('id', a.id, 'day', a.day, 'in_at', a.in_at, 'out_at', a.out_at, 'remote', a.remote,
      'done', public.hr_day_done(a.member_id, a.day, a.id),
      'sessions', (select count(*)::int from public.hr_attendance x where x.member_id = a.member_id and x.day = a.day))
    from public.hr_attendance a
    where a.member_id = auth.uid() and (a.out_at is null and a.in_at > now() - interval '20 hours' or a.day = public.hr_today())
    order by (a.out_at is null) desc, a.in_at desc limit 1) end
$$;

-- «عن بُعد» is the server's, never the caller's (security review of T6): an approved «شغل عن بُعد» request of mine covering today
create or replace function public.hr_clock_in() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_remote boolean;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('hr_clock:' || auth.uid()::text));   -- two tabs pressing at once = one session
  if exists (select 1 from public.hr_attendance where member_id = auth.uid() and out_at is null and in_at > now() - interval '20 hours') then
    return public.hr_shift_now();                                            -- already in (another tab / device)
  end if;
  v_remote := exists (select 1 from public.hr_requests r where r.member_id = auth.uid() and r.type = 'شغل عن بُعد' and r.status = 'موافق'
    and public.hr_today() between r.from_day and r.to_day);
  insert into public.hr_attendance (member_id, day, in_at, remote, source) values (auth.uid(), public.hr_today(), now(), v_remote, 'clock');
  return public.hr_shift_now();
end $$;

-- a rest day / holiday worked: one ×2 row for the day, its minutes growing with each session while it waits for the manager
create or replace function public.hr_rest_day_add(p_member uuid, p_day date, p_in timestamptz, p_out timestamptz, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_min int := floor(extract(epoch from (p_out - p_in)) / 60); v_id bigint;
begin
  if v_min <= 0 then return null; end if;
  insert into public.hr_overtime as o (member_id, day, start_at, end_at, minutes, kind, note)
  values (p_member, p_day, p_in, p_out, least(v_min, 1440), 'rest_day', p_note)
  on conflict (member_id, day) where kind = 'rest_day' do update
    set minutes = least(o.minutes + excluded.minutes, 1440), start_at = least(o.start_at, excluded.start_at), end_at = greatest(o.end_at, excluded.end_at)
    where o.status = 'مستني'
  returning o.id into v_id;
  return v_id;
end $$;

-- the end of my session: now (or p_at — the time «لسه شغال؟» was shown, or the moment the day reached 8 hours); the overtime is the part of
-- this session past 8 hours of the day, written when I said what I worked on (block 12: validateOtEnd)
create or replace function public.hr_clock_out(p_ot_note text default null, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_out timestamptz; v_worked int; v_shift int := 480; v_before int; v_total int; v_part int; v_ot bigint;
  v_note text := nullif(btrim(coalesce(p_ot_note, '')), '');
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
  v_before := public.hr_day_done(auth.uid(), v_row.day, v_row.id);
  v_total := v_before + v_worked;
  if public.hr_rest_day(v_row.day) then
    v_ot := public.hr_rest_day_add(auth.uid(), v_row.day, v_row.in_at, v_out, coalesce(v_note, 'شغل يوم راحة / عطلة'));
    return jsonb_build_object('worked', v_worked, 'day_total', v_total, 'overtime_id', v_ot, 'overtime', 0, 'rest_day', true);
  end if;
  v_part := least(v_worked, greatest(v_total - v_shift, 0));
  if v_note is not null and v_part > 0 then
    insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, note)
    values (auth.uid(), v_row.day, v_out - make_interval(mins => v_part), v_out, v_part, v_note)
    returning id into v_ot;
  end if;
  return jsonb_build_object('worked', v_worked, 'day_total', v_total, 'overtime_id', v_ot, 'overtime', case when v_ot is null then 0 else v_part end);
end $$;

-- hr.edit F: a member's day by hand (Cairo times; out may be empty) — the day as one session: its other sessions go
create or replace function public.hr_attendance_set(p_member uuid, p_day date, p_in time, p_out time default null, p_remote boolean default false, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_src text; v_open boolean; v_in timestamptz; v_out timestamptz;
begin
  if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_member is null or p_day is null or p_in is null or p_day > public.hr_today() then raise exception 'invalid: day' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'not found' using errcode = 'P0002'; end if;
  v_in := public.hr_at(p_day, p_in);
  v_out := case when p_out is null then null when p_out < p_in then public.hr_at(p_day + 1, p_out) else public.hr_at(p_day, p_out) end;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('hr_clock:' || p_member::text));
  select a.id, a.source, a.out_at is null into v_id, v_src, v_open from public.hr_attendance a
    where a.member_id = p_member and a.day = p_day order by a.in_at limit 1 for update;
  if v_id is null then
    insert into public.hr_attendance (member_id, day, in_at, out_at, remote, source, note, by_id)
    values (p_member, p_day, v_in, v_out, coalesce(p_remote, false), 'manual', nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;
  else
    delete from public.hr_attendance where member_id = p_member and day = p_day and id <> v_id;
    update public.hr_attendance set in_at = v_in, out_at = v_out, remote = coalesce(p_remote, false),
      source = case when v_src = 'clock' and v_open then 'fix' else 'manual' end, note = nullif(btrim(coalesce(p_note, '')), ''), by_id = auth.uid(), updated_at = now()
    where id = v_id;
  end if;
  if v_out is not null and v_out > v_in and public.hr_rest_day(p_day) then
    insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note)
    values (p_member, p_day, v_in, v_out, least(floor(extract(epoch from (v_out - v_in)) / 60)::int, 1440), 'rest_day', 'شغل يوم راحة / عطلة (يدوي)')
    on conflict (member_id, day) where kind = 'rest_day' do nothing;
  end if;
  return v_id;
end $$;

-- hr.edit F: the end of one session at p_out (Cairo time on its day — past midnight = the next day; empty = now, an open session only):
-- «إنهاء الدوام» for a member and «تصحيح انصراف ناقص»; the day's other sessions stay as they are
create or replace function public.hr_attendance_close(p_id bigint, p_out time default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_row public.hr_attendance; v_out timestamptz; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.hr_editor() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_row from public.hr_attendance where id = p_id for update;
  if not found or not public.hr_can_see(v_row.member_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_row.out_at is not null and p_out is null then raise exception 'invalid: at' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  v_out := case when p_out is null then now()
    when public.hr_at(v_row.day, p_out) >= v_row.in_at then public.hr_at(v_row.day, p_out) else public.hr_at(v_row.day + 1, p_out) end;
  if v_out < v_row.in_at or v_out > now() + interval '1 minute' then raise exception 'invalid: at' using errcode = '22023'; end if;
  update public.hr_attendance set out_at = least(v_out, now()), source = 'fix', note = coalesce(v_note, note), by_id = auth.uid(), updated_at = now() where id = p_id;
  if v_row.out_at is null and public.hr_rest_day(v_row.day) then   -- a corrected end of a closed session is already in the ×2 row
    perform public.hr_rest_day_add(v_row.member_id, v_row.day, v_row.in_at, least(v_out, now()), 'شغل يوم راحة / عطلة (يدوي)');
  end if;
  return p_id;
end $$;

-- موافق / مرفوض (a reason) / قيد المراجعة; an approved «تصحيح انصراف» closes that day's open session (else its latest) at its time
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
    where id = (select a.id from public.hr_attendance a where a.member_id = v_r.member_id and a.day = v_r.from_day
                order by (a.out_at is null) desc, a.in_at desc limit 1);
  end if;
  return p_decision;
end $$;

-- the grants (rule 4 / 0050): the new definer functions closed to public and anon
revoke execute on function public.hr_day_done(uuid, date, bigint), public.hr_rest_day_add(uuid, date, timestamptz, timestamptz, text),
  public.hr_attendance_close(bigint, time, text) from public, anon;
revoke execute on function public.hr_day_done(uuid, date, bigint), public.hr_rest_day_add(uuid, date, timestamptz, timestamptz, text) from authenticated;
grant execute on function public.hr_attendance_close(bigint, time, text) to authenticated;
grant execute on function public.hr_day_done(uuid, date, bigint), public.hr_rest_day_add(uuid, date, timestamptz, timestamptz, text),
  public.hr_attendance_close(bigint, time, text) to service_role;
