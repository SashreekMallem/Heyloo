import { describe, expect, it } from "vitest";
import {
  buildOpeningLine,
  buildPostCallAnalysisData,
  type CompilerAgentTemplate,
  compileTemplate,
  firstUtterance,
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
  it("DISCLOSE-1: starts on a static_text opening node that speaks the disclosure verbatim, and the gate verifies it", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    expect(compiled.compileTarget).toBe("conversation_flow");
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes, start_node_id } = compiled.flow.body;
    expect(start_node_id).toBe("__opening");
    const opening = nodes.find((n) => n.id === start_node_id) as
      | {
          type: string;
          instruction: { type: string; text: string };
          else_edge?: { destination_node_id: string; transition_condition: { prompt: string } };
        }
      | undefined;
    expect(opening?.type).toBe("conversation");
    expect(opening?.instruction).toEqual({
      type: "static_text",
      text: `${DISCLOSURE} {{caller_greeting}} How can I help you today?`,
    });
    // Everything the start state's own edges don't match falls through to
    // the start state itself (whose prompt then answers) — the literal
    // "Else" prompt is required by Retell's ElseEdge schema.
    expect(opening?.else_edge?.destination_node_id).toBe("greeting");
    expect(opening?.else_edge?.transition_condition.prompt).toBe("Else");
  });

  it("DISCLOSE-1: the opening node copies the start state's own edges, so the caller's first reply routes exactly as before", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { nodes } = compiled.flow.body;
    const destinations = (id: string) =>
      (
        nodes.find((n) => n.id === id) as { edges: Array<{ destination_node_id: string }> }
      ).edges.map((e) => e.destination_node_id);
    expect(destinations("__opening")).toEqual(destinations("greeting"));
    expect(destinations("__opening")).toContain("booking");
  });

  it("DISCLOSE-1: the start state is told its greeting was already spoken (never greets twice), and no longer carries the disclosure as a prompt to paraphrase", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const greeting = compiled.flow.body.nodes.find((n) => n.id === "greeting") as {
      instruction: { type: string; text: string };
    };
    expect(greeting.instruction.type).toBe("prompt");
    expect(greeting.instruction.text).toMatch(/ALREADY been spoken/);
    expect(greeting.instruction.text).toMatch(/Do not greet the caller again/);
    expect(greeting.instruction.text.endsWith("Greet the caller.")).toBe(true);
  });

  it("DISCLOSE-1: the returning-caller and language instructions live in the GLOBAL prompt (every node), with default_dynamic_variables covering every compiler-referenced variable", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools", {
      defaultDynamicVariables: { business_name: "Riverside Auto", assistant_name: "Nova" },
    });
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const { global_prompt, default_dynamic_variables } = compiled.flow.body;
    expect(global_prompt.startsWith("You help callers book auto repair appointments.")).toBe(true);
    expect(global_prompt).toContain("{{caller_recent_context}}");
    expect(global_prompt).toContain("{{caller_name_on_file}}");
    expect(global_prompt).toContain("{{caller_phone_on_file}}");
    expect(global_prompt).toMatch(/never ask a recognized caller to tell you their name or phone/);
    expect(global_prompt).toContain("{{language}}");
    expect(default_dynamic_variables).toEqual({
      caller_greeting: "",
      caller_name_on_file: "",
      caller_phone_on_file: "",
      caller_recent_context: expect.stringContaining("first-time caller"),
      transfer_number: "",
      language: "en",
      business_name: "Riverside Auto",
      assistant_name: "Nova",
      // SETTINGS-2: the owner-info block's variables, "nothing set" safe values.
      special_instructions: "",
      faq_text: expect.stringContaining("no FAQ"),
      business_facts: expect.stringContaining("nothing extra"),
      voicemail_message: "",
      booking_mode_text: expect.stringContaining("Normal"),
      // MSG-3: texting defaults to OFF for calls that never run /voice-inbound.
      sms_enabled: "false",
      texting_policy_text: expect.stringContaining("Text messages are NOT available"),
      // INTAKE-Q-1
      custom_questions_text: "(no custom questions)",
      transfer_policy_text: expect.stringContaining("No live transfer"),
      cancellation_policy_text: expect.any(String),
    });
    for (const token of [
      "{{special_instructions}}",
      "{{faq_text}}",
      "{{business_facts}}",
      "{{voicemail_message}}",
      "{{booking_mode_text}}",
      "{{texting_policy_text}}",
      "{{custom_questions_text}}",
      "{{transfer_policy_text}}",
      "{{cancellation_policy_text}}",
    ]) {
      expect(global_prompt).toContain(token);
    }
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
        // INTAKE-Q-1: create_booking (and take_message) carry the custom-answers parameter.
        parameters: {
          type: "object",
          properties: {
            structured_payload: {
              type: "object",
              properties: { custom_answers: expect.objectContaining({ type: "array" }) },
            },
          },
        },
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
    // nodes[0] is the static opening node (DISCLOSE-1); the state's own node follows it.
    expect(compiled.flow.body.nodes.find((n) => n.id === "booking")).toMatchObject({
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
    // DISCLOSE-1: "yes, another request" loops back to the start STATE,
    // never to the static opening node (which would replay the greeting).
    expect(start_node_id).toBe("__opening");
    expect(wrapUpNode?.edges.map((e) => e.destination_node_id).sort()).toEqual(
      ["__wrap_up_end", "greeting"].sort(),
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
        global_prompt: "",
        default_dynamic_variables: {},
      },
    };
    expect(verifyDisclosureGate(flow, DISCLOSURE)).toBe(false);
  });

  it("DISCLOSE-1: fails the gate when the disclosure is only in a PROMPT start node — a prompt is paraphrased by the model (the live 'this call may be recorded' drop), only a static first utterance counts", () => {
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
            instruction: { type: "prompt" as const, text: `${DISCLOSURE} Greet the caller.` },
            edges: [],
          },
        ],
        tools: [],
        global_prompt: "",
        default_dynamic_variables: {},
      },
    };
    expect(firstUtterance(flow)).toEqual({
      isStatic: false,
      text: `${DISCLOSURE} Greet the caller.`,
      blocksInterruptions: false,
    });
    expect(verifyDisclosureGate(flow, DISCLOSURE)).toBe(false);
  });

  it("DISCLOSE-1 review: the static opening node blocks interruptions (Retell's recording-disclaimer setup), and the gate FAILS a static opening the caller could cut off", () => {
    const compiled = compileTemplate(baseTemplate(), "https://example.com/voice-tools");
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    const opening = compiled.flow.body.nodes.find((n) => n.id === "__opening");
    expect(
      opening && "interruption_sensitivity" in opening
        ? opening.interruption_sensitivity
        : "missing",
    ).toBe(0);
    expect(firstUtterance(compiled.flow).blocksInterruptions).toBe(true);
    expect(compiled.disclosureVerified).toBe(true);
    // Only the opening node overrides barge-in; every other node keeps the agent default.
    for (const node of compiled.flow.body.nodes) {
      if (node.id === "__opening") continue;
      expect("interruption_sensitivity" in node, `node '${node.id}'`).toBe(false);
    }

    // The same static opening WITHOUT the override (the pre-review shape) fails the gate.
    const interruptible = {
      ...compiled.flow,
      body: {
        ...compiled.flow.body,
        nodes: compiled.flow.body.nodes.map((n) => {
          if (n.id !== "__opening" || !("interruption_sensitivity" in n)) return n;
          const { interruption_sensitivity: _dropped, ...rest } = n;
          return rest as typeof n;
        }),
      },
    };
    expect(firstUtterance(interruptible).isStatic).toBe(true);
    expect(firstUtterance(interruptible).blocksInterruptions).toBe(false);
    expect(verifyDisclosureGate(interruptible, compiled.openingLine.disclosureLiteral)).toBe(false);
  });

  it("DISCLOSE-1 review: the start state may restate the AI + recording notice ONLY when the caller cut the opening off (every compile target)", () => {
    for (const compile_target of ["conversation_flow", "multi_prompt", "single_prompt"] as const) {
      const compiled = compileTemplate(
        baseTemplate({ compile_target }),
        "https://example.com/voice-tools",
      );
      const text = JSON.stringify(compiled.flow.body);
      expect(text, compile_target).toContain("Do not greet the caller again");
      expect(text, compile_target).toContain(
        "if the caller spoke over that line and it was cut off before the AI and call-recording notice was finished, begin your reply with one short sentence saying you are an AI assistant and that this call may be recorded",
      );
    }
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

describe("compileTemplate — conversation_flow — transfer_call (CALL-4, PUBLISH-1, DISCLOSE-1)", () => {
  type AnyNode = {
    id: string;
    type: string;
    instruction?: { type: string; text: string };
    edges?: Array<{
      destination_node_id: string;
      transition_condition: { type: string; prompt?: string; equations?: unknown[] };
    }>;
    else_edge?: { destination_node_id: string; transition_condition: { prompt: string } };
    edge?: { destination_node_id: string; transition_condition: { prompt: string } };
    tool_ids?: string[];
    transfer_destination?: { type: string; number: string };
    transfer_option?: { type: string };
    speak_during_execution?: boolean;
    global_node_setting?: { condition: string };
  };
  function nodesOf(options?: { transferNumber?: string | null }): Map<string, AnyNode> {
    const compiled = compileTemplate(
      transferTemplate(),
      "https://example.com/voice-tools",
      options,
    );
    if (compiled.flow.kind !== "conversation_flow") throw new Error("wrong kind");
    expect(compiled.flow.body.tools.some((t) => t.name === "transfer_call")).toBe(false);
    return new Map(compiled.flow.body.nodes.map((n) => [n.id, n as unknown as AnyNode]));
  }

  it("DISCLOSE-1: the transfer-only state's own id is a SILENT logic-split router (no instruction, never speaks) that decides deterministically with an equation on {{transfer_number}}, not the model", () => {
    const router = nodesOf().get("transfer_to_human");
    expect(router?.type).toBe("branch");
    expect(router?.instruction).toBeUndefined();
    // Still the global-intent target, so "the caller asks for a human" still lands here.
    expect(router?.global_node_setting).toEqual({ condition: "the caller asks for a human" });
    expect(router?.edges).toEqual([
      {
        id: "edge_transfer_to_human_has_transfer",
        destination_node_id: "transfer_to_human__transfer",
        transition_condition: {
          type: "equation",
          operator: "&&",
          equations: [{ left: "{{transfer_number}}", operator: "contains", right: "+" }],
        },
      },
    ]);
    expect(router?.else_edge).toEqual({
      id: "edge_transfer_to_human_no_transfer",
      destination_node_id: "transfer_to_human__no_transfer",
      transition_condition: { type: "prompt", prompt: "Else" },
    });
  });

  it("DISCLOSE-1: ONLY the real TransferCallNode announces a connection — while it transfers (speak_during_execution); its destination stays the {{transfer_number}} token (PUBLISH-1) and a failed transfer lands on the honest fallback", () => {
    const transferNode = nodesOf({ transferNumber: "+15551234567" }).get(
      "transfer_to_human__transfer",
    );
    expect(transferNode?.type).toBe("transfer_call");
    // Never the literal number the (dead, PUBLISH-1) option carried.
    expect(transferNode?.transfer_destination).toEqual({
      type: "predefined",
      number: "{{transfer_number}}",
    });
    expect(transferNode?.transfer_option).toEqual({ type: "warm_transfer" });
    expect(transferNode?.speak_during_execution).toBe(true);
    expect(transferNode?.instruction?.type).toBe("prompt");
    expect(transferNode?.instruction?.text).toMatch(/connecting them to a member of the team now/);
    expect(transferNode?.edge?.destination_node_id).toBe("transfer_to_human__no_transfer");
    // Retell's TransferCallNode edge schema: the prompt MUST be this literal.
    expect(transferNode?.edge?.transition_condition.prompt).toBe("Transfer failed");
  });

  it("DISCLOSE-1: the no-live-transfer fallback keeps the state's own text (QA-HOT), forbids claiming any connection, restates an emergency referral, takes a message, and can end the call", () => {
    const nodes = nodesOf();
    const fallback = nodes.get("transfer_to_human__no_transfer");
    expect(fallback?.type).toBe("subagent");
    expect(fallback?.tool_ids).toEqual(["take_message"]);
    const text = fallback?.instruction?.text ?? "";
    expect(text).toContain("The caller wants a human, use transfer_call.");
    expect(text).toMatch(/There is NO live transfer on this call/);
    expect(text).toMatch(
      /Never say or imply that you are connecting, transferring or putting the caller through/,
    );
    expect(text).toMatch(/already on the line/);
    expect(text).toMatch(/restate the emergency referral/);
    expect(text).toMatch(/call take_message/);
    // DISCLOSE-1 review: a message already taken earlier in the call (vet's
    // emergency_referral, legal's transfer_to_human) is never taken twice.
    expect(text).toContain(
      "If take_message was already called earlier in this call, do not offer or take another message",
    );
    expect(text).not.toMatch(/\{\{transfer_number\}\}/);
    const destinations = fallback?.edges?.map((e) => e.destination_node_id) ?? [];
    expect(destinations).toContain("transfer_to_human__end");
    expect(nodes.get("transfer_to_human__end")?.type).toBe("end");
  });

  it("the transferNumber option never changes the compiled output (PUBLISH-1: the live value is resolved by Retell per call)", () => {
    const withOption = compileTemplate(transferTemplate(), "https://example.com/voice-tools", {
      transferNumber: "+15551234567",
    });
    const without = compileTemplate(transferTemplate(), "https://example.com/voice-tools");
    expect(withOption.flow).toEqual(without.flow);
  });
});

describe("compileTemplate — multi_prompt", () => {
  it("DISCLOSE-1: speaks the disclosure verbatim as a static begin_message (agent speaks first), and the starting state is told it was already said", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "multi_prompt" }),
      "https://x/y",
    );
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.begin_message).toBe(
      `${DISCLOSURE} {{caller_greeting}} How can I help you today?`,
    );
    expect(compiled.flow.body.start_speaker).toBe("agent");
    expect(compiled.flow.body.default_dynamic_variables["caller_greeting"]).toBe("");
    expect(compiled.flow.body.starting_state).toBe("greeting");
    const startState = compiled.flow.body.states.find((s) => s.name === "greeting");
    expect(startState?.state_prompt).toMatch(/ALREADY been spoken/);
    expect(startState?.state_prompt.endsWith("Greet the caller.")).toBe(true);
    expect(compiled.flow.body.general_prompt).toContain("{{caller_name_on_file}}");
    expect(compiled.flow.body.general_prompt).toMatch(/end_call/);
  });

  it("DISCLOSE-1: a missing begin_message fails the gate even when the disclosure is in the starting state's prompt (an unset begin_message is model-generated)", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "multi_prompt" }),
      "https://x/y",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    const { begin_message: _omitted, ...withoutBegin } = compiled.flow.body;
    const tampered = {
      kind: "multi_prompt" as const,
      body: { ...withoutBegin, begin_message: "" },
    };
    expect(firstUtterance(tampered).isStatic).toBe(false);
    expect(verifyDisclosureGate(tampered, DISCLOSURE)).toBe(false);
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

  it("PUBLISH-1 (was CALL-7): ALWAYS compiles a native transfer_call state tool whose destination is the literal {{transfer_number}} token, regardless of the transferNumber option, plus the honest take_message-based fallback instruction (both are available every call — the model picks per call from the live dynamic variable)", () => {
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
        // Never the literal number this option carried — PUBLISH-1: the
        // option no longer affects the compiled output at all.
        transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
        transfer_option: { type: "warm_transfer" },
        // DISCLOSE-1: the tool itself announces the connection, only while
        // it actually transfers.
        speak_during_execution: true,
        execution_message_type: "prompt",
        execution_message_description: expect.stringMatching(/connecting them/),
      },
    ]);
    expect(transferState?.state_prompt).toMatch(/take_message/);
    // DISCLOSE-1: the model may never announce a connection on its own.
    expect(transferState?.state_prompt).toMatch(
      /never tell the caller you are connecting, transferring or putting them through unless you are calling transfer_call in this same turn/,
    );
    expect(transferState?.state_prompt).toMatch(/There is NO live transfer on this call/);
    for (const state of compiled.flow.body.states) {
      expect(state.tools.some((t) => t.type === "custom" && t.name === "transfer_call")).toBe(
        false,
      );
    }
    // CALL-8: take_message still structurally callable from EVERY state via
    // general_tools, not just the transfer-only one.
    expect(
      compiled.flow.body.general_tools.some(
        (t) => t.type === "custom" && t.name === "take_message",
      ),
    ).toBe(true);
  });

  it("omitting the options argument entirely compiles the exact same transfer_call tool + fallback instruction (back-compat default, PUBLISH-1)", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "multi_prompt" }),
      "https://example.com/voice-tools",
    );
    if (compiled.flow.kind !== "multi_prompt") throw new Error("wrong kind");
    const transferState = compiled.flow.body.states.find((s) => s.name === "transfer_to_human");
    expect(transferState?.tools).toEqual([
      expect.objectContaining({
        type: "transfer_call",
        transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      }),
    ]);
    for (const state of compiled.flow.body.states) {
      expect(state.tools.some((t) => t.type === "transfer_call")).toBe(state === transferState);
      expect(state.tools.some((t) => t.type === "custom" && t.name === "take_message")).toBe(false);
    }
  });
});

