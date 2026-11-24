-- 0164 — the bell follows «الإعدادات › التنبيهات» the moment a change is saved (Safwat 24 Nov — «اي تعديلات اعملها في اعدادات التبيهات
-- تسمع في البوب اب بتاع التنبيهات بمجرد الحفظ … مش عامل … عنصر عن الاوردرات الفرعية و رغم كدة ظهره»). The rule «أوردر فرعي متأخر» went
-- from the sub-orders element to the makers' making one and its 48 old sub-order alerts stayed in the bell: the engine renews alerts of
-- the rule's element only and hides the rest by the rule's own «حتى تغيير الوضع» — hours later, if ever.
-- Now a rule's alerts that no longer fit it leave the bell at once (hide_at = now — never deleted, their read marks stay):
--   * the rule switched off, or deleted (its section too) — all of them;
--   * an alert whose kind is not its part's element any more (part 0 = the rule's own element, part n = its nth extra element —
--     entity ids «x<n>|…»), or a «تقرير» rule's single alerts / a «فردي» rule's report;
--   * an alert of a member none of whose roles (primary + extra) the rule goes to now.
-- The next tick writes what the rule asks for now. Re-runnable.

create or replace function public.notif_rule_tidy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kinds text[];
begin
  if tg_op = 'DELETE' then
    update public.alerts set hide_at = now() where rule_id = old.id and (hide_at is null or hide_at > now());
    return old;
  end if;
  if new.active is false then
    update public.alerts set hide_at = now() where rule_id = new.id and (hide_at is null or hide_at > now());
    return new;
  end if;
  -- the kind of each part: index 0 the rule's own element, then its extra ones in order
  v_kinds := array['rule:' || new.element || '.' || new.type]
    || coalesce((select array_agg('rule:' || (c ->> 'element') || '.' || (c ->> 'type') order by o)
                 from jsonb_array_elements(case when jsonb_typeof(new.conds) = 'array' then new.conds else '[]'::jsonb end) with ordinality as x(c, o)), '{}'::text[]);
  update public.alerts a set hide_at = now()
  where a.rule_id = new.id and (a.hide_at is null or a.hide_at > now())
    and (
      -- «تقرير» writes one report alert; «فردي» never does
      (coalesce(new.mode, 'single') = 'report') <> (a.kind = 'rule:report')
      or (a.kind <> 'rule:report' and a.kind is distinct from v_kinds[1 + (case when a.entity_id ~ '^x[0-9]\|' then substr(a.entity_id, 2, 1)::int else 0 end)])
      or (a.user_id is not null and not exists (select 1 from public.profiles p where p.id = a.user_id and p.status = 'active'
            and (p.role_id = any (new.roles) or coalesce(p.extra_roles, '{}'::text[]) && new.roles)))
    );
  -- a rule moved to another sub-section takes its alerts with it
  if new.section_id is distinct from old.section_id then
    update public.alerts set section_id = new.section_id where rule_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.notif_rule_tidy() from public, anon;

drop trigger if exists notif_rules_tidy on public.notif_rules;
create trigger notif_rules_tidy after update on public.notif_rules
  for each row when (old.element is distinct from new.element or old.type is distinct from new.type or old.conds is distinct from new.conds
    or old.mode is distinct from new.mode or old.active is distinct from new.active or old.roles is distinct from new.roles or old.section_id is distinct from new.section_id)
  execute function public.notif_rule_tidy();
drop trigger if exists notif_rules_tidy_delete on public.notif_rules;
create trigger notif_rules_tidy_delete before delete on public.notif_rules
  for each row execute function public.notif_rule_tidy();

-- the ones already showing that no longer fit their rule (the 48 sub-order alerts of «أوردر فرعي متأخر» on the live project): out now
update public.alerts a set hide_at = now()
from public.notif_rules r
where a.rule_id = r.id and (a.hide_at is null or a.hide_at > now())
  and (r.active is false
    or (coalesce(r.mode, 'single') = 'report') <> (a.kind = 'rule:report')
    or (a.kind <> 'rule:report' and a.kind is distinct from (array['rule:' || r.element || '.' || r.type]
      || coalesce((select array_agg('rule:' || (c ->> 'element') || '.' || (c ->> 'type') order by o)
                   from jsonb_array_elements(case when jsonb_typeof(r.conds) = 'array' then r.conds else '[]'::jsonb end) with ordinality as x(c, o)), '{}'::text[]))
      [1 + (case when a.entity_id ~ '^x[0-9]\|' then substr(a.entity_id, 2, 1)::int else 0 end)]));
-- the alerts of a rule already deleted (no rule, a sub-section): out now too
update public.alerts set hide_at = now() where rule_id is null and section_id is not null and (hide_at is null or hide_at > now());
