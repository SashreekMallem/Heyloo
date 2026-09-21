import {
  computeCurrentDateContext,
  computeUpcomingWeekdayDates,
} from "../_shared/business-hours.ts";
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
// CALL-7: same cross-function-folder import pattern already established by
// `worker-tick/handler.ts` (imports from `../worker-adapter-push/handler.ts`
// etc.) and `job-reconciliation/handler.ts` (imports `../voice-events/
// handler.ts`) — reused here rather than duplicated, for the SAME reason:
// `resolveVerticalDynamicVariables` is the one place every per-vertical
// `{{token}}` a compiled prompt can reference (rate_table, species_treated,
// practice_areas, menu_text, ...) gets resolved with a safe, non-
// hallucinated default. A real inbound call always gets these via
// `/voice-inbound`; a Retell batch-test session never goes through
// `/voice-inbound` at all (CALL-2's own documented finding), and until this
// fix this function only ever set `current_date`/`current_weekday`/
// `upcoming_weekday_dates`/`heyloo_tenant_id` — every OTHER token a
// vertical's prompt references (e.g. motel's "quote the nightly rate
// strictly from {{rate_table}}", vet's emergency-referral name/phone, legal's
// consult-fee text) was left as a literal unresolved dynamic variable on
// every batch-test run, for every vertical, since CALL-1. Auto/dental's
// prompts don't lean on these tokens for pass/fail as heavily as this task's
// new vet/legal/motel/restaurant scenarios do (rate quotes, emergency
// referrals, consult fees) — this surfaced now, not before.
import { resolveVerticalDynamicVariables } from "../voice-inbound/dynamic-variables.ts";

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
  startedAt: string,
): Promise<{ found: boolean; args: Record<string, unknown> }> {
  const phone = scenario.expectedPhone;
  if (!phone) return { found: false, args: {} };

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
      where b.tenant_id = ${tenantId} and c.phone_e164 = ${phone} and b.created_at >= ${startedAt}
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
      where o.tenant_id = ${tenantId} and c.phone_e164 = ${phone} and o.created_at >= ${startedAt}
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
  startedAt: string,
  results: ScenarioResult[],
): Promise<void> {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  for (const result of results) {
    const scenario = byId.get(result.case_id);
    if (!scenario || scenario.writeIntent === "none") continue;
    if (result.status !== "pass" && result.status !== "fail") continue; // pending/in_progress/error: nothing settled to check
    const { found, args } = await fetchScenarioIntakeArgs(sql, tenantId, scenario, startedAt);
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
    const tenantRows = await sql<{ vertical: Vertical; timezone: string; business_name: string }>`
      select vertical, timezone, name as business_name from public.tenants where id = ${req.tenant_id}
    `;
    const tenant = tenantRows[0];
    if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };
    vertical = tenant.vertical;

    const configRows = await sql<{
      compiled_config: Record<string, unknown> | null;
      assistant_name: string | null;
      dynamic_variable_overrides: Record<string, unknown> | null;
    }>`
      select compiled_config, assistant_name, dynamic_variable_overrides
      from public.agent_configs where tenant_id = ${req.tenant_id}
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
    const currentDateContext = computeCurrentDateContext(now(), tenant.timezone);
    const upcomingWeekdayDates = computeUpcomingWeekdayDates(now(), tenant.timezone);
    // CALL-7: the same per-vertical token resolution `/voice-inbound`
    // already applies for a real call (see this file's own import comment
    // above) — a test tenant has no `dynamic_variable_overrides` configured,
    // so every token resolves to its safe built-in default (e.g. vet's
    // species_treated -> "cats and dogs", motel's rate_table -> an explicit
    // "no rates on file" string), never a literal unresolved `{{token}}`.
    const overrides = configRows[0]?.dynamic_variable_overrides ?? {};
    const verticalTokens = await resolveVerticalDynamicVariables({
      sql,
      tenantId: req.tenant_id,
      vertical: tenant.vertical,
      overrides,
      logger: deps.logger,
    });
    caseDefinitions = [];
    for (const scenario of scenarios) {
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
          // CALL-2: a batch test never goes through `/voice-inbound` (no
          // `call_inbound` webhook fires for a simulated run), so the
          // model has no `current_date`/`current_weekday` either —
          // confirmed live this produced `check_availability` calls
          // years off the real generated `availability_slots` window,
          // which the model then hallucinated a booking confirmation for
          // instead of honestly reporting `none_available`.
          current_date: currentDateContext.date,
          current_weekday: currentDateContext.weekday,
          // CALL-6 (docs/BUILD_NOTES.md) — the `wrong_date_caller`
          // scenario's own finding: the model still gets weekday-name
          // arithmetic ("next Monday") wrong even with current_date/
          // current_weekday alone. A precomputed lookup removes the need
          // for the model to compute it itself.
          upcoming_weekday_dates: upcomingWeekdayDates,
          timezone: tenant.timezone,
          business_name: tenant.business_name,
          assistant_name: configRows[0]?.assistant_name ?? "the AI assistant",
          // CALL-7: see this file's own import comment — every remaining
          // per-vertical `{{token}}` a compiled prompt may reference.
          ...verticalTokens,
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
      startedAt,
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
