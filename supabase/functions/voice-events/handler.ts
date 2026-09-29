import { recordCallCost } from "../_shared/call-cost.ts";
import { enqueueOwnerAlert } from "../_shared/owner-alerts.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { RetellCallObject, VoiceEventRequest } from "../_shared/schemas/voice-events.ts";
import { parseCustomAnalysisData } from "../_shared/schemas/voice-events.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

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
  is_test_tenant: boolean;
}

interface AgentConfigLookupRow {
  tenant_id: string;
  owner_test_phone: string | null;
  is_test_tenant: boolean;
}

interface ResolvedCall {
  tenant_id: string;
  phone_number_id: string | null;
  owner_test_phone: string | null;
  // SELFCALL-1: true when `tenants.is_test` — a tenant created by the
  // internal test-checkout bypass (SIGNUP-1's own `tenants.is_test`
  // column), never a real paying tenant. Folded into `is_test_call` below
  // alongside `owner_test_phone` so a call INTO a test tenant is marked
  // test even when the caller's own number was never configured as that
  // tenant's `owner_test_phone`.
  is_test_tenant: boolean;
  // 'phone' = resolved via to_number -> phone_numbers (Twilio-originated
  // PSTN call); 'web_voice' = resolved via agent_id -> agent_configs (the
  // embeddable widget's voice mode — Retell web calls carry no to_number
  // at all, see _shared/providers/retell.ts's createWebCall, so this is the
  // only signal available). BACKEND_SPEC §13.2; previously an unfixed gap
  // (docs/BUILD_NOTES.md) where such calls resolved to null and were never
  // logged at all.
  channel: "phone" | "web_voice";
}

function isoFromUnixSeconds(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  return new Date(seconds).toISOString();
}

async function resolveTenantForCall(
  sql: SqlClient,
  call: RetellCallObject,
): Promise<ResolvedCall | null> {
  const toNumber = normalizeE164(call.to_number ?? null);
  if (toNumber) {
    const rows = await sql<PhoneNumberLookupRow>`
      select pn.tenant_id, pn.id as phone_number_id, t.owner_test_phone,
        t.is_test as is_test_tenant
      from public.phone_numbers pn
      join public.tenants t on t.id = pn.tenant_id
      where pn.e164 = ${toNumber}
      limit 1
    `;
    const row = rows[0];
    if (row) {
      return {
        tenant_id: row.tenant_id,
        phone_number_id: row.phone_number_id,
        owner_test_phone: row.owner_test_phone,
        is_test_tenant: row.is_test_tenant,
        channel: "phone",
      };
    }
  }

  // No usable to_number (or no phone_numbers match) — this is exactly how
  // a widget voice call arrives (browser-based Retell web call, no PSTN
  // to_number). Fall back to resolving by the Retell agent_id the call
  // actually carries: agent_id -> agent_configs.retell_agent_id -> tenant_id.
  const agentId = call.agent_id ?? null;
  if (!agentId) return null;
  const agentRows = await sql<AgentConfigLookupRow>`
    select ac.tenant_id, t.owner_test_phone, t.is_test as is_test_tenant
    from public.agent_configs ac
    join public.tenants t on t.id = ac.tenant_id
    where ac.retell_agent_id = ${agentId}
    limit 1
  `;
  const agentRow = agentRows[0];
  if (!agentRow) return null;
  return {
    tenant_id: agentRow.tenant_id,
    phone_number_id: null,
    owner_test_phone: agentRow.owner_test_phone,
    is_test_tenant: agentRow.is_test_tenant,
    channel: "web_voice",
  };
}

/**
 * SELFCALL-1: true when `callerNumber` is itself one of the PLATFORM'S OWN
 * already-provisioned numbers (e.g. `+16105383920`, `signup-1-auto`'s own
 * number, used by `api-admin-self-call` as the scripted-caller leg). A real
 * customer's phone number can only coincide with one of our own
 * Retell-purchased numbers if it genuinely IS one of our own numbers, so
 * this is a safe, generic "this is one of our own self-call loops, not a
 * real caller" signal — never weakens detection for an actual customer
 * call, which will essentially never match.
 */
