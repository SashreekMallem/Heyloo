import type { RetellFetch } from "../_shared/providers/retell.ts";
import { listPhoneNumbers, updatePhoneNumber } from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-admin-attach-retell-number` (CALL-1, docs/BUILD_PLAN.md task 2):
 * re-points an EXISTING Retell-account phone number at a tenant's compiled
 * agent — never calls Twilio, never imports a number (the live account
 * already owns the number; the owner approved re-pointing it away from the
 * old product's agents, docs/BUILD_NOTES.md CALL-1 entry).
 *
 * `phone_numbers.twilio_sid` is NOT NULL + unique (`supabase/migrations/
 * 20260907130200_telephony.sql`) because every OTHER phone number this
 * platform provisions is purchased via Twilio and imported into Retell
 * (`api-provision`'s saga). This number was neither — it's a pre-existing
 * Retell-native/imported number this task re-points, so a deterministic
 * `retell-native:<e164>` placeholder is written instead of a real Twilio
 * SID. Known, documented limitation (BUILD_NOTES CALL-1 entry): code that
 * assumes every `phone_numbers.twilio_sid` is a real Twilio resource
 * (`api-a2p-register`, `job-retell-health-failover`, `job-offboarding`)
 * will not work correctly against this row — out of this task's scope to
 * fix, since none of those paths block a first live call.
 */

export interface AttachRetellNumberRequest {
  tenant_id: string;
  phone_e164?: string;
}

export interface AttachRetellNumberResult {
  status: number;
  body: { phone_e164: string } | { error: string };
}

export interface AttachRetellNumberDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  inboundWebhookUrl: string;
  logger: Logger;
}

export function validateRequest(
  body: unknown,
): { ok: true; data: AttachRetellNumberRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const tenantId = b["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  const phoneE164 = b["phone_e164"];
  if (phoneE164 !== undefined && typeof phoneE164 !== "string") {
    return { ok: false, error: "invalid_phone_e164" };
  }
  return {
    ok: true,
    data: {
      tenant_id: tenantId,
      ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
    },
  };
}

interface RetellPhoneNumberListItem {
  phone_number: string;
  [key: string]: unknown;
}

export async function attachRetellNumber(
  sql: SqlClient,
  rawBody: unknown,
  deps: AttachRetellNumberDeps,
): Promise<AttachRetellNumberResult> {
  const parsed = validateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;

  const agentRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${req.tenant_id}
  `;
  const agentId = agentRows[0]?.retell_agent_id;
  if (!agentId) {
    return { status: 422, body: { error: "tenant_has_no_agent" } };
  }

  const listed = await listPhoneNumbers(deps.retellFetch, deps.retellApiKey);
  // RETELL-VERIFY (CALL-1, confirmed live against docs.retellai.com/
  // api-references/list-phone-numbers 2026-09-20): the response is NOT a
  // bare array — it's `{items: [...], has_more, pagination_key}`
  // (PaginatedResponseBase), same envelope shape as list-test-runs.
  const listedBody = listed.body as { items?: unknown } | undefined;
  if (!listed.ok || !Array.isArray(listedBody?.items)) {
    deps.logger.error("attach_retell_number_list_failed", {
      status: listed.status,
      body: JSON.stringify(listed.body).slice(0, 500),
    });
    return { status: 502, body: { error: "retell_list_phone_numbers_failed" } };
  }
  const numbers = listedBody.items as RetellPhoneNumberListItem[];

  let selected: RetellPhoneNumberListItem | undefined;
  if (req.phone_e164) {
    selected = numbers.find((n) => n.phone_number === req.phone_e164);
    if (!selected) return { status: 404, body: { error: "phone_number_not_found" } };
  } else if (numbers.length === 1) {
    selected = numbers[0];
  } else if (numbers.length === 0) {
    return { status: 422, body: { error: "no_numbers_on_account" } };
  } else {
    return { status: 422, body: { error: "ambiguous_number_selection_pass_phone_e164" } };
  }
  if (!selected) return { status: 404, body: { error: "phone_number_not_found" } };
  const phoneE164 = selected.phone_number;

  const updated = await updatePhoneNumber(deps.retellFetch, deps.retellApiKey, phoneE164, {
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
    inbound_webhook_url: deps.inboundWebhookUrl,
  });
  if (!updated.ok) {
    deps.logger.error("attach_retell_number_update_failed", {
      tenant_id: req.tenant_id,
      status: updated.status,
    });
    return { status: 502, body: { error: "retell_update_phone_number_failed" } };
  }

  const twilioSidPlaceholder = `retell-native:${phoneE164}`;
  await sql`
    insert into public.phone_numbers (tenant_id, e164, twilio_sid, retell_number_id, is_primary)
    values (${req.tenant_id}, ${phoneE164}, ${twilioSidPlaceholder}, ${phoneE164}, true)
    on conflict (e164) do update set
      tenant_id = excluded.tenant_id,
      retell_number_id = excluded.retell_number_id,
      is_primary = true,
      released_at = null
  `;

  return { status: 200, body: { phone_e164: phoneE164 } };
}
