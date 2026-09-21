// CALL-9: `resolveVerticalDynamicVariables`'s own cross-function-folder
// import (CALL-7's original note, kept here for history) is now reached
// indirectly, through `buildInboundDynamicVariables` — see that function's
// own doc comment (`_shared/inbound-dynamic-variables.ts`) for why this
// file and `voice-inbound/handler.ts` share ONE builder instead of two
// hand-rolled subsets of the same logic.
import {
  buildInboundDynamicVariables,
  type InboundDynamicVariables,
} from "../_shared/inbound-dynamic-variables.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createBatchTest,
  createChat,
  createChatCompletion,
  createTestCaseDefinition,
  listTestRuns,
} from "../_shared/providers/retell.ts";
import type { TestScenario, WriteIntent } from "../_shared/test-scenarios.ts";
import { scenariosForVertical } from "../_shared/test-scenarios.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";
import { getMissingRequiredFields } from "../_shared/vertical-intake.ts";

/**
 * `api-admin-run-agent-tests` (CALL-1, docs/BUILD_PLAN.md task 3): runs
 * Retell's own batch-simulation test suite against a tenant's real compiled
 * agent — LIVE against `_shared/providers/retell.ts`'s
 * create-test-case-definition/create-batch-test/list-test-runs (same
 * confirmed shapes `packages/adapters/retell/src/tests-api.ts` already
 * wraps for the Node-side red-team harness). No `tool_mocks` are ever sent
 * — confirmed against docs.retellai.com 2026-09-20 that an unmocked tool
 * call "falls through to the real tool", i.e. this DOES exercise the
 * tenant's real `/voice-tools` webhook live (`docs/research/
 * RETELL_TESTABILITY_2026-09-20.md`'s own open question, resolved).
 *
 * One Supabase Edge Function invocation has a bounded wall-clock budget, so
 * this is RESUMABLE rather than blocking until every case settles: the
 * first call creates the test-case definitions + batch job and polls for
 * up to `deps.pollBudgetMs`; if the batch hasn't fully settled by then, the
 * response carries `settled: false` plus everything (`batch_job_id`,
 * `case_definitions`, `started_at`) a second call needs to resume polling
 * via the `resume` field — no new case definitions/batch job are created on
 * a resumed call.
 */

export interface RunAgentTestsRequest {
  tenant_id: string;
  scenarios?: string[];
  resume?: {
    batch_job_id: string;
    case_definitions: Array<{ case_id: string; definition_id: string }>;
    started_at: string;
  };
  /** "batch" (default): the full Retell batch-simulation suite (see file
   * header). "chat_smoke": a secondary, independent live check (CALL-1 RUN
   * IT LIVE step d) — a couple of turns over Retell's Chat API
   * (create-chat/create-chat-completion, `docs/research/
   * RETELL_TESTABILITY_2026-09-20.md` row 4a/4b) against the SAME real
   * agent, specifically to confirm the `/voice-tools` webhook actually
   * fires and produces `tool_health` rows outside the batch-test
   * simulator's own conversation-loop heuristics. */
  mode?: "batch" | "chat_smoke";
}

export interface ChatSmokeSuccessBody {
  tenant_id: string;
  mode: "chat_smoke";
  chat_id: string;
  started_at: string;
  messages: Array<{ role: string; content: string }>;
  tool_health: { total: number; by_tool: ToolHealthCount[] };
  call_logs_count: number;
}

/** CALL-2 (docs/BUILD_NOTES.md, docs/VERIFY.md): `chat_smoke` reports this
 * instead of attempting `create-chat`, confirmed via
 * docs.retellai.com/build/create-chat-agent 2026-09-20 — Retell's Chat API
 * requires a dedicated CHAT agent (dashboard "Create an Agent" -> "Chat
 * Agent", or `POST /create-chat-agent`), a separate agent resource from a
 * VOICE agent even when both share the same response_engine type
 * (`conversation-flow`/`retell-llm`). This tenant's `agent_configs.
 * retell_agent_id` is always a voice agent (`api-admin-provision-test-
 * tenant`/`api-provision` both only ever call `create-agent`/`create-
 * conversation-flow`) — never a chat agent — so `create-chat` against it
 * cannot succeed regardless of response_engine, matching the live 422
 * `"Cannot start a chat session with selected agent."` this task's CALL-1
 * predecessor hit. Not a conversation-flow-specific limitation as CALL-1
 * left it (open question resolved). */
export interface ChatSmokeUnsupportedBody {
  tenant_id: string;
  mode: "chat_smoke";
  unsupported: true;
  reason: string;
}

