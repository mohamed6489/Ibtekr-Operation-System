-- 0166 — «طلبات الفريق» a tab inside «الفريق» (Safwat 24 Nov — «ممكن تنقل طلبات الفريق الموجودة في النوتيفيكيشن من بره ل طلبات و
-- تحطها تاب جوة قسم فريق»; docs/superpowers/plans/2026-11-24-bell-redesign.md decision 15): the main section 0163 made («طلبات الفريق»
-- with «جديدة» · «حالتها ماتغيّرتش») becomes one sub-section «طلبات الفريق» under «الفريق», after its own tabs, holding both rules; their
-- alerts move with them (notif_rules_tidy — 0164), the old sections go once nothing points at them. The bell by role (0163) still shows a
-- member only the sub-sections his roles get: a team without HR sees «الفريق» with «طلبات الفريق» alone.
-- By names, so a section the admin renamed or deleted is left as he made it. Re-runnable.

do $$
declare m_team uuid; m_req uuid; s_req uuid;
begin
  select id into m_team from public.notif_sections where parent_id is null and name = 'الفريق';
  select id into m_req from public.notif_sections where parent_id is null and name = 'طلبات الفريق';
  if m_team is null or m_req is null then return; end if;
  select id into s_req from public.notif_sections where parent_id = m_team and name = 'طلبات الفريق';
  if s_req is null then
    insert into public.notif_sections (parent_id, name, sort)
    values (m_team, 'طلبات الفريق', coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m_team), 0))
    returning id into s_req;
  end if;
  -- the rules (the new requests first, as they were) and their alerts
  update public.notif_rules r set section_id = s_req,
      sort = case when r.state = 'new' then 0 else 1 end + coalesce((select max(x.sort) + 1 from public.notif_rules x where x.section_id = s_req), 0)
    where r.section_id in (select id from public.notif_sections where parent_id = m_req);
  update public.alerts set section_id = s_req where section_id in (select id from public.notif_sections where parent_id = m_req);
  -- the old sections once nothing points at them
  delete from public.notif_sections s where s.parent_id = m_req
    and not exists (select 1 from public.notif_rules r where r.section_id = s.id) and not exists (select 1 from public.alerts a where a.section_id = s.id);
  delete from public.notif_sections s where s.id = m_req and not exists (select 1 from public.notif_sections x where x.parent_id = m_req);
end $$;
