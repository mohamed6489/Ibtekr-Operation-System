-- 0037_cs_mid_length — phase 6.2 fix (3 Nov): Instagram message ids (mids) run past the 160 characters 0034 allowed on
-- cs_messages.external_id, so every Instagram DM was dropped as invalid. Up to 1000 now (the function keeps the id whole — a cut one
-- never matches the Send API's). Re-runnable.
alter table public.cs_messages drop constraint if exists cs_messages_external_id_check;
alter table public.cs_messages add constraint cs_messages_external_id_check check (external_id is null or char_length(external_id) <= 1000);
