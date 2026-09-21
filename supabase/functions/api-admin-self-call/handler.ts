import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createPhoneCall,
  createRetellLLM,
  deleteAgent,
  getAgent,
  getCall,
  publishAgentVersion,
  updatePhoneNumber,
} from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-admin-self-call` (SELFCALL-1, docs/BUILD_NOTES.md): the last
 * automated gap CALL-9 left open — a REAL phone call over the PSTN, driven
 * end to end by Retell itself, from one of our own numbers to the other,
 * with no human. Internal-only (`x-internal-secret`, `index.ts`), same
 * posture as every other `api-admin-*` function.
 *
 * Hardcoded on purpose, never request parameters (SELFCALL-1's own explicit
 * safety instruction — "never call any number other than +12602354330"):
 * this function can only ever dial FROM the platform's own already-
 * provisioned `signup-1-auto` number TO the platform's own already-
 * provisioned `test-riverside-auto` number. A request body cannot widen
 * that — `validateRequest` only ever reads `action`/`resume` fields.
 *
 * The CALLEE side (`+12602354330`) is answered by `test-riverside-auto`'s
 * real, already-published production agent over the real `/voice-inbound`
 * -> `/voice-tools` -> `/voice-events` path — nothing about that path is
 * mocked or simulated by this function. This function only drives the
 * CALLER leg: a small scripted "customer" agent (single-prompt Retell LLM)
 * that books an oil change, created once and reused (idempotent by name,
 * id cached in `platform_settings`), bound to the caller number's
 * `outbound_agents`, then placed via `POST /v2/create-phone-call`
 * (RETELL-VERIFIED live against docs.retellai.com/api-references/
 * create-phone-call and .../update-phone-number 2026-09-21 — exact fields
 * confirmed: `from_number`/`to_number`/`override_agent_id`/
 * `retell_llm_dynamic_variables` on create-phone-call, weighted
 * `{agent_id, weight}` array `outbound_agents` on update-phone-number; see
 * `_shared/providers/retell.ts`, both already implemented and unchanged by
 * this task).
 *
 * Polling follows the SAME "bounded, resumable" shape
 * `api-admin-run-agent-tests/handler.ts#pollBatch` already established for
 * exactly the same reason (one Edge Function invocation has a bounded
 * wall-clock budget, and a real scripted phone conversation can easily run
 * longer than that): `action: "run"` creates everything and polls
 * `GET /v2/get-call/{id}` for up to `pollBudgetMs`; if the call hasn't
 * ended by then, the response carries `settled: false` + `resume.
 * caller_call_id` for a follow-up `action: "status"` call to keep polling
 * without repeating agent-creation/call-placement.
 */

export const SELF_CALL_CALLER_NUMBER = "+16105383920"; // signup-1-auto's own number
export const SELF_CALL_CALLEE_NUMBER = "+12602354330"; // test-riverside-auto's own number

const CALLER_AGENT_NAME = "Heyloo Self-Call Test Caller";
const CALLER_VOICE_ID = "retell-Cimo"; // same known-good voice test-riverside-auto's own template already uses live
const CALLER_MODEL = "gpt-4.1-mini";
const CALLER_NAME = "Devon Ashworth";
const CALLER_VEHICLE = "2019 Honda Civic";
const CALLER_DISCLOSURE_LINE =
  "This is an internal automated test call placed by the Heyloo platform to verify its " +
  "own voice AI system end-to-end. The party you are speaking with is an AI voice agent " +
  "playing the role of a customer, and this call is recorded.";

const PLATFORM_SETTINGS_KEY = "self_call_caller_agent";

