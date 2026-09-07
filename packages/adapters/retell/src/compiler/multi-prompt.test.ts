import { describe, expect, it } from "vitest";
import { LEGAL_MULTI_PROMPT_TEMPLATE } from "../fixtures/templates.js";
import { compileMultiPrompt } from "./multi-prompt.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

describe("compileMultiPrompt", () => {
  it("matches the golden-file snapshot for the legal vertical fixture", () => {
    expect(compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL)).toMatchSnapshot();
  });

  it("prepends disclosure_line verbatim to the starting_state's state_prompt", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    const startState = result.states.find((s) => s.name === result.starting_state);
    expect(startState?.state_prompt).toContain(LEGAL_MULTI_PROMPT_TEMPLATE.disclosure_line);
  });

  it("uses the first declared state as starting_state", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.starting_state).toBe("greeting");
  });

  it("adds an edge from every state to the conflict_check state (human_request, reachable_from: any)", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    const nonTargetStates = result.states.filter((s) => s.name !== "conflict_check");
    for (const state of nonTargetStates) {
      expect(state.edges.some((e) => e.destination_state_name === "conflict_check")).toBe(true);
    }
  });

  it("does not add a self-referencing edge on the target state itself", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    const conflictCheck = result.states.find((s) => s.name === "conflict_check");
    expect(conflictCheck?.edges.some((e) => e.destination_state_name === "conflict_check")).toBe(
      false,
    );
  });

  it("carries general_prompt from system_prompt", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.general_prompt).toBe(LEGAL_MULTI_PROMPT_TEMPLATE.system_prompt);
  });
});