describe("compileTemplate — single_prompt", () => {
  it("DISCLOSE-1: speaks the disclosure verbatim as a static begin_message; the prompt opens by saying it was already spoken", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "single_prompt" }),
      "https://x/y",
    );
    expect(compiled.disclosureVerified).toBe(true);
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.begin_message).toBe(
      `${DISCLOSURE} {{caller_greeting}} How can I help you today?`,
    );
    expect(compiled.flow.body.start_speaker).toBe("agent");
    expect(
      compiled.flow.body.general_prompt.startsWith(
        "Your first turn in this call has ALREADY been spoken",
      ),
    ).toBe(true);
    expect(compiled.flow.body.general_prompt).toContain("{{caller_phone_on_file}}");
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

  it("PUBLISH-1 (was CALL-7): ALWAYS compiles a native transfer_call general_tools entry whose destination is the literal {{transfer_number}} token, regardless of the transferNumber option, plus an honest spoken-fallback instruction (the model picks per call from the live dynamic variable)", () => {
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
      // Never the literal number this option carried — PUBLISH-1: the
      // option no longer affects the compiled output at all.
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
      transfer_option: { type: "warm_transfer" },
      speak_during_execution: true,
      execution_message_type: "prompt",
      execution_message_description: expect.stringMatching(/connecting them/),
    });
    expect(
      compiled.flow.body.general_tools.some(
        (t) => t.type === "custom" && t.name === "transfer_call",
      ),
    ).toBe(false);
    expect(compiled.flow.body.general_prompt).toMatch(/take_message/);
  });

  it("omitting the options argument entirely compiles the exact same transfer_call tool (back-compat default, PUBLISH-1)", () => {
    const compiled = compileTemplate(
      transferTemplate({ compile_target: "single_prompt" }),
      "https://example.com/voice-tools",
    );
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    const transferTool = compiled.flow.body.general_tools.find((t) => t.type === "transfer_call");
    expect(transferTool).toMatchObject({
      transfer_destination: { type: "predefined", number: "{{transfer_number}}" },
    });
  });
});

