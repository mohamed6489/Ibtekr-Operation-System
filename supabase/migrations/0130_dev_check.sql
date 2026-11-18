-- 0130 — the developer's daily check (docs/superpowers/plans/2026-11-17-agents-brain.md decision 5, «طريقة أ» — the owner 18 Nov: «المبرمج
-- يكتشف المشكلة ويشرحها ويقولك الحل، والتصليح نفسه بيتعمل هنا معايا»): the notify tick reads the system's health once a day and the
-- developer assistant writes a note per problem (ai_agent_note_add); nothing here fixes anything.
-- * dev_cron_health(p_hours): the scheduled jobs that failed in the last hours (pg_cron's own log) and the scheduler's calls to our
--   functions that came back with an error (pg_net) — names, counts and the first line of the error only (never a request body or a
--   header; a long token-like run is cut to «…»). service_role only; without pg_cron / pg_net = empty.
-- * ai_agent_note_clear(p_agent, p_prefix, p_keep): a problem that is gone takes its note with it — the agent's notes whose ref starts with
--   the prefix and is not kept are deleted (the chats they opened stay). service_role only.
-- Re-runnable.

create or replace function public.dev_cron_health(p_hours int default 24)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)));
        v_jobs jsonb := '[]'; v_http jsonb := '{"failed": 0}';
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select coalesce(jsonb_agg(x order by x->>'name'), '[]') from (
        select jsonb_build_object('name', j.jobname, 'runs', count(*), 'failed', count(*) filter (where d.status = 'failed'),
          'last_failed_at', max(d.start_time) filter (where d.status = 'failed'),
          'msg', left(regexp_replace(split_part((array_agg(d.return_message order by d.start_time desc) filter (where d.status = 'failed'))[1], E'\n', 1), '[A-Za-z0-9_.=+/-]{24,}', '…', 'g'), 160)) as x
        from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where d.start_time >= $1
        group by j.jobname
        having count(*) filter (where d.status = 'failed') > 0
      ) s $q$ into v_jobs using v_since;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $q$
      select jsonb_build_object('failed', count(*),
        'codes', coalesce((select jsonb_object_agg(k, n) from (select coalesce(status_code::text, 'network') k, count(*) n from net._http_response
          where created >= $1 and (status_code >= 500 or error_msg is not null) group by 1) c), '{}'),
        'msg', left(regexp_replace(split_part((array_agg(error_msg order by created desc) filter (where error_msg is not null))[1], E'\n', 1), '[A-Za-z0-9_.=+/-]{24,}', '…', 'g'), 160))
      from net._http_response where created >= $1 and (status_code >= 500 or error_msg is not null) $q$ into v_http using v_since;
  end if;
  return jsonb_build_object('jobs', coalesce(v_jobs, '[]'), 'http', coalesce(v_http, '{"failed": 0}'));
end
$$;
revoke execute on function public.dev_cron_health(int) from public, anon, authenticated;
grant execute on function public.dev_cron_health(int) to service_role;

create or replace function public.ai_agent_note_clear(p_agent text, p_prefix text, p_keep text[] default '{}')
returns int
language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(p_prefix, '') !~ '^[a-z][a-z0-9-]{1,30}:$' then raise exception 'invalid: prefix' using errcode = '22023'; end if;
  delete from public.ai_agent_notes
  where agent = p_agent and ref like p_prefix || '%' and not (ref = any (coalesce(p_keep, '{}')));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke execute on function public.ai_agent_note_clear(text, text, text[]) from public, anon, authenticated;
grant execute on function public.ai_agent_note_clear(text, text, text[]) to service_role;
