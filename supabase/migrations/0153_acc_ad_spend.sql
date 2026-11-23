-- 0153 — the meeting of 23 Nov [#29] (docs/superpowers/plans/2026-11-23-meeting.md phase 4.2): the ads expenses come by themselves from
-- the platforms' daily spend the system already reads (mkt_ad_stats — Meta Ads, and TikTok / Google when linked) instead of a manual
-- «الإعلانات» row. The accounts page reads the daily totals here: a member who reads the accounts (accounts.view ≠ N) without the
-- marketing page still sees the spend — the totals per day and platform only (no campaign, no ad, no figure but the spend).
-- Nothing is written: the rows are shown as «تلقائي من Meta Ads» and are not edited or voided. The manual «الإعلانات» rows stay as they
-- are (none on the live data, 23 Nov).

create or replace function public.acc_ad_spend(p_from date, p_to date)
returns table (day date, platform text, spend numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if (select public.has_perm('accounts.view')) = 'N' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'invalid: range' using errcode = '22023'; end if;
  return query
    select s.day, s.platform, round(sum(s.spend)::numeric, 2)
    from public.mkt_ad_stats s
    where s.level = 'campaign' and s.day between p_from and p_to
    group by s.day, s.platform
    having sum(s.spend) > 0
    order by s.day, s.platform;
end $$;
revoke execute on function public.acc_ad_spend(date, date) from public, anon;
grant execute on function public.acc_ad_spend(date, date) to authenticated, service_role;
