-- Tests for 0163 (the bell by role — Safwat 24 Nov) and 0166 («طلبات الفريق» a tab inside «الفريق»): «الفريق» holds the requests' two
-- rules in one sub-section «طلبات الفريق» after its own tabs and no main section «طلبات الفريق» is left, «التسويق» holds the ads /
-- design / code sub-sections, each role's sub-sections in their working order.
-- Depends on 0001 … 0166. One transaction, rolled back; NOTICE 'rls_bell_by_role: ok' only if every case passed.
begin;
do $$
declare team uuid; req uuid; mkt uuid;
begin
  if exists (select 1 from public.notif_sections where parent_id is null and name = 'طلبات الفريق') then raise exception 'case no main section «طلبات الفريق» failed'; end if;
  select id into team from public.notif_sections where parent_id is null and name = 'الفريق';
  select id into req from public.notif_sections where parent_id = team and name = 'طلبات الفريق';
  if req is null then raise exception 'case «الفريق › طلبات الفريق» failed'; end if;
  if (select array_agg(name order by sort) from public.notif_sections where parent_id = team) is distinct from array['الحضور والانصراف', 'التقييم', 'طلبات الفريق'] then raise exception 'case «الفريق» tabs in order failed'; end if;
  if (select array_agg(r.state order by r.sort) from public.notif_rules r where r.section_id = req and r.element = 'tickets') is distinct from array['new', 'late'] then raise exception 'case both requests rules under it failed'; end if;
  if exists (select 1 from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = 'الفريق' and s.name = 'الطلبات') then raise exception 'case «الفريق › الطلبات» (0157) gone failed'; end if;
  select id into mkt from public.notif_sections where parent_id is null and name = 'التسويق';
  if (select array_agg(name order by sort) from public.notif_sections where parent_id = mkt) is distinct from array['الإعلانات', 'التصميم', 'البرمجة'] then raise exception 'case «التسويق» sub-sections failed'; end if;
  if exists (select 1 from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.name = 'مساعدين الذكاء الاصطناعي' and s.name in ('الميديا باير', 'الديزاينر', 'المبرمج')) then raise exception 'case the marketing roles out of the assistants failed'; end if;
  if (select array_agg(s.name order by s.sort) from public.notif_sections s join public.notif_sections m on m.id = s.parent_id where m.parent_id is null and m.name = 'خدمة العملاء') is distinct from array['غير مؤكدة', 'في انتظار الرد', 'أوردر متأخر', 'تقييم واطي'] then raise exception 'case the CS order failed'; end if;
  if (select name from public.notif_sections where parent_id is null order by sort limit 1) is distinct from 'خدمة العملاء' then raise exception 'case the main order failed'; end if;
  raise notice 'rls_bell_by_role: ok';
end $$;
rollback;
