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
    | "auto_repair"
    | "veterinary"
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
  twilio_sid: string;
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
  cancel_reason: Nullable<string>;
  cancelled_at: Nullable<string>;
  identity_verified_by: Nullable<"phone_match" | "knowledge">;
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
  total_cents: number;
  status: "received" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
  source_call_id: Nullable<string>;
  pos_order_id: Nullable<string>;
  idempotency_key: string;
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

export type ReferralPayoutRow = {
  id: string;
  referral_partner_id: string;
  amount_cents: number;
  method: string;
  status: "pending" | "processing" | "paid" | "failed";
  paid_at: Nullable<string>;
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
    | "twilio_number_provision"
    | "retell_number_import"
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
      payment_links: Tbl<PaymentLinkRow>;
      referral_partners: Tbl<ReferralPartnerRow>;
      referral_links: Tbl<ReferralLinkRow>;
      referrals: Tbl<ReferralRow>;
      referral_payouts: Tbl<ReferralPayoutRow>;
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
    };
    Views: {
      v_tenant_margin: { Row: Record<string, unknown>; Relationships: [] };
      v_call_cost_vs_billed: { Row: Record<string, unknown>; Relationships: [] };
      v_usage_alerts: { Row: Record<string, unknown>; Relationships: [] };
      v_referral_pnl: { Row: Record<string, unknown>; Relationships: [] };
    };
    // Required by postgrest-js's `GenericSchema` — this app calls every RPC
    // through an edge-function Route Handler proxy (packages/adapters/*
    // provider isolation, CLAUDE.md Rule 2), never `supabase.rpc()`
    // directly, so this stays empty rather than hand-transcribing function
    // signatures nothing calls.
    Functions: Record<string, never>;
  };
};
