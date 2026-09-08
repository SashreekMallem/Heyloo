/**
 * Lowers a canonical `AgentTemplate` (compile_target `conversation_flow`)
 * into a Retell Conversation Flow request body (SYSTEM_DESIGN §4.1: auto,
 * dental, motel, restaurant, vet — "hard slot-filling; typed Extract-DV
 * nodes; model cannot invent prices/menu items/rates — tool-backed nodes
 * only").
 *
 * Conventions this compiler owns (VERIFY-8, compiler/types.ts — RESOLVED,
 * RETELL-VERIFY):
 * - The FIRST declared state (`template.states[0]`) is the entry node — its
 *   `id` becomes `start_node_id`, and `disclosure_line` is prepended
 *   verbatim to its instruction text (G1/G2 — "injected verbatim into every
 *   compiled greeting").
 * - Each `AgentState` becomes one `RetellConversationNode`; each
 *   `Transition` becomes one edge on its `from` node.
 * - `global_intents` with `reachable_from: "any"` set their TARGET node's
 *   `global_node_setting: {condition}` (Retell's global-node interrupt
 *   mechanism — confirmed an OBJECT with a required `condition` string, not
 *   the previously-assumed bare `global_node: true` boolean); a scoped
 *   `reachable_from` list instead adds an explicit edge from each listed
 *   state, so the escape is structurally present either way — never
 *   model-discretionary (SYSTEM_DESIGN §4.1).
 * - A state's `allowed_tools` is NOT lowered to any per-node field anymore.
 *   Confirmed (RETELL-VERIFY) that a plain `ConversationNode` has no
 *   `tool_ids`/tool-scoping field at all — every node has access to every
 *   tool declared in the flow's top-level `tools[]`; there is no hard
 *   per-node restriction mechanism (`SubagentNode` has one, but this
 *   compiler doesn't emit that node type). This is a genuine gap against
 *   SYSTEM_DESIGN §4.1's "tool-backed nodes only... model cannot invent"
 *   goal — logged in docs/BUILD_NOTES.md (RETELL-VERIFY) rather than
 *   silently redesigned (CLAUDE.md Rule 4); `allowed_tools` still exists on
 *   the canonical `AgentState` type for other compile targets (multi_prompt
 *   DOES support real per-state tool scoping) and for future use if this
 *   flow is ever restructured around `SubagentNode`.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import type {
  RetellConversationFlowRequest,
  RetellConversationNode,
  RetellFunctionTool,
} from "./types.js";

export function compileConversationFlow(
  template: AgentTemplate,
  toolWebhookUrl: string,
): RetellConversationFlowRequest {
  const tools: RetellFunctionTool[] = template.tools.map((tool) => ({
    type: "custom",
    name: tool.name,
    description: tool.description,
    url: toolWebhookUrl,
    // `properties` is REQUIRED per retell-typescript-sdk's `CustomTool.
    // Parameters` even though the canonical `JsonSchemaObject` allows
    // omitting it for template-authoring convenience — default to `{}`.
    parameters: {
      type: "object",
      properties: tool.parameters.properties ?? {},
      ...(tool.parameters.required !== undefined ? { required: tool.parameters.required } : {}),
    },
  }));

  const nodesById = new Map<string, RetellConversationNode>();
  for (const state of template.states) {
    nodesById.set(state.id, {
      id: state.id,
      type: "conversation",
      name: state.name,
      instruction: { type: "prompt", text: state.prompt_fragment },
      edges: [],
    });
  }

  for (const [index, transition] of template.transitions.entries()) {
    const fromNode = nodesById.get(transition.from);
    if (!fromNode) continue; // guarded upstream by zAgentTemplate's structural validation
    fromNode.edges.push({
      id: `edge_${transition.from}_${transition.to}_${index}`,
      destination_node_id: transition.to,
      transition_condition: {
        type: "prompt",
        prompt: transition.on.intent ?? transition.on.predicate ?? "",
      },
    });
  }

  applyGlobalIntents(nodesById, template);

  const startState = template.states[0];
  const startNodeId = startState?.id ?? "";
  if (startState) {
    const startNode = nodesById.get(startState.id);
    if (startNode) {
      startNode.instruction.text = `${template.disclosure_line}\n\n${startNode.instruction.text}`;
    }
  }

  const flow: RetellConversationFlowRequest = {
    start_node_id: startNodeId,
    start_speaker: "agent",
    nodes: [...nodesById.values()],
    tools,
  };
  if (template.system_prompt) {
    flow.global_prompt = template.system_prompt;
  }
  return flow;
}

function applyGlobalIntents(
  nodesById: Map<string, RetellConversationNode>,
  template: AgentTemplate,
): void {
  for (const globalIntent of template.global_intents) {
    const targetNode = nodesById.get(globalIntent.target_state);
    if (!targetNode) continue; // guarded upstream by zAgentTemplate's structural validation

    if (globalIntent.reachable_from === "any") {
      targetNode.global_node_setting = { condition: globalIntent.description };
      continue;
    }

    for (const fromStateId of globalIntent.reachable_from) {
      const fromNode = nodesById.get(fromStateId);
      if (!fromNode) continue;
      fromNode.edges.push({
        id: `global_${globalIntent.name}_${fromStateId}_${globalIntent.target_state}`,
        destination_node_id: globalIntent.target_state,
        transition_condition: { type: "prompt", prompt: globalIntent.description },
      });
    }
  }
}
