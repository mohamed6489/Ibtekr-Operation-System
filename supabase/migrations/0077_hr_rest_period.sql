-- 0077 — phase 13 decision 66 (owner 11 Nov — «بدل تذكرة جديدة طلب جديد … وأنواع الطلبات: مشكلة عميل، مشكلة مبتكر، طلب إجازة، طلب سلفة،
-- طلب فترة راحة، طلب خاص … وفي فترة الراحة يتم اختيار تاريخ وعدد ساعات وبداية ونهاية وقت»): a new HR request type «فترة راحة» —
-- one day, a start time (at_time) and its hours (0.5–12, the end = start + hours, inside the day); it opens its team ticket like the
-- others (hr_req_ticket — the ticket's title «طلب فترة راحة», no time or hours in it). Re-runnable; the 0071 functions with the new type.

create or replace function public.hr_request_types() returns text[]
language sql stable security definer set search_path = public as $$
  select array_cat(coalesce((select array_agg(t.name order by t.sort, t.name) from public.hr_leave_types t), '{}'::text[]),
    array['شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف', 'سُلفة', 'فترة راحة'])
$$;

create or replace function public.hr_req_family(p_type text) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.hr_leave_types t where t.name = p_type) then 'طلب إجازة'
              when p_type in ('شغل عن بُعد', 'إذن انصراف مبكر', 'تصحيح انصراف', 'فترة راحة') then 'طلب ' || p_type
              else 'طلب موارد بشرية' end
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
  elsif v_type = 'فترة راحة' then -- decision 66: one day, a start time and its hours (the end = start + hours)
    if v_at is null then raise exception 'invalid: time' using errcode = '22023'; end if;
    if v_hours is null or v_hours < 0.5 or v_hours > 12 or (v_at + make_interval(mins => (v_hours * 60)::int)) < v_at then raise exception 'invalid: hours' using errcode = '22023'; end if;
    v_to := v_from; v_amount := null; v_months := null;
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
  if not exists (select 1 from public.hr_leave_types t where t.name = v_type) then v_doc := null; end if;
  if v_doc is not null and (char_length(v_doc) > 300 or v_doc not like v_member::text || '/%' or v_doc like '%..%') then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  if v_doc is null and exists (select 1 from public.hr_leave_types t where t.name = v_type and btrim(t.doc) not in ('', '—', '-')) then
    raise exception 'invalid: doc' using errcode = '22023';
  end if;
  insert into public.hr_requests (member_id, type, from_day, to_day, at_time, hours, amount, months, note, doc_path)
  values (v_member, v_type, v_from, v_to, v_at, v_hours, v_amount, v_months, v_note, v_doc) returning id into v_id;
  perform public.hr_req_ticket(v_id); -- decision 33
  return v_id;
end $$;


revoke execute on function public.hr_request_types(), public.hr_req_family(text), public.hr_request_create(jsonb) from public, anon;
revoke execute on function public.hr_req_family(text) from authenticated;
grant execute on function public.hr_request_types(), public.hr_request_create(jsonb) to authenticated, service_role;
grant execute on function public.hr_req_family(text) to service_role;
