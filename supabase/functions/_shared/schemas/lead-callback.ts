import { z } from "zod";

/**
 * `/api-lead-callback` request body (GAP_REGISTER Cluster G item 2 —
 * real-estate lead callback). Consent is REQUIRED and never a bare
 * boolean: TCPA requires prior express consent for an artificial/AI voice
 * call, so the caller must supply the exact text the lead agreed to plus
 * when they agreed to it — a missing/empty `consent_text` fails validation
 * before this ever reaches the handler (refuses without consent, per
 * CLAUDE.md Rule 2's fail-closed posture).
 */
export const LeadCallbackRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(7).max(20),
  source: z.enum(["web_form", "crm_webhook"]).default("web_form"),
  consent_text: z.string().trim().min(1).max(2000),
  /** When the lead gave consent — ISO 8601. Defaults to the moment this
   * request is processed when the caller's own form doesn't separately
   * timestamp the checkbox click. */
  consent_given_at: z.iso.datetime().optional(),
  consent_ip: z.string().trim().min(1).max(64).optional(),
  /** Re-submission of the same CRM webhook delivery must not place a
   * second call — the caller-supplied key backs a per-tenant unique index
   * (`lead_callback_requests_tenant_idempotency_key_unique`). */
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type LeadCallbackRequest = z.infer<typeof LeadCallbackRequestSchema>;
