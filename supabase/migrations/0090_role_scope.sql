-- 0090_role_scope.sql — owner batch 14 Nov decision 15 (the roles audit — «اتأكد إن كل دور بيظهرله الحاجات اللي هو محتاجها فعلا لدوره
-- و مش بيظهرله حاجات حساسة … و الادمن مشرف عام علي كل حاجة»). Re-runnable.
-- The three marketing roles of 0081 started from the viewer's permissions, so a designer / a media buyer / a developer could read the
-- orders (the customers' names and addresses), the makers, the inventory and the customer-service conversations they never work on.
-- They keep the marketing, the products (the pictures and the site), the team requests, «ملفي» and — the media buyer — the reports
-- (the ads tab); the rest goes to N. Only a key still at the value 0081 seeded changes: whatever the admin set by hand stays.
-- (The sidebar hides a page whose view permission is N — block 28; the data was and stays the RLS's.)

update public.roles r
set permissions = r.permissions || x.patch
from (
  select s.role_id, jsonb_object_agg(s.k, 'N') as patch
  from (values
    ('designer', 'orders.view', 'P'), ('designer', 'vendors.view', 'P'), ('designer', 'inventory.view', 'F'), ('designer', 'cs.view', 'P'), ('designer', 'reports.view', 'P'),
    ('developer', 'orders.view', 'P'), ('developer', 'vendors.view', 'P'), ('developer', 'inventory.view', 'F'), ('developer', 'cs.view', 'P'), ('developer', 'reports.view', 'P'),
    ('media_buyer', 'orders.view', 'P'), ('media_buyer', 'vendors.view', 'P'), ('media_buyer', 'inventory.view', 'F'), ('media_buyer', 'cs.view', 'P')
  ) as s(role_id, k, seeded)
  join public.roles q on q.id = s.role_id
  where q.permissions ->> s.k is not distinct from s.seeded
  group by s.role_id
) x
where r.id = x.role_id;
