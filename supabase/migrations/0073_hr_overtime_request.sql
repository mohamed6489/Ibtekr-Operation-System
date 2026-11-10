-- 0073 — phase 13 decision 44 (owner 10 Nov — «في الدروب داون بتاع البروفايل "طلب وقت إضافي"، ولما يدوس عليه يفتح بوب أب فيه إمكانية
-- لإضافة الوقت الإضافي وإرسال طلب بيوصل للأدمن والمصرح ليهم في الموافقة على الطلب»):
-- * hr_overtime_request(day, from, to, note) — the member asks for overtime they worked (a day in the last 31, Cairo times, the end not
--   in the future, 15 minutes to 12 hours, what they worked on 1–300) without it being tied to the clock. It is a row of hr_overtime
--   «مستني» like the clock's (decided the same way by hr_overtime_decide — the direct manager, hr.approve F or the admin; a rest day /
--   holiday the admins only, decision 32), with its request ticket (hr_ot_ticket — to the direct manager's role, else «مدير النظام»).
--   Never twice for the same time: a range overlapping another of my overtime rows that is not refused → 22023 'invalid: overlap'.
-- * The bell: the admins and the direct manager as hr_ot_ticket rings them (the title says «طلب وقت إضافي»), plus every active member
--   whose effective hr.approve and hr.view are F (they decide it from «الموارد البشرية › الطلبات») — an ordinary day only; a rest day
--   is the admins'. The ticket and the alerts carry the minutes at most: what was worked on and the times stay in hr_overtime (hr_can_see).

create or replace function public.hr_overtime_request(p_day date, p_from text, p_to text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_note text := btrim(coalesce(p_note, '')); v_from time; v_to time; v_start timestamptz; v_end timestamptz; v_min int;
  v_rest boolean; v_t bigint; v_id bigint; v_name text; v_mgr uuid;
begin
  if not public.hr_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_day is null or p_day > public.hr_today() or p_day < public.hr_today() - 31 then raise exception 'invalid: day' using errcode = '22023'; end if;
  if coalesce(p_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid: from' using errcode = '22023'; end if;
  if coalesce(p_to, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid: to' using errcode = '22023'; end if;
  if char_length(v_note) not between 1 and 300 then raise exception 'invalid: note' using errcode = '22023'; end if;
  v_from := p_from::time; v_to := p_to::time;
  v_start := (p_day + v_from) at time zone 'Africa/Cairo'; v_end := (p_day + v_to) at time zone 'Africa/Cairo';
  v_min := floor(extract(epoch from (v_end - v_start)) / 60);
  if v_min < 15 or v_min > 720 then raise exception 'invalid: minutes' using errcode = '22023'; end if;
  if v_end > now() then raise exception 'invalid: to' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = auth.uid() for update; -- one request at a time per member (the overlap check below)
  if exists (select 1 from public.hr_overtime o where o.member_id = auth.uid() and o.status <> 'اترفض'
             and tstzrange(o.start_at, o.end_at) && tstzrange(v_start, v_end)) then
    raise exception 'invalid: overlap' using errcode = '22023';
  end if;
  v_rest := public.hr_rest_day(p_day);
  -- a rest day has one row a day (hr_overtime_rest_day_idx, any status): a second ask for it is the same overlap
  if v_rest and exists (select 1 from public.hr_overtime o where o.member_id = auth.uid() and o.day = p_day and o.kind = 'rest_day') then
    raise exception 'invalid: overlap' using errcode = '22023';
  end if;
  v_t := public.hr_ot_ticket(auth.uid(), p_day, v_rest);
  update public.alerts set title = replace(replace(title, ' بدأ وقت إضافي', ' طلب وقت إضافي'), ' بيشتغل يوم راحة/عطلة', ' طلب يوم راحة/عطلة اشتغله')
  where entity_id = 'ot:' || v_t;
  insert into public.hr_overtime (member_id, day, start_at, end_at, minutes, kind, note, ticket_id)
  values (auth.uid(), p_day, v_start, v_end, v_min, case when v_rest then 'rest_day' else 'hours' end, v_note, v_t)
  returning id into v_id;
  perform public.hr_ot_event(v_t, 'طلب وقت إضافي: ' || v_min || ' دقيقة — مستني الموافقة (التفاصيل في «الموارد البشرية › الطلبات»)');
  if not v_rest then
    select left(coalesce(nullif(btrim(p.name), ''), 'عضو'), 60), p.manager_id into v_name, v_mgr from public.profiles p where p.id = auth.uid();
    insert into public.alerts (kind, title, body, user_id, entity, entity_id)
    select 'hr.overtime', v_name || ' طلب وقت إضافي', 'محتاج موافقة', p.id, 'hr-requests', 'ot:' || v_t
    from public.profiles p left join public.roles r on r.id = p.role_id
    where p.status = 'active' and p.id <> auth.uid() and p.role_id is distinct from 'admin' and p.id is distinct from v_mgr
      and coalesce(p.custom_perms ->> 'hr.approve', r.permissions ->> 'hr.approve') = 'F'
      and coalesce(p.custom_perms ->> 'hr.view', r.permissions ->> 'hr.view') = 'F';
  end if;
  return jsonb_build_object('id', v_id, 'ticket', v_t, 'minutes', v_min, 'rest_day', v_rest);
end $$;
revoke execute on function public.hr_overtime_request(date, text, text, text) from public, anon;
grant execute on function public.hr_overtime_request(date, text, text, text) to authenticated, service_role;
