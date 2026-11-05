-- RLS / permission tests for 0045_tickets (team tickets: tickets + an append-only timeline, every write through ticket_create /
-- ticket_act). Depends on 0001_identity … 0045_tickets. Runs in one transaction and rolls back; prints NOTICE 'rls_tickets: ok' only if
-- every case passed. Live-safe: its rows (six made-up members, one order, one maker, tickets, events, fake Storage rows) are rolled back.

begin;

insert into auth.users (id, email, phone) values
  ('00000000-0000-4000-8000-0000000045b1', 'tk-cs.dev@ibtekr.local', '01000045b01'),
  ('00000000-0000-4000-8000-0000000045b2', 'tk-acc.dev@ibtekr.local', '01000045b02'),
  ('00000000-0000-4000-8000-0000000045b3', 'tk-vf.dev@ibtekr.local', '01000045b03'),
  ('00000000-0000-4000-8000-0000000045b4', 'tk-view.dev@ibtekr.local', '01000045b04'),
  ('00000000-0000-4000-8000-0000000045b5', 'tk-ops.dev@ibtekr.local', '01000045b05'),
  ('00000000-0000-4000-8000-0000000045b6', 'tk-adm.dev@ibtekr.local', '01000045b06'),
  ('00000000-0000-4000-8000-0000000045b7', 'tk-noord.dev@ibtekr.local', '01000045b07');
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email) from auth.users u where u.email like 'tk-%.dev@ibtekr.local';
insert into public.profiles (id, name, email, phone, role_id, status, custom_perms) values
  ('00000000-0000-4000-8000-0000000045b1', 'تذاكر خدمة', 'tk-cs.dev@ibtekr.local', '01000045b01', 'cs', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b2', 'تذاكر حسابات', 'tk-acc.dev@ibtekr.local', '01000045b02', 'accounts', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b3', 'تذاكر متابعة', 'tk-vf.dev@ibtekr.local', '01000045b03', 'vendors_followup', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b4', 'تذاكر مشاهد', 'tk-view.dev@ibtekr.local', '01000045b04', 'viewer', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b5', 'تذاكر عمليات', 'tk-ops.dev@ibtekr.local', '01000045b05', 'ops', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b6', 'تذاكر أدمن', 'tk-adm.dev@ibtekr.local', '01000045b06', 'admin', 'active', '{}'),
  ('00000000-0000-4000-8000-0000000045b7', 'تذاكر من غير أوردرات', 'tk-noord.dev@ibtekr.local', '01000045b07', 'cs', 'active', '{"orders.view":"N","cs.view":"N"}');

insert into public.orders (id, number, customer_name, customer_phone, status, placed_at)
  values (990451, '990451', 'عميلة التذاكر', '01000045999', (select system_status from public.status_map order by id limit 1), now());
insert into public.vendors (id, name) values ('00000000-0000-4000-8000-0000000045c1', 'مبتكر تذاكر 0045');

-- the files the members "uploaded" (Storage holds the type and size on the live project; locally the client's are used)
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $q$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('tickets', '00000000-0000-4000-8000-0000000045b1/a1-photo.png', '00000000-0000-4000-8000-0000000045b1', '{"mimetype":"image/png","size":1200}'),
      ('tickets', '00000000-0000-4000-8000-0000000045b2/a2-receipt.pdf', '00000000-0000-4000-8000-0000000045b2', '{"mimetype":"application/pdf","size":5000}'),
      ('tickets', '00000000-0000-4000-8000-0000000045b1/a3-page.html', '00000000-0000-4000-8000-0000000045b1', '{"mimetype":"text/html","size":100}')$q$;
  end if;
end $$;

create temp table tk_ids (k text primary key, v text) on commit drop;
grant all on tk_ids to authenticated;
insert into tk_ids select 'cust', id::text from public.cs_customers where phone = public.norm_phone('01000045999');

-- ================================================================ the permissions of 0045

do $$
begin
  if (select permissions ->> 'tickets.view' from public.roles where id = 'accounts') <> 'P' or (select permissions ->> 'tickets.manage' from public.roles where id = 'accounts') <> 'F'
     or (select permissions ->> 'tickets.manage' from public.roles where id = 'vendors_followup') <> 'F' or (select permissions ->> 'tickets.manage' from public.roles where id = 'viewer') <> 'N'
     or (select permissions ->> 'tickets.view' from public.roles where id = 'ops') <> 'F' then
    raise exception 'case the tickets permissions of decision 4 failed';
  end if;
end $$;

-- ================================================================ cs (F/F) opens tickets

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b1","role":"authenticated"}', true);

do $$
declare t1 bigint; t2 bigint; r public.tickets%rowtype;
begin
  t1 := public.ticket_create('{"type":"customer","title":"  فرق   شحن\nللعميلة ","description":"اتحاسبت 100 والصح 50","priority":"high","assigneeRole":"الحسابات","orderId":"990451","reason":"مشكلة دفع أو استرجاع","followUp":"2026-11-20","attachments":[{"path":"00000000-0000-4000-8000-0000000045b1/a1-photo.png","name":"صورة","type":"image/png","size":1200}]}');
  select * into r from public.tickets where id = t1;
  if r.title <> 'فرق شحن للعميلة' then raise exception 'case the title is cleaned failed (%)', r.title; end if;
  if r.order_id <> 990451 or r.customer <> 'عميلة التذاكر' then raise exception 'case the order and its customer are linked failed'; end if;
  if r.cs_customer_id is null or r.cs_customer_id::text is distinct from (select v from tk_ids where k = 'cust') then raise exception 'case the customer from the order phone failed'; end if;
  if r.created_by <> '00000000-0000-4000-8000-0000000045b1' or r.created_by_name <> 'تذاكر خدمة' or r.created_by_role <> 'خدمة العملاء' then raise exception 'case the opener is stamped failed'; end if;
  if r.status <> 'open' or r.follow_up <> '2026-11-20' or jsonb_array_length(r.attachments) <> 1 or r.attachments -> 0 ->> 'type' <> 'image/png' then raise exception 'case the ticket row failed'; end if;
  if (select count(*) from public.ticket_events where ticket_id = t1) <> 2
     or (select text from public.ticket_events where ticket_id = t1 and kind = 'event') <> 'تذاكر خدمة أنشأ التذكرة وعيّنها لدور «الحسابات»'
     or (select text from public.ticket_events where ticket_id = t1 and kind = 'message') <> 'اتحاسبت 100 والصح 50' then
    raise exception 'case the creation events failed';
  end if;
  insert into tk_ids values ('t1', t1::text);

  t2 := public.ticket_create('{"type":"internal","title":"الكرتون خلص","description":"محتاجين كرتون شحن","priority":"normal","assigneeRole":"اللوجستيك والشحن","reason":"جودة"}');
  if (select reason from public.tickets where id = t2) is not null then raise exception 'case an internal ticket has no reason failed'; end if;
  insert into tk_ids values ('t2', t2::text);

  -- the v2's validateTicket on the server
  begin perform public.ticket_create(('{"type":"internal","title":"' || repeat('ع', 81) || '","description":"x","priority":"normal","assigneeRole":"الحسابات"}')::jsonb);
    raise exception 'case a title over 80 failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"customer","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","reason":"أخرى"}');
    raise exception 'case a customer ticket needs the order failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"customer","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","orderId":"1","reason":"جودة"}');
    raise exception 'case a customer reason from the list failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الأمن"}');
    raise exception 'case the role from the list failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"   ","priority":"normal","assigneeRole":"الحسابات"}');
    raise exception 'case a description is required failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","followUp":"2026-02-30"}');
    raise exception 'case a real follow-up day failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"vendor","title":"x","description":"x","priority":"normal","assigneeRole":"متابعة المبتكرين","vendorId":"00000000-0000-4000-8000-0000000045ff","reason":"جودة"}');
    raise exception 'case a maker ticket needs a real maker failed'; exception when invalid_parameter_value then null; end;
  -- attachments: only my own uploads, images / PDF, ≤ 10
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","attachments":[{"path":"00000000-0000-4000-8000-0000000045b2/a2-receipt.pdf","type":"application/pdf","size":5000}]}');
    raise exception 'case another member''s file failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","attachments":[{"path":"00000000-0000-4000-8000-0000000045b1/a3-page.html","type":"text/html","size":100}]}');
    raise exception 'case an html file failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","attachments":[{"path":"00000000-0000-4000-8000-0000000045b1/../x.png","type":"image/png","size":1}]}');
    raise exception 'case a path outside the folder failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'x', 'priority', 'normal', 'assigneeRole', 'الحسابات',
      'attachments', (select jsonb_agg(jsonb_build_object('path', '00000000-0000-4000-8000-0000000045b1/f' || i || '.png', 'type', 'image/png', 'size', 1)) from generate_series(1, 11) i)));
    raise exception 'case 10 files at most failed'; exception when invalid_parameter_value then null; end;

  -- a member writes nothing directly
  begin insert into public.tickets (type, title, description, priority, assignee_role, created_by_name, created_by_role) values ('internal', 'x', 'x', 'normal', 'الحسابات', 'x', 'x');
    raise exception 'case no direct insert failed'; exception when insufficient_privilege then null; end;
  begin update public.tickets set status = 'closed' where id = t1; raise exception 'case no direct update failed'; exception when insufficient_privilege then null; end;
  begin delete from public.tickets where id = t1; raise exception 'case no delete failed'; exception when insufficient_privilege then null; end;
  begin insert into public.ticket_events (ticket_id, kind, actor_name, actor_role, text) values (t1, 'message', 'x', 'x', 'x');
    raise exception 'case no direct event failed'; exception when insufficient_privilege then null; end;
  begin delete from public.ticket_events where ticket_id = t1; raise exception 'case events are never deleted failed'; exception when insufficient_privilege then null; end;

  -- cs is not the role of t1 (الحسابات): no status, no resolve
  begin perform public.ticket_act(t1, 'set_status', '{"status":"in_progress"}'); raise exception 'case only the role works on it failed'; exception when insufficient_privilege then null; end;
  begin perform public.ticket_act(t1, 'resolve', '{"outcome":"مكرر"}'); raise exception 'case only the role resolves failed'; exception when insufficient_privilege then null; end;
  -- a status is not «closed» / «open» (close / reopen are their own actions)
  begin perform public.ticket_act(t2, 'set_status', '{"status":"closed"}'); raise exception 'case set_status never closes failed'; exception when invalid_parameter_value then null; end;
  -- anyone who works the tickets replies
  perform public.ticket_act(t1, 'reply', '{"text":"العميلة مستنية"}');
