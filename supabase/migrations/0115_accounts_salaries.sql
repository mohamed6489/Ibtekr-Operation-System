-- 0115 — «المرتبات» for «الحسابات» too (the owner 16 Nov, ش30: «حط كل الفريق حتي الادمنز و المالك و كله كله و يبقوا ظاهرين للادمنز و
-- للحسابات»). The role «accounts» gets sensitive.salaries = F in every level it has (the employee set and any manager / viewer set) —
-- the payroll RPCs already check that key (hr_salaries()). The admin can change it back from «الإعدادات › الأدوار والصلاحيات».
-- Re-runnable; no new table, no new grant.
update public.roles set permissions = coalesce(permissions, '{}'::jsonb) || '{"sensitive.salaries":"F"}'::jsonb
 where id = 'accounts' and coalesce(permissions ->> 'sensitive.salaries', 'N') <> 'F';
update public.roles r set level_perms = (select jsonb_object_agg(l.key, case when jsonb_typeof(l.value) = 'object' then l.value || '{"sensitive.salaries":"F"}'::jsonb else l.value end)
                                          from jsonb_each(r.level_perms) l)
 where r.id = 'accounts' and jsonb_typeof(r.level_perms) = 'object' and r.level_perms <> '{}'::jsonb;
