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

  it("prepends disclosure_line verbatim to the start node's instruction", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const startNode = flow.nodes.find((n) => n.id === flow.start_node_id);
    expect(startNode).toBeDefined();
    expect(startNode?.type).toBe("conversation");
    if (startNode?.type === "conversation") {
      expect(startNode.instruction.text).toContain(AUTO_CONVERSATION_FLOW_TEMPLATE.disclosure_line);
    }
  });

  it("uses the first declared state as start_node_id", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    expect(flow.start_node_id).toBe("greeting");
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
    // Single-tool (take_message-only), non-start state -> hard-locked to a
    // Function Node (GAP_REGISTER §1.4) rather than the previous plain
    // conversation node; global_node_setting is identically shaped there.
    expect(triageNode?.type).toBe("function");
    if (triageNode?.type === "function") {
      expect(triageNode.global_node_setting).toEqual({
        condition: AUTO_CONVERSATION_FLOW_TEMPLATE.global_intents.find(
          (gi) => gi.target_state === "triage_emergency",
        )?.description,
      });
    }
  });

  it("never emits a tool_ids field on a conversation node (not a real field — RETELL-VERIFY)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    for (const node of flow.nodes) {
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

  it("hard-locks a single-tool, non-start state to a Function Node (GAP_REGISTER §1.4)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const checkTime = flow.nodes.find((n) => n.id === "check_time");
    expect(checkTime?.type).toBe("function");
    if (checkTime?.type === "function") {
      expect(checkTime.tool_id).toBe("check_availability");
      expect(checkTime.tool_type).toBe("local");
      expect(checkTime.wait_for_result).toBe(true);
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

  it("compiles a single-tool transfer_call state to a native TransferCallNode, not a Function Node (GAP_REGISTER §1.4 item 4)", () => {
    const withTransferState = {
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
      ],
    };
    const flow = compileConversationFlow(withTransferState, TOOL_WEBHOOK_URL);
    const transferNode = flow.nodes.find((n) => n.id === "transfer_to_human");
    expect(transferNode?.type).toBe("transfer_call");
    if (transferNode?.type === "transfer_call") {
      expect(transferNode.transfer_destination).toEqual({
        type: "predefined",
        number: "{{transfer_number}}",
      });
      expect(transferNode.transfer_option).toEqual({ type: "warm_transfer" });
    }
    // transfer_call is never emitted into the flow's top-level custom-tools list.
    expect(flow.tools.find((t) => t.name === "transfer_call")).toBeUndefined();
  });

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