export interface ScenarioResult {
  case_id: string;
  label: string;
  status: "pending" | "in_progress" | "pass" | "fail" | "error";
  result_explanation: string | null;
  transcript_snapshot_present: boolean;
  /** Truncated JSON dump of the raw `transcript_snapshot` for manual
   * inspection — this wrapper does not parse it (packages/adapters/retell/
   * src/tests-api.ts's own VERIFY-13 note: the SDK types this field
   * `unknown` by design and no fetched doc page shows a worked example).
   * CALL-2: bumped from 1500 to 12000 chars — the old cap cut off a
   * multi-turn conversation before it reached its `tool_calls`/loop-abort
   * point, the exact thing this response exists to help diagnose. */
  transcript_preview: string | null;
  /**
   * CALL-8 (docs/BUILD_PLAN.md): "did the agent actually collect every
   * detail this vertical needs for this write intent, not just settle
   * `pass`?" — `null` for a `writeIntent: "none"` scenario (nothing to
   * verify) or when Retell itself never reached `pass`/`fail` for it (a
   * missing row would be a `settled: false`/`error`-state artifact, not a
   * real field-capture failure). Populated by `verifyScenarioFields` once
   * the batch settles, from the LIVE DB row the scenario's own write tool
   * call produced (`bookings`/`orders` joined to `customers` by this
   * scenario's own unique `expectedPhone`; `call_logs.structured_booking_payload`
   * for `take_message` — see `test-scenarios.ts#TestScenario.expectedPhone`'s
   * own doc comment for the one documented take_message/same-batch
   * attribution limitation).
   */
  field_capture: {
    write_intent: Exclude<WriteIntent, "none">;
    row_found: boolean;
    fields_required: string[];
    fields_captured: string[];
    fields_missing: string[];
  } | null;
}

/**
 * CALL-8: reconstructs the same `{customer: {name, phone}, start, end,
 * party_size, structured_payload}` / `{caller_name, caller_phone,
 * message_text, structured_payload}` shape `_shared/vertical-intake.ts#getMissingRequiredFields`
 * checks against, FROM the real row the scenario's write tool call
 * produced — this is the live-DB-facts version of the exact same gate
 * `voice-tools/handler.ts#applyIntakeGate` already enforced BEFORE that row
 * was ever written, so a `row_found: true` result with `fields_missing: []`
 * is real, end-to-end proof the required fields both survived the call and
 * landed durably, not just that the model said the right words at some
 * point in the transcript.
 */
