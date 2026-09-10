/**
 * Retell's `Tests` (batch-simulation) API — the provider-side wrapper
 * `docs/audit/FIX_REQUESTS.md` and `docs/VERIFY.md` VERIFY-13 requested for
 * `packages/templates/src/red-team/run-simulation.ts`'s harness. Wraps
 * `POST /create-test-case-definition`, `POST /create-batch-test`, and
 * `GET /v2/list-test-runs/{id}` (real REST paths confirmed from the
 * officially-published `retell-sdk` npm package's generated
 * `resources/tests.js`/`tests.d.ts`, cross-checked against
 * `docs.retellai.com`'s own API reference pages this pass — see VERIFY-13)
 * via this package's hand-rolled `RetellClient` (`client.ts`) rather than
 * the `retell-sdk` package itself, matching this package's existing
 * convention (`raw-types.ts`'s header, `sdk-contract.test.ts`): `retell-sdk`
 * stays a devDependency used only for compile-time shape verification,
 * never a runtime import.
 *
 * `createRetellBatchSimulationClient` is exported from `./index.ts` for
 * `packages/templates/src/red-team/run-simulation.ts`'s `loadRealClient` to
 * dynamic-`import()` at runtime (never a static `@heyloo/templates` import
 * FROM this package — that would recreate the exact circular package
 * dependency `registry-consistency.test.ts`'s own header documents
 * resolving the other direction: `@heyloo/templates` already depends on
 * `@heyloo/adapter-retell`, via `compiler-gate.test.ts`'s public
 * `RetellProvider.compileTemplate`). Because of that, the
 * `BatchSimulationClient`/`SimulationTestCase`/`SimulationTranscript`/
 * `RecordedToolCall` interfaces below are a STRUCTURAL, hand-duplicated
 * copy of `packages/templates/src/red-team/simulation-types.ts`'s
 * identically-named exports — TypeScript's structural typing plus
 * `run-simulation.ts`'s own `as (opts) => BatchSimulationClient` cast at
 * the dynamic-import boundary means no import edge is ever needed for this
 * to type-check and run correctly on the calling side. Keep these two
 * declarations in sync by hand if either shape changes.
 *
 * VERIFY-13 (docs/VERIFY.md) is only PARTIALLY resolved by this file: every
 * REST request shape below was confirmed against official sources (the SDK
 * source plus this pass's live `docs.retellai.com` fetches). The ONE piece
 * that remains genuinely unconfirmed is `transcript_snapshot`'s internal
 * field names — the SDK types it `unknown` on purpose ("Can be either
 * ConversationFlowPlaygroundSnapshot or RetellLlmPlaygroundSnapshot") and no
 * reachable documentation shows an example payload. `normalizeTranscriptSnapshot`
 * below is written against the closest OFFICIALLY-DOCUMENTED sibling shape
 * this same SDK uses for an almost identical purpose — the `Call` resource's
 * `transcript_with_tool_calls` discriminated union (`resources/call.d.ts`,
 * confirmed: `Utterance | ToolCallInvocationUtterance |
 * ToolCallResultUtterance | NodeTransitionUtterance | ...`) — behind a
 * runtime Zod boundary that FAILS LOUDLY (never fabricates a pass, CLAUDE.md
 * Rule 2's fail-closed posture) if a real `transcript_snapshot` doesn't
 * match. Per CLAUDE.md Rule 1 item 2, this remains logged as unconfirmed in
 * `docs/VERIFY.md` VERIFY-13 until a live Retell staging account run is
 * inspected and, if needed, this parser is updated against the real
 * payload.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import { RetellClient } from "./client.js";

// ---------------------------------------------------------------------------
// Provider-agnostic seam — structurally mirrors
// packages/templates/src/red-team/simulation-types.ts (see file header for
// why this is a hand-kept copy, not an import).
// ---------------------------------------------------------------------------

export interface RecordedToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface SimulationTranscript {
  readonly reachedStates: readonly string[];
  readonly toolCalls: readonly RecordedToolCall[];
  readonly firstAgentUtterance?: string;
  readonly agentUtterances?: readonly string[];
}

export interface SimulationTestCase {
  readonly id: string;
  readonly personaPrompt: string;
}

export interface BatchSimulationClient {
  readonly providerName: string;
  runScenarios(
    templateKey: string,
    responseEngineRef: string,
    cases: readonly SimulationTestCase[],
  ): Promise<ReadonlyMap<string, SimulationTranscript>>;
}

// ---------------------------------------------------------------------------
// `responseEngineRef` encoding — this wrapper's OWN convention (not
// Retell's): `runHarness` (run-simulation.ts) passes it through opaquely, so
// it just needs to round-trip a Retell `response_engine` reference. Encoded
// as JSON (via `encodeResponseEngineRef`) rather than a delimited string so
// there's no ambiguity parsing a `conversation_flow_id`/`llm_id` that could
// itself contain the delimiter.
// ---------------------------------------------------------------------------

const zResponseEngineRef = z.union([
  z.object({
    type: z.literal("conversation-flow"),
    conversation_flow_id: z.string().min(1),
    version: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("retell-llm"),
    llm_id: z.string().min(1),
    version: z.number().int().optional(),
  }),
]);
export type RetellResponseEngineRef = z.infer<typeof zResponseEngineRef>;

/** Builds the opaque `responseEngineRef` string `BatchSimulationClient.runScenarios` expects. */
export function encodeResponseEngineRef(ref: RetellResponseEngineRef): string {
  return JSON.stringify(zResponseEngineRef.parse(ref));
}

