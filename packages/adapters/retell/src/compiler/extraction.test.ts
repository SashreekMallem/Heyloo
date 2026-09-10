import type { AgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { AUTO_CONVERSATION_FLOW_TEMPLATE } from "../fixtures/templates.js";
import { compilePostCallAnalysisData } from "./extraction.js";

function withExtraction(overrides: Partial<AgentTemplate["states"][number]>[]): AgentTemplate {
  return {
    ...AUTO_CONVERSATION_FLOW_TEMPLATE,
    states: AUTO_CONVERSATION_FLOW_TEMPLATE.states.map((s, i) => ({
      ...s,
      ...(overrides[i] ?? {}),
    })),
  };
}

describe("compilePostCallAnalysisData", () => {
  it("returns an empty array when no state declares extraction fields", () => {
    expect(compilePostCallAnalysisData(AUTO_CONVERSATION_FLOW_TEMPLATE)).toEqual([]);
  });

  it("lowers a boolean extraction field with an explicit description verbatim", () => {
    const template = withExtraction([
      {},
      {},
      {},
      {},
      {
        extraction: [
          { field: "emergency_detected", type: "boolean", description: "Was this an emergency?" },
        ],
      },
    ]);
    expect(compilePostCallAnalysisData(template)).toEqual([
      {
        name: "emergency_detected",
        description: "Was this an emergency?",
        required: false,
        type: "boolean",
      },
    ]);
  });

  it("synthesizes a description when one is omitted", () => {
    const template = withExtraction([
      {},
      {},
      {},
      {},
      { extraction: [{ field: "follow_up_needed", type: "boolean" }] },
    ]);
    const [result] = compilePostCallAnalysisData(template);
    expect(result?.description).toContain("follow up needed");
    expect(result?.description).toContain("Emergency triage");
  });

  it("maps canonical 'text' to Retell's 'string' type", () => {
    const template = withExtraction([
      {},
      {},
      {},
      {},
      { extraction: [{ field: "call_summary_hint", type: "text", description: "d" }] },
    ]);
    expect(compilePostCallAnalysisData(template)[0]?.type).toBe("string");
  });

  it("carries enum_values through as choices for an enum field", () => {
    const template = withExtraction([
      {},
      {},
      {},
      {},
      {
        extraction: [
          {
            field: "classification",
            type: "enum",
            enum_values: ["new_booking", "reschedule", "spam"],
            description: "d",
          },
        ],
      },
    ]);
    const [result] = compilePostCallAnalysisData(template);
    expect(result).toMatchObject({ type: "enum", choices: ["new_booking", "reschedule", "spam"] });
  });

  it("deduplicates a field declared identically on multiple states, keeping the first", () => {
    const template = withExtraction([
      {},
      {},
      {},
      { extraction: [{ field: "legal_advice_given", type: "boolean", description: "first" }] },
      { extraction: [{ field: "legal_advice_given", type: "boolean", description: "second" }] },
    ]);
    const results = compilePostCallAnalysisData(template);
    expect(results).toHaveLength(1);
    expect(results[0]?.description).toBe("first");
  });
});