async function isSelfOwnedCallerNumber(
  sql: SqlClient,
  callerNumber: string | null,
): Promise<boolean> {
  if (!callerNumber) return false;
  const rows = await sql<{ exists: boolean }>`
    select exists(
      select 1 from public.phone_numbers where e164 = ${callerNumber} and released_at is null
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}

async function resolveIsTestCall(
  sql: SqlClient,
  tenantRow: ResolvedCall,
  callerNumber: string | null,
): Promise<boolean> {
  if (callerNumber && tenantRow.owner_test_phone && callerNumber === tenantRow.owner_test_phone) {
    return true;
  }
  if (tenantRow.is_test_tenant) return true;
  return isSelfOwnedCallerNumber(sql, callerNumber);
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
  const isTestCall = await resolveIsTestCall(sql, tenantRow, callerNumber);

  // CALL-2 (docs/BUILD_NOTES.md): a placeholder row
  // (voice-tools/context.ts#resolveCallContext) may already exist for this
  // call_id if the caller's first tool call raced ahead of this webhook's
  // own commit — upsert over it with this webhook's authoritative data
  // rather than `do nothing` (which would leave the placeholder's
  // approximate data stale forever). Unconditional (not gated by a
  // `source` column — see context.ts#upsertPlaceholderCallLog's
  // "DEPLOYMENT NOTE" for why that column isn't written this session):
  // safe either way, since a retried/duplicate call_started delivery for
  // an already-webhook-populated row just re-writes the same values.
  const upserted = await sql<{ id: string; is_test_call: boolean }>`
    insert into public.call_logs (
      tenant_id, phone_number_id, retell_call_id, caller_number, direction, started_at, is_test_call, channel
    ) values (
      ${tenantRow.tenant_id}, ${tenantRow.phone_number_id}, ${call.call_id}, ${callerNumber},
      'inbound', ${isoFromUnixSeconds(call.start_timestamp) ?? new Date().toISOString()}, ${isTestCall},
      ${tenantRow.channel}
    )
    on conflict (retell_call_id) do update set
      phone_number_id = coalesce(excluded.phone_number_id, call_logs.phone_number_id),
      caller_number = coalesce(excluded.caller_number, call_logs.caller_number),
      direction = excluded.direction,
      started_at = excluded.started_at,
      is_test_call = excluded.is_test_call,
      channel = excluded.channel
    returning id, is_test_call
  `;

  // FOLLOWUP-1 (docs/BUILD_NOTES.md QA-BILL/FOLLOWUP-1): this upsert's own
  // `on conflict` branch above can be the SECOND writer for this call_id —
  // `handleCallEnded`'s own out-of-order fallback (below) may already have
  // inserted a `call_logs` row AND its matching `usage_events` row (with
  // `is_billable` derived from ITS OWN `resolveIsTestCall` snapshot) before
  // this webhook's authoritative `call_started` delivery lands and
  // unconditionally overwrites `is_test_call` here. Without this, the
  // already-written `usage_events.is_billable` never gets corrected —
  // exactly the mismatch QA-BILL found live (one row: `is_test_call=true`,
  // `usage_events.is_billable=true`). Resolving `is_test_call` here is the
  // LAST point in this file where it can change for a call, so re-sync any
  // already-existing usage_events row for it right here — a cheap,
  // indexed (`idx_usage_events_call`), conditional no-op update when no
  // such row exists yet or it's already correct.
  const row = upserted[0];
  if (row) {
    await sql`
      update public.usage_events
      set is_billable = ${!row.is_test_call}
      where call_id = ${row.id}
        and is_billable is distinct from ${!row.is_test_call}
    `;
  }
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
    const isTestCall = await resolveIsTestCall(sql, tenantRow, callerNumber);
    const inserted = await sql<{ id: string; tenant_id: string; is_test_call: boolean }>`
      insert into public.call_logs (
        tenant_id, phone_number_id, retell_call_id, caller_number, direction,
        started_at, ended_at, duration_seconds, disconnection_reason, is_test_call, channel
      ) values (
        ${tenantRow.tenant_id}, ${tenantRow.phone_number_id}, ${call.call_id}, ${callerNumber},
        'inbound', ${isoFromUnixSeconds(call.start_timestamp) ?? endedAt}, ${endedAt},
        ${durationSeconds}, ${call.disconnection_reason ?? null}, ${isTestCall}, ${tenantRow.channel}
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

  // COCKPIT-1: idempotent upsert (call_ended and call_analyzed both carry
  // `call_cost`; a redelivery or the get-call backfill can never double
  // count) + stamps call_logs.cost_cents/cost_source — including an explicit
  // 0 for provider-reported zero-cost calls (error_user_not_joined web
  // calls), which the old insert-only path left NULL ("unknown").
  // A cost-ledger failure must not also lose this call's usage row below (the
  // billing meter); `call_analyzed` re-upserts the same cost and
  // scripts/backfill-call-costs.ts can repair it, so log loudly and continue.
  try {
    await recordCallCost(sql, {
      tenantId: callRow.tenant_id,
      callId: callRow.id,
      occurredAt: endedAt,
      callCost: call.call_cost,
      source: "retell_call_ended",
    });
  } catch (err) {
    logger.error("voice_events_call_ended_cost_failed", {
      call_id: call.call_id,
      error: String(err),
    });
  }
  if (!call.call_cost) {
    logger.warn("voice_events_call_ended_without_call_cost", {
      call_id: call.call_id,
      disconnection_reason: call.disconnection_reason ?? null,
    });
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

  // ANALYSIS-1 (docs/BUILD_NOTES.md): `classification`/`outcome`/
  // `follow_up_needed`/`extracted_entities` are sourced from Retell's
  // `custom_analysis_data` — the structured-extraction output driven by
  // the compiled template's per-state `extraction[]` fields, now ACTUALLY
  // compiled into the agent's `post_call_analysis_data` at create-agent
  // time (`_shared/compiler/template-compiler.ts#buildPostCallAnalysisData`,
  // `_shared/provisioning/compile-and-publish.ts`) — previously declared in
  // `agent-template-seeds.ts` but never sent to Retell at all, which is why
  // SELFCALL-1's two real calls both came back with `custom_analysis_data:
  // {}`. `parseCustomAnalysisData` validates each field independently
  // (`_shared/schemas/voice-events.ts`): an unknown/malformed value for any
  // ONE field (e.g. a hallucinated `classification` outside the 12-value
  // enum `call_logs`'s own `CHECK` constraint would otherwise reject)
  // degrades to that field's safe default alone, never throws, and never
  // drops any other field or rejects the webhook.
  const customData = analysis?.custom_analysis_data ?? {};
  const parsed = parseCustomAnalysisData(customData);

  const rows = await sql<{
    id: string;
    tenant_id: string;
    urgency_flag: boolean;
    is_test_call?: boolean;
    caller_number?: string | null;
  }>`
    update public.call_logs
    set call_summary = coalesce(${analysis?.call_summary ?? null}, call_summary),
        sentiment = coalesce(${analysis?.user_sentiment ? (sentimentMap[analysis.user_sentiment] ?? null) : null}, sentiment),
        call_successful = coalesce(${analysis?.call_successful ?? null}, call_successful),
        classification = coalesce(${parsed.classification}, classification),
        outcome = coalesce(${parsed.outcome}, outcome),
        follow_up_needed = follow_up_needed or ${parsed.followUpNeeded},
        extracted_entities = coalesce(${customData}::jsonb, extracted_entities),
        transcript = coalesce(${call.transcript_object ?? null}::jsonb, transcript)
    where retell_call_id = ${call.call_id}
    returning id, tenant_id, urgency_flag, is_test_call, caller_number
  `;

  const row = rows[0];
  if (!row) {
    logger.warn("voice_events_call_analyzed_no_matching_call", { call_id: call.call_id });
    return;
  }

  // COCKPIT-1: call_analyzed re-carries the final `call_cost`; upserting it
  // (same idempotency key as call_ended) reconciles a missed/partial
  // call_ended and picks up late-arriving lines (e.g. transfer legs). Never
  // allowed to fail the analysis write that already happened above.
  if (call.call_cost) {
    try {
      await recordCallCost(sql, {
        tenantId: row.tenant_id,
        callId: row.id,
        occurredAt: isoFromUnixSeconds(call.end_timestamp) ?? new Date().toISOString(),
        callCost: call.call_cost,
        source: "retell_call_analyzed",
      });
    } catch (err) {
      logger.error("voice_events_call_analyzed_cost_failed", {
        call_id: call.call_id,
        error: String(err),
      });
    }
  }

  // MESSAGING-1 owner alerts (new booking / urgent call / missed transfer),
  // delivered by SMS and/or email per the tenant's /dashboard/delivery
  // preferences. Never allowed to fail this webhook's own processing.
  try {
    await enqueueCallOwnerAlerts(sql, call, row, {
      emergency: parsed.emergencyDetected || parsed.classification === "emergency",
    });
  } catch (err) {
    logger.warn("voice_events_owner_alert_failed", { call_id: call.call_id, error: String(err) });
  }

  const legalAdviceGiven = parsed.legalAdviceGiven;
  // `call_logs.urgency_flag` is derived solely from the `emergency_detected`
  // boolean, never a separate `urgency_flag` extraction field. Templates
  // that declare a vertical-specific urgency tier (legal's own
  // "standard"/"urgent" `urgency` enum) don't collide with this — the
  // compiler's post-call-analysis pass dedupes `post_call_analysis_data`
  // by field name (first declaration across `states[]` wins,
  // `buildPostCallAnalysisData`), and no shipped template ever declares an
  // `urgency_flag`-named field at all. `emergency_detected` has no
  // cross-vertical vocabulary inconsistency (same boolean semantics
  // everywhere it's declared: auto, veterinary, and the shared
  // safety-emergency state used by most other verticals — see
  // `agent-template-seeds.ts`), so it's the one authoritative signal this
  // column is set from.
  const emergencyRetroactive = parsed.emergencyDetected;

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

/** Retell `disconnection_reason` for a transfer that was attempted but
 * never connected (docs.retellai.com/api-references/get-call enum:
 * `transfer_bridged` = connected, `transfer_cancelled` = not). */
const MISSED_TRANSFER_REASON = "transfer_cancelled";

function formatLocal(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Owner alerts for one analyzed call (MESSAGING-1). Test calls never alert
 * (the nightly regression and self-calls would otherwise page the owner).
 * Each alert is idempotent per (call, kind) inside `enqueueOwnerAlert`, so
 * a redelivered `call_analyzed` never alerts twice.
 */
async function enqueueCallOwnerAlerts(
  sql: SqlClient,
  call: RetellCallObject,
  row: { id: string; tenant_id: string; is_test_call?: boolean; caller_number?: string | null },
  signals: { emergency: boolean },
): Promise<void> {
  if (row.is_test_call) return;
  const summary = call.call_analysis?.call_summary ?? null;
  const callerPhone = row.caller_number ?? normalizeE164(call.from_number ?? null);

  const bookings = await sql<{
    id: string;
    start_at: string;
    customer_name: string | null;
    service: string | null;
    timezone: string | null;
  }>`
    select b.id, b.start_at, c.name as customer_name, o.name as service, t.timezone
    from public.bookings b
    join public.tenants t on t.id = b.tenant_id
    left join public.customers c on c.id = b.customer_id
    left join public.offerings o on o.id = b.offering_id
    where b.source_call_id = ${row.id} and b.tenant_id = ${row.tenant_id} and b.status <> 'cancelled'
    order by b.created_at desc
    limit 1
  `;
  const booking = bookings[0];
  const callerName = booking?.customer_name ?? null;
  const base = {
    ...(callerName ? { caller_name: callerName } : {}),
    ...(callerPhone ? { caller_phone: callerPhone } : {}),
    ...(summary ? { summary } : {}),
  };

  if (signals.emergency) {
    await enqueueOwnerAlert(sql, {
      tenantId: row.tenant_id,
      kind: "urgent_call",
      payload: base,
      relatedCallId: row.id,
    });
  }
  if (booking) {
    await enqueueOwnerAlert(sql, {
      tenantId: row.tenant_id,
      kind: "new_booking",
      payload: {
        ...base,
        start_local: formatLocal(booking.start_at, booking.timezone),
        ...(booking.service ? { service: booking.service } : {}),
      },
      relatedCallId: row.id,
      relatedBookingId: booking.id,
    });
  }
  if (call.disconnection_reason === MISSED_TRANSFER_REASON) {
    await enqueueOwnerAlert(sql, {
      tenantId: row.tenant_id,
      kind: "missed_transfer",
      payload: base,
      relatedCallId: row.id,
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