end $$;

-- ================================================================ accounts (P/F): my role's tickets + the ones I opened

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b2","role":"authenticated"}', true);
do $$
declare t1 bigint := (select v::bigint from tk_ids where k = 't1'); t2 bigint := (select v::bigint from tk_ids where k = 't2');
begin
  if (select count(*) from public.tickets where id in (t1, t2)) <> 1 or not exists (select 1 from public.tickets where id = t1) then raise exception 'case P sees its role''s tickets only failed'; end if;
  if exists (select 1 from public.ticket_events where ticket_id = t2) or (select count(*) from public.ticket_events where ticket_id = t1) <> 3 then raise exception 'case P sees the events of what it sees failed'; end if;
  begin perform public.ticket_act(t2, 'reply', '{"text":"x"}'); raise exception 'case a ticket I do not see is not found failed'; exception when no_data_found then null; end;
  perform public.ticket_act(t1, 'set_status', '{"status":"in_progress"}');
  if (select status from public.tickets where id = t1) <> 'in_progress'
     or (select text from public.ticket_events where ticket_id = t1 and new_value = 'in_progress') <> 'تذاكر حسابات غيّر الحالة من «مفتوح» إلى «جاري العمل»' then raise exception 'case the role sets the status failed'; end if;
  perform public.ticket_act(t1, 'set_status', '{"status":"in_progress"}'); -- the same status = nothing
  if (select count(*) from public.ticket_events where ticket_id = t1 and new_value = 'in_progress') <> 1 then raise exception 'case the same status writes nothing failed'; end if;
  begin perform public.ticket_act(t1, 'close'); raise exception 'case only the opener closes failed'; exception when insufficient_privilege then null; end;
  begin perform public.ticket_act(t1, 'resolve', '{"outcome":"خلصت"}'); raise exception 'case an outcome from the list failed'; exception when invalid_parameter_value then null; end;
  perform public.ticket_act(t1, 'reply', '{"text":"اتحوّل الفرق","attachments":[{"path":"00000000-0000-4000-8000-0000000045b2/a2-receipt.pdf","name":"إيصال","type":"application/pdf","size":5000}]}');
  if (select attachments -> 0 ->> 'name' from public.ticket_events where ticket_id = t1 and text = 'اتحوّل الفرق') <> 'إيصال' then raise exception 'case a reply carries its files failed'; end if;
  perform public.ticket_act(t1, 'resolve', '{"outcome":"اتحلت المشكلة","note":"على المحفظة"}');
  if (select status || '|' || resolution_outcome || '|' || resolution_note || '|' || resolved_by_name from public.tickets where id = t1) <> 'resolved|اتحلت المشكلة|على المحفظة|تذاكر حسابات'
     or (select text from public.ticket_events where ticket_id = t1 and new_value = 'resolved') <> 'تذاكر حسابات حوّل التذكرة إلى «تم الحل» — اتحلت المشكلة · على المحفظة' then
    raise exception 'case the role resolves with an outcome failed';
  end if;
  if not public.ticket_file_visible('00000000-0000-4000-8000-0000000045b1/a1-photo.png') then raise exception 'case a file of a ticket I see is visible failed'; end if;
