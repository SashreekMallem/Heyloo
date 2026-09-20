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

  it("carries general_prompt from system_prompt, plus the CALL-7 end-call instruction", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.general_prompt.startsWith(LEGAL_MULTI_PROMPT_TEMPLATE.system_prompt ?? "")).toBe(
      true,
    );
    expect(result.general_prompt).toMatch(/end_call/);
  });

  it("CALL-7 (docs/BUILD_NOTES.md, live-confirmed: a multi_prompt agent granted no end_call tool never hangs up) grants a general_tools end_call tool", () => {
    const result = compileMultiPrompt(LEGAL_MULTI_PROMPT_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(result.general_tools).toEqual([
      { type: "end_call", name: "end_call", description: expect.any(String) },
    ]);
  });

  it("compiles a declared transfer_call tool to Retell LLM's native transfer_call tool, not a custom webhook (GAP_REGISTER §1.4 item 4)", () => {
    const withTransfer = {
      ...LEGAL_MULTI_PROMPT_TEMPLATE,
      states: LEGAL_MULTI_PROMPT_TEMPLATE.states.map((s) =>
        s.id === "conflict_check"
          ? { ...s, allowed_tools: [...s.allowed_tools, "transfer_call"] }
          : s,
      ),
      tools: [
        ...LEGAL_MULTI_PROMPT_TEMPLATE.tools,
        {
          name: "transfer_call",
          description: "Warm-transfer the caller to a human.",
          parameters: { type: "object" as const, properties: {}, required: [] },
          authorization: { scope: "tenant_config_only" as const },
        },
      ],
    };
    const result = compileMultiPrompt(withTransfer, TOOL_WEBHOOK_URL);
    const conflictCheck = result.states.find((s) => s.name === "conflict_check");
    const transferTool = conflictCheck?.tools.find((t) => t.name === "transfer_call");
    expect(transferTool?.type).toBe("transfer_call");
    if (transferTool?.type === "transfer_call") {
      expect(transferTool.transfer_destination).toEqual({
        type: "predefined",
        number: "{{transfer_number}}",
      });
      expect(transferTool.transfer_option).toEqual({ type: "warm_transfer" });
    }
  });
});
