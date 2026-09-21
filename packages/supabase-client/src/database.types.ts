/**
 * Hand-maintained row types for every table `apps/web` reads/writes,
 * transcribed from `supabase/migrations/*.sql` (the single source of
 * truth — CLAUDE.md Rule 2). NOT a full `supabase gen types` dump: columns
 * genuinely unused by any frontend surface in FRONTEND_SPEC.md are omitted
 * to keep this maintainable by hand; add a column here the day a page
 * needs it. `Insert`/`Update` are structural partials of `Row` (all
 * columns with a DB default become optional on insert) rather than a
 * second hand-transcribed shape per table — pragmatic for a single build
 * agent's velocity, revisit with real `supabase gen types` once the CLI/DB
 * link is available in CI.
 */

type Nullable<T> = T | null;

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  vertical:
    | "auto"
    | "vet"
    | "legal"
    | "dental"
    | "real_estate"
    | "motel"
    | "restaurant"
    | "generic";
  business_type: Nullable<string>;
  plan_code: string;
  price_version: string;
  status: "trialing" | "active" | "past_due" | "paused" | "canceled";
  timezone: string;
  business_hours: Record<string, { open: string; close: string }[]>;
  hours_exceptions: {
    date: string;
    closed?: boolean;
    hours?: { open: string; close: string }[];
    note?: string;
  }[];
  branding: { logo_url?: string; primary_color?: string; accent_color?: string };
  language_config: { primary: string; bilingual: boolean };
  retention_days: number;
  stripe_customer_id: Nullable<string>;
  stripe_subscription_id: Nullable<string>;
  owner_test_phone: Nullable<string>;
  manual_mode: boolean;
  manual_mode_enabled_at: Nullable<string>;
  usage_hard_cap_minutes: Nullable<number>;
  seasonal_pause: boolean;
  avg_transaction_value_cents: number;
  review_url: Nullable<string>;
  review_request_enabled: boolean;
  voice_reminders_enabled: boolean;
  a2p_status: "pending_verification" | "verified" | "failed";
  deleted_at: Nullable<string>;
  // 20260910150000_tenants_policies_reviewed_at.sql (FIX_REQUESTS.md) — set
  // the moment a tenant owner/admin saves the vertical-details form with a
  // non-empty cancellation_policy.text; NULL = never reviewed/saved.
  policies_reviewed_at: Nullable<string>;
  // 20260911101000_channels_tenant_and_call_log_columns.sql
  // (BACKEND_SPEC.md §13.2, BUILD_PLAN Cluster W/text-agent tasks).
  text_agent_enabled: boolean;
  text_agent_persona: Record<string, unknown>;
  quiet_hours: { start?: string; end?: string; enabled?: boolean };
  widget_enabled: boolean;
  widget_settings: {
    allowed_origins?: string[];
    accent?: Nullable<string>;
    position?: "bottom-right" | "bottom-left";
    greeting?: Nullable<string>;
    modes?: ("voice" | "chat")[];
  };
  widget_public_key: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  invited_email: Nullable<string>;
  accepted_at: Nullable<string>;
  last_seen_notifications_at: string;
  created_at: string;
};

export type PhoneNumberRow = {
  id: string;
  tenant_id: string;
  e164: string;
  // SIGNUP-1: nullable — a number purchased directly through Retell's
  // `/create-phone-number` (no Twilio account of our own) has no Twilio
  // PhoneNumberSid at all (migration 20260921065200).
  twilio_sid: Nullable<string>;
  retell_number_id: Nullable<string>;
  forwarding_mode: "conditional" | "full";
  forwarding_verified_at: Nullable<string>;
  forwarding_carrier: Nullable<string>;
  spam_label_status: "unknown" | "clean" | "flagged" | "remediating";
  cnam_registered: boolean;
  is_primary: boolean;
  released_at: Nullable<string>;
  created_at: string;
};