function decodeResponseEngineRef(raw: string): RetellResponseEngineRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new VoiceProviderError(
      "createRetellBatchSimulationClient: responseEngineRef is not valid JSON — expected the " +
        `output of encodeResponseEngineRef() (this wrapper's own convention, see tests-api.ts). Got: ${raw.slice(0, 200)}`,
      { code: "validation", provider: "retell", retryable: false, cause },
    );
  }
  const result = zResponseEngineRef.safeParse(parsed);
  if (!result.success) {
    throw new VoiceProviderError(
      `createRetellBatchSimulationClient: responseEngineRef failed validation: ${result.error.message}`,
      { code: "validation", provider: "retell", retryable: false },
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// REST response shapes — confirmed against `retell-sdk@5.64.0`'s
// `resources/tests.d.ts` and this pass's live `docs.retellai.com` fetches
// (VERIFY-13). `.looseObject` throughout: defense against an added field,
// never a removed/renamed one this code reads.
// ---------------------------------------------------------------------------

const zTestCaseDefinitionResponse = z.looseObject({
  test_case_definition_id: z.string().min(1),
});

const zBatchTestResponse = z.looseObject({
  test_case_batch_job_id: z.string().min(1),
  status: z.enum(["in_progress", "complete"]),
});

const zTestCaseJobStatus = z.enum(["pending", "in_progress", "pass", "fail", "error"]);

const zTestCaseJob = z.looseObject({
  test_case_job_id: z.string().min(1),
  status: zTestCaseJobStatus,
  test_case_definition_id: z.string().min(1),
  result_explanation: z.string().nullable().optional(),
  transcript_snapshot: z.unknown().nullable().optional(),
});

const zListTestRunsResponse = z.looseObject({
  has_more: z.boolean().optional(),
  pagination_key: z.string().optional(),
  items: z.array(zTestCaseJob).optional(),
});

// ---------------------------------------------------------------------------
// `transcript_snapshot` normalizer — see file header's VERIFY-13 note.
// ---------------------------------------------------------------------------

const zTranscriptTurn = z.union([
  z.looseObject({ role: z.enum(["agent", "user", "transfer_target"]), content: z.string() }),
  z.looseObject({
    role: z.literal("tool_call_invocation"),
    name: z.string().min(1),
    arguments: z.string(),
  }),
  z.looseObject({ role: z.literal("tool_call_result"), content: z.string() }),
  z.looseObject({
    role: z.literal("node_transition"),
    new_node_id: z.string().min(1),
  }),
  z.looseObject({ role: z.literal("dtmf"), digit: z.string() }),
  z.looseObject({ role: z.literal("sms"), content: z.string() }),
  z.looseObject({ role: z.literal("injected"), content: z.string() }),
]);

/**
 * Candidate top-level keys a `transcript_snapshot` object's turn array might
 * live under — `transcript_with_tool_calls`/`transcript_object` are the
 * SDK's own confirmed names for this exact concept on the sibling `Call`
 * resource (VERIFY-13); `turns`/`transcript` are defensive fallbacks. The
 * first one present wins; none present is a loud, actionable error, never a
 * silent empty transcript (CLAUDE.md Rule 2 fail-closed posture — an empty
 * transcript would make every `tool_not_called`/`state_not_reached`
 * assertion spuriously PASS).
 */
const TRANSCRIPT_ARRAY_CANDIDATE_KEYS = [
  "transcript_with_tool_calls",
  "transcript_object",
  "turns",
  "transcript",
] as const;

function unconfirmedShapeError(caseId: string, detail: string): VoiceProviderError {
  return new VoiceProviderError(
    `createRetellBatchSimulationClient: case '${caseId}' transcript_snapshot ${detail} This wrapper's ` +
      "transcript_snapshot shape is UNCONFIRMED against a live Retell account (docs/VERIFY.md VERIFY-13) — " +
      "capture one real payload and update the parser in packages/adapters/retell/src/tests-api.ts before " +
      "trusting a green run.",
    { code: "unknown", provider: "retell", retryable: false },
  );
}

function normalizeTranscriptSnapshot(raw: unknown, caseId: string): SimulationTranscript {
  if (raw === null || raw === undefined) {
    throw unconfirmedShapeError(
      caseId,
      "is null/absent, but the case resolved pass/fail — cannot grade.",
    );
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw unconfirmedShapeError(
      caseId,
      `is not an object (got ${Array.isArray(raw) ? "array" : typeof raw}).`,
    );
  }

  const snapshot = raw as Record<string, unknown>;
  let turnsArray: unknown[] | undefined;
  for (const key of TRANSCRIPT_ARRAY_CANDIDATE_KEYS) {
    const value = snapshot[key];
    if (Array.isArray(value)) {
      turnsArray = value;
      break;
    }
  }
  if (!turnsArray) {
    throw unconfirmedShapeError(
      caseId,
      `has none of the expected turn-array keys (${TRANSCRIPT_ARRAY_CANDIDATE_KEYS.join(", ")}) — keys found: ${Object.keys(snapshot).join(", ") || "(none)"}.`,
    );
  }

  const reachedStates: string[] = [];
  const toolCalls: RecordedToolCall[] = [];
  const agentUtterances: string[] = [];

  for (const rawTurn of turnsArray) {
    const parsed = zTranscriptTurn.safeParse(rawTurn);
    if (!parsed.success) {
      throw unconfirmedShapeError(
        caseId,
        `contains a turn matching none of the known role shapes: ${JSON.stringify(rawTurn).slice(0, 300)}.`,
      );
    }
    const turn = parsed.data;
    if (turn.role === "agent") {
      agentUtterances.push(turn.content);
    } else if (turn.role === "tool_call_invocation") {
      let args: Record<string, unknown> = {};
      try {
        const decoded: unknown = JSON.parse(turn.arguments);
        if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
          args = decoded as Record<string, unknown>;
        }
      } catch {
        // `arguments` is documented as "a stringified JSON object" — a call that violates that
        // shouldn't crash grading; toolCalled()'s withFields check simply won't find its fields.
      }
      toolCalls.push({ name: turn.name, arguments: args });
    } else if (turn.role === "node_transition") {
      reachedStates.push(turn.new_node_id);
    }
  }

  return {
    reachedStates,
    toolCalls,
    ...(agentUtterances.length > 0
      ? { firstAgentUtterance: agentUtterances[0], agentUtterances }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The client itself.
// ---------------------------------------------------------------------------

export interface CreateRetellBatchSimulationClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Delay between `list-test-runs` polls while any case is pending/in_progress (default 5s). */
  readonly pollIntervalMs?: number;
  /** Total time budget for every case in one `runScenarios` call to settle (default 10 minutes). */
  readonly pollTimeoutMs?: number;
  /** Injectable for tests — forwarded to the underlying `RetellClient`; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable poll-wait for deterministic tests; defaults to a real `setTimeout`-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Real Retell-backed `BatchSimulationClient` — submits every `cases` entry
 * as its own `TestCaseDefinition` against `responseEngineRef` (a STAGING
 * `conversation_flow_id`/`llm_id`, SYSTEM_DESIGN §8 G16 — never prod),
 * batches them into one `createBatchTest` job, and polls `list-test-runs`
 * until every case leaves `pending`/`in_progress`.
 */
export function createRetellBatchSimulationClient(
  options: CreateRetellBatchSimulationClientOptions,
): BatchSimulationClient {
  const client = new RetellClient({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 10 * 60 * 1_000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    providerName: "retell",

    async runScenarios(templateKey, responseEngineRef, cases) {
      if (cases.length === 0) return new Map();
      const engine = decodeResponseEngineRef(responseEngineRef);

      // 1. One createTestCaseDefinition per case (Retell has no bulk-create endpoint).
      const caseIdByDefinitionId = new Map<string, string>();
      for (const testCase of cases) {
        const body = {
          name: `${templateKey}:${testCase.id}`.slice(0, 200),
          response_engine: engine,
          user_prompt: testCase.personaPrompt,
          // This harness grades transcripts itself (gradeTranscript, @heyloo/templates) — it never
          // relies on Retell's own LLM-judged metric verdict for pass/fail, so this is a fixed,
          // harmless placeholder rather than a per-scenario metric (FIX_REQUESTS.md's own sketch).
          metrics: ["Agent's responses stay relevant to what the simulated caller said."],
        };
        const created = await client.request<unknown>("POST", "/create-test-case-definition", body);
        const parsed = zTestCaseDefinitionResponse.safeParse(created);
        if (!parsed.success) {
          throw new VoiceProviderError(
            `createRetellBatchSimulationClient: create-test-case-definition response failed validation ` +
              `for case '${testCase.id}': ${parsed.error.message}`,
            { code: "unknown", provider: "retell", retryable: false },
          );
        }
        caseIdByDefinitionId.set(parsed.data.test_case_definition_id, testCase.id);
      }

      // 2. One createBatchTest with every definition id from step 1.
      const batchCreated = await client.request<unknown>("POST", "/create-batch-test", {
        response_engine: engine,
        test_case_definition_ids: [...caseIdByDefinitionId.keys()],
      });
      const parsedBatch = zBatchTestResponse.safeParse(batchCreated);
      if (!parsedBatch.success) {
        throw new VoiceProviderError(
          `createRetellBatchSimulationClient: create-batch-test response failed validation: ${parsedBatch.error.message}`,
          { code: "unknown", provider: "retell", retryable: false },
        );
      }
      const batchJobId = parsedBatch.data.test_case_batch_job_id;

      // 3. Poll list-test-runs until every submitted case has left pending/in_progress.
      const deadline = Date.now() + pollTimeoutMs;
      const results = new Map<string, SimulationTranscript>();
      const settledCaseIds = new Set<string>();

      while (settledCaseIds.size < caseIdByDefinitionId.size) {
        const listed = await client.request<unknown>(
          "GET",
          `/v2/list-test-runs/${encodeURIComponent(batchJobId)}?limit=1000`,
        );
        const parsedList = zListTestRunsResponse.safeParse(listed);
        if (!parsedList.success) {
          throw new VoiceProviderError(
            `createRetellBatchSimulationClient: list-test-runs response failed validation for batch ` +
              `'${batchJobId}': ${parsedList.error.message}`,
            { code: "unknown", provider: "retell", retryable: false },
          );
        }

        for (const job of parsedList.data.items ?? []) {
          const caseId = caseIdByDefinitionId.get(job.test_case_definition_id);
          if (!caseId || settledCaseIds.has(caseId)) continue;
          if (job.status === "pending" || job.status === "in_progress") continue;

          settledCaseIds.add(caseId);
          if (job.status === "error") {
            throw new VoiceProviderError(
              `createRetellBatchSimulationClient: case '${caseId}' errored during simulation` +
                (job.result_explanation ? `: ${job.result_explanation}` : ""),
              { code: "unknown", provider: "retell", retryable: false },
            );
          }
          results.set(caseId, normalizeTranscriptSnapshot(job.transcript_snapshot, caseId));
        }

        if (settledCaseIds.size >= caseIdByDefinitionId.size) break;
        if (Date.now() > deadline) {
          throw new VoiceProviderError(
            `createRetellBatchSimulationClient: batch '${batchJobId}' did not settle within ${pollTimeoutMs}ms ` +
              `(${settledCaseIds.size}/${caseIdByDefinitionId.size} case(s) resolved)`,
            { code: "timeout", provider: "retell", retryable: true },
          );
        }
        await sleep(pollIntervalMs);
      }

      return results;
    },
  };
}
