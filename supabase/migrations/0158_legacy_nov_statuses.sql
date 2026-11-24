-- 0158 — November's statuses from Airtable (the meeting of 23 Nov phase 9.1 — «أوردرات نوفمبر 2026 … حالاتها من Airtable»; Safwat's
-- answers 24 Nov in docs/superpowers/plans/2026-11-23-meeting.md): Airtable wins — the status only, no side effect (no rating, no push to
-- the site, the confirmation / dates / notes as they are). Each change is guarded by the status the dry run saw, so a status the team
-- changed since is never written over; run again → nothing (the rows are already there).
--   182197, 183594, 183615: «قيد الشحن» → «مكتمل»; 183549: «جاري التنفيذ» → «قيد الشحن»; 183742: «جاري التنفيذ» → «ملغي» (its lines
--   follow by orders_cancel_lines).
--   An order whose sub-orders differ in Airtable: the order takes the status most of its sub-orders have, and the sub-order that differs
--   has it on its products (Safwat) — 183606 (3 «in shipping», 2 «cancelled»): «جاري التنفيذ» → «قيد الشحن», the products of 183610 and
--   183611 «ملغي»; 183597 (one «in shipping», one «cancelled» — a tie: the order stays «قيد الشحن», the status of the sub-order still
--   going): the products of 183598 «ملغي».
update public.orders set status = 'مكتمل', status_custom = null where id in (182197, 183594, 183615) and status = 'قيد الشحن' and deleted_at is null;
update public.orders set status = 'قيد الشحن', status_custom = null where id in (183549, 183606) and status = 'جاري التنفيذ' and deleted_at is null;
update public.orders set status = 'ملغي', status_custom = null where id = 183742 and status = 'جاري التنفيذ' and deleted_at is null;
update public.order_items i set status = 'ملغي'
  from public.sub_orders s
 where i.sub_order_id = s.id and s.woo_order_id in (183598, 183610, 183611) and s.order_id in (183597, 183606)
   and i.removed = false and i.status not in ('ملغي', 'مرتجع للمخزن', 'مرتجع للمبتكر', 'تم الشحن للعميل');
