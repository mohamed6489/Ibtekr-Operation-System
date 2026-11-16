-- Tests for 0113_ticket_group_voice (the owner 16 Nov): a request with more people in it (a group) and voice notes. One transaction,
-- rolled back; NOTICE 'rls_ticket_group: ok' only if every case passed. Live-safe: made-up members and tickets.
-- * ticket_create members: active, tickets.view <> N, deduped, the opener left out — else 22023 invalid: members
-- * a member in the list sees the request, writes in it and works it (status incl. «open»); nobody else gains it
-- * add_members: anyone in the request; remove_member: the opener or the admin, or a member taking themselves out
-- * close / reopen stay the opener's and the admin's — a member of the group is refused 42501
-- * a voice note: audio of ≤ 3 MB with 1–60 seconds; a voice note alone is a message («رسالة صوتية»)

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-000000113a01', 'tg-adm.dev@ibtekr.local', '0100000113a1'),
  ('00000000-0000-4000-8000-000000113a02', 'tg-open.dev@ibtekr.local', '0100000113a2'),
  ('00000000-0000-4000-8000-000000113a03', 'tg-b.dev@ibtekr.local', '0100000113a3'),
  ('00000000-0000-4000-8000-000000113a04', 'tg-c.dev@ibtekr.local', '0100000113a4'),
  ('00000000-0000-4000-8000-000000113a05', 'tg-none.dev@ibtekr.local', '0100000113a5'),
  ('00000000-0000-4000-8000-000000113a06', 'tg-off.dev@ibtekr.local', '0100000113a6');
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms, extra_roles) values
  ('00000000-0000-4000-8000-000000113a01', 'أدمن الجروب', 'tg-adm.dev@ibtekr.local', '0100000113a1', 'admin', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-000000113a02', 'فاتح الطلب', 'tg-open.dev@ibtekr.local', '0100000113a2', 'accounts', 'active', '{}', '{}'),
  ('00000000-0000-4000-8000-000000113a03', 'بسمة', 'tg-b.dev@ibtekr.local', '0100000113a3', 'viewer', 'active', '{"tickets.view":"P","tickets.manage":"F"}', '{}'),
  ('00000000-0000-4000-8000-000000113a04', 'كريم', 'tg-c.dev@ibtekr.local', '0100000113a4', 'viewer', 'active', '{"tickets.view":"P","tickets.manage":"F"}', '{}'),
  ('00000000-0000-4000-8000-000000113a05', 'من غير طلبات', 'tg-none.dev@ibtekr.local', '0100000113a5', 'viewer', 'active', '{"tickets.view":"N"}', '{}'),
  ('00000000-0000-4000-8000-000000113a06', 'موقوف', 'tg-off.dev@ibtekr.local', '0100000113a6', 'viewer', 'suspended', '{"tickets.view":"P","tickets.manage":"F"}', '{}');

create or replace function pg_temp.as_member(p_uid text) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create temp table tg_ids (k text primary key, id bigint);
grant all on tg_ids to authenticated;

-- ================================================================ ticket_create with members
select pg_temp.as_member('00000000-0000-4000-8000-000000113a02');
do $$
declare v_id bigint;
begin
  v_id := public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'طلب جروب', 'description', 'نتكلم سوا', 'priority', 'normal',
    'assigneeRole', 'خدمة العملاء',
    'members', jsonb_build_array('00000000-0000-4000-8000-000000113a03', '00000000-0000-4000-8000-000000113a03', '00000000-0000-4000-8000-000000113a02')));
  insert into tg_ids values ('g', v_id);
  if (select members from public.tickets where id = v_id) <> array['00000000-0000-4000-8000-000000113a03']::uuid[] then
    raise exception 'case the members are deduped without the opener failed';
  end if;
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text like '%ضاف للطلب: بسمة%') then raise exception 'case the event names the members failed'; end if;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'خدمة العملاء',
    'members', jsonb_build_array('00000000-0000-4000-8000-000000113a05')));
    raise exception 'case a member without tickets.view is refused failed'; exception when invalid_parameter_value then if sqlerrm <> 'invalid: members' then raise; end if; end;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'خدمة العملاء',
    'members', jsonb_build_array('00000000-0000-4000-8000-000000113a06')));
    raise exception 'case a suspended member is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'y', 'priority', 'low', 'assigneeRole', 'خدمة العملاء',
    'members', jsonb_build_array('بسمة')));
    raise exception 'case a bad member id is refused failed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ================================================================ ticket_people: names only, the active members who read the requests
select pg_temp.as_member('00000000-0000-4000-8000-000000113a03');
do $$ begin
  if not exists (select 1 from public.ticket_people() where id = '00000000-0000-4000-8000-000000113a04' and name = 'كريم') then raise exception 'case ticket_people lists a member failed'; end if;
  if exists (select 1 from public.ticket_people() where id in ('00000000-0000-4000-8000-000000113a05', '00000000-0000-4000-8000-000000113a06')) then raise exception 'case ticket_people leaves out no-view and suspended failed'; end if;
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000113a05');
do $$ begin
  if exists (select 1 from public.ticket_people()) then raise exception 'case ticket_people is empty without tickets.manage failed'; end if;
end $$;
reset role;