async function fetchScenarioIntakeArgs(
  sql: SqlClient,
  tenantId: string,
  scenario: TestScenario,
): Promise<{ found: boolean; args: Record<string, unknown> }> {
  const phone = scenario.expectedPhone;
  if (!phone) return { found: false, args: {} };

  // CALL-8: deliberately NO `created_at >= startedAt` filter on any of the
  // three lookups below (bookings/orders/call_logs) — live-observed root
  // cause, confirmed against a real duplicate run: Retell's batch-test
  // simulator reuses the SAME synthetic `call_id` ("playground", or this
  // codebase's own per-tenant-keyed variant, CALL-6) across DIFFERENT test
  // invocations for the same tenant, and `create_booking`/`create_order`'s
  // idempotency keys are derived from `(call_id, start)`/`(call_id, items)`
  // — so a scenario whose persona picks the same slot/items run after run
  // (e.g. "the earliest available time") can hit `bookingIdempotencyKey`'s
  // REPLAY path and return an EARLIER run's already-existing row rather
  // than writing a new one. That's correct, load-bearing behavior for a
  // REAL call (a genuine retry must never duplicate) — but it means a
  // fresh time-windowed query can miss a booking that, from this scenario's
  // own point of view, absolutely did get created with every field intact,
  // just not inside this exact wall-clock window. Matching by this
  // scenario's own unique-within-vertical `expectedPhone` (querying for
  // the MOST RECENT matching row) is the reliable signal instead: unique
  // phones mean this can only ever match a row this exact scenario's own
  // persona produced.
  if (scenario.writeIntent === "create_booking") {
    const rows = await sql<{
      start_at: string;
      end_at: string;
      party_size: number | null;
      structured_payload: Record<string, unknown> | null;
      customer_name: string | null;
      customer_phone: string;
    }>`
      select b.start_at, b.end_at, b.party_size, b.structured_payload,
        c.name as customer_name, c.phone_e164 as customer_phone
      from public.bookings b
      join public.customers c on c.id = b.customer_id
      where b.tenant_id = ${tenantId} and c.phone_e164 = ${phone}
      order by b.created_at desc
      limit 1
    `;
    const row = rows[0];
    if (!row) return { found: false, args: {} };
    return {
      found: true,
      args: {
        customer: { name: row.customer_name, phone: row.customer_phone },
        start: row.start_at,
        end: row.end_at,
        party_size: row.party_size,
        structured_payload: row.structured_payload ?? {},
      },
    };
  }

  if (scenario.writeIntent === "create_order") {
    const rows = await sql<{ customer_name: string | null; customer_phone: string }>`
      select c.name as customer_name, c.phone_e164 as customer_phone
      from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.tenant_id = ${tenantId} and c.phone_e164 = ${phone}
      order by o.created_at desc
      limit 1
    `;
    const row = rows[0];
    if (!row) return { found: false, args: {} };
    return {
      found: true,
      args: { customer: { name: row.customer_name, phone: row.customer_phone } },
    };
  }

  // take_message — see `TestScenario.expectedPhone`'s own doc comment for
  // the documented same-batch/same-vertical multi-take_message-scenario
  // attribution limitation (`call_logs` is a per-TENANT, not per-scenario,
  // placeholder row on a batch-test run). `caller_name`/`caller_phone` were
  // folded into `structured_booking_payload` (voice-tools/tools/take_message.ts,
  // CALL-8) specifically so this is queryable at all regardless of whether
  // `agent_configs.transfer_number` is configured (every test tenant has
  // none — CALL-4).
  //
  // Deliberately NO `started_at >= startedAt` filter here (unlike the
  // bookings/orders queries above): `call_logs` has no column that's
  // touched by `take_message.ts`'s own UPDATE (`started_at`/`created_at`
  // are set once, at the placeholder row's first-ever creation — CALL-6's
  // per-tenant, first-writer-wins upsert never bumps either on a later
  // conflict, confirmed live: a tenant's placeholder row can be days old
  // while `message_text`/`structured_booking_payload` were updated
  // moments ago). A `phone`-only match is therefore the reliable signal —
  // `phone` is this scenario's own unique-within-vertical `expectedPhone`,
  // and this is the CURRENT value of a column `take_message.ts`
  // unconditionally overwrites (not merges past values under) on every
  // call, so a match is always this row's latest state, never stale
  // leftover content from an unrelated field.
  const rows = await sql<{
    message_text: string | null;
    structured_booking_payload: Record<string, unknown> | null;
  }>`
    select message_text, structured_booking_payload
    from public.call_logs
    where tenant_id = ${tenantId}
      and structured_booking_payload ->> 'caller_phone' = ${phone}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { found: false, args: {} };
  const payload = row.structured_booking_payload ?? {};
  return {
    found: true,
    args: {
      caller_name: payload["caller_name"],
      caller_phone: payload["caller_phone"],
      message_text: row.message_text,
      structured_payload: payload,
    },
  };
}

/**
 * CALL-8: populates `ScenarioResult.field_capture` for every settled
 * scenario whose `TestScenario` declares a `writeIntent !== "none"`.
 * Deliberately does NOT downgrade Retell's own `pass`/`fail`/`error`
 * `status` — a scenario that settled `pass` with `fields_missing.length >
 * 0` is real, actionable evidence the agent said the right things but
 * didn't actually collect/persist everything required, which the caller
 * (the CALL-8 test-run report) surfaces explicitly rather than silently
 * folding into a binary pass/fail Retell's own transcript-only judge can't
 * see.
 */
async function verifyScenarioFields(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  scenarios: TestScenario[],
  results: ScenarioResult[],
): Promise<void> {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  for (const result of results) {
    const scenario = byId.get(result.case_id);
    if (!scenario || scenario.writeIntent === "none") continue;
    if (result.status !== "pass" && result.status !== "fail") continue; // pending/in_progress/error: nothing settled to check
    const { found, args } = await fetchScenarioIntakeArgs(sql, tenantId, scenario);
    const required = getMissingRequiredFields(vertical, scenario.writeIntent, {});
    const requiredPaths = required.map((f) => f.path);
    const missing = found
      ? getMissingRequiredFields(vertical, scenario.writeIntent, args).map((f) => f.path)
      : requiredPaths;
    result.field_capture = {
      write_intent: scenario.writeIntent,
      row_found: found,
      fields_required: requiredPaths,
      fields_captured: requiredPaths.filter((p) => !missing.includes(p)),
      fields_missing: missing,
    };
  }
}

export interface ToolHealthCount {
  tool_name: string;
  count: number;
  success_count: number;
}

export interface RunAgentTestsSuccessBody {
  tenant_id: string;
  batch_job_id: string;
  settled: boolean;
  started_at: string;
  results: ScenarioResult[];
  resume?: {
    batch_job_id: string;
    case_definitions: Array<{ case_id: string; definition_id: string }>;
    started_at: string;
  };
  tool_health: { total: number; by_tool: ToolHealthCount[] };
  call_logs_count: number;
}

export interface RunAgentTestsResult {
  status: number;
  body:
    | RunAgentTestsSuccessBody
    | ChatSmokeSuccessBody
    | ChatSmokeUnsupportedBody
    | { error: string };
}

export interface RunAgentTestsDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** Total wall-clock budget (ms) this ONE invocation spends polling
   * list-test-runs before returning a resumable `settled: false` response.
   * Kept comfortably under Supabase Edge Functions' own execution limit —
   * default 45s. */
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  logger: Logger;
}

export function validateRequest(
  body: unknown,
): { ok: true; data: RunAgentTestsRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const tenantId = b["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  const scenarios = b["scenarios"];
  if (scenarios !== undefined) {
    if (!Array.isArray(scenarios) || !scenarios.every((s) => typeof s === "string")) {
      return { ok: false, error: "invalid_scenarios" };
    }
  }
  const resume = b["resume"];
  if (resume !== undefined) {
    if (typeof resume !== "object" || resume === null) {
      return { ok: false, error: "invalid_resume" };
    }
    const r = resume as Record<string, unknown>;
    if (
      typeof r["batch_job_id"] !== "string" ||
      typeof r["started_at"] !== "string" ||
      !Array.isArray(r["case_definitions"])
    ) {
      return { ok: false, error: "invalid_resume" };
    }
  }
  const mode = b["mode"];
  if (mode !== undefined && mode !== "batch" && mode !== "chat_smoke") {
    return { ok: false, error: "invalid_mode" };
  }
  return {
    ok: true,
    data: {
      tenant_id: tenantId,
      ...(scenarios ? { scenarios: scenarios as string[] } : {}),
      ...(resume ? { resume: resume as NonNullable<RunAgentTestsRequest["resume"]> } : {}),
      ...(mode ? { mode: mode as "batch" | "chat_smoke" } : {}),
    },
  };
}

interface TestCaseJob {
  test_case_job_id: string;
  status: "pending" | "in_progress" | "pass" | "fail" | "error";
  test_case_definition_id: string;
  result_explanation?: string | null;
  transcript_snapshot?: unknown;
}

async function pollBatch(
  deps: RunAgentTestsDeps,
  batchJobId: string,
  caseDefinitions: Array<{ case_id: string; definition_id: string }>,
): Promise<{ settled: boolean; results: ScenarioResult[] }> {
  const pollIntervalMs = deps.pollIntervalMs ?? 4000;
  const pollBudgetMs = deps.pollBudgetMs ?? 45_000;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const labelByCaseId = new Map(caseDefinitions.map((c) => [c.case_id, c.case_id]));
  const definitionToCaseId = new Map(caseDefinitions.map((c) => [c.definition_id, c.case_id]));

  const deadline = Date.now() + pollBudgetMs;
  const latestByCase = new Map<string, TestCaseJob>();

  while (true) {
    const listed = await listTestRuns(deps.retellFetch, deps.retellApiKey, batchJobId);
    if (!listed.ok) {
      deps.logger.error("run_agent_tests_list_runs_failed", { batchJobId, status: listed.status });
      break;
    }
    const body = listed.body as { items?: TestCaseJob[] };
    for (const job of body.items ?? []) {
      const caseId = definitionToCaseId.get(job.test_case_definition_id);
      if (!caseId) continue;
      latestByCase.set(caseId, job);
    }

    const allSettled = [...definitionToCaseId.values()].every((caseId) => {
      const job = latestByCase.get(caseId);
      return job && job.status !== "pending" && job.status !== "in_progress";
    });
    if (allSettled || Date.now() > deadline) {
      const results: ScenarioResult[] = caseDefinitions.map((c) => {
        const job = latestByCase.get(c.case_id);
        return {
          case_id: c.case_id,
          label: labelByCaseId.get(c.case_id) ?? c.case_id,
          status: job?.status ?? "pending",
          result_explanation: job?.result_explanation ?? null,
          transcript_snapshot_present: job?.transcript_snapshot != null,
          transcript_preview:
            job?.transcript_snapshot != null
              ? JSON.stringify(job.transcript_snapshot).slice(0, 12000)
              : null,
          field_capture: null,
        };
      });
      return { settled: allSettled, results };
    }
    await sleep(pollIntervalMs);
  }

  const results: ScenarioResult[] = caseDefinitions.map((c) => {
    const job = latestByCase.get(c.case_id);
    return {
      case_id: c.case_id,
      label: labelByCaseId.get(c.case_id) ?? c.case_id,
      status: job?.status ?? "error",
      result_explanation: job?.result_explanation ?? "list_test_runs_failed",
      transcript_snapshot_present: job?.transcript_snapshot != null,
      transcript_preview:
        job?.transcript_snapshot != null
          ? JSON.stringify(job.transcript_snapshot).slice(0, 12000)
          : null,
      field_capture: null,
    };
  });
  return { settled: true, results };
}

function runChatSmoke(tenantId: string): RunAgentTestsResult {
  // CALL-2: confirmed unsupported for this tenant's agent — see
  // `ChatSmokeUnsupportedBody`'s doc comment. Returned WITHOUT calling
  // `createChat` at all (the 422 is guaranteed, not worth the live call).
  return {
    status: 200,
    body: {
      tenant_id: tenantId,
      mode: "chat_smoke",
      unsupported: true,
      reason:
        "Retell's Chat API (create-chat) requires a dedicated chat agent " +
        "(dashboard 'Create an Agent' -> 'Chat Agent', or POST /create-chat-agent) " +
        "distinct from a voice agent, even one using the same response_engine " +
        "(conversation-flow/retell-llm). This tenant's agent_configs.retell_agent_id " +
        "is a voice agent (create-agent/create-conversation-flow) — create-chat " +
        "against it always 422s. Confirmed via docs.retellai.com/build/create-chat-agent " +
        "2026-09-20; see docs/VERIFY.md CALL-2.",
    },
  };
}

/**
 * The pre-CALL-2 implementation, kept (exported, still covered by its own
 * tests) rather than deleted per CLAUDE.md Rule 4 ("leave the code, mark
 * unsupported in its response") — `runChatSmoke` above no longer calls this
 * against a tenant's VOICE agent (guaranteed 422, see `ChatSmokeUnsupportedBody`),
 * but it's exactly what a follow-up task should call once a tenant also has
 * a real Retell CHAT agent (`POST /create-chat-agent`) provisioned and its
 * id available to look up here instead of `agent_configs.retell_agent_id`.
 */
export async function runChatSmokeAgainstChatAgent(
  sql: SqlClient,
  tenantId: string,
  deps: RunAgentTestsDeps,
): Promise<RunAgentTestsResult> {
  const now = deps.now ?? (() => new Date());
  const configRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${tenantId}
  `;
  const agentId = configRows[0]?.retell_agent_id;
  if (!agentId) return { status: 422, body: { error: "tenant_has_no_compiled_agent" } };

  const startedAt = now().toISOString();
  const chat = await createChat(deps.retellFetch, deps.retellApiKey, { agent_id: agentId });
  const chatBody = chat.body as { chat_id?: string; transcript?: unknown };
  if (!chat.ok || !chatBody.chat_id) {
    deps.logger.error("run_agent_tests_chat_smoke_create_chat_failed", {
      tenant_id: tenantId,
      status: chat.status,
      body: JSON.stringify(chat.body).slice(0, 500),
    });
    return { status: 502, body: { error: "retell_create_chat_failed" } };
  }
  const chatId = chatBody.chat_id;

  const turns = [
    "Hi, what are your hours and can I get an oil change?",
    "Yes please book the earliest slot — my name is Jamie Rivera and my callback number is 555-201-0199.",
  ];
  const messages: Array<{ role: string; content: string }> = [];
  for (const turn of turns) {
    messages.push({ role: "user", content: turn });
    const completion = await createChatCompletion(deps.retellFetch, deps.retellApiKey, {
      chat_id: chatId,
      content: turn,
    });
    const completionBody = completion.body as {
      messages?: Array<{ role: string; content: string }>;
    };
    if (!completion.ok) {
      deps.logger.error("run_agent_tests_chat_smoke_completion_failed", {
        tenant_id: tenantId,
        status: completion.status,
        body: JSON.stringify(completion.body).slice(0, 500),
      });
      break;
    }
    for (const m of completionBody.messages ?? []) messages.push(m);
  }

  const toolHealthRows = await sql<{ tool_name: string; cnt: number; success_cnt: number }>`
    select tool_name, count(*)::int as cnt, count(*) filter (where success)::int as success_cnt
    from public.tool_health
    where tenant_id = ${tenantId} and occurred_at >= ${startedAt}
    group by tool_name
  `;
  const callLogsRows = await sql<{ cnt: number }>`
    select count(*)::int as cnt from public.call_logs
    where tenant_id = ${tenantId} and created_at >= ${startedAt}
  `;
  const byTool = toolHealthRows.map((r) => ({
    tool_name: r.tool_name,
    count: r.cnt,
    success_count: r.success_cnt,
  }));

  return {
    status: 200,
    body: {
      tenant_id: tenantId,
      mode: "chat_smoke",
      chat_id: chatId,
      started_at: startedAt,
      messages,
      tool_health: { total: byTool.reduce((sum, t) => sum + t.count, 0), by_tool: byTool },
      call_logs_count: callLogsRows[0]?.cnt ?? 0,
    },
  };
}