export type AgentTemplateRow = {
  id: string;
  vertical: string;
  name: string;
  version: number;
  compile_target: "conversation_flow" | "multi_prompt" | "single_prompt";
  system_prompt: Nullable<string>;
  states: unknown[];
  transitions: unknown[];
  global_intents: unknown[];
  tools: unknown[];
  voice_id: string;
  model: string;
  disclosure_line: string;
  is_active: boolean;
  created_by: Nullable<string>;
  created_at: string;
};

export type AgentConfigRow = {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version: number;
  assistant_name: Nullable<string>;
  special_instructions: Nullable<string>;
  transfer_number: Nullable<string>;
  greeting_overrides: Record<string, unknown>;
  dynamic_variable_overrides: Record<string, unknown>;
  retell_agent_id: Nullable<string>;
  retell_llm_id: Nullable<string>;
  compiled_config: Nullable<Record<string, unknown>>;
  published_at: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type CustomerRow = {
  id: string;
  tenant_id: string;
  phone_e164: string;
  name: Nullable<string>;
  email: Nullable<string>;
  segment: "new" | "returning" | "loyal" | "vip";
  lifetime_value_cents: number;
  lifetime_bookings: number;
  lifetime_calls: number;
  first_seen_at: string;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  sms_opt_out: boolean;
  consent: { sms?: boolean; call?: boolean; captured_at?: string; call_id?: string };
  created_at: string;
};

export type CustomerAddressRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  label: Nullable<string>;
  street: string;
  city: Nullable<string>;
  state: Nullable<string>;
  zip: Nullable<string>;
  delivery_instructions: Nullable<string>;
  is_default: boolean;
  created_at: string;
};

export type CallLogRow = {
  id: string;
  tenant_id: string;
  phone_number_id: Nullable<string>;
  retell_call_id: string;
  caller_number: Nullable<string>;
  direction: "inbound" | "outbound";
  // `20260911101000_channels_tenant_and_call_log_columns.sql` — reconciled
  // 4-value shape (docs/audit/CHANNELS_REQUESTS.md item 1/item 6):
  // 'phone'/'web_voice' distinguish a real voice call's origination
  // (Twilio number vs. the embeddable widget's voice mode); 'sms'/
  // 'web_chat' tag a shadow row the text-agent engine creates so
  // voice-tools/tools/*.ts can be reused unmodified for text-originated
  // bookings (duration_seconds/recording_url/transcript/cost_cents stay
  // null on those rows). Default 'phone'; a voice-only "recent calls" view
  // should filter `channel in ("phone", "web_voice")`.
  channel: "phone" | "web_voice" | "sms" | "web_chat";
  started_at: Nullable<string>;
  ended_at: Nullable<string>;
  duration_seconds: Nullable<number>;
  disconnection_reason: Nullable<string>;
  classification: Nullable<CallClassification>;
  outcome: Nullable<string>;
  sentiment: Nullable<"positive" | "neutral" | "negative">;
  call_successful: Nullable<boolean>;
  call_summary: Nullable<string>;
  follow_up_needed: boolean;
  urgency_flag: boolean;
  message_text: Nullable<string>;
  structured_booking_payload: Nullable<Record<string, unknown>>;
  extracted_entities: Nullable<Record<string, unknown>>;
  state_trace: { state: string; enteredAt: string }[];
  variable_values: Record<string, unknown>;
  recording_url: Nullable<string>;
  stereo_recording_url: Nullable<string>;
  transcript: Nullable<{ speaker: string; text: string; ts: number }[]>;
  latency_p50_ms: Nullable<number>;
  latency_p95_ms: Nullable<number>;
  tool_call_count: number;
  tool_error_count: number;
  cost_cents: Nullable<number>;
  is_test_call: boolean;
  legal_advice_given: boolean;
  created_at: string;
};

export type CallClassification =
  | "new_booking"
  | "reschedule"
  | "cancel"
  | "question_faq"
  | "status_check"
  | "sales_lead"
  | "solicitor"
  | "wrong_number"
  | "spam_robocall"
  | "emergency"
  | "after_hours_message"
  | "transfer_request";

