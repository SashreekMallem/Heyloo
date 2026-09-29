import type { CanonicalTool } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { AUTO_CONVERSATION_FLOW_TEMPLATE } from "../fixtures/templates.js";
import { compileConversationFlow } from "./conversation-flow.js";

const TOOL_WEBHOOK_URL = "https://example.supabase.co/functions/v1/voice-tools";

describe("compileConversationFlow", () => {
  it("matches the golden-file snapshot for the auto vertical fixture", () => {
    expect(
      compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL),
    ).toMatchSnapshot();
  });

  it("DISCLOSE-1: the start node is a static_text opening that speaks disclosure_line verbatim (never a prompt the model can paraphrase)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const startNode = flow.nodes.find((n) => n.id === flow.start_node_id);
    expect(startNode?.type).toBe("conversation");
    if (startNode?.type === "conversation") {
      expect(startNode.instruction).toEqual({
        type: "static_text",
        text: `${AUTO_CONVERSATION_FLOW_TEMPLATE.disclosure_line} {{caller_greeting}} How can I help you today?`,
      });
    }
    expect(flow.default_dynamic_variables).toEqual({ caller_greeting: "", transfer_number: "" });
  });

  it("DISCLOSE-1: the opening copies the first declared state's edges and falls through else_edge to it; that state is told its greeting was already spoken", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(flow.start_node_id).toBe("__opening");
    const opening = flow.nodes.find((n) => n.id === "__opening");
    const greeting = flow.nodes.find((n) => n.id === "greeting");
    if (opening?.type !== "conversation" || greeting?.type !== "conversation") {
      throw new Error("expected conversation nodes");
    }
    expect(opening.edges.map((e) => e.destination_node_id)).toEqual(
      greeting.edges.map((e) => e.destination_node_id),
    );
    expect(opening.else_edge).toEqual({
      id: "edge_opening_else",
      destination_node_id: "greeting",
      transition_condition: { type: "prompt", prompt: "Else" },
    });
    expect(greeting.instruction.type).toBe("prompt");
    expect(greeting.instruction.text).toMatch(/ALREADY been spoken/);
    // The disclosure is only quoted as already-said context, never the
    // instruction's own opening line for the model to (re)speak.
    expect(
      greeting.instruction.text.startsWith(AUTO_CONVERSATION_FLOW_TEMPLATE.disclosure_line),
    ).toBe(false);
  });

  it("lowers every transition into an edge on its `from` node", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const greeting = flow.nodes.find((n) => n.id === "greeting");
    expect(greeting?.type).toBe("conversation");
    if (greeting?.type === "conversation") {
      expect(greeting.edges).toHaveLength(1);
      expect(greeting.edges[0]?.destination_node_id).toBe("collect_vehicle");
    }
  });

  it("marks the emergency global_intent's target node with global_node_setting.condition (reachable_from: any)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const triageNode = flow.nodes.find((n) => n.id === "triage_emergency");
    // Single-tool (take_message-only), non-start state -> a SubagentNode
    // (CALL-4 — any 1+-tool state, not only the single-tool case);
    // global_node_setting is identically shaped there.
    expect(triageNode?.type).toBe("subagent");
    if (triageNode?.type === "subagent") {
      expect(triageNode.global_node_setting).toEqual({
        condition: AUTO_CONVERSATION_FLOW_TEMPLATE.global_intents.find(
          (gi) => gi.target_state === "triage_emergency",
        )?.description,
      });
    }
  });

  it("never emits a tool_ids field on a plain conversation node (not a real field on that node type — RETELL-VERIFY)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    for (const node of flow.nodes) {
      if (node.type !== "conversation") continue;
      expect(node).not.toHaveProperty("tool_ids");
    }
  });

  it("wires every tool's url to the given toolWebhookUrl", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    for (const tool of flow.tools) {
      expect(tool.url).toBe(TOOL_WEBHOOK_URL);
      expect(tool.type).toBe("custom");
    }
  });

  it("carries system_prompt through as global_prompt", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(flow.global_prompt).toBe(AUTO_CONVERSATION_FLOW_TEMPLATE.system_prompt);
  });

  it("compiles a single-tool, non-start state to a SubagentNode with a one-entry tool_ids (CALL-4)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const checkTime = flow.nodes.find((n) => n.id === "check_time");
    expect(checkTime?.type).toBe("subagent");
    if (checkTime?.type === "subagent") {
      expect(checkTime.tool_ids).toEqual(["check_availability"]);
    }
  });

  it("keeps the start state a plain conversation node even when it would otherwise be single-tool", () => {
    const singleToolGreeting = {
      ...AUTO_CONVERSATION_FLOW_TEMPLATE,
      states: AUTO_CONVERSATION_FLOW_TEMPLATE.states.map((s) =>
        s.id === "greeting" ? { ...s, allowed_tools: ["take_message"] } : s,
      ),
    };
    const flow = compileConversationFlow(singleToolGreeting, TOOL_WEBHOOK_URL);
    const greeting = flow.nodes.find((n) => n.id === flow.start_node_id);
    expect(greeting?.type).toBe("conversation");
  });
});

function withTransferState(extraTools: CanonicalTool[] = []) {
  return {
    ...AUTO_CONVERSATION_FLOW_TEMPLATE,
    states: [
      ...AUTO_CONVERSATION_FLOW_TEMPLATE.states,
      {
        id: "transfer_to_human",
        name: "Transfer to human",
        prompt_fragment: "Connecting you now.",
        allowed_tools: ["transfer_call"],
        is_terminal: true,
      },
    ],
    tools: [
      ...AUTO_CONVERSATION_FLOW_TEMPLATE.tools,
      {
        name: "transfer_call",
        description: "Warm-transfer the caller to a human.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        authorization: { scope: "tenant_config_only" as const },
      },
      ...extraTools,
    ],
  };
}

