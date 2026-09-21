/**
 * CALL-9 (docs/BUILD_PLAN.md): the shared pre-call lookup + dynamic-
 * variable assembly `voice-inbound/handler.ts` (Retell's real
 * `call_inbound` webhook — BACKEND_SPEC §7.1) and
 * `api-admin-run-agent-tests` (the batch-test harness) BOTH call now,
 * instead of the batch-test harness re-implementing a thinner subset of
 * the same logic. Extracted byte-for-byte from `voice-inbound/handler.ts`'s
 * pre-CALL-9 body (customer-by-phone lookup -> `caller_recent_context`,
 * hours/date context, per-vertical `{{token}}` resolution, override
 * passthrough) — no behavior change for a real call, since
 * `voice-inbound/handler.ts` now just fetches its row and calls this.
 *
 * Owner's question this closes (see docs/BUILD_NOTES.md CALL-9): "does it
 * pull data from our database before the call?" — this function IS that
 * pull, and it is now the SAME code a real Retell `call_inbound` webhook
 * runs and what `api-admin-run-agent-tests`'s new `simulate` action (and,
 * for a returning-caller scenario, its batch-test dynamic variables) both
 * exercise live — so proving it live via either path proves the other.
 *
 * Latency budget: unchanged from `voice-inbound/handler.ts`'s own p95<300ms
 * note (SYSTEM_DESIGN §5) — one extra indexed `customers` lookup (only when
 * `fromNumber` is non-null) plus `resolveVerticalDynamicVariables`'s own
 * documented one extra `offerings` read for a restaurant tenant with no
 * `menu_text` override. Never called from the voice-tools hot path
 * (`/voice/tools`) — only from `/voice-inbound` and the admin test harness,
 * neither of which shares that tighter budget.
 */

// Cross-function-folder import — same established pattern this repo already
// uses (worker-tick/handler.ts importing worker-adapter-push/handler.ts,
// job-reconciliation/handler.ts importing voice-events/handler.ts,
// api-admin-run-agent-tests/handler.ts's own pre-CALL-9 import of this exact
// module, CALL-7's own doc comment there).
import { resolveVerticalDynamicVariables } from "../voice-inbound/dynamic-variables.ts";
import {
  computeCurrentDateContext,
  computeGreetingHoursContext,
  computeUpcomingWeekdayDates,
} from "./business-hours.ts";
import type { VoiceInboundResponse } from "./schemas/voice-inbound.ts";
import type { Logger, SqlClient } from "./types.ts";

export type InboundDynamicVariables = VoiceInboundResponse["call_inbound"]["dynamic_variables"];

/** Everything `voice-inbound/handler.ts`'s own DB row (or an equivalent
 * synthetic one built by the admin test harness / `simulate` action)
 * carries — deliberately the same field set as that file's `InboundRow`,
 * so both callers can build this from their own query without translation. */
export interface InboundTenantConfig {
  tenantId: string;
  businessName: string;
  vertical: string;
  timezone: string;
  businessHours: Record<string, unknown>;
  hoursExceptions: unknown[];
  manualMode: boolean;
  languagePrimary: string;
  assistantName: string | null;
  specialInstructions: string | null;
  dynamicVariableOverrides: Record<string, unknown>;
  disclosureLine: string;
  transferNumber: string | null;
}

interface RecentCustomerRow {
  name: string | null;
  last_seen_at: string;
  lifetime_bookings: number;
}

