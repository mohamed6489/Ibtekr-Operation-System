-- tools/seed/00-cleanup.sql — يمسح الداتا التجريبية بتاعة tools/seed/*.sql (وبس هي): بالـ uuid الثابتة dd000000-… وبعلامة «تجريبي».
-- بيتشغّل قبل أي seed (re-runnable) وهو كمان المسح النهائي. service_role عشان الحرّاس.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- الحسابات
delete from public.acc_expenses where note = 'تجريبي' or sub_note = 'تجريبي';
delete from public.acc_vendor_moves where note = 'تجريبي';
delete from public.acc_account_moves where note = 'تجريبي';

-- خدمة العملاء والرد الآلي
delete from public.cs_messages where conversation_id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_team_ratings where customer_id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_customer_notes where customer_id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_conversations where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_campaign_recipients where campaign_id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_campaigns where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_segments where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_auto_rules where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_quick_replies where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_templates where id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_contacts where customer_id::text like 'dd000000-0000-4000-8000-%';
delete from public.cs_customers where id::text like 'dd000000-0000-4000-8000-%';

-- المخزن
delete from public.inv_count_lines where lot_id::text like 'dd000000-0000-4000-8000-%';
delete from public.inv_counts where note = 'تجريبي';
delete from public.inv_moves where lot_id::text like 'dd000000-0000-4000-8000-%';
delete from public.inv_lots where id::text like 'dd000000-0000-4000-8000-%';

-- التذاكر
delete from public.ticket_events where ticket_id in (select id from public.tickets where description like '%(تجريبي)%');
delete from public.tickets where description like '%(تجريبي)%';

-- الموارد البشرية
delete from public.hr_attendance where note = 'تجريبي';
delete from public.hr_requests where note like '%تجريبي%';
delete from public.hr_overtime where note like '%تجريبي%';
delete from public.hr_tasks where title like '%تجريبي%';
delete from public.hr_kpis where name like '%تجريبي%';
delete from public.hr_holidays where name like '%تجريبي%';
delete from public.hr_meetings where reason like '%تجريبي%';
delete from public.hr_extras where rule like '%تجريبي%';
delete from public.hr_adjustments where label like '%تجريبي%';
delete from public.hr_scores where note = 'تجريبي';

-- التسويق
delete from public.mkt_posts where campaign_id::text like 'dd000000-0000-4000-8000-%';
delete from public.mkt_video_jobs where campaign_id::text like 'dd000000-0000-4000-8000-%';
delete from public.mkt_campaigns where id::text like 'dd000000-0000-4000-8000-%';
delete from public.mkt_templates where id::text like 'dd000000-0000-4000-8000-%';
delete from public.mkt_requests where project = 'تجريبي';
delete from public.mkt_suggestions where campaign_id like '9900000%';

-- التنبيهات
delete from public.alerts where source_key like 'seed:%';