describe("compileConversationFlow — transfer_call (PUBLISH-1, was CALL-4, mirrors template-compiler.ts)", () => {
  function withTakeMessage() {
    return withTransferState([
      {
        name: "take_message",
        description: "Takes a message.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        authorization: { scope: "none" as const },
      },
    ]);
  }

  it("DISCLOSE-1: routes deterministically — an equation on {{transfer_number}} to the real transfer, else to the honest fallback — and the router never claims a connection", () => {
    const flow = compileConversationFlow(withTakeMessage(), TOOL_WEBHOOK_URL, {
      transferNumber: "+15551234567",
    });
    const router = flow.nodes.find((n) => n.id === "transfer_to_human");
    // The live Deno compiler emits a silent logic-split ("branch") node here;
    // this package emits a conversation node with the same edges (see
    // conversation-flow.ts `TRANSFER_ROUTER_INSTRUCTION`'s doc comment).
    expect(router?.type).toBe("conversation");
    if (router?.type === "conversation") {
      expect(router.edges).toEqual([
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
      expect(router.else_edge?.destination_node_id).toBe("transfer_to_human__no_transfer");
      expect(router.instruction.text).toMatch(/Never say or imply that you are connecting/);
    }
    // transfer_call is never emitted into the flow's top-level custom-tools list.
    expect(flow.tools.find((t) => t.name === "transfer_call")).toBeUndefined();
  });

  it("DISCLOSE-1: only the real TransferCallNode announces the connection (while it transfers); a failed transfer lands on the fallback", () => {
    const flow = compileConversationFlow(withTakeMessage(), TOOL_WEBHOOK_URL);
    const transferNode = flow.nodes.find((n) => n.id === "transfer_to_human__transfer");
    expect(transferNode?.type).toBe("transfer_call");
    if (transferNode?.type === "transfer_call") {
      // PUBLISH-1: never a literal number, always the live token.
      expect(transferNode.transfer_destination).toEqual({
        type: "predefined",
        number: "{{transfer_number}}",
      });
      expect(transferNode.transfer_option).toEqual({ type: "warm_transfer" });
      expect(transferNode.speak_during_execution).toBe(true);
      expect(transferNode.instruction?.text).toMatch(/connecting them to a member of the team now/);
      expect(transferNode.edge.destination_node_id).toBe("transfer_to_human__no_transfer");
      expect(transferNode.edge.transition_condition).toEqual({
        type: "prompt",
        prompt: "Transfer failed",
      });
    }
  });

  // QA-HOT/FOLLOWUP-1 + DISCLOSE-1: the fallback carries BOTH the state's
  // own prompt_fragment ("Connecting you now.", set by `withTransferState`
  // above) AND the no-transfer rules, which override any "connect them"
  // wording in it.
  it("DISCLOSE-1: the no-transfer fallback keeps the state's own text, forbids claiming a connection, restates an emergency referral, takes a message, and can end the call", () => {
    const flow = compileConversationFlow(withTakeMessage(), TOOL_WEBHOOK_URL);
    const fallback = flow.nodes.find((n) => n.id === "transfer_to_human__no_transfer");
    expect(fallback?.type).toBe("subagent");
    if (fallback?.type === "subagent") {
      expect(fallback.tool_ids).toEqual(["take_message"]);
      expect(fallback.instruction.text).toContain("Connecting you now.");
      expect(fallback.instruction.text).toMatch(/There is NO live transfer on this call/);
      expect(fallback.instruction.text).toMatch(/restate the emergency referral/);
      expect((fallback.edges ?? []).map((e) => e.destination_node_id)).toContain(
        "transfer_to_human__end",
      );
    }
    expect(flow.nodes.some((n) => n.id === "transfer_to_human__end" && n.type === "end")).toBe(
      true,
    );
  });

  it("the transferNumber option never changes the compiled output (PUBLISH-1)", () => {
    expect(
      compileConversationFlow(withTakeMessage(), TOOL_WEBHOOK_URL, { transferNumber: "+1555" }),
    ).toEqual(compileConversationFlow(withTakeMessage(), TOOL_WEBHOOK_URL));
  });
});

describe("compileConversationFlow — predicate-on-tool-result", () => {
  it("compiles a predicate-on-tool-result transition to an equation-typed edge (GAP_REGISTER §1.5)", () => {
    const withToolResult = {
      ...AUTO_CONVERSATION_FLOW_TEMPLATE,
      states: [
        ...AUTO_CONVERSATION_FLOW_TEMPLATE.states.map((s) =>
          s.id === "check_time" ? { ...s, allowed_tools: [] } : s,
        ),
      ],
      transitions: AUTO_CONVERSATION_FLOW_TEMPLATE.transitions.map((t) =>
        t.from === "check_time" && t.to === "confirm_booking"
          ? {
              from: "check_time",
              to: "confirm_booking",
              on: {
                tool_result: {
                  tool: "check_availability",
                  variable: "slot_selected",
                  operator: "exists" as const,
                },
              },
            }
          : t,
      ),
    };
    const flow = compileConversationFlow(withToolResult, TOOL_WEBHOOK_URL);
    const checkTime = flow.nodes.find((n) => n.id === "check_time");
    expect(checkTime?.type).toBe("conversation");
    if (checkTime?.type === "conversation") {
      expect(checkTime.edges[0]?.transition_condition).toEqual({
        type: "equation",
        operator: "&&",
        equations: [{ left: "slot_selected", operator: "exists" }],
      });
    }
  });
});
