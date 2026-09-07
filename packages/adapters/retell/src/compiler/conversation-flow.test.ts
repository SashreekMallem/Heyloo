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

  it("marks the emergency global_intent's target node as global_node (reachable_from: any)", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const triageNode = flow.nodes.find((n) => n.id === "triage_emergency");
    expect(triageNode?.type).toBe("conversation");
    if (triageNode?.type === "conversation") {
      expect(triageNode.global_node).toBe(true);
    }
  });

  it("only attaches tool_ids for tools actually declared in template.tools", () => {
    const flow = compileConversationFlow(AUTO_CONVERSATION_FLOW_TEMPLATE, TOOL_WEBHOOK_URL);
    const checkTimeNode = flow.nodes.find((n) => n.id === "check_time");
    expect(checkTimeNode?.type).toBe("conversation");
    if (checkTimeNode?.type === "conversation") {
      expect(checkTimeNode.tool_ids).toEqual(["check_availability"]);
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
