-- 0126 — the media buyer looks at the Meta Pixel (the owner 17 Nov — «عايز الميديا باير يقدر يبص علي البيكسل و لو في حاجة محتاجة
-- تتصلح يقدر يساعدني نصلحها»). site_checks (0109) takes a third kind, 'pixel': the last check of mkt-ads action `pixel` (the account's
-- pixels, 7 days of events, Meta's checks, the site's page, purchases against our orders → issues with their fixes). Read as before
-- (marketing.view), written by the server only. Re-runnable.
alter table public.site_checks drop constraint if exists site_checks_kind_check;
alter table public.site_checks add constraint site_checks_kind_check check (kind in ('wp_updates', 'pagespeed', 'pixel'));

-- and the assistants' web research (the owner 17 Nov — «فكرة البحث صح و في مصادر قوية و متعددة»): its own ai_runs row, source 'research'
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video', 'chat', 'filter', 'agent', 'trends', 'research'));