end $$;

-- ================================================================ cs (the opener): close, reply on closed, reopen, update

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b1","role":"authenticated"}', true);
do $$
declare t1 bigint := (select v::bigint from tk_ids where k = 't1');
begin
  perform public.ticket_act(t1, 'close');
  if (select status || '|' || closed_by_name from public.tickets where id = t1) <> 'closed|تذاكر خدمة' then raise exception 'case the opener closes failed'; end if;
  perform public.ticket_act(t1, 'close'); -- closing a closed ticket = nothing
  if (select count(*) from public.ticket_events where ticket_id = t1 and new_value = 'closed') <> 1 then raise exception 'case closing twice writes once failed'; end if;
  begin perform public.ticket_act(t1, 'reply', '{"text":"x"}'); raise exception 'case no reply on a closed ticket failed'; exception when invalid_parameter_value then null; end;
  begin perform public.ticket_act(t1, 'reopen', '{"reason":"  "}'); raise exception 'case reopening needs a reason failed'; exception when invalid_parameter_value then null; end;
  perform public.ticket_act(t1, 'reopen', '{"reason":"الفرق ماوصلش"}');
  if (select status || '|' || reopen_count || '|' || coalesce(resolution_outcome, '-') || '|' || coalesce(closed_by_name, '-') from public.tickets where id = t1) <> 'open|1|-|-' then
    raise exception 'case reopening clears the resolution failed';
  end if;
  if (select text from public.ticket_events where ticket_id = t1 and new_value = 'open') <> 'تذاكر خدمة أُعيد فتحه (×1) — السبب: الفرق ماوصلش · رجع لدور «الحسابات»' then raise exception 'case the reopen event failed'; end if;
  begin perform public.ticket_act(t1, 'reopen', '{"reason":"تاني"}'); raise exception 'case an open ticket is not reopened failed'; exception when invalid_parameter_value then null; end;
  perform public.ticket_act(t1, 'update', '{"priority":"urgent","followUp":""}');
  if (select priority || '|' || coalesce(follow_up::text, '-') from public.tickets where id = t1) <> 'urgent|-'
     or (select text from public.ticket_events where ticket_id = t1 and new_value = 'urgent') <> 'تذاكر خدمة غيّر الأولوية من «عالي» إلى «عاجل»'
     or (select text from public.ticket_events where ticket_id = t1 and old_value = '2026-11-20') <> 'تذاكر خدمة غيّر تاريخ المتابعة من «2026-11-20» إلى «—»' then
    raise exception 'case the opener updates priority and follow-up failed';
  end if;
  perform public.ticket_act(t1, 'update', '{"assigneeRole":"متابعة المبتكرين"}');
