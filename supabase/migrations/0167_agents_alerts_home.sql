-- 0167 — the bell is the settings and nothing else, and the assistants' alerts live in the assistants only (Safwat 25 Nov — «انا مش عايز
-- اشوف في كل تاب للنوتيفيكيشنز الا نفس العناصر و الاقسام الموجودة في اعدادات التنبيهات و كل تنبيهات المساعدين بتيجي جوه المساعدين بس»;
-- docs/superpowers/plans/2026-11-24-bell-redesign.md decision 16):
--   * a sub-section elsewhere whose rules are all of the element «الذكاء الاصطناعي» (0163 put the ads / design / code ones under
--     «التسويق») moves under «مساعدين الذكاء الاصطناعي», before «باقي المساعدين»; an «ai» rule in a sub-section with other rules moves to a
--     sub-section of the same name there; a main section left with no sub-section goes;
--   * an alert with no rule (written straight by a database function, or its rule deleted with its section — the 32 «أوردر فرعي قابل
--     للتأخير» left in «متابعة المبتكرين») leaves the bell now: hide_at = now — never deleted, their read marks stay.
-- By names, so a section the admin renamed or deleted is left as he made it. Re-runnable.

do $$
declare m_ai uuid; s record; s_new uuid; v_last int;
begin
  select id into m_ai from public.notif_sections where parent_id is null and name = 'مساعدين الذكاء الاصطناعي';
  if m_ai is null then return; end if;
  -- whole sub-sections of «ai» rules
  for s in select x.id, x.parent_id from public.notif_sections x
      where x.parent_id is not null and x.parent_id <> m_ai
        and exists (select 1 from public.notif_rules r where r.section_id = x.id and r.element = 'ai')
        and not exists (select 1 from public.notif_rules r where r.section_id = x.id and r.element <> 'ai')
      order by (select sort from public.notif_sections p where p.id = x.parent_id), x.sort loop
    update public.notif_sections set parent_id = m_ai, sort = coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m_ai), 0) where id = s.id;
  end loop;
  -- «ai» rules mixed with others: to a sub-section of the same name under the assistants
  for s in select distinct x.id, x.name from public.notif_sections x join public.notif_rules r on r.section_id = x.id
      where x.parent_id is not null and x.parent_id <> m_ai and r.element = 'ai' loop
    select id into s_new from public.notif_sections where parent_id = m_ai and name = s.name;
    if s_new is null then
      insert into public.notif_sections (parent_id, name, sort) values (m_ai, s.name, coalesce((select max(sort) + 1 from public.notif_sections where parent_id = m_ai), 0)) returning id into s_new;
    end if;
    update public.notif_rules set section_id = s_new where section_id = s.id and element = 'ai'; -- notif_rules_tidy (0164) takes their alerts along
  end loop;
  -- «باقي المساعدين» last
  select coalesce(max(sort), 0) into v_last from public.notif_sections where parent_id = m_ai;
  update public.notif_sections set sort = v_last + 1 where parent_id = m_ai and name = 'باقي المساعدين' and sort <> v_last;
  -- a main section emptied by the move
  delete from public.notif_sections m where m.parent_id is null and m.id <> m_ai and m.name = 'التسويق'
    and not exists (select 1 from public.notif_sections x where x.parent_id = m.id)
    and not exists (select 1 from public.alerts a where a.section_id = m.id);
end $$;

-- the alerts no rule in the settings stands behind: out of the bell now
update public.alerts set hide_at = now() where rule_id is null and (hide_at is null or hide_at > now());
