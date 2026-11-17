-- 0126 — the media buyer looks at the Meta Pixel (the owner 17 Nov — «عايز الميديا باير يقدر يبص علي البيكسل و لو في حاجة محتاجة
-- تتصلح يقدر يساعدني نصلحها»). site_checks (0109) takes a third kind, 'pixel': the last check of mkt-ads action `pixel` (the account's
-- pixels, 7 days of events, Meta's checks, the site's page, purchases against our orders → issues with their fixes). Read as before
-- (marketing.view), written by the server only. Re-runnable.
alter table public.site_checks drop constraint if exists site_checks_kind_check;
alter table public.site_checks add constraint site_checks_kind_check check (kind in ('wp_updates', 'pagespeed', 'pixel'));