end $$;

-- ================================================================ the role moved: accounts (P) no longer sees it, vendors_followup does

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b2","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.tickets where id = (select v::bigint from tk_ids where k = 't1')) then raise exception 'case a moved ticket leaves the old role (P) failed'; end if;
  if public.ticket_file_visible('00000000-0000-4000-8000-0000000045b1/a1-photo.png') then raise exception 'case the file of a ticket I no longer see failed'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b3","role":"authenticated"}', true);
do $$
declare t1 bigint := (select v::bigint from tk_ids where k = 't1'); t3 bigint;
begin
  if not exists (select 1 from public.tickets where id = t1) then raise exception 'case the new role sees it failed'; end if;
  perform public.ticket_act(t1, 'set_status', '{"status":"waiting"}');
  t3 := public.ticket_create('{"type":"vendor","title":"المبتكر مابيردش","description":"بقاله 3 أيام","priority":"normal","assigneeRole":"خدمة العملاء","vendorId":"00000000-0000-4000-8000-0000000045c1","reason":"مش بيرد"}');
  if (select vendor from public.tickets where id = t3) <> 'مبتكر تذاكر 0045' then raise exception 'case a maker ticket takes the maker name failed'; end if;
  if not exists (select 1 from public.tickets where id = t3) then raise exception 'case P sees the ticket it opened failed'; end if;
  insert into tk_ids values ('t3', t3::text);
