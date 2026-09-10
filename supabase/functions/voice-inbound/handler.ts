import { computeGreetingHoursContext } from "../_shared/business-hours.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import type {
  VoiceInboundRequest,
  VoiceInboundResponse,
} from "../_shared/schemas/voice-inbound.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { resolveVerticalDynamicVariables } from "./dynamic-variables.ts";

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

interface RecentCustomerRow {
  name: string | null;
  last_seen_at: string;
  lifetime_bookings: number;
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

  let callerRecentContext: string | undefined;
  if (fromNumber) {
    const recentRows = await sql<RecentCustomerRow>`
      select name, last_seen_at, lifetime_bookings
      from public.customers
      where tenant_id = ${row.tenant_id} and phone_e164 = ${fromNumber}
      limit 1
    `;
    const recent = recentRows[0];
    if (recent) {
      // G28 callback continuity — short, non-sensitive summary only.
      const label = recent.name ? recent.name.split(" ")[0] : "This caller";
      callerRecentContext =
        recent.lifetime_bookings > 0
          ? `${label} has booked with us before.`
          : `${label} has called before.`;
    }
  }

  const overrides = row.dynamic_variable_overrides ?? {};
  const greetingHoursContext = computeGreetingHoursContext(
    now,
    row.timezone,
    row.business_hours as never,
    row.hours_exceptions as never,
  );

  // GAP_REGISTER §1.3 — every per-vertical `{{token}}` the compiled prompt
  // may reference (tow partner, practice areas, rate table, menu, ...),
  // resolved with a safe default so a literal placeholder never reaches
  // the model.
  const verticalTokens = await resolveVerticalDynamicVariables({
    sql,
    tenantId: row.tenant_id,
    vertical: row.vertical,
    overrides,
    logger,
  });

  const dynamicVariables: VoiceInboundResponse["call_inbound"]["dynamic_variables"] = {
    business_name: row.business_name,
    assistant_name: row.assistant_name ?? "the AI assistant",
    greeting_hours_context: greetingHoursContext,
    timezone: row.timezone,
    special_instructions: row.special_instructions ?? "",
    is_manual_mode: row.manual_mode,
    language: row.language_primary,
    disclosure_line: row.disclosure_line,
    ...(row.transfer_number ? { transfer_number: row.transfer_number } : {}),
    ...verticalTokens,
    ...(typeof overrides["manager_name"] === "string"
      ? { manager_name: overrides["manager_name"] as string }
      : {}),
    ...(typeof overrides["manager_phone"] === "string"
      ? { manager_phone: overrides["manager_phone"] as string }
      : {}),
    ...(typeof overrides["parking_info"] === "string"
      ? { parking_info: overrides["parking_info"] as string }
      : {}),
    ...(typeof overrides["accessibility_notes"] === "string"
      ? { accessibility_notes: overrides["accessibility_notes"] as string }
      : {}),
    ...(Array.isArray(overrides["accepted_payment_types"])
      ? { accepted_payment_types: overrides["accepted_payment_types"] as string[] }
      : {}),
    ...(callerRecentContext ? { caller_recent_context: callerRecentContext } : {}),
  };

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
