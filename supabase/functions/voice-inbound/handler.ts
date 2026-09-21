import { buildInboundDynamicVariables } from "../_shared/inbound-dynamic-variables.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import type {
  VoiceInboundRequest,
  VoiceInboundResponse,
} from "../_shared/schemas/voice-inbound.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/voice-inbound` core logic (BACKEND_SPEC §7.1) — number -> tenant ->
 * agent resolver. Pure/DB-injected so it's unit testable without Deno; the
 * Deno `index.ts` in this directory does only signature verification + JSON
 * parsing + calling this.
 *
 * Latency budget: p95 < 300ms (tighter than the tool-call budget — this
 * gates whether Retell can start the greeting at all). Single indexed
 * lookup below (`phone_numbers.e164` -> `tenants` -> `agent_configs` ->
 * `agent_templates`), no external calls, no writes on the success path
 * (BACKEND_SPEC §7.1 "Side effects: none").
 */

interface InboundRow {
  tenant_id: string;
  business_name: string;
  vertical: string;
  timezone: string;
  business_hours: Record<string, unknown>;
  hours_exceptions: unknown[];
  manual_mode: boolean;
  language_primary: string;
  assistant_name: string | null;
  special_instructions: string | null;
  dynamic_variable_overrides: Record<string, unknown>;
  retell_agent_id: string | null;
  disclosure_line: string;
  transfer_number: string | null;
}

export type VoiceInboundResult =
  | { status: 200; body: VoiceInboundResponse }
  | { status: 404; body: { error: string } };

export async function handleVoiceInbound(params: {
  sql: SqlClient;
  request: VoiceInboundRequest;
  logger: Logger;
  now?: Date;
}): Promise<VoiceInboundResult> {
  const { sql, request, logger, now = new Date() } = params;

  const toNumber = normalizeE164(request.call_inbound.to_number);
  const fromNumber = normalizeE164(request.call_inbound.from_number);

  if (!toNumber) {
    // No call_id in this webhook (VERIFY-2, LIVE-MINE-FIXES) — log the raw
    // to_number that failed to normalize instead.
    logger.warn("voice_inbound_bad_to_number", { to: request.call_inbound.to_number });
    return { status: 404, body: { error: "number_not_found" } };
  }

  const rows = await sql<InboundRow>`
    select
      t.id as tenant_id,
      t.name as business_name,
      t.vertical,
      t.timezone,
      t.business_hours,
      t.hours_exceptions,
      t.manual_mode,
      coalesce(t.language_config->>'primary', 'en') as language_primary,
      ac.assistant_name,
      ac.special_instructions,
      ac.dynamic_variable_overrides,
      ac.retell_agent_id,
      ac.transfer_number,
      at.disclosure_line
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where pn.e164 = ${toNumber} and pn.released_at is null
    limit 1
  `;

  const row = rows[0];
  if (!row) {
    logger.warn("voice_inbound_number_not_provisioned", { to: toNumber });
    return { status: 404, body: { error: "number_not_found" } };
  }

  // CALL-9 (docs/BUILD_NOTES.md): the customer-by-phone lookup + full
  // dynamic-variable assembly now lives in one shared function this file
  // and `api-admin-run-agent-tests`'s `simulate` action both call — proving
  // one proves the other. No behavior change for a real call: this is the
  // exact same logic that used to live inline here.
  const dynamicVariables = await buildInboundDynamicVariables({
    sql,
    logger,
    now,
    fromNumber,
    config: {
      tenantId: row.tenant_id,
      businessName: row.business_name,
      vertical: row.vertical,
      timezone: row.timezone,
      businessHours: row.business_hours,
      hoursExceptions: row.hours_exceptions,
      manualMode: row.manual_mode,
      languagePrimary: row.language_primary,
      assistantName: row.assistant_name,
      specialInstructions: row.special_instructions,
      dynamicVariableOverrides: row.dynamic_variable_overrides ?? {},
      disclosureLine: row.disclosure_line,
      transferNumber: row.transfer_number,
    },
  });

  return {
    status: 200,
    body: {
      call_inbound: {
        ...(row.retell_agent_id ? { override_agent_id: row.retell_agent_id } : {}),
        dynamic_variables: dynamicVariables,
      },
    },
  };
}