end $$;

-- ================================================================ a member who does not read the orders / customers: the typed number only

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b7","role":"authenticated"}', true);
do $$
declare t bigint;
begin
  t := public.ticket_create('{"type":"customer","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات","orderId":"990451","reason":"أخرى"}');
  if (select order_number || '|' || coalesce(order_id::text, '-') || '|' || coalesce(customer, '-') || '|' || coalesce(cs_customer_id::text, '-') from public.tickets where id = t) <> '990451|-|-|-' then
    raise exception 'case no order / customer read without orders.view failed';
  end if;
  begin perform public.ticket_create(jsonb_build_object('type', 'internal', 'title', 'x', 'description', 'x', 'priority', 'normal', 'assigneeRole', 'الحسابات', 'csCustomerId', (select v from tk_ids where k = 'cust')));
    raise exception 'case no customer link without cs.view failed'; exception when invalid_parameter_value then null; end;
end $$;

-- ================================================================ viewer (P/N): no role of its own, opens nothing

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b4","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.tickets where id in (select v::bigint from tk_ids where k like 't_')) then raise exception 'case viewer sees nobody''s tickets failed'; end if;
  begin perform public.ticket_create('{"type":"internal","title":"x","description":"x","priority":"normal","assigneeRole":"الحسابات"}');
    raise exception 'case viewer opens nothing failed'; exception when insufficient_privilege then null; end;
end $$;

-- ================================================================ ops: both of its roles; admin: everything

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b5","role":"authenticated"}', true);
do $$
declare t2 bigint := (select v::bigint from tk_ids where k = 't2');
begin
  if (select count(*) from public.tickets where id in (select v::bigint from tk_ids where k like 't_')) <> 3 then raise exception 'case ops (F) sees all failed'; end if;
  perform public.ticket_act(t2, 'set_status', '{"status":"in_progress"}');
  perform public.ticket_act(t2, 'update', '{"assigneeRole":"المحتوى والتصوير"}');
  perform public.ticket_act(t2, 'resolve', '{"outcome":"مش مشكلة"}'); -- المحتوى والتصوير is ops too (decision 14)
  begin perform public.ticket_act(t2, 'close'); raise exception 'case ops is not the opener failed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000045b6","role":"authenticated"}', true);
do $$
declare t2 bigint := (select v::bigint from tk_ids where k = 't2'); t3 bigint := (select v::bigint from tk_ids where k = 't3');
begin
  perform public.ticket_act(t2, 'close');
  perform public.ticket_act(t3, 'resolve', '{"outcome":"مكرر"}');
  if (select status from public.tickets where id = t2) <> 'closed' or (select status from public.tickets where id = t3) <> 'resolved' then raise exception 'case admin works and closes anything failed'; end if;
  begin perform public.ticket_act(t2, 'remove'); raise exception 'case no other action (no delete) failed'; exception when invalid_parameter_value then null; end;
end $$;

reset role;
do $$ begin raise notice 'rls_tickets: ok'; end $$;
rollback;
