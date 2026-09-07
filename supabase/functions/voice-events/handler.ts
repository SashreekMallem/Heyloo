import { normalizeE164 } from "../_shared/phone.js";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.js";
import type { RetellCallObject, VoiceEventRequest } from "../_shared/schemas/voice-events.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `/voice-events` background processing (BACKEND_SPEC §7.3). Every branch is
 * an upsert/conditional-update, never assumes row existence — tolerant of
 * out-of-order delivery (`call_ended` before `call_started`) and of being
 * re-run on a duplicate background-task execution (queue redelivery),
 * exactly as BACKEND_SPEC requires. The Deno `index.ts` owns HMAC verify +
 * the `webhook_events` dedup insert + fast-ack + wiring this into
 * `EdgeRuntime.waitUntil`; this file is the pure-DB-effects part, unit
 * tested with a mocked `sql`.
 */

interface PhoneNumberLookupRow {
  tenant_id: string;
  phone_number_id: string;
  owner_test_phone: string | null;
}

function isoFromUnixSeconds(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  return new Date(seconds).toISOString();
}

async function resolveTenantForCall(
  sql: SqlClient,
  call: RetellCallObject,
): Promise<PhoneNumberLookupRow | null> {
  const toNumber = normalizeE164(call.to_number ?? null);
  if (!toNumber) return null;
  const rows = await sql<PhoneNumberLookupRow>`
    select pn.tenant_id, pn.id as phone_number_id, t.owner_test_phone
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
    where pn.e164 = ${toNumber}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function handleCallStarted(
  sql: SqlClient,
  call: RetellCallObject,
  logger: Logger,
): Promise<void> {
  const tenantRow = await resolveTenantForCall(sql, call);
  if (!tenantRow) {
    logger.warn("voice_events_call_started_unresolved_tenant", { call_id: call.call_id });
    return;
  }

  const callerNumber = normalizeE164(call.from_number ?? null);
  const isTestCall =
    !!callerNumber && !!tenantRow.owner_test_phone && callerNumber === tenantRow.owner_test_phone;

  await sql`
    insert into public.call_logs (
      tenant_id, phone_number_id, retell_call_id, caller_number, direction, started_at, is_test_call
    ) values (
      ${tenantRow.tenant_id}, ${tenantRow.phone_number_id}, ${call.call_id}, ${callerNumber},
      'inbound', ${isoFromUnixSeconds(call.start_timestamp) ?? new Date().toISOString()}, ${isTestCall}
    )
    on conflict (retell_call_id) do nothing
  `;
}

export async function handleCallEnded(
  sql: SqlClient,
  call: RetellCallObject,
  logger: Logger,
): Promise<void> {
  const endedAt = isoFromUnixSeconds(call.end_timestamp) ?? new Date().toISOString();
  const durationSeconds =
    call.start_timestamp !== undefined && call.end_timestamp !== undefined
      ? Math.max(0, Math.round((call.end_timestamp - call.start_timestamp) / 1000))
      : null;

  const updated = await sql<{ id: string; tenant_id: string; is_test_call: boolean }>`
    update public.call_logs
    set ended_at = ${endedAt},
        duration_seconds = coalesce(${durationSeconds}, duration_seconds),
        disconnection_reason = coalesce(${call.disconnection_reason ?? null}, disconnection_reason)
    where retell_call_id = ${call.call_id}
    returning id, tenant_id, is_test_call
  `;

  let callRow = updated[0];
  if (!callRow) {
    // call_ended arrived before call_started (out-of-order delivery) —
    // upsert a minimal row rather than dropping the event; call_started's
    // own upsert (when it eventually arrives) is a no-op on conflict.
    const tenantRow = await resolveTenantForCall(sql, call);
    if (!tenantRow) {
      logger.warn("voice_events_call_ended_unresolved_tenant", { call_id: call.call_id });
      return;
    }
    const callerNumber = normalizeE164(call.from_number ?? null);
    const isTestCall =
      !!callerNumber && !!tenantRow.owner_test_phone && callerNumber === tenantRow.owner_test_phone;
    const inserted = await sql<{ id: string; tenant_id: string; is_test_call: boolean }>`
      insert into public.call_logs (
        tenant_id, phone_number_id, retell_call_id, caller_number, direction,
        started_at, ended_at, duration_seconds, disconnection_reason, is_test_call
      ) values (
        ${tenantRow.tenant_id}, ${tenantRow.phone_number_id}, ${call.call_id}, ${callerNumber},
        'inbound', ${isoFromUnixSeconds(call.start_timestamp) ?? endedAt}, ${endedAt},
        ${durationSeconds}, ${call.disconnection_reason ?? null}, ${isTestCall}
      )
      on conflict (retell_call_id) do update set ended_at = excluded.ended_at
      returning id, tenant_id, is_test_call
    `;
    callRow = inserted[0];
  }
  if (!callRow) return;

  // Recording pull must happen within Retell's <10-minute availability
  // window (SYSTEM_DESIGN §2) — enqueue immediately, never inline (a fetch
  // to Retell/Storage has no place adding latency/failure surface to this
  // background task, let alone the original request).
  await enqueue(sql, QUEUE_NAMES.recordingFetch, {
    call_id: callRow.id,
    retell_call_id: call.call_id,
    attempt: 0,
  });

  const productCosts = call.call_cost?.product_costs ?? [];
  for (const cost of productCosts) {
    await sql`
      insert into public.cost_events (tenant_id, call_id, provider, product, total_cost_cents, raw, occurred_at)
      values (${callRow.tenant_id}, ${callRow.id}, 'retell', ${cost.product}, ${cost.cost}, ${JSON.stringify(cost)}::jsonb, ${endedAt})
    `;
  }

  if (durationSeconds !== null) {
    await sql`
      insert into public.usage_events (tenant_id, call_id, minutes, occurred_at, is_billable)
      values (${callRow.tenant_id}, ${callRow.id}, ${durationSeconds / 60}, ${endedAt}, ${!callRow.is_test_call})
    `;
  }
}

export async function handleCallAnalyzed(
  sql: SqlClient,
  call: RetellCallObject,
  logger: Logger,
): Promise<void> {
  const analysis = call.call_analysis;
  const sentimentMap: Record<string, string> = {
    Positive: "positive",
    Neutral: "neutral",
    Negative: "negative",
  };

  // `classification`/`outcome`/`follow_up_needed`/`extracted_entities` are
  // sourced from Retell's `custom_analysis_data` — the structured-extraction
  // output driven by the compiled template's per-state `extraction[]`
  // fields (BACKEND_SPEC §1.3 canonical template schema), assumed here to
  // include keys literally named `classification` (one of the 12-enum
  // values), `outcome`, and `follow_up_needed`; VERIFY.md: confirm this
  // mapping against the compiler's actual extraction-field naming once T2's
  // Retell compiler lands.
  const customData = analysis?.custom_analysis_data ?? {};
  const classification =
    typeof customData["classification"] === "string" ? customData["classification"] : null;
  const outcome = typeof customData["outcome"] === "string" ? customData["outcome"] : null;
  const followUpNeeded = customData["follow_up_needed"] === true;

  const rows = await sql<{ id: string; tenant_id: string; urgency_flag: boolean }>`
    update public.call_logs
    set call_summary = coalesce(${analysis?.call_summary ?? null}, call_summary),
        sentiment = coalesce(${analysis?.user_sentiment ? (sentimentMap[analysis.user_sentiment] ?? null) : null}, sentiment),
        call_successful = coalesce(${analysis?.call_successful ?? null}, call_successful),
        classification = coalesce(${classification}, classification),
        outcome = coalesce(${outcome}, outcome),
        follow_up_needed = follow_up_needed or ${followUpNeeded},
        extracted_entities = coalesce(${JSON.stringify(customData)}::jsonb, extracted_entities),
        transcript = coalesce(${call.transcript_object ? JSON.stringify(call.transcript_object) : null}::jsonb, transcript)
    where retell_call_id = ${call.call_id}
    returning id, tenant_id, urgency_flag
  `;

  const row = rows[0];
  if (!row) {
    logger.warn("voice_events_call_analyzed_no_matching_call", { call_id: call.call_id });
    return;
  }

  const legalAdviceGiven = customData["legal_advice_given"] === true;
  const emergencyRetroactive = customData["emergency_detected"] === true;

  if (legalAdviceGiven || (emergencyRetroactive && !row.urgency_flag)) {
    await sql`
      update public.call_logs
      set legal_advice_given = ${legalAdviceGiven},
          urgency_flag = urgency_flag or ${emergencyRetroactive}
      where id = ${row.id}
    `;
    logger.error("voice_events_compliance_alert", {
      call_id: call.call_id,
      tenant_id: row.tenant_id,
      legal_advice_given: legalAdviceGiven,
      emergency_retroactive: emergencyRetroactive,
    });
  }
}

export async function processVoiceEvent(
  sql: SqlClient,
  event: VoiceEventRequest,
  logger: Logger,
): Promise<void> {
  switch (event.event) {
    case "call_started":
      return handleCallStarted(sql, event.call, logger);
    case "call_ended":
      return handleCallEnded(sql, event.call, logger);
    case "call_analyzed":
      return handleCallAnalyzed(sql, event.call, logger);
  }
}