/**
 * CALL-9 (docs/BUILD_PLAN.md): "did you test that it pulls data from our
 * database before the call?" — `voice-inbound/handler.ts`'s own webhook has
 * never run live (Retell batch tests/web calls bypass it entirely, and
 * signing a webhook request ourselves isn't possible from here — CALL-5's
 * own documented finding). This proves the SAME pre-call DB path
 * (`_shared/inbound-dynamic-variables.ts#buildInboundDynamicVariables` —
 * the customer-by-phone lookup + full dynamic-variable assembly, extracted
 * from `voice-inbound/handler.ts` this task so both callers share it) live,
 * without needing a signed Retell request at all: given a `tenant_id` and
 * an optional synthetic `from_number`, it resolves this tenant's own
 * config (the exact same columns `voice-inbound/handler.ts`'s own query
 * selects — `business_hours`/`hours_exceptions`/`dynamic_variable_
 * overrides`/`disclosure_line`/`transfer_number`/etc.) and calls the same
 * shared builder, returning whatever `dynamic_variables` a REAL
 * `call_inbound` webhook would have produced for this tenant/caller pair —
 * including `caller_recent_context` when `from_number` matches a seeded
 * `customers` row, live, from the real table.
 *
 * Deliberately resolves by `tenant_id` directly rather than joining through
 * `phone_numbers` the way `voice-inbound/handler.ts` itself does — this
 * function exists to prove the DB-lookup half of the pipeline for ANY test
 * tenant, including the six that have no phone number attached at all
 * (CALL-5/CALL-6: only `test-riverside-auto` has one). The one thing this
 * does NOT prove — and cannot, from here — is the `phone_numbers.e164 ->
 * tenant_id` routing lookup itself, or the Retell webhook transport/
 * signature verification in front of it; those remain provable only by a
 * real call to a tenant's attached number (documented in this task's
 * BUILD_NOTES entry).
 */
