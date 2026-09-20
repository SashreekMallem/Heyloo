import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createBatchTest,
  createChat,
  createChatCompletion,
  createTestCaseDefinition,
  listTestRuns,
} from "../_shared/providers/retell.ts";
import { scenariosForVertical } from "../_shared/test-scenarios.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";

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

export interface ScenarioResult {
  case_id: string;
  label: string;
  status: "pending" | "in_progress" | "pass" | "fail" | "error";
  result_explanation: string | null;
  transcript_snapshot_present: boolean;
  /** Truncated JSON dump of the raw `transcript_snapshot` for manual
   * inspection — this wrapper does not parse it (packages/adapters/retell/
   * src/tests-api.ts's own VERIFY-13 note: the SDK types this field
   * `unknown` by design and no fetched doc page shows a worked example). */
  transcript_preview: string | null;
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
  body: RunAgentTestsSuccessBody | ChatSmokeSuccessBody | { error: string };
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
              ? JSON.stringify(job.transcript_snapshot).slice(0, 1500)
              : null,
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
          ? JSON.stringify(job.transcript_snapshot).slice(0, 1500)
          : null,
    };
  });
  return { settled: true, results };
}

async function runChatSmoke(
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

  if (req.mode === "chat_smoke") return runChatSmoke(sql, req.tenant_id, deps);

  let batchJobId: string;
  let caseDefinitions: Array<{ case_id: string; definition_id: string }>;
  let startedAt: string;

  if (req.resume) {
    batchJobId = req.resume.batch_job_id;
    caseDefinitions = req.resume.case_definitions;
    startedAt = req.resume.started_at;
  } else {
    const tenantRows = await sql<{ vertical: Vertical }>`
      select vertical from public.tenants where id = ${req.tenant_id}
    `;
    const tenant = tenantRows[0];
    if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };

    const configRows = await sql<{ compiled_config: Record<string, unknown> | null }>`
      select compiled_config from public.agent_configs where tenant_id = ${req.tenant_id}
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
    caseDefinitions = [];
    for (const scenario of scenarios) {
      const created = await createTestCaseDefinition(deps.retellFetch, deps.retellApiKey, {
        name: `${tenant.vertical}:${scenario.id}`.slice(0, 200),
        response_engine: responseEngine,
        user_prompt: scenario.personaPrompt,
        metrics: ["Agent's responses stay relevant to what the simulated caller said."],
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