export type OfferingRow = {
  id: string;
  tenant_id: string;
  name: string;
  category: Nullable<string>;
  duration_minutes: Nullable<number>;
  price_cents: Nullable<number>;
  resource_type_required: Nullable<string>;
  metadata: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ResourceRow = {
  id: string;
  tenant_id: string;
  type: "chair" | "room" | "table" | "bay" | "staff" | "agent";
  name: string;
  capacity: number;
  room_type: Nullable<string>;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AvailabilitySlotRow = {
  id: string;
  tenant_id: string;
  resource_id: string;
  slot_range: string; // Postgres tstzrange wire format, e.g. `["2026-09-08 09:00:00+00","2026-09-08 09:30:00+00")`
  is_available: boolean;
  source: "generated" | "manual_block" | "schedule_change";
  generated_at: string;
};

export type BookingStatus =
  | "scheduled"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled"
  | "rescheduled";

export type BookingRow = {
  id: string;
  tenant_id: string;
  resource_id: string;
  offering_id: Nullable<string>;
  customer_id: Nullable<string>;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  party_size: Nullable<number>;
  source_call_id: Nullable<string>;
  idempotency_key: Nullable<string>;
  notes: Nullable<string>;
  structured_payload: Record<string, unknown>;
  quoted_rate_cents: Nullable<number>;
  hold_expires_at: Nullable<string>;
  cancel_reason: Nullable<string>;
  cancelled_at: Nullable<string>;
  identity_verified_by: Nullable<"phone_match" | "knowledge">;
  /** CALL-6 (docs/BUILD_NOTES.md) — true for a booking created from a
   * Retell batch-test/simulator call (`call_logs.is_test_call`). Excluded
   * from the tenant dashboard bookings list and every KPI count by
   * default. */
  is_test: boolean;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  tenant_id: string;
  customer_id: Nullable<string>;
  items: {
    offering_id?: string;
    name: string;
    qty: number;
    unit_price_cents?: number;
    modifiers?: string[];
  }[];
  fulfillment_type: "pickup" | "delivery" | "dine_in";
  delivery_address: Nullable<Record<string, unknown>>;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  status: "received" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
  source_call_id: Nullable<string>;
  pos_order_id: Nullable<string>;
  idempotency_key: string;
  allergies: Nullable<string[]>;
  special_instructions: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type WaitlistEntryRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  offering_id: Nullable<string>;
  resource_type: Nullable<string>;
  window: string;
  status: "active" | "notified" | "converted" | "expired";
  idempotency_key: Nullable<string>;
  created_at: string;
};

export type MessageOutboundRow = {
  id: string;
  tenant_id: string;
  channel: "sms" | "email" | "push" | "airtable";
  recipient: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "delivered" | "failed" | "bounced" | "pending_verification";
  provider_message_id: Nullable<string>;
  related_call_id: Nullable<string>;
  related_booking_id: Nullable<string>;
  related_order_id: Nullable<string>;
  error: Nullable<string>;
  created_at: string;
  sent_at: Nullable<string>;
};

export type MessageInboundRow = {
  id: string;
  tenant_id: string;
  phone_number_id: Nullable<string>;
  customer_id: Nullable<string>;
  from_e164: string;
  to_e164: string;
  body: string;
  classification: "stop" | "help" | "other";
  handled: boolean;
  created_at: string;
};

// 20260911120000_text_conversations.sql /
// 20260911130000_text_conversation_messages.sql (Cluster T's text-agent
// engine). `text_conversations.channel`/`status` enums per that migration
// exactly — NOT the same shape `docs/audit/CHANNELS_REQUESTS.md` item 1
// flags as a still-unresolved filename conflict with a different cluster's
// own migration; this is the schema that's actually wired to working
// engine code, per that doc's own resolution note.
export type TextConversationRow = {
  id: string;
  tenant_id: string;
  channel: "sms" | "web_chat";
  phone_e164: Nullable<string>;
  customer_id: Nullable<string>;
  widget_session_token_hash: Nullable<string>;
  call_log_id: Nullable<string>;
  status: "open" | "human" | "closed";
  structured_state: Record<string, unknown>;
  recent_turns: { role: "user" | "assistant"; text: string; at: string }[];
  disclosure_sent: boolean;
  verification_phone_e164: Nullable<string>;
  verification_code_hash: Nullable<string>;
  verification_code_expires_at: Nullable<string>;
  verification_attempts: number;
  message_count: number;
  ai_message_count: number;
  last_inbound_at: Nullable<string>;
  last_outbound_at: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type TextConversationMessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  author: "customer" | "ai" | "human";
  body: string;
  created_at: string;
};

export type PaymentLinkRow = {
  id: string;
  tenant_id: string;
  order_id: Nullable<string>;
  booking_id: Nullable<string>;
  stripe_checkout_session_id: Nullable<string>;
  amount_cents: number;
  purpose: "order" | "deposit" | "noshow_fee";
  status: "pending" | "sent" | "paid" | "expired" | "cancelled";
  expires_at: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type ReferralPartnerRow = {
  id: string;
  user_id: Nullable<string>;
  name: string;
  email: string;
  payout_method: string;
  paypal_email: Nullable<string>;
  w9_status: "not_submitted" | "submitted" | "verified";
  ytd_payout_cents: number;
  fraud_flags: unknown[];
  ftc_acknowledged_at?: Nullable<string>;
  ftc_acknowledged_version?: Nullable<string>;
  // 20260910140000_referral_commission_recurring.sql — admin-set recurring
  // per-partner profit-share commission terms (FIX_REQUESTS.md).
  rate_bps: Nullable<number>;
  commission_base: "gross_profit" | "revenue";
  duration_months: Nullable<number>;
  created_at: string;
};

// 20260910140000_referral_commission_recurring.sql — per-vertical override
// of a referral_partners row's rate_bps/commission_base/duration_months
// (FIX_REQUESTS.md — previously missing from the Database type entirely).
export type ReferralPartnerVerticalOverrideRow = {
  id: string;
  referral_partner_id: string;
  vertical:
    | "auto"
    | "vet"
    | "legal"
    | "dental"
    | "real_estate"
    | "motel"
    | "restaurant"
    | "generic";
  rate_bps: Nullable<number>;
  commission_base: Nullable<"gross_profit" | "revenue">;
  duration_months: Nullable<number>;
  created_at: string;
};

// 20260907131000_money.sql + 20260910140000_referral_commission_recurring.sql
// (revenue_cents/cost_cents/base_cents/rate_bps added by the latter)
// (FIX_REQUESTS.md — previously missing from the Database type entirely).
export type CommissionEventRow = {
  id: string;
  referral_partner_id: string;
  referral_id: string;
  tenant_id: string;
  amount_cents: number;
  period: Nullable<string>;
  status: "accrued" | "batched" | "paid" | "clawed_back";
  revenue_cents: Nullable<number>;
  cost_cents: Nullable<number>;
  base_cents: Nullable<number>;
  rate_bps: Nullable<number>;
  created_at: string;
};

export type ReferralLinkRow = {
  id: string;
  referral_partner_id: string;
  code: string;
  created_at: string;
};

export type ReferralRow = {
  id: string;
  referral_link_id: Nullable<string>;
  referral_partner_id: string;
  referred_tenant_id: string;
  attribution_source: "link" | "cookie";
  status: "pending" | "qualified" | "paid" | "clawed_back" | "disqualified";
  qualified_at: Nullable<string>;
  amount_cents_snapshot: Nullable<number>;
  fraud_flag: boolean;
  created_at: string;
};

// FIX_REQUESTS.md — the real columns (20260907130800_referrals.sql) are
// total_cents/period/paypal_batch_id/status, NOT amount_cents/method/
// paid_at; status's real CHECK (20260910100400_referral_payouts_terminal_statuses.sql)
// is 'pending'|'sent'|'completed'|'failed'|'returned', not 'processing'|'paid'.
export type ReferralPayoutRow = {
  id: string;
  referral_partner_id: string;
  period: string;
  total_cents: number;
  paypal_batch_id: Nullable<string>;
  status: "pending" | "sent" | "completed" | "failed" | "returned";
  created_at: string;
};

export type SupportRequestRow = {
  id: string;
  tenant_id: string;
  call_id: Nullable<string>;
  booking_id: Nullable<string>;
  subject: string;
  body: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "pending" | "resolved" | "closed";
  created_by: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type SupportRequestNoteRow = {
  id: string;
  support_request_id: string;
  author_id: string;
  body: string;
  visible_to_tenant: boolean;
  created_at: string;
};

export type BillingInvoiceRow = {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  stripe_invoice_id: Nullable<string>;
  base_fee_cents: number;
  included_minutes: number;
  overage_minutes: number;
  overage_cents: number;
  discount_cents: number;
  total_cents: number;
  status: "draft" | "finalized" | "paid" | "past_due" | "void";
  created_at: string;
};

export type UsageDailyRow = {
  tenant_id: string;
  date: string;
  total_calls: number;
  total_minutes: number;
  billable_minutes: number;
  total_bookings: number;
  total_orders: number;
  total_order_value_cents: number;
  price_version: string;
  // 20260911110000_channels_pricing_and_usage.sql /
  // 20260911120000_text_conversations.sql (BACKEND_SPEC.md §13.3) — the
  // one column both cluster S's and cluster T's colliding migrations add
  // identically (same name, same type, same default); safe regardless of
  // how docs/audit/CHANNELS_REQUESTS.md item 1's conflict resolves.
  text_messages_out: number;
  created_at: string;
  updated_at: string;
};

export type PlatformSettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_by: Nullable<string>;
  updated_at: string;
};

export type DemoSessionRow = {
  id: string;
  business_name: string;
  source_url: Nullable<string>;
  vertical: Nullable<string>;
  scraped_summary: Record<string, unknown>;
  sanitized: boolean;
  agent_config_snapshot: Record<string, unknown>;
  retell_call_token: Nullable<string>;
  demo_phone_e164: Nullable<string>;
  status?: "scraping" | "sanitizing" | "compiling" | "ready" | "failed";
  expires_at: string;
  created_at: string;
};

export type ProvisioningRunRow = {
  id: string;
  tenant_id: string;
  step:
    | "tenant_finalize"
    | "agent_compile"
    | "retell_number_provision"
    | "billing_wiring"
    | "publish_agent"
    | "notify";
  status: "pending" | "in_progress" | "succeeded" | "failed";
  error: Nullable<string>;
  attempts: number;
  updated_at: string;
  created_at: string;
};

export type AlertRow = {
  id: string;
  rule: string;
  severity: "info" | "warning" | "critical";
  tenant_id: Nullable<string>;
  payload: Record<string, unknown>;
  status: "open" | "acked" | "resolved";
  created_at: string;
  acked_at: Nullable<string>;
  acked_by: Nullable<string>;
};

export type LeadRow = {
  id: string;
  source: "apollo" | "outscraper" | "apify" | "license_roll";
  vertical: Nullable<string>;
  company_name: Nullable<string>;
  contact_name: Nullable<string>;
  email: Nullable<string>;
  phone: Nullable<string>;
  enrichment: Record<string, unknown>;
  status: "new" | "queued" | "sent" | "replied" | "suppressed" | "converted";
  created_at: string;
};

export type CampaignRow = {
  id: string;
  name: string;
  vertical: Nullable<string>;
  sender_domain: string;
  provider: "smartlead" | "instantly";
  status: "draft" | "warming" | "active" | "paused";
  complaint_rate: Nullable<number>;
  created_at: string;
};

export type SendEventRow = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_index: number;
  provider_message_id: Nullable<string>;
  sent_at: Nullable<string>;
  opened_at: Nullable<string>;
  clicked_at: Nullable<string>;
  status: "queued" | "sent" | "bounced" | "complained";
};

export type ReplyRow = {
  id: string;
  send_event_id: Nullable<string>;
  lead_id: string;
  body: string;
  ai_intent: Nullable<"interested" | "not_interested" | "unsubscribe" | "question" | "auto_reply">;
  received_at: string;
};

export type SuppressionListRow = {
  id: string;
  contact: string;
  reason: "unsubscribe" | "bounce" | "complaint" | "manual";
  created_at: string;
};

export type CostEventRow = {
  id: string;
  tenant_id: string;
  call_id: Nullable<string>;
  provider: string;
  product: string;
  quantity: Nullable<number>;
  unit: Nullable<"minute" | "unit" | "message">;
  unit_cost_cents: Nullable<number>;
  total_cost_cents: number;
  occurred_at: string;
  created_at: string;
};

export type RevenueEventRow = {
  id: string;
  tenant_id: string;
  type: "base_fee" | "overage" | "setup_fee" | "refund" | "annual_prepay_discount";
  amount_cents: number;
  period_start: Nullable<string>;
  period_end: Nullable<string>;
  created_at: string;
};

export type AdminActionRow = {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: Nullable<string>;
  before: Nullable<Record<string, unknown>>;
  after: Nullable<Record<string, unknown>>;
  created_at: string;
};

/**
 * T7 deep-integration adapter tables (supabase/migrations/20260907160000_
 * t7_adapter_connections.sql) — added per docs/audit/FIX_REQUESTS.md's
 * regeneration request (this file predated both tables). `provider` is
 * left as `string` rather than a literal union since it changes across
 * migrations (the 20260910100000 follow-up added `'airtable'`) and nothing
 * in apps/web currently narrows on it beyond an equality filter.
 */
export type AdapterConnectionRow = {
  id: string;
  tenant_id: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  auth_mode: "oauth2_authorization_code" | "oauth2_client_credentials" | "api_key";
  access_token: Nullable<string>;
  refresh_token: Nullable<string>;
  expires_at: Nullable<string>;
  provider_account_id: Nullable<string>;
  metadata: Record<string, unknown>;
  last_refreshed_at: Nullable<string>;
  last_error: Nullable<string>;
  disconnected_at: Nullable<string>;
  connected_by: Nullable<string>;
  created_at: string;
  updated_at: string;
};

export type AdapterSyncStateRow = {
  tenant_id: string;
  provider: string;
  entity_type: "booking" | "order";
  entity_id: string;
  external_id: Nullable<string>;
  last_synced_at: Nullable<string>;
  content_hash: Nullable<string>;
  sync_conflict: boolean;
  created_at: string;
  updated_at: string;
};

/** Airtable-specific precedent table (20260907131200_supporting_tables.sql)
 * that `adapter_sync_state` above later generalized to every T7 adapter —
 * kept for whichever call site (if any) still reads it directly. */
export type AirtableSyncStateRow = {
  tenant_id: string;
  entity_type: "booking" | "order";
  entity_id: string;
  airtable_record_id: Nullable<string>;
  last_synced_at: Nullable<string>;
  content_hash: Nullable<string>;
  sync_conflict: boolean;
  created_at: string;
};

/** Structural helper: every column is optional on insert (DB defaults fill the rest) except the ones a caller must always supply — good enough for this app's insert call sites without a second hand-transcribed shape per table. */
export type InsertOf<Row> = { [K in keyof Row]?: Row[K] };
export type UpdateOf<Row> = { [K in keyof Row]?: Row[K] };

/**
 * `Relationships: []` on every entry below is required structurally by
 * postgrest-js's `GenericTable` (it must be present for the client's
 * select-string type inference to resolve at all — without it, TS quietly
 * collapses every query's Row/Insert type to `never` instead of erroring
 * loudly, which is what happened here before this was added). An empty
 * array means no foreign-key-hinted embedded selects (`.select("*,
 * customers(name)")`) are type-checked — this app does joins as separate
 * queries instead, so that's an acceptable trade for a hand-maintained
 * (non-generated) Database type.
 */
type Tbl<Row> = { Row: Row; Insert: InsertOf<Row>; Update: UpdateOf<Row>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      tenants: Tbl<TenantRow>;
      memberships: Tbl<MembershipRow>;
      phone_numbers: Tbl<PhoneNumberRow>;
      agent_templates: Tbl<AgentTemplateRow>;
      agent_configs: Tbl<AgentConfigRow>;
      customers: Tbl<CustomerRow>;
      customer_addresses: Tbl<CustomerAddressRow>;
      call_logs: Tbl<CallLogRow>;
      offerings: Tbl<OfferingRow>;
      resources: Tbl<ResourceRow>;
      availability_slots: Tbl<AvailabilitySlotRow>;
      bookings: Tbl<BookingRow>;
      orders: Tbl<OrderRow>;
      waitlist_entries: Tbl<WaitlistEntryRow>;
      messages_outbound: Tbl<MessageOutboundRow>;
      messages_inbound: Tbl<MessageInboundRow>;
      text_conversations: Tbl<TextConversationRow>;
      text_conversation_messages: Tbl<TextConversationMessageRow>;
      payment_links: Tbl<PaymentLinkRow>;
      referral_partners: Tbl<ReferralPartnerRow>;
      referral_partner_vertical_overrides: Tbl<ReferralPartnerVerticalOverrideRow>;
      referral_links: Tbl<ReferralLinkRow>;
      referrals: Tbl<ReferralRow>;
      referral_payouts: Tbl<ReferralPayoutRow>;
      commission_events: Tbl<CommissionEventRow>;
      support_requests: Tbl<SupportRequestRow>;
      support_request_notes: Tbl<SupportRequestNoteRow>;
      billing_invoices: Tbl<BillingInvoiceRow>;
      usage_daily: Tbl<UsageDailyRow>;
      platform_settings: Tbl<PlatformSettingRow>;
      demo_sessions: Tbl<DemoSessionRow>;
      provisioning_runs: Tbl<ProvisioningRunRow>;
      alerts: Tbl<AlertRow>;
      leads: Tbl<LeadRow>;
      campaigns: Tbl<CampaignRow>;
      send_events: Tbl<SendEventRow>;
      replies: Tbl<ReplyRow>;
      suppression_list: Tbl<SuppressionListRow>;
      cost_events: Tbl<CostEventRow>;
      revenue_events: Tbl<RevenueEventRow>;
      admin_actions: Tbl<AdminActionRow>;
      adapter_connections: Tbl<AdapterConnectionRow>;
      adapter_sync_state: Tbl<AdapterSyncStateRow>;
      airtable_sync_state: Tbl<AirtableSyncStateRow>;
    };
    Views: {
      v_tenant_margin: { Row: Record<string, unknown>; Relationships: [] };
      v_call_cost_vs_billed: { Row: Record<string, unknown>; Relationships: [] };
      v_usage_alerts: { Row: Record<string, unknown>; Relationships: [] };
      v_referral_pnl: { Row: Record<string, unknown>; Relationships: [] };
    };
    // This app calls almost every RPC through an edge-function Route
    // Handler proxy (packages/adapters/* provider isolation, CLAUDE.md Rule
    // 2), never `supabase.rpc()` directly — these two are the documented
    // exception: `pgmq` isn't exposed over PostgREST (supabase/config.toml
    // `[api] schemas` is `public`/`graphql_public` only), so a tenant
    // dashboard action that needs to enqueue a queue message has no edge
    // function to proxy through and calls these directly instead
    // (docs/audit/FIX_REQUESTS.md). Both no-op server-side on a
    // tenant_id mismatch rather than raising.
    Functions: {
      fn_enqueue_adapter_push: {
        Args: {
          p_tenant_id: string;
          p_adapter: string;
          p_entity_type: string;
          p_entity_id: string;
        };
        Returns: undefined;
      };
      fn_enqueue_message_outbound: {
        Args: { p_message_id: string };
        Returns: undefined;
      };
    };
  };
};