describe("buildOpeningLine (DISCLOSE-1)", () => {
  const STANDARD =
    "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";

  it("English: the template's disclosure verbatim, then the returning-caller greeting token, then the question", () => {
    expect(buildOpeningLine(STANDARD)).toEqual({
      text: `${STANDARD} {{caller_greeting}} How can I help you today?`,
      disclosureLiteral: STANDARD,
      language: "en",
    });
  });

  it("Spanish: the vetted Spanish literal of the SAME disclosure (AI + recording), never a model translation", () => {
    const opening = buildOpeningLine(STANDARD, "es");
    expect(opening.language).toBe("es");
    expect(opening.disclosureLiteral).toContain("asistente de inteligencia artificial");
    expect(opening.disclosureLiteral).toContain("esta llamada puede ser grabada");
    expect(opening.text).toBe(
      `${opening.disclosureLiteral} {{caller_greeting}} ¿En qué puedo ayudarle hoy?`,
    );
  });

  it("falls back to the original English literal verbatim when no vetted translation exists (unknown line or unknown language)", () => {
    expect(buildOpeningLine(DISCLOSURE, "es")).toEqual({
      text: `${DISCLOSURE} {{caller_greeting}} How can I help you today?`,
      disclosureLiteral: DISCLOSURE,
      language: "en",
    });
    expect(buildOpeningLine(STANDARD, "fr").disclosureLiteral).toBe(STANDARD);
  });

  it("compileTemplate verifies the gate against the literal actually spoken for a Spanish tenant", () => {
    const compiled = compileTemplate(
      baseTemplate({ compile_target: "single_prompt", disclosure_line: STANDARD }),
      "https://x/y",
      { language: "es" },
    );
    expect(compiled.disclosureVerified).toBe(true);
    expect(compiled.openingLine.language).toBe("es");
    if (compiled.flow.kind !== "single_prompt") throw new Error("wrong kind");
    expect(compiled.flow.body.begin_message).toContain("esta llamada puede ser grabada");
    expect(compiled.flow.body.default_dynamic_variables["language"]).toBe("es");
  });
});

