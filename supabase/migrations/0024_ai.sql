-- 0024_ai: the AI content runs (phase 5.3). Uses profiles / is_admin (0001/0008), studio_batches (0023).
-- The plan: docs/superpowers/plans/2026-10-29-phase-5-3-ai-content.md.
--
-- Decision 4: ai_runs — one row per call of the ai-content Edge Function (action write | studio): who, what (the source,
--   the product or the batch item), the model, the tokens, the cost in USD, the status (pending | ok | refused | error |
--   cap), an error code only, and the content it wrote (for «سجل المحتوى»; no images, no keys, no prompts). A member reads
--   their own rows, the admin all; only the server writes (service_role) — no insert / update / delete for members.
-- Decision 3: ai_month_cost() — this month's total (Cairo time) for the optional cap AI_MONTHLY_LIMIT_USD; security
--   invoker, so a member's call sums their own rows (RLS) and the server's all of them.
-- Decision 3 (security review, 29 Oct): ai_run_start(row, cap, reserve, throttle, window) — the server reserves the run
--   before it calls Claude, in one locked step: p_throttle runs of the member in the last p_window_minutes → 'busy' (no
--   row); this month's cost (pending rows at their reserve) + p_reserve over p_cap → a 'cap' row → 'cap'; else a
--   'pending' row costing p_reserve → 'ok' + its id, and the server writes the outcome on it after the call. Parallel calls
--   cannot pass the cap or the throttle together (one advisory lock); a call that never finished keeps its reserve.
--   service_role only.
--
-- Notes for readers:
-- * Re-runnable: create if not exists, policies dropped and created again.
-- * rule 4: select for authenticated, everything for service_role, nothing for anon.

create table if not exists public.ai_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles on delete set null,
  action text not null check (action in ('write', 'studio')),
  source text check (source is null or source in ('data', 'image', 'product', 'studio')),
  label text check (label is null or length(label) <= 200),
  product_id bigint,
  batch_id uuid references public.studio_batches on delete set null,
  item_index int check (item_index is null or item_index between 0 and 999),
  model text check (model is null or model ~ '^[a-z0-9.-]{1,60}$'),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cache_read_tokens int not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens int not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  status text not null check (status in ('pending', 'ok', 'refused', 'error', 'cap')),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  output jsonb check (output is null or (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 100000))
);
create index if not exists ai_runs_created_idx on public.ai_runs (created_at desc);
create index if not exists ai_runs_created_by_idx on public.ai_runs (created_by, created_at desc);
alter table public.ai_runs enable row level security;

drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

revoke all on public.ai_runs from anon, authenticated;
grant select on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;
grant all on sequence public.ai_runs_id_seq to service_role;

create or replace function public.ai_month_cost()
returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.ai_runs
  where created_at >= (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')
$$;
revoke execute on function public.ai_month_cost() from public, anon;
grant execute on function public.ai_month_cost() to authenticated, service_role;

create or replace function public.ai_run_start(p_row jsonb, p_cap numeric, p_reserve numeric, p_throttle int, p_window_minutes int)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_by uuid := nullif(p_row ->> 'created_by', '')::uuid;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.ai_run_start'));
  if v_by is not null and p_throttle is not null and (
       select count(*) from public.ai_runs
       where created_by = v_by and created_at >= now() - make_interval(mins => coalesce(p_window_minutes, 10))
     ) >= p_throttle then
    return jsonb_build_object('result', 'busy');
  end if;
  if p_cap is not null and public.ai_month_cost() + coalesce(p_reserve, 0) > p_cap then
    insert into public.ai_runs (created_by, action, source, label, product_id, batch_id, item_index, model, status, error)
    values (v_by, p_row ->> 'action', p_row ->> 'source', p_row ->> 'label', (p_row ->> 'product_id')::bigint, (p_row ->> 'batch_id')::uuid,
            (p_row ->> 'item_index')::int, p_row ->> 'model', 'cap', 'ai_cap')
    returning id into v_id;
    return jsonb_build_object('result', 'cap', 'id', v_id);
  end if;
  insert into public.ai_runs (created_by, action, source, label, product_id, batch_id, item_index, model, status, cost_usd)
  values (v_by, p_row ->> 'action', p_row ->> 'source', p_row ->> 'label', (p_row ->> 'product_id')::bigint, (p_row ->> 'batch_id')::uuid,
          (p_row ->> 'item_index')::int, p_row ->> 'model', 'pending', coalesce(p_reserve, 0))
  returning id into v_id;
  return jsonb_build_object('result', 'ok', 'id', v_id);
end $$;
revoke execute on function public.ai_run_start(jsonb, numeric, numeric, int, int) from public, anon, authenticated;
grant execute on function public.ai_run_start(jsonb, numeric, numeric, int, int) to service_role;
