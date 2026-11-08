-- 0059 — phase 12 T1 (docs/superpowers/plans/2026-11-08-phase-12-followups.md, decision 8): the real AI assistant of the header.
-- ai_runs takes action 'assistant' (one row per conversation turn of the ai-content action `assistant`: the member who asked,
-- the label = the question's first 200 characters, the summed cost of the turn's Claude calls, output = { text, actions, tools }).
-- Nothing else changes: the reservation (ai_run_start), the monthly cap and the throttle of 0024 cover the new action as they are.

alter table public.ai_runs drop constraint if exists ai_runs_action_check;
alter table public.ai_runs add constraint ai_runs_action_check check (action in ('write', 'studio', 'image', 'marketing', 'assistant'));
alter table public.ai_runs drop constraint if exists ai_runs_source_check;
alter table public.ai_runs add constraint ai_runs_source_check
  check (source is null or source in ('data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video', 'chat', 'filter'));