describe("buildPostCallAnalysisData (ANALYSIS-1)", () => {
  it("translates a state's extraction[] into Retell's post_call_analysis_data shape (text->string, enum->choices)", () => {
    const template = baseTemplate({
      states: [
        {
          id: "greeting",
          name: "Greeting",
          prompt_fragment: "Greet the caller.",
          allowed_tools: [],
          extraction: [
            {
              field: "classification",
              type: "enum",
              enum_values: ["new_booking", "reschedule"],
              description: "The call's classification.",
            },
            {
              field: "outcome",
              type: "text",
              description: "What happened on the call.",
            },
            {
              field: "follow_up_needed",
              type: "boolean",
              description: "Whether staff must follow up.",
            },
          ],
        },
      ],
    });
    expect(buildPostCallAnalysisData(template)).toEqual([
      {
        type: "enum",
        name: "classification",
        description: "The call's classification.",
        choices: ["new_booking", "reschedule"],
      },
      { type: "string", name: "outcome", description: "What happened on the call." },
      {
        type: "boolean",
        name: "follow_up_needed",
        description: "Whether staff must follow up.",
      },
    ]);
  });

  it("dedupes by field name across states — first declaration wins, later same-name declarations are dropped", () => {
    const template = baseTemplate({
      states: [
        {
          id: "s1",
          name: "S1",
          prompt_fragment: "x",
          allowed_tools: [],
          extraction: [
            { field: "classification", type: "enum", enum_values: ["a"], description: "first" },
          ],
        },
        {
          id: "s2",
          name: "S2",
          prompt_fragment: "x",
          allowed_tools: [],
          extraction: [
            { field: "classification", type: "enum", enum_values: ["b"], description: "second" },
          ],
        },
      ],
    });
    expect(buildPostCallAnalysisData(template)).toEqual([
      { type: "enum", name: "classification", description: "first", choices: ["a"] },
    ]);
  });

  it("fills a generic fallback description when a state omits one (e.g. legal_advice_given today)", () => {
    const template = baseTemplate({
      states: [
        {
          id: "s1",
          name: "S1",
          prompt_fragment: "x",
          allowed_tools: [],
          extraction: [{ field: "legal_advice_given", type: "boolean" }],
        },
      ],
    });
    expect(buildPostCallAnalysisData(template)).toEqual([
      {
        type: "boolean",
        name: "legal_advice_given",
        description: 'Extracted value for the "legal_advice_given" field.',
      },
    ]);
  });

  it("drops an enum field with no usable enum_values rather than sending Retell a malformed entry", () => {
    const template = baseTemplate({
      states: [
        {
          id: "s1",
          name: "S1",
          prompt_fragment: "x",
          allowed_tools: [],
          extraction: [{ field: "bad_enum", type: "enum", description: "no choices" }],
        },
      ],
    });
    expect(buildPostCallAnalysisData(template)).toEqual([]);
  });

  it("returns [] for a template with no extraction declared anywhere (compileTemplate omits the field downstream)", () => {
    expect(buildPostCallAnalysisData(baseTemplate())).toEqual([]);
  });

  it("compileTemplate exposes postCallAnalysisData on its result", () => {
    const template = baseTemplate({
      states: [
        {
          id: "greeting",
          name: "Greeting",
          prompt_fragment: "Greet.",
          allowed_tools: [],
          extraction: [{ field: "outcome", type: "text", description: "summary" }],
        },
      ],
    });
    const compiled = compileTemplate(template, "https://example.com/voice-tools");
    expect(compiled.postCallAnalysisData).toEqual([
      { type: "string", name: "outcome", description: "summary" },
    ]);
  });
});
