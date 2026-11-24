-- Tests for 0163 (the bell by role — Safwat 24 Nov): «طلبات الفريق» is its own main section with its two rules apart, «التسويق» holds
-- the ads / design / code sub-sections, «الفريق» no longer holds the requests, each role's sub-sections in their working order.
-- Depends on 0001 … 0163. One transaction, rolled back; NOTICE 'rls_bell_by_role: ok' only if every case passed.
begin;
do $$
declare req uuid; mkt uuid;
begin
  select id into req from public.notif_sections where parent_id is null and name = 'طلبات الفريق';
  if req is null then raise exception 'case «طلبات الفريق» a main section failed'; end if;
  if not exists (select 1 from public.notif_rules r join public.notif_sections s on s.id = r.section_id where s.parent_id = req and s.name = 'جديدة' and r.element = 'tickets' and r.state = 'new') then raise exception 'case the new requests under «جديدة» failed'; end if;
  if not exists (select 1 from public.notif_rules r join public.notif_sections s on s.id = r.section_id where s.parent_id = req and s.name = 'حالتها ماتغيّرتش' and r.state = 'late') then raise exception 'case the late requests failed'; end if;
  if exists (select 1 from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = 'الفريق' and s.name = 'الطلبات') then raise exception 'case «الفريق › الطلبات» moved out failed'; end if;
  select id into mkt from public.notif_sections where parent_id is null and name = 'التسويق';
  if (select array_agg(name order by sort) from public.notif_sections where parent_id = mkt) is distinct from array['الإعلانات', 'التصميم', 'البرمجة'] then raise exception 'case «التسويق» sub-sections failed'; end if;
  if exists (select 1 from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = 'مساعدين الذكاء الاصطناعي' and s.name in ('الميديا باير', 'الديزاينر', 'المبرمج')) then raise exception 'case the marketing roles out of the assistants failed'; end if;
  if (select array_agg(s.name order by s.sort) from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.parent_id is null and m.name = 'خدمة العملاء') is distinct from array['غير مؤكدة', 'في انتظار الرد', 'أوردر متأخر', 'تقييم واطي'] then raise exception 'case the CS order failed'; end if;
  if (select name from public.notif_sections where parent_id is null order by sort limit 1) is distinct from 'خدمة العملاء' then raise exception 'case the main order failed'; end if;
  raise notice 'rls_bell_by_role: ok';
end $$;
rollback;
