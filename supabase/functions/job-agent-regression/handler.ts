import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `job-agent-regression` (NIGHTLY-1, docs/BUILD_PLAN.md): nightly regression
 * of the Retell batch-test suites (`api-admin-run-agent-tests`, owned by
 * CALL-1/CALL-8/CALL-9) against every seeded `test-*` tenant, one per
 * vertical, so an agent-behavior regression surfaces automatically instead
 * of only being noticed the next time a human runs a suite by hand.
 *
 * Deliberately calls `api-admin-run-agent-tests` over HTTP with its own
 * `x-internal-secret` (`PROVISION_INTERNAL_SECRET`) rather than importing
 * its `handler.ts` — that folder is owned by the concurrently-running
 * CALL-9 build task (this task's own instructions: "DO NOT edit their
 * files"), and the task brief itself names this as the alternative to
 * importing shared handler code ("call the shared handler code OR the
 * function with the internal secret from env"). This keeps the two build
 * tasks' files fully decoupled: a change CALL-9 makes to that function's
 * internals can never break this file at import/typecheck time, only (if
 * ever) at its documented HTTP response contract, which is versioned by
 * this file's own local `RunAgentTestsResponseBody` type below.
 *
 * Response contract mirrored here (NOT imported) from
 * `api-admin-run-agent-tests/handler.ts`'s own `RunAgentTestsSuccessBody`/
 * `ScenarioResult` types as of this task (NIGHTLY-1) — see that file for
 * the authoritative shape.
 */
export interface RegressionFieldCapture {
  write_intent: string;
  row_found: boolean;
  fields_required: string[];
  fields_captured: string[];
  fields_missing: string[];
}

export interface RegressionScenarioResult {
  case_id: string;
  label: string;
  status: "pending" | "in_progress" | "pass" | "fail" | "error";
  result_explanation: string | null;
  field_capture: RegressionFieldCapture | null;
}

export interface ResumeState {
  batch_job_id: string;
  case_definitions: Array<{ case_id: string; definition_id: string }>;
  started_at: string;
}

interface RunAgentTestsResponseBody {
  tenant_id: string;
  batch_job_id: string;
  settled: boolean;
  started_at: string;
  results: RegressionScenarioResult[];
  resume?: ResumeState;
}

function isRunAgentTestsResponseBody(body: unknown): body is RunAgentTestsResponseBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { batch_job_id?: unknown }).batch_job_id === "string" &&
    typeof (body as { settled?: unknown }).settled === "boolean" &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

export interface AgentRegressionDeps {
  fetchImpl: typeof fetch;
  /** `${SUPABASE_URL}/functions/v1` — same base every other internal
   * cross-function caller in this repo builds from (webhooks-stripe's own
   * `invoke-provisioning.ts`). */
  functionsBaseUrl: string;
  internalSecret: string;
  logger: Logger;
  now?: () => Date;
  /** Per-tenant wall-clock budget (ms) this invocation spends looping
   * resumable calls to `api-admin-run-agent-tests` before giving up and
   * recording `status: 'timeout'`. Tenants run CONCURRENTLY (`Promise.all`
   * in `runAgentRegression` below), so this is not additive across
   * tenants — it bounds this function's OWN background-task wall clock,
   * which must stay comfortably under `EdgeRuntime.waitUntil`'s documented
   * cap (paid-plan 400s / free-plan 150s, `_shared/deno/background.ts`).
   * Default picked conservatively under the free-plan floor. */
  perTenantBudgetMs?: number;
  /** Delay (ms) between resumed polling calls, so a tenant whose batch
   * hasn't settled yet doesn't hammer `api-admin-run-agent-tests` in a
   * tight loop. Each call already internally polls Retell for its own
   * ~45s budget (that function's own `pollBudgetMs` default) before
   * returning `settled: false`, so this is a small extra pause on top,
   * not the main throttle. */
  resumeDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RegressionTenant {
  id: string;
  slug: string;
  vertical: string;
}

async function callRunAgentTests(
  deps: AgentRegressionDeps,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: RunAgentTestsResponseBody | { error: string } }> {
  try {
    const res = await deps.fetchImpl(`${deps.functionsBaseUrl}/api-admin-run-agent-tests`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": deps.internalSecret },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({ error: "invalid_json_response" }))) as unknown;
    if (isRunAgentTestsResponseBody(json)) {
      return { ok: res.ok, status: res.status, body: json };
    }
    return {
      ok: false,
      status: res.status,
      body:
        typeof json === "object" && json !== null && "error" in json
          ? (json as { error: string })
          : { error: "unexpected_response_shape" },
    };
  } catch (err) {
    return { ok: false, status: 0, body: { error: `fetch_failed: ${String(err)}` } };
  }
}

/** `scenarios_passed / scenarios_total < 5/6` — the task brief's own
 * threshold ("any suite below 5/6"), expressed as a ratio so it applies
 * regardless of a vertical's exact scenario count (verticals here range
 * 6-9 scenarios, `_shared/test-scenarios.ts`). */
const PASS_RATIO_THRESHOLD = 5 / 6;

export interface RegressionOutcome {
  status: "complete" | "timeout" | "error";
  scenarios_total: number | null;
  scenarios_passed: number | null;
  field_capture_ok: boolean | null;
  failures: Array<Record<string, unknown>>;
  retell_batch_test_id: string | null;
  resume_state: ResumeState | null;
}

function summarize(
  results: RegressionScenarioResult[],
  batchJobId: string,
  status: "complete" | "timeout",
  resumeState: ResumeState | null,
): RegressionOutcome {
  const scenariosTotal = results.length;
  const scenariosPassed = results.filter((r) => r.status === "pass").length;
  const fieldCaptureEntries = results.filter((r) => r.field_capture !== null);
  const fieldCaptureOk =
    fieldCaptureEntries.length === 0
      ? true
      : fieldCaptureEntries.every((r) => (r.field_capture?.fields_missing.length ?? 0) === 0);
  const failures = results
    .filter(
      (r) =>
        r.status !== "pass" ||
        (r.field_capture !== null && r.field_capture.fields_missing.length > 0),
    )
    .map((r) => ({
      case_id: r.case_id,
      label: r.label,
      status: r.status,
      result_explanation: r.result_explanation,
      field_capture: r.field_capture,
    }));
  return {
    status,
    scenarios_total: scenariosTotal,
    scenarios_passed: scenariosPassed,
    field_capture_ok: fieldCaptureOk,
    failures,
    retell_batch_test_id: batchJobId,
    resume_state: status === "timeout" ? resumeState : null,
  };
}

/** Runs one tenant's suite to settlement (or until `perTenantBudgetMs`
 * elapses) by chaining resumable calls to `api-admin-run-agent-tests`,
 * exactly the loop that function's own doc comment describes a resuming
 * caller doing. */
async function runToSettlement(
  deps: AgentRegressionDeps,
  tenantId: string,
  deadline: number,
): Promise<RegressionOutcome> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const resumeDelayMs = deps.resumeDelayMs ?? 2000;

  let resume: ResumeState | undefined;
  for (;;) {
    const call = await callRunAgentTests(
      deps,
      resume ? { tenant_id: tenantId, resume } : { tenant_id: tenantId, mode: "batch" },
    );
    if (!call.ok || "error" in call.body) {
      const errorBody = call.body as { error: string };
      deps.logger.error("job_agent_regression_call_failed", {
        tenant_id: tenantId,
        status: call.status,
        error: errorBody.error,
      });
      return {
        status: "error",
        scenarios_total: null,
        scenarios_passed: null,
        field_capture_ok: null,
        failures: [{ error: errorBody.error }],
        retell_batch_test_id: resume?.batch_job_id ?? null,
        resume_state: null,
      };
    }

    const body = call.body;
    if (body.settled) {
      return summarize(body.results, body.batch_job_id, "complete", null);
    }
    if (!body.resume || Date.now() >= deadline) {
      return summarize(
        body.results,
        body.batch_job_id,
        "timeout",
        body.resume ?? {
          batch_job_id: body.batch_job_id,
          case_definitions: [],
          started_at: body.started_at,
        },
      );
    }
    resume = body.resume;
    await sleep(resumeDelayMs);
  }
}

async function runTenantRegression(
  sql: SqlClient,
  deps: AgentRegressionDeps,
  tenant: RegressionTenant,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const budgetMs = deps.perTenantBudgetMs ?? 110_000;
  const deadline = Date.now() + budgetMs;

  const inserted = await sql<{ id: string }>`
    insert into public.agent_regression_runs (tenant_id, vertical, started_at, status)
    values (${tenant.id}, ${tenant.vertical}, ${startedAt}, 'running')
    returning id
  `;
  const runId = inserted[0]?.id;
  if (!runId) {
    deps.logger.error("job_agent_regression_insert_failed", { tenant_id: tenant.id });
    return;
  }

  const outcome = await runToSettlement(deps, tenant.id, deadline);

  await sql`
    update public.agent_regression_runs
    set finished_at = now(),
        status = ${outcome.status},
        scenarios_total = ${outcome.scenarios_total},
        scenarios_passed = ${outcome.scenarios_passed},
        field_capture_ok = ${outcome.field_capture_ok},
        failures = ${JSON.stringify(outcome.failures)}::jsonb,
        retell_batch_test_id = ${outcome.retell_batch_test_id},
        resume_state = ${outcome.resume_state ? JSON.stringify(outcome.resume_state) : null}::jsonb
    where id = ${runId}
  `;

  const isRegression =
    outcome.status === "error" ||
    outcome.status === "timeout" ||
    outcome.field_capture_ok === false ||
    (outcome.scenarios_total !== null &&
      outcome.scenarios_passed !== null &&
      outcome.scenarios_total > 0 &&
      outcome.scenarios_passed / outcome.scenarios_total < PASS_RATIO_THRESHOLD);

  if (isRegression) {
    const rule =
      outcome.status === "error"
        ? "agent_regression_error"
        : outcome.status === "timeout"
          ? "agent_regression_timeout"
          : "agent_regression_failure";
    await sql`
      insert into public.alerts (rule, severity, tenant_id, payload, status)
      select ${rule}, 'critical', ${tenant.id}, ${JSON.stringify({
        vertical: tenant.vertical,
        tenant_slug: tenant.slug,
        run_id: runId,
        scenarios_total: outcome.scenarios_total,
        scenarios_passed: outcome.scenarios_passed,
        field_capture_ok: outcome.field_capture_ok,
        failures: outcome.failures.slice(0, 20),
      })}::jsonb, 'open'
      where not exists (
        select 1 from public.alerts a
        where a.rule = ${rule}
          and a.status = 'open'
          and a.tenant_id = ${tenant.id}
          and a.created_at > now() - interval '20 hours'
      )
    `;
  }

  deps.logger.info("job_agent_regression_tenant_complete", {
    tenant_id: tenant.id,
    vertical: tenant.vertical,
    status: outcome.status,
    scenarios_total: outcome.scenarios_total,
    scenarios_passed: outcome.scenarios_passed,
    field_capture_ok: outcome.field_capture_ok,
    is_regression: isRegression,
  });
}

export interface RunAgentRegressionResult {
  tenant_count: number;
  tenants: string[];
}

/** Entry point — finds every `test-*` tenant (8 as of NIGHTLY-1, one per
 * vertical) and runs its suite CONCURRENTLY (never sequentially: 8
 * sequential multi-minute suites would blow well past any Edge Function
 * background-task budget; 8 concurrent ones share the same wall clock as
 * the single slowest suite). Called from `index.ts` inside
 * `runInBackground`/`EdgeRuntime.waitUntil` — the HTTP response to pg_cron
 * has already been sent by the time this runs (CLAUDE.md Rule 2's
 * fast-ack pattern), so nothing here needs to race the 20s
 * `net.http_post` `timeout_milliseconds` the cron migration sets. */
export async function runAgentRegression(
  sql: SqlClient,
  deps: AgentRegressionDeps,
): Promise<RunAgentRegressionResult> {
  const tenants = await sql<RegressionTenant>`
    select id, slug, vertical from public.tenants
    where slug like 'test-%' and deleted_at is null
    order by slug
  `;
  await Promise.all(tenants.map((t) => runTenantRegression(sql, deps, t)));
  return { tenant_count: tenants.length, tenants: tenants.map((t) => t.slug) };
}
