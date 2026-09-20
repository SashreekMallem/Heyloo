import { describe, expect, it } from "vitest";
import {
  type CompilerAgentTemplate,
  compileTemplate,
  verifyDisclosureGate,
} from "./template-compiler.ts";

const DISCLOSURE = "This call may be recorded and you are speaking with an AI assistant.";

function baseTemplate(overrides: Partial<CompilerAgentTemplate> = {}): CompilerAgentTemplate {
  return {
    compile_target: "conversation_flow",
    system_prompt: "You help callers book auto repair appointments.",
    states: [
      { id: "greeting", name: "Greeting", prompt_fragment: "Greet the caller.", allowed_tools: [] },
      {
        id: "booking",
        name: "Booking",
        prompt_fragment: "Collect booking details.",
        allowed_tools: ["check_availability", "create_booking"],
      },
    ],
    transitions: [{ from: "greeting", to: "booking", on: { intent: "wants_to_book" } }],
    global_intents: [
      {
        name: "emergency",
        target_state: "booking",
        reachable_from: "any",
        description: "the caller mentions an emergency",
      },
    ],
    tools: [
      { name: "check_availability", description: "checks slots", parameters: {} },
      { name: "create_booking", description: "books a slot", parameters: {} },
    ],
    disclosure_line: DISCLOSURE,
    ...overrides,
  };
}

describe("compileTemplate — conversation_flow", () => {
  it("prepends the disclosure line to the start node and verifies the gate", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    expect(compiled.compileTarget).toBe("conversation_flow");
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes, start_node_id } = compiled.flow.body;
    const startNode = nodes.find((n) => n.id === start_node_id);
    expect(startNode?.instruction?.text.startsWith(DISCLOSURE)).toBe(true);
  });

  it("gives every emitted tool a tool_id (CALL-1 gap fix: required by a live 400, docs.retellai.com/api-references/create-conversation-flow)", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    expect(compiled.flow.body.tools).toEqual([
      {
        type: "custom",
        tool_id: "check_availability",
        name: "check_availability",
        description: "checks slots",
        url: "https://example.com/voice-tools",
        parameters: { properties: {} },
      },
      {
        type: "custom",
        tool_id: "create_booking",
        name: "create_booking",
        description: "books a slot",
        url: "https://example.com/voice-tools",
        parameters: { properties: {} },
      },
    ]);
  });

  it("marks the global-intent target node with global_node_setting.condition (reachable_from: any)", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const bookingNode = compiled.flow.body.nodes.find((n) => n.id === "booking") as
      | { global_node_setting?: { condition: string } }
      | undefined;
    expect(bookingNode?.global_node_setting).toEqual({
      condition: "the caller mentions an emergency",
    });
  });

  it("CALL-2 fix: a state with allowed_tools compiles to a subagent node with tool_ids (a plain conversation node can never call a tool — RETELL-VERIFIED live)", () => {
    const template = baseTemplate({
      states: [
        {
          id: "booking",
          name: "Booking",
          prompt_fragment: "Collect booking details.",
          // A name absent from template.tools must never leak into
          // tool_ids — Retell would reject an unknown tool_id outright.
          allowed_tools: ["create_booking", "not_a_real_tool"],
        },
      ],
      tools: [{ name: "create_booking", description: "books a slot", parameters: {} }],
    });
    const compiled = compileTemplate(template, "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    expect(compiled.flow.body.nodes[0]).toMatchObject({
      type: "subagent",
      tool_ids: ["create_booking"],
    });
  });

  it("a state with no allowed_tools still compiles to a plain conversation node with no tool_ids field", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const greetingNode = compiled.flow.body.nodes.find((n) => n.id === "greeting");
    expect(greetingNode?.type).toBe("conversation");
    expect(greetingNode).not.toHaveProperty("tool_ids");
  });

  it("CALL-2 fix: an is_terminal state gets an `end` node plus an edge onto it, so the flow has somewhere to go once that state's business is done (previously a live bug: no edge onward left the model repeating the same turn/tool call forever, never ending the call)", () => {
    const template = baseTemplate({
      states: [
        { id: "greeting", name: "Greeting", prompt_fragment: "Greet.", allowed_tools: [] },
        {
          id: "confirm_booking",
          name: "Confirm booking",
          prompt_fragment: "Confirm and book.",
          allowed_tools: ["create_booking"],
          is_terminal: true,
        },
      ],
      transitions: [{ from: "greeting", to: "confirm_booking", on: { intent: "ready" } }],
      tools: [{ name: "create_booking", description: "books it", parameters: {} }],
    });
    const compiled = compileTemplate(template, "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes } = compiled.flow.body;

    const endNode = nodes.find((n) => n.type === "end");
    expect(endNode).toBeDefined();
    expect(endNode?.id).toBe("confirm_booking__end");

    const confirmNode = nodes.find((n) => n.id === "confirm_booking") as
      | { edges: Array<{ destination_node_id: string }> }
      | undefined;
    expect(confirmNode?.edges.some((e) => e.destination_node_id === endNode?.id)).toBe(true);

    // A non-terminal state gets no end node/edge.
    expect(nodes.some((n) => n.id === "greeting__end")).toBe(false);
  });

  it("a non-terminal template (no is_terminal state) emits no `end` nodes at all", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    expect(compiled.flow.body.nodes.some((n) => n.type === "end")).toBe(false);
  });

  it("fails the disclosure gate when disclosure_line is empty", () => {
    const compiled = compileTemplate(
      baseTemplate({ disclosure_line: "" }),
      "https://example.com/x",
    );
    expect(compiled.disclosureVerified).toBe(false);
  });

  it("fails the disclosure gate when the start node's fragment doesn't actually contain it (defense-in-depth self-check)", () => {
    const flow = {
      kind: "conversation_flow" as const,
      body: {
        start_node_id: "a",
        start_speaker: "agent" as const,
        nodes: [
          {
            id: "a",
            type: "conversation" as const,
            name: "a",
            instruction: { type: "prompt" as const, text: "no disclosure here" },
            edges: [],
          },
        ],
        tools: [],
      },
    };
    expect(verifyDisclosureGate(flow, DISCLOSURE)).toBe(false);
  });
});

describe("compileTemplate — multi_prompt", () => {
  it("prepends the disclosure line to the starting state's prompt", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "multi_prompt" }),
      "https://x/y",
    );
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.starting_state).toBe("greeting");
    const startState = compiled.flow.body.states.find((s) => s.name === "greeting");
    expect(startState?.state_prompt.startsWith(DISCLOSURE)).toBe(true);
  });

  it("adds an edge from every other state to a global-intent target (no separate global-node primitive)", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "multi_prompt" }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    const greeting = compiled.flow.body.states.find((s) => s.name === "greeting");
    expect(greeting?.edges.some((e) => e.destination_state_name === "booking")).toBe(true);
  });
});

describe("compileTemplate — single_prompt", () => {
  it("puts the disclosure line as the very first line of general_prompt", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "single_prompt" }),
      "https://x/y",
    );
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.general_prompt.startsWith(DISCLOSURE)).toBe(true);
  });

  it("folds global_intents into textual escape instructions", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "single_prompt" }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.general_prompt).toContain("Escape: emergency");
  });
});
