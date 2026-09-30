import { normalizeE164 } from "../_shared/phone.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createPhoneCall,
  createRetellLLM,
  getAgent,
  getCall,
  publishAgentVersion,
} from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/forwarding-verify` (BACKEND_SPEC §7.10, LAUNCH-forwarding): proves the
 * business's existing line forwards to its Heyloo number by calling it.
 *
 * `start` places ONE real call from the platform's test line to
 * `tenants.business_phone` with a tiny scripted caller agent (says one
 * disclosure + goodbye line, then hangs up). The owner does not answer; the
 * carrier forwards the unanswered call to the Heyloo number, where the
 * tenant's own agent picks up. `status` is then polled: the test passes
 * when a call from the test line (forwarded calls keep the original caller
 * ID) or from the business phone itself (carriers that rewrite it) lands on
 * the tenant's Heyloo number after the test started. A failure is explained
 * from the outbound leg's Retell `disconnection_reason`.
 *
 * Replaces the earlier "the owner places the call" build, which only
 * watched for ANY inbound call and never dialed anything — the wizard said
 * "We'll place a test call" and owners waited for a call that never came.
 *
 * The forwarded call is automatically `is_test_call` (voice-events marks
 * calls from any platform-owned number), so it is never billed or alerted.
 */

export const FORWARDING_TEST_AGENT_SETTINGS_KEY = "forwarding_test_caller_agent";
const FORWARDING_TEST_AGENT_NAME = "Heyloo Forwarding Test Caller";
const FORWARDING_TEST_VOICE_ID = "retell-Cimo";
const FORWARDING_TEST_MODEL = "gpt-4.1-mini";
/** Retell's minimum `max_call_duration_ms` (create-phone-call, 60_000..7_200_000). */
const FORWARDING_TEST_MAX_CALL_MS = 60_000;
/** How long a test may run: carrier ring-out before forwarding (~20-30 s) plus the AI's pickup. */
export const FORWARDING_TEST_WINDOW_MS = 90_000;
/** A test that ended without a forwarded call still gets this long for the call_logs row to land. */
const LOG_GRACE_MS = 10_000;
const DISCLOSURE_LINE = "Hi, this is an AI test call from Heyloo, and this call may be recorded.";

const FORWARDING_TEST_PROMPT =
  "You are Heyloo's automated call-forwarding test line. You are calling the business phone of " +
  "{{business_name}} to check that unanswered calls forward to its AI receptionist. As soon as " +
  'anyone or anything speaks, say exactly: "{{disclosure_line}} This is an automated test of call ' +
  'forwarding for {{business_name}}. Everything is working. Goodbye." Then immediately use the ' +
  "end_call tool. Never answer questions, never say anything else, never stay on the line.";

export interface ForwardingVerifyDeps {
  now: () => Date;
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** The platform's own Retell number the test calls come from. */
  testFromNumber: string;
  logger: Logger;
}

export type FailureReason =
  | "answered"
  | "no_answer"
  | "busy"
  | "invalid_number"
  | "not_forwarded"
  | "unknown";

export type ForwardingVerifyResult =
  | { status: 200; body: { started: true; calling: string; expires_at: string } }
  | { status: 200; body: { state: "pending" } }
  | { status: 200; body: { state: "verified" } }
  | { status: 200; body: { state: "failed"; reason: FailureReason } }
  | { status: 404; body: { error: "tenant_number_not_found" | "no_test_running" } }
  | { status: 422; body: { error: "business_phone_missing" | "business_phone_not_allowed" } }
  | { status: 429; body: { error: "test_in_progress"; retry_after_s: number } }
  | { status: 502; body: { error: "call_failed" } };

interface TestRow {
  number_id: string;
  heyloo_e164: string;
  business_phone: string | null;
  business_name: string;
  forwarding_test_started_at: string | null;
  forwarding_test_call_id: string | null;
  forwarding_verified_at: string | null;
}

async function loadTestRow(sql: SqlClient, tenantId: string): Promise<TestRow | null> {
  const rows = await sql<TestRow>`
    select pn.id as number_id, pn.e164 as heyloo_e164, t.business_phone, t.name as business_name,
           pn.forwarding_test_started_at, pn.forwarding_test_call_id, pn.forwarding_verified_at
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
    where pn.tenant_id = ${tenantId} and pn.released_at is null
    order by pn.is_primary desc, pn.created_at asc
    limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Only an ordinary US/Canada (NANP) number may be dialed: a tenant-supplied
 * destination on a platform-paid call must never reach a premium-rate line.
 * Blocks 900 numbers, NXX-976 exchanges, N11 service codes and anything
 * outside +1.
 */
