// deno-lint-ignore-file no-explicit-any
// Test doubles for the Woo Edge Functions (never deployed: nothing outside this folder imports it).
// fakeDb: an in-memory stand-in for the supabase-js client with the surface the functions use — from(t).select /
//   insert / upsert({onConflict}) / update, the filters eq / in / not('in') / is, select-after-write, single /
//   maybeSingle, and rpc(). It knows the 0007 columns (+ products.permalink of 0009, orders.customer_state and woo_states
//   of 0010, the team columns of vendors, vendor_rates and order_items.commission_rate / commission_fee of 0011, `leave`
//   of 0012, the phase-3.3 columns of vendors, vendor_rates.flat, vendor_category_rates and woo_categories of 0014,
//   activity_log of 0002 and ai_runs of 0024), not-null columns, checks, unique keys and the foreign keys the sync relies on, so a wrong column, a bad
//   value or a missing parent fails like PostgREST would ({ data, error }, 23505 for a duplicate key). A statement is
//   atomic. Every call is recorded in `calls` in order.
// fakeWoo: a fetch that routes "METHOD path" (path after /wp-json/) to a reply (or a network error) and records every
//   request.

type Row = Record<string, any>;
type DbErr = { code: string; message: string; details?: string };

const COLUMNS: Record<string, string[]> = {
  status_map: ['id', 'system_status', 'woo_status', 'direction', 'sort'],
  vendors: ['id', 'woo_vendor_id', 'site_removed_at', 'name', 'aliases', 'phone', 'email', 'status', 'commission_pct', 'raw', 'created_at', 'updated_at',
    'legal_name', 'category', 'alt_phone', 'address', 'instagram', 'store_url', 'lead_days', 'deposit_policy', 'notes', 'joined_at', 'contract', 'opening_balance',
    'contact_name', 'address_parts', 'social', 'logo_url', 'banner_url', 'woo_payment_methods', 'woo_snapshot', 'push_pending', 'woo_synced_at'],
  vendor_rates: ['id', 'vendor_id', 'rate', 'flat', 'since', 'set_by', 'created_at', 'commission_type'], // 0016: commission_type
  // 0001 + 0046 (phase 10, team-admin): the team's profiles, the roles, the members' HR data
  profiles: ['id', 'member_code', 'name', 'email', 'phone', 'role_id', 'title', 'dept', 'manager_id', 'status', 'twofa', 'custom_perms', 'created_at'],
  roles: ['id', 'name', 'description', 'is_system', 'permissions', 'sort'],
  hr_members: ['member_id', 'shift_start', 'shift_end', 'hire_date', 'leave_days', 'contract_path', 'notes', 'updated_by', 'updated_at'],
  vendor_category_rates: ['id', 'vendor_id', 'woo_category_id', 'rate', 'flat', 'since', 'set_by', 'created_at'],
  woo_categories: ['id', 'name', 'slug', 'parent_id', 'updated_at'],
  woo_brands: ['id', 'name', 'slug', 'parent_id', 'updated_at'], // 0021 (phase 5)
  product_commissions: ['product_id', 'rate', 'type', 'fee', 'updated_at'], // 0021 (phase 5, decision 12)
  // 0011 + 0017 (phase 3.5): the five Dokan bank columns
  vendor_bank: ['vendor_id', 'method', 'bank_name', 'holder', 'iban', 'wallet', 'updated_by', 'updated_at', 'account_number', 'account_type', 'bank_address', 'routing_number', 'swift'],
  activity_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'old_value', 'new_value'],
  products: ['id', 'sku', 'name', 'image_url', 'vendor_id', 'price', 'status', 'raw', 'updated_at', 'permalink',
    // 0021 (phase 5): the mirror columns
    'lang', 'translation_ids', 'type', 'regular_price', 'sale_price', 'stock_quantity', 'stock_status', 'manage_stock', 'backorders',
    'low_stock_amount', 'total_sales', 'category_ids', 'brand_ids', 'image_count', 'weight', 'featured', 'desc_filled', 'short_desc_filled',
    'woo_modified_at', 'trashed_at'],
  orders: ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'payment_method',
    'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note',
    'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'raw', 'synced_at', 'created_at', 'updated_at', 'customer_state',
    'deleted_at', 'deleted_by', 'delete_reason', // 0033 (phase 5.5 decision 10)
    'attr_type', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ad_platform'], // 0052 (phase 9.5.3): the order's source
  sub_orders: ['id', 'order_id', 'vendor_id', 'woo_order_id', 'woo_status', 'total', 'dokan_earning', 'commission', 'raw', 'updated_at'],
  order_items: ['id', 'order_id', 'sub_order_id', 'product_id', 'sku', 'name', 'qty', 'total', 'vendor_id', 'status',
    'expected_at', 'comment', 'ready_at', 'waybill', 'pulled', 'ret', 'store', 'removed', 'raw', 'updated_at', 'commission_rate', 'commission_fee'],
  woo_webhook_events: ['id', 'received_at', 'delivery_id', 'webhook_id', 'topic', 'resource_id', 'status', 'error', 'payload'],
  woo_sync_log: ['id', 'at', 'kind', 'direction', 'entity', 'entity_id', 'action', 'result', 'detail'],
  sync_state: ['key', 'value', 'updated_at'],
  woo_states: ['code', 'name', 'updated_at'],
  // 0019 (phase 4): the read-only Dokan mirrors of the accounts page
  dokan_withdrawals: ['id', 'woo_vendor_id', 'vendor_id', 'amount', 'charge', 'receivable', 'status', 'method', 'requested_at', 'synced_at'],
  dokan_balances: ['vendor_id', 'woo_vendor_id', 'balance', 'earning', 'sales', 'orders', 'synced_at'],
  // 0013 brands (the name only here) and 0023 (phase 5.2, the studio)
  brands: ['id', 'name', 'code', 'aliases'],
  sku_colors: ['id', 'name_en', 'name_ar', 'code', 'hex'],
  studio_batches: ['id', 'title', 'brand_id', 'vendor_id', 'type', 'state', 'step', 'status', 'result', 'created_by', 'updated_at', 'archived_at'],
  // 0024 (phase 5.3): one row per AI call
  ai_runs: ['id', 'created_at', 'created_by', 'action', 'source', 'label', 'product_id', 'batch_id', 'item_index', 'model', 'input_tokens', 'output_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'status', 'error', 'output', 'credits'], // credits: 0025 (phase 5.4)
  // 0026 (phase 5.4 decision 8): the Magnific import queue
  image_imports: ['id', 'created_at', 'created_by', 'source', 'folder', 'label', 'product_id', 'urls', 'refs', 'status', 'paths', 'error', 'run_id', 'done_at', 'target', 'items', 'brand_id', 'vendor_id', 'batch_type', 'batch_id'], // 0027
  // 0028 (phase 5.4 decision 10 b): the photos sent to the Magnific site
  image_shares: ['id', 'created_at', 'created_by', 'batch_id', 'item_index', 'item_key', 'name', 'path', 'url', 'expires_at', 'status', 'creation_ref', 'error', 'sent_at'],
  // 0029 (phase 5.4 decision 11): the PKCE states of the Magnific bridge's sign-in
  magnific_oauth_states: ['state', 'verifier', 'created_by', 'created_at', 'used_at'],
  // 0030 (phase 5.4 decision 12): the category prompts of the Magnific flows
  shot_prompts: ['id', 'category', 'shot', 'name', 'prompt', 'negative', 'model', 'aspect', 'resolution', 'source_node', 'updated_at', 'updated_by'],
  // phase 9.5.1 (0049): the marketing campaigns and templates the AI actions read
  mkt_campaigns: ['id', 'name', 'goal', 'step', 'state', 'scheduled_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'archived_at', 'archived_by'],
  mkt_templates: ['id', 'name', 'kind', 'image', 'descr', 'used', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by'],
  // phase 9.5.2 (0049 + 0051): the publishing log mkt-publish reads and writes
  mkt_posts: ['id', 'campaign_id', 'piece', 'kind', 'name', 'caption', 'caption_orig', 'tags', 'images', 'platform', 'day', 'time', 'how', 'status', 'was_live', 'post_url', 'published_at', 'published_by',
    'deleted_at', 'deleted_by', 'created_by', 'created_at', 'updated_by', 'updated_at', 'src', 'external_id', 'thumb', 'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'eng', 'stats_at', 'error', 'attempts', 'claimed_at', 'work'],
  // 0052 (phase 9.5.3): Meta's ad objects and daily numbers (mkt-ads)
  mkt_ad_objects: ['platform', 'kind', 'id', 'parent_id', 'name', 'status', 'thumb', 'meta', 'updated_at'],
  mkt_ad_stats: ['platform', 'level', 'object_id', 'campaign_id', 'day', 'spend', 'impressions', 'reach', 'clicks', 'link_clicks', 'frequency', 'purchases', 'purchase_value', 'updated_at'],
  // 0053 (phase 9.5.4): the buyer's suggestions and the designer / developer requests; 0002's alerts (the daily report)
  mkt_suggestions: ['id', 'platform', 'kind', 'campaign_id', 'campaign_name', 'ad_id', 'title', 'sub', 'why', 'impact', 'pct', 'data', 'status', 'created_at', 'checked_at', 'decided_by', 'decided_at', 'value', 'note', 'result', 'error'],
  mkt_requests: ['id', 'kind', 'title', 'details', 'project', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at', 'done_at'],
  mkt_video_jobs: ['id', 'campaign_id', 'piece', 'kind', 'scene', 'creation_ref', 'status', 'url', 'path', 'bytes', 'duration', 'error', 'data', 'created_by', 'created_at', 'updated_at', 'done_at'], // 0054 (phase 9.5.5)
  alerts: ['id', 'at', 'kind', 'title', 'body', 'role_id', 'user_id', 'entity', 'entity_id', 'read_at', 'source_key', 'expires_at'], // 0056: source_key / expires_at
  // 0006 + 0056 (phase 11): the read marks and the notifications engine's memory
  alert_reads: ['alert_id', 'user_id', 'read_at'],
  alert_state: ['source_key', 'entity_id', 'target', 'first_at', 'last_sent_at', 'sent_count', 'escalated_at', 'resolved_at', 'channel_log'],
  // the tables the notify engine reads (0045 tickets, 0046 HR, 0044 inventory, 0019 accounts, 0056 company_docs)
  // phase 12 T1 (the assistant reads with the member's client): orders_v (0033 — the columns a member reads) and hr_tasks (0048)
  orders_v: ['id', 'number', 'customer_name', 'customer_phone', 'customer_city', 'customer_address', 'payment_method', 'payment_title', 'status', 'woo_status', 'confirm', 'confirm_at', 'confirm_note', 'deposit', 'total', 'currency', 'note', 'customer_note', 'placed_at', 'woo_updated_at', 'cancel', 'ret', 'synced_at', 'created_at', 'updated_at', 'customer_state'],
  hr_tasks: ['id', 'member_id', 'title', 'status', 'day', 'reason', 'reviewer_id', 'until', 'review_note', 'done_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by'],
  tickets: ['id', 'type', 'title', 'description', 'priority', 'assignee_role', 'order_number', 'order_id', 'customer', 'cs_customer_id', 'cs_conversation_id', 'vendor_id', 'vendor', 'reason', 'follow_up', 'attachments', 'status', 'created_by', 'created_by_name', 'created_by_role', 'created_at', 'last_update', 'reopen_count', 'resolution_outcome'],
  hr_requests: ['id', 'member_id', 'type', 'from_day', 'to_day', 'at_time', 'hours', 'amount', 'months', 'note', 'doc_path', 'status', 'decided_by', 'decided_at', 'reason', 'created_by', 'created_at'],
  hr_overtime: ['id', 'member_id', 'day', 'start_at', 'end_at', 'minutes', 'kind', 'note', 'status', 'paid_minutes', 'decided_by', 'decided_at', 'reason', 'created_at', 'pay_month'],
  hr_meetings: ['id', 'member_id', 'reason', 'status', 'day', 'time_text', 'place', 'outcome', 'plan', 'goals', 'support', 'review_on', 'progress', 'notes', 'ref', 'created_by', 'created_at', 'updated_at'],
  hr_payroll: ['month', 'status', 'opened_at', 'reviewed_by', 'reviewed_at', 'approved_by', 'approved_at', 'paid_by', 'paid_at', 'paid_account', 'total'],
  inv_consolidations: ['id', 'order_id', 'zone', 'status', 'carrier', 'since', 'created_by', 'created_at', 'closed_at', 'closed_by'],
  acc_expenses: ['id', 'on_date', 'direction', 'category', 'beneficiary', 'beneficiary_other', 'amount', 'note', 'sub_name', 'sub_is_other', 'sub_ends', 'sub_alerts', 'sub_note', 'created_by', 'created_at', 'updated_by', 'updated_at', 'voided_by', 'voided_at', 'details', 'staff_kind', 'reason'],
  company_docs: ['id', 'name', 'type', 'doc_no', 'issued', 'expires', 'path', 'size', 'mime', 'notes', 'created_by', 'created_at', 'updated_at'],
  // 0002: the settings rows (ai-content reads the section «ai» — phase 5.3 decision 8)
  settings: ['section', 'data', 'updated_at', 'updated_by'],
  // 0044 (phase 7): the inventory hub's lots and moves (woo-sync inventory_push reads them)
  inv_lots: ['id', 'reason', 'status', 'sku', 'product_id', 'name', 'vendor_id', 'order_id', 'item_id', 'ref', 'loc', 'mode', 'cost', 'condition', 'condition_note', 'note', 'since', 'closed_at', 'created_by', 'created_at'],
  inv_moves: ['id', 'lot_id', 'type', 'qty', 'label', 'reason', 'ref', 'note', 'by', 'at'],
  // 0034 / 0035 (phase 6.2): the customer-service tables the Meta channel writes
  cs_customers: ['id', 'phone', 'name', 'ig', 'city', 'province', 'address', 'address2', 'mood', 'tags', 'consent', 'auto_consent', 'source', 'created_from', 'blocked_at', 'blocked_by', 'merged_into', 'created_by', 'created_at', 'updated_at'],
  cs_contacts: ['id', 'customer_id', 'platform', 'external_id', 'handle', 'created_at'],
  cs_conversations: ['id', 'seg', 'platform', 'channel', 'customer_id', 'vendor_id', 'handle', 'external_id', 'status', 'assignee', 'outcome', 'tags', 'last_in_at', 'last_out_at', 'waiting_since', 'unread', 'snoozed_until', 'closed_at', 'closed_by', 'created_by', 'created_at', 'updated_at'],
  cs_messages: ['id', 'conversation_id', 'kind', 'text', 'author', 'external_id', 'delivery', 'meta', 'created_at', 'claimed_at'],
  cs_channels: ['id', 'name', 'audience', 'kind', 'status', 'number', 'cap_per_day', 'since', 'last_message_at', 'meta', 'updated_at'],
  cs_oauth_states: ['state', 'verifier', 'channel', 'created_by', 'created_at', 'used_at'],
  cs_channel_events: ['id', 'received_at', 'object', 'entry_id', 'status', 'error', 'summary'],
  // 0041 (phase 6.2 decision 19): the posts the comments are on
  cs_posts: ['id', 'platform', 'caption', 'permalink', 'thumb', 'kind', 'posted_at', 'seen_at'],
  // 0042 (phase 6.3 + 6.4): WhatsApp by QR and the campaigns' sending
  cs_wa_state: ['channel', 'status', 'qr_svg', 'phone', 'command', 'updated_at'],
  cs_campaigns: ['id', 'name', 'segment_id', 'channel', 'body', 'image_path', 'discount_code', 'scheduled_at', 'cap_per_day', 'min_delay_s', 'test_phone', 'status', 'size', 'stats', 'created_by', 'created_at', 'updated_at'],
  cs_campaign_recipients: ['id', 'campaign_id', 'customer_id', 'phone', 'status', 'at', 'reply', 'wa_id', 'error', 'claimed_at'],
  // 0058 (phase 6.5): the auto-reply page's tables and the engine's run log; 0045 ticket_events (the engine opens tickets as the server)
  cs_templates: ['id', 'lib', 'name', 'cat', 'tone', 'body', 'trig_kind', 'trig_on', 'trig_when', 'channels', 'quick_key', 'wa_template', 'wa_vars', 'used', 'active', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  cs_quick_replies: ['id', 'key', 'label', 'text', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  cs_auto_rules: ['id', 'name', 'grp', 'event', 'event_to', 'conds', 'action', 'template_id', 'role_id', 'tag', 'delay_min', 'once', 'ticket_if_silent', 'enabled', 'runs', 'last_run_at', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  cs_auto_runs: ['id', 'rule_id', 'entity', 'customer_id', 'conversation_id', 'message_id', 'result', 'code', 'due_at', 'at'],
  ticket_events: ['id', 'ticket_id', 'kind', 'at', 'actor', 'actor_name', 'actor_role', 'text', 'old_value', 'new_value', 'attachments'],
};
const DEFAULTS: Record<string, Row> = {
  status_map: { direction: 'both' },
  vendors: { aliases: [], status: 'active', lead_days: 7, opening_balance: 0 },
  orders: { confirm: 'غير مؤكد', deposit: 0, total: 0, currency: 'EGP' },
  order_items: { qty: 1, total: 0, status: '', pulled: false, removed: false },
  sync_state: { value: {} },
  vendor_bank: { method: 'bank' },
  cs_customers: { tags: [], consent: true, auto_consent: true, created_from: 'manual' }, cs_conversations: { status: 'جديدة', tags: [], unread: 0 }, cs_messages: { meta: {} },
  cs_channels: { status: 'disconnected', cap_per_day: 300, meta: {} }, cs_channel_events: { summary: {} },
  cs_templates: { lib: 'customers', cat: 'متابعة', tone: 'brand', trig_kind: 'manual', trig_on: [], trig_when: 'فورًا', channels: 'كل القنوات', wa_vars: [], used: 0, active: true }, cs_quick_replies: {},
  cs_auto_rules: { conds: [], action: 'send', delay_min: 0, once: true, ticket_if_silent: false, enabled: false, runs: 0 }, cs_auto_runs: {}, ticket_events: { kind: 'event', attachments: [] },
  cs_wa_state: { status: 'offline' }, cs_campaigns: { status: 'مسودة', cap_per_day: 300, min_delay_s: 20, size: 0, stats: {} }, cs_campaign_recipients: { status: 'queued' },
  mkt_posts: { src: 'system', how: 'download', status: 'مجدول', was_live: false, attempts: 0, images: [], caption: '', caption_orig: '', tags: '' },
  mkt_suggestions: { platform: 'meta', status: 'pending', data: {} }, mkt_requests: { status: 'جديد' }, mkt_video_jobs: { status: 'queued', data: {} },
  alert_state: { sent_count: 0, channel_log: [] }, tickets: { status: 'open', attachments: [], reopen_count: 0 }, hr_requests: { status: 'جديد' }, hr_overtime: { status: 'مستني', kind: 'hours', paid_minutes: 0 }, hr_meetings: { status: 'مطلوب', goals: [] },
  hr_payroll: { status: 'مسودة' }, inv_consolidations: { status: 'open' }, acc_expenses: { direction: 'withdraw' },
};
const SERIAL: Record<string, 'int' | 'uuid'> = { status_map: 'int', vendors: 'uuid', sub_orders: 'int', woo_webhook_events: 'int', woo_sync_log: 'int',
  vendor_rates: 'int', vendor_category_rates: 'int', activity_log: 'int', ai_runs: 'int', image_imports: 'int', image_shares: 'int', shot_prompts: 'int',
  cs_customers: 'uuid', cs_contacts: 'int', cs_conversations: 'uuid', cs_messages: 'uuid', cs_channel_events: 'int', tickets: 'int', cs_templates: 'uuid', cs_quick_replies: 'uuid', cs_auto_rules: 'uuid', cs_auto_runs: 'int', ticket_events: 'int', hr_requests: 'int', hr_overtime: 'int', hr_meetings: 'int', inv_consolidations: 'uuid', acc_expenses: 'uuid', company_docs: 'uuid', cs_campaigns: 'uuid', cs_campaign_recipients: 'int', mkt_posts: 'int', mkt_suggestions: 'int', mkt_requests: 'int', mkt_video_jobs: 'int', alerts: 'int' };
const UNIQUE: Record<string, string[][]> = {
  status_map: [['id'], ['system_status']], vendors: [['id'], ['woo_vendor_id']], products: [['id']], orders: [['id']],
  sub_orders: [['id'], ['woo_order_id'], ['order_id', 'vendor_id']], order_items: [['id']],
  woo_webhook_events: [['id'], ['delivery_id']], woo_sync_log: [['id']], sync_state: [['key']], woo_states: [['code']],
  vendor_rates: [['id'], ['vendor_id', 'since']], vendor_category_rates: [['id'], ['vendor_id', 'woo_category_id', 'since']], woo_categories: [['id']], activity_log: [['id']],
  vendor_bank: [['vendor_id']], ai_runs: [['id']], settings: [['section']], image_imports: [['id']], image_shares: [['id']], magnific_oauth_states: [['state']], shot_prompts: [['id'], ['category', 'shot']],
  cs_customers: [['id'], ['phone']], cs_contacts: [['id'], ['platform', 'external_id']], cs_conversations: [['id'], ['channel', 'external_id']], cs_messages: [['id'], ['external_id']], cs_channels: [['id']],
  cs_oauth_states: [['state']], cs_channel_events: [['id']], cs_posts: [['id']], cs_wa_state: [['channel']], cs_campaigns: [['id']], cs_campaign_recipients: [['id'], ['campaign_id', 'customer_id']],
  cs_templates: [['id'], ['quick_key']], cs_quick_replies: [['id'], ['key']], cs_auto_rules: [['id']], cs_auto_runs: [['id'], ['rule_id', 'entity']], ticket_events: [['id']], // the live index on (rule_id, entity) is partial (result <> failed): the fake is stricter
  profiles: [['id'], ['email'], ['phone'], ['member_code']], roles: [['id']], hr_members: [['member_id']], mkt_posts: [['id'], ['platform', 'external_id']], mkt_ad_objects: [['platform', 'kind', 'id']], mkt_ad_stats: [['platform', 'level', 'object_id', 'day']],
  mkt_suggestions: [['id']], mkt_requests: [['id']], mkt_video_jobs: [['id']], alerts: [['id']],
  alert_reads: [['alert_id', 'user_id']], alert_state: [['source_key', 'entity_id', 'target']], tickets: [['id']], hr_requests: [['id']], hr_overtime: [['id']], hr_meetings: [['id']], hr_payroll: [['month']], inv_consolidations: [['id']], acc_expenses: [['id']], company_docs: [['id']],
};
const NOT_NULL: Record<string, string[]> = {
  status_map: ['system_status'], vendors: ['name', 'aliases', 'status'], products: ['name'],
  orders: ['number', 'customer_name', 'status', 'confirm', 'deposit', 'total', 'placed_at'],
  order_items: ['order_id', 'name', 'qty', 'total', 'status', 'pulled', 'removed'], sub_orders: ['order_id'],
  woo_webhook_events: ['topic', 'status'], woo_sync_log: ['kind', 'result'], sync_state: ['value'], woo_states: ['code', 'name'],
  vendor_rates: ['vendor_id', 'rate', 'since'], vendor_category_rates: ['vendor_id', 'woo_category_id', 'since'], woo_categories: ['name'], activity_log: ['action'],
  cs_customers: ['name', 'created_from'], cs_contacts: ['customer_id', 'platform', 'external_id'], cs_conversations: ['seg', 'platform', 'channel', 'status'], cs_messages: ['conversation_id', 'kind', 'text'],
  cs_channels: ['name', 'audience', 'kind', 'status'], cs_oauth_states: ['verifier', 'channel', 'created_by'], cs_channel_events: ['object', 'status'],
  cs_templates: ['name', 'body'], cs_quick_replies: ['key', 'label', 'text'], cs_auto_rules: ['name', 'event', 'action'], cs_auto_runs: ['rule_id', 'entity', 'result'], ticket_events: ['ticket_id', 'kind', 'actor_name', 'actor_role', 'text'],
  mkt_posts: ['kind', 'name', 'platform', 'day', 'time', 'how', 'status', 'src'], mkt_suggestions: ['kind', 'campaign_id', 'title'], mkt_requests: ['kind', 'title'], mkt_video_jobs: ['campaign_id', 'piece', 'kind', 'created_by'], alerts: ['kind', 'title'],
};
const CHECK: Record<string, Record<string, unknown[]>> = {
  cs_customers: { created_from: ['orders', 'manual', 'import', 'channel'] }, cs_contacts: { platform: ['whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook'] },
  cs_conversations: { seg: ['customers', 'vendors', 'comments'], platform: ['whatsapp', 'messenger', 'instagram', 'tiktok', 'facebook'], channel: ['wa1', 'wa2', 'messenger', 'instagram', 'tiktok', 'facebook'], status: ['جديدة', 'مستنية ردنا', 'مستنية العميل', 'مؤجلة', 'اتحلت'] },
  cs_messages: { kind: ['in', 'out', 'note', 'auto', 'event'], delivery: [null, 'queued', 'sent', 'delivered', 'read', 'failed'] }, // external_id ≤ 1000 (0037)
  cs_auto_runs: { result: ['sent', 'held', 'skipped', 'failed', 'ticket', 'assigned', 'tagged'] }, cs_auto_rules: { event: ['status', 'sub', 'first', 'afterhours', 'cart', 'transfer'], action: ['send', 'ticket', 'assign', 'tag'] },
  cs_channels: { status: ['disconnected', 'connected', 'error'] }, cs_oauth_states: { channel: ['messenger', 'instagram', 'wa1', 'ads_tiktok', 'ads_google'] }, cs_channel_events: { status: ['ok', 'ignored', 'error'] },
  vendors: { status: ['active', 'leave', 'inactive'] },
  woo_webhook_events: { status: ['ok', 'ignored', 'duplicate', 'error'] },
  woo_sync_log: { kind: ['webhook', 'sync', 'push', 'manual', 'cron'], direction: [null, 'in', 'out'], result: ['ok', 'error', 'conflict', 'skipped'] },
  ai_runs: { action: ['write', 'studio', 'image', 'marketing', 'assistant'], source: [null, 'data', 'image', 'product', 'studio', 'tool', 'edit', 'import', 'campaign', 'template', 'post', 'buyer', 'video', 'chat', 'filter'], status: ['pending', 'ok', 'refused', 'error', 'cap'] }, // image: 0025, import: 0026 (phase 5.4), buyer: 0053, video: 0054, assistant / chat / filter: 0059 (phase 12)
  image_imports: { source: ['magnific'], status: ['pending', 'ok', 'partial', 'error'], target: [null, 'tool', 'studio', 'batch'], batch_type: [null, 'Simple', 'Variable'] },
  image_shares: { status: ['pending', 'sent', 'error'] },
  mkt_posts: { src: ['system', 'platform'], how: ['download', 'publish'], status: ['مجدول', 'اتنشر', 'فشل', 'اتحذف'], platform: ['انستجرام', 'فيسبوك', 'تيك توك'], kind: ['بوست', 'كاروسيل', 'ريل', 'ستوري'] },
};
// numeric checks of 0011 / 0014: rate 0–65, flat ≥ 0 (null passes)
const RANGE: Record<string, Record<string, [number, number]>> = {
  vendor_rates: { rate: [0, 65], flat: [0, Infinity] }, vendor_category_rates: { rate: [0, 65], flat: [0, Infinity], woo_category_id: [1, Infinity] },
};
// [column, referenced table, referenced column]
const FK: Record<string, [string, string, string][]> = {
  orders: [['status', 'status_map', 'system_status']],
  products: [['vendor_id', 'vendors', 'id']],
  vendor_rates: [['vendor_id', 'vendors', 'id']], vendor_category_rates: [['vendor_id', 'vendors', 'id']], vendor_bank: [['vendor_id', 'vendors', 'id']],
  sub_orders: [['order_id', 'orders', 'id'], ['vendor_id', 'vendors', 'id']],
  order_items: [['order_id', 'orders', 'id'], ['sub_order_id', 'sub_orders', 'id'], ['vendor_id', 'vendors', 'id']],
};

const same = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const clone = <T>(v: T): T => structuredClone(v);
const err = (code: string, message: string, details?: string): DbErr => ({ code, message, ...(details ? { details } : {}) });
const colsOf = (spec: string) => spec.split(',').map((c) => c.trim()).filter(Boolean);

export type Call = { table?: string; op: string; rows?: Row[]; patch?: Row; filters?: unknown[]; onConflict?: string; returning?: string | null; name?: string; args?: unknown; error?: DbErr | null };

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { rpc?: Record<string, (args: any) => unknown>; fail?: (call: Call) => DbErr | null; storage?: Record<string, Uint8Array> } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.keys(COLUMNS).map((t) => [t, []]));
  const calls: Call[] = [];
  let serial = 1000;

  function complete(table: string, row: Row): Row {
    const full: Row = Object.fromEntries(COLUMNS[table].map((c) => [c, null]));
    Object.assign(full, clone(DEFAULTS[table] ?? {}), clone(row));
    if (SERIAL[table] && full.id == null) {
      serial += 1;
      full.id = SERIAL[table] === 'uuid' ? `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}` : serial;
    }
    return full;
  }

  function validate(table: string, rows: Row[], all: Record<string, Row[]>): DbErr | null {
    for (const row of rows) {
      for (const c of NOT_NULL[table] ?? []) if (row[c] === null || row[c] === undefined) return err('23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`, `Failing row contains (${Object.values(row).join(', ')})`);
      for (const [c, allowed] of Object.entries(CHECK[table] ?? {})) if (!allowed.includes(row[c] ?? null)) return err('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      for (const [c, [lo, hi]] of Object.entries(RANGE[table] ?? {})) if (row[c] != null && (Number(row[c]) < lo || Number(row[c]) > hi)) return err('23514', `new row for relation "${table}" violates check constraint "${table}_${c}_check"`);
      for (const [c, ref, refCol] of FK[table] ?? []) {
        if (row[c] !== null && row[c] !== undefined && !all[ref].some((r) => same(r[refCol], row[c]))) return err('23503', `insert or update on table "${table}" violates foreign key constraint "${table}_${c}_fkey"`);
      }
    }
    for (const key of UNIQUE[table] ?? []) {
      const seen = new Set<string>();
      for (const row of all[table]) {
        if (key.some((c) => row[c] === null || row[c] === undefined)) continue;
        const k = key.map((c) => String(row[c])).join('|');
        if (seen.has(k)) return err('23505', `duplicate key value violates unique constraint "${table}_${key.join('_')}_key"`);
        seen.add(k);
      }
    }
    return null;
  }

  function checkColumns(table: string, names: string[]): DbErr | null {
    if (!COLUMNS[table]) return err('42P01', `relation "public.${table}" does not exist`);
    const bad = names.find((c) => c !== '*' && !COLUMNS[table].includes(c));
    return bad ? err('42703', `column "${bad}" of relation "${table}" does not exist`) : null;
  }

  function matches(row: Row, filters: any[]): boolean {
    return filters.every(([kind, col, value]) => {
      if (kind === 'eq') return same(row[col], value);
      if (kind === 'in') return (value as unknown[]).some((v) => same(row[col], v));
      if (kind === 'is') return value === null ? row[col] === null || row[col] === undefined : row[col] === value;
      if (kind === 'not.in') return !String(value).replace(/^\(|\)$/g, '').split(',').some((v) => same(row[col], v.trim()));
      if (kind === 'gte') return row[col] != null && String(row[col]) >= String(value); // ISO timestamps of one format
      if (kind === 'lte') return row[col] != null && String(row[col]) <= String(value);
      if (kind === 'neq') return !same(row[col], value);
      if (kind === 'not.null') return row[col] !== null && row[col] !== undefined;
      throw new Error(`fakeDb: unsupported filter ${kind}`);
    });
  }

  const project = (rows: Row[], spec: string) => rows.map((r) => (spec.trim() === '*' ? clone(r) : Object.fromEntries(colsOf(spec).map((c) => [c, clone(r[c])]))));

  function run(q: any): { data: any; error: DbErr | null } {
    const call: Call = { table: q.table, op: q.op, filters: q.filters, ...(q.rows ? { rows: clone(q.rows) } : {}), ...(q.patch ? { patch: clone(q.patch) } : {}), ...(q.onConflict ? { onConflict: q.onConflict } : {}), returning: q.returning };
    calls.push(call);
    const done = (data: any, error: DbErr | null = null) => { call.error = error; return { data: error ? null : data, error }; };
    const injected = opts.fail?.(call);
    if (injected) return done(null, injected);
    const table = q.table as string;
    const names = [...(q.rows ?? []).flatMap((r: Row) => Object.keys(r)), ...Object.keys(q.patch ?? {}), ...q.filters.map((f: any) => f[1]),
      ...(q.op === 'select' ? colsOf(q.columns) : []), ...(q.returning ? colsOf(q.returning) : []), ...(q.onConflict ? colsOf(q.onConflict) : [])];
    const colErr = checkColumns(table, names);
    if (colErr) return done(null, colErr);

    if (q.op === 'select') {
      let rows = tables[table].filter((r) => matches(r, q.filters));
      if (q.order) { rows = [...rows].sort((x, y) => String(x[q.order]).localeCompare(String(y[q.order]))); if (q.desc) rows.reverse(); }
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      return finish(done, project(rows, q.columns), q.single);
    }
    const next = clone(tables);
    let touched: Row[] = [];
    if (q.op === 'insert') {
      touched = q.rows.map((r: Row) => complete(table, r));
      next[table].push(...touched);
    } else if (q.op === 'upsert') {
      const key = colsOf(q.onConflict ?? 'id');
      const hit = new Set<Row>();
      for (const r of q.rows) {
        const found = next[table].find((x) => key.every((c) => same(x[c], r[c])));
        // Postgres forms the proposed tuple before `on conflict`: a not-null column without a default that is missing from the
        // upserted row fails even when the conflicting row carries it (seen live on vendors.name, 26 Oct)
        for (const c of NOT_NULL[table] ?? []) if ((!(c in r) && !(c in (DEFAULTS[table] ?? {}))) || r[c] === null) return done(null, err('23502', `null value in column "${c}" of relation "${table}" violates not-null constraint`));
        if (found && hit.has(found)) return done(null, err('21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time'));
        if (found) { Object.assign(found, clone(r)); hit.add(found); touched.push(found); } else { const row = complete(table, r); next[table].push(row); hit.add(row); touched.push(row); }
      }
    } else if (q.op === 'update') {
      touched = next[table].filter((r) => matches(r, q.filters));
      for (const r of touched) Object.assign(r, clone(q.patch));
    }
    const bad = validate(table, touched, next);
    if (bad) return done(null, bad);
    for (const t of Object.keys(next)) tables[t] = next[t];
    return finish(done, q.returning ? project(touched, q.returning) : null, q.single);
  }

  function finish(done: (d: any, e?: DbErr | null) => any, data: any, single: string | null) {
    if (!single) return done(data);
    const rows = data ?? [];
    if (rows.length > 1 || (single === 'one' && rows.length !== 1)) return done(null, err('PGRST116', 'JSON object requested, multiple (or no) rows returned'));
    return done(rows[0] ?? null);
  }

  function from(table: string) {
    const q: any = { table, op: 'select', columns: '*', filters: [], returning: null, single: null, range: null };
    const b: any = {
      select(columns = '*') { if (q.op === 'select') q.columns = columns; else q.returning = columns; return b; },
      insert(rows: Row | Row[]) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      upsert(rows: Row | Row[], o: { onConflict?: string } = {}) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; q.onConflict = o.onConflict ?? 'id'; return b; },
      update(patch: Row) { q.op = 'update'; q.patch = patch; return b; },
      delete() { throw new Error('fakeDb: the functions must never delete'); },
      eq(col: string, v: unknown) { q.filters.push(['eq', col, v]); return b; },
      in(col: string, v: unknown[]) { q.filters.push(['in', col, v]); return b; },
      is(col: string, v: unknown) { q.filters.push(['is', col, v]); return b; },
      gte(col: string, v: unknown) { q.filters.push(['gte', col, v]); return b; },
      lte(col: string, v: unknown) { q.filters.push(['lte', col, v]); return b; },
      neq(col: string, v: unknown) { q.filters.push(['neq', col, v]); return b; },
      limit(n: number) { q.range = [0, n - 1]; return b; },
      not(col: string, op: string, v: unknown) { if (op === 'is' && v === null) { q.filters.push(['not.null', col, null]); return b; } if (op !== 'in') throw new Error(`fakeDb: unsupported not.${op}`); q.filters.push(['not.in', col, v]); return b; },
      range(a: number, z: number) { q.range = [a, z]; return b; },
      order(col: string, o: { ascending?: boolean } = {}) { q.order = col; q.desc = o.ascending === false; return b; },
      single() { q.single = 'one'; return b; },
      maybeSingle() { q.single = 'maybe'; return b; },
      then(ok: (v: any) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve().then(() => run(q)).then(ok, ko); },
    };
    return b;
  }

  async function rpc(name: string, args: unknown = {}) {
    const call: Call = { op: 'rpc', name, args: clone(args) };
    calls.push(call);
    const fn = opts.rpc?.[name];
    if (!fn) { call.error = err('PGRST202', `Could not find the function public.${name}`); return { data: null, error: call.error }; }
    return { data: await fn(args), error: null };
  }

  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => complete(t, r));
  const seeded = calls.length;
  return {
    from, rpc, calls,
    // phase 5.2: storage.from(bucket).download(path) over opts.storage ('bucket/path' → bytes); phase 5.4: upload(path, bytes, { contentType,
    // upsert }) writes there too (an existing path without upsert → the Storage API's 409 Duplicate), and a failing one via opts.fail
    storage: { from: (bucket: string) => ({
      download: async (path: string) => { calls.push({ op: 'download', table: bucket, args: { path } } as any); const b = opts.storage?.[`${bucket}/${path}`]; return b ? { data: new Blob([b as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }; },
      // phase 5.4: a signed URL of an existing object (the fake host signed.test), none for a missing one
      createSignedUrl: async (path: string, seconds: number) => { calls.push({ op: 'sign', table: bucket, args: { path, seconds } } as any); return opts.storage?.[`${bucket}/${path}`] ? { data: { signedUrl: `https://signed.test/${bucket}/${path}?token=t` }, error: null } : { data: null, error: { message: 'Object not found' } }; },
      upload: async (path: string, body: Uint8Array | Blob, o: { contentType?: string; upsert?: boolean } = {}) => {
        const call: Call = { op: 'upload', table: bucket, args: { path, contentType: o.contentType ?? null, upsert: !!o.upsert } };
        calls.push(call);
        const injected = opts.fail?.(call); if (injected) { call.error = injected; return { data: null, error: { message: injected.message } }; }
        if (!opts.storage) opts.storage = {};
        if (opts.storage[`${bucket}/${path}`] && !o.upsert) { call.error = err('409', 'The resource already exists'); return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }; }
        opts.storage[`${bucket}/${path}`] = body instanceof Uint8Array ? body : new Uint8Array(await (body as Blob).arrayBuffer());
        return { data: { path }, error: null };
      },
      // phase 5.4 (WebP): remove(paths) drops what exists and answers the names it dropped (a missing one is no error, as in Storage)
      remove: async (paths: string[]) => {
        calls.push({ op: 'remove', table: bucket, args: { paths } } as any);
        const gone = paths.filter((p) => opts.storage?.[`${bucket}/${p}`]);
        for (const p of gone) delete opts.storage![`${bucket}/${p}`];
        return { data: gone.map((name) => ({ name })), error: null };
      },
    }) },
    rows: (t: string): any[] => clone(tables[t]),
    row: (t: string, id: unknown, key = 'id'): any => clone(tables[t].find((r) => same(r[key], id)) ?? null),
    writes: (t?: string): any[] => calls.slice(seeded).filter((c) => ['insert', 'upsert', 'update'].includes(c.op) && (!t || c.table === t)),
  };
}

export type WooCall = { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: any; timed: boolean; redirect?: string };
export type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string>; error?: Error };

export function fakeWoo(routes: Record<string, Reply | ((call: WooCall) => Reply | undefined)> = {}) {
  const calls: WooCall[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: WooCall = {
      method: init.method ?? 'GET', path: url.pathname.replace(/^\/wp-json\//, ''), query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body instanceof Uint8Array ? { bytes: init.body.length } : init.body ? JSON.parse(String(init.body)) : undefined,
      timed: init.signal instanceof AbortSignal, redirect: init.redirect,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    const reply = typeof route === 'function' ? route(call) : route;
    if (!reply) return Promise.resolve(new Response(JSON.stringify({ code: 'rest_no_route', message: 'No route' }), { status: 404 }));
    if (reply.error) return Promise.reject(reply.error);
    return Promise.resolve(new Response(reply.text ?? JSON.stringify(reply.body ?? null), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } }));
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

// ---------------------------------------------------------------- fixtures (fake values only)

export const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.test', SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  WOO_URL: 'https://woo.test', WOO_CK: 'ck_test_0001', WOO_CS: 'cs_test_0002', WOO_WEBHOOK_SECRET: 'test-secret',
};
export const WC_AUTH = 'Basic ' + btoa('ck_test_0001:cs_test_0002');
export const NOW = '2026-10-25T12:00:00.000Z';
export const PHONE = '01012345678';

// The nine rows of 0007 as 0009 leaves them: «تم RTC» (sort 6) became «فشل» = failed, from_woo (sort 10) on the same row.
export const STATUS_MAP: Row[] = [
  ['قيد الانتظار', 'pending', 'both', 1], ['جاري التنفيذ', 'processing', 'both', 2], ['معلّق', 'on-hold', 'both', 3],
  ['جاهز للشحن', 'ready-shipping', 'both', 4], ['قيد الشحن', 'in-shipping', 'both', 5], ['فشل', 'failed', 'from_woo', 10],
  ['مكتمل', 'completed', 'both', 7], ['استرجاع', 'refunded', 'both', 8], ['ملغي', 'cancelled', 'both', 9],
].map(([system_status, woo_status, direction, sort], i) => ({ id: i + 1, system_status, woo_status, direction, sort }));

export const vendorId = (wooId: number) => `00000000-0000-4000-8000-${String(wooId).padStart(12, '0')}`;
export const vendorRow = (wooId: number, extra: Row = {}): Row => ({ id: vendorId(wooId), woo_vendor_id: wooId, name: `متجر ${wooId}`, ...extra });
const vendorMeta = (v: number) => [{ id: v, key: '_dokan_vendor_id', value: String(v) }];

/** A Woo parent order with two lines (makers 44 and 2376) and a customer phone. */
export function wooOrder(extra: Row = {}): Row {
  return {
    id: 1001, number: '1001', parent_id: 0, status: 'processing', currency: 'EGP', total: '450.00', created_via: 'checkout',
    date_created_gmt: '2026-10-20T10:00:00', date_modified_gmt: '2026-10-20T11:00:00',
    payment_method: 'cod', payment_method_title: 'الدفع عند الاستلام', customer_note: '',
    billing: { first_name: 'سلوى', last_name: 'زيتوني', phone: PHONE, email: 'rasha@example.test', city: 'القاهرة', address_1: 'شارع 9' },
    shipping: { first_name: 'سلوى', last_name: 'زيتوني', city: 'القاهرة', address_1: 'شارع 9', phone: '' },
    meta_data: [{ id: 7, key: 'bosta_customer_phone', value: PHONE }],
    line_items: [
      { id: 1, product_id: 501, name: 'كوباية', sku: 'CUP-1', quantity: 2, total: '200.00', meta_data: vendorMeta(44) },
      { id: 2, product_id: 502, name: 'شنطة', sku: 'BAG-1', quantity: 1, total: '250.00', meta_data: vendorMeta(2376) },
    ],
    ...extra,
  };
}

/** A Dokan sub-order of `parentId` for maker `vendor`. */
export function wooSub(id: number, parentId: number, vendor: number, extra: Row = {}): Row {
  return {
    id, number: String(id), parent_id: parentId, status: 'processing', currency: 'EGP', total: '200.00', created_via: 'dokan',
    date_created_gmt: '2026-10-20T10:00:05', date_modified_gmt: '2026-10-20T11:00:05',
    billing: { first_name: 'سلوى', phone: PHONE }, meta_data: vendorMeta(vendor), line_items: [{ id: id * 10, product_id: 501, quantity: 1, meta_data: [] }],
    ...extra,
  };
}

export const wooStore = (id: number, extra: Row = {}): Row => ({
  id, store_name: `Store ${id}`, enabled: true, phone: '01000000000', email: 'store@example.test', show_email: false,
  shop_url: `https://woo.test/store/${id}/`, registered: '2025-01-02 10:00:00', ...extra,
});

/** A dokan/v1/stores item with the whole phase-3.3 payload (the 37 fields' shapes; every value made up). */
export const wooStoreFull = (id: number, extra: Row = {}): Row => ({
  ...wooStore(id), first_name: 'Maker', last_name: `Owner ${id}`, featured: false, trusted: false, banner: `https://woo.test/b/${id}.jpg`, banner_id: 1,
  gravatar: `https://woo.test/g/${id}.jpg`, gravatar_id: 2, location: '', store_toc: '', toc_enabled: false, rating: { rating: '0', count: 0 },
  address: { street_1: `شارع ${id}`, street_2: '', city: 'القاهرة', state: 'EG-01', zip: '', country: 'EG' },
  social: { fb: `https://fb.test/${id}`, instagram: '', twitter: '', youtube: '', linkedin: '', pinterest: '', threads: '', flickr: '' },
  payment: { bank: { ac_name: 'x', ac_number: '1', ac_type: '', bank_name: '', bank_addr: '', iban: 'EG00TEST', swift: '', routing_number: '' }, paypal: { email: 'p@example.test' } },
  withdraw_options: [], active_payment_methods: { bank: {} }, admin_commission_type: 'fixed', admin_commission: '30', admin_additional_fee: '',
  admin_category_commission: [], ...extra,
});

export function wooProduct(id: number, vendor: number | null, extra: Row = {}): Row {
  return {
    id, name: `منتج ${id}`, sku: `SKU-${id}`, status: 'publish', type: 'simple', price: '120', regular_price: '150',
    date_modified_gmt: '2026-10-21T09:00:00', permalink: `https://woo.test/p/${id}`,
    images: [{ id: 1, src: `https://woo.test/img/${id}-a.jpg` }, { id: 2, src: `https://woo.test/img/${id}-b.jpg` }],
    ...(vendor === null ? {} : { store: { id: vendor, name: 'Owner Name', shop_name: `Store ${vendor}`, address: { street_1: 'x' } } }),
    ...extra,
  };
}

/** Base64(HMAC-SHA256(body, secret)) — the X-WC-Webhook-Signature value. */
export async function sign(body: string | Uint8Array, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof body === 'string' ? enc.encode(body) : (body as BufferSource)));
  return btoa(String.fromCharCode(...mac));
}

/** Every text written to woo_sync_log.detail / woo_webhook_events.error, for "no secret, no phone" checks. */
export const writtenText = (db: ReturnType<typeof fakeDb>) => JSON.stringify([db.rows('woo_sync_log'), db.rows('woo_webhook_events')]);
