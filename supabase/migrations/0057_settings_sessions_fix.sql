-- 0057_settings_sessions_fix — phase 11 (8 Nov): on the live project auth.sessions.created_at / refreshed_at are
-- `timestamp without time zone` (GoTrue's schema), while the local stub declares them timestamptz — my_sessions() of 0056
-- declared timestamptz columns and failed live with «structure of query does not match function result type». The
-- definer casts both, so it runs on either schema. Re-runnable.
create or replace function public.my_sessions()
returns table (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text, ip text, aal text, current boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
begin
  if v_uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select s.id, s.created_at::timestamptz, s.refreshed_at::timestamptz, left(coalesce(s.user_agent, ''), 200), host(s.ip), s.aal::text, (s.id::text = v_sid)
    from auth.sessions s where s.user_id = v_uid order by s.refreshed_at desc nulls last, s.created_at desc;
end
$$;
revoke execute on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated, service_role;
