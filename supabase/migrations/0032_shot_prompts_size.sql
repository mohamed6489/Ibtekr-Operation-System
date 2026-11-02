-- 0032_shot_prompts_size — phase 5.4 decision 15 (the owner, 2 Nov): the size drawing is the fourth shot of every flow. Its words are
-- the system's (SIZE_PROMPT in _shared/magnific-bridge.js, the product's numbers filled in a generator a product); a template row
-- «<category> 4 — المقاسات» may replace them, so the library accepts shot 4. Re-runnable.

alter table public.shot_prompts drop constraint if exists shot_prompts_shot_check;
alter table public.shot_prompts add constraint shot_prompts_shot_check check (shot between 1 and 4);
