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

  it("a non-terminal template (no is_terminal state) emits no PER-STATE `end` node, but still emits the generic wrap-up end node (CALL-4: every flow can always end)", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const endNodes = compiled.flow.body.nodes.filter((n) => n.type === "end");
    expect(endNodes.map((n) => n.id)).toEqual(["__wrap_up_end"]);
  });

  it("CALL-4: a generic wrap-up node is reachable from anywhere (global_node_setting) and can end the call or loop back to the start node", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes, start_node_id } = compiled.flow.body;
    const wrapUpNode = nodes.find((n) => n.id === "__wrap_up") as
      | {
          type: string;
          global_node_setting?: { condition: string };
          edges: Array<{ destination_node_id: string }>;
        }
      | undefined;
    expect(wrapUpNode?.type).toBe("conversation");
    expect(wrapUpNode?.global_node_setting?.condition).toBeTruthy();
    expect(wrapUpNode?.edges.map((e) => e.destination_node_id).sort()).toEqual(
      ["__wrap_up_end", start_node_id].sort(),
    );
    const wrapUpEnd = nodes.find((n) => n.id === "__wrap_up_end");
    expect(wrapUpEnd?.type).toBe("end");
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

function transferTemplate(overrides: Partial<CompilerAgentTemplate> = {}): CompilerAgentTemplate {
  return baseTemplate({
    ...overrides,
    states: [
      { id: "greeting", name: "Greeting", prompt_fragment: "Greet.", allowed_tools: [] },
      {
        id: "transfer_to_human",
        name: "Transfer to human",
        prompt_fragment: "The caller wants a human, use transfer_call.",
        allowed_tools: ["transfer_call"],
        is_terminal: true,
      },
    ],
    transitions: [],
    global_intents: [
      {
        name: "human_request",
        target_state: "transfer_to_human",
        reachable_from: "any",
        description: "the caller asks for a human",
      },
    ],
    tools: [
      { name: "take_message", description: "takes a message", parameters: {} },
      { name: "transfer_call", description: "warm-transfers the caller", parameters: {} },
    ],
  });
}

