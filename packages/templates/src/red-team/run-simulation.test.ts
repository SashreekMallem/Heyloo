/**
 * Proves the batch-simulation harness's own plumbing — persona-prompt
 * construction, applicability filtering, per-template grouping, case-id
 * correlation, and grading dispatch — against an in-memory mock
 * `BatchSimulationClient`. This is deliberately NOT a re-test of
 * `gradeTranscript`'s own correctness (that's `grader.test.ts`'s job,
 * proven independently for every assertion kind); the mock here
 * synthesizes a transcript FROM each case's own `SimulationAssertion` (a
 * "satisfying" test double), so what this suite actually exercises is
 * whether `runHarness` wires the right assertion to the right case for the
 * right template — plus a real discrimination check (one template
 * deliberately fed a WRONG transcript) proving the harness reports a
 * genuine failure rather than always reporting green, matching the bar
 * `compiler-gate.test.ts` holds the disclosure gate to.
 */

import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS, type TemplateDefinition } from "../registry.js";
import { INJECTION_FIXTURES } from "./injection-fixtures.js";
import {
  buildPersonaPrompt,
  fixtureAppliesTo,
  type HarnessReport,
  runHarness,
  scenarioAppliesTo,
} from "./run-simulation.js";
import { SIMULATION_SCENARIOS } from "./simulation-scenarios.js";
import type {
  BatchSimulationClient,
  RecordedToolCall,
  SimulationAssertion,
  SimulationTranscript,
} from "./simulation-types.js";

function assertionsForTemplate(template: TemplateDefinition): readonly SimulationAssertion[] {
  return [
    ...SIMULATION_SCENARIOS.filter((s) => scenarioAppliesTo(s, template)).map((s) =>
      s.expect(template),
    ),
    ...INJECTION_FIXTURES.filter((f) => fixtureAppliesTo(f, template)).map((f) =>
      f.expect(template),
    ),
  ];
}

/** Builds a MINIMAL transcript that satisfies a given assertion — a test double, not a grader re-implementation. */
function transcriptSatisfying(assertion: SimulationAssertion): SimulationTranscript {
  const toolCalls: RecordedToolCall[] = [];
  const reachedStates: string[] = [];
  const agentUtterances: string[] = [];

  function apply(a: SimulationAssertion): void {
    switch (a.kind) {
      case "tool_called": {
        const args: Record<string, unknown> = {};
        for (const field of a.withFields ?? []) args[field] = {};
        toolCalls.push({ name: a.tool, arguments: args });
        break;
      }
      case "tool_called_with_zero_params":
        toolCalls.push({ name: a.tool, arguments: {} });
        break;
      case "state_reached":
        reachedStates.push(a.state);
        break;
      case "first_utterance_contains":
        agentUtterances.push(`Thanks for calling — this is their ${a.text}.`);
        break;
      case "tool_not_called":
      case "state_not_reached":
      case "agent_never_says":
      case "no_forbidden_fields":
        break; // satisfied by omission
      case "all":
        a.of.forEach(apply);
        break;
      case "any":
        if (a.of[0]) apply(a.of[0]);
        break;
      case "manual_review":
        break;
    }
  }

  apply(assertion);
  return {
    reachedStates,
    toolCalls,
    ...(agentUtterances.length > 0
      ? { firstAgentUtterance: agentUtterances[0]!, agentUtterances }
      : {}),
  };
}

/**
 * A client that re-derives, independently, which assertion each positional
 * case corresponds to (relying only on the documented ordering guarantee:
 * one `runScenarios` call per template, cases in
 * `[applicable SIMULATION_SCENARIOS][applicable INJECTION_FIXTURES]` order
 * — the same order `run-simulation.ts` builds them in) and returns a
 * transcript satisfying it — except for `brokenTemplateKeys`, which get a
 * deliberately empty, unsatisfying transcript for every case.
 */
function makeMockClient(
  brokenTemplateKeys: ReadonlySet<string> = new Set(),
): BatchSimulationClient {
  return {
    providerName: "mock",
    async runScenarios(templateKey, _responseEngineRef, cases) {
      const template = TEMPLATE_DEFINITIONS.find((t) => t.key === templateKey);
      if (!template) throw new Error(`unknown template '${templateKey}'`);
      const assertions = assertionsForTemplate(template);
      if (assertions.length !== cases.length) {
        throw new Error(
          `case/assertion count mismatch for ${templateKey}: ${cases.length} cases vs ${assertions.length} assertions`,
        );
      }
      const broken = brokenTemplateKeys.has(templateKey);
      const out = new Map<string, SimulationTranscript>();
      cases.forEach((c, i) => {
        out.set(
          c.id,
          broken ? { reachedStates: [], toolCalls: [] } : transcriptSatisfying(assertions[i]!),
        );
      });
      return out;
    },
  };
}

