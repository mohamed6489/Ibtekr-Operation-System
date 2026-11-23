-- 0152 — the meeting of 23 Nov [#19] (docs/superpowers/plans/2026-11-23-meeting.md phase 3.4): a withdraw request the system itself
-- made (woo-sync withdraw_create — «تسوية دلوقتي» / «اعمل طلب سحب على Dokan») is told apart from the maker's own: «داخلي — اتعمل من
-- السيستم». The flow stays as it is (the system asks, then approves); the mirror only learns who asked.
-- · withdraw_create marks the row it mirrors; the hourly pull marks any request Dokan holds with withdraw_create's fixed note
--   («تسوية من سيستم إبتكر» — read for this only, never stored) and never sets one back.
-- · The old ones (Safwat 23 Nov — «الاتنين مع بعض»): the requests woo_sync_log saw withdraw_create make, here; the older ones by their
--   note on the next pull.
-- Members read it with the table (select granted in 0019); only the server writes it.

alter table public.dokan_withdrawals add column if not exists internal boolean not null default false;

update public.dokan_withdrawals w set internal = true
where not w.internal
  and exists (select 1 from public.woo_sync_log l
              where l.action = 'withdraw_create' and l.result = 'ok' and l.entity = 'dokan_withdrawals' and l.entity_id = w.id::text);