export interface SimulateInboundRequest {
  tenant_id: string;
  from_number?: string;
}

export interface SimulateInboundSuccessBody {
  tenant_id: string;
  from_number: string | null;
  dynamic_variables: InboundDynamicVariables;
}

export interface SimulateInboundResult {
  status: number;
  body: SimulateInboundSuccessBody | { error: string };
}

export function validateSimulateRequest(
  body: unknown,
): { ok: true; data: SimulateInboundRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const tenantId = b["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  const fromNumber = b["from_number"];
  if (fromNumber !== undefined && typeof fromNumber !== "string") {
    return { ok: false, error: "invalid_from_number" };
  }
  return {
    ok: true,
    data: { tenant_id: tenantId, ...(fromNumber ? { from_number: fromNumber } : {}) },
  };
}

interface SimulateInboundRow {
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
  disclosure_line: string;
  transfer_number: string | null;
}

export async function simulateInboundCall(
  sql: SqlClient,
  rawBody: unknown,
  deps: RunAgentTestsDeps,
): Promise<SimulateInboundResult> {
  const parsed = validateSimulateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;
  const now = deps.now ?? (() => new Date());

  // Same join shape as voice-inbound/handler.ts's own InboundRow query,
  // WHERE'd by tenant_id instead of phone_numbers.e164 (see this function's
  // own doc comment for why).
  const rows = await sql<SimulateInboundRow>`
    select
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
      ac.transfer_number,
      at.disclosure_line
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where t.id = ${req.tenant_id} and t.deleted_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return { status: 404, body: { error: "tenant_not_found" } };

  const fromNumber = normalizeE164(req.from_number ?? null);
  const dynamicVariables = await buildInboundDynamicVariables({
    sql,
    logger: deps.logger,
    now: now(),
    fromNumber,
    config: {
      tenantId: req.tenant_id,
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
      disclosureLine:
        row.disclosure_line ??
        "This call may be recorded, and you are speaking with an AI assistant.",
      transferNumber: row.transfer_number,
    },
  });

  return {
    status: 200,
    body: {
      tenant_id: req.tenant_id,
      from_number: fromNumber,
      dynamic_variables: dynamicVariables,
    },
  };
}

/**
 * CALL-9: `POST /create-test-case-definition`'s own `dynamic_variables`
 * field is `Record<string, string>` (`_shared/providers/retell.ts`) — every
 * value must be a string. `buildInboundDynamicVariables`'s return type
 * mirrors `/voice-inbound`'s own response shape instead (which carries a
 * couple of non-string fields — `is_manual_mode: boolean`,
 * `accepted_payment_types: string[]` — Retell's separate `call_inbound`
 * webhook-response contract, not `create-test-case-definition`'s). Converts
 * losslessly (`String(true)` -> `"true"`, an array joined with `, `) rather
 * than dropping either field, so a batch-test scenario still gets the same
 * information a real call's dynamic variables would carry, just coerced to
 * the shape THIS Retell endpoint actually accepts.
 */
function toRetellDynamicVariableStrings(vars: InboundDynamicVariables): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    out[key] =
      typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

export async function runAgentTests(
  sql: SqlClient,
  rawBody: unknown,
  deps: RunAgentTestsDeps,
): Promise<RunAgentTestsResult> {
  const parsed = validateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;
  const now = deps.now ?? (() => new Date());

  if (req.mode === "chat_smoke") return runChatSmoke(req.tenant_id);

  let batchJobId: string;
  let caseDefinitions: Array<{ case_id: string; definition_id: string }>;
  let startedAt: string;
  // CALL-8: needed after polling settles, to look up this vertical's
  // `TestScenario[]`/required-field matrix for `verifyScenarioFields` —
  // populated on BOTH the fresh-run and resumed-run paths (a resume call
  // never re-fetches the tenant row otherwise, since everything else it
  // needs already travels in `req.resume`).
  let vertical: Vertical | null = null;

  if (req.resume) {
    batchJobId = req.resume.batch_job_id;
    caseDefinitions = req.resume.case_definitions;
    startedAt = req.resume.started_at;
    const tenantRows = await sql<{ vertical: Vertical }>`
      select vertical from public.tenants where id = ${req.tenant_id}
    `;
    vertical = tenantRows[0]?.vertical ?? null;
  } else {
    // CALL-9: extended to every column `_shared/inbound-dynamic-variables.ts#
    // buildInboundDynamicVariables` needs (the same shared function
    // `voice-inbound/handler.ts` and this function's own `simulateInboundCall`
    // both call) — so a batch-test scenario's dynamic variables are built by
    // the EXACT SAME code as a real inbound call, not a thinner hand-rolled
    // subset (this file's pre-CALL-9 body only ever set
    // `current_date`/`current_weekday`/`upcoming_weekday_dates`/
    // `heyloo_tenant_id` plus per-vertical tokens — never `greeting_hours_
    // context`/`disclosure_line`/`special_instructions`/etc., and, before
    // this task, never a `caller_recent_context` a returning-caller scenario
    // could actually use).
    const tenantRows = await sql<{
      vertical: Vertical;
      timezone: string;
      business_name: string;
      business_hours: Record<string, unknown>;
      hours_exceptions: unknown[];
      manual_mode: boolean;
      language_primary: string;
    }>`
      select vertical, timezone, name as business_name, business_hours, hours_exceptions,
        manual_mode, coalesce(language_config->>'primary', 'en') as language_primary
      from public.tenants where id = ${req.tenant_id}
    `;
    const tenant = tenantRows[0];
    if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };
    vertical = tenant.vertical;

    const configRows = await sql<{
      compiled_config: Record<string, unknown> | null;
      assistant_name: string | null;
      special_instructions: string | null;
      dynamic_variable_overrides: Record<string, unknown> | null;
      transfer_number: string | null;
      disclosure_line: string | null;
    }>`
      select ac.compiled_config, ac.assistant_name, ac.special_instructions,
        ac.dynamic_variable_overrides, ac.transfer_number, at.disclosure_line
      from public.agent_configs ac
      left join public.agent_templates at on at.id = ac.template_id
      where ac.tenant_id = ${req.tenant_id}
    `;
    const compiledConfig = configRows[0]?.compiled_config;
    const responseEngine = (compiledConfig as Record<string, unknown> | null)?.[
      "response_engine"
    ] as Record<string, unknown> | undefined;
    if (!responseEngine) return { status: 422, body: { error: "tenant_has_no_compiled_agent" } };

    const allScenarios = scenariosForVertical(tenant.vertical);
    const scenarios = req.scenarios
      ? allScenarios.filter((s) => req.scenarios?.includes(s.id))
      : allScenarios;
    if (scenarios.length === 0) return { status: 422, body: { error: "no_matching_scenarios" } };

    startedAt = now().toISOString();
    const overrides = configRows[0]?.dynamic_variable_overrides ?? {};
    const inboundConfig = {
      tenantId: req.tenant_id,
      businessName: tenant.business_name,
      vertical: tenant.vertical,
      timezone: tenant.timezone,
      businessHours: tenant.business_hours,
      hoursExceptions: tenant.hours_exceptions,
      manualMode: tenant.manual_mode,
      languagePrimary: tenant.language_primary,
      assistantName: configRows[0]?.assistant_name ?? null,
      specialInstructions: configRows[0]?.special_instructions ?? null,
      dynamicVariableOverrides: overrides,
      disclosureLine:
        configRows[0]?.disclosure_line ??
        "This call may be recorded, and you are speaking with an AI assistant.",
      transferNumber: configRows[0]?.transfer_number ?? null,
    };
    caseDefinitions = [];
    for (const scenario of scenarios) {
      // CALL-9: the SAME shared builder `voice-inbound/handler.ts` (a real
      // call) and `simulateInboundCall` (this file's own internal proof
      // action) both call — see this function's own doc comment above the
      // extended `tenantRows`/`configRows` queries. `fromNumber` is this
      // scenario's own `testCallerNumber` when set (a returning-caller
      // scenario — `_shared/test-scenarios.ts`), `null` otherwise, exactly
      // mirroring what a real caller's own `from_number` would be.
      const scenarioFromNumber = normalizeE164(scenario.testCallerNumber ?? null);
      const dynamicVariables = await buildInboundDynamicVariables({
        sql,
        logger: deps.logger,
        now: now(),
        fromNumber: scenarioFromNumber,
        config: inboundConfig,
      });

      const created = await createTestCaseDefinition(deps.retellFetch, deps.retellApiKey, {
        name: `${tenant.vertical}:${scenario.id}`.slice(0, 200),
        response_engine: responseEngine,
        user_prompt: scenario.personaPrompt,
        metrics: ["Agent's responses stay relevant to what the simulated caller said."],
        dynamic_variables: {
          // CALL-2 (docs/BUILD_NOTES.md): RETELL-VERIFIED live — a
          // batch-test simulator's tool-call payload never carries
          // `agent_id`/`to_number` (no real Agent/phone-number resource
          // is bound to a bare-response_engine test run), so voice-tools/
          // context.ts's context resolver has nothing to key a tenant
          // lookup on for this surface at all UNLESS we hand it one
          // ourselves. `heyloo_tenant_id` here is the one this codebase's
          // own `resolveTenantFromPayload` reads back from
          // `call.retell_llm_dynamic_variables` — a batch-test/QA-
          // harness-only mechanism, never present on a real call.
          heyloo_tenant_id: req.tenant_id,
          // CALL-9: same QA-harness-only mechanism as `heyloo_tenant_id`
          // above — `voice-tools/context.ts` honors this ONLY for a
          // placeholder/batch-test call id, never a real one (see that
          // module's own doc comment). Omitted entirely (never sent as an
          // empty string) when this scenario has no `testCallerNumber`, so
          // it's indistinguishable from every scenario before this task.
          ...(scenarioFromNumber ? { heyloo_test_caller_number: scenarioFromNumber } : {}),
          // CALL-9: every field `/voice-inbound` itself would have set for
          // a real call to this tenant/caller — includes `current_date`/
          // `current_weekday`/`upcoming_weekday_dates` (CALL-2/CALL-6's own
          // fixes, unchanged in effect) and every per-vertical `{{token}}`
          // (CALL-7), now built by the SAME shared function instead of a
          // parallel hand-rolled subset. Coerced to Retell's own
          // Record<string,string> contract for this endpoint (see
          // `toRetellDynamicVariableStrings`'s own doc comment).
          ...toRetellDynamicVariableStrings(dynamicVariables),
        },
      });
      const createdBody = created.body as { test_case_definition_id?: string };
      if (!created.ok || !createdBody.test_case_definition_id) {
        deps.logger.error("run_agent_tests_create_definition_failed", {
          scenario: scenario.id,
          status: created.status,
        });
        return { status: 502, body: { error: "retell_create_test_case_definition_failed" } };
      }
      caseDefinitions.push({
        case_id: scenario.id,
        definition_id: createdBody.test_case_definition_id,
      });
    }

    const batch = await createBatchTest(deps.retellFetch, deps.retellApiKey, {
      response_engine: responseEngine,
      test_case_definition_ids: caseDefinitions.map((c) => c.definition_id),
    });
    const batchBody = batch.body as { test_case_batch_job_id?: string };
    if (!batch.ok || !batchBody.test_case_batch_job_id) {
      deps.logger.error("run_agent_tests_create_batch_failed", { status: batch.status });
      return { status: 502, body: { error: "retell_create_batch_test_failed" } };
    }
    batchJobId = batchBody.test_case_batch_job_id;
  }

  const { settled, results } = await pollBatch(deps, batchJobId, caseDefinitions);

  // CALL-8 (docs/BUILD_PLAN.md): only once the batch has genuinely settled
  // (never on a `settled: false` resumable response — nothing to check yet)
  // and only when `vertical` resolved (always true past this point in
  // practice; the `tenant_not_found`/`no_matching_scenarios` early returns
  // above already cover the cases where it wouldn't).
  if (settled && vertical) {
    await verifyScenarioFields(
      sql,
      req.tenant_id,
      vertical,
      scenariosForVertical(vertical),
      results,
    );
  }

  const toolHealthRows = await sql<{ tool_name: string; cnt: number; success_cnt: number }>`
    select tool_name, count(*)::int as cnt, count(*) filter (where success)::int as success_cnt
    from public.tool_health
    where tenant_id = ${req.tenant_id} and occurred_at >= ${startedAt}
    group by tool_name
  `;
  const callLogsRows = await sql<{ cnt: number }>`
    select count(*)::int as cnt from public.call_logs
    where tenant_id = ${req.tenant_id} and created_at >= ${startedAt}
  `;

  const byTool = toolHealthRows.map((r) => ({
    tool_name: r.tool_name,
    count: r.cnt,
    success_count: r.success_cnt,
  }));

  return {
    status: 200,
    body: {
      tenant_id: req.tenant_id,
      batch_job_id: batchJobId,
      settled,
      started_at: startedAt,
      results,
      ...(settled
        ? {}
        : {
            resume: {
              batch_job_id: batchJobId,
              case_definitions: caseDefinitions,
              started_at: startedAt,
            },
          }),
      tool_health: { total: byTool.reduce((sum, t) => sum + t.count, 0), by_tool: byTool },
      call_logs_count: callLogsRows[0]?.cnt ?? 0,
    },
  };
}