-- ================================================================ a member of the group sees, writes and works it
select pg_temp.as_member('00000000-0000-4000-8000-000000113a03');
do $$
declare v_id bigint := (select id from tg_ids where k = 'g');
begin
  if not exists (select 1 from public.tickets where id = v_id) then raise exception 'case a member sees the request failed'; end if;
  if (select count(*) from public.ticket_events where ticket_id = v_id) < 2 then raise exception 'case a member reads the events failed'; end if;
  perform public.ticket_act(v_id, 'reply', '{"text":"معاكم"}');
  perform public.ticket_act(v_id, 'set_status', '{"status":"in_progress"}');
  perform public.ticket_act(v_id, 'set_status', '{"status":"open"}');
  if (select status from public.tickets where id = v_id) <> 'open' then raise exception 'case set_status open failed'; end if;
  -- a voice note alone
  perform public.ticket_act(v_id, 'reply', jsonb_build_object('text', '', 'attachments', jsonb_build_array(jsonb_build_object(
    'path', '00000000-0000-4000-8000-000000113a03/v1-voice.webm', 'type', 'audio/webm', 'size', 40000, 'duration', 12.4))));
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text = 'رسالة صوتية' and (attachments -> 0 ->> 'duration')::numeric = 12.4) then
    raise exception 'case a voice note alone is a message with its length failed';
  end if;
  begin perform public.ticket_act(v_id, 'reply', jsonb_build_object('text', '', 'attachments', jsonb_build_array(jsonb_build_object(
    'path', '00000000-0000-4000-8000-000000113a03/v2-voice.webm', 'type', 'audio/webm', 'size', 40000, 'duration', 75))));
    raise exception 'case a voice note over 60 seconds is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_act(v_id, 'reply', jsonb_build_object('text', '', 'attachments', jsonb_build_array(jsonb_build_object(
    'path', '00000000-0000-4000-8000-000000113a03/v3-voice.mp4', 'type', 'audio/mp4', 'size', 4000000, 'duration', 30))));
    raise exception 'case a voice note over 3 MB is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_act(v_id, 'reply', jsonb_build_object('text', '', 'attachments', jsonb_build_array(jsonb_build_object(
    'path', '00000000-0000-4000-8000-000000113a03/v4-voice.webm', 'type', 'audio/webm', 'size', 1000))));
    raise exception 'case a voice note without its length is refused failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_act(v_id, 'reply', '{"text":""}'); raise exception 'case an empty reply is refused failed'; exception when invalid_parameter_value then null; end;
  -- close / reopen are not a member's
  begin perform public.ticket_act(v_id, 'close', '{}'); raise exception 'case a member cannot close failed'; exception when insufficient_privilege then null; end;
  -- anyone in the request adds
  perform public.ticket_act(v_id, 'add_members', jsonb_build_object('members', jsonb_build_array('00000000-0000-4000-8000-000000113a04')));
  if not exists (select 1 from public.tickets where id = v_id and '00000000-0000-4000-8000-000000113a04'::uuid = any (members)) then raise exception 'case a member adds failed'; end if;
  begin perform public.ticket_act(v_id, 'add_members', jsonb_build_object('members', jsonb_build_array('00000000-0000-4000-8000-000000113a05')));
    raise exception 'case adding a member without tickets.view is refused failed'; exception when invalid_parameter_value then null; end;
  -- only the opener or the admin takes someone else out
  begin perform public.ticket_act(v_id, 'remove_member', '{"member":"00000000-0000-4000-8000-000000113a04"}');
    raise exception 'case a member cannot take another out failed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- a member outside the group sees nothing until added (checked above), and may leave
select pg_temp.as_member('00000000-0000-4000-8000-000000113a04');
do $$
declare v_id bigint := (select id from tg_ids where k = 'g');
begin
  if not exists (select 1 from public.tickets where id = v_id) then raise exception 'case an added member sees the request failed'; end if;
  perform public.ticket_act(v_id, 'remove_member', '{"member":"00000000-0000-4000-8000-000000113a04"}');
  if exists (select 1 from public.tickets where id = v_id) then raise exception 'case a member who left no longer sees it failed'; end if;
end $$;
reset role;

-- the opener takes a member out; then that member no longer sees it
select pg_temp.as_member('00000000-0000-4000-8000-000000113a02');
do $$
declare v_id bigint := (select id from tg_ids where k = 'g');
begin
  perform public.ticket_act(v_id, 'remove_member', '{"member":"00000000-0000-4000-8000-000000113a03"}');
  if (select cardinality(members) from public.tickets where id = v_id) <> 0 then raise exception 'case the opener takes a member out failed'; end if;
  if not exists (select 1 from public.ticket_events where ticket_id = v_id and text like '%شال من الطلب: بسمة%') then raise exception 'case the remove event failed'; end if;
  perform public.ticket_act(v_id, 'close', '{}');
end $$;
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000113a03');
do $$ begin
  if exists (select 1 from public.tickets where id = (select id from tg_ids where k = 'g')) then raise exception 'case a removed member no longer sees it failed'; end if;
end $$;
reset role;

-- a closed request takes no new member; the admin reopens
select pg_temp.as_member('00000000-0000-4000-8000-000000113a01');
do $$
declare v_id bigint := (select id from tg_ids where k = 'g');
begin
  begin perform public.ticket_act(v_id, 'add_members', jsonb_build_object('members', jsonb_build_array('00000000-0000-4000-8000-000000113a03')));
    raise exception 'case a closed request takes no member failed'; exception when invalid_parameter_value then null; end;
  perform public.ticket_act(v_id, 'reopen', '{"reason":"لسه"}');
  if (select status from public.tickets where id = v_id) <> 'open' then raise exception 'case the admin reopens failed'; end if;
end $$;
reset role;

do $$ begin raise notice 'rls_ticket_group: ok'; end $$;
rollback;