export function isDialableBusinessPhone(e164: string): boolean {
  const match = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164);
  if (!match) return false;
  const [, area, exchange] = match as unknown as [string, string, string];
  if (area === "900" || exchange === "976") return false;
  if (/^[2-9]11$/.test(area) || /^[2-9]11$/.test(exchange)) return false;
  return true;
}

/** The outbound leg's end reason -> why the forwarded call never arrived. */
export function failureReasonFor(disconnectionReason: string | undefined): FailureReason {
  switch (disconnectionReason) {
    case "dial_no_answer":
      return "no_answer";
    case "dial_busy":
    case "user_declined":
      return "busy";
    case "dial_failed":
    case "invalid_destination":
    case "telephony_provider_permission_denied":
      return "invalid_number";
    // The call connected, but not to Heyloo: the owner, their voicemail or
    // an IVR picked up before forwarding.
    case "voicemail_reached":
    case "ivr_reached":
    case "user_hangup":
    case "agent_hangup":
    case "max_duration_reached":
    case "inactivity":
      return "answered";
    case undefined:
      return "unknown";
    default:
      return "not_forwarded";
  }
}

async function ensureTestCallerAgent(
  sql: SqlClient,
  deps: ForwardingVerifyDeps,
): Promise<string | null> {
  const cached = await sql<{ value: { agent_id?: string } }>`
    select value from public.platform_settings where key = ${FORWARDING_TEST_AGENT_SETTINGS_KEY}
  `;
  const cachedId = cached[0]?.value?.agent_id;
  if (cachedId) {
    const check = await getAgent(deps.retellFetch, deps.retellApiKey, cachedId);
    if (check.ok) return cachedId;
    deps.logger.warn("forwarding_test_cached_agent_gone", {
      agentId: cachedId,
      status: check.status,
    });
  }

  // docs.retellai.com/api-references/create-retell-llm (fetched 2026-09-30):
  // `start_speaker` "user" | "agent"; an `end_call` general tool needs only
  // `type` and `name`.
  const llm = await createRetellLLM(deps.retellFetch, deps.retellApiKey, {
    general_prompt: FORWARDING_TEST_PROMPT,
    model: FORWARDING_TEST_MODEL,
    start_speaker: "user",
    general_tools: [
      {
        type: "end_call",
        name: "end_call",
        description: "End the call right after the goodbye line.",
      },
    ],
    default_dynamic_variables: { business_name: "your business", disclosure_line: DISCLOSURE_LINE },
  });
  const llmId = (llm.body as { llm_id?: string }).llm_id;
  if (!llm.ok || !llmId) {
    deps.logger.error("forwarding_test_create_llm_failed", { status: llm.status });
    return null;
  }
  const agent = await createAgent(deps.retellFetch, deps.retellApiKey, {
    agent_name: FORWARDING_TEST_AGENT_NAME,
    voice_id: FORWARDING_TEST_VOICE_ID,
    response_engine: { type: "retell-llm", llm_id: llmId },
  });
  const agentId = (agent.body as { agent_id?: string }).agent_id;
  if (!agent.ok || !agentId) {
    deps.logger.error("forwarding_test_create_agent_failed", { status: agent.status });
    return null;
  }
  const fetched = await getAgent(deps.retellFetch, deps.retellApiKey, agentId);
  const version = (fetched.body as { version?: number }).version;
  if (!fetched.ok || version === undefined) return null;
  const published = await publishAgentVersion(
    deps.retellFetch,
    deps.retellApiKey,
    agentId,
    version,
  );
  if (!published.ok) {
    deps.logger.error("forwarding_test_publish_agent_failed", {
      agentId,
      status: published.status,
    });
    return null;
  }
  await sql`
    insert into public.platform_settings (key, value)
    values (${FORWARDING_TEST_AGENT_SETTINGS_KEY}, ${{ agent_id: agentId, llm_id: llmId }}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  return agentId;
}

export async function startForwardingTest(
  sql: SqlClient,
  params: { tenantId: string },
  deps: ForwardingVerifyDeps,
): Promise<ForwardingVerifyResult> {
  const row = await loadTestRow(sql, params.tenantId);
  if (!row) return { status: 404, body: { error: "tenant_number_not_found" } };

  const businessPhone = normalizeE164(row.business_phone);
  if (!businessPhone) return { status: 422, body: { error: "business_phone_missing" } };
  if (
    !isDialableBusinessPhone(businessPhone) ||
    businessPhone === normalizeE164(row.heyloo_e164) ||
    businessPhone === deps.testFromNumber
  ) {
    return { status: 422, body: { error: "business_phone_not_allowed" } };
  }

  const now = deps.now();
  if (row.forwarding_test_started_at) {
    const elapsed = now.getTime() - new Date(row.forwarding_test_started_at).getTime();
    if (elapsed < FORWARDING_TEST_WINDOW_MS) {
      return {
        status: 429,
        body: {
          error: "test_in_progress",
          retry_after_s: Math.ceil((FORWARDING_TEST_WINDOW_MS - elapsed) / 1000),
        },
      };
    }
  }

  const agentId = await ensureTestCallerAgent(sql, deps);
  if (!agentId) return { status: 502, body: { error: "call_failed" } };

  // Claim the test window BEFORE dialing, so two quick clicks cannot both call.
  const claimed = await sql<{ id: string }>`
    update public.phone_numbers
    set forwarding_test_started_at = ${now.toISOString()}::timestamptz, forwarding_test_call_id = null
    where id = ${row.number_id}
      and (forwarding_test_started_at is null
           or forwarding_test_started_at < ${new Date(now.getTime() - FORWARDING_TEST_WINDOW_MS).toISOString()}::timestamptz)
    returning id
  `;
  if (!claimed[0]) return { status: 429, body: { error: "test_in_progress", retry_after_s: 90 } };

  const placed = await createPhoneCall(deps.retellFetch, deps.retellApiKey, {
    from_number: deps.testFromNumber,
    to_number: businessPhone,
    override_agent_id: agentId,
    retell_llm_dynamic_variables: {
      business_name: row.business_name,
      disclosure_line: DISCLOSURE_LINE,
    },
    agent_override: { agent: { max_call_duration_ms: FORWARDING_TEST_MAX_CALL_MS } },
    metadata: { source: "forwarding-verify", tenant_id: params.tenantId },
  });
  const callId = (placed.body as { call_id?: string }).call_id;
  if (!placed.ok || !callId) {
    deps.logger.error("forwarding_test_create_call_failed", {
      tenant_id: params.tenantId,
      status: placed.status,
      body: JSON.stringify(placed.body).slice(0, 500),
    });
    // Release the window so the owner can retry straight away.
    await sql`update public.phone_numbers set forwarding_test_started_at = null where id = ${row.number_id}`;
    return { status: 502, body: { error: "call_failed" } };
  }
  await sql`update public.phone_numbers set forwarding_test_call_id = ${callId} where id = ${row.number_id}`;

  return {
    status: 200,
    body: {
      started: true,
      calling: businessPhone,
      expires_at: new Date(now.getTime() + FORWARDING_TEST_WINDOW_MS).toISOString(),
    },
  };
}

export async function forwardingTestStatus(
  sql: SqlClient,
  params: { tenantId: string; carrierHint?: string },
  deps: ForwardingVerifyDeps,
): Promise<ForwardingVerifyResult> {
  const row = await loadTestRow(sql, params.tenantId);
  if (!row) return { status: 404, body: { error: "tenant_number_not_found" } };
  if (!row.forwarding_test_started_at) return { status: 404, body: { error: "no_test_running" } };

  const startedAt = new Date(row.forwarding_test_started_at);
  const callers = [deps.testFromNumber, normalizeE164(row.business_phone)].filter(
    (n): n is string => Boolean(n),
  );
  const arrived = await sql<{ id: string }>`
    select id from public.call_logs
    where phone_number_id = ${row.number_id}
      and started_at >= ${startedAt.toISOString()}::timestamptz
      and caller_number = any(${callers}::text[])
    order by started_at asc limit 1
  `;
  if (arrived[0]) {
    await sql`
      update public.phone_numbers
      set forwarding_verified_at = now(), forwarding_carrier = ${params.carrierHint ?? "unknown"}
      where id = ${row.number_id}
    `;
    return { status: 200, body: { state: "verified" } };
  }

  const elapsed = deps.now().getTime() - startedAt.getTime();
  if (row.forwarding_test_call_id) {
    const call = await getCall(deps.retellFetch, deps.retellApiKey, row.forwarding_test_call_id);
    const body = call.body as {
      call_status?: string;
      disconnection_reason?: string;
      end_timestamp?: number;
    };
    const ended =
      call.ok &&
      (body.call_status === "ended" ||
        body.call_status === "not_connected" ||
        body.call_status === "error");
    const endedAt = body.end_timestamp ?? startedAt.getTime();
    if (ended && deps.now().getTime() - endedAt > LOG_GRACE_MS) {
      return {
        status: 200,
        body: { state: "failed", reason: failureReasonFor(body.disconnection_reason) },
      };
    }
  }
  if (elapsed > FORWARDING_TEST_WINDOW_MS) {
    return { status: 200, body: { state: "failed", reason: "unknown" } };
  }
  return { status: 200, body: { state: "pending" } };
}
