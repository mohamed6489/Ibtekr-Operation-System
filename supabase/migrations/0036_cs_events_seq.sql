-- 0036_cs_events_seq — phase 6.2 fix (3 Nov): cs_channel_events (0035) is a bigserial whose sequence was never granted to
-- service_role (this project grants nothing by default — rule 4), so every webhook's log row failed quietly. Applied live on
-- 3 Nov through execute_sql. Re-runnable.
grant usage, select on sequence public.cs_channel_events_id_seq to service_role;
