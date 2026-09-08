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
    expect(triageNode?.type).toBe("conversation");
    if (triageNode?.type === "conversation") {
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
});