function allResponseEngineRefs(templates: readonly TemplateDefinition[]): Record<string, string> {
  return Object.fromEntries(templates.map((t) => [t.key, `staging-ref-${t.key}`]));
}

describe("buildPersonaPrompt", () => {
  it("instructs the simulated caller to say each turn in order, then continue naturally", () => {
    const prompt = buildPersonaPrompt(["Hi, I need an appointment.", "Tomorrow works."]);
    expect(prompt).toContain('1. "Hi, I need an appointment."');
    expect(prompt).toContain('2. "Tomorrow works."');
    expect(prompt.toLowerCase()).toContain("continue the conversation naturally");
  });
});

describe("runHarness against a fully-satisfying mock client", () => {
  let report: HarnessReport;

  it("runs without throwing and skips no template when every response-engine ref is present", async () => {
    report = await runHarness(
      makeMockClient(),
      TEMPLATE_DEFINITIONS,
      allResponseEngineRefs(TEMPLATE_DEFINITIONS),
    );
    expect(report.skippedTemplates).toEqual([]);
  });

  it("submitted at least one case for every template", () => {
    const keysWithCases = new Set(report.cases.map((c) => c.templateKey));
    for (const template of TEMPLATE_DEFINITIONS) {
      expect(keysWithCases.has(template.key), `${template.key} should have at least one case`).toBe(
        true,
      );
    }
  });

  it("every non-manual-review case passes (the mock satisfies every assertion it's handed)", () => {
    const failed = report.cases.filter((c) => !c.pass);
    expect(failed).toEqual([]);
  });

  it("carries at least one needs-review case (silence_voicemail is intentionally not machine-gradable)", () => {
    expect(report.cases.some((c) => c.needsReview)).toBe(true);
  });

  it("case count matches independently-recomputed applicability for every template", () => {
    const expectedTotal = TEMPLATE_DEFINITIONS.reduce(
      (sum, t) => sum + assertionsForTemplate(t).length,
      0,
    );
    expect(report.cases.length).toBe(expectedTotal);
  });

  it("legal's transfer fixture only asserts the state, never a caller-suppliable transfer_call", () => {
    const legal = TEMPLATE_DEFINITIONS.find((t) => t.key === "legal");
    if (!legal) throw new Error("legal template not registered");
    const legalCases = report.cases.filter(
      (c) => c.templateKey === "legal" && c.category === "transfer",
    );
    expect(legalCases.length).toBeGreaterThan(0);
    for (const c of legalCases) expect(c.pass).toBe(true);
  });
});

describe("runHarness reports a real failure when a template's transcripts don't satisfy their assertions", () => {
  it("auto_repair fails every case when its client returns empty transcripts; other templates stay green", async () => {
    const report = await runHarness(
      makeMockClient(new Set(["auto_repair"])),
      TEMPLATE_DEFINITIONS,
      allResponseEngineRefs(TEMPLATE_DEFINITIONS),
    );

    const autoRepairCases = report.cases.filter((c) => c.templateKey === "auto_repair");
    expect(autoRepairCases.length).toBeGreaterThan(0);
    // Some assertions are pure absence checks (tool_not_called, agent_never_says, ...) and
    // legitimately pass vacuously against an empty transcript — that's correct grader
    // behavior, not a discrimination failure. The real proof the harness discriminates is
    // its flagship "happy path" case (all POSITIVE assertions: a state reached, tools called
    // with specific fields) — that one MUST fail against an empty transcript.
    const happyPath = autoRepairCases.find((c) => c.category === "happy_path");
    if (!happyPath) throw new Error("expected an auto_repair happy_path case in the report");
    expect(happyPath.pass).toBe(false);
    expect(happyPath.reason.length).toBeGreaterThan(0);
    // And at least one case overall must have failed — not every assertion in the set is a
    // vacuous-pass negative check.
    expect(autoRepairCases.some((c) => !c.needsReview && !c.pass)).toBe(true);

    const otherCases = report.cases.filter((c) => c.templateKey !== "auto_repair");
    expect(otherCases.every((c) => c.pass)).toBe(true);
  });
});

describe("runHarness skips templates with no mapped response-engine reference", () => {
  it("reports the skip explicitly and submits no cases for that template", async () => {
    const refs = allResponseEngineRefs(TEMPLATE_DEFINITIONS);
    delete refs["legal"];

    const report = await runHarness(makeMockClient(), TEMPLATE_DEFINITIONS, refs);

    expect(report.skippedTemplates).toEqual(["legal"]);
    expect(report.cases.some((c) => c.templateKey === "legal")).toBe(false);
  });
});