/**
 * G28 callback continuity — looks up `customers` by `tenant_id` +
 * `phone_e164` (indexed, single-row) and returns a short, non-sensitive
 * summary line, never raw PII beyond the caller's own first name (which
 * they already know is theirs). `fromNumber` must already be normalized
 * E.164 (or `null` — no caller number to look up, the common case for a
 * placeholder/batch-test call with no `heyloo_test_caller_number` set).
 *
 * CALL-9: ALWAYS returns a real sentence, never `undefined`/empty — this is
 * now wired into the compiled prompt as a live `{{caller_recent_context}}`
 * placeholder (`_shared/compiler/template-compiler.ts`), and Retell only
 * ever does literal `{{name}}` substitution (RETELL-VERIFIED,
 * docs.retellai.com/build/dynamic-variables 2026-09-21, docs/VERIFY.md
 * CALL-9): a missing/optional dynamic variable would leave a literal
 * unresolved `{{caller_recent_context}}` string in the model's own prompt
 * — the exact GAP_REGISTER §1.3 anti-pattern every other resolver in this
 * file already avoids. Before this task, `caller_recent_context` was set on
 * every response but never referenced by `{{}}` anywhere in the compiled
 * prompt, so it was completely inert for a real returning caller too —
 * fixed at the root (both ends) by this task, documented in
 * docs/BUILD_NOTES.md CALL-9.
 */
async function resolveCallerRecentContext(
  sql: SqlClient,
  tenantId: string,
  fromNumber: string | null,
): Promise<string> {
  if (!fromNumber) {
    return "No caller ID is available for this call — treat this as a first-time caller and collect their name and phone number normally.";
  }
  const rows = await sql<RecentCustomerRow>`
    select name, last_seen_at, lifetime_bookings
    from public.customers
    where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    limit 1
  `;
  const recent = rows[0];
  if (!recent) {
    return "This is a new caller — no prior history is on file; collect their name and phone number normally.";
  }
  const label = recent.name ? recent.name.split(" ")[0] : "This caller";
  return recent.lifetime_bookings > 0
    ? `${label} has booked with us before.`
    : `${label} has called before.`;
}

export async function buildInboundDynamicVariables(params: {
  sql: SqlClient;
  logger: Logger;
  now: Date;
  /** Already-normalized E.164, or `null` — the caller passes `null` when
   * there is no live caller number to look up (an FAQ-only batch-test
   * scenario, a call with no caller id). Never derived from `args`. */
  fromNumber: string | null;
  config: InboundTenantConfig;
}): Promise<InboundDynamicVariables> {
  const { sql, logger, now, fromNumber, config } = params;

  const callerRecentContext = await resolveCallerRecentContext(sql, config.tenantId, fromNumber);

  const overrides = config.dynamicVariableOverrides ?? {};
  const greetingHoursContext = computeGreetingHoursContext(
    now,
    config.timezone,
    config.businessHours as never,
    config.hoursExceptions as never,
  );
  const currentDateContext = computeCurrentDateContext(now, config.timezone);
  const upcomingWeekdayDates = computeUpcomingWeekdayDates(now, config.timezone);

  const verticalTokens = await resolveVerticalDynamicVariables({
    sql,
    tenantId: config.tenantId,
    vertical: config.vertical,
    overrides,
    logger,
  });

  const dynamicVariables: InboundDynamicVariables = {
    business_name: config.businessName,
    assistant_name: config.assistantName ?? "the AI assistant",
    greeting_hours_context: greetingHoursContext,
    timezone: config.timezone,
    current_date: currentDateContext.date,
    current_weekday: currentDateContext.weekday,
    upcoming_weekday_dates: upcomingWeekdayDates,
    special_instructions: config.specialInstructions ?? "",
    is_manual_mode: config.manualMode,
    language: config.languagePrimary,
    disclosure_line: config.disclosureLine,
    // PUBLISH-1 (docs/BUILD_NOTES.md): ALWAYS sent now, even as an empty
    // string when `agent_configs.transfer_number` is unset — never
    // omitted. Every compiled flow now literally embeds `{{transfer_number}}`
    // (`_shared/compiler/template-compiler.ts`'s transfer-only router
    // instruction/edge AND its `TransferCallNode.transfer_destination.
    // number`), so the model needs a real, consistently-typed (always a
    // string, possibly empty) substitution to reason about — omitting the
    // key would leave a literal unresolved `{{transfer_number}}` token
    // instead (the exact anti-pattern `resolveCallerRecentContext`'s own
    // doc comment above already documents and avoids for
    // `caller_recent_context`).
    transfer_number: config.transferNumber ?? "",
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
    caller_recent_context: callerRecentContext,
  };

  return dynamicVariables;
}