describe("compileTemplate — conversation_flow — transfer_call (CALL-4)", () => {
  it("with a transferNumber configured: compiles a native transfer_call node, destination baked from tenant config, never a webhook tool", () => {
    const compiled = compileTemplate(transferTemplate(), "https://example.com/voice-tools", {
      transferNumber: "+15551234567",
    });
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes, tools } = compiled.flow.body;

    // Never a bogus custom-function tool named transfer_call.
    expect(tools.some((t) => t.name === "transfer_call")).toBe(false);

    const transferNode = nodes.find((n) => n.id === "transfer_to_human") as
      | {
          type: string;
          transfer_destination?: { type: string; number: string };
          transfer_option?: { type: string };
          edge?: { destination_node_id: string };
        }
      | undefined;
    expect(transferNode?.type).toBe("transfer_call");
    expect(transferNode?.transfer_destination).toEqual({
      type: "predefined",
      number: "+15551234567",
    });
    expect(transferNode?.transfer_option).toEqual({ type: "warm_transfer" });
    // The required "transfer failed" edge lands on this state's own end
    // node — the same one the is_terminal pass creates.
    expect(transferNode?.edge?.destination_node_id).toBe("transfer_to_human__end");
    expect(nodes.some((n) => n.id === "transfer_to_human__end" && n.type === "end")).toBe(true);
  });

  it("with NO transferNumber configured: compiles an honest spoken fallback (take_message granted), never a transfer node", () => {
    const compiled = compileTemplate(transferTemplate(), "https://example.com/voice-tools", {
      transferNumber: null,
    });
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes } = compiled.flow.body;

    expect(nodes.some((n) => n.type === "transfer_call")).toBe(false);

    const fallbackNode = nodes.find((n) => n.id === "transfer_to_human") as
      | { type: string; tool_ids?: string[]; instruction?: { text: string } }
      | undefined;
    expect(fallbackNode?.type).toBe("subagent");
    expect(fallbackNode?.tool_ids).toEqual(["take_message"]);
    expect(fallbackNode?.instruction?.text).toMatch(/take_message/);
    // Still is_terminal — still gets its own end node/edge.
    expect(nodes.some((n) => n.id === "transfer_to_human__end")).toBe(true);
  });

  it("omitting the options argument entirely behaves the same as no transferNumber (back-compat default)", () => {
    const compiled = compileTemplate(transferTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    expect(compiled.flow.body.nodes.some((n) => n.type === "transfer_call")).toBe(false);
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

  it("CALL-8 (docs/BUILD_PLAN.md): take_message is always reachable via general_tools, structurally available from EVERY state — not only the ones whose own allowed_tools lists it — closing a live-observed bug where a state that never granted it left the model unable to record anything before ending the call", () => {
    const compiled = compileTemplate(
      baseTemplate({
        compile_target: "multi_prompt",
        states: [
          { id: "greeting", name: "Greeting", prompt_fragment: "Greet.", allowed_tools: [] },
          {
            id: "qualification",
            // Deliberately does NOT list take_message — mirrors real_estate's
            // own "qualification" state, the exact live-confirmed shape a
            // caller who front-loads info can end a call from without ever
            // reaching the one state that used to be the sole take_message
            // grant.
            name: "Qualification",
            prompt_fragment: "Ask qualifying questions.",
            allowed_tools: [],
          },
          {
            id: "lead_only",
            name: "Lead only",
            prompt_fragment: "Take a message.",
            allowed_tools: ["take_message"],
            is_terminal: true,
          },
        ],
        transitions: [
          { from: "greeting", to: "qualification", on: { intent: "starts" } },
          { from: "qualification", to: "lead_only", on: { intent: "not_ready" } },
        ],
        global_intents: [],
        tools: [{ name: "take_message", description: "takes a message", parameters: {} }],
      }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    expect(
      compiled.flow.body.general_tools.some(
        (t) => t.type === "custom" && t.name === "take_message",
      ),
    ).toBe(true);
    // Never duplicated into any state's own per-state tools, including the
    // one whose authored allowed_tools explicitly named it.
    for (const state of compiled.flow.body.states) {
      expect(state.tools.some((t) => t.type === "custom" && t.name === "take_message")).toBe(false);
    }
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

  it("CALL-7 (live-confirmed Retell 400: 'Destination states must be unique for a particular state') never emits two edges from the same state to the same destination, even when an authored transition and a reachable_from:any global intent target the exact same state — the exact `legal`/`real_estate` template shape (greeting -> take_message_fallback transition + a give_up global intent to the same target) that hit this live", () => {
    const compiled = compileTemplate(
      baseTemplate({
        compile_target: "multi_prompt",
        // greeting already transitions straight to "booking" (baseTemplate's
        // own fixture) AND the "emergency" global intent (reachable_from:
        // "any") ALSO targets "booking" — before the CALL-7 fix, "greeting"
        // ended up with two edges to "booking".
      }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    for (const state of compiled.flow.body.states) {
      const destinations = state.edges.map((e) => e.destination_state_name);
      expect(new Set(destinations).size).toBe(destinations.length);
    }
    const greeting = compiled.flow.body.states.find((s) => s.name === "greeting");
    expect(greeting?.edges.filter((e) => e.destination_state_name === "booking")).toHaveLength(1);
  });

  it("CALL-7 (live-confirmed: a multi_prompt agent granted no end_call tool never hangs up — 0/6 real batch-test scenarios all settled 'Ending the conversation early as there might be a loop' because the model had no way to end the call once its business was done) grants a general_tools end_call tool and instructs the model to use it", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "multi_prompt" }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.general_tools).toEqual([
      { type: "end_call", name: "end_call", description: expect.any(String) },
    ]);
    expect(compiled.flow.body.general_prompt).toMatch(/end_call/);
  });

  it("CALL-7 (live-confirmed: a real batch-test transcript showed the model calling the old custom-webhook 'transfer_call' 4 times in a row, each time getting the generic voice-tools fallbackEnvelope since nothing dispatches a tool by that name, settling 'Ending the conversation early as there might be a loop') with a transferNumber configured: compiles a native transfer_call state tool, destination baked from tenant config, never a webhook tool", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "multi_prompt" }),
      "https://example.com/voice-tools",
      { transferNumber: "+15551234567" },
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    const transferState = compiled.flow.body.states.find((s) => s.name === "transfer_to_human");
    expect(transferState?.tools).toEqual([
      {
        type: "transfer_call",
        name: "transfer_call",
        description: "warm-transfers the caller",
        transfer_destination: { type: "predefined", number: "+15551234567" },
        transfer_option: { type: "warm_transfer" },
      },
    ]);
    for (const state of compiled.flow.body.states) {
      expect(state.tools.some((t) => t.type === "custom" && t.name === "transfer_call")).toBe(
        false,
      );
    }
  });

  it("CALL-7 with NO transferNumber configured: compiles an honest spoken fallback (take_message reachable via general_tools, no transfer_call tool anywhere)", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "multi_prompt" }),
      "https://example.com/voice-tools",
      { transferNumber: null },
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    const transferState = compiled.flow.body.states.find((s) => s.name === "transfer_to_human");
    // CALL-8 (docs/BUILD_PLAN.md): take_message moved from a per-state tool
    // grant to `general_tools` (RETELL-VERIFIED: general_tools accepts a
    // `type: "custom"` entry) so it's callable from EVERY state, not just
    // whichever ones list it — see template-compiler.ts's own comment for
    // the live-observed bug this closes.
    expect(
      compiled.flow.body.general_tools.some(
        (t) => t.type === "custom" && t.name === "take_message",
      ),
    ).toBe(true);
    expect(transferState?.state_prompt).toMatch(/take_message/);
    for (const state of compiled.flow.body.states) {
      expect(state.tools.some((t) => t.type === "transfer_call")).toBe(false);
      expect(state.tools.some((t) => t.type === "custom" && t.name === "take_message")).toBe(false);
    }
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

  it("CALL-7: grants an end_call tool (same platform-wide gap as multi_prompt — a Retell LLM response engine never ends a call on its own) alongside the authored custom-function tools", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "single_prompt" }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    const endCallTool = compiled.flow.body.general_tools.find((t) => t.type === "end_call");
    expect(endCallTool).toEqual({
      type: "end_call",
      name: "end_call",
      description: expect.any(String),
    });
    const customTools = compiled.flow.body.general_tools.filter((t) => t.type === "custom");
    expect(customTools.length).toBe(2); // check_availability + create_booking from baseTemplate
    expect(compiled.flow.body.general_prompt).toMatch(/end_call/);
  });

  it("CALL-7: with a transferNumber configured, compiles a native transfer_call general_tools entry, never a custom-webhook tool named transfer_call", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "single_prompt" }),
      "https://example.com/voice-tools",
      { transferNumber: "+15551234567" },
    );
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    const transferTool = compiled.flow.body.general_tools.find((t) => t.type === "transfer_call");
    expect(transferTool).toEqual({
      type: "transfer_call",
      name: "transfer_call",
      description: "warm-transfers the caller",
      transfer_destination: { type: "predefined", number: "+15551234567" },
      transfer_option: { type: "warm_transfer" },
    });
    expect(
      compiled.flow.body.general_tools.some(
        (t) => t.type === "custom" && t.name === "transfer_call",
      ),
    ).toBe(false);
  });

  it("CALL-7: with NO transferNumber configured, never grants a transfer_call tool at all and adds an honest spoken-fallback instruction instead", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "single_prompt" }),
      "https://example.com/voice-tools",
      { transferNumber: null },
    );
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.general_tools.some((t) => t.type === "transfer_call")).toBe(false);
    expect(compiled.flow.body.general_prompt).toMatch(/take_message/);
  });
});