function formatPhoneForSpeech(e164: string): string {
  const digits = e164.replace(/^\+1/, "");
  if (digits.length !== 10) return e164;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Referenced via `{{}}` in the caller LLM's own `general_prompt` below —
 * substituted from `retell_llm_dynamic_variables` on the `create-phone-call`
 * request, the same mechanism CALL-9's own `CALLER_RECENT_CONTEXT_INSTRUCTION`
 * fix confirmed live (docs.retellai.com/build/dynamic-variables: ONLY
 * literal `{{name}}` substitution, no automatic context injection).
 * `start_speaker: "user"` on the LLM (see `ensureCallerAgent` below) means
 * this agent waits for the OTHER party (the real business) to speak first —
 * i.e. it waits to hear the business's own compiled-in AI + recording
 * disclosure greeting before saying anything, exactly the real phone-call
 * behavior this task exists to prove.
 */
const CALLER_GENERAL_PROMPT =
  "You are {{caller_name}}, a customer calling {{business_name}} to book a routine oil " +
  "change for your {{vehicle}}. Wait silently for the business to answer and greet you " +
  "first -- never speak first. Once greeted, explain that you'd like to book an oil " +
  "change for your {{vehicle}}. When asked for your name, a callback phone number, or " +
  "vehicle details, give exactly: name {{caller_name}}, callback phone {{caller_phone}}, " +
  "vehicle {{vehicle}}. If offered an appointment time, accept the first time offered and " +
  "clearly confirm the booking back to the business. Once the appointment is confirmed, " +
  "thank the business, say a brief natural goodbye, and let the call end. Stay in " +
  "character as a real customer the entire call -- never say you are an AI, a bot, a " +
  "script, or a test, even if asked directly; if pressed, just say you'd like to get the " +
  "appointment booked. ({{disclosure_line}})";

export interface SelfCallDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SelfCallRequest {
  action: "run" | "status";
  caller_call_id?: string;
  force_recreate_caller_agent?: boolean;
}

export function validateRequest(
  body: unknown,
): { ok: true; data: SelfCallRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const action = b["action"] ?? "run";
  if (action !== "run" && action !== "status") return { ok: false, error: "invalid_action" };
  if (action === "status") {
    const callerCallId = b["caller_call_id"];
    if (typeof callerCallId !== "string" || callerCallId.length === 0) {
      return { ok: false, error: "missing_caller_call_id" };
    }
    return { ok: true, data: { action, caller_call_id: callerCallId } };
  }
  const forceRecreate = b["force_recreate_caller_agent"];
  if (forceRecreate !== undefined && typeof forceRecreate !== "boolean") {
    return { ok: false, error: "invalid_force_recreate_caller_agent" };
  }
  return {
    ok: true,
    data: { action, ...(forceRecreate ? { force_recreate_caller_agent: true } : {}) },
  };
}

interface EnsureAgentOutcome {
  ok: true;
  agentId: string;
}
interface EnsureAgentFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Idempotent by name (docs/BUILD_PLAN.md self-call deliverable 2): the
 * created agent's id is cached in `platform_settings` (`key =
 * "self_call_caller_agent"`) so a repeat run reuses the SAME Retell agent
 * rather than accumulating orphans (CALL-7's own established "don't
 * accumulate Retell agents" rule, `deleteAgent` already exists for exactly
 * this). `force_recreate_caller_agent` deletes the OLD agent — but ONLY the
 * one this function's own prior run created (the id it has on file in
 * `platform_settings`, never a guess) — before creating its replacement.
 */
export async function ensureCallerAgent(
  sql: SqlClient,
  deps: SelfCallDeps,
  businessName: string,
  forceRecreate: boolean,
): Promise<EnsureAgentOutcome | EnsureAgentFailure> {
  const existing = await sql<{ value: { agent_id?: string; llm_id?: string } }>`
    select value from public.platform_settings where key = ${PLATFORM_SETTINGS_KEY}
  `;
  const existingAgentId = existing[0]?.value?.agent_id;

  if (existingAgentId && !forceRecreate) {
    const check = await getAgent(deps.retellFetch, deps.retellApiKey, existingAgentId);
    if (check.ok) {
      return { ok: true, agentId: existingAgentId };
    }
    deps.logger.warn("self_call_cached_agent_gone_recreating", {
      agentId: existingAgentId,
      status: check.status,
    });
  } else if (existingAgentId && forceRecreate) {
    const deleted = await deleteAgent(deps.retellFetch, deps.retellApiKey, existingAgentId);
    if (!deleted.ok) {
      deps.logger.warn("self_call_delete_old_caller_agent_failed", {
        agentId: existingAgentId,
        status: deleted.status,
      });
    }
  }

  const llmResult = await createRetellLLM(deps.retellFetch, deps.retellApiKey, {
    general_prompt: CALLER_GENERAL_PROMPT,
    model: CALLER_MODEL,
    start_speaker: "user",
    default_dynamic_variables: {
      caller_name: CALLER_NAME,
      caller_phone: formatPhoneForSpeech(SELF_CALL_CALLER_NUMBER),
      vehicle: CALLER_VEHICLE,
      business_name: businessName,
      disclosure_line: CALLER_DISCLOSURE_LINE,
    },
  });
  const llmBody = llmResult.body as { llm_id?: string };
  if (!llmResult.ok || !llmBody.llm_id) {
    deps.logger.error("self_call_create_llm_failed", {
      status: llmResult.status,
      body: JSON.stringify(llmResult.body).slice(0, 1000),
    });
    return { ok: false, status: 502, error: "retell_create_llm_failed" };
  }

  const agentResult = await createAgent(deps.retellFetch, deps.retellApiKey, {
    agent_name: CALLER_AGENT_NAME,
    voice_id: CALLER_VOICE_ID,
    response_engine: { type: "retell-llm", llm_id: llmBody.llm_id },
  });
  const agentBody = agentResult.body as { agent_id?: string; version?: number };
  if (!agentResult.ok || !agentBody.agent_id) {
    deps.logger.error("self_call_create_agent_failed", {
      status: agentResult.status,
      body: JSON.stringify(agentResult.body).slice(0, 1000),
    });
    return { ok: false, status: 502, error: "retell_create_agent_failed" };
  }
  const agentId = agentBody.agent_id;

  const forPublish = await getAgent(deps.retellFetch, deps.retellApiKey, agentId);
  const forPublishBody = forPublish.body as { version?: number };
  if (!forPublish.ok || forPublishBody.version === undefined) {
    deps.logger.error("self_call_get_agent_for_publish_failed", {
      agentId,
      status: forPublish.status,
    });
    return { ok: false, status: 502, error: "retell_get_agent_failed" };
  }
  const published = await publishAgentVersion(
    deps.retellFetch,
    deps.retellApiKey,
    agentId,
    forPublishBody.version,
  );
  if (!published.ok) {
    deps.logger.error("self_call_publish_agent_failed", { agentId, status: published.status });
    return { ok: false, status: 502, error: "retell_publish_agent_failed" };
  }

  await sql`
    insert into public.platform_settings (key, value)
    values (${PLATFORM_SETTINGS_KEY}, ${{ agent_id: agentId, llm_id: llmBody.llm_id, created_at: (deps.now ?? (() => new Date()))().toISOString() }}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;

  return { ok: true, agentId };
}

interface CalleeTenant {
  tenant_id: string;
  business_name: string;
}

async function resolveCalleeTenant(sql: SqlClient): Promise<CalleeTenant | null> {
  const rows = await sql<CalleeTenant>`
    select t.id as tenant_id, t.name as business_name
    from public.phone_numbers pn
    join public.tenants t on t.id = pn.tenant_id
    where pn.e164 = ${SELF_CALL_CALLEE_NUMBER} and pn.released_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export interface CalleeEvidence {
  found: boolean;
  call_log_id: string | null;
  retell_call_id: string | null;
  is_test_call: boolean | null;
  classification: string | null;
  call_summary: string | null;
  recording_url: string | null;
  transcript_present: boolean;
  booking_id: string | null;
  customer_id: string | null;
}

/**
 * Best-effort read of the RECEIVING side's own rows (docs/BUILD_PLAN.md
 * self-call deliverable 3) — `voice-events` writes these asynchronously off
 * the real `/voice-inbound` -> `/voice-tools` -> webhook path this function
 * never touches directly, so `found: false` (or a still-null
 * `recording_url`, filled in later by `worker-recording-fetch`) is an
 * expected, honest state right after the call ends, not a bug in this
 * function. Matched by `(tenant_id, caller_number)` + most-recent
 * `started_at` — the same "unique-enough within this scoped test" matching
 * strategy `api-admin-run-agent-tests/handler.ts#fetchScenarioIntakeArgs`
 * already established, since `SELF_CALL_CALLER_NUMBER` is never used by any
 * real customer.
 */
async function fetchCalleeEvidence(sql: SqlClient, tenantId: string): Promise<CalleeEvidence> {
  const rows = await sql<{
    id: string;
    retell_call_id: string;
    is_test_call: boolean;
    classification: string | null;
    call_summary: string | null;
    recording_url: string | null;
    transcript: unknown;
  }>`
    select id, retell_call_id, is_test_call, classification, call_summary, recording_url, transcript
    from public.call_logs
    where tenant_id = ${tenantId} and caller_number = ${SELF_CALL_CALLER_NUMBER}
    order by started_at desc nulls last, created_at desc
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    return {
      found: false,
      call_log_id: null,
      retell_call_id: null,
      is_test_call: null,
      classification: null,
      call_summary: null,
      recording_url: null,
      transcript_present: false,
      booking_id: null,
      customer_id: null,
    };
  }

  const bookingRows = await sql<{ id: string; customer_id: string }>`
    select b.id, b.customer_id
    from public.bookings b
    join public.customers c on c.id = b.customer_id
    where b.tenant_id = ${tenantId} and c.phone_e164 = ${SELF_CALL_CALLER_NUMBER}
    order by b.created_at desc
    limit 1
  `;

  return {
    found: true,
    call_log_id: row.id,
    retell_call_id: row.retell_call_id,
    is_test_call: row.is_test_call,
    classification: row.classification,
    call_summary: row.call_summary,
    recording_url: row.recording_url,
    transcript_present: row.transcript != null,
    booking_id: bookingRows[0]?.id ?? null,
    customer_id: bookingRows[0]?.customer_id ?? null,
  };
}

export interface CallerLegResult {
  status: string | null;
  disconnection_reason: string | null;
  duration_ms: number | null;
  transcript: string | null;
  recording_url: string | null;
}

async function pollCallerLeg(
  deps: SelfCallDeps,
  callerCallId: string,
): Promise<{ settled: boolean; leg: CallerLegResult }> {
  const pollIntervalMs = deps.pollIntervalMs ?? 3000;
  const pollBudgetMs = deps.pollBudgetMs ?? 45_000;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + pollBudgetMs;

  let last: CallerLegResult = {
    status: null,
    disconnection_reason: null,
    duration_ms: null,
    transcript: null,
    recording_url: null,
  };

  while (true) {
    const got = await getCall(deps.retellFetch, deps.retellApiKey, callerCallId);
    if (got.ok) {
      const b = got.body as {
        call_status?: string;
        disconnection_reason?: string | null;
        duration_ms?: number | null;
        transcript?: string | null;
        recording_url?: string | null;
        start_timestamp?: number;
        end_timestamp?: number;
      };
      last = {
        status: b.call_status ?? null,
        disconnection_reason: b.disconnection_reason ?? null,
        duration_ms:
          b.duration_ms ??
          (b.start_timestamp !== undefined && b.end_timestamp !== undefined
            ? b.end_timestamp - b.start_timestamp
            : null),
        transcript: b.transcript ?? null,
        recording_url: b.recording_url ?? null,
      };
      if (b.call_status === "ended" || b.call_status === "error") {
        return { settled: true, leg: last };
      }
    } else {
      deps.logger.error("self_call_get_call_failed", { callerCallId, status: got.status });
    }
    if (Date.now() > deadline) return { settled: false, leg: last };
    await sleep(pollIntervalMs);
  }
}

export interface SelfCallSuccessBody {
  settled: boolean;
  caller_call_id: string;
  caller_agent_id: string;
  caller_leg: CallerLegResult;
  callee: CalleeEvidence | null;
  resume?: { caller_call_id: string };
}

export type SelfCallResult =
  | { status: 200 | 202; body: SelfCallSuccessBody }
  | { status: number; body: { error: string; retell_status?: number; retell_body?: unknown } };

async function pollAndAssemble(
  sql: SqlClient,
  deps: SelfCallDeps,
  callerCallId: string,
  callerAgentId: string,
  calleeTenantId: string | null,
): Promise<SelfCallResult> {
  const { settled, leg } = await pollCallerLeg(deps, callerCallId);
  const callee = settled && calleeTenantId ? await fetchCalleeEvidence(sql, calleeTenantId) : null;

  return {
    status: settled ? 200 : 202,
    body: {
      settled,
      caller_call_id: callerCallId,
      caller_agent_id: callerAgentId,
      caller_leg: leg,
      callee,
      ...(settled ? {} : { resume: { caller_call_id: callerCallId } }),
    },
  };
}

export async function runSelfCall(
  sql: SqlClient,
  rawBody: unknown,
  deps: SelfCallDeps,
): Promise<SelfCallResult> {
  const parsed = validateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;

  if (req.action === "status") {
    // `caller_agent_id` isn't known on a resumed status call — harmless
    // (informational field only); the tenant lookup is cheap and safe to
    // redo so `callee` evidence is still populated once settled.
    // `validateRequest` already guarantees `caller_call_id` is set for
    // action: "status" (the only way `req.action` reaches this branch).
    const callee = await resolveCalleeTenant(sql);
    return pollAndAssemble(sql, deps, req.caller_call_id as string, "", callee?.tenant_id ?? null);
  }

  const callee = await resolveCalleeTenant(sql);
  if (!callee) {
    deps.logger.error("self_call_callee_tenant_not_found", { number: SELF_CALL_CALLEE_NUMBER });
    return { status: 422, body: { error: "callee_number_not_provisioned" } };
  }

  const agentOutcome = await ensureCallerAgent(
    sql,
    deps,
    callee.business_name,
    req.force_recreate_caller_agent === true,
  );
  if (!agentOutcome.ok) return { status: agentOutcome.status, body: { error: agentOutcome.error } };
  const callerAgentId = agentOutcome.agentId;

  const bound = await updatePhoneNumber(
    deps.retellFetch,
    deps.retellApiKey,
    SELF_CALL_CALLER_NUMBER,
    {
      outbound_agents: [{ agent_id: callerAgentId, weight: 1 }],
    },
  );
  if (!bound.ok) {
    deps.logger.error("self_call_bind_outbound_agent_failed", { status: bound.status });
    return { status: 502, body: { error: "retell_update_phone_number_failed" } };
  }

  // Deliverable 1 (docs/BUILD_PLAN.md self-call task): attempt ONE call.
  // Outbound calling may be gated by Retell's account-level KYC/identity
  // verification (docs.retellai.com/accounts/kyc, RETELL-VERIFIED
  // 2026-09-21 — no per-call error shape is documented, only that
  // verification is required to "unlock outbound calling"). If Retell
  // rejects this, the exact status/body is returned as-is (never retried,
  // never a second attempt) so the caller can capture it verbatim into
  // docs/BUILD_NOTES.md + docs/GO_LIVE.md.
  const placed = await createPhoneCall(deps.retellFetch, deps.retellApiKey, {
    from_number: SELF_CALL_CALLER_NUMBER,
    to_number: SELF_CALL_CALLEE_NUMBER,
    override_agent_id: callerAgentId,
    retell_llm_dynamic_variables: {
      caller_name: CALLER_NAME,
      caller_phone: formatPhoneForSpeech(SELF_CALL_CALLER_NUMBER),
      vehicle: CALLER_VEHICLE,
      business_name: callee.business_name,
      disclosure_line: CALLER_DISCLOSURE_LINE,
    },
    metadata: { source: "api-admin-self-call", task_id: "SELFCALL-1" },
  });
  const placedBody = placed.body as { call_id?: string };
  if (!placed.ok || !placedBody.call_id) {
    deps.logger.error("self_call_create_phone_call_failed", {
      status: placed.status,
      body: JSON.stringify(placed.body).slice(0, 2000),
    });
    return {
      status: 502,
      body: {
        error: "retell_create_phone_call_failed",
        retell_status: placed.status,
        retell_body: placed.body,
      },
    };
  }

  return pollAndAssemble(sql, deps, placedBody.call_id, callerAgentId, callee.tenant_id);
}
