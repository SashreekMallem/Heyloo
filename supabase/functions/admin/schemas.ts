import { z } from "zod";

/**
 * Local re-declarations of `packages/canonical-types`' admin-settings
 * schemas (Deno can't import the Node/ESM `@heyloo/canonical-types`
 * package directly — same cross-runtime constraint documented on
 * `api-adapter-connect/schema.ts`; kept field-for-field identical to
 * `adminReferralSettingSchema`/`platformPricingTableSchema`/
 * `adminAlertThresholdSchema` in that package).
 */

export const VERTICALS = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

/**
 * COCKPIT-F06: the only qualification rule `fn_check_referral_qualification`
 * understands is `paid_invoices_gte` (+ `value`, the number of paid invoices);
 * accepting any other free text would save a rule nothing ever reads.
 */
export const REFERRAL_QUALIFICATION_RULES = ["paid_invoices_gte"] as const;

export const AdminReferralSettingSchema = z.object({
  flat_amount_cents: z.number().int().nonnegative(),
  qualification_rule: z.enum(REFERRAL_QUALIFICATION_RULES),
  qualification_value: z.number().int().min(1).max(24).optional(),
});

export const PlatformPricingTableSchema = z.object({
  vertical: z.enum(VERTICALS),
  base_cents: z.number().int().nonnegative(),
  included_minutes: z.number().int().nonnegative(),
  overage_cents: z.number().int().nonnegative(),
  included_text_conversations: z.number().int().nonnegative(),
  text_conversation_overage_cents: z.number().int().nonnegative(),
  effective_at: z.string().min(1),
});

export const ALERT_METRICS = [
  "price_drift",
  "negative_margin",
  "usage_spike",
  "concurrency",
  "tool_failure_spike",
  "commission_over_margin",
  "payment_failures",
] as const;

export const AdminAlertThresholdSchema = z.object({
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  value: z.number(),
  enabled: z.boolean(),
  channel: z.enum(["email", "sms", "dashboard_only"]),
});

/**
 * Recurring referral-partner commission terms (GAP_REGISTER Cluster G item
 * 1, owner decision — admin-set, NO platform-wide default). `rate_bps:
 * null` explicitly clears the rate (partner earns no recurring commission)
 * rather than leaving it unset — every field is nullable/optional so a
 * partial PATCH only touches what's sent.
 */
export const AdminCommissionTermsSchema = z.object({
  rate_bps: z.number().int().min(0).max(10_000).nullable().optional(),
  commission_base: z.enum(["gross_profit", "revenue"]).optional(),
  duration_months: z.number().int().positive().nullable().optional(),
});

export const AdminCommissionVerticalOverrideSchema = z.object({
  rate_bps: z.number().int().min(0).max(10_000).nullable().optional(),
  commission_base: z.enum(["gross_profit", "revenue"]).nullable().optional(),
  duration_months: z.number().int().positive().nullable().optional(),
});

/**
 * `PATCH admin-tenants/:id` (COCKPIT-F16). Unknown keys (the page also sends
 * `tenant_id`) are ignored; every editable field is bounded before it reaches
 * SQL. `reason` is required by the handler when pausing/cancelling and is
 * stored in the audit row.
 */
export const TENANT_STATUSES = ["trialing", "active", "past_due", "paused", "canceled"] as const;

export const AdminTenantPatchSchema = z.object({
  status: z.enum(TENANT_STATUSES).optional(),
  usage_hard_cap_minutes: z.number().int().min(0).max(1_000_000).nullable().optional(),
  manual_mode: z.boolean().optional(),
  retention_days: z.number().int().min(1).max(3650).optional(),
  // A blank reason counts as absent; the handler answers `reason_required` when one is needed.
  reason: z.string().trim().max(1000).optional(),
});

export const AdminSupportRequestUpdateSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export const AdminSupportRequestNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  visible_to_tenant: z.boolean().default(false),
});

/**
 * `POST admin-outreach/campaigns` body — field for field the canonical
 * `outreachCampaignSchema` (`packages/canonical-types`, which Deno cannot
 * import); `handler.outreach.test.ts` fails when the two drift. `sending_domain`
 * is the form's name for `campaigns.sender_domain` (COCKPIT-F08, F23).
 */
export const SENDING_DOMAIN_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const MAX_DAILY_SEND_CAP = 2000;

export const OutreachCampaignCreateSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(200),
  vertical: z.enum(VERTICALS),
  sending_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SENDING_DOMAIN_RE, "Enter a domain such as mail.example.com"),
  daily_send_cap: z.number().int().min(1, "Must be at least 1").max(MAX_DAILY_SEND_CAP),
  template_id: z.union([z.literal(""), z.uuid("Template ID must be a UUID")]).optional(),
  respect_suppression: z.literal(true),
});
