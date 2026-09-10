/**
 * The programmatic grading vocabulary for the batch-simulation harness
 * (`run-simulation.ts`, `grader.ts`) plus the provider-agnostic seam a real
 * voice-simulation backend plugs into.
 *
 * Every `SimulationAssertion` describes something checkable mechanically
 * against a recorded call transcript/tool-call trace — never prose a human
 * has to read and judge. This is the fix for the gap the audit named:
 * `SimulationScenario`/`InjectionFixture`'s `expectation` field (still kept,
 * for human-readable docs) used to be the ONLY thing describing what a
 * scenario proves; nothing graded it. Every scenario/fixture now also
 * carries a `expect(template)` that returns one of these, checked by
 * `gradeTranscript` (`grader.ts`) against a REAL `SimulationTranscript`.
 *
 * `BatchSimulationClient` is the seam a real provider backend implements —
 * deliberately NOT importing `retell-sdk` or any Retell-shaped request/
 * response type here (CLAUDE.md Rule 2: provider SDKs and provider-specific
 * payload shapes stay inside `packages/adapters/*`). The real Retell-backed
 * implementation belongs in `packages/adapters/retell` (a wrapper over its
 * `client.tests` resource — `createTestCaseDefinition`/`createBatchTest`/
 * `getTestRun`, confirmed against the official `retell-sdk` npm package's
 * own `resources/tests.d.ts`, CLAUDE.md Rule 1) — filed as a cross-cluster
 * request in `docs/audit/FIX_REQUESTS.md` since that package is outside
 * this cluster's file ownership. `run-simulation.ts` fails closed (throws,
 * never fabricates a pass) when no real client is wired, matching CLAUDE.md
 * Rule 2's webhook posture: "missing secret/capability = reject, never
 * skip."
 */

// ---------------------------------------------------------------------------
// Recorded call output — what a real (or test-double) simulation backend
// hands back for one submitted test case.
// ---------------------------------------------------------------------------

export interface RecordedToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface SimulationTranscript {
  /** Canonical `AgentState.id`s the call actually visited, in order, if derivable from the run. */
  readonly reachedStates: readonly string[];
  readonly toolCalls: readonly RecordedToolCall[];
  /** The agent's very first spoken turn — for checking the compiled-in disclosure line actually led. */
  readonly firstAgentUtterance?: string;
  /** Every agent-spoken turn, in order — for a substring scan across the whole call. */
  readonly agentUtterances?: readonly string[];
}

// ---------------------------------------------------------------------------
// Assertions — the structured, machine-gradable replacement for prose
// `expectation` matching.
// ---------------------------------------------------------------------------

export type SimulationAssertion =
  | {
      readonly kind: "tool_called";
      readonly tool: string;
      readonly withFields?: readonly string[];
      readonly withoutFields?: readonly string[];
    }
  | { readonly kind: "tool_not_called"; readonly tool: string }
  | { readonly kind: "tool_called_with_zero_params"; readonly tool: string }
  | { readonly kind: "state_reached"; readonly state: string }
  | { readonly kind: "state_not_reached"; readonly state: string }
  | { readonly kind: "first_utterance_contains"; readonly text: string }
  | { readonly kind: "agent_never_says"; readonly text: string }
  | { readonly kind: "no_forbidden_fields"; readonly fields: readonly string[] }
  | { readonly kind: "all"; readonly of: readonly SimulationAssertion[] }
  | { readonly kind: "any"; readonly of: readonly SimulationAssertion[] }
  /**
   * Escape hatch for the one register scenario (`silence_voicemail`) whose
   * guarantee is about spoken-response PACING (a nudge after ~2s, a second
   * after 5-7s, a 10-12s wait before wrapping up) — no signal our
   * `SimulationTranscript` carries (utterance text + tool calls, no
   * per-turn timestamps) can grade that mechanically. The harness still
   * submits and records the scenario (worth a human's read), but reports it
   * as `needs_review`, never a fabricated pass or an unfair fail.
   */
  | { readonly kind: "manual_review"; readonly reason: string };

export interface GradeResult {
  readonly pass: boolean;
  readonly needsReview: boolean;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Assertion builders — kept terse so `simulation-scenarios.ts`/
// `injection-fixtures.ts` stay readable.
// ---------------------------------------------------------------------------

export function toolCalled(
  tool: string,
  opts?: { readonly withFields?: readonly string[]; readonly withoutFields?: readonly string[] },
): SimulationAssertion {
  return {
    kind: "tool_called",
    tool,
    ...(opts?.withFields ? { withFields: opts.withFields } : {}),
    ...(opts?.withoutFields ? { withoutFields: opts.withoutFields } : {}),
  };
}

export function toolNotCalled(tool: string): SimulationAssertion {
  return { kind: "tool_not_called", tool };
}

export function toolCalledWithZeroParams(tool: string): SimulationAssertion {
  return { kind: "tool_called_with_zero_params", tool };
}

export function stateReached(state: string): SimulationAssertion {
  return { kind: "state_reached", state };
}

export function stateNotReached(state: string): SimulationAssertion {
  return { kind: "state_not_reached", state };
}

export function firstUtteranceContains(text: string): SimulationAssertion {
  return { kind: "first_utterance_contains", text };
}

export function agentNeverSays(text: string): SimulationAssertion {
  return { kind: "agent_never_says", text };
}

export function noForbiddenFields(fields: readonly string[]): SimulationAssertion {
  return { kind: "no_forbidden_fields", fields };
}

export function allOf(...of: readonly SimulationAssertion[]): SimulationAssertion {
  return { kind: "all", of };
}

export function anyOf(...of: readonly SimulationAssertion[]): SimulationAssertion {
  return { kind: "any", of };
}

export function manualReview(reason: string): SimulationAssertion {
  return { kind: "manual_review", reason };
}

// ---------------------------------------------------------------------------
// The provider-agnostic seam a real batch-simulation backend implements.
// ---------------------------------------------------------------------------

export interface SimulationTestCase {
  /** Correlates a submitted case back to its result — unique within one `runScenarios` call. */
  readonly id: string;
  /**
   * A PERSONA prompt describing what the simulated caller says and does —
   * Retell's own `Tests.createTestCaseDefinition`'s `user_prompt` runs a
   * full LLM-driven simulated caller against this persona for the whole
   * call, not a literal fixed turn-by-turn script (confirmed via
   * `retell-sdk`'s `resources/tests.d.ts`, CLAUDE.md Rule 1) — so this is
   * built FROM a scenario's/fixture's caller turns as an instruction, never
   * passed to Retell as literal dialogue.
   */
  readonly personaPrompt: string;
}

export interface BatchSimulationClient {
  readonly providerName: string;
  /**
   * Submit every `cases` entry against the given template's staging
   * response-engine (an opaque, provider-resolved reference — e.g. a
   * Retell `conversation_flow_id`/`llm_id` + version from a STAGING-only
   * `createOrUpdateAgent`/`publishAgentVersion`, SYSTEM_DESIGN §8 G16) and
   * resolve once every case's run has settled (pass/fail/error upstream,
   * or simply "we have a transcript") — polling/waiting is the
   * implementation's job, not the caller's.
   */
  runScenarios(
    templateKey: string,
    responseEngineRef: string,
    cases: readonly SimulationTestCase[],
  ): Promise<ReadonlyMap<string, SimulationTranscript>>;
}
